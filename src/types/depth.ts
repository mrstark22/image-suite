export type DepthSource = 'ai-estimation' | 'distance-transform' | 'tonal-height';
export type BevelStyle = 'dome' | 'prismatic' | 'bevel' | 'flat' | 'concave';
export type DepthViewMode = '3d-shaded' | '3d-interactive' | 'heatmap' | 'grayscale';
export type ReliefMaterial = 'walnut' | 'brass' | 'slate' | 'heat' | 'grayscale';

export interface DepthConfig {
  source: DepthSource;
  bevelStyle: BevelStyle;
  invertZ: boolean;
  zMin: number;             // 0 to 100%
  zMax: number;             // 0 to 100%
  smoothingRadius: number;  // 0 to 20 px (Gaussian)
  depthScale: number;       // 1.0 to 10.0 physical mm/depth unit
  reliefAngle: number;      // 15 to 90 degrees for V-bit simulation
  export16Bit: boolean;     // generate true 16-bit PNG (65,536 levels)
  detailEmboss?: number;    // 0 to 100% (High-frequency text & surface detail blend)
  aiWeight?: number;        // 0 to 100% (Base 3D geometric volume from AI)
  tonalBlend?: number;      // 0 to 100% (Tonal luminance relief sculpted onto 3D shape)
  surfaceDenoise?: number;  // 0 to 10px (Bilateral smoothing to eliminate grain & sensor noise)
  viewMode?: DepthViewMode;
  material?: ReliefMaterial;
  lightAngle?: number;      // 0 to 360 degrees
  lightElevation?: number;  // 10 to 80 degrees
}

export interface DepthResult {
  heightMapBuffer: ArrayBuffer;
  width: number;
  height: number;
  is16Bit: boolean;
  minZ: number;
  maxZ: number;
}
