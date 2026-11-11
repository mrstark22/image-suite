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

/**
 * Copies the pixels of `rect` out of an RGBA buffer of `width` x `height`.
 * The rectangle is clamped to the image first; if nothing of it lies inside,
 * the whole image is returned unchanged.
 */
export function cropRgba(
  buffer: ArrayBuffer,
  width: number,
  height: number,
  rect: CropRect
): { buffer: ArrayBuffer; width: number; height: number } {
  const r = clampCropRect(rect, width, height);
  if (!r) return { buffer, width, height };
  const src = new Uint8Array(buffer);
  const out = new Uint8Array(r.width * r.height * 4);
  const rowBytes = r.width * 4;
  for (let y = 0; y < r.height; y++) {
    const from = ((r.y + y) * width + r.x) * 4;
    out.set(src.subarray(from, from + rowBytes), y * rowBytes);
  }
  return { buffer: out.buffer, width: r.width, height: r.height };
}

/** True when `buffer` holds exactly one RGBA image of `width` x `height`. */
export function fitsDimensions(buffer: ArrayBuffer, width: number, height: number): boolean {
  return buffer.byteLength === width * height * 4;
}

/**
 * The cropped, unadjusted preview: the input of the preview's worker path.
 * Stopgap until #16 renders it from the full source in the worker.
 */
export interface PreviewSource {
  sourceId: string;
  /** The crop, in source pixels, this preview shows. */
  crop: CropRect;
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

/**
 * The part of a `previewWidth` x `previewHeight` preview of a
 * `sourceWidth` x `sourceHeight` source that shows `crop` (in source pixels),
 * rounded to whole preview pixels and at least one pixel across.
 */
export function cropInPreview(
  crop: CropRect,
  sourceWidth: number,
  sourceHeight: number,
  previewWidth: number,
  previewHeight: number
): CropRect {
  const sx = previewWidth / sourceWidth;
  const sy = previewHeight / sourceHeight;
  const x0 = Math.min(previewWidth - 1, Math.round(crop.x * sx));
  const y0 = Math.min(previewHeight - 1, Math.round(crop.y * sy));
  const x1 = Math.max(x0 + 1, Math.min(previewWidth, Math.round((crop.x + crop.width) * sx)));
  const y1 = Math.max(y0 + 1, Math.min(previewHeight, Math.round((crop.y + crop.height) * sy)));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
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
