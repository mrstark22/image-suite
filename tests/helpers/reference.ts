/**
 * Independent reference implementations used to check the WASM core. They
 * follow the definitions directly (exact sRGB curves, 2D area overlap) rather
 * than the module's tables or separable passes.
 */

/** Linear light (0 to 1) of an 8-bit sRGB value. */
export function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** The 8-bit sRGB value of linear light `l`, rounded. */
export function linearToSrgb(l: number): number {
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

/** An encoded value composited onto white: round(c * a / 255 + 255 * (1 - a / 255)). */
export function flattenOnWhite(c: number, a: number): number {
  return Math.round((c * a) / 255 + 255 * (1 - a / 255));
}

/**
 * Shrinks the opaque-after-flattening RGBA image `src` (`w` x `h`) to
 * `dw` x `dh` by averaging, in linear light, the area each output pixel covers.
 */
export function areaDownscale(src: Uint8Array, w: number, h: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh * 4);
  const sx = w / dw;
  const sy = h / dh;
  for (let oy = 0; oy < dh; oy++) {
    const y0 = oy * sy;
    const y1 = Math.min(h, (oy + 1) * sy);
    for (let ox = 0; ox < dw; ox++) {
      const x0 = ox * sx;
      const x1 = Math.min(w, (ox + 1) * sx);
      const acc = [0, 0, 0];
      let area = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const hy = Math.min(y1, y + 1) - Math.max(y0, y);
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const hx = Math.min(x1, x + 1) - Math.max(x0, x);
          const i = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) acc[c] += srgbToLinear(flattenOnWhite(src[i + c], src[i + 3])) * hx * hy;
          area += hx * hy;
        }
      }
      const o = (oy * dw + ox) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = linearToSrgb(acc[c] / area);
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * A deterministic photo-like colour image: smooth gradients, a few hard-edged
 * shapes, striped texture (14.5 px apart by default) and mild per-pixel noise.
 */
export function photoLike(
  w: number,
  h: number,
  seed = 1,
  detail: { noise?: boolean; texturePeriodPx?: number } = {}
): Uint8Array {
  const { noise: withNoise = true, texturePeriodPx = 14.5 } = detail;
  let s = seed;
  const noise = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return ((s >> 8) & 15) - 7.5;
  };
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      let r = 40 + 170 * u + 20 * Math.sin(v * 9);
      let g = 60 + 120 * v + 25 * Math.sin(u * 13 + v * 5);
      let b = 200 - 140 * u * v;
      // A dark disc and a bright bar with hard edges.
      if ((u - 0.35) ** 2 + (v - 0.55) ** 2 < 0.03) [r, g, b] = [r * 0.3, g * 0.25, b * 0.35];
      if (u > 0.62 && u < 0.7 && v > 0.15 && v < 0.85) [r, g, b] = [235, 225, 210];
      // Texture: stripes `texturePeriodPx` pixels apart.
      const t = 12 * Math.sin(((x + y * 0.5) * 2 * Math.PI) / texturePeriodPx);
      const n = () => (withNoise ? noise() : 0);
      const i = (y * w + x) * 4;
      out[i] = clamp(r + t + n());
      out[i + 1] = clamp(g + t + n());
      out[i + 2] = clamp(b + t + n());
      out[i + 3] = 255;
    }
  }
  return out;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * A line drawing under uneven light, the case the adaptive threshold is for:
 * dark ink strokes `strokePx` wide on paper lit from one corner, so the paper
 * on the dark side is darker than the ink on the bright side would allow a
 * single threshold to separate.
 */
export function shadedDrawing(w: number, h: number, strokePx: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const spacing = strokePx * 6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const light = 1 - 0.45 * ((x / w + y / h) / 2);
      // Grid of strokes plus circles, all at least `strokePx` wide.
      const onGrid = x % spacing < strokePx || y % spacing < strokePx * 1.5;
      const cx = (x % (spacing * 3)) - spacing * 1.5;
      const cy = (y % (spacing * 3)) - spacing * 1.5;
      const ring = Math.abs(Math.hypot(cx, cy) - spacing) < strokePx / 2;
      const v = Math.round((onGrid || ring ? 45 : 235) * light);
      const i = (y * w + x) * 4;
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}
