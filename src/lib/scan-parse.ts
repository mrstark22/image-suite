/**
 * Reads the points of a 3D scan (#61): STL (binary and ASCII), PLY (ASCII and
 * binary little-endian, vertices with or without faces) and OBJ (vertices).
 * Runs in the scan worker; the file never leaves the browser.
 *
 * Meshes are read as their vertices: the faces only join them, and the
 * measurement works from samples, so a mesh and a point cloud of the same
 * surface give the same result. STL stores each triangle's corners
 * separately, so a corner shared by six triangles is written six times; the
 * copies are merged, or the point count (and the point spacing worked out
 * from it) would be wrong by that factor.
 */

export type ScanFormat = 'stl-binary' | 'stl-ascii' | 'ply-ascii' | 'ply-binary' | 'obj';

export interface ScanPoints {
  /** x, y, z of each point, in the file's own units. */
  xyz: Float32Array;
  count: number;
  format: ScanFormat;
}

export const SCAN_FORMAT_LABEL: Record<ScanFormat, string> = {
  'stl-binary': 'binary STL',
  'stl-ascii': 'ASCII STL',
  'ply-ascii': 'ASCII PLY',
  'ply-binary': 'binary PLY',
  obj: 'OBJ',
};

class Growable {
  data = new Float32Array(3 * 65536);
  n = 0;
  push(x: number, y: number, z: number) {
    if (this.n + 3 > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.n++] = x;
    this.data[this.n++] = y;
    this.data[this.n++] = z;
  }
  done(format: ScanFormat): ScanPoints {
    return { xyz: this.data.slice(0, this.n), count: this.n / 3, format };
  }
}

/** A cursor over ASCII bytes that reads words and numbers without building one big string. */
class Ascii {
  i = 0;
  constructor(readonly b: Uint8Array) {}
  get end() {
    return this.i >= this.b.length;
  }
  skipSpace() {
    const b = this.b;
    while (this.i < b.length && (b[this.i] === 32 || b[this.i] === 9 || b[this.i] === 13)) this.i++;
  }
  /** Moves past the end of the current line. */
  nextLine() {
    const b = this.b;
    while (this.i < b.length && b[this.i] !== 10) this.i++;
    this.i++;
  }
  word(): string {
    this.skipSpace();
    const s = this.i;
    const b = this.b;
    while (this.i < b.length && b[this.i] > 32) this.i++;
    let out = '';
    for (let k = s; k < this.i; k++) out += String.fromCharCode(b[k]);
    return out;
  }
  /** Reads a decimal number such as -1.25e-3; NaN when there is none on the line. */
  number(): number {
    this.skipSpace();
    const b = this.b;
    let i = this.i;
    let sign = 1;
    if (b[i] === 45) {
      sign = -1;
      i++;
    } else if (b[i] === 43) i++;
    let v = 0;
    let digits = 0;
    while (i < b.length && b[i] >= 48 && b[i] <= 57) {
      v = v * 10 + (b[i] - 48);
      i++;
      digits++;
    }
    if (b[i] === 46) {
      i++;
      let f = 0.1;
      while (i < b.length && b[i] >= 48 && b[i] <= 57) {
        v += (b[i] - 48) * f;
        f *= 0.1;
        i++;
        digits++;
      }
    }
    if (digits === 0) return NaN;
    if (b[i] === 101 || b[i] === 69) {
      i++;
      let es = 1;
      if (b[i] === 45) {
        es = -1;
        i++;
      } else if (b[i] === 43) i++;
      let e = 0;
      while (i < b.length && b[i] >= 48 && b[i] <= 57) {
        e = e * 10 + (b[i] - 48);
        i++;
      }
      v *= Math.pow(10, es * e);
    }
    this.i = i;
    return sign * v;
  }
}

function startsWith(b: Uint8Array, text: string, at = 0): boolean {
  for (let k = 0; k < text.length; k++) if (b[at + k] !== text.charCodeAt(k)) return false;
  return true;
}

function lower(name: string): string {
  return name.toLowerCase();
}

/** Reads a scan file. Throws an Error that says what is wrong when it cannot. */
export function parseScan(buffer: ArrayBuffer, fileName: string): ScanPoints {
  const b = new Uint8Array(buffer);
  const name = lower(fileName);
  let out: ScanPoints;
  if (startsWith(b, 'ply')) out = parsePly(b);
  else if (name.endsWith('.stl') || isBinaryStl(b) || startsWith(b, 'solid')) out = parseStl(b);
  else if (name.endsWith('.obj')) out = parseObj(b);
  else throw new Error(`${fileName} is not a scan this tool reads: use STL, PLY or OBJ.`);
  if (out.count < 100) throw new Error(`${fileName} has only ${out.count} points; a scan of a card has many thousands.`);
  return out;
}

function isBinaryStl(b: Uint8Array): boolean {
  if (b.length < 84) return false;
  const n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(80, true);
  return 84 + n * 50 === b.length;
}

function parseStl(b: Uint8Array): ScanPoints {
  if (isBinaryStl(b)) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const n = v.getUint32(80, true);
    const xyz = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) {
      const o = 84 + t * 50 + 12;
      for (let k = 0; k < 9; k++) xyz[t * 9 + k] = v.getFloat32(o + k * 4, true);
    }
    return uniquePoints(xyz, 'stl-binary');
  }
  const a = new Ascii(b);
  const g = new Growable();
  while (!a.end) {
    const w = a.word();
    if (w === 'vertex') {
      const x = a.number();
      const y = a.number();
      const z = a.number();
      if (!Number.isFinite(x + y + z)) throw new Error('This STL has a vertex line that is not three numbers.');
      g.push(x, y, z);
    }
    a.nextLine();
  }
  if (g.n === 0) throw new Error('This STL file has no triangles.');
  return uniquePoints(g.data.subarray(0, g.n), 'stl-ascii');
}

/** The points of `xyz` with exact repeats removed (an STL's shared triangle corners). */
export function uniquePoints(xyz: Float32Array, format: ScanFormat): ScanPoints {
  const n = xyz.length / 3;
  const bits = new Uint32Array(xyz.buffer, xyz.byteOffset, n * 3);
  // Open addressing on the three coordinates' bit patterns.
  let size = 1;
  while (size < n * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1);
  const out = new Float32Array(n * 3);
  const outBits = new Uint32Array(out.buffer);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const a = bits[i * 3];
    const b = bits[i * 3 + 1];
    const c = bits[i * 3 + 2];
    let h = (Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77) ^ Math.imul(c, 0xc2b2ae3d)) >>> 0;
    for (;;) {
      h &= size - 1;
      const j = table[h];
      if (j === -1) {
        table[h] = count;
        outBits[count * 3] = a;
        outBits[count * 3 + 1] = b;
        outBits[count * 3 + 2] = c;
        count++;
        break;
      }
      if (outBits[j * 3] === a && outBits[j * 3 + 1] === b && outBits[j * 3 + 2] === c) break;
      h++;
    }
  }
  return { xyz: out.slice(0, count * 3), count, format };
}

function parseObj(b: Uint8Array): ScanPoints {
  const a = new Ascii(b);
  const g = new Growable();
  while (!a.end) {
    a.skipSpace();
    if (a.b[a.i] === 118 && (a.b[a.i + 1] === 32 || a.b[a.i + 1] === 9)) {
      a.i += 2;
      const x = a.number();
      const y = a.number();
      const z = a.number();
      if (!Number.isFinite(x + y + z)) throw new Error('This OBJ has a vertex line that is not three numbers.');
      g.push(x, y, z);
    }
    a.nextLine();
  }
  if (g.n === 0) throw new Error('This OBJ file has no vertices.');
  return g.done('obj');
}

const PLY_SIZE: Record<string, number> = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };

interface PlyElement {
  name: string;
  count: number;
  props: { name: string; type: string; list?: { countType: string } }[];
}

function readPlyValue(v: DataView, o: number, type: string): number {
  switch (PLY_SIZE[type] === undefined ? '' : type) {
    case 'char':
    case 'int8':
      return v.getInt8(o);
    case 'uchar':
    case 'uint8':
      return v.getUint8(o);
    case 'short':
    case 'int16':
      return v.getInt16(o, true);
    case 'ushort':
    case 'uint16':
      return v.getUint16(o, true);
    case 'int':
    case 'int32':
      return v.getInt32(o, true);
    case 'uint':
    case 'uint32':
      return v.getUint32(o, true);
    case 'float':
    case 'float32':
      return v.getFloat32(o, true);
    case 'double':
    case 'float64':
      return v.getFloat64(o, true);
    default:
      throw new Error(`This PLY uses a value type this tool does not read (${type}).`);
  }
}

function parsePly(b: Uint8Array): ScanPoints {
  const a = new Ascii(b);
  a.nextLine();
  let format = '';
  const elements: PlyElement[] = [];
  for (;;) {
    if (a.end) throw new Error('This PLY header has no end_header line.');
    const w = a.word();
    if (w === 'format') format = a.word();
    else if (w === 'element') elements.push({ name: a.word(), count: a.number(), props: [] });
    else if (w === 'property') {
      const t = a.word();
      const el = elements[elements.length - 1];
      if (!el) throw new Error('This PLY header has a property before any element.');
      if (t === 'list') {
        const countType = a.word();
        const type = a.word();
        el.props.push({ name: a.word(), type, list: { countType } });
      } else el.props.push({ name: a.word(), type: t });
    } else if (w === 'end_header') {
      a.nextLine();
      break;
    }
    a.nextLine();
  }
  const vi = elements.findIndex((e) => e.name === 'vertex');
  if (vi < 0) throw new Error('This PLY has no vertices.');
  const vertex = elements[vi];
  const ix = vertex.props.findIndex((p) => p.name === 'x');
  const iy = vertex.props.findIndex((p) => p.name === 'y');
  const iz = vertex.props.findIndex((p) => p.name === 'z');
  if (ix < 0 || iy < 0 || iz < 0) throw new Error('This PLY’s vertices have no x, y and z.');
  const n = vertex.count;
  const xyz = new Float32Array(n * 3);

  if (format === 'ascii') {
    for (let e = 0; e < vi; e++) for (let k = 0; k < elements[e].count; k++) a.nextLine();
    const vals = new Array<number>(vertex.props.length);
    for (let k = 0; k < n; k++) {
      for (let p = 0; p < vertex.props.length; p++) vals[p] = a.number();
      if (!Number.isFinite(vals[ix] + vals[iy] + vals[iz])) throw new Error(`This PLY ends before its ${n} vertices (vertex ${k + 1} is not a number).`);
      xyz[k * 3] = vals[ix];
      xyz[k * 3 + 1] = vals[iy];
      xyz[k * 3 + 2] = vals[iz];
      a.nextLine();
    }
    return { xyz, count: n, format: 'ply-ascii' };
  }
  if (format !== 'binary_little_endian') throw new Error(`This PLY is ${format || 'of an unknown format'}; this tool reads ASCII and binary little-endian PLY.`);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = a.i;
  for (let e = 0; e < vi; e++) {
    if (elements[e].props.some((p) => p.list)) throw new Error('This PLY stores lists before its vertices; this tool cannot read that layout.');
    o += elements[e].count * elements[e].props.reduce((s, p) => s + PLY_SIZE[p.type], 0);
  }
  if (vertex.props.some((p) => p.list || PLY_SIZE[p.type] === undefined)) throw new Error('This PLY’s vertices have a property this tool cannot read.');
  const offs: number[] = [];
  let stride = 0;
  for (const p of vertex.props) {
    offs.push(stride);
    stride += PLY_SIZE[p.type];
  }
  if (o + n * stride > b.length) throw new Error(`This PLY ends before its ${n} vertices.`);
  const tx = vertex.props[ix].type;
  const ty = vertex.props[iy].type;
  const tz = vertex.props[iz].type;
  const fast = tx === 'float' || tx === 'float32';
  for (let k = 0; k < n; k++, o += stride) {
    if (fast && ty === tx && tz === tx) {
      xyz[k * 3] = v.getFloat32(o + offs[ix], true);
      xyz[k * 3 + 1] = v.getFloat32(o + offs[iy], true);
      xyz[k * 3 + 2] = v.getFloat32(o + offs[iz], true);
    } else {
      xyz[k * 3] = readPlyValue(v, o + offs[ix], tx);
      xyz[k * 3 + 1] = readPlyValue(v, o + offs[iy], ty);
      xyz[k * 3 + 2] = readPlyValue(v, o + offs[iz], tz);
    }
  }
  return { xyz, count: n, format: 'ply-binary' };
}
