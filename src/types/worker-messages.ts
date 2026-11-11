import type { TonalAdjustments, ColorAdjustments, DetailRunParams } from './image';
import type { DitherConfig } from './dither';
import type { VectorConfig } from './vector';
import type { DepthConfig } from './depth';
import type { EditStep } from './recipe';

export interface ProcessPreviewPayload {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  tonal: TonalAdjustments;
  color: ColorAdjustments;
  /** Lengths already converted to pixels of this buffer. */
  detail: DetailRunParams;
  dither: DitherConfig;
}

export interface ProcessPreviewResult {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  durationMs: number;
}

export interface ProcessVectorPayload {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  config: VectorConfig;
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

export interface ExportPayload {
  originalBuffer: ArrayBuffer;
  width: number;
  height: number;
  dpi: number;
  format: 'png' | 'jpeg' | 'webp' | 'svg' | 'png16';
  quality: number;
  recipe: EditStep[];
}

export interface ExportResult {
  blob: Blob;
  downloadUrl: string;
  filename: string;
  sizeBytes: number;
  durationMs: number;
}

export interface WorkerProgress {
  step: string;
  percent: number;
  elapsedMs: number;
}
