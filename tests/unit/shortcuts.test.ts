/**
 * Keyboard shortcuts (#20): every shortcut the shortcuts dialog and the menus
 * list is handled, no two share keys, and each one does something.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SHORTCUT_GROUPS,
  commandFor,
  isTypingTarget,
  menuShortcut,
  shortcutToRun,
  type FocusedElement,
  runCommand,
  type KeyPress,
  type ShortcutCommand,
} from '../../src/lib/shortcuts';
import type { Size } from '../../src/lib/viewport';
import { useViewStore } from '../../src/store/viewStore';
import { useUIStore } from '../../src/store/uiStore';
import { useDocumentStore } from '../../src/store/documentStore';
import { setTonal } from '../../src/lib/document';
import { openImagePicker } from '../../src/lib/open-image';
import { decodedImage, resetStores } from '../helpers/documents';

vi.mock('../../src/lib/open-image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/open-image')>()),
  openImagePicker: vi.fn(),
}));

const CONTAINER: Size = { width: 1000, height: 700 };

const view = () => useViewStore.getState();

describe('shortcuts', () => {
  beforeEach(() => {
    resetStores();
    useViewStore.setState({ zoom: 1, pan: { x: 0, y: 0 }, container: null, image: null, fitted: false, canvasTool: 'pan' });
    useUIStore.setState({
      activeTab: 'adjustments',
      isSplitView: false,
      isInvertedBurn: false,
      showRulers: true,
      isShortcutsDialogOpen: false,
      isPresetDialogOpen: false,
      isTestGridDialogOpen: false,
    });
    vi.mocked(openImagePicker).mockClear();
  });

  /** The key presses a label such as "Ctrl + \\" or "?" stands for. */
  function pressOf(keys: string): KeyPress {
    const parts = keys.split(' + ');
    const mod = parts[0] === 'Ctrl';
    const shift = parts.includes('Shift');
    const key = parts[parts.length - 1];
    const named: Record<string, string> = { Esc: 'Escape' };
    return { key: named[key] ?? key, mod, shift: shift || key === '?' };
  }

  const listed = SHORTCUT_GROUPS.flatMap((g) => g.items);

  it('every listed shortcut is handled: its keys give its command, or a component handles them', () => {
    for (const item of listed) {
      if (item.command) {
        expect(commandFor(pressOf(item.keys)), item.keys).toBe(item.command);
      } else {
        expect(item.handledBy, item.keys).toBeTruthy();
      }
    }
  });

  it('no two listed shortcuts share keys', () => {
    const keys = listed.map((i) => i.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('the menus show the keys their command is bound to', () => {
    for (const command of ['open', 'export', 'undo', 'redo', 'zoomIn', 'zoomOut', 'fit', 'actualSize'] as const) {
      const label = menuShortcut(command);
      expect(label, command).not.toBe('');
      expect(commandFor(pressOf(label.replace(/\+(?!$)/g, ' + ')))).toBe(command);
    }
  });

  /** For each command: put the app where it applies, then check it changed something. */
  const effects: Record<ShortcutCommand, { setup?: () => void; changed: () => boolean }> = {
    undo: {
      setup: () => useDocumentStore.getState().edit(setTonal({ contrast: 30 })),
      changed: () => useDocumentStore.getState().doc?.steps.tonal.contrast === 0,
    },
    redo: {
      setup: () => {
        useDocumentStore.getState().edit(setTonal({ contrast: 30 }));
        useDocumentStore.getState().undo();
      },
      changed: () => useDocumentStore.getState().doc?.steps.tonal.contrast === 30,
    },
    open: { changed: () => vi.mocked(openImagePicker).mock.calls.length === 1 },
    export: { changed: () => useUIStore.getState().activeTab === 'export' },
    zoomIn: { changed: () => view().zoom > 1 },
    zoomOut: { changed: () => view().zoom < 1 },
    fit: {
      setup: () => view().setFrame(CONTAINER, { width: 4000, height: 3000 }),
      changed: () => view().zoom < 1 && view().fitted,
    },
    actualSize: {
      setup: () => useViewStore.setState({ zoom: 3, pan: { x: 50, y: 50 } }),
      changed: () => view().zoom === 1 && view().pan.x === 0 && view().pan.y === 0,
    },
    toggleRulers: { changed: () => useUIStore.getState().showRulers === false },
    toggleSplit: { changed: () => useUIStore.getState().isSplitView },
    toggleBurn: { changed: () => useUIStore.getState().isInvertedBurn },
    panTool: { setup: () => view().setCanvasTool('crop'), changed: () => view().canvasTool === 'pan' },
    cropTool: { changed: () => view().canvasTool === 'crop' },
    showShortcuts: { changed: () => useUIStore.getState().isShortcutsDialogOpen },
    closeDialog: {
      setup: () => useUIStore.getState().setShortcutsDialogOpen(true),
      changed: () => !useUIStore.getState().isShortcutsDialogOpen,
    },
  };

  for (const item of listed.filter((i) => i.command)) {
    it(`${item.keys} (${item.desc}) does something`, () => {
      const command = item.command!;
      useDocumentStore.getState().open(decodedImage(900, 600));
      effects[command].setup?.();
      expect(effects[command].changed(), 'already in the end state before the shortcut').toBe(false);
      expect(runCommand(commandFor(pressOf(item.keys))!)).toBe(true);
      expect(effects[command].changed()).toBe(true);
    });
  }

  it('Go to Export and Close Dialog do nothing, and keep the key, when they do not apply', () => {
    expect(runCommand('export')).toBe(false);
    expect(runCommand('closeDialog')).toBe(false);
  });

  /** A focused element as the handler sees it. */
  function focused(tagName: string, type?: string): FocusedElement {
    return { tagName, getAttribute: (name) => (name === 'type' ? (type ?? null) : null) };
  }

  // A slider keeps focus after it is dragged, the most common state of the
  // app; a checkbox or button keeps focus after a click (review of #75).
  const notTyping = [focused('INPUT', 'range'), focused('INPUT', 'checkbox'), focused('BUTTON'), focused('BODY')];

  it('with a slider, checkbox or button focused, every listed shortcut still runs', () => {
    for (const el of notTyping) {
      expect(isTypingTarget(el), `${el.tagName} ${el.getAttribute('type')}`).toBe(false);
      for (const item of listed.filter((i) => i.command)) {
        expect(shortcutToRun(pressOf(item.keys), el), `${item.keys} with ${el.getAttribute('type') ?? el.tagName} focused`).toBe(
          item.command
        );
      }
    }
  });

  it('in a text or number field, Ctrl shortcuts and Esc run but the single keys are left to the field', () => {
    for (const el of [focused('INPUT', 'number'), focused('INPUT'), focused('INPUT', 'text'), focused('TEXTAREA')]) {
      expect(isTypingTarget(el)).toBe(true);
      for (const item of listed.filter((i) => i.command)) {
        const press = pressOf(item.keys);
        const expected = press.mod || press.key === 'Escape' ? item.command : null;
        expect(shortcutToRun(press, el), `${item.keys} in ${el.tagName} ${el.getAttribute('type')}`).toBe(expected);
      }
    }
  });

  it('Esc in the size dialog’s number field closes the dialog', () => {
    useUIStore.getState().setSizeDialogOpen(true);
    const command = shortcutToRun({ key: 'Escape', mod: false, shift: false }, focused('INPUT', 'number'));
    expect(command).toBe('closeDialog');
    expect(runCommand(command!)).toBe(true);
    expect(useUIStore.getState().isSizeDialogOpen).toBe(false);
  });
});
