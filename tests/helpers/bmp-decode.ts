/**
 * A small BMP decoder written from the format specification, independent of
 * the encoders under test.
 */
export interface DecodedBmp {
  width: number;
  height: number;
  bitsPerPixel: number;
  pixelsPerMetreX: number;
  pixelsPerMetreY: number;
  fileSize: number;
  dataOffset: number;
  palette: Uint8Array;
  /** Top-down rows; one value per pixel for 1-bit (the palette index) and 8-bit, [r, g, b] triples for 24-bit. */
  pixels: Uint8Array;
  paddingBytes: number[];
}

/** Decodes an uncompressed, bottom-up 1-bit, 8-bit or 24-bit BMP. */
export function decodeBmp(buffer: ArrayBuffer): DecodedBmp {
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

  const palette = bytes.slice(14 + infoSize, dataOffset);
  if (bitsPerPixel === 1) {
    const stride1 = Math.ceil(width / 32) * 4;
    const pixels1 = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const rowStart = dataOffset + (height - 1 - y) * stride1;
      for (let x = 0; x < width; x++) pixels1[y * width + x] = (bytes[rowStart + (x >> 3)] >> (7 - (x & 7))) & 1;
    }
    return { width, height, bitsPerPixel, pixelsPerMetreX, pixelsPerMetreY, fileSize, dataOffset, palette, pixels: pixels1, paddingBytes: [] };
  }
  const channels = bitsPerPixel / 8;
  const stride = Math.ceil((width * channels) / 4) * 4;
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
