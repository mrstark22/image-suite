//! Centreline tracing (#27): thinning, a graph of the skeleton, and centred chains.
//!
//! 1. **Thinning.** Zhang-Suen thinning of the stroke's pixels, on a grid
//!    padded with background, so a stroke that touches the image edge is
//!    thinned like any other. Staircase pixels are then removed, leaving a
//!    skeleton in which every pixel along a branch has exactly two neighbours.
//! 2. **Graph.** Pixels with one neighbour are ends; touching pixels with
//!    three or more are merged into one junction. Branches run between them;
//!    a branch with no end or junction is a closed loop.
//! 3. **Pruning.** A branch from an end to a junction that is shorter than the
//!    stroke is wide there is a spur of thinning, not part of the drawing, and
//!    is removed.
//! 4. **Joining.** At each junction the branches that continue most nearly
//!    straight are joined into one path; the others end exactly on the
//!    junction point, which the joined path passes through, so nothing is left
//!    with a gap. Branches meeting at a junction left with two are joined.
//! 5. **Centring.** Each point is moved to the midpoint of the two places
//!    where the line across the stroke at that point crosses its anti-aliased
//!    boundary, which puts the path on the true centre to a fraction of a
//!    pixel. Ends are extended to half the stroke width short of the stroke's
//!    end, or to the image edge when the stroke runs off the image.

use super::contour::Field;
use super::geom::P;
use std::collections::{HashMap, HashSet};

/// Thins `mask` (true for stroke pixels) in place to a one-pixel skeleton,
/// only within `bbox` = (x0, y0, x1, y1) inclusive.
///
/// Only a pixel on the border of the shape can be removed, so each pass looks
/// at the current border alone: the border pixels kept from the last pass and
/// the neighbours of the pixels it removed. The work is proportional to the
/// pixels removed, not to the area times the number of passes (a solid
/// 2048 px square took 41.6 s when every pass rescanned the box; #27, review
/// of #84).
pub fn thin(mask: &mut [bool], w: usize, h: usize, bbox: (usize, usize, usize, usize)) {
    let (x0, y0, x1, y1) = bbox;
    if x0 > x1 || y0 > y1 {
        return;
    }
    let get = |m: &[bool], x: isize, y: isize| -> bool {
        x >= 0 && y >= 0 && (x as usize) < w && (y as usize) < h && m[y as usize * w + x as usize]
    };
    let ring = |m: &[bool], i: usize| -> [bool; 8] {
        let (xi, yi) = ((i % w) as isize, (i / w) as isize);
        // P2..P9 clockwise from north.
        [
            get(m, xi, yi - 1),
            get(m, xi + 1, yi - 1),
            get(m, xi + 1, yi),
            get(m, xi + 1, yi + 1),
            get(m, xi, yi + 1),
            get(m, xi - 1, yi + 1),
            get(m, xi - 1, yi),
            get(m, xi - 1, yi - 1),
        ]
    };
    let in_box = |i: usize| {
        let (x, y) = (i % w, i / w);
        x >= x0 && x <= x1 && y >= y0 && y <= y1
    };
    // The border: pixels of the shape with a background pixel among their 8 neighbours.
    let mut listed = vec![false; w * h];
    let mut border: Vec<usize> = Vec::new();
    for y in y0..=y1 {
        for x in x0..=x1 {
            let i = y * w + x;
            if mask[i] && ring(mask, i).iter().any(|&v| !v) {
                listed[i] = true;
                border.push(i);
            }
        }
    }
    let mut to_clear: Vec<usize> = Vec::new();
    let mut quiet_passes = 0;
    let mut pass = 0usize;
    while quiet_passes < 2 {
        to_clear.clear();
        for &i in &border {
            let n = ring(mask, i);
            let b = n.iter().filter(|&&v| v).count();
            if !(2..=6).contains(&b) {
                continue;
            }
            let a = (0..8).filter(|&k| !n[k] && n[(k + 1) % 8]).count();
            if a != 1 {
                continue;
            }
            let (p2, p4, p6, p8) = (n[0], n[2], n[4], n[6]);
            let ok = if pass % 2 == 0 {
                !(p2 && p4 && p6) && !(p4 && p6 && p8)
            } else {
                !(p2 && p4 && p8) && !(p2 && p6 && p8)
            };
            if ok {
                to_clear.push(i);
            }
        }
        if to_clear.is_empty() {
            quiet_passes += 1;
        } else {
            quiet_passes = 0;
            for &i in &to_clear {
                mask[i] = false;
            }
            // The next border: what is left of this one, and the shape pixels next to what was removed.
            let mut next: Vec<usize> = Vec::with_capacity(border.len() + to_clear.len());
            for &i in &border {
                listed[i] = false;
            }
            for &i in &border {
                if mask[i] && !listed[i] {
                    listed[i] = true;
                    next.push(i);
                }
            }
            for &i in &to_clear {
                for (dx, dy) in RING {
                    let (nx, ny) = ((i % w) as isize + dx, (i / w) as isize + dy);
                    if nx < 0 || ny < 0 || nx as usize >= w || ny as usize >= h {
                        continue;
                    }
                    let j = ny as usize * w + nx as usize;
                    if mask[j] && !listed[j] && in_box(j) {
                        listed[j] = true;
                        next.push(j);
                    }
                }
            }
            border = next;
        }
        pass += 1;
    }
}

const RING: [(isize, isize); 8] = [
    (0, -1),
    (1, -1),
    (1, 0),
    (1, 1),
    (0, 1),
    (-1, 1),
    (-1, 0),
    (-1, -1),
];

/// A traced centreline: points in pixel-edge coordinates, which of them must
/// be kept exactly (junctions), and whether it is a closed loop.
pub struct Chain {
    pub pts: Vec<P>,
    pub fixed: Vec<bool>,
    pub closed: bool,
    /// Widths of the stroke measured across it, from its anti-aliased edges.
    pub widths: Vec<f64>,
}

struct Edge {
    a: usize,
    b: usize,
    pix: Vec<usize>,
    alive: bool,
}

/// Builds the centred chains of one stroke from its skeleton pixels `skel`
/// (indices into the image). `sk` marks skeleton pixels over the whole image
/// and is updated as staircase pixels are removed; `dt` is the distance
/// transform of the stroke and `field` its anti-aliased field.
pub fn chains_of(
    skel: &[usize],
    sk: &mut [bool],
    w: usize,
    h: usize,
    dt: &[f32],
    field: &Field,
) -> Vec<Chain> {
    let nb = |sk: &[bool], i: usize| -> Vec<usize> {
        let (x, y) = ((i % w) as isize, (i / w) as isize);
        RING.iter()
            .filter_map(|(dx, dy)| {
                let (nx, ny) = (x + dx, y + dy);
                if nx >= 0
                    && ny >= 0
                    && (nx as usize) < w
                    && (ny as usize) < h
                    && sk[ny as usize * w + nx as usize]
                {
                    Some(ny as usize * w + nx as usize)
                } else {
                    None
                }
            })
            .collect()
    };

    // Remove staircase pixels: a pixel with two 4-neighbours at a right angle
    // whose removal leaves its neighbours connected.
    let mut pixels: Vec<usize> = skel.to_vec();
    for &i in skel {
        let (x, y) = ((i % w) as isize, (i / w) as isize);
        let on: Vec<bool> = RING
            .iter()
            .map(|(dx, dy)| {
                let (nx, ny) = (x + dx, y + dy);
                nx >= 0
                    && ny >= 0
                    && (nx as usize) < w
                    && (ny as usize) < h
                    && sk[ny as usize * w + nx as usize]
            })
            .collect();
        let count = on.iter().filter(|&&v| v).count();
        if count < 2 {
            continue;
        }
        let right_angle = (0..4).any(|k| on[2 * k] && on[(2 * k + 2) % 8]);
        if right_angle && ring_components(&on) == 1 {
            sk[i] = false;
        }
    }
    pixels.retain(|&i| sk[i]);
    if pixels.is_empty() {
        return Vec::new();
    }

    let degree: HashMap<usize, usize> = pixels.iter().map(|&i| (i, nb(sk, i).len())).collect();
    // Nodes: ends, and clusters of touching junction pixels.
    let mut node_of: HashMap<usize, usize> = HashMap::new();
    let mut node_pix: Vec<Vec<usize>> = Vec::new();
    for &i in &pixels {
        let d = degree[&i];
        if d == 2 || node_of.contains_key(&i) {
            continue;
        }
        let id = node_pix.len();
        if d >= 3 {
            let mut stack = vec![i];
            let mut members = Vec::new();
            node_of.insert(i, id);
            while let Some(p) = stack.pop() {
                members.push(p);
                for q in nb(sk, p) {
                    if degree[&q] >= 3 && !node_of.contains_key(&q) {
                        node_of.insert(q, id);
                        stack.push(q);
                    }
                }
            }
            node_pix.push(members);
        } else {
            node_of.insert(i, id);
            node_pix.push(vec![i]);
        }
    }
    let centre = |i: usize| P::new((i % w) as f64 + 0.5, (i / w) as f64 + 0.5);
    let node_pos: Vec<P> = node_pix
        .iter()
        .map(|m| {
            m.iter()
                .fold(P::new(0.0, 0.0), |s, &i| s.add(centre(i)))
                .scale(1.0 / m.len() as f64)
        })
        .collect();

    // Branches between nodes.
    let mut edges: Vec<Edge> = Vec::new();
    let mut visited: HashSet<usize> = HashSet::new();
    let mut direct: HashSet<(usize, usize)> = HashSet::new();
    for (id, members) in node_pix.iter().enumerate() {
        for &start in members {
            for first in nb(sk, start) {
                if node_of.get(&first) == Some(&id) {
                    continue;
                }
                if let Some(&other) = node_of.get(&first) {
                    // Two nodes touching directly.
                    let key = (start.min(first), start.max(first));
                    if direct.insert(key) {
                        edges.push(Edge {
                            a: id,
                            b: other,
                            pix: vec![start, first],
                            alive: true,
                        });
                    }
                    continue;
                }
                if visited.contains(&first) {
                    continue;
                }
                let mut pix = vec![start, first];
                visited.insert(first);
                let mut prev = start;
                let mut cur = first;
                let end_node;
                loop {
                    let next = nb(sk, cur)
                        .into_iter()
                        .filter(|&q| {
                            q != prev
                                && !(node_of.get(&q) == Some(&id) && pix.len() == 2 && q == start)
                        })
                        .find(|&q| !visited.contains(&q) || node_of.contains_key(&q));
                    match next {
                        None => {
                            end_node = None;
                            break;
                        }
                        Some(q) => {
                            pix.push(q);
                            if let Some(&n) = node_of.get(&q) {
                                end_node = Some(n);
                                break;
                            }
                            visited.insert(q);
                            prev = cur;
                            cur = q;
                        }
                    }
                }
                if let Some(b) = end_node {
                    edges.push(Edge {
                        a: id,
                        b,
                        pix,
                        alive: true,
                    });
                }
            }
        }
    }

    // Pure loops: branch pixels not reached from any node.
    let mut loops: Vec<Vec<usize>> = Vec::new();
    for &i in &pixels {
        if node_of.contains_key(&i) || visited.contains(&i) {
            continue;
        }
        let mut cyc = vec![i];
        visited.insert(i);
        let mut prev = usize::MAX;
        let mut cur = i;
        loop {
            let next = nb(sk, cur)
                .into_iter()
                .find(|&q| q != prev && !visited.contains(&q));
            match next {
                Some(q) => {
                    visited.insert(q);
                    cyc.push(q);
                    prev = cur;
                    cur = q;
                }
                None => break,
            }
        }
        if cyc.len() >= 3 {
            loops.push(cyc);
        }
    }

    // Prune spurs: end-to-junction branches shorter than the stroke is wide at the junction.
    let width_at = |i: usize| (2.0 * dt[i] as f64 - 1.0).max(1.0);
    for _ in 0..3 {
        let mut deg = vec![0usize; node_pix.len()];
        for e in edges.iter().filter(|e| e.alive) {
            deg[e.a] += 1;
            deg[e.b] += 1;
        }
        let mut pruned = false;
        for e in edges.iter_mut().filter(|e| e.alive) {
            let junction = if deg[e.a] == 1 && deg[e.b] >= 3 {
                e.b
            } else if deg[e.b] == 1 && deg[e.a] >= 3 {
                e.a
            } else {
                continue;
            };
            let wj = node_pix[junction]
                .iter()
                .map(|&i| width_at(i))
                .fold(1.0, f64::max);
            let len = e.pix.len() as f64;
            if len <= wj.max(3.0) {
                e.alive = false;
                deg[e.a] -= 1;
                deg[e.b] -= 1;
                pruned = true;
            }
        }
        if !pruned {
            break;
        }
    }
    let edges: Vec<Edge> = edges.into_iter().filter(|e| e.alive).collect();
    let mut deg = vec![0usize; node_pix.len()];
    for e in &edges {
        deg[e.a] += 1;
        deg[e.b] += 1;
    }

    // Points of each branch, from node a to node b, with the node positions at its ends.
    let edge_pts: Vec<Vec<P>> = edges
        .iter()
        .map(|e| {
            let mut pts: Vec<P> = e.pix.iter().map(|&i| centre(i)).collect();
            // The ends sit on the node positions (a junction's centre).
            let n = pts.len();
            pts[0] = node_pos[e.a];
            pts[n - 1] = node_pos[e.b];
            pts
        })
        .collect();

    // Pair branches at each node: slot = (edge, end) with end 0 at a, 1 at b.
    let mut link: HashMap<(usize, usize), (usize, usize)> = HashMap::new();
    let mut slots_at: Vec<Vec<(usize, usize)>> = vec![Vec::new(); node_pix.len()];
    for (k, e) in edges.iter().enumerate() {
        slots_at[e.a].push((k, 0));
        slots_at[e.b].push((k, 1));
    }
    let leaving = |slot: (usize, usize)| -> P {
        let pts = &edge_pts[slot.0];
        let seq: Vec<P> = if slot.1 == 0 {
            pts.clone()
        } else {
            pts.iter().rev().copied().collect()
        };
        let o = seq[0];
        let reach = 4.0;
        let mut i = 1;
        while i + 1 < seq.len() && seq[i].dist(o) < reach {
            i += 1;
        }
        seq[i].sub(o).unit()
    };
    for slots in slots_at.iter() {
        if slots.len() == 2 {
            // Two branches meet (or one returns to its start): join them.
            link.insert(slots[0], slots[1]);
            link.insert(slots[1], slots[0]);
        } else if slots.len() >= 3 {
            let dirs: Vec<P> = slots.iter().map(|&s| leaving(s)).collect();
            let mut pairs: Vec<(f64, usize, usize)> = Vec::new();
            for i in 0..slots.len() {
                for j in i + 1..slots.len() {
                    // Deviation from going straight through: angle between d_i and -d_j.
                    let c = (-dirs[i].dot(dirs[j])).clamp(-1.0, 1.0);
                    pairs.push((c.acos(), i, j));
                }
            }
            pairs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
            let mut used = vec![false; slots.len()];
            for (dev, i, j) in pairs {
                if dev > 50f64.to_radians() || used[i] || used[j] {
                    continue;
                }
                used[i] = true;
                used[j] = true;
                link.insert(slots[i], slots[j]);
                link.insert(slots[j], slots[i]);
            }
        }
    }
    let is_junction = |node: usize| deg[node] >= 3;

    // Walk chains through the links.
    let mut done = vec![false; edges.len()];
    let mut chains: Vec<Chain> = Vec::new();
    let walk = |start: (usize, usize), done: &mut Vec<bool>| -> Chain {
        let mut pts: Vec<P> = Vec::new();
        let mut fixed: Vec<bool> = Vec::new();
        let mut slot = start;
        let mut closed = false;
        loop {
            let (k, end) = slot;
            done[k] = true;
            let seq: Vec<P> = if end == 0 {
                edge_pts[k].clone()
            } else {
                edge_pts[k].iter().rev().copied().collect()
            };
            let (from, to) = if end == 0 {
                (edges[k].a, edges[k].b)
            } else {
                (edges[k].b, edges[k].a)
            };
            if pts.is_empty() {
                pts.push(seq[0]);
                fixed.push(is_junction(from));
            }
            for p in &seq[1..] {
                pts.push(*p);
                fixed.push(false);
            }
            *fixed.last_mut().unwrap() = is_junction(to);
            let arrive = (k, 1 - end);
            match link.get(&arrive) {
                Some(&next) if !done[next.0] => slot = next,
                Some(&next) if next == start => {
                    closed = true;
                    break;
                }
                _ => break,
            }
        }
        if closed {
            pts.pop();
            fixed.pop();
        }
        Chain {
            pts,
            fixed,
            closed,
            widths: Vec::new(),
        }
    };
    for (k, _) in edges.iter().enumerate() {
        for end in 0..2 {
            if done[k] {
                break;
            }
            if !link.contains_key(&(k, end)) {
                chains.push(walk((k, end), &mut done));
            }
        }
    }
    for k in 0..edges.len() {
        if !done[k] {
            chains.push(walk((k, 0), &mut done));
        }
    }
    for cyc in loops {
        let pts: Vec<P> = cyc.iter().map(|&i| centre(i)).collect();
        let n = pts.len();
        chains.push(Chain {
            pts,
            fixed: vec![false; n],
            closed: true,
            widths: Vec::new(),
        });
    }

    // Centre each point across the stroke, and extend the ends.
    for ch in chains.iter_mut() {
        centre_chain(ch, w, h, dt, field);
    }
    place_junctions(&mut chains, w, h, dt);
    chains.retain(|c| c.pts.len() >= 2);
    chains
}

/// Moves each junction to where the centred branches meeting there cross: the
/// point nearest, in least squares, to the lines through the branches just
/// outside it. The thinned junction's own pixels are not centred, so left
/// alone a straight bar would dip towards a stem joining it (review of #84).
/// Every chain that passes through or ends at the junction gets the same point.
fn place_junctions(chains: &mut [Chain], w: usize, h: usize, dt: &[f32]) {
    let mut groups: HashMap<(u64, u64), Vec<(usize, usize)>> = HashMap::new();
    for (ci, ch) in chains.iter().enumerate() {
        for (pi, &f) in ch.fixed.iter().enumerate() {
            if f {
                let p = ch.pts[pi];
                groups
                    .entry((p.x.to_bits(), p.y.to_bits()))
                    .or_default()
                    .push((ci, pi));
            }
        }
    }
    for members in groups.values() {
        let (ci0, pi0) = members[0];
        let j = chains[ci0].pts[pi0];
        let x = (j.x.floor() as isize).clamp(0, w as isize - 1) as usize;
        let y = (j.y.floor() as isize).clamp(0, h as isize - 1) as usize;
        let hw = (dt[y * w + x] as f64).max(1.0);
        // Points of a branch between these distances from the junction describe its line.
        let (near, far) = (hw + 0.5, 2.0 * hw + 4.0);
        let (mut a11, mut a12, mut a22, mut b1, mut b2) = (0.0, 0.0, 0.0, 0.0, 0.0);
        let mut lines = 0;
        for &(ci, pi) in members {
            let ch = &chains[ci];
            let n = ch.pts.len() as isize;
            for dir in [-1isize, 1] {
                let mut pts: Vec<P> = Vec::new();
                let mut k = pi as isize + dir;
                for _ in 0..n {
                    let idx = if ch.closed {
                        k.rem_euclid(n)
                    } else if k < 0 || k >= n {
                        break;
                    } else {
                        k
                    } as usize;
                    if idx == pi {
                        break;
                    }
                    let d = ch.pts[idx].dist(j);
                    if d > far {
                        break;
                    }
                    if d >= near {
                        pts.push(ch.pts[idx]);
                    }
                    k += dir;
                }
                if pts.len() < 2 {
                    continue;
                }
                // Total least squares line through the points.
                let c = pts
                    .iter()
                    .fold(P::new(0.0, 0.0), |s, p| s.add(*p))
                    .scale(1.0 / pts.len() as f64);
                let (mut sxx, mut sxy, mut syy) = (0.0, 0.0, 0.0);
                for p in &pts {
                    let d = p.sub(c);
                    sxx += d.x * d.x;
                    sxy += d.x * d.y;
                    syy += d.y * d.y;
                }
                let angle = 0.5 * (2.0 * sxy).atan2(sxx - syy);
                let nrm = P::new(-angle.sin(), angle.cos());
                let proj = nrm.dot(c);
                a11 += nrm.x * nrm.x;
                a12 += nrm.x * nrm.y;
                a22 += nrm.y * nrm.y;
                b1 += nrm.x * proj;
                b2 += nrm.y * proj;
                lines += 1;
            }
        }
        let det = a11 * a22 - a12 * a12;
        if lines < 2 || det.abs() < 1e-3 {
            continue;
        }
        let p = P::new((a22 * b1 - a12 * b2) / det, (a11 * b2 - a12 * b1) / det);
        if p.dist(j) > hw + 1.0 {
            continue;
        }
        for &(ci, pi) in members {
            chains[ci].pts[pi] = p;
        }
    }
}

/// Number of 8-connected groups among the set pixels of a 3x3 ring.
fn ring_components(on: &[bool]) -> usize {
    let mut seen = [false; 8];
    let mut count = 0;
    for s in 0..8 {
        if !on[s] || seen[s] {
            continue;
        }
        count += 1;
        let mut stack = vec![s];
        seen[s] = true;
        while let Some(i) = stack.pop() {
            for j in 0..8 {
                if on[j] && !seen[j] {
                    let (ax, ay) = RING[i];
                    let (bx, by) = RING[j];
                    if (ax - bx).abs() <= 1 && (ay - by).abs() <= 1 {
                        seen[j] = true;
                        stack.push(j);
                    }
                }
            }
        }
    }
    count
}

/// Distance from `p` along `dir` to where the field first drops to zero or below, within `max`.
fn crossing(field: &Field, p: P, dir: P, max: f64) -> Option<f64> {
    let step = 0.25;
    let mut prev = field.sample(p);
    if prev <= 0.0 {
        return None;
    }
    let mut t = 0.0;
    while t < max {
        let t2 = t + step;
        let v = field.sample(p.add(dir.scale(t2)));
        if v <= 0.0 {
            return Some(t + step * prev / (prev - v));
        }
        prev = v;
        t = t2;
    }
    None
}

fn centre_chain(ch: &mut Chain, w: usize, h: usize, dt: &[f32], field: &Field) {
    let n = ch.pts.len();
    if n < 2 {
        return;
    }
    let half_width_near = |p: P| -> f64 {
        let x = (p.x.floor() as isize).clamp(0, w as isize - 1) as usize;
        let y = (p.y.floor() as isize).clamp(0, h as isize - 1) as usize;
        (dt[y * w + x] as f64 - 0.5).max(0.5)
    };
    let orig = ch.pts.clone();
    let at = |i: isize| -> P {
        if ch.closed {
            orig[i.rem_euclid(n as isize) as usize]
        } else {
            orig[i.clamp(0, n as isize - 1) as usize]
        }
    };
    for i in 0..n {
        if ch.fixed[i] {
            continue;
        }
        let t = at(i as isize + 2).sub(at(i as isize - 2)).unit();
        if t.len() == 0.0 {
            continue;
        }
        let nrm = P::new(-t.y, t.x);
        let p = orig[i];
        let hw = half_width_near(p);
        let max = 2.0 * hw + 2.0;
        if let (Some(a), Some(b)) = (
            crossing(field, p, nrm, max),
            crossing(field, p, nrm.scale(-1.0), max),
        ) {
            // Reject crossings that run into another branch: both sides should be near the half width.
            if (a - b).abs() <= hw + 1.0 && a + b <= 2.0 * (2.0 * hw + 1.5) {
                ch.pts[i] = p.add(nrm.scale(0.5 * (a - b)));
                ch.widths.push(a + b);
            }
        }
    }
    if ch.closed {
        return;
    }
    // Extend the free ends along their tangents.
    for end in [0usize, 1] {
        let (i, j) = if end == 0 {
            (0, (n - 1).min(3))
        } else {
            (n - 1, n.saturating_sub(4))
        };
        if ch.fixed[i] {
            continue;
        }
        let p = ch.pts[i];
        let dir = p.sub(ch.pts[j]).unit();
        if dir.len() == 0.0 {
            continue;
        }
        let hw = half_width_near(p);
        if let Some(d) = crossing(field, p, dir, 4.0 * hw + 4.0) {
            let tip = p.add(dir.scale(d));
            let at_border =
                tip.x <= 0.5 || tip.y <= 0.5 || tip.x >= w as f64 - 0.5 || tip.y >= h as f64 - 0.5;
            let reach = if at_border {
                d
            } else {
                (d - hw - 0.5).max(0.0)
            };
            ch.pts[i] = p.add(dir.scale(reach));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Plain Zhang-Suen, rescanning every pixel on every pass: the reference.
    fn thin_reference(mask: &mut [bool], w: usize, h: usize) {
        let get = |m: &[bool], x: isize, y: isize| -> bool {
            x >= 0
                && y >= 0
                && (x as usize) < w
                && (y as usize) < h
                && m[y as usize * w + x as usize]
        };
        loop {
            let mut changed = false;
            for pass in 0..2 {
                let mut clear = Vec::new();
                for y in 0..h as isize {
                    for x in 0..w as isize {
                        if !get(mask, x, y) {
                            continue;
                        }
                        let n = [
                            get(mask, x, y - 1),
                            get(mask, x + 1, y - 1),
                            get(mask, x + 1, y),
                            get(mask, x + 1, y + 1),
                            get(mask, x, y + 1),
                            get(mask, x - 1, y + 1),
                            get(mask, x - 1, y),
                            get(mask, x - 1, y - 1),
                        ];
                        let b = n.iter().filter(|&&v| v).count();
                        let a = (0..8).filter(|&k| !n[k] && n[(k + 1) % 8]).count();
                        let ok = if pass == 0 {
                            !(n[0] && n[2] && n[4]) && !(n[2] && n[4] && n[6])
                        } else {
                            !(n[0] && n[2] && n[6]) && !(n[0] && n[4] && n[6])
                        };
                        if (2..=6).contains(&b) && a == 1 && ok {
                            clear.push(y as usize * w + x as usize);
                        }
                    }
                }
                changed |= !clear.is_empty();
                for i in clear {
                    mask[i] = false;
                }
            }
            if !changed {
                break;
            }
        }
    }

    #[test]
    fn border_thinning_matches_plain_zhang_suen() {
        let mut seed = 12345u64;
        let mut rnd = || {
            seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (seed >> 33) as usize
        };
        for _ in 0..40 {
            let (w, h) = (20 + rnd() % 40, 20 + rnd() % 40);
            let mut mask = vec![false; w * h];
            // A few overlapping rectangles and discs.
            for _ in 0..1 + rnd() % 5 {
                let (cx, cy, r) = (rnd() % w, rnd() % h, 2 + rnd() % 10);
                let disc = rnd() % 2 == 0;
                for y in 0..h {
                    for x in 0..w {
                        let (dx, dy) = (x as isize - cx as isize, y as isize - cy as isize);
                        let inside = if disc {
                            dx * dx + dy * dy <= (r * r) as isize
                        } else {
                            dx.abs() <= r as isize && dy.abs() <= (r / 2) as isize
                        };
                        if inside {
                            mask[y * w + x] = true;
                        }
                    }
                }
            }
            let mut expected = mask.clone();
            thin_reference(&mut expected, w, h);
            thin(&mut mask, w, h, (0, 0, w - 1, h - 1));
            assert_eq!(mask, expected);
        }
    }
}
