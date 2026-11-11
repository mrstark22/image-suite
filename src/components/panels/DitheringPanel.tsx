import React from 'react';
import { useDocumentStore } from '../../store/documentStore';
import { DocumentSlider } from '../shared/Slider';
import { DEFAULT_DITHER, resetDither, setDither } from '../../lib/document';
import type { AlphaBurnHandling, DitherAlgorithm } from '../../types/dither';
import styles from './Panels.module.css';

interface DitherOption {
  id: DitherAlgorithm;
  title: string;
  desc: string;
  badge?: string;
}

const DITHER_OPTIONS: DitherOption[] = [
  { id: 'none', title: 'None', desc: 'Continuous grayscale tone' },
  { id: 'floyd-steinberg', title: 'Floyd-Steinberg', desc: 'Standard 4-point error diffusion' },
  { id: 'jarvis', title: 'Jarvis', desc: 'Smoother 12-point error diffusion' },
  { id: 'atkinson', title: 'Atkinson', desc: 'High contrast; deepens shadows, lifts highlights' },
  { id: 'bayer-2', title: 'Bayer 2×2', desc: 'Coarse ordered pattern, 5 tones' },
  { id: 'bayer-4', title: 'Bayer 4×4', desc: 'Ordered crosshatch pattern, 17 tones' },
  { id: 'bayer-8', title: 'Bayer 8×8', desc: 'Fine ordered pattern, 65 tones' },
];

/** Dither settings of the open document. */
export const DitheringPanel: React.FC = () => {
  const dither = useDocumentStore((s) => s.doc?.steps.dither ?? DEFAULT_DITHER);
  const edit = useDocumentStore((s) => s.edit);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Dithering</span>
        <button className={styles.resetButton} onClick={() => edit(resetDither)}>
          Reset
        </button>
      </div>

      {/* Algorithm Card Selector */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Algorithm</div>
        <div className={styles.gridCards}>
          {DITHER_OPTIONS.map((opt) => {
            const isActive = dither.algorithm === opt.id;
            return (
              <button
                key={opt.id}
                className={`${styles.cardButton} ${isActive ? styles.cardButtonActive : ''}`}
                onClick={() => edit(setDither({ algorithm: opt.id }))}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                  <span className={styles.cardTitle}>{opt.title}</span>
                  {opt.badge && (
                    <span
                      style={{
                        fontSize: 8,
                        fontWeight: 700,
                        color: 'var(--accent-primary)',
                        background: 'rgba(56,189,248,0.15)',
                        padding: '1px 4px',
                        borderRadius: 3,
                      }}
                    >
                      {opt.badge}
                    </span>
                  )}
                </div>
                <span className={styles.cardDesc}>{opt.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Dither Parameters */}
      {dither.algorithm !== 'none' && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Parameters</div>
          <DocumentSlider
            label="Threshold / Density Cutoff"
            value={dither.threshold}
            min={0}
            max={255}
            update={(v) => setDither({ threshold: v })}
            reset={setDither({ threshold: DEFAULT_DITHER.threshold })}
          />

          {(dither.algorithm === 'floyd-steinberg' ||
            dither.algorithm === 'atkinson' ||
            dither.algorithm === 'jarvis') && (
            <div className={styles.toggleRow}>
              <span className={styles.toggleLabel}>Serpentine Traversal</span>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={dither.serpentine}
                onChange={(e) => edit(setDither({ serpentine: e.target.checked }))}
              />
            </div>
          )}

          {(dither.algorithm === 'bayer-2' ||
            dither.algorithm === 'bayer-4' ||
            dither.algorithm === 'bayer-8') && (
            <DocumentSlider
              label="Matrix Scale / Dot Size"
              value={dither.matrixScale}
              min={1}
              max={4}
              step={1}
              update={(v) => setDither({ matrixScale: v })}
            />
          )}

          {/* Alpha / Background Handling for Lasers */}
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
              Transparency & Background Burn
            </label>
            <select
              className={styles.select}
              value={dither.alphaHandling || 'white-ignore'}
              onChange={(e) => edit(setDither({ alphaHandling: e.target.value as AlphaBurnHandling }))}
            >
              <option value="white-ignore">White (Ignore / No Burn - Standard for Laser)</option>
              <option value="black-burn">Black (Burn Background Box)</option>
              <option value="transparent">Transparent Alpha (Preserve PNG transparency)</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
};
