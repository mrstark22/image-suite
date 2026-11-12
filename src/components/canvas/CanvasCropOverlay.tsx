import React, { useState, useEffect, useRef, useCallback, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { useRenderStore } from '../../store/renderStore';
import { useViewStore } from '../../store/viewStore';
import { adjustCropBox, cropBoxForKey, previewBoxToSource, type CropAspect, type CropHandle } from '../../lib/crop';
import { setCrop } from '../../lib/document';
import styles from './CanvasCropOverlay.module.css';

/**
 * The crop tool. The box is drawn on the preview as shown; applying it sets
 * `steps.crop` in source pixels as one undo entry. The scale is kept, so the
 * physical size follows the crop.
 *
 * The box and its handles are drawn on the image; the handles keep their
 * screen size at any zoom. The Apply and Cancel bar goes into `barHost`, which
 * sits over the canvas at screen size, so it stays readable and on screen
 * at a phone's zoom (#54).
 */
export const CanvasCropOverlay: React.FC<{ barHost: HTMLElement | null }> = ({ barHost }) => {
  const canvasTool = useViewStore((s) => s.canvasTool);
  const setCanvasTool = useViewStore((s) => s.setCanvasTool);
  const source = useRenderStore((s) => s.source);
  const mmPerPx = useDocumentStore((s) => s.doc?.mmPerPx ?? null);
  const zoom = useViewStore((s) => s.zoom);
  const isPinching = useViewStore((s) => s.isPinching);
  const dimsWidth = source?.width ?? 0;
  const dimsHeight = source?.height ?? 0;
  const dims = useMemo(
    () => (dimsWidth > 0 ? { width: dimsWidth, height: dimsHeight } : null),
    [dimsWidth, dimsHeight]
  );

  const applyCanvasCrop = useCallback(
    (box: { x: number; y: number; width: number; height: number }) => {
      const current = useRenderStore.getState().source;
      const rect = current ? previewBoxToSource(current, box) : null;
      if (rect) useDocumentStore.getState().edit(setCrop(rect));
      setCanvasTool('pan');
    },
    [setCanvasTool]
  );

  const [ratio, setRatio] = useState<CropAspect>('free');
  const [cropBox, setCropBox] = useState<{ x: number; y: number; width: number; height: number }>({
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  });

  // The box, focused when the tool opens so the arrow keys work at once (#79).
  const boxRef = useRef<HTMLDivElement>(null);
  const [isBoxFocused, setIsBoxFocused] = useState(false);
  const hintId = useId();

  const [dragHandle, setDragHandle] = useState<CropHandle | null>(null);
  const dragStartRef = useRef<{
    /** The pointer dragging; another finger on the screen does not move the box. */
    pointerId: number;
    clientX: number;
    clientY: number;
    box: { x: number; y: number; width: number; height: number };
  }>({ pointerId: -1, clientX: 0, clientY: 0, box: { x: 0, y: 0, width: 800, height: 600 } });

  // Initialize crop box on tool activation
  useEffect(() => {
    if (canvasTool === 'crop' && dims) {
      const padX = Math.round(dims.width * 0.05);
      const padY = Math.round(dims.height * 0.05);
      setCropBox({
        x: padX,
        y: padY,
        width: dims.width - padX * 2,
        height: dims.height - padY * 2,
      });
    }
  }, [canvasTool, dims]);

  // Focus the box when the tool opens, wherever the tool was opened from.
  const isCropping = canvasTool === 'crop' && dims !== null;
  useEffect(() => {
    if (isCropping) boxRef.current?.focus({ preventScroll: true });
  }, [isCropping]);

  // A pinch that began with a finger on the box ends the box's drag (#54).
  useEffect(() => {
    if (isPinching) setDragHandle(null);
  }, [isPinching]);

  // Keyboard shortcut listener (Enter to apply, Esc to cancel)
  useEffect(() => {
    if (canvasTool !== 'crop') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyCanvasCrop(cropBox);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setCanvasTool('pan');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canvasTool, cropBox, applyCanvasCrop, setCanvasTool]);

  const handlePointerDownHandle = (e: React.PointerEvent, handle: CropHandle) => {
    e.stopPropagation();
    e.preventDefault();
    setDragHandle(handle);
    dragStartRef.current = {
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      box: { ...cropBox },
    };
  };

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragHandle || !dims || e.pointerId !== dragStartRef.current.pointerId) return;
    if (useViewStore.getState().isPinching) return;
    const dx = (e.clientX - dragStartRef.current.clientX) / zoom;
    const dy = (e.clientY - dragStartRef.current.clientY) / zoom;
    setCropBox(adjustCropBox(dragStartRef.current.box, dragHandle, dx, dy, dims, ratio));
  }, [dragHandle, dims, zoom, ratio]);

  // The box is focusable: the arrow keys move it and Shift+arrows size it,
  // so a crop can be drawn without a pointer (#79). Enter and Escape are
  // handled for the whole tool above.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!dims || e.ctrlKey || e.metaKey) return;
    const next = cropBoxForKey(cropBox, e, dims, ratio);
    if (!next) return;
    e.preventDefault();
    // The canvas pans on the arrow keys when it has focus itself; the box's keys are the box's.
    e.stopPropagation();
    setCropBox(next);
  };

  const handlePointerUp = useCallback((e: PointerEvent) => {
    if (e.pointerId !== dragStartRef.current.pointerId) return;
    setDragHandle(null);
  }, []);

  useEffect(() => {
    if (dragHandle) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    }
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragHandle, handlePointerMove, handlePointerUp]);

  if (canvasTool !== 'crop' || !dims) return null;

  // The box is in preview pixels; the crop it makes is in source pixels.
  const inSource = source ? previewBoxToSource(source, cropBox) : null;
  const fileW = inSource?.width ?? 0;
  const fileH = inSource?.height ?? 0;
  const physical =
    mmPerPx === null ? 'size not set' : `${(fileW * mmPerPx).toFixed(1)}×${(fileH * mmPerPx).toFixed(1)}mm`;

  const actionBar = (
    <div className={styles.cropActionBar} onPointerDown={(e) => e.stopPropagation()}>
      <select
        className={styles.ratioSelect}
        aria-label="Aspect ratio"
        value={ratio}
        onChange={(e) => setRatio(e.target.value as CropAspect)}
      >
        <option value="free">Freeform</option>
        <option value="1:1">1:1 Square</option>
        <option value="4:3">4:3</option>
        <option value="16:9">16:9</option>
        <option value="3:2">3:2</option>
      </select>

      <span className={styles.cropDimLabel}>
        {fileW}×{fileH}px ({physical})
      </span>

      {/* While the box has focus, its keys are shown where the size changes. */}
      <span id={hintId} className={isBoxFocused ? styles.keyHint : styles.visuallyHidden}>
        Arrows move · Shift+Arrows size · Alt: 1 px · Enter applies
      </span>

      <button className={styles.btnCancel} onClick={() => setCanvasTool('pan')} title="Cancel Crop (Esc)">
        <X size={12} /> Cancel
      </button>
      <button className={styles.btnApply} onClick={() => applyCanvasCrop(cropBox)} title="Apply Crop (Enter)">
        <Check size={12} /> Apply Crop
      </button>
    </div>
  );

  return (
    <div className={styles.cropContainer} style={{ width: dims.width, height: dims.height }}>
      {/* 4 Dimmed Exterior Panels */}
      <div className={styles.cropDimArea} style={{ top: 0, left: 0, right: 0, height: cropBox.y }} />
      <div className={styles.cropDimArea} style={{ top: cropBox.y + cropBox.height, left: 0, right: 0, bottom: 0 }} />
      <div className={styles.cropDimArea} style={{ top: cropBox.y, left: 0, width: cropBox.x, height: cropBox.height }} />
      <div className={styles.cropDimArea} style={{ top: cropBox.y, left: cropBox.x + cropBox.width, right: 0, height: cropBox.height }} />

      {/* Active Crop Box with Rule-of-Thirds Grid */}
      <div
        ref={boxRef}
        className={styles.cropBox}
        tabIndex={0}
        role="group"
        aria-label="Crop box"
        aria-describedby={hintId}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsBoxFocused(true)}
        onBlur={() => setIsBoxFocused(false)}
        style={{
          left: cropBox.x,
          top: cropBox.y,
          width: cropBox.width,
          height: cropBox.height,
        }}
        onPointerDown={(e) => handlePointerDownHandle(e, 'move')}
      >
        <div className={styles.gridLineH1} />
        <div className={styles.gridLineH2} />
        <div className={styles.gridLineV1} />
        <div className={styles.gridLineV2} />

        {/* 8 Resize Handles */}
        <div className={`${styles.handle} ${styles.handleNW}`} onPointerDown={(e) => handlePointerDownHandle(e, 'nw')} />
        <div className={`${styles.handle} ${styles.handleNE}`} onPointerDown={(e) => handlePointerDownHandle(e, 'ne')} />
        <div className={`${styles.handle} ${styles.handleSW}`} onPointerDown={(e) => handlePointerDownHandle(e, 'sw')} />
        <div className={`${styles.handle} ${styles.handleSE}`} onPointerDown={(e) => handlePointerDownHandle(e, 'se')} />
        <div className={`${styles.handle} ${styles.handleN}`} onPointerDown={(e) => handlePointerDownHandle(e, 'n')} />
        <div className={`${styles.handle} ${styles.handleS}`} onPointerDown={(e) => handlePointerDownHandle(e, 's')} />
        <div className={`${styles.handle} ${styles.handleW}`} onPointerDown={(e) => handlePointerDownHandle(e, 'w')} />
        <div className={`${styles.handle} ${styles.handleE}`} onPointerDown={(e) => handlePointerDownHandle(e, 'e')} />
      </div>
      {barHost && createPortal(actionBar, barHost)}
    </div>
  );
};
