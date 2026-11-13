/**
 * Opening images, and the results kept in renderStore: they are derived from
 * the document and are not part of its history. Images are rendered by the
 * real pipeline, run in this process.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { useUIStore } from '../../src/store/uiStore';
import { usePreferencesStore } from '../../src/store/preferencesStore';
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
  it("opens without stopping for a size: the file's DPI sets it, and no dialog opens", async () => {
    await openImageFiles([new File([], 'a.jpg')], () => true, fakeDecode);
    expect(currentDoc().mmPerPx).toBeCloseTo(25.4 / 72, 12);
    expect(currentDoc().sizeOrigin).toBe('file');
    expect(currentDoc().source.fileDpi).toBe(72);
    expect(useUIStore.getState().isSizeDialogOpen).toBe(false);
  });

  it('a file with no DPI opens at an assumed size, and a size set by hand is remembered for the next one', async () => {
    const noDpi = async (file: File, sourceId: string) => ({ ...(await fakeDecode(file, sourceId)), fileDpi: null });
    await openImageFiles([new File([], 'a.png')], () => true, noDpi);
    expect(currentDoc().sizeOrigin).toBe('assumed');
    expect(25.4 / currentDoc().mmPerPx!).toBeCloseTo(300, 9);
    expect(useUIStore.getState().isSizeDialogOpen).toBe(false);
    // The size dialog applies 0.2 mm per pixel (127 DPI) by hand.
    usePreferencesStore.getState().setLastAppliedDpi(25.4 / 0.2);
    store().edit(setScale(0.2));
    expect(currentDoc().sizeOrigin).toBe('user');
    await openImageFiles([new File([], 'b.png')], () => true, noDpi);
    expect(currentDoc().sizeOrigin).toBe('assumed');
    expect(currentDoc().mmPerPx).toBeCloseTo(0.2, 12);
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
  totalNodes: 4,
  palette: [],
  dimensions: { width: 20, height: 10 },
  pxPerMm: 1,
  layers: [
    {
      id: 'vlayer-1',
      name: 'Layer 1',
      color: '#ff0000',
      paletteIndex: null,
      visible: true,
      totalNodes: 2,
      paths: [{ id: 'p1', kind: 'fill', d: 'M 0 0 L 10 10 Z', isClosed: true, nodeCount: 2 }],
    },
    {
      id: 'vlayer-2',
      name: 'Layer 2',
      color: '#00ff00',
      paletteIndex: null,
      visible: true,
      totalNodes: 2,
      paths: [{ id: 'p2', kind: 'stroke', d: 'M 2 2 L 3 3', isClosed: false, nodeCount: 2 }],
    },
  ],
};

describe('results in renderStore', () => {
  beforeEach(async () => {
    await openLabelled(20, 10);
    render().setVectorResult(TRACE);
  });

  it('hiding a layer and clearing the trace do not enter the undo history', () => {
    render().toggleVectorLayer('vlayer-2');
    render().clearVectors();
    expect(store().past.length).toBe(0);
  });

  it('toggles a vector layer', () => {
    render().toggleVectorLayer('vlayer-2');
    expect(render().vectorResult?.layers.map((l) => l.visible)).toEqual([true, false]);
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

  it('Reset All or a recipe that leaves what the trace reads equal does not mark the trace stale (review finding 8)', () => {
    render().setAutoTrace(false);
    store().edit(resetAll);
    store().edit(applyRecipe({ version: RECIPE_VERSION, name: 'r', createdAt: 0, updatedAt: 0, steps: [] }));
    expect(render().isVectorStale).toBe(false);
    store().edit(setVector({ threshold: 60 }));
    expect(render().isVectorStale).toBe(true);
  });

  it('an adjustment or a new size marks the trace stale too: the trace reads them (review of #84)', () => {
    render().setAutoTrace(false);
    store().edit(setTonal({ contrast: 20 }));
    expect(render().isVectorStale).toBe(true);
    render().setVectorResult(TRACE);
    expect(render().isVectorStale).toBe(false);
    store().edit(setScale(0.5));
    expect(render().isVectorStale).toBe(true);
  });

  it('closing the document clears the error banner (review finding 9)', () => {
    render().setErrorMessage('Tracing failed');
    store().close();
    expect(render().errorMessage).toBeNull();
  });
});
