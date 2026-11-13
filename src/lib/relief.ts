import type { ImageDocument } from '../types/document';
import type { RenderTarget } from '../types/render';
import { physicalSize } from './document-size';
import { pxPerMmOf } from './render-target';

/**
 * The relief's lengths (bevel width, smoothing) are in millimetres, so the
 * heightmap has the same shape at any resolution. Until the size is set, the
 * image is taken to be this many millimetres along its longest edge; export
 * needs the size, so a file is never written at this assumed size.
 */
export const ASSUMED_LONGEST_EDGE_MM = 100;

/** Pixels per mm of a relief render of `doc` at `target`. */
export function reliefPxPerMm(doc: ImageDocument, target: RenderTarget): number {
  return pxPerMmOf(doc, target) ?? Math.max(target.widthPx, target.heightPx) / ASSUMED_LONGEST_EDGE_MM;
}

/** The relief's physical size in mm, and whether it is the document's (`false`: assumed). */
export function reliefSizeMm(doc: ImageDocument, target: RenderTarget): { widthMm: number; heightMm: number; set: boolean } {
  const size = physicalSize(doc);
  if (size) return { ...size, set: true };
  const pxPerMm = reliefPxPerMm(doc, target);
  return { widthMm: target.widthPx / pxPerMm, heightMm: target.heightPx / pxPerMm, set: false };
}

/** The 8-bit grey image of a heightmap, as RGBA8, for the flat view: what the file holds, at 8 bits. */
export function heightmapToRgba(heights: Uint16Array): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(heights.length * 4);
  for (let i = 0; i < heights.length; i++) {
    const g = heights[i] >> 8;
    rgba[i * 4] = g;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = g;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
