import type { VectorResult } from '../types/vector';

/**
 * Parses SVG path string commands into discrete 2D point arrays for DXF polylines.
 */
function parseSvgPathToPoints(d: string, samplesPerCurve = 12): Array<Array<{ x: number; y: number }>> {
  const polylines: Array<Array<{ x: number; y: number }>> = [];
  let currentPolyline: Array<{ x: number; y: number }> = [];
  let currentX = 0;
  let currentY = 0;

  // Tokenize SVG path string
  const tokens = d.match(/([a-df-z]|[-+]?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?)/gi) || [];
  let i = 0;

  while (i < tokens.length) {
    const cmd = tokens[i];
    if (cmd === 'M') {
      if (currentPolyline.length > 0) {
        polylines.push(currentPolyline);
        currentPolyline = [];
      }
      currentX = parseFloat(tokens[++i]);
      currentY = parseFloat(tokens[++i]);
      currentPolyline.push({ x: currentX, y: currentY });
      i++;
    } else if (cmd === 'L') {
      currentX = parseFloat(tokens[++i]);
      currentY = parseFloat(tokens[++i]);
      currentPolyline.push({ x: currentX, y: currentY });
      i++;
    } else if (cmd === 'C') {
      const cp1x = parseFloat(tokens[++i]);
      const cp1y = parseFloat(tokens[++i]);
      const cp2x = parseFloat(tokens[++i]);
      const cp2y = parseFloat(tokens[++i]);
      const endX = parseFloat(tokens[++i]);
      const endY = parseFloat(tokens[++i]);

      // Sample cubic Bezier curve
      const p0 = { x: currentX, y: currentY };
      const p1 = { x: cp1x, y: cp1y };
      const p2 = { x: cp2x, y: cp2y };
      const p3 = { x: endX, y: endY };

      for (let s = 1; s <= samplesPerCurve; s++) {
        const t = s / samplesPerCurve;
        const mt = 1 - t;
        const bx =
          mt * mt * mt * p0.x +
          3 * mt * mt * t * p1.x +
          3 * mt * t * t * p2.x +
          t * t * t * p3.x;
        const by =
          mt * mt * mt * p0.y +
          3 * mt * mt * t * p1.y +
          3 * mt * t * t * p2.y +
          t * t * t * p3.y;
        currentPolyline.push({ x: bx, y: by });
      }

      currentX = endX;
      currentY = endY;
      i++;
    } else if (cmd === 'Q') {
      const cpx = parseFloat(tokens[++i]);
      const cpy = parseFloat(tokens[++i]);
      const endX = parseFloat(tokens[++i]);
      const endY = parseFloat(tokens[++i]);

      const p0 = { x: currentX, y: currentY };
      const p1 = { x: cpx, y: cpy };
      const p2 = { x: endX, y: endY };

      for (let s = 1; s <= samplesPerCurve; s++) {
        const t = s / samplesPerCurve;
        const mt = 1 - t;
        const bx = mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x;
        const by = mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y;
        currentPolyline.push({ x: bx, y: by });
      }

      currentX = endX;
      currentY = endY;
      i++;
    } else if (cmd === 'Z') {
      if (currentPolyline.length > 0) {
        // Close polyline
        currentPolyline.push({ ...currentPolyline[0] });
        polylines.push(currentPolyline);
        currentPolyline = [];
      }
      i++;
    } else {
      i++;
    }
  }

  if (currentPolyline.length > 0) {
    polylines.push(currentPolyline);
  }

  return polylines;
}

/**
 * Maps Hex colors to standard AutoCAD Color Index (ACI) 1-7.
 */
function hexToAci(hex: string): number {
  const clean = hex.replace('#', '');
  if (clean.length < 6) return 7; // White
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);

  if (r > 200 && g < 100 && b < 100) return 1; // Red
  if (r > 200 && g > 200 && b < 100) return 2; // Yellow
  if (r < 100 && g > 200 && b < 100) return 3; // Green
  if (r < 100 && g > 200 && b > 200) return 4; // Cyan
  if (r < 100 && g < 100 && b > 200) return 5; // Blue
  if (r > 200 && g < 100 && b > 200) return 6; // Magenta
  return 7; // White
}

/**
 * Generates an AutoCAD R12 ASCII DXF file from vector layers.
 * Fully compatible with LightBurn, Carbide Create, Vectric Aspire, Fusion 360, and G-Code senders.
 */
export function generateDXF(vectorResult: VectorResult): string {
  const { layers, dimensions } = vectorResult;
  const height = dimensions.height;

  const lines: string[] = [];

  // 1. HEADER SECTION
  lines.push('0', 'SECTION');
  lines.push('2', 'HEADER');
  lines.push('9', '$ACADVER');
  lines.push('1', 'AC1009'); // AutoCAD R12 ASCII standard
  lines.push('9', '$EXTMIN');
  lines.push('10', '0.0');
  lines.push('20', '0.0');
  lines.push('30', '0.0');
  lines.push('9', '$EXTMAX');
  lines.push('10', dimensions.width.toFixed(4));
  lines.push('20', dimensions.height.toFixed(4));
  lines.push('30', '0.0');
  lines.push('0', 'ENDSEC');

  // 2. TABLES SECTION (Layer definitions)
  lines.push('0', 'SECTION');
  lines.push('2', 'TABLES');
  lines.push('0', 'TABLE');
  lines.push('2', 'LAYER');
  lines.push('70', layers.length.toString());

  for (const layer of layers) {
    lines.push('0', 'LAYER');
    lines.push('2', layer.name.replace(/[^a-zA-Z0-9_-]/g, '_'));
    lines.push('70', '0');
    lines.push('62', hexToAci(layer.color).toString());
    lines.push('6', 'CONTINUOUS');
  }

  lines.push('0', 'ENDTAB');
  lines.push('0', 'ENDSEC');

  // 3. BLOCKS SECTION
  lines.push('0', 'SECTION');
  lines.push('2', 'BLOCKS');
  lines.push('0', 'ENDSEC');

  // 4. ENTITIES SECTION
  lines.push('0', 'SECTION');
  lines.push('2', 'ENTITIES');

  for (const layer of layers) {
    if (!layer.visible) continue;
    const layerName = layer.name.replace(/[^a-zA-Z0-9_-]/g, '_');

    for (const path of layer.paths) {
      const polylines = parseSvgPathToPoints(path.svgPathData);

      for (const poly of polylines) {
        if (poly.length < 2) continue;

        lines.push('0', 'POLYLINE');
        lines.push('8', layerName);
        lines.push('66', '1'); // Vertices follow flag
        lines.push('70', path.isClosed ? '1' : '0'); // 1 = closed, 0 = open

        for (const pt of poly) {
          lines.push('0', 'VERTEX');
          lines.push('8', layerName);
          lines.push('10', pt.x.toFixed(4));
          // Invert Y coordinate so origin (0,0) is at bottom-left in standard CAD coordinate space
          lines.push('20', (height - pt.y).toFixed(4));
          lines.push('30', '0.0');
        }

        lines.push('0', 'SEQEND');
        lines.push('8', layerName);
      }
    }
  }

  lines.push('0', 'ENDSEC');
  lines.push('0', 'EOF');

  return lines.join('\n');
}
