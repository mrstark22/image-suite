import type { VectorLayer, VectorResult } from '../types/vector';

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
