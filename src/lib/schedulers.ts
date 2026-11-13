import { traceInputRefs } from './trace-inputs';
import { cropRectOf } from './document-size';
import type { ImageDocument } from '../types/document';
import type { DocumentRenderRequest, PreviewRenderResult, ReliefRenderResult, TraceRequest } from '../types/worker-messages';
import type { VectorResult } from '../types/vector';
import { useDocumentStore } from '../store/documentStore';
import { useRenderStore } from '../store/renderStore';
import { useUIStore } from '../store/uiStore';
import { showsRelief, traces } from './workflows';
import { RenderScheduler } from './render-scheduler';
import { photoPreviewTarget, previewTarget } from './render-target';
import { burnSimulationSettings } from './burn-simulation';
import { activeCalibration, activeProfiles, useProfilesStore } from '../store/profilesStore';
import { heightmapToRgba } from './relief';
import { RELIEF_SHAPE_KEYS } from '../types/depth';
import * as Comlink from 'comlink';
import type { ReliefProgress } from '../types/worker-messages';
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

function renderRequest(doc: ImageDocument): DocumentRenderRequest {
  const job = useUIStore.getState().job;
  // The photo is shown on the machine's dot grid, one pixel per laser dot (#34).
  const target = job === 'photo' ? photoPreviewTarget(doc).target : previewTarget(doc);
  const stage = traces(job) ? 'prepared' : 'final';
  let simulation: DocumentRenderRequest['simulation'];
  if (job === 'photo' && useUIStore.getState().burnPreview && doc.steps.dither.algorithm !== 'none') {
    const profiles = useProfilesStore.getState();
    const pitchMm = (physicalSizeWidthMm(doc) ?? target.widthPx * doc.steps.dither.dotPitchMm) / target.widthPx;
    simulation = burnSimulationSettings(pitchMm, activeProfiles(profiles).machine, activeCalibration('engrave', profiles)).simulation;
  }
  return {
    doc,
    target,
    haveSourceKey: render().source?.key ?? null,
    // The vector job shows the image the trace reads: adjusted, not dithered (#23).
    stage,
    simulation,
  };
}

function physicalSizeWidthMm(doc: ImageDocument): number | null {
  return doc.mmPerPx === null ? null : cropRectOf(doc).width * doc.mmPerPx;
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
    select: (doc: ImageDocument) => [doc.source, doc.mmPerPx, doc.steps] as const,
    // In the relief job the relief is shown instead.
    enabled: () => !showsRelief(ui().job) && notExporting(),
    buildRequest: renderRequest,
    run: withSpinner((req: DocumentRenderRequest) => pipeline().renderPreview(req)),
    commit: (res: PreviewRenderResult) => {
      const committed = render().commitRender({
        key: res.key,
        sourceStage: res.sourceStage,
        pixels: res.final.pixels,
        histogram: res.histogram,
        durationMs: res.durationMs,
      });
      if (!committed) preview.rerun();
    },
    fail: report('Image processing failed'),
  });

  const trace = new RenderScheduler({
    // Traces the adjusted image (#23): everything before the dither.
    // What the trace reads from the document is listed once, in `traceInputsOf` (#89).
    select: (doc: ImageDocument) => [...traceInputRefs(doc), render().traceRequest],
    // Waits for a gesture to end, so a slider drag does not trace every step.
    // Tracing settings are in millimetres, so nothing traces until the size is set.
    enabled: () => {
      const docState = useDocumentStore.getState();
      return (
        traces(ui().job) &&
        render().autoTrace &&
        docState.gesture === null &&
        docState.doc?.mmPerPx != null &&
        notExporting()
      );
    },
    buildRequest: (doc: ImageDocument): TraceRequest => ({
      doc,
      target: previewTarget(doc),
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

  // The relief reads the crop and only the shape settings: lighting, material
  // and the view's exaggeration are drawn by the view and never re-run it (#42).
  const onReliefProgress = (p: ReliefProgress) => {
    if (p.model) render().setRelief({ model: p.model });
  };
  const relief = new RenderScheduler({
    select: (doc: ImageDocument) =>
      [doc.source, doc.steps.rotation, doc.steps.crop, doc.steps.background, doc.mmPerPx, ...RELIEF_SHAPE_KEYS.map((k) => doc.depth[k])] as const,
    enabled: () => showsRelief(ui().job) && notExporting(),
    buildRequest: renderRequest,
    run: withSpinner(async (req: DocumentRenderRequest) => {
      render().setRelief({ error: null, model: null });
      try {
        return await pipeline().renderRelief(req, Comlink.proxy(onReliefProgress));
      } finally {
        render().setRelief({ model: null });
      }
    }),
    commit: (res: ReliefRenderResult) => {
      const heights = new Uint16Array(res.depth.heightMapBuffer);
      const committed = render().commitRender({
        key: res.key,
        sourceStage: res.sourceStage,
        pixels: heightmapToRgba(heights).buffer as ArrayBuffer,
        durationMs: res.durationMs,
      });
      if (committed) {
        render().setDepthHeightMap(res.depth.heightMapBuffer);
        render().setRelief({ source: res.depth.source, error: null });
      } else relief.rerun();
    },
    // Report failures, never substitute (#43): no heightmap is shown after one.
    fail: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      render().setDepthHeightMap(null);
      render().setRelief({ error: message, model: null });
      report('Depth map generation failed')(err);
    },
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
        state.traceRequest !== prev.traceRequest ||
        state.autoTrace !== prev.autoTrace ||
        (state.exportProgress === null) !== (prev.exportProgress === null);
      if (changed) for (const s of all) s.refresh();
      // A trace asked for while a cancelled one still holds the worker waits for
      // it; show it as running from the moment it is asked for, not only once it starts.
      if (state.traceRequest !== prev.traceRequest && state.autoTrace && schedulers.trace.isBusy()) {
        state.setIsTracing(true);
      }
    }),
    useUIStore.subscribe((state, prev) => {
      // The burn simulation changes only how the preview is drawn.
      if (state.burnPreview !== prev.burnPreview && state.job === prev.job) schedulers.preview.rerun();
      if (state.job === prev.job) return;
      // The preview and the relief both write the preview: whichever the new job
      // shows renders again, and a result of the other still in flight is dropped.
      if (showsRelief(state.job) !== showsRelief(prev.job)) {
        schedulers.preview.rerun();
        schedulers.relief.rerun();
      } else if (traces(state.job) !== traces(prev.job)) {
        // Into or out of the vector job: the preview stops or starts at the dither.
        schedulers.preview.rerun();
      }
      schedulers.trace.refresh();
    }),
    // The simulation reads the machine's spot size and the calibration.
    useProfilesStore.subscribe((state, prev) => {
      if (useUIStore.getState().burnPreview && (state.data !== prev.data || state.machineId !== prev.machineId || state.materialId !== prev.materialId)) {
        schedulers.preview.rerun();
      }
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
