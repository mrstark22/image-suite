/**
 * Image Suite — Canonical Scene Graph Zustand Store
 * Manages document hierarchy, multi-selection, transforms, z-order, grouping, and tool dispatch.
 */

import { create } from 'zustand';
import {
  type SceneNode,
  type Transform,
  createGroupNode,
  createRasterNode,
  createVectorNode,
  createTextNode,
  createShapeNode,
  createCAMNode,
  generateNodeId,
} from './scene-graph';
import { getNodeWorldAABB, type Rect2D } from './hit-testing';
import { useEditStore } from '../store/editStore';

export type CanvasToolType =
  | 'move'
  | 'node'
  | 'pen'
  | 'text'
  | 'shape'
  | 'brush'
  | 'eraser'
  | 'crop'
  | 'cam';

export type CanvasUnit = 'mm' | 'in' | 'px';

export interface SceneState {
  // Document Environment
  documentWidth: number;
  documentHeight: number;
  dpi: number;
  unit: CanvasUnit;

  // Scene Graph Data
  nodes: Map<string, SceneNode>;
  rootOrder: string[]; // Order from bottom (index 0) to top (last index)

  // Selection & Hover State
  selectedIds: string[];
  hoveredId: string | null;
  activeTool: CanvasToolType;

  // Change tracking revision
  revision: number;

  // Document & Tool Actions
  setDocumentSize: (width: number, height: number, dpi?: number, unit?: CanvasUnit) => void;
  setActiveTool: (tool: CanvasToolType) => void;

  // Node CRUD
  addNode: (node: SceneNode, targetIndex?: number) => string;
  removeNode: (id: string) => void;
  removeSelected: () => void;
  updateNode: (id: string, patch: Partial<SceneNode>) => void;
  updateNodeTransform: (id: string, transformPatch: Partial<Transform>) => void;
  duplicateNode: (id: string) => string | null;
  duplicateSelected: () => string[];

  // Selection Actions
  selectNode: (id: string, additive?: boolean) => void;
  setSelectedIds: (ids: string[]) => void;
  clearSelection: () => void;
  setHoveredId: (id: string | null) => void;
  selectAll: () => void;

  // Z-Order Hierarchy
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  reorderRootNodes: (fromIndex: number, toIndex: number) => void;

  // Grouping
  groupSelected: (groupName?: string) => string | null;
  ungroupNode: (groupId: string) => void;

  // Alignment & Distribution
  alignSelected: (alignment: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom') => void;

  // Quick Creators
  addRasterNode: (name: string, width: number, height: number, buffer: ArrayBuffer) => string;
  addVectorNode: (name: string, svgPathData: string, width: number, height: number, color?: string) => string;
  addTextNode: (text: string, fontSize?: number, fontFamily?: string) => string;
  addShapeNode: (shapeKind: 'rectangle' | 'ellipse' | 'polygon' | 'star' | 'line', width?: number, height?: number, color?: string) => string;
  addCAMNode: (operation: any, targetNodeIds: string[], color?: string) => string;

  // Utility Getters
  getNode: (id: string) => SceneNode | undefined;
  getSelectedNodes: () => SceneNode[];
  getSelectionAABB: () => Rect2D | null;
  clearScene: () => void;
}

export const useSceneStore = create<SceneState>((set, get) => ({
  documentWidth: 1024,
  documentHeight: 1024,
  dpi: 300,
  unit: 'mm',

  nodes: new Map<string, SceneNode>(),
  rootOrder: [],
  selectedIds: [],
  hoveredId: null,
  activeTool: 'move',
  revision: 0,

  setDocumentSize: (width, height, dpi = 300, unit = 'mm') => {
    set((state) => ({
      documentWidth: width,
      documentHeight: height,
      dpi,
      unit,
      revision: state.revision + 1,
    }));
  },

  setActiveTool: (activeTool) => set({ activeTool }),

  addNode: (node, targetIndex) => {
    useEditStore.getState().recordHistorySnapshot();
    const { nodes, rootOrder } = get();
    const newNodes = new Map(nodes);
    newNodes.set(node.id, node);

    const newRootOrder = [...rootOrder];
    if (typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex <= newRootOrder.length) {
      newRootOrder.splice(targetIndex, 0, node.id);
    } else {
      newRootOrder.push(node.id);
    }

    set((state) => ({
      nodes: newNodes,
      rootOrder: newRootOrder,
      selectedIds: [node.id],
      revision: state.revision + 1,
    }));

    return node.id;
  },

  removeNode: (id) => {
    const { nodes, rootOrder, selectedIds } = get();
    const target = nodes.get(id);
    if (!target) return;

    useEditStore.getState().recordHistorySnapshot();

    // Collect all descendant IDs if target is a group or has children
    const toDelete = new Set<string>([id]);
    const collectDescendants = (nodeId: string) => {
      const n = nodes.get(nodeId);
      if (n && n.children && n.children.length > 0) {
        for (const childId of n.children) {
          toDelete.add(childId);
          collectDescendants(childId);
        }
      }
    };
    collectDescendants(id);

    const newNodes = new Map(nodes);
    for (const dId of toDelete) {
      newNodes.delete(dId);
    }

    // If target node was inside a group that isn't being deleted, remove from parent's children
    if (target.parent && !toDelete.has(target.parent)) {
      const parentNode = newNodes.get(target.parent);
      if (parentNode) {
        newNodes.set(target.parent, {
          ...parentNode,
          children: parentNode.children.filter((cId) => !toDelete.has(cId)),
        });
      }
    }

    const newRootOrder = rootOrder.filter((nodeId) => !toDelete.has(nodeId));
    const newSelected = selectedIds.filter((nodeId) => !toDelete.has(nodeId));

    set((state) => ({
      nodes: newNodes,
      rootOrder: newRootOrder,
      selectedIds: newSelected,
      revision: state.revision + 1,
    }));
  },

  removeSelected: () => {
    const { selectedIds, nodes, rootOrder } = get();
    if (selectedIds.length === 0) return;

    useEditStore.getState().recordHistorySnapshot();

    const toDelete = new Set<string>();
    const collectDescendants = (nodeId: string) => {
      const n = nodes.get(nodeId);
      if (n && n.children && n.children.length > 0) {
        for (const childId of n.children) {
          toDelete.add(childId);
          collectDescendants(childId);
        }
      }
    };

    for (const id of selectedIds) {
      if (nodes.has(id)) {
        toDelete.add(id);
        collectDescendants(id);
      }
    }

    const newNodes = new Map(nodes);
    for (const id of toDelete) {
      newNodes.delete(id);
    }

    // Clean up parents for nodes being deleted whose parents are not being deleted
    for (const id of toDelete) {
      const originalNode = nodes.get(id);
      if (originalNode?.parent && !toDelete.has(originalNode.parent)) {
        const parentNode = newNodes.get(originalNode.parent);
        if (parentNode) {
          newNodes.set(originalNode.parent, {
            ...parentNode,
            children: parentNode.children.filter((cId) => !toDelete.has(cId)),
          });
        }
      }
    }

    const newRootOrder = rootOrder.filter((nodeId) => !toDelete.has(nodeId));

    set((state) => ({
      nodes: newNodes,
      rootOrder: newRootOrder,
      selectedIds: [],
      revision: state.revision + 1,
    }));
  },

  updateNode: (id, patch) => {
    const { nodes } = get();
    const current = nodes.get(id);
    if (!current) return;

    const updated: SceneNode = {
      ...current,
      ...patch,
    };

    const newNodes = new Map(nodes);
    newNodes.set(id, updated);

    set((state) => ({
      nodes: newNodes,
      revision: state.revision + 1,
    }));
  },

  updateNodeTransform: (id, transformPatch) => {
    const { nodes } = get();
    const current = nodes.get(id);
    if (!current) return;

    const updated: SceneNode = {
      ...current,
      transform: {
        ...current.transform,
        ...transformPatch,
      },
    };

    const newNodes = new Map(nodes);
    newNodes.set(id, updated);

    set((state) => ({
      nodes: newNodes,
      revision: state.revision + 1,
    }));
  },

  duplicateNode: (id) => {
    const { nodes, rootOrder } = get();
    const original = nodes.get(id);
    if (!original) return null;

    useEditStore.getState().recordHistorySnapshot();

    const newId = generateNodeId(original.type);
    const clone: SceneNode = {
      ...original,
      id: newId,
      name: `${original.name} (Copy)`,
      transform: {
        ...original.transform,
        x: original.transform.x + 20,
        y: original.transform.y + 20,
      },
      rasterData: original.rasterData
        ? {
            ...original.rasterData,
            buffer: original.rasterData.buffer?.slice(0),
            originalBuffer: original.rasterData.originalBuffer?.slice(0),
          }
        : undefined,
      vectorData: original.vectorData ? { ...original.vectorData } : undefined,
      textData: original.textData ? { ...original.textData } : undefined,
      shapeData: original.shapeData ? { ...original.shapeData } : undefined,
    };

    const newNodes = new Map(nodes);
    newNodes.set(newId, clone);

    const index = rootOrder.indexOf(id);
    const newRootOrder = [...rootOrder];
    if (index >= 0) {
      newRootOrder.splice(index + 1, 0, newId);
    } else {
      newRootOrder.push(newId);
    }

    set((state) => ({
      nodes: newNodes,
      rootOrder: newRootOrder,
      selectedIds: [newId],
      revision: state.revision + 1,
    }));

    return newId;
  },

  duplicateSelected: () => {
    const { selectedIds, duplicateNode } = get();
    const newIds: string[] = [];
    selectedIds.forEach((id) => {
      const dup = duplicateNode(id);
      if (dup) newIds.push(dup);
    });
    set({ selectedIds: newIds });
    return newIds;
  },

  selectNode: (id, additive = false) => {
    const { selectedIds, nodes } = get();
    if (!nodes.has(id)) return;

    if (!additive) {
      set({ selectedIds: [id] });
    } else {
      if (selectedIds.includes(id)) {
        set({ selectedIds: selectedIds.filter((i) => i !== id) });
      } else {
        set({ selectedIds: [...selectedIds, id] });
      }
    }
  },

  setSelectedIds: (selectedIds) => set({ selectedIds }),
  clearSelection: () => set({ selectedIds: [] }),
  setHoveredId: (hoveredId) => set({ hoveredId }),

  selectAll: () => {
    const { rootOrder } = get();
    set({ selectedIds: [...rootOrder] });
  },

  bringForward: (id) => {
    const { rootOrder } = get();
    const idx = rootOrder.indexOf(id);
    if (idx < 0 || idx >= rootOrder.length - 1) return;

    const newOrder = [...rootOrder];
    const temp = newOrder[idx];
    newOrder[idx] = newOrder[idx + 1];
    newOrder[idx + 1] = temp;

    set((state) => ({ rootOrder: newOrder, revision: state.revision + 1 }));
  },

  sendBackward: (id) => {
    const { rootOrder } = get();
    const idx = rootOrder.indexOf(id);
    if (idx <= 0) return;

    const newOrder = [...rootOrder];
    const temp = newOrder[idx];
    newOrder[idx] = newOrder[idx - 1];
    newOrder[idx - 1] = temp;

    set((state) => ({ rootOrder: newOrder, revision: state.revision + 1 }));
  },

  bringToFront: (id) => {
    const { rootOrder } = get();
    const idx = rootOrder.indexOf(id);
    if (idx < 0 || idx === rootOrder.length - 1) return;

    const newOrder = rootOrder.filter((nId) => nId !== id);
    newOrder.push(id);

    set((state) => ({ rootOrder: newOrder, revision: state.revision + 1 }));
  },

  sendToBack: (id) => {
    const { rootOrder } = get();
    const idx = rootOrder.indexOf(id);
    if (idx <= 0) return;

    const newOrder = rootOrder.filter((nId) => nId !== id);
    newOrder.unshift(id);

    set((state) => ({ rootOrder: newOrder, revision: state.revision + 1 }));
  },

  reorderRootNodes: (fromIndex, toIndex) => {
    const { rootOrder } = get();
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= rootOrder.length || toIndex >= rootOrder.length) return;

    const newOrder = [...rootOrder];
    const [moved] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, moved);

    set((state) => ({ rootOrder: newOrder, revision: state.revision + 1 }));
  },

  groupSelected: (groupName = 'Group') => {
    const { selectedIds, nodes, rootOrder } = get();
    if (selectedIds.length <= 1) return null;

    useEditStore.getState().recordHistorySnapshot();

    const groupNode = createGroupNode(groupName, selectedIds);
    const newNodes = new Map(nodes);
    newNodes.set(groupNode.id, groupNode);

    // Update child parents
    selectedIds.forEach((childId) => {
      const child = newNodes.get(childId);
      if (child) {
        newNodes.set(childId, { ...child, parent: groupNode.id });
      }
    });

    // Replace first selected position with group in rootOrder
    const lowestIdx = Math.min(...selectedIds.map((id) => rootOrder.indexOf(id)).filter((i) => i >= 0));
    const newRootOrder = rootOrder.filter((id) => !selectedIds.includes(id));
    newRootOrder.splice(lowestIdx >= 0 ? lowestIdx : newRootOrder.length, 0, groupNode.id);

    set((state) => ({
      nodes: newNodes,
      rootOrder: newRootOrder,
      selectedIds: [groupNode.id],
      revision: state.revision + 1,
    }));

    return groupNode.id;
  },

  ungroupNode: (groupId) => {
    const { nodes, rootOrder } = get();
    const groupNode = nodes.get(groupId);
    if (!groupNode || groupNode.type !== 'group') return;

    useEditStore.getState().recordHistorySnapshot();

    const newNodes = new Map(nodes);
    newNodes.delete(groupId);

    // Unparent children
    groupNode.children.forEach((childId) => {
      const child = newNodes.get(childId);
      if (child) {
        newNodes.set(childId, { ...child, parent: null });
      }
    });

    const groupIdx = rootOrder.indexOf(groupId);
    const newRootOrder = [...rootOrder];
    if (groupIdx >= 0) {
      newRootOrder.splice(groupIdx, 1, ...groupNode.children);
    }

    set((state) => ({
      nodes: newNodes,
      rootOrder: newRootOrder,
      selectedIds: [...groupNode.children],
      revision: state.revision + 1,
    }));
  },

  alignSelected: (alignment) => {
    const { selectedIds, nodes, documentWidth, documentHeight, updateNodeTransform } = get();
    if (selectedIds.length === 0) return;

    useEditStore.getState().recordHistorySnapshot();

    selectedIds.forEach((id) => {
      const node = nodes.get(id);
      if (!node) return;

      const halfW = (node.transform.width * node.transform.scaleX) / 2;
      const halfH = (node.transform.height * node.transform.scaleY) / 2;

      let newX = node.transform.x;
      let newY = node.transform.y;

      switch (alignment) {
        case 'center-h':
          newX = documentWidth / 2;
          break;
        case 'center-v':
          newY = documentHeight / 2;
          break;
        case 'left':
          newX = halfW;
          break;
        case 'right':
          newX = documentWidth - halfW;
          break;
        case 'top':
          newY = halfH;
          break;
        case 'bottom':
          newY = documentHeight - halfH;
          break;
      }

      updateNodeTransform(id, { x: newX, y: newY });
    });
  },

  addRasterNode: (name, width, height, buffer) => {
    const node = createRasterNode(name, width, height, buffer);
    // Center initially on document
    node.transform.x = get().documentWidth / 2;
    node.transform.y = get().documentHeight / 2;
    return get().addNode(node);
  },

  addVectorNode: (name, svgPathData, width, height, color) => {
    const node = createVectorNode(name, svgPathData, width, height, color);
    node.transform.x = get().documentWidth / 2;
    node.transform.y = get().documentHeight / 2;
    return get().addNode(node);
  },

  addTextNode: (text, fontSize, fontFamily) => {
    const node = createTextNode(text, fontSize, fontFamily);
    node.transform.x = get().documentWidth / 2;
    node.transform.y = get().documentHeight / 2;
    return get().addNode(node);
  },

  addShapeNode: (shapeKind, width, height, color) => {
    const node = createShapeNode(shapeKind, width, height, color);
    node.transform.x = get().documentWidth / 2;
    node.transform.y = get().documentHeight / 2;
    return get().addNode(node);
  },

  addCAMNode: (operation, targetNodeIds, color) => {
    const node = createCAMNode(operation, targetNodeIds, color);
    return get().addNode(node);
  },

  getNode: (id) => get().nodes.get(id),

  getSelectedNodes: () => {
    const { selectedIds, nodes } = get();
    return selectedIds.map((id) => nodes.get(id)!).filter(Boolean);
  },

  getSelectionAABB: () => {
    const selected = get().getSelectedNodes();
    if (selected.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of selected) {
      const aabb = getNodeWorldAABB(node.transform);
      if (aabb.x < minX) minX = aabb.x;
      if (aabb.y < minY) minY = aabb.y;
      if (aabb.x + aabb.width > maxX) maxX = aabb.x + aabb.width;
      if (aabb.y + aabb.height > maxY) maxY = aabb.y + aabb.height;
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  },

  clearScene: () => {
    set((state) => ({
      nodes: new Map(),
      rootOrder: [],
      selectedIds: [],
      hoveredId: null,
      revision: state.revision + 1,
    }));
  },
}));
