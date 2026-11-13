/**
 * Generates the blue-noise threshold mask used by the Blue noise dither (#38)
 * with Ulichney's void-and-cluster method (Ulichney 1993, "The
 * void-and-cluster method for dither array generation"), and writes it to
 * src/wasm/src/blue_noise_128.bin: 128 x 128 ranks, 0 to 16383, as
 * little-endian u16, row by row. The Rust core embeds that file; this script
 * only has to run again if the mask is to change. It is deterministic.
 *
 *   node scripts/generate-blue-noise.mjs
 *
 * The mask is periodic (every distance is measured on a torus), so tiles of it
 * join without a seam.
 */
import { writeFileSync } from 'node:fs';

const SIZE = 128;
const N = SIZE * SIZE;
const SIGMA = 1.5;
const OUT = 'src/wasm/src/blue_noise_128.bin';

// Gaussian energy kernel over the whole torus, indexed by wrapped offset.
const kernel = new Float64Array(N);
for (let dy = 0; dy < SIZE; dy++) {
  for (let dx = 0; dx < SIZE; dx++) {
    const wx = Math.min(dx, SIZE - dx);
    const wy = Math.min(dy, SIZE - dy);
    kernel[dy * SIZE + dx] = Math.exp(-(wx * wx + wy * wy) / (2 * SIGMA * SIGMA));
  }
}

/** Adds `sign` times the kernel centred on `p` to `energy`. */
function splat(energy, p, sign) {
  const px = p % SIZE;
  const py = (p / SIZE) | 0;
  for (let y = 0; y < SIZE; y++) {
    const ky = ((y - py + SIZE) % SIZE) * SIZE;
    const row = y * SIZE;
    for (let x = 0; x < SIZE; x++) energy[row + x] += sign * kernel[ky + ((x - px + SIZE) % SIZE)];
  }
}

/** Tightest cluster: the set pixel (`bits[i]` true) of highest energy. */
function tightestCluster(bits, energy) {
  let best = -1;
  let bestE = -Infinity;
  for (let i = 0; i < N; i++) if (bits[i] && energy[i] > bestE) { bestE = energy[i]; best = i; }
  return best;
}

/** Largest void: the unset pixel of lowest energy. */
function largestVoid(bits, energy) {
  let best = -1;
  let bestE = Infinity;
  for (let i = 0; i < N; i++) if (!bits[i] && energy[i] < bestE) { bestE = energy[i]; best = i; }
  return best;
}

// A fixed pseudo-random initial pattern (xorshift32, fixed seed), ~10% set.
let seed = 0x9e3779b9;
const rand = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 0x100000000;
};
const initialCount = Math.round(N * 0.1);
const bits = new Uint8Array(N);
let placed = 0;
while (placed < initialCount) {
  const i = Math.floor(rand() * N);
  if (!bits[i]) { bits[i] = 1; placed++; }
}

const energy = new Float64Array(N);
for (let i = 0; i < N; i++) if (bits[i]) splat(energy, i, 1);

// Relax the initial pattern: move the tightest cluster into the largest void until stable.
for (;;) {
  const c = tightestCluster(bits, energy);
  bits[c] = 0; splat(energy, c, -1);
  const v = largestVoid(bits, energy);
  if (v === c) { bits[c] = 1; splat(energy, c, 1); break; }
  bits[v] = 1; splat(energy, v, 1);
}

const rank = new Int32Array(N).fill(-1);
const prototype = bits.slice();
const protoEnergy = energy.slice();

// Phase 1: rank the initial ones, removing tightest clusters.
{
  const b = prototype.slice();
  const e = protoEnergy.slice();
  for (let r = initialCount - 1; r >= 0; r--) {
    const c = tightestCluster(b, e);
    b[c] = 0; splat(e, c, -1);
    rank[c] = r;
  }
}
// Phases 2 and 3: fill the largest voids up to all ones. Past half, finding
// the tightest cluster of zeros is the same as the largest void of ones.
{
  const b = prototype;
  const e = protoEnergy;
  for (let r = initialCount; r < N; r++) {
    const v = largestVoid(b, e);
    b[v] = 1; splat(e, v, 1);
    rank[v] = r;
  }
}

const out = Buffer.alloc(N * 2);
for (let i = 0; i < N; i++) {
  if (rank[i] < 0) throw new Error('unranked pixel');
  out.writeUInt16LE(rank[i], i * 2);
}
writeFileSync(OUT, out);
console.log(`Wrote ${OUT}`);
