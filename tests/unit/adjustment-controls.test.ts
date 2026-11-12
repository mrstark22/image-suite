/**
 * Adjustment controls do what their labels say (#22; design section 7, #22 rows).
 *
 * - Reset All in the adjustments panel (and Reset Adjustments in the tool
 *   subheader) restores every tone, colour and detail setting, including CLAHE,
 *   sharpening and the adaptive threshold. Edit > Reset All restores every step.
 *
 * Sharpening before the threshold is tested in prepare-source.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';
import {
  DEFAULT_COLOR,
  DEFAULT_DEPTH,
  DEFAULT_DETAIL,
  DEFAULT_TONAL,
  DEFAULT_VECTOR,
  defaultSteps,
  resetAdjustments,
  resetAll,
  setColor,
  setCrop,
  setDepth,
  setDetail,
  setDither,
  setScale,
  setTonal,
  setVector,
} from '../../src/lib/document';
import { combine } from '../../src/lib/adjustment-edits';
import type { DocumentUpdate } from '../../src/types/document';
import { currentDoc, decodedImage, resetStores } from '../helpers/documents';

const store = () => useDocumentStore.getState();

/** Every tone, colour and detail setting away from its default, and the other steps changed too. */
const EVERYTHING_ADJUSTED: DocumentUpdate = combine(
  setScale(0.1),
  setCrop({ x: 4, y: 3, width: 20, height: 15 }),
  setTonal({
    exposure: 0.5,
    brightness: 10,
    contrast: 20,
    midtones: 5,
    highlights: -10,
    shadows: 15,
    whites: 5,
    blacks: -5,
    clarity: 30,
    gamma: 1.2,
    blackPoint: 10,
    whitePoint: 240,
    invert: true,
    grayscaleMode: 'average',
  }),
  setColor({ hue: 10, saturation: 20, lightness: 5, vibrance: 10, temperature: 5, tint: -5 }),
  setDetail({
    clahe: true,
    claheClipLimit: 4,
    claheGridSize: 12,
    unsharpStrength: 40,
    unsharpRadiusMm: 0.5,
    adaptiveThreshold: true,
    adaptiveBlockMm: 2.5,
    adaptiveConstant: 5,
  }),
  setDither({ algorithm: 'atkinson', serpentine: false, matrixScale: 2 }),
  setVector({ mode: 'centerline', invert: true }),
  setDepth({ invertZ: true })
);

/** Keys of `actual` whose value equals the default's: settings the fixture fails to move. */
function unchangedKeys(actual: object, defaults: object): string[] {
  const a = actual as Record<string, unknown>;
  return Object.entries(defaults)
    .filter(([key, value]) => a[key] === value)
    .map(([key]) => key);
}

function openAdjusted() {
  store().open(decodedImage(40, 30));
  store().edit(EVERYTHING_ADJUSTED);
  const adjusted = currentDoc();
  // The fixture moves every adjustment, so a reset that misses one would show.
  expect(unchangedKeys(adjusted.steps.tonal, DEFAULT_TONAL)).toEqual([]);
  expect(unchangedKeys(adjusted.steps.color, DEFAULT_COLOR)).toEqual([]);
  expect(unchangedKeys(adjusted.steps.detail, DEFAULT_DETAIL)).toEqual([]);
  return adjusted;
}

beforeEach(() => resetStores());

describe('Reset All', () => {
  it('in the adjustments panel restores every tone, colour and detail setting, CLAHE, sharpening and threshold included', () => {
    const adjusted = openAdjusted();
    store().edit(resetAdjustments);
    const reset = currentDoc();
    expect(reset.steps.tonal).toEqual(DEFAULT_TONAL);
    expect(reset.steps.color).toEqual(DEFAULT_COLOR);
    expect(reset.steps.detail).toEqual(DEFAULT_DETAIL);
    expect(reset.steps.detail.clahe).toBe(false);
    expect(reset.steps.detail.unsharpStrength).toBe(0);
    expect(reset.steps.detail.adaptiveThreshold).toBe(false);
    // What the panel does not show is left alone.
    expect(reset.steps.crop).toEqual(adjusted.steps.crop);
    expect(reset.steps.dither).toEqual(adjusted.steps.dither);
    expect(reset.vector).toEqual(adjusted.vector);
    expect(reset.depth).toEqual(adjusted.depth);
    expect(reset.mmPerPx).toBe(adjusted.mmPerPx);
  });

  it('in the Edit menu restores every step and workflow setting to its default and keeps the scale', () => {
    const adjusted = openAdjusted();
    store().edit(resetAll);
    const reset = currentDoc();
    expect(reset.steps).toEqual(defaultSteps());
    expect(reset.vector).toEqual(DEFAULT_VECTOR);
    expect(reset.depth).toEqual(DEFAULT_DEPTH);
    expect(reset.mmPerPx).toBe(adjusted.mmPerPx);
  });
});
