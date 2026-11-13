import React, { useId } from 'react';
import { Eye, Layers, Mountain, RefreshCw } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { useRenderStore } from '../../store/renderStore';
import { DEFAULT_DEPTH, setDepth } from '../../lib/document';
import { DEPTH_BACKEND_LABEL, DEPTH_MODEL } from '../../lib/ai-depth';
import { getPipeline } from '../../lib/pipeline-client';
import { startSchedulers } from '../../lib/schedulers';
import { reliefDepthCurve } from '../../lib/relief-export';
import { useProfilesStore } from '../../store/profilesStore';
import { DocumentSlider } from '../shared/Slider';
import { Section } from '../shared/Section';
import { Toggle } from '../shared/Toggle';
import { Button } from '../shared/Button';
import { Progress } from '../shared/Progress';
import { StatusMessage } from '../shared/StatusMessage';
import type { BevelStyle, DepthSource, DepthViewMode, ReliefMaterial, ResolvedDepthSource } from '../../types/depth';
import styles from './Panels.module.css';

const DEPTH_SOURCES: Array<{ id: DepthSource; title: string; desc: string }> = [
  { id: 'auto', title: 'Automatic', desc: 'Shape for a logo or drawing, tone for anything else' },
  { id: 'ai-estimation', title: 'AI depth', desc: 'Photos: a real 3D shape estimated by a model' },
  { id: 'tonal-height', title: 'Tone', desc: 'Grey level is height, light high' },
  { id: 'distance-transform', title: 'Shape', desc: 'Logos: a bevel rising from every edge' },
];

const SOURCE_NAME: Record<ResolvedDepthSource, string> = {
  'ai-estimation': 'AI depth',
  'tonal-height': 'Tone',
  'distance-transform': 'Shape (logo bevel)',
};

const BEVEL_STYLES: Array<{ id: BevelStyle; title: string; desc: string }> = [
  { id: 'round', title: 'Round', desc: 'Quarter circle, convex' },
  { id: 'chamfer', title: 'Chamfer', desc: 'Straight slope' },
  { id: 'cove', title: 'Cove', desc: 'Quarter circle, hollow' },
];

const VIEW_MODES: Array<{ id: DepthViewMode; label: string; desc: string }> = [
  { id: '3d', label: '3D', desc: 'The relief as a surface you can turn' },
  { id: 'heightmap', label: 'Heightmap', desc: 'The grey image the file holds' },
];

/** The substrate materials of the 3D view; each swatch's colour is in the stylesheet. */
const MATERIALS: Array<{ id: ReliefMaterial; label: string }> = [
  { id: 'walnut', label: 'Walnut' },
  { id: 'brass', label: 'Brass' },
  { id: 'slate', label: 'Slate' },
  { id: 'grayscale', label: 'Grey' },
];

const SWATCH_CLASS: Partial<Record<ReliefMaterial, string>> = {
  walnut: styles.swatchWalnut,
  brass: styles.swatchBrass,
  slate: styles.swatchSlate,
  grayscale: styles.swatchGrayscale,
};

const MODEL_PHASE: Record<string, string> = {
  downloading: `Downloading the AI depth model (${Math.round(DEPTH_MODEL.file.bytes / 1e6)} MB, once)`,
  loading: 'Starting the AI depth model',
  estimating: 'Estimating depth',
};

/**
 * Relief settings of the open document, in two groups: shape settings change
 * the heightmap and so the file; view settings change only the screen (#42).
 * The file is written by the export step (ReliefExports).
 */
export const DepthMapPanel: React.FC = () => {
  const depth = useDocumentStore((s) => s.doc?.depth ?? DEFAULT_DEPTH);
  const edit = useDocumentStore((s) => s.edit);
  const relief = useRenderStore((s) => s.relief);
  // Re-read when the selection or the profiles change.
  useProfilesStore((s) => s.data);
  useProfilesStore((s) => s.materialId);
  useProfilesStore((s) => s.machineId);
  const hasCurve = reliefDepthCurve() !== null;
  const materialLabelId = useId();
  const viewLabelId = useId();
  // The controls of the source in use: Automatic's choice once known.
  const shown: ResolvedDepthSource | null = depth.source === 'auto' ? relief.source : depth.source;

  const retry = () => {
    useRenderStore.getState().setRelief({ error: null });
    startSchedulers().relief.rerun();
  };

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Relief</span>
      </div>

      <Section title="Heights from" icon={<Layers size={14} />}>
        <div className={styles.gridCards}>
          {DEPTH_SOURCES.map((src) => {
            const isActive = depth.source === src.id;
            return (
              <button
                key={src.id}
                type="button"
                className={`${styles.cardButton} ${isActive ? styles.cardButtonActive : ''}`}
                aria-pressed={isActive}
                onClick={() => edit(setDepth({ source: src.id }))}
              >
                <span className={styles.cardTitle}>{src.title}</span>
                <span className={styles.cardDesc}>{src.desc}</span>
              </button>
            );
          })}
        </div>
        {depth.source === 'auto' && relief.source && (
          <div className={styles.controlNote}>Using {SOURCE_NAME[relief.source]} for this image.</div>
        )}
        {depth.source === 'ai-estimation' && (
          <div className={styles.controlNote}>
            {DEPTH_MODEL.name} ({DEPTH_MODEL.licence}), run {DEPTH_BACKEND_LABEL}. The image never leaves this computer.
          </div>
        )}
        {relief.model && (
          <Progress
            label={MODEL_PHASE[relief.model.phase]}
            fraction={relief.model.fraction}
            onCancel={relief.model.phase === 'downloading' ? () => void getPipeline().cancelModelDownload() : undefined}
          />
        )}
        {relief.error && (
          <StatusMessage tone="error">
            {relief.error} No heightmap was made.{' '}
            <Button variant="link" icon={<RefreshCw size={12} />} onClick={retry}>
              Try again
            </Button>
          </StatusMessage>
        )}
      </Section>

      <Section title="Shape: changes the file" icon={<Mountain size={14} />}>
        {shown === 'distance-transform' && (
          <>
            <div className={styles.gridCards}>
              {BEVEL_STYLES.map((b) => {
                const isActive = depth.bevelStyle === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    className={`${styles.cardButton} ${isActive ? styles.cardButtonActive : ''}`}
                    aria-pressed={isActive}
                    onClick={() => edit(setDepth({ bevelStyle: b.id }))}
                  >
                    <span className={styles.cardTitle}>{b.title}</span>
                    <span className={styles.cardDesc}>{b.desc}</span>
                  </button>
                );
              })}
            </div>
            <DocumentSlider
              label="Bevel width"
              value={depth.bevelWidthMm}
              min={0.2}
              max={20}
              step={0.1}
              unit="mm"
              update={(v) => setDepth({ bevelWidthMm: v })}
              reset={setDepth({ bevelWidthMm: DEFAULT_DEPTH.bevelWidthMm })}
            />
            <Toggle
              label="Light shape on a dark ground"
              checked={depth.shapeIsLight}
              note={depth.shapeIsLight ? 'The light parts are raised.' : 'The dark parts are raised.'}
              onChange={(checked) => edit(setDepth({ shapeIsLight: checked }))}
            />
          </>
        )}
        {shown === 'ai-estimation' && (
          <DocumentSlider
            label="Surface detail from the image"
            value={depth.detail}
            min={0}
            max={100}
            step={5}
            unit="%"
            update={(v) => setDepth({ detail: v })}
            reset={setDepth({ detail: DEFAULT_DEPTH.detail })}
          />
        )}
        <DocumentSlider
          label="Smoothing"
          value={depth.smoothingMm}
          min={0}
          max={2}
          step={0.05}
          unit="mm"
          update={(v) => setDepth({ smoothingMm: v })}
          reset={setDepth({ smoothingMm: DEFAULT_DEPTH.smoothingMm })}
        />
        <Toggle
          label="Carve in instead of raising"
          checked={depth.invertZ}
          note={depth.invertZ ? 'What was highest is now deepest.' : 'Highest parts stay at the surface.'}
          onChange={(checked) => edit(setDepth({ invertZ: checked }))}
        />
        <DocumentSlider
          label="Maximum depth"
          value={depth.maxDepthMm}
          min={0.2}
          max={10}
          step={0.1}
          unit="mm"
          update={(v) => setDepth({ maxDepthMm: v })}
          reset={setDepth({ maxDepthMm: DEFAULT_DEPTH.maxDepthMm })}
        />
        <div className={styles.controlNote}>
          {hasCurve
            ? 'The relief calibration of this machine and material is applied to the file, so the burn has these proportions.'
            : 'No relief calibration with a depth curve is in use, so the file\u2019s grey levels are linear: the depth burned depends on the power range set in LightBurn.'}{' '}
          The 3D view shows this maximum depth.
        </div>
      </Section>

      <Section title="View: screen only" icon={<Eye size={14} />}>
        <div role="group" aria-labelledby={viewLabelId}>
          <div id={viewLabelId} className={styles.choiceLabel}>
            Show
          </div>
          <div className={styles.gridCards}>
            {VIEW_MODES.map((vm) => {
              const isActive = depth.viewMode === vm.id;
              return (
                <button
                  key={vm.id}
                  type="button"
                  className={`${styles.cardButton} ${isActive ? styles.cardButtonActive : ''}`}
                  aria-pressed={isActive}
                  onClick={() => edit(setDepth({ viewMode: vm.id }))}
                >
                  <span className={styles.cardTitle}>{vm.label}</span>
                  <span className={styles.cardDesc}>{vm.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
        {depth.viewMode === '3d' && (
          <>
            <div role="group" aria-labelledby={materialLabelId}>
              <div id={materialLabelId} className={styles.choiceLabel}>
                Material
              </div>
              <div className={styles.gridCards}>
                {MATERIALS.map((m) => {
                  const isActive = depth.material === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`${styles.materialButton} ${isActive ? styles.materialButtonActive : ''}`}
                      aria-pressed={isActive}
                      onClick={() => edit(setDepth({ material: m.id }))}
                    >
                      <span className={`${styles.swatch} ${SWATCH_CLASS[m.id] ?? ''}`} aria-hidden="true" />
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <DocumentSlider
              label="Light direction"
              value={depth.lightAngle}
              min={0}
              max={360}
              step={5}
              unit="°"
              update={(v) => setDepth({ lightAngle: v })}
              reset={setDepth({ lightAngle: DEFAULT_DEPTH.lightAngle })}
            />
            <DocumentSlider
              label="Exaggerate depth (view only)"
              value={depth.exaggeration}
              min={1}
              max={10}
              step={0.5}
              unit="×"
              update={(v) => setDepth({ exaggeration: v })}
              reset={setDepth({ exaggeration: DEFAULT_DEPTH.exaggeration })}
            />
          </>
        )}
      </Section>
    </div>
  );
};
