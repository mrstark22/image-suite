import React, { useEffect, useReducer, useState } from 'react';
import { Maximize, Check } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { useUIStore } from '../../store/uiStore';
import { usePreferencesStore } from '../../store/preferencesStore';
import { setScale } from '../../lib/document';
import {
  cropRectOf,
  fromMm,
  mmPerPxFromDpi,
  MM_PER_INCH,
  type PhysicalUnit,
} from '../../lib/document-size';
import { canApplySize, sizeDraftReducer, type SizeField as Field } from '../../lib/size-draft';
import { describeSize } from '../../lib/reduced-open';
import { Button } from '../shared/Button';
import { Dialog } from '../shared/Dialog';
import { Select, type SelectOption } from '../shared/Select';
import { StatusMessage } from '../shared/StatusMessage';
import styles from './SizeDialog.module.css';

const UNIT_OPTIONS: SelectOption<PhysicalUnit>[] = [
  { value: 'mm', label: 'Millimetres (mm)' },
  { value: 'in', label: 'Inches (in)' },
];

function dpiOfScale(mmPerPx: number): number {
  return MM_PER_INCH / mmPerPx;
}

function rounded(value: number, unit: PhysicalUnit): string {
  return String(Number(value.toFixed(unit === 'mm' ? 1 : 3)));
}

/**
 * Sets the physical size of the image as currently cropped, by its width or
 * its height in mm or inches. That sets the document's scale (mm per source
 * pixel); the DPI is shown as derived from it. The file's own DPI is offered
 * as a suggestion. An image opens with a size already (the file's
 * resolution or an assumed one), so this dialog only opens when asked.
 */
export const SizeDialog: React.FC = () => {
  const isOpen = useUIStore((s) => s.isSizeDialogOpen);
  const setIsOpen = useUIStore((s) => s.setSizeDialogOpen);
  const doc = useDocumentStore((s) => s.doc);

  const [unit, setUnit] = useState<PhysicalUnit>('mm');
  // The scale the dialog will apply (starts at the document's) and the text being typed.
  const [{ pending, editing }, dispatch] = useReducer(sizeDraftReducer, { pending: null, editing: null });

  const docId = doc?.id;
  const docScale = doc?.mmPerPx ?? null;
  useEffect(() => {
    if (isOpen) dispatch({ type: 'open', scale: docScale });
  }, [isOpen, docId, docScale]);

  if (!isOpen || !doc) return null;

  const crop = cropRectOf(doc);
  const close = () => setIsOpen(false);

  const lengthText = (field: Field): string => {
    if (editing?.field === field) return editing.text;
    if (pending === null) return '';
    const px = field === 'width' ? crop.width : crop.height;
    return rounded(fromMm(px * pending, unit), unit);
  };

  /** Keeps the typed text and derives the scale from it; text that is not a positive number clears it. */
  const handleType = (field: Field, text: string) =>
    dispatch({ type: 'type', field, text, lengthPx: field === 'width' ? crop.width : crop.height, unit });

  const fileDpi = doc.source.fileDpi;
  const suggestion = fileDpi !== null ? mmPerPxFromDpi(fileDpi) : null;
  const canApply = canApplySize({ pending, editing }, doc.mmPerPx);

  const handleApply = () => {
    if (pending === null) return;
    useDocumentStore.getState().edit(setScale(pending));
    // The next image whose file states no resolution opens at this one.
    usePreferencesStore.getState().setLastAppliedDpi(MM_PER_INCH / pending);
    close();
  };

  return (
    <Dialog
      open
      onClose={close}
      icon={<Maximize size={16} />}
      title="Physical size"
      footer={
        <>
          <Button compact onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" compact icon={<Check size={14} />} onClick={handleApply} disabled={!canApply}>
            Apply
          </Button>
        </>
      }
    >
      {doc.mmPerPx === null && (
        <StatusMessage tone="warning">
          Size not set. Enter the width or height this image should have on the material. Sharpening, the adaptive
          threshold and export need it.
        </StatusMessage>
      )}
      {doc.mmPerPx !== null && doc.sizeOrigin === 'assumed' && (
        <StatusMessage tone="info">
          The file does not say how big it is, so {Number(dpiOfScale(doc.mmPerPx).toFixed(1))} DPI was assumed. Enter
          the width or height it should have on the material.
        </StatusMessage>
      )}

      <div className={styles.inputField}>
        <span className={styles.label}>Image{doc.steps.crop ? ' (cropped)' : ''}</span>
        <span className={styles.readout}>
          {crop.width} × {crop.height} px
        </span>
      </div>

      {doc.source.reducedFrom && (
        <StatusMessage tone="info">
          Opened at reduced size: {describeSize(doc.source)}. The file is {describeSize(doc.source.reducedFrom)}, too
          large to open in full.
        </StatusMessage>
      )}

      {fileDpi !== null && suggestion !== null && (
        <div className={styles.suggestion}>
          <span>
            File says {Number(fileDpi.toFixed(2))} DPI: {rounded(fromMm(crop.width * suggestion, unit), unit)} ×{' '}
            {rounded(fromMm(crop.height * suggestion, unit), unit)} {unit}
          </span>
          <Button compact onClick={() => dispatch({ type: 'suggest', scale: suggestion })}>
            Use this
          </Button>
        </div>
      )}

      <Select
        label="Unit"
        value={unit}
        options={UNIT_OPTIONS}
        onChange={(next) => {
          setUnit(next);
          dispatch({ type: 'stopEditing' });
        }}
      />

      <div className={styles.inputGrid}>
        {(['width', 'height'] as const).map((field) => (
          <label className={styles.inputField} key={field}>
            <span className={styles.label}>{field === 'width' ? 'Width' : 'Height'}</span>
            <div className={styles.inputWrapper}>
              <input
                type="number"
                min={0}
                className={styles.input}
                placeholder="not set"
                value={lengthText(field)}
                onChange={(e) => handleType(field, e.target.value)}
                onBlur={() => dispatch({ type: 'stopEditing' })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canApply) handleApply();
                }}
              />
              <span className={styles.unitLabel}>{unit}</span>
            </div>
          </label>
        ))}
      </div>

      <div className={styles.inputField}>
        <span className={styles.label}>Resolution</span>
        <span className={styles.readout}>
          {pending === null ? 'not set' : `${Number((MM_PER_INCH / pending).toFixed(2))} DPI`}
        </span>
      </div>
    </Dialog>
  );
};
