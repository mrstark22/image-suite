//! Curve fitting with corner detection (#25).
//!
//! A traced polyline (a sub-pixel boundary or a centred skeleton chain) is
//! turned into lines and cubic Bézier curves in three steps:
//!
//! 1. **Corners.** The turning angle at each point is measured between chords
//!    a fixed arc length before and after it. Local maxima above the corner
//!    angle are corners; the path is broken there and no tangent is shared.
//! 2. **Straight runs.** Between corners, maximal runs of points that fit a
//!    straight line (by total least squares) within the tolerance, with no
//!    systematic bend (the quadratic term of the residual is below a tenth of
//!    a pixel), and at least `MIN_LINE_PX` long, become line segments. Two
//!    lines meeting at a corner are extended to their intersection, so a
//!    square keeps exact corners even though its traced corner is chamfered.
//! 3. **Curves.** What is left is fitted with cubic Béziers by least squares
//!    (Schneider, "An Algorithm for Automatically Fitting Digitized Curves",
//!    Graphics Gems, 1990): chord-length parameters, Newton reparameterisation,
//!    and a split at the worst point when the error exceeds the tolerance. A
//!    curve that meets a line or another curve without a corner takes that
//!    tangent, so the joins are smooth.

use super::geom::{dist_to_segment, P};

/// A segment of a fitted path; each one starts where the previous one ended.
#[derive(Clone, Copy, Debug)]
pub enum Seg {
    Line(P),
    Cubic(P, P, P),
}

#[derive(Clone, Debug)]
pub struct FitPath {
    pub start: P,
    pub segs: Vec<Seg>,
    pub closed: bool,
}

pub struct FitOptions {
    /// Largest distance, in pixels, between the fitted path and the traced points.
    pub tolerance: f64,
    /// Turning angle, in radians, above which a point is a corner.
    pub corner_angle: f64,
}

/// A straight run is at least this long, in pixels, so that gentle curves are not cut into flats.
const MIN_LINE_PX: f64 = 10.0;
/// Largest bend, in pixels, of a run that is accepted as straight.
const MAX_LINE_BEND_PX: f64 = 0.1;
/// Points closer than this are merged before fitting.
const MIN_SPACING_PX: f64 = 0.02;

/// Fits `pts` with lines and cubic curves. `fixed` marks points the path must
/// pass through exactly and break at (junctions of a centreline). For a
/// closed path `pts` does not repeat its first point.
pub fn fit_path(pts: &[P], fixed: &[bool], closed: bool, opt: &FitOptions) -> Option<FitPath> {
    // Merge near-duplicate points, keeping fixed marks.
    let mut q: Vec<P> = Vec::with_capacity(pts.len() + 1);
    let mut fx: Vec<bool> = Vec::with_capacity(pts.len() + 1);
    for (i, &p) in pts.iter().enumerate() {
        let f = fixed.get(i).copied().unwrap_or(false);
        if let Some(last) = q.last() {
            if last.dist(p) < MIN_SPACING_PX {
                if f {
                    *fx.last_mut().unwrap() = true;
                }
                continue;
            }
        }
        q.push(p);
        fx.push(f);
    }
    if closed {
        while q.len() > 1 && q[0].dist(*q.last().unwrap()) < MIN_SPACING_PX {
            q.pop();
            let f = fx.pop().unwrap();
            fx[0] |= f;
        }
        if q.len() < 3 {
            return None;
        }
    } else if q.len() < 2 {
        return None;
    }

    let n = q.len();
    let tol = opt.tolerance.max(1e-3);
    let turning = turning_angles(&q, closed);

    // Breakpoints: corners (local maxima of turning above the angle), fixed points and open ends.
    let support = support_of(&q, closed);
    let mut is_corner = vec![false; n];
    {
        let arc = arc_lengths(&q, closed);
        let total = *arc.last().unwrap();
        for i in 0..n {
            if turning[i] <= opt.corner_angle {
                continue;
            }
            // Non-maximum suppression within one support length either side.
            let mut is_max = true;
            for dir in [1isize, -1] {
                let mut j = i as isize;
                for _ in 1..n {
                    j += dir;
                    if !closed && (j < 0 || j >= n as isize) {
                        break;
                    }
                    let jj = j.rem_euclid(n as isize) as usize;
                    let mut d = (arc[jj] - arc[i]).abs();
                    if closed {
                        d = d.min(total - d);
                    }
                    if d > support {
                        break;
                    }
                    if turning[jj] > turning[i] || (turning[jj] == turning[i] && jj < i) {
                        is_max = false;
                        break;
                    }
                }
            }
            is_corner[i] = is_max;
        }
    }
    let breaking: Vec<bool> = (0..n).map(|i| is_corner[i] || fx[i]).collect();

    // Lay the points out as a sequence s[0..=m] with breakpoints, choosing the
    // starting point of a closed path so it is a breakpoint, or the start of a
    // straight run, or the most curved point.
    let (seq, brk, anchor) = if closed {
        let anchor = match (0..n).find(|&i| breaking[i]) {
            Some(i) => i,
            None => {
                let curved = (0..n)
                    .max_by(|&a, &b| turning[a].partial_cmp(&turning[b]).unwrap())
                    .unwrap_or(0);
                let rotated: Vec<P> = (0..=n).map(|k| q[(curved + k) % n]).collect();
                let runs = find_runs(&rotated, 0, n, tol);
                match runs.first() {
                    Some(r) => (curved + r.0) % n,
                    None => curved,
                }
            }
        };
        let seq: Vec<P> = (0..=n).map(|k| q[(anchor + k) % n]).collect();
        let mut brk: Vec<usize> = (0..=n).filter(|&k| breaking[(anchor + k) % n]).collect();
        if brk.first() != Some(&0) {
            brk.insert(0, 0);
        }
        if brk.last() != Some(&n) {
            brk.push(n);
        }
        (seq, brk, anchor)
    } else {
        let mut brk: Vec<usize> = (0..n)
            .filter(|&i| breaking[i] || i == 0 || i == n - 1)
            .collect();
        brk.dedup();
        (q.clone(), brk, 0)
    };
    let m = seq.len() - 1;
    // A joint at a breakpoint is sharp when that point is a corner or fixed.
    let sharp_at = |k: usize| -> bool {
        if closed {
            breaking[(anchor + k) % n]
        } else {
            k == 0 || k == m || breaking[k]
        }
    };

    // Elements: straight runs and the curves between them.
    let mut elems: Vec<Elem> = Vec::new();
    for w in brk.windows(2) {
        let (a, b) = (w[0], w[1]);
        let runs = find_runs(&seq, a, b, tol);
        let mut cursor = a;
        for (i0, i1, line) in runs {
            if i0 > cursor {
                elems.push(Elem::Curve { i0: cursor, i1: i0 });
            }
            elems.push(Elem::Line {
                i0,
                c: line.0,
                u: line.1,
            });
            cursor = i1;
        }
        if cursor < b {
            elems.push(Elem::Curve { i0: cursor, i1: b });
        }
    }
    if elems.is_empty() {
        return None;
    }
    // A short curve between two lines that meet near it is the chamfer the
    // boundary cuts across a sharp corner: drop it, so the lines meet at
    // their intersection.
    let mut k = 0;
    while k < elems.len() && elems.len() > 2 {
        let ne = elems.len();
        let (prev, next) = if k == 0 {
            if !closed {
                k += 1;
                continue;
            }
            (ne - 1, 1)
        } else if k + 1 == ne {
            if !closed {
                break;
            }
            (k - 1, 0)
        } else {
            (k - 1, k + 1)
        };
        let collapse = match (&elems[prev], &elems[k], &elems[next]) {
            (
                Elem::Line { c: c1, u: u1, .. },
                Elem::Curve { i0, i1 },
                Elem::Line { c: c2, u: u2, .. },
            ) => {
                let span: f64 = (*i0..*i1).map(|i| seq[i].dist(seq[i + 1])).sum();
                let mid = seq[(i0 + i1) / 2];
                span <= 2.5 && intersect(*c1, *u1, *c2, *u2).is_some_and(|x| x.dist(mid) <= 2.0)
            }
            _ => false,
        };
        if collapse {
            // The next line now starts where the curve started.
            let start = elems[k].i0();
            if let Elem::Line { i0, .. } = &mut elems[next] {
                if next != 0 {
                    *i0 = start;
                }
            }
            elems.remove(k);
        } else {
            k += 1;
        }
    }

    // Joints between consecutive elements (and, when closed, between the last and the first).
    let ne = elems.len();
    let joint_count = if closed { ne } else { ne + 1 };
    let mut joints: Vec<Joint> = Vec::with_capacity(joint_count);
    for j in 0..joint_count {
        // Joint j is at the start of element j (or the end of the last for an open path).
        let left = if j == 0 {
            if closed {
                Some(&elems[ne - 1])
            } else {
                None
            }
        } else {
            Some(&elems[j - 1])
        };
        let right = if j < ne { Some(&elems[j]) } else { None };
        let k = match right {
            Some(e) => e.i0(),
            None => m,
        };
        let sharp = brk.contains(&k) && sharp_at(k);
        let idx_pt = seq[k];
        let joint = match (left, right) {
            (Some(Elem::Line { c: c1, u: u1, .. }), Some(Elem::Line { c: c2, u: u2, .. })) => {
                let p = intersect(*c1, *u1, *c2, *u2)
                    .filter(|p| p.dist(idx_pt) <= 3.0 * support.max(1.0))
                    .unwrap_or_else(|| {
                        project(idx_pt, *c1, *u1).lerp(project(idx_pt, *c2, *u2), 0.5)
                    });
                Joint {
                    p,
                    t_in: None,
                    t_out: None,
                }
            }
            (Some(Elem::Line { c, u, .. }), _) => {
                let p = project(idx_pt, *c, *u);
                Joint {
                    p,
                    t_in: None,
                    t_out: if sharp { None } else { Some(*u) },
                }
            }
            (_, Some(Elem::Line { c, u, .. })) => {
                let p = project(idx_pt, *c, *u);
                Joint {
                    p,
                    t_in: if sharp { None } else { Some(*u) },
                    t_out: None,
                }
            }
            _ => {
                let has_both = left.is_some() && right.is_some();
                if sharp || !has_both {
                    Joint {
                        p: idx_pt,
                        t_in: None,
                        t_out: None,
                    }
                } else {
                    let t = centre_tangent(&seq, k, closed, m);
                    Joint {
                        p: idx_pt,
                        t_in: Some(t),
                        t_out: Some(t),
                    }
                }
            }
        };
        joints.push(joint);
    }

    let joint_after = |e: usize| -> &Joint {
        if e + 1 < joints.len() {
            &joints[e + 1]
        } else {
            &joints[0]
        }
    };

    let mut segs: Vec<Seg> = Vec::new();
    for (e, elem) in elems.iter().enumerate() {
        let ja = &joints[e];
        let jb = joint_after(e);
        match elem {
            Elem::Line { .. } => segs.push(Seg::Line(jb.p)),
            Elem::Curve { i0, i1 } => {
                let mut d: Vec<P> = Vec::with_capacity(i1 - i0 + 1);
                d.push(ja.p);
                d.extend_from_slice(&seq[i0 + 1..*i1]);
                d.push(jb.p);
                smooth_interior(&mut d);
                let t1 = ja.t_out.unwrap_or_else(|| start_tangent(&d));
                let t2 = jb
                    .t_in
                    .map(|t| t.scale(-1.0))
                    .unwrap_or_else(|| end_tangent(&d));
                if d.len() == 2 && ja.t_out.is_none() && jb.t_in.is_none() {
                    segs.push(Seg::Line(jb.p));
                } else {
                    let mut out = Vec::new();
                    fit_cubic(&d, t1, t2, tol, &mut out, 0);
                    for [p0, c1, c2, p3] in out {
                        if is_straight(p0, c1, c2, p3, tol) {
                            segs.push(Seg::Line(p3));
                        } else {
                            segs.push(Seg::Cubic(c1, c2, p3));
                        }
                    }
                }
            }
        }
    }
    Some(FitPath {
        start: joints[0].p,
        segs,
        closed,
    })
}

enum Elem {
    Line { i0: usize, c: P, u: P },
    Curve { i0: usize, i1: usize },
}

impl Elem {
    fn i0(&self) -> usize {
        match self {
            Elem::Line { i0, .. } | Elem::Curve { i0, .. } => *i0,
        }
    }
}

struct Joint {
    p: P,
    /// Unit tangent of the path arriving at the joint, when it must be matched.
    t_in: Option<P>,
    /// Unit tangent of the path leaving the joint, when it must be matched.
    t_out: Option<P>,
}

fn arc_lengths(q: &[P], closed: bool) -> Vec<f64> {
    let n = q.len();
    let mut arc = Vec::with_capacity(n + 1);
    arc.push(0.0);
    for i in 1..n {
        arc.push(arc[i - 1] + q[i].dist(q[i - 1]));
    }
    if closed {
        arc.push(arc[n - 1] + q[0].dist(q[n - 1]));
    }
    arc
}

/// The arc length over which turning is measured: 2 to 3 pixels, less on tiny paths.
fn support_of(q: &[P], closed: bool) -> f64 {
    let total = *arc_lengths(q, closed).last().unwrap();
    (total / 8.0).clamp(0.75, 2.5)
}

/// Turning angle (radians) at each point, measured between chords one support length long.
fn turning_angles(q: &[P], closed: bool) -> Vec<f64> {
    let n = q.len();
    let arc = arc_lengths(q, closed);
    let total = *arc.last().unwrap();
    let s = support_of(q, closed);
    let at = |t: f64| -> Option<P> {
        let t = if closed {
            t.rem_euclid(total)
        } else if !(0.0..=total).contains(&t) {
            return None;
        } else {
            t
        };
        // Binary search for the segment containing arc length t.
        let segs = if closed { n } else { n - 1 };
        let (mut lo, mut hi) = (0usize, segs);
        while lo + 1 < hi {
            let mid = (lo + hi) / 2;
            if arc[mid] <= t {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        let a = q[lo];
        let b = q[(lo + 1) % n];
        let len = arc[lo + 1] - arc[lo];
        Some(if len > 0.0 {
            a.lerp(b, (t - arc[lo]) / len)
        } else {
            a
        })
    };
    (0..n)
        .map(|i| match (at(arc[i] - s), at(arc[i] + s)) {
            (Some(a), Some(b)) => {
                let u = q[i].sub(a);
                let v = b.sub(q[i]);
                let c = u.cross(v);
                let d = u.dot(v);
                c.atan2(d).abs()
            }
            _ => 0.0,
        })
        .collect()
}

/// Maximal straight runs within `seq[a..=b]`: (first, last, (point on line, unit direction)).
fn find_runs(seq: &[P], a: usize, b: usize, tol: f64) -> Vec<(usize, usize, (P, P))> {
    let mut arc = Vec::with_capacity(b - a + 1);
    arc.push(0.0);
    for i in a + 1..=b {
        arc.push(arc.last().unwrap() + seq[i].dist(seq[i - 1]));
    }
    let len = |i: usize, j: usize| arc[j - a] - arc[i - a];
    let res_tol = tol.max(0.35);
    let bend_tol = MAX_LINE_BEND_PX.min(tol.max(0.05));
    let fits = |i: usize, j: usize| line_fit(&seq[i..=j], res_tol, bend_tol);

    let mut runs = Vec::new();
    let mut i = a;
    while i < b {
        // The shortest run from i that is long enough.
        let mut j = i + 1;
        while j < b && len(i, j) < MIN_LINE_PX {
            j += 1;
        }
        if len(i, j) < MIN_LINE_PX || fits(i, j).is_none() {
            i += 1;
            continue;
        }
        // Grow by doubling, then binary search for the longest run that fits.
        let mut good = j;
        let mut step = 1usize;
        loop {
            let next = (good + step).min(b);
            if next == good || fits(i, next).is_none() {
                break;
            }
            good = next;
            step *= 2;
        }
        let mut lo = good;
        let mut hi = (good + step).min(b);
        while lo < hi {
            let mid = (lo + hi).div_ceil(2);
            if fits(i, mid).is_some() {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        // Trim points at either end that bend away from the line (the start of
        // a neighbouring curve), then refit.
        let (mut s0, mut s1) = (i, lo);
        loop {
            let (c, u) = fits(s0, s1)
                .unwrap_or_else(|| line_fit(&seq[s0..=s1], f64::MAX, f64::MAX).unwrap());
            let nrm = P::new(-u.y, u.x);
            let r = |k: usize| seq[k].sub(c).dot(nrm).abs();
            let rms = ((s0..=s1).map(|k| r(k) * r(k)).sum::<f64>() / (s1 - s0 + 1) as f64).sqrt();
            let limit = (3.0 * rms).max(0.05);
            let mut trimmed = false;
            if len(s0, s1) > MIN_LINE_PX && r(s0) > limit && s1 - s0 > 2 {
                s0 += 1;
                trimmed = true;
            }
            if len(s0, s1) > MIN_LINE_PX && r(s1) > limit && s1 - s0 > 2 {
                s1 -= 1;
                trimmed = true;
            }
            if !trimmed {
                break;
            }
        }
        let line = line_fit(&seq[s0..=s1], f64::MAX, f64::MAX).unwrap();
        runs.push((s0, s1, line));
        i = lo;
    }
    runs
}

/// The total least squares line through `pts` when they are straight: every
/// point within `res_tol` and no bend above `bend_tol`.
fn line_fit(pts: &[P], res_tol: f64, bend_tol: f64) -> Option<(P, P)> {
    let n = pts.len() as f64;
    if pts.len() < 2 {
        return None;
    }
    let c = pts
        .iter()
        .fold(P::new(0.0, 0.0), |s, p| s.add(*p))
        .scale(1.0 / n);
    let (mut sxx, mut sxy, mut syy) = (0.0, 0.0, 0.0);
    for p in pts {
        let d = p.sub(c);
        sxx += d.x * d.x;
        sxy += d.x * d.y;
        syy += d.y * d.y;
    }
    let angle = 0.5 * (2.0 * sxy).atan2(sxx - syy);
    let mut u = P::new(angle.cos(), angle.sin());
    // Point the direction along the run.
    if pts[pts.len() - 1].sub(pts[0]).dot(u) < 0.0 {
        u = u.scale(-1.0);
    }
    let nrm = P::new(-u.y, u.x);
    // Residuals against position along the line, and the quadratic part of them.
    let (mut s0, mut s1, mut s2, mut s3, mut s4) = (0.0, 0.0, 0.0, 0.0, 0.0);
    let (mut r0, mut r1, mut r2) = (0.0, 0.0, 0.0);
    let (mut smin, mut smax) = (f64::MAX, f64::MIN);
    for p in pts {
        let d = p.sub(c);
        let s = d.dot(u);
        let r = d.dot(nrm);
        if r.abs() > res_tol {
            return None;
        }
        smin = smin.min(s);
        smax = smax.max(s);
        s0 += 1.0;
        s1 += s;
        s2 += s * s;
        s3 += s * s * s;
        s4 += s * s * s * s;
        r0 += r;
        r1 += r * s;
        r2 += r * s * s;
    }
    if pts.len() >= 4 {
        // Solve the normal equations for r = alpha s² + beta s + gamma.
        let m = [[s4, s3, s2], [s3, s2, s1], [s2, s1, s0]];
        let rhs = [r2, r1, r0];
        if let Some(sol) = solve3(m, rhs) {
            let half = 0.5 * (smax - smin);
            if (sol[0] * half * half).abs() > bend_tol {
                return None;
            }
        }
    }
    Some((c, u))
}

fn solve3(m: [[f64; 3]; 3], r: [f64; 3]) -> Option<[f64; 3]> {
    let det = |a: [[f64; 3]; 3]| {
        a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
            - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
            + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
    };
    let d = det(m);
    if d.abs() < 1e-12 {
        return None;
    }
    let mut out = [0.0; 3];
    for (k, o) in out.iter_mut().enumerate() {
        let mut mk = m;
        for row in 0..3 {
            mk[row][k] = r[row];
        }
        *o = det(mk) / d;
    }
    Some(out)
}

fn project(p: P, c: P, u: P) -> P {
    c.add(u.scale(p.sub(c).dot(u)))
}

fn intersect(c1: P, u1: P, c2: P, u2: P) -> Option<P> {
    let den = u1.cross(u2);
    if den.abs() < 0.05 {
        return None;
    }
    let t = c2.sub(c1).cross(u2) / den;
    Some(c1.add(u1.scale(t)))
}

/// Unit tangent through point k of `seq`, from its neighbours about a pixel away.
fn centre_tangent(seq: &[P], k: usize, closed: bool, m: usize) -> P {
    let at = |i: isize| -> P {
        if closed {
            seq[i.rem_euclid(m as isize) as usize]
        } else {
            seq[i.clamp(0, m as isize) as usize]
        }
    };
    let p = seq[k];
    let (mut a, mut b) = (k as isize - 1, k as isize + 1);
    while at(a).dist(p) < 1.5 && (k as isize - a) < m as isize / 2 {
        a -= 1;
    }
    while at(b).dist(p) < 1.5 && (b - k as isize) < m as isize / 2 {
        b += 1;
    }
    at(b).sub(at(a)).unit()
}

/// Smooths the interior points of `d` with a small binomial filter, which
/// removes the interpolation noise of the traced boundary (a few hundredths of
/// a pixel) and moves a curve of radius r inward by about 0.25 / r pixels.
fn smooth_interior(d: &mut [P]) {
    let n = d.len();
    if n < 5 {
        return;
    }
    let src = d.to_vec();
    for i in 1..n - 1 {
        let a = src[i.saturating_sub(2)];
        let b = src[i - 1];
        let c = src[i + 1];
        let e = src[(i + 2).min(n - 1)];
        d[i] = a
            .add(b.scale(4.0))
            .add(src[i].scale(6.0))
            .add(c.scale(4.0))
            .add(e)
            .scale(1.0 / 16.0);
    }
}

/// Unit tangent at the start of `d`, from a point about two pixels along it.
fn start_tangent(d: &[P]) -> P {
    let p0 = d[0];
    let mut i = 1;
    while i + 1 < d.len() && d[i].dist(p0) < 2.0 {
        i += 1;
    }
    d[i].sub(p0).unit()
}

/// Unit tangent at the end of `d`, pointing back along it.
fn end_tangent(d: &[P]) -> P {
    let n = d.len();
    let p = d[n - 1];
    let mut i = n - 2;
    while i > 0 && d[i].dist(p) < 2.0 {
        i -= 1;
    }
    d[i].sub(p).unit()
}

/// A cubic is straight when both control points lie within the tolerance of its chord.
fn is_straight(p0: P, c1: P, c2: P, p3: P, tol: f64) -> bool {
    let t = (0.5 * tol).min(0.1);
    dist_to_segment(c1, p0, p3) <= t && dist_to_segment(c2, p0, p3) <= t
}

fn bez(b: &[P; 4], t: f64) -> P {
    let mt = 1.0 - t;
    b[0].scale(mt * mt * mt)
        .add(b[1].scale(3.0 * mt * mt * t))
        .add(b[2].scale(3.0 * mt * t * t))
        .add(b[3].scale(t * t * t))
}

fn bez_d1(b: &[P; 4], t: f64) -> P {
    let mt = 1.0 - t;
    b[1].sub(b[0])
        .scale(3.0 * mt * mt)
        .add(b[2].sub(b[1]).scale(6.0 * mt * t))
        .add(b[3].sub(b[2]).scale(3.0 * t * t))
}

fn bez_d2(b: &[P; 4], t: f64) -> P {
    let mt = 1.0 - t;
    b[2].sub(b[1].scale(2.0))
        .add(b[0])
        .scale(6.0 * mt)
        .add(b[3].sub(b[2].scale(2.0)).add(b[1]).scale(6.0 * t))
}

/// Schneider's recursive fit of `d` (endpoints included) with unit end
/// tangents `t1` (leaving the start) and `t2` (leaving the end, backwards).
fn fit_cubic(d: &[P], t1: P, t2: P, tol: f64, out: &mut Vec<[P; 4]>, depth: usize) {
    let n = d.len();
    let first = d[0];
    let last = d[n - 1];
    if n == 2 {
        let dist = first.dist(last) / 3.0;
        out.push([
            first,
            first.add(t1.scale(dist)),
            last.add(t2.scale(dist)),
            last,
        ]);
        return;
    }
    let mut u = chord_params(d);
    let mut b = generate(d, &u, t1, t2);
    let (mut err, mut split) = max_error(d, &b, &u);
    if err <= tol {
        out.push(b);
        return;
    }
    if err <= tol * 20.0 {
        for _ in 0..8 {
            u = reparameterise(d, &u, &b);
            b = generate(d, &u, t1, t2);
            let (e, s) = max_error(d, &b, &u);
            err = e;
            split = s;
            if err <= tol {
                out.push(b);
                return;
            }
        }
    }
    if depth > 40 {
        out.push(b);
        return;
    }
    let split = split.clamp(1, n - 2);
    // The tangent at the split, from points about two pixels either side.
    let mut a = split - 1;
    while a > 0 && d[a].dist(d[split]) < 2.0 {
        a -= 1;
    }
    let mut b = split + 1;
    while b + 1 < n && d[b].dist(d[split]) < 2.0 {
        b += 1;
    }
    let tc = d[a].sub(d[b]).unit();
    let tc = if tc.len() == 0.0 { t2 } else { tc };
    fit_cubic(&d[..=split], t1, tc, tol, out, depth + 1);
    fit_cubic(&d[split..], tc.scale(-1.0), t2, tol, out, depth + 1);
}

fn chord_params(d: &[P]) -> Vec<f64> {
    let mut u = Vec::with_capacity(d.len());
    u.push(0.0);
    for i in 1..d.len() {
        u.push(u[i - 1] + d[i].dist(d[i - 1]));
    }
    let total = *u.last().unwrap();
    if total > 0.0 {
        u.iter_mut().for_each(|v| *v /= total);
    }
    u
}

fn generate(d: &[P], u: &[f64], t1: P, t2: P) -> [P; 4] {
    let n = d.len();
    let first = d[0];
    let last = d[n - 1];
    let (mut c00, mut c01, mut c11, mut x0, mut x1) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for i in 0..n {
        let t = u[i];
        let mt = 1.0 - t;
        let b0 = mt * mt * mt;
        let b1 = 3.0 * mt * mt * t;
        let b2 = 3.0 * mt * t * t;
        let b3 = t * t * t;
        let a1 = t1.scale(b1);
        let a2 = t2.scale(b2);
        c00 += a1.dot(a1);
        c01 += a1.dot(a2);
        c11 += a2.dot(a2);
        let tmp = d[i].sub(first.scale(b0 + b1)).sub(last.scale(b2 + b3));
        x0 += a1.dot(tmp);
        x1 += a2.dot(tmp);
    }
    let det = c00 * c11 - c01 * c01;
    let seg = first.dist(last);
    let eps = 1e-6 * seg;
    let (mut al, mut ar) = if det.abs() > 1e-12 {
        ((x0 * c11 - x1 * c01) / det, (c00 * x1 - c01 * x0) / det)
    } else {
        (0.0, 0.0)
    };
    // A handle that is negative, vanishing, or longer than the chord comes from
    // too few points to pin the curve down (it would loop or overshoot): use
    // the standard third of the chord instead.
    let bad = |a: f64| !a.is_finite() || a < eps || a > seg;
    if bad(al) || bad(ar) {
        al = seg / 3.0;
        ar = seg / 3.0;
    }
    [first, first.add(t1.scale(al)), last.add(t2.scale(ar)), last]
}

fn max_error(d: &[P], b: &[P; 4], u: &[f64]) -> (f64, usize) {
    let mut worst = 0.0;
    let mut at = d.len() / 2;
    for i in 1..d.len() - 1 {
        let e = bez(b, u[i]).dist(d[i]);
        if e > worst {
            worst = e;
            at = i;
        }
    }
    (worst, at)
}

fn reparameterise(d: &[P], u: &[f64], b: &[P; 4]) -> Vec<f64> {
    d.iter()
        .zip(u)
        .map(|(p, &t)| {
            let q = bez(b, t).sub(*p);
            let q1 = bez_d1(b, t);
            let q2 = bez_d2(b, t);
            let num = q.dot(q1);
            let den = q1.dot(q1) + q.dot(q2);
            if den.abs() < 1e-12 {
                t
            } else {
                (t - num / den).clamp(0.0, 1.0)
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opt(tol: f64) -> FitOptions {
        FitOptions {
            tolerance: tol,
            corner_angle: 60f64.to_radians(),
        }
    }

    #[test]
    fn square_is_four_lines_with_exact_corners() {
        // A traced square: points along its edges with the corners chamfered.
        let mut pts = Vec::new();
        for i in 0..40 {
            pts.push(P::new(10.5 + i as f64 * 0.5, 10.0));
        }
        for i in 0..40 {
            pts.push(P::new(30.0, 10.5 + i as f64 * 0.5));
        }
        for i in 0..40 {
            pts.push(P::new(29.5 - i as f64 * 0.5, 30.0));
        }
        for i in 0..40 {
            pts.push(P::new(10.0, 29.5 - i as f64 * 0.5));
        }
        let fp = fit_path(&pts, &[], true, &opt(0.5)).unwrap();
        assert_eq!(fp.segs.len(), 4, "{:?}", fp.segs);
        let mut corners = vec![fp.start];
        for s in &fp.segs {
            match s {
                Seg::Line(p) => corners.push(*p),
                Seg::Cubic(..) => panic!("curve in a square"),
            }
        }
        for c in corners {
            assert!(
                (c.x - 10.0).abs() < 1e-9 || (c.x - 30.0).abs() < 1e-9,
                "{c:?}"
            );
            assert!(
                (c.y - 10.0).abs() < 1e-9 || (c.y - 30.0).abs() < 1e-9,
                "{c:?}"
            );
        }
    }

    #[test]
    fn circle_is_a_few_smooth_curves() {
        let r = 40.0;
        let pts: Vec<P> = (0..400)
            .map(|i| {
                let a = i as f64 / 400.0 * std::f64::consts::TAU;
                P::new(50.0 + r * a.cos(), 50.0 + r * a.sin())
            })
            .collect();
        let fp = fit_path(&pts, &[], true, &opt(0.1)).unwrap();
        assert!(fp.segs.len() <= 8, "{} segments", fp.segs.len());
        assert!(fp.segs.iter().all(|s| matches!(s, Seg::Cubic(..))));
    }
}
