/**
 * Relief depth calibration (docs/plan.md, "Relief calibration"): a depth
 * curve lists the depth in mm burned at evenly spaced grey levels from white
 * (first) to black (last), as `Calibration.depthCurve` holds it. Applying its
 * inverse to a heightmap picks, for each height, the grey level that burns the
 * depth that height should have, so equal steps in the heightmap give equal
 * steps in real depth.
 *
 * Heights are 0 (deepest) to 65535 (the untouched surface), and so are the
 * grey levels written: white 65535, black 0.
 */

/** Checks `curve` and returns it with every value at least the one before (a burn never gets shallower with more power). */
function monotone(curve: readonly number[]): number[] {
  if (curve.length < 2 || curve.some((v) => !Number.isFinite(v) || v < 0)) {
    throw new Error('A depth curve needs at least two depths in mm, none negative.');
  }
  const out: number[] = [];
  let max = 0;
  for (const v of curve) out.push((max = Math.max(max, v)));
  if (max <= 0) throw new Error('The depth curve never burns below the surface.');
  return out;
}

/** Depth burned at grey position `t` (0 white to 1 black), interpolated linearly between the curve's points. */
export function depthAtGrey(curve: readonly number[], t: number): number {
  const c = monotone(curve);
  const x = Math.max(0, Math.min(1, t)) * (c.length - 1);
  const i = Math.min(c.length - 2, Math.floor(x));
  return c[i] + (c[i + 1] - c[i]) * (x - i);
}

/** The lightest grey position `t` (0 white to 1 black) that burns `depthMm`; the darkest when it is beyond the curve. */
export function greyForDepth(curve: readonly number[], depthMm: number): number {
  const c = monotone(curve);
  if (depthMm <= c[0]) return 0;
  for (let i = 1; i < c.length; i++) {
    if (c[i] >= depthMm) {
      const span = c[i] - c[i - 1];
      const f = span > 0 ? (depthMm - c[i - 1]) / span : 0;
      return (i - 1 + f) / (c.length - 1);
    }
  }
  return 1;
}

/** The deepest point the relief can have with `curve`, given the maximum depth asked for. */
export function usableDepthMm(curve: readonly number[], maxDepthMm: number): number {
  const c = monotone(curve);
  return Math.min(maxDepthMm, c[c.length - 1]);
}

/**
 * The grey levels to write for `heights` so they burn in proportion: height
 * h is meant to be `(1 - h / 65535) * usableDepthMm` deep.
 */
export function applyDepthCurveInverse(heights: Uint16Array, curve: readonly number[], maxDepthMm: number): Uint16Array {
  const deepest = usableDepthMm(curve, maxDepthMm);
  // One entry per possible height.
  const lut = new Uint16Array(65536);
  for (let h = 0; h < 65536; h++) {
    const t = greyForDepth(curve, (1 - h / 65535) * deepest);
    lut[h] = Math.round((1 - t) * 65535);
  }
  const out = new Uint16Array(heights.length);
  for (let i = 0; i < heights.length; i++) out[i] = lut[heights[i]];
  return out;
}
