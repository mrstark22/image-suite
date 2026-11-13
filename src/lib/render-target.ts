import type { ImageDocument } from '../types/document';
import type { RenderTarget } from '../types/render';
import { MM_PER_INCH, cropRectOf, exportResolution, physicalSize } from './document-size';
import { backgroundKeyPart } from './background';

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

/**
 * Largest dot grid the preview renders dot for dot, in pixels. Above it the
 * preview dithers a smaller copy, and says so; export is always exact.
 */
export const MAX_DOT_GRID_PREVIEW_PIXELS = 16_000_000;

/**
 * The machine's dot grid for `doc` (#34): the crop's physical size divided
 * by the dot pitch (the line interval), so one pixel is one laser dot. Null
 * when the image is not dithered or its size is not set; then no grid applies.
 */
export function dotGridTarget(doc: ImageDocument): RenderTarget | null {
  const { algorithm, dotPitchMm } = doc.steps.dither;
  const size = physicalSize(doc);
  if (algorithm === 'none' || size === null || !(dotPitchMm > 0)) return null;
  return {
    widthPx: Math.max(1, Math.round(size.widthMm / dotPitchMm)),
    heightPx: Math.max(1, Math.round(size.heightMm / dotPitchMm)),
  };
}

/**
 * The photo preview's target: the dot grid itself when it is at most
 * `MAX_DOT_GRID_PREVIEW_PIXELS` (`exact`), otherwise the grid scaled down to
 * that many pixels; the ordinary preview target when no grid applies.
 */
export function photoPreviewTarget(doc: ImageDocument): { target: RenderTarget; exact: boolean } {
  const grid = dotGridTarget(doc);
  if (!grid) return { target: previewTarget(doc), exact: true };
  const pixels = grid.widthPx * grid.heightPx;
  if (pixels <= MAX_DOT_GRID_PREVIEW_PIXELS) return { target: grid, exact: true };
  const scale = Math.sqrt(MAX_DOT_GRID_PREVIEW_PIXELS / pixels);
  return {
    target: { widthPx: Math.max(1, Math.floor(grid.widthPx * scale)), heightPx: Math.max(1, Math.floor(grid.heightPx * scale)) },
    exact: false,
  };
}

/** What a raster export writes: its pixel size, its resolution and the physical size they give. */
export interface ExportPlan {
  target: RenderTarget;
  pxPerMm: number;
  dpi: number;
  widthMm: number;
  heightMm: number;
}

/**
 * The raster export of `doc`. A dithered image is the machine's dot grid at
 * the dot pitch's resolution; otherwise it is the crop at the source's full
 * resolution, at the resolution that gives it the document's physical size. The Export panel
 * shows this and the worker renders it, so the size shown is the size
 * written. Throws while the size is not set.
 */
export function exportPlan(doc: ImageDocument): ExportPlan {
  const grid = dotGridTarget(doc);
  if (grid) {
    // A dithered image: exactly one pixel per dot, at the dot pitch's DPI (#34, #39).
    const pxPerMm = 1 / doc.steps.dither.dotPitchMm;
    return {
      target: grid,
      pxPerMm,
      dpi: pxPerMm * MM_PER_INCH,
      widthMm: grid.widthPx / pxPerMm,
      heightMm: grid.heightPx / pxPerMm,
    };
  }
  const target = nativeTarget(doc);
  const { dpi, pxPerMm } = exportResolution(doc, target.widthPx);
  return { target, pxPerMm, dpi, widthMm: target.widthPx / pxPerMm, heightMm: target.heightPx / pxPerMm };
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

/**
 * Identifies a `source`-stage render: the source, how it is turned, the crop,
 * background removal and the target size.
 */
export function sourceStageKey(doc: ImageDocument, target: RenderTarget): string {
  const c = cropRectOf(doc);
  return `${doc.source.sourceId}|r${doc.steps.rotation}|${c.x},${c.y},${c.width},${c.height}|${backgroundKeyPart(doc)}|${target.widthPx}x${target.heightPx}`;
}
