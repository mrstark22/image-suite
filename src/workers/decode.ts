import type { PipelineEngine } from '../lib/pipeline-engine';
import type { LoadedSourceInfo } from '../types/worker-messages';
import type { PixelSize } from '../lib/reduced-open';

/** Largest band drawn at once while decoding, in pixels (design section 5). */
const BAND_PIXELS = 4_000_000;

/**
 * Decodes `file` straight into the engine's source memory, one horizontal
 * band at a time (design section 5, "Decoding in strips"). A full-size canvas
 * or `ImageData` never exists, so the canvas area limit does not apply: the
 * limits left are what `createImageBitmap` can decode and what WASM memory can
 * hold, and both are reported when they fail.
 *
 * With `reduceTo`, the browser's decoder delivers the image at that size
 * (the user chose it, after the full size was refused, #69), and the file's
 * own size is reported as `reducedFrom`.
 */
export async function decodeInStrips(
  engine: PipelineEngine,
  sourceId: string,
  file: File,
  reduceTo: PixelSize | null = null
): Promise<LoadedSourceInfo> {
  const undecodable = (err: unknown) =>
    new Error(
      `This browser could not decode "${file.name}". It may be damaged, in a format the browser does not read, or too large to decode on this device.`,
      { cause: err }
    );
  let bitmap: ImageBitmap;
  let reducedFrom: PixelSize | undefined;
  try {
    if (reduceTo) {
      // The file's own size, for the record: read from a decode that is thrown away at once.
      const full = await createImageBitmap(file, { imageOrientation: 'from-image' });
      reducedFrom = { widthPx: full.width, heightPx: full.height };
      full.close();
      bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
        premultiplyAlpha: 'none',
        resizeWidth: reduceTo.widthPx,
        resizeHeight: reduceTo.heightPx,
        resizeQuality: 'high',
      });
    } else {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', premultiplyAlpha: 'none' });
    }
  } catch (err) {
    throw undecodable(err);
  }
  try {
    const { width, height } = bitmap;
    engine.beginSource(sourceId, width, height);
    const bandRows = Math.max(1, Math.min(height, Math.floor(BAND_PIXELS / width)));
    const canvas = new OffscreenCanvas(width, bandRows);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('This browser provides no 2D canvas in workers, so it cannot read images here.');
    let hasAlpha = false;
    for (let y = 0; y < height; y += bandRows) {
      const rows = Math.min(bandRows, height - y);
      ctx.clearRect(0, 0, width, bandRows);
      ctx.drawImage(bitmap, 0, -y);
      const band = ctx.getImageData(0, 0, width, rows).data;
      if (engine.writeSourceRows(y, band, rows)) hasAlpha = true;
    }
    return reducedFrom ? { widthPx: width, heightPx: height, hasAlpha, reducedFrom } : { widthPx: width, heightPx: height, hasAlpha };
  } catch (err) {
    engine.releaseSource();
    throw err;
  } finally {
    bitmap.close();
  }
}
