//! Unsharp mask: each colour channel plus `amount` times its difference from
//! a Gaussian blur of itself.
//!
//! The blur's sigma is `radius * 0.6 + 0.3` pixels and its kernel extends
//! `ceil(3 * sigma)` pixels each side, with no upper limit, so a radius given
//! in millimetres keeps its physical effect at any resolution. The blur runs
//! one channel at a time, so it needs 8 bytes of scratch per pixel.

/// Sigma of the Gaussian blur for a radius in pixels.
pub fn sigma_for_radius(radius: f32) -> f32 {
    radius.max(0.0) * 0.6 + 0.3
}

/// How far the kernel extends each side of the centre, in pixels.
pub fn kernel_extent(sigma: f32) -> usize {
    (3.0 * sigma).ceil().max(1.0) as usize
}

/// The normalised-later weights of a 1D Gaussian of `sigma`, from `-extent` to `extent`.
fn gaussian_weights(sigma: f32) -> Vec<f32> {
    let extent = kernel_extent(sigma) as isize;
    let two_sigma_sq = 2.0 * sigma * sigma;
    (-extent..=extent).map(|d| (-((d * d) as f32) / two_sigma_sq).exp()).collect()
}

pub fn apply_unsharp_mask(pixels: &mut [u8], width: usize, height: usize, amount: f32, radius: f32) {
    if width == 0 || height == 0 || amount <= 0.0 {
        return;
    }

    let weights = gaussian_weights(sigma_for_radius(radius));
    let extent = (weights.len() / 2) as isize;
    let total = width * height;
    let mut across = vec![0.0f32; total];
    let mut blurred = vec![0.0f32; total];

    for channel in 0..3 {
        // Horizontal pass.
        for y in 0..height {
            for x in 0..width {
                let mut sum = 0.0f32;
                let mut weight_sum = 0.0f32;
                let lo = (x as isize - extent).max(0);
                let hi = (x as isize + extent).min(width as isize - 1);
                for nx in lo..=hi {
                    let w = weights[(nx - x as isize + extent) as usize];
                    sum += pixels[(y * width + nx as usize) * 4 + channel] as f32 * w;
                    weight_sum += w;
                }
                across[y * width + x] = sum / weight_sum;
            }
        }
        // Vertical pass.
        for y in 0..height {
            let lo = (y as isize - extent).max(0);
            let hi = (y as isize + extent).min(height as isize - 1);
            for x in 0..width {
                let mut sum = 0.0f32;
                let mut weight_sum = 0.0f32;
                for ny in lo..=hi {
                    let w = weights[(ny - y as isize + extent) as usize];
                    sum += across[ny as usize * width + x] * w;
                    weight_sum += w;
                }
                blurred[y * width + x] = sum / weight_sum;
            }
        }
        // Orig + amount * (orig - blurred).
        for (px, &blur) in pixels.chunks_exact_mut(4).zip(blurred.iter()) {
            let orig = px[channel] as f32;
            let sharp = orig + (orig - blur) * amount;
            px[channel] = sharp.round().clamp(0.0, 255.0) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_kernel_follows_sigma_with_no_clamp() {
        assert_eq!(kernel_extent(sigma_for_radius(1.5)), 4); // sigma 1.2
        assert_eq!(kernel_extent(sigma_for_radius(20.0)), 37); // sigma 12.3
        assert_eq!(kernel_extent(sigma_for_radius(0.0)), 1);
    }

    #[test]
    fn a_large_radius_reaches_further_than_the_old_5_px_clamp() {
        // A white step on a 60 px wide grey row: with a 20 px radius, a pixel
        // 10 px from the edge is still darkened; a 5 px kernel could not see it.
        let (w, h) = (60, 3);
        let mut px = vec![255u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let v = if x < 30 { 100 } else { 200 };
                let i = (y * w + x) * 4;
                px[i] = v;
                px[i + 1] = v;
                px[i + 2] = v;
            }
        }
        apply_unsharp_mask(&mut px, w, h, 1.0, 20.0);
        let at = |x: usize| px[(w + x) * 4];
        assert!(at(19) < 100, "10 px from the edge: {}", at(19));
        assert!(at(40) > 200, "10 px from the edge: {}", at(40));
    }
}
