/**
 * Image Suite — Professional CAM & Fabrication Engine (VCarve / LightBurn Replacement)
 * Manages CNC tooling, laser layer parameters, feeds/speeds, kerf compensation, tabs, and operation models.
 */

export type LaserMode = 'cut' | 'engrave' | 'score';
export type CNCOperationKind = 'profile' | 'pocket' | 'vcarve' | 'drill';

export interface CNCTool {
  id: string;
  name: string;
  type: 'endmill' | 'vbit' | 'ballnose' | 'drill';
  diameterMm: number;
  vAngleDeg?: number;      // 60, 90, 120 for V-bits
  fluteCount: number;
  maxStepdownMm: number;   // Max depth per pass
  stepoverPercent: number; // 10% to 90%
  feedRateMmMin: number;
  plungeRateMmMin: number;
  spindleRpm: number;
}

export const DEFAULT_TOOL_LIBRARY: CNCTool[] = [
  {
    id: 'tool-endmill-3.175',
    name: '1/8" Flat Endmill (3.175mm)',
    type: 'endmill',
    diameterMm: 3.175,
    fluteCount: 2,
    maxStepdownMm: 1.5,
    stepoverPercent: 40,
    feedRateMmMin: 1200,
    plungeRateMmMin: 400,
    spindleRpm: 18000,
  },
  {
    id: 'tool-endmill-6.35',
    name: '1/4" Flat Endmill (6.35mm)',
    type: 'endmill',
    diameterMm: 6.35,
    fluteCount: 2,
    maxStepdownMm: 3.0,
    stepoverPercent: 45,
    feedRateMmMin: 1800,
    plungeRateMmMin: 600,
    spindleRpm: 16000,
  },
  {
    id: 'tool-vbit-60',
    name: '60° V-Carve Bit (6.35mm Shank)',
    type: 'vbit',
    diameterMm: 12.7,
    vAngleDeg: 60,
    fluteCount: 1,
    maxStepdownMm: 3.0,
    stepoverPercent: 20,
    feedRateMmMin: 1000,
    plungeRateMmMin: 350,
    spindleRpm: 18000,
  },
  {
    id: 'tool-vbit-90',
    name: '90° Chamfer / V-Bit (12.7mm)',
    type: 'vbit',
    diameterMm: 12.7,
    vAngleDeg: 90,
    fluteCount: 2,
    maxStepdownMm: 3.0,
    stepoverPercent: 20,
    feedRateMmMin: 1200,
    plungeRateMmMin: 400,
    spindleRpm: 18000,
  },
  {
    id: 'tool-ballnose-3.175',
    name: '1/8" Ball Nose (3.175mm)',
    type: 'ballnose',
    diameterMm: 3.175,
    fluteCount: 2,
    maxStepdownMm: 1.5,
    stepoverPercent: 12, // Fine stepover for 3D relief
    feedRateMmMin: 1400,
    plungeRateMmMin: 500,
    spindleRpm: 18000,
  },
];

export interface CAMOperationConfig {
  id: string;
  name: string;
  enabled: boolean;
  color: string;            // Visual layer identification (e.g. #FF0000 = Cut)
  mode: 'laser' | 'cnc';

  // Laser Specifics
  laserMode?: LaserMode;
  powerPercent?: number;    // 0 to 100%
  speedMmMin?: number;      // e.g. 500 mm/min
  passes?: number;          // 1 to 10
  airAssist?: boolean;

  // CNC Specifics
  cncOp?: CNCOperationKind;
  toolId?: string;
  totalDepthMm?: number;
  depthPerPassMm?: number;
  pocketStepoverPercent?: number;

  // Common CAM geometry & tabs
  kerfOffsetMm?: number;    // e.g. 0.1mm
  kerfDirection?: 'inside' | 'outside' | 'center';
  tabsEnabled?: boolean;
  tabCount?: number;
  tabWidthMm?: number;
  tabHeightMm?: number;

  // Associated scene nodes
  targetNodeIds: string[];
}

export const DEFAULT_CAM_OPERATIONS: CAMOperationConfig[] = [
  {
    id: 'cam-op-cut',
    name: 'Laser Vector Cut (0.1mm Kerf)',
    enabled: true,
    color: '#ef4444',
    mode: 'laser',
    laserMode: 'cut',
    powerPercent: 100,
    speedMmMin: 400,
    passes: 1,
    airAssist: true,
    kerfOffsetMm: 0.1,
    kerfDirection: 'outside',
    targetNodeIds: [],
  },
  {
    id: 'cam-op-score',
    name: 'Laser Vector Score / Marking',
    enabled: true,
    color: '#3b82f6',
    mode: 'laser',
    laserMode: 'score',
    powerPercent: 35,
    speedMmMin: 1500,
    passes: 1,
    airAssist: false,
    kerfOffsetMm: 0.0,
    kerfDirection: 'center',
    targetNodeIds: [],
  },
  {
    id: 'cam-op-vcarve',
    name: 'CNC 60° V-Carving Infill',
    enabled: true,
    color: '#10b981',
    mode: 'cnc',
    cncOp: 'vcarve',
    toolId: 'tool-vbit-60',
    totalDepthMm: 4.0,
    depthPerPassMm: 2.0,
    pocketStepoverPercent: 20,
    targetNodeIds: [],
  },
];
