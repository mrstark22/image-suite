/**
 * Image Suite — Bézier Pen Tool (P)
 * Direct vector drawing with interactive points, live rubber-band preview, and path closing.
 */

import type { CanvasTool } from '../core/tool-system';
import type { Point2D } from '../core/hit-testing';
import { createVectorNode } from '../core/scene-graph';

interface PenPoint {
  x: number;
  y: number;
}

const activePoints: PenPoint[] = [];
let hoverCurrentPt: Point2D | null = null;

function pointsToSvgPath(points: PenPoint[], isClosed: boolean): string {
  if (points.length === 0) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  if (isClosed) d += ' Z';
  return d;
}

export const penTool: CanvasTool = {
  id: 'pen',
  name: 'Bézier Pen Tool',
  shortcut: 'P',
  cursor: 'crosshair',

  onPointerDown: (ctx, _e, worldPt) => {
    const { scene } = ctx;

    // Check if clicking close to the starting point to close the path
    if (activePoints.length >= 2) {
      const first = activePoints[0];
      const dist = Math.hypot(worldPt.x - first.x, worldPt.y - first.y);
      if (dist <= 12 / ctx.viewport.zoom) {
        // Close path and commit
        const svgPath = pointsToSvgPath(activePoints, true);
        const bounds = computePathBounds(activePoints);

        // Normalize points relative to node center
        const node = createVectorNode('Vector Path', svgPath, bounds.width, bounds.height, '#38bdf8', 2.0);
        node.transform.x = bounds.cx;
        node.transform.y = bounds.cy;

        scene.addNode(node);
        activePoints.length = 0;
        hoverCurrentPt = null;
        return;
      }
    }

    activePoints.push({ x: worldPt.x, y: worldPt.y });
  },

  onPointerMove: (_ctx, _e, worldPt) => {
    hoverCurrentPt = worldPt;
  },

  onPointerUp: () => {},

  onKeyDown: (ctx, e) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      if (activePoints.length >= 2) {
        const svgPath = pointsToSvgPath(activePoints, false);
        const bounds = computePathBounds(activePoints);

        const node = createVectorNode('Vector Path', svgPath, bounds.width, bounds.height, '#38bdf8', 2.0);
        node.transform.x = bounds.cx;
        node.transform.y = bounds.cy;

        ctx.scene.addNode(node);
      }
      activePoints.length = 0;
      hoverCurrentPt = null;
    }
  },

  renderOverlay: (ctx, toolCtx) => {
    if (activePoints.length === 0) return;

    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(activePoints[0].x, activePoints[0].y);
    for (let i = 1; i < activePoints.length; i++) {
      ctx.lineTo(activePoints[i].x, activePoints[i].y);
    }
    if (hoverCurrentPt) {
      ctx.lineTo(hoverCurrentPt.x, hoverCurrentPt.y);
    }
    ctx.stroke();

    // Draw Anchor Point Nodes
    const handleR = 4 / toolCtx.viewport.zoom;
    for (let i = 0; i < activePoints.length; i++) {
      const p = activePoints[i];
      ctx.fillStyle = i === 0 ? '#10b981' : '#ffffff';
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, handleR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  },

  deactivate: () => {
    activePoints.length = 0;
    hoverCurrentPt = null;
  },
};

function computePathBounds(points: PenPoint[]): { width: number; height: number; cx: number; cy: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const width = Math.max(10, maxX - minX);
  const height = Math.max(10, maxY - minY);
  const cx = minX + width / 2;
  const cy = minY + height / 2;

  return { width, height, cx, cy };
}
