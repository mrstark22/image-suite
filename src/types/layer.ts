import type { ImageMetadata, PreviewDimensions, TonalAdjustments, ColorAdjustments, DetailEnhancements } from './image';
import type { DitherConfig } from './dither';
import type { VectorResult } from './vector';

export type LayerBlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'difference';

export interface LayerTransform {
  x: number;          // translation in px (relative to canvas center)
  y: number;          // translation in px
  scale: number;      // 0.1 to 10.0 (1.0 default)
  rotation: number;   // -180 to 180 deg (0 default)
}

export type LayerType = 'image' | 'vector' | 'empty' | 'text';

export interface CanvasLayer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  opacity: number;        // 0.0 to 1.0 (1.0 default)
  blendMode: LayerBlendMode;
  transform: LayerTransform;

  // Per-Layer Adjustments
  tonal?: TonalAdjustments;
  color?: ColorAdjustments;
  detail?: DetailEnhancements;
  dither?: DitherConfig;

  // Image Layer Specific Fields
  file?: File;
  originalBuffer?: ArrayBuffer;
  originalBitmap?: ImageBitmap;
  previewBuffer?: ArrayBuffer;
  previewProcessedBuffer?: ArrayBuffer;
  metadata?: ImageMetadata;
  previewDims?: PreviewDimensions;

  // Vector Layer Specific Fields
  vectorResult?: VectorResult;
}
