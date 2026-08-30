import React, { useState } from 'react';
import { Download, CheckCircle, Sun, Layers, Sparkles, Image as ImageIcon } from 'lucide-react';
import { useEditStore } from '../../store/editStore';
import { useImageStore } from '../../store/imageStore';
import { Slider } from '../shared/Slider';
import { getComlinkWorker } from '../../lib/comlink-setup';
import { encodeBmpGrayscale8, encodeBmpRgb24 } from '../../lib/bmp-encoder';
import { encodePngGrayscale16 } from '../../lib/png-encoder';
import { renderReliefPreview } from '../../lib/depth-shader';
import type { BevelStyle, DepthSource, DepthViewMode, ReliefMaterial } from '../../types/depth';
import styles from './Panels.module.css';

const DEPTH_SOURCES: Array<{ id: DepthSource; title: string; desc: string }> = [
  { id: 'ai-estimation', title: 'AI Neural Depth (WebGPU)', desc: 'True 3D monocular depth estimation for portraits & photos' },
  { id: 'tonal-height', title: 'Tonal Luminance', desc: 'Photos, portraits & shaded art relief' },
  { id: 'distance-transform', title: 'Vector & Logo Bevel', desc: 'Bounded chamfers & domes for vector graphics' },
];

const BEVEL_STYLES: Array<{ id: BevelStyle; title: string; desc: string }> = [
  { id: 'prismatic', title: 'Prismatic', desc: '45° V-Bit chamfer simulation' },
  { id: 'dome', title: 'Domed Arc', desc: 'Smooth sinusoidal convex dome' },
  { id: 'concave', title: 'Concave', desc: 'Hollow bowl carving curve' },
  { id: 'flat', title: 'Flat Island', desc: 'Stepped flat plateau with bevel' },
];

const VIEW_MODES: Array<{ id: DepthViewMode; label: string; desc: string }> = [
  { id: '3d-interactive', label: '3D Orbit Viewport', desc: 'Interactive rotating 3D surface mesh with orbit controls' },
  { id: '3d-shaded', label: '3D Relief Shaded (2D)', desc: 'Normal mapping with directional light & shadows' },
  { id: 'heatmap', label: 'False-Color Heatmap', desc: 'Spectral elevation color gradient' },
  { id: 'grayscale', label: 'Raw 2D Grayscale', desc: '16-bit heightmap data for CAM output' },
];

const MATERIALS: Array<{ id: ReliefMaterial; label: string; color: string }> = [
  { id: 'walnut', label: 'Walnut Wood', color: '#b87333' },
  { id: 'brass', label: 'Brushed Brass', color: '#e5c158' },
  { id: 'slate', label: 'Ceramic Slate', color: '#64748b' },
  { id: 'grayscale', label: 'Monochrome', color: '#94a3b8' },
];

export const DepthMapPanel: React.FC = () => {
  const depth = useEditStore((s) => s.depth);
  const setDepth = useEditStore((s) => s.setDepth);
  const previewBuffer = useImageStore((s) => s.previewBuffer);
  const dims = useImageStore((s) => s.previewDimensions);
  const metadata = useImageStore((s) => s.metadata);

  const [isExporting, setIsExporting] = useState(false);
  const [exportTypeDone, setExportTypeDone] = useState<'png16' | 'cnc' | 'shaded' | null>(null);

  // 1. Export True 16-Bit Lossless PNG Heightmap (65,536 Depth Levels for Vectric / Carbide / LightBurn)
  const handleExport16BitPng = async () => {
    if (!previewBuffer || !dims) return;

    setIsExporting(true);
    setExportTypeDone(null);

    try {
      const worker = getComlinkWorker();
      const bufCopy = previewBuffer.slice(0);
      const result = await worker.processDepth({
        buffer: bufCopy,
        width: dims.width,
        height: dims.height,
        config: depth,
      });

      const depth16Data = new Uint16Array(result.heightMapBuffer);
      const pngBytes = encodePngGrayscale16(depth16Data, dims.width, dims.height);

      const blob = new Blob([pngBytes.buffer as ArrayBuffer], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const baseName = metadata?.name.replace(/\.[^/.]+$/, '') || 'heightmap';
      a.download = `${baseName}-16Bit-CNC-Heightmap-${dims.width}x${dims.height}.png`;
      a.click();
      URL.revokeObjectURL(url);

      setExportTypeDone('png16');
      setTimeout(() => setExportTypeDone(null), 3000);
    } catch (err) {
      console.error('Failed to export 16-bit PNG heightmap:', err);
    } finally {
      setIsExporting(false);
    }
  };

  // 2. Export 8-bit CNC Heightmap BMP (Legacy 256 Grayscale Levels)
  const handleExportCncBmp = async () => {
    if (!previewBuffer || !dims) return;

    setIsExporting(true);
    setExportTypeDone(null);

    try {
      const worker = getComlinkWorker();
      const bufCopy = previewBuffer.slice(0);
      const result = await worker.processDepth({
        buffer: bufCopy,
        width: dims.width,
        height: dims.height,
        config: depth,
      });

      const depth16Data = new Uint16Array(result.heightMapBuffer);
      const dpi = metadata?.dpi || 300;

      const bmpBuffer = encodeBmpGrayscale8(depth16Data, dims.width, dims.height, dpi);
      const blob = new Blob([bmpBuffer], { type: 'image/bmp' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const baseName = metadata?.name.replace(/\.[^/.]+$/, '') || 'heightmap';
      a.download = `${baseName}-8Bit-CNC-depth-${dims.width}x${dims.height}.bmp`;
      a.click();
      URL.revokeObjectURL(url);

      setExportTypeDone('cnc');
      setTimeout(() => setExportTypeDone(null), 3000);
    } catch (err) {
      console.error('Failed to export CNC depth map BMP:', err);
    } finally {
      setIsExporting(false);
    }
  };

  // 3. Export 3D Visual Presentation Mockup (24-bit Color Shaded with Walnut/Brass Lighting)
  const handleExportShadedBmp = async () => {
    if (!previewBuffer || !dims) return;

    setIsExporting(true);
    setExportTypeDone(null);

    try {
      const worker = getComlinkWorker();
      const bufCopy = previewBuffer.slice(0);
      const result = await worker.processDepth({
        buffer: bufCopy,
        width: dims.width,
        height: dims.height,
        config: depth,
      });

      const depth16Data = new Uint16Array(result.heightMapBuffer);
      const shadedRgba = renderReliefPreview(depth16Data, dims.width, dims.height, depth);
      const dpi = metadata?.dpi || 300;

      const bmpBuffer = encodeBmpRgb24(shadedRgba, dims.width, dims.height, dpi);
      const blob = new Blob([bmpBuffer], { type: 'image/bmp' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const baseName = metadata?.name.replace(/\.[^/.]+$/, '') || 'relief';
      a.download = `${baseName}-3D-shaded-render-${depth.material || 'walnut'}-${dims.width}x${dims.height}.bmp`;
      a.click();
      URL.revokeObjectURL(url);

      setExportTypeDone('shaded');
      setTimeout(() => setExportTypeDone(null), 3000);
    } catch (err) {
      console.error('Failed to export 3D shaded relief BMP:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>3D Relief & Depth Map</span>
      </div>

      {/* 3D Preview Shading Mode */}
      <div className={styles.section}>
        <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={14} />
          <span>3D Relief View Mode</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {VIEW_MODES.map((vm) => {
            const isActive = (depth.viewMode || '3d-shaded') === vm.id;
            return (
              <button
                key={vm.id}
                className={`${styles.cardButton} ${isActive ? styles.cardButtonActive : ''}`}
                style={{ width: '100%', padding: '8px 10px' }}
                onClick={() => setDepth({ viewMode: vm.id })}
              >
                <span className={styles.cardTitle} style={{ fontSize: 12 }}>{vm.label}</span>
                <span className={styles.cardDesc}>{vm.desc}</span>
              </button>
            );
          })}
        </div>

        {/* Material Selection for 3D Shaded Mode */}
        {depth.viewMode !== 'heatmap' && depth.viewMode !== 'grayscale' && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Substrate Material
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
              {MATERIALS.map((m) => {
                const isActive = (depth.material || 'walnut') === m.id;
                return (
                  <button
                    key={m.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 8px',
                      background: isActive ? 'var(--bg-surface-active)' : 'var(--bg-surface)',
                      border: isActive ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 11,
                      color: 'var(--text-primary)',
                    }}
                    onClick={() => setDepth({ material: m.id })}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        backgroundColor: m.color,
                        display: 'inline-block',
                      }}
                    />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Source Selection Cards */}
      <div className={styles.section}>
        <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Layers size={14} />
          <span>Depth Calculation Engine</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {DEPTH_SOURCES.map((src) => {
            const isActive = depth.source === src.id;
            return (
              <button
                key={src.id}
                className={`${styles.cardButton} ${isActive ? styles.cardButtonActive : ''}`}
                style={{ width: '100%', padding: '8px 10px' }}
                onClick={() => setDepth({ source: src.id })}
              >
                <span className={styles.cardTitle} style={{ fontSize: 12 }}>{src.title}</span>
                <span className={styles.cardDesc}>{src.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Profile & Controls */}
      <div className={styles.section}>
        <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sun size={14} />
          <span>Relief & Lighting Controls</span>
        </div>

        {depth.source === 'distance-transform' && (
          <div className={styles.gridCards} style={{ marginBottom: 12 }}>
            {BEVEL_STYLES.map((b) => {
              const isActive = depth.bevelStyle === b.id;
              return (
                <button
                  key={b.id}
                  className={`${styles.cardButton} ${isActive ? styles.cardButtonActive : ''}`}
                  onClick={() => setDepth({ bevelStyle: b.id })}
                >
                  <span className={styles.cardTitle}>{b.title}</span>
                  <span className={styles.cardDesc}>{b.desc}</span>
                </button>
              );
            })}
          </div>
        )}

        <Slider
          label="Relief Depth Exaggeration"
          value={depth.depthScale}
          min={1.0}
          max={10.0}
          step={0.5}
          unit="×"
          onChange={(v) => setDepth({ depthScale: v })}
          onReset={() => setDepth({ depthScale: 3.0 })}
        />

        {depth.source === 'ai-estimation' && (
          <>
            <Slider
              label="3D AI Base Volume"
              value={depth.aiWeight ?? 75}
              min={0}
              max={100}
              step={5}
              unit="%"
              onChange={(v) => setDepth({ aiWeight: v })}
              onReset={() => setDepth({ aiWeight: 75 })}
            />

            <Slider
              label="Tonal Label & Text Relief"
              value={depth.tonalBlend ?? 35}
              min={0}
              max={100}
              step={5}
              unit="%"
              onChange={(v) => setDepth({ tonalBlend: v })}
              onReset={() => setDepth({ tonalBlend: 35 })}
            />

            <Slider
              label="Surface Denoising"
              value={depth.surfaceDenoise ?? 2.0}
              min={0}
              max={8}
              step={0.5}
              unit="px"
              onChange={(v) => setDepth({ surfaceDenoise: v })}
              onReset={() => setDepth({ surfaceDenoise: 2.0 })}
            />
          </>
        )}

        <Slider
          label="Light Source Angle"
          value={depth.lightAngle ?? 315}
          min={0}
          max={360}
          step={5}
          unit="°"
          onChange={(v) => setDepth({ lightAngle: v })}
          onReset={() => setDepth({ lightAngle: 315 })}
        />

        <Slider
          label="Anti-Terracing Smoothing"
          value={depth.smoothingRadius}
          min={0}
          max={15}
          step={0.5}
          unit="px"
          onChange={(v) => setDepth({ smoothingRadius: v })}
          onReset={() => setDepth({ smoothingRadius: 2.0 })}
        />

        <div className={styles.toggleRow} style={{ marginTop: 12 }}>
          <div>
            <div className={styles.toggleLabel}>Invert Z-Axis Height</div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
              {depth.invertZ ? 'Dark = Highest / Light = Deepest' : 'Light = Highest / Dark = Deepest (Standard CNC)'}
            </div>
          </div>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={depth.invertZ}
            onChange={(e) => setDepth({ invertZ: e.target.checked })}
          />
        </div>
      </div>

      {/* Export Actions */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Manufacturing & Render Output</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            className={styles.primaryActionBtn}
            onClick={handleExport16BitPng}
            disabled={isExporting || !previewBuffer}
            title="Lossless 16-Bit (65,536 depth levels) for Vectric, Carbide Create Pro, LightBurn"
          >
            {exportTypeDone === 'png16' ? (
              <>
                <CheckCircle size={16} color="#041019" /> 16-Bit Heightmap Exported (.PNG)
              </>
            ) : (
              <>
                <Layers size={16} /> Export 16-Bit CNC Heightmap (.PNG)
              </>
            )}
          </button>

          <button
            className={styles.primaryActionBtn}
            style={{
              backgroundColor: 'var(--bg-surface-active)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            }}
            onClick={handleExportCncBmp}
            disabled={isExporting || !previewBuffer}
            title="Standard 8-Bit (256 depth levels) Windows Grayscale BMP"
          >
            {exportTypeDone === 'cnc' ? (
              <>
                <CheckCircle size={16} color="var(--accent-primary)" /> 8-Bit CNC Heightmap Exported (.BMP)
              </>
            ) : (
              <>
                <Download size={16} /> Export 8-Bit CNC Heightmap (.BMP)
              </>
            )}
          </button>

          <button
            className={styles.primaryActionBtn}
            style={{
              backgroundColor: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px dashed var(--border-subtle)',
            }}
            onClick={handleExportShadedBmp}
            disabled={isExporting || !previewBuffer}
            title="24-Bit Color Presentation Mockup Render (with substrate lighting & shadows)"
          >
            {exportTypeDone === 'shaded' ? (
              <>
                <CheckCircle size={16} color="var(--accent-primary)" /> Presentation Render Exported (.BMP)
              </>
            ) : (
              <>
                <ImageIcon size={16} /> Export 3D Presentation Render (.BMP)
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
