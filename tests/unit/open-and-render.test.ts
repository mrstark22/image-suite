/**
 * Opening images, and the results kept in renderStore: they are derived from
 * the document and are not part of its history.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { useUIStore } from '../../src/store/uiStore';
import { ignoredFilesMessage, openImageFiles } from '../../src/lib/open-image';
import { setCrop, setDither, setScale, setVector } from '../../src/lib/document';
import type { DecodedImage } from '../../src/lib/image-loader';
import type { VectorResult } from '../../src/types/vector';
import { currentDoc, decodedImage, previewMismatches, resetStores } from '../helpers/documents';

const store = () => useDocumentStore.getState();
const render = () => useRenderStore.getState();

/** Decodes every file as a labelled image named after it. */
const fakeDecode = async (file: File): Promise<DecodedImage> => decodedImage(20, 10, 20, 10, 72, file.name);

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

  it('a document opened with its scale set (a test grid) does not open the size dialog', () => {
    store().open(decodedImage(10, 10), 25.4 / 300);
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
  beforeEach(() => {
    store().open(decodedImage(20, 10));
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

  it('a new document starts with no results', () => {
    render().setDepthHeightMap(new ArrayBuffer(8));
    store().open(decodedImage(5, 5));
    expect(render().vectorResult).toBeNull();
    expect(render().depthHeightMap).toBeNull();
    expect(render().source?.width).toBe(5);
  });

  it('a dither change keeps the preview source; a crop replaces it', () => {
    const source = render().source;
    store().edit(setDither({ algorithm: 'atkinson' }));
    expect(render().source).toBe(source);
    store().edit(setCrop({ x: 2, y: 2, width: 6, height: 4 }));
    expect(render().source).not.toBe(source);
    expect(previewMismatches(2, 2, 6, 4)).toBe(0);
  });

  it('background removal replaces the source pixels until the crop changes', () => {
    const replaced = new Uint8Array(20 * 10 * 4).fill(255).buffer;
    render().replaceSourcePixels(replaced);
    expect(render().source?.buffer).toBe(replaced);
    store().edit(setCrop({ x: 1, y: 1, width: 5, height: 5 }));
    expect(previewMismatches(1, 1, 5, 5)).toBe(0);
  });
});

describe('cutline', () => {
  /** A 50x50 white image with a centred black 20x20 box. */
  function boxImage(): DecodedImage {
    const w = 50;
    const data = new Uint8Array(w * w * 4).fill(255);
    for (let y = 15; y < 35; y++) {
      for (let x = 15; x < 35; x++) {
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
    return { ...decodedImage(w, w), preview: data.buffer };
  }

  it('refuses while the size is not set, since its offset is in mm', () => {
    store().open(boxImage());
    expect(render().generateCutline(1.0, 2)).toBe(false);
    expect(render().vectorResult).toBeNull();
  });

  it('generates a red contour around the subject once the size is set', () => {
    store().open(boxImage());
    store().edit(setScale(25.4 / 300));
    expect(render().generateCutline(1.0, 2)).toBe(true);
    const vr = render().vectorResult;
    expect(vr?.layers.length).toBe(1);
    expect(vr?.layers[0].color).toBe('#ff0000');
    expect(vr?.layers[0].paths.length).toBeGreaterThanOrEqual(1);
  });
});

describe('node smoothing', () => {
  it('reduces the node count of a traced zigzag and fits curves', () => {
    store().open(decodedImage(100, 100));
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
