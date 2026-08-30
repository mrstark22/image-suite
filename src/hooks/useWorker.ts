import { useEffect, useRef } from 'react';
import * as Comlink from 'comlink';
import { useImageStore } from '../store/imageStore';
import { useEditStore } from '../store/editStore';
import { useUIStore } from '../store/uiStore';
import { getComlinkWorker } from '../lib/comlink-setup';
import { applyFastTonalLUT } from '../lib/fast-tonal';
import { renderReliefPreview } from '../lib/depth-shader';
import type { ProcessPreviewPayload } from '../types/worker-messages';

/**
 * Production-grade asynchronous worker coordinator.
 * Implements:
 * 1. Immediate 0ms dispatch when worker is idle.
 * 2. Lossless latest-state collapsing while worker is busy.
 * 3. Immediate frame-chained execution upon completion without arbitrary timer lags.
 * 4. Job ID sequencing to prevent race conditions and stale buffer overwrites.
 */
export function useWorkerPipeline() {
  const previewBuffer = useImageStore((s) => s.previewBuffer);
  const previewDims = useImageStore((s) => s.previewDimensions);
  const setProcessedPreview = useImageStore((s) => s.setProcessedPreview);
  const setDepthHeightMapBuffer = useImageStore((s) => s.setDepthHeightMapBuffer);
  const setIsProcessing = useImageStore((s) => s.setIsProcessing);
  const setVectorResult = useEditStore((s) => s.setVectorResult);

  const tonal = useEditStore((s) => s.tonal);
  const color = useEditStore((s) => s.color);
  const detail = useEditStore((s) => s.detail);
  const dither = useEditStore((s) => s.dither);
  const geometry = useEditStore((s) => s.geometry);
  const vector = useEditStore((s) => s.vector);
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
      // Worker is currently executing: payload is saved in latestPayloadRef and will execute immediately when current job finishes
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
        if (jobId === activeJobIdRef.current) {
          setProcessedPreview(result.buffer, result.durationMs);
        }
      } catch (err) {
        console.error('Worker processing error:', err);
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
    if (!previewBuffer || !previewDims) return;
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
      setProcessedPreview(directDestBufferRef.current, elapsed);
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
      geometry,
      dither,
    };

    triggerWorkerPipeline();
  }, [
    previewBuffer,
    previewDims,
    tonal,
    color,
    detail,
    dither,
    geometry,
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
      return; // Picked up immediately when active job finishes
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
        console.error('Vector computation error:', err);
      } finally {
        isVectorBusyRef.current = false;
        if (latestVectorPayloadRef.current) {
          requestAnimationFrame(triggerVectorPipeline);
        }
      }
    })();
  };

  // 2. Vector Computation Pipeline (Zero-Latency Async Coordinator)
  useEffect(() => {
    if (!previewBuffer || !previewDims || activeTab !== 'vector') return;

    latestVectorPayloadRef.current = {
      buffer: previewBuffer,
      width: previewDims.width,
      height: previewDims.height,
      config: vector,
    };

    triggerVectorPipeline();
  }, [previewBuffer, previewDims, vector, activeTab, setVectorResult]);

  // 3. Live 3D Depth Map Pipeline (Zero-Latency Async Coordinator)
  const depth = useEditStore((s) => s.depth);
  const isDepthBusyRef = useRef(false);
  const latestDepthPayloadRef = useRef<{ buffer: ArrayBuffer; width: number; height: number; config: any } | null>(null);
  const activeDepthJobIdRef = useRef(0);

  const triggerDepthPipeline = () => {
    if (!previewBuffer || !previewDims || activeTab !== 'depth') return;
    if (isDepthBusyRef.current) {
      return; // Picked up immediately when active job finishes
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

        if (jobId === activeDepthJobIdRef.current) {
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
        console.error('Depth preview error:', err);
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
    if (!previewBuffer || !previewDims || activeTab !== 'depth') return;

    latestDepthPayloadRef.current = {
      buffer: previewBuffer,
      width: previewDims.width,
      height: previewDims.height,
      config: depth,
    };

    triggerDepthPipeline();
  }, [previewBuffer, previewDims, depth, activeTab, setIsProcessing, setProcessedPreview]);
}
