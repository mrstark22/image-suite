import type { EditSteps } from '../types/document';
import type { RenderTarget, Stage } from '../types/render';
import type { WasmPipelineParams } from '../wasm/wasm-bridge';

/** The nearest odd integer to `value`, and at least 3. */
export function nearestOddAtLeast3(value: number): number {
  const odd = 2 * Math.round((value - 1) / 2) + 1;
  return Math.max(3, odd);
}

/**
 * The parameters of steps 4 to 6 (`process_pipeline`) for a render of `steps`
 * at `target`, which has `pxPerMm` pixels per millimetre (design section 2,
 * "Lengths in millimetres").
 *
 * - Lengths stored in millimetres are converted to pixels of the target: the
 *   sharpen radius to `mm * pxPerMm`, the adaptive block to the nearest odd
 *   integer of at least 3.
 * - While the size is not set (`pxPerMm` is null) the two length-based steps,
 *   sharpening and the adaptive threshold, are skipped.
 * - The `prepared` stage stops before the dither.
 */
export function toRunParams(
  steps: EditSteps,
  pxPerMm: number | null,
  target: RenderTarget,
  stage: Exclude<Stage, 'source'>
): WasmPipelineParams {
  const { tonal, color, detail, dither } = steps;
  const sized = pxPerMm !== null;
  return {
    width: target.widthPx,
    height: target.heightPx,
    exposure: tonal.exposure,
    brightness: tonal.brightness,
    contrast: tonal.contrast,
    midtones: tonal.midtones,
    highlights: tonal.highlights,
    shadows: tonal.shadows,
    whites: tonal.whites,
    blacks: tonal.blacks,
    clarity: tonal.clarity,
    gamma: tonal.gamma,
    blackPoint: tonal.blackPoint,
    whitePoint: tonal.whitePoint,
    invert: tonal.invert,
    grayscaleMode: tonal.grayscaleMode,
    saturation: color.saturation,
    vibrance: color.vibrance,
    temperature: color.temperature,
    tint: color.tint,
    enableClahe: detail.clahe,
    claheClip: detail.claheClipLimit,
    claheGrid: detail.claheGridSize,
    enableAdaptive: sized && detail.adaptiveThreshold,
    adaptiveBlock: sized ? nearestOddAtLeast3(detail.adaptiveBlockMm * pxPerMm) : 3,
    adaptiveC: detail.adaptiveConstant,
    sharpenAmount: sized ? detail.unsharpStrength / 100 : 0,
    sharpenRadius: sized ? detail.unsharpRadiusMm * pxPerMm : 0,
    ditherAlgorithm: stage === 'final' ? dither.algorithm : 'none',
    ditherThreshold: dither.threshold,
    ditherSerpentine: dither.serpentine,
    ditherScale: dither.matrixScale,
    ditherInverted: dither.invertedBurn || false,
  };
}
