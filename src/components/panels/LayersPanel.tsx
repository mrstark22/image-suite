import React, { useRef, useState } from 'react';
import {
  Layers,
  Plus,
  FilePlus,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Image as ImageIcon,
  Minimize2,
  Type,
} from 'lucide-react';
import { useLayerStore } from '../../store/layerStore';
import { useEditStore } from '../../store/editStore';
import { useUIStore } from '../../store/uiStore';
import { Slider } from '../shared/Slider';
import type { LayerBlendMode } from '../../types/layer';
import styles from './Panels.module.css';
import layerStyles from './LayersPanel.module.css';

const BLEND_MODES: Array<{ id: LayerBlendMode; label: string }> = [
  { id: 'source-over', label: 'Normal' },
  { id: 'multiply', label: 'Multiply (Darken / Engrave)' },
  { id: 'screen', label: 'Screen (Lighten)' },
  { id: 'overlay', label: 'Overlay (High Contrast)' },
  { id: 'darken', label: 'Darken' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'color-dodge', label: 'Color Dodge' },
  { id: 'difference', label: 'Difference' },
];

export const LayersPanel: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const layers = useLayerStore((s) => s.layers);
  const activeLayerId = useLayerStore((s) => s.activeLayerId);
  const importImageFiles = useLayerStore((s) => s.importImageFiles);
  const createEmptyLayer = useLayerStore((s) => s.createEmptyLayer);
  const setTextDialogOpen = useUIStore((s) => s.setTextDialogOpen);
  const removeLayer = useLayerStore((s) => s.removeLayer);
  const duplicateLayer = useLayerStore((s) => s.duplicateLayer);
  const mergeLayerDown = useLayerStore((s) => s.mergeLayerDown);
  const flattenAllLayers = useLayerStore((s) => s.flattenAllLayers);
  const moveLayerUp = useLayerStore((s) => s.moveLayerUp);
  const moveLayerDown = useLayerStore((s) => s.moveLayerDown);
  const setLayerVisibility = useLayerStore((s) => s.setLayerVisibility);
  const setLayerLocked = useLayerStore((s) => s.setLayerLocked);
  const setLayerOpacity = useLayerStore((s) => s.setLayerOpacity);
  const setLayerBlendMode = useLayerStore((s) => s.setLayerBlendMode);
  const setLayerTransform = useLayerStore((s) => s.setLayerTransform);
  const setLayerName = useLayerStore((s) => s.setLayerName);
  const setActiveLayer = useLayerStore((s) => s.setActiveLayer);
  const clearAllLayers = useLayerStore((s) => s.clearAllLayers);

  const activeLayer = layers.find((l) => l.id === activeLayerId) || layers[0] || null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      await importImageFiles(filesArray);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleStartRename = (id: string, currentName: string) => {
    setEditingLayerId(id);
    setEditingName(currentName);
  };

  const handleFinishRename = (id: string) => {
    if (editingName.trim()) {
      setLayerName(id, editingName.trim());
    }
    setEditingLayerId(null);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Layers & Composition</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <button
            className={styles.resetButton}
            style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--accent-primary)' }}
            onClick={() => fileInputRef.current?.click()}
            title="Import image(s) as layers"
          >
            <Plus size={13} />
            Image
          </button>
          <button
            className={styles.resetButton}
            style={{ display: 'flex', alignItems: 'center', gap: 3 }}
            onClick={() => createEmptyLayer()}
            title="Create blank layer"
          >
            <FilePlus size={13} />
            Blank
          </button>
          <button
            className={styles.resetButton}
            style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--accent-primary)' }}
            onClick={() => setTextDialogOpen(true)}
            title="Add custom typography / monogram text layer"
          >
            <Type size={13} />
            Text
          </button>
        </div>
      </div>

      {/* Layer Stack List */}
      <div className={styles.section}>
        <div className={styles.sectionTitle} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Stack Order ({layers.length})</span>
          {layers.length > 1 && (
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Top (Front) to Bottom (Back)</span>
          )}
        </div>

        {layers.length === 0 ? (
          <div className={layerStyles.emptyState}>
            <Layers size={24} style={{ opacity: 0.5 }} />
            <span>No layers loaded. Import an image, blank layer, or text layer.</span>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button
                className={styles.primaryActionBtn}
                style={{ flex: 1 }}
                onClick={() => fileInputRef.current?.click()}
              >
                <Plus size={13} /> Image
              </button>
              <button
                className={styles.primaryActionBtn}
                style={{ flex: 1, backgroundColor: 'var(--bg-surface-active)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
                onClick={() => createEmptyLayer()}
              >
                <FilePlus size={13} /> Blank
              </button>
              <button
                className={styles.primaryActionBtn}
                style={{ flex: 1, backgroundColor: 'var(--bg-surface-active)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
                onClick={() => setTextDialogOpen(true)}
              >
                <Type size={13} /> Text
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {layers.map((layer, index) => {
              const isActive = layer.id === (activeLayer?.id);
              const isEditing = editingLayerId === layer.id;

              return (
                <div
                  key={layer.id}
                  className={`${layerStyles.layerItem} ${isActive ? layerStyles.layerItemActive : ''}`}
                  onClick={() => setActiveLayer(layer.id)}
                >
                  {/* Visibility toggle */}
                  <button
                    className={`${layerStyles.iconBtn} ${layer.visible ? layerStyles.iconBtnActive : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setLayerVisibility(layer.id, !layer.visible);
                    }}
                    title={layer.visible ? 'Hide Layer' : 'Show Layer'}
                  >
                    {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>

                  {/* Thumbnail / Icon */}
                  <div className={layerStyles.layerThumb}>
                    <ImageIcon size={14} />
                  </div>

                  {/* Info / Inline Rename */}
                  <div className={layerStyles.layerInfo}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editingName}
                          autoFocus
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={() => handleFinishRename(layer.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleFinishRename(layer.id);
                            if (e.key === 'Escape') setEditingLayerId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: 11,
                            padding: '1px 4px',
                            background: 'var(--bg-input)',
                            border: '1px solid var(--accent-primary)',
                            borderRadius: 3,
                            color: 'var(--text-primary)',
                            width: '100%',
                          }}
                        />
                      ) : (
                        <span
                          className={layerStyles.layerName}
                          onDoubleClick={() => handleStartRename(layer.id, layer.name)}
                          title="Double-click to rename"
                        >
                          {layer.name}
                        </span>
                      )}

                      {layers.length > 1 && index === 0 && (
                        <span style={{ fontSize: 9, color: 'var(--accent-primary)', backgroundColor: 'var(--bg-canvas)', padding: '1px 4px', borderRadius: 3, fontWeight: 600 }}>
                          FRONT
                        </span>
                      )}
                      {layers.length > 1 && index === layers.length - 1 && (
                        <span style={{ fontSize: 9, color: 'var(--text-tertiary)', backgroundColor: 'var(--bg-canvas)', padding: '1px 4px', borderRadius: 3 }}>
                          BACK
                        </span>
                      )}
                    </div>
                    <span className={layerStyles.layerMeta}>
                      {layer.previewDims ? `${layer.previewDims.width}×${layer.previewDims.height}` : 'Vector'} • {Math.round(layer.opacity * 100)}%
                    </span>
                  </div>

                  {/* Reorder & Management Actions */}
                  <div className={layerStyles.layerActions} onClick={(e) => e.stopPropagation()}>
                    <button
                      className={layerStyles.iconBtn}
                      disabled={index === 0}
                      onClick={() => moveLayerUp(layer.id)}
                      title="Bring Forward (Move Up in Stack)"
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      className={layerStyles.iconBtn}
                      disabled={index === layers.length - 1}
                      onClick={() => moveLayerDown(layer.id)}
                      title="Send Backward (Move Down in Stack)"
                    >
                      <ChevronDown size={13} />
                    </button>
                    <button
                      className={`${layerStyles.iconBtn} ${layer.locked ? layerStyles.iconBtnActive : ''}`}
                      onClick={() => setLayerLocked(layer.id, !layer.locked)}
                      title={layer.locked ? 'Unlock Layer' : 'Lock Layer'}
                    >
                      {layer.locked ? <Lock size={13} /> : <Unlock size={13} />}
                    </button>
                    <button
                      className={`${layerStyles.iconBtn} ${layerStyles.iconBtnDanger}`}
                      onClick={() => removeLayer(layer.id)}
                      title="Delete Layer"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected Layer Properties */}
      {activeLayer && (
        <>
          <div className={styles.section}>
            <div className={styles.sectionTitle} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Layer: {activeLayer.name}</span>
              <button
                className={styles.resetButton}
                style={{ fontSize: 10 }}
                onClick={() => handleStartRename(activeLayer.id, activeLayer.name)}
              >
                Rename
              </button>
            </div>

            <Slider
              label="Layer Opacity"
              value={Math.round(activeLayer.opacity * 100)}
              min={0}
              max={100}
              step={1}
              unit="%"
              onChange={(v) => setLayerOpacity(activeLayer.id, v / 100)}
              onReset={() => setLayerOpacity(activeLayer.id, 1.0)}
            />

            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
                Blend Mode
              </label>
              <select
                className={styles.select}
                value={activeLayer.blendMode || 'source-over'}
                onChange={(e) => setLayerBlendMode(activeLayer.id, e.target.value as LayerBlendMode)}
              >
                {BLEND_MODES.map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Layer Transformation */}
          <div className={styles.section}>
            <div className={styles.sectionTitle} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Placement & Transform</span>
              <button
                className={styles.resetButton}
                onClick={() => {
                  useEditStore.getState().recordHistorySnapshot();
                  setLayerTransform(activeLayer.id, { x: 0, y: 0, scale: 1.0, rotation: 0 });
                }}
              >
                Reset Transform
              </button>
            </div>

            <div className={layerStyles.transformGrid}>
              <Slider
                label="Offset X"
                value={activeLayer.transform?.x || 0}
                min={-1000}
                max={1000}
                step={1}
                unit="px"
                onChange={(v) => setLayerTransform(activeLayer.id, { x: v })}
                onReset={() => {
                  useEditStore.getState().recordHistorySnapshot();
                  setLayerTransform(activeLayer.id, { x: 0 });
                }}
              />
              <Slider
                label="Offset Y"
                value={activeLayer.transform?.y || 0}
                min={-1000}
                max={1000}
                step={1}
                unit="px"
                onChange={(v) => setLayerTransform(activeLayer.id, { y: v })}
                onReset={() => {
                  useEditStore.getState().recordHistorySnapshot();
                  setLayerTransform(activeLayer.id, { y: 0 });
                }}
              />
            </div>

            <div className={layerStyles.transformGrid} style={{ marginTop: 8 }}>
              <Slider
                label="Scale"
                value={activeLayer.transform?.scale ?? 1.0}
                min={0.1}
                max={4.0}
                step={0.05}
                unit="x"
                onChange={(v) => setLayerTransform(activeLayer.id, { scale: v })}
                onReset={() => {
                  useEditStore.getState().recordHistorySnapshot();
                  setLayerTransform(activeLayer.id, { scale: 1.0 });
                }}
              />
              <Slider
                label="Rotation"
                value={activeLayer.transform?.rotation || 0}
                min={-180}
                max={180}
                step={1}
                unit="°"
                onChange={(v) => setLayerTransform(activeLayer.id, { rotation: v })}
                onReset={() => {
                  useEditStore.getState().recordHistorySnapshot();
                  setLayerTransform(activeLayer.id, { rotation: 0 });
                }}
              />
            </div>
          </div>

          {/* Layer Actions Footer */}
          <div className={styles.section}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                className={styles.primaryActionBtn}
                style={{
                  backgroundColor: 'var(--bg-surface-active)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                }}
                onClick={() => duplicateLayer(activeLayer.id)}
              >
                <Copy size={14} /> Duplicate
              </button>

              {layers.length > 1 && (
                <button
                  className={styles.primaryActionBtn}
                  style={{
                    backgroundColor: 'var(--bg-surface-active)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                  onClick={() => mergeLayerDown(activeLayer.id)}
                  title="Merge into layer below (Ctrl+E)"
                >
                  <Minimize2 size={14} /> Merge Down
                </button>
              )}

              <button
                className={styles.primaryActionBtn}
                style={{
                  gridColumn: layers.length > 1 ? 'span 2' : 'span 1',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  color: 'var(--accent-danger)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                }}
                onClick={() => removeLayer(activeLayer.id)}
              >
                <Trash2 size={14} /> Delete Layer
              </button>
            </div>
          </div>
        </>
      )}

      {layers.length > 1 && (
        <div style={{ padding: '8px 16px', display: 'flex', gap: 8, borderTop: '1px solid var(--border-subtle)' }}>
          <button
            className={styles.resetButton}
            style={{ flex: 1, color: 'var(--text-secondary)' }}
            onClick={flattenAllLayers}
            title="Flatten all visible layers into a single image (Ctrl+Shift+E)"
          >
            Flatten Layers
          </button>
          <button
            className={styles.resetButton}
            style={{ flex: 1, color: 'var(--accent-danger)' }}
            onClick={clearAllLayers}
          >
            Clear All
          </button>
        </div>
      )}
    </div>
  );
};
