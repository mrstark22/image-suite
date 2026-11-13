import type { ImageDocument } from '../types/document';
import type { VectorResult } from '../types/vector';
import { nativeTarget } from './render-target';
import { traceToDxf, traceToSvg } from './vector-export';
import { setVector } from './document';
import { paletteFromResult } from './trace-palette';
import { viewOf, type TraceView } from './trace-view';
import type { RenderTarget } from '../types/render';

export type VectorFormat = 'svg' | 'dxf';

/** What the worker needs to trace and write a vector file (see `PipelineWorkerApi.exportVectorFile`). */
export interface VectorExportRequest {
  doc: ImageDocument;
  target: RenderTarget;
  view: TraceView;
  format: VectorFormat;
}

/**
 * The export of `shown`, the trace of `doc` on screen (see `traceIsCurrent`):
 * traced again in the worker at the source's full resolution, so detail the
 * preview cannot hold is in the file, with the layers hidden and ordered as
 * on screen.
 *
 * With an automatic palette the export uses the colours `shown` found, so its
 * layers are the colours on screen: clustering the full-resolution image
 * again can split the colours differently (review of #84).
 */
export function vectorExportRequest(
  doc: ImageDocument,
  shown: VectorResult,
  format: VectorFormat
): VectorExportRequest {
  const view = viewOf(shown);
  const palette = doc.vector.colorMode === 'color' && doc.vector.palette === null ? paletteFromResult(shown) : null;
  return { doc: palette ? setVector({ palette })(doc) : doc, target: nativeTarget(doc), view, format };
}

/** The file contents and type for `result` in `format`. */
export function vectorFile(result: VectorResult, format: VectorFormat): { text: string; mimeType: string } {
  return format === 'svg'
    ? { text: traceToSvg(result), mimeType: 'image/svg+xml' }
    : { text: traceToDxf(result), mimeType: 'application/dxf' };
}
