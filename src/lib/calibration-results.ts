/**
 * Reading a burned calibration card (#40, #85, #47): what the user saw,
 * turned into the calibration saved for the card's machine, material and
 * (for cutting) thickness.
 *
 * Every function is pure; `saveCardResult` applies the result to the
 * profiles through `saveCalibration`, which matches the key exactly.
 */
import type { CardCell, CardSpec } from '../types/calibration-card';
import type { CalibrationKind, Machine, ProfileData } from '../types/profiles';
import { findCalibration, markCardRead, saveCalibration, settingsOf, updateMachine, type CalibrationEntry, type CalibrationKey } from './profiles';

/** The calibration a card fills. */
export const CARD_CALIBRATION: Record<CardSpec['kind'], CalibrationKind> = { 'engrave-grid': 'engrave', 'engrave-tone': 'engrave', cut: 'cut', relief: 'relief' };

export function cardKey(spec: CardSpec): CalibrationKey {
  return { kind: CARD_CALIBRATION[spec.kind], machineId: spec.machineId, materialId: spec.materialId, thicknessId: spec.thicknessId };
}

const cellAt = (spec: CardSpec, layer: number): CardCell => {
  const cell = spec.cells.find((c) => c.layer === layer);
  if (!cell) throw new Error(`Card #${spec.shortId} has no cell ${layer}.`);
  return cell;
};

// Photo card 1

/**
 * The engraving calibration from the cell the user picked on card 1: its
 * speed and power, the card's line interval, one pass. The tone curve is
 * cleared, because it was measured (if at all) at another setting; card 2
 * measures it at this one.
 */
export function engraveFromCell(spec: CardSpec, layer: number): CalibrationEntry {
  if (spec.kind !== 'engrave-grid') throw new Error('Pick a cell on photo card 1.');
  const c = cellAt(spec, layer);
  if (c.role !== 'ramp') throw new Error('That cell is not a ramp.');
  return {
    speedMmS: c.speedMmS,
    powerMinPct: c.powerMinPct,
    powerMaxPct: c.powerPct,
    passes: 1,
    lineIntervalMm: spec.lineIntervalMm,
    toneCurve: null,
    depthCurve: null,
    kerfMm: null,
    maxDepthMm: null,
    status: 'verified',
    notes: `From photo card 1 #${spec.shortId}, row ${c.row + 1}, column ${c.col + 1}.`,
  };
}

// Photo card 2

/**
 * The tone curve from card 2's marks: `lastBlank` is the last step that
 * still looks like bare material, `firstSolid` the first that looks as dark
 * as full black. Below and at `lastBlank` nothing shows (0), from
 * `firstSolid` on everything is black (1), and between them darkness rises
 * in proportion to the input. The curve has one entry per step of the
 * ramp, white to black, and never falls.
 */
export function toneCurveFromMarks(levels: readonly number[], lastBlank: number, firstSolid: number): number[] {
  if (!Number.isInteger(lastBlank) || !Number.isInteger(firstSolid) || lastBlank < 0 || firstSolid >= levels.length || firstSolid <= lastBlank) {
    throw new Error('The first step that looks fully black must come after the last step that looks bare.');
  }
  const lo = levels[lastBlank];
  const hi = levels[firstSolid];
  return levels.map((l, i) => (i <= lastBlank ? 0 : i >= firstSolid ? 1 : Number(((l - lo) / (hi - lo)).toFixed(4))));
}

/**
 * Adds card 2's tone curve to the engraving calibration burned at the
 * card's setting. The card is made from that calibration, so the setting is
 * the card's own.
 */
export function engraveWithTone(spec: CardSpec, lastBlank: number, firstSolid: number, d: ProfileData): CalibrationEntry {
  if (spec.kind !== 'engrave-tone') throw new Error('Mark the steps on photo card 2.');
  const c = spec.cells[0];
  const existing = findCalibration(d, cardKey(spec));
  const toneCurve = toneCurveFromMarks(spec.levels, lastBlank, firstSolid);
  return {
    ...(existing ? settingsOf(existing) : { depthCurve: null, kerfMm: null, maxDepthMm: null }),
    speedMmS: c.speedMmS,
    powerMinPct: c.powerMinPct,
    powerMaxPct: c.powerPct,
    passes: 1,
    lineIntervalMm: spec.lineIntervalMm,
    toneCurve,
    status: 'verified',
    notes: `${existing?.notes ? `${existing.notes} ` : ''}Tone curve from photo card 2 #${spec.shortId}: bare up to ${Math.round(spec.levels[lastBlank] * 100)} %, fully black from ${Math.round(spec.levels[firstSolid] * 100)} %.`,
  };
}

// Cut card

/** What a cut square did: stayed in, dropped out cleanly, or dropped out with a charred edge. */
export type CutMark = 'stuck' | 'clean' | 'charred';

/**
 * The cut to propose: of the squares that dropped out cleanly, the fastest,
 * then the lowest power, then the fewest passes. When none dropped out
 * without charring, the same choice among the charred ones, flagged. Null
 * when nothing dropped out.
 */
export function proposeCut(spec: CardSpec, marks: Record<number, CutMark>): { layer: number; charred: boolean } | null {
  const pick = (want: CutMark) =>
    spec.cells
      .filter((c) => c.role === 'shape' && marks[c.layer] === want)
      .sort((a, b) => b.speedMmS - a.speedMmS || a.powerPct - b.powerPct || a.passes - b.passes)[0];
  const clean = pick('clean');
  if (clean) return { layer: clean.layer, charred: false };
  const charred = pick('charred');
  return charred ? { layer: charred.layer, charred: true } : null;
}

/**
 * The kerf from a caliper measurement: a square drawn `nominalMm` wide
 * that measures `measuredMm` lost half the kerf on each side, so the kerf
 * is the difference.
 */
export function kerfFrom(nominalMm: number, measuredMm: number): number {
  if (!(measuredMm > 0) || !Number.isFinite(measuredMm)) throw new Error('Enter the measured width of a cut square in mm.');
  const kerf = nominalMm - measuredMm;
  if (kerf < 0) throw new Error(`A cut square cannot be larger than drawn (${nominalMm} mm): measure the piece that dropped out, not the hole.`);
  if (kerf > 1.5) throw new Error(`A kerf of ${kerf.toFixed(2)} mm is not plausible: check the measurement.`);
  return Number(kerf.toFixed(3));
}

export function cutFromCell(spec: CardSpec, layer: number, kerfMm: number | null, charred: boolean): CalibrationEntry {
  if (spec.kind !== 'cut') throw new Error('Pick a square on a cut card.');
  const c = cellAt(spec, layer);
  return {
    speedMmS: c.speedMmS,
    powerMinPct: c.powerMinPct,
    powerMaxPct: c.powerPct,
    passes: c.passes,
    lineIntervalMm: null,
    toneCurve: null,
    depthCurve: null,
    kerfMm,
    maxDepthMm: null,
    status: 'verified',
    notes: `From cut card #${spec.shortId}, row ${c.row + 1}, column ${c.col + 1}${charred ? '; the edge charred' : ''}.`,
  };
}

// Relief card

/**
 * Makes measured depths never decrease, by pooling neighbours that go the
 * wrong way into their average (isotonic regression). Measurement noise
 * can make a darker step read shallower; the curve must still rise.
 */
export function monotonicDepths(depths: readonly number[]): number[] {
  const blocks: { sum: number; n: number }[] = [];
  for (const d of depths) {
    blocks.push({ sum: d, n: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].sum / blocks[blocks.length - 2].n > blocks[blocks.length - 1].sum / blocks[blocks.length - 1].n) {
      const b = blocks.pop()!;
      blocks[blocks.length - 1].sum += b.sum;
      blocks[blocks.length - 1].n += b.n;
    }
  }
  return blocks.flatMap((b) => Array<number>(b.n).fill(Number((b.sum / b.n).toFixed(4))));
}

export interface DepthResult {
  /** Depth in mm at each step, white to black, never decreasing. */
  depthCurve: number[];
  /** The deepest the ramp burned, at full black. */
  maxDepthMm: number;
  /** The steps whose entry was averaged with a neighbour to keep the curve rising. */
  adjusted: number[];
}

/**
 * The depth curve from the depths entered for each step. Its inverse, which
 * the relief export applies, is in `depth-curve.ts` (the only one).
 */
export function depthCurveFrom(depths: readonly (number | null)[]): DepthResult {
  if (depths.length < 2) throw new Error('Enter a depth for every step.');
  depths.forEach((d, i) => {
    if (d === null || !Number.isFinite(d)) throw new Error(`Enter a depth for step ${i + 1}.`);
    if (d < 0 || d > 50) throw new Error(`Step ${i + 1}: a depth must be between 0 and 50 mm.`);
  });
  const raw = depths as number[];
  const depthCurve = monotonicDepths(raw);
  const maxDepthMm = depthCurve[depthCurve.length - 1];
  if (!(maxDepthMm > depthCurve[0])) throw new Error('The darkest step must be deeper than the lightest: check the entries.');
  const adjusted = raw.flatMap((d, i) => (Math.abs(d - depthCurve[i]) > 1e-9 ? [i] : []));
  return { depthCurve, maxDepthMm, adjusted };
}

export function reliefFromDepths(spec: CardSpec, depths: readonly (number | null)[]): { entry: CalibrationEntry; result: DepthResult } {
  if (spec.kind !== 'relief') throw new Error('Enter depths from a depth card.');
  if (depths.length !== spec.levels.length) throw new Error(`Card #${spec.shortId} has ${spec.levels.length} steps.`);
  const result = depthCurveFrom(depths);
  const c = spec.cells[0];
  return {
    result,
    entry: {
      speedMmS: c.speedMmS,
      powerMinPct: c.powerMinPct,
      powerMaxPct: c.powerPct,
      passes: c.passes,
      lineIntervalMm: spec.lineIntervalMm,
      toneCurve: null,
      depthCurve: result.depthCurve,
      kerfMm: null,
      maxDepthMm: result.maxDepthMm,
      status: 'verified',
      notes: `From depth card #${spec.shortId}.`,
    },
  };
}

/** The lowest power that marked, from the minimum-power row: the power of the first square that shows. */
export function minPowerFrom(spec: CardSpec, firstMarkedLayer: number): number {
  const c = cellAt(spec, firstMarkedLayer);
  if (c.role !== 'min-power') throw new Error('That is not a minimum-power square.');
  return c.powerPct;
}

/**
 * Saves a card's result as the calibration for exactly the card's machine,
 * material and thickness, and records the card as read. A minimum power, if
 * found, goes to the machine.
 */
export function saveCardResult(d: ProfileData, spec: CardSpec, entry: CalibrationEntry, minPowerPct: number | null = null): { data: ProfileData; id: string } {
  const saved = saveCalibration(d, cardKey(spec), entry);
  let data = saved.data;
  if (minPowerPct !== null) data = updateMachine(data, spec.machineId, { minPowerPct } as Partial<Pick<Machine, 'minPowerPct'>>);
  if (data.cards.some((c) => c.id === spec.id && !c.deleted)) data = markCardRead(data, spec.id);
  return { data, id: saved.id };
}
