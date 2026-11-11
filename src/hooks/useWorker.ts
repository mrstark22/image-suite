import { useEffect, useMemo, useRef } from 'react';
import * as Comlink from 'comlink';
import { useDocumentStore } from '../store/documentStore';
import { useRenderStore } from '../store/renderStore';
import { useUIStore } from '../store/uiStore';
import { detailRunParams, pxPerMmAt } from '../lib/document-size';
import { getComlinkWorker } from '../lib/comlink-setup';
import { applyFastTonalLUT } from '../lib/fast-tonal';
import { renderReliefPreview } from '../lib/depth-shader';
import type { ProcessPreviewPayload } from '../types/worker-messages';
import { fitsDimensions } from '../lib/crop';

/**
 * True when a worker result of `width` x `height` still matches the preview
 * as it is now. Reads the store directly, not a render's closure, because the
 * dimensions can change (a crop, an undo) while the job runs. Stopgap until
 * the scheduler in #16 and #19 replaces this hook.
 */
function matchesCurrentPreview(width: number, height: number): boolean {
  const source = useRenderStore.getState().source;
  return source !== null && source.width === width && source.height === height;
}

/**
 * Logs a failed worker request and shows it to the user in the error banner.
 */
function reportWorkerError(context: string, err: unknown): void {
  console.error(`${context}:`, err);
  const detail = err instanceof Error ? err.message : String(err);
  useRenderStore.getState().setErrorMessage(`${context}. ${detail}`);
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
  const previewProcessedBuffer = useRenderStore((s) => s.processed);
  const previewWidth = source?.width ?? 0;
  const previewHeight = source?.height ?? 0;
  const previewDims = source ? { width: previewWidth, height: previewHeight } : null;
  const setProcessedPreview = useRenderStore((s) => s.setProcessedPreview);
  const setDepthHeightMapBuffer = useRenderStore((s) => s.setDepthHeightMap);
  const setIsProcessing = useRenderStore((s) => s.setIsProcessing);
  const setVectorResult = useRenderStore((s) => s.setVectorResult);

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

  // Worker scheduling state
  const isWorkerBusyRef = useRef(false);
  const latestPayloadRef = useRef<ProcessPreviewPayload | null>(null);
  const activeJobIdRef = useRef(0);
  const directDestBufferRef = useRef<ArrayBuffer | null>(null);

  // Worker Dispatch Coordinator
  const triggerWorkerPipeline = () => {
    if (!previewBuffer || !previewDims) return;
    if (isWorkerBusyRef.current) {
      return;
    }

    const currentJob = latestPayloadRef.current;
    if (!currentJob) return;
    latestPayloadRef.current = null;

    const jobId = ++activeJobIdRef.current;
    isWorkerBusyRef.current = true;

    // Only show processing indicator if job takes longer than 100ms to avoid UI flickering during slider drags
    const spinnerTimer = setTimeout(() => {
      if (isWorkerBusyRef.current) {
        setIsProcessing(true);
      }
    }, 100);

    (async () => {
      try {
        const worker = getComlinkWorker();
        const bufferCopy = previewBuffer.slice(0);

        const result = await worker.processImage(
          Comlink.transfer(
            {
              ...currentJob,
              buffer: bufferCopy,
            },
            [bufferCopy]
          )
        );

        // Only commit if this job is still the latest active job
        if (
          jobId === activeJobIdRef.current &&
          matchesCurrentPreview(result.width, result.height) &&
          fitsDimensions(result.buffer, result.width, result.height)
        ) {
          setProcessedPreview(result.buffer, result.durationMs);
        }
      } catch (err) {
        reportWorkerError('Image processing failed', err);
      } finally {
        clearTimeout(spinnerTimer);
        isWorkerBusyRef.current = false;
        setIsProcessing(false);

        // If another adjustment arrived while worker was busy, immediately process the latest frame
        if (latestPayloadRef.current) {
          requestAnimationFrame(triggerWorkerPipeline);
        }
      }
    })();
  };

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
      activeJobIdRef.current++; // Invalidate any pending worker results
      setProcessedPreview(directDestBufferRef.current.slice(0), elapsed);
      return;
    }

    // Heavy worker path (Dither, CLAHE, Adaptive Threshold, Sharpening)
    latestPayloadRef.current = {
      buffer: previewBuffer,
      width: previewDims.width,
      height: previewDims.height,
      tonal,
      color,
      detail,
      dither,
    };

    triggerWorkerPipeline();
  }, [
    previewBuffer,
    previewWidth,
    previewHeight,
    tonal,
    color,
    detail,
    dither,
    activeTab,
    setIsProcessing,
    setProcessedPreview,
  ]);

  // Vector Dispatch Coordinator State
  const isVectorBusyRef = useRef(false);
  const latestVectorPayloadRef = useRef<{ buffer: ArrayBuffer; width: number; height: number; config: any } | null>(null);
  const activeVectorJobIdRef = useRef(0);

  const triggerVectorPipeline = () => {
    if (!previewBuffer || !previewDims || activeTab !== 'vector') return;
    if (isVectorBusyRef.current) {
      return;
    }

    const currentJob = latestVectorPayloadRef.current;
    if (!currentJob) return;
    latestVectorPayloadRef.current = null;

    const jobId = ++activeVectorJobIdRef.current;
    isVectorBusyRef.current = true;

    (async () => {
      try {
        const worker = getComlinkWorker();
        const vectorBuffer = previewBuffer.slice(0);
        const vResult = await worker.processVector(
          Comlink.transfer(
            {
              buffer: vectorBuffer,
              width: currentJob.width,
              height: currentJob.height,
              config: currentJob.config,
            },
            [vectorBuffer]
          )
        );

        if (jobId === activeVectorJobIdRef.current) {
          setVectorResult(vResult);
        }
      } catch (err) {
        reportWorkerError('Tracing failed', err);
      } finally {
        isVectorBusyRef.current = false;
        if (latestVectorPayloadRef.current) {
          requestAnimationFrame(triggerVectorPipeline);
        }
      }
    })();
  };

  // 2. Vector Computation Pipeline (Zero-Latency Async Coordinator, respects autoTrace)
  useEffect(() => {
    const activeBuf = previewProcessedBuffer || previewBuffer;
    if (!activeBuf || !previewDims || !vector || activeTab !== 'vector' || !autoTrace) return;

    latestVectorPayloadRef.current = {
      buffer: activeBuf,
      width: previewDims.width,
      height: previewDims.height,
      config: vector,
    };

    triggerVectorPipeline();
  }, [previewBuffer, previewProcessedBuffer, previewWidth, previewHeight, vector, activeTab, autoTrace, traceRequest, setVectorResult]);

  // 3. Live 3D Depth Map Pipeline (Zero-Latency Async Coordinator)
  const isDepthBusyRef = useRef(false);
  const latestDepthPayloadRef = useRef<{ buffer: ArrayBuffer; width: number; height: number; config: any } | null>(null);
  const activeDepthJobIdRef = useRef(0);

  const triggerDepthPipeline = () => {
    if (!previewBuffer || !previewDims || activeTab !== 'depth') return;
    if (isDepthBusyRef.current) {
      return;
    }

    const currentJob = latestDepthPayloadRef.current;
    if (!currentJob) return;
    latestDepthPayloadRef.current = null;

    const jobId = ++activeDepthJobIdRef.current;
    isDepthBusyRef.current = true;
    setIsProcessing(true);

    (async () => {
      const startTime = performance.now();
      try {
        const worker = getComlinkWorker();
        const bufCopy = previewBuffer.slice(0);
        const result = await worker.processDepth({
          buffer: bufCopy,
          width: currentJob.width,
          height: currentJob.height,
          config: currentJob.config,
        });

        if (
          jobId === activeDepthJobIdRef.current &&
          matchesCurrentPreview(currentJob.width, currentJob.height)
        ) {
          setDepthHeightMapBuffer(result.heightMapBuffer);
          const depth16 = new Uint16Array(result.heightMapBuffer);
          const rgba = renderReliefPreview(
            depth16,
            currentJob.width,
            currentJob.height,
            currentJob.config
          );

          const elapsed = performance.now() - startTime;
          setProcessedPreview(rgba.buffer as ArrayBuffer, elapsed);
        }
      } catch (err) {
        reportWorkerError('Depth map generation failed', err);
      } finally {
        isDepthBusyRef.current = false;
        setIsProcessing(false);
        if (latestDepthPayloadRef.current) {
          requestAnimationFrame(triggerDepthPipeline);
        }
      }
    })();
  };

  useEffect(() => {
    if (!previewBuffer || !previewDims || !depth || activeTab !== 'depth') return;

    latestDepthPayloadRef.current = {
      buffer: previewBuffer,
      width: previewDims.width,
      height: previewDims.height,
      config: depth,
    };

    triggerDepthPipeline();
  }, [previewBuffer, previewWidth, previewHeight, depth, activeTab, setIsProcessing, setProcessedPreview]);
}
