/**
 * The vector file the app would export, read back: tests call the worker
 * method the Export panel calls (`exportVectorFile`) and check the file (#90).
 */
import type { ImageDocument } from '../../src/types/document';
import type { VectorResult } from '../../src/types/vector';
import { vectorExportRequest, type VectorExportSource } from '../../src/lib/vector-file-export';
import type { PipelineWorkerApi } from '../../src/workers/pipeline-api';

export interface ExportedSvg {
  text: string;
  widthMm: number;
  heightMm: number;
  /** The file's layers in order: id, drawn colour and number of paths. */
  layers: Array<{ id: string; color: string; paths: number }>;
  paths: number;
}

/** The SVG the app exports for `shown`, the trace of `doc` on screen. */
export async function exportedSvg(
  api: PipelineWorkerApi,
  doc: ImageDocument,
  shown: VectorResult,
  source: Exclude<VectorExportSource, 'as-shown'> = 'full-resolution',
  removal: { key: string; pixels: ArrayBuffer } | null = null
): Promise<ExportedSvg> {
  const { text, mimeType } = await api.exportVectorFile(vectorExportRequest(doc, shown, source, removal, 'svg'));
  if (mimeType !== 'image/svg+xml') throw new Error(`Expected an SVG, got ${mimeType}`);
  const size = /<svg[^>]* width="([\d.]+)mm" height="([\d.]+)mm"/.exec(text);
  if (!size) throw new Error('The SVG has no size in millimetres');
  const layers = [...text.matchAll(/<g id="([^"]+)"[^>]* stroke="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g)].map((m) => ({
    id: m[1],
    color: m[2],
    paths: (m[3].match(/<path /g) ?? []).length,
  }));
  return {
    text,
    widthMm: Number(size[1]),
    heightMm: Number(size[2]),
    layers,
    paths: layers.reduce((n, l) => n + l.paths, 0),
  };
}
