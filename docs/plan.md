# Image Suite — Plan

Status: draft for review, 2026-11-10. Supersedes the feature list in `overview.md`.

## Goal

A browser tool that does three jobs well. All image processing happens in the browser and images are never uploaded:

1. **Image to clean vector.** Turn a logo, drawing or scan into paths worth sending to a laser or CNC. This is the most-used workflow and the biggest frustration, so it goes first.
2. **Photo to engrave-ready image.** Turn a photograph into a file that burns well on a given material at a given size, without dozens of test burns.
3. **Image to 3D relief.** Turn a photo or logo into a heightmap for relief engraving, where the exported file matches what the screen shows.

Background removal is a shared preparation step. Calibration profiles, saved per machine and material, are shared by workflows 2 and 3.

Machines in use: a 60 W and a 155 W CO2 laser, with a diode laser possible later. They behave very differently, so nothing is calibrated per material alone.

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

### Relief

| Complaint | Requirement |
|---|---|
| Export does not match the screen | One heightmap is computed and both the 3D view and the export read it. Every control that changes the view changes the file, or is labelled as view-only. |
| No way to calibrate depth | A depth calibration card per machine and material, so a grey value maps to a known depth. |
| Options that do nothing | Every control is honoured in every mode, or removed. |

## Scope

### Keep (measured as correct in the November audit)

- Tonal LUT maths (`src/lib/fast-tonal.ts`, `src/wasm/src/tonal.rs`), except the clarity term.
- Floyd-Steinberg, Jarvis-Judice-Ninke, Atkinson and Bayer dithers (`src/wasm/src/dither.rs`).
- Outline tracer on clean shapes: exact coordinates, correct holes (`src/wasm/src/vector.rs`).
- 16-bit PNG and BMP encoders (`src/lib/png-encoder.ts`, `src/lib/bmp-encoder.ts`).
- WASM bridge allocation and free (`src/wasm/wasm-bridge.ts`).
- Adaptive threshold and unsharp mask.
- Adjustments undo/redo core (`src/store/editStore.ts`).
- Relief numeric core (`src/wasm/src/depth.rs`, `src/lib/depth-engine.ts`): heights stay floating point through to 16-bit, Gaussian smoothing, invert, and the shading model shared by `depth-shader.ts` and the viewer.
- 3D viewer (`src/components/canvas/DepthViewer3D.tsx`), with its resource handling fixed.
- UI structure and behaviour of the panels, sliders and dialogs. Their styling and layout are replaced by the UI redesign.

### Drop for now

- The current flood-fill background removal, and the silent luminance heuristic that stands in for AI depth when the model fails.
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

## Workflow C: image to 3D relief

1. **Source.** A photo (depth estimated by a model), a logo or vector shape (bevel from a distance transform), or a tonal image used directly as height.
2. **Shape.** Depth range, smoothing, invert and bevel profile. All of them change the heightmap itself.
3. **Depth curve.** Applied from the selected calibration, so equal steps in the heightmap give equal steps in real depth.
4. **Preview.** The 3D view renders the same heightmap the export writes, at real proportions for the chosen physical size and maximum depth. Lighting controls are view-only and labelled so.
5. **Export.** Heightmap at full resolution for the chosen size, with the LightBurn settings to use.

Changes from the current code:

- One heightmap buffer feeds both viewer and export. Today `depthScale` changes only shading, and smoothing is skipped in AI mode.
- Depth estimation model is self-hosted and version-pinned, shows download progress, and reports failure instead of substituting a heuristic. Input keeps its aspect ratio and is downsampled properly.
- The result cache is keyed on the whole image, not 32 bytes of the top row.
- Smoothing no longer lowers peaks: the map is re-normalised afterwards.
- Dead or unreachable options (`reliefAngle`, `zMin`, `zMax`, `export16Bit`, `detailEmboss`, `lightElevation`) are wired up or removed.
- The broken second export button in the Export panel is removed; there is one export path.
- "True Euclidean" becomes true: an exact distance transform replaces the chamfer approximation.
- The viewer releases its GL resources and handles mouse release outside the canvas.

Tests: exported heightmap equals the buffer the viewer was given; each control changes the exported data; a known bevel profile matches its formula; peak height survives smoothing; the PNG decodes to the same 16-bit values.

## Machines and calibration

Test burns cannot be removed, because the result depends on the physical machine and material. The aim is to collapse them to one or two structured burns per combination and never repeat them.

### Profiles

- **Machine.** Name, source type (CO2 tube or diode), rated wattage, spot size, minimum power at which it fires reliably, usual line interval. Initially: 60 W CO2 and 155 W CO2.
- **Material.** Name and notes (species, thickness, finish).
- **Calibration.** One per machine, material and job type (photo or relief). Holds the speed, power range, line interval, passes and the measured response curve.

Selecting a machine and material loads the matching calibration. A calibration made on the 60 W is never offered for the 155 W. Profiles are stored locally and can be exported and imported as files. Signing in syncs them across computers (see Accounts and sync).

### Photo calibration

- **Card 1, power and speed.** A grid where each cell is a short tone ramp. The user picks the cell with solid blacks, no charring and a visible lightest step.
- **Card 2, tone response (optional).** A fine ramp at the chosen setting. The user marks where steps stop being distinguishable, by eye or from a photo of the card. This becomes the tone curve.

### Reading a card from a photo

Instead of judging the card by eye, the user can photograph or scan it and let the tool measure it (issue #56).

- Cards carry burned corner markers and unburned reference patches, so one picture is enough to locate the card, correct perspective and even out the lighting.
- Cards are self-describing. The machine and material are chosen before export, and the card carries them, with the grid's speed and power values, as a burned machine-readable code and a text label. The tool reads the code and asks the user to confirm; if it cannot be read, the user picks from a list. This also lets a card exported on one device be read on another, since profiles are stored per browser.
- The tool measures each patch's darkness relative to the bare material, builds the tone response curve from the measurements, ranks the power and speed cells by usable tone range, and flags cells with discolouration around the patch.
- The tool proposes; the user confirms or overrides. Choosing by eye stays available.
- Limits: phone cameras apply their own tone processing, so readings are relative within one photo, and a flatbed scan is the most repeatable. A photo cannot measure depth, so relief calibration still uses measured depths.

### Relief calibration

- **Depth card.** A stepped ramp of grey levels burned at the chosen speed, power range and passes.
- **Measure.** The user enters the depth of each step, measured with calipers or a depth gauge.
- **Or scan (optional, issue #61).** The user loads a 3D scan of the burned card, as a mesh or point cloud. The tool fits a plane to the unburned surface, aligns the scan to the card layout and measures every step from thousands of samples, including floor flatness and wall angle. With a scan, cards can use a continuous ramp and a grid of power and speed settings. The scanner has to resolve depths finer than the steps, and dark burned wood can be hard to capture, so gaps are reported and the user confirms the result.
- **Result.** A depth curve (grey value to millimetres) and the maximum usable depth for that machine and material. The pipeline applies the inverse so the relief comes out with the proportions shown on screen.

The existing test-grid generator (`src/lib/test-grid-generator.ts`) is the starting point.

### Getting cards into LightBurn

LightBurn sets speed and power per layer, not per region of an image, so a grid of different settings cannot be a single image. Decision: the tool exports a ready-made LightBurn project in which each cell is its own image on its own layer, with that cell's speed and power filled in. The user opens the file and presses start.

- LightBurn has 30 normal layers (indices 0 to 29), so a card is limited to 30 cells, for example 5 x 6.
- The project format is not published. The exporter is written against real project files found in the test assets of two MIT-licensed parsers, `tscircuit/lbrnts` and `jlucaso1/lbrn2-to-svg` (LightBurn 0.9.24, 1.4.01 and 1.7.08), and tested by opening its output in LightBurn by hand. The format details are recorded in issue #40.
- None of those samples uses Pass-Through or comes from a CO2 controller. Both need confirming against a project saved from the user's LightBurn.
- Fallback if the format proves unreliable: LightBurn's built-in Material Test for power and speed, then a single tone-ramp image from this tool.

## UI redesign

The current interface reads as a generic generated dashboard (dark navy, cyan glow, translucent panels) and has no responsive styling: there are no media queries, and the layout is a fixed desktop frame.

- **Look.** A chosen visual direction with its own tokens for colour, type, spacing and elevation, in light and dark. Neutral greys around the canvas so the interface does not distort judgement of tone. Fonts self-hosted.
- **Structure.** Organised around the three jobs (Vector, Photo, Relief), each a short ordered flow with the canvas always visible. Machine and material selection lives in the shell.
- **Responsive.** Side panel on desktop, collapsible on tablet, bottom sheet on phone. Pinch zoom and pan on the canvas, touch orbit in the 3D view.
- **Consistency.** Shared components on the new tokens; the roughly 200 inline style blocks are removed.

This runs alongside phase 1, so each workflow's panels are built once in the new design. Layout work is verified with headless-browser screenshots at phone, tablet and desktop widths, in addition to checks by hand.

## Accounts and sync

Profiles live in the browser, so they exist only on the computer that made them. The user has two machines, each with its own computer.

- **Principle.** The tool works fully in the browser with no account. Signing in adds sync across computers. Images are never uploaded; only profiles and settings are.
- **Local-first.** Profiles are always read from and written to the browser store and synced in the background, so the tool keeps working offline. The profile store is built sync-ready from the start: stable IDs, modified times, a version on every record, and deletions recorded instead of erased.
- **Conflicts.** The most recent change wins and the other is kept as a recoverable previous version.
- **Cost of this.** It adds a backend, stored personal data, running costs, a privacy policy and terms, none of which the project has today.
- **Paid plan.** Possible later if the tool is offered as a service: free and complete in the browser, with sync as a paid feature. Not scheduled.
- **Before this lands.** Profile export and import as files, and self-describing calibration cards, already let two computers share profiles by hand.

## Background removal

A real segmentation model run in the browser, replacing the flood fill. The model file is self-hosted and version-pinned, download progress is shown, and failure is reported, never silently replaced by a heuristic. Model choice depends on a licence check.

## Phases

0. **Safety net.** CI running typecheck, Vitest and Rust tests. Property tests for every kept piece. Delete dropped code.
1. **Core.** Document, pipeline, units, transparency. Full-resolution export with correct physical size.
   - **UI redesign**, alongside phase 1: design direction, workflow-based shell, responsive layout, shared components. Each later phase builds its panels in the new design.
2. **Vector workflow.** Segmentation, sub-pixel boundaries, stroke and fill classification, centreline, curve fitting, export in real units.
3. **Profiles and photo workflow.** Machine, material and calibration profiles; device-grid resampling, clarity and CLAHE fixes, real blue noise, 1-bit export, photo calibration cards.
4. **Relief workflow.** Single heightmap for view and export, model handling, option clean-up, depth calibration.
5. **Background removal.**
6. **Accounts and profile sync.** Backend and sign-in choice, local-first sync of profiles. A paid plan is recorded but not scheduled.

Phases 2 to 5 are independent after phase 1 and can be reordered. Phases 0 to 2 with the UI redesign form the first milestone: a tracer that fixes the main frustration, on a sound core, in the new interface.

### Tracking

Work is tracked in GitHub issues. Each phase has a tracking issue with its work items attached as sub-issues.

| Phase | Tracking issue | Work items |
|---|---|---|
| 0. Safety net and cleanup | #1 | #7 to #14 |
| 1. Core | #2 | #15 to #22 |
| 2. Vector | #3 | #23 to #32 |
| 3. Profiles and photo | #4 | #33 to #41, #56 |
| 4. Relief | #5 | #42 to #48, #61 |
| 5. Background removal | #6 | #49 to #50 |
| 6. Accounts and sync | #57 | #58 to #60 |
| UI redesign (alongside phase 1) | #51 | #52 to #55 |

Labels: `phase` marks the tracking issues; `area: infra`, `area: core`, `area: vector`, `area: photo`, `area: relief`, `area: background-removal`, `area: accounts` and `area: ui` group work items; `bug` marks defects in existing code and `enhancement` marks new work.

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
- Relief: transparent pixels count as ink, so a logo on a transparent background gives a flat map (`src/wasm/src/depth.rs:40`). Reported. Fixed by flattening transparency in the core.
- Relief: the Export panel's heightmap button sends 16-bit data down the 8-bit path (`src/components/panels/ExportPanel.tsx:316`).
- Relief: AI depth falls back to a heuristic with no message (`src/lib/ai-depth.ts:127`), and its cache key is weak (`src/workers/imageWorker.ts:28`).
- Existing tests check output shape, not correctness.

## Open questions

- Line interval and typical materials on each machine.
- Relief: on the CO2 machines the heightmap runs in LightBurn's Grayscale image mode (power varies per pixel between min and max power). LightBurn's 3D Sliced mode is galvo-only and does not apply. Still to confirm: whether Grayscale mode uses more than 8 bits of a 16-bit image, and how the user runs reliefs today (passes, speed, power range).
- A sample LightBurn project (one image on one layer set to Pass-Through) saved from the user's LightBurn, to confirm how Pass-Through and CO2 settings are written. Not needed to start the exporter.
- Background removal model and its licence.
- Where the app is deployed. The repo has both `netlify.toml` and `vercel.json`; this matters for CI, self-hosted model files and, later, accounts.
