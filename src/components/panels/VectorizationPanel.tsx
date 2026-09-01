import React, { useState } from 'react';
import {
  Download,
  Eye,
  EyeOff,
  Layers,
  FileCode,
  Play,
  Trash2,
  RotateCcw,
  Scissors,
  Sparkles,
  Zap,
  Plus,
} from 'lucide-react';
import { useEditStore } from '../../store/editStore';
import { useSceneStore } from '../../core/scene-store';
import { useImageStore } from '../../store/imageStore';
import { Slider } from '../shared/Slider';
import { generateDXF } from '../../lib/dxf-export';
import { generateProductionSVG } from '../../lib/svg-export';
import type { VectorMode } from '../../types/vector';
import styles from './VectorizationPanel.module.css';

const VECTOR_MODES: Array<{ id: VectorMode; title: string; desc: string }> = [
  { id: 'outline', title: 'Outline Trace', desc: 'Closed cut paths for laser & pocketing' },
  { id: 'multi-color', title: 'Multi-Color', desc: 'K-Means color segmentation into layers' },
  { id: 'edge-detect', title: 'Edge Detect', desc: 'Canny & Sobel gradients for outlines' },
  { id: 'centerline', title: 'Centerline', desc: 'Single-stroke paths for V-carving' },
];

export const VectorizationPanel: React.FC = () => {
  const vector = useEditStore((s) => s.vector);
  const vectorResult = useEditStore((s) => s.vectorResult);
  const autoTrace = useEditStore((s) => s.autoTrace);
  const isVectorStale = useEditStore((s) => s.isVectorStale);
  const setVector = useEditStore((s) => s.setVector);
  const setAutoTrace = useEditStore((s) => s.setAutoTrace);
  const clearVectors = useEditStore((s) => s.clearVectors);
  const resetVector = useEditStore((s) => s.resetVector);
  const toggleVectorLayer = useEditStore((s) => s.toggleVectorLayer);
  const removeVectorLayer = useEditStore((s) => s.removeVectorLayer);
  const generateCutline = useEditStore((s) => s.generateCutline);
  const smoothVectors = useEditStore((s) => s.smoothVectors);

  const [cutlineOffsetMm, setCutlineOffsetMm] = useState<number>(2.0);
  const [cutlineSmoothness, setCutlineSmoothness] = useState<number>(3);
  const [smoothTolerance, setSmoothTolerance] = useState<number>(1.5);
  const [fitCurves, setFitCurves] = useState<boolean>(true);

  const handleTraceNow = () => {
    setAutoTrace(true);
    setVector({ ...vector });
  };

  const handleDownloadSVG = () => {
    if (!vectorResult) return;
    const svgStr = generateProductionSVG(vectorResult, {
      strokeWidth: vector.strokeWidth,
      physicalUnits: 'px',
    });
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vector-${vector.mode}-output.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadDXF = () => {
    if (!vectorResult) return;
    const dxfStr = generateDXF(vectorResult);
    const blob = new Blob([dxfStr], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vector-${vector.mode}-output.dxf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addVectorNode = useSceneStore((s) => s.addVectorNode);
  const previewDims = useImageStore((s) => s.previewDimensions);

  const handleCommitToScene = () => {
    if (!vectorResult || vectorResult.layers.length === 0) return;
    const w = previewDims?.width || 800;
    const h = previewDims?.height || 800;

    vectorResult.layers.forEach((layer) => {
      const combinedSvg = layer.paths.map((p) => p.svgPathData).join(' ');
      addVectorNode(layer.name || 'Traced Vector', combinedSvg, w, h, layer.color);
    });
  };

  return (
    <div className={styles.panel}>
      {/* Panel Header */}
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>
          <Zap size={14} color="var(--accent-primary)" />
          <span>Vector Engine</span>
        </span>
        <div className={styles.headerActions}>
          {vectorResult && (
            <button
              className={`${styles.headerIconBtn} ${styles.headerIconBtnDanger}`}
              onClick={clearVectors}
              title="Clear all vector paths"
            >
              <Trash2 size={12} />
              <span>Clear</span>
            </button>
          )}
          <button
            className={styles.headerIconBtn}
            onClick={resetVector}
            title="Reset parameters to default"
          >
            <RotateCcw size={12} />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Primary Action & Auto-Trace Toggle */}
      <div className={styles.actionBar}>
        <div className={styles.actionRow}>
          <button
            className={`${styles.traceBtn} ${isVectorStale && vectorResult ? styles.traceBtnStale : ''}`}
            onClick={handleTraceNow}
          >
            <Play size={13} fill="currentColor" />
            <span>{vectorResult ? (isVectorStale ? 'Re-Trace Vectors' : 'Update Vectors') : 'Trace Vectors'}</span>
          </button>
        </div>

        <label className={styles.autoTraceToggle}>
          <span className={styles.autoTraceLabel}>Auto-trace on change</span>
          <span className={styles.switch}>
            <input
              type="checkbox"
              checked={autoTrace}
              onChange={(e) => setAutoTrace(e.target.checked)}
            />
            <span className={styles.slider} />
          </span>
        </label>
      </div>

      {/* Trace Mode Selection */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Trace Mode</div>
        <div className={styles.modeGrid}>
          {VECTOR_MODES.map((mode) => {
            const isActive = vector.mode === mode.id;
            return (
              <button
                key={mode.id}
                className={`${styles.modeCard} ${isActive ? styles.modeCardActive : ''}`}
                onClick={() => setVector({ mode: mode.id })}
              >
                <span className={styles.modeCardTitle}>{mode.title}</span>
                <span className={styles.modeCardDesc}>{mode.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detection Parameters */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Detection Settings</div>

        {vector.mode === 'multi-color' && (
          <Slider
            label="Palette Colors (K-Means)"
            value={vector.colorCount}
            min={2}
            max={12}
            step={1}
            onChange={(v) => setVector({ colorCount: Math.round(v) })}
            onReset={() => setVector({ colorCount: 4 })}
          />
        )}

        {vector.mode === 'edge-detect' && (
          <>
            <Slider
              label="Canny Low Threshold"
              value={vector.cannyLow}
              min={10}
              max={120}
              onChange={(v) => setVector({ cannyLow: v })}
              onReset={() => setVector({ cannyLow: 30 })}
            />
            <Slider
              label="Canny High Threshold"
              value={vector.cannyHigh}
              min={40}
              max={220}
              onChange={(v) => setVector({ cannyHigh: v })}
              onReset={() => setVector({ cannyHigh: 80 })}
            />
          </>
        )}

        {(vector.mode === 'outline' || vector.mode === 'centerline') && (
          <>
            <Slider
              label="Binarization Threshold"
              value={vector.threshold}
              min={0}
              max={255}
              onChange={(v) => setVector({ threshold: v })}
              onReset={() => setVector({ threshold: 128 })}
            />
            <label className={styles.autoTraceToggle} style={{ marginTop: 6 }}>
              <span className={styles.autoTraceLabel}>Invert Detection</span>
              <span className={styles.switch}>
                <input
                  type="checkbox"
                  checked={vector.invert}
                  onChange={(e) => setVector({ invert: e.target.checked })}
                />
                <span className={styles.slider} />
              </span>
            </label>
          </>
        )}
      </div>

      {/* Simplification & Noise Filter */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Path Optimization</div>

        <Slider
          label="Pre-Filter Denoise"
          value={vector.denoise ?? 0.0}
          min={0}
          max={6}
          step={0.5}
          unit="px"
          onChange={(v) => setVector({ denoise: v })}
          onReset={() => setVector({ denoise: 0.0 })}
        />

        <Slider
          label="Speckle Area Filter"
          value={vector.minPathArea}
          min={0}
          max={100}
          step={1}
          unit="px²"
          onChange={(v) => setVector({ minPathArea: v })}
          onReset={() => setVector({ minPathArea: 4 })}
        />

        <Slider
          label="Curve Smoothness (RDP)"
          value={vector.rdpTolerance}
          min={0.4}
          max={6.0}
          step={0.1}
          unit="px"
          onChange={(v) => setVector({ rdpTolerance: v })}
          onReset={() => setVector({ rdpTolerance: 1.0 })}
        />

        <label className={styles.autoTraceToggle} style={{ marginTop: 6 }}>
          <span className={styles.autoTraceLabel}>Bézier Curve Fitting</span>
          <span className={styles.switch}>
            <input
              type="checkbox"
              checked={vector.curveFitting}
              onChange={(e) => setVector({ curveFitting: e.target.checked })}
            />
            <span className={styles.slider} />
          </span>
        </label>
      </div>

      {/* Laser Contour Cutline Generator */}
      <div className={styles.section}>
        <div className={styles.featureCard} style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}>
          <div className={styles.featureCardHeader}>
            <span className={styles.featureCardTitle} style={{ color: '#ef4444' }}>
              <Scissors size={13} />
              <span>Contour Cutline (Offset Path)</span>
            </span>
          </div>
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

          <button
            className={styles.actionBtnRed}
            onClick={() => generateCutline(cutlineOffsetMm, cutlineSmoothness)}
          >
            <Scissors size={13} />
            <span>Generate Cutline (+{cutlineOffsetMm}mm)</span>
          </button>
        </div>
      </div>

      {/* Node Reduction & Spline Smoothing (Active Vectors) */}
      {vectorResult && (
        <div className={styles.section}>
          <div className={styles.featureCard}>
            <div className={styles.featureCardHeader}>
              <span className={styles.featureCardTitle}>
                <Sparkles size={13} color="var(--accent-primary)" />
                <span>Node Reduction & Splines</span>
              </span>
            </div>
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

            <label className={styles.autoTraceToggle}>
              <span className={styles.autoTraceLabel}>Fit Cubic Bézier Curves</span>
              <span className={styles.switch}>
                <input
                  type="checkbox"
                  checked={fitCurves}
                  onChange={(e) => setFitCurves(e.target.checked)}
                />
                <span className={styles.slider} />
              </span>
            </label>

            <button
              className={styles.actionBtnSecondary}
              onClick={() => smoothVectors(smoothTolerance, fitCurves)}
            >
              <Sparkles size={13} />
              <span>Optimize & Smooth Nodes</span>
            </button>
          </div>
        </div>
      )}

      {/* Layer List */}
      {vectorResult && vectorResult.layers.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Layers size={13} />
              <span>Vector Layers ({vectorResult.layers.length})</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {vectorResult.layers.map((layer) => (
              <div key={layer.id} className={styles.layerItem}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    className={styles.layerDot}
                    style={{ backgroundColor: layer.color }}
                  />
                  <span style={{ fontWeight: 600 }}>{layer.name}</span>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 10.5 }}>
                    ({layer.paths.length} paths • {layer.totalNodes} nodes)
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <button
                    className={styles.iconButton}
                    style={{ color: layer.visible ? 'var(--accent-primary)' : 'var(--text-tertiary)' }}
                    onClick={() => toggleVectorLayer(layer.id)}
                    title={layer.visible ? 'Hide layer' : 'Show layer'}
                  >
                    {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                  <button
                    className={`${styles.iconButton} ${styles.iconButtonDanger}`}
                    onClick={() => removeVectorLayer(layer.id)}
                    title="Delete layer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Statistics & Export */}
      {vectorResult ? (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Vector Telemetry</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className={styles.statRow}>
              <span>Total Paths:</span>
              <span className={styles.statValue} style={{ color: 'var(--accent-primary)' }}>
                {vectorResult.totalPaths}
              </span>
            </div>
            <div className={styles.statRow}>
              <span>Total Nodes:</span>
              <span className={styles.statValue} style={{ color: 'var(--accent-success, #4ade80)' }}>
                {vectorResult.totalNodes}
              </span>
            </div>
          </div>

          <div className={styles.exportRow}>
            <button className={styles.actionBtnSecondary} onClick={handleDownloadSVG}>
              <Download size={13} /> SVG
            </button>
            <button className={styles.actionBtnSecondary} onClick={handleDownloadDXF}>
              <FileCode size={13} /> DXF
            </button>
            <button className={styles.actionBtnSecondary} onClick={handleCommitToScene} title="Convert to editable vector object on canvas">
              <Plus size={13} /> Add to Canvas
            </button>
          </div>
        </div>
      ) : (
        <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 11.5 }}>
          Click <strong>Trace Vectors</strong> above to generate toolpaths.
        </div>
      )}
    </div>
  );
};
