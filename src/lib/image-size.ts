import type { CropRect, ImageMetadata, PreviewDimensions } from '../types/image';

/**
 * Size arithmetic shared by every place that shows or sets a physical size.
 *
 * The DPI in `ImageMetadata` refers to the file's own pixels. The preview is a
 * downscaled copy (at most 2048 px on its longest edge), so anything measured
 * in preview pixels is converted to file pixels before it is turned into a
 * physical size.
 */

export const MM_PER_INCH = 25.4;

export type PhysicalUnit = 'mm' | 'in';

/** Size in file pixels. */
export interface PixelSize {
  width: number;
  height: number;
}

/**
 * File pixels per preview pixel, per axis. The preview's dimensions are
 * rounded, so the two axes can differ slightly; using each axis's own ratio
 * maps the full preview exactly onto the full file.
 */
export function filePxPerPreviewPx(
  metadata: Pick<ImageMetadata, 'width' | 'height'>,
  wholePreview: Pick<PreviewDimensions, 'width' | 'height'>
): { x: number; y: number } {
  return {
    x: metadata.width / wholePreview.width,
    y: metadata.height / wholePreview.height,
  };
}

/**
 * Size in file pixels of the image as currently shown: the whole file when
 * there is no crop, otherwise the crop (given in pixels of the uncropped
 * preview) scaled to file pixels.
 */
export function shownFileSize(
  metadata: Pick<ImageMetadata, 'width' | 'height'>,
  wholePreview: Pick<PreviewDimensions, 'width' | 'height'>,
  crop: CropRect | null
): PixelSize {
  if (!crop) return { width: metadata.width, height: metadata.height };
  const ratio = filePxPerPreviewPx(metadata, wholePreview);
  return {
    width: Math.max(1, Math.round(crop.width * ratio.x)),
    height: Math.max(1, Math.round(crop.height * ratio.y)),
  };
}

/**
 * Preview pixels per inch at a file resolution of `dpi`. Rulers and overlays
 * that measure the preview use this, so their millimetres agree with the file.
 */
export function previewDpi(
  dpi: number,
  metadata: Pick<ImageMetadata, 'width' | 'height'>,
  wholePreview: Pick<PreviewDimensions, 'width' | 'height'>
): number {
  return dpi / filePxPerPreviewPx(metadata, wholePreview).x;
}

/** Physical length of `px` pixels at `dpi`, in `unit`. */
export function pxToLength(px: number, dpi: number, unit: PhysicalUnit): number {
  const inches = px / dpi;
  return unit === 'mm' ? inches * MM_PER_INCH : inches;
}

/** DPI at which `px` pixels span `length` in `unit`. */
export function dpiForLength(px: number, length: number, unit: PhysicalUnit): number {
  const inches = unit === 'mm' ? length / MM_PER_INCH : length;
  return px / inches;
}
