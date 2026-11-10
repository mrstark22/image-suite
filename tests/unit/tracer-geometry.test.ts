/**
 * Geometry tests for the outline tracer on shapes whose correct answer is known.
 *
 * These pin down what the current tracer gets right, so the phase 2 rebuild
 * (sub-pixel boundaries, curve fitting, centreline) can tighten the tolerances
 * without losing it. Coordinates are in image pixels on the pixel-edge grid:
 * a filled pixel (x, y) covers the square from (x, y) to (x + 1, y + 1).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { grayImage, loadWasm, pathPoints, runVector, signedArea, type Pt, type Wasm } from '../helpers/wasm';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadWasm();
});

const BLACK = 0;
const WHITE = 255;

/** Returns the points rotated to start at the top-left-most vertex, for stable comparison. */
function canonical(pts: Pt[]): Pt[] {
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].y < pts[start].y || (pts[i].y === pts[start].y && pts[i].x < pts[start].x)) start = i;
  }
  return [...pts.slice(start), ...pts.slice(0, start)];
}

describe('outline tracer: exact shapes', () => {
  it('traces a filled square as one closed path with exact corners', () => {
    const img = grayImage(32, 32, (x, y) => (x >= 10 && x < 22 && y >= 10 && y < 22 ? BLACK : WHITE));
    const result = runVector(wasm, img, 32, 32);

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].paths).toHaveLength(1);
    const path = result.layers[0].paths[0];
    expect(path.isClosed).toBe(true);
    expect(path.svgPathData.trim().endsWith('Z')).toBe(true);
    expect(canonical(pathPoints(path.svgPathData))).toEqual([
      { x: 10, y: 10 },
      { x: 22, y: 10 },
      { x: 22, y: 22 },
      { x: 10, y: 22 },
    ]);
    expect(Math.abs(signedArea(pathPoints(path.svgPathData)))).toBe(144);
  });

  it('reports the image dimensions it traced', () => {
    const img = grayImage(40, 24, (x) => (x < 5 ? BLACK : WHITE));
    expect(runVector(wasm, img, 40, 24).dimensions).toEqual({ width: 40, height: 24 });
  });

  it('closes a shape that touches the image border along the border', () => {
    const img = grayImage(32, 32, (x, y) => (x < 12 && y < 9 ? BLACK : WHITE));
    const paths = runVector(wasm, img, 32, 32).layers[0].paths;

    expect(paths).toHaveLength(1);
    expect(paths[0].isClosed).toBe(true);
    expect(canonical(pathPoints(paths[0].svgPathData))).toEqual([
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 9 },
      { x: 0, y: 9 },
    ]);
  });

  it('traces a rectangle with a rectangular hole as two closed paths with opposite winding', () => {
    const inHole = (x: number, y: number) => x >= 26 && x < 38 && y >= 28 && y < 36;
    const img = grayImage(64, 64, (x, y) =>
      x >= 16 && x < 48 && y >= 20 && y < 44 && !inHole(x, y) ? BLACK : WHITE
    );
    const paths = runVector(wasm, img, 64, 64).layers[0].paths;

    expect(paths).toHaveLength(2);
    expect(paths.every((p) => p.isClosed)).toBe(true);

    const areas = paths.map((p) => signedArea(pathPoints(p.svgPathData)));
    const outer = areas.find((a) => Math.abs(a) === 32 * 24);
    const hole = areas.find((a) => Math.abs(a) === 12 * 8);
    expect(outer).toBeDefined();
    expect(hole).toBeDefined();
    expect(Math.sign(outer as number)).toBe(-Math.sign(hole as number));
  });
});

describe('outline tracer: curved shapes', () => {
  const N = 160;
  const CENTRE = 80;
  const RADIUS = 60;
  const disc = () =>
    grayImage(N, N, (x, y) => (Math.hypot(x + 0.5 - CENTRE, y + 0.5 - CENTRE) < RADIUS ? BLACK : WHITE));

  // The tracer follows pixel edges of a hard-thresholded disc, so its vertices
  // sit on pixel corners, which lie up to about 0.7 px from the true circle.
  // Phase 2 (sub-pixel boundaries) should bring this well under 0.25 px.
  const MAX_RADIAL_ERROR = 0.75;

  for (const curveFitting of [false, true]) {
    for (const rdpTolerance of [0.5, 1, 2]) {
      it(`keeps vertices within ${MAX_RADIAL_ERROR} px of a true circle (curves ${curveFitting ? 'on' : 'off'}, simplify ${rdpTolerance})`, () => {
        const paths = runVector(wasm, disc(), N, N, { curveFitting, rdpTolerance }).layers[0].paths;
        expect(paths).toHaveLength(1);
        expect(paths[0].isClosed).toBe(true);

        const pts = pathPoints(paths[0].svgPathData);
        expect(pts.length).toBeGreaterThanOrEqual(12);
        for (const p of pts) {
          const error = Math.abs(Math.hypot(p.x - CENTRE, p.y - CENTRE) - RADIUS);
          expect(error).toBeLessThanOrEqual(MAX_RADIAL_ERROR);
        }
      });
    }
  }

  it('encloses the area of the disc to within 1%', () => {
    const paths = runVector(wasm, disc(), N, N, { rdpTolerance: 0.5 }).layers[0].paths;
    const area = Math.abs(signedArea(pathPoints(paths[0].svgPathData)));
    expect(Math.abs(area - Math.PI * RADIUS * RADIUS) / (Math.PI * RADIUS * RADIUS)).toBeLessThan(0.01);
  });

  it('uses fewer nodes as the simplification tolerance rises', () => {
    const nodes = (rdpTolerance: number) =>
      pathPoints(runVector(wasm, disc(), N, N, { rdpTolerance }).layers[0].paths[0].svgPathData).length;
    expect(nodes(0.5)).toBeGreaterThan(nodes(1));
    expect(nodes(1)).toBeGreaterThan(nodes(2));
  });

  it('traces a ring as an outer path and a hole with opposite winding', () => {
    const ring = grayImage(64, 64, (x, y) => {
      const r = Math.hypot(x + 0.5 - 32, y + 0.5 - 32);
      return r < 24 && r >= 12 ? BLACK : WHITE;
    });
    const paths = runVector(wasm, ring, 64, 64).layers[0].paths;
    expect(paths).toHaveLength(2);

    const areas = paths.map((p) => signedArea(pathPoints(p.svgPathData))).sort((a, b) => Math.abs(b) - Math.abs(a));
    expect(Math.sign(areas[0])).toBe(-Math.sign(areas[1]));
    expect(Math.abs(areas[0])).toBeGreaterThan(Math.PI * 24 * 24 * 0.95);
    expect(Math.abs(areas[1])).toBeLessThan(Math.PI * 12 * 12 * 1.05);
  });
});

describe('outline tracer: options', () => {
  // A 2x2 speck, and a 30x30 square containing a 2x2 hole.
  const img = () =>
    grayImage(64, 64, (x, y) => {
      const speck = x >= 5 && x < 7 && y >= 5 && y < 7;
      const hole = x >= 30 && x < 32 && y >= 30 && y < 32;
      const square = x >= 20 && x < 50 && y >= 20 && y < 50;
      return speck || (square && !hole) ? BLACK : WHITE;
    });

  it('keeps specks and small holes at or above the minimum area', () => {
    expect(runVector(wasm, img(), 64, 64, { minPathArea: 4 }).layers[0].paths).toHaveLength(3);
  });

  it('removes specks and small holes below the minimum area, by absolute area', () => {
    const paths = runVector(wasm, img(), 64, 64, { minPathArea: 5 }).layers[0].paths;
    expect(paths).toHaveLength(1);
    expect(Math.abs(signedArea(pathPoints(paths[0].svgPathData)))).toBe(900);
  });

  it('threshold decides which greys count as ink', () => {
    const grey = grayImage(32, 32, (x, y) => (x >= 8 && x < 24 && y >= 8 && y < 24 ? 100 : WHITE));
    expect(runVector(wasm, grey, 32, 32, { threshold: 128 }).layers[0].paths).toHaveLength(1);
    expect(runVector(wasm, grey, 32, 32, { threshold: 60 }).layers[0].paths).toHaveLength(0);
  });

  it('invert traces the light regions', () => {
    const img2 = grayImage(32, 32, (x, y) => (x >= 10 && x < 22 && y >= 10 && y < 22 ? WHITE : BLACK));
    const paths = runVector(wasm, img2, 32, 32, { invert: true }).layers[0].paths;
    expect(paths).toHaveLength(1);
    expect(Math.abs(signedArea(pathPoints(paths[0].svgPathData)))).toBe(144);
  });

  it('a blank image yields no paths', () => {
    const blank = grayImage(32, 32, () => WHITE);
    const result = runVector(wasm, blank, 32, 32);
    expect(result.layers.flatMap((l) => l.paths)).toHaveLength(0);
  });
});
