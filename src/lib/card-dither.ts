/**
 * The dither photo cards are made with (#40, #56): the core's, through the
 * worker, with the Photo job's default settings (Jarvis, serpentine), so
 * what the card measures is the dither a photo is exported with.
 */
import type { CardDither } from './calibration-cards';
import { DEFAULT_DITHER } from './document';
import { getPipeline, type Pipeline } from './pipeline-client';

export const CARD_DITHER = { algorithm: DEFAULT_DITHER.algorithm, serpentine: DEFAULT_DITHER.serpentine, matrixScale: DEFAULT_DITHER.matrixScale };

export function cardDither(pipeline: Pick<Pipeline, 'ditherArtwork'> = getPipeline()): CardDither {
  return async (r) => {
    const copy = new Uint8ClampedArray(r.rgba);
    const out = await pipeline.ditherArtwork(copy.buffer, r.width, r.height, CARD_DITHER);
    return { rgba: new Uint8ClampedArray(out), width: r.width, height: r.height };
  };
}
