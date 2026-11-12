import React from 'react';
import styles from './Toggle.module.css';

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * An on/off setting: a native checkbox inside its label, so clicking the
 * label toggles it, Space toggles it from the keyboard, and screen readers
 * read the label with it.
 */
export const Toggle: React.FC<ToggleProps> = ({ label, checked, onChange, disabled = false }) => (
  <label className={`${styles.row} ${disabled ? styles.disabled : ''}`}>
    <span className={styles.label}>{label}</span>
    <input
      type="checkbox"
      className={styles.checkbox}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  </label>
);
