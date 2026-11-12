/**
 * The menu bar's menus (#53), as data, so a test can run every item and check
 * that it does something. An item is enabled only when it would: Zoom with no
 * image, Split View in the vector job (whose canvas shows the image the trace
 * reads, so there is no before and after) and Trace Overlay with no trace are
 * disabled rather than doing nothing. So are the view items while the relief's
 * 3D orbit view is shown, since it draws none of them.
 */
import { useDocumentStore } from '../store/documentStore';
import { useRenderStore } from '../store/renderStore';
import { useUIStore } from '../store/uiStore';
import { useViewStore, type SubstrateMask } from '../store/viewStore';
import { resetAll } from './document';
import { canvasIsFlat, isAvailable, menuShortcut, runCommand, type ShortcutCommand } from './shortcuts';

export interface MenuItem {
  id: string;
  label: string;
  /** The shortcut shown beside the item; running the item runs this command. */
  command?: ShortcutCommand;
  enabled: () => boolean;
  run: () => void;
  /** For toggles: whether it is on. */
  checked?: () => boolean;
  /** Why the item is disabled, when that is not obvious. */
  disabledReason?: string;
  danger?: boolean;
}

export interface Menu {
  id: string;
  label: string;
  /** Items in groups; the menu draws a divider between groups. */
  groups: MenuItem[][];
}

const docs = () => useDocumentStore.getState();
const ui = () => useUIStore.getState();
const view = () => useViewStore.getState();
const hasDoc = () => docs().doc !== null;

/** An item that runs a shortcut command, enabled when the command applies and `also` holds. */
function commandItem(id: string, label: string, command: ShortcutCommand, also: () => boolean = () => true): MenuItem {
  return { id, label, command, enabled: () => also() && isAvailable(command), run: () => void runCommand(command) };
}

function guideItem(id: string, label: string, mask: SubstrateMask, needsSize = false): MenuItem {
  return {
    id,
    label,
    enabled: () => hasDoc() && canvasIsFlat() && (!needsSize || docs().doc?.mmPerPx != null),
    checked: () => view().substrateMask === mask,
    run: () => view().setSubstrateMask(view().substrateMask === mask ? 'none' : mask),
    disabledReason: needsSize ? 'Set the size to use this: its corners are in mm' : undefined,
  };
}

export const MENUS: readonly Menu[] = [
  {
    id: 'file',
    label: 'File',
    groups: [
      [
        commandItem('open', 'Open Image…', 'open'),
        { id: 'size', label: 'Physical Size…', enabled: hasDoc, run: () => ui().setSizeDialogOpen(true) },
      ],
      [
        commandItem('export', 'Go to Export', 'export'),
        { id: 'test-card', label: 'Calibration Test Card…', enabled: () => true, run: () => ui().setTestGridDialogOpen(true) },
      ],
      [{ id: 'close', label: 'Close Image', enabled: hasDoc, run: () => docs().close(), danger: true }],
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    groups: [
      [commandItem('undo', 'Undo', 'undo'), commandItem('redo', 'Redo', 'redo')],
      [{ id: 'reset-all', label: 'Reset All Settings', enabled: hasDoc, run: () => docs().edit(resetAll) }],
    ],
  },
  {
    id: 'view',
    label: 'View',
    groups: [
      [
        commandItem('zoom-in', 'Zoom In', 'zoomIn', hasDoc),
        commandItem('zoom-out', 'Zoom Out', 'zoomOut', hasDoc),
        commandItem('fit', 'Fit to Screen', 'fit', hasDoc),
        commandItem('actual-size', 'Actual Size (100%)', 'actualSize', hasDoc),
      ],
      [
        {
          // Unavailable in the vector job (see `isAvailable` in shortcuts.ts).
          ...commandItem('split', 'Split View (Before / After)', 'toggleSplit', hasDoc),
          checked: () => ui().isSplitView,
          disabledReason: 'The vector job shows the image the trace reads: there is no before and after',
        },
        { ...commandItem('invert', 'Inverted View', 'toggleInvertedView', hasDoc), checked: () => ui().isInvertedView },
        {
          id: 'overlay',
          label: 'Trace Overlay',
          enabled: () => useRenderStore.getState().vectorResult !== null,
          checked: () => ui().showVectorOverlay,
          run: () => ui().toggleVectorOverlay(),
        },
        { ...commandItem('rulers', 'Rulers', 'toggleRulers', hasDoc), checked: () => ui().showRulers },
      ],
      [
        guideItem('guide-circle', 'Circle Guide', 'circle'),
        guideItem('guide-rounded', 'Rounded Rectangle Guide', 'rounded-rect', true),
        guideItem('guide-oval', 'Oval Guide', 'oval'),
      ],
      [
        {
          id: 'theme',
          label: 'Light Theme',
          enabled: () => true,
          checked: () => ui().theme === 'light',
          run: () => ui().toggleTheme(),
        },
      ],
    ],
  },
  {
    id: 'help',
    label: 'Help',
    groups: [[commandItem('shortcuts', 'Keyboard Shortcuts', 'showShortcuts')]],
  },
];

/** The keys shown beside `item`, or ''. */
export function itemShortcut(item: MenuItem): string {
  return item.command ? menuShortcut(item.command) : '';
}
