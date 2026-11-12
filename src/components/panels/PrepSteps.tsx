import React from 'react';
import { FolderOpen, Crop, X, Maximize } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { useViewStore } from '../../store/viewStore';
import { useUIStore } from '../../store/uiStore';
import { openImagePicker } from '../../lib/open-image';
import { setCrop } from '../../lib/document';
import { cropRectOf, dpiOf, fromMm, physicalSize } from '../../lib/document-size';
import styles from './Panels.module.css';

/**
 * The steps every flow starts with (#53): the image, its crop and its size.
 * Background removal, the other shared step, is the AI panel.
 */

/** Opening, replacing and closing the image. Dropping a file on the canvas opens it too. */
export const ImageStepPanel: React.FC = () => {
  const doc = useDocumentStore((s) => s.doc);
  const close = useDocumentStore((s) => s.close);

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        {doc ? (
          <div className={styles.readoutBox}>
            <div className={styles.readoutRow}>
              <span>File</span>
              <strong className={styles.readoutValue}>{doc.source.name}</strong>
            </div>
            <div className={styles.readoutRow}>
              <span>Pixels</span>
              <strong>
                {doc.source.widthPx} × {doc.source.heightPx}
              </strong>
            </div>
            {doc.source.hasAlpha && (
              <div className={styles.controlNote}>Transparent areas are treated as white: they are not burned.</div>
            )}
          </div>
        ) : (
          <div className={styles.controlNote}>Drop an image on the canvas, or open one.</div>
        )}
        <button className={`${styles.secondaryActionBtn} ${styles.stackGap}`} onClick={openImagePicker}>
          <FolderOpen size={14} /> {doc ? 'Open Another Image…' : 'Open Image…'}
        </button>
        {doc && (
          <button className={`${styles.resetButton} ${styles.stackGap}`} onClick={close}>
            Close image
          </button>
        )}
      </div>
    </div>
  );
};

/** Drawing the crop box on the canvas, and removing the crop. */
export const CropStepPanel: React.FC = () => {
  const doc = useDocumentStore((s) => s.doc);
  const edit = useDocumentStore((s) => s.edit);
  const canvasTool = useViewStore((s) => s.canvasTool);
  const setCanvasTool = useViewStore((s) => s.setCanvasTool);

  if (!doc) return <NeedsImage />;
  const crop = cropRectOf(doc);
  const cropped = doc.steps.crop !== null;

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <div className={styles.readoutBox}>
          <div className={styles.readoutRow}>
            <span>{cropped ? 'Cropped to' : 'Not cropped'}</span>
            <strong>
              {crop.width} × {crop.height} px
            </strong>
          </div>
          {cropped && (
            <div className={styles.readoutRow}>
              <span>From</span>
              <strong>
                x {crop.x}, y {crop.y}
              </strong>
            </div>
          )}
        </div>
        <button
          className={`${styles.secondaryActionBtn} ${styles.stackGap}`}
          onClick={() => setCanvasTool(canvasTool === 'crop' ? 'pan' : 'crop')}
          aria-pressed={canvasTool === 'crop'}
        >
          <Crop size={14} /> {canvasTool === 'crop' ? 'Cancel Crop Box' : cropped ? 'Crop Further…' : 'Draw Crop Box…'}
        </button>
        <button
          className={`${styles.secondaryActionBtn} ${styles.stackGap}`}
          disabled={!cropped}
          onClick={() => edit(setCrop(null))}
        >
          <X size={14} /> Remove Crop
        </button>
        <div className={`${styles.controlNote} ${styles.stackGap}`}>
          The physical size follows the crop: its scale (mm per pixel) is kept.
        </div>
      </div>
    </div>
  );
};

/** The physical size, set in the size dialog. */
export const SizeStepPanel: React.FC = () => {
  const doc = useDocumentStore((s) => s.doc);
  const setSizeDialogOpen = useUIStore((s) => s.setSizeDialogOpen);

  if (!doc) return <NeedsImage />;
  const size = physicalSize(doc);
  const dpi = dpiOf(doc);

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <div className={styles.readoutBox}>
          {size && dpi !== null ? (
            <>
              <div className={styles.readoutRow}>
                <span>Width</span>
                <strong>
                  {size.widthMm.toFixed(1)} mm ({fromMm(size.widthMm, 'in').toFixed(2)}")
                </strong>
              </div>
              <div className={styles.readoutRow}>
                <span>Height</span>
                <strong>
                  {size.heightMm.toFixed(1)} mm ({fromMm(size.heightMm, 'in').toFixed(2)}")
                </strong>
              </div>
              <div className={styles.readoutRow}>
                <span>Resolution</span>
                <strong>{dpi.toFixed(1)} DPI</strong>
              </div>
            </>
          ) : (
            <div className={styles.readoutRow}>
              <span>Size not set</span>
            </div>
          )}
        </div>
        <button className={`${styles.secondaryActionBtn} ${styles.stackGap}`} onClick={() => setSizeDialogOpen(true)}>
          <Maximize size={14} /> {size ? 'Change Size…' : 'Set Size…'}
        </button>
        <div className={`${styles.controlNote} ${styles.stackGap}`}>
          The machine and material are chosen in the top bar. They set the LightBurn settings shown at export.
        </div>
      </div>
    </div>
  );
};

/** Shown by a step that has nothing to work on yet. */
export const NeedsImage: React.FC = () => {
  const goToStep = useUIStore((s) => s.goToStep);
  return (
    <div className={styles.panel}>
      <div className={styles.emptyNote}>
        Open an image first.
        <button className={`${styles.resetButton} ${styles.stackGap}`} onClick={() => goToStep('image')}>
          Go to the Image step
        </button>
      </div>
    </div>
  );
};
