/**
 * The machine-readable code burned on a photo card (#56): a strip of large
 * square cells, burned for 1 and bare for 0, that a photo of the card can be
 * matched to its stored definition by.
 *
 * 32 bits, read row by row (2 rows of 16):
 * - 2 bits `1 0`, so a strip read all bare or all burned is never valid;
 * - 2 bits of card kind;
 * - 20 bits of short id, 5 bits per character of `ID_CHARS`;
 * - 8 bits of CRC-8 (polynomial 0x07, start 0xFF) over the 24 bits before it.
 *
 * Large cells (2.5 mm) and a checksum instead of a dense code such as QR:
 * a burned code has soft edges and a phone photo is often slightly blurred,
 * and the card only has to say which stored card it is. The machine,
 * material and settings come from that stored card, and are also burned in
 * the card's lettering for a person to read.
 */
import type { CardKind } from '../types/calibration-card';

/** The characters of a short id: none that read alike (no 0/O, 1/I). */
export const ID_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export const CODE_COLS = 16;
export const CODE_ROWS = 2;
export const CODE_BITS = CODE_COLS * CODE_ROWS;

const KINDS: CardKind[] = ['engrave-grid', 'engrave-tone', 'cut', 'relief'];

function crc8(bits: readonly number[]): number {
  let crc = 0xff;
  for (const b of bits) {
    const top = (crc >> 7) & 1;
    crc = (crc << 1) & 0xff;
    if (top ^ b) crc ^= 0x07;
  }
  return crc;
}

const toBits = (value: number, n: number) => Array.from({ length: n }, (_, i) => (value >> (n - 1 - i)) & 1);
const fromBits = (bits: readonly number[]) => bits.reduce((v, b) => v * 2 + b, 0);

/** The 32 bits for a card: 1 is burned. */
export function encodeCardCode(kind: CardKind, shortId: string): number[] {
  if (shortId.length !== 4) throw new Error(`A card's short id has 4 characters, not "${shortId}".`);
  const data = [1, 0, ...toBits(KINDS.indexOf(kind), 2)];
  for (const ch of shortId) {
    const v = ID_CHARS.indexOf(ch);
    if (v < 0) throw new Error(`"${ch}" cannot be in a card's short id.`);
    data.push(...toBits(v, 5));
  }
  return [...data, ...toBits(crc8(data), 8)];
}

/** The card a strip of 32 bits names, or null when they are not a valid code. */
export function decodeCardCode(bits: readonly number[]): { kind: CardKind; shortId: string } | null {
  if (bits.length !== CODE_BITS || bits[0] !== 1 || bits[1] !== 0) return null;
  const data = bits.slice(0, 24);
  if (crc8(data) !== fromBits(bits.slice(24))) return null;
  const kind = KINDS[fromBits(data.slice(2, 4))];
  let shortId = '';
  for (let i = 0; i < 4; i++) shortId += ID_CHARS[fromBits(data.slice(4 + i * 5, 9 + i * 5))];
  return { kind, shortId };
}
