/**
 * Undo and redo cover every edit control (#21; design section 7, #21 rows).
 *
 * Each kind of edit the UI makes is applied with the same update the control
 * applies, through the same entry point (`edit`, or a slider's gesture), then
 * undone: the previous document must come back, compared by value, and redo
 * must bring the edit back. A no-op interaction must leave both stacks as
 * they were. The interrupted-gesture rows are in document-store.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { useDocumentStore, setGestureEndTarget } from '../../src/store/documentStore';
import {
  DEFAULT_DETAIL,
  DEFAULT_DITHER,
  DEFAULT_TONAL,
  applyRecipe,
  resetAll,
  resetDither,
  resetAdjustments,
  resetVector,
  sameValue,
  setColor,
  setCrop,
  setDepth,
  setDetail,
  setDither,
  setScale,
  setTonal,
  setVector,
} from '../../src/lib/document';
import {
  ADJUSTMENT_PRESETS,
  SECTION_RESETS,
  combine,
  type AdjustmentPresetId,
  type AdjustmentSection,
} from '../../src/lib/adjustment-edits';
import { DraftField, SliderGesture } from '../../src/lib/slider-input';
import { RECIPE_VERSION } from '../../src/types/recipe';
import type { DocumentUpdate, ImageDocument } from '../../src/types/document';
import { currentDoc, decodedImage, resetStores } from '../helpers/documents';

const store = () => useDocumentStore.getState();

/**
 * Every setting moved away from its default, so each section reset, Reset
 * All and each checkbox turned off has something to change.
 */
const EVERYTHING_ADJUSTED: DocumentUpdate = combine(
  setScale(0.1),
  setCrop({ x: 4, y: 3, width: 20, height: 15 }),
  setTonal({
    exposure: 0.5,
    brightness: 10,
    contrast: 20,
    midtones: 5,
    highlights: -10,
    shadows: 15,
    whites: 5,
    blacks: -5,
    blackPoint: 10,
    whitePoint: 240,
    gamma: 1.2,
    clarity: 30,
    invert: true,
    grayscaleMode: 'average',
  }),
  setColor({ saturation: 20, vibrance: 10, temperature: 5, tint: -5 }),
  setDetail({ clahe: true, adaptiveThreshold: true, unsharpStrength: 40, unsharpRadiusMm: 0.5 }),
  setDither({ algorithm: 'atkinson', serpentine: false, matrixScale: 2 }),
  setVector({ mode: 'centerline', invert: true, curveFitting: false, threshold: 90 }),
  setDepth({ invertZ: true, viewMode: 'heatmap', material: 'slate', source: 'distance-transform', bevelStyle: 'dome' })
);

/** A material preset's recipe, as the material preset dialog applies it. */
const RECIPE = applyRecipe({
  version: RECIPE_VERSION,
  name: 'Test',
  createdAt: 0,
  updatedAt: 0,
  steps: [
    { id: '1', type: 'tonal', enabled: true, timestamp: 0, params: { ...DEFAULT_TONAL, contrast: 40, gamma: 1.3 } },
    { id: '2', type: 'dither', enabled: true, timestamp: 0, params: { ...DEFAULT_DITHER, algorithm: 'jarvis' } },
  ],
});

interface EditCase {
  name: string;
  /** Where the document starts: `fresh` as loaded, or `adjusted` with every setting changed. */
  from: 'fresh' | 'adjusted';
  update: DocumentUpdate;
}

const PRESET_IDS = Object.keys(ADJUSTMENT_PRESETS) as AdjustmentPresetId[];
const SECTIONS = Object.keys(SECTION_RESETS) as AdjustmentSection[];

/** Every kind of edit a control makes with one `edit` call. */
const CLICK_EDITS: EditCase[] = [
  // Adjustments panel
  ...PRESET_IDS.map((id): EditCase => ({ name: `preset chip "${id}"`, from: 'fresh', update: ADJUSTMENT_PRESETS[id] })),
  ...SECTIONS.map((s): EditCase => ({ name: `"${s}" section reset icon`, from: 'adjusted', update: SECTION_RESETS[s] })),
  { name: 'Reset All (adjustments panel, tool subheader)', from: 'adjusted', update: resetAdjustments },
  { name: 'Invert checkbox on', from: 'fresh', update: setTonal({ invert: true }) },
  { name: 'Invert checkbox off', from: 'adjusted', update: setTonal({ invert: false }) },
  { name: 'CLAHE checkbox on', from: 'fresh', update: setDetail({ clahe: true }) },
  { name: 'CLAHE checkbox off', from: 'adjusted', update: setDetail({ clahe: false }) },
  { name: 'Adaptive threshold checkbox on', from: 'fresh', update: setDetail({ adaptiveThreshold: true }) },
  { name: 'Adaptive threshold checkbox off', from: 'adjusted', update: setDetail({ adaptiveThreshold: false }) },
  ...(['none', 'rec709', 'average', 'desaturate', 'inverted'] as const).map(
    (mode): EditCase => ({ name: `greyscale mode button "${mode}"`, from: mode === 'none' ? 'adjusted' : 'fresh', update: setTonal({ grayscaleMode: mode }) })
  ),
  // Dithering panel
  { name: 'dither algorithm button', from: 'fresh', update: setDither({ algorithm: 'floyd-steinberg' }) },
  { name: 'serpentine checkbox', from: 'fresh', update: setDither({ serpentine: false }) },
  { name: 'dither reset', from: 'adjusted', update: resetDither },
  // Vectorization panel and tool subheader
  { name: 'trace mode button or select', from: 'fresh', update: setVector({ mode: 'multi-color' }) },
  { name: 'trace invert checkbox', from: 'fresh', update: setVector({ invert: true }) },
  { name: 'curve fitting checkbox', from: 'fresh', update: setVector({ curveFitting: false }) },
  { name: 'trace reset', from: 'adjusted', update: resetVector },
  // Depth panel
  { name: 'relief source button', from: 'fresh', update: setDepth({ source: 'ai-estimation' }) },
  { name: 'bevel style button', from: 'fresh', update: setDepth({ bevelStyle: 'concave' }) },
  { name: 'relief view mode button', from: 'fresh', update: setDepth({ viewMode: 'grayscale' }) },
  { name: 'relief material button', from: 'fresh', update: setDepth({ material: 'brass' }) },
  { name: 'invert Z checkbox', from: 'fresh', update: setDepth({ invertZ: true }) },
  // Canvas, dialogs and menus
  { name: 'crop applied', from: 'fresh', update: setCrop({ x: 1, y: 2, width: 10, height: 8 }) },
  { name: 'crop changed', from: 'adjusted', update: setCrop({ x: 0, y: 0, width: 12, height: 12 }) },
  { name: 'size set', from: 'fresh', update: setScale(0.25) },
  { name: 'size changed', from: 'adjusted', update: setScale(0.05) },
  { name: 'material preset recipe', from: 'adjusted', update: RECIPE },
  { name: 'Edit > Reset All', from: 'adjusted', update: resetAll },
  // A slider's double-click label reset and typed value are single edits too.
  { name: 'slider double-click reset', from: 'adjusted', update: setTonal({ brightness: 0 }) },
  { name: 'slider typed value', from: 'fresh', update: setDetail({ claheClipLimit: 4.5 }) },
];

/** Opens a fresh document, moved to `from`, with no history. */
function start(from: EditCase['from']): ImageDocument {
  store().open(decodedImage(40, 30));
  if (from === 'adjusted') {
    store().edit(EVERYTHING_ADJUSTED);
    // Start from a clean history so the test sees only its own entry.
    useDocumentStore.setState({ past: [], future: [] });
  }
  return currentDoc();
}

/** Undo gives back `before` by value; redo gives back `after`; versions always increase. */
function expectUndoRedo(before: ImageDocument, after: ImageDocument): void {
  expect(sameValue(after, before)).toBe(false);
  expect(store().past.length).toBe(1);
  expect(store().future.length).toBe(0);

  const v0 = store().version;
  store().undo();
  expect(currentDoc()).toEqual(before);
  expect(sameValue(currentDoc(), before)).toBe(true);
  expect(store().past.length).toBe(0);
  expect(store().future.length).toBe(1);
  expect(store().version).toBeGreaterThan(v0);

  store().redo();
  expect(currentDoc()).toEqual(after);
  expect(store().past.length).toBe(1);
  expect(store().future.length).toBe(0);
  expect(store().version).toBeGreaterThan(v0 + 1);
}

/** The stacks, to compare by reference: a no-op must leave the very same arrays. */
function stacks() {
  const { doc, past, future, version } = store();
  return { doc, past, future, version };
}

/** A history with one entry on each stack, so a no-op that touched either would show. */
function withBothStacks(from: EditCase['from']): void {
  start(from);
  store().edit(setTonal({ brightness: 77 }));
  store().edit(setTonal({ brightness: 78 }));
  store().undo();
  expect(store().past.length).toBe(1);
  expect(store().future.length).toBe(1);
}

let windowStandIn: EventTarget;
beforeEach(() => {
  resetStores();
  windowStandIn = new EventTarget();
  setGestureEndTarget(windowStandIn);
});
afterEach(() => setGestureEndTarget(null));

describe('every kind of edit is one undo entry, and undo restores the previous document', () => {
  for (const c of CLICK_EDITS) {
    it(c.name, () => {
      const before = start(c.from);
      store().edit(c.update);
      expectUndoRedo(before, currentDoc());
    });
  }

  it('a slider drag (pointerdown, moves, pointerup) is one entry', () => {
    const before = start('fresh');
    const slider = new SliderGesture(store);
    slider.startDrag();
    for (let v = 1; v <= 20; v++) slider.change(setTonal({ contrast: v }));
    slider.endDrag();
    expect(currentDoc().steps.tonal.contrast).toBe(20);
    expectUndoRedo(before, currentDoc());
  });

  it('a slider drag whose pointerup lands outside the track is ended by the window and is one entry', () => {
    const before = start('fresh');
    const slider = new SliderGesture(store);
    slider.startDrag();
    slider.change(setDepth({ zMax: 60 }));
    slider.change(setDepth({ zMax: 50 }));
    windowStandIn.dispatchEvent(new Event('pointerup'));
    expect(store().gesture).toBeNull();
    expectUndoRedo(before, currentDoc());
  });

  it('an arrow key on a slider is one entry per press', () => {
    const before = start('fresh');
    const slider = new SliderGesture(store);
    slider.keyboardAdjust();
    slider.change(setTonal({ brightness: 1 }));
    expectUndoRedo(before, currentDoc());

    const afterOne = currentDoc();
    slider.keyboardAdjust();
    slider.change(setTonal({ brightness: 2 }));
    expect(store().past.length).toBe(2);
    store().undo();
    expect(currentDoc()).toEqual(afterOne);
  });

  it('a number field commits a typed value once, as one entry', () => {
    const before = start('fresh');
    const field = new DraftField();
    const slider = new SliderGesture(store);
    // As Slider.commitDraft does: Enter commits, and the blur it causes finds nothing.
    const commit = () => {
      const text = field.take();
      if (text !== null) slider.change(setTonal({ gamma: parseFloat(text) }));
    };
    field.type('1');
    field.type('1.5');
    commit();
    commit();
    expect(currentDoc().steps.tonal.gamma).toBe(1.5);
    expectUndoRedo(before, currentDoc());
  });

  it('a series of different edits undoes one at a time, back to the document as loaded', () => {
    const loaded = start('fresh');
    const docs: ImageDocument[] = [loaded];
    for (const c of CLICK_EDITS.filter((e) => e.from === 'fresh')) {
      store().edit(c.update);
      if (currentDoc() !== docs[docs.length - 1]) docs.push(currentDoc());
    }
    expect(store().past.length).toBe(docs.length - 1);
    for (let i = docs.length - 2; i >= 0; i--) {
      store().undo();
      expect(currentDoc()).toEqual(docs[i]);
    }
    expect(currentDoc()).toEqual(loaded);
    for (let i = 1; i < docs.length; i++) {
      store().redo();
      expect(currentDoc()).toEqual(docs[i]);
    }
  });
});

describe('a no-op interaction leaves the undo and redo stacks unchanged', () => {
  for (const c of CLICK_EDITS) {
    it(`${c.name}, repeated`, () => {
      start(c.from);
      store().edit(c.update);
      // Give the redo stack an entry while keeping the document `c.update` produced.
      store().edit(setTonal({ brightness: 77 }));
      store().undo();
      const s = stacks();
      expect(s.future.length).toBe(1);
      store().edit(c.update);
      expect(stacks()).toStrictEqual(s);
      expect(store().past).toBe(s.past);
      expect(store().future).toBe(s.future);
      expect(store().doc).toBe(s.doc);
    });
  }

  it('a section reset icon on a section that is already at its defaults', () => {
    withBothStacks('fresh');
    store().edit(setTonal({ brightness: 0 }));
    const s = stacks();
    for (const section of SECTIONS) store().edit(SECTION_RESETS[section]);
    expect(store().past).toBe(s.past);
    expect(store().future).toBe(s.future);
    expect(store().doc).toBe(s.doc);
  });

  it('focusing then blurring a number field without typing', () => {
    withBothStacks('fresh');
    const s = stacks();
    const field = new DraftField();
    const slider = new SliderGesture(store);
    // Slider.commitDraft on blur: nothing typed, so nothing to take.
    const text = field.take();
    if (text !== null) slider.change(setTonal({ contrast: parseFloat(text) }));
    expect(text).toBeNull();
    expect(stacks()).toStrictEqual(s);
    expect(store().past).toBe(s.past);
    expect(store().future).toBe(s.future);
  });

  it('typing the value the field already shows', () => {
    withBothStacks('fresh');
    const s = stacks();
    const slider = new SliderGesture(store);
    slider.change(setTonal({ brightness: currentDoc().steps.tonal.brightness }));
    expect(store().past).toBe(s.past);
    expect(store().future).toBe(s.future);
    expect(store().version).toBe(s.version);
  });

  it('a click on a slider track that does not move the value, and a drag that ends where it began', () => {
    withBothStacks('fresh');
    const s = stacks();
    const slider = new SliderGesture(store);
    slider.startDrag();
    slider.endDrag();
    slider.startDrag();
    slider.change(setTonal({ contrast: 40 }));
    slider.change(setTonal({ contrast: 0 }));
    slider.endDrag();
    expect(store().past).toBe(s.past);
    expect(store().future).toBe(s.future);
    expect(store().doc).toEqual(s.doc);
  });

  it('an arrow key at the end of a slider range (the value cannot move)', () => {
    withBothStacks('fresh');
    store().edit(setTonal({ brightness: 100 }));
    const s = stacks();
    const slider = new SliderGesture(store);
    slider.keyboardAdjust();
    // The range input clamps to its max, so the change it reports is the same value.
    slider.change(setTonal({ brightness: 100 }));
    expect(store().past).toBe(s.past);
    expect(store().future).toBe(s.future);
  });

  it('a preset chip, checkbox or greyscale button that sets values the document already has', () => {
    withBothStacks('fresh');
    const s = stacks();
    store().edit(setTonal({ invert: false }));
    store().edit(setDetail({ clahe: false, unsharpRadiusMm: DEFAULT_DETAIL.unsharpRadiusMm }));
    store().edit(setTonal({ grayscaleMode: currentDoc().steps.tonal.grayscaleMode }));
    expect(store().past).toBe(s.past);
    expect(store().future).toBe(s.future);
    expect(store().doc).toBe(s.doc);
  });
});

describe('undo right after loading an image', () => {
  it('does nothing: the loaded document stays, with the same version and no stacks', () => {
    store().open(decodedImage(40, 30));
    const loaded = stacks();
    store().undo();
    store().redo();
    expect(stacks()).toStrictEqual(loaded);
    expect(store().doc).toBe(loaded.doc);
  });

  it('cannot reach back into the previous image', () => {
    store().open(decodedImage(40, 30));
    store().edit(setTonal({ contrast: 30 }));
    store().open(decodedImage(50, 20));
    const loaded = currentDoc();
    store().undo();
    expect(store().doc).toBe(loaded);
    expect(store().past).toEqual([]);
  });
});

describe('one way in', () => {
  /** Source files under `dir`, recursively. */
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }

  it('nothing outside the document store writes the document store directly', () => {
    const root = join(__dirname, '..', '..');
    const offenders = sourceFiles(join(root, 'src'))
      .filter((path) => !path.endsWith(join('store', 'documentStore.ts')))
      .filter((path) => /useDocumentStore\s*\.\s*setState/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path));
    expect(offenders).toEqual([]);
  });
});
