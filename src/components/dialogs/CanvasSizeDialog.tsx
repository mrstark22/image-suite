import React, { useState, useEffect } from 'react';
import { Maximize, X, Check } from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { useEditStore } from '../../store/editStore';
import { useUIStore } from '../../store/uiStore';
import { shownFileSize, pxToLength, dpiForLength, type PhysicalUnit } from '../../lib/image-size';
import styles from './CanvasSizeDialog.module.css';

/**
 * Sets the image's resolution, either directly as DPI or as the physical width
 * or height it should print at. The pixels are not changed: a physical size
 * and a DPI are two views of the same setting.
 */
export const CanvasSizeDialog: React.FC = () => {
  const isOpen = useUIStore((s) => s.isCanvasSizeDialogOpen);
  const setIsOpen = useUIStore((s) => s.setCanvasSizeDialogOpen);

  const wholePreview = useImageStore((s) => s.sourcePreviewDimensions);
  const metadata = useImageStore((s) => s.metadata);
  const crop = useEditStore((s) => s.geometry.cropRect);
  const setStoreDpi = useImageStore((s) => s.setDpi);

  const [unit, setUnit] = useState<PhysicalUnit>('mm');
  const [dpi, setDpi] = useState<number>(300);
  // Text of the field being typed in, so it can be empty or partial mid-edit.
  const [editing, setEditing] = useState<{ field: 'width' | 'height' | 'dpi'; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDpi(metadata?.dpi || 300);
      setEditing(null);
    }
  }, [metadata, isOpen]);

  if (!isOpen || !wholePreview || !metadata) return null;

  // The DPI refers to the file's pixels, so sizes are computed from the file's
  // pixel count for the current crop, not from the downscaled preview.
  const dims = shownFileSize(metadata, wholePreview, crop);

  const widthValue = Number(pxToLength(dims.width, dpi, unit).toFixed(unit === 'mm' ? 1 : 3));
  const heightValue = Number(pxToLength(dims.height, dpi, unit).toFixed(unit === 'mm' ? 1 : 3));
  const isValid = Number.isFinite(dpi) && dpi > 0;

  const shown = (field: 'width' | 'height' | 'dpi', value: number) =>
    editing?.field === field ? editing.text : String(value);

  /** Keeps the typed text and, when it is a positive number, updates the DPI from it. */
  const handleType = (field: 'width' | 'height' | 'dpi', text: string) => {
    setEditing({ field, text });
    const value = Number(text);
    if (text.trim() === '' || !Number.isFinite(value) || value <= 0) return;
    if (field === 'width') setDpi(dpiForLength(dims.width, value, unit));
    else if (field === 'height') setDpi(dpiForLength(dims.height, value, unit));
    else setDpi(value);
  };

  const handleSave = () => {
    if (!isValid) return;
    setStoreDpi(dpi);
    setIsOpen(false);
  };

  return (
    <div className={styles.backdrop} onClick={() => setIsOpen(false)}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>
            <Maximize size={16} color="var(--accent-primary)" />
            Physical Size & Resolution
          </div>
          <button className={styles.closeBtn} onClick={() => setIsOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.inputField}>
            <span className={styles.label}>Image</span>
            <span className={styles.readout}>
              {dims.width} × {dims.height} px
            </span>
          </div>

          <div className={styles.unitRow}>
            <span className={styles.label}>Unit</span>
            <select
              className={styles.unitSelect}
              value={unit}
              onChange={(e) => setUnit(e.target.value as PhysicalUnit)}
            >
              <option value="mm">Millimetres (mm)</option>
              <option value="in">Inches (in)</option>
            </select>
          </div>

          <div className={styles.inputGrid}>
            <div className={styles.inputField}>
              <span className={styles.label}>Width</span>
              <div className={styles.inputWrapper}>
                <input
                  type="number"
                  className={styles.input}
                  value={shown('width', widthValue)}
                  onChange={(e) => handleType('width', e.target.value)}
                  onBlur={() => setEditing(null)}
                />
                <span className={styles.unitLabel}>{unit}</span>
              </div>
            </div>

            <div className={styles.inputField}>
              <span className={styles.label}>Height</span>
              <div className={styles.inputWrapper}>
                <input
                  type="number"
                  className={styles.input}
                  value={shown('height', heightValue)}
                  onChange={(e) => handleType('height', e.target.value)}
                  onBlur={() => setEditing(null)}
                />
                <span className={styles.unitLabel}>{unit}</span>
              </div>
            </div>
          </div>

          <div className={styles.inputField}>
            <span className={styles.label}>Resolution (DPI)</span>
            <div className={styles.inputWrapper}>
              <input
                type="number"
                className={styles.input}
                value={shown('dpi', Number(dpi.toFixed(2)))}
                onChange={(e) => handleType('dpi', e.target.value)}
                onBlur={() => setEditing(null)}
              />
              <span className={styles.unitLabel}>DPI</span>
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={() => setIsOpen(false)}>
            Cancel
          </button>
          <button className={styles.applyBtn} onClick={handleSave} disabled={!isValid}>
            <Check size={14} /> Apply
          </button>
        </div>
      </div>
    </div>
  );
};
