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
    expect(DEFAULT_DITHER.algorithm).toBe('none');
    expect(DEFAULT_DITHER.threshold).toBe(128);
    expect(DEFAULT_DITHER.serpentine).toBe(true);
  });
});
