import type { Calibration, Machine } from '../types/profiles';
import type { BurnSimulation } from '../types/worker-messages';
import { formatMm } from './profiles';

/**
 * The burn simulation preview's settings (#41). The simulation itself is in
 * the Rust core (`burn_sim.rs`): each burned dot drawn as a round spot.
 *
 * What it can know, and what it assumes:
 * - Spot size: the machine's, when set in its profile; otherwise an assumed
 *   0.15 mm, typical of a CO2 tube with a 2" lens.
 * - Darkness of a burned dot: the darkest the calibration's tone response
 *   reaches, when there is one; otherwise an assumed 85 %.
 * - Material colour: profiles do not record one yet, so it is always a
 *   generic light wood, and is labelled so.
 */

/** A generic light wood (birch ply, maple). */
export const GENERIC_BASE: readonly [number, number, number] = [226, 200, 160];
/** A fully burned dot on wood: dark brown, near black. */
export const FULL_BURN: readonly [number, number, number] = [38, 24, 16];
export const ASSUMED_SPOT_MM = 0.15;
export const ASSUMED_DARKNESS = 0.85;

export interface BurnSimulationSettings {
  simulation: BurnSimulation;
  /** What the simulation is based on, in one or two plain sentences. */
  basis: string;
  /** True when anything was assumed rather than taken from a profile. */
  generic: boolean;
}

export function burnSimulationSettings(dotPitchMm: number, machine: Machine | null, calibration: Calibration | null): BurnSimulationSettings {
  const spotMm = machine?.spotSizeMm && machine.spotSizeMm > 0 ? machine.spotSizeMm : null;
  const curve = calibration?.toneCurve && calibration.toneCurve.length >= 2 ? calibration.toneCurve : null;
  const darkness = curve ? Math.min(1, Math.max(0, Math.max(...curve))) : null;
  const d = darkness ?? ASSUMED_DARKNESS;
  const burn = GENERIC_BASE.map((b, i) => Math.round(b + (FULL_BURN[i] - b) * d)) as [number, number, number];
  const spot = spotMm ?? ASSUMED_SPOT_MM;
  const parts = [
    spotMm ? `${formatMm(spot)} spot from ${machine!.name}` : `assumed ${formatMm(spot)} spot (set the machine's spot size in Machines & materials)`,
    darkness !== null ? `dot darkness from the calibration` : 'assumed dot darkness (no measured tone response)',
    'generic light wood colour',
  ];
  return {
    simulation: { spotPx: spot / dotPitchMm, base: [...GENERIC_BASE], burn },
    basis: `Simulated burn: ${parts.join(', ')}. A guide, not a measurement.`,
    generic: spotMm === null || darkness === null,
  };
}
