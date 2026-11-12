import type { DocumentUpdate } from '../types/document';
import { RECIPE_VERSION, type MaterialPreset } from '../types/recipe';
import { DEFAULT_COLOR, DEFAULT_DETAIL, DEFAULT_DITHER, DEFAULT_TONAL } from './document';

/**
 * Machines and materials, chosen in the shell (#53) because they change the
 * photo and relief output.
 *
 * These are placeholders for the profiles of #33. A machine has no line
 * interval, spot size or calibration yet (they are open questions in the
 * plan), so it only names the settings sheet at export. A material carries
 * an uncalibrated photo starting point, taken from the old preset list.
 */

export interface Machine {
  id: string;
  name: string;
  source: 'co2' | 'diode';
  watts: number;
}

/** The two machines in use (docs/plan.md, "Machines and calibration"). */
export const MACHINES: readonly Machine[] = [
  { id: 'co2-60', name: '60 W CO2', source: 'co2', watts: 60 },
  { id: 'co2-155', name: '155 W CO2', source: 'co2', watts: 155 },
];

export const DEFAULT_MACHINE_ID = MACHINES[0].id;

/** The machine with `id`, or null. */
export function machineById(id: string | null): Machine | null {
  return MACHINES.find((m) => m.id === id) ?? null;
}

/** The material with `id`, or null. */
export function materialById(id: string | null): MaterialPreset | null {
  return MATERIALS.find((m) => m.id === id) ?? null;
}

/**
 * Applies `material`'s starting point to the photo steps: tone, colour,
 * detail and dither each take the material's values, or their defaults where
 * it has none. The crop, the size, the tracing and the relief settings are
 * left alone, so choosing a material in the vector or relief job does not
 * reset that job's work.
 */
export function applyMaterial(material: MaterialPreset): DocumentUpdate {
  return (d) => {
    const tonal = { ...DEFAULT_TONAL };
    const color = { ...DEFAULT_COLOR };
    const detail = { ...DEFAULT_DETAIL };
    const dither = { ...DEFAULT_DITHER };
    for (const step of material.recipe.steps) {
      if (step.type === 'tonal') Object.assign(tonal, step.params);
      if (step.type === 'color') Object.assign(color, step.params);
      if (step.type === 'detail') Object.assign(detail, step.params);
      if (step.type === 'dither') Object.assign(dither, step.params);
    }
    return { ...d, steps: { ...d.steps, tonal, color, detail, dither } };
  };
}

export const MATERIALS: readonly MaterialPreset[] = [
  {
    id: 'white-oak',
    name: 'White Oak & Hardwood',
    category: 'Hardwood',
    description: 'High micro-contrast with CLAHE and Floyd-Steinberg dithering to bring out grain detail.',
    recommendedDpi: 300,
    recommendedDither: 'floyd-steinberg',
    recipe: {
      version: RECIPE_VERSION,
      name: 'White Oak Recipe',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [
        { id: '1', type: 'tonal', enabled: true, timestamp: Date.now(), params: { ...DEFAULT_TONAL, brightness: 5, contrast: 15, gamma: 1.1, blackPoint: 10, whitePoint: 250, clarity: 20 } },
        { id: '2', type: 'detail', enabled: true, timestamp: Date.now(), params: { clahe: true, claheClipLimit: 3.0, claheGridSize: 8, unsharpStrength: 25, unsharpRadiusMm: 0.13, adaptiveThreshold: false, adaptiveBlockMm: 1.3, adaptiveConstant: 2 } },
        { id: '3', type: 'dither', enabled: true, timestamp: Date.now(), params: { algorithm: 'floyd-steinberg', threshold: 132, serpentine: true, matrixScale: 1, invertedBurn: false } },
      ],
    },
  },
  {
    id: 'dark-walnut',
    name: 'Dark Walnut & Mahogany',
    category: 'Hardwood',
    description: 'Lifted gamma and Floyd-Steinberg dithering to keep shadow detail visible on dark wood.',
    recommendedDpi: 300,
    recommendedDither: 'floyd-steinberg',
    recipe: {
      version: RECIPE_VERSION,
      name: 'Dark Walnut Recipe',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [
        { id: '1', type: 'tonal', enabled: true, timestamp: Date.now(), params: { ...DEFAULT_TONAL, brightness: 12, contrast: 10, gamma: 1.3, shadows: 20, whitePoint: 240, midtones: 15 } },
        { id: '2', type: 'dither', enabled: true, timestamp: Date.now(), params: { algorithm: 'floyd-steinberg', threshold: 124, serpentine: true, matrixScale: 1, invertedBurn: false } },
      ],
    },
  },
  {
    id: 'birch-ply',
    name: 'Baltic Birch Plywood',
    category: 'Plywood',
    description: 'Jarvis dithering for smooth tone on light plywood.',
    recommendedDpi: 254,
    recommendedDither: 'jarvis',
    recipe: {
      version: RECIPE_VERSION,
      name: 'Baltic Birch Recipe',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [
        { id: '1', type: 'tonal', enabled: true, timestamp: Date.now(), params: { ...DEFAULT_TONAL, brightness: 0, contrast: 8, gamma: 1.0, blackPoint: 5, whitePoint: 255 } },
        { id: '2', type: 'dither', enabled: true, timestamp: Date.now(), params: { algorithm: 'jarvis', threshold: 128, serpentine: true, matrixScale: 1, invertedBurn: false } },
      ],
    },
  },
  {
    id: 'black-slate',
    name: 'Slate & Black Granite',
    category: 'Slate/Stone',
    description: 'Punchy high-contrast Atkinson diffusion for fractured white engraving marks on deep slate.',
    recommendedDpi: 300,
    recommendedDither: 'atkinson',
    recipe: {
      version: RECIPE_VERSION,
      name: 'Slate Recipe',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [
        { id: '1', type: 'tonal', enabled: true, timestamp: Date.now(), params: { ...DEFAULT_TONAL, brightness: 10, contrast: 25, gamma: 1.15, blackPoint: 15, whitePoint: 245, invert: true } },
        { id: '2', type: 'dither', enabled: true, timestamp: Date.now(), params: { algorithm: 'atkinson', threshold: 135, serpentine: true, matrixScale: 1, invertedBurn: true } },
      ],
    },
  },
  {
    id: 'anodized-aluminum',
    name: 'Anodized Aluminum (Fiber Laser)',
    category: 'Anodized Metal',
    description: 'High-density Floyd-Steinberg dither for crisp marking on anodized coatings.',
    recommendedDpi: 508,
    recommendedDither: 'floyd-steinberg',
    recipe: {
      version: RECIPE_VERSION,
      name: 'Anodized Aluminum Recipe',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [
        { id: '1', type: 'tonal', enabled: true, timestamp: Date.now(), params: { ...DEFAULT_TONAL, brightness: 0, contrast: 20, gamma: 1.0, blackPoint: 0, whitePoint: 255, clarity: 25 } },
        { id: '2', type: 'dither', enabled: true, timestamp: Date.now(), params: { algorithm: 'floyd-steinberg', threshold: 128, serpentine: true, matrixScale: 1, invertedBurn: false } },
      ],
    },
  },
  {
    id: 'leather',
    name: 'Veg-Tanned Leather',
    category: 'Leather',
    description: 'Ordered Bayer pattern for an even, stamp-like shade without burning through.',
    recommendedDpi: 254,
    recommendedDither: 'bayer-4',
    recipe: {
      version: RECIPE_VERSION,
      name: 'Leather Recipe',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [
        { id: '1', type: 'tonal', enabled: true, timestamp: Date.now(), params: { ...DEFAULT_TONAL, brightness: -5, contrast: 12, gamma: 0.9, blackPoint: 10, whitePoint: 250, midtones: -5 } },
        { id: '2', type: 'dither', enabled: true, timestamp: Date.now(), params: { algorithm: 'bayer-4', threshold: 128, serpentine: true, matrixScale: 1, invertedBurn: false } },
      ],
    },
  },
];
