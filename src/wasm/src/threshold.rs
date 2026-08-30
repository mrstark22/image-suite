//! Adaptive Thresholding using O(1) Integral Images

pub fn apply_adaptive_threshold(
    pixels: &mut [u8],
    width: usize,
    height: usize,
    block_size: usize,
    constant: f32,
) {
    if width == 0 || height == 0 || block_size == 0 {
        return;
    }

    let half_block = (block_size / 2) as isize;
    let total = width * height;

    let mut gray = vec![0u8; total];
    let mut integral = vec![0.0f64; (width + 1) * (height + 1)];

    // 1. Build grayscale & 2D Integral Image
    for y in 0..height {
        for x in 0..width {
            let idx = (y * width + x) * 4;
            let g = (0.299 * pixels[idx] as f32
                + 0.587 * pixels[idx + 1] as f32
                + 0.114 * pixels[idx + 2] as f32)
                .round()
                .clamp(0.0, 255.0) as u8;
            gray[y * width + x] = g;

            integral[(y + 1) * (width + 1) + (x + 1)] = g as f64
                + integral[y * (width + 1) + (x + 1)]
                + integral[(y + 1) * (width + 1) + x]
                - integral[y * (width + 1) + x];
        }
    }

    // 2. Query neighborhood sum in O(1)
    for y in 0..height {
        let y0 = (y as isize - half_block).max(0) as usize;
        let y1 = (y as isize + half_block + 1).min(height as isize) as usize;

        for x in 0..width {
            let x0 = (x as isize - half_block).max(0) as usize;
            let x1 = (x as isize + half_block + 1).min(width as isize) as usize;

            let count = ((x1 - x0) * (y1 - y0)) as f64;
            let sum = integral[y1 * (width + 1) + x1]
                - integral[y0 * (width + 1) + x1]
                - integral[y1 * (width + 1) + x0]
                + integral[y0 * (width + 1) + x0];

            let mean = (sum / count) as f32;
            let g = gray[y * width + x] as f32;
            let val = if g < (mean - constant) { 0u8 } else { 255u8 };

            let idx = (y * width + x) * 4;
            pixels[idx] = val;
            pixels[idx + 1] = val;
            pixels[idx + 2] = val;
        }
    }
}
