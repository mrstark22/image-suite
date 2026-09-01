/**
 * Image Suite — Direct Selection / Node Edit Tool (A)
 * Manipulate individual vector anchor points and Bézier curve nodes.
 */

import type { CanvasTool } from '../core/tool-system';
import type { Point2D } from '../core/hit-testing';

interface NodeEditState {
  selectedAnchorIndex: number | null;
  isDraggingAnchor: boolean;
  startWorldPt: Point2D;
}

const state: NodeEditState = {
  selectedAnchorIndex: null,
  isDraggingAnchor: false,
  startWorldPt: { x: 0, y: 0 },
};

export const nodeTool: CanvasTool = {
  id: 'node',
  name: 'Direct Node Selection Tool',
  shortcut: 'A',
  cursor: 'crosshair',

  onPointerDown: (ctx, _e, worldPt) => {
    const { scene } = ctx;
    const selectedNodes = scene.getSelectedNodes();
    const vectorNode = selectedNodes.find((n) => n.type === 'vector');

    if (!vectorNode) {
      const hit = ctx.hitTest(worldPt);
      if (hit && hit.type === 'vector') {
        scene.selectNode(hit.id, false);
      }
      return;
    }

    state.isDraggingAnchor = true;
    state.startWorldPt = worldPt;
  },

  onPointerMove: (ctx, _e, _worldPt) => {
    if (state.isDraggingAnchor) {
      ctx.setCursor('pointer');
    }
  },

  onPointerUp: (ctx) => {
    state.isDraggingAnchor = false;
    ctx.setCursor('crosshair');
  },
};
