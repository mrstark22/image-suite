import React, { useEffect, useId, useReducer, useState } from 'react';
import { Grid, Check } from 'lucide-react';
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
import { Button } from '../shared/Button';
import { Dialog } from '../shared/Dialog';
import { Select, type SelectOption } from '../shared/Select';
import { StatusMessage } from '../shared/StatusMessage';
import styles from './MaterialTestGridDialog.module.css';

type GridType = 'grayscale-step' | 'power-matrix';
type TargetMode = 'raster' | 'vector';

const TYPE_OPTIONS: SelectOption<GridType>[] = [
  { value: 'power-matrix', label: 'Power vs. Speed Matrix (Laser / CNC Substrate Calibration)' },
  { value: 'grayscale-step', label: 'Grayscale Step Wedge (0% to 100% Black Density)' },
];

const TARGET_OPTIONS: SelectOption<TargetMode>[] = [
  { value: 'raster', label: 'Open as Image, Replacing the Current One (Grayscale Burn Levels)' },
  { value: 'vector', label: 'Vector Cut Grid Overlay (Red #FF0000 Paths)' },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/** Generates a material test grid, opened as the image or drawn over it as vectors. */
export const MaterialTestGridDialog: React.FC<Props> = ({ isOpen, onClose }) => {
  const [type, setType] = useState<GridType>('power-matrix');
  // Typed text is kept until it is committed (blur, Enter or Generate), so
  // a clamp cannot replace the first digit before the second is typed.
  const [form, dispatch] = useReducer(gridFormReducer, INITIAL_GRID_FORM);
  const [targetMode, setTargetMode] = useState<TargetMode>('raster');
  const idPrefix = useId();
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
    id: `${idPrefix}-${field}`,
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
    <Dialog
      open
      onClose={onClose}
      icon={<Grid size={16} />}
      title="Generate Material Test Grid Matrix"
      footer={
        <>
          {!canGenerate && <span className={styles.footerNote}>Set the size to overlay a vector grid.</span>}
          <Button compact onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" compact icon={<Check size={14} />} onClick={handleGenerate} disabled={!canGenerate}>
            Generate Calibration Grid
          </Button>
        </>
      }
    >
      <Select
        label="Grid Test Pattern"
        value={type}
        options={TYPE_OPTIONS}
        onChange={(next) => {
          setError(null);
          setType(next);
        }}
      />

      <div className={styles.row}>
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor={`${idPrefix}-rows`}>
            Rows (Power / Steps)
          </label>
          <input {...numberField('rows', 1)} />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor={`${idPrefix}-cols`}>
            Columns (Speed / Steps)
          </label>
          <input {...numberField('cols', 1)} />
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor={`${idPrefix}-boxSizeMm`}>
            Box Size (mm)
          </label>
          <input {...numberField('boxSizeMm', 0.5)} />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor={`${idPrefix}-gapMm`}>
            Spacing Gap (mm)
          </label>
          <input {...numberField('gapMm', 0.5)} />
        </div>
      </div>

      {targetMode === 'raster' && (
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor={`${idPrefix}-dpi`}>
            Grid Resolution (DPI)
          </label>
          <input {...numberField('dpi', 1)} />
        </div>
      )}

      <Select
        label="Output Format"
        value={targetMode}
        options={TARGET_OPTIONS}
        onChange={(next) => {
          setError(null);
          setTargetMode(next);
        }}
      />

      {error && <StatusMessage tone="error">{error}</StatusMessage>}
    </Dialog>
  );
};
