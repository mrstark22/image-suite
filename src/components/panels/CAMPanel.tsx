/**
 * Image Suite — Professional CAM & Fabrication Control Panel
 * Manages laser/CNC operations, tool geometry, feeds/speeds, kerf compensation,
 * toolpath simulation, and direct G-code / LightBurn export.
 */

import React, { useEffect } from 'react';
import {
  Cpu,
  Play,
  Download,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Info,
} from 'lucide-react';
import { useCAMStore } from '../../core/cam-store';
import { generateGCode, DEFAULT_GCODE_CONFIG } from '../../core/gcode-export';
import { generateLightBurnProject } from '../../core/lbrn-export';
import { useSceneStore } from '../../core/scene-store';
import styles from './CAMPanel.module.css';

export const CAMPanel: React.FC = () => {
  const operations = useCAMStore((s) => s.operations);
  const updateOperation = useCAMStore((s) => s.updateOperation);
  const addOperation = useCAMStore((s) => s.addOperation);
  const removeOperation = useCAMStore((s) => s.removeOperation);
  const toggleOperation = useCAMStore((s) => s.toggleOperation);
  const gcodeFlavor = useCAMStore((s) => s.gcodeFlavor);
  const setGcodeFlavor = useCAMStore((s) => s.setGcodeFlavor);
  const activeSimulation = useCAMStore((s) => s.activeSimulation);
  const showToolpaths = useCAMStore((s) => s.showToolpaths);
  const toggleShowToolpaths = useCAMStore((s) => s.toggleShowToolpaths);
  const isCalculating = useCAMStore((s) => s.isCalculating);
  const calculateToolpaths = useCAMStore((s) => s.calculateToolpaths);
  const simulationProgress = useCAMStore((s) => s.simulationProgress);
  const setSimulationProgress = useCAMStore((s) => s.setSimulationProgress);

  const nodes = useSceneStore((s) => s.nodes);

  // Auto-calculate on initial tab open
  useEffect(() => {
    calculateToolpaths();
  }, []);

  const handleDownloadGCode = () => {
    if (!activeSimulation) calculateToolpaths();
    const sim = useCAMStore.getState().activeSimulation;
    if (!sim) return;

    const gcode = generateGCode(sim, { ...DEFAULT_GCODE_CONFIG, flavor: gcodeFlavor });
    const blob = new Blob([gcode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `toolpaths-${Date.now()}.nc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadLightBurn = () => {
    const lbrn = generateLightBurnProject(operations, nodes);
    const blob = new Blob([lbrn], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project-${Date.now()}.lbrn2`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className={styles.camContainer}>
      <div className={styles.camHeader}>
        <div className={styles.camTitle}>
          <Cpu size={15} />
          <span>CAM & Fabrication</span>
        </div>
        <button
          className={styles.btnSecondary}
          style={{ width: 'auto', padding: '4px 8px', marginTop: 0 }}
          onClick={toggleShowToolpaths}
          title={showToolpaths ? 'Hide Toolpath Overlay' : 'Show Toolpath Overlay'}
        >
          {showToolpaths ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
      </div>

      {/* Overview & Live Status */}
      <div style={{ padding: '8px 10px', background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: 6, marginBottom: 12, fontSize: 11, lineHeight: 1.4, color: 'var(--text-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-primary)', fontWeight: 600, marginBottom: 2 }}>
          <Info size={13} />
          <span>Machine CAM Engine</span>
        </div>
        Translates shapes, vector traces, and raster layers into CNC cut depths, laser powers, and multi-pass G-code toolpaths.
      </div>

      {/* Machine Dialect / Flavor */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Machine Post-Processor</div>
        <div className={styles.field}>
          <label className={styles.label}>Controller Dialect</label>
          <select
            className={styles.select}
            value={gcodeFlavor}
            onChange={(e) => setGcodeFlavor(e.target.value as any)}
          >
            <option value="grbl-laser">GRBL / LaserGRBL (M4 Dynamic Laser)</option>
            <option value="grbl-cnc">GRBL CNC Router (Spindle M3/M5)</option>
            <option value="marlin">Marlin 3D Printer / CNC</option>
          </select>
        </div>
      </div>

      {/* Operations List */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <span>CAM Operations ({operations.length})</span>
        </div>

        {operations.map((op) => (
          <div key={op.id} className={styles.opCard}>
            <div className={styles.opHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={op.enabled}
                  onChange={() => toggleOperation(op.id)}
                  title="Enable/Disable Operation"
                />
                <span className={styles.colorDot} style={{ backgroundColor: op.color }} />
                <input
                  type="text"
                  className={styles.input}
                  style={{ width: 140, padding: '2px 4px', fontWeight: 600 }}
                  value={op.name}
                  onChange={(e) => updateOperation(op.id, { name: e.target.value })}
                />
              </div>
              <button
                onClick={() => removeOperation(op.id)}
                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                title="Delete operation"
              >
                <Trash2 size={12} />
              </button>
            </div>

            {op.mode === 'laser' ? (
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label className={styles.label}>Speed (mm/min)</label>
                  <input
                    type="number"
                    className={styles.input}
                    value={op.speedMmMin || 500}
                    onChange={(e) => updateOperation(op.id, { speedMmMin: Number(e.target.value) })}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Power ({op.powerPercent || 100}%)</label>
                  <input
                    type="number"
                    className={styles.input}
                    value={op.powerPercent || 100}
                    onChange={(e) => updateOperation(op.id, { powerPercent: Number(e.target.value) })}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Passes</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    className={styles.input}
                    value={op.passes || 1}
                    onChange={(e) => updateOperation(op.id, { passes: Number(e.target.value) })}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Kerf Offset (mm)</label>
                  <input
                    type="number"
                    step={0.05}
                    className={styles.input}
                    value={op.kerfOffsetMm || 0}
                    onChange={(e) => updateOperation(op.id, { kerfOffsetMm: Number(e.target.value) })}
                  />
                </div>
              </div>
            ) : (
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label className={styles.label}>Total Depth (mm)</label>
                  <input
                    type="number"
                    step={0.5}
                    className={styles.input}
                    value={op.totalDepthMm || 3.0}
                    onChange={(e) => updateOperation(op.id, { totalDepthMm: Number(e.target.value) })}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Pass Depth (mm)</label>
                  <input
                    type="number"
                    step={0.5}
                    className={styles.input}
                    value={op.depthPerPassMm || 1.5}
                    onChange={(e) => updateOperation(op.id, { depthPerPassMm: Number(e.target.value) })}
                  />
                </div>
              </div>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          <button className={styles.btnSecondary} onClick={() => addOperation('laser-cut')}>
            <Plus size={11} /> + Cut
          </button>
          <button className={styles.btnSecondary} onClick={() => addOperation('laser-score')}>
            <Plus size={11} /> + Score
          </button>
          <button className={styles.btnSecondary} onClick={() => addOperation('cnc-vcarve')}>
            <Plus size={11} /> + V-Carve
          </button>
        </div>
      </div>

      {/* Toolpath Calculation & Simulation Player */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Toolpath Simulator</div>
        <button className={styles.btnAction} onClick={calculateToolpaths} disabled={isCalculating}>
          <Play size={13} /> {isCalculating ? 'Computing Toolpaths...' : 'Calculate Toolpaths'}
        </button>

        {activeSimulation && (
          <>
            <div className={styles.telemetryBox}>
              <div className={styles.telemetryRow}>
                <span>Cut Distance:</span>
                <strong>{activeSimulation.totalCutLengthMm.toFixed(1)} mm</strong>
              </div>
              <div className={styles.telemetryRow}>
                <span>Rapid Distance:</span>
                <strong>{activeSimulation.totalRapidLengthMm.toFixed(1)} mm</strong>
              </div>
              <div className={styles.telemetryRow}>
                <span>Estimated Run Time:</span>
                <strong>{Math.ceil(activeSimulation.totalEstimatedTimeSec / 60)} min</strong>
              </div>
            </div>

            {/* Simulation Motion Scrubber */}
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-secondary)' }}>
                <span>Simulation Scrubber</span>
                <span style={{ fontFamily: 'monospace' }}>{(simulationProgress * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.01"
                max="1.0"
                step="0.01"
                style={{ width: '100%', accentColor: 'var(--accent-primary)', marginTop: 4 }}
                value={simulationProgress}
                onChange={(e) => setSimulationProgress(Number(e.target.value))}
              />
            </div>
          </>
        )}
      </div>

      {/* G-Code & LightBurn Export */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Machine Code Export</div>
        <button className={styles.btnAction} onClick={handleDownloadGCode}>
          <Download size={13} /> Export G-Code (.nc)
        </button>
        <button className={styles.btnSecondary} onClick={handleDownloadLightBurn}>
          <Download size={13} /> Export LightBurn (.lbrn2)
        </button>
      </div>
    </aside>
  );
};
