//! The tracer: image to clean vector (phase 2, issues #23 to #32).
//!
//! For each layer (the ink of a black-and-white trace, or one colour of a
//! colour trace) the tracer:
//!
//! 1. builds a field whose zero level is the layer's boundary, from the
//!    anti-aliased image (`prep`, `colour`);
//! 2. removes specks and fills pinholes smaller than the minimum area;
//! 3. classifies each connected shape as a stroke or a fill (#26): with the
//!    distance transform, a shape whose skeleton is long compared with its
//!    width, and no wider than the largest stroke width, is a stroke;
//! 4. traces fills as sub-pixel boundaries (`contour`, #24) and strokes as
//!    centred centrelines (`skeleton`, #27);
//! 5. fits every path with lines and cubic curves (`fit`, #25).
//!
//! Lengths in the settings are millimetres; `px_per_mm` converts them for the
//! resolution traced, so the preview trace and the full-resolution export
//! trace treat the drawing the same. Output coordinates are pixels of the
//! traced image on the pixel-edge grid. Nothing is capped: every shape found
//! is returned (#29).

pub mod colour;
pub mod contour;
pub mod distance;
pub mod fit;
pub mod geom;
pub mod prep;
pub mod skeleton;

use contour::{marching_squares, Field};
use fit::{fit_path, FitOptions, FitPath, Seg};
use geom::signed_area2;
use std::fmt::Write;
use std::sync::atomic::AtomicBool;

/// Set when a stage could not have the memory it needs; the trace's result is
/// then not used, and the caller reports the image as too large.
pub static OUT_OF_MEMORY: AtomicBool = AtomicBool::new(false);

/// How each shape is traced.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Shapes {
    /// Strokes get a centreline, fills an outline.
    Auto,
    Outline,
    Centreline,
}

/// One entry of a user-chosen palette.
#[derive(Clone, Copy, Debug)]
pub struct PaletteEntry {
    pub rgb: [u8; 3],
    /// The entry whose layer this colour joins (itself to keep it), or `None` to leave it out.
    pub target: Option<usize>,
}

pub struct TraceConfig {
    pub colour: bool,
    pub shapes: Shapes,
    pub threshold: f32,
    pub invert: bool,
    pub colour_count: usize,
    /// A fixed palette; empty to find one with k-means.
    pub palette: Vec<PaletteEntry>,
    pub px_per_mm: f64,
    pub tolerance_mm: f64,
    pub corner_angle_deg: f64,
    pub max_stroke_mm: f64,
    pub min_area_mm2: f64,
    pub denoise_mm: f64,
    /// Offset of a cutline around everything traced, or 0 for none.
    pub cutline_mm: f64,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind {
    Fill,
    Stroke,
    Cut,
}

pub struct TracedPath {
    pub kind: Kind,
    pub path: FitPath,
}

pub struct TracedLayer {
    pub name: String,
    pub rgb: [u8; 3],
    /// The palette entry this layer is (for a colour trace), or `None`.
    pub palette_index: Option<usize>,
    pub paths: Vec<TracedPath>,
}

pub struct TraceResult {
    pub width: usize,
    pub height: usize,
    pub layers: Vec<TracedLayer>,
    /// The colours found or given, for a colour trace.
    pub palette: Vec<[u8; 3]>,
}

struct LayerParams {
    shapes: Shapes,
    max_stroke_px: f64,
    min_area_px: f64,
    fit: FitOptions,
}

/// Traces `rgba` (`w` x `h`, RGBA8) with `cfg`.
pub fn trace(rgba: &[u8], w: usize, h: usize, cfg: &TraceConfig) -> TraceResult {
    let ppm = cfg.px_per_mm.max(1e-6);
    let params = LayerParams {
        shapes: cfg.shapes,
        max_stroke_px: cfg.max_stroke_mm * ppm,
        min_area_px: cfg.min_area_mm2 * ppm * ppm,
        fit: FitOptions {
            tolerance: (cfg.tolerance_mm * ppm).max(0.02),
            corner_angle: cfg.corner_angle_deg.clamp(1.0, 179.0).to_radians(),
        },
    };

    let denoise_px = cfg.denoise_mm * ppm;
    let denoised;
    let img: &[u8] = if denoise_px > 0.0 {
        let mut copy = rgba[..w * h * 4].to_vec();
        prep::guided_denoise(&mut copy, w, h, denoise_px);
        // The median removes single pixels of grain, so it runs once the
        // radius reaches a pixel: below that, a pixel is smaller than the
        // setting asks to smooth.
        if denoise_px >= 1.0 {
            prep::median3(&mut copy, w, h);
        }
        denoised = copy;
        &denoised
    } else {
        rgba
    };

    let mut layers = Vec::new();
    let mut palette = Vec::new();
    // For a cutline: the largest field value of any traced layer, positive
    // inside any traced shape. Not held when there is no cutline.
    let mut union: Option<Vec<f32>> = (cfg.cutline_mm > 0.0).then(|| vec![f32::MIN; w * h]);
    if !cfg.colour {
        let mut field = prep::mono_field(img, w, h, cfg.threshold, cfg.invert);
        let paths = trace_layer(&mut field, w, h, &params, union.as_deref_mut());
        drop(field);
        layers.push(TracedLayer {
            name: "Ink".into(),
            rgb: [0, 0, 0],
            palette_index: None,
            paths,
        });
    } else {
        let fixed: Vec<[f32; 3]> = cfg
            .palette
            .iter()
            .map(|e| colour::rgb_to_lab(e.rgb[0], e.rgb[1], e.rgb[2]))
            .collect();
        let seg = colour::segment(img, w, h, cfg.colour_count.clamp(1, 32), &fixed);
        palette = seg.centres.iter().map(|c| colour::lab_to_rgb(*c)).collect();
        let n = seg.centres.len();
        // Which output layer each colour belongs to.
        let target: Vec<Option<usize>> = if cfg.palette.is_empty() {
            (0..n).map(Some).collect()
        } else {
            cfg.palette
                .iter()
                .map(|e| e.target.filter(|&t| t < n))
                .collect()
        };
        // The background: the layer covering most of the image's edge, when it
        // covers more than half of it. A cutline goes around the artwork, not
        // around the paper it is printed on (review of #84).
        let background = background_colour(&seg, w, h);
        // Layers in order of size for an automatic palette, in palette order for a fixed one.
        let mut outputs: Vec<usize> = (0..n).filter(|&c| target[c] == Some(c)).collect();
        if cfg.palette.is_empty() {
            outputs.sort_by(|&a, &b| seg.counts[b].cmp(&seg.counts[a]));
        }
        for out in outputs {
            let selected: Vec<bool> = (0..n).map(|c| target[c] == Some(out)).collect();
            if !selected
                .iter()
                .enumerate()
                .any(|(c, &s)| s && seg.counts[c] > 0)
            {
                continue;
            }
            let mut field = colour::membership_field(&seg, &selected);
            let is_background = background.is_some_and(|b| target[b] == Some(out));
            let into_union = if is_background {
                None
            } else {
                union.as_deref_mut()
            };
            let paths = trace_layer(&mut field, w, h, &params, into_union);
            let rgb = cfg.palette.get(out).map(|e| e.rgb).unwrap_or(palette[out]);
            layers.push(TracedLayer {
                name: format!("Colour {}", out + 1),
                rgb,
                palette_index: Some(out),
                paths,
            });
        }
    }

    if let Some(union) = union {
        let paths = cutline(&union, w, h, cfg.cutline_mm * ppm, &params.fit);
        layers.push(TracedLayer {
            name: "Cutline".into(),
            rgb: [255, 0, 0],
            palette_index: None,
            paths,
        });
    }

    TraceResult {
        width: w,
        height: h,
        layers,
        palette,
    }
}

/// The palette colour that is the main colour of most pixels along the image's
/// edge, when it is more than half of them: the paper the artwork sits on.
fn background_colour(seg: &colour::Segmentation, w: usize, h: usize) -> Option<usize> {
    let mut counts = vec![0usize; seg.centres.len()];
    let mut total = 0usize;
    let mut count = |i: usize| {
        let m = seg.mix[i];
        counts[(if m.t < 0.5 { m.a } else { m.b }) as usize] += 1;
        total += 1;
    };
    for x in 0..w {
        count(x);
        count((h - 1) * w + x);
    }
    for y in 1..h.saturating_sub(1) {
        count(y * w);
        count(y * w + w - 1);
    }
    let (best, n) = counts.iter().enumerate().max_by_key(|(_, &n)| n)?;
    (2 * *n > total).then_some(best)
}

/// Bytes the tracer may need at once for a `w` x `h` image with `cfg`, used to
/// refuse an image the device cannot hold instead of running out of memory
/// part way (review of #84). `None` when the figure does not even fit a
/// `usize`, which is certainly too much. Computed in 64 bits, as 32-bit
/// WASM arithmetic wraps at about 60 MP.
pub fn memory_estimate(w: usize, h: usize, cfg: &TraceConfig) -> Option<usize> {
    let n = w as u64 * h as u64;
    // A layer: its field, the inside mask, component labels, the distance
    // transform, the skeleton mask and the thinning list, and the background
    // labels when specks are removed.
    let mut per_px: u64 = 4 + 1 + 4 + 4 + 1 + 1 + 4;
    // Boundary data is not counted here: marching squares counts its crossings
    // and reserves for them itself. Reserving a worst case up front would grow
    // WASM memory for good, as it never shrinks.
    if cfg.denoise_mm > 0.0 {
        per_px += 4 + 8 * 4; // the denoised copy and the guided filter's buffers
    }
    if cfg.colour {
        per_px += 12 + 8 + 1; // Lab, the mixture and the fringe flag of every pixel
    }
    let mut bytes = n.checked_mul(per_px)?;
    if cfg.cutline_mm > 0.0 {
        let s = cutline_scale(w, h) as u64;
        let margin = (cfg.cutline_mm * cfg.px_per_mm).ceil().max(0.0) as u64 + 2;
        let gw = (w as u64 + 2 * margin).checked_mul(s)?;
        let gh = (h as u64 + 2 * margin).checked_mul(s)?;
        // The union field, and the seed and distance grids.
        bytes = bytes
            .checked_add(4 * n)?
            .checked_add(gw.checked_mul(gh)?.checked_mul(5)?)?;
    }
    usize::try_from(bytes).ok()
}

/// The cutline's distance transform runs at twice the resolution on images
/// up to 4 MP, for accuracy, and at the image's own resolution above that,
/// where a pixel is already small and memory is the limit.
fn cutline_scale(w: usize, h: usize) -> usize {
    if (w as u64) * (h as u64) <= 4_000_000 {
        2
    } else {
        1
    }
}

/// 8-connected components of `mask`: a label per pixel (0 for none) and each component's area.
fn components(mask: &[bool], w: usize, h: usize, eight: bool) -> (Vec<u32>, Vec<usize>) {
    let mut labels = vec![0u32; w * h];
    let mut areas = vec![0usize]; // label 0 unused
    let mut stack = Vec::new();
    for start in 0..w * h {
        if !mask[start] || labels[start] != 0 {
            continue;
        }
        let id = areas.len() as u32;
        let mut area = 0;
        labels[start] = id;
        stack.push(start);
        while let Some(i) = stack.pop() {
            area += 1;
            let (x, y) = ((i % w) as isize, (i / w) as isize);
            for dy in -1..=1isize {
                for dx in -1..=1isize {
                    if (dx == 0 && dy == 0) || (!eight && dx != 0 && dy != 0) {
                        continue;
                    }
                    let (nx, ny) = (x + dx, y + dy);
                    if nx < 0 || ny < 0 || nx >= w as isize || ny >= h as isize {
                        continue;
                    }
                    let j = ny as usize * w + nx as usize;
                    if mask[j] && labels[j] == 0 {
                        labels[j] = id;
                        stack.push(j);
                    }
                }
            }
        }
        areas.push(area);
    }
    (labels, areas)
}

/// Traces one layer's field. Specks and pinholes below the minimum area are
/// removed from `field` first, so it ends as the field that was traced.
fn trace_layer(
    field: &mut [f32],
    w: usize,
    h: usize,
    p: &LayerParams,
    union: Option<&mut [f32]>,
) -> Vec<TracedPath> {
    let mut inside: Vec<bool> = field.iter().map(|&v| v > 0.0).collect();

    if p.min_area_px > 0.0 {
        let (labels, areas) = components(&inside, w, h, true);
        for i in 0..w * h {
            if labels[i] != 0 && (areas[labels[i] as usize] as f64) < p.min_area_px {
                field[i] = -field[i].abs().max(1e-3);
            }
        }
        // Holes: background regions (4-connected) that do not reach the border.
        let outside: Vec<bool> = inside.iter().map(|&v| !v).collect();
        let (bl, ba) = components(&outside, w, h, false);
        let mut touches = vec![false; ba.len()];
        for x in 0..w {
            touches[bl[x] as usize] = true;
            touches[bl[(h - 1) * w + x] as usize] = true;
        }
        for y in 0..h {
            touches[bl[y * w] as usize] = true;
            touches[bl[y * w + w - 1] as usize] = true;
        }
        for i in 0..w * h {
            let l = bl[i] as usize;
            if l != 0 && !touches[l] && (ba[l] as f64) < p.min_area_px {
                field[i] = field[i].abs().max(1e-3);
            }
        }
        for i in 0..w * h {
            inside[i] = field[i] > 0.0;
        }
    }

    if let Some(u) = union {
        for (u, v) in u.iter_mut().zip(field.iter()) {
            *u = u.max(*v);
        }
    }

    let mut out = Vec::new();
    if p.shapes != Shapes::Outline {
        let (labels, areas) = components(&inside, w, h, true);
        let nc = areas.len();
        let dt = distance::distance_to_outside(&inside, w, h);
        let mut max_dt = vec![0.0f32; nc];
        let mut bbox = vec![(usize::MAX, usize::MAX, 0usize, 0usize); nc];
        for i in 0..w * h {
            let l = labels[i] as usize;
            if l == 0 {
                continue;
            }
            max_dt[l] = max_dt[l].max(dt[i]);
            let (x, y) = (i % w, i / w);
            let b = &mut bbox[l];
            *b = (b.0.min(x), b.1.min(y), b.2.max(x), b.3.max(y));
        }
        // Shapes that can be strokes: any in centreline mode, thin enough in auto.
        let candidate: Vec<bool> = (0..nc)
            .map(|l| {
                // The mask's width is up to a pixel under the anti-aliased one; the exact test follows.
                l != 0
                    && (p.shapes == Shapes::Centreline
                        || (2.0 * max_dt[l] as f64 - 1.0) <= p.max_stroke_px + 2.0)
            })
            .collect();
        if candidate.iter().any(|&c| c) {
            let mut sk: Vec<bool> = (0..w * h).map(|i| candidate[labels[i] as usize]).collect();
            let mut ub = (usize::MAX, usize::MAX, 0usize, 0usize);
            for l in 0..nc {
                if candidate[l] {
                    let b = bbox[l];
                    ub = (ub.0.min(b.0), ub.1.min(b.1), ub.2.max(b.2), ub.3.max(b.3));
                }
            }
            skeleton::thin(&mut sk, w, h, ub);
            let mut skel_of: Vec<Vec<usize>> = vec![Vec::new(); nc];
            for (i, &s) in sk.iter().enumerate() {
                if s {
                    skel_of[labels[i] as usize].push(i);
                }
            }
            let f = Field { w, h, v: field };
            let mut is_stroke = vec![false; nc];
            let mut chains_by: Vec<Vec<skeleton::Chain>> = (0..nc).map(|_| Vec::new()).collect();
            for l in 0..nc {
                if !candidate[l] || skel_of[l].len() < 2 {
                    continue;
                }
                let chains = skeleton::chains_of(&skel_of[l], &mut sk, w, h, &dt, &f);
                if p.shapes == Shapes::Auto {
                    // A stroke: no wider than the limit (measured across its
                    // anti-aliased edges) and much longer than it is wide.
                    let mut widths: Vec<f64> = chains
                        .iter()
                        .flat_map(|c| c.widths.iter().copied())
                        .collect();
                    if widths.is_empty() {
                        continue;
                    }
                    widths.sort_by(|a, b| a.partial_cmp(b).unwrap());
                    let p90 = widths[(widths.len() * 9 / 10).min(widths.len() - 1)];
                    let median = widths[widths.len() / 2];
                    let length: f64 = chains
                        .iter()
                        .map(|c| c.pts.windows(2).map(|q| q[0].dist(q[1])).sum::<f64>())
                        .sum();
                    if p90 > p.max_stroke_px || length < 2.0 * median + 2.0 {
                        continue;
                    }
                }
                if !chains.is_empty() {
                    is_stroke[l] = true;
                    chains_by[l] = chains;
                }
            }
            // In Centreline mode every shape is traced along its middle, including
            // dots and blobs whose skeleton gives no path: each becomes a centre
            // line along its main axis, as long as the shape is longer than wide,
            // or a point for a round dot (review of #84).
            if p.shapes == Shapes::Centreline {
                // Per shape: pixel count, sums of x, y, x², y², xy.
                let mut mom = vec![[0.0f64; 6]; nc];
                for i in 0..w * h {
                    let l = labels[i] as usize;
                    if l == 0 || is_stroke[l] {
                        continue;
                    }
                    let (x, y) = ((i % w) as f64 + 0.5, (i / w) as f64 + 0.5);
                    let m = &mut mom[l];
                    m[0] += 1.0;
                    m[1] += x;
                    m[2] += y;
                    m[3] += x * x;
                    m[4] += y * y;
                    m[5] += x * y;
                }
                for (l, m) in mom.iter().enumerate() {
                    if l == 0 || is_stroke[l] || m[0] == 0.0 {
                        continue;
                    }
                    let c = geom::P::new(m[1] / m[0], m[2] / m[0]);
                    let sxx = m[3] / m[0] - c.x * c.x;
                    let syy = m[4] / m[0] - c.y * c.y;
                    let sxy = m[5] / m[0] - c.x * c.y;
                    // Principal axes of the shape's spread.
                    let mean = 0.5 * (sxx + syy);
                    let diff = (0.25 * (sxx - syy) * (sxx - syy) + sxy * sxy).sqrt();
                    let (major, minor) = (mean + diff, (mean - diff).max(0.0));
                    let angle = 0.5 * (2.0 * sxy).atan2(sxx - syy);
                    let u = geom::P::new(angle.cos(), angle.sin());
                    // A uniform bar of length a has variance a² / 12 along it.
                    let half = 0.5 * ((12.0 * major).sqrt() - (12.0 * minor).sqrt()).max(0.0);
                    let (a, b) = (c.sub(u.scale(half)), c.add(u.scale(half)));
                    out.push(TracedPath {
                        kind: Kind::Stroke,
                        path: FitPath {
                            start: a,
                            segs: vec![Seg::Line(b)],
                            closed: false,
                        },
                    });
                    is_stroke[l] = true;
                }
            }
            // The outlines are traced from the field with the strokes taken out.
            for i in 0..w * h {
                if is_stroke[labels[i] as usize] {
                    field[i] = -field[i].abs().max(1e-3);
                }
            }
            for chains in chains_by {
                for c in chains {
                    if let Some(path) = fit_path(&c.pts, &c.fixed, c.closed, &p.fit) {
                        out.push(TracedPath {
                            kind: Kind::Stroke,
                            path,
                        });
                    }
                }
            }
        }
    }

    let f = Field { w, h, v: field };
    let mut fills: Vec<TracedPath> = marching_squares(&f)
        .into_iter()
        .filter_map(|lp| fit_path(&lp.pts, &[], true, &p.fit))
        .map(|path| TracedPath {
            kind: Kind::Fill,
            path,
        })
        .collect();
    fills.append(&mut out);
    fills
}

/// A cutline `offset_px` outside everything traced: the outer boundary of
/// the shapes grown by the offset. `union` is the traced field (positive
/// inside any traced shape). The distance transform runs on a mask sampled at
/// twice the resolution from the anti-aliased field, so the offset is accurate
/// to about a third of a pixel. Holes are not cut.
fn cutline(union: &[f32], w: usize, h: usize, offset_px: f64, fit: &FitOptions) -> Vec<TracedPath> {
    let sc = cutline_scale(w, h);
    let margin = (offset_px.ceil() as usize + 2) * sc;
    let (pw, ph) = (w * sc + 2 * margin, h * sc + 2 * margin);
    let field = Field { w, h, v: union };
    let mut seed = vec![false; pw * ph];
    for sy in 0..h * sc {
        for sx in 0..w * sc {
            let p = geom::P::new((sx as f64 + 0.5) / sc as f64, (sy as f64 + 0.5) / sc as f64);
            seed[(sy + margin) * pw + sx + margin] = field.sample(p) > 0.0;
        }
    }
    let mut grown = distance::distance_to_seed(&seed, pw, ph);
    drop(seed);
    // The boundary lies half a sample beyond the centres of the outermost samples.
    let level = (offset_px * sc as f64 + 0.5) as f32;
    grown
        .iter_mut()
        .for_each(|d| *d = if *d == level { -1e-6 } else { level - *d });
    let loops = marching_squares(&Field {
        w: pw,
        h: ph,
        v: &grown,
    });
    let shift = margin as f64;
    let scaled_fit = FitOptions {
        tolerance: fit.tolerance * sc as f64,
        corner_angle: fit.corner_angle,
    };
    loops
        .into_iter()
        .filter(|lp| signed_area2(&lp.pts) > 0.0) // outer boundaries run clockwise
        .filter_map(|lp| fit_path(&lp.pts, &[], true, &scaled_fit))
        .map(|path| TracedPath {
            kind: Kind::Cut,
            path: scale_path(&path, 1.0 / sc as f64, -shift),
        })
        .collect()
}

/// `p` with every point moved by `shift` (in its own units) and then scaled by `s`.
fn scale_path(p: &FitPath, s: f64, shift: f64) -> FitPath {
    let t = |q: geom::P| geom::P::new((q.x + shift) * s, (q.y + shift) * s);
    FitPath {
        start: t(p.start),
        closed: p.closed,
        segs: p
            .segs
            .iter()
            .map(|seg| match *seg {
                Seg::Line(q) => Seg::Line(t(q)),
                Seg::Cubic(a, b, q) => Seg::Cubic(t(a), t(b), t(q)),
            })
            .collect(),
    }
}

fn num(out: &mut String, v: f64) {
    let r = (v * 1000.0).round() / 1000.0;
    let r = if r == 0.0 { 0.0 } else { r }; // no "-0"
    let _ = write!(out, "{}", r);
}

/// SVG path data of a fitted path, in traced pixels.
pub fn path_data(p: &FitPath) -> String {
    let mut d = String::with_capacity(16 + p.segs.len() * 40);
    let pt = |d: &mut String, q: geom::P| {
        num(d, q.x);
        d.push(' ');
        num(d, q.y);
    };
    d.push_str("M ");
    pt(&mut d, p.start);
    for s in &p.segs {
        match *s {
            Seg::Line(q) => {
                d.push_str(" L ");
                pt(&mut d, q);
            }
            Seg::Cubic(c1, c2, q) => {
                d.push_str(" C ");
                pt(&mut d, c1);
                d.push(' ');
                pt(&mut d, c2);
                d.push(' ');
                pt(&mut d, q);
            }
        }
    }
    if p.closed {
        d.push_str(" Z");
    }
    d
}

fn hex(rgb: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2])
}

/// The result as JSON, read by `src/wasm/wasm-bridge.ts`.
pub fn to_json(r: &TraceResult) -> String {
    let mut j = String::with_capacity(4096);
    let _ = write!(
        j,
        "{{\"width\":{},\"height\":{},\"palette\":[",
        r.width, r.height
    );
    for (i, c) in r.palette.iter().enumerate() {
        if i > 0 {
            j.push(',');
        }
        let _ = write!(j, "\"{}\"", hex(*c));
    }
    j.push_str("],\"layers\":[");
    for (li, l) in r.layers.iter().enumerate() {
        if li > 0 {
            j.push(',');
        }
        let _ = write!(
            j,
            "{{\"name\":\"{}\",\"color\":\"{}\",\"paletteIndex\":{},\"paths\":[",
            l.name,
            hex(l.rgb),
            l.palette_index.map(|i| i as i64).unwrap_or(-1)
        );
        for (pi, p) in l.paths.iter().enumerate() {
            if pi > 0 {
                j.push(',');
            }
            let kind = match p.kind {
                Kind::Fill => "fill",
                Kind::Stroke => "stroke",
                Kind::Cut => "cut",
            };
            let _ = write!(
                j,
                "{{\"kind\":\"{}\",\"closed\":{},\"nodes\":{},\"d\":\"{}\"}}",
                kind,
                p.path.closed,
                p.path.segs.len() + 1,
                path_data(&p.path)
            );
        }
        j.push_str("]}");
    }
    j.push_str("]}");
    j
}

#[cfg(test)]
mod tests;
