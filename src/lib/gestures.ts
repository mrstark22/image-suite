import { clampZoom, type Point, type View } from './viewport';

/**
 * Pointer gestures on the canvas and the 3D view (#54). Mouse, pen and touch
 * all arrive as pointer events, so one set of rules serves them all: one
 * pointer drags, two pointers pinch.
 */

/** Two pointers, in the order they went down. */
export type PointerPair = readonly [Point, Point];

export function midpoint([a, b]: PointerPair): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function spread([a, b]: PointerPair): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * The 2D view after two pointers move from `start` to `now`, beginning from
 * `view`. The zoom scales by the change in the distance between them, and the
 * image point that was under their midpoint stays under the midpoint as it
 * moves, so the fingers pinch and pan in one gesture. Points are measured
 * from the container's centre, as in `zoomAbout`.
 */
export function pinchView(view: View, start: PointerPair, now: PointerPair): View {
  const before = spread(start);
  const factor = before > 0 ? spread(now) / before : 1;
  const zoom = clampZoom(view.zoom * factor);
  const k = zoom / view.zoom;
  const m0 = midpoint(start);
  const m1 = midpoint(now);
  return {
    zoom,
    pan: {
      x: m1.x - (m0.x - view.pan.x) * k,
      y: m1.y - (m0.y - view.pan.y) * k,
    },
  };
}

/**
 * The pointers that are down on an element, by pointer id, in the order they
 * went down. A pointer that goes up or is cancelled is forgotten.
 */
export class ActivePointers {
  private readonly points = new Map<number, Point>();

  get size(): number {
    return this.points.size;
  }

  down(id: number, at: Point): void {
    this.points.set(id, at);
  }

  /** Records a move; false if the pointer is not one that went down here. */
  move(id: number, at: Point): boolean {
    if (!this.points.has(id)) return false;
    this.points.set(id, at);
    return true;
  }

  up(id: number): void {
    this.points.delete(id);
  }

  has(id: number): boolean {
    return this.points.has(id);
  }

  /** The first pointer still down, or null. */
  first(): { id: number; at: Point } | null {
    for (const [id, at] of this.points) return { id, at };
    return null;
  }

  /** The first two pointers still down, or null if fewer than two are. */
  pair(): PointerPair | null {
    const [a, b] = [...this.points.values()];
    return a && b ? [a, b] : null;
  }

  clear(): void {
    this.points.clear();
  }
}
