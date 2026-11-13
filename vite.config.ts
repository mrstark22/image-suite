import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
  ],
  worker: {
    format: 'es',
    plugins: () => [wasm()],
  },
  build: {
    target: 'esnext',
  },
  test: {
    // Agent working copies live under .claude/worktrees: their tests are theirs to run, not this checkout's.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
  // Cross-origin isolation (threads in ONNX Runtime). Same values as vercel.json.
  // require-corp, not credentialless: everything the app loads is its own
  // (code, runtime .wasm, models in public/models), so nothing needs the looser
  // policy, and Safari supports require-corp but not credentialless.
  server: {
    port: 5173,
    headers: ISOLATION_HEADERS,
  },
  preview: {
    headers: ISOLATION_HEADERS,
  },
});
