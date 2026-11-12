import type { VectorLayer, VectorPath, VectorResult } from '../types/vector';
import { rgbOfHex } from './trace-palette';

/**
 * SVG and DXF export of a trace at its physical size (#30). Paths are traced
 * in pixels; both files are written in millimetres, using the trace's pixels
 * per millimetre. Hidden layers are left out.
 */

interface Pt {
  x: number;
  y: number;
}

type Cmd = { op: 'M' | 'L'; p: Pt } | { op: 'C'; c1: Pt; c2: Pt; p: Pt } | { op: 'Z' };

/** Parses the tracer's path data (absolute M, L, C and Z only). */
export function parsePathData(d: string): Cmd[] {
  const tokens = d.trim().split(/[\s,]+/).filter(Boolean);
  const cmds: Cmd[] = [];
  let i = 0;
  const num = () => {
    const v = Number(tokens[i++]);
    if (!Number.isFinite(v)) throw new Error(`Bad number in path data: ${tokens[i - 1]}`);
    return v;
  };
  const pt = () => ({ x: num(), y: num() });
  while (i < tokens.length) {
    const op = tokens[i++];
    if (op === 'M' || op === 'L') cmds.push({ op, p: pt() });
    else if (op === 'C') cmds.push({ op, c1: pt(), c2: pt(), p: pt() });
    else if (op === 'Z') cmds.push({ op });
    else throw new Error(`Unexpected path command: ${op}`);
  }
  return cmds;
}

/**
 * Each path's commands, parsed once per path object: an export reads every
 * path twice (for the page bounds and for the output), and a full-resolution
 * trace can have hundreds of thousands of nodes (review of #84).
 */
const parsed = new WeakMap<VectorPath, Cmd[]>();
function cmdsOf(path: VectorPath): Cmd[] {
  let cmds = parsed.get(path);
  if (!cmds) {
    cmds = parsePathData(path.d);
    parsed.set(path, cmds);
  }
  return cmds;
}

function requireScale(result: VectorResult): number {
  if (result.pxPerMm === null || !(result.pxPerMm > 0)) {
    throw new Error('This trace has no physical size. Set the size of the image and trace again.');
  }
  return result.pxPerMm;
}

/** The parameters in (0, 1) where one coordinate of a cubic Bézier turns round. */
function cubicTurns(p0: number, p1: number, p2: number, p3: number): number[] {
  // The derivative is a quadratic: a t² + b t + c.
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const r = Math.sqrt(disc);
      roots.push((-b + r) / (2 * a), (-b - r) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

const cubicAt = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const m = 1 - t;
  return m * m * m * p0 + 3 * m * m * t * p1 + 3 * m * t * t * p2 + t * t * t * p3;
};

/**
 * The page of an export, in millimetres: the image, grown to take in any
 * path that lies outside it (a cutline around artwork that reaches the edge
 * of the image). `x` and `y` are negative when the page starts left of or
 * above the image (review of #84). Curves count by where they run, not by
 * their control points, which lie outside the curve; the tracer keeps
 * artwork inside the image, so a file without a cutline is the image's size.
 */
export function tracePageMm(result: VectorResult): { x: number; y: number; widthMm: number; heightMm: number } {
  const ppm = requireScale(result);
  let [x0, y0, x1, y1] = [0, 0, result.dimensions.width, result.dimensions.height];
  for (const layer of shown(result)) {
    for (const p of layer.paths) {
      let cur: Pt = { x: 0, y: 0 };
      const take = (x: number, y: number) => {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      };
      for (const c of cmdsOf(p)) {
        if (c.op === 'Z') continue;
        if (c.op === 'C') {
          const from = cur;
          for (const t of cubicTurns(from.x, c.c1.x, c.c2.x, c.p.x)) take(cubicAt(from.x, c.c1.x, c.c2.x, c.p.x, t), from.y);
          for (const t of cubicTurns(from.y, c.c1.y, c.c2.y, c.p.y)) take(from.x, cubicAt(from.y, c.c1.y, c.c2.y, c.p.y, t));
        }
        take(c.p.x, c.p.y);
        cur = c.p;
      }
    }
  }
  return { x: x0 / ppm, y: y0 / ppm, widthMm: (x1 - x0) / ppm, heightMm: (y1 - y0) / ppm };
}

/** The trace's width and height in millimetres. */
export function traceSizeMm(result: VectorResult): { widthMm: number; heightMm: number } {
  const ppm = requireScale(result);
  return { widthMm: result.dimensions.width / ppm, heightMm: result.dimensions.height / ppm };
}

const fmt = (v: number) => {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};

function scaledPathData(cmds: Cmd[], s: number): string {
  return cmds
    .map((c) => {
      switch (c.op) {
        case 'M':
        case 'L':
          return `${c.op} ${fmt(c.p.x * s)} ${fmt(c.p.y * s)}`;
        case 'C':
          return `C ${fmt(c.c1.x * s)} ${fmt(c.c1.y * s)} ${fmt(c.c2.x * s)} ${fmt(c.c2.y * s)} ${fmt(c.p.x * s)} ${fmt(c.p.y * s)}`;
        case 'Z':
          return 'Z';
      }
    })
    .join(' ');
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const shown = (result: VectorResult): VectorLayer[] => result.layers.filter((l) => l.visible && l.paths.length > 0);

/** Width of the drawn line in the SVG, in mm: a hairline, so it does not hide detail. */
const SVG_STROKE_MM = 0.1;

/**
 * The trace as an SVG measuring its physical size: `width` and `height` in
 * millimetres, a viewBox in millimetres, one group per visible layer drawn
 * in the layer's colour.
 */
export function traceToSvg(result: VectorResult): string {
  const ppm = requireScale(result);
  const page = tracePageMm(result);
  const s = 1 / ppm;
  // The viewBox keeps the image's own coordinates, so the image's top left stays at 0, 0.
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.1" width="${fmt(page.widthMm)}mm" height="${fmt(page.heightMm)}mm" viewBox="${fmt(page.x)} ${fmt(page.y)} ${fmt(page.widthMm)} ${fmt(page.heightMm)}">`,
  ];
  for (const layer of shown(result)) {
    lines.push(
      `  <g id="${escapeXml(layer.id)}" inkscape:groupmode="layer" inkscape:label="${escapeXml(layer.name)}" fill="none" stroke="${escapeXml(layer.color)}" stroke-width="${SVG_STROKE_MM}" stroke-linecap="round" stroke-linejoin="round">`
    );
    for (const p of layer.paths) {
      lines.push(`    <path id="${escapeXml(p.id)}" d="${scaledPathData(cmdsOf(p), s)}" />`);
    }
    lines.push('  </g>');
  }
  lines.push('</svg>');
  return lines.join('\n');
}

/** Largest distance, in mm, between a curve and the polyline written for it in a DXF. */
const DXF_FLATNESS_MM = 0.005;

function flattenCubic(p0: Pt, c1: Pt, c2: Pt, p3: Pt, out: Pt[], depth = 0): void {
  // Control points within the flatness of the chord: the curve is too.
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const len = Math.hypot(dx, dy) || 1e-12;
  const d1 = Math.abs((c1.x - p0.x) * dy - (c1.y - p0.y) * dx) / len;
  const d2 = Math.abs((c2.x - p0.x) * dy - (c2.y - p0.y) * dx) / len;
  if (depth >= 16 || Math.max(d1, d2) * 0.75 <= DXF_FLATNESS_MM) {
    out.push(p3);
    return;
  }
  const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const a = mid(p0, c1);
  const b = mid(c1, c2);
  const c = mid(c2, p3);
  const ab = mid(a, b);
  const bc = mid(b, c);
  const m = mid(ab, bc);
  flattenCubic(p0, a, ab, m, out, depth + 1);
  flattenCubic(m, bc, c, p3, out, depth + 1);
}

/** The subpaths of path data as polylines in millimetres, with whether each is closed. */
export function pathPolylines(d: string | Cmd[], mmPerPx: number): Array<{ pts: Pt[]; closed: boolean }> {
  const out: Array<{ pts: Pt[]; closed: boolean }> = [];
  let cur: Pt[] = [];
  const s = (p: Pt) => ({ x: p.x * mmPerPx, y: p.y * mmPerPx });
  const flush = (closed: boolean) => {
    if (cur.length >= 2) out.push({ pts: cur, closed });
    cur = [];
  };
  for (const c of typeof d === 'string' ? parsePathData(d) : d) {
    if (c.op === 'M') {
      flush(false);
      cur.push(s(c.p));
    } else if (c.op === 'L') {
      cur.push(s(c.p));
    } else if (c.op === 'C') {
      flattenCubic(cur[cur.length - 1], s(c.c1), s(c.c2), s(c.p), cur);
    } else {
      // A closed polyline does not repeat its first vertex.
      const first = cur[0];
      const last = cur[cur.length - 1];
      if (cur.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) cur.pop();
      flush(true);
    }
  }
  flush(false);
  return out;
}

/**
 * The AutoCAD Colour Index (ACI) colours 1 to 255: 1 to 9 are the standard
 * colours; 10 to 249 are 24 hues 15° apart, each in five shades at full and
 * half saturation; 250 to 255 are greys.
 */
function aciTable(): Array<[number, [number, number, number]]> {
  const table: Array<[number, [number, number, number]]> = [
    [1, [255, 0, 0]],
    [2, [255, 255, 0]],
    [3, [0, 255, 0]],
    [4, [0, 255, 255]],
    [5, [0, 0, 255]],
    [6, [255, 0, 255]],
    [7, [0, 0, 0]],
    [8, [128, 128, 128]],
    [9, [192, 192, 192]],
  ];
  const values = [1, 0.8, 0.6, 0.5, 0.3];
  for (let i = 10; i <= 249; i++) {
    const hue = Math.floor((i - 10) / 10) * 15;
    const shade = (i % 10) >> 1;
    const sat = i % 2 === 0 ? 1 : 0.5;
    table.push([i, hsvToRgb(hue, sat, values[shade])]);
  }
  [51, 91, 132, 173, 214, 255].forEach((g, k) => table.push([250 + k, [g, g, g]]));
  return table;
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}

const ACI = aciTable();

/**
 * A colour index for each layer: the nearest ACI colour not already taken by
 * another layer, so every layer stays distinct in the laser software (up to
 * 255 layers). Layers listed in `first` choose before the others, so the
 * cutline keeps red even after a red artwork layer (review of #84).
 */
export function layerColourIndexes(colors: string[], first: number[] = []): number[] {
  const used = new Set<number>();
  const out = new Array<number>(colors.length);
  const order = [...first, ...colors.map((_, i) => i).filter((i) => !first.includes(i))];
  for (const i of order) {
    const rgb = rgbOfHex(colors[i]);
    let best = 0;
    let bestD = Infinity;
    for (const [aci, c] of ACI) {
      if (used.has(aci)) continue;
      const d = c.reduce((s, v, k) => s + (v - rgb[k]) ** 2, 0);
      if (d < bestD) {
        bestD = d;
        best = aci;
      }
    }
    used.add(best);
    out[i] = best;
  }
  return out;
}

const dxfName = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 31) || 'LAYER';

/**
 * The trace as an ASCII DXF (R12 entities) in millimetres: `$INSUNITS` 4 and
 * `$MEASUREMENT` 1 declare the units, y points up, each visible layer is a
 * DXF layer with its own colour, and each path is a POLYLINE (closed by its
 * flag, without a repeated vertex). Curves are written as polylines within
 * 0.005 mm.
 */
export function traceToDxf(result: VectorResult): string {
  const ppm = requireScale(result);
  const { heightMm } = traceSizeMm(result);
  const page = tracePageMm(result);
  const layers = shown(result);
  const names = layers.map((l, i) => `${dxfName(l.name)}${layers.findIndex((m) => dxfName(m.name) === dxfName(l.name)) === i ? '' : `_${i + 1}`}`);
  const cutFirst = layers.flatMap((l, i) => (l.paths.some((p) => p.kind === 'cut') ? [i] : []));
  const colours = layerColourIndexes(layers.map((l) => l.color), cutFirst);
  const o: string[] = [];
  const g = (code: number, value: string | number) => o.push(String(code), typeof value === 'number' ? fmt(value) : value);

  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSUNITS');
  g(70, 4);
  g(9, '$MEASUREMENT');
  g(70, 1);
  // Extents of everything drawn, with y up: the image's bottom edge is at y = 0.
  g(9, '$EXTMIN');
  g(10, page.x);
  g(20, heightMm - (page.y + page.heightMm));
  g(9, '$EXTMAX');
  g(10, page.x + page.widthMm);
  g(20, heightMm - page.y);
  g(0, 'ENDSEC');

  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, layers.length);
  layers.forEach((_, i) => {
    g(0, 'LAYER');
    g(2, names[i]);
    g(70, 0);
    g(62, colours[i]);
    g(6, 'CONTINUOUS');
  });
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION');
  g(2, 'ENTITIES');
  layers.forEach((layer, i) => {
    for (const path of layer.paths) {
      for (const poly of pathPolylines(cmdsOf(path), 1 / ppm)) {
        g(0, 'POLYLINE');
        g(8, names[i]);
        g(66, 1);
        g(70, poly.closed ? 1 : 0);
        for (const p of poly.pts) {
          g(0, 'VERTEX');
          g(8, names[i]);
          g(10, p.x);
          g(20, heightMm - p.y);
        }
        g(0, 'SEQEND');
        g(8, names[i]);
      }
    }
  });
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return o.join('\n') + '\n';
}
