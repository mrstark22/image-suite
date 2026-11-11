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

/**
 * Detail filter parameters as the worker runs them, with lengths in pixels of
 * the image being processed. The document stores lengths in millimetres
 * (`DetailSettings`); `detailRunParams` converts them.
 */
export interface DetailRunParams {
  clahe: boolean;
  claheClipLimit: number;
  claheGridSize: number;
  unsharpStrength: number; // 0 to 200 %
  unsharpRadiusPx: number;
  adaptiveThreshold: boolean;
  adaptiveBlockPx: number; // odd, at least 3
  adaptiveConstant: number;
}

/** A rectangle in whole pixels. The document's crop is in pixels of the source image. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
