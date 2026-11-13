import React, { useRef, useState } from 'react';
import { Upload, Image, ShieldCheck, Sparkles } from 'lucide-react';
import { generateTestPattern } from '../../lib/sample-images';
import { openImageFiles } from '../../lib/open-image';
import { useRenderStore } from '../../store/renderStore';
import { Button } from './Button';
import styles from './DropZone.module.css';

/** The empty canvas: drop an image here, browse for one, or open a test pattern. */
export const DropZone: React.FC = () => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setErrorMessage = useRenderStore((s) => s.setErrorMessage);

  const handleProcessFiles = async (files: File[]) => {
    try {
      await openImageFiles(files);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load image file';
      setErrorMessage(message);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleProcessFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleProcessFiles(Array.from(e.target.files));
    }
  };

  const loadSample = async (type: 'gradient' | 'emblem' | 'grid') => {
    const file = await generateTestPattern(type);
    await handleProcessFiles([file]);
  };

  return (
    <div
      className={`${styles.container} ${isDragging ? styles.dragging : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={styles.iconWrapper}>
        <Upload size={28} />
      </div>

      <h2 className={styles.title}>Drop an image here to start</h2>
      <p className={styles.subtitle}>
        One image at a time. It stays on this device: nothing is uploaded.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/bmp,image/tiff"
        hidden
        onChange={handleFileChange}
      />

      <Button
        variant="primary"
        compact
        className={styles.browseButton}
        icon={<Image size={16} />}
        onClick={() => fileInputRef.current?.click()}
      >
        Browse Files
      </Button>

      <div className={styles.formats}>
        <span className={styles.badge}>PNG</span>
        <span className={styles.badge}>JPEG</span>
        <span className={styles.badge}>WEBP</span>
        <span className={styles.badge}>SVG</span>
        <span className={styles.badge}>TIFF / BMP</span>
      </div>

      <div className={styles.samplesSection}>
        <div className={styles.samplesTitle}>Or try a sample image</div>
        <div className={styles.samplesGrid}>
          <button type="button" className={styles.sampleButton} onClick={() => loadSample('gradient')}>
            <Sparkles size={14} className={`${styles.sampleIcon} ${styles.sampleIconWarm}`} />
            Gradient Ramp
          </button>
          <button type="button" className={styles.sampleButton} onClick={() => loadSample('emblem')}>
            <ShieldCheck size={14} className={`${styles.sampleIcon} ${styles.sampleIconNeutral}`} />
            Laser Emblem
          </button>
          <button type="button" className={styles.sampleButton} onClick={() => loadSample('grid')}>
            <Image size={14} className={`${styles.sampleIcon} ${styles.sampleIconGreen}`} />
            Calibration Grid
          </button>
        </div>
      </div>
    </div>
  );
};
