/**
 * High-performance client-side Background Removal & Alpha Matting Engine.
 * Operates on raw RGBA Uint8ClampedArray pixel buffers.
 */

export interface BgRemovalOptions {
  tolerance: number;        // 5 to 100 (color distance threshold)
  featherRadius: number;    // 0 to 10 px (soft edge blur)
  mode: 'auto-border' | 'white-bg' | 'black-bg' | 'custom-color';
  customColor?: { r: number; g: number; b: number };
}

/**
 * Removes the background from an RGBA buffer in-place or returns a new transparent buffer.
 */
export function removeBackground(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: BgRemovalOptions
): { buffer: ArrayBuffer; removedPixelCount: number } {
  const { tolerance, featherRadius, mode, customColor } = options;
  const total = width * height;
  const tolSq = tolerance * tolerance * 3;

  // 1. Determine background reference color(s)
  const bgColors: Array<{ r: number; g: number; b: number }> = [];

  if (mode === 'white-bg') {
    bgColors.push({ r: 255, g: 255, b: 255 });
  } else if (mode === 'black-bg') {
    bgColors.push({ r: 0, g: 0, b: 0 });
  } else if (mode === 'custom-color' && customColor) {
    bgColors.push(customColor);
  } else {
    // Auto-sample 4 corners and borders
    const sampleCorners = [
      0, // Top-left
      (width - 1) * 4, // Top-right
      ((height - 1) * width) * 4, // Bottom-left
      (height * width - 1) * 4, // Bottom-right
      Math.floor(width / 2) * 4, // Top-middle
      Math.floor((height - 1) * width + width / 2) * 4, // Bottom-middle
    ];

    for (const idx of sampleCorners) {
      bgColors.push({
        r: pixels[idx],
        g: pixels[idx + 1],
        b: pixels[idx + 2],
      });
    }
  }

  // 2. Build flood-fill mask starting from image borders
  // mask: 0 = foreground (keep), 1 = background (remove)
  const mask = new Uint8Array(total);
  const queue: Int32Array = new Int32Array(total);
  let qHead = 0;
  let qTail = 0;

  const isBgMatch = (r: number, g: number, b: number): boolean => {
    for (const bg of bgColors) {
      const dr = r - bg.r;
      const dg = g - bg.g;
      const db = b - bg.b;
      const distSq = dr * dr + dg * dg + db * db;
      if (distSq <= tolSq) return true;
    }
    return false;
  };

  // Seed with border pixels matching background
  const checkAndEnqueue = (x: number, y: number) => {
    const idx = y * width + x;
    if (mask[idx] === 0) {
      const pIdx = idx * 4;
      if (isBgMatch(pixels[pIdx], pixels[pIdx + 1], pixels[pIdx + 2])) {
        mask[idx] = 1;
        queue[qTail++] = idx;
      }
    }
  };

  // Top and bottom borders
  for (let x = 0; x < width; x++) {
    checkAndEnqueue(x, 0);
    checkAndEnqueue(x, height - 1);
  }
  // Left and right borders
  for (let y = 0; y < height; y++) {
    checkAndEnqueue(0, y);
    checkAndEnqueue(width - 1, y);
  }

  // BFS Flood-fill connectivity
  while (qHead < qTail) {
    const idx = queue[qHead++];
    const cx = idx % width;
    const cy = Math.floor(idx / width);

    const neighbors = [
      { x: cx + 1, y: cy },
      { x: cx - 1, y: cy },
      { x: cx, y: cy + 1 },
      { x: cx, y: cy - 1 },
    ];

    for (const n of neighbors) {
      if (n.x >= 0 && n.x < width && n.y >= 0 && n.y < height) {
        const nIdx = n.y * width + n.x;
        if (mask[nIdx] === 0) {
          const npIdx = nIdx * 4;
          if (isBgMatch(pixels[npIdx], pixels[npIdx + 1], pixels[npIdx + 2])) {
            mask[nIdx] = 1;
            queue[qTail++] = nIdx;
          }
        }
      }
    }
  }

  // 3. Optional edge feathering for smooth transparent transitions
  const alphaMask = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    alphaMask[i] = mask[i] === 1 ? 0 : 1; // 1 = opaque foreground, 0 = transparent background
  }

  if (featherRadius > 0) {
    // 1D Gaussian horizontal pass
    const tempAlpha = new Float32Array(total);
    const radius = Math.min(10, Math.round(featherRadius));

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let count = 0;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < width) {
            sum += alphaMask[y * width + nx];
            count++;
          }
        }
        tempAlpha[y * width + x] = sum / count;
      }
    }

    // 1D Gaussian vertical pass
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const ny = y + dy;
          if (ny >= 0 && ny < height) {
            sum += tempAlpha[ny * width + x];
            count++;
          }
        }
        alphaMask[y * width + x] = sum / count;
      }
    }
  }

  // 4. Apply Alpha Mask to Pixel Buffer
  let removedPixelCount = 0;
  for (let i = 0; i < total; i++) {
    const pIdx = i * 4;
    const alpha = alphaMask[i];
    pixels[pIdx + 3] = Math.round(pixels[pIdx + 3] * alpha);
    if (pixels[pIdx + 3] === 0) {
      removedPixelCount++;
    }
  }

  return {
    buffer: pixels.buffer as ArrayBuffer,
    removedPixelCount,
  };
}
