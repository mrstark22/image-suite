import { useEffect, useMemo, useRef } from 'react';
import { useDocumentStore } from '../store/documentStore';
import { useRenderStore } from '../store/renderStore';
import { useUIStore } from '../store/uiStore';
import { detailRunParams, pxPerMmAt } from '../lib/document-size';
import { getComlinkWorker } from '../lib/comlink-setup';
import { applyFastTonalLUT } from '../lib/fast-tonal';
import { createWorkerJobs, type WorkerJobs } from '../lib/worker-jobs';

/** Created once, outside React, so a job never runs with a render's stale closure. */
let jobs: WorkerJobs | null = null;
function workerJobs(): WorkerJobs {
  jobs ??= createWorkerJobs(getComlinkWorker);
  return jobs;
}

/**
 * Runs the preview, trace and relief jobs on the worker, fed from the
 * document. Each coordinator sends the latest request when the worker is free
 * and drops results that no longer match the preview.
 *
 * Stopgap until #16 and #19 replace it with the pipeline and the schedulers.
 */
export function useWorkerPipeline() {
  const source = useRenderStore((s) => s.source);
  const previewBuffer = source?.buffer ?? null;
  const previewWidth = source?.width ?? 0;
  const previewHeight = source?.height ?? 0;
  const previewDims = source ? { width: previewWidth, height: previewHeight } : null;
  const setProcessedPreview = useRenderStore((s) => s.setProcessedPreview);

  const doc = useDocumentStore((s) => s.doc);
  const tonal = doc?.steps.tonal;
  const color = doc?.steps.color;
  const dither = doc?.steps.dither;
  const vector = doc?.vector;
  const depth = doc?.depth;
  // Lengths in the document are in mm; the worker takes pixels of the preview.
  const pxPerMm = doc && source ? pxPerMmAt(doc, source.width) : null;
  const detailSettings = doc?.steps.detail;
  const detail = useMemo(
    () => (detailSettings ? detailRunParams(detailSettings, pxPerMm) : null),
    [detailSettings, pxPerMm]
  );
  const autoTrace = useRenderStore((s) => s.autoTrace);
  const traceRequest = useRenderStore((s) => s.traceRequest);
  const activeTab = useUIStore((s) => s.activeTab);

  const directDestBufferRef = useRef<ArrayBuffer | null>(null);

  // 1. Tonal & Dithering Pipeline
  useEffect(() => {
    if (!previewBuffer || !previewDims || !tonal || !color || !detail || !dither) return;
    if (activeTab === 'depth') return;

    const isSimpleTonal =
      dither.algorithm === 'none' &&
      !detail.clahe &&
      !detail.adaptiveThreshold &&
      (detail.unsharpStrength ?? 0) <= 0;

    if (isSimpleTonal) {
      // Fast path: synchronous direct LUT processing in ~1ms
      const startTime = performance.now();
      const byteLength = previewDims.width * previewDims.height * 4;

      if (!directDestBufferRef.current || directDestBufferRef.current.byteLength !== byteLength) {
        directDestBufferRef.current = new ArrayBuffer(byteLength);
      }

      applyFastTonalLUT(
        previewBuffer,
        directDestBufferRef.current,
        previewDims.width,
        previewDims.height,
        tonal,
        color
      );

      const elapsed = performance.now() - startTime;
      workerJobs().preview.invalidate(); // a worker result now would be older than this
      setProcessedPreview(directDestBufferRef.current.slice(0), elapsed);
      return;
    }

    // Heavy worker path (Dither, CLAHE, Adaptive Threshold, Sharpening)
    workerJobs().preview.submit({
      buffer: previewBuffer,
      width: previewDims.width,
      height: previewDims.height,
      tonal,
      color,
      detail,
      dither,
    });
  }, [
    previewBuffer,
    previewWidth,
    previewHeight,
    tonal,
    color,
    detail,
    dither,
    activeTab,
    setProcessedPreview,
  ]);

  // 2. Vector Computation Pipeline (Zero-Latency Async Coordinator, respects autoTrace)
  useEffect(() => {
    if (!previewBuffer || !previewDims || !vector || activeTab !== 'vector' || !autoTrace) return;
    // Traces the unadjusted preview, as before (tracing the pipeline's output is #23).
    workerJobs().vector.submit({
      buffer: previewBuffer,
      width: previewDims.width,
      height: previewDims.height,
      config: vector,
    });
  }, [previewBuffer, previewWidth, previewHeight, vector, activeTab, autoTrace, traceRequest]);

  // 3. Relief
  useEffect(() => {
    if (!previewBuffer || !previewDims || !depth || activeTab !== 'depth') return;

    workerJobs().depth.submit({
      buffer: previewBuffer,
      width: previewDims.width,
      height: previewDims.height,
      config: depth,
    });
  }, [previewBuffer, previewWidth, previewHeight, depth, activeTab]);
}
