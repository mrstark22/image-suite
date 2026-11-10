export type ColorMode = 'rgb' | 'grayscale' | '1bit' | 'inverted-burn';

export interface ImageMetadata {
  name: string;
  width: number;
  height: number;
  dpi: number;
  aspectRatio: number;
  originalSizeBytes: number;
  format: string;
  hasAlpha: boolean;
}

export interface PreviewDimensions {
  width: number;
  height: number;
  scale: number;
}

export type GrayscaleMode = 'none' | 'rec709' | 'average' | 'desaturate' | 'max' | 'inverted';

export interface TonalAdjustments {
  exposure: number;       // -3.0 to +3.0 EV (0 default)
  brightness: number;     // -100 to +100 (0 default)
  contrast: number;       // -100 to +100 (0 default)
  midtones: number;       // -100 to +100 (0 default)
  highlights: number;     // -100 to +100 (0 default)
  shadows: number;        // -100 to +100 (0 default)
  whites: number;         // -100 to +100 (0 default)
  blacks: number;         // -100 to +100 (0 default)
  clarity: number;        // -100 to +100 (0 default)
  gamma: number;          // 0.1 to 3.0 (1.0 default)
  blackPoint: number;     // 0 to 255 (0 default)
  whitePoint: number;     // 0 to 255 (255 default)
  invert: boolean;        // false default
  grayscaleMode: GrayscaleMode; // 'none' default
}

export interface ColorAdjustments {
  hue: number;          // -180 to +180 (0 default)
  saturation: number;   // -100 to +100 (0 default)
  lightness: number;    // -100 to +100 (0 default)
  vibrance: number;     // -100 to +100 (0 default)
  temperature: number;  // -100 to +100 (0 default)
  tint: number;         // -100 to +100 (0 default)
}

export interface DetailEnhancements {
  clahe: boolean;
  claheClipLimit: number; // 1.0 to 10.0 (2.5 default)
  claheGridSize: number;  // 2 to 32 (8 default)
  unsharpStrength: number;// 0 to 200 (0 default)
  unsharpRadius: number;  // 0.5 to 10.0 (1.5 default)
  adaptiveThreshold: boolean;
  adaptiveBlockSize: number; // 3 to 99 (15 default)
  adaptiveConstant: number;  // -50 to 50 (2 default)
}

/** A rectangle in whole pixels of the uncropped preview. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GeometryTransform {
  cropRect: CropRect | null;
}
