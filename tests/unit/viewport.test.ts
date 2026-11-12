/**
 * The viewport (#20): zoom keeps the point under the pointer still, Fit fits
 * and stays fitted when the window is resized, and the rulers' zero sits on
 * the image's edge.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  FIT_PADDING,
  MAX_ZOOM,
  RULER_THICKNESS,
  fitView,
  fromCentre,
  rulerZero,
  zoomAbout,
  type Point,
  type Size,
  type View,
} from '../../src/lib/viewport';
import { useViewStore } from '../../src/store/viewStore';

/**
 * Where image pixel `p` (from the image's top-left) appears in the container,
 * written out from the canvas wrapper's CSS independently of src/lib/viewport:
 * the wrapper is centred by flexbox, then `translate(pan) scale(zoom)` about
 * its own centre.
 */
function screenOf(p: Point, view: View, container: Size, image: Size): Point {
  return {
    x: container.width / 2 + view.pan.x + view.zoom * (p.x - image.width / 2),
    y: container.height / 2 + view.pan.y + view.zoom * (p.y - image.height / 2),
  };
}

/** The image pixel shown at container point `s`; the inverse of `screenOf`. */
function imagePointAt(s: Point, view: View, container: Size, image: Size): Point {
  return {
    x: (s.x - container.width / 2 - view.pan.x) / view.zoom + image.width / 2,
    y: (s.y - container.height / 2 - view.pan.y) / view.zoom + image.height / 2,
  };
}

const CONTAINER: Size = { width: 1000, height: 700 };
const IMAGE: Size = { width: 900, height: 600 };

const view = () => useViewStore.getState();

function resetView(): void {
  useViewStore.setState({ zoom: 1, pan: { x: 0, y: 0 }, container: null, image: null, fitted: false, canvasTool: 'pan' });
}

describe('zoom about the pointer', () => {
  const pointers: Point[] = [
    { x: 0, y: 0 },
    { x: 37, y: 512 },
    { x: 990, y: 13 },
    { x: 640, y: 333 },
  ];
  const start: View = { zoom: 0.7, pan: { x: -45, y: 80 } };

  for (const factor of [1.15, 1 / 1.15, 4]) {
    it(`keeps the image pixel under the pointer still when zooming by ${factor.toFixed(3)}`, () => {
      for (const pointer of pointers) {
        const before = imagePointAt(pointer, start, CONTAINER, IMAGE);
        const anchor = fromCentre(pointer, { left: 0, top: 0, ...CONTAINER });
        const next = zoomAbout(start, factor, anchor);
        expect(next.zoom).toBeCloseTo(start.zoom * factor, 12);
        const after = imagePointAt(pointer, next, CONTAINER, IMAGE);
        expect(after.x).toBeCloseTo(before.x, 9);
        expect(after.y).toBeCloseTo(before.y, 9);
      }
    });
  }

  it('keeps the pointer still when the zoom hits its limit', () => {
    const pointer = { x: 800, y: 100 };
    const near: View = { zoom: MAX_ZOOM / 2, pan: { x: 10, y: -20 } };
    const before = imagePointAt(pointer, near, CONTAINER, IMAGE);
    const next = zoomAbout(near, 10, fromCentre(pointer, { left: 0, top: 0, ...CONTAINER }));
    expect(next.zoom).toBe(MAX_ZOOM);
    const after = imagePointAt(pointer, next, CONTAINER, IMAGE);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('zooms the store about the given point, and about the centre without one', () => {
    resetView();
    useViewStore.setState({ zoom: 0.5, pan: { x: 30, y: -10 } });
    const pointer = { x: 120, y: 600 };
    const before = imagePointAt(pointer, view(), CONTAINER, IMAGE);
    view().zoomBy(2, fromCentre(pointer, { left: 0, top: 0, ...CONTAINER }));
    const after = imagePointAt(pointer, view(), CONTAINER, IMAGE);
    expect(view().zoom).toBe(1);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);

    // The buttons and Ctrl+/- zoom about the middle of the view.
    const centre = { x: CONTAINER.width / 2, y: CONTAINER.height / 2 };
    const middle = imagePointAt(centre, view(), CONTAINER, IMAGE);
    view().zoomBy(1.25);
    const middleAfter = imagePointAt(centre, view(), CONTAINER, IMAGE);
    expect(middleAfter.x).toBeCloseTo(middle.x, 9);
    expect(middleAfter.y).toBeCloseTo(middle.y, 9);
  });
});

describe('fit', () => {
  beforeEach(resetView);

  /** The image's on-screen box. */
  function box(v: View, container: Size, image: Size) {
    const tl = screenOf({ x: 0, y: 0 }, v, container, image);
    const br = screenOf({ x: image.width, y: image.height }, v, container, image);
    return { left: tl.x, top: tl.y, right: br.x, bottom: br.y };
  }

  it('shows the whole image, centred, with the padding on the tighter side', () => {
    const big = { width: 6000, height: 2000 };
    const v = fitView(CONTAINER, big);
    const b = box(v, CONTAINER, big);
    expect(b.left).toBeCloseTo(FIT_PADDING / 2, 9);
    expect(b.right).toBeCloseTo(CONTAINER.width - FIT_PADDING / 2, 9);
    expect(b.top).toBeGreaterThan(0);
    expect(b.bottom).toBeLessThan(CONTAINER.height);
    expect(b.top).toBeCloseTo(CONTAINER.height - b.bottom, 9);
  });

  it('keeps a fitted image clear of the rulers', () => {
    for (const image of [IMAGE, { width: 6000, height: 2000 }, { width: 500, height: 4000 }]) {
      for (const container of [CONTAINER, { width: 368, height: 828 }, { width: 1040, height: 300 }]) {
        const b = box(fitView(container, image), container, image);
        expect(b.left).toBeGreaterThanOrEqual(RULER_THICKNESS);
        expect(b.top).toBeGreaterThanOrEqual(RULER_THICKNESS);
      }
    }
  });

  it('does not enlarge a small image beyond 100 %', () => {
    expect(fitView(CONTAINER, { width: 100, height: 50 }).zoom).toBe(1);
  });

  it('the Fit control fits the image, not just 100 %', () => {
    view().setFrame(CONTAINER, { width: 4000, height: 3000 });
    view().zoomBy(1.25, { x: 200, y: 100 });
    view().fit();
    const b = box(view(), CONTAINER, { width: 4000, height: 3000 });
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.top).toBeCloseTo(FIT_PADDING / 2, 9);
    expect(b.right).toBeLessThanOrEqual(CONTAINER.width);
    expect(b.bottom).toBeCloseTo(CONTAINER.height - FIT_PADDING / 2, 9);
  });

  it('a fitted view fits again when the window is resized', () => {
    view().setFrame({ width: 1440, height: 800 }, IMAGE);
    view().fit();
    expect(view().zoom).toBe(1);
    view().setFrame({ width: 768, height: 800 }, IMAGE);
    const b = box(view(), { width: 768, height: 800 }, IMAGE);
    expect(b.left).toBeCloseTo(FIT_PADDING / 2, 9);
    expect(b.right).toBeCloseTo(768 - FIT_PADDING / 2, 9);
  });

  it('a fitted view fits again when the image size changes, as after a crop', () => {
    view().setFrame(CONTAINER, IMAGE);
    view().fit();
    view().setFrame(CONTAINER, { width: 3000, height: 3000 });
    expect(view().zoom).toBeCloseTo((CONTAINER.height - FIT_PADDING) / 3000, 12);
  });

  it('a fit requested before the canvas is laid out applies once it is', () => {
    view().fit();
    view().setFrame(CONTAINER, { width: 4000, height: 1000 });
    expect(view().zoom).toBeCloseTo((CONTAINER.width - FIT_PADDING) / 4000, 12);
  });

  it('after the user zooms or pans, a resize leaves the view alone', () => {
    view().setFrame(CONTAINER, IMAGE);
    view().fit();
    view().zoomBy(2);
    const zoomed = { zoom: view().zoom, pan: view().pan };
    view().setFrame({ width: 500, height: 400 }, IMAGE);
    expect({ zoom: view().zoom, pan: view().pan }).toEqual(zoomed);

    view().fit();
    view().setPan({ x: 40, y: 0 });
    view().setFrame(CONTAINER, IMAGE);
    expect(view().pan).toEqual({ x: 40, y: 0 });
  });
});

describe('rulers', () => {
  it('read zero at the image’s left and top edges, at any zoom and pan', () => {
    const views: View[] = [
      { zoom: 0.49, pan: { x: 0, y: 0 } },
      { zoom: 2, pan: { x: -300, y: 120 } },
      { zoom: 0.1, pan: { x: 55, y: -7 } },
    ];
    for (const v of views) {
      const zero = rulerZero(v, { width: 1440, height: 900 }, IMAGE);
      const edge = screenOf({ x: 0, y: 0 }, v, { width: 1440, height: 900 }, IMAGE);
      // The rulers start RULER_THICKNESS from the container's left and top.
      expect(RULER_THICKNESS + zero.x).toBeCloseTo(edge.x, 9);
      expect(RULER_THICKNESS + zero.y).toBeCloseTo(edge.y, 9);
    }
  });
});
