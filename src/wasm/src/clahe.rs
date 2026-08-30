//! CLAHE (Contrast Limited Adaptive Histogram Equalization) in Rust

pub fn apply_clahe(
    pixels: &mut [u8],
    width: usize,
    height: usize,
    clip_limit: f32,
    grid_size: usize,
) {
    if width == 0 || height == 0 || grid_size == 0 {
        return;
    }

    let tile_w = (width / grid_size).max(4);
    let tile_h = (height / grid_size).max(4);
    let tiles_x = (width + tile_w - 1) / tile_w;
    let tiles_y = (height + tile_h - 1) / tile_h;

    // Compute tile histograms and CDFs
    let mut cdfs = Vec::with_capacity(tiles_x * tiles_y);
    let clip_val = (((tile_w * tile_h) as f32 / 256.0) * clip_limit).round() as u32;

    for ty in 0..tiles_y {
        for tx in 0..tiles_x {
            let mut hist = [0u32; 256];
            let start_x = tx * tile_w;
            let end_x = (start_x + tile_w).min(width);
            let start_y = ty * tile_h;
            let end_y = (start_y + tile_h).min(height);
            let tile_pixel_count = (end_x - start_x) * (end_y - start_y);

            for y in start_y..end_y {
                for x in start_x..end_x {
                    let idx = (y * width + x) * 4;
                    let gray = ((0.299 * pixels[idx] as f32
                        + 0.587 * pixels[idx + 1] as f32
                        + 0.114 * pixels[idx + 2] as f32)
                        .round() as usize)
                        .clamp(0, 255);
                    hist[gray] += 1;
                }
            }

            // Clip histogram
            let mut excess = 0u32;
            for val in hist.iter_mut() {
                if *val > clip_val {
                    excess += *val - clip_val;
                    *val = clip_val;
                }
            }

            let bonus = excess / 256;
            for val in hist.iter_mut() {
                *val += bonus;
            }

            // Build Cumulative Distribution Function (CDF)
            let mut cdf = [0.0f32; 256];
            let mut sum = 0u32;
            let count_f = if tile_pixel_count == 0 { 1.0 } else { tile_pixel_count as f32 };
            for i in 0..256 {
                sum += hist[i];
                cdf[i] = (sum as f32) / count_f;
            }
            cdfs.push(cdf);
        }
    }

    // Bilinear interpolation across tiles
    for y in 0..height {
        let ty = (y / tile_h).min(tiles_y.saturating_sub(1));
        let next_ty = (ty + 1).min(tiles_y.saturating_sub(1));
        let dy = (y % tile_h) as f32 / tile_h as f32;

        for x in 0..width {
            let tx = (x / tile_w).min(tiles_x.saturating_sub(1));
            let next_tx = (tx + 1).min(tiles_x.saturating_sub(1));
            let dx = (x % tile_w) as f32 / tile_w as f32;

            let idx = (y * width + x) * 4;
            let gray = ((0.299 * pixels[idx] as f32
                + 0.587 * pixels[idx + 1] as f32
                + 0.114 * pixels[idx + 2] as f32)
                .round() as usize)
                .clamp(0, 255);

            let cdf_tl = cdfs[ty * tiles_x + tx][gray];
            let cdf_tr = cdfs[ty * tiles_x + next_tx][gray];
            let cdf_bl = cdfs[next_ty * tiles_x + tx][gray];
            let cdf_br = cdfs[next_ty * tiles_x + next_tx][gray];

            let top = cdf_tl * (1.0 - dx) + cdf_tr * dx;
            let bot = cdf_bl * (1.0 - dx) + cdf_br * dx;
            let final_val = ((top * (1.0 - dy) + bot * dy) * 255.0).round().clamp(0.0, 255.0) as u8;

            pixels[idx] = final_val;
            pixels[idx + 1] = final_val;
            pixels[idx + 2] = final_val;
        }
    }
}
