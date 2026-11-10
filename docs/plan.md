# Image Suite — Plan

Status: draft for review, 2026-11-10. Supersedes the feature list in `overview.md`.

## Goal

A browser tool that does two jobs well, entirely client-side:

1. **Image to clean vector.** Turn a logo, drawing or scan into paths worth sending to a laser or CNC.
2. **Photo to engrave-ready image.** Turn a photograph into a file that burns well on a given material at a given size, without dozens of test burns.

Background removal is a shared preparation step for both.

Output target: LightBurn. The tool does its own dithering and hands LightBurn a finished 1-bit image to run in Pass-Through mode, so LightBurn neither resamples nor dithers it.

## What "good" means

These come from the problems that motivated the project. Each becomes an automated test where possible.

### Vector

| Complaint | Requirement |
|---|---|
| A drawn line becomes two vectors, inside and outside | Thin strokes trace as a single centre path. Automatic per shape: strokes get a centreline, filled areas get an outline. A ring drawn with a pen comes out as one closed path. |
| Lumpy curves | Curves are fitted to a sub-pixel boundary, not the pixel staircase. A circle traces to within a small fraction of a pixel of a true circle; straight edges come out as straight lines; corners stay sharp. |
| Poor boundary detection | Edges are placed using the anti-aliased gradient, so the path sits where the eye sees the edge. |
| Poor colour tracing | Colours are separated in a perceptual colour space, anti-alias fringe pixels do not become sliver layers, and the user can merge or pick colours. |
| Too many nodes | Minor. Simplification tolerance is given in millimetres. |

### Photo

| Complaint | Requirement |
|---|---|
| ~30 test burns to find speed, power, dither and quality | One structured calibration burn per material, saved as a profile and reused. See "Calibration" for what this can and cannot remove. |
| LightBurn's dithering is poor | Dithering is done here, at the machine's exact dot pitch, and exported 1-bit with the correct DPI so LightBurn passes it through untouched. |
| The burn does not match the screen | The preview simulates the burn (dot size and material tone response), not just the pixels. |

## Scope

### Keep (measured as correct in the November audit)

- Tonal LUT maths (`src/lib/fast-tonal.ts`, `src/wasm/src/tonal.rs`), except the clarity term.
- Floyd-Steinberg, Jarvis-Judice-Ninke, Atkinson and Bayer dithers (`src/wasm/src/dither.rs`).
- Outline tracer on clean shapes: exact coordinates, correct holes (`src/wasm/src/vector.rs`).
- 16-bit PNG and BMP encoders (`src/lib/png-encoder.ts`, `src/lib/bmp-encoder.ts`).
- WASM bridge allocation and free (`src/wasm/wasm-bridge.ts`).
- Adaptive threshold and unsharp mask.
- Adjustments undo/redo core (`src/store/editStore.ts`).
- UI shell: panels, sliders, dialogs, styling.

### Drop for now

- 3D depth maps and the 3D viewer.
- "AI depth" and the current flood-fill background removal.
- Scene graph, drawing tools (pen, node, shape, text), grouping, booleans, project file.
- CAM, toolpaths, G-code. The `.lbrn2` exporter writes an invented JSON format, not LightBurn's.
- Multi-layer compositing, unless a workflow turns out to need it.
- WebGPU dither path and the divergent JavaScript fallbacks.
- Mislabeled algorithms: "blue noise" (a hash), "Riemersma" (no Hilbert curve), "Knuth dot diffusion" (a threshold screen), "Ostromoukhov" (invented weights), halftone (tone error up to 25 points). They return only as real implementations.
- Batch processing.

Dropped code is deleted, not hidden. It stays in git history.

## Architecture

The audit's main finding: there is no single document that a pipeline can render at any resolution in real units. Export, tracing and the viewport each read the 2048px preview buffer in their own way. The rebuild fixes that once.

- **Document.** The original image at full resolution, the intended physical size, and an ordered list of edit steps. One source of truth for size and DPI.
- **Pipeline.** A pure function of (document, target resolution). The preview and the export call the same code with different targets. Parameters measured in pixels (radii, block sizes) are stored in millimetres and converted per run.
- **Units.** Millimetres internally for anything physical. Pixels exist only inside a pipeline run.
- **Transparency.** Flattened onto white ("no burn") at the start of the pipeline, in one place.
- **Workers.** All pipeline runs stay off the main thread. Each run carries a document version; results from an older version are discarded.

## Workflow A: image to vector

1. **Prepare.** Work from the full-resolution original. Optional background removal. Edge-preserving denoise only when asked.
2. **Segment.** Black and white, or colour. Colour uses a perceptual space with k-means++ seeding; fringe pixels are assigned to a neighbouring region.
3. **Classify each shape.** Using the distance transform: thin and roughly constant width means stroke, otherwise fill. Modes: Auto, Outline only, Centreline only.
4. **Trace.**
   - Fills: sub-pixel boundary from the anti-aliased field (marching squares), not pixel-edge following.
   - Strokes: skeleton built into a graph of junctions and ends, short spurs pruned, junctions joined, loops closed, centred to sub-pixel.
5. **Fit.** Corner detection, then least-squares cubic Bezier fitting with smooth joins between corners. Straight runs become lines. Tolerance in millimetres.
6. **Export.** SVG in millimetres and DXF with units declared, both at the document's physical size.

Tests use synthetic shapes with known geometry: circle radius error, ring to one closed path, T-junction connected, hairline survives, square corners exact, exported width in millimetres.

## Workflow B: photo to engrave-ready

1. **Size first.** The user gives the physical size and the machine's line interval. The pipeline resamples the original to exactly that dot grid; one image pixel equals one laser dot.
2. **Adjust.** Existing tonal controls, with clarity and CLAHE fixed.
3. **Material tone curve.** Applied from the selected material profile.
4. **Dither.** The four kept algorithms, then a real blue-noise mask (precomputed void-and-cluster). Others only if they earn their place in burn tests.
5. **Preview.** Simulated burn using the profile's dot size and tone response.
6. **Export.** 1-bit PNG or BMP with DPI metadata, plus the LightBurn settings to use (Pass-Through, line interval, and the profile's speed and power).

Tests: mean output density matches input tone per algorithm; exported pixel dimensions equal size times DPI; DPI metadata present; pure white and pure black stay clean.

### Calibration

Test burns cannot be removed, because power and speed depend on the physical material and machine. The aim is to collapse them to one or two structured burns per material and never repeat them.

- **Card 1, power and speed.** A grid where each cell is a short tone ramp. The user picks the cell with solid blacks, no charring and a visible lightest step.
- **Card 2, tone response (optional).** A fine ramp at the chosen setting. The user marks where steps stop being distinguishable, by eye or from a photo of the card. This becomes the material's tone curve.
- **Profile.** Material, machine, line interval, speed, power, dot size, tone curve. Stored locally, exportable as a file.

The existing test-grid generator (`src/lib/test-grid-generator.ts`) is the starting point. How cards carry per-cell power and speed into LightBurn is an open question below.

## Background removal

A real segmentation model run in the browser, replacing the flood fill. The model file is self-hosted and version-pinned, download progress is shown, and failure is reported, never silently replaced by a heuristic. Model choice depends on a licence check.

## Phases

0. **Safety net.** CI running typecheck, Vitest and Rust tests. Property tests for every kept piece. Delete dropped code.
1. **Core.** Document, pipeline, units, transparency. Full-resolution export with correct physical size.
2. **Photo workflow.** Device-grid resampling, clarity and CLAHE fixes, real blue noise, 1-bit export, material profiles and calibration cards.
3. **Vector workflow.** Segmentation, sub-pixel boundaries, stroke and fill classification, centreline, curve fitting, export in real units.
4. **Background removal.**

Phases 2 and 3 are independent after phase 1 and can swap.

## Known defects in kept code

To fix as each piece is ported. Verified in the audit unless marked.

- Clarity is inverted: positive values flatten midtones (`src/lib/fast-tonal.ts:180`, `src/wasm/src/tonal.rs:93`).
- CLAHE darkens the bottom and right bands when the image is not divisible by the grid (`src/wasm/src/clahe.rs`). Reported, reproduced by the audit.
- The dither threshold slider is a brightness bias that speckles pure white and black (`src/wasm/src/dither.rs:68`). Reported.
- Screen angle 0 renders as 45 (`src/workers/imageWorker.ts`). Reported.
- Tracing uses the unprocessed preview, ignoring adjustments (`src/hooks/useWorker.ts:180`).
- K-means seeds from evenly spaced pixel positions, which often coincide (`src/wasm/src/vector.rs:843`).
- "Optimize & Smooth Nodes" throws on WASM trace output (`src/lib/vector-smoother.ts:27`).
- Tracing stops silently at 4,000 contours (`src/wasm/src/vector.rs:153`). Reported.
- Checkboxes, preset chips and reset buttons in the adjustments panel are not undoable. Reported.
- Stale worker results can overwrite the current preview (`src/hooks/useWorker.ts`). Reported.
- Existing tests check output shape, not correctness.

## Open questions

- Machine type, line interval and typical materials.
- Which workflow hurts more, to decide whether phase 2 or 3 goes first.
- Whether calibration cards should be exported as a real LightBurn project with per-cell power and speed, or as an image used with LightBurn's own material test.
- Background removal model and its licence.
- Whether to keep the stale `.agents/AGENTS.md` wording (wasm-pack, visual regression tests) or update it to match this plan.
