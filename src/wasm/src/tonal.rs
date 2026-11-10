//! Fast Tonal & Color Adjustments using Precomputed LUTs (Lookup Tables)

pub struct TonalParams {
    pub exposure: f32,   // -3.0 to 3.0 EV
    pub brightness: f32, // -100 to 100
    pub contrast: f32,   // -100 to 100
    pub midtones: f32,   // -100 to 100
    pub highlights: f32, // -100 to 100
    pub shadows: f32,    // -100 to 100
    pub whites: f32,     // -100 to 100
    pub blacks: f32,     // -100 to 100
    pub clarity: f32,    // -100 to 100
    pub gamma: f32,      // 0.1 to 3.0
    pub black_point: u8,
    pub white_point: u8,
    pub invert: bool,
    pub grayscale_mode: u8, // 0: none, 1: rec709, 2: average, 3: desaturate, 4: max, 5: inverted
}

pub struct ColorParams {
    pub saturation: f32,  // -100 to 100
    pub vibrance: f32,    // -100 to 100
    pub temperature: f32, // -100 to 100
    pub tint: f32,        // -100 to 100
}

/// Computes a 256-byte Lookup Table for photographic and substrate tonal mapping
pub fn compute_tonal_lut(params: &TonalParams) -> [u8; 256] {
    let mut lut = [0u8; 256];

    // 1. Exposure factor (2^EV)
    let exp_mult = (2.0f32).powf(params.exposure);

    // 2. Levels (Black & White Point)
    let bp = params.black_point as f32;
    let wp = (params.white_point.max(params.black_point.saturating_add(1))) as f32;
    let span = (wp - bp).max(1.0);

    // 3. Gamma & Midtones curve
    let base_gamma = if params.gamma <= 0.01 {
        1.0
    } else {
        params.gamma
    };
    let midtone_shift = params.midtones / 100.0;
    let effective_gamma = base_gamma * (2.0f32).powf(midtone_shift);
    let inv_gamma = 1.0 / effective_gamma.max(0.01);

    // 4. Contrast factor (S-curve slope)
    let contrast_factor = if params.contrast >= 0.0 {
        1.0 + (params.contrast / 100.0) * 2.5
    } else {
        (params.contrast + 100.0) / 100.0
    };

    // 5. Highlights, Shadows, Whites, Blacks, Clarity
    let h_factor = params.highlights / 100.0;
    let s_factor = params.shadows / 100.0;
    let w_factor = params.whites / 100.0;
    let b_factor = params.blacks / 100.0;
    let clarity_factor = params.clarity / 100.0;

    for i in 0..256 {
        let raw = i as f32;
        // Step A: Window levels
        let clamped = raw.clamp(bp, wp);
        let mut norm = (clamped - bp) / span;

        // Step B: Exposure scaling
        norm = (norm * exp_mult).clamp(0.0, 1.0);

        // Step C: Gamma & Midtones
        norm = norm.powf(inv_gamma);

        // Step D: Shadows & Highlights
        if s_factor != 0.0 {
            let shadow_weight = (1.0 - norm).powi(2);
            norm += s_factor * shadow_weight * 0.35;
        }
        if h_factor != 0.0 {
            let highlight_weight = norm.powi(2);
            norm += h_factor * highlight_weight * 0.35;
        }

        // Step E: Whites & Blacks extremes
        if b_factor != 0.0 {
            let black_weight = (1.0 - norm).powi(3);
            norm += b_factor * black_weight * 0.25;
        }
        if w_factor != 0.0 {
            let white_weight = norm.powi(3);
            norm += w_factor * white_weight * 0.25;
        }

        // Step F: Clarity (Midtone local contrast)
        if clarity_factor != 0.0 {
            norm += clarity_factor * (2.0 * std::f32::consts::PI * norm).sin() * 0.12;
        }

        // Step G: Centered Contrast & Brightness
        norm = norm.clamp(0.0, 1.0);
        let mut val = (norm * 255.0 - 128.0) * contrast_factor + 128.0 + params.brightness * 1.28;

        // Step H: Invert
        if params.invert {
            val = 255.0 - val;
        }

        lut[i] = val.round().clamp(0.0, 255.0) as u8;
    }

    lut
}

/// Applies tonal LUT and color temperature/tint/saturation/vibrance/grayscale to raw RGBA pixel slice in-place
pub fn apply_tonal_and_color(
    pixels: &mut [u8],
    width: usize,
    height: usize,
    tonal: &TonalParams,
    color: &ColorParams,
) {
    let total_pixels = width * height;
    let lut = compute_tonal_lut(tonal);

    let sat_factor = if color.saturation >= 0.0 {
        1.0 + (color.saturation / 100.0) * 2.0
    } else {
        (color.saturation + 100.0) / 100.0
    };

    let vibrance_factor = color.vibrance / 100.0;
    let temp_k = color.temperature / 100.0;
    let tint_k = color.tint / 100.0;

    let has_color_adjust = sat_factor != 1.0
        || vibrance_factor != 0.0
        || temp_k != 0.0
        || tint_k != 0.0
        || tonal.grayscale_mode != 0;

    for i in 0..total_pixels {
        let idx = i * 4;
        let mut r = lut[pixels[idx] as usize] as f32;
        let mut g = lut[pixels[idx + 1] as usize] as f32;
        let mut b = lut[pixels[idx + 2] as usize] as f32;

        if has_color_adjust {
            if tonal.grayscale_mode != 0 {
                let gray = match tonal.grayscale_mode {
                    1 => 0.2126 * r + 0.7152 * g + 0.0722 * b, // Rec.709 Photometric
                    2 => (r + g + b) / 3.0,                    // Average
                    3 => (r.max(g).max(b) + r.min(g).min(b)) / 2.0, // Desaturate
                    4 => r.max(g).max(b),                      // Max
                    5 => 255.0 - (0.2126 * r + 0.7152 * g + 0.0722 * b), // Inverted
                    _ => 0.2126 * r + 0.7152 * g + 0.0722 * b,
                };
                r = gray;
                g = gray;
                b = gray;
            } else {
                // White Balance
                if temp_k != 0.0 {
                    r = (r + temp_k * 50.0).clamp(0.0, 255.0);
                    b = (b - temp_k * 50.0).clamp(0.0, 255.0);
                }
                if tint_k != 0.0 {
                    g = (g + tint_k * 40.0).clamp(0.0, 255.0);
                }

                // Saturation & Vibrance
                if sat_factor != 1.0 || vibrance_factor != 0.0 {
                    let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                    let max_c = r.max(g).max(b);
                    let min_c = r.min(g).min(b);
                    let current_sat = if max_c == 0.0 {
                        0.0
                    } else {
                        (max_c - min_c) / max_c
                    };

                    let vib_boost = vibrance_factor * (1.0 - current_sat) * 1.5;
                    let total_sat = (sat_factor + vib_boost).max(0.0);

                    r = (luma + (r - luma) * total_sat).clamp(0.0, 255.0);
                    g = (luma + (g - luma) * total_sat).clamp(0.0, 255.0);
                    b = (luma + (b - luma) * total_sat).clamp(0.0, 255.0);
                }
            }
        }

        pixels[idx] = r as u8;
        pixels[idx + 1] = g as u8;
        pixels[idx + 2] = b as u8;
    }
}
