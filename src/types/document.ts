import type { ColorAdjustments, CropRect, TonalAdjustments } from './image';
import type { DitherConfig } from './dither';
import type { VectorConfig } from './vector';
import type { DepthConfig } from './depth';

/** Pixel formats a source or a render can have. Only 8-bit RGBA exists today. */
export type PixelFormat = 'rgba8';

/**
 * The original image a document refers to. It does not carry the pixels; those
 * are held by the source registry under `sourceId`.
 */
export interface SourceInfo {
  sourceId: string;
  name: string;
  /** Full resolution, after EXIF orientation. */
  widthPx: number;
  heightPx: number;
  format: PixelFormat;
  hasAlpha: boolean;
  /** The resolution the file claims, if it claims one. Only ever a suggestion. */
  fileDpi: number | null;
  /**
   * The file's own pixel size, when the image was opened smaller than that
   * because it was too large (#69). `widthPx` and `heightPx` are the size
   * opened; absent when the image was opened at the file's size.
   */
  reducedFrom?: { widthPx: number; heightPx: number };
}

/**
 * CLAHE, sharpening and the adaptive threshold. Lengths are in millimetres,
 * so they keep their physical effect at any resolution.
 */
export interface DetailSettings {
  clahe: boolean;
  claheClipLimit: number; // 1.0 to 8.0
  claheGridSize: number; // tiles across the image
  unsharpStrength: number; // 0 to 200 %
  unsharpRadiusMm: number;
  adaptiveThreshold: boolean;
  adaptiveBlockMm: number;
  adaptiveConstant: number;
}

/** How far the image is turned clockwise, in degrees (#65). */
export type Rotation = 0 | 90 | 180 | 270;

/** The edit steps, which the pipeline runs in a fixed order. */
export interface EditSteps {
  /**
   * The image is turned clockwise by this before anything else. Everything
   * after it, the crop included, is in the turned image's frame.
   */
  rotation: Rotation;
  /** In integer pixels of the image as turned; `null` is the whole image. */
  crop: CropRect | null;
  tonal: TonalAdjustments;
  color: ColorAdjustments;
  detail: DetailSettings;
  dither: DitherConfig;
}

/**
 * Everything the user has decided about one image: which image, its physical
 * scale, the edit steps and the workflow settings. An immutable plain value;
 * every change produces a new document that shares its unchanged parts.
 */
/** Where a document's physical size came from. */
export type SizeOrigin = 'file' | 'assumed' | 'user';

export interface ImageDocument {
  /** New for every loaded file. */
  id: string;
  source: SourceInfo;
  /** Millimetres per source pixel. `null` means the size has not been set. */
  mmPerPx: number | null;
  /**
   * Where `mmPerPx` came from: the resolution the file states, an assumed
   * resolution (the last one the user applied, or 300 DPI), or the user
   * setting it. Meaningless while `mmPerPx` is null.
   */
  sizeOrigin: SizeOrigin;
  steps: EditSteps;
  vector: VectorConfig;
  depth: DepthConfig;
}

/** A function from one document to the next. */
export type DocumentUpdate = (doc: ImageDocument) => ImageDocument;

/** Identifies one gesture; updates and ends that carry an older token are ignored. */
export type GestureToken = number & { readonly __gesture: unique symbol };
