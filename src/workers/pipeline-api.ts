import * as Comlink from 'comlink';
import type {
  DocumentRenderRequest,
  ExportProgress,
  LoadedSourceInfo,
  PreviewRenderResult,
  ProcessDepthPayload,
  ProcessBgRemovalPayload,
  ProcessBgRemovalResult,
  RasterExport,
  RasterFormat,
  ReliefRenderResult,
  SourceStage,
  TraceRequest,
} from '../types/worker-messages';
import type { VectorResult } from '../types/vector';
import type { DepthResult } from '../types/depth';
import { removeBackground } from '../lib/bg-removal';
import { PipelineEngine } from '../lib/pipeline-engine';
import { exportPlan, sourceStageKey } from '../lib/render-target';
import { cropRectOf } from '../lib/document-size';
import { encodeRaster } from '../lib/raster-encode';
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

/** Decodes an image file into a pipeline engine. Provided by the browser worker; absent in Node. */
export type FileDecoder = (engine: PipelineEngine, sourceId: string, file: File) => Promise<LoadedSourceInfo>;

export class PipelineWorkerApi {
  private corePromise: Promise<RustWasmEngine> | null = null;
  private enginePromise: Promise<PipelineEngine> | null = null;
  /** Loads and releases run one at a time, in the order they were asked for. */
  private sourceQueue: Promise<unknown> = Promise.resolve();
  /** Settles when no export is running. Renders wait for it (design section 5). */
  private exportIdle: Promise<unknown> = Promise.resolve();
  /** Set by `cancelExport`; the running export stops at its next boundary. */
  private cancelRequested = false;

  constructor(
    private readonly loadCore: () => Promise<RustWasmEngine>,
    private readonly decodeFileInto: FileDecoder | null = null
  ) {
    // Start loading straight away so the first request does not wait for it.
    void this.core().catch(() => {
      // Reported to the caller on the first request.
    });
  }

  /** The WebAssembly core, or the error that it failed to load. */
  private core(): Promise<RustWasmEngine> {
    this.corePromise ??= this.loadCore().catch(() => {
      throw new Error(ENGINE_LOAD_ERROR);
    });
    return this.corePromise;
  }

  private engine(): Promise<PipelineEngine> {
    this.enginePromise ??= this.core().then((core) => new PipelineEngine(core));
    return this.enginePromise;
  }

  /** Runs `op` after every load or release asked for before it. */
  private queued<T>(op: () => Promise<T>): Promise<T> {
    const result = this.sourceQueue.then(op, op);
    this.sourceQueue = result.catch(() => undefined);
    return result;
  }

  /** Decodes `file` in strips straight into WASM memory as the source `sourceId`. */
  public decodeFile(sourceId: string, file: File): Promise<LoadedSourceInfo> {
    return this.queued(async () => {
      if (!this.decodeFileInto) throw new Error('This environment cannot decode image files.');
      return this.decodeFileInto(await this.engine(), sourceId, file);
    });
  }

  /** Holds already decoded RGBA8 pixels as the source `sourceId` (a generated test grid). */
  public putSource(sourceId: string, rgba: ArrayBuffer, width: number, height: number): Promise<LoadedSourceInfo> {
    return this.queued(async () => {
      const { hasAlpha } = (await this.engine()).putSource(sourceId, rgba, width, height);
      return { widthPx: width, heightPx: height, hasAlpha };
    });
  }

  /** Frees the source. */
  public releaseSource(): Promise<void> {
    return this.queued(async () => (await this.engine()).releaseSource());
  }

  /** Renders the preview: the `final` stage at the request's target. */
  public async renderPreview(req: DocumentRenderRequest): Promise<PreviewRenderResult> {
    await this.exportIdle;
    const engine = await this.engine();
    const start = performance.now();
    const options = { cache: true, sourceStagePixels: req.sourceStagePixels };
    const final = engine.render(req.doc, req.target, req.stage ?? 'final', options);
    const result: PreviewRenderResult = {
      key: sourceStageKey(req.doc, req.target),
      final,
      sourceStage: this.sourceStageFor(engine, req),
      durationMs: performance.now() - start,
    };
    return Comlink.transfer(result, transferables(final.pixels, result.sourceStage));
  }

  /** Renders the relief heightmap from the `source` stage at the request's target. */
  public async renderRelief(req: DocumentRenderRequest): Promise<ReliefRenderResult> {
    await this.exportIdle;
    const engine = await this.engine();
    const start = performance.now();
    const source = engine.render(req.doc, req.target, 'source', { cache: true, sourceStagePixels: req.sourceStagePixels });
    const depth = await this.processDepth({
      buffer: source.pixels,
      width: req.target.widthPx,
      height: req.target.heightPx,
      config: req.doc.depth,
    });
    const result: ReliefRenderResult = {
      key: sourceStageKey(req.doc, req.target),
      depth,
      sourceStage: this.sourceStageFor(engine, req),
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
    const engine = await this.engine();
    const core = await this.core();
    const prepared = engine.render(req.doc, req.target, 'prepared', {
      cache: true,
      sourceStagePixels: req.sourceStagePixels,
    });
    if (prepared.pxPerMm === null) throw new Error('Set the size of the image before tracing.');
    return core.trace(prepared.pixels, req.target.widthPx, req.target.heightPx, prepared.pxPerMm, req.doc.vector);
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
      const engine = await this.engine();
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
        (stage) => boundary({ stage, fraction: 0 })
      );
      return Comlink.transfer(file, [file.bytes]);
    });
    this.exportIdle = run.catch(() => undefined);
    return run;
  }

  /** Stops the running export at its next boundary. Does nothing when none is running. */
  public cancelExport(): void {
    this.cancelRequested = true;
  }

  /** The `source`-stage pixels, when the main thread does not already have them. */
  private sourceStageFor(engine: PipelineEngine, req: DocumentRenderRequest): SourceStage | null {
    const key = sourceStageKey(req.doc, req.target);
    if (req.haveSourceKey === key) return null;
    const pixels = req.sourceStagePixels
      ? req.sourceStagePixels.slice(0)
      : engine.render(req.doc, req.target, 'source', { cache: true }).pixels;
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
    const core = await this.core();
    const wasmResult = core.processDepth(buffer, width, height, config);
    return Comlink.transfer(wasmResult, [wasmResult.heightMapBuffer]);
  }

  /**
   * Processes intelligent client-side background removal and alpha matting
   */
  public async processBgRemoval(payload: ProcessBgRemovalPayload): Promise<ProcessBgRemovalResult> {
    const startTime = performance.now();
    const { buffer, width, height, tolerance, featherRadius, mode, customColor } = payload;
    const pixels = new Uint8ClampedArray(buffer);

    const { removedPixelCount } = removeBackground(pixels, width, height, {
      tolerance,
      featherRadius,
      mode,
      customColor,
    });

    const durationMs = performance.now() - startTime;

    return Comlink.transfer(
      {
        buffer: pixels.buffer,
        width,
        height,
        removedPixelCount,
        durationMs,
      },
      [pixels.buffer]
    );
  }
}

function transferables(main: ArrayBuffer, stage: SourceStage | null): ArrayBuffer[] {
  return stage ? [main, stage.pixels] : [main];
}
