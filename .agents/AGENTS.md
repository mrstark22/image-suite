# Image Suite — Agent Instructions

## Project Identity

**Image Suite** is a professional-grade, 100% client-side image preparation and vectorization engine built for precision manufacturing workflows (laser engraving, CNC routing, digital fabrication).

## Tech Stack

- **Bundler**: Vite 6+
- **UI**: React 19 + TypeScript (strict mode)
- **State**: Zustand
- **Styling**: CSS Modules + CSS custom properties (no Tailwind)
- **Processing**: Rust → WebAssembly (wasm-pack + wasm-bindgen)
- **Workers**: Web Workers with Comlink for typed async communication
- **AI**: ONNX Runtime Web (WebGL/WebGPU backends)
- **Storage**: localForage (IndexedDB) for models, presets, and recipes
- **Testing**: Vitest (unit + visual regression), cargo test (Rust)

## Key Architecture Rules

1. **Zero server processing** — all image data stays in-browser
2. **Main thread = UI only** — all heavy work runs in Web Workers
3. **Transferable Objects** — use ArrayBuffer transfer, never Base64 for images
4. **Dual-resolution** — preview at ≤2048px, export at original resolution
5. **Explicit Wasm memory management** — free pointers after use

## File Layout

- `src/components/` — React UI components (PascalCase)
- `src/store/` — Zustand stores (camelCase + `Store` suffix)
- `src/workers/` — Web Worker entry points (camelCase + `Worker` suffix)
- `src/wasm/src/` — Rust source for Wasm modules (snake_case)
- `src/lib/` — Pure TypeScript utilities
- `src/hooks/` — Custom React hooks (`use` prefix)
- `src/types/` — TypeScript type definitions
- `tests/` — unit, visual regression, and benchmarks

## When Making Changes

- Read `rules/project-rules.md` for detailed coding standards
- Use CodeGraph (`codegraph explore`) to understand existing code before editing
- Run `cargo clippy` and `cargo fmt` after Rust changes
- Run `npx vitest run` after TypeScript changes
- **NEVER run browser subagents or browser testing** — the user tests the browser UI manually. Only run CLI/terminal unit tests.
- Maintain all existing comments and documentation unless explicitly asked to remove them

## Domain Terminology

| Term | Meaning |
|---|---|
| Recipe | A serialized array of non-destructive edit steps (JSON) |
| Material Preset | Pre-configured filter/dither combinations for a physical substrate |
| Centerline Trace | Skeletonized single-pixel-wide vector paths for V-carving |
| Blue Noise | Void-and-cluster dithering producing organic, non-repeating patterns |
| EDT | Euclidean Distance Transform — converts binary masks to relief height maps |
| 16-bit Export | 65,536 grayscale levels for CNC depth precision (vs. 256 in 8-bit) |
