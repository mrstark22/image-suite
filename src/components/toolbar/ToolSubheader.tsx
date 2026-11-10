import React from 'react';
import { Hand, Play, Trash2, RotateCcw, Scissors, Crop } from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { useEditStore } from '../../store/editStore';
import { useUIStore } from '../../store/uiStore';
import type { VectorMode } from '../../types/vector';
import styles from './ToolSubheader.module.css';

export const ToolSubheader: React.FC = () => {
  const canvasTool = useImageStore((s) => s.canvasTool);
  const setCanvasTool = useImageStore((s) => s.setCanvasTool);

  const vector = useEditStore((s) => s.vector);
  const vectorResult = useEditStore((s) => s.vectorResult);
  const autoTrace = useEditStore((s) => s.autoTrace);
  const setVector = useEditStore((s) => s.setVector);
  const setAutoTrace = useEditStore((s) => s.setAutoTrace);
  const clearVectors = useEditStore((s) => s.clearVectors);
  const generateCutline = useEditStore((s) => s.generateCutline);
  const resetTonal = useEditStore((s) => s.resetTonal);

  const activeTab = useUIStore((s) => s.activeTab);

  const handleTraceNow = () => {
    setAutoTrace(true);
    setVector({ ...vector });
  };

  return (
    <div className={styles.subheader}>
      {/* Left: canvas tools */}
      <div className={styles.leftGroup}>
        <div className={styles.toolGroup}>
          <button
            className={`${styles.toolBtn} ${canvasTool === 'pan' ? styles.toolBtnActive : ''}`}
            onClick={() => setCanvasTool('pan')}
            title="Pan Tool (H / Space) - Click & drag to pan canvas viewport"
          >
            <Hand size={12} />
            <span>Pan</span>
          </button>
          <button
            className={`${styles.toolBtn} ${canvasTool === 'crop' ? styles.toolBtnActive : ''}`}
            onClick={() => setCanvasTool('crop')}
            title="Crop Tool (C) - Drag the box, then press Enter to crop"
          >
            <Crop size={12} />
            <span>Crop</span>
          </button>
        </div>
      </div>

      {/* Right: Dynamic Context Actions for Current Tab */}
      <div className={styles.rightGroup}>
        {/* TONAL TAB CONTEXT */}
        {activeTab === 'adjustments' && (
          <>
            <button
              className={styles.actionBtn}
              onClick={resetTonal}
              title="Reset tonal & color adjustments"
            >
              <RotateCcw size={12} /> Reset Adjustments
            </button>
          </>
        )}

        {/* VECTOR TAB CONTEXT */}
        {activeTab === 'vector' && (
          <>
            <select
              className={styles.modeSelect}
              value={vector.mode}
              onChange={(e) => setVector({ mode: e.target.value as VectorMode })}
            >
              <option value="outline">Outline Trace</option>
              <option value="multi-color">Multi-Color K-Means</option>
              <option value="edge-detect">Edge Detect</option>
              <option value="centerline">Centerline Skeleton</option>
            </select>

            <button
              className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
              onClick={handleTraceNow}
            >
              <Play size={12} /> Trace
            </button>

            <button
              className={styles.actionBtn}
              style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}
              onClick={() => generateCutline(2.0, 3)}
              title="Generate outer perimeter vector cutline (+2mm)"
            >
              <Scissors size={12} /> Cutline (+2mm)
            </button>

            {vectorResult && (
              <button
                className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                onClick={clearVectors}
                title="Remove vector paths from canvas"
              >
                <Trash2 size={12} /> Clear
              </button>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={autoTrace}
                onChange={(e) => setAutoTrace(e.target.checked)}
              />
              Auto-trace
            </label>
          </>
        )}

        {/* DITHER TAB CONTEXT */}
        {activeTab === 'dither' && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            Real-time Substrate Dithering Engine
          </span>
        )}

        {/* DEPTH TAB CONTEXT */}
        {activeTab === 'depth' && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            Precision 16-Bit Relief Heightmap Engine
          </span>
        )}
      </div>
    </div>
  );
};
