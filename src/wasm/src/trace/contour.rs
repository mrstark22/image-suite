//! Sub-pixel boundary extraction by marching squares (#24).
//!
//! The input is a scalar field sampled at pixel centres, positive inside a
//! shape and negative outside. The boundary is the zero level of the field,
//! found on every cell edge by linear interpolation between the two pixel
//! centres, so an anti-aliased edge is placed where its grey level crosses the
//! threshold rather than on the pixel grid.
//!
//! Coordinates are image pixels on the pixel-edge grid: pixel (x, y) covers
//! the square from (x, y) to (x + 1, y + 1), so its centre is (x + 0.5, y + 0.5).
//!
//! Outside the image the field is continued with the negated magnitude of the
//! nearest pixel, so a shape touching the border is closed exactly along the
//! image edge. A cell whose diagonal corners are inside (a saddle) joins them
//! when the mean of its four corners is inside, so a one-pixel diagonal line
//! stays one connected shape.

use super::geom::P;
use std::collections::HashMap;

/// A scalar field on the pixel grid; a pixel is inside when its value is above zero.
pub struct Field<'a> {
    pub w: usize,
    pub h: usize,
    pub v: &'a [f32],
}

impl Field<'_> {
    /// The value at pixel centre (x, y), continued outside the image.
    #[inline]
    pub fn at(&self, x: isize, y: isize) -> f32 {
        let inside_image = x >= 0 && y >= 0 && (x as usize) < self.w && (y as usize) < self.h;
        let cx = x.clamp(0, self.w as isize - 1) as usize;
        let cy = y.clamp(0, self.h as isize - 1) as usize;
        let v = self.v[cy * self.w + cx];
        if inside_image {
            v
        } else if v > 0.0 {
            -v
        } else {
            v.min(-1e-6)
        }
    }
}

impl Field<'_> {
    /// The field at any point (in pixel-edge coordinates), interpolated bilinearly between pixel centres.
    pub fn sample(&self, p: P) -> f64 {
        let fx = p.x - 0.5;
        let fy = p.y - 0.5;
        let x0 = fx.floor();
        let y0 = fy.floor();
        let tx = fx - x0;
        let ty = fy - y0;
        let (x0, y0) = (x0 as isize, y0 as isize);
        let a = self.at(x0, y0) as f64;
        let b = self.at(x0 + 1, y0) as f64;
        let c = self.at(x0, y0 + 1) as f64;
        let d = self.at(x0 + 1, y0 + 1) as f64;
        (a * (1.0 - tx) + b * tx) * (1.0 - ty) + (c * (1.0 - tx) + d * tx) * ty
    }
}

#[inline]
fn is_in(v: f32) -> bool {
    v > 0.0
}

/// A closed boundary loop. The inside of the shape is on the right of the
/// direction of travel (on screen, y down), so outer boundaries run clockwise
/// and holes counter-clockwise.
pub struct Loop {
    pub pts: Vec<P>,
}

/// Extracts every boundary loop of `field`, in raster order of their first edge.
pub fn marching_squares(field: &Field) -> Vec<Loop> {
    let w = field.w as isize;
    let h = field.h as isize;
    let nw = (field.w + 2) as u64; // nodes per row, x from -1 to w
    let node = |x: isize, y: isize| -> u64 { (y + 1) as u64 * nw + (x + 1) as u64 };
    // Edge keys: horizontal edge from node (x, y) to (x + 1, y), vertical from (x, y) to (x, y + 1).
    let hkey = |x: isize, y: isize| node(x, y) * 2;
    let vkey = |x: isize, y: isize| node(x, y) * 2 + 1;

    // Count the boundary segments first and reserve for them, so a noisy image
    // with millions of crossings is reported as too large rather than running
    // out of memory part way (review of #84).
    let mut segments = 0usize;
    for cy in -1..h {
        for cx in -1..w {
            let (a, b) = (is_in(field.at(cx, cy)), is_in(field.at(cx + 1, cy)));
            let (c, d) = (is_in(field.at(cx + 1, cy + 1)), is_in(field.at(cx, cy + 1)));
            let ins = a as usize + b as usize + c as usize + d as usize;
            segments += match ins {
                0 | 4 => 0,
                2 if a == c => 2,
                _ => 1,
            };
        }
    }
    let mut next: HashMap<u64, u64> = HashMap::new();
    let mut starts: Vec<u64> = Vec::new();
    // Each segment also becomes a loop point of 16 bytes.
    let mut points: Vec<P> = Vec::new();
    if next.try_reserve(segments).is_err()
        || starts.try_reserve_exact(segments).is_err()
        || points.try_reserve_exact(segments).is_err()
    {
        super::OUT_OF_MEMORY.store(true, std::sync::atomic::Ordering::Relaxed);
        return Vec::new();
    }
    drop(points);

    for cy in -1..h {
        for cx in -1..w {
            let a = field.at(cx, cy); // top left
            let b = field.at(cx + 1, cy); // top right
            let c = field.at(cx + 1, cy + 1); // bottom right
            let d = field.at(cx, cy + 1); // bottom left
            let (ia, ib, ic, id) = (is_in(a), is_in(b), is_in(c), is_in(d));
            let case = (ia as u8) | (ib as u8) << 1 | (ic as u8) << 2 | (id as u8) << 3;
            if case == 0 || case == 15 {
                continue;
            }
            let top = hkey(cx, cy);
            let right = vkey(cx + 1, cy);
            let bottom = hkey(cx, cy + 1);
            let left = vkey(cx, cy);
            // Corner positions relative to the cell, for orienting segments.
            let pa = P::new(0.0, 0.0);
            let pb = P::new(1.0, 0.0);
            let pc = P::new(1.0, 1.0);
            let pd = P::new(0.0, 1.0);
            let mid = |e: u64| -> P {
                // Midpoints of the cell's edges, enough to orient a segment.
                if e == top {
                    P::new(0.5, 0.0)
                } else if e == right {
                    P::new(1.0, 0.5)
                } else if e == bottom {
                    P::new(0.5, 1.0)
                } else {
                    P::new(0.0, 0.5)
                }
            };
            let mut add = |e1: u64, e2: u64, inside_point: P| {
                // Orient e1 -> e2 so that the inside lies on the right (y down).
                let p1 = mid(e1);
                let p2 = mid(e2);
                let dir = p2.sub(p1);
                let right_normal = P::new(-dir.y, dir.x);
                let (s, e) = if inside_point.sub(p1).dot(right_normal) > 0.0 {
                    (e1, e2)
                } else {
                    (e2, e1)
                };
                next.insert(s, e);
                starts.push(s);
            };
            let centre = P::new(0.5, 0.5);
            match case {
                5 | 10 => {
                    // Saddle: a and c share a state, b and d the other.
                    // Ties join the inside corners, so a one-pixel diagonal stays connected.
                    let centre_in = (a + b + c + d) >= 0.0;
                    // Segments cut off the corners whose state differs from the centre.
                    if ia == centre_in {
                        // b and d are cut off.
                        add(top, right, if ib { pb } else { centre });
                        add(bottom, left, if id { pd } else { centre });
                    } else {
                        // a and c are cut off.
                        add(left, top, if ia { pa } else { centre });
                        add(right, bottom, if ic { pc } else { centre });
                    }
                }
                _ => {
                    let mut crossing = Vec::with_capacity(2);
                    if ia != ib {
                        crossing.push(top);
                    }
                    if ib != ic {
                        crossing.push(right);
                    }
                    if ic != id {
                        crossing.push(bottom);
                    }
                    if id != ia {
                        crossing.push(left);
                    }
                    let inside_point = if ia {
                        pa
                    } else if ib {
                        pb
                    } else if ic {
                        pc
                    } else {
                        pd
                    };
                    add(crossing[0], crossing[1], inside_point);
                }
            }
        }
    }

    let point_of = |key: u64| -> P {
        let n = key / 2;
        let x = (n % nw) as isize - 1;
        let y = (n / nw) as isize - 1;
        let (x2, y2) = if key % 2 == 0 { (x + 1, y) } else { (x, y + 1) };
        let v1 = field.at(x, y) as f64;
        let v2 = field.at(x2, y2) as f64;
        let t = if (v1 - v2).abs() > 1e-12 {
            (v1 / (v1 - v2)).clamp(0.0, 1.0)
        } else {
            0.5
        };
        P::new(
            x as f64 + 0.5 + (x2 - x) as f64 * t,
            y as f64 + 0.5 + (y2 - y) as f64 * t,
        )
    };

    let mut loops = Vec::new();
    for s in starts {
        if !next.contains_key(&s) {
            continue;
        }
        let mut pts = Vec::new();
        let mut k = s;
        while let Some(n) = next.remove(&k) {
            pts.push(point_of(k));
            k = n;
            if k == s {
                break;
            }
        }
        // Drop points that coincide with their predecessor (a crossing exactly at a pixel centre).
        let mut clean: Vec<P> = Vec::with_capacity(pts.len());
        for p in pts {
            if clean.last().is_none_or(|q: &P| q.dist(p) > 1e-6) {
                clean.push(p);
            }
        }
        while clean.len() > 1 && clean[0].dist(*clean.last().unwrap()) <= 1e-6 {
            clean.pop();
        }
        if clean.len() >= 3 {
            loops.push(Loop { pts: clean });
        }
    }
    loops
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trace::geom::signed_area2;

    fn field_from(w: usize, h: usize, f: impl Fn(usize, usize) -> f32) -> Vec<f32> {
        let mut v = vec![0.0; w * h];
        for y in 0..h {
            for x in 0..w {
                v[y * w + x] = f(x, y);
            }
        }
        v
    }

    #[test]
    fn square_is_one_clockwise_loop_on_pixel_edges() {
        let v = field_from(10, 10, |x, y| {
            if (3..7).contains(&x) && (2..5).contains(&y) {
                1.0
            } else {
                -1.0
            }
        });
        let loops = marching_squares(&Field {
            w: 10,
            h: 10,
            v: &v,
        });
        assert_eq!(loops.len(), 1);
        let a = signed_area2(&loops[0].pts) / 2.0;
        // The chamfered corners lose 4 * 1/8 px².
        assert!((a - (12.0 - 0.5)).abs() < 1e-9, "area {a}");
    }

    #[test]
    fn diagonal_line_is_connected() {
        let v = field_from(12, 12, |x, y| {
            if x == y && (2..10).contains(&x) {
                1.0
            } else {
                -1.0
            }
        });
        let loops = marching_squares(&Field {
            w: 12,
            h: 12,
            v: &v,
        });
        assert_eq!(loops.len(), 1);
    }

    #[test]
    fn shape_at_border_closes_on_image_edge() {
        let v = field_from(8, 8, |x, y| if x < 3 && y < 2 { 1.0 } else { -1.0 });
        let loops = marching_squares(&Field { w: 8, h: 8, v: &v });
        assert_eq!(loops.len(), 1);
        let min_x = loops[0].pts.iter().map(|p| p.x).fold(f64::MAX, f64::min);
        let min_y = loops[0].pts.iter().map(|p| p.y).fold(f64::MAX, f64::min);
        assert!(min_x.abs() < 1e-9 && min_y.abs() < 1e-9);
    }
}
