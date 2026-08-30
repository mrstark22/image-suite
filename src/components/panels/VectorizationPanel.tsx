import React from 'react';
import { Download, Eye, EyeOff, Layers, FileCode } from 'lucide-react';
import { useEditStore } from '../../store/editStore';
import { Slider } from '../shared/Slider';
import { generateDXF } from '../../lib/dxf-export';
import { generateProductionSVG } from '../../lib/svg-export';
import type { VectorMode } from '../../types/vector';
import styles from './Panels.module.css';

const VECTOR_MODES: Array<{ id: VectorMode; title: string; desc: string }> = [
  { id: 'outline', title: 'Outline Trace', desc: 'Closed boundary paths for laser cutting & pocketing' },
  { id: 'multi-color', title: 'Multi-Color', desc: 'K-Means color segmentation into grouped SVG layers' },
  { id: 'edge-detect', title: 'Edge Detect', desc: 'Canny & Sobel gradients for crisp boundary outlines' },
  { id: 'centerline', title: 'Centerline', desc: 'Single-stroke skeleton paths for V-carving & scoring' },
];

export const VectorizationPanel: React.FC = () => {
  const vector = useEditStore((s) => s.vector);
  const vectorResult = useEditStore((s) => s.vectorResult);
  const setVector = useEditStore((s) => s.setVector);
  const resetVector = useEditStore((s) => s.resetVector);
  const toggleVectorLayer = useEditStore((s) => s.toggleVectorLayer);

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

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Vector Engine</span>
        <button className={styles.resetButton} onClick={resetVector}>
          Reset
        </button>
      </div>

      {/* Mode selection */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Trace Mode</div>
        <div className={styles.gridCards}>
          {VECTOR_MODES.map((mode) => {
            const isActive = vector.mode === mode.id;
            return (
              <button
                key={mode.id}
                className={`${styles.cardButton} ${isActive ? styles.cardButtonActive : ''}`}
                onClick={() => setVector({ mode: mode.id })}
              >
                <span className={styles.cardTitle}>{mode.title}</span>
                <span className={styles.cardDesc}>{mode.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mode-Specific Parameters */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Detection Parameters</div>

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
            <div className={styles.toggleRow} style={{ marginTop: 8 }}>
              <span className={styles.toggleLabel}>Invert Detection</span>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={vector.invert}
                onChange={(e) => setVector({ invert: e.target.checked })}
              />
            </div>
          </>
        )}
      </div>

      {/* Simplification & Curves */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Path Optimization & Noise Filter</div>

        <Slider
          label="Pre-Filter Denoise / Smoothing"
          value={vector.denoise ?? 0.0}
          min={0}
          max={6}
          step={0.5}
          unit="px"
          onChange={(v) => setVector({ denoise: v })}
          onReset={() => setVector({ denoise: 0.0 })}
        />

        <Slider
          label="Speckle / Min Path Area Filter"
          value={vector.minPathArea}
          min={0}
          max={100}
          step={1}
          unit="px²"
          onChange={(v) => setVector({ minPathArea: v })}
          onReset={() => setVector({ minPathArea: 4 })}
        />

        <Slider
          label="Simplification / Curve Smoothness"
          value={vector.rdpTolerance}
          min={0.4}
          max={6.0}
          step={0.1}
          unit="px"
          onChange={(v) => setVector({ rdpTolerance: v })}
          onReset={() => setVector({ rdpTolerance: 1.0 })}
        />

        {vector.curveFitting && (
          <Slider
            label="Corner Angle Threshold"
            value={vector.bezierTolerance ?? 1.0}
            min={0.4}
            max={2.5}
            step={0.1}
            onChange={(v) => setVector({ bezierTolerance: v })}
            onReset={() => setVector({ bezierTolerance: 1.0 })}
          />
        )}

        <div className={styles.toggleRow} style={{ marginTop: 12 }}>
          <span className={styles.toggleLabel}>Bézier Curve Fitting</span>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={vector.curveFitting}
            onChange={(e) => setVector({ curveFitting: e.target.checked })}
          />
        </div>
      </div>

      {/* Layer Manager */}
      {vectorResult && vectorResult.layers.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Layers size={14} />
            <span>Layers ({vectorResult.layers.length})</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {vectorResult.layers.map((layer) => (
              <div
                key={layer.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  background: 'var(--bg-surface-active)',
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      backgroundColor: layer.color,
                      border: '1px solid rgba(255,255,255,0.2)',
                      display: 'inline-block',
                    }}
                  />
                  <span style={{ fontWeight: 500 }}>{layer.name}</span>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
                    ({layer.paths.length} paths)
                  </span>
                </div>

                <button
                  style={{
                    background: 'none',
                    border: 'none',
                    color: layer.visible ? 'var(--accent-primary)' : 'var(--text-tertiary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    padding: 2,
                  }}
                  onClick={() => toggleVectorLayer(layer.id)}
                  title={layer.visible ? 'Hide layer' : 'Show layer'}
                >
                  {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Telemetry & Vector Export */}
      {vectorResult && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Vector Statistics</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
              <span>Total Paths:</span>
              <strong style={{ color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
                {vectorResult.totalPaths}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
              <span>Total Nodes:</span>
              <strong style={{ color: 'var(--accent-success)', fontFamily: 'var(--font-mono)' }}>
                {vectorResult.totalNodes}
              </strong>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              className={styles.primaryActionBtn}
              style={{ flex: 1 }}
              onClick={handleDownloadSVG}
            >
              <Download size={14} />
              Download SVG
            </button>

            <button
              className={styles.primaryActionBtn}
              style={{
                flex: 1,
                backgroundColor: 'var(--bg-surface-active)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
              }}
              onClick={handleDownloadDXF}
            >
              <FileCode size={14} />
              Download DXF
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
