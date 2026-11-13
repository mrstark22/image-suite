import type { SizeOrigin } from '../../types/document';
import React from 'react';
import { FolderOpen, Crop, X, Maximize, RotateCcw, RotateCw } from 'lucide-react';
import { useDocumentStore } from '../../store/documentStore';
import { useViewStore } from '../../store/viewStore';
import { useUIStore } from '../../store/uiStore';
import { openImagePicker } from '../../lib/open-image';
import { rotate, setCrop } from '../../lib/document';
import { cropRectOf, describePhysicalSize, dpiOf, fromMm, physicalSize } from '../../lib/document-size';
import { Button } from '../shared/Button';
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
        <Button className={styles.stackGap} icon={<FolderOpen size={14} />} onClick={openImagePicker}>
          {doc ? 'Open Another Image…' : 'Open Image…'}
        </Button>
        {doc && (
          <Button variant="link" className={styles.stackGap} onClick={close}>
            Close image
          </Button>
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
        <Button
          className={styles.stackGap}
          icon={<Crop size={14} />}
          onClick={() => setCanvasTool(canvasTool === 'crop' ? 'pan' : 'crop')}
          aria-pressed={canvasTool === 'crop'}
        >
          {canvasTool === 'crop' ? 'Cancel Crop Box' : cropped ? 'Crop Further…' : 'Draw Crop Box…'}
        </Button>
        <Button className={styles.stackGap} icon={<X size={14} />} disabled={!cropped} onClick={() => edit(setCrop(null))}>
          Remove Crop
        </Button>
        <div className={`${styles.controlNote} ${styles.stackGap}`}>
          The physical size follows the crop: its scale (mm per pixel) is kept.
        </div>
      </div>
      <div className={styles.section}>
        <div className={styles.readoutBox}>
          <div className={styles.readoutRow}>
            <span>Turned</span>
            <strong>{doc.steps.rotation === 0 ? 'Not turned' : `${doc.steps.rotation}° clockwise`}</strong>
          </div>
        </div>
        <Button className={styles.stackGap} icon={<RotateCcw size={14} />} onClick={() => edit(rotate('ccw'))}>
          Turn Left 90°
        </Button>
        <Button className={styles.stackGap} icon={<RotateCw size={14} />} onClick={() => edit(rotate('cw'))}>
          Turn Right 90°
        </Button>
        <div className={`${styles.controlNote} ${styles.stackGap}`}>
          For a scan or photo that came in sideways. The crop turns with the image, and width and height swap.
        </div>
      </div>
    </div>
  );
};

/** Where the size came from, in words. */
const SIZE_ORIGIN_NOTE: Record<SizeOrigin, string> = {
  file: 'From the resolution saved in the file.',
  assumed: 'Assumed: the file does not say how big it is. Set the real size before you burn.',
  user: 'Set by you.',
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
              {doc.sizeOrigin === 'assumed' && (
                <div className={`${styles.readoutRow} ${styles.sizeAssumed}`}>
                  <strong>{describePhysicalSize(doc)}</strong>
                </div>
              )}
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
              <div className={styles.controlNote}>{SIZE_ORIGIN_NOTE[doc.sizeOrigin]}</div>
            </>
          ) : (
            <div className={styles.readoutRow}>
              <span>Size not set</span>
            </div>
          )}
        </div>
        <Button className={styles.stackGap} icon={<Maximize size={14} />} onClick={() => setSizeDialogOpen(true)}>
          {size && doc.sizeOrigin !== 'assumed' ? 'Change Size…' : 'Set Size…'}
        </Button>
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
        <Button variant="link" className={styles.stackGap} onClick={() => goToStep('image')}>
          Go to the Image step
        </Button>
      </div>
    </div>
  );
};
