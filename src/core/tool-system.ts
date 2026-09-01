/**
 * Image Suite — Pluggable Canvas Tool Subsystem
 * Defines tool interfaces, input context, coordinate conversions, and active tool manager.
 */

import type { SceneNode } from './scene-graph';
import type { SceneState } from './scene-store';
import type { Point2D } from './hit-testing';

export interface ViewportContext {
  zoom: number;
  pan: { x: number; y: number };
  containerWidth: number;
  containerHeight: number;
  documentWidth: number;
  documentHeight: number;
  devicePixelRatio: number;
}

export interface ToolContext {
  scene: SceneState;
  viewport: ViewportContext;
  screenToWorld: (clientX: number, clientY: number, containerRect: DOMRect) => Point2D;
  worldToScreen: (worldX: number, worldY: number, containerRect: DOMRect) => Point2D;
  hitTest: (worldPt: Point2D) => SceneNode | null;
  setCursor: (cursor: string) => void;
}

export interface CanvasTool {
  id: string;
  name: string;
  shortcut: string;
  cursor: string;

  onPointerDown: (ctx: ToolContext, e: React.PointerEvent<HTMLCanvasElement>, worldPt: Point2D) => void;
  onPointerMove: (ctx: ToolContext, e: React.PointerEvent<HTMLCanvasElement>, worldPt: Point2D) => void;
  onPointerUp: (ctx: ToolContext, e: React.PointerEvent<HTMLCanvasElement>, worldPt: Point2D) => void;
  onKeyDown?: (ctx: ToolContext, e: KeyboardEvent) => void;
  renderOverlay?: (ctx: CanvasRenderingContext2D, toolCtx: ToolContext) => void;

  activate?: () => void;
  deactivate?: () => void;
}

/**
 * Maps screen coordinates (clientX, clientY) within containerRect to Document World Coordinates (px)
 */
export function screenToWorldCoords(
  clientX: number,
  clientY: number,
  containerRect: DOMRect,
  viewport: ViewportContext
): Point2D {
  // Screen offset relative to container center
  const screenCenterX = containerRect.left + containerRect.width / 2;
  const screenCenterY = containerRect.top + containerRect.height / 2;

  const mouseOffsetX = clientX - screenCenterX - viewport.pan.x;
  const mouseOffsetY = clientY - screenCenterY - viewport.pan.y;

  // Un-scale by zoom and place relative to document center
  const worldCenterX = viewport.documentWidth / 2;
  const worldCenterY = viewport.documentHeight / 2;

  return {
    x: worldCenterX + mouseOffsetX / viewport.zoom,
    y: worldCenterY + mouseOffsetY / viewport.zoom,
  };
}

/**
 * Maps Document World Coordinates to Screen Coordinates (px)
 */
export function worldToScreenCoords(
  worldX: number,
  worldY: number,
  containerRect: DOMRect,
  viewport: ViewportContext
): Point2D {
  const worldCenterX = viewport.documentWidth / 2;
  const worldCenterY = viewport.documentHeight / 2;

  const offsetFromWorldCenterX = (worldX - worldCenterX) * viewport.zoom;
  const offsetFromWorldCenterY = (worldY - worldCenterY) * viewport.zoom;

  const screenCenterX = containerRect.left + containerRect.width / 2;
  const screenCenterY = containerRect.top + containerRect.height / 2;

  return {
    x: screenCenterX + viewport.pan.x + offsetFromWorldCenterX,
    y: screenCenterY + viewport.pan.y + offsetFromWorldCenterY,
  };
}
