import { create } from 'zustand';
import type { ImageDocument } from '../types/document';
import type { VectorLayer, VectorResult } from '../types/vector';
import type { PreviewSource } from '../lib/crop';
import { MM_PER_INCH } from '../lib/document-size';
import { sameValue } from '../lib/document';
import type { ExportProgress, SourceStage } from '../types/worker-messages';
import { useDocumentStore } from './documentStore';
import { carryHidden, layerKey } from '../lib/trace-view';
import { traceInputsOf, type TraceInputs } from '../lib/trace-inputs';
import { withDrawnColours } from '../lib/trace-palette';

/**
 * Results derived from the document, and the status of producing them. None
 * of this is undoable: it is recomputed from the document.
 *
 * Hiding a layer is a view setting and acts on the trace result here. What is
 * traced (colours, merges and removals, the cutline) is in the document's
 * tracing settings, so it is undoable (#32).
 */
/** Background removal's result: replaces the `source`-stage render it was computed from. */
interface BackgroundRemoval {
  key: string;
  pixels: ArrayBuffer;
  /** The `source`-stage pixels before removal, for Restore. */
  original: ArrayBuffer;
}

interface RenderState {
  /**
   * The `source`-stage render (cropped, flattened, resampled, unadjusted) at
   * the preview target, as the worker last sent it. It changes together with
   * `processed`, so the two always have the same size.
   */
  source: PreviewSource | null;
  /** The latest committed preview, the same size as `source`. */
  processed: ArrayBuffer | null;
  /** Background removal applied to the current `source`, if any. Not part of the document. */
  backgroundRemoval: BackgroundRemoval | null;
  /** Increases on every commit to `processed`, so the canvas redraws. */
  previewVersion: number;
  depthHeightMap: ArrayBuffer | null;
  vectorResult: VectorResult | null;
  autoTrace: boolean;
  /** True when the tracing settings changed while auto-trace was off. */
  isVectorStale: boolean;
  /**
   * Everything in the document that `vectorResult` was traced from, or null
   * when it was not traced (a test grid overlay). The trace is stale when any
   * of it changes: the trace reads the adjustments and the size as well as
   * the tracing settings (#23, review of #84).
   */
  tracedInputs: TraceInputs | null;
  /**
   * The background-removed pixels the trace shown read, or null if it read the
   * image as opened. Removal is not in the document, so it is recorded beside
   * `tracedInputs` (review of #84).
   */
  tracedRemoval: ArrayBuffer | null;
  /**
   * The layers hidden on screen, by `layerKey`, kept across traces so a
   * re-trace does not show them again. A colour layer is known by its
   * colour, not its position, so a re-clustering that renumbers the colours
   * hides the same colour or, if it is gone, nothing (review of #84).
   */
  hiddenLayers: string[];
  /**
   * Increases when the user asks for a trace, so one runs even if nothing
   * changed, and when the user cancels one. The trace scheduler reads it, so
   * either way a trace already running is for an older request and its
   * result is dropped.
   */
  traceRequest: number;
  /** True while a trace is running in the worker. */
  isTracing: boolean;

  isProcessing: boolean;
  processingDurationMs: number;
  errorMessage: string | null;
  /**
   * The running raster export's progress, or `null` when none is running.
   * While it is set the preview, trace and relief wait (design section 5).
   */
  exportProgress: ExportProgress | null;

  /**
   * Commits a render: its pixels become the preview and, when it carries one,
   * its `source`-stage render becomes `source`. Returns false, committing
   * nothing, when the render was made from a `source`-stage render that is
   * neither the one carried nor the one held (the caller renders again).
   */
  commitRender: (render: { key: string; sourceStage: SourceStage | null; pixels: ArrayBuffer; durationMs: number }) => boolean;
  setDepthHeightMap: (buffer: ArrayBuffer | null) => void;
  /**
   * Replaces the `source`-stage pixels (background removal) with `buffer`,
   * computed from `from`. Does nothing and returns false unless the current
   * source is still that render. The pixels are not part of the document: a
   * new crop or image discards them.
   */
  replaceSourcePixels: (buffer: ArrayBuffer, from: PreviewSource) => boolean;
  /** Undoes background removal. */
  restoreSource: () => void;
  setVectorResult: (result: VectorResult | null) => void;
  setAutoTrace: (autoTrace: boolean) => void;
  /** Turns auto-trace on and traces now. */
  requestTrace: () => void;
  /**
   * Stops waiting for the running trace: its result is dropped and auto-trace
   * is turned off, so it does not start again. The tracer cannot stop part way,
   * so the worker finishes the run in the background before its next job.
   */
  cancelTrace: () => void;
  setIsTracing: (tracing: boolean) => void;
  /** Shows `layer` (a test grid's cut paths) as the vector result, in place of any trace. */
  addVectorLayer: (layer: VectorLayer) => void;
  clearVectors: () => void;
  toggleVectorLayer: (layerId: string) => void;
  setIsProcessing: (processing: boolean) => void;
  setErrorMessage: (message: string | null) => void;
  setExportProgress: (progress: ExportProgress | null) => void;
}


/**
 * True when the trace shown was made from the document as it is now (or is
 * not a trace at all, like a test grid), so exporting it writes what is on
 * screen. False while a newer trace is due or the settings changed.
 */
export function traceIsCurrent(): boolean {
  const { vectorResult, tracedInputs, tracedRemoval, backgroundRemoval } = useRenderStore.getState();
  const doc = useDocumentStore.getState().doc;
  if (!vectorResult || !doc) return false;
  if (tracedInputs === null) return true;
  return sameValue(tracedInputs, traceInputsOf(doc)) && tracedRemoval === (backgroundRemoval?.pixels ?? null);
}

/**
 * Pixels per millimetre of `source` (a render of `source.crop`) for `doc`, or
 * `null` while the size is not set. Measured from the render shown, so guides
 * and rulers match it even while a newer render is on its way.
 */
export function pxPerMmOfSource(doc: ImageDocument, source: Pick<PreviewSource, 'width' | 'crop'>): number | null {
  return doc.mmPerPx === null ? null : source.width / (source.crop.width * doc.mmPerPx);
}

/** Preview pixels per inch of the open document, or `null` while its size is not set. */
export function previewDpi(): number | null {
  const doc = useDocumentStore.getState().doc;
  const source = useRenderStore.getState().source;
  if (!doc || !source) return null;
  const pxPerMm = pxPerMmOfSource(doc, source);
  return pxPerMm === null ? null : pxPerMm * MM_PER_INCH;
}

function summed(layers: VectorLayer[]): Pick<VectorResult, 'totalPaths' | 'totalNodes'> {
  return {
    totalPaths: layers.reduce((acc, l) => acc + l.paths.length, 0),
    totalNodes: layers.reduce((acc, l) => acc + l.paths.reduce((n, p) => n + (p.nodeCount || 0), 0), 0),
  };
}

/**
 * True when changing background removal leaves the trace on screen out of
 * date: a trace is shown and none will replace it, as auto-trace is off. With
 * auto-trace on, the scheduler traces again (review of #84).
 */
function removalOutdatesTrace(s: Pick<RenderState, 'vectorResult' | 'tracedInputs' | 'autoTrace'>): boolean {
  return s.vectorResult !== null && s.tracedInputs !== null && !s.autoTrace;
}

const EMPTY_RESULTS = {
  source: null,
  processed: null,
  backgroundRemoval: null,
  depthHeightMap: null,
  vectorResult: null,
  autoTrace: true,
  isVectorStale: false,
  tracedInputs: null,
  tracedRemoval: null,
  hiddenLayers: [] as string[],
  isProcessing: false,
  processingDurationMs: 0,
};

export const useRenderStore = create<RenderState>((set, get) => ({
  ...EMPTY_RESULTS,
  previewVersion: 0,
  traceRequest: 0,
  isTracing: false,
  errorMessage: null,
  exportProgress: null,

  commitRender: ({ key, sourceStage, pixels, durationMs }) => {
    const held = get().source;
    if (!sourceStage && held?.key !== key) return false;
    const doc = useDocumentStore.getState().doc;
    if (!doc) return false;
    set((s) => {
      const source = sourceStage
        ? {
            key: sourceStage.key,
            sourceId: doc.source.sourceId,
            crop: sourceStage.crop,
            buffer: sourceStage.pixels,
            width: sourceStage.width,
            height: sourceStage.height,
          }
        : s.source;
      // Background removal belongs to the render it was computed from.
      const removal = s.backgroundRemoval?.key === source?.key ? s.backgroundRemoval : null;
      return {
        source: removal && source ? { ...source, buffer: removal.pixels } : source,
        backgroundRemoval: removal,
        processed: pixels,
        previewVersion: s.previewVersion + 1,
        processingDurationMs: durationMs,
      };
    });
    return true;
  },

  setDepthHeightMap: (depthHeightMap) => set({ depthHeightMap }),

  replaceSourcePixels: (buffer, from) => {
    const current = get().source;
    const same = current !== null && current.key === from.key && buffer.byteLength === current.width * current.height * 4;
    if (!same) return false;
    const original = get().backgroundRemoval?.original ?? current.buffer;
    set((s) => ({
      source: { ...current, buffer },
      backgroundRemoval: { key: current.key, pixels: buffer, original },
      isVectorStale: s.isVectorStale || removalOutdatesTrace(s),
    }));
    return true;
  },

  restoreSource: () => {
    const { source, backgroundRemoval } = get();
    if (!source || !backgroundRemoval || backgroundRemoval.key !== source.key) {
      set({ backgroundRemoval: null });
      return;
    }
    set((s) => ({
      source: { ...source, buffer: backgroundRemoval.original },
      backgroundRemoval: null,
      isVectorStale: s.isVectorStale || removalOutdatesTrace(s),
    }));
  },

  // Called with a trace's result only while nothing it read has changed, so the
  // document's tracing settings are the ones it was traced with.
  setVectorResult: (vectorResult) => {
    const doc = useDocumentStore.getState().doc;
    // A trace that was running while a layer was recoloured comes back in
    // the old colour: the colours drawn are the document's, as it is now.
    const coloured = vectorResult && withDrawnColours(vectorResult, doc?.vector.palette ?? null);
    const hiddenLayers = coloured ? carryHidden(get().hiddenLayers, coloured.layers) : get().hiddenLayers;
    const hidden = new Set(hiddenLayers);
    set({
      hiddenLayers,
      vectorResult: coloured && {
        ...coloured,
        layers: coloured.layers.map((l) => ({ ...l, visible: !hidden.has(layerKey(l)) })),
      },
      isVectorStale: false,
      tracedInputs: doc ? traceInputsOf(doc) : null,
      tracedRemoval: get().backgroundRemoval?.pixels ?? null,
    });
  },

  setAutoTrace: (autoTrace) => set({ autoTrace }),

  requestTrace: () => set((s) => ({ autoTrace: true, traceRequest: s.traceRequest + 1 })),

  // The paths left on screen are stale if the cancelled trace was for changed settings.
  cancelTrace: () =>
    set((s) => {
      const doc = useDocumentStore.getState().doc;
      const changed =
        s.vectorResult !== null &&
        s.tracedInputs !== null &&
        (!doc || !sameValue(traceInputsOf(doc), s.tracedInputs) || s.tracedRemoval !== (s.backgroundRemoval?.pixels ?? null));
      return { autoTrace: false, traceRequest: s.traceRequest + 1, isTracing: false, isVectorStale: s.isVectorStale || changed };
    }),

  setIsTracing: (isTracing) => set({ isTracing }),

  addVectorLayer: (layer) => {
    const source = get().source;
    const dpi = previewDpi();
    const layers = [layer];
    set({
      // Not a trace, so not traced with any settings.
      tracedInputs: null,
      tracedRemoval: null,
      // Nor can it be out of date: a flag left by an earlier change would block its export.
      isVectorStale: false,
      autoTrace: false,
      vectorResult: {
        layers,
        palette: [],
        ...summed(layers),
        dimensions: { width: source?.width ?? 1000, height: source?.height ?? 1000 },
        pxPerMm: dpi === null ? null : dpi / MM_PER_INCH,
      },
    });
  },

  clearVectors: () =>
    set({ vectorResult: null, autoTrace: false, isVectorStale: false, tracedInputs: null, tracedRemoval: null, hiddenLayers: [] }),

  toggleVectorLayer: (layerId) => {
    const vr = get().vectorResult;
    if (!vr) return;
    const layer = vr.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const key = layerKey(layer);
    const hidden = get().hiddenLayers;
    const hiddenLayers = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    set({
      hiddenLayers,
      vectorResult: {
        ...vr,
        layers: vr.layers.map((l) => ({ ...l, visible: !hiddenLayers.includes(layerKey(l)) })),
      },
    });
  },

  setIsProcessing: (isProcessing) => set({ isProcessing }),

  setErrorMessage: (errorMessage) => set({ errorMessage, isProcessing: false }),

  setExportProgress: (exportProgress) => set({ exportProgress }),
}));

// Keep the derived results in step with the document. A new document starts
// with no results (the schedulers render it); a new crop drops the relief;
// changing what the trace reads while auto-trace is off marks the trace stale.
useDocumentStore.subscribe((state, prev) => {
  const doc = state.doc;
  const before = prev.doc;
  if (doc === before) return;

  if (!doc || !before || doc.id !== before.id) {
    useRenderStore.setState((s) => ({ ...EMPTY_RESULTS, errorMessage: null, previewVersion: s.previewVersion + 1 }));
    return;
  }

  if (
    doc.source !== before.source ||
    doc.steps.rotation !== before.steps.rotation ||
    !sameValue(doc.steps.crop, before.steps.crop)
  ) {
    useRenderStore.setState({ depthHeightMap: null });
  }

  // By value: Reset All and recipes build new objects even when nothing in them changes.
  // Any input of the trace counts: adjustments and the size as well as the tracing settings.
  // A test grid's paths are not a trace of the image, so nothing makes them
  // stale and they stay exportable (review of #84).
  const render = useRenderStore.getState();
  const showsTestGrid = render.vectorResult !== null && render.tracedInputs === null;
  // The colour a layer is drawn in is not traced: it is applied to the result on screen (#91).
  if (render.vectorResult && !showsTestGrid && !sameValue(doc.vector.palette, before.vector.palette)) {
    useRenderStore.setState({ vectorResult: withDrawnColours(render.vectorResult, doc.vector.palette) });
  }
  if (!render.autoTrace && !showsTestGrid && !sameValue(traceInputsOf(doc), traceInputsOf(before))) {
    useRenderStore.setState({ isVectorStale: true });
  }
});
