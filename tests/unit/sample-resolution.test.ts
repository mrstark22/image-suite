/**
 * The empty state's samples state their own size, so a new user's first
 * image opens without an "assumed size" warning. The samples are drawn on a
 * canvas, which Node lacks; the step that adds the size to the canvas's PNG
 * is tested here on an encoded PNG with none.
 */
import { describe, it, expect } from 'vitest';
import { encodePng8, withPngResolution } from '../../src/lib/png-encoder';
import { readFileDpi } from '../../src/lib/file-dpi';
import { initialSize } from '../../src/store/documentStore';
import { SAMPLE_PX_PER_MM } from '../../src/lib/sample-images';
import { decodePng } from '../helpers/png-decode';

describe('sample image size', () => {
  it('a PNG with no resolution gains one, still decodes to the same pixels, and opens at a stated, not assumed, size', async () => {
    const w = 120;
    const h = 80;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256));
    const plain = await encodePng8(() => rgba, w, h, 'rgb');
    expect(readFileDpi(plain)).toBeNull();

    const sized = withPngResolution(plain, SAMPLE_PX_PER_MM);
    expect(readFileDpi(sized)).toBeCloseTo(254, 6);
    expect(decodePng(sized).samples).toEqual(decodePng(plain).samples);
    expect(decodePng(sized).phys).toEqual({ x: 10000, y: 10000, unit: 1 });

    // 1200 x 800 px at 10 px/mm: 120 x 80 mm, from the file.
    const [mmPerPx, origin] = initialSize({ fileDpi: readFileDpi(sized) });
    expect(origin).toBe('file');
    expect(1200 * (mmPerPx as number)).toBeCloseTo(120, 6);
  });

  it('leaves a PNG that already states a resolution alone', async () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(200);
    const own = await encodePng8(() => rgba, 4, 4, 'grey', { pxPerMm: 5 });
    expect(withPngResolution(own, SAMPLE_PX_PER_MM)).toBe(own);
  });
});
