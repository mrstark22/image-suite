import type { ImageDocument } from '../types/document';
import { cropRectOf } from './document-size';

/**
 * Background removal as a pipeline step (phase 5, #50). The document holds
 * only its settings; the mask is derived data, computed by a segmentation
 * model from the image as turned and cropped, and cached by `maskKey`.
 */

/**
 * A foreground probability map at the model's input size: one byte per
 * pixel, 0 background to 255 subject, stretched over the whole of the turned
 * and cropped image.
 */
export interface BackgroundMask {
  key: string;
  data: Uint8Array;
  width: number;
  height: number;
}

/** Where a model run has got to, for the panel (bytes while downloading). */
export interface ModelProgress {
  stage: 'downloading' | 'verifying' | 'starting' | 'running' | 'done';
  loadedBytes: number;
  totalBytes: number;
}

/**
 * The one function that runs the segmentation model: `rgba` is the image at
 * `inputSize`, flattened onto white; it returns the probability map at the
 * same size. Throws when the model cannot be loaded or run; nothing is
 * substituted (AGENTS.md rule 5).
 */
export interface MaskModel {
  inputSize: { widthPx: number; heightPx: number };
  predict(rgba: Uint8Array, onProgress: (p: ModelProgress) => void): Promise<Uint8Array>;
}

/** Identifies the mask `doc` needs: the source, its turn and its crop. The settings do not change it. */
export function maskKey(doc: ImageDocument): string {
  const c = cropRectOf(doc);
  return `${doc.source.sourceId}|r${doc.steps.rotation}|${c.x},${c.y},${c.width},${c.height}`;
}

/** What `doc`'s background step adds to a render key: nothing while it is off. */
export function backgroundKeyPart(doc: ImageDocument): string {
  const b = doc.steps.background;
  return b.enabled ? `bg${b.cutoff},${b.softness}` : 'bg-off';
}

/** `doc` with background removal on or off, everything else unchanged. */
export function withBackgroundEnabled(doc: ImageDocument, enabled: boolean): ImageDocument {
  if (doc.steps.background.enabled === enabled) return doc;
  return { ...doc, steps: { ...doc.steps, background: { ...doc.steps.background, enabled } } };
}

/** Message of the error a render gets when it needs a mask it was not given. */
export const MASK_MISSING_ERROR = 'The background mask for this crop has not been computed.';
