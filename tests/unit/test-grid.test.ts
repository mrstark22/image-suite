import { describe, it, expect } from 'vitest';
import { generateTestGridRaster, generateTestGridVector } from '../../src/lib/test-grid-generator';

describe('Material Test Grid Generator Suite', () => {
  it('generates a valid raster test grid buffer for power/speed matrix', () => {
    const { buffer, width, height } = generateTestGridRaster({
      rows: 3,
      cols: 4,
      boxSizeMm: 10,
      gapMm: 2,
      dpi: 300,
      type: 'power-matrix',
    });

    expect(buffer).toBeDefined();
    expect(buffer.byteLength).toBe(width * height * 4);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it('generates a valid grayscale step wedge raster buffer', () => {
    const { buffer, width, height } = generateTestGridRaster({
      rows: 1,
      cols: 10,
      boxSizeMm: 8,
      gapMm: 1,
      dpi: 254,
      type: 'grayscale-step',
    });

    expect(buffer).toBeDefined();
    expect(buffer.byteLength).toBe(width * height * 4);
    expect(width).toBeGreaterThan(0);
  });

  it('generates a laser vector cut grid layer with correct path counts', () => {
    const vectorLayer = generateTestGridVector({
      rows: 4,
      cols: 4,
      boxSizeMm: 10,
      gapMm: 2,
      dpi: 300,
      type: 'power-matrix',
    });

    expect(vectorLayer.paths.length).toBe(16);
    expect(vectorLayer.color).toBe('#ff0000');
    expect(vectorLayer.totalNodes).toBe(64);
    expect(vectorLayer.paths[0].svgPathData).toContain('M');
    expect(vectorLayer.paths[0].svgPathData).toContain('Z');
  });
});
