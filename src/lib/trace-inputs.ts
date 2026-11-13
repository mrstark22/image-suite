import type { ImageDocument } from '../types/document';
import type { VectorConfig } from '../types/vector';
import { sameValue } from './document';

/**
 * What a trace reads from the document. This is the one list of it (#89):
 * the trace scheduler re-traces when any of these changes, and a trace on
 * screen is current while they are what it was traced from.
 */
export interface TraceInputs {
  source: ImageDocument['source'];
  mmPerPx: ImageDocument['mmPerPx'];
  rotation: ImageDocument['steps']['rotation'];
  crop: ImageDocument['steps']['crop'];
  background: ImageDocument['steps']['background'];
  tonal: ImageDocument['steps']['tonal'];
  color: ImageDocument['steps']['color'];
  detail: ImageDocument['steps']['detail'];
  vector: VectorConfig;
}

let lastTraced: VectorConfig | null = null;

/**
 * The tracing settings the tracer itself reads: `vector` without the colour
 * each palette entry is drawn in, which is applied to the result afterwards
 * and never reaches the tracer (#91). The same object is returned while the
 * value is unchanged, so it can be compared by reference.
 */
export function tracedVector(vector: VectorConfig): VectorConfig {
  const traced: VectorConfig = {
    ...vector,
    palette: vector.palette?.map(({ color, removed, mergeInto }) => ({ color, removed, mergeInto })) ?? null,
  };
  if (lastTraced === null || !sameValue(traced, lastTraced)) lastTraced = traced;
  return lastTraced;
}

export function traceInputsOf(doc: ImageDocument): TraceInputs {
  const { rotation, crop, background, tonal, color, detail } = doc.steps;
  return { source: doc.source, mmPerPx: doc.mmPerPx, rotation, crop, background, tonal, color, detail, vector: tracedVector(doc.vector) };
}

/** The parts of `traceInputsOf(doc)`, for a comparison by reference. */
export function traceInputRefs(doc: ImageDocument): readonly unknown[] {
  return Object.values(traceInputsOf(doc));
}
