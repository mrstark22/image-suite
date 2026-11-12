import type { ImageDocument } from '../types/document';
import type { DocumentRenderRequest, PreviewRenderResult, ReliefRenderResult, TraceRequest } from '../types/worker-messages';
import type { VectorResult } from '../types/vector';
import { useDocumentStore } from '../store/documentStore';
import { useRenderStore } from '../store/renderStore';
import { useUIStore } from '../store/uiStore';
import { showsRelief, traces } from './workflows';
import { RenderScheduler } from './render-scheduler';
import { previewTarget, sourceStageKey } from './render-target';
import { renderReliefPreview } from './depth-shader';
import { getPipeline, type Pipeline } from './pipeline-client';

/** The preview, trace and relief schedulers (design section 2). */
export interface Schedulers {
  preview: RenderScheduler<readonly unknown[], DocumentRenderRequest, PreviewRenderResult>;
  trace: RenderScheduler<readonly unknown[], TraceRequest, VectorResult>;
  relief: RenderScheduler<readonly unknown[], DocumentRenderRequest, ReliefRenderResult>;
}

/** Show the processing indicator only for runs longer than this, so drags do not flicker. */
const SPINNER_DELAY_MS = 100;

const render = () => useRenderStore.getState();

/** False while a raster export runs: renders wait for it (design section 5), and run when it ends. */
const notExporting = () => render().exportProgress === null;

/** Background removal's pixels, when they belong to the render `doc` would use now. */
function removalFor(doc: ImageDocument): ArrayBuffer | undefined {
  const removal = render().backgroundRemoval;
  return removal && removal.key === sourceStageKey(doc, previewTarget(doc)) ? removal.pixels.slice(0) : undefined;
}

function renderRequest(doc: ImageDocument): DocumentRenderRequest {
  return {
    doc,
    target: previewTarget(doc),
    haveSourceKey: render().source?.key ?? null,
    sourceStagePixels: removalFor(doc),
  };
}

function report(prefix: string) {
  return (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    render().setErrorMessage(`${prefix}: ${message}`);
  };
}

/** Wraps a run so the processing indicator shows while it takes longer than 100 ms. */
function withSpinner<Req, Res>(run: (req: Req) => Promise<Res>): (req: Req) => Promise<Res> {
  return async (req) => {
    const timer = setTimeout(() => render().setIsProcessing(true), SPINNER_DELAY_MS);
    try {
      return await run(req);
    } finally {
      clearTimeout(timer);
      render().setIsProcessing(false);
    }
  };
}

/** Creates the three schedulers over `pipeline`. They do nothing until told the document. */
export function createSchedulers(pipeline: () => Pipeline): Schedulers {
  const ui = () => useUIStore.getState();

  // Each scheduler's `select` lists exactly what its request reads.
  const preview = new RenderScheduler({
    select: (doc: ImageDocument) => [doc.source, doc.mmPerPx, doc.steps, render().backgroundRemoval] as const,
    // In the relief job the relief is shown instead.
    enabled: () => !showsRelief(ui().job) && notExporting(),
    buildRequest: renderRequest,
    run: withSpinner((req: DocumentRenderRequest) => pipeline().renderPreview(req)),
    commit: (res: PreviewRenderResult) => {
      const committed = render().commitRender({
        key: res.key,
        sourceStage: res.sourceStage,
        pixels: res.final.pixels,
        durationMs: res.durationMs,
      });
      if (!committed) preview.rerun();
    },
    fail: report('Image processing failed'),
  });

  const trace = new RenderScheduler({
    // Phase 1 traces the unadjusted render of the crop, as before (#23 changes that).
    select: (doc: ImageDocument) =>
      [doc.source, doc.steps.crop, doc.vector, render().traceRequest, render().backgroundRemoval] as const,
    // Waits for a gesture to end, so a slider drag does not trace every step.
    enabled: () =>
      traces(ui().job) && render().autoTrace && useDocumentStore.getState().gesture === null && notExporting(),
    buildRequest: (doc: ImageDocument): TraceRequest => ({
      doc,
      target: previewTarget(doc),
      sourceStagePixels: removalFor(doc),
    }),
    run: async (req: TraceRequest) => {
      render().setIsTracing(true);
      try {
        return await pipeline().traceDocument(req);
      } finally {
        render().setIsTracing(false);
      }
    },
    commit: (res: VectorResult) => render().setVectorResult(res),
    fail: report('Tracing failed'),
  });

  const relief = new RenderScheduler({
    select: (doc: ImageDocument) => [doc.source, doc.steps.crop, doc.depth, render().backgroundRemoval] as const,
    enabled: () => showsRelief(ui().job) && notExporting(),
    buildRequest: renderRequest,
    run: withSpinner((req: DocumentRenderRequest) => pipeline().renderRelief(req)),
    commit: (res: ReliefRenderResult) => {
      const doc = useDocumentStore.getState().doc;
      if (!doc) return;
      const { width, height } = res.depth;
      const shaded = renderReliefPreview(new Uint16Array(res.depth.heightMapBuffer), width, height, doc.depth);
      const committed = render().commitRender({
        key: res.key,
        sourceStage: res.sourceStage,
        pixels: shaded.buffer as ArrayBuffer,
        durationMs: res.durationMs,
      });
      if (committed) render().setDepthHeightMap(res.depth.heightMapBuffer);
      else relief.rerun();
    },
    fail: report('Depth map generation failed'),
  });

  return { preview, trace, relief };
}

/**
 * Connects `schedulers` to the stores: every document change goes to all
 * three (each ignores what it does not read), and changes outside the
 * document that a scheduler reads make it look again. Returns a function that
 * disconnects them.
 */
export function connectSchedulers(schedulers: Schedulers, pipeline: () => Pipeline): () => void {
  const all = [schedulers.preview, schedulers.trace, schedulers.relief];
  const unsubscribers = [
    useDocumentStore.subscribe((state, prev) => {
      if (state.doc !== prev.doc) for (const s of all) s.onDocumentChange(state.doc);
      // Closing the document frees the worker's copy of its pixels. (Opening
      // another frees it too, as the worker replaces it.) A failure leaves
      // memory the next load frees anyway, so it is not reported.
      if (prev.doc && !state.doc) void pipeline().releaseSource().catch(() => undefined);
      // The trace waits for the end of a gesture.
      if (state.gesture !== prev.gesture) schedulers.trace.refresh();
    }),
    useRenderStore.subscribe((state, prev) => {
      const changed =
        state.backgroundRemoval !== prev.backgroundRemoval ||
        state.traceRequest !== prev.traceRequest ||
        state.autoTrace !== prev.autoTrace ||
        (state.exportProgress === null) !== (prev.exportProgress === null);
      if (changed) for (const s of all) s.refresh();
    }),
    useUIStore.subscribe((state, prev) => {
      if (state.job === prev.job) return;
      // The preview and the relief both write the preview: whichever the new job
      // shows renders again, and a result of the other still in flight is dropped.
      if (showsRelief(state.job) !== showsRelief(prev.job)) {
        schedulers.preview.rerun();
        schedulers.relief.rerun();
      }
      schedulers.trace.refresh();
    }),
  ];
  const doc = useDocumentStore.getState().doc;
  for (const s of all) s.onDocumentChange(doc);
  return () => unsubscribers.forEach((u) => u());
}

let started: Schedulers | null = null;

/** Starts the app's schedulers once, on the app's worker. */
export function startSchedulers(): Schedulers {
  if (!started) {
    started = createSchedulers(getPipeline);
    connectSchedulers(started, getPipeline);
  }
  return started;
}
