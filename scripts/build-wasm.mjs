/**
 * Compiles the Rust core (src/wasm/src) to src/wasm/pkg/image_suite_wasm.wasm.
 *
 * The compiled binary is committed, so hosts without a Rust toolchain (such as
 * the Vercel build) use it as is. Run this after changing any Rust source and
 * commit the result. Pass --require-rust to fail when the toolchain is missing
 * instead of falling back to the committed binary (CI does this).
 *
 * Needs: rustc with the wasm32-unknown-unknown target
 *   rustup target add wasm32-unknown-unknown
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const OUT = 'src/wasm/pkg/image_suite_wasm.wasm';
const requireRust = process.argv.includes('--require-rust');

// rustup installs to ~/.cargo/bin, which is not always on PATH.
const cargoBin = path.join(process.env.USERPROFILE || process.env.HOME || '', '.cargo', 'bin');
process.env.PATH = cargoBin + path.delimiter + process.env.PATH;

try {
  execFileSync(
    'rustc',
    [
      '--edition', '2021',
      '--crate-type', 'cdylib',
      '--target', 'wasm32-unknown-unknown',
      '-C', 'opt-level=3',
      '-C', 'lto=yes',
      '-C', 'panic=abort',
      'src/wasm/src/lib.rs',
      '-o', OUT,
    ],
    { stdio: 'inherit' }
  );
  chmodSync(OUT, 0o644);
  console.log(`Compiled ${OUT}`);
} catch (err) {
  if (!requireRust && existsSync(OUT)) {
    console.log(`Rust toolchain not available; using the committed ${OUT}`);
  } else {
    console.error('Could not compile the Rust core. Is rustc installed with the wasm32-unknown-unknown target?');
    throw err;
  }
}
