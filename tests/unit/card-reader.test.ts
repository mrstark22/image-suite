/**
 * Reading a burned photo card from a photo (#56): synthetic photos of known
 * cards, warped, unevenly lit, blurred and noisy, read back to the card id,
 * the patch positions, the planted tone values, the planted scorch and the
 * planted tone curve; and the failures, each with a clear message.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildCard, cardDefaults, cardLayout, type CardRequest } from '../../src/lib/calibration-cards';
import { CardPhotoImage, type CardPhotoExports } from '../../src/lib/card-photo-call';
import { readCardPhoto, project, type CardReading } from '../../src/lib/card-reader';
import { engraveWithMeasuredTone, saveCardResult } from '../../src/lib/calibration-results';
import { addCard, addMaterial, findCalibration, seedProfiles } from '../../src/lib/profiles';
import type { CardSpec } from '../../src/types/calibration-card';
import { loadWasm } from '../helpers/wasm';
import { cardPhoto, type PhotoOptions } from '../helpers/card-photo';

let ex: CardPhotoExports;
beforeAll(async () => {
  ex = (await loadWasm({ fresh: true })).exports as unknown as CardPhotoExports;
});

const machine = { id: 'm60', name: '60 W CO2', watts: 60, minPowerPct: null, source: 'co2' as const, lineIntervalMm: 0.1 };
function card(kind: CardRequest['kind'], shortId: string): CardSpec {
  return buildCard({ kind, machine, material: { id: 'oak', name: 'White Oak' }, thickness: null, ranges: cardDefaults(kind, machine), createdAt: Date.UTC(2026, 10, 13), id: `card-${shortId}`, shortId });
}

function read(spec: CardSpec, o: PhotoOptions, known: CardSpec[] = []): { reading: CardReading; truth: number[] } {
  const photo = cardPhoto(spec, o);
  const img = CardPhotoImage.open(ex, photo.rgba, photo.width, photo.height);
  try {
    return { reading: readCardPhoto(img, spec, known), truth: photo.truth };
  } finally {
    img.free();
  }
}

/** A cell's planted response: darkness rising with the level, stronger for later cells. */
const planted = (spec: CardSpec) => (layer: number, _i: number, level: number) => {
  const c = spec.cells[layer];
  const strength = 0.25 + 0.65 * (c.row * spec.cols + c.col) / (spec.cells.length - 1);
  return Math.min(0.92, 0.04 + strength * level);
};

// A sloping light, brighter at the top left, as from a window.
const slope = (u: number, v: number) => 1.15 - 0.35 * u - 0.25 * v;

const harsh: Partial<PhotoOptions> = { light: slope, blurPx: 1, noise: 3 };

describe('reading photo card 1', () => {
  const spec = card('engrave-grid', 'K7Q2');
  const darkness = planted(spec);
  // The strongest cell is charred: a dark halo around it.
  const charred = spec.cells[spec.cells.length - 1].layer;

  it('finds the card, reads its code, measures every step and ranks the cells, skipping the scorched one', () => {
    const { reading, truth } = read(spec, { ...harsh, darkness, halos: [{ layer: charred, darkness: 0.3 }] });
    if (!reading.ok) throw new Error(reading.message);
    expect(reading.codeRead).toBe(true);
    expect(reading.spec.shortId).toBe('K7Q2');

    // Patch positions: the map found puts every cell within 1.5 px of where it is.
    for (const b of cardLayout(spec).cells) {
      const found = project(reading.homography, b.x + b.w / 2, b.y + b.h / 2);
      const real = project(truth, b.x + b.w / 2, b.y + b.h / 2);
      expect(Math.hypot(found.x - real.x, found.y - real.y)).toBeLessThan(1.5);
    }

    // Tone values: within 0.05 of what was planted, relative to bare wood, despite the sloping light.
    const cells = reading.cells!;
    for (const c of cells) spec.levels.forEach((l, i) => expect(Math.abs(c.steps[i] - darkness(c.layer, i, l))).toBeLessThan(0.05));

    // The charred cell is flagged and ranked last; no other cell is flagged.
    expect(cells.find((c) => c.layer === charred)!.scorched).toBe(true);
    expect(cells.filter((c) => c.scorched)).toHaveLength(1);
    expect(cells[cells.length - 1].layer).toBe(charred);
    // The proposal is the widest clean range: the strongest cell that is not charred.
    expect(cells[0].layer).toBe(charred - 1);
    expect(cells[0].distinct).toBe(spec.levels.length - 1);
  });

  it('reads a card photographed upside down and from an angle', () => {
    const corners: [number, number][] = [
      [1250, 900],
      [180, 960],
      [130, 160],
      [1300, 60],
    ];
    const { reading } = read(spec, { ...harsh, darkness, corners });
    if (!reading.ok) throw new Error(reading.message);
    expect(reading.codeRead).toBe(true);
    expect(reading.cells![0].layer).toBe(charred);
  });

  it('measures a card whose code does not read, as the card chosen, and says so', () => {
    const { reading } = read(spec, { ...harsh, darkness, noCode: true });
    if (!reading.ok) throw new Error(reading.message);
    expect(reading.codeRead).toBe(false);
    expect(reading.warnings.join(' ')).toMatch(/code could not be read/);
  });
});

describe('reading photo card 2', () => {
  const spec = card('engrave-tone', 'H4WN');
  // A planted response: nothing below 10 %, then a curve that saturates at 0.85 darkness.
  const response = (level: number) => (level <= 0.1 ? 0.02 : 0.02 + 0.83 * Math.pow((level - 0.1) / 0.9, 0.6));

  it('builds the tone curve from the measured steps', () => {
    const { reading } = read(spec, { ...harsh, darkness: (_l, _i, level) => response(level) });
    if (!reading.ok) throw new Error(reading.message);
    expect(reading.codeRead).toBe(true);
    const want = spec.levels.map((l) => (response(l) - response(0)) / (response(1) - response(0)));
    reading.tone!.curve.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThan(0.05));
    expect(reading.tone!.curve[0]).toBe(0);
    expect(reading.tone!.curve[20]).toBe(1);
    expect(reading.tone!.lastBlank).toBe(2);

    // Saved as the engraving calibration at the card's setting.
    let d = seedProfiles();
    const m = addMaterial(d, { name: 'White Oak', finish: '', supplier: '', notes: '', categoryId: null });
    const s = { ...spec, machineId: d.machines[0].id, materialId: m.id };
    d = addCard(m.data, s).data;
    d = saveCardResult(d, s, engraveWithMeasuredTone(s, reading.tone!.curve, d)).data;
    const cal = findCalibration(d, { kind: 'engrave', machineId: s.machineId, materialId: s.materialId, thicknessId: null })!;
    expect(cal.toneCurve).toEqual(reading.tone!.curve);
    expect(cal.notes).toMatch(/measured from a photo/);
  });
});

describe('when a photo cannot be read', () => {
  const one = card('engrave-grid', 'K7Q2');
  const two = card('engrave-tone', 'H4WN');
  const rising = (_l: number, _i: number, level: number) => 0.05 + 0.8 * level;

  it('no markers: the card is not in the frame', () => {
    // The card fills more than the photo: its corners are outside.
    const corners: [number, number][] = [
      [-200, -150],
      [1600, -150],
      [1600, 1150],
      [-200, 1150],
    ];
    const { reading } = read(one, { darkness: rising, corners });
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.message).toMatch(/corner markers.*Choose by eye/s);
  });

  it('a plain photo with no card: no markers', () => {
    const img = CardPhotoImage.open(ex, new Uint8ClampedArray(400 * 300 * 4).fill(200), 400, 300);
    try {
      const r = readCardPhoto(img, one, []);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/Found none of the card's 4 corner markers/);
    } finally {
      img.free();
    }
  });

  it('the wrong card: names the card in the photo', () => {
    const { reading } = read(two, { darkness: rising });
    if (!reading.ok) throw new Error(reading.message);
    const photo = cardPhoto(two, { darkness: rising });
    const img = CardPhotoImage.open(ex, photo.rgba, photo.width, photo.height);
    try {
      const r = readCardPhoto(img, one, [one, two]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/card #H4WN \(photo card 2, White Oak on 60 W CO2\), not card #K7Q2.*Choose by eye/s);
    } finally {
      img.free();
    }
  });

  it('too dark to measure', () => {
    const { reading } = read(one, { darkness: rising, light: () => 0.02 });
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.message).toMatch(/too dark/);
  });
});
