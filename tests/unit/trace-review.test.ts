/**
 * The ten findings of the review of #84, each as a test of the behaviour it
 * asked for. Comments give the finding's number.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';
import { traceIsCurrent, useRenderStore } from '../../src/store/renderStore';
import { useUIStore } from '../../src/store/uiStore';
import { setTonal, setVector } from '../../src/lib/document';
import { cropBoxForKey } from '../../src/lib/crop';
import { traceForExport, vectorFile } from '../../src/lib/vector-file-export';
import { layerColourIndexes, parsePathData, tracePageMm, traceToDxf, traceToSvg } from '../../src/lib/vector-export';
import { TooLargeError } from '../../src/lib/pipeline-engine';
import { PipelineWorkerApi } from '../../src/workers/pipeline-api';
import { RustWasmEngine, type WasmExports } from '../../src/wasm/wasm-bridge';
import { createDocument } from '../../src/lib/document';
import { nativeTarget } from '../../src/lib/render-target';
import { loadPixels, startTestPipeline, type TestPipeline } from '../helpers/pipeline';
import { resetStores } from '../helpers/documents';
import { loadWasm, runTrace, type Wasm } from '../helpers/wasm';
import type { VectorResult } from '../../src/types/vector';

let wasm: Wasm;
let pipeline: TestPipeline;
beforeAll(async () => {
  wasm = await loadWasm();
  pipeline = await startTestPipeline();
});
afterAll(() => pipeline.stop());
beforeEach(() => {
  resetStores();
  useUIStore.setState({ job: 'vector' });
});

const store = () => useDocumentStore.getState();
const render = () => useRenderStore.getState();

/** Flat colour blocks across a `w` x `h` image, with soft (anti-aliased) edges between them. */
function colourBlocks(w: number, h: number, colours: Array<[number, number, number]>): ArrayBuffer {
  const data = new Uint8Array(w * h * 4);
  const band = w / colours.length;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (x + 0.5) / band - 0.5;
      const k = Math.max(0, Math.min(colours.length - 1, Math.floor(t)));
      const k2 = Math.min(colours.length - 1, k + 1);
      // A 3 px blend at each boundary.
      const f = Math.max(0, Math.min(1, ((t - k) * band - (band - 3)) / 3));
      for (let c = 0; c < 3; c++) data[(y * w + x) * 4 + c] = Math.round(colours[k][c] * (1 - f) + colours[k2][c] * f);
      data[(y * w + x) * 4 + 3] = 255;
    }
  }
  return data.buffer;
}

describe('export writes what is on screen', () => {
  it('1: the exported colour layers are the colours shown, even where full resolution would cluster differently', async () => {
    const colours: Array<[number, number, number]> = [
      [219, 78, 32],
      [245, 177, 36],
      [240, 200, 40],
      [200, 30, 30],
      [30, 60, 160],
      [250, 250, 245],
      [20, 20, 20],
    ];
    store().open(await loadPixels(pipeline.api, colourBlocks(3000, 120, colours), 3000, 120), 0.05);
    store().edit(setVector({ colorMode: 'color', colorCount: 6, shapes: 'outline' }));
    await pipeline.settled();
    const shown = render().vectorResult!;
    const full = await traceForExport(pipeline.api, store().doc!, shown, 'full-resolution', null);
    expect(full.dimensions.width).toBe(3000);
    expect(full.layers.map((l) => [l.id, l.color])).toEqual(shown.layers.map((l) => [l.id, l.color]));
  });

  it('2: a trace is no longer current once an adjustment changes, so it cannot be exported', async () => {
    store().open(await loadPixels(pipeline.api, colourBlocks(80, 40, [[255, 255, 255], [0, 0, 0]]), 80, 40), 0.1);
    await pipeline.settled();
    expect(traceIsCurrent()).toBe(true);
    render().setAutoTrace(false);
    store().edit(setTonal({ contrast: 30 }));
    expect(traceIsCurrent()).toBe(false);
    expect(render().isVectorStale).toBe(true);
  });

  it('8: a layer hidden on screen stays hidden when the image is traced again', async () => {
    store().open(await loadPixels(pipeline.api, colourBlocks(80, 40, [[255, 255, 255], [0, 0, 0]]), 80, 40), 0.1);
    store().edit(setVector({ cutline: true, cutlineOffsetMm: 0.5 }));
    await pipeline.settled();
    render().toggleVectorLayer('cutline');
    store().edit(setVector({ toleranceMm: 0.04 }));
    await pipeline.settled();
    const cut = render().vectorResult!.layers.find((l) => l.id === 'cutline')!;
    expect(cut.visible).toBe(false);
    render().toggleVectorLayer('cutline');
    expect(render().vectorResult!.layers.find((l) => l.id === 'cutline')!.visible).toBe(true);
  });
});

describe('time and memory', () => {
  it('3: Centreline mode on a solid 2048 px square finishes in a few seconds', () => {
    const [w, h] = [2048, 2048];
    const img = new Uint8Array(w * h * 4).fill(255);
    for (let y = 24; y < h - 24; y++) img.fill(0, (y * w + 24) * 4, (y * w + w - 24) * 4);
    for (let i = 3; i < img.length; i += 4) img[i] = 255;
    const start = performance.now();
    const result = runTrace(wasm, img, w, h, { shapes: 'centerline' });
    const seconds = (performance.now() - start) / 1000;
    expect(result.layers[0].paths.length).toBeGreaterThan(0);
    expect(seconds).toBeLessThan(5);
  }, 60_000);

  it('4: a full-resolution export trace makes no extra copies of the image', async () => {
    const own = await loadWasm({ fresh: true });
    const api = new PipelineWorkerApi(async () => RustWasmEngine.fromExports(own.exports as unknown as WasmExports));
    const [w, h] = [4000, 3000];
    const data = new Uint8Array(w * h * 4).fill(0);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    await api.putSource('big', data.buffer, w, h);
    const doc = setVector({ cutline: true, cutlineOffsetMm: 2 })(
      createDocument('d', { sourceId: 'big', name: 'big.png', widthPx: w, heightPx: h, format: 'rgba8', hasAlpha: false, fileDpi: null }, 0.05)
    );
    await api.traceDocument({ doc, target: nativeTarget(doc) });
    // The source is 48 MB. The review measured 668 MB before the fix; 436 MB after it.
    expect(own.exports.memory.buffer.byteLength / 1e6).toBeLessThan(480);
  }, 120_000);

  it('4: a trace too big for memory is refused with a size error, not a trap', () => {
    // 20000 x 20000 px needs far more than a WASM module can hold; the pixels are never read.
    expect(() =>
      runTrace(wasm, new Uint8Array(4), 20000, 20000, {}, 10)
    ).toThrow(TooLargeError);
  });
});

describe('cutlines', () => {
  /** A disc touching the image edges, with a 2 mm (20 px) cutline. */
  function edgeDisc(): VectorResult {
    const [w, h] = [60, 60];
    const img = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = Math.hypot(x + 0.5 - 30, y + 0.5 - 30) < 30 ? 0 : 255;
        img.fill(v, (y * w + x) * 4, (y * w + x) * 4 + 3);
        img[(y * w + x) * 4 + 3] = 255;
      }
    }
    return runTrace(wasm, img, w, h, { shapes: 'outline', cutline: true, cutlineOffsetMm: 2 });
  }

  it('6: the SVG page and DXF extents take in a cutline that lies outside the image', () => {
    const result = edgeDisc();
    const page = tracePageMm(result);
    // The cutline's radius is 5 mm (3 + 2) around a centre 3 mm in: it reaches 2 mm past each edge.
    expect(page.x).toBeCloseTo(-2, 1);
    expect(page.widthMm).toBeCloseTo(10, 1);
    const svg = traceToSvg(result);
    const vb = /viewBox="([^"]+)"/.exec(svg)![1].split(' ').map(Number);
    expect(vb[0]).toBeCloseTo(-2, 1);
    expect(vb[2]).toBeCloseTo(10, 1);
    const lines = traceToDxf(result).split('\n');
    const at = (name: string) => Number(lines[lines.indexOf(name) + 2]);
    expect(at('$EXTMIN')).toBeCloseTo(-2, 1);
    expect(at('$EXTMAX')).toBeCloseTo(8, 1);
  });

  it('7: in colour mode the cutline goes round the artwork, not the paper it is on', () => {
    const [w, h] = [120, 120];
    const img = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const rgb = Math.hypot(x + 0.5 - 60, y + 0.5 - 60) < 20 ? [200, 30, 30] : [250, 250, 245];
        img.set([...rgb, 255], (y * w + x) * 4);
      }
    }
    const result = runTrace(wasm, img, w, h, { colorMode: 'color', colorCount: 2, cutline: true, cutlineOffsetMm: 1 });
    const cut = result.layers.find((l) => l.id === 'cutline')!;
    expect(cut.paths).toHaveLength(1);
    const pts = parsePathData(cut.paths[0].d).flatMap((c) => (c.op === 'Z' ? [] : [c.p]));
    for (const p of pts) expect(Math.abs(Math.hypot(p.x - 60, p.y - 60) - 30)).toBeLessThan(1);
  });
});

describe('DXF colours (9)', () => {
  it('16 layers get 16 different colours', () => {
    const colours = Array.from({ length: 16 }, (_, i) => `#${(i * 0x0f0f0f + 0x102030).toString(16).padStart(6, '0').slice(-6)}`);
    expect(new Set(layerColourIndexes(colours)).size).toBe(16);
  });

  it('the cutline keeps red when an artwork layer is red', () => {
    const result: VectorResult = {
      layers: [
        { id: 'color-0', name: 'Colour 1', color: '#ff0000', paletteIndex: 0, visible: true, totalNodes: 2, paths: [{ id: 'a', kind: 'fill', isClosed: true, nodeCount: 2, d: 'M 0 0 L 10 0 L 10 10 Z' }] },
        { id: 'cutline', name: 'Cutline', color: '#ff0000', paletteIndex: null, visible: true, totalNodes: 2, paths: [{ id: 'c', kind: 'cut', isClosed: true, nodeCount: 2, d: 'M 1 1 L 9 1 L 9 9 Z' }] },
      ],
      palette: ['#ff0000'],
      totalPaths: 2,
      totalNodes: 4,
      dimensions: { width: 10, height: 10 },
      pxPerMm: 1,
    };
    const lines = traceToDxf(result).split('\n');
    const colourOf = (layer: string) => {
      const i = lines.findIndex((v, k) => v === layer && lines[k - 1] === '2' && lines[k - 2] === 'LAYER');
      return Number(lines[i + 4]);
    };
    expect(colourOf('Cutline')).toBe(1);
    expect(colourOf('Colour_1')).not.toBe(1);
  });
});

describe('denoise at low settings (10)', () => {
  it('a radius under one traced pixel still changes the trace', () => {
    // A noisy edge: denoise of 0.04 mm is 0.4 px at 10 px/mm.
    let seed = 3;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const [w, h] = [80, 80];
    const img = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = Math.max(0, Math.min(255, (x < 40 ? 60 : 200) + (rnd() - 0.5) * 120));
        img.fill(v, (y * w + x) * 4, (y * w + x) * 4 + 3);
        img[(y * w + x) * 4 + 3] = 255;
      }
    }
    const d = (denoiseMm: number) => runTrace(wasm, img, w, h, { shapes: 'outline', denoiseMm }).layers[0].paths.map((p) => p.d).join();
    expect(d(0.04)).not.toBe(d(0));
  });
});

describe('crop keys with a fixed aspect (5)', () => {
  const dims = { width: 400, height: 300 };
  const press = (key: string) => ({ key, shiftKey: true, altKey: false });

  it('1:1: Shift+Right grows the square, Shift+Up shrinks it', () => {
    const box = { x: 50, y: 50, width: 100, height: 100 };
    expect(cropBoxForKey(box, press('ArrowRight'), dims, '1:1')).toEqual({ x: 50, y: 50, width: 110, height: 110 });
    expect(cropBoxForKey(box, press('ArrowUp'), dims, '1:1')).toEqual({ x: 50, y: 50, width: 90, height: 90 });
  });

  it('4:3: Shift+Down and Shift+Up change the box too', () => {
    const box = { x: 20, y: 20, width: 120, height: 90 };
    const down = cropBoxForKey(box, press('ArrowDown'), dims, '4:3')!;
    const up = cropBoxForKey(box, press('ArrowUp'), dims, '4:3')!;
    expect(down.height).toBe(100);
    expect(up.height).toBe(80);
    expect(down.width / down.height).toBeCloseTo(4 / 3, 1);
  });

  it('3:2 on a wide image: growing stops at the bottom edge, keeping the ratio', () => {
    let box = { x: 0, y: 100, width: 150, height: 100 };
    for (let i = 0; i < 50; i++) box = cropBoxForKey(box, press('ArrowRight'), dims, '3:2')!;
    expect(box.y + box.height).toBeLessThanOrEqual(300);
    expect(box.x + box.width).toBeLessThanOrEqual(400);
    expect(box.width / box.height).toBeCloseTo(1.5, 1);
  });
});

it('the exported file of finding 1 is the same physical size as the image', async () => {
  store().open(await loadPixels(pipeline.api, colourBlocks(200, 100, [[255, 255, 255], [0, 0, 0]]), 200, 100), 0.1);
  await pipeline.settled();
  const full = await traceForExport(pipeline.api, store().doc!, render().vectorResult!, 'full-resolution', null);
  expect(vectorFile(full, 'svg').text).toMatch(/width="20mm"/);
});
