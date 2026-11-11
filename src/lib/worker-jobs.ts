import * as Comlink from 'comlink';
import type { ImageProcessorWorker } from '../workers/imageWorker';
import type {
  ProcessDepthPayload,
  ProcessPreviewPayload,
  ProcessVectorPayload,
} from '../types/worker-messages';
import { useRenderStore } from '../store/renderStore';
import type { ToolTab } from '../store/uiStore';
import { renderReliefPreview } from './depth-shader';
import { fitsDimensions } from './crop';

/**
 * Runs the latest of a stream of jobs, one at a time. A job submitted while
 * one is running replaces any job still waiting; when the running one
 * finishes, the waiting one starts on the next frame.
 *
 * A job is run with exactly the payload it was submitted with, buffer
 * included: nothing is read from an older render. `isCurrent` tells the job
 * whether a newer job has been dispatched (or the runner invalidated) since
 * it started, so it can drop its result.
 *
 * Stopgap until the schedulers of #19 replace it.
 */
export class LatestJobRunner<P> {
  private waiting: P | null = null;
  private busy = false;
  private dispatched = 0;

  constructor(
    private readonly run: (payload: P, isCurrent: () => boolean) => Promise<void>,
    private readonly schedule: (next: () => void) => void = (next) => requestAnimationFrame(() => next())
  ) {}

  /** Queues `payload`, replacing any job not yet started, and starts it if idle. */
  submit(payload: P): void {
    this.waiting = payload;
    this.pump();
  }

  /** Drops any waiting job, and makes the running job's result no longer current. */
  invalidate(): void {
    this.waiting = null;
    this.dispatched++;
  }

  private pump(): void {
    if (this.busy || this.waiting === null) return;
    const payload = this.waiting;
    this.waiting = null;
    this.busy = true;
    const id = ++this.dispatched;
    this.run(payload, () => id === this.dispatched).finally(() => {
      this.busy = false;
      if (this.waiting !== null) this.schedule(() => this.pump());
    });
  }
}

/** The worker methods the preview, trace and relief jobs call. */
export type PipelineWorker = Pick<ImageProcessorWorker, 'processImage' | 'processVector' | 'processDepth'>;

/**
 * True when a result of `width` x `height` still matches the preview as it is
 * now, read from the store (a crop or an undo can change it during a job).
 */
function matchesCurrentPreview(width: number, height: number): boolean {
  const source = useRenderStore.getState().source;
  return source !== null && source.width === width && source.height === height;
}

/** Logs a failed worker request and shows it to the user in the error banner. */
function reportWorkerError(context: string, err: unknown): void {
  console.error(`${context}:`, err);
  const detail = err instanceof Error ? err.message : String(err);
  useRenderStore.getState().setErrorMessage(`${context}. ${detail}`);
}

/** The three coordinators of the old worker path, each sending only what its payload holds. */
export interface WorkerJobs {
  preview: LatestJobRunner<ProcessPreviewPayload>;
  vector: LatestJobRunner<ProcessVectorPayload>;
  depth: LatestJobRunner<ProcessDepthPayload>;
}

/** Creates the preview, trace and relief coordinators for the worker `getWorker` returns. */
export function createWorkerJobs(
  getWorker: () => PipelineWorker,
  schedule?: (next: () => void) => void
): WorkerJobs {
  const render = () => useRenderStore.getState();

  const preview = new LatestJobRunner<ProcessPreviewPayload>(async (job, isCurrent) => {
    // Only show the processing indicator for jobs longer than 100 ms, so drags do not flicker.
    let running = true;
    const spinner = setTimeout(() => {
      if (running) render().setIsProcessing(true);
    }, 100);
    try {
      const buffer = job.buffer.slice(0);
      const result = await getWorker().processImage(Comlink.transfer({ ...job, buffer }, [buffer]));
      if (
        isCurrent() &&
        matchesCurrentPreview(result.width, result.height) &&
        fitsDimensions(result.buffer, result.width, result.height)
      ) {
        render().setProcessedPreview(result.buffer, result.durationMs);
      }
    } catch (err) {
      reportWorkerError('Image processing failed', err);
    } finally {
      running = false;
      clearTimeout(spinner);
      render().setIsProcessing(false);
    }
  }, schedule);

  const vector = new LatestJobRunner<ProcessVectorPayload>(async (job, isCurrent) => {
    try {
      const buffer = job.buffer.slice(0);
      const result = await getWorker().processVector(Comlink.transfer({ ...job, buffer }, [buffer]));
      if (isCurrent() && matchesCurrentPreview(job.width, job.height)) render().setVectorResult(result);
    } catch (err) {
      reportWorkerError('Tracing failed', err);
    }
  }, schedule);

  const depth = new LatestJobRunner<ProcessDepthPayload>(async (job, isCurrent) => {
    render().setIsProcessing(true);
    const start = performance.now();
    try {
      const result = await getWorker().processDepth({ ...job, buffer: job.buffer.slice(0) });
      if (isCurrent() && matchesCurrentPreview(job.width, job.height)) {
        render().setDepthHeightMap(result.heightMapBuffer);
        const rgba = renderReliefPreview(new Uint16Array(result.heightMapBuffer), job.width, job.height, job.config);
        render().setProcessedPreview(rgba.buffer as ArrayBuffer, performance.now() - start);
      }
    } catch (err) {
      reportWorkerError('Depth map generation failed', err);
    } finally {
      render().setIsProcessing(false);
    }
  }, schedule);

  return { preview, vector, depth };
}

/**
 * Drops the results of jobs whose output the tab no longer shows. The relief
 * job and the preview job both write the preview, so a relief job that
 * finishes after leaving the 3D tab, or a preview job that finishes after
 * entering it, would otherwise paint over what the new tab shows.
 */
export function dropJobsForTab(jobs: WorkerJobs, activeTab: ToolTab): void {
  if (activeTab === 'depth') jobs.preview.invalidate();
  else jobs.depth.invalidate();
}
