# Phase 1 design: document, pipeline and units

Status: draft for review. Covers issues #15 to #22 (tracking issue #2). Nothing here is implemented yet.

## 1. The document

### What it holds

```ts
interface ImageDocument {
  id: string;                 // new for every loaded image
  source: SourceInfo;         // the original, by reference (see below)
  widthMm: number;            // physical width of the cropped image
  steps: EditSteps;           // the edits, in pipeline order
  vector: VectorConfig;       // workflow settings, read by the tracer
  depth: DepthConfig;         // workflow settings, read by the relief generator
}

interface SourceInfo {
  sourceId: string;           // key of the decoded pixels held by the worker
  name: string;
  widthPx: number;            // full resolution, after EXIF orientation
  heightPx: number;
  hasAlpha: boolean;
  fileDpi: number | null;     // read from PNG pHYs or JPEG JFIF/EXIF; null if absent
}

interface EditSteps {
  crop: CropRect | null;      // integer pixels of the original
  tonal: TonalAdjustments;
  color: ColorAdjustments;
  detail: DetailSettings;     // CLAHE, sharpen, adaptive threshold; lengths in mm
  dither: DitherSettings;
}
```

The document is a small, immutable, plain-data value. Every change produces a new document; unchanged parts are shared by reference.

**The original image.** The document refers to the original through `sourceId`; it does not carry the pixels. A 6000x4000 RGBA image is 96 MB, so the decoded pixels live in one place, the worker, and are transferred there once when the file is loaded. The main thread keeps the `File` (the encoded bytes, a few MB) so the worker can be re-seeded if it restarts. This keeps undo snapshots cheap and keeps full-resolution buffers off the main thread.

Decoding happens in the worker with `createImageBitmap(file, { imageOrientation: 'from-image', premultiplyAlpha: 'none' })` and an `OffscreenCanvas`. Unpremultiplied alpha matters: premultiplied decoding loses colour precision at low alpha, which shows up as fringes after flattening.

### Size and DPI

Physical size is stored once, as `widthMm`. Everything else is derived:

- `heightMm = widthMm * cropHeightPx / cropWidthPx` (pixels are square; the aspect ratio is the crop's).
- `nativeDpi = cropWidthPx / (widthMm / 25.4)`, the DPI at which the cropped original exactly fills the physical size.

On load, `widthMm` comes from `fileDpi` when the file has one, else from an assumed 300 DPI, and the UI says the size was assumed. Changing the crop keeps `widthMm` fixed and lets the height and DPI follow; changing the size keeps the crop.

In phase 1, export renders at the native resolution: a 6000x4000 original exports at 6000x4000 with the DPI that makes it the size shown. Phase 3 (#34) adds a dot pitch (the machine's line interval) to the document; when it is set, the export target becomes `size / pitch` and the pipeline resamples to it. That is one more optional field, not a second place where size lives.

There is no other copy of width, height or DPI. `imageStore.metadata.dpi`, the Export panel's local DPI state, `CanvasSizeDialog`'s state and the per-layer `metadata` all go.

### Undo and redo

A single `documentStore` owns the document and its history:

```ts
interface DocumentState {
  doc: ImageDocument | null;
  version: number;            // increases on every change to doc, including undo and redo
  past: ImageDocument[];      // capped at 50
  future: ImageDocument[];
  edit(update: (d: ImageDocument) => ImageDocument): void;   // one undo entry
  beginGesture(): void;
  updateGesture(update: (d: ImageDocument) => ImageDocument): void;  // live, no entry
  endGesture(): void;         // one entry for the whole gesture, if anything changed
  undo(): void;
  redo(): void;
  load(file: File): Promise<void>;                           // new document, history cleared
}
```

- Every control that changes the document calls `edit` (a click, a checkbox, a preset chip, a reset) or the gesture trio (a slider drag, a crop drag). There is no other way to change the document, which is what #21 needs.
- `edit` and `endGesture` compare the new document with the old one by value and record nothing when they are equal, so focusing and blurring a field leaves the stacks alone.
- Undo and redo swap whole documents. Because the document includes crop, size, steps and workflow settings, undo covers all of them.
- `version` is a store counter, not part of the document. Undo gives a new version number even though the document equals an earlier one, so a result computed for "the same document an hour ago" is never mistaken for current.
- Derived data (preview pixels, trace results, heightmaps) is not in the history. It is recomputed from the document.

## 2. The pipeline

### Signature

```ts
interface RenderTarget { widthPx: number; heightPx: number }

type Stage = 'prepared' | 'final';

interface RenderOutput {
  pixels: ArrayBuffer;        // RGBA8, opaque
  widthPx: number;
  heightPx: number;
  pxPerMm: number;            // target width / doc.widthMm
}

function render(doc: ImageDocument, source: DecodedSource, target: RenderTarget, stage: Stage): RenderOutput;
```

`render` is a pure function of the document, the source pixels it names, the target size and the stage. It runs in the worker. Preview, export, tracing and relief all call it; they differ only in the target and the stage. Targets come from three helpers, so no caller does its own arithmetic:

- `previewTarget(doc)`: the crop scaled so its longest edge is at most 2048 px.
- `nativeTarget(doc)`: the crop at full resolution.
- `deviceTarget(doc, pitchMm)`: added in phase 3 (#34).

### Steps, in order

1. **Crop** to `steps.crop`, in original pixels.
2. **Flatten transparency onto white**: `c' = round(c * a / 255 + 255 * (1 - a / 255))`, then `a = 255`. This is the only place alpha is read. Every later step, and everything downstream (dither, export, trace, relief), sees an opaque image where transparent means white, which means no burn. It happens before resampling because resampling unflattened RGBA averages the black of transparent pixels into the edges.
3. **Resample** to the target. Area averaging for downscaling, bilinear for upscaling.
4. **Tonal and colour** (per pixel, independent of resolution).
5. **Detail**: CLAHE, then sharpen, then adaptive threshold. This moves sharpening before thresholding (#22).
6. **Dither**, only for stage `final`.

Stage `prepared` stops after step 5. It is the input for tracing and relief. Stage `final` is what the preview shows and what raster export writes.

Steps 1 to 3 are one new Rust export, `prepare_source(src, srcW, srcH, cropX, cropY, cropW, cropH, dstW, dstH) -> ptr`. Steps 4 to 6 are the existing `process_pipeline` with sharpening moved. All algorithms stay in Rust, so there is one implementation of each. The main-thread JavaScript tonal path (`applyFastTonalLUT` in `useWorker.ts`) is removed; it duplicates `tonal.rs` and is the source of one of the #19 races. If the worker round trip turns out too slow for slider drags, the fix is to make the worker path faster, not to add a second implementation. The plan lists `src/lib/fast-tonal.ts` as kept; after this change nothing in `src` uses it, so I propose deleting it and moving its tests to the WASM. See "Decisions to confirm".

The worker caches the output of `prepare_source` for each (source, crop, target), so a slider drag repeats only steps 4 to 6.

### Lengths in millimetres

Parameters that measure a length in the image are stored in millimetres and converted at the start of each run by one function, `toRunParams(steps, pxPerMm)`:

| Parameter | Today | Stored as | Converted to |
|---|---|---|---|
| Sharpen radius | px, float | mm | `mm * pxPerMm`, float |
| Adaptive threshold block | px, odd integer | mm | nearest odd integer >= 3 |
| CLAHE grid | tiles across the image | unchanged | already independent of resolution |
| Dither matrix scale | dots | unchanged (see below) | none |

The tracer's tolerances, minimum area and denoise radius, and the relief smoothing and denoise radii, are also pixel lengths today. They convert with the same `pxPerMm` from the run, but the changes to those parameters belong to #32 (vector) and #44/#45 (relief), so phase 1 does not touch them. Phase 1 only makes `pxPerMm` available to them.

Two kernels need a change in #16 for this to hold. The unsharp mask rounds its radius and clamps it to 1 to 5 px (`src/wasm/src/sharpen.rs:14`), so a radius that is 2 px at preview size and 6 px at full size is cut to 5 px in the export. The kernel extent becomes `ceil(3 * sigma)` with no upper clamp. The adaptive threshold already accepts any block size.

The sliders change from pixels to millimetres. Default values are chosen to match today's defaults at 300 DPI: sharpen radius 1.5 px becomes 0.13 mm, adaptive block 15 px becomes 1.3 mm.

**Dithering is not converted.** A dither works on the dot grid; its matrix scale is a number of dots. A dither rendered at preview resolution is not a downscaled copy of the dither at export resolution, and cannot be. Phase 1 shows the preview-resolution dither as today. Phase 3 replaces it with the burn simulation (#41) at the device grid (#34). This affects how #16 is tested; see section 6.

### Versioning and stale results

All three of today's coordinators in `useWorker.ts` have the same defect: the code that dispatches the next job is a closure from an earlier render, so it can send old pixels, old dimensions, or commit a result for a document that has since changed. Patching each one leaves the pattern in place. Instead there is one scheduler class, created once outside React:

```ts
class RenderScheduler<Req, Res> {
  constructor(opts: {
    buildRequest: () => { version: number; req: Req } | null;   // reads current store state
    run: (req: Req) => Promise<Res>;                             // the worker call
    commit: (res: Res, version: number) => void;
    currentVersion: () => number;
  });
  invalidate(): void;
}
```

- `invalidate` is called from a store subscription whenever the document version changes. It only sets a dirty flag and starts a run if none is in flight. It never takes a payload.
- A run starts by calling `buildRequest`, so the request is always built from the state at dispatch time. There is no queued payload to go stale.
- When a run finishes, its result is committed only if its version still equals `currentVersion()`. Otherwise it is dropped. If the dirty flag is set, a new run starts, again from current state.
- At most one run is in flight per scheduler. A newer request replaces a pending one; it never queues behind it.

There is one scheduler for the preview, one for tracing and one for relief. React components only read committed results from the store. Because the scheduler is plain TypeScript with an injected `run`, it is tested in Node with a fake worker whose promises the test resolves in any order (#19).

Export does not use a scheduler. It is a single call with the document as it was when the user clicked, and it writes that document even if the user changes something while it runs. The preview, which must follow the current document, uses the scheduler.

### Worker API

```ts
loadSource(file: File): Promise<SourceInfo>              // decode once, keep the pixels
releaseSource(sourceId: string): void
renderPreview(doc, version): Promise<{ version, output }>  // output transferred
exportRaster(doc, format): Promise<{ bytes, filename }>   // encoded in the worker, bytes transferred
trace(doc, version, target): Promise<{ version, result }>   // phase 2 fills this in
relief(doc, version, target): Promise<{ version, heightmap }> // phase 4 fills this in
```

Full-resolution pixels never leave the worker. Export returns encoded file bytes. Results come back as transferred `ArrayBuffer`s. `imageWorker.ts` stays an orchestrator; the pipeline, target helpers, `toRunParams` and the cache go in `src/lib/pipeline/`, which `imageWorker.ts` imports, so the tests can call them without a worker.

## 3. What happens to the existing stores

| Today | After phase 1 |
|---|---|
| `layerStore` (the current document model) | Removed. Replaced by `documentStore`. |
| `imageStore` image fields (`originalBuffer`, `originalBitmap`, `metadata`, `previewBuffer`, `previewDimensions`) | Removed. The document holds the source and size; the preview result is in `renderStore`. |
| `imageStore` view fields (zoom, pan, tool, split, substrate mask) | Kept, renamed `viewStore`. View state is not part of the document and not undoable. |
| `imageStore` results (`previewProcessedBuffer`, `depthHeightMapBuffer`) and status | New `renderStore`: the latest committed result of each scheduler with its version, plus processing and error state. |
| `editStore` settings (`tonal`, `color`, `detail`, `geometry`, `dither`, `vector`, `depth`) | Move into the document. |
| `editStore` history | Moves into `documentStore`. The begin/commit logic is kept; it now snapshots the document. |
| `editStore` vector result and its edits (cutline, smoothing, layer remove and toggle) | A trace result is derived, so it goes in `renderStore` and leaves the undo history. The cutline and node-smoothing actions act on it as today until phase 2 (#32) decides their place. |

### Multi-layer compositing

The plan drops multi-layer compositing "unless a workflow turns out to need it". None of the three workflows does: each starts from one image. `layerStore` is the current document model, so it cannot be left alongside the new one without two sources of truth. I propose removing it outright, with:

- `src/store/layerStore.ts`, `src/lib/compositor.ts`, `src/types/layer.ts`
- `src/components/panels/LayersPanel.tsx` and its CSS
- `src/lib/text-layer.ts`, `src/components/dialogs/TextLayerDialog.tsx` and its CSS, and `tests/unit/text-layer.test.ts`
- the Layers tab, the Layer menu (new, duplicate, merge, flatten, reorder, cycle), the layer selector and alignment controls in `ToolSubheader`, the move and scale handles in `PreviewCanvas`, the Target Layer selector in `AdjustmentsPanel`, and the export scope selector in `ExportPanel` (#22)
- the layer tests in `tests/unit/history-and-layers.test.ts` (the history tests are rewritten against the document)

Changes that follow:

- Opening or dropping a second image replaces the document, after a confirmation if there are unsaved edits. Dropping several files opens the first and says the rest were ignored.
- `CanvasSizeDialog` loses its "canvas resize" mode, which pads the canvas for layers to sit on. It becomes a physical size dialog: width or height in mm or inches, aspect locked to the crop, DPI shown as derived.
- The crop overlay writes `steps.crop` through a gesture instead of shifting layer transforms.
- The material test grid's raster option opens the grid as a new document at its physical size, instead of adding a layer. Its vector option is unchanged. Both are reworked in phase 3 (#40).
- `GeometryTransform` loses `rotation`, `flipHorizontal` and `flipVertical`. They are stored and sent to the worker today but nothing applies them and no control sets them. Crop is kept. If rotation or flipping is wanted, it can come back as a real step.

**This is the owner's decision to confirm.** The cost is that text and multi-image layouts are no longer possible in this tool; they would be done in LightBurn or a drawing program.

## 4. Tracing and relief take their input from the pipeline

Both run in the worker and start the same way:

```ts
const input = render(doc, source, target, 'prepared');   // flattened, cropped, adjusted, not dithered
```

- **Tracer (phase 2).** `trace(doc, version, target)` renders `prepared` at `nativeTarget(doc)` by default, converts the vector settings from mm with `input.pxPerMm`, traces, and scales the paths by `1 / pxPerMm` so the result is in millimetres. The overlay draws it at any zoom by scaling mm to screen; SVG and DXF write it directly (#30). This replaces today's tracing of the unadjusted preview (#23), and transparency is already white, so #18 holds for tracing without the tracer reading alpha.
- **Relief (phase 4).** `relief(doc, version, target)` renders `prepared` at the requested target and returns a 16-bit heightmap with its `pxPerMm`. The 3D view asks for the preview target; export asks for the native target. Making the view and the export read one buffer (#42) is then a choice of target inside phase 4, not a change to the core.

What phases 2 and 4 add: their own algorithms, their worker function bodies, their settings in `doc.vector` and `doc.depth`, and their own scheduler instances. What they do not need to change: the document's shape outside their own settings, `render`, the targets, the scheduler, or the history.

One known exception: background removal (phase 5) produces a mask, and that mask has to be applied before transparency is flattened. It will be a new step between crop and flatten. The step order leaves room for it.

## 5. Export

- Raster export calls `exportRaster(doc, format)`. The worker renders `final` at `nativeTarget(doc)` and encodes it.
- **PNG** gets a new 8-bit encoder (greyscale or RGBA) that writes `pHYs` in pixels per metre. `canvas.toBlob` cannot write `pHYs`. The existing 16-bit encoder writes uncompressed deflate blocks, which would make a 6000x4000 file about 96 MB; both encoders switch to `CompressionStream('deflate')`, which browsers, workers and Node 18+ provide, so no dependency is added.
- **BMP** already writes pixels per metre; it now receives the document's DPI.
- **JPEG and WebP.** WebP has no standard DPI field. JPEG can carry DPI in its JFIF header, but `canvas.toBlob` does not write it and JPEG compression smears dithered and thresholded images. I propose removing both from the raster export list. See "Decisions to confirm".
- The size shown in the Export panel is computed from the same target and DPI the export uses, from the document. The panel has no DPI input of its own.

The heightmap exports in `DepthMapPanel` and the second heightmap button in `ExportPanel` are preview-sized too. They belong to #46 and #42 in phase 4 and are left alone, except that they will read the document's DPI once there is no other.

## 6. Tests

All new tests follow `tests/unit/dither-properties.test.ts`: an independent reference implementation in the test, compared with the WASM through `tests/helpers/wasm.ts`.

| Issue | Test | Property measured |
|---|---|---|
| #15 | Crop, then change size, tonal, detail and dither in turn | `steps.crop` and the derived size are unchanged after each edit |
| #15 | Size and DPI derivation | For several crops and sizes, `heightMm` and `nativeDpi` equal the formulas above |
| #16 | `prepare_source` against a reference box filter | Every output pixel within 1 level of the reference |
| #16 | Preview against downscaled native render, stage `prepared`, on a synthetic photo-like image with tonal, colour and sharpen applied | Mean absolute difference at most 1.0 level and 99th percentile at most 6 levels (out of 255). CLAHE and adaptive threshold have their own row below. |
| #16 | Adaptive threshold at two resolutions with the block in mm | At most 2 % of pixels differ after downscaling and rethresholding |
| #16 | Dither at two resolutions | Mean density over blocks of the same physical size (16 preview pixels across) matches within 2 levels (the dithers are not pixel-comparable across resolutions; see 2) |
| #16 | `toRunParams` | Converted lengths for several `pxPerMm`; block sizes odd and at least 3 |
| #18 | A logo on transparency against the same logo composited onto white by the test's reference | Identical bytes after flattening; identical dither output; identical trace (path count and coordinates); identical heightmap |
| #17 | Export of a 6000x4000 source at a given width in mm | Decoded PNG and BMP are 6000x4000; `pHYs` and pixels-per-metre decode to `nativeDpi` within rounding to whole pixels per metre |
| #17 | 8-bit PNG round trip through an independent inflate and decoder | Every byte matches the source |
| #19 | Scheduler with a fake worker: start a run, change the document, resolve the old run, then the new one | The old result is never committed; the newest version is always committed last; no run is built from state older than the latest change |
| #21 | Each kind of edit through `edit` and gestures, then undo | The previous document is restored by value; a no-op leaves both stacks unchanged |
| #22 | Reset All, Auto Levels, sharpen before threshold | Reset All restores every step's defaults; Auto Levels sets black and white points from the histogram percentiles of a synthetic image; sharpening changes the thresholded result |

The tolerances in the #16 rows are my estimate of the error from resampling before against after a 3x3 sharpen. If the measured error is larger for a reason I can explain, I will say so in the pull request instead of loosening the number silently. CLAHE is excluded from the pixel comparison until #36 is fixed, because its edge bands depend on the image size.

Browser checks for each pull request that changes the UI: load a large image (at least 6000x4000) and a transparent PNG, take screenshots of the preview and export panel at desktop, tablet and phone widths, export, and check the file's pixel size and DPI.

## 7. Order of work

1. **#15** Document model, `documentStore`, `viewStore`, removal of layers. The preview keeps today's worker path, fed from the document, so the app works between pull requests.
2. **#16 and #19 together.** The new pipeline and the scheduler replace `useWorker.ts`. Doing #16 on the old coordinator and then rewriting it for #19 would mean writing the coordinator twice.
3. **#18** Flattening, already a step in #16, gets its tests across dither, trace and relief, and the alpha dropdown is removed.
4. **#17** Full-resolution export, the PNG encoder, DPI from the document and from the source file.
5. **#21** Undo on every control, using `edit` and gestures.
6. **#22** Mislabeled controls.
7. **#20** Viewport, on the new preview result.

This differs from the suggested order only in pairing #19 with #16.

## 8. Corrections and gaps in the issues

- **#16** says `imageWorker.ts` is 1,300 lines and needs splitting. Phase 0 already brought it to 238 lines of orchestration. Nothing left to do there.
- **#16** lists dither scale among the parameters to store in mm. It should stay in dots: a dither is defined on the dot grid. For the same reason its done-when test cannot compare dithered output pixel for pixel across resolutions; section 6 compares block density instead.
- **#16** asks for "a stated tolerance" without one. Section 6 proposes numbers.
- **#16** does not mention that sharpening clamps its radius to 5 px, which breaks the preview against export comparison at full size. Section 2 lifts the clamp.
- **#17** does not mention that the existing PNG encoder is uncompressed, which matters once exports are full size.
- **#17** leaves open what happens to JPEG and WebP. See below.
- **#15** does not mention that rotation and flip are stored but never applied. Section 3 removes them.
- **#18** also covers the export of images that were transparent: they now export opaque, white where transparent. That is the intended meaning of "no burn", but a user who wants to keep transparency for another program loses it.
- **Missing: source DPI and EXIF orientation.** #17 mentions the hard-coded 300 DPI; reading `pHYs` and JFIF/EXIF density is part of #17 here. Orientation is handled by decoding with `imageOrientation: 'from-image'`.
- **Missing: memory on large images.** A full-resolution run of a 6000x4000 image needs the source, the prepared copy and working buffers in WASM memory: roughly 400 MB at peak. That is fine on a desktop and may fail on a phone. A failure will be reported with the image size, not replaced by a smaller export. I will open an issue to measure it and decide on a limit.
- **Missing: saved recipes and material presets** store sharpen radius and block size in pixels. Recipes get a version 2 with millimetres; version 1 recipes and the built-in presets are converted assuming 300 DPI, and the conversion is tested.
- **Missing: the dither panel's "alpha handling" select** is in #18 and is removed there, since flattening onto white is the only behaviour.

## 9. Decisions to confirm

1. **Remove multi-layer compositing**, with text layers and multi-image import, as listed in section 3.
2. **Keep the edit steps in a fixed pipeline order** rather than as a list the user can reorder. The order is a property of the pipeline (crop, flatten, resample, tone, detail, dither), and a reorderable list adds UI no workflow asks for. Recipes still save the steps as an ordered list.
3. **Delete the main-thread tonal path** (`src/lib/fast-tonal.ts`), which the plan lists as kept, so that the Rust core is the only tonal implementation.
4. **Remove JPEG and WebP** from raster export; keep PNG and BMP, both with DPI.
5. **Assume 300 DPI** when a file has no DPI, and label the size as assumed.
