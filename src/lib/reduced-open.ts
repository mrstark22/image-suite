/**
 * Opening an image at a reduced size (#69, design section 5): when a file is
 * larger than the pipeline takes or than this device can hold, the user may
 * open it smaller, at a size they choose. Nothing smaller is substituted
 * without being asked.
 */

export interface PixelSize {
  widthPx: number;
  heightPx: number;
}

/** The megapixel sizes offered, largest first. */
export const REDUCED_MEGAPIXELS = [100, 50, 25, 12, 6] as const;

/** `size` scaled down, keeping its shape, to at most `maxPixels` pixels. A size already within it is returned as it is. */
export function reducedSize(size: PixelSize, maxPixels: number): PixelSize {
  const pixels = size.widthPx * size.heightPx;
  if (pixels <= maxPixels) return { widthPx: size.widthPx, heightPx: size.heightPx };
  const scale = Math.sqrt(maxPixels / pixels);
  return {
    widthPx: Math.max(1, Math.floor(size.widthPx * scale)),
    heightPx: Math.max(1, Math.floor(size.heightPx * scale)),
  };
}

/** The reduced sizes offered for a file of `size`: each megapixel choice smaller than the file, with the size it gives. */
export function reducedChoices(size: PixelSize): Array<{ megapixels: number; size: PixelSize }> {
  const pixels = size.widthPx * size.heightPx;
  return REDUCED_MEGAPIXELS.filter((mp) => mp * 1e6 < pixels).map((megapixels) => ({
    megapixels,
    size: reducedSize(size, megapixels * 1e6),
  }));
}

/** "6000 × 4000 px (24.0 MP)". */
export function describeSize(size: PixelSize): string {
  return `${size.widthPx} × ${size.heightPx} px (${((size.widthPx * size.heightPx) / 1e6).toFixed(1)} MP)`;
}
