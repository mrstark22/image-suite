import type { DocumentUpdate } from '../types/document';
import type { DitherConfig, DotPitchOrigin } from '../types/dither';
import type { Calibration, Machine, Material } from '../types/profiles';
import { DEFAULT_DOT_PITCH_MM } from './document';
import { formatMm } from './profiles';

/**
 * The dot pitch and tone curve a photo is dithered with, from the machine and
 * engraving calibration in use (#34, #39):
 *
 * - the calibration's line interval, when there is a calibration with one;
 * - otherwise the machine's usual line interval;
 * - otherwise 0.1 mm, said plainly in the UI.
 *
 * The tone curve is the calibration's measured tone response, or none.
 */
export interface ProfileDither {
  dotPitchMm: number;
  dotPitchOrigin: Exclude<DotPitchOrigin, 'user'>;
  toneCurve: number[] | null;
}

export function profileDither(machine: Machine | null, calibration: Calibration | null): ProfileDither {
  const toneCurve = calibration?.toneCurve && calibration.toneCurve.length >= 2 ? [...calibration.toneCurve] : null;
  if (calibration?.lineIntervalMm && calibration.lineIntervalMm > 0) {
    return { dotPitchMm: calibration.lineIntervalMm, dotPitchOrigin: 'calibration', toneCurve };
  }
  if (machine?.lineIntervalMm && machine.lineIntervalMm > 0) {
    return { dotPitchMm: machine.lineIntervalMm, dotPitchOrigin: 'machine', toneCurve };
  }
  return { dotPitchMm: DEFAULT_DOT_PITCH_MM, dotPitchOrigin: 'default', toneCurve };
}

function sameCurve(a: number[] | null, b: number[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Brings a document's dither in line with `p`: the tone curve always, the
 * dot pitch unless the user set it for this job. Returns the same document
 * when nothing changes.
 */
export function applyProfileDither(p: ProfileDither): DocumentUpdate {
  return (d) => {
    const dither = d.steps.dither;
    const next: DitherConfig = { ...dither };
    if (dither.dotPitchOrigin !== 'user') {
      next.dotPitchMm = p.dotPitchMm;
      next.dotPitchOrigin = p.dotPitchOrigin;
    }
    next.toneCurve = p.toneCurve;
    const same =
      next.dotPitchMm === dither.dotPitchMm &&
      next.dotPitchOrigin === dither.dotPitchOrigin &&
      sameCurve(next.toneCurve, dither.toneCurve);
    return same ? d : { ...d, steps: { ...d.steps, dither: next } };
  };
}

/** Sets the dot pitch for this job by hand, or (with null) returns it to the profile's `p`. */
export function setDotPitch(mm: number | null, p: ProfileDither): DocumentUpdate {
  return (d) => {
    const dither: DitherConfig =
      mm === null
        ? { ...d.steps.dither, dotPitchMm: p.dotPitchMm, dotPitchOrigin: p.dotPitchOrigin }
        : { ...d.steps.dither, dotPitchMm: mm, dotPitchOrigin: 'user' };
    return { ...d, steps: { ...d.steps, dither } };
  };
}

/** One line saying where the dot pitch comes from. */
export function describeDotPitch(dither: DitherConfig, machine: Machine | null): string {
  const pitch = formatMm(dither.dotPitchMm);
  switch (dither.dotPitchOrigin) {
    case 'calibration':
      return `${pitch} line interval, from the engraving calibration in use.`;
    case 'machine':
      return `${pitch} line interval: ${machine?.name ?? 'the machine'}'s usual line interval. No engraving calibration for this material yet.`;
    case 'user':
      return `${pitch} line interval, set for this job.`;
    default:
      return `${pitch} line interval: a common default. ${machine ? `Set ${machine.name}'s usual line interval in Machines & materials` : 'Choose a machine'} so this matches your laser.`;
  }
}

/**
 * What the Dither step says about the engraving calibration in use: whether
 * the material's measured tone curve is applied before the dither, whether
 * that calibration is a copy not yet verified, or that there is none.
 */
export interface DitherCalibrationNote {
  tone: 'info' | 'warning';
  text: string;
  /** Offer the Calibrate entry point: the tones are not calibrated. */
  offerCalibrate: boolean;
}

export function ditherCalibrationNote(
  material: Material | null,
  calibration: Calibration | null,
  appliedCurve: number[] | null
): DitherCalibrationNote {
  if (!calibration?.toneCurve || calibration.toneCurve.length < 2 || !appliedCurve) {
    const what = material ? `for ${material.name}` : 'for this material';
    return {
      tone: 'warning',
      text: `Tones are not calibrated ${what} yet: photos will likely burn too dark in the midtones.`,
      offerCalibrate: true,
    };
  }
  const on = material ? ` for ${material.name}` : '';
  if (calibration.status === 'unverified') {
    return {
      tone: 'warning',
      text: `The tone curve${on} is applied before the dither, but it was copied from another material and is not yet verified: burn a test card on this one.`,
      offerCalibrate: true,
    };
  }
  return { tone: 'info', text: `The measured tone curve${on} is applied before the dither.`, offerCalibrate: false };
}
