import type { ImageDocument } from './document';
import type { CropRect } from './image';
import type { RenderOutput, RenderTarget } from './render';
import type { DepthResult } from './depth';
import type { DepthModelProgress } from '../lib/ai-depth';

/** A render of the document for the preview or the relief view, at the preview target. */
export interface DocumentRenderRequest {
  doc: ImageDocument;
  target: RenderTarget;
  /**
   * The key of the `source`-stage render the main thread already holds. The
   * result carries the `source`-stage pixels only when its key differs.
   */
  haveSourceKey: string | null;
  /**
   * How far the preview runs: `final` (with the dither) by default, or
   * `prepared` in the vector job, which shows the image the trace reads.
   */
  stage?: 'prepared' | 'final';
}

/** The `source`-stage render a result was made from, sent when the main thread does not have it. */
export interface SourceStage {
  key: string;
  /** The crop it shows, in source pixels. */
  crop: CropRect;
  pixels: ArrayBuffer;
  width: number;
  height: number;
}

export interface PreviewRenderResult {
  /** The key of the `source`-stage render this was made from. */
  key: string;
  final: RenderOutput;
  sourceStage: SourceStage | null;
  durationMs: number;
}

export interface ReliefRenderResult {
  key: string;
  depth: DepthResult;
  sourceStage: SourceStage | null;
  durationMs: number;
}

/** A trace of the document. Phase 1 traces the `source` stage at the preview target, as before (#23). */
export interface TraceRequest {
  doc: ImageDocument;
  target: RenderTarget;
}

/** What loading a source reports. */
export interface LoadedSourceInfo {
  widthPx: number;
  heightPx: number;
  hasAlpha: boolean;
  /** The file's own pixel size, when it was opened smaller than that (#69); absent otherwise. */
  reducedFrom?: { widthPx: number; heightPx: number };
}

/**
 * Returned instead of a loaded source when the image itself is too large:
 * over the ceiling, or more than this device's memory holds. It carries the
 * image's size so the user can be offered a reduced open (#69). Other
 * failures are thrown.
 */
export interface SourceRefusal {
  refused: { message: string; widthPx: number; heightPx: number };
}

/** Progress of a relief render or heightmap export: the AI model's, or the export's. */
export interface ReliefProgress {
  model?: DepthModelProgress;
  export?: ExportProgress;
}

/** What background removal would do, for the panel's comparison (#50). */
export interface BackgroundPreview {
  /** The `source` stage without removal, RGBA8. */
  original: ArrayBuffer;
  /** Coverage per pixel: 255 kept, 0 removed. */
  alpha: ArrayBuffer;
  widthPx: number;
  heightPx: number;
}

/** Raster export formats (design section 6). JPEG and WebP carry no DPI here and are not offered. */
export type RasterFormat = 'png' | 'bmp';

/**
 * Where a raster export has got to. The stages are the calls that actually
 * exist (design section 5): preparing the source, processing (steps 4 to 6 in
 * one call) and encoding, which reports the fraction of rows written.
 */
export interface ExportProgress {
  stage: 'preparing' | 'processing' | 'encoding';
  /** Fraction of the stage done: 0 or 1 except while encoding. */
  fraction: number;
}

/** A finished raster export: the file's bytes and what they hold. */
export interface RasterExport {
  bytes: ArrayBuffer;
  mimeType: string;
  extension: string;
  widthPx: number;
  heightPx: number;
  /** The pixels per millimetre written into the file, before rounding to whole pixels per metre. */
  pxPerMm: number;
}
