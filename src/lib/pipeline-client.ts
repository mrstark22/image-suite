import * as Comlink from 'comlink';
import type { PipelineWorkerApi } from '../workers/pipeline-api';

/** What the main thread calls in the image worker. Every method is asynchronous. */
export type Pipeline = Pick<
  PipelineWorkerApi,
  | 'decodeFile'
  | 'putSource'
  | 'releaseSource'
  | 'renderPreview'
  | 'renderRelief'
  | 'traceDocument'
  | 'exportVectorFile'
  | 'exportRaster'
  | 'cancelExport'
  | 'processDepth'
  | 'processBgRemoval'
>;

let pipeline: Pipeline | null = null;

/**
 * The image worker. There is one (design section 5): it holds the decoded
 * source, so a second worker would need a second copy of it.
 */
export function getPipeline(): Pipeline {
  if (!pipeline) {
    const worker = new Worker(new URL('../workers/imageWorker.ts', import.meta.url), { type: 'module' });
    pipeline = Comlink.wrap<PipelineWorkerApi>(worker) as unknown as Pipeline;
  }
  return pipeline;
}

/** Replaces the pipeline: tests run `PipelineWorkerApi` in the same thread. */
export function setPipeline(next: Pipeline | null): void {
  pipeline = next;
}
