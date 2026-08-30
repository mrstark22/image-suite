import { describe, it, expect } from 'vitest';
import { removeBackground } from '../../src/lib/bg-removal';

describe('Background Removal Engine', () => {
  it('removes solid white border background and sets alpha to 0', () => {
    const width = 10;
    const height = 10;
    const pixels = new Uint8ClampedArray(width * height * 4);

    // Fill entirely with white
    for (let i = 0; i < width * height * 4; i += 4) {
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
      pixels[i + 3] = 255;
    }

    // Put a black center 2x2 square
    for (let y = 4; y <= 5; y++) {
      for (let x = 4; x <= 5; x++) {
        const idx = (y * width + x) * 4;
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 255;
      }
    }

    const { removedPixelCount } = removeBackground(pixels, width, height, {
      tolerance: 30,
      featherRadius: 0,
      mode: 'auto-border',
    });

    // 100 - 4 center black pixels = 96 white background pixels removed
    expect(removedPixelCount).toBe(96);

    // Center pixel should still have alpha 255
    const centerIdx = (4 * width + 4) * 4;
    expect(pixels[centerIdx + 3]).toBe(255);

    // Corner pixel should have alpha 0
    expect(pixels[3]).toBe(0);
  });
});
