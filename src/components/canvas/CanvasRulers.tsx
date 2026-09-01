import React, { useRef, useEffect, useState } from 'react';
import { useImageStore } from '../../store/imageStore';
import { useUIStore } from '../../store/uiStore';
import styles from './CanvasRulers.module.css';

export const CanvasRulers: React.FC = () => {
  const showRulers = useUIStore((s) => s.showRulers);
  const dims = useImageStore((s) => s.previewDimensions);
  const metadata = useImageStore((s) => s.metadata);
  const zoom = useImageStore((s) => s.zoom);
  const pan = useImageStore((s) => s.pan);

  const topCanvasRef = useRef<HTMLCanvasElement>(null);
  const leftCanvasRef = useRef<HTMLCanvasElement>(null);
  const [unit, setUnit] = useState<'mm' | 'in' | 'px'>('mm');
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  const dpi = metadata?.dpi || 300;

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
    if (!showRulers || !topCanvasRef.current || !dims) return;
    const canvas = topCanvasRef.current;
    const width = canvas.parentElement?.clientWidth || 800;
    const height = 24;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, width, height);

    // Canvas center origin in screen coordinates (accounting for left offset 24px)
    const canvasOriginX = (width / 2) + pan.x - (dims.width * zoom) / 2;

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
  }, [showRulers, dims, zoom, pan, dpi, unit, mousePos]);

  // Render Vertical (Left) Ruler
  useEffect(() => {
    if (!showRulers || !leftCanvasRef.current || !dims) return;
    const canvas = leftCanvasRef.current;
    const width = 24;
    const height = canvas.parentElement?.clientHeight || 600;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, width, height);

    // Canvas center origin in screen coordinates (accounting for top offset 24px)
    const canvasOriginY = (height / 2) + pan.y - (dims.height * zoom) / 2;

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
  }, [showRulers, dims, zoom, pan, dpi, unit, mousePos]);

  if (!showRulers || !dims) return null;

  const cycleUnit = () => {
    if (unit === 'mm') setUnit('in');
    else if (unit === 'in') setUnit('px');
    else setUnit('mm');
  };

  return (
    <>
      <div className={styles.rulerCorner} onClick={cycleUnit} title="Click to cycle units (mm, in, px)">
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
