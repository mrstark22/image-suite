import * as Comlink from 'comlink';
import type {
  DocumentRenderRequest,
  ExportProgress,
  LoadedSourceInfo,
  PreviewRenderResult,
  ProcessDepthPayload,
  BackgroundPreview,
  RasterExport,
  RasterFormat,
  ReliefRenderResult,
  SourceRefusal,
  SourceStage,
  TraceRequest,
} from '../types/worker-messages';
import type { VectorResult } from '../types/vector';
import type { DepthResult } from '../types/depth';
import { maskKey, withBackgroundEnabled, type BackgroundMask, type MaskModel, type ModelProgress } from '../lib/background';
import { PipelineEngine, TooLargeError } from '../lib/pipeline-engine';
import type { PixelSize } from '../lib/reduced-open';
import { exportPlan, previewTarget, sameTarget, sourceStageKey } from '../lib/render-target';
import { cropRectOf } from '../lib/document-size';
import { encodeRaster } from '../lib/raster-encode';
import { vectorFile, type VectorExportRequest } from '../lib/vector-file-export';
import { withView } from '../lib/trace-view';
import type { ImageDocument } from '../types/document';
import type { RustWasmEngine } from '../wasm/wasm-bridge';

/**
 * The image worker's API (design section 5: one worker). It holds the
 * decoded source and runs the pipeline; it only orchestrates, and every
 * algorithm lives in the Rust WebAssembly module, the single implementation
 * of each operation. If the module cannot be loaded every request fails with
 * that error; nothing falls back to a different implementation.
 *
 * `loadCore` instantiates the module: in the browser through Vite, in Node
 * tests from the committed binary.
 */
interface CachedAiDepth {
  width: number;
  height: number;
  hash: number;
  rawAiDepth: Float32Array;
}
let workerAiDepthCache: CachedAiDepth | null = null;

function computeQuickBufferHash(bytes: Uint8Array, width: number, height: number): number {
  let h = (width * 31 + height) | 0;
  const len = Math.min(bytes.length, 2048);
  const step = Math.max(1, Math.floor(len / 32));
  for (let i = 0; i < len; i += step) {
    h = ((h << 5) - h + bytes[i]) | 0;
  }
  return h;
}

/** Message shown to the user when the WebAssembly module fails to load. */
export const ENGINE_LOAD_ERROR =
  'The image processing engine failed to load. Reload the page; if it keeps happening, your browser may not support WebAssembly.';

/** Thrown by `exportRaster` when the export was cancelled. Recognised by its name, which survives Comlink. */
export class ExportCancelledError extends Error {
  constructor() {
    super('Export cancelled.');
    this.name = 'ExportCancelledError';
  }
}

/**
 * Decodes an image file into a pipeline engine, at the file's own size or
 * reduced to `reduceTo`. Provided by the browser worker; absent in Node.
 */
export type FileDecoder = (
  engine: PipelineEngine,
  sourceId: string,
  file: File,
  reduceTo: PixelSize | null
) => Promise<LoadedSourceInfo>;

/** Message of the error a request gets when the engine stopped under it and was replaced. */
export const ENGINE_RESTARTED_ERROR =
  'The image engine stopped while processing and has been restarted. Try again; if it keeps happening, the image may be too large for this device.';

/**
 * WASM memory a run may leave above the steady state before the instance is
 * replaced to give it back (design section 5).
 */
export const RESET_ABOVE_BYTES = 256 * 1024 * 1024;

/**
 * What the worker keeps in WASM memory between runs besides the source: the
 * cached preview-sized `source` stage and a working copy of it.
 */
const PREVIEW_BYTES = 2 * 2048 * 2048 * 4;

/** Where the source held came from, so it can be loaded again into a new instance. */
interface SourceOrigin {
  sourceId: string;
  /** The file it was decoded from; null for generated pixels, which are copied across instead. */
  file: File | null;
  reduceTo: PixelSize | null;
}

interface Instance {
  core: RustWasmEngine;
  engine: PipelineEngine;
  /** WASM memory of the instance when new, before it held anything. */
  baselineBytes: number;
}

export class PipelineWorkerApi {
  private instancePromise: Promise<Instance> | null = null;
  /** The instance requests run on now; a stopped or replaced one is no longer it. */
  private current: Instance | null = null;
  private origin: SourceOrigin | null = null;
  private started = 0;
  /** Loads and releases run one at a time, in the order they were asked for. */
  private sourceQueue: Promise<unknown> = Promise.resolve();
  /** Settles when no export is running. Renders wait for it (design section 5). */
  private exportIdle: Promise<unknown> = Promise.resolve();
  /** Set by `cancelExport`; the running export stops at its next boundary. */
  private cancelRequested = false;
  /** The segmentation model background removal runs (#50); none until set. */
  private maskModel: MaskModel | null = null;
  /** Background masks by `maskKey`, newest last. Derived data, held outside WASM memory so a restart keeps them. */
  private masks = new Map<string, BackgroundMask>();
  /** Masks being computed, so one crop never runs the model twice at once. */
  private pendingMasks = new Map<string, Promise<BackgroundMask>>();
  private modelProgressListener: ((p: ModelProgress) => void) | null = null;

  constructor(
    private readonly loadCore: () => Promise<RustWasmEngine>,
    private readonly decodeFileInto: FileDecoder | null = null,
    /** Memory a run may leave above the steady state before the instance is replaced. */
    private readonly resetAboveBytes: number = RESET_ABOVE_BYTES
  ) {
    // Start loading straight away so the first request does not wait for it.
    void this.instance().catch(() => {
      // Reported to the caller on the first request.
    });
  }

  /** How many WebAssembly instances have been started: 1 until one is replaced. */
  public get instancesStarted(): number {
    return this.started;
  }

  /** The instance in use, or the error that the module failed to load. */
  private instance(): Promise<Instance> {
    this.instancePromise ??= this.startInstance(null);
    return this.instancePromise;
  }

  /** Instantiates the module and, with `restore`, loads the source into it before anything else runs. */
  private async startInstance(restore: ((engine: PipelineEngine) => Promise<void>) | null): Promise<Instance> {
    const core = await this.loadCore().catch(() => {
      throw new Error(ENGINE_LOAD_ERROR);
    });
    this.started++;
    const instance: Instance = {
      core,
      engine: new PipelineEngine(core),
      baselineBytes: core.wasm.memory.buffer.byteLength,
    };
    if (restore) await restore(instance.engine);
    this.current = instance;
    return instance;
  }

  /**
   * Replaces the instance with a new one holding the same source (design
   * section 5, #69). WASM memory never shrinks and a trap leaves an instance
   * unusable, so this is how memory is given back and how the worker
   * recovers. The source is decoded again from its file; generated pixels,
   * which have no file, are copied across. Requests made meanwhile wait for
   * the new instance. The preview cache refills on the next render.
   */
  private restart(): void {
    const origin = this.origin;
    const previous = this.current;
    this.current = null;
    // A stopped instance's memory can still be read, and the source is only ever read by a run.
    const kept = origin && !origin.file && previous?.engine.hasSource(origin.sourceId) ? previous.engine.copySource() : null;
    this.instancePromise = this.startInstance(async (engine) => {
      if (!origin) return;
      try {
        if (origin.file && this.decodeFileInto) {
          await this.decodeFileInto(engine, origin.sourceId, origin.file, origin.reduceTo);
        } else if (kept) {
          engine.putSource(origin.sourceId, kept.pixels, kept.width, kept.height);
        } else {
          this.origin = null;
        }
      } catch {
        // The instance is usable; renders report that the image must be opened again.
        this.origin = null;
      }
    });
    void this.instancePromise.catch(() => undefined);
  }

  /**
   * Runs `op` on the instance in use. A trap inside it (an out-of-memory
   * abort, a panic) replaces the instance and fails this request with
   * `ENGINE_RESTARTED_ERROR`; the next request runs on the new one. A run
   * that left WASM memory far above the steady state replaces the instance
   * too, after its result is out.
   */
  private async guarded<T>(op: (instance: Instance) => T | Promise<T>): Promise<T> {
    const instance = await this.instance();
    let result: T;
    try {
      result = await op(instance);
    } catch (err) {
      if (err instanceof WebAssembly.RuntimeError) {
        if (this.current === instance) this.restart();
        throw new Error(ENGINE_RESTARTED_ERROR, { cause: err });
      }
      throw err;
    }
    const steady = instance.baselineBytes + instance.engine.sourceBytes() + PREVIEW_BYTES;
    if (this.current === instance && instance.core.wasm.memory.buffer.byteLength > steady + this.resetAboveBytes) {
      this.restart();
    }
    return result;
  }

  /** Runs `op` after every load or release asked for before it. */
  private queued<T>(op: () => Promise<T>): Promise<T> {
    const result = this.sourceQueue.then(op, op);
    this.sourceQueue = result.catch(() => undefined);
    return result;
  }

  /**
   * Decodes `file` in strips straight into WASM memory as the source
   * `sourceId`, at its own size or reduced to `reduceTo`.
   *
   * An image that is itself too large (over the ceiling, or more than this
   * device's memory holds) is not an error to report and forget: a
   * `SourceRefusal` with its size is returned, so the user can be offered a
   * reduced open, and the source held before is kept (#69).
   */
  public decodeFile(
    sourceId: string,
    file: File,
    reduceTo: PixelSize | null = null
  ): Promise<LoadedSourceInfo | SourceRefusal> {
    return this.queued(() =>
      this.guarded(async ({ engine }) => {
        const decode = this.decodeFileInto;
        if (!decode) throw new Error('This environment cannot decode image files.');
        const before = this.origin;
        // Generated pixels have no file to decode again if this load is refused.
        const kept = before && !before.file && engine.hasSource(before.sourceId) ? engine.copySource() : null;
        try {
          const info = await decode(engine, sourceId, file, reduceTo);
          this.origin = { sourceId, file, reduceTo };
          return info;
        } catch (err) {
          // The failed load released the source held before: put it back, so
          // the document still open keeps rendering.
          this.origin = null;
          if (before && !engine.hasSource(before.sourceId)) {
            try {
              if (before.file) await decode(engine, before.sourceId, before.file, before.reduceTo);
              else if (kept) engine.putSource(before.sourceId, kept.pixels, kept.width, kept.height);
              if (engine.hasSource(before.sourceId)) this.origin = before;
            } catch {
              // Reported by the next render: the image must be opened again.
            }
          } else if (before) {
            this.origin = before;
          }
          if (err instanceof TooLargeError && err.size) return { refused: { message: err.message, ...err.size } };
          throw err;
        }
      })
    );
  }

  /** Holds already decoded RGBA8 pixels as the source `sourceId` (a generated test grid). */
  public putSource(sourceId: string, rgba: ArrayBuffer, width: number, height: number): Promise<LoadedSourceInfo> {
    return this.queued(() =>
      this.guarded(({ engine }) => {
        this.origin = null;
        const { hasAlpha } = engine.putSource(sourceId, rgba, width, height);
        this.origin = { sourceId, file: null, reduceTo: null };
        return { widthPx: width, heightPx: height, hasAlpha };
      })
    );
  }

  /** Frees the source. */
  public releaseSource(): Promise<void> {
    return this.queued(() =>
      this.guarded(({ engine }) => {
        this.origin = null;
        engine.releaseSource();
      })
    );
  }

  /** Renders the preview: the `final` stage at the request's target. */
  public async renderPreview(req: DocumentRenderRequest): Promise<PreviewRenderResult> {
    await this.exportIdle;
    const mask = await this.maskFor(req.doc);
    return this.guarded(({ engine }) => {
      const start = performance.now();
      const options = { cache: true, mask };
      const final = engine.render(req.doc, req.target, req.stage ?? 'final', options);
      const result: PreviewRenderResult = {
        key: sourceStageKey(req.doc, req.target),
        final,
        sourceStage: this.sourceStageFor(engine, req, mask),
        durationMs: performance.now() - start,
      };
      return Comlink.transfer(result, transferables(final.pixels, result.sourceStage));
    });
  }

  /** Renders the relief heightmap from the `source` stage at the request's target. */
  public async renderRelief(req: DocumentRenderRequest): Promise<ReliefRenderResult> {
    await this.exportIdle;
    const start = performance.now();
    const mask = await this.maskFor(req.doc);
    const { source, sourceStage } = await this.guarded(({ engine }) => ({
      source: engine.render(req.doc, req.target, 'source', { cache: true, mask }),
      sourceStage: this.sourceStageFor(engine, req, mask),
    }));
    const depth = await this.processDepth({
      buffer: source.pixels,
      width: req.target.widthPx,
      height: req.target.heightPx,
      config: req.doc.depth,
    });
    const result: ReliefRenderResult = {
      key: sourceStageKey(req.doc, req.target),
      depth,
      sourceStage,
      durationMs: performance.now() - start,
    };
    return Comlink.transfer(result, transferables(depth.heightMapBuffer, result.sourceStage));
  }

  /**
   * Traces the document at the request's target: the `prepared` stage, so
   * every adjustment applies to the trace (#23), with the document's tracing
   * settings. The live trace uses the preview target; export traces at the
   * source's full resolution. Refuses while the size is not set, as the
   * tracing settings are lengths in millimetres.
   */
  public async traceDocument(req: TraceRequest): Promise<VectorResult> {
    await this.exportIdle;
    // The preview's target shares the cached source stage; a full-resolution
    // export trace renders its own and frees it, leaving the cache alone.
    const options = {
      cache: sameTarget(req.target, previewTarget(req.doc)),
      mask: await this.maskFor(req.doc),
    };
    return this.guarded(({ engine, core }) =>
      engine.renderWith(req.doc, req.target, 'prepared', options, (ptr, pxPerMm) => {
        if (pxPerMm === null) throw new Error('Set the size of the image before tracing.');
        return core.traceAt(ptr, req.target.widthPx, req.target.heightPx, pxPerMm, req.doc.vector);
      })
    );
  }

  /**
   * Traces and writes a vector file (#23, #30): the trace at the request's
   * target, shown as on screen, as SVG or DXF text. Both the trace and the
   * writing run here, off the main thread (architecture rule 2).
   */
  public async exportVectorFile(req: VectorExportRequest): Promise<{ text: string; mimeType: string }> {
    const result = await this.traceDocument({ doc: req.doc, target: req.target });
    return vectorFile(withView(result, req.view), req.format);
  }

  /**
   * Exports `doc` as a raster file (design section 6): the `final` stage at
   * the source's full resolution for the crop, encoded here with the
   * document's resolution in the file. Refuses while the size is not set.
   *
   * `onProgress` is awaited at each boundary (preparing, processing, and
   * every chunk of rows while encoding); a `cancelExport` call takes effect
   * at the next one. Renders for the preview, trace and relief wait until the
   * export has finished, and loads and releases queue behind it.
   */
  public exportRaster(
    doc: ImageDocument,
    format: RasterFormat,
    onProgress?: (progress: ExportProgress) => void | Promise<void>
  ): Promise<RasterExport> {
    const plan = exportPlan(doc);
    this.cancelRequested = false;
    const run = this.queued(async () => {
      const mask = await this.maskFor(doc);
      return this.guarded(async ({ engine }) => {
        const boundary = async (progress: ExportProgress) => {
          await onProgress?.(progress);
          if (this.cancelRequested) throw new ExportCancelledError();
        };
        const file = await engine.renderInPlace(
          doc,
          plan.target,
          'final',
          (pixels) =>
            encodeRaster(format, pixels, plan.target.widthPx, plan.target.heightPx, plan.pxPerMm, (fraction) =>
              boundary({ stage: 'encoding', fraction })
            ),
          (stage) => boundary({ stage, fraction: 0 }),
          mask
        );
        return Comlink.transfer(file, [file.bytes]);
      });
    });
    this.exportIdle = run.catch(() => undefined);
    return run;
  }

  /** Stops the running export at its next boundary. Does nothing when none is running. */
  public cancelExport(): void {
    this.cancelRequested = true;
  }

  /** The `source`-stage pixels, when the main thread does not already have them. */
  private sourceStageFor(engine: PipelineEngine, req: DocumentRenderRequest, mask: BackgroundMask | undefined): SourceStage | null {
    const key = sourceStageKey(req.doc, req.target);
    if (req.haveSourceKey === key) return null;
    const pixels = engine.render(req.doc, req.target, 'source', { cache: true, mask }).pixels;
    return { key, crop: cropRectOf(req.doc), pixels, width: req.target.widthPx, height: req.target.heightPx };
  }

  /**
   * Generates a 16-bit heightmap from a raster buffer.
   */
  public async processDepth(payload: ProcessDepthPayload): Promise<DepthResult> {
    const { buffer, width, height, config } = payload;

    // 1. AI Monocular Depth Estimation (ONNX WebGPU / Neural Engine)
    if (config.source === 'ai-estimation') {
      try {
        const { runAiDepthEstimation, combineAiWithTonalRelief, applyDetailEmbossing } = await import('../lib/ai-depth');
        const pixels = new Uint8ClampedArray(buffer);
        const hash = computeQuickBufferHash(new Uint8Array(buffer), width, height);

        let baseAiDepth: Float32Array;
        if (
          workerAiDepthCache &&
          workerAiDepthCache.width === width &&
          workerAiDepthCache.height === height &&
          workerAiDepthCache.hash === hash
        ) {
          baseAiDepth = new Float32Array(workerAiDepthCache.rawAiDepth);
        } else {
          const rawDepth = await runAiDepthEstimation(pixels, width, height);
          workerAiDepthCache = {
            width,
            height,
            hash,
            rawAiDepth: new Float32Array(rawDepth),
          };
          baseAiDepth = rawDepth;
        }

        let depthFloat = baseAiDepth;

        // Professional Hybrid Bas-Relief: Combine AI 3D Base Shape with Bilateral-Denoised Tonal Relief
        if ((config.tonalBlend ?? 35) > 0) {
          depthFloat = combineAiWithTonalRelief(
            depthFloat,
            pixels,
            width,
            height,
            config.aiWeight ?? 75,
            config.tonalBlend ?? 35,
            config.surfaceDenoise ?? 2.0
          );
        }

        // Optional fine-edge typography embossing
        if ((config.detailEmboss ?? 0) > 0) {
          depthFloat = applyDetailEmbossing(depthFloat, pixels, width, height, config.detailEmboss ?? 0);
        }

        const depth16 = new Uint16Array(width * height);
        for (let i = 0; i < width * height; i++) {
          let val = depthFloat[i];
          if (config.invertZ) val = 1.0 - val;
          depth16[i] = Math.round(val * 65535);
        }
        return Comlink.transfer(
          {
            heightMapBuffer: depth16.buffer,
            width,
            height,
            is16Bit: true,
            minZ: 0,
            maxZ: 65535,
          },
          [depth16.buffer]
        );
      } catch (err) {
        console.warn('AI depth estimation failed, falling back to WASM:', err);
      }
    }

    // 2. Rust WASM depth engine (distance-transform bevels, tonal relief, smoothing)
    const wasmResult = await this.guarded(({ core }) => core.processDepth(buffer, width, height, config));
    return Comlink.transfer(wasmResult, [wasmResult.heightMapBuffer]);
  }

  /** Sets the segmentation model background removal runs (#50). The browser worker sets ISNet. */
  public setMaskModel(model: MaskModel | null): void {
    this.maskModel = model;
    this.masks.clear();
    this.pendingMasks.clear();
  }

  /** `listener` hears the model's progress (download bytes, running) whenever a mask is computed. */
  public setModelProgressListener(listener: ((p: ModelProgress) => void) | null): void {
    this.modelProgressListener = listener;
  }

  /** True when the mask `doc` needs (on or off) is already computed, so showing it is instant. */
  public hasBackgroundMask(doc: ImageDocument): boolean {
    return this.masks.has(maskKey(doc));
  }

  /**
   * What removing `doc`'s background would do, before it is applied (#50):
   * the image without removal and the coverage removal gives it (one byte per
   * pixel, 0 removed), at `target`. Computes the mask if needed, so it throws
   * when the model cannot be loaded or run.
   */
  public async backgroundPreview(doc: ImageDocument, target: { widthPx: number; heightPx: number }): Promise<BackgroundPreview> {
    await this.exportIdle;
    const on = withBackgroundEnabled(doc, true);
    const mask = await this.maskFor(on);
    const result = await this.guarded(({ engine }) => ({
      original: engine.render(withBackgroundEnabled(doc, false), target, 'source').pixels,
      alpha: mask ? engine.matteAlpha(on, target, mask) : new ArrayBuffer(0),
      widthPx: target.widthPx,
      heightPx: target.heightPx,
    }));
    return Comlink.transfer(result, [result.original, result.alpha]);
  }

  /**
   * The mask `doc` needs, or undefined while its background removal is off.
   * Cached by `maskKey`: the image as turned and cropped. The model runs on
   * that image at the model's input size, without removal.
   */
  private async maskFor(doc: ImageDocument): Promise<BackgroundMask | undefined> {
    if (!doc.steps.background.enabled) return undefined;
    const key = maskKey(doc);
    const held = this.masks.get(key);
    if (held) {
      this.masks.delete(key);
      this.masks.set(key, held);
      return held;
    }
    let pending = this.pendingMasks.get(key);
    if (!pending) {
      pending = this.computeMask(doc, key);
      this.pendingMasks.set(key, pending);
      void pending.then(
        () => this.pendingMasks.delete(key),
        () => this.pendingMasks.delete(key)
      );
    }
    return pending;
  }

  private async computeMask(doc: ImageDocument, key: string): Promise<BackgroundMask> {
    const model = this.maskModel;
    if (!model) throw new Error('Background removal is not available: no segmentation model is installed.');
    const input = await this.guarded(({ engine }) =>
      engine.render(withBackgroundEnabled(doc, false), model.inputSize, 'source').pixels
    );
    const data = await model.predict(new Uint8Array(input), (p) => this.modelProgressListener?.(p));
    const { widthPx: width, heightPx: height } = model.inputSize;
    if (data.length !== width * height) {
      throw new Error(`The background removal model returned ${data.length} values, not ${width} × ${height}.`);
    }
    const mask: BackgroundMask = { key, data, width, height };
    this.masks.set(key, mask);
    // A mask is 1 MB; a few are kept so undo and redo of a crop are instant.
    while (this.masks.size > MASKS_KEPT) this.masks.delete(this.masks.keys().next().value as string);
    return mask;
  }
}

/** How many background masks the worker keeps. */
const MASKS_KEPT = 8;

function transferables(main: ArrayBuffer, stage: SourceStage | null): ArrayBuffer[] {
  return stage ? [main, stage.pixels] : [main];
}
