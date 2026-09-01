import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useImageStore } from '../../store/imageStore';
import { useEditStore } from '../../store/editStore';
import { useLayerStore } from '../../store/layerStore';
import { useUIStore } from '../../store/uiStore';
import { DropZone } from '../shared/DropZone';
import { DepthViewer3D } from './DepthViewer3D';
import { CanvasRulers } from './CanvasRulers';
import { CanvasCropOverlay } from './CanvasCropOverlay';
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
  const metadata = useImageStore((s) => s.metadata);
  const canvasTool = useImageStore((s) => s.canvasTool);
  const substrateMask = useImageStore((s) => s.substrateMask);
  const substrateCornerRadius = useImageStore((s) => s.substrateCornerRadius);
  const zoom = useImageStore((s) => s.zoom);
  const pan = useImageStore((s) => s.pan);
  const setZoom = useImageStore((s) => s.setZoom);
  const setPan = useImageStore((s) => s.setPan);
  const splitPosition = useImageStore((s) => s.splitPosition);
  const setSplitPosition = useImageStore((s) => s.setSplitPosition);
  const fitToViewport = useImageStore((s) => s.fitToViewport);

  const isSplitView = useUIStore((s) => s.isSplitView);
  const isInvertedBurn = useUIStore((s) => s.isInvertedBurn);
  const showVectorOverlay = useUIStore((s) => s.showVectorOverlay);
  const activeTab = useUIStore((s) => s.activeTab);

  const vectorResult = useEditStore((s) => s.vectorResult);
  const depthConfig = useEditStore((s) => s.depth);
  const beginAdjustment = useEditStore((s) => s.beginAdjustment);
  const commitAdjustment = useEditStore((s) => s.commitAdjustment);

  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const setLayerTransform = useLayerStore((s) => s.setLayerTransform);
  const importImageFiles = useLayerStore((s) => s.importImageFiles);

  const activeLayer = layers.find((l) => l.id === activeLayerId) || layers[0] || null;

  // Interaction State
  const [isDraggingPan, setIsDraggingPan] = useState(false);
  const [isDraggingLayer, setIsDraggingLayer] = useState(false);
  const [scalingHandle, setScalingHandle] = useState<'tl' | 'tr' | 'bl' | 'br' | null>(null);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [isDragOverCanvas, setIsDragOverCanvas] = useState(false);
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);

  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    panX: number;
    panY: number;
    layerX: number;
    layerY: number;
    initialScale: number;
    boxWidth: number;
    boxHeight: number;
  }>({
    clientX: 0,
    clientY: 0,
    panX: 0,
    panY: 0,
    layerX: 0,
    layerY: 0,
    initialScale: 1.0,
    boxWidth: 100,
    boxHeight: 100,
  });

  // Auto-fit on initial first load
  const hasAutoFittedRef = useRef(false);
  useEffect(() => {
    if (dims && containerRef.current && !hasAutoFittedRef.current) {
      hasAutoFittedRef.current = true;
      const rect = containerRef.current.getBoundingClientRect();
      fitToViewport(rect.width, rect.height);
    }
  }, [dims, fitToViewport]);

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

  // Handle Wheel Zoom (preserving center)
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    setZoom((prev) => prev * zoomFactor);
  };

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
        layerX: 0,
        layerY: 0,
        initialScale: 1.0,
        boxWidth: 0,
        boxHeight: 0,
      };
      return;
    }

    if (e.button === 0 && canvasTool === 'move' && activeLayer && !activeLayer.locked) {
      // Start moving active layer
      beginAdjustment();
      setIsDraggingLayer(true);
      dragStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        panX: pan.x,
        panY: pan.y,
        layerX: activeLayer.transform?.x || 0,
        layerY: activeLayer.transform?.y || 0,
        initialScale: activeLayer.transform?.scale ?? 1.0,
        boxWidth: Math.max(20, boxWidth),
        boxHeight: Math.max(20, boxHeight),
      };
    }
  };

  const handleStartCornerScale = (e: React.MouseEvent, handle: 'tl' | 'tr' | 'bl' | 'br') => {
    e.stopPropagation();
    if (!activeLayer || activeLayer.locked) return;
    beginAdjustment();
    setScalingHandle(handle);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      panX: pan.x,
      panY: pan.y,
      layerX: activeLayer.transform?.x || 0,
      layerY: activeLayer.transform?.y || 0,
      initialScale: activeLayer.transform?.scale ?? 1.0,
      boxWidth: Math.max(20, boxWidth),
      boxHeight: Math.max(20, boxHeight),
    };
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
    } else if (isDraggingLayer && activeLayer) {
      const deltaX = (e.clientX - dragStartRef.current.clientX) / zoom;
      const deltaY = (e.clientY - dragStartRef.current.clientY) / zoom;
      setLayerTransform(activeLayer.id, {
        x: Math.round(dragStartRef.current.layerX + deltaX),
        y: Math.round(dragStartRef.current.layerY + deltaY),
      });
    } else if (scalingHandle && activeLayer) {
      const deltaX = (e.clientX - dragStartRef.current.clientX) / zoom;
      const deltaY = (e.clientY - dragStartRef.current.clientY) / zoom;
      const initialScale = dragStartRef.current.initialScale;
      const baseDim = (dragStartRef.current.boxWidth + dragStartRef.current.boxHeight) / 2;

      let deltaMagnitude = 0;
      if (scalingHandle === 'br') deltaMagnitude = (deltaX + deltaY) / 2;
      else if (scalingHandle === 'tl') deltaMagnitude = (-deltaX - deltaY) / 2;
      else if (scalingHandle === 'tr') deltaMagnitude = (deltaX - deltaY) / 2;
      else if (scalingHandle === 'bl') deltaMagnitude = (-deltaX + deltaY) / 2;

      const scaleRatio = 1 + deltaMagnitude / Math.max(10, baseDim / initialScale);
      const newScale = Math.max(0.05, Math.min(10.0, Number((initialScale * scaleRatio).toFixed(3))));

      setLayerTransform(activeLayer.id, { scale: newScale });
    }
  }, [isDraggingSplit, isDraggingPan, isDraggingLayer, scalingHandle, activeLayer, dims, zoom, setPan, setSplitPosition, setLayerTransform]);

  const handleMouseUp = useCallback(() => {
    if (isDraggingLayer || scalingHandle) {
      commitAdjustment();
    }
    setIsDraggingPan(false);
    setIsDraggingLayer(false);
    setIsDraggingSplit(false);
    setScalingHandle(null);
  }, [isDraggingLayer, scalingHandle, commitAdjustment]);

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
      importImageFiles(Array.from(e.dataTransfer.files));
    }
  };

  useEffect(() => {
    if (isDraggingPan || isDraggingLayer || isDraggingSplit || scalingHandle) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingPan, isDraggingLayer, isDraggingSplit, scalingHandle, handleMouseMove, handleMouseUp]);

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

  // Calculate active layer bounding box
  const activeW = activeLayer?.previewDims?.width || dims.width;
  const activeH = activeLayer?.previewDims?.height || dims.height;
  const activeT = activeLayer?.transform || { x: 0, y: 0, scale: 1.0, rotation: 0 };

  const boxWidth = activeW * (activeT.scale ?? 1.0);
  const boxHeight = activeH * (activeT.scale ?? 1.0);
  const boxLeft = dims.width / 2 - boxWidth / 2 + activeT.x;
  const boxTop = dims.height / 2 - boxHeight / 2 + activeT.y;

  const isMoveActive = canvasTool === 'move' && !isSpaceHeld;

  return (
    <div
      ref={containerRef}
      className={`${styles.canvasContainer} ${isMoveActive ? styles.canvasContainerMove : styles.canvasContainerPan}`}
      onWheel={handleWheel}
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

        {/* Active Layer Bounding Box HUD (when Move Tool is active) */}
        {isMoveActive && activeLayer && (
          <div
            className={styles.layerBoundingBox}
            style={{
              left: `${boxLeft}px`,
              top: `${boxTop}px`,
              width: `${boxWidth}px`,
              height: `${boxHeight}px`,
              transform: `rotate(${activeT.rotation}deg)`,
              transformOrigin: 'center center',
            }}
          >
            <div className={styles.boxLabel}>
              {activeLayer.name} ({Math.round(activeT.x)}, {Math.round(activeT.y)}) • {((activeT.scale ?? 1.0) * 100).toFixed(0)}%
            </div>
            <div
              className={`${styles.cornerHandle} ${styles.handleTL}`}
              onMouseDown={(e) => handleStartCornerScale(e, 'tl')}
              title="Drag corner to scale layer"
            />
            <div
              className={`${styles.cornerHandle} ${styles.handleTR}`}
              onMouseDown={(e) => handleStartCornerScale(e, 'tr')}
              title="Drag corner to scale layer"
            />
            <div
              className={`${styles.cornerHandle} ${styles.handleBL}`}
              onMouseDown={(e) => handleStartCornerScale(e, 'bl')}
              title="Drag corner to scale layer"
            />
            <div
              className={`${styles.cornerHandle} ${styles.handleBR}`}
              onMouseDown={(e) => handleStartCornerScale(e, 'br')}
              title="Drag corner to scale layer"
            />
          </div>
        )}

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
            {substrateMask === 'rounded-rect' && (
              <rect
                x="4"
                y="4"
                width={dims.width - 8}
                height={dims.height - 8}
                rx={Math.round((substrateCornerRadius / 25.4) * (metadata?.dpi || 300))}
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
