import type { PipelineEngine } from '../lib/pipeline-engine';
import type { LoadedSourceInfo } from '../types/worker-messages';

/** Largest band drawn at once while decoding, in pixels (design section 5). */
const BAND_PIXELS = 4_000_000;

/**
 * Decodes `file` straight into the engine's source memory, one horizontal
 * band at a time (design section 5, "Decoding in strips"). A full-size canvas
 * or `ImageData` never exists, so the canvas area limit does not apply: the
 * limits left are what `createImageBitmap` can decode and what WASM memory can
 * hold, and both are reported when they fail.
 */
export async function decodeInStrips(engine: PipelineEngine, sourceId: string, file: File): Promise<LoadedSourceInfo> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', premultiplyAlpha: 'none' });
  } catch (err) {
    throw new Error(
      `This browser could not decode "${file.name}". It may be damaged, in a format the browser does not read, or too large to decode on this device.`,
      { cause: err }
    );
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
    return { widthPx: width, heightPx: height, hasAlpha };
  } catch (err) {
    engine.releaseSource();
    throw err;
  } finally {
    bitmap.close();
  }
}
