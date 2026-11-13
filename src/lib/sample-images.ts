import { withPngResolution } from './png-encoder';

/**
 * The samples' stated resolution: 10 px/mm (254 DPI), so the 1200 × 800 px
 * patterns open at exactly 120 × 80 mm from the file's own size, not an
 * assumed one.
 */
export const SAMPLE_PX_PER_MM = 10;

/**
 * Generates synthetic manufacturing test patterns as File objects, each
 * declaring its physical size in a PNG `pHYs` chunk.
 */
export function generateTestPattern(type: 'gradient' | 'emblem' | 'grid'): Promise<File> {
  return new Promise((resolve) => {
    const width = 1200;
    const height = 800;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    if (type === 'gradient') {
      // 1. Smooth Grayscale Gradient & Step Chart
      const grad = ctx.createLinearGradient(0, 0, width, 0);
      grad.addColorStop(0, '#000000');
      grad.addColorStop(1, '#ffffff');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, 300);

      // Step wedges
      const steps = 16;
      const stepW = width / steps;
      for (let i = 0; i < steps; i++) {
        const val = Math.round((i / (steps - 1)) * 255);
        ctx.fillStyle = `rgb(${val}, ${val}, ${val})`;
        ctx.fillRect(i * stepW, 300, stepW, 200);
      }

      // High frequency concentric circles for dither testing
      ctx.fillStyle = '#111622';
      ctx.fillRect(0, 500, width, 300);
      ctx.strokeStyle = '#ffffff';
      for (let r = 10; r < 200; r += 6) {
        ctx.beginPath();
        ctx.arc(width / 2, 650, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (type === 'emblem') {
      // 2. Precision Laser Emblem & Vector Logo
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = '#000000';
      ctx.strokeStyle = '#000000';

      // Outer Gear / Badge
      const cx = width / 2;
      const cy = height / 2;
      ctx.beginPath();
      const teeth = 12;
      for (let i = 0; i < teeth * 2; i++) {
        const angle = (i * Math.PI) / teeth;
        const r = i % 2 === 0 ? 240 : 200;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.lineWidth = 14;
      ctx.stroke();

      // Inner Icon & Text
      ctx.beginPath();
      ctx.arc(cx, cy, 140, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PRECISION', cx, cy - 20);
      ctx.font = '500 24px monospace';
      ctx.fillText('CNC • LASER', cx, cy + 30);
    } else {
      // 3. Coordinate Calibration Grid
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 48px sans-serif';
      ctx.fillText('IMAGE SUITE CALIBRATION', 80, 120);
    }

    canvas.toBlob(async (blob) => {
      if (blob) {
        const png = withPngResolution(new Uint8Array(await blob.arrayBuffer()), SAMPLE_PX_PER_MM);
        resolve(new File([png as BlobPart], `${type}-test-pattern.png`, { type: 'image/png' }));
      }
    }, 'image/png');
  });
}
