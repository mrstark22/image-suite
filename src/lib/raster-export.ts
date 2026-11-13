import * as Comlink from 'comlink';
import type { ImageDocument } from '../types/document';
import type { ExportProgress, RasterExport, RasterFormat } from '../types/worker-messages';
import { useRenderStore } from '../store/renderStore';
import { getPipeline } from './pipeline-client';
import { exportPlan } from './render-target';

/**
 * Why `doc` cannot be exported as a raster file now, or `null` when it can.

 */
export function rasterExportBlocker(doc: ImageDocument): string | null {
  if (doc.mmPerPx === null) return 'Set the size to export.';
  return null;
}

/**
 * Exports `doc` as written when called (design section 2: export does not use
 * a scheduler). Progress goes to `renderStore.exportProgress`, which pauses
 * the preview until the export ends. Resolves to `null` when cancelled.
 */
export async function exportRaster(doc: ImageDocument, format: RasterFormat): Promise<RasterExport | null> {
  const blocker = rasterExportBlocker(doc);
  if (blocker) throw new Error(blocker);
  // Checked here too, so a document without a size never reaches the worker.
  exportPlan(doc);
  const store = useRenderStore.getState();
  if (store.exportProgress) throw new Error('An export is already running.');
  store.setExportProgress({ stage: 'preparing', fraction: 0 });
  try {
    const onProgress = (progress: ExportProgress) => useRenderStore.getState().setExportProgress(progress);
    return await getPipeline().exportRaster(doc, format, Comlink.proxy(onProgress));
  } catch (err) {
    if (err instanceof Error && err.name === 'ExportCancelledError') return null;
    throw err;
  } finally {
    useRenderStore.getState().setExportProgress(null);
  }
}

/** Stops the running export at its next boundary. */
export function cancelRasterExport(): void {
  // A promise through Comlink; a plain call in tests.
  void Promise.resolve(getPipeline().cancelExport()).catch(() => undefined);
}
