//! Rotation by quarter turns: an exact rearrangement of pixels (#65).

/// Rotates the RGBA8 image `src` (`w` x `h`) clockwise by `turns` quarter
/// turns into `out`. For an odd number of turns `out` is `h` x `w`; otherwise
/// `w` x `h`. No pixel value changes.
pub fn rotate_quarter_turns(src: &[u8], w: usize, h: usize, turns: u32, out: &mut [u8]) {
    let turns = turns % 4;
    let (ow, oh) = if turns % 2 == 1 { (h, w) } else { (w, h) };
    for oy in 0..oh {
        for ox in 0..ow {
            // The source pixel that lands on (ox, oy).
            let (sx, sy) = match turns {
                0 => (ox, oy),
                1 => (oy, h - 1 - ox),
                2 => (w - 1 - ox, h - 1 - oy),
                _ => (w - 1 - oy, ox),
            };
            let s = (sy * w + sx) * 4;
            let o = (oy * ow + ox) * 4;
            out[o..o + 4].copy_from_slice(&src[s..s + 4]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 3 x 2 image whose pixel (x, y) is [x, y, 7, 255].
    fn image() -> Vec<u8> {
        let mut px = Vec::new();
        for y in 0..2u8 {
            for x in 0..3u8 {
                px.extend([x, y, 7, 255]);
            }
        }
        px
    }

    fn at(px: &[u8], w: usize, x: usize, y: usize) -> (u8, u8) {
        (px[(y * w + x) * 4], px[(y * w + x) * 4 + 1])
    }

    #[test]
    fn a_quarter_turn_clockwise_puts_the_left_column_on_top() {
        let mut out = vec![0u8; 24];
        rotate_quarter_turns(&image(), 3, 2, 1, &mut out);
        // 2 wide, 3 high. The top row is the source's left column, bottom to top.
        assert_eq!(at(&out, 2, 0, 0), (0, 1));
        assert_eq!(at(&out, 2, 1, 0), (0, 0));
        assert_eq!(at(&out, 2, 0, 2), (2, 1));
        assert_eq!(at(&out, 2, 1, 2), (2, 0));
    }

    #[test]
    fn four_quarter_turns_are_the_image_again() {
        let src = image();
        let mut a = vec![0u8; 24];
        let mut b = vec![0u8; 24];
        rotate_quarter_turns(&src, 3, 2, 1, &mut a);
        rotate_quarter_turns(&a, 2, 3, 1, &mut b);
        let mut half = vec![0u8; 24];
        rotate_quarter_turns(&src, 3, 2, 2, &mut half);
        assert_eq!(b, half, "two quarter turns are a half turn");
        rotate_quarter_turns(&b, 3, 2, 1, &mut a);
        let mut three = vec![0u8; 24];
        rotate_quarter_turns(&src, 3, 2, 3, &mut three);
        assert_eq!(a, three, "three quarter turns");
        rotate_quarter_turns(&a, 2, 3, 1, &mut b);
        assert_eq!(b, src);
    }
}
