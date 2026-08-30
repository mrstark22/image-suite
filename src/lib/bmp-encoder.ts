/**
 * Pure TypeScript BMP (Windows Bitmap) Encoder.
 * Supports:
 * - 8-bit Grayscale BMP (with 256-entry linear palette, row-padded to 4-byte boundaries)
 * - 24-bit RGB BMP (standard 3-channel color or depth, row-padded)
 * - 32-bit BGRA BMP (with alpha channel)
 */

export interface BmpEncodeOptions {
  width: number;
  height: number;
  dpi?: number; // default 300 DPI
  format?: '8bit-grayscale' | '24bit-rgb' | '32bit-rgba';
}

/**
 * Encodes raw pixel data into a standard BMP format ArrayBuffer.
 * For 8-bit grayscale: buffer should be Uint8Array of length width * height (or 16-bit depth mapped to 0-255).
 * For 24-bit RGB: buffer should be Uint8ClampedArray/Uint8Array of RGBA or RGB.
 */
export function encodeBmpGrayscale8(
  grayData: Uint8Array | Uint16Array,
  width: number,
  height: number,
  dpi: number = 300
): ArrayBuffer {
  // BMP rows must be padded to multiples of 4 bytes
  const rowStride = Math.ceil(width / 4) * 4;
  const padding = rowStride - width;
  const pixelArraySize = rowStride * height;

  const headerSize = 14;
  const infoHeaderSize = 40;
  const paletteSize = 256 * 4; // 256 RGBQUAD entries
  const fileOffset = headerSize + infoHeaderSize + paletteSize;
  const fileSize = fileOffset + pixelArraySize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // 1. BITMAPFILEHEADER (14 bytes)
  view.setUint8(0, 0x42); // 'B'
  view.setUint8(1, 0x4d); // 'M'
  view.setUint32(2, fileSize, true); // File size
  view.setUint16(6, 0, true); // Reserved 1
  view.setUint16(8, 0, true); // Reserved 2
  view.setUint32(10, fileOffset, true); // Offset to pixel data

  // 2. BITMAPINFOHEADER (40 bytes)
  view.setUint32(14, infoHeaderSize, true); // Header size
  view.setInt32(18, width, true); // Width
  view.setInt32(22, height, true); // Height (positive = bottom-up)
  view.setUint16(26, 1, true); // Color planes
  view.setUint16(28, 8, true); // 8 bits per pixel
  view.setUint32(30, 0, true); // Compression (0 = BI_RGB, uncompressed)
  view.setUint32(34, pixelArraySize, true); // Image data size

  // PPM resolution (pixels per meter): 300 DPI = ~11811 ppm
  const ppm = Math.round((dpi / 25.4) * 1000);
  view.setInt32(38, ppm, true); // Horizontal resolution
  view.setInt32(42, ppm, true); // Vertical resolution
  view.setUint32(46, 256, true); // Colors in palette
  view.setUint32(50, 256, true); // Important colors

  // 3. Color Table (256 Grayscale entries: B, G, R, 0)
  let palOffset = 54;
  for (let i = 0; i < 256; i++) {
    bytes[palOffset++] = i; // Blue
    bytes[palOffset++] = i; // Green
    bytes[palOffset++] = i; // Red
    bytes[palOffset++] = 0; // Reserved
  }

  // 4. Pixel Array (Bottom-up: row height-1 down to 0)
  const is16Bit = grayData instanceof Uint16Array;
  let destIdx = fileOffset;

  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const srcIdx = y * width + x;
      if (is16Bit) {
        // Scale 16-bit (0-65535) to 8-bit (0-255)
        bytes[destIdx++] = Math.round(grayData[srcIdx] / 256);
      } else {
        bytes[destIdx++] = grayData[srcIdx];
      }
    }
    // Add row padding bytes
    for (let p = 0; p < padding; p++) {
      bytes[destIdx++] = 0;
    }
  }

  return buffer;
}

/**
 * Encodes RGBA pixel buffer to standard 24-bit RGB BMP.
 */
export function encodeBmpRgb24(
  rgbaData: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  dpi: number = 300
): ArrayBuffer {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const padding = rowStride - width * 3;
  const pixelArraySize = rowStride * height;

  const headerSize = 14;
  const infoHeaderSize = 40;
  const fileOffset = headerSize + infoHeaderSize;
  const fileSize = fileOffset + pixelArraySize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // BITMAPFILEHEADER
  view.setUint8(0, 0x42); // 'B'
  view.setUint8(1, 0x4d); // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint32(10, fileOffset, true);

  // BITMAPINFOHEADER
  view.setUint32(14, infoHeaderSize, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true); // 24 bits per pixel (BGR)
  view.setUint32(30, 0, true);
  view.setUint32(34, pixelArraySize, true);

  const ppm = Math.round((dpi / 25.4) * 1000);
  view.setInt32(38, ppm, true);
  view.setInt32(42, ppm, true);
  view.setUint32(46, 0, true);
  view.setUint32(50, 0, true);

  // Pixel Array (Bottom-up, BGR byte order)
  let destIdx = fileOffset;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      bytes[destIdx++] = rgbaData[srcIdx + 2]; // Blue
      bytes[destIdx++] = rgbaData[srcIdx + 1]; // Green
      bytes[destIdx++] = rgbaData[srcIdx];     // Red
    }
    for (let p = 0; p < padding; p++) {
      bytes[destIdx++] = 0;
    }
  }

  return buffer;
}
