import { create } from 'zustand';
import type { ImageMetadata, PreviewDimensions, CropRect } from '../types/image';
import { cropRgba } from '../lib/crop';

export type CanvasTool = 'pan' | 'crop';

export type SubstrateMask = 'none' | 'circle' | 'rounded-rect' | 'oval' | 'hexagon';

interface ImageState {
  // Loaded Original Image / Master Composite
  originalFile: File | null;
  originalBuffer: ArrayBuffer | null;
  originalBitmap: ImageBitmap | null;
  metadata: ImageMetadata | null;

  // Preview of the whole image, before cropping
  sourcePreviewBuffer: ArrayBuffer | null;
  sourcePreviewDimensions: PreviewDimensions | null;

  // Preview after cropping: what every panel works on
  previewBuffer: ArrayBuffer | null;
  previewProcessedBuffer: ArrayBuffer | null;
  depthHeightMapBuffer: ArrayBuffer | null;
  previewDimensions: PreviewDimensions | null;
  previewVersion: number;

  // Viewport & Tool Interaction
  canvasTool: CanvasTool;
  substrateMask: SubstrateMask;
  substrateCornerRadius: number; // in mm (e.g. 5mm)
  zoom: number;
  pan: { x: number; y: number };
  isDragging: boolean;
  splitPosition: number; // 0.0 to 1.0 (0.5 center)

  // Status
  isLoading: boolean;
  isProcessing: boolean;
  processingDurationMs: number;
  errorMessage: string | null;

  // Actions
  setImage: (
    file: File,
    buffer: ArrayBuffer,
    bitmap: ImageBitmap,
    metadata: ImageMetadata,
    previewBuffer: ArrayBuffer,
    previewDims: PreviewDimensions,
    preserveViewport?: boolean
  ) => void;
  /** Derives the cropped preview from the whole-image preview. `null` shows the whole image. */
  applyCrop: (rect: CropRect | null) => void;
  setProcessedPreview: (buffer: ArrayBuffer, durationMs: number) => void;
  setDepthHeightMapBuffer: (buffer: ArrayBuffer) => void;
  setCanvasTool: (tool: CanvasTool) => void;
  setSubstrateMask: (mask: SubstrateMask, cornerRadius?: number) => void;
  setZoom: (zoom: number | ((prev: number) => number)) => void;
  setPan: (pan: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => void;
  setSplitPosition: (pos: number) => void;
  setIsProcessing: (processing: boolean) => void;
  setErrorMessage: (msg: string | null) => void;
  resetViewport: () => void;
  fitToViewport: (containerW: number, containerH: number) => void;
  setDpi: (dpi: number) => void;
  clearImage: () => void;
}

export const useImageStore = create<ImageState>((set, get) => ({
  originalFile: null,
  originalBuffer: null,
  originalBitmap: null,
  metadata: null,

  sourcePreviewBuffer: null,
  sourcePreviewDimensions: null,
  previewBuffer: null,
  previewProcessedBuffer: null,
  depthHeightMapBuffer: null,
  previewDimensions: null,
  previewVersion: 0,

  canvasTool: 'pan',
  substrateMask: 'none',
  substrateCornerRadius: 5,
  zoom: 1.0,
  pan: { x: 0, y: 0 },
  isDragging: false,
  splitPosition: 0.5,

  isLoading: false,
  isProcessing: false,
  processingDurationMs: 0,
  errorMessage: null,

  setImage: (file, buffer, bitmap, metadata, previewBuffer, previewDims, preserveViewport) =>
    set((state) => {
      // By default preserve viewport if dimensions already exist or preserveViewport is true
      const shouldPreserve = preserveViewport ?? (state.previewDimensions !== null);
      return {
        originalFile: file,
        originalBuffer: buffer,
        originalBitmap: bitmap,
        metadata,
        sourcePreviewBuffer: previewBuffer,
        sourcePreviewDimensions: previewDims,
        previewBuffer,
        previewProcessedBuffer: previewBuffer.slice(0),
        previewDimensions: previewDims,
        previewVersion: state.previewVersion + 1,
        zoom: shouldPreserve ? state.zoom : 1.0,
        pan: shouldPreserve ? state.pan : { x: 0, y: 0 },
        isLoading: false,
        errorMessage: null,
      };
    }),

  applyCrop: (rect) =>
    set((state) => {
      const source = state.sourcePreviewBuffer;
      const sourceDims = state.sourcePreviewDimensions;
      if (!source || !sourceDims) return {};
      const cropped = rect
        ? cropRgba(source, sourceDims.width, sourceDims.height, rect)
        : { buffer: source, width: sourceDims.width, height: sourceDims.height };
      return {
        previewBuffer: cropped.buffer,
        previewProcessedBuffer: cropped.buffer.slice(0),
        previewDimensions: { width: cropped.width, height: cropped.height, scale: sourceDims.scale },
        previewVersion: state.previewVersion + 1,
      };
    }),

  setProcessedPreview: (buffer, durationMs) =>
    set((state) => ({
      previewProcessedBuffer: buffer,
      previewVersion: state.previewVersion + 1,
      isProcessing: false,
      processingDurationMs: durationMs,
    })),

  setDepthHeightMapBuffer: (depthHeightMapBuffer) =>
    set({ depthHeightMapBuffer }),

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

  setSplitPosition: (splitPosition) =>
    set({ splitPosition: Math.min(Math.max(splitPosition, 0), 1) }),

  setIsProcessing: (isProcessing) => set({ isProcessing }),
  setErrorMessage: (errorMessage) => set({ errorMessage, isLoading: false, isProcessing: false }),

  resetViewport: () => set({ zoom: 1.0, pan: { x: 0, y: 0 } }),

  fitToViewport: (containerW, containerH) => {
    const dims = get().previewDimensions;
    if (!dims || containerW <= 0 || containerH <= 0) return;
    const padding = 40;
    const scaleX = (containerW - padding) / dims.width;
    const scaleY = (containerH - padding) / dims.height;
    const fitScale = Math.min(scaleX, scaleY, 1.0);
    set({ zoom: Math.max(0.05, fitScale), pan: { x: 0, y: 0 } });
  },

  setDpi: (dpi) =>
    set((state) => (state.metadata ? { metadata: { ...state.metadata, dpi } } : {})),

  clearImage: () =>
    set({
      originalFile: null,
      originalBuffer: null,
      originalBitmap: null,
      metadata: null,
      sourcePreviewBuffer: null,
      sourcePreviewDimensions: null,
      previewBuffer: null,
      previewProcessedBuffer: null,
      depthHeightMapBuffer: null,
      previewDimensions: null,
      zoom: 1.0,
      pan: { x: 0, y: 0 },
      isLoading: false,
      isProcessing: false,
      errorMessage: null,
    }),
}));
