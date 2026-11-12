import React, { useState } from 'react';
import {
  Eye,
  EyeOff,
  Layers,
  Play,
  Trash2,
  RotateCcw,
  Scissors,
  Sparkles,
} from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { useRenderStore } from '../../store/renderStore';
import { DocumentSlider, Slider } from '../shared/Slider';
import { Button } from '../shared/Button';
import { Section } from '../shared/Section';
import { Toggle } from '../shared/Toggle';
import { Progress } from '../shared/Progress';
import { StatusMessage } from '../shared/StatusMessage';
import { DEFAULT_VECTOR, resetVector, setVector } from '../../lib/document';
import type { VectorMode } from '../../types/vector';
import panelStyles from './Panels.module.css';
import styles from './VectorizationPanel.module.css';

const VECTOR_MODES: Array<{ id: VectorMode; title: string; desc: string }> = [
  { id: 'outline', title: 'Outline Trace', desc: 'Closed cut paths for laser & pocketing' },
  { id: 'multi-color', title: 'Multi-Color', desc: 'K-Means color segmentation into layers' },
  { id: 'edge-detect', title: 'Edge Detect', desc: 'Canny & Sobel gradients for outlines' },
  { id: 'centerline', title: 'Centerline', desc: 'Single-stroke paths for V-carving' },
];

/**
 * Tracing settings (in the document, undoable) and the trace result with its
 * edits (in renderStore, not undoable until phase 2, #32).
 */
export const VectorizationPanel: React.FC = () => {
  const vector = useDocumentStore((s) => s.doc?.vector ?? DEFAULT_VECTOR);
  const sizeSet = useDocumentStore((s) => s.doc?.mmPerPx != null);
  const edit = useDocumentStore((s) => s.edit);
  const vectorResult = useRenderStore((s) => s.vectorResult);
  const autoTrace = useRenderStore((s) => s.autoTrace);
  const isVectorStale = useRenderStore((s) => s.isVectorStale);
  const isTracing = useRenderStore((s) => s.isTracing);
  const setAutoTrace = useRenderStore((s) => s.setAutoTrace);
  const requestTrace = useRenderStore((s) => s.requestTrace);
  const cancelTrace = useRenderStore((s) => s.cancelTrace);
  const clearVectors = useRenderStore((s) => s.clearVectors);
  const toggleVectorLayer = useRenderStore((s) => s.toggleVectorLayer);
  const removeVectorLayer = useRenderStore((s) => s.removeVectorLayer);
  const generateCutline = useRenderStore((s) => s.generateCutline);
  const smoothVectors = useRenderStore((s) => s.smoothVectors);

  const [cutlineOffsetMm, setCutlineOffsetMm] = useState<number>(2.0);
  const [cutlineSmoothness, setCutlineSmoothness] = useState<number>(3);
  const [smoothTolerance, setSmoothTolerance] = useState<number>(1.5);
  const [fitCurves, setFitCurves] = useState<boolean>(true);

  const handleTraceNow = () => requestTrace();

  return (
    <div className={panelStyles.panel}>
      {/* Panel Header */}
      <div className={panelStyles.panelHeader}>
        <span className={panelStyles.panelTitle}>Vector Engine</span>
        <div className={styles.headerActions}>
          {vectorResult && (
            <Button variant="link" icon={<Trash2 size={12} />} onClick={clearVectors} title="Clear all vector paths">
              Clear
            </Button>
          )}
          <Button
            variant="link"
            icon={<RotateCcw size={12} />}
            onClick={() => edit(resetVector)}
            title="Reset parameters to default"
          >
            Reset
          </Button>
        </div>
      </div>

      {/* Primary Action & Auto-Trace Toggle */}
      <div className={styles.actionBar}>
        <Button variant="primary" icon={<Play size={13} />} onClick={handleTraceNow}>
          {vectorResult ? (isVectorStale ? 'Re-Trace Vectors' : 'Update Vectors') : 'Trace Vectors'}
        </Button>
        {isVectorStale && vectorResult && !isTracing && (
          <StatusMessage tone="warning">The settings changed since the last trace.</StatusMessage>
        )}
        {isTracing && <Progress label="Tracing" fraction={null} onCancel={cancelTrace} />}

        <Toggle label="Auto-trace on change" checked={autoTrace} onChange={setAutoTrace} />
      </div>

      {/* Trace Mode Selection */}
      <Section title="Trace Mode">
        <div className={panelStyles.gridCards}>
          {VECTOR_MODES.map((mode) => {
            const isActive = vector.mode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                className={`${panelStyles.cardButton} ${isActive ? panelStyles.cardButtonActive : ''}`}
                aria-pressed={isActive}
                onClick={() => edit(setVector({ mode: mode.id }))}
              >
                <span className={panelStyles.cardTitle}>{mode.title}</span>
                <span className={panelStyles.cardDesc}>{mode.desc}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Detection Parameters */}
      <Section title="Detection Settings">
        {vector.mode === 'multi-color' && (
          <DocumentSlider
            label="Palette Colors (K-Means)"
            value={vector.colorCount}
            min={2}
            max={12}
            step={1}
            update={(v) => setVector({ colorCount: Math.round(v) })}
            reset={setVector({ colorCount: 4 })}
          />
        )}

        {vector.mode === 'edge-detect' && (
          <>
            <DocumentSlider
              label="Canny Low Threshold"
              value={vector.cannyLow}
              min={10}
              max={120}
              update={(v) => setVector({ cannyLow: v })}
              reset={setVector({ cannyLow: 30 })}
            />
            <DocumentSlider
              label="Canny High Threshold"
              value={vector.cannyHigh}
              min={40}
              max={220}
              update={(v) => setVector({ cannyHigh: v })}
              reset={setVector({ cannyHigh: 80 })}
            />
          </>
        )}

        {(vector.mode === 'outline' || vector.mode === 'centerline') && (
          <>
            <DocumentSlider
              label="Binarization Threshold"
              value={vector.threshold}
              min={0}
              max={255}
              update={(v) => setVector({ threshold: v })}
              reset={setVector({ threshold: 128 })}
            />
            <Toggle
              label="Invert Detection"
              checked={vector.invert}
              onChange={(checked) => edit(setVector({ invert: checked }))}
            />
          </>
        )}
      </Section>

      {/* Simplification & Noise Filter */}
      <Section title="Path Optimization">
        <DocumentSlider
          label="Pre-Filter Denoise"
          value={vector.denoise ?? 0.0}
          min={0}
          max={6}
          step={0.5}
          unit="px"
          update={(v) => setVector({ denoise: v })}
          reset={setVector({ denoise: 0.0 })}
        />

        <DocumentSlider
          label="Speckle Area Filter"
          value={vector.minPathArea}
          min={0}
          max={100}
          step={1}
          unit="px²"
          update={(v) => setVector({ minPathArea: v })}
          reset={setVector({ minPathArea: 4 })}
        />

        <DocumentSlider
          label="Curve Smoothness (RDP)"
          value={vector.rdpTolerance}
          min={0.4}
          max={6.0}
          step={0.1}
          unit="px"
          update={(v) => setVector({ rdpTolerance: v })}
          reset={setVector({ rdpTolerance: 1.0 })}
        />

        <Toggle
          label="Bézier Curve Fitting"
          checked={vector.curveFitting}
          onChange={(checked) => edit(setVector({ curveFitting: checked }))}
        />
      </Section>

      {/* Laser Contour Cutline Generator */}
      <Section title="Contour Cutline (Offset Path)" icon={<Scissors size={13} />}>
        <p className={styles.featureDesc}>
          Extracts subject boundary and expands by +offset for laser cutlines (Red #FF0000).
        </p>

        <Slider
          label="Boundary Offset"
          value={cutlineOffsetMm}
          min={0.0}
          max={20.0}
          step={0.5}
          unit="mm"
          onChange={setCutlineOffsetMm}
          onReset={() => setCutlineOffsetMm(2.0)}
        />

        <Slider
          label="Curve Smoothing"
          value={cutlineSmoothness}
          min={1}
          max={10}
          step={1}
          onChange={setCutlineSmoothness}
          onReset={() => setCutlineSmoothness(3)}
        />

        {!sizeSet && <p className={styles.featureDesc}>Set the size to use this.</p>}
        <Button
          icon={<Scissors size={13} />}
          disabled={!sizeSet}
          onClick={() => generateCutline(cutlineOffsetMm, cutlineSmoothness)}
        >
          Generate Cutline (+{cutlineOffsetMm}mm)
        </Button>
      </Section>

      {/* Node Reduction & Spline Smoothing (Active Vectors) */}
      {vectorResult && (
        <Section title="Node Reduction & Splines" icon={<Sparkles size={13} />}>
          <p className={styles.featureDesc}>
            Simplifies dense point clouds into smooth arcs to eliminate CNC stuttering.
          </p>

          <Slider
            label="Tolerance"
            value={smoothTolerance}
            min={0.5}
            max={5.0}
            step={0.2}
            unit="px"
            onChange={setSmoothTolerance}
            onReset={() => setSmoothTolerance(1.5)}
          />

          <Toggle label="Fit Cubic Bézier Curves" checked={fitCurves} onChange={setFitCurves} />

          <Button icon={<Sparkles size={13} />} onClick={() => smoothVectors(smoothTolerance, fitCurves)}>
            Optimize & Smooth Nodes
          </Button>
        </Section>
      )}

      {/* Layer List */}
      {vectorResult && vectorResult.layers.length > 0 && (
        <Section title={`Vector Layers (${vectorResult.layers.length})`} icon={<Layers size={13} />}>
          <ul className={styles.layerList}>
            {vectorResult.layers.map((layer) => (
              <li key={layer.id} className={styles.layerItem}>
                <div className={styles.layerInfo}>
                  {/* The layer's own colour, known only at run time. */}
                  <span className={styles.layerDot} style={{ backgroundColor: layer.color }} />
                  <span className={styles.layerName}>{layer.name}</span>
                  <span className={styles.layerCounts}>
                    ({layer.paths.length} paths • {layer.totalNodes} nodes)
                  </span>
                </div>

                <div className={styles.layerActions}>
                  <button
                    type="button"
                    className={`${styles.iconButton} ${layer.visible ? '' : styles.iconButtonOff}`}
                    onClick={() => toggleVectorLayer(layer.id)}
                    aria-label={`Show ${layer.name}`}
                    aria-pressed={layer.visible}
                    title={layer.visible ? 'Hide layer' : 'Show layer'}
                  >
                    {layer.visible ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    className={`${styles.iconButton} ${styles.iconButtonDanger}`}
                    onClick={() => removeVectorLayer(layer.id)}
                    aria-label={`Delete ${layer.name}`}
                    title="Delete layer"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Statistics & Export */}
      {vectorResult ? (
        <Section title="Vector Telemetry">
          <div className={panelStyles.readoutBox}>
            <div className={panelStyles.readoutRow}>
              <span>Total Paths:</span>
              <strong>{vectorResult.totalPaths}</strong>
            </div>
            <div className={panelStyles.readoutRow}>
              <span>Total Nodes:</span>
              <strong>{vectorResult.totalNodes}</strong>
            </div>
          </div>
        </Section>
      ) : (
        <div className={panelStyles.emptyNote}>
          <span>
            Click <strong>Trace Vectors</strong> above to generate toolpaths.
          </span>
        </div>
      )}
    </div>
  );
};
