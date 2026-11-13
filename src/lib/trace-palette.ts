import type { PaletteEntry, VectorResult } from '../types/vector';

/** The red, green and blue of `color`, which must be `#rrggbb`. Anything else is an error, never a stand-in colour. */
export function rgbOfHex(color: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) throw new Error(`"${color}" is not a colour in the form #rrggbb.`);
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

/** Throws unless every colour of `palette` is `#rrggbb`. */
export function checkPalette(palette: PaletteEntry[]): void {
  for (const e of palette) {
    rgbOfHex(e.color);
    if (e.drawAs !== undefined) rgbOfHex(e.drawAs);
  }
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
