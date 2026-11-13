/**
 * The document store's history (design section 1, issue #21 rows): every
 * change goes through `edit` or a gesture, each makes exactly one undo entry,
 * undo restores the previous document by value, a change that alters nothing
 * records nothing, and interrupted gestures behave as defined.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useDocumentStore, HISTORY_LIMIT, hasUnsavedEdits, setGestureEndTarget } from '../../src/store/documentStore';
import {
  applyRecipe,
  DEFAULT_DITHER,
  resetAll,
  setColor,
  setCrop,
  setDepth,
  setDetail,
  setDither,
  setScale,
  setTonal,
  setVector,
} from '../../src/lib/document';
import type { DocumentUpdate, ImageDocument } from '../../src/types/document';
import { RECIPE_VERSION } from '../../src/types/recipe';
import { currentDoc, decodedImage, resetStores } from '../helpers/documents';

const store = () => useDocumentStore.getState();

/** A deep copy, so later changes cannot alias what the test compares against. */
function snapshot(doc: ImageDocument): ImageDocument {
  return structuredClone(doc);
}

let windowStandIn: EventTarget;

/** An event target that counts the listeners attached to it. */
class CountingTarget extends EventTarget {
  listeners = 0;
  addEventListener(...args: Parameters<EventTarget['addEventListener']>): void {
    this.listeners++;
    super.addEventListener(...args);
  }
  removeEventListener(...args: Parameters<EventTarget['removeEventListener']>): void {
    this.listeners--;
    super.removeEventListener(...args);
  }
}

beforeEach(() => {
  resetStores();
  windowStandIn = new EventTarget();
  setGestureEndTarget(windowStandIn);
  store().open(decodedImage(40, 30));
});

afterEach(() => {
  setGestureEndTarget(null);
});

/** One of each kind of edit the panels make. */
const EDITS: Array<[string, DocumentUpdate]> = [
  ['tone', setTonal({ contrast: 30 })],
  ['colour', setColor({ saturation: -100 })],
  ['detail', setDetail({ unsharpStrength: 80, unsharpRadiusMm: 0.2 })],
  ['dither', setDither({ algorithm: 'atkinson' })],
  ['crop', setCrop({ x: 4, y: 3, width: 20, height: 10 })],
  ['scale', setScale(0.1)],
  ['tracing', setVector({ shapes: 'centerline', threshold: 90 })],
  ['relief', setDepth({ bevelWidthMm: 5 })],
  ['reset all', (d) => resetAll(setTonal({ brightness: 10 })(d))],
  [
    'recipe',
    applyRecipe({
      version: RECIPE_VERSION,
      name: 'r',
      createdAt: 0,
      updatedAt: 0,
      steps: [{ id: '1', type: 'dither', enabled: true, timestamp: 0, params: { ...DEFAULT_DITHER, algorithm: 'floyd-steinberg' } }],
    }),
  ],
];

describe('edit', () => {
  it.each(EDITS)('a %s edit makes exactly one undo entry, and undo restores the previous document by value', (_, update) => {
    // Start from a non-default document so that resets change something.
    store().edit(setTonal({ brightness: 25 }));
    const before = snapshot(currentDoc());
    const entries = store().past.length;

    store().edit(update);
    const after = snapshot(currentDoc());
    expect(after).not.toEqual(before);
    expect(store().past.length).toBe(entries + 1);
    expect(store().future.length).toBe(0);

    store().undo();
    expect(currentDoc()).toEqual(before);
    expect(store().past.length).toBe(entries);

    store().redo();
    expect(currentDoc()).toEqual(after);
  });

  it('records nothing for a change that alters nothing, and keeps the document and version', () => {
    store().edit(setTonal({ contrast: 10 }));
    const doc = currentDoc();
    const { version, past, future } = store();

    store().edit(setTonal({ contrast: 10 }));
    store().edit((d) => ({ ...d, steps: { ...d.steps } }));
    store().edit(setCrop({ x: 0, y: 0, width: 40, height: 30 })); // the whole image is no crop
    store().edit(setCrop({ x: 100, y: 100, width: 5, height: 5 })); // outside the image

    expect(store().doc).toBe(doc);
    expect(store().version).toBe(version);
    expect(store().past).toBe(past);
    expect(store().future).toBe(future);
  });

  it('a no-op edit does not clear the redo stack', () => {
    store().edit(setTonal({ contrast: 10 }));
    store().undo();
    const future = store().future;
    store().edit(setTonal({ contrast: 0 }));
    expect(store().future).toBe(future);
  });

  it('shares unchanged parts by reference', () => {
    const before = currentDoc();
    store().edit(setTonal({ contrast: 10 }));
    const after = currentDoc();
    expect(after.steps.dither).toBe(before.steps.dither);
    expect(after.vector).toBe(before.vector);
    expect(after.source).toBe(before.source);
    expect(after.steps.tonal).not.toBe(before.steps.tonal);
  });

  it(`keeps at most ${HISTORY_LIMIT} entries`, () => {
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) store().edit(setTonal({ brightness: i }));
    expect(store().past.length).toBe(HISTORY_LIMIT);
    expect(store().past[0].steps.tonal.brightness).toBe(10);
  });

  it('increases the version on every change, including undo and redo, even back to an equal document', () => {
    const versions = [store().version];
    store().edit(setTonal({ contrast: 10 }));
    versions.push(store().version);
    store().undo();
    versions.push(store().version);
    store().redo();
    versions.push(store().version);
    for (let i = 1; i < versions.length; i++) expect(versions[i]).toBeGreaterThan(versions[i - 1]);
  });
});

describe('gestures', () => {
  it('update the document live with no entries, then make one entry when they end', () => {
    const before = snapshot(currentDoc());
    const token = store().beginGesture();
    for (let v = 1; v <= 20; v++) store().updateGesture(token, setTonal({ brightness: v }));
    expect(currentDoc().steps.tonal.brightness).toBe(20);
    expect(store().past.length).toBe(0);

    store().endGesture(token);
    expect(store().past.length).toBe(1);
    expect(store().gesture).toBeNull();

    store().undo();
    expect(currentDoc()).toEqual(before);
  });

  it('record nothing when they end where they began', () => {
    const token = store().beginGesture();
    store().updateGesture(token, setTonal({ brightness: 40 }));
    store().updateGesture(token, setTonal({ brightness: 0 }));
    store().endGesture(token);
    expect(store().past.length).toBe(0);
    expect(store().future.length).toBe(0);
  });

  it('ignore a second end, and updates and ends from a gesture that is over', () => {
    const first = store().beginGesture();
    store().updateGesture(first, setTonal({ brightness: 10 }));
    store().endGesture(first);
    store().endGesture(first);
    expect(store().past.length).toBe(1);

    const doc = currentDoc();
    store().updateGesture(first, setTonal({ brightness: 99 }));
    expect(store().doc).toBe(doc);

    const second = store().beginGesture();
    store().endGesture(first); // late end of the first gesture
    expect(store().gesture?.token).toBe(second);
    store().updateGesture(second, setTonal({ brightness: 20 }));
    store().endGesture(second);
    expect(store().past.length).toBe(2);
  });

  it('a new gesture ends the one in progress, recording it', () => {
    const first = store().beginGesture();
    store().updateGesture(first, setTonal({ brightness: 10 }));
    const second = store().beginGesture();
    expect(store().past.length).toBe(1);
    store().updateGesture(first, setTonal({ brightness: 99 }));
    expect(currentDoc().steps.tonal.brightness).toBe(10);
    store().endGesture(second);
  });
});

describe('interrupted gestures', () => {
  it('undo during a gesture cancels it: the document returns to before it, nothing is recorded, and nothing more is undone', () => {
    store().edit(setTonal({ contrast: 15 }));
    const before = snapshot(currentDoc());
    const token = store().beginGesture();
    store().updateGesture(token, setTonal({ brightness: 50 }));

    store().undo();

    expect(currentDoc()).toEqual(before);
    expect(store().gesture).toBeNull();
    expect(store().past.length).toBe(1); // the contrast edit is still there
    expect(store().future.length).toBe(0);

    // The rest of the drag is ignored, and its end records nothing.
    store().updateGesture(token, setTonal({ brightness: 60 }));
    store().endGesture(token);
    expect(currentDoc()).toEqual(before);
    expect(store().past.length).toBe(1);
  });

  it('redo during a gesture also cancels it and redoes nothing', () => {
    store().edit(setTonal({ contrast: 15 }));
    store().undo();
    const before = snapshot(currentDoc());
    const token = store().beginGesture();
    store().updateGesture(token, setTonal({ brightness: 50 }));

    store().redo();

    expect(currentDoc()).toEqual(before);
    expect(store().future.length).toBe(1);
    store().endGesture(token);
  });

  it('cancelling gives a new version, so a result for the gesture is not taken as current', () => {
    const token = store().beginGesture();
    store().updateGesture(token, setTonal({ brightness: 50 }));
    const during = store().version;
    store().undo();
    expect(store().version).toBeGreaterThan(during);
  });

  it('edit during a gesture ends the gesture first, recording it, then records the edit as its own entry', () => {
    const start = snapshot(currentDoc());
    const token = store().beginGesture();
    store().updateGesture(token, setTonal({ brightness: 30 }));
    const afterGesture = snapshot(currentDoc());

    store().edit(setDither({ algorithm: 'atkinson' }));

    expect(store().gesture).toBeNull();
    expect(store().past.length).toBe(2);
    store().updateGesture(token, setTonal({ brightness: 90 }));
    expect(currentDoc().steps.tonal.brightness).toBe(30);

    store().undo();
    expect(currentDoc()).toEqual(afterGesture);
    store().undo();
    expect(currentDoc()).toEqual(start);
  });

  it('loading a file during a gesture discards the gesture along with the old document', async () => {
    const token = store().beginGesture();
    store().updateGesture(token, setTonal({ brightness: 30 }));

    await store().load(new File([], 'next.png'), async () => decodedImage(12, 9, null, 'next.png'));

    expect(store().gesture).toBeNull();
    expect(currentDoc().source.name).toBe('next.png');
    expect(currentDoc().steps.tonal.brightness).toBe(0);
    expect(store().past.length).toBe(0);
    expect(store().future.length).toBe(0);

    // The old gesture's late calls do not touch the new document.
    const doc = currentDoc();
    store().updateGesture(token, setTonal({ brightness: 70 }));
    store().endGesture(token);
    expect(store().doc).toBe(doc);
    expect(store().past.length).toBe(0);
  });

  it.each(['pointerup', 'pointercancel', 'blur'])(
    'a gesture whose end never arrives is ended by a window %s',
    (type) => {
      const token = store().beginGesture();
      store().updateGesture(token, setTonal({ brightness: 30 }));

      windowStandIn.dispatchEvent(new Event(type));

      expect(store().gesture).toBeNull();
      expect(store().past.length).toBe(1);
      store().updateGesture(token, setTonal({ brightness: 90 }));
      expect(currentDoc().steps.tonal.brightness).toBe(30);
    }
  );

  it('removes its window listeners when it ends, is cancelled or is discarded by a load', async () => {
    const counting = new CountingTarget();
    setGestureEndTarget(counting);

    const ended = store().beginGesture();
    expect(counting.listeners).toBe(3);
    store().endGesture(ended);
    expect(counting.listeners).toBe(0);

    const byWindow = store().beginGesture();
    counting.dispatchEvent(new Event('pointerup'));
    expect(store().gesture).toBeNull();
    expect(counting.listeners).toBe(0);
    store().endGesture(byWindow);

    const cancelled = store().beginGesture();
    store().updateGesture(cancelled, setTonal({ brightness: 5 }));
    store().undo();
    expect(counting.listeners).toBe(0);

    store().beginGesture();
    await store().load(new File([], 'n.png'), async () => decodedImage(4, 4));
    expect(counting.listeners).toBe(0);
  });
});

describe('loading', () => {
  it("starts at the file's resolution, with default steps and no history", async () => {
    store().edit(setScale(0.1));
    await store().load(new File([], 'b.png'), async () => decodedImage(10, 10, 96, 'b.png'));
    const doc = currentDoc();
    expect(doc.mmPerPx).toBeCloseTo(25.4 / 96, 12);
    expect(doc.sizeOrigin).toBe('file');
    expect(doc.source.fileDpi).toBe(96);
    expect(doc.steps.crop).toBeNull();
    expect(store().past.length).toBe(0);
  });

  it('gives every load a new id, and the later of two overlapping loads wins', async () => {
    const firstId = currentDoc().id;
    let releaseSlow: () => void = () => {};
    const slow = store().load(
      new File([], 'slow.png'),
      () => new Promise((resolve) => (releaseSlow = () => resolve(decodedImage(5, 5, null, 'slow.png'))))
    );
    await store().load(new File([], 'fast.png'), async () => decodedImage(6, 6, null, 'fast.png'));
    releaseSlow();
    await slow;
    expect(currentDoc().source.name).toBe('fast.png');
    expect(currentDoc().id).not.toBe(firstId);
  });
});

describe('hasUnsavedEdits', () => {
  it('is "the document differs from a freshly loaded one", including the scale and controls with no undo entry', () => {
    expect(hasUnsavedEdits()).toBe(false);
    store().edit(setScale(0.2));
    expect(hasUnsavedEdits()).toBe(true);
    store().undo();
    expect(hasUnsavedEdits()).toBe(false);
    store().edit(setVector({ threshold: 90 }));
    expect(hasUnsavedEdits()).toBe(true);
    store().edit(setVector({ threshold: 128 }));
    expect(hasUnsavedEdits()).toBe(false);
  });

  it('compares with the document as loaded, so a test grid opened with its scale set has no edits', () => {
    store().open(decodedImage(10, 10), 0.1);
    expect(hasUnsavedEdits()).toBe(false);
  });

  it('is false with no document open', () => {
    store().close();
    expect(hasUnsavedEdits()).toBe(false);
  });
});
