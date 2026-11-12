/**
 * The render scheduler (#19, design section 2): a change while a run is in
 * flight never lets the older result be committed, requests are built from
 * the current document, and a scheduler ignores what it does not read.
 */
import { describe, it, expect } from 'vitest';
import { RenderScheduler } from '../../src/lib/render-scheduler';
import { createDocument, setDither, setTonal, setVector } from '../../src/lib/document';
import type { ImageDocument } from '../../src/types/document';

/** A promise with its resolve and reject functions exposed. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function doc(): ImageDocument {
  return createDocument('d', {
    sourceId: 's',
    name: 'x.png',
    widthPx: 10,
    heightPx: 10,
    format: 'rgba8',
    hasAlpha: false,
    fileDpi: null,
  });
}

/**
 * A scheduler that reads the tonal step, with a fake worker: each run's
 * request is recorded and its reply resolved by the test, in any order.
 */
function harness(options: { enabled?: () => boolean } = {}) {
  const runs: Array<{ req: number; reply: ReturnType<typeof deferred<string>> }> = [];
  const committed: string[] = [];
  const failures: unknown[] = [];
  const scheduler = new RenderScheduler({
    select: (d: ImageDocument) => [d.steps.tonal] as const,
    enabled: options.enabled ?? (() => true),
    buildRequest: (d) => d.steps.tonal.brightness,
    run: (req: number) => {
      const reply = deferred<string>();
      runs.push({ req, reply });
      return reply.promise;
    },
    commit: (res: string) => committed.push(res),
    fail: (err) => failures.push(err),
  });
  return { scheduler, runs, committed, failures };
}

describe('RenderScheduler', () => {
  it('a change during a run: the old result is never committed, the newest is committed last', async () => {
    const h = harness();
    let d = doc();
    h.scheduler.onDocumentChange(d);
    d = setTonal({ brightness: 10 })(d);
    h.scheduler.onDocumentChange(d);
    d = setTonal({ brightness: 20 })(d);
    h.scheduler.onDocumentChange(d);
    // One run in flight; the two changes replaced each other rather than queueing.
    expect(h.runs.map((r) => r.req)).toEqual([0]);

    h.runs[0].reply.resolve('for 0');
    await settle();
    expect(h.committed).toEqual([]);
    // The next run was built from the document as it is now, not from either older state.
    expect(h.runs.map((r) => r.req)).toEqual([0, 20]);

    h.runs[1].reply.resolve('for 20');
    await settle();
    expect(h.committed).toEqual(['for 20']);
  });

  it('a result arriving after an even newer change is dropped too, whatever order replies come in', async () => {
    const h = harness();
    let d = doc();
    h.scheduler.onDocumentChange(d);
    d = setTonal({ brightness: 5 })(d);
    h.scheduler.onDocumentChange(d);
    h.runs[0].reply.resolve('for 0');
    await settle();
    // Run for 5 in flight; change again before it replies.
    d = setTonal({ brightness: 6 })(d);
    h.scheduler.onDocumentChange(d);
    h.runs[1].reply.resolve('for 5');
    await settle();
    h.runs[2].reply.resolve('for 6');
    await settle();
    expect(h.committed).toEqual(['for 6']);
    expect(h.runs.map((r) => r.req)).toEqual([0, 5, 6]);
  });

  it('a change to a part it does not read starts no run and does not discard a run in flight', async () => {
    const h = harness();
    let d = doc();
    h.scheduler.onDocumentChange(d);
    d = setDither({ algorithm: 'atkinson' })(setVector({ threshold: 99 })(d));
    h.scheduler.onDocumentChange(d);
    expect(h.runs.length).toBe(1);
    h.runs[0].reply.resolve('first');
    await settle();
    expect(h.committed).toEqual(['first']);
    expect(h.runs.length).toBe(1);
  });

  it('a rejected run reports once and does not rerun until its inputs change', async () => {
    const h = harness();
    let d = doc();
    h.scheduler.onDocumentChange(d);
    h.runs[0].reply.reject(new Error('boom'));
    await settle();
    expect(h.failures.map((e) => (e as Error).message)).toEqual(['boom']);
    // Unrelated changes and refreshes do not retry it.
    d = setDither({ algorithm: 'bayer-4' })(d);
    h.scheduler.onDocumentChange(d);
    h.scheduler.refresh();
    await settle();
    expect(h.runs.length).toBe(1);
    // A change to what it reads does.
    d = setTonal({ brightness: 1 })(d);
    h.scheduler.onDocumentChange(d);
    expect(h.runs.length).toBe(2);
  });

  it('the error of a stale run is not reported', async () => {
    const h = harness();
    let d = doc();
    h.scheduler.onDocumentChange(d);
    d = setTonal({ brightness: 1 })(d);
    h.scheduler.onDocumentChange(d);
    h.runs[0].reply.reject(new Error('old'));
    await settle();
    expect(h.failures).toEqual([]);
  });

  it('waits while disabled, and runs once on refresh after being enabled', async () => {
    let enabled = false;
    const h = harness({ enabled: () => enabled });
    let d = doc();
    h.scheduler.onDocumentChange(d);
    d = setTonal({ brightness: 3 })(d);
    h.scheduler.onDocumentChange(d);
    expect(h.runs.length).toBe(0);
    enabled = true;
    h.scheduler.refresh();
    expect(h.runs.map((r) => r.req)).toEqual([3]);
  });

  it('closing the document drops the run in flight', async () => {
    const h = harness();
    h.scheduler.onDocumentChange(doc());
    h.scheduler.onDocumentChange(null);
    h.runs[0].reply.resolve('late');
    await settle();
    expect(h.committed).toEqual([]);
    await h.scheduler.whenIdle();
  });

  it('rerun runs again with unchanged inputs and drops the result in flight', async () => {
    const h = harness();
    h.scheduler.onDocumentChange(doc());
    h.scheduler.rerun();
    h.runs[0].reply.resolve('before rerun');
    await settle();
    h.runs[1].reply.resolve('after rerun');
    await settle();
    expect(h.committed).toEqual(['after rerun']);
  });

  it('a request that cannot be built is reported like a failed run', async () => {
    const failures: unknown[] = [];
    const scheduler = new RenderScheduler({
      select: (d: ImageDocument) => [d.steps] as const,
      enabled: () => true,
      buildRequest: () => {
        throw new Error('no source');
      },
      run: async () => 'never',
      commit: () => {},
      fail: (err) => failures.push(err),
    });
    scheduler.onDocumentChange(doc());
    await scheduler.whenIdle();
    expect(failures.map((e) => (e as Error).message)).toEqual(['no source']);
  });

  it('whenIdle resolves once the latest run has been committed', async () => {
    const h = harness();
    h.scheduler.onDocumentChange(doc());
    const idle = h.scheduler.whenIdle();
    let done = false;
    void idle.then(() => (done = true));
    await settle();
    expect(done).toBe(false);
    h.runs[0].reply.resolve('x');
    await idle;
    expect(h.committed).toEqual(['x']);
  });
});
