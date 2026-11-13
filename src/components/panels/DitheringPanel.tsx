import React from 'react';
import { useDocumentStore } from '../../store/documentStore';
import { DocumentSlider } from '../shared/Slider';
import { Button } from '../shared/Button';
import { Section } from '../shared/Section';
import { Toggle } from '../shared/Toggle';
import { DEFAULT_DITHER, resetDither, setDither } from '../../lib/document';
import type { DitherAlgorithm } from '../../types/dither';
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
        <Button variant="link" onClick={() => edit(resetDither)}>
          Reset
        </Button>
      </div>

      {/* Algorithm Card Selector */}
      <Section title="Algorithm">
        <div className={styles.gridCards}>
          {DITHER_OPTIONS.map((opt) => {
            const isActive = dither.algorithm === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className={`${styles.cardButton} ${isActive ? styles.cardButtonActive : ''}`}
                aria-pressed={isActive}
                onClick={() => edit(setDither({ algorithm: opt.id }))}
              >
                <span className={styles.cardTitleRow}>
                  <span className={styles.cardTitle}>{opt.title}</span>
                  {opt.badge && <span className={styles.cardBadge}>{opt.badge}</span>}
                </span>
                <span className={styles.cardDesc}>{opt.desc}</span>
              </button>
            );
          })}
        </div>
        {dither.algorithm === 'none' && (
          <div className={`${styles.controlNote} ${styles.stackGap}`}>
            Not dithered yet: the image is still in grey tones. Choose a pattern to turn it into dots the laser can
            burn; Floyd-Steinberg suits most photos. Zoom to 100% to see the dots.
          </div>
        )}
      </Section>

      {/* Dither Parameters */}
      {dither.algorithm !== 'none' && (
        <Section title="Parameters">
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
            <Toggle
              label="Serpentine Traversal"
              checked={dither.serpentine}
              onChange={(checked) => edit(setDither({ serpentine: checked }))}
            />
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
        </Section>
      )}
    </div>
  );
};
