import type { DocumentUpdate } from '../types/document';
import { DEFAULT_DETAIL, setColor, setDetail, setTonal } from './document';

/**
 * The updates made by the adjustments panel's preset chips and section reset
 * buttons. They live here rather than inline in the panel so the history
 * tests apply exactly what the panel applies (#21).
 */

/** Applies several updates as one edit, so they are one undo entry. */
export function combine(...updates: DocumentUpdate[]): DocumentUpdate {
  return (d) => updates.reduce((acc, u) => u(acc), d);
}

export type AdjustmentPresetId = 'laser-prep' | 'shadow-lift' | 'high-contrast' | 'slate-invert';

/**
 * The quick tonal presets: each chip is one edit. Auto Levels is not here: it
 * reads the image (auto-levels.ts).
 */
export const ADJUSTMENT_PRESETS: Record<AdjustmentPresetId, DocumentUpdate> = {
  'laser-prep': combine(
    setTonal({ contrast: 30, clarity: 35, midtones: 10, highlights: -15, shadows: 20, grayscaleMode: 'rec709' }),
    setDetail({ unsharpStrength: 60, unsharpRadiusMm: DEFAULT_DETAIL.unsharpRadiusMm })
  ),
  'shadow-lift': setTonal({ shadows: 50, midtones: 25, exposure: 0.3, contrast: 10 }),
  'high-contrast': setTonal({ contrast: 50, blacks: -20, whites: 20, clarity: 25 }),
  'slate-invert': setTonal({ invert: true, contrast: 35, clarity: 30, grayscaleMode: 'rec709' }),
};

export type AdjustmentSection = 'tone' | 'levels' | 'detail' | 'color' | 'filters';

/** The reset icon on each section header: one edit restoring that section. */
export const SECTION_RESETS: Record<AdjustmentSection, DocumentUpdate> = {
  tone: setTonal({
    exposure: 0,
    brightness: 0,
    contrast: 0,
    midtones: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
  }),
  levels: setTonal({ blackPoint: 0, whitePoint: 255, gamma: 1.0 }),
  detail: combine(
    setTonal({ clarity: 0 }),
    setDetail({ unsharpStrength: 0, unsharpRadiusMm: DEFAULT_DETAIL.unsharpRadiusMm })
  ),
  color: combine(setColor({ saturation: 0, vibrance: 0, temperature: 0, tint: 0 }), setTonal({ grayscaleMode: 'none' })),
  filters: combine(setDetail({ clahe: false, adaptiveThreshold: false }), setTonal({ invert: false })),
};
