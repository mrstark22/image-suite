import { describe, it, expect } from 'vitest';
import { renderTextToBuffer, DEFAULT_TEXT_CONFIG } from '../../src/lib/text-layer';
import { useLayerStore } from '../../src/store/layerStore';

describe('Text & Monogramming Layer Engine Suite', () => {
  it('renders text to a valid transparent RGBA buffer', () => {
    const { buffer, width, height } = renderTextToBuffer({
      ...DEFAULT_TEXT_CONFIG,
      text: 'Custom Engraved Name',
      fontSize: 48,
    });

    expect(buffer).toBeDefined();
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(buffer.byteLength).toBe(width * height * 4);
  });

  it('renders outline/stencil mode text buffer', () => {
    const { buffer, width, height } = renderTextToBuffer({
      ...DEFAULT_TEXT_CONFIG,
      text: 'STENCIL',
      isOutline: true,
      outlineWidth: 3,
    });

    expect(buffer).toBeDefined();
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it('creates an active text layer in layerStore', async () => {
    const layerId = await useLayerStore.getState().createTextLayer({
      ...DEFAULT_TEXT_CONFIG,
      text: 'Monogram 2026',
    });

    const layers = useLayerStore.getState().layers;
    const createdLayer = layers.find((l) => l.id === layerId);

    expect(createdLayer).toBeDefined();
    expect(createdLayer?.type).toBe('text');
    expect(createdLayer?.name).toContain('Monogram 2026');
    expect(createdLayer?.previewBuffer).toBeDefined();
    expect(useLayerStore.getState().activeLayerId).toBe(layerId);
  });
});
