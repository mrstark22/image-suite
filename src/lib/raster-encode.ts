import type { RasterExport, RasterFormat } from '../types/worker-messages';
import { encodeBmp1, encodeBmpRgb24 } from './bmp-encoder';
import { MM_PER_INCH } from './document-size';
import { encodePng1, encodePng8, type EncodeProgress, type PngColour } from './png-encoder';

/**
 * Encodes a rendered RGBA8 image as a raster export file (design section 6),
 * writing `pxPerMm` as the file's resolution. Runs in the worker, reading the
 * render where it lies in WASM memory: `readRgba` returns a fresh view of it.
 *
 * - PNG is greyscale when every pixel's channels are equal (dithered and
 *   greyscale output), otherwise RGB. The pipeline's output is opaque, since
 *   transparency is flattened onto white; RGBA is written only if it is not.
 * - BMP is 24-bit RGB.
 * - With `bilevel` (a dithered image, #39) both are 1-bit black and white,
 *   for LightBurn's Pass-Through mode; a grey pixel is an error.
 */
export async function encodeRaster(
  format: RasterFormat,
  readRgba: () => Uint8Array,
  widthPx: number,
  heightPx: number,
  pxPerMm: number,
  onProgress?: EncodeProgress,
  bilevel = false
): Promise<RasterExport> {
  const result = { widthPx, heightPx, pxPerMm };
  if (bilevel) {
    if (format === 'png') {
      const png = await encodePng1(readRgba, widthPx, heightPx, { pxPerMm, onProgress });
      return { ...result, bytes: png.buffer as ArrayBuffer, mimeType: 'image/png', extension: 'png' };
    }
    if (format === 'bmp') {
      const bmp = encodeBmp1(readRgba(), widthPx, heightPx, pxPerMm * MM_PER_INCH);
      await onProgress?.(1);
      return { ...result, bytes: bmp, mimeType: 'image/bmp', extension: 'bmp' };
    }
  }
  if (format === 'png') {
    const png = await encodePng8(readRgba, widthPx, heightPx, pngColourOf(readRgba()), { pxPerMm, onProgress });
    return { ...result, bytes: png.buffer as ArrayBuffer, mimeType: 'image/png', extension: 'png' };
  }
  if (format === 'bmp') {
    const bmp = encodeBmpRgb24(readRgba(), widthPx, heightPx, pxPerMm * MM_PER_INCH);
    await onProgress?.(1);
    return { ...result, bytes: bmp, mimeType: 'image/bmp', extension: 'bmp' };
  }
  throw new Error(`Unknown export format: ${String(format)}`);
}

/** The fewest PNG channels that hold `rgba` exactly. */
export function pngColourOf(rgba: Uint8Array): PngColour {
  let grey = true;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] !== 255) return 'rgba';
    if (grey && (rgba[i] !== rgba[i + 1] || rgba[i] !== rgba[i + 2])) grey = false;
  }
  return grey ? 'grey' : 'rgb';
}
