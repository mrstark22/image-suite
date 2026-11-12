/**
 * Keyboard shortcuts (#20). One list feeds the shortcuts dialog, the menu
 * labels and the key handler, so a shortcut cannot be advertised without
 * being handled: every entry either names a command that `commandFor` maps
 * its keys to, or says which component handles it.
 */
import { useDocumentStore } from '../store/documentStore';
import { useUIStore } from '../store/uiStore';
import { useViewStore } from '../store/viewStore';
import { openImagePicker } from './open-image';
import { showsOrbitView } from './workflows';

export type ShortcutCommand =
  | 'undo'
  | 'redo'
  | 'open'
  | 'export'
  | 'zoomIn'
  | 'zoomOut'
  | 'actualSize'
  | 'fit'
  | 'toggleRulers'
  | 'toggleSplit'
  | 'toggleInvertedView'
  | 'panTool'
  | 'cropTool'
  | 'showShortcuts'
  | 'closeDialog';

/** A key press as the handler sees it. `mod` is Ctrl, or Cmd on a Mac. */
export interface KeyPress {
  key: string;
  mod: boolean;
  shift: boolean;
}

export interface Shortcut {
  /** As shown to the user, keys joined by " + ". */
  keys: string;
  desc: string;
  /** The command the global handler runs; absent when `handledBy` handles the keys itself. */
  command?: ShortcutCommand;
  handledBy?: string;
}

export const ZOOM_STEP = 1.25;

export const SHORTCUT_GROUPS: { category: string; items: Shortcut[] }[] = [
  {
    category: 'Tools & Canvas Modes',
    items: [
      { keys: 'H', desc: 'Pan Tool', command: 'panTool' },
      { keys: 'C', desc: 'Crop Tool', command: 'cropTool' },
      { keys: 'Space + Drag', desc: 'Pan While Held, With Any Tool', handledBy: 'PreviewCanvas' },
      { keys: 'Enter', desc: 'Apply Crop', handledBy: 'CanvasCropOverlay' },
      { keys: 'Esc', desc: 'Cancel Crop / Close Dialog', command: 'closeDialog', handledBy: 'CanvasCropOverlay' },
    ],
  },
  {
    category: 'View & Simulation',
    items: [
      { keys: 'Ctrl + +', desc: 'Zoom In', command: 'zoomIn' },
      { keys: 'Ctrl + -', desc: 'Zoom Out', command: 'zoomOut' },
      { keys: 'Ctrl + 0', desc: 'Fit to Screen', command: 'fit' },
      { keys: 'Ctrl + 1', desc: 'Actual Size (100%)', command: 'actualSize' },
      { keys: 'Ctrl + R', desc: 'Toggle Physical Rulers', command: 'toggleRulers' },
      { keys: 'Ctrl + \\', desc: 'Toggle Split View (Before / After)', command: 'toggleSplit' },
      { keys: 'Ctrl + B', desc: 'Toggle Inverted View', command: 'toggleInvertedView' },
    ],
  },
  {
    category: 'History & File Operations',
    items: [
      { keys: 'Ctrl + Z', desc: 'Undo', command: 'undo' },
      { keys: 'Ctrl + Y', desc: 'Redo', command: 'redo' },
      { keys: 'Ctrl + O', desc: 'Open Image', command: 'open' },
      { keys: 'Ctrl + E', desc: 'Go to the Export Step', command: 'export' },
      { keys: '?', desc: 'Show Keyboard Shortcuts', command: 'showShortcuts' },
    ],
  },
];

/** The keys of `command` in the compact form the menus show, such as "Ctrl+O". */
export function menuShortcut(command: ShortcutCommand): string {
  for (const group of SHORTCUT_GROUPS) {
    const item = group.items.find((i) => i.command === command);
    if (item) return item.keys.replace(/ \+ /g, '+');
  }
  return '';
}

/** The command for a key press, or null if it is not a shortcut. */
export function commandFor(press: KeyPress): ShortcutCommand | null {
  const key = press.key.toLowerCase();
  if (press.mod) {
    if (key === 'z') return press.shift ? 'redo' : 'undo';
    if (key === 'y') return 'redo';
    if (key === 'o') return 'open';
    if (key === 'e') return 'export';
    if (key === '=' || key === '+') return 'zoomIn';
    if (key === '-' || key === '_') return 'zoomOut';
    if (key === '0') return 'fit';
    if (key === '1') return 'actualSize';
    if (key === 'r') return 'toggleRulers';
    if (key === '\\') return 'toggleSplit';
    if (key === 'b') return 'toggleInvertedView';
    return null;
  }
  if (key === 'h') return 'panTool';
  if (key === 'c') return 'cropTool';
  if (key === '?') return 'showShortcuts';
  if (key === 'escape') return 'closeDialog';
  return null;
}

/**
 * Commands that also apply while a text field has focus: everything with
 * Ctrl or Cmd, which typing does not produce, and Escape. The single keys
 * (H, C, ?) would be typed text, so they leave a text field alone.
 */
export function appliesWhileTyping(command: ShortcutCommand): boolean {
  return command !== 'panTool' && command !== 'cropTool' && command !== 'showShortcuts';
}

/** Input types that take typed text. Others (range, checkbox, button, colour, file) do not. */
const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'email', 'url', 'tel', 'password', 'number',
  'date', 'datetime-local', 'month', 'week', 'time',
]);

/** The parts of a focused element that `isTypingTarget` reads. */
export interface FocusedElement {
  tagName: string;
  getAttribute(name: string): string | null;
}

/**
 * True when `el` takes typed text, so single-key shortcuts and Space must
 * leave it alone. A slider or a checkbox keeps focus after it is used, and
 * does not count: the shortcuts work as if nothing had focus.
 */
export function isTypingTarget(el: FocusedElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT') return TEXT_INPUT_TYPES.has((el.getAttribute('type') ?? 'text').toLowerCase());
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.getAttribute('contenteditable') === 'true';
}

/** The command a key press runs with `focused` holding focus, or null if it is left alone. */
export function shortcutToRun(press: KeyPress, focused: FocusedElement | null): ShortcutCommand | null {
  const command = commandFor(press);
  if (!command) return null;
  if (isTypingTarget(focused) && !appliesWhileTyping(command)) return null;
  return command;
}

/**
 * True when the canvas shows the flat image, which the view commands act on.
 * The 3D orbit view of the relief ignores zoom, rulers, split, inversion and
 * guides, so those are unavailable while it is shown (#53).
 */
export function canvasIsFlat(): boolean {
  const doc = useDocumentStore.getState().doc;
  return !showsOrbitView(useUIStore.getState().job, doc?.depth.viewMode, useViewStore.getState().canvasTool);
}

/**
 * False when `command` does not apply now: nothing to undo or redo, no image
 * to export, no dialog to close. The key then keeps its default action.
 */
export function isAvailable(command: ShortcutCommand): boolean {
  const docs = useDocumentStore.getState();
  const ui = useUIStore.getState();
  switch (command) {
    // Undo and redo also cancel a gesture in progress, so they apply
    // whenever a gesture or an entry exists.
    case 'undo':
      return docs.gesture !== null || docs.past.length > 0;
    case 'redo':
      return docs.gesture !== null || docs.future.length > 0;
    case 'export':
      return docs.doc !== null;
    // The vector job's canvas shows the image the trace reads: there is no before and after.
    case 'toggleSplit':
      return ui.job !== 'vector' && canvasIsFlat();
    case 'zoomIn':
    case 'zoomOut':
    case 'fit':
    case 'actualSize':
    case 'toggleRulers':
    case 'toggleInvertedView':
      return canvasIsFlat();
    // Escape in the crop tool is handled by the crop overlay.
    case 'closeDialog':
      return ui.isShortcutsDialogOpen || ui.isSizeDialogOpen || ui.isTestGridDialogOpen;
    default:
      return true;
  }
}

/** Runs `command`, if it is available. Returns whether it ran. */
export function runCommand(command: ShortcutCommand): boolean {
  if (!isAvailable(command)) return false;
  const ui = useUIStore.getState();
  const view = useViewStore.getState();
  switch (command) {
    case 'undo':
      useDocumentStore.getState().undo();
      break;
    case 'redo':
      useDocumentStore.getState().redo();
      break;
    case 'open':
      openImagePicker();
      break;
    case 'export':
      ui.goToStep('export');
      break;
    case 'zoomIn':
      view.zoomBy(ZOOM_STEP);
      break;
    case 'zoomOut':
      view.zoomBy(1 / ZOOM_STEP);
      break;
    case 'fit':
      view.fit();
      break;
    case 'actualSize':
      view.resetViewport();
      break;
    case 'toggleRulers':
      ui.toggleRulers();
      break;
    case 'toggleSplit':
      ui.toggleSplitView();
      break;
    case 'toggleInvertedView':
      ui.toggleInvertedView();
      break;
    case 'panTool':
      view.setCanvasTool('pan');
      break;
    case 'cropTool':
      view.setCanvasTool('crop');
      break;
    case 'showShortcuts':
      ui.setShortcutsDialogOpen(true);
      break;
    case 'closeDialog':
      ui.setShortcutsDialogOpen(false);
      ui.setSizeDialogOpen(false);
      ui.setTestGridDialogOpen(false);
      break;
  }
  return true;
}
