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
pub fn thin(mask: &mut [bool], w: usize, h: usize, bbox: (usize, usize, usize, usize)) {
    let (x0, y0, x1, y1) = bbox;
    let get = |m: &[bool], x: isize, y: isize| -> bool {
        x >= 0 && y >= 0 && (x as usize) < w && (y as usize) < h && m[y as usize * w + x as usize]
    };
    let mut to_clear: Vec<usize> = Vec::new();
    loop {
        let mut changed = false;
        for pass in 0..2 {
            to_clear.clear();
            for y in y0..=y1 {
                for x in x0..=x1 {
                    if !mask[y * w + x] {
                        continue;
                    }
                    let (xi, yi) = (x as isize, y as isize);
                    // P2..P9 clockwise from north.
                    let n = [
                        get(mask, xi, yi - 1),
                        get(mask, xi + 1, yi - 1),
                        get(mask, xi + 1, yi),
                        get(mask, xi + 1, yi + 1),
                        get(mask, xi, yi + 1),
                        get(mask, xi - 1, yi + 1),
                        get(mask, xi - 1, yi),
                        get(mask, xi - 1, yi - 1),
                    ];
                    let b = n.iter().filter(|&&v| v).count();
                    if !(2..=6).contains(&b) {
                        continue;
                    }
                    let a = (0..8).filter(|&i| !n[i] && n[(i + 1) % 8]).count();
                    if a != 1 {
                        continue;
                    }
                    let (p2, p4, p6, p8) = (n[0], n[2], n[4], n[6]);
                    let ok = if pass == 0 {
                        !(p2 && p4 && p6) && !(p4 && p6 && p8)
                    } else {
                        !(p2 && p4 && p8) && !(p2 && p6 && p8)
                    };
                    if ok {
                        to_clear.push(y * w + x);
                    }
                }
            }
            if !to_clear.is_empty() {
                changed = true;
                for &i in &to_clear {
                    mask[i] = false;
                }
            }
        }
        if !changed {
            break;
        }
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
    chains.retain(|c| c.pts.len() >= 2);
    chains
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
