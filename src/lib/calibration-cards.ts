/**
 * Calibration cards (#40, #85, #47; docs/plan.md "Machines and calibration"):
 * what goes on each card, where it sits in mm, and its pixels.
 *
 * A card is generated artwork, not image processing: its ramps are plain
 * grey steps, drawn here. The files made from a card are in `card-files.ts`
 * and `lbrn2.ts`; reading results off a card is in `calibration-results.ts`.
 *
 * Every cell is its own LightBurn layer, because LightBurn sets speed and
 * power per layer. LightBurn has 30 normal layers (0 to 29), and the card's
 * lettering takes the last one used, so a card has at most 29 cells.
 */
import type { CardCell, CardKind, CardSpec } from '../types/calibration-card';
import type { Machine } from '../types/profiles';
import { textRects, textWidthMm } from './card-font';
import { MM_PER_INCH } from './document-size';

/** LightBurn's normal layers: indices 0 to 29. */
export const MAX_LAYERS = 30;
/** Cells per card: every layer but the one the lettering is on. */
export const MAX_CELLS = MAX_LAYERS - 1;

/** Steps of a photo card 1 cell: light steps first, so "the lightest step visible" can be judged. */
export const GRID_RAMP_LEVELS = [0.1, 0.2, 0.4, 0.6, 0.8, 1];
/** Steps of photo card 2: 0 % to 100 % in 5 % steps, bare material included. */
export const TONE_RAMP_LEVELS = Array.from({ length: 21 }, (_, i) => i / 20);

export const CARD_TITLE: Record<CardKind, string> = {
  'engrave-grid': 'Photo card 1: power and speed',
  'engrave-tone': 'Photo card 2: tone response',
  cut: 'Cut card',
  relief: 'Relief depth card',
};

// Defaults from the machine

/** What the user chooses for a card; `cardDefaults` fills it from the machine. */
export interface CardRanges {
  speedMin: number;
  speedMax: number;
  /** Rows of a grid: one speed each. */
  speedSteps: number;
  powerMin: number;
  powerMax: number;
  /** Columns of a grid: one power each. */
  powerSteps: number;
  passes: number;
  lineIntervalMm: number;
  /** Relief: grey steps on the ramp. */
  levels: number;
  /** Relief: include the row of squares that finds the lowest power the tube marks at. */
  minPowerFinder: boolean;
  /** Cut: side of each square. */
  shapeMm: number;
}

/** The lowest power a machine fires at reliably: its own figure, or a cautious guess for its source. */
export function firingFloorPct(machine: Pick<Machine, 'minPowerPct' | 'source'>): number {
  return machine.minPowerPct ?? (machine.source === 'co2' ? 8 : 1);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Sensible starting ranges for a card on `machine`. Power is chosen as
 * watts delivered, so a 155 W tube starts at a lower percentage than a 60 W
 * one, and never below the power the tube fires at. Cut speeds scale with
 * watts and fall with thickness.
 */
export function cardDefaults(kind: CardKind, machine: Pick<Machine, 'watts' | 'minPowerPct' | 'source' | 'lineIntervalMm'>, thicknessMm: number | null = null, chosen?: { speedMmS: number; powerPct: number }): CardRanges {
  const floor = firingFloorPct(machine);
  const pctFor = (watts: number) => Math.round(clamp((watts / machine.watts) * 100, floor, 100));
  const interval = machine.lineIntervalMm ?? 0.1;
  const base: CardRanges = {
    speedMin: 150,
    speedMax: 450,
    speedSteps: 5,
    powerMin: pctFor(6),
    powerMax: Math.max(pctFor(30), pctFor(6) + 8),
    powerSteps: 5,
    passes: 1,
    lineIntervalMm: interval,
    levels: 11,
    minPowerFinder: true,
    shapeMm: 10,
  };
  if (kind === 'engrave-tone') {
    const speed = chosen?.speedMmS ?? 300;
    const power = chosen?.powerPct ?? pctFor(15);
    return { ...base, speedMin: speed, speedMax: speed, speedSteps: 1, powerMin: power, powerMax: power, powerSteps: 1 };
  }
  if (kind === 'cut') {
    const t = thicknessMm ?? 3;
    const centre = (0.75 * machine.watts) / t;
    const round = (v: number) => (v >= 10 ? Math.round(v) : Math.round(v * 2) / 2);
    const powerMax = machine.watts > 80 ? 80 : 90;
    return {
      ...base,
      speedMin: Math.max(0.5, round(centre * 0.5)),
      speedMax: Math.max(1, round(centre * 1.5)),
      speedSteps: 5,
      powerMin: Math.max(floor, powerMax - 40),
      powerMax,
      powerSteps: 5,
      passes: t > 6 ? 2 : 1,
    };
  }
  if (kind === 'relief') {
    return { ...base, speedMin: 200, speedMax: 200, speedSteps: 1, powerMin: floor, powerMax: Math.max(pctFor(40), floor + 10), powerSteps: 1, passes: 2 };
  }
  return base;
}

/** `n` values evenly from `min` to `max`, rounded to `step`. */
export function steps(min: number, max: number, n: number, step = 1): number[] {
  const count = Math.max(1, Math.round(n));
  const round = (v: number) => Number((Math.round(v / step) * step).toFixed(6));
  if (count === 1) return [round(min)];
  return Array.from({ length: count }, (_, i) => round(min + ((max - min) * i) / (count - 1)));
}

/** The powers the minimum-power row tries, from just below the tube's floor up. */
export function minPowerFinderPowers(machine: Pick<Machine, 'minPowerPct' | 'source'>): number[] {
  const floor = firingFloorPct(machine);
  const start = Math.max(1, floor - 4);
  return Array.from({ length: 10 }, (_, i) => start + i);
}

// Building a card

export interface CardRequest {
  kind: CardKind;
  machine: Pick<Machine, 'id' | 'name' | 'watts' | 'minPowerPct' | 'source'>;
  material: { id: string; name: string };
  thickness: { id: string; mm: number } | null;
  ranges: CardRanges;
  /** Fixed in tests; otherwise now. */
  createdAt?: number;
  id?: string;
  shortId?: string;
}

const ID_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Four characters that read unambiguously off a burned card (no 0/O, 1/I). */
export function newShortId(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => ID_CHARS[b % ID_CHARS.length]).join('');
}

/** The setting the card's lettering is burned at: light, fast, and above the firing floor. */
export function labelSetting(machine: Pick<Machine, 'watts' | 'minPowerPct' | 'source'>): { speedMmS: number; powerPct: number } {
  const floor = firingFloorPct(machine);
  return { speedMmS: 300, powerPct: Math.round(clamp((10 / machine.watts) * 100, floor + 2, 60)) };
}

/**
 * Builds a card. Throws an Error that says what to change when the request
 * cannot make a card: too many cells, a value out of range, repeated values.
 */
export function buildCard(req: CardRequest): CardSpec {
  const { kind, machine, material, thickness, ranges: r } = req;
  if (kind === 'cut' && !thickness) throw new Error('A cut card is for one thickness: choose or add a thickness first.');
  const check = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(msg);
  };
  check(r.speedMin > 0 && r.speedMax > 0 && r.speedMax >= r.speedMin, 'Speeds must be more than 0, the fastest at least the slowest.');
  check(r.powerMin > 0 && r.powerMax <= 100 && r.powerMax >= r.powerMin, 'Power must be between 1 and 100 %, the highest at least the lowest.');
  check(Number.isInteger(r.passes) && r.passes >= 1 && r.passes <= 20, 'Passes must be a whole number from 1 to 20.');
  check(r.lineIntervalMm >= 0.02 && r.lineIntervalMm <= 1, 'The line interval must be between 0.02 and 1 mm.');

  const cells: CardCell[] = [];
  let rows = 1;
  let cols = 1;
  let levels: number[] = [];
  let stepMm = 4;
  let rampHeightMm = 8;

  if (kind === 'engrave-grid' || kind === 'cut') {
    const speeds = steps(r.speedMin, r.speedMax, r.speedSteps, kind === 'cut' && r.speedMax < 10 ? 0.5 : 1);
    const powers = steps(r.powerMin, r.powerMax, r.powerSteps);
    rows = speeds.length;
    cols = powers.length;
    check(rows * cols <= MAX_CELLS, `${rows} × ${cols} is ${rows * cols} cells; a card has at most ${MAX_CELLS}, one LightBurn layer each, with the last layer for its lettering. Use fewer speeds or powers.`);
    check(new Set(speeds).size === rows, 'Two rows would have the same speed: use fewer speeds or a wider range.');
    check(new Set(powers).size === cols, 'Two columns would have the same power: use fewer powers or a wider range.');
    speeds.forEach((speed, row) =>
      powers.forEach((power, col) =>
        cells.push({ layer: cells.length, row, col, speedMmS: speed, powerPct: power, powerMinPct: power, passes: kind === 'cut' ? r.passes : 1, role: kind === 'cut' ? 'shape' : 'ramp' }),
      ),
    );
    if (kind === 'engrave-grid') levels = [...GRID_RAMP_LEVELS];
    else {
      check(r.shapeMm >= 5 && r.shapeMm <= 30, 'Squares must be 5 to 30 mm.');
      stepMm = r.shapeMm;
      rampHeightMm = r.shapeMm;
    }
  } else if (kind === 'engrave-tone') {
    levels = [...TONE_RAMP_LEVELS];
    rampHeightMm = 10;
    cells.push({ layer: 0, row: 0, col: 0, speedMmS: r.speedMin, powerPct: r.powerMax, powerMinPct: r.powerMax, passes: 1, role: 'ramp' });
  } else {
    check(Number.isInteger(r.levels) && r.levels >= 5 && r.levels <= 21, 'A depth ramp has 5 to 21 steps.');
    levels = Array.from({ length: r.levels }, (_, i) => i / (r.levels - 1));
    stepMm = 10;
    rampHeightMm = 15;
    cells.push({ layer: 0, row: 0, col: 0, speedMmS: r.speedMin, powerPct: r.powerMax, powerMinPct: r.powerMin, passes: r.passes, role: 'ramp' });
    if (r.minPowerFinder) {
      minPowerFinderPowers(machine).forEach((p, i) =>
        cells.push({ layer: cells.length, row: 1, col: i, speedMmS: r.speedMin, powerPct: p, powerMinPct: p, passes: 1, role: 'min-power' }),
      );
      rows = 2;
    }
    cols = Math.max(levels.length, cells.length - 1);
  }

  return {
    id: req.id ?? `card-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`,
    shortId: req.shortId ?? newShortId(),
    kind,
    machineId: machine.id,
    materialId: material.id,
    thicknessId: kind === 'cut' ? thickness!.id : null,
    machineName: machine.name,
    materialName: material.name,
    thicknessMm: kind === 'cut' ? thickness!.mm : null,
    createdAt: req.createdAt ?? Date.now(),
    rows,
    cols,
    cells,
    levels,
    stepMm,
    rampHeightMm,
    lineIntervalMm: r.lineIntervalMm,
    label: labelSetting(machine),
  };
}

/** The layer the card's lettering is on: the one after the last cell. */
export function labelLayer(spec: CardSpec): number {
  return spec.cells.length;
}

// Layout in mm

/** A cell's place on the card, in mm from the card's top left. */
export interface CellBox {
  cell: CardCell;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A line of lettering: `h` is the capital height, (x, y) its top left. */
export interface CardText {
  text: string;
  x: number;
  y: number;
  h: number;
  /** What the text says, so tests can find the label of a cell. */
  ref?: { kind: 'speed-row' | 'power-col' | 'level' | 'min-power'; index: number };
}

export interface CardLayout {
  widthMm: number;
  heightMm: number;
  cells: CellBox[];
  texts: CardText[];
}

const MARGIN = 5;
const TITLE_H = 2.4;
const LINE = 3.8;
const HEAD_H = 2;
const SMALL_H = 1.4;

/** "2026-11-13", the card's date as burned on it. */
export function cardDate(spec: CardSpec): string {
  const d = new Date(spec.createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "WHITE OAK 3 MM": the material as burned on the card. */
export function cardMaterialText(spec: CardSpec): string {
  const name = spec.materialName.length > 32 ? `${spec.materialName.slice(0, 31)}.` : spec.materialName;
  return spec.thicknessMm !== null ? `${name} ${Number(spec.thicknessMm.toFixed(2))} MM` : name;
}

const fmt = (n: number) => String(Number(n.toFixed(2)));

/** The three lines at the top of a card: what it is, its id and date; machine and material; how to read it. */
export function cardTitleLines(spec: CardSpec): string[] {
  const kindText = { 'engrave-grid': 'PHOTO CARD 1', 'engrave-tone': 'PHOTO CARD 2', cut: 'CUT CARD', relief: 'DEPTH CARD' }[spec.kind];
  const first = `${kindText} #${spec.shortId} ${cardDate(spec)}`;
  const second = `${spec.machineName} · ${cardMaterialText(spec)}`.toUpperCase();
  const c = spec.cells[0];
  let third: string;
  if (spec.kind === 'engrave-grid') third = `ROWS MM/S · COLUMNS POWER % · ${fmt(spec.lineIntervalMm)} MM`;
  else if (spec.kind === 'cut') third = `ROWS MM/S · COLUMNS POWER % · ${c.passes} PASS${c.passes === 1 ? '' : 'ES'}`;
  else if (spec.kind === 'engrave-tone') third = `${fmt(c.speedMmS)} MM/S · ${fmt(c.powerPct)}% · ${fmt(spec.lineIntervalMm)} MM · STEP % BLACK`;
  else third = `${fmt(c.speedMmS)} MM/S · ${fmt(c.powerMinPct)}-${fmt(c.powerPct)}% · ${c.passes}X · STEP % BLACK`;
  return [first, second, third];
}

/** Where everything on a card goes, in mm. */
export function cardLayout(spec: CardSpec): CardLayout {
  const texts: CardText[] = [];
  const cells: CellBox[] = [];
  const titles = cardTitleLines(spec);
  titles.forEach((text, i) => texts.push({ text, x: MARGIN, y: MARGIN + i * LINE, h: TITLE_H }));
  let y = MARGIN + titles.length * LINE + 1.5;
  let right = Math.max(...titles.map((t) => MARGIN + textWidthMm(t, TITLE_H)));

  if (spec.kind === 'engrave-grid' || spec.kind === 'cut') {
    const cellW = spec.kind === 'cut' ? spec.stepMm : spec.levels.length * spec.stepMm;
    const cellH = spec.kind === 'cut' ? spec.stepMm : spec.rampHeightMm;
    const gap = spec.kind === 'cut' ? 4 : 3;
    const speeds = spec.cells.filter((c) => c.col === 0).map((c) => c.speedMmS);
    const powers = spec.cells.filter((c) => c.row === 0).map((c) => c.powerPct);
    const headW = Math.max(...speeds.map((s) => textWidthMm(fmt(s), HEAD_H))) + 2.5;
    const x0 = MARGIN + headW;
    powers.forEach((p, col) => {
      const t = `${fmt(p)}%`;
      texts.push({ text: t, x: x0 + col * (cellW + gap) + (cellW - textWidthMm(t, HEAD_H)) / 2, y, h: HEAD_H, ref: { kind: 'power-col', index: col } });
    });
    y += HEAD_H + 1.8;
    speeds.forEach((s, row) => {
      const t = fmt(s);
      const cy = y + row * (cellH + gap);
      texts.push({ text: t, x: x0 - 2.5 - textWidthMm(t, HEAD_H), y: cy + (cellH - HEAD_H) / 2, h: HEAD_H, ref: { kind: 'speed-row', index: row } });
    });
    for (const cell of spec.cells) cells.push({ cell, x: x0 + cell.col * (cellW + gap), y: y + cell.row * (cellH + gap), w: cellW, h: cellH });
    right = Math.max(right, x0 + spec.cols * cellW + (spec.cols - 1) * gap);
    y += spec.rows * cellH + (spec.rows - 1) * gap;
  } else {
    const ramp = spec.cells[0];
    const w = spec.levels.length * spec.stepMm;
    cells.push({ cell: ramp, x: MARGIN, y, w, h: spec.rampHeightMm });
    y += spec.rampHeightMm + 1.2;
    const lh = spec.kind === 'relief' ? HEAD_H : SMALL_H;
    spec.levels.forEach((l, i) => {
      const t = fmt(Math.round(l * 100));
      texts.push({ text: t, x: MARGIN + i * spec.stepMm + (spec.stepMm - textWidthMm(t, lh)) / 2, y, h: lh, ref: { kind: 'level', index: i } });
    });
    y += lh;
    right = Math.max(right, MARGIN + w);
    const finder = spec.cells.filter((c) => c.role === 'min-power');
    if (finder.length > 0) {
      y += 3;
      texts.push({ text: 'LOWEST POWER THAT MARKS %', x: MARGIN, y, h: HEAD_H });
      y += HEAD_H + 1.5;
      const side = 6;
      const gap = 2.5;
      finder.forEach((cell, i) => {
        cells.push({ cell, x: MARGIN + i * (side + gap), y, w: side, h: side });
        const t = fmt(cell.powerPct);
        texts.push({ text: t, x: MARGIN + i * (side + gap) + (side - textWidthMm(t, HEAD_H)) / 2, y: y + side + 1.2, h: HEAD_H, ref: { kind: 'min-power', index: i } });
      });
      right = Math.max(right, MARGIN + finder.length * (side + gap) - gap);
      y += side + 1.2 + HEAD_H;
    }
  }
  const round = (v: number) => Math.ceil(v * 10) / 10;
  return { widthMm: round(right + MARGIN), heightMm: round(y + MARGIN), cells, texts };
}

// Pixels

/** Pixels per mm at a line interval: one pixel per scan line. */
export function pxPerMmOf(spec: CardSpec): number {
  return 1 / spec.lineIntervalMm;
}

export function dpiOf(spec: CardSpec): number {
  return MM_PER_INCH / spec.lineIntervalMm;
}

/** A darkness (0 white to 1 black) as a grey byte. */
export const greyOf = (darkness: number) => Math.round(255 * (1 - darkness));

export interface Raster {
  /** RGBA, grey (r = g = b), opaque. */
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

function blank(width: number, height: number): Raster {
  const rgba = new Uint8ClampedArray(width * height * 4);
  rgba.fill(255);
  return { rgba, width, height };
}

/** Fills the pixels covering the mm rectangle with `grey`. */
function fillRect(r: Raster, ppm: number, x: number, y: number, w: number, h: number, grey: number): void {
  const x0 = Math.max(0, Math.round(x * ppm));
  const x1 = Math.min(r.width, Math.round((x + w) * ppm));
  const y0 = Math.max(0, Math.round(y * ppm));
  const y1 = Math.min(r.height, Math.round((y + h) * ppm));
  for (let py = y0; py < y1; py++) {
    let i = (py * r.width + x0) * 4;
    for (let px = x0; px < x1; px++, i += 4) {
      r.rgba[i] = grey;
      r.rgba[i + 1] = grey;
      r.rgba[i + 2] = grey;
    }
  }
}

function drawText(r: Raster, ppm: number, t: { text: string; x: number; y: number; h: number }): void {
  for (const d of textRects(t.text, t.h)) fillRect(r, ppm, t.x + d.x, t.y + d.y, d.w, d.h, 0);
}

/** A ramp as its own image: one grey step per level, `stepMm` wide each. */
export function renderRamp(levels: readonly number[], stepMm: number, heightMm: number, ppm: number): Raster {
  const r = blank(Math.round(levels.length * stepMm * ppm), Math.round(heightMm * ppm));
  levels.forEach((l, i) => fillRect(r, ppm, i * stepMm, 0, stepMm, heightMm, greyOf(l)));
  return r;
}

/** A solid black square, for a minimum-power cell. */
export function renderSolid(wMm: number, hMm: number, ppm: number): Raster {
  const r = blank(Math.round(wMm * ppm), Math.round(hMm * ppm));
  r.rgba.fill(0);
  for (let i = 3; i < r.rgba.length; i += 4) r.rgba[i] = 255;
  return r;
}

/** One line of lettering as its own image, exactly as tall as its capitals. */
export function renderText(text: string, heightMm: number, ppm: number): Raster {
  const r = blank(Math.max(1, Math.round(textWidthMm(text, heightMm) * ppm)), Math.max(1, Math.round(heightMm * ppm)));
  drawText(r, ppm, { text, x: 0, y: 0, h: heightMm });
  return r;
}

/**
 * The whole card as one picture at `ppm` pixels per mm: ramps in grey,
 * lettering in black, and a cut card's squares as thin outlines (on screen
 * only; a cut card is cut from its SVG or LightBurn project).
 */
export function renderCard(spec: CardSpec, ppm: number = pxPerMmOf(spec), options: { screen?: boolean } = {}): Raster {
  const layout = cardLayout(spec);
  const r = blank(Math.round(layout.widthMm * ppm), Math.round(layout.heightMm * ppm));
  for (const box of layout.cells) {
    if (box.cell.role === 'ramp') {
      // On screen only, a light frame shows where the bare (white) steps are.
      if (options.screen) fillRect(r, ppm, box.x - 1 / ppm, box.y - 1 / ppm, box.w + 2 / ppm, box.h + 2 / ppm, 200);
      spec.levels.forEach((l, i) => fillRect(r, ppm, box.x + i * spec.stepMm, box.y, spec.stepMm, box.h, greyOf(l)));
      continue;
    }
    if (box.cell.role === 'min-power') fillRect(r, ppm, box.x, box.y, box.w, box.h, 0);
    else {
      const line = Math.max(0.2, 1 / ppm);
      fillRect(r, ppm, box.x, box.y, box.w, line, 0);
      fillRect(r, ppm, box.x, box.y + box.h - line, box.w, line, 0);
      fillRect(r, ppm, box.x, box.y, line, box.h, 0);
      fillRect(r, ppm, box.x + box.w - line, box.y, line, box.h, 0);
    }
  }
  for (const t of layout.texts) drawText(r, ppm, t);
  return r;
}
