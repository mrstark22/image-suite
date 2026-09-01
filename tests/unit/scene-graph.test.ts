import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRasterNode,
  createVectorNode,
  createTextNode,
  createShapeNode,
  createCAMNode,
  type SolidFill,
} from '../../src/core/scene-graph';
import {
  createIdentityMatrix,
  multiplyMatrices,
  invertMatrix,
  transformPoint,
  getNodeTransformMatrix,
  worldToLocalPoint,
  hitTestNode,
  getNodeWorldAABB,
  hitTestSceneGraph,
  doesRectOverlap,
  findNodesInMarquee,
} from '../../src/core/hit-testing';
import { useSceneStore } from '../../src/core/scene-store';

describe('Scene Graph Node Models & Factories', () => {
  it('creates raster node with full polymorphic data payload', () => {
    const dummyBuffer = new ArrayBuffer(100 * 100 * 4);
    const node = createRasterNode('My Image', 100, 100, dummyBuffer);

    expect(node.type).toBe('raster');
    expect(node.name).toBe('My Image');
    expect(node.transform.width).toBe(100);
    expect(node.transform.height).toBe(100);
    expect(node.rasterData?.buffer).toBe(dummyBuffer);
    expect(node.visible).toBe(true);
    expect(node.locked).toBe(false);
  });

  it('creates vector node with stroke and path data', () => {
    const svgPath = 'M 0 0 L 50 50 Z';
    const node = createVectorNode('Cutline', svgPath, 50, 50, '#ff0000', 2.0);

    expect(node.type).toBe('vector');
    expect(node.stroke?.color).toBe('#ff0000');
    expect(node.stroke?.width).toBe(2.0);
    expect(node.vectorData?.svgPathData).toBe(svgPath);
  });

  it('creates text node with typographic metrics', () => {
    const node = createTextNode('CNC Router 2026', 36, 'Impact, sans-serif');

    expect(node.type).toBe('text');
    expect(node.textData?.text).toBe('CNC Router 2026');
    expect(node.textData?.fontSize).toBe(36);
    expect(node.textData?.fontFamily).toBe('Impact, sans-serif');
  });

  it('creates shape node with parametric properties', () => {
    const rect = createShapeNode('rectangle', 200, 100, '#10b981');
    expect(rect.type).toBe('shape');
    expect(rect.shapeData?.shapeKind).toBe('rectangle');
    expect((rect.fill as SolidFill)?.color).toBe('#10b981');

    const star = createShapeNode('star', 120, 120, '#f59e0b');
    expect(star.shapeData?.shapeKind).toBe('star');
    expect(star.shapeData?.pointCount).toBe(5);
  });

  it('creates CAM operation node with machine settings', () => {
    const camNode = createCAMNode('laser-cut', ['node-1', 'node-2'], '#ef4444');
    expect(camNode.type).toBe('cam-operation');
    expect(camNode.camData?.operation).toBe('laser-cut');
    expect(camNode.camData?.targetNodeIds).toEqual(['node-1', 'node-2']);
    expect(camNode.camData?.color).toBe('#ef4444');
  });
});

describe('2D Affine Matrix Geometry & Hit-Testing', () => {
  it('computes 2D affine matrix multiplication and inversion accurately', () => {
    const identity = createIdentityMatrix();
    const p = { x: 25, y: 35 };
    const transformed = transformPoint(identity, p);
    expect(transformed.x).toBe(25);
    expect(transformed.y).toBe(35);

    const m = { a: 2, b: 0, c: 0, d: 2, tx: 50, ty: 50 };
    const inv = invertMatrix(m);
    expect(inv).not.toBeNull();

    const forward = transformPoint(m, p);
    expect(forward.x).toBe(100);
    expect(forward.y).toBe(120);

    const reversed = transformPoint(inv!, forward);
    expect(reversed.x).toBeCloseTo(25);
    expect(reversed.y).toBeCloseTo(35);

    // Matrix composition (m * identity = m)
    const composed = multiplyMatrices(m, identity);
    expect(composed.a).toBe(m.a);
    expect(composed.tx).toBe(m.tx);
  });

  it('correctly maps world coordinate points to rotated & scaled node local space', () => {
    const transform = {
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      scaleX: 1.0,
      scaleY: 1.0,
      rotation: 0,
      anchorX: 0.5,
      anchorY: 0.5,
    };

    const mat = getNodeTransformMatrix(transform);
    expect(mat.a).toBe(1);
    expect(mat.d).toBe(1);

    // Center of node is at (100, 100) world coordinates. Local should be (50, 50).
    const centerLocal = worldToLocalPoint({ x: 100, y: 100 }, transform);
    expect(centerLocal?.x).toBeCloseTo(50);
    expect(centerLocal?.y).toBeCloseTo(50);

    // Top-left of node is (50, 50) world. Local should be (0, 0).
    const tlLocal = worldToLocalPoint({ x: 50, y: 50 }, transform);
    expect(tlLocal?.x).toBeCloseTo(0);
    expect(tlLocal?.y).toBeCloseTo(0);

    // Point outside (160, 160)
    const outsideLocal = worldToLocalPoint({ x: 160, y: 160 }, transform);
    expect(outsideLocal?.x).toBeCloseTo(110);
    expect(outsideLocal?.y).toBeCloseTo(110);
  });

  it('performs hit testing with rotation and bounds', () => {
    const dummyBuffer = new ArrayBuffer(100 * 100 * 4);
    const node = createRasterNode('Box', 100, 100, dummyBuffer);
    node.transform.x = 200;
    node.transform.y = 200;
    node.transform.rotation = 45; // Rotated 45 deg

    // Center point (200, 200) should definitely hit
    expect(hitTestNode({ x: 200, y: 200 }, node)).toBe(true);

    // Far away point (500, 500) should miss
    expect(hitTestNode({ x: 500, y: 500 }, node)).toBe(false);
  });

  it('computes world AABB and finds marquee intersections', () => {
    const transform = {
      x: 100,
      y: 100,
      width: 80,
      height: 60,
      scaleX: 1.0,
      scaleY: 1.0,
      rotation: 0,
      anchorX: 0.5,
      anchorY: 0.5,
    };

    const aabb = getNodeWorldAABB(transform);
    expect(aabb.x).toBe(60);
    expect(aabb.y).toBe(70);
    expect(aabb.width).toBe(80);
    expect(aabb.height).toBe(60);

    const marquee = { x: 50, y: 50, width: 50, height: 50 };
    expect(doesRectOverlap(marquee, aabb)).toBe(true);

    const farMarquee = { x: 500, y: 500, width: 50, height: 50 };
    expect(doesRectOverlap(farMarquee, aabb)).toBe(false);

    // Test findNodesInMarquee and hitTestSceneGraph
    const dummyBuffer = new ArrayBuffer(80 * 60 * 4);
    const node = createRasterNode('R1', 80, 60, dummyBuffer);
    node.transform = transform;

    const nodeMap = new Map([[node.id, node]]);
    const inMarquee = findNodesInMarquee(marquee, [node.id], nodeMap);
    expect(inMarquee).toEqual([node.id]);

    const hit = hitTestSceneGraph({ x: 100, y: 100 }, [node.id], nodeMap);
    expect(hit?.id).toBe(node.id);
  });
});

describe('Zustand Scene Graph Store', () => {
  beforeEach(() => {
    useSceneStore.getState().clearScene();
  });

  it('adds and removes nodes with correct z-ordering', () => {
    const store = useSceneStore.getState();
    const id1 = store.addShapeNode('rectangle', 100, 100);
    const id2 = store.addShapeNode('ellipse', 50, 50);

    expect(useSceneStore.getState().rootOrder).toEqual([id1, id2]);
    expect(useSceneStore.getState().nodes.size).toBe(2);

    // Remove node 1
    useSceneStore.getState().removeNode(id1);
    expect(useSceneStore.getState().rootOrder).toEqual([id2]);
    expect(useSceneStore.getState().nodes.size).toBe(1);
  });

  it('manages selection, duplication, and transform updates', () => {
    const store = useSceneStore.getState();
    const id = store.addTextNode('Hello World');

    expect(useSceneStore.getState().selectedIds).toEqual([id]);

    // Update transform
    useSceneStore.getState().updateNodeTransform(id, { x: 300, rotation: 90 });
    const node = useSceneStore.getState().getNode(id);
    expect(node?.transform.x).toBe(300);
    expect(node?.transform.rotation).toBe(90);

    // Duplicate
    const dupId = useSceneStore.getState().duplicateNode(id);
    expect(dupId).not.toBeNull();
    expect(useSceneStore.getState().nodes.size).toBe(2);
    expect(useSceneStore.getState().selectedIds).toEqual([dupId!]);
  });

  it('supports grouping and ungrouping multi-selections', () => {
    const store = useSceneStore.getState();
    const id1 = store.addShapeNode('rectangle');
    const id2 = store.addShapeNode('star');

    useSceneStore.getState().setSelectedIds([id1, id2]);
    const groupId = useSceneStore.getState().groupSelected('My Group');

    expect(groupId).not.toBeNull();
    const groupNode = useSceneStore.getState().getNode(groupId!);
    expect(groupNode?.type).toBe('group');
    expect(groupNode?.children).toEqual([id1, id2]);
    expect(useSceneStore.getState().rootOrder).toContain(groupId);
    expect(useSceneStore.getState().rootOrder).not.toContain(id1);

    // Ungroup
    useSceneStore.getState().ungroupNode(groupId!);
    expect(useSceneStore.getState().nodes.has(groupId!)).toBe(false);
    expect(useSceneStore.getState().rootOrder).toContain(id1);
    expect(useSceneStore.getState().rootOrder).toContain(id2);
  });

  it('supports z-order shifts (bringForward, sendBackward, bringToFront, sendToBack)', () => {
    const store = useSceneStore.getState();
    const id1 = store.addShapeNode('rectangle');
    const id2 = store.addShapeNode('ellipse');
    const id3 = store.addShapeNode('star');

    expect(useSceneStore.getState().rootOrder).toEqual([id1, id2, id3]);

    useSceneStore.getState().sendBackward(id3);
    expect(useSceneStore.getState().rootOrder).toEqual([id1, id3, id2]);

    useSceneStore.getState().bringToFront(id1);
    expect(useSceneStore.getState().rootOrder).toEqual([id3, id2, id1]);

    useSceneStore.getState().sendToBack(id1);
    expect(useSceneStore.getState().rootOrder).toEqual([id1, id3, id2]);
  });

  it('batch deletes multiple selected nodes and cleans up descendants', () => {
    const store = useSceneStore.getState();
    const id1 = store.addShapeNode('rectangle');
    const id2 = store.addShapeNode('ellipse');
    const id3 = store.addShapeNode('star');

    // Group id1 and id2
    useSceneStore.getState().setSelectedIds([id1, id2]);
    const groupId = useSceneStore.getState().groupSelected('Shapes Group')!;
    expect(useSceneStore.getState().nodes.size).toBe(4); // group + 2 children + id3
    expect(useSceneStore.getState().rootOrder).toEqual([groupId, id3]);

    // Select the group and id3, then removeSelected
    useSceneStore.getState().setSelectedIds([groupId, id3]);
    useSceneStore.getState().removeSelected();

    // All nodes including children of the group should be deleted
    expect(useSceneStore.getState().nodes.size).toBe(0);
    expect(useSceneStore.getState().rootOrder).toEqual([]);
    expect(useSceneStore.getState().selectedIds).toEqual([]);
  });

  it('removes a child from parent children list when only child is deleted', () => {
    const store = useSceneStore.getState();
    const id1 = store.addShapeNode('rectangle');
    const id2 = store.addShapeNode('ellipse');

    useSceneStore.getState().setSelectedIds([id1, id2]);
    const groupId = useSceneStore.getState().groupSelected('Group')!;

    // Delete only id1
    useSceneStore.getState().removeNode(id1);
    const groupNode = useSceneStore.getState().getNode(groupId);
    expect(groupNode?.children).toEqual([id2]);
    expect(useSceneStore.getState().nodes.has(id1)).toBe(false);
    expect(useSceneStore.getState().nodes.has(id2)).toBe(true);
  });
});
