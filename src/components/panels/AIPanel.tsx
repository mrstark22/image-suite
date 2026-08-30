import React, { useState } from 'react';
import { Sparkles, Cpu, CheckCircle2, RefreshCw, Undo } from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import { getComlinkWorker } from '../../lib/comlink-setup';
import { Slider } from '../shared/Slider';
import styles from './Panels.module.css';

export const AIPanel: React.FC = () => {
  const previewBuffer = useImageStore((s) => s.previewBuffer);
  const dims = useImageStore((s) => s.previewDimensions);
  const setProcessedPreview = useImageStore((s) => s.setProcessedPreview);

  const [mode, setMode] = useState<'auto-border' | 'white-bg' | 'black-bg'>('auto-border');
  const [tolerance, setTolerance] = useState<number>(30);
  const [featherRadius, setFeatherRadius] = useState<number>(2);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [backupBuffer, setBackupBuffer] = useState<ArrayBuffer | null>(null);

  const handleRemoveBackground = async () => {
    if (!previewBuffer || !dims) return;

    try {
      setIsProcessing(true);
      setStatusMessage(null);

      // Save backup buffer for undo
      if (!backupBuffer) {
        setBackupBuffer(previewBuffer.slice(0));
      }

      const worker = getComlinkWorker();
      const bufCopy = previewBuffer.slice(0);

      const result = await worker.processBgRemoval({
        buffer: bufCopy,
        width: dims.width,
        height: dims.height,
        tolerance,
        featherRadius,
        mode,
      });

      // Update active preview buffer in store
      useImageStore.setState({
        previewBuffer: result.buffer.slice(0),
        previewProcessedBuffer: result.buffer,
      });
      setProcessedPreview(result.buffer, result.durationMs);

      setStatusMessage(`Background removed (${result.removedPixelCount.toLocaleString()} pixels) in ${result.durationMs.toFixed(1)}ms`);
    } catch (err: unknown) {
      console.error('Failed to remove background:', err);
      setStatusMessage('Error executing background removal.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRestoreOriginal = () => {
    if (!backupBuffer) return;
    useImageStore.setState({
      previewBuffer: backupBuffer.slice(0),
      previewProcessedBuffer: backupBuffer.slice(0),
    });
    setStatusMessage('Original image restored.');
  };

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>AI & Segmentation</span>
        {backupBuffer && (
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
