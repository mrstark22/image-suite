/**
 * High-performance 16-bit Grayscale PNG Encoder for CNC & CAM Heightmap Export.
 * Generates lossless 16-bit (65,536 discrete depth levels) PNGs compatible with:
 * - Vectric Aspire / VCarve
 * - Carbide Create Pro
 * - CarveCo
 * - LightBurn 3D Sliced Laser Relief
 * - Blender Displace Modifier
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

function adler32(buf: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * Encodes uncompressed / fast deflate zlib block for PNG IDAT
 */
function createZlibBlocks(rawScanlines: Uint8Array): Uint8Array {
  // Use uncompressed deflate blocks for maximum speed and zero dependencies
  // Max uncompressed block size is 65535 bytes
  const MAX_BLOCK_SIZE = 65535;
  const numBlocks = Math.ceil(rawScanlines.length / MAX_BLOCK_SIZE) || 1;
  const totalZlibSize = 2 + numBlocks * 5 + rawScanlines.length + 4;

  const out = new Uint8Array(totalZlibSize);
  let outIdx = 0;

  // Zlib Header: CMF (0x78 = 32K window, deflate) + FLG (0x01 = check bits)
  out[outIdx++] = 0x78;
  out[outIdx++] = 0x01;

  let inOffset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const isLast = b === numBlocks - 1;
    const blockSize = Math.min(MAX_BLOCK_SIZE, rawScanlines.length - inOffset);

    // BFINAL (1 bit) + BTYPE (00 = uncompressed, 2 bits)
    out[outIdx++] = isLast ? 0x01 : 0x00;

    // LEN (16-bit little-endian)
    out[outIdx++] = blockSize & 0xff;
    out[outIdx++] = (blockSize >>> 8) & 0xff;

    // NLEN (one's complement of LEN)
    const nlen = ~blockSize & 0xffff;
    out[outIdx++] = nlen & 0xff;
    out[outIdx++] = (nlen >>> 8) & 0xff;

    // Data payload
    out.set(rawScanlines.subarray(inOffset, inOffset + blockSize), outIdx);
    outIdx += blockSize;
    inOffset += blockSize;
  }

  // Adler-32 Checksum (big-endian)
  const checksum = adler32(rawScanlines);
  out[outIdx++] = (checksum >>> 24) & 0xff;
  out[outIdx++] = (checksum >>> 16) & 0xff;
  out[outIdx++] = (checksum >>> 8) & 0xff;
  out[outIdx++] = checksum & 0xff;

  return out;
}

/**
 * Encodes a 16-bit heightmap buffer into a 16-bit Grayscale PNG.
 */
export function encodePngGrayscale16(
  depth16: Uint16Array,
  width: number,
  height: number
): Uint8Array {
  // Raw scanline format: 1 filter byte (0x00 = None) + width * 2 bytes per row (big-endian)
  const scanlineLength = 1 + width * 2;
  const rawScanlines = new Uint8Array(scanlineLength * height);

  let rawIdx = 0;
  for (let y = 0; y < height; y++) {
    rawScanlines[rawIdx++] = 0x00; // Filter: None
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const z = depth16[rowOffset + x];
      // Big-endian 16-bit uint
      rawScanlines[rawIdx++] = (z >>> 8) & 0xff;
      rawScanlines[rawIdx++] = z & 0xff;
    }
  }

  // Compress into zlib stream
  const idatPayload = createZlibBlocks(rawScanlines);

  // PNG chunks: Signature (8) + IHDR (25) + IDAT (12 + payload) + IEND (12)
  const totalFileSize = 8 + 25 + (12 + idatPayload.length) + 12;
  const png = new Uint8Array(totalFileSize);
  const view = new DataView(png.buffer);
  let p = 0;

  // 1. PNG Signature
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], p);
  p += 8;

  // 2. IHDR Chunk (13 bytes payload)
  view.setUint32(p, 13, false); // Length
  p += 4;
  const ihdrStart = p;
  png.set([0x49, 0x48, 0x44, 0x52], p); // "IHDR"
  p += 4;
  view.setUint32(p, width, false);
  p += 4;
  view.setUint32(p, height, false);
  p += 4;
  png[p++] = 16; // 16 bits per sample
  png[p++] = 0;  // Color type 0 (Grayscale)
  png[p++] = 0;  // Compression method (0 = deflate)
  png[p++] = 0;  // Filter method (0 = standard)
  png[p++] = 0;  // Interlace (0 = no interlace)

  const ihdrCrc = computeCrc32(png, ihdrStart, p - ihdrStart);
  view.setUint32(p, ihdrCrc, false);
  p += 4;

  // 3. IDAT Chunk
  view.setUint32(p, idatPayload.length, false);
  p += 4;
  const idatStart = p;
  png.set([0x49, 0x44, 0x41, 0x54], p); // "IDAT"
  p += 4;
  png.set(idatPayload, p);
  p += idatPayload.length;

  const idatCrc = computeCrc32(png, idatStart, p - idatStart);
  view.setUint32(p, idatCrc, false);
  p += 4;

  // 4. IEND Chunk
  view.setUint32(p, 0, false); // Length
  p += 4;
  const iendStart = p;
  png.set([0x49, 0x45, 0x4e, 0x44], p); // "IEND"
  p += 4;
  const iendCrc = computeCrc32(png, iendStart, p - iendStart);
  view.setUint32(p, iendCrc, false);
  p += 4;

  return png;
}
