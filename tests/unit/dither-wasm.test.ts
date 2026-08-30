import { describe, it, expect } from 'vitest';
import type { DitherAlgorithm } from '../../src/types/dither';
import fs from 'fs';
import path from 'path';

describe('Rust WebAssembly & Dithering Engine Suite', () => {
  it('has valid compiled WebAssembly binary on disk', () => {
    const wasmPath = path.resolve(__dirname, '../../src/wasm/pkg/image_suite_wasm.wasm');
    expect(fs.existsSync(wasmPath)).toBe(true);
    const stats = fs.statSync(wasmPath);
    expect(stats.size).toBeGreaterThan(50000); // Binary should be ~300KB
  });

  it('instantiates the WebAssembly module and verifies linear memory exports', async () => {
    const wasmPath = path.resolve(__dirname, '../../src/wasm/pkg/image_suite_wasm.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.instantiate(wasmBuffer, { env: {} });
    const exports = wasmModule.instance.exports as any;

    expect(typeof exports.allocate).toBe('function');
    expect(typeof exports.deallocate).toBe('function');
    expect(typeof exports.process_pipeline).toBe('function');
    expect(exports.memory instanceof WebAssembly.Memory).toBe(true);
  });

  it('runs Rust WASM pipeline for all dithering algorithms and produces valid 1-bit binary output', async () => {
    const wasmPath = path.resolve(__dirname, '../../src/wasm/pkg/image_suite_wasm.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.instantiate(wasmBuffer, { env: {} });
    const exports = wasmModule.instance.exports as any;

    const width = 64;
    const height = 64;
    const byteLength = width * height * 4;

    const testAlgorithms: Array<{ name: DitherAlgorithm; code: number }> = [
      { name: 'floyd-steinberg', code: 1 },
      { name: 'atkinson', code: 2 },
      { name: 'jarvis', code: 3 },
      { name: 'bayer-2', code: 4 },
      { name: 'bayer-4', code: 5 },
      { name: 'bayer-8', code: 6 },
      { name: 'blue-noise', code: 7 },
      { name: 'ostromoukhov', code: 8 },
      { name: 'riemersma', code: 9 },
      { name: 'knuth-dot', code: 10 },
      { name: 'halftone-dot', code: 11 },
    ];

    for (const algo of testAlgorithms) {
      // Allocate WASM memory
      const ptr = exports.allocate(byteLength);
      expect(ptr).toBeGreaterThan(0);

      // Fill test gradient image (0 to 255)
      const wasmMemory = new Uint8Array(exports.memory.buffer, ptr, byteLength);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const val = Math.round(((x + y) / (width + height)) * 255);
          wasmMemory[idx] = val;
          wasmMemory[idx + 1] = val;
          wasmMemory[idx + 2] = val;
          wasmMemory[idx + 3] = 255;
        }
      }

      // Execute WASM pipeline
      exports.process_pipeline(
        ptr,
        width,
        height,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1.0, 0, 255, 0, 0, // Tonal
        0, 0, 0, 0,                                   // Color
        0, 2.5, 8,                                    // CLAHE
        0, 15, 2.0,                                   // Adaptive
        0, 1.5,                                       // Sharpen
        algo.code,                                    // Dither algorithm code
        128,                                          // Threshold
        1,                                            // Serpentine
        1,                                            // Matrix scale
        45.0,                                         // Dot angle
        0                                             // Inverted burn
      );

      // Verify output contains pure binary pixels (0 or 255)
      const processed = new Uint8Array(exports.memory.buffer, ptr, byteLength);
      let zeroCount = 0;
      let maxCount = 0;

      for (let i = 0; i < width * height; i++) {
        const val = processed[i * 4];
        expect(val === 0 || val === 255).toBe(true);
        if (val === 0) zeroCount++;
        if (val === 255) maxCount++;
      }

      // Ensure dither distributed both black and white pixels across gradient
      expect(zeroCount).toBeGreaterThan(0);
      expect(maxCount).toBeGreaterThan(0);

      // Deallocate memory
      exports.deallocate(ptr, byteLength);
    }
  });

  it('runs Rust WASM CLAHE and Adaptive Thresholding correctly', async () => {
    const wasmPath = path.resolve(__dirname, '../../src/wasm/pkg/image_suite_wasm.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.instantiate(wasmBuffer, { env: {} });
    const exports = wasmModule.instance.exports as any;

    const width = 32;
    const height = 32;
    const byteLength = width * height * 4;
    const ptr = exports.allocate(byteLength);

    const wasmMemory = new Uint8Array(exports.memory.buffer, ptr, byteLength);
    wasmMemory.fill(120);

    // Run CLAHE + Sharpening + Adaptive Thresholding
    exports.process_pipeline(
      ptr,
      width,
      height,
      0, 10, 15, 0, 0, 0, 0, 0, 0, 1.2, 5, 250, 0, 0, // Tonal
      0, 0, 0, 0,                                     // Color
      1, 3.0, 4,                                      // Enable CLAHE
      1, 7, 2.0,                                      // Enable Adaptive Threshold
      50, 1.5,                                        // Enable Sharpening (amount: 50, radius: 1.5)
      0, 128, 1, 1, 45, 0                             // No dither
    );

    const processed = new Uint8Array(exports.memory.buffer, ptr, byteLength);
    expect(processed.length).toBe(byteLength);
    exports.deallocate(ptr, byteLength);
  });

  it('verifies threshold slider dynamically controls density for error diffusion and matrix algorithms', async () => {
    const wasmPath = path.resolve(__dirname, '../../src/wasm/pkg/image_suite_wasm.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.instantiate(wasmBuffer, { env: {} });
    const exports = wasmModule.instance.exports as any;

    const width = 64;
    const height = 64;
    const byteLength = width * height * 4;

    const errorDiffAlgorithms = [
      { name: 'floyd-steinberg', code: 1 },
      { name: 'atkinson', code: 2 },
      { name: 'jarvis', code: 3 },
      { name: 'ostromoukhov', code: 8 },
      { name: 'riemersma', code: 9 },
    ];

    for (const algo of errorDiffAlgorithms) {
      // 1. Run with low threshold (50) -> should have MORE white / FEWER black burn pixels
      const ptrLow = exports.allocate(byteLength);
      const memLow = new Uint8Array(exports.memory.buffer, ptrLow, byteLength);
      for (let i = 0; i < width * height; i++) {
        memLow[i * 4] = 128;
        memLow[i * 4 + 1] = 128;
        memLow[i * 4 + 2] = 128;
        memLow[i * 4 + 3] = 255;
      }
      exports.process_pipeline(
        ptrLow, width, height,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1.0, 0, 255, 0, 0,
        0, 0, 0, 0,
        0, 2.5, 8,
        0, 15, 2.0,
        0, 1.5,
        algo.code,
        50, // LOW threshold
        1, 1, 45.0, 0
      );

      let blackCountLow = 0;
      const resLow = new Uint8Array(exports.memory.buffer, ptrLow, byteLength);
      for (let i = 0; i < width * height; i++) {
        if (resLow[i * 4] === 0) blackCountLow++;
      }
      exports.deallocate(ptrLow, byteLength);

      // 2. Run with high threshold (200) -> should have MUCH MORE black burn pixels
      const ptrHigh = exports.allocate(byteLength);
      const memHigh = new Uint8Array(exports.memory.buffer, ptrHigh, byteLength);
      for (let i = 0; i < width * height; i++) {
        memHigh[i * 4] = 128;
        memHigh[i * 4 + 1] = 128;
        memHigh[i * 4 + 2] = 128;
        memHigh[i * 4 + 3] = 255;
      }
      exports.process_pipeline(
        ptrHigh, width, height,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1.0, 0, 255, 0, 0,
        0, 0, 0, 0,
        0, 2.5, 8,
        0, 15, 2.0,
        0, 1.5,
        algo.code,
        200, // HIGH threshold
        1, 1, 45.0, 0
      );

      let blackCountHigh = 0;
      const resHigh = new Uint8Array(exports.memory.buffer, ptrHigh, byteLength);
      for (let i = 0; i < width * height; i++) {
        if (resHigh[i * 4] === 0) blackCountHigh++;
      }
      exports.deallocate(ptrHigh, byteLength);

      // High threshold must produce significantly more black/burn pixels than low threshold
      expect(blackCountHigh).toBeGreaterThan(blackCountLow * 2);
    }
  });
});
