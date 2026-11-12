import { useEffect } from 'react';
import { appliesWhileTyping, commandFor, isAvailable, isTypingTarget, runCommand } from '../lib/shortcuts';

/** Handles the shortcuts listed in `SHORTCUT_GROUPS` (src/lib/shortcuts.ts). */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const command = commandFor({ key: e.key, mod: isMac ? e.metaKey : e.ctrlKey, shift: e.shiftKey });
      if (!command) return;

      const activeEl = document.activeElement;
      const typing = isTypingTarget(activeEl);
      if (typing && !appliesWhileTyping(command)) return;
      if (!isAvailable(command)) return;

      e.preventDefault();
      // Undo in a number field blurs it first, so the field commits what was
      // typed and then shows the undone value.
      if (typing && activeEl instanceof HTMLElement) activeEl.blur();
      runCommand(command);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
