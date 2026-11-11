import { generateTestGridRaster, testGridSizePx, type TestGridOptions } from './test-grid-generator';
import { mmPerPxFromDpi } from './document-size';
import { previewOfBitmap, type DecodedImage } from './image-loader';
import { useDocumentStore } from '../store/documentStore';

/** Default resolution of a raster test grid. */
export const DEFAULT_TEST_GRID_DPI = 300;

/** Largest raster test grid generated, in pixels: 50 MP is a 200 MB RGBA buffer. */
export const MAX_TEST_GRID_PIXELS = 50_000_000;

/** Makes the preview of a generated RGBA grid. In the browser, through the same canvas path as a loaded file. */
export type GridPreviewMaker = (
  rgba: ArrayBuffer,
  width: number,
  height: number
) => Promise<Pick<DecodedImage, 'preview' | 'previewWidth' | 'previewHeight'>>;

const browserPreview: GridPreviewMaker = async (rgba, width, height) => {
  const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(rgba), width, height));
  try {
    return previewOfBitmap(bitmap);
  } finally {
    bitmap.close();
  }
};

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
  makePreview: GridPreviewMaker = browserPreview
): Promise<void> {
  const size = testGridSizePx(options);
  if (size.width * size.height > MAX_TEST_GRID_PIXELS) {
    throw new Error(
      `This grid would be ${size.width} × ${size.height} px at ${options.dpi} DPI, more than ${MAX_TEST_GRID_PIXELS / 1e6} megapixels. Use fewer or smaller boxes, or a lower DPI.`
    );
  }
  const { buffer, width, height } = generateTestGridRaster(options);
  const preview = await makePreview(buffer, width, height);
  useDocumentStore.getState().open(
    { file: null, name, widthPx: width, heightPx: height, hasAlpha: false, fileDpi: null, ...preview },
    mmPerPxFromDpi(options.dpi)
  );
}
