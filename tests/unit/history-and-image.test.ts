import { describe, it, expect, beforeEach } from 'vitest';
import {
  useEditStore,
  DEFAULT_TONAL,
  DEFAULT_VECTOR,
  DEFAULT_DITHER,
  DEFAULT_GEOMETRY,
} from '../../src/store/editStore';
import { useImageStore } from '../../src/store/imageStore';
import {
  openLoadedImage,
  openImageFiles,
  hasUnsavedEdits,
  ignoredFilesMessage,
} from '../../src/lib/open-image';
import type { ImageMetadata } from '../../src/types/image';
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

/** Pixel value used to label each source pixel, so a crop can be checked exactly. */
function labelOf(x: number, y: number): [number, number, number] {
  return [x * 7 % 256, y * 11 % 256, (x + y * 3) % 256];
}

/** An RGBA image whose every pixel is labelled with its own coordinates. */
function labelledImage(width: number, height: number): ArrayBuffer {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = labelOf(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data.buffer;
}

function metadataFor(width: number, height: number): ImageMetadata {
  return {
    name: 'test.png',
    width,
    height,
    dpi: 300,
    aspectRatio: width / height,
    originalSizeBytes: width * height * 4,
    format: 'image/png',
    hasAlpha: false,
  };
}

/** Opens a labelled `width` x `height` image as if the user had loaded it. */
function openLabelledImage(width: number, height: number): void {
  const buffer = labelledImage(width, height);
  openLoadedImage({
    file: new File([], 'test.png'),
    originalBuffer: buffer,
    // SAFETY: no store code reads the bitmap; Node has no ImageBitmap to construct.
    bitmap: null as unknown as ImageBitmap,
    metadata: metadataFor(width, height),
    previewBuffer: buffer,
    previewDims: { width, height, scale: 1 },
  });
}

/**
 * Checks that the open preview is exactly the source pixels from (`ox`, `oy`)
 * over `width` x `height`.
 */
function expectPreviewIsSourceRegion(ox: number, oy: number, width: number, height: number): void {
  const { previewBuffer, previewDimensions } = useImageStore.getState();
  expect(previewDimensions?.width).toBe(width);
  expect(previewDimensions?.height).toBe(height);
  const data = new Uint8Array(previewBuffer!);
  let mismatches = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = labelOf(ox + x, oy + y);
      const i = (y * width + x) * 4;
      if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b || data[i + 3] !== 255) {
        mismatches++;
      }
    }
  }
  expect(mismatches).toBe(0);
}

describe('Opening an image', () => {
  beforeEach(() => {
    useImageStore.getState().clearImage();
    useEditStore.getState().startNewImage();
  });

  it('replaces the open image and starts it with default settings and no history', () => {
    openLabelledImage(20, 10);
    const store = useEditStore.getState();
    store.beginAdjustment();
    store.setTonal({ brightness: 40 });
    store.commitAdjustment();
    useEditStore.getState().cropTo({ x: 2, y: 2, width: 5, height: 5 });
    expect(hasUnsavedEdits()).toBe(true);

    openLabelledImage(12, 9);

    expect(useEditStore.getState().tonal).toEqual(DEFAULT_TONAL);
    expect(useEditStore.getState().geometry).toEqual(DEFAULT_GEOMETRY);
    expect(useEditStore.getState().canUndo()).toBe(false);
    expect(useEditStore.getState().canRedo()).toBe(false);
    expect(hasUnsavedEdits()).toBe(false);
    expectPreviewIsSourceRegion(0, 0, 12, 9);
  });

  it('keeps the current image when the user declines to discard edits', async () => {
    openLabelledImage(20, 10);
    useEditStore.getState().cropTo({ x: 1, y: 1, width: 4, height: 4 });

    await openImageFiles([new File([], 'other.png')], () => false);

    expectPreviewIsSourceRegion(1, 1, 4, 4);
    expect(useEditStore.getState().canUndo()).toBe(true);
  });

  it('says how many extra files were not opened', () => {
    expect(ignoredFilesMessage('a.png', 1)).toBe(
      'Opened a.png. This tool works on one image at a time, so the other 1 file was not opened.'
    );
    expect(ignoredFilesMessage('a.png', 3)).toContain('the other 3 files were not opened');
  });
});

describe('Crop', () => {
  beforeEach(() => {
    useImageStore.getState().clearImage();
    useEditStore.getState().startNewImage();
    openLabelledImage(30, 20);
  });

  it('crops the preview to exactly the chosen source pixels', () => {
    useEditStore.getState().cropTo({ x: 4, y: 3, width: 10, height: 7 });
    expectPreviewIsSourceRegion(4, 3, 10, 7);
  });

  it('takes a second crop in the coordinates of the image as currently shown', () => {
    useEditStore.getState().cropTo({ x: 4, y: 3, width: 10, height: 7 });
    useEditStore.getState().cropTo({ x: 2, y: 1, width: 5, height: 4 });
    expectPreviewIsSourceRegion(6, 4, 5, 4);
  });

  it('clips a box that extends past the image shown, and ignores one entirely outside it', () => {
    useEditStore.getState().cropTo({ x: 4, y: 3, width: 10, height: 7 });
    useEditStore.getState().cropTo({ x: 6, y: -2, width: 50, height: 5 });
    expectPreviewIsSourceRegion(10, 3, 4, 3);

    const entries = useEditStore.getState().undoStack.length;
    useEditStore.getState().cropTo({ x: 100, y: 100, width: 5, height: 5 });
    expectPreviewIsSourceRegion(10, 3, 4, 3);
    expect(useEditStore.getState().undoStack.length).toBe(entries);
  });

  it('is kept when other edits follow it (#15)', () => {
    useEditStore.getState().cropTo({ x: 4, y: 3, width: 10, height: 7 });
    const crop = useEditStore.getState().geometry.cropRect;

    const store = useEditStore.getState();
    store.beginAdjustment();
    store.setTonal({ contrast: 30 });
    store.commitAdjustment();
    useEditStore.getState().setDither({ ...DEFAULT_DITHER, algorithm: 'floyd-steinberg' });
    useEditStore.getState().setDetail({ unsharpStrength: 50 });
    useEditStore.getState().setVector({ threshold: 90 });
    useEditStore.getState().resetTonal();
    useImageStore.getState().setDpi(254);

    expect(useEditStore.getState().geometry.cropRect).toEqual(crop);
    expectPreviewIsSourceRegion(4, 3, 10, 7);
  });

  it('is undone and redone, pixels included', () => {
    useEditStore.getState().cropTo({ x: 4, y: 3, width: 10, height: 7 });
    useEditStore.getState().cropTo({ x: 2, y: 1, width: 5, height: 4 });

    useEditStore.getState().undo();
    expectPreviewIsSourceRegion(4, 3, 10, 7);
    useEditStore.getState().undo();
    expectPreviewIsSourceRegion(0, 0, 30, 20);
    expect(useEditStore.getState().canUndo()).toBe(false);

    useEditStore.getState().redo();
    expectPreviewIsSourceRegion(4, 3, 10, 7);
    useEditStore.getState().redo();
    expectPreviewIsSourceRegion(6, 4, 5, 4);
  });

  it('is cleared by Reset All, which can itself be undone', () => {
    useEditStore.getState().cropTo({ x: 4, y: 3, width: 10, height: 7 });
    useEditStore.getState().resetAll();
    expectPreviewIsSourceRegion(0, 0, 30, 20);

    useEditStore.getState().undo();
    expectPreviewIsSourceRegion(4, 3, 10, 7);
  });
});

describe('Resolution', () => {
  it('setDpi changes only the DPI, not the pixels', () => {
    useImageStore.getState().clearImage();
    useEditStore.getState().startNewImage();
    openLabelledImage(30, 20);

    useImageStore.getState().setDpi(127);

    expect(useImageStore.getState().metadata?.dpi).toBe(127);
    expectPreviewIsSourceRegion(0, 0, 30, 20);
  });
});

describe('Cutline and node smoothing', () => {
  it('generates a laser contour cutline around the open image', () => {
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
    openLoadedImage({
      file: new File([], 'cut.png'),
      originalBuffer: buf,
      // SAFETY: no store code reads the bitmap; Node has no ImageBitmap to construct.
      bitmap: null as unknown as ImageBitmap,
      metadata: metadataFor(w, h),
      previewBuffer: buf,
      previewDims: { width: w, height: h, scale: 1 },
    });

    useEditStore.getState().generateCutline(1.0, 2);
    const vr = useEditStore.getState().vectorResult;
    expect(vr).not.toBeNull();
    expect(vr?.layers.length).toBe(1);
    expect(vr?.layers[0].color).toBe('#ff0000');
    expect(vr?.layers[0].paths.length).toBeGreaterThanOrEqual(1);
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
