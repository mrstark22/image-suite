import React, { useEffect, useRef, useState } from 'react';
import * as Comlink from 'comlink';
import { Eraser, RotateCcw, Sparkles } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { useBackgroundStore } from '../../store/backgroundStore';
import { getPipeline } from '../../lib/pipeline-client';
import { DEFAULT_BACKGROUND, setBackground } from '../../lib/document';
import { maskKey, type ModelProgress } from '../../lib/background';
import { previewTarget } from '../../lib/render-target';
import type { BackgroundSettings, ImageDocument } from '../../types/document';
import type { BackgroundPreview } from '../../types/worker-messages';
import { Button } from '../shared/Button';
import { Section } from '../shared/Section';
import { DocumentSlider, Slider } from '../shared/Slider';
import { Progress } from '../shared/Progress';
import { StatusMessage } from '../shared/StatusMessage';
import styles from './Panels.module.css';
import own from './AIPanel.module.css';

/** Longest edge of the comparison shown in the panel. */
const COMPARISON_EDGE = 720;

type View = 'removed' | 'result' | 'original';

const VIEWS: Array<{ value: View; label: string }> = [
  { value: 'removed', label: 'Removed area' },
  { value: 'result', label: 'Result' },
  { value: 'original', label: 'Original' },
];

/** What the progress bar says for a stage, and how far it is when known. */
export function progressLabel(p: ModelProgress): { label: string; fraction: number | null } {
  const mb = (n: number) => (n / 1e6).toFixed(1);
  switch (p.stage) {
    case 'downloading':
      return { label: `Downloading model, ${mb(p.loadedBytes)} of ${mb(p.totalBytes)} MB`, fraction: p.loadedBytes / p.totalBytes };
    case 'verifying':
      return { label: 'Checking the model', fraction: null };
    case 'starting':
      return { label: 'Starting the model', fraction: null };
    default:
      return { label: 'Finding the subject', fraction: null };
  }
}

/** Draws `preview` in `view` onto `canvas`. Removed pixels show over a checkerboard or tinted red. */
function draw(canvas: HTMLCanvasElement, preview: BackgroundPreview, view: View): void {
  const { widthPx: w, heightPx: h } = preview;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const src = new Uint8Array(preview.original);
  const alpha = new Uint8Array(preview.alpha);
  const out = new ImageData(w, h);
  const cell = Math.max(4, Math.round(Math.max(w, h) / 48));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = view === 'original' ? 1 : alpha[i] / 255;
      let bg: [number, number, number];
      if (view === 'removed') {
        // The image, tinted red where it will be removed.
        bg = [Math.min(255, src[i * 4] * 0.45 + 140), src[i * 4 + 1] * 0.45, src[i * 4 + 2] * 0.45 + 20];
      } else {
        const light = ((Math.floor(x / cell) + Math.floor(y / cell)) & 1) === 0;
        bg = light ? [255, 255, 255] : [214, 214, 214];
      }
      for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.round(src[i * 4 + c] * a + bg[c] * (1 - a));
      out.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

/** `doc` with the panel's settings, which are the document's once removal is applied. */
function withSettings(doc: ImageDocument, settings: Pick<BackgroundSettings, 'cutoff' | 'softness'>): ImageDocument {
  return setBackground(settings)(doc);
}

/**
 * The Background step (#50). Removal is an edit step in the document, so it
 * is undoable on its own and follows the crop. A segmentation model (ISNet,
 * docs/background-removal.md) finds the subject on this device; the image is
 * never uploaded. The user sees what will be removed before applying it, and
 * if the model cannot be loaded the error is shown and the image is left as
 * it is.
 */
export const AIPanel: React.FC = () => {
  const doc = useDocumentStore((s) => s.doc);
  const progress = useBackgroundStore((s) => s.progress);
  const applied = doc?.steps.background.enabled ?? false;

  // Settings tried before applying; once applied the document's are used.
  const [draft, setDraft] = useState({ cutoff: DEFAULT_BACKGROUND.cutoff, softness: DEFAULT_BACKGROUND.softness });
  const settings = applied && doc ? doc.steps.background : draft;
  const [preview, setPreview] = useState<(BackgroundPreview & { key: string }) | null>(null);
  const [view, setView] = useState<View>('removed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const request = useRef(0);

  useEffect(() => {
    const pipeline = getPipeline();
    void Promise.resolve(
      pipeline.setModelProgressListener(Comlink.proxy((p: ModelProgress) => useBackgroundStore.getState().setProgress(p)))
    ).catch(() => undefined);
  }, []);

  const key = doc ? maskKey(doc) : null;
  // The preview belongs to one image and crop. While removal is applied it
  // follows the crop (the pipeline needs that mask anyway); a preview not yet
  // applied follows only the settings, and is dropped when the crop changes,
  // so the model never runs unasked.
  const wanted = doc !== null && (applied || (preview !== null && preview.key === key));
  const previewFor = async (target: ImageDocument) => {
    const id = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const result = await getPipeline().backgroundPreview(target, previewTarget(target, COMPARISON_EDGE));
      if (id === request.current) setPreview({ ...result, key: maskKey(target) });
    } catch (err) {
      if (id === request.current) {
        setPreview(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (id === request.current) {
        setBusy(false);
        useBackgroundStore.getState().setProgress(null);
      }
    }
  };

  useEffect(() => {
    if (!doc || !wanted) return;
    const timer = setTimeout(() => void previewFor(withSettings(doc, settings)), 120);
    return () => clearTimeout(timer);
    // Recomputed when the crop, image or settings change, not on other edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, wanted, settings.cutoff, settings.softness]);

  useEffect(() => {
    if (canvas.current && preview) draw(canvas.current, preview, view);
  }, [preview, view]);

  if (!doc) return null;

  const showPreview = preview !== null && preview.key === key;
  const removedShare = showPreview ? share(preview.alpha) : null;

  const start = () => void previewFor(withSettings(doc, draft));
  const apply = () => {
    useDocumentStore.getState().edit(setBackground({ enabled: true, ...draft }));
  };
  const cancel = () => {
    request.current++;
    setBusy(false);
    setPreview(null);
  };
  const restore = () => {
    setDraft({ cutoff: doc.steps.background.cutoff, softness: doc.steps.background.softness });
    useDocumentStore.getState().edit(setBackground({ enabled: false }));
    setPreview(null);
  };

  const sliders = applied ? (
    <>
      <DocumentSlider
        label="Subject confidence"
        value={settings.cutoff}
        min={1}
        max={99}
        unit="%"
        update={(cutoff) => setBackground({ cutoff })}
        reset={setBackground({ cutoff: DEFAULT_BACKGROUND.cutoff })}
      />
      <DocumentSlider
        label="Edge softness"
        value={settings.softness}
        min={0}
        max={100}
        unit="%"
        update={(softness) => setBackground({ softness })}
        reset={setBackground({ softness: DEFAULT_BACKGROUND.softness })}
      />
    </>
  ) : (
    <>
      <Slider
        label="Subject confidence"
        value={draft.cutoff}
        min={1}
        max={99}
        unit="%"
        onChange={(cutoff) => setDraft((d) => ({ ...d, cutoff }))}
        onReset={() => setDraft((d) => ({ ...d, cutoff: DEFAULT_BACKGROUND.cutoff }))}
      />
      <Slider
        label="Edge softness"
        value={draft.softness}
        min={0}
        max={100}
        unit="%"
        onChange={(softness) => setDraft((d) => ({ ...d, softness }))}
        onReset={() => setDraft((d) => ({ ...d, softness: DEFAULT_BACKGROUND.softness }))}
      />
    </>
  );

  const shownProgress = busy && progress ? progressLabel(progress) : null;

  return (
    <div className={styles.panel}>
      <Section title="Remove background">
        <p className={own.intro}>
          A segmentation model finds the subject and the rest becomes white, which does not burn. It runs on this
          device; the image is never uploaded. The first use downloads the model (91 MB) once.
        </p>

        {showPreview && (
          <>
            <div className={styles.segmentedGroup} role="group" aria-label="Show">
              {VIEWS.map((v) => (
                <button
                  key={v.value}
                  type="button"
                  className={`${styles.segmentedItem} ${view === v.value ? styles.segmentedItemActive : ''}`}
                  aria-pressed={view === v.value}
                  onClick={() => setView(v.value)}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <div className={own.frame}>
              <canvas
                ref={canvas}
                className={own.canvas}
                role="img"
                aria-label={`${VIEWS.find((v) => v.value === view)!.label}: ${removedShare}% of the image is removed`}
              />
            </div>
            <p className={own.caption} aria-live="polite">
              {applied ? 'Applied.' : 'Not applied yet.'} {removedShare}% of the image is removed
              {view === 'removed' ? ', shown in red.' : view === 'result' ? ', shown as a checkerboard.' : '.'}
            </p>
          </>
        )}

        {(showPreview || applied) && sliders}

        {shownProgress && <Progress label={shownProgress.label} fraction={shownProgress.fraction} className={own.gap} />}
        {busy && !shownProgress && <Progress label="Finding the subject" fraction={null} className={own.gap} />}

        {error && (
          <StatusMessage tone="error" className={styles.statusGap}>
            Background removal failed: {error} The image has not been changed.
          </StatusMessage>
        )}

        <div className={own.actions}>
          {applied ? (
            <Button icon={<RotateCcw size={14} />} onClick={restore}>
              Restore Background
            </Button>
          ) : showPreview ? (
            <>
              <Button variant="primary" icon={<Eraser size={14} />} onClick={apply} disabled={busy}>
                Apply Removal
              </Button>
              <Button onClick={cancel}>Cancel</Button>
            </>
          ) : (
            <Button variant="primary" icon={<Sparkles size={14} />} onClick={start} disabled={busy}>
              {busy ? 'Removing Background…' : 'Remove Background'}
            </Button>
          )}
        </div>
      </Section>
    </div>
  );
};

/** Percentage of the image removed, from the coverage bytes. */
function share(alpha: ArrayBuffer): number {
  const a = new Uint8Array(alpha);
  if (a.length === 0) return 0;
  let removed = 0;
  for (let i = 0; i < a.length; i++) removed += 255 - a[i];
  return Math.round((removed / (255 * a.length)) * 100);
}
