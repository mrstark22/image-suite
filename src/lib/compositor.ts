import type { CanvasLayer } from '../types/layer';
import { applyFastTonalLUT } from './fast-tonal';
import { DEFAULT_TONAL, DEFAULT_COLOR } from '../store/editStore';

/**
 * Composites multiple visible image layers onto a single target canvas/buffer.
 * Applies per-layer transforms (x, y, scale, rotation), opacities, blend modes,
 * and tonal/color adjustments.
 * Renders in reverse order (bottom layer drawn first, top layer drawn last on top).
 */
export async function compositeLayers(
  layers: CanvasLayer[],
  targetWidth: number,
  targetHeight: number
): Promise<ArrayBuffer> {
  const visibleImageLayers = layers.filter(
    (l) => l.type !== 'vector' && l.visible && (l.originalBitmap || l.previewBuffer)
  );

  const fallbackBuffer = new ArrayBuffer(targetWidth * targetHeight * 4);

  if (visibleImageLayers.length === 0) {
    return fallbackBuffer;
  }

  // Handle environments without DOM / Canvas (e.g. Node test environment)
  if (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined') {
    return visibleImageLayers[0]?.previewBuffer || fallbackBuffer;
  }

  let canvas: HTMLCanvasElement | OffscreenCanvas;
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(targetWidth, targetHeight);
    ctx = canvas.getContext('2d');
  } else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    ctx = canvas.getContext('2d');
  }

  if (!ctx) {
    return visibleImageLayers[0]?.previewBuffer || fallbackBuffer;
  }

  // Clear canvas with transparent black
  ctx.clearRect(0, 0, targetWidth, targetHeight);

  // Render bottom-to-top so index 0 (top-most in UI) is drawn last on top
  const renderOrder = [...visibleImageLayers].reverse();

  for (const layer of renderOrder) {
    ctx.save();

    ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
    ctx.globalCompositeOperation = layer.blendMode || 'source-over';

    const t = layer.transform || { x: 0, y: 0, scale: 1, rotation: 0 };

    // Apply translation, rotation, and scaling relative to canvas center
    const layerW = layer.previewDims?.width || targetWidth;
    const layerH = layer.previewDims?.height || targetHeight;

    const centerX = targetWidth / 2 + t.x;
    const centerY = targetHeight / 2 + t.y;

    ctx.translate(centerX, centerY);
    if (t.rotation !== 0) {
      ctx.rotate((t.rotation * Math.PI) / 180);
    }
    if (t.scale !== 1) {
      ctx.scale(t.scale, t.scale);
    }
    ctx.translate(-layerW / 2, -layerH / 2);

    // If layer has custom tonal/color adjustments, apply LUT first
    let bufferToDraw = layer.previewBuffer;
    if (bufferToDraw && (layer.tonal || layer.color)) {
      const adjustedBuf = new ArrayBuffer(bufferToDraw.byteLength);
      applyFastTonalLUT(
        bufferToDraw,
        adjustedBuf,
        layerW,
        layerH,
        { ...DEFAULT_TONAL, ...layer.tonal },
        { ...DEFAULT_COLOR, ...layer.color }
      );
      bufferToDraw = adjustedBuf;
    }

    if (bufferToDraw) {
      let tempCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
      if (typeof OffscreenCanvas !== 'undefined') {
        tempCanvas = new OffscreenCanvas(layerW, layerH);
      } else if (typeof document !== 'undefined') {
        tempCanvas = document.createElement('canvas');
        tempCanvas.width = layerW;
        tempCanvas.height = layerH;
      }

      if (tempCanvas) {
        const tempCtx = tempCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        if (tempCtx) {
          const imgData = new ImageData(
            new Uint8ClampedArray(bufferToDraw),
            layerW,
            layerH
          );
          tempCtx.putImageData(imgData, 0, 0);
          ctx.drawImage(tempCanvas as any, 0, 0, layerW, layerH);
        }
      }
    } else if (layer.originalBitmap) {
      ctx.drawImage(layer.originalBitmap, 0, 0, layerW, layerH);
    }

    ctx.restore();
  }

  const resultImageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  return resultImageData.data.buffer.slice(0);
}

/**
 * Creates an empty blank RGBA buffer for new layers.
 */
export function createBlankLayerBuffer(
  width: number,
  height: number,
  fillColor?: string
): ArrayBuffer {
  const byteLength = width * height * 4;
  const buffer = new ArrayBuffer(byteLength);
  if (!fillColor || fillColor === 'transparent') {
    return buffer;
  }

  const data = new Uint8ClampedArray(buffer);
  let r = 255, g = 255, b = 255, a = 255;

  if (fillColor === 'white') {
    r = 255; g = 255; b = 255; a = 255;
  } else if (fillColor === 'black') {
    r = 0; g = 0; b = 0; a = 255;
  } else if (fillColor === 'gray') {
    r = 128; g = 128; b = 128; a = 255;
  }

  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }

  return buffer;
}
