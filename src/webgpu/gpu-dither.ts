/**
 * WebGPU High-Performance Hardware-Accelerated Dithering & Tonal Compute Pipeline
 * Implements WGSL compute shaders for parallel point-process dithering (Blue Noise, Bayer 2x2/4x4/8x8,
 * Halftone Rotated Dot Screen, Tonal LUT, and Thresholding).
 */

export interface WebGpuProcessParams {
  width: number;
  height: number;
  // Tonal
  brightness: number;
  contrast: number;
  gamma: number;
  blackPoint: number;
  whitePoint: number;
  saturation: number;
  temperature: number;
  tint: number;
  // Dither
  algorithm: string;
  threshold: number;
  matrixScale: number;
  dotAngle: number;
  invertedBurn: boolean;
}

const COMPUTE_SHADER_WGSL = `
struct Params {
  width: u32,
  height: u32,
  brightness: f32,
  contrast: f32,
  gamma: f32,
  blackPoint: f32,
  whitePoint: f32,
  saturation: f32,
  temperature: f32,
  tint: f32,
  threshold: f32,
  matrixScale: u32,
  dotAngle: f32,
  invertedBurn: u32,
  algorithmCode: u32, // 0=none, 1=blue-noise, 2=bayer-2, 3=bayer-4, 4=bayer-8, 5=halftone
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputPixels: array<u32>;
@group(0) @binding(2) var<storage, read_write> outputPixels: array<u32>;

fn get_bayer_4(x: u32, y: u32) -> f32 {
  let b = array<u32, 16>(
    0u, 8u, 2u, 10u,
    12u, 4u, 14u, 6u,
    3u, 11u, 1u, 9u,
    15u, 7u, 13u, 5u
  );
  let bx = (x / params.matrixScale) % 4u;
  let by = (y / params.matrixScale) % 4u;
  return (f32(b[by * 4u + bx]) + 0.5) * (255.0 / 16.0);
}

fn get_bayer_2(x: u32, y: u32) -> f32 {
  let b = array<u32, 4>(0u, 2u, 3u, 1u);
  let bx = (x / params.matrixScale) % 2u;
  let by = (y / params.matrixScale) % 2u;
  return (f32(b[by * 2u + bx]) + 0.5) * (255.0 / 4.0);
}

fn get_bayer_8(x: u32, y: u32) -> f32 {
  let b = array<u32, 64>(
    0u, 32u, 8u, 40u, 2u, 34u, 10u, 42u,
    48u, 16u, 56u, 24u, 50u, 18u, 58u, 26u,
    12u, 44u, 4u, 36u, 14u, 46u, 6u, 38u,
    60u, 28u, 52u, 20u, 62u, 30u, 54u, 22u,
    3u, 35u, 11u, 43u, 1u, 33u, 9u, 41u,
    51u, 19u, 59u, 27u, 49u, 17u, 57u, 25u,
    15u, 47u, 7u, 39u, 13u, 45u, 5u, 37u,
    63u, 31u, 55u, 23u, 61u, 29u, 53u, 21u
  );
  let bx = (x / params.matrixScale) % 8u;
  let by = (y / params.matrixScale) % 8u;
  return (f32(b[by * 8u + bx]) + 0.5) * (255.0 / 64.0);
}

fn get_blue_noise(x: u32, y: u32) -> f32 {
  let mx = (x / params.matrixScale) % 64u;
  let my = (y / params.matrixScale) % 64u;
  let h = f32(((mx * 183613753u) ^ (my * 314159265u)) % 65536u) / 65536.0;
  return h * 255.0;
}

fn get_halftone(x: u32, y: u32) -> f32 {
  let rad = params.dotAngle * 3.14159265 / 180.0;
  let cosA = cos(rad);
  let sinA = sin(rad);
  let period = max(2.0, f32(params.matrixScale) * 6.0);
  let halfP = period / 2.0;

  let xf = f32(x);
  let yf = f32(y);
  let rx = xf * cosA - yf * sinA;
  let ry = xf * sinA + yf * cosA;

  let cx = abs(((rx % period) + period) % period - halfP) / halfP;
  let cy = abs(((ry % period) + period) % period - halfP) / halfP;
  let dist = sqrt(cx * cx + cy * cy);
  return min(255.0, dist * 255.0 * 0.9);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = global_id.x;
  let y = global_id.y;

  if (x >= params.width || y >= params.height) {
    return;
  }

  let idx = y * params.width + x;
  let pixel = inputPixels[idx];

  var r = f32(pixel & 0xFFu);
  var g = f32((pixel >> 8u) & 0xFFu);
  var b = f32((pixel >> 16u) & 0xFFu);
  let a = (pixel >> 24u) & 0xFFu;

  // 1. Tonal & Levels Mapping
  let bp = params.blackPoint;
  let wp = max(params.whitePoint, bp + 1.0);
  let contrastF = select((params.contrast + 100.0) / 100.0, 1.0 + (params.contrast / 100.0) * 2.5, params.contrast >= 0.0);
  let invGamma = 1.0 / max(0.01, params.gamma);

  // Apply per-channel LUT formula
  var channels = vec3<f32>(r, g, b);
  for (var c = 0u; c < 3u; c = c + 1u) {
    var v = (clamp(channels[c], bp, wp) - bp) / (wp - bp);
    v = pow(v, invGamma);
    channels[c] = clamp((v * 255.0 - 128.0) * contrastF + 128.0 + params.brightness * 1.28, 0.0, 255.0);
  }
  r = channels.x;
  g = channels.y;
  b = channels.z;

  // 2. Color Balance
  let tempK = params.temperature / 100.0;
  let tintK = params.tint / 100.0;
  let satFactor = select((params.saturation + 100.0) / 100.0, 1.0 + (params.saturation / 100.0) * 2.0, params.saturation >= 0.0);

  if (tempK != 0.0) {
    r = clamp(r + tempK * 60.0, 0.0, 255.0);
    b = clamp(b - tempK * 60.0, 0.0, 255.0);
  }
  if (tintK != 0.0) {
    g = clamp(g + tintK * 50.0, 0.0, 255.0);
  }
  if (satFactor != 1.0) {
    let gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = clamp(gray + (r - gray) * satFactor, 0.0, 255.0);
    g = clamp(gray + (g - gray) * satFactor, 0.0, 255.0);
    b = clamp(gray + (b - gray) * satFactor, 0.0, 255.0);
  }

  // 3. Dithering
  let grayIntensity = 0.299 * r + 0.587 * g + 0.114 * b;

  if (params.algorithmCode == 0u) {
    // Continuous tone
    let ir = u32(round(r));
    let ig = u32(round(g));
    let ib = u32(round(b));
    outputPixels[idx] = ir | (ig << 8u) | (ib << 16u) | (a << 24u);
    return;
  }

  let bias = params.threshold - 128.0;
  var matrixThresh = 128.0;
  if (params.algorithmCode == 1u) {
    matrixThresh = get_blue_noise(x, y);
  } else if (params.algorithmCode == 2u) {
    matrixThresh = get_bayer_2(x, y);
  } else if (params.algorithmCode == 3u) {
    matrixThresh = get_bayer_4(x, y);
  } else if (params.algorithmCode == 4u) {
    matrixThresh = get_bayer_8(x, y);
  } else if (params.algorithmCode == 5u) {
    matrixThresh = get_halftone(x, y);
  }

  let isLight = (grayIntensity - bias) >= matrixThresh;
  let fg = select(0u, 255u, params.invertedBurn == 1u);
  let bg = select(255u, 0u, params.invertedBurn == 1u);
  let finalByte = select(fg, bg, isLight);

  outputPixels[idx] = finalByte | (finalByte << 8u) | (finalByte << 16u) | (a << 24u);
}
`;

export class WebGpuEngine {
  private device: GPUDevice | null = null;
  private pipeline: GPUComputePipeline | null = null;
  private isSupported: boolean | null = null;

  public async init(): Promise<boolean> {
    if (this.isSupported !== null) return this.isSupported;

    try {
      if (typeof navigator === 'undefined' || !navigator.gpu) {
        this.isSupported = false;
        return false;
      }

      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) {
        this.isSupported = false;
        return false;
      }

      this.device = await adapter.requestDevice();
      const module = this.device.createShaderModule({
        code: COMPUTE_SHADER_WGSL,
      });

      this.pipeline = await this.device.createComputePipelineAsync({
        layout: 'auto',
        compute: {
          module,
          entryPoint: 'main',
        },
      });

      this.isSupported = true;
      return true;
    } catch (e) {
      console.warn('WebGPU initialization failed, falling back to WebAssembly:', e);
      this.isSupported = false;
      return false;
    }
  }

  public canHandleAlgorithm(algo: string): boolean {
    return ['none', 'blue-noise', 'bayer-2', 'bayer-4', 'bayer-8', 'halftone-dot'].includes(algo);
  }

  public async process(
    inputBuffer: ArrayBuffer,
    params: WebGpuProcessParams
  ): Promise<ArrayBuffer | null> {
    if (!this.device || !this.pipeline) return null;

    const { width, height } = params;
    const totalPixels = width * height;
    const byteSize = totalPixels * 4;

    // Algorithm mapping
    const algoMap: Record<string, number> = {
      none: 0,
      'blue-noise': 1,
      'bayer-2': 2,
      'bayer-4': 3,
      'bayer-8': 4,
      'halftone-dot': 5,
    };
    const algorithmCode = algoMap[params.algorithm] ?? 0;

    // Uniform buffer (16 u32/f32 fields = 64 bytes)
    const uniformArray = new ArrayBuffer(64);
    const uView = new DataView(uniformArray);
    uView.setUint32(0, width, true);
    uView.setUint32(4, height, true);
    uView.setFloat32(8, params.brightness, true);
    uView.setFloat32(12, params.contrast, true);
    uView.setFloat32(16, params.gamma, true);
    uView.setFloat32(20, params.blackPoint, true);
    uView.setFloat32(24, params.whitePoint, true);
    uView.setFloat32(28, params.saturation, true);
    uView.setFloat32(32, params.temperature, true);
    uView.setFloat32(36, params.tint, true);
    uView.setFloat32(40, params.threshold, true);
    uView.setUint32(44, Math.max(1, params.matrixScale), true);
    uView.setFloat32(48, params.dotAngle, true);
    uView.setUint32(52, params.invertedBurn ? 1 : 0, true);
    uView.setUint32(56, algorithmCode, true);

    const uniformBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

    const inputStorageBuffer = this.device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(inputStorageBuffer, 0, inputBuffer);

    const outputStorageBuffer = this.device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const readbackBuffer = this.device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: inputStorageBuffer } },
        { binding: 2, resource: { buffer: outputStorageBuffer } },
      ],
    });

    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
    passEncoder.end();

    commandEncoder.copyBufferToBuffer(outputStorageBuffer, 0, readbackBuffer, 0, byteSize);
    this.device.queue.submit([commandEncoder.finish()]);

    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const copy = readbackBuffer.getMappedRange().slice(0);
    readbackBuffer.unmap();

    // Clean up GPU allocations
    uniformBuffer.destroy();
    inputStorageBuffer.destroy();
    outputStorageBuffer.destroy();
    readbackBuffer.destroy();

    return copy;
  }
}
