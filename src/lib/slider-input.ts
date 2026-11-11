import type { DocumentUpdate, GestureToken } from '../types/document';
import type { DocumentState } from '../store/documentStore';

/**
 * The text typed into a number field, held until it is committed or
 * abandoned. Taking it clears it, so a commit followed by the blur that
 * Enter or Escape causes cannot commit a second time.
 */
export class DraftField {
  private text: string | null = null;

  /** Records what is typed. */
  type(text: string): void {
    this.text = text;
  }

  /** Drops the typed text. */
  abandon(): void {
    this.text = null;
  }

  /** The typed text, once: later calls return null until something is typed again. */
  take(): string | null {
    const text = this.text;
    this.text = null;
    return text;
  }
}

/** Keys that change a range input's value. */
const VALUE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);

/** True when `key` changes a range input's value, so the change is not part of a drag. */
export function isValueKey(key: string): boolean {
  return VALUE_KEYS.has(key);
}

/**
 * Routes a document slider's changes: a pointer drag on the track is one
 * gesture; anything else (a key press, a typed value) is one edit.
 *
 * While a drag is in progress its changes go to its gesture even after the
 * store has ended or cancelled it (Ctrl+Z during a drag), so the rest of that
 * drag is ignored. The drag ends at pointerup, and also when a key changes
 * the value: a pointerup that never reached the page then cannot leave the
 * slider sending key presses to a gesture that is over.
 */
export class SliderGesture {
  private token: GestureToken | null = null;

  constructor(private readonly store: () => DocumentState) {}

  /** A pointer drag on the track starts. */
  startDrag(): void {
    this.endDrag();
    this.token = this.store().beginGesture();
  }

  /** The drag ends (pointerup, pointercancel, unmount). Safe to call when not dragging. */
  endDrag(): void {
    const token = this.token;
    this.token = null;
    if (token !== null) this.store().endGesture(token);
  }

  /** A key is about to change the value: that is an edit, not part of a drag. */
  keyboardAdjust(): void {
    this.endDrag();
  }

  /** The slider's value changed. */
  change(update: DocumentUpdate): void {
    if (this.token !== null) this.store().updateGesture(this.token, update);
    else this.store().edit(update);
  }
}
