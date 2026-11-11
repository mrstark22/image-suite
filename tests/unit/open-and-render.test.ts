/**
 * Opening images, and the results kept in renderStore: they are derived from
 * the document and are not part of its history. Images are rendered by the
 * real pipeline, run in this process.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { useUIStore } from '../../src/store/uiStore';
import { ignoredFilesMessage, openImageFiles } from '../../src/lib/open-image';
import { applyRecipe, resetAll, setCrop, setDither, setScale, setTonal, setVector } from '../../src/lib/document';
import { RECIPE_VERSION } from '../../src/types/recipe';
import type { LoadedSource } from '../../src/lib/image-loader';
import type { VectorResult } from '../../src/types/vector';
import { currentDoc, labelledImage, previewMismatches, resetStores } from '../helpers/documents';
import { loadPixels, startTestPipeline, type TestPipeline } from '../helpers/pipeline';

const store = () => useDocumentStore.getState();
const render = () => useRenderStore.getState();

let pipeline: TestPipeline;
beforeAll(async () => {
  pipeline = await startTestPipeline();
});
afterAll(() => pipeline.stop());

/** Decodes every file as a 20x10 labelled image named after it, claiming 72 DPI. */
const fakeDecode = async (file: File, sourceId: string): Promise<LoadedSource> => {
  const info = await pipeline.api.putSource(sourceId, labelledImage(20, 10), 20, 10);
  return { sourceId, file, name: file.name, fileDpi: 72, ...info };
};

/** Opens a `width` x `height` labelled image and waits for its renders. */
async function openLabelled(width: number, height: number, name = 'test.png', mmPerPx: number | null = null) {
  store().open(await loadPixels(pipeline.api, labelledImage(width, height), width, height, name), mmPerPx);
  await pipeline.settled();
}

beforeEach(() => {
  resetStores();
});

describe('opening an image', () => {
  it('opens the size dialog with the size not set, offering the file DPI only as a suggestion', async () => {
    await openImageFiles([new File([], 'a.jpg')], () => true, fakeDecode);
    expect(currentDoc().mmPerPx).toBeNull();
    expect(currentDoc().source.fileDpi).toBe(72);
    expect(useUIStore.getState().isSizeDialogOpen).toBe(true);
  });

  it('asks before replacing an edited document, and keeps it when the user declines', async () => {
    await openImageFiles([new File([], 'a.jpg')], () => true, fakeDecode);
    store().edit(setScale(0.1));
    store().edit(setCrop({ x: 1, y: 1, width: 4, height: 4 }));
    let asked = 0;

    await openImageFiles([new File([], 'b.jpg')], () => (asked++, false), fakeDecode);

    expect(asked).toBe(1);
    expect(currentDoc().source.name).toBe('a.jpg');
    await pipeline.settled();
    expect(previewMismatches(1, 1, 4, 4)).toBe(0);
  });

  it('does not ask when nothing has changed, and replaces the document with a fresh one', async () => {
    await openImageFiles([new File([], 'a.jpg')], () => true, fakeDecode);
    const first = currentDoc();
    await openImageFiles([new File([], 'b.jpg')], () => {
      throw new Error('should not ask');
    }, fakeDecode);
    expect(currentDoc().id).not.toBe(first.id);
    expect(currentDoc().source.name).toBe('b.jpg');
  });

  it('opens the first of several files and says the rest were ignored', async () => {
    await openImageFiles([new File([], 'a.jpg'), new File([], 'b.jpg'), new File([], 'c.jpg')], () => true, fakeDecode);
    expect(currentDoc().source.name).toBe('a.jpg');
    expect(render().errorMessage).toBe(ignoredFilesMessage('a.jpg', 2));
    expect(ignoredFilesMessage('a.png', 1)).toBe(
      'Opened a.png. This tool works on one image at a time, so the other 1 file was not opened.'
    );
  });

  it('a document opened with its scale set (a test grid) does not open the size dialog', async () => {
    await openLabelled(10, 10, 'grid.png', 25.4 / 300);
    expect(useUIStore.getState().isSizeDialogOpen).toBe(false);
    expect(currentDoc().mmPerPx).toBeCloseTo(25.4 / 300, 12);
  });
});

const TRACE: VectorResult = {
  totalPaths: 2,
  totalNodes: 8,
  svgString: '<svg></svg>',
  dimensions: { width: 20, height: 10 },
  layers: [
    {
      id: 'vlayer-1',
      name: 'Layer 1',
      color: '#ff0000',
      visible: true,
      totalNodes: 4,
      paths: [{ id: 'p1', color: '#ff0000', svgPathData: 'M 0 0 L 10 10', isClosed: true, nodeCount: 4, segments: [] }],
    },
    {
      id: 'vlayer-2',
      name: 'Layer 2',
      color: '#00ff00',
      visible: true,
      totalNodes: 4,
      paths: [{ id: 'p2', color: '#00ff00', svgPathData: 'M 2 2 L 3 3', isClosed: true, nodeCount: 4, segments: [] }],
    },
  ],
};

describe('results in renderStore', () => {
  beforeEach(async () => {
    await openLabelled(20, 10);
    render().setVectorResult(TRACE);
  });

  it('trace edits do not enter the undo history (#32)', () => {
    render().removeVectorLayer('vlayer-1');
    render().toggleVectorLayer('vlayer-2');
    render().clearVectors();
    expect(store().past.length).toBe(0);
  });

  it('removes and toggles vector layers, keeping the totals right', () => {
    render().removeVectorLayer('vlayer-1');
    expect(render().vectorResult?.layers.map((l) => l.id)).toEqual(['vlayer-2']);
    expect(render().vectorResult?.totalPaths).toBe(1);
    render().toggleVectorLayer('vlayer-2');
    expect(render().vectorResult?.layers[0].visible).toBe(false);
  });

  it('clearing vectors turns auto-trace off; a tracing change then marks the trace stale', () => {
    render().clearVectors();
    expect(render().autoTrace).toBe(false);
    expect(render().isVectorStale).toBe(false);
    store().edit(setVector({ threshold: 90 }));
    expect(render().isVectorStale).toBe(true);
    render().requestTrace();
    expect(render().autoTrace).toBe(true);
  });

  it('a new document starts with no results, then gets its rendered preview', async () => {
    render().setDepthHeightMap(new ArrayBuffer(8));
    const next = await loadPixels(pipeline.api, labelledImage(5, 5), 5, 5);
    store().open(next);
    expect(render().vectorResult).toBeNull();
    expect(render().depthHeightMap).toBeNull();
    expect(render().source).toBeNull();
    await pipeline.settled();
    expect(render().source?.width).toBe(5);
    expect(previewMismatches(0, 0, 5, 5)).toBe(0);
  });

  it('a dither change keeps the preview source; a crop replaces it', async () => {
    const source = render().source;
    store().edit(setDither({ algorithm: 'atkinson' }));
    await pipeline.settled();
    expect(render().source).toBe(source);
    store().edit(setCrop({ x: 2, y: 2, width: 6, height: 4 }));
    await pipeline.settled();
    expect(render().source).not.toBe(source);
    expect(previewMismatches(2, 2, 6, 4)).toBe(0);
  });

  it('background removal replaces the source pixels the preview is rendered from, until the crop changes', async () => {
    // Black where the "background" was removed, so the replaced pixels are visible in the result.
    const replaced = new Uint8Array(20 * 10 * 4).fill(0);
    for (let i = 3; i < replaced.length; i += 4) replaced[i] = 255;
    expect(render().replaceSourcePixels(replaced.buffer, render().source!)).toBe(true);
    expect(render().source?.buffer).toBe(replaced.buffer);
    await pipeline.settled();
    // The preview is computed from the replaced pixels (no adjustments: it equals them).
    expect(new Uint8Array(render().processed!)).toEqual(replaced);
    store().edit(setCrop({ x: 1, y: 1, width: 5, height: 5 }));
    await pipeline.settled();
    expect(render().backgroundRemoval).toBeNull();
    expect(previewMismatches(1, 1, 5, 5)).toBe(0);
  });

  it('Restore brings back the original pixels, and the preview follows', async () => {
    const replaced = new Uint8Array(20 * 10 * 4).fill(255).buffer;
    render().replaceSourcePixels(replaced, render().source!);
    await pipeline.settled();
    render().restoreSource();
    await pipeline.settled();
    expect(previewMismatches(0, 0, 20, 10)).toBe(0);
    expect(new Uint8Array(render().processed!)).toEqual(new Uint8Array(labelledImage(20, 10)));
  });

  it('a removal result for another image of the same size is discarded (review finding 1)', async () => {
    const from = render().source!;
    await openLabelled(20, 10, 'other.png');
    const result = new Uint8Array(20 * 10 * 4).fill(255).buffer;
    expect(render().replaceSourcePixels(result, from)).toBe(false);
    expect(previewMismatches(0, 0, 20, 10)).toBe(0);
  });

  it('a removal result for a different crop of the same size is discarded, and applies again once that crop is back', async () => {
    store().edit(setCrop({ x: 0, y: 0, width: 10, height: 10 }));
    await pipeline.settled();
    const from = render().source!;
    store().edit(setCrop({ x: 10, y: 0, width: 10, height: 10 }));
    await pipeline.settled();
    const result = new Uint8Array(10 * 10 * 4).fill(255).buffer;
    expect(render().replaceSourcePixels(result, from)).toBe(false);
    expect(previewMismatches(10, 0, 10, 10)).toBe(0);
    // Undo returns to the crop the removal was computed for, so it is valid there.
    store().undo();
    await pipeline.settled();
    expect(render().replaceSourcePixels(result, from)).toBe(true);
  });

  it('Reset All or a recipe that leaves the tracing settings equal does not mark the trace stale (review finding 8)', () => {
    render().setAutoTrace(false);
    store().edit(setTonal({ contrast: 20 }));
    store().edit(resetAll);
    store().edit(applyRecipe({ version: RECIPE_VERSION, name: 'r', createdAt: 0, updatedAt: 0, steps: [] }));
    expect(render().isVectorStale).toBe(false);
    store().edit(setVector({ threshold: 60 }));
    expect(render().isVectorStale).toBe(true);
  });

  it('closing the document clears the error banner (review finding 9)', () => {
    render().setErrorMessage('Tracing failed');
    store().close();
    expect(render().errorMessage).toBeNull();
  });
});

describe('cutline', () => {
  /** Opens a 50x50 white image with a centred black 20x20 box. */
  async function openBoxImage() {
    const w = 50;
    const data = new Uint8Array(w * w * 4).fill(255);
    for (let y = 15; y < 35; y++) {
      for (let x = 15; x < 35; x++) {
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
    store().open(await loadPixels(pipeline.api, data.buffer, w, w));
    await pipeline.settled();
  }

  it('refuses while the size is not set, since its offset is in mm', async () => {
    await openBoxImage();
    expect(render().generateCutline(1.0, 2)).toBe(false);
    expect(render().vectorResult).toBeNull();
  });

  it('generates a red contour around the subject once the size is set', async () => {
    await openBoxImage();
    store().edit(setScale(25.4 / 300));
    await pipeline.settled();
    expect(render().generateCutline(1.0, 2)).toBe(true);
    const vr = render().vectorResult;
    expect(vr?.layers.length).toBe(1);
    expect(vr?.layers[0].color).toBe('#ff0000');
    expect(vr?.layers[0].paths.length).toBeGreaterThanOrEqual(1);
  });
});

describe('node smoothing', () => {
  it('reduces the node count of a traced zigzag and fits curves', async () => {
    await openLabelled(100, 100);
    const segments = [
      { type: 'M' as const, points: [{ x: 0, y: 0 }] },
      ...[[10, 20], [20, 35], [30, 45], [40, 50], [50, 45], [60, 35], [70, 20], [80, 0]].map(([x, y]) => ({
        type: 'L' as const,
        points: [{ x, y }],
      })),
      { type: 'Z' as const, points: [] },
    ];
    render().setVectorResult({
      totalPaths: 1,
      totalNodes: 10,
      svgString: '',
      dimensions: { width: 100, height: 100 },
      layers: [
        {
          id: 'l1',
          name: 'Layer 1',
          color: '#000',
          visible: true,
          totalNodes: 10,
          paths: [
            {
              id: 'p1',
              color: '#000',
              isClosed: true,
              nodeCount: 10,
              svgPathData: 'M 0 0 L 10 20 L 20 35 L 30 45 L 40 50 L 50 45 L 60 35 L 70 20 L 80 0 Z',
              segments,
            },
          ],
        },
      ],
    });
    render().smoothVectors(2.0, true);
    const smoothed = render().vectorResult!;
    expect(smoothed.totalNodes).toBeLessThan(10);
    expect(smoothed.layers[0].paths[0].svgPathData).toContain('C');
  });
});
