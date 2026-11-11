import { create } from 'zustand';

export type CanvasTool = 'pan' | 'crop';

export type SubstrateMask = 'none' | 'circle' | 'rounded-rect' | 'oval' | 'hexagon';

/**
 * How the image is viewed: zoom, pan, the active canvas tool, the split
 * position and the substrate guide. Not part of the document and not undoable.
 */
interface ViewState {
  canvasTool: CanvasTool;
  substrateMask: SubstrateMask;
  /** Corner radius of the rounded-rectangle guide, in mm. */
  substrateCornerRadius: number;
  zoom: number;
  pan: { x: number; y: number };
  /** 0 to 1, the split view's divider across the image. */
  splitPosition: number;

  setCanvasTool: (tool: CanvasTool) => void;
  setSubstrateMask: (mask: SubstrateMask, cornerRadius?: number) => void;
  setZoom: (zoom: number | ((prev: number) => number)) => void;
  setPan: (pan: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => void;
  setSplitPosition: (pos: number) => void;
  resetViewport: () => void;
  /** Zooms so an image of `imageW` x `imageH` fits a container of `containerW` x `containerH`, at most 100 %. */
  fitToViewport: (containerW: number, containerH: number, imageW: number, imageH: number) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  canvasTool: 'pan',
  substrateMask: 'none',
  substrateCornerRadius: 5,
  zoom: 1.0,
  pan: { x: 0, y: 0 },
  splitPosition: 0.5,

  setCanvasTool: (canvasTool) => set({ canvasTool }),

  setSubstrateMask: (substrateMask, cornerRadius = 5) =>
    set({ substrateMask, substrateCornerRadius: cornerRadius }),

  setZoom: (zoom) =>
    set((state) => ({
      zoom: Math.min(Math.max(typeof zoom === 'function' ? zoom(state.zoom) : zoom, 0.05), 32.0),
    })),

  setPan: (pan) =>
    set((state) => ({
      pan: typeof pan === 'function' ? pan(state.pan) : pan,
    })),

  setSplitPosition: (splitPosition) => set({ splitPosition: Math.min(Math.max(splitPosition, 0), 1) }),

  resetViewport: () => set({ zoom: 1.0, pan: { x: 0, y: 0 } }),

  fitToViewport: (containerW, containerH, imageW, imageH) => {
    if (containerW <= 0 || containerH <= 0 || imageW <= 0 || imageH <= 0) return;
    const padding = 40;
    const fitScale = Math.min((containerW - padding) / imageW, (containerH - padding) / imageH, 1.0);
    set({ zoom: Math.max(0.05, fitScale), pan: { x: 0, y: 0 } });
  },
}));
