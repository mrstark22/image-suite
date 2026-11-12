//! Colour segmentation for colour tracing (#28).
//!
//! Colours are compared in CIELAB, where distance follows perceived
//! difference. The palette is found by k-means with k-means++ seeding (Arthur
//! and Vassilvitskii, 2007) on a deterministic sample of the image, with empty
//! clusters re-seeded and near-identical clusters merged, or is given by the
//! user.
//!
//! Anti-aliased fringe pixels (a pixel whose colour lies between the colours
//! of two opposite neighbours) are left out of the clustering, so they cannot
//! become clusters of their own. Each is then described as a mixture of two
//! colours found among the clustered pixels around it, which gives every
//! colour a membership field whose 0.5 level is the sub-pixel boundary
//! between the two regions. Neighbouring layers therefore share one boundary
//! and no thin sliver layer forms along it.

/// A pixel's membership: `t` of colour `b` and `1 - t` of colour `a`.
#[derive(Clone, Copy)]
pub struct Mix {
    pub a: u8,
    pub b: u8,
    pub t: f32,
}

pub struct Segmentation {
    /// Palette in Lab.
    pub centres: Vec<[f32; 3]>,
    /// Number of pixels whose main colour is each palette entry.
    pub counts: Vec<usize>,
    pub mix: Vec<Mix>,
}

fn srgb_to_linear(c: u8) -> f32 {
    let v = c as f32 / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

fn lab_f(t: f32) -> f32 {
    if t > 0.008856 {
        t.cbrt()
    } else {
        7.787 * t + 16.0 / 116.0
    }
}

pub fn rgb_to_lab_with(lut: &[f32; 256], r: u8, g: u8, b: u8) -> [f32; 3] {
    let (r, g, b) = (lut[r as usize], lut[g as usize], lut[b as usize]);
    let x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    let (fx, fy, fz) = (lab_f(x), lab_f(y), lab_f(z));
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

pub fn linear_lut() -> [f32; 256] {
    let mut lut = [0.0f32; 256];
    for (i, v) in lut.iter_mut().enumerate() {
        *v = srgb_to_linear(i as u8);
    }
    lut
}

pub fn rgb_to_lab(r: u8, g: u8, b: u8) -> [f32; 3] {
    rgb_to_lab_with(&linear_lut(), r, g, b)
}

pub fn lab_to_rgb(lab: [f32; 3]) -> [u8; 3] {
    let fy = (lab[0] + 16.0) / 116.0;
    let fx = fy + lab[1] / 500.0;
    let fz = fy - lab[2] / 200.0;
    let inv = |f: f32| {
        if f * f * f > 0.008856 {
            f * f * f
        } else {
            (f - 16.0 / 116.0) / 7.787
        }
    };
    let x = inv(fx) * 0.95047;
    let y = inv(fy);
    let z = inv(fz) * 1.08883;
    let r = 3.2406 * x - 1.5372 * y - 0.4986 * z;
    let g = -0.9689 * x + 1.8758 * y + 0.0415 * z;
    let b = 0.0557 * x - 0.2040 * y + 1.0570 * z;
    let enc = |c: f32| {
        let c = c.clamp(0.0, 1.0);
        let v = if c <= 0.0031308 {
            12.92 * c
        } else {
            1.055 * c.powf(1.0 / 2.4) - 0.055
        };
        (v * 255.0).round() as u8
    };
    [enc(r), enc(g), enc(b)]
}

fn d2(a: &[f32; 3], b: &[f32; 3]) -> f32 {
    let (x, y, z) = (a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    x * x + y * y + z * z
}

/// Squared distance from `p` to the segment `a`-`b`, and the position on it (0 at a, 1 at b).
fn to_segment(p: &[f32; 3], a: &[f32; 3], b: &[f32; 3]) -> (f32, f32) {
    let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    if l2 < 1e-9 {
        return (d2(p, a), 0.0);
    }
    let t = (((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2)
        .clamp(0.0, 1.0);
    let q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    (d2(p, &q), t)
}

/// A small deterministic random number generator (xorshift64*).
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545F4914F6CDD1D)
    }
    fn unit(&mut self) -> f32 {
        (self.next() >> 40) as f32 / (1u64 << 24) as f32
    }
}

/// Clusters closer than this (ΔE) are one colour.
const MERGE_DE: f32 = 6.0;
/// A pixel within this ΔE of the line between two opposite neighbours' colours is a fringe pixel.
const FRINGE_DE: f32 = 4.0;

/// Segments `rgba` into `k` colours, or into the fixed palette `fixed` (Lab) when it is not empty.
pub fn segment(rgba: &[u8], w: usize, h: usize, k: usize, fixed: &[[f32; 3]]) -> Segmentation {
    let n = w * h;
    let lut = linear_lut();
    let lab: Vec<[f32; 3]> = (0..n)
        .map(|i| rgb_to_lab_with(&lut, rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]))
        .collect();

    // Fringe pixels: colour between those of two opposite neighbours, and distinct from both.
    let pairs: [((isize, isize), (isize, isize)); 4] = [
        ((-1, 0), (1, 0)),
        ((0, -1), (0, 1)),
        ((-1, -1), (1, 1)),
        ((1, -1), (-1, 1)),
    ];
    let mut fringe = vec![false; n];
    for y in 1..h.saturating_sub(1) {
        for x in 1..w.saturating_sub(1) {
            let i = y * w + x;
            let p = &lab[i];
            for ((ax, ay), (bx, by)) in pairs {
                let a = &lab[(y as isize + ay) as usize * w + (x as isize + ax) as usize];
                let b = &lab[(y as isize + by) as usize * w + (x as isize + bx) as usize];
                let sep = FRINGE_DE * FRINGE_DE;
                if d2(p, a) > sep && d2(p, b) > sep && to_segment(p, a, b).0 < sep {
                    fringe[i] = true;
                    break;
                }
            }
        }
    }

    let mut centres: Vec<[f32; 3]> = if !fixed.is_empty() {
        fixed.to_vec()
    } else {
        let flat: Vec<usize> = (0..n).filter(|&i| !fringe[i]).collect();
        let pool: Vec<usize> = if flat.len() >= k.max(1) * 4 {
            flat
        } else {
            (0..n).collect()
        };
        kmeans(&lab, &pool, k.max(1))
    };
    if centres.is_empty() {
        centres.push([100.0, 0.0, 0.0]);
    }
    if fixed.is_empty() {
        centres = drop_fringe_clusters(&lab, w, h, centres);
    }
    let nearest = |p: &[f32; 3], centres: &[[f32; 3]]| -> usize {
        let mut best = 0;
        let mut bd = f32::MAX;
        for (c, q) in centres.iter().enumerate() {
            let d = d2(p, q);
            if d < bd {
                bd = d;
                best = c;
            }
        }
        best
    };

    // Clustered pixels take their nearest colour; fringe pixels a mixture of nearby colours.
    let mut mix: Vec<Mix> = (0..n)
        .map(|i| {
            let c = nearest(&lab[i], &centres) as u8;
            Mix { a: c, b: c, t: 0.0 }
        })
        .collect();
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            if !fringe[i] {
                continue;
            }
            let mut cand: Vec<u8> = vec![mix[i].a];
            for yy in y.saturating_sub(2)..=(y + 2).min(h - 1) {
                for xx in x.saturating_sub(2)..=(x + 2).min(w - 1) {
                    let j = yy * w + xx;
                    if !fringe[j] && !cand.contains(&mix[j].a) {
                        cand.push(mix[j].a);
                    }
                }
            }
            let p = &lab[i];
            let mut best = (
                f32::MAX,
                Mix {
                    a: cand[0],
                    b: cand[0],
                    t: 0.0,
                },
            );
            for (ai, &a) in cand.iter().enumerate() {
                let da = d2(p, &centres[a as usize]);
                if da < best.0 {
                    best = (da, Mix { a, b: a, t: 0.0 });
                }
                for &b in &cand[ai + 1..] {
                    let (d, t) = to_segment(p, &centres[a as usize], &centres[b as usize]);
                    if d < best.0 {
                        best = (d, Mix { a, b, t });
                    }
                }
            }
            mix[i] = best.1;
        }
    }

    let mut counts = vec![0usize; centres.len()];
    for m in &mix {
        let main = if m.t < 0.5 { m.a } else { m.b };
        counts[main as usize] += 1;
    }
    Segmentation {
        centres,
        counts,
        mix,
    }
}

/// The membership field of the colours where `selected[c]` is true: the
/// fraction of each pixel belonging to them, minus one half.
pub fn membership_field(seg: &Segmentation, selected: &[bool]) -> Vec<f32> {
    seg.mix
        .iter()
        .map(|m| {
            let sa = selected[m.a as usize];
            let sb = selected[m.b as usize];
            let v = match (sa, sb) {
                (true, true) => 1.0,
                (false, false) => 0.0,
                (true, false) => 1.0 - m.t,
                (false, true) => m.t,
            } - 0.5;
            if v == 0.0 {
                -1e-6
            } else {
                v
            }
        })
        .collect()
}

/// Drops automatic clusters that are anti-aliasing rather than colours: a
/// cluster whose colour is a mixture of two other clusters' colours and whose
/// pixels nearly all lie on a boundary with another cluster.
fn drop_fringe_clusters(
    lab: &[[f32; 3]],
    w: usize,
    h: usize,
    centres: Vec<[f32; 3]>,
) -> Vec<[f32; 3]> {
    if centres.len() < 3 {
        return centres;
    }
    let nearest = |p: &[f32; 3]| -> usize {
        (0..centres.len())
            .min_by(|&a, &b| d2(p, &centres[a]).partial_cmp(&d2(p, &centres[b])).unwrap())
            .unwrap()
    };
    let label: Vec<usize> = lab.iter().map(nearest).collect();
    let mut count = vec![0usize; centres.len()];
    let mut edge = vec![0usize; centres.len()];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let l = label[i];
            count[l] += 1;
            let differs = (x > 0 && label[i - 1] != l)
                || (x + 1 < w && label[i + 1] != l)
                || (y > 0 && label[i - w] != l)
                || (y + 1 < h && label[i + w] != l);
            if differs {
                edge[l] += 1;
            }
        }
    }
    let keep: Vec<bool> = (0..centres.len())
        .map(|c| {
            let thin = count[c] == 0 || edge[c] as f32 >= 0.8 * count[c] as f32;
            let mixture = (0..centres.len()).any(|a| {
                (0..centres.len()).any(|b| {
                    a != c && b != c && a != b && {
                        let (dist, t) = to_segment(&centres[c], &centres[a], &centres[b]);
                        dist < 8.0 * 8.0 && t > 0.05 && t < 0.95
                    }
                })
            });
            !(thin && mixture)
        })
        .collect();
    centres
        .into_iter()
        .zip(keep)
        .filter(|(_, k)| *k)
        .map(|(c, _)| c)
        .collect()
}

/// k-means with k-means++ seeding on a deterministic sample of `pool`.
fn kmeans(lab: &[[f32; 3]], pool: &[usize], k: usize) -> Vec<[f32; 3]> {
    const MAX_SAMPLES: usize = 50_000;
    let mut rng = Rng(0x9E3779B97F4A7C15);
    let stride = pool.len().div_ceil(MAX_SAMPLES).max(1);
    let samples: Vec<[f32; 3]> = (0..pool.len())
        .step_by(stride)
        .map(|s| {
            let jitter = (rng.next() as usize) % stride;
            lab[pool[(s + jitter).min(pool.len() - 1)]]
        })
        .collect();
    if samples.is_empty() {
        return Vec::new();
    }

    // k-means++ seeding.
    let mut centres: Vec<[f32; 3]> = vec![samples[(rng.next() as usize) % samples.len()]];
    let mut dist: Vec<f32> = samples.iter().map(|p| d2(p, &centres[0])).collect();
    while centres.len() < k {
        let total: f64 = dist.iter().map(|&d| d as f64).sum();
        if total <= 1e-6 {
            break; // fewer distinct colours than asked for
        }
        let mut target = rng.unit() as f64 * total;
        let mut pick = samples.len() - 1;
        for (i, &d) in dist.iter().enumerate() {
            target -= d as f64;
            if target <= 0.0 {
                pick = i;
                break;
            }
        }
        let c = samples[pick];
        centres.push(c);
        for (i, p) in samples.iter().enumerate() {
            dist[i] = dist[i].min(d2(p, &c));
        }
    }

    // Lloyd iterations, re-seeding empty clusters with the worst-fitting sample.
    let mut assign = vec![0usize; samples.len()];
    for _ in 0..50 {
        for (i, p) in samples.iter().enumerate() {
            let mut best = 0;
            let mut bd = f32::MAX;
            for (c, q) in centres.iter().enumerate() {
                let d = d2(p, q);
                if d < bd {
                    bd = d;
                    best = c;
                }
            }
            assign[i] = best;
        }
        let mut sums = vec![[0.0f64; 3]; centres.len()];
        let mut counts = vec![0usize; centres.len()];
        for (i, p) in samples.iter().enumerate() {
            let c = assign[i];
            counts[c] += 1;
            for d in 0..3 {
                sums[c][d] += p[d] as f64;
            }
        }
        let mut moved = 0.0f32;
        for c in 0..centres.len() {
            let next = if counts[c] == 0 {
                // Re-seed with the sample farthest from its own centre.
                let far = (0..samples.len())
                    .max_by(|&a, &b| {
                        d2(&samples[a], &centres[assign[a]])
                            .partial_cmp(&d2(&samples[b], &centres[assign[b]]))
                            .unwrap()
                    })
                    .unwrap();
                samples[far]
            } else {
                let m = counts[c] as f64;
                [
                    (sums[c][0] / m) as f32,
                    (sums[c][1] / m) as f32,
                    (sums[c][2] / m) as f32,
                ]
            };
            moved = moved.max(d2(&next, &centres[c]));
            centres[c] = next;
        }
        if moved < 0.01 {
            break;
        }
    }

    // Merge near-identical clusters.
    let mut merged: Vec<([f32; 3], usize)> = Vec::new();
    let mut counts = vec![0usize; centres.len()];
    for &a in &assign {
        counts[a] += 1;
    }
    let mut order: Vec<usize> = (0..centres.len()).collect();
    order.sort_by(|&a, &b| counts[b].cmp(&counts[a]));
    for c in order {
        if counts[c] == 0 {
            continue;
        }
        match merged
            .iter_mut()
            .find(|(m, _)| d2(m, &centres[c]) < MERGE_DE * MERGE_DE)
        {
            Some((m, n)) => {
                let total = (*n + counts[c]) as f32;
                for d in 0..3 {
                    m[d] = (m[d] * *n as f32 + centres[c][d] * counts[c] as f32) / total;
                }
                *n += counts[c];
            }
            None => merged.push((centres[c], counts[c])),
        }
    }
    merged.into_iter().map(|(c, _)| c).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lab_round_trips() {
        for &(r, g, b) in &[
            (255u8, 0u8, 0u8),
            (0, 128, 255),
            (12, 200, 90),
            (255, 255, 255),
            (0, 0, 0),
        ] {
            let back = lab_to_rgb(rgb_to_lab(r, g, b));
            assert!(
                (back[0] as i32 - r as i32).abs() <= 1
                    && (back[1] as i32 - g as i32).abs() <= 1
                    && (back[2] as i32 - b as i32).abs() <= 1
            );
        }
    }
}
