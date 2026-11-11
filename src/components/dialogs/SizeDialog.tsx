import React, { useEffect, useState } from 'react';
import { Maximize, X, Check } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { useUIStore } from '../../store/uiStore';
import { setScale } from '../../lib/document';
import {
  cropRectOf,
  fromMm,
  mmPerPxForLength,
  mmPerPxFromDpi,
  MM_PER_INCH,
  type PhysicalUnit,
} from '../../lib/document-size';
import styles from './SizeDialog.module.css';

type Field = 'width' | 'height';

function rounded(value: number, unit: PhysicalUnit): string {
  return String(Number(value.toFixed(unit === 'mm' ? 1 : 3)));
}

/**
 * Sets the physical size of the image as currently cropped, by its width or
 * its height in mm or inches. That sets the document's scale (mm per source
 * pixel); the DPI is shown as derived from it. The file's own DPI is offered
 * as a suggestion only. Opens by itself when an image is loaded, since the
 * size starts as not set.
 */
export const SizeDialog: React.FC = () => {
  const isOpen = useUIStore((s) => s.isSizeDialogOpen);
  const setIsOpen = useUIStore((s) => s.setSizeDialogOpen);
  const doc = useDocumentStore((s) => s.doc);

  const [unit, setUnit] = useState<PhysicalUnit>('mm');
  // The scale the dialog will apply; starts at the document's.
  const [pending, setPending] = useState<number | null>(null);
  // Text of the field being typed in, so it can be empty or partial mid-edit.
  const [editing, setEditing] = useState<{ field: Field; text: string } | null>(null);

  const docId = doc?.id;
  const docScale = doc?.mmPerPx ?? null;
  useEffect(() => {
    if (isOpen) {
      setPending(docScale);
      setEditing(null);
    }
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

  /** Keeps the typed text and, when it is a positive number, derives the scale from it. */
  const handleType = (field: Field, text: string) => {
    setEditing({ field, text });
    const value = Number(text);
    if (text.trim() === '' || !Number.isFinite(value) || value <= 0) return;
    setPending(mmPerPxForLength(field === 'width' ? crop.width : crop.height, value, unit));
  };

  const fileDpi = doc.source.fileDpi;
  const suggestion = fileDpi !== null ? mmPerPxFromDpi(fileDpi) : null;
  const canApply = pending !== null && pending !== doc.mmPerPx;

  const handleApply = () => {
    if (pending === null) return;
    useDocumentStore.getState().edit(setScale(pending));
    close();
  };

  return (
    <div className={styles.backdrop} onClick={close}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="size-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.title} id="size-dialog-title">
            <Maximize size={16} color="var(--accent-primary)" />
            Physical size
          </div>
          <button className={styles.closeBtn} onClick={close} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className={styles.content}>
          {doc.mmPerPx === null && (
            <p className={styles.notice}>
              Size not set. Enter the width or height this image should have on the material. Sharpening, the
              adaptive threshold and export need it.
            </p>
          )}

          <div className={styles.inputField}>
            <span className={styles.label}>Image{doc.steps.crop ? ' (cropped)' : ''}</span>
            <span className={styles.readout}>
              {crop.width} × {crop.height} px
            </span>
          </div>

          {fileDpi !== null && suggestion !== null && (
            <div className={styles.suggestion}>
              <span>
                File says {Number(fileDpi.toFixed(2))} DPI: {rounded(fromMm(crop.width * suggestion, unit), unit)} ×{' '}
                {rounded(fromMm(crop.height * suggestion, unit), unit)} {unit}
              </span>
              <button
                className={styles.suggestionBtn}
                onClick={() => {
                  setPending(suggestion);
                  setEditing(null);
                }}
              >
                Use this
              </button>
            </div>
          )}

          <div className={styles.unitRow}>
            <span className={styles.label}>Unit</span>
            <select
              className={styles.unitSelect}
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value as PhysicalUnit);
                setEditing(null);
              }}
            >
              <option value="mm">Millimetres (mm)</option>
              <option value="in">Inches (in)</option>
            </select>
          </div>

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
                    onBlur={() => setEditing(null)}
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
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={close}>
            Cancel
          </button>
          <button className={styles.applyBtn} onClick={handleApply} disabled={!canApply}>
            <Check size={14} /> Apply
          </button>
        </div>
      </div>
    </div>
  );
};
