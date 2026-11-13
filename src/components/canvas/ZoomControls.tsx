import React, { useEffect, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize, RotateCcw, Undo2, Redo2 } from 'lucide-react';
import { useViewStore } from '../../store/viewStore';
import { useDocumentStore } from '../../store/documentStore';
import { useUIStore } from '../../store/uiStore';
import { useRenderStore } from '../../store/renderStore';
import { useBackgroundStore } from '../../store/backgroundStore';
import { showsOrbitView } from '../../lib/workflows';
import { menuShortcut, ZOOM_STEP } from '../../lib/shortcuts';
import { useCompactChrome } from '../shared/breakpoints';
import styles from './ZoomControls.module.css';

/**
 * The zoom bar over the flat canvas. The 3D orbit view has its own camera,
 * moved by the wheel, a pinch or + and - (#81), and ignores this zoom, so the
 * bar is not shown there (#82). On a phone it is a single pill.
 */
export const ZoomControls: React.FC = () => {
  const zoom = useViewStore((s) => s.zoom);
  const zoomBy = useViewStore((s) => s.zoomBy);
  const fit = useViewStore((s) => s.fit);
  const resetViewport = useViewStore((s) => s.resetViewport);
  const hasDocument = useDocumentStore((s) => s.doc !== null);
  const viewMode = useDocumentStore((s) => s.doc?.depth.viewMode);
  const job = useUIStore((s) => s.job);
  const canvasTool = useViewStore((s) => s.canvasTool);

  const compact = useCompactChrome();

  if (!hasDocument) return null;
  if (showsOrbitView(job, viewMode, canvasTool)) {
    return (
      <>
        <BusyPill />
        {compact && <HistoryPill />}
      </>
    );
  }

  // Phone: pinch does the zooming, so the bar shrinks to one pill in the top
  // corner, clear of the image's bottom edge and the sheet. It reads the zoom
  // and switches between the whole image and 100%, where the dots show.
  if (compact) {
    const toActual = zoom < 1;
    return (
      <>
        <BusyPill />
        <HistoryPill />
        <button
          className={styles.zoomPill}
          title={toActual ? `Actual Size, 100% (${menuShortcut('actualSize')})` : `Fit to Screen (${menuShortcut('fit')})`}
          aria-label={`Zoom ${Math.round(zoom * 100)}%. ${toActual ? 'Show at 100%' : 'Fit to screen'}`}
          onClick={toActual ? resetViewport : fit}
        >
          {toActual ? <ZoomIn size={14} aria-hidden="true" /> : <Maximize size={13} aria-hidden="true" />}
          <span>{Math.round(zoom * 100)}%</span>
        </button>
      </>
    );
  }

  return (
    <>
      <BusyPill />
      <div className={styles.zoomBar}>
        <button
          className={styles.button}
          title={`Zoom Out (${menuShortcut('zoomOut')})`}
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        >
          <ZoomOut size={16} />
        </button>

        <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>

        <button
          className={styles.button}
          title={`Zoom In (${menuShortcut('zoomIn')})`}
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          <ZoomIn size={16} />
        </button>

        <button
          className={styles.button}
          title={`Fit to Screen (${menuShortcut('fit')})`}
          onClick={fit}
        >
          <Maximize size={15} />
        </button>

        <button
          className={styles.button}
          title={`Actual Size, 100% (${menuShortcut('actualSize')})`}
          onClick={resetViewport}
        >
          <RotateCcw size={15} />
        </button>
      </div>
    </>
  );
};

/**
 * Phone: Undo and Redo on the canvas, in the top-left corner. Elsewhere they
 * are in the menu bar and on Ctrl+Z; on a phone the menu hid them, so an edit
 * such as removing the background looked as if it could not be undone.
 */
const HistoryPill: React.FC = () => {
  const canUndo = useDocumentStore((s) => s.past.length > 0 || s.gesture !== null);
  const canRedo = useDocumentStore((s) => s.future.length > 0);
  const undo = useDocumentStore((s) => s.undo);
  const redo = useDocumentStore((s) => s.redo);
  return (
    <div className={styles.historyPill} role="group" aria-label="History">
      <button className={styles.historyButton} aria-label="Undo" title="Undo" disabled={!canUndo} onClick={undo}>
        <Undo2 size={16} aria-hidden="true" />
      </button>
      <button className={styles.historyButton} aria-label="Redo" title="Redo" disabled={!canRedo} onClick={redo}>
        <Redo2 size={16} aria-hidden="true" />
      </button>
    </div>
  );
};

/** How long a render runs before the canvas says it is working: quick renders do not flicker it. */
const BUSY_DELAY_MS = 600;

/**
 * Says on the canvas that it is being updated, when a render takes longer
 * than `BUSY_DELAY_MS`, and what the background model is doing while it runs.
 * A crop or turn with the background removed recomputes the mask, which takes
 * seconds on a phone; without this the image just did not change.
 */
const BusyPill: React.FC = () => {
  const processing = useRenderStore((s) => s.isProcessing);
  const model = useBackgroundStore((s) => s.progress);
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!processing) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), BUSY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [processing]);
  let text: string | null = null;
  if (model) {
    text =
      model.stage === 'downloading' && model.totalBytes > 0
        ? `Downloading the background model… ${Math.round((100 * model.loadedBytes) / model.totalBytes)}%`
        : 'Removing the background…';
  } else if (late) {
    text = 'Updating…';
  }
  if (!text) return null;
  return (
    <div className={styles.busyPill} role="status">
      <span className={styles.busyDot} aria-hidden="true" />
      {text}
    </div>
  );
};
