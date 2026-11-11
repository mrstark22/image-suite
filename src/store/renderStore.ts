import { create } from 'zustand';
import type { ImageDocument } from '../types/document';
import type { VectorLayer, VectorResult } from '../types/vector';
import { cropInPreview, cropRgba, type PreviewSource } from '../lib/crop';
import { cropRectOf, MM_PER_INCH, pxPerMmAt } from '../lib/document-size';
import { sameValue } from '../lib/document';
import { sourcePixels } from '../lib/source-registry';
import { generateCutlineLayer } from '../lib/cutline-generator';
import { smoothVectorResult } from '../lib/vector-smoother';
import { useDocumentStore } from './documentStore';

/**
 * Results derived from the document, and the status of producing them. None
 * of this is undoable: it is recomputed from the document.
 *
 * Trace edits (cutlines, node smoothing, removing or hiding vector layers) act
 * on the trace result here, so they are not undoable until phase 2 (#32).
 */
interface RenderState {
  /** The cropped, unadjusted preview the worker path processes. */
  source: PreviewSource | null;
  /** The latest committed preview, the same size as `source`. */
  processed: ArrayBuffer | null;
  /** Increases on every commit to `processed`, so the canvas redraws. */
  previewVersion: number;
  depthHeightMap: ArrayBuffer | null;
  vectorResult: VectorResult | null;
  autoTrace: boolean;
  /** True when the tracing settings changed while auto-trace was off. */
  isVectorStale: boolean;
  /** Increases when the user asks for a trace, so one runs even if nothing changed. */
  traceRequest: number;

  isProcessing: boolean;
  processingDurationMs: number;
  errorMessage: string | null;

  setProcessedPreview: (buffer: ArrayBuffer, durationMs: number) => void;
  setDepthHeightMap: (buffer: ArrayBuffer | null) => void;
  /**
   * Replaces the pixels of the preview source (background removal) with
   * `buffer`, computed from `from`. Does nothing and returns false unless the
   * current source is still that image and crop at that size. The pixels are
   * not part of the document: a new crop or image discards them.
   */
  replaceSourcePixels: (buffer: ArrayBuffer, from: PreviewSource) => boolean;
  /** Restores the preview source from the document. */
  restoreSource: () => void;
  setVectorResult: (result: VectorResult | null) => void;
  setAutoTrace: (autoTrace: boolean) => void;
  /** Turns auto-trace on and traces now. */
  requestTrace: () => void;
  addVectorLayer: (layer: VectorLayer) => void;
  /** Adds a cutline around the image. Refuses (returns false) while the size is not set. */
  generateCutline: (offsetMm?: number, smoothness?: number) => boolean;
  smoothVectors: (tolerance?: number, fitCurves?: boolean) => void;
  clearVectors: () => void;
  removeVectorLayer: (layerId: string) => void;
  toggleVectorLayer: (layerId: string) => void;
  setIsProcessing: (processing: boolean) => void;
  setErrorMessage: (message: string | null) => void;
}

/** The cropped preview of `doc`, or `null` when its source pixels are not available. */
export function derivePreviewSource(doc: ImageDocument): PreviewSource | null {
  const pixels = sourcePixels(doc.source.sourceId);
  if (!pixels) return null;
  const crop = cropRectOf(doc);
  const inPreview = cropInPreview(
    crop,
    doc.source.widthPx,
    doc.source.heightPx,
    pixels.previewWidth,
    pixels.previewHeight
  );
  const cropped = cropRgba(pixels.preview, pixels.previewWidth, pixels.previewHeight, inPreview);
  return {
    sourceId: doc.source.sourceId,
    crop,
    buffer: cropped.buffer,
    width: cropped.width,
    height: cropped.height,
  };
}

/** Preview pixels per inch of the open document, or `null` while its size is not set. */
export function previewDpi(): number | null {
  const doc = useDocumentStore.getState().doc;
  const source = useRenderStore.getState().source;
  if (!doc || !source) return null;
  const pxPerMm = pxPerMmAt(doc, source.width);
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
  depthHeightMap: null,
  vectorResult: null,
  autoTrace: true,
  isVectorStale: false,
  isProcessing: false,
  processingDurationMs: 0,
};

export const useRenderStore = create<RenderState>((set, get) => ({
  ...EMPTY_RESULTS,
  previewVersion: 0,
  traceRequest: 0,
  errorMessage: null,

  setProcessedPreview: (buffer, durationMs) =>
    set((s) => ({
      processed: buffer,
      previewVersion: s.previewVersion + 1,
      isProcessing: false,
      processingDurationMs: durationMs,
    })),

  setDepthHeightMap: (depthHeightMap) => set({ depthHeightMap }),

  replaceSourcePixels: (buffer, from) => {
    const current = get().source;
    const same =
      current !== null &&
      current.sourceId === from.sourceId &&
      sameValue(current.crop, from.crop) &&
      current.width === from.width &&
      current.height === from.height &&
      buffer.byteLength === current.width * current.height * 4;
    if (!same) return false;
    set((s) => ({
      source: { ...current, buffer },
      processed: buffer.slice(0),
      previewVersion: s.previewVersion + 1,
    }));
    return true;
  },

  restoreSource: () => {
    const doc = useDocumentStore.getState().doc;
    const source = doc ? derivePreviewSource(doc) : null;
    set((s) => ({
      source,
      processed: source ? source.buffer.slice(0) : null,
      previewVersion: s.previewVersion + 1,
    }));
  },

  setVectorResult: (vectorResult) => set({ vectorResult, isVectorStale: false }),

  setAutoTrace: (autoTrace) => set({ autoTrace }),

  requestTrace: () => set((s) => ({ autoTrace: true, traceRequest: s.traceRequest + 1 })),

  addVectorLayer: (layer) => {
    const vr = get().vectorResult;
    if (!vr) {
      const source = get().source;
      set({
        vectorResult: {
          totalPaths: layer.paths.length,
          totalNodes: layer.totalNodes,
          svgString: '',
          dimensions: { width: source?.width ?? 1000, height: source?.height ?? 1000 },
          layers: [layer],
        },
      });
      return;
    }
    const layers = [layer, ...vr.layers.filter((l) => l.id !== layer.id)];
    set({ vectorResult: { ...vr, layers, ...summed(layers) } });
  },

  generateCutline: (offsetMm = 2.0, smoothness = 3) => {
    const source = get().source;
    const dpi = previewDpi();
    if (!source || dpi === null) return false;
    const layer = generateCutlineLayer(source.buffer, source.width, source.height, {
      offsetMm,
      dpi,
      smoothness,
      color: '#ff0000',
    });
    get().addVectorLayer(layer);
    return true;
  },

  smoothVectors: (tolerance = 1.5, fitCurves = true) => {
    const vr = get().vectorResult;
    if (!vr) return;
    set({ vectorResult: smoothVectorResult(vr, tolerance, fitCurves).result });
  },

  clearVectors: () => set({ vectorResult: null, autoTrace: false, isVectorStale: false }),

  removeVectorLayer: (layerId) => {
    const vr = get().vectorResult;
    if (!vr) return;
    const layers = vr.layers.filter((l) => l.id !== layerId);
    set({ vectorResult: layers.length === 0 ? null : { ...vr, layers, ...summed(layers) } });
  },

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
}));

// Keep the derived results in step with the document. A new document starts
// with no results; a new crop gets a new preview source; changing the tracing
// settings while auto-trace is off marks the trace stale.
useDocumentStore.subscribe((state, prev) => {
  const doc = state.doc;
  const before = prev.doc;
  if (doc === before) return;

  if (!doc) {
    useRenderStore.setState((s) => ({ ...EMPTY_RESULTS, errorMessage: null, previewVersion: s.previewVersion + 1 }));
    return;
  }

  if (!before || doc.id !== before.id) {
    const source = derivePreviewSource(doc);
    useRenderStore.setState((s) => ({
      ...EMPTY_RESULTS,
      errorMessage: null,
      source,
      processed: source ? source.buffer.slice(0) : null,
      previewVersion: s.previewVersion + 1,
    }));
    return;
  }

  if (doc.source !== before.source || !sameValue(doc.steps.crop, before.steps.crop)) {
    const source = derivePreviewSource(doc);
    useRenderStore.setState((s) => ({
      source,
      processed: source ? source.buffer.slice(0) : null,
      depthHeightMap: null,
      previewVersion: s.previewVersion + 1,
    }));
  }

  // By value: Reset All and recipes build a new vector object even when nothing in it changes.
  if (!sameValue(doc.vector, before.vector) && !useRenderStore.getState().autoTrace) {
    useRenderStore.setState({ isVectorStale: true });
  }
});
