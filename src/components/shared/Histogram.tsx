import React, { useRef, useEffect } from 'react';
import { useRenderStore } from '../../store/renderStore';
import { useDocumentStore } from '../../store/documentStore';
import { DEFAULT_TONAL } from '../../lib/document';
import styles from './Histogram.module.css';

export const Histogram: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The `prepared` stage's histogram, computed by the core during the preview
  // render: the tones after the adjustments and before the dither (#1 of the
  // acceptance review). The dithered preview would show only 0 and 255.
  const histogram = useRenderStore((s) => s.preparedHistogram);
  const tonal = useDocumentStore((s) => s.doc?.steps.tonal ?? DEFAULT_TONAL);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    if (!histogram) {
      // Draw placeholder empty grid
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(0, 0, width, height);
      return;
    }
    const { r: rBins, g: gBins, b: bBins, luma: lumaBins } = histogram;

    let maxCount = 1;
    for (let i = 1; i < 255; i++) {
      if (lumaBins[i] > maxCount) maxCount = lumaBins[i];
      if (rBins[i] > maxCount) maxCount = rBins[i];
      if (gBins[i] > maxCount) maxCount = gBins[i];
      if (bBins[i] > maxCount) maxCount = bBins[i];
    }

    // Draw Luma Area Fill
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * width;
      const y = height - (lumaBins[i] / maxCount) * (height - 4);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    const lumaGrad = ctx.createLinearGradient(0, 0, 0, height);
    lumaGrad.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
    lumaGrad.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
    ctx.fillStyle = lumaGrad;
    ctx.fill();

    // Helper to draw colored stroke line
    const drawChannelLine = (bins: Uint32Array, color: string) => {
      ctx.beginPath();
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * width;
        const y = height - (bins[i] / maxCount) * (height - 4);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    drawChannelLine(rBins, 'rgba(248, 113, 113, 0.45)');
    drawChannelLine(gBins, 'rgba(74, 222, 128, 0.45)');
    drawChannelLine(bBins, 'rgba(96, 165, 250, 0.45)');
    drawChannelLine(lumaBins, 'rgba(255, 255, 255, 0.85)');

    // Draw Black Point and White Point markers
    const bpX = (tonal.blackPoint / 255) * width;
    const wpX = (tonal.whitePoint / 255) * width;

    ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(bpX, 0);
    ctx.lineTo(bpX, height);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
    ctx.beginPath();
    ctx.moveTo(wpX, 0);
    ctx.lineTo(wpX, height);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [histogram, tonal]);

  return (
    <div className={styles.histogramCard}>
      <div className={styles.histogramHeader}>
        <span>Tones before dithering</span>
        <div className={styles.channelBadges}>
          <span className={styles.badgeR}>R</span>
          <span className={styles.badgeG}>G</span>
          <span className={styles.badgeB}>B</span>
          <span className={styles.badgeL}>Luma</span>
        </div>
      </div>

      <div className={styles.canvasWrapper}>
        <canvas
          ref={canvasRef}
          width={256}
          height={64}
          className={styles.canvas}
        />
      </div>

      <div className={styles.histogramFooter}>
        <span>0 (Darks)</span>
        <span>128 (Midtones)</span>
        <span>255 (Highlights)</span>
      </div>
    </div>
  );
};
