//! Steps 1 to 3 of the pipeline (design section 2): crop, flatten
//! transparency onto white, and resample to the target size in linear light.
//!
//! Flattening works on sRGB-encoded values, as browsers show an image on a
//! white page. Resampling decodes to linear light, averages the area each
//! output pixel covers (a box filter) when shrinking, interpolates bilinearly
//! when enlarging, and encodes back.

use std::sync::OnceLock;

/// Number of entries in the linear-to-sRGB table: fine enough that the round
/// trip of every 8-bit value is exact (tested).
const ENCODE_STEPS: usize = 65536;

fn srgb_to_linear_exact(v: f64) -> f64 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb_exact(l: f64) -> f64 {
    if l <= 0.0031308 {
        l * 12.92
    } else {
        1.055 * l.powf(1.0 / 2.4) - 0.055
    }
}

/// Linear light of each 8-bit sRGB value, 0 to 1.
pub fn decode_table() -> &'static [f32; 256] {
    static TABLE: OnceLock<[f32; 256]> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut t = [0.0f32; 256];
        for (v, entry) in t.iter_mut().enumerate() {
            *entry = srgb_to_linear_exact(v as f64 / 255.0) as f32;
        }
        t
    })
}

fn encode_table() -> &'static [u8] {
    static TABLE: OnceLock<Vec<u8>> = OnceLock::new();
    TABLE.get_or_init(|| {
        (0..ENCODE_STEPS)
            .map(|i| {
                let l = i as f64 / (ENCODE_STEPS - 1) as f64;
                (linear_to_srgb_exact(l) * 255.0).round().clamp(0.0, 255.0) as u8
            })
            .collect()
    })
}

/// The 8-bit sRGB value of linear light `l` (0 to 1), rounded.
#[inline]
pub fn encode(l: f32) -> u8 {
    let table = encode_table();
    let i = (l.clamp(0.0, 1.0) * (ENCODE_STEPS - 1) as f32).round() as usize;
    table[i]
}

/// An encoded colour value `c` with alpha `a`, composited onto white:
/// `round(c * a / 255 + 255 * (1 - a / 255))`.
#[inline]
pub fn flatten(c: u8, a: u8) -> u8 {
    let c = c as u32;
    let a = a as u32;
    // (c*a + 255*(255-a)) / 255, rounded half up, in integers.
    ((2 * (c * a + 255 * (255 - a)) + 255) / 510) as u8
}

/// Which source pixels each output pixel of one axis reads, and with what weight.
struct AxisWeights {
    /// For output pixel i: `taps[offsets[i]..offsets[i + 1]]`.
    offsets: Vec<usize>,
    taps: Vec<(usize, f32)>,
}

impl AxisWeights {
    /// Box filter when shrinking (each output pixel averages the source span
    /// it covers, partial pixels weighted by their overlap), bilinear when
    /// enlarging or keeping the size.
    fn new(src: usize, dst: usize) -> AxisWeights {
        let mut offsets = Vec::with_capacity(dst + 1);
        let mut taps = Vec::new();
        offsets.push(0);
        if dst < src {
            let scale = src as f64 / dst as f64;
            for i in 0..dst {
                let lo = i as f64 * scale;
                let hi = ((i + 1) as f64 * scale).min(src as f64);
                let first = lo.floor() as usize;
                let last = (hi.ceil() as usize).min(src);
                for j in first..last {
                    let overlap = hi.min((j + 1) as f64) - lo.max(j as f64);
                    if overlap > 0.0 {
                        taps.push((j, (overlap / scale) as f32));
                    }
                }
                offsets.push(taps.len());
            }
        } else {
            let scale = src as f64 / dst as f64;
            for i in 0..dst {
                let x = ((i as f64 + 0.5) * scale - 0.5).clamp(0.0, (src - 1) as f64);
                let j0 = x.floor() as usize;
                let f = (x - j0 as f64) as f32;
                let j1 = (j0 + 1).min(src - 1);
                if j1 == j0 || f == 0.0 {
                    taps.push((j0, 1.0));
                } else {
                    taps.push((j0, 1.0 - f));
                    taps.push((j1, f));
                }
                offsets.push(taps.len());
            }
        }
        AxisWeights { offsets, taps }
    }

    #[inline]
    fn of(&self, i: usize) -> &[(usize, f32)] {
        &self.taps[self.offsets[i]..self.offsets[i + 1]]
    }
}

/// The rectangle of the source to read, in source pixels.
#[derive(Clone, Copy)]
pub struct Crop {
    pub x: usize,
    pub y: usize,
    pub width: usize,
    pub height: usize,
}

/// Crops `src` (RGBA8, `src_w` pixels wide), flattens it onto white and
/// resamples it to `dst_w` x `dst_h` in linear light, writing opaque RGBA8
/// into `out` (`dst_w * dst_h * 4` bytes). The crop must lie inside the source.
pub fn prepare(src: &[u8], src_w: usize, crop: Crop, dst_w: usize, dst_h: usize, out: &mut [u8]) {
    // Same size: crop and flatten only. Resampling at 1:1 is the identity.
    if dst_w == crop.width && dst_h == crop.height {
        for y in 0..crop.height {
            let row = (crop.y + y) * src_w + crop.x;
            for x in 0..crop.width {
                let s = (row + x) * 4;
                let d = (y * dst_w + x) * 4;
                let a = src[s + 3];
                out[d] = flatten(src[s], a);
                out[d + 1] = flatten(src[s + 1], a);
                out[d + 2] = flatten(src[s + 2], a);
                out[d + 3] = 255;
            }
        }
        return;
    }

    let decode = decode_table();
    let horizontal = AxisWeights::new(crop.width, dst_w);
    let vertical = AxisWeights::new(crop.height, dst_h);

    // One source row, flattened and in linear light, then resampled across.
    // Consecutive output rows share source rows at their edges, so the last
    // two rows resampled across are kept rather than computed again.
    let mut linear_row = vec![0.0f32; crop.width * 3];
    let mut rows: [(usize, Vec<f32>); 2] = [(usize::MAX, vec![0.0f32; dst_w * 3]), (usize::MAX, vec![0.0f32; dst_w * 3])];
    let mut next_slot = 0;
    let mut acc = vec![0.0f32; dst_w * 3];

    for oy in 0..dst_h {
        acc.iter_mut().for_each(|v| *v = 0.0);
        for &(sy, wy) in vertical.of(oy) {
            let slot = match rows.iter().position(|r| r.0 == sy) {
                Some(slot) => slot,
                None => {
                    let slot = next_slot;
                    next_slot = 1 - next_slot;
                    let row = (crop.y + sy) * src_w + crop.x;
                    for x in 0..crop.width {
                        let s = (row + x) * 4;
                        let a = src[s + 3];
                        let (r, g, b) = if a == 255 {
                            (src[s], src[s + 1], src[s + 2])
                        } else {
                            (flatten(src[s], a), flatten(src[s + 1], a), flatten(src[s + 2], a))
                        };
                        linear_row[x * 3] = decode[r as usize];
                        linear_row[x * 3 + 1] = decode[g as usize];
                        linear_row[x * 3 + 2] = decode[b as usize];
                    }
                    let across = &mut rows[slot].1;
                    for ox in 0..dst_w {
                        let (mut r, mut g, mut b) = (0.0f32, 0.0f32, 0.0f32);
                        for &(sx, wx) in horizontal.of(ox) {
                            r += linear_row[sx * 3] * wx;
                            g += linear_row[sx * 3 + 1] * wx;
                            b += linear_row[sx * 3 + 2] * wx;
                        }
                        across[ox * 3] = r;
                        across[ox * 3 + 1] = g;
                        across[ox * 3 + 2] = b;
                    }
                    rows[slot].0 = sy;
                    slot
                }
            };
            for (a, v) in acc.iter_mut().zip(rows[slot].1.iter()) {
                *a += v * wy;
            }
        }
        for ox in 0..dst_w {
            let d = (oy * dst_w + ox) * 4;
            out[d] = encode(acc[ox * 3]);
            out[d + 1] = encode(acc[ox * 3 + 1]);
            out[d + 2] = encode(acc[ox * 3 + 2]);
            out[d + 3] = 255;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_8_bit_value_survives_the_linear_round_trip() {
        let decode = decode_table();
        for v in 0..=255u8 {
            assert_eq!(encode(decode[v as usize]), v, "value {v}");
        }
    }

    #[test]
    fn flatten_composites_onto_white() {
        assert_eq!(flatten(0, 255), 0);
        assert_eq!(flatten(0, 0), 255);
        assert_eq!(flatten(100, 0), 255);
        // 0 at half alpha: 255 * (1 - 128/255) = 127.0
        assert_eq!(flatten(0, 128), 127);
        for c in 0..=255u32 {
            for a in 0..=255u32 {
                let exact = c as f64 * a as f64 / 255.0 + 255.0 * (1.0 - a as f64 / 255.0);
                assert_eq!(flatten(c as u8, a as u8) as f64, exact.round(), "c {c} a {a}");
            }
        }
    }

    #[test]
    fn checkerboard_halved_is_linear_mid_grey() {
        let (w, h) = (8, 8);
        let mut src = vec![255u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let v = if (x + y) % 2 == 0 { 0 } else { 255 };
                let i = (y * w + x) * 4;
                src[i] = v;
                src[i + 1] = v;
                src[i + 2] = v;
            }
        }
        let mut out = vec![0u8; 4 * 4 * 4];
        prepare(&src, w, Crop { x: 0, y: 0, width: w, height: h }, 4, 4, &mut out);
        for p in out.chunks(4) {
            assert!((p[0] as i32 - 188).abs() <= 1, "{}", p[0]);
            assert_eq!(p[3], 255);
        }
    }

    #[test]
    fn box_weights_sum_to_one_and_bilinear_keeps_the_identity() {
        for (src, dst) in [(10, 3), (6000, 2048), (7, 7), (3, 10)] {
            let w = AxisWeights::new(src, dst);
            for i in 0..dst {
                let sum: f32 = w.of(i).iter().map(|t| t.1).sum();
                assert!((sum - 1.0).abs() < 1e-5, "{src}->{dst} at {i}: {sum}");
            }
        }
        let w = AxisWeights::new(7, 7);
        for i in 0..7 {
            assert_eq!(w.of(i), &[(i, 1.0)]);
        }
    }
}
