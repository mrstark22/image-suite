import type { ImageDocument } from '../types/document';
import type { VectorResult } from '../types/vector';
import type { Pipeline } from './pipeline-client';
import { nativeTarget, previewTarget, sourceStageKey } from './render-target';
import { traceToDxf, traceToSvg } from './vector-export';
import { setVector } from './document';
import { paletteFromResult } from './trace-palette';
import { viewOf, withView, type TraceView } from './trace-view';
import type { RenderTarget } from '../types/render';

export type VectorFormat = 'svg' | 'dxf';

/** Where an exported trace comes from. */
export type VectorExportSource =
  /** Traced again at the source's full resolution for the crop (#23). */
  | 'full-resolution'
  /** Background removal is a preview-sized stopgap (phase 5), so its trace stays preview-sized. */
  | 'preview-background-removed'
  /** Not a trace (a test grid's cut paths): exported as shown. */
  | 'as-shown';

/** Which trace an export of the current result writes. */
export function vectorExportSource(shown: VectorResult, tracedWithSettings: boolean, hasRemoval: boolean): VectorExportSource {
  if (!tracedWithSettings || shown.pxPerMm === null) return 'as-shown';
  return hasRemoval ? 'preview-background-removed' : 'full-resolution';
}

/** What the worker needs to trace and write a vector file (see `PipelineWorkerApi.exportVectorFile`). */
export interface VectorExportRequest {
  doc: ImageDocument;
  target: RenderTarget;
  sourceStagePixels?: ArrayBuffer;
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
  source: Exclude<VectorExportSource, 'as-shown'>,
  removal: { key: string; pixels: ArrayBuffer } | null,
  format: VectorFormat
): VectorExportRequest {
  const view = viewOf(shown);
  if (source === 'preview-background-removed') {
    const target = previewTarget(doc);
    if (!removal || removal.key !== sourceStageKey(doc, target)) {
      throw new Error('The background removal no longer matches the image. Apply it again.');
    }
    return { doc, target, sourceStagePixels: removal.pixels.slice(0), view, format };
  }
  const palette = doc.vector.colorMode === 'color' && doc.vector.palette === null ? paletteFromResult(shown) : null;
  return { doc: palette ? setVector({ palette })(doc) : doc, target: nativeTarget(doc), view, format };
}

/** The trace an export of `shown` writes (`vectorExportRequest`, traced), as a result rather than a file. */
export async function traceForExport(
  pipeline: Pick<Pipeline, 'traceDocument'>,
  doc: ImageDocument,
  shown: VectorResult,
  source: VectorExportSource,
  removal: { key: string; pixels: ArrayBuffer } | null
): Promise<VectorResult> {
  if (source === 'as-shown') return shown;
  const req = vectorExportRequest(doc, shown, source, removal, 'svg');
  const result = await pipeline.traceDocument({ doc: req.doc, target: req.target, sourceStagePixels: req.sourceStagePixels });
  return withView(result, req.view);
}

/** The file contents and type for `result` in `format`. */
export function vectorFile(result: VectorResult, format: VectorFormat): { text: string; mimeType: string } {
  return format === 'svg'
    ? { text: traceToSvg(result), mimeType: 'image/svg+xml' }
    : { text: traceToDxf(result), mimeType: 'application/dxf' };
}
