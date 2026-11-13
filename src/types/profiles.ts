/**
 * Machine, material and calibration profiles (#33, docs/plan.md "Profiles").
 *
 * Every record is sync-ready (plan, "Accounts and sync"): a stable id, the
 * time it was last changed, a version that goes up by one on every change,
 * and a `deleted` flag, so a deletion is recorded as a tombstone instead of
 * the record disappearing.
 */

export interface SyncRecord {
  /** Stable id, never reused. */
  id: string;
  /** Milliseconds since 1970 of the last change. */
  modifiedAt: number;
  /** 1 when created; +1 on every change, including deletion. */
  version: number;
  /** A tombstone: the record was deleted. It is kept so the deletion can be merged. */
  deleted: boolean;
}

export type LaserSource = 'co2' | 'diode';

export interface Machine extends SyncRecord {
  name: string;
  source: LaserSource;
  /** Rated output in watts. */
  watts: number;
  /** Beam spot diameter in mm; null while unknown. */
  spotSizeMm: number | null;
  /** The lowest power, in percent, at which the tube or diode fires reliably; null while unknown. */
  minPowerPct: number | null;
  /** The line interval usually engraved at, in mm; null while unknown. */
  lineIntervalMm: number | null;
}

/** A user-made group of materials. It only groups them in lists. */
export interface Category extends SyncRecord {
  name: string;
}

/** One specific material: white oak and red oak are two materials. */
export interface Material extends SyncRecord {
  name: string;
  finish: string;
  /** Supplier or batch; empty when not given. */
  supplier: string;
  notes: string;
  /** null: not in a category. */
  categoryId: string | null;
}

export interface Thickness extends SyncRecord {
  materialId: string;
  mm: number;
}

/**
 * What a calibration is for. Engraving and relief are one per machine per
 * material; cutting is one per machine per thickness.
 */
export type CalibrationKind = 'engrave' | 'relief' | 'cut';

export type CalibrationStatus = 'verified' | 'unverified';

/** The settings a calibration holds; filled by hand or, later, from a calibration card. */
export interface CalibrationSettings {
  /** Head speed in mm/s. */
  speedMmS: number;
  /** Power range in percent: the minimum and maximum LightBurn power. */
  powerMinPct: number;
  powerMaxPct: number;
  passes: number;
  /** Scan line spacing in mm; null for cutting, which has no scan lines. */
  lineIntervalMm: number | null;
  /**
   * Engraving: the measured tone response, the darkness burned (0 none to 1
   * full) at evenly spaced input levels from white to black. Null when not measured.
   */
  toneCurve: number[] | null;
  /** Relief: the depth in mm burned at evenly spaced grey levels from white to black. Null when not measured. */
  depthCurve: number[] | null;
  /** Cutting: the width of the cut in mm, when measured. */
  kerfMm: number | null;
}

export interface Calibration extends SyncRecord, CalibrationSettings {
  kind: CalibrationKind;
  machineId: string;
  materialId: string;
  /** The thickness, for cutting only; null for engraving and relief. */
  thicknessId: string | null;
  /** "unverified": copied from another material or thickness, and not yet burned on this one. */
  status: CalibrationStatus;
  /** The calibration this was copied from, when it is a copy. */
  copiedFromId: string | null;
  notes: string;
}

/** Everything in the profile store, tombstones included. */
export interface ProfileData {
  machines: Machine[];
  categories: Category[];
  materials: Material[];
  thicknesses: Thickness[];
  calibrations: Calibration[];
}

export type ProfileCollection = keyof ProfileData;

/** The format of an exported profile file. */
export const PROFILE_FILE_FORMAT = 'image-suite-profiles';
export const PROFILE_FILE_VERSION = 1;

export interface ProfileFile {
  format: typeof PROFILE_FILE_FORMAT;
  formatVersion: number;
  exportedAt: number;
  profiles: ProfileData;
}
