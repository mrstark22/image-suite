import type { CropRect, DetailRunParams } from '../types/image';
import type { DetailSettings, ImageDocument } from '../types/document';

/**
 * Physical size, derived from the document. The scale `mmPerPx` (millimetres
 * per source pixel) is stored once; width, height and DPI follow from it and
 * the crop:
 *
 *   widthMm = cropWidthPx * mmPerPx
 *   heightMm = cropHeightPx * mmPerPx
 *   dpi = 25.4 / mmPerPx
 */

export const MM_PER_INCH = 25.4;

export type PhysicalUnit = 'mm' | 'in';

/** The crop in source pixels, or the whole source when there is no crop. */
export function cropRectOf(doc: ImageDocument): CropRect {
  return doc.steps.crop ?? { x: 0, y: 0, width: doc.source.widthPx, height: doc.source.heightPx };
}

/** Width and height in millimetres of the image as cropped, or `null` while the size is not set. */
export function physicalSize(doc: ImageDocument): { widthMm: number; heightMm: number } | null {
  if (doc.mmPerPx === null) return null;
  const crop = cropRectOf(doc);
  return { widthMm: crop.width * doc.mmPerPx, heightMm: crop.height * doc.mmPerPx };
}

/** Source pixels per inch, or `null` while the size is not set. */
export function dpiOf(doc: ImageDocument): number | null {
  return doc.mmPerPx === null ? null : MM_PER_INCH / doc.mmPerPx;
}

/** Millimetres per pixel at `dpi`. */
export function mmPerPxFromDpi(dpi: number): number {
  return MM_PER_INCH / dpi;
}

/** A length in `unit`, converted to millimetres. */
export function toMm(length: number, unit: PhysicalUnit): number {
  return unit === 'mm' ? length : length * MM_PER_INCH;
}

/** A length in millimetres, converted to `unit`. */
export function fromMm(mm: number, unit: PhysicalUnit): number {
  return unit === 'mm' ? mm : mm / MM_PER_INCH;
}

/**
 * The scale at which `lengthPx` source pixels span `length` in `unit`: what
 * setting the width (or height) of the current crop to `length` means.
 */
export function mmPerPxForLength(lengthPx: number, length: number, unit: PhysicalUnit): number {
  return toMm(length, unit) / lengthPx;
}

/**
 * Pixels per millimetre of a render of the crop that is `renderWidthPx` wide,
 * or `null` while the size is not set. The preview, for example, is the crop
 * scaled to at most 2048 px.
 */
export function pxPerMmAt(doc: ImageDocument, renderWidthPx: number): number | null {
  const size = physicalSize(doc);
  return size === null ? null : renderWidthPx / size.widthMm;
}

/**
 * The resolution to write into a file rendered `renderWidthPx` wide. Refuses,
 * by throwing, while the size is not set: there is no honest DPI to write.
 */
export function exportResolution(doc: ImageDocument, renderWidthPx: number): { dpi: number; pxPerMm: number } {
  const pxPerMm = pxPerMmAt(doc, renderWidthPx);
  if (pxPerMm === null) {
    throw new Error('Set the size before exporting: the file needs a physical size to carry.');
  }
  return { dpi: pxPerMm * MM_PER_INCH, pxPerMm };
}

/** The nearest odd integer to `value`, and at least 3. */
export function nearestOddAtLeast3(value: number): number {
  const odd = 2 * Math.round((value - 1) / 2) + 1;
  return Math.max(3, odd);
}

/**
 * The detail settings as the worker runs them on an image with `pxPerMm`
 * pixels per millimetre. While the size is not set (`pxPerMm` is null) the two
 * length-based steps, sharpening and the adaptive threshold, are skipped.
 *
 * Stopgap location: in #16 this becomes part of `toRunParams` in the pipeline.
 */
export function detailRunParams(detail: DetailSettings, pxPerMm: number | null): DetailRunParams {
  const sized = pxPerMm !== null;
  return {
    clahe: detail.clahe,
    claheClipLimit: detail.claheClipLimit,
    claheGridSize: detail.claheGridSize,
    unsharpStrength: sized ? detail.unsharpStrength : 0,
    unsharpRadiusPx: sized ? detail.unsharpRadiusMm * pxPerMm : 0,
    adaptiveThreshold: sized && detail.adaptiveThreshold,
    adaptiveBlockPx: sized ? nearestOddAtLeast3(detail.adaptiveBlockMm * pxPerMm) : 3,
    adaptiveConstant: detail.adaptiveConstant,
  };
}
