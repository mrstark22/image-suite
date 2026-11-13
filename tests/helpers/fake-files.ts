/**
 * Stand-ins for image files in tests, which have no image decoder: a `File`
 * whose name carries its size, and a decoder that fills the engine with the
 * labelled image of that size (or of the reduced size asked for), going
 * through the engine exactly as the browser's strip decoder does.
 */
import { File as NodeFile } from 'node:buffer';
import type { PipelineEngine } from '../../src/lib/pipeline-engine';
import type { PixelSize } from '../../src/lib/reduced-open';
import type { LoadedSourceInfo } from '../../src/types/worker-messages';
import { labelOf } from './documents';

/** A file standing for a `width` x `height` image. */
export function fakeImageFile(width: number, height: number, name = `${width}x${height}.png`): File {
  // Node's File: the one a jsdom test environment provides cannot be read.
  return new NodeFile([`${width}x${height}`], name, { type: 'image/png' }) as unknown as File;
}

/** How many times the fake decoder has decoded each file, by name. */
export const decodes = new Map<string, number>();

/** Decodes a `fakeImageFile` into `engine`: every pixel labelled with its own coordinates. */
export async function fakeDecoder(
  engine: PipelineEngine,
  sourceId: string,
  file: File,
  reduceTo: PixelSize | null
): Promise<LoadedSourceInfo> {
  decodes.set(file.name, (decodes.get(file.name) ?? 0) + 1);
  const [fileW, fileH] = (await file.text()).split('x').map(Number);
  const { widthPx: width, heightPx: height } = reduceTo ?? { widthPx: fileW, heightPx: fileH };
  try {
    engine.beginSource(sourceId, width, height);
    const row = new Uint8Array(width * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) row.set([...labelOf(x, y), 255], x * 4);
      engine.writeSourceRows(y, row, 1);
    }
  } catch (err) {
    engine.releaseSource();
    throw err;
  }
  const info = { widthPx: width, heightPx: height, hasAlpha: false };
  return reduceTo ? { ...info, reducedFrom: { widthPx: fileW, heightPx: fileH } } : info;
}
