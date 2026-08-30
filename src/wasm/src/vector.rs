//! High-Performance Precision Vectorization Engine in Native Rust
//! Implements:
//! 1. Directed Pixel-Boundary Grid Contour Extraction (Outer boundaries & Inner holes)
//! 2. Closed-Polygon RDP Simplification (Collapses pixel staircases & quantization noise)
//! 3. Collinear Snapping & Straight Line Optimization
//! 4. Corner vs. Smooth Vertex Classification on Simplified Macro-Polygon
//! 5. Curvature-Preserving Continuous Cubic Bézier Spline Fitting
//! 6. Zhang-Suen Morphological Skeletonization for Centerline Tracing (V-carving)
//! 7. Edge-Preserving Bilateral Pre-Denoise Filter
//! 8. Multi-Color K-Means Palette Segmentation ($K \in [2, 12]$)
//! 9. Canny Edge Detection

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point2D {
    pub x: f32,
    pub y: f32,
}

#[allow(dead_code)]
impl Point2D {
    #[inline]
    pub fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }

    #[inline]
    pub fn dist_sq(&self, other: &Point2D) -> f32 {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        dx * dx + dy * dy
    }

    #[inline]
    pub fn dist(&self, other: &Point2D) -> f32 {
        self.dist_sq(other).sqrt()
    }
}

// =========================================================================
// 1. Edge-Preserving Bilateral Pre-Denoise Filter
// =========================================================================

pub fn apply_pre_denoise(gray: &mut [f32], width: usize, height: usize, radius: usize) {
    if radius == 0 || width == 0 || height == 0 {
        return;
    }
    let r = (radius as isize).clamp(1, 6);
    let sigma_s = radius as f32;
    let sigma_r = 35.0f32;
    let temp = gray.to_vec();

    for y in 0..height {
        let row_offset = y * width;
        for x in 0..width {
            let center_val = temp[row_offset + x];
            let mut sum = 0.0f32;
            let mut w_sum = 0.0f32;

            for dy in -r..=r {
                let ny = y as isize + dy;
                if ny < 0 || ny >= height as isize {
                    continue;
                }
                let n_row = ny as usize * width;

                for dx in -r..=r {
                    let nx = x as isize + dx;
                    if nx < 0 || nx >= width as isize {
                        continue;
                    }

                    let val = temp[n_row + nx as usize];
                    let d_spatial_sq = (dx * dx + dy * dy) as f32;
                    let d_range = val - center_val;

                    let w_s = (-d_spatial_sq / (2.0 * sigma_s * sigma_s)).exp();
                    let w_r = (-(d_range * d_range) / (2.0 * sigma_r * sigma_r)).exp();
                    let w = w_s * w_r;

                    sum += val * w;
                    w_sum += w;
                }
            }

            if w_sum > 0.0 {
                gray[row_offset + x] = sum / w_sum;
            }
        }
    }
}

// =========================================================================
// 2. Directed Pixel Boundary Grid Contour Extraction
// =========================================================================

#[derive(Clone, Copy, Debug, PartialEq)]
enum Direction {
    East = 0,
    South = 1,
    West = 2,
    North = 3,
}

pub fn trace_boundary_contours(
    binary: &[u8],
    width: usize,
    height: usize,
    min_area: f32,
) -> Vec<Vec<Point2D>> {
    if width == 0 || height == 0 {
        return Vec::new();
    }

    let gw = width + 1;
    let gh = height + 1;

    let mut h_edges = vec![0i8; gh * width];
    let mut v_edges = vec![0i8; height * gw];

    let get_pixel = |x: isize, y: isize| -> u8 {
        if x < 0 || x >= width as isize || y < 0 || y >= height as isize {
            0
        } else {
            binary[(y as usize) * width + (x as usize)]
        }
    };

    for y in 0..=height {
        for x in 0..width {
            let top = get_pixel(x as isize, y as isize - 1);
            let bottom = get_pixel(x as isize, y as isize);
            if top == 0 && bottom == 1 {
                h_edges[y * width + x] = 1; // East
            } else if top == 1 && bottom == 0 {
                h_edges[y * width + x] = -1; // West
            }
        }
    }

    for y in 0..height {
        for x in 0..=width {
            let left = get_pixel(x as isize - 1, y as isize);
            let right = get_pixel(x as isize, y as isize);
            if left == 1 && right == 0 {
                v_edges[y * gw + x] = 1; // South
            } else if left == 0 && right == 1 {
                v_edges[y * gw + x] = -1; // North
            }
        }
    }

    let mut contours: Vec<Vec<Point2D>> = Vec::new();
    let max_contours = 4000;

    for start_y in 0..=height {
        if contours.len() >= max_contours {
            break;
        }

        for start_x in 0..width {
            let h_idx = start_y * width + start_x;
            if h_edges[h_idx] == 0 {
                continue;
            }

            let initial_dir = if h_edges[h_idx] == 1 {
                Direction::East
            } else {
                Direction::West
            };

            let mut pts: Vec<Point2D> = Vec::new();
            let mut cur_x = if initial_dir == Direction::East {
                start_x
            } else {
                start_x + 1
            };
            let mut cur_y = start_y;
            let mut cur_dir = initial_dir;

            let origin_x = cur_x;
            let origin_y = cur_y;

            let mut steps = 0;
            let max_steps = (width + height) * 8 + 50000;

            loop {
                pts.push(Point2D::new(cur_x as f32, cur_y as f32));

                match cur_dir {
                    Direction::East => {
                        let e_idx = cur_y * width + cur_x;
                        if e_idx < h_edges.len() {
                            h_edges[e_idx] = 0;
                        }
                        cur_x += 1;
                    }
                    Direction::South => {
                        let e_idx = cur_y * gw + cur_x;
                        if e_idx < v_edges.len() {
                            v_edges[e_idx] = 0;
                        }
                        cur_y += 1;
                    }
                    Direction::West => {
                        cur_x -= 1;
                        let e_idx = cur_y * width + cur_x;
                        if e_idx < h_edges.len() {
                            h_edges[e_idx] = 0;
                        }
                    }
                    Direction::North => {
                        cur_y -= 1;
                        let e_idx = cur_y * gw + cur_x;
                        if e_idx < v_edges.len() {
                            v_edges[e_idx] = 0;
                        }
                    }
                }

                steps += 1;
                if cur_x == origin_x && cur_y == origin_y {
                    break;
                }
                if steps >= max_steps {
                    break;
                }

                let candidate_dirs = match cur_dir {
                    Direction::East => [Direction::South, Direction::East, Direction::North],
                    Direction::South => [Direction::West, Direction::South, Direction::East],
                    Direction::West => [Direction::North, Direction::West, Direction::South],
                    Direction::North => [Direction::East, Direction::North, Direction::West],
                };

                let mut next_dir = None;
                for &cd in &candidate_dirs {
                    let has_edge = match cd {
                        Direction::East => {
                            cur_x < width && h_edges[cur_y * width + cur_x] == 1
                        }
                        Direction::South => {
                            cur_y < height && v_edges[cur_y * gw + cur_x] == 1
                        }
                        Direction::West => {
                            cur_x > 0 && h_edges[cur_y * width + (cur_x - 1)] == -1
                        }
                        Direction::North => {
                            cur_y > 0 && v_edges[(cur_y - 1) * gw + cur_x] == -1
                        }
                    };

                    if has_edge {
                        next_dir = Some(cd);
                        break;
                    }
                }

                match next_dir {
                    Some(d) => cur_dir = d,
                    None => break,
                }
            }

            if pts.len() >= 4 {
                let area = compute_polygon_area(&pts);
                if area >= min_area {
                    contours.push(pts);
                }
            }
        }
    }

    contours
}

#[inline]
pub fn compute_polygon_area(points: &[Point2D]) -> f32 {
    let n = points.len();
    if n < 3 {
        return 0.0;
    }
    let mut area = 0.0f32;
    for i in 0..n {
        let j = (i + 1) % n;
        area += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    (area / 2.0).abs()
}

fn collapse_collinear(points: &[Point2D]) -> Vec<Point2D> {
    if points.len() <= 3 {
        return points.to_vec();
    }
    let n = points.len();
    let mut result = Vec::with_capacity(n);
    result.push(points[0]);

    for i in 1..n {
        let prev = result.last().unwrap();
        let curr = points[i];
        let next = points[(i + 1) % n];

        let dx1 = curr.x - prev.x;
        let dy1 = curr.y - prev.y;
        let dx2 = next.x - curr.x;
        let dy2 = next.y - curr.y;

        let cross = dx1 * dy2 - dy1 * dx2;
        let dot = dx1 * dx2 + dy1 * dy2;
        if cross.abs() < 0.0001 && dot >= 0.0 {
            continue;
        }
        result.push(curr);
    }

    result
}

// =========================================================================
// 3. Closed-Polygon RDP Simplification & Collinear Elimination
// =========================================================================

#[inline]
fn perp_distance(p: &Point2D, a: &Point2D, b: &Point2D) -> f32 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let len_sq = dx * dx + dy * dy;
    if len_sq < 0.0001 {
        return p.dist(a);
    }
    ((p.x - a.x) * dy - (p.y - a.y) * dx).abs() / len_sq.sqrt()
}

/// Recursive Ramer-Douglas-Peucker on an open chain
fn rdp_chain(points: &[Point2D], epsilon: f32) -> Vec<Point2D> {
    if points.len() <= 2 {
        return points.to_vec();
    }

    let mut max_dist = 0.0f32;
    let mut max_idx = 0usize;
    let start = points[0];
    let end = points[points.len() - 1];

    for i in 1..(points.len() - 1) {
        let d = perp_distance(&points[i], &start, &end);
        if d > max_dist {
            max_dist = d;
            max_idx = i;
        }
    }

    if max_dist > epsilon {
        let mut left = rdp_chain(&points[0..=max_idx], epsilon);
        let right = rdp_chain(&points[max_idx..], epsilon);
        left.pop();
        left.extend(right);
        left
    } else {
        vec![start, end]
    }
}

/// Simplifies a closed boundary loop by diameter-splitting and recursive RDP
pub fn simplify_closed_polygon(raw_points: &[Point2D], tolerance: f32) -> Vec<Point2D> {
    let points = collapse_collinear(raw_points);
    let n = points.len();
    if n <= 3 {
        return points;
    }

    // Minimum tolerance 0.75px to ensure 1px diagonal staircases collapse cleanly into single straight chords
    let epsilon = tolerance.max(0.75);

    // Find principal diameter pair (two furthest vertices)
    let mut max_dist_sq = 0.0f32;
    let mut best_i = 0usize;
    let mut best_j = n / 2;

    for i in 0..n {
        let pi = points[i];
        for j in (i + 1)..n {
            let d_sq = pi.dist_sq(&points[j]);
            if d_sq > max_dist_sq {
                max_dist_sq = d_sq;
                best_i = i;
                best_j = j;
            }
        }
    }

    if best_i > best_j {
        std::mem::swap(&mut best_i, &mut best_j);
    }

    // Chain 1: best_i -> best_j
    let chain1: Vec<Point2D> = points[best_i..=best_j].to_vec();
    let sim1 = rdp_chain(&chain1, epsilon);

    // Chain 2: best_j -> best_i (cyclic)
    let mut chain2: Vec<Point2D> = points[best_j..].to_vec();
    chain2.extend_from_slice(&points[0..=best_i]);
    let sim2 = rdp_chain(&chain2, epsilon);

    let mut result = sim1;
    if !result.is_empty() {
        result.pop();
    }
    result.extend(sim2);
    if !result.is_empty() {
        result.pop();
    }

    // Clean redundant near-collinear vertices (deviation < 0.35px)
    let mut cleaned = Vec::with_capacity(result.len());
    let rn = result.len();
    if rn <= 3 {
        return result;
    }

    for i in 0..rn {
        let prev = result[(i + rn - 1) % rn];
        let curr = result[i];
        let next = result[(i + 1) % rn];

        let d = perp_distance(&curr, &prev, &next);
        if d < 0.35 {
            continue;
        }
        cleaned.push(curr);
    }

    if cleaned.len() >= 3 {
        cleaned
    } else {
        result
    }
}

// =========================================================================
// 4. Corner Classification & Curvature-Preserving Bézier Fitting
// =========================================================================

#[derive(Clone, Copy, Debug, PartialEq)]
enum VertexType {
    Corner,
    Smooth,
}

/// Classifies polygon vertices into sharp corners vs smooth curve transitions
fn classify_vertices(points: &[Point2D], corner_threshold: f32) -> Vec<VertexType> {
    let n = points.len();
    if n <= 3 {
        return vec![VertexType::Corner; n];
    }

    let mut types = Vec::with_capacity(n);
    // Turning angle threshold in radians (~48 degrees for threshold 1.0)
    let thresh_rad = (0.65f32 + corner_threshold * 0.20).clamp(0.50, 1.55);

    for i in 0..n {
        let prev = points[(i + n - 1) % n];
        let curr = points[i];
        let next = points[(i + 1) % n];

        let v1_x = curr.x - prev.x;
        let v1_y = curr.y - prev.y;
        let v2_x = next.x - curr.x;
        let v2_y = next.y - curr.y;

        let len1 = (v1_x * v1_x + v1_y * v1_y).sqrt();
        let len2 = (v2_x * v2_x + v2_y * v2_y).sqrt();

        if len1 < 0.001 || len2 < 0.001 {
            types.push(VertexType::Corner);
            continue;
        }

        let dot = (v1_x * v2_x + v1_y * v2_y) / (len1 * len2);
        let angle = dot.clamp(-1.0, 1.0).acos();

        if angle >= thresh_rad {
            types.push(VertexType::Corner);
        } else {
            types.push(VertexType::Smooth);
        }
    }

    types
}

/// Formats polygon into SVG path data with:
/// - Crisp, laser-straight lines (`L`) between corners (arms of 'X', stems of 'T', 'I', 'l', 'V', 'A')
/// - Silky smooth cubic Bézier curves (`C`) along curved sections ('O', 'S', 'e', 'c', 'o')
pub fn format_svg_path(
    points: &[Point2D],
    curve_fitting: bool,
    is_closed: bool,
    corner_threshold: f32,
) -> String {
    let n = points.len();
    if n == 0 {
        return String::new();
    }
    if n == 1 {
        return format!("M {:.2} {:.2}", points[0].x, points[0].y);
    }
    if !curve_fitting || n < 3 {
        let mut d = format!("M {:.2} {:.2}", points[0].x, points[0].y);
        for p in &points[1..] {
            d.push_str(&format!(" L {:.2} {:.2}", p.x, p.y));
        }
        if is_closed {
            d.push_str(" Z");
        }
        return d;
    }

    let vertex_types = classify_vertices(points, corner_threshold);
    let mut d = format!("M {:.2} {:.2}", points[0].x, points[0].y);

    let num_segments = if is_closed { n } else { n - 1 };

    for i in 0..num_segments {
        let p1 = points[i];
        let p2 = points[(i + 1) % n];
        let t1 = vertex_types[i];
        let t2 = vertex_types[(i + 1) % n];

        let chord_dx = p2.x - p1.x;
        let chord_dy = p2.y - p1.y;
        let chord_len = (chord_dx * chord_dx + chord_dy * chord_dy).sqrt();

        if chord_len < 0.001 {
            continue;
        }

        // If both endpoints are sharp corners (e.g. straight arm of X, stem of T, diagonal of A, V):
        // Render an EXACT STRAIGHT LINE segment with ZERO curvature/wobble
        if t1 == VertexType::Corner && t2 == VertexType::Corner {
            d.push_str(&format!(" L {:.2} {:.2}", p2.x, p2.y));
            continue;
        }

        // Smooth curve section (e.g. 'O', 'S', 'e', 'c')
        let p0 = points[(i + n - 1) % n];
        let p3 = points[(i + 2) % n];

        let tan1 = if t1 == VertexType::Corner {
            Point2D::new(chord_dx / chord_len, chord_dy / chord_len)
        } else {
            let dx = p2.x - p0.x;
            let dy = p2.y - p0.y;
            let len = (dx * dx + dy * dy).sqrt().max(0.001);
            Point2D::new(dx / len, dy / len)
        };

        let tan2 = if t2 == VertexType::Corner {
            Point2D::new(chord_dx / chord_len, chord_dy / chord_len)
        } else {
            let dx = p3.x - p1.x;
            let dy = p3.y - p1.y;
            let len = (dx * dx + dy * dy).sqrt().max(0.001);
            Point2D::new(dx / len, dy / len)
        };

        let handle_len = chord_len / 3.0;
        let cp1_x = p1.x + tan1.x * handle_len;
        let cp1_y = p1.y + tan1.y * handle_len;
        let cp2_x = p2.x - tan2.x * handle_len;
        let cp2_y = p2.y - tan2.y * handle_len;

        d.push_str(&format!(
            " C {:.2} {:.2}, {:.2} {:.2}, {:.2} {:.2}",
            cp1_x, cp1_y, cp2_x, cp2_y, p2.x, p2.y
        ));
    }

    if is_closed {
        d.push_str(" Z");
    }

    d
}

// =========================================================================
// 5. Zhang-Suen Morphological Skeletonization for Centerline Tracing
// =========================================================================

pub fn zhang_suen_thinning(binary: &mut [u8], width: usize, height: usize) {
    if width < 3 || height < 3 {
        return;
    }

    let mut to_delete = Vec::with_capacity(width * height / 8);
    let mut changed = true;

    while changed {
        changed = false;

        // Sub-iteration 1
        for y in 1..(height - 1) {
            let row = y * width;
            for x in 1..(width - 1) {
                let idx = row + x;
                if binary[idx] != 1 {
                    continue;
                }

                let p2 = binary[(y - 1) * width + x];
                let p3 = binary[(y - 1) * width + (x + 1)];
                let p4 = binary[y * width + (x + 1)];
                let p5 = binary[(y + 1) * width + (x + 1)];
                let p6 = binary[(y + 1) * width + x];
                let p7 = binary[(y + 1) * width + (x - 1)];
                let p8 = binary[y * width + (x - 1)];
                let p9 = binary[(y - 1) * width + (x - 1)];

                let b_count = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
                if b_count < 2 || b_count > 6 {
                    continue;
                }

                let neighbors = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
                let mut a_count = 0;
                for i in 0..8 {
                    if neighbors[i] == 0 && neighbors[i + 1] == 1 {
                        a_count += 1;
                    }
                }
                if a_count != 1 {
                    continue;
                }

                if (p2 * p4 * p6 == 0) && (p4 * p6 * p8 == 0) {
                    to_delete.push(idx);
                }
            }
        }

        if !to_delete.is_empty() {
            changed = true;
            for &idx in &to_delete {
                binary[idx] = 0;
            }
            to_delete.clear();
        }

        // Sub-iteration 2
        for y in 1..(height - 1) {
            let row = y * width;
            for x in 1..(width - 1) {
                let idx = row + x;
                if binary[idx] != 1 {
                    continue;
                }

                let p2 = binary[(y - 1) * width + x];
                let p3 = binary[(y - 1) * width + (x + 1)];
                let p4 = binary[y * width + (x + 1)];
                let p5 = binary[(y + 1) * width + (x + 1)];
                let p6 = binary[(y + 1) * width + x];
                let p7 = binary[(y + 1) * width + (x - 1)];
                let p8 = binary[y * width + (x - 1)];
                let p9 = binary[(y - 1) * width + (x - 1)];

                let b_count = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
                if b_count < 2 || b_count > 6 {
                    continue;
                }

                let neighbors = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
                let mut a_count = 0;
                for i in 0..8 {
                    if neighbors[i] == 0 && neighbors[i + 1] == 1 {
                        a_count += 1;
                    }
                }
                if a_count != 1 {
                    continue;
                }

                if (p2 * p4 * p8 == 0) && (p2 * p6 * p8 == 0) {
                    to_delete.push(idx);
                }
            }
        }

        if !to_delete.is_empty() {
            changed = true;
            for &idx in &to_delete {
                binary[idx] = 0;
            }
            to_delete.clear();
        }
    }
}

pub fn trace_skeleton_strokes(
    skeleton: &[u8],
    width: usize,
    height: usize,
    min_length: f32,
) -> Vec<Vec<Point2D>> {
    let total = width * height;
    let mut visited = vec![false; total];
    let mut strokes = Vec::new();

    let neighbors_8 = [
        (0isize, -1isize),
        (1, -1),
        (1, 0),
        (1, 1),
        (0, 1),
        (-1, 1),
        (-1, 0),
        (-1, -1),
    ];

    let count_neighbors = |x: usize, y: usize| -> usize {
        let mut count = 0;
        for (dx, dy) in neighbors_8 {
            let nx = x as isize + dx;
            let ny = y as isize + dy;
            if nx >= 0 && nx < width as isize && ny >= 0 && ny < height as isize {
                if skeleton[(ny as usize) * width + (nx as usize)] == 1 {
                    count += 1;
                }
            }
        }
        count
    };

    // 1. Trace from endpoints (degree 1) first
    for y in 0..height {
        for x in 0..width {
            let idx = y * width + x;
            if skeleton[idx] == 1 && !visited[idx] {
                let deg = count_neighbors(x, y);
                if deg == 1 {
                    let mut stroke = Vec::new();
                    let mut cx = x;
                    let mut cy = y;

                    loop {
                        stroke.push(Point2D::new(cx as f32, cy as f32));
                        visited[cy * width + cx] = true;

                        let mut next = None;
                        for (dx, dy) in neighbors_8 {
                            let nx = cx as isize + dx;
                            let ny = cy as isize + dy;
                            if nx >= 0 && nx < width as isize && ny >= 0 && ny < height as isize {
                                let n_idx = (ny as usize) * width + (nx as usize);
                                if skeleton[n_idx] == 1 && !visited[n_idx] {
                                    next = Some((nx as usize, ny as usize));
                                    break;
                                }
                            }
                        }

                        match next {
                            Some((nx, ny)) => {
                                cx = nx;
                                cy = ny;
                            }
                            None => break,
                        }
                    }

                    if stroke.len() >= 2 {
                        let stroke_len = (stroke.len() as f32).max(1.0);
                        if stroke_len >= min_length {
                            strokes.push(stroke);
                        }
                    }
                }
            }
        }
    }

    // 2. Trace remaining loops
    for y in 0..height {
        for x in 0..width {
            let idx = y * width + x;
            if skeleton[idx] == 1 && !visited[idx] {
                let mut stroke = Vec::new();
                let mut cx = x;
                let mut cy = y;

                loop {
                    stroke.push(Point2D::new(cx as f32, cy as f32));
                    visited[cy * width + cx] = true;

                    let mut next = None;
                    for (dx, dy) in neighbors_8 {
                        let nx = cx as isize + dx;
                        let ny = cy as isize + dy;
                        if nx >= 0 && nx < width as isize && ny >= 0 && ny < height as isize {
                            let n_idx = (ny as usize) * width + (nx as usize);
                            if skeleton[n_idx] == 1 && !visited[n_idx] {
                                next = Some((nx as usize, ny as usize));
                                break;
                            }
                        }
                    }

                    match next {
                        Some((nx, ny)) => {
                            cx = nx;
                            cy = ny;
                        }
                        None => break,
                    }
                }

                if stroke.len() >= 3 {
                    strokes.push(stroke);
                }
            }
        }
    }

    strokes
}

// =========================================================================
// 6. K-Means Multi-Color Clustering
// =========================================================================

pub struct KMeansResult {
    pub palette: Vec<[u8; 3]>,
    pub assignments: Vec<u8>,
}

pub fn run_kmeans(pixels: &[u8], width: usize, height: usize, k: usize) -> KMeansResult {
    let total = width * height;
    let k = k.clamp(2, 12);

    let mut centroids = Vec::with_capacity(k);
    for i in 0..k {
        let idx = ((i * total) / k) * 4;
        centroids.push([
            pixels[idx] as f32,
            pixels[idx + 1] as f32,
            pixels[idx + 2] as f32,
        ]);
    }

    let mut assignments = vec![0u8; total];
    let max_iters = 6;

    for _ in 0..max_iters {
        let mut sums = vec![[0.0f32; 3]; k];
        let mut counts = vec![0usize; k];
        let mut changed = 0usize;

        for i in 0..total {
            let idx = i * 4;
            let r = pixels[idx] as f32;
            let g = pixels[idx + 1] as f32;
            let b = pixels[idx + 2] as f32;

            let mut best_dist = f32::MAX;
            let mut best_k = 0u8;

            for (ci, centroid) in centroids.iter().enumerate() {
                let dr = r - centroid[0];
                let dg = g - centroid[1];
                let db = b - centroid[2];
                let dist = dr * dr + dg * dg + db * db;
                if dist < best_dist {
                    best_dist = dist;
                    best_k = ci as u8;
                }
            }

            if assignments[i] != best_k {
                assignments[i] = best_k;
                changed += 1;
            }

            sums[best_k as usize][0] += r;
            sums[best_k as usize][1] += g;
            sums[best_k as usize][2] += b;
            counts[best_k as usize] += 1;
        }

        for ci in 0..k {
            if counts[ci] > 0 {
                centroids[ci][0] = sums[ci][0] / counts[ci] as f32;
                centroids[ci][1] = sums[ci][1] / counts[ci] as f32;
                centroids[ci][2] = sums[ci][2] / counts[ci] as f32;
            }
        }

        if changed == 0 {
            break;
        }
    }

    let palette = centroids
        .into_iter()
        .map(|c| [c[0].round() as u8, c[1].round() as u8, c[2].round() as u8])
        .collect();

    KMeansResult {
        palette,
        assignments,
    }
}

// =========================================================================
// 7. Canny Edge Operator
// =========================================================================

pub fn run_canny(
    pixels: &[u8],
    width: usize,
    height: usize,
    low_thresh: f32,
    high_thresh: f32,
    denoise_radius: usize,
) -> Vec<u8> {
    let total = width * height;
    let mut gray = vec![0.0f32; total];
    for i in 0..total {
        let idx = i * 4;
        gray[i] = 0.299 * pixels[idx] as f32
            + 0.587 * pixels[idx + 1] as f32
            + 0.114 * pixels[idx + 2] as f32;
    }

    if denoise_radius > 0 {
        apply_pre_denoise(&mut gray, width, height, denoise_radius);
    }

    let mut blurred = vec![0.0f32; total];
    let kernel = [
        [1.0 / 16.0, 2.0 / 16.0, 1.0 / 16.0],
        [2.0 / 16.0, 4.0 / 16.0, 2.0 / 16.0],
        [1.0 / 16.0, 2.0 / 16.0, 1.0 / 16.0],
    ];

    let w = width as isize;
    let h = height as isize;

    for y in 1..(h - 1) {
        for x in 1..(w - 1) {
            let mut sum = 0.0f32;
            for ky in -1..=1 {
                for kx in -1..=1 {
                    let py = (y + ky) as usize;
                    let px = (x + kx) as usize;
                    sum += gray[py * width + px] * kernel[(ky + 1) as usize][(kx + 1) as usize];
                }
            }
            blurred[(y * w + x) as usize] = sum;
        }
    }

    let mut grad_mag = vec![0.0f32; total];
    let mut grad_dir = vec![0u8; total];

    for y in 1..(h - 1) {
        for x in 1..(w - 1) {
            let idx = (y * w + x) as usize;
            let gx = -blurred[((y - 1) * w + x - 1) as usize]
                + blurred[((y - 1) * w + x + 1) as usize]
                - 2.0 * blurred[(y * w + x - 1) as usize]
                + 2.0 * blurred[(y * w + x + 1) as usize]
                - blurred[((y + 1) * w + x - 1) as usize]
                + blurred[((y + 1) * w + x + 1) as usize];

            let gy = blurred[((y - 1) * w + x - 1) as usize]
                + 2.0 * blurred[((y - 1) * w + x) as usize]
                + blurred[((y - 1) * w + x + 1) as usize]
                - blurred[((y + 1) * w + x - 1) as usize]
                - 2.0 * blurred[((y + 1) * w + x) as usize]
                - blurred[((y + 1) * w + x + 1) as usize];

            let mag = (gx * gx + gy * gy).sqrt();
            grad_mag[idx] = mag;

            let angle = (gy.atan2(gx) * 180.0 / std::f32::consts::PI).rem_euclid(180.0);
            grad_dir[idx] = if (angle < 22.5) || (angle >= 157.5) {
                0
            } else if angle < 67.5 {
                1
            } else if angle < 112.5 {
                2
            } else {
                3
            };
        }
    }

    let mut nms = vec![0.0f32; total];
    for y in 1..(h - 1) {
        for x in 1..(w - 1) {
            let idx = (y * w + x) as usize;
            let mag = grad_mag[idx];
            let dir = grad_dir[idx];

            let (p1, p2) = match dir {
                0 => (
                    grad_mag[(y * w + x - 1) as usize],
                    grad_mag[(y * w + x + 1) as usize],
                ),
                1 => (
                    grad_mag[((y - 1) * w + x + 1) as usize],
                    grad_mag[((y + 1) * w + x - 1) as usize],
                ),
                2 => (
                    grad_mag[((y - 1) * w + x) as usize],
                    grad_mag[((y + 1) * w + x) as usize],
                ),
                _ => (
                    grad_mag[((y - 1) * w + x - 1) as usize],
                    grad_mag[((y + 1) * w + x + 1) as usize],
                ),
            };

            if mag >= p1 && mag >= p2 {
                nms[idx] = mag;
            }
        }
    }

    let mut edges = vec![0u8; total];
    let mut strong_edges = Vec::new();

    for i in 0..total {
        if nms[i] >= high_thresh {
            edges[i] = 1;
            strong_edges.push(i);
        } else if nms[i] >= low_thresh {
            edges[i] = 2;
        }
    }

    while let Some(idx) = strong_edges.pop() {
        let x = (idx % width) as isize;
        let y = (idx / width) as isize;

        for dy in -1..=1 {
            for dx in -1..=1 {
                let nx = x + dx;
                let ny = y + dy;
                if nx >= 0 && nx < w && ny >= 0 && ny < h {
                    let n_idx = (ny * w + nx) as usize;
                    if edges[n_idx] == 2 {
                        edges[n_idx] = 1;
                        strong_edges.push(n_idx);
                    }
                }
            }
        }
    }

    for i in 0..total {
        if edges[i] == 2 {
            edges[i] = 0;
        }
    }

    edges
}

// =========================================================================
// 8. Vectorization Pipeline Orchestrator
// =========================================================================

pub struct VectorConfig {
    pub mode: u32,
    pub color_count: usize,
    pub threshold: u8,
    pub rdp_tolerance: f32,
    pub curve_fitting: bool,
    pub min_path_area: f32,
    pub denoise: f32,
    pub canny_low: f32,
    pub canny_high: f32,
    pub invert: bool,
    pub bezier_tolerance: f32,
}

fn count_svg_nodes(d: &str) -> usize {
    d.split(|c: char| c.is_whitespace() || c == ',')
        .filter(|&tok| tok == "M" || tok == "L" || tok == "C" || tok == "Q")
        .count()
        .max(1)
}

pub fn vectorize_to_json_string(
    pixels: &[u8],
    width: usize,
    height: usize,
    cfg: &VectorConfig,
) -> String {
    let total = width * height;
    let mut json = String::with_capacity(32768);
    json.push_str("{\"layers\":[");

    let effective_min_area = cfg.min_path_area.max(1.0);
    let denoise_radius = (cfg.denoise.round() as usize).min(8);
    let tol = cfg.rdp_tolerance.max(0.5);
    let corner_thresh = cfg.bezier_tolerance.max(0.2);

    match cfg.mode {
        // Mode 1: Centerline (Zhang-Suen Skeletonization)
        1 => {
            let mut gray = vec![0.0f32; total];
            for i in 0..total {
                let idx = i * 4;
                gray[i] = 0.299 * pixels[idx] as f32
                    + 0.587 * pixels[idx + 1] as f32
                    + 0.114 * pixels[idx + 2] as f32;
            }

            if denoise_radius > 0 {
                apply_pre_denoise(&mut gray, width, height, denoise_radius);
            }

            let mut binary = vec![0u8; total];
            let thresh = cfg.threshold as f32;
            for i in 0..total {
                let g = gray[i];
                let is_fg = if cfg.invert { g >= thresh } else { g < thresh };
                binary[i] = if is_fg { 1 } else { 0 };
            }

            zhang_suen_thinning(&mut binary, width, height);

            let min_len = (effective_min_area.sqrt()).max(2.0);
            let strokes = trace_skeleton_strokes(&binary, width, height, min_len);

            let hex = "#38bdf8";
            json.push_str(&format!(
                "{{\"id\":\"layer-1\",\"name\":\"Centerlines\",\"color\":\"{}\",\"visible\":true,\"paths\":[",
                hex
            ));

            let mut path_count = 0;
            for (pi, raw_stroke) in strokes.iter().enumerate() {
                let pts = rdp_chain(raw_stroke, tol);
                if pts.len() >= 2 {
                    let d = format_svg_path(&pts, cfg.curve_fitting, false, corner_thresh);
                    if path_count > 0 {
                        json.push(',');
                    }
                    let nodes = count_svg_nodes(&d);
                    json.push_str(&format!(
                        "{{\"id\":\"path-{}\",\"color\":\"{}\",\"isClosed\":false,\"svgPathData\":\"{}\",\"nodeCount\":{}}}",
                        pi + 1,
                        hex,
                        d,
                        nodes
                    ));
                    path_count += 1;
                }
            }
            json.push_str("]}");
        }

        // Mode 2: Multi-Color (K-Means)
        2 => {
            let km = run_kmeans(pixels, width, height, cfg.color_count);
            let mut layer_idx = 0;

            for (ci, color) in km.palette.iter().enumerate() {
                let mut mask = vec![0u8; total];
                for (pi, &assigned_c) in km.assignments.iter().enumerate() {
                    if assigned_c == ci as u8 {
                        mask[pi] = 1;
                    }
                }

                let raw_contours =
                    trace_boundary_contours(&mask, width, height, effective_min_area);
                if raw_contours.is_empty() {
                    continue;
                }

                if layer_idx > 0 {
                    json.push(',');
                }
                layer_idx += 1;

                let hex = format!("#{:02x}{:02x}{:02x}", color[0], color[1], color[2]);
                json.push_str(&format!(
                    "{{\"id\":\"layer-{}\",\"name\":\"Color {}\",\"color\":\"{}\",\"visible\":true,\"paths\":[",
                    ci + 1,
                    ci + 1,
                    hex
                ));

                let mut path_count = 0;
                for (pi, raw_pts) in raw_contours.iter().enumerate() {
                    let pts = simplify_closed_polygon(raw_pts, tol);
                    if pts.len() >= 3 {
                        let d = format_svg_path(&pts, cfg.curve_fitting, true, corner_thresh);
                        if path_count > 0 {
                            json.push(',');
                        }
                        let nodes = count_svg_nodes(&d);
                        json.push_str(&format!(
                            "{{\"id\":\"path-{}-{}\",\"color\":\"{}\",\"isClosed\":true,\"svgPathData\":\"{}\",\"nodeCount\":{}}}",
                            ci + 1,
                            pi + 1,
                            hex,
                            d,
                            nodes
                        ));
                        path_count += 1;
                    }
                }

                json.push_str("]}");
            }
        }

        // Mode 3: Canny Edge Detection
        3 => {
            let edges = run_canny(
                pixels,
                width,
                height,
                cfg.canny_low,
                cfg.canny_high,
                denoise_radius,
            );
            let raw_contours =
                trace_boundary_contours(&edges, width, height, effective_min_area);
            let hex = "#38bdf8";

            json.push_str(&format!(
                "{{\"id\":\"layer-1\",\"name\":\"Canny Edges\",\"color\":\"{}\",\"visible\":true,\"paths\":[",
                hex
            ));

            let mut path_count = 0;
            for (pi, raw_pts) in raw_contours.iter().enumerate() {
                let pts = simplify_closed_polygon(raw_pts, tol);
                if pts.len() >= 3 {
                    let d = format_svg_path(&pts, cfg.curve_fitting, true, corner_thresh);
                    if path_count > 0 {
                        json.push(',');
                    }
                    let nodes = count_svg_nodes(&d);
                    json.push_str(&format!(
                        "{{\"id\":\"path-{}\",\"color\":\"{}\",\"isClosed\":true,\"svgPathData\":\"{}\",\"nodeCount\":{}}}",
                        pi + 1,
                        hex,
                        d,
                        nodes
                    ));
                    path_count += 1;
                }
            }
            json.push_str("]}");
        }

        // Mode 0 / Default: Outline Trace
        _ => {
            let mut gray = vec![0.0f32; total];
            for i in 0..total {
                let idx = i * 4;
                gray[i] = 0.299 * pixels[idx] as f32
                    + 0.587 * pixels[idx + 1] as f32
                    + 0.114 * pixels[idx + 2] as f32;
            }

            if denoise_radius > 0 {
                apply_pre_denoise(&mut gray, width, height, denoise_radius);
            }

            let mut binary = vec![0u8; total];
            let thresh = cfg.threshold as f32;
            for i in 0..total {
                let g = gray[i];
                let is_fg = if cfg.invert { g >= thresh } else { g < thresh };
                binary[i] = if is_fg { 1 } else { 0 };
            }

            let raw_contours =
                trace_boundary_contours(&binary, width, height, effective_min_area);
            let hex = "#38bdf8";

            json.push_str(&format!(
                "{{\"id\":\"layer-1\",\"name\":\"Outline Contours\",\"color\":\"{}\",\"visible\":true,\"paths\":[",
                hex
            ));

            let mut path_count = 0;
            for (pi, raw_pts) in raw_contours.iter().enumerate() {
                let pts = simplify_closed_polygon(raw_pts, tol);
                if pts.len() >= 3 {
                    let d = format_svg_path(&pts, cfg.curve_fitting, true, corner_thresh);
                    if path_count > 0 {
                        json.push(',');
                    }
                    let nodes = count_svg_nodes(&d);
                    json.push_str(&format!(
                        "{{\"id\":\"path-{}\",\"color\":\"{}\",\"isClosed\":true,\"svgPathData\":\"{}\",\"nodeCount\":{}}}",
                        pi + 1,
                        hex,
                        d,
                        nodes
                    ));
                    path_count += 1;
                }
            }
            json.push_str("]}");
        }
    }

    json.push_str(&format!(
        "],\"dimensions\":{{\"width\":{},\"height\":{}}}}}",
        width, height
    ));

    json
}
