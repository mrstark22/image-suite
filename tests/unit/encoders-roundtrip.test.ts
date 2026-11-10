/**
 * Round-trip tests for the hand-written PNG and BMP encoders.
 *
 * Each file is decoded by a small decoder written here from the format
 * specifications (using Node's zlib for inflate and CRC), and every sample is
 * compared with the source. A corrupt pixel, CRC, length or header fails.
 */
import { describe, it, expect } from 'vitest';
import zlib from 'zlib';
import { encodePngGrayscale16 } from '../../src/lib/png-encoder';
import { encodeBmpGrayscale8, encodeBmpRgb24 } from '../../src/lib/bmp-encoder';

interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  chunkTypes: string[];
  samples: Uint16Array;
}

/** Decodes a non-interlaced greyscale PNG, verifying the signature and every chunk CRC. */
function decodeGreyPng(bytes: Uint8Array): DecodedPng {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== signature[i]) throw new Error('Bad PNG signature');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkTypes: string[] = [];
  const idat: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let p = 8;
  while (p < bytes.length) {
    const length = view.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const data = bytes.subarray(p + 8, p + 8 + length);
    const storedCrc = view.getUint32(p + 8 + length);
    const actualCrc = zlib.crc32(bytes.subarray(p + 4, p + 8 + length));
    if (storedCrc !== actualCrc) throw new Error(`Bad CRC in ${type} chunk`);
    chunkTypes.push(type);
    if (type === 'IHDR') {
      const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = d.getUint32(0);
      height = d.getUint32(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw new Error('Unsupported IHDR options');
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    p += 12 + length;
  }
  if (p !== bytes.length) throw new Error('Trailing or truncated data');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bytesPerSample = bitDepth / 8;
  const stride = width * bytesPerSample;
  if (raw.length !== (stride + 1) * height) throw new Error('Unexpected decompressed size');

  const samples = new Uint16Array(width * height);
  const prev = new Uint8Array(stride);
  const row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= bytesPerSample ? row[i - bytesPerSample] : 0;
      const b = prev[i];
      const c = i >= bytesPerSample ? prev[i - bytesPerSample] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`Bad filter type ${filter}`);
      row[i] = (x + predictor) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      samples[y * width + x] = bytesPerSample === 2 ? (row[x * 2] << 8) | row[x * 2 + 1] : row[x];
    }
    prev.set(row);
  }
  return { width, height, bitDepth, colorType, chunkTypes, samples };
}

interface DecodedBmp {
  width: number;
  height: number;
  bitsPerPixel: number;
  pixelsPerMetreX: number;
  pixelsPerMetreY: number;
  fileSize: number;
  dataOffset: number;
  palette: Uint8Array;
  /** Top-down rows; one value per pixel for 8-bit, [r, g, b] triples for 24-bit. */
  pixels: Uint8Array;
  paddingBytes: number[];
}

/** Decodes an uncompressed, bottom-up 8-bit or 24-bit BMP. */
function decodeBmp(buffer: ArrayBuffer): DecodedBmp {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw new Error('Bad BMP signature');
  const fileSize = view.getUint32(2, true);
  const dataOffset = view.getUint32(10, true);
  const infoSize = view.getUint32(14, true);
  const width = view.getInt32(18, true);
  const height = view.getInt32(22, true);
  const planes = view.getUint16(26, true);
  const bitsPerPixel = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  const pixelsPerMetreX = view.getInt32(38, true);
  const pixelsPerMetreY = view.getInt32(42, true);
  if (infoSize !== 40 || planes !== 1 || compression !== 0) throw new Error('Unsupported BMP header');
  if (height <= 0) throw new Error('Expected a bottom-up BMP');

  const channels = bitsPerPixel / 8;
  const stride = Math.ceil((width * channels) / 4) * 4;
  const palette = bytes.slice(14 + infoSize, dataOffset);
  const pixels = new Uint8Array(width * height * channels);
  const paddingBytes: number[] = [];
  for (let y = 0; y < height; y++) {
    const rowStart = dataOffset + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      if (channels === 1) {
        pixels[y * width + x] = bytes[rowStart + x];
      } else {
        // Stored as B, G, R.
        pixels[(y * width + x) * 3] = bytes[rowStart + x * 3 + 2];
        pixels[(y * width + x) * 3 + 1] = bytes[rowStart + x * 3 + 1];
        pixels[(y * width + x) * 3 + 2] = bytes[rowStart + x * 3];
      }
    }
    for (let i = width * channels; i < stride; i++) paddingBytes.push(bytes[rowStart + i]);
  }
  return {
    width,
    height,
    bitsPerPixel,
    pixelsPerMetreX,
    pixelsPerMetreY,
    fileSize,
    dataOffset,
    palette,
    pixels,
    paddingBytes,
  };
}

/** Deterministic pseudo-random values in [0, max]. */
function noise(count: number, max: number, seed = 7): number[] {
  let s = seed;
  return Array.from({ length: count }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % (max + 1);
  });
}

describe('16-bit greyscale PNG encoder', () => {
  it('round-trips every sample of a pseudo-random image through an independent decoder', () => {
    const width = 301;
    const height = 257;
    const source = Uint16Array.from(noise(width * height, 65535));
    const png = decodeGreyPng(encodePngGrayscale16(source, width, height));

    expect(png.width).toBe(width);
    expect(png.height).toBe(height);
    expect(png.bitDepth).toBe(16);
    expect(png.colorType).toBe(0);
    expect(png.chunkTypes[0]).toBe('IHDR');
    expect(png.chunkTypes[png.chunkTypes.length - 1]).toBe('IEND');
    expect(Buffer.from(png.samples.buffer).equals(Buffer.from(source.buffer))).toBe(true);
  });

  it('keeps the full 16-bit range, including values that differ only in the low byte', () => {
    const source = Uint16Array.from([0, 1, 255, 256, 257, 32767, 32768, 65534, 65535]);
    const png = decodeGreyPng(encodePngGrayscale16(source, 9, 1));
    expect(Array.from(png.samples)).toEqual(Array.from(source));
  });

  it('round-trips an image larger than one 64 KiB stored block', () => {
    const width = 400;
    const height = 300; // 240,300 raw bytes: several deflate blocks
    const source = Uint16Array.from({ length: width * height }, (_, i) => (i * 37) & 0xffff);
    const png = decodeGreyPng(encodePngGrayscale16(source, width, height));
    expect(Buffer.from(png.samples.buffer).equals(Buffer.from(source.buffer))).toBe(true);
  });

  it('round-trips a 1x1 image', () => {
    const png = decodeGreyPng(encodePngGrayscale16(Uint16Array.from([51234]), 1, 1));
    expect(Array.from(png.samples)).toEqual([51234]);
  });

  it('is rejected by the decoder when a byte of pixel data is corrupted', () => {
    const bytes = encodePngGrayscale16(Uint16Array.from(noise(64, 65535)), 8, 8);
    const corrupted = bytes.slice();
    corrupted[corrupted.length - 30] ^= 0x01;
    expect(() => decodeGreyPng(corrupted)).toThrow();
  });
});

describe('BMP encoders', () => {
  for (const width of [1, 2, 3, 4, 5, 7, 16]) {
    it(`24-bit: round-trips pixels, row order and padding at width ${width}`, () => {
      const height = 5;
      const values = noise(width * height * 4, 255, width);
      const rgba = Uint8ClampedArray.from(values);
      const bmp = decodeBmp(encodeBmpRgb24(rgba, width, height, 300));

      expect(bmp.width).toBe(width);
      expect(bmp.height).toBe(height);
      expect(bmp.bitsPerPixel).toBe(24);
      for (let i = 0; i < width * height; i++) {
        expect([bmp.pixels[i * 3], bmp.pixels[i * 3 + 1], bmp.pixels[i * 3 + 2]]).toEqual([
          rgba[i * 4],
          rgba[i * 4 + 1],
          rgba[i * 4 + 2],
        ]);
      }
      expect(bmp.paddingBytes.every((b) => b === 0)).toBe(true);
      expect(bmp.fileSize).toBe(bmp.dataOffset + Math.ceil((width * 3) / 4) * 4 * height);
    });
  }

  for (const width of [1, 3, 4, 6, 9]) {
    it(`8-bit: round-trips pixels through a linear grey palette at width ${width}`, () => {
      const height = 4;
      const grey = Uint8Array.from(noise(width * height, 255, width + 100));
      const bmp = decodeBmp(encodeBmpGrayscale8(grey, width, height, 254));

      expect(bmp.bitsPerPixel).toBe(8);
      expect(bmp.palette.length).toBe(256 * 4);
      for (let i = 0; i < 256; i++) {
        expect([bmp.palette[i * 4], bmp.palette[i * 4 + 1], bmp.palette[i * 4 + 2]]).toEqual([i, i, i]);
      }
      expect(Array.from(bmp.pixels)).toEqual(Array.from(grey));
      expect(bmp.paddingBytes.every((b) => b === 0)).toBe(true);
    });
  }

  it('writes the resolution as pixels per metre', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    for (const dpi of [72, 254, 300, 600]) {
      const bmp = decodeBmp(encodeBmpRgb24(rgba, 4, 4, dpi));
      const expected = Math.round(dpi / 0.0254);
      expect(bmp.pixelsPerMetreX).toBe(expected);
      expect(bmp.pixelsPerMetreY).toBe(expected);
    }
  });

  it('stores the first image row last (bottom-up)', () => {
    // Top row white, bottom row black.
    const rgba = Uint8ClampedArray.from([255, 255, 255, 255, 0, 0, 0, 255]);
    const bytes = new Uint8Array(encodeBmpRgb24(rgba, 1, 2, 300));
    const offset = new DataView(bytes.buffer).getUint32(10, true);
    expect(bytes[offset]).toBe(0); // first stored row is the bottom row
    expect(bytes[offset + 4]).toBe(255); // second stored row is the top row
  });
});
