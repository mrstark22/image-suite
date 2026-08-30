import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useImageStore } from '../../store/imageStore';
import { useEditStore } from '../../store/editStore';
import { useUIStore } from '../../store/uiStore';
import { DropZone } from '../shared/DropZone';
import { DepthViewer3D } from './DepthViewer3D';
import styles from './PreviewCanvas.module.css';

export const PreviewCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const offscreenOrigRef = useRef<HTMLCanvasElement | null>(null);

  const previewBuffer = useImageStore((s) => s.previewBuffer);
  const processedBuffer = useImageStore((s) => s.previewProcessedBuffer);
  const depthHeightMapBuffer = useImageStore((s) => s.depthHeightMapBuffer);
  const previewVersion = useImageStore((s) => s.previewVersion);
  const dims = useImageStore((s) => s.previewDimensions);
  const zoom = useImageStore((s) => s.zoom);
  const pan = useImageStore((s) => s.pan);
  const setZoom = useImageStore((s) => s.setZoom);
  const setPan = useImageStore((s) => s.setPan);
  const splitPosition = useImageStore((s) => s.splitPosition);
  const setSplitPosition = useImageStore((s) => s.setSplitPosition);

  const isSplitView = useUIStore((s) => s.isSplitView);
  const isInvertedBurn = useUIStore((s) => s.isInvertedBurn);
  const showVectorOverlay = useUIStore((s) => s.showVectorOverlay);
  const activeTab = useUIStore((s) => s.activeTab);
  const vectorResult = useEditStore((s) => s.vectorResult);
  const depthConfig = useEditStore((s) => s.depth);

  const [isDraggingPan, setIsDraggingPan] = useState(false);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

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

    const canvas = canvasRef.current;
    if (canvas.width !== dims.width || canvas.height !== dims.height) {
      canvas.width = dims.width;
      canvas.height = dims.height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw processed image
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

  // Handle Wheel Zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    setZoom((prev) => prev * zoomFactor);
  };

  // Pan & Split Interaction Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && !isDraggingSplit) {
      setIsDraggingPan(true);
      dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDraggingSplit && dims && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const relativeX = (e.clientX - rect.left) / rect.width;
      setSplitPosition(Math.max(0, Math.min(1, relativeX)));
    } else if (isDraggingPan) {
      setPan({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      });
    }
  }, [isDraggingSplit, isDraggingPan, dims, setPan, setSplitPosition]);

  const handleMouseUp = useCallback(() => {
    setIsDraggingPan(false);
    setIsDraggingSplit(false);
  }, []);

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
      ref={containerRef}
      className={styles.canvasContainer}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
    >
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
