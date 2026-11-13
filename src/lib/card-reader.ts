/**
 * Reading a burned photo card from a photo or flatbed scan (#56; docs/plan.md,
 * "Reading a card from a photo").
 *
 * 1. Locate: the core finds the ring-and-dot corner markers
 *    (`card_photo.rs`); the top-left one has the larger dot. The four
 *    centres give the perspective map (a homography) from card mm to photo
 *    pixels.
 * 2. Identify: the card code (`card-code.ts`) is read through that map. If
 *    it names another card, the photo is refused; if it cannot be read, the
 *    card the user chose is measured, with a warning.
 * 3. Normalise: the bare reference patches give the light falling on the
 *    card, fitted as a smooth surface over it, so each patch is measured as
 *    darkness relative to bare material where it lies: 1 - patch / bare,
 *    in linear light. A phone camera's own tone processing still applies,
 *    so readings are relative within one photo.
 * 4. Read: card 1 cells are ranked by usable tone range, and cells whose
 *    surroundings are discoloured (scorch halo) are flagged; card 2's steps
 *    give the tone response curve.
 *
 * The result is a proposal, which the user confirms or overrides.
 */
import type { CardSpec } from '../types/calibration-card';
import { cardLayout, type CardLayout, type MmRect } from './calibration-cards';
import { decodeCardCode } from './card-code';
import type { CardPhotoImage, Homography, PhotoMarker, Rect } from './card-photo-call';
import { monotonicDepths } from './calibration-results';

/** The longest side a photo is reduced to before reading: plenty for a card, quick to measure. */
export const READ_MAX_SIDE = 2000;

/** Darkness of the surroundings above which a card 1 cell is flagged as scorched. */
export const HALO_LIMIT = 0.1;

export interface CellReading {
  layer: number;
  /** Darkness of each step, light to dark, relative to bare material. */
  steps: number[];
  /** Darkest step minus lightest. */
  range: number;
  /** How many neighbouring steps are told apart, darker in order (of `steps.length - 1`). */
  distinct: number;
  /** Range scaled by the share of steps told apart: what cells are ranked by. */
  score: number;
  /** Darkness of the most discoloured side of the cell's surroundings. */
  halo: number;
  scorched: boolean;
}

export interface ToneReading {
  /** Darkness of each step of the ramp. */
  darkness: number[];
  /** The tone response: darkness never falling, scaled to 0 at bare and 1 at the darkest step. */
  curve: number[];
  /** The last step that reads as bare and the first that reads as full black, for showing. */
  lastBlank: number;
  firstSolid: number;
}

/** What was measured, for drawing over the flattened photo. */
export interface MeasuredOutline extends Rect {
  kind: 'step' | 'halo' | 'reference' | 'code';
  flagged: boolean;
}

export type CardReading =
  | { ok: false; message: string }
  | {
      ok: true;
      spec: CardSpec;
      /** False when the code could not be read and the card chosen was assumed. */
      codeRead: boolean;
      warnings: string[];
      /** Card mm to photo pixels. */
      homography: number[];
      rectified: { rgba: Uint8ClampedArray; width: number; height: number; pxPerMm: number };
      outlines: MeasuredOutline[];
      /** Card 1: every cell, best first. */
      cells: CellReading[] | null;
      tone: ToneReading | null;
    };

const FALLBACK = 'Choose by eye below instead.';

// Geometry

/** Solves `a x = b` (n x n) by Gaussian elimination with partial pivoting; null when singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** The homography taking each `from` point to the `to` point at the same index (4 each). */
export function homography(from: readonly { x: number; y: number }[], to: readonly { x: number; y: number }[]): number[] | null {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(a, b);
  return h ? [...h, 1] : null;
}

export function project(m: Homography, x: number, y: number): { x: number; y: number } {
  const d = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / d, y: (m[3] * x + m[4] * y + m[5]) / d };
}

const area2 = (p: readonly { x: number; y: number }[]) => p.reduce((s, a, i) => s + a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y, 0);

/**
 * The four markers of the card, in every order worth trying: top left,
 * top right, bottom right, bottom left, clockwise as seen in the photo.
 * The order with the large-dot marker first comes first. With more than four
 * candidates, the four of similar size spanning the largest area are used.
 */
export function markerOrders(found: readonly PhotoMarker[]): PhotoMarker[][] {
  let four: PhotoMarker[] = [];
  if (found.length === 4) four = [...found];
  else {
    const list = [...found].sort((a, b) => b.side - a.side).slice(0, 10);
    let best = -1;
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        for (let k = j + 1; k < list.length; k++)
          for (let l = k + 1; l < list.length; l++) {
            const q = [list[i], list[j], list[k], list[l]];
            const sides = q.map((m) => m.side);
            if (Math.max(...sides) > 2 * Math.min(...sides)) continue;
            const cx = q.reduce((s, m) => s + m.x, 0) / 4;
            const cy = q.reduce((s, m) => s + m.y, 0) / 4;
            q.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
            const a = Math.abs(area2(q));
            if (a > best) {
              best = a;
              four = q;
            }
          }
  }
  if (four.length !== 4) return [];
  const cx = four.reduce((s, m) => s + m.x, 0) / 4;
  const cy = four.reduce((s, m) => s + m.y, 0) / 4;
  // Increasing angle with y down is clockwise on screen.
  four.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  const big = four.indexOf(four.reduce((a, b) => (b.dotRatio > a.dotRatio ? b : a)));
  return [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((i) => four[(big + r + i) % 4]));
}

// Lighting

/** Least-squares fit of a smooth surface (quadratic in x and y, or a plane with few points) to `values` at `points`. */
export function fitSurface(points: readonly { x: number; y: number }[], values: readonly number[], w: number, h: number): (x: number, y: number) => number {
  const basis = points.length >= 9 ? (x: number, y: number) => [1, x, y, x * y, x * x, y * y] : (x: number, y: number) => [1, x, y];
  const k = basis(0, 0).length;
  const ata = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const atb = new Array<number>(k).fill(0);
  points.forEach((p, i) => {
    const f = basis(p.x / w, p.y / h);
    for (let r = 0; r < k; r++) {
      atb[r] += f[r] * values[i];
      for (let c = 0; c < k; c++) ata[r][c] += f[r] * f[c];
    }
  });
  const coef = solve(ata, atb);
  if (!coef) {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    return () => mean;
  }
  return (x, y) => basis(x / w, y / h).reduce((s, f, i) => s + f * coef[i], 0);
}

// Patches

const inset = (r: MmRect, fx: number, fy = fx): Rect => ({ x: r.x + r.w * fx, y: r.y + r.h * fy, w: r.w * (1 - 2 * fx), h: r.h * (1 - 2 * fy) });
const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** The steps of a ramp cell, each sampled away from its edges. */
function stepRects(spec: CardSpec, box: MmRect): Rect[] {
  return spec.levels.map((_, i) => inset({ x: box.x + i * spec.stepMm, y: box.y, w: spec.stepMm, h: box.h }, 0.22, 0.2));
}

/** Bands just outside a cell, one per side, where a scorch halo shows. */
function haloRects(box: MmRect): Rect[] {
  const near = 0.6;
  const band = 0.8;
  return [
    { x: box.x, y: box.y - near - band, w: box.w, h: band },
    { x: box.x, y: box.y + box.h + near, w: box.w, h: band },
    { x: box.x - near - band, y: box.y, w: band, h: box.h },
    { x: box.x + box.w + near, y: box.y, w: band, h: box.h },
  ];
}

const codeRect = (r: MmRect) => inset(r, 0.25);

/** The card the code names, read through `m`; null when the code does not read. */
function readCode(img: CardPhotoImage, m: Homography, layout: CardLayout): { kind: CardSpec['kind']; shortId: string } | null {
  if (!layout.read) return null;
  const s = img.sample(m, layout.read.codeCells.map(codeRect), 4).map((p) => p.median);
  if (s.some((v) => !Number.isFinite(v))) return null;
  const lo = Math.min(...s);
  const hi = Math.max(...s);
  if (hi - lo < 0.04 || hi <= 0) return null;
  const mid = (lo + hi) / 2;
  return decodeCardCode(s.map((v) => (v < mid ? 1 : 0)));
}

const KIND_TEXT: Record<CardSpec['kind'], string> = { 'engrave-grid': 'photo card 1', 'engrave-tone': 'photo card 2', cut: 'a cut card', relief: 'a depth card' };

const r4 = (v: number) => Number(v.toFixed(4));

/**
 * Reads the photo `img` as the card `expected`. `known` are the other cards
 * stored in this browser, so a photo of one of them is recognised and
 * refused with its name rather than measured as the wrong card.
 */
export function readCardPhoto(img: CardPhotoImage, expected: CardSpec, known: readonly CardSpec[] = []): CardReading {
  if (expected.kind !== 'engrave-grid' && expected.kind !== 'engrave-tone') return { ok: false, message: 'Only photo cards 1 and 2 can be read from a photo.' };
  const found = img.markers();
  const orders = markerOrders(found);
  if (orders.length === 0) {
    const n = Math.min(found.length, 4);
    return {
      ok: false,
      message: `Found ${n === 0 ? 'none' : n} of the card's 4 corner markers. Take the photo square on, with the whole card in the frame, in focus and evenly lit. ${FALLBACK}`,
    };
  }

  const layout = cardLayout(expected);
  const read = layout.read!;
  const mapFor = (spec: CardSpec, order: PhotoMarker[]) => homography(cardLayout(spec).read!.markers, order);

  // Identify: try the card chosen first, then the others, in each orientation, starting with the one the large dot gives.
  const candidates = [expected, ...known.filter((k) => k.id !== expected.id && (k.kind === 'engrave-grid' || k.kind === 'engrave-tone'))];
  let named: { kind: CardSpec['kind']; shortId: string } | null = null;
  let m: number[] | null = null;
  search: for (const spec of candidates) {
    for (const order of orders) {
      const map = mapFor(spec, order);
      if (!map) continue;
      const code = readCode(img, map, cardLayout(spec));
      if (code) {
        named = code;
        if (spec === expected) m = map;
        break search;
      }
    }
  }
  const warnings: string[] = [];
  if (named && (named.shortId !== expected.shortId || named.kind !== expected.kind)) {
    const other = known.find((k) => k.shortId === named!.shortId && k.kind === named!.kind);
    return {
      ok: false,
      message: `This photo is of card #${named.shortId} (${KIND_TEXT[named.kind]}${other ? `, ${other.materialName} on ${other.machineName}` : ', not one stored in this browser'}), not card #${expected.shortId}.${other ? ' Choose that card in the list to read it.' : ''} ${FALLBACK}`,
    };
  }
  if (!m) {
    m = mapFor(expected, orders[0]);
    if (!m) return { ok: false, message: `The corner markers do not make a card shape. ${FALLBACK}` };
    warnings.push(`The card's code could not be read, so this was measured as card #${expected.shortId}. Check that the photo is of that card.`);
  }

  // Normalise: the light on the card from its bare reference patches.
  const refs = img.sample(m, read.references, 6);
  const refPts: { x: number; y: number }[] = [];
  const refVals: number[] = [];
  refs.forEach((s, i) => {
    if (Number.isFinite(s.median)) {
      refPts.push(centre(read.references[i]));
      refVals.push(s.median);
    }
  });
  if (refVals.length < 4) return { ok: false, message: `Part of the card is outside the photo. Get the whole card in the frame. ${FALLBACK}` };
  const sorted = [...refVals].sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)];
  if (typical < 0.02) return { ok: false, message: `The photo is too dark to measure. Light the card evenly (daylight, or a lamp to one side) and try again. ${FALLBACK}` };
  if (refs.filter((s) => s.clipped > 0.3).length >= Math.max(1, refs.length / 4)) {
    warnings.push('Parts of the bare wood are blown out to white (glare or overexposure): tilt the card or the light, or tap a darker area to expose for it.');
  }
  const light = fitSurface(refPts, refVals, layout.widthMm, layout.heightMm);
  const worst = Math.max(...refPts.map((p, i) => Math.abs(refVals[i] / light(p.x, p.y) - 1)));
  if (worst > 0.15) warnings.push('The light on the card is patchy (a shadow, glare, or a stain on the bare wood): the readings may be off. A flatbed scan avoids this.');
  if (Math.max(...refVals) > 3 * Math.min(...refVals)) warnings.push('The light falls off strongly across the card. Even light gives more reliable readings.');

  const darkness = (rects: Rect[], grid = 6) =>
    img.sample(m!, rects, grid).map((s, i) => {
      const c = centre(rects[i]);
      return r4(Math.max(-0.2, Math.min(1, 1 - s.median / light(c.x, c.y))));
    });

  const outlines: MeasuredOutline[] = [
    ...read.references.map((r) => ({ ...r, kind: 'reference' as const, flagged: false })),
    ...read.codeCells.map((r) => ({ ...codeRect(r), kind: 'code' as const, flagged: false })),
  ];
  let cells: CellReading[] | null = null;
  let tone: ToneReading | null = null;

  if (expected.kind === 'engrave-grid') {
    cells = layout.cells.map((box) => {
      const stepsR = stepRects(expected, box);
      const halosR = haloRects(box);
      const steps = darkness(stepsR);
      const halos = darkness(halosR, 5);
      const halo = Math.max(...halos);
      const range = r4(Math.max(...steps) - Math.min(...steps));
      let distinct = 0;
      for (let i = 1; i < steps.length; i++) if (steps[i] - steps[i - 1] > 0.02) distinct++;
      const scorched = halo > HALO_LIMIT;
      outlines.push(...stepsR.map((r) => ({ ...r, kind: 'step' as const, flagged: false })), ...halosR.map((r) => ({ ...r, kind: 'halo' as const, flagged: scorched })));
      return { layer: box.cell.layer, steps, range, distinct, score: r4(range * (distinct / (steps.length - 1))), halo, scorched };
    });
    cells.sort((a, b) => Number(a.scorched) - Number(b.scorched) || b.score - a.score);
    if (cells.every((c) => c.range < 0.05)) return { ok: false, message: `No cell shows a tone ramp in this photo: it may be too blurred or not the burned card. ${FALLBACK}` };
  } else {
    const box = layout.cells[0];
    const stepsR = stepRects(expected, box);
    const d = darkness(stepsR);
    outlines.push(...stepsR.map((r) => ({ ...r, kind: 'step' as const, flagged: false })));
    const rising = monotonicDepths(d);
    const lo = rising[0];
    const hi = rising[rising.length - 1];
    if (hi - lo < 0.1) return { ok: false, message: `The ramp barely shows in this photo, so no tone curve can be measured from it. ${FALLBACK}` };
    const curve = rising.map((v) => r4(Math.min(1, Math.max(0, (v - lo) / (hi - lo)))));
    let lastBlank = 0;
    while (lastBlank + 1 < curve.length && curve[lastBlank + 1] <= 0.02) lastBlank++;
    let firstSolid = curve.length - 1;
    while (firstSolid - 1 > lastBlank && curve[firstSolid - 1] >= 0.98) firstSolid--;
    tone = { darkness: d, curve, lastBlank, firstSolid };
  }

  const pxPerMm = Math.min(8, 1600 / Math.max(layout.widthMm, layout.heightMm));
  const width = Math.round(layout.widthMm * pxPerMm);
  const height = Math.round(layout.heightMm * pxPerMm);
  const rgba = img.rectify(m, width, height, pxPerMm);
  return { ok: true, spec: expected, codeRead: named !== null, warnings, homography: m, rectified: { rgba, width, height, pxPerMm }, outlines, cells, tone };
}
