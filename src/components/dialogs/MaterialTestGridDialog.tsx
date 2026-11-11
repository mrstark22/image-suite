import React, { useEffect, useReducer, useState } from 'react';
import { Grid, X, Check } from 'lucide-react';
import { confirmReplaceInBrowser } from '../../lib/open-image';
import { useDocumentStore, hasUnsavedEdits } from '../../store/documentStore';
import { previewDpi, useRenderStore } from '../../store/renderStore';
import { useUIStore } from '../../store/uiStore';
import { generateTestGridVector } from '../../lib/test-grid-generator';
import { openTestGridRaster } from '../../lib/test-grid-document';
import {
  INITIAL_GRID_FORM,
  GRID_FIELD_LIMITS,
  committedGridValues,
  fieldText,
  gridFormReducer,
  type GridField,
} from '../../lib/test-grid-form';
import styles from './MaterialTestGridDialog.module.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const MaterialTestGridDialog: React.FC<Props> = ({ isOpen, onClose }) => {
  const [type, setType] = useState<'grayscale-step' | 'power-matrix'>('power-matrix');
  // Typed text is kept until it is committed (blur, Enter or Generate), so
  // a clamp cannot replace the first digit before the second is typed.
  const [form, dispatch] = useReducer(gridFormReducer, INITIAL_GRID_FORM);
  const [targetMode, setTargetMode] = useState<'raster' | 'vector'>('raster');
  const [error, setError] = useState<string | null>(null);

  const doc = useDocumentStore((s) => s.doc);
  const addVectorLayer = useRenderStore((s) => s.addVectorLayer);
  const toggleVectorOverlay = useUIStore((s) => s.toggleVectorOverlay);

  // A refused grid's message and half-typed text do not survive closing the dialog.
  useEffect(() => {
    if (!isOpen) {
      setError(null);
      dispatch({ type: 'discardDrafts' });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  /** Props for one of the dialog's number fields. */
  const numberField = (field: GridField, step: number) => ({
    type: 'number',
    className: styles.input,
    value: fieldText(form, field),
    min: GRID_FIELD_LIMITS[field].min,
    max: GRID_FIELD_LIMITS[field].max,
    step,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setError(null);
      dispatch({ type: 'type', field, text: e.target.value });
    },
    onBlur: () => dispatch({ type: 'commit', field }),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') dispatch({ type: 'commit', field });
    },
  });

  // The vector grid is drawn over the preview, so it needs the preview's
  // resolution, which needs the size.
  const vectorDpi = doc ? previewDpi() : null;
  const canGenerate = targetMode === 'raster' || vectorDpi !== null;

  const handleGenerate = async () => {
    const { rows, cols, boxSizeMm, gapMm, dpi: gridDpi } = committedGridValues(form);
    for (const field of Object.keys(form.drafts) as GridField[]) dispatch({ type: 'commit', field });
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
              onChange={(e) => {
                setError(null);
                setType(e.target.value as typeof type);
              }}
            >
              <option value="power-matrix">Power vs. Speed Matrix (Laser / CNC Substrate Calibration)</option>
              <option value="grayscale-step">Grayscale Step Wedge (0% to 100% Black Density)</option>
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Rows (Power / Steps)</label>
              <input {...numberField('rows', 1)} />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Columns (Speed / Steps)</label>
              <input {...numberField('cols', 1)} />
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Box Size (mm)</label>
              <input {...numberField('boxSizeMm', 0.5)} />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Spacing Gap (mm)</label>
              <input {...numberField('gapMm', 0.5)} />
            </div>
          </div>

          {targetMode === 'raster' && (
            <div className={styles.formGroup}>
              <label className={styles.label}>Grid Resolution (DPI)</label>
              <input {...numberField('dpi', 1)} />
            </div>
          )}

          <div className={styles.formGroup}>
            <label className={styles.label}>Output Format</label>
            <select
              className={styles.select}
              value={targetMode}
              onChange={(e) => {
                setError(null);
                setTargetMode(e.target.value as typeof targetMode);
              }}
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
