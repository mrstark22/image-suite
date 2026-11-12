import { useEffect } from 'react';
import { isAvailable, isTypingTarget, runCommand, shortcutToRun } from '../lib/shortcuts';

/** Handles the shortcuts listed in `SHORTCUT_GROUPS` (src/lib/shortcuts.ts). */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const activeEl = document.activeElement;
      const command = shortcutToRun({ key: e.key, mod: isMac ? e.metaKey : e.ctrlKey, shift: e.shiftKey }, activeEl);
      if (!command || !isAvailable(command)) return;

      e.preventDefault();
      // Undo in a number field blurs it first, so the field commits what was
      // typed and then shows the undone value.
      if ((command === 'undo' || command === 'redo') && isTypingTarget(activeEl) && activeEl instanceof HTMLElement) {
        activeEl.blur();
      }
      runCommand(command);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
