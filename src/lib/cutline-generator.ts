import type { VectorLayer, VectorPath, VectorPoint } from '../types/vector';

export interface CutlineOptions {
  offsetMm: number;        // e.g. 2.0 mm outward offset
  dpi: number;             // e.g. 300 or 254
  smoothness: number;      // 0 to 10 (3 default)
  alphaThreshold?: number; // 0 to 255 (20 default)
  color?: string;          // '#ff0000' (standard red cut line)
}

/**
 * Generates an offset vector cutline contour around non-transparent or non-white image pixels.
 */
export function generateCutlineLayer(
  buffer: ArrayBuffer,
  width: number,
  height: number,
  options: CutlineOptions
): VectorLayer {
  const {
    offsetMm = 2.0,
    dpi = 300,
    smoothness = 3,
    alphaThreshold = 20,
    color = '#ff0000',
  } = options;

  const data = new Uint8ClampedArray(buffer);
  const totalPixels = width * height;

  // 1. Create binary mask (1 = foreground, 0 = background)
  const mask = new Uint8Array(totalPixels);
  let hasAlpha = false;

  // Check if image actually has transparent pixels
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) {
      hasAlpha = true;
      break;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      if (hasAlpha) {
        mask[y * width + x] = a > alphaThreshold ? 1 : 0;
      } else {
        // If no alpha channel, treat non-white pixels as subject (luma < 245)
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        mask[y * width + x] = luma < 245 ? 1 : 0;
      }
    }
  }

  // 2. Compute Offset in pixels
  const offsetPx = Math.round((offsetMm / 25.4) * dpi);

  // 3. Morphological Dilation for offset > 0
  let dilatedMask: Uint8Array = mask;
  if (offsetPx > 0) {
    dilatedMask = dilateBinaryMask(mask, width, height, Math.min(offsetPx, 100));
  }

  // 4. Extract outer perimeter contour using Moore-Neighbor tracing
  const rawPolygons = traceBoundaryContours(dilatedMask, width, height);

  // 5. Simplify and smooth contours
  const tolerance = Math.max(0.5, smoothness * 0.8);
  const paths: VectorPath[] = [];

  rawPolygons.forEach((poly, polyIdx) => {
    if (poly.length < 3) return;
    const simplified = simplifyDouglasPeucker(poly, tolerance);
    if (simplified.length < 3) return;

    // Convert to SVG path data
    let d = `M ${simplified[0].x.toFixed(2)} ${simplified[0].y.toFixed(2)}`;
    for (let i = 1; i < simplified.length; i++) {
      d += ` L ${simplified[i].x.toFixed(2)} ${simplified[i].y.toFixed(2)}`;
    }
    d += ' Z';

    paths.push({
      id: `cutline-path-${polyIdx + 1}`,
      color,
      svgPathData: d,
      isClosed: true,
      nodeCount: simplified.length,
      segments: [
        { type: 'M', points: [{ x: simplified[0].x, y: simplified[0].y }] },
        ...simplified.slice(1).map((pt) => ({ type: 'L' as const, points: [{ x: pt.x, y: pt.y }] })),
        { type: 'Z', points: [] },
      ],
    });
  });

  return {
    id: `cutline-layer-${Date.now()}`,
    name: `Cut Line (${offsetMm > 0 ? `+${offsetMm}mm` : '0mm'})`,
    color,
    visible: true,
    totalNodes: paths.reduce((acc, p) => acc + p.nodeCount, 0),
    paths,
  };
}

/**
 * Fast Euclidean distance-based binary dilation for offset boundary generation.
 */
function dilateBinaryMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  const result = new Uint8Array(mask.length);
  const r2 = radius * radius;

  // Find all border pixels of the foreground mask
  const borderPoints: Array<{ x: number; y: number }> = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (mask[idx] === 1) {
        if (
          mask[idx - 1] === 0 ||
          mask[idx + 1] === 0 ||
          mask[idx - width] === 0 ||
          mask[idx + width] === 0
        ) {
          borderPoints.push({ x, y });
        }
        result[idx] = 1;
      }
    }
  }

  // Stamp circle radius around border pixels
  for (const pt of borderPoints) {
    const minX = Math.max(0, pt.x - radius);
    const maxX = Math.min(width - 1, pt.x + radius);
    const minY = Math.max(0, pt.y - radius);
    const maxY = Math.min(height - 1, pt.y + radius);

    for (let py = minY; py <= maxY; py++) {
      const dy = py - pt.y;
      for (let px = minX; px <= maxX; px++) {
        const dx = px - pt.x;
        if (dx * dx + dy * dy <= r2) {
          result[py * width + px] = 1;
        }
      }
    }
  }

  return result;
}

/**
 * Traces continuous perimeter polygons from a binary mask.
 */
function traceBoundaryContours(
  mask: Uint8Array,
  width: number,
  height: number
): VectorPoint[][] {
  const contours: VectorPoint[][] = [];
  const visited = new Uint8Array(mask.length);

  // Moore neighborhood 8-directional offsets
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (mask[idx] === 1 && visited[idx] === 0) {
        // Check if this pixel borders background
        const isBorder =
          mask[idx - 1] === 0 ||
          mask[idx + 1] === 0 ||
          mask[idx - width] === 0 ||
          mask[idx + width] === 0;

        if (isBorder) {
          const poly: VectorPoint[] = [];
          let cx = x;
          let cy = y;
          let dir = 0;
          let steps = 0;
          const maxSteps = width * height;

          while (steps < maxSteps) {
            poly.push({ x: cx, y: cy });
            visited[cy * width + cx] = 1;

            // Search next counter-clockwise neighbor
            let found = false;
            for (let i = 0; i < 8; i++) {
              const ndir = (dir + i) % 8;
              const nx = cx + dx[ndir];
              const ny = cy + dy[ndir];

              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                if (mask[ny * width + nx] === 1) {
                  cx = nx;
                  cy = ny;
                  dir = (ndir + 5) % 8; // Backtrack direction
                  found = true;
                  break;
                }
              }
            }

            if (!found || (cx === x && cy === y && poly.length > 2)) {
              break;
            }
            steps++;
          }

          if (poly.length >= 8) {
            contours.push(poly);
          }
        }
      }
    }
  }

  return contours;
}

/**
 * Douglas-Peucker line simplification algorithm.
 */
function simplifyDouglasPeucker(points: VectorPoint[], epsilon: number): VectorPoint[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyDouglasPeucker(points.slice(0, index + 1), epsilon);
    const right = simplifyDouglasPeucker(points.slice(index), epsilon);
    return [...left.slice(0, left.length - 1), ...right];
  } else {
    return [points[0], points[end]];
  }
}

function perpendicularDistance(p: VectorPoint, lineStart: VectorPoint, lineEnd: VectorPoint): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const mag = Math.hypot(dx, dy);
  if (mag === 0) return Math.hypot(p.x - lineStart.x, p.y - lineStart.y);
  return Math.abs(dy * p.x - dx * p.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / mag;
}
