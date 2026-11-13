/**
 * Measures a relief depth card from a 3D scan (#61).
 *
 * 1. Fit a plane to the unburned surface: RANSAC on a sample of the points,
 *    then iterated least squares on the points within 3 robust standard
 *    deviations, so the burned pockets do not tilt the fit.
 * 2. Express every point as depth below that plane and bin the points into
 *    a top-down height grid (the mean of each cell), so the rest of the work
 *    is on a grid of at most about a million cells, whatever the point count.
 * 3. Infer the units from the ramp's known height (15 mm on the card).
 * 4. Align the card layout to the grid: the ramp's long axis gives the
 *    angle; each of the 4 rotations and 2 mirror states is scored by how
 *    well the card's expected burn (its own rendering) correlates with the
 *    measured depth, over a search of positions, then the best is refined.
 * 5. Measure each step: the median depth of the samples well inside it
 *    (walls ignored), how many samples, the floor's spread, and the wall
 *    angle where the edge is resolved.
 *
 * Pure functions: the scan worker runs them; the tests drive them directly.
 */
import type { CardSpec } from '../types/calibration-card';
import { cardLayout, renderCard, type CellBox } from './calibration-cards';
import type { ScanFormat, ScanPoints } from './scan-parse';

type Vec3 = [number, number, number];

// ─── Plane ───────────────────────────────────────────────────────────────

export interface PlaneFit {
  centroid: Vec3;
  /** Unit normal pointing out of the surface, away from the burned pockets. */
  normal: Vec3;
  /** Robust standard deviation of the surface about the plane, in file units. */
  sigma: number;
  /** Share of the sampled points on the surface. */
  inlierShare: number;
}

/** A small deterministic random generator, so a scan always measures the same. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The eigenvector of the smallest eigenvalue of a symmetric 3×3 matrix (Jacobi rotations). */
function smallestEigenvector(m: number[][]): Vec3 {
  const a = m.map((r) => r.slice());
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p++)
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  let i = 0;
  for (let k = 1; k < 3; k++) if (a[k][k] < a[i][i]) i = k;
  return norm([v[0][i], v[1][i], v[2][i]]);
}

function median(values: number[] | Float64Array): number {
  const s = Float64Array.from(values).sort();
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function quantile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return NaN;
  const t = q * (sorted.length - 1);
  const i = Math.floor(t);
  return i + 1 < sorted.length ? sorted[i] + (sorted[i + 1] - sorted[i]) * (t - i) : sorted[i];
}

/** Fits the unburned surface's plane. Throws when the scan has no flat surface. */
export function fitPlane(xyz: Float32Array, count: number, maxSample = 40000): PlaneFit {
  const rand = lcg(12345);
  const n = Math.min(count, maxSample);
  const S = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = count <= maxSample ? i : Math.floor(rand() * count);
    S[i * 3] = xyz[k * 3];
    S[i * 3 + 1] = xyz[k * 3 + 1];
    S[i * 3 + 2] = xyz[k * 3 + 2];
  }
  const P = (i: number): Vec3 => [S[i * 3], S[i * 3 + 1], S[i * 3 + 2]];
  let lo: Vec3 = [Infinity, Infinity, Infinity];
  let hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], S[i * 3 + k]);
    hi[k] = Math.max(hi[k], S[i * 3 + k]);
  }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  if (!(diag > 0)) throw new Error('The scan’s points are all in one place.');

  // RANSAC: the plane through three samples that the most samples lie on.
  const t0 = diag * 0.003;
  let best: { c: Vec3; n: Vec3; inliers: number } | null = null;
  for (let it = 0; it < 400; it++) {
    const a = P(Math.floor(rand() * n));
    const b = P(Math.floor(rand() * n));
    const c = P(Math.floor(rand() * n));
    const nn = cross(sub(b, a), sub(c, a));
    const l = Math.hypot(nn[0], nn[1], nn[2]);
    if (l < diag * diag * 1e-4) continue;
    const nv: Vec3 = [nn[0] / l, nn[1] / l, nn[2] / l];
    let inliers = 0;
    for (let i = 0; i < n; i += 4) if (Math.abs((S[i * 3] - a[0]) * nv[0] + (S[i * 3 + 1] - a[1]) * nv[1] + (S[i * 3 + 2] - a[2]) * nv[2]) < t0) inliers++;
    if (!best || inliers > best.inliers) best = { c: a, n: nv, inliers };
  }
  if (!best) throw new Error('The scan has no flat surface to measure from.');

  // Iterated least squares on the points near the plane.
  let centroid = best.c;
  let normal = best.n;
  let thresh = t0;
  let sigma = t0;
  let share = 0;
  const r = new Float64Array(n);
  for (let iter = 0; iter < 8; iter++) {
    for (let i = 0; i < n; i++) r[i] = (S[i * 3] - centroid[0]) * normal[0] + (S[i * 3 + 1] - centroid[1]) * normal[1] + (S[i * 3 + 2] - centroid[2]) * normal[2];
    const c: Vec3 = [0, 0, 0];
    let m = 0;
    for (let i = 0; i < n; i++) if (Math.abs(r[i]) < thresh) {
      c[0] += S[i * 3];
      c[1] += S[i * 3 + 1];
      c[2] += S[i * 3 + 2];
      m++;
    }
    if (m < 10) break;
    c[0] /= m;
    c[1] /= m;
    c[2] /= m;
    const C = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const abs: number[] = [];
    for (let i = 0; i < n; i++) if (Math.abs(r[i]) < thresh) {
      const d = [S[i * 3] - c[0], S[i * 3 + 1] - c[1], S[i * 3 + 2] - c[2]];
      for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) C[p][q] += d[p] * d[q];
    }
    let nv = smallestEigenvector(C);
    if (dot(nv, normal) < 0) nv = [-nv[0], -nv[1], -nv[2]];
    centroid = c;
    normal = nv;
    for (let i = 0; i < n; i++) {
      r[i] = (S[i * 3] - c[0]) * nv[0] + (S[i * 3 + 1] - c[1]) * nv[1] + (S[i * 3 + 2] - c[2]) * nv[2];
      if (Math.abs(r[i]) < thresh) abs.push(Math.abs(r[i]));
    }
    sigma = Math.max(1.4826 * median(abs), diag * 1e-6);
    share = abs.length / n;
    thresh = 3 * sigma;
  }

  // The pockets go into the surface: the normal points the other way.
  let below = 0;
  let above = 0;
  for (let i = 0; i < n; i++) {
    if (r[i] < -5 * sigma) below++;
    else if (r[i] > 5 * sigma) above++;
  }
  if (above > below) normal = [-normal[0], -normal[1], -normal[2]];
  return { centroid, normal, sigma, inlierShare: share };
}

/** How far the plane's normal is from the file's z axis, in degrees. */
export function tiltDeg(p: PlaneFit): number {
  return (Math.acos(Math.min(1, Math.abs(p.normal[2]))) * 180) / Math.PI;
}

// ─── Units ───────────────────────────────────────────────────────────────

export interface ScanUnits {
  /** Millimetres per file unit. */
  mmPerUnit: number;
  /** "millimetres", "metres", ... or "unitless". */
  name: string;
  /** How the units were decided, in words for the user. */
  how: string;
  /** True when the user chose them. */
  chosen: boolean;
}

export const UNIT_CHOICES: { mmPerUnit: number; name: string }[] = [
  { mmPerUnit: 1, name: 'millimetres' },
  { mmPerUnit: 10, name: 'centimetres' },
  { mmPerUnit: 25.4, name: 'inches' },
  { mmPerUnit: 1000, name: 'metres' },
];

/** The named unit within 15 % of a scale measured from the card, or the measured scale itself. */
export function snapUnits(measured: number, what: string): ScanUnits {
  let best = UNIT_CHOICES[0];
  for (const u of UNIT_CHOICES) if (Math.abs(Math.log(measured / u.mmPerUnit)) < Math.abs(Math.log(measured / best.mmPerUnit))) best = u;
  if (Math.abs(Math.log(measured / best.mmPerUnit)) < Math.log(1.15))
    return { mmPerUnit: best.mmPerUnit, name: best.name, how: `Assumed ${best.name}: ${what}.`, chosen: false };
  return { mmPerUnit: measured, name: 'unitless', how: `The file’s units match no common unit, so it is scaled to the card: ${what}. Depths are as accurate as that size.`, chosen: false };
}

// ─── Grid ────────────────────────────────────────────────────────────────

/** A top-down height grid in the plane's frame: u to the right, w down, seen from above the surface. */
export interface HeightGrid {
  width: number;
  height: number;
  cellMm: number;
  u0: number;
  w0: number;
  /** Mean depth below the plane in mm, NaN where no point fell. */
  depth: Float32Array;
  /** Points in each cell. */
  count: Uint32Array;
}

interface Frame {
  c: Vec3;
  n: Vec3;
  eu: Vec3;
  ew: Vec3;
}

function frameOf(p: PlaneFit): Frame {
  const n = p.normal;
  // u: the file's x axis laid on the plane (or y if x is along the normal).
  const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const eu = norm(sub(ref, [n[0] * dot(ref, n), n[1] * dot(ref, n), n[2] * dot(ref, n)]));
  // Seen from above (along -n), u right and w down: w = u × n.
  const ew = cross(eu, n);
  return { c: p.centroid, n, eu, ew };
}

function buildGrid(pts: ScanPoints, f: Frame, mmPerUnit: number, cellMm: number | null, maxSide: number): HeightGrid {
  const { xyz, count } = pts;
  let umin = Infinity;
  let umax = -Infinity;
  let wmin = Infinity;
  let wmax = -Infinity;
  const proj = (k: number) => {
    const x = xyz[k * 3] - f.c[0];
    const y = xyz[k * 3 + 1] - f.c[1];
    const z = xyz[k * 3 + 2] - f.c[2];
    return [(x * f.eu[0] + y * f.eu[1] + z * f.eu[2]) * mmPerUnit, (x * f.ew[0] + y * f.ew[1] + z * f.ew[2]) * mmPerUnit, -(x * f.n[0] + y * f.n[1] + z * f.n[2]) * mmPerUnit];
  };
  for (let k = 0; k < count; k++) {
    const [u, w] = proj(k);
    if (u < umin) umin = u;
    if (u > umax) umax = u;
    if (w < wmin) wmin = w;
    if (w > wmax) wmax = w;
  }
  const extent = Math.max(umax - umin, wmax - wmin);
  // One cell about two point spacings, so most cells hold a few points.
  const spacing = Math.sqrt(((umax - umin) * (wmax - wmin)) / count);
  let cell = cellMm ?? Math.max(spacing * 2, extent / maxSide);
  cell = Math.max(cell, extent / maxSide);
  const width = Math.max(1, Math.ceil((umax - umin) / cell) + 1);
  const height = Math.max(1, Math.ceil((wmax - wmin) / cell) + 1);
  const sum = new Float64Array(width * height);
  const cnt = new Uint32Array(width * height);
  for (let k = 0; k < count; k++) {
    const [u, w, d] = proj(k);
    const i = Math.floor((w - wmin) / cell) * width + Math.floor((u - umin) / cell);
    sum[i] += d;
    cnt[i]++;
  }
  const depth = new Float32Array(width * height);
  for (let i = 0; i < depth.length; i++) depth[i] = cnt[i] ? sum[i] / cnt[i] : NaN;
  return { width, height, cellMm: cell, u0: umin, w0: wmin, depth, count: cnt };
}

/** The burned ramp as found in the grid: its centre and long axis, and its width across. */
interface RampBlob {
  cu: number;
  cw: number;
  /** Unit vector along the ramp. */
  du: number;
  dw: number;
  /** Width across the ramp, mm. */
  across: number;
}

/** The largest burned region not touching the scan's edge, taken to be the ramp. */
function findRamp(g: HeightGrid, threshold: number): RampBlob | null {
  const { width, height } = g;
  const label = new Int32Array(width * height).fill(-1);
  const stack: number[] = [];
  let best: number[] | null = null;
  for (let s = 0; s < label.length; s++) {
    if (label[s] !== -1 || !(g.depth[s] > threshold)) continue;
    const comp: number[] = [];
    let edge = false;
    label[s] = s;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % width;
      const y = (i - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge = true;
      const nb = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1];
      for (const j of nb) if (j >= 0 && label[j] === -1 && g.depth[j] > threshold) {
        label[j] = s;
        stack.push(j);
      }
    }
    if (!edge && comp.length >= 30 && (!best || comp.length > best.length)) best = comp;
  }
  if (!best) return null;
  let su = 0;
  let sw = 0;
  for (const i of best) {
    su += i % width;
    sw += Math.floor(i / width);
  }
  const mu = su / best.length;
  const mw = sw / best.length;
  let a = 0;
  let b = 0;
  let c = 0;
  for (const i of best) {
    const x = (i % width) - mu;
    const y = Math.floor(i / width) - mw;
    a += x * x;
    b += x * y;
    c += y * y;
  }
  const ang = 0.5 * Math.atan2(2 * b, a - c);
  const du = Math.cos(ang);
  const dw = Math.sin(ang);
  const across = Float64Array.from(best, (i) => -((i % width) - mu) * dw + (Math.floor(i / width) - mw) * du).sort();
  return {
    cu: g.u0 + (mu + 0.5) * g.cellMm,
    cw: g.w0 + (mw + 0.5) * g.cellMm,
    du,
    dw,
    across: (quantile(across, 0.99) - quantile(across, 0.01) + 1) * g.cellMm,
  };
}

// ─── Alignment ───────────────────────────────────────────────────────────

/**
 * Where the card sits on the grid: card mm (x right, y down) map to grid mm
 * as (u, w) = offset + R(angle) · (x, mirrored ? -y : y).
 */
export interface ScanAlignment {
  angleDeg: number;
  mirrored: boolean;
  offsetU: number;
  offsetW: number;
}

export function cardToGrid(a: ScanAlignment, x: number, y: number): [number, number] {
  const t = (a.angleDeg * Math.PI) / 180;
  const yy = a.mirrored ? -y : y;
  return [a.offsetU + Math.cos(t) * x - Math.sin(t) * yy, a.offsetW + Math.sin(t) * x + Math.cos(t) * yy];
}

export function gridToCard(a: ScanAlignment, u: number, w: number): [number, number] {
  const t = (a.angleDeg * Math.PI) / 180;
  const du = u - a.offsetU;
  const dw = w - a.offsetW;
  const x = Math.cos(t) * du + Math.sin(t) * dw;
  const ym = -Math.sin(t) * du + Math.cos(t) * dw;
  return [x, a.mirrored ? -ym : ym];
}

/** Depth at grid mm (u, w), from the nearest cell; NaN where there is none. */
export function depthAt(g: HeightGrid, u: number, w: number): number {
  const x = Math.floor((u - g.u0) / g.cellMm);
  const y = Math.floor((w - g.w0) / g.cellMm);
  if (x < 0 || y < 0 || x >= g.width || y >= g.height) return NaN;
  return g.depth[y * g.width + x];
}

interface Samples {
  x: Float32Array;
  y: Float32Array;
  e: Float32Array;
  ramp: Uint8Array;
}

/** The card's expected burn (darkness 0 to 1) at `ppm` samples per mm, split into ramp and the rest. */
function cardSamples(spec: CardSpec, ppm: number): Samples {
  const r = renderCard(spec, ppm);
  const ramp = cardLayout(spec).cells.find((b) => b.cell.role === 'ramp')!;
  const n = r.width * r.height;
  const s: Samples = { x: new Float32Array(n), y: new Float32Array(n), e: new Float32Array(n), ramp: new Uint8Array(n) };
  for (let i = 0; i < n; i++) {
    const px = i % r.width;
    const py = (i - px) / r.width;
    const x = (px + 0.5) / ppm;
    const y = (py + 0.5) / ppm;
    s.x[i] = x;
    s.y[i] = y;
    s.e[i] = 1 - r.rgba[i * 4] / 255;
    s.ramp[i] = x >= ramp.x && x <= ramp.x + ramp.w && y >= ramp.y && y <= ramp.y + ramp.h ? 1 : 0;
  }
  return s;
}

/**
 * How well a placement explains the scan: the correlation between expected
 * burn and measured depth over the whole card (so a ramp slid along itself,
 * which still correlates with itself, is penalised where its deep end
 * lands on bare surface), plus half the (positive)
 * correlation over the rest of the card (lettering and squares), so a
 * mirrored placement that matches the symmetric ramp but not the lettering
 * scores lower. Where the rest has no measurable burn, only the ramp counts.
 */
function score(g: HeightGrid, s: Samples, a: ScanAlignment): number {
  const t = (a.angleDeg * Math.PI) / 180;
  const cs = Math.cos(t);
  const sn = Math.sin(t);
  const m = a.mirrored ? -1 : 1;
  const acc = [new Float64Array(6), new Float64Array(6)];
  const total = [0, 0];
  for (let i = 0; i < s.x.length; i++) {
    const x = s.x[i];
    const y = m * s.y[i];
    const gx = Math.floor((a.offsetU + cs * x - sn * y - g.u0) / g.cellMm);
    const gy = Math.floor((a.offsetW + sn * x + cs * y - g.w0) / g.cellMm);
    const k = s.ramp[i];
    total[k]++;
    if (gx < 0 || gy < 0 || gx >= g.width || gy >= g.height) continue;
    const d = g.depth[gy * g.width + gx];
    if (d !== d) continue;
    const e = s.e[i];
    const A = acc[k];
    A[0]++;
    A[1] += e;
    A[2] += d;
    A[3] += e * e;
    A[4] += d * d;
    A[5] += e * d;
  }
  const corr = (A: Float64Array, tot: number) => {
    const n = A[0];
    if (n < Math.max(20, tot * 0.25)) return null;
    const ve = A[3] - (A[1] * A[1]) / n;
    const vd = A[4] - (A[2] * A[2]) / n;
    if (ve <= 1e-12 || vd <= 1e-12) return null;
    return (A[5] - (A[1] * A[2]) / n) / Math.sqrt(ve * vd);
  };
  const all = acc[0].map((v, k) => v + acc[1][k]);
  if (corr(acc[1], total[1]) === null) return -1;
  const tot = total[0] + total[1];
  const r = corr(all, tot);
  if (r === null) return -1;
  // A placement that leaves much of the card off the scan explains less of it.
  const r0 = r * Math.min(1, all[0] / (0.8 * tot));
  const r1 = corr(acc[0], total[0]);
  return r1 === null ? r0 : r0 + 0.5 * Math.max(0, r1);
}

export interface AlignResult {
  alignment: ScanAlignment;
  score: number;
  /** The best score of a placement with another rotation or mirror state. */
  runnerUp: number;
  /** False when the scan does not settle the placement: the user should check it. */
  sure: boolean;
  why: string | null;
}

/** Finds the card on the grid. Throws when no ramp-shaped burn is found. */
export function alignCard(g: HeightGrid, spec: CardSpec, blob: RampBlob | null): AlignResult {
  if (!blob) throw new Error('No burned ramp found in the scan: check that it is of the depth card, burned side up.');
  const ramp = cardLayout(spec).cells.find((b) => b.cell.role === 'ramp')!;
  const rx = ramp.x + ramp.w / 2;
  const ry = ramp.y + ramp.h / 2;
  const base = (Math.atan2(blob.dw, blob.du) * 180) / Math.PI;
  const coarse = cardSamples(spec, 1);
  const reach = ramp.w / 2 + 6;
  const tried: { a: ScanAlignment; s: number }[] = [];
  for (let k = 0; k < 4; k++)
    for (const mirrored of [false, true]) {
      const angleDeg = base + k * 90;
      let bestA: ScanAlignment | null = null;
      let bestS = -Infinity;
      const at0 = cardToGrid({ angleDeg, mirrored, offsetU: 0, offsetW: 0 }, rx, ry);
      for (let t = -reach; t <= reach; t += 1)
        for (let s = -4; s <= 4; s += 1) {
          const cu = blob.cu + t * blob.du - s * blob.dw;
          const cw = blob.cw + t * blob.dw + s * blob.du;
          const a = { angleDeg, mirrored, offsetU: cu - at0[0], offsetW: cw - at0[1] };
          const sc = score(g, coarse, a);
          if (sc > bestS) {
            bestS = sc;
            bestA = a;
          }
        }
      tried.push({ a: bestA!, s: bestS });
    }
  tried.sort((p, q) => q.s - p.s);
  const fine = cardSamples(spec, 2);
  const refine = (a0: ScanAlignment) => {
    let cur = a0;
    let cs = score(g, fine, cur);
    for (const [step, ang] of [
      [1, 1],
      [0.5, 0.5],
      [0.25, 0.25],
      [0.1, 0.1],
    ]) {
      let improved = true;
      while (improved) {
        improved = false;
        for (const [du, dw, da] of [
          [step, 0, 0],
          [-step, 0, 0],
          [0, step, 0],
          [0, -step, 0],
          [0, 0, ang],
          [0, 0, -ang],
        ]) {
          const a = { ...cur, offsetU: cur.offsetU + du, offsetW: cur.offsetW + dw, angleDeg: cur.angleDeg + da };
          // Turning about the card's origin moves the ramp: turn about the ramp's centre instead.
          if (da) {
            const before = cardToGrid(cur, rx, ry);
            const after = cardToGrid(a, rx, ry);
            a.offsetU += before[0] - after[0];
            a.offsetW += before[1] - after[1];
          }
          const sc = score(g, fine, a);
          if (sc > cs + 1e-6) {
            cs = sc;
            cur = a;
            improved = true;
          }
        }
      }
    }
    return { a: cur, s: cs };
  };
  const top = refine(tried[0].a);
  const second = refine(tried[1].a);
  const [win, lose] = top.s >= second.s ? [top, second] : [second, top];
  const runnerUp = Math.max(lose.s, ...tried.slice(2).map((t) => t.s));
  const alignment = { ...win.a, angleDeg: ((win.a.angleDeg % 360) + 360) % 360 };
  let why: string | null = null;
  if (win.s < 0.6) why = 'The scan matches the card only loosely.';
  else if (win.s - runnerUp < 0.08) why = lose.a.mirrored !== win.a.mirrored ? 'The lettering did not scan clearly enough to tell the card from its mirror image.' : 'Two placements fit almost equally well.';
  return { alignment, score: win.s, runnerUp, sure: why === null, why };
}

// ─── Steps ───────────────────────────────────────────────────────────────

export interface StepReading {
  index: number;
  /** Darkness 0 to 1. */
  level: number;
  /** Median floor depth in mm, or null when too little of the floor scanned. */
  depthMm: number | null;
  /** Scan points on the measured part of the floor. */
  samples: number;
  /** Share of the measured part of the floor with data, 0 to 1. */
  coverage: number;
  /** 10th to 90th percentile of the floor's depth, mm: its flatness. */
  spreadMm: number | null;
  /** Wall angle from the surface in degrees (90 is vertical), where the scan resolves it. */
  wallDeg: number | null;
  /** True when the wall was steeper than the scan resolves: wallDeg is a lower bound. */
  wallAtLeast: boolean;
}

/** Floor is measured this far inside each step's edges, mm. */
export const WALL_INSET_MM = 2;
/** A step needs this share of its floor scanned, and this many grid cells, to be measured. */
export const MIN_COVERAGE = 0.3;
export const MIN_CELLS = 20;

export function stepBoxes(spec: CardSpec): { box: CellBox; x: number; w: number }[] {
  const ramp = cardLayout(spec).cells.find((b) => b.cell.role === 'ramp')!;
  return spec.levels.map((_, i) => ({ box: ramp, x: ramp.x + i * spec.stepMm, w: spec.stepMm }));
}

export function measureSteps(g: HeightGrid, spec: CardSpec, a: ScanAlignment, sigmaMm: number): StepReading[] {
  const ramp = cardLayout(spec).cells.find((b) => b.cell.role === 'ramp')!;
  const inset = WALL_INSET_MM;
  return spec.levels.map((level, i) => {
    const x0 = ramp.x + i * spec.stepMm + inset;
    const x1 = ramp.x + (i + 1) * spec.stepMm - inset;
    const y0 = ramp.y + inset;
    const y1 = ramp.y + ramp.h - inset;
    const corners = [cardToGrid(a, x0, y0), cardToGrid(a, x1, y0), cardToGrid(a, x0, y1), cardToGrid(a, x1, y1)];
    const gx0 = Math.max(0, Math.floor((Math.min(...corners.map((c) => c[0])) - g.u0) / g.cellMm));
    const gx1 = Math.min(g.width - 1, Math.floor((Math.max(...corners.map((c) => c[0])) - g.u0) / g.cellMm));
    const gy0 = Math.max(0, Math.floor((Math.min(...corners.map((c) => c[1])) - g.w0) / g.cellMm));
    const gy1 = Math.min(g.height - 1, Math.floor((Math.max(...corners.map((c) => c[1])) - g.w0) / g.cellMm));
    const vals: number[] = [];
    let samples = 0;
    for (let gy = gy0; gy <= gy1; gy++)
      for (let gx = gx0; gx <= gx1; gx++) {
        const [x, y] = gridToCard(a, g.u0 + (gx + 0.5) * g.cellMm, g.w0 + (gy + 0.5) * g.cellMm);
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const k = gy * g.width + gx;
        if (g.count[k] === 0) continue;
        vals.push(g.depth[k]);
        samples += g.count[k];
      }
    const expected = ((x1 - x0) * (y1 - y0)) / (g.cellMm * g.cellMm);
    const coverage = Math.min(1, vals.length / expected);
    if (coverage < MIN_COVERAGE || vals.length < MIN_CELLS) return { index: i, level, depthMm: null, samples, coverage, spreadMm: null, wallDeg: null, wallAtLeast: false };
    const sorted = Float64Array.from(vals).sort();
    const depthMm = quantile(sorted, 0.5);
    const spreadMm = quantile(sorted, 0.9) - quantile(sorted, 0.1);
    const wall = wallAngle(g, a, x0, x1, ramp.y, ramp.y + ramp.h, depthMm, sigmaMm);
    return { index: i, level, depthMm, samples, coverage, spreadMm, wallDeg: wall?.deg ?? null, wallAtLeast: wall?.atLeast ?? false };
  });
}

/**
 * The wall angle along the ramp's top and bottom edges of one step: where
 * the averaged profile across the edge passes 20 % and 80 % of the floor's
 * depth, the wall rises 60 % of the depth over that run.
 */
function wallAngle(g: HeightGrid, a: ScanAlignment, x0: number, x1: number, top: number, bottom: number, depth: number, sigma: number): { deg: number; atLeast: boolean } | null {
  if (!(depth > Math.max(0.1, 6 * sigma))) return null;
  const h = g.cellMm / 2;
  const runs: number[] = [];
  for (const [edge, inward] of [
    [top, 1],
    [bottom, -1],
  ]) {
    const prof: { t: number; d: number }[] = [];
    for (let t = -2; t <= 3; t += h) {
      let s = 0;
      let n = 0;
      for (let x = x0; x <= x1; x += g.cellMm) {
        const [u, w] = cardToGrid(a, x, edge + inward * t);
        const d = depthAt(g, u, w);
        if (d === d) {
          s += d;
          n++;
        }
      }
      if (n > 0) prof.push({ t, d: s / n });
    }
    const cross = (f: number) => {
      for (let k = 1; k < prof.length; k++) {
        const p = prof[k - 1];
        const q = prof[k];
        if (p.d < f * depth && q.d >= f * depth) return p.t + ((f * depth - p.d) / (q.d - p.d)) * (q.t - p.t);
      }
      return null;
    };
    const t20 = cross(0.2);
    const t80 = cross(0.8);
    if (t20 !== null && t80 !== null && t80 >= t20) runs.push(t80 - t20);
  }
  if (runs.length === 0) return null;
  const run = runs.reduce((s, r) => s + r, 0) / runs.length;
  // Below one grid cell the run is not resolved: report the steepest the grid can show.
  const atLeast = run < g.cellMm;
  return { deg: (Math.atan2(0.6 * depth, Math.max(run, g.cellMm)) * 180) / Math.PI, atLeast };
}

// ─── The whole reading ───────────────────────────────────────────────────

export interface PreparedScan {
  grid: HeightGrid;
  units: ScanUnits;
  plane: PlaneFit;
  sigmaMm: number;
  tiltDeg: number;
  pointCount: number;
  format: ScanFormat;
  blob: RampBlob | null;
}

/** Fits the plane, decides the units and builds the height grid. */
export function prepareScan(pts: ScanPoints, spec: CardSpec, mmPerUnit: number | null = null): PreparedScan {
  if (spec.kind !== 'relief') throw new Error('A scan reads a depth card.');
  const plane = fitPlane(pts.xyz, pts.count);
  const f = frameOf(plane);
  let units: ScanUnits;
  const chosen = UNIT_CHOICES.find((u) => u.mmPerUnit === mmPerUnit);
  if (mmPerUnit !== null) units = { mmPerUnit, name: chosen?.name ?? 'unitless', how: `Read as ${chosen?.name ?? `${mmPerUnit} mm per unit`}, as chosen.`, chosen: true };
  else {
    // A coarse grid in file units finds the ramp; its width across is the ramp's height on the card.
    const coarse = buildGrid(pts, f, 1, null, 400);
    const blob = findRamp(coarse, Math.max(5 * plane.sigma, coarse.cellMm * 0.02));
    if (blob) units = snapUnits(spec.rampHeightMm / blob.across, `the ramp measures ${fmtN(blob.across)} file units across, and is ${spec.rampHeightMm} mm on the card`);
    else {
      const layout = cardLayout(spec);
      const ext = Math.max(coarse.width, coarse.height) * coarse.cellMm;
      units = snapUnits(Math.max(layout.widthMm, layout.heightMm) / ext, `the scan is ${fmtN(ext)} units long and the card ${layout.widthMm} mm`);
    }
  }
  const grid = buildGrid(pts, f, units.mmPerUnit, null, 1200);
  const sigmaMm = plane.sigma * units.mmPerUnit;
  const blob = findRamp(grid, Math.max(5 * sigmaMm, 0.02));
  return { grid, units, plane, sigmaMm, tiltDeg: tiltDeg(plane), pointCount: pts.count, format: pts.format, blob };
}

function fmtN(n: number): string {
  return n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toPrecision(3);
}

/** The scan resampled into the card's frame, for the overlay: depth in mm, NaN where nothing scanned. */
export interface CardDepthImage {
  width: number;
  height: number;
  /** Pixels per mm. */
  ppm: number;
  /** Card mm at the image's top left (negative: the image has a margin around the card). */
  x0: number;
  y0: number;
  depth: Float32Array;
}

export function cardDepthImage(g: HeightGrid, spec: CardSpec, a: ScanAlignment, ppm = 4, padMm = 3): CardDepthImage {
  const layout = cardLayout(spec);
  const width = Math.round((layout.widthMm + 2 * padMm) * ppm);
  const height = Math.round((layout.heightMm + 2 * padMm) * ppm);
  const depth = new Float32Array(width * height);
  for (let py = 0; py < height; py++)
    for (let px = 0; px < width; px++) {
      const [u, w] = cardToGrid(a, -padMm + (px + 0.5) / ppm, -padMm + (py + 0.5) / ppm);
      depth[py * width + px] = depthAt(g, u, w);
    }
  return { width, height, ppm, x0: -padMm, y0: -padMm, depth };
}

export interface ScanReading {
  format: ScanFormat;
  pointCount: number;
  units: ScanUnits;
  tiltDeg: number;
  /** Robust spread of the bare surface about the plane, mm: the scan's noise plus the wood's grain. */
  surfaceSigmaMm: number;
  cellMm: number;
  align: AlignResult;
  steps: StepReading[];
  image: CardDepthImage;
}

/** Measures every step at a placement (found, or set by the user). */
export function readAt(prep: PreparedScan, spec: CardSpec, align: AlignResult): ScanReading {
  return {
    format: prep.format,
    pointCount: prep.pointCount,
    units: prep.units,
    tiltDeg: prep.tiltDeg,
    surfaceSigmaMm: prep.sigmaMm,
    cellMm: prep.grid.cellMm,
    align,
    steps: measureSteps(prep.grid, spec, align.alignment, prep.sigmaMm),
    image: cardDepthImage(prep.grid, spec, align.alignment),
  };
}

/** The whole reading from parsed points: plane, units, alignment and steps. */
export function readScan(pts: ScanPoints, spec: CardSpec, mmPerUnit: number | null = null): { prep: PreparedScan; reading: ScanReading } {
  const prep = prepareScan(pts, spec, mmPerUnit);
  const align = alignCard(prep.grid, spec, prep.blob);
  return { prep, reading: readAt(prep, spec, align) };
}

/**
 * The depths to put in the typed entry fields: each measured step's median
 * to the nearest 0.01 mm (a caliper's resolution), and null where the step
 * was not measured, for the user to type.
 */
export function scanEntries(steps: readonly StepReading[]): (number | null)[] {
  return steps.map((s) => (s.depthMm === null ? null : Math.max(0, Math.round(s.depthMm * 100) / 100)));
}

/** A placement the user set by nudging, turning or flipping: scored, and taken as checked. */
export function userAlign(prep: PreparedScan, spec: CardSpec, alignment: ScanAlignment, previous: AlignResult): AlignResult {
  const s = score(prep.grid, cardSamples(spec, 2), alignment);
  return { alignment, score: s, runnerUp: previous.runnerUp, sure: true, why: null };
}

/** Moves a placement by card mm (dx right, dy down on the card), turns it by `turnDeg` about the ramp's centre, or mirrors it in place. */
export function nudge(spec: CardSpec, a: ScanAlignment, change: { dx?: number; dy?: number; turnDeg?: number; flip?: boolean }): ScanAlignment {
  const ramp = cardLayout(spec).cells.find((b) => b.cell.role === 'ramp')!;
  const rx = ramp.x + ramp.w / 2;
  const ry = ramp.y + ramp.h / 2;
  const moved = cardToGrid(a, rx + (change.dx ?? 0), ry + (change.dy ?? 0));
  const next: ScanAlignment = {
    angleDeg: a.angleDeg + (change.turnDeg ?? 0),
    mirrored: change.flip ? !a.mirrored : a.mirrored,
    offsetU: a.offsetU,
    offsetW: a.offsetW,
  };
  // Keep the ramp's centre where it was (plus the move).
  const now = cardToGrid(next, rx, ry);
  next.offsetU += moved[0] - now[0];
  next.offsetW += moved[1] - now[1];
  return next;
}
