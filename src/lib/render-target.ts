import type { ImageDocument } from '../types/document';
import type { RenderTarget } from '../types/render';
import { cropRectOf, physicalSize } from './document-size';

/** Longest edge of the interactive preview, in pixels. */
export const PREVIEW_MAX_EDGE = 2048;

/**
 * The crop scaled so its longest edge is at most `maxEdge`. A crop already
 * within it is rendered at its own size, never enlarged.
 */
export function previewTarget(doc: ImageDocument, maxEdge = PREVIEW_MAX_EDGE): RenderTarget {
  const crop = cropRectOf(doc);
  const longest = Math.max(crop.width, crop.height);
  if (longest <= maxEdge) return { widthPx: crop.width, heightPx: crop.height };
  const scale = maxEdge / longest;
  return {
    widthPx: Math.max(1, Math.round(crop.width * scale)),
    heightPx: Math.max(1, Math.round(crop.height * scale)),
  };
}

/** The crop at the source's full resolution. */
export function nativeTarget(doc: ImageDocument): RenderTarget {
  const crop = cropRectOf(doc);
  return { widthPx: crop.width, heightPx: crop.height };
}

/** Pixels per millimetre of a render at `target`, or `null` while the size is not set. */
export function pxPerMmOf(doc: ImageDocument, target: RenderTarget): number | null {
  const size = physicalSize(doc);
  return size === null ? null : target.widthPx / size.widthMm;
}

/** True when two targets are the same size. */
export function sameTarget(a: RenderTarget, b: RenderTarget): boolean {
  return a.widthPx === b.widthPx && a.heightPx === b.heightPx;
}
