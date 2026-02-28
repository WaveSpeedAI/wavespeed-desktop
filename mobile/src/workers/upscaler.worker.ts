import Upscaler from "upscaler";
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-wasm";

type ModelType = "slim" | "medium" | "thick";
type ScaleType = "2x" | "3x" | "4x";

let upscaler: InstanceType<typeof Upscaler> | null = null;
let backendInitialized = false;

// Initialize WASM backend (more reliable than WebGL, avoids CONTEXT_LOST errors)
async function initBackend() {
  if (backendInitialized) return;

  try {
    // Try WASM backend first (most reliable)
    await tf.setBackend("wasm");
    await tf.ready();
    backendInitialized = true;
    console.log("[Upscaler] Using WASM backend");
  } catch (e) {
    console.warn("[Upscaler] WASM backend failed, falling back to default:", e);
    // Fall back to default (WebGL)
    await tf.ready();
    backendInitialized = true;
    console.log("[Upscaler] Using default backend:", tf.getBackend());
  }
}

const getModel = async (model: ModelType, scale: ScaleType) => {
  const modelMap = {
    slim: {
      "2x": () => import("@upscalerjs/esrgan-slim/2x"),
      "3x": () => import("@upscalerjs/esrgan-slim/3x"),
      "4x": () => import("@upscalerjs/esrgan-slim/4x"),
    },
    medium: {
      "2x": () => import("@upscalerjs/esrgan-medium/2x"),
      "3x": () => import("@upscalerjs/esrgan-medium/3x"),
      "4x": () => import("@upscalerjs/esrgan-medium/4x"),
    },
    thick: {
      "2x": () => import("@upscalerjs/esrgan-thick/2x"),
      "3x": () => import("@upscalerjs/esrgan-thick/3x"),
      "4x": () => import("@upscalerjs/esrgan-thick/4x"),
    },
  };
  return (await modelMap[model][scale]()).default;
};

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  try {
    switch (type) {
      case "load": {
        const { model, scale, id } = payload as {
          model: ModelType;
          scale: ScaleType;
          id?: number;
        };

        // Dispose previous upscaler if exists
        if (upscaler) {
          upscaler.dispose();
          upscaler = null;
        }

        // Signal start of download phase
        self.postMessage({
          type: "phase",
          payload: { phase: "download", id },
        });

        self.postMessage({
          type: "progress",
          payload: {
            phase: "download",
            progress: 0,
            id,
          },
        });

        // Initialize WASM backend before loading model (fixes CONTEXT_LOST_WEBGL errors)
        await initBackend();

        const modelDef = await getModel(model, scale);

        self.postMessage({
          type: "progress",
          payload: {
            phase: "download",
            progress: 50,
            id,
          },
        });

        upscaler = new Upscaler({ model: modelDef });

        self.postMessage({
          type: "progress",
          payload: {
            phase: "download",
            progress: 100,
            id,
          },
        });

        self.postMessage({ type: "loaded", payload: { id } });
        break;
      }

      case "upscale": {
        if (!upscaler) {
          throw new Error("Model not loaded");
        }

        const { imageData, id } = payload as {
          imageData: ImageData;
          id: number;
        };

        // Signal start of process phase
        self.postMessage({
          type: "phase",
          payload: { phase: "process", id },
        });

        // Upscale using ImageData directly, output as tensor to avoid base64 issues in worker
        const result = await upscaler.upscale(imageData, {
          output: "tensor",
          patchSize: 64,
          padding: 2,
          progress: (percent: number) => {
            // Emit standardized progress (percent is 0-1 from upscaler)
            self.postMessage({
              type: "progress",
              payload: {
                phase: "process",
                progress: percent * 100,
                detail: {
                  current: Math.round(percent * 100),
                  total: 100,
                  unit: "percent" as const,
                },
                id,
              },
            });
          },
        });

        // Convert tensor to ImageData
        // Result tensor shape is [height, width, channels] (RGB, 3 channels)
        const [height, width, channels] = result.shape;
        const data = await result.data();
        result.dispose();

        // Create Uint8ClampedArray for ImageData (needs RGBA, 4 channels)
        const pixelCount = width * height;
        const uint8Data = new Uint8ClampedArray(pixelCount * 4);

        // Track if result is all black (indicates processing failure)
        let hasNonBlackPixel = false;

        for (let i = 0; i < pixelCount; i++) {
          const srcIdx = i * channels;
          const dstIdx = i * 4;
          const r = Math.round(data[srcIdx]);
          const g = Math.round(data[srcIdx + 1]);
          const b = Math.round(data[srcIdx + 2]);
          uint8Data[dstIdx] = r; // R
          uint8Data[dstIdx + 1] = g; // G
          uint8Data[dstIdx + 2] = b; // B
          uint8Data[dstIdx + 3] = 255; // A (fully opaque)

          // Check if any pixel is non-black (threshold > 5 to account for noise)
          if (!hasNonBlackPixel && (r > 5 || g > 5 || b > 5)) {
            hasNonBlackPixel = true;
          }
        }

        // If result is all black, processing likely failed
        if (!hasNonBlackPixel) {
          throw new Error(
            "Processing failed: output is all black. Please try again.",
          );
        }

        const resultImageData = new ImageData(uint8Data, width, height);

        // Transfer the buffer back to main thread for efficiency
        self.postMessage(
          {
            type: "result",
            payload: {
              imageData: resultImageData,
              width,
              height,
              id,
            },
          },
          { transfer: [resultImageData.data.buffer] },
        );
        break;
      }

      case "dispose": {
        if (upscaler) {
          upscaler.dispose();
          upscaler = null;
        }
        self.postMessage({ type: "disposed" });
        break;
      }
    }
  } catch (error) {
    self.postMessage({ type: "error", payload: (error as Error).message });
  }
};
