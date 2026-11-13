import * as Comlink from 'comlink';
import { generateTestGridRaster, testGridSizePx, type TestGridOptions } from './test-grid-generator';
import { mmPerPxFromDpi } from './document-size';
import { setDither } from './document';
import { newSourceId, useDocumentStore } from '../store/documentStore';
import { getPipeline, type Pipeline } from './pipeline-client';

/** Default resolution of a raster test grid. */
export const DEFAULT_TEST_GRID_DPI = 300;

/** Largest raster test grid generated, in pixels: 50 MP is a 200 MB RGBA buffer. */
export const MAX_TEST_GRID_PIXELS = 50_000_000;

/**
 * Generates a raster test grid at `options.dpi` (the grid's own resolution,
 * chosen by the user; not taken from the open image) and opens it as a new
 * document whose size is set to match. Refuses, before allocating anything,
 * a grid larger than `MAX_TEST_GRID_PIXELS`. The preview is capped at 2048 px
 * like any other image.
 */
export async function openTestGridRaster(
  options: TestGridOptions,
  name: string,
  pipeline: Pipeline = getPipeline()
): Promise<void> {
  const size = testGridSizePx(options);
  if (size.width * size.height > MAX_TEST_GRID_PIXELS) {
    throw new Error(
      `This grid would be ${size.width} × ${size.height} px at ${options.dpi} DPI, more than ${MAX_TEST_GRID_PIXELS / 1e6} megapixels. Use fewer or smaller boxes, or a lower DPI.`
    );
  }
  const { buffer, width, height } = generateTestGridRaster(options);
  const sourceId = newSourceId();
  // The pixels move to the worker, which holds every source; none stay here.
  const info = await pipeline.putSource(sourceId, Comlink.transfer(buffer, [buffer]), width, height);
  useDocumentStore.getState().open(
    { sourceId, file: null, name, ...info, fileDpi: null },
    mmPerPxFromDpi(options.dpi),
    // A calibration card is burned exactly as generated: it never takes the previous image's settings.
    'defaults'
  );
  // Not dithered either: a new photo is (#34), but the card is burned as generated.
  useDocumentStore.getState().syncAll(setDither({ algorithm: 'none' }));
}
