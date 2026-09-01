/**
 * Image Suite — Professional Vector & Bézier Path Mathematics Engine
 * Cubic/Quadratic Bézier evaluation, de Casteljau curve splitting, tangents, normals,
 * arc-length parameterization, point-to-curve distance, polygon winding, and Ramer-Douglas-Peucker simplification.
 */

import type { Point2D, Rect2D } from './hit-testing';

export interface CubicBezier {
  p0: Point2D;
  p1: Point2D; // Control point 1
  p2: Point2D; // Control point 2
  p3: Point2D;
}

export interface QuadraticBezier {
  p0: Point2D;
  p1: Point2D; // Control point
  p2: Point2D;
}

// ----------------------------------------------------
// 2D Vector Fundamentals
// ----------------------------------------------------

export function vecDistance(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function vecDot(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y;
}

export function vecCross(a: Point2D, b: Point2D): number {
  return a.x * b.y - a.y * b.x;
}

export function vecLength(v: Point2D): number {
  return Math.hypot(v.x, v.y);
}

export function vecNormalize(v: Point2D): Point2D {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function vecNormal(v: Point2D): Point2D {
  const norm = vecNormalize(v);
  return { x: -norm.y, y: norm.x };
}

export function vecLerp(a: Point2D, b: Point2D, t: number): Point2D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

// ----------------------------------------------------
// Cubic & Quadratic Bézier Math
// ----------------------------------------------------

/**
 * Evaluates a point on a Cubic Bézier curve at parameter t (0.0 to 1.0)
 */
export function evaluateCubicBezier(curve: CubicBezier, t: number): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: mt3 * curve.p0.x + 3 * mt2 * t * curve.p1.x + 3 * mt * t2 * curve.p2.x + t3 * curve.p3.x,
    y: mt3 * curve.p0.y + 3 * mt2 * t * curve.p1.y + 3 * mt * t2 * curve.p2.y + t3 * curve.p3.y,
  };
}

/**
 * Computes the tangent velocity vector of a Cubic Bézier curve at parameter t
 */
export function evaluateCubicTangent(curve: CubicBezier, t: number): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;

  const dx = 3 * mt2 * (curve.p1.x - curve.p0.x) + 6 * mt * t * (curve.p2.x - curve.p1.x) + 3 * t2 * (curve.p3.x - curve.p2.x);
  const dy = 3 * mt2 * (curve.p1.y - curve.p0.y) + 6 * mt * t * (curve.p2.y - curve.p1.y) + 3 * t2 * (curve.p3.y - curve.p2.y);

  return { x: dx, y: dy };
}

/**
 * Computes the normalized normal unit vector of a Cubic Bézier curve at parameter t
 */
export function evaluateCubicNormal(curve: CubicBezier, t: number): Point2D {
  const tangent = evaluateCubicTangent(curve, t);
  return vecNormal(tangent);
}

/**
 * Splits a Cubic Bézier curve into two sub-curves at parameter t via de Casteljau's algorithm
 */
export function splitCubicBezier(curve: CubicBezier, t: number): [CubicBezier, CubicBezier] {
  const p01 = vecLerp(curve.p0, curve.p1, t);
  const p12 = vecLerp(curve.p1, curve.p2, t);
  const p23 = vecLerp(curve.p2, curve.p3, t);

  const p012 = vecLerp(p01, p12, t);
  const p123 = vecLerp(p12, p23, t);

  const p0123 = vecLerp(p012, p123, t);

  const left: CubicBezier = {
    p0: curve.p0,
    p1: p01,
    p2: p012,
    p3: p0123,
  };

  const right: CubicBezier = {
    p0: p0123,
    p1: p123,
    p2: p23,
    p3: curve.p3,
  };

  return [left, right];
}

/**
 * Approximates the arc-length of a Cubic Bézier curve by adaptive chord sampling
 */
export function approximateCubicLength(curve: CubicBezier, steps: number = 20): number {
  let length = 0;
  let prev = curve.p0;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const curr = evaluateCubicBezier(curve, t);
    length += vecDistance(prev, curr);
    prev = curr;
  }

  return length;
}

/**
 * Finds the closest point on a Cubic Bézier curve to an arbitrary query point
 */
export function closestPointOnCubic(
  curve: CubicBezier,
  query: Point2D,
  samples: number = 50
): { point: Point2D; t: number; distance: number } {
  let minDistance = Infinity;
  let bestT = 0;
  let bestPoint = curve.p0;

  // Initial coarse sample
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const pt = evaluateCubicBezier(curve, t);
    const dist = vecDistance(query, pt);
    if (dist < minDistance) {
      minDistance = dist;
      bestT = t;
      bestPoint = pt;
    }
  }

  // Refine around bestT via binary search
  let tMin = Math.max(0, bestT - 0.04);
  let tMax = Math.min(1, bestT + 0.04);

  for (let iter = 0; iter < 24; iter++) {
    const t1 = tMin + (tMax - tMin) * 0.382;
    const t2 = tMin + (tMax - tMin) * 0.618;
    const p1 = evaluateCubicBezier(curve, t1);
    const p2 = evaluateCubicBezier(curve, t2);
    const d1 = vecDistance(query, p1);
    const d2 = vecDistance(query, p2);

    if (d1 < d2) {
      tMax = t2;
      bestT = t1;
      bestPoint = p1;
      minDistance = d1;
    } else {
      tMin = t1;
      bestT = t2;
      bestPoint = p2;
      minDistance = d2;
    }
  }

  return { point: bestPoint, t: bestT, distance: minDistance };
}

// ----------------------------------------------------
// Polygon & Polyline Geometric Algorithms
// ----------------------------------------------------

/**
 * Computes the signed area of a 2D polygon using the Shoelace formula.
 * Positive = Clockwise / Negative = Counter-Clockwise (in standard screen coords where Y points down).
 */
export function computePolygonSignedArea(polygon: Point2D[]): number {
  if (polygon.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    area += polygon[i].x * polygon[j].y;
    area -= polygon[j].x * polygon[i].y;
  }
  return area / 2;
}

/**
 * Checks if a point is inside a polygon via Ray Casting algorithm (Jordan Curve Theorem)
 */
export function isPointInsidePolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Computes the bounding box of an array of 2D points
 */
export function computePointsAABB(points: Point2D[]): Rect2D {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

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

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

/**
 * Polyline simplification using the Ramer-Douglas-Peucker (RDP) algorithm
 */
export function simplifyPolylineRDP(points: Point2D[], tolerance: number): Point2D[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let index = 0;

  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyPolylineRDP(points.slice(0, index + 1), tolerance);
    const right = simplifyPolylineRDP(points.slice(index), tolerance);
    return left.slice(0, -1).concat(right);
  }

  return [start, end];
}

function perpendicularDistance(p: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lineLenSq = dx * dx + dy * dy;

  if (lineLenSq === 0) return vecDistance(p, lineStart);

  const t = Math.max(0, Math.min(1, ((p.x - lineStart.x) * dx + (p.y - lineStart.y) * dy) / lineLenSq));
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;

  return vecDistance(p, { x: projX, y: projY });
}

/**
 * Generates an offset polyline / contour (for kerf compensation and cutlines)
 */
export function offsetPolyline(points: Point2D[], offsetDist: number, isClosed: boolean): Point2D[] {
  if (points.length < 2) return points;

  const result: Point2D[] = [];
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const curr = points[i];
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];

    if (!isClosed && (i === 0 || i === n - 1)) {
      if (i === 0) {
        const seg = vecNormalize({ x: next.x - curr.x, y: next.y - curr.y });
        const norm = vecNormal(seg);
        result.push({ x: curr.x + norm.x * offsetDist, y: curr.y + norm.y * offsetDist });
      } else {
        const seg = vecNormalize({ x: curr.x - prev.x, y: curr.y - prev.y });
        const norm = vecNormal(seg);
        result.push({ x: curr.x + norm.x * offsetDist, y: curr.y + norm.y * offsetDist });
      }
      continue;
    }

    const v1 = vecNormalize({ x: curr.x - prev.x, y: curr.y - prev.y });
    const v2 = vecNormalize({ x: next.x - curr.x, y: next.y - curr.y });

    const n1 = vecNormal(v1);
    const n2 = vecNormal(v2);

    const bisector = vecNormalize({ x: n1.x + n2.x, y: n1.y + n2.y });
    const dot = vecDot(bisector, n1);
    const miterLen = dot !== 0 ? offsetDist / dot : offsetDist;

    // Clamp miter to avoid giant spikes on sharp corners
    const clampedMiter = Math.min(Math.max(miterLen, -Math.abs(offsetDist) * 3), Math.abs(offsetDist) * 3);

    result.push({
      x: curr.x + bisector.x * clampedMiter,
      y: curr.y + bisector.y * clampedMiter,
    });
  }

  return result;
}

/**
 * Parses SVG Path data string ('M ... L ... C ... Z') into an array of discrete point polylines
 */
export function parseSvgPathToPolylines(svgPathData: string, samplesPerCurve: number = 16): Point2D[][] {
  if (!svgPathData || !svgPathData.trim()) return [];

  const polylines: Point2D[][] = [];
  let currentPoly: Point2D[] = [];
  let currentPt: Point2D = { x: 0, y: 0 };
  let startPt: Point2D = { x: 0, y: 0 };

  // Match command and number sequences
  const cmdRegex = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  let match: RegExpExecArray | null;

  while ((match = cmdRegex.exec(svgPathData)) !== null) {
    const cmd = match[1];
    const argsStr = match[2].trim();
    const numbers = argsStr ? argsStr.replace(/,/g, ' ').split(/\s+/).filter(Boolean).map(Number) : [];

    switch (cmd) {
      case 'M': {
        for (let i = 0; i < numbers.length; i += 2) {
          if (i === 0) {
            if (currentPoly.length > 0) polylines.push(currentPoly);
            currentPt = { x: numbers[i], y: numbers[i + 1] };
            startPt = { ...currentPt };
            currentPoly = [{ ...currentPt }];
          } else {
            currentPt = { x: numbers[i], y: numbers[i + 1] };
            currentPoly.push({ ...currentPt });
          }
        }
        break;
      }
      case 'm': {
        for (let i = 0; i < numbers.length; i += 2) {
          if (i === 0) {
            if (currentPoly.length > 0) polylines.push(currentPoly);
            currentPt = { x: currentPt.x + numbers[i], y: currentPt.y + numbers[i + 1] };
            startPt = { ...currentPt };
            currentPoly = [{ ...currentPt }];
          } else {
            currentPt = { x: currentPt.x + numbers[i], y: currentPt.y + numbers[i + 1] };
            currentPoly.push({ ...currentPt });
          }
        }
        break;
      }
      case 'L': {
        for (let i = 0; i < numbers.length; i += 2) {
          currentPt = { x: numbers[i], y: numbers[i + 1] };
          currentPoly.push({ ...currentPt });
        }
        break;
      }
      case 'l': {
        for (let i = 0; i < numbers.length; i += 2) {
          currentPt = { x: currentPt.x + numbers[i], y: currentPt.y + numbers[i + 1] };
          currentPoly.push({ ...currentPt });
        }
        break;
      }
      case 'H': {
        for (let i = 0; i < numbers.length; i++) {
          currentPt = { x: numbers[i], y: currentPt.y };
          currentPoly.push({ ...currentPt });
        }
        break;
      }
      case 'h': {
        for (let i = 0; i < numbers.length; i++) {
          currentPt = { x: currentPt.x + numbers[i], y: currentPt.y };
          currentPoly.push({ ...currentPt });
        }
        break;
      }
      case 'V': {
        for (let i = 0; i < numbers.length; i++) {
          currentPt = { x: currentPt.x, y: numbers[i] };
          currentPoly.push({ ...currentPt });
        }
        break;
      }
      case 'v': {
        for (let i = 0; i < numbers.length; i++) {
          currentPt = { x: currentPt.x, y: currentPt.y + numbers[i] };
          currentPoly.push({ ...currentPt });
        }
        break;
      }
      case 'C': {
        for (let i = 0; i < numbers.length; i += 6) {
          const cp1 = { x: numbers[i], y: numbers[i + 1] };
          const cp2 = { x: numbers[i + 2], y: numbers[i + 3] };
          const end = { x: numbers[i + 4], y: numbers[i + 5] };
          const curve: CubicBezier = { p0: currentPt, p1: cp1, p2: cp2, p3: end };
          for (let s = 1; s <= samplesPerCurve; s++) {
            currentPoly.push(evaluateCubicBezier(curve, s / samplesPerCurve));
          }
          currentPt = end;
        }
        break;
      }
      case 'c': {
        for (let i = 0; i < numbers.length; i += 6) {
          const cp1 = { x: currentPt.x + numbers[i], y: currentPt.y + numbers[i + 1] };
          const cp2 = { x: currentPt.x + numbers[i + 2], y: currentPt.y + numbers[i + 3] };
          const end = { x: currentPt.x + numbers[i + 4], y: currentPt.y + numbers[i + 5] };
          const curve: CubicBezier = { p0: currentPt, p1: cp1, p2: cp2, p3: end };
          for (let s = 1; s <= samplesPerCurve; s++) {
            currentPoly.push(evaluateCubicBezier(curve, s / samplesPerCurve));
          }
          currentPt = end;
        }
        break;
      }
      case 'Z':
      case 'z': {
        if (currentPoly.length > 0) {
          currentPoly.push({ ...startPt });
          polylines.push(currentPoly);
          currentPoly = [];
        }
        currentPt = { ...startPt };
        break;
      }
    }
  }

  if (currentPoly.length > 0) {
    polylines.push(currentPoly);
  }

  return polylines;
}
