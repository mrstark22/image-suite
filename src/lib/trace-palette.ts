import type { PaletteEntry, VectorResult } from '../types/vector';

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
 * `palette` with entry `i` changed: a new colour, or a new choice. Colours
 * merged into an entry that is then removed or merged elsewhere follow it, so
 * a merge never points at a colour without a layer of its own.
 */
export function editPalette(palette: PaletteEntry[], i: number, change: { color: string } | PaletteChoice): PaletteEntry[] {
  const next = palette.map((e) => ({ ...e }));
  if (typeof change === 'object') {
    next[i].color = change.color;
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
