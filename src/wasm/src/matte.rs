//! Background removal's matte (phase 5, #50): a segmentation model's
//! foreground probability map, computed at the model's own input size, is
//! upsampled to a render and turned into coverage, and the render is
//! composited onto white with it. White is "no burn", the same as the
//! pipeline's flattening of transparency.
//!
//! The probability map is 8-bit (0 = background, 255 = foreground). It is
//! upsampled bilinearly with pixel centres aligned, then mapped through a
//! linear ramp of width `softness` centred on `cutoff`: the ramp sharpens the
//! smooth interpolated field back into an edge that lies on the model's 0.5
//! contour to sub-pixel accuracy, instead of a blocky edge.

/// Coverage at render pixel (`x`, `y`) of a `w` x `h` render, from the
/// `mw` x `mh` probability map `mask`. 0 removes the pixel, 1 keeps it.
fn coverage_at(
    mask: &[u8],
    mw: usize,
    mh: usize,
    w: usize,
    h: usize,
    x: usize,
    y: usize,
    ramp: &Ramp,
) -> f32 {
    let p = sample_bilinear(
        mask,
        mw,
        mh,
        (x as f32 + 0.5) * mw as f32 / w as f32 - 0.5,
        (y as f32 + 0.5) * mh as f32 / h as f32 - 0.5,
    );
    ramp.apply(p)
}

/// The mask's value at fractional position (`fx`, `fy`), in 0 to 1, with the
/// edge pixels extended outwards.
pub fn sample_bilinear(mask: &[u8], mw: usize, mh: usize, fx: f32, fy: f32) -> f32 {
    let fx = fx.clamp(0.0, (mw - 1) as f32);
    let fy = fy.clamp(0.0, (mh - 1) as f32);
    let x0 = fx.floor() as usize;
    let y0 = fy.floor() as usize;
    let x1 = (x0 + 1).min(mw - 1);
    let y1 = (y0 + 1).min(mh - 1);
    let tx = fx - x0 as f32;
    let ty = fy - y0 as f32;
    let at = |x: usize, y: usize| mask[y * mw + x] as f32;
    let top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * tx;
    let bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * tx;
    (top + (bottom - top) * ty) / 255.0
}

/// The map from probability to coverage.
pub struct Ramp {
    low: f32,
    width: f32,
}

impl Ramp {
    /// `cutoff` and `softness` in 0 to 1. A softness of 0 is a hard step at the cutoff.
    pub fn new(cutoff: f32, softness: f32) -> Ramp {
        let width = softness.clamp(1.0 / 255.0, 1.0);
        Ramp {
            low: cutoff.clamp(0.0, 1.0) - width / 2.0,
            width,
        }
    }

    pub fn apply(&self, p: f32) -> f32 {
        ((p - self.low) / self.width).clamp(0.0, 1.0)
    }
}

/// Composites the opaque RGBA8 render `img` (`w` x `h`) onto white with the
/// coverage of `mask` (`mw` x `mh`), in place.
pub fn apply_matte(
    img: &mut [u8],
    w: usize,
    h: usize,
    mask: &[u8],
    mw: usize,
    mh: usize,
    ramp: &Ramp,
) {
    for y in 0..h {
        for x in 0..w {
            let a = coverage_at(mask, mw, mh, w, h, x, y, ramp);
            if a >= 1.0 {
                continue;
            }
            let i = (y * w + x) * 4;
            for c in 0..3 {
                img[i + c] = (img[i + c] as f32 * a + 255.0 * (1.0 - a)).round() as u8;
            }
            img[i + 3] = 255;
        }
    }
}

/// The coverage of `mask` at a `w` x `h` render, one byte per pixel (0 to 255).
pub fn matte_alpha(
    mask: &[u8],
    mw: usize,
    mh: usize,
    w: usize,
    h: usize,
    ramp: &Ramp,
    out: &mut [u8],
) {
    for y in 0..h {
        for x in 0..w {
            out[y * w + x] = (coverage_at(mask, mw, mh, w, h, x, y, ramp) * 255.0).round() as u8;
        }
    }
}

/// Composites the opaque RGBA8 render at `img` (`w` x `h`) onto white with
/// the coverage of the probability map at `mask` (`mw` x `mh`, one byte per
/// pixel), in place. `cutoff` and `softness` are in 0 to 1. Returns 1, or 0
/// when an argument is invalid.
#[no_mangle]
pub extern "C" fn apply_background_matte(
    img: *mut u8,
    w: usize,
    h: usize,
    mask: *const u8,
    mw: usize,
    mh: usize,
    cutoff: f32,
    softness: f32,
) -> u32 {
    if img.is_null() || mask.is_null() || w == 0 || h == 0 || mw == 0 || mh == 0 {
        return 0;
    }
    let pixels = unsafe { std::slice::from_raw_parts_mut(img, w * h * 4) };
    let mask = unsafe { std::slice::from_raw_parts(mask, mw * mh) };
    apply_matte(pixels, w, h, mask, mw, mh, &Ramp::new(cutoff, softness));
    1
}

/// The coverage of the probability map at `mask` (`mw` x `mh`) for a `w` x
/// `h` render, as a new buffer of `w * h` bytes that the caller frees with
/// `deallocate`, or null when an argument is invalid or the memory cannot be
/// had. For showing what will be removed.
#[no_mangle]
pub extern "C" fn background_matte_alpha(
    mask: *const u8,
    mw: usize,
    mh: usize,
    w: usize,
    h: usize,
    cutoff: f32,
    softness: f32,
) -> *mut u8 {
    if mask.is_null() || w == 0 || h == 0 || mw == 0 || mh == 0 {
        return std::ptr::null_mut();
    }
    let out_ptr = crate::try_allocate(w * h);
    if out_ptr.is_null() {
        return out_ptr;
    }
    let mask = unsafe { std::slice::from_raw_parts(mask, mw * mh) };
    let out = unsafe { std::slice::from_raw_parts_mut(out_ptr, w * h) };
    matte_alpha(mask, mw, mh, w, h, &Ramp::new(cutoff, softness), out);
    out_ptr
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A `n` x `n` map of a disk of radius `r` (in map pixels) centred on the map, anti-aliased.
    fn disk(n: usize, r: f32) -> Vec<u8> {
        let c = n as f32 / 2.0;
        let mut m = vec![0u8; n * n];
        for y in 0..n {
            for x in 0..n {
                let d = ((x as f32 + 0.5 - c).powi(2) + (y as f32 + 0.5 - c).powi(2)).sqrt();
                m[y * n + x] = ((r - d + 0.5).clamp(0.0, 1.0) * 255.0).round() as u8;
            }
        }
        m
    }

    #[test]
    fn an_upsampled_disk_keeps_its_radius_to_a_fraction_of_a_map_pixel() {
        // A 64-pixel map upsampled 8 times: the edge must land where the disk's edge is.
        let (n, r, scale) = (64usize, 20.0f32, 8usize);
        let w = n * scale;
        let mut alpha = vec![0u8; w * w];
        matte_alpha(&disk(n, r), n, n, w, w, &Ramp::new(0.5, 0.0), &mut alpha);
        let kept = alpha.iter().filter(|&&a| a >= 128).count() as f32;
        let radius = (kept / std::f32::consts::PI).sqrt() / scale as f32;
        assert!((radius - r).abs() < 0.15, "radius {radius} against {r}");
    }

    #[test]
    fn full_coverage_keeps_pixels_and_none_makes_them_white() {
        let mut img = vec![10u8, 20, 30, 255, 10, 20, 30, 255];
        apply_matte(&mut img, 2, 1, &[255, 0], 2, 1, &Ramp::new(0.5, 0.0));
        assert_eq!(img, vec![10, 20, 30, 255, 255, 255, 255, 255]);
    }

    #[test]
    fn softness_widens_the_ramp_around_the_cutoff() {
        let ramp = Ramp::new(0.5, 0.4);
        assert_eq!(ramp.apply(0.29), 0.0);
        assert!((ramp.apply(0.5) - 0.5).abs() < 1e-6);
        assert_eq!(ramp.apply(0.71), 1.0);
    }
}
