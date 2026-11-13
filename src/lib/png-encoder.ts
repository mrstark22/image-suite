/**
 * PNG encoders: 8-bit greyscale, RGB or RGBA for raster export (#17), and
 * 16-bit greyscale for heightmaps.
 *
 * Image data is compressed with the platform's `CompressionStream('deflate')`
 * (a zlib stream, as PNG requires), which browsers, workers and Node provide.
 * Rows are fed to it in chunks, so the whole filtered image never exists at
 * once. Every row uses filter type 0 (None).
 *
 * The resolution is written as a `pHYs` chunk in pixels per metre, rounded to
 * a whole number as the format requires.
 */

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c >>> 0;
}

function computeCrc32(buf: Uint8Array, offset: number, length: number): number {
  let c = 0xffffffff;
  for (let i = 0; i < length; i++) {
    c = crcTable[(c ^ buf[offset + i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Uncompressed bytes of filtered rows sent to the compressor at a time. */
const CHUNK_BYTES = 1 << 20;

/** PNG colour types written here: greyscale, RGB and RGBA. */
export type PngColour = 'grey' | 'rgb' | 'rgba';

const COLOUR_TYPE: Record<PngColour, number> = { grey: 0, rgb: 2, rgba: 6 };
const CHANNELS: Record<PngColour, number> = { grey: 1, rgb: 3, rgba: 4 };

/** Pixels per metre at `pxPerMm`, as `pHYs` and BMP store it. */
export function pixelsPerMetre(pxPerMm: number): number {
  return Math.round(pxPerMm * 1000);
}

interface PngLayout {
  width: number;
  height: number;
  bitDepth: 1 | 8 | 16;
  colourType: number;
  /** Bytes in one row, without its filter byte. */
  rowBytes: number;
  /** Written as `pHYs` when given. */
  pxPerMm?: number;
}

/**
 * Writes one image row's samples into `out` (exactly `rowBytes` long). Called
 * for rows 0 to height - 1 in order.
 */
type RowWriter = (y: number, out: Uint8Array) => void;

/**
 * Called after each chunk of rows with the fraction of rows written. Awaited,
 * so it can yield to other work, and can stop the encode by throwing.
 */
export type EncodeProgress = (fraction: number) => void | Promise<void>;

async function encodePng(layout: PngLayout, writeRow: RowWriter, onProgress?: EncodeProgress): Promise<Uint8Array> {
  const { width, height, rowBytes } = layout;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`Cannot encode a ${width} × ${height} PNG.`);
  }
  const idat = await deflateRows(rowBytes, height, writeRow, onProgress);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = layout.bitDepth;
  ihdr[9] = layout.colourType;
  // Compression 0 (deflate), filter method 0, no interlace.

  const chunks: Array<[string, Uint8Array]> = [['IHDR', ihdr]];
  if (layout.pxPerMm !== undefined) {
    const ppm = pixelsPerMetre(layout.pxPerMm);
    if (!(ppm >= 1 && ppm <= 0x7fffffff)) throw new Error(`Cannot write a resolution of ${layout.pxPerMm} px/mm.`);
    const phys = new Uint8Array(9);
    const physView = new DataView(phys.buffer);
    physView.setUint32(0, ppm, false);
    physView.setUint32(4, ppm, false);
    phys[8] = 1; // unit: metre
    chunks.push(['pHYs', phys]);
  }
  for (const part of idat) chunks.push(['IDAT', part]);
  chunks.push(['IEND', new Uint8Array(0)]);

  const total = 8 + chunks.reduce((n, [, data]) => n + 12 + data.length, 0);
  const png = new Uint8Array(total);
  const view = new DataView(png.buffer);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  let p = 8;
  for (const [type, data] of chunks) {
    view.setUint32(p, data.length, false);
    const typeStart = p + 4;
    for (let i = 0; i < 4; i++) png[typeStart + i] = type.charCodeAt(i);
    png.set(data, typeStart + 4);
    p = typeStart + 4 + data.length;
    view.setUint32(p, computeCrc32(png, typeStart, 4 + data.length), false);
    p += 4;
  }
  return png;
}

/**
 * Filters (type 0) and compresses `height` rows into a zlib stream, returned
 * as the pieces the compressor produced; each becomes one IDAT chunk.
 */
async function deflateRows(
  rowBytes: number,
  height: number,
  writeRow: RowWriter,
  onProgress?: EncodeProgress
): Promise<Uint8Array[]> {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const pieces: Uint8Array[] = [];
  const reading = (async () => {
    const reader = stream.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      pieces.push(value);
    }
  })();
  // Reported by the write or close that fails; do not leave it unhandled meanwhile.
  reading.catch(() => undefined);

  const stride = rowBytes + 1;
  const rowsPerChunk = Math.max(1, Math.floor(CHUNK_BYTES / stride));
  try {
    for (let y = 0; y < height; y += rowsPerChunk) {
      const rows = Math.min(rowsPerChunk, height - y);
      const chunk = new Uint8Array(rows * stride);
      for (let r = 0; r < rows; r++) {
        // chunk[r * stride] stays 0: filter type None.
        writeRow(y + r, chunk.subarray(r * stride + 1, (r + 1) * stride));
      }
      await writer.write(chunk);
      await onProgress?.((y + rows) / height);
    }
    await writer.close();
  } catch (err) {
    await writer.abort(err).catch(() => undefined);
    throw err;
  }
  await reading;
  return pieces;
}

/**
 * Encodes an 8-bit PNG from RGBA8 rows. `readRgba` returns the whole RGBA
 * image (`width * height * 4` bytes); it is called again for every chunk, so
 * it can return a fresh view of memory that may have moved (WebAssembly
 * memory after growth). `colour` picks which channels are written: `grey`
 * writes the red channel and is meant for images whose channels are equal.
 */
export async function encodePng8(
  readRgba: () => Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  colour: PngColour,
  options: { pxPerMm?: number; onProgress?: EncodeProgress } = {}
): Promise<Uint8Array> {
  const channels = CHANNELS[colour];
  if (readRgba().length < width * height * 4) {
    throw new Error(`The pixels are fewer than ${width} × ${height} RGBA.`);
  }
  const writeRow: RowWriter = (y, out) => {
    const rgba = readRgba();
    let s = y * width * 4;
    if (channels === 4) {
      out.set(rgba.subarray(s, s + width * 4));
      return;
    }
    let d = 0;
    for (let x = 0; x < width; x++, s += 4) {
      out[d++] = rgba[s];
      if (channels === 3) {
        out[d++] = rgba[s + 1];
        out[d++] = rgba[s + 2];
      }
    }
  };
  return encodePng(
    { width, height, bitDepth: 8, colourType: COLOUR_TYPE[colour], rowBytes: width * channels, pxPerMm: options.pxPerMm },
    writeRow,
    options.onProgress
  );
}

/**
 * Encodes a 1-bit black-and-white PNG (greyscale, bit depth 1; 1 is white)
 * from RGBA8 rows whose red channel is 0 or 255: a dithered image for
 * LightBurn's Pass-Through mode (#39). `readRgba` is as for `encodePng8`.
 * Throws if any pixel is neither black nor white, rather than guess.
 */
export async function encodePng1(
  readRgba: () => Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: { pxPerMm?: number; onProgress?: EncodeProgress } = {}
): Promise<Uint8Array> {
  if (readRgba().length < width * height * 4) {
    throw new Error(`The pixels are fewer than ${width} × ${height} RGBA.`);
  }
  const writeRow: RowWriter = (y, out) => {
    const rgba = readRgba();
    out.fill(0);
    let s = y * width * 4;
    for (let x = 0; x < width; x++, s += 4) {
      const v = rgba[s];
      if (v === 255) out[x >> 3] |= 0x80 >> (x & 7);
      else if (v !== 0) throw new Error(`Pixel ${x}, ${y} is grey (${v}), not black or white: the image is not dithered.`);
    }
  };
  return encodePng(
    { width, height, bitDepth: 1, colourType: 0, rowBytes: Math.ceil(width / 8), pxPerMm: options.pxPerMm },
    writeRow,
    options.onProgress
  );
}

/**
 * Encodes a 16-bit heightmap buffer into a 16-bit greyscale PNG, writing
 * `pHYs` when `pxPerMm` is given.
 */
export async function encodePngGrayscale16(
  depth16: Uint16Array,
  width: number,
  height: number,
  pxPerMm?: number
): Promise<Uint8Array> {
  if (depth16.length < width * height) {
    throw new Error(`The heightmap has fewer than ${width} × ${height} samples.`);
  }
  const writeRow: RowWriter = (y, out) => {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const z = depth16[row + x];
      // Big-endian 16-bit samples.
      out[x * 2] = (z >>> 8) & 0xff;
      out[x * 2 + 1] = z & 0xff;
    }
  };
  return encodePng({ width, height, bitDepth: 16, colourType: 0, rowBytes: width * 2, pxPerMm }, writeRow);
}
