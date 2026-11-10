import { useEffect } from 'react';
import { useEditStore } from '../store/editStore';
import { useLayerStore } from '../store/layerStore';
import { useImageStore } from '../store/imageStore';
import { useUIStore } from '../store/uiStore';

export function useKeyboardShortcuts() {
  const undo = useEditStore((s) => s.undo);
  const redo = useEditStore((s) => s.redo);
  const canUndo = useEditStore((s) => s.canUndo);
  const canRedo = useEditStore((s) => s.canRedo);

  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const removeLayer = useLayerStore((s) => s.removeLayer);
  const duplicateLayer = useLayerStore((s) => s.duplicateLayer);
  const mergeLayerDown = useLayerStore((s) => s.mergeLayerDown);
  const flattenAllLayers = useLayerStore((s) => s.flattenAllLayers);
  const moveLayerUp = useLayerStore((s) => s.moveLayerUp);
  const moveLayerDown = useLayerStore((s) => s.moveLayerDown);
  const cycleActiveLayer = useLayerStore((s) => s.cycleActiveLayer);

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

        // Duplicate: Ctrl+D
        if (key === 'd') {
          if (activeLayerId) {
            e.preventDefault();
            duplicateLayer(activeLayerId);
          }
          return;
        }

        // Merge Down: Ctrl+E (without shift)
        if (key === 'e' && !e.shiftKey) {
          if (activeLayerId) {
            e.preventDefault();
            mergeLayerDown(activeLayerId);
          }
          return;
        }

        // Flatten All Layers: Ctrl+Shift+E
        if (key === 'e' && e.shiftKey) {
          e.preventDefault();
          flattenAllLayers();
          return;
        }

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

        // Move Layer in Stack: Ctrl+[ / Ctrl+]
        if (e.key === ']') {
          if (activeLayerId) {
            e.preventDefault();
            moveLayerUp(activeLayerId);
          }
          return;
        }
        if (e.key === '[') {
          if (activeLayerId) {
            e.preventDefault();
            moveLayerDown(activeLayerId);
          }
          return;
        }
      } else {
        // Tool mode hotkeys (without Ctrl)
        if (e.key.toLowerCase() === 'v') {
          setCanvasTool('move');
          return;
        }
        if (e.key.toLowerCase() === 't') {
          useUIStore.getState().setTextDialogOpen(true);
          return;
        }
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

        // Cycle Active Layers: [ and ]
        if (e.key === ']') {
          e.preventDefault();
          cycleActiveLayer('next');
          return;
        }
        if (e.key === '[') {
          e.preventDefault();
          cycleActiveLayer('prev');
          return;
        }

        // Delete active layer
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          if (activeLayerId) {
            removeLayer(activeLayerId);
          }
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
    activeLayerId,
    removeLayer,
    duplicateLayer,
    mergeLayerDown,
    flattenAllLayers,
    moveLayerUp,
    moveLayerDown,
    cycleActiveLayer,
    setCanvasTool,
    setZoom,
    resetViewport,
  ]);
}
