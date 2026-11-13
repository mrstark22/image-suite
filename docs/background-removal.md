# Background removal

Phase 5 (#6): #49 chose the model, #50 made removal an edit step.

## The model

**ISNet "general use"** (Qin et al., *Highly Accurate Dichotomous Image Segmentation*, ECCV 2022), from the DIS project, licensed **Apache-2.0**, which allows free and commercial use. The ONNX export used is the one the rembg project (MIT) distributes:

- Upstream file: `https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx`, 178.6 MB, SHA-256 `60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a`.
- Served file: `isnet-general-use-fp16.onnx`, **90.7 MB** (90,661,254 bytes), SHA-256 `1e00f2f0b23dea1b687ff90652263144fdb98af942aaa0cae8630c49159b18f0`. Made by `scripts/derive-bg-model.py`: the training-only side outputs removed and the weights converted to float16 (inputs and outputs stay float32). The script is deterministic; running it on the upstream file gives the same bytes.

### Candidates compared

Run on the same images (a logo on white, a dark object on a textured light background, a cartoon portrait touching the bottom edge, a portrait photo, an apple, a cat, the Debian swirl), with the outputs looked at side by side:

| Model | Licence | Size | Result |
|---|---|---|---|
| ISNet general use, float32 | Apache-2.0 | 178.6 MB | Clean edges on every image; too large to download. |
| **ISNet general use, float16** | Apache-2.0 | **90.7 MB** | Indistinguishable from float32. Chosen. |
| ISNet general use, 8-bit dynamic quantisation | Apache-2.0 | 46.4 MB | Speckled holes in the subject and noise in the background on the portrait and the apple. Not acceptable. |
| U2-Netp | Apache-2.0 | 4.6 MB | Lost Einstein's body below the chin and most of the Debian swirl. Not acceptable. |

BiRefNet-lite (MIT) is 224 MB in float32 and 115 MB in float16, larger than ISNet for similar results on these images. MODNet is trained on portraits only. RMBG-1.4 is excluded by its non-commercial licence.

The aim was well under 50 MB. Nothing under 50 MB was good enough: the only small candidates were U2-Netp and the 8-bit ISNet, and both failed on ordinary photos. A clean result was put ahead of size. The download happens once per browser and is cached; it is said in the panel before the user starts it.

### Hosting

Self-hosted and version-pinned: the file is committed in two parts under `public/models/` (each under GitHub's 50 MB warning) and served by Vercel with a one-year immutable cache. The browser fetches both parts, joins them, checks the SHA-256 and refuses a file that does not match; the checked file is kept in IndexedDB (localForage) under a key that includes its hash. A new model must get a new file name. Only the model file is fetched; the image never leaves the browser.

ONNX Runtime Web's own WebAssembly files load from jsDelivr, pinned to the installed version, as the relief's depth model already does.

## How removal works

- **In the document**: `steps.background = { enabled, cutoff, softness }` (`src/types/document.ts`). Settings only, never pixels, so Undo and Redo treat it like any other step: one entry to apply it, one to restore it, one per slider drag.
- **The mask is derived data.** The worker renders the image as turned and cropped (without removal) at 1024 x 1024, runs ISNet once and keeps the 1024 x 1024 probability map in memory, keyed by source, turn and crop (`maskKey`, eight kept). A new crop computes a new mask; undoing back to an earlier crop reuses it. Changing the cutoff or softness does not run the model again. Masks are not saved with the document.
- **Applied inside the pipeline** (`PipelineEngine.prepare`), right after the turn and crop, so the preview, raster export at full resolution, tracing and relief all get it. Removed pixels are composited onto white, which is exactly what the pipeline's flattening of a transparent pixel gives, so "removed" means "no burn". A render that needs a mask it does not have fails; it never renders without removal.
- **Edges**: the 1024 x 1024 probability map is upsampled bilinearly to the render's size (pixel centres aligned), then mapped through a linear ramp centred on the cutoff whose width is the softness. The interpolated field is smooth, so the ramp places the edge on the model's contour to a fraction of a mask pixel (Rust test: a disk's radius is kept to 0.15 mask pixels after 8x upsampling) instead of making blocks. The default softness, 60 %, keeps the model's own soft transition on hair and fur and is still crisp on logos, whose probabilities are close to 0 or 1. The compositing is in the Rust core (`src/wasm/src/matte.rs`).
- **Input**: the image is resampled to 1024 x 1024 by the pipeline's own resampler (aspect ratio is not kept; ISNet was trained that way) and normalised as `x / 255 - 0.5`, ISNet's training normalisation. The output is ISNet's sigmoid, used as is.

## The panel

**Remove Background** runs the model and shows the result without applying it: *Removed area* (the image with what will be removed tinted red), *Result* (on a checkerboard) and *Original*, with the share removed. Progress shows the download in megabytes and percent, then checking, starting and running the model. **Apply Removal** makes it an edit; **Restore Background** turns it off. If the model cannot be downloaded or run, the error is shown and the image is not changed.

On the WebAssembly backend in Chrome on this sandbox's machine one run took about 7 s (threads enabled by cross-origin isolation); single-threaded in Node it took 16 s. WebGPU is used when the browser has it.

## Not done

- Keep and remove brushes for manual refinement (#50 says they can follow later).
- A guided-filter refinement of the edge from the full-resolution image; the bilinear upsampling and ramp are used instead.
- Measured timings on a phone.
