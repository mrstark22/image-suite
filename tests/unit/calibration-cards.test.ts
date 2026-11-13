// @vitest-environment jsdom
/**
 * Calibration cards (#40 photo, #85 cut, #47 relief): the defining
 * properties.
 *
 * - Each card's physical size and cell positions in mm, and its pixels.
 * - The value lettered against a cell is the value in its layer.
 * - Never more than 30 LightBurn layers.
 * - The .lbrn2 project parses as XML, with one layer per cell carrying that
 *   cell's speed, power and passes, and the right shape or image geometry.
 * - The plain-file fallback: the SVG's squares and the PNG's size and DPI.
 * - Results become the right calibration, stored under exactly the card's
 *   machine, material and thickness, across a reload and a profile file.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_CELLS,
  MAX_LAYERS,
  TONE_RAMP_LEVELS,
  buildCard,
  cardDefaults,
  cardLayout,
  greyOf,
  labelLayer,
  renderCard,
  type CardRequest,
} from '../../src/lib/calibration-cards';
import { cardProject } from '../../src/lib/lbrn2';
import { cardPng, cutCardSvg, settingsTable, LIGHTBURN_LAYER_COLOURS } from '../../src/lib/card-files';
import { textRects, textWidthMm } from '../../src/lib/card-font';
import {
  cardKey,
  cutFromCell,
  depthCurveFrom,
  engraveFromCell,
  engraveWithTone,
  kerfFrom,
  minPowerFrom,
  monotonicDepths,
  proposeCut,
  reliefFromDepths,
  saveCardResult,
  toneCurveFromMarks,
  type CutMark,
} from '../../src/lib/calibration-results';
import { addCard, addMaterial, addThickness, cardOf, findCalibration, machineOf, parseProfileFile, profileFileText, seedProfiles } from '../../src/lib/profiles';
import { activeCalibration, loadProfiles, memoryProfileStorage, setProfileStorage, useProfilesStore } from '../../src/store/profilesStore';
import { decodePng } from '../helpers/png-decode';
import { applyDepthCurveInverse, depthAtGrey } from '../../src/lib/depth-curve';
import type { CardSpec } from '../../src/types/calibration-card';
import type { ProfileData } from '../../src/types/profiles';

const T0 = Date.UTC(2026, 10, 13, 12);

function workshop() {
  let d = seedProfiles();
  const machine = d.machines[0]; // 60 W CO2
  const m = addMaterial(d, { name: 'White Oak', finish: '', supplier: '', notes: '', categoryId: null });
  d = m.data;
  const t3 = addThickness(d, m.id, 3);
  d = t3.data;
  const t6 = addThickness(d, m.id, 6);
  d = t6.data;
  return { d, machine, materialId: m.id, t3: t3.id, t6: t6.id };
}

function request(kind: CardRequest['kind'], w = workshop(), thickness: 3 | 6 | null = null): CardRequest {
  const machine = w.machine;
  const th = thickness === null ? null : { id: thickness === 3 ? w.t3 : w.t6, mm: thickness };
  return {
    kind,
    machine,
    material: { id: w.materialId, name: 'White Oak' },
    thickness: th,
    ranges: cardDefaults(kind, machine, th?.mm ?? null),
    createdAt: T0,
    id: `card-${kind}`,
    shortId: 'K7Q2',
  };
}

/** Parses a project and returns its layers and shapes. */
function parseProject(xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  const root = doc.documentElement;
  expect(root.nodeName).toBe('LightBurnProject');
  expect(root.getAttribute('FormatVersion')).toBe('1');
  const val = (el: Element, name: string) => {
    const c = [...el.children].find((ch) => ch.nodeName === name);
    return c ? c.getAttribute('Value') : null;
  };
  const layers = [...root.children]
    .filter((el) => el.nodeName === 'CutSetting' || el.nodeName === 'CutSetting_Img')
    .map((el) => ({
      tag: el.nodeName,
      type: el.getAttribute('type'),
      index: Number(val(el, 'index')),
      name: val(el, 'name'),
      speed: Number(val(el, 'speed')),
      minPower: Number(val(el, 'minPower')),
      maxPower: Number(val(el, 'maxPower')),
      passes: Number(val(el, 'numPasses')),
      interval: val(el, 'interval') === null ? null : Number(val(el, 'interval')),
      ditherMode: val(el, 'ditherMode'),
    }));
  const shapes = [...root.children]
    .filter((el) => el.nodeName === 'Shape')
    .map((el) => {
      const xf = el.getElementsByTagName('XForm')[0].textContent!.trim().split(/\s+/).map(Number);
      return {
        type: el.getAttribute('Type'),
        cutIndex: Number(el.getAttribute('CutIndex')),
        w: Number(el.getAttribute('W')),
        h: Number(el.getAttribute('H')),
        data: el.getAttribute('Data'),
        xform: xf,
      };
    });
  return { layers, shapes };
}

const pngOf = (b64: string) => decodePng(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

describe('card lettering', () => {
  it('sets text at the height asked, 5 dots wide and 1 dot apart per character', () => {
    expect(textWidthMm('8', 7)).toBeCloseTo(5);
    expect(textWidthMm('88', 7)).toBeCloseTo(11);
    const rects = textRects('1', 7);
    const maxY = Math.max(...rects.map((r) => r.y + r.h));
    expect(maxY).toBeCloseTo(7);
  });
});

describe('card layout and size (physical units)', () => {
  it('photo card 1: cells are ramps of 6 steps, 4 mm each, with rows by speed and columns by power', () => {
    const spec = buildCard(request('engrave-grid'));
    expect(spec.rows * spec.cols).toBe(spec.cells.length);
    const layout = cardLayout(spec);
    for (const box of layout.cells) {
      expect(box.w).toBeCloseTo(6 * 4);
      expect(box.h).toBeCloseTo(8);
    }
    // Cells in a row share y; columns share x; neighbours are 3 mm apart.
    const c00 = layout.cells.find((b) => b.cell.row === 0 && b.cell.col === 0)!;
    const c01 = layout.cells.find((b) => b.cell.row === 0 && b.cell.col === 1)!;
    const c10 = layout.cells.find((b) => b.cell.row === 1 && b.cell.col === 0)!;
    expect(c01.x - c00.x).toBeCloseTo(24 + 3);
    expect(c10.y - c00.y).toBeCloseTo(8 + 3);
    expect(c01.y).toBe(c00.y);
    // Everything is inside the card, with the 5 mm margin.
    for (const b of layout.cells) {
      expect(b.x).toBeGreaterThanOrEqual(5);
      expect(b.x + b.w).toBeLessThanOrEqual(layout.widthMm - 5 + 1e-6);
      expect(b.y + b.h).toBeLessThanOrEqual(layout.heightMm - 5 + 1e-6);
    }
  });

  it('the rendered card is its size in mm at one pixel per scan line, and each step is its grey', () => {
    const spec = buildCard(request('engrave-grid'));
    const layout = cardLayout(spec);
    const r = renderCard(spec);
    expect(r.width).toBe(Math.round(layout.widthMm / spec.lineIntervalMm));
    expect(r.height).toBe(Math.round(layout.heightMm / spec.lineIntervalMm));
    const box = layout.cells[0];
    spec.levels.forEach((l, i) => {
      const x = Math.round((box.x + (i + 0.5) * spec.stepMm) * 10);
      const y = Math.round((box.y + box.h / 2) * 10);
      expect(r.rgba[(y * r.width + x) * 4]).toBe(greyOf(l));
    });
  });

  it('photo card 2 has 21 steps from bare (0 %) to full black, 4 mm each', () => {
    const w = workshop();
    const spec = buildCard({ ...request('engrave-tone', w) });
    expect(spec.levels).toEqual(TONE_RAMP_LEVELS);
    expect(spec.levels[0]).toBe(0);
    expect(spec.levels[20]).toBe(1);
    expect(cardLayout(spec).cells[0].w).toBeCloseTo(84);
  });

  it('cut card squares are the size asked and 4 mm apart', () => {
    const spec = buildCard(request('cut', workshop(), 3));
    const layout = cardLayout(spec);
    for (const b of layout.cells) {
      expect(b.w).toBe(10);
      expect(b.h).toBe(10);
    }
    expect(layout.cells[1].x - layout.cells[0].x).toBeCloseTo(14);
  });

  it('relief card: equal grey steps 10 mm wide, white to black, and a minimum-power row', () => {
    const spec = buildCard(request('relief'));
    expect(spec.levels).toHaveLength(11);
    expect(spec.levels[0]).toBe(0);
    expect(spec.levels[10]).toBe(1);
    const layout = cardLayout(spec);
    expect(layout.cells[0].w).toBeCloseTo(110);
    const finder = layout.cells.filter((b) => b.cell.role === 'min-power');
    expect(finder).toHaveLength(10);
    expect(finder.map((b) => b.cell.powerPct)).toEqual([...finder.map((b) => b.cell.powerPct)].sort((a, b) => a - b));
  });
});

describe('cells and their settings', () => {
  it('defaults scale with the machine: the 155 W tube starts at a lower percentage than the 60 W one', () => {
    const d = seedProfiles();
    const sixty = cardDefaults('engrave-grid', d.machines[0]);
    const big = cardDefaults('engrave-grid', d.machines[1]);
    expect(big.powerMax).toBeLessThan(sixty.powerMax);
    expect(big.powerMin).toBeGreaterThanOrEqual(8); // never below the firing floor
    expect(cardDefaults('cut', d.machines[0], 6).speedMax).toBeLessThan(cardDefaults('cut', d.machines[0], 3).speedMax);
  });

  it('the lettering against each row and column is the speed and power of that row and column', () => {
    for (const spec of [buildCard(request('engrave-grid')), buildCard(request('cut', workshop(), 3))]) {
      const layout = cardLayout(spec);
      for (const t of layout.texts.filter((t) => t.ref)) {
        const cells = spec.cells.filter((c) => (t.ref!.kind === 'speed-row' ? c.row === t.ref!.index : c.col === t.ref!.index));
        expect(cells.length).toBeGreaterThan(0);
        const shown = Number(t.text.replace('%', ''));
        for (const c of cells) expect(t.ref!.kind === 'speed-row' ? c.speedMmS : c.powerPct).toBe(shown);
      }
    }
  });

  it('the title says machine, material, thickness, date and card id', () => {
    const spec = buildCard(request('cut', workshop(), 3));
    const text = cardLayout(spec).texts.map((t) => t.text).join(' | ');
    expect(text).toContain('#K7Q2');
    expect(text).toContain('2026-11-13');
    expect(text).toContain('60 W CO2');
    expect(text).toContain('WHITE OAK 3 MM');
  });

  it('refuses more cells than layers, and every card fits in 30 layers', () => {
    const r = request('engrave-grid');
    expect(() => buildCard({ ...r, ranges: { ...r.ranges, speedSteps: 5, powerSteps: 6 } })).toThrow(/at most 29/);
    expect(buildCard({ ...r, ranges: { ...r.ranges, speedSteps: 4, powerSteps: 7 } }).cells).toHaveLength(28);
    for (const kind of ['engrave-grid', 'engrave-tone', 'cut', 'relief'] as const) {
      const spec = buildCard(request(kind, workshop(), kind === 'cut' ? 3 : null));
      expect(spec.cells.length).toBeLessThanOrEqual(MAX_CELLS);
      expect(labelLayer(spec) + 1).toBeLessThanOrEqual(MAX_LAYERS);
    }
  });

  it('refuses a cut card without a thickness', () => {
    expect(() => buildCard(request('cut'))).toThrow(/thickness/);
  });
});

describe('LightBurn project (.lbrn2)', () => {
  it('photo card 1: one dithered image layer per cell with its speed and power, each holding that cell’s ramp at its place and size', async () => {
    const spec = buildCard(request('engrave-grid'));
    const layout = cardLayout(spec);
    const { layers, shapes } = parseProject(await cardProject(spec));
    expect(layers.length).toBe(spec.cells.length + 1);
    expect(layers.length).toBeLessThanOrEqual(30);
    expect(new Set(layers.map((l) => l.index)).size).toBe(layers.length);
    for (const box of layout.cells) {
      const c = box.cell;
      const layer = layers.find((l) => l.index === c.layer)!;
      expect(layer.tag).toBe('CutSetting_Img');
      expect(layer.speed).toBe(c.speedMmS);
      expect(layer.maxPower).toBe(c.powerPct);
      expect(layer.passes).toBe(1);
      expect(layer.interval).toBe(spec.lineIntervalMm);
      expect(layer.ditherMode).toBe('dithered');
      const own = shapes.filter((s) => s.cutIndex === c.layer);
      expect(own).toHaveLength(1);
      const s = own[0];
      expect(s.type).toBe('Bitmap');
      expect(s.w).toBeCloseTo(box.w, 6);
      expect(s.h).toBeCloseTo(box.h, 6);
      // Centre in LightBurn's Y-up mm.
      expect(s.xform.slice(0, 4)).toEqual([1, 0, 0, 1]);
      expect(s.xform[4]).toBeCloseTo(box.x + box.w / 2, 6);
      expect(s.xform[5]).toBeCloseTo(layout.heightMm - (box.y + box.h / 2), 6);
      const png = pngOf(s.data!);
      expect(png.width).toBe(Math.round(box.w * 10));
      expect(png.phys!.x).toBe(10000); // 10 px/mm
      // The ramp's steps, light to dark.
      const row = Math.floor(png.height / 2) * png.width;
      expect(spec.levels.map((_, i) => png.samples[row + Math.floor((i + 0.5) * 40)])).toEqual(spec.levels.map(greyOf));
    }
    // The lettering is on the last layer.
    const labels = layers.find((l) => l.index === labelLayer(spec))!;
    expect(labels.name).toBe('Labels');
    expect(shapes.filter((s) => s.cutIndex === labelLayer(spec)).length).toBe(layout.texts.length);
  });

  it('cut card: one cut layer per square with its speed, power and passes, holding a 10 mm rectangle', async () => {
    const r = request('cut', workshop(), 6);
    const spec = buildCard({ ...r, ranges: { ...r.ranges, passes: 2 } });
    const layout = cardLayout(spec);
    const { layers, shapes } = parseProject(await cardProject(spec));
    for (const box of layout.cells) {
      const layer = layers.find((l) => l.index === box.cell.layer)!;
      expect(layer.tag).toBe('CutSetting');
      expect(layer.type).toBe('Cut');
      expect(layer.speed).toBe(box.cell.speedMmS);
      expect(layer.maxPower).toBe(box.cell.powerPct);
      expect(layer.passes).toBe(2);
      const rect = shapes.find((s) => s.cutIndex === box.cell.layer)!;
      expect(rect.type).toBe('Rect');
      expect([rect.w, rect.h]).toEqual([10, 10]);
      expect(rect.xform[4]).toBeCloseTo(box.x + 5, 6);
      expect(rect.xform[5]).toBeCloseTo(layout.heightMm - (box.y + 5), 6);
    }
  });

  it('relief card: the ramp runs in Grayscale between its minimum and maximum power; each minimum-power square has its own layer', async () => {
    const spec = buildCard(request('relief'));
    const { layers } = parseProject(await cardProject(spec));
    const ramp = layers.find((l) => l.index === 0)!;
    expect(ramp.ditherMode).toBe('grayscale');
    expect(ramp.minPower).toBe(spec.cells[0].powerMinPct);
    expect(ramp.maxPower).toBe(spec.cells[0].powerPct);
    expect(ramp.passes).toBe(spec.cells[0].passes);
    for (const c of spec.cells.filter((c) => c.role === 'min-power')) {
      const l = layers.find((x) => x.index === c.layer)!;
      expect([l.minPower, l.maxPower, l.ditherMode]).toEqual([c.powerPct, c.powerPct, 'threshold']);
    }
  });
});

describe('plain files', () => {
  it('cut card SVG is sized in mm, with one square per cell in its layer colour, carrying its setting', () => {
    const spec = buildCard(request('cut', workshop(), 3));
    const layout = cardLayout(spec);
    const doc = new DOMParser().parseFromString(cutCardSvg(spec), 'image/svg+xml');
    const svg = doc.documentElement;
    expect(svg.getAttribute('width')).toBe(`${layout.widthMm}mm`);
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${layout.widthMm} ${layout.heightMm}`);
    const rects = [...doc.getElementsByTagName('rect')];
    expect(rects).toHaveLength(spec.cells.length);
    for (const c of spec.cells) {
      const el = doc.getElementById(`cell-${c.layer}`)!;
      expect(Number(el.getAttribute('width'))).toBe(10);
      expect(el.getAttribute('stroke')).toBe(LIGHTBURN_LAYER_COLOURS[c.layer]);
      expect(Number(el.getAttribute('data-speed'))).toBe(c.speedMmS);
      expect(Number(el.getAttribute('data-power'))).toBe(c.powerPct);
    }
    // The table lists the same colour, speed and power per layer.
    const table = settingsTable(spec);
    for (const c of spec.cells) {
      const row = table.find((r) => r.layer === c.layer)!;
      expect([row.colour, row.speedMmS, row.powerText]).toEqual([LIGHTBURN_LAYER_COLOURS[c.layer], c.speedMmS, `${c.powerPct}%`]);
    }
  });

  it('photo and relief PNGs are their size in mm at the card resolution, which they state', async () => {
    const grid = buildCard(request('engrave-grid'));
    const one = await cardPng(grid);
    const p = decodePng(one.bytes);
    expect(p.width).toBe(240); // 6 steps x 4 mm at 10 px/mm
    expect(p.height).toBe(80);
    expect(p.phys!.x).toBe(10000);
    expect(one.dpi).toBeCloseTo(254);

    const tone = buildCard(request('engrave-tone'));
    const tp = decodePng((await cardPng(tone)).bytes);
    expect(tp.width).toBe(Math.round(cardLayout(tone).widthMm * 10));
  });
});

describe('results', () => {
  it('picking a cell on photo card 1 stores its speed, power and the card’s line interval', () => {
    const spec = buildCard(request('engrave-grid'));
    const pick = spec.cells[7];
    const e = engraveFromCell(spec, pick.layer);
    expect([e.speedMmS, e.powerMaxPct, e.lineIntervalMm, e.passes, e.status]).toEqual([pick.speedMmS, pick.powerPct, spec.lineIntervalMm, 1, 'verified']);
  });

  it('marked tone steps give a rising tone curve, 0 up to the last bare step and 1 from the first black one', () => {
    const curve = toneCurveFromMarks(TONE_RAMP_LEVELS, 2, 16);
    expect(curve).toHaveLength(21);
    expect(curve.slice(0, 3)).toEqual([0, 0, 0]);
    expect(curve.slice(16)).toEqual([1, 1, 1, 1, 1]);
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
    expect(curve[9]).toBeCloseTo((0.45 - 0.1) / (0.8 - 0.1), 3);
    expect(() => toneCurveFromMarks(TONE_RAMP_LEVELS, 10, 10)).toThrow();
  });

  it('clean-cut marks propose the fastest clean cut at the lowest power; charred only as a flagged fallback', () => {
    const spec = buildCard(request('cut', workshop(), 3));
    const at = (row: number, col: number) => spec.cells.find((c) => c.row === row && c.col === col)!;
    // Rows go up in speed. Clean in rows 0-2; in row 2, columns 3 and 4; row 3 col 4 charred.
    const marks: Record<number, CutMark> = {};
    for (let row = 0; row <= 1; row++) for (let col = 0; col < 5; col++) marks[at(row, col).layer] = 'clean';
    marks[at(2, 3).layer] = 'clean';
    marks[at(2, 4).layer] = 'clean';
    marks[at(3, 4).layer] = 'charred';
    expect(proposeCut(spec, marks)).toEqual({ layer: at(2, 3).layer, charred: false });
    expect(proposeCut(spec, { [at(3, 4).layer]: 'charred' })).toEqual({ layer: at(3, 4).layer, charred: true });
    expect(proposeCut(spec, {})).toBeNull();
    const e = cutFromCell(spec, at(2, 3).layer, 0.15, false);
    expect([e.speedMmS, e.powerMaxPct, e.passes, e.kerfMm, e.lineIntervalMm]).toEqual([at(2, 3).speedMmS, at(2, 3).powerPct, 1, 0.15, null]);
  });

  it('kerf is the drawn size less the measured piece', () => {
    expect(kerfFrom(10, 9.82)).toBeCloseTo(0.18, 6);
    expect(() => kerfFrom(10, 10.2)).toThrow(/larger/);
    expect(() => kerfFrom(10, 7)).toThrow(/plausible/);
  });

  it('depth entries give a never-falling depth curve and the maximum depth; the inverse gives even depths', () => {
    expect(monotonicDepths([0, 0.2, 0.5, 0.4, 0.9])).toEqual([0, 0.2, 0.45, 0.45, 0.9]);
    const measured = [0, 0.05, 0.15, 0.3, 0.5, 0.75, 1.0, 1.2, 1.35, 1.45, 1.5];
    const { depthCurve, maxDepthMm, adjusted } = depthCurveFrom(measured);
    expect(depthCurve).toEqual(measured);
    expect(maxDepthMm).toBe(1.5);
    expect(adjusted).toEqual([]);
    // #47: a linear ramp of heights, through the export's inverse (the only
    // one, depth-curve.ts) and then the measured response, burns evenly
    // spaced depths down to the card's maximum depth.
    const { entry } = reliefFromDepths(buildCard(request('relief')), measured);
    expect(entry.maxDepthMm).toBe(1.5);
    const heights = Uint16Array.from({ length: 11 }, (_, k) => Math.round(((10 - k) / 10) * 65535));
    const grey = applyDepthCurveInverse(heights, entry.depthCurve!, entry.maxDepthMm!);
    grey.forEach((g, k) => expect(depthAtGrey(entry.depthCurve!, 1 - g / 65535)).toBeCloseTo((k / 10) * entry.maxDepthMm!, 3));
    expect(() => depthCurveFrom([0, 0.1, null])).toThrow(/step 3/);
    expect(() => depthCurveFrom([0.3, 0.2, 0.1])).toThrow(/deeper/);
  });

  it('the minimum-power row gives the power of the first square that marked', () => {
    const spec = buildCard(request('relief'));
    const third = spec.cells.filter((c) => c.role === 'min-power')[2];
    expect(minPowerFrom(spec, third.layer)).toBe(third.powerPct);
  });
});

describe('storage under exactly the card’s machine, material and thickness', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('a cut result is found for its thickness only; card and results survive a reload and a profile file', async () => {
    const w = workshop();
    const spec = buildCard(request('cut', w, 3));
    let d: ProfileData = addCard(w.d, spec).data;
    const e = cutFromCell(spec, spec.cells[3].layer, 0.2, false);
    d = saveCardResult(d, spec, e).data;
    const at3 = findCalibration(d, { kind: 'cut', machineId: w.machine.id, materialId: w.materialId, thicknessId: w.t3 });
    expect(at3?.speedMmS).toBe(spec.cells[3].speedMmS);
    expect(at3?.kerfMm).toBe(0.2);
    expect(findCalibration(d, { kind: 'cut', machineId: w.machine.id, materialId: w.materialId, thicknessId: w.t6 })).toBeNull();
    expect(findCalibration(d, { kind: 'cut', machineId: d.machines[1].id, materialId: w.materialId, thicknessId: w.t3 })).toBeNull();
    expect(cardOf(d, spec.id)?.readAt).not.toBeNull();

    // Through a profile file: the card definition comes back whole.
    const back = parseProfileFile(profileFileText(d));
    expect(cardOf(back, spec.id)?.spec).toEqual(spec);

    // Through a reload of the store.
    const storage = memoryProfileStorage(d);
    setProfileStorage(storage);
    await loadProfiles();
    useProfilesStore.getState().selectMachine(w.machine.id);
    useProfilesStore.getState().selectMaterial(w.materialId);
    useProfilesStore.getState().selectThickness(w.t3);
    expect(activeCalibration('cut')?.speedMmS).toBe(spec.cells[3].speedMmS);
    useProfilesStore.getState().selectThickness(w.t6);
    expect(activeCalibration('cut')).toBeNull();
    expect(cardOf(useProfilesStore.getState().data, spec.id)?.spec.shortId).toBe('K7Q2');
  });

  it('photo cards save the engraving calibration, card 2 adds its tone curve; the relief card saves depths and the machine’s minimum power', () => {
    const w = workshop();
    const grid = buildCard(request('engrave-grid', w));
    let d = saveCardResult(w.d, grid, engraveFromCell(grid, grid.cells[12].layer)).data;
    const key = cardKey(grid);
    expect(findCalibration(d, key)?.toneCurve).toBeNull();
    const chosen = grid.cells[12];
    const toneReq = request('engrave-tone', w);
    const tone = buildCard({ ...toneReq, ranges: cardDefaults('engrave-tone', w.machine, null, { speedMmS: chosen.speedMmS, powerPct: chosen.powerPct }) });
    d = saveCardResult(d, tone, engraveWithTone(tone, 1, 18, d)).data;
    const cal = findCalibration(d, key)!;
    expect([cal.speedMmS, cal.powerMaxPct]).toEqual([chosen.speedMmS, chosen.powerPct]);
    expect(cal.toneCurve).toHaveLength(21);

    const relief = buildCard(request('relief', w));
    const depths = relief.levels.map((l) => Number((l * l * 2).toFixed(3)));
    const { entry } = reliefFromDepths(relief, depths);
    const finder = relief.cells.find((c) => c.role === 'min-power')!;
    d = saveCardResult(d, relief, entry, minPowerFrom(relief, finder.layer)).data;
    const rc = findCalibration(d, cardKey(relief))!;
    expect(rc.depthCurve).toEqual(depths);
    expect(rc.maxDepthMm).toBe(2);
    expect(machineOf(d, w.machine.id)?.minPowerPct).toBe(finder.powerPct);
    // Engraving is untouched by the relief result.
    expect(findCalibration(d, key)?.toneCurve).toHaveLength(21);
  });

  it('reads a profile file written before cards existed', () => {
    const w = workshop();
    const old = JSON.parse(profileFileText(w.d));
    delete old.profiles.cards;
    expect(parseProfileFile(JSON.stringify(old)).cards).toEqual([]);
  });

  it('keeps every card field through a file', () => {
    const w = workshop();
    const spec: CardSpec = buildCard(request('relief', w));
    const d = addCard(w.d, spec).data;
    expect(parseProfileFile(profileFileText(d)).cards[0].spec).toEqual(spec);
  });
});
