# Image Suite

A browser tool for preparing images for laser engraving and CNC work. All image processing happens in the browser; images are never uploaded.

It is built around three jobs:

1. **Image to clean vector**: turn a logo, drawing or scan into SVG or DXF paths in millimetres, with outline or centreline tracing.
2. **Photo to engrave-ready image**: resample a photo to the machine's dot grid, dither it and export a 1-bit PNG or BMP with its DPI, for LightBurn's Pass-Through mode.
3. **Image to 3D relief**: turn a photo (AI depth), a logo (bevelled shape) or a tonal image into one heightmap, shown in 3D and exported as a full-resolution 16-bit PNG for LightBurn's Grayscale mode.

Also:

- **Machines & Materials** (File menu): machine, material, thickness and calibration profiles, stored in this browser. Move them to another computer by exporting a file and importing it there. There is no sign-in or sync.
- **Calibrate** (File menu): photo, cut and depth calibration cards, exported as a LightBurn project or plain files; the results are saved as calibrations.
- **Background removal**: an undoable step run by the ISNet model on this device.
- Images open with a physical size: the file's DPI, or an assumed DPI (the last one you applied, else 300) that the Size step marks as assumed.
- The two models (`public/models/`) and the ONNX Runtime WebAssembly are served by the app itself, pinned by SHA-256, downloaded on first use and cached in the browser.

The plan, with what was kept, what was removed and the state of each phase, is in [docs/plan.md](docs/plan.md). Work is tracked in GitHub issues.

## Status

Phases 0 to 5 and the UI redesign are built and tested. Accounts and sync (phase 6) are not being built. Not yet confirmed on the owner's machines: the LightBurn project format, whether Grayscale mode uses more than 8 bits, and a calibration card read back from a real burn. See "Open questions" in the plan.

## Requirements

- Node.js 22
- Rust with the `wasm32-unknown-unknown` target, only if you change the Rust code:
  `rustup target add wasm32-unknown-unknown`

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Start the dev server at http://localhost:5173 |
| `npm test` | Run the Vitest suite (drives the compiled WASM from Node; skips `.claude/`) |
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
