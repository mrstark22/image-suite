import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { generateDXF } from '../../src/lib/dxf-export';
import { generateProductionSVG } from '../../src/lib/svg-export';
import type { VectorResult } from '../../src/types/vector';

describe('Rust WebAssembly Vectorization & CAD Export Engine', () => {
  it('instantiates the WASM module and executes outline vectorization', async () => {
    const wasmPath = path.resolve(__dirname, '../../src/wasm/pkg/image_suite_wasm.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.instantiate(wasmBuffer, { env: {} });
    const exports = wasmModule.instance.exports as any;

    expect(typeof exports.process_vector).toBe('function');
    expect(typeof exports.get_vector_json_len).toBe('function');

    const width = 32;
    const height = 32;
    const byteLength = width * height * 4;
    const ptr = exports.allocate(byteLength);

    // Create a 10x10 square in the center (black foreground on white background)
    const wasmMem = new Uint8Array(exports.memory.buffer, ptr, byteLength);
    wasmMem.fill(255); // White background

    for (let y = 10; y < 22; y++) {
      for (let x = 10; x < 22; x++) {
        const idx = (y * width + x) * 4;
        wasmMem[idx] = 0;
        wasmMem[idx + 1] = 0;
        wasmMem[idx + 2] = 0;
        wasmMem[idx + 3] = 255;
      }
    }

    // Run Mode 0: Outline
    const outPtr = exports.process_vector(
      ptr,
      width,
      height,
      0,    // Mode: outline
      4,    // Color count
      128,  // Threshold
      1.0,  // RDP tolerance
      1,    // Curve fitting
      4.0,  // Min path area
      0.0,  // Denoise
      30.0, // Canny low
      80.0, // Canny high
      0     // Invert
    );

    const outLen = exports.get_vector_json_len();
    expect(outPtr).toBeGreaterThan(0);
    expect(outLen).toBeGreaterThan(0);

    const jsonBytes = new Uint8Array(exports.memory.buffer, outPtr, outLen);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.layers).toBeDefined();
    expect(parsed.layers.length).toBeGreaterThan(0);
    expect(parsed.layers[0].paths.length).toBeGreaterThan(0);
    expect(parsed.layers[0].paths[0].isClosed).toBe(true);
    expect(parsed.layers[0].paths[0].svgPathData).toContain('M ');
    expect(parsed.layers[0].paths[0].svgPathData).toContain('Z');

    exports.deallocate(ptr, byteLength);
  });

  it('runs K-Means multi-color segmentation (Mode 2) and creates multi-layer vector output', async () => {
    const wasmPath = path.resolve(__dirname, '../../src/wasm/pkg/image_suite_wasm.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.instantiate(wasmBuffer, { env: {} });
    const exports = wasmModule.instance.exports as any;

    const width = 32;
    const height = 32;
    const byteLength = width * height * 4;
    const ptr = exports.allocate(byteLength);

    const wasmMem = new Uint8Array(exports.memory.buffer, ptr, byteLength);
    // Draw 3 colored stripes (Red, Green, Blue)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (x < 10) {
          wasmMem[idx] = 255; wasmMem[idx + 1] = 0; wasmMem[idx + 2] = 0;
        } else if (x < 20) {
          wasmMem[idx] = 0; wasmMem[idx + 1] = 255; wasmMem[idx + 2] = 0;
        } else {
          wasmMem[idx] = 0; wasmMem[idx + 1] = 0; wasmMem[idx + 2] = 255;
        }
        wasmMem[idx + 3] = 255;
      }
    }

    // Run Mode 2: Multi-Color with k=3
    const outPtr = exports.process_vector(
      ptr, width, height,
      2, 3, 128, 1.0, 1, 4.0, 0.0, 30.0, 80.0, 0
    );

    const outLen = exports.get_vector_json_len();
    const jsonBytes = new Uint8Array(exports.memory.buffer, outPtr, outLen);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.layers.length).toBe(3);
    for (const layer of parsed.layers) {
      expect(layer.color).toMatch(/^#[0-9a-f]{6}$/i);
    }

    exports.deallocate(ptr, byteLength);
  });

  it('runs Canny Edge Detection (Mode 3) vectorization', async () => {
    const wasmPath = path.resolve(__dirname, '../../src/wasm/pkg/image_suite_wasm.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.instantiate(wasmBuffer, { env: {} });
    const exports = wasmModule.instance.exports as any;

    const width = 32;
    const height = 32;
    const byteLength = width * height * 4;
    const ptr = exports.allocate(byteLength);

    const wasmMem = new Uint8Array(exports.memory.buffer, ptr, byteLength);
    wasmMem.fill(255);
    // Draw high-contrast box
    for (let y = 8; y < 24; y++) {
      for (let x = 8; x < 24; x++) {
        const idx = (y * width + x) * 4;
        wasmMem[idx] = 0; wasmMem[idx + 1] = 0; wasmMem[idx + 2] = 0;
      }
    }

    // Run Mode 3: Canny
    const outPtr = exports.process_vector(
      ptr, width, height,
      3, 4, 128, 1.0, 1, 4.0, 0.0, 20.0, 60.0, 0
    );

    const outLen = exports.get_vector_json_len();
    const jsonBytes = new Uint8Array(exports.memory.buffer, outPtr, outLen);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.layers.length).toBeGreaterThan(0);
    exports.deallocate(ptr, byteLength);
  });

  it('generates valid AutoCAD R12 DXF string for laser & CNC machines', () => {
    const mockResult: VectorResult = {
      layers: [
        {
          id: 'layer-cut',
          name: 'Outer Cut',
          color: '#ff0000',
          visible: true,
          totalNodes: 4,
          paths: [
            {
              id: 'p-1',
              color: '#ff0000',
              isClosed: true,
              nodeCount: 4,
              segments: [],
              svgPathData: 'M 10 10 L 50 10 L 50 50 L 10 50 Z',
            },
          ],
        },
      ],
      totalPaths: 1,
      totalNodes: 4,
      svgString: '<svg></svg>',
      dimensions: { width: 100, height: 100 },
    };

    const dxf = generateDXF(mockResult);

    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('HEADER');
    expect(dxf).toContain('AC1009'); // AutoCAD R12 ASCII version
    expect(dxf).toContain('TABLES');
    expect(dxf).toContain('Outer_Cut');
    expect(dxf).toContain('ENTITIES');
    expect(dxf).toContain('POLYLINE');
    expect(dxf).toContain('VERTEX');
    expect(dxf).toContain('SEQEND');
    expect(dxf).toContain('EOF');
  });

  it('generates production SVG with physical dimensions and grouped layer metadata', () => {
    const mockResult: VectorResult = {
      layers: [
        {
          id: 'layer-1',
          name: 'Engrave Contours',
          color: '#38bdf8',
          visible: true,
          totalNodes: 4,
          paths: [
            {
              id: 'path-1',
              color: '#38bdf8',
              isClosed: true,
              nodeCount: 4,
              segments: [],
              svgPathData: 'M 10 10 L 90 10 L 90 90 L 10 90 Z',
            },
          ],
        },
      ],
      totalPaths: 1,
      totalNodes: 4,
      svgString: '<svg></svg>',
      dimensions: { width: 384, height: 384 },
    };

    const svgMm = generateProductionSVG(mockResult, {
      strokeWidth: 1.5,
      physicalUnits: 'mm',
      dpi: 96,
    });

    expect(svgMm).toContain('width="101.60mm"');
    expect(svgMm).toContain('height="101.60mm"');
    expect(svgMm).toContain('viewBox="0 0 384 384"');
    expect(svgMm).toContain('xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"');
    expect(svgMm).toContain('inkscape:label="Engrave Contours"');
    expect(svgMm).toContain('stroke="#38bdf8"');
    expect(svgMm).toContain('stroke-width="1.5"');
    expect(svgMm).toContain('<path id="path-1"');
  });

  it('collapses rectangular pixel staircases into exact straight lines with 4 sharp corners', async () => {
    const wasmPath = path.resolve(__dirname, '../../src/wasm/pkg/image_suite_wasm.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.instantiate(wasmBuffer, { env: {} });
    const exports = wasmModule.instance.exports as any;

    const width = 64;
    const height = 64;
    const byteLength = width * height * 4;
    const ptr = exports.allocate(byteLength);

    const wasmMem = new Uint8Array(exports.memory.buffer, ptr, byteLength);
    wasmMem.fill(255); // White background

    // Draw 30x20 black rectangle
    for (let y = 15; y < 35; y++) {
      for (let x = 10; x < 40; x++) {
        const idx = (y * width + x) * 4;
        wasmMem[idx] = 0;
        wasmMem[idx + 1] = 0;
        wasmMem[idx + 2] = 0;
        wasmMem[idx + 3] = 255;
      }
    }

    const outPtr = exports.process_vector(
      ptr, width, height,
      0, 4, 128, 1.0, 1, 4.0, 0.0, 30.0, 80.0, 0, 1.0
    );

    const outLen = exports.get_vector_json_len();
    const jsonBytes = new Uint8Array(exports.memory.buffer, outPtr, outLen);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.layers.length).toBe(1);
    const path0 = parsed.layers[0].paths[0];
    expect(path0.isClosed).toBe(true);
    // Should have exactly 4-5 nodes (4 corners) with only straight L commands
    expect(path0.nodeCount).toBeLessThanOrEqual(5);
    expect(path0.svgPathData).toContain('L ');
    expect(path0.svgPathData).toContain('Z');

    exports.deallocate(ptr, byteLength);
  });

  it('traces both outer boundary and inner hole for hollow ring shapes', async () => {
    const wasmPath = path.resolve(__dirname, '../../src/wasm/pkg/image_suite_wasm.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.instantiate(wasmBuffer, { env: {} });
    const exports = wasmModule.instance.exports as any;

    const width = 64;
    const height = 64;
    const byteLength = width * height * 4;
    const ptr = exports.allocate(byteLength);

    const wasmMem = new Uint8Array(exports.memory.buffer, ptr, byteLength);
    wasmMem.fill(255);

    // Draw outer box 40x40 with inner hole 20x20
    for (let y = 12; y < 52; y++) {
      for (let x = 12; x < 52; x++) {
        const isHole = x >= 22 && x < 42 && y >= 22 && y < 42;
        if (!isHole) {
          const idx = (y * width + x) * 4;
          wasmMem[idx] = 0;
          wasmMem[idx + 1] = 0;
          wasmMem[idx + 2] = 0;
          wasmMem[idx + 3] = 255;
        }
      }
    }

    const outPtr = exports.process_vector(
      ptr, width, height,
      0, 4, 128, 1.0, 1, 4.0, 0.0, 30.0, 80.0, 0, 1.0
    );

    const outLen = exports.get_vector_json_len();
    const jsonBytes = new Uint8Array(exports.memory.buffer, outPtr, outLen);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.layers[0].paths.length).toBe(2); // Outer contour + Inner hole
    exports.deallocate(ptr, byteLength);
  });

  it('executes Zhang-Suen skeletonization for Centerline mode (Mode 1)', async () => {
    const wasmPath = path.resolve(__dirname, '../../src/wasm/pkg/image_suite_wasm.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.instantiate(wasmBuffer, { env: {} });
    const exports = wasmModule.instance.exports as any;

    const width = 64;
    const height = 64;
    const byteLength = width * height * 4;
    const ptr = exports.allocate(byteLength);

    const wasmMem = new Uint8Array(exports.memory.buffer, ptr, byteLength);
    wasmMem.fill(255);

    // Draw a thick T-stroke (width ~6px)
    for (let y = 10; y < 16; y++) {
      for (let x = 10; x < 54; x++) {
        const idx = (y * width + x) * 4;
        wasmMem[idx] = 0; wasmMem[idx + 1] = 0; wasmMem[idx + 2] = 0;
      }
    }
    for (let y = 16; y < 54; y++) {
      for (let x = 29; x < 35; x++) {
        const idx = (y * width + x) * 4;
        wasmMem[idx] = 0; wasmMem[idx + 1] = 0; wasmMem[idx + 2] = 0;
      }
    }

    // Run Mode 1: Centerline
    const outPtr = exports.process_vector(
      ptr, width, height,
      1, 4, 128, 1.0, 1, 4.0, 0.0, 30.0, 80.0, 0, 1.0
    );

    const outLen = exports.get_vector_json_len();
    const jsonBytes = new Uint8Array(exports.memory.buffer, outPtr, outLen);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.layers.length).toBe(1);
    expect(parsed.layers[0].name).toBe('Centerlines');
    expect(parsed.layers[0].paths.length).toBeGreaterThan(0);
    // Centerline strokes are open paths (isClosed: false)
    expect(parsed.layers[0].paths[0].isClosed).toBe(false);

    exports.deallocate(ptr, byteLength);
  });

  it('traces diagonal letterforms (like letter V) with straight lines and sharp corners', async () => {
    const wasmPath = path.resolve(__dirname, '../../src/wasm/pkg/image_suite_wasm.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.instantiate(wasmBuffer, { env: {} });
    const exports = wasmModule.instance.exports as any;

    const width = 64;
    const height = 64;
    const byteLength = width * height * 4;
    const ptr = exports.allocate(byteLength);

    const wasmMem = new Uint8Array(exports.memory.buffer, ptr, byteLength);
    wasmMem.fill(255);

    // Draw diagonal 'V' letter shape: apex at (32, 50), top-left at (10, 10), top-right at (54, 10)
    for (let y = 10; y <= 50; y++) {
      const progress = (y - 10) / 40.0;
      // Left leg
      const leftCenterX = 14 + progress * 18;
      for (let x = Math.round(leftCenterX - 3); x <= Math.round(leftCenterX + 3); x++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          const idx = (y * width + x) * 4;
          wasmMem[idx] = 0; wasmMem[idx + 1] = 0; wasmMem[idx + 2] = 0;
        }
      }
      // Right leg
      const rightCenterX = 50 - progress * 18;
      for (let x = Math.round(rightCenterX - 3); x <= Math.round(rightCenterX + 3); x++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          const idx = (y * width + x) * 4;
          wasmMem[idx] = 0; wasmMem[idx + 1] = 0; wasmMem[idx + 2] = 0;
        }
      }
    }

    const outPtr = exports.process_vector(
      ptr, width, height,
      0, 4, 128, 1.0, 1, 1.0, 0.0, 30.0, 80.0, 0, 1.0
    );

    const outLen = exports.get_vector_json_len();
    const jsonBytes = new Uint8Array(exports.memory.buffer, outPtr, outLen);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.layers.length).toBe(1);
    expect(parsed.layers[0].paths.length).toBeGreaterThan(0);
    const vPath = parsed.layers[0].paths[0];
    expect(vPath.isClosed).toBe(true);
    expect(vPath.nodeCount).toBeLessThanOrEqual(24);
    // Straight lines present
    expect(vPath.svgPathData).toContain('L ');

    exports.deallocate(ptr, byteLength);
  });
});
