import { describe, it, expect } from 'vitest';
import { DEFAULT_TONAL, DEFAULT_DITHER } from '../../src/lib/document';

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

  it('has proper default dither settings', () => {
    // A new photo is dithered from the start, at a real dot pitch.
    expect(DEFAULT_DITHER.algorithm).toBe('jarvis');
    expect(DEFAULT_DITHER.serpentine).toBe(true);
    expect(DEFAULT_DITHER.dotPitchMm).toBe(0.1);
    expect('threshold' in DEFAULT_DITHER).toBe(false);
  });
});
