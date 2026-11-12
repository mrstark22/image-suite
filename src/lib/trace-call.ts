import type { PaletteEntry, PathKind, VectorConfig, VectorLayer, VectorResult } from '../types/vector';

/** The exports `traceImage` needs (a subset of the WASM module's). */
export interface TraceExports {
  memory: WebAssembly.Memory;
  allocate: (size: number) => number;
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
 * ends in, so no colour is lost by a chain of merges.
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
    const hex = /^#?([0-9a-f]{6})$/i.exec(e.color)?.[1] ?? '000000';
    out[i * 4] = parseInt(hex.slice(0, 2), 16);
    out[i * 4 + 1] = parseInt(hex.slice(2, 4), 16);
    out[i * 4 + 2] = parseInt(hex.slice(4, 6), 16);
    out[i * 4 + 3] = finalTarget(i);
  });
  return out;
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
  const raw = JSON.parse(json) as RawTrace;
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
 * Traces the RGBA8 image `pixels` (`width` x `height`) with `config`, where
 * the image has `pxPerMm` pixels per millimetre. Frees everything it
 * allocates. Throws if the tracer refuses the input.
 */
export function traceImage(
  wasm: TraceExports,
  pixels: ArrayBuffer | Uint8Array,
  width: number,
  height: number,
  pxPerMm: number,
  config: VectorConfig
): VectorResult {
  if (!(pxPerMm > 0)) throw new Error('Set the size of the image before tracing.');
  const bytes = width * height * 4;
  const palette = config.colorMode === 'color' && config.palette ? encodePalette(config.palette) : new Uint8Array(0);
  const ptr = wasm.allocate(bytes);
  const palPtr = palette.length > 0 ? wasm.allocate(palette.length) : 0;
  try {
    new Uint8Array(wasm.memory.buffer, ptr, bytes).set(pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels));
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
    return parseTrace(json, pxPerMm);
  } finally {
    wasm.deallocate(ptr, bytes);
    if (palPtr) wasm.deallocate(palPtr, palette.length);
  }
}
