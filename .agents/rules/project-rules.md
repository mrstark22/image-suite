# Image Suite — Project Rules

## Architecture Mandates

1. **100% Client-Side**: No image data may ever be transmitted to a backend server. All processing happens in-browser via Web Workers and WebAssembly. Violations of this rule are unacceptable.

2. **Main Thread = UI Only**: The browser's main thread handles only DOM updates, Zustand state, and low-resolution previews. All heavy computation (pixel manipulation, vector math, AI inference) MUST occur in Web Workers.

3. **Transferable Objects**: When passing image data between the main thread and workers, always use `Transferable` objects (ArrayBuffer transfer). Never serialize large image data as JSON or Base64 strings.

4. **Memory Safety**: Explicitly free Wasm memory pointers when Rust operations conclude. Every `wasm_bindgen` function that allocates must have a corresponding deallocation path. Monitor for memory leaks in worker lifecycle.

---

## Code Standards

### TypeScript
- Strict mode enabled (`"strict": true` in tsconfig).
- No `any` types except in Wasm FFI boundary layers, and those must be documented with `// SAFETY:` comments.
- All public functions and React components must have JSDoc documentation.
- Prefer `const` over `let`. Never use `var`.
- Use named exports, not default exports.
- All worker message types must be defined in `src/types/worker-messages.ts`.

### Rust (Wasm)
- All public Wasm functions must be annotated with `#[wasm_bindgen]`.
- Use `Result<T, JsValue>` for fallible operations exposed to JS.
- Document `# Safety` sections for any `unsafe` blocks.
- Run `cargo clippy` and `cargo fmt` before committing Wasm changes.
- All pixel buffer inputs must validate dimensions before processing.

### CSS
- Use CSS Modules for component-scoped styles.
- Global design tokens (colors, spacing, typography, shadows) live in `src/index.css` as CSS custom properties (`--color-*`, `--space-*`, `--font-*`).
- Dark theme is the default. Light theme is opt-in via `[data-theme="light"]`.
- No inline styles except for dynamic canvas-related positioning.
- No Tailwind — use vanilla CSS with the design token system.

### React
- Functional components only. No class components.
- Use Zustand stores for shared state. Avoid prop drilling beyond 2 levels.
- Canvas rendering uses `useRef` + imperative drawing, not React DOM.
- Worker communication goes through Comlink proxies initialized in custom hooks.
- Memoize expensive computations with `useMemo` / `useCallback` where profiling indicates benefit.

---

## File & Naming Conventions

| Item | Convention | Example |
|---|---|---|
| React components | PascalCase `.tsx` | `PreviewCanvas.tsx` |
| Hooks | camelCase with `use` prefix | `useWorker.ts` |
| Stores | camelCase with `Store` suffix | `imageStore.ts` |
| Workers | camelCase with `Worker` suffix | `ditherWorker.ts` |
| Rust modules | snake_case `.rs` | `floyd_steinberg.rs` |
| Types | PascalCase interfaces, camelCase fields | `EditStep`, `ditherConfig` |
| CSS Modules | camelCase class names | `styles.canvasContainer` |
| Test files | `*.test.ts` / `*.test.tsx` | `adjustments.test.ts` |

---

## Performance Rules

1. **Dual-Resolution Pipeline**: Interactive previews operate on downscaled images (max 2048px longest edge). Full-resolution processing only runs during export.

2. **Debounce Slider Inputs**: All slider controls must debounce worker calls by at least 16ms (one frame) to prevent worker queue flooding.

3. **Worker Pool Sizing**: Size the worker pool to `Math.max(2, navigator.hardwareConcurrency - 1)`. Reserve one core for UI responsiveness.

4. **ONNX Model Loading**: AI models must be lazy-loaded on first use, not at app startup. Cache downloaded models in IndexedDB via localForage. Show download progress to the user.

5. **No Base64 for Images**: Keep image data as `Blob`, `File`, `ImageBitmap`, or `ArrayBuffer`. Base64 encoding wastes ~33% memory and is prohibited for image payloads.

6. **OffscreenCanvas First**: Use `OffscreenCanvas` in workers for hardware-accelerated drawing. Implement a software (2D context) fallback for browsers without support.

---

## Git & Workflow

- Commit messages follow Conventional Commits: `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `test:`, `chore:`.
- The `src/wasm/pkg/` directory is `.gitignore`d — it is a build artifact.
- ONNX model files in `public/models/` are tracked with Git LFS (they are 20-80MB).
- Branch naming: `phase-N/feature-name` (e.g., `phase-2/wasm-adjustments`).

---

## Testing Requirements

- **NO AUTOMATED BROWSER TESTING**: Never launch browser subagents or automated browser testing. The user performs all manual and visual browser UI testing.
- All TypeScript utility functions and Wasm bridges must have Vitest CLI unit tests (`npx vitest run`).
- Visual regression tests compare output image hashes against committed baselines in terminal tests.
- Performance benchmark tests assert execution time thresholds for critical operations in CLI tests.
- New dithering or vectorization algorithms must include a test with a known reference output.

---

## Dependency Policy

- Minimize runtime dependencies. Prefer Web APIs and custom implementations.
- Any new npm dependency must be justified by at least one of: (a) significant implementation complexity saved, (b) widely maintained with active security patches, (c) no viable Web API alternative.
- Wasm crate dependencies must be `no_std` compatible where possible to minimize binary size.
- Pin exact versions for Wasm toolchain (`wasm-pack`, `wasm-bindgen`) in documentation.
