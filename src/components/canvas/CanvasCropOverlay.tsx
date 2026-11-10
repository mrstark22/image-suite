import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Check, X } from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { useEditStore } from '../../store/editStore';
import styles from './CanvasCropOverlay.module.css';

type AspectRatio = 'free' | '1:1' | '4:3' | '16:9' | '3:2';

export const CanvasCropOverlay: React.FC = () => {
  const canvasTool = useImageStore((s) => s.canvasTool);
  const setCanvasTool = useImageStore((s) => s.setCanvasTool);
  const dims = useImageStore((s) => s.previewDimensions);
  const metadata = useImageStore((s) => s.metadata);
  const zoom = useImageStore((s) => s.zoom);
  const cropTo = useEditStore((s) => s.cropTo);

  const applyCanvasCrop = useCallback(
    (box: { x: number; y: number; width: number; height: number }) => {
      cropTo(box);
      setCanvasTool('pan');
    },
    [cropTo, setCanvasTool]
  );

  const [ratio, setRatio] = useState<AspectRatio>('free');
  const [cropBox, setCropBox] = useState<{ x: number; y: number; width: number; height: number }>({
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  });

  const [dragHandle, setDragHandle] = useState<string | null>(null);
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    box: { x: number; y: number; width: number; height: number };
  }>({ clientX: 0, clientY: 0, box: { x: 0, y: 0, width: 800, height: 600 } });

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

  const handleMouseDownHandle = (e: React.MouseEvent, handle: string) => {
    e.stopPropagation();
    e.preventDefault();
    setDragHandle(handle);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      box: { ...cropBox },
    };
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragHandle || !dims) return;
    const dx = (e.clientX - dragStartRef.current.clientX) / zoom;
    const dy = (e.clientY - dragStartRef.current.clientY) / zoom;
    const startBox = dragStartRef.current.box;

    let newX = startBox.x;
    let newY = startBox.y;
    let newW = startBox.width;
    let newH = startBox.height;

    if (dragHandle === 'move') {
      newX = Math.max(0, Math.min(dims.width - newW, startBox.x + dx));
      newY = Math.max(0, Math.min(dims.height - newH, startBox.y + dy));
    } else {
      if (dragHandle.includes('e')) newW = Math.max(30, Math.min(dims.width - newX, startBox.width + dx));
      if (dragHandle.includes('s')) newH = Math.max(30, Math.min(dims.height - newY, startBox.height + dy));
      if (dragHandle.includes('w')) {
        const potentialW = startBox.width - dx;
        if (potentialW >= 30) {
          newX = Math.max(0, startBox.x + dx);
          newW = startBox.width + (startBox.x - newX);
        }
      }
      if (dragHandle.includes('n')) {
        const potentialH = startBox.height - dy;
        if (potentialH >= 30) {
          newY = Math.max(0, startBox.y + dy);
          newH = startBox.height + (startBox.y - newY);
        }
      }

      // Constrain Aspect Ratio if set
      if (ratio === '1:1') {
        const side = Math.min(newW, newH);
        newW = side;
        newH = side;
      } else if (ratio === '4:3') {
        newH = Math.round(newW * (3 / 4));
      } else if (ratio === '16:9') {
        newH = Math.round(newW * (9 / 16));
      } else if (ratio === '3:2') {
        newH = Math.round(newW * (2 / 3));
      }
    }

    setCropBox({
      x: Math.round(newX),
      y: Math.round(newY),
      width: Math.round(newW),
      height: Math.round(newH),
    });
  }, [dragHandle, dims, zoom, ratio]);

  const handleMouseUp = useCallback(() => {
    setDragHandle(null);
  }, []);

  useEffect(() => {
    if (dragHandle) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragHandle, handleMouseMove, handleMouseUp]);

  if (canvasTool !== 'crop' || !dims) return null;

  const dpi = metadata?.dpi || 300;
  const mmW = ((cropBox.width / dpi) * 25.4).toFixed(1);
  const mmH = ((cropBox.height / dpi) * 25.4).toFixed(1);

  return (
    <div className={styles.cropContainer} style={{ width: dims.width, height: dims.height }}>
      {/* 4 Dimmed Exterior Panels */}
      <div className={styles.cropDimArea} style={{ top: 0, left: 0, right: 0, height: cropBox.y }} />
      <div className={styles.cropDimArea} style={{ top: cropBox.y + cropBox.height, left: 0, right: 0, bottom: 0 }} />
      <div className={styles.cropDimArea} style={{ top: cropBox.y, left: 0, width: cropBox.x, height: cropBox.height }} />
      <div className={styles.cropDimArea} style={{ top: cropBox.y, left: cropBox.x + cropBox.width, right: 0, height: cropBox.height }} />

      {/* Active Crop Box with Rule-of-Thirds Grid */}
      <div
        className={styles.cropBox}
        style={{
          left: cropBox.x,
          top: cropBox.y,
          width: cropBox.width,
          height: cropBox.height,
        }}
        onMouseDown={(e) => handleMouseDownHandle(e, 'move')}
      >
        <div className={styles.gridLineH1} />
        <div className={styles.gridLineH2} />
        <div className={styles.gridLineV1} />
        <div className={styles.gridLineV2} />

        {/* 8 Resize Handles */}
        <div className={`${styles.handle} ${styles.handleNW}`} onMouseDown={(e) => handleMouseDownHandle(e, 'nw')} />
        <div className={`${styles.handle} ${styles.handleNE}`} onMouseDown={(e) => handleMouseDownHandle(e, 'ne')} />
        <div className={`${styles.handle} ${styles.handleSW}`} onMouseDown={(e) => handleMouseDownHandle(e, 'sw')} />
        <div className={`${styles.handle} ${styles.handleSE}`} onMouseDown={(e) => handleMouseDownHandle(e, 'se')} />
        <div className={`${styles.handle} ${styles.handleN}`} onMouseDown={(e) => handleMouseDownHandle(e, 'n')} />
        <div className={`${styles.handle} ${styles.handleS}`} onMouseDown={(e) => handleMouseDownHandle(e, 's')} />
        <div className={`${styles.handle} ${styles.handleW}`} onMouseDown={(e) => handleMouseDownHandle(e, 'w')} />
        <div className={`${styles.handle} ${styles.handleE}`} onMouseDown={(e) => handleMouseDownHandle(e, 'e')} />

        {/* Floating Action Controls Bar */}
        <div className={styles.cropActionBar} onMouseDown={(e) => e.stopPropagation()}>
          <select
            className={styles.ratioSelect}
            value={ratio}
            onChange={(e) => setRatio(e.target.value as AspectRatio)}
          >
            <option value="free">Freeform</option>
            <option value="1:1">1:1 Square</option>
            <option value="4:3">4:3</option>
            <option value="16:9">16:9</option>
            <option value="3:2">3:2</option>
          </select>

          <span className={styles.cropDimLabel}>
            {cropBox.width}×{cropBox.height}px ({mmW}×{mmH}mm)
          </span>

          <button className={styles.btnCancel} onClick={() => setCanvasTool('pan')} title="Cancel Crop (Esc)">
            <X size={12} style={{ verticalAlign: 'middle' }} /> Cancel
          </button>
          <button className={styles.btnApply} onClick={() => applyCanvasCrop(cropBox)} title="Apply Crop (Enter)">
            <Check size={12} /> Apply Crop
          </button>
        </div>
      </div>
    </div>
  );
};
