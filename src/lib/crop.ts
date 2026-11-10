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
