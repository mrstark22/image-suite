import React, { useState, useEffect } from 'react';
import { Maximize, Link, Unlink, X, Check } from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { useLayerStore } from '../../store/layerStore';
import { useUIStore } from '../../store/uiStore';
import styles from './CanvasSizeDialog.module.css';

export const CanvasSizeDialog: React.FC = () => {
  const isOpen = useUIStore((s) => s.isCanvasSizeDialogOpen);
  const setIsOpen = useUIStore((s) => s.setCanvasSizeDialogOpen);

  const dims = useImageStore((s) => s.previewDimensions);
  const metadata = useImageStore((s) => s.metadata);
  const setCanvasDimensions = useLayerStore((s) => s.setCanvasDimensions);

  const [unit, setUnit] = useState<'px' | 'mm' | 'in'>('px');
  const [width, setWidth] = useState<number>(1024);
  const [height, setHeight] = useState<number>(1024);
  const [dpi, setDpi] = useState<number>(300);
  const [constrainAspect, setConstrainAspect] = useState<boolean>(true);
  const [resizeMode, setResizeMode] = useState<'canvas-resize' | 'image-scale'>('canvas-resize');

  // Initialize values from current canvas state
  useEffect(() => {
    if (dims && isOpen) {
      setWidth(dims.width);
      setHeight(dims.height);
      setDpi(metadata?.dpi || 300);
    }
  }, [dims, metadata, isOpen]);

  if (!isOpen) return null;

  const currentW = dims?.width || 1024;
  const currentH = dims?.height || 1024;
  const aspectRatio = currentW / currentH;

  const handleWidthChange = (val: number) => {
    setWidth(val);
    if (constrainAspect) {
      setHeight(Math.round(val / aspectRatio));
    }
  };

  const handleHeightChange = (val: number) => {
    setHeight(val);
    if (constrainAspect) {
      setWidth(Math.round(val * aspectRatio));
    }
  };

  const handleApplyPreset = (w: number, h: number, d = 300) => {
    setWidth(w);
    setHeight(h);
    setDpi(d);
  };

  const handleSave = async () => {
    let finalW = width;
    let finalH = height;

    if (unit === 'mm') {
      finalW = Math.round((width / 25.4) * dpi);
      finalH = Math.round((height / 25.4) * dpi);
    } else if (unit === 'in') {
      finalW = Math.round(width * dpi);
      finalH = Math.round(height * dpi);
    }

    finalW = Math.max(16, Math.min(16384, finalW));
    finalH = Math.max(16, Math.min(16384, finalH));

    await setCanvasDimensions(finalW, finalH, dpi, resizeMode);
    setIsOpen(false);
  };

  return (
    <div className={styles.backdrop} onClick={() => setIsOpen(false)}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.title}>
            <Maximize size={16} color="var(--accent-primary)" />
            Canvas Size & Resolution
          </div>
          <button className={styles.closeBtn} onClick={() => setIsOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.content}>
          {/* Quick Presets */}
          <div>
            <span className={styles.label}>Quick Presets</span>
            <div className={styles.presetBar} style={{ marginTop: 4 }}>
              <button
                type="button"
                className={styles.presetChip}
                onClick={() => handleApplyPreset(1024, 1024, 300)}
              >
                1024×1024 px
              </button>
              <button
                type="button"
                className={styles.presetChip}
                onClick={() => handleApplyPreset(2048, 2048, 300)}
              >
                2048×2048 px (2K)
              </button>
              <button
                type="button"
                className={styles.presetChip}
                onClick={() => handleApplyPreset(4000, 4000, 254)}
              >
                400×400 mm (Laser Bed)
              </button>
              <button
                type="button"
                className={styles.presetChip}
                onClick={() => handleApplyPreset(6000, 4000, 254)}
              >
                600×400 mm (Laser Bed)
              </button>
              <button
                type="button"
                className={styles.presetChip}
                onClick={() => handleApplyPreset(2480, 3508, 300)}
              >
                A4 (300 DPI)
              </button>
            </div>
          </div>

          {/* Units Selector */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className={styles.label}>Unit System</span>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as any)}
              style={{
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-sm)',
                padding: '3px 8px',
                fontSize: 11,
              }}
            >
              <option value="px">Pixels (px)</option>
              <option value="mm">Millimeters (mm)</option>
              <option value="in">Inches (in)</option>
            </select>
          </div>

          {/* Width / Height Grid */}
          <div className={styles.inputGrid}>
            <div className={styles.inputField}>
              <span className={styles.label}>Width</span>
              <div className={styles.inputWrapper}>
                <input
                  type="number"
                  className={styles.input}
                  value={width}
                  onChange={(e) => handleWidthChange(Number(e.target.value))}
                />
                <span className={styles.unitLabel}>{unit}</span>
              </div>
            </div>

            <button
              type="button"
              className={`${styles.lockBtn} ${constrainAspect ? styles.lockBtnActive : ''}`}
              onClick={() => setConstrainAspect(!constrainAspect)}
              title={constrainAspect ? 'Aspect Ratio Locked' : 'Aspect Ratio Unlocked'}
            >
              {constrainAspect ? <Link size={14} /> : <Unlink size={14} />}
            </button>

            <div className={styles.inputField}>
              <span className={styles.label}>Height</span>
              <div className={styles.inputWrapper}>
                <input
                  type="number"
                  className={styles.input}
                  value={height}
                  onChange={(e) => handleHeightChange(Number(e.target.value))}
                />
                <span className={styles.unitLabel}>{unit}</span>
              </div>
            </div>
          </div>

          {/* Resolution / DPI */}
          <div className={styles.inputField}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className={styles.label}>Resolution (DPI / PPI)</span>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                Laser spot: {(25.4 / dpi).toFixed(3)} mm
              </span>
            </div>
            <div className={styles.inputWrapper}>
              <input
                type="number"
                className={styles.input}
                value={dpi}
                onChange={(e) => setDpi(Math.max(1, Number(e.target.value)))}
              />
              <span className={styles.unitLabel}>DPI</span>
            </div>
          </div>

          {/* Resize Method */}
          <div>
            <span className={styles.label}>Resize Method</span>
            <div className={styles.modeSelect}>
              <div
                className={`${styles.modeOption} ${
                  resizeMode === 'canvas-resize' ? styles.modeOptionActive : ''
                }`}
                onClick={() => setResizeMode('canvas-resize')}
              >
                <span className={styles.modeTitle}>Canvas Extension</span>
                <span className={styles.modeDesc}>
                  Expand/trim canvas borders without resizing layers
                </span>
              </div>
              <div
                className={`${styles.modeOption} ${
                  resizeMode === 'image-scale' ? styles.modeOptionActive : ''
                }`}
                onClick={() => setResizeMode('image-scale')}
              >
                <span className={styles.modeTitle}>Scale Image</span>
                <span className={styles.modeDesc}>
                  Proportionally resize and resample all layers
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={() => setIsOpen(false)}>
            Cancel
          </button>
          <button className={styles.applyBtn} onClick={handleSave}>
            <Check size={14} /> Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
};
