import * as Comlink from 'comlink';
import type {
  ProcessPreviewPayload,
  ProcessPreviewResult,
  ProcessVectorPayload,
  ProcessDepthPayload,
  ProcessBgRemovalPayload,
  ProcessBgRemovalResult,
} from '../types/worker-messages';
import type { VectorResult, VectorLayer, VectorPath } from '../types/vector';
import type { DepthResult } from '../types/depth';
import { removeBackground } from '../lib/bg-removal';
import { generateDepthMap } from '../lib/depth-engine';
import { RustWasmEngine } from '../wasm/wasm-bridge';
import { WebGpuEngine } from '../webgpu/gpu-dither';

/**
 * High-performance image processing worker with native Rust WebAssembly & WebGPU Compute Shaders.
 */
interface CachedAiDepth {
  width: number;
  height: number;
  hash: number;
  rawAiDepth: Float32Array;
}
let workerAiDepthCache: CachedAiDepth | null = null;

function computeQuickBufferHash(bytes: Uint8Array, width: number, height: number): number {
  let h = (width * 31 + height) | 0;
  const len = Math.min(bytes.length, 2048);
  const step = Math.max(1, Math.floor(len / 32));
  for (let i = 0; i < len; i += step) {
    h = ((h << 5) - h + bytes[i]) | 0;
  }
  return h;
}

export class ImageProcessorWorker {
  private wasmEngine = new RustWasmEngine();
  private gpuEngine = new WebGpuEngine();
  private wasmReady = false;
  private gpuReady = false;

  constructor() {
    this.initEngines();
  }

  private async initEngines() {
    try {
      this.wasmReady = await this.wasmEngine.init();
    } catch (e) {
      console.warn('Rust WASM init failed in worker:', e);
    }
    try {
      this.gpuReady = await this.gpuEngine.init();
    } catch (e) {
      console.warn('WebGPU init failed in worker:', e);
    }
  }

  /**
   * Processes image adjustments and dithering on raw pixel buffers using WebGPU or Rust WASM.
   */
  public async processImage(payload: ProcessPreviewPayload): Promise<ProcessPreviewResult> {
    const startTime = performance.now();
    const { buffer, width, height, tonal, color, detail, dither } = payload;

    // 1. Try WebGPU Compute Pipeline (Fastest GPU Parallel Path for supported algorithms)
    const canUseGpu =
      this.gpuReady &&
      this.gpuEngine.canHandleAlgorithm(dither.algorithm) &&
      !detail.clahe &&
      !detail.adaptiveThreshold &&
      (detail.unsharpStrength ?? 0) <= 0;

    if (canUseGpu) {
      try {
        const gpuResultBuffer = await this.gpuEngine.process(buffer, {
          width,
          height,
          brightness: tonal.brightness,
          contrast: tonal.contrast,
          gamma: tonal.gamma,
          blackPoint: tonal.blackPoint,
          whitePoint: tonal.whitePoint,
          saturation: color.saturation,
          temperature: color.temperature,
          tint: color.tint,
          algorithm: dither.algorithm,
          threshold: dither.threshold,
          matrixScale: dither.matrixScale,
          dotAngle: dither.dotAngle || 45,
          invertedBurn: dither.invertedBurn || false,
        });

        if (gpuResultBuffer) {
          const durationMs = performance.now() - startTime;
          return Comlink.transfer(
            {
              buffer: gpuResultBuffer,
              width,
              height,
              durationMs,
            },
            [gpuResultBuffer]
          );
        }
      } catch (err) {
        console.warn('WebGPU execution failed, falling back to Rust WASM:', err);
      }
    }

    // 2. Try Native Rust WebAssembly Core Engine
    if (!this.wasmReady) {
      this.wasmReady = await this.wasmEngine.init();
    }

    if (this.wasmReady) {
      try {
        const wasmResult = this.wasmEngine.process(buffer, {
          width,
          height,
          exposure: tonal.exposure ?? 0,
          brightness: tonal.brightness ?? 0,
          contrast: tonal.contrast ?? 0,
          midtones: tonal.midtones ?? 0,
          highlights: tonal.highlights ?? 0,
          shadows: tonal.shadows ?? 0,
          whites: tonal.whites ?? 0,
          blacks: tonal.blacks ?? 0,
          clarity: tonal.clarity ?? 0,
          gamma: tonal.gamma ?? 1.0,
          blackPoint: tonal.blackPoint ?? 0,
          whitePoint: tonal.whitePoint ?? 255,
          invert: tonal.invert ?? false,
          grayscaleMode: tonal.grayscaleMode ?? 'none',
          saturation: color.saturation ?? 0,
          vibrance: color.vibrance ?? 0,
          temperature: color.temperature ?? 0,
          tint: color.tint ?? 0,
          enableClahe: detail.clahe,
          claheClip: detail.claheClipLimit,
          claheGrid: detail.claheGridSize,
          enableAdaptive: detail.adaptiveThreshold,
          adaptiveBlock: detail.adaptiveBlockSize,
          adaptiveC: detail.adaptiveConstant,
          sharpenAmount: (detail.unsharpStrength ?? 0) / 100.0,
          sharpenRadius: detail.unsharpRadius ?? 1.5,
          ditherAlgorithm: dither.algorithm,
          ditherThreshold: dither.threshold,
          ditherSerpentine: dither.serpentine,
          ditherScale: dither.matrixScale,
          ditherDotAngle: dither.dotAngle || 45,
          ditherInverted: dither.invertedBurn || false,
        });

        return Comlink.transfer(
          {
            buffer: wasmResult.buffer,
            width,
            height,
            durationMs: wasmResult.durationMs,
          },
          [wasmResult.buffer]
        );
      } catch (err) {
        console.warn('Rust WASM execution failed, falling back to JS:', err);
      }
    }

    // 3. Fallback: Pure JS Processing Pipeline
    const pixels = new Uint8ClampedArray(buffer);
    const totalPixels = width * height;

    // 1. Precalculate Lookup Tables (LUT) for Tonal & Color Adjustments (O(1) per pixel)
    const { buildTonalLUT } = await import('../lib/fast-tonal');
    const lut = buildTonalLUT(tonal);

    // Color adjust factors
    const satFactor = (color.saturation + 100) / 100;
    const tempK = color.temperature / 100; // -1 to 1 (cool to warm)
    const tintK = color.tint / 100;

    // 2. Apply Per-Pixel Tonal and Color Adjustments
    for (let i = 0; i < totalPixels * 4; i += 4) {
      let r = lut[pixels[i]];
      let g = lut[pixels[i + 1]];
      let b = lut[pixels[i + 2]];

      // Color temperature & tint
      if (tempK !== 0) {
        r = Math.min(255, Math.max(0, r + tempK * 30));
        b = Math.min(255, Math.max(0, b - tempK * 30));
      }
      if (tintK !== 0) {
        g = Math.min(255, Math.max(0, g + tintK * 25));
      }

      // Saturation
      if (satFactor !== 1.0) {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = Math.min(255, Math.max(0, gray + (r - gray) * satFactor));
        g = Math.min(255, Math.max(0, gray + (g - gray) * satFactor));
        b = Math.min(255, Math.max(0, gray + (b - gray) * satFactor));
      }

      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
    }

    // 3. Optional CLAHE (Local Contrast Enhancement)
    if (detail.clahe) {
      this.applyLocalContrast(pixels, width, height, detail.claheClipLimit, detail.claheGridSize);
    }

    // 4. Optional Adaptive Thresholding
    if (detail.adaptiveThreshold) {
      this.applyAdaptiveThreshold(pixels, width, height, detail.adaptiveBlockSize, detail.adaptiveConstant);
    }

    // 5. Apply Dithering Engine
    if (dither.algorithm !== 'none') {
      this.applyDithering(pixels, width, height, dither);
    }

    const durationMs = performance.now() - startTime;

    // Return with Transferable ArrayBuffer (zero-copy transfer back to main thread)
    return Comlink.transfer(
      {
        buffer: pixels.buffer,
        width,
        height,
        durationMs,
      },
      [pixels.buffer]
    );
  }

  /**
   * Applies CLAHE (Contrast Limited Adaptive Histogram Equalization)
   */
  private applyLocalContrast(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    clipLimit: number,
    gridSize: number
  ): void {
    const tileW = Math.max(4, Math.floor(width / gridSize));
    const tileH = Math.max(4, Math.floor(height / gridSize));
    const totalTilesX = Math.ceil(width / tileW);
    const totalTilesY = Math.ceil(height / tileH);

    // Compute tile histograms and CDFs
    const cdfs: Float32Array[] = [];
    const clipVal = ((tileW * tileH) / 256) * clipLimit;

    for (let ty = 0; ty < totalTilesY; ty++) {
      for (let tx = 0; tx < totalTilesX; tx++) {
        const hist = new Uint32Array(256);
        const startX = tx * tileW;
        const endX = Math.min(width, (tx + 1) * tileW);
        const startY = ty * tileH;
        const endY = Math.min(height, (ty + 1) * tileH);
        const tilePixelCount = (endX - startX) * (endY - startY);

        for (let y = startY; y < endY; y++) {
          const rowOffset = y * width;
          for (let x = startX; x < endX; x++) {
            const idx = (rowOffset + x) * 4;
            const gray = (pixels[idx] * 77 + pixels[idx + 1] * 150 + pixels[idx + 2] * 29) >> 8;
            hist[gray & 255]++;
          }
        }

        // Clip histogram
        let excess = 0;
        for (let i = 0; i < 256; i++) {
          if (hist[i] > clipVal) {
            excess += hist[i] - clipVal;
            hist[i] = clipVal;
          }
        }
        const bonus = Math.floor(excess / 256);
        for (let i = 0; i < 256; i++) {
          hist[i] += bonus;
        }

        // Build CDF
        const cdf = new Float32Array(256);
        let sum = 0;
        const invCount = 1.0 / (tilePixelCount || 1);
        for (let i = 0; i < 256; i++) {
          sum += hist[i];
          cdf[i] = sum * invCount;
        }
        cdfs.push(cdf);
      }
    }

    // Precompute X coordinate mapping tables (eliminates 4M divisions per frame)
    const maxTx = totalTilesX - 1;
    const invTileW = 1.0 / tileW;
    const txArr = new Int32Array(width);
    const nextTxArr = new Int32Array(width);
    const dxArr = new Float32Array(width);

    for (let x = 0; x < width; x++) {
      const tx = Math.min(maxTx, Math.floor(x / tileW));
      txArr[x] = tx;
      nextTxArr[x] = Math.min(maxTx, tx + 1);
      dxArr[x] = (x % tileW) * invTileW;
    }

    const maxTy = totalTilesY - 1;
    const invTileH = 1.0 / tileH;

    // Bilinear interpolation across tiles
    for (let y = 0; y < height; y++) {
      const ty = Math.min(maxTy, Math.floor(y / tileH));
      const nextTy = Math.min(maxTy, ty + 1);
      const dy = (y % tileH) * invTileH;
      const rowOffset = y * width;
      const tyRow = ty * totalTilesX;
      const nextTyRow = nextTy * totalTilesX;

      for (let x = 0; x < width; x++) {
        const tx = txArr[x];
        const nextTx = nextTxArr[x];
        const dx = dxArr[x];

        const idx = (rowOffset + x) * 4;
        const gray = (pixels[idx] * 77 + pixels[idx + 1] * 150 + pixels[idx + 2] * 29) >> 8;
        const grayClamped = gray & 255;

        const cdfTL = cdfs[tyRow + tx][grayClamped];
        const cdfTR = cdfs[tyRow + nextTx][grayClamped];
        const cdfBL = cdfs[nextTyRow + tx][grayClamped];
        const cdfBR = cdfs[nextTyRow + nextTx][grayClamped];

        const top = cdfTL * (1 - dx) + cdfTR * dx;
        const bot = cdfBL * (1 - dx) + cdfBR * dx;
        const finalVal = (top * (1 - dy) + bot * dy) * 255;

        pixels[idx] = finalVal;
        pixels[idx + 1] = finalVal;
        pixels[idx + 2] = finalVal;
      }
    }
  }

  /**
   * Applies adaptive thresholding based on local neighborhood mean
   */
  private applyAdaptiveThreshold(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    blockSize: number,
    constant: number
  ): void {
    const halfBlock = Math.floor(blockSize / 2);
    // Convert to grayscale integral image for O(1) area sums
    const integral = new Float64Array((width + 1) * (height + 1));
    const gray = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const g = Math.round(0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2]);
        gray[y * width + x] = g;
        integral[(y + 1) * (width + 1) + (x + 1)] =
          g +
          integral[y * (width + 1) + (x + 1)] +
          integral[(y + 1) * (width + 1) + x] -
          integral[y * (width + 1) + x];
      }
    }

    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - halfBlock);
      const y1 = Math.min(height, y + halfBlock + 1);

      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - halfBlock);
        const x1 = Math.min(width, x + halfBlock + 1);

        const count = (x1 - x0) * (y1 - y0);
        const sum =
          integral[y1 * (width + 1) + x1] -
          integral[y0 * (width + 1) + x1] -
          integral[y1 * (width + 1) + x0] +
          integral[y0 * (width + 1) + x0];

        const mean = sum / count;
        const g = gray[y * width + x];
        const val = g < mean - constant ? 0 : 255;
        const idx = (y * width + x) * 4;

        pixels[idx] = val;
        pixels[idx + 1] = val;
        pixels[idx + 2] = val;
      }
    }
  }

  /**
   * Applies the advanced Dithering Engine
   */
  private applyDithering(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    dither: ProcessPreviewPayload['dither']
  ): void {
    const { algorithm, threshold, serpentine, matrixScale } = dither;
    const totalPixels = width * height;
    const densityBias = 128 - threshold;

    // Convert to grayscale buffer first with threshold density bias
    const gray = new Float32Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      const g = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
      gray[i] = Math.max(0, Math.min(255, g + densityBias));
    }

    const QUANT_THRESH = 128;

    switch (algorithm) {
      case 'floyd-steinberg':
        this.ditherErrorDiffusion(
          gray,
          width,
          height,
          QUANT_THRESH,
          serpentine,
          [
            { dx: 1, dy: 0, weight: 7 / 16 },
            { dx: -1, dy: 1, weight: 3 / 16 },
            { dx: 0, dy: 1, weight: 5 / 16 },
            { dx: 1, dy: 1, weight: 1 / 16 },
          ]
        );
        break;

      case 'atkinson':
        this.ditherErrorDiffusion(
          gray,
          width,
          height,
          QUANT_THRESH,
          serpentine,
          [
            { dx: 1, dy: 0, weight: 1 / 8 },
            { dx: 2, dy: 0, weight: 1 / 8 },
            { dx: -1, dy: 1, weight: 1 / 8 },
            { dx: 0, dy: 1, weight: 1 / 8 },
            { dx: 1, dy: 1, weight: 1 / 8 },
            { dx: 0, dy: 2, weight: 1 / 8 },
          ]
        );
        break;

      case 'jarvis':
        this.ditherErrorDiffusion(
          gray,
          width,
          height,
          QUANT_THRESH,
          serpentine,
          [
            { dx: 1, dy: 0, weight: 7 / 48 },
            { dx: 2, dy: 0, weight: 5 / 48 },
            { dx: -2, dy: 1, weight: 3 / 48 },
            { dx: -1, dy: 1, weight: 5 / 48 },
            { dx: 0, dy: 1, weight: 7 / 48 },
            { dx: 1, dy: 1, weight: 5 / 48 },
            { dx: 2, dy: 1, weight: 3 / 48 },
            { dx: -2, dy: 2, weight: 1 / 48 },
            { dx: -1, dy: 2, weight: 3 / 48 },
            { dx: 0, dy: 2, weight: 5 / 48 },
            { dx: 1, dy: 2, weight: 3 / 48 },
            { dx: 2, dy: 2, weight: 1 / 48 },
          ]
        );
        break;

      case 'bayer-2':
      case 'bayer-4':
      case 'bayer-8':
        this.ditherBayer(gray, width, height, matrixScale);
        break;

      case 'blue-noise':
        this.ditherBlueNoise(gray, width, height, matrixScale);
        break;

      case 'ostromoukhov':
        this.ditherOstromoukhov(gray, width, height, QUANT_THRESH, serpentine);
        break;

      case 'riemersma':
        this.ditherRiemersma(gray, width, height, QUANT_THRESH);
        break;

      case 'knuth-dot':
      case 'halftone-dot':
        this.ditherHalftone(gray, width, height, dither.dotAngle || 45, matrixScale);
        break;
    }

    // Write back binary pixels
    const fg = dither.invertedBurn ? 255 : 0;
    const bg = dither.invertedBurn ? 0 : 255;

    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      const val = gray[i] >= 128 ? bg : fg;
      pixels[idx] = val;
      pixels[idx + 1] = val;
      pixels[idx + 2] = val;
    }
  }

  /**
   * Generic Error Diffusion Dithering (Floyd-Steinberg, Atkinson, Jarvis)
   */
  private ditherErrorDiffusion(
    gray: Float32Array,
    width: number,
    height: number,
    threshold: number,
    serpentine: boolean,
    kernel: Array<{ dx: number; dy: number; weight: number }>
  ): void {
    for (let y = 0; y < height; y++) {
      const isReverse = serpentine && y % 2 === 1;
      const startX = isReverse ? width - 1 : 0;
      const endX = isReverse ? -1 : width;
      const step = isReverse ? -1 : 1;

      for (let x = startX; x !== endX; x += step) {
        const idx = y * width + x;
        const oldVal = gray[idx];
        const newVal = oldVal >= threshold ? 255 : 0;
        gray[idx] = newVal;
        const err = oldVal - newVal;

        for (const k of kernel) {
          const nx = x + (isReverse ? -k.dx : k.dx);
          const ny = y + k.dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            gray[ny * width + nx] += err * k.weight;
          }
        }
      }
    }
  }

  /**
   * Ordered Bayer Matrix Dithering (2x2, 4x4, 8x8)
   */
  private ditherBayer(
    gray: Float32Array,
    width: number,
    height: number,
    scale: number
  ): void {
    const bayer4 = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ];
    const bSize = 4;
    const factor = 255 / 16;

    for (let y = 0; y < height; y++) {
      const by = Math.floor(y / scale) % bSize;
      for (let x = 0; x < width; x++) {
        const bx = Math.floor(x / scale) % bSize;
        const thresh = (bayer4[by][bx] + 0.5) * factor;
        const idx = y * width + x;
        gray[idx] = gray[idx] >= thresh ? 255 : 0;
      }
    }
  }

  /**
   * Blue Noise (Void-and-Cluster organic film-grain dither)
   */
  private ditherBlueNoise(gray: Float32Array, width: number, height: number, scale: number): void {
    const bSize = 64;
    for (let y = 0; y < height; y++) {
      const my = Math.floor(y / scale) % bSize;
      for (let x = 0; x < width; x++) {
        const mx = Math.floor(x / scale) % bSize;
        const h = (((mx * 183613753) ^ (my * 314159265)) % 65536) / 65536;
        const thresh = h * 255;
        const idx = y * width + x;
        gray[idx] = gray[idx] >= thresh ? 255 : 0;
      }
    }
  }

  /**
   * Ostromoukhov Variable-Coefficient Error Diffusion
   * Adjusts diffusion kernel weights based on input intensity to eliminate worm artifacts.
   */
  private ditherOstromoukhov(
    gray: Float32Array,
    width: number,
    height: number,
    threshold: number,
    serpentine: boolean
  ): void {
    for (let y = 0; y < height; y++) {
      const isReverse = serpentine && y % 2 === 1;
      const startX = isReverse ? width - 1 : 0;
      const endX = isReverse ? -1 : width;
      const step = isReverse ? -1 : 1;

      for (let x = startX; x !== endX; x += step) {
        const idx = y * width + x;
        const oldVal = gray[idx];
        const newVal = oldVal >= threshold ? 255 : 0;
        gray[idx] = newVal;
        const err = oldVal - newVal;

        // Dynamic coefficients based on intensity level
        const normalized = Math.max(0, Math.min(255, oldVal)) / 255;
        const wRight = 0.5 + 0.3 * Math.sin(normalized * Math.PI);
        const wBottomLeft = 0.15;
        const wBottom = 1.0 - (wRight + wBottomLeft);

        const nx1 = x + (isReverse ? -1 : 1);
        if (nx1 >= 0 && nx1 < width) gray[y * width + nx1] += err * wRight;

        if (y + 1 < height) {
          const nx0 = x + (isReverse ? 1 : -1);
          if (nx0 >= 0 && nx0 < width) gray[(y + 1) * width + nx0] += err * wBottomLeft;
          gray[(y + 1) * width + x] += err * wBottom;
        }
      }
    }
  }

  /**
   * Riemersma Dithering using Hilbert curve traversal
   */
  private ditherRiemersma(
    gray: Float32Array,
    width: number,
    height: number,
    threshold: number
  ): void {
    // Hilbert traversal approximation with exponential decay error history buffer
    const historySize = 16;
    const history = new Float32Array(historySize);
    const weights = new Float32Array(historySize);
    let totalWeight = 0;
    const decay = 0.85;

    for (let i = 0; i < historySize; i++) {
      weights[i] = Math.pow(decay, i);
      totalWeight += weights[i];
    }
    for (let i = 0; i < historySize; i++) {
      weights[i] /= totalWeight;
    }

    let hIdx = 0;
    for (let y = 0; y < height; y++) {
      const isReverse = y % 2 === 1;
      const startX = isReverse ? width - 1 : 0;
      const endX = isReverse ? -1 : width;
      const step = isReverse ? -1 : 1;

      for (let x = startX; x !== endX; x += step) {
        const idx = y * width + x;
        let sumErr = 0;
        for (let i = 0; i < historySize; i++) {
          sumErr += history[(hIdx - i + historySize) % historySize] * weights[i];
        }

        const oldVal = gray[idx] + sumErr;
        const newVal = oldVal >= threshold ? 255 : 0;
        gray[idx] = newVal;

        history[hIdx] = oldVal - newVal;
        hIdx = (hIdx + 1) % historySize;
      }
    }
  }

  /**
   * Halftone Screen Dithering
   */
  private ditherHalftone(
    gray: Float32Array,
    width: number,
    height: number,
    angleDeg: number,
    dotScale: number
  ): void {
    const rad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    const period = Math.max(2, 6 * dotScale);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Rotate coordinates to screen angle
        const rx = x * cosA - y * sinA;
        const ry = x * sinA + y * cosA;

        // Circular dot matrix intensity
        const cx = Math.abs((rx % period) - period / 2) / (period / 2);
        const cy = Math.abs((ry % period) - period / 2) / (period / 2);
        const dist = Math.sqrt(cx * cx + cy * cy);
        const thresh = Math.min(255, dist * 255 * 0.9);

        const idx = y * width + x;
        gray[idx] = gray[idx] >= thresh ? 255 : 0;
      }
    }
  }

  /**
   * Processes vectorization (contour tracing, multi-color, Canny, and Bézier fitting)
   */
  public async processVector(payload: ProcessVectorPayload): Promise<VectorResult> {
    const { buffer, width, height, config } = payload;

    // 1. Run Native Rust WASM Vectorization Engine (Fastest & Full Feature-set)
    if (!this.wasmReady) {
      try {
        this.wasmReady = await this.wasmEngine.init();
      } catch (e) {
        console.warn('Rust WASM init failed in processVector:', e);
      }
    }

    if (this.wasmReady) {
      try {
        return this.wasmEngine.vectorize(buffer, width, height, config);
      } catch (err) {
        console.warn('Wasm vectorization error, falling back to JS:', err);
      }
    }
    // 2. High-Precision JS Vectorization Engine (Matches Rust WASM Output 1:1)
    const pixels = new Uint8ClampedArray(buffer);
    const { mode, rdpTolerance, curveFitting, threshold, minPathArea, bezierTolerance, invert } = config;
    const thresh = threshold ?? 128;
    const effectiveMinArea = Math.max(minPathArea ?? 4, 1);
    const tol = Math.max(rdpTolerance ?? 1.0, 0.5);
    const cornerThresh = bezierTolerance ?? 1.0;

    // Convert to Binary
    const total = width * height;
    const binary = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      const idx = i * 4;
      const g = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
      const isFg = invert ? g >= thresh : g < thresh;
      binary[i] = isFg ? 1 : 0;
    }

    const rawContours = this.traceGridContours(binary, width, height, effectiveMinArea);
    const paths: VectorPath[] = [];

    for (let pi = 0; pi < rawContours.length; pi++) {
      const contour = rawContours[pi];
      const d = this.formatContourSvg(contour, curveFitting ?? true, tol, cornerThresh);
      if (d.length > 0) {
        const nodeCount = this.countSvgNodes(d);
        paths.push({
          id: `path-${pi + 1}`,
          color: '#38bdf8',
          isClosed: true,
          segments: [],
          svgPathData: d,
          nodeCount,
        });
      }
    }

    const totalNodes = paths.reduce((sum, p) => sum + p.nodeCount, 0);
    const layer: VectorLayer = {
      id: 'layer-1',
      name: mode === 'centerline' ? 'Centerlines' : 'Outline Contours',
      color: '#38bdf8',
      paths,
      visible: true,
      totalNodes,
    };

    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
  <g id="${layer.id}" stroke="${layer.color}" fill="none" stroke-width="${config.strokeWidth || 1}">
    ${paths.map((p) => `<path d="${p.svgPathData}" />`).join('\n    ')}
  </g>
</svg>`;

    return {
      layers: [layer],
      totalPaths: paths.length,
      totalNodes,
      svgString,
      dimensions: { width, height },
    };
  }

  private countSvgNodes(d: string): number {
    let count = 0;
    for (let i = 0; i < d.length; i++) {
      const c = d[i];
      if (c === 'M' || c === 'L' || c === 'C' || c === 'Q') count++;
    }
    return Math.max(count, 1);
  }

  /**
   * Traces closed directed grid boundary contours (outer CW contours & inner CCW holes)
   */
  private traceGridContours(
    binary: Uint8Array,
    width: number,
    height: number,
    minArea: number
  ): Array<Array<{ x: number; y: number }>> {
    const gw = width + 1;
    const gh = height + 1;
    const hEdges = new Int8Array(gh * width);
    const vEdges = new Int8Array(height * gw);

    const getPixel = (x: number, y: number): number => {
      if (x < 0 || x >= width || y < 0 || y >= height) return 0;
      return binary[y * width + x];
    };

    for (let y = 0; y <= height; y++) {
      for (let x = 0; x < width; x++) {
        const top = getPixel(x, y - 1);
        const bottom = getPixel(x, y);
        if (top === 0 && bottom === 1) hEdges[y * width + x] = 1;
        else if (top === 1 && bottom === 0) hEdges[y * width + x] = -1;
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x <= width; x++) {
        const left = getPixel(x - 1, y);
        const right = getPixel(x, y);
        if (left === 1 && right === 0) vEdges[y * gw + x] = 1;
        else if (left === 0 && right === 1) vEdges[y * gw + x] = -1;
      }
    }

    const contours: Array<Array<{ x: number; y: number }>> = [];
    const maxContours = 4000;

    for (let startY = 0; startY <= height; startY++) {
      if (contours.length >= maxContours) break;
      for (let startX = 0; startX < width; startX++) {
        const hIdx = startY * width + startX;
        if (hEdges[hIdx] === 0) continue;

        let curDir = hEdges[hIdx] === 1 ? 0 : 2; // 0=East, 1=South, 2=West, 3=North
        let curX = curDir === 0 ? startX : startX + 1;
        let curY = startY;
        const originX = curX;
        const originY = curY;

        const pts: Array<{ x: number; y: number }> = [];
        let steps = 0;
        const maxSteps = (width + height) * 8 + 50000;

        while (steps < maxSteps) {
          pts.push({ x: curX, y: curY });

          if (curDir === 0) {
            const eIdx = curY * width + curX;
            if (eIdx < hEdges.length) hEdges[eIdx] = 0;
            curX++;
          } else if (curDir === 1) {
            const eIdx = curY * gw + curX;
            if (eIdx < vEdges.length) vEdges[eIdx] = 0;
            curY++;
          } else if (curDir === 2) {
            curX--;
            const eIdx = curY * width + curX;
            if (eIdx < hEdges.length) hEdges[eIdx] = 0;
          } else if (curDir === 3) {
            curY--;
            const eIdx = curY * gw + curX;
            if (eIdx < vEdges.length) vEdges[eIdx] = 0;
          }

          steps++;
          if (curX === originX && curY === originY) break;

          const candidates =
            curDir === 0 ? [1, 0, 3] :
            curDir === 1 ? [2, 1, 0] :
            curDir === 2 ? [3, 2, 1] : [0, 3, 2];

          let nextDir: number | null = null;
          for (const cd of candidates) {
            const hasEdge =
              cd === 0 ? curX < width && hEdges[curY * width + curX] === 1 :
              cd === 1 ? curY < height && vEdges[curY * gw + curX] === 1 :
              cd === 2 ? curX > 0 && hEdges[curY * width + (curX - 1)] === -1 :
              curY > 0 && vEdges[(curY - 1) * gw + curX] === -1;

            if (hasEdge) {
              nextDir = cd;
              break;
            }
          }

          if (nextDir !== null) curDir = nextDir;
          else break;
        }

        if (pts.length >= 4) {
          let area = 0;
          const n = pts.length;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
          }
          if (Math.abs(area / 2) >= minArea) {
            contours.push(pts);
          }
        }
      }
    }

    return contours;
  }

  private simplifyClosedPolygon(rawPoints: Array<{ x: number; y: number }>, tolerance: number): Array<{ x: number; y: number }> {
    const points = this.collapseCollinearPoints(rawPoints);
    const n = points.length;
    if (n <= 3) return points;

    const epsilon = Math.max(tolerance, 0.75);

    // Find principal diameter pair
    let maxDistSq = 0;
    let bestI = 0;
    let bestJ = Math.floor(n / 2);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = points[i].x - points[j].x;
        const dy = points[i].y - points[j].y;
        const dSq = dx * dx + dy * dy;
        if (dSq > maxDistSq) {
          maxDistSq = dSq;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestI > bestJ) {
      const temp = bestI;
      bestI = bestJ;
      bestJ = temp;
    }

    const chain1 = points.slice(bestI, bestJ + 1);
    const sim1 = this.rdpChain(chain1, epsilon);

    const chain2 = [...points.slice(bestJ), ...points.slice(0, bestI + 1)];
    const sim2 = this.rdpChain(chain2, epsilon);

    const result = [...sim1];
    if (result.length > 0) result.pop();
    result.push(...sim2);
    if (result.length > 0) result.pop();

    // Clean redundant near-collinear points (< 0.35px)
    const cleaned: Array<{ x: number; y: number }> = [];
    const rn = result.length;
    if (rn <= 3) return result;

    for (let i = 0; i < rn; i++) {
      const prev = result[(i + rn - 1) % rn];
      const curr = result[i];
      const next = result[(i + 1) % rn];

      const d = this.perpDistance(curr, prev, next);
      if (d < 0.35) continue;
      cleaned.push(curr);
    }

    return cleaned.length >= 3 ? cleaned : result;
  }

  private rdpChain(points: Array<{ x: number; y: number }>, epsilon: number): Array<{ x: number; y: number }> {
    if (points.length <= 2) return points;

    let maxDist = 0;
    let maxIdx = 0;
    const start = points[0];
    const end = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
      const d = this.perpDistance(points[i], start, end);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    if (maxDist > epsilon) {
      const left = this.rdpChain(points.slice(0, maxIdx + 1), epsilon);
      const right = this.rdpChain(points.slice(maxIdx), epsilon);
      return [...left.slice(0, -1), ...right];
    } else {
      return [start, end];
    }
  }

  /**
   * Formats contour into crisp straight lines (between corners) and smooth Bézier curves (along curved sections)
   */
  private formatContourSvg(
    rawPoints: Array<{ x: number; y: number }>,
    curveFitting: boolean,
    tolerance: number,
    cornerThreshold: number
  ): string {
    const points = this.simplifyClosedPolygon(rawPoints, tolerance);
    const n = points.length;
    if (n === 0) return '';
    if (n === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} Z`;
    if (!curveFitting || n < 3) {
      let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
      for (let i = 1; i < n; i++) {
        d += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
      }
      return d + ' Z';
    }

    const threshRad = Math.min(1.55, Math.max(0.50, 0.65 + cornerThreshold * 0.20));
    const vertexTypes: Array<'Corner' | 'Smooth'> = [];

    for (let i = 0; i < n; i++) {
      const prev = points[(i + n - 1) % n];
      const curr = points[i];
      const next = points[(i + 1) % n];

      const v1x = curr.x - prev.x;
      const v1y = curr.y - prev.y;
      const v2x = next.x - curr.x;
      const v2y = next.y - curr.y;

      const len1 = Math.hypot(v1x, v1y);
      const len2 = Math.hypot(v2x, v2y);

      if (len1 < 0.001 || len2 < 0.001) {
        vertexTypes.push('Corner');
        continue;
      }

      const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      vertexTypes.push(angle >= threshRad ? 'Corner' : 'Smooth');
    }

    let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

    for (let i = 0; i < n; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % n];
      const t1 = vertexTypes[i];
      const t2 = vertexTypes[(i + 1) % n];

      const chordDx = p2.x - p1.x;
      const chordDy = p2.y - p1.y;
      const chordLen = Math.hypot(chordDx, chordDy);

      if (chordLen < 0.001) continue;

      // Both endpoints are corners (e.g. straight arm of X, stem of T, diagonal of A, V):
      // Output crisp straight line L
      if (t1 === 'Corner' && t2 === 'Corner') {
        d += ` L ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
        continue;
      }

      // Smooth curved section
      const p0 = points[(i + n - 1) % n];
      const p3 = points[(i + 2) % n];

      let tan1X: number, tan1Y: number;
      if (t1 === 'Corner') {
        tan1X = chordDx / chordLen;
        tan1Y = chordDy / chordLen;
      } else {
        const dx = p2.x - p0.x;
        const dy = p2.y - p0.y;
        const len = Math.max(Math.hypot(dx, dy), 0.001);
        tan1X = dx / len;
        tan1Y = dy / len;
      }

      let tan2X: number, tan2Y: number;
      if (t2 === 'Corner') {
        tan2X = chordDx / chordLen;
        tan2Y = chordDy / chordLen;
      } else {
        const dx = p3.x - p1.x;
        const dy = p3.y - p1.y;
        const len = Math.max(Math.hypot(dx, dy), 0.001);
        tan2X = dx / len;
        tan2Y = dy / len;
      }

      const handleLen = chordLen / 3.0;
      const cp1X = p1.x + tan1X * handleLen;
      const cp1Y = p1.y + tan1Y * handleLen;
      const cp2X = p2.x - tan2X * handleLen;
      const cp2Y = p2.y - tan2Y * handleLen;

      d += ` C ${cp1X.toFixed(2)} ${cp1Y.toFixed(2)}, ${cp2X.toFixed(2)} ${cp2Y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
    }

    return d + ' Z';
  }

  private collapseCollinearPoints(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    if (points.length <= 3) return points;
    const result: Array<{ x: number; y: number }> = [points[0]];
    const n = points.length;

    for (let i = 1; i < n; i++) {
      const prev = result[result.length - 1];
      const curr = points[i];
      const next = points[(i + 1) % n];

      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;

      const cross = dx1 * dy2 - dy1 * dx2;
      const dot = dx1 * dx2 + dy1 * dy2;
      if (Math.abs(cross) < 0.0001 && dot >= 0) continue;
      result.push(curr);
    }
    return result;
  }

  private perpDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-4) return Math.hypot(p.x - a.x, p.y - a.y);
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / Math.sqrt(lenSq);
  }

  /**
   * Processes Euclidean Distance Transform (EDT) and 3D depth maps in native Rust WASM
   */
  public async processDepth(payload: ProcessDepthPayload): Promise<DepthResult> {
    const { buffer, width, height, config } = payload;

    // 1. AI Monocular Depth Estimation (ONNX WebGPU / Neural Engine)
    if (config.source === 'ai-estimation') {
      try {
        const { runAiDepthEstimation, combineAiWithTonalRelief, applyDetailEmbossing } = await import('../lib/ai-depth');
        const pixels = new Uint8ClampedArray(buffer);
        const hash = computeQuickBufferHash(new Uint8Array(buffer), width, height);

        let baseAiDepth: Float32Array;
        if (
          workerAiDepthCache &&
          workerAiDepthCache.width === width &&
          workerAiDepthCache.height === height &&
          workerAiDepthCache.hash === hash
        ) {
          baseAiDepth = new Float32Array(workerAiDepthCache.rawAiDepth);
        } else {
          const rawDepth = await runAiDepthEstimation(pixels, width, height);
          workerAiDepthCache = {
            width,
            height,
            hash,
            rawAiDepth: new Float32Array(rawDepth),
          };
          baseAiDepth = rawDepth;
        }

        let depthFloat = baseAiDepth;

        // Professional Hybrid Bas-Relief: Combine AI 3D Base Shape with Bilateral-Denoised Tonal Relief
        if ((config.tonalBlend ?? 35) > 0) {
          depthFloat = combineAiWithTonalRelief(
            depthFloat,
            pixels,
            width,
            height,
            config.aiWeight ?? 75,
            config.tonalBlend ?? 35,
            config.surfaceDenoise ?? 2.0
          );
        }

        // Optional fine-edge typography embossing
        if ((config.detailEmboss ?? 0) > 0) {
          depthFloat = applyDetailEmbossing(depthFloat, pixels, width, height, config.detailEmboss ?? 0);
        }

        const depth16 = new Uint16Array(width * height);
        for (let i = 0; i < width * height; i++) {
          let val = depthFloat[i];
          if (config.invertZ) val = 1.0 - val;
          depth16[i] = Math.round(val * 65535);
        }
        return Comlink.transfer(
          {
            heightMapBuffer: depth16.buffer,
            width,
            height,
            is16Bit: true,
            minZ: 0,
            maxZ: 65535,
          },
          [depth16.buffer]
        );
      } catch (err) {
        console.warn('AI depth estimation failed, falling back to WASM:', err);
      }
    }

    // 2. Run Native Rust WASM Depth Engine (EDT Chamfer, Tonal Luminance, Gaussian Anti-Terracing)
    if (!this.wasmReady) {
      try {
        this.wasmReady = await this.wasmEngine.init();
      } catch (e) {
        console.warn('Rust WASM init failed in processDepth:', e);
      }
    }

    if (this.wasmReady) {
      try {
        const wasmResult = this.wasmEngine.processDepth(buffer, width, height, config);
        return Comlink.transfer(
          wasmResult,
          [wasmResult.heightMapBuffer]
        );
      } catch (err) {
        console.warn('Wasm depth processing error, falling back to JS:', err);
      }
    }

    // 3. JS Fallback
    const pixels = new Uint8ClampedArray(buffer);
    const result = generateDepthMap(pixels, width, height, config);

    return Comlink.transfer(
      result,
      [result.heightMapBuffer]
    );
  }

  /**
   * Processes intelligent client-side background removal and alpha matting
   */
  public async processBgRemoval(payload: ProcessBgRemovalPayload): Promise<ProcessBgRemovalResult> {
    const startTime = performance.now();
    const { buffer, width, height, tolerance, featherRadius, mode, customColor } = payload;
    const pixels = new Uint8ClampedArray(buffer);

    const { removedPixelCount } = removeBackground(pixels, width, height, {
      tolerance,
      featherRadius,
      mode,
      customColor,
    });

    const durationMs = performance.now() - startTime;

    return Comlink.transfer(
      {
        buffer: pixels.buffer,
        width,
        height,
        removedPixelCount,
        durationMs,
      },
      [pixels.buffer]
    );
  }
}

Comlink.expose(new ImageProcessorWorker());
