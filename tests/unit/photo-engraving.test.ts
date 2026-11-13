/**
 * The photo engraving workflow (#34, #36, #37, #38, #39, #41): each test
 * measures the defining property of what it covers, on the compiled core or
 * on the decoded file.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DITHER, grayImage, loadWasm, runPipeline, whiteFraction, type Wasm } from '../helpers/wasm';
import { useDocumentStore } from '../../src/store/documentStore';
import { setDither, setScale, setTonal, DEFAULT_DITHER } from '../../src/lib/document';
import { dotGridTarget, exportPlan, photoPreviewTarget, MAX_DOT_GRID_PREVIEW_PIXELS } from '../../src/lib/render-target';
import { applyProfileDither, profileDither, setDotPitch } from '../../src/lib/profile-dither';
import { burnSimulationSettings } from '../../src/lib/burn-simulation';
import { exportRaster } from '../../src/lib/raster-export';
import type { Calibration, Machine } from '../../src/types/profiles';
import { currentDoc, decodedImage, labelledImage, resetStores } from '../helpers/documents';
import { loadPixels, startTestPipeline, type TestPipeline } from '../helpers/pipeline';
import { decodePng } from '../helpers/png-decode';
import { decodeBmp } from '../helpers/bmp-decode';

const store = () => useDocumentStore.getState();

let wasm: Wasm;
beforeAll(async () => {
  wasm = await loadWasm();
});

const ALL_DITHERS = [
  ['Floyd-Steinberg', DITHER.floydSteinberg],
  ['Atkinson', DITHER.atkinson],
  ['Jarvis', DITHER.jarvis],
  ['Bayer 2x2', DITHER.bayer2],
  ['Bayer 4x4', DITHER.bayer4],
  ['Bayer 8x8', DITHER.bayer8],
  ['Blue noise', DITHER.blueNoise],
] as const;

describe('blue noise (#38)', () => {
  const MASK = 128;

  it('the shipped mask holds every rank 0 to 16383 exactly once', () => {
    const bytes = fs.readFileSync(path.resolve(__dirname, '../../src/wasm/src/blue_noise_128.bin'));
    expect(bytes.length).toBe(MASK * MASK * 2);
    const seen = new Uint8Array(MASK * MASK);
    for (let i = 0; i < MASK * MASK; i++) seen[bytes.readUInt16LE(i * 2)]++;
    expect(seen.every((n) => n === 1)).toBe(true);
  });

  it('matches the input tone: mean density within 0.5% across the range', () => {
    for (let g = 0; g <= 255; g += 15) {
      const out = runPipeline(wasm, grayImage(MASK, MASK, () => g), MASK, MASK, { dither: DITHER.blueNoise });
      expect(Math.abs(whiteFraction(out) - g / 255), `grey ${g}`).toBeLessThan(0.005);
    }
  });

  /** Radially averaged power spectrum of a 0/1 image, by separable DFT; returns [low, high] mean power. */
  function lowHighPower(bits: Float64Array, n: number): [number, number] {
    const mean = bits.reduce((a, b) => a + b, 0) / bits.length;
    const re = new Float64Array(n * n);
    const im = new Float64Array(n * n);
    for (let i = 0; i < n * n; i++) re[i] = bits[i] - mean;
    const cos = Array.from({ length: n }, (_, k) => Math.cos((2 * Math.PI * k) / n));
    const sin = Array.from({ length: n }, (_, k) => Math.sin((2 * Math.PI * k) / n));
    const pass = (rowMajor: boolean) => {
      const r2 = new Float64Array(n);
      const i2 = new Float64Array(n);
      for (let a = 0; a < n; a++) {
        for (let k = 0; k < n; k++) {
          let sr = 0;
          let si = 0;
          for (let b = 0; b < n; b++) {
            const idx = rowMajor ? a * n + b : b * n + a;
            const t = (k * b) % n;
            sr += re[idx] * cos[t] + im[idx] * sin[t];
            si += im[idx] * cos[t] - re[idx] * sin[t];
          }
          r2[k] = sr;
          i2[k] = si;
        }
        for (let k = 0; k < n; k++) {
          const idx = rowMajor ? a * n + k : k * n + a;
          re[idx] = r2[k];
          im[idx] = i2[k];
        }
      }
    };
    pass(true);
    pass(false);
    let low = 0, lowN = 0, high = 0, highN = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const fx = Math.min(x, n - x);
        const fy = Math.min(y, n - y);
        const r = Math.hypot(fx, fy);
        if (r === 0) continue;
        const p = re[y * n + x] ** 2 + im[y * n + x] ** 2;
        if (r < n / 8) { low += p; lowN++; }
        else if (r > n / 4) { high += p; highN++; }
      }
    }
    return [low / lowN, high / highN];
  }

  it('is blue: a 50% grey render has little energy at low frequencies, unlike white noise', () => {
    const out = runPipeline(wasm, grayImage(MASK, MASK, () => 127.5), MASK, MASK, { dither: DITHER.blueNoise });
    const bits = Float64Array.from({ length: MASK * MASK }, (_, i) => (out[i * 4] === 255 ? 1 : 0));
    const [low, high] = lowHighPower(bits, MASK);
    expect(low / high).toBeLessThan(0.15);

    // The same measure on white noise (a fixed pseudo-random pattern) is about 1.
    let seed = 12345;
    const white = Float64Array.from({ length: MASK * MASK }, () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648 < 0.5 ? 1 : 0;
    });
    const [wl, wh] = lowHighPower(white, MASK);
    expect(wl / wh).toBeGreaterThan(0.6);
  }, 30000);

  it('shows no seam where the mask tiles: neighbours across a tile edge differ as often as inside a tile', () => {
    const n = MASK * 2;
    for (const g of [64, 128, 192]) {
      const out = runPipeline(wasm, grayImage(n, n, () => g), n, n, { dither: DITHER.blueNoise });
      const at = (x: number, y: number) => out[(y * n + x) * 4];
      // Fraction of horizontal neighbour pairs that differ, at the seam column and on average elsewhere.
      const differ = (x: number) => {
        let d = 0;
        for (let y = 0; y < n; y++) if (at(x, y) !== at(x + 1, y)) d++;
        return d / n;
      };
      let inside = 0;
      for (let x = 0; x < n - 1; x++) if (x !== MASK - 1) inside += differ(x);
      inside /= n - 2;
      expect(Math.abs(differ(MASK - 1) - inside), `grey ${g}`).toBeLessThan(0.08);
    }
  });
});

describe('pure white and pure black stay pure (#37)', () => {
  it('under every dither, scan direction, pattern size and tone curve', () => {
    const curves = [undefined, [0, 0.8, 0.9, 1], [0.1, 0.3, 0.3, 0.6, 0.6]];
    for (const [name, code] of ALL_DITHERS) {
      for (const serpentine of [true, false]) {
        for (const ditherScale of [1, 2, 4]) {
          for (const toneCurve of curves) {
            const o = { dither: code, serpentine, ditherScale, toneCurve };
            const white = runPipeline(wasm, grayImage(37, 23, () => 255), 37, 23, o);
            const black = runPipeline(wasm, grayImage(37, 23, () => 0), 37, 23, o);
            expect(whiteFraction(white), `${name} white`).toBe(1);
            expect(whiteFraction(black), `${name} black`).toBe(0);
          }
        }
      }
    }
  });
});

describe('tone curve before the dither (#39)', () => {
  it("a material that darkens fast gets fewer dots: 40% darkness asked of [0, .8, .9, 1] needs a light burn", () => {
    const g = 153; // asks for 40% of the material's darkness
    const plain = runPipeline(wasm, grayImage(128, 128, () => g), 128, 128, { dither: DITHER.blueNoise });
    const curved = runPipeline(wasm, grayImage(128, 128, () => g), 128, 128, { dither: DITHER.blueNoise, toneCurve: [0, 0.8, 0.9, 1] });
    expect(whiteFraction(plain)).toBeCloseTo(0.6, 1);
    // Darkness 0.4 is reached half way up the first step (0 to 0.8): level 0.5 of 3, so 5/6 white.
    expect(whiteFraction(curved)).toBeCloseTo(1 - 0.5 / 3, 1);
  });

  it('a linear curve changes nothing', () => {
    const img = grayImage(64, 64, (x, y) => (x * 4 + y) % 256);
    const plain = runPipeline(wasm, img, 64, 64, { dither: DITHER.jarvis, serpentine: true });
    const linear = runPipeline(wasm, img, 64, 64, { dither: DITHER.jarvis, serpentine: true, toneCurve: [0, 0.25, 0.5, 0.75, 1] });
    expect(Buffer.from(linear).equals(Buffer.from(plain))).toBe(true);
  });
});

describe('CLAHE at any size (#36)', () => {
  it('keeps pure white white and flat grey flat for sizes not divisible by the grid', () => {
    for (const [w, h] of [[401, 299], [37, 53], [5, 3]]) {
      for (const grid of [4, 8, 24]) {
        const white = runPipeline(wasm, grayImage(w, h, () => 255), w, h, { clahe: { clip: 2.5, grid } });
        expect(whiteFraction(white), `${w}x${h} grid ${grid}`).toBe(1);
        const grey = runPipeline(wasm, grayImage(w, h, () => 100), w, h, { clahe: { clip: 3, grid } });
        const values = new Set<number>();
        for (let i = 0; i < w * h; i++) values.add(grey[i * 4]);
        expect(values.size, `${w}x${h} grid ${grid}`).toBe(1);
      }
    }
  });
});

describe('the dot grid (#34)', () => {
  beforeEach(() => resetStores());

  it('a 100 mm job is 1000 dots wide at 0.1 mm and 500 at 0.2 mm', () => {
    store().open(decodedImage(3000, 2000), 100 / 3000);
    const at = (mm: number) => exportPlan(setDotPitch(mm, profileDither(null, null))(currentDoc()));
    expect(at(0.1).target).toEqual({ widthPx: 1000, heightPx: 667 });
    expect(at(0.2).target).toEqual({ widthPx: 500, heightPx: 333 });
    expect(at(0.1).dpi).toBeCloseTo(254, 9);
    expect(at(0.2).dpi).toBeCloseTo(127, 9);
    expect(at(0.2).widthMm).toBeCloseTo(100, 9);
  });

  it('pixel count is size over pitch, independent of the source resolution', () => {
    for (const sourceWidth of [400, 1234, 6000]) {
      resetStores();
      store().open(decodedImage(sourceWidth, sourceWidth), 80 / sourceWidth);
      expect(dotGridTarget(currentDoc())).toEqual({ widthPx: 800, heightPx: 800 });
    }
  });

  it('applies only to a dithered image with a size; the preview shows the grid dot for dot up to its limit', () => {
    store().open(decodedImage(3000, 2000), 100 / 3000);
    expect(photoPreviewTarget(currentDoc())).toEqual({ target: { widthPx: 1000, heightPx: 667 }, exact: true });
    store().edit(setDither({ algorithm: 'none' }));
    expect(dotGridTarget(currentDoc())).toBeNull();
    store().edit(setDither({ algorithm: 'jarvis' }));
    store().edit(setScale(1)); // 3 m wide: 30,000 dots across
    const big = photoPreviewTarget(currentDoc());
    expect(big.exact).toBe(false);
    expect(big.target.widthPx * big.target.heightPx).toBeLessThanOrEqual(MAX_DOT_GRID_PREVIEW_PIXELS);
  });

  it('follows the calibration, then the machine, then the 0.1 mm default; a pitch set by hand stays', () => {
    const machine = { name: '60 W CO2', lineIntervalMm: 0.08, spotSizeMm: null } as Machine;
    const calibration = { lineIntervalMm: 0.12, toneCurve: [0, 0.5, 1] } as Calibration;
    expect(profileDither(machine, calibration)).toEqual({ dotPitchMm: 0.12, dotPitchOrigin: 'calibration', toneCurve: [0, 0.5, 1] });
    expect(profileDither(machine, null)).toMatchObject({ dotPitchMm: 0.08, dotPitchOrigin: 'machine', toneCurve: null });
    expect(profileDither({ ...machine, lineIntervalMm: null }, null)).toMatchObject({ dotPitchMm: 0.1, dotPitchOrigin: 'default' });

    store().open(decodedImage(300, 200), 0.1);
    store().edit(setTonal({ brightness: 10 }));
    const undoEntries = store().past.length;
    store().syncAll(applyProfileDither(profileDither(machine, null)));
    expect(currentDoc().steps.dither.dotPitchMm).toBe(0.08);
    // Following the machine is not an edit, and undo does not bring back the old pitch.
    expect(store().past.length).toBe(undoEntries);
    store().undo();
    expect(currentDoc().steps.dither.dotPitchMm).toBe(0.08);

    store().edit(setDotPitch(0.15, profileDither(machine, null)));
    store().syncAll(applyProfileDither(profileDither(machine, calibration)));
    expect(currentDoc().steps.dither).toMatchObject({ dotPitchMm: 0.15, dotPitchOrigin: 'user', toneCurve: [0, 0.5, 1] });
  });

  it('a new document starts dithered with Jarvis on the dot grid', () => {
    store().open(decodedImage(300, 200), 0.1);
    expect(currentDoc().steps.dither).toEqual(DEFAULT_DITHER);
    expect(DEFAULT_DITHER.algorithm).toBe('jarvis');
    expect(dotGridTarget(currentDoc())).toEqual({ widthPx: 300, heightPx: 200 });
  });
});

describe('the 1-bit export and the burn simulation, through the pipeline (#39, #41)', () => {
  let pipeline: TestPipeline;
  beforeAll(async () => {
    pipeline = await startTestPipeline();
  });
  afterAll(() => pipeline.stop());
  beforeEach(() => resetStores());

  /** A 600 x 400 photo-like image sized to 60 x 40 mm. */
  async function openPhotoLike(): Promise<void> {
    const w = 600;
    const h = 400;
    const img = new Uint8Array(labelledImage(w, h));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = Math.round(255 * (x / (w - 1)) * (0.6 + 0.4 * Math.sin(y / 9)));
        img[i] = img[i + 1] = img[i + 2] = Math.max(0, Math.min(255, v));
        img[i + 3] = 255;
      }
    }
    store().open(await loadPixels(pipeline.api, img.buffer, w, h, 'photo.png'), 0.1);
    await pipeline.settled();
  }

  async function exportBytes(format: 'png' | 'bmp'): Promise<Uint8Array> {
    const file = await exportRaster(currentDoc(), format);
    if (!file) throw new Error('cancelled');
    return new Uint8Array(file.bytes);
  }

  it('writes a 1-bit PNG and BMP at exactly the dot grid, with the DPI of the line interval', async () => {
    await openPhotoLike();
    for (const pitch of [0.1, 0.2]) {
      store().edit(setDotPitch(pitch, profileDither(null, null)));
      const doc = currentDoc();
      const dots = { w: Math.round(60 / pitch), h: Math.round(40 / pitch) };
      const ppm = Math.round(1000 / pitch);
      const expected = new Uint8Array(
        (await pipeline.api.renderPreview({ doc, target: { widthPx: dots.w, heightPx: dots.h }, haveSourceKey: null })).final.pixels
      );

      const png = decodePng(await exportBytes('png'));
      expect([png.width, png.height, png.bitDepth, png.colorType]).toEqual([dots.w, dots.h, 1, 0]);
      expect(png.phys).toEqual({ x: ppm, y: ppm, unit: 1 });
      // LightBurn reads the size from pHYs: width / ppm metres.
      expect((png.width / png.phys!.x) * 1000).toBeCloseTo(60, 6);
      let pngMismatch = 0;
      for (let i = 0; i < png.samples.length; i++) if (png.samples[i] * 255 !== expected[i * 4]) pngMismatch++;
      expect(pngMismatch).toBe(0);

      const bmp = decodeBmp((await exportBytes('bmp')).buffer as ArrayBuffer);
      expect([bmp.width, bmp.height, bmp.bitsPerPixel]).toEqual([dots.w, dots.h, 1]);
      expect([bmp.pixelsPerMetreX, bmp.pixelsPerMetreY]).toEqual([ppm, ppm]);
      expect(Array.from(bmp.palette.subarray(0, 8))).toEqual([0, 0, 0, 0, 255, 255, 255, 0]);
      let bmpMismatch = 0;
      for (let i = 0; i < bmp.pixels.length; i++) if (bmp.pixels[i] * 255 !== expected[i * 4]) bmpMismatch++;
      expect(bmpMismatch).toBe(0);
    }
  }, 30000);

  it('the burn simulation changes the preview, never the exported bytes', async () => {
    await openPhotoLike();
    const doc = currentDoc();
    const target = dotGridTarget(doc)!;
    const before = await exportBytes('png');
    const sim = burnSimulationSettings(doc.steps.dither.dotPitchMm, null, null);
    const plain = new Uint8Array((await pipeline.api.renderPreview({ doc, target, haveSourceKey: null })).final.pixels);
    const simulated = new Uint8Array(
      (await pipeline.api.renderPreview({ doc, target, haveSourceKey: null, simulation: sim.simulation })).final.pixels
    );
    expect(Buffer.from(simulated).equals(Buffer.from(plain))).toBe(false);
    expect(sim.generic).toBe(true);
    const after = await exportBytes('png');
    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(true);
  }, 30000);

  it('dot gain: a 0.15 mm spot at a 0.1 mm pitch darkens a 50% area more than the pixels say', async () => {
    const wasmCore = (await loadWasm({ fresh: true })).exports;
    const n = 64;
    const dithered = runPipeline(wasm, grayImage(n, n, () => 128), n, n, { dither: DITHER.blueNoise });
    const ptr = wasmCore.allocate(dithered.length);
    new Uint8Array(wasmCore.memory.buffer, ptr, dithered.length).set(dithered);
    wasmCore.simulate_burn(ptr, n, n, 1.5, 255, 255, 255, 0, 0, 0);
    const out = new Uint8Array(wasmCore.memory.buffer, ptr, dithered.length).slice();
    wasmCore.deallocate(ptr, dithered.length);
    let dark = 0;
    for (let i = 0; i < n * n; i++) dark += 1 - out[i * 4] / 255;
    expect(dark / (n * n)).toBeGreaterThan(0.6);
  });
});
