//! Native Rust 3D Depth Map & Heightmap Relief Engine
//! Implements:
//! 1. 8-Point Chamfer Euclidean Distance Transform (EDT) with Scalable Bounded Bevels
//! 2. Full Dynamic Range Auto-Normalized Tonal Luminance (Maximizes 16-bit CNC Depth)
//! 3. Perspective Saliency Depth Estimation
//! 4. Separable 2D Gaussian Anti-Terracing Smoothing Filter
//! 5. 16-Bit Normalization (0 to 65,535) with Invert Z-Axis Support

#[allow(dead_code)]
pub struct DepthParams {
    pub source_mode: u32, // 0 = tonal-height, 1 = distance-transform, 2 = ai-estimation
    pub bevel_style: u32, // 0 = prismatic, 1 = dome, 2 = concave, 3 = flat
    pub invert_z: bool,
    pub smoothing_radius: f32, // 0 to 20 px
    pub depth_scale: f32,      // 1.0 to 10.0 (affects dynamic contrast and bevel width)
    pub relief_angle: f32,     // 15 to 90 degrees
}

/// Generates a full dynamic range 16-bit depth/height map buffer (0 - 65,535)
pub fn generate_depth_map_wasm(
    pixels: &[u8],
    width: usize,
    height: usize,
    params: &DepthParams,
) -> Vec<u16> {
    let total = width * height;
    if total == 0 {
        return Vec::new();
    }

    let mut height_map = vec![0.0f32; total];
    let scale_factor = params.depth_scale.clamp(1.0, 10.0);

    match params.source_mode {
        // 1. Distance Transform (EDT) for Vectors & Logos
        1 => {
            let inf = 1e6f32;
            let mut dist = vec![0.0f32; total];

            for i in 0..total {
                let idx = i * 4;
                let g = 0.299 * pixels[idx] as f32
                    + 0.587 * pixels[idx + 1] as f32
                    + 0.114 * pixels[idx + 2] as f32;
                let is_fg = g < 128.0;
                dist[i] = if is_fg { inf } else { 0.0 };
            }

            let d1 = 1.0f32;
            let d2 = std::f32::consts::SQRT_2;

            let w = width as isize;
            let h = height as isize;

            // Forward Pass
            for y in 0..h {
                for x in 0..w {
                    let idx = (y * w + x) as usize;
                    let mut d = dist[idx];
                    if d == 0.0 {
                        continue;
                    }

                    if x > 0 {
                        d = d.min(dist[idx - 1] + d1);
                    }
                    if y > 0 {
                        d = d.min(dist[idx - width] + d1);
                        if x > 0 {
                            d = d.min(dist[idx - width - 1] + d2);
                        }
                        if x < w - 1 {
                            d = d.min(dist[idx - width + 1] + d2);
                        }
                    }
                    dist[idx] = d;
                }
            }

            // Backward Pass
            let mut max_dist = 0.0f32;
            for y in (0..h).rev() {
                for x in (0..w).rev() {
                    let idx = (y * w + x) as usize;
                    let mut d = dist[idx];
                    if d == 0.0 {
                        continue;
                    }

                    if x < w - 1 {
                        d = d.min(dist[idx + 1] + d1);
                    }
                    if y < h - 1 {
                        d = d.min(dist[idx + width] + d1);
                        if x < w - 1 {
                            d = d.min(dist[idx + width + 1] + d2);
                        }
                        if x > 0 {
                            d = d.min(dist[idx + width - 1] + d2);
                        }
                    }
                    dist[idx] = d;
                    if d > max_dist && d < inf {
                        max_dist = d;
                    }
                }
            }

            // Dynamic Bevel Width scaled by depth_scale (from 15px up to 250px)
            let max_bevel = (scale_factor * 25.0).min(max_dist).max(2.0);

            for i in 0..total {
                let d = dist[i];
                if d == 0.0 {
                    height_map[i] = 0.0;
                } else {
                    let mut norm = (d / max_bevel).min(1.0);
                    match params.bevel_style {
                        1 => {
                            // Dome (Sinusoidal Convex Arc)
                            norm = (norm * std::f32::consts::FRAC_PI_2).sin();
                        }
                        2 => {
                            // Concave Bowl
                            norm = 1.0 - (norm * std::f32::consts::FRAC_PI_2).cos();
                        }
                        3 => {
                            // Flat Island
                            norm = if norm >= 0.98 { 1.0 } else { norm };
                        }
                        _ => {
                            // Prismatic (Linear 45° Chamfer)
                        }
                    }
                    height_map[i] = norm;
                }
            }
        }

        // 2. Perspective Saliency Depth Estimation
        2 => {
            let cx = width as f32 / 2.0;
            let cy = height as f32 / 2.0;
            let max_r = (cx * cx + cy * cy).sqrt();

            for y in 0..height {
                for x in 0..width {
                    let idx = y * width + x;
                    let p_idx = idx * 4;
                    let g = (0.299 * pixels[p_idx] as f32
                        + 0.587 * pixels[p_idx + 1] as f32
                        + 0.114 * pixels[p_idx + 2] as f32)
                        / 255.0;

                    let dx = x as f32 - cx;
                    let dy = y as f32 - (cy * 1.1);
                    let dist_from_center = (dx * dx + dy * dy).sqrt() / max_r;
                    let perspective_bias = (1.0 - dist_from_center * 0.7).max(0.0);

                    let depth_val = (1.0 - g) * 0.65 + perspective_bias * 0.35;
                    height_map[idx] = depth_val.clamp(0.0, 1.0);
                }
            }
        }

        // 0. Default: Tonal Luminance Height Mapping (Gamma-Correct BT.709)
        _ => {
            for i in 0..total {
                let p_idx = i * 4;
                let r = (pixels[p_idx] as f32) / 255.0;
                let g = (pixels[p_idx + 1] as f32) / 255.0;
                let b = (pixels[p_idx + 2] as f32) / 255.0;

                let lin_r = if r <= 0.04045 {
                    r / 12.92
                } else {
                    ((r + 0.055) / 1.055).powf(2.4)
                };
                let lin_g = if g <= 0.04045 {
                    g / 12.92
                } else {
                    ((g + 0.055) / 1.055).powf(2.4)
                };
                let lin_b = if b <= 0.04045 {
                    b / 12.92
                } else {
                    ((b + 0.055) / 1.055).powf(2.4)
                };

                let lum = 0.2126 * lin_r + 0.7152 * lin_g + 0.0722 * lin_b;
                // High-depth S-Curve contrast response
                let gamma = 1.0 / (0.65 + (scale_factor - 1.0) * 0.08);
                height_map[i] = lum.powf(gamma);
            }
        }
    }

    // -----------------------------------------------------------------
    // Full Dynamic Range Normalization (Maximizes 16-Bit CNC Depth)
    // -----------------------------------------------------------------
    let mut min_h = f32::MAX;
    let mut max_h = f32::MIN;

    for &h in &height_map {
        if h < min_h {
            min_h = h;
        }
        if h > max_h {
            max_h = h;
        }
    }

    let range = max_h - min_h;
    if range > 0.001 {
        for h in &mut height_map {
            *h = (*h - min_h) / range;
        }
    }

    // -----------------------------------------------------------------
    // Separable 2D Gaussian Smoothing (Anti-Terracing Filter)
    // -----------------------------------------------------------------
    if params.smoothing_radius > 0.05 {
        let radius = (params.smoothing_radius.round() as usize).min(15);
        if radius > 0 {
            let mut smoothed = vec![0.0f32; total];
            let sigma = params.smoothing_radius * 0.7 + 0.5;
            let two_sigma_sq = 2.0 * sigma * sigma;

            let mut weights = Vec::with_capacity(radius * 2 + 1);
            for d in -(radius as isize)..=(radius as isize) {
                let w = (-(d * d) as f32 / two_sigma_sq).exp();
                weights.push(w);
            }

            // Horizontal Pass
            for y in 0..height {
                for x in 0..width {
                    let mut sum = 0.0f32;
                    let mut weight_sum = 0.0f32;

                    for (ki, d) in (-(radius as isize)..=(radius as isize)).enumerate() {
                        let nx = x as isize + d;
                        if nx >= 0 && nx < width as isize {
                            let w = weights[ki];
                            sum += height_map[y * width + (nx as usize)] * w;
                            weight_sum += w;
                        }
                    }
                    smoothed[y * width + x] = sum / (weight_sum.max(0.0001));
                }
            }

            // Vertical Pass
            for y in 0..height {
                for x in 0..width {
                    let mut sum = 0.0f32;
                    let mut weight_sum = 0.0f32;

                    for (ki, d) in (-(radius as isize)..=(radius as isize)).enumerate() {
                        let ny = y as isize + d;
                        if ny >= 0 && ny < height as isize {
                            let w = weights[ki];
                            sum += smoothed[(ny as usize) * width + x] * w;
                            weight_sum += w;
                        }
                    }
                    height_map[y * width + x] = sum / (weight_sum.max(0.0001));
                }
            }
        }
    }

    // -----------------------------------------------------------------
    // Map to 16-Bit Array (0 to 65,535) with Invert Z Support
    // -----------------------------------------------------------------
    let mut depth16 = vec![0u16; total];

    for i in 0..total {
        let mut val = height_map[i];
        if params.invert_z {
            val = 1.0 - val;
        }
        val = val.clamp(0.0, 1.0);
        depth16[i] = (val * 65535.0).round() as u16;
    }

    depth16
}
