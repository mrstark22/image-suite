import { describe, it, expect } from 'vitest';
import {
  generateToolpaths,
  type ToolpathSimulationResult,
} from '../../src/core/toolpath-generator';
import { generateGCode } from '../../src/core/gcode-export';
import { generateLightBurnProject } from '../../src/core/lbrn-export';
import { DEFAULT_CAM_OPERATIONS, DEFAULT_TOOL_LIBRARY } from '../../src/core/cam-engine';
import { createShapeNode, createVectorNode, type SceneNode } from '../../src/core/scene-graph';
import { HistoryManager } from '../../src/core/history';
import { exportProjectToJson, loadProjectFromJson } from '../../src/core/project-file';
import { useSceneStore } from '../../src/core/scene-store';

describe('CAM & Toolpath Generation Engine', () => {
  it('generates laser and CNC toolpaths with multi-pass depth slicing', () => {
    const square = createShapeNode('rectangle', 100, 100);
    const nodeMap = new Map<string, SceneNode>([[square.id, square]]);

    const simulation = generateToolpaths(
      DEFAULT_CAM_OPERATIONS,
      nodeMap,
      300,
      DEFAULT_TOOL_LIBRARY
    );

    expect(simulation.operations.length).toBeGreaterThan(0);
    expect(simulation.totalCutLengthMm).toBeGreaterThan(0);
    expect(simulation.totalRapidLengthMm).toBeGreaterThan(0);
    expect(simulation.totalEstimatedTimeSec).toBeGreaterThan(0);
  });

  it('generates standard GRBL and CNC G-Code', () => {
    const simulation: ToolpathSimulationResult = {
      operations: [
        {
          opId: 'op1',
          opName: 'Test Laser Cut',
          color: '#ef4444',
          cutLengthMm: 100,
          rapidLengthMm: 50,
          estimatedTimeSec: 30,
          segments: [
            { type: 'rapid', from: { x: 0, y: 0, z: 5 }, to: { x: 10, y: 10, z: 0 }, feedRateMmMin: 3000 },
            { type: 'cut', from: { x: 10, y: 10, z: 0 }, to: { x: 50, y: 10, z: 0 }, feedRateMmMin: 500, powerPercent: 100 },
          ],
        },
      ],
      totalCutLengthMm: 100,
      totalRapidLengthMm: 50,
      totalEstimatedTimeSec: 30,
    };

    const gcode = generateGCode(simulation, {
      flavor: 'grbl-laser',
      commentHeader: true,
      safeZ: 5,
      spindleSpeed: 1000,
    });

    expect(gcode).toContain('G21');
    expect(gcode).toContain('G90');
    expect(gcode).toContain('M4 S1000');
    expect(gcode).toContain('G1 X50.000 Y10.000');
    expect(gcode).toContain('M2');
  });

  it('exports valid LightBurn .lbrn2 project JSON', () => {
    const node = createVectorNode('Cut Path', 'M 0 0 L 50 50 Z', 50, 50);
    const nodeMap = new Map<string, SceneNode>([[node.id, node]]);

    const lbrnJson = generateLightBurnProject(DEFAULT_CAM_OPERATIONS, nodeMap);
    const parsed = JSON.parse(lbrnJson);

    expect(parsed.FormatVersion).toBe('1.0');
    expect(parsed.CutSetting.length).toBeGreaterThan(0);
    expect(parsed.Shape.length).toBeGreaterThan(0);
  });
});

describe('Command-Pattern History & Project File Serialization', () => {
  it('manages undo/redo stack and transaction batching', () => {
    const history = new HistoryManager();
    let val = 0;

    history.execute({
      name: 'Add 5',
      execute: () => { val += 5; },
      undo: () => { val -= 5; },
    });

    expect(val).toBe(5);
    expect(history.canUndo()).toBe(true);

    history.undo();
    expect(val).toBe(0);

    history.redo();
    expect(val).toBe(5);

    // Transaction Batch
    history.beginTransaction('Batch');
    history.execute({ name: '+1', execute: () => { val += 1; }, undo: () => { val -= 1; } });
    history.execute({ name: '+2', execute: () => { val += 2; }, undo: () => { val -= 2; } });
    history.commitTransaction('Batch');

    expect(val).toBe(8);
    history.undo();
    expect(val).toBe(5); // Rollback entire batch in 1 step!
  });

  it('serializes scene graph to .isuite and restores state faithfully', () => {
    useSceneStore.getState().clearScene();
    useSceneStore.getState().setDocumentSize(800, 600, 300, 'mm');

    useSceneStore.getState().addShapeNode('rectangle', 200, 100);
    useSceneStore.getState().addTextNode('CNC Workstation');

    const json = exportProjectToJson();
    expect(json).toContain('ImageSuiteProject');
    expect(json).toContain('CNC Workstation');

    // Clear and restore
    useSceneStore.getState().clearScene();
    expect(useSceneStore.getState().nodes.size).toBe(0);

    const success = loadProjectFromJson(json);
    expect(success).toBe(true);
    expect(useSceneStore.getState().nodes.size).toBe(2);
    expect(useSceneStore.getState().documentWidth).toBe(800);
    expect(useSceneStore.getState().documentHeight).toBe(600);
  });
});
