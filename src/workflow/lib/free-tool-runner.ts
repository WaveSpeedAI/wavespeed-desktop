/**
 * Standalone runner for workflow free-tools that use Web Workers.
 * Called from free-tool:execute IPC handler in renderer.
 */
type ModelType = "slim" | "medium" | "thick";
type ScaleType = "2x" | "3x" | "4x";
type BgRemoverModel = "isnet_quint8" | "isnet_fp16" | "isnet";

interface ImageEnhancerParams {
  model?: string;
  scale?: string;
}

interface BackgroundRemoverParams {
  model?: string;
}

function imageDataToFloat32(imageData: ImageData): Float32Array {
  const { width, height, data } = imageData;
  const result = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = (y * width + x) * 3;
      result[dstIdx] = data[srcIdx] / 255;
      result[dstIdx + 1] = data[srcIdx + 1] / 255;
      result[dstIdx + 2] = data[srcIdx + 2] / 255;
    }
  }
  return result;
}

function float32ToImageData(
  data: Float32Array,
  width: number,
  height: number,
): ImageData {
  const imageData = new ImageData(width, height);
  const pixels = imageData.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 3;
      const dstIdx = (y * width + x) * 4;
      pixels[dstIdx] = Math.round(data[srcIdx] * 255);
      pixels[dstIdx + 1] = Math.round(data[srcIdx + 1] * 255);
      pixels[dstIdx + 2] = Math.round(data[srcIdx + 2] * 255);
      pixels[dstIdx + 3] = 255;
    }
  }
  return imageData;
}

function imageDataToDataURL(
  imageData: ImageData,
  width: number,
  height: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function dataURLToBase64(dataUrl: string): string {
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("Invalid data URL");
  return base64;
}

async function loadImageAsImageData(url: string): Promise<ImageData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return imageData;
}

/**
 * Run image enhancer (upscaler) and return base64 PNG data.
 */
export async function runImageEnhancer(
  inputUrl: string,
  params: ImageEnhancerParams,
  onProgress?: (progress: number, message?: string) => void,
): Promise<string> {
  const model = (params.model ?? "slim") as ModelType;
  const scale = (params.scale ?? "2x") as ScaleType;

  if (!["slim", "medium", "thick"].includes(model)) {
    throw new Error(`Invalid model: ${model}`);
  }
  if (!["2x", "3x", "4x"].includes(scale)) {
    throw new Error(`Invalid scale: ${scale}`);
  }

  onProgress?.(5, "Loading image...");
  const imageData = await loadImageAsImageData(inputUrl);

  const worker = new Worker(
    new URL("../../workers/upscaler.worker.ts", import.meta.url),
    { type: "module" },
  );

  return new Promise((resolve, reject) => {
    const handleMessage = (e: MessageEvent) => {
      const { type, payload } = e.data;
      if (type === "phase") {
        onProgress?.(
          15,
          payload?.phase === "download"
            ? "Downloading model..."
            : "Processing...",
        );
      } else if (type === "progress") {
        const p = payload?.progress ?? 0;
        onProgress?.(15 + Math.round(p * 0.8), "Upscaling...");
      } else if (type === "loaded") {
        onProgress?.(25, "Model loaded, upscaling...");
        worker.postMessage({
          type: "upscale",
          payload: { imageData, id: 0 },
        });
      } else if (type === "result") {
        const { imageData: resultData, width, height } = payload;
        const dataUrl = imageDataToDataURL(resultData, width, height);
        worker.terminate();
        onProgress?.(100, "Done");
        resolve(dataURLToBase64(dataUrl));
      } else if (type === "error") {
        worker.terminate();
        reject(new Error(String(payload ?? "Unknown error")));
      }
    };

    worker.onmessage = handleMessage;
    worker.onerror = (ev) => {
      worker.terminate();
      reject(new Error(ev.message || "Worker error"));
    };

    worker.postMessage({
      type: "load",
      payload: { model, scale, id: 0 },
    });
  });
}

/**
 * Run background remover and return base64 PNG data (foreground with transparent bg).
 */
export async function runBackgroundRemover(
  inputUrl: string,
  params: BackgroundRemoverParams,
  onProgress?: (progress: number, message?: string) => void,
): Promise<string> {
  const model = (params.model ?? "isnet_fp16") as BgRemoverModel;
  if (!["isnet_quint8", "isnet_fp16", "isnet"].includes(model)) {
    throw new Error(`Invalid model: ${model}`);
  }

  onProgress?.(5, "Loading image...");
  const res = await fetch(inputUrl);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const imageBlob = await res.blob();

  const worker = new Worker(
    new URL("../../workers/backgroundRemover.worker.ts", import.meta.url),
    { type: "module" },
  );

  return new Promise((resolve, reject) => {
    const handleMessage = (e: MessageEvent) => {
      const { type, payload } = e.data;
      if (type === "phase") {
        onProgress?.(
          20,
          payload?.phase === "download"
            ? "Downloading model..."
            : "Removing background...",
        );
      } else if (type === "progress") {
        const p = payload?.progress ?? 0;
        onProgress?.(20 + Math.round(p * 0.75), "Processing...");
      } else if (type === "result") {
        const { arrayBuffer } = payload;
        worker.terminate();
        onProgress?.(100, "Done");
        const blob = new Blob([arrayBuffer]);
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          resolve(dataUrl.split(",")[1] ?? "");
        };
        reader.onerror = () => reject(new Error("Failed to read result"));
        reader.readAsDataURL(blob);
      } else if (type === "error") {
        worker.terminate();
        reject(new Error(String(payload ?? "Unknown error")));
      }
    };

    worker.onmessage = handleMessage;
    worker.onerror = (ev) => {
      worker.terminate();
      reject(new Error(ev.message || "Worker error"));
    };

    worker.postMessage({
      type: "process",
      payload: { imageBlob, model, outputType: "foreground", id: 0 },
    });
  });
}

/**
 * Run face enhancer and return base64 PNG data.
 */
export async function runFaceEnhancer(
  inputUrl: string,
  _params: Record<string, unknown>,
  onProgress?: (progress: number, message?: string) => void,
): Promise<string> {
  onProgress?.(5, "Loading image...");
  const imageData = await loadImageAsImageData(inputUrl);
  const float32Data = imageDataToFloat32(imageData);

  const worker = new Worker(
    new URL("../../workers/faceEnhancer.worker.ts", import.meta.url),
    { type: "module" },
  );

  return new Promise((resolve, reject) => {
    const handleMessage = (e: MessageEvent) => {
      const { type, payload } = e.data;
      if (type === "phase") {
        onProgress?.(10, "Processing...");
      } else if (type === "progress") {
        const p = payload?.progress ?? 0;
        onProgress?.(10 + Math.round(p * 0.8), "Enhancing faces...");
      } else if (type === "ready") {
        onProgress?.(15, "Model loaded, enhancing...");
        const dataCopy = new Float32Array(float32Data);
        worker.postMessage(
          {
            type: "enhance",
            payload: {
              imageData: dataCopy,
              width: imageData.width,
              height: imageData.height,
              id: 0,
            },
          },
          { transfer: [dataCopy.buffer] },
        );
      } else if (type === "result") {
        const { data, width, height } = payload;
        const float32 =
          data instanceof Float32Array ? data : new Float32Array(data);
        const imageDataOut = float32ToImageData(float32, width, height);
        const dataUrl = imageDataToDataURL(imageDataOut, width, height);
        worker.terminate();
        onProgress?.(100, "Done");
        resolve(dataURLToBase64(dataUrl));
      } else if (type === "error") {
        worker.terminate();
        reject(new Error(String(payload ?? "Unknown error")));
      }
    };

    worker.onmessage = handleMessage;
    worker.onerror = (ev) => {
      worker.terminate();
      reject(new Error(ev.message || "Worker error"));
    };

    worker.postMessage({ type: "init", payload: { id: 0, timeout: 600000 } });
  });
}

/**
 * Run video enhancer — upscale each frame to WebM.
 */
export async function runVideoEnhancer(
  inputUrl: string,
  params: { model?: string; scale?: string },
  onProgress?: (progress: number, message?: string) => void,
): Promise<string> {
  const model = (params.model ?? "slim") as ModelType;
  const scale = (params.scale ?? "2x") as ScaleType;
  if (!["slim", "medium", "thick"].includes(model))
    throw new Error(`Invalid model: ${model}`);
  if (!["2x", "3x", "4x"].includes(scale))
    throw new Error(`Invalid scale: ${scale}`);

  const { Muxer, ArrayBufferTarget } = await import("webm-muxer");
  const video = document.createElement("video");
  video.muted = true;
  video.crossOrigin = "anonymous";
  video.src = inputUrl;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Failed to load video"));
  });

  const scaleMultiplier = parseInt(scale.replace("x", ""));
  const targetFps = 30;
  const frameInterval = 1 / targetFps;
  const duration = video.duration;
  const totalFrames = Math.ceil(duration * targetFps);

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = video.videoWidth;
  sourceCanvas.height = video.videoHeight;
  const sourceCtx = sourceCanvas.getContext("2d")!;

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = video.videoWidth * scaleMultiplier;
  outputCanvas.height = video.videoHeight * scaleMultiplier;
  const outputCtx = outputCanvas.getContext("2d")!;

  onProgress?.(2, "Loading upscaler model...");
  const upscalerWorker = new Worker(
    new URL("../../workers/upscaler.worker.ts", import.meta.url),
    { type: "module" },
  );

  await new Promise<void>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      if (e.data.type === "loaded") {
        upscalerWorker.removeEventListener("message", handler);
        resolve();
      } else if (e.data.type === "error") {
        upscalerWorker.removeEventListener("message", handler);
        reject(new Error(String(e.data.payload)));
      }
    };
    upscalerWorker.onmessage = handler;
    upscalerWorker.postMessage({
      type: "load",
      payload: { model, scale, id: 0 },
    });
  });

  const upscaleFrame = (imageData: ImageData): Promise<string> => {
    return new Promise((resolve, reject) => {
      const handler = (e: MessageEvent) => {
        if (e.data.type === "result") {
          upscalerWorker.removeEventListener("message", handler);
          const { imageData: resultData, width, height } = e.data.payload;
          const dataUrl = imageDataToDataURL(resultData, width, height);
          resolve(dataUrl);
        } else if (e.data.type === "error") {
          upscalerWorker.removeEventListener("message", handler);
          reject(new Error(String(e.data.payload)));
        }
      };
      upscalerWorker.onmessage = handler;
      upscalerWorker.postMessage({
        type: "upscale",
        payload: { imageData, id: 0 },
      });
    });
  };

  const muxerTarget = new ArrayBufferTarget();
  const muxer = new Muxer({
    target: muxerTarget,
    video: {
      codec: "V_VP9",
      width: outputCanvas.width,
      height: outputCanvas.height,
      frameRate: targetFps,
    },
    firstTimestampBehavior: "offset",
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error("Encoder error:", e),
  });
  encoder.configure({
    codec: "vp09.00.10.08",
    width: outputCanvas.width,
    height: outputCanvas.height,
    bitrate: 8_000_000,
    framerate: targetFps,
  });

  video.pause();
  for (let i = 0; i < totalFrames; i++) {
    const t = i * frameInterval;
    video.currentTime = t;
    await new Promise<void>((r) => {
      video.onseeked = () => r();
    });
    sourceCtx.drawImage(video, 0, 0);
    const imageData = sourceCtx.getImageData(
      0,
      0,
      video.videoWidth,
      video.videoHeight,
    );
    const dataUrl = await upscaleFrame(imageData);
    const img = new Image();
    await new Promise<void>((r) => {
      img.onload = () => {
        outputCtx.drawImage(img, 0, 0);
        r();
      };
      img.src = dataUrl;
    });
    const frame = new VideoFrame(outputCanvas, {
      timestamp: Math.round(t * 1_000_000),
    });
    encoder.encode(frame, { keyFrame: i % 30 === 0 });
    frame.close();
    const pct = 5 + Math.round(((i + 1) / totalFrames) * 90);
    onProgress?.(pct, `Frame ${i + 1}/${totalFrames}`);
  }

  upscalerWorker.terminate();
  await encoder.flush();
  encoder.close();
  muxer.finalize();
  onProgress?.(98, "Finalizing...");

  const buffer = muxerTarget.buffer;
  if (!buffer || buffer.byteLength === 0)
    throw new Error("Encoder produced no output");

  const blob = new Blob([buffer], { type: "video/webm" });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Failed to read video"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Run face swapper — swap source face onto target image.
 */
export async function runFaceSwapper(
  sourceUrl: string,
  targetUrl: string,
  _params: Record<string, unknown>,
  onProgress?: (progress: number, message?: string) => void,
): Promise<string> {
  onProgress?.(5, "Loading images...");
  const [sourceImageData, targetImageData] = await Promise.all([
    loadImageAsImageData(sourceUrl),
    loadImageAsImageData(targetUrl),
  ]);

  const worker = new Worker(
    new URL("../../workers/faceSwapper.worker.ts", import.meta.url),
    { type: "module" },
  );

  const initPromise = new Promise<void>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      if (e.data.type === "ready") {
        worker.removeEventListener("message", handler);
        resolve();
      } else if (e.data.type === "error") {
        worker.removeEventListener("message", handler);
        reject(new Error(String(e.data.payload)));
      }
    };
    worker.onmessage = handler;
    worker.postMessage({
      type: "init",
      payload: { id: 0, timeout: 600000, enableEnhancement: false },
    });
  });

  onProgress?.(10, "Initializing models...");
  await initPromise;

  const detectFaces = (
    imageData: ImageData,
    imageId: "source" | "target",
  ): Promise<
    Array<{
      landmarks: number[][];
      box: {
        x: number;
        y: number;
        width: number;
        height: number;
        confidence: number;
      };
    }>
  > => {
    return new Promise((resolve, reject) => {
      const float32 = imageDataToFloat32(imageData);
      const id = Math.floor(Math.random() * 1e6);
      const handler = (e: MessageEvent) => {
        if (e.data.type === "detectResult" && e.data.payload?.id === id) {
          worker.removeEventListener("message", handler);
          resolve(e.data.payload.faces ?? []);
        } else if (e.data.type === "error") {
          worker.removeEventListener("message", handler);
          reject(new Error(String(e.data.payload)));
        }
      };
      worker.onmessage = handler;
      worker.postMessage(
        {
          type: "detect",
          payload: {
            imageData: float32,
            width: imageData.width,
            height: imageData.height,
            imageId,
            id,
          },
        },
        { transfer: [float32.buffer] },
      );
    });
  };

  onProgress?.(30, "Detecting faces...");
  // Detect faces sequentially to avoid "Session already started" errors from ONNX Runtime
  const sourceFaces = await detectFaces(sourceImageData, "source");
  const targetFaces = await detectFaces(targetImageData, "target");

  if (!sourceFaces.length) throw new Error("No face found in source image");
  if (!targetFaces.length) throw new Error("No face found in target image");

  onProgress?.(50, "Swapping faces...");
  const result = await new Promise<string>((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e6);
    const handler = (e: MessageEvent) => {
      if (e.data.type === "swapResult" && e.data.payload?.id === id) {
        worker.removeEventListener("message", handler);
        const { data, width, height } = e.data.payload;
        const imgData = float32ToImageData(
          data instanceof Float32Array ? data : new Float32Array(data),
          width,
          height,
        );
        resolve(imageDataToDataURL(imgData, width, height));
      } else if (e.data.type === "error") {
        worker.removeEventListener("message", handler);
        reject(new Error(String(e.data.payload)));
      }
    };
    worker.onmessage = handler;
    const srcF32 = imageDataToFloat32(sourceImageData);
    const tgtF32 = imageDataToFloat32(targetImageData);
    worker.postMessage(
      {
        type: "swap",
        payload: {
          sourceImage: srcF32,
          sourceWidth: sourceImageData.width,
          sourceHeight: sourceImageData.height,
          sourceLandmarks: sourceFaces[0].landmarks,
          targetImage: tgtF32,
          targetWidth: targetImageData.width,
          targetHeight: targetImageData.height,
          targetFaces: targetFaces.map((f) => ({
            landmarks: f.landmarks,
            box: f.box,
          })),
          id,
        },
      },
      { transfer: [srcF32.buffer, tgtF32.buffer] },
    );
  });

  worker.terminate();
  onProgress?.(100, "Done");
  return dataURLToBase64(result);
}

/** Convert mask image to Float32Array (alpha or luminance > 128 = 1) */
async function loadMaskAsFloat32(
  url: string,
  width: number,
  height: number,
): Promise<Float32Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch mask: ${res.status}`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const float32 = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    // Transparent pixels are always background (0).
    // For opaque pixels, use luminance to decide: white = mask, black = background.
    // This handles both:
    //  - MaskEditor output (opaque black/white, alpha always 255)
    //  - Segment-anything output (transparent bg + opaque white mask)
    if (a <= 128) {
      float32[i] = 0;
    } else {
      float32[i] = r > 128 || g > 128 || b > 128 ? 1 : 0;
    }
  }
  return float32;
}

/** Convert image to Float32Array CHW 0-1 for LaMa */
async function loadImageAsFloat32CHW(
  url: string,
): Promise<{ data: Float32Array; width: number; height: number }> {
  const imageData = await loadImageAsImageData(url);
  const { data, width, height } = imageData;
  const float32 = new Float32Array(3 * width * height);
  for (let i = 0; i < width * height; i++) {
    float32[i] = data[i * 4] / 255;
    float32[width * height + i] = data[i * 4 + 1] / 255;
    float32[2 * width * height + i] = data[i * 4 + 2] / 255;
  }
  return { data: float32, width, height };
}

function float32CHWToDataURL(
  data: Float32Array,
  width: number,
  height: number,
): string {
  const imageData = new ImageData(width, height);
  const out = imageData.data;
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = Math.round(Math.min(1, Math.max(0, data[i])) * 255);
    out[i * 4 + 1] = Math.round(
      Math.min(1, Math.max(0, data[width * height + i])) * 255,
    );
    out[i * 4 + 2] = Math.round(
      Math.min(1, Math.max(0, data[2 * width * height + i])) * 255,
    );
    out[i * 4 + 3] = 255;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Run image eraser — inpaint masked area.
 */
export async function runImageEraser(
  imageUrl: string,
  maskUrl: string,
  _params: Record<string, unknown>,
  onProgress?: (progress: number, message?: string) => void,
): Promise<string> {
  onProgress?.(5, "Loading image and mask...");
  const {
    data: imageData,
    width,
    height,
  } = await loadImageAsFloat32CHW(imageUrl);
  const maskData = await loadMaskAsFloat32(maskUrl, width, height);

  const worker = new Worker(
    new URL("../../workers/imageEraser.worker.ts", import.meta.url),
    { type: "module" },
  );

  return new Promise((resolve, reject) => {
    const handleMessage = (e: MessageEvent) => {
      const { type, payload } = e.data;
      if (type === "phase") {
        onProgress?.(15, "Processing...");
      } else if (type === "progress") {
        const p = payload?.progress ?? 0;
        onProgress?.(15 + Math.round(p * 0.8), "Inpainting...");
      } else if (type === "ready") {
        onProgress?.(20, "Model loaded, processing...");
        const imgCopy = new Float32Array(imageData);
        const maskCopy = new Float32Array(maskData);
        worker.postMessage(
          {
            type: "process",
            payload: {
              imageData: imgCopy,
              maskData: maskCopy,
              width,
              height,
              id: 0,
            },
          },
          { transfer: [imgCopy.buffer, maskCopy.buffer] },
        );
      } else if (type === "result") {
        const { data, width: w, height: h } = payload;
        const result =
          data instanceof Float32Array ? data : new Float32Array(data);
        const dataUrl = float32CHWToDataURL(result, w, h);
        worker.terminate();
        onProgress?.(100, "Done");
        resolve(dataURLToBase64(dataUrl));
      } else if (type === "error") {
        worker.terminate();
        reject(new Error(String(payload ?? "Unknown error")));
      }
    };

    worker.onmessage = handleMessage;
    worker.onerror = (ev) => {
      worker.terminate();
      reject(new Error(ev.message || "Worker error"));
    };

    worker.postMessage({ type: "init", payload: { id: 0, timeout: 600000 } });
  });
}

interface SegmentPointInput {
  point: [number, number];
  label: 0 | 1;
}

/**
 * Run segment anything — output mask PNG from point prompt.
 * If __previewMask is set (from SegmentPointPicker live preview), use it directly
 * instead of re-running the SAM model.
 * Params: __segmentPoints (JSON array from PointPicker) or pointX/pointY as fallback.
 */
export async function runSegmentAnything(
  imageUrl: string,
  params: {
    pointX?: number;
    pointY?: number;
    __segmentPoints?: string;
    __previewMask?: string;
    invertMask?: boolean;
  },
  onProgress?: (progress: number, message?: string) => void,
): Promise<string> {
  const invert = Boolean(params.invertMask);

  // If a preview mask was already generated in the SegmentPointPicker, use it directly
  const previewMask = params.__previewMask;
  if (previewMask && typeof previewMask === "string" && previewMask.trim()) {
    onProgress?.(50, "Using previewed mask...");
    // Load the mask image and re-export as base64
    const res = await fetch(previewMask);
    if (res.ok) {
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx2d = canvas.getContext("2d")!;
      ctx2d.drawImage(bitmap, 0, 0);
      bitmap.close();
      if (invert) {
        const imgData = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          d[i] = 255 - d[i];
          d[i + 1] = 255 - d[i + 1];
          d[i + 2] = 255 - d[i + 2];
          // Keep alpha: if was transparent (0) make opaque (255) and vice versa
          d[i + 3] = d[i + 3] > 128 ? 0 : 255;
        }
        ctx2d.putImageData(imgData, 0, 0);
      }
      const dataUrl = canvas.toDataURL("image/png");
      onProgress?.(100, "Done");
      return dataURLToBase64(dataUrl);
    }
    // If fetch failed, fall through to full SAM execution
  }

  let points: SegmentPointInput[];
  try {
    const parsed = params.__segmentPoints
      ? JSON.parse(params.__segmentPoints as string)
      : null;
    if (Array.isArray(parsed) && parsed.length > 0) {
      points = parsed.filter(
        (p: unknown): p is SegmentPointInput =>
          p != null &&
          typeof p === "object" &&
          Array.isArray((p as SegmentPointInput).point) &&
          ((p as SegmentPointInput).point as unknown[]).length >= 2 &&
          ((p as SegmentPointInput).label === 0 ||
            (p as SegmentPointInput).label === 1),
      );
    } else {
      points = [];
    }
  } catch {
    points = [];
  }
  if (points.length === 0) {
    const pointX = typeof params.pointX === "number" ? params.pointX : 0.5;
    const pointY = typeof params.pointY === "number" ? params.pointY : 0.5;
    points = [{ point: [pointX, pointY], label: 1 }];
  }

  const worker = new Worker(
    new URL("../../workers/segmentAnything.worker.ts", import.meta.url),
    { type: "module" },
  );

  onProgress?.(10, "Loading model and encoding image...");
  await new Promise<void>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      if (e.data.type === "segmented") {
        worker.removeEventListener("message", handler);
        resolve();
      } else if (e.data.type === "error") {
        worker.removeEventListener("message", handler);
        reject(new Error(String(e.data.payload?.message ?? e.data.payload)));
      }
    };
    worker.onmessage = handler;
    worker.postMessage({
      type: "segment",
      payload: { id: 0, imageDataUrl: imageUrl },
    });
  });

  onProgress?.(60, "Decoding mask...");
  const decodeId = 1;
  const pointsForWorker = points.map((p) => ({
    point: p.point as [number, number],
    label: p.label as 0 | 1,
  }));
  const maskResult = await new Promise<{
    mask: Uint8Array;
    width: number;
    height: number;
  }>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      if (e.data.type === "maskResult" && e.data.payload?.id === decodeId) {
        worker.removeEventListener("message", handler);
        const { mask, width, height } = e.data.payload;
        resolve({
          mask: new Uint8Array(mask),
          width,
          height,
        });
      } else if (e.data.type === "error") {
        worker.removeEventListener("message", handler);
        reject(new Error(String(e.data.payload?.message ?? e.data.payload)));
      }
    };
    worker.onmessage = handler;
    worker.postMessage({
      type: "decodeMask",
      payload: { id: decodeId, points: pointsForWorker },
    });
  });

  worker.terminate();

  const { mask, width, height } = maskResult;
  const imageData = new ImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    // SAM outputs 0 or 1; scale to 0 or 255 so downstream consumers
    // (e.g. image-eraser loadMaskAsFloat32) can distinguish mask from background
    // via luminance check (r > 128).  Alpha is always 255 (fully opaque).
    const raw = mask[i] ? 255 : 0;
    const v = invert ? 255 - raw : raw;
    imageData.data[i * 4] = v;
    imageData.data[i * 4 + 1] = v;
    imageData.data[i * 4 + 2] = v;
    imageData.data[i * 4 + 3] = v ? 255 : 0;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  onProgress?.(100, "Done");
  return dataURLToBase64(dataUrl);
}
