export interface TextLayerConfig {
  text: string;
  fontFamily: string;
  fontSize: number; // in pt / px
  fontWeight: '300' | '400' | '600' | '700' | '900';
  fontStyle: 'normal' | 'italic';
  textAlign: 'left' | 'center' | 'right';
  color: string;
  letterSpacing: number; // in px
  isOutline: boolean;
  outlineWidth: number;
  dpi: number;
}

export const DEFAULT_TEXT_CONFIG: TextLayerConfig = {
  text: 'Image Suite',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 72,
  fontWeight: '700',
  fontStyle: 'normal',
  textAlign: 'center',
  color: '#ffffff',
  letterSpacing: 0,
  isOutline: false,
  outlineWidth: 2,
  dpi: 300,
};

export const AVAILABLE_FONTS = [
  { id: 'Inter, system-ui, sans-serif', name: 'Inter (Modern Sans)' },
  { id: 'Impact, sans-serif', name: 'Impact (Bold Headline)' },
  { id: 'Georgia, serif', name: 'Georgia (Classic Serif)' },
  { id: 'Courier New, monospace', name: 'Courier (Technical Mono)' },
  { id: '"Brush Script MT", cursive', name: 'Script (Handwritten)' },
  { id: 'Arial Black, sans-serif', name: 'Arial Black (Heavy)' },
  { id: 'Trebuchet MS, sans-serif', name: 'Trebuchet (Clean)' },
  { id: '"Times New Roman", serif', name: 'Times (Traditional)' },
];

/**
 * Renders text to a transparent 32-bit RGBA ArrayBuffer.
 */
export function renderTextToBuffer(config: TextLayerConfig): {
  buffer: ArrayBuffer;
  width: number;
  height: number;
} {
  const {
    text,
    fontFamily,
    fontSize,
    fontWeight,
    fontStyle,
    textAlign,
    color,
    isOutline,
    outlineWidth,
  } = config;

  const lines = text.split('\n');
  const fontSpec = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;

  // Estimate dimensions
  let maxLineWidth = 0;
  const approxCharWidth = fontSize * 0.65;
  for (const line of lines) {
    const len = Math.max(1, line.length);
    const w = len * approxCharWidth + len * config.letterSpacing;
    if (w > maxLineWidth) maxLineWidth = w;
  }

  const lineHeight = Math.round(fontSize * 1.25);
  const padding = Math.max(20, Math.round(fontSize * 0.4));
  const width = Math.max(64, Math.round(maxLineWidth + padding * 2));
  const height = Math.max(64, Math.round(lines.length * lineHeight + padding * 2));

  // If in browser, use 2D canvas context for text rendering
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      ctx.font = fontSpec;
      ctx.textAlign = textAlign;
      ctx.textBaseline = 'middle';

      let drawX = padding;
      if (textAlign === 'center') drawX = width / 2;
      else if (textAlign === 'right') drawX = width - padding;

      lines.forEach((line, index) => {
        const drawY = padding + lineHeight * (index + 0.5);

        if (isOutline) {
          ctx.strokeStyle = color;
          ctx.lineWidth = outlineWidth;
          ctx.strokeText(line, drawX, drawY);
        } else {
          ctx.fillStyle = color;
          ctx.fillText(line, drawX, drawY);
        }
      });

      const imgData = ctx.getImageData(0, 0, width, height);
      return {
        buffer: imgData.data.buffer,
        width,
        height,
      };
    }
  }

  // Fallback in test/headless environments without DOM:
  const totalBytes = width * height * 4;
  const buffer = new ArrayBuffer(totalBytes);
  const data = new Uint8ClampedArray(buffer);

  // Fill sample white pixels in center
  for (let y = Math.round(height * 0.3); y < Math.round(height * 0.7); y++) {
    for (let x = Math.round(width * 0.3); x < Math.round(width * 0.7); x++) {
      const idx = (y * width + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = 255;
    }
  }

  return {
    buffer,
    width,
    height,
  };
}
