import type { VectorLayer, VectorPath } from '../types/vector';

export interface TestGridOptions {
  rows: number; // e.g. 5
  cols: number; // e.g. 5
  boxSizeMm: number; // e.g. 10mm
  gapMm: number; // e.g. 2mm
  dpi: number; // default 300
  type: 'grayscale-step' | 'power-matrix';
}

/**
 * Generates an image buffer containing a calibrated material test grid or step wedge.
 */
export function generateTestGridRaster(options: TestGridOptions): {
  buffer: ArrayBuffer;
  width: number;
  height: number;
} {
  const { rows, cols, boxSizeMm, gapMm, dpi, type } = options;

  const mmToPx = (mm: number) => Math.round((mm / 25.4) * dpi);
  const boxPx = mmToPx(boxSizeMm);
  const gapPx = mmToPx(gapMm);
  const marginPx = mmToPx(5); // 5mm margin

  const width = marginPx * 2 + cols * boxPx + (cols - 1) * gapPx;
  const height = marginPx * 2 + rows * boxPx + (rows - 1) * gapPx;

  const totalBytes = width * height * 4;
  const buffer = new ArrayBuffer(totalBytes);
  const data = new Uint8ClampedArray(buffer);

  // Fill background white
  data.fill(255);

  const totalSteps = rows * cols;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const startX = marginPx + c * (boxPx + gapPx);
      const startY = marginPx + r * (boxPx + gapPx);
      const stepIdx = r * cols + c;

      let luma = 0;
      if (type === 'grayscale-step') {
        const pct = Math.round(((stepIdx + 1) / totalSteps) * 100);
        luma = Math.round(255 * (1 - pct / 100));
      } else {
        const powerPct = Math.round(20 + (r / Math.max(1, rows - 1)) * 80);
        luma = Math.round(255 * (1 - powerPct / 100));
      }

      // Draw box pixels
      for (let y = startY; y < startY + boxPx && y < height; y++) {
        for (let x = startX; x < startX + boxPx && x < width; x++) {
          const idx = (y * width + x) * 4;
          data[idx] = luma;
          data[idx + 1] = luma;
          data[idx + 2] = luma;
          data[idx + 3] = 255;
        }
      }
    }
  }

  return {
    buffer,
    width,
    height,
  };
}

/**
 * Generates vector cutting / engraving grid paths for direct laser / CNC testing.
 */
export function generateTestGridVector(options: TestGridOptions): VectorLayer {
  const { rows, cols, boxSizeMm, gapMm, dpi } = options;

  const mmToPx = (mm: number) => (mm / 25.4) * dpi;
  const boxPx = mmToPx(boxSizeMm);
  const gapPx = mmToPx(gapMm);
  const marginPx = mmToPx(5);

  const paths: VectorPath[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = marginPx + c * (boxPx + gapPx);
      const y = marginPx + r * (boxPx + gapPx);

      const d = `M ${x.toFixed(2)} ${y.toFixed(2)} L ${(x + boxPx).toFixed(2)} ${y.toFixed(2)} L ${(x + boxPx).toFixed(2)} ${(y + boxPx).toFixed(2)} L ${x.toFixed(2)} ${(y + boxPx).toFixed(2)} Z`;

      paths.push({
        id: `grid-box-${r}-${c}`,
        color: '#ff0000',
        isClosed: true,
        nodeCount: 4,
        svgPathData: d,
        segments: [
          { type: 'M', points: [{ x, y }] },
          { type: 'L', points: [{ x: x + boxPx, y }] },
          { type: 'L', points: [{ x: x + boxPx, y: y + boxPx }] },
          { type: 'L', points: [{ x, y: y + boxPx }] },
          { type: 'Z', points: [] },
        ],
      });
    }
  }

  return {
    id: `material-test-grid-${Date.now()}`,
    name: 'Material Test Grid (Cut)',
    color: '#ff0000',
    visible: true,
    totalNodes: paths.length * 4,
    paths,
  };
}
