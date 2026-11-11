import React, { useState } from 'react';
import { Download, CheckCircle, FileCode, Box } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { useRenderStore } from '../../store/renderStore';
import { useUIStore } from '../../store/uiStore';
import { encodeBmpRgb24 } from '../../lib/bmp-encoder';
import { generateProductionSVG } from '../../lib/svg-export';
import { generateDXF } from '../../lib/dxf-export';
import { recipeFromDocument } from '../../lib/document';
import { exportResolution, fromMm, physicalSize } from '../../lib/document-size';
import styles from './Panels.module.css';

/**
 * Export of the prepared image, the trace and the heightmap. Size and DPI come
 * from the document; there is no DPI setting here. Raster export is
 * preview-sized until full-resolution export (#17), and writes the DPI that
 * gives the preview the document's physical size.
 */
export const ExportPanel: React.FC = () => {
  const doc = useDocumentStore((s) => s.doc);
  const source = useRenderStore((s) => s.source);
  const processedBuffer = useRenderStore((s) => s.processed);
  const depthHeightMapBuffer = useRenderStore((s) => s.depthHeightMap);
  const vectorResult = useRenderStore((s) => s.vectorResult);
  const setSizeDialogOpen = useUIStore((s) => s.setSizeDialogOpen);

  const [format, setFormat] = useState<'png' | 'bmp' | 'jpeg' | 'webp' | 'recipe'>('png');
  const [isExporting, setIsExporting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  if (!doc || !source || !processedBuffer) {
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

  const dims = source;
  const baseName = doc.source.name.replace(/\.[^/.]+$/, '');
  const size = physicalSize(doc);
  // What the file will carry: the preview's pixels at the DPI that keeps the document's size.
  const resolution = size ? exportResolution(doc, dims.width) : null;
  const vectorConfig = doc.vector;
  // Raster and heightmap files need a physical size; a recipe does not.
  const canExport = format === 'recipe' || resolution !== null;

  const exportBufferAsFile = (
    buffer: ArrayBuffer,
    width: number,
    height: number,
    fileName: string,
    outFormat: string
  ) => {
    if (outFormat === 'bmp') {
      const { dpi } = exportResolution(doc, width);
      const bmpBuf = encodeBmpRgb24(new Uint8ClampedArray(buffer), width, height, dpi);
      const blob = new Blob([bmpBuf], { type: 'image/bmp' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.bmp`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imgData = new ImageData(new Uint8ClampedArray(buffer), width, height);
        ctx.putImageData(imgData, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${fileName}.${outFormat}`;
            a.click();
            URL.revokeObjectURL(url);
          }
        }, `image/${outFormat}`);
      }
    }
  };

  const handleExecuteExport = () => {
    if (!canExport) return;
    setIsExporting(true);
    setIsDone(false);

    setTimeout(() => {
      if (format === 'recipe') {
        const recipe = recipeFromDocument(doc, `${baseName} recipe`);
        const json = JSON.stringify(recipe, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}-recipe.imgsuite`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // Export the processed image
        exportBufferAsFile(
          processedBuffer,
          dims.width,
          dims.height,
          `prepared-${baseName}`,
          format
        );
      }

      setIsExporting(false);
      setIsDone(true);
      setTimeout(() => setIsDone(false), 3000);
    }, 150);
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
          onChange={(e) => setFormat(e.target.value as typeof format)}
        >
          <option value="png">PNG (Lossless 8-bit)</option>
          <option value="bmp">BMP (Windows Bitmap CNC/Laser)</option>
          <option value="jpeg">JPEG (Standard Photo)</option>
          <option value="webp">WebP (Compressed)</option>
          <option value="recipe">Edit Recipe (.imgsuite JSON)</option>
        </select>
      </div>

      {/* Physical size, from the document */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Physical Size & Resolution</div>
        {size && resolution ? (
          <div className={styles.readoutBox}>
            <div className={styles.readoutRow}>
              <span>Width</span>
              <strong>
                {size.widthMm.toFixed(1)} mm ({fromMm(size.widthMm, 'in').toFixed(2)}")
              </strong>
            </div>
            <div className={styles.readoutRow}>
              <span>Height</span>
              <strong>
                {size.heightMm.toFixed(1)} mm ({fromMm(size.heightMm, 'in').toFixed(2)}")
              </strong>
            </div>
            <div className={styles.readoutRow}>
              <span>File</span>
              <strong>
                {dims.width} × {dims.height} px at {resolution.dpi.toFixed(1)} DPI
              </strong>
            </div>
            <div className={styles.controlNote}>
              Exports at preview resolution until full-resolution export (#17).
            </div>
          </div>
        ) : (
          <div className={styles.readoutBox}>
            <div className={styles.readoutRow}>
              <span>Size not set</span>
              <button className={styles.resetButton} onClick={() => setSizeDialogOpen(true)}>
                Set size…
              </button>
            </div>
            <div className={styles.controlNote}>Set the size to export images, heightmaps and vectors.</div>
          </div>
        )}
      </div>

      {/* Export Action */}
      <div className={styles.exportActionBlock}>
        <button
          className={styles.primaryActionBtn}
          onClick={handleExecuteExport}
          disabled={isExporting || !canExport}
        >
          {isDone ? (
            <>
              <CheckCircle size={16} color="#041019" /> Export Complete
            </>
          ) : (
            <>
              <Download size={16} />
              Export Prepared Output
            </>
          )}
        </button>
      </div>

      {/* Vector Production Files */}
      {vectorResult && (
        <div className={styles.section} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14, marginTop: 14 }}>
          <div className={styles.sectionTitle}>Vector Toolpaths (Laser / CNC)</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className={styles.primaryActionBtn}
              style={{ flex: 1, backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
              disabled={!resolution}
              onClick={() => {
                if (!resolution) return;
                const svgStr = generateProductionSVG(vectorResult, {
                  strokeWidth: vectorConfig.strokeWidth,
                  physicalUnits: 'mm',
                  dpi: resolution.dpi,
                });
                const blob = new Blob([svgStr], { type: 'image/svg+xml' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${baseName}-vectors.svg`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download size={14} /> Vector SVG
            </button>
            <button
              className={styles.primaryActionBtn}
              style={{ flex: 1, backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
              onClick={() => {
                const dxfStr = generateDXF(vectorResult);
                const blob = new Blob([dxfStr], { type: 'application/dxf' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${baseName}-vectors.dxf`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <FileCode size={14} /> Vector DXF
            </button>
          </div>
        </div>
      )}

      {/* 16-Bit Depth Relief Map */}
      {depthHeightMapBuffer && (
        <div className={styles.section} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14, marginTop: 14 }}>
          <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Box size={14} color="var(--accent-primary)" />
            <span>CNC 16-Bit Relief Heightmap</span>
          </div>
          <button
            className={styles.primaryActionBtn}
            style={{ marginTop: 8, width: '100%', backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
            disabled={!resolution}
            onClick={() => {
              exportBufferAsFile(
                depthHeightMapBuffer,
                dims.width,
                dims.height,
                `${baseName}-16bit-heightmap`,
                'png'
              );
            }}
          >
            <Download size={14} /> Download 16-Bit Heightmap (.PNG)
          </button>
        </div>
      )}
    </div>
  );
};
