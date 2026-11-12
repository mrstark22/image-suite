import React, { useState } from 'react';
import { Sparkles, Cpu, RefreshCw, Undo } from 'lucide-react';
import { useRenderStore } from '../../store/renderStore';
import { getPipeline } from '../../lib/pipeline-client';
import { Slider } from '../shared/Slider';
import { Button } from '../shared/Button';
import { Section } from '../shared/Section';
import { Select, type SelectOption } from '../shared/Select';
import { StatusMessage, type Status } from '../shared/StatusMessage';
import styles from './Panels.module.css';

type BgMode = 'auto-border' | 'white-bg' | 'black-bg';

const MODE_OPTIONS: SelectOption<BgMode>[] = [
  { value: 'auto-border', label: 'Auto Border & Corner Sampling' },
  { value: 'white-bg', label: 'White Background (Clean Paper/Product)' },
  { value: 'black-bg', label: 'Black Background (Laser Burn/Dark Room)' },
];

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

  const [mode, setMode] = useState<BgMode>('auto-border');
  const [tolerance, setTolerance] = useState<number>(30);
  const [featherRadius, setFeatherRadius] = useState<number>(2);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [status, setStatus] = useState<Status | null>(null);
  // The source the removal was applied to; Restore is offered while it is shown.
  const [removedFrom, setRemovedFrom] = useState<typeof source>(null);
  const canRestore = removedFrom !== null && source !== null && source.key === removedFrom.key;

  const handleRemoveBackground = async () => {
    if (!source) return;
    // The image and crop this removal is for; checked again when the worker replies.
    const from = source;

    try {
      setIsProcessing(true);
      setStatus(null);

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
        setStatus({
          tone: 'warning',
          text: 'The image or crop changed while the background was being removed, so the result was discarded.',
        });
        return;
      }
      setRemovedFrom(useRenderStore.getState().source);
      setStatus({
        tone: 'success',
        text: `Background removed (${result.removedPixelCount.toLocaleString()} pixels) in ${result.durationMs.toFixed(1)}ms`,
      });
    } catch (err: unknown) {
      console.error('Failed to remove background:', err);
      setStatus({
        tone: 'error',
        text: `Background removal failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRestoreOriginal = () => {
    restoreSource();
    setRemovedFrom(null);
    setStatus({ tone: 'info', text: 'Original image restored.' });
  };

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>AI & Segmentation</span>
        {canRestore && (
          <Button variant="link" icon={<Undo size={12} />} onClick={handleRestoreOriginal}>
            Restore
          </Button>
        )}
      </div>

      {/* Client-Side Runtime Banner */}
      <Section title="Client-Side Intelligence">
        <div className={styles.infoCard}>
          <div className={styles.infoCardTitle}>
            <Cpu size={16} aria-hidden="true" />
            <strong>Edge-Aware Matting Engine</strong>
          </div>
          <p className={styles.infoCardText}>
            Multi-point perimeter flood-fill segmentation with soft Gaussian alpha feathering. 100% in-browser computation.
          </p>
        </div>
      </Section>

      {/* Background Removal Controls */}
      <Section title="Background Detection Mode">
        <Select
          label="Background detection mode"
          labelHidden
          value={mode}
          options={MODE_OPTIONS}
          onChange={setMode}
        />

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

        <Button
          variant="primary"
          className={styles.actionGap}
          icon={isProcessing ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
          onClick={handleRemoveBackground}
          disabled={isProcessing || !previewBuffer}
        >
          {isProcessing ? 'Segmenting Background...' : 'Remove Background'}
        </Button>

        {status && (
          <StatusMessage tone={status.tone} className={styles.statusGap}>
            {status.text}
          </StatusMessage>
        )}
      </Section>
    </div>
  );
};
