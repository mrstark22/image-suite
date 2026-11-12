import React, { useId } from 'react';
import { Sun, Layers, Sparkles } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { DEFAULT_DEPTH, setDepth } from '../../lib/document';
import { DocumentSlider } from '../shared/Slider';
import { Section } from '../shared/Section';
import { Toggle } from '../shared/Toggle';
import type { BevelStyle, DepthSource, DepthViewMode, ReliefMaterial } from '../../types/depth';
import styles from './Panels.module.css';

const DEPTH_SOURCES: Array<{ id: DepthSource; title: string; desc: string }> = [
  { id: 'ai-estimation', title: 'AI Neural Depth (WebGPU)', desc: 'True 3D monocular depth estimation for portraits & photos' },
  { id: 'tonal-height', title: 'Tonal Luminance', desc: 'Photos, portraits & shaded art relief' },
  { id: 'distance-transform', title: 'Vector & Logo Bevel', desc: 'Bounded chamfers & domes for vector graphics' },
];

const BEVEL_STYLES: Array<{ id: BevelStyle; title: string; desc: string }> = [
  { id: 'prismatic', title: 'Prismatic', desc: '45° V-Bit chamfer simulation' },
  { id: 'dome', title: 'Domed Arc', desc: 'Smooth sinusoidal convex dome' },
  { id: 'concave', title: 'Concave', desc: 'Hollow bowl carving curve' },
  { id: 'flat', title: 'Flat Island', desc: 'Stepped flat plateau with bevel' },
];

const VIEW_MODES: Array<{ id: DepthViewMode; label: string; desc: string }> = [
  { id: '3d-interactive', label: '3D Orbit Viewport', desc: 'Interactive rotating 3D surface mesh with orbit controls' },
  { id: '3d-shaded', label: '3D Relief Shaded (2D)', desc: 'Normal mapping with directional light & shadows' },
  { id: 'heatmap', label: 'False-Color Heatmap', desc: 'Spectral elevation color gradient' },
  { id: 'grayscale', label: 'Raw 2D Grayscale', desc: '16-bit heightmap data for CAM output' },
];

/** The substrate materials of the shaded view; each swatch's colour is in the stylesheet. */
const MATERIALS: Array<{ id: ReliefMaterial; label: string }> = [
  { id: 'walnut', label: 'Walnut Wood' },
  { id: 'brass', label: 'Brushed Brass' },
  { id: 'slate', label: 'Ceramic Slate' },
  { id: 'grayscale', label: 'Monochrome' },
];

const SWATCH_CLASS: Partial<Record<ReliefMaterial, string>> = {
  walnut: styles.swatchWalnut,
  brass: styles.swatchBrass,
  slate: styles.swatchSlate,
  grayscale: styles.swatchGrayscale,
};

/** Relief settings of the open document. Its files are written by the export step (ReliefExports). */
export const DepthMapPanel: React.FC = () => {
  const depth = useDocumentStore((s) => s.doc?.depth ?? DEFAULT_DEPTH);
  const edit = useDocumentStore((s) => s.edit);
  const materialLabelId = useId();
  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>3D Relief & Depth Map</span>
      </div>

      {/* 3D Preview Shading Mode */}
      <Section title="3D Relief View Mode" icon={<Sparkles size={14} />}>
        <div className={styles.stackCards}>
          {VIEW_MODES.map((vm) => {
            const isActive = (depth.viewMode || '3d-shaded') === vm.id;
            return (
              <button
                key={vm.id}
                type="button"
                className={`${styles.cardButton} ${styles.cardButtonWide} ${isActive ? styles.cardButtonActive : ''}`}
                aria-pressed={isActive}
                onClick={() => edit(setDepth({ viewMode: vm.id }))}
              >
                <span className={`${styles.cardTitle} ${styles.cardTitleLarge}`}>{vm.label}</span>
                <span className={styles.cardDesc}>{vm.desc}</span>
              </button>
            );
          })}
        </div>

        {/* Material Selection for 3D Shaded Mode */}
        {depth.viewMode !== 'heatmap' && depth.viewMode !== 'grayscale' && (
          <div role="group" aria-labelledby={materialLabelId}>
            <div id={materialLabelId} className={styles.choiceLabel}>
              Substrate Material
            </div>
            <div className={styles.gridCards}>
              {MATERIALS.map((m) => {
                const isActive = (depth.material || 'walnut') === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`${styles.materialButton} ${isActive ? styles.materialButtonActive : ''}`}
                    aria-pressed={isActive}
                    onClick={() => edit(setDepth({ material: m.id }))}
                  >
                    <span className={`${styles.swatch} ${SWATCH_CLASS[m.id] ?? ''}`} aria-hidden="true" />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Section>

      {/* Source Selection Cards */}
      <Section title="Depth Calculation Engine" icon={<Layers size={14} />}>
        <div className={styles.stackCards}>
          {DEPTH_SOURCES.map((src) => {
            const isActive = depth.source === src.id;
            return (
              <button
                key={src.id}
                type="button"
                className={`${styles.cardButton} ${styles.cardButtonWide} ${isActive ? styles.cardButtonActive : ''}`}
                aria-pressed={isActive}
                onClick={() => edit(setDepth({ source: src.id }))}
              >
                <span className={`${styles.cardTitle} ${styles.cardTitleLarge}`}>{src.title}</span>
                <span className={styles.cardDesc}>{src.desc}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Profile & Controls */}
      <Section title="Relief & Lighting Controls" icon={<Sun size={14} />}>
        {depth.source === 'distance-transform' && (
          <div className={styles.gridCards}>
            {BEVEL_STYLES.map((b) => {
              const isActive = depth.bevelStyle === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  className={`${styles.cardButton} ${isActive ? styles.cardButtonActive : ''}`}
                  aria-pressed={isActive}
                  onClick={() => edit(setDepth({ bevelStyle: b.id }))}
                >
                  <span className={styles.cardTitle}>{b.title}</span>
                  <span className={styles.cardDesc}>{b.desc}</span>
                </button>
              );
            })}
          </div>
        )}
        <DocumentSlider
          label="Relief Depth Exaggeration"
          value={depth.depthScale}
          min={1.0}
          max={10.0}
          step={0.5}
          unit="×"
          update={(v) => setDepth({ depthScale: v })}
          reset={setDepth({ depthScale: 3.0 })}
        />

        {depth.source === 'ai-estimation' && (
          <>
            <DocumentSlider
              label="3D AI Base Volume"
              value={depth.aiWeight ?? 75}
              min={0}
              max={100}
              step={5}
              unit="%"
              update={(v) => setDepth({ aiWeight: v })}
              reset={setDepth({ aiWeight: 75 })}
            />

            <DocumentSlider
              label="Tonal Label & Text Relief"
              value={depth.tonalBlend ?? 35}
              min={0}
              max={100}
              step={5}
              unit="%"
              update={(v) => setDepth({ tonalBlend: v })}
              reset={setDepth({ tonalBlend: 35 })}
            />

            <DocumentSlider
              label="Surface Denoising"
              value={depth.surfaceDenoise ?? 2.0}
              min={0}
              max={8}
              step={0.5}
              unit="px"
              update={(v) => setDepth({ surfaceDenoise: v })}
              reset={setDepth({ surfaceDenoise: 2.0 })}
            />
          </>
        )}

        <DocumentSlider
          label="Light Source Angle"
          value={depth.lightAngle ?? 315}
          min={0}
          max={360}
          step={5}
          unit="°"
          update={(v) => setDepth({ lightAngle: v })}
          reset={setDepth({ lightAngle: 315 })}
        />

        <DocumentSlider
          label="Anti-Terracing Smoothing"
          value={depth.smoothingRadius}
          min={0}
          max={15}
          step={0.5}
          unit="px"
          update={(v) => setDepth({ smoothingRadius: v })}
          reset={setDepth({ smoothingRadius: 2.0 })}
        />

        <Toggle
          label="Invert Z-Axis Height"
          checked={depth.invertZ}
          note={depth.invertZ ? 'Dark = Highest / Light = Deepest' : 'Light = Highest / Dark = Deepest (Standard CNC)'}
          onChange={(checked) => edit(setDepth({ invertZ: checked }))}
        />
      </Section>
    </div>
  );
};
