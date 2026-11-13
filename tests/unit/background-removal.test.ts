/**
 * Background removal as an edit step (#50): stored as settings in the
 * document, applied in the pipeline from a mask the model computes for the
 * image as turned and cropped. Driven through the document store and the real
 * pipeline, with a stand-in model whose answer is known exactly.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { setBackground, setCrop } from '../../src/lib/document';
import { maskKey, type MaskModel } from '../../src/lib/background';
import { exportRaster } from '../../src/lib/raster-export';
import { nativeTarget } from '../../src/lib/render-target';
import { loadPinnedModel, sha256Hex } from '../../src/lib/model-file';
import { isnetInput, probabilityBytes } from '../../src/lib/bg-model';
import { resetStores } from '../helpers/documents';
import { loadPixels, startTestPipeline, type TestPipeline } from '../helpers/pipeline';
import { decodePng } from '../helpers/png-decode';

const W = 300;
const H = 200;
const RED: [number, number, number] = [200, 40, 40];
const BLUE: [number, number, number] = [30, 30, 220];

/** Subject: a blue rectangle (100..220, 50..200), touching the bottom edge like a portrait. Background: red. */
function isSubject(x: number, y: number): boolean {
  return x >= 100 && x < 220 && y >= 50;
}

function picture(): ArrayBuffer {
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      out.set([...(isSubject(x, y) ? BLUE : RED), 255], (y * W + x) * 4);
    }
  }
  return out.buffer;
}

/** A stand-in model at `size`: the subject is whatever is blue in the image it is given. */
function blueModel(size = { widthPx: W, heightPx: H }): MaskModel & { runs: number } {
  const model = {
    runs: 0,
    inputSize: size,
    predict: async (rgba: Uint8Array) => {
      model.runs++;
      const mask = new Uint8Array(size.widthPx * size.heightPx);
      for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4 + 2] > 128 ? 255 : 0;
      return mask;
    },
  };
  return model;
}

let pipeline: TestPipeline;
const store = () => useDocumentStore.getState();
const render = () => useRenderStore.getState();

beforeAll(async () => {
  pipeline = await startTestPipeline();
});
afterAll(() => pipeline.stop());
beforeEach(() => {
  resetStores();
  pipeline.api.setMaskModel(blueModel());
});

async function open(): Promise<void> {
  store().open(await loadPixels(pipeline.api, picture(), W, H), 0.1);
  await pipeline.settled();
}

/** The preview's pixel at (x, y) of the current crop. */
function previewAt(x: number, y: number): number[] {
  const src = render().source!;
  const i = (y * src.width + x) * 4;
  return [...new Uint8Array(render().processed!).slice(i, i + 3)];
}

const WHITE = [255, 255, 255];

describe('background removal is one undoable step', () => {
  it('Remove Background then Undo and Redo: each is one step, and only the removal changes', async () => {
    await open();
    expect(previewAt(10, 10)).toEqual(RED);
    store().edit(setBackground({ enabled: true }));
    await pipeline.settled();
    expect(previewAt(10, 10)).toEqual(WHITE);
    expect(previewAt(150, 150)).toEqual(BLUE);

    store().undo();
    await pipeline.settled();
    expect(store().doc!.steps.background.enabled).toBe(false);
    expect(previewAt(10, 10)).toEqual(RED);

    store().redo();
    await pipeline.settled();
    expect(previewAt(10, 10)).toEqual(WHITE);
  });

  it("the owner's sequence: crop, remove, undo, undo, redo", async () => {
    await open();
    const crop = { x: 50, y: 20, width: 200, height: 150 };
    store().edit(setCrop(crop));
    store().edit(setBackground({ enabled: true }));
    await pipeline.settled();
    expect(previewAt(5, 5)).toEqual(WHITE); // (55, 25): background

    // The first undo takes back the removal alone; the crop stays.
    store().undo();
    await pipeline.settled();
    expect(store().doc!.steps.crop).toEqual(crop);
    expect(store().doc!.steps.background.enabled).toBe(false);
    expect(previewAt(5, 5)).toEqual(RED);

    // The second takes back the crop.
    store().undo();
    await pipeline.settled();
    expect(store().doc!.steps.crop).toBeNull();
    expect(render().source!.width).toBe(W);

    // Redo brings back the crop, without the removal.
    store().redo();
    await pipeline.settled();
    expect(store().doc!.steps.crop).toEqual(crop);
    expect(store().doc!.steps.background.enabled).toBe(false);
    expect(previewAt(5, 5)).toEqual(RED);
  });

  it('removing the background then cropping keeps the removal; undoing that crop undoes only the crop, and the removal applies to the restored image', async () => {
    await open();
    store().edit(setBackground({ enabled: true }));
    await pipeline.settled();
    store().edit(setCrop({ x: 0, y: 0, width: 160, height: 120 }));
    await pipeline.settled();
    expect(store().doc!.steps.background.enabled).toBe(true);
    expect(previewAt(10, 10)).toEqual(WHITE);
    expect(previewAt(130, 100)).toEqual(BLUE);

    store().undo();
    await pipeline.settled();
    expect(store().doc!.steps.crop).toBeNull();
    expect(store().doc!.steps.background.enabled).toBe(true);
    expect(previewAt(10, 10)).toEqual(WHITE);
    expect(previewAt(290, 190)).toEqual(WHITE);
    expect(previewAt(150, 150)).toEqual(BLUE);
  });

  it('the mask is derived: computed once per crop, recomputed for a new crop, reused on undo', async () => {
    const model = blueModel();
    pipeline.api.setMaskModel(model);
    await open();
    store().edit(setBackground({ enabled: true }));
    await pipeline.settled();
    expect(model.runs).toBe(1);
    store().edit(setBackground({ softness: 10 }));
    await pipeline.settled();
    expect(model.runs).toBe(1);
    store().edit(setCrop({ x: 0, y: 0, width: 160, height: 120 }));
    await pipeline.settled();
    expect(model.runs).toBe(2);
    store().undo();
    await pipeline.settled();
    expect(model.runs).toBe(2);
    // The document holds settings only, never pixels.
    expect(JSON.stringify(store().doc!.steps.background)).toBe('{"enabled":true,"cutoff":50,"softness":10}');
  });
});

describe('the mask makes exactly the masked pixels white', () => {
  /** Pixels that differ from what removal should give: white for background, unchanged for subject. */
  function wrongPixels(rgba: Uint8Array, w: number, h: number, ox = 0, oy = 0): number {
    let wrong = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const want = isSubject(x + ox, y + oy) ? BLUE : WHITE;
        const i = (y * w + x) * 4;
        if (rgba[i] !== want[0] || rgba[i + 1] !== want[1] || rgba[i + 2] !== want[2]) wrong++;
      }
    }
    return wrong;
  }

  it('in the preview', async () => {
    await open();
    store().edit(setBackground({ enabled: true, softness: 0 }));
    await pipeline.settled();
    expect(wrongPixels(new Uint8Array(render().processed!), W, H)).toBe(0);
  });

  it('in a full-resolution PNG export', async () => {
    // A source larger than the preview, so the export renders at its own size.
    const [bw, bh] = [3000, 2000];
    const big = new Uint8Array(bw * bh * 4);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) big.set([...(isSubject(x / 10, y / 10) ? BLUE : RED), 255], (y * bw + x) * 4);
    }
    pipeline.api.setMaskModel(blueModel({ widthPx: bw, heightPx: bh }));
    store().open(await loadPixels(pipeline.api, big.buffer, bw, bh), 0.05);
    store().edit(setBackground({ enabled: true, softness: 0 }));
    await pipeline.settled();
    const file = await exportRaster(store().doc!, 'png');
    const png = decodePng(new Uint8Array(file!.bytes));
    expect([png.width, png.height]).toEqual([bw, bh]);
    let wrong = 0;
    for (let y = 0; y < bh; y += 7) {
      for (let x = 0; x < bw; x += 7) {
        const want = isSubject(x / 10, y / 10) ? BLUE : WHITE;
        const i = (y * bw + x) * png.channels;
        if (png.samples[i] !== want[0] || png.samples[i + 1] !== want[1] || png.samples[i + 2] !== want[2]) wrong++;
      }
    }
    expect(wrong).toBe(0);
  });

  it('a mask at a fifth of the size is upsampled with its edge in place', async () => {
    pipeline.api.setMaskModel(blueModel({ widthPx: 60, heightPx: 40 }));
    await open();
    store().edit(setBackground({ enabled: true, softness: 0 }));
    await pipeline.settled();
    const out = new Uint8Array(render().processed!);
    // Away from the edge (more than one mask pixel, 5 px), everything is exact.
    let wrongInside = 0;
    let wrongEdge = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const near = Math.min(Math.abs(x - 100), Math.abs(x - 220), Math.abs(y - 50)) < 5 && y >= 45 && x >= 95 && x < 225;
        const want = isSubject(x, y) ? BLUE : WHITE;
        const i = (y * W + x) * 4;
        const bad = out[i] !== want[0] || out[i + 2] !== want[2];
        if (bad && near) wrongEdge++;
        else if (bad) wrongInside++;
      }
    }
    expect(wrongInside).toBe(0);
    // The edge lies within a pixel of where it should: at most one wrong pixel per edge pixel of the outline.
    expect(wrongEdge).toBeLessThanOrEqual(120 + 2 * 150);
  });
});

describe('failure is reported, never substituted', () => {
  it('with no model installed, the preview and the render fail with the reason, and nothing is removed', async () => {
    pipeline.api.setMaskModel(null);
    await open();
    const doc = store().doc!;
    await expect(pipeline.api.backgroundPreview(doc, nativeTarget(doc))).rejects.toThrow(/no segmentation model/);
    store().edit(setBackground({ enabled: true }));
    await pipeline.settled();
    expect(render().errorMessage).toMatch(/no segmentation model/);
    // The preview shown is still the image as it was, not a guess.
    expect(previewAt(10, 10)).toEqual(RED);
  });

  it('a model that cannot be downloaded reports why', async () => {
    pipeline.api.setMaskModel({
      inputSize: { widthPx: 8, heightPx: 8 },
      predict: () => Promise.reject(new Error('Could not download the background removal model (offline).')),
    });
    await open();
    const doc = store().doc!;
    await expect(pipeline.api.backgroundPreview(doc, nativeTarget(doc))).rejects.toThrow(/offline/);
    expect(pipeline.api.hasBackgroundMask(doc)).toBe(false);
  });

  it('the preview gives the image without removal and the coverage, before anything is applied', async () => {
    await open();
    const doc = store().doc!;
    const p = await pipeline.api.backgroundPreview(doc, nativeTarget(doc));
    const alpha = new Uint8Array(p.alpha);
    expect(alpha[10 * W + 10]).toBe(0);
    expect(alpha[150 * W + 150]).toBe(255);
    expect([...new Uint8Array(p.original).slice(0, 3)]).toEqual(RED);
    expect(store().doc!.steps.background.enabled).toBe(false);
    expect(pipeline.api.hasBackgroundMask(doc)).toBe(true);
    expect(maskKey(doc)).toContain(doc.source.sourceId);
  });
});

describe('the pinned model file', () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
  const respond = (body: Uint8Array) => new Response(body.slice());

  it('joins its parts, checks its hash and reports bytes downloaded', async () => {
    const sha256 = await sha256Hex(bytes.slice().buffer);
    const seen: number[] = [];
    const parts: Record<string, Uint8Array> = { a: bytes.slice(0, 4), b: bytes.slice(4) };
    const got = await loadPinnedModel({ parts: ['a', 'b'], bytes: 7, sha256 }, (p) => p.stage === 'downloading' && seen.push(p.loadedBytes), (async (url: string) =>
      respond(parts[url])) as unknown as typeof fetch);
    expect([...new Uint8Array(got)]).toEqual([...bytes]);
    expect(seen.at(-1)).toBe(7);
  });

  it('refuses a file whose hash does not match', async () => {
    await expect(
      loadPinnedModel({ parts: ['a'], bytes: 7, sha256: '0'.repeat(64) }, () => undefined, (async () => respond(bytes)) as unknown as typeof fetch)
    ).rejects.toThrow(/checksum/);
  });

  it('reports a failed download (network blocked)', async () => {
    await expect(
      loadPinnedModel({ parts: ['a'], bytes: 7, sha256: '0'.repeat(64) }, () => undefined, (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch)
    ).rejects.toThrow(/Could not download the background removal model \(Failed to fetch\)/);
  });

  it('ISNet input is channel-planar x / 255 - 0.5, and its output is stored as bytes', () => {
    const input = isnetInput(new Uint8Array([255, 0, 128, 255, 0, 255, 0, 255]), 2);
    expect([...input].map((v) => Math.round(v * 1000) / 1000)).toEqual([0.5, -0.5, -0.5, 0.5, 0.002, -0.5]);
    expect([...probabilityBytes([0, 0.5, 1, 1.2])]).toEqual([0, 128, 255, 255]);
  });
});
