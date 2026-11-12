/**
 * Touch gestures (#54): the pinch on the 2D canvas and the orbit camera of the
 * 3D view. The defining property of a pinch is that the image point under the
 * fingers stays under them while the zoom follows the distance between them.
 */
import { describe, it, expect } from 'vitest';
import { ActivePointers, midpoint, pinchView, spread, type PointerPair } from '../../src/lib/gestures';
import { MAX_ZOOM, MIN_ZOOM, type Point, type View } from '../../src/lib/viewport';
import {
  DEFAULT_CAMERA,
  MAX_DISTANCE,
  MAX_ELEVATION,
  MIN_DISTANCE,
  MIN_ELEVATION,
  ORBIT_DEG_PER_PX,
  orbitBy,
  panBy,
  pinchCamera,
} from '../../src/lib/orbit-camera';

/** The image point (from the image's centre, in image pixels) shown at screen point `p` (from the container's centre). */
function imagePointAt(view: View, p: Point): Point {
  return { x: (p.x - view.pan.x) / view.zoom, y: (p.y - view.pan.y) / view.zoom };
}

const VIEWS: View[] = [
  { zoom: 1, pan: { x: 0, y: 0 } },
  { zoom: 0.25, pan: { x: -40, y: 17 } },
  { zoom: 3.5, pan: { x: 120, y: -260 } },
];

const PINCHES: Array<{ start: PointerPair; now: PointerPair }> = [
  // Spread about a fixed midpoint.
  { start: [{ x: -20, y: 0 }, { x: 20, y: 0 }], now: [{ x: -60, y: 0 }, { x: 60, y: 0 }] },
  // Pinch in, off centre, while the midpoint moves.
  { start: [{ x: 50, y: -90 }, { x: 170, y: 30 }], now: [{ x: 95, y: -40 }, { x: 125, y: -10 }] },
  // Rotate and spread at once: only the distance counts.
  { start: [{ x: -10, y: -80 }, { x: -10, y: 40 }], now: [{ x: -100, y: 30 }, { x: 140, y: 30 }] },
];

describe('pinchView (#54)', () => {
  for (const view of VIEWS) {
    for (const [i, { start, now }] of PINCHES.entries()) {
      it(`pinch ${i} from zoom ${view.zoom}: the image point under the midpoint follows the midpoint`, () => {
        const before = imagePointAt(view, midpoint(start));
        const next = pinchView(view, start, now);
        const after = imagePointAt(next, midpoint(now));
        expect(after.x).toBeCloseTo(before.x, 9);
        expect(after.y).toBeCloseTo(before.y, 9);
      });

      it(`pinch ${i} from zoom ${view.zoom}: the zoom scales by the change in the fingers' distance`, () => {
        const next = pinchView(view, start, now);
        expect(next.zoom / view.zoom).toBeCloseTo(spread(now) / spread(start), 9);
      });
    }
  }

  it('two fingers moved together pan by their movement and leave the zoom alone', () => {
    const view = VIEWS[1];
    const start: PointerPair = [{ x: -30, y: 5 }, { x: 30, y: 5 }];
    const now: PointerPair = [{ x: 30, y: 35 }, { x: 90, y: 35 }];
    const next = pinchView(view, start, now);
    expect(next.zoom).toBe(view.zoom);
    expect(next.pan.x).toBeCloseTo(view.pan.x + 60, 9);
    expect(next.pan.y).toBeCloseTo(view.pan.y + 30, 9);
  });

  it('at the zoom limits the zoom is clamped and the point under the fingers still stays put', () => {
    const start: PointerPair = [{ x: 10, y: 10 }, { x: 20, y: 10 }];
    const far: PointerPair = [{ x: -500, y: 10 }, { x: 530, y: 10 }];
    const close: PointerPair = [{ x: 15, y: 10 }, { x: 15.01, y: 10 }];
    const view = { zoom: 2, pan: { x: 5, y: -5 } };
    const zoomedIn = pinchView({ zoom: 20, pan: view.pan }, start, far);
    expect(zoomedIn.zoom).toBe(MAX_ZOOM);
    const zoomedOut = pinchView(view, start, close);
    expect(zoomedOut.zoom).toBe(MIN_ZOOM);
    for (const [from, to, next] of [
      [{ zoom: 20, pan: view.pan }, far, zoomedIn],
      [view, close, zoomedOut],
    ] as const) {
      const before = imagePointAt(from, midpoint(start));
      const after = imagePointAt(next, midpoint(to));
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });

  it('two fingers on the same spot do not zoom', () => {
    const start: PointerPair = [{ x: 3, y: 3 }, { x: 3, y: 3 }];
    const next = pinchView(VIEWS[0], start, [{ x: 0, y: 0 }, { x: 50, y: 0 }]);
    expect(next.zoom).toBe(VIEWS[0].zoom);
  });
});

describe('ActivePointers (#54)', () => {
  it('pairs the first two pointers down, in order, and forgets one that goes up', () => {
    const p = new ActivePointers();
    p.down(7, { x: 1, y: 1 });
    expect(p.pair()).toBeNull();
    p.down(3, { x: 2, y: 2 });
    p.down(9, { x: 3, y: 3 });
    expect(p.pair()).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }]);
    expect(p.move(3, { x: 5, y: 5 })).toBe(true);
    expect(p.move(4, { x: 5, y: 5 })).toBe(false);
    p.up(7);
    expect(p.pair()).toEqual([{ x: 5, y: 5 }, { x: 3, y: 3 }]);
    expect(p.first()).toEqual({ id: 3, at: { x: 5, y: 5 } });
    expect(p.size).toBe(2);
  });
});

describe('orbit camera (#54)', () => {
  it('a drag across turns the view by ORBIT_DEG_PER_PX per pixel, and a drag down tilts it', () => {
    const next = orbitBy(DEFAULT_CAMERA, 25, -10);
    expect(next.azimuth).toBeCloseTo(DEFAULT_CAMERA.azimuth - 25 * ORBIT_DEG_PER_PX, 9);
    expect(next.elevation).toBeCloseTo(DEFAULT_CAMERA.elevation - 10 * ORBIT_DEG_PER_PX, 9);
    expect(next.distance).toBe(DEFAULT_CAMERA.distance);
  });

  it('the tilt stops at the limits', () => {
    expect(orbitBy(DEFAULT_CAMERA, 0, 10_000).elevation).toBe(MAX_ELEVATION);
    expect(orbitBy(DEFAULT_CAMERA, 0, -10_000).elevation).toBe(MIN_ELEVATION);
  });

  it('spreading two fingers to twice the distance halves the camera distance, as a 2x zoom', () => {
    const start: PointerPair = [{ x: 100, y: 200 }, { x: 140, y: 200 }];
    const now: PointerPair = [{ x: 80, y: 200 }, { x: 160, y: 200 }];
    const next = pinchCamera(DEFAULT_CAMERA, start, now);
    expect(next.distance).toBeCloseTo(DEFAULT_CAMERA.distance / 2, 9);
    expect(next.azimuth).toBe(DEFAULT_CAMERA.azimuth);
    expect(next.elevation).toBe(DEFAULT_CAMERA.elevation);
  });

  it('the camera distance stays within its limits', () => {
    const start: PointerPair = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(pinchCamera(DEFAULT_CAMERA, start, [{ x: 0, y: 0 }, { x: 1000, y: 0 }]).distance).toBe(MIN_DISTANCE);
    expect(pinchCamera(DEFAULT_CAMERA, start, [{ x: 0, y: 0 }, { x: 0.1, y: 0 }]).distance).toBe(MAX_DISTANCE);
  });

  it('two fingers moved together pan as a right-button drag of the same distance does', () => {
    const start: PointerPair = [{ x: 100, y: 200 }, { x: 140, y: 200 }];
    const now: PointerPair = [{ x: 130, y: 180 }, { x: 170, y: 180 }];
    const next = pinchCamera(DEFAULT_CAMERA, start, now);
    const dragged = panBy(DEFAULT_CAMERA, 30, -20);
    expect(next.panX).toBeCloseTo(dragged.panX, 9);
    expect(next.panY).toBeCloseTo(dragged.panY, 9);
    expect(next.distance).toBe(DEFAULT_CAMERA.distance);
  });
});
