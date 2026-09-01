/**
 * Image Suite — Precision Scene Graph Hit-Testing & Transform Geometry
 * Calculates 2D affine transformations, inverse matrix mapping, point-in-bounds,
 * path proximity, and recursive scene graph hit-testing.
 */

import type { SceneNode, Transform } from './scene-graph';

export interface Point2D {
  x: number;
  y: number;
}

export interface Rect2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Matrix2D {
  a: number; // Scale X / Cos
  b: number; // Skew Y / Sin
  c: number; // Skew X / -Sin
  d: number; // Scale Y / Cos
  tx: number; // Translate X
  ty: number; // Translate Y
}

/**
 * Creates an identity 2D affine matrix
 */
export function createIdentityMatrix(): Matrix2D {
  return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
}

/**
 * Multiplies two 2D affine transformation matrices (M1 * M2)
 */
export function multiplyMatrices(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    tx: m1.a * m2.tx + m1.c * m2.ty + m1.tx,
    ty: m1.b * m2.tx + m1.d * m2.ty + m1.ty,
  };
}

/**
 * Computes the inverse of a 2D affine matrix
 */
export function invertMatrix(m: Matrix2D): Matrix2D | null {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return null; // Degenerate matrix

  const invDet = 1 / det;
  return {
    a: m.d * invDet,
    b: -m.b * invDet,
    c: -m.c * invDet,
    d: m.a * invDet,
    tx: (m.c * m.ty - m.d * m.tx) * invDet,
    ty: (m.b * m.tx - m.a * m.ty) * invDet,
  };
}

/**
 * Transforms a 2D point by an affine matrix
 */
export function transformPoint(m: Matrix2D, p: Point2D): Point2D {
  return {
    x: m.a * p.x + m.c * p.y + m.tx,
    y: m.b * p.x + m.d * p.y + m.ty,
  };
}

/**
 * Converts a SceneNode's transform parameters into a 2D affine transformation matrix
 */
export function getNodeTransformMatrix(transform: Transform): Matrix2D {
  const rad = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const sx = transform.scaleX;
  const sy = transform.scaleY;

  // Local anchor offset
  const ax = transform.width * transform.anchorX;
  const ay = transform.height * transform.anchorY;

  // Matrix: Translate(x, y) * Rotate(rot) * Scale(sx, sy) * Translate(-ax, -ay)
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;

  const tx = transform.x - (a * ax + c * ay);
  const ty = transform.y - (b * ax + d * ay);

  return { a, b, c, d, tx, ty };
}

/**
 * Maps a point from Canvas/World space to Node Local Coordinates (0 to width, 0 to height)
 */
export function worldToLocalPoint(point: Point2D, transform: Transform): Point2D | null {
  const matrix = getNodeTransformMatrix(transform);
  const invMatrix = invertMatrix(matrix);
  if (!invMatrix) return null;
  return transformPoint(invMatrix, point);
}

/**
 * Checks if a point in Node Local coordinates is within the node's rectangular bounding area
 */
export function isPointInLocalBounds(localPt: Point2D, width: number, height: number, padding: number = 0): boolean {
  return (
    localPt.x >= -padding &&
    localPt.x <= width + padding &&
    localPt.y >= -padding &&
    localPt.y <= height + padding
  );
}

/**
 * Checks if a World/Canvas point hits a SceneNode (considering rotation, scale, and anchor)
 */
export function hitTestNode(point: Point2D, node: SceneNode, padding: number = 4): boolean {
  if (!node.visible || node.locked) return false;

  const localPt = worldToLocalPoint(point, node.transform);
  if (!localPt) return false;

  return isPointInLocalBounds(localPt, node.transform.width, node.transform.height, padding);
}

/**
 * Computes the Axis-Aligned Bounding Box (AABB) of a node in World/Canvas coordinates
 */
export function getNodeWorldAABB(transform: Transform): Rect2D {
  const matrix = getNodeTransformMatrix(transform);
  const corners: Point2D[] = [
    { x: 0, y: 0 },
    { x: transform.width, y: 0 },
    { x: transform.width, y: transform.height },
    { x: 0, y: transform.height },
  ];

  const transformedCorners = corners.map((c) => transformPoint(matrix, c));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pt of transformedCorners) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Performs top-to-bottom hit testing against the scene graph.
 * Returns the topmost node ID that intersects the point, or null if empty.
 */
export function hitTestSceneGraph(
  point: Point2D,
  rootOrder: string[],
  nodes: Map<string, SceneNode>,
  padding: number = 4
): SceneNode | null {
  // Traverse in reverse order (topmost layer tested first)
  for (let i = rootOrder.length - 1; i >= 0; i--) {
    const id = rootOrder[i];
    const node = nodes.get(id);
    if (!node || !node.visible || node.locked) continue;

    // If it's a group, test its children first
    if (node.type === 'group' && node.children.length > 0) {
      const childHit = hitTestSceneGraph(point, node.children, nodes, padding);
      if (childHit) return childHit;
    }

    if (hitTestNode(point, node, padding)) {
      return node;
    }
  }

  return null;
}

/**
 * Tests if an AABB rectangle overlaps with a Marquee/Selection box
 */
export function doesRectOverlap(r1: Rect2D, r2: Rect2D): boolean {
  return !(
    r1.x + r1.width < r2.x ||
    r1.x > r2.x + r2.width ||
    r1.y + r1.height < r2.y ||
    r1.y > r2.y + r2.height
  );
}

/**
 * Finds all nodes whose world AABB intersects with a Marquee selection box
 */
export function findNodesInMarquee(
  marquee: Rect2D,
  rootOrder: string[],
  nodes: Map<string, SceneNode>
): string[] {
  const result: string[] = [];

  for (const id of rootOrder) {
    const node = nodes.get(id);
    if (!node || !node.visible || node.locked) continue;

    const aabb = getNodeWorldAABB(node.transform);
    if (doesRectOverlap(marquee, aabb)) {
      result.push(id);
    }
  }

  return result;
}
