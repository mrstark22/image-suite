import { readFileDpi } from './file-dpi';

/** Longest edge of the interactive preview, in pixels. */
export const MAX_PREVIEW_EDGE = 2048;

/** An image decoded and ready to become a document's source. */
export interface DecodedImage {
  file: File | null;
  name: string;
  /** Full resolution, after EXIF orientation. */
  widthPx: number;
  heightPx: number;
  hasAlpha: boolean;
  fileDpi: number | null;
  /** RGBA8 pixels of the whole image, scaled so its longest edge is at most 2048 px. */
  preview: ArrayBuffer;
  previewWidth: number;
  previewHeight: number;
}

/** Size of the preview of a `width` x `height` image: longest edge at most `maxEdge`. */
export function previewSizeFor(
  width: number,
  height: number,
  maxEdge = MAX_PREVIEW_EDGE
): { width: number; height: number } {
  if (width <= maxEdge && height <= maxEdge) return { width, height };
  const scale = maxEdge / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** True when any pixel of an RGBA8 buffer is not fully opaque. */
export function anyTransparent(rgba: ArrayBuffer): boolean {
  const data = new Uint8Array(rgba);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return true;
  }
  return false;
}

/** Bytes read from the start of a file to find the resolution it claims. Covers JFIF and a full EXIF segment. */
export const DPI_HEADER_BYTES = 128 * 1024;

/**
 * A 2D context on a `width` x `height` canvas: an OffscreenCanvas where the
 * browser has one, otherwise a DOM canvas. Throws a clear error when neither
 * exists, rather than failing somewhere less obvious.
 */
export function canvas2d(width: number, height: number): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  if (typeof OffscreenCanvas !== 'undefined') {
    ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
  } else if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!ctx) {
    throw new Error('This browser cannot read images here: it provides no 2D canvas. Try a current Chrome, Edge, Firefox or Safari.');
  }
  return ctx;
}

/** RGBA8 pixels of `bitmap` scaled so its longest edge is at most 2048 px. */
export function previewOfBitmap(bitmap: ImageBitmap): { preview: ArrayBuffer; previewWidth: number; previewHeight: number } {
  const size = previewSizeFor(bitmap.width, bitmap.height);
  const ctx = canvas2d(size.width, size.height);
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  const preview = ctx.getImageData(0, 0, size.width, size.height).data.buffer as ArrayBuffer;
  return { preview, previewWidth: size.width, previewHeight: size.height };
}

/**
 * Decodes an image file in the browser: its full size after EXIF orientation,
 * the resolution it claims (read from the file's first bytes only), and a
 * preview of the whole image.
 */
export async function decodeImageFile(file: File): Promise<DecodedImage> {
  const header = new Uint8Array(await file.slice(0, DPI_HEADER_BYTES).arrayBuffer());
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { preview, previewWidth, previewHeight } = previewOfBitmap(bitmap);
    return {
      file,
      name: file.name,
      widthPx: bitmap.width,
      heightPx: bitmap.height,
      hasAlpha: anyTransparent(preview),
      fileDpi: readFileDpi(header),
      preview,
      previewWidth,
      previewHeight,
    };
  } finally {
    bitmap.close();
  }
}
