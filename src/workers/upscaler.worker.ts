import Upscaler from "upscaler";

type ModelType = "slim" | "medium" | "thick";
type ScaleType = "2x" | "3x" | "4x";

let upscaler: InstanceType<typeof Upscaler> | null = null;

/**
 * Model loading strategy:
 *  - slim:  bundled locally (small, ~5MB per scale)
 *  - medium/thick:  loaded from CDN on demand (saves ~128MB from app bundle)
 *
 * CDN model definitions use jsdelivr to serve the TF.js model.json + weight shards.
 * TF.js loadGraphModel/loadLayersModel supports remote URLs natively.
 */

const CDN_MODELS: Record<
  string,
  Record<ScaleType, { path: string; modelType: string; scale: number }>
> = {
  medium: {
    "2x": {
      path: "https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-medium@1.0.0-beta.10/models/2x/model.json",
      modelType: "layers",
      scale: 2,
    },
    "3x": {
      path: "https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-medium@1.0.0-beta.10/models/3x/model.json",
      modelType: "layers",
      scale: 3,
    },
    "4x": {
      path: "https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-medium@1.0.0-beta.10/models/4x/model.json",
      modelType: "layers",
      scale: 4,
    },
  },
  thick: {
    "2x": {
      path: "https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-thick@1.0.0-beta.12/models/2x/model.json",
      modelType: "layers",
      scale: 2,
    },
    "3x": {
      path: "https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-thick@1.0.0-beta.12/models/3x/model.json",
      modelType: "layers",
      scale: 3,
    },
    "4x": {
      path: "https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-thick@1.0.0-beta.12/models/4x/model.json",
      modelType: "layers",
      scale: 4,
    },
  },
};

const getModel = async (model: ModelType, scale: ScaleType) => {
  // Slim: bundled locally
  if (model === "slim") {
    const slimMap = {
      "2x": () => import("@upscalerjs/esrgan-slim/2x"),
      "3x": () => import("@upscalerjs/esrgan-slim/3x"),
      "4x": () => import("@upscalerjs/esrgan-slim/4x"),
    };
    return (await slimMap[scale]()).default;
  }

  // Medium / Thick: load from CDN
  const cdnDef = CDN_MODELS[model]?.[scale];
  if (!cdnDef) throw new Error(`Unknown model: ${model}/${scale}`);
  return cdnDef;
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

        const modelDef = await getModel(model, scale);

        self.postMessage({
          type: "progress",
          payload: {
            phase: "download",
            progress: 50,
            id,
          },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        upscaler = new Upscaler({ model: modelDef as any });

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

        for (let i = 0; i < pixelCount; i++) {
          const srcIdx = i * channels;
          const dstIdx = i * 4;
          uint8Data[dstIdx] = Math.round(data[srcIdx]); // R
          uint8Data[dstIdx + 1] = Math.round(data[srcIdx + 1]); // G
          uint8Data[dstIdx + 2] = Math.round(data[srcIdx + 2]); // B
          uint8Data[dstIdx + 3] = 255; // A (fully opaque)
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
