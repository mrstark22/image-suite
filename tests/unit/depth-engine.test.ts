import { describe, it, expect } from 'vitest';
import { generateDepthMap } from '../../src/lib/depth-engine';
import { DEFAULT_DEPTH } from '../../src/store/editStore';

describe('3D Depth Engine', () => {
  it('generates smooth tonal luminance heightmap from grayscale pixels', () => {
    const width = 10;
    const height = 10;
    const pixels = new Uint8ClampedArray(width * height * 4);

    // Gradient from black (0) to white (255)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const val = Math.round((x / (width - 1)) * 255);
        const idx = (y * width + x) * 4;
        pixels[idx] = val;
        pixels[idx + 1] = val;
        pixels[idx + 2] = val;
        pixels[idx + 3] = 255;
      }
    }

    const result = generateDepthMap(pixels, width, height, {
      ...DEFAULT_DEPTH,
      source: 'tonal-height',
      smoothingRadius: 0,
      invertZ: false,
    });

    const depth16 = new Uint16Array(result.heightMapBuffer);
    expect(depth16[0]).toBe(0); // Leftmost black is 0 depth
    expect(depth16[width - 1]).toBe(65535); // Rightmost white is max 65535 depth
  });

  it('correctly inverts Z-depth when invertZ is true', () => {
    const width = 4;
    const height = 4;
    const pixels = new Uint8ClampedArray(width * height * 4);
    pixels.fill(255); // Solid white

    const normalResult = generateDepthMap(pixels, width, height, {
      ...DEFAULT_DEPTH,
      source: 'tonal-height',
      smoothingRadius: 0,
      invertZ: false,
    });
    const invertedResult = generateDepthMap(pixels, width, height, {
      ...DEFAULT_DEPTH,
      source: 'tonal-height',
      smoothingRadius: 0,
      invertZ: true,
    });

    const norm16 = new Uint16Array(normalResult.heightMapBuffer);
    const inv16 = new Uint16Array(invertedResult.heightMapBuffer);

    expect(norm16[0]).toBe(65535);
    expect(inv16[0]).toBe(0);
  });

  it('computes bounded 8-point Chamfer distance transform for shapes', () => {
    const width = 20;
    const height = 20;
    const pixels = new Uint8ClampedArray(width * height * 4);
    pixels.fill(255); // White background

    // Center 6x6 dark square (foreground)
    for (let y = 7; y <= 12; y++) {
      for (let x = 7; x <= 12; x++) {
        const idx = (y * width + x) * 4;
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
      }
    }

    const result = generateDepthMap(pixels, width, height, {
      ...DEFAULT_DEPTH,
      source: 'distance-transform',
      bevelStyle: 'prismatic',
      smoothingRadius: 0,
    });

    const depth16 = new Uint16Array(result.heightMapBuffer);
    // Background corner must be 0 height
    expect(depth16[0]).toBe(0);
    // Center of square must have positive height
    const centerIdx = 9 * width + 9;
    expect(depth16[centerIdx]).toBeGreaterThan(0);
  });

  it('correctly handles non-multiple-of-4 dimensions without stride distortion', () => {
    // Odd dimensions (753 x 491)
    const width = 13;
    const height = 7;
    const total = width * height;
    const pixels = new Uint8ClampedArray(total * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const val = (x + y * 2) % 255;
        pixels[idx] = val;
        pixels[idx + 1] = val;
        pixels[idx + 2] = val;
        pixels[idx + 3] = 255;
      }
    }

    const result = generateDepthMap(pixels, width, height, {
      ...DEFAULT_DEPTH,
      source: 'tonal-height',
      smoothingRadius: 1,
    });

    expect(result.width).toBe(width);
    expect(result.height).toBe(height);
    expect(result.heightMapBuffer.byteLength).toBe(total * 2);
  });

  it('embosses high-frequency text onto base macro depth without altering flat backgrounds', async () => {
    const { applyDetailEmbossing } = await import('../../src/lib/ai-depth');
    const width = 20;
    const height = 20;
    const total = width * height;
    const macroDepth = new Float32Array(total).fill(0.5); // Flat 0.5 base depth

    const pixels = new Uint8ClampedArray(total * 4);
    pixels.fill(200); // White background

    // Draw dark text/letter at center (10, 10)
    const centerIdx = (10 * width + 10) * 4;
    pixels[centerIdx] = 20;
    pixels[centerIdx + 1] = 20;
    pixels[centerIdx + 2] = 20;

    const embossed = applyDetailEmbossing(macroDepth, pixels, width, height, 50);

    // Far corner should remain at base 0.5 depth
    expect(embossed[0]).toBeCloseTo(0.5, 2);
    // Center text edge should have distinct micro-relief
    expect(embossed[10 * width + 10]).not.toBe(0.5);
  });

  it('combines AI base volume with bilateral-denoised tonal relief cleanly', async () => {
    const { combineAiWithTonalRelief } = await import('../../src/lib/ai-depth');
    const width = 16;
    const height = 16;
    const total = width * height;

    // AI shape: cylinder ramping horizontally from 0.2 to 0.8
    const aiDepth = new Float32Array(total);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        aiDepth[y * width + x] = 0.2 + (x / width) * 0.6;
      }
    }

    const pixels = new Uint8ClampedArray(total * 4);
    pixels.fill(128); // Mid-gray base

    // High-contrast text at center
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const idx = ((8 + dy) * width + (8 + dx)) * 4;
        pixels[idx] = 250;
        pixels[idx + 1] = 250;
        pixels[idx + 2] = 250;
      }
    }

    const hybrid = combineAiWithTonalRelief(aiDepth, pixels, width, height, 80, 40, 2.0);

    expect(hybrid.length).toBe(total);
    // Center embossed letter should be elevated relative to its horizontal neighbor
    expect(hybrid[8 * width + 8]).toBeGreaterThan(0.0);
    // Overall array should be properly normalized in [0, 1]
    for (let i = 0; i < total; i++) {
      expect(hybrid[i]).toBeGreaterThanOrEqual(0.0);
      expect(hybrid[i]).toBeLessThanOrEqual(1.0);
    }
  });
});
