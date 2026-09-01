/**
 * Image Suite — Canvas Tool Registry & Dispatcher
 */

import type { CanvasTool } from '../core/tool-system';
import { moveTool } from './move-tool';
import { nodeTool } from './node-tool';
import { penTool } from './pen-tool';
import { textTool } from './text-tool';
import { shapeTool } from './shape-tool';

export const TOOL_REGISTRY: Record<string, CanvasTool> = {
  move: moveTool,
  node: nodeTool,
  pen: penTool,
  text: textTool,
  shape: shapeTool,
};

export function getCanvasTool(id: string): CanvasTool {
  return TOOL_REGISTRY[id] || moveTool;
}
