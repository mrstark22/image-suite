/**
 * Size arithmetic for images larger than the 2048 px preview. The DPI refers
 * to the file's pixels, so every physical size must be computed from file
 * pixels even though the user crops and measures on the downscaled preview.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  shownFileSize,
  filePxPerPreviewPx,
  previewDpi,
  pxToLength,
  dpiForLength,
} from '../../src/lib/image-size';
import { useImageStore } from '../../src/store/imageStore';
import { useEditStore } from '../../src/store/editStore';
import { openLoadedImage } from '../../src/lib/open-image';

// A 6000x4000 photo, previewed the way image-loader.ts does it.
const FILE = { width: 6000, height: 4000 };
const PREVIEW = { width: 2048, height: Math.round(4000 * (2048 / 6000)), scale: 2048 / 6000 };

describe('physical size of an image larger than the preview', () => {
  it('the preview is 2048 x 1365, so its scale is below 1', () => {
    expect(PREVIEW.height).toBe(1365);
    expect(PREVIEW.scale).toBeLessThan(1);
  });

  it('the uncropped image is the file size exactly, not the preview size scaled back up', () => {
    // 1365 / (2048 / 6000) is 3999.0; the file is 4000 high.
    expect(shownFileSize(FILE, PREVIEW, null)).toEqual({ width: 6000, height: 4000 });
  });

  it('a crop drawn on the preview is measured in file pixels', () => {
    // Half the preview's width and height is half the file's.
    expect(shownFileSize(FILE, PREVIEW, { x: 0, y: 0, width: 1024, height: 683 })).toEqual({
      width: 3000,
      height: 2001,
    });
    const ratio = filePxPerPreviewPx(FILE, PREVIEW);
    expect(ratio.x).toBeCloseTo(6000 / 2048, 12);
    expect(ratio.y).toBeCloseTo(4000 / 1365, 12);
  });

  it('a width of 100 mm on the whole file sets 1524 DPI, not the preview-based 520', () => {
    const size = shownFileSize(FILE, PREVIEW, null);
    const dpi = dpiForLength(size.width, 100, 'mm');
    expect(dpi).toBeCloseTo(1524, 9);
    expect(pxToLength(size.width, dpi, 'mm')).toBeCloseTo(100, 9);
    expect(pxToLength(size.height, dpi, 'mm')).toBeCloseTo(66.667, 3);
  });

  it('at 300 DPI the file is 508 mm wide, and the rulers measure the preview at the matching resolution', () => {
    expect(pxToLength(6000, 300, 'mm')).toBeCloseTo(508, 9);
    const rulerDpi = previewDpi(300, FILE, PREVIEW);
    expect(rulerDpi).toBeCloseTo(300 * (2048 / 6000), 9);
    // The whole preview, measured on the ruler, is the same 508 mm.
    expect(pxToLength(PREVIEW.width, rulerDpi, 'mm')).toBeCloseTo(508, 9);
  });

  it('inches and millimetres agree', () => {
    expect(dpiForLength(6000, 20, 'in')).toBeCloseTo(300, 9);
    expect(pxToLength(6000, 300, 'in')).toBeCloseTo(20, 9);
  });
});

describe('the size shown follows the open image and its crop', () => {
  beforeEach(() => {
    useImageStore.getState().clearImage();
    useEditStore.getState().startNewImage();
    const preview = new ArrayBuffer(PREVIEW.width * PREVIEW.height * 4);
    openLoadedImage({
      file: new File([], 'photo.jpg'),
      originalBuffer: new ArrayBuffer(0),
      // SAFETY: no store code reads the bitmap; Node has no ImageBitmap to construct.
      bitmap: null as unknown as ImageBitmap,
      metadata: {
        name: 'photo.jpg',
        width: FILE.width,
        height: FILE.height,
        dpi: 300,
        aspectRatio: 1.5,
        originalSizeBytes: 0,
        format: 'image/jpeg',
        hasAlpha: false,
      },
      previewBuffer: preview,
      previewDims: PREVIEW,
    });
  });

  const shown = () => {
    const { metadata, sourcePreviewDimensions } = useImageStore.getState();
    return shownFileSize(metadata!, sourcePreviewDimensions!, useEditStore.getState().geometry.cropRect);
  };

  it('is the file size before cropping, and the cropped file size after', () => {
    expect(shown()).toEqual({ width: 6000, height: 4000 });
    useEditStore.getState().cropTo({ x: 512, y: 0, width: 1024, height: 1365 });
    expect(shown()).toEqual({ width: 3000, height: 4000 });
    useEditStore.getState().undo();
    expect(shown()).toEqual({ width: 6000, height: 4000 });
  });
});
