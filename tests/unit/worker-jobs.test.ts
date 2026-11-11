/**
 * The old worker path's coordinators (review finding 2 on #68): a job queued
 * while another runs must be sent with its own buffer and dimensions, never
 * with a buffer from the render that started the earlier job.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LatestJobRunner, createWorkerJobs, dropJobsForTab, type PipelineWorker } from '../../src/lib/worker-jobs';
import { useRenderStore } from '../../src/store/renderStore';
import { useDocumentStore } from '../../src/store/documentStore';
import { DEFAULT_COLOR, DEFAULT_DEPTH, DEFAULT_DETAIL, DEFAULT_DITHER, DEFAULT_TONAL, setCrop } from '../../src/lib/document';
import { detailRunParams } from '../../src/lib/document-size';
import type { ProcessPreviewPayload, ProcessPreviewResult } from '../../src/types/worker-messages';
import { decodedImage, resetStores } from '../helpers/documents';

/** A promise with its resolve function exposed. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Lets pending promise callbacks run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('LatestJobRunner', () => {
  it('runs a job queued during another with its own payload, and only the latest one', async () => {
    const runs: Array<{ payload: string; done: ReturnType<typeof deferred<void>> }> = [];
    const runner = new LatestJobRunner<string>(
      (payload) => {
        const done = deferred<void>();
        runs.push({ payload, done });
        return done.promise;
      },
      (next) => next()
    );

    runner.submit('a');
    runner.submit('b');
    runner.submit('c');
    expect(runs.map((r) => r.payload)).toEqual(['a']);

    runs[0].done.resolve();
    await settle();
    expect(runs.map((r) => r.payload)).toEqual(['a', 'c']);
  });

  it('tells a job its result is stale once a newer job has started or the runner is invalidated', async () => {
    const checks: Array<() => boolean> = [];
    const gates: Array<ReturnType<typeof deferred<void>>> = [];
    const runner = new LatestJobRunner<number>(
      (_, isCurrent) => {
        checks.push(isCurrent);
        const gate = deferred<void>();
        gates.push(gate);
        return gate.promise;
      },
      (next) => next()
    );
    runner.submit(1);
    expect(checks[0]()).toBe(true);
    runner.submit(2); // waiting, not yet dispatched: the running job is still current
    expect(checks[0]()).toBe(true);
    gates[0].resolve();
    await settle();
    expect(checks[0]()).toBe(false);
    expect(checks[1]()).toBe(true);
    runner.invalidate();
    expect(checks[1]()).toBe(false);
  });
});

describe('preview jobs', () => {
  beforeEach(() => {
    resetStores();
  });

  it('a crop during a running job sends the cropped pixels with the cropped size', async () => {
    useDocumentStore.getState().open(decodedImage(40, 30));
    const sent: ProcessPreviewPayload[] = [];
    const replies: Array<ReturnType<typeof deferred<ProcessPreviewResult>>> = [];
    const worker = {
      processImage: (payload: ProcessPreviewPayload) => {
        sent.push(payload);
        const reply = deferred<ProcessPreviewResult>();
        replies.push(reply);
        return reply.promise;
      },
    } as unknown as PipelineWorker;
    const jobs = createWorkerJobs(() => worker, (next) => next());

    const payloadFor = (): ProcessPreviewPayload => {
      const source = useRenderStore.getState().source!;
      return {
        buffer: source.buffer,
        width: source.width,
        height: source.height,
        tonal: DEFAULT_TONAL,
        color: DEFAULT_COLOR,
        detail: detailRunParams(DEFAULT_DETAIL, null),
        dither: DEFAULT_DITHER,
      };
    };

    jobs.preview.submit(payloadFor());
    useDocumentStore.getState().edit(setCrop({ x: 5, y: 5, width: 10, height: 8 }));
    const cropped = payloadFor();
    jobs.preview.submit(cropped);

    // The first job's result arrives for the old size and is dropped.
    replies[0].resolve({ buffer: new ArrayBuffer(40 * 30 * 4), width: 40, height: 30, durationMs: 1 });
    await settle();

    expect(sent.length).toBe(2);
    const second = sent[1];
    expect([second.width, second.height]).toEqual([10, 8]);
    expect(second.buffer.byteLength).toBe(10 * 8 * 4);
    expect(new Uint8Array(second.buffer)).toEqual(new Uint8Array(cropped.buffer));
    // Nothing for the old size was committed.
    expect(useRenderStore.getState().processed?.byteLength).toBe(10 * 8 * 4);
  });
});

describe('changing tab (re-review finding D)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('a relief job that finishes after leaving the 3D tab does not write the preview', async () => {
    useDocumentStore.getState().open(decodedImage(12, 10));
    const reply = deferred<{ heightMapBuffer: ArrayBuffer }>();
    const worker = { processDepth: () => reply.promise } as unknown as PipelineWorker;
    const jobs = createWorkerJobs(() => worker, (next) => next());
    const source = useRenderStore.getState().source!;
    const before = useRenderStore.getState().processed;

    jobs.depth.submit({ buffer: source.buffer, width: source.width, height: source.height, config: DEFAULT_DEPTH });
    dropJobsForTab(jobs, 'adjustments');
    reply.resolve({ heightMapBuffer: new Uint16Array(12 * 10).fill(30000).buffer });
    await settle();

    expect(useRenderStore.getState().processed).toBe(before);
    expect(useRenderStore.getState().depthHeightMap ?? null).toBeNull();
  });

  it('a preview job that finishes after entering the 3D tab does not write the preview', async () => {
    useDocumentStore.getState().open(decodedImage(12, 10));
    const reply = deferred<ProcessPreviewResult>();
    const worker = { processImage: () => reply.promise } as unknown as PipelineWorker;
    const jobs = createWorkerJobs(() => worker, (next) => next());
    const source = useRenderStore.getState().source!;
    const before = useRenderStore.getState().processed;

    jobs.preview.submit({
      buffer: source.buffer,
      width: source.width,
      height: source.height,
      tonal: DEFAULT_TONAL,
      color: DEFAULT_COLOR,
      detail: detailRunParams(DEFAULT_DETAIL, null),
      dither: DEFAULT_DITHER,
    });
    dropJobsForTab(jobs, 'depth');
    reply.resolve({ buffer: new ArrayBuffer(12 * 10 * 4), width: 12, height: 10, durationMs: 1 });
    await settle();

    expect(useRenderStore.getState().processed).toBe(before);
  });
});
