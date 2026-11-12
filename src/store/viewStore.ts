import { create } from 'zustand';
import { clampZoom, fitView, zoomAbout, type Point, type Size, type View } from '../lib/viewport';

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
  /** Offset of the image's centre from the container's centre, in screen pixels. */
  pan: Point;
  /** 0 to 1, the split view's divider across the image. */
  splitPosition: number;
  /** The canvas container and the image shown in it, in pixels; null until the canvas is laid out. */
  container: Size | null;
  image: Size | null;
  /** True while the view is fitted: a new container or image size fits it again. Zooming or panning clears it. */
  fitted: boolean;

  setCanvasTool: (tool: CanvasTool) => void;
  setSubstrateMask: (mask: SubstrateMask, cornerRadius?: number) => void;
  /** Multiplies the zoom by `factor`, keeping the point at `anchor` (from the container's centre) still. */
  zoomBy: (factor: number, anchor?: Point) => void;
  setPan: (pan: Point) => void;
  /** Sets the zoom (clamped) and pan together, as a pinch does (#54). */
  setView: (view: View) => void;
  setSplitPosition: (pos: number) => void;
  /** Actual size: 100 %, centred. */
  resetViewport: () => void;
  /** Fits the image to the container, and keeps it fitted until the user zooms or pans. */
  fit: () => void;
  /** Records the container and image sizes; refits if the view is fitted. */
  setFrame: (container: Size, image: Size) => void;
}

export const useViewStore = create<ViewState>((set, get) => ({
  canvasTool: 'pan',
  substrateMask: 'none',
  substrateCornerRadius: 5,
  zoom: 1.0,
  pan: { x: 0, y: 0 },
  splitPosition: 0.5,
  container: null,
  image: null,
  fitted: false,

  setCanvasTool: (canvasTool) => set({ canvasTool }),

  setSubstrateMask: (substrateMask, cornerRadius = 5) =>
    set({ substrateMask, substrateCornerRadius: cornerRadius }),

  zoomBy: (factor, anchor) =>
    set((state) => ({ ...zoomAbout({ zoom: state.zoom, pan: state.pan }, factor, anchor), fitted: false })),

  setPan: (pan) => set({ pan, fitted: false }),

  setView: (view) => set({ zoom: clampZoom(view.zoom), pan: view.pan, fitted: false }),

  setSplitPosition: (splitPosition) => set({ splitPosition: Math.min(Math.max(splitPosition, 0), 1) }),

  resetViewport: () => set({ zoom: 1.0, pan: { x: 0, y: 0 }, fitted: false }),

  fit: () => {
    const { container, image } = get();
    if (!container || !image || container.width <= 0 || container.height <= 0 || image.width <= 0 || image.height <= 0) {
      set({ fitted: true });
      return;
    }
    set({ ...fitView(container, image), fitted: true });
  },

  setFrame: (container, image) => {
    const prev = get();
    if (
      prev.container?.width === container.width &&
      prev.container?.height === container.height &&
      prev.image?.width === image.width &&
      prev.image?.height === image.height
    ) {
      return;
    }
    set({ container, image });
    if (prev.fitted) get().fit();
  },
}));
