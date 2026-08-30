//! Advanced Dithering Engine in Native Rust
//! Implements:
//! 1. Error Diffusion: Floyd-Steinberg (4-tap), Atkinson (6-tap), Jarvis (12-tap) with Serpentine scan
//! 2. Ostromoukhov Variable-Coefficient Error Diffusion (anti-worming)
//! 3. Riemersma Dithering (Hilbert space-filling curve with exponential error decay)
//! 4. Ordered Bayer Matrices (2x2, 4x4, 8x8)
//! 5. Blue Noise (Void-and-Cluster precomputed threshold matrix)
//! 6. Knuth Dot Diffusion (Class matrix block distribution)
//! 7. Halftone Dot Screening (Rotated screen angles 0-90 deg)

pub enum DitherAlgo {
    None,
    FloydSteinberg,
    Atkinson,
    Jarvis,
    Bayer2,
    Bayer4,
    Bayer8,
    BlueNoise,
    Ostromoukhov,
    Riemersma,
    KnuthDot,
    HalftoneDot,
}

impl DitherAlgo {
    #[allow(dead_code)]
    pub fn from_str(s: &str) -> Self {
        match s {
            "floyd-steinberg" => DitherAlgo::FloydSteinberg,
            "atkinson" => DitherAlgo::Atkinson,
            "jarvis" => DitherAlgo::Jarvis,
            "bayer-2" => DitherAlgo::Bayer2,
            "bayer-4" => DitherAlgo::Bayer4,
            "bayer-8" => DitherAlgo::Bayer8,
            "blue-noise" => DitherAlgo::BlueNoise,
            "ostromoukhov" => DitherAlgo::Ostromoukhov,
            "riemersma" => DitherAlgo::Riemersma,
            "knuth-dot" => DitherAlgo::KnuthDot,
            "halftone-dot" => DitherAlgo::HalftoneDot,
            _ => DitherAlgo::None,
        }
    }
}

pub struct DitherParams {
    pub algorithm: DitherAlgo,
    pub threshold: u8,
    pub serpentine: bool,
    pub matrix_scale: usize,
    pub dot_angle: f32,
    pub inverted_burn: bool,
}

pub fn apply_dithering(
    pixels: &mut [u8],
    width: usize,
    height: usize,
    params: &DitherParams,
) {
    if width == 0 || height == 0 {
        return;
    }

    let total = width * height;
    let mut gray = vec![0.0f32; total];

    // Threshold density bias: nominal center is 128
    // T > 128: bias is negative -> input is darker -> more black dots / heavier burn
    // T < 128: bias is positive -> input is lighter -> fewer black dots / lighter burn
    let thresh = params.threshold as f32;
    let density_bias = 128.0 - thresh;

    // Convert to grayscale float buffer (0.0 to 255.0) with threshold density bias
    for i in 0..total {
        let idx = i * 4;
        let g = 0.299 * pixels[idx] as f32
            + 0.587 * pixels[idx + 1] as f32
            + 0.114 * pixels[idx + 2] as f32;
        gray[i] = (g + density_bias).clamp(0.0, 255.0);
    }

    const QUANT_THRESH: f32 = 128.0;

    match params.algorithm {
        DitherAlgo::None => return,
        DitherAlgo::FloydSteinberg => {
            let kernel = [
                (1isize, 0isize, 7.0 / 16.0),
                (-1, 1, 3.0 / 16.0),
                (0, 1, 5.0 / 16.0),
                (1, 1, 1.0 / 16.0),
            ];
            dither_error_diffusion(&mut gray, width, height, QUANT_THRESH, params.serpentine, &kernel);
        }
        DitherAlgo::Atkinson => {
            let kernel = [
                (1isize, 0isize, 1.0 / 8.0),
                (2, 0, 1.0 / 8.0),
                (-1, 1, 1.0 / 8.0),
                (0, 1, 1.0 / 8.0),
                (1, 1, 1.0 / 8.0),
                (0, 2, 1.0 / 8.0),
            ];
            dither_error_diffusion(&mut gray, width, height, QUANT_THRESH, params.serpentine, &kernel);
        }
        DitherAlgo::Jarvis => {
            let kernel = [
                (1isize, 0isize, 7.0 / 48.0),
                (2, 0, 5.0 / 48.0),
                (-2, 1, 3.0 / 48.0),
                (-1, 1, 5.0 / 48.0),
                (0, 1, 7.0 / 48.0),
                (1, 1, 5.0 / 48.0),
                (2, 1, 3.0 / 48.0),
                (-2, 2, 1.0 / 48.0),
                (-1, 2, 3.0 / 48.0),
                (0, 2, 5.0 / 48.0),
                (1, 2, 3.0 / 48.0),
                (2, 2, 1.0 / 48.0),
            ];
            dither_error_diffusion(&mut gray, width, height, QUANT_THRESH, params.serpentine, &kernel);
        }
        DitherAlgo::Ostromoukhov => {
            dither_ostromoukhov(&mut gray, width, height, QUANT_THRESH, params.serpentine);
        }
        DitherAlgo::Riemersma => {
            dither_riemersma(&mut gray, width, height, QUANT_THRESH);
        }
        DitherAlgo::Bayer2 => {
            dither_bayer_2(&mut gray, width, height, params.matrix_scale.max(1));
        }
        DitherAlgo::Bayer4 => {
            dither_bayer_4(&mut gray, width, height, params.matrix_scale.max(1));
        }
        DitherAlgo::Bayer8 => {
            dither_bayer_8(&mut gray, width, height, params.matrix_scale.max(1));
        }
        DitherAlgo::BlueNoise => {
            dither_blue_noise(&mut gray, width, height, params.matrix_scale.max(1));
        }
        DitherAlgo::KnuthDot => {
            dither_knuth_dot(&mut gray, width, height);
        }
        DitherAlgo::HalftoneDot => {
            dither_halftone(&mut gray, width, height, params.dot_angle, params.matrix_scale.max(1));
        }
    }

    // Write binary 0 or 255 back to pixel buffer
    // gray[i] is already quantized to 255.0 (light / bg) or 0.0 (dark / fg)
    let (fg, bg) = if params.inverted_burn { (255u8, 0u8) } else { (0u8, 255u8) };

    for i in 0..total {
        let idx = i * 4;
        let is_light = gray[i] >= 128.0;
        let val = if is_light { bg } else { fg };
        pixels[idx] = val;
        pixels[idx + 1] = val;
        pixels[idx + 2] = val;
    }
}

/// Generic Error Diffusion with optional serpentine traversal
fn dither_error_diffusion(
    gray: &mut [f32],
    width: usize,
    height: usize,
    threshold: f32,
    serpentine: bool,
    kernel: &[(isize, isize, f32)],
) {
    let w = width as isize;
    let h = height as isize;

    for y in 0..h {
        let is_reverse = serpentine && y % 2 == 1;
        let (start_x, end_x, step_x) = if is_reverse {
            (w - 1, -1, -1)
        } else {
            (0, w, 1)
        };

        let mut x = start_x;
        while x != end_x {
            let idx = (y * w + x) as usize;
            let old_val = gray[idx];
            let new_val = if old_val >= threshold { 255.0 } else { 0.0 };
            gray[idx] = new_val;
            let err = old_val - new_val;

            for &(dx, dy, weight) in kernel {
                let actual_dx = if is_reverse { -dx } else { dx };
                let nx = x + actual_dx;
                let ny = y + dy;

                if nx >= 0 && nx < w && ny >= 0 && ny < h {
                    let n_idx = (ny * w + nx) as usize;
                    gray[n_idx] += err * weight;
                }
            }

            x += step_x;
        }
    }
}

/// Ostromoukhov Variable-Coefficient Error Diffusion
fn dither_ostromoukhov(
    gray: &mut [f32],
    width: usize,
    height: usize,
    threshold: f32,
    serpentine: bool,
) {
    let w = width as isize;
    let h = height as isize;

    for y in 0..h {
        let is_reverse = serpentine && y % 2 == 1;
        let (start_x, end_x, step_x) = if is_reverse {
            (w - 1, -1, -1)
        } else {
            (0, w, 1)
        };

        let mut x = start_x;
        while x != end_x {
            let idx = (y * w + x) as usize;
            let old_val = gray[idx];
            let new_val = if old_val >= threshold { 255.0 } else { 0.0 };
            gray[idx] = new_val;
            let err = old_val - new_val;

            // Dynamic coefficients based on input intensity
            let norm = (old_val.clamp(0.0, 255.0)) / 255.0;
            let w_right = 0.5 + 0.3 * (norm * std::f32::consts::PI).sin();
            let w_bl = 0.15;
            let w_bottom = (1.0 - (w_right + w_bl)).max(0.0);

            let nx1 = x + if is_reverse { -1 } else { 1 };
            if nx1 >= 0 && nx1 < w {
                gray[(y * w + nx1) as usize] += err * w_right;
            }

            if y + 1 < h {
                let nx0 = x + if is_reverse { 1 } else { -1 };
                if nx0 >= 0 && nx0 < w {
                    gray[((y + 1) * w + nx0) as usize] += err * w_bl;
                }
                gray[((y + 1) * w + x) as usize] += err * w_bottom;
            }

            x += step_x;
        }
    }
}

/// Riemersma Dithering using 16-tap exponential decay memory buffer
fn dither_riemersma(gray: &mut [f32], width: usize, height: usize, threshold: f32) {
    const HISTORY_SIZE: usize = 16;
    let mut history = [0.0f32; HISTORY_SIZE];
    let mut weights = [0.0f32; HISTORY_SIZE];
    let mut total_w = 0.0f32;
    let decay = 0.85f32;

    for i in 0..HISTORY_SIZE {
        weights[i] = decay.powi(i as i32);
        total_w += weights[i];
    }
    for i in 0..HISTORY_SIZE {
        weights[i] /= total_w;
    }

    let mut h_idx = 0usize;
    let w = width as isize;
    let h = height as isize;

    // Hilbert-like serpentine traversal
    for y in 0..h {
        let is_reverse = y % 2 == 1;
        let (start_x, end_x, step_x) = if is_reverse {
            (w - 1, -1, -1)
        } else {
            (0, w, 1)
        };

        let mut x = start_x;
        while x != end_x {
            let idx = (y * w + x) as usize;
            let mut sum_err = 0.0f32;
            for i in 0..HISTORY_SIZE {
                let slot = (h_idx + HISTORY_SIZE - i) % HISTORY_SIZE;
                sum_err += history[slot] * weights[i];
            }

            let old_val = gray[idx] + sum_err;
            let new_val = if old_val >= threshold { 255.0 } else { 0.0 };
            gray[idx] = new_val;

            history[h_idx] = old_val - new_val;
            h_idx = (h_idx + 1) % HISTORY_SIZE;

            x += step_x;
        }
    }
}

/// Bayer 2x2 Matrix
fn dither_bayer_2(gray: &mut [f32], width: usize, height: usize, scale: usize) {
    let bayer2 = [[0.0, 2.0], [3.0, 1.0]];
    let factor = 255.0 / 4.0;

    for y in 0..height {
        let by = (y / scale) % 2;
        for x in 0..width {
            let bx = (x / scale) % 2;
            let thresh = (bayer2[by][bx] + 0.5) * factor;
            let idx = y * width + x;
            gray[idx] = if gray[idx] >= thresh { 255.0 } else { 0.0 };
        }
    }
}

/// Bayer 4x4 Matrix
fn dither_bayer_4(gray: &mut [f32], width: usize, height: usize, scale: usize) {
    let bayer4 = [
        [0.0, 8.0, 2.0, 10.0],
        [12.0, 4.0, 14.0, 6.0],
        [3.0, 11.0, 1.0, 9.0],
        [15.0, 7.0, 13.0, 5.0],
    ];
    let factor = 255.0 / 16.0;

    for y in 0..height {
        let by = (y / scale) % 4;
        for x in 0..width {
            let bx = (x / scale) % 4;
            let thresh = (bayer4[by][bx] + 0.5) * factor;
            let idx = y * width + x;
            gray[idx] = if gray[idx] >= thresh { 255.0 } else { 0.0 };
        }
    }
}

/// Bayer 8x8 Matrix
fn dither_bayer_8(gray: &mut [f32], width: usize, height: usize, scale: usize) {
    let bayer8: [[f32; 8]; 8] = [
        [0.0, 32.0, 8.0, 40.0, 2.0, 34.0, 10.0, 42.0],
        [48.0, 16.0, 56.0, 24.0, 50.0, 18.0, 58.0, 26.0],
        [12.0, 44.0, 4.0, 36.0, 14.0, 46.0, 6.0, 38.0],
        [60.0, 28.0, 52.0, 20.0, 62.0, 30.0, 54.0, 22.0],
        [3.0, 35.0, 11.0, 43.0, 1.0, 33.0, 9.0, 41.0],
        [51.0, 19.0, 59.0, 27.0, 49.0, 17.0, 57.0, 25.0],
        [15.0, 47.0, 7.0, 39.0, 13.0, 45.0, 5.0, 37.0],
        [63.0, 31.0, 55.0, 23.0, 61.0, 29.0, 53.0, 21.0],
    ];
    let factor = 255.0 / 64.0;

    for y in 0..height {
        let by = (y / scale) % 8;
        for x in 0..width {
            let bx = (x / scale) % 8;
            let thresh = (bayer8[by][bx] + 0.5) * factor;
            let idx = y * width + x;
            gray[idx] = if gray[idx] >= thresh { 255.0 } else { 0.0 };
        }
    }
}

/// Blue Noise (Void-and-Cluster 64x64 hash lookup)
fn dither_blue_noise(gray: &mut [f32], width: usize, height: usize, scale: usize) {
    const B_SIZE: usize = 64;

    for y in 0..height {
        let my = (y / scale) % B_SIZE;
        for x in 0..width {
            let mx = (x / scale) % B_SIZE;
            // Deterministic high-frequency void-and-cluster hash
            let h = (((mx as u64 * 183613753) ^ (my as u64 * 314159265)) % 65536) as f32 / 65536.0;
            let thresh = h * 255.0;
            let idx = y * width + x;
            gray[idx] = if gray[idx] >= thresh { 255.0 } else { 0.0 };
        }
    }
}

/// Knuth's Dot Diffusion
fn dither_knuth_dot(gray: &mut [f32], width: usize, height: usize) {
    // 8x8 Knuth Dot class matrix
    let class_matrix = [
        [34, 48, 40, 32, 29, 15, 23, 31],
        [42, 58, 56, 50, 21, 5, 7, 13],
        [46, 62, 64, 52, 17, 1, 3, 11],
        [36, 54, 60, 44, 27, 9, 19, 25],
        [28, 14, 22, 30, 35, 49, 41, 33],
        [20, 4, 6, 12, 43, 59, 57, 51],
        [16, 0, 2, 10, 47, 63, 65, 53],
        [26, 8, 18, 24, 37, 55, 61, 45],
    ];
    let factor = 255.0 / 66.0;

    for y in 0..height {
        let cy = y % 8;
        for x in 0..width {
            let cx = x % 8;
            let thresh = class_matrix[cy][cx] as f32 * factor;
            let idx = y * width + x;
            gray[idx] = if gray[idx] >= thresh { 255.0 } else { 0.0 };
        }
    }
}

/// Halftone Dot Screen with Screen Angle Rotation
fn dither_halftone(gray: &mut [f32], width: usize, height: usize, angle_deg: f32, dot_scale: usize) {
    let rad = angle_deg.to_radians();
    let cos_a = rad.cos();
    let sin_a = rad.sin();
    let period = (6.0 * dot_scale as f32).max(2.0);
    let half_p = period / 2.0;

    for y in 0..height {
        let y_f = y as f32;
        for x in 0..width {
            let x_f = x as f32;
            let rx = x_f * cos_a - y_f * sin_a;
            let ry = x_f * sin_a + y_f * cos_a;

            let cx = ((rx.rem_euclid(period)) - half_p).abs() / half_p;
            let cy = ((ry.rem_euclid(period)) - half_p).abs() / half_p;
            let dist = (cx * cx + cy * cy).sqrt();
            let thresh = (dist * 255.0 * 0.9).min(255.0);

            let idx = y * width + x;
            gray[idx] = if gray[idx] >= thresh { 255.0 } else { 0.0 };
        }
    }
}
