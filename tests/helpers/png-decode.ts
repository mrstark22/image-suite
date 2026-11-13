/**
 * A small PNG decoder written from the specification, independent of the
 * encoders under test: Node's zlib inflates and computes CRCs. It verifies
 * the signature, every chunk's CRC and the decompressed size, undoes all five
 * filter types, and reads `pHYs`. Non-interlaced greyscale, RGB and RGBA at
 * 1, 8 or 16 bits (1-bit greyscale only).
 */
import zlib from 'zlib';

export interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /** Samples per pixel: 1 (grey), 3 (RGB) or 4 (RGBA). */
  channels: number;
  chunkTypes: string[];
  /** `pHYs`, if present: pixels per unit on each axis and the unit (1 = metre). */
  phys: { x: number; y: number; unit: number } | null;
  /** Every sample, row by row, `channels` per pixel. */
  samples: Uint16Array;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 6: 4 };

export function decodePng(bytes: Uint8Array): DecodedPng {
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
  let phys: DecodedPng['phys'] = null;
  let p = 8;
  while (p < bytes.length) {
    const length = view.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const data = bytes.subarray(p + 8, p + 8 + length);
    const storedCrc = view.getUint32(p + 8 + length);
    const actualCrc = zlib.crc32(bytes.subarray(p + 4, p + 8 + length));
    if (storedCrc !== actualCrc) throw new Error(`Bad CRC in ${type} chunk`);
    chunkTypes.push(type);
    const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (type === 'IHDR') {
      width = d.getUint32(0);
      height = d.getUint32(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw new Error('Unsupported IHDR options');
    } else if (type === 'pHYs') {
      if (length !== 9) throw new Error('Bad pHYs length');
      phys = { x: d.getUint32(0), y: d.getUint32(4), unit: data[8] };
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    p += 12 + length;
  }
  if (p !== bytes.length) throw new Error('Trailing or truncated data');
  const channels = CHANNELS[colorType];
  const oneBit = bitDepth === 1 && colorType === 0;
  if (!channels || (bitDepth !== 8 && bitDepth !== 16 && !oneBit)) throw new Error(`Unsupported colour type ${colorType} / depth ${bitDepth}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (oneBit) {
    // One sample per pixel, 0 or 1, most significant bit first; rows padded to a byte. Filter 0 only.
    const stride1 = Math.ceil(width / 8);
    if (raw.length !== (stride1 + 1) * height) throw new Error('Unexpected decompressed size');
    const samples1 = new Uint16Array(width * height);
    for (let y = 0; y < height; y++) {
      const base = y * (stride1 + 1);
      if (raw[base] !== 0) throw new Error('Only filter type 0 is decoded at 1 bit');
      for (let x = 0; x < width; x++) samples1[y * width + x] = (raw[base + 1 + (x >> 3)] >> (7 - (x & 7))) & 1;
    }
    return { width, height, bitDepth, colorType, channels: 1, chunkTypes, phys, samples: samples1 };
  }
  const bytesPerSample = bitDepth / 8;
  const bpp = channels * bytesPerSample;
  const stride = width * bpp;
  if (raw.length !== (stride + 1) * height) throw new Error('Unexpected decompressed size');

  const samples = new Uint16Array(width * height * channels);
  const prev = new Uint8Array(stride);
  const row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
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
    const n = width * channels;
    for (let s = 0; s < n; s++) {
      samples[y * n + s] = bytesPerSample === 2 ? (row[s * 2] << 8) | row[s * 2 + 1] : row[s];
    }
    prev.set(row);
  }
  return { width, height, bitDepth, colorType, channels, chunkTypes, phys, samples };
}
