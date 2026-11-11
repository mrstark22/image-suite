/**
 * The logic behind the slider and the size dialog (review findings 3, 4 and 7
 * on #68): typed values commit once, Escape abandons, a drag is one gesture,
 * and an invalid typed size cannot be applied.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DraftField, SliderGesture, isValueKey } from '../../src/lib/slider-input';
import {
  INITIAL_GRID_FORM,
  committedGridValues,
  fieldText,
  gridFormReducer,
  type GridField,
  type GridForm,
} from '../../src/lib/test-grid-form';
import { canApplySize, sizeDraftReducer, type SizeDraft } from '../../src/lib/size-draft';
import { useDocumentStore, setGestureEndTarget } from '../../src/store/documentStore';
import { setTonal } from '../../src/lib/document';
import { currentDoc, decodedImage, resetStores } from '../helpers/documents';

const store = () => useDocumentStore.getState();

describe('DraftField (a slider number field)', () => {
  /** Simulates the field: Enter commits then blurs; Escape abandons then blurs; blur commits. */
  function field() {
    const draft = new DraftField();
    const committed: string[] = [];
    const commit = () => {
      const text = draft.take();
      if (text !== null) committed.push(text);
    };
    return {
      committed,
      type: (t: string) => draft.type(t),
      enter: () => {
        commit();
        commit(); // the blur that follows
      },
      escape: () => {
        draft.abandon();
        commit(); // the blur that follows
      },
      blur: commit,
    };
  }

  it('Escape abandons the typed value, even though a blur follows it', () => {
    const f = field();
    f.type('50');
    f.escape();
    expect(f.committed).toEqual([]);
  });

  it('Enter commits once, not again on the blur it causes', () => {
    const f = field();
    f.type('5');
    f.type('50');
    f.enter();
    expect(f.committed).toEqual(['50']);
  });

  it('a blur commits what was typed, and a second blur commits nothing', () => {
    const f = field();
    f.type('12');
    f.blur();
    f.blur();
    expect(f.committed).toEqual(['12']);
  });
});

describe('SliderGesture (a document slider)', () => {
  let windowStandIn: EventTarget;
  beforeEach(() => {
    resetStores();
    windowStandIn = new EventTarget();
    setGestureEndTarget(windowStandIn);
    store().open(decodedImage(10, 10));
  });
  afterEach(() => setGestureEndTarget(null));

  it('a drag is one undo entry; a key press is one more', () => {
    const slider = new SliderGesture(store);
    slider.startDrag();
    for (let v = 1; v <= 10; v++) slider.change(setTonal({ brightness: v }));
    slider.endDrag();
    expect(store().past.length).toBe(1);

    slider.keyboardAdjust();
    slider.change(setTonal({ brightness: 11 }));
    expect(store().past.length).toBe(2);
  });

  it('after Ctrl+Z cancels a drag, the rest of that drag is ignored', () => {
    const slider = new SliderGesture(store);
    slider.startDrag();
    slider.change(setTonal({ brightness: 30 }));
    store().undo();
    slider.change(setTonal({ brightness: 40 }));
    slider.change(setTonal({ brightness: 50 }));
    slider.endDrag();
    expect(currentDoc().steps.tonal.brightness).toBe(0);
    expect(store().past.length).toBe(0);
  });

  it('when the store ends the drag (window blur) and no pointerup arrives, arrow keys still edit (review finding 7)', () => {
    const slider = new SliderGesture(store);
    slider.startDrag();
    slider.change(setTonal({ brightness: 30 }));
    windowStandIn.dispatchEvent(new Event('blur'));
    expect(store().gesture).toBeNull();

    // An arrow key on the still-focused slider: the key handler runs before the change.
    expect(isValueKey('ArrowRight')).toBe(true);
    slider.keyboardAdjust();
    slider.change(setTonal({ brightness: 31 }));
    expect(currentDoc().steps.tonal.brightness).toBe(31);
    expect(store().past.length).toBe(2);
  });

  it('Ctrl+Z is not a value key, so it does not end the drag', () => {
    expect(isValueKey('z')).toBe(false);
    expect(isValueKey('Control')).toBe(false);
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) {
      expect(isValueKey(key)).toBe(true);
    }
  });
});

describe('size dialog state (review finding 3)', () => {
  const type = (state: SizeDraft, text: string): SizeDraft =>
    sizeDraftReducer(state, { type: 'type', field: 'width', text, lengthPx: 6000, unit: 'mm' });

  it('a valid width sets the scale; clearing the field or typing 0, a negative or text disables Apply', () => {
    let state = sizeDraftReducer({ pending: null, editing: null }, { type: 'open', scale: null });
    state = type(state, '300');
    expect(state.pending).toBeCloseTo(0.05, 12);
    expect(canApplySize(state, null)).toBe(true);

    for (const text of ['', ' ', '0', '-5', 'abc', '1e999']) {
      const invalid = type(state, text);
      expect(invalid.pending).toBeNull();
      expect(canApplySize(invalid, null)).toBe(false);
      expect(invalid.editing?.text).toBe(text);
    }
  });

  it('clearing the field of a document whose size is set does not reapply anything', () => {
    let state = sizeDraftReducer({ pending: null, editing: null }, { type: 'open', scale: 0.1 });
    expect(canApplySize(state, 0.1)).toBe(false);
    state = type(state, '');
    expect(canApplySize(state, 0.1)).toBe(false);
  });

  it('accepting the file DPI suggestion sets the scale and stops editing', () => {
    const state = sizeDraftReducer(type({ pending: null, editing: null }, ''), { type: 'suggest', scale: 25.4 / 72 });
    expect(state.pending).toBeCloseTo(25.4 / 72, 12);
    expect(state.editing).toBeNull();
  });
});

describe('material test grid fields (re-review finding A)', () => {
  /** Types `text` one character at a time, as a keyboard does, after selecting all. */
  function typeInto(form: GridForm, field: GridField, text: string): GridForm {
    let state = form;
    for (let i = 1; i <= text.length; i++) {
      state = gridFormReducer(state, { type: 'type', field, text: text.slice(0, i) });
    }
    return state;
  }

  it('typing 150 into Grid Resolution one character at a time ends at 150, not 1200', () => {
    let form = typeInto(INITIAL_GRID_FORM, 'dpi', '150');
    expect(fieldText(form, 'dpi')).toBe('150');
    form = gridFormReducer(form, { type: 'commit', field: 'dpi' });
    expect(form.values.dpi).toBe(150);
    expect(typeInto(INITIAL_GRID_FORM, 'dpi', '600').drafts.dpi).toBe('600');
  });

  it('clamps only when committed: below and above the range, and whole numbers for counts', () => {
    const commit = (field: GridField, text: string) =>
      gridFormReducer(typeInto(INITIAL_GRID_FORM, field, text), { type: 'commit', field }).values[field];
    expect(commit('dpi', '20')).toBe(50);
    expect(commit('dpi', '5000')).toBe(1200);
    expect(commit('rows', '0')).toBe(1);
    expect(commit('rows', '99')).toBe(15);
    expect(commit('cols', '3.6')).toBe(4);
    expect(commit('boxSizeMm', '7.5')).toBe(7.5);
    expect(commit('gapMm', '0')).toBe(0);
  });

  it('an empty or non-numeric field keeps its previous value when committed', () => {
    const typed = typeInto(INITIAL_GRID_FORM, 'dpi', '450');
    const set = gridFormReducer(typed, { type: 'commit', field: 'dpi' });
    const cleared = gridFormReducer(gridFormReducer(set, { type: 'type', field: 'dpi', text: '' }), {
      type: 'commit',
      field: 'dpi',
    });
    expect(cleared.values.dpi).toBe(450);
    expect(fieldText(cleared, 'dpi')).toBe('450');
  });

  it('Generate uses text typed but not yet blurred', () => {
    const form = typeInto(typeInto(INITIAL_GRID_FORM, 'dpi', '150'), 'rows', '8');
    expect(committedGridValues(form)).toMatchObject({ dpi: 150, rows: 8, cols: 5 });
  });

  it('closing the dialog drops half-typed text', () => {
    const form = gridFormReducer(typeInto(INITIAL_GRID_FORM, 'dpi', '15'), { type: 'discardDrafts' });
    expect(fieldText(form, 'dpi')).toBe(String(INITIAL_GRID_FORM.values.dpi));
  });
});
