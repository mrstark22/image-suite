import type { CardSpec } from '../types/calibration-card';
import { parseScan, type ScanPoints } from '../lib/scan-parse';
import { nudge, readAt, readScan, userAlign, type AlignResult, type PreparedScan, type ScanReading } from '../lib/scan-measure';

/** A change to the card's placement: card mm right and down, degrees turned, or mirrored. */
export interface PlacementChange {
  dx?: number;
  dy?: number;
  turnDeg?: number;
  flip?: boolean;
}

/**
 * The scan worker's API (#61): reads a 3D scan of a depth card and measures
 * it. It keeps the parsed points and the height grid, so changing the units
 * or the placement does not read the file again.
 */
export class ScanWorkerApi {
  private points: ScanPoints | null = null;
  private prep: PreparedScan | null = null;
  private align: AlignResult | null = null;
  private spec: CardSpec | null = null;

  /** Reads the file and measures the card, inferring the units unless `mmPerUnit` is given. */
  read(buffer: ArrayBuffer, fileName: string, spec: CardSpec, mmPerUnit: number | null = null): ScanReading {
    this.clear();
    this.points = parseScan(buffer, fileName);
    return this.measure(spec, mmPerUnit);
  }

  /** Measures the loaded scan again with other units (null: infer them). */
  measure(spec: CardSpec, mmPerUnit: number | null): ScanReading {
    if (!this.points) throw new Error('Load a scan first.');
    const { prep, reading } = readScan(this.points, spec, mmPerUnit);
    this.prep = prep;
    this.align = reading.align;
    this.spec = spec;
    return reading;
  }

  /** Moves, turns or mirrors the card's placement and measures again. */
  move(change: PlacementChange): ScanReading {
    if (!this.prep || !this.align || !this.spec) throw new Error('Load a scan first.');
    this.align = userAlign(this.prep, this.spec, nudge(this.spec, this.align.alignment, change), this.align);
    return readAt(this.prep, this.spec, this.align);
  }

  /** Lets go of the scan's memory. */
  clear(): void {
    this.points = null;
    this.prep = null;
    this.align = null;
  }
}
