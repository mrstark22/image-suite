//! CLAHE (Contrast Limited Adaptive Histogram Equalization) in Rust
//! Optimized with precomputed coordinate lookup tables and fast integer luminance

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
                let row_offset = y * width;
                for x in start_x..end_x {
                    let idx = (row_offset + x) * 4;
                    // Fast integer perceptual luminance (0.299R + 0.587G + 0.114B ~= (77R + 150G + 29B) >> 8)
                    let gray = ((pixels[idx] as u32 * 77
                        + pixels[idx + 1] as u32 * 150
                        + pixels[idx + 2] as u32 * 29)
                        >> 8) as usize;
                    hist[gray.min(255)] += 1;
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
            let count_f = if tile_pixel_count == 0 {
                1.0
            } else {
                tile_pixel_count as f32
            };
            for i in 0..256 {
                sum += hist[i];
                cdf[i] = (sum as f32) / count_f;
            }
            cdfs.push(cdf);
        }
    }

    // Precompute X coordinate mapping tables (eliminates 4M divisions per frame)
    let max_tx = tiles_x.saturating_sub(1);
    let mut tx_arr = Vec::with_capacity(width);
    let mut next_tx_arr = Vec::with_capacity(width);
    let mut dx_arr = Vec::with_capacity(width);
    let inv_tile_w = 1.0 / tile_w as f32;

    for x in 0..width {
        let tx = (x / tile_w).min(max_tx);
        let next_tx = (tx + 1).min(max_tx);
        let dx = (x % tile_w) as f32 * inv_tile_w;
        tx_arr.push(tx);
        next_tx_arr.push(next_tx);
        dx_arr.push(dx);
    }

    let max_ty = tiles_y.saturating_sub(1);
    let inv_tile_h = 1.0 / tile_h as f32;

    // Bilinear interpolation across tiles
    for y in 0..height {
        let ty = (y / tile_h).min(max_ty);
        let next_ty = (ty + 1).min(max_ty);
        let dy = (y % tile_h) as f32 * inv_tile_h;
        let row_offset = y * width;
        let ty_row = ty * tiles_x;
        let next_ty_row = next_ty * tiles_x;

        for x in 0..width {
            let tx = tx_arr[x];
            let next_tx = next_tx_arr[x];
            let dx = dx_arr[x];

            let idx = (row_offset + x) * 4;
            let gray = ((pixels[idx] as u32 * 77
                + pixels[idx + 1] as u32 * 150
                + pixels[idx + 2] as u32 * 29)
                >> 8) as usize;
            let gray_clamped = gray.min(255);

            let cdf_tl = cdfs[ty_row + tx][gray_clamped];
            let cdf_tr = cdfs[ty_row + next_tx][gray_clamped];
            let cdf_bl = cdfs[next_ty_row + tx][gray_clamped];
            let cdf_br = cdfs[next_ty_row + next_tx][gray_clamped];

            let top = cdf_tl * (1.0 - dx) + cdf_tr * dx;
            let bot = cdf_bl * (1.0 - dx) + cdf_br * dx;
            let final_val = ((top * (1.0 - dy) + bot * dy) * 255.0) as u8;

            pixels[idx] = final_val;
            pixels[idx + 1] = final_val;
            pixels[idx + 2] = final_val;
        }
    }
}
