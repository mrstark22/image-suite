import type { ColorAdjustments, CropRect, TonalAdjustments } from '../types/image';
import type { DitherConfig } from '../types/dither';
import type { VectorConfig } from '../types/vector';
import type { DepthConfig } from '../types/depth';
import type {
  DetailSettings,
  DocumentUpdate,
  EditSteps,
  ImageDocument,
  SourceInfo,
} from '../types/document';
import { RECIPE_VERSION, type EditRecipe, type EditStep } from '../types/recipe';
import { clampCropRect } from './crop';
import { checkPalette } from './trace-palette';

/**
 * The document's defaults and the pure functions that change it. Every change
 * to a document goes through `documentStore.edit` or a gesture with one of
 * these updates (or a composition of them).
 */

export const DEFAULT_TONAL: TonalAdjustments = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  midtones: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  clarity: 0,
  gamma: 1.0,
  blackPoint: 0,
  whitePoint: 255,
  invert: false,
  grayscaleMode: 'none',
};

export const DEFAULT_COLOR: ColorAdjustments = {
  hue: 0,
  saturation: 0,
  lightness: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
};

/**
 * The sharpen radius and adaptive block match the old pixel defaults (1.5 px
 * and 15 px) at 300 DPI.
 */
export const DEFAULT_DETAIL: DetailSettings = {
  clahe: false,
  claheClipLimit: 2.5,
  claheGridSize: 8,
  unsharpStrength: 0,
  unsharpRadiusMm: 0.13,
  adaptiveThreshold: false,
  adaptiveBlockMm: 1.3,
  adaptiveConstant: 2,
};

export const DEFAULT_DITHER: DitherConfig = {
  algorithm: 'none',
  threshold: 128,
  serpentine: true,
  matrixScale: 1,
  invertedBurn: false,
};

export const DEFAULT_VECTOR: VectorConfig = {
  colorMode: 'mono',
  shapes: 'auto',
  threshold: 128,
  invert: false,
  colorCount: 4,
  palette: null,
  maxStrokeWidthMm: 0.8,
  toleranceMm: 0.05,
  cornerAngle: 60,
  minAreaMm2: 0,
  denoiseMm: 0,
  cutline: false,
  cutlineOffsetMm: 2,
};

export const DEFAULT_DEPTH: DepthConfig = {
  source: 'tonal-height',
  bevelStyle: 'prismatic',
  invertZ: false,
  zMin: 0,
  zMax: 100,
  smoothingRadius: 2.0,
  depthScale: 3.0,
  reliefAngle: 45,
  export16Bit: true,
  detailEmboss: 0,
  aiWeight: 75,
  tonalBlend: 25,
  surfaceDenoise: 2.0,
  viewMode: '3d-shaded',
  material: 'walnut',
  lightAngle: 315,
  lightElevation: 45,
};

/** The edit steps of a freshly loaded image. */
export function defaultSteps(): EditSteps {
  return {
    crop: null,
    tonal: { ...DEFAULT_TONAL },
    color: { ...DEFAULT_COLOR },
    detail: { ...DEFAULT_DETAIL },
    dither: { ...DEFAULT_DITHER },
  };
}

/**
 * A new document for `source`, as it is right after loading: default steps and
 * settings, and the size not set unless `mmPerPx` is given.
 */
export function createDocument(
  id: string,
  source: SourceInfo,
  mmPerPx: number | null = null
): ImageDocument {
  return {
    id,
    source,
    mmPerPx,
    steps: defaultSteps(),
    vector: { ...DEFAULT_VECTOR },
    depth: { ...DEFAULT_DEPTH },
  };
}

/** Structural equality for plain data: numbers, strings, booleans, null, arrays and objects. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  return aKeys.every((key) => key in bRecord && sameValue(aRecord[key], bRecord[key]));
}

function withSteps(doc: ImageDocument, steps: Partial<EditSteps>): ImageDocument {
  return { ...doc, steps: { ...doc.steps, ...steps } };
}

/** Changes some tonal adjustments. */
export function setTonal(partial: Partial<TonalAdjustments>): DocumentUpdate {
  return (d) => withSteps(d, { tonal: { ...d.steps.tonal, ...partial } });
}

/** Changes some colour adjustments. */
export function setColor(partial: Partial<ColorAdjustments>): DocumentUpdate {
  return (d) => withSteps(d, { color: { ...d.steps.color, ...partial } });
}

/** Changes some detail settings. */
export function setDetail(partial: Partial<DetailSettings>): DocumentUpdate {
  return (d) => withSteps(d, { detail: { ...d.steps.detail, ...partial } });
}

/** Changes some dither settings. */
export function setDither(partial: Partial<DitherConfig>): DocumentUpdate {
  return (d) => withSteps(d, { dither: { ...d.steps.dither, ...partial } });
}

/** Changes some tracing settings. */
export function setVector(partial: Partial<VectorConfig>): DocumentUpdate {
  return (d) => ({ ...d, vector: { ...d.vector, ...partial } });
}

/** Changes some relief settings. */
export function setDepth(partial: Partial<DepthConfig>): DocumentUpdate {
  return (d) => ({ ...d, depth: { ...d.depth, ...partial } });
}

/**
 * Sets the crop to `rect`, in pixels of the source, clamped to the source.
 * `null` removes the crop. A rectangle entirely outside the source changes
 * nothing. The scale is kept, so the physical size follows the crop.
 */
export function setCrop(rect: CropRect | null): DocumentUpdate {
  return (d) => {
    if (rect === null) return withSteps(d, { crop: null });
    const clamped = clampCropRect(rect, d.source.widthPx, d.source.heightPx);
    if (!clamped) return d;
    const whole =
      clamped.x === 0 &&
      clamped.y === 0 &&
      clamped.width === d.source.widthPx &&
      clamped.height === d.source.heightPx;
    return withSteps(d, { crop: whole ? null : clamped });
  };
}

/**
 * Sets the physical scale, in millimetres per source pixel. This is the only
 * update that changes the scale.
 */
export function setScale(mmPerPx: number): DocumentUpdate {
  if (!Number.isFinite(mmPerPx) || mmPerPx <= 0) {
    throw new RangeError(`A scale must be a positive number of millimetres per pixel, not ${mmPerPx}`);
  }
  return (d) => ({ ...d, mmPerPx });
}

/** Restores every edit step (crop included) and workflow setting to its default. Keeps the scale. */
export const resetAll: DocumentUpdate = (d) => ({
  ...d,
  steps: defaultSteps(),
  vector: { ...DEFAULT_VECTOR },
  depth: { ...DEFAULT_DEPTH },
});

/**
 * Restores every setting of the adjustments panel: tone, colour and detail
 * (CLAHE, sharpening and the adaptive threshold). Keeps the crop, the dither,
 * the workflow settings and the scale.
 */
export const resetAdjustments: DocumentUpdate = (d) =>
  withSteps(d, { tonal: { ...DEFAULT_TONAL }, color: { ...DEFAULT_COLOR }, detail: { ...DEFAULT_DETAIL } });

/** Restores the dither settings. */
export const resetDither: DocumentUpdate = (d) => withSteps(d, { dither: { ...DEFAULT_DITHER } });

/** Restores the tracing settings. */
export const resetVector: DocumentUpdate = (d) => ({ ...d, vector: { ...DEFAULT_VECTOR } });

/**
 * Applies a recipe: each step it contains replaces that step's settings, and
 * the tonal, colour, detail, dither, tracing and relief settings it does not
 * contain return to their defaults. The crop and the scale belong to the
 * image, so a recipe leaves them alone.
 */
export function applyRecipe(recipe: EditRecipe): DocumentUpdate {
  // A recipe is a file anyone can write: a palette colour that is not
  // #rrggbb is refused here, not traced as some other colour.
  for (const step of recipe.steps) {
    const palette = step.type === 'vectorize' ? (step.params as Partial<VectorConfig>).palette : null;
    if (palette) checkPalette(palette);
  }
  return (d) => {
    const tonal = { ...DEFAULT_TONAL };
    const color = { ...DEFAULT_COLOR };
    const detail = { ...DEFAULT_DETAIL };
    const dither = { ...DEFAULT_DITHER };
    const vector = { ...DEFAULT_VECTOR };
    const depth = { ...DEFAULT_DEPTH };
    for (const step of recipe.steps) {
      if (step.type === 'tonal') Object.assign(tonal, step.params);
      if (step.type === 'color') Object.assign(color, step.params);
      if (step.type === 'detail') Object.assign(detail, step.params);
      if (step.type === 'dither') Object.assign(dither, step.params);
      // Only settings the tracer still has: a recipe saved before phase 2 carries old ones (#32).
      if (step.type === 'vectorize') Object.assign(vector, knownKeys(step.params, DEFAULT_VECTOR));
      if (step.type === 'depth') Object.assign(depth, step.params);
    }
    return { ...d, steps: { ...d.steps, tonal, color, detail, dither }, vector, depth };
  };
}

function knownKeys<T extends object>(params: Partial<T>, defaults: T): Partial<T> {
  return Object.fromEntries(Object.entries(params).filter(([k]) => k in defaults)) as Partial<T>;
}

/** The document's steps and settings as a recipe, in pipeline order. */
export function recipeFromDocument(doc: ImageDocument, name: string, now = Date.now()): EditRecipe {
  const s = doc.steps;
  const steps: EditStep[] = [
    { id: '1', type: 'geometry', enabled: s.crop !== null, timestamp: now, params: { crop: s.crop } },
    { id: '2', type: 'tonal', enabled: true, timestamp: now, params: s.tonal },
    { id: '3', type: 'color', enabled: true, timestamp: now, params: s.color },
    { id: '4', type: 'detail', enabled: true, timestamp: now, params: s.detail },
    { id: '5', type: 'dither', enabled: s.dither.algorithm !== 'none', timestamp: now, params: s.dither },
    { id: '6', type: 'vectorize', enabled: true, timestamp: now, params: doc.vector },
    { id: '7', type: 'depth', enabled: true, timestamp: now, params: doc.depth },
  ];
  return { version: RECIPE_VERSION, name, createdAt: now, updatedAt: now, steps };
}
