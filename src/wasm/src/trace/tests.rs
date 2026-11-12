//! Whole-tracer tests on synthetic, anti-aliased shapes with known geometry.

use super::fit::Seg;
use super::geom::P;
use super::*;

/// Renders a grey image where `ink(x, y)` says whether a point is ink, with
/// 8x8 supersampled anti-aliasing (ink black on white).
pub fn render(w: usize, h: usize, ink: impl Fn(f64, f64) -> bool) -> Vec<u8> {
    let mut px = vec![255u8; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let mut c = 0;
            for sy in 0..8 {
                for sx in 0..8 {
                    if ink(
                        x as f64 + (sx as f64 + 0.5) / 8.0,
                        y as f64 + (sy as f64 + 0.5) / 8.0,
                    ) {
                        c += 1;
                    }
                }
            }
            let v = 255 - (c * 255 / 64) as u8;
            let i = (y * w + x) * 4;
            px[i] = v;
            px[i + 1] = v;
            px[i + 2] = v;
        }
    }
    px
}

pub fn cfg(shapes: Shapes) -> TraceConfig {
    TraceConfig {
        colour: false,
        shapes,
        threshold: 128.0,
        invert: false,
        colour_count: 4,
        palette: Vec::new(),
        px_per_mm: 10.0,
        tolerance_mm: 0.02, // 0.2 px
        corner_angle_deg: 60.0,
        max_stroke_mm: 1.0, // 10 px
        min_area_mm2: 0.0,
        denoise_mm: 0.0,
        cutline_mm: 0.0,
    }
}

/// Points along a fitted path, with curves sampled finely.
pub fn sample(p: &FitPath) -> Vec<P> {
    let mut out = vec![p.start];
    let mut cur = p.start;
    for s in &p.segs {
        match *s {
            Seg::Line(q) => {
                for k in 1..=20 {
                    out.push(cur.lerp(q, k as f64 / 20.0));
                }
                cur = q;
            }
            Seg::Cubic(c1, c2, q) => {
                for k in 1..=40 {
                    let t = k as f64 / 40.0;
                    let mt = 1.0 - t;
                    out.push(
                        cur.scale(mt * mt * mt)
                            .add(c1.scale(3.0 * mt * mt * t))
                            .add(c2.scale(3.0 * mt * t * t))
                            .add(q.scale(t * t * t)),
                    );
                }
                cur = q;
            }
        }
    }
    out
}

fn all_paths(r: &TraceResult) -> Vec<&TracedPath> {
    r.layers.iter().flat_map(|l| l.paths.iter()).collect()
}

#[test]
fn circle_fits_within_tolerance_with_few_curves() {
    let (c, r) = (50.0, 37.3);
    let img = render(100, 100, |x, y| (x - c).hypot(y - c) < r);
    let res = trace(&img, 100, 100, &cfg(Shapes::Auto));
    let paths = all_paths(&res);
    assert_eq!(paths.len(), 1);
    assert_eq!(paths[0].kind, Kind::Fill);
    let p = &paths[0].path;
    assert!(p.segs.len() <= 8, "{} segments", p.segs.len());
    let worst = sample(p)
        .iter()
        .map(|q| (q.dist(P::new(c, c)) - r).abs())
        .fold(0.0, f64::max);
    assert!(worst < 0.25, "radial error {worst}");
}

#[test]
fn square_is_four_lines_with_exact_corners() {
    let img = render(60, 60, |x, y| {
        (10.0..40.0).contains(&x) && (12.0..42.0).contains(&y)
    });
    let res = trace(&img, 60, 60, &cfg(Shapes::Outline));
    let paths = all_paths(&res);
    assert_eq!(paths.len(), 1);
    let p = &paths[0].path;
    assert_eq!(p.segs.len(), 4, "{:?}", p.segs);
    let mut pts = vec![p.start];
    for s in &p.segs {
        match s {
            Seg::Line(q) => pts.push(*q),
            _ => panic!("curve"),
        }
    }
    for q in pts {
        assert!(
            (q.x - 10.0).abs() < 0.02 || (q.x - 40.0).abs() < 0.02,
            "{q:?}"
        );
        assert!(
            (q.y - 12.0).abs() < 0.02 || (q.y - 42.0).abs() < 0.02,
            "{q:?}"
        );
    }
}

#[test]
fn rounded_rectangle_is_four_lines_and_four_arcs() {
    let (x0, y0, x1, y1, r) = (10.0, 10.0, 90.0, 70.0, 15.0);
    let img = render(100, 80, |x, y| {
        if !(x0..x1).contains(&x) || !(y0..y1).contains(&y) {
            return false;
        }
        let cx = x.clamp(x0 + r, x1 - r);
        let cy = y.clamp(y0 + r, y1 - r);
        (x - cx).hypot(y - cy) < r
    });
    let res = trace(&img, 100, 80, &cfg(Shapes::Outline));
    let p = &all_paths(&res)[0].path;
    let lines = p.segs.iter().filter(|s| matches!(s, Seg::Line(_))).count();
    let curves = p
        .segs
        .iter()
        .filter(|s| matches!(s, Seg::Cubic(..)))
        .count();
    assert_eq!((lines, curves), (4, 4), "{:?}", p.segs);
}

#[test]
fn ring_drawn_with_a_pen_is_one_closed_centreline() {
    let img = render(100, 100, |x, y| {
        ((x - 50.0).hypot(y - 50.0) - 30.0).abs() < 3.0
    });
    let res = trace(&img, 100, 100, &cfg(Shapes::Auto));
    let paths = all_paths(&res);
    assert_eq!(paths.len(), 1, "{}", paths.len());
    assert_eq!(paths[0].kind, Kind::Stroke);
    assert!(paths[0].path.closed);
    let worst = sample(&paths[0].path)
        .iter()
        .map(|q| (q.dist(P::new(50.0, 50.0)) - 30.0).abs())
        .fold(0.0, f64::max);
    assert!(worst < 0.5, "radial error {worst}");
}

#[test]
fn disc_and_ring_give_an_outline_and_a_centreline() {
    let img = render(200, 100, |x, y| {
        (x - 50.0).hypot(y - 50.0) < 30.0 || ((x - 150.0).hypot(y - 50.0) - 30.0).abs() < 2.5
    });
    let res = trace(&img, 200, 100, &cfg(Shapes::Auto));
    let paths = all_paths(&res);
    assert_eq!(paths.len(), 2);
    assert!(paths.iter().any(|p| p.kind == Kind::Fill && p.path.closed));
    assert!(paths
        .iter()
        .any(|p| p.kind == Kind::Stroke && p.path.closed));
}

#[test]
fn straight_stroke_is_one_line_on_its_centre() {
    // 5 px wide, centre at y = 30.3.
    let img = render(100, 60, |x, y| {
        (10.0..90.0).contains(&x) && (y - 30.3).abs() < 2.5
    });
    let res = trace(&img, 100, 60, &cfg(Shapes::Auto));
    let paths = all_paths(&res);
    assert_eq!(paths.len(), 1);
    assert_eq!(paths[0].kind, Kind::Stroke);
    for q in sample(&paths[0].path) {
        assert!((q.y - 30.3).abs() < 0.25, "{q:?}");
    }
}

#[test]
fn t_junction_is_connected() {
    let img = render(100, 100, |x, y| {
        ((10.0..90.0).contains(&x) && (y - 20.0).abs() < 2.0)
            || ((x - 50.0).abs() < 2.0 && (20.0..90.0).contains(&y))
    });
    let res = trace(&img, 100, 100, &cfg(Shapes::Auto));
    let paths = all_paths(&res);
    assert_eq!(paths.len(), 2, "{}", paths.len());
    assert!(paths.iter().all(|p| p.kind == Kind::Stroke));
    // Each path's ends: one end of the stem must lie on the bar.
    let bar = paths
        .iter()
        .find(|p| sample(&p.path).iter().all(|q| (q.y - 20.0).abs() < 1.0))
        .expect("a bar");
    let stem = paths.iter().find(|p| !std::ptr::eq(*p, bar)).unwrap();
    let bar_pts = sample(&bar.path);
    let stem_pts = sample(&stem.path);
    let gap = [stem_pts[0], *stem_pts.last().unwrap()]
        .iter()
        .map(|e| bar_pts.iter().map(|b| b.dist(*e)).fold(f64::MAX, f64::min))
        .fold(f64::MAX, f64::min);
    assert!(gap < 0.2, "gap {gap}");
}

#[test]
fn stroke_touching_the_edge_has_clean_ends() {
    let img = render(80, 40, |x, y| x < 60.0 && (y - 20.0).abs() < 2.0);
    let res = trace(&img, 80, 40, &cfg(Shapes::Auto));
    let paths = all_paths(&res);
    assert_eq!(paths.len(), 1);
    let pts = sample(&paths[0].path);
    for q in &pts {
        assert!((q.y - 20.0).abs() < 0.3, "{q:?}");
    }
    let xs: Vec<f64> = [pts[0].x, pts.last().unwrap().x].to_vec();
    let lo = xs[0].min(xs[1]);
    assert!(lo < 0.5, "starts at {lo}");
}

#[test]
fn hairline_survives_default_settings() {
    let img = render(100, 30, |x, y| {
        (5.0..95.0).contains(&x) && (14.0..15.0).contains(&y)
    });
    let res = trace(&img, 100, 30, &cfg(Shapes::Auto));
    assert_eq!(all_paths(&res).len(), 1);
}

#[test]
fn diagonal_one_pixel_line_is_one_shape() {
    let mut img = vec![255u8; 40 * 40 * 4];
    for k in 5..35 {
        let i = (k * 40 + k) * 4;
        img[i] = 0;
        img[i + 1] = 0;
        img[i + 2] = 0;
    }
    let res = trace(&img, 40, 40, &cfg(Shapes::Outline));
    assert_eq!(all_paths(&res).len(), 1);
}

#[test]
fn dot_grid_returns_every_dot() {
    let (w, h) = (500, 500);
    let img = render(w, h, |x, y| {
        let fx = x % 5.0;
        let fy = y % 5.0;
        (1.0..3.0).contains(&fx) && (1.0..3.0).contains(&fy) && x < 495.0 && y < 495.0
    });
    let res = trace(&img, w, h, &cfg(Shapes::Auto));
    assert_eq!(all_paths(&res).len(), 99 * 99);
}

#[test]
fn comb_is_one_path() {
    let (w, h) = (600, 600);
    let img = render(w, h, |x, y| {
        (y < 40.0 && x < 590.0) || (y < 590.0 && x < 590.0 && (x % 6.0) < 3.0)
    });
    let res = trace(&img, w, h, &cfg(Shapes::Outline));
    let paths = all_paths(&res);
    assert_eq!(paths.len(), 1);
    assert!(paths[0].path.closed);
}

#[test]
fn three_squares_at_four_colours() {
    let (w, h) = (90, 40);
    let mut img = vec![255u8; w * h * 4];
    for y in 10..30 {
        for (k, rgb) in [[220u8, 30, 30], [30, 60, 220], [40, 170, 60]]
            .iter()
            .enumerate()
        {
            for x in 10 + k * 25..30 + k * 25 {
                let i = (y * w + x) * 4;
                img[i..i + 3].copy_from_slice(rgb);
            }
        }
    }
    let mut c = cfg(Shapes::Outline);
    c.colour = true;
    c.colour_count = 4;
    let res = trace(&img, w, h, &c);
    assert_eq!(res.layers.len(), 4);
    let names: Vec<[u8; 3]> = res.layers.iter().map(|l| l.rgb).collect();
    for want in [
        [255u8, 255, 255],
        [220, 30, 30],
        [30, 60, 220],
        [40, 170, 60],
    ] {
        assert!(
            names
                .iter()
                .any(|g| (0..3).all(|i| (g[i] as i32 - want[i] as i32).abs() <= 3)),
            "{want:?} missing from {names:?}"
        );
    }
    for l in &res.layers[1..] {
        assert_eq!(l.paths.len(), 1, "{}", l.name);
        assert_eq!(l.paths[0].path.segs.len(), 4);
    }
}

#[test]
fn anti_aliased_two_colour_logo_has_no_slivers() {
    let (w, h) = (120, 120);
    let ink =
        |x: f64, y: f64| (x - 60.0).hypot(y - 60.0) < 40.0 && !((x - 60.0).hypot(y - 60.0) < 18.0);
    let grey = render(w, h, ink);
    // Recolour: ink becomes navy, paper stays cream.
    let mut img = grey.clone();
    for i in 0..w * h {
        let a = 1.0 - grey[i * 4] as f64 / 255.0;
        for (c, (ink_c, paper_c)) in [(20.0, 245.0), (30.0, 235.0), (90.0, 210.0)]
            .iter()
            .enumerate()
        {
            img[i * 4 + c] = (ink_c * a + paper_c * (1.0 - a)).round() as u8;
        }
    }
    let mut c = cfg(Shapes::Outline);
    c.colour = true;
    c.colour_count = 4;
    let res = trace(&img, w, h, &c);
    assert_eq!(
        res.layers.len(),
        2,
        "{:?}",
        res.layers.iter().map(|l| l.rgb).collect::<Vec<_>>()
    );
}

#[test]
fn cutline_is_offset_by_the_distance() {
    let img = render(100, 100, |x, y| (x - 50.0).hypot(y - 50.0) < 20.0);
    let mut c = cfg(Shapes::Outline);
    c.cutline_mm = 1.0; // 10 px
    let res = trace(&img, 100, 100, &c);
    let cut = res.layers.iter().find(|l| l.name == "Cutline").unwrap();
    assert_eq!(cut.paths.len(), 1);
    let worst = sample(&cut.paths[0].path)
        .iter()
        .map(|q| (q.dist(P::new(50.0, 50.0)) - 30.0).abs())
        .fold(0.0, f64::max);
    assert!(worst < 0.6, "offset error {worst}");
}

/// A speck inside a pinhole goes with the hole: both are below the minimum
/// area, so the shape comes out solid (review of #84).
#[test]
fn speck_inside_a_pinhole_leaves_no_hole() {
    let ink = |x: f64, y: f64| {
        let square = (10.0..70.0).contains(&x) && (10.0..70.0).contains(&y);
        let hole = (37.0..43.0).contains(&x) && (37.0..43.0).contains(&y);
        let speck = (39.0..41.0).contains(&x) && (39.0..41.0).contains(&y);
        (square && !hole) || speck
    };
    let px = render(80, 80, ink);
    let mut c = cfg(Shapes::Outline);
    c.min_area_mm2 = 0.5; // 50 px: the hole is 32 px and the speck 4 px
    let r = trace(&px, 80, 80, &c);
    assert_eq!(all_paths(&r).len(), 1, "only the square's outline remains");
}

/// Worst distance of the traced centrelines of a T, drawn `width` px wide and
/// turned by `deg` about the image centre, from the true centre lines.
fn rotated_t_error(width: f64, deg: f64) -> f64 {
    use super::geom::dist_to_segment;
    let (s, c) = deg.to_radians().sin_cos();
    let turn = |p: P| {
        P::new(
            60.0 + (p.x - 60.0) * c - (p.y - 60.0) * s,
            60.0 + (p.x - 60.0) * s + (p.y - 60.0) * c,
        )
    };
    // Bar from (25, 40) to (95, 40), stem from (60, 40) to (60, 95), before turning.
    let (b0, b1) = (turn(P::new(25.0, 40.0)), turn(P::new(95.0, 40.0)));
    let (s0, s1) = (turn(P::new(60.0, 40.0)), turn(P::new(60.0, 95.0)));
    let hw = width / 2.0;
    let img = render(120, 120, |x, y| {
        let p = P::new(x, y);
        dist_to_segment(p, b0, b1) < hw || dist_to_segment(p, s0, s1) < hw
    });
    let res = trace(&img, 120, 120, &cfg(Shapes::Auto));
    let paths = all_paths(&res);
    assert!(
        !paths.is_empty() && paths.iter().all(|p| p.kind == Kind::Stroke),
        "{deg}°: strokes"
    );
    // The strokes have round caps, so a centreline may run on into a cap.
    let (c0, c1, c2) = (
        turn(P::new(25.0 - hw, 40.0)),
        turn(P::new(95.0 + hw, 40.0)),
        turn(P::new(60.0, 95.0 + hw)),
    );
    paths
        .iter()
        .flat_map(|p| sample(&p.path))
        .map(|q| dist_to_segment(q, c0, c1).min(dist_to_segment(q, s0, c2)))
        .fold(0.0, f64::max)
}

/// A junction on strokes at any angle: the centrelines stay on the strokes'
/// centres through the junction (review of #84). The thinned pixels around a
/// junction are not centred, and on a slanted stroke they lean into the stem.
#[test]
fn t_junction_is_centred_at_any_angle() {
    for width in [4.0, 6.5, 8.0] {
        let mut worst: f64 = 0.0;
        for k in 0..24 {
            let deg = -43.0 + 86.0 * k as f64 / 23.0;
            let e = rotated_t_error(width, deg);
            worst = worst.max(e);
        }
        assert!(worst < 0.35, "width {width}: worst {worst}");
    }
}

/// A thin ring is centred all the way round, including where the chain closes.
#[test]
fn thin_ring_is_centred_all_round() {
    for (cx, cy) in [(50.0, 50.0), (50.3, 49.6), (49.5, 50.5)] {
        let img = render(100, 100, |x, y| ((x - cx).hypot(y - cy) - 33.0).abs() < 1.2);
        let res = trace(&img, 100, 100, &cfg(Shapes::Auto));
        let paths = all_paths(&res);
        assert_eq!(paths.len(), 1);
        assert!(paths[0].path.closed && paths[0].kind == Kind::Stroke);
        let worst = sample(&paths[0].path)
            .iter()
            .map(|q| (q.dist(P::new(cx, cy)) - 33.0).abs())
            .fold(0.0, f64::max);
        assert!(worst < 0.35, "centre ({cx}, {cy}): radial error {worst}");
    }
}

/// Artwork that runs off the image ends at the image's edge: no point of a
/// fill or a stroke lies outside it, so a file without a cutline measures
/// the image exactly (review of #84).
#[test]
fn shapes_cut_by_the_edge_stay_inside_the_image() {
    use super::geom::dist_to_segment;
    let (w, h) = (200usize, 120usize);
    let img = render(w, h, |x, y| {
        let p = P::new(x, y);
        dist_to_segment(p, P::new(150.0, -20.0), P::new(230.0, 70.0)) < 1.5
            || dist_to_segment(p, P::new(-10.0, 100.0), P::new(60.0, 140.0)) < 9.0
    });
    for shapes in [Shapes::Outline, Shapes::Auto, Shapes::Centreline] {
        let res = trace(&img, w, h, &cfg(shapes));
        let paths = all_paths(&res);
        assert!(!paths.is_empty());
        for p in paths {
            let mut pts = vec![p.path.start];
            for s in &p.path.segs {
                match *s {
                    Seg::Line(q) => pts.push(q),
                    Seg::Cubic(a, b, q) => pts.extend([a, b, q]),
                }
            }
            for q in pts {
                assert!(
                    q.x >= 0.0 && q.y >= 0.0 && q.x <= w as f64 && q.y <= h as f64,
                    "{q:?} is outside the image"
                );
            }
        }
    }
}

/// Worst distance from the traced outline of a rounded rectangle, turned by
/// `deg`, to its true boundary.
fn rounded_rect_error(radius: f64, deg: f64, tolerance_px: f64) -> f64 {
    let (s, c) = deg.to_radians().sin_cos();
    // Signed distance to a 50 x 30 rectangle with rounded corners, centred at (50, 50).
    let sd = move |x: f64, y: f64| {
        let (dx, dy) = (x - 50.0, y - 50.0);
        let (u, v) = (dx * c + dy * s, -dx * s + dy * c);
        let (qx, qy) = (u.abs() - (25.0 - radius), v.abs() - (15.0 - radius));
        qx.max(0.0).hypot(qy.max(0.0)) + qx.max(qy).min(0.0) - radius
    };
    let img = render(100, 100, |x, y| sd(x, y) < 0.0);
    let mut cf = cfg(Shapes::Outline);
    cf.tolerance_mm = tolerance_px / cf.px_per_mm;
    let res = trace(&img, 100, 100, &cf);
    let paths = all_paths(&res);
    assert_eq!(paths.len(), 1);
    sample(&paths[0].path)
        .iter()
        .map(|q| sd(q.x, q.y).abs())
        .fold(0.0, f64::max)
}

/// The Accuracy setting is the largest deviation: a small rounded corner is
/// not replaced by a sharp one further from the edge than that, and straight
/// runs are held to it too (review of #84).
#[test]
fn rounded_corners_stay_within_the_accuracy() {
    for deg in [0.0, 11.0, 27.0, 38.0] {
        for (radius, tol) in [(2.2, 0.5), (3.0, 0.5), (2.2, 0.2), (1.5, 0.3)] {
            let e = rounded_rect_error(radius, deg, tol);
            // A tenth of a pixel for the anti-aliased boundary itself.
            assert!(
                e <= tol + 0.1,
                "radius {radius} at {deg}°, accuracy {tol}: off by {e}"
            );
        }
    }
}

/// The memory asked for is what is held at once: denoising's buffers are
/// freed before tracing starts, so they are not added to the tracing buffers
/// (review of #84).
#[test]
fn memory_estimate_is_the_larger_phase_not_the_sum() {
    let n = 5000 * 4000;
    let mut c = cfg(Shapes::Auto);
    assert_eq!(memory_estimate(5000, 4000, &c), Some(n * 19));
    c.denoise_mm = 0.1;
    assert_eq!(
        memory_estimate(5000, 4000, &c),
        Some(n * 36),
        "denoising is the larger"
    );
    c.colour = true;
    assert_eq!(
        memory_estimate(5000, 4000, &c),
        Some(n * 44),
        "tracing in colour is the larger"
    );
}
