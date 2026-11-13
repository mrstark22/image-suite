/**
 * The tracer in the app's pipeline (#23, #32): it traces the adjusted image,
 * waits for a size, and export traces again at full resolution.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { useUIStore } from '../../src/store/uiStore';
import { setScale, setTonal, setVector } from '../../src/lib/document';
import { previewTarget } from '../../src/lib/render-target';
import { vectorExportSource } from '../../src/lib/vector-file-export';
import { exportedSvg } from '../helpers/exported';
import { loadPixels, startTestPipeline, type TestPipeline } from '../helpers/pipeline';
import { resetStores } from '../helpers/documents';
import { loadWasm, runTrace } from '../helpers/wasm';
import type { VectorResult } from '../../src/types/vector';

let pipeline: TestPipeline;
beforeAll(async () => {
  pipeline = await startTestPipeline();
});
afterAll(() => pipeline.stop());
beforeEach(() => {
  resetStores();
  useUIStore.setState({ job: 'vector' });
});

const store = () => useDocumentStore.getState();
const render = () => useRenderStore.getState();

/** A grey (`ground`) image with a 40% grey square in the middle. */
function greySquare(w: number, h: number): ArrayBuffer {
  const data = new Uint8Array(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = x >= w / 4 && x < (3 * w) / 4 && y >= h / 4 && y < (3 * h) / 4 ? 150 : 230;
      data.fill(v, (y * w + x) * 4, (y * w + x) * 4 + 3);
    }
  }
  return data.buffer;
}

const pathCount = (r: VectorResult | null) => r?.layers.reduce((n, l) => n + l.paths.length, 0) ?? 0;

describe('tracing in the pipeline', () => {
  it('waits for the size, then traces', async () => {
    store().open(await loadPixels(pipeline.api, greySquare(80, 60), 80, 60), null);
    await pipeline.settled();
    expect(render().vectorResult).toBeNull();
    store().edit(setScale(0.1));
    await pipeline.settled();
    expect(render().vectorResult).not.toBeNull();
    expect(render().vectorResult?.pxPerMm).toBeCloseTo(10, 9);
  });

  it('traces at once at an assumed size: an image opened without a stated DPI does not wait', async () => {
    store().open(await loadPixels(pipeline.api, greySquare(80, 60), 80, 60));
    expect(store().doc?.sizeOrigin).toBe('assumed');
    await pipeline.settled();
    expect(render().vectorResult?.pxPerMm).toBeCloseTo(300 / 25.4, 9);
  });

  it('traces the adjusted image: darkening the image changes the trace (#23)', async () => {
    store().open(await loadPixels(pipeline.api, greySquare(80, 60), 80, 60), 0.1);
    await pipeline.settled();
    // At the default threshold of 128 the 150 grey square is not ink.
    expect(pathCount(render().vectorResult)).toBe(0);
    store().edit(setTonal({ brightness: -40 }));
    await pipeline.settled();
    expect(pathCount(render().vectorResult)).toBe(1);
  });

  it('a tracing setting changes the trace', async () => {
    store().open(await loadPixels(pipeline.api, greySquare(80, 60), 80, 60), 0.1);
    store().edit(setVector({ threshold: 200 }));
    await pipeline.settled();
    expect(pathCount(render().vectorResult)).toBe(1);
    store().edit(setVector({ cutline: true, cutlineOffsetMm: 1 }));
    await pipeline.settled();
    expect(render().vectorResult?.layers.map((l) => l.id)).toEqual(['ink', 'cutline']);
  });
});

describe('export traces at full resolution (#23)', () => {
  it('a hairline present only at full resolution is in the exported file', async () => {
    // 4000 px wide: the preview is 2048 px, where a 1 px line is a 50% grey that the threshold drops.
    const [w, h] = [4000, 200];
    const data = new Uint8Array(w * h * 4).fill(255);
    for (let x = 100; x < 3900; x++) data.fill(0, (100 * w + x) * 4, (100 * w + x) * 4 + 3);
    store().open(await loadPixels(pipeline.api, data.buffer, w, h), 0.05);
    store().edit(setVector({ threshold: 100 }));
    await pipeline.settled();
    expect(previewTarget(store().doc!).widthPx).toBe(2048);
    const shown = render().vectorResult!;
    expect(pathCount(shown)).toBe(0);

    const source = vectorExportSource(shown, render().tracedInputs !== null, false);
    expect(source).toBe('full-resolution');
    const file = await exportedSvg(pipeline.api, store().doc!, shown);
    expect(file.paths).toBe(1);
    // 4000 px at 0.05 mm per px: the file is 200 mm wide.
    expect(file.widthMm).toBe(200);
  });

  it('layers hidden on screen stay hidden in the file', async () => {
    store().open(await loadPixels(pipeline.api, greySquare(80, 60), 80, 60), 0.1);
    store().edit(setVector({ threshold: 200, cutline: true }));
    await pipeline.settled();
    render().toggleVectorLayer('cutline');
    const shown = render().vectorResult!;
    const file = await exportedSvg(pipeline.api, store().doc!, shown);
    expect(file.layers.map((l) => l.id)).toEqual(['ink']);
    expect(file.text).not.toContain('Cutline');
  });
});

describe('speed (#32)', () => {
  it('the slowest settings finish in a few seconds at 2048 px', async () => {
    const wasm = await loadWasm({ fresh: true });
    const [w, h] = [2048, 2048];
    const img = new Uint8Array(w * h * 4).fill(255);
    // Text-like strokes and blobs across the image.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ink = (x % 64 < 6 && y % 256 < 200) || Math.hypot((x % 256) - 128, (y % 256) - 128) < 40;
        if (ink) img.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
      }
    }
    const start = performance.now();
    // 10 px per mm: denoise 1 mm is its largest radius (10 px), the most colours, Auto shapes, a cutline.
    runTrace(wasm, img, w, h, { denoiseMm: 1, colorMode: 'color', colorCount: 16, cutline: true, cutlineOffsetMm: 5 });
    const seconds = (performance.now() - start) / 1000;
    expect(seconds).toBeLessThan(10);
  }, 60_000);
});
