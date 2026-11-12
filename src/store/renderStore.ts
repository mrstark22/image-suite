import { create } from 'zustand';
import type { ImageDocument } from '../types/document';
import type { VectorLayer, VectorResult } from '../types/vector';
import type { PreviewSource } from '../lib/crop';
import { MM_PER_INCH } from '../lib/document-size';
import { sameValue } from '../lib/document';
import type { ExportProgress, SourceStage } from '../types/worker-messages';
import { useDocumentStore } from './documentStore';

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
  /** The tracing settings `vectorResult` was traced with, or null when it was not traced (a test grid overlay). */
  tracedVector: ImageDocument['vector'] | null;
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

const EMPTY_RESULTS = {
  source: null,
  processed: null,
  backgroundRemoval: null,
  depthHeightMap: null,
  vectorResult: null,
  autoTrace: true,
  isVectorStale: false,
  tracedVector: null,
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
    set({
      source: { ...current, buffer },
      backgroundRemoval: { key: current.key, pixels: buffer, original },
    });
    return true;
  },

  restoreSource: () => {
    const { source, backgroundRemoval } = get();
    if (!source || !backgroundRemoval || backgroundRemoval.key !== source.key) {
      set({ backgroundRemoval: null });
      return;
    }
    set({ source: { ...source, buffer: backgroundRemoval.original }, backgroundRemoval: null });
  },

  // Called with a trace's result only while nothing it read has changed, so the
  // document's tracing settings are the ones it was traced with.
  setVectorResult: (vectorResult) =>
    set({ vectorResult, isVectorStale: false, tracedVector: useDocumentStore.getState().doc?.vector ?? null }),

  setAutoTrace: (autoTrace) => set({ autoTrace }),

  requestTrace: () => set((s) => ({ autoTrace: true, traceRequest: s.traceRequest + 1 })),

  // The paths left on screen are stale if the cancelled trace was for changed settings.
  cancelTrace: () =>
    set((s) => {
      const vector = useDocumentStore.getState().doc?.vector;
      const changed = s.vectorResult !== null && s.tracedVector !== null && !sameValue(vector, s.tracedVector);
      return { autoTrace: false, traceRequest: s.traceRequest + 1, isTracing: false, isVectorStale: s.isVectorStale || changed };
    }),

  setIsTracing: (isTracing) => set({ isTracing }),

  addVectorLayer: (layer) => {
    const source = get().source;
    const dpi = previewDpi();
    const layers = [layer];
    set({
      // Not a trace, so not traced with any settings.
      tracedVector: null,
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

  clearVectors: () => set({ vectorResult: null, autoTrace: false, isVectorStale: false, tracedVector: null }),

  toggleVectorLayer: (layerId) => {
    const vr = get().vectorResult;
    if (!vr) return;
    set({
      vectorResult: {
        ...vr,
        layers: vr.layers.map((l) => (l.id === layerId ? { ...l, visible: !l.visible } : l)),
      },
    });
  },

  setIsProcessing: (isProcessing) => set({ isProcessing }),

  setErrorMessage: (errorMessage) => set({ errorMessage, isProcessing: false }),

  setExportProgress: (exportProgress) => set({ exportProgress }),
}));

// Keep the derived results in step with the document. A new document starts
// with no results (the schedulers render it); a new crop drops the relief;
// changing the tracing settings while auto-trace is off marks the trace stale.
useDocumentStore.subscribe((state, prev) => {
  const doc = state.doc;
  const before = prev.doc;
  if (doc === before) return;

  if (!doc || !before || doc.id !== before.id) {
    useRenderStore.setState((s) => ({ ...EMPTY_RESULTS, errorMessage: null, previewVersion: s.previewVersion + 1 }));
    return;
  }

  if (doc.source !== before.source || !sameValue(doc.steps.crop, before.steps.crop)) {
    useRenderStore.setState({ depthHeightMap: null });
  }

  // By value: Reset All and recipes build a new vector object even when nothing in it changes.
  if (!sameValue(doc.vector, before.vector) && !useRenderStore.getState().autoTrace) {
    useRenderStore.setState({ isVectorStale: true });
  }
});
