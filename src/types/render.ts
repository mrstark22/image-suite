import type { PixelFormat } from './document';

/** The size, in pixels, a render of the crop is made at. */
export interface RenderTarget {
  widthPx: number;
  heightPx: number;
}

/**
 * How far the pipeline runs (design section 2):
 * - `source`: cropped, flattened onto white, resampled; no adjustments
 * - `prepared`: plus tone, colour, CLAHE, sharpening and the adaptive threshold
 * - `final`: plus the dither; what the preview shows and raster export writes
 */
export type Stage = 'source' | 'prepared' | 'final';

/** The result of one render. */
export interface RenderOutput {
  format: PixelFormat;
  pixels: ArrayBuffer;
  widthPx: number;
  heightPx: number;
  /** Target width over the width in millimetres, or `null` while the size is not set. */
  pxPerMm: number | null;
}
