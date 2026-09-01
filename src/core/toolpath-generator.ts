/**
 * Image Suite — CNC & Laser Toolpath Generator & Motion Simulator
 * Generates multi-pass depth slices, kerf offset paths, pocket infill passes,
 * motion trajectory segments, and machining duration estimations.
 */

import type { Point2D } from './hit-testing';
import { getNodeTransformMatrix } from './hit-testing';
import { offsetPolyline, vecDistance, parseSvgPathToPolylines } from './path-math';
import type { CAMOperationConfig, CNCTool } from './cam-engine';
import { DEFAULT_TOOL_LIBRARY } from './cam-engine';
import type { SceneNode } from './scene-graph';
import { useEditStore } from '../store/editStore';

export interface ToolpathSegment {
  type: 'rapid' | 'cut' | 'plunge' | 'retract';
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  feedRateMmMin: number;
  powerPercent?: number;
}

export interface OperationToolpath {
  opId: string;
  opName: string;
  color: string;
  segments: ToolpathSegment[];
  cutLengthMm: number;
  rapidLengthMm: number;
  estimatedTimeSec: number;
}

export interface ToolpathSimulationResult {
  operations: OperationToolpath[];
  totalCutLengthMm: number;
  totalRapidLengthMm: number;
  totalEstimatedTimeSec: number;
}

/**
 * Converts screen pixels to physical millimeters using DPI
 */
export function pxToMm(px: number, dpi: number = 300): number {
  return (px / dpi) * 25.4;
}

/**
 * Converts physical millimeters to screen pixels using DPI
 */
export function mmToPx(mm: number, dpi: number = 300): number {
  return (mm / 25.4) * dpi;
}

/**
 * Generates complete toolpaths for all configured CAM operations
 */
export function generateToolpaths(
  operations: CAMOperationConfig[],
  nodes: Map<string, SceneNode>,
  dpi: number = 300,
  _toolLibrary: CNCTool[] = DEFAULT_TOOL_LIBRARY
): ToolpathSimulationResult {
  const result: ToolpathSimulationResult = {
    operations: [],
    totalCutLengthMm: 0,
    totalRapidLengthMm: 0,
    totalEstimatedTimeSec: 0,
  };

  const safeZMm = 5.0; // Safe clearance height

  // Also grab vectorResult from editStore if available
  const vectorResult = useEditStore.getState().vectorResult;

  for (const op of operations) {
    if (!op.enabled) continue;

    const opToolpath: OperationToolpath = {
      opId: op.id,
      opName: op.name,
      color: op.color,
      segments: [],
      cutLengthMm: 0,
      rapidLengthMm: 0,
      estimatedTimeSec: 0,
    };

    let currentPos = { x: 0, y: 0, z: safeZMm };

    // Collect all polylines to process
    const polylinesToProcess: Point2D[][] = [];

    // 1. From Target / Visible Scene Nodes
    const targetNodes = op.targetNodeIds.map((id) => nodes.get(id)!).filter(Boolean);
    const nodesToProcess = targetNodes.length > 0 ? targetNodes : Array.from(nodes.values()).filter((n) => n.visible);

    for (const node of nodesToProcess) {
      if (node.type === 'raster' && op.mode === 'laser' && op.laserMode === 'engrave') {
        // Generate raster scan lines
        const rasterScanLines = generateRasterScanLinesMm(node, dpi, 0.2); // 0.2mm line interval
        polylinesToProcess.push(...rasterScanLines);
      } else {
        const nodePolys = getNodePolylinesMm(node, dpi);
        polylinesToProcess.push(...nodePolys);
      }
    }

    // 2. If no vector nodes in scene yet, but vectorResult exists, add vectorResult paths
    if (polylinesToProcess.length === 0 && vectorResult && vectorResult.layers) {
      for (const layer of vectorResult.layers) {
        if (!layer.visible) continue;
        for (const p of layer.paths) {
          const parsed = parseSvgPathToPolylines(p.svgPathData);
          for (const poly of parsed) {
            const polyMm = poly.map((pt) => ({ x: pxToMm(pt.x, dpi), y: pxToMm(pt.y, dpi) }));
            polylinesToProcess.push(polyMm);
          }
        }
      }
    }

    // Process each polyline contour
    for (const rawPoly of polylinesToProcess) {
      if (rawPoly.length < 2) continue;

      // Apply Kerf / Offset if specified
      let poly = rawPoly;
      if (op.kerfOffsetMm && op.kerfOffsetMm > 0) {
        const offsetSign = op.kerfDirection === 'inside' ? -1 : 1;
        poly = offsetPolyline(rawPoly, op.kerfOffsetMm * offsetSign, true);
      }

      if (op.mode === 'laser') {
        // ----------------------------------------------------
        // Laser Vector Moves (Cut / Score / Engrave)
        // ----------------------------------------------------
        const passes = op.passes || 1;
        const feed = op.speedMmMin || 500;

        for (let pass = 0; pass < passes; pass++) {
          // Rapid to first point
          const startPt = poly[0];
          opToolpath.segments.push({
            type: 'rapid',
            from: { ...currentPos },
            to: { x: startPt.x, y: startPt.y, z: 0 },
            feedRateMmMin: 3000,
          });
          opToolpath.rapidLengthMm += vecDistance(currentPos, startPt);
          currentPos = { x: startPt.x, y: startPt.y, z: 0 };

          // Cutting moves around contour
          for (let i = 1; i < poly.length; i++) {
            const nextPt = poly[i];
            opToolpath.segments.push({
              type: 'cut',
              from: { ...currentPos },
              to: { x: nextPt.x, y: nextPt.y, z: 0 },
              feedRateMmMin: feed,
              powerPercent: op.powerPercent,
            });
            const segDist = vecDistance(currentPos, nextPt);
            opToolpath.cutLengthMm += segDist;
            currentPos = { x: nextPt.x, y: nextPt.y, z: 0 };
          }
        }
      } else {
        // ----------------------------------------------------
        // CNC Router Moves (Profile / Pocket / V-Carve)
        // ----------------------------------------------------
        const totalDepth = Math.abs(op.totalDepthMm || 3.0);
        const depthPerPass = Math.abs(op.depthPerPassMm || 1.5);
        const numPasses = Math.max(1, Math.ceil(totalDepth / depthPerPass));
        const feed = 1000;
        const plungeFeed = 300;

        const startPt = poly[0];

        // 1. Rapid move above contour start point at safe Z
        opToolpath.segments.push({
          type: 'rapid',
          from: { ...currentPos },
          to: { x: startPt.x, y: startPt.y, z: safeZMm },
          feedRateMmMin: 3000,
        });
        opToolpath.rapidLengthMm += vecDistance(currentPos, startPt);
        currentPos = { x: startPt.x, y: startPt.y, z: safeZMm };

        // Multi-pass depth slicing
        for (let pass = 1; pass <= numPasses; pass++) {
          const cutZ = -Math.min(pass * depthPerPass, totalDepth);

          // 2. Plunge into material
          opToolpath.segments.push({
            type: 'plunge',
            from: { ...currentPos },
            to: { x: startPt.x, y: startPt.y, z: cutZ },
            feedRateMmMin: plungeFeed,
          });
          currentPos = { x: startPt.x, y: startPt.y, z: cutZ };

          // 3. Cut along polyline
          for (let i = 1; i < poly.length; i++) {
            const nextPt = poly[i];
            opToolpath.segments.push({
              type: 'cut',
              from: { ...currentPos },
              to: { x: nextPt.x, y: nextPt.y, z: cutZ },
              feedRateMmMin: feed,
            });
            opToolpath.cutLengthMm += vecDistance(currentPos, nextPt);
            currentPos = { x: nextPt.x, y: nextPt.y, z: cutZ };
          }

          // 4. Retract back to safe height after final pass
          if (pass === numPasses) {
            opToolpath.segments.push({
              type: 'retract',
              from: { ...currentPos },
              to: { x: currentPos.x, y: currentPos.y, z: safeZMm },
              feedRateMmMin: 2000,
            });
            currentPos = { x: currentPos.x, y: currentPos.y, z: safeZMm };
          }
        }
      }
    }

    // Estimate time: cut time (mm / feed) + rapid time (mm / rapidFeed)
    const cutTimeMin = opToolpath.cutLengthMm / (op.speedMmMin || 600);
    const rapidTimeMin = opToolpath.rapidLengthMm / 3000;
    opToolpath.estimatedTimeSec = Math.round((cutTimeMin + rapidTimeMin) * 60);

    result.operations.push(opToolpath);
    result.totalCutLengthMm += opToolpath.cutLengthMm;
    result.totalRapidLengthMm += opToolpath.rapidLengthMm;
    result.totalEstimatedTimeSec += opToolpath.estimatedTimeSec;
  }

  return result;
}

/**
 * Extracts high-precision millimeter polylines from any SceneNode
 */
export function getNodePolylinesMm(node: SceneNode, dpi: number): Point2D[][] {
  const m = getNodeTransformMatrix(node.transform);

  const transformToWorldMm = (localPts: Point2D[]): Point2D[] => {
    return localPts.map((pt) => {
      // Affine matrix transform
      const wx = m.a * pt.x + m.c * pt.y + m.tx;
      const wy = m.b * pt.x + m.d * pt.y + m.ty;
      return {
        x: pxToMm(wx, dpi),
        y: pxToMm(wy, dpi),
      };
    });
  };

  if (node.type === 'vector' && node.vectorData?.svgPathData) {
    const rawPolys = parseSvgPathToPolylines(node.vectorData.svgPathData);
    return rawPolys.map(transformToWorldMm);
  }

  if (node.type === 'shape' && node.shapeData) {
    const data = node.shapeData;
    const w = node.transform.width;
    const h = node.transform.height;
    const kind = data.shapeKind;

    if (kind === 'rectangle') {
      const local = [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
        { x: 0, y: 0 },
      ];
      return [transformToWorldMm(local)];
    }

    if (kind === 'ellipse') {
      const local: Point2D[] = [];
      const cx = w / 2;
      const cy = h / 2;
      const rx = w / 2;
      const ry = h / 2;
      const steps = 64;
      for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * Math.PI * 2;
        local.push({ x: cx + Math.cos(theta) * rx, y: cy + Math.sin(theta) * ry });
      }
      return [transformToWorldMm(local)];
    }

    if (kind === 'star' || kind === 'polygon') {
      const local: Point2D[] = [];
      const cx = w / 2;
      const cy = h / 2;
      const points = data.pointCount || 5;
      const outerR = Math.min(w, h) / 2;
      const innerR = outerR * (data.innerRadiusRatio || 0.4);
      const totalPts = kind === 'star' ? points * 2 : points;
      const step = (Math.PI * 2) / totalPts;

      for (let i = 0; i <= totalPts; i++) {
        const r = (kind === 'star' && i % 2 !== 0) ? innerR : outerR;
        const angle = (i % totalPts) * step - Math.PI / 2;
        local.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
      }
      return [transformToWorldMm(local)];
    }
  }

  // Default: Node bounding rectangle
  const w = node.transform.width;
  const h = node.transform.height;
  const local = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
    { x: 0, y: 0 },
  ];
  return [transformToWorldMm(local)];
}

/**
 * Generates horizontal zigzag raster scanning lines for Laser Engraving
 */
export function generateRasterScanLinesMm(node: SceneNode, dpi: number, lineIntervalMm: number = 0.2): Point2D[][] {
  const t = node.transform;
  const minX = pxToMm(t.x - (t.width * t.scaleX) / 2, dpi);
  const maxX = pxToMm(t.x + (t.width * t.scaleX) / 2, dpi);
  const minY = pxToMm(t.y - (t.height * t.scaleY) / 2, dpi);
  const maxY = pxToMm(t.y + (t.height * t.scaleY) / 2, dpi);

  const lines: Point2D[][] = [];
  let y = minY;
  let direction = 1;

  while (y <= maxY) {
    if (direction === 1) {
      lines.push([
        { x: minX, y },
        { x: maxX, y },
      ]);
    } else {
      lines.push([
        { x: maxX, y },
        { x: minX, y },
      ]);
    }
    y += lineIntervalMm;
    direction *= -1;
  }

  return lines;
}
