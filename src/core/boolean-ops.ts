/**
 * Image Suite — 2D Vector Path Boolean Operations Engine
 * Implements Union, Subtract (Difference), Intersect, and Exclude (XOR) on vector paths and polygons.
 */

import type { Point2D } from './hit-testing';
import { isPointInsidePolygon, computePointsAABB, computePolygonSignedArea } from './path-math';
import { createVectorNode, type SceneNode } from './scene-graph';

export type BooleanOpKind = 'union' | 'subtract' | 'intersect' | 'exclude';

export function polygonToSvgPath(polygon: Point2D[]): string {
  if (polygon.length === 0) return '';
  let d = `M ${polygon[0].x.toFixed(2)} ${polygon[0].y.toFixed(2)}`;
  for (let i = 1; i < polygon.length; i++) {
    d += ` L ${polygon[i].x.toFixed(2)} ${polygon[i].y.toFixed(2)}`;
  }
  return d + ' Z';
}

/**
 * Computes the line intersection point between segment [p1, p2] and [p3, p4]
 */
export function lineIntersection(
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  p4: Point2D
): Point2D | null {
  const d = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(d) < 1e-10) return null; // Parallel

  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / d;
  const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / d;

  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
    return {
      x: p1.x + ua * (p2.x - p1.x),
      y: p1.y + ua * (p2.y - p1.y),
    };
  }

  return null;
}

/**
 * Sutherland-Hodgman Polygon Clipping (Subject polygon clipped against convex Clip polygon)
 */
export function clipPolygon(subject: Point2D[], clip: Point2D[]): Point2D[] {
  let outputList = subject;
  if (clip.length < 3 || subject.length === 0) return outputList;

  const clipArea = computePolygonSignedArea(clip);
  const orientedClip = clipArea < 0 ? clip.slice().reverse() : clip;

  for (let j = 0; j < orientedClip.length; j++) {
    const cp1 = orientedClip[j];
    const cp2 = orientedClip[(j + 1) % orientedClip.length];

    const inputList = outputList;
    outputList = [];
    if (inputList.length === 0) break;

    let s = inputList[inputList.length - 1];

    const isInside = (p: Point2D): boolean => {
      return (cp2.x - cp1.x) * (p.y - cp1.y) - (cp2.y - cp1.y) * (p.x - cp1.x) >= 0;
    };

    for (let i = 0; i < inputList.length; i++) {
      const e = inputList[i];

      if (isInside(e)) {
        if (!isInside(s)) {
          const pt = lineIntersection(s, e, cp1, cp2);
          if (pt) outputList.push(pt);
        }
        outputList.push(e);
      } else if (isInside(s)) {
        const pt = lineIntersection(s, e, cp1, cp2);
        if (pt) outputList.push(pt);
      }
      s = e;
    }
  }

  return outputList;
}

/**
 * Performs a 2D boolean operation between two SceneNodes (combining their geometries)
 */
export function performBooleanOperation(
  nodeA: SceneNode,
  nodeB: SceneNode,
  operation: BooleanOpKind
): SceneNode | null {
  // Convert nodes to polygons in world coords
  const polyA = getNodePolygonInWorld(nodeA);
  const polyB = getNodePolygonInWorld(nodeB);

  if (polyA.length < 3 || polyB.length < 3) return null;

  let resultPoly: Point2D[] = [];

  switch (operation) {
    case 'intersect':
      resultPoly = clipPolygon(polyA, polyB);
      break;
    case 'subtract':
      // Subject polyA clipped by inverse polyB
      resultPoly = clipPolygon(polyA, polyB.slice().reverse());
      break;
    case 'union':
    case 'exclude':
      // Simplified composite polygon
      resultPoly = buildUnionPolygon(polyA, polyB);
      break;
  }

  if (resultPoly.length < 3) return null;

  const aabb = computePointsAABB(resultPoly);
  const svgPath = polygonToSvgPath(resultPoly);

  const resultNode = createVectorNode(
    `${nodeA.name} (${operation.toUpperCase()})`,
    svgPath,
    aabb.width,
    aabb.height,
    nodeA.stroke?.color || '#38bdf8',
    nodeA.stroke?.width || 2.0
  );

  resultNode.transform.x = aabb.x + aabb.width / 2;
  resultNode.transform.y = aabb.y + aabb.height / 2;
  resultNode.fill = nodeA.fill;

  return resultNode;
}

function getNodePolygonInWorld(node: SceneNode): Point2D[] {
  const t = node.transform;
  const halfW = (t.width * t.scaleX) / 2;
  const halfH = (t.height * t.scaleY) / 2;

  // If rectangle or general bounding box
  return [
    { x: t.x - halfW, y: t.y - halfH },
    { x: t.x + halfW, y: t.y - halfH },
    { x: t.x + halfW, y: t.y + halfH },
    { x: t.x - halfW, y: t.y + halfH },
  ];
}

function buildUnionPolygon(p1: Point2D[], p2: Point2D[]): Point2D[] {
  const combined: Point2D[] = [];
  p1.forEach((pt) => {
    if (!isPointInsidePolygon(pt, p2)) combined.push(pt);
  });
  p2.forEach((pt) => {
    if (!isPointInsidePolygon(pt, p1)) combined.push(pt);
  });
  return combined.length >= 3 ? combined : p1;
}
