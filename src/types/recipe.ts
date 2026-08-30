import type {
  TonalAdjustments,
  ColorAdjustments,
  DetailEnhancements,
  GeometryTransform,
} from './image';
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
  params: GeometryTransform;
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
  params: DetailEnhancements;
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
