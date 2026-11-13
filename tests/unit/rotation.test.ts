/**
 * Rotation by quarter turns (#65): a real edit step, in the `source` stage,
 * with the crop in the turned image's frame.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';
import { PipelineEngine } from '../../src/lib/pipeline-engine';
import { RustWasmEngine, type WasmExports } from '../../src/wasm/wasm-bridge';
import { createDocument, resetAll, rotate, setCrop, setScale } from '../../src/lib/document';
import { cropRectOf, frameSizeOf, physicalSize, sourceCropOf } from '../../src/lib/document-size';
import { nativeTarget, sourceStageKey } from '../../src/lib/render-target';
import type { ImageDocument, Rotation } from '../../src/types/document';
import { decodedImage, labelledImage, labelOf, resetStores, currentDoc } from '../helpers/documents';
import { loadWasm } from '../helpers/wasm';

const [W, H] = [7, 4];
let engine: PipelineEngine;
beforeAll(async () => {
  const wasm = await loadWasm({ fresh: true });
  engine = new PipelineEngine(RustWasmEngine.fromExports(wasm.exports as unknown as WasmExports));
  engine.putSource('s', labelledImage(W, H), W, H);
});
beforeEach(() => resetStores());

const base = (): ImageDocument =>
  createDocument('d', { sourceId: 's', name: 's.png', widthPx: W, heightPx: H, format: 'rgba8', hasAlpha: false, fileDpi: null }, 0.5);
const turned = (quarterTurns: number): ImageDocument => {
  let doc = base();
  for (let i = 0; i < quarterTurns; i++) doc = rotate('cw')(doc);
  return doc;
};

/** The source pixel that a clockwise turn of `rotation` puts at (x, y) of the turned image. */
function sourceOf(rotation: Rotation, x: number, y: number): [number, number] {
  switch (rotation) {
    case 90:
      return [y, H - 1 - x];
    case 180:
      return [W - 1 - x, H - 1 - y];
    case 270:
      return [W - 1 - y, x];
    default:
      return [x, y];
  }
}

function rendered(doc: ImageDocument) {
  const target = nativeTarget(doc);
  const out = engine.render(doc, target, 'source');
  return { target, px: new Uint8Array(out.pixels) };
}

describe('rotation (#65)', () => {
  it.each([0, 1, 2, 3])('%i quarter turns: every pixel is the source pixel the turn puts there', (turns) => {
    const doc = turned(turns);
    const rotation = (turns * 90) as Rotation;
    expect(doc.steps.rotation).toBe(rotation);
    const { target, px } = rendered(doc);
    expect([target.widthPx, target.heightPx]).toEqual(turns % 2 ? [H, W] : [W, H]);
    for (let y = 0; y < target.heightPx; y++) {
      for (let x = 0; x < target.widthPx; x++) {
        const i = (y * target.widthPx + x) * 4;
        expect([px[i], px[i + 1], px[i + 2], px[i + 3]], `(${x}, ${y})`).toEqual([...labelOf(...sourceOf(rotation, x, y)), 255]);
      }
    }
  });

  it.each([1, 2, 3])('%i quarter turns, cropped: the crop is in the turned frame, and every pixel is checked', (turns) => {
    const doc = setCrop({ x: 1, y: 2, width: 2, height: 2 })(turned(turns));
    const rotation = doc.steps.rotation;
    const { target, px } = rendered(doc);
    expect([target.widthPx, target.heightPx]).toEqual([2, 2]);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const i = (y * 2 + x) * 4;
        expect([px[i], px[i + 1], px[i + 2]], `(${x}, ${y})`).toEqual(labelOf(...sourceOf(rotation, x + 1, y + 2)));
      }
    }
    // The crop read from the source lies inside it.
    const s = sourceCropOf(doc);
    expect(s.x >= 0 && s.y >= 0 && s.x + s.width <= W && s.y + s.height <= H).toBe(true);
  });

  it('turning a cropped image keeps the same part of the picture, both ways', () => {
    const cropped = setCrop({ x: 1, y: 1, width: 4, height: 2 })(base());
    const before = rendered(cropped);
    for (const direction of ['cw', 'ccw'] as const) {
      const doc = rotate(direction)(cropped);
      expect(cropRectOf(doc).width).toBe(2);
      expect(cropRectOf(doc).height).toBe(4);
      // The same source pixels, turned: turning back gives the first render.
      const back = rotate(direction === 'cw' ? 'ccw' : 'cw')(doc);
      expect(back.steps).toEqual(cropped.steps);
      expect(sourceCropOf(doc)).toEqual(sourceCropOf(cropped));
      expect(rendered(back).px).toEqual(before.px);
    }
  });

  it('width and height in millimetres swap at the same scale; four turns are the image again', () => {
    const doc = base();
    expect(physicalSize(doc)).toEqual({ widthMm: 3.5, heightMm: 2 });
    const quarter = rotate('cw')(doc);
    expect(frameSizeOf(quarter)).toEqual({ widthPx: H, heightPx: W });
    expect(physicalSize(quarter)).toEqual({ widthMm: 2, heightMm: 3.5 });
    expect(quarter.mmPerPx).toBe(doc.mmPerPx);
    expect(physicalSize(rotate('cw')(quarter))).toEqual({ widthMm: 3.5, heightMm: 2 });
    expect(turned(4)).toEqual(doc);
    expect(rotate('ccw')(rotate('cw')(doc))).toEqual(doc);
    // A turned image is a different render of the same source.
    expect(sourceStageKey(quarter, nativeTarget(quarter))).not.toBe(sourceStageKey(turned(3), nativeTarget(turned(3))));
  });

  it('undo restores the previous orientation; Reset All removes the turn', () => {
    const store = () => useDocumentStore.getState();
    store().open(decodedImage(W, H));
    store().edit(setScale(0.5));
    store().edit(rotate('cw'));
    store().edit(rotate('cw'));
    expect(currentDoc().steps.rotation).toBe(180);
    store().undo();
    expect(currentDoc().steps.rotation).toBe(90);
    store().undo();
    expect(currentDoc().steps.rotation).toBe(0);
    store().redo();
    expect(currentDoc().steps.rotation).toBe(90);
    store().edit(resetAll);
    expect(currentDoc().steps.rotation).toBe(0);
  });

  it('a crop cannot leave the turned frame', () => {
    const doc = setCrop({ x: 0, y: 0, width: 100, height: 100 })(rotate('cw')(base()));
    expect(doc.steps.crop).toBeNull();
    expect(setCrop({ x: 2, y: 3, width: 100, height: 100 })(rotate('cw')(base())).steps.crop).toEqual({ x: 2, y: 3, width: 2, height: 4 });
  });
});
