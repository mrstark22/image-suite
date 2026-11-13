import React from 'react';
import { ZoomIn, ZoomOut, Maximize, RotateCcw } from 'lucide-react';
import { useViewStore } from '../../store/viewStore';
import { useDocumentStore } from '../../store/documentStore';
import { useUIStore } from '../../store/uiStore';
import { showsOrbitView } from '../../lib/workflows';
import { menuShortcut, ZOOM_STEP } from '../../lib/shortcuts';
import { useLayout } from '../shared/breakpoints';
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

  const layout = useLayout();

  if (!hasDocument || showsOrbitView(job, viewMode, canvasTool)) return null;

  // Phone: pinch does the zooming, so the bar shrinks to one pill in the top
  // corner, clear of the image's bottom edge and the sheet. It reads the zoom
  // and switches between the whole image and 100%, where the dots show.
  if (layout === 'phone') {
    const toActual = zoom < 1;
    return (
      <button
        className={styles.zoomPill}
        title={toActual ? `Actual Size, 100% (${menuShortcut('actualSize')})` : `Fit to Screen (${menuShortcut('fit')})`}
        aria-label={`Zoom ${Math.round(zoom * 100)}%. ${toActual ? 'Show at 100%' : 'Fit to screen'}`}
        onClick={toActual ? resetViewport : fit}
      >
        {toActual ? <ZoomIn size={14} aria-hidden="true" /> : <Maximize size={13} aria-hidden="true" />}
        <span>{Math.round(zoom * 100)}%</span>
      </button>
    );
  }

  return (
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
  );
};
