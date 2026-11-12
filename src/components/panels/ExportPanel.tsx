import React, { useState } from 'react';
import { Download, CheckCircle, FileCode, Box, X } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { useRenderStore } from '../../store/renderStore';
import { useUIStore } from '../../store/uiStore';
import { encodePngGrayscale16 } from '../../lib/png-encoder';
import { generateProductionSVG } from '../../lib/svg-export';
import { generateDXF } from '../../lib/dxf-export';
import { recipeFromDocument } from '../../lib/document';
import { exportResolution, fromMm, physicalSize } from '../../lib/document-size';
import { exportPlan } from '../../lib/render-target';
import { cancelRasterExport, exportRaster, rasterExportBlocker } from '../../lib/raster-export';
import { lightBurnSettings } from '../../lib/lightburn-settings';
import { machineById, materialById } from '../../lib/machines';
import type { ExportProgress, RasterFormat } from '../../types/worker-messages';
import { ReliefExports } from './ReliefExports';
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
 * The last step of every flow (#53): the current job's files, their physical
 * size and the LightBurn settings to use. Raster export runs the pipeline in
 * the worker at the source's full resolution for the crop and writes the
 * document's DPI into the file (#17); the size and DPI shown come from the
 * same plan the worker uses. The trace and heightmap are still preview-sized
 * (#30, #42, #46) and carry the DPI of the preview.
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
  const job = useUIStore((s) => s.job);
  const machine = useUIStore((s) => machineById(s.machineId));
  const material = useUIStore((s) => materialById(s.materialId));
  const setSizeDialogOpen = useUIStore((s) => s.setSizeDialogOpen);
  const setTestGridDialogOpen = useUIStore((s) => s.setTestGridDialogOpen);

  const [format, setFormat] = useState<RasterFormat>('png');
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!doc || !source || !processedBuffer) {
    return (
      <div className={styles.panel}>
        <div className={styles.emptyNote}>Open an image to export it.</div>
      </div>
    );
  }

  const baseName = doc.source.name.replace(/\.[^/.]+$/, '');
  const size = physicalSize(doc);
  // What a raster export writes; null while the size is not set.
  const plan = doc.mmPerPx === null ? null : exportPlan(doc);
  // The trace and heightmap are preview-sized: their files carry the preview's DPI.
  const previewResolution = plan ? exportResolution(doc, source.width) : null;
  const isExporting = progress !== null;
  const blocker = rasterExportBlocker(doc);
  const canExport = blocker === null && !isExporting;

  const file =
    job === 'photo'
      ? plan && { widthPx: plan.target.widthPx, heightPx: plan.target.heightPx, dpi: plan.dpi }
      : previewResolution && { widthPx: source.width, heightPx: source.height, dpi: previewResolution.dpi };
  const settings = lightBurnSettings({
    job,
    machine,
    material,
    dither: doc.steps.dither.algorithm,
    fileDpi: file?.dpi ?? null,
  });

  const handleRasterExport = async () => {
    if (!canExport) return;
    setIsDone(false);
    setError(null);
    try {
      // The document as it is now: edits made while it runs are not in the file.
      const result = await exportRaster(doc, format);
      if (!result) return; // cancelled
      download([result.bytes], result.mimeType, `prepared-${baseName}.${result.extension}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    setIsDone(true);
    setTimeout(() => setIsDone(false), 3000);
  };

  const handleRecipe = () => {
    const recipe = recipeFromDocument(doc, `${baseName} recipe`);
    download([JSON.stringify(recipe, null, 2)], 'application/json', `${baseName}-recipe.imgsuite`);
  };

  return (
    <div className={styles.panel}>
      {/* Physical size, from the document */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Physical Size & Resolution</div>
        {size && file ? (
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
                {file.widthPx} × {file.heightPx} px at {file.dpi.toFixed(1)} DPI
              </strong>
            </div>
            {job !== 'photo' && (
              <div className={styles.controlNote}>
                {job === 'vector' ? 'Traced' : 'The heightmap is computed'} at preview resolution until{' '}
                {job === 'vector' ? '#30' : '#46'}.
              </div>
            )}
          </div>
        ) : (
          <div className={styles.readoutBox}>
            <div className={styles.readoutRow}>
              <span>Size not set</span>
              <button className={styles.resetButton} onClick={() => setSizeDialogOpen(true)}>
                Set size…
              </button>
            </div>
            <div className={styles.controlNote}>Set the size to export: the file needs a physical size to carry.</div>
          </div>
        )}
      </div>

      {job === 'photo' && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Image File</div>
          <select
            className={styles.select}
            value={format}
            onChange={(e) => setFormat(e.target.value as RasterFormat)}
          >
            <option value="png">PNG (Lossless 8-bit)</option>
            <option value="bmp">BMP (Windows Bitmap CNC/Laser)</option>
          </select>
          <button
            className={styles.primaryActionBtn}
            onClick={() => void handleRasterExport()}
            disabled={!canExport}
          >
            {isDone ? (
              <>
                <CheckCircle size={16} color="var(--on-accent)" /> Export Complete
              </>
            ) : (
              <>
                <Download size={16} />
                Export Prepared Image
              </>
            )}
          </button>
          {progress && (
            <div className={`${styles.readoutBox} ${styles.stackGap}`} role="status">
              <div className={styles.readoutRow}>
                <span>
                  {STAGE_LABEL[progress.stage]}
                  {progress.stage === 'encoding' ? ` ${Math.round(progress.fraction * 100)}%` : '…'}
                </span>
                <button className={styles.resetButton} onClick={cancelRasterExport}>
                  <X size={12} /> Cancel
                </button>
              </div>
              <div className={styles.controlNote}>The preview is paused while exporting.</div>
            </div>
          )}
          {blocker && plan && <div className={`${styles.controlNote} ${styles.stackGap}`}>{blocker}</div>}
          {error && (
            <div className={`${styles.controlNote} ${styles.stackGap} ${styles.errorText}`} role="alert">
              Export failed: {error}
            </div>
          )}
        </div>
      )}

      {job === 'vector' && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Vector Files</div>
          {!vectorResult && <div className={styles.controlNote}>Nothing traced yet: go back to the Trace step.</div>}
          <div className={styles.buttonRow}>
            <button
              className={styles.secondaryActionBtn}
              disabled={!vectorResult || !previewResolution}
              onClick={() => {
                if (!vectorResult || !previewResolution) return;
                const svg = generateProductionSVG(vectorResult, {
                  strokeWidth: doc.vector.strokeWidth,
                  physicalUnits: 'mm',
                  dpi: previewResolution.dpi,
                });
                download([svg], 'image/svg+xml', `${baseName}-vectors.svg`);
              }}
            >
              <Download size={14} /> SVG (mm)
            </button>
            <button
              className={styles.secondaryActionBtn}
              disabled={!vectorResult}
              onClick={() => {
                if (!vectorResult) return;
                download([generateDXF(vectorResult)], 'application/dxf', `${baseName}-vectors.dxf`);
              }}
            >
              <FileCode size={14} /> DXF (pixels)
            </button>
          </div>
          <div className={`${styles.controlNote} ${styles.stackGap}`}>
            The DXF has no units: its coordinates are preview pixels, so scale it on import (#30).
          </div>
        </div>
      )}

      {job === 'relief' && (
        <>
          <ReliefExports />
          {depthHeightMapBuffer && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                <span className={styles.titleWithIcon}>
                  <Box size={14} color="var(--text-2)" /> Heightmap as Viewed
                </span>
              </div>
              <button
                className={styles.secondaryActionBtn}
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
                <Download size={14} /> 16-Bit Heightmap with DPI (.PNG)
              </button>
              <div className={`${styles.controlNote} ${styles.stackGap}`}>
                The heightmap the view shows. Two heightmap exports remain until #46 leaves one.
              </div>
              {error && (
                <div className={`${styles.controlNote} ${styles.errorText}`} role="alert">
                  Export failed: {error}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* What to set in LightBurn for this file */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>LightBurn Settings</div>
        <div className={styles.readoutBox}>
          {settings.rows.map((row) => (
            <div key={row.label} className={styles.readoutRow}>
              <span>{row.label}</span>
              <strong className={styles.readoutValue}>{row.value}</strong>
            </div>
          ))}
        </div>
        <div className={`${styles.controlNote} ${styles.stackGap}`}>{settings.calibration}</div>
        <button className={styles.resetButton} onClick={() => setTestGridDialogOpen(true)}>
          Make a calibration test card…
        </button>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Settings</div>
        <button className={styles.secondaryActionBtn} onClick={handleRecipe}>
          <Download size={14} /> Save Edit Recipe (.imgsuite)
        </button>
      </div>
    </div>
  );
};
