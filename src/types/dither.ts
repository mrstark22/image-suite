export type DitherAlgorithm =
  | 'none'
  | 'floyd-steinberg'
  | 'atkinson'
  | 'jarvis'
  | 'bayer-2'
  | 'bayer-4'
  | 'bayer-8'
  | 'blue-noise'
  | 'ostromoukhov'
  | 'riemersma'
  | 'knuth-dot'
  | 'halftone-dot';

export type AlphaBurnHandling = 'white-ignore' | 'black-burn' | 'transparent';

export interface DitherConfig {
  algorithm: DitherAlgorithm;
  threshold: number;          // 0 to 255 (128 default)
  serpentine: boolean;        // alternate scan direction for error diffusion
  matrixScale: number;        // 1 to 4 for ordered dither dot size
  dotAngle: number;           // 0 to 90 degrees for halftone screens
  invertedBurn: boolean;      // visualize burn on dark substrate without affecting file
  alphaHandling?: AlphaBurnHandling; // default 'white-ignore' (pure white no-burn for laser)
}
