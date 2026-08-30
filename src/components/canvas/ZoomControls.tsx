import React from 'react';
import { ZoomIn, ZoomOut, Maximize, RotateCcw } from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import styles from './ZoomControls.module.css';

export const ZoomControls: React.FC = () => {
  const zoom = useImageStore((s) => s.zoom);
  const setZoom = useImageStore((s) => s.setZoom);
  const resetViewport = useImageStore((s) => s.resetViewport);
  const previewBuffer = useImageStore((s) => s.previewBuffer);

  if (!previewBuffer) return null;

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
