import React, { useRef } from 'react';
import {
  Move,
  Hand,
  Play,
  Trash2,
  Plus,
  Minimize2,
  RotateCcw,
  FilePlus,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Scissors,
  Crop,
  Type,
  Minus,
} from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { useLayerStore } from '../../store/layerStore';
import { useEditStore } from '../../store/editStore';
import { useUIStore } from '../../store/uiStore';
import type { VectorMode } from '../../types/vector';
import styles from './ToolSubheader.module.css';

export const ToolSubheader: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canvasTool = useImageStore((s) => s.canvasTool);
  const setCanvasTool = useImageStore((s) => s.setCanvasTool);

  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const setActiveLayer = useLayerStore((s) => s.setActiveLayer);
  const createEmptyLayer = useLayerStore((s) => s.createEmptyLayer);
  const importImageFiles = useLayerStore((s) => s.importImageFiles);
  const mergeLayerDown = useLayerStore((s) => s.mergeLayerDown);
  const alignActiveLayer = useLayerStore((s) => s.alignActiveLayer);
  const setLayerTransform = useLayerStore((s) => s.setLayerTransform);

  const vector = useEditStore((s) => s.vector);
  const vectorResult = useEditStore((s) => s.vectorResult);
  const autoTrace = useEditStore((s) => s.autoTrace);
  const setVector = useEditStore((s) => s.setVector);
  const setAutoTrace = useEditStore((s) => s.setAutoTrace);
  const clearVectors = useEditStore((s) => s.clearVectors);
  const generateCutline = useEditStore((s) => s.generateCutline);
  const resetTonal = useEditStore((s) => s.resetTonal);

  const activeTab = useUIStore((s) => s.activeTab);
  const setTextDialogOpen = useUIStore((s) => s.setTextDialogOpen);

  const handleOpenLayer = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await importImageFiles(Array.from(e.target.files));
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleTraceNow = () => {
    setAutoTrace(true);
    setVector({ ...vector });
  };

  return (
    <div className={styles.subheader}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleOpenLayer}
      />

      {/* Left: Move / Pan Mode + Active Layer Selector */}
      <div className={styles.leftGroup}>
        <div className={styles.toolGroup}>
          <button
            className={`${styles.toolBtn} ${canvasTool === 'move' ? styles.toolBtnActive : ''}`}
            onClick={() => setCanvasTool('move')}
            title="Move Tool (V) - Drag to move the active layer, drag a corner to scale it"
          >
            <Move size={12} />
            <span>Move (V)</span>
          </button>
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
            title="Interactive Canvas Crop Tool (C) - Drag to resize canvas"
          >
            <Crop size={12} />
            <span>Crop</span>
          </button>
        </div>

        <div className={styles.divider} />

        {/* Global Active Layer Switcher & Alignment */}
        {layers.length > 0 && (
          <div className={styles.layerSelectorWrapper}>
            <span className={styles.label}>Layer:</span>
            <select
              className={styles.layerSelect}
              value={activeLayerId || (layers[0]?.id || '')}
              onChange={(e) => setActiveLayer(e.target.value)}
            >
              {layers.map((l, index) => (
                <option key={l.id} value={l.id}>
                  {index + 1}. {l.name} {index === 0 ? '(Top)' : ''}
                </option>
              ))}
            </select>

            <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
              <button
                className={styles.toolBtn}
                onClick={() => alignActiveLayer('center')}
                title="Align Layer to Center (X=0, Y=0)"
              >
                <AlignCenter size={12} />
              </button>
              <button
                className={styles.toolBtn}
                onClick={() => alignActiveLayer('left')}
                title="Align Layer to Left Canvas Edge"
              >
                <AlignLeft size={12} />
              </button>
              <button
                className={styles.toolBtn}
                onClick={() => alignActiveLayer('right')}
                title="Align Layer to Right Canvas Edge"
              >
                <AlignRight size={12} />
              </button>
            </div>

            {/* Quick Scale Adjuster */}
            {layers.find((l) => l.id === activeLayerId) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 6, borderLeft: '1px solid var(--border-subtle)', paddingLeft: 6 }}>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Scale:</span>
                <button
                  className={styles.toolBtn}
                  onClick={() => {
                    const l = layers.find((l) => l.id === activeLayerId)!;
                    const currentScale = l.transform?.scale ?? 1.0;
                    setLayerTransform(l.id, { scale: Math.max(0.1, Number((currentScale - 0.1).toFixed(2))) });
                  }}
                  title="Decrease layer scale (-10%)"
                >
                  <Minus size={11} />
                </button>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-primary)',
                    minWidth: 32,
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    const l = layers.find((l) => l.id === activeLayerId)!;
                    setLayerTransform(l.id, { scale: 1.0 });
                  }}
                  title="Click to reset scale to 100%"
                >
                  {(((layers.find((l) => l.id === activeLayerId)?.transform?.scale ?? 1.0) * 100)).toFixed(0)}%
                </span>
                <button
                  className={styles.toolBtn}
                  onClick={() => {
                    const l = layers.find((l) => l.id === activeLayerId)!;
                    const currentScale = l.transform?.scale ?? 1.0;
                    setLayerTransform(l.id, { scale: Math.min(6.0, Number((currentScale + 0.1).toFixed(2))) });
                  }}
                  title="Increase layer scale (+10%)"
                >
                  <Plus size={11} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: Dynamic Context Actions for Current Tab */}
      <div className={styles.rightGroup}>
        {/* LAYERS TAB CONTEXT */}
        {activeTab === 'layers' && (
          <>
            <button
              className={styles.actionBtn}
              onClick={() => fileInputRef.current?.click()}
              title="Import image file as a new layer"
            >
              <Plus size={12} /> Add Image
            </button>
            <button
              className={styles.actionBtn}
              onClick={() => createEmptyLayer()}
              title="Create a new blank canvas layer"
            >
              <FilePlus size={12} /> Blank Layer
            </button>
            <button
              className={styles.actionBtn}
              onClick={() => setTextDialogOpen(true)}
              title="Add custom Typography / Monogram layer"
            >
              <Type size={12} /> Text Layer
            </button>
            {activeLayerId && layers.length > 1 && (
              <button
                className={styles.actionBtn}
                onClick={() => mergeLayerDown(activeLayerId)}
                title="Merge active layer into the layer below it (Ctrl+E)"
              >
                <Minimize2 size={12} /> Merge Down
              </button>
            )}
          </>
        )}

        {/* TONAL TAB CONTEXT */}
        {activeTab === 'adjustments' && (
          <>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
              Adjusting: <strong>{layers.find((l) => l.id === activeLayerId)?.name || 'Composite'}</strong>
            </span>
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
              className={styles.layerSelect}
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
