import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useDocumentStore } from '../../store/documentStore';
import { pxPerMmOfSource, useRenderStore } from '../../store/renderStore';
import { useViewStore } from '../../store/viewStore';
import { openImageFiles, confirmReplaceInBrowser } from '../../lib/open-image';
import { DEFAULT_DEPTH } from '../../lib/document';
import { fitsDimensions } from '../../lib/crop';
import { fromCentre } from '../../lib/viewport';
import { useUIStore } from '../../store/uiStore';
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
  const processedBuffer = useRenderStore((s) => s.processed);
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

  const isSplitView = useUIStore((s) => s.isSplitView);
  const isInvertedBurn = useUIStore((s) => s.isInvertedBurn);
  const showVectorOverlay = useUIStore((s) => s.showVectorOverlay);
  const activeTab = useUIStore((s) => s.activeTab);

  const vectorResult = useRenderStore((s) => s.vectorResult);
  const depthConfig = useDocumentStore((s) => s.doc?.depth ?? DEFAULT_DEPTH);

  // Interaction State
  const [isDraggingPan, setIsDraggingPan] = useState(false);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [isDragOverCanvas, setIsDragOverCanvas] = useState(false);
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);

  const dragStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number }>({
    clientX: 0,
    clientY: 0,
    panX: 0,
    panY: 0,
  });

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

  // Spacebar tracking for hand tool override
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isSpaceHeld && document.activeElement?.tagName !== 'INPUT') {
        setIsSpaceHeld(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpaceHeld(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isSpaceHeld]);

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

  // Mouse Down Interaction
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isDraggingSplit) return;

    const isPanAction =
      isSpaceHeld ||
      canvasTool === 'pan' ||
      e.button === 1 || // Middle mouse
      e.button === 2;   // Right click

    if (isPanAction) {
      setIsDraggingPan(true);
      dragStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    }
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDraggingSplit && dims && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const relativeX = (e.clientX - rect.left) / rect.width;
      setSplitPosition(Math.max(0, Math.min(1, relativeX)));
    } else if (isDraggingPan) {
      const deltaX = e.clientX - dragStartRef.current.clientX;
      const deltaY = e.clientY - dragStartRef.current.clientY;
      setPan({
        x: dragStartRef.current.panX + deltaX,
        y: dragStartRef.current.panY + deltaY,
      });
    }
  }, [isDraggingSplit, isDraggingPan, dims, setPan, setSplitPosition]);

  const handleMouseUp = useCallback(() => {
    setIsDraggingPan(false);
    setIsDraggingSplit(false);
  }, []);

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

  useEffect(() => {
    if (isDraggingPan || isDraggingSplit) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingPan, isDraggingSplit, handleMouseMove, handleMouseUp]);

  if (!previewBuffer || !dims) {
    return (
      <div className={styles.canvasContainer}>
        <DropZone />
      </div>
    );
  }

  // Interactive 3D Orbit Viewport for 3D Depth Tab
  if (activeTab === 'depth' && depthConfig.viewMode === '3d-interactive') {
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
      className={`${styles.canvasContainer} ${styles.canvasContainerPan}`}
      onMouseDown={handleMouseDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        outline: isDragOverCanvas ? '2px dashed var(--accent-primary)' : 'none',
        outlineOffset: '-4px',
      }}
    >
      {/* Interactive Physical Canvas Rulers (mm, in, px) */}
      <CanvasRulers />

      {isSplitView && (
        <>
          <div className={styles.splitLabelBefore}>Original</div>
          <div className={styles.splitLabelAfter}>Processed</div>
        </>
      )}

      <div
        className={styles.canvasWrapper}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
          filter: isInvertedBurn ? 'invert(1) hue-rotate(180deg)' : 'none',
        }}
      >
        <canvas ref={canvasRef} className={styles.mainCanvas} />

        {/* Vector Path Overlay */}
        {showVectorOverlay && vectorResult && (
          <svg
            className={styles.svgOverlay}
            viewBox={`0 0 ${dims.width} ${dims.height}`}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
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
            className={styles.svgOverlay}
            viewBox={`0 0 ${dims.width} ${dims.height}`}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 25 }}
          >
            {substrateMask === 'circle' && (
              <circle
                cx={dims.width / 2}
                cy={dims.height / 2}
                r={Math.min(dims.width, dims.height) / 2 - 4}
                stroke="var(--accent-primary, #38bdf8)"
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
                stroke="var(--accent-primary, #38bdf8)"
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
                stroke="var(--accent-primary, #38bdf8)"
                strokeWidth="2"
                strokeDasharray="6 4"
                fill="none"
              />
            )}
          </svg>
        )}

        {/* Interactive Canvas Crop Tool Overlay */}
        <CanvasCropOverlay />

        {/* Split View Line & Drag Handle */}
        {isSplitView && (
          <div
            className={styles.splitDivider}
            style={{ left: `${splitPosition * 100}%` }}
            onMouseDown={(e) => {
              e.stopPropagation();
              setIsDraggingSplit(true);
            }}
          >
            <div className={styles.splitHandle}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
