import * as ort from "onnxruntime-web";
import {
  IMAGE_COLORIZER_CACHE_NAME,
  IMAGE_COLORIZER_MODEL_URL,
} from "@/lib/freeToolModels";

type ColorizeMode = "ai" | "natural" | "vintage" | "vivid" | "portrait";

interface ColorizeOptions {
  mode: ColorizeMode;
  strength: number;
  saturation: number;
  preserveContrast: boolean;
}

interface ProcessPayload {
  imageBlob: Blob;
  options: ColorizeOptions;
  id: number;
}

const ORT_WASM_VERSION = "1.21.0";
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_WASM_VERSION}/dist/`;

const MODEL_URL = IMAGE_COLORIZER_MODEL_URL;
const MODEL_SIZE = 256;
const CACHE_NAME = IMAGE_COLORIZER_CACHE_NAME;
let session: ort.InferenceSession | null = null;

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const segment = hue / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;

  if (segment < 1) {
    r = chroma;
    g = x;
  } else if (segment < 2) {
    r = x;
    g = chroma;
  } else if (segment < 3) {
    g = chroma;
    b = x;
  } else if (segment < 4) {
    g = x;
    b = chroma;
  } else if (segment < 5) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }

  const m = l - chroma / 2;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;

  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;

  return [h * 60, s, l];
}

function srgbToLinear(value: number) {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number) {
  const v =
    value <= 0.0031308
      ? value * 12.92
      : 1.055 * Math.pow(Math.max(value, 0), 1 / 2.4) - 0.055;
  return clamp(v, 0, 1) * 255;
}

function labPivot(value: number) {
  return value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
}

function labPivotInv(value: number) {
  const value3 = value * value * value;
  return value3 > 0.008856 ? value3 : (value - 16 / 116) / 7.787;
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  const z = (rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041) / 1.08883;

  const fx = labPivot(x);
  const fy = labPivot(y);
  const fz = labPivot(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToRgb(l: number, a: number, b: number): [number, number, number] {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const x = labPivotInv(fx) * 0.95047;
  const y = labPivotInv(fy);
  const z = labPivotInv(fz) * 1.08883;

  const rl = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  const gl = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  const bl = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

  return [
    Math.round(linearToSrgb(rl)),
    Math.round(linearToSrgb(gl)),
    Math.round(linearToSrgb(bl)),
  ];
}

function float16ToFloat32(value: number) {
  const sign = value & 0x8000 ? -1 : 1;
  const exponent = (value >> 10) & 0x1f;
  const fraction = value & 0x03ff;

  if (exponent === 0) {
    return sign * Math.pow(2, -14) * (fraction / 1024);
  }

  if (exponent === 0x1f) {
    return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  }

  return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
}

function readTensorValue(
  data:
    | Float32Array
    | Float64Array
    | Uint16Array
    | Int32Array
    | BigInt64Array
    | BigUint64Array,
  index: number,
) {
  if (data instanceof Uint16Array) {
    return float16ToFloat32(data[index]);
  }

  return Number(data[index]);
}

function hashNoise(x: number, y: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function getPaletteColor(
  mode: ColorizeMode,
  luma: number,
  xNorm: number,
  yNorm: number,
  noise: number,
): [number, number] {
  const shadow = smoothstep(0.08, 0.45, luma);
  const highlight = smoothstep(0.48, 0.92, luma);

  if (mode === "vintage") {
    return [lerp(26, 43, highlight) + (noise - 0.5) * 5, 0.34];
  }

  if (mode === "portrait") {
    const centerBias =
      1 - clamp(Math.hypot((xNorm - 0.5) / 0.55, (yNorm - 0.48) / 0.7), 0, 1);
    const warmSkin = 23 + highlight * 12;
    const mutedBackground = lerp(205, 34, shadow);
    return [
      lerp(mutedBackground, warmSkin, centerBias * 0.75 + highlight * 0.2) +
        (noise - 0.5) * 7,
      lerp(0.26, 0.48, centerBias),
    ];
  }

  if (mode === "vivid") {
    const hueA = lerp(198, 322, shadow);
    const hueB = lerp(hueA, 42, highlight);
    return [hueB + (xNorm - 0.5) * 18 + (noise - 0.5) * 12, 0.58];
  }

  const skyBias =
    yNorm < 0.48 && luma > 0.48 ? smoothstep(0.48, 0.95, luma) : 0;
  const groundBias =
    yNorm > 0.45 && luma > 0.18 && luma < 0.78
      ? smoothstep(0.45, 0.95, yNorm)
      : 0;
  const baseHue = lerp(218, 38, shadow);
  const naturalHue = lerp(baseHue, 203, skyBias * 0.7);
  const finalHue = lerp(naturalHue, 88, groundBias * 0.45);
  return [finalHue + (noise - 0.5) * 8, 0.38];
}

async function colorizeImage(imageBlob: Blob, options: ColorizeOptions) {
  const bitmap = await createImageBitmap(imageBlob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to create image processing context");

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;
  const strength = clamp(options.strength / 100);
  const saturationScale = clamp(options.saturation / 100, 0, 2);

  for (let y = 0; y < height; y++) {
    if (y % 64 === 0) {
      self.postMessage({
        type: "progress",
        payload: {
          phase: "process",
          progress: Math.min(96, (y / Math.max(1, height)) * 100),
        },
      });
    }

    const yNorm = height > 1 ? y / (height - 1) : 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const alpha = data[i + 3];
      if (alpha === 0) continue;

      const luma255 = r * 0.2126 + g * 0.7152 + b * 0.0722;
      const luma = luma255 / 255;
      const xNorm = width > 1 ? x / (width - 1) : 0;
      const noise = hashNoise(x, y);
      const [hue, baseSat] = getPaletteColor(
        options.mode,
        luma,
        xNorm,
        yNorm,
        noise,
      );
      const lightness = options.preserveContrast
        ? clamp(lerp(luma, Math.pow(luma, 0.92), 0.28))
        : clamp(lerp(0.18, 0.88, luma));
      const chromaFade =
        smoothstep(0.14, 0.38, luma) *
        (1 - smoothstep(0.82, 0.98, luma) * 0.65);
      const sat = clamp(
        baseSat * saturationScale * (0.7 + luma * 0.45) * chromaFade,
      );
      const [cr, cg, cb] = hslToRgb(hue, sat, lightness);

      data[i] = Math.round(lerp(r, cr, strength));
      data[i + 1] = Math.round(lerp(g, cg, strength));
      data[i + 2] = Math.round(lerp(b, cb, strength));
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.convertToBlob({ type: "image/png", quality: 1 });
}

async function downloadModel(
  url: string,
  onProgress: (current: number, total: number) => void,
): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(url);

  if (cachedResponse) {
    const buffer = await cachedResponse.arrayBuffer();
    onProgress(buffer.byteLength, buffer.byteLength);
    return buffer;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download colorization model: ${response.status}`,
    );
  }

  const contentLength = response.headers.get("content-length");
  const total = contentLength ? parseInt(contentLength, 10) : 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Failed to read colorization model response");

  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received, total);
  }

  const buffer = new Uint8Array(received);
  let position = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, position);
    position += chunk.length;
  }

  try {
    await cache.put(
      url,
      new Response(buffer.buffer, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": buffer.byteLength.toString(),
        },
      }),
    );
  } catch (error) {
    console.warn("Failed to cache colorization model:", error);
  }

  return buffer.buffer;
}

async function initSession(id: number) {
  if (session) return;

  self.postMessage({ type: "phase", payload: { phase: "download", id } });
  const modelBuffer = await downloadModel(MODEL_URL, (current, total) => {
    self.postMessage({
      type: "progress",
      payload: {
        phase: "download",
        progress: total > 0 ? (current / total) * 100 : 0,
        detail:
          total > 0 ? { current, total, unit: "bytes" as const } : undefined,
        id,
      },
    });
  });

  session = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
    enableCpuMemArena: true,
  });
}

function preprocessForDDColor(imageData: ImageData) {
  const data = imageData.data;
  const chw = new Float32Array(MODEL_SIZE * MODEL_SIZE * 3);
  const plane = MODEL_SIZE * MODEL_SIZE;

  for (let y = 0; y < MODEL_SIZE; y++) {
    for (let x = 0; x < MODEL_SIZE; x++) {
      const src = (y * MODEL_SIZE + x) * 4;
      const dst = y * MODEL_SIZE + x;
      const [l] = rgbToLab(data[src], data[src + 1], data[src + 2]);
      const [r, g, b] = labToRgb(l, 0, 0);
      chw[dst] = r / 255;
      chw[plane + dst] = g / 255;
      chw[plane * 2 + dst] = b / 255;
    }
  }

  return chw;
}

function sampleChannelBilinear(
  data:
    | Float32Array
    | Float64Array
    | Uint16Array
    | Int32Array
    | BigInt64Array
    | BigUint64Array,
  channel: number,
  x: number,
  y: number,
) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, MODEL_SIZE - 1);
  const y1 = Math.min(y0 + 1, MODEL_SIZE - 1);
  const tx = x - x0;
  const ty = y - y0;
  const plane = MODEL_SIZE * MODEL_SIZE;
  const offset = channel * plane;
  const v00 = readTensorValue(data, offset + y0 * MODEL_SIZE + x0);
  const v10 = readTensorValue(data, offset + y0 * MODEL_SIZE + x1);
  const v01 = readTensorValue(data, offset + y1 * MODEL_SIZE + x0);
  const v11 = readTensorValue(data, offset + y1 * MODEL_SIZE + x1);
  const top = lerp(v00, v10, tx);
  const bottom = lerp(v01, v11, tx);
  return lerp(top, bottom, ty);
}

async function colorizeWithDDColor(
  imageBlob: Blob,
  options: ColorizeOptions,
  id: number,
) {
  await initSession(id);
  if (!session) throw new Error("Colorization model is not initialized");

  self.postMessage({ type: "phase", payload: { phase: "process", id } });
  self.postMessage({
    type: "progress",
    payload: { phase: "process", progress: 0, id },
  });

  const bitmap = await createImageBitmap(imageBlob);
  const modelCanvas = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE);
  const modelCtx = modelCanvas.getContext("2d");
  if (!modelCtx) throw new Error("Unable to create model input context");
  modelCtx.drawImage(bitmap, 0, 0, MODEL_SIZE, MODEL_SIZE);
  const inputImage = modelCtx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE);
  const input = new ort.Tensor("float32", preprocessForDDColor(inputImage), [
    1,
    3,
    MODEL_SIZE,
    MODEL_SIZE,
  ]);

  const inputName = session.inputNames[0] || "input";
  const outputName = session.outputNames[0];
  const result = await session.run({ [inputName]: input });
  const output = result[outputName] || Object.values(result)[0];
  if (!output) throw new Error("Colorization model returned no output");

  self.postMessage({
    type: "progress",
    payload: { phase: "process", progress: 62, id },
  });

  const resultCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const resultCtx = resultCanvas.getContext("2d");
  if (!resultCtx) throw new Error("Unable to create result context");
  const originalCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const originalCtx = originalCanvas.getContext("2d");
  if (!originalCtx) throw new Error("Unable to create original image context");
  originalCtx.drawImage(bitmap, 0, 0);

  const originalData = originalCtx.getImageData(
    0,
    0,
    bitmap.width,
    bitmap.height,
  );
  const colorData = resultCtx.createImageData(bitmap.width, bitmap.height);
  const tensorData = output.data as
    | Float32Array
    | Float64Array
    | Uint16Array
    | Int32Array
    | BigInt64Array
    | BigUint64Array;
  const strength = clamp(options.strength / 100);
  const saturationScale = clamp(options.saturation / 100, 0, 2);

  for (let y = 0; y < bitmap.height; y++) {
    const modelY =
      bitmap.height > 1 ? (y / (bitmap.height - 1)) * (MODEL_SIZE - 1) : 0;
    for (let x = 0; x < bitmap.width; x++) {
      const modelX =
        bitmap.width > 1 ? (x / (bitmap.width - 1)) * (MODEL_SIZE - 1) : 0;
      const dst = (y * bitmap.width + x) * 4;
      const originalR = originalData.data[dst];
      const originalG = originalData.data[dst + 1];
      const originalB = originalData.data[dst + 2];
      const [l] = rgbToLab(originalR, originalG, originalB);
      const abA = sampleChannelBilinear(tensorData, 0, modelX, modelY);
      const abB = sampleChannelBilinear(tensorData, 1, modelX, modelY);
      const [modelR, modelG, modelB] = labToRgb(
        l,
        abA * saturationScale,
        abB * saturationScale,
      );

      colorData.data[dst] = lerp(originalR, modelR, strength);
      colorData.data[dst + 1] = lerp(originalG, modelG, strength);
      colorData.data[dst + 2] = lerp(originalB, modelB, strength);
      colorData.data[dst + 3] = originalData.data[dst + 3];
    }
  }
  resultCtx.putImageData(colorData, 0, 0);

  bitmap.close();
  input.dispose();
  (output as unknown as { dispose?: () => void }).dispose?.();

  self.postMessage({
    type: "progress",
    payload: { phase: "process", progress: 100, id },
  });

  return resultCanvas.convertToBlob({ type: "image/png", quality: 1 });
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  try {
    if (type === "process") {
      const { imageBlob, options, id } = payload as ProcessPayload;
      self.postMessage({ type: "phase", payload: { phase: "process", id } });
      self.postMessage({
        type: "progress",
        payload: { phase: "process", progress: 0, id },
      });

      const resultBlob =
        options.mode === "ai"
          ? await colorizeWithDDColor(imageBlob, options, id)
          : await colorizeImage(imageBlob, options);
      const arrayBuffer = await resultBlob.arrayBuffer();

      self.postMessage(
        {
          type: "result",
          payload: { arrayBuffer, id },
        },
        { transfer: [arrayBuffer] },
      );
      return;
    }

    if (type === "dispose") {
      self.postMessage({ type: "disposed" });
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      payload: (error as Error).message || "Image colorization failed",
    });
  }
};
