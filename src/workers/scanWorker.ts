import * as Comlink from 'comlink';
import { ScanWorkerApi, type PlacementChange } from './scan-api';
import type { ScanReading } from '../lib/scan-measure';
import type { CardSpec } from '../types/calibration-card';

/**
 * A small worker for reading 3D scans of depth cards (#61). It is separate
 * from the image worker: a scan is measured, not image-processed, and its
 * points (tens of MB for a few million) should not share memory with the
 * decoded image.
 */
const api = new ScanWorkerApi();
const send = (r: ScanReading) => Comlink.transfer(r, [r.image.depth.buffer]);

Comlink.expose({
  read: (buffer: ArrayBuffer, fileName: string, spec: CardSpec, mmPerUnit: number | null) => send(api.read(buffer, fileName, spec, mmPerUnit)),
  measure: (spec: CardSpec, mmPerUnit: number | null) => send(api.measure(spec, mmPerUnit)),
  move: (change: PlacementChange) => send(api.move(change)),
  clear: () => api.clear(),
});
