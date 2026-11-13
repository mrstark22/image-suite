/**
 * The 3D relief view frames the whole plate at any view shape: at the
 * framing distance every corner of the plate projects inside the view, and
 * at least one touches the margin (so it is not framed loosely either).
 */
import { describe, expect, it } from 'vitest';
import { cameraBasis, fitDistance, framingDistance, FOV_Y_DEG, FRAME_MARGIN, type PlateBox } from '../../src/lib/orbit-camera';

/** Where each corner lands in the view, as (x, y) in -1..1, for a camera at `d` from the plate's middle. */
function projectCorners(box: PlateBox, azimuth: number, elevation: number, d: number, aspect: number): { x: number; y: number }[] {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  // The eye as DepthViewer3D's orbitView places it, relative to the target.
  const eye = [d * Math.cos(el) * Math.sin(az), -d * Math.cos(el) * Math.cos(az), d * Math.sin(el)];
  const { right, up } = cameraBasis(azimuth, elevation);
  const forward = eye.map((v) => -v / d);
  const tanY = Math.tan((FOV_Y_DEG * Math.PI) / 360);
  const out: { x: number; y: number }[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const v = [sx * box.halfX - eye[0], sy * box.halfY - eye[1], (sz * box.depth) / 2 - eye[2]];
    const dot = (a: number[]) => v[0] * a[0] + v[1] * a[1] + v[2] * a[2];
    const depth = dot(forward);
    expect(depth).toBeGreaterThan(0);
    out.push({ x: dot(right) / depth / (tanY * aspect), y: dot(up) / depth / tanY });
  }
  return out;
}

const plates: Record<string, PlateBox> = {
  square: { halfX: 1, halfY: 1, depth: 0.1 },
  'short wide strip': { halfX: 1, halfY: 0.1, depth: 0.05 },
  'tall narrow strip': { halfX: 0.1, halfY: 1, depth: 0.05 },
};
// Phone sheet open (412 x ~420), phone portrait, desktop, and extremes.
const aspects = { phone: 412 / 420, tall: 412 / 915, desktop: 1100 / 820, strip: 4, narrow: 0.25 };

describe('framing the relief plate', () => {
  for (const [plateName, box] of Object.entries(plates)) {
    for (const [aspectName, aspect] of Object.entries(aspects)) {
      for (const [azimuth, elevation] of [[45, 35], [0, 88], [130, 10]]) {
        it(`${plateName} in a ${aspectName} view at ${azimuth}°/${elevation}°: all corners inside, one at the margin`, () => {
          const d = fitDistance(box, azimuth, elevation, aspect);
          const pts = projectCorners(box, azimuth, elevation, d, aspect);
          const edge = Math.max(...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
          expect(edge).toBeLessThanOrEqual(1 / FRAME_MARGIN + 1e-9);
          expect(edge).toBeCloseTo(1 / FRAME_MARGIN, 6);
        });
      }
    }
  }

  it('the framing distance fits the plate from every direction at that elevation', () => {
    const box = plates['short wide strip'];
    const d = framingDistance(box, 35, 412 / 420);
    for (let az = 0; az < 360; az += 7) {
      for (const p of projectCorners(box, az, 35, d, 412 / 420)) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1 / FRAME_MARGIN + 0.01);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1 / FRAME_MARGIN + 0.01);
      }
    }
  });
});
