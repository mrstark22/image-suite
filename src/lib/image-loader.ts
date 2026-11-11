import { readFileDpi } from './file-dpi';
import { getPipeline, type Pipeline } from './pipeline-client';

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
}

/** Bytes read from the start of a file to find the resolution it claims. Covers JFIF and a full EXIF segment. */
export const DPI_HEADER_BYTES = 128 * 1024;

/**
 * Loads an image file: the worker decodes it in strips into its own memory as
 * `sourceId`, and this thread reads only the file's first bytes, for the
 * resolution it claims.
 */
export async function decodeImageFile(file: File, sourceId: string, pipeline: Pipeline = getPipeline()): Promise<LoadedSource> {
  const header = new Uint8Array(await file.slice(0, DPI_HEADER_BYTES).arrayBuffer());
  const info = await pipeline.decodeFile(sourceId, file);
  return { sourceId, file, name: file.name, ...info, fileDpi: readFileDpi(header) };
}
