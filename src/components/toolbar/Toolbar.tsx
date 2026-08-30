import React, { useRef } from 'react';
import {
  Sparkles,
  Columns,
  Flame,
  Undo2,
  Redo2,
  FolderOpen,
  Download,
  Layers,
  BookOpen,
  Trash2,
} from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { useEditStore } from '../../store/editStore';
import { useUIStore } from '../../store/uiStore';
import { loadImageFromFile } from '../../lib/image-loader';
import styles from './Toolbar.module.css';

export const Toolbar: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const metadata = useImageStore((s) => s.metadata);
  const isProcessing = useImageStore((s) => s.isProcessing);
  const durationMs = useImageStore((s) => s.processingDurationMs);
  const setImage = useImageStore((s) => s.setImage);
  const clearImage = useImageStore((s) => s.clearImage);

  const undo = useEditStore((s) => s.undo);
  const redo = useEditStore((s) => s.redo);
  const canUndo = useEditStore((s) => s.canUndo);
  const canRedo = useEditStore((s) => s.canRedo);

  const isSplitView = useUIStore((s) => s.isSplitView);
  const isInvertedBurn = useUIStore((s) => s.isInvertedBurn);
  const showVectorOverlay = useUIStore((s) => s.showVectorOverlay);
  const toggleSplitView = useUIStore((s) => s.toggleSplitView);
  const toggleInvertedBurn = useUIStore((s) => s.toggleInvertedBurn);
  const toggleVectorOverlay = useUIStore((s) => s.toggleVectorOverlay);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const setPresetDialogOpen = useUIStore((s) => s.setPresetDialogOpen);

  const handleOpenFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const result = await loadImageFromFile(file);
      setImage(
        file,
        result.originalBuffer,
        result.bitmap,
        result.metadata,
        result.previewBuffer,
        result.previewDims
      );
    }
  };

  return (
    <header className={styles.toolbar}>
      {/* Left: Branding & History */}
      <div className={styles.leftSection}>
        <div className={styles.brand} onClick={() => setActiveTab('adjustments')}>
          <Sparkles size={18} className={styles.brandIcon} />
          <span className={styles.brandTitle}>IMAGE SUITE</span>
          <span className={styles.badge}>PRECISION</span>
        </div>

        <div className={styles.divider} />

        <div className={styles.actionGroup}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleOpenFile}
          />
          <button
            className={styles.button}
            title="Open Image File"
            onClick={() => fileInputRef.current?.click()}
          >
            <FolderOpen size={14} />
            Open
          </button>

          <button
            className={styles.button}
            title="Undo (Ctrl+Z)"
            disabled={!canUndo()}
            onClick={undo}
          >
            <Undo2 size={14} />
          </button>
          <button
            className={styles.button}
            title="Redo (Ctrl+Y)"
            disabled={!canRedo()}
            onClick={redo}
          >
            <Redo2 size={14} />
          </button>
        </div>
      </div>

      {/* Center: Viewport Modes & Telemetry */}
      <div className={styles.centerSection}>
        {metadata && (
          <div className={styles.telemetryBadge}>
            <span
              className={`${styles.pulseDot} ${isProcessing ? styles.processingDot : ''}`}
            />
            <span>
              {metadata.width} × {metadata.height} px
            </span>
            <span style={{ color: 'var(--text-muted)' }}>•</span>
            <span>{metadata.dpi} DPI</span>
            <span style={{ color: 'var(--text-muted)' }}>•</span>
            <span style={{ color: 'var(--accent-primary)' }}>
              {isProcessing ? 'Computing...' : `${durationMs.toFixed(1)}ms`}
            </span>
          </div>
        )}

        {metadata && (
          <div className={styles.actionGroup}>
            <button
              className={`${styles.button} ${isSplitView ? styles.buttonActive : ''}`}
              title="Toggle Before/After Split View"
              onClick={toggleSplitView}
            >
              <Columns size={14} />
              Split
            </button>

            <button
              className={`${styles.button} ${isInvertedBurn ? styles.buttonActive : ''}`}
              title="Toggle Inverted Burn View (Dark Substrate Simulation)"
              onClick={toggleInvertedBurn}
            >
              <Flame size={14} />
              Burn View
            </button>

            <button
              className={`${styles.button} ${showVectorOverlay ? styles.buttonActive : ''}`}
              title="Toggle Vector Path Overlay"
              onClick={toggleVectorOverlay}
            >
              <Layers size={14} />
              Vectors
            </button>
          </div>
        )}
      </div>

      {/* Right: Presets, Clear & Export */}
      <div className={styles.rightSection}>
        <button
          className={styles.button}
          title="Material Substrate Presets"
          onClick={() => setPresetDialogOpen(true)}
        >
          <BookOpen size={14} />
          Presets
        </button>

        {metadata && (
          <button
            className={styles.button}
            title="Clear Current Image"
            onClick={clearImage}
          >
            <Trash2 size={14} />
          </button>
        )}

        {metadata && (
          <button
            className={styles.exportButton}
            onClick={() => setActiveTab('export')}
          >
            <Download size={14} />
            Export
          </button>
        )}
      </div>
    </header>
  );
};
