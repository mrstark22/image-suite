/**
 * The viewport's geometry (#20). The image is centred in the container, then
 * moved by `pan` and scaled by `zoom` about its own centre, as the canvas
 * wrapper's CSS transform does: an image pixel at (u, v) from the image's
 * centre appears at container centre + pan + zoom * (u, v).
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface View {
  zoom: number;
  pan: Point;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 32;

/** Thickness of the rulers (the top one's height, the left one's width), in screen pixels. */
export const RULER_THICKNESS = 24;

/**
 * Space left around a fitted image, in screen pixels, split equally between
 * opposite sides: each side clears the rulers by 8 px.
 */
export const FIT_PADDING = 2 * (RULER_THICKNESS + 8);

export function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
}

/**
 * Multiplies the zoom by `factor`, keeping the image point under `anchor`
 * where it is. `anchor` is measured from the container's centre, so the
 * default zooms about the middle of the view.
 */
export function zoomAbout(view: View, factor: number, anchor: Point = { x: 0, y: 0 }): View {
  const zoom = clampZoom(view.zoom * factor);
  const k = zoom / view.zoom;
  return {
    zoom,
    pan: {
      x: anchor.x - (anchor.x - view.pan.x) * k,
      y: anchor.y - (anchor.y - view.pan.y) * k,
    },
  };
}

/**
 * The view that shows all of an `image` in a `container`, centred, at most
 * 100 %. `topInset` screen pixels at the top are kept clear (a bar over the
 * canvas, such as the crop tool's): the image is fitted and centred below them.
 */
export function fitView(container: Size, image: Size, topInset = 0): View {
  const inset = Math.max(0, Math.min(topInset, container.height / 2));
  const scale = Math.min(
    (container.width - FIT_PADDING) / image.width,
    (container.height - FIT_PADDING - inset) / image.height,
    1
  );
  return { zoom: clampZoom(scale), pan: { x: 0, y: inset / 2 } };
}

/** How far one arrow key pans the focused canvas, in screen pixels (#81); Shift pans `PAN_KEY_STEP_LARGE`. */
export const PAN_KEY_STEP = 40;
export const PAN_KEY_STEP_LARGE = 200;

/** How far past the container's edge a keyboard pan stops the image's edge: clear of the rulers. */
export const PAN_KEY_MARGIN = FIT_PADDING / 2;

/** One axis of a keyboard pan: move by `d`, but not past `limit` either way, and never jump back. */
function panAxis(p: number, d: number, limit: number): number {
  if (d > 0) return Math.max(p, Math.min(p + d, limit));
  return Math.min(p, Math.max(p + d, -limit));
}

/**
 * How far a keyboard pan may take the pan along one axis: until the image's
 * far edge is `PAN_KEY_MARGIN` inside the container. An image that already
 * shows that edge clear of the margin does not pan along the axis.
 */
function panAxisLimit(container: number, image: number, zoom: number): number {
  return Math.max(0, (image * zoom - container) / 2 + PAN_KEY_MARGIN);
}

/**
 * The pan after the arrow key `press` on the focused canvas (#81), or null
 * for any other key. Like scrolling, Right shows more of the image's right
 * side, so the image moves left. The pan stops when the image's far edge is
 * `PAN_KEY_MARGIN` inside the container, so each corner can be brought into
 * view and the image is not lost off screen; a pan already further out (by a
 * drag) is not pulled back. Without the sizes it is not limited.
 */
export function panForKey(
  view: View,
  container: Size | null,
  image: Size | null,
  press: { key: string; shiftKey: boolean },
): Point | null {
  const step = press.shiftKey ? PAN_KEY_STEP_LARGE : PAN_KEY_STEP;
  const deltas: Record<string, [number, number]> = {
    ArrowLeft: [step, 0],
    ArrowRight: [-step, 0],
    ArrowUp: [0, step],
    ArrowDown: [0, -step],
  };
  const d = deltas[press.key];
  if (!d) return null;
  const sized = container && image && container.width > 0 && container.height > 0;
  const limitX = sized ? panAxisLimit(container.width, image.width, view.zoom) : Infinity;
  const limitY = sized ? panAxisLimit(container.height, image.height, view.zoom) : Infinity;
  return { x: panAxis(view.pan.x, d[0], limitX), y: panAxis(view.pan.y, d[1], limitY) };
}

/** The point `client` (as in a mouse event) relative to the centre of `rect`. */
export function fromCentre(client: Point, rect: { left: number; top: number; width: number; height: number }): Point {
  return { x: client.x - rect.left - rect.width / 2, y: client.y - rect.top - rect.height / 2 };
}

/** Where the image's top-left corner appears, in pixels from the container's top-left. */
export function imageOrigin(view: View, container: Size, image: Size): Point {
  return {
    x: container.width / 2 + view.pan.x - (image.width * view.zoom) / 2,
    y: container.height / 2 + view.pan.y - (image.height * view.zoom) / 2,
  };
}

/**
 * Where the image's top-left corner falls on the rulers: x along the top
 * ruler and y down the left one. Each ruler starts `RULER_THICKNESS` from the
 * container's edge, past the corner box, so the zero is offset by that much.
 */
export function rulerZero(view: View, container: Size, image: Size): Point {
  const origin = imageOrigin(view, container, image);
  return { x: origin.x - RULER_THICKNESS, y: origin.y - RULER_THICKNESS };
}
