import * as Comlink from 'comlink';
import type {
  ProcessPreviewPayload,
  ProcessPreviewResult,
  ProcessVectorPayload,
  ProcessDepthPayload,
  ProcessBgRemovalPayload,
  ProcessBgRemovalResult,
} from '../types/worker-messages';
import type { VectorResult } from '../types/vector';
import type { DepthResult } from '../types/depth';
import { removeBackground } from '../lib/bg-removal';
import { RustWasmEngine } from '../wasm/wasm-bridge';

/**
 * Image processing worker. It only orchestrates: every algorithm lives in the
 * Rust WebAssembly module (`src/wasm/src`), which is the single implementation
 * of each operation. If the module cannot be loaded the request fails with an
 * error instead of falling back to a different implementation.
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

/** Message shown to the user when the WebAssembly module fails to load. */
export const ENGINE_LOAD_ERROR =
  'The image processing engine failed to load. Reload the page; if it keeps happening, your browser may not support WebAssembly.';

export class ImageProcessorWorker {
  private wasmEngine = new RustWasmEngine();
  private wasmReady = false;

  constructor() {
    // Start loading straight away so the first request does not wait for it.
    void this.ensureEngine().catch(() => {
      // Reported to the caller on the first request.
    });
  }

  /**
   * Resolves once the WebAssembly engine is ready, or throws if it cannot be loaded.
   */
  private async ensureEngine(): Promise<void> {
    if (this.wasmReady) return;
    this.wasmReady = await this.wasmEngine.init();
    if (!this.wasmReady) {
      throw new Error(ENGINE_LOAD_ERROR);
    }
  }

  /**
   * Applies tonal and colour adjustments, detail filters and dithering to a raw pixel buffer.
   */
  public async processImage(payload: ProcessPreviewPayload): Promise<ProcessPreviewResult> {
    const { buffer, width, height, tonal, color, detail, dither } = payload;
    await this.ensureEngine();

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
      adaptiveBlock: detail.adaptiveBlockPx,
      adaptiveC: detail.adaptiveConstant,
      sharpenAmount: (detail.unsharpStrength ?? 0) / 100.0,
      sharpenRadius: detail.unsharpRadiusPx,
      ditherAlgorithm: dither.algorithm,
      ditherThreshold: dither.threshold,
      ditherSerpentine: dither.serpentine,
      ditherScale: dither.matrixScale,
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
  }

  /**
   * Traces a raster buffer into vector paths.
   */
  public async processVector(payload: ProcessVectorPayload): Promise<VectorResult> {
    const { buffer, width, height, config } = payload;
    await this.ensureEngine();
    return this.wasmEngine.vectorize(buffer, width, height, config);
  }

  /**
   * Generates a 16-bit heightmap from a raster buffer.
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

    // 2. Rust WASM depth engine (distance-transform bevels, tonal relief, smoothing)
    await this.ensureEngine();
    const wasmResult = this.wasmEngine.processDepth(buffer, width, height, config);
    return Comlink.transfer(wasmResult, [wasmResult.heightMapBuffer]);
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
