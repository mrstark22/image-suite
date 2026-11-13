//! Relief heightmaps (docs/plan.md, workflow C).
//!
//! One function, `generate_heightmap`, turns an RGBA8 image (and, for the AI
//! source, a depth estimate) into the heightmap that both the 3D view and the
//! export use. Heights stay `f32` until the final conversion to 16 bits.
//!
//! Sources:
//! - **Tone** (`SOURCE_TONE`): height is the pixel's grey value (Rec. 709
//!   luma of the encoded sRGB values), light high.
//! - **Shape** (`SOURCE_SHAPE`): the image is split at mid grey into shape
//!   and background; each shape pixel's height is a bevel profile of its
//!   exact Euclidean distance to the nearest background pixel.
//! - **Estimate** (`SOURCE_ESTIMATE`): a depth estimate from a model (near is
//!   high), resampled to the image, plus an optional amount of the image's
//!   fine tonal detail.
//! - **Auto** (`SOURCE_AUTO`): Shape when the image is nearly two-tone (a
//!   logo or drawing), Tone otherwise; see `classify_source`.
//!
//! Then, in this order: Gaussian smoothing, normalisation to the full range
//! (so the highest point is always the configured maximum depth, smoothing
//! or not), optional inversion, and conversion to 16 bits.

pub const SOURCE_TONE: u32 = 0;
pub const SOURCE_SHAPE: u32 = 1;
pub const SOURCE_ESTIMATE: u32 = 2;
pub const SOURCE_AUTO: u32 = 3;

/// Bevel profiles of the Shape source, as functions of `t`, the distance from
/// the edge divided by the bevel width, clamped to 0..1.
/// - Chamfer: `h = t` (a straight slope).
/// - Round: `h = sqrt(1 - (1 - t)^2)` (a quarter circle, convex).
/// - Cove: `h = 1 - sqrt(1 - t^2)` (a quarter circle, concave).
#[allow(dead_code)] // Named for the tests and readers; it is the default arm of `bevel_profile`.
pub const PROFILE_CHAMFER: u32 = 0;
pub const PROFILE_ROUND: u32 = 1;
pub const PROFILE_COVE: u32 = 2;

pub struct DepthParams {
    /// One of the `SOURCE_*` codes.
    pub source: u32,
    /// One of the `PROFILE_*` codes (Shape source).
    pub profile: u32,
    /// Shape source: the shape is the light part of the image instead of the dark part.
    pub shape_is_light: bool,
    /// Carve instead of raise: heights are flipped after normalisation.
    pub invert: bool,
    /// Standard deviation of the Gaussian smoothing, in pixels; 0 for none.
    pub smoothing_px: f32,
    /// Shape source: the width over which the bevel rises, in pixels.
    pub bevel_px: f32,
    /// Estimate source: how much of the image's fine tonal detail is added, 0 to 1.
    pub detail: f32,
}

/// A depth estimate at its own size, larger values nearer.
pub struct Estimate<'a> {
    pub values: &'a [f32],
    pub width: usize,
    pub height: usize,
}

/// Rec. 709 luma of the encoded sRGB values, 0 to 1.
fn luma(pixels: &[u8], i: usize) -> f32 {
    let p = i * 4;
    (0.2126 * pixels[p] as f32 + 0.7152 * pixels[p + 1] as f32 + 0.0722 * pixels[p + 2] as f32)
        / 255.0
}

/// The source `SOURCE_AUTO` resolves to: Shape when at least 90% of the
/// pixels are near black or near white (luma under 0.2 or over 0.8), Tone
/// otherwise.
pub fn classify_source(pixels: &[u8], width: usize, height: usize) -> u32 {
    let total = width * height;
    if total == 0 {
        return SOURCE_TONE;
    }
    let extreme = (0..total)
        .filter(|&i| {
            let l = luma(pixels, i);
            !(0.2..=0.8).contains(&l)
        })
        .count();
    if extreme as f64 >= 0.9 * total as f64 {
        SOURCE_SHAPE
    } else {
        SOURCE_TONE
    }
}

/// The source `params.source` stands for on this image (Auto resolved).
pub fn resolve_source(pixels: &[u8], width: usize, height: usize, source: u32) -> u32 {
    if source == SOURCE_AUTO {
        classify_source(pixels, width, height)
    } else {
        source
    }
}

/// The heightmap of `pixels` (`width` x `height` RGBA8), 0 to 65535, high is
/// raised. Returns an empty buffer when the estimate source has no estimate.
pub fn generate_heightmap(
    pixels: &[u8],
    width: usize,
    height: usize,
    params: &DepthParams,
    estimate: Option<Estimate>,
) -> Vec<u16> {
    let total = width * height;
    if total == 0 {
        return Vec::new();
    }
    let source = resolve_source(pixels, width, height, params.source);
    let mut h: Vec<f32> = match source {
        SOURCE_SHAPE => shape_heights(pixels, width, height, params),
        SOURCE_ESTIMATE => match estimate {
            Some(e) => estimate_heights(pixels, width, height, &e, params.detail),
            None => return Vec::new(),
        },
        _ => (0..total).map(|i| luma(pixels, i)).collect(),
    };
    if params.smoothing_px > 0.0 {
        gaussian_blur(&mut h, width, height, params.smoothing_px);
    }
    normalise(&mut h);
    h.iter()
        .map(|&v| {
            let v = if params.invert { 1.0 - v } else { v };
            (v.clamp(0.0, 1.0) * 65535.0).round() as u16
        })
        .collect()
}

/// Bevel profile `profile` at `t` (0 at the edge, 1 at full height).
pub fn bevel_profile(profile: u32, t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    match profile {
        PROFILE_ROUND => (1.0 - (1.0 - t) * (1.0 - t)).sqrt(),
        PROFILE_COVE => 1.0 - (1.0 - t * t).sqrt(),
        // PROFILE_CHAMFER, and any unknown code.
        _ => t,
    }
}

fn shape_heights(pixels: &[u8], width: usize, height: usize, params: &DepthParams) -> Vec<f32> {
    let total = width * height;
    let inside: Vec<bool> = (0..total)
        .map(|i| (luma(pixels, i) < 0.5) != params.shape_is_light)
        .collect();
    let dist2 = edt_squared(&inside, width, height);
    let bevel = params.bevel_px.max(0.5);
    dist2
        .iter()
        .map(|&d2| {
            if d2 == 0 {
                0.0
            } else {
                bevel_profile(params.profile, (d2 as f64).sqrt() as f32 / bevel)
            }
        })
        .collect()
}

/// Squared distance used for "no background pixel in this line yet".
const FAR: f64 = 1e20;

/// Exact squared Euclidean distance from each `inside` pixel to the nearest
/// pixel that is not inside (0 outside), by the separable lower-envelope
/// algorithm of Felzenszwalb and Huttenlocher (2012). Measured between pixel
/// centres. When nothing is outside, every distance is `u32::MAX`.
pub fn edt_squared(inside: &[bool], width: usize, height: usize) -> Vec<u32> {
    let n = width.max(height);
    let mut f = vec![0.0f64; n];
    let mut d = vec![0.0f64; n];
    let mut v = vec![0usize; n];
    let mut z = vec![0.0f64; n + 1];
    let mut cols = vec![0.0f64; width * height];
    // Columns: the distance to the nearest outside pixel in the same column.
    for x in 0..width {
        for y in 0..height {
            f[y] = if inside[y * width + x] { FAR } else { 0.0 };
        }
        envelope(&f[..height], &mut d[..height], &mut v, &mut z);
        for y in 0..height {
            cols[y * width + x] = d[y];
        }
    }
    // Rows: combine the column distances along each row.
    let mut out = vec![0u32; width * height];
    for y in 0..height {
        f[..width].copy_from_slice(&cols[y * width..(y + 1) * width]);
        envelope(&f[..width], &mut d[..width], &mut v, &mut z);
        for x in 0..width {
            out[y * width + x] = if d[x] >= FAR / 2.0 {
                u32::MAX
            } else {
                d[x].round() as u32
            };
        }
    }
    out
}

/// One-dimensional squared distance transform of the sampled function `f`:
/// `d[q] = min over p of (q - p)^2 + f[p]`.
fn envelope(f: &[f64], d: &mut [f64], v: &mut [usize], z: &mut [f64]) {
    let n = f.len();
    if n == 0 {
        return;
    }
    // Only finite samples take part; with none, everything stays far.
    let first = match (0..n).find(|&q| f[q] < FAR) {
        Some(q) => q,
        None => {
            d.iter_mut().for_each(|x| *x = FAR);
            return;
        }
    };
    let mut k = 0usize;
    v[0] = first;
    z[0] = f64::NEG_INFINITY;
    z[1] = f64::INFINITY;
    for q in first + 1..n {
        if f[q] >= FAR {
            continue;
        }
        loop {
            let p = v[k];
            let s =
                ((f[q] + (q * q) as f64) - (f[p] + (p * p) as f64)) / (2.0 * (q as f64 - p as f64));
            if s <= z[k] && k > 0 {
                k -= 1;
                continue;
            }
            if s <= z[k] {
                // k == 0 and the new parabola is lower everywhere left of it.
                v[0] = q;
                z[0] = f64::NEG_INFINITY;
                z[1] = f64::INFINITY;
                break;
            }
            k += 1;
            v[k] = q;
            z[k] = s;
            z[k + 1] = f64::INFINITY;
            break;
        }
    }
    let mut k = 0usize;
    for (q, out) in d.iter_mut().enumerate().take(n) {
        while z[k + 1] < q as f64 {
            k += 1;
        }
        let p = v[k];
        let dq = q as f64 - p as f64;
        *out = dq * dq + f[p];
    }
}

fn estimate_heights(
    pixels: &[u8],
    width: usize,
    height: usize,
    e: &Estimate,
    detail: f32,
) -> Vec<f32> {
    let mut h = resample_bilinear(e.values, e.width, e.height, width, height);
    normalise(&mut h);
    if detail > 0.0 {
        let total = width * height;
        let lum: Vec<f32> = (0..total).map(|i| luma(pixels, i)).collect();
        let mut base = lum.clone();
        // Fine detail: the image minus a blur at 1% of its longest edge.
        gaussian_blur(
            &mut base,
            width,
            height,
            (width.max(height) as f32 / 100.0).max(1.0),
        );
        for i in 0..total {
            h[i] += detail * (lum[i] - base[i]);
        }
    }
    h
}

/// Bilinear resampling between pixel centres, edges clamped.
pub fn resample_bilinear(src: &[f32], sw: usize, sh: usize, dw: usize, dh: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; dw * dh];
    if sw == 0 || sh == 0 || src.len() < sw * sh {
        return out;
    }
    let sx = sw as f32 / dw as f32;
    let sy = sh as f32 / dh as f32;
    for y in 0..dh {
        let fy = ((y as f32 + 0.5) * sy - 0.5).clamp(0.0, (sh - 1) as f32);
        let y0 = fy.floor() as usize;
        let y1 = (y0 + 1).min(sh - 1);
        let ty = fy - y0 as f32;
        for x in 0..dw {
            let fx = ((x as f32 + 0.5) * sx - 0.5).clamp(0.0, (sw - 1) as f32);
            let x0 = fx.floor() as usize;
            let x1 = (x0 + 1).min(sw - 1);
            let tx = fx - x0 as f32;
            let a = src[y0 * sw + x0] * (1.0 - tx) + src[y0 * sw + x1] * tx;
            let b = src[y1 * sw + x0] * (1.0 - tx) + src[y1 * sw + x1] * tx;
            out[y * dw + x] = a * (1.0 - ty) + b * ty;
        }
    }
    out
}

/// Scales `h` so its lowest value is 0 and its highest 1. A flat map becomes 0.
pub fn normalise(h: &mut [f32]) {
    let (mut lo, mut hi) = (f32::MAX, f32::MIN);
    for &v in h.iter() {
        lo = lo.min(v);
        hi = hi.max(v);
    }
    let range = hi - lo;
    if !(range > 1e-9) {
        h.iter_mut().for_each(|v| *v = 0.0);
        return;
    }
    h.iter_mut().for_each(|v| *v = (*v - lo) / range);
}

/// Separable Gaussian blur with standard deviation `sigma` pixels, over
/// three sigma either side, with edge pixels repeated beyond the border.
pub fn gaussian_blur(h: &mut [f32], width: usize, height: usize, sigma: f32) {
    if sigma <= 0.0 || width == 0 || height == 0 {
        return;
    }
    let radius = (sigma * 3.0).ceil() as isize;
    let weights: Vec<f32> = (-radius..=radius)
        .map(|d| (-((d * d) as f32) / (2.0 * sigma * sigma)).exp())
        .collect();
    let sum: f32 = weights.iter().sum();
    let weights: Vec<f32> = weights.iter().map(|w| w / sum).collect();
    let mut line = vec![0.0f32; width.max(height)];
    for y in 0..height {
        let row = &mut h[y * width..(y + 1) * width];
        line[..width].copy_from_slice(row);
        for (x, out) in row.iter_mut().enumerate() {
            let mut acc = 0.0f32;
            for (k, w) in weights.iter().enumerate() {
                let sx = (x as isize + k as isize - radius).clamp(0, width as isize - 1) as usize;
                acc += line[sx] * w;
            }
            *out = acc;
        }
    }
    for x in 0..width {
        for y in 0..height {
            line[y] = h[y * width + x];
        }
        for y in 0..height {
            let mut acc = 0.0f32;
            for (k, w) in weights.iter().enumerate() {
                let sy = (y as isize + k as isize - radius).clamp(0, height as isize - 1) as usize;
                acc += line[sy] * w;
            }
            h[y * width + x] = acc;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn brute(inside: &[bool], w: usize, h: usize) -> Vec<u32> {
        let outs: Vec<(i64, i64)> = (0..w * h)
            .filter(|&i| !inside[i])
            .map(|i| ((i % w) as i64, (i / w) as i64))
            .collect();
        (0..w * h)
            .map(|i| {
                if !inside[i] {
                    return 0;
                }
                let (x, y) = ((i % w) as i64, (i / w) as i64);
                outs.iter()
                    .map(|&(ox, oy)| ((ox - x).pow(2) + (oy - y).pow(2)) as u32)
                    .min()
                    .unwrap_or(u32::MAX)
            })
            .collect()
    }

    #[test]
    fn edt_matches_brute_force_on_test_shapes() {
        let (w, h) = (41, 33);
        let shapes: Vec<Box<dyn Fn(i64, i64) -> bool>> = vec![
            Box::new(|x, y| (x - 20).pow(2) + (y - 16).pow(2) < 196),
            Box::new(|x, y| (5..36).contains(&x) && (4..29).contains(&y) && !(15..25).contains(&x)),
            Box::new(|x, y| (x * 7 + y * 13) % 11 != 0),
            Box::new(|x, y| (x - y).abs() < 6 || (x + y - 40).abs() < 3),
        ];
        for shape in shapes {
            let inside: Vec<bool> = (0..w * h)
                .map(|i| shape((i % w) as i64, (i / w) as i64))
                .collect();
            assert_eq!(edt_squared(&inside, w, h), brute(&inside, w, h));
        }
    }

    #[test]
    fn smoothing_keeps_the_peak_at_full_height() {
        let (w, h) = (40, 40);
        let mut px = vec![255u8; w * h * 4];
        for y in 0..h {
            for x in 19..22 {
                let i = (y * w + x) * 4;
                px[i..i + 3].copy_from_slice(&[0, 0, 0]);
            }
        }
        let p = DepthParams {
            source: SOURCE_SHAPE,
            profile: PROFILE_CHAMFER,
            shape_is_light: false,
            invert: false,
            smoothing_px: 2.0,
            bevel_px: 10.0,
            detail: 0.0,
        };
        let out = generate_heightmap(&px, w, h, &p, None);
        assert_eq!(*out.iter().max().unwrap(), 65535);
    }

    #[test]
    fn profiles_follow_their_formulas() {
        for (p, f) in [
            (
                PROFILE_CHAMFER,
                Box::new(|t: f32| t) as Box<dyn Fn(f32) -> f32>,
            ),
            (
                PROFILE_ROUND,
                Box::new(|t: f32| (1.0 - (1.0 - t).powi(2)).sqrt()),
            ),
            (PROFILE_COVE, Box::new(|t: f32| 1.0 - (1.0 - t * t).sqrt())),
        ] {
            for i in 0..=10 {
                let t = i as f32 / 10.0;
                assert!((bevel_profile(p, t) - f(t)).abs() < 1e-6);
            }
        }
    }
}
