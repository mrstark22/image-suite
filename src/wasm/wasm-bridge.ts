/**
 * WebAssembly Bridge for Image Suite Native Rust Core
 * Manages zero-copy linear memory allocations and invokes native Rust WASM routines.
 */

import initWasm from './pkg/image_suite_wasm.wasm?init';
import wasmUrl from './pkg/image_suite_wasm.wasm?url';
import type { VectorConfig, VectorResult, VectorLayer } from '../types/vector';
import type { DepthConfig, DepthResult } from '../types/depth';

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
  ditherDotAngle: number;
  ditherInverted: boolean;
}

interface WasmExports {
  memory: WebAssembly.Memory;
  allocate: (size: number) => number;
  deallocate: (ptr: number, size: number) => void;
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
    ditherDotAngle: number,
    ditherInverted: number
  ) => void;
  process_vector: (
    ptr: number,
    width: number,
    height: number,
    mode: number,
    colorCount: number,
    threshold: number,
    rdpTolerance: number,
    curveFitting: number,
    minPathArea: number,
    denoise: number,
    cannyLow: number,
    cannyHigh: number,
    invert: number,
    bezierTolerance: number
  ) => number;
  get_vector_json_len: () => number;
  process_depth: (
    ptr: number,
    width: number,
    height: number,
    sourceMode: number,
    bevelStyle: number,
    invertZ: number,
    smoothingRadius: number,
    depthScale: number,
    reliefAngle: number
  ) => number;
  get_depth_buf_len: () => number;
}

const ALGORITHM_CODE_MAP: Record<string, number> = {
  none: 0,
  'floyd-steinberg': 1,
  atkinson: 2,
  jarvis: 3,
  'bayer-2': 4,
  'bayer-4': 5,
  'bayer-8': 6,
  'blue-noise': 7,
  ostromoukhov: 8,
  riemersma: 9,
  'knuth-dot': 10,
  'halftone-dot': 11,
};

export class RustWasmEngine {
  private exports: WasmExports | null = null;
  private isLoaded = false;
  private loadPromise: Promise<boolean> | null = null;

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

  public process(
    inputBuffer: ArrayBuffer,
    params: WasmPipelineParams
  ): { buffer: ArrayBuffer; durationMs: number } {
    if (!this.exports) {
      throw new Error('Rust WebAssembly engine is not initialized');
    }

    const { width, height } = params;
    const byteLength = width * height * 4;
    const startTime = performance.now();

    // 1. Allocate Linear Memory in WASM
    const ptr = this.exports.allocate(byteLength);
    if (!ptr) {
      throw new Error('Failed to allocate WebAssembly linear memory');
    }

    try {
      // 2. Copy input pixels directly into WASM linear memory
      const wasmMemoryView = new Uint8Array(this.exports.memory.buffer, ptr, byteLength);
      wasmMemoryView.set(new Uint8Array(inputBuffer));

      // 3. Execute Native Rust Image Processing Pipeline
      const algoCode = ALGORITHM_CODE_MAP[params.ditherAlgorithm] ?? 0;
      const grayCodeMap: Record<string, number> = { none: 0, rec709: 1, average: 2, desaturate: 3, max: 4, inverted: 5 };
      const grayCode = grayCodeMap[params.grayscaleMode] ?? 0;

      this.exports.process_pipeline(
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
        params.ditherDotAngle ?? 45,
        params.ditherInverted ? 1 : 0
      );

      // 4. Create clean output buffer from processed linear memory
      const outputCopy = new ArrayBuffer(byteLength);
      new Uint8Array(outputCopy).set(new Uint8Array(this.exports.memory.buffer, ptr, byteLength));

      const durationMs = performance.now() - startTime;
      return { buffer: outputCopy, durationMs };
    } finally {
      // 5. Always explicitly free pointer to guarantee zero memory leaks
      this.exports.deallocate(ptr, byteLength);
    }
  }

  public vectorize(
    inputBuffer: ArrayBuffer,
    width: number,
    height: number,
    config: VectorConfig
  ): VectorResult {
    if (!this.exports) {
      throw new Error('Rust WebAssembly engine is not initialized');
    }

    const byteLength = width * height * 4;
    const ptr = this.exports.allocate(byteLength);
    if (!ptr) {
      throw new Error('Failed to allocate WebAssembly memory for vectorization');
    }

    try {
      const wasmMem = new Uint8Array(this.exports.memory.buffer, ptr, byteLength);
      wasmMem.set(new Uint8Array(inputBuffer));

      const modeCode =
        config.mode === 'centerline'
          ? 1
          : config.mode === 'multi-color'
          ? 2
          : config.mode === 'edge-detect'
          ? 3
          : 0;

      const outPtr = this.exports.process_vector(
        ptr,
        width,
        height,
        modeCode,
        config.colorCount || 4,
        config.threshold ?? 128,
        config.rdpTolerance ?? 1.0,
        config.curveFitting ? 1 : 0,
        config.minPathArea ?? 25,
        config.denoise ?? 2.0,
        config.cannyLow ?? 30,
        config.cannyHigh ?? 80,
        config.invert ? 1 : 0,
        config.bezierTolerance ?? 1.0
      );

      const outLen = this.exports.get_vector_json_len();
      if (!outPtr || outLen === 0) {
        return {
          layers: [],
          totalPaths: 0,
          totalNodes: 0,
          svgString: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"></svg>`,
          dimensions: { width, height },
        };
      }

      const jsonBytes = new Uint8Array(this.exports.memory.buffer, outPtr, outLen);
      const jsonStr = new TextDecoder().decode(jsonBytes);
      const parsed = JSON.parse(jsonStr);

      const layers: VectorLayer[] = parsed.layers || [];
      const totalPaths = layers.reduce((sum, l) => sum + (l.paths ? l.paths.length : 0), 0);
      const totalNodes = layers.reduce(
        (sum, l) => sum + (l.paths ? l.paths.reduce((s, p) => s + (p.nodeCount || 0), 0) : 0),
        0
      );

      const svgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
${layers
  .map(
    (l) =>
      `  <g id="${l.id}" stroke="${l.color}" fill="none" stroke-width="${config.strokeWidth || 1}">\n` +
      l.paths.map((p) => `    <path id="${p.id}" d="${p.svgPathData}" />`).join('\n') +
      '\n  </g>'
  )
  .join('\n')}
</svg>`;

      return {
        layers,
        totalPaths,
        totalNodes,
        svgString,
        dimensions: { width, height },
      };
    } finally {
      this.exports.deallocate(ptr, byteLength);
    }
  }

  public processDepth(
    inputBuffer: ArrayBuffer,
    width: number,
    height: number,
    config: DepthConfig
  ): DepthResult {
    if (!this.exports) {
      throw new Error('Rust WebAssembly engine is not initialized');
    }

    const byteLength = width * height * 4;
    const ptr = this.exports.allocate(byteLength);
    if (!ptr) {
      throw new Error('Failed to allocate WebAssembly memory for depth computation');
    }

    try {
      const wasmMem = new Uint8Array(this.exports.memory.buffer, ptr, byteLength);
      wasmMem.set(new Uint8Array(inputBuffer));

      const sourceCode =
        config.source === 'distance-transform'
          ? 1
          : config.source === 'ai-estimation'
          ? 2
          : 0;

      const bevelCode =
        config.bevelStyle === 'dome'
          ? 1
          : config.bevelStyle === 'concave'
          ? 2
          : config.bevelStyle === 'flat'
          ? 3
          : 0;

      const outPtr = this.exports.process_depth(
        ptr,
        width,
        height,
        sourceCode,
        bevelCode,
        config.invertZ ? 1 : 0,
        config.smoothingRadius ?? 2.0,
        config.depthScale ?? 1.0,
        config.reliefAngle ?? 45.0
      );

      const outLen = this.exports.get_depth_buf_len();
      if (!outPtr || outLen === 0) {
        throw new Error('Depth map generation produced empty buffer');
      }

      // Read 16-bit height values directly from WASM linear memory
      const wasmU16View = new Uint16Array(this.exports.memory.buffer, outPtr, outLen);
      const heightMapCopy = new Uint16Array(outLen);
      heightMapCopy.set(wasmU16View);

      let minZ = 65535;
      let maxZ = 0;
      for (let i = 0; i < outLen; i++) {
        const val = heightMapCopy[i];
        if (val < minZ) minZ = val;
        if (val > maxZ) maxZ = val;
      }

      return {
        heightMapBuffer: heightMapCopy.buffer as ArrayBuffer,
        width,
        height,
        is16Bit: true,
        minZ,
        maxZ,
      };
    } finally {
      this.exports.deallocate(ptr, byteLength);
    }
  }
}
