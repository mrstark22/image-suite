/**
 * Reference implementation of the tonal lookup table, used only to check the
 * WASM core (`src/wasm/src/tonal.rs`), which is the app's one implementation.
 * It was the main-thread fast path until #16 removed that path; its maths was
 * verified in the November audit, so it serves as an independent reference.
 */
import type { TonalAdjustments } from '../../src/types/image';

export function buildTonalLUT(tonal: TonalAdjustments): Uint8Array {
  const lut = new Uint8Array(256);

  // 1. Exposure multiplier (2^EV)
  const expMult = Math.pow(2.0, tonal.exposure || 0);

  // 2. Levels (Black Point & White Point)
  const blackPt = Math.max(0, Math.min(254, tonal.blackPoint || 0));
  const whitePt = Math.max(blackPt + 1, Math.min(255, tonal.whitePoint ?? 255));
  const span = Math.max(1, whitePt - blackPt);

  // 3. Gamma / Midtones curve
  const baseGamma = Math.max(0.1, Math.min(5.0, tonal.gamma || 1.0));
  const midtoneShift = (tonal.midtones || 0) / 100;
  const effectiveGamma = baseGamma * Math.pow(2.0, midtoneShift);
  const invGamma = 1.0 / Math.max(effectiveGamma, 0.01);

  // 4. Contrast factor (S-curve slope)
  const contrast = tonal.contrast || 0;
  const contrastFactor = contrast >= 0 ? 1.0 + (contrast / 100) * 2.5 : (contrast + 100) / 100;

  // 5. Highlights, Shadows, Whites, Blacks
  const hFactor = (tonal.highlights || 0) / 100;
  const sFactor = (tonal.shadows || 0) / 100;
  const wFactor = (tonal.whites || 0) / 100;
  const bFactor = (tonal.blacks || 0) / 100;
  const clarityFactor = (tonal.clarity || 0) / 100;
  const invert = tonal.invert || false;

  for (let i = 0; i < 256; i++) {
    // Step A: Window levels
    let norm = (Math.max(blackPt, Math.min(whitePt, i)) - blackPt) / span;
    norm = Math.max(0.0, Math.min(1.0, norm));

    // Step B: Exposure scaling
    norm = Math.max(0.0, Math.min(1.0, norm * expMult));

    // Step C: Gamma & Midtones (guaranteed norm >= 0)
    norm = Math.pow(Math.max(0.0, norm), invGamma);

    // Step D: Shadows & Highlights adjustments
    if (sFactor !== 0) {
      const shadowWeight = Math.pow(Math.max(0.0, 1.0 - norm), 2.0);
      norm += sFactor * shadowWeight * 0.35;
    }
    if (hFactor !== 0) {
      const highlightWeight = Math.pow(Math.max(0.0, norm), 2.0);
      norm += hFactor * highlightWeight * 0.35;
    }

    // Step E: Whites & Blacks extremes
    if (bFactor !== 0) {
      const blackWeight = Math.pow(Math.max(0.0, 1.0 - norm), 3.0);
      norm += bFactor * blackWeight * 0.25;
    }
    if (wFactor !== 0) {
      const whiteWeight = Math.pow(Math.max(0.0, norm), 3.0);
      norm += wFactor * whiteWeight * 0.25;
    }

    // Step F: Clarity
    if (clarityFactor !== 0) {
      norm += clarityFactor * Math.sin(2.0 * Math.PI * Math.max(0.0, Math.min(1.0, norm))) * 0.12;
    }

    // Step G: Clamp norm before contrast and brightness
    norm = Math.max(0.0, Math.min(1.0, Number.isFinite(norm) ? norm : 0.0));
    let val = (norm * 255 - 128) * contrastFactor + 128 + (tonal.brightness || 0) * 1.28;

    // Step H: Invert
    if (invert) {
      val = 255 - val;
    }

    if (!Number.isFinite(val)) {
      val = i;
    }

    lut[i] = Math.max(0, Math.min(255, Math.round(val)));
  }

  return lut;
}
