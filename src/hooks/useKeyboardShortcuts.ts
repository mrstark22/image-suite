import { useEffect } from 'react';
import { useEditStore } from '../store/editStore';
import { useImageStore } from '../store/imageStore';
import { useUIStore } from '../store/uiStore';

export function useKeyboardShortcuts() {
  const undo = useEditStore((s) => s.undo);
  const redo = useEditStore((s) => s.redo);
  const canUndo = useEditStore((s) => s.canUndo);
  const canRedo = useEditStore((s) => s.canRedo);

  const setCanvasTool = useImageStore((s) => s.setCanvasTool);
  const setZoom = useImageStore((s) => s.setZoom);
  const resetViewport = useImageStore((s) => s.resetViewport);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl instanceof HTMLSelectElement ||
        activeEl?.getAttribute('contenteditable') === 'true';

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isCtrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

      if (isCtrlOrCmd) {
        const key = e.key.toLowerCase();

        // Undo: Ctrl+Z / Cmd+Z (always permitted, blurs active number inputs)
        if (key === 'z' && !e.shiftKey) {
          if (canUndo()) {
            e.preventDefault();
            if (isInput && activeEl instanceof HTMLElement) {
              activeEl.blur();
            }
            undo();
          }
          return;
        }

        // Redo: Ctrl+Y OR Ctrl+Shift+Z
        if (key === 'y' || (key === 'z' && e.shiftKey)) {
          if (canRedo()) {
            e.preventDefault();
            if (isInput && activeEl instanceof HTMLElement) {
              activeEl.blur();
            }
            redo();
          }
          return;
        }
      }

      if (isInput) return;

      if (isCtrlOrCmd) {
        const key = e.key.toLowerCase();

        // Zoom In: Ctrl++ or Ctrl+=
        if (key === '=' || key === '+') {
          e.preventDefault();
          setZoom((z) => z * 1.25);
          return;
        }

        // Zoom Out: Ctrl+-
        if (key === '-' || key === '_') {
          e.preventDefault();
          setZoom((z) => z * 0.8);
          return;
        }

        // Actual Size (100%): Ctrl+1
        if (key === '1') {
          e.preventDefault();
          resetViewport();
          return;
        }
      } else {
        // Tool mode hotkeys (without Ctrl)
        if (e.key.toLowerCase() === 'h') {
          setCanvasTool('pan');
          return;
        }
        if (e.key.toLowerCase() === 'c') {
          setCanvasTool('crop');
          return;
        }
        if (e.key === '?') {
          e.preventDefault();
          useUIStore.getState().setShortcutsDialogOpen(true);
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    undo,
    redo,
    canUndo,
    canRedo,
    setCanvasTool,
    setZoom,
    resetViewport,
  ]);
}
