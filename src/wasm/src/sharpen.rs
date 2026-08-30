//! High-pass Edge Sharpening and Unsharp Masking filter

pub fn apply_unsharp_mask(
    pixels: &mut [u8],
    width: usize,
    height: usize,
    amount: f32,
    radius: f32,
) {
    if width == 0 || height == 0 || amount <= 0.0 {
        return;
    }

    let r = radius.round().clamp(1.0, 5.0) as isize;
    let total = width * height;
    let mut blurred = vec![0.0f32; total * 3];

    // Horizontal Gaussian pass
    let mut temp = vec![0.0f32; total * 3];
    let sigma = radius * 0.6 + 0.3;
    let two_sigma_sq = 2.0 * sigma * sigma;

    for y in 0..height {
        for x in 0..width {
            let mut sum_r = 0.0f32;
            let mut sum_g = 0.0f32;
            let mut sum_b = 0.0f32;
            let mut weight_sum = 0.0f32;

            for dx in -r..=r {
                let nx = x as isize + dx;
                if nx >= 0 && nx < width as isize {
                    let w = (-(dx * dx) as f32 / two_sigma_sq).exp();
                    let p_idx = (y * width + nx as usize) * 4;
                    sum_r += pixels[p_idx] as f32 * w;
                    sum_g += pixels[p_idx + 1] as f32 * w;
                    sum_b += pixels[p_idx + 2] as f32 * w;
                    weight_sum += w;
                }
            }

            let t_idx = (y * width + x) * 3;
            temp[t_idx] = sum_r / weight_sum;
            temp[t_idx + 1] = sum_g / weight_sum;
            temp[t_idx + 2] = sum_b / weight_sum;
        }
    }

    // Vertical Gaussian pass
    for y in 0..height {
        for x in 0..width {
            let mut sum_r = 0.0f32;
            let mut sum_g = 0.0f32;
            let mut sum_b = 0.0f32;
            let mut weight_sum = 0.0f32;

            for dy in -r..=r {
                let ny = y as isize + dy;
                if ny >= 0 && ny < height as isize {
                    let w = (-(dy * dy) as f32 / two_sigma_sq).exp();
                    let t_idx = (ny as usize * width + x) * 3;
                    sum_r += temp[t_idx] * w;
                    sum_g += temp[t_idx + 1] * w;
                    sum_b += temp[t_idx + 2] * w;
                    weight_sum += w;
                }
            }

            let b_idx = (y * width + x) * 3;
            blurred[b_idx] = sum_r / weight_sum;
            blurred[b_idx + 1] = sum_g / weight_sum;
            blurred[b_idx + 2] = sum_b / weight_sum;
        }
    }

    // Apply Unsharp Mask formula: Orig + Amount * (Orig - Blurred)
    for i in 0..total {
        let p_idx = i * 4;
        let b_idx = i * 3;

        for c in 0..3 {
            let orig = pixels[p_idx + c] as f32;
            let blur = blurred[b_idx + c];
            let diff = orig - blur;
            let sharp = orig + diff * amount;
            pixels[p_idx + c] = sharp.round().clamp(0.0, 255.0) as u8;
        }
    }
}
