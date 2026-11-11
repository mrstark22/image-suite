import type { ImageDocument } from '../types/document';
import type { RenderOutput, RenderTarget, Stage } from '../types/render';
import type { RustWasmEngine } from '../wasm/wasm-bridge';
import { cropRectOf } from './document-size';
import { pxPerMmOf } from './render-target';
import { toRunParams } from './run-params';

/**
 * Largest source accepted, in pixels (design section 5). Above it a source is
 * refused without trying. Below it, what fails on the device is reported.
 */
export const MAX_SOURCE_PIXELS = 150_000_000;

/** Identifies a `source`-stage render: the source, the crop and the target size. */
export function sourceStageKey(doc: ImageDocument, target: RenderTarget): string {
  const c = cropRectOf(doc);
  return `${doc.source.sourceId}|${c.x},${c.y},${c.width},${c.height}|${target.widthPx}x${target.heightPx}`;
}

/** Thrown when an image is larger than this device or the pipeline can hold. */
export class TooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TooLargeError';
  }
}

interface Held {
  ptr: number;
  width: number;
  height: number;
}

/** Options for one render. */
export interface RenderOptions {
  /**
   * Keep the `source`-stage render for the next call with the same source,
   * crop and target. One entry is kept; the preview, trace and relief use it.
   */
  cache?: boolean;
  /**
   * Use these pixels as the `source`-stage render instead of computing it.
   * Stopgap for background removal (phase 5), whose result is not yet a
   * pipeline step. Must be `target`-sized RGBA8.
   */
  sourceStagePixels?: ArrayBuffer;
}

/**
 * The pipeline, run on the WebAssembly core: holds the decoded source in WASM
 * memory and renders any stage of the document at any target (design
 * sections 2 and 5). The preview, export, tracing and relief all call
 * `render`; they differ only in the target and the stage.
 *
 * Runs in the worker in the browser, and directly in Node in tests.
 */
export class PipelineEngine {
  private source: (Held & { sourceId: string }) | null = null;
  private cache: (Held & { key: string }) | null = null;

  constructor(private readonly core: RustWasmEngine) {}

  /** True when the pixels of `sourceId` are held. */
  hasSource(sourceId: string): boolean {
    return this.source?.sourceId === sourceId;
  }

  /**
   * Reserves memory for a `width` x `height` source, to be filled with
   * `writeSourceRows`. Releases any previous source first. Throws a
   * `TooLargeError` when the image is over the ceiling or the memory cannot
   * be had.
   */
  beginSource(sourceId: string, width: number, height: number): void {
    this.releaseSource();
    if (width * height > MAX_SOURCE_PIXELS) {
      throw new TooLargeError(
        `This image is ${width} × ${height} px (${megapixels(width, height)} MP). Images over ${MAX_SOURCE_PIXELS / 1e6} MP are not opened.`
      );
    }
    const ptr = this.core.wasm.try_allocate(width * height * 4);
    if (!ptr) {
      throw new TooLargeError(
        `Not enough memory on this device to open a ${width} × ${height} px image (${megapixels(width, height)} MP).`
      );
    }
    this.source = { sourceId, ptr, width, height };
  }

  /**
   * Copies `rows` rows of RGBA8 pixels, starting at row `y`, into the source.
   * Returns true when any of them is not fully opaque.
   */
  writeSourceRows(y: number, pixels: Uint8Array | Uint8ClampedArray, rows: number): boolean {
    const src = this.requireSource();
    const bytes = src.width * rows * 4;
    if (y < 0 || y + rows > src.height || pixels.length < bytes) {
      throw new Error(`Rows ${y} to ${y + rows} do not fit the ${src.width} × ${src.height} source.`);
    }
    // Read the memory view now: an earlier call may have grown memory.
    new Uint8Array(this.core.wasm.memory.buffer, src.ptr + y * src.width * 4, bytes).set(pixels.subarray(0, bytes));
    for (let i = 3; i < bytes; i += 4) if (pixels[i] !== 255) return true;
    return false;
  }

  /** Holds `rgba` (`width` x `height` RGBA8) as the source `sourceId`. Returns whether it has transparency. */
  putSource(sourceId: string, rgba: ArrayBuffer, width: number, height: number): { hasAlpha: boolean } {
    if (rgba.byteLength !== width * height * 4) {
      throw new Error(`The pixels are ${rgba.byteLength} bytes, not ${width} × ${height} RGBA.`);
    }
    this.beginSource(sourceId, width, height);
    return { hasAlpha: this.writeSourceRows(0, new Uint8Array(rgba), height) };
  }

  /** Frees the source and the cached render. */
  releaseSource(): void {
    this.dropCache();
    if (this.source) {
      this.core.wasm.deallocate(this.source.ptr, this.source.width * this.source.height * 4);
      this.source = null;
    }
  }

  /**
   * Renders `doc` at `target`, up to `stage` (design section 2). The document
   * must name the source this engine holds.
   */
  render(doc: ImageDocument, target: RenderTarget, stage: Stage, options: RenderOptions = {}): RenderOutput {
    const pxPerMm = pxPerMmOf(doc, target);
    const bytes = target.widthPx * target.heightPx * 4;
    const wasm = this.core.wasm;

    // The source-stage render, either cached (left untouched) or owned by this call.
    let input: number;
    let owned: number | null = null;
    if (options.sourceStagePixels) {
      if (options.sourceStagePixels.byteLength !== bytes) {
        throw new Error('The replacement source pixels do not match the render target.');
      }
      owned = this.allocate(bytes, target);
      new Uint8Array(wasm.memory.buffer, owned, bytes).set(new Uint8Array(options.sourceStagePixels));
      input = owned;
    } else if (options.cache) {
      input = this.cachedSourceStage(doc, target).ptr;
    } else {
      owned = this.prepare(doc, target);
      input = owned;
    }

    try {
      if (stage === 'source') {
        return output(new Uint8Array(wasm.memory.buffer, input, bytes).slice().buffer, target, pxPerMm);
      }
      // Steps 4 to 6 run in place: on the owned buffer, or on a working copy of the cached one.
      let work = owned;
      if (work === null) {
        work = this.allocate(bytes, target);
        new Uint8Array(wasm.memory.buffer).copyWithin(work, input, input + bytes);
      }
      try {
        this.core.processInPlace(work, toRunParams(doc.steps, pxPerMm, target, stage));
        // Re-read the view: processing may have grown memory.
        return output(new Uint8Array(wasm.memory.buffer, work, bytes).slice().buffer, target, pxPerMm);
      } finally {
        if (work !== owned) wasm.deallocate(work, bytes);
      }
    } finally {
      if (owned !== null) wasm.deallocate(owned, bytes);
    }
  }

  /** The cached `source`-stage render of `doc` at `target`, computing it if needed. */
  private cachedSourceStage(doc: ImageDocument, target: RenderTarget): Held & { key: string } {
    const key = sourceStageKey(doc, target);
    if (this.cache?.key === key) return this.cache;
    this.dropCache();
    const ptr = this.prepare(doc, target);
    this.cache = { key, ptr, width: target.widthPx, height: target.heightPx };
    return this.cache;
  }

  private dropCache(): void {
    if (this.cache) {
      this.core.wasm.deallocate(this.cache.ptr, this.cache.width * this.cache.height * 4);
      this.cache = null;
    }
  }

  /** Steps 1 to 3 into a new buffer the caller frees. */
  private prepare(doc: ImageDocument, target: RenderTarget): number {
    const src = this.requireSource(doc.source.sourceId);
    const crop = cropRectOf(doc);
    const ptr = this.core.wasm.prepare_source(
      src.ptr,
      src.width,
      src.height,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      target.widthPx,
      target.heightPx
    );
    if (!ptr) {
      if (crop.x + crop.width > src.width || crop.y + crop.height > src.height) {
        throw new Error('The crop lies outside the image.');
      }
      throw new TooLargeError(
        `Not enough memory on this device to render ${target.widthPx} × ${target.heightPx} px (${megapixels(target.widthPx, target.heightPx)} MP).`
      );
    }
    return ptr;
  }

  private allocate(bytes: number, target: RenderTarget): number {
    const ptr = this.core.wasm.try_allocate(bytes);
    if (!ptr) {
      throw new TooLargeError(
        `Not enough memory on this device to render ${target.widthPx} × ${target.heightPx} px (${megapixels(target.widthPx, target.heightPx)} MP).`
      );
    }
    return ptr;
  }

  private requireSource(sourceId?: string): Held & { sourceId: string } {
    if (!this.source || (sourceId !== undefined && this.source.sourceId !== sourceId)) {
      throw new Error('The image is not loaded in the processing engine. Open it again.');
    }
    return this.source;
  }
}

function output(pixels: ArrayBuffer, target: RenderTarget, pxPerMm: number | null): RenderOutput {
  return { format: 'rgba8', pixels, widthPx: target.widthPx, heightPx: target.heightPx, pxPerMm };
}

function megapixels(width: number, height: number): string {
  return ((width * height) / 1e6).toFixed(1);
}
