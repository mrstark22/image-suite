import type { VectorResult, VectorLayer, VectorPath, PathSegment, Point } from '../types/vector';

export interface SmoothingStats {
  originalNodes: number;
  reducedNodes: number;
  reductionPercentage: number;
}

/**
 * Optimizes and simplifies vector paths, converting jagged pixel lines into smooth Bézier curves.
 * Dramatically reduces CNC/laser machine node count to prevent gantry stuttering.
 */
export function smoothVectorResult(
  vectorResult: VectorResult,
  tolerance: number = 1.5,
  fitCurves: boolean = true
): { result: VectorResult; stats: SmoothingStats } {
  let totalOriginalNodes = 0;
  let totalReducedNodes = 0;

  const smoothedLayers: VectorLayer[] = vectorResult.layers.map((layer) => {
    const smoothedPaths: VectorPath[] = layer.paths.map((path) => {
      totalOriginalNodes += path.nodeCount || path.segments.length;

      // Extract all points from segments
      const rawPoints: Point[] = [];
      for (const seg of path.segments) {
        for (const pt of seg.points) {
          rawPoints.push({ x: pt.x, y: pt.y });
        }
      }

      if (rawPoints.length <= 2) {
        totalReducedNodes += rawPoints.length;
        return path;
      }

      // 1. Douglas-Peucker simplification
      const simplified = simplifyRDP(rawPoints, tolerance);

      // 2. Generate smooth SVG path data and segments
      let d = '';
      const newSegments: PathSegment[] = [];

      if (simplified.length > 0) {
        d = `M ${simplified[0].x.toFixed(2)} ${simplified[0].y.toFixed(2)}`;
        newSegments.push({ type: 'M', points: [{ x: simplified[0].x, y: simplified[0].y }] });

        if (fitCurves && simplified.length >= 3) {
          // Fit smooth Catmull-Rom / Bezier splines
          for (let i = 0; i < simplified.length - 1; i++) {
            const p0 = i > 0 ? simplified[i - 1] : simplified[i];
            const p1 = simplified[i];
            const p2 = simplified[i + 1];
            const p3 = i < simplified.length - 2 ? simplified[i + 2] : p2;

            // Control points
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;

            d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
            newSegments.push({
              type: 'C',
              points: [
                { x: cp1x, y: cp1y },
                { x: cp2x, y: cp2y },
                { x: p2.x, y: p2.y },
              ],
            });
          }
        } else {
          for (let i = 1; i < simplified.length; i++) {
            d += ` L ${simplified[i].x.toFixed(2)} ${simplified[i].y.toFixed(2)}`;
            newSegments.push({ type: 'L', points: [{ x: simplified[i].x, y: simplified[i].y }] });
          }
        }

        if (path.isClosed) {
          d += ' Z';
          newSegments.push({ type: 'Z', points: [] });
        }
      }

      const nodeCount = simplified.length;
      totalReducedNodes += nodeCount;

      return {
        ...path,
        nodeCount,
        svgPathData: d || path.svgPathData,
        segments: newSegments.length > 0 ? newSegments : path.segments,
      };
    });

    return {
      ...layer,
      totalNodes: smoothedPaths.reduce((acc, p) => acc + (p.nodeCount || 0), 0),
      paths: smoothedPaths,
    };
  });

  const reductionPercentage =
    totalOriginalNodes > 0
      ? Math.max(0, Math.round(((totalOriginalNodes - totalReducedNodes) / totalOriginalNodes) * 100))
      : 0;

  const result: VectorResult = {
    ...vectorResult,
    totalPaths: smoothedLayers.reduce((acc, l) => acc + l.paths.length, 0),
    totalNodes: totalReducedNodes,
    layers: smoothedLayers,
  };

  return {
    result,
    stats: {
      originalNodes: totalOriginalNodes,
      reducedNodes: totalReducedNodes,
      reductionPercentage,
    },
  };
}

function simplifyRDP(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const d = perpendicularDist(points[i], points[0], points[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyRDP(points.slice(0, index + 1), epsilon);
    const right = simplifyRDP(points.slice(index), epsilon);
    return [...left.slice(0, left.length - 1), ...right];
  } else {
    return [points[0], points[end]];
  }
}

function perpendicularDist(p: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const mag = Math.hypot(dx, dy);
  if (mag === 0) return Math.hypot(p.x - start.x, p.y - start.y);
  return Math.abs(dy * p.x - dx * p.y + end.x * start.y - end.y * start.x) / mag;
}
