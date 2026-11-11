import { mmPerPxForLength, type PhysicalUnit } from './document-size';

/** Which length field of the size dialog. */
export type SizeField = 'width' | 'height';

/**
 * The size dialog's state: the scale it would apply, and the text of the
 * field being typed in (kept as typed, so it can be empty or partial).
 */
export interface SizeDraft {
  /** Millimetres per source pixel to apply, or null when nothing valid is entered. */
  pending: number | null;
  editing: { field: SizeField; text: string } | null;
}

export type SizeDraftAction =
  | { type: 'open'; scale: number | null }
  | { type: 'type'; field: SizeField; text: string; lengthPx: number; unit: PhysicalUnit }
  | { type: 'suggest'; scale: number }
  | { type: 'stopEditing' };

/**
 * Updates the size dialog's state. Typing a positive number in a field sets
 * the scale from it; typing anything else (empty, zero, negative, not a
 * number) clears it, so the dialog never applies a size its field does not show.
 */
export function sizeDraftReducer(state: SizeDraft, action: SizeDraftAction): SizeDraft {
  switch (action.type) {
    case 'open':
      return { pending: action.scale, editing: null };
    case 'type': {
      const value = Number(action.text);
      const valid = action.text.trim() !== '' && Number.isFinite(value) && value > 0;
      return {
        pending: valid ? mmPerPxForLength(action.lengthPx, value, action.unit) : null,
        editing: { field: action.field, text: action.text },
      };
    }
    case 'suggest':
      return { pending: action.scale, editing: null };
    case 'stopEditing':
      return { ...state, editing: null };
  }
}

/** True when Apply would set a valid scale different from `current`. */
export function canApplySize(state: SizeDraft, current: number | null): boolean {
  return state.pending !== null && state.pending !== current;
}
