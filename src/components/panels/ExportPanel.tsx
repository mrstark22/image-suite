import React, { useState } from 'react';
import { Download, CheckCircle, Layers, FileCode, Box } from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { useEditStore } from '../../store/editStore';
import { useLayerStore } from '../../store/layerStore';
import { encodeBmpRgb24 } from '../../lib/bmp-encoder';
import { generateProductionSVG } from '../../lib/svg-export';
import { generateDXF } from '../../lib/dxf-export';
import styles from './Panels.module.css';

export const ExportPanel: React.FC = () => {
  const metadata = useImageStore((s) => s.metadata);
  const processedBuffer = useImageStore((s) => s.previewProcessedBuffer);
  const depthHeightMapBuffer = useImageStore((s) => s.depthHeightMapBuffer);
  const dims = useImageStore((s) => s.previewDimensions);
  const getExportRecipe = useEditStore((s) => s.getExportRecipe);
  const vectorResult = useEditStore((s) => s.vectorResult);
  const vectorConfig = useEditStore((s) => s.vector);

  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const activeLayer = layers.find((l) => l.id === activeLayerId) || layers[0] || null;

  const [format, setFormat] = useState<'png' | 'bmp' | 'jpeg' | 'webp' | 'recipe'>('png');
  const [exportScope, setExportScope] = useState<'composite' | 'active' | 'all'>('composite');
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
          Please load an image or add layers to configure export.
        </div>
      </div>
    );
  }

  // Calculate physical dimensions in mm and inches
  const widthMm = ((metadata.width / dpi) * 25.4).toFixed(1);
  const heightMm = ((metadata.height / dpi) * 25.4).toFixed(1);
  const widthIn = (metadata.width / dpi).toFixed(2);
  const heightIn = (metadata.height / dpi).toFixed(2);

  const exportBufferAsFile = (
    buffer: ArrayBuffer,
    width: number,
    height: number,
    fileName: string,
    outFormat: string
  ) => {
    if (outFormat === 'bmp') {
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
      } else if (exportScope === 'active' && activeLayer && activeLayer.previewBuffer) {
        const layerW = activeLayer.previewDims?.width || dims.width;
        const layerH = activeLayer.previewDims?.height || dims.height;
        exportBufferAsFile(
          activeLayer.previewBuffer,
          layerW,
          layerH,
          `layer-${activeLayer.name.replace(/\.[^/.]+$/, '')}`,
          format
        );
      } else if (exportScope === 'all') {
        // Batch export all visible layers
        layers.forEach((layer, idx) => {
          if (layer.visible && layer.previewBuffer) {
            const layerW = layer.previewDims?.width || dims.width;
            const layerH = layer.previewDims?.height || dims.height;
            setTimeout(() => {
              exportBufferAsFile(
                layer.previewBuffer!,
                layerW,
                layerH,
                `layer-${idx + 1}-${layer.name.replace(/\.[^/.]+$/, '')}`,
                format
              );
            }, idx * 150);
          }
        });
      } else {
        // Export full master composite
        exportBufferAsFile(
          processedBuffer,
          dims.width,
          dims.height,
          `prepared-${metadata.name.replace(/\.[^/.]+$/, '')}`,
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

      {/* Export Scope */}
      {layers.length > 1 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Layers size={14} />
            <span>Export Scope</span>
          </div>
          <select
            className={styles.select}
            value={exportScope}
            onChange={(e) => setExportScope(e.target.value as any)}
          >
            <option value="composite">Full Composite Output ({layers.length} Layers)</option>
            <option value="active">Active Layer Only ({activeLayer?.name || 'Selected'})</option>
            <option value="all">All Visible Layers as Separate Files (Batch)</option>
          </select>
        </div>
      )}

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
              <Download size={16} />
              {exportScope === 'all'
                ? `Export All ${layers.length} Layers`
                : exportScope === 'active'
                ? `Export ${activeLayer?.name || 'Active Layer'}`
                : 'Export Prepared Output'}
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
              onClick={() => {
                const svgStr = generateProductionSVG(vectorResult, { strokeWidth: vectorConfig.strokeWidth, physicalUnits: 'mm' });
                const blob = new Blob([svgStr], { type: 'image/svg+xml' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${metadata.name.replace(/\.[^/.]+$/, '')}-vectors.svg`;
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
                a.download = `${metadata.name.replace(/\.[^/.]+$/, '')}-vectors.dxf`;
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
            onClick={() => {
              exportBufferAsFile(
                depthHeightMapBuffer,
                dims.width,
                dims.height,
                `${metadata.name.replace(/\.[^/.]+$/, '')}-16bit-heightmap`,
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
