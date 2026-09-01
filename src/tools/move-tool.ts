/**
 * Image Suite — Move & Transform Tool (V)
 * Interactive selection, 8-point resize gizmo, rotation handle, translation, and marquee box-selection.
 */

import type { CanvasTool } from '../core/tool-system';
import {
  type Point2D,
  type Rect2D,
  getNodeWorldAABB,
  findNodesInMarquee,
} from '../core/hit-testing';
import type { SceneNode } from '../core/scene-graph';

type HandleType = 'tl' | 't' | 'tr' | 'r' | 'br' | 'b' | 'bl' | 'l' | 'rot' | null;

interface DragState {
  mode: 'none' | 'translate' | 'resize' | 'rotate' | 'marquee';
  startWorldPt: Point2D;
  startNodePositions: Map<string, { x: number; y: number }>;
  startNodeTransforms: Map<string, { width: number; height: number; scaleX: number; scaleY: number; rotation: number }>;
  activeHandle: HandleType;
  marqueeRect: Rect2D | null;
}

const dragState: DragState = {
  mode: 'none',
  startWorldPt: { x: 0, y: 0 },
  startNodePositions: new Map(),
  startNodeTransforms: new Map(),
  activeHandle: null,
  marqueeRect: null,
};

function hitTestGizmoHandles(worldPt: Point2D, node: SceneNode, zoom: number): HandleType {
  const aabb = getNodeWorldAABB(node.transform);
  const handleRadius = Math.max(6, 10 / zoom);

  // Check rotation handle
  const rotY = aabb.y - 20 / zoom;
  const rotX = aabb.x + aabb.width / 2;
  const rotDist = Math.hypot(worldPt.x - rotX, worldPt.y - rotY);
  if (rotDist <= handleRadius * 1.5) return 'rot';

  const check = (x: number, y: number): boolean => {
    return Math.abs(worldPt.x - x) <= handleRadius && Math.abs(worldPt.y - y) <= handleRadius;
  };

  if (check(aabb.x, aabb.y)) return 'tl';
  if (check(aabb.x + aabb.width / 2, aabb.y)) return 't';
  if (check(aabb.x + aabb.width, aabb.y)) return 'tr';
  if (check(aabb.x + aabb.width, aabb.y + aabb.height / 2)) return 'r';
  if (check(aabb.x + aabb.width, aabb.y + aabb.height)) return 'br';
  if (check(aabb.x + aabb.width / 2, aabb.y + aabb.height)) return 'b';
  if (check(aabb.x, aabb.y + aabb.height)) return 'bl';
  if (check(aabb.x, aabb.y + aabb.height / 2)) return 'l';

  return null;
}

export const moveTool: CanvasTool = {
  id: 'move',
  name: 'Move & Select Tool',
  shortcut: 'V',
  cursor: 'default',

  onPointerDown: (ctx, e, worldPt) => {
    const { scene, viewport } = ctx;
    const selectedNodes = scene.getSelectedNodes();
    const primarySelected = selectedNodes[0];

    // 1. Check if clicking on active selection handles
    if (primarySelected) {
      const handle = hitTestGizmoHandles(worldPt, primarySelected, viewport.zoom);
      if (handle) {
        dragState.mode = handle === 'rot' ? 'rotate' : 'resize';
        dragState.activeHandle = handle;
        dragState.startWorldPt = worldPt;

        dragState.startNodeTransforms.clear();
        selectedNodes.forEach((n) => {
          dragState.startNodeTransforms.set(n.id, {
            width: n.transform.width,
            height: n.transform.height,
            scaleX: n.transform.scaleX,
            scaleY: n.transform.scaleY,
            rotation: n.transform.rotation,
          });
        });
        return;
      }
    }

    // 2. Hit test nodes
    const hitNode = ctx.hitTest(worldPt);

    if (hitNode) {
      const isAlreadySelected = scene.selectedIds.includes(hitNode.id);
      if (e.shiftKey) {
        scene.selectNode(hitNode.id, true);
      } else if (!isAlreadySelected) {
        scene.selectNode(hitNode.id, false);
      }

      dragState.mode = 'translate';
      dragState.startWorldPt = worldPt;
      dragState.startNodePositions.clear();

      scene.getSelectedNodes().forEach((n) => {
        dragState.startNodePositions.set(n.id, { x: n.transform.x, y: n.transform.y });
      });
    } else {
      // Clicked on empty space -> start marquee box selection
      if (!e.shiftKey) {
        scene.clearSelection();
      }
      dragState.mode = 'marquee';
      dragState.startWorldPt = worldPt;
      dragState.marqueeRect = { x: worldPt.x, y: worldPt.y, width: 0, height: 0 };
    }
  },

  onPointerMove: (ctx, _e, worldPt) => {
    const { scene, viewport } = ctx;
    const dx = worldPt.x - dragState.startWorldPt.x;
    const dy = worldPt.y - dragState.startWorldPt.y;

    if (dragState.mode === 'translate') {
      ctx.setCursor('move');
      dragState.startNodePositions.forEach((initPos, id) => {
        scene.updateNodeTransform(id, {
          x: initPos.x + dx,
          y: initPos.y + dy,
        });
      });
    } else if (dragState.mode === 'resize') {
      const primary = scene.getSelectedNodes()[0];
      if (!primary) return;
      const initial = dragState.startNodeTransforms.get(primary.id);
      if (!initial) return;

      let scaleFactor = 1.0;
      if (dragState.activeHandle === 'br' || dragState.activeHandle === 'tl') {
        const diag = (dx + dy) / 2;
        scaleFactor = Math.max(0.1, 1 + diag / Math.max(initial.width, initial.height));
      } else if (dragState.activeHandle === 'tr' || dragState.activeHandle === 'bl') {
        const diag = (dx - dy) / 2;
        scaleFactor = Math.max(0.1, 1 + diag / Math.max(initial.width, initial.height));
      } else if (dragState.activeHandle === 'r' || dragState.activeHandle === 'l') {
        scaleFactor = Math.max(0.1, 1 + dx / initial.width);
      } else if (dragState.activeHandle === 'b' || dragState.activeHandle === 't') {
        scaleFactor = Math.max(0.1, 1 + dy / initial.height);
      }

      scene.updateNodeTransform(primary.id, {
        scaleX: Number((initial.scaleX * scaleFactor).toFixed(3)),
        scaleY: Number((initial.scaleY * scaleFactor).toFixed(3)),
      });
    } else if (dragState.mode === 'rotate') {
      const primary = scene.getSelectedNodes()[0];
      if (!primary) return;
      const initial = dragState.startNodeTransforms.get(primary.id);
      if (!initial) return;

      const angleRad = Math.atan2(worldPt.y - primary.transform.y, worldPt.x - primary.transform.x);
      const angleDeg = (angleRad * 180) / Math.PI + 90;

      scene.updateNodeTransform(primary.id, {
        rotation: Math.round(angleDeg),
      });
    } else if (dragState.mode === 'marquee') {
      const minX = Math.min(dragState.startWorldPt.x, worldPt.x);
      const minY = Math.min(dragState.startWorldPt.y, worldPt.y);
      const width = Math.abs(dx);
      const height = Math.abs(dy);

      dragState.marqueeRect = { x: minX, y: minY, width, height };

      const foundIds = findNodesInMarquee(dragState.marqueeRect, scene.rootOrder, scene.nodes);
      scene.setSelectedIds(foundIds);
    } else {
      // Hover cursor management
      const primary = scene.getSelectedNodes()[0];
      if (primary) {
        const handle = hitTestGizmoHandles(worldPt, primary, viewport.zoom);
        if (handle === 'rot') {
          ctx.setCursor('grab');
          return;
        } else if (handle === 'tl' || handle === 'br') {
          ctx.setCursor('nwse-resize');
          return;
        } else if (handle === 'tr' || handle === 'bl') {
          ctx.setCursor('nesw-resize');
          return;
        } else if (handle === 'r' || handle === 'l') {
          ctx.setCursor('ew-resize');
          return;
        } else if (handle === 't' || handle === 'b') {
          ctx.setCursor('ns-resize');
          return;
        }
      }

      const hit = ctx.hitTest(worldPt);
      ctx.setCursor(hit ? 'move' : 'default');
    }
  },

  onPointerUp: (ctx) => {
    dragState.mode = 'none';
    dragState.activeHandle = null;
    dragState.marqueeRect = null;
    ctx.setCursor('default');
  },

  renderOverlay: (ctx, _toolCtx) => {
    // Render Marquee Selection Box
    if (dragState.mode === 'marquee' && dragState.marqueeRect) {
      const { x, y, width, height } = dragState.marqueeRect;
      ctx.save();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.fillRect(x, y, width, height);
      ctx.strokeRect(x, y, width, height);
      ctx.restore();
    }
  },
};
