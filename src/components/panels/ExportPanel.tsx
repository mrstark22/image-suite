import React, { useState } from 'react';
import { Download, CheckCircle, FileCode, Box, X } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { useRenderStore } from '../../store/renderStore';
import { useUIStore } from '../../store/uiStore';
import { encodePngGrayscale16 } from '../../lib/png-encoder';
import { generateProductionSVG } from '../../lib/svg-export';
import { generateDXF } from '../../lib/dxf-export';
import { recipeFromDocument } from '../../lib/document';
import { exportResolution, fromMm } from '../../lib/document-size';
import { exportPlan } from '../../lib/render-target';
import { cancelRasterExport, exportRaster, rasterExportBlocker } from '../../lib/raster-export';
import type { ExportProgress, RasterFormat } from '../../types/worker-messages';
import styles from './Panels.module.css';

const STAGE_LABEL: Record<ExportProgress['stage'], string> = {
  preparing: 'Preparing the full-resolution image',
  processing: 'Applying adjustments and dither',
  encoding: 'Encoding',
};

/** Starts a download of `parts` as `fileName`. */
function download(parts: BlobPart[], type: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export of the prepared image, the trace and the heightmap. Raster export
 * runs the pipeline in the worker at the source's full resolution for the
 * crop and writes the document's DPI into the file (#17); the size and DPI
 * shown come from the same plan the worker uses. The trace and heightmap are
 * still preview-sized (#30, #42, #46) and carry the DPI of the preview.
 */
export const ExportPanel: React.FC = () => {
  const doc = useDocumentStore((s) => s.doc);
  const source = useRenderStore((s) => s.source);
  const processedBuffer = useRenderStore((s) => s.processed);
  const depthHeightMapBuffer = useRenderStore((s) => s.depthHeightMap);
  const vectorResult = useRenderStore((s) => s.vectorResult);
  const progress = useRenderStore((s) => s.exportProgress);
  // Read so the panel updates when background removal is applied or restored.
  useRenderStore((s) => s.backgroundRemoval);
  const setSizeDialogOpen = useUIStore((s) => s.setSizeDialogOpen);

  const [format, setFormat] = useState<RasterFormat | 'recipe'>('png');
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const baseName = doc.source.name.replace(/\.[^/.]+$/, '');
  // What a raster export writes; null while the size is not set.
  const plan = doc.mmPerPx === null ? null : exportPlan(doc);
  // The trace and heightmap are preview-sized: their files carry the preview's DPI.
  const previewResolution = plan ? exportResolution(doc, source.width) : null;
  const vectorConfig = doc.vector;
  const isExporting = progress !== null;
  // A recipe needs no size; raster files need the size, and no preview-only background removal.
  const blocker = format === 'recipe' ? null : rasterExportBlocker(doc);
  const canExport = blocker === null && !isExporting;

  const handleExecuteExport = async () => {
    if (!canExport) return;
    setIsDone(false);
    setError(null);
    if (format === 'recipe') {
      const recipe = recipeFromDocument(doc, `${baseName} recipe`);
      download([JSON.stringify(recipe, null, 2)], 'application/json', `${baseName}-recipe.imgsuite`);
    } else {
      try {
        // The document as it is now: edits made while it runs are not in the file.
        const file = await exportRaster(doc, format);
        if (!file) return; // cancelled
        download([file.bytes], file.mimeType, `prepared-${baseName}.${file.extension}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    setIsDone(true);
    setTimeout(() => setIsDone(false), 3000);
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
          <option value="recipe">Edit Recipe (.imgsuite JSON)</option>
        </select>
      </div>

      {/* Physical size, from the document */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Physical Size & Resolution</div>
        {plan ? (
          <div className={styles.readoutBox}>
            <div className={styles.readoutRow}>
              <span>Width</span>
              <strong>
                {plan.widthMm.toFixed(1)} mm ({fromMm(plan.widthMm, 'in').toFixed(2)}")
              </strong>
            </div>
            <div className={styles.readoutRow}>
              <span>Height</span>
              <strong>
                {plan.heightMm.toFixed(1)} mm ({fromMm(plan.heightMm, 'in').toFixed(2)}")
              </strong>
            </div>
            <div className={styles.readoutRow}>
              <span>File</span>
              <strong>
                {plan.target.widthPx} × {plan.target.heightPx} px at {plan.dpi.toFixed(1)} DPI
              </strong>
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
          onClick={() => void handleExecuteExport()}
          disabled={!canExport}
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
        {progress && (
          <div className={styles.readoutBox} style={{ marginTop: 8 }} role="status">
            <div className={styles.readoutRow}>
              <span>
                {STAGE_LABEL[progress.stage]}
                {progress.stage === 'encoding' ? ` ${Math.round(progress.fraction * 100)}%` : '…'}
              </span>
              <button className={styles.resetButton} onClick={cancelRasterExport}>
                <X size={12} /> Cancel
              </button>
            </div>
            <div className={styles.controlNote} style={{ margin: 0 }}>
              The preview is paused while exporting.
            </div>
          </div>
        )}
        {blocker && plan && <div className={styles.controlNote} style={{ marginTop: 8 }}>{blocker}</div>}
        {error && (
          <div className={styles.controlNote} style={{ marginTop: 8, color: 'var(--accent-danger)' }} role="alert">
            Export failed: {error}
          </div>
        )}
      </div>

      {/* Vector Production Files */}
      {vectorResult && (
        <div className={styles.section} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14, marginTop: 14 }}>
          <div className={styles.sectionTitle}>Vector Toolpaths (Laser / CNC)</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className={styles.primaryActionBtn}
              style={{ flex: 1, backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
              disabled={!previewResolution}
              onClick={() => {
                if (!previewResolution) return;
                const svgStr = generateProductionSVG(vectorResult, {
                  strokeWidth: vectorConfig.strokeWidth,
                  physicalUnits: 'mm',
                  dpi: previewResolution.dpi,
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
            disabled={!previewResolution}
            onClick={() => {
              if (!previewResolution) return;
              // Preview-sized until #42 and #46, which also decide whether this button stays.
              void encodePngGrayscale16(
                new Uint16Array(depthHeightMapBuffer),
                source.width,
                source.height,
                previewResolution.pxPerMm
              )
                .then((png) => download([png.buffer as ArrayBuffer], 'image/png', `${baseName}-16bit-heightmap.png`))
                .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
            }}
          >
            <Download size={14} /> Download 16-Bit Heightmap (.PNG)
          </button>
        </div>
      )}
    </div>
  );
};
