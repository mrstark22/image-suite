// @vitest-environment jsdom
/**
 * The canvas from the keyboard (#55).
 *
 * - #79: the crop box takes focus when the crop tool opens; the arrow keys
 *   move it, Shift+arrows size it from its bottom-right corner, Alt makes
 *   the step one pixel, and Enter applies the crop. A chosen region can be
 *   cropped without a pointer.
 * - #81: the canvas takes focus and the arrow keys pan it, Shift further,
 *   until each corner of a zoomed-in image is in view; keys on the crop box
 *   or the split divider stay theirs. The 3D view takes focus; the arrows
 *   orbit it, to a side view, and + and - move the camera in and out.
 */
import { act } from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { PreviewCanvas } from '../../src/components/canvas/PreviewCanvas';
import { DepthViewer3D } from '../../src/components/canvas/DepthViewer3D';
import {
  imageOrigin,
  panForKey,
  PAN_KEY_MARGIN,
  PAN_KEY_STEP,
  PAN_KEY_STEP_LARGE,
  RULER_THICKNESS,
} from '../../src/lib/viewport';
import {
  cameraForKey,
  DEFAULT_CAMERA,
  DOLLY_KEY_FACTOR,
  MIN_ELEVATION,
  ORBIT_KEY_STEP,
  ORBIT_KEY_STEP_LARGE,
} from '../../src/lib/orbit-camera';
import { adjustCropBox, cropBoxForKey, CROP_KEY_STEP, MIN_CROP_SIDE } from '../../src/lib/crop';
import { useDocumentStore } from '../../src/store/documentStore';
import { useRenderStore } from '../../src/store/renderStore';
import { useUIStore, firstSteps } from '../../src/store/uiStore';
import { useViewStore } from '../../src/store/viewStore';
import { runCommand } from '../../src/lib/shortcuts';
import { decodedImage, resetStores } from '../helpers/documents';
import { click, fakeViewport, mount, press, type Mounted } from '../helpers/dom';
import { App } from '../../src/App';

// The schedulers start the worker, which jsdom cannot run; the shell does not need them.
vi.mock('../../src/lib/schedulers', () => ({ startSchedulers: () => undefined }));

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
    const hint = document.getElementById(box.getAttribute('aria-describedby')!)!;
    expect(hint.textContent).toMatch(/Arrows move.*Shift\+Arrows size/);
    // Opened from code after a pointer: the keys are only read out. After a key, they are shown too.
    expect(hint.className).toMatch(/visuallyHidden/);
    press('ArrowRight');
    expect(hint.className).not.toMatch(/visuallyHidden/);
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

describe('panning the canvas from the keyboard (#81)', () => {
  const container = { width: 600, height: 400 };
  const image = { width: 400, height: 200 };

  it('an arrow pans by the step like scrolling: Right shows more of the right side, so the image moves left', () => {
    const view = { zoom: 4, pan: { x: 0, y: 0 } };
    expect(panForKey(view, container, image, key('ArrowRight'))).toEqual({ x: -PAN_KEY_STEP, y: 0 });
    expect(panForKey(view, container, image, key('ArrowLeft'))).toEqual({ x: PAN_KEY_STEP, y: 0 });
    expect(panForKey(view, container, image, key('ArrowDown'))).toEqual({ x: 0, y: -PAN_KEY_STEP });
    expect(panForKey(view, container, image, key('ArrowUp', true))).toEqual({ x: 0, y: PAN_KEY_STEP_LARGE });
    expect(panForKey(view, container, image, key('a'))).toBeNull();
  });

  it('an image that nearly fills the view pans just far enough to clear the rulers; a small one stays put', () => {
    // 200 px tall at 1.95x is 390 px in a 400 px view: its edges are 5 px in, under the rulers.
    const near = panForKey({ zoom: 1.95, pan: { x: 0, y: 0 } }, container, image, key('ArrowUp', true))!;
    expect(near.y).toBeCloseTo(PAN_KEY_MARGIN - 5, 9);
    expect(panForKey({ zoom: 0.5, pan: { x: 0, y: 0 } }, container, image, key('ArrowUp', true))).toEqual({ x: 0, y: 0 });
  });

  it('a pan a drag took past the limit is not pulled back by a key', () => {
    const view = { zoom: 1, pan: { x: 5000, y: 0 } };
    expect(panForKey(view, container, image, key('ArrowLeft'))!.x).toBe(5000);
    expect(panForKey(view, container, image, key('ArrowRight'))!.x).toBe(5000 - PAN_KEY_STEP);
  });

  /** Mounts the canvas zoomed in 4x on a 600x400 view, and focuses it. */
  function zoomedCanvas(): HTMLElement {
    const canvas = openCanvas();
    act(() => useViewStore.setState({ zoom: 4, pan: { x: 0, y: 0 }, container, image, fitted: false }));
    act(() => canvas.focus());
    return canvas;
  }

  it('the canvas is in the tab order, named and described', () => {
    const canvas = zoomedCanvas();
    expect(canvas.tabIndex).toBe(0);
    expect(canvas.getAttribute('aria-label')).toBe('Image canvas');
    expect(document.getElementById(canvas.getAttribute('aria-describedby')!)?.textContent).toMatch(/Arrow keys pan/);
    expect(document.activeElement).toBe(canvas);
  });

  it('a zoomed-in image is panned to each corner with the keys alone', () => {
    zoomedCanvas();
    const shown = { width: image.width * 4, height: image.height * 4 };
    const corner = (h: 'ArrowLeft' | 'ArrowRight', v: 'ArrowUp' | 'ArrowDown') => {
      for (let i = 0; i < 20; i++) {
        press(h, { shiftKey: true });
        press(v, { shiftKey: true });
      }
      const { zoom, pan } = useViewStore.getState();
      const o = imageOrigin({ zoom, pan }, container, image);
      return { left: o.x, top: o.y, right: o.x + shown.width, bottom: o.y + shown.height };
    };

    // Top-left: the image's corner is in view, clear of the rulers.
    let at = corner('ArrowLeft', 'ArrowUp');
    expect(at.left).toBe(PAN_KEY_MARGIN);
    expect(at.top).toBe(PAN_KEY_MARGIN);
    expect(PAN_KEY_MARGIN).toBeGreaterThan(RULER_THICKNESS);
    // Top-right.
    at = corner('ArrowRight', 'ArrowUp');
    expect(at.right).toBe(container.width - PAN_KEY_MARGIN);
    expect(at.top).toBe(PAN_KEY_MARGIN);
    // Bottom-right.
    at = corner('ArrowRight', 'ArrowDown');
    expect(at.right).toBe(container.width - PAN_KEY_MARGIN);
    expect(at.bottom).toBe(container.height - PAN_KEY_MARGIN);
    // Bottom-left.
    at = corner('ArrowLeft', 'ArrowDown');
    expect(at.left).toBe(PAN_KEY_MARGIN);
    expect(at.bottom).toBe(container.height - PAN_KEY_MARGIN);
  });

  it('the arrows on the split divider move the divider, not the view', () => {
    useUIStore.setState({ isSplitView: true });
    const canvas = zoomedCanvas();
    const divider = canvas.querySelector<HTMLElement>('[role="separator"]')!;
    act(() => divider.focus());
    const before = useViewStore.getState().splitPosition;
    press('ArrowLeft');
    expect(useViewStore.getState().splitPosition).toBeLessThan(before);
    expect(useViewStore.getState().pan).toEqual({ x: 0, y: 0 });
  });

  it('an arrow with Ctrl is left to the shortcuts', () => {
    zoomedCanvas();
    press('ArrowLeft', { ctrlKey: true });
    expect(useViewStore.getState().pan).toEqual({ x: 0, y: 0 });
  });
});

describe('orbiting the 3D view from the keyboard (#81)', () => {
  it('Left and Right turn the camera, Up and Down tilt it, Shift takes a larger step, + and - move it', () => {
    const c = DEFAULT_CAMERA;
    expect(cameraForKey(c, key('ArrowRight'))!.azimuth).toBeCloseTo(c.azimuth + ORBIT_KEY_STEP, 9);
    expect(cameraForKey(c, key('ArrowLeft'))!.azimuth).toBeCloseTo(c.azimuth - ORBIT_KEY_STEP, 9);
    expect(cameraForKey(c, key('ArrowUp'))!.elevation).toBeCloseTo(c.elevation + ORBIT_KEY_STEP, 9);
    expect(cameraForKey(c, key('ArrowDown'))!.elevation).toBeCloseTo(c.elevation - ORBIT_KEY_STEP, 9);
    expect(cameraForKey(c, key('ArrowRight', true))!.azimuth).toBeCloseTo(c.azimuth + ORBIT_KEY_STEP_LARGE, 9);
    expect(cameraForKey(c, key('+'))!.distance).toBeCloseTo(c.distance / DOLLY_KEY_FACTOR, 9);
    expect(cameraForKey(c, key('='))!.distance).toBeCloseTo(c.distance / DOLLY_KEY_FACTOR, 9);
    expect(cameraForKey(c, key('-'))!.distance).toBeCloseTo(c.distance * DOLLY_KEY_FACTOR, 9);
    expect(cameraForKey(c, key('x'))).toBeNull();
  });

  const mountViewer = () =>
    (mounted = mount(<DepthViewer3D depthBuffer={new ArrayBuffer(4 * 4 * 4)} width={4} height={4} />));
  const readout = () => mounted!.container.querySelector('[role="status"]')!.textContent;

  it('the focused view is orbited to a side view, and moved in and out, without a pointer', () => {
    mountViewer();
    const view = mounted!.container.querySelector<HTMLElement>('[role="region"][aria-label="3D relief view"]')!;
    expect(view.tabIndex).toBe(0);
    act(() => view.focus());
    expect(readout()).toBe('Camera 45° around, 35° above the surface, distance 2.60');

    // Down to the lowest tilt, and round to 90°: looking along the surface from its side.
    for (let i = 0; i < 4; i++) press('ArrowDown');
    for (let i = 0; i < 3; i++) press('ArrowRight');
    expect(readout()).toBe(`Camera 90° around, ${MIN_ELEVATION}° above the surface, distance 2.60`);

    press('+');
    expect(readout()).toBe(
      `Camera 90° around, ${MIN_ELEVATION}° above the surface, distance ${(2.6 / DOLLY_KEY_FACTOR).toFixed(2)}`,
    );
    press('-');
    expect(readout()).toMatch(/distance 2\.60$/);
  });

  it("keys on the view's own buttons are the buttons'", () => {
    mountViewer();
    const reset = [...mounted!.container.querySelectorAll('button')].find((b) => /Reset View/.test(b.textContent ?? ''))!;
    act(() => reset.focus());
    press('ArrowRight');
    expect(readout()).toMatch(/^Camera 45° around/);
  });
});

describe('the zoom bar and the 3D orbit view (#82)', () => {
  /** Opens an image in the relief job with the depth view mode `viewMode`, and mounts the app. */
  function reliefApp(viewMode: '3d-interactive' | 'grayscale', width: number): HTMLElement {
    fakeViewport(width);
    useUIStore.setState({ job: 'relief', stepByJob: firstSteps() });
    openCanvas();
    mounted?.unmount();
    const doc = useDocumentStore.getState().doc!;
    useDocumentStore.setState({ doc: { ...doc, depth: { ...doc.depth, viewMode } } });
    mounted = mount(<App />);
    return mounted.container;
  }

  const zoomButtons = (root: HTMLElement) =>
    [...root.querySelectorAll('button')].filter((b) => /^(Zoom In|Zoom Out|Fit to Screen|Actual Size)/.test(b.title));

  for (const width of [1440, 390]) {
    it(`at ${width} px: no zoom bar over the orbit view, which has its own zoom keys`, () => {
      const root = reliefApp('3d-interactive', width);
      expect(root.querySelector('[aria-label="3D relief view"]')).not.toBeNull();
      expect(zoomButtons(root)).toEqual([]);
    });

    it(`at ${width} px: the zoom bar is back, and zooms, on the flat relief`, () => {
      const root = reliefApp('grayscale', width);
      expect(root.querySelector('[aria-label="3D relief view"]')).toBeNull();
      expect(zoomButtons(root)).toHaveLength(4);
      const before = useViewStore.getState().zoom;
      click(zoomButtons(root).find((b) => b.title.startsWith('Zoom In'))!);
      expect(useViewStore.getState().zoom).toBeGreaterThan(before);
    });
  }

  it('the crop tool shows the flat relief, so the zoom bar is shown with it', () => {
    const root = reliefApp('3d-interactive', 1440);
    act(() => useViewStore.setState({ canvasTool: 'crop' }));
    expect(root.querySelector('[aria-label="3D relief view"]')).toBeNull();
    expect(zoomButtons(root)).toHaveLength(4);
  });
});
