/**
 * Image Suite — Professional CAD/CAM Scene Graph Engine
 * Core data models, affine transform matrices, bounding calculations, and node hierarchy.
 */

import type { TonalAdjustments, ColorAdjustments, DetailEnhancements } from '../types/image';
import type { DitherConfig } from '../types/dither';
import type { PathSegment, VectorResult } from '../types/vector';
import type { LayerBlendMode } from '../types/layer';

export type NodeType = 'raster' | 'vector' | 'text' | 'shape' | 'group' | 'cam-operation';

export interface Transform {
  x: number;          // Translation X in canvas/world coords (px)
  y: number;          // Translation Y in canvas/world coords (px)
  width: number;      // Intrinsic width
  height: number;     // Intrinsic height
  scaleX: number;     // Scale along X axis (default: 1.0)
  scaleY: number;     // Scale along Y axis (default: 1.0)
  rotation: number;   // Rotation angle in degrees (-180 to 180 or arbitrary deg)
  anchorX: number;    // Origin anchor point (0.0 to 1.0, default 0.5 = center)
  anchorY: number;    // Origin anchor point (0.0 to 1.0, default 0.5 = center)
}

export type FillType = 'solid' | 'linear-gradient' | 'radial-gradient' | 'none';

export interface SolidFill {
  type: 'solid';
  color: string;      // Hex/RGBA
  opacity: number;    // 0.0 to 1.0
}

export interface GradientStop {
  offset: number;     // 0.0 to 1.0
  color: string;
}

export interface LinearGradientFill {
  type: 'linear-gradient';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  stops: GradientStop[];
}

export interface RadialGradientFill {
  type: 'radial-gradient';
  cx: number;
  cy: number;
  radius: number;
  stops: GradientStop[];
}

export type Fill = SolidFill | LinearGradientFill | RadialGradientFill;

export type StrokeLineCap = 'butt' | 'round' | 'square';
export type StrokeLineJoin = 'miter' | 'round' | 'bevel';

export interface Stroke {
  color: string;
  width: number;          // in px or mm depending on canvas unit
  opacity: number;        // 0.0 to 1.0
  dashArray?: number[];   // e.g. [5, 5]
  lineCap: StrokeLineCap;
  lineJoin: StrokeLineJoin;
  miterLimit?: number;
}

// ----------------------------------------------------
// Node-Specific Data Payloads
// ----------------------------------------------------

export interface RasterNodeData {
  buffer?: ArrayBuffer;
  bitmap?: ImageBitmap;
  originalBuffer?: ArrayBuffer;
  format?: string;
  hasAlpha?: boolean;
  dpi?: number;
  
  // Non-destructive raster adjustment stack
  tonal?: Partial<TonalAdjustments>;
  color?: Partial<ColorAdjustments>;
  detail?: Partial<DetailEnhancements>;
  dither?: Partial<DitherConfig>;
}

export interface VectorNodeData {
  svgPathData: string;
  segments: PathSegment[];
  isClosed: boolean;
  nodeCount: number;
  vectorResult?: VectorResult;
}

export interface TextNodeData {
  text: string;
  fontFamily: string;
  fontSize: number;       // In px
  fontWeight: number | string;
  fontStyle: 'normal' | 'italic';
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;     // Multiplier e.g. 1.2
  letterSpacing: number;  // In px
  isStencilOutline?: boolean;
  stencilWidth?: number;
  cachedPathData?: string;
}

export type ShapeKind = 'rectangle' | 'ellipse' | 'polygon' | 'star' | 'line';

export interface ShapeNodeData {
  shapeKind: ShapeKind;
  cornerRadius?: number;       // For rectangles
  corners?: [number, number, number, number]; // [TL, TR, BR, BL]
  pointCount?: number;         // For polygon/star (e.g. 5)
  innerRadiusRatio?: number;   // For star (e.g. 0.5)
}

export type CAMOperationKind =
  | 'laser-cut'
  | 'laser-engrave'
  | 'laser-score'
  | 'cnc-profile'
  | 'cnc-pocket'
  | 'cnc-vcarve'
  | 'cnc-drill';

export interface CAMNodeData {
  operation: CAMOperationKind;
  targetNodeIds: string[];
  color: string;               // Identification layer color (e.g. #FF0000)
  powerPercent?: number;
  speedMmMin?: number;
  passes?: number;
  kerfOffsetMm?: number;
  kerfSide?: 'inside' | 'outside' | 'center';
  toolDiameterMm?: number;
  vBitAngleDeg?: number;
  stepoverPercent?: number;
  depthMm?: number;
  tabsEnabled?: boolean;
  tabWidthMm?: number;
  tabHeightMm?: number;
}

// ----------------------------------------------------
// The Canonical Scene Node
// ----------------------------------------------------

export interface SceneNode {
  id: string;
  type: NodeType;
  name: string;
  parent: string | null;      // Parent GroupNode ID or null (root level)
  children: string[];         // Child node IDs (for Group nodes)
  visible: boolean;
  locked: boolean;

  // Universal Transform & Appearance
  transform: Transform;
  opacity: number;            // 0.0 to 1.0
  blendMode: LayerBlendMode;
  fill: Fill | null;
  stroke: Stroke | null;

  // Polymorphic payload
  rasterData?: RasterNodeData;
  vectorData?: VectorNodeData;
  textData?: TextNodeData;
  shapeData?: ShapeNodeData;
  camData?: CAMNodeData;
}

// ----------------------------------------------------
// Node Factory Utilities
// ----------------------------------------------------

export function createDefaultTransform(width = 100, height = 100): Transform {
  return {
    x: 0,
    y: 0,
    width,
    height,
    scaleX: 1.0,
    scaleY: 1.0,
    rotation: 0,
    anchorX: 0.5,
    anchorY: 0.5,
  };
}

export function generateNodeId(prefix: string = 'node'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export function createRasterNode(
  name: string,
  width: number,
  height: number,
  buffer: ArrayBuffer,
  opts?: Partial<SceneNode>
): SceneNode {
  return {
    id: generateNodeId('raster'),
    type: 'raster',
    name,
    parent: null,
    children: [],
    visible: true,
    locked: false,
    transform: createDefaultTransform(width, height),
    opacity: 1.0,
    blendMode: 'source-over',
    fill: null,
    stroke: null,
    rasterData: {
      buffer,
      originalBuffer: buffer.slice(0),
      dpi: 300,
      hasAlpha: true,
    },
    ...opts,
  };
}

export function createVectorNode(
  name: string,
  svgPathData: string,
  width: number,
  height: number,
  strokeColor: string = '#38bdf8',
  strokeWidth: number = 1.5,
  opts?: Partial<SceneNode>
): SceneNode {
  return {
    id: generateNodeId('vector'),
    type: 'vector',
    name,
    parent: null,
    children: [],
    visible: true,
    locked: false,
    transform: createDefaultTransform(width, height),
    opacity: 1.0,
    blendMode: 'source-over',
    fill: null,
    stroke: {
      color: strokeColor,
      width: strokeWidth,
      opacity: 1.0,
      lineCap: 'round',
      lineJoin: 'round',
    },
    vectorData: {
      svgPathData,
      segments: [],
      isClosed: true,
      nodeCount: 0,
    },
    ...opts,
  };
}

export function createTextNode(
  text: string,
  fontSize: number = 48,
  fontFamily: string = 'Inter, sans-serif',
  opts?: Partial<SceneNode>
): SceneNode {
  const approxWidth = Math.max(120, text.length * (fontSize * 0.6));
  const approxHeight = Math.max(fontSize * 1.3, 40);

  return {
    id: generateNodeId('text'),
    type: 'text',
    name: `Text: ${text.split('\n')[0].substring(0, 14)}`,
    parent: null,
    children: [],
    visible: true,
    locked: false,
    transform: createDefaultTransform(approxWidth, approxHeight),
    opacity: 1.0,
    blendMode: 'source-over',
    fill: { type: 'solid', color: '#ffffff', opacity: 1.0 },
    stroke: null,
    textData: {
      text,
      fontFamily,
      fontSize,
      fontWeight: 600,
      fontStyle: 'normal',
      textAlign: 'center',
      lineHeight: 1.2,
      letterSpacing: 0,
    },
    ...opts,
  };
}

export function createShapeNode(
  shapeKind: ShapeKind,
  width: number = 150,
  height: number = 150,
  fillColor: string = '#38bdf8',
  opts?: Partial<SceneNode>
): SceneNode {
  return {
    id: generateNodeId('shape'),
    type: 'shape',
    name: `${shapeKind.charAt(0).toUpperCase() + shapeKind.slice(1)}`,
    parent: null,
    children: [],
    visible: true,
    locked: false,
    transform: createDefaultTransform(width, height),
    opacity: 1.0,
    blendMode: 'source-over',
    fill: { type: 'solid', color: fillColor, opacity: 1.0 },
    stroke: { color: '#ffffff', width: 1.0, opacity: 1.0, lineCap: 'round', lineJoin: 'round' },
    shapeData: {
      shapeKind,
      cornerRadius: shapeKind === 'rectangle' ? 0 : undefined,
      pointCount: shapeKind === 'polygon' || shapeKind === 'star' ? 5 : undefined,
      innerRadiusRatio: shapeKind === 'star' ? 0.5 : undefined,
    },
    ...opts,
  };
}

export function createGroupNode(name: string, childIds: string[] = []): SceneNode {
  return {
    id: generateNodeId('group'),
    type: 'group',
    name,
    parent: null,
    children: [...childIds],
    visible: true,
    locked: false,
    transform: createDefaultTransform(100, 100),
    opacity: 1.0,
    blendMode: 'source-over',
    fill: null,
    stroke: null,
  };
}

export function createCAMNode(
  operation: CAMOperationKind,
  targetNodeIds: string[],
  color: string = '#ef4444'
): SceneNode {
  return {
    id: generateNodeId('cam'),
    type: 'cam-operation',
    name: `CAM ${operation.toUpperCase()}`,
    parent: null,
    children: [],
    visible: true,
    locked: false,
    transform: createDefaultTransform(0, 0),
    opacity: 1.0,
    blendMode: 'source-over',
    fill: null,
    stroke: { color, width: 2, opacity: 1.0, lineCap: 'round', lineJoin: 'round' },
    camData: {
      operation,
      targetNodeIds,
      color,
      powerPercent: 100,
      speedMmMin: 500,
      passes: 1,
      kerfOffsetMm: 0.1,
      kerfSide: 'outside',
    },
  };
}
