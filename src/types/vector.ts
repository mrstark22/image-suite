/** Black and white (one ink layer) or colour (one layer per colour). */
export type TraceColorMode = 'mono' | 'color';

/**
 * How each shape is traced (#26): Auto gives thin strokes a single centreline
 * and other shapes an outline; the other two apply one to every shape.
 */
export type TraceShapes = 'auto' | 'outline' | 'centerline';

/** One colour of a user-edited palette (#28). */
export interface PaletteEntry {
  /** The colour pixels are matched to, as #rrggbb. */
  color: string;
  /**
   * The colour this entry's layer is drawn and exported in, as #rrggbb, when
   * it differs from the colour matched: recolouring a layer must not change
   * which pixels belong to it.
   */
  drawAs?: string;
  /** Leave this colour out of the trace. */
  removed: boolean;
  /** Trace this colour as part of another entry's layer (its index), or null to keep its own layer. */
  mergeInto: number | null;
}

/** Tracing settings, held in the document. Every length is in millimetres. */
export interface VectorConfig {
  colorMode: TraceColorMode;
  shapes: TraceShapes;
  /**
   * Black and white: find the artwork automatically. The tracer picks the
   * grey level that separates the artwork from its background and which side
   * the artwork is, so light artwork (gold on white) traces as readily as
   * dark. When false, `threshold` is used as given.
   */
  autoThreshold: boolean;
  /** Black and white, with `autoThreshold` off: grey level (0 to 255) below which a pixel is ink. */
  threshold: number;
  /**
   * Black and white: swap what is traced. With `autoThreshold` it traces the
   * background instead of the artwork; without, the light areas instead of the dark.
   */
  invert: boolean;
  /** Colour: number of colours to find, when no palette is set. */
  colorCount: number;
  /** Colour: a fixed palette, or null to find the colours automatically. */
  palette: PaletteEntry[] | null;
  /** Auto: the widest shape, in mm, still traced as a single centreline. */
  maxStrokeWidthMm: number;
  /** Largest distance, in mm, between a fitted path and the traced edge. */
  toleranceMm: number;
  /** Turning angle, in degrees, above which a point is a sharp corner. */
  cornerAngle: number;
  /** Shapes and holes smaller than this area, in mm², are dropped. */
  minAreaMm2: number;
  /** Radius, in mm, of edge-preserving smoothing before tracing; 0 for none. */
  denoiseMm: number;
  /** Add a cutline around everything traced. */
  cutline: boolean;
  /** Distance, in mm, of the cutline outside the traced shapes. */
  cutlineOffsetMm: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A fill's outline, a stroke's centreline, or a cutline. */
export type PathKind = 'fill' | 'stroke' | 'cut';

export interface VectorPath {
  id: string;
  kind: PathKind;
  isClosed: boolean;
  /** SVG path data (M, L, C, Z) in pixels of the traced image. */
  d: string;
  nodeCount: number;
}

export interface VectorLayer {
  id: string;
  name: string;
  /** The colour the layer is drawn and exported in, as #rrggbb. */
  color: string;
  /** Colour mode: the image colour this layer traces, when the layer is drawn in another (`PaletteEntry.drawAs`). */
  sourceColor?: string;
  /** The palette entry this layer traces (colour mode), or null. */
  paletteIndex: number | null;
  paths: VectorPath[];
  visible: boolean;
  totalNodes: number;
}

export interface VectorResult {
  layers: VectorLayer[];
  /** Colours found or given (colour mode), as #rrggbb; empty in black and white. */
  palette: string[];
  /**
   * Black and white: the grey level that separated artwork from background
   * in this trace, and whether the lighter side was traced. Absent in colour
   * and for results that are not traces.
   */
  threshold?: { level: number; lightInk: boolean };
  totalPaths: number;
  totalNodes: number;
  /** Size of the traced image, in pixels: the coordinate space of every path. */
  dimensions: { width: number; height: number };
  /** Pixels of the traced image per millimetre, or null for a result that has no size. */
  pxPerMm: number | null;
}
