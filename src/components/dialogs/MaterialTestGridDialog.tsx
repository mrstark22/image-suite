import React, { useState } from 'react';
import { Grid, X, Check } from 'lucide-react';
import { confirmReplaceInBrowser } from '../../lib/open-image';
import { useDocumentStore, hasUnsavedEdits } from '../../store/documentStore';
import { previewDpi, useRenderStore } from '../../store/renderStore';
import { useUIStore } from '../../store/uiStore';
import { generateTestGridVector } from '../../lib/test-grid-generator';
import { DEFAULT_TEST_GRID_DPI, openTestGridRaster } from '../../lib/test-grid-document';
import styles from './MaterialTestGridDialog.module.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const MaterialTestGridDialog: React.FC<Props> = ({ isOpen, onClose }) => {
  const [type, setType] = useState<'grayscale-step' | 'power-matrix'>('power-matrix');
  const [rows, setRows] = useState<number>(5);
  const [cols, setCols] = useState<number>(5);
  const [boxSizeMm, setBoxSizeMm] = useState<number>(10);
  const [gapMm, setGapMm] = useState<number>(2);
  const [targetMode, setTargetMode] = useState<'raster' | 'vector'>('raster');
  // The raster grid's own resolution, independent of the open image.
  const [gridDpi, setGridDpi] = useState<number>(DEFAULT_TEST_GRID_DPI);
  const [error, setError] = useState<string | null>(null);

  const doc = useDocumentStore((s) => s.doc);
  const addVectorLayer = useRenderStore((s) => s.addVectorLayer);
  const toggleVectorOverlay = useUIStore((s) => s.toggleVectorOverlay);

  if (!isOpen) return null;

  // The vector grid is drawn over the preview, so it needs the preview's
  // resolution, which needs the size.
  const vectorDpi = doc ? previewDpi() : null;
  const canGenerate = targetMode === 'raster' || vectorDpi !== null;

  const handleGenerate = async () => {
    if (targetMode === 'vector') {
      if (vectorDpi === null) return;
      const vectorLayer = generateTestGridVector({
        rows,
        cols,
        boxSizeMm,
        gapMm,
        dpi: vectorDpi,
        type,
      });
      addVectorLayer(vectorLayer);
      toggleVectorOverlay();
    } else {
      if (hasUnsavedEdits() && !confirmReplaceInBrowser()) return;
      try {
        await openTestGridRaster(
          { rows, cols, boxSizeMm, gapMm, dpi: gridDpi, type },
          `Test Grid (${type === 'power-matrix' ? 'Power-Speed' : 'Steps'}).png`
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    setError(null);

    onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>
            <Grid size={16} color="var(--accent-primary)" />
            <span>Generate Material Test Grid Matrix</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Grid Test Pattern</label>
            <select
              className={styles.select}
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="power-matrix">Power vs. Speed Matrix (Laser / CNC Substrate Calibration)</option>
              <option value="grayscale-step">Grayscale Step Wedge (0% to 100% Black Density)</option>
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Rows (Power / Steps)</label>
              <input
                type="number"
                className={styles.input}
                value={rows}
                min={1}
                max={15}
                onChange={(e) => setRows(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Columns (Speed / Steps)</label>
              <input
                type="number"
                className={styles.input}
                value={cols}
                min={1}
                max={15}
                onChange={(e) => setCols(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Box Size (mm)</label>
              <input
                type="number"
                className={styles.input}
                value={boxSizeMm}
                min={2}
                max={50}
                step={0.5}
                onChange={(e) => setBoxSizeMm(Math.max(2, parseFloat(e.target.value) || 2))}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Spacing Gap (mm)</label>
              <input
                type="number"
                className={styles.input}
                value={gapMm}
                min={0}
                max={20}
                step={0.5}
                onChange={(e) => setGapMm(Math.max(0, parseFloat(e.target.value) || 0))}
              />
            </div>
          </div>

          {targetMode === 'raster' && (
            <div className={styles.formGroup}>
              <label className={styles.label}>Grid Resolution (DPI)</label>
              <input
                type="number"
                className={styles.input}
                value={gridDpi}
                min={50}
                max={1200}
                step={1}
                onChange={(e) => setGridDpi(Math.min(1200, Math.max(50, parseFloat(e.target.value) || DEFAULT_TEST_GRID_DPI)))}
              />
            </div>
          )}

          <div className={styles.formGroup}>
            <label className={styles.label}>Output Format</label>
            <select
              className={styles.select}
              value={targetMode}
              onChange={(e) => setTargetMode(e.target.value as any)}
            >
              <option value="raster">Open as Image, Replacing the Current One (Grayscale Burn Levels)</option>
              <option value="vector">Vector Cut Grid Overlay (Red #FF0000 Paths)</option>
            </select>
          </div>
        </div>

        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.footer}>
          <button className={styles.btnSecondary} onClick={onClose}>
            Cancel
          </button>
          {!canGenerate && <span className={styles.label}>Set the size to overlay a vector grid.</span>}
          <button className={styles.btnPrimary} onClick={handleGenerate} disabled={!canGenerate}>
            <Check size={14} /> Generate Calibration Grid
          </button>
        </div>
      </div>
    </div>
  );
};
