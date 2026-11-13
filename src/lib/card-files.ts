/**
 * The plain-file fallback for calibration cards (docs/plan.md, "Getting
 * cards into LightBurn"): if the LightBurn project does not open as it
 * should, every card can also be had as an ordinary file with a table of the
 * speed and power for each cell, entered by hand.
 *
 * - Cut cards: an SVG in mm. Each square is drawn in the colour of its
 *   LightBurn layer, so importing it puts every square on its own layer.
 * - Photo and relief cards: one PNG tone-ramp image at the card's
 *   resolution, with that resolution written into the file.
 */
import type { CardCell, CardSpec } from '../types/calibration-card';
import { cardLayout, dpiOf, labelLayer, pxPerMmOf, renderCard, renderRamp, type CardDither } from './calibration-cards';
import { textRects } from './card-font';
import { cellImageMode, layerName } from './lbrn2';
import { encodePng1, encodePng8 } from './png-encoder';

/** LightBurn's layer colours 00 to 29, which an imported SVG's colours select. */
export const LIGHTBURN_LAYER_COLOURS = [
  '#000000', '#0000FF', '#FF0000', '#00E000', '#D0D000', '#FF8000', '#00E0E0', '#FF00FF', '#B4B4B4', '#0000A0',
  '#A00000', '#00A000', '#A0A000', '#C08000', '#00A0FF', '#A000A0', '#808080', '#7D87B9', '#BB7784', '#4A6FE3',
  '#D33F6A', '#8CD78C', '#F0B98D', '#F6C4E1', '#FA9ED4', '#500A78', '#B45A00', '#004754', '#86FA88', '#FFDB66',
];

/** One row of the settings table shown next to the plain files. */
export interface SettingsRow {
  layer: number;
  colour: string;
  what: string;
  speedMmS: number;
  powerText: string;
  passes: number;
  mode: string;
}

const MODE_TEXT: Record<string, string> = { passthrough: 'Image, Pass-Through', grayscale: 'Image, Grayscale', threshold: 'Image, Threshold', cut: 'Line (cut)' };

function cellWhat(spec: CardSpec, c: CardCell): string {
  if (c.role === 'min-power') return `Minimum-power square ${c.col + 1}`;
  if (spec.kind === 'engrave-grid' || spec.kind === 'cut') return `Row ${c.row + 1}, column ${c.col + 1}`;
  return spec.kind === 'relief' ? 'Depth ramp' : 'Tone ramp';
}

/** Every layer of a card with what to enter in LightBurn for it, the lettering last. */
export function settingsTable(spec: CardSpec): SettingsRow[] {
  const rows: SettingsRow[] = spec.cells.map((c) => ({
    layer: c.layer,
    colour: LIGHTBURN_LAYER_COLOURS[c.layer],
    what: cellWhat(spec, c),
    speedMmS: c.speedMmS,
    powerText: layerName(c).split(' ')[1],
    passes: c.passes,
    mode: MODE_TEXT[c.role === 'shape' ? 'cut' : cellImageMode(spec, c)],
  }));
  const l = labelLayer(spec);
  rows.push({ layer: l, colour: LIGHTBURN_LAYER_COLOURS[l], what: 'Lettering', speedMmS: spec.label.speedMmS, powerText: `${spec.label.powerPct}%`, passes: 1, mode: spec.kind === 'cut' ? 'Fill' : MODE_TEXT.threshold });
  return rows;
}

const n = (v: number) => String(Number(v.toFixed(4)));

/**
 * A cut card as SVG, sized in mm. Squares are outlines in their layer's
 * colour; the lettering is filled squares in the lettering layer's colour.
 */
export function cutCardSvg(spec: CardSpec): string {
  if (spec.kind !== 'cut') throw new Error('Only a cut card is drawn as SVG.');
  const layout = cardLayout(spec);
  const labelColour = LIGHTBURN_LAYER_COLOURS[labelLayer(spec)];
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(layout.widthMm)}mm" height="${n(layout.heightMm)}mm" viewBox="0 0 ${n(layout.widthMm)} ${n(layout.heightMm)}">`,
    `  <title>Image Suite cut card #${spec.shortId}</title>`,
  ];
  for (const box of layout.cells) {
    const colour = LIGHTBURN_LAYER_COLOURS[box.cell.layer];
    parts.push(
      `  <rect id="cell-${box.cell.layer}" data-speed="${n(box.cell.speedMmS)}" data-power="${n(box.cell.powerPct)}" data-passes="${box.cell.passes}" x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" fill="none" stroke="${colour}" stroke-width="0.1"/>`,
    );
  }
  const d: string[] = [];
  for (const t of layout.texts) for (const r of textRects(t.text, t.h)) d.push(`M${n(t.x + r.x)} ${n(t.y + r.y)}h${n(r.w)}v${n(r.h)}h${n(-r.w)}z`);
  parts.push(`  <path id="lettering" fill="${labelColour}" d="${d.join('')}"/>`);
  parts.push('</svg>', '');
  return parts.join('\n');
}

/**
 * The PNG of a photo or relief card. Card 1 has a different setting in every
 * cell, which one image cannot carry, so its PNG is a single cell's ramp to
 * place once per row of the table. Card 2 and the depth card are one
 * setting: their PNG is the ramp with its lettering (and card 2's markers,
 * code and reference outlines). A photo card's PNG is dithered with
 * `dither` and written 1-bit, for Pass-Through; the depth card's is grey,
 * for Grayscale mode.
 */
export async function cardPng(spec: CardSpec, dither: CardDither): Promise<{ bytes: Uint8Array; width: number; height: number; dpi: number }> {
  if (spec.kind === 'cut') throw new Error('A cut card is downloaded as SVG.');
  const ppm = pxPerMmOf(spec);
  const grey =
    spec.kind === 'engrave-grid'
      ? renderRamp(spec.levels, spec.stepMm, spec.rampHeightMm, ppm)
      : renderCard({ ...spec, cells: spec.cells.filter((c) => c.role === 'ramp') }, ppm);
  if (spec.kind === 'relief') {
    const bytes = await encodePng8(() => grey.rgba, grey.width, grey.height, 'grey', { pxPerMm: ppm });
    return { bytes, width: grey.width, height: grey.height, dpi: dpiOf(spec) };
  }
  const r = await dither(grey);
  const bytes = await encodePng1(() => r.rgba, r.width, r.height, { pxPerMm: ppm });
  return { bytes, width: r.width, height: r.height, dpi: dpiOf(spec) };
}

/** "card-K7Q2-white-oak-60-w-co2", without an extension. */
export function cardFileStem(spec: CardSpec): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const thick = spec.thicknessMm !== null ? `-${n(spec.thicknessMm)}mm` : '';
  return `card-${spec.shortId}-${slug(spec.materialName)}${thick}-${slug(spec.machineName)}`;
}
