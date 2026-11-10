import { create } from 'zustand';
import type {
  TonalAdjustments,
  ColorAdjustments,
  DetailEnhancements,
  GeometryTransform,
  CropRect,
} from '../types/image';
import type { DitherConfig } from '../types/dither';
import type { VectorConfig, VectorResult, VectorLayer } from '../types/vector';
import type { DepthConfig } from '../types/depth';
import type { EditStep, EditRecipe } from '../types/recipe';
import { generateCutlineLayer } from '../lib/cutline-generator';
import { smoothVectorResult } from '../lib/vector-smoother';
import { clampCropRect } from '../lib/crop';
import { useImageStore } from './imageStore';
import { useUIStore } from './uiStore';

export const DEFAULT_TONAL: TonalAdjustments = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  midtones: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  clarity: 0,
  gamma: 1.0,
  blackPoint: 0,
  whitePoint: 255,
  invert: false,
  grayscaleMode: 'none',
};

export const DEFAULT_COLOR: ColorAdjustments = {
  hue: 0,
  saturation: 0,
  lightness: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
};

export const DEFAULT_DETAIL: DetailEnhancements = {
  clahe: false,
  claheClipLimit: 2.5,
  claheGridSize: 8,
  unsharpStrength: 0,
  unsharpRadius: 1.5,
  adaptiveThreshold: false,
  adaptiveBlockSize: 15,
  adaptiveConstant: 2,
};

export const DEFAULT_GEOMETRY: GeometryTransform = {
  cropRect: null,
};

export const DEFAULT_DITHER: DitherConfig = {
  algorithm: 'none',
  threshold: 128,
  serpentine: true,
  matrixScale: 1,
  invertedBurn: false,
  alphaHandling: 'white-ignore',
};

export const DEFAULT_VECTOR: VectorConfig = {
  mode: 'outline',
  colorCount: 4,
  threshold: 128,
  rdpTolerance: 1.0,
  curveFitting: true,
  bezierTolerance: 1.0,
  invert: false,
  minPathArea: 4,
  denoise: 0.0,
  cannyLow: 30,
  cannyHigh: 80,
  strokeWidth: 1.0,
  groupLayers: true,
};

export const DEFAULT_DEPTH: DepthConfig = {
  source: 'tonal-height',
  bevelStyle: 'prismatic',
  invertZ: false,
  zMin: 0,
  zMax: 100,
  smoothingRadius: 2.0,
  depthScale: 3.0,
  reliefAngle: 45,
  export16Bit: true,
  detailEmboss: 0,
  aiWeight: 75,
  tonalBlend: 25,
  surfaceDenoise: 2.0,
  viewMode: '3d-shaded',
  material: 'walnut',
  lightAngle: 315,
  lightElevation: 45,
};

export interface EditSnapshot {
  tonal: TonalAdjustments;
  color: ColorAdjustments;
  detail: DetailEnhancements;
  geometry: GeometryTransform;
  dither: DitherConfig;
  vector: VectorConfig;
  depth: DepthConfig;
  autoTrace: boolean;
  vectorResult: VectorResult | null;
}

interface EditState {
  // Current Active Parameters
  tonal: TonalAdjustments;
  color: ColorAdjustments;
  detail: DetailEnhancements;
  geometry: GeometryTransform;
  dither: DitherConfig;
  vector: VectorConfig;
  depth: DepthConfig;

  // Active Vector Result for SVG Overlay & Auto-Trace Control
  vectorResult: VectorResult | null;
  autoTrace: boolean;
  isVectorStale: boolean;

  // History Stacks & Interaction Batching
  undoStack: EditSnapshot[];
  redoStack: EditSnapshot[];
  isAdjusting: boolean;
  adjustmentBaseline: EditSnapshot | null;

  // Non-destructive Recipe
  recipeName: string;

  // Actions
  setTonal: (tonal: Partial<TonalAdjustments>) => void;
  setColor: (color: Partial<ColorAdjustments>) => void;
  setDetail: (detail: Partial<DetailEnhancements>) => void;
  setGeometry: (geometry: Partial<GeometryTransform>) => void;
  /**
   * Crops to `box`, given in pixels of the preview as currently shown (that is,
   * after any earlier crop). Records one undo entry. Does nothing if the box
   * lies outside the image.
   */
  cropTo: (box: CropRect) => void;
  setDither: (dither: Partial<DitherConfig>) => void;
  setVector: (vector: Partial<VectorConfig>) => void;
  setDepth: (depth: Partial<DepthConfig>) => void;
  setAutoTrace: (autoTrace: boolean) => void;
  setVectorResult: (result: VectorResult | null) => void;
  addVectorLayer: (layer: VectorLayer) => void;
  generateCutline: (offsetMm?: number, smoothness?: number) => void;
  smoothVectors: (tolerance?: number, fitCurves?: boolean) => void;
  clearVectors: () => void;
  removeVectorLayer: (layerId: string) => void;
  toggleVectorLayer: (layerId: string) => void;

  // History Actions (Interaction-based with mouseup / commit support)
  beginAdjustment: () => void;
  commitAdjustment: () => void;
  recordHistorySnapshot: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Resets every setting to its default and clears the history, for a newly opened image. */
  startNewImage: () => void;

  // Reset & Preset Actions
  resetAll: () => void;
  resetTonal: () => void;
  resetDither: () => void;
  resetVector: () => void;
  applyRecipe: (recipe: EditRecipe) => void;
  getExportRecipe: () => EditRecipe;
}

const getSnapshot = (state: EditState): EditSnapshot => {
  return {
    tonal: { ...state.tonal },
    color: { ...state.color },
    detail: { ...state.detail },
    geometry: { ...state.geometry },
    dither: { ...state.dither },
    vector: { ...state.vector },
    depth: { ...state.depth },
    autoTrace: state.autoTrace,
    vectorResult: state.vectorResult ? { ...state.vectorResult } : null,
  };
};

export const useEditStore = create<EditState>((set, get) => ({
  tonal: { ...DEFAULT_TONAL },
  color: { ...DEFAULT_COLOR },
  detail: { ...DEFAULT_DETAIL },
  geometry: { ...DEFAULT_GEOMETRY },
  dither: { ...DEFAULT_DITHER },
  vector: { ...DEFAULT_VECTOR },
  depth: { ...DEFAULT_DEPTH },
  vectorResult: null,
  autoTrace: true,
  isVectorStale: false,

  undoStack: [],
  redoStack: [],
  isAdjusting: false,
  adjustmentBaseline: null,
  recipeName: 'Untitled Recipe',

  beginAdjustment: () => {
    if (!get().isAdjusting) {
      set({
        isAdjusting: true,
        adjustmentBaseline: getSnapshot(get()),
      });
    }
  },

  commitAdjustment: () => {
    const baseline = get().adjustmentBaseline;
    if (baseline) {
      set((state) => ({
        undoStack: [...state.undoStack.slice(-40), baseline],
        redoStack: [],
        isAdjusting: false,
        adjustmentBaseline: null,
      }));
    } else {
      set({ isAdjusting: false, adjustmentBaseline: null });
    }
  },

  recordHistorySnapshot: () => {
    const current = getSnapshot(get());
    set((state) => ({
      undoStack: [...state.undoStack.slice(-40), current],
      redoStack: [],
      isAdjusting: false,
      adjustmentBaseline: null,
    }));
  },

  setTonal: (tonal) =>
    set((state) => ({
      tonal: { ...state.tonal, ...tonal },
    })),

  setColor: (color) =>
    set((state) => ({
      color: { ...state.color, ...color },
    })),

  setDetail: (detail) =>
    set((state) => ({
      detail: { ...state.detail, ...detail },
    })),

  setGeometry: (geometry) =>
    set((state) => ({
      geometry: { ...state.geometry, ...geometry },
    })),

  cropTo: (box) => {
    const source = useImageStore.getState().sourcePreviewDimensions;
    if (!source) return;
    const current = get().geometry.cropRect;
    const viewWidth = current ? current.width : source.width;
    const viewHeight = current ? current.height : source.height;
    const inView = clampCropRect(box, viewWidth, viewHeight);
    if (!inView) return;
    const rect = {
      ...inView,
      x: (current?.x ?? 0) + inView.x,
      y: (current?.y ?? 0) + inView.y,
    };
    get().recordHistorySnapshot();
    set((state) => ({ geometry: { ...state.geometry, cropRect: rect } }));
  },

  setDither: (dither) =>
    set((state) => ({
      dither: { ...state.dither, ...dither },
    })),

  setVector: (vector) =>
    set((state) => ({
      vector: { ...state.vector, ...vector },
      isVectorStale: !state.autoTrace,
    })),

  setDepth: (depth) =>
    set((state) => ({
      depth: { ...state.depth, ...depth },
    })),

  setAutoTrace: (autoTrace) => set({ autoTrace }),

  setVectorResult: (vectorResult) => set({ vectorResult, isVectorStale: false }),

  addVectorLayer: (layer: VectorLayer) => {
    get().recordHistorySnapshot();
    const vr = get().vectorResult;
    if (!vr) {
      const dims = useImageStore.getState().previewDimensions || { width: 1000, height: 1000, scale: 1 };
      set({
        vectorResult: {
          totalPaths: layer.paths.length,
          totalNodes: layer.totalNodes,
          svgString: '',
          dimensions: { width: dims.width, height: dims.height },
          layers: [layer],
        },
      });
    } else {
      const updatedLayers = [layer, ...vr.layers.filter((l) => l.id !== layer.id)];
      const totalPaths = updatedLayers.reduce((acc, l) => acc + l.paths.length, 0);
      const totalNodes = updatedLayers.reduce((acc, l) => acc + l.totalNodes, 0);
      set({
        vectorResult: {
          ...vr,
          layers: updatedLayers,
          totalPaths,
          totalNodes,
        },
      });
    }
  },

  generateCutline: (offsetMm: number = 2.0, smoothness: number = 3) => {
    const buf = useImageStore.getState().previewBuffer;
    const dims = useImageStore.getState().previewDimensions;
    const meta = useImageStore.getState().metadata;
    if (!buf || !dims) return;

    const cutlineLayer = generateCutlineLayer(buf, dims.width, dims.height, {
      offsetMm,
      dpi: meta?.dpi || 300,
      smoothness,
      color: '#ff0000',
    });

    get().addVectorLayer(cutlineLayer);
    useUIStore.getState().toggleVectorOverlay();
  },

  smoothVectors: (tolerance = 1.5, fitCurves = true) => {
    const vr = get().vectorResult;
    if (!vr) return;
    get().recordHistorySnapshot();

    const { result } = smoothVectorResult(vr, tolerance, fitCurves);
    set({ vectorResult: result });
  },

  clearVectors: () => {
    get().recordHistorySnapshot();
    set({ vectorResult: null, autoTrace: false, isVectorStale: false });
  },

  removeVectorLayer: (layerId: string) => {
    const vr = get().vectorResult;
    if (!vr) return;
    get().recordHistorySnapshot();
    const remainingLayers = vr.layers.filter((l) => l.id !== layerId);
    if (remainingLayers.length === 0) {
      set({ vectorResult: null });
    } else {
      const totalPaths = remainingLayers.reduce((acc, l) => acc + l.paths.length, 0);
      const totalNodes = remainingLayers.reduce((acc, l) => acc + l.paths.reduce((pAcc, p) => pAcc + (p.nodeCount || 0), 0), 0);
      set({
        vectorResult: {
          ...vr,
          layers: remainingLayers,
          totalPaths,
          totalNodes,
        },
      });
    }
  },

  toggleVectorLayer: (layerId: string) => {
    const vr = get().vectorResult;
    if (!vr) return;
    set({
      vectorResult: {
        ...vr,
        layers: vr.layers.map((l) =>
          l.id === layerId ? { ...l, visible: !l.visible } : l
        ),
      },
    });
  },

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;
    const prev = state.undoStack[state.undoStack.length - 1];
    const current = getSnapshot(state);

    set({
      tonal: prev.tonal,
      color: prev.color,
      detail: prev.detail,
      geometry: prev.geometry,
      dither: prev.dither,
      vector: prev.vector,
      depth: prev.depth,
      autoTrace: prev.autoTrace,
      vectorResult: prev.vectorResult,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [current, ...state.redoStack],
      isAdjusting: false,
      adjustmentBaseline: null,
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const next = state.redoStack[0];
    const current = getSnapshot(state);

    set({
      tonal: next.tonal,
      color: next.color,
      detail: next.detail,
      geometry: next.geometry,
      dither: next.dither,
      vector: next.vector,
      depth: next.depth,
      autoTrace: next.autoTrace,
      vectorResult: next.vectorResult,
      undoStack: [...state.undoStack, current],
      redoStack: state.redoStack.slice(1),
      isAdjusting: false,
      adjustmentBaseline: null,
    });
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  startNewImage: () =>
    set({
      tonal: { ...DEFAULT_TONAL },
      color: { ...DEFAULT_COLOR },
      detail: { ...DEFAULT_DETAIL },
      geometry: { ...DEFAULT_GEOMETRY },
      dither: { ...DEFAULT_DITHER },
      vector: { ...DEFAULT_VECTOR },
      depth: { ...DEFAULT_DEPTH },
      vectorResult: null,
      autoTrace: true,
      isVectorStale: false,
      undoStack: [],
      redoStack: [],
      isAdjusting: false,
      adjustmentBaseline: null,
    }),

  resetAll: () => {
    get().recordHistorySnapshot();
    set({
      tonal: { ...DEFAULT_TONAL },
      color: { ...DEFAULT_COLOR },
      detail: { ...DEFAULT_DETAIL },
      geometry: { ...DEFAULT_GEOMETRY },
      dither: { ...DEFAULT_DITHER },
      vector: { ...DEFAULT_VECTOR },
      depth: { ...DEFAULT_DEPTH },
      vectorResult: null,
    });
  },

  resetTonal: () => {
    get().recordHistorySnapshot();
    set({ tonal: { ...DEFAULT_TONAL }, color: { ...DEFAULT_COLOR } });
  },

  resetDither: () => {
    get().recordHistorySnapshot();
    set({ dither: { ...DEFAULT_DITHER } });
  },

  resetVector: () => {
    get().recordHistorySnapshot();
    set({ vector: { ...DEFAULT_VECTOR }, vectorResult: null, autoTrace: true });
  },

  applyRecipe: (recipe: EditRecipe) => {
    get().recordHistorySnapshot();
    const newTonal = { ...DEFAULT_TONAL };
    const newColor = { ...DEFAULT_COLOR };
    const newDetail = { ...DEFAULT_DETAIL };
    const newDither = { ...DEFAULT_DITHER };
    const newVector = { ...DEFAULT_VECTOR };
    const newDepth = { ...DEFAULT_DEPTH };

    recipe.steps.forEach((step: EditStep) => {
      if (step.type === 'tonal') Object.assign(newTonal, step.params);
      if (step.type === 'color') Object.assign(newColor, step.params);
      if (step.type === 'detail') Object.assign(newDetail, step.params);
      if (step.type === 'dither') Object.assign(newDither, step.params);
      if (step.type === 'vectorize') Object.assign(newVector, step.params);
      if (step.type === 'depth') Object.assign(newDepth, step.params);
    });

    set({
      recipeName: recipe.name,
      tonal: newTonal,
      color: newColor,
      detail: newDetail,
      dither: newDither,
      vector: newVector,
      depth: newDepth,
    });
  },

  getExportRecipe: () => {
    const s = get();
    const steps: EditStep[] = [
      { id: '1', type: 'geometry', enabled: true, timestamp: Date.now(), params: s.geometry },
      { id: '2', type: 'tonal', enabled: true, timestamp: Date.now(), params: s.tonal },
      { id: '3', type: 'color', enabled: true, timestamp: Date.now(), params: s.color },
      { id: '4', type: 'detail', enabled: true, timestamp: Date.now(), params: s.detail },
      { id: '5', type: 'dither', enabled: s.dither.algorithm !== 'none', timestamp: Date.now(), params: s.dither },
      { id: '6', type: 'vectorize', enabled: true, timestamp: Date.now(), params: s.vector },
      { id: '7', type: 'depth', enabled: true, timestamp: Date.now(), params: s.depth },
    ];

    return {
      version: '1.0.0',
      name: s.recipeName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps,
    };
  },
}));

// The crop is an edit setting, so undo, redo, presets and resets can change it.
// Whenever it changes, derive the cropped preview from the whole-image preview.
useEditStore.subscribe((state, prev) => {
  if (state.geometry.cropRect !== prev.geometry.cropRect) {
    useImageStore.getState().applyCrop(state.geometry.cropRect);
  }
});
