/**
 * Holds the pixels behind a document's `source`, which the document itself
 * does not carry. Only the open image's source is kept; registering a new one
 * releases the previous.
 *
 * Stopgap: until #16 moves the decoded source into the worker, the source is
 * kept here as a downscaled preview (longest edge at most 2048 px) of the
 * whole image.
 */
export interface SourcePixels {
  /** The encoded file, when the image came from one. */
  file: File | null;
  /** RGBA8 pixels of the whole image at preview size. */
  preview: ArrayBuffer;
  previewWidth: number;
  previewHeight: number;
}

let current: { sourceId: string; pixels: SourcePixels } | null = null;

/** Makes `pixels` the source `sourceId`, releasing any other source. */
export function registerSource(sourceId: string, pixels: SourcePixels): void {
  current = { sourceId, pixels };
}

/** The pixels of `sourceId`, or `null` if they have been released. */
export function sourcePixels(sourceId: string): SourcePixels | null {
  return current?.sourceId === sourceId ? current.pixels : null;
}

/** Releases every source. */
export function releaseSources(): void {
  current = null;
}
