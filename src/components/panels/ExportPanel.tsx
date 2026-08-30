import React, { useState } from 'react';
import { Download, CheckCircle } from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { useEditStore } from '../../store/editStore';
import { encodeBmpRgb24 } from '../../lib/bmp-encoder';
import styles from './Panels.module.css';

export const ExportPanel: React.FC = () => {
  const metadata = useImageStore((s) => s.metadata);
  const processedBuffer = useImageStore((s) => s.previewProcessedBuffer);
  const dims = useImageStore((s) => s.previewDimensions);
  const getExportRecipe = useEditStore((s) => s.getExportRecipe);

  const [format, setFormat] = useState<'png' | 'bmp' | 'jpeg' | 'webp' | 'recipe'>('png');
  const [dpi, setDpi] = useState<number>(300);
  const [isExporting, setIsExporting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  if (!metadata || !dims || !processedBuffer) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>Export Engine</span>
        </div>
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          Please load an image to configure export.
        </div>
      </div>
    );
  }

  // Calculate physical dimensions in mm and inches
  const widthMm = ((metadata.width / dpi) * 25.4).toFixed(1);
  const heightMm = ((metadata.height / dpi) * 25.4).toFixed(1);
  const widthIn = (metadata.width / dpi).toFixed(2);
  const heightIn = (metadata.height / dpi).toFixed(2);

  const handleExecuteExport = () => {
    setIsExporting(true);
    setIsDone(false);

    setTimeout(() => {
      if (format === 'recipe') {
        const recipe = getExportRecipe();
        const json = JSON.stringify(recipe, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${metadata.name.replace(/\.[^/.]+$/, '')}-recipe.imgsuite`;
        a.click();
        URL.revokeObjectURL(url);
      } else if (format === 'bmp') {
        const bmpBuf = encodeBmpRgb24(new Uint8ClampedArray(processedBuffer), dims.width, dims.height, dpi);
        const blob = new Blob([bmpBuf], { type: 'image/bmp' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `prepared-${metadata.name.replace(/\.[^/.]+$/, '')}.bmp`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // Draw into canvas and export
        const canvas = document.createElement('canvas');
        canvas.width = dims.width;
        canvas.height = dims.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const imgData = new ImageData(
            new Uint8ClampedArray(processedBuffer),
            dims.width,
            dims.height
          );
          ctx.putImageData(imgData, 0, 0);

          canvas.toBlob((blob) => {
            if (blob) {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `prepared-${metadata.name.replace(/\.[^/.]+$/, '')}.${format}`;
              a.click();
              URL.revokeObjectURL(url);
            }
          }, `image/${format}`);
        }
      }

      setIsExporting(false);
      setIsDone(true);
      setTimeout(() => setIsDone(false), 3000);
    }, 200);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Export Engine</span>
      </div>

      {/* Output Format */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Format</div>
        <select
          className={styles.select}
          value={format}
          onChange={(e) => setFormat(e.target.value as any)}
        >
          <option value="png">PNG (Lossless 8-bit)</option>
          <option value="bmp">BMP (Windows Bitmap CNC/Laser)</option>
          <option value="jpeg">JPEG (Standard Photo)</option>
          <option value="webp">WebP (Compressed)</option>
          <option value="recipe">Edit Recipe (.imgsuite JSON)</option>
        </select>
      </div>

      {/* Physical Manufacturing Sizing */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Physical Sizing & Resolution</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>DPI (DPI / PPI)</label>
            <input
              type="number"
              value={dpi}
              onChange={(e) => setDpi(Math.max(72, parseInt(e.target.value) || 300))}
              style={{ width: '100%', marginTop: 2 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Preset DPI</label>
            <select
              style={{ width: '100%', marginTop: 2 }}
              value={dpi}
              onChange={(e) => setDpi(parseInt(e.target.value))}
            >
              <option value="254">254 DPI (0.1mm Laser Spot)</option>
              <option value="300">300 DPI (Standard Print)</option>
              <option value="508">508 DPI (0.05mm High Res)</option>
              <option value="1000">1000 DPI (Fiber Laser Micro)</option>
            </select>
          </div>
        </div>

        <div
          style={{
            background: 'var(--bg-input)',
            padding: '10px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            fontSize: 11,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>Output Width:</span>
            <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
              {widthMm} mm ({widthIn}")
            </strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>Output Height:</span>
            <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
              {heightMm} mm ({heightIn}")
            </strong>
          </div>
        </div>
      </div>

      {/* Export Action */}
      <div className={styles.exportActionBlock}>
        <button
          className={styles.primaryActionBtn}
          onClick={handleExecuteExport}
          disabled={isExporting}
        >
          {isDone ? (
            <>
              <CheckCircle size={16} color="#041019" /> Export Complete
            </>
          ) : (
            <>
              <Download size={16} /> Export Prepared File
            </>
          )}
        </button>
      </div>
    </div>
  );
};
