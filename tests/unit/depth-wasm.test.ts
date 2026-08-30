import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { encodeBmpGrayscale8 } from '../../src/lib/bmp-encoder';

describe('Rust WebAssembly 3D Depth & Heightmap Relief Suite', () => {
  it('instantiates WASM and executes Tonal Height relief mapping', async () => {
    const wasmPath = path.resolve(__dirname, '../../src/wasm/pkg/image_suite_wasm.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.instantiate(wasmBuffer, { env: {} });
    const exports = wasmModule.instance.exports as any;

    expect(typeof exports.process_depth).toBe('function');
    expect(typeof exports.get_depth_buf_len).toBe('function');

    const width = 16;
    const height = 16;
    const byteLength = width * height * 4;
    const ptr = exports.allocate(byteLength);

    const wasmMem = new Uint8Array(exports.memory.buffer, ptr, byteLength);
    // Gradient: Black (0) on left to White (255) on right
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const val = Math.round((x / (width - 1)) * 255);
        const idx = (y * width + x) * 4;
        wasmMem[idx] = val;
        wasmMem[idx + 1] = val;
        wasmMem[idx + 2] = val;
        wasmMem[idx + 3] = 255;
      }
    }

    // Run Mode 0: Tonal Luminance Height
    const outPtr = exports.process_depth(
      ptr,
      width,
      height,
      0,   // Source: tonal
      0,   // Bevel: prismatic
      0,   // Invert Z: false
      0.0, // Smoothing: 0
      1.0, // Scale
      45.0 // Angle
    );

    const outLen = exports.get_depth_buf_len();
    expect(outLen).toBe(width * height);
    expect(outPtr).toBeGreaterThan(0);

    const depth16 = new Uint16Array(exports.memory.buffer, outPtr, outLen);
    // Leftmost pixel (black) should be near 0
    expect(depth16[0]).toBeLessThan(100);
    // Rightmost pixel (white) should be near 65535
    expect(depth16[width - 1]).toBeGreaterThan(60000);

    exports.deallocate(ptr, byteLength);
  });

  it('runs Euclidean Distance Transform (EDT) with Chamfer Bevels', async () => {
    const wasmPath = path.resolve(__dirname, '../../src/wasm/pkg/image_suite_wasm.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.instantiate(wasmBuffer, { env: {} });
    const exports = wasmModule.instance.exports as any;

    const width = 32;
    const height = 32;
    const byteLength = width * height * 4;
    const ptr = exports.allocate(byteLength);

    const wasmMem = new Uint8Array(exports.memory.buffer, ptr, byteLength);
    wasmMem.fill(255); // Background (white)

    // Foreground 16x16 square in the center (black)
    for (let y = 8; y < 24; y++) {
      for (let x = 8; x < 24; x++) {
        const idx = (y * width + x) * 4;
        wasmMem[idx] = 0;
        wasmMem[idx + 1] = 0;
        wasmMem[idx + 2] = 0;
        wasmMem[idx + 3] = 255;
      }
    }

    // Run Mode 1: Distance Transform with Dome Bevel (bevelStyle = 1)
    const outPtr = exports.process_depth(
      ptr,
      width,
      height,
      1,   // Source: EDT
      1,   // Bevel: Dome
      0,   // Invert Z: false
      1.0, // Smoothing
      1.0,
      45.0
    );

    const outLen = exports.get_depth_buf_len();
    const depth16 = new Uint16Array(exports.memory.buffer, outPtr, outLen);

    // Outer background (0,0) must have 0 depth
    expect(depth16[0]).toBe(0);

    // Center of square (16, 16) must have highest peak
    const centerVal = depth16[16 * width + 16];
    const edgeVal = depth16[8 * width + 8];
    expect(centerVal).toBeGreaterThan(edgeVal);
    expect(centerVal).toBeGreaterThan(20000);

    exports.deallocate(ptr, byteLength);
  });

  it('inverts Z-axis height when invertZ is true', async () => {
    const wasmPath = path.resolve(__dirname, '../../src/wasm/pkg/image_suite_wasm.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.instantiate(wasmBuffer, { env: {} });
    const exports = wasmModule.instance.exports as any;

    const width = 16;
    const height = 16;
    const byteLength = width * height * 4;
    const ptr = exports.allocate(byteLength);

    const wasmMem = new Uint8Array(exports.memory.buffer, ptr, byteLength);
    wasmMem.fill(0); // All black

    // Normal Z: Black = 0
    const outPtr1 = exports.process_depth(ptr, width, height, 0, 0, 0, 0.0, 1.0, 45.0);
    const depthNormal = new Uint16Array(exports.memory.buffer, outPtr1, width * height);
    expect(depthNormal[0]).toBe(0);

    // Invert Z: Black = 65535
    const outPtr2 = exports.process_depth(ptr, width, height, 0, 0, 1, 0.0, 1.0, 45.0);
    const depthInverted = new Uint16Array(exports.memory.buffer, outPtr2, width * height);
    expect(depthInverted[0]).toBe(65535);

    exports.deallocate(ptr, byteLength);
  });

  it('encodes 16-bit depth output into valid 8-bit Windows Grayscale BMP', () => {
    const width = 8;
    const height = 8;
    const depth16 = new Uint16Array(width * height);
    for (let i = 0; i < width * height; i++) {
      depth16[i] = i * 1000;
    }

    const bmp = encodeBmpGrayscale8(depth16, width, height, 300);
    const view = new DataView(bmp);

    // BM header magic
    expect(view.getUint8(0)).toBe(0x42); // 'B'
    expect(view.getUint8(1)).toBe(0x4d); // 'M'
    // Width and height
    expect(view.getInt32(18, true)).toBe(8);
    expect(view.getInt32(22, true)).toBe(8);
    // Bits per pixel: 8-bit indexed grayscale
    expect(view.getUint16(28, true)).toBe(8);
  });
});
