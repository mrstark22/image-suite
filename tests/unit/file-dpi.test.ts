/**
 * The resolution a file claims, read from its bytes. Each case builds the
 * header by hand from the format specification and checks the decoded value.
 */
import { describe, it, expect } from 'vitest';
import { readFileDpi } from '../../src/lib/file-dpi';

function be32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function bytes(text: string): number[] {
  return Array.from(text, (c) => c.charCodeAt(0));
}

/** A PNG with an IHDR, optionally a pHYs, and an IDAT. CRCs are not checked by the reader. */
function png(phys: { ppuX: number; ppuY: number; unit: number } | null, physAfterIdat = false): Uint8Array {
  const chunk = (type: string, data: number[]) => [...be32(data.length), ...bytes(type), ...data, 0, 0, 0, 0];
  const ihdr = chunk('IHDR', [...be32(10), ...be32(10), 8, 6, 0, 0, 0]);
  const physChunk = phys ? chunk('pHYs', [...be32(phys.ppuX), ...be32(phys.ppuY), phys.unit]) : [];
  const idat = chunk('IDAT', [0]);
  const iend = chunk('IEND', []);
  const body = physAfterIdat ? [...ihdr, ...idat, ...physChunk, ...iend] : [...ihdr, ...physChunk, ...idat, ...iend];
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...body]);
}

/** A JPEG with the given APP segments before the start of scan. */
function jpeg(...segments: number[][]): Uint8Array {
  return new Uint8Array([0xff, 0xd8, ...segments.flat(), 0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 255, length & 255, ...payload];
}

function jfif(units: number, x: number, y: number): number[] {
  return segment(0xe0, [...bytes('JFIF\0'), 1, 2, units, (x >> 8) & 255, x & 255, (y >> 8) & 255, y & 255, 0, 0]);
}

/** An EXIF APP1 with IFD0 holding XResolution (num/den) and, if given, ResolutionUnit. */
function exif(num: number, den: number, unit: number | null, little: boolean): number[] {
  const u16 = (n: number) => (little ? [n & 255, (n >> 8) & 255] : [(n >> 8) & 255, n & 255]);
  const u32 = (n: number) => (little ? be32(n).reverse() : be32(n));
  const entries = unit === null ? 1 : 2;
  const ifdOffset = 8;
  const rationalOffset = ifdOffset + 2 + entries * 12 + 4;
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(ifdOffset),
    ...u16(entries),
    ...u16(0x011a), ...u16(5), ...u32(1), ...u32(rationalOffset),
    ...(unit === null ? [] : [...u16(0x0128), ...u16(3), ...u32(1), ...u16(unit), 0, 0]),
    ...u32(0),
    ...u32(num),
    ...u32(den),
  ];
  return segment(0xe1, [...bytes('Exif\0\0'), ...tiff]);
}

describe('readFileDpi', () => {
  it('reads PNG pHYs in pixels per metre: 11811 px/m is 300 DPI', () => {
    expect(readFileDpi(png({ ppuX: 11811, ppuY: 11811, unit: 1 }))).toBeCloseTo(299.9994, 4);
    expect(readFileDpi(png({ ppuX: 2835, ppuY: 2835, unit: 1 }))).toBeCloseTo(72.009, 3);
  });

  it('ignores a PNG pHYs that gives only an aspect ratio, a missing one, and one after the image data', () => {
    expect(readFileDpi(png({ ppuX: 1, ppuY: 1, unit: 0 }))).toBeNull();
    expect(readFileDpi(png(null))).toBeNull();
    expect(readFileDpi(png({ ppuX: 11811, ppuY: 11811, unit: 1 }, true))).toBeNull();
  });

  it('reads a JPEG JFIF density in dots per inch or per centimetre', () => {
    expect(readFileDpi(jpeg(jfif(1, 72, 72)))).toBe(72);
    expect(readFileDpi(jpeg(jfif(2, 118, 118)))).toBeCloseTo(299.72, 2);
    expect(readFileDpi(jpeg(jfif(0, 1, 1)))).toBeNull();
  });

  it('reads EXIF XResolution in either byte order, with inches as the default unit', () => {
    expect(readFileDpi(jpeg(exif(300, 1, 2, true)))).toBe(300);
    expect(readFileDpi(jpeg(exif(600, 2, null, false)))).toBe(300);
    expect(readFileDpi(jpeg(exif(100, 1, 3, false)))).toBeCloseTo(254, 9);
  });

  it('prefers a JFIF density with units over EXIF, and falls back to EXIF when JFIF gives none', () => {
    expect(readFileDpi(jpeg(jfif(1, 96, 96), exif(300, 1, 2, true)))).toBe(96);
    expect(readFileDpi(jpeg(jfif(0, 1, 1), exif(300, 1, 2, true)))).toBe(300);
  });

  it('returns null for other formats and for truncated data', () => {
    expect(readFileDpi(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(readFileDpi(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBeNull();
    expect(readFileDpi(png({ ppuX: 11811, ppuY: 11811, unit: 1 }).slice(0, 40))).toBeNull();
  });
});
