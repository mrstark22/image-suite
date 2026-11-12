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

/** The view that shows all of an `image` in a `container`, centred, at most 100 %. */
export function fitView(container: Size, image: Size): View {
  const scale = Math.min(
    (container.width - FIT_PADDING) / image.width,
    (container.height - FIT_PADDING) / image.height,
    1
  );
  return { zoom: clampZoom(scale), pan: { x: 0, y: 0 } };
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
