import type { VectorConfig } from '../types/vector';
import { checkPalette } from './trace-palette';

const COLOR_MODES: ReadonlyArray<VectorConfig['colorMode']> = ['mono', 'color'];
const SHAPES: ReadonlyArray<VectorConfig['shapes']> = ['auto', 'outline', 'centerline'];
const NUMBERS = ['threshold', 'colorCount', 'maxStrokeWidthMm', 'toleranceMm', 'cornerAngle', 'minAreaMm2', 'denoiseMm', 'cutlineOffsetMm'] as const;
const FLAGS = ['autoThreshold', 'invert', 'cutline'] as const;

/**
 * Throws unless every tracing setting present in `settings` is one the tracer
 * has: a known colour mode and shape mode, finite numbers that are not
 * negative, true or false for the switches, and a usable palette. Settings
 * come from recipe files as well as from the app, and a value the tracer does
 * not know must be reported, not traced as some default (#86).
 */
export function checkVectorSettings(settings: Partial<VectorConfig>): void {
  const s = settings as Record<string, unknown>;
  if ('colorMode' in s && !COLOR_MODES.includes(s.colorMode as VectorConfig['colorMode'])) {
    throw new Error(`"${String(s.colorMode)}" is not a colour mode the tracer has (${COLOR_MODES.join(', ')}).`);
  }
  if ('shapes' in s && !SHAPES.includes(s.shapes as VectorConfig['shapes'])) {
    throw new Error(`"${String(s.shapes)}" is not a shape mode the tracer has (${SHAPES.join(', ')}).`);
  }
  for (const key of NUMBERS) {
    if (key in s && !(typeof s[key] === 'number' && Number.isFinite(s[key]) && (s[key] as number) >= 0)) {
      throw new Error(`The tracing setting ${key} must be a number of zero or more, not ${JSON.stringify(s[key])}.`);
    }
  }
  for (const key of FLAGS) {
    if (key in s && typeof s[key] !== 'boolean') {
      throw new Error(`The tracing setting ${key} must be true or false, not ${JSON.stringify(s[key])}.`);
    }
  }
  if (settings.palette != null) checkPalette(settings.palette);
}
