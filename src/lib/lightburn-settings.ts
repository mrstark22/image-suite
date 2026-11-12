import type { DitherAlgorithm } from '../types/dither';
import type { MaterialPreset } from '../types/recipe';
import type { Machine } from './machines';
import type { Job } from './workflows';
import { MM_PER_INCH } from './document-size';

/**
 * The LightBurn settings to use with an exported file, as the export step of
 * each flow shows them (#53).
 *
 * Only what follows from the file is given: the image mode and the line
 * interval that makes one image pixel one scan line. Speed and power come
 * from a calibration for the machine and material, which does not exist
 * until #33, so they are reported as missing rather than guessed.
 */
export interface LightBurnSettings {
  rows: { label: string; value: string }[];
  /** Why speed and power are not given. */
  calibration: string;
}

export interface LightBurnInput {
  job: Job;
  machine: Machine | null;
  material: MaterialPreset | null;
  /** The dither of the photo, which decides its image mode. */
  dither: DitherAlgorithm;
  /** The resolution written into the file; null while the size is not set. */
  fileDpi: number | null;
}

/** The scan line spacing in mm at which one pixel of a `dpi` image is one line. */
export function lineIntervalMm(dpi: number): number {
  return MM_PER_INCH / dpi;
}

/** LightBurn's image mode for a photo: a dithered image is passed through untouched. */
export function photoImageMode(dither: DitherAlgorithm): 'Pass-Through' | 'Grayscale' {
  return dither === 'none' ? 'Grayscale' : 'Pass-Through';
}

export function lightBurnSettings(input: LightBurnInput): LightBurnSettings {
  const { job, machine, material, dither, fileDpi } = input;
  const rows: LightBurnSettings['rows'] = [{ label: 'Machine', value: machine?.name ?? 'Not chosen' }];
  if (job !== 'vector') rows.push({ label: 'Material', value: material?.name ?? 'Not chosen' });

  const interval = fileDpi === null ? 'Set the size first' : `${lineIntervalMm(fileDpi).toFixed(4)} mm (${fileDpi.toFixed(1)} DPI)`;
  if (job === 'photo') {
    rows.push({ label: 'Image mode', value: photoImageMode(dither) });
    rows.push({ label: 'Line interval', value: interval });
  } else if (job === 'relief') {
    // On the CO2 machines a relief runs in Grayscale mode: power follows grey level (docs/plan.md).
    rows.push({ label: 'Image mode', value: 'Grayscale' });
    rows.push({ label: 'Line interval', value: interval });
  } else {
    rows.push({ label: 'Layer mode', value: 'Line to cut or score along the paths; Fill to engrave inside them' });
  }

  const what = job === 'vector' ? machine?.name ?? 'this machine' : `${machine?.name ?? 'this machine'} on ${material?.name ?? 'this material'}`;
  return {
    rows,
    calibration: `Speed and power: no calibration is saved for ${what} yet (#33). Burn a test card to find them.`,
  };
}
