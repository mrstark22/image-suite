export type VectorMode = 'outline' | 'centerline' | 'multi-color' | 'edge-detect';

export interface VectorConfig {
  mode: VectorMode;
  colorCount: number;         // 2 to 16 for multi-color K-Means
  threshold: number;          // 0 to 255
  rdpTolerance: number;       // 0.1 to 10.0 (simplification)
  curveFitting: boolean;      // Schneider cubic Bezier fitting
  bezierTolerance: number;    // 0.1 to 5.0
  invert: boolean;
  minPathArea: number;        // filter out specks/noise (pixels)
  denoise: number;            // 0 to 10 px pre-filter smoothing
  cannyLow: number;           // 10 to 100
  cannyHigh: number;          // 50 to 250
  strokeWidth: number;        // for preview rendering
  groupLayers: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface PathSegment {
  type: 'M' | 'L' | 'C' | 'Q' | 'Z';
  points: Point[];
}

export interface VectorPath {
  id: string;
  color: string;
  isClosed: boolean;
  segments: PathSegment[];
  svgPathData: string;
  nodeCount: number;
}

export interface VectorLayer {
  id: string;
  name: string;
  color: string;
  paths: VectorPath[];
  visible: boolean;
  totalNodes: number;
}

export interface VectorResult {
  layers: VectorLayer[];
  totalPaths: number;
  totalNodes: number;
  svgString: string;
  dimensions: { width: number; height: number };
}
