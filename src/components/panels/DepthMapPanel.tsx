import React from 'react';
import { Sun, Layers, Sparkles } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { DEFAULT_DEPTH, setDepth } from '../../lib/document';
import { DocumentSlider } from '../shared/Slider';
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

const MATERIALS: Array<{ id: ReliefMaterial; label: string; color: string }> = [
  { id: 'walnut', label: 'Walnut Wood', color: '#b87333' },
  { id: 'brass', label: 'Brushed Brass', color: '#e5c158' },
  { id: 'slate', label: 'Ceramic Slate', color: '#64748b' },
  { id: 'grayscale', label: 'Monochrome', color: '#94a3b8' },
];

/** Relief settings of the open document. Its files are written by the export step (ReliefExports). */
export const DepthMapPanel: React.FC = () => {
  const depth = useDocumentStore((s) => s.doc?.depth ?? DEFAULT_DEPTH);
  const edit = useDocumentStore((s) => s.edit);
  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>3D Relief & Depth Map</span>
      </div>

      {/* 3D Preview Shading Mode */}
      <div className={styles.section}>
        <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={14} />
          <span>3D Relief View Mode</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {VIEW_MODES.map((vm) => {
            const isActive = (depth.viewMode || '3d-shaded') === vm.id;
            return (
              <button
                key={vm.id}
                className={`${styles.cardButton} ${isActive ? styles.cardButtonActive : ''}`}
                style={{ width: '100%', padding: '8px 10px' }}
                onClick={() => edit(setDepth({ viewMode: vm.id }))}
              >
                <span className={styles.cardTitle} style={{ fontSize: 12 }}>{vm.label}</span>
                <span className={styles.cardDesc}>{vm.desc}</span>
              </button>
            );
          })}
        </div>

        {/* Material Selection for 3D Shaded Mode */}
        {depth.viewMode !== 'heatmap' && depth.viewMode !== 'grayscale' && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 6 }}>
              Substrate Material
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
              {MATERIALS.map((m) => {
                const isActive = (depth.material || 'walnut') === m.id;
                return (
                  <button
                    key={m.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 8px',
                      background: isActive ? 'var(--surface-hover)' : 'var(--surface)',
                      border: isActive ? '1px solid var(--text)' : '1px solid var(--border)',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 11,
                      color: 'var(--text)',
                    }}
                    onClick={() => edit(setDepth({ material: m.id }))}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        backgroundColor: m.color,
                        display: 'inline-block',
                      }}
                    />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Source Selection Cards */}
      <div className={styles.section}>
        <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Layers size={14} />
          <span>Depth Calculation Engine</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {DEPTH_SOURCES.map((src) => {
            const isActive = depth.source === src.id;
            return (
              <button
                key={src.id}
                className={`${styles.cardButton} ${isActive ? styles.cardButtonActive : ''}`}
                style={{ width: '100%', padding: '8px 10px' }}
                onClick={() => edit(setDepth({ source: src.id }))}
              >
                <span className={styles.cardTitle} style={{ fontSize: 12 }}>{src.title}</span>
                <span className={styles.cardDesc}>{src.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Profile & Controls */}
      <div className={styles.section}>
        <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sun size={14} />
          <span>Relief & Lighting Controls</span>
        </div>

        {depth.source === 'distance-transform' && (
          <div className={styles.gridCards} style={{ marginBottom: 12 }}>
            {BEVEL_STYLES.map((b) => {
              const isActive = depth.bevelStyle === b.id;
              return (
                <button
                  key={b.id}
                  className={`${styles.cardButton} ${isActive ? styles.cardButtonActive : ''}`}
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

        <div className={styles.toggleRow} style={{ marginTop: 12 }}>
          <div>
            <div className={styles.toggleLabel}>Invert Z-Axis Height</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
              {depth.invertZ ? 'Dark = Highest / Light = Deepest' : 'Light = Highest / Dark = Deepest (Standard CNC)'}
            </div>
          </div>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={depth.invertZ}
            onChange={(e) => edit(setDepth({ invertZ: e.target.checked }))}
          />
        </div>
      </div>

    </div>
  );
};
