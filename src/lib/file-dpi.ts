/**
 * Reads the resolution an image file claims, from PNG `pHYs` or from a JPEG's
 * JFIF header or EXIF IFD0. The result is only ever offered as a suggestion:
 * many files say 72 or 96 DPI whatever their real size.
 *
 * Returns `null` when the file states no resolution, states an aspect ratio
 * only (PNG unit 0, JFIF unit 0), or is not a PNG or JPEG.
 */
export function readFileDpi(bytes: Uint8Array): number | null {
  if (isPng(bytes)) return pngDpi(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegDpi(bytes);
  return null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const INCHES_PER_METRE = 1 / 0.0254;

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

function positive(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function pngDpi(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const data = pos + 8;
    if (type === 'pHYs' && length >= 9 && data + 9 <= bytes.length) {
      const pxPerUnitX = view.getUint32(data);
      const unit = bytes[data + 8];
      // Unit 1 is the metre; unit 0 gives only the pixel aspect ratio.
      return unit === 1 ? positive(pxPerUnitX / INCHES_PER_METRE) : null;
    }
    // pHYs must come before the image data.
    if (type === 'IDAT' || type === 'IEND') return null;
    pos = data + length + 4;
  }
  return null;
}

function jpegDpi(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let exifDpi: number | null = null;
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return exifDpi;
    const marker = bytes[pos + 1];
    // Start of scan or end of image: no more headers.
    if (marker === 0xda || marker === 0xd9) return exifDpi;
    const length = view.getUint16(pos + 2);
    const data = pos + 4;
    const end = pos + 2 + length;
    if (end > bytes.length) return exifDpi;

    if (marker === 0xe0 && matches(bytes, data, 'JFIF\0') && data + 12 <= end) {
      const units = bytes[data + 7];
      const xDensity = view.getUint16(data + 8);
      if (units === 1) return positive(xDensity);
      if (units === 2) return positive(xDensity * 2.54);
    } else if (marker === 0xe1 && matches(bytes, data, 'Exif\0\0')) {
      exifDpi = exifResolution(view, data + 6, end);
    }
    pos = end;
  }
  return exifDpi;
}

function matches(bytes: Uint8Array, at: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (bytes[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/** XResolution and ResolutionUnit from the first IFD of the TIFF block at `tiff`. */
function exifResolution(view: DataView, tiff: number, end: number): number | null {
  if (tiff + 8 > end) return null;
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > end) return null;
  const count = view.getUint16(ifd, little);
  let xResolution: number | null = null;
  let unit = 2; // inches, the EXIF default
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    const tag = view.getUint16(entry, little);
    if (tag === 0x011a) {
      const at = tiff + view.getUint32(entry + 8, little);
      if (at + 8 > end) continue;
      const denominator = view.getUint32(at + 4, little);
      if (denominator !== 0) xResolution = view.getUint32(at, little) / denominator;
    } else if (tag === 0x0128) {
      unit = view.getUint16(entry + 8, little);
    }
  }
  if (xResolution === null) return null;
  if (unit === 2) return positive(xResolution);
  if (unit === 3) return positive(xResolution * 2.54);
  return null;
}
