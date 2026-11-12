import React, { useId } from 'react';
import styles from './Toggle.module.css';

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** A line under the label, read by screen readers as the checkbox's description. */
  note?: string;
}

/**
 * An on/off setting: a native checkbox inside its label, so clicking the
 * label toggles it, Space toggles it from the keyboard, and screen readers
 * read the label with it.
 */
export const Toggle: React.FC<ToggleProps> = ({ label, checked, onChange, disabled = false, note }) => {
  const noteId = useId();
  return (
    <div className={`${styles.field} ${disabled ? styles.disabled : ''}`}>
      <label className={styles.row}>
        <span className={styles.label}>{label}</span>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={checked}
          disabled={disabled}
          aria-describedby={note ? noteId : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
      </label>
      {/* Outside the label, so it describes the checkbox without becoming part of its name. */}
      {note && (
        <div id={noteId} className={styles.note}>
          {note}
        </div>
      )}
    </div>
  );
};
