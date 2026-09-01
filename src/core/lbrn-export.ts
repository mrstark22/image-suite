/**
 * Image Suite — LightBurn .lbrn2 Project Exporter
 * Generates structured LightBurn project files with layer color mappings, speeds, powers, and vector paths.
 */

import type { CAMOperationConfig } from './cam-engine';
import type { SceneNode } from './scene-graph';

export function generateLightBurnProject(
  operations: CAMOperationConfig[],
  nodes: Map<string, SceneNode>
): string {
  const cuts = operations.map((op, idx) => ({
    index: idx,
    name: op.name,
    priority: idx,
    color: op.color,
    type: op.laserMode === 'engrave' ? 'Scan' : 'Cut',
    speed: (op.speedMmMin || 600) / 60, // LightBurn uses mm/sec
    power: op.powerPercent || 100,
    numPasses: op.passes || 1,
    airAssist: op.airAssist ?? true,
    kerf: op.kerfOffsetMm || 0,
  }));

  const shapes: any[] = [];
  operations.forEach((op, opIdx) => {
    const targetNodes = op.targetNodeIds.map((id) => nodes.get(id)!).filter(Boolean);
    const nodesToUse = targetNodes.length > 0 ? targetNodes : Array.from(nodes.values()).filter((n) => n.visible);

    nodesToUse.forEach((node) => {
      shapes.push({
        type: 'Path',
        cutIndex: opIdx,
        name: node.name,
        transform: node.transform,
        svgPath: node.vectorData?.svgPathData || '',
      });
    });
  });

  const projectObject = {
    FormatVersion: '1.0',
    AppVersion: 'ImageSuite-1.0',
    Thumbnail: '',
    CutSetting: cuts,
    Shape: shapes,
  };

  return JSON.stringify(projectObject, null, 2);
}
