//! Preparing the image for tracing: edge-preserving denoise and the
//! black-and-white field.

/// Edge-preserving smoothing with a self-guided filter (He, Sun and Tang,
/// "Guided Image Filtering", 2010), applied to each colour channel of `rgba`
/// in place. Flat areas are averaged over a (2r+1)² window; across an edge,
/// where the local variance is far above `eps`, pixels keep their value. Every
/// step is a box filter computed with running sums, so the cost does not
/// depend on the radius (#32: the old bilateral filter took about 22 s).
pub fn guided_denoise(rgba: &mut [u8], w: usize, h: usize, radius: f64) {
    if radius <= 0.0 || w == 0 || h == 0 {
        return;
    }
    // Variance (in 8-bit levels squared) below which a window counts as flat: about 50 levels of noise.
    let eps = 50.0f32 * 50.0;
    let n = w * h;
    let mut i_ch = vec![0.0f32; n];
    let mut ii = vec![0.0f32; n];
    let mut mean_i = vec![0.0f32; n];
    let mut mean_ii = vec![0.0f32; n];
    let mut a = vec![0.0f32; n];
    let mut b = vec![0.0f32; n];
    let mut tmp = vec![0.0f32; n];
    let mut tmp2 = vec![0.0f32; n];
    for c in 0..3 {
        for k in 0..n {
            let v = rgba[k * 4 + c] as f32;
            i_ch[k] = v;
            ii[k] = v * v;
        }
        box_mean(&i_ch, &mut mean_i, &mut tmp, &mut tmp2, w, h, radius);
        box_mean(&ii, &mut mean_ii, &mut tmp, &mut tmp2, w, h, radius);
        for k in 0..n {
            let var = (mean_ii[k] - mean_i[k] * mean_i[k]).max(0.0);
            a[k] = var / (var + eps);
            b[k] = mean_i[k] - a[k] * mean_i[k];
        }
        // Average the coefficients over the window, reusing the mean buffers.
        box_mean(&a, &mut mean_i, &mut tmp, &mut tmp2, w, h, radius);
        box_mean(&b, &mut mean_ii, &mut tmp, &mut tmp2, w, h, radius);
        for k in 0..n {
            let q = mean_i[k] * i_ch[k] + mean_ii[k];
            rgba[k * 4 + c] = q.round().clamp(0.0, 255.0) as u8;
        }
    }
}

/// A 3x3 median of each colour channel, in place. After the guided filter it
/// removes the isolated pixels of grain the filter keeps next to an edge,
/// without moving a straight edge.
pub fn median3(rgba: &mut [u8], w: usize, h: usize) {
    if w < 3 || h < 3 {
        return;
    }
    let src = rgba.to_vec();
    let mut win = [0u8; 9];
    for y in 0..h {
        for x in 0..w {
            for c in 0..3 {
                let mut k = 0;
                for dy in [-1isize, 0, 1] {
                    for dx in [-1isize, 0, 1] {
                        let yy = (y as isize + dy).clamp(0, h as isize - 1) as usize;
                        let xx = (x as isize + dx).clamp(0, w as isize - 1) as usize;
                        win[k] = src[(yy * w + xx) * 4 + c];
                        k += 1;
                    }
                }
                win.sort_unstable();
                rgba[(y * w + x) * 4 + c] = win[4];
            }
        }
    }
}

/// Mean of `src` over a window of fractional radius `r`: the means over the
/// whole-pixel radii either side, mixed by the fraction. So the smoothing
/// grows smoothly with the radius, and a radius under a pixel (a small
/// setting at preview resolution) still does something (review of #84).
fn box_mean(
    src: &[f32],
    dst: &mut [f32],
    tmp: &mut [f32],
    lower: &mut [f32],
    w: usize,
    h: usize,
    r: f64,
) {
    let k = r.floor() as usize;
    let f = (r - k as f64) as f32;
    if k == 0 {
        lower.copy_from_slice(src);
    } else {
        box_filter(src, lower, tmp, w, h, k);
    }
    if f == 0.0 {
        dst.copy_from_slice(lower);
        return;
    }
    box_filter(src, dst, tmp, w, h, k + 1);
    for (d, l) in dst.iter_mut().zip(lower.iter()) {
        *d = *l * (1.0 - f) + *d * f;
    }
}

/// Mean of `src` over the (2r+1)² window around each pixel, clipped at the
/// image edges, into `dst`. `tmp` is scratch of the same size.
fn box_filter(src: &[f32], dst: &mut [f32], tmp: &mut [f32], w: usize, h: usize, r: usize) {
    // Horizontal pass into tmp (sums), vertical pass into dst, then divide by the window area.
    for y in 0..h {
        let row = &src[y * w..(y + 1) * w];
        let mut sum = 0.0f64;
        for v in row.iter().take(r.min(w - 1) + 1) {
            sum += *v as f64;
        }
        for x in 0..w {
            tmp[y * w + x] = sum as f32;
            if x + r + 1 < w {
                sum += row[x + r + 1] as f64;
            }
            if x >= r {
                sum -= row[x - r] as f64;
            }
        }
    }
    for x in 0..w {
        let mut sum = 0.0f64;
        for y in 0..=r.min(h - 1) {
            sum += tmp[y * w + x] as f64;
        }
        for y in 0..h {
            dst[y * w + x] = sum as f32;
            if y + r + 1 < h {
                sum += tmp[(y + r + 1) * w + x] as f64;
            }
            if y >= r {
                sum -= tmp[(y - r) * w + x] as f64;
            }
        }
    }
    for y in 0..h {
        let ny = (y + r).min(h - 1) - y.saturating_sub(r) + 1;
        for x in 0..w {
            let nx = (x + r).min(w - 1) - x.saturating_sub(r) + 1;
            dst[y * w + x] /= (nx * ny) as f32;
        }
    }
}

/// The black-and-white field: positive where a pixel is darker than
/// `threshold` (lighter when `invert`), scaled to about -1 to 1. Its zero
/// level is where an anti-aliased edge crosses the threshold.
pub fn mono_field(rgba: &[u8], w: usize, h: usize, threshold: f32, invert: bool) -> Vec<f32> {
    (0..w * h)
        .map(|k| {
            let l = 0.299 * rgba[k * 4] as f32
                + 0.587 * rgba[k * 4 + 1] as f32
                + 0.114 * rgba[k * 4 + 2] as f32;
            let v = if invert { l - threshold } else { threshold - l } / 255.0;
            // Exactly on the threshold counts as outside.
            if v == 0.0 {
                -1e-6
            } else {
                v
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn box_filter_is_the_window_mean() {
        let (w, h) = (7, 5);
        let src: Vec<f32> = (0..w * h).map(|i| (i * 13 % 17) as f32).collect();
        let mut dst = vec![0.0; w * h];
        let mut tmp = vec![0.0; w * h];
        box_filter(&src, &mut dst, &mut tmp, w, h, 2);
        for y in 0..h {
            for x in 0..w {
                let (mut s, mut c) = (0.0, 0.0);
                for yy in y.saturating_sub(2)..=(y + 2).min(h - 1) {
                    for xx in x.saturating_sub(2)..=(x + 2).min(w - 1) {
                        s += src[yy * w + xx];
                        c += 1.0;
                    }
                }
                assert!((dst[y * w + x] - s / c).abs() < 1e-4);
            }
        }
    }
}
