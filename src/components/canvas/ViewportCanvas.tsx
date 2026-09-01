/**
 * Image Suite — Next-Gen Interactive Viewport Canvas
 * Mounts full Scene Graph 2D renderer, multi-object transform gizmos, SVG vector overlay,
 * substrate mask guide, drag-and-drop file upload, and CAM machine toolpath simulator.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useSceneStore } from '../../core/scene-store';
import { useImageStore } from '../../store/imageStore';
import { useLayerStore } from '../../store/layerStore';
import { useEditStore } from '../../store/editStore';
import { useUIStore } from '../../store/uiStore';
import { useCAMStore } from '../../core/cam-store';
import { renderSceneGraph, renderToolpathsOnCanvas } from '../../core/canvas-renderer';
import { hitTestSceneGraph } from '../../core/hit-testing';
import {
  screenToWorldCoords,
  worldToScreenCoords,
  type ViewportContext,
  type ToolContext,
} from '../../core/tool-system';
import { getCanvasTool } from '../../tools';
import { DropZone } from '../shared/DropZone';
import { DepthViewer3D } from './DepthViewer3D';
import { CanvasRulers } from './CanvasRulers';
import { CanvasCropOverlay } from './CanvasCropOverlay';
import styles from './ViewportCanvas.module.css';

export const ViewportCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const hasAutoFittedRef = useRef(false);

  // Scene Graph Store
  const documentWidth = useSceneStore((s) => s.documentWidth);
  const documentHeight = useSceneStore((s) => s.documentHeight);
  const dpi = useSceneStore((s) => s.dpi);
  const rootOrder = useSceneStore((s) => s.rootOrder);
  const nodes = useSceneStore((s) => s.nodes);
  const selectedIds = useSceneStore((s) => s.selectedIds);
  const hoveredId = useSceneStore((s) => s.hoveredId);
  const activeTool = useSceneStore((s) => s.activeTool);
  const revision = useSceneStore((s) => s.revision);
  const addNode = useSceneStore((s) => s.addNode);
  const setDocumentSize = useSceneStore((s) => s.setDocumentSize);

  // Viewport / Interaction State from imageStore
  const zoom = useImageStore((s) => s.zoom);
  const pan = useImageStore((s) => s.pan);
  const setZoom = useImageStore((s) => s.setZoom);
  const fitToViewport = useImageStore((s) => s.fitToViewport);
  const previewBuffer = useImageStore((s) => s.previewBuffer);
  const previewProcessedBuffer = useImageStore((s) => s.previewProcessedBuffer);
  const depthHeightMapBuffer = useImageStore((s) => s.depthHeightMapBuffer);
  const previewDims = useImageStore((s) => s.previewDimensions);
  const metadata = useImageStore((s) => s.metadata);
  const substrateMask = useImageStore((s) => s.substrateMask);
  const importImageFiles = useLayerStore((s) => s.importImageFiles);

  // UI & Edit Store (Vector Tracing & Substrates)
  const vectorResult = useEditStore((s) => s.vectorResult);
  const showVectorOverlay = useUIStore((s) => s.showVectorOverlay);
  const isSplitView = useUIStore((s) => s.isSplitView);
  const isInvertedBurn = useUIStore((s) => s.isInvertedBurn);
  const isDepthActive = useUIStore((s) => s.activeTab === 'depth');

  // CAM Toolpaths & Simulation State
  const activeSimulation = useCAMStore((s) => s.activeSimulation);
  const showToolpaths = useCAMStore((s) => s.showToolpaths);
  const simulationProgress = useCAMStore((s) => s.simulationProgress);

  // Auto-fit to viewport on first image load
  useEffect(() => {
    if (previewDims && containerRef.current && !hasAutoFittedRef.current) {
      hasAutoFittedRef.current = true;
      const rect = containerRef.current.getBoundingClientRect();
      fitToViewport(rect.width, rect.height);
    }
  }, [previewDims, fitToViewport]);

  // Auto-sync loaded image into Scene Graph
  const lastSyncedBufferRef = useRef<ArrayBuffer | null>(null);

  useEffect(() => {
    if (previewBuffer && previewDims) {
      if (previewBuffer !== lastSyncedBufferRef.current) {
        lastSyncedBufferRef.current = previewBuffer;
        if (nodes.size === 0) {
          setDocumentSize(previewDims.width, previewDims.height, metadata?.dpi || 300);

          // Create initial raster node
          const rasterId = `raster-base-${Date.now()}`;
          addNode({
            id: rasterId,
            type: 'raster',
            name: metadata?.name || 'Base Layer',
            parent: null,
            children: [],
            visible: true,
            locked: false,
            transform: {
              x: previewDims.width / 2,
              y: previewDims.height / 2,
              width: previewDims.width,
              height: previewDims.height,
              scaleX: 1.0,
              scaleY: 1.0,
              rotation: 0,
              anchorX: 0.5,
              anchorY: 0.5,
            },
            opacity: 1.0,
            blendMode: 'source-over',
            fill: null,
            stroke: null,
            rasterData: {
              buffer: previewProcessedBuffer || previewBuffer,
              originalBuffer: previewBuffer.slice(0),
              dpi: metadata?.dpi || 300,
              hasAlpha: true,
            },
          });
        }
      }
    } else if (!previewBuffer) {
      lastSyncedBufferRef.current = null;
    }
  }, [previewBuffer, previewProcessedBuffer, previewDims, metadata, nodes.size, setDocumentSize, addNode]);

  // Build Viewport & Tool Contexts
  const getViewportContext = useCallback((): ViewportContext => {
    const container = containerRef.current;
    const rect = container?.getBoundingClientRect() || { width: 1000, height: 800 };
    return {
      zoom,
      pan,
      containerWidth: rect.width,
      containerHeight: rect.height,
      documentWidth,
      documentHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    };
  }, [zoom, pan, documentWidth, documentHeight]);

  const getToolContext = useCallback((): ToolContext => {
    const viewport = getViewportContext();
    const scene = useSceneStore.getState();

    return {
      scene,
      viewport,
      screenToWorld: (clientX, clientY, containerRect) =>
        screenToWorldCoords(clientX, clientY, containerRect, viewport),
      worldToScreen: (worldX, worldY, containerRect) =>
        worldToScreenCoords(worldX, worldY, containerRect, viewport),
      hitTest: (worldPt) =>
        hitTestSceneGraph(worldPt, scene.rootOrder, scene.nodes),
      setCursor: (cursor) => {
        if (containerRef.current) {
          containerRef.current.style.cursor = cursor;
        }
      },
    };
  }, [getViewportContext]);

  // Main Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas dimensions to document size
    canvas.width = documentWidth;
    canvas.height = documentHeight;

    // Render Scene Graph
    renderSceneGraph(ctx, documentWidth, documentHeight, rootOrder, nodes, {
      showSelectionGizmos: true,
      selectedNodeIds: selectedIds,
      hoveredNodeId: hoveredId,
      activeProcessedBuffer: previewProcessedBuffer || previewBuffer,
    });

    // Render CAM Toolpath Simulation Overlay
    if (showToolpaths && activeSimulation) {
      renderToolpathsOnCanvas(ctx, activeSimulation, dpi, simulationProgress);
    }

    // Render Active Tool Overlay
    const tool = getCanvasTool(activeTool);
    if (tool.renderOverlay) {
      tool.renderOverlay(ctx, getToolContext());
    }
  }, [
    documentWidth,
    documentHeight,
    dpi,
    rootOrder,
    nodes,
    selectedIds,
    hoveredId,
    activeTool,
    revision,
    previewProcessedBuffer,
    previewBuffer,
    showToolpaths,
    activeSimulation,
    simulationProgress,
    getToolContext,
  ]);

  // Pointer Event Handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const toolCtx = getToolContext();
    const worldPt = toolCtx.screenToWorld(e.clientX, e.clientY, rect);

    const tool = getCanvasTool(activeTool);
    tool.onPointerDown(toolCtx, e, worldPt);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const toolCtx = getToolContext();
    const worldPt = toolCtx.screenToWorld(e.clientX, e.clientY, rect);

    const tool = getCanvasTool(activeTool);
    tool.onPointerMove(toolCtx, e, worldPt);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const toolCtx = getToolContext();
    const worldPt = toolCtx.screenToWorld(e.clientX, e.clientY, rect);

    const tool = getCanvasTool(activeTool);
    tool.onPointerUp(toolCtx, e, worldPt);
  };

  // Wheel Zoom toward mouse pointer
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoom((prev) => Math.min(Math.max(prev * zoomFactor, 0.05), 32.0));
  };

  // Drag and drop image files onto canvas
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      importImageFiles(Array.from(e.dataTransfer.files));
    }
  };

  // If no image is loaded yet, show the DropZone
  if (!previewBuffer || !previewDims) {
    return (
      <div className={styles.canvasContainer}>
        <DropZone />
      </div>
    );
  }

  if (isDepthActive) {
    return (
      <DepthViewer3D
        depthBuffer={depthHeightMapBuffer || previewProcessedBuffer || previewBuffer || new ArrayBuffer(0)}
        width={previewDims?.width || documentWidth}
        height={previewDims?.height || documentHeight}
      />
    );
  }

  const dims = previewDims || { width: documentWidth, height: documentHeight };

  return (
    <div
      ref={containerRef}
      className={styles.canvasContainer}
      onWheel={handleWheel}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        outline: isDragOver ? '2px dashed var(--accent-primary, #38bdf8)' : 'none',
        outlineOffset: '-4px',
      }}
    >
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
          width: `${documentWidth}px`,
          height: `${documentHeight}px`,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
          filter: isInvertedBurn ? 'invert(1) hue-rotate(180deg)' : 'none',
          transition: 'none',
        }}
      >
        <canvas
          ref={canvasRef}
          className={styles.mainCanvas}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onContextMenu={(e) => e.preventDefault()}
        />

        {/* Vector SVG Overlay (Traced vector paths, cutlines, centerline) */}
        {showVectorOverlay && vectorResult && (
          <svg
            viewBox={`0 0 ${dims.width} ${dims.height}`}
            className={styles.svgOverlay}
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
            viewBox={`0 0 ${dims.width} ${dims.height}`}
            className={styles.svgOverlay}
            style={{ zIndex: 25 }}
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
                x={8}
                y={8}
                width={dims.width - 16}
                height={dims.height - 16}
                rx={24}
                ry={24}
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
                rx={dims.width / 2 - 8}
                ry={dims.height / 2 - 8}
                stroke="var(--accent-primary, #38bdf8)"
                strokeWidth="2"
                strokeDasharray="6 4"
                fill="none"
              />
            )}
          </svg>
        )}
      </div>

      <CanvasCropOverlay />

      <div className={styles.hudStatus}>
        <span>Doc: <strong>{documentWidth}×{documentHeight}px</strong></span>
        <span>DPI: <strong>{dpi}</strong></span>
        <span>Zoom: <strong>{(zoom * 100).toFixed(0)}%</strong></span>
        <span>Selected: <strong>{selectedIds.length}</strong></span>
      </div>
    </div>
  );
};
