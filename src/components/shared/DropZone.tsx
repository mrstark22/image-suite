import React, { useRef, useState } from 'react';
import { Upload, Image, ShieldCheck, Sparkles } from 'lucide-react';
import { loadImageFromFile } from '../../lib/image-loader';
import { generateTestPattern } from '../../lib/sample-images';
import { useImageStore } from '../../store/imageStore';
import styles from './DropZone.module.css';

export const DropZone: React.FC = () => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setImage = useImageStore((s) => s.setImage);
  const setErrorMessage = useImageStore((s) => s.setErrorMessage);

  const handleProcessFile = async (file: File) => {
    try {
      const result = await loadImageFromFile(file);
      setImage(
        file,
        result.originalBuffer,
        result.bitmap,
        result.metadata,
        result.previewBuffer,
        result.previewDims
      );
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
      handleProcessFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleProcessFile(e.target.files[0]);
    }
  };

  const loadSample = async (type: 'gradient' | 'emblem' | 'grid') => {
    const file = await generateTestPattern(type);
    await handleProcessFile(file);
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

      <h2 className={styles.title}>Drop your image to prepare & vectorize</h2>
      <p className={styles.subtitle}>
        100% Client-side processing. Zero cloud uploads. Instant real-time preview.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/bmp,image/tiff"
        className={styles.fileInput}
        onChange={handleFileChange}
      />

      <button
        className={styles.browseButton}
        onClick={() => fileInputRef.current?.click()}
      >
        <Image size={16} />
        Browse Files
      </button>

      <div className={styles.formats}>
        <span className={styles.badge}>PNG</span>
        <span className={styles.badge}>JPEG</span>
        <span className={styles.badge}>WEBP</span>
        <span className={styles.badge}>SVG</span>
        <span className={styles.badge}>TIFF / BMP</span>
      </div>

      <div className={styles.samplesSection}>
        <div className={styles.samplesTitle}>Or try a precision test pattern</div>
        <div className={styles.samplesGrid}>
          <button className={styles.sampleButton} onClick={() => loadSample('gradient')}>
            <Sparkles size={14} style={{ marginBottom: 4, color: 'var(--accent-warning)' }} />
            Gradient Ramp
          </button>
          <button className={styles.sampleButton} onClick={() => loadSample('emblem')}>
            <ShieldCheck size={14} style={{ marginBottom: 4, color: 'var(--accent-primary)' }} />
            Laser Emblem
          </button>
          <button className={styles.sampleButton} onClick={() => loadSample('grid')}>
            <Image size={14} style={{ marginBottom: 4, color: 'var(--accent-success)' }} />
            Calibration Grid
          </button>
        </div>
      </div>
    </div>
  );
};
