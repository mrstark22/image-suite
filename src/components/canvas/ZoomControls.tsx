import React from 'react';
import { ZoomIn, ZoomOut, Maximize, RotateCcw } from 'lucide-react';
import { useViewStore } from '../../store/viewStore';
import { useDocumentStore } from '../../store/documentStore';
import { menuShortcut, ZOOM_STEP } from '../../lib/shortcuts';
import styles from './ZoomControls.module.css';

export const ZoomControls: React.FC = () => {
  const zoom = useViewStore((s) => s.zoom);
  const zoomBy = useViewStore((s) => s.zoomBy);
  const fit = useViewStore((s) => s.fit);
  const resetViewport = useViewStore((s) => s.resetViewport);
  const hasDocument = useDocumentStore((s) => s.doc !== null);

  if (!hasDocument) return null;

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
