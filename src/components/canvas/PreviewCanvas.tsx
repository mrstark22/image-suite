import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useDocumentStore } from '../../store/documentStore';
import { pxPerMmOfSource, useRenderStore } from '../../store/renderStore';
import { useViewStore } from '../../store/viewStore';
import { openImageFiles, confirmReplaceInBrowser } from '../../lib/open-image';
import { DEFAULT_DEPTH } from '../../lib/document';
import { fitsDimensions } from '../../lib/crop';
import { fromCentre } from '../../lib/viewport';
import { ActivePointers, pinchView, type PointerPair } from '../../lib/gestures';
import { isTypingTarget } from '../../lib/shortcuts';
import { useUIStore } from '../../store/uiStore';
import { canvasImage, showsOrbitView } from '../../lib/workflows';
import { DropZone } from '../shared/DropZone';
import { DepthViewer3D } from './DepthViewer3D';
import { CanvasRulers } from './CanvasRulers';
import { CanvasCropOverlay } from './CanvasCropOverlay';
import styles from './PreviewCanvas.module.css';

export const PreviewCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The container, as state so the effects below re-run when it mounts.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const offscreenOrigRef = useRef<HTMLCanvasElement | null>(null);

  const source = useRenderStore((s) => s.source);
  const previewBuffer = source?.buffer ?? null;
  // What the job's output is made from: in the vector job, the image the trace reads.
  const job = useUIStore((s) => s.job);
  const shows = canvasImage(job);
  const processedRender = useRenderStore((s) => s.processed);
  const processedBuffer = shows === 'source' ? previewBuffer : processedRender;
  const depthHeightMapBuffer = useRenderStore((s) => s.depthHeightMap);
  const previewVersion = useRenderStore((s) => s.previewVersion);
  const docId = useDocumentStore((s) => s.doc?.id ?? null);
  // Preview pixels per mm, for guides measured in mm; null while the size is not set.
  const pxPerMm = useDocumentStore((s) => (s.doc && source ? pxPerMmOfSource(s.doc, source) : null));
  const canvasTool = useViewStore((s) => s.canvasTool);
  const substrateMask = useViewStore((s) => s.substrateMask);
  const substrateCornerRadius = useViewStore((s) => s.substrateCornerRadius);
  const zoom = useViewStore((s) => s.zoom);
  const pan = useViewStore((s) => s.pan);
  const zoomBy = useViewStore((s) => s.zoomBy);
  const setPan = useViewStore((s) => s.setPan);
  const setView = useViewStore((s) => s.setView);
  const splitPosition = useViewStore((s) => s.splitPosition);
  const setSplitPosition = useViewStore((s) => s.setSplitPosition);
  const fit = useViewStore((s) => s.fit);
  const setFrame = useViewStore((s) => s.setFrame);
  const dimsWidth = source?.width ?? 0;
  const dimsHeight = source?.height ?? 0;
  const dims = useMemo(
    () => (dimsWidth > 0 ? { width: dimsWidth, height: dimsHeight } : null),
    [dimsWidth, dimsHeight]
  );

  // With the source shown there is no before and after to split.
  const isSplitView = useUIStore((s) => s.isSplitView) && shows !== 'source';
  const isInvertedView = useUIStore((s) => s.isInvertedView);
  const showVectorOverlay = useUIStore((s) => s.showVectorOverlay);

  const vectorResult = useRenderStore((s) => s.vectorResult);
  const depthConfig = useDocumentStore((s) => s.doc?.depth ?? DEFAULT_DEPTH);

  // Interaction State
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [isDragOverCanvas, setIsDragOverCanvas] = useState(false);
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  // Where the crop tool puts its Apply and Cancel bar: over the canvas at screen
  // size, not on the image, where it would scale with the zoom (#54).
  const [cropBarHost, setCropBarHost] = useState<HTMLDivElement | null>(null);

  // The pointers down on the canvas, and the gesture they make (#54): one
  // pointer pans (with the pan tool, the middle or right button, or Space),
  // two pointers pinch to zoom and pan together. Mouse, pen and touch take
  // the same path.
  const pointersRef = useRef(new ActivePointers());
  const gestureRef = useRef<
    | { kind: 'pan'; pointerId: number; clientX: number; clientY: number; panX: number; panY: number }
    | { kind: 'pinch'; start: PointerPair; zoom: number; panX: number; panY: number }
    | null
  >(null);

  // Tell the view store the container's and the image's sizes, so Fit can
  // fit and a fitted view stays fitted when the window or the crop changes.
  useEffect(() => {
    if (!container || !dims) return;
    const report = () => setFrame({ width: container.clientWidth, height: container.clientHeight }, dims);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(container);
    return () => observer.disconnect();
  }, [container, dims, setFrame]);

  // Fit each newly opened image to the view.
  const fittedDocRef = useRef<string | null>(null);
  useEffect(() => {
    if (dims && docId && fittedDocRef.current !== docId) {
      fittedDocRef.current = docId;
      fit();
    }
  }, [dims, docId, fit]);

  // Wheel zoom about the pointer. Attached directly because React's wheel
  // listener is passive, and the page must not scroll or zoom instead.
  useEffect(() => {
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY === 0) return;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomBy(factor, fromCentre({ x: e.clientX, y: e.clientY }, container.getBoundingClientRect()));
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [container, zoomBy]);

  // Holding Space with the pointer over the canvas pans with any tool. Space
  // is taken from the page only then, so it does not also press the focused
  // button; elsewhere it keeps its usual meaning, and it never leaves a text field.
  const pointerOverCanvasRef = useRef(false);
  useEffect(() => {
    let held = false;
    const setHeld = (value: boolean) => {
      held = value;
      setIsSpaceHeld(value);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (!held && (!pointerOverCanvasRef.current || isTypingTarget(document.activeElement))) return;
      e.preventDefault();
      if (!held) setHeld(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !held) return;
      e.preventDefault();
      setHeld(false);
    };
    // A key released while the window is not focused never sends keyup.
    const handleBlur = () => setHeld(false);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // Maintain persistent offscreen canvas for original image
  useEffect(() => {
    if (!previewBuffer || !dims) return;
    if (!offscreenOrigRef.current) {
      offscreenOrigRef.current = document.createElement('canvas');
    }
    const offscreen = offscreenOrigRef.current;
    if (offscreen.width !== dims.width || offscreen.height !== dims.height) {
      offscreen.width = dims.width;
      offscreen.height = dims.height;
    }
    // A buffer for other dimensions is a stale result (#19); skip it rather than throw.
    if (!fitsDimensions(previewBuffer, dims.width, dims.height)) return;
    const oCtx = offscreen.getContext('2d', { willReadFrequently: true });
    if (oCtx) {
      const origImageData = new ImageData(
        new Uint8ClampedArray(previewBuffer),
        dims.width,
        dims.height
      );
      oCtx.putImageData(origImageData, 0, 0);
    }
  }, [previewBuffer, dims]);

  // Render Canvas Buffers efficiently without allocations
  useEffect(() => {
    if (!canvasRef.current || !dims || !processedBuffer) return;
    // A buffer for other dimensions is a stale result (#19); skip it rather than throw.
    if (!fitsDimensions(processedBuffer, dims.width, dims.height)) return;

    const canvas = canvasRef.current;
    if (canvas.width !== dims.width || canvas.height !== dims.height) {
      canvas.width = dims.width;
      canvas.height = dims.height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw processed composite image
    const processedImageData = new ImageData(
      new Uint8ClampedArray(processedBuffer),
      dims.width,
      dims.height
    );

    ctx.putImageData(processedImageData, 0, 0);

    // If split view is enabled, draw sliced original from cached offscreen canvas
    if (isSplitView && offscreenOrigRef.current) {
      const splitX = Math.round(dims.width * splitPosition);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, splitX, dims.height);
      ctx.clip();
      ctx.drawImage(offscreenOrigRef.current, 0, 0);
      ctx.restore();
    }
  }, [processedBuffer, previewVersion, dims, isSplitView, splitPosition]);

  /** A point of a pointer event, from the container's centre. */
  const pointOf = (e: { clientX: number; clientY: number }) =>
    container
      ? fromCentre({ x: e.clientX, y: e.clientY }, container.getBoundingClientRect())
      : { x: e.clientX, y: e.clientY };

  const startPan = (pointerId: number, clientX: number, clientY: number) => {
    const { pan } = useViewStore.getState();
    gestureRef.current = { kind: 'pan', pointerId, clientX, clientY, panX: pan.x, panY: pan.y };
  };

  const startPinch = (pair: PointerPair) => {
    const { zoom, pan } = useViewStore.getState();
    gestureRef.current = { kind: 'pinch', start: pair, zoom, panX: pan.x, panY: pan.y };
  };

  /** Whether one pointer going down on the canvas starts a pan. */
  const pansCanvas = (e: React.PointerEvent) =>
    canvasTool === 'pan' ||
    (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)); // Middle or right button

  // Space+drag pans whatever is under the pointer, so it is taken in the
  // capture phase, before the crop box or the split handle can claim it. So
  // is a second finger, so a pinch begun on the canvas can land on the crop box.
  const handlePointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    if (isSpaceHeld && pointers.size === 0) {
      e.stopPropagation();
      e.preventDefault();
      pointers.down(e.pointerId, pointOf(e));
      e.currentTarget.setPointerCapture?.(e.pointerId);
      startPan(e.pointerId, e.clientX, e.clientY);
    } else if (e.pointerType !== 'mouse' && pointers.size === 1 && !pointers.has(e.pointerId)) {
      e.stopPropagation();
      e.preventDefault();
      pointers.down(e.pointerId, pointOf(e));
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const pair = pointers.pair();
      if (pair) startPinch(pair);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingSplit) return;
    const pointers = pointersRef.current;
    if (pointers.has(e.pointerId)) return;
    if (e.pointerType !== 'mouse' && pointers.size === 0) {
      // The first finger: it may become a pinch when a second one lands.
      pointers.down(e.pointerId, pointOf(e));
      e.currentTarget.setPointerCapture?.(e.pointerId);
      if (pansCanvas(e)) startPan(e.pointerId, e.clientX, e.clientY);
      return;
    }
    if (e.pointerType === 'mouse' && pansCanvas(e)) {
      pointers.down(e.pointerId, pointOf(e));
      e.currentTarget.setPointerCapture?.(e.pointerId);
      startPan(e.pointerId, e.clientX, e.clientY);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.move(e.pointerId, pointOf(e))) return;
    const gesture = gestureRef.current;
    if (gesture?.kind === 'pinch') {
      const pair = pointersRef.current.pair();
      if (pair) {
        setView(pinchView({ zoom: gesture.zoom, pan: { x: gesture.panX, y: gesture.panY } }, gesture.start, pair));
      }
    } else if (gesture?.kind === 'pan' && gesture.pointerId === e.pointerId) {
      setPan({
        x: gesture.panX + e.clientX - gesture.clientX,
        y: gesture.panY + e.clientY - gesture.clientY,
      });
    }
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.has(e.pointerId)) return;
    pointers.up(e.pointerId);
    const wasPinch = gestureRef.current?.kind === 'pinch';
    gestureRef.current = null;
    // Lifting one finger of a pinch carries on as a pan with the other,
    // from where it is now, so the view does not jump.
    const rest = pointers.first();
    if (wasPinch && rest && canvasTool === 'pan' && container) {
      const rect = container.getBoundingClientRect();
      startPan(rest.id, rest.at.x + rect.left + rect.width / 2, rest.at.y + rect.top + rect.height / 2);
    }
  };

  // The split divider follows the pointer until it is released anywhere.
  useEffect(() => {
    if (!isDraggingSplit) return;
    const handleMove = (e: PointerEvent) => {
      if (!dims || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      setSplitPosition(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
    };
    const handleUp = () => setIsDraggingSplit(false);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [isDraggingSplit, dims, setSplitPosition]);

  // Drag and drop onto canvas
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverCanvas(true);
  };

  const handleDragLeave = () => {
    setIsDragOverCanvas(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverCanvas(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      openImageFiles(Array.from(e.dataTransfer.files), confirmReplaceInBrowser).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load image file';
        useRenderStore.getState().setErrorMessage(message);
      });
    }
  };

  if (!previewBuffer || !dims) {
    return (
      <div className={styles.canvasContainer}>
        <DropZone />
      </div>
    );
  }

  // Interactive 3D orbit view of the relief
  // (not while cropping: the crop box is drawn on the flat relief).
  if (showsOrbitView(job, depthConfig.viewMode, canvasTool)) {
    return (
      <div className={styles.canvasContainer}>
        <DepthViewer3D
          depthBuffer={depthHeightMapBuffer || processedBuffer || previewBuffer}
          width={dims.width}
          height={dims.height}
        />
      </div>
    );
  }

  return (
    <div
      ref={setContainer}
      className={`${styles.canvasContainer} ${styles.canvasContainerPan} ${isDragOverCanvas ? styles.dragOver : ''}`}
      onPointerEnter={() => (pointerOverCanvasRef.current = true)}
      onPointerLeave={() => (pointerOverCanvasRef.current = false)}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Interactive Physical Canvas Rulers (mm, in, px) */}
      <CanvasRulers />

      <div ref={setCropBarHost} className={styles.cropBarHost} />

      {isSplitView && (
        <>
          <div className={styles.splitLabelBefore}>Original</div>
          <div className={styles.splitLabelAfter}>Processed</div>
        </>
      )}

      <div
        // The pan and zoom are the run-time values; the inverted view is a class.
        className={`${styles.canvasWrapper} ${isInvertedView ? styles.invertedView : ''}`}
        // --view-zoom lets the crop handles keep their screen size at any zoom.
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, '--view-zoom': zoom } as React.CSSProperties}
      >
        <canvas ref={canvasRef} className={styles.mainCanvas} />

        {/* Vector Path Overlay */}
        {showVectorOverlay && vectorResult && (
          <svg
            className={styles.svgOverlay}
            viewBox={`0 0 ${dims.width} ${dims.height}`}
          >
            {vectorResult.layers.map((layer) =>
              layer.visible ? (
                <g
                  key={layer.id}
                  stroke={layer.color}
                  fill="none"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {layer.paths.map((p) => (
                    <path key={p.id} d={p.svgPathData} />
                  ))}
                </g>
              ) : null
            )}
          </svg>
        )}

        {/* Substrate Shape Mask Guide */}
        {substrateMask !== 'none' && (
          <svg
            className={`${styles.svgOverlay} ${styles.maskOverlay}`}
            viewBox={`0 0 ${dims.width} ${dims.height}`}
          >
            {substrateMask === 'circle' && (
              <circle
                cx={dims.width / 2}
                cy={dims.height / 2}
                r={Math.min(dims.width, dims.height) / 2 - 4}
                stroke="var(--overlay)"
                strokeWidth="2"
                strokeDasharray="6 4"
                fill="none"
              />
            )}
            {substrateMask === 'rounded-rect' && pxPerMm !== null && (
              <rect
                x="4"
                y="4"
                width={dims.width - 8}
                height={dims.height - 8}
                rx={Math.round(substrateCornerRadius * pxPerMm)}
                stroke="var(--overlay)"
                strokeWidth="2"
                strokeDasharray="6 4"
                fill="none"
              />
            )}
            {substrateMask === 'oval' && (
              <ellipse
                cx={dims.width / 2}
                cy={dims.height / 2}
                rx={dims.width / 2 - 4}
                ry={dims.height / 2 - 4}
                stroke="var(--overlay)"
                strokeWidth="2"
                strokeDasharray="6 4"
                fill="none"
              />
            )}
          </svg>
        )}

        {/* Interactive Canvas Crop Tool Overlay */}
        <CanvasCropOverlay barHost={cropBarHost} />

        {/* Split View Line & Drag Handle */}
        {isSplitView && (
          <SplitDivider
            splitPosition={splitPosition}
            onChange={setSplitPosition}
            onDragStart={() => setIsDraggingSplit(true)}
          />
        )}
      </div>
    </div>
  );
};

/** How far one arrow key moves the before/after divider, as a fraction of the width. */
export const SPLIT_KEY_STEP = 0.05;

interface SplitDividerProps {
  /** Where the divider is, 0 (left edge) to 1 (right edge). */
  splitPosition: number;
  onChange: (position: number) => void;
  /** A pointer drag on the divider starts; the canvas follows the pointer. */
  onDragStart: () => void;
}

/**
 * The before/after divider. Dragged with a pointer, or focused and moved with
 * the arrow keys (Shift for a larger step; Home and End go to the edges), as a
 * focusable separator, so the comparison can be moved from the keyboard (#55).
 */
export const SplitDivider: React.FC<SplitDividerProps> = ({ splitPosition, onChange, onDragStart }) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? SPLIT_KEY_STEP * 4 : SPLIT_KEY_STEP;
    let next: number | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = splitPosition - step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = splitPosition + step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    if (next === null) return;
    e.preventDefault();
    onChange(Math.max(0, Math.min(1, next)));
  };

  return (
    <div
      className={styles.splitDivider}
      // The divider follows the split, known only at run time.
      style={{ left: `${splitPosition * 100}%` }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Before and after divider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(splitPosition * 100)}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={(e) => {
        e.stopPropagation();
        onDragStart();
      }}
    >
      <div className={styles.splitHandle} aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6" />
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </div>
  );
};
