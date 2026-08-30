import type { DepthConfig, DepthResult } from '../types/depth';

/**
 * Professional 3D Depth Map & Heightmap Relief Generator.
 * Implements:
 * 1. Tonal Luminance Height Mapping with multi-scale Gaussian smoothing (Ideal for photos & artwork)
 * 2. True 8-direction Euclidean / Chamfer Distance Transform with bounded bevels (Ideal for logos & vectors)
 * 3. Perspective Saliency Depth estimation
 */
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255.0;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function generateDepthMap(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  config: DepthConfig
): DepthResult {
  const total = width * height;
  const depth16 = new Uint16Array(total);
  const heightMap = new Float32Array(total);

  const {
    source = 'tonal-height',
    bevelStyle = 'prismatic',
    invertZ = false,
    smoothingRadius = 2.0,
  } = config;

  if (source === 'distance-transform') {
    // -------------------------------------------------------------
    // 1. True 8-Point Chamfer Euclidean Distance Transform (EDT)
    // -------------------------------------------------------------
    const INF = 1e6;
    const dist = new Float32Array(total);

    // Binarize input: foreground is where ink/graphic exists (dark on light, or light on dark)
    // Default: dark pixels (g < 128) or non-white pixels are foreground
    for (let i = 0; i < total; i++) {
      const idx = i * 4;
      const g = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
      const isForeground = g < 128;
      // Distance is 0 at boundary/background, INF inside shape
      dist[i] = isForeground ? INF : 0;
    }

    const D1 = 1.0;
    const D2 = Math.SQRT2; // 1.4142

    // Forward Pass (Top-to-Bottom, Left-to-Right: 4 neighbors)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        let d = dist[idx];
        if (d === 0) continue;

        if (x > 0) d = Math.min(d, dist[idx - 1] + D1);
        if (y > 0) {
          d = Math.min(d, dist[idx - width] + D1);
          if (x > 0) d = Math.min(d, dist[idx - width - 1] + D2);
          if (x < width - 1) d = Math.min(d, dist[idx - width + 1] + D2);
        }
        dist[idx] = d;
      }
    }

    // Backward Pass (Bottom-to-Top, Right-to-Left: 4 neighbors)
    let maxDist = 0;
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        const idx = y * width + x;
        let d = dist[idx];
        if (d === 0) continue;

        if (x < width - 1) d = Math.min(d, dist[idx + 1] + D1);
        if (y < height - 1) {
          d = Math.min(d, dist[idx + width] + D1);
          if (x < width - 1) d = Math.min(d, dist[idx + width + 1] + D2);
          if (x > 0) d = Math.min(d, dist[idx + width - 1] + D2);
        }
        dist[idx] = d;
        if (d > maxDist && d < INF) maxDist = d;
      }
    }

    // Clamp maximum bevel width (e.g. 40px radius) so large shapes form flat islands with beveled edges
    const maxBevel = Math.max(1, Math.min(maxDist, 45.0));

    for (let i = 0; i < total; i++) {
      let d = dist[i];
      if (d === 0) {
        heightMap[i] = 0;
      } else {
        let norm = Math.min(1.0, d / maxBevel);
        if (bevelStyle === 'dome') {
          norm = Math.sin((norm * Math.PI) / 2);
        } else if (bevelStyle === 'concave') {
          norm = 1.0 - Math.cos((norm * Math.PI) / 2);
        } else if (bevelStyle === 'flat') {
          norm = norm >= 0.99 ? 1.0 : norm;
        }
        heightMap[i] = norm;
      }
    }
  } else if (source === 'ai-estimation') {
    // -------------------------------------------------------------
    // 2. Perspective Saliency Depth Estimation (Subject Lift)
    // -------------------------------------------------------------
    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.hypot(cx, cy);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const pIdx = idx * 4;
        const g = (0.299 * pixels[pIdx] + 0.587 * pixels[pIdx + 1] + 0.114 * pixels[pIdx + 2]) / 255;

        // Radial focal gradient (subjects near center & bottom are closer)
        const distFromCenter = Math.hypot(x - cx, y - cy * 1.1) / maxR;
        const perspectiveBias = Math.max(0, 1.0 - distFromCenter * 0.7);

        // Combine inverted luminance with perspective bias
        const depthVal = (1.0 - g) * 0.65 + perspectiveBias * 0.35;
        heightMap[idx] = Math.max(0, Math.min(1.0, depthVal));
      }
    }
  } else {
    // -------------------------------------------------------------
    // 3. Tonal Luminance Height Mapping (Standard Photo / Artwork Relief)
    // -------------------------------------------------------------
    for (let i = 0; i < total; i++) {
      const pIdx = i * 4;
      const r = pixels[pIdx] || 0;
      const g = pixels[pIdx + 1] || 0;
      const b = pixels[pIdx + 2] || 0;
      // Gamma-correct perceptual luminance normalized to 0.0 - 1.0
      let lum = 0.2126 * SRGB_TO_LINEAR[r] + 0.7152 * SRGB_TO_LINEAR[g] + 0.0722 * SRGB_TO_LINEAR[b];

      // Enhance contrast curves for rich tactile relief
      lum = Math.pow(lum, 0.9);
      heightMap[i] = lum;
    }
  }

  // -------------------------------------------------------------
  // Multi-Scale 2D Gaussian Smoothing (Anti-Terracing Filter)
  // -------------------------------------------------------------
  if (smoothingRadius > 0) {
    const radius = Math.min(15, Math.round(smoothingRadius));
    const smoothed = new Float32Array(total);
    const sigma = smoothingRadius * 0.7 + 0.5;
    const twoSigmaSq = 2 * sigma * sigma;

    // Precompute 1D kernel weights (0 Math.exp calls in loop)
    const weights = new Float32Array(2 * radius + 1);
    for (let d = -radius; d <= radius; d++) {
      weights[d + radius] = Math.exp(-(d * d) / twoSigmaSq);
    }

    // Horizontal Gaussian Pass
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let weightSum = 0;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < width) {
            const w = weights[dx + radius];
            sum += heightMap[rowOffset + nx] * w;
            weightSum += w;
          }
        }
        smoothed[rowOffset + x] = sum / (weightSum || 1);
      }
    }

    // Vertical Gaussian Pass
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let weightSum = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const ny = y + dy;
          if (ny >= 0 && ny < height) {
            const w = weights[dy + radius];
            sum += smoothed[ny * width + x] * w;
            weightSum += w;
          }
        }
        heightMap[y * width + x] = sum / (weightSum || 1);
      }
    }
  }

  // -------------------------------------------------------------
  // Map to 16-Bit Array (0 to 65,535) with Invert Z support
  // -------------------------------------------------------------
  let minZ = 65535;
  let maxZ = 0;

  for (let i = 0; i < total; i++) {
    let val = heightMap[i];
    if (invertZ) {
      val = 1.0 - val;
    }
    const val16 = Math.max(0, Math.min(65535, Math.round(val * 65535)));
    depth16[i] = val16;

    if (val16 < minZ) minZ = val16;
    if (val16 > maxZ) maxZ = val16;
  }

  return {
    heightMapBuffer: depth16.buffer as ArrayBuffer,
    width,
    height,
    is16Bit: true,
    minZ,
    maxZ,
  };
}
