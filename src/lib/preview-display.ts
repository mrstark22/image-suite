/**
 * How the canvas shows the preview at a zoom (moiré below 100%).
 *
 * A 1-bit dither scaled down by the browser skips or blends a few dots per
 * screen pixel and shows false patterns (moiré). Below 100% the canvas
 * shows an area-averaged copy instead, made at the size it covers on the
 * screen, so each screen pixel shows the mean tone of exactly the dots under
 * it. At 100% and above it shows the dots themselves.
 *
 * This is a view concern only: it reads the drawn preview, never the
 * pipeline's output, so exports are unaffected.
 */

export type PreviewDisplay = { mode: 'dots' } | { mode: 'averaged'; scale: number };

/**
 * The display for `zoom` (CSS pixels per preview pixel) on a screen with
 * `devicePixelRatio`: the dots at 100% and above; below it, an average at
 * `scale` device pixels per dot (at most 1: a high-density screen at 60%
 * still has more device pixels than dots, and is shown the dots smoothed).
 */
export function previewDisplay(zoom: number, devicePixelRatio = 1): PreviewDisplay {
  if (!(zoom < 1) || !(zoom > 0)) return { mode: 'dots' };
  return { mode: 'averaged', scale: Math.min(1, zoom * Math.max(1, devicePixelRatio)) };
}

/** The averaged copy's pixel size for a `width` x `height` preview at `scale`. */
export function averagedSize(width: number, height: number, scale: number): { width: number; height: number } {
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface RgbaImage {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/**
 * For each of `outLength` output cells over `inLength` input pixels: the
 * input pixels it covers and how much of each (fractions summing to 1).
 */
function coverage(inLength: number, outLength: number): { index: Int32Array; weight: Float32Array; start: Int32Array } {
  const step = inLength / outLength;
  const start = new Int32Array(outLength + 1);
  const indices: number[] = [];
  const weights: number[] = [];
  for (let o = 0; o < outLength; o++) {
    start[o] = indices.length;
    const a = o * step;
    const b = Math.min(inLength, a + step);
    for (let i = Math.floor(a); i < b; i++) {
      const w = Math.min(i + 1, b) - Math.max(i, a);
      if (w > 1e-9) {
        indices.push(i);
        weights.push(w / step);
      }
    }
  }
  start[outLength] = indices.length;
  return { index: Int32Array.from(indices), weight: Float32Array.from(weights), start };
}

/**
 * `image` resampled to `outWidth` x `outHeight` by area: each output pixel is
 * the mean of the input area it covers, partial pixels weighted by how much
 * of them it covers. Every channel is averaged, so the mean tone is kept and
 * a dither becomes the grey it stands for.
 */
export function areaResample(image: RgbaImage, outWidth: number, outHeight: number): RgbaImage {
  const { data, width, height } = image;
  const cols = coverage(width, outWidth);
  const rows = coverage(height, outHeight);
  // Across: width x height to outWidth x height.
  const across = new Float32Array(outWidth * height * 4);
  for (let y = 0; y < height; y++) {
    const inRow = y * width * 4;
    const outRow = y * outWidth * 4;
    for (let ox = 0; ox < outWidth; ox++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = cols.start[ox]; k < cols.start[ox + 1]; k++) {
        const p = inRow + cols.index[k] * 4;
        const w = cols.weight[k];
        r += data[p] * w;
        g += data[p + 1] * w;
        b += data[p + 2] * w;
        a += data[p + 3] * w;
      }
      const o = outRow + ox * 4;
      across[o] = r;
      across[o + 1] = g;
      across[o + 2] = b;
      across[o + 3] = a;
    }
  }
  // Down: outWidth x height to outWidth x outHeight.
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  const rowLength = outWidth * 4;
  for (let oy = 0; oy < outHeight; oy++) {
    const o = oy * rowLength;
    for (let i = 0; i < rowLength; i++) {
      let sum = 0;
      for (let k = rows.start[oy]; k < rows.start[oy + 1]; k++) sum += across[rows.index[k] * rowLength + i] * rows.weight[k];
      out[o + i] = Math.round(sum);
    }
  }
  return { data: out, width: outWidth, height: outHeight };
}
