import React, { useState } from 'react';
import { Grid, X, Check } from 'lucide-react';
import { openLoadedImage, hasUnsavedEdits, confirmReplaceInBrowser } from '../../lib/open-image';
import { useEditStore } from '../../store/editStore';
import { useImageStore } from '../../store/imageStore';
import { useUIStore } from '../../store/uiStore';
import { generateTestGridRaster, generateTestGridVector } from '../../lib/test-grid-generator';
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

  const metadata = useImageStore((s) => s.metadata);
  const addVectorLayer = useEditStore((s) => s.addVectorLayer);
  const toggleVectorOverlay = useUIStore((s) => s.toggleVectorOverlay);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    const dpi = metadata?.dpi || 300;

    if (targetMode === 'vector') {
      const vectorLayer = generateTestGridVector({
        rows,
        cols,
        boxSizeMm,
        gapMm,
        dpi,
        type,
      });
      addVectorLayer(vectorLayer);
      toggleVectorOverlay();
    } else {
      if (hasUnsavedEdits() && !confirmReplaceInBrowser()) return;
      const { buffer, width, height } = generateTestGridRaster({
        rows,
        cols,
        boxSizeMm,
        gapMm,
        dpi,
        type,
      });

      const blob = new Blob([buffer], { type: 'image/png' });
      const file = new File([blob], `material-test-grid-${type}.png`, { type: 'image/png' });
      const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(buffer), width, height));

      openLoadedImage({
        file,
        originalBuffer: buffer,
        bitmap,
        metadata: {
          name: `Test Grid (${type === 'power-matrix' ? 'Power/Speed' : 'Steps'})`,
          width,
          height,
          dpi,
          aspectRatio: width / height,
          originalSizeBytes: buffer.byteLength,
          format: 'png',
          hasAlpha: false,
        },
        previewBuffer: buffer,
        previewDims: { width, height, scale: 1.0 },
      });
    }

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
              onChange={(e) => setType(e.target.value as any)}
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

        <div className={styles.footer}>
          <button className={styles.btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button className={styles.btnPrimary} onClick={handleGenerate}>
            <Check size={14} /> Generate Calibration Grid
          </button>
        </div>
      </div>
    </div>
  );
};
