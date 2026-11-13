import React from 'react';
import { useDocumentStore } from '../../store/documentStore';
import { useUIStore } from '../../store/uiStore';
import { activeCalibration, activeProfiles, useProfilesStore } from '../../store/profilesStore';
import { DocumentSlider } from '../shared/Slider';
import { Button } from '../shared/Button';
import { Section } from '../shared/Section';
import { Toggle } from '../shared/Toggle';
import { DEFAULT_DITHER, resetDither, setDither } from '../../lib/document';
import { describeDotPitch, ditherCalibrationNote, profileDither, setDotPitch } from '../../lib/profile-dither';
import { StatusMessage } from '../shared/StatusMessage';
import { dotGridTarget, photoPreviewTarget } from '../../lib/render-target';
import { burnSimulationSettings } from '../../lib/burn-simulation';
import { MM_PER_INCH } from '../../lib/document-size';
import type { DitherAlgorithm } from '../../types/dither';
import styles from './Panels.module.css';

interface DitherOption {
  id: DitherAlgorithm;
  title: string;
  desc: string;
  badge?: string;
}

export const DITHER_OPTIONS: DitherOption[] = [
  { id: 'jarvis', title: 'Jarvis', desc: 'Error diffusion over 12 neighbours: sharp detail, smooth tones', badge: 'Recommended' },
  { id: 'floyd-steinberg', title: 'Floyd-Steinberg', desc: 'Error diffusion over 4 neighbours: crisp, can show streaks' },
  { id: 'atkinson', title: 'Atkinson', desc: 'Diffuses only 3/4 of the error: bright, punchy, loses deep shadow detail' },
  { id: 'blue-noise', title: 'Blue noise', desc: 'Even, organic dot scatter with no streaks; slightly softer edges' },
  { id: 'bayer-2', title: 'Bayer 2×2', desc: 'Ordered grid pattern, 5 tones' },
  { id: 'bayer-4', title: 'Bayer 4×4', desc: 'Ordered crosshatch pattern, 17 tones' },
  { id: 'bayer-8', title: 'Bayer 8×8', desc: 'Ordered fine pattern, 65 tones' },
  { id: 'none', title: 'None (greyscale)', desc: "Keep grey tones for LightBurn's Grayscale mode" },
];

const ERROR_DIFFUSION: readonly DitherAlgorithm[] = ['floyd-steinberg', 'atkinson', 'jarvis'];
const BAYER: readonly DitherAlgorithm[] = ['bayer-2', 'bayer-4', 'bayer-8'];

/** Dither settings of the open document. */
export const DitheringPanel: React.FC = () => {
  const doc = useDocumentStore((s) => s.doc);
  const edit = useDocumentStore((s) => s.edit);
  const burnPreview = useUIStore((s) => s.burnPreview);
  const setBurnPreview = useUIStore((s) => s.setBurnPreview);
  const profiles = useProfilesStore();
  const { machine, material } = activeProfiles(profiles);
  const calibration = activeCalibration('engrave', profiles);
  const fromProfile = profileDither(machine, calibration);
  const dither = doc?.steps.dither ?? DEFAULT_DITHER;
  const dithered = dither.algorithm !== 'none';
  const grid = doc ? dotGridTarget(doc) : null;
  const preview = doc ? photoPreviewTarget(doc) : null;
  const sim = burnSimulationSettings(dither.dotPitchMm, machine, calibration);
  const toneNote = ditherCalibrationNote(material, calibration, dither.toneCurve);

  return (
    <div className={styles.panel}>
      <div className={styles.panelActions}>
        <Button variant="link" onClick={() => edit(resetDither)}>
          Reset
        </Button>
      </div>

      {dithered && (
        <div className={styles.calibrationNote}>
          <StatusMessage tone={toneNote.tone}>{toneNote.text}</StatusMessage>
          {toneNote.offerCalibrate && (
            <Button variant="link" onClick={() => profiles.openCalibrate({ kind: 'engrave' })}>
              Calibrate tones with a test card…
            </Button>
          )}
        </div>
      )}

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
        {!dithered && (
          <div className={`${styles.controlNote} ${styles.stackGap}`}>
            Not dithered: the file keeps grey tones and LightBurn decides the dots. For dots placed here at your
            laser's line interval, choose Jarvis.
          </div>
        )}
        {ERROR_DIFFUSION.includes(dither.algorithm) && (
          <Toggle
            label="Serpentine scan"
            note="Alternate the direction of each row, which breaks up diagonal streaks."
            checked={dither.serpentine}
            onChange={(checked) => edit(setDither({ serpentine: checked }))}
          />
        )}
        {BAYER.includes(dither.algorithm) && (
          <DocumentSlider
            label="Pattern cell size"
            value={dither.matrixScale}
            min={1}
            max={4}
            step={1}
            unit=" dots"
            update={(v) => setDither({ matrixScale: v })}
            reset={setDither({ matrixScale: 1 })}
          />
        )}
        {doc?.steps.tonal.invert && dithered && (
          <div className={`${styles.controlNote} ${styles.stackGap}`}>
            Inverted in the Adjust step: the light parts of the photo are burned, for materials that mark light such
            as slate.
          </div>
        )}
      </Section>

      {dithered && (
        <Section title="Dot grid">
          <DocumentSlider
            label="Line interval"
            value={dither.dotPitchMm}
            min={0.04}
            max={0.3}
            step={0.005}
            unit=" mm"
            update={(v) => setDotPitch(v, fromProfile)}
            reset={setDotPitch(null, fromProfile)}
          />
          <div className={styles.controlNote}>{describeDotPitch(dither, machine)}</div>
          {grid ? (
            <div className={`${styles.readoutBox} ${styles.stackGap}`}>
              <div className={styles.readoutRow}>
                <span>Dots</span>
                <strong>
                  {grid.widthPx} × {grid.heightPx} at {(MM_PER_INCH / dither.dotPitchMm).toFixed(1)} DPI
                </strong>
              </div>
              <div className={styles.controlNote}>
                One pixel is one laser dot. The image is resampled to this grid, then dithered.
              </div>
            </div>
          ) : (
            <div className={`${styles.controlNote} ${styles.stackGap}`}>Set the size to see the dot grid.</div>
          )}
          {preview && !preview.exact && grid && (
            <div className={`${styles.controlNote} ${styles.stackGap}`}>
              This job is {((grid.widthPx * grid.heightPx) / 1e6).toFixed(0)} million dots, too many to preview dot for
              dot: the preview dithers a {preview.target.widthPx} × {preview.target.heightPx} copy. The exported file is
              the full grid.
            </div>
          )}
          {dither.dotPitchOrigin === 'user' && (
            <Button variant="link" onClick={() => edit(setDotPitch(null, fromProfile))}>
              Use the profile's line interval ({fromProfile.dotPitchMm} mm)
            </Button>
          )}
        </Section>
      )}

      {dithered && (
        <Section title="Burn preview">
          <Toggle
            label="Simulate the burn"
            note="Show round laser dots on wood instead of square pixels. A view only; the file does not change."
            checked={burnPreview}
            onChange={setBurnPreview}
          />
          {burnPreview && <div className={`${styles.controlNote} ${styles.stackGap}`}>{sim.basis}</div>}
        </Section>
      )}
    </div>
  );
};
