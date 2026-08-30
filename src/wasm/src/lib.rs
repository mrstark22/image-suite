//! Image Suite WebAssembly Core Module in Pure Native Rust
//! High-performance image processing, tonal LUT, CLAHE, adaptive thresholding,
//! sharpening, advanced dithering, vectorization, and 3D depth/heightmap relief for precision manufacturing.

mod clahe;
mod depth;
mod dither;
mod sharpen;
mod threshold;
mod tonal;
mod vector;

use clahe::apply_clahe;
use depth::{generate_depth_map_wasm, DepthParams};
use dither::{apply_dithering, DitherAlgo, DitherParams};
use sharpen::apply_unsharp_mask;
use threshold::apply_adaptive_threshold;
use tonal::{apply_tonal_and_color, ColorParams, TonalParams};
use vector::{vectorize_to_json_string, VectorConfig};

#[allow(static_mut_refs)]
static mut LAST_JSON_BUF: Vec<u8> = Vec::new();

#[allow(static_mut_refs)]
static mut LAST_DEPTH_BUF: Vec<u16> = Vec::new();

/// Allocates linear memory buffer for image pixels
#[no_mangle]
pub extern "C" fn allocate(size: usize) -> *mut u8 {
    let mut buffer = Vec::with_capacity(size);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// Deallocates linear memory buffer
#[no_mangle]
pub extern "C" fn deallocate(ptr: *mut u8, size: usize) {
    if !ptr.is_null() && size > 0 {
        unsafe {
            let _ = Vec::from_raw_parts(ptr, 0, size);
        }
    }
}

/// Full raster processing pipeline executed on Wasm linear memory
#[no_mangle]
pub extern "C" fn process_pipeline(
    ptr: *mut u8,
    width: usize,
    height: usize,
    // Tonal
    exposure: f32,
    brightness: f32,
    contrast: f32,
    midtones: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    clarity: f32,
    gamma: f32,
    black_point: u32,
    white_point: u32,
    invert: u32,
    grayscale_mode: u32,
    // Color
    saturation: f32,
    vibrance: f32,
    temperature: f32,
    tint: f32,
    // CLAHE
    enable_clahe: u32,
    clahe_clip: f32,
    clahe_grid: usize,
    // Adaptive Threshold
    enable_adaptive: u32,
    adaptive_block: usize,
    adaptive_c: f32,
    // Sharpen
    sharpen_amount: f32,
    sharpen_radius: f32,
    // Dither
    dither_algo_code: u32,
    dither_thresh: u32,
    dither_serpentine: u32,
    dither_scale: usize,
    dither_dot_angle: f32,
    dither_inverted: u32,
) {
    if ptr.is_null() || width == 0 || height == 0 {
        return;
    }

    let size = width * height * 4;
    let pixels = unsafe { std::slice::from_raw_parts_mut(ptr, size) };

    // 1. Tonal & Color
    let tonal = TonalParams {
        exposure,
        brightness,
        contrast,
        midtones,
        highlights,
        shadows,
        whites,
        blacks,
        clarity,
        gamma,
        black_point: black_point as u8,
        white_point: white_point as u8,
        invert: invert != 0,
        grayscale_mode: grayscale_mode as u8,
    };
    let color = ColorParams {
        saturation,
        vibrance,
        temperature,
        tint,
    };
    apply_tonal_and_color(pixels, width, height, &tonal, &color);

    // 2. CLAHE
    if enable_clahe != 0 {
        apply_clahe(pixels, width, height, clahe_clip, clahe_grid);
    }

    // 3. Adaptive Thresholding
    if enable_adaptive != 0 {
        apply_adaptive_threshold(pixels, width, height, adaptive_block, adaptive_c);
    }

    // 4. Sharpening
    if sharpen_amount > 0.0 {
        apply_unsharp_mask(pixels, width, height, sharpen_amount, sharpen_radius);
    }

    // 5. Dithering
    let algo = match dither_algo_code {
        1 => DitherAlgo::FloydSteinberg,
        2 => DitherAlgo::Atkinson,
        3 => DitherAlgo::Jarvis,
        4 => DitherAlgo::Bayer2,
        5 => DitherAlgo::Bayer4,
        6 => DitherAlgo::Bayer8,
        7 => DitherAlgo::BlueNoise,
        8 => DitherAlgo::Ostromoukhov,
        9 => DitherAlgo::Riemersma,
        10 => DitherAlgo::KnuthDot,
        11 => DitherAlgo::HalftoneDot,
        _ => DitherAlgo::None,
    };

    if !matches!(algo, DitherAlgo::None) {
        let dither_params = DitherParams {
            algorithm: algo,
            threshold: dither_thresh as u8,
            serpentine: dither_serpentine != 0,
            matrix_scale: dither_scale,
            dot_angle: dither_dot_angle,
            inverted_burn: dither_inverted != 0,
        };
        apply_dithering(pixels, width, height, &dither_params);
    }
}

/// Full vectorization pipeline executed in Rust WebAssembly
#[no_mangle]
pub extern "C" fn process_vector(
    ptr: *const u8,
    width: usize,
    height: usize,
    mode: u32,
    color_count: usize,
    threshold: u32,
    rdp_tolerance: f32,
    curve_fitting: u32,
    min_path_area: f32,
    denoise: f32,
    canny_low: f32,
    canny_high: f32,
    invert: u32,
    bezier_tolerance: f32,
) -> *const u8 {
    if ptr.is_null() || width == 0 || height == 0 {
        return std::ptr::null();
    }

    let size = width * height * 4;
    let pixels = unsafe { std::slice::from_raw_parts(ptr, size) };

    let cfg = VectorConfig {
        mode,
        color_count,
        threshold: threshold as u8,
        rdp_tolerance,
        curve_fitting: curve_fitting != 0,
        min_path_area,
        denoise,
        canny_low,
        canny_high,
        invert: invert != 0,
        bezier_tolerance,
    };

    let json = vectorize_to_json_string(pixels, width, height, &cfg);

    #[allow(static_mut_refs)]
    unsafe {
        LAST_JSON_BUF = json.into_bytes();
        LAST_JSON_BUF.as_ptr()
    }
}

/// Returns the byte length of the last generated vector JSON buffer
#[no_mangle]
pub extern "C" fn get_vector_json_len() -> usize {
    #[allow(static_mut_refs)]
    unsafe {
        LAST_JSON_BUF.len()
    }
}

/// 3D Depth Map & Heightmap Relief pipeline executed in Rust WebAssembly
#[no_mangle]
pub extern "C" fn process_depth(
    ptr: *const u8,
    width: usize,
    height: usize,
    source_mode: u32,
    bevel_style: u32,
    invert_z: u32,
    smoothing_radius: f32,
    depth_scale: f32,
    relief_angle: f32,
) -> *const u16 {
    if ptr.is_null() || width == 0 || height == 0 {
        return std::ptr::null();
    }

    let size = width * height * 4;
    let pixels = unsafe { std::slice::from_raw_parts(ptr, size) };

    let params = DepthParams {
        source_mode,
        bevel_style,
        invert_z: invert_z != 0,
        smoothing_radius,
        depth_scale,
        relief_angle,
    };

    let depth16 = generate_depth_map_wasm(pixels, width, height, &params);

    #[allow(static_mut_refs)]
    unsafe {
        LAST_DEPTH_BUF = depth16;
        LAST_DEPTH_BUF.as_ptr()
    }
}

/// Returns the element count (u16 items) of the last generated depth buffer
#[no_mangle]
pub extern "C" fn get_depth_buf_len() -> usize {
    #[allow(static_mut_refs)]
    unsafe {
        LAST_DEPTH_BUF.len()
    }
}
