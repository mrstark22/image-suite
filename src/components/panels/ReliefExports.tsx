import React, { useState } from 'react';
import { Download, CheckCircle, Layers, Image as ImageIcon } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { previewDpi, useRenderStore } from '../../store/renderStore';
import { DEFAULT_DEPTH } from '../../lib/document';
import { getPipeline } from '../../lib/pipeline-client';
import { encodeBmpGrayscale8, encodeBmpRgb24 } from '../../lib/bmp-encoder';
import { encodePngGrayscale16 } from '../../lib/png-encoder';
import { renderReliefPreview } from '../../lib/depth-shader';
import styles from './Panels.module.css';

/**
 * The relief's files, moved from the relief panel to the relief job's export
 * step (#53). Preview-sized until #46, which also leaves one heightmap export.
 */
export const ReliefExports: React.FC = () => {
  const depth = useDocumentStore((s) => s.doc?.depth ?? DEFAULT_DEPTH);
  const sourceName = useDocumentStore((s) => s.doc?.source.name ?? null);
  // Heightmap files carry a resolution, so they need the size (preview-sized until #46).
  const sizeSet = useDocumentStore((s) => s.doc?.mmPerPx != null);
  const source = useRenderStore((s) => s.source);
  const previewBuffer = source?.buffer ?? null;
  const dims = source;

  const [isExporting, setIsExporting] = useState(false);
  const [exportTypeDone, setExportTypeDone] = useState<'png16' | 'cnc' | 'shaded' | null>(null);

  // 1. Export True 16-Bit Lossless PNG Heightmap (65,536 Depth Levels for Vectric / Carbide / LightBurn)
  const handleExport16BitPng = async () => {
    if (!previewBuffer || !dims) return;

    setIsExporting(true);
    setExportTypeDone(null);

    try {
      const worker = getPipeline();
      const bufCopy = previewBuffer.slice(0);
      const result = await worker.processDepth({
        buffer: bufCopy,
        width: dims.width,
        height: dims.height,
        config: depth,
      });

      const depth16Data = new Uint16Array(result.heightMapBuffer);
      const pngBytes = await encodePngGrayscale16(depth16Data, dims.width, dims.height);

      const blob = new Blob([pngBytes.buffer as ArrayBuffer], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const baseName = sourceName?.replace(/\.[^/.]+$/, '') || 'heightmap';
      a.download = `${baseName}-16Bit-CNC-Heightmap-${dims.width}x${dims.height}.png`;
      a.click();
      URL.revokeObjectURL(url);

      setExportTypeDone('png16');
      setTimeout(() => setExportTypeDone(null), 3000);
    } catch (err) {
      console.error('Failed to export 16-bit PNG heightmap:', err);
    } finally {
      setIsExporting(false);
    }
  };

  // 2. Export 8-bit CNC Heightmap BMP (Legacy 256 Grayscale Levels)
  const handleExportCncBmp = async () => {
    if (!previewBuffer || !dims) return;

    setIsExporting(true);
    setExportTypeDone(null);

    try {
      const worker = getPipeline();
      const bufCopy = previewBuffer.slice(0);
      const result = await worker.processDepth({
        buffer: bufCopy,
        width: dims.width,
        height: dims.height,
        config: depth,
      });

      const depth16Data = new Uint16Array(result.heightMapBuffer);
      const dpi = previewDpi();
      if (dpi === null) return;

      const bmpBuffer = encodeBmpGrayscale8(depth16Data, dims.width, dims.height, dpi);
      const blob = new Blob([bmpBuffer], { type: 'image/bmp' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const baseName = sourceName?.replace(/\.[^/.]+$/, '') || 'heightmap';
      a.download = `${baseName}-8Bit-CNC-depth-${dims.width}x${dims.height}.bmp`;
      a.click();
      URL.revokeObjectURL(url);

      setExportTypeDone('cnc');
      setTimeout(() => setExportTypeDone(null), 3000);
    } catch (err) {
      console.error('Failed to export CNC depth map BMP:', err);
    } finally {
      setIsExporting(false);
    }
  };

  // 3. Export 3D Visual Presentation Mockup (24-bit Color Shaded with Walnut/Brass Lighting)
  const handleExportShadedBmp = async () => {
    if (!previewBuffer || !dims) return;

    setIsExporting(true);
    setExportTypeDone(null);

    try {
      const worker = getPipeline();
      const bufCopy = previewBuffer.slice(0);
      const result = await worker.processDepth({
        buffer: bufCopy,
        width: dims.width,
        height: dims.height,
        config: depth,
      });

      const depth16Data = new Uint16Array(result.heightMapBuffer);
      const shadedRgba = renderReliefPreview(depth16Data, dims.width, dims.height, depth);
      const dpi = previewDpi();
      if (dpi === null) return;

      const bmpBuffer = encodeBmpRgb24(shadedRgba, dims.width, dims.height, dpi);
      const blob = new Blob([bmpBuffer], { type: 'image/bmp' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const baseName = sourceName?.replace(/\.[^/.]+$/, '') || 'relief';
      a.download = `${baseName}-3D-shaded-render-${depth.material || 'walnut'}-${dims.width}x${dims.height}.bmp`;
      a.click();
      URL.revokeObjectURL(url);

      setExportTypeDone('shaded');
      setTimeout(() => setExportTypeDone(null), 3000);
    } catch (err) {
      console.error('Failed to export 3D shaded relief BMP:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Manufacturing & Render Output</div>
      {!sizeSet && <div className={styles.controlNote}>Set the size to export.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          className={styles.primaryActionBtn}
          onClick={handleExport16BitPng}
          disabled={isExporting || !previewBuffer || !sizeSet}
          title="Lossless 16-Bit (65,536 depth levels) for Vectric, Carbide Create Pro, LightBurn"
        >
          {exportTypeDone === 'png16' ? (
            <>
              <CheckCircle size={16} color="var(--on-accent)" /> 16-Bit Heightmap Exported (.PNG)
            </>
          ) : (
            <>
              <Layers size={16} /> Export 16-Bit CNC Heightmap (.PNG)
            </>
          )}
        </button>

        <button
          className={styles.primaryActionBtn}
          style={{
            backgroundColor: 'var(--surface-hover)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
          }}
          onClick={handleExportCncBmp}
          disabled={isExporting || !previewBuffer || !sizeSet}
          title="Standard 8-Bit (256 depth levels) Windows Grayscale BMP"
        >
          {exportTypeDone === 'cnc' ? (
            <>
              <CheckCircle size={16} color="var(--success)" /> 8-Bit CNC Heightmap Exported (.BMP)
            </>
          ) : (
            <>
              <Download size={16} /> Export 8-Bit CNC Heightmap (.BMP)
            </>
          )}
        </button>

        <button
          className={styles.primaryActionBtn}
          style={{
            backgroundColor: 'transparent',
            color: 'var(--text-2)',
            border: '1px dashed var(--border)',
          }}
          onClick={handleExportShadedBmp}
          disabled={isExporting || !previewBuffer || !sizeSet}
          title="24-Bit Color Presentation Mockup Render (with substrate lighting & shadows)"
        >
          {exportTypeDone === 'shaded' ? (
            <>
              <CheckCircle size={16} color="var(--success)" /> Presentation Render Exported (.BMP)
            </>
          ) : (
            <>
              <ImageIcon size={16} /> Export 3D Presentation Render (.BMP)
            </>
          )}
        </button>
      </div>
    </div>
  );
};
