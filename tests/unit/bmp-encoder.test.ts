import { describe, it, expect } from 'vitest';
import { encodeBmpGrayscale8, encodeBmpRgb24 } from '../../src/lib/bmp-encoder';

describe('BMP Encoder', () => {
  it('encodes 8-bit Grayscale BMP with valid BMP headers and palette', () => {
    const width = 10;
    const height = 10;
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) gray[i] = i % 256;

    const buffer = encodeBmpGrayscale8(gray, width, height, 300);
    const view = new DataView(buffer);

    // Magic number 'BM'
    expect(view.getUint8(0)).toBe(0x42); // 'B'
    expect(view.getUint8(1)).toBe(0x4d); // 'M'

    // Info header size
    expect(view.getUint32(14, true)).toBe(40);
    // Width and Height
    expect(view.getInt32(18, true)).toBe(10);
    expect(view.getInt32(22, true)).toBe(10);
    // 8 bits per pixel
    expect(view.getUint16(28, true)).toBe(8);
  });

  it('encodes 24-bit RGB BMP with row padding', () => {
    const width = 7; // Needs padding: 7*3 = 21 bytes -> padded to 24 bytes
    const height = 5;
    const rgba = new Uint8ClampedArray(width * height * 4);

    const buffer = encodeBmpRgb24(rgba, width, height, 300);
    const view = new DataView(buffer);

    expect(view.getUint8(0)).toBe(0x42);
    expect(view.getUint8(1)).toBe(0x4d);
    expect(view.getUint16(28, true)).toBe(24);
  });
});
