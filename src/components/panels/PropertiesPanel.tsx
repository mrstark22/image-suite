/**
 * Image Suite — Unified Properties Inspector & Scene Tree Panel
 * Context-aware properties inspector displaying live transform, appearance, typography,
 * shape geometry, stroke/fill styling, and CAM parameters for selected scene nodes.
 */

import React from 'react';
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Copy,
  FolderPlus,
  ArrowUp,
  ArrowDown,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Layers,
} from 'lucide-react';
import { useSceneStore, type CanvasUnit } from '../../core/scene-store';
import { useEditStore } from '../../store/editStore';
import { useLayerStore } from '../../store/layerStore';
import type { SolidFill } from '../../core/scene-graph';
import type { LayerBlendMode } from '../../types/layer';
import styles from './PropertiesPanel.module.css';

export const PropertiesPanel: React.FC = () => {
  const documentWidth = useSceneStore((s) => s.documentWidth);
  const documentHeight = useSceneStore((s) => s.documentHeight);
  const dpi = useSceneStore((s) => s.dpi);
  const unit = useSceneStore((s) => s.unit);
  const setDocumentSize = useSceneStore((s) => s.setDocumentSize);

  const selectedIds = useSceneStore((s) => s.selectedIds);
  const nodes = useSceneStore((s) => s.nodes);
  const rootOrder = useSceneStore((s) => s.rootOrder);
  const selectNode = useSceneStore((s) => s.selectNode);
  const removeNode = useSceneStore((s) => s.removeNode);
  const updateNode = useSceneStore((s) => s.updateNode);
  const updateNodeTransform = useSceneStore((s) => s.updateNodeTransform);
  const removeSelected = useSceneStore((s) => s.removeSelected);
  const duplicateSelected = useSceneStore((s) => s.duplicateSelected);
  const groupSelected = useSceneStore((s) => s.groupSelected);
  const bringForward = useSceneStore((s) => s.bringForward);
  const sendBackward = useSceneStore((s) => s.sendBackward);
  const alignSelected = useSceneStore((s) => s.alignSelected);

  const selectedNodes = selectedIds.map((id) => nodes.get(id)!).filter(Boolean);
  const primaryNode = selectedNodes[0];

  const handleDeleteSelected = () => {
    const layers = useLayerStore.getState().layers;
    for (const node of selectedNodes) {
      const matchingLayer = layers.find(
        (l) => l.id === node.id || l.name === node.name
      );
      if (matchingLayer) {
        useLayerStore.getState().removeLayer(matchingLayer.id);
      }
    }
    removeSelected();
  };

  const handleDeleteNode = (id: string) => {
    const targetNode = nodes.get(id);
    if (targetNode) {
      const layers = useLayerStore.getState().layers;
      const matchingLayer = layers.find(
        (l) => l.id === targetNode.id || l.name === targetNode.name
      );
      if (matchingLayer) {
        useLayerStore.getState().removeLayer(matchingLayer.id);
      }
    }
    removeNode(id);
  };

  // ----------------------------------------------------
  // Document Properties (When Nothing is Selected)
  // ----------------------------------------------------
  if (!primaryNode) {
    return (
      <aside className={styles.panelContainer}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>
            <Layers size={14} />
            <span>Document & Scene</span>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Canvas Dimensions</div>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Width (px)</label>
              <input
                type="number"
                className={styles.input}
                value={documentWidth}
                onChange={(e) => setDocumentSize(Number(e.target.value) || 100, documentHeight, dpi, unit)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Height (px)</label>
              <input
                type="number"
                className={styles.input}
                value={documentHeight}
                onChange={(e) => setDocumentSize(documentWidth, Number(e.target.value) || 100, dpi, unit)}
              />
            </div>
          </div>

          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>DPI / Resolution</label>
              <select
                className={styles.select}
                value={dpi}
                onChange={(e) => setDocumentSize(documentWidth, documentHeight, Number(e.target.value), unit)}
              >
                <option value={72}>72 DPI (Web)</option>
                <option value={150}>150 DPI (Draft)</option>
                <option value={300}>300 DPI (Print / Laser)</option>
                <option value={600}>600 DPI (High Precision)</option>
                <option value={1200}>1200 DPI (Ultra Fine)</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Working Unit</label>
              <select
                className={styles.select}
                value={unit}
                onChange={(e) => setDocumentSize(documentWidth, documentHeight, dpi, e.target.value as CanvasUnit)}
              >
                <option value="mm">Metric (mm)</option>
                <option value="in">Imperial (inches)</option>
                <option value="px">Pixels (px)</option>
              </select>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            <span>Scene Objects ({nodes.size})</span>
          </div>
          {rootOrder.slice().reverse().map((id) => {
            const node = nodes.get(id);
            if (!node) return null;
            return (
              <div
                key={id}
                className={styles.treeItem}
                onClick={() => selectNode(id, false)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className={styles.typeBadge}>{node.type}</span>
                  <span style={{ fontWeight: 500 }}>{node.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      updateNode(id, { visible: !node.visible });
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}
                    title={node.visible ? 'Hide Object' : 'Show Object'}
                  >
                    {node.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      updateNode(id, { locked: !node.locked });
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}
                    title={node.locked ? 'Unlock Object' : 'Lock Object'}
                  >
                    {node.locked ? <Lock size={12} /> : <Unlock size={12} />}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteNode(id);
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}
                    title="Delete Object"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    );
  }

  // ----------------------------------------------------
  // Selected Node Properties Inspector
  // ----------------------------------------------------
  const t = primaryNode.transform;

  return (
    <aside className={styles.panelContainer}>
      {/* Header */}
      <div className={styles.panelHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={styles.typeBadge}>{primaryNode.type}</span>
          <input
            type="text"
            className={styles.input}
            style={{ fontWeight: 600, width: 140, padding: '3px 6px' }}
            value={primaryNode.name}
            onChange={(e) => updateNode(primaryNode.id, { name: e.target.value })}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => updateNode(primaryNode.id, { visible: !primaryNode.visible })}
            className={styles.btn}
            style={{ padding: '4px 6px' }}
            title="Toggle Visibility"
          >
            {primaryNode.visible ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
          <button
            onClick={() => updateNode(primaryNode.id, { locked: !primaryNode.locked })}
            className={styles.btn}
            style={{ padding: '4px 6px' }}
            title="Toggle Lock"
          >
            {primaryNode.locked ? <Lock size={13} /> : <Unlock size={13} />}
          </button>
        </div>
      </div>

      {/* Transform & Placement Section */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Transform & Coordinates</div>
        <div className={styles.grid2}>
          <div className={styles.field}>
            <label className={styles.label}>Position X (px)</label>
            <input
              type="number"
              className={styles.input}
              value={Math.round(t.x)}
              onFocus={() => useEditStore.getState().beginAdjustment()}
              onBlur={() => useEditStore.getState().commitAdjustment()}
              onChange={(e) => updateNodeTransform(primaryNode.id, { x: Number(e.target.value) || 0 })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Position Y (px)</label>
            <input
              type="number"
              className={styles.input}
              value={Math.round(t.y)}
              onFocus={() => useEditStore.getState().beginAdjustment()}
              onBlur={() => useEditStore.getState().commitAdjustment()}
              onChange={(e) => updateNodeTransform(primaryNode.id, { y: Number(e.target.value) || 0 })}
            />
          </div>
        </div>

        <div className={styles.grid2}>
          <div className={styles.field}>
            <label className={styles.label}>Width (px)</label>
            <input
              type="number"
              className={styles.input}
              value={Math.round(t.width * t.scaleX)}
              onFocus={() => useEditStore.getState().beginAdjustment()}
              onBlur={() => useEditStore.getState().commitAdjustment()}
              onChange={(e) => {
                const targetW = Number(e.target.value) || 1;
                updateNodeTransform(primaryNode.id, { scaleX: targetW / t.width });
              }}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Height (px)</label>
            <input
              type="number"
              className={styles.input}
              value={Math.round(t.height * t.scaleY)}
              onFocus={() => useEditStore.getState().beginAdjustment()}
              onBlur={() => useEditStore.getState().commitAdjustment()}
              onChange={(e) => {
                const targetH = Number(e.target.value) || 1;
                updateNodeTransform(primaryNode.id, { scaleY: targetH / t.height });
              }}
            />
          </div>
        </div>

        <div className={styles.grid2}>
          <div className={styles.field}>
            <label className={styles.label}>Rotation (°)</label>
            <input
              type="number"
              className={styles.input}
              value={t.rotation}
              onFocus={() => useEditStore.getState().beginAdjustment()}
              onBlur={() => useEditStore.getState().commitAdjustment()}
              onChange={(e) => updateNodeTransform(primaryNode.id, { rotation: Number(e.target.value) || 0 })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Scale ({((t.scaleX + t.scaleY) / 2 * 100).toFixed(0)}%)</label>
            <input
              type="range"
              min="0.1"
              max="5.0"
              step="0.05"
              className={styles.slider}
              value={t.scaleX}
              onPointerDown={() => useEditStore.getState().beginAdjustment()}
              onPointerUp={() => useEditStore.getState().commitAdjustment()}
              onChange={(e) => {
                const sc = Number(e.target.value);
                updateNodeTransform(primaryNode.id, { scaleX: sc, scaleY: sc });
              }}
            />
          </div>
        </div>

        {/* Alignment quick buttons */}
        <div style={{ marginTop: 8 }}>
          <label className={styles.label}>Canvas Alignment</label>
          <div className={styles.btnGroup} style={{ marginTop: 4 }}>
            <button className={styles.btn} onClick={() => alignSelected('left')} title="Align Left">L</button>
            <button className={styles.btn} onClick={() => alignSelected('center-h')} title="Center Horizontal">C-H</button>
            <button className={styles.btn} onClick={() => alignSelected('right')} title="Align Right">R</button>
            <button className={styles.btn} onClick={() => alignSelected('top')} title="Align Top">T</button>
            <button className={styles.btn} onClick={() => alignSelected('center-v')} title="Center Vertical">C-V</button>
            <button className={styles.btn} onClick={() => alignSelected('bottom')} title="Align Bottom">B</button>
          </div>
        </div>
      </div>

      {/* Appearance Section */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Appearance & Blending</div>
        <div className={styles.field} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <label className={styles.label}>Opacity</label>
            <span className={styles.valueBadge}>{(primaryNode.opacity * 100).toFixed(0)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            className={styles.slider}
            value={primaryNode.opacity}
            onChange={(e) => updateNode(primaryNode.id, { opacity: Number(e.target.value) })}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Blend Mode</label>
          <select
            className={styles.select}
            value={primaryNode.blendMode}
            onChange={(e) => updateNode(primaryNode.id, { blendMode: e.target.value as LayerBlendMode })}
          >
            <option value="source-over">Normal</option>
            <option value="multiply">Multiply (Darken)</option>
            <option value="screen">Screen (Lighten)</option>
            <option value="overlay">Overlay</option>
            <option value="darken">Darken</option>
            <option value="lighten">Lighten</option>
            <option value="color-dodge">Color Dodge</option>
            <option value="color-burn">Color Burn</option>
            <option value="difference">Difference</option>
          </select>
        </div>
      </div>

      {/* Typography Section (Text Nodes) */}
      {primaryNode.type === 'text' && primaryNode.textData && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Typography & Text</div>
          <div className={styles.field} style={{ marginBottom: 10 }}>
            <label className={styles.label}>Text Content</label>
            <textarea
              className={styles.input}
              rows={3}
              value={primaryNode.textData.text}
              onChange={(e) =>
                updateNode(primaryNode.id, {
                  textData: { ...primaryNode.textData!, text: e.target.value },
                })
              }
            />
          </div>

          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Font Family</label>
              <select
                className={styles.select}
                value={primaryNode.textData.fontFamily}
                onChange={(e) =>
                  updateNode(primaryNode.id, {
                    textData: { ...primaryNode.textData!, fontFamily: e.target.value },
                  })
                }
              >
                <option value="Inter, sans-serif">Inter (Sans)</option>
                <option value="Impact, sans-serif">Impact (Headline)</option>
                <option value="Georgia, serif">Georgia (Serif)</option>
                <option value="Courier New, monospace">Courier (Mono)</option>
                <option value="'Brush Script MT', cursive">Brush Script (Cursive)</option>
                <option value="'Arial Black', sans-serif">Arial Black (Bold)</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Font Size ({primaryNode.textData.fontSize}px)</label>
              <input
                type="range"
                min="14"
                max="200"
                className={styles.slider}
                value={primaryNode.textData.fontSize}
                onChange={(e) =>
                  updateNode(primaryNode.id, {
                    textData: { ...primaryNode.textData!, fontSize: Number(e.target.value) },
                  })
                }
              />
            </div>
          </div>

          <div className={styles.btnGroup} style={{ marginTop: 8 }}>
            <button
              className={`${styles.btn} ${primaryNode.textData.textAlign === 'left' ? styles.treeItemActive : ''}`}
              onClick={() => updateNode(primaryNode.id, { textData: { ...primaryNode.textData!, textAlign: 'left' } })}
            >
              <AlignLeft size={12} /> Left
            </button>
            <button
              className={`${styles.btn} ${primaryNode.textData.textAlign === 'center' ? styles.treeItemActive : ''}`}
              onClick={() => updateNode(primaryNode.id, { textData: { ...primaryNode.textData!, textAlign: 'center' } })}
            >
              <AlignCenter size={12} /> Center
            </button>
            <button
              className={`${styles.btn} ${primaryNode.textData.textAlign === 'right' ? styles.treeItemActive : ''}`}
              onClick={() => updateNode(primaryNode.id, { textData: { ...primaryNode.textData!, textAlign: 'right' } })}
            >
              <AlignRight size={12} /> Right
            </button>
          </div>
        </div>
      )}

      {/* Shape / Vector Styling Section */}
      {(primaryNode.type === 'shape' || primaryNode.type === 'vector') && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Vector Fill & Stroke</div>
          <div className={styles.grid2}>
            <div className={styles.field}>
              <label className={styles.label}>Fill Color</label>
              <input
                type="color"
                className={styles.input}
                style={{ height: 32, padding: 2 }}
                value={(primaryNode.fill as SolidFill)?.color || '#38bdf8'}
                onChange={(e) =>
                  updateNode(primaryNode.id, {
                    fill: { type: 'solid', color: e.target.value, opacity: 1.0 },
                  })
                }
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Stroke Color</label>
              <input
                type="color"
                className={styles.input}
                style={{ height: 32, padding: 2 }}
                value={primaryNode.stroke?.color || '#ffffff'}
                onChange={(e) =>
                  updateNode(primaryNode.id, {
                    stroke: {
                      color: e.target.value,
                      width: primaryNode.stroke?.width || 2,
                      opacity: 1.0,
                      lineCap: 'round',
                      lineJoin: 'round',
                    },
                  })
                }
              />
            </div>
          </div>

          <div className={styles.field}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label className={styles.label}>Stroke Width</label>
              <span className={styles.valueBadge}>{primaryNode.stroke?.width || 0}px</span>
            </div>
            <input
              type="range"
              min="0"
              max="20"
              step="0.5"
              className={styles.slider}
              value={primaryNode.stroke?.width || 0}
              onChange={(e) =>
                updateNode(primaryNode.id, {
                  stroke: {
                    color: primaryNode.stroke?.color || '#38bdf8',
                    width: Number(e.target.value),
                    opacity: 1.0,
                    lineCap: 'round',
                    lineJoin: 'round',
                  },
                })
              }
            />
          </div>
        </div>
      )}

      {/* Layer Z-Order Actions & Operations */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Layer & Hierarchy Actions</div>
        <div className={styles.btnGroup} style={{ marginBottom: 6 }}>
          <button className={styles.btn} onClick={() => bringForward(primaryNode.id)}>
            <ArrowUp size={12} /> Bring Forward
          </button>
          <button className={styles.btn} onClick={() => sendBackward(primaryNode.id)}>
            <ArrowDown size={12} /> Send Backward
          </button>
        </div>

        <div className={styles.btnGroup}>
          <button className={styles.btn} onClick={duplicateSelected}>
            <Copy size={12} /> Duplicate
          </button>
          {selectedNodes.length > 1 && (
            <button className={styles.btn} onClick={() => groupSelected()}>
              <FolderPlus size={12} /> Group
            </button>
          )}
          <button
            className={styles.btn}
            onClick={handleDeleteSelected}
            style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
            title="Delete Selected Node(s)"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </div>
    </aside>
  );
};
