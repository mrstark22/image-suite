import { create } from 'zustand';
import type { ImageMetadata, PreviewDimensions } from '../types/image';

interface ImageState {
  // Loaded Original Image
  originalFile: File | null;
  originalBuffer: ArrayBuffer | null;
  originalBitmap: ImageBitmap | null;
  metadata: ImageMetadata | null;

  // Dual-Resolution Preview Bitmap & Buffer
  previewBuffer: ArrayBuffer | null;
  previewProcessedBuffer: ArrayBuffer | null;
  depthHeightMapBuffer: ArrayBuffer | null;
  previewDimensions: PreviewDimensions | null;
  previewVersion: number;

  // Viewport & Interaction
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
    previewDims: PreviewDimensions
  ) => void;
  setProcessedPreview: (buffer: ArrayBuffer, durationMs: number) => void;
  setDepthHeightMapBuffer: (buffer: ArrayBuffer) => void;
  setZoom: (zoom: number | ((prev: number) => number)) => void;
  setPan: (pan: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => void;
  setSplitPosition: (pos: number) => void;
  setIsProcessing: (processing: boolean) => void;
  setErrorMessage: (msg: string | null) => void;
  resetViewport: () => void;
  clearImage: () => void;
}

export const useImageStore = create<ImageState>((set) => ({
  originalFile: null,
  originalBuffer: null,
  originalBitmap: null,
  metadata: null,

  previewBuffer: null,
  previewProcessedBuffer: null,
  depthHeightMapBuffer: null,
  previewDimensions: null,
  previewVersion: 0,

  zoom: 1.0,
  pan: { x: 0, y: 0 },
  isDragging: false,
  splitPosition: 0.5,

  isLoading: false,
  isProcessing: false,
  processingDurationMs: 0,
  errorMessage: null,

  setImage: (file, buffer, bitmap, metadata, previewBuffer, previewDims) =>
    set({
      originalFile: file,
      originalBuffer: buffer,
      originalBitmap: bitmap,
      metadata,
      previewBuffer,
      previewProcessedBuffer: previewBuffer.slice(0),
      previewDimensions: previewDims,
      previewVersion: 1,
      zoom: 1.0,
      pan: { x: 0, y: 0 },
      isLoading: false,
      errorMessage: null,
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

  clearImage: () =>
    set({
      originalFile: null,
      originalBuffer: null,
      originalBitmap: null,
      metadata: null,
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
