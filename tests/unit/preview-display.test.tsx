// @vitest-environment jsdom
/**
 * The dithered preview below 100% (moiré). The canvas shows an area-averaged
 * copy below 100% and the dots at 100% and above; the copy keeps the mean
 * tone, and the exported file does not depend on the view.
 */
import { act } from 'react';
import { describe, it, expect, afterEach, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { areaResample, averagedSize, previewDisplay } from '../../src/lib/preview-display';
import { PreviewCanvas } from '../../src/components/canvas/PreviewCanvas';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { useUIStore, firstSteps } from '../../src/store/uiStore';
import { useViewStore } from '../../src/store/viewStore';
import { setDither } from '../../src/lib/document';
import { exportRaster } from '../../src/lib/raster-export';
import { currentDoc, decodedImage, labelledImage, resetStores } from '../helpers/documents';
import { mount, type Mounted } from '../helpers/dom';
import { loadPixels, startTestPipeline, type TestPipeline } from '../helpers/pipeline';

describe('which display the zoom gets', () => {
  it('shows the dots at 100% and above, at any pixel ratio', () => {
    for (const dpr of [1, 2, 3]) {
      expect(previewDisplay(1, dpr)).toEqual({ mode: 'dots' });
      expect(previewDisplay(4, dpr)).toEqual({ mode: 'dots' });
    }
  });

  it('below 100%, averages to one dot per device pixel, never more pixels than dots', () => {
    expect(previewDisplay(0.5, 1)).toEqual({ mode: 'averaged', scale: 0.5 });
    expect(previewDisplay(0.3, 2)).toEqual({ mode: 'averaged', scale: 0.6 });
    // A 2x screen at 60% has more device pixels than dots: the dots, smoothed.
    expect(previewDisplay(0.6, 2)).toEqual({ mode: 'averaged', scale: 1 });
    expect(averagedSize(1200, 800, 0.32)).toEqual({ width: 384, height: 256 });
  });
});

/** A width x height RGBA image of 1-bit dots, `on(x, y)` black. */
function dots(width: number, height: number, on: (x: number, y: number) => boolean) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = on(x, y) ? 0 : 255;
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

const meanGrey = (img: { data: Uint8ClampedArray }) => {
  let sum = 0;
  for (let i = 0; i < img.data.length; i += 4) sum += img.data[i];
  return sum / (img.data.length / 4);
};

describe('area averaging', () => {
  it('turns a 50% checkerboard of dots into flat mid grey at any scale, with no pattern left', () => {
    for (const out of [32, 21, 13, 7]) {
      const small = areaResample(dots(64, 64, (x, y) => (x + y) % 2 === 0), out, out);
      expect([small.width, small.height]).toEqual([out, out]);
      const greys = new Set<number>();
      for (let i = 0; i < small.data.length; i += 4) greys.add(small.data[i]);
      // Each output pixel covers as many black dots as white, give or take the half
      // dot an uneven cover allows: within 255 / (2 x dots covered) of mid grey.
      const covered = (64 / out) ** 2;
      for (const g of greys) expect(Math.abs(g - 127.5)).toBeLessThanOrEqual(255 / (2 * covered) + 1);
      if (out === 32) expect([...greys]).toEqual([128]);
    }
  });

  it('keeps the mean tone of a dither at every scale', () => {
    // A 25% dot density with an irregular layout, as a dither gives.
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
    const img = dots(256, 128, () => rand() < 0.25);
    const before = meanGrey(img);
    for (const scale of [0.5, 0.37, 0.25, 0.1]) {
      const { width, height } = averagedSize(img.width, img.height, scale);
      expect(Math.abs(meanGrey(areaResample(img, width, height)) - before)).toBeLessThan(1);
    }
  });

  it('weights a partly covered dot by how much of it is covered', () => {
    // Three dots, black, white, black, into two pixels: each covers 1.5 dots.
    const small = areaResample(dots(3, 1, (x) => x !== 1), 2, 1);
    expect(small.data[0]).toBe(Math.round(255 / 3));
    expect(small.data[4]).toBe(Math.round(255 / 3));
  });
});

describe('the canvas', () => {
  let mounted: Mounted | null = null;

  beforeEach(() => {
    resetStores();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    useDocumentStore.getState().open(decodedImage(400, 200), 10);
    useDocumentStore.getState().syncAll(setDither({ algorithm: 'floyd-steinberg' }));
    useRenderStore.setState({
      source: {
        key: 'k',
        sourceId: useDocumentStore.getState().doc!.source.sourceId,
        crop: { x: 0, y: 0, width: 400, height: 200 },
        buffer: new ArrayBuffer(400 * 200 * 4),
        width: 400,
        height: 200,
      },
      processed: new ArrayBuffer(400 * 200 * 4),
    });
    useUIStore.setState({ job: 'photo', stepByJob: firstSteps() });
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const shown = () => mounted!.container.querySelector<HTMLCanvasElement>('canvas[data-display]')!.dataset.display;
  const hint = () => mounted!.container.textContent!.includes('Zoom to 100% to see the dots');

  it('in the photo job: averaged with a note below 100%, the dots and no note at 100%', () => {
    mounted = mount(<PreviewCanvas />);
    act(() => useViewStore.setState({ zoom: 0.4, fitted: true }));
    expect(shown()).toBe('averaged');
    const averaged = () => mounted!.container.querySelectorAll('canvas[aria-hidden="true"]').length;
    expect(averaged()).toBe(1);
    expect(hint()).toBe(true);

    act(() => useViewStore.setState({ zoom: 1, fitted: false }));
    expect(shown()).toBe('dots');
    expect(averaged()).toBe(0);
    expect(hint()).toBe(false);
  });

  it('with no dither there are no dots to mention', () => {
    useDocumentStore.getState().syncAll(setDither({ algorithm: 'none' }));
    mounted = mount(<PreviewCanvas />);
    act(() => useViewStore.setState({ zoom: 0.4, fitted: true }));
    expect(shown()).toBe('averaged');
    expect(hint()).toBe(false);
  });
});

describe('the export does not depend on the view', () => {
  let pipeline: TestPipeline;
  beforeAll(async () => {
    pipeline = await startTestPipeline();
  });
  afterAll(() => pipeline.stop());

  it('a dithered PNG is byte-identical at 25% and at 100%', async () => {
    resetStores();
    useDocumentStore.getState().open(await loadPixels(pipeline.api, labelledImage(300, 200), 300, 200, 'photo.png'), 0.1);
    useDocumentStore.getState().edit(setDither({ algorithm: 'floyd-steinberg' }));
    await pipeline.settled();

    act(() => useViewStore.setState({ zoom: 0.25, fitted: true }));
    const small = await exportRaster(currentDoc(), 'png');
    act(() => useViewStore.setState({ zoom: 1, fitted: false }));
    const actual = await exportRaster(currentDoc(), 'png');
    expect(small && actual).toBeTruthy();
    expect(Buffer.from(new Uint8Array(small!.bytes)).equals(Buffer.from(new Uint8Array(actual!.bytes)))).toBe(true);
  });
});
