import React, { useEffect, useRef, useState } from 'react';
import type { DocumentUpdate } from '../../types/document';
import { useDocumentStore } from '../../store/documentStore';
import { DraftField, SliderGesture, isValueKey } from '../../lib/slider-input';
import styles from './Slider.module.css';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Called with each new value: every step of a drag, or once when a typed value is committed. */
  onChange: (value: number) => void;
  /** Double-clicking the label calls this. */
  onReset?: () => void;
  /** A pointer drag on the track starts. */
  onDragStart?: () => void;
  /** A pointer drag on the track ends. */
  onDragEnd?: () => void;
  /** A key press on the track is about to change the value. */
  onKeyboardAdjust?: () => void;
  disabled?: boolean;
  /** Shown under the slider, for example why it is disabled. */
  note?: string;
}

function formatted(value: number, step: number): string {
  return step < 1 ? value.toFixed(2) : String(Math.round(value));
}

/**
 * A labelled range slider with a number field. The number field keeps what
 * is typed and commits it once, on Enter or when it loses focus; Escape
 * abandons it.
 */
export const Slider: React.FC<SliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  onReset,
  onDragStart,
  onDragEnd,
  onKeyboardAdjust,
  disabled = false,
  note,
}) => {
  // Shown while typing; the DraftField decides what is committed.
  const [draft, setDraft] = useState<string | null>(null);
  const field = useRef(new DraftField()).current;

  /** Commits the typed value once. Blur after Enter or Escape finds nothing to commit. */
  const commitDraft = () => {
    const text = field.take();
    setDraft(null);
    if (text === null) return;
    const v = parseFloat(text);
    if (!Number.isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitDraft();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      field.abandon();
      setDraft(null);
      e.currentTarget.blur();
    }
  };

  // Fill of the track up to the thumb; computed per value.
  const percentage = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  return (
    <div className={`${styles.container} ${disabled ? styles.disabled : ''}`}>
      <div className={styles.header}>
        <span
          className={`${styles.label} ${onReset && !disabled ? styles.resettable : ''}`}
          onDoubleClick={disabled ? undefined : onReset}
          title={onReset && !disabled ? 'Double-click to reset' : undefined}
        >
          {label}
        </span>
        <div className={styles.valueContainer}>
          <input
            type="number"
            className={styles.valueInput}
            value={draft ?? formatted(value, step)}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            aria-label={`${label} value`}
            onChange={(e) => {
              field.type(e.target.value);
              setDraft(e.target.value);
            }}
            onBlur={commitDraft}
            onKeyDown={handleKeyDown}
          />
          {unit && <span className={styles.unit}>{unit}</span>}
        </div>
      </div>
      <div className={styles.sliderRow}>
        <input
          type="range"
          className={styles.inputRange}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={label}
          onPointerDown={onDragStart}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onKeyDown={(e) => {
            if (isValueKey(e.key)) onKeyboardAdjust?.();
          }}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{
            background: `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${percentage}%, var(--bg-surface-active) ${percentage}%, var(--bg-surface-active) 100%)`,
          }}
        />
      </div>
      {note && <div className={styles.note}>{note}</div>}
    </div>
  );
};

interface DocumentSliderProps
  extends Omit<SliderProps, 'onChange' | 'onReset' | 'onDragStart' | 'onDragEnd' | 'onKeyboardAdjust'> {
  /** The change to the document for a value. */
  update: (value: number) => DocumentUpdate;
  /** The change double-clicking the label makes. */
  reset?: DocumentUpdate;
}

/**
 * A slider bound to the document. Dragging the track is one gesture, so the
 * whole drag is one undo entry; a key press on the track, a typed value and a
 * reset are each one edit.
 */
export const DocumentSlider: React.FC<DocumentSliderProps> = ({ update, reset, ...props }) => {
  const gesture = useRef(new SliderGesture(() => useDocumentStore.getState())).current;

  // A gesture must not outlive the control that started it.
  useEffect(() => () => gesture.endDrag(), [gesture]);

  const startDrag = () => {
    gesture.startDrag();
    // The pointer can be released outside the track, where onPointerUp does
    // not fire, or outside the window, where no pointerup arrives at all; the
    // store ends the gesture itself on window blur, and so does this, so a key
    // press or typed value afterwards is an edit, not a change to a dead gesture.
    const forget = () => {
      window.removeEventListener('pointerup', forget);
      window.removeEventListener('pointercancel', forget);
      window.removeEventListener('blur', forget);
      gesture.endDrag();
    };
    window.addEventListener('pointerup', forget);
    window.addEventListener('pointercancel', forget);
    window.addEventListener('blur', forget);
  };

  return (
    <Slider
      {...props}
      onChange={(value) => gesture.change(update(value))}
      onReset={reset ? () => useDocumentStore.getState().edit(reset) : undefined}
      onDragStart={startDrag}
      onDragEnd={() => gesture.endDrag()}
      onKeyboardAdjust={() => gesture.keyboardAdjust()}
    />
  );
};
