export type DitherAlgorithm =
  | 'none'
  | 'floyd-steinberg'
  | 'atkinson'
  | 'jarvis'
  | 'bayer-2'
  | 'bayer-4'
  | 'bayer-8'
  | 'blue-noise';

/**
 * Where the dot pitch (the line interval) came from (#34): the engraving
 * calibration in use, the machine's usual line interval, the built-in
 * default because the machine has none, or the user setting it for this job.
 */
export type DotPitchOrigin = 'calibration' | 'machine' | 'default' | 'user';

export interface DitherConfig {
  algorithm: DitherAlgorithm;
  serpentine: boolean; // alternate scan direction for error diffusion
  matrixScale: number; // 1 to 4: Bayer cells per matrix entry, for a coarser pattern
  /**
   * The laser's dot pitch in millimetres: the line interval. A dithered image
   * is resampled so one pixel is one dot (#34).
   */
  dotPitchMm: number;
  dotPitchOrigin: DotPitchOrigin;
  /**
   * The engraving calibration's tone response, applied before the dither
   * (#39): darkness burned (0 to 1) at evenly spaced input levels from white
   * to black. Null without a calibration or a measured curve. Follows the
   * calibration in use, like the dot pitch.
   */
  toneCurve: number[] | null;
}
