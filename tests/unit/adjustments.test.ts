import { describe, it, expect } from 'vitest';
import { DEFAULT_TONAL, DEFAULT_DITHER } from '../../src/store/editStore';
import { buildTonalLUT, applyFastTonalLUT } from '../../src/lib/fast-tonal';
import { DEFAULT_COLOR } from '../../src/store/editStore';

describe('Image Suite Adjustments & Recipes', () => {
  it('has proper default tonal parameters', () => {
    expect(DEFAULT_TONAL.exposure).toBe(0);
    expect(DEFAULT_TONAL.brightness).toBe(0);
    expect(DEFAULT_TONAL.contrast).toBe(0);
    expect(DEFAULT_TONAL.midtones).toBe(0);
    expect(DEFAULT_TONAL.highlights).toBe(0);
    expect(DEFAULT_TONAL.shadows).toBe(0);
    expect(DEFAULT_TONAL.whites).toBe(0);
    expect(DEFAULT_TONAL.blacks).toBe(0);
    expect(DEFAULT_TONAL.clarity).toBe(0);
    expect(DEFAULT_TONAL.gamma).toBe(1.0);
    expect(DEFAULT_TONAL.blackPoint).toBe(0);
    expect(DEFAULT_TONAL.whitePoint).toBe(255);
    expect(DEFAULT_TONAL.invert).toBe(false);
    expect(DEFAULT_TONAL.grayscaleMode).toBe('none');
  });

  it('generates identity LUT with default settings', () => {
    const lut = buildTonalLUT(DEFAULT_TONAL);
    expect(lut.length).toBe(256);
    expect(lut[0]).toBe(0);
    expect(lut[128]).toBe(128);
    expect(lut[255]).toBe(255);
  });

  it('correctly inverts tonal LUT when invert is true', () => {
    const lut = buildTonalLUT({ ...DEFAULT_TONAL, invert: true });
    expect(lut[0]).toBe(255);
    expect(lut[128]).toBe(127);
    expect(lut[255]).toBe(0);
  });

  it('boosts midtones when midtones slider is increased', () => {
    const defaultLut = buildTonalLUT(DEFAULT_TONAL);
    const boostedLut = buildTonalLUT({ ...DEFAULT_TONAL, midtones: 50 });
    expect(boostedLut[128]).toBeGreaterThan(defaultLut[128]);
  });

  it('applies fast tonal and color processing to RGBA buffer', () => {
    const src = new Uint8ClampedArray([100, 150, 200, 255]);
    const dest = new Uint8ClampedArray(4);
    applyFastTonalLUT(src.buffer, dest.buffer, 1, 1, { ...DEFAULT_TONAL, brightness: 20 }, DEFAULT_COLOR);
    expect(dest[0]).toBeGreaterThan(100);
    expect(dest[1]).toBeGreaterThan(150);
    expect(dest[2]).toBeGreaterThan(200);
    expect(dest[3]).toBe(255);
  });

  it('has proper default dither settings', () => {
    expect(DEFAULT_DITHER.algorithm).toBe('none');
    expect(DEFAULT_DITHER.threshold).toBe(128);
    expect(DEFAULT_DITHER.serpentine).toBe(true);
  });
});
