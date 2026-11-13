/**
 * Reading a relief depth card from a 3D scan (#61): the defining properties.
 *
 * - Every format reads to the same points.
 * - The plane fit recovers the planted tilt, despite the pockets.
 * - The alignment finds the planted rotation and mirror state.
 * - Each step's depth is recovered within 0.03 mm. Why that tolerance: the
 *   planted noise is 0.02 mm (the reference scanner's stated accuracy); a
 *   step's floor holds hundreds of grid cells, so the median's own error is
 *   well under 0.005 mm; the rest of the budget is the plane fit and the
 *   float32 rounding of a file in metres. Calipers read to 0.02 mm, so a
 *   scan within 0.03 mm is as good as the typed entry it replaces.
 * - A step with too little of its floor scanned is reported as not measured.
 * - Confirmed depths make the same calibration as typing them.
 */
import { describe, expect, it } from 'vitest';
import { buildCard, cardDefaults, cardLayout } from '../../src/lib/calibration-cards';
import { reliefFromDepths } from '../../src/lib/calibration-results';
import { addMaterial, seedProfiles } from '../../src/lib/profiles';
import { parseScan } from '../../src/lib/scan-parse';
import { cardToGrid, fitPlane, readScan, scanEntries, snapUnits, tiltDeg } from '../../src/lib/scan-measure';
import { syntheticScan, toObj, toPlyAscii, toPlyBinary, toStlAscii, toStlBinary } from '../helpers/synthetic-scan';
import type { CardSpec } from '../../src/types/calibration-card';

function reliefCard(): CardSpec {
  const d = seedProfiles();
  const machine = d.machines[0];
  const m = addMaterial(d, { name: 'Maple', finish: '', supplier: '', notes: '', categoryId: null });
  return buildCard({ kind: 'relief', machine, material: { id: m.id, name: 'Maple' }, thickness: null, ranges: cardDefaults('relief', machine), createdAt: Date.UTC(2026, 10, 13), id: 'card-r', shortId: 'R3L1' });
}

const spec = reliefCard();
const n = spec.levels.length;
// A curve that burns faster than linear and saturates, like a real ramp.
const DEPTHS = spec.levels.map((l) => Number((1.6 * Math.pow(l, 1.3)).toFixed(3)));
const TOL = 0.03;

describe('scan file formats', () => {
  const pts = syntheticScan(spec, { depths: DEPTHS, points: 3 * 4000, angleDeg: 17, tiltDeg: 3 });
  const files: [string, ArrayBuffer, string][] = [
    ['card.stl', toStlBinary(pts), 'stl-binary'],
    ['card.stl', toStlAscii(pts), 'stl-ascii'],
    ['card.ply', toPlyAscii(pts, false), 'ply-ascii'],
    ['card.ply', toPlyAscii(pts, true), 'ply-ascii'],
    ['card.ply', toPlyBinary(pts, false), 'ply-binary'],
    ['card.ply', toPlyBinary(pts, true), 'ply-binary'],
    ['card.obj', toObj(pts), 'obj'],
  ];
  it.each(files.map((f, i) => [i, ...f] as const))('format %i (%s) reads to the same points', (_i, name, buf, format) => {
    const s = parseScan(buf, name);
    expect(s.format).toBe(format);
    expect(s.count).toBe(pts.length / 3);
    let worst = 0;
    // ASCII writes 9 significant digits; float32 holds about 7.
    for (let k = 0; k < pts.length; k++) worst = Math.max(worst, Math.abs(s.xyz[k] - pts[k]) / Math.max(1, Math.abs(pts[k])));
    expect(worst).toBeLessThan(1e-6);
  });
  it('a file that is not a scan is refused with a reason', () => {
    expect(() => parseScan(new TextEncoder().encode('hello').buffer as ArrayBuffer, 'notes.txt')).toThrow(/STL, PLY or OBJ/);
    expect(() => parseScan(new TextEncoder().encode('ply\nformat binary_big_endian 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n').buffer as ArrayBuffer, 'a.ply')).toThrow(/big_endian/);
  });
});

describe('a meshed scan', () => {
  // A scanner's mesh: a regular grid of corners, two triangles per square, so
  // each corner is written once per triangle that shares it (up to six times).
  // The copies must be merged, or the point spacing is misjudged and the
  // height grid is finer than the points, full of holes, and finds no ramp.
  function latticeStl(stepMm: number, tilt: number): ArrayBuffer {
    const layout = cardLayout(spec);
    const ramp = layout.cells.find((b) => b.cell.role === 'ramp')!;
    const nx = Math.round(layout.widthMm / stepMm) + 1;
    const ny = Math.round(layout.heightMm / stepMm) + 1;
    const corner = (i: number, j: number) => {
      const x = i * stepMm;
      const y = j * stepMm;
      const inside = x > ramp.x && x < ramp.x + ramp.w && y > ramp.y && y < ramp.y + ramp.h;
      const d = inside ? DEPTHS[Math.min(n - 1, Math.floor((x - ramp.x) / spec.stepMm))] : 0;
      return [x, -y, -d + x * Math.sin(tilt)];
    };
    const tris: number[] = [];
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = corner(i, j), b = corner(i + 1, j), c = corner(i, j + 1), e = corner(i + 1, j + 1);
        tris.push(...a, ...b, ...e, ...a, ...e, ...c);
      }
    return toStlBinary(Float32Array.from(tris));
  }
  it('merges shared corners and reads every step', () => {
    const file = parseScan(latticeStl(0.25, (2 * Math.PI) / 180), 'card.stl');
    const layout = cardLayout(spec);
    expect(file.count).toBe((Math.round(layout.widthMm / 0.25) + 1) * (Math.round(layout.heightMm / 0.25) + 1));
    const { reading } = readScan(file, spec);
    const got = scanEntries(reading.steps);
    got.forEach((d, i) => expect(Math.abs((d ?? -1) - DEPTHS[i])).toBeLessThan(TOL));
  });
});

describe('plane fit', () => {
  it.each([0, 2.5, 8])('recovers a %s° tilt, despite pockets covering a fifth of the card', (tilt) => {
    const pts = syntheticScan(spec, { depths: DEPTHS, points: 60000, tiltDeg: tilt, tiltAxisDeg: 40, seed: 3 });
    const p = fitPlane(pts, pts.length / 3);
    expect(Math.abs(tiltDeg(p) - tilt)).toBeLessThan(0.05);
    // Pointing out of the surface: the planted pockets are below it.
    expect(p.sigma).toBeLessThan(0.03);
  });
});

describe('reading a card', () => {
  const cases = [
    { name: 'millimetres, turned 0°', angleDeg: 0, mirrored: false, mmPerUnit: 1 },
    { name: 'millimetres, turned 113°, mirrored', angleDeg: 113, mirrored: true, mmPerUnit: 1 },
    { name: 'metres, turned 200°', angleDeg: 200, mirrored: false, mmPerUnit: 1000 },
    { name: 'metres, turned 291°, mirrored', angleDeg: 291, mirrored: true, mmPerUnit: 1000 },
  ];
  it.each(cases)('$name: units, rotation, mirror and every depth', ({ angleDeg, mirrored, mmPerUnit }) => {
    const pts = syntheticScan(spec, { depths: DEPTHS, points: 250000, angleDeg, mirrored, mmPerUnit, tiltDeg: 4, offset: [0.3 * (1000 / mmPerUnit) / 1000, -0.1, 5 / mmPerUnit], seed: angleDeg + 1 });
    const { reading } = readScan({ xyz: pts, count: pts.length / 3, format: 'ply-binary' }, spec);
    expect(reading.units.mmPerUnit).toBe(mmPerUnit);
    expect(reading.units.chosen).toBe(false);
    expect(reading.align.alignment.mirrored).toBe(mirrored);
    expect(reading.align.sure).toBe(true);
    // The card's x axis points where it was turned to (mirroring flips y, not x).
    const a = reading.align.alignment;
    const [u0, w0] = cardToGrid(a, 0, 0);
    const [u1, w1] = cardToGrid(a, 10, 0);
    // Seen from above, the scan's w axis runs opposite to its y; a planted angle is counter-clockwise in xy.
    const seen = (Math.atan2(-(w1 - w0), u1 - u0) * 180) / Math.PI;
    const diff = ((seen - angleDeg) % 360 + 540) % 360 - 180;
    expect(Math.abs(diff)).toBeLessThan(0.5);
    reading.steps.forEach((s, i) => {
      expect(s.depthMm, `step ${i}`).not.toBeNull();
      expect(Math.abs(s.depthMm! - DEPTHS[i]), `step ${i}: ${s.depthMm} vs ${DEPTHS[i]}`).toBeLessThan(TOL);
      expect(s.samples).toBeGreaterThan(500);
      expect(s.spreadMm!).toBeLessThan(0.1);
    });
  });

  it('measures the planted wall angle where the wall is resolved', () => {
    const pts = syntheticScan(spec, { depths: DEPTHS, points: 400000, wallDeg: 30, angleDeg: 40, seed: 9 });
    const { reading } = readScan({ xyz: pts, count: pts.length / 3, format: 'obj' }, spec);
    const deep = reading.steps.filter((s) => DEPTHS[s.index] > 0.8);
    expect(deep.length).toBeGreaterThan(2);
    for (const s of deep) {
      expect(s.wallAtLeast).toBe(false);
      expect(Math.abs(s.wallDeg! - 30)).toBeLessThan(6);
    }
  });

  it('reports the darkest step as not measured when most of it did not scan, and still reads the others', () => {
    const pts = syntheticScan(spec, { depths: DEPTHS, points: 250000, angleDeg: 75, dropout: { [n - 1]: 0.97, [n - 2]: 0.5 }, seed: 11 });
    const { reading } = readScan({ xyz: pts, count: pts.length / 3, format: 'stl-binary' }, spec);
    expect(reading.steps[n - 1].depthMm).toBeNull();
    expect(reading.steps[n - 1].coverage).toBeLessThan(0.3);
    expect(Math.abs(reading.steps[n - 2].depthMm! - DEPTHS[n - 2])).toBeLessThan(TOL);
    for (let i = 0; i < n - 1; i++) expect(Math.abs(reading.steps[i].depthMm! - DEPTHS[i])).toBeLessThan(TOL);
    expect(scanEntries(reading.steps)[n - 1]).toBeNull();
  });

  it('flags the placement as unsure when the lettering does not show, so the user checks the mirror state', () => {
    const pts = syntheticScan(spec, { depths: DEPTHS, points: 200000, angleDeg: 30, textDepthMm: 0, seed: 5 });
    const { reading } = readScan({ xyz: pts, count: pts.length / 3, format: 'obj' }, spec);
    expect(reading.align.sure).toBe(false);
    expect(reading.align.why).toMatch(/mirror/);
    // The ramp reads the same either way, so the depths are still right.
    reading.steps.forEach((s, i) => expect(Math.abs(s.depthMm! - DEPTHS[i]), `step ${i} ${JSON.stringify(reading.steps.map((q) => q.depthMm))} ${DEPTHS}`).toBeLessThan(TOL));
  });

  it('honours units the user chose instead of inferring them', () => {
    const pts = syntheticScan(spec, { depths: DEPTHS, points: 100000, mmPerUnit: 1000, seed: 2 });
    const { reading } = readScan({ xyz: pts, count: pts.length / 3, format: 'obj' }, spec, 1000);
    expect(reading.units).toMatchObject({ mmPerUnit: 1000, name: 'metres', chosen: true });
  });

  it('an unknown scale snaps to no unit and says it scaled to the card', () => {
    expect(snapUnits(3.7, 'x').name).toBe('unitless');
    expect(snapUnits(1.08, 'x').name).toBe('millimetres');
    expect(snapUnits(940, 'x').name).toBe('metres');
  });

  it('the depth picture is in the card’s frame: a step’s pixels read its planted depth', () => {
    const pts = syntheticScan(spec, { depths: DEPTHS, points: 200000, angleDeg: 150, mirrored: true, seed: 4 });
    const { reading } = readScan({ xyz: pts, count: pts.length / 3, format: 'obj' }, spec);
    const img = reading.image;
    const ramp = cardLayout(spec).cells.find((b) => b.cell.role === 'ramp')!;
    const i = n - 1;
    const px = Math.round((ramp.x + (i + 0.5) * spec.stepMm - img.x0) * img.ppm);
    const py = Math.round((ramp.y + ramp.h / 2 - img.y0) * img.ppm);
    const vals: number[] = [];
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) vals.push(img.depth[(py + dy) * img.width + px + dx]);
    const finite = vals.filter(Number.isFinite).sort((a, b) => a - b);
    expect(Math.abs(finite[Math.floor(finite.length / 2)] - DEPTHS[i])).toBeLessThan(0.05);
  });
});

describe('hand-off', () => {
  it('confirmed scan depths give exactly the calibration that typing the same depths gives', () => {
    const pts = syntheticScan(spec, { depths: DEPTHS, points: 150000, angleDeg: 10, seed: 8 });
    const { reading } = readScan({ xyz: pts, count: pts.length / 3, format: 'obj' }, spec);
    const fromScan = scanEntries(reading.steps);
    // What the dialog does with typed text: the same numbers as strings, parsed back.
    const typed = fromScan.map((d) => String(d)).map((t) => Number(t));
    expect(reliefFromDepths(spec, fromScan)).toEqual(reliefFromDepths(spec, typed));
    const { result } = reliefFromDepths(spec, fromScan);
    expect(Math.abs(result.maxDepthMm - DEPTHS[n - 1])).toBeLessThan(TOL);
  });
});
