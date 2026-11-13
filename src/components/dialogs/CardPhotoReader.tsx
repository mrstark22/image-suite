import React, { useEffect, useRef, useState } from 'react';
import { Camera, ImageUp } from 'lucide-react';
import type { CardSpec } from '../../types/calibration-card';
import type { CardReading } from '../../lib/card-reader';
import { getPipeline } from '../../lib/pipeline-client';
import { StatusMessage } from '../shared/StatusMessage';
import styles from './CalibrateDialog.module.css';

export type CardRead = Extract<CardReading, { ok: true }>;

interface Props {
  spec: CardSpec;
  /** The other cards stored in this browser, so a photo of one of them is recognised. */
  known: CardSpec[];
  /** A reading to propose from, or null when there is none (any more). */
  onRead: (reading: CardRead | null) => void;
}

/** The flattened photo with what was measured outlined on it. */
const Measured: React.FC<{ reading: CardRead }> = ({ reading }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { rectified: r, outlines } = reading;
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    el.width = r.width;
    el.height = r.height;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(r.rgba), r.width, r.height), 0, 0);
  }, [r]);
  const W = r.width / r.pxPerMm;
  const H = r.height / r.pxPerMm;
  return (
    <figure className={styles.measured}>
      <div className={styles.measuredPicture} style={{ aspectRatio: `${W} / ${H}` }}>
        <canvas ref={canvas} className={styles.pictureCanvas} role="img" aria-label="The card from the photo, flattened, with the measured patches outlined" />
        <svg className={styles.measuredOverlay} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {outlines
            .filter((o) => o.kind !== 'halo' || o.flagged)
            .map((o, i) => (
              <rect key={i} x={o.x} y={o.y} width={o.w} height={o.h} className={o.flagged ? styles.olFlag : o.kind === 'step' ? styles.olStep : o.kind === 'reference' ? styles.olRef : styles.olCode} />
            ))}
        </svg>
      </div>
      <figcaption className={styles.muted}>
        <span className={styles.keyStep}>Green</span>: steps measured. <span className={styles.keyRef}>Blue</span>: bare wood the light is judged by.
        {outlines.some((o) => o.flagged) && (
          <>
            {' '}
            <span className={styles.keyFlag}>Red</span>: discoloured around the cell (scorch or smoke).
          </>
        )}
      </figcaption>
    </figure>
  );
};

/**
 * "Read from a photo" (#56): a phone opens its camera, a computer a file
 * chooser (a flatbed scan works best). The worker finds the card, measures
 * it and returns a proposal, which the result step shows for the user to
 * confirm or override.
 */
export const CardPhotoReader: React.FC<Props> = ({ spec, known, onRead }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<CardRead | null>(null);

  const read = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await getPipeline().readCardPhotoFile(file, spec, known);
      if (!r.ok) {
        setReading(null);
        onRead(null);
        setError(r.message);
      } else {
        setReading(r);
        onRead(r);
      }
    } catch (err) {
      setReading(null);
      onRead(null);
      setError(`${err instanceof Error ? err.message : String(err)} Choose by eye below instead.`);
    } finally {
      setBusy(false);
    }
  };
  const input = (capture: boolean) => (
    <input
      type="file"
      accept="image/*"
      {...(capture ? { capture: 'environment' } : {})}
      className={styles.fileInput}
      disabled={busy}
      onChange={(e) => {
        void read(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );

  return (
    <section className={styles.photoRead} aria-labelledby={`photo-read-${spec.id}`}>
      <h3 id={`photo-read-${spec.id}`} className={styles.blockTitle}>Read from a photo</h3>
      <p className={styles.muted}>
        Lay the card flat in even light and get all four corner markers in the picture; the tool measures each patch against the bare wood and proposes a result. Phone cameras adjust tone, so readings are relative within one photo; a flatbed scan is the most repeatable.
      </p>
      <div className={styles.photoButtons}>
        <label className={styles.fileButton} aria-disabled={busy}>
          <Camera size={16} aria-hidden="true" />
          Take a photo
          {input(true)}
        </label>
        <label className={styles.fileButton} aria-disabled={busy}>
          <ImageUp size={16} aria-hidden="true" />
          Choose a photo or scan
          {input(false)}
        </label>
      </div>
      {busy && <p className={styles.muted} aria-live="polite">Measuring the card…</p>}
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {reading && (
        <>
          <StatusMessage tone="success">
            {reading.codeRead ? `Card #${spec.shortId} recognised and measured.` : `Measured as card #${spec.shortId}.`}
          </StatusMessage>
          {reading.warnings.map((w) => (
            <StatusMessage key={w} tone="warning">
              {w}
            </StatusMessage>
          ))}
          <Measured reading={reading} />
        </>
      )}
    </section>
  );
};

/** A tone curve: darkness burned by grey level, white to black. */
export const ToneCurvePlot: React.FC<{ curve: number[] }> = ({ curve }) => {
  const W = 300;
  const H = 90;
  const pts = curve.map((d, i) => [8 + (i / (curve.length - 1)) * (W - 16), H - 12 - d * (H - 24)] as const);
  return (
    <figure className={styles.plot}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tone curve: darkness burned for each grey level, white to black">
        <line x1={8} y1={H - 12} x2={W - 8} y2={H - 12} className={styles.plotAxis} />
        <line x1={8} y1={H - 12} x2={W - 8} y2={12} className={styles.plotAxis} strokeDasharray="3 3" />
        <polyline points={pts.map((p) => p.join(',')).join(' ')} className={styles.plotLine} />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2.5} className={styles.plotDot} />
        ))}
        <text x={8} y={H - 1} className={styles.plotText}>white</text>
        <text x={W - 8} y={H - 1} textAnchor="end" className={styles.plotText}>black</text>
        <text x={10} y={10} className={styles.plotText}>darkness burned</text>
      </svg>
      <figcaption className={styles.muted}>Measured darkness by grey level; the dashed line is an even response. The Photo job applies the inverse before dithering.</figcaption>
    </figure>
  );
};
