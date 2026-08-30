import { describe, it, expect } from 'vitest';
import { encodePngGrayscale16 } from '../../src/lib/png-encoder';

describe('16-Bit Grayscale PNG Encoder', () => {
  it('encodes 16-bit depth values into valid PNG format', () => {
    const width = 8;
    const height = 4;
    const total = width * height;
    const depth16 = new Uint16Array(total);

    // Populate with 16-bit gradient
    for (let i = 0; i < total; i++) {
      depth16[i] = Math.round((i / (total - 1)) * 65535);
    }

    const pngBytes = encodePngGrayscale16(depth16, width, height);

    expect(pngBytes).toBeInstanceOf(Uint8Array);
    expect(pngBytes.length).toBeGreaterThan(50);

    // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(pngBytes[0]).toBe(0x89);
    expect(pngBytes[1]).toBe(0x50); // 'P'
    expect(pngBytes[2]).toBe(0x4e); // 'N'
    expect(pngBytes[3]).toBe(0x47); // 'G'
    expect(pngBytes[4]).toBe(0x0d);
    expect(pngBytes[5]).toBe(0x0a);
    expect(pngBytes[6]).toBe(0x1a);
    expect(pngBytes[7]).toBe(0x0a);

    // Verify IHDR width and height
    const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
    const w = view.getUint32(16, false);
    const h = view.getUint32(20, false);
    const bitDepth = pngBytes[24];
    const colorType = pngBytes[25];

    expect(w).toBe(width);
    expect(h).toBe(height);
    expect(bitDepth).toBe(16);
    expect(colorType).toBe(0); // Grayscale
  });
});
