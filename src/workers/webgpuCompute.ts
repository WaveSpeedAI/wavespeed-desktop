/**
 * WebGPU Compute Shaders for Image Processing
 * Provides GPU-accelerated versions of blur, morphological, and warp operations
 * with automatic CPU fallback when GPU is unavailable or fails
 */

let device: GPUDevice | null = null;
let initialized = false;

// Shader cache
const pipelineCache = new Map<string, GPUComputePipeline>();

// ============================================================================
// CPU Fallback Implementations
// ============================================================================

/**
 * CPU Gaussian blur implementation (separable)
 */
function gaussianBlurCPU(
  input: Float32Array,
  w: number,
  h: number,
  kernelSize: number,
): Float32Array {
  const half = Math.floor(kernelSize / 2);
  const sigma = kernelSize / 6;

  // Build Gaussian kernel
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -half; i <= half; i++) {
    const val = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(val);
    sum += val;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  // Horizontal pass
  const temp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let val = 0;
      for (let k = -half; k <= half; k++) {
        const nx = Math.max(0, Math.min(w - 1, x + k));
        val += input[y * w + nx] * kernel[k + half];
      }
      temp[y * w + x] = val;
    }
  }

  // Vertical pass
  const result = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let val = 0;
      for (let k = -half; k <= half; k++) {
        const ny = Math.max(0, Math.min(h - 1, y + k));
        val += temp[ny * w + x] * kernel[k + half];
      }
      result[y * w + x] = val;
    }
  }

  return result;
}

/**
 * CPU box blur implementation (separable)
 */
function boxBlurCPU(
  input: Float32Array,
  w: number,
  h: number,
  kernelSize: number,
): Float32Array {
  const half = Math.floor(kernelSize / 2);

  // Horizontal pass
  const temp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -half; k <= half; k++) {
        const nx = Math.max(0, Math.min(w - 1, x + k));
        sum += input[y * w + nx];
      }
      temp[y * w + x] = sum / kernelSize;
    }
  }

  // Vertical pass
  const result = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -half; k <= half; k++) {
        const ny = Math.max(0, Math.min(h - 1, y + k));
        sum += temp[ny * w + x];
      }
      result[y * w + x] = sum / kernelSize;
    }
  }

  return result;
}

/**
 * CPU erosion implementation (separable min filter)
 */
function erodeMaskCPU(
  input: Float32Array,
  w: number,
  h: number,
  kernelSize: number,
): Float32Array {
  const half = Math.floor(kernelSize / 2);

  // Horizontal min
  const temp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let minVal = 255;
      for (let k = -half; k <= half; k++) {
        const nx = Math.max(0, Math.min(w - 1, x + k));
        minVal = Math.min(minVal, input[y * w + nx]);
      }
      temp[y * w + x] = minVal;
    }
  }

  // Vertical min
  const result = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let minVal = 255;
      for (let k = -half; k <= half; k++) {
        const ny = Math.max(0, Math.min(h - 1, y + k));
        minVal = Math.min(minVal, temp[ny * w + x]);
      }
      result[y * w + x] = minVal;
    }
  }

  return result;
}

/**
 * CPU dilation implementation (separable max filter)
 */
function dilateMaskCPU(
  input: Float32Array,
  w: number,
  h: number,
  kernelSize: number,
): Float32Array {
  const half = Math.floor(kernelSize / 2);

  // Horizontal max
  const temp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let maxVal = 0;
      for (let k = -half; k <= half; k++) {
        const nx = Math.max(0, Math.min(w - 1, x + k));
        maxVal = Math.max(maxVal, input[y * w + nx]);
      }
      temp[y * w + x] = maxVal;
    }
  }

  // Vertical max
  const result = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let maxVal = 0;
      for (let k = -half; k <= half; k++) {
        const ny = Math.max(0, Math.min(h - 1, y + k));
        maxVal = Math.max(maxVal, temp[ny * w + x]);
      }
      result[y * w + x] = maxVal;
    }
  }

  return result;
}

/**
 * CPU color matching implementation
 * Applies color shift to all pixels in CHW format
 */
function colorMatchCPU(
  input: Float32Array,
  colorShift: [number, number, number],
  faceSize: number,
): Float32Array {
  const result = new Float32Array(input.length);
  const totalPixels = faceSize * faceSize;

  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < totalPixels; i++) {
      const idx = c * totalPixels + i;
      result[idx] = Math.max(0, Math.min(1, input[idx] + colorShift[c]));
    }
  }

  return result;
}

// ============================================================================
// WebGPU Initialization
// ============================================================================

/**
 * Initialize WebGPU device
 */
export async function initWebGPU(): Promise<boolean> {
  if (initialized) return device !== null;

  try {
    if (!navigator.gpu) {
      console.log("WebGPU not supported");
      initialized = true;
      return false;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      console.log("No WebGPU adapter found");
      initialized = true;
      return false;
    }

    device = await adapter.requestDevice();
    initialized = true;
    console.log("WebGPU compute initialized");
    return true;
  } catch (e) {
    console.warn("WebGPU init failed:", e);
    initialized = true;
    return false;
  }
}

export function isWebGPUAvailable(): boolean {
  return device !== null;
}

/**
 * Separable Gaussian Blur (horizontal + vertical passes)
 */
const gaussianBlurShader = /* wgsl */ `
@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<uniform> params: vec4<u32>; // width, height, kernelSize, pass (0=horiz, 1=vert)
@group(0) @binding(3) var<storage, read> kernel: array<f32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = params.x;
  let h = params.y;
  let kernelSize = params.z;
  let direction = params.w;
  let half = i32(kernelSize / 2u);

  let idx = gid.x;
  if (idx >= w * h) { return; }

  let x = i32(idx % w);
  let y = i32(idx / w);

  var sum: f32 = 0.0;

  if (direction == 0u) {
    // Horizontal pass
    for (var k: i32 = -half; k <= half; k++) {
      let nx = clamp(x + k, 0, i32(w) - 1);
      sum += input[u32(y) * w + u32(nx)] * kernel[u32(k + half)];
    }
  } else {
    // Vertical pass
    for (var k: i32 = -half; k <= half; k++) {
      let ny = clamp(y + k, 0, i32(h) - 1);
      sum += input[u32(ny) * w + u32(x)] * kernel[u32(k + half)];
    }
  }

  output[idx] = sum;
}
`;

/**
 * Separable Box Blur
 */
const boxBlurShader = /* wgsl */ `
@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<uniform> params: vec4<u32>; // width, height, kernelSize, pass

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = params.x;
  let h = params.y;
  let kernelSize = params.z;
  let direction = params.w;
  let half = i32(kernelSize / 2u);

  let idx = gid.x;
  if (idx >= w * h) { return; }

  let x = i32(idx % w);
  let y = i32(idx / w);

  var sum: f32 = 0.0;

  if (direction == 0u) {
    for (var k: i32 = -half; k <= half; k++) {
      let nx = clamp(x + k, 0, i32(w) - 1);
      sum += input[u32(y) * w + u32(nx)];
    }
  } else {
    for (var k: i32 = -half; k <= half; k++) {
      let ny = clamp(y + k, 0, i32(h) - 1);
      sum += input[u32(ny) * w + u32(x)];
    }
  }

  output[idx] = sum / f32(kernelSize);
}
`;

/**
 * Separable Erosion (min filter)
 */
const erodeShader = /* wgsl */ `
@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<uniform> params: vec4<u32>; // width, height, kernelSize, pass

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = params.x;
  let h = params.y;
  let kernelSize = params.z;
  let direction = params.w;
  let half = i32(kernelSize / 2u);

  let idx = gid.x;
  if (idx >= w * h) { return; }

  let x = i32(idx % w);
  let y = i32(idx / w);

  var minVal: f32 = 255.0;

  if (direction == 0u) {
    for (var k: i32 = -half; k <= half; k++) {
      let nx = clamp(x + k, 0, i32(w) - 1);
      minVal = min(minVal, input[u32(y) * w + u32(nx)]);
    }
  } else {
    for (var k: i32 = -half; k <= half; k++) {
      let ny = clamp(y + k, 0, i32(h) - 1);
      minVal = min(minVal, input[u32(ny) * w + u32(x)]);
    }
  }

  output[idx] = minVal;
}
`;

/**
 * Separable Dilation (max filter)
 */
const dilateShader = /* wgsl */ `
@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<uniform> params: vec4<u32>; // width, height, kernelSize, pass

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = params.x;
  let h = params.y;
  let kernelSize = params.z;
  let direction = params.w;
  let half = i32(kernelSize / 2u);

  let idx = gid.x;
  if (idx >= w * h) { return; }

  let x = i32(idx % w);
  let y = i32(idx / w);

  var maxVal: f32 = 0.0;

  if (direction == 0u) {
    for (var k: i32 = -half; k <= half; k++) {
      let nx = clamp(x + k, 0, i32(w) - 1);
      maxVal = max(maxVal, input[u32(y) * w + u32(nx)]);
    }
  } else {
    for (var k: i32 = -half; k <= half; k++) {
      let ny = clamp(y + k, 0, i32(h) - 1);
      maxVal = max(maxVal, input[u32(ny) * w + u32(x)]);
    }
  }

  output[idx] = maxVal;
}
`;

/**
 * Inverse warp and blend shader
 * Combines face warping, mask creation, and blending in one pass
 */
const inverseWarpBlendShader = /* wgsl */ `
struct Params {
  imgW: u32,
  imgH: u32,
  bx0: u32,
  by0: u32,
  bw: u32,
  bh: u32,
  faceSize: u32,
  _pad: u32,
  matrix: array<f32, 6>,
}

@group(0) @binding(0) var<storage, read> originalImage: array<f32>;
@group(0) @binding(1) var<storage, read> swappedFace: array<f32>; // CHW format
@group(0) @binding(2) var<storage, read> blendMask: array<f32>;
@group(0) @binding(3) var<storage, read_write> result: array<f32>;
@group(0) @binding(4) var<uniform> params: Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let bw = params.bw;
  let bh = params.bh;
  let imgW = params.imgW;
  let faceSize = params.faceSize;

  let idx = gid.x;
  if (idx >= bw * bh) { return; }

  let bx = idx % bw;
  let by = idx / bw;
  let x = bx + params.bx0;
  let y = by + params.by0;

  let alpha = blendMask[idx];

  if (alpha > 0.0) {
    // Transform to face coordinates
    let faceX = params.matrix[0] * f32(x) + params.matrix[1] * f32(y) + params.matrix[2];
    let faceY = params.matrix[3] * f32(x) + params.matrix[4] * f32(y) + params.matrix[5];

    if (faceX >= 0.0 && faceX < f32(faceSize) && faceY >= 0.0 && faceY < f32(faceSize)) {
      let fx0 = u32(floor(faceX));
      let fy0 = u32(floor(faceY));
      let fx1 = min(fx0 + 1u, faceSize - 1u);
      let fy1 = min(fy0 + 1u, faceSize - 1u);
      let xFrac = faceX - f32(fx0);
      let yFrac = faceY - f32(fy0);

      // Bilinear interpolation for each channel (CHW to HWC)
      for (var c: u32 = 0u; c < 3u; c++) {
        let v00 = swappedFace[c * faceSize * faceSize + fy0 * faceSize + fx0];
        let v10 = swappedFace[c * faceSize * faceSize + fy0 * faceSize + fx1];
        let v01 = swappedFace[c * faceSize * faceSize + fy1 * faceSize + fx0];
        let v11 = swappedFace[c * faceSize * faceSize + fy1 * faceSize + fx1];
        let v0 = v00 * (1.0 - xFrac) + v10 * xFrac;
        let v1 = v01 * (1.0 - xFrac) + v11 * xFrac;
        let fakeVal = clamp(v0 * (1.0 - yFrac) + v1 * yFrac, 0.0, 1.0);

        let dstIdx = (y * imgW + x) * 3u + c;
        let origVal = originalImage[dstIdx];
        result[dstIdx] = alpha * fakeVal + (1.0 - alpha) * origVal;
      }
    }
  }
}
`;

function getOrCreatePipeline(
  name: string,
  shaderCode: string,
): GPUComputePipeline {
  if (!device) throw new Error("WebGPU not initialized");

  let pipeline = pipelineCache.get(name);
  if (!pipeline) {
    const shaderModule = device.createShaderModule({ code: shaderCode });
    pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: shaderModule, entryPoint: "main" },
    });
    pipelineCache.set(name, pipeline);
  }
  return pipeline;
}

/**
 * Run a separable filter (blur, erode, dilate)
 */
async function runSeparableFilter(
  input: Float32Array,
  w: number,
  h: number,
  kernelSize: number,
  shaderCode: string,
  pipelineName: string,
  kernel?: Float32Array,
): Promise<Float32Array> {
  if (!device) throw new Error("WebGPU not initialized");

  const pipeline = getOrCreatePipeline(pipelineName, shaderCode);
  const size = w * h;

  // Create buffers
  const inputBuffer = device.createBuffer({
    size: size * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const tempBuffer = device.createBuffer({
    size: size * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const outputBuffer = device.createBuffer({
    size: size * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const paramsBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const resultBuffer = device.createBuffer({
    size: size * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  // Kernel buffer for Gaussian blur
  let kernelBuffer: GPUBuffer | null = null;
  if (kernel) {
    kernelBuffer = device.createBuffer({
      size: kernel.length * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(kernelBuffer, 0, new Float32Array(kernel));
  }

  device.queue.writeBuffer(inputBuffer, 0, new Float32Array(input));

  const workgroups = Math.ceil(size / 256);

  // Horizontal pass
  device.queue.writeBuffer(
    paramsBuffer,
    0,
    new Uint32Array([w, h, kernelSize, 0]),
  );

  let bindGroupEntries: GPUBindGroupEntry[] = [
    { binding: 0, resource: { buffer: inputBuffer } },
    { binding: 1, resource: { buffer: tempBuffer } },
    { binding: 2, resource: { buffer: paramsBuffer } },
  ];
  if (kernelBuffer) {
    bindGroupEntries.push({ binding: 3, resource: { buffer: kernelBuffer } });
  }

  const bindGroup1 = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: bindGroupEntries,
  });

  let encoder = device.createCommandEncoder();
  let pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup1);
  pass.dispatchWorkgroups(workgroups);
  pass.end();
  device.queue.submit([encoder.finish()]);

  // Vertical pass
  device.queue.writeBuffer(
    paramsBuffer,
    0,
    new Uint32Array([w, h, kernelSize, 1]),
  );

  bindGroupEntries = [
    { binding: 0, resource: { buffer: tempBuffer } },
    { binding: 1, resource: { buffer: outputBuffer } },
    { binding: 2, resource: { buffer: paramsBuffer } },
  ];
  if (kernelBuffer) {
    bindGroupEntries.push({ binding: 3, resource: { buffer: kernelBuffer } });
  }

  const bindGroup2 = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: bindGroupEntries,
  });

  encoder = device.createCommandEncoder();
  pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup2);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  // Copy result
  encoder.copyBufferToBuffer(outputBuffer, 0, resultBuffer, 0, size * 4);
  device.queue.submit([encoder.finish()]);

  // Read back
  await resultBuffer.mapAsync(GPUMapMode.READ);
  const result = new Float32Array(resultBuffer.getMappedRange().slice(0));
  resultBuffer.unmap();

  // Cleanup
  inputBuffer.destroy();
  tempBuffer.destroy();
  outputBuffer.destroy();
  paramsBuffer.destroy();
  resultBuffer.destroy();
  kernelBuffer?.destroy();

  return result;
}

// ============================================================================
// GPU Implementation Functions (internal)
// ============================================================================

/**
 * GPU Gaussian blur implementation
 */
async function gaussianBlurGPUImpl(
  mask: Float32Array,
  w: number,
  h: number,
  kernelSize: number,
): Promise<Float32Array> {
  const half = Math.floor(kernelSize / 2);
  const sigma = kernelSize / 6;

  // Build Gaussian kernel
  const kernel = new Float32Array(kernelSize);
  let sum = 0;
  for (let i = -half; i <= half; i++) {
    const val = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + half] = val;
    sum += val;
  }
  for (let i = 0; i < kernelSize; i++) kernel[i] /= sum;

  return runSeparableFilter(
    mask,
    w,
    h,
    kernelSize,
    gaussianBlurShader,
    "gaussianBlur",
    kernel,
  );
}

/**
 * GPU box blur implementation
 */
async function boxBlurGPUImpl(
  mask: Float32Array,
  w: number,
  h: number,
  kernelSize: number,
): Promise<Float32Array> {
  return runSeparableFilter(mask, w, h, kernelSize, boxBlurShader, "boxBlur");
}

/**
 * GPU erosion implementation
 */
async function erodeMaskGPUImpl(
  mask: Float32Array,
  w: number,
  h: number,
  kernelSize: number,
): Promise<Float32Array> {
  return runSeparableFilter(mask, w, h, kernelSize, erodeShader, "erode");
}

/**
 * GPU dilation implementation
 */
async function dilateMaskGPUImpl(
  mask: Float32Array,
  w: number,
  h: number,
  kernelSize: number,
): Promise<Float32Array> {
  return runSeparableFilter(mask, w, h, kernelSize, dilateShader, "dilate");
}

// ============================================================================
// Public API with Automatic CPU Fallback
// ============================================================================

/**
 * Gaussian blur with automatic CPU fallback
 * Always returns a valid result - uses GPU when available, otherwise CPU
 */
export async function gaussianBlur(
  mask: Float32Array,
  w: number,
  h: number,
  kernelSize: number,
): Promise<Float32Array> {
  if (device) {
    try {
      return await gaussianBlurGPUImpl(mask, w, h, kernelSize);
    } catch (e) {
      console.warn("GPU gaussianBlur failed, using CPU fallback:", e);
    }
  }
  return gaussianBlurCPU(mask, w, h, kernelSize);
}

/**
 * Box blur with automatic CPU fallback
 * Always returns a valid result - uses GPU when available, otherwise CPU
 */
export async function boxBlur(
  mask: Float32Array,
  w: number,
  h: number,
  kernelSize: number,
): Promise<Float32Array> {
  if (device) {
    try {
      return await boxBlurGPUImpl(mask, w, h, kernelSize);
    } catch (e) {
      console.warn("GPU boxBlur failed, using CPU fallback:", e);
    }
  }
  return boxBlurCPU(mask, w, h, kernelSize);
}

/**
 * Erosion (shrink mask) with automatic CPU fallback
 * Always returns a valid result - uses GPU when available, otherwise CPU
 */
export async function erodeMask(
  mask: Float32Array,
  w: number,
  h: number,
  kernelSize: number,
): Promise<Float32Array> {
  if (device) {
    try {
      return await erodeMaskGPUImpl(mask, w, h, kernelSize);
    } catch (e) {
      console.warn("GPU erodeMask failed, using CPU fallback:", e);
    }
  }
  return erodeMaskCPU(mask, w, h, kernelSize);
}

/**
 * Dilation (expand mask) with automatic CPU fallback
 * Always returns a valid result - uses GPU when available, otherwise CPU
 */
export async function dilateMask(
  mask: Float32Array,
  w: number,
  h: number,
  kernelSize: number,
): Promise<Float32Array> {
  if (device) {
    try {
      return await dilateMaskGPUImpl(mask, w, h, kernelSize);
    } catch (e) {
      console.warn("GPU dilateMask failed, using CPU fallback:", e);
    }
  }
  return dilateMaskCPU(mask, w, h, kernelSize);
}

/**
 * GPU-accelerated inverse warp and blend
 */
export async function inverseWarpBlendGPU(
  originalImage: Float32Array,
  imgW: number,
  imgH: number,
  swappedFace: Float32Array,
  blendMask: Float32Array,
  matrix: number[],
  bx0: number,
  by0: number,
  bw: number,
  bh: number,
  faceSize: number,
): Promise<Float32Array> {
  if (!device) throw new Error("WebGPU not initialized");

  const pipeline = getOrCreatePipeline(
    "inverseWarpBlend",
    inverseWarpBlendShader,
  );

  const imgSize = imgW * imgH * 3;
  const faceDataSize = faceSize * faceSize * 3;
  const maskSize = bw * bh;

  // Create buffers
  const originalBuffer = device.createBuffer({
    size: imgSize * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const faceBuffer = device.createBuffer({
    size: faceDataSize * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const maskBuffer = device.createBuffer({
    size: maskSize * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const resultBuffer = device.createBuffer({
    size: imgSize * 4,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST,
  });
  const paramsBuffer = device.createBuffer({
    size: 64, // Params struct size
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const readbackBuffer = device.createBuffer({
    size: imgSize * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  // Write data
  device.queue.writeBuffer(originalBuffer, 0, new Float32Array(originalImage));
  device.queue.writeBuffer(faceBuffer, 0, new Float32Array(swappedFace));
  device.queue.writeBuffer(maskBuffer, 0, new Float32Array(blendMask));
  device.queue.writeBuffer(resultBuffer, 0, new Float32Array(originalImage)); // Start with original

  // Params: imgW, imgH, bx0, by0, bw, bh, faceSize, pad, matrix[6]
  const paramsData = new ArrayBuffer(64);
  const paramsU32 = new Uint32Array(paramsData, 0, 8);
  const paramsF32 = new Float32Array(paramsData, 32, 6);
  paramsU32[0] = imgW;
  paramsU32[1] = imgH;
  paramsU32[2] = bx0;
  paramsU32[3] = by0;
  paramsU32[4] = bw;
  paramsU32[5] = bh;
  paramsU32[6] = faceSize;
  paramsU32[7] = 0;
  for (let i = 0; i < 6; i++) paramsF32[i] = matrix[i];
  device.queue.writeBuffer(paramsBuffer, 0, paramsData);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: originalBuffer } },
      { binding: 1, resource: { buffer: faceBuffer } },
      { binding: 2, resource: { buffer: maskBuffer } },
      { binding: 3, resource: { buffer: resultBuffer } },
      { binding: 4, resource: { buffer: paramsBuffer } },
    ],
  });

  const workgroups = Math.ceil(maskSize / 256);

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  encoder.copyBufferToBuffer(resultBuffer, 0, readbackBuffer, 0, imgSize * 4);
  device.queue.submit([encoder.finish()]);

  // Read back
  await readbackBuffer.mapAsync(GPUMapMode.READ);
  const result = new Float32Array(readbackBuffer.getMappedRange().slice(0));
  readbackBuffer.unmap();

  // Cleanup
  originalBuffer.destroy();
  faceBuffer.destroy();
  maskBuffer.destroy();
  resultBuffer.destroy();
  paramsBuffer.destroy();
  readbackBuffer.destroy();

  return result;
}

/**
 * GPU color matching implementation
 * Applies color shift to all pixels in CHW format [0,1]
 */
async function colorMatchGPUImpl(
  swappedFace: Float32Array,
  colorShift: [number, number, number],
  faceSize: number,
): Promise<Float32Array> {
  if (!device) throw new Error("WebGPU not initialized");

  const shaderCode = `
@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<uniform> params: vec4<f32>; // shiftR, shiftG, shiftB, faceSize

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let faceSize = u32(params.w);
  let totalPixels = faceSize * faceSize;
  let idx = gid.x;

  if (idx >= totalPixels) {
    return;
  }

  // Apply color shift to each channel
  let shift = vec3<f32>(params.x, params.y, params.z);

  for (var c = 0u; c < 3u; c = c + 1u) {
    let srcIdx = c * totalPixels + idx;
    output[srcIdx] = clamp(input[srcIdx] + shift[c], 0.0, 1.0);
  }
}
`;

  const cacheKey = "colorMatch";
  let pipeline = pipelineCache.get(cacheKey);
  if (!pipeline) {
    const shaderModule = device.createShaderModule({ code: shaderCode });
    pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: shaderModule, entryPoint: "main" },
    });
    pipelineCache.set(cacheKey, pipeline);
  }

  const totalSize = faceSize * faceSize * 3;

  const inputBuffer = device.createBuffer({
    size: totalSize * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const outputBuffer = device.createBuffer({
    size: totalSize * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const paramsBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const readbackBuffer = device.createBuffer({
    size: totalSize * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  device.queue.writeBuffer(inputBuffer, 0, new Float32Array(swappedFace));
  device.queue.writeBuffer(
    paramsBuffer,
    0,
    new Float32Array([colorShift[0], colorShift[1], colorShift[2], faceSize]),
  );

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: inputBuffer } },
      { binding: 1, resource: { buffer: outputBuffer } },
      { binding: 2, resource: { buffer: paramsBuffer } },
    ],
  });

  const workgroups = Math.ceil((faceSize * faceSize) / 256);
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  encoder.copyBufferToBuffer(outputBuffer, 0, readbackBuffer, 0, totalSize * 4);
  device.queue.submit([encoder.finish()]);

  await readbackBuffer.mapAsync(GPUMapMode.READ);
  const result = new Float32Array(readbackBuffer.getMappedRange().slice(0));
  readbackBuffer.unmap();

  inputBuffer.destroy();
  outputBuffer.destroy();
  paramsBuffer.destroy();
  readbackBuffer.destroy();

  return result;
}

/**
 * Color matching with automatic CPU fallback
 * Applies color shift to all pixels in CHW format [0,1]
 * Always returns a valid result - uses GPU when available, otherwise CPU
 */
export async function colorMatch(
  swappedFace: Float32Array,
  colorShift: [number, number, number],
  faceSize: number,
): Promise<Float32Array> {
  if (device) {
    try {
      return await colorMatchGPUImpl(swappedFace, colorShift, faceSize);
    } catch (e) {
      console.warn("GPU colorMatch failed, using CPU fallback:", e);
    }
  }
  return colorMatchCPU(swappedFace, colorShift, faceSize);
}

/**
 * Dispose WebGPU resources
 */
export function disposeWebGPU(): void {
  pipelineCache.clear();
  device = null;
  initialized = false;
}
