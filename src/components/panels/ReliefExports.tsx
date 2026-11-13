import React, { useState } from 'react';
import { CheckCircle, Layers } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { useRenderStore } from '../../store/renderStore';
import { useProfilesStore } from '../../store/profilesStore';
import { exportHeightmap, reliefDepthCurve } from '../../lib/relief-export';
import { rasterExportBlocker } from '../../lib/raster-export';
import { cancelRasterExport } from '../../lib/raster-export';
import { Button } from '../shared/Button';
import { Progress } from '../shared/Progress';
import { Section } from '../shared/Section';
import { StatusMessage } from '../shared/StatusMessage';
import styles from './Panels.module.css';

const STAGE_LABEL = {
  preparing: 'Preparing the full-resolution image',
  processing: 'Computing the heightmap',
  encoding: 'Encoding',
} as const;

/**
 * The relief's one file (#46): the heightmap as a 16-bit greyscale PNG, at the
 * source's full resolution for the crop, with the document's DPI. It is the
 * heightmap the view shows, computed again at full size. LightBurn runs it
 * in Grayscale mode; the settings are listed under it in the Export panel.
 */
export const ReliefExports: React.FC = () => {
  const doc = useDocumentStore((s) => s.doc);
  const progress = useRenderStore((s) => s.exportProgress);
  useProfilesStore((s) => s.data);
  useProfilesStore((s) => s.materialId);
  useProfilesStore((s) => s.machineId);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!doc) return null;
  const blocker = rasterExportBlocker(doc);
  const curve = reliefDepthCurve();

  const run = async () => {
    setDone(false);
    setError(null);
    try {
      const file = await exportHeightmap(doc);
      if (!file) return;
      const url = URL.createObjectURL(new Blob([file.bytes], { type: file.mimeType }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.source.name.replace(/\.[^/.]+$/, '') || 'relief'}-heightmap-16bit.png`;
      a.click();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Section title="Heightmap File">
      {blocker && <div className={styles.controlNote}>{blocker}</div>}
      <div className={styles.buttonStack}>
        <Button
          variant="primary"
          icon={done ? <CheckCircle size={16} /> : <Layers size={16} />}
          onClick={() => void run()}
          disabled={blocker !== null || progress !== null}
        >
          Export Heightmap (16-bit PNG)
        </Button>
      </div>
      {progress && (
        <Progress label={STAGE_LABEL[progress.stage]} fraction={progress.stage === 'encoding' ? null : progress.fraction} onCancel={cancelRasterExport} />
      )}
      <div className={`${styles.controlNote} ${styles.stackGap}`}>
        White is the untouched surface and black the deepest point.{' '}
        {curve
          ? 'The relief calibration in use is applied, so the burn has the proportions shown.'
          : 'No relief calibration is in use: grey levels are linear, and LightBurn’s power range sets the depth.'}{' '}
        16 bits per pixel keep smooth slopes; LightBurn and CNC software read it.
      </div>
      {done && <StatusMessage tone="success">Heightmap exported.</StatusMessage>}
      {error && <StatusMessage tone="error">Export failed: {error}</StatusMessage>}
    </Section>
  );
};
