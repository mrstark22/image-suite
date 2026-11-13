import * as Comlink from 'comlink';
import type { ImageDocument } from '../types/document';
import type { RasterExport, ReliefProgress } from '../types/worker-messages';
import { useRenderStore } from '../store/renderStore';
import { getPipeline } from './pipeline-client';
import { rasterExportBlocker } from './raster-export';
import { exportPlan } from './render-target';
import { activeCalibration } from '../store/profilesStore';

/**
 * The depth curve of the relief calibration in use (the selected machine and
 * material), or null without one. The export applies its inverse
 * (`depth-curve.ts`); without one it writes grey levels linearly, and the
 * relief panel says so.
 */
export function reliefDepthCurve(): number[] | null {
  const curve = activeCalibration('relief')?.depthCurve ?? null;
  return curve && curve.length >= 2 ? curve : null;
}

/**
 * Exports `doc`'s heightmap as a 16-bit PNG at full resolution with the
 * document's DPI (#46), as written when called. Progress goes to
 * `renderStore.exportProgress`, which pauses the renders until the export
 * ends. Resolves to `null` when cancelled.
 */
export async function exportHeightmap(doc: ImageDocument): Promise<RasterExport | null> {
  const blocker = rasterExportBlocker(doc);
  if (blocker) throw new Error(blocker);
  exportPlan(doc);
  const store = useRenderStore.getState();
  if (store.exportProgress) throw new Error('An export is already running.');
  store.setExportProgress({ stage: 'preparing', fraction: 0 });
  try {
    const onProgress = (p: ReliefProgress) => {
      if (p.export) useRenderStore.getState().setExportProgress(p.export);
      if (p.model) useRenderStore.getState().setRelief({ model: p.model });
    };
    return await getPipeline().exportHeightmap(doc, reliefDepthCurve(), Comlink.proxy(onProgress));
  } catch (err) {
    if (err instanceof Error && err.name === 'ExportCancelledError') return null;
    throw err;
  } finally {
    useRenderStore.getState().setExportProgress(null);
    useRenderStore.getState().setRelief({ model: null });
  }
}
