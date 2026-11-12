import { midpoint, spread, type PointerPair } from './gestures';

/**
 * The 3D relief view's orbit camera and how pointer gestures move it (#54).
 * One pointer (the left mouse button, a pen or one finger) orbits; the right
 * mouse button or two fingers pan; the wheel or a pinch moves the camera in
 * and out.
 */
export interface OrbitCamera {
  /** Degrees around the vertical axis. */
  azimuth: number;
  /** Degrees above the surface. */
  elevation: number;
  /** Distance from the target, in mesh units. */
  distance: number;
  panX: number;
  panY: number;
}

export const DEFAULT_CAMERA: OrbitCamera = { azimuth: 45, elevation: 35, distance: 2.6, panX: 0, panY: 0 };

/** Degrees of orbit per pixel dragged. */
export const ORBIT_DEG_PER_PX = 0.4;
export const MIN_ELEVATION = 10;
export const MAX_ELEVATION = 88;
export const MIN_DISTANCE = 0.8;
export const MAX_DISTANCE = 6.0;
/** Pan per pixel dragged, as a fraction of the camera's distance. */
const PAN_PER_PX = 0.003;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Orbits by a drag of (dx, dy) pixels: across turns the view, down tilts it towards the top. */
export function orbitBy(camera: OrbitCamera, dx: number, dy: number): OrbitCamera {
  return {
    ...camera,
    azimuth: (camera.azimuth - dx * ORBIT_DEG_PER_PX) % 360,
    elevation: clamp(camera.elevation + dy * ORBIT_DEG_PER_PX, MIN_ELEVATION, MAX_ELEVATION),
  };
}

/** Pans by a drag of (dx, dy) pixels, further when the camera is further away. */
export function panBy(camera: OrbitCamera, dx: number, dy: number): OrbitCamera {
  return {
    ...camera,
    panX: camera.panX + dx * PAN_PER_PX * camera.distance,
    panY: camera.panY - dy * PAN_PER_PX * camera.distance,
  };
}

/** Moves in or out by `factor` of the distance: under 1 is closer. */
export function dollyBy(camera: OrbitCamera, factor: number): OrbitCamera {
  return { ...camera, distance: clamp(camera.distance * factor, MIN_DISTANCE, MAX_DISTANCE) };
}

/** Degrees one arrow key orbits the focused 3D view (#81); Shift orbits `ORBIT_KEY_STEP_LARGE`. */
export const ORBIT_KEY_STEP = 15;
export const ORBIT_KEY_STEP_LARGE = 45;
/** The distance factor of one + or - key: + moves in by this much, - out. */
export const DOLLY_KEY_FACTOR = 1.25;

/**
 * The camera after the key `press` on the focused 3D view (#81), or null for
 * a key the view does not use. The arrows move the camera: Left and Right
 * around the surface (Right takes it to the right, as a drag to the left
 * does), Up towards the top view and Down towards a side view. + and = move
 * in, - and _ move out, as the wheel does.
 */
export function cameraForKey(camera: OrbitCamera, press: { key: string; shiftKey: boolean }): OrbitCamera | null {
  const step = (press.shiftKey ? ORBIT_KEY_STEP_LARGE : ORBIT_KEY_STEP) / ORBIT_DEG_PER_PX;
  switch (press.key) {
    case 'ArrowLeft':
      return orbitBy(camera, step, 0);
    case 'ArrowRight':
      return orbitBy(camera, -step, 0);
    case 'ArrowUp':
      return orbitBy(camera, 0, step);
    case 'ArrowDown':
      return orbitBy(camera, 0, -step);
    case '+':
    case '=':
      return dollyBy(camera, 1 / DOLLY_KEY_FACTOR);
    case '-':
    case '_':
      return dollyBy(camera, DOLLY_KEY_FACTOR);
    default:
      return null;
  }
}

/**
 * The camera after two fingers move from `start` to `now`, beginning from
 * `camera`. Spreading the fingers brings the surface closer by the same
 * ratio, as a pinch zoom does in 2D, and moving their midpoint pans.
 */
export function pinchCamera(camera: OrbitCamera, start: PointerPair, now: PointerPair): OrbitCamera {
  const after = spread(now);
  const dollied = after > 0 ? dollyBy(camera, spread(start) / after) : camera;
  const m0 = midpoint(start);
  const m1 = midpoint(now);
  return panBy(dollied, m1.x - m0.x, m1.y - m0.y);
}
