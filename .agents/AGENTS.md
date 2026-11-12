# Image Suite — Agent Instructions

## What this project is

A browser tool for preparing images for laser engraving and CNC work. It is being rebuilt around three workflows: image to clean vector, photo to engrave-ready image, and image to 3D relief. All image processing happens in the browser and images are never uploaded.

**Read `docs/plan.md` first.** It is the agreed plan: the goal, what "good" means for each workflow, what is kept and dropped, the architecture, the phases, and the known defects. Work is tracked in GitHub issues; the plan's "Tracking" table lists the tracking issue for each phase, and each work item states its problem, what to do and a "done when" test.

The owner uses two CO2 lasers (60 W and 155 W) with LightBurn, and does not review code line by line. Tests and browser checks are what keep the work honest.

## Working rules

1. **Names must match what runs.** Do not label code with an algorithm it does not implement. The previous code base did this repeatedly (a hash called blue noise, a row scan called a Hilbert curve) and the tests did not catch it.
2. **Every algorithm comes with a test of its defining property**: tone density for a dither, geometry for a tracer, decoded bytes for an encoder, physical size for an export. A test that only checks that output exists or has the right length does not count.
3. **One implementation per operation.** The Rust core is the only implementation of each algorithm. Do not add JavaScript or GPU fallbacks that reimplement it.
4. **Every control does something.** A setting in the UI is honoured end to end, or it is removed. No dead options.
5. **Report failures; never substitute.** If a model or the engine fails to load, show the error. Do not silently return a different result.
6. **Work from an issue.** Keep a change to what its issue asks for, reference the issue number in the commit, and when you find something out of scope, open or update an issue instead of fixing it in passing.
7. **Say what you verified.** State which tests you ran and what you checked in a browser, and what you did not.

## Tech stack

- **Build**: Vite 6, TypeScript in strict mode
- **UI**: React 19, CSS Modules with design tokens in `src/index.css` (no Tailwind)
- **State**: Zustand
- **Processing core**: Rust, compiled to WebAssembly with `rustc` directly. It exports plain `extern "C"` functions; there is no wasm-bindgen or wasm-pack.
- **Workers**: a Web Worker reached through Comlink
- **AI depth**: ONNX Runtime Web, model cached with localForage
- **Tests**: Vitest (drives the compiled WASM from Node) and `cargo test`
- **CI**: GitHub Actions, `.github/workflows/ci.yml`
- **Hosting**: Vercel

## Commands

```
npm run dev          # dev server on http://localhost:5173
npm test             # Vitest
npm run test:rust    # native Rust tests
npm run typecheck    # tsc --noEmit over src and tests
npm run build:wasm   # recompile the Rust core
npm run build        # production build
```

Run `npm run typecheck` and `npm test` before every commit. Run `npm run test:rust` after Rust changes.

## Changing the Rust core

1. Edit `src/wasm/src/*.rs`.
2. Run `npm run build:wasm`. This needs `rustup target add wasm32-unknown-unknown`.
3. Run `npm test`. The tests load `src/wasm/pkg/image_suite_wasm.wasm`, so they only see your change after step 2.
4. Commit the rebuilt `.wasm` together with the source. It is committed on purpose: the Vercel build has no Rust toolchain. CI tests the committed binary and then a fresh build, so a stale binary fails.

The exported functions take long positional argument lists, and the call must match the Rust signature in `src/wasm/src/lib.rs` exactly: WASM ignores extra arguments and fills missing ones with zero, so a mismatch shifts settings silently. For `process_pipeline` and `process_depth` the order is also written in `src/wasm/wasm-bridge.ts` and `tests/helpers/wasm.ts`. For `process_trace` it is written once, in `traceImageAt` in `src/lib/trace-call.ts`, which the bridge and the tests both call.

## Architecture rules

1. **Images stay in the browser.** No image data is sent to a server. Profiles and settings may sync once accounts exist (phase 6); images never do.
2. **Heavy work runs in the worker**, not on the main thread.
3. **Transfer, do not copy**: pass `ArrayBuffer`s as transferables; never encode images as Base64.
4. **Free WASM memory**: every `allocate` has a `deallocate` in a `finally` block, and views are re-read after any call that can grow memory.
5. **Physical units**: anything measured in the real world is stored in millimetres. Raster export renders at the source's full resolution and writes the document's DPI (#17); vector exports trace again at full resolution and are written in millimetres (#23, #30); the heightmap export stays preview-sized until phase 4.

## Tests

- Tests live in `tests/unit/`; shared helpers are in `tests/helpers/`.
- `it.fails` marks a known, tracked defect. It passes while the defect exists. When you fix the defect, change it to `it` in the same commit.
- Browser checks are allowed: run the app in a headless browser to take screenshots and verify UI and layout changes at desktop, tablet and phone widths. The owner also tests the UI by hand, so say what was and was not checked in a browser.

## File layout

- `src/wasm/src/` — Rust core (snake_case modules)
- `src/wasm/pkg/` — compiled core (committed)
- `src/wasm/wasm-bridge.ts` — loads the core, moves buffers in and out
- `src/workers/` — the one Web Worker: its entry, its API (`pipeline-api.ts`) and strip decoding
- `src/store/` — Zustand stores (`*Store.ts`)
- `src/components/` — React components (PascalCase)
- `src/hooks/` — React hooks (`use*`)
- `src/lib/` — TypeScript utilities, encoders and exporters
- `src/types/` — shared types; worker message types go in `worker-messages.ts`
- `scripts/` — build scripts
- `tests/` — Vitest tests
- `docs/plan.md` — the plan

Detailed coding standards are in `rules/project-rules.md`.

## Domain terms

| Term | Meaning |
|---|---|
| Line interval | Distance between laser scan lines; with the image size it sets the dot grid |
| Pass-Through | LightBurn image mode that sends a pre-dithered image without resampling or re-dithering |
| Grayscale mode | LightBurn image mode where power varies per pixel; used for relief on CO2 lasers |
| Calibration | Saved settings and response curve for one machine, material and job type |
| Calibration card | A test pattern burned once to produce a calibration |
| Heightmap | Greyscale image where brightness is depth; exported as 16-bit PNG |
| Centreline trace | A single path along the middle of a drawn stroke, not an outline around it |
| Recipe | The ordered list of edit steps applied to an image, saved as JSON |
