import type { DitherAlgorithm } from '../types/dither';
import type { Calibration, Machine, Material, Thickness } from '../types/profiles';
import { JOB_CALIBRATION, KIND_LABEL, formatMm, noCalibrationText } from './profiles';
import type { Job } from './workflows';
import { MM_PER_INCH } from './document-size';

/**
 * The LightBurn settings to use with an exported file, as the export step of
 * each flow shows them (#53).
 *
 * What follows from the file is always given: the image mode and the line
 * interval that makes one image pixel one scan line. Speed, power and passes
 * come only from the calibration for exactly the selected machine, material
 * and (for cutting) thickness (#33); without one they are reported missing,
 * never guessed.
 */
export interface LightBurnSettings {
  rows: { label: string; value: string }[];
  /** Where speed and power came from, or why they are not given. */
  calibration: string;
  /** "warning" when the calibration is unverified or was burned at another line interval. */
  tone: 'info' | 'warning';
}

export interface LightBurnInput {
  job: Job;
  machine: Machine | null;
  material: Material | null;
  /** The thickness, which a cut depends on. */
  thickness: Thickness | null;
  /** The calibration of the job's kind for the selection: `activeCalibration`. */
  calibration: Calibration | null;
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
  const { job, machine, material, thickness, calibration, dither, fileDpi } = input;
  const rows: LightBurnSettings['rows'] = [
    { label: 'Machine', value: machine?.name ?? 'Not chosen' },
    { label: 'Material', value: material?.name ?? 'No material' },
  ];
  if (job === 'vector') rows.push({ label: 'Thickness', value: thickness ? formatMm(thickness.mm) : 'Not chosen' });

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

  const kind = JOB_CALIBRATION[job];
  if (!calibration || !machine || !material) {
    return { rows, calibration: `${noCalibrationText(kind, machine, material, thickness)} Burn a test card to find speed and power.`, tone: 'info' };
  }
  rows.push({ label: 'Speed', value: `${calibration.speedMmS} mm/s` });
  rows.push({
    label: 'Power',
    value: calibration.powerMinPct === calibration.powerMaxPct ? `${calibration.powerMaxPct}%` : `${calibration.powerMinPct}% to ${calibration.powerMaxPct}%`,
  });
  rows.push({ label: 'Passes', value: String(calibration.passes) });
  if (kind === 'cut' && calibration.kerfMm !== null) rows.push({ label: 'Kerf', value: formatMm(calibration.kerfMm) });

  const on = kind === 'cut' && thickness ? `${material.name} ${formatMm(thickness.mm)}` : material.name;
  const notes: string[] = [`From the ${KIND_LABEL[kind].toLowerCase()} calibration for ${on} on ${machine.name}.`];
  let tone: LightBurnSettings['tone'] = 'info';
  if (calibration.status === 'unverified') {
    notes.push('It was copied from another material or thickness and is not yet verified: burn a test card on this one.');
    tone = 'warning';
  }
  if (kind !== 'cut' && calibration.lineIntervalMm !== null && fileDpi !== null && Math.abs(calibration.lineIntervalMm - lineIntervalMm(fileDpi)) > 0.0005) {
    notes.push(
      `It was burned at a ${calibration.lineIntervalMm} mm line interval; this file is at ${lineIntervalMm(fileDpi).toFixed(4)} mm, so tones will differ. Set the size to ${(MM_PER_INCH / calibration.lineIntervalMm).toFixed(1)} DPI to match.`,
    );
    tone = 'warning';
  }
  return { rows, calibration: notes.join(' '), tone };
}
