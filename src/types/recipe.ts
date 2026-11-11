import type { TonalAdjustments, ColorAdjustments, CropRect } from './image';
import type { DetailSettings } from './document';
import type { DitherConfig } from './dither';
import type { VectorConfig } from './vector';
import type { DepthConfig } from './depth';

export type EditStepType =
  | 'geometry'
  | 'tonal'
  | 'color'
  | 'detail'
  | 'dither'
  | 'vectorize'
  | 'depth'
  | 'bg-remove';

export interface BaseEditStep {
  id: string;
  type: EditStepType;
  enabled: boolean;
  timestamp: number;
}

export interface GeometryStep extends BaseEditStep {
  type: 'geometry';
  /** The crop in pixels of the source image the recipe was saved from. */
  params: { crop: CropRect | null };
}

export interface TonalStep extends BaseEditStep {
  type: 'tonal';
  params: TonalAdjustments;
}

export interface ColorStep extends BaseEditStep {
  type: 'color';
  params: ColorAdjustments;
}

export interface DetailStep extends BaseEditStep {
  type: 'detail';
  params: DetailSettings;
}

export interface DitherStep extends BaseEditStep {
  type: 'dither';
  params: DitherConfig;
}

export interface VectorStep extends BaseEditStep {
  type: 'vectorize';
  params: VectorConfig;
}

export interface DepthStep extends BaseEditStep {
  type: 'depth';
  params: DepthConfig;
}

export interface BgRemoveStep extends BaseEditStep {
  type: 'bg-remove';
  params: {
    model: string;
    refineEdges: boolean;
    featherRadius: number;
  };
}

export type EditStep =
  | GeometryStep
  | TonalStep
  | ColorStep
  | DetailStep
  | DitherStep
  | VectorStep
  | DepthStep
  | BgRemoveStep;

/**
 * Recipe format version. Version 2 stores the detail lengths in millimetres and
 * the crop in source pixels. Nothing could import version 1, so none exist.
 */
export const RECIPE_VERSION = '2.0.0';

export interface EditRecipe {
  version: string;
  name: string;
  description?: string;
  targetMaterial?: string;
  createdAt: number;
  updatedAt: number;
  steps: EditStep[];
}

export interface MaterialPreset {
  id: string;
  name: string;
  category: 'Hardwood' | 'Softwood' | 'Plywood' | 'Slate/Stone' | 'Acrylic' | 'Leather' | 'Anodized Metal' | 'Glass';
  description: string;
  recommendedDpi: number;
  recommendedDither: DitherConfig['algorithm'];
  recipe: EditRecipe;
}
