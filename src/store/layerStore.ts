import { create } from 'zustand';
import type { CanvasLayer, LayerBlendMode, LayerTransform } from '../types/layer';
import type { TonalAdjustments, ColorAdjustments, DetailEnhancements } from '../types/image';
import type { DitherConfig } from '../types/dither';
import { loadImageFromFile } from '../lib/image-loader';
import { compositeLayers, createBlankLayerBuffer } from '../lib/compositor';
import { renderTextToBuffer, type TextLayerConfig } from '../lib/text-layer';
import { useImageStore } from './imageStore';
import { useEditStore } from './editStore';

interface LayerState {
  layers: CanvasLayer[];
  activeLayerId: string | null;

  // Layer Creation & Import
  addLayerFromLoadedImage: (
    file: File,
    buffer: ArrayBuffer,
    bitmap: ImageBitmap,
    metadata: any,
    previewBuffer: ArrayBuffer,
    previewDims: any
  ) => string;
  importImageFiles: (files: File[]) => Promise<void>;
  createEmptyLayer: (name?: string, width?: number, height?: number, fillColor?: string) => string;
  createTextLayer: (config: TextLayerConfig) => Promise<string>;

  // Layer Hierarchy & Modification
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  mergeLayerDown: (id: string) => Promise<void>;
  flattenAllLayers: () => Promise<void>;
  reorderLayers: (fromIndex: number, toIndex: number) => void;
  moveLayerUp: (id: string) => void;
  moveLayerDown: (id: string) => void;
  cycleActiveLayer: (direction: 'next' | 'prev') => void;

  // Layer Properties
  setLayerVisibility: (id: string, visible: boolean) => void;
  setLayerLocked: (id: string, locked: boolean) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  setLayerBlendMode: (id: string, blendMode: LayerBlendMode) => void;
  setLayerTransform: (id: string, transform: Partial<LayerTransform>) => void;
  alignActiveLayer: (
    alignment: 'center' | 'center-h' | 'center-v' | 'top' | 'bottom' | 'left' | 'right'
  ) => void;
  setLayerName: (id: string, name: string) => void;
  setActiveLayer: (id: string | null) => void;

  // Per-Layer Adjustments
  setLayerTonal: (id: string, tonal: Partial<TonalAdjustments>) => void;
  setLayerColor: (id: string, color: Partial<ColorAdjustments>) => void;
  setLayerDetail: (id: string, detail: Partial<DetailEnhancements>) => void;
  setLayerDither: (id: string, dither: Partial<DitherConfig>) => void;

  // Reset & Composition
  clearAllLayers: () => void;
  setCanvasDimensions: (
    width: number,
    height: number,
    dpi: number,
    mode?: 'canvas-resize' | 'image-scale'
  ) => Promise<void>;
  applyCanvasCrop: (cropBox: { x: number; y: number; width: number; height: number }) => Promise<void>;
  updateCompositePreview: () => Promise<void>;
}

export const useLayerStore = create<LayerState>((set, get) => ({
  layers: [],
  activeLayerId: null,

  addLayerFromLoadedImage: (
    file,
    buffer,
    bitmap,
    metadata,
    previewBuffer,
    previewDims
  ) => {
    useEditStore.getState().recordHistorySnapshot();

    const layerId = `layer-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const newLayer: CanvasLayer = {
      id: layerId,
      name: file.name.replace(/\.[^/.]+$/, ''),
      type: 'image',
      visible: true,
      locked: false,
      opacity: 1.0,
      blendMode: 'source-over',
      transform: { x: 0, y: 0, scale: 1.0, rotation: 0 },
      file,
      originalBuffer: buffer,
      originalBitmap: bitmap,
      previewBuffer,
      previewProcessedBuffer: previewBuffer.slice(0),
      metadata,
      previewDims,
    };

    set((state) => ({
      layers: [newLayer, ...state.layers],
      activeLayerId: layerId,
    }));

    get().updateCompositePreview();
    return layerId;
  },

  importImageFiles: async (files: File[]) => {
    if (!files || files.length === 0) return;
    useEditStore.getState().recordHistorySnapshot();

    const loadedLayers: CanvasLayer[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const result = await loadImageFromFile(file);
        const layerId = `layer-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`;
        loadedLayers.push({
          id: layerId,
          name: file.name.replace(/\.[^/.]+$/, ''),
          type: 'image',
          visible: true,
          locked: false,
          opacity: 1.0,
          blendMode: 'source-over',
          transform: { x: 0, y: 0, scale: 1.0, rotation: 0 },
          file,
          originalBuffer: result.originalBuffer,
          originalBitmap: result.bitmap,
          previewBuffer: result.previewBuffer,
          previewProcessedBuffer: result.previewBuffer.slice(0),
          metadata: result.metadata,
          previewDims: result.previewDims,
        });
      } catch (err) {
        console.error('Failed to load layer file:', file.name, err);
      }
    }

    if (loadedLayers.length > 0) {
      set((state) => ({
        layers: [...loadedLayers, ...state.layers],
        activeLayerId: loadedLayers[0].id,
      }));

      await get().updateCompositePreview();
    }
  },

  createEmptyLayer: (name, width, height, fillColor = 'transparent') => {
    useEditStore.getState().recordHistorySnapshot();

    // Default dimensions from existing layers or standard 1024x1024
    const existing = get().layers.find((l) => l.previewDims);
    const layerW = width || existing?.previewDims?.width || 1024;
    const layerH = height || existing?.previewDims?.height || 1024;

    const layerId = `layer-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const buffer = createBlankLayerBuffer(layerW, layerH, fillColor);

    const emptyLayer: CanvasLayer = {
      id: layerId,
      name: name || `Layer ${get().layers.length + 1}`,
      type: 'empty',
      visible: true,
      locked: false,
      opacity: 1.0,
      blendMode: 'source-over',
      transform: { x: 0, y: 0, scale: 1.0, rotation: 0 },
      previewBuffer: buffer,
      previewProcessedBuffer: buffer.slice(0),
      previewDims: { width: layerW, height: layerH, scale: 1.0 },
      metadata: {
        name: name || `Layer ${get().layers.length + 1}`,
        width: layerW,
        height: layerH,
        dpi: 300,
        aspectRatio: layerW / layerH,
        originalSizeBytes: buffer.byteLength,
        format: 'image/png',
        hasAlpha: true,
      },
    };

    set((state) => ({
      layers: [emptyLayer, ...state.layers],
      activeLayerId: layerId,
    }));

    get().updateCompositePreview();
    return layerId;
  },

  createTextLayer: async (config: TextLayerConfig) => {
    useEditStore.getState().recordHistorySnapshot();

    const { buffer, width, height } = renderTextToBuffer(config);
    const layerId = `layer-text-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const layerName = `Text: ${config.text.split('\n')[0].substring(0, 16)}`;

    const textLayer: CanvasLayer = {
      id: layerId,
      name: layerName,
      type: 'text',
      visible: true,
      locked: false,
      opacity: 1.0,
      blendMode: 'source-over',
      transform: { x: 0, y: 0, scale: 1.0, rotation: 0 },
      previewBuffer: buffer,
      previewProcessedBuffer: buffer.slice(0),
      previewDims: { width, height, scale: 1.0 },
      metadata: {
        name: layerName,
        width,
        height,
        dpi: config.dpi || 300,
        aspectRatio: width / height,
        originalSizeBytes: buffer.byteLength,
        format: 'image/png',
        hasAlpha: true,
      },
    };

    set((state) => ({
      layers: [textLayer, ...state.layers],
      activeLayerId: layerId,
    }));

    await get().updateCompositePreview();
    return layerId;
  },

  removeLayer: (id: string) => {
    useEditStore.getState().recordHistorySnapshot();
    const remaining = get().layers.filter((l) => l.id !== id);
    const active = get().activeLayerId === id
      ? (remaining[0]?.id || null)
      : get().activeLayerId;

    set({ layers: remaining, activeLayerId: active });

    if (remaining.length === 0) {
      useImageStore.getState().clearImage();
    } else {
      get().updateCompositePreview();
    }
  },

  duplicateLayer: (id: string) => {
    const layer = get().layers.find((l) => l.id === id);
    if (!layer) return;
    useEditStore.getState().recordHistorySnapshot();

    const newId = `layer-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const copy: CanvasLayer = {
      ...layer,
      id: newId,
      name: `${layer.name} (Copy)`,
      transform: { ...layer.transform, x: layer.transform.x + 20, y: layer.transform.y + 20 },
      previewBuffer: layer.previewBuffer ? layer.previewBuffer.slice(0) : undefined,
    };

    const index = get().layers.findIndex((l) => l.id === id);
    const newLayers = [...get().layers];
    newLayers.splice(index, 0, copy);

    set({ layers: newLayers, activeLayerId: newId });
    get().updateCompositePreview();
  },

  mergeLayerDown: async (id: string) => {
    const layers = get().layers;
    const index = layers.findIndex((l) => l.id === id);
    if (index < 0 || index >= layers.length - 1) return; // Cannot merge bottom layer down

    useEditStore.getState().recordHistorySnapshot();
    const topLayer = layers[index];
    const bottomLayer = layers[index + 1];

    const baseDims = bottomLayer.previewDims || topLayer.previewDims;
    if (!baseDims) return;

    try {
      const mergedBuffer = await compositeLayers(
        [topLayer, bottomLayer],
        baseDims.width,
        baseDims.height
      );

      const mergedLayer: CanvasLayer = {
        ...bottomLayer,
        name: `${bottomLayer.name} + ${topLayer.name}`,
        previewBuffer: mergedBuffer,
        previewProcessedBuffer: mergedBuffer.slice(0),
        originalBitmap: undefined, // Draw from composite buffer
        transform: { x: 0, y: 0, scale: 1.0, rotation: 0 },
        opacity: 1.0,
        blendMode: 'source-over',
      };

      const updatedLayers = [...layers];
      updatedLayers.splice(index, 2, mergedLayer);

      set({ layers: updatedLayers, activeLayerId: mergedLayer.id });
      await get().updateCompositePreview();
    } catch (err) {
      console.error('Merge down failed:', err);
    }
  },

  flattenAllLayers: async () => {
    const layers = get().layers;
    if (layers.length <= 1) return;

    useEditStore.getState().recordHistorySnapshot();
    const baseDims = layers[layers.length - 1]?.previewDims || layers[0]?.previewDims;
    if (!baseDims) return;

    try {
      const flattenedBuffer = await compositeLayers(layers, baseDims.width, baseDims.height);
      const flattenedLayer: CanvasLayer = {
        id: `layer-${Date.now()}-flattened`,
        name: 'Flattened Image',
        type: 'image',
        visible: true,
        locked: false,
        opacity: 1.0,
        blendMode: 'source-over',
        transform: { x: 0, y: 0, scale: 1.0, rotation: 0 },
        previewBuffer: flattenedBuffer,
        previewProcessedBuffer: flattenedBuffer.slice(0),
        previewDims: baseDims,
        metadata: {
          name: 'Flattened Image',
          width: baseDims.width,
          height: baseDims.height,
          dpi: 300,
          aspectRatio: baseDims.width / baseDims.height,
          originalSizeBytes: flattenedBuffer.byteLength,
          format: 'image/png',
          hasAlpha: true,
        },
      };

      set({ layers: [flattenedLayer], activeLayerId: flattenedLayer.id });
      await get().updateCompositePreview();
    } catch (err) {
      console.error('Flatten failed:', err);
    }
  },

  reorderLayers: (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    useEditStore.getState().recordHistorySnapshot();

    const newLayers = [...get().layers];
    const [moved] = newLayers.splice(fromIndex, 1);
    newLayers.splice(toIndex, 0, moved);

    set({ layers: newLayers });
    get().updateCompositePreview();
  },

  moveLayerUp: (id: string) => {
    const index = get().layers.findIndex((l) => l.id === id);
    if (index > 0) {
      get().reorderLayers(index, index - 1);
    }
  },

  moveLayerDown: (id: string) => {
    const index = get().layers.findIndex((l) => l.id === id);
    if (index >= 0 && index < get().layers.length - 1) {
      get().reorderLayers(index, index + 1);
    }
  },

  cycleActiveLayer: (direction) => {
    const { layers, activeLayerId } = get();
    if (layers.length <= 1) return;
    const currentIndex = layers.findIndex((l) => l.id === activeLayerId);
    let nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex >= layers.length) nextIndex = 0;
    if (nextIndex < 0) nextIndex = layers.length - 1;
    set({ activeLayerId: layers[nextIndex].id });
  },

  setLayerVisibility: (id: string, visible: boolean) => {
    useEditStore.getState().recordHistorySnapshot();
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, visible } : l)),
    }));
    get().updateCompositePreview();
  },

  setLayerLocked: (id: string, locked: boolean) => {
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, locked } : l)),
    }));
  },

  setLayerOpacity: (id: string, opacity: number) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, opacity: Math.max(0, Math.min(1, opacity)) } : l
      ),
    }));
    get().updateCompositePreview();
  },

  setLayerBlendMode: (id: string, blendMode: LayerBlendMode) => {
    useEditStore.getState().recordHistorySnapshot();
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, blendMode } : l)),
    }));
    get().updateCompositePreview();
  },

  setLayerTransform: (id: string, transform: Partial<LayerTransform>) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, transform: { ...l.transform, ...transform } } : l
      ),
    }));
    get().updateCompositePreview();
  },

  alignActiveLayer: (alignment) => {
    const { layers, activeLayerId } = get();
    const layer = layers.find((l) => l.id === activeLayerId) || layers[0];
    const dims = useImageStore.getState().previewDimensions;
    if (!layer || !dims) return;

    useEditStore.getState().recordHistorySnapshot();

    const layerW = (layer.previewDims?.width || dims.width) * (layer.transform?.scale ?? 1.0);
    const layerH = (layer.previewDims?.height || dims.height) * (layer.transform?.scale ?? 1.0);

    let newX = layer.transform?.x || 0;
    let newY = layer.transform?.y || 0;

    switch (alignment) {
      case 'center':
        newX = 0;
        newY = 0;
        break;
      case 'center-h':
        newX = 0;
        break;
      case 'center-v':
        newY = 0;
        break;
      case 'left':
        newX = -Math.round((dims.width - layerW) / 2);
        break;
      case 'right':
        newX = Math.round((dims.width - layerW) / 2);
        break;
      case 'top':
        newY = -Math.round((dims.height - layerH) / 2);
        break;
      case 'bottom':
        newY = Math.round((dims.height - layerH) / 2);
        break;
    }

    get().setLayerTransform(layer.id, { x: newX, y: newY });
  },

  setLayerName: (id: string, name: string) => {
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, name } : l)),
    }));
  },

  setActiveLayer: (id: string | null) => set({ activeLayerId: id }),

  setLayerTonal: (id: string, tonal: Partial<TonalAdjustments>) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, tonal: { ...(l.tonal || ({} as any)), ...tonal } } : l
      ),
    }));
    get().updateCompositePreview();
  },

  setLayerColor: (id: string, color: Partial<ColorAdjustments>) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, color: { ...(l.color || ({} as any)), ...color } } : l
      ),
    }));
    get().updateCompositePreview();
  },

  setLayerDetail: (id: string, detail: Partial<DetailEnhancements>) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, detail: { ...(l.detail || ({} as any)), ...detail } } : l
      ),
    }));
    get().updateCompositePreview();
  },

  setLayerDither: (id: string, dither: Partial<DitherConfig>) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, dither: { ...(l.dither || ({} as any)), ...dither } } : l
      ),
    }));
    get().updateCompositePreview();
  },

  clearAllLayers: () => {
    useEditStore.getState().recordHistorySnapshot();
    set({ layers: [], activeLayerId: null });
    useImageStore.getState().clearImage();
  },

  updateCompositePreview: async () => {
    const layers = get().layers;
    if (layers.length === 0) return;

    // Use bottom-most (background) layer dimensions or active layer dimensions
    const baseLayer = layers[layers.length - 1] || layers[0];
    if (!baseLayer || !baseLayer.previewDims) return;

    const { width, height } = baseLayer.previewDims;

    const fallbackMetadata = baseLayer.metadata || {
      name: baseLayer.name || 'Composite',
      width,
      height,
      dpi: 300,
      aspectRatio: width / height,
      originalSizeBytes: 0,
      format: 'image/png',
      hasAlpha: true,
    };

    const l0 = layers[0];
    const isCleanSingleLayer =
      layers.length === 1 &&
      l0.previewBuffer &&
      !l0.tonal &&
      !l0.color &&
      l0.opacity === 1.0 &&
      (!l0.blendMode || l0.blendMode === 'source-over') &&
      (!l0.transform ||
        (l0.transform.x === 0 &&
          l0.transform.y === 0 &&
          l0.transform.scale === 1.0 &&
          l0.transform.rotation === 0));

    if (isCleanSingleLayer) {
      // Fast path only when 1 layer with zero transform, 100% opacity, no blend mode, no adjustments
      useImageStore.getState().setImage(
        l0.file || new File([], l0.name),
        l0.originalBuffer || new ArrayBuffer(0),
        l0.originalBitmap!,
        l0.metadata || fallbackMetadata,
        l0.previewBuffer || new ArrayBuffer(0),
        l0.previewDims!,
        true // Preserve viewport!
      );
      return;
    }

    try {
      const compositeBuf = await compositeLayers(layers, width, height);
      useImageStore.getState().setImage(
        baseLayer.file || new File([], 'Composite'),
        baseLayer.originalBuffer || new ArrayBuffer(0),
        baseLayer.originalBitmap!,
        baseLayer.metadata || fallbackMetadata,
        compositeBuf,
        baseLayer.previewDims,
        true // Preserve viewport!
      );
    } catch (err) {
      console.error('Composite update failed:', err);
    }
  },

  setCanvasDimensions: async (
    width: number,
    height: number,
    dpi: number,
    mode: 'canvas-resize' | 'image-scale' = 'canvas-resize'
  ) => {
    useEditStore.getState().recordHistorySnapshot();

    const { layers } = get();
    const oldDims = useImageStore.getState().previewDimensions || { width, height, scale: 1 };
    const scaleFactorX = width / oldDims.width;
    const scaleFactorY = height / oldDims.height;
    const avgScale = (scaleFactorX + scaleFactorY) / 2;

    if (mode === 'image-scale') {
      // Proportional scale on layers
      set((state) => ({
        layers: state.layers.map((l) => ({
          ...l,
          transform: {
            ...l.transform,
            scale: (l.transform?.scale ?? 1.0) * avgScale,
            x: (l.transform?.x ?? 0) * scaleFactorX,
            y: (l.transform?.y ?? 0) * scaleFactorY,
          },
        })),
      }));
    }

    useImageStore.getState().setCanvasSize(width, height, dpi);

    // Update dimensions on layers
    set((state) => ({
      layers: state.layers.map((l) => ({
        ...l,
        metadata: l.metadata ? { ...l.metadata, dpi } : undefined,
      })),
    }));

    try {
      const compositeBuf = await compositeLayers(get().layers, width, height);
      const currentMeta = useImageStore.getState().metadata;
      const baseLayer = layers[0];

      useImageStore.getState().setImage(
        baseLayer?.file || new File([], 'Composite'),
        baseLayer?.originalBuffer || new ArrayBuffer(0),
        baseLayer?.originalBitmap!,
        currentMeta || {
          name: 'Composite',
          width,
          height,
          dpi,
          aspectRatio: width / height,
          originalSizeBytes: compositeBuf.byteLength,
          format: 'image/png',
          hasAlpha: true,
        },
        compositeBuf,
        { width, height, scale: 1.0 },
        true
      );
    } catch (err) {
      console.error('Failed to resize canvas:', err);
    }
  },

  applyCanvasCrop: async (cropBox) => {
    useEditStore.getState().recordHistorySnapshot();

    const dims = useImageStore.getState().previewDimensions;
    const meta = useImageStore.getState().metadata;
    if (!dims) return;

    const oldW = dims.width;
    const oldH = dims.height;
    const newW = Math.round(cropBox.width);
    const newH = Math.round(cropBox.height);

    if (newW <= 0 || newH <= 0) return;

    // Shift in center:
    const oldCenterX = oldW / 2;
    const oldCenterY = oldH / 2;
    const newCenterX = cropBox.x + cropBox.width / 2;
    const newCenterY = cropBox.y + cropBox.height / 2;

    const deltaX = Math.round(oldCenterX - newCenterX);
    const deltaY = Math.round(oldCenterY - newCenterY);

    // Shift all layers so their content stays in place relative to cropped canvas
    set((state) => ({
      layers: state.layers.map((l) => ({
        ...l,
        transform: {
          ...l.transform,
          x: (l.transform?.x || 0) + deltaX,
          y: (l.transform?.y || 0) + deltaY,
        },
      })),
    }));

    useImageStore.getState().setCanvasTool('move');
    await get().setCanvasDimensions(newW, newH, meta?.dpi || 300, 'canvas-resize');
  },
}));
