/**
 * The follow-ups of the reviews of #84 (#86 to #91): each issue's "done when".
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';
import { traceIsCurrent, useRenderStore } from '../../src/store/renderStore';
import { useUIStore } from '../../src/store/uiStore';
import {
  applyRecipe,
  createDocument,
  recipeFromDocument,
  rotate,
  setColor,
  setCrop,
  setDetail,
  setScale,
  setTonal,
  setVector,
} from '../../src/lib/document';
import type { DocumentUpdate } from '../../src/types/document';
import { traceInputsOf } from '../../src/lib/trace-inputs';
import { editPalette, MAX_PALETTE, paletteFromResult } from '../../src/lib/trace-palette';
import type { PaletteEntry, VectorConfig } from '../../src/types/vector';
import { loadPixels, startTestPipeline, type TestPipeline } from '../helpers/pipeline';
import { resetStores } from '../helpers/documents';
import { exportedSvg } from '../helpers/exported';
import { loadWasm, runTrace, type Wasm } from '../helpers/wasm';

let wasm: Wasm;
let pipeline: TestPipeline;
let traces = 0;
beforeAll(async () => {
  wasm = await loadWasm();
  // Counts the traces the app's scheduler asks the worker for.
  pipeline = await startTestPipeline(
    (p) =>
      new Proxy(p, {
        get(target, key) {
          const value = Reflect.get(target, key);
          if (typeof value !== 'function') return value;
          if (key === 'traceDocument') traces++;
          return value.bind(target);
        },
      })
  );
});
afterAll(() => pipeline.stop());
beforeEach(() => {
  resetStores();
  useUIStore.setState({ job: 'vector' });
});

const store = () => useDocumentStore.getState();
const render = () => useRenderStore.getState();

/** Vertical bands of flat colour, hard-edged. */
function bands(w: number, h: number, colours: Array<[number, number, number]>): ArrayBuffer {
  const data = new Uint8Array(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      data.set(colours[Math.min(colours.length - 1, Math.floor((x * colours.length) / w))], (y * w + x) * 4);
    }
  }
  return data.buffer;
}

const blankDoc = () =>
  createDocument('d', { sourceId: 's', name: 's.png', widthPx: 40, heightPx: 40, format: 'rgba8', hasAlpha: false, fileDpi: null }, 0.1);
const recipeWith = (vector: Partial<VectorConfig>) => recipeFromDocument(setVector(vector)(blankDoc()), 'r');
const entry = (color: string): PaletteEntry => ({ color, removed: false, mergeInto: null });

describe('#86: a tracing value the tracer does not have is refused', () => {
  const img = new Uint8Array(bands(40, 40, [[0, 0, 0], [255, 255, 255]]));

  it('a recipe with an unknown shape mode or colour mode is an error naming the value', () => {
    expect(() => applyRecipe(recipeWith({ shapes: 'centreline' as never }))).toThrow(/"centreline" is not a shape mode/);
    expect(() => applyRecipe(recipeWith({ colorMode: 'colour' as never }))).toThrow(/"colour" is not a colour mode/);
    expect(() => applyRecipe(recipeWith({ toleranceMm: 'fine' as never }))).toThrow(/toleranceMm/);
    expect(() => applyRecipe(recipeWith({ cutline: 'yes' as never }))).toThrow(/cutline/);
    // A recipe as the app writes it still applies.
    expect(applyRecipe(recipeWith({ shapes: 'centerline', colorMode: 'color' }))(blankDoc()).vector.shapes).toBe('centerline');
  });

  it('a trace called with either value throws instead of tracing in Auto mode', () => {
    expect(() => runTrace(wasm, img, 40, 40, { shapes: 'centreline' as never })).toThrow(/"centreline" is not a shape mode/);
    expect(() => runTrace(wasm, img, 40, 40, { colorMode: 'colour' as never })).toThrow(/"colour" is not a colour mode/);
  });
});

describe('#88: a palette larger than the tracer takes is refused', () => {
  const img = new Uint8Array(bands(40, 40, [[0, 0, 0], [255, 255, 255]]));
  const palette = (n: number) => Array.from({ length: n }, (_, i) => entry(`#${i.toString(16).padStart(6, '0')}`));

  it('33 and 256 colours are errors stating the limit, in the tracer and in a recipe', () => {
    expect(MAX_PALETTE).toBe(32);
    for (const n of [33, 256]) {
      const message = `The palette has ${n} colours; the most the tracer takes is 32.`;
      expect(() => runTrace(wasm, img, 40, 40, { colorMode: 'color', palette: palette(n) })).toThrow(message);
      expect(() => applyRecipe(recipeWith({ palette: palette(n) }))).toThrow(message);
    }
    expect(runTrace(wasm, img, 40, 40, { colorMode: 'color', palette: palette(32) }).palette.length).toBe(32);
  });

  it('a merge into a colour the palette does not have is refused', () => {
    const bad = [entry('#000000'), { ...entry('#ffffff'), mergeInto: 7 }];
    expect(() => runTrace(wasm, img, 40, 40, { colorMode: 'color', palette: bad })).toThrow(/merged into colour 7/);
  });
});

describe('#89: one list of what a trace reads', () => {
  it('every part of traceInputsOf re-traces when it changes, and nothing else does', async () => {
    store().open(await loadPixels(pipeline.api, bands(120, 80, [[255, 255, 255], [0, 0, 0], [255, 255, 255]]), 120, 80), 0.1);
    await pipeline.settled();
    // An edit that changes each part of the document the trace reads (the source is a new document).
    const edits: Record<string, DocumentUpdate> = {
      mmPerPx: setScale(0.2),
      rotation: rotate('cw'),
      crop: setCrop({ x: 10, y: 10, width: 100, height: 60 }),
      tonal: setTonal({ contrast: 20 }),
      color: setColor({ saturation: 10 }),
      detail: setDetail({ unsharpStrength: 50 }),
      vector: setVector({ toleranceMm: 0.1 }),
    };
    expect(Object.keys(traceInputsOf(store().doc!)).sort()).toEqual([...Object.keys(edits), 'source'].sort());
    for (const [part, edit] of Object.entries(edits)) {
      const before = traces;
      const inputs = traceInputsOf(store().doc!);
      store().edit(edit);
      expect(traceInputsOf(store().doc!)[part as keyof typeof inputs], part).not.toEqual(inputs[part as keyof typeof inputs]);
      await pipeline.settled();
      expect(traces, part).toBe(before + 1);
      expect(traceIsCurrent(), part).toBe(true);
    }
  });
});

describe('#91: recolouring a layer does not trace again', () => {
  it('the layer and the exported file change colour; the paths are the ones already traced', async () => {
    store().open(await loadPixels(pipeline.api, bands(120, 40, [[255, 255, 255], [0, 0, 0], [30, 60, 220]]), 120, 40), 0.1);
    const fixed = [entry('#ffffff'), entry('#000000'), entry('#1e3cdc')];
    store().edit(setVector({ colorMode: 'color', shapes: 'outline', palette: fixed }));
    await pipeline.settled();
    const shown = render().vectorResult!;
    const blue = shown.layers.find((l) => l.color === '#1e3cdc')!;
    const before = traces;

    store().edit(setVector({ palette: editPalette(fixed, 2, { drawAs: '#00ff00' }) }));
    await pipeline.settled();
    expect(traces).toBe(before);
    expect(traceIsCurrent()).toBe(true);
    expect(render().isVectorStale).toBe(false);
    const green = render().vectorResult!.layers.find((l) => l.paletteIndex === blue.paletteIndex)!;
    expect(green.color).toBe('#00ff00');
    expect(green.sourceColor).toBe('#1e3cdc');
    expect(green.paths).toBe(blue.paths);
    const file = await exportedSvg(pipeline.api, store().doc!, render().vectorResult!);
    expect(file.layers.map((l) => l.color)).toContain('#00ff00');
    expect(file.layers.map((l) => l.color)).not.toContain('#1e3cdc');

    // Undo puts the colour back, again without a trace.
    store().undo();
    await pipeline.settled();
    expect(traces).toBe(before);
    const back = render().vectorResult!.layers.find((l) => l.paletteIndex === blue.paletteIndex)!;
    expect(back.color).toBe('#1e3cdc');
    expect(back.sourceColor).toBeUndefined();
  });
});

describe('#87: a hidden colour stays hidden when a re-trace finds it a little different', () => {
  it('an adjustment that shifts the colours leaves the layer hidden, on screen and in the file', async () => {
    store().open(await loadPixels(pipeline.api, bands(120, 40, [[250, 250, 245], [20, 20, 20], [200, 40, 40]]), 120, 40), 0.1);
    store().edit(setVector({ colorMode: 'color', colorCount: 3, shapes: 'outline' }));
    await pipeline.settled();
    const first = render().vectorResult!;
    const paper = first.layers.find((l) => l.color === first.palette[first.palette.indexOf(l.color)] && parseInt(l.color.slice(1, 3), 16) > 200 && parseInt(l.color.slice(3, 5), 16) > 200)!;
    render().toggleVectorLayer(paper.id);

    store().edit(setTonal({ brightness: 3 }));
    await pipeline.settled();
    const second = render().vectorResult!;
    // The trace found the colours again, and they moved.
    expect(second.palette).not.toEqual(first.palette);
    const hidden = second.layers.filter((l) => !l.visible);
    expect(hidden.length).toBe(1);
    expect(parseInt(hidden[0].color.slice(3, 5), 16)).toBeGreaterThan(200);
    const file = await exportedSvg(pipeline.api, store().doc!, second);
    expect(file.layers.length).toBe(second.layers.length - 1);
    expect(file.layers.map((l) => l.color)).not.toContain(hidden[0].color);

    // Showing it again works on the layer as it is now.
    render().toggleVectorLayer(hidden[0].id);
    expect(render().vectorResult!.layers.every((l) => l.visible)).toBe(true);
    expect(render().hiddenLayers).toEqual([]);
  });

  it('a colour that is really a different one is not hidden in its place', async () => {
    store().open(await loadPixels(pipeline.api, bands(120, 40, [[250, 250, 245], [20, 20, 20]]), 120, 40), 0.1);
    store().edit(setVector({ colorMode: 'color', colorCount: 2, shapes: 'outline' }));
    await pipeline.settled();
    const paper = render().vectorResult!.layers.find((l) => parseInt(l.color.slice(1, 3), 16) > 200)!;
    render().toggleVectorLayer(paper.id);
    // The same document traced with a fixed palette whose light colour is far from the paper found.
    store().edit(setVector({ palette: [entry('#b4b4ff'), entry('#141414')] }));
    await pipeline.settled();
    expect(render().vectorResult!.layers.every((l) => l.visible)).toBe(true);
  });
});

it('#91 with #23: paletteFromResult of a recoloured trace keeps the colours matched', async () => {
  store().open(await loadPixels(pipeline.api, bands(120, 40, [[255, 255, 255], [0, 0, 0]]), 120, 40), 0.1);
  store().edit(setVector({ colorMode: 'color', shapes: 'outline', palette: [entry('#ffffff'), { ...entry('#000000'), drawAs: '#ff0000' }] }));
  await pipeline.settled();
  expect(paletteFromResult(render().vectorResult!)!.map((e) => e.color)).toEqual(['#ffffff', '#000000']);
});
