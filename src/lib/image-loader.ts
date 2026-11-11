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

/**
 * Decodes an image file in the browser: its full size after EXIF orientation,
 * the resolution it claims, and a preview of the whole image.
 */
export async function decodeImageFile(file: File): Promise<DecodedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width: widthPx, height: heightPx } = bitmap;
    const size = previewSizeFor(widthPx, heightPx);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not create a 2D canvas to read the image.');
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const preview = ctx.getImageData(0, 0, size.width, size.height).data.buffer as ArrayBuffer;
    return {
      file,
      name: file.name,
      widthPx,
      heightPx,
      hasAlpha: anyTransparent(preview),
      fileDpi: readFileDpi(bytes),
      preview,
      previewWidth: size.width,
      previewHeight: size.height,
    };
  } finally {
    bitmap.close();
  }
}
