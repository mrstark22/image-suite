/**
 * "Keep settings when opening a new image" (#67): a preference of the browser,
 * not of the document.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, readPreferences, usePreferencesStore } from '../../src/store/preferencesStore';
import { defaultSteps, DEFAULT_DEPTH, DEFAULT_VECTOR, setCrop, setDepth, setDither, setDetail, setColor, setScale, setTonal, setVector } from '../../src/lib/document';
import { replaceConfirmation } from '../../src/lib/open-image';
import { MENUS } from '../../src/lib/menus';
import { decodedImage, resetStores, currentDoc } from '../helpers/documents';

const store = () => useDocumentStore.getState();
const preferences = () => usePreferencesStore.getState();

/** A minimal `localStorage`, as a browser has. */
function fakeStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, String(v)),
    removeItem: (k) => void items.delete(k),
    clear: () => items.clear(),
    key: (i) => [...items.keys()][i] ?? null,
    get length() {
      return items.size;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
  resetStores();
});
afterEach(() => vi.unstubAllGlobals());

/** Opens an image and changes every kind of setting, the crop and the size. */
function editedImage(): void {
  store().open(decodedImage(600, 400, null, 'first.jpg'));
  store().edit(setScale(0.1));
  store().edit(setCrop({ x: 10, y: 10, width: 300, height: 200 }));
  store().edit(setTonal({ contrast: 25 }));
  store().edit(setColor({ saturation: -40 }));
  store().edit(setDetail({ unsharpStrength: 80 }));
  store().edit(setDither({ algorithm: 'floyd-steinberg' }));
  store().edit(setVector({ shapes: 'centerline', toleranceMm: 0.2 }));
  store().edit(setDepth({ invertZ: true }));
}

describe('keep settings when opening a new image (#67)', () => {
  it('off, the default: a new image starts with the default settings', () => {
    expect(preferences().keepSettingsOnOpen).toBe(false);
    editedImage();
    store().open(decodedImage(800, 500, null, 'second.jpg'));
    const doc = currentDoc();
    expect(doc.steps).toEqual(defaultSteps());
    expect(doc.vector).toEqual(DEFAULT_VECTOR);
    expect(doc.depth).toEqual(DEFAULT_DEPTH);
    expect(doc.mmPerPx).toBeNull();
  });

  it('on: a new image has the previous settings, no crop, no size and no history', () => {
    preferences().setKeepSettingsOnOpen(true);
    editedImage();
    const first = currentDoc();
    store().open(decodedImage(800, 500, null, 'second.jpg'));
    const doc = currentDoc();
    expect(doc.source.name).toBe('second.jpg');
    expect(doc.id).not.toBe(first.id);
    expect(doc.steps.tonal).toEqual(first.steps.tonal);
    expect(doc.steps.color).toEqual(first.steps.color);
    expect(doc.steps.detail).toEqual(first.steps.detail);
    expect(doc.steps.dither).toEqual(first.steps.dither);
    expect(doc.vector).toEqual(first.vector);
    expect(doc.depth).toEqual(first.depth);
    expect(doc.steps.tonal.contrast).toBe(25);
    // What belongs to the image starts fresh.
    expect(doc.steps.crop).toBeNull();
    expect(doc.mmPerPx).toBeNull();
    expect(store().past).toEqual([]);
    expect(store().future).toEqual([]);
    // The carried settings are how the image opened, not an edit to undo or to warn about.
    expect(store().initial).toBe(doc);
  });

  it('on: the first image of a visit, and a calibration card, start with the defaults', () => {
    preferences().setKeepSettingsOnOpen(true);
    store().open(decodedImage(600, 400));
    expect(currentDoc().steps).toEqual(defaultSteps());
    store().edit(setTonal({ contrast: 25 }));
    store().open(decodedImage(300, 300, null, 'card.png'), 0.1, 'defaults');
    expect(currentDoc().steps).toEqual(defaultSteps());
    expect(currentDoc().mmPerPx).toBe(0.1);
  });

  it('the preference survives a reload, and bad stored data falls back to the default', () => {
    preferences().setKeepSettingsOnOpen(true);
    expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY)!)).toEqual({ keepSettingsOnOpen: true });
    // A reload: the store starts again from what the browser kept.
    usePreferencesStore.setState({ ...DEFAULT_PREFERENCES });
    preferences().reload();
    expect(preferences().keepSettingsOnOpen).toBe(true);
    expect(readPreferences()).toEqual({ keepSettingsOnOpen: true });

    localStorage.setItem(PREFERENCES_KEY, '{"keepSettingsOnOpen":"yes"}');
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
    localStorage.setItem(PREFERENCES_KEY, 'not json');
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('the File menu shows the preference and switches it; the confirmation says which will happen', () => {
    const item = MENUS.find((m) => m.id === 'file')!.groups.flat().find((i) => i.id === 'keep-settings')!;
    expect(item.enabled()).toBe(true);
    expect(item.checked!()).toBe(false);
    item.run();
    expect(item.checked!()).toBe(true);
    expect(preferences().keepSettingsOnOpen).toBe(true);
    expect(replaceConfirmation(true)).toMatch(/start with the current settings/);
    expect(replaceConfirmation(false)).toMatch(/start with default settings/);
    expect(replaceConfirmation(true)).not.toBe(replaceConfirmation(false));
  });
});
