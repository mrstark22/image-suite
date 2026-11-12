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

/** The crop box's aspect-ratio choices. */
export type CropAspect = 'free' | '1:1' | '4:3' | '16:9' | '3:2';

/** Which part of the crop box a drag or key moves: the body, or an edge or corner (compass points). */
export type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** The crop box's smallest side, in preview pixels. */
export const MIN_CROP_SIDE = 30;

/**
 * The box `box` becomes when `handle` is moved by (dx, dy) preview pixels in
 * an image of `dims`: the body moves the box, kept inside the image; an edge
 * or corner resizes it, no smaller than `MIN_CROP_SIDE` and no larger than
 * the image, then `ratio` sets the height from the width. Pointer drags and
 * the arrow keys both go through here (#79).
 */
export function adjustCropBox(
  box: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  dims: { width: number; height: number },
  ratio: CropAspect = 'free',
): CropRect {
  let x = box.x;
  let y = box.y;
  let w = box.width;
  let h = box.height;

  if (handle === 'move') {
    x = Math.max(0, Math.min(dims.width - w, box.x + dx));
    y = Math.max(0, Math.min(dims.height - h, box.y + dy));
  } else {
    if (handle.includes('e')) w = Math.max(MIN_CROP_SIDE, Math.min(dims.width - x, box.width + dx));
    if (handle.includes('s')) h = Math.max(MIN_CROP_SIDE, Math.min(dims.height - y, box.height + dy));
    if (handle.includes('w') && box.width - dx >= MIN_CROP_SIDE) {
      x = Math.max(0, box.x + dx);
      w = box.width + (box.x - x);
    }
    if (handle.includes('n') && box.height - dy >= MIN_CROP_SIDE) {
      y = Math.max(0, box.y + dy);
      h = box.height + (box.y - y);
    }
    if (ratio === '1:1') {
      const side = Math.min(w, h);
      w = side;
      h = side;
    } else if (ratio === '4:3') {
      h = Math.round(w * (3 / 4));
    } else if (ratio === '16:9') {
      h = Math.round(w * (9 / 16));
    } else if (ratio === '3:2') {
      h = Math.round(w * (2 / 3));
    }
  }

  return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

/** How far one arrow key moves or sizes the crop box, in preview pixels; Alt makes it one pixel. */
export const CROP_KEY_STEP = 10;

/** A key press as the crop box reads it. */
export interface CropKey {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * The crop box after the key press `press` (#79): an arrow moves the box by
 * `CROP_KEY_STEP` preview pixels; with Shift it moves the bottom-right corner
 * instead, so Right and Down grow the box and Left and Up shrink it; with Alt
 * the step is one pixel. Returns null for any other key.
 */
export function cropBoxForKey(
  box: CropRect,
  press: CropKey,
  dims: { width: number; height: number },
  ratio: CropAspect = 'free',
): CropRect | null {
  const step = press.altKey ? 1 : CROP_KEY_STEP;
  const deltas: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const d = deltas[press.key];
  if (!d) return null;
  return adjustCropBox(box, press.shiftKey ? 'se' : 'move', d[0], d[1], dims, ratio);
}
