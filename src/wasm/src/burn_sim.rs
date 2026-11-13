//! Burn simulation preview (#41): how a dithered image should look burned.
//!
//! Each black pixel of the dithered image is one laser dot, burned as a round
//! spot of diameter `spot_px` (in pixels of the dot grid) centred on its
//! pixel. A spot larger than the pitch overlaps its neighbours (dot gain);
//! one smaller leaves unburned gaps. Each output pixel is coloured by the
//! fraction of it that burned spots cover, measured on a 4 x 4 grid of
//! sample points, mixed from `base` (unburned material) to `burn` (a fully
//! burned dot). It is a view only and never reaches an exported file.

const SUB: usize = 4;

/// Replaces the RGBA8 dithered image at `pixels` with its simulated burn.
/// Alpha is left as it is.
pub fn simulate_burn(
    pixels: &mut [u8],
    width: usize,
    height: usize,
    spot_px: f32,
    base: [u8; 3],
    burn: [u8; 3],
) {
    if width == 0 || height == 0 {
        return;
    }
    let radius = (spot_px.max(0.0)) / 2.0;
    let reach = (radius + 0.5).ceil() as isize;
    // For each neighbour offset, which of a pixel's sample points a spot centred there covers.
    let side = (2 * reach + 1) as usize;
    let mut masks = vec![0u16; side * side];
    for dy in -reach..=reach {
        for dx in -reach..=reach {
            let mut m = 0u16;
            for sy in 0..SUB {
                for sx in 0..SUB {
                    // Sample point relative to this pixel's centre.
                    let px = (sx as f32 + 0.5) / SUB as f32 - 0.5;
                    let py = (sy as f32 + 0.5) / SUB as f32 - 0.5;
                    let ex = px - dx as f32;
                    let ey = py - dy as f32;
                    if ex * ex + ey * ey <= radius * radius {
                        m |= 1 << (sy * SUB + sx);
                    }
                }
            }
            masks[((dy + reach) as usize) * side + (dx + reach) as usize] = m;
        }
    }

    let burned: Vec<bool> = (0..width * height).map(|i| pixels[i * 4] < 128).collect();
    let (w, h) = (width as isize, height as isize);
    for y in 0..h {
        for x in 0..w {
            let mut cover = 0u16;
            for dy in -reach..=reach {
                let ny = y + dy;
                if ny < 0 || ny >= h {
                    continue;
                }
                for dx in -reach..=reach {
                    let nx = x + dx;
                    if nx < 0 || nx >= w || !burned[(ny * w + nx) as usize] {
                        continue;
                    }
                    cover |= masks[((dy + reach) as usize) * side + (dx + reach) as usize];
                }
            }
            let f = cover.count_ones() as f32 / (SUB * SUB) as f32;
            let idx = ((y * w + x) * 4) as usize;
            for c in 0..3 {
                let v = base[c] as f32 + (burn[c] as f32 - base[c] as f32) * f;
                pixels[idx + c] = v.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
}
