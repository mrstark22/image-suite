import type { DepthConfig, DepthViewMode, ReliefMaterial } from '../types/depth';

/**
 * Renders high-precision 3D Shaded Relief, False-Color Elevation Heatmaps,
 * or 2D Grayscale previews from a 16-bit heightmap buffer.
 */
export function renderReliefPreview(
  depth16: Uint16Array,
  width: number,
  height: number,
  config: DepthConfig
): Uint8ClampedArray {
  const total = width * height;
  const rgba = new Uint8ClampedArray(total * 4);

  const viewMode: DepthViewMode = config.viewMode || '3d-shaded';
  const material: ReliefMaterial = config.material || 'walnut';
  const scale = (config.depthScale || 3.0) * 12.0;
  const inv65535 = 1.0 / 65535.0;

  // Directional Light Vector
  const lightAngleRad = ((config.lightAngle ?? 315) * Math.PI) / 180;
  const lightElevRad = ((config.lightElevation ?? 45) * Math.PI) / 180;
  const lx = Math.cos(lightAngleRad) * Math.cos(lightElevRad);
  const ly = Math.sin(lightAngleRad) * Math.cos(lightElevRad);
  const lz = Math.sin(lightElevRad);

  // Precomputed Blinn-Phong Half-Vector (invariant across all pixels)
  const hx = lx;
  const hy = ly;
  const hz = lz + 1.0;
  const invHLen = 1.0 / (Math.sqrt(hx * hx + hy * hy + hz * hz) || 1.0);
  const hxNorm = hx * invHLen;
  const hyNorm = hy * invHLen;
  const hzNorm = hz * invHLen;

  const specularMultiplier = material === 'brass' ? 0.65 : 0.25;

  // Material Palettes
  const getMaterialColor = (mat: ReliefMaterial, zNorm: number, lightFactor: number): [number, number, number] => {
    switch (mat) {
      case 'walnut': {
        // Rich warm walnut wood: dark grain at bottom, warm golden amber at peaks
        const baseR = 120 + zNorm * 75;
        const baseG = 75 + zNorm * 55;
        const baseB = 40 + zNorm * 30;
        return [
          Math.min(255, baseR * lightFactor),
          Math.min(255, baseG * lightFactor),
          Math.min(255, baseB * lightFactor),
        ];
      }
      case 'brass': {
        // Metallic brushed brass
        const baseR = 210 + zNorm * 35;
        const baseG = 175 + zNorm * 30;
        const baseB = 75 + zNorm * 20;
        return [
          Math.min(255, baseR * lightFactor),
          Math.min(255, baseG * lightFactor),
          Math.min(255, baseB * lightFactor),
        ];
      }
      case 'slate': {
        // Precision dark ceramic / slate
        const base = 90 + zNorm * 70;
        return [
          Math.min(255, (base + 10) * lightFactor),
          Math.min(255, (base + 15) * lightFactor),
          Math.min(255, (base + 25) * lightFactor),
        ];
      }
      case 'heat': {
        // Turbo elevation heatmap (Blue -> Cyan -> Green -> Yellow -> Red)
        let r = 0, g = 0, b = 0;
        if (zNorm < 0.25) {
          const t = zNorm / 0.25;
          r = 0; g = Math.round(t * 255); b = 255;
        } else if (zNorm < 0.5) {
          const t = (zNorm - 0.25) / 0.25;
          r = 0; g = 255; b = Math.round((1 - t) * 255);
        } else if (zNorm < 0.75) {
          const t = (zNorm - 0.5) / 0.25;
          r = Math.round(t * 255); g = 255; b = 0;
        } else {
          const t = (zNorm - 0.75) / 0.25;
          r = 255; g = Math.round((1 - t) * 255); b = 0;
        }
        return [
          Math.min(255, r * lightFactor),
          Math.min(255, g * lightFactor),
          Math.min(255, b * lightFactor),
        ];
      }
      case 'grayscale':
      default: {
        // Monochrome Relief
        const val = Math.min(255, (zNorm * 200 + 40) * lightFactor);
        return [val, val, val];
      }
    }
  };

  for (let y = 0; y < height; y++) {
    const rowIdx = y * width;
    const yUp = Math.max(0, y - 1) * width;
    const yDown = Math.min(height - 1, y + 1) * width;

    for (let x = 0; x < width; x++) {
      const idx = rowIdx + x;
      const zVal = depth16[idx];
      const zNorm = zVal * inv65535;
      const pIdx = idx * 4;

      if (viewMode === 'grayscale') {
        const g = Math.round(zVal / 256);
        rgba[pIdx] = g;
        rgba[pIdx + 1] = g;
        rgba[pIdx + 2] = g;
        rgba[pIdx + 3] = 255;
        continue;
      }

      // Calculate Surface Normal vector N = (-dz/dx, -dz/dy, 1)
      const xLeft = Math.max(0, x - 1);
      const xRight = Math.min(width - 1, x + 1);

      const zL = depth16[rowIdx + xLeft] * inv65535;
      const zR = depth16[rowIdx + xRight] * inv65535;
      const zU = depth16[yUp + x] * inv65535;
      const zD = depth16[yDown + x] * inv65535;

      const dzdx = (zR - zL) * scale;
      const dzdy = (zD - zU) * scale;

      const invNormLen = 1.0 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1.0);
      const nx = -dzdx * invNormLen;
      const ny = -dzdy * invNormLen;
      const nz = invNormLen;

      // Diffuse Lambertian Lighting
      const dot = nx * lx + ny * ly + nz * lz;
      const diffuse = Math.max(0, dot);
      const ambient = 0.35;

      // Specular Blinn-Phong highlight
      const specDot = Math.max(0, nx * hxNorm + ny * hyNorm + nz * hzNorm);
      const specular = Math.pow(specDot, 24.0) * specularMultiplier;

      // Matching Cavity Ambient Occlusion
      const avgSurround = (zL + zR + zU + zD) * 0.25;
      const cavity = Math.max(0.0, avgSurround - zNorm);
      const ao = 1.0 - Math.min(0.45, cavity * 4.0);

      const totalLight = Math.min(1.6, (ambient + diffuse * 0.75) * ao + specular);

      const [r, g, b] = getMaterialColor(material, zNorm, totalLight);
      rgba[pIdx] = Math.round(r);
      rgba[pIdx + 1] = Math.round(g);
      rgba[pIdx + 2] = Math.round(b);
      rgba[pIdx + 3] = 255;
    }
  }

  return rgba;
}
