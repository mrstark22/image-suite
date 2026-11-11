# Phase 1 design: document, pipeline and units

Status: approved on PR #64, with the second review's points folded in. Covers issues #15 to #22 (tracking issue #2). Sections 1 and 3 are implemented by #15 (parts 1 and 2); the rest is not implemented yet. Where part 2 differs from this text, a note says so.

## 1. The document

### What it holds

```ts
interface ImageDocument {
  id: string;
  source: SourceInfo;
  mmPerPx: number | null;
  steps: EditSteps;
  vector: VectorConfig;
  depth: DepthConfig;
}

interface SourceInfo {
  sourceId: string;
  name: string;
  widthPx: number;
  heightPx: number;
  format: 'rgba8';
  hasAlpha: boolean;
  fileDpi: number | null;
}

interface EditSteps {
  crop: CropRect | null;
  tonal: TonalAdjustments;
  color: ColorAdjustments;
  detail: DetailSettings;
  dither: DitherSettings;
}
```

- `id` is new for every loaded file.
- `source` refers to the original; it does not carry the pixels (see section 5). `widthPx` and `heightPx` are the full resolution after EXIF orientation. `fileDpi` is what the file claims, if anything.
- `mmPerPx` is the physical scale: millimetres per source pixel. `null` means the size has not been set.
- `crop` is in integer pixels of the original.
- `detail` holds CLAHE, sharpening and the adaptive threshold, with lengths in millimetres.
- `vector` and `depth` are workflow settings read by the tracer and the relief generator.

The document is a small, immutable, plain-data value. Every change produces a new document. Unchanged parts are shared by reference, so comparing a part of two documents is a reference comparison.

The edit steps run in a fixed order, defined by the pipeline (section 2). Recipes save them as an ordered list.

### Size and DPI

Physical size is stored once, as the scale `mmPerPx`. Everything else is derived:

- `widthMm = cropWidthPx * mmPerPx` and `heightMm = cropHeightPx * mmPerPx`
- `dpi = 25.4 / mmPerPx`

**Cropping keeps the scale.** Cropping away half the image halves its width in millimetres; what remains keeps its physical size, and every millimetre-based parameter keeps its effect on the content. **Setting the size** is the operation that changes the scale. The user enters a width or a height for the current crop, and `mmPerPx` follows from it.

**Size is an explicit first step.** File DPI is not trusted. Many files say 72 or 96, which would make a phone photo more than a metre wide. On load:

- `mmPerPx` starts as `null` and the size dialog opens.
- If the file has a DPI, it is offered as a suggestion with the size it gives ("file says 72 DPI: 2117 x 1411 mm"). The user can accept it with one click or type a width or height.
- Until a size is set or accepted, the size is shown as "not set" everywhere it appears.

**While the size is not set,** nothing that depends on physical size pretends to know it:

- The controls with lengths in millimetres (sharpen radius, adaptive threshold block) are disabled with "Set the size to use this", and the pipeline skips those two steps.
- Tone, colour, CLAHE and dithering do not depend on size; they work as normal.
- Export is disabled.
- Tracing and relief (phases 2 and 4) have lengths in millimetres too, so they also require a size.

In phase 1, export renders at the source's own resolution: a 6000x4000 original exports at 6000x4000 at `25.4 / mmPerPx` DPI. Phase 3 (#34) adds a dot pitch (the machine's line interval). When the pitch is set, the export target becomes `size / pitch` and the pipeline resamples to it. That adds an optional field; it does not create a second place where size lives.

`imageStore.metadata.dpi`, the Export panel's own DPI state, `CanvasSizeDialog`'s state and the per-layer `metadata` are all removed. They are replaced by values derived from the document.

### Undo and redo

A single `documentStore` owns the document and its history:

```ts
interface DocumentState {
  doc: ImageDocument | null;
  version: number;
  past: ImageDocument[];
  future: ImageDocument[];
  edit(update: (d: ImageDocument) => ImageDocument): void;
  beginGesture(): GestureToken;
  updateGesture(token: GestureToken, update: (d: ImageDocument) => ImageDocument): void;
  endGesture(token: GestureToken): void;
  undo(): void;
  redo(): void;
  load(file: File): Promise<void>;
}
```

- `past` is capped at 50 entries. `version` increases on every change to `doc`, including undo and redo, gesture updates and loads.
- **One way in.** Every change to the document goes through `edit` or through a gesture. `edit` covers clicks, checkboxes, preset chips and resets: one call, one undo entry. A gesture covers a slider drag or a crop drag: the document updates live with no entries, and the whole gesture becomes one entry when it ends. Having one way in is what #21 needs.
- **No-op changes record nothing.** `edit` and `endGesture` compare the new document with the old one by value and record nothing when they are equal. Focusing and then blurring a field leaves the stacks alone.
- **Undo swaps whole documents.** The document includes the crop, scale, steps and workflow settings, so undo covers all of them.
- **Undo gives a new version number.** It does so even though the document equals an earlier one, so an old result is never mistaken for current.
- **Derived data is not in the history.** Preview pixels, trace results and heightmaps are recomputed from the document.

**Gestures that are interrupted:**

- **Undo or redo during a gesture** cancels the gesture: the document returns to its state before the gesture, nothing is recorded, and the key press does nothing more.
- **`edit` during a gesture** ends the gesture first (recording it if it changed anything), then records the edit as its own entry.
- **Loading a file during a gesture** discards the gesture along with the old document.
- **An `endGesture` that never arrives.** `beginGesture` registers window-level `pointerup`, `pointercancel` and `blur` listeners. Any of them ends the gesture. Components also call `endGesture` when they unmount.
- **Late calls are ignored.** `endGesture` can be called more than once safely. Every call carries the token from `beginGesture`, so an update or end from a gesture that has already finished is ignored.

**As built in #15 part 2** (where it differs from the above):

- **The crop overlay records its crop with `edit`, not a gesture.** The box is dragged as local state on the cropped preview and applied with Enter or Apply, as one entry. Updating `steps.crop` live during the drag would re-crop the preview under the box being dragged.
- **A slider's number field commits with `edit` on Enter or blur, not a gesture.** Focusing the field cannot start a gesture: the click that focuses it ends with a `pointerup`, which would end the gesture at once. Typing is held as a draft until it is committed; Escape abandons it. Dragging the track is a gesture; arrow keys on the track are one `edit` per step.

## 2. The pipeline

### Signature

```ts
interface RenderTarget {
  widthPx: number;
  heightPx: number;
}

type Stage = 'source' | 'prepared' | 'final';

type PixelFormat = 'rgba8';

interface RenderOutput {
  format: PixelFormat;
  pixels: ArrayBuffer;
  widthPx: number;
  heightPx: number;
  pxPerMm: number | null;
}

function render(doc: ImageDocument, source: SourceHandle, target: RenderTarget, stage: Stage): RenderOutput;
```

`render` is a pure function of the document, the source it names, the target size and the stage. It runs in the worker. Preview, export, tracing and relief all call it; they differ only in the target and the stage. `pxPerMm` is the target width divided by the width in millimetres, or `null` while the size is not set.

Targets come from helpers, so no caller does its own arithmetic:

- `previewTarget(doc, maxEdge = 2048)`: the crop scaled so its longest edge is at most `maxEdge`.
- `nativeTarget(doc)`: the crop at the source's full resolution.
- `deviceTarget(doc, pitchMm)`: added in phase 3 (#34).

**Regions (phase 3).** Inspecting a dither or a burn simulation at 1:1 cannot be done with a whole-image target capped at 2048 px. `RenderTarget` will gain an optional `region`: a rectangle of the crop, rendered at the target's scale. It is not built in phase 1. The rest of the pipeline does not assume the target covers the whole crop, so adding it does not change `render`'s signature.

### Steps, in order, and the tone space of each

| # | Step | Stage | Works on |
|---|---|---|---|
| 1 | Crop to `steps.crop` | `source` | source pixels |
| 2 | Flatten transparency onto white | `source` | sRGB-encoded values |
| 3 | Resample to the target | `source` | linear light |
| 4 | Tonal and colour | `prepared` | sRGB-encoded values |
| 5 | CLAHE, then sharpen, then adaptive threshold | `prepared` | sRGB-encoded values |
| 6 | Dither | `final` | sRGB-encoded values today; #39 decides |

- **Stages.** `source` stops after step 3: the cropped, flattened, resampled image with no adjustments. Relief from a photo (phase 4) and background removal (phase 5) will want this. `prepared` stops after step 5: the input for tracing and tonal relief. `final` is what the preview shows and what raster export writes.
- **Flattening** is `c' = round(c * a / 255 + 255 * (1 - a / 255))`, then `a = 255`. It is the only place alpha is read; every later step and every consumer sees an opaque image where transparent means white, which means no burn. It works on encoded values, which is how browsers and drawing programs show a logo on white, so the burn matches what the user saw. It comes before resampling, because resampling unflattened RGBA averages the black of transparent pixels into the edges.
- **Resampling** works in linear light. The encoded values are decoded through a 256-entry sRGB-to-linear table, averaged over the area each output pixel covers (or interpolated bilinearly when enlarging), and encoded back. Averaging encoded values darkens fine detail: a one-pixel black and white checkerboard downsampled by two should give a linear average of 0.5, which encodes to 188, not 128.
- **Steps 4 to 6 keep today's behaviour** on encoded values, so the existing tonal and dither property tests still apply. Sharpening moves before the threshold (#22).

Steps 1 to 3 are one new Rust export:

```
prepare_source(src, srcW, srcH, cropX, cropY, cropW, cropH, dstW, dstH) -> ptr
```

Steps 4 to 6 are the existing `process_pipeline`, with sharpening moved. All algorithms stay in Rust, so each has one implementation.

### Room for more than 8 bits

Phase 1 implements 8 bits per channel only, but the interfaces carry a format so that a deeper path can be added without changing them:

- `SourceInfo.format` and `RenderOutput.format` are `'rgba8'` today. A greyscale 16-bit or float format (`'gray16'`, `'grayf32'`) is a new member of `PixelFormat`.
- **A deeper path enters at decoding.** `createImageBitmap` and the canvas give 8 bits per channel, so a 16-bit PNG or TIFF would need a decoder of our own, producing a `'gray16'` source.
- **It also enters at `prepare_source`,** which would take the source format and produce the requested output format. It already decodes to linear light internally, so it does not need more than one code path per format.
- **Tone steps and relief.** Tone steps on a 16-bit path would use a curve evaluated per value, or a 65,536-entry table, instead of the 256-entry table. Relief (phase 4) can then take a `'grayf32'` `source` or `prepared` render and keep more than 256 levels.
- **Formats that are not implemented are rejected with an error.** They are never converted silently.

### The main-thread tonal path is removed

`applyFastTonalLUT` in `useWorker.ts` duplicates `tonal.rs`, and it is the source of one of the #19 races. It is removed, and `src/lib/fast-tonal.ts` is deleted, with its tests moved to the WASM.

**Slider drags must stay responsive without it.** The budget for a tone-only preview render (steps 4 and 5 with only tonal and colour active, on a cached `source` render at 2048 px) is:

- 25 ms of worker time
- 50 ms from input event to the frame that shows it

I will measure both in headless Chromium in the #16 pull request and report the numbers. If the budget is missed, a gesture renders at `previewTarget(doc, 1024)`, a quarter of the pixels, and the full preview target is rendered when the gesture ends. That keeps one implementation.

### Lengths in millimetres

Parameters that measure a length in the image are stored in millimetres. One function, `toRunParams(steps, pxPerMm)`, converts them at the start of each run:

| Parameter | Today | Stored as | Converted to |
|---|---|---|---|
| Sharpen radius | px, float | mm | `mm * pxPerMm`, float |
| Adaptive threshold block | px, odd integer | mm | nearest odd integer, at least 3 |
| CLAHE grid | tiles across the image | unchanged | already independent of resolution |
| Dither matrix scale | dots | unchanged | none: a dither is defined on the dot grid |

The unsharp mask needs a change in #16 for the conversion to hold. It rounds its radius and clamps it to 1 to 5 px (`src/wasm/src/sharpen.rs:14`). The kernel extent becomes `ceil(3 * sigma)` with no upper clamp, and the blur runs one channel at a time so its scratch memory drops from 24 to 8 bytes per pixel (section 5).

The tracer's tolerances and the relief radii are pixel lengths today as well. They will convert with the same `pxPerMm`, but changing them belongs to #32, #44 and #45. Phase 1 only makes `pxPerMm` available to them.

The sliders change from pixels to millimetres. The new defaults match today's at 300 DPI: a sharpen radius of 1.5 px becomes 0.13 mm, and an adaptive block of 15 px becomes 1.3 mm.

**A dither preview is not a scaled-down export.** A dither rendered at preview resolution is a different dither from the one at export resolution. Phase 1 shows the preview-resolution dither as today. Phase 3 replaces it with the burn simulation (#41), rendered at the device grid over a region.

### Schedulers and stale results

All three of today's coordinators in `useWorker.ts` have the same defect. The code that sends the next job is a closure from an earlier render, so it can send old pixels or old dimensions, or commit a result for a document that has since changed. Patching each instance would leave the pattern in place. They are replaced by one scheduler class, with one instance per consumer, created once outside React:

```ts
class RenderScheduler<Deps extends readonly unknown[], Req, Res> {
  constructor(opts: {
    select: (doc: ImageDocument) => Deps;
    enabled: () => boolean;
    buildRequest: (doc: ImageDocument) => Req;
    run: (req: Req) => Promise<Res>;
    commit: (res: Res) => void;
    fail: (err: unknown) => void;
  });
  onDocumentChange(doc: ImageDocument | null): void;
}
```

**Dependencies.** Each scheduler reads only part of the document, and `select` returns that part. When the document changes, the scheduler compares the new parts with the parts its last run used, by reference. If they are the same, nothing happens. Otherwise its own input version increases and it is marked dirty.

| Scheduler | Reads |
|---|---|
| Preview | `source`, `mmPerPx`, `steps` |
| Trace (phase 2) | `source`, `mmPerPx`, `steps.crop`, `steps.tonal`, `steps.color`, `steps.detail`, `vector` |
| Relief (phase 4) | the parts its stage reads, plus `depth` |

So moving the dither slider does not rerun the trace, and changing a vector setting does not rerun the preview.

**Running.** A run starts by building its request from the current document, so a request is never older than the state it was sent in. There is no stored payload that could go stale. At most one run is in flight per scheduler, and a newer change replaces a pending one; it never queues behind it. `enabled` stops a scheduler while its tab is closed. The trace scheduler also waits for a gesture to end before running.

**Committing.** When a run finishes, its result is committed only if the run's input version is still the scheduler's current input version. Otherwise it is dropped. Then, if the scheduler is dirty, a new run starts from the current document. The input version is the version check: it changes exactly when something the scheduler reads changes. That way a trace is not thrown away because the dither slider moved during it, but it is thrown away if anything it read has changed.

**Errors.** When a run rejects, `fail` records the error with its input version in `renderStore`, and the UI shows it once. The scheduler does not retry. It runs again only when its dependencies change again. An out-of-memory error also triggers the WASM instance reset described in section 5.

**Export does not use a scheduler.** It is a single call with the document as it was when the user clicked. It writes that document even if the user changes something while it runs.

The scheduler is plain TypeScript with an injected `run`, so it is tested in Node with a fake worker whose promises the test resolves in any order (#19).

## 3. What happens to the existing stores

| Today | After phase 1 |
|---|---|
| `layerStore` (the current document model) | Removed. Replaced by `documentStore`. |
| `imageStore` image fields: `originalBuffer`, `originalBitmap`, `metadata`, `previewBuffer`, `previewDimensions` | Removed. The document holds the source and the scale; results go in `renderStore`. |
| `imageStore` view fields: zoom, pan, tool, split, substrate mask | Kept, renamed `viewStore`. View state is not part of the document and not undoable. |
| `imageStore` results (`previewProcessedBuffer`, `depthHeightMapBuffer`) and status | New `renderStore`: each scheduler's latest committed result and its error, plus export progress. |
| `editStore` settings: `tonal`, `color`, `detail`, `geometry`, `dither`, `vector`, `depth` | Move into the document. |
| `editStore` history | Moves into `documentStore`. The begin and commit logic is kept, and now snapshots the document. |
| `editStore` vector result and its edits: cutline, smoothing, removing and toggling layers | The trace result is derived, so it moves to `renderStore` and leaves the undo history. The cutline and smoothing actions keep acting on it until phase 2. |

**Vector edits lose undo until phase 2.** Cutline generation, node smoothing, and removing or toggling a vector layer will not be undoable during that time. This is recorded on #32.

### Multi-layer compositing is removed

Confirmed by the owner. Removed:

- `src/store/layerStore.ts`, `src/lib/compositor.ts`, `src/types/layer.ts`
- `src/components/panels/LayersPanel.tsx` and its CSS
- text layers: `src/lib/text-layer.ts`, `src/components/dialogs/TextLayerDialog.tsx` and its CSS, and `tests/unit/text-layer.test.ts`
- multi-image import
- placing the image on a larger blank canvas. `CanvasSizeDialog`'s "canvas resize" mode goes with it; positioning an image on a larger work area is done in LightBurn.
- the Layers tab and the Layer menu: new, duplicate, merge, flatten, reorder, cycle
- the layer selector and alignment controls in `ToolSubheader`, the move and scale handles in `PreviewCanvas`, the Target Layer selector in `AdjustmentsPanel`, and the export scope selector in `ExportPanel` (#22)
- the layer tests in `tests/unit/history-and-layers.test.ts`. The history tests there are rewritten against the document.

Changes that follow:

- Opening or dropping a second image replaces the document, after a confirmation if there are unsaved edits. Dropping several files opens the first and says the rest were ignored.
- `CanvasSizeDialog` becomes the size dialog of section 1: width or height in mm or inches for the current crop, with the DPI shown as derived and the file's DPI offered as a suggestion.
- The crop overlay writes `steps.crop` through a gesture instead of shifting layer transforms.
- The material test grid's raster option opens the grid as a new document with its scale set, instead of adding a layer. Its vector option is unchanged. Both are reworked in phase 3 (#40).
- `GeometryTransform` loses `rotation`, `flipHorizontal` and `flipVertical`. They are stored and sent to the worker today, but nothing applies them and no control sets them. A 90-degree rotate is tracked as its own issue. Crop is kept.

## 4. Tracing and relief take their input from the pipeline

Both run in the worker and start from `render`.

- **Tracer (phase 2).** `trace(doc, target)` renders `prepared` at `nativeTarget(doc)` by default. It converts the vector settings from millimetres with `pxPerMm`, traces, and scales the paths by `1 / pxPerMm`, so the result is in millimetres. The overlay draws it at any zoom, and SVG and DXF write it directly (#30). This replaces today's tracing of the unadjusted preview (#23). Transparency is already white, so #18 holds for tracing without the tracer reading alpha.
- **Relief (phase 4).** `relief(doc, target, stage)` renders `prepared` for tonal relief, or `source` for a photo sent to the depth model. It returns a heightmap with its `pxPerMm`. The 3D view asks for the preview target and export asks for the native target. Making the view and the export read one buffer (#42) is a choice of target inside phase 4.

What phases 2 and 4 add:

- their algorithms
- their worker function bodies
- their settings in `doc.vector` and `doc.depth`
- their scheduler instances with their `select` functions

What they do not need to change: the document's shape outside their own settings, `render`, the stages, the targets, the scheduler class or the history.

**Background removal (phase 5)** produces a mask that has to be applied before flattening. It will be a new step between crop and flatten, still within the `source` stage. The step order leaves room for it.

## 5. Worker, memory and size limits

### One worker

`src/workers/pool.ts` creates up to eight workers, and `comlink-setup.ts` hands out the first idle one. Each would need its own copy of the source. The pool is removed. There is one image worker, and `getComlinkWorker()` returns its proxy.

Sharing one source between several workers would need a `SharedArrayBuffer`, which requires cross-origin isolation headers on the Vercel deployment. If phase 2 finds that a native-resolution trace blocks the preview for too long, that is the route. It is not part of phase 1.

### Who holds what

| Item | Lives in | Owned and freed by |
|---|---|---|
| Encoded file (`File`) | Main thread and worker (a `Blob` reference, not a copy) | `documentStore`; dropped when another file is loaded |
| Decoded source, RGBA8 | WASM memory, allocated once at load | The worker's `SourceHandle`; `deallocate` on `releaseSource`, which runs when another file is loaded |
| `source`-stage render at the preview target | WASM memory | The worker's cache, keyed by (source, crop, 2048 px target). One entry. Freed and replaced when the crop changes. The 1024 px gesture target (section 2) is derived from this entry by a linear-light halving, not from the source, so gestures and gesture ends do not evict each other. |
| Preview working copy for steps 4 to 6 | WASM memory, preview size | The run, freed in a `finally`. Needed because the cached entry must stay unmodified. |
| `source`-stage render at the native target | WASM memory, for the length of one run | The run. Steps 4 to 6 run in place on it, so there is no separate working copy at native size. Freed in a `finally`; not cached in phase 1. |
| Preview result | Copied out of WASM into a JavaScript `ArrayBuffer`, transferred to the main thread | `renderStore`; replaced by the next commit |
| Export file | Encoded in the worker in row chunks read straight from WASM memory, streamed through `CompressionStream` | Transferred to the main thread as the finished file bytes |

`prepare_source` returns a pointer to a new buffer of `dstW * dstH * 4` bytes. The caller owns it and frees it with the existing `deallocate(ptr, len)`, in a `finally`. That is the same contract as `allocate`.

**Allocation failure is reported, not trapped.** `allocate` uses `Vec::with_capacity`, which aborts when memory runs out; in WASM that is a trap, and the instance cannot be used afterwards. A new export, `try_allocate(size) -> ptr`, reserves with `Vec::try_reserve_exact` and returns null on failure. The two large buffers, the source and the native render, are allocated with it, so the worker can report "too large for this device" and keep the instance. The instance reset below remains for traps inside a step.

**Decoding in strips.** `createImageBitmap(file, { imageOrientation: 'from-image' })` decodes the file. The worker then:

1. allocates the source buffer in WASM with `try_allocate`
2. draws one horizontal band of the bitmap into a band-sized `OffscreenCanvas`, at most 4 megapixels
3. reads the band with `getImageData` and copies it into the source buffer
4. repeats for the next band, then closes the bitmap

The full-size canvas and the full-size `ImageData` never exist. That also removes any dependence on the canvas area limit, including iOS's 4,096 x 4,096 px (16.7 MP, an area limit). The limits that remain are what `createImageBitmap` can decode and what WASM memory can hold, and both are detected by failure.

The 2D canvas stores premultiplied colour whatever `premultiplyAlpha` asks for, so `getImageData` returns values that went through premultiplication and back. Low-alpha pixels lose some colour precision on the way. That does not matter here: flattening multiplies by alpha again, and the result differs by at most one level from flattening the file's exact values. The #18 test compares at the WASM level, where it is exact.

### Peak and steady-state memory

During a native-resolution run on a source of N pixels, WASM memory holds about **17 bytes per pixel**:

- 4 bytes for the source
- 4 bytes for the native `source`-stage render, which steps 4 to 6 modify in place
- up to 9 bytes of scratch for the largest single step:
  - adaptive threshold: 1 byte of grey plus 8 bytes of integral image
  - sharpening after its rework: 8 bytes
  - dither: 4 bytes

Today's sharpening alone would need 24 bytes, for 32 bytes per pixel. Its rework in #16 is part of this design.

**WASM memory never shrinks.** It can only grow; the proposal to release memory (`memory.discard` in the WebAssembly memory-control proposal) is at an early stage and not shipped. So after a large run, the worker would keep the high-water mark for as long as the page is open.

To give the memory back, after any run that grew WASM memory beyond the steady-state size plus 256 MB, the worker:

1. discards the instance and instantiates a new one from the compiled module, which takes milliseconds
2. decodes the source again from the `File`, which takes about as long as the original load
3. lets the preview cache refill on the next preview run

The same reset follows a trap inside a step. Nothing else lives in WASM between runs, so the reset is safe.

**At load,** with strip decoding, the peak is the decoded `ImageBitmap` (about 4 bytes per pixel, outside WASM) plus the source buffer (4 bytes per pixel, inside WASM) plus one band: about **8 bytes per pixel**. Without strips it would be about 16 bytes per pixel outside WASM plus 4 inside. The re-decode after an instance reset follows the same path, with the same peak.

**Steady state** is the source plus the preview cache, about `4N + 32 MB`. For a 6000x4000 photo that is about 130 MB, and for a 139-megapixel scan about 590 MB.

### Largest accepted source

**The real limit is what fails on this device.** It is detected at run time: `createImageBitmap` rejects, or `try_allocate` returns null for the source or the native render. No per-browser table is relied on. Strip decoding removes canvas size from the question.

**There is also a ceiling of 150 megapixels.** In Chromium 153 (measured in this environment), WASM memory grows to 4 GiB, and 17 bytes per pixel puts a 150 MP export at about 2.5 GB. Sources above 150 MP are refused without trying. The ceiling is not a promise:
- A contiguous 2.5 GB of WASM memory will not be available on many machines, and far less on a phone.
- The app and its messages do not claim that 150 MP is supported.

For reference, an A4 scan at 1200 DPI is 139 MP (9921 x 14031). Firefox and Safari were not measured, since only Chromium is installed here.

**What the user sees when a limit is hit:** a message saying what failed on this device (decoding, or memory for the source or for the export) and the image's pixel size. They can then cancel or open the image at a reduced resolution they choose. When reduced, the document's source records both the file's size and the size opened, and the size dialog shows the reduction. A smaller image is never substituted silently.

### Export blocks the preview, and shows progress

A synchronous WASM call cannot be interrupted, and there is one worker. While an export runs, preview runs wait. The preview scheduler stays dirty and runs as soon as the export finishes, and the preview shows "Paused while exporting".

The export reports progress through a callback passed with `Comlink.proxy`. It is called at the boundaries between the calls that actually exist:

- preparing the source (`prepare_source`)
- processing: steps 4 to 6 are one `process_pipeline` call, so adjusting and dithering are reported as one stage
- encoding, which reports a percentage, since it is chunked in JavaScript

A Cancel button takes effect at the next boundary. `process_pipeline` is split later only if processing alone turns out too long to sit through without progress.

## 6. Export

- **Raster export** calls `exportRaster(doc, format, onProgress)`. The worker renders `final` at `nativeTarget(doc)` and encodes it.
- **PNG** gets a new 8-bit encoder (greyscale or RGBA) that writes `pHYs` in pixels per metre. `canvas.toBlob` cannot write `pHYs`. The existing 16-bit encoder writes uncompressed deflate blocks, so a full-size file would be several times larger than needed. Both encoders switch to `CompressionStream('deflate')`, which browsers, workers and Node provide, so no dependency is added.
- **BMP** already writes pixels per metre; it now gets the DPI from the document.
- **JPEG and WebP** are removed from raster export (confirmed by the owner).
- **The Export panel** shows the size and DPI computed from the same target and scale that the export uses. It has no DPI input of its own, and export is disabled while the size is not set.
- **Heightmap exports** in `DepthMapPanel` and the second heightmap button in `ExportPanel` are preview-sized too. They belong to #46 and #42 in phase 4 and are left alone, except that they read the document's DPI.

## 7. Tests

New tests follow `tests/unit/dither-properties.test.ts`: an independent reference implementation in the test, compared with the WASM through `tests/helpers/wasm.ts`.

| Issue | Test | Property measured |
|---|---|---|
| #15 | Crop, then change the size, tone, detail and dither in turn | The crop and scale are unchanged after each edit; the size follows the crop |
| #15 | Size derivation | For several crops and scales, width, height and DPI equal the formulas in section 1; cropping keeps `mmPerPx` |
| #15 | Size not set | Length-based steps are skipped; export refuses; setting the size enables both |
| #16 | `prepare_source` against a reference linear-light box filter | Every output pixel within 1 level of the reference |
| #16 | One-pixel black and white checkerboard downsampled by two | Every output pixel is 188, give or take 1 |
| #16 | Preview against a downscaled native render, stage `prepared`, on a synthetic photo-like image with tone, colour and sharpening | Mean absolute difference at most 1.0 level, 99th percentile at most 6 levels |
| #16 | Adaptive threshold at two resolutions, with the block in mm | At most 2% of pixels differ after downscaling and thresholding again |
| #16 | Dither at two resolutions | Mean density over blocks of the same physical size (16 preview pixels across) matches within 2 levels |
| #16 | `toRunParams` | Converted lengths for several values of `pxPerMm`; block sizes odd and at least 3 |
| #16 | Sharpening at a radius over 5 px | The kernel extent follows sigma; no clamp |
| #18 | A logo on transparency against the same logo composited onto white by the test's reference | Identical bytes after flattening; identical dither output, trace (path count and coordinates) and heightmap |
| #17 | Export of a 3000x2000 source at a given scale | The decoded PNG and BMP are 3000x2000; `pHYs` and pixels per metre decode to `1000 / mmPerPx` within rounding to whole pixels per metre |
| #17 | 8-bit PNG round trip through an independent inflate and decoder | Every byte matches the source |
| #19 | Scheduler with a fake worker: start a run, change something it reads, resolve the old run, then the new one | The old result is never committed; the newest is committed last; no request is built from older state |
| #19 | Scheduler dependencies | A change to a part a scheduler does not read starts no run and does not discard a run in flight |
| #19 | Scheduler errors | A rejected run reports once and does not rerun until its dependencies change |
| #21 | Each kind of edit through `edit` and gestures, then undo | The previous document is restored, compared by value |
| #21 | No-op changes | Both stacks are unchanged |
| #21 | Undo, edit and load during a gesture; a gesture whose end never arrives | Each behaves as defined in section 1 |
| #22 | Reset All | Restores every step's defaults |
| #22 | Auto Levels on a synthetic image | Sets the black and white points from the histogram's percentiles |
| #22 | Sharpening before the threshold | Sharpening changes the thresholded result |

The tolerances in the #16 rows are estimates. If the measured error is larger for a reason I can explain, I will say so in the pull request rather than loosen the numbers silently. CLAHE is left out of the pixel comparison until #36 is fixed, because its edge bands depend on the image size.

Browser checks for each pull request that changes the UI:

- load a 6000x4000 image and a transparent PNG
- set the size
- take screenshots of the preview, size dialog and export panel at desktop, tablet and phone widths
- export, and check the file's pixel size and DPI
- for #16, also measure the tone-only preview budget

## 8. Order of work

1. **#15, part 1: removal.** Layers, text layers, multi-image import and canvas padding, as listed in section 3. A loaded image goes straight into `imageStore`, as it did before layers existed. Removing layers first avoids adapting the layer UI to a model that would then delete it. It also means `main` never has layer operations that cannot be undone.
2. **#15, part 2: document and stores.** `documentStore`, `viewStore` and `renderStore` are added, and the existing panels are adapted to read and write the document. The document becomes the only owner of the source, scale, steps and history, and the size dialog becomes the first step. The preview still goes through the old worker path until #16.
3. **#16 and #19 together.** The pipeline, the single worker and the schedulers replace `useWorker.ts` and the pool. Building #16 on the old coordinator and then rewriting it for #19 would mean writing the coordinator twice.
4. **#18.** Flattening is already a step from #16. This adds its tests across dither, trace and relief, and removes the alpha dropdown.
5. **#17.** Full-resolution export, the PNG encoder and export progress.
6. **#21.** Every control goes through `edit` or a gesture.
7. **#22.** Mislabeled controls.
8. **#20.** The viewport, on the new preview result.

## 9. Corrections and gaps in the issues

- **#16 says `imageWorker.ts` has 1,300 lines.** Phase 0 already brought it to 238 lines of orchestration.
- **#16 lists dither scale as a length to store in mm.** It stays in dots, and the comparison across resolutions uses block density.
- **#16 asks for a stated tolerance without giving one.** Section 7 proposes numbers.
- **#16 does not mention the sharpening clamp** at 5 px or its 24 bytes per pixel of scratch memory. Both are reworked as part of #16.
- **#17 does not mention that the PNG encoder is uncompressed.**
- **#17 suggests reading the file's DPI for the size.** The file's DPI is now only a suggestion, and the user sets the size explicitly.
- **#15 does not mention the rotation and flip fields,** which are stored but never applied. They are removed, and a 90-degree rotate gets its own issue.
- **#18: images with transparency export opaque,** with white where they were transparent. That is the intended meaning of "no burn", but transparency is not kept for use in other programs.
- **Saved recipes need no migration.** Nothing can import one today, so there are no version 1 files to load. The format version is bumped and the built-in presets are converted to millimetres.
