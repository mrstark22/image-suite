import React, { useEffect, useRef } from 'react';
import type { DocumentUpdate, GestureToken } from '../../types/document';
import { Eye, EyeOff, Layers, Palette, Play, RotateCcw, Scissors, Trash2 } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { useRenderStore } from '../../store/renderStore';
import { useUIStore } from '../../store/uiStore';
import { DocumentSlider } from '../shared/Slider';
import { Button } from '../shared/Button';
import { Section } from '../shared/Section';
import { Toggle } from '../shared/Toggle';
import { Select, type SelectOption } from '../shared/Select';
import { Progress } from '../shared/Progress';
import { StatusMessage } from '../shared/StatusMessage';
import { DEFAULT_VECTOR, resetVector, setVector } from '../../lib/document';
import { editPalette, paletteChoice, paletteChoiceOptions, paletteFromResult, type PaletteChoice } from '../../lib/trace-palette';
import type { TraceColorMode, TraceShapes } from '../../types/vector';
import panelStyles from './Panels.module.css';
import styles from './VectorizationPanel.module.css';

/**
 * A palette colour picker. The browser's picker reports every movement while
 * it is open; those changes are one gesture, so choosing a colour is one undo
 * step and traces once, when the picker closes (review of #84).
 */
const PaletteSwatch: React.FC<{ color: string; label: string; update: (color: string) => DocumentUpdate }> = ({
  color,
  label,
  update,
}) => {
  const ref = useRef<HTMLInputElement>(null);
  const token = useRef<GestureToken | null>(null);
  const end = () => {
    if (token.current !== null) useDocumentStore.getState().endGesture(token.current);
    token.current = null;
  };
  useEffect(() => {
    const input = ref.current;
    // The native change event fires once, when the picker closes; React's onChange fires on every input.
    input?.addEventListener('change', end);
    return () => {
      input?.removeEventListener('change', end);
      end();
    };
  }, []);
  return (
    <input
      ref={ref}
      type="color"
      className={styles.swatch}
      value={color}
      aria-label={label}
      onChange={(e) => {
        const store = useDocumentStore.getState();
        if (token.current === null || store.gesture?.token !== token.current) token.current = store.beginGesture();
        store.updateGesture(token.current, update(e.target.value));
      }}
      onBlur={end}
    />
  );
};

const COLOR_MODES: Array<{ id: TraceColorMode; title: string; desc: string }> = [
  { id: 'mono', title: 'Black & White', desc: 'One layer: everything darker than the threshold' },
  { id: 'color', title: 'Colour', desc: 'One layer per colour, separated in a perceptual space' },
];

const SHAPE_MODES: Array<{ id: TraceShapes; title: string; desc: string }> = [
  { id: 'auto', title: 'Auto', desc: 'Thin lines get one centre path; filled shapes get an outline' },
  { id: 'outline', title: 'Outline', desc: 'Every shape is traced around its edge' },
  { id: 'centerline', title: 'Centreline', desc: 'Every shape is traced along its middle; solid areas wider than 1 mm keep an outline' },
];

/**
 * The trace step. Every setting is in the document (undoable) and is read by
 * the tracer; lengths are in millimetres, so tracing waits until the size is
 * set. Hiding a layer is a view setting and is not undoable.
 */
export const VectorizationPanel: React.FC = () => {
  const vector = useDocumentStore((s) => s.doc?.vector ?? DEFAULT_VECTOR);
  const sizeSet = useDocumentStore((s) => s.doc?.mmPerPx != null);
  const edit = useDocumentStore((s) => s.edit);
  const vectorResult = useRenderStore((s) => s.vectorResult);
  const isVectorStale = useRenderStore((s) => s.isVectorStale);
  const isTracing = useRenderStore((s) => s.isTracing);
  const autoTrace = useRenderStore((s) => s.autoTrace);
  const setAutoTrace = useRenderStore((s) => s.setAutoTrace);
  const requestTrace = useRenderStore((s) => s.requestTrace);
  const cancelTrace = useRenderStore((s) => s.cancelTrace);
  const clearVectors = useRenderStore((s) => s.clearVectors);
  const toggleVectorLayer = useRenderStore((s) => s.toggleVectorLayer);
  const setSizeDialogOpen = useUIStore((s) => s.setSizeDialogOpen);

  // The palette shown: the fixed one, or the colours the last trace found.
  const palette = vector.palette ?? (vectorResult ? paletteFromResult(vectorResult) : null);
  const strokes = vectorResult?.layers.reduce((n, l) => n + l.paths.filter((p) => p.kind === 'stroke').length, 0) ?? 0;
  const fills = vectorResult?.layers.reduce((n, l) => n + l.paths.filter((p) => p.kind === 'fill').length, 0) ?? 0;

  return (
    <div className={panelStyles.panel}>
      <div className={panelStyles.panelActions}>
        <div className={styles.headerActions}>
          {vectorResult && (
            <Button variant="link" icon={<Trash2 size={12} />} onClick={clearVectors} title="Clear the traced paths">
              Clear
            </Button>
          )}
          <Button variant="link" icon={<RotateCcw size={12} />} onClick={() => edit(resetVector)} title="Reset the tracing settings">
            Reset
          </Button>
        </div>
      </div>

      <div className={styles.actionBar}>
        {!sizeSet ? (
          <>
            <StatusMessage tone="info">
              Tracing settings are in millimetres, so set the size of the image first.
            </StatusMessage>
            <Button variant="primary" onClick={() => setSizeDialogOpen(true)}>
              Set Size…
            </Button>
          </>
        ) : (
          <Button variant="primary" icon={<Play size={13} />} onClick={requestTrace}>
            {vectorResult ? (isVectorStale ? 'Trace Again' : 'Update Trace') : 'Trace'}
          </Button>
        )}
        {isVectorStale && vectorResult && !isTracing && (
          <StatusMessage tone="warning">The settings changed since the last trace.</StatusMessage>
        )}
        {isTracing && <Progress label="Tracing" fraction={null} onCancel={cancelTrace} />}
        <Toggle label="Trace again on every change" checked={autoTrace} onChange={setAutoTrace} />
      </div>

      <Section title="Colours">
        <div className={panelStyles.gridCards} role="group" aria-label="Colours">
          {COLOR_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`${panelStyles.cardButton} ${vector.colorMode === m.id ? panelStyles.cardButtonActive : ''}`}
              aria-pressed={vector.colorMode === m.id}
              onClick={() => edit(setVector({ colorMode: m.id }))}
            >
              <span className={panelStyles.cardTitle}>{m.title}</span>
              <span className={panelStyles.cardDesc}>{m.desc}</span>
            </button>
          ))}
        </div>
        {vector.colorMode === 'mono' ? (
          <>
            <DocumentSlider
              label="Threshold"
              value={vector.threshold}
              min={1}
              max={254}
              update={(v) => setVector({ threshold: Math.round(v) })}
              reset={setVector({ threshold: DEFAULT_VECTOR.threshold })}
            />
            <Toggle
              label="Trace the light areas"
              checked={vector.invert}
              onChange={(checked) => edit(setVector({ invert: checked }))}
            />
          </>
        ) : vector.palette === null ? (
          <DocumentSlider
            label="Number of colours"
            value={vector.colorCount}
            min={2}
            max={16}
            update={(v) => setVector({ colorCount: Math.round(v) })}
            reset={setVector({ colorCount: DEFAULT_VECTOR.colorCount })}
          />
        ) : null}
      </Section>

      {vector.colorMode === 'color' && palette && (
        <Section
          title="Palette"
          icon={<Palette size={13} />}
          actions={
            vector.palette ? (
              <Button variant="link" onClick={() => edit(setVector({ palette: null }))}>
                Find automatically
              </Button>
            ) : undefined
          }
        >
          {!vector.palette && (
            <p className={styles.featureDesc}>
              Found automatically. Change, merge or remove a colour to fix the palette.
            </p>
          )}
          <ul className={styles.paletteList}>
            {palette.map((entry, i) => (
              <li key={i} className={styles.paletteItem}>
                <PaletteSwatch
                  color={entry.drawAs ?? entry.color}
                  label={`Colour ${i + 1}`}
                  update={(drawAs) => setVector({ palette: editPalette(palette, i, { drawAs }) })}
                />
                <Select<PaletteChoice>
                  label={`What to do with colour ${i + 1}`}
                  labelHidden
                  value={paletteChoice(entry)}
                  options={paletteChoiceOptions(palette, i) as SelectOption<PaletteChoice>[]}
                  onChange={(choice) => edit(setVector({ palette: editPalette(palette, i, choice) }))}
                />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Shapes">
        <div className={panelStyles.gridCards} role="group" aria-label="Shapes">
          {SHAPE_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`${panelStyles.cardButton} ${vector.shapes === m.id ? panelStyles.cardButtonActive : ''}`}
              aria-pressed={vector.shapes === m.id}
              onClick={() => edit(setVector({ shapes: m.id }))}
            >
              <span className={panelStyles.cardTitle}>{m.title}</span>
              <span className={panelStyles.cardDesc}>{m.desc}</span>
            </button>
          ))}
        </div>
        {vector.shapes === 'auto' && (
          <DocumentSlider
            label="Widest line traced as one path"
            value={vector.maxStrokeWidthMm}
            min={0.1}
            max={5}
            step={0.05}
            unit="mm"
            disabled={!sizeSet}
            update={(v) => setVector({ maxStrokeWidthMm: v })}
            reset={setVector({ maxStrokeWidthMm: DEFAULT_VECTOR.maxStrokeWidthMm })}
          />
        )}
      </Section>

      <Section title="Paths">
        <DocumentSlider
          label="Accuracy (largest deviation)"
          value={vector.toleranceMm}
          min={0.01}
          max={0.5}
          step={0.01}
          unit="mm"
          disabled={!sizeSet}
          update={(v) => setVector({ toleranceMm: v })}
          reset={setVector({ toleranceMm: DEFAULT_VECTOR.toleranceMm })}
        />
        <DocumentSlider
          label="Corner angle"
          value={vector.cornerAngle}
          min={20}
          max={150}
          unit="°"
          update={(v) => setVector({ cornerAngle: Math.round(v) })}
          reset={setVector({ cornerAngle: DEFAULT_VECTOR.cornerAngle })}
        />
        <DocumentSlider
          label="Drop specks and holes smaller than"
          value={vector.minAreaMm2}
          min={0}
          max={5}
          step={0.05}
          unit="mm²"
          disabled={!sizeSet}
          update={(v) => setVector({ minAreaMm2: v })}
          reset={setVector({ minAreaMm2: DEFAULT_VECTOR.minAreaMm2 })}
        />
        <DocumentSlider
          label="Smooth noise first (radius)"
          value={vector.denoiseMm}
          min={0}
          max={1}
          step={0.05}
          unit="mm"
          disabled={!sizeSet}
          update={(v) => setVector({ denoiseMm: v })}
          reset={setVector({ denoiseMm: DEFAULT_VECTOR.denoiseMm })}
        />
      </Section>

      <Section title="Cutline" icon={<Scissors size={13} />}>
        <Toggle
          label="Add a cutline around everything traced"
          checked={vector.cutline}
          onChange={(checked) => edit(setVector({ cutline: checked }))}
        />
        {vector.cutline && (
          <DocumentSlider
            label="Distance outside the shapes"
            value={vector.cutlineOffsetMm}
            min={0.5}
            max={20}
            step={0.5}
            unit="mm"
            disabled={!sizeSet}
            update={(v) => setVector({ cutlineOffsetMm: v })}
            reset={setVector({ cutlineOffsetMm: DEFAULT_VECTOR.cutlineOffsetMm })}
          />
        )}
      </Section>

      {vectorResult && vectorResult.layers.length > 0 && (
        <Section title={`Layers (${vectorResult.layers.length})`} icon={<Layers size={13} />}>
          <ul className={styles.layerList}>
            {vectorResult.layers.map((layer) => (
              <li key={layer.id} className={styles.layerItem}>
                <div className={styles.layerInfo}>
                  {/* The layer's own colour, known only at run time. */}
                  <span className={styles.layerDot} style={{ backgroundColor: layer.color }} />
                  <span className={styles.layerName}>{layer.name}</span>
                  <span className={styles.layerCounts}>
                    ({layer.paths.length} paths, {layer.totalNodes} nodes)
                  </span>
                </div>
                <div className={styles.layerActions}>
                  <button
                    type="button"
                    className={`${styles.iconButton} ${layer.visible ? '' : styles.iconButtonOff}`}
                    onClick={() => toggleVectorLayer(layer.id)}
                    aria-label={`Show ${layer.name}`}
                    aria-pressed={layer.visible}
                    title={layer.visible ? 'Hide layer (it is left out of the files)' : 'Show layer'}
                  >
                    {layer.visible ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {vectorResult ? (
        <Section title="Result">
          <div className={panelStyles.readoutBox}>
            <div className={panelStyles.readoutRow}>
              <span>Outlines</span>
              <strong>{fills}</strong>
            </div>
            <div className={panelStyles.readoutRow}>
              <span>Centre paths</span>
              <strong>{strokes}</strong>
            </div>
            <div className={panelStyles.readoutRow}>
              <span>Nodes</span>
              <strong>{vectorResult.totalNodes}</strong>
            </div>
          </div>
        </Section>
      ) : (
        sizeSet && (
          <div className={panelStyles.emptyNote}>
            <span>
              Press <strong>Trace</strong> above to trace the image.
            </span>
          </div>
        )
      )}
    </div>
  );
};
