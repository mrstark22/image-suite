//! Image Suite WebAssembly Core Module in Pure Native Rust
//! High-performance image processing, tonal LUT, CLAHE, adaptive thresholding,
//! sharpening, dithering, tracing, and 3D depth/heightmap relief for precision manufacturing.

// The exported functions are a C ABI called from JavaScript with pointers into
// this module's own linear memory. They cannot be marked `unsafe` without
// changing how the host calls them, so the pointer checks live at the top of
// each function instead.
#![allow(clippy::not_unsafe_ptr_arg_deref)]

mod clahe;
mod depth;
mod dither;
mod resample;
mod rotate;
mod sharpen;
mod threshold;
mod tonal;
mod trace;

#[cfg(test)]
mod tests;

use clahe::apply_clahe;
use depth::{generate_depth_map_wasm, DepthParams};
use dither::{apply_dithering, DitherAlgo, DitherParams};
use resample::{prepare, Crop};
use sharpen::apply_unsharp_mask;
use threshold::apply_adaptive_threshold;
use tonal::{apply_tonal_and_color, ColorParams, TonalParams};
use trace::{PaletteEntry, Shapes, TraceConfig};

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

/// Reserves `size` bytes, or returns null when the memory cannot be had.
/// Unlike `allocate`, running out of memory does not trap, so the caller can
/// report it and keep using the module. Free with `deallocate`.
#[no_mangle]
pub extern "C" fn try_allocate(size: usize) -> *mut u8 {
    let mut buffer: Vec<u8> = Vec::new();
    if size == 0 || buffer.try_reserve_exact(size).is_err() {
        return std::ptr::null_mut();
    }
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// Steps 1 to 3 of the pipeline: crops the RGBA8 source to the rectangle
/// (`crop_x`, `crop_y`, `crop_w`, `crop_h`), flattens it onto white and
/// resamples it to `dst_w` x `dst_h` in linear light. Returns a new opaque
/// RGBA8 buffer of `dst_w * dst_h * 4` bytes that the caller frees with
/// `deallocate`, or null when the arguments are invalid or the memory cannot
/// be had.
#[no_mangle]
pub extern "C" fn prepare_source(
    src: *const u8,
    src_w: usize,
    src_h: usize,
    crop_x: usize,
    crop_y: usize,
    crop_w: usize,
    crop_h: usize,
    dst_w: usize,
    dst_h: usize,
) -> *mut u8 {
    let valid = !src.is_null()
        && crop_w > 0
        && crop_h > 0
        && dst_w > 0
        && dst_h > 0
        && crop_x + crop_w <= src_w
        && crop_y + crop_h <= src_h;
    if !valid {
        return std::ptr::null_mut();
    }
    let out_len = dst_w * dst_h * 4;
    let out_ptr = try_allocate(out_len);
    if out_ptr.is_null() {
        return out_ptr;
    }
    let source = unsafe { std::slice::from_raw_parts(src, src_w * src_h * 4) };
    let out = unsafe { std::slice::from_raw_parts_mut(out_ptr, out_len) };
    let crop = Crop {
        x: crop_x,
        y: crop_y,
        width: crop_w,
        height: crop_h,
    };
    prepare(source, src_w, crop, dst_w, dst_h, out);
    out_ptr
}

/// Rotates the RGBA8 image at `src` (`w` x `h`) clockwise by `turns` quarter
/// turns into a new buffer, which the caller frees with `deallocate`: `h` x `w`
/// for an odd number of turns, `w` x `h` otherwise (#65). Returns null when
/// the memory cannot be had.
#[no_mangle]
pub extern "C" fn rotate_quarter_turns(src: *const u8, w: usize, h: usize, turns: u32) -> *mut u8 {
    if src.is_null() || w == 0 || h == 0 {
        return std::ptr::null_mut();
    }
    let len = w * h * 4;
    let out_ptr = try_allocate(len);
    if out_ptr.is_null() {
        return out_ptr;
    }
    let source = unsafe { std::slice::from_raw_parts(src, len) };
    let out = unsafe { std::slice::from_raw_parts_mut(out_ptr, len) };
    rotate::rotate_quarter_turns(source, w, h, turns, out);
    out_ptr
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

    // 3. Sharpening, before the threshold so it can change what is thresholded.
    if sharpen_amount > 0.0 {
        apply_unsharp_mask(pixels, width, height, sharpen_amount, sharpen_radius);
    }

    // 4. Adaptive Thresholding
    if enable_adaptive != 0 {
        apply_adaptive_threshold(pixels, width, height, adaptive_block, adaptive_c);
    }

    // 5. Dithering
    let algo = match dither_algo_code {
        1 => DitherAlgo::FloydSteinberg,
        2 => DitherAlgo::Atkinson,
        3 => DitherAlgo::Jarvis,
        4 => DitherAlgo::Bayer2,
        5 => DitherAlgo::Bayer4,
        6 => DitherAlgo::Bayer8,
        _ => DitherAlgo::None,
    };

    if !matches!(algo, DitherAlgo::None) {
        let dither_params = DitherParams {
            algorithm: algo,
            threshold: dither_thresh as u8,
            serpentine: dither_serpentine != 0,
            matrix_scale: dither_scale,
            inverted_burn: dither_inverted != 0,
        };
        apply_dithering(pixels, width, height, &dither_params);
    }
}

/// Traces the RGBA8 image at `ptr` (`width` x `height`) to vector paths and
/// returns them as JSON (see `trace::to_json`); its length is given by
/// `get_trace_json_len`. Lengths are in millimetres, converted with
/// `px_per_mm`, the image's pixels per millimetre.
///
/// `palette` points at `palette_len` entries of 4 bytes each (red, green,
/// blue, and the index of the entry whose layer the colour joins, or 255 to
/// leave it out); with `palette_len` 0 the colours are found with k-means.
#[no_mangle]
pub extern "C" fn process_trace(
    ptr: *const u8,
    width: usize,
    height: usize,
    px_per_mm: f64,
    colour_mode: u32,
    shapes: u32,
    threshold: f32,
    invert: u32,
    colour_count: u32,
    palette: *const u8,
    palette_len: usize,
    tolerance_mm: f64,
    corner_angle_deg: f64,
    max_stroke_mm: f64,
    min_area_mm2: f64,
    denoise_mm: f64,
    cutline_mm: f64,
) -> *const u8 {
    if ptr.is_null() || width == 0 || height == 0 || !(px_per_mm > 0.0) {
        return std::ptr::null();
    }
    let palette = if palette.is_null() || palette_len == 0 {
        Vec::new()
    } else {
        let bytes = unsafe { std::slice::from_raw_parts(palette, palette_len * 4) };
        bytes
            .chunks_exact(4)
            .map(|e| PaletteEntry {
                rgb: [e[0], e[1], e[2]],
                target: if e[3] == 255 {
                    None
                } else {
                    Some(e[3] as usize)
                },
            })
            .collect()
    };
    let cfg = TraceConfig {
        colour: colour_mode != 0,
        shapes: match shapes {
            1 => Shapes::Outline,
            2 => Shapes::Centreline,
            _ => Shapes::Auto,
        },
        threshold,
        invert: invert != 0,
        colour_count: colour_count as usize,
        palette,
        px_per_mm,
        tolerance_mm,
        corner_angle_deg,
        max_stroke_mm,
        min_area_mm2,
        denoise_mm,
        cutline_mm,
    };
    // Refuse an image this device cannot hold before starting, rather than
    // running out of memory part way, which would trap the module.
    let need = trace::memory_estimate(width, height, &cfg);
    let mut probe: Vec<u8> = Vec::new();
    let json = if need.is_none_or(|bytes| probe.try_reserve_exact(bytes).is_err()) {
        let bytes = need.map_or(u64::MAX, |b| b as u64);
        format!("{{\"error\":\"memory\",\"bytes\":{bytes}}}")
    } else {
        drop(probe);
        let pixels = unsafe { std::slice::from_raw_parts(ptr, width * height * 4) };
        trace::OUT_OF_MEMORY.store(false, std::sync::atomic::Ordering::Relaxed);
        let result = trace::trace(pixels, width, height, &cfg);
        if trace::OUT_OF_MEMORY.load(std::sync::atomic::Ordering::Relaxed) {
            format!("{{\"error\":\"memory\",\"bytes\":{}}}", need.unwrap_or(0))
        } else {
            trace::to_json(&result)
        }
    };

    #[allow(static_mut_refs)]
    unsafe {
        LAST_JSON_BUF = json.into_bytes();
        LAST_JSON_BUF.as_ptr()
    }
}

/// Returns the byte length of the JSON written by the last `process_trace`.
#[no_mangle]
pub extern "C" fn get_trace_json_len() -> usize {
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
