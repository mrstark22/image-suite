//! Dithering Engine in Native Rust
//! Implements:
//! 1. Error Diffusion: Floyd-Steinberg (4-tap), Atkinson (6-tap), Jarvis (12-tap) with Serpentine scan
//! 2. Ordered Bayer Matrices (2x2, 4x4, 8x8)
//!
//! Each algorithm is checked against an independent reference in
//! `tests/unit/dither-properties.test.ts`. Add an algorithm only together with
//! a test that measures its defining property.

pub enum DitherAlgo {
    None,
    FloydSteinberg,
    Atkinson,
    Jarvis,
    Bayer2,
    Bayer4,
    Bayer8,
}

pub struct DitherParams {
    pub algorithm: DitherAlgo,
    pub threshold: u8,
    pub serpentine: bool,
    pub matrix_scale: usize,
    pub inverted_burn: bool,
}

pub fn apply_dithering(pixels: &mut [u8], width: usize, height: usize, params: &DitherParams) {
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
            dither_error_diffusion(
                &mut gray,
                width,
                height,
                QUANT_THRESH,
                params.serpentine,
                &kernel,
            );
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
            dither_error_diffusion(
                &mut gray,
                width,
                height,
                QUANT_THRESH,
                params.serpentine,
                &kernel,
            );
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
            dither_error_diffusion(
                &mut gray,
                width,
                height,
                QUANT_THRESH,
                params.serpentine,
                &kernel,
            );
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
    }

    // Write binary 0 or 255 back to pixel buffer
    // gray[i] is already quantized to 255.0 (light / bg) or 0.0 (dark / fg)
    let (fg, bg) = if params.inverted_burn {
        (255u8, 0u8)
    } else {
        (0u8, 255u8)
    };

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
