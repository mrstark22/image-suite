import { DEFAULT_TEST_GRID_DPI } from './test-grid-document';

/** The number fields of the material test grid dialog. */
export type GridField = 'rows' | 'cols' | 'boxSizeMm' | 'gapMm' | 'dpi';

interface FieldLimits {
  min: number;
  max: number;
  integer: boolean;
}

/** The range each field is clamped to when committed. */
export const GRID_FIELD_LIMITS: Record<GridField, FieldLimits> = {
  rows: { min: 1, max: 15, integer: true },
  cols: { min: 1, max: 15, integer: true },
  boxSizeMm: { min: 2, max: 50, integer: false },
  gapMm: { min: 0, max: 20, integer: false },
  dpi: { min: 50, max: 1200, integer: true },
};

/**
 * The dialog's numbers, plus the text typed into any field and not yet
 * committed. The text is kept as typed, so typing 150 into a field clamped
 * to 50..1200 passes through "1" and "15" without being replaced by 50.
 */
export interface GridForm {
  values: Record<GridField, number>;
  drafts: Partial<Record<GridField, string>>;
}

export const INITIAL_GRID_FORM: GridForm = {
  values: { rows: 5, cols: 5, boxSizeMm: 10, gapMm: 2, dpi: DEFAULT_TEST_GRID_DPI },
  drafts: {},
};

export type GridFormAction =
  | { type: 'type'; field: GridField; text: string }
  | { type: 'commit'; field: GridField }
  | { type: 'discardDrafts' };

/**
 * The value `text` commits to: a number clamped to the field's range (and
 * rounded for whole-number fields). Empty or non-numeric text keeps `current`.
 */
export function commitFieldText(field: GridField, text: string, current: number): number {
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value)) return current;
  const { min, max, integer } = GRID_FIELD_LIMITS[field];
  const clamped = Math.min(max, Math.max(min, value));
  return integer ? Math.round(clamped) : clamped;
}

/** Updates the dialog's state. Typing only records text; committing (blur, Enter) clamps it. */
export function gridFormReducer(state: GridForm, action: GridFormAction): GridForm {
  switch (action.type) {
    case 'type':
      return { ...state, drafts: { ...state.drafts, [action.field]: action.text } };
    case 'commit': {
      const text = state.drafts[action.field];
      if (text === undefined) return state;
      const { [action.field]: _committed, ...drafts } = state.drafts;
      return {
        values: { ...state.values, [action.field]: commitFieldText(action.field, text, state.values[action.field]) },
        drafts,
      };
    }
    case 'discardDrafts':
      return { ...state, drafts: {} };
  }
}

/** The values Generate uses: every field's typed text committed, so text not yet blurred counts. */
export function committedGridValues(state: GridForm): Record<GridField, number> {
  let committed = state;
  for (const field of Object.keys(state.drafts) as GridField[]) {
    committed = gridFormReducer(committed, { type: 'commit', field });
  }
  return committed.values;
}

/** What a field shows: its typed text while being edited, otherwise its value. */
export function fieldText(state: GridForm, field: GridField): string {
  return state.drafts[field] ?? String(state.values[field]);
}
