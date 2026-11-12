/**
 * The menus (#53) contain only actions that work: every item, run where it
 * is enabled, changes something; items that would do nothing are disabled.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MENUS, itemShortcut, type MenuItem } from '../../src/lib/menus';
import { commandFor } from '../../src/lib/shortcuts';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { firstSteps, currentStep, useUIStore } from '../../src/store/uiStore';
import { useViewStore } from '../../src/store/viewStore';
import { setScale, setTonal } from '../../src/lib/document';
import { openImagePicker } from '../../src/lib/open-image';
import type { VectorResult } from '../../src/types/vector';
import { decodedImage, resetStores } from '../helpers/documents';

vi.mock('../../src/lib/open-image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/open-image')>()),
  openImagePicker: vi.fn(),
}));

const docs = () => useDocumentStore.getState();
const ui = () => useUIStore.getState();
const view = () => useViewStore.getState();

const items: MenuItem[] = MENUS.flatMap((m) => m.groups.flat());

const TRACE: VectorResult = {
  totalPaths: 1,
  totalNodes: 4,
  svgString: '',
  layers: [],
  dimensions: { width: 10, height: 10 },
} as unknown as VectorResult;

/** For each item: put the app where it applies, then say whether it changed something. */
const effects: Record<string, { setup?: () => void; changed: () => boolean }> = {
  open: { changed: () => vi.mocked(openImagePicker).mock.calls.length === 1 },
  size: { changed: () => ui().isSizeDialogOpen },
  export: { changed: () => currentStep(ui()) === 'export' },
  'test-card': { changed: () => ui().isTestGridDialogOpen },
  close: { changed: () => docs().doc === null },
  undo: {
    setup: () => docs().edit(setTonal({ contrast: 30 })),
    changed: () => docs().doc?.steps.tonal.contrast === 0,
  },
  redo: {
    setup: () => {
      docs().edit(setTonal({ contrast: 30 }));
      docs().undo();
    },
    changed: () => docs().doc?.steps.tonal.contrast === 30,
  },
  'reset-all': {
    setup: () => docs().edit(setTonal({ contrast: 30 })),
    changed: () => docs().doc?.steps.tonal.contrast === 0,
  },
  'zoom-in': { changed: () => view().zoom > 1 },
  'zoom-out': { changed: () => view().zoom < 1 },
  fit: {
    setup: () => view().setFrame({ width: 1000, height: 700 }, { width: 4000, height: 3000 }),
    changed: () => view().zoom < 1 && view().fitted,
  },
  'actual-size': {
    setup: () => useViewStore.setState({ zoom: 3, pan: { x: 50, y: 50 } }),
    changed: () => view().zoom === 1 && view().pan.x === 0,
  },
  split: { changed: () => ui().isSplitView },
  invert: { changed: () => ui().isInvertedView },
  overlay: {
    setup: () => useRenderStore.setState({ vectorResult: TRACE }),
    changed: () => !ui().showVectorOverlay,
  },
  rulers: { changed: () => !ui().showRulers },
  'guide-circle': { changed: () => view().substrateMask === 'circle' },
  'guide-rounded': {
    setup: () => docs().edit(setScale(0.1)),
    changed: () => view().substrateMask === 'rounded-rect',
  },
  'guide-oval': { changed: () => view().substrateMask === 'oval' },
  theme: { changed: () => ui().theme === 'light' },
  shortcuts: { changed: () => ui().isShortcutsDialogOpen },
};

describe('menus', () => {
  beforeEach(() => {
    resetStores();
    useRenderStore.setState({ vectorResult: null });
    useViewStore.setState({ zoom: 1, pan: { x: 0, y: 0 }, container: null, image: null, fitted: false, substrateMask: 'none' });
    useUIStore.setState({
      job: 'photo',
      stepByJob: firstSteps(),
      isSplitView: false,
      isInvertedView: false,
      showRulers: true,
      showVectorOverlay: true,
      theme: 'dark',
      isSizeDialogOpen: false,
      isTestGridDialogOpen: false,
      isShortcutsDialogOpen: false,
    });
    vi.mocked(openImagePicker).mockClear();
  });

  it('every item has a test of what it does (add one to `effects` with a new item)', () => {
    expect(items.map((i) => i.id).sort()).toEqual(Object.keys(effects).sort());
  });

  it('item ids are unique', () => {
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const item of items) {
    it(`${item.label} does something`, () => {
      docs().open(decodedImage(900, 600));
      effects[item.id].setup?.();
      expect(item.enabled(), 'enabled where it applies').toBe(true);
      expect(effects[item.id].changed(), 'already in the end state before running').toBe(false);
      item.run();
      expect(effects[item.id].changed()).toBe(true);
    });
  }

  it('the shortcut shown beside an item runs that item', () => {
    for (const item of items.filter((i) => i.command)) {
      const keys = itemShortcut(item);
      expect(keys, item.id).not.toBe('');
      const parts = keys.replace(/\+(?!$)/g, ' + ').split(' + ');
      const key = parts[parts.length - 1];
      const press = { key: key === 'Esc' ? 'Escape' : key, mod: parts[0] === 'Ctrl', shift: key === '?' };
      expect(commandFor(press), item.id).toBe(item.command);
    }
  });

  it('with no image open, only the items that need none are enabled', () => {
    const enabled = items.filter((i) => i.enabled()).map((i) => i.id).sort();
    expect(enabled).toEqual(['open', 'shortcuts', 'test-card', 'theme']);
  });

  it('Split View is disabled in the vector job, whose canvas has no before and after', () => {
    docs().open(decodedImage(900, 600));
    const split = items.find((i) => i.id === 'split')!;
    expect(split.enabled()).toBe(true);
    ui().setJob('vector');
    expect(split.enabled()).toBe(false);
  });

  it('Trace Overlay is disabled until there is a trace', () => {
    docs().open(decodedImage(900, 600));
    expect(items.find((i) => i.id === 'overlay')!.enabled()).toBe(false);
  });

  it('the rounded rectangle guide is disabled until the size is set: its corners are in mm', () => {
    docs().open(decodedImage(900, 600));
    expect(items.find((i) => i.id === 'guide-rounded')!.enabled()).toBe(false);
  });

  it('toggles show their state', () => {
    docs().open(decodedImage(900, 600));
    const rulers = items.find((i) => i.id === 'rulers')!;
    expect(rulers.checked?.()).toBe(true);
    rulers.run();
    expect(rulers.checked?.()).toBe(false);
  });
});
