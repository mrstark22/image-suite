import type { VectorLayer, VectorResult } from '../types/vector';
import { rgbOfHex } from './trace-palette';

/**
 * What identifies a layer across traces: for a colour layer the image colour
 * it traces (not the colour it is drawn in), otherwise its id (`ink`,
 * `cutline`). Colour layers are numbered by position, and a
 * re-clustering can renumber them, so the colour is what the user chose to
 * hide (review of #84).
 */
export function layerKey(layer: Pick<VectorLayer, 'id' | 'color' | 'sourceColor' | 'paletteIndex'>): string {
  return layer.paletteIndex === null ? layer.id : `colour ${(layer.sourceColor ?? layer.color).toLowerCase()}`;
}

const COLOUR_KEY = /^colour (#[0-9a-f]{6})$/;

/**
 * How far apart, in red, green and blue together, two colours can be and
 * still be the same layer of two traces. An automatic palette is found again
 * by every trace, and an adjustment moves each colour a little.
 */
const SAME_LAYER_DISTANCE = 40;

/**
 * `hidden` (layer keys) for a new trace's `layers`: a hidden colour that the
 * new trace does not have exactly is carried to the nearest colour it does
 * have, when that is close enough to be the same layer found again. Without
 * this a hidden layer came back whenever a re-trace moved its colour by one
 * level (#87). Other keys are kept as they are.
 */
export function carryHidden(hidden: string[], layers: Array<Pick<VectorLayer, 'id' | 'color' | 'sourceColor' | 'paletteIndex'>>): string[] {
  const keys = new Set(layers.map(layerKey));
  const taken = new Set(hidden.filter((k) => keys.has(k)));
  return hidden.map((key) => {
    const hex = COLOUR_KEY.exec(key)?.[1];
    if (!hex || keys.has(key)) return key;
    const from = rgbOfHex(hex);
    let best: string | null = null;
    let bestD = SAME_LAYER_DISTANCE;
    for (const k of keys) {
      const to = COLOUR_KEY.exec(k)?.[1];
      if (!to || taken.has(k)) continue;
      const d = Math.hypot(...rgbOfHex(to).map((v, i) => v - from[i]));
      if (d <= bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best === null) return key;
    taken.add(best);
    return best;
  });
}

/** How a trace is shown: the layers hidden and the order of the layers, by `layerKey`. */
export interface TraceView {
  hidden: string[];
  order: string[];
}

export function viewOf(shown: VectorResult): TraceView {
  return {
    hidden: shown.layers.filter((l) => !l.visible).map(layerKey),
    order: shown.layers.map(layerKey),
  };
}

/** `result` with the layers hidden and ordered as in `view`; layers it does not know go last. */
export function withView(result: VectorResult, view: TraceView): VectorResult {
  const hidden = new Set(view.hidden);
  const order = new Map(view.order.map((k, i) => [k, i]));
  const layers = result.layers
    .map((l) => ({ ...l, visible: !hidden.has(layerKey(l)) }))
    .sort((a, b) => (order.get(layerKey(a)) ?? Infinity) - (order.get(layerKey(b)) ?? Infinity));
  return { ...result, layers };
}
