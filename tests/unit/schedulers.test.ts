/**
 * The app's schedulers on the real stores and the real pipeline, with every
 * worker call held until the test releases it (#19). Whatever changes while
 * a render is in flight, the older result is never committed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { useUIStore } from '../../src/store/uiStore';
import { setCrop, setDither, setTonal, setVector } from '../../src/lib/document';
import type { Pipeline } from '../../src/lib/pipeline-client';
import { previewTarget } from '../../src/lib/render-target';
import { currentDoc, labelledImage, previewMismatches, resetStores } from '../helpers/documents';
import { loadPixels, startTestPipeline, type TestPipeline } from '../helpers/pipeline';

const store = () => useDocumentStore.getState();
const render = () => useRenderStore.getState();

type Kind = 'preview' | 'relief' | 'trace';
interface HeldCall {
  kind: Kind;
  /** The document the request was built from. */
  docVersion: number;
  release(): Promise<void>;
  fail(err: Error): void;
}

/** Holds every render, relief and trace call until released. */
let held: HeldCall[] = [];
/** When false, calls go straight through (for setting up). */
let holding = false;

function gated(inner: Pipeline): Pipeline {
  const hold =
    <Req, Res>(kind: Kind, run: (req: Req) => Promise<Res>) =>
    (req: Req): Promise<Res> => {
      if (!holding) return run(req);
      return new Promise<Res>((resolve, reject) => {
        held.push({
          kind,
          docVersion: useDocumentStore.getState().version,
          release: async () => {
            try {
              resolve(await run(req));
            } catch (err) {
              reject(err);
            }
            await settleMicrotasks();
          },
          fail: (err) => reject(err),
        });
      });
    };
  return {
    ...inner,
    decodeFile: inner.decodeFile.bind(inner),
    putSource: inner.putSource.bind(inner),
    releaseSource: inner.releaseSource.bind(inner),
    processDepth: inner.processDepth.bind(inner),
    processBgRemoval: inner.processBgRemoval.bind(inner),
    renderPreview: hold('preview', inner.renderPreview.bind(inner)),
    renderRelief: hold('relief', inner.renderRelief.bind(inner)),
    traceDocument: hold('trace', inner.traceDocument.bind(inner)),
  };
}

const settleMicrotasks = () => new Promise((r) => setTimeout(r, 0));

/** Every preview commit: its size and source key, in order. */
let commits: Array<{ width: number; height: number; key: string; bytes: number }> = [];

let pipeline: TestPipeline;
let unsubscribe: () => void;
beforeAll(async () => {
  pipeline = await startTestPipeline(gated);
  unsubscribe = useRenderStore.subscribe((s, prev) => {
    if (s.previewVersion !== prev.previewVersion && s.processed && s.source) {
      commits.push({ width: s.source.width, height: s.source.height, key: s.source.key, bytes: s.processed.byteLength });
    }
  });
});
afterAll(() => {
  unsubscribe();
  pipeline.stop();
});

beforeEach(async () => {
  holding = false;
  resetStores();
  // Calls a test left held: let them finish, so no scheduler stays busy. Their
  // documents are gone, so their results are dropped.
  const leftover = held;
  held = [];
  for (const call of leftover) await call.release();
  useUIStore.setState({ activeTab: 'adjustments' });
  render().setAutoTrace(true);
  store().open(await loadPixels(pipeline.api, labelledImage(40, 30), 40, 30));
  await pipeline.settled();
  commits = [];
  holding = true;
});

const pending = (kind: Kind) => held.filter((c) => c.kind === kind);

describe('preview', () => {
  it('a crop during a running render: the old result is never committed, the cropped one is (finding 2 on #68)', async () => {
    store().edit(setTonal({ contrast: 10 }));
    expect(pending('preview').length).toBe(1);
    store().edit(setCrop({ x: 5, y: 5, width: 10, height: 8 }));
    // One render in flight; the crop waits, it does not queue a second call yet.
    expect(pending('preview').length).toBe(1);

    await pending('preview')[0].release();
    expect(commits).toEqual([]);
    // The next render was built from the cropped document.
    expect(pending('preview').length).toBe(2);
    await pending('preview')[1].release();
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ width: 10, height: 8, bytes: 10 * 8 * 4 });
    expect(previewMismatches(5, 5, 10, 8)).toBe(0);
  });

  it('many changes during a run make one more run, from the latest document', async () => {
    for (let b = 1; b <= 20; b++) store().edit(setTonal({ brightness: b }));
    expect(pending('preview').length).toBe(1);
    await pending('preview')[0].release();
    expect(pending('preview').length).toBe(2);
    expect(pending('preview')[1].docVersion).toBe(store().version);
    await pending('preview')[1].release();
    expect(commits).toHaveLength(1);
  });

  it('opening another image during a render: the old image never reaches the preview', async () => {
    store().edit(setTonal({ brightness: 5 }));
    holding = false;
    const next = await loadPixels(pipeline.api, labelledImage(12, 9), 12, 9);
    holding = true;
    store().open(next);
    await pending('preview')[0].release();
    expect(commits).toEqual([]);
    await pending('preview')[1].release();
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ width: 12, height: 9 });
  });

  it('a change the preview does not read starts no render and keeps the one in flight', async () => {
    store().edit(setVector({ threshold: 77 }));
    expect(pending('preview')).toEqual([]);
    store().edit(setTonal({ brightness: 3 }));
    store().edit(setVector({ threshold: 78 }));
    await pending('preview')[0].release();
    expect(commits).toHaveLength(1);
    expect(pending('preview')).toHaveLength(1);
  });

  it('a worker error is shown once, and not retried until something it reads changes', async () => {
    store().edit(setTonal({ brightness: 3 }));
    pending('preview')[0].fail(new Error('out of memory'));
    await settleMicrotasks();
    expect(render().errorMessage).toBe('Image processing failed: out of memory');
    store().edit(setVector({ threshold: 70 }));
    expect(pending('preview')).toHaveLength(1);
    store().edit(setTonal({ brightness: 4 }));
    expect(pending('preview')).toHaveLength(2);
  });
});

describe('preview and relief share the canvas (finding D on #68)', () => {
  it('a relief that finishes after leaving the 3D tab is not shown', async () => {
    useUIStore.getState().setActiveTab('depth');
    expect(pending('relief')).toHaveLength(1);
    useUIStore.getState().setActiveTab('adjustments');
    await pending('relief')[0].release();
    expect(commits).toEqual([]);
    // The preview renders again for the tab now shown.
    expect(pending('preview')).toHaveLength(1);
    await pending('preview')[0].release();
    expect(commits).toHaveLength(1);
    expect(render().depthHeightMap).toBeNull();
  });

  it('a preview that finishes after entering the 3D tab is not shown; the relief is', async () => {
    store().edit(setTonal({ brightness: 9 }));
    useUIStore.getState().setActiveTab('depth');
    await pending('preview')[0].release();
    expect(commits).toEqual([]);
    await pending('relief')[0].release();
    expect(commits).toHaveLength(1);
    expect(render().depthHeightMap?.byteLength).toBe(40 * 30 * 2);
  });
});

describe('trace', () => {
  beforeEach(() => {
    useUIStore.getState().setActiveTab('vector');
  });

  it('runs on the vector tab; a dither change does not trace again, a tracing change does', async () => {
    expect(pending('trace')).toHaveLength(1);
    await pending('trace')[0].release();
    expect(render().vectorResult).not.toBeNull();
    store().edit(setDither({ algorithm: 'atkinson' }));
    expect(pending('trace')).toHaveLength(1);
    store().edit(setVector({ threshold: 90 }));
    expect(pending('trace')).toHaveLength(2);
  });

  it('waits for a gesture to end', async () => {
    await pending('trace')[0].release();
    const token = store().beginGesture();
    store().updateGesture(token, setVector({ threshold: 40 }));
    store().updateGesture(token, setVector({ threshold: 41 }));
    expect(pending('trace')).toHaveLength(1);
    store().endGesture(token);
    expect(pending('trace')).toHaveLength(2);
  });

  it('a trace for an older crop is not committed', async () => {
    const before = render().vectorResult;
    store().edit(setCrop({ x: 0, y: 0, width: 20, height: 20 }));
    await pending('trace')[0].release();
    expect(render().vectorResult).toBe(before);
    await pending('trace')[1].release();
    expect(render().vectorResult?.dimensions).toEqual({ width: 20, height: 20 });
    expect(previewTarget(currentDoc())).toEqual({ widthPx: 20, heightPx: 20 });
  });
});
