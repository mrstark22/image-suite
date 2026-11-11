# Image Suite — Project Rules

Read `.agents/AGENTS.md` first. This file holds the detailed coding standards.

## TypeScript

- Strict mode. `noUnusedLocals` and `noUnusedParameters` are on, so remove what you stop using.
- No `any`, except at the WebAssembly boundary, where it carries a `// SAFETY:` comment saying why.
- Public functions and React components have a JSDoc comment saying what they do.
- `const` over `let`; never `var`. Named exports, not default exports.
- Worker message types are defined in `src/types/worker-messages.ts`.

## Rust

- The core exports `#[no_mangle] pub extern "C"` functions and has no crate dependencies. Keep it that way unless a dependency clearly earns its place.
- Validate dimensions and null pointers at the top of every exported function.
- Keep `unsafe` to the exported boundary in `lib.rs`.
- Run `cargo fmt` in `src/wasm` before committing Rust changes; CI checks it. Run `cargo clippy` too: it reports style warnings in older code, which you fix when you touch that code. Do not add new ones.
- New behaviour gets a native test in `src/wasm/src/tests.rs` and a property test in `tests/unit/`.

## CSS

- CSS Modules for component styles; class names in camelCase.
- Design tokens (colour, spacing, type) are CSS custom properties in `src/index.css`.
- No inline styles except values computed at run time. The existing code has about 200 inline style blocks; they are removed as part of the UI redesign (issue #55), so do not add more.
- No Tailwind.

## React

- Function components only.
- Shared state lives in Zustand stores.
- Canvases are drawn imperatively through refs.
- The worker is reached through the Comlink proxy from `src/lib/comlink-setup.ts`.

## Naming

| Item | Convention | Example |
|---|---|---|
| React components | PascalCase `.tsx` | `PreviewCanvas.tsx` |
| Hooks | camelCase with `use` prefix | `useWorker.ts` |
| Stores | camelCase with `Store` suffix | `documentStore.ts` |
| Rust modules | snake_case `.rs` | `dither.rs` |
| Types | PascalCase interfaces, camelCase fields | `EditStep` |
| Test files | `*.test.ts` | `dither-properties.test.ts` |

## Performance

- Interactive previews run on a downscaled image (longest edge 2048 px). Full-resolution processing is for export; phase 1 builds this (issue #16).
- A newer request replaces a queued one; results from an outdated request are discarded.
- Models are loaded on first use, cached locally, and show download progress.

## Git

- Commit messages: a short imperative summary line, then a body saying what changed and why. Reference the issue (`Refs #12`, or `Fixes #12` when the commit completes it).
- Commit the rebuilt `src/wasm/pkg/image_suite_wasm.wasm` with any Rust change.
- Do not commit build output (`dist/`), `node_modules/` or `src/wasm/target/`.

## Tests

- Every algorithm has a test of its defining property. See `tests/unit/dither-properties.test.ts` for the pattern: an independent reference implementation, compared pixel for pixel.
- Encoders and exporters are tested by decoding or parsing their output and comparing it with the source, including physical size where the format carries it.
- `it.fails` marks a known, tracked defect; flip it to `it` in the commit that fixes the defect.
- UI and layout changes are checked in a headless browser at desktop, tablet and phone widths, with screenshots.

## Dependencies

- Keep runtime dependencies few. Add one only when it saves significant complexity, is actively maintained, and no web API does the job.
- Third-party model files and runtimes are self-hosted at pinned versions, not fetched from a CDN at run time (issue #43 moves the current AI depth model to this).
