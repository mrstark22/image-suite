import { readFileDpi } from './file-dpi';
import { getPipeline, type Pipeline } from './pipeline-client';
import type { PixelSize } from './reduced-open';

/**
 * An image whose pixels the pipeline holds under `sourceId`, ready to become
 * a document's source. The main thread keeps no copy of the pixels.
 */
export interface LoadedSource {
  sourceId: string;
  file: File | null;
  name: string;
  /** Full resolution, after EXIF orientation. */
  widthPx: number;
  heightPx: number;
  hasAlpha: boolean;
  /** The resolution the file claims, if it claims one. Only ever a suggestion. */
  fileDpi: number | null;
  /** The file's own pixel size, when it was opened smaller than that (#69). */
  reducedFrom?: PixelSize;
}

/**
 * Thrown when a file is too large to open at its own size: over the ceiling,
 * or more than this device's memory holds. It carries the file and its size,
 * so the user can be offered a reduced open (#69).
 */
export class SourceRefusedError extends Error {
  constructor(
    message: string,
    public readonly file: File,
    public readonly size: PixelSize
  ) {
    super(message);
    this.name = 'SourceRefusedError';
  }
}

/** Bytes read from the start of a file to find the resolution it claims. Covers JFIF and a full EXIF segment. */
export const DPI_HEADER_BYTES = 128 * 1024;

/**
 * Loads an image file: the worker decodes it in strips into its own memory as
 * `sourceId`, and this thread reads only the file's first bytes, for the
 * resolution it claims. With `reduceTo`, the image is opened at that size
 * instead of the file's own.
 */
export async function decodeImageFile(
  file: File,
  sourceId: string,
  pipeline: Pipeline = getPipeline(),
  reduceTo: PixelSize | null = null
): Promise<LoadedSource> {
  const header = new Uint8Array(await file.slice(0, DPI_HEADER_BYTES).arrayBuffer());
  const info = await pipeline.decodeFile(sourceId, file, reduceTo);
  if ('refused' in info) {
    const { message, widthPx, heightPx } = info.refused;
    throw new SourceRefusedError(message, file, { widthPx, heightPx });
  }
  // A reduced image has fewer pixels across the same picture: the resolution
  // the file claims is scaled with it, so it still suggests the same physical size.
  const claimed = readFileDpi(header);
  const fileDpi = claimed !== null && info.reducedFrom ? (claimed * info.widthPx) / info.reducedFrom.widthPx : claimed;
  return { sourceId, file, name: file.name, ...info, fileDpi };
}
