/**
 * Synthetic photos of burned calibration cards (#56): the card's layout
 * drawn as reflectance, with planted darkness per step, seen through a
 * perspective warp, under uneven light, blurred, with noise, on a dark table.
 */
import type { CardSpec } from '../../src/types/calibration-card';
import { cardLayout, renderCard } from '../../src/lib/calibration-cards';
import { homography, project } from '../../src/lib/card-reader';

export interface PhotoOptions {
  width?: number;
  height?: number;
  /** Photo positions of the card's corners: top left, top right, bottom right, bottom left. */
  corners?: [number, number][];
  /** Light falling on each photo position (0 to 1 across the photo), times the exposure. */
  light?: (u: number, v: number) => number;
  /** Box blur radius in photo pixels, applied twice. */
  blurPx?: number;
  /** Noise added to each channel, in 8-bit steps (uniform, +-). */
  noise?: number;
  /** Bare wood, linear RGB. */
  bare?: [number, number, number];
  /** Darkness (0 to 1) burned at step `i` of cell `layer`. */
  darkness: (layer: number, i: number, level: number) => number;
  /** Cells with a scorch halo around them, and its darkness. */
  halos?: { layer: number; darkness: number }[];
  /** Burned marks and lettering. */
  burnDarkness?: number;
  /** Leave the code out (as if worn or not burned). */
  noCode?: boolean;
}

export interface CardPhoto {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** The true map, card mm to photo pixels. */
  truth: number[];
}

const toSrgb = (l: number) => {
  const v = l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
};

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        s += src[y * w + xx];
        n++;
      }
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        s += tmp[yy * w + x];
        n++;
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

export function cardPhoto(spec: CardSpec, o: PhotoOptions): CardPhoto {
  const width = o.width ?? 1400;
  const height = o.height ?? 1000;
  const layout = cardLayout(spec);
  const W = layout.widthMm;
  const H = layout.heightMm;
  const corners = o.corners ?? [
    [120, 90],
    [width - 140, 130],
    [width - 100, height - 110],
    [90, height - 80],
  ];
  const cardPts = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: H },
    { x: 0, y: H },
  ];
  const photoPts = corners.map(([x, y]) => ({ x, y }));
  const truth = homography(cardPts, photoPts)!;
  const inverse = homography(photoPts, cardPts)!;
  const ppm = 10;
  const marks = renderCard(spec, ppm);
  const codeBox = layout.marks.find((m) => m.kind === 'code');
  const burn = o.burnDarkness ?? 0.9;
  const bare = o.bare ?? [0.55, 0.4, 0.25];
  const light = o.light ?? (() => 1);
  const reflect = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= W || y >= H) return -1;
    for (const b of layout.cells) {
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) {
        const i = Math.min(spec.levels.length - 1, Math.floor((x - b.x) / spec.stepMm));
        return 1 - o.darkness(b.cell.layer, i, spec.levels[i]);
      }
    }
    if (o.noCode && codeBox && x >= codeBox.x && x < codeBox.x + codeBox.w && y >= codeBox.y && y < codeBox.y + codeBox.h) return 1;
    const g = marks.rgba[(Math.min(marks.height - 1, Math.floor(y * ppm)) * marks.width + Math.min(marks.width - 1, Math.floor(x * ppm))) * 4];
    if (g === 0) return 1 - burn;
    for (const h of o.halos ?? []) {
      const b = layout.cells.find((c) => c.cell.layer === h.layer)!;
      if (x > b.x - 1.5 && x < b.x + b.w + 1.5 && y > b.y - 1.5 && y < b.y + b.h + 1.5) return 1 - h.darkness;
    }
    return 1;
  };
  const chans = [0, 1, 2].map(() => new Float32Array(width * height));
  // 2 x 2 supersampling of the card.
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const lit = light(px / width, py / height);
      const acc = [0, 0, 0];
      for (const [sx, sy] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ]) {
        const c = project(inverse, px + sx, py + sy);
        const r = reflect(c.x, c.y);
        for (let k = 0; k < 3; k++) acc[k] += r < 0 ? 0.04 * lit : bare[k] * r * lit;
      }
      for (let k = 0; k < 3; k++) chans[k][py * width + px] = acc[k] / 4;
    }
  }
  const blurred = o.blurPx ? chans.map((c) => boxBlur(boxBlur(c, width, height, o.blurPx!), width, height, o.blurPx!)) : chans;
  const rgba = new Uint8ClampedArray(width * height * 4);
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const noise = o.noise ?? 0;
  for (let i = 0; i < width * height; i++) {
    for (let k = 0; k < 3; k++) rgba[i * 4 + k] = toSrgb(blurred[k][i]) + Math.round((rand() * 2 - 1) * noise);
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, width, height, truth };
}
