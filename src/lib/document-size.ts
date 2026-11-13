import type { CropRect } from '../types/image';
import type { ImageDocument } from '../types/document';

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

/**
 * The size of the image as the document turns it (#65): the source's, with
 * width and height swapped for a quarter turn. The crop and every size shown
 * are in this frame.
 */
export function frameSizeOf(doc: ImageDocument): { widthPx: number; heightPx: number } {
  const { widthPx, heightPx } = doc.source;
  return doc.steps.rotation % 180 === 0 ? { widthPx, heightPx } : { widthPx: heightPx, heightPx: widthPx };
}

/** The crop in pixels of the image as turned, or the whole of it when there is no crop. */
export function cropRectOf(doc: ImageDocument): CropRect {
  const frame = frameSizeOf(doc);
  return doc.steps.crop ?? { x: 0, y: 0, width: frame.widthPx, height: frame.heightPx };
}

/**
 * The crop as a rectangle of the source file's own pixels, before the turn:
 * what the pipeline reads from the source. Turning it by `steps.rotation`
 * gives `cropRectOf(doc)`.
 */
export function sourceCropOf(doc: ImageDocument): CropRect {
  const { x, y, width, height } = cropRectOf(doc);
  const { widthPx: W, heightPx: H } = doc.source;
  switch (doc.steps.rotation) {
    case 90:
      return { x: y, y: H - x - width, width: height, height: width };
    case 180:
      return { x: W - x - width, y: H - y - height, width, height };
    case 270:
      return { x: W - y - height, y: x, width: height, height: width };
    default:
      return { x, y, width, height };
  }
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
