/**
 * Transparency is flattened onto white, once, at the start of the pipeline
 * (#18, design section 2). A logo on a transparent background must give the
 * same dither, trace and relief as the same logo composited onto white by the
 * test's own reference, and a transparent background must never burn.
 *
 * Everything runs through the worker's API, as the app calls it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { RustWasmEngine, type WasmExports } from '../../src/wasm/wasm-bridge';
import { PipelineWorkerApi } from '../../src/workers/pipeline-api';
import { nativeTarget, previewTarget } from '../../src/lib/render-target';
import { createDocument, setDepth, setDither } from '../../src/lib/document';
import type { ImageDocument } from '../../src/types/document';
import type { RenderTarget } from '../../src/types/render';
import type { DitherAlgorithm } from '../../src/types/dither';
import type { DepthSource } from '../../src/types/depth';
import type { VectorResult } from '../../src/types/vector';
import { loadWasm, pathPoints } from '../helpers/wasm';
import { flattenOnWhite } from '../helpers/reference';

const W = 240;
const H = 160;
const SS = 4; // supersampling for the logo's anti-aliased edges

/**
 * Coverage (0 to 1) of a logo at (x, y): a ring and a bar, sampled SS x SS
 * times per pixel so the edges are partly transparent.
 */
function coverage(x: number, y: number): number {
  let hits = 0;
  for (let j = 0; j < SS; j++) {
    for (let i = 0; i < SS; i++) {
      const u = x + (i + 0.5) / SS;
      const v = y + (j + 0.5) / SS;
      const r = Math.hypot(u - 80, v - 80);
      const ring = r > 30 && r < 52;
      const bar = u > 150 && u < 210 && v > 40 && v < 120;
      if (ring || bar) hits++;
    }
  }
  return hits / (SS * SS);
}

/**
 * A dark logo on a transparent background, as a PNG decodes: the background is
 * (0, 0, 0, 0) and the edges are dark colour at partial alpha. The bar is a
 * mid grey so the dither has a tone to work on.
 */
function logoOnTransparency(): Uint8Array {
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = Math.round(coverage(x, y) * 255);
      const i = (y * W + x) * 4;
      const grey = x >= 140 ? 110 : 20;
      if (a > 0) {
        out[i] = grey;
        out[i + 1] = grey + 5;
        out[i + 2] = grey + 10;
      }
      out[i + 3] = a;
    }
  }
  return out;
}

/** Reference: `rgba` composited onto `bg` (255 is white, 0 is black), opaque. */
function compositeOnto(rgba: Uint8Array, bg: 0 | 255): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    for (let c = 0; c < 3; c++) {
      out[i + c] = bg === 255 ? flattenOnWhite(rgba[i + c], a) : Math.round((rgba[i + c] * a) / 255);
    }
    out[i + 3] = 255;
  }
  return out;
}

const LOGO = logoOnTransparency();
const ON_WHITE = compositeOnto(LOGO, 255);
// What the defect produced: transparency read as black.
const ON_BLACK = compositeOnto(LOGO, 0);

const DITHERS: DitherAlgorithm[] = ['none', 'floyd-steinberg', 'atkinson', 'jarvis', 'bayer-4'];
const RELIEFS: DepthSource[] = ['tonal-height', 'distance-transform'];

let api: PipelineWorkerApi;

beforeAll(async () => {
  const wasm = await loadWasm({ fresh: true });
  api = new PipelineWorkerApi(async () => RustWasmEngine.fromExports(wasm.exports as unknown as WasmExports));
});

/** A document for the loaded source `sourceId`, sized to 60 mm wide. */
function docFor(sourceId: string, hasAlpha: boolean): ImageDocument {
  return createDocument(
    'doc',
    { sourceId, name: 'logo.png', widthPx: W, heightPx: H, format: 'rgba8', hasAlpha, fileDpi: null },
    60 / W
  );
}

interface Outputs {
  target: RenderTarget;
  source: Uint8Array;
  dither: Map<DitherAlgorithm, Uint8Array>;
  trace: VectorResult;
  relief: Map<DepthSource, Uint16Array>;
}

/** Loads `pixels` and renders every consumer at `targetOf(doc)`. */
async function outputsFor(
  name: string,
  pixels: Uint8Array,
  targetOf: (doc: ImageDocument) => RenderTarget
): Promise<Outputs> {
  const { hasAlpha } = await api.putSource(name, pixels.slice().buffer, W, H);
  const doc = docFor(name, hasAlpha);
  const target = targetOf(doc);
  const req = (d: ImageDocument) => ({ doc: d, target, haveSourceKey: null });

  const first = await api.renderPreview(req(setDither({ algorithm: 'none' })(doc)));
  const dither = new Map<DitherAlgorithm, Uint8Array>();
  for (const algorithm of DITHERS) {
    const result = await api.renderPreview(req(setDither({ algorithm })(doc)));
    dither.set(algorithm, new Uint8Array(result.final.pixels));
  }
  const trace = await api.traceDocument({ doc, target });
  const relief = new Map<DepthSource, Uint16Array>();
  for (const source of RELIEFS) {
    const result = await api.renderRelief(req(setDepth({ source })(doc)));
    relief.set(source, new Uint16Array(result.depth.heightMapBuffer));
  }
  if (!first.sourceStage) throw new Error('The first render did not send its source stage');
  return { target, source: new Uint8Array(first.sourceStage.pixels), dither, trace, relief };
}

/** Every traced path's SVG data, in order, so two traces compare by geometry. */
function traceGeometry(trace: VectorResult): string[] {
  return trace.layers.flatMap((layer) => layer.paths.map((p) => p.svgPathData));
}

/**
 * The index of the first element where `a` and `b` differ, or -1 when they are
 * identical. A whole-array diff of these buffers is too slow to print.
 */
function firstDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

function isFlat(map: Uint16Array): boolean {
  return map.every((v) => v === map[0]);
}

const TARGETS: [string, (doc: ImageDocument) => RenderTarget][] = [
  ['at the native size', nativeTarget],
  ['downscaled to a third', (doc) => previewTarget(doc, 80)],
];

describe.each(TARGETS)('a logo on transparency, %s', (_label, targetOf) => {
  let transparent: Outputs;
  let white: Outputs;
  let black: Outputs;

  beforeAll(async () => {
    transparent = await outputsFor('transparent', LOGO, targetOf);
    white = await outputsFor('white', ON_WHITE, targetOf);
    black = await outputsFor('black', ON_BLACK, targetOf);
  });

  it('flattens to the same bytes as the logo composited onto white, and is opaque', () => {
    expect(firstDifference(transparent.source, white.source)).toBe(-1);
    for (let i = 3; i < transparent.source.length; i += 4) expect(transparent.source[i]).toBe(255);
    // The fully transparent corner is white: no burn.
    expect([...transparent.source.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
  });

  it.each(DITHERS)('gives the same %s output as on white, with the background unburned', (algorithm) => {
    const out = transparent.dither.get(algorithm)!;
    expect(firstDifference(out, white.dither.get(algorithm)!)).toBe(-1);
    // The defect burned the background: it would match the logo on black instead.
    expect(firstDifference(out, black.dither.get(algorithm)!)).not.toBe(-1);
    // Every pixel of the transparent background is white in the output.
    const { widthPx: tw, heightPx: th } = transparent.target;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        if (alphaUnderTargetPixel(x, y, tw, th) === 0) expect(out[(y * tw + x) * 4]).toBe(255);
      }
    }
  });

  it('traces the same paths as on white, and not the image frame', () => {
    expect(transparent.trace.totalPaths).toBeGreaterThan(0);
    expect(transparent.trace.totalPaths).toBe(white.trace.totalPaths);
    expect(traceGeometry(transparent.trace)).toEqual(traceGeometry(white.trace));
    expect(traceGeometry(transparent.trace)).not.toEqual(traceGeometry(black.trace));
    // No path runs along the image's border, as the frame did when the background counted as ink.
    const { width, height } = transparent.trace.dimensions;
    for (const d of traceGeometry(transparent.trace)) {
      const pts = pathPoints(d);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const spansWidth = Math.min(...xs) <= 1 && Math.max(...xs) >= width - 1;
      const spansHeight = Math.min(...ys) <= 1 && Math.max(...ys) >= height - 1;
      expect(spansWidth && spansHeight).toBe(false);
    }
  });

  it.each(RELIEFS)('gives the same %s heightmap as on white, and it is not flat', (source) => {
    const map = transparent.relief.get(source)!;
    expect(firstDifference(map, white.relief.get(source)!)).toBe(-1);
    expect(isFlat(map)).toBe(false);
  });
});

/**
 * The summed alpha of the source pixels under target pixel (x, y) of a
 * `tw` x `th` render, with one pixel of margin: 0 only when the target pixel
 * cannot have been touched by the logo.
 */
function alphaUnderTargetPixel(x: number, y: number, tw: number, th: number): number {
  const sx = W / tw;
  const sy = H / th;
  let total = 0;
  for (let j = Math.floor(y * sy) - 1; j < Math.ceil((y + 1) * sy) + 1; j++) {
    for (let i = Math.floor(x * sx) - 1; i < Math.ceil((x + 1) * sx) + 1; i++) {
      if (i >= 0 && j >= 0 && i < W && j < H) total += LOGO[(j * W + i) * 4 + 3];
    }
  }
  return total;
}

describe('background removal', () => {
  // Removal sets the background's alpha to 0 and keeps its colour. Its pixels
  // stand in for the source stage, after step 2, so they must be flattened too.
  function removed(): ArrayBuffer {
    const out = new Uint8Array(LOGO);
    for (let i = 0; i < out.length; i += 4) {
      if (out[i + 3] === 0) [out[i], out[i + 1], out[i + 2]] = [130, 90, 60];
    }
    return out.buffer;
  }

  it('flattens the removed background onto white for the dither, trace and relief', async () => {
    const reference = await outputsFor('white', ON_WHITE, nativeTarget);
    const { hasAlpha } = await api.putSource('photo', removed(), W, H);
    const doc = docFor('photo', hasAlpha);
    const target = nativeTarget(doc);
    const req = (d: ImageDocument) => ({ doc: d, target, haveSourceKey: 'x', sourceStagePixels: removed() });

    for (const algorithm of DITHERS) {
      const result = await api.renderPreview(req(setDither({ algorithm })(doc)));
      expect(firstDifference(new Uint8Array(result.final.pixels), reference.dither.get(algorithm)!)).toBe(-1);
    }
    const trace = await api.traceDocument({ doc, target, sourceStagePixels: removed() });
    expect(traceGeometry(trace)).toEqual(traceGeometry(reference.trace));
    for (const source of RELIEFS) {
      const result = await api.renderRelief(req(setDepth({ source })(doc)));
      expect(firstDifference(new Uint16Array(result.depth.heightMapBuffer), reference.relief.get(source)!)).toBe(-1);
    }
  });
});
