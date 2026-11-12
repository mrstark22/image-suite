import type { CropRect } from '../types/image';

/**
 * Clamps `rect` to whole pixels inside a `width` x `height` image. Returns null
 * when nothing of the rectangle lies inside the image.
 */
export function clampCropRect(rect: CropRect, width: number, height: number): CropRect | null {
  const x0 = Math.max(0, Math.min(width, Math.round(rect.x)));
  const y0 = Math.max(0, Math.min(height, Math.round(rect.y)));
  const x1 = Math.max(0, Math.min(width, Math.round(rect.x + rect.width)));
  const y1 = Math.max(0, Math.min(height, Math.round(rect.y + rect.height)));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** True when `buffer` holds exactly one RGBA image of `width` x `height`. */
export function fitsDimensions(buffer: ArrayBuffer, width: number, height: number): boolean {
  return buffer.byteLength === width * height * 4;
}

/**
 * The `source`-stage render at the preview target: the crop, flattened and
 * resampled, with no adjustments. The worker renders it; the canvas shows it
 * as the original, and the crop overlay maps boxes drawn on it.
 */
export interface PreviewSource {
  /** Identifies the render: source, crop and size (`sourceStageKey`). */
  key: string;
  sourceId: string;
  /** The crop, in source pixels, this preview shows. */
  crop: CropRect;
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

/**
 * Converts `box`, drawn in pixels of `preview` (a preview of the crop
 * `preview.crop`), to source pixels. The result is clamped to that crop, so a
 * new crop can only shrink the image shown.
 */
export function previewBoxToSource(preview: Pick<PreviewSource, 'crop' | 'width' | 'height'>, box: CropRect): CropRect | null {
  const inView = clampCropRect(box, preview.width, preview.height);
  if (!inView) return null;
  const { crop } = preview;
  const sx = crop.width / preview.width;
  const sy = crop.height / preview.height;
  const x0 = crop.x + Math.round(inView.x * sx);
  const y0 = crop.y + Math.round(inView.y * sy);
  const x1 = crop.x + Math.round((inView.x + inView.width) * sx);
  const y1 = crop.y + Math.round((inView.y + inView.height) * sy);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
