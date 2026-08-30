import { create } from 'zustand';
import type {
  TonalAdjustments,
  ColorAdjustments,
  DetailEnhancements,
  GeometryTransform,
} from '../types/image';
import type { DitherConfig } from '../types/dither';
import type { VectorConfig, VectorResult } from '../types/vector';
import type { DepthConfig } from '../types/depth';
import type { EditStep, EditRecipe } from '../types/recipe';

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
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
  cropRect: null,
};

export const DEFAULT_DITHER: DitherConfig = {
  algorithm: 'none',
  threshold: 128,
  serpentine: true,
  matrixScale: 1,
  dotAngle: 45,
  invertedBurn: false,
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

interface EditSnapshot {
  tonal: TonalAdjustments;
  color: ColorAdjustments;
  detail: DetailEnhancements;
  geometry: GeometryTransform;
  dither: DitherConfig;
  vector: VectorConfig;
  depth: DepthConfig;
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

  // Active Vector Result for SVG Overlay
  vectorResult: VectorResult | null;

  // History Stacks
  undoStack: EditSnapshot[];
  redoStack: EditSnapshot[];

  // Non-destructive Recipe
  recipeName: string;

  // Actions
  setTonal: (tonal: Partial<TonalAdjustments>) => void;
  setColor: (color: Partial<ColorAdjustments>) => void;
  setDetail: (detail: Partial<DetailEnhancements>) => void;
  setGeometry: (geometry: Partial<GeometryTransform>) => void;
  setDither: (dither: Partial<DitherConfig>) => void;
  setVector: (vector: Partial<VectorConfig>) => void;
  setDepth: (depth: Partial<DepthConfig>) => void;
  setVectorResult: (result: VectorResult | null) => void;
  toggleVectorLayer: (layerId: string) => void;

  // History Actions
  pushHistorySnapshot: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Reset & Preset Actions
  resetAll: () => void;
  resetTonal: () => void;
  resetDither: () => void;
  resetVector: () => void;
  applyRecipe: (recipe: EditRecipe) => void;
  getExportRecipe: () => EditRecipe;
}

const getSnapshot = (state: EditState): EditSnapshot => ({
  tonal: { ...state.tonal },
  color: { ...state.color },
  detail: { ...state.detail },
  geometry: { ...state.geometry },
  dither: { ...state.dither },
  vector: { ...state.vector },
  depth: { ...state.depth },
});

export const useEditStore = create<EditState>((set, get) => ({
  tonal: { ...DEFAULT_TONAL },
  color: { ...DEFAULT_COLOR },
  detail: { ...DEFAULT_DETAIL },
  geometry: { ...DEFAULT_GEOMETRY },
  dither: { ...DEFAULT_DITHER },
  vector: { ...DEFAULT_VECTOR },
  depth: { ...DEFAULT_DEPTH },
  vectorResult: null,

  undoStack: [],
  redoStack: [],
  recipeName: 'Untitled Recipe',

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

  setDither: (dither) =>
    set((state) => ({
      dither: { ...state.dither, ...dither },
    })),

  setVector: (vector) =>
    set((state) => ({
      vector: { ...state.vector, ...vector },
    })),

  setDepth: (depth) =>
    set((state) => ({
      depth: { ...state.depth, ...depth },
    })),

  setVectorResult: (vectorResult) => set({ vectorResult }),

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

  pushHistorySnapshot: () => {
    const current = getSnapshot(get());
    set((state) => ({
      undoStack: [...state.undoStack.slice(-30), current],
      redoStack: [],
    }));
  },

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;
    const prev = state.undoStack[state.undoStack.length - 1];
    const current = getSnapshot(state);

    set({
      ...prev,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [current, ...state.redoStack],
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const next = state.redoStack[0];
    const current = getSnapshot(state);

    set({
      ...next,
      undoStack: [...state.undoStack, current],
      redoStack: state.redoStack.slice(1),
    });
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  resetAll: () => {
    get().pushHistorySnapshot();
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
    get().pushHistorySnapshot();
    set({ tonal: { ...DEFAULT_TONAL }, color: { ...DEFAULT_COLOR } });
  },

  resetDither: () => {
    get().pushHistorySnapshot();
    set({ dither: { ...DEFAULT_DITHER } });
  },

  resetVector: () => {
    get().pushHistorySnapshot();
    set({ vector: { ...DEFAULT_VECTOR }, vectorResult: null });
  },

  applyRecipe: (recipe) => {
    get().pushHistorySnapshot();
    const newTonal = { ...DEFAULT_TONAL };
    const newColor = { ...DEFAULT_COLOR };
    const newDetail = { ...DEFAULT_DETAIL };
    const newDither = { ...DEFAULT_DITHER };
    const newVector = { ...DEFAULT_VECTOR };
    const newDepth = { ...DEFAULT_DEPTH };

    recipe.steps.forEach((step) => {
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
