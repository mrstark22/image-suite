/**
 * Image Suite — Professional CAD/CAM Canvas 2D Scene Graph Renderer
 * Renders polymorphic SceneNodes (raster, vector, text, shape, group, CAM operations),
 * affine transformations, gradient fills, styled strokes, and interactive selection gizmos.
 */

import type {
  SceneNode,
  Transform,
  Fill,
  Stroke,
  SolidFill,
  LinearGradientFill,
  RadialGradientFill,
} from './scene-graph';
import { getNodeTransformMatrix, getNodeWorldAABB } from './hit-testing';
import { useImageStore } from '../store/imageStore';

export interface RenderOptions {
  showSelectionGizmos?: boolean;
  selectedNodeIds?: string[];
  hoveredNodeId?: string | null;
  activeProcessedBuffer?: ArrayBuffer | null;
  pixelRatio?: number;
  showRulersGuides?: boolean;
  invertedColorBurn?: boolean;
}

/**
 * Applies a SceneNode's 2D affine transformation to a CanvasRenderingContext2D
 */
export function applyNodeTransform(ctx: CanvasRenderingContext2D, transform: Transform): void {
  const m = getNodeTransformMatrix(transform);
  ctx.transform(m.a, m.b, m.c, m.d, m.tx, m.ty);
}

/**
 * Creates a canvas fill style from a polymorphic Fill definition
 */
export function createFillStyle(
  ctx: CanvasRenderingContext2D,
  fill: Fill | null,
  width: number,
  height: number
): string | CanvasGradient | null {
  if (!fill) return null;

  if (fill.type === 'solid') {
    return (fill as SolidFill).color;
  }

  if (fill.type === 'linear-gradient') {
    const lg = fill as LinearGradientFill;
    const grad = ctx.createLinearGradient(
      lg.startX * width,
      lg.startY * height,
      lg.endX * width,
      lg.endY * height
    );
    lg.stops.forEach((s) => grad.addColorStop(s.offset, s.color));
    return grad;
  }

  if (fill.type === 'radial-gradient') {
    const rg = fill as RadialGradientFill;
    const grad = ctx.createRadialGradient(
      rg.cx * width,
      rg.cy * height,
      0,
      rg.cx * width,
      rg.cy * height,
      rg.radius * Math.max(width, height)
    );
    rg.stops.forEach((s) => grad.addColorStop(s.offset, s.color));
    return grad;
  }

  return null;
}

/**
 * Applies stroke properties to canvas context
 */
export function applyStrokeStyle(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke | null
): boolean {
  if (!stroke || stroke.width <= 0) return false;

  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = stroke.lineCap || 'round';
  ctx.lineJoin = stroke.lineJoin || 'round';

  if (stroke.dashArray && stroke.dashArray.length > 0) {
    ctx.setLineDash(stroke.dashArray);
  } else {
    ctx.setLineDash([]);
  }

  return true;
}

/**
 * Renders a Raster node
 */
function renderRasterNode(
  ctx: CanvasRenderingContext2D,
  node: SceneNode,
  activeProcessedBuffer?: ArrayBuffer | null
): void {
  const data = node.rasterData;
  if (!data) return;

  const w = Math.round(node.transform.width);
  const h = Math.round(node.transform.height);
  if (w <= 0 || h <= 0) return;

  // Use active processed buffer if available, otherwise node buffer
  const buf = activeProcessedBuffer || data.buffer;

  if (buf && buf.byteLength > 0) {
    try {
      let bufW = w;
      let bufH = h;

      if (buf.byteLength !== w * h * 4) {
        const dims = useImageStore.getState().previewDimensions;
        if (dims && dims.width * dims.height * 4 === buf.byteLength) {
          bufW = dims.width;
          bufH = dims.height;
        } else {
          const totalPixels = Math.floor(buf.byteLength / 4);
          const aspect = w / h;
          bufW = Math.max(1, Math.round(Math.sqrt(totalPixels * aspect)));
          bufH = Math.max(1, Math.round(totalPixels / bufW));
        }
      }

      const actualBytes = bufW * bufH * 4;
      if (actualBytes <= buf.byteLength) {
        const imgData = new ImageData(new Uint8ClampedArray(buf, 0, actualBytes), bufW, bufH);
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = bufW;
        tempCanvas.height = bufH;
        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
          tempCtx.putImageData(imgData, 0, 0);
          ctx.drawImage(tempCanvas, 0, 0, w, h);
          return;
        }
      }
    } catch (err) {
      console.warn('Failed to paint raster buffer:', err);
    }
  }

  if (data.bitmap) {
    ctx.drawImage(data.bitmap, 0, 0, w, h);
  }
}

/**
 * Renders a Vector node with Path2D
 */
function renderVectorNode(ctx: CanvasRenderingContext2D, node: SceneNode): void {
  const data = node.vectorData;
  if (!data || !data.svgPathData) return;

  const path = new Path2D(data.svgPathData);

  const fillStyle = createFillStyle(ctx, node.fill, node.transform.width, node.transform.height);
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill(path);
  }

  if (applyStrokeStyle(ctx, node.stroke)) {
    ctx.stroke(path);
  }
}

/**
 * Renders a Text node
 */
function renderTextNode(ctx: CanvasRenderingContext2D, node: SceneNode): void {
  const data = node.textData;
  if (!data || !data.text) return;

  const style = data.fontStyle || 'normal';
  const weight = data.fontWeight || 600;
  const size = data.fontSize || 36;
  const family = data.fontFamily || 'Inter, sans-serif';

  ctx.font = `${style} ${weight} ${size}px ${family}`;
  ctx.textAlign = data.textAlign || 'center';
  ctx.textBaseline = 'middle';

  let alignX = node.transform.width / 2;
  if (data.textAlign === 'left') alignX = 0;
  if (data.textAlign === 'right') alignX = node.transform.width;

  const centerY = node.transform.height / 2;

  if (data.isStencilOutline) {
    ctx.strokeStyle = node.stroke?.color || '#38bdf8';
    ctx.lineWidth = data.stencilWidth || 2;
    ctx.strokeText(data.text, alignX, centerY);
  } else {
    const fillStyle = createFillStyle(ctx, node.fill, node.transform.width, node.transform.height) || '#ffffff';
    ctx.fillStyle = fillStyle;
    ctx.fillText(data.text, alignX, centerY);

    if (applyStrokeStyle(ctx, node.stroke)) {
      ctx.strokeText(data.text, alignX, centerY);
    }
  }
}

/**
 * Renders a Parametric Shape node (Rectangle, Ellipse, Polygon, Star, Line)
 */
function renderShapeNode(ctx: CanvasRenderingContext2D, node: SceneNode): void {
  const data = node.shapeData;
  const kind = data?.shapeKind || 'rectangle';
  const w = node.transform.width;
  const h = node.transform.height;

  ctx.beginPath();

  if (kind === 'rectangle') {
    const r = data?.cornerRadius || 0;
    if (r > 0 && typeof (ctx as any).roundRect === 'function') {
      (ctx as any).roundRect(0, 0, w, h, Math.min(r, Math.min(w, h) / 2));
    } else {
      ctx.rect(0, 0, w, h);
    }
  } else if (kind === 'ellipse') {
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (kind === 'polygon') {
    const points = data?.pointCount || 5;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2;
    const step = (Math.PI * 2) / points;

    for (let i = 0; i < points; i++) {
      const angle = i * step - Math.PI / 2;
      const px = cx + Math.cos(angle) * radius;
      const py = cy + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (kind === 'star') {
    const points = data?.pointCount || 5;
    const cx = w / 2;
    const cy = h / 2;
    const outerR = Math.min(w, h) / 2;
    const innerR = outerR * (data?.innerRadiusRatio || 0.45);
    const step = Math.PI / points;

    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = i * step - Math.PI / 2;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (kind === 'line') {
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
  }

  const fillStyle = createFillStyle(ctx, node.fill, w, h);
  if (fillStyle && kind !== 'line') {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  if (applyStrokeStyle(ctx, node.stroke)) {
    ctx.stroke();
  }
}

/**
 * Renders a single SceneNode (with transform, opacity, blendMode)
 */
export function renderSceneNode(
  ctx: CanvasRenderingContext2D,
  node: SceneNode,
  nodeMap: Map<string, SceneNode>,
  activeProcessedBuffer?: ArrayBuffer | null
): void {
  if (!node.visible) return;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, node.opacity));
  ctx.globalCompositeOperation = node.blendMode || 'source-over';

  // Apply node affine transform
  applyNodeTransform(ctx, node.transform);

  switch (node.type) {
    case 'raster':
      renderRasterNode(ctx, node, activeProcessedBuffer);
      break;
    case 'vector':
      renderVectorNode(ctx, node);
      break;
    case 'text':
      renderTextNode(ctx, node);
      break;
    case 'shape':
      renderShapeNode(ctx, node);
      break;
    case 'group':
      // Render children
      node.children.forEach((childId) => {
        const child = nodeMap.get(childId);
        if (child) renderSceneNode(ctx, child, nodeMap, activeProcessedBuffer);
      });
      break;
  }

  ctx.restore();
}

/**
 * Renders the selection gizmo / bounding box and corner handles
 */
export function renderSelectionGizmo(
  ctx: CanvasRenderingContext2D,
  node: SceneNode,
  zoom: number
): void {
  const aabb = getNodeWorldAABB(node.transform);
  const handleSize = Math.max(7, Math.min(12, 8 / zoom));

  ctx.save();

  // Draw bounding box
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = Math.max(1, 1.5 / zoom);
  ctx.setLineDash([]);
  ctx.strokeRect(aabb.x, aabb.y, aabb.width, aabb.height);

  // Corner Handles
  const handles = [
    { x: aabb.x, y: aabb.y }, // TL
    { x: aabb.x + aabb.width / 2, y: aabb.y }, // T
    { x: aabb.x + aabb.width, y: aabb.y }, // TR
    { x: aabb.x + aabb.width, y: aabb.y + aabb.height / 2 }, // R
    { x: aabb.x + aabb.width, y: aabb.y + aabb.height }, // BR
    { x: aabb.x + aabb.width / 2, y: aabb.y + aabb.height }, // B
    { x: aabb.x, y: aabb.y + aabb.height }, // BL
    { x: aabb.x, y: aabb.y + aabb.height / 2 }, // L
  ];

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = Math.max(1, 1.5 / zoom);

  for (const h of handles) {
    ctx.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
    ctx.strokeRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
  }

  // Rotation Handle & Stem
  const rotHandleY = aabb.y - 20 / zoom;
  ctx.beginPath();
  ctx.moveTo(aabb.x + aabb.width / 2, aabb.y);
  ctx.lineTo(aabb.x + aabb.width / 2, rotHandleY);
  ctx.strokeStyle = '#38bdf8';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(aabb.x + aabb.width / 2, rotHandleY, handleSize / 1.8, 0, Math.PI * 2);
  ctx.fillStyle = '#38bdf8';
  ctx.fill();
  ctx.stroke();

  // Telemetry HUD Label
  const labelText = `${node.name} (${Math.round(node.transform.x)}, ${Math.round(node.transform.y)}) • ${Math.round(aabb.width)}×${Math.round(aabb.height)}px`;
  ctx.font = `${Math.max(10, 11 / zoom)}px Inter, sans-serif`;
  const textMetrics = ctx.measureText(labelText);
  const pillW = textMetrics.width + 12 / zoom;
  const pillH = 18 / zoom;
  const pillX = aabb.x + aabb.width / 2 - pillW / 2;
  const pillY = aabb.y + aabb.height + 6 / zoom;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1 / zoom;
  if (typeof (ctx as any).roundRect === 'function') {
    (ctx as any).roundRect(pillX, pillY, pillW, pillH, 4 / zoom);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(pillX, pillY, pillW, pillH);
  }

  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, aabb.x + aabb.width / 2, pillY + pillH / 2);

  ctx.restore();
}

/**
 * Visual CAM Toolpath Overlay Renderer (Simulated machine toolpaths, rapids, and toolhead)
 */
export function renderToolpathsOnCanvas(
  ctx: CanvasRenderingContext2D,
  simulation: any,
  dpi: number = 300,
  progress: number = 1.0
): void {
  if (!simulation || !simulation.operations) return;

  const mmToPx = (mm: number) => (mm / 25.4) * dpi;

  ctx.save();

  let totalSegments = 0;
  simulation.operations.forEach((op: any) => {
    totalSegments += op.segments.length;
  });

  const maxSegmentsToDraw = Math.floor(totalSegments * Math.max(0, Math.min(1, progress)));
  let drawnSegments = 0;
  let lastToolheadPos: { x: number; y: number; z: number } | null = null;

  for (const op of simulation.operations) {
    for (const seg of op.segments) {
      if (drawnSegments > maxSegmentsToDraw) break;
      drawnSegments++;

      const fromX = mmToPx(seg.from.x);
      const fromY = mmToPx(seg.from.y);
      const toX = mmToPx(seg.to.x);
      const toY = mmToPx(seg.to.y);

      lastToolheadPos = { x: toX, y: toY, z: seg.to.z };

      if (seg.type === 'rapid') {
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.strokeStyle = 'rgba(249, 115, 22, 0.75)'; // Orange/Red Rapid Travel
        ctx.lineWidth = 1.0;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
      } else if (seg.type === 'cut') {
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.strokeStyle = op.color || '#38bdf8';
        ctx.lineWidth = 2.0;
        ctx.setLineDash([]);
        ctx.stroke();
      }
    }
  }

  // Draw simulated toolhead cursor if we have active position
  if (lastToolheadPos) {
    const { x, y, z } = lastToolheadPos;
    ctx.save();
    ctx.setLineDash([]);

    // Crosshairs
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 8, y);
    ctx.lineTo(x + 8, y);
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x, y + 8);
    ctx.stroke();

    // Pulse dot
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#f43f5e';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Toolhead Telemetry Pill
    const zLabel = z <= 0 ? `Z: ${z.toFixed(1)}mm` : `Rapid (Z+${z.toFixed(1)})`;
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(x + 8, y - 16, 80, 16);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.strokeRect(x + 8, y - 16, 80, 16);
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(zLabel, x + 12, y - 4);

    ctx.restore();
  }

  ctx.restore();
}

/**
 * Main Scene Graph Render Pass
 */
export function renderSceneGraph(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rootOrder: string[],
  nodes: Map<string, SceneNode>,
  opts: RenderOptions = {}
): void {
  // Clear canvas background
  ctx.clearRect(0, 0, width, height);

  // Render nodes bottom to top
  for (const id of rootOrder) {
    const node = nodes.get(id);
    if (node) {
      renderSceneNode(ctx, node, nodes, opts.activeProcessedBuffer);
    }
  }

  // Render selection gizmos
  if (opts.showSelectionGizmos && opts.selectedNodeIds && opts.selectedNodeIds.length > 0) {
    for (const id of opts.selectedNodeIds) {
      const node = nodes.get(id);
      if (node && node.visible && !node.locked) {
        renderSelectionGizmo(ctx, node, 1.0);
      }
    }
  }
}
