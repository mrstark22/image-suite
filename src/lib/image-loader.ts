import type { ImageMetadata, PreviewDimensions } from '../types/image';

const MAX_PREVIEW_SIZE = 2048;

/**
 * Loads an image file and produces both original data and downscaled preview buffers.
 */
export async function loadImageFromFile(file: File): Promise<{
  originalBuffer: ArrayBuffer;
  bitmap: ImageBitmap;
  metadata: ImageMetadata;
  previewBuffer: ArrayBuffer;
  previewDims: PreviewDimensions;
}> {
  // Read raw ArrayBuffer
  const originalBuffer = await file.arrayBuffer();

  // Create ImageBitmap (automatically handles EXIF orientation)
  const blob = new Blob([originalBuffer], { type: file.type || 'image/png' });
  const bitmap = await createImageBitmap(blob);

  const { width: origWidth, height: origHeight } = bitmap;

  // Calculate preview dimensions (aspect ratio preserved, max 2048px)
  let prevWidth = origWidth;
  let prevHeight = origHeight;
  let scale = 1.0;

  if (origWidth > MAX_PREVIEW_SIZE || origHeight > MAX_PREVIEW_SIZE) {
    if (origWidth >= origHeight) {
      scale = MAX_PREVIEW_SIZE / origWidth;
      prevWidth = MAX_PREVIEW_SIZE;
      prevHeight = Math.round(origHeight * scale);
    } else {
      scale = MAX_PREVIEW_SIZE / origHeight;
      prevHeight = MAX_PREVIEW_SIZE;
      prevWidth = Math.round(origWidth * scale);
    }
  }

  // Draw into OffscreenCanvas (or regular canvas fallback) to extract RGBA pixel buffer
  let previewBuffer: ArrayBuffer;
  if (typeof OffscreenCanvas !== 'undefined') {
    const offscreen = new OffscreenCanvas(prevWidth, prevHeight);
    const ctx = offscreen.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Failed to create OffscreenCanvas 2D context');
    ctx.drawImage(bitmap, 0, 0, prevWidth, prevHeight);
    const imageData = ctx.getImageData(0, 0, prevWidth, prevHeight);
    previewBuffer = imageData.data.buffer.slice(0);
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = prevWidth;
    canvas.height = prevHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Failed to create canvas 2D context');
    ctx.drawImage(bitmap, 0, 0, prevWidth, prevHeight);
    const imageData = ctx.getImageData(0, 0, prevWidth, prevHeight);
    previewBuffer = imageData.data.buffer.slice(0);
  }

  const metadata: ImageMetadata = {
    name: file.name,
    width: origWidth,
    height: origHeight,
    dpi: 300, // standard default manufacturing DPI
    aspectRatio: origWidth / origHeight,
    originalSizeBytes: file.size,
    format: file.type || 'image/png',
    hasAlpha: true,
  };

  const previewDims: PreviewDimensions = {
    width: prevWidth,
    height: prevHeight,
    scale,
  };

  return {
    originalBuffer,
    bitmap,
    metadata,
    previewBuffer,
    previewDims,
  };
}
