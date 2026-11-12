import type { DocumentUpdate } from '../types/document';
import { setTonal } from './document';

/**
 * Auto Levels: sets the black and white points from the image's histogram.
 *
 * The levels window is the first thing the tonal step applies, to each of R,
 * G and B with the same two points (`compute_tonal_lut` in tonal.rs). So the
 * histogram read is the one the levels see: the `source`-stage render, with
 * the three channels counted together. The black point is the value below
 * which `AUTO_LEVELS_CLIP` of the samples lie, and the white point the value
 * above which the same fraction lie, so a few stray pixels do not hold the
 * window open.
 */

/** Fraction of the channel samples clipped at each end. */
export const AUTO_LEVELS_CLIP = 0.005;

export interface LevelPoints {
  blackPoint: number;
  whitePoint: number;
}

/**
 * The black and white points of an RGBA8 image (alpha is ignored), or `null`
 * when the image has no spread to stretch (the two points would meet).
 */
export function autoLevelPoints(rgba: Uint8Array, clip = AUTO_LEVELS_CLIP): LevelPoints | null {
  const bins = new Uint32Array(256);
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    bins[rgba[i]]++;
    bins[rgba[i + 1]]++;
    bins[rgba[i + 2]]++;
  }
  const samples = (rgba.length >> 2) * 3;
  if (samples === 0) return null;
  // Lowest value with more than `limit` samples at or below it, and highest
  // value with more than `limit` samples at or above it.
  const limit = clip * samples;
  let blackPoint = 0;
  for (let below = 0; blackPoint < 255; blackPoint++) {
    below += bins[blackPoint];
    if (below > limit) break;
  }
  let whitePoint = 255;
  for (let above = 0; whitePoint > 0; whitePoint--) {
    above += bins[whitePoint];
    if (above > limit) break;
  }
  return whitePoint > blackPoint ? { blackPoint, whitePoint } : null;
}

/**
 * The Auto Levels edit for the `source`-stage pixels `rgba`: sets the black
 * and white points and nothing else. Leaves the document unchanged when the
 * image has no spread.
 */
export function autoLevels(rgba: Uint8Array): DocumentUpdate {
  const points = autoLevelPoints(rgba);
  return points ? setTonal(points) : (d) => d;
}
