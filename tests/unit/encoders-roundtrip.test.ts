/**
 * Round-trip tests for the hand-written PNG and BMP encoders.
 *
 * Each file is decoded by a small decoder written from the format
 * specifications (tests/helpers/png-decode.ts and bmp-decode.ts), and every sample is
 * compared with the source. A corrupt pixel, CRC, length or header fails.
 */
import { describe, it, expect } from 'vitest';
import { encodePng8, encodePngGrayscale16, type PngColour } from '../../src/lib/png-encoder';
import { decodePng } from '../helpers/png-decode';
import { decodeBmp } from '../helpers/bmp-decode';
import { encodeBmpGrayscale8, encodeBmpRgb24 } from '../../src/lib/bmp-encoder';

/** Deterministic pseudo-random values in [0, max]. */
function noise(count: number, max: number, seed = 7): number[] {
  let s = seed;
  return Array.from({ length: count }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % (max + 1);
  });
}

describe('16-bit greyscale PNG encoder', async () => {
  it('round-trips every sample of a pseudo-random image through an independent decoder', async () => {
    const width = 301;
    const height = 257;
    const source = Uint16Array.from(noise(width * height, 65535));
    const png = decodePng(await encodePngGrayscale16(source, width, height));

    expect(png.width).toBe(width);
    expect(png.height).toBe(height);
    expect(png.bitDepth).toBe(16);
    expect(png.colorType).toBe(0);
    expect(png.chunkTypes[0]).toBe('IHDR');
    expect(png.chunkTypes[png.chunkTypes.length - 1]).toBe('IEND');
    expect(Buffer.from(png.samples.buffer).equals(Buffer.from(source.buffer))).toBe(true);
  });

  it('keeps the full 16-bit range, including values that differ only in the low byte', async () => {
    const source = Uint16Array.from([0, 1, 255, 256, 257, 32767, 32768, 65534, 65535]);
    const png = decodePng(await encodePngGrayscale16(source, 9, 1));
    expect(Array.from(png.samples)).toEqual(Array.from(source));
  });

  it('round-trips a 400x300 image', async () => {
    const width = 400;
    const height = 300;
    const source = Uint16Array.from({ length: width * height }, (_, i) => (i * 37) & 0xffff);
    const png = decodePng(await encodePngGrayscale16(source, width, height));
    expect(Buffer.from(png.samples.buffer).equals(Buffer.from(source.buffer))).toBe(true);
  });

  it('round-trips a 1x1 image', async () => {
    const png = decodePng(await encodePngGrayscale16(Uint16Array.from([51234]), 1, 1));
    expect(Array.from(png.samples)).toEqual([51234]);
  });

  it('is rejected by the decoder when a byte of pixel data is corrupted', async () => {
    const bytes = await encodePngGrayscale16(Uint16Array.from(noise(64, 65535)), 8, 8);
    const corrupted = bytes.slice();
    corrupted[corrupted.length - 30] ^= 0x01;
    expect(() => decodePng(corrupted)).toThrow();
  });
});

describe('8-bit PNG encoder', () => {
  const CHANNELS: Record<PngColour, number> = { grey: 1, rgb: 3, rgba: 4 };
  const COLOUR_TYPE: Record<PngColour, number> = { grey: 0, rgb: 2, rgba: 6 };

  for (const colour of ['grey', 'rgb', 'rgba'] as const) {
    for (const [width, height] of [
      [1, 1],
      [3, 2],
      [7, 5],
      [301, 257],
    ]) {
      it(`${colour}: every byte of a pseudo-random ${width}x${height} image survives an independent inflate and decoder`, async () => {
        const rgba = Uint8Array.from(noise(width * height * 4, 255, width * 13 + height));
        const png = decodePng(await encodePng8(() => rgba, width, height, colour));
        const channels = CHANNELS[colour];
        expect([png.width, png.height, png.bitDepth, png.colorType]).toEqual([width, height, 8, COLOUR_TYPE[colour]]);
        expect(png.chunkTypes[0]).toBe('IHDR');
        expect(png.chunkTypes[png.chunkTypes.length - 1]).toBe('IEND');
        let mismatches = 0;
        for (let i = 0; i < width * height; i++) {
          // Grey writes the red channel; RGB drops alpha.
          for (let c = 0; c < channels; c++) if (png.samples[i * channels + c] !== rgba[i * 4 + c]) mismatches++;
        }
        expect(mismatches).toBe(0);
      });
    }
  }

  it('round-trips an image of several chunks of rows, reading the pixels afresh for each', async () => {
    // 1100 x 400 RGBA is 1.76 MB of rows: two chunks.
    const width = 1100;
    const height = 400;
    const rgba = Uint8Array.from(noise(width * height * 4, 255, 3));
    let reads = 0;
    const fractions: number[] = [];
    const png = decodePng(
      await encodePng8(
        () => {
          reads++;
          return rgba;
        },
        width,
        height,
        'rgba',
        { onProgress: (f) => void fractions.push(f) }
      )
    );
    expect(Buffer.from(Uint8Array.from(png.samples)).equals(Buffer.from(rgba))).toBe(true);
    expect(fractions.length).toBe(2);
    expect(fractions[1]).toBe(1);
    expect(reads).toBeGreaterThan(height);
  });

  it('writes pHYs in whole pixels per metre, in metres, before the image data', async () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(255);
    for (const [pxPerMm, ppm] of [
      [300 / 25.4, 11811],
      [10, 10000],
      [72 / 25.4, 2835],
      [1 / 0.0847, 11806],
    ]) {
      const png = decodePng(await encodePng8(() => rgba, 4, 4, 'grey', { pxPerMm }));
      expect(png.phys).toEqual({ x: ppm, y: ppm, unit: 1 });
      expect(png.chunkTypes.slice(0, 3)).toEqual(['IHDR', 'pHYs', 'IDAT']);
    }
    const without = decodePng(await encodePng8(() => rgba, 4, 4, 'grey'));
    expect(without.phys).toBeNull();
  });

  it('compresses: a flat 1000x1000 image is a small fraction of its raw size', async () => {
    const rgba = new Uint8Array(1000 * 1000 * 4).fill(255);
    const bytes = await encodePng8(() => rgba, 1000, 1000, 'grey');
    expect(bytes.length).toBeLessThan(1000 * 1000 * 0.01);
    expect(decodePng(bytes).samples.every((v) => v === 255)).toBe(true);
  });

  it('stops, rejecting, when the progress callback throws', async () => {
    const rgba = new Uint8Array(1100 * 400 * 4);
    const encoding = encodePng8(() => rgba, 1100, 400, 'rgba', {
      onProgress: () => {
        throw new Error('stop');
      },
    });
    await expect(encoding).rejects.toThrow('stop');
  });
});

describe('16-bit PNG resolution', () => {
  it('writes pHYs when given a resolution', async () => {
    const png = decodePng(await encodePngGrayscale16(new Uint16Array(4), 2, 2, 254 / 25.4));
    expect(png.phys).toEqual({ x: 10000, y: 10000, unit: 1 });
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
