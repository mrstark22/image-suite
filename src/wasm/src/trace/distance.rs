//! Exact Euclidean distance transform (Felzenszwalb and Huttenlocher, 2012).

const INF: f32 = 1e20;

/// One-dimensional squared distance transform of `f` into `d` (lower envelope of parabolas).
fn dt_1d(f: &[f32], d: &mut [f32], v: &mut [usize], z: &mut [f32]) {
    let n = f.len();
    if n == 0 {
        return;
    }
    let mut k = 0usize;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    // Where the parabolas rooted at `q` and `p` (q > p) meet. In 64 bits and
    // with q² - p² as (q - p)(q + p): a 32-bit float holds q² exactly only up
    // to q = 4096, and images are larger than that.
    let meet = |q: usize, p: usize| -> f32 {
        let (qf, pf) = (q as f64, p as f64);
        (((f[q] as f64 - f[p] as f64) + (qf - pf) * (qf + pf)) / (2.0 * (qf - pf))) as f32
    };
    for q in 1..n {
        let mut s = meet(q, v[k]);
        // z[0] is -INF, so this stops at k = 0.
        while k > 0 && s <= z[k] {
            k -= 1;
            s = meet(q, v[k]);
        }
        k += 1;
        v[k] = q;
        z[k] = s;
        z[k + 1] = INF;
    }
    k = 0;
    for (q, dq) in d.iter_mut().enumerate() {
        while z[k + 1] < q as f32 {
            k += 1;
        }
        let p = v[k];
        let dx = q as f32 - p as f32;
        *dq = dx * dx + f[p];
    }
}

/// For every pixel where `inside[i]` is true, the Euclidean distance from its
/// centre to the centre of the nearest pixel that is not inside; 0 elsewhere.
/// Pixels beyond the image border count as not inside, so a shape touching
/// the border is measured to the border.
pub fn distance_to_outside(inside: &[bool], w: usize, h: usize) -> Vec<f32> {
    // Work on a grid padded by one pixel of outside on every side.
    let pw = w + 2;
    let ph = h + 2;
    let mut g = vec![0.0f32; pw * ph];
    for y in 0..h {
        for x in 0..w {
            if inside[y * w + x] {
                g[(y + 1) * pw + x + 1] = INF;
            }
        }
    }
    squared_edt_in_place(&mut g, pw, ph);
    let mut out = vec![0.0f32; w * h];
    for y in 0..h {
        for x in 0..w {
            out[y * w + x] = g[(y + 1) * pw + x + 1].sqrt();
        }
    }
    out
}

/// For every pixel, the distance from its centre to the centre of the nearest
/// pixel where `seed` is true (0 on seeds). Used for offset cutlines.
pub fn distance_to_seed(seed: &[bool], w: usize, h: usize) -> Vec<f32> {
    let mut g: Vec<f32> = seed.iter().map(|&s| if s { 0.0 } else { INF }).collect();
    squared_edt_in_place(&mut g, w, h);
    g.iter_mut().for_each(|v| *v = v.sqrt());
    g
}

/// Replaces each value (0 for a seed, INF otherwise) with its squared distance to the nearest seed.
fn squared_edt_in_place(g: &mut [f32], w: usize, h: usize) {
    let n = w.max(h);
    let mut f = vec![0.0f32; n];
    let mut d = vec![0.0f32; n];
    let mut v = vec![0usize; n];
    let mut z = vec![0.0f32; n + 1];
    // Columns.
    for x in 0..w {
        for y in 0..h {
            f[y] = g[y * w + x];
        }
        dt_1d(&f[..h], &mut d[..h], &mut v, &mut z);
        for y in 0..h {
            g[y * w + x] = d[y];
        }
    }
    // Rows.
    for y in 0..h {
        f[..w].copy_from_slice(&g[y * w..(y + 1) * w]);
        dt_1d(&f[..w], &mut d[..w], &mut v, &mut z);
        g[y * w..(y + 1) * w].copy_from_slice(&d[..w]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Past 4096 px a coordinate squared no longer fits a 32-bit float exactly
    /// (review of #84): the transform must still be exact on a long image.
    #[test]
    fn matches_brute_force_on_a_long_image() {
        let (w, h) = (7000usize, 3usize);
        // Outside pixels at irregular gaps of up to 120 px along the middle row.
        let mut inside = vec![true; w * h];
        let mut x = 5usize;
        while x < w {
            inside[w + x] = false;
            x += 7 + (x * 7919) % 113;
        }
        let dt = distance_to_outside(&inside, w, h);
        for x in 0..w {
            let i = w + x;
            if !inside[i] {
                assert_eq!(dt[i], 0.0);
                continue;
            }
            // The rows above and below the image are outside, 2 px away.
            let mut best = 2.0f64;
            for xx in x.saturating_sub(2)..(x + 3).min(w) {
                if !inside[w + xx] {
                    best = best.min((xx as f64 - x as f64).abs());
                }
            }
            if x < 2 || x + 2 >= w {
                best = best.min((x + 1).min(w - x) as f64);
            }
            assert!((dt[i] as f64 - best).abs() < 1e-4, "x = {x}: {} vs {best}", dt[i]);
        }
    }

    #[test]
    fn matches_brute_force() {
        let (w, h) = (17usize, 11usize);
        let inside: Vec<bool> = (0..w * h).map(|i| ((i * 7919) % 13) > 2).collect();
        let dt = distance_to_outside(&inside, w, h);
        for y in 0..h {
            for x in 0..w {
                let i = y * w + x;
                if !inside[i] {
                    assert_eq!(dt[i], 0.0);
                    continue;
                }
                let mut best = f32::MAX;
                for yy in -1..=(h as isize) {
                    for xx in -1..=(w as isize) {
                        let out = xx < 0
                            || yy < 0
                            || xx >= w as isize
                            || yy >= h as isize
                            || !inside[yy as usize * w + xx as usize];
                        if out {
                            let d = ((xx - x as isize).pow(2) + (yy - y as isize).pow(2)) as f32;
                            best = best.min(d.sqrt());
                        }
                    }
                }
                assert!((dt[i] - best).abs() < 1e-4, "({x},{y}) {} vs {best}", dt[i]);
            }
        }
    }
}
