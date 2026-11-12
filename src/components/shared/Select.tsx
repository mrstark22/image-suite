import React, { useId } from 'react';
import styles from './Select.module.css';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  /** Names the select for screen readers; shown above it unless `labelHidden`. */
  label: string;
  /** Hides the label visually, for a select whose section title already says what it is. */
  labelHidden?: boolean;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * A labelled native select. The value passed to `onChange` is always one of
 * `options`, so callers need no cast.
 */
export function Select<T extends string>({
  label,
  labelHidden = false,
  value,
  options,
  onChange,
  disabled = false,
  className,
}: SelectProps<T>): React.ReactElement {
  const id = useId();
  return (
    <div className={`${styles.field} ${className ?? ''}`}>
      <label htmlFor={id} className={labelHidden ? styles.visuallyHidden : styles.label}>
        {label}
      </label>
      <select
        id={id}
        className={styles.select}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const chosen = options.find((o) => o.value === e.target.value);
          if (chosen) onChange(chosen.value);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
