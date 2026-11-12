/**
 * The tracer's defining properties (phase 2, #24 to #29), on synthetic
 * anti-aliased shapes whose correct geometry is known. They run the compiled
 * WASM through `traceImage`, the call the app makes.
 *
 * Coordinates are image pixels on the pixel-edge grid: pixel (x, y) covers the
 * square from (x, y) to (x + 1, y + 1). `runTrace` uses 10 px per mm, so the
 * default accuracy of 0.05 mm is half a pixel.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadWasm, runTrace, signedArea, type Pt, type Wasm } from '../helpers/wasm';
import { parsePathData } from '../../src/lib/vector-export';
import type { VectorPath, VectorResult } from '../../src/types/vector';

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadWasm();
});

/** An image of `ink` (black on white), anti-aliased with 8x8 supersampling. */
function render(w: number, h: number, ink: (x: number, y: number) => boolean): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c = 0;
      for (let sy = 0; sy < 8; sy++) {
        for (let sx = 0; sx < 8; sx++) if (ink(x + (sx + 0.5) / 8, y + (sy + 0.5) / 8)) c++;
      }
      const v = 255 - Math.floor((c * 255) / 64);
      const i = (y * w + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Points along a path, with curves sampled finely. */
function sample(d: string): Pt[] {
  const out: Pt[] = [];
  let cur: Pt = { x: 0, y: 0 };
  for (const c of parsePathData(d)) {
    if (c.op === 'M') {
      cur = c.p;
      out.push(cur);
    } else if (c.op === 'L') {
      for (let k = 1; k <= 20; k++) out.push({ x: cur.x + ((c.p.x - cur.x) * k) / 20, y: cur.y + ((c.p.y - cur.y) * k) / 20 });
      cur = c.p;
    } else if (c.op === 'C') {
      for (let k = 1; k <= 40; k++) {
        const t = k / 40;
        const m = 1 - t;
        const b = (a: number, p: number, q: number, e: number) => m * m * m * a + 3 * m * m * t * p + 3 * m * t * t * q + t * t * t * e;
        out.push({ x: b(cur.x, c.c1.x, c.c2.x, c.p.x), y: b(cur.y, c.c1.y, c.c2.y, c.p.y) });
      }
      cur = c.p;
    }
  }
  return out;
}

const segments = (d: string) => parsePathData(d).filter((c) => c.op === 'L' || c.op === 'C');
const allPaths = (r: VectorResult): VectorPath[] => r.layers.flatMap((l) => l.paths);

describe('sub-pixel boundaries (#24)', () => {
  it('an anti-aliased circle traces within a quarter pixel of the true radius', () => {
    const [c, r] = [50, 37.3];
    const result = runTrace(wasm, render(100, 100, (x, y) => Math.hypot(x - c, y - c) < r), 100, 100, { toleranceMm: 0.02 });
    const paths = allPaths(result);
    expect(paths).toHaveLength(1);
    const worst = Math.max(...sample(paths[0].d).map((p) => Math.abs(Math.hypot(p.x - c, p.y - c) - r)));
    expect(worst).toBeLessThan(0.25);
  });

  it('an anti-aliased edge at an arbitrary angle traces as one straight line', () => {
    // A half-plane at 17° across the image.
    const a = (17 * Math.PI) / 180;
    const result = runTrace(
      wasm,
      render(120, 80, (x, y) => (x - 60) * Math.sin(a) - (y - 40) * Math.cos(a) > 0),
      120,
      80,
      { shapes: 'outline' }
    );
    const path = allPaths(result)[0];
    // The edge across the image is one L segment: find it and check its angle and offset.
    const cmds = parsePathData(path.d);
    let prev: Pt = { x: 0, y: 0 };
    const lines: Array<[Pt, Pt]> = [];
    for (const c of cmds) {
      if (c.op === 'L') lines.push([prev, c.p]);
      if (c.op !== 'Z') prev = c.p;
    }
    const diagonal = lines.filter(([p, q]) => Math.abs(p.x - q.x) > 1 && Math.abs(p.y - q.y) > 1);
    expect(diagonal).toHaveLength(1);
    for (const p of diagonal[0]) {
      const dist = (p.x - 60) * Math.sin(a) - (p.y - 40) * Math.cos(a);
      expect(Math.abs(dist)).toBeLessThan(0.1);
    }
  });

  it('a one-pixel diagonal line is one connected shape', () => {
    const img = render(40, 40, (x, y) => Math.floor(x) === Math.floor(y) && x >= 5 && x < 35);
    expect(allPaths(runTrace(wasm, img, 40, 40, { shapes: 'outline' }))).toHaveLength(1);
  });
});

describe('curve fitting with corners (#25)', () => {
  it('a circle is a few curves', () => {
    const result = runTrace(wasm, render(100, 100, (x, y) => Math.hypot(x - 50, y - 50) < 37.3), 100, 100, { toleranceMm: 0.02 });
    const segs = segments(allPaths(result)[0].d);
    expect(segs.length).toBeLessThanOrEqual(8);
    expect(segs.every((c) => c.op === 'C')).toBe(true);
  });

  it('a square is exactly four lines with exact corners', () => {
    const result = runTrace(wasm, render(60, 60, (x, y) => x >= 10 && x < 40 && y >= 12 && y < 42), 60, 60, { shapes: 'outline' });
    const path = allPaths(result)[0];
    const cmds = parsePathData(path.d);
    expect(segments(path.d).map((c) => c.op)).toEqual(['L', 'L', 'L', 'L']);
    for (const c of cmds) {
      if (c.op === 'Z') continue;
      expect(Math.min(Math.abs(c.p.x - 10), Math.abs(c.p.x - 40))).toBeLessThan(0.02);
      expect(Math.min(Math.abs(c.p.y - 12), Math.abs(c.p.y - 42))).toBeLessThan(0.02);
    }
  });

  it('a rounded rectangle is four lines and four arcs, joined smoothly', () => {
    const [x0, y0, x1, y1, r] = [10, 10, 90, 70, 15];
    const img = render(100, 80, (x, y) => {
      if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      return Math.hypot(x - cx, y - cy) < r;
    });
    const path = allPaths(runTrace(wasm, img, 100, 80, { shapes: 'outline', toleranceMm: 0.02 }))[0];
    const cmds = parsePathData(path.d).filter((c) => c.op !== 'M' && c.op !== 'Z');
    expect(cmds.filter((c) => c.op === 'L')).toHaveLength(4);
    expect(cmds.filter((c) => c.op === 'C')).toHaveLength(4);
    // Smooth joins: at each line end, the arc leaves along the line.
    let prev = parsePathData(path.d)[0] as { p: Pt };
    let prevDir: Pt | null = null;
    for (const c of cmds) {
      if (c.op === 'C') {
        const out = { x: c.c1.x - prev.p.x, y: c.c1.y - prev.p.y };
        if (prevDir) expect(Math.abs(prevDir.x * out.y - prevDir.y * out.x) / Math.hypot(out.x, out.y)).toBeLessThan(0.01);
        prevDir = null;
      } else if (c.op === 'L') {
        const len = Math.hypot(c.p.x - prev.p.x, c.p.y - prev.p.y);
        prevDir = { x: (c.p.x - prev.p.x) / len, y: (c.p.y - prev.p.y) / len };
      }
      prev = c as { p: Pt };
    }
  });

  it('no control point strays outside the shape: small bars and their corners do not overshoot', () => {
    // Narrow upright bars at sub-pixel offsets, like the letter I in small type.
    // Before the fix, the 6 px bar at x + 0.8 had a handle 4.5 px past its end.
    for (const [wd, ox, oy, h] of [
      [6, 0.8, 0, 24.7],
      [5.5, 0.2, 0.3, 20],
      [7, 0.6, 0.6, 24.7],
    ]) {
      const [x0, x1, y0, y1] = [10 + ox, 10 + ox + wd, 5 + oy, 5 + oy + h];
      const result = runTrace(wasm, render(40, 40, (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1), 40, 40, { shapes: 'outline' });
      for (const c of parsePathData(allPaths(result)[0].d)) {
        const pts = c.op === 'C' ? [c.c1, c.c2, c.p] : c.op === 'Z' ? [] : [c.p];
        for (const p of pts) {
          const label = `bar ${wd} at ${ox}, ${oy}`;
          expect(p.x, label).toBeGreaterThan(x0 - 0.5);
          expect(p.x, label).toBeLessThan(x1 + 0.5);
          expect(p.y, label).toBeGreaterThan(y0 - 0.5);
          expect(p.y, label).toBeLessThan(y1 + 0.5);
        }
      }
    }
  });

  it('a lower accuracy gives fewer segments', () => {
    const img = render(100, 100, (x, y) => Math.hypot(x - 50, y - 50) < 30 && !(x > 50 && y > 50));
    const count = (toleranceMm: number) => segments(allPaths(runTrace(wasm, img, 100, 100, { toleranceMm }))[0].d).length;
    expect(count(0.01)).toBeGreaterThan(count(0.1));
  });

  it('the corner angle decides what is a corner', () => {
    // A lens: two discs of radius 30 overlapping. Its tips turn by about 84°.
    const img = render(100, 100, (x, y) => Math.hypot(x - 30, y - 50) < 30 && Math.hypot(x - 70, y - 50) < 30);
    /** The largest change of direction where one segment meets the next, in degrees. */
    const sharpest = (cornerAngle: number) => {
      const d = allPaths(runTrace(wasm, img, 100, 100, { shapes: 'outline', cornerAngle }))[0].d;
      const cmds = parsePathData(d);
      const dirs: Array<[Pt, Pt]> = []; // [direction leaving the start, direction arriving at the end]
      let cur = (cmds[0] as { p: Pt }).p;
      for (const c of cmds) {
        if (c.op === 'L') dirs.push([{ x: c.p.x - cur.x, y: c.p.y - cur.y }, { x: c.p.x - cur.x, y: c.p.y - cur.y }]);
        if (c.op === 'C') dirs.push([{ x: c.c1.x - cur.x, y: c.c1.y - cur.y }, { x: c.p.x - c.c2.x, y: c.p.y - c.c2.y }]);
        if (c.op !== 'Z') cur = c.p;
      }
      const angle = (a: Pt, b: Pt) => (Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))))) * 180) / Math.PI;
      return Math.max(...dirs.map((_, k) => angle(dirs[k][1], dirs[(k + 1) % dirs.length][0])));
    };
    expect(sharpest(60)).toBeGreaterThan(60);
    expect(sharpest(120)).toBeLessThan(5);
  });
});

describe('strokes and fills (#26, #27)', () => {
  it('a filled disc and a pen-drawn ring give one outline and one closed centreline', () => {
    const img = render(200, 100, (x, y) => Math.hypot(x - 50, y - 50) < 30 || Math.abs(Math.hypot(x - 150, y - 50) - 30) < 2.5);
    const paths = allPaths(runTrace(wasm, img, 200, 100));
    expect(paths.map((p) => [p.kind, p.isClosed])).toEqual(expect.arrayContaining([['fill', true], ['stroke', true]]));
    expect(paths).toHaveLength(2);
  });

  it('a ring traces to one closed path on its centre', () => {
    const paths = allPaths(runTrace(wasm, render(100, 100, (x, y) => Math.abs(Math.hypot(x - 50, y - 50) - 30) < 3), 100, 100));
    expect(paths).toHaveLength(1);
    expect(paths[0].isClosed).toBe(true);
    const worst = Math.max(...sample(paths[0].d).map((p) => Math.abs(Math.hypot(p.x - 50, p.y - 50) - 30)));
    expect(worst).toBeLessThan(0.5);
  });

  it('a 5 px stroke traces along its true centre, within a quarter pixel', () => {
    const paths = allPaths(runTrace(wasm, render(100, 60, (x, y) => x >= 10 && x < 90 && Math.abs(y - 30.3) < 2.5), 100, 60));
    expect(paths).toHaveLength(1);
    expect(paths[0].kind).toBe('stroke');
    for (const p of sample(paths[0].d)) expect(Math.abs(p.y - 30.3)).toBeLessThan(0.25);
  });

  it('a T-junction traces to connected paths with no gap', () => {
    const img = render(
      100,
      100,
      (x, y) => (x >= 10 && x < 90 && Math.abs(y - 20) < 2) || (Math.abs(x - 50) < 2 && y >= 20 && y < 90)
    );
    const paths = allPaths(runTrace(wasm, img, 100, 100));
    expect(paths).toHaveLength(2);
    const pts = paths.map((p) => sample(p.d));
    const bar = pts.find((ps) => ps.every((p) => Math.abs(p.y - 20) < 1))!;
    const stem = pts.find((ps) => ps !== bar)!;
    const ends = [stem[0], stem[stem.length - 1]];
    const gap = Math.min(...ends.map((e) => Math.min(...bar.map((b) => Math.hypot(b.x - e.x, b.y - e.y)))));
    expect(gap).toBeLessThan(0.2);
  });

  it('a stroke that runs off the image ends cleanly at the edge', () => {
    const paths = allPaths(runTrace(wasm, render(80, 40, (x, y) => x < 60 && Math.abs(y - 20) < 2), 80, 40));
    expect(paths).toHaveLength(1);
    const pts = sample(paths[0].d);
    for (const p of pts) expect(Math.abs(p.y - 20)).toBeLessThan(0.3);
    expect(Math.min(pts[0].x, pts[pts.length - 1].x)).toBeLessThan(0.5);
  });

  it('in Outline mode the same stroke is an outline, and the stroke width setting decides Auto', () => {
    const img = render(100, 60, (x, y) => x >= 10 && x < 90 && Math.abs(y - 30) < 2.5);
    expect(allPaths(runTrace(wasm, img, 100, 60, { shapes: 'outline' }))[0].kind).toBe('fill');
    // 5 px is 0.5 mm: a 0.3 mm limit makes it a fill.
    expect(allPaths(runTrace(wasm, img, 100, 60, { maxStrokeWidthMm: 0.3 }))[0].kind).toBe('fill');
    expect(allPaths(runTrace(wasm, img, 100, 60, { maxStrokeWidthMm: 0.8 }))[0].kind).toBe('stroke');
  });

  it('Centreline mode traces a filled shape along its middle', () => {
    const img = render(100, 60, (x, y) => x >= 10 && x < 90 && Math.abs(y - 30) < 10);
    expect(allPaths(runTrace(wasm, img, 100, 60, { shapes: 'centerline' })).every((p) => p.kind === 'stroke')).toBe(true);
  });
});

describe('nothing is truncated (#29)', () => {
  it('a grid of 9,801 dots returns every dot', () => {
    const img = render(500, 500, (x, y) => x % 5 >= 1 && x % 5 < 3 && y % 5 >= 1 && y % 5 < 3 && x < 495 && y < 495);
    expect(allPaths(runTrace(wasm, img, 500, 500)).length).toBe(99 * 99);
  });

  it('a 600 px comb is one valid closed path', () => {
    const img = render(600, 600, (x, y) => (y < 40 && x < 590) || (y < 590 && x < 590 && x % 6 < 3));
    const paths = allPaths(runTrace(wasm, img, 600, 600, { shapes: 'outline' }));
    expect(paths).toHaveLength(1);
    expect(paths[0].isClosed).toBe(true);
    // 98 teeth: the outline encloses the comb's area.
    const pts = sample(paths[0].d);
    const area = Math.abs(signedArea(pts));
    const expected = 590 * 40 + 99 * 3 * 550 - 3 * 0; // spine plus 99 teeth below it (x % 6 < 3 for x < 590)
    expect(Math.abs(area - expected) / expected).toBeLessThan(0.01);
  });

  it('a 1 px line survives the default settings', () => {
    const img = render(100, 30, (x, y) => x >= 5 && x < 95 && y >= 14 && y < 15);
    expect(allPaths(runTrace(wasm, img, 100, 30))).toHaveLength(1);
  });
});

describe('settings', () => {
  it('threshold decides which greys are ink', () => {
    const img = render(60, 30, () => false);
    for (let y = 5; y < 25; y++) for (let x = 5; x < 25; x++) img.fill(100, (y * 60 + x) * 4, (y * 60 + x) * 4 + 3);
    expect(allPaths(runTrace(wasm, img, 60, 30, { threshold: 128 }))).toHaveLength(1);
    expect(allPaths(runTrace(wasm, img, 60, 30, { threshold: 90 }))).toHaveLength(0);
  });

  it('invert traces the light areas', () => {
    const img = render(60, 60, (x, y) => !(x >= 20 && x < 40 && y >= 20 && y < 40));
    expect(allPaths(runTrace(wasm, img, 60, 60, { invert: true, shapes: 'outline' }))).toHaveLength(1);
  });

  it('specks and holes below the minimum area are dropped, others kept', () => {
    // A 2x2 px speck (0.04 mm²) and a 20x20 square with a 2x2 hole.
    const img = render(64, 64, (x, y) => {
      const speck = x >= 5 && x < 7 && y >= 5 && y < 7;
      const hole = x >= 30 && x < 32 && y >= 30 && y < 32;
      return speck || (x >= 20 && x < 40 && y >= 20 && y < 40 && !hole);
    });
    expect(allPaths(runTrace(wasm, img, 64, 64, { shapes: 'outline', minAreaMm2: 0 }))).toHaveLength(3);
    expect(allPaths(runTrace(wasm, img, 64, 64, { shapes: 'outline', minAreaMm2: 0.05 }))).toHaveLength(1);
  });

  it('denoise removes grain but keeps a shape in place', () => {
    // A dark square on a mid-grey ground, both with grain of ±60 levels.
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const [w, h] = [120, 120];
    const img = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const base = x >= 30 && x < 90 && y >= 30 && y < 90 ? 80 : 175;
        const v = Math.max(0, Math.min(255, Math.round(base + (rnd() - 0.5) * 120)));
        img.fill(v, (y * w + x) * 4, (y * w + x) * 4 + 3);
        img[(y * w + x) * 4 + 3] = 255;
      }
    }
    const noisy = allPaths(runTrace(wasm, img, w, h, { shapes: 'outline' })).length;
    const smoothed = allPaths(runTrace(wasm, img, w, h, { shapes: 'outline', denoiseMm: 0.3 }));
    expect(noisy).toBeGreaterThan(10);
    expect(smoothed).toHaveLength(1);
    const xs = sample(smoothed[0].d).map((p) => p.x);
    expect(Math.abs(Math.min(...xs) - 30)).toBeLessThan(1);
    expect(Math.abs(Math.max(...xs) - 90)).toBeLessThan(1);
  });

  it('a 2 mm cutline lies 2 mm outside the shape', () => {
    const img = render(120, 120, (x, y) => Math.hypot(x - 60, y - 60) < 20);
    const result = runTrace(wasm, img, 120, 120, { cutline: true, cutlineOffsetMm: 2 });
    const cut = result.layers.find((l) => l.id === 'cutline')!;
    expect(cut.paths).toHaveLength(1);
    expect(cut.paths[0].kind).toBe('cut');
    // Within 0.07 mm (0.7 px at 10 px/mm).
    for (const p of sample(cut.paths[0].d)) expect(Math.abs(Math.hypot(p.x - 60, p.y - 60) - 40)).toBeLessThan(0.7);
  });

  it('the cutline distance sets how far out it lies', () => {
    const img = render(160, 160, (x, y) => Math.hypot(x - 80, y - 80) < 20);
    const radius = (cutlineOffsetMm: number) => {
      const cut = runTrace(wasm, img, 160, 160, { cutline: true, cutlineOffsetMm }).layers.find((l) => l.id === 'cutline')!;
      return Math.max(...sample(cut.paths[0].d).map((p) => Math.hypot(p.x - 80, p.y - 80)));
    };
    expect(radius(5) - radius(1)).toBeCloseTo(40, 0);
  });

  it('a cutline does not cut holes', () => {
    const img = render(140, 140, (x, y) => Math.abs(Math.hypot(x - 70, y - 70) - 40) < 8);
    const result = runTrace(wasm, img, 140, 140, { shapes: 'outline', cutline: true, cutlineOffsetMm: 1 });
    expect(result.layers.find((l) => l.id === 'cutline')!.paths).toHaveLength(1);
  });

  it('a trace needs a size', () => {
    expect(() => runTrace(wasm, render(10, 10, () => false), 10, 10, {}, 0)).toThrow(/size/);
  });
});
