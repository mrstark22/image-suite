# Image Suite

A browser tool for preparing images for laser engraving and CNC work. All image processing happens in the browser; images are never uploaded.

It is being rebuilt around three jobs:

1. **Image to clean vector**: turn a logo, drawing or scan into paths worth sending to a machine.
2. **Photo to engrave-ready image**: turn a photograph into a dithered file sized for a given machine and material.
3. **Image to 3D relief**: turn a photo or logo into a heightmap for relief engraving.

The plan, with what is kept from the current code, what was removed and the order of work, is in [docs/plan.md](docs/plan.md). Work is tracked in GitHub issues; each phase has a tracking issue listed in the plan.

## Status

Phase 0 (tests around the kept code, removal of dropped code, CI) is done. The app runs and can load an image, adjust it, dither it, trace it and generate a heightmap, but several known defects remain until their phase. The most important one: exports are currently limited to the 2048-pixel preview and report the wrong physical size (issue #17). Do not rely on output size yet.

## Requirements

- Node.js 22
- Rust with the `wasm32-unknown-unknown` target, only if you change the Rust code:
  `rustup target add wasm32-unknown-unknown`

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Start the dev server at http://localhost:5173 |
| `npm test` | Run the Vitest suite (drives the compiled WASM from Node) |
| `npm run test:rust` | Run the native Rust unit tests |
| `npm run typecheck` | Typecheck the app and the tests |
| `npm run build:wasm` | Recompile the Rust core to `src/wasm/pkg/image_suite_wasm.wasm` |
| `npm run build` | Production build into `dist/` |

## How it is put together

- `src/wasm/src/`: the processing core in Rust (tonal adjustments, detail filters, dithering, tracing, heightmaps). It is the only implementation of each algorithm.
- `src/wasm/pkg/image_suite_wasm.wasm`: the compiled core. It is committed, so a host without Rust (the Vercel build) can use it. Rebuild and commit it whenever the Rust source changes; CI fails if they drift apart in behaviour.
- `src/wasm/wasm-bridge.ts`: loads the module and copies pixel buffers in and out of its memory.
- `src/workers/imageWorker.ts`: the Web Worker that runs the core off the main thread.
- `src/store/`: application state (Zustand).
- `src/components/`: the React interface.
- `src/lib/`: TypeScript utilities, including the PNG and BMP encoders and the SVG and DXF exporters.
- `tests/`: Vitest tests. `tests/helpers/wasm.ts` drives the compiled core directly.

## Tests

Tests check what each piece is supposed to do, not only that it produces output. The dithers are compared pixel for pixel with independent reference implementations of the published kernels, the tracer is checked against shapes with known geometry, and the encoders are decoded by a separate decoder and compared sample for sample.

A test marked `it.fails` records a known, tracked defect. It passes while the defect exists; when you fix the defect, change it to `it` in the same commit.

## Deployment

The app is a static site deployed on Vercel (`vercel.json`). The build runs `npm run build`, which uses the committed WASM binary when no Rust toolchain is present.
