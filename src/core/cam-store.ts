/**
 * Image Suite — CAM & Toolpath Zustand Store
 * Manages active operations, tool library, simulation state, toolhead position, and visual overlays.
 */

import { create } from 'zustand';
import {
  type CAMOperationConfig,
  type CNCTool,
  DEFAULT_CAM_OPERATIONS,
  DEFAULT_TOOL_LIBRARY,
} from './cam-engine';
import { generateToolpaths, type ToolpathSimulationResult } from './toolpath-generator';
import { useSceneStore } from './scene-store';

interface CAMState {
  operations: CAMOperationConfig[];
  toolLibrary: CNCTool[];
  activeSimulation: ToolpathSimulationResult | null;
  showToolpaths: boolean;
  isCalculating: boolean;
  gcodeFlavor: 'grbl-laser' | 'grbl-cnc' | 'marlin';

  // Simulation playback player
  isPlaying: boolean;
  simulationProgress: number; // 0.0 to 1.0

  // Actions
  setOperations: (ops: CAMOperationConfig[] | ((prev: CAMOperationConfig[]) => CAMOperationConfig[])) => void;
  updateOperation: (id: string, patch: Partial<CAMOperationConfig>) => void;
  addOperation: (mode: 'laser-cut' | 'laser-score' | 'cnc-vcarve') => void;
  removeOperation: (id: string) => void;
  toggleOperation: (id: string) => void;

  setGcodeFlavor: (flavor: 'grbl-laser' | 'grbl-cnc' | 'marlin') => void;
  setShowToolpaths: (show: boolean) => void;
  toggleShowToolpaths: () => void;

  calculateToolpaths: () => void;
  clearToolpaths: () => void;

  setSimulationProgress: (prog: number) => void;
  setIsPlaying: (playing: boolean) => void;
}

export const useCAMStore = create<CAMState>((set, get) => ({
  operations: DEFAULT_CAM_OPERATIONS,
  toolLibrary: DEFAULT_TOOL_LIBRARY,
  activeSimulation: null,
  showToolpaths: false,
  isCalculating: false,
  gcodeFlavor: 'grbl-laser',

  isPlaying: false,
  simulationProgress: 1.0,

  setOperations: (ops) =>
    set((state) => ({
      operations: typeof ops === 'function' ? ops(state.operations) : ops,
    })),

  updateOperation: (id, patch) => {
    set((state) => ({
      operations: state.operations.map((op) => (op.id === id ? { ...op, ...patch } : op)),
    }));
    get().calculateToolpaths();
  },

  addOperation: (mode) => {
    const newId = `cam-op-${Date.now()}`;
    let newOp: CAMOperationConfig;

    if (mode === 'laser-cut') {
      newOp = {
        id: newId,
        name: 'Laser Vector Cut',
        enabled: true,
        color: '#ef4444',
        mode: 'laser',
        laserMode: 'cut',
        powerPercent: 100,
        speedMmMin: 400,
        passes: 1,
        kerfOffsetMm: 0.1,
        kerfDirection: 'outside',
        targetNodeIds: [],
      };
    } else if (mode === 'laser-score') {
      newOp = {
        id: newId,
        name: 'Laser Score / Marking',
        enabled: true,
        color: '#3b82f6',
        mode: 'laser',
        laserMode: 'score',
        powerPercent: 35,
        speedMmMin: 1200,
        passes: 1,
        kerfOffsetMm: 0,
        kerfDirection: 'center',
        targetNodeIds: [],
      };
    } else {
      newOp = {
        id: newId,
        name: 'CNC V-Carve (60°)',
        enabled: true,
        color: '#10b981',
        mode: 'cnc',
        cncOp: 'vcarve',
        toolId: 'tool-vbit-60',
        totalDepthMm: 3.0,
        depthPerPassMm: 1.5,
        targetNodeIds: [],
      };
    }

    set((state) => ({ operations: [...state.operations, newOp] }));
    get().calculateToolpaths();
  },

  removeOperation: (id) => {
    set((state) => ({ operations: state.operations.filter((op) => op.id !== id) }));
    get().calculateToolpaths();
  },

  toggleOperation: (id) => {
    set((state) => ({
      operations: state.operations.map((op) => (op.id === id ? { ...op, enabled: !op.enabled } : op)),
    }));
    get().calculateToolpaths();
  },

  setGcodeFlavor: (gcodeFlavor) => set({ gcodeFlavor }),
  setShowToolpaths: (showToolpaths) => set({ showToolpaths }),
  toggleShowToolpaths: () => set((state) => ({ showToolpaths: !state.showToolpaths })),

  calculateToolpaths: () => {
    const { operations, toolLibrary } = get();
    const sceneNodes = useSceneStore.getState().nodes;
    const dpi = useSceneStore.getState().dpi;

    set({ isCalculating: true });

    try {
      const sim = generateToolpaths(operations, sceneNodes, dpi, toolLibrary);
      set({ activeSimulation: sim, isCalculating: false, showToolpaths: true });
    } catch (err) {
      console.error('Failed to compute toolpaths:', err);
      set({ isCalculating: false });
    }
  },

  clearToolpaths: () => set({ activeSimulation: null }),
  setSimulationProgress: (simulationProgress) => set({ simulationProgress }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
}));
