import React from 'react';
import { ZoomIn, ZoomOut, Maximize, RotateCcw } from 'lucide-react';
import { useViewStore } from '../../store/viewStore';
import { useDocumentStore } from '../../store/documentStore';
import styles from './ZoomControls.module.css';

export const ZoomControls: React.FC = () => {
  const zoom = useViewStore((s) => s.zoom);
  const setZoom = useViewStore((s) => s.setZoom);
  const resetViewport = useViewStore((s) => s.resetViewport);
  const hasDocument = useDocumentStore((s) => s.doc !== null);

  if (!hasDocument) return null;

  return (
    <div className={styles.zoomBar}>
      <button
        className={styles.button}
        title="Zoom Out"
        onClick={() => setZoom((z) => z * 0.8)}
      >
        <ZoomOut size={16} />
      </button>

      <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>

      <button
        className={styles.button}
        title="Zoom In"
        onClick={() => setZoom((z) => z * 1.25)}
      >
        <ZoomIn size={16} />
      </button>

      <button
        className={styles.button}
        title="Fit to Screen"
        onClick={() => setZoom(1.0)}
      >
        <Maximize size={15} />
      </button>

      <button
        className={styles.button}
        title="Reset Pan & Zoom"
        onClick={resetViewport}
      >
        <RotateCcw size={15} />
      </button>
    </div>
  );
};
