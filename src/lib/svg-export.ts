import type { VectorResult } from '../types/vector';

export interface SvgExportOptions {
  strokeWidth?: number;
  includeBackground?: boolean;
  backgroundColor?: string;
  dpi?: number;
  physicalUnits?: 'px' | 'mm' | 'in';
}

/**
 * Generates production-ready SVG with grouped layers, physical dimensions, and CNC/laser metadata.
 */
export function generateProductionSVG(
  vectorResult: VectorResult,
  options: SvgExportOptions = {}
): string {
  const { layers, dimensions } = vectorResult;
  const {
    strokeWidth = 1,
    includeBackground = false,
    backgroundColor = '#ffffff',
    dpi = 96,
    physicalUnits = 'px',
  } = options;

  let widthAttr = `${dimensions.width}`;
  let heightAttr = `${dimensions.height}`;

  if (physicalUnits === 'mm') {
    const wMm = (dimensions.width / dpi) * 25.4;
    const hMm = (dimensions.height / dpi) * 25.4;
    widthAttr = `${wMm.toFixed(2)}mm`;
    heightAttr = `${hMm.toFixed(2)}mm`;
  } else if (physicalUnits === 'in') {
    const wIn = dimensions.width / dpi;
    const hIn = dimensions.height / dpi;
    widthAttr = `${wIn.toFixed(2)}in`;
    heightAttr = `${hIn.toFixed(2)}in`;
  }

  const svgLines: string[] = [];
  svgLines.push(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>`);
  svgLines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${widthAttr}" height="${heightAttr}" viewBox="0 0 ${dimensions.width} ${dimensions.height}" version="1.1">`
  );
  svgLines.push(`  <metadata>`);
  svgLines.push(`    <generator>Image Suite Precision Vector Engine</generator>`);
  svgLines.push(`    <totalPaths>${vectorResult.totalPaths}</totalPaths>`);
  svgLines.push(`    <totalNodes>${vectorResult.totalNodes}</totalNodes>`);
  svgLines.push(`  </metadata>`);

  if (includeBackground) {
    svgLines.push(
      `  <rect width="${dimensions.width}" height="${dimensions.height}" fill="${backgroundColor}" />`
    );
  }

  for (const layer of layers) {
    if (!layer.visible || layer.paths.length === 0) continue;

    const layerId = layer.id;
    const layerName = layer.name.replace(/"/g, '&quot;');
    const strokeColor = layer.color;

    svgLines.push(
      `  <g id="${layerId}" inkscape:label="${layerName}" stroke="${strokeColor}" fill="none" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">`
    );

    for (const path of layer.paths) {
      svgLines.push(`    <path id="${path.id}" d="${path.svgPathData}" />`);
    }

    svgLines.push(`  </g>`);
  }

  svgLines.push(`</svg>`);
  return svgLines.join('\n');
}
