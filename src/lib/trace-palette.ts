import type { PaletteEntry, VectorResult } from '../types/vector';

/** The red, green and blue of `color`, which must be `#rrggbb`. Anything else is an error, never a stand-in colour. */
export function rgbOfHex(color: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) throw new Error(`"${color}" is not a colour in the form #rrggbb.`);
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

/** The most colours a palette can have: the tracer's own limit on the number of colours. */
export const MAX_PALETTE = 32;

/**
 * Throws unless `palette` is one the tracer can use: at most `MAX_PALETTE`
 * entries (the tracer holds a colour's index in a byte, and 255 means "left
 * out", #88), every colour `#rrggbb`, and every merge pointing at an entry.
 */
export function checkPalette(palette: PaletteEntry[]): void {
  if (!Array.isArray(palette)) throw new Error('The palette is not a list of colours.');
  if (palette.length > MAX_PALETTE) {
    throw new Error(`The palette has ${palette.length} colours; the most the tracer takes is ${MAX_PALETTE}.`);
  }
  for (const e of palette) {
    rgbOfHex(e.color);
    if (e.drawAs !== undefined) rgbOfHex(e.drawAs);
    const m = e.mergeInto;
    if (m !== null && !(Number.isInteger(m) && m >= 0 && m < palette.length)) {
      throw new Error(`A palette colour is merged into colour ${String(m)}, which the palette does not have.`);
    }
  }
}

/**
 * `result` with each colour layer drawn in its palette entry's `drawAs`
 * colour, or in the colour it traces when the entry has none. The tracer
 * only sees the colour to match, so this is where a layer gets its drawn
 * colour, for a new trace and for one already on screen (#91).
 */
export function withDrawnColours(result: VectorResult, palette: PaletteEntry[] | null): VectorResult {
  let changed = false;
  const layers = result.layers.map((layer) => {
    if (layer.paletteIndex === null) return layer;
    const traced = layer.sourceColor ?? layer.color;
    const drawAs = palette?.[layer.paletteIndex]?.drawAs;
    const color = drawAs ?? traced;
    const sourceColor = drawAs === undefined ? undefined : traced;
    if (color === layer.color && sourceColor === layer.sourceColor) return layer;
    changed = true;
    const { sourceColor: _dropped, ...rest } = layer;
    return sourceColor === undefined ? { ...rest, color } : { ...rest, color, sourceColor };
  });
  return changed ? { ...result, layers } : result;
}

/** What happens to one palette colour: its own layer, left out, or merged into another colour's layer. */
export type PaletteChoice = 'keep' | 'remove' | `merge:${number}`;

/** The colours a colour trace found, as an editable palette in which every colour keeps its layer. */
export function paletteFromResult(result: VectorResult): PaletteEntry[] | null {
  if (result.palette.length === 0) return null;
  return result.palette.map((color) => ({ color, removed: false, mergeInto: null }));
}

export function paletteChoice(entry: PaletteEntry): PaletteChoice {
  if (entry.removed) return 'remove';
  return entry.mergeInto === null ? 'keep' : `merge:${entry.mergeInto}`;
}

/** The choices for entry `i`: keep, leave out, or merge into any other colour that keeps its own layer. */
export function paletteChoiceOptions(palette: PaletteEntry[], i: number): Array<{ value: PaletteChoice; label: string }> {
  const options: Array<{ value: PaletteChoice; label: string }> = [
    { value: 'keep', label: 'Own layer' },
    { value: 'remove', label: 'Leave out' },
  ];
  palette.forEach((e, j) => {
    if (j !== i && !e.removed && e.mergeInto === null) {
      options.push({ value: `merge:${j}`, label: `Merge into colour ${j + 1}` });
    }
  });
  return options;
}

/**
 * `palette` with entry `i` changed: the colour its layer is drawn in, or a
 * new choice. The colour matched in the image stays as it is, so recolouring
 * a layer does not move pixels between layers (review of #84). Colours
 * merged into an entry that is then removed or merged elsewhere follow it, so
 * a merge never points at a colour without a layer of its own.
 */
export function editPalette(palette: PaletteEntry[], i: number, change: { drawAs: string } | PaletteChoice): PaletteEntry[] {
  const next = palette.map((e) => ({ ...e }));
  if (typeof change === 'object') {
    if (change.drawAs.toLowerCase() === next[i].color.toLowerCase()) delete next[i].drawAs;
    else next[i].drawAs = change.drawAs;
    return next;
  }
  const target = change.startsWith('merge:') ? Number(change.slice(6)) : null;
  next[i].removed = change === 'remove';
  next[i].mergeInto = target;
  for (const e of next) {
    if (e.mergeInto === i && (next[i].removed || next[i].mergeInto !== null)) {
      e.removed = next[i].removed;
      e.mergeInto = next[i].removed ? null : next[i].mergeInto;
    }
  }
  return next;
}
