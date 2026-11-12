/**
 * Helpers for tests that open images in the document store without a browser.
 */
import type { LoadedSource } from '../../src/lib/image-loader';
import { newSourceId } from '../../src/store/documentStore';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { useUIStore } from '../../src/store/uiStore';

/** Pixel value used to label each preview pixel, so a crop can be checked exactly. */
export function labelOf(x: number, y: number): [number, number, number] {
  return [(x * 7) % 256, (y * 11) % 256, (x + y * 3) % 256];
}

/** An opaque RGBA image whose every pixel is labelled with its own coordinates. */
export function labelledImage(width: number, height: number): ArrayBuffer {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = labelOf(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data.buffer;
}

/**
 * A `widthPx` x `heightPx` source with a new id, as `open` takes it. Its pixels
 * are not loaded anywhere: enough for tests of the document and its history.
 * Tests that render load pixels with `loadPixels` (tests/helpers/pipeline.ts).
 */
export function decodedImage(widthPx: number, heightPx: number, fileDpi: number | null = null, name = 'test.png'): LoadedSource {
  return { sourceId: newSourceId(), file: null, name, widthPx, heightPx, hasAlpha: false, fileDpi };
}

/** A 6000x4000 photo; its preview target is 2048x1365. */
export const PHOTO = { widthPx: 6000, heightPx: 4000, previewWidth: 2048, previewHeight: 1365 };

/** Opens the 6000x4000 photo (metadata only). */
export function openPhoto(fileDpi: number | null = null): void {
  useDocumentStore.getState().open(decodedImage(PHOTO.widthPx, PHOTO.heightPx, fileDpi, 'photo.jpg'));
}

/** Closes any document and resets the stores between tests. */
export function resetStores(): void {
  useDocumentStore.getState().close();
  useRenderStore.setState({ errorMessage: null });
  useUIStore.setState({ isSizeDialogOpen: false });
}

/** The open document; fails the test if there is none. */
export function currentDoc() {
  const doc = useDocumentStore.getState().doc;
  if (!doc) throw new Error('No document is open');
  return doc;
}

/**
 * How many pixels of the preview's `source` render differ from the labelled
 * image's pixels from (`ox`, `oy`) over `width` x `height`; infinite when the
 * render is not that size. Exact only for renders at 1:1 (no resampling).
 */
export function previewMismatches(ox: number, oy: number, width: number, height: number): number {
  const source = useRenderStore.getState().source;
  if (!source || source.width !== width || source.height !== height) return Number.POSITIVE_INFINITY;
  const data = new Uint8Array(source.buffer);
  let mismatches = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = labelOf(ox + x, oy + y);
      const i = (y * width + x) * 4;
      if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b || data[i + 3] !== 255) mismatches++;
    }
  }
  return mismatches;
}
