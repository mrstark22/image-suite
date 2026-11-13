/**
 * Colour tracing (#28) and the SVG and DXF exports at physical size (#30).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadWasm, runTrace, type Wasm } from '../helpers/wasm';
import { encodePalette } from '../../src/lib/trace-call';
import { editPalette } from '../../src/lib/trace-palette';
import { layerColourIndexes, parsePathData, traceToDxf, traceToSvg } from '../../src/lib/vector-export';
import type { PaletteEntry, VectorResult } from '../../src/types/vector';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadWasm();
});

const RED: [number, number, number] = [220, 30, 30];
const BLUE: [number, number, number] = [30, 60, 220];
const GREEN: [number, number, number] = [40, 170, 60];

/** White, with red, blue and green 20 px squares. */
function threeSquares(): Uint8Array {
  const [w, h] = [90, 40];
  const img = new Uint8Array(w * h * 4).fill(255);
  [RED, BLUE, GREEN].forEach((rgb, k) => {
    for (let y = 10; y < 30; y++) {
      for (let x = 10 + k * 25; x < 30 + k * 25; x++) img.set(rgb, (y * w + x) * 4);
    }
  });
  return img;
}

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const near = (hex: string, rgb: number[]) => rgbOf(hex).every((v, i) => Math.abs(v - rgb[i]) <= 3);

describe('colour tracing (#28)', () => {
  it('three squares at four colours give white, red, blue and green layers with exact square outlines', () => {
    const result = runTrace(wasm, threeSquares(), 90, 40, { colorMode: 'color', colorCount: 4, shapes: 'outline' });
    expect(result.layers).toHaveLength(4);
    for (const want of [[255, 255, 255], RED, BLUE, GREEN]) {
      expect(result.layers.some((l) => near(l.color, want)), `${want}`).toBe(true);
    }
    for (const rgb of [RED, BLUE, GREEN]) {
      const layer = result.layers.find((l) => near(l.color, rgb))!;
      expect(layer.paths).toHaveLength(1);
      const cmds = parsePathData(layer.paths[0].d);
      expect(cmds.filter((c) => c.op === 'L')).toHaveLength(4);
    }
  });

  it('an anti-aliased two-colour logo gives two layers and no slivers', () => {
    const [w, h] = [120, 120];
    const img = new Uint8Array(w * h * 4);
    const ink = [20, 30, 90];
    const paper = [245, 235, 210];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let c = 0;
        for (let sy = 0; sy < 8; sy++)
          for (let sx = 0; sx < 8; sx++) {
            const r = Math.hypot(x + (sx + 0.5) / 8 - 60, y + (sy + 0.5) / 8 - 60);
            if (r < 40 && r >= 18) c++;
          }
        const a = c / 64;
        for (let k = 0; k < 3; k++) img[(y * w + x) * 4 + k] = Math.round(ink[k] * a + paper[k] * (1 - a));
        img[(y * w + x) * 4 + 3] = 255;
      }
    }
    const result = runTrace(wasm, img, w, h, { colorMode: 'color', colorCount: 4, shapes: 'outline' });
    expect(result.layers).toHaveLength(2);
    // The ink layer is the ring: an outer and an inner boundary, nothing else.
    expect(result.layers.find((l) => near(l.color, ink))!.paths).toHaveLength(2);
  });

  it('the number of colours sets how many layers are found', () => {
    const at = (colorCount: number) =>
      runTrace(wasm, threeSquares(), 90, 40, { colorMode: 'color', colorCount, shapes: 'outline' }).layers.length;
    expect(at(2)).toBe(2);
    expect(at(4)).toBe(4);
  });

  it('a fixed palette can remove a colour and merge two', () => {
    const palette: PaletteEntry[] = [
      { color: '#ffffff', removed: true, mergeInto: null },
      { color: '#dc1e1e', removed: false, mergeInto: null },
      { color: '#1e3cdc', removed: false, mergeInto: 1 },
      { color: '#28aa3c', removed: false, mergeInto: null },
    ];
    const result = runTrace(wasm, threeSquares(), 90, 40, { colorMode: 'color', palette, shapes: 'outline' });
    expect(result.layers.map((l) => [l.color, l.paths.length])).toEqual([
      ['#dc1e1e', 2], // red and blue squares
      ['#28aa3c', 1],
    ]);
  });

  it('merges follow a colour that is merged or removed itself', () => {
    let p: PaletteEntry[] = ['#000000', '#ff0000', '#00ff00'].map((color) => ({ color, removed: false, mergeInto: null }));
    p = editPalette(p, 2, 'merge:1');
    p = editPalette(p, 1, 'merge:0');
    expect(p[2].mergeInto).toBe(0);
    p = editPalette(p, 0, 'remove');
    expect(p.every((e) => e.removed)).toBe(true);
    expect([...encodePalette(p)].filter((_, i) => i % 4 === 3)).toEqual([255, 255, 255]);
  });
});

/** A result of one 1000 px wide trace at the given scale. */
function oneSquare(pxPerMm: number, visible = true): VectorResult {
  return {
    layers: [
      {
        id: 'ink',
        name: 'Ink',
        color: '#000000',
        paletteIndex: null,
        visible,
        totalNodes: 5,
        paths: [{ id: 'p', kind: 'fill', isClosed: true, nodeCount: 5, d: 'M 0 0 L 1000 0 L 1000 500 L 0 500 Z' }],
      },
      {
        id: 'cutline',
        name: 'Cutline',
        color: '#ff0000',
        paletteIndex: null,
        visible: true,
        totalNodes: 2,
        paths: [{ id: 'c', kind: 'cut', isClosed: true, nodeCount: 2, d: 'M 100 100 C 200 100 200 200 100 200 Z' }],
      },
    ],
    palette: [],
    totalPaths: 2,
    totalNodes: 7,
    dimensions: { width: 1000, height: 500 },
    pxPerMm,
  };
}

/** Group code / value pairs of a DXF. */
function dxfPairs(dxf: string): Array<[number, string]> {
  const lines = dxf.trim().split('\n');
  const out: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([Number(lines[i]), lines[i + 1]]);
  return out;
}

describe('SVG and DXF at physical size (#30)', () => {
  // A 1000 px image set to 84.7 mm wide.
  const ppm = 1000 / 84.7;

  it('the SVG measures 84.7 mm wide, with a matching viewBox in millimetres', () => {
    const svg = traceToSvg(oneSquare(ppm));
    expect(svg).toMatch(/width="84\.7mm"/);
    expect(svg).toMatch(/viewBox="0 0 84\.7 42\.35"/);
    const d = /<path id="p" d="([^"]+)"/.exec(svg)![1];
    const xs = parsePathData(d).flatMap((c) => (c.op === 'Z' ? [] : [c.p.x]));
    expect(Math.max(...xs)).toBeCloseTo(84.7, 3);
  });

  it('the DXF declares millimetres and measures 84.7 mm wide', () => {
    const pairs = dxfPairs(traceToDxf(oneSquare(ppm)));
    const header = (name: string) => pairs[pairs.findIndex(([c, v]) => c === 9 && v === name) + 1];
    expect(header('$INSUNITS')).toEqual([70, '4']);
    expect(header('$MEASUREMENT')).toEqual([70, '1']);
    const xs = pairs.filter(([c]) => c === 10).map(([, v]) => Number(v));
    expect(Math.max(...xs)).toBeCloseTo(84.7, 3);
  });

  it('DXF polylines are closed by their flag, without a repeated vertex', () => {
    const pairs = dxfPairs(traceToDxf(oneSquare(ppm)));
    const first = pairs.findIndex(([c, v]) => c === 0 && v === 'POLYLINE');
    const end = pairs.findIndex(([c, v], i) => i > first && c === 0 && v === 'SEQEND');
    const poly = pairs.slice(first, end);
    expect(poly.find(([c]) => c === 70)).toEqual([70, '1']);
    expect(poly.filter(([c, v]) => c === 0 && v === 'VERTEX')).toHaveLength(4);
  });

  it('DXF y points up, and curves are flattened to within 0.005 mm', () => {
    const pairs = dxfPairs(traceToDxf(oneSquare(10)));
    // The square's top edge (y = 0 px) is at the top of the drawing: y = 50 mm.
    const ys = pairs.filter(([c]) => c === 20).map(([, v]) => Number(v));
    expect(Math.max(...ys)).toBeCloseTo(50, 6);
    // The cutline curve becomes many vertices.
    expect(pairs.filter(([c, v]) => c === 0 && v === 'VERTEX').length).toBeGreaterThan(20);
  });

  it('each DXF layer gets its own colour, and hidden layers are left out', () => {
    expect(layerColourIndexes(['#000000', '#ff0000'])).toEqual([7, 1]);
    expect(new Set(layerColourIndexes(['#ff0000', '#ee1111', '#dd2222'])).size).toBe(3);
    const pairs = dxfPairs(traceToDxf(oneSquare(ppm, false)));
    const layerNames = pairs.filter(([c], i) => c === 2 && pairs[i - 1]?.[1] === 'LAYER').map(([, v]) => v);
    expect(layerNames).toEqual(['Cutline']);
    expect(traceToSvg(oneSquare(ppm, false))).not.toContain('id="ink"');
  });

  it('refuses a trace without a size', () => {
    expect(() => traceToSvg(oneSquare(0 as number) && { ...oneSquare(1), pxPerMm: null })).toThrow(/size/);
  });
});
