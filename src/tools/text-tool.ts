/**
 * Image Suite — Interactive Canvas Text Tool (T)
 * Direct click-to-type typography creation on canvas.
 */

import type { CanvasTool } from '../core/tool-system';
import { createTextNode } from '../core/scene-graph';

export const textTool: CanvasTool = {
  id: 'text',
  name: 'Canvas Text Tool',
  shortcut: 'T',
  cursor: 'text',

  onPointerDown: (ctx, _e, worldPt) => {
    // Check if clicking existing text node
    const hitNode = ctx.hitTest(worldPt);
    if (hitNode && hitNode.type === 'text') {
      ctx.scene.selectNode(hitNode.id, false);
      ctx.scene.setActiveTool('move');
      return;
    }

    // Direct text node creation at click position
    const node = createTextNode('Custom Text', 48, 'Inter, sans-serif');
    node.transform.x = worldPt.x;
    node.transform.y = worldPt.y;

    ctx.scene.addNode(node);
    ctx.scene.setActiveTool('move');
  },

  onPointerMove: () => {},
  onPointerUp: () => {},
};
