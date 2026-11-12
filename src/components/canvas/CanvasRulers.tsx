import React, { useRef, useEffect, useState } from 'react';
import { useDocumentStore } from '../../store/documentStore';
import { pxPerMmOfSource, useRenderStore } from '../../store/renderStore';
import { useViewStore } from '../../store/viewStore';
import { useUIStore } from '../../store/uiStore';
import { MM_PER_INCH } from '../../lib/document-size';
import { RULER_THICKNESS, rulerZero } from '../../lib/viewport';
import styles from './CanvasRulers.module.css';

export const CanvasRulers: React.FC = () => {
  const showRulers = useUIStore((s) => s.showRulers);
  const source = useRenderStore((s) => s.source);
  const dims = source;
  const zoom = useViewStore((s) => s.zoom);
  const pan = useViewStore((s) => s.pan);
  const container = useViewStore((s) => s.container);
  // Preview pixels per mm; null while the size is not set, when only pixels can be shown.
  const pxPerMm = useDocumentStore((s) => (s.doc && source ? pxPerMmOfSource(s.doc, source) : null));

  const topCanvasRef = useRef<HTMLCanvasElement>(null);
  const leftCanvasRef = useRef<HTMLCanvasElement>(null);
  const [chosenUnit, setUnit] = useState<'mm' | 'in' | 'px'>('mm');
  const unit = pxPerMm === null ? 'px' : chosenUnit;
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  // The rulers measure preview pixels, so use the preview's own resolution.
  const dpi = (pxPerMm ?? 0) * MM_PER_INCH;

  // Track global mouse position for ruler crosshair indicators
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Render Horizontal (Top) Ruler
  useEffect(() => {
    if (!showRulers || !topCanvasRef.current || !dims || !container) return;
    const canvas = topCanvasRef.current;
    const width = container.width - RULER_THICKNESS;
    const height = RULER_THICKNESS;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, width, height);

    // The image's left edge on this ruler, which starts past the corner box.
    const canvasOriginX = rulerZero({ zoom, pan }, container, dims).x;

    // Unit step size in pixels
    let stepUnitPx = 1;
    let stepIncrement = 10; // 10mm, 1in, or 100px
    if (unit === 'mm') {
      stepUnitPx = (dpi / 25.4) * zoom;
      stepIncrement = zoom > 2 ? 5 : zoom > 0.5 ? 10 : 50;
    } else if (unit === 'in') {
      stepUnitPx = dpi * zoom;
      stepIncrement = zoom > 1 ? 0.5 : 1;
    } else {
      stepUnitPx = zoom;
      stepIncrement = zoom > 2 ? 50 : zoom > 0.5 ? 100 : 500;
    }

    const stepScreenPx = stepUnitPx * stepIncrement;
    if (stepScreenPx <= 0) return;

    // Find start and end indices
    const startIdx = Math.floor(-canvasOriginX / stepScreenPx) - 1;
    const endIdx = Math.ceil((width - canvasOriginX) / stepScreenPx) + 1;

    ctx.strokeStyle = '#30363d';
    ctx.fillStyle = '#8b949e';
    ctx.font = '9px monospace';
    ctx.lineWidth = 1;

    for (let i = startIdx; i <= endIdx; i++) {
      const screenX = canvasOriginX + i * stepScreenPx;
      const unitVal = (i * stepIncrement).toFixed(unit === 'in' && stepIncrement < 1 ? 1 : 0);

      // Major tick & label
      ctx.beginPath();
      ctx.moveTo(screenX, 10);
      ctx.lineTo(screenX, 24);
      ctx.stroke();
      ctx.fillText(unitVal, screenX + 3, 12);

      // Minor sub-ticks
      for (let sub = 1; sub < 5; sub++) {
        const subX = screenX + (sub / 5) * stepScreenPx;
        ctx.beginPath();
        ctx.moveTo(subX, sub === 2 || sub === 3 ? 16 : 19);
        ctx.lineTo(subX, 24);
        ctx.stroke();
      }
    }

    // Draw mouse indicator
    if (mousePos) {
      const rect = canvas.getBoundingClientRect();
      const cursorX = mousePos.x - rect.left;
      if (cursorX >= 0 && cursorX <= width) {
        ctx.strokeStyle = 'var(--accent-primary, #38bdf8)';
        ctx.beginPath();
        ctx.moveTo(cursorX, 0);
        ctx.lineTo(cursorX, 24);
        ctx.stroke();
      }
    }
  }, [showRulers, dims, container, zoom, pan, dpi, unit, mousePos]);

  // Render Vertical (Left) Ruler
  useEffect(() => {
    if (!showRulers || !leftCanvasRef.current || !dims || !container) return;
    const canvas = leftCanvasRef.current;
    const width = RULER_THICKNESS;
    const height = container.height - RULER_THICKNESS;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, width, height);

    // The image's top edge on this ruler, which starts below the corner box.
    const canvasOriginY = rulerZero({ zoom, pan }, container, dims).y;

    let stepUnitPx = 1;
    let stepIncrement = 10;
    if (unit === 'mm') {
      stepUnitPx = (dpi / 25.4) * zoom;
      stepIncrement = zoom > 2 ? 5 : zoom > 0.5 ? 10 : 50;
    } else if (unit === 'in') {
      stepUnitPx = dpi * zoom;
      stepIncrement = zoom > 1 ? 0.5 : 1;
    } else {
      stepUnitPx = zoom;
      stepIncrement = zoom > 2 ? 50 : zoom > 0.5 ? 100 : 500;
    }

    const stepScreenPx = stepUnitPx * stepIncrement;
    if (stepScreenPx <= 0) return;

    const startIdx = Math.floor(-canvasOriginY / stepScreenPx) - 1;
    const endIdx = Math.ceil((height - canvasOriginY) / stepScreenPx) + 1;

    ctx.strokeStyle = '#30363d';
    ctx.fillStyle = '#8b949e';
    ctx.font = '9px monospace';
    ctx.lineWidth = 1;

    for (let i = startIdx; i <= endIdx; i++) {
      const screenY = canvasOriginY + i * stepScreenPx;
      const unitVal = (i * stepIncrement).toFixed(unit === 'in' && stepIncrement < 1 ? 1 : 0);

      // Major tick & label
      ctx.beginPath();
      ctx.moveTo(10, screenY);
      ctx.lineTo(24, screenY);
      ctx.stroke();

      ctx.save();
      ctx.translate(12, screenY + 3);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(unitVal, 0, 0);
      ctx.restore();

      // Minor sub-ticks
      for (let sub = 1; sub < 5; sub++) {
        const subY = screenY + (sub / 5) * stepScreenPx;
        ctx.beginPath();
        ctx.moveTo(sub === 2 || sub === 3 ? 16 : 19, subY);
        ctx.lineTo(24, subY);
        ctx.stroke();
      }
    }

    // Draw mouse indicator
    if (mousePos) {
      const rect = canvas.getBoundingClientRect();
      const cursorY = mousePos.y - rect.top;
      if (cursorY >= 0 && cursorY <= height) {
        ctx.strokeStyle = 'var(--accent-primary, #38bdf8)';
        ctx.beginPath();
        ctx.moveTo(0, cursorY);
        ctx.lineTo(24, cursorY);
        ctx.stroke();
      }
    }
  }, [showRulers, dims, container, zoom, pan, dpi, unit, mousePos]);

  if (!showRulers || !dims) return null;

  const cycleUnit = () => {
    if (pxPerMm === null) return;
    if (unit === 'mm') setUnit('in');
    else if (unit === 'in') setUnit('px');
    else setUnit('mm');
  };

  return (
    <>
      <div
        className={styles.rulerCorner}
        onClick={cycleUnit}
        title={pxPerMm === null ? 'Set the size to measure in mm or inches' : 'Click to cycle units (mm, in, px)'}
      >
        {unit}
      </div>
      <div className={styles.topRuler}>
        <canvas ref={topCanvasRef} className={styles.rulerCanvas} />
      </div>
      <div className={styles.leftRuler}>
        <canvas ref={leftCanvasRef} className={styles.rulerCanvas} />
      </div>
    </>
  );
};
