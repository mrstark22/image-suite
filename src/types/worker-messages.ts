import type { ImageDocument } from './document';
import type { CropRect } from './image';
import type { RenderOutput, RenderTarget } from './render';
import type { DepthResult } from './depth';
import type { DepthConfig } from './depth';

/** A render of the document for the preview or the relief view, at the preview target. */
export interface DocumentRenderRequest {
  doc: ImageDocument;
  target: RenderTarget;
  /**
   * The key of the `source`-stage render the main thread already holds. The
   * result carries the `source`-stage pixels only when its key differs.
   */
  haveSourceKey: string | null;
  /** Background removal's replacement for the `source`-stage render (stopgap until phase 5). */
  sourceStagePixels?: ArrayBuffer;
}

/** The `source`-stage render a result was made from, sent when the main thread does not have it. */
export interface SourceStage {
  key: string;
  /** The crop it shows, in source pixels. */
  crop: CropRect;
  pixels: ArrayBuffer;
  width: number;
  height: number;
}

export interface PreviewRenderResult {
  /** The key of the `source`-stage render this was made from. */
  key: string;
  final: RenderOutput;
  sourceStage: SourceStage | null;
  durationMs: number;
}

export interface ReliefRenderResult {
  key: string;
  depth: DepthResult;
  sourceStage: SourceStage | null;
  durationMs: number;
}

/** A trace of the document. Phase 1 traces the `source` stage at the preview target, as before (#23). */
export interface TraceRequest {
  doc: ImageDocument;
  target: RenderTarget;
  sourceStagePixels?: ArrayBuffer;
}

/** What loading a source reports. */
export interface LoadedSourceInfo {
  widthPx: number;
  heightPx: number;
  hasAlpha: boolean;
}

export interface ProcessDepthPayload {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  config: DepthConfig;
}

export interface ProcessBgRemovalPayload {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  tolerance: number;
  featherRadius: number;
  mode: 'auto-border' | 'white-bg' | 'black-bg' | 'custom-color';
  customColor?: { r: number; g: number; b: number };
}

export interface ProcessBgRemovalResult {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  removedPixelCount: number;
  durationMs: number;
}
