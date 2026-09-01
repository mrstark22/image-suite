/**
 * Image Suite — Native Project File Format (.isuite)
 * Serializes the complete Scene Graph, document dimensions, DPI, units, vector paths,
 * typography, and CAM machine operations to a single portable file format.
 */

import type { SceneNode } from './scene-graph';
import { useSceneStore, type CanvasUnit } from './scene-store';

export interface ImageSuiteProjectManifest {
  format: 'ImageSuiteProject';
  version: '2.0.0';
  created: number;
  updated: number;
  document: {
    width: number;
    height: number;
    dpi: number;
    unit: CanvasUnit;
  };
  rootOrder: string[];
  nodes: SceneNode[];
}

/**
 * Serializes the active scene graph document to JSON string
 */
export function exportProjectToJson(): string {
  const store = useSceneStore.getState();
  const nodesArray: SceneNode[] = [];

  store.nodes.forEach((node) => {
    // Clone node payload
    nodesArray.push({
      ...node,
      rasterData: node.rasterData
        ? {
            ...node.rasterData,
            // Strip raw buffer pointers from JSON export
            buffer: undefined,
            originalBuffer: undefined,
            bitmap: undefined,
          }
        : undefined,
    });
  });

  const manifest: ImageSuiteProjectManifest = {
    format: 'ImageSuiteProject',
    version: '2.0.0',
    created: Date.now(),
    updated: Date.now(),
    document: {
      width: store.documentWidth,
      height: store.documentHeight,
      dpi: store.dpi,
      unit: store.unit,
    },
    rootOrder: store.rootOrder,
    nodes: nodesArray,
  };

  return JSON.stringify(manifest, null, 2);
}

/**
 * Triggers download of the current project as an .isuite project file
 */
export function downloadProjectFile(filename: string = 'design-project.isuite'): void {
  const json = exportProjectToJson();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Imports and restores an .isuite project file into the active workspace
 */
export function loadProjectFromJson(jsonString: string): boolean {
  try {
    const manifest = JSON.parse(jsonString) as ImageSuiteProjectManifest;
    if (manifest.format !== 'ImageSuiteProject' || !Array.isArray(manifest.nodes)) {
      throw new Error('Invalid .isuite project file format');
    }

    const store = useSceneStore.getState();
    store.clearScene();

    store.setDocumentSize(
      manifest.document.width,
      manifest.document.height,
      manifest.document.dpi,
      manifest.document.unit
    );

    const nodeMap = new Map<string, SceneNode>();
    manifest.nodes.forEach((node) => {
      nodeMap.set(node.id, node);
    });

    useSceneStore.setState({
      nodes: nodeMap,
      rootOrder: manifest.rootOrder,
      selectedIds: manifest.rootOrder.length > 0 ? [manifest.rootOrder[0]] : [],
      revision: store.revision + 1,
    });

    return true;
  } catch (err) {
    console.error('Failed to load project file:', err);
    return false;
  }
}
