import React from 'react';
import { X, BookOpen } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useEditStore, DEFAULT_TONAL } from '../../store/editStore';
import type { MaterialPreset } from '../../types/recipe';
import styles from './MaterialPresetDialog.module.css';

const PRESETS: MaterialPreset[] = [
  {
    id: 'white-oak',
    name: 'White Oak & Hardwood',
    category: 'Hardwood',
    description: 'High micro-contrast with CLAHE and Blue Noise dithering to pop grain details without scorching.',
    recommendedDpi: 300,
    recommendedDither: 'blue-noise',
    recipe: {
      version: '1.0.0',
      name: 'White Oak Recipe',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [
        { id: '1', type: 'tonal', enabled: true, timestamp: Date.now(), params: { ...DEFAULT_TONAL, brightness: 5, contrast: 15, gamma: 1.1, blackPoint: 10, whitePoint: 250, clarity: 20 } },
        { id: '2', type: 'detail', enabled: true, timestamp: Date.now(), params: { clahe: true, claheClipLimit: 3.0, claheGridSize: 8, unsharpStrength: 25, unsharpRadius: 1.5, adaptiveThreshold: false, adaptiveBlockSize: 15, adaptiveConstant: 2 } },
        { id: '3', type: 'dither', enabled: true, timestamp: Date.now(), params: { algorithm: 'blue-noise', threshold: 132, serpentine: true, matrixScale: 1, dotAngle: 45, invertedBurn: false } },
      ],
    },
  },
  {
    id: 'dark-walnut',
    name: 'Dark Walnut & Mahogany',
    category: 'Hardwood',
    description: 'Lifted gamma and Ostromoukhov variable diffusion to keep shadow details visible on dark wood.',
    recommendedDpi: 300,
    recommendedDither: 'ostromoukhov',
    recipe: {
      version: '1.0.0',
      name: 'Dark Walnut Recipe',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [
        { id: '1', type: 'tonal', enabled: true, timestamp: Date.now(), params: { ...DEFAULT_TONAL, brightness: 12, contrast: 10, gamma: 1.3, shadows: 20, whitePoint: 240, midtones: 15 } },
        { id: '2', type: 'dither', enabled: true, timestamp: Date.now(), params: { algorithm: 'ostromoukhov', threshold: 124, serpentine: true, matrixScale: 1, dotAngle: 45, invertedBurn: false } },
      ],
    },
  },
  {
    id: 'birch-ply',
    name: 'Baltic Birch Plywood',
    category: 'Plywood',
    description: 'Matched for 0.1mm laser focal spot with Riemersma Hilbert curve dithering to prevent banding.',
    recommendedDpi: 254,
    recommendedDither: 'riemersma',
    recipe: {
      version: '1.0.0',
      name: 'Baltic Birch Recipe',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [
        { id: '1', type: 'tonal', enabled: true, timestamp: Date.now(), params: { ...DEFAULT_TONAL, brightness: 0, contrast: 8, gamma: 1.0, blackPoint: 5, whitePoint: 255 } },
        { id: '2', type: 'dither', enabled: true, timestamp: Date.now(), params: { algorithm: 'riemersma', threshold: 128, serpentine: true, matrixScale: 1, dotAngle: 45, invertedBurn: false } },
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
      version: '1.0.0',
      name: 'Slate Recipe',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [
        { id: '1', type: 'tonal', enabled: true, timestamp: Date.now(), params: { ...DEFAULT_TONAL, brightness: 10, contrast: 25, gamma: 1.15, blackPoint: 15, whitePoint: 245, invert: true } },
        { id: '2', type: 'dither', enabled: true, timestamp: Date.now(), params: { algorithm: 'atkinson', threshold: 135, serpentine: true, matrixScale: 1, dotAngle: 45, invertedBurn: true } },
      ],
    },
  },
  {
    id: 'anodized-aluminum',
    name: 'Anodized Aluminum (Fiber Laser)',
    category: 'Anodized Metal',
    description: '508 DPI high-density Blue Noise dither for crisp laser ablation on anodized coatings.',
    recommendedDpi: 508,
    recommendedDither: 'blue-noise',
    recipe: {
      version: '1.0.0',
      name: 'Anodized Aluminum Recipe',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [
        { id: '1', type: 'tonal', enabled: true, timestamp: Date.now(), params: { ...DEFAULT_TONAL, brightness: 0, contrast: 20, gamma: 1.0, blackPoint: 0, whitePoint: 255, clarity: 25 } },
        { id: '2', type: 'dither', enabled: true, timestamp: Date.now(), params: { algorithm: 'blue-noise', threshold: 128, serpentine: true, matrixScale: 1, dotAngle: 45, invertedBurn: false } },
      ],
    },
  },
  {
    id: 'leather',
    name: 'Veg-Tanned Leather',
    category: 'Leather',
    description: '45° Halftone screen pattern that simulates shaded hot-foil burn stamps without burning through.',
    recommendedDpi: 254,
    recommendedDither: 'halftone-dot',
    recipe: {
      version: '1.0.0',
      name: 'Leather Recipe',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [
        { id: '1', type: 'tonal', enabled: true, timestamp: Date.now(), params: { ...DEFAULT_TONAL, brightness: -5, contrast: 12, gamma: 0.9, blackPoint: 10, whitePoint: 250, midtones: -5 } },
        { id: '2', type: 'dither', enabled: true, timestamp: Date.now(), params: { algorithm: 'halftone-dot', threshold: 128, serpentine: true, matrixScale: 1, dotAngle: 45, invertedBurn: false } },
      ],
    },
  },
];

export const MaterialPresetDialog: React.FC = () => {
  const isOpen = useUIStore((s) => s.isPresetDialogOpen);
  const setOpen = useUIStore((s) => s.setPresetDialogOpen);
  const applyRecipe = useEditStore((s) => s.applyRecipe);

  if (!isOpen) return null;

  const handleSelectPreset = (preset: MaterialPreset) => {
    applyRecipe(preset.recipe);
    setOpen(false);
  };

  return (
    <div className={styles.overlay} onClick={() => setOpen(false)}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>
            <BookOpen size={18} color="var(--accent-primary)" />
            Material Substrate Presets
          </div>
          <button className={styles.closeButton} onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <div className={styles.body}>
          {PRESETS.map((preset) => (
            <div
              key={preset.id}
              className={styles.presetCard}
              onClick={() => handleSelectPreset(preset)}
            >
              <div className={styles.cardHeader}>
                <span className={styles.presetName}>{preset.name}</span>
                <span className={styles.categoryBadge}>{preset.category}</span>
              </div>
              <p className={styles.presetDesc}>{preset.description}</p>
              <div className={styles.presetSpecs}>
                <span className={styles.specBadge}>{preset.recommendedDpi} DPI</span>
                <span className={styles.specBadge}>{preset.recommendedDither}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
