import React, { useState } from 'react';
import { Type, X, Check, AlignLeft, AlignCenter, AlignRight, Italic } from 'lucide-react';
import { useLayerStore } from '../../store/layerStore';
import { useImageStore } from '../../store/imageStore';
import {
  AVAILABLE_FONTS,
  DEFAULT_TEXT_CONFIG,
  type TextLayerConfig,
} from '../../lib/text-layer';
import { Slider } from '../shared/Slider';
import styles from './TextLayerDialog.module.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const TextLayerDialog: React.FC<Props> = ({ isOpen, onClose }) => {
  const metadata = useImageStore((s) => s.metadata);
  const createTextLayer = useLayerStore((s) => s.createTextLayer);

  const [config, setConfig] = useState<TextLayerConfig>({
    ...DEFAULT_TEXT_CONFIG,
    dpi: metadata?.dpi || 300,
  });

  if (!isOpen) return null;

  const handleAddText = async () => {
    if (!config.text.trim()) return;
    await createTextLayer({
      ...config,
      dpi: metadata?.dpi || 300,
    });
    onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>
            <Type size={16} color="var(--accent-primary)" />
            <span>Add Typography / Monogram Layer</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          {/* Live Preview Box */}
          <div className={styles.previewBox}>
            <span
              style={{
                fontFamily: config.fontFamily,
                fontSize: Math.min(48, Math.max(16, config.fontSize * 0.5)),
                fontWeight: config.fontWeight,
                fontStyle: config.fontStyle,
                color: config.isOutline ? 'transparent' : config.color,
                WebkitTextStroke: config.isOutline ? `${config.outlineWidth}px ${config.color}` : 'none',
                textAlign: config.textAlign,
                whiteSpace: 'pre-wrap',
                lineHeight: 1.2,
              }}
            >
              {config.text || 'Preview Text'}
            </span>
          </div>

          {/* Text Input */}
          <div className={styles.formGroup}>
            <label className={styles.label}>Text Content (Names, Dates, Monograms, Quotes)</label>
            <textarea
              className={styles.textarea}
              value={config.text}
              placeholder="Enter text to engrave or cut..."
              onChange={(e) => setConfig({ ...config, text: e.target.value })}
            />
          </div>

          {/* Font Family & Weight */}
          <div className={styles.row}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Font Family</label>
              <select
                className={styles.select}
                value={config.fontFamily}
                onChange={(e) => setConfig({ ...config, fontFamily: e.target.value })}
              >
                {AVAILABLE_FONTS.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Weight</label>
              <select
                className={styles.select}
                value={config.fontWeight}
                onChange={(e) => setConfig({ ...config, fontWeight: e.target.value as any })}
              >
                <option value="300">Light (300)</option>
                <option value="400">Regular (400)</option>
                <option value="600">SemiBold (600)</option>
                <option value="700">Bold (700)</option>
                <option value="900">Black / Heavy (900)</option>
              </select>
            </div>
          </div>

          {/* Font Size & Alignment */}
          <div className={styles.row}>
            <Slider
              label="Font Size"
              value={config.fontSize}
              min={14}
              max={250}
              step={2}
              unit="px"
              onChange={(v) => setConfig({ ...config, fontSize: v })}
            />

            <div className={styles.formGroup}>
              <label className={styles.label}>Alignment & Style</label>
              <div className={styles.segmentedGroup}>
                <button
                  className={`${styles.segmentedBtn} ${config.textAlign === 'left' ? styles.segmentedBtnActive : ''}`}
                  onClick={() => setConfig({ ...config, textAlign: 'left' })}
                  title="Align Left"
                >
                  <AlignLeft size={12} />
                </button>
                <button
                  className={`${styles.segmentedBtn} ${config.textAlign === 'center' ? styles.segmentedBtnActive : ''}`}
                  onClick={() => setConfig({ ...config, textAlign: 'center' })}
                  title="Align Center"
                >
                  <AlignCenter size={12} />
                </button>
                <button
                  className={`${styles.segmentedBtn} ${config.textAlign === 'right' ? styles.segmentedBtnActive : ''}`}
                  onClick={() => setConfig({ ...config, textAlign: 'right' })}
                  title="Align Right"
                >
                  <AlignRight size={12} />
                </button>
                <button
                  className={`${styles.segmentedBtn} ${config.fontStyle === 'italic' ? styles.segmentedBtnActive : ''}`}
                  onClick={() =>
                    setConfig({
                      ...config,
                      fontStyle: config.fontStyle === 'italic' ? 'normal' : 'italic',
                    })
                  }
                  title="Toggle Italic"
                >
                  <Italic size={12} />
                </button>
              </div>
            </div>
          </div>

          {/* Color & Outline Mode */}
          <div className={styles.row}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Fill / Stroke Color</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="color"
                  value={config.color}
                  onChange={(e) => setConfig({ ...config, color: e.target.value })}
                  style={{ width: 36, height: 32, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                />
                <input
                  type="text"
                  className={styles.input}
                  value={config.color}
                  onChange={(e) => setConfig({ ...config, color: e.target.value })}
                  style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Render Mode</label>
              <select
                className={styles.select}
                value={config.isOutline ? 'outline' : 'fill'}
                onChange={(e) => setConfig({ ...config, isOutline: e.target.value === 'outline' })}
              >
                <option value="fill">Filled Text (Engraving / Print)</option>
                <option value="outline">Hollow Outline (Stencil / Cut)</option>
              </select>
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button className={styles.btnPrimary} onClick={handleAddText}>
            <Check size={14} /> Add Text Layer
          </button>
        </div>
      </div>
    </div>
  );
};
