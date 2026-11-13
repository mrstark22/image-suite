/**
 * Synthetic 3D scans of a relief depth card (#61), built from the card's own
 * layout: a flat surface with the ramp's steps sunk to planted depths, walls
 * at a planted angle, shallow lettering and squares, noise, holes, then
 * turned, mirrored, tilted, moved and scaled to file units. Writers put the
 * same points into every supported file format.
 */
import type { CardSpec } from '../../src/types/calibration-card';
import { cardLayout, renderCard } from '../../src/lib/calibration-cards';

export interface SyntheticOptions {
  /** Depth of each step in mm. */
  depths: number[];
  points: number;
  /** Rotation about the surface normal, degrees. */
  angleDeg?: number;
  mirrored?: boolean;
  /** Tilt of the surface, degrees, about an axis at `tiltAxisDeg` in the scan's xy plane. */
  tiltDeg?: number;
  tiltAxisDeg?: number;
  /** Mm per file unit: 1 for millimetres, 1000 for metres. */
  mmPerUnit?: number;
  noiseMm?: number;
  /** Wall angle from the surface, degrees. */
  wallDeg?: number;
  /** Depth of lettering and the squares, mm. */
  textDepthMm?: number;
  /** Share of points dropped in each step (dark wood scans badly), by step index. */
  dropout?: Record<number, number>;
  /** File-unit translation. */
  offset?: [number, number, number];
  seed?: number;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The true depth in mm at card (x, y). */
export function trueDepth(spec: CardSpec, o: Pick<SyntheticOptions, 'depths' | 'wallDeg' | 'textDepthMm'>, text: { e: Float32Array; w: number; h: number; ppm: number }) {
  const ramp = cardLayout(spec).cells.find((b) => b.cell.role === 'ramp')!;
  const slope = Math.tan(((o.wallDeg ?? 70) * Math.PI) / 180);
  return (x: number, y: number) => {
    if (x >= ramp.x && x <= ramp.x + ramp.w && y >= ramp.y && y <= ramp.y + ramp.h) {
      const i = Math.min(spec.levels.length - 1, Math.floor((x - ramp.x) / spec.stepMm));
      const d = o.depths[i];
      // Walls on the ramp's long edges and its two ends rise at the planted angle.
      const edge = Math.min(y - ramp.y, ramp.y + ramp.h - y, x - ramp.x, ramp.x + ramp.w - x);
      return Math.min(d, edge * slope);
    }
    const px = Math.floor(x * text.ppm);
    const py = Math.floor(y * text.ppm);
    if (px < 0 || py < 0 || px >= text.w || py >= text.h) return 0;
    return text.e[py * text.w + px] * (o.textDepthMm ?? 0.12);
  };
}

/** Points of a synthetic scan, in file units. */
export function syntheticScan(spec: CardSpec, o: SyntheticOptions): Float32Array {
  const layout = cardLayout(spec);
  const r = renderCard(spec, 4);
  const e = new Float32Array(r.width * r.height);
  const ramp = layout.cells.find((b) => b.cell.role === 'ramp')!;
  for (let i = 0; i < e.length; i++) e[i] = 1 - r.rgba[i * 4] / 255;
  const depth = trueDepth(spec, o, { e, w: r.width, h: r.height, ppm: 4 });
  const rand = rng(o.seed ?? 7);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const a = ((o.angleDeg ?? 0) * Math.PI) / 180;
  const tilt = ((o.tiltDeg ?? 0) * Math.PI) / 180;
  const ta = ((o.tiltAxisDeg ?? 30) * Math.PI) / 180;
  // Rodrigues rotation about the axis (cos ta, sin ta, 0).
  const k = [Math.cos(ta), Math.sin(ta), 0];
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const s = 1 / (o.mmPerUnit ?? 1);
  const off = o.offset ?? [0, 0, 0];
  const out = new Float32Array(o.points * 3);
  let n = 0;
  while (n < o.points) {
    const x = rand() * layout.widthMm;
    const y = rand() * layout.heightMm;
    if (o.dropout && x >= ramp.x && x <= ramp.x + ramp.w && y >= ramp.y && y <= ramp.y + ramp.h) {
      const i = Math.min(spec.levels.length - 1, Math.floor((x - ramp.x) / spec.stepMm));
      if (rand() < (o.dropout[i] ?? 0)) continue;
    }
    const z = -depth(x, y) + gauss() * (o.noiseMm ?? 0.02);
    // Card y runs down; seen from above (+z) the scan's y runs up.
    const yy = o.mirrored ? y : -y;
    const px = Math.cos(a) * x - Math.sin(a) * yy;
    const py = Math.sin(a) * x + Math.cos(a) * yy;
    const v = [px, py, z];
    const kv = k[0] * v[0] + k[1] * v[1];
    const kx = [k[1] * v[2], -k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
    const rot = [0, 1, 2].map((j) => v[j] * ct + kx[j] * st + k[j] * kv * (1 - ct));
    out[n * 3] = rot[0] * s + off[0];
    out[n * 3 + 1] = rot[1] * s + off[1];
    out[n * 3 + 2] = rot[2] * s + off[2];
    n++;
  }
  return out;
}

// ─── Writers ─────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const num = (v: number) => v.toPrecision(9);

/** Binary STL: each three points in order are one triangle. */
export function toStlBinary(p: Float32Array): ArrayBuffer {
  const tris = Math.floor(p.length / 9);
  const buf = new ArrayBuffer(84 + tris * 50);
  const v = new DataView(buf);
  v.setUint32(80, tris, true);
  for (let t = 0; t < tris; t++) {
    const o = 84 + t * 50;
    for (let k = 0; k < 9; k++) v.setFloat32(o + 12 + k * 4, p[t * 9 + k], true);
  }
  return buf;
}

export function toStlAscii(p: Float32Array): ArrayBuffer {
  const parts = ['solid card\n'];
  for (let t = 0; t < p.length / 9; t++) {
    parts.push(' facet normal 0 0 1\n  outer loop\n');
    for (let k = 0; k < 3; k++) parts.push(`   vertex ${num(p[t * 9 + k * 3])} ${num(p[t * 9 + k * 3 + 1])} ${num(p[t * 9 + k * 3 + 2])}\n`);
    parts.push('  endloop\n endfacet\n');
  }
  parts.push('endsolid card\n');
  return enc.encode(parts.join('')).buffer as ArrayBuffer;
}

/** ASCII PLY with a colour per vertex and, if `faces`, a face per three points. */
export function toPlyAscii(p: Float32Array, faces: boolean): ArrayBuffer {
  const n = p.length / 3;
  const f = faces ? Math.floor(n / 3) : 0;
  const parts = [`ply\nformat ascii 1.0\ncomment synthetic\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nelement face ${f}\nproperty list uchar int vertex_indices\nend_header\n`];
  for (let i = 0; i < n; i++) parts.push(`${num(p[i * 3])} ${num(p[i * 3 + 1])} ${num(p[i * 3 + 2])} 128\n`);
  for (let i = 0; i < f; i++) parts.push(`3 ${i * 3} ${i * 3 + 1} ${i * 3 + 2}\n`);
  return enc.encode(parts.join('')).buffer as ArrayBuffer;
}

/** Binary little-endian PLY with normals and colour between the coordinates, and faces after. */
export function toPlyBinary(p: Float32Array, faces: boolean): ArrayBuffer {
  const n = p.length / 3;
  const f = faces ? Math.floor(n / 3) : 0;
  const head = enc.encode(`ply\nformat binary_little_endian 1.0\nelement vertex ${n}\nproperty float x\nproperty float nx\nproperty float y\nproperty uchar red\nproperty float z\nelement face ${f}\nproperty list uchar int vertex_indices\nend_header\n`);
  const stride = 17;
  const buf = new ArrayBuffer(head.length + n * stride + f * 13);
  new Uint8Array(buf).set(head);
  const v = new DataView(buf);
  let o = head.length;
  for (let i = 0; i < n; i++, o += stride) {
    v.setFloat32(o, p[i * 3], true);
    v.setFloat32(o + 4, 0, true);
    v.setFloat32(o + 8, p[i * 3 + 1], true);
    v.setUint8(o + 12, 200);
    v.setFloat32(o + 13, p[i * 3 + 2], true);
  }
  for (let i = 0; i < f; i++, o += 13) {
    v.setUint8(o, 3);
    for (let k = 0; k < 3; k++) v.setInt32(o + 1 + k * 4, i * 3 + k, true);
  }
  return buf;
}

export function toObj(p: Float32Array): ArrayBuffer {
  const n = p.length / 3;
  const parts = ['# synthetic card\no card\n'];
  for (let i = 0; i < n; i++) parts.push(`v ${num(p[i * 3])} ${num(p[i * 3 + 1])} ${num(p[i * 3 + 2])}\nvn 0 0 1\n`);
  for (let i = 0; i + 2 < n; i += 3) parts.push(`f ${i + 1}//${i + 1} ${i + 2}//${i + 2} ${i + 3}//${i + 3}\n`);
  return enc.encode(parts.join('')).buffer as ArrayBuffer;
}
