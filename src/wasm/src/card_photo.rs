//! Measuring a photo or scan of a burned calibration card (#56): finding
//! its corner markers, sampling patches through the perspective map, and a
//! flattened copy of the card to show what was measured.
//!
//! This is measurement of a photo, not processing of the user's artwork. It
//! reuses the core's adaptive threshold, connected components, bilinear
//! interpolation and sRGB decoding; the card geometry, lighting correction
//! and the reading of the results are in `src/lib/card-reader.ts`.
//!
//! A corner marker is a burned square ring around a burned centre dot, like
//! a QR finder pattern: 7 units across, a ring 1 unit wide, a gap of 1 unit
//! and a dot. The top-left marker's dot is larger than the other three's,
//! which gives the card's orientation.

use crate::matte::bilinear;
use crate::resample::decode_table;
use crate::threshold::apply_adaptive_threshold;
use crate::trace::components;

/// A ring-and-dot marker found in the photo, in photo pixels.
#[derive(Clone, Debug, PartialEq)]
pub struct Marker {
    /// Centre.
    pub x: f32,
    pub y: f32,
    /// Square root of the ring's bounding box area: the marker's size.
    pub side: f32,
    /// The dot's area over the ring's: larger for the top-left marker.
    pub dot_ratio: f32,
}

struct Blob {
    x0: usize,
    y0: usize,
    x1: usize,
    y1: usize,
    area: usize,
    sx: f64,
    sy: f64,
}

impl Blob {
    fn cx(&self) -> f64 {
        self.sx / self.area as f64
    }
    fn cy(&self) -> f64 {
        self.sy / self.area as f64
    }
    fn bw(&self) -> usize {
        self.x1 - self.x0 + 1
    }
    fn bh(&self) -> usize {
        self.y1 - self.y0 + 1
    }
}

/// Finds every ring-and-dot marker in the RGBA8 photo.
pub fn find_markers(rgba: &[u8], w: usize, h: usize) -> Vec<Marker> {
    if w < 8 || h < 8 {
        return Vec::new();
    }
    // A block several times a marker's ring, so a ring reads dark against its surroundings.
    let block = ((w.min(h) / 10) | 1).max(15);
    let mut bin = rgba.to_vec();
    apply_adaptive_threshold(&mut bin, w, h, block, 12.0);
    let mask: Vec<bool> = (0..w * h).map(|i| bin[i * 4] == 0).collect();
    drop(bin);
    let (labels, areas) = components(&mask, w, h, false);
    let mut blobs: Vec<Blob> = areas
        .iter()
        .map(|&area| Blob {
            x0: usize::MAX,
            y0: usize::MAX,
            x1: 0,
            y1: 0,
            area,
            sx: 0.0,
            sy: 0.0,
        })
        .collect();
    for y in 0..h {
        for x in 0..w {
            let l = labels[y * w + x] as usize;
            if l == 0 {
                continue;
            }
            let b = &mut blobs[l];
            b.x0 = b.x0.min(x);
            b.y0 = b.y0.min(y);
            b.x1 = b.x1.max(x);
            b.y1 = b.y1.max(y);
            b.sx += x as f64;
            b.sy += y as f64;
        }
    }

    // From the dot's centre, a ray crosses the dot, then the white gap, then
    // the ring: in all four directions it must reach the same ring.
    let ray = |c: u32, x: usize, y: usize, dx: isize, dy: isize| -> Option<u32> {
        let (mut px, mut py) = (x as isize, y as isize);
        let mut gap = 0usize;
        loop {
            px += dx;
            py += dy;
            if px < 0 || py < 0 || px >= w as isize || py >= h as isize {
                return None;
            }
            let l = labels[py as usize * w + px as usize];
            if l == c {
                if gap > 0 {
                    return None;
                }
                continue;
            }
            if l == 0 {
                gap += 1;
                continue;
            }
            return if gap > 0 { Some(l) } else { None };
        }
    };

    let mut out = Vec::new();
    for (ci, c) in blobs.iter().enumerate().skip(1) {
        if c.area < 6 {
            continue;
        }
        let fill = c.area as f64 / (c.bw() * c.bh()) as f64;
        let aspect = c.bw() as f64 / c.bh() as f64;
        if fill < 0.45 || !(0.33..=3.0).contains(&aspect) {
            continue;
        }
        let (x, y) = (c.cx().round() as usize, c.cy().round() as usize);
        if labels[y * w + x] != ci as u32 {
            continue;
        }
        let mut ring = None;
        let mut ok = true;
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            match ray(ci as u32, x, y, dx, dy) {
                Some(l) if ring.is_none() || ring == Some(l) => ring = Some(l),
                _ => {
                    ok = false;
                    break;
                }
            }
        }
        let Some(ai) = ring.filter(|_| ok) else {
            continue;
        };
        let a = &blobs[ai as usize];
        if !(a.x0 < c.x0 && a.y0 < c.y0 && a.x1 > c.x1 && a.y1 > c.y1) {
            continue;
        }
        let side = ((a.bw() * a.bh()) as f64).sqrt();
        let a_fill = a.area as f64 / (a.bw() * a.bh()) as f64;
        let a_aspect = a.bw() as f64 / a.bh() as f64;
        let c_side = ((c.bw() * c.bh()) as f64).sqrt();
        let off = ((a.cx() - c.cx()).powi(2) + (a.cy() - c.cy()).powi(2)).sqrt();
        if side < 10.0
            || !(0.2..=0.8).contains(&a_fill)
            || !(0.33..=3.0).contains(&a_aspect)
            || !(0.1..=0.7).contains(&(c_side / side))
            || off > 0.15 * side
        {
            continue;
        }
        // The filled marker's centroid: ring and dot together.
        let n = (a.area + c.area) as f64;
        out.push(Marker {
            x: ((a.sx + c.sx) / n) as f32 + 0.5,
            y: ((a.sy + c.sy) / n) as f32 + 0.5,
            side: side as f32,
            dot_ratio: (c.area as f64 / a.area as f64) as f32,
        });
    }
    out
}

/// Maps card millimetres to photo pixels (pixel centres at +0.5) through
/// the 3 x 3 matrix `m` (row-major); `None` behind the camera.
pub fn project(m: &[f64; 9], x: f64, y: f64) -> Option<(f64, f64)> {
    let d = m[6] * x + m[7] * y + m[8];
    if d.abs() < 1e-12 {
        return None;
    }
    Some((
        (m[0] * x + m[1] * y + m[2]) / d,
        (m[3] * x + m[4] * y + m[5]) / d,
    ))
}

/// Linear-light luminance of the photo at fractional pixel index (`fx`, `fy`).
fn luminance_at(rgba: &[u8], w: usize, h: usize, fx: f32, fy: f32) -> f32 {
    let t = decode_table();
    bilinear(
        |x, y| {
            let i = (y * w + x) * 4;
            0.2126 * t[rgba[i] as usize]
                + 0.7152 * t[rgba[i + 1] as usize]
                + 0.0722 * t[rgba[i + 2] as usize]
        },
        w,
        h,
        fx,
        fy,
    )
}

/// One sampled patch: the median linear luminance of its sample points and
/// the fraction of them on clipped (blown-out) pixels. `NaN` when the
/// patch is not wholly inside the photo.
#[derive(Clone, Copy, Debug)]
pub struct Sample {
    pub median: f32,
    pub clipped: f32,
}

/// Samples each rectangle (x, y, w, h in card mm) on a `grid` x `grid` set
/// of points through `m`.
pub fn sample_patches(
    rgba: &[u8],
    w: usize,
    h: usize,
    m: &[f64; 9],
    rects: &[[f32; 4]],
    grid: usize,
) -> Vec<Sample> {
    let grid = grid.max(1);
    let outside = Sample {
        median: f32::NAN,
        clipped: 0.0,
    };
    rects
        .iter()
        .map(|r| {
            let mut values = Vec::with_capacity(grid * grid);
            let mut clipped = 0usize;
            for j in 0..grid {
                for i in 0..grid {
                    let x = r[0] as f64 + r[2] as f64 * (i as f64 + 0.5) / grid as f64;
                    let y = r[1] as f64 + r[3] as f64 * (j as f64 + 0.5) / grid as f64;
                    let Some((u, v)) = project(m, x, y) else {
                        return outside;
                    };
                    // Pixel centres are at +0.5.
                    let (u, v) = (u - 0.5, v - 0.5);
                    if u < 0.0 || v < 0.0 || u > (w - 1) as f64 || v > (h - 1) as f64 {
                        return outside;
                    }
                    let k = (v.round() as usize * w + u.round() as usize) * 4;
                    if rgba[k].max(rgba[k + 1]).max(rgba[k + 2]) >= 250 {
                        clipped += 1;
                    }
                    values.push(luminance_at(rgba, w, h, u as f32, v as f32));
                }
            }
            values.sort_by(|a, b| a.total_cmp(b));
            Sample {
                median: values[values.len() / 2],
                clipped: clipped as f32 / values.len() as f32,
            }
        })
        .collect()
}

/// The card flattened: `out_w` x `out_h` RGBA8 pixels at `px_per_mm`, each
/// interpolated from the photo through `m`. Outside the photo is mid grey.
pub fn rectify(
    rgba: &[u8],
    w: usize,
    h: usize,
    m: &[f64; 9],
    out_w: usize,
    out_h: usize,
    px_per_mm: f64,
) -> Vec<u8> {
    let mut out = vec![255u8; out_w * out_h * 4];
    for y in 0..out_h {
        for x in 0..out_w {
            let o = (y * out_w + x) * 4;
            let p = project(
                m,
                (x as f64 + 0.5) / px_per_mm,
                (y as f64 + 0.5) / px_per_mm,
            );
            match p.map(|(u, v)| (u - 0.5, v - 0.5)) {
                Some((u, v))
                    if u >= 0.0 && v >= 0.0 && u <= (w - 1) as f64 && v <= (h - 1) as f64 =>
                {
                    for ch in 0..3 {
                        let val = bilinear(
                            |px, py| rgba[(py * w + px) * 4 + ch] as f32,
                            w,
                            h,
                            u as f32,
                            v as f32,
                        );
                        out[o + ch] = val.round().clamp(0.0, 255.0) as u8;
                    }
                }
                _ => {
                    out[o] = 128;
                    out[o + 1] = 128;
                    out[o + 2] = 128;
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Draws a marker of `side` px centred at (`cx`, `cy`) with a dot `dot` units of 7 across.
    fn draw_marker(px: &mut [u8], w: usize, cx: f64, cy: f64, side: f64, dot: f64) {
        let u = side / 7.0;
        let h = px.len() / 4 / w;
        for y in 0..h {
            for x in 0..w {
                let dx = (x as f64 + 0.5 - cx).abs() / u;
                let dy = (y as f64 + 0.5 - cy).abs() / u;
                let r = dx.max(dy);
                if (2.5..3.5).contains(&r) || r < dot / 2.0 {
                    let i = (y * w + x) * 4;
                    px[i] = 20;
                    px[i + 1] = 20;
                    px[i + 2] = 20;
                }
            }
        }
    }

    #[test]
    fn finds_four_markers_and_tells_the_large_dot() {
        let (w, h) = (400, 300);
        let mut px = vec![230u8; w * h * 4];
        draw_marker(&mut px, w, 50.0, 50.0, 49.0, 3.0);
        draw_marker(&mut px, w, 350.0, 50.0, 49.0, 1.6);
        draw_marker(&mut px, w, 350.0, 250.0, 49.0, 1.6);
        draw_marker(&mut px, w, 50.0, 250.0, 49.0, 1.6);
        // A plain ring and a solid square are not markers.
        draw_marker(&mut px, w, 200.0, 150.0, 49.0, 0.0);
        draw_marker(&mut px, w, 200.0, 60.0, 21.0, 21.0);
        let m = find_markers(&px, w, h);
        assert_eq!(m.len(), 4, "{m:?}");
        for (x, y) in [(50.0, 50.0), (350.0, 50.0), (350.0, 250.0), (50.0, 250.0)] {
            assert!(m
                .iter()
                .any(|k| (k.x - x).abs() < 0.6 && (k.y - y).abs() < 0.6));
        }
        let big = m
            .iter()
            .max_by(|a, b| a.dot_ratio.total_cmp(&b.dot_ratio))
            .unwrap();
        assert!((big.x - 50.0).abs() < 1.0 && (big.y - 50.0).abs() < 1.0);
    }

    #[test]
    fn samples_through_the_map_in_linear_light() {
        let (w, h) = (100, 100);
        let mut px = vec![255u8; w * h * 4];
        // Left half sRGB 188: about 0.5 linear.
        for y in 0..h {
            for x in 0..50 {
                let i = (y * w + x) * 4;
                px[i] = 188;
                px[i + 1] = 188;
                px[i + 2] = 188;
            }
        }
        // 1 mm = 2 px, offset 10 px.
        let m = [2.0, 0.0, 10.0, 0.0, 2.0, 10.0, 0.0, 0.0, 1.0];
        let rects = [
            [2.0, 2.0, 10.0, 10.0],
            [25.0, 2.0, 10.0, 10.0],
            [60.0, 0.0, 5.0, 5.0],
        ];
        let s = sample_patches(&px, w, h, &m, &rects, 5);
        assert!((s[0].median - 0.5029).abs() < 0.01, "{s:?}");
        assert!((s[1].median - 1.0).abs() < 1e-4);
        assert_eq!(s[1].clipped, 1.0);
        assert!(s[2].median.is_nan());
        let r = rectify(&px, w, h, &m, 40, 10, 1.0);
        assert_eq!(r[0], 188);
        assert_eq!(r[(5 * 40 + 39) * 4], 255);
    }
}
