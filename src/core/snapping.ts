/**
 * Image Suite — Precision Snapping & Smart Alignment Guides Engine
 * Computes magnetic snapping to canvas grid, document centers, object bounding boxes, and node anchor points.
 */

import type { Point2D, Rect2D } from './hit-testing';
import type { SceneNode } from './scene-graph';
import { getNodeWorldAABB } from './hit-testing';

export interface SnapGuide {
  type: 'vertical' | 'horizontal';
  position: number; // World coord X or Y
  start: number;    // World coord line start
  end: number;      // World coord line end
  label?: string;
}

export interface SnapConfig {
  enabled: boolean;
  thresholdPx: number;      // Magnetic snap distance (default 8px)
  snapToGrid: boolean;
  gridSize: number;         // in px (e.g. 20)
  snapToDocumentCenter: boolean;
  snapToObjects: boolean;
}

export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  enabled: true,
  thresholdPx: 8,
  snapToGrid: false,
  gridSize: 20,
  snapToDocumentCenter: true,
  snapToObjects: true,
};

export interface SnapResult {
  snappedPoint: Point2D;
  guides: SnapGuide[];
  didSnapX: boolean;
  didSnapY: boolean;
}

/**
 * Snaps a world point to document bounds, center lines, active grid, and other objects' AABBs.
 */
export function computeSnap(
  queryPt: Point2D,
  excludeNodeIds: string[],
  nodes: Map<string, SceneNode>,
  rootOrder: string[],
  docWidth: number,
  docHeight: number,
  zoom: number,
  config: SnapConfig = DEFAULT_SNAP_CONFIG
): SnapResult {
  if (!config.enabled) {
    return { snappedPoint: queryPt, guides: [], didSnapX: false, didSnapY: false };
  }

  const threshold = config.thresholdPx / zoom;
  let snappedX = queryPt.x;
  let snappedY = queryPt.y;
  let bestDistX = threshold;
  let bestDistY = threshold;
  let didSnapX = false;
  let didSnapY = false;
  const guides: SnapGuide[] = [];

  // 1. Snap to Grid
  if (config.snapToGrid && config.gridSize > 0) {
    const gridX = Math.round(queryPt.x / config.gridSize) * config.gridSize;
    const gridY = Math.round(queryPt.y / config.gridSize) * config.gridSize;

    if (Math.abs(queryPt.x - gridX) < bestDistX) {
      snappedX = gridX;
      bestDistX = Math.abs(queryPt.x - gridX);
      didSnapX = true;
    }
    if (Math.abs(queryPt.y - gridY) < bestDistY) {
      snappedY = gridY;
      bestDistY = Math.abs(queryPt.y - gridY);
      didSnapY = true;
    }
  }

  // 2. Snap to Document Center & Edges
  if (config.snapToDocumentCenter) {
    const docXTargets = [0, docWidth / 2, docWidth];
    const docYTargets = [0, docHeight / 2, docHeight];

    for (const targetX of docXTargets) {
      const dist = Math.abs(queryPt.x - targetX);
      if (dist < bestDistX) {
        bestDistX = dist;
        snappedX = targetX;
        didSnapX = true;
        guides.push({
          type: 'vertical',
          position: targetX,
          start: 0,
          end: docHeight,
          label: targetX === docWidth / 2 ? 'Center' : 'Doc Edge',
        });
      }
    }

    for (const targetY of docYTargets) {
      const dist = Math.abs(queryPt.y - targetY);
      if (dist < bestDistY) {
        bestDistY = dist;
        snappedY = targetY;
        didSnapY = true;
        guides.push({
          type: 'horizontal',
          position: targetY,
          start: 0,
          end: docWidth,
          label: targetY === docHeight / 2 ? 'Center' : 'Doc Edge',
        });
      }
    }
  }

  // 3. Snap to Other Objects' Bounding Boxes & Centers
  if (config.snapToObjects) {
    for (const id of rootOrder) {
      if (excludeNodeIds.includes(id)) continue;
      const other = nodes.get(id);
      if (!other || !other.visible) continue;

      const aabb: Rect2D = getNodeWorldAABB(other.transform);
      const otherXTargets = [aabb.x, aabb.x + aabb.width / 2, aabb.x + aabb.width];
      const otherYTargets = [aabb.y, aabb.y + aabb.height / 2, aabb.y + aabb.height];

      for (const targetX of otherXTargets) {
        const dist = Math.abs(queryPt.x - targetX);
        if (dist < bestDistX) {
          bestDistX = dist;
          snappedX = targetX;
          didSnapX = true;
          guides.push({
            type: 'vertical',
            position: targetX,
            start: Math.min(queryPt.y, aabb.y) - 20,
            end: Math.max(queryPt.y, aabb.y + aabb.height) + 20,
          });
        }
      }

      for (const targetY of otherYTargets) {
        const dist = Math.abs(queryPt.y - targetY);
        if (dist < bestDistY) {
          bestDistY = dist;
          snappedY = targetY;
          didSnapY = true;
          guides.push({
            type: 'horizontal',
            position: targetY,
            start: Math.min(queryPt.x, aabb.x) - 20,
            end: Math.max(queryPt.x, aabb.x + aabb.width) + 20,
          });
        }
      }
    }
  }

  return {
    snappedPoint: { x: snappedX, y: snappedY },
    guides,
    didSnapX,
    didSnapY,
  };
}

/**
 * Renders visual smart guide lines on the canvas overlay
 */
export function renderSnapGuides(
  ctx: CanvasRenderingContext2D,
  guides: SnapGuide[],
  zoom: number
): void {
  if (guides.length === 0) return;

  ctx.save();
  ctx.strokeStyle = '#f43f5e'; // Vibrant Rose Red for magnetic guides
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([4 / zoom, 2 / zoom]);

  for (const g of guides) {
    ctx.beginPath();
    if (g.type === 'vertical') {
      ctx.moveTo(g.position, g.start);
      ctx.lineTo(g.position, g.end);
    } else {
      ctx.moveTo(g.start, g.position);
      ctx.lineTo(g.end, g.position);
    }
    ctx.stroke();
  }

  ctx.restore();
}
