/**
 * WebAssembly Bridge for Image Suite Native Rust Core
 * Manages zero-copy linear memory allocations and invokes native Rust WASM routines.
 */

import initWasm from './pkg/image_suite_wasm.wasm?init';
import wasmUrl from './pkg/image_suite_wasm.wasm?url';
import type { VectorConfig, VectorResult } from '../types/vector';
import { traceImageAt, type TraceExports } from '../lib/trace-call';
import type { DepthConfig, DepthResult, ResolvedDepthSource } from '../types/depth';

export interface WasmPipelineParams {
  width: number;
  height: number;
  // Tonal
  exposure: number;
  brightness: number;
  contrast: number;
  midtones: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  clarity: number;
  gamma: number;
  blackPoint: number;
  whitePoint: number;
  invert: boolean;
  grayscaleMode: string;
  // Color
  saturation: number;
  vibrance: number;
  temperature: number;
  tint: number;
  // CLAHE
  enableClahe: boolean;
  claheClip: number;
  claheGrid: number;
  // Adaptive Threshold
  enableAdaptive: boolean;
  adaptiveBlock: number;
  adaptiveC: number;
  // Sharpen
  sharpenAmount: number;
  sharpenRadius: number;
  // Dither
  ditherAlgorithm: string;
  ditherThreshold: number;
  ditherSerpentine: boolean;
  ditherScale: number;
  ditherInverted: boolean;
}

export interface WasmExports {
  memory: WebAssembly.Memory;
  allocate: (size: number) => number;
  /** Like `allocate`, but returns 0 instead of trapping when memory runs out. */
  try_allocate: (size: number) => number;
  deallocate: (ptr: number, size: number) => void;
  /** Turns an RGBA8 image clockwise by quarter turns into a new buffer, or returns 0. */
  rotate_quarter_turns: (src: number, width: number, height: number, turns: number) => number;
  /**
   * Composites an opaque RGBA8 render onto white with the coverage of an
   * 8-bit probability map, in place (src/wasm/src/matte.rs). Returns 1, or 0.
   */
  apply_background_matte: (
    img: number,
    width: number,
    height: number,
    mask: number,
    maskW: number,
    maskH: number,
    cutoff: number,
    softness: number
  ) => number;
  /** The coverage of a probability map at `width` x `height`, one byte per pixel, as a new buffer or 0. */
  background_matte_alpha: (
    mask: number,
    maskW: number,
    maskH: number,
    width: number,
    height: number,
    cutoff: number,
    softness: number
  ) => number;
  /** Crop, flatten onto white and resample in linear light; returns a new buffer or 0. */
  prepare_source: (
    src: number,
    srcW: number,
    srcH: number,
    cropX: number,
    cropY: number,
    cropW: number,
    cropH: number,
    dstW: number,
    dstH: number
  ) => number;
  process_pipeline: (
    ptr: number,
    width: number,
    height: number,
    // Tonal
    exposure: number,
    brightness: number,
    contrast: number,
    midtones: number,
    highlights: number,
    shadows: number,
    whites: number,
    blacks: number,
    clarity: number,
    gamma: number,
    blackPoint: number,
    whitePoint: number,
    invert: number,
    grayscaleMode: number,
    // Color
    saturation: number,
    vibrance: number,
    temperature: number,
    tint: number,
    // CLAHE
    enableClahe: number,
    claheClip: number,
    claheGrid: number,
    // Adaptive Threshold
    enableAdaptive: number,
    adaptiveBlock: number,
    adaptiveC: number,
    // Sharpen
    sharpenAmount: number,
    sharpenRadius: number,
    // Dither
    ditherAlgoCode: number,
    ditherThresh: number,
    ditherSerpentine: number,
    ditherScale: number,
    ditherInverted: number
  ) => void;
  process_trace: TraceExports['process_trace'];
  get_trace_json_len: () => number;
  process_depth: (
    ptr: number,
    width: number,
    height: number,
    source: number,
    profile: number,
    shapeIsLight: number,
    invert: number,
    smoothingPx: number,
    bevelPx: number,
    detail: number,
    estPtr: number,
    estWidth: number,
    estHeight: number
  ) => number;
  get_depth_buf_len: () => number;
  get_depth_resolved_source: () => number;
}

const ALGORITHM_CODE_MAP: Record<string, number> = {
  none: 0,
  'floyd-steinberg': 1,
  atkinson: 2,
  jarvis: 3,
  'bayer-2': 4,
  'bayer-4': 5,
  'bayer-8': 6,
};

export class RustWasmEngine {
  private exports: WasmExports | null = null;
  private isLoaded = false;
  private loadPromise: Promise<boolean> | null = null;

  /** An engine over an already instantiated module (Node tests instantiate it themselves). */
  public static fromExports(exports: WasmExports): RustWasmEngine {
    const engine = new RustWasmEngine();
    engine.exports = exports;
    engine.isLoaded = true;
    return engine;
  }

  /** The module's exports. Throws until `init` has succeeded. */
  public get wasm(): WasmExports {
    if (!this.exports) throw new Error('Rust WebAssembly engine is not initialized');
    return this.exports;
  }

  public async init(): Promise<boolean> {
    if (this.isLoaded && this.exports) return true;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        let instance: WebAssembly.Instance | null = null;

        // 1. Try Vite wasm plugin init
        if (typeof initWasm === 'function') {
          try {
            const res = await initWasm({ env: {} });
            instance = res instanceof WebAssembly.Instance ? res : (res as any).instance || res;
          } catch (e) {
            console.debug('initWasm helper not available or failed:', e);
          }
        }

        // 2. Fallback to direct fetch with absolute URL resolution
        if (!instance) {
          if (typeof fetch !== 'undefined') {
            const resolvedUrl =
              typeof self !== 'undefined' && self.location && self.location.origin
                ? new URL(wasmUrl, self.location.origin).href
                : wasmUrl;

            const response = await fetch(resolvedUrl);
            const wasmBinary = await response.arrayBuffer();
            const wasmModule = await WebAssembly.instantiate(wasmBinary, {
              env: {},
            });
            instance = wasmModule.instance;
          } else {
            console.warn('Environment lacks fetch for wasm');
            return false;
          }
        }

        this.exports = instance.exports as unknown as WasmExports;
        this.isLoaded = true;
        return true;
      } catch (err) {
        console.error('Failed to initialize Rust WebAssembly engine:', err);
        this.isLoaded = false;
        return false;
      }
    })();

    return this.loadPromise;
  }

  /**
   * Runs steps 4 to 6 (`process_pipeline`) in place on the RGBA8 image of
   * `params.width` x `params.height` at `ptr` in WASM memory.
   */
  public processInPlace(ptr: number, params: WasmPipelineParams): void {
    const { width, height } = params;
    const algoCode = ALGORITHM_CODE_MAP[params.ditherAlgorithm] ?? 0;
    const grayCodeMap: Record<string, number> = { none: 0, rec709: 1, average: 2, desaturate: 3, max: 4, inverted: 5 };
    const grayCode = grayCodeMap[params.grayscaleMode] ?? 0;

    this.wasm.process_pipeline(
      ptr,
      width,
      height,
      params.exposure ?? 0,
      params.brightness ?? 0,
      params.contrast ?? 0,
      params.midtones ?? 0,
      params.highlights ?? 0,
      params.shadows ?? 0,
      params.whites ?? 0,
      params.blacks ?? 0,
      params.clarity ?? 0,
      params.gamma ?? 1.0,
      params.blackPoint ?? 0,
      params.whitePoint ?? 255,
      params.invert ? 1 : 0,
      grayCode,
      params.saturation ?? 0,
      params.vibrance ?? 0,
      params.temperature ?? 0,
      params.tint ?? 0,
      params.enableClahe ? 1 : 0,
      params.claheClip ?? 2.5,
      params.claheGrid ?? 8,
      params.enableAdaptive ? 1 : 0,
      params.adaptiveBlock ?? 15,
      params.adaptiveC ?? 2,
      params.sharpenAmount ?? 0,
      params.sharpenRadius ?? 1.5,
      algoCode,
      params.ditherThreshold ?? 128,
      params.ditherSerpentine ? 1 : 0,
      params.ditherScale ?? 1,
      params.ditherInverted ? 1 : 0
    );
  }

  /** Traces the RGBA8 image at `ptr` in WASM memory, in place (see `traceImageAt`). */
  public traceAt(ptr: number, width: number, height: number, pxPerMm: number, config: VectorConfig): VectorResult {
    return traceImageAt(this.wasm, ptr, width, height, pxPerMm, config);
  }

  /**
   * The relief heightmap of the RGBA8 image at `ptr` in WASM memory
   * (`depth.rs`), for a render at `pxPerMm`; the argument order is
   * `process_depth`'s in `lib.rs`. `estimate` is the AI depth estimate, needed
   * for the `ai-estimation` source.
   */
  public depthAt(
    ptr: number,
    width: number,
    height: number,
    config: DepthConfig,
    pxPerMm: number,
    estimate: DepthEstimate | null
  ): DepthResult {
    if (!this.exports) {
      throw new Error('Rust WebAssembly engine is not initialized');
    }
    if (config.source === 'ai-estimation' && !estimate) {
      throw new Error('The AI depth estimate is missing.');
    }
    const estBytes = estimate ? estimate.values.length * 4 : 0;
    const estPtr = estimate ? this.exports.allocate(estBytes) : 0;
    if (estimate && !estPtr) throw new Error('Failed to allocate WebAssembly memory for the depth estimate');
    try {
      if (estimate) new Float32Array(this.exports.memory.buffer, estPtr, estimate.values.length).set(estimate.values);
      const outPtr = this.exports.process_depth(
        ptr,
        width,
        height,
        DEPTH_SOURCE_CODE[config.source],
        BEVEL_CODE[config.bevelStyle] ?? 0,
        config.shapeIsLight ? 1 : 0,
        config.invertZ ? 1 : 0,
        Math.max(0, config.smoothingMm) * pxPerMm,
        Math.max(0, config.bevelWidthMm) * pxPerMm,
        Math.max(0, Math.min(100, config.detail)) / 100,
        estPtr,
        estimate?.width ?? 0,
        estimate?.height ?? 0
      );
      const outLen = this.exports.get_depth_buf_len();
      if (!outPtr || outLen !== width * height) {
        throw new Error('Depth map generation produced no heightmap');
      }
      // Re-read the memory: the call may have grown it.
      const heights = new Uint16Array(this.exports.memory.buffer, outPtr, outLen).slice();
      const resolved = this.exports.get_depth_resolved_source();
      return {
        heightMapBuffer: heights.buffer as ArrayBuffer,
        width,
        height,
        source: RESOLVED_SOURCE[resolved] ?? 'tonal-height',
      };
    } finally {
      if (estPtr) this.exports.deallocate(estPtr, estBytes);
    }
  }
}

/** An AI depth estimate at its own size, larger values nearer. */
export interface DepthEstimate {
  values: Float32Array;
  width: number;
  height: number;
}

/** `SOURCE_*` codes of `depth.rs`. */
const DEPTH_SOURCE_CODE: Record<DepthConfig['source'], number> = {
  'tonal-height': 0,
  'distance-transform': 1,
  'ai-estimation': 2,
  auto: 3,
};
const RESOLVED_SOURCE: Record<number, ResolvedDepthSource> = {
  0: 'tonal-height',
  1: 'distance-transform',
  2: 'ai-estimation',
};
/** `PROFILE_*` codes of `depth.rs`. */
const BEVEL_CODE: Record<DepthConfig['bevelStyle'], number> = { chamfer: 0, round: 1, cove: 2 };
