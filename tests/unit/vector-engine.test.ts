import { describe, it, expect } from 'vitest';
import {
  evaluateCubicBezier,
  evaluateCubicTangent,
  evaluateCubicNormal,
  splitCubicBezier,
  approximateCubicLength,
  closestPointOnCubic,
  computePolygonSignedArea,
  isPointInsidePolygon,
  simplifyPolylineRDP,
  offsetPolyline,
} from '../../src/core/path-math';
import { computeSnap } from '../../src/core/snapping';
import { lineIntersection, clipPolygon } from '../../src/core/boolean-ops';

describe('Vector & Bézier Mathematics Engine', () => {
  it('evaluates cubic Bézier point, tangent, and normal correctly', () => {
    const curve = {
      p0: { x: 0, y: 0 },
      p1: { x: 50, y: 100 },
      p2: { x: 100, y: 100 },
      p3: { x: 150, y: 0 },
    };

    // At t = 0
    const start = evaluateCubicBezier(curve, 0);
    expect(start.x).toBe(0);
    expect(start.y).toBe(0);

    // At t = 1
    const end = evaluateCubicBezier(curve, 1);
    expect(end.x).toBe(150);
    expect(end.y).toBe(0);

    // At t = 0.5 (midpoint should have positive Y)
    const mid = evaluateCubicBezier(curve, 0.5);
    expect(mid.x).toBe(75);
    expect(mid.y).toBeGreaterThan(50);

    // Normal at midpoint
    const tangent = evaluateCubicTangent(curve, 0.5);
    expect(tangent.x).toBeGreaterThan(0);
    const normal = evaluateCubicNormal(curve, 0.5);
    expect(Math.hypot(normal.x, normal.y)).toBeCloseTo(1.0);
  });

  it('splits cubic Bézier curve via de Casteljau accurately', () => {
    const curve = {
      p0: { x: 0, y: 0 },
      p1: { x: 0, y: 100 },
      p2: { x: 100, y: 100 },
      p3: { x: 100, y: 0 },
    };

    const [left, right] = splitCubicBezier(curve, 0.5);
    expect(left.p0.x).toBe(0);
    expect(left.p0.y).toBe(0);
    expect(right.p3.x).toBe(100);
    expect(right.p3.y).toBe(0);

    // Midpoint connection
    expect(left.p3.x).toBeCloseTo(right.p0.x);
    expect(left.p3.y).toBeCloseTo(right.p0.y);
  });

  it('computes arc-length and closest point on curve', () => {
    const straightCurve = {
      p0: { x: 0, y: 0 },
      p1: { x: 25, y: 0 },
      p2: { x: 75, y: 0 },
      p3: { x: 100, y: 0 },
    };

    const length = approximateCubicLength(straightCurve);
    expect(length).toBeCloseTo(100);

    const closest = closestPointOnCubic(straightCurve, { x: 50, y: 10 });
    expect(closest.point.x).toBeCloseTo(50);
    expect(closest.point.y).toBeCloseTo(0);
    expect(closest.distance).toBeCloseTo(10);
  });

  it('computes polygon area, point containment, RDP simplification, and offsetting', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];

    const area = computePolygonSignedArea(square);
    expect(Math.abs(area)).toBe(10000);

    expect(isPointInsidePolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(isPointInsidePolygon({ x: 150, y: 50 }, square)).toBe(false);

    // RDP simplification
    const jagged = [
      { x: 0, y: 0 },
      { x: 25, y: 0.1 },
      { x: 50, y: -0.1 },
      { x: 100, y: 0 },
    ];
    const simplified = simplifyPolylineRDP(jagged, 1.0);
    expect(simplified.length).toBe(2);

    // Offset contour
    const offset = offsetPolyline(square, 5, true);
    expect(offset.length).toBe(4);
  });
});

describe('Precision Snapping Engine', () => {
  it('snaps to document center and returns smart guide lines', () => {
    const snap = computeSnap(
      { x: 502, y: 498 },
      [],
      new Map(),
      [],
      1000,
      1000,
      1.0,
      {
        enabled: true,
        thresholdPx: 8,
        snapToGrid: false,
        gridSize: 20,
        snapToDocumentCenter: true,
        snapToObjects: true,
      }
    );

    expect(snap.snappedPoint.x).toBe(500);
    expect(snap.snappedPoint.y).toBe(500);
    expect(snap.didSnapX).toBe(true);
    expect(snap.didSnapY).toBe(true);
    expect(snap.guides.length).toBe(2);
  });
});

describe('Vector Boolean Operations', () => {
  it('computes line segment intersections and clips convex polygons', () => {
    const p = lineIntersection(
      { x: 0, y: 50 },
      { x: 100, y: 50 },
      { x: 50, y: 0 },
      { x: 50, y: 100 }
    );

    expect(p).not.toBeNull();
    expect(p?.x).toBe(50);
    expect(p?.y).toBe(50);

    const subject = [
      { x: 20, y: 20 },
      { x: 80, y: 20 },
      { x: 80, y: 80 },
      { x: 20, y: 80 },
    ];
    const clip = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
    ];

    const clipped = clipPolygon(subject, clip);
    expect(clipped.length).toBeGreaterThanOrEqual(4);
  });
});
