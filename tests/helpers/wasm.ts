/**
 * Test helpers that drive the compiled Rust WebAssembly module directly from Node.
 *
 * The argument order of each wrapper mirrors the `extern "C"` signatures in
 * `src/wasm/src/lib.rs`. If a signature changes there, change it here.
 */
import fs from 'fs';
import path from 'path';

const WASM_PATH = path.resolve(__dirname, '../../src/wasm/pkg/image_suite_wasm.wasm');

/** Dither algorithm codes accepted by `process_pipeline`. */
export const DITHER = {
  none: 0,
  floydSteinberg: 1,
  atkinson: 2,
  jarvis: 3,
  bayer2: 4,
  bayer4: 5,
  bayer8: 6,
} as const;

export interface PipelineOptions {
  exposure?: number;
  brightness?: number;
  contrast?: number;
  midtones?: number;
  highlights?: number;
  shadows?: number;
  whites?: number;
  blacks?: number;
  clarity?: number;
  gamma?: number;
  blackPoint?: number;
  whitePoint?: number;
  invert?: boolean;
  grayscaleMode?: number;
  saturation?: number;
  vibrance?: number;
  temperature?: number;
  tint?: number;
  clahe?: { clip: number; grid: number };
  adaptive?: { block: number; c: number };
  sharpen?: { amount: number; radius: number };
  dither?: number;
  ditherThreshold?: number;
  serpentine?: boolean;
  ditherScale?: number;
  dotAngle?: number;
  invertedBurn?: boolean;
}

export interface VectorOptions {
  /** 0 outline, 1 multi-colour, 2 edge detect, 3 centreline. */
  mode?: number;
  colorCount?: number;
  threshold?: number;
  rdpTolerance?: number;
  curveFitting?: boolean;
  minPathArea?: number;
  denoise?: number;
  cannyLow?: number;
  cannyHigh?: number;
  invert?: boolean;
  bezierTolerance?: number;
}

export interface TracedPath {
  svgPathData: string;
  isClosed: boolean;
  nodeCount: number;
  [key: string]: unknown;
}

export interface TracedLayer {
  paths: TracedPath[];
  [key: string]: unknown;
}

export interface TraceResult {
  layers: TracedLayer[];
  [key: string]: unknown;
}

// SAFETY: the WebAssembly export object is untyped; this interface lists the
// exports the tests call, matching src/wasm/src/lib.rs.
interface WasmExports {
  memory: WebAssembly.Memory;
  allocate(size: number): number;
  deallocate(ptr: number, size: number): void;
  process_pipeline(...args: number[]): void;
  process_vector(...args: number[]): number;
  get_vector_json_len(): number;
  process_depth(...args: number[]): number;
  get_depth_buf_len(): number;
}

export interface Wasm {
  exports: WasmExports;
}

let cached: Promise<Wasm> | null = null;

/** Loads and instantiates the committed WASM binary once per test process. */
export function loadWasm(): Promise<Wasm> {
  if (!cached) {
    cached = WebAssembly.instantiate(fs.readFileSync(WASM_PATH), { env: {} }).then((m) => ({
      exports: m.instance.exports as unknown as WasmExports,
    }));
  }
  return cached;
}

/** Builds an opaque RGBA image where every pixel is the grey level returned by `fn`. */
export function grayImage(width: number, height: number, fn: (x: number, y: number) => number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.max(0, Math.min(255, Math.round(fn(x, y))));
      const i = (y * width + x) * 4;
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Returns the red channel of an RGBA buffer as one value per pixel. */
export function redChannel(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4];
  return out;
}

/** Fraction of pixels whose red channel is 255. */
export function whiteFraction(rgba: Uint8Array): number {
  let white = 0;
  const n = rgba.length / 4;
  for (let i = 0; i < n; i++) if (rgba[i * 4] === 255) white++;
  return white / n;
}

/** Runs the raster pipeline on a copy of `rgba` and returns the processed RGBA buffer. */
export function runPipeline(
  wasm: Wasm,
  rgba: Uint8Array,
  width: number,
  height: number,
  o: PipelineOptions = {}
): Uint8Array {
  const e = wasm.exports;
  const size = width * height * 4;
  const ptr = e.allocate(size);
  try {
    new Uint8Array(e.memory.buffer, ptr, size).set(rgba);
    e.process_pipeline(
      ptr,
      width,
      height,
      o.exposure ?? 0,
      o.brightness ?? 0,
      o.contrast ?? 0,
      o.midtones ?? 0,
      o.highlights ?? 0,
      o.shadows ?? 0,
      o.whites ?? 0,
      o.blacks ?? 0,
      o.clarity ?? 0,
      o.gamma ?? 1,
      o.blackPoint ?? 0,
      o.whitePoint ?? 255,
      o.invert ? 1 : 0,
      o.grayscaleMode ?? 0,
      o.saturation ?? 0,
      o.vibrance ?? 0,
      o.temperature ?? 0,
      o.tint ?? 0,
      o.clahe ? 1 : 0,
      o.clahe?.clip ?? 2.5,
      o.clahe?.grid ?? 8,
      o.adaptive ? 1 : 0,
      o.adaptive?.block ?? 15,
      o.adaptive?.c ?? 2,
      o.sharpen?.amount ?? 0,
      o.sharpen?.radius ?? 1.5,
      o.dither ?? DITHER.none,
      o.ditherThreshold ?? 128,
      o.serpentine ? 1 : 0,
      o.ditherScale ?? 1,
      o.dotAngle ?? 45,
      o.invertedBurn ? 1 : 0
    );
    // Re-read the view: memory may have grown and detached the old buffer.
    return new Uint8Array(e.memory.buffer, ptr, size).slice();
  } finally {
    e.deallocate(ptr, size);
  }
}

/** Runs the tracer and returns its parsed JSON result. */
export function runVector(
  wasm: Wasm,
  rgba: Uint8Array,
  width: number,
  height: number,
  o: VectorOptions = {}
): TraceResult {
  const e = wasm.exports;
  const size = width * height * 4;
  const ptr = e.allocate(size);
  try {
    new Uint8Array(e.memory.buffer, ptr, size).set(rgba);
    const outPtr = e.process_vector(
      ptr,
      width,
      height,
      o.mode ?? 0,
      o.colorCount ?? 4,
      o.threshold ?? 128,
      o.rdpTolerance ?? 1,
      o.curveFitting ? 1 : 0,
      o.minPathArea ?? 4,
      o.denoise ?? 0,
      o.cannyLow ?? 30,
      o.cannyHigh ?? 80,
      o.invert ? 1 : 0,
      o.bezierTolerance ?? 1
    );
    const len = e.get_vector_json_len();
    const json = new TextDecoder().decode(new Uint8Array(e.memory.buffer, outPtr, len));
    return JSON.parse(json) as TraceResult;
  } finally {
    e.deallocate(ptr, size);
  }
}

/** One vertex of a traced path, in image pixel coordinates. */
export interface Pt {
  x: number;
  y: number;
}

/**
 * Parses the on-curve points of an SVG path made of M, L, C and Z commands
 * with absolute, space-separated coordinates (the format the tracer emits).
 * For C segments only the end point is returned.
 */
export function pathPoints(d: string): Pt[] {
  const tokens = d.trim().split(/[\s,]+/);
  const pts: Pt[] = [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M' || cmd === 'L') {
      pts.push({ x: Number(tokens[i]), y: Number(tokens[i + 1]) });
      i += 2;
    } else if (cmd === 'C') {
      pts.push({ x: Number(tokens[i + 4]), y: Number(tokens[i + 5]) });
      i += 6;
    } else if (cmd === 'Z') {
      // closes the path; no point
    } else {
      throw new Error(`Unexpected path token "${cmd}" in "${d}"`);
    }
  }
  return pts;
}

/** Signed area of a polygon (shoelace). The sign gives the winding direction. */
export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
