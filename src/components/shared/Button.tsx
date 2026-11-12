import React from 'react';
import styles from './Button.module.css';

/**
 * What a button is for. `primary` is the step's main action and the only
 * button drawn in the accent; `secondary` is any other action; `link` is a
 * small text action in a header or next to a readout.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'link';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Drawn before the label; hidden from screen readers, which read the label. */
  icon?: React.ReactNode;
  /** Sized to its label instead of the panel's width, as in a dialog's footer. */
  compact?: boolean;
}

/**
 * A button in one of the three styles. It is a native button, so it is
 * focusable and operable with Enter and Space, and its type defaults to
 * "button" so it never submits a form by accident.
 */
export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  icon,
  compact = false,
  className,
  type = 'button',
  children,
  ...rest
}) => (
  <button type={type} className={`${styles.button} ${styles[variant]} ${compact ? styles.compact : ''} ${className ?? ''}`} {...rest}>
    {icon && (
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
    )}
    {children}
  </button>
);
