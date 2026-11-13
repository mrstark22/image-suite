import { withPngResolution } from './png-encoder';

/**
 * The samples' stated resolution: 10 px/mm (254 DPI), so the 1200 × 800 px
 * samples open at exactly 120 × 80 mm from the file's own size, not an
 * assumed one.
 */
export const SAMPLE_PX_PER_MM = 10;

/** The samples on the empty canvas, one per kind of first job. */
export type SampleKind = 'tone' | 'emblem' | 'drawing';

/** What each sample is for, as its button names it. */
export const SAMPLES: { kind: SampleKind; label: string; use: string }[] = [
  { kind: 'tone', label: 'Tone Ramp', use: 'Photo: judge a dither on a smooth ramp, eleven tone patches, a shaded ball and fine lines' },
  { kind: 'emblem', label: 'Emblem', use: 'Vector and relief: a solid badge with text' },
  { kind: 'drawing', label: 'Line Drawing', use: 'Vector: pen strokes for a centreline trace' },
];

/** The tone sample: a smooth ramp, labelled patches, a lit ball and fine detail. */
function drawTone(ctx: CanvasRenderingContext2D, width: number): void {
  // A smooth ramp, black to white, set per pixel.
  const rampH = 300;
  const ramp = ctx.createImageData(width, rampH);
  for (let x = 0; x < width; x++) {
    const v = Math.round((x / (width - 1)) * 255);
    for (let y = 0; y < rampH; y++) {
      const i = (y * width + x) * 4;
      ramp.data[i] = ramp.data[i + 1] = ramp.data[i + 2] = v;
      ramp.data[i + 3] = 255;
    }
  }
  ctx.putImageData(ramp, 0, 0);

  // Eleven patches, 0% to 100% black in steps of 10%, each labelled.
  const patches = 11;
  const pw = width / patches;
  ctx.font = '600 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < patches; i++) {
    const v = Math.round(255 * (1 - i / (patches - 1)));
    ctx.fillStyle = `rgb(${v}, ${v}, ${v})`;
    ctx.fillRect(i * pw, 310, pw, 160);
    ctx.fillStyle = v > 110 ? '#000000' : '#ffffff';
    ctx.fillText(`${i * 10}%`, i * pw + pw / 2, 390);
  }

  // A lit ball: tone changing smoothly in two directions, as in a photo.
  const cx = 280;
  const cy = 640;
  const r = 140;
  const ball = ctx.getImageData(cx - r, cy - r, 2 * r, 2 * r);
  for (let y = 0; y < 2 * r; y++) {
    for (let x = 0; x < 2 * r; x++) {
      const nx = (x - r) / r;
      const ny = (y - r) / r;
      const rr = nx * nx + ny * ny;
      if (rr > 1) continue;
      const nz = Math.sqrt(1 - rr);
      const light = Math.max(0, -0.5 * nx - 0.5 * ny + 0.7 * nz);
      const v = Math.round(25 + 230 * Math.min(1, light));
      const i = (y * 2 * r + x) * 4;
      ball.data[i] = ball.data[i + 1] = ball.data[i + 2] = v;
    }
  }
  ctx.putImageData(ball, cx - r, cy - r);

  // Fine detail: black lines 0.1 to 0.5 mm wide (1 to 5 px), gaps as wide as the lines.
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.font = '15px sans-serif';
  let x = 480;
  for (let w = 1; w <= 5; w++) {
    const start = x;
    for (let k = 0; k < 6; k++) {
      ctx.fillRect(x, 510, w, 180);
      x += 2 * w;
    }
    ctx.fillText(`${(w / 10).toFixed(1)}`, (start + x - w) / 2, 720);
    x += 28;
  }

  // Small text, 2 to 4 mm high.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const [px, y] of [[40, 560], [30, 620], [20, 670]] as const) {
    ctx.font = `${px}px serif`;
    ctx.fillText(`Small text ${px / 10} mm`, 880, y);
  }
  ctx.font = '20px sans-serif';
  ctx.fillText('120 × 80 mm, 254 DPI', 880, 750);
}

/** The emblem: solid shapes and text, for a clean trace or a relief. */
function drawEmblem(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';
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
}

/** A pen drawing: strokes of even width, open and closed, straight and curved, for a centreline trace. */
function drawLines(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // A house.
  ctx.beginPath();
  ctx.moveTo(250, 600);
  ctx.lineTo(250, 380);
  ctx.lineTo(420, 240);
  ctx.lineTo(590, 380);
  ctx.lineTo(590, 600);
  ctx.closePath();
  ctx.moveTo(380, 600);
  ctx.lineTo(380, 480);
  ctx.lineTo(460, 480);
  ctx.lineTo(460, 600);
  ctx.rect(290, 420, 60, 50);
  ctx.rect(490, 420, 60, 50);
  ctx.stroke();
  // A sun.
  ctx.beginPath();
  ctx.arc(980, 170, 70, 0, Math.PI * 2);
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5;
    ctx.moveTo(980 + Math.cos(a) * 95, 170 + Math.sin(a) * 95);
    ctx.lineTo(980 + Math.cos(a) * 130, 170 + Math.sin(a) * 130);
  }
  ctx.stroke();
  // A path and a tree.
  ctx.beginPath();
  ctx.moveTo(420, 600);
  ctx.bezierCurveTo(440, 680, 700, 640, 760, 760);
  ctx.moveTo(880, 640);
  ctx.lineTo(880, 510);
  ctx.moveTo(880, 560);
  ctx.lineTo(840, 520);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(880, 400, 90, 110, 0, 0, Math.PI * 2);
  ctx.stroke();
  // A thin wavy line along the bottom.
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(60, 730);
  for (let x = 60; x <= 1140; x += 10) ctx.lineTo(x, 730 + Math.sin(x / 30) * 8);
  ctx.stroke();
}

/**
 * Draws a sample as a PNG File that declares its physical size in a `pHYs`
 * chunk: 1200 × 800 px at 10 px/mm, so 120 × 80 mm.
 */
export function generateTestPattern(type: SampleKind): Promise<File> {
  return new Promise((resolve, reject) => {
    const width = 1200;
    const height = 800;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    if (type === 'tone') drawTone(ctx, width);
    else if (type === 'emblem') drawEmblem(ctx, width, height);
    else drawLines(ctx);

    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('The sample image could not be drawn.'));
        return;
      }
      const png = withPngResolution(new Uint8Array(await blob.arrayBuffer()), SAMPLE_PX_PER_MM);
      resolve(new File([png as BlobPart], `sample-${type}.png`, { type: 'image/png' }));
    }, 'image/png');
  });
}
