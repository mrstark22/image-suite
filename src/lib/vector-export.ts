import type { VectorLayer, VectorResult } from '../types/vector';

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

function requireScale(result: VectorResult): number {
  if (result.pxPerMm === null || !(result.pxPerMm > 0)) {
    throw new Error('This trace has no physical size. Set the size of the image and trace again.');
  }
  return result.pxPerMm;
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

function scaledPathData(d: string, s: number): string {
  return parsePathData(d)
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
  const { widthMm, heightMm } = traceSizeMm(result);
  const s = 1 / ppm;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.1" width="${fmt(widthMm)}mm" height="${fmt(heightMm)}mm" viewBox="0 0 ${fmt(widthMm)} ${fmt(heightMm)}">`,
  ];
  for (const layer of shown(result)) {
    lines.push(
      `  <g id="${escapeXml(layer.id)}" inkscape:groupmode="layer" inkscape:label="${escapeXml(layer.name)}" fill="none" stroke="${escapeXml(layer.color)}" stroke-width="${SVG_STROKE_MM}" stroke-linecap="round" stroke-linejoin="round">`
    );
    for (const p of layer.paths) {
      lines.push(`    <path id="${escapeXml(p.id)}" d="${scaledPathData(p.d, s)}" />`);
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
export function pathPolylines(d: string, mmPerPx: number): Array<{ pts: Pt[]; closed: boolean }> {
  const out: Array<{ pts: Pt[]; closed: boolean }> = [];
  let cur: Pt[] = [];
  const s = (p: Pt) => ({ x: p.x * mmPerPx, y: p.y * mmPerPx });
  const flush = (closed: boolean) => {
    if (cur.length >= 2) out.push({ pts: cur, closed });
    cur = [];
  };
  for (const c of parsePathData(d)) {
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

/** AutoCAD colour indexes 1 to 7 and 8, 9, with their colours. */
const ACI: Array<[number, [number, number, number]]> = [
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

/**
 * A colour index for each layer: the nearest standard colour not already
 * taken by another layer, so layers stay distinct in the laser software.
 */
export function layerColourIndexes(colors: string[]): number[] {
  const used = new Set<number>();
  return colors.map((hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '000000';
    const rgb = [0, 2, 4].map((k) => parseInt(m.slice(k, k + 2), 16));
    const ranked = [...ACI].sort(
      (a, b) =>
        a[1].reduce((s, v, k) => s + (v - rgb[k]) ** 2, 0) - b[1].reduce((s, v, k) => s + (v - rgb[k]) ** 2, 0)
    );
    const pick = ranked.find(([i]) => !used.has(i)) ?? ranked[0];
    used.add(pick[0]);
    return pick[0];
  });
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
  const { widthMm, heightMm } = traceSizeMm(result);
  const layers = shown(result);
  const names = layers.map((l, i) => `${dxfName(l.name)}${layers.findIndex((m) => dxfName(m.name) === dxfName(l.name)) === i ? '' : `_${i + 1}`}`);
  const colours = layerColourIndexes(layers.map((l) => l.color));
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
  g(9, '$EXTMIN');
  g(10, 0);
  g(20, 0);
  g(9, '$EXTMAX');
  g(10, widthMm);
  g(20, heightMm);
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
      for (const poly of pathPolylines(path.d, 1 / ppm)) {
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
