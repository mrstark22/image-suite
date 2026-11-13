/**
 * Calibration cards (#40, #85, #47): what a card is, as stored with the
 * profiles so "Enter results" can find it after a reload or on another
 * browser that imported the profiles.
 *
 * Every length is in mm, every speed in mm/s and every power in percent.
 */

/**
 * - `engrave-grid`: photo card 1, a grid of short tone ramps, one speed and power per cell.
 * - `engrave-tone`: photo card 2, one fine ramp burned at the chosen setting.
 * - `cut`: squares cut at one speed, power and passes each, for one thickness.
 * - `relief`: a stepped grey ramp burned in Grayscale mode, plus a row that finds the minimum power.
 */
export type CardKind = 'engrave-grid' | 'engrave-tone' | 'cut' | 'relief';

/** One burned cell, on its own LightBurn layer. */
export interface CardCell {
  /** The LightBurn layer index (0 to 29); also the cell's position in `cells`. */
  layer: number;
  row: number;
  col: number;
  speedMmS: number;
  /** The power the cell fires at (LightBurn's maximum power; the minimum too, except on a relief ramp). */
  powerPct: number;
  /** Relief ramp only: LightBurn's minimum power, which white is burned at. Otherwise equal to `powerPct`. */
  powerMinPct: number;
  passes: number;
  /** What the cell is. */
  role: 'ramp' | 'shape' | 'min-power';
}

export interface CardSpec {
  /** Stable id. */
  id: string;
  /** Four characters burned on the card, to find it again: "K7Q2". */
  shortId: string;
  kind: CardKind;
  machineId: string;
  materialId: string;
  /** Cut cards only. */
  thicknessId: string | null;
  /** The names when the card was made, as burned on it. */
  machineName: string;
  materialName: string;
  thicknessMm: number | null;
  /** Milliseconds since 1970. */
  createdAt: number;
  rows: number;
  cols: number;
  cells: CardCell[];
  /**
   * The tone of each step of a ramp, as darkness from 0 (white, no burn) to
   * 1 (black, full power): a photo cell's short ramp, the fine ramp of card
   * 2 or the relief's grey steps. Empty for a cut card.
   */
  levels: number[];
  /** Width of one ramp step, or the side of a cut square. */
  stepMm: number;
  /** Height of a ramp. */
  rampHeightMm: number;
  /** Scan line spacing of image layers; 1 image pixel is 1 line. */
  lineIntervalMm: number;
  /** The setting the labels are burned at, on the last layer. */
  label: { speedMmS: number; powerPct: number };
}

/** A card as stored with the profiles. */
export interface CardRecordFields {
  spec: CardSpec;
  /** When results were entered from it; null while it is waiting for them. */
  readAt: number | null;
}
