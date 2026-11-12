import React, { useState } from 'react';
import { Sparkles, Cpu, CheckCircle2, RefreshCw, Undo } from 'lucide-react';
import { useRenderStore } from '../../store/renderStore';
import { getPipeline } from '../../lib/pipeline-client';
import { Slider } from '../shared/Slider';
import styles from './Panels.module.css';

/**
 * Background removal on the preview. The result replaces the preview's source
 * pixels; it is not part of the document, so a new crop or image discards it
 * and undo does not reach it (phase 5 makes it a pipeline step).
 */
export const AIPanel: React.FC = () => {
  const source = useRenderStore((s) => s.source);
  const replaceSourcePixels = useRenderStore((s) => s.replaceSourcePixels);
  const restoreSource = useRenderStore((s) => s.restoreSource);
  const previewBuffer = source?.buffer ?? null;

  const [mode, setMode] = useState<'auto-border' | 'white-bg' | 'black-bg'>('auto-border');
  const [tolerance, setTolerance] = useState<number>(30);
  const [featherRadius, setFeatherRadius] = useState<number>(2);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // The source the removal was applied to; Restore is offered while it is shown.
  const [removedFrom, setRemovedFrom] = useState<typeof source>(null);
  const canRestore = removedFrom !== null && source !== null && source.key === removedFrom.key;

  const handleRemoveBackground = async () => {
    if (!source) return;
    // The image and crop this removal is for; checked again when the worker replies.
    const from = source;

    try {
      setIsProcessing(true);
      setStatusMessage(null);

      const worker = getPipeline();
      const result = await worker.processBgRemoval({
        buffer: from.buffer.slice(0),
        width: from.width,
        height: from.height,
        tolerance,
        featherRadius,
        mode,
      });

      if (!replaceSourcePixels(result.buffer, from)) {
        setStatusMessage('The image or crop changed while the background was being removed, so the result was discarded.');
        return;
      }
      setRemovedFrom(useRenderStore.getState().source);
      setStatusMessage(`Background removed (${result.removedPixelCount.toLocaleString()} pixels) in ${result.durationMs.toFixed(1)}ms`);
    } catch (err: unknown) {
      console.error('Failed to remove background:', err);
      setStatusMessage('Error executing background removal.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRestoreOriginal = () => {
    restoreSource();
    setRemovedFrom(null);
    setStatusMessage('Original image restored.');
  };

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>AI & Segmentation</span>
        {canRestore && (
          <button className={styles.resetButton} onClick={handleRestoreOriginal}>
            <Undo size={12} style={{ display: 'inline', marginRight: 4 }} />
            Restore
          </button>
        )}
      </div>

      {/* Client-Side Runtime Banner */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Client-Side Intelligence</div>
        <div
          style={{
            background: 'var(--bg-surface-raised)',
            padding: '12px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            marginBottom: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Cpu size={16} color="var(--accent-primary)" />
            <strong style={{ fontSize: 12 }}>Edge-Aware Matting Engine</strong>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            Multi-point perimeter flood-fill segmentation with soft Gaussian alpha feathering. 100% in-browser computation.
          </p>
        </div>
      </div>

      {/* Background Removal Controls */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Background Detection Mode</div>
        <select
          className={styles.select}
          value={mode}
          onChange={(e) => setMode(e.target.value as any)}
        >
          <option value="auto-border">Auto Border & Corner Sampling</option>
          <option value="white-bg">White Background (Clean Paper/Product)</option>
          <option value="black-bg">Black Background (Laser Burn/Dark Room)</option>
        </select>

        <Slider
          label="Color Distance Tolerance"
          value={tolerance}
          min={5}
          max={90}
          onChange={setTolerance}
          onReset={() => setTolerance(30)}
        />

        <Slider
          label="Edge Feather Radius"
          value={featherRadius}
          min={0}
          max={8}
          unit="px"
          onChange={setFeatherRadius}
          onReset={() => setFeatherRadius(2)}
        />

        <button
          className={styles.primaryActionBtn}
          onClick={handleRemoveBackground}
          disabled={isProcessing || !previewBuffer}
          style={{ marginTop: 16 }}
        >
          {isProcessing ? (
            <>
              <RefreshCw size={14} className="animate-spin" />
              Segmenting Background...
            </>
          ) : (
            <>
              <Sparkles size={14} />
              Remove Background
            </>
          )}
        </button>

        {statusMessage && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(52, 211, 153, 0.1)',
              border: '1px solid rgba(52, 211, 153, 0.25)',
              color: 'var(--accent-success)',
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <CheckCircle2 size={14} />
            <span>{statusMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
};
