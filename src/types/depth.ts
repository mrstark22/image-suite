/**
 * Where the relief's heights come from (see `src/wasm/src/depth.rs`):
 * - `auto`: `distance-transform` for a nearly two-tone image (a logo), `tonal-height` otherwise.
 * - `tonal-height`: grey value, light high.
 * - `distance-transform`: a bevel rising from the shape's edges, by exact distance.
 * - `ai-estimation`: a depth estimate from the AI model, near high.
 */
export type DepthSource = 'auto' | 'ai-estimation' | 'distance-transform' | 'tonal-height';
/** The source `auto` resolves to on a given image. */
export type ResolvedDepthSource = Exclude<DepthSource, 'auto'>;
/**
 * Bevel profiles of the shape source, of `t` = distance from the edge / bevel width:
 * chamfer `t`, round `sqrt(1 - (1 - t)^2)`, cove `1 - sqrt(1 - t^2)`.
 */
export type BevelStyle = 'chamfer' | 'round' | 'cove';
/** How the relief step shows the heightmap: as a 3D surface, or as the flat grey image the file holds. */
export type DepthViewMode = '3d' | 'heightmap';
export type ReliefMaterial = 'walnut' | 'brass' | 'slate' | 'grayscale';

/**
 * The relief settings of a document.
 *
 * Shape settings change the heightmap, and so the exported file:
 * `source`, `bevelStyle`, `bevelWidthMm`, `shapeIsLight`, `detail`,
 * `smoothingMm`, `invertZ`. `maxDepthMm` sets the depth the view shows and,
 * with a relief calibration, the grey levels the file uses.
 *
 * View settings change only the screen: `viewMode`, `material`, `lightAngle`, `exaggeration`.
 */
export interface DepthConfig {
  source: DepthSource;
  bevelStyle: BevelStyle;
  /** Shape source: width over which the bevel rises, in mm. */
  bevelWidthMm: number;
  /** Shape source: the shape is the light part of the image (a light logo on a dark ground). */
  shapeIsLight: boolean;
  /** AI source: how much of the image's fine tonal detail is added to the estimated shape, 0 to 100 %. */
  detail: number;
  /** Gaussian smoothing, standard deviation in mm; 0 for none. */
  smoothingMm: number;
  /** Carve the image in instead of raising it: heights flipped. */
  invertZ: boolean;
  /** Depth of the deepest point, in mm. */
  maxDepthMm: number;
  viewMode: DepthViewMode;
  material: ReliefMaterial;
  /** Direction the light comes from in the 3D view, 0 to 360 degrees. */
  lightAngle: number;
  /** View only: the 3D view's depth is multiplied by this. 1 is true proportions. */
  exaggeration: number;
}

/** The fields of `DepthConfig` that change the heightmap. */
export const RELIEF_SHAPE_KEYS = ['source', 'bevelStyle', 'bevelWidthMm', 'shapeIsLight', 'detail', 'smoothingMm', 'invertZ'] as const;

export interface DepthResult {
  heightMapBuffer: ArrayBuffer;
  width: number;
  height: number;
  /** The source used: `auto` resolved. */
  source: ResolvedDepthSource;
}
