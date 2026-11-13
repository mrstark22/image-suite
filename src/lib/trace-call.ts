import type { PaletteEntry, PathKind, VectorConfig, VectorLayer, VectorResult } from '../types/vector';
import { TooLargeError } from './pipeline-engine';
import { rgbOfHex, withDrawnColours } from './trace-palette';
import { checkVectorSettings } from './trace-settings';

/** The exports `traceImageAt` needs (a subset of the WASM module's). */
export interface TraceExports {
  memory: WebAssembly.Memory;
  allocate: (size: number) => number;
  /** Like `allocate`, but returns 0 instead of trapping when memory runs out. */
  try_allocate: (size: number) => number;
  deallocate: (ptr: number, size: number) => void;
  process_trace: (
    ptr: number,
    width: number,
    height: number,
    pxPerMm: number,
    colourMode: number,
    shapes: number,
    threshold: number,
    invert: number,
    colourCount: number,
    palette: number,
    paletteLen: number,
    toleranceMm: number,
    cornerAngleDeg: number,
    maxStrokeMm: number,
    minAreaMm2: number,
    denoiseMm: number,
    cutlineMm: number
  ) => number;
  get_trace_json_len: () => number;
}

const SHAPES_CODE = { auto: 0, outline: 1, centerline: 2 } as const;

/**
 * The palette as `process_trace` takes it: 4 bytes per entry (red, green,
 * blue, and the index of the layer it joins, or 255 to leave it out). A merge
 * into an entry that is itself removed or merged is followed to the layer it
 * ends in, so no colour is lost by a chain of merges. Throws for a colour
 * that is not `#rrggbb`: it is never traced as some other colour.
 */
export function encodePalette(palette: PaletteEntry[]): Uint8Array {
  const out = new Uint8Array(palette.length * 4);
  const finalTarget = (i: number): number => {
    const seen = new Set<number>();
    let k = i;
    for (;;) {
      if (seen.has(k)) return 255;
      seen.add(k);
      const e = palette[k];
      if (!e || e.removed) return 255;
      if (e.mergeInto === null || e.mergeInto === k) return k;
      k = e.mergeInto;
    }
  };
  palette.forEach((e, i) => {
    out.set(rgbOfHex(e.color), i * 4);
    out[i * 4 + 3] = finalTarget(i);
  });
  return out;
}

interface RawTraceError {
  error: 'memory';
  bytes: number;
}

interface RawTrace {
  width: number;
  height: number;
  palette: string[];
  layers: Array<{
    name: string;
    color: string;
    paletteIndex: number;
    paths: Array<{ kind: PathKind; closed: boolean; nodes: number; d: string }>;
  }>;
}

/** Turns the tracer's JSON into a `VectorResult`. */
export function parseTrace(json: string, pxPerMm: number): VectorResult {
  const parsed = JSON.parse(json) as RawTrace | RawTraceError;
  if ('error' in parsed) {
    // The tracer reports no usable figure when the need is beyond what it can count.
    const known = parsed.bytes > 0 && parsed.bytes < 2 ** 40;
    throw new TooLargeError(
      known
        ? `Not enough memory on this device to trace this image (it needs about ${Math.ceil(parsed.bytes / 1e6)} MB).`
        : 'This image is too large to trace on this device.'
    );
  }
  const raw = parsed;
  const layers: VectorLayer[] = raw.layers.map((l, li) => {
    const paths = l.paths.map((p, pi) => ({
      id: `path-${li + 1}-${pi + 1}`,
      kind: p.kind,
      isClosed: p.closed,
      d: p.d,
      nodeCount: p.nodes,
    }));
    return {
      id: l.paletteIndex >= 0 ? `color-${l.paletteIndex}` : l.name === 'Cutline' ? 'cutline' : 'ink',
      name: l.name,
      color: l.color,
      paletteIndex: l.paletteIndex >= 0 ? l.paletteIndex : null,
      paths,
      visible: true,
      totalNodes: paths.reduce((n, p) => n + p.nodeCount, 0),
    };
  });
  return {
    layers,
    palette: raw.palette,
    totalPaths: layers.reduce((n, l) => n + l.paths.length, 0),
    totalNodes: layers.reduce((n, l) => n + l.totalNodes, 0),
    dimensions: { width: raw.width, height: raw.height },
    pxPerMm,
  };
}

/**
 * Traces the RGBA8 image already in WASM memory at `ptr`, leaving it there.
 * Throws a `TooLargeError` when the tracer cannot have the memory it needs,
 * and an error when it refuses the input.
 */
export function traceImageAt(
  wasm: TraceExports,
  ptr: number,
  width: number,
  height: number,
  pxPerMm: number,
  config: VectorConfig
): VectorResult {
  if (!(pxPerMm > 0)) throw new Error('Set the size of the image before tracing.');
  // A value the tracer does not have is an error here, never traced as a default (#86).
  checkVectorSettings(config);
  const fixed = config.colorMode === 'color' ? config.palette : null;
  const palette = fixed ? encodePalette(fixed) : new Uint8Array(0);
  const palPtr = palette.length > 0 ? wasm.try_allocate(palette.length) : 0;
  if (palette.length > 0 && !palPtr) throw new TooLargeError('Not enough memory on this device to trace this image.');
  try {
    if (palPtr) new Uint8Array(wasm.memory.buffer, palPtr, palette.length).set(palette);
    const out = wasm.process_trace(
      ptr,
      width,
      height,
      pxPerMm,
      config.colorMode === 'color' ? 1 : 0,
      SHAPES_CODE[config.shapes],
      config.threshold,
      config.invert ? 1 : 0,
      config.colorCount,
      palPtr,
      palette.length / 4,
      config.toleranceMm,
      config.cornerAngle,
      config.maxStrokeWidthMm,
      config.minAreaMm2,
      config.denoiseMm,
      config.cutline ? config.cutlineOffsetMm : 0
    );
    if (!out) throw new Error('The tracer could not trace this image.');
    // Read the view now: tracing may have grown memory.
    const json = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, out, wasm.get_trace_json_len()));
    return withDrawnColours(parseTrace(json, pxPerMm), fixed);
  } finally {
    if (palPtr) wasm.deallocate(palPtr, palette.length);
  }
}
