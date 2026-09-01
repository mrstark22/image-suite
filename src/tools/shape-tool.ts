/**
 * Image Suite — Interactive Shape Tool (U)
 * Drag-to-create parametric rectangles, ellipses, stars, and polygons with Shift/Alt modifiers.
 */

import type { CanvasTool } from '../core/tool-system';
import type { Point2D } from '../core/hit-testing';
import { createShapeNode, type ShapeKind } from '../core/scene-graph';

interface ShapeDragState {
  isDragging: boolean;
  startWorldPt: Point2D;
  currentWorldPt: Point2D;
  shapeKind: ShapeKind;
}

const state: ShapeDragState = {
  isDragging: false,
  startWorldPt: { x: 0, y: 0 },
  currentWorldPt: { x: 0, y: 0 },
  shapeKind: 'rectangle',
};

export const shapeTool: CanvasTool = {
  id: 'shape',
  name: 'Parametric Shape Tool',
  shortcut: 'U',
  cursor: 'crosshair',

  onPointerDown: (_ctx, _e, worldPt) => {
    state.isDragging = true;
    state.startWorldPt = worldPt;
    state.currentWorldPt = worldPt;
  },

  onPointerMove: (_ctx, _e, worldPt) => {
    if (state.isDragging) {
      state.currentWorldPt = worldPt;
    }
  },

  onPointerUp: (ctx, e, worldPt) => {
    if (!state.isDragging) return;
    state.isDragging = false;

    let dx = worldPt.x - state.startWorldPt.x;
    let dy = worldPt.y - state.startWorldPt.y;

    if (e.shiftKey) {
      const maxDim = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * maxDim;
      dy = Math.sign(dy || 1) * maxDim;
    }

    const width = Math.max(10, Math.abs(dx));
    const height = Math.max(10, Math.abs(dy));

    let cx = state.startWorldPt.x + dx / 2;
    let cy = state.startWorldPt.y + dy / 2;

    if (e.altKey) {
      cx = state.startWorldPt.x;
      cy = state.startWorldPt.y;
    }

    const node = createShapeNode(state.shapeKind, width, height, '#38bdf8');
    node.transform.x = cx;
    node.transform.y = cy;

    ctx.scene.addNode(node);
    ctx.scene.setActiveTool('move');
  },

  renderOverlay: (ctx, _toolCtx) => {
    if (!state.isDragging) return;

    let dx = state.currentWorldPt.x - state.startWorldPt.x;
    let dy = state.currentWorldPt.y - state.startWorldPt.y;

    const width = Math.max(2, Math.abs(dx));
    const height = Math.max(2, Math.abs(dy));
    const x = Math.min(state.startWorldPt.x, state.currentWorldPt.x);
    const y = Math.min(state.startWorldPt.y, state.currentWorldPt.y);

    ctx.save();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);

    if (state.shapeKind === 'rectangle') {
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
    } else if (state.shapeKind === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  },
};
