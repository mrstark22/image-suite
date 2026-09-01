import { describe, it, expect, beforeEach } from 'vitest';
import { useEditStore, DEFAULT_TONAL, DEFAULT_VECTOR } from '../../src/store/editStore';
import { useLayerStore } from '../../src/store/layerStore';
import { useImageStore } from '../../src/store/imageStore';
import type { VectorResult } from '../../src/types/vector';

describe('Undo / Redo History System', () => {
  beforeEach(() => {
    useEditStore.setState({
      tonal: { ...DEFAULT_TONAL },
      vector: { ...DEFAULT_VECTOR },
      vectorResult: null,
      autoTrace: true,
      undoStack: [],
      redoStack: [],
      isAdjusting: false,
      adjustmentBaseline: null,
    });
  });

  it('captures interaction baseline on beginAdjustment and commits to undo stack', () => {
    const store = useEditStore.getState();
    expect(store.canUndo()).toBe(false);

    // User starts dragging a slider
    store.beginAdjustment();
    store.setTonal({ brightness: 35 });
    // User releases mouse/touch
    store.commitAdjustment();

    expect(useEditStore.getState().tonal.brightness).toBe(35);
    expect(useEditStore.getState().canUndo()).toBe(true);

    // Undo reverts to baseline (brightness: 0)
    useEditStore.getState().undo();
    expect(useEditStore.getState().tonal.brightness).toBe(0);
    expect(useEditStore.getState().canRedo()).toBe(true);

    // Redo re-applies brightness: 35
    useEditStore.getState().redo();
    expect(useEditStore.getState().tonal.brightness).toBe(35);
  });

  it('handles multiple sequential adjustments with accurate multi-step undo/redo', () => {
    const store = useEditStore.getState();

    // Step 1: Contrast
    store.beginAdjustment();
    store.setTonal({ contrast: 20 });
    store.commitAdjustment();

    // Step 2: Exposure
    store.beginAdjustment();
    store.setTonal({ exposure: 1.5 });
    store.commitAdjustment();

    // Step 3: Clarity
    store.beginAdjustment();
    store.setTonal({ clarity: 40 });
    store.commitAdjustment();

    expect(useEditStore.getState().undoStack.length).toBe(3);

    // Undo step 3
    useEditStore.getState().undo();
    expect(useEditStore.getState().tonal.clarity).toBe(0);
    expect(useEditStore.getState().tonal.exposure).toBe(1.5);

    // Undo step 2
    useEditStore.getState().undo();
    expect(useEditStore.getState().tonal.exposure).toBe(0);
    expect(useEditStore.getState().tonal.contrast).toBe(20);

    // Undo step 1
    useEditStore.getState().undo();
    expect(useEditStore.getState().tonal.contrast).toBe(0);
    expect(useEditStore.getState().canUndo()).toBe(false);

    // Redo step 1 & 2
    useEditStore.getState().redo();
    expect(useEditStore.getState().tonal.contrast).toBe(20);
    useEditStore.getState().redo();
    expect(useEditStore.getState().tonal.exposure).toBe(1.5);
  });
});

describe('Vector Workflow & Clearing Engine', () => {
  const mockVectorResult: VectorResult = {
    totalPaths: 2,
    totalNodes: 8,
    svgString: '<svg></svg>',
    dimensions: { width: 200, height: 200 },
    layers: [
      {
        id: 'vlayer-1',
        name: 'Layer 1',
        color: '#ff0000',
        visible: true,
        totalNodes: 4,
        paths: [
          {
            id: 'p1',
            color: '#ff0000',
            svgPathData: 'M 0 0 L 10 10',
            isClosed: true,
            nodeCount: 4,
            segments: [{ type: 'M', points: [{ x: 0, y: 0 }] }, { type: 'L', points: [{ x: 10, y: 10 }] }],
          },
        ],
      },
      {
        id: 'vlayer-2',
        name: 'Layer 2',
        color: '#00ff00',
        visible: true,
        totalNodes: 4,
        paths: [
          {
            id: 'p2',
            color: '#00ff00',
            svgPathData: 'M 20 20 L 30 30',
            isClosed: true,
            nodeCount: 4,
            segments: [{ type: 'M', points: [{ x: 20, y: 20 }] }, { type: 'L', points: [{ x: 30, y: 30 }] }],
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    useEditStore.setState({
      vector: { ...DEFAULT_VECTOR },
      vectorResult: mockVectorResult,
      autoTrace: true,
      undoStack: [],
      redoStack: [],
    });
  });

  it('allows clearing vectors completely and setting autoTrace to false', () => {
    expect(useEditStore.getState().vectorResult).not.toBeNull();

    useEditStore.getState().clearVectors();

    expect(useEditStore.getState().vectorResult).toBeNull();
    expect(useEditStore.getState().autoTrace).toBe(false);
    expect(useEditStore.getState().canUndo()).toBe(true);

    // Undo restores vector state
    useEditStore.getState().undo();
    expect(useEditStore.getState().vectorResult).not.toBeNull();
  });

  it('allows removing individual vector layers/groups', () => {
    useEditStore.getState().removeVectorLayer('vlayer-1');

    const vr = useEditStore.getState().vectorResult;
    expect(vr).not.toBeNull();
    expect(vr?.layers.length).toBe(1);
    expect(vr?.layers[0].id).toBe('vlayer-2');
    expect(vr?.totalPaths).toBe(1);
  });

  it('toggles vector layer visibility', () => {
    useEditStore.getState().toggleVectorLayer('vlayer-1');
    expect(useEditStore.getState().vectorResult?.layers[0].visible).toBe(false);

    useEditStore.getState().toggleVectorLayer('vlayer-1');
    expect(useEditStore.getState().vectorResult?.layers[0].visible).toBe(true);
  });
});

describe('Multi-Image Layer Management Store', () => {
  beforeEach(() => {
    useLayerStore.setState({
      layers: [],
      activeLayerId: null,
    });
    useImageStore.setState({
      zoom: 2.5,
      pan: { x: 50, y: -30 },
      previewDimensions: { width: 100, height: 100, scale: 1 },
    });
  });

  it('adds layers, sets transforms, and manages layer stack', () => {
    const dummyBuffer = new ArrayBuffer(16);
    const id1 = useLayerStore.getState().addLayerFromLoadedImage(
      new File([], 'background.png'),
      dummyBuffer,
      null as any,
      { name: 'background.png', width: 100, height: 100, dpi: 300, aspectRatio: 1, originalSizeBytes: 100, format: 'png', hasAlpha: false },
      dummyBuffer,
      { width: 100, height: 100, scale: 1 }
    );

    const id2 = useLayerStore.getState().addLayerFromLoadedImage(
      new File([], 'logo.png'),
      dummyBuffer,
      null as any,
      { name: 'logo.png', width: 50, height: 50, dpi: 300, aspectRatio: 1, originalSizeBytes: 50, format: 'png', hasAlpha: true },
      dummyBuffer,
      { width: 50, height: 50, scale: 1 }
    );

    expect(useLayerStore.getState().layers.length).toBe(2);
    expect(useLayerStore.getState().activeLayerId).toBe(id2);

    // Adjust layer opacity and blend mode
    useLayerStore.getState().setLayerOpacity(id2, 0.75);
    useLayerStore.getState().setLayerBlendMode(id2, 'multiply');
    useLayerStore.getState().setLayerTransform(id2, { x: 10, y: 15, scale: 1.2 });

    const layer2 = useLayerStore.getState().layers.find((l) => l.id === id2);
    expect(layer2?.opacity).toBe(0.75);
    expect(layer2?.blendMode).toBe('multiply');
    expect(layer2?.transform.x).toBe(10);
    expect(layer2?.transform.y).toBe(15);
    expect(layer2?.transform.scale).toBe(1.2);

    // Move layer down
    useLayerStore.getState().moveLayerDown(id2);
    expect(useLayerStore.getState().layers[1].id).toBe(id2);

    // Duplicate layer
    useLayerStore.getState().duplicateLayer(id2);
    expect(useLayerStore.getState().layers.length).toBe(3);

    // Move layer back up to top (index 0)
    const topId = useLayerStore.getState().layers[1].id;
    useLayerStore.getState().moveLayerUp(topId);
    expect(useLayerStore.getState().layers[0].id).toBe(topId);

    // Remove layer
    useLayerStore.getState().removeLayer(id1);
    expect(useLayerStore.getState().layers.length).toBe(2);

    // Clear all layers
    useLayerStore.getState().clearAllLayers();
    expect(useLayerStore.getState().layers.length).toBe(0);
    expect(useLayerStore.getState().activeLayerId).toBeNull();
  });

  it('preserves user zoom and pan during layer visibility toggles and updates', () => {
    const dummyBuffer = new ArrayBuffer(16);
    useImageStore.setState({ zoom: 3.4, pan: { x: 120, y: -45 } });

    const id = useLayerStore.getState().addLayerFromLoadedImage(
      new File([], 'layer1.png'),
      dummyBuffer,
      null as any,
      { name: 'layer1.png', width: 200, height: 200, dpi: 300, aspectRatio: 1, originalSizeBytes: 100, format: 'png', hasAlpha: false },
      dummyBuffer,
      { width: 200, height: 200, scale: 1 }
    );

    // Toggle layer visibility
    useLayerStore.getState().setLayerVisibility(id, false);
    expect(useImageStore.getState().zoom).toBe(3.4);
    expect(useImageStore.getState().pan).toEqual({ x: 120, y: -45 });

    useLayerStore.getState().setLayerVisibility(id, true);
    expect(useImageStore.getState().zoom).toBe(3.4);
    expect(useImageStore.getState().pan).toEqual({ x: 120, y: -45 });
  });

  it('creates empty blank layers and cycles active layers', () => {
    const blankId1 = useLayerStore.getState().createEmptyLayer('Blank 1', 500, 500);
    const blankId2 = useLayerStore.getState().createEmptyLayer('Blank 2', 500, 500);

    expect(useLayerStore.getState().layers.length).toBe(2);
    expect(useLayerStore.getState().activeLayerId).toBe(blankId2);

    // Cycle layer
    useLayerStore.getState().cycleActiveLayer('next');
    expect(useLayerStore.getState().activeLayerId).toBe(blankId1);
  });

  it('supports per-layer tonal adjustments and merging layers', async () => {
    const dummyBuffer = new ArrayBuffer(16);
    useLayerStore.getState().addLayerFromLoadedImage(
      new File([], 'bottom.png'),
      dummyBuffer,
      null as any,
      { name: 'bottom.png', width: 100, height: 100, dpi: 300, aspectRatio: 1, originalSizeBytes: 100, format: 'png', hasAlpha: false },
      dummyBuffer,
      { width: 100, height: 100, scale: 1 }
    );

    const tId = useLayerStore.getState().addLayerFromLoadedImage(
      new File([], 'top.png'),
      dummyBuffer,
      null as any,
      { name: 'top.png', width: 100, height: 100, dpi: 300, aspectRatio: 1, originalSizeBytes: 100, format: 'png', hasAlpha: true },
      dummyBuffer,
      { width: 100, height: 100, scale: 1 }
    );

    // Set per-layer tonal adjustments
    useLayerStore.getState().setLayerTonal(tId, { brightness: 50, contrast: 25 });
    const topLayer = useLayerStore.getState().layers.find((l) => l.id === tId);
    expect(topLayer?.tonal?.brightness).toBe(50);
    expect(topLayer?.tonal?.contrast).toBe(25);

    // Merge Down
    await useLayerStore.getState().mergeLayerDown(tId);
    expect(useLayerStore.getState().layers.length).toBe(1);
    expect(useLayerStore.getState().layers[0].name).toContain('bottom');
  });

  it('updates composite preview when moving a single layer', async () => {
    const dummyBuffer = new ArrayBuffer(100 * 100 * 4);
    const id = useLayerStore.getState().addLayerFromLoadedImage(
      new File([], 'photo.png'),
      dummyBuffer,
      null as any,
      { name: 'photo.png', width: 100, height: 100, dpi: 300, aspectRatio: 1, originalSizeBytes: 100, format: 'png', hasAlpha: false },
      dummyBuffer,
      { width: 100, height: 100, scale: 1 }
    );

    // Initial position
    expect(useLayerStore.getState().layers[0].transform.x).toBe(0);

    // Move layer
    useLayerStore.getState().setLayerTransform(id, { x: -150, y: 50 });
    expect(useLayerStore.getState().layers[0].transform.x).toBe(-150);
    expect(useLayerStore.getState().layers[0].transform.y).toBe(50);
  });

  it('resizes canvas dimensions and adjusts resolution DPI', async () => {
    const dummyBuffer = new ArrayBuffer(200 * 200 * 4);
    useLayerStore.getState().addLayerFromLoadedImage(
      new File([], 'base.png'),
      dummyBuffer,
      null as any,
      { name: 'base.png', width: 200, height: 200, dpi: 300, aspectRatio: 1, originalSizeBytes: 100, format: 'png', hasAlpha: false },
      dummyBuffer,
      { width: 200, height: 200, scale: 1 }
    );

    await useLayerStore.getState().setCanvasDimensions(400, 300, 254, 'canvas-resize');

    const updatedDims = useImageStore.getState().previewDimensions;
    const updatedMeta = useImageStore.getState().metadata;

    expect(updatedDims?.width).toBe(400);
    expect(updatedDims?.height).toBe(300);
    expect(updatedMeta?.dpi).toBe(254);
  });

  it('aligns active layer to center, left, right, top, bottom', () => {
    const dummyBuffer = new ArrayBuffer(100 * 100 * 4);
    useLayerStore.getState().addLayerFromLoadedImage(
      new File([], 'box.png'),
      dummyBuffer,
      null as any,
      { name: 'box.png', width: 100, height: 100, dpi: 300, aspectRatio: 1, originalSizeBytes: 100, format: 'png', hasAlpha: false },
      dummyBuffer,
      { width: 100, height: 100, scale: 1 }
    );
    useImageStore.setState({ previewDimensions: { width: 500, height: 500, scale: 1 } });

    useLayerStore.getState().alignActiveLayer('left');
    expect(useLayerStore.getState().layers[0].transform.x).toBe(-200);

    useLayerStore.getState().alignActiveLayer('right');
    expect(useLayerStore.getState().layers[0].transform.x).toBe(200);

    useLayerStore.getState().alignActiveLayer('center');
    expect(useLayerStore.getState().layers[0].transform.x).toBe(0);
    expect(useLayerStore.getState().layers[0].transform.y).toBe(0);
  });

  it('generates laser contour cutline with offset', () => {
    // 50x50 test image with centered 20x20 foreground box
    const w = 50, h = 50;
    const buf = new ArrayBuffer(w * h * 4);
    const data = new Uint8ClampedArray(buf);
    for (let y = 15; y < 35; y++) {
      for (let x = 15; x < 35; x++) {
        const idx = (y * w + x) * 4;
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 255;
      }
    }

    useLayerStore.setState({
      layers: [{
        id: 'cut-test-layer',
        name: 'Cut Test',
        type: 'image',
        visible: true,
        locked: false,
        opacity: 1.0,
        blendMode: 'source-over',
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        previewBuffer: buf,
        previewDims: { width: w, height: h, scale: 1 },
        metadata: { name: 'Cut Test', width: w, height: h, dpi: 300, aspectRatio: 1, originalSizeBytes: 0, format: 'png', hasAlpha: true },
      }],
      activeLayerId: 'cut-test-layer',
    });
    useEditStore.setState({ vectorResult: null });

    useEditStore.getState().generateCutline(1.0, 2);
    const vr = useEditStore.getState().vectorResult;
    expect(vr).not.toBeNull();
    expect(vr?.layers.length).toBe(1);
    expect(vr?.layers[0].color).toBe('#ff0000');
    expect(vr?.layers[0].paths.length).toBeGreaterThanOrEqual(1);
  });

  it('crops canvas dimensions and shifts layer transforms accurately', async () => {
    useImageStore.setState({ previewDimensions: { width: 1000, height: 800, scale: 1 } });
    useLayerStore.setState({
      layers: [{
        id: 'layer-crop-1',
        name: 'Layer 1',
        type: 'image',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'source-over',
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        previewBuffer: new ArrayBuffer(100),
        previewDims: { width: 1000, height: 800, scale: 1 },
      }],
      activeLayerId: 'layer-crop-1',
    });

    // Crop box at x=100, y=100, w=400, h=300
    // Old center: (500, 400). New center: (100 + 200, 100 + 150) = (300, 250).
    // deltaX = 500 - 300 = 200, deltaY = 400 - 250 = 150.
    await useLayerStore.getState().applyCanvasCrop({ x: 100, y: 100, width: 400, height: 300 });

    expect(useImageStore.getState().previewDimensions?.width).toBe(400);
    expect(useImageStore.getState().previewDimensions?.height).toBe(300);
    expect(useLayerStore.getState().layers[0].transform.x).toBe(200);
    expect(useLayerStore.getState().layers[0].transform.y).toBe(150);
  });

  it('smooths vector results and reduces machine nodes', () => {
    const rawResult: VectorResult = {
      totalPaths: 1,
      totalNodes: 10,
      svgString: '',
      dimensions: { width: 100, height: 100 },
      layers: [{
        id: 'l1',
        name: 'Layer 1',
        color: '#000',
        visible: true,
        totalNodes: 10,
        paths: [{
          id: 'p1',
          color: '#000',
          isClosed: true,
          nodeCount: 10,
          svgPathData: 'M 0 0 L 10 20 L 20 35 L 30 45 L 40 50 L 50 45 L 60 35 L 70 20 L 80 0 Z',
          segments: [
            { type: 'M', points: [{ x: 0, y: 0 }] },
            { type: 'L', points: [{ x: 10, y: 20 }] },
            { type: 'L', points: [{ x: 20, y: 35 }] },
            { type: 'L', points: [{ x: 30, y: 45 }] },
            { type: 'L', points: [{ x: 40, y: 50 }] },
            { type: 'L', points: [{ x: 50, y: 45 }] },
            { type: 'L', points: [{ x: 60, y: 35 }] },
            { type: 'L', points: [{ x: 70, y: 20 }] },
            { type: 'L', points: [{ x: 80, y: 0 }] },
            { type: 'Z', points: [] },
          ],
        }],
      }],
    };

    useEditStore.setState({ vectorResult: rawResult });
    useEditStore.getState().smoothVectors(2.0, true);

    const smoothed = useEditStore.getState().vectorResult;
    expect(smoothed).not.toBeNull();
    expect(smoothed!.totalNodes).toBeLessThan(10);
    expect(smoothed!.layers[0].paths[0].svgPathData).toContain('C');
  });
});
