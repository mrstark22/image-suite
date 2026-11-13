import React, { useState } from 'react';
import { Download, CheckCircle, FileCode } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { traceIsCurrent, useRenderStore } from '../../store/renderStore';
import { useUIStore } from '../../store/uiStore';
import { vectorExportRequest, vectorExportSource, vectorFile, type VectorFormat } from '../../lib/vector-file-export';
import { traceSizeMm } from '../../lib/vector-export';
import { getPipeline } from '../../lib/pipeline-client';
import { recipeFromDocument } from '../../lib/document';
import { describePhysicalSize, exportResolution, fromMm, physicalSize } from '../../lib/document-size';
import { exportPlan } from '../../lib/render-target';
import { cancelRasterExport, exportRaster, rasterExportBlocker } from '../../lib/raster-export';
import { lightBurnSettings } from '../../lib/lightburn-settings';
import { activeCalibration, activeProfiles, useProfilesStore } from '../../store/profilesStore';
import { JOB_CALIBRATION } from '../../lib/profiles';
import type { ExportProgress, RasterFormat } from '../../types/worker-messages';
import { ReliefExports } from './ReliefExports';
import { Button } from '../shared/Button';
import { Progress } from '../shared/Progress';
import { Section } from '../shared/Section';
import { Select, type SelectOption } from '../shared/Select';
import { StatusMessage } from '../shared/StatusMessage';
import styles from './Panels.module.css';

const GREY_FORMATS: SelectOption<RasterFormat>[] = [
  { value: 'png', label: 'PNG, 8-bit greyscale' },
  { value: 'bmp', label: 'BMP, 24-bit' },
];

/** A dithered image is written 1-bit, for LightBurn's Pass-Through mode (#39). Lossy formats are never offered. */
const DOT_FORMATS: SelectOption<RasterFormat>[] = [
  { value: 'png', label: 'PNG, 1-bit black and white' },
  { value: 'bmp', label: 'BMP, 1-bit black and white' },
];

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
 * same plan the worker uses. Vector files are traced again at full resolution
 * and written in millimetres (#23, #30). The heightmap is computed again at
 * full resolution and carries the document's DPI (#42, #46).
 */
export const ExportPanel: React.FC = () => {
  const doc = useDocumentStore((s) => s.doc);
  const source = useRenderStore((s) => s.source);
  const processedBuffer = useRenderStore((s) => s.processed);
  const vectorResult = useRenderStore((s) => s.vectorResult);
  const tracedInputs = useRenderStore((s) => s.tracedInputs);
  const isVectorStale = useRenderStore((s) => s.isVectorStale);
  const isTracing = useRenderStore((s) => s.isTracing);
  const progress = useRenderStore((s) => s.exportProgress);
  const job = useUIStore((s) => s.job);
  const profiles = useProfilesStore();
  const { machine, material, thickness } = activeProfiles(profiles);
  const calibration = activeCalibration(JOB_CALIBRATION[job], profiles);
  const openManager = profiles.openManager;
  const setSizeDialogOpen = useUIStore((s) => s.setSizeDialogOpen);
  const openCalibrate = useProfilesStore((s) => s.openCalibrate);

  const [format, setFormat] = useState<RasterFormat>('png');
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vectorBusy, setVectorBusy] = useState<VectorFormat | null>(null);
  const [vectorError, setVectorError] = useState<string | null>(null);

  if (!doc || !source || !processedBuffer) {
    return (
      <div className={styles.panel}>
        <div className={styles.emptyNote}>Open an image to export it.</div>
      </div>
    );
  }

  const baseName = doc.source.name.replace(/\.[^/.]+$/, '');
  const dithered = doc.steps.dither.algorithm !== 'none';
  const size = physicalSize(doc);
  // What a raster export writes; null while the size is not set.
  const plan = doc.mmPerPx === null ? null : exportPlan(doc);
  // The trace is preview-sized: its file carries the preview's DPI.
  const previewResolution = plan ? exportResolution(doc, source.width) : null;
  const isExporting = progress !== null;
  const blocker = rasterExportBlocker(doc);
  const canExport = blocker === null && !isExporting;

  const file =
    job === 'photo' || job === 'relief'
      ? plan && { widthPx: plan.target.widthPx, heightPx: plan.target.heightPx, dpi: plan.dpi }
      : previewResolution && { widthPx: source.width, heightPx: source.height, dpi: previewResolution.dpi };
  const settings = lightBurnSettings({
    job,
    machine,
    material,
    thickness,
    calibration,
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

  const vectorSource = vectorResult
    ? vectorExportSource(vectorResult, tracedInputs !== null)
    : null;

  // The file must be what is on screen: no export of a trace older than the document (review of #84).
  const traceCurrent = vectorResult !== null && !isVectorStale && !isTracing && traceIsCurrent();
  const canExportVector = vectorResult !== null && vectorResult.pxPerMm !== null && traceCurrent && vectorBusy === null;

  const handleVectorExport = async (fmt: VectorFormat) => {
    if (!vectorResult || !vectorSource || !canExportVector) return;
    setVectorBusy(fmt);
    setVectorError(null);
    try {
      const { text, mimeType } =
        vectorSource === 'as-shown'
          ? vectorFile(vectorResult, fmt)
          : await getPipeline().exportVectorFile(
              vectorExportRequest(doc, vectorResult, fmt)
            );
      download([text], mimeType, `${baseName}-vectors.${fmt}`);
    } catch (err) {
      setVectorError(err instanceof Error ? err.message : String(err));
    } finally {
      setVectorBusy(null);
    }
  };

  const handleRecipe = () => {
    const recipe = recipeFromDocument(doc, `${baseName} recipe`);
    download([JSON.stringify(recipe, null, 2)], 'application/json', `${baseName}-recipe.imgsuite`);
  };

  return (
    <div className={styles.panel}>
      {/* Physical size, from the document */}
      <Section title="Physical Size & Resolution">
        {doc.sizeOrigin === 'assumed' && size && (
          <StatusMessage tone="warning" className={styles.sizeAssumedNotice}>
            <span>
              The physical size was assumed: the file does not say how big it is, so it is taken as{' '}
              {describePhysicalSize(doc)?.replace(/^Assumed /, '')}. Set the real size so the burn comes out the size you
              want.
            </span>
            <Button compact onClick={() => setSizeDialogOpen(true)}>
              Set size…
            </Button>
          </StatusMessage>
        )}
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
          </div>
        ) : (
          <div className={styles.readoutBox}>
            <div className={styles.readoutRow}>
              <span>Size not set</span>
              <Button variant="link" onClick={() => setSizeDialogOpen(true)}>
                Set size…
              </Button>
            </div>
            <div className={styles.controlNote}>Set the size to export: the file needs a physical size to carry.</div>
          </div>
        )}
      </Section>

      {job === 'photo' && (
        <Section title="Image File">
          <Select
            label="Image file format"
            labelHidden
            value={format}
            options={dithered ? DOT_FORMATS : GREY_FORMATS}
            onChange={setFormat}
          />
          {dithered && plan && (
            <div className={`${styles.controlNote} ${styles.stackGap}`}>
              One pixel per laser dot: {plan.target.widthPx} × {plan.target.heightPx} at {plan.dpi.toFixed(1)} DPI (
              {plan.widthMm.toFixed(1)} × {plan.heightMm.toFixed(1)} mm). In LightBurn, use Pass-Through and do not
              resize the image, so it burns dot for dot.
            </div>
          )}
          <Button
            variant="primary"
            className={styles.stackGap}
            icon={isDone ? <CheckCircle size={16} /> : <Download size={16} />}
            onClick={() => void handleRasterExport()}
            disabled={!canExport}
          >
            {isDone ? 'Export Complete' : dithered ? 'Export for Pass-Through' : 'Export Prepared Image'}
          </Button>
          {progress && (
            <Progress
              className={styles.stackGap}
              label={STAGE_LABEL[progress.stage]}
              // Only encoding reports how far it is; the WASM calls before it cannot.
              fraction={progress.stage === 'encoding' ? progress.fraction : null}
              onCancel={cancelRasterExport}
              note="The preview is paused while exporting."
            />
          )}
          {blocker && plan && <div className={`${styles.controlNote} ${styles.stackGap}`}>{blocker}</div>}
          {error && (
            <StatusMessage tone="error" className={styles.stackGap}>
              Export failed: {error}
            </StatusMessage>
          )}
        </Section>
      )}

      {job === 'vector' && (
        <Section title="Vector Files">
          {!vectorResult && <div className={styles.controlNote}>Nothing traced yet: go back to the Trace step.</div>}
          {vectorResult && vectorResult.pxPerMm !== null && (
            <div className={styles.controlNote}>
              {(() => {
                const { widthMm, heightMm } = traceSizeMm(vectorResult);
                return `${widthMm.toFixed(1)} × ${heightMm.toFixed(1)} mm, written in millimetres in both files.`;
              })()}
            </div>
          )}
          <div className={styles.buttonRow}>
            <Button
              icon={<Download size={14} />}
              disabled={!canExportVector}
              onClick={() => void handleVectorExport('svg')}
            >
              SVG
            </Button>
            <Button
              icon={<FileCode size={14} />}
              disabled={!canExportVector}
              onClick={() => void handleVectorExport('dxf')}
            >
              DXF
            </Button>
          </div>
          {vectorResult && !traceCurrent && (
            <StatusMessage tone="warning" className={styles.stackGap}>
              {isTracing
                ? 'Tracing… the files can be saved when it finishes.'
                : 'The image or settings changed since the last trace: go back to the Trace step and trace again.'}
            </StatusMessage>
          )}
          {vectorBusy && (
            <Progress className={styles.stackGap} label="Tracing at full resolution" fraction={null} />
          )}
          {vectorSource === 'full-resolution' && (
            <div className={`${styles.controlNote} ${styles.stackGap}`}>
              The files are traced again from the full-resolution image, so they hold detail the preview cannot: small
              corners and short straight edges can come out crisper than they look on screen.
            </div>
          )}
          {vectorError && (
            <StatusMessage tone="error" className={styles.stackGap}>
              Export failed: {vectorError}
            </StatusMessage>
          )}
        </Section>
      )}

      {job === 'relief' && (
        <>
          <ReliefExports />
        </>
      )}

      {/* What to set in LightBurn for this file */}
      <Section title="LightBurn Settings">
        <div className={styles.readoutBox}>
          {settings.rows.map((row) => (
            <div key={row.label} className={styles.readoutRow}>
              <span>{row.label}</span>
              <strong className={styles.readoutValue}>{row.value}</strong>
            </div>
          ))}
        </div>
        {settings.tone === 'warning' ? (
          <StatusMessage tone="warning">{settings.calibration}</StatusMessage>
        ) : (
          <div className={`${styles.controlNote} ${styles.stackGap}`}>{settings.calibration}</div>
        )}
        <Button variant="link" onClick={() => openManager({ tab: 'materials', id: material?.id ?? null })}>
          Machines &amp; materials…
        </Button>
        <Button variant="link" onClick={() => openCalibrate()}>
          Calibrate with a test card…
        </Button>
      </Section>

      <Section title="Settings">
        <Button icon={<Download size={14} />} onClick={handleRecipe}>
          Save Edit Recipe (.imgsuite)
        </Button>
      </Section>
    </div>
  );
};
