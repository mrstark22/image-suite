//! CLAHE (Contrast Limited Adaptive Histogram Equalization).
//!
//! The image is split into `grid_size` x `grid_size` tiles (fewer when the
//! image is smaller than that in pixels) whose edges are spread evenly over the
//! image, so no tile is a sliver when a side is not divisible by the grid
//! (#36). Each tile's histogram is clipped at `clip_limit` times its own mean
//! bin count, and every clipped count is given back evenly to all bins, so
//! each tile's mapping covers exactly its own pixels. Pixels take the mapping
//! of the four nearest tile centres, bilinearly weighted.
//!
//! Properties (tests in `tests/unit/clahe.test.ts`): pure white stays pure
//! white, and a flat image stays flat, for any image size and grid.

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

    let tiles_x = grid_size.min(width);
    let tiles_y = grid_size.min(height);
    // Tile i spans [edges[i], edges[i + 1]).
    let edges = |tiles: usize, len: usize| -> Vec<usize> {
        (0..=tiles).map(|i| i * len / tiles).collect::<Vec<_>>()
    };
    let xs = edges(tiles_x, width);
    let ys = edges(tiles_y, height);

    let luma = |p: &[u8], idx: usize| -> usize {
        ((p[idx] as u32 * 77 + p[idx + 1] as u32 * 150 + p[idx + 2] as u32 * 29 + 128) >> 8)
            .min(255) as usize
    };

    // One 256-entry mapping per tile, in 0..=255.
    let mut maps: Vec<[f32; 256]> = Vec::with_capacity(tiles_x * tiles_y);
    for ty in 0..tiles_y {
        for tx in 0..tiles_x {
            let mut hist = [0f32; 256];
            for y in ys[ty]..ys[ty + 1] {
                for x in xs[tx]..xs[tx + 1] {
                    hist[luma(pixels, (y * width + x) * 4)] += 1.0;
                }
            }
            let count = ((xs[tx + 1] - xs[tx]) * (ys[ty + 1] - ys[ty])) as f32;
            // Clip relative to this tile's own area, then give the excess back evenly.
            let clip = clip_limit.max(1.0) * count / 256.0;
            let mut excess = 0f32;
            for v in hist.iter_mut() {
                if *v > clip {
                    excess += *v - clip;
                    *v = clip;
                }
            }
            let bonus = excess / 256.0;
            let mut map = [0f32; 256];
            let mut sum = 0f32;
            for i in 0..256 {
                sum += hist[i] + bonus;
                map[i] = (sum / count * 255.0).min(255.0);
            }
            maps.push(map);
        }
    }

    // For each coordinate: the two neighbouring tile centres and the weight of the second.
    let lerp_table = |edges: &[usize], len: usize| -> Vec<(usize, usize, f32)> {
        let tiles = edges.len() - 1;
        let centres: Vec<f32> = (0..tiles)
            .map(|i| (edges[i] + edges[i + 1]) as f32 / 2.0)
            .collect();
        (0..len)
            .map(|p| {
                let c = p as f32 + 0.5;
                if c <= centres[0] {
                    return (0, 0, 0.0);
                }
                if c >= centres[tiles - 1] {
                    return (tiles - 1, tiles - 1, 0.0);
                }
                let mut i = 0;
                while centres[i + 1] < c {
                    i += 1;
                }
                let t = (c - centres[i]) / (centres[i + 1] - centres[i]);
                (i, i + 1, t)
            })
            .collect()
    };
    let lx = lerp_table(&xs, width);
    let ly = lerp_table(&ys, height);

    for (y, &(ty0, ty1, fy)) in ly.iter().enumerate() {
        for (x, &(tx0, tx1, fx)) in lx.iter().enumerate() {
            let idx = (y * width + x) * 4;
            let g = luma(pixels, idx);
            let tl = maps[ty0 * tiles_x + tx0][g];
            let tr = maps[ty0 * tiles_x + tx1][g];
            let bl = maps[ty1 * tiles_x + tx0][g];
            let br = maps[ty1 * tiles_x + tx1][g];
            let top = tl + (tr - tl) * fx;
            let bot = bl + (br - bl) * fx;
            let v = (top + (bot - top) * fy).round().clamp(0.0, 255.0) as u8;
            pixels[idx] = v;
            pixels[idx + 1] = v;
            pixels[idx + 2] = v;
        }
    }
}
