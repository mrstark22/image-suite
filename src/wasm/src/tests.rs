//! Native unit tests for the processing core, run with `cargo test`.
//!
//! The fuller property tests drive the compiled WebAssembly from
//! `tests/unit/*.test.ts`; these cover the same ground natively so a logic
//! error shows up without a WASM build.

use crate::dither::{apply_dithering, DitherAlgo, DitherParams};
use crate::threshold::apply_adaptive_threshold;
use crate::tonal::{compute_tonal_lut, TonalParams};

fn gray_image(width: usize, height: usize, f: impl Fn(usize, usize) -> u8) -> Vec<u8> {
    let mut px = vec![255u8; width * height * 4];
    for y in 0..height {
        for x in 0..width {
            let v = f(x, y);
            let i = (y * width + x) * 4;
            px[i] = v;
            px[i + 1] = v;
            px[i + 2] = v;
        }
    }
    px
}

fn white_fraction(px: &[u8]) -> f32 {
    let n = px.len() / 4;
    let white = (0..n).filter(|&i| px[i * 4] == 255).count();
    white as f32 / n as f32
}

fn default_tonal() -> TonalParams {
    TonalParams {
        exposure: 0.0,
        brightness: 0.0,
        contrast: 0.0,
        midtones: 0.0,
        highlights: 0.0,
        shadows: 0.0,
        whites: 0.0,
        blacks: 0.0,
        clarity: 0.0,
        gamma: 1.0,
        black_point: 0,
        white_point: 255,
        invert: false,
        grayscale_mode: 0,
    }
}

fn dither(px: &mut [u8], w: usize, h: usize, algorithm: DitherAlgo) {
    let params = DitherParams {
        algorithm,
        serpentine: true,
        matrix_scale: 1,
    };
    apply_dithering(px, w, h, &params, None);
}

fn all_algorithms() -> Vec<DitherAlgo> {
    vec![
        DitherAlgo::FloydSteinberg,
        DitherAlgo::Atkinson,
        DitherAlgo::Jarvis,
        DitherAlgo::Bayer2,
        DitherAlgo::Bayer4,
        DitherAlgo::Bayer8,
        DitherAlgo::BlueNoise,
    ]
}

#[test]
fn tonal_lut_is_identity_at_defaults() {
    let lut = compute_tonal_lut(&default_tonal());
    for (i, &v) in lut.iter().enumerate() {
        assert_eq!(v as usize, i);
    }
}

#[test]
fn tonal_lut_inverts() {
    let mut params = default_tonal();
    params.invert = true;
    let lut = compute_tonal_lut(&params);
    for (i, &v) in lut.iter().enumerate() {
        assert_eq!(v as usize, 255 - i);
    }
}

#[test]
fn error_diffusion_preserves_tone() {
    for gray in [32u8, 96, 128, 160, 224] {
        for algorithm in [
            DitherAlgo::FloydSteinberg,
            DitherAlgo::Jarvis,
            DitherAlgo::BlueNoise,
        ] {
            let mut px = gray_image(128, 128, |_, _| gray);
            dither(&mut px, 128, 128, algorithm);
            let error = (white_fraction(&px) - gray as f32 / 255.0).abs();
            assert!(error <= 0.01, "grey {gray}: density error {error}");
        }
    }
}

#[test]
fn dithers_leave_pure_white_and_black_clean() {
    for algorithm in all_algorithms() {
        let mut white = gray_image(48, 48, |_, _| 255);
        dither(&mut white, 48, 48, algorithm);
        assert_eq!(white_fraction(&white), 1.0);
    }
    for algorithm in all_algorithms() {
        let mut black = gray_image(48, 48, |_, _| 0);
        dither(&mut black, 48, 48, algorithm);
        assert_eq!(white_fraction(&black), 0.0);
    }
}

#[test]
fn dither_output_is_binary_and_keeps_alpha() {
    for algorithm in all_algorithms() {
        let mut px = gray_image(13, 17, |x, y| ((x + y) * 9) as u8);
        for i in 0..13 * 17 {
            px[i * 4 + 3] = 200;
        }
        dither(&mut px, 13, 17, algorithm);
        for i in 0..13 * 17 {
            let v = px[i * 4];
            assert!(v == 0 || v == 255);
            assert_eq!(px[i * 4 + 1], v);
            assert_eq!(px[i * 4 + 2], v);
            assert_eq!(px[i * 4 + 3], 200);
        }
    }
}

#[test]
fn adaptive_threshold_turns_a_flat_image_white() {
    let mut px = gray_image(40, 40, |_, _| 100);
    apply_adaptive_threshold(&mut px, 40, 40, 15, 2.0);
    assert_eq!(white_fraction(&px), 1.0);
}

#[test]
fn tone_only_fast_path_matches_the_table_for_every_value() {
    use crate::tonal::{apply_tonal_and_color, ColorParams};
    let tonal = TonalParams {
        contrast: 35.0,
        shadows: -20.0,
        gamma: 1.3,
        black_point: 9,
        ..default_tonal()
    };
    let lut = compute_tonal_lut(&tonal);
    // Every value in every channel, with distinct values per channel.
    let mut px: Vec<u8> = (0..256u32)
        .flat_map(|v| [v as u8, (255 - v) as u8, (v * 7 % 256) as u8, 200])
        .collect();
    let before = px.clone();
    let none = ColorParams {
        saturation: 0.0,
        vibrance: 0.0,
        temperature: 0.0,
        tint: 0.0,
    };
    apply_tonal_and_color(&mut px, 256, 1, &tonal, &none);
    for (out, inp) in px.chunks(4).zip(before.chunks(4)) {
        assert_eq!(out[0], lut[inp[0] as usize]);
        assert_eq!(out[1], lut[inp[1] as usize]);
        assert_eq!(out[2], lut[inp[2] as usize]);
        assert_eq!(out[3], inp[3], "alpha untouched");
    }
}

#[test]
fn positive_clarity_steepens_midtones() {
    for (clarity, steeper) in [(100.0, true), (-100.0, false)] {
        let mut params = default_tonal();
        params.clarity = clarity;
        let lut = compute_tonal_lut(&params);
        let slope = (lut[138] as f32 - lut[118] as f32) / 20.0;
        assert_eq!(slope > 1.0, steeper, "clarity {clarity}: slope {slope}");
    }
}

#[test]
fn clahe_keeps_white_white_and_flat_flat_at_any_size() {
    use crate::clahe::apply_clahe;
    for (w, h) in [(400, 300), (37, 53), (2048, 1365), (5, 3)] {
        for grid in [1, 7, 8, 24] {
            let mut white = gray_image(w, h, |_, _| 255);
            apply_clahe(&mut white, w, h, 2.5, grid);
            assert_eq!(white_fraction(&white), 1.0, "{w}x{h} grid {grid}");
            let mut grey = gray_image(w, h, |_, _| 128);
            apply_clahe(&mut grey, w, h, 2.5, grid);
            let first = grey[0];
            assert!(
                (0..w * h).all(|i| grey[i * 4] == first),
                "{w}x{h} grid {grid} not flat"
            );
        }
    }
}

#[test]
fn tone_response_keeps_white_and_black_and_inverts_the_curve() {
    use crate::dither::tone_response_lut;
    // A material that darkens quickly: half power already gives 80% darkness.
    let curve = [0.0, 0.8, 0.9, 1.0];
    let lut = tone_response_lut(&curve).unwrap();
    assert_eq!(lut[255], 255);
    assert_eq!(lut[0], 0);
    // Asking for 40% darkness (value 153) needs only a light burn: well above 153.
    assert!(lut[153] > 200, "lut[153] = {}", lut[153]);
    assert!(lut.windows(2).all(|p| p[0] <= p[1]));
}

#[test]
fn burn_simulation_grows_dots_with_spot_size() {
    use crate::burn_sim::simulate_burn;
    let mut small = gray_image(9, 9, |x, y| if x == 4 && y == 4 { 0 } else { 255 });
    let mut big = small.clone();
    simulate_burn(&mut small, 9, 9, 1.0, [255, 255, 255], [0, 0, 0]);
    simulate_burn(&mut big, 9, 9, 2.5, [255, 255, 255], [0, 0, 0]);
    let darkness = |p: &[u8]| (0..81).map(|i| 255 - p[i * 4] as u32).sum::<u32>();
    assert!(darkness(&big) > darkness(&small));
    // A neighbour of the dot is touched only by the larger spot.
    assert_eq!(small[(4 * 9 + 5) * 4], 255);
    assert!(big[(4 * 9 + 5) * 4] < 255);
}

#[test]
fn prepared_histogram_counts_each_channel_and_luma() {
    use crate::prepared_histogram;
    // Two mid-grey pixels and one pure red one.
    let px = [128, 128, 128, 255, 128, 128, 128, 255, 255, 0, 0, 255];
    let bins = prepared_histogram(&px);
    assert_eq!(bins[128], 2);
    assert_eq!(bins[255], 1);
    assert_eq!(bins[256 + 128], 2);
    assert_eq!(bins[256], 1);
    assert_eq!(bins[768 + 128], 2);
    // Red's Rec. 709 luma: 0.2126 * 255 = 54.2.
    assert_eq!(bins[768 + 54], 1);
    assert_eq!(bins[768..].iter().sum::<u32>(), 3);
}
