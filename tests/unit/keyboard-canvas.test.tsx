// @vitest-environment jsdom
/**
 * The canvas from the keyboard (#55).
 *
 * - #79: the crop box takes focus when the crop tool opens; the arrow keys
 *   move it, Shift+arrows size it from its bottom-right corner, Alt makes
 *   the step one pixel, and Enter applies the crop. A chosen region can be
 *   cropped without a pointer.
 */
import { act } from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { PreviewCanvas } from '../../src/components/canvas/PreviewCanvas';
import { adjustCropBox, cropBoxForKey, CROP_KEY_STEP, MIN_CROP_SIDE } from '../../src/lib/crop';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { useUIStore, firstSteps } from '../../src/store/uiStore';
import { useViewStore } from '../../src/store/viewStore';
import { runCommand } from '../../src/lib/shortcuts';
import { decodedImage, resetStores } from '../helpers/documents';
import { mount, press, type Mounted } from '../helpers/dom';

let mounted: Mounted | null = null;

beforeEach(() => {
  resetStores();
  useUIStore.setState({ job: 'photo', stepByJob: firstSteps() });
  useViewStore.setState({ canvasTool: 'pan', zoom: 1, pan: { x: 0, y: 0 }, fitted: false, container: null, image: null });
  useRenderStore.setState({ source: null, processed: null });
  // jsdom has no ResizeObserver, and its canvases do not draw.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Opens an 800x400 image whose preview is 400x200 (half size), and mounts the
 * canvas. Returns the canvas container.
 */
function openCanvas(): HTMLElement {
  useDocumentStore.getState().open(decodedImage(800, 400), 10);
  useRenderStore.setState({
    source: {
      key: 'k',
      sourceId: useDocumentStore.getState().doc!.source.sourceId,
      crop: { x: 0, y: 0, width: 800, height: 400 },
      buffer: new ArrayBuffer(400 * 200 * 4),
      width: 400,
      height: 200,
    },
    processed: new ArrayBuffer(400 * 200 * 4),
  });
  mounted = mount(<PreviewCanvas />);
  return mounted.container.firstElementChild as HTMLElement;
}

const key = (k: string, shiftKey = false, altKey = false) => ({ key: k, shiftKey, altKey });

describe('crop box geometry for the keys (#79)', () => {
  const dims = { width: 400, height: 200 };
  const box = { x: 100, y: 50, width: 200, height: 100 };

  it('an arrow moves the box by the step without changing its size', () => {
    expect(cropBoxForKey(box, key('ArrowRight'), dims)).toEqual({ ...box, x: 100 + CROP_KEY_STEP });
    expect(cropBoxForKey(box, key('ArrowLeft'), dims)).toEqual({ ...box, x: 100 - CROP_KEY_STEP });
    expect(cropBoxForKey(box, key('ArrowDown'), dims)).toEqual({ ...box, y: 50 + CROP_KEY_STEP });
    expect(cropBoxForKey(box, key('ArrowUp'), dims)).toEqual({ ...box, y: 50 - CROP_KEY_STEP });
  });

  it('Shift+arrow moves the bottom-right corner: the top-left corner stays', () => {
    expect(cropBoxForKey(box, key('ArrowRight', true), dims)).toEqual({ ...box, width: 200 + CROP_KEY_STEP });
    expect(cropBoxForKey(box, key('ArrowLeft', true), dims)).toEqual({ ...box, width: 200 - CROP_KEY_STEP });
    expect(cropBoxForKey(box, key('ArrowDown', true), dims)).toEqual({ ...box, height: 100 + CROP_KEY_STEP });
    expect(cropBoxForKey(box, key('ArrowUp', true), dims)).toEqual({ ...box, height: 100 - CROP_KEY_STEP });
  });

  it('Alt makes the step one pixel, for moving and for sizing', () => {
    expect(cropBoxForKey(box, key('ArrowRight', false, true), dims)).toEqual({ ...box, x: 101 });
    expect(cropBoxForKey(box, key('ArrowDown', true, true), dims)).toEqual({ ...box, height: 101 });
  });

  it('the box stays inside the image and no smaller than the minimum side', () => {
    expect(cropBoxForKey({ ...box, x: 195 }, key('ArrowRight'), dims)!.x).toBe(200);
    expect(cropBoxForKey({ ...box, y: 5 }, key('ArrowUp'), dims)!.y).toBe(0);
    expect(cropBoxForKey({ ...box, width: 295 }, key('ArrowRight', true), dims)!.width).toBe(300);
    expect(cropBoxForKey({ ...box, width: MIN_CROP_SIDE }, key('ArrowLeft', true), dims)!.width).toBe(MIN_CROP_SIDE);
  });

  it('sizing keeps the chosen aspect ratio, as a drag does', () => {
    const sized = cropBoxForKey(box, key('ArrowRight', true), dims, '4:3')!;
    expect(sized.height / sized.width).toBeCloseTo(3 / 4, 2);
    expect(sized).toEqual(adjustCropBox(box, 'se', CROP_KEY_STEP, 0, dims, '4:3'));
  });

  it('other keys leave the box alone', () => {
    expect(cropBoxForKey(box, key('a'), dims)).toBeNull();
    expect(cropBoxForKey(box, key('Enter'), dims)).toBeNull();
  });
});

describe('cropping without a pointer (#79)', () => {
  /** The crop box element, by its accessible name. */
  const cropBox = () => document.querySelector<HTMLElement>('[role="group"][aria-label="Crop box"]')!;
  const boxOf = (el: HTMLElement) => ({
    x: parseFloat(el.style.left),
    y: parseFloat(el.style.top),
    width: parseFloat(el.style.width),
    height: parseFloat(el.style.height),
  });

  it('the C shortcut opens the tool with the box focused, in the tab order, and described', () => {
    openCanvas();
    act(() => {
      runCommand('cropTool');
    });
    const box = cropBox();
    expect(document.activeElement).toBe(box);
    expect(box.tabIndex).toBe(0);
    const hint = document.getElementById(box.getAttribute('aria-describedby')!);
    expect(hint?.textContent).toMatch(/Arrows move.*Shift\+Arrows size/);
  });

  it('a chosen region is drawn, adjusted and applied with the keys alone', () => {
    const canvas = openCanvas();
    act(() => {
      runCommand('cropTool');
    });
    // The tool opens with the box 5 % in from each edge of the 400x200 preview.
    expect(boxOf(cropBox())).toEqual({ x: 20, y: 10, width: 360, height: 180 });
    const panBefore = useViewStore.getState().pan;

    // Target: x 50, y 30, 200 x 100 preview pixels.
    for (let i = 0; i < 16; i++) press('ArrowLeft', { shiftKey: true });
    for (let i = 0; i < 8; i++) press('ArrowUp', { shiftKey: true });
    for (let i = 0; i < 3; i++) press('ArrowRight');
    for (let i = 0; i < 2; i++) press('ArrowDown');
    expect(boxOf(cropBox())).toEqual({ x: 50, y: 30, width: 200, height: 100 });
    // Adjust by one pixel, and back.
    press('ArrowRight', { altKey: true });
    expect(boxOf(cropBox()).x).toBe(51);
    press('ArrowLeft', { altKey: true });
    // The box's arrows moved the box, not the view.
    expect(useViewStore.getState().pan).toEqual(panBefore);
    // The size readout follows, in source pixels (the preview is half size).
    expect(canvas.textContent).toContain('400×200px');

    press('Enter');
    // The preview is half the source's size, so the crop is twice the box.
    expect(useDocumentStore.getState().doc!.steps.crop).toEqual({ x: 100, y: 60, width: 400, height: 200 });
    expect(useViewStore.getState().canvasTool).toBe('pan');
  });

  it('Escape cancels: no crop is made', () => {
    openCanvas();
    act(() => {
      runCommand('cropTool');
    });
    press('ArrowRight');
    press('Escape');
    expect(useDocumentStore.getState().doc!.steps.crop).toBeNull();
    expect(useViewStore.getState().canvasTool).toBe('pan');
  });
});
