import React from 'react';
import { X, BookOpen } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useDocumentStore } from '../../store/documentStore';
import { DEFAULT_TONAL, applyRecipe } from '../../lib/document';
import { RECIPE_VERSION, type MaterialPreset } from '../../types/recipe';
import styles from './MaterialPresetDialog.module.css';

const PRESETS: MaterialPreset[] = [
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

export const MaterialPresetDialog: React.FC = () => {
  const isOpen = useUIStore((s) => s.isPresetDialogOpen);
  const setOpen = useUIStore((s) => s.setPresetDialogOpen);
  const edit = useDocumentStore((s) => s.edit);

  if (!isOpen) return null;

  const handleSelectPreset = (preset: MaterialPreset) => {
    edit(applyRecipe(preset.recipe));
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
