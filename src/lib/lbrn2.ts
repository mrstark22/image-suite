/**
 * Writes a calibration card as a LightBurn project (`.lbrn2`, #40): every
 * cell is its own shape on its own layer, with that cell's speed, power and
 * passes, so the user opens the file and presses Start.
 *
 * LightBurn does not publish the format. This follows the project files
 * saved by LightBurn 0.9.24, 1.4.01 and 1.7.08 in the test assets of two
 * MIT-licensed parsers (tscircuit/lbrnts, jlucaso1/lbrn2-to-svg), as
 * recorded in issue #40:
 *
 * - XML, root `LightBurnProject` with `AppVersion`, `FormatVersion="1"`,
 *   `MaterialHeight`, `MirrorX`, `MirrorY`.
 * - An image layer is `<CutSetting_Img type="Image">` and a vector layer
 *   `<CutSetting type="Cut">`; each setting is a child element with a
 *   `Value` attribute. Newer versions write only what differs from the
 *   defaults, so only the settings a card needs are written.
 * - `speed` is in mm/s (the 0.9.24 sample's 100 mm/min is written 1.66667);
 *   powers are percent.
 * - An image is `<Shape Type="Bitmap" CutIndex W H Data>` where `Data` is
 *   the base64 image file and `W`, `H` its size in mm at the resolution the
 *   file states; `<XForm>` is a 2 x 3 matrix `a b c d e f` placing the
 *   shape's centre at (e, f). The PNGs here state the card's resolution, so
 *   the matrix is a pure translation.
 * - A rectangle is `<Shape Type="Rect" W H Cr>`, centred on its XForm's
 *   translation like a bitmap.
 * - LightBurn's Y axis points up, so the card's top-down layout is flipped
 *   in position (not in content) to keep its title at the top.
 *
 * Not yet confirmed against a file from the owner's LightBurn: Pass-Through
 * (photo cells use the sample-confirmed "dithered" mode), the Grayscale mode
 * name, CO2-specific fields, and the Rect element. Each card can also be
 * downloaded as plain files with a table of settings (`card-files.ts`).
 */
import type { CardCell, CardSpec } from '../types/calibration-card';
import { cardLayout, labelLayer, pxPerMmOf, renderRamp, renderSolid, renderText, type Raster } from './calibration-cards';
import { encodePng8 } from './png-encoder';

/** The LightBurn version the written structure follows. */
export const LBRN_APP_VERSION = '1.4.01';

/** The image mode each image layer runs in, by LightBurn's `ditherMode` name. */
export type LbrnImageMode = 'dithered' | 'grayscale' | 'threshold';

const xmlAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '&#10;');
const num = (n: number) => String(Number(n.toFixed(6)));

function settings(entries: [string, string | number][]): string {
  return entries.map(([k, v]) => `        <${k} Value="${xmlAttr(typeof v === 'number' ? num(v) : v)}"/>`).join('\n');
}

/** How a cell's layer is named in LightBurn: what it is and its setting. */
export function layerName(cell: CardCell): string {
  const power = cell.powerMinPct !== cell.powerPct ? `${num(cell.powerMinPct)}-${num(cell.powerPct)}%` : `${num(cell.powerPct)}%`;
  return `${num(cell.speedMmS)}mms ${power}${cell.passes > 1 ? ` x${cell.passes}` : ''}`;
}

/** The image mode of a cell's layer. */
export function cellImageMode(spec: CardSpec, cell: CardCell): LbrnImageMode {
  if (cell.role === 'min-power') return 'threshold';
  return spec.kind === 'relief' ? 'grayscale' : 'dithered';
}

function imageLayer(index: number, name: string, c: { speedMmS: number; powerPct: number; powerMinPct: number; passes: number }, intervalMm: number, mode: LbrnImageMode): string {
  return [
    '    <CutSetting_Img type="Image">',
    settings([
      ['index', index],
      ['name', name],
      ['minPower', c.powerMinPct],
      ['maxPower', c.powerPct],
      ['speed', c.speedMmS],
      ['numPasses', c.passes],
      ['priority', index],
      ['interval', intervalMm],
      ['dpi', 25.4 / intervalMm],
      ['linkDPItoInterval', 1],
      ['bidir', 1],
      ['overscan', 1],
      ['overscanPercent', 2.5],
      ['ditherMode', mode],
    ]),
    '    </CutSetting_Img>',
  ].join('\n');
}

function cutLayer(index: number, name: string, c: CardCell): string {
  return [
    '    <CutSetting type="Cut">',
    settings([
      ['index', index],
      ['name', name],
      ['minPower', c.powerMinPct],
      ['maxPower', c.powerPct],
      ['speed', c.speedMmS],
      ['numPasses', c.passes],
      ['priority', index],
    ]),
    '    </CutSetting>',
  ].join('\n');
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A shape's place: its centre, in LightBurn's Y-up mm. */
function xform(cx: number, cy: number): string {
  return `<XForm>1 0 0 1 ${num(cx)} ${num(cy)}</XForm>`;
}

async function bitmap(index: number, r: Raster, ppm: number, cx: number, cy: number): Promise<string> {
  const png = await encodePng8(() => r.rgba, r.width, r.height, 'grey', { pxPerMm: ppm });
  return [
    `    <Shape Type="Bitmap" CutIndex="${index}" W="${num(r.width / ppm)}" H="${num(r.height / ppm)}" Gamma="1" Contrast="0" Brightness="0" EnhanceAmount="0" EnhanceRadius="0" EnhanceDenoise="0" File="" SourceHash="0" Data="${base64(png)}">`,
    `        ${xform(cx, cy)}`,
    '    </Shape>',
  ].join('\n');
}

/** What the project's notes say when it opens: which card, and how to run it. */
export function projectNotes(spec: CardSpec): string {
  return [
    `Image Suite calibration card #${spec.shortId}: ${spec.machineName}, ${spec.materialName}${spec.thicknessMm !== null ? ` ${spec.thicknessMm} mm` : ''}.`,
    `Each cell is on its own layer with its speed and power filled in; the last layer, "Labels", burns the lettering.`,
    'Check the layer settings, focus on the material, frame, and press Start.',
    'Then in Image Suite: Calibrate > I burned it: enter results.',
  ].join('\n');
}

/**
 * The card as LightBurn project text. One layer per cell, in cell order
 * (layer = `cell.layer`), then one image layer with the lettering.
 */
export async function cardProject(spec: CardSpec): Promise<string> {
  const layout = cardLayout(spec);
  const ppm = pxPerMmOf(spec);
  const H = layout.heightMm;
  const layers: string[] = [];
  const shapes: string[] = [];

  for (const box of layout.cells) {
    const { cell } = box;
    const name = layerName(cell);
    const cx = box.x + box.w / 2;
    const cy = H - (box.y + box.h / 2);
    if (cell.role === 'shape') {
      layers.push(cutLayer(cell.layer, name, cell));
      shapes.push(`    <Shape Type="Rect" CutIndex="${cell.layer}" W="${num(box.w)}" H="${num(box.h)}" Cr="0">\n        ${xform(cx, cy)}\n    </Shape>`);
    } else {
      layers.push(imageLayer(cell.layer, name, cell, spec.lineIntervalMm, cellImageMode(spec, cell)));
      const r = cell.role === 'ramp' ? renderRamp(spec.levels, spec.stepMm, box.h, ppm) : renderSolid(box.w, box.h, ppm);
      shapes.push(await bitmap(cell.layer, r, ppm, cx, cy));
    }
  }

  const labels = labelLayer(spec);
  layers.push(imageLayer(labels, 'Labels', { ...spec.label, powerMinPct: spec.label.powerPct, passes: 1 }, spec.lineIntervalMm, 'threshold'));
  for (const t of layout.texts) {
    const r = renderText(t.text, t.h, ppm);
    shapes.push(await bitmap(labels, r, ppm, t.x + r.width / ppm / 2, H - (t.y + r.height / ppm / 2)));
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<LightBurnProject AppVersion="${LBRN_APP_VERSION}" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">`,
    ...layers,
    ...shapes,
    `    <Notes ShowOnLoad="1" Notes="${xmlAttr(projectNotes(spec))}"/>`,
    '</LightBurnProject>',
    '',
  ].join('\n');
}
