import type { ImageDocument } from '../types/document';
import type { VectorResult } from '../types/vector';
import type { Pipeline } from './pipeline-client';
import { nativeTarget, previewTarget, sourceStageKey } from './render-target';
import { traceToDxf, traceToSvg } from './vector-export';
import { setVector } from './document';
import { paletteFromResult } from './trace-palette';

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

/**
 * The trace to write for `doc`: traced again in the worker at the source's
 * full resolution, so detail the preview cannot hold is in the file, with
 * the layers hidden in `shown` hidden here too.
 *
 * `shown` must be the trace of `doc` as it is (see `traceIsCurrent`). With an
 * automatic palette the export uses the colours `shown` found, so its layers
 * are the colours on screen: clustering the full-resolution image again can
 * split the colours differently (review of #84). Layers come out in the
 * order shown.
 */
export async function traceForExport(
  pipeline: Pipeline,
  doc: ImageDocument,
  shown: VectorResult,
  source: VectorExportSource,
  removal: { key: string; pixels: ArrayBuffer } | null
): Promise<VectorResult> {
  if (source === 'as-shown') return shown;
  let result: VectorResult;
  if (source === 'preview-background-removed') {
    const target = previewTarget(doc);
    if (!removal || removal.key !== sourceStageKey(doc, target)) {
      throw new Error('The background removal no longer matches the image. Apply it again.');
    }
    result = await pipeline.traceDocument({ doc, target, sourceStagePixels: removal.pixels.slice(0) });
  } else {
    const palette = doc.vector.colorMode === 'color' && doc.vector.palette === null ? paletteFromResult(shown) : null;
    const traced = palette ? setVector({ palette })(doc) : doc;
    result = await pipeline.traceDocument({ doc: traced, target: nativeTarget(doc) });
  }
  const hidden = new Set(shown.layers.filter((l) => !l.visible).map((l) => l.id));
  const order = new Map(shown.layers.map((l, i) => [l.id, i]));
  const layers = result.layers
    .map((l) => ({ ...l, visible: !hidden.has(l.id) }))
    .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  return { ...result, layers };
}

/** The file contents and type for `result` in `format`. */
export function vectorFile(result: VectorResult, format: VectorFormat): { text: string; mimeType: string } {
  return format === 'svg'
    ? { text: traceToSvg(result), mimeType: 'image/svg+xml' }
    : { text: traceToDxf(result), mimeType: 'application/dxf' };
}
