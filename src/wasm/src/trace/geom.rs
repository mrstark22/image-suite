//! Small 2D geometry helpers shared by the tracer's stages.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct P {
    pub x: f64,
    pub y: f64,
}

impl P {
    pub const fn new(x: f64, y: f64) -> P {
        P { x, y }
    }
    pub fn add(self, o: P) -> P {
        P::new(self.x + o.x, self.y + o.y)
    }
    pub fn sub(self, o: P) -> P {
        P::new(self.x - o.x, self.y - o.y)
    }
    pub fn scale(self, s: f64) -> P {
        P::new(self.x * s, self.y * s)
    }
    pub fn dot(self, o: P) -> f64 {
        self.x * o.x + self.y * o.y
    }
    pub fn cross(self, o: P) -> f64 {
        self.x * o.y - self.y * o.x
    }
    pub fn len(self) -> f64 {
        self.x.hypot(self.y)
    }
    pub fn dist(self, o: P) -> f64 {
        self.sub(o).len()
    }
    /// The unit vector in this direction, or zero for a zero vector.
    pub fn unit(self) -> P {
        let l = self.len();
        if l > 1e-12 {
            self.scale(1.0 / l)
        } else {
            P::new(0.0, 0.0)
        }
    }
    pub fn lerp(self, o: P, t: f64) -> P {
        P::new(self.x + (o.x - self.x) * t, self.y + (o.y - self.y) * t)
    }
}

/// Twice the signed area of a closed polygon (positive when it runs clockwise
/// on screen, with y pointing down).
pub fn signed_area2(pts: &[P]) -> f64 {
    let n = pts.len();
    let mut s = 0.0;
    for i in 0..n {
        let a = pts[i];
        let b = pts[(i + 1) % n];
        s += a.x * b.y - b.x * a.y;
    }
    s
}

/// Distance from `p` to the segment `a`-`b`.
pub fn dist_to_segment(p: P, a: P, b: P) -> f64 {
    let ab = b.sub(a);
    let l2 = ab.dot(ab);
    if l2 < 1e-18 {
        return p.dist(a);
    }
    let t = (p.sub(a).dot(ab) / l2).clamp(0.0, 1.0);
    p.dist(a.add(ab.scale(t)))
}
