import React from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import styles from './Progress.module.css';

interface ProgressProps {
  /** What is running, for example "Encoding". */
  label: string;
  /** Done so far, 0 to 1, or null when the work cannot report how far it is. */
  fraction: number | null;
  /** Shows a Cancel button that calls this. */
  onCancel?: () => void;
  /** A line under the bar, for example what is paused meanwhile. */
  note?: React.ReactNode;
  className?: string;
}

/**
 * Progress of a long operation, with a Cancel button when it can be
 * cancelled. The bar is a progressbar for screen readers, with its
 * percentage when known.
 */
export const Progress: React.FC<ProgressProps> = ({ label, fraction, onCancel, note, className }) => {
  const percent = fraction === null ? null : Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <div className={`${styles.box} ${className ?? ''}`}>
      <div className={styles.row}>
        <span>
          {label}
          {percent === null ? '…' : ` ${percent}%`}
        </span>
        {onCancel && (
          <Button variant="link" icon={<X size={12} />} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        {percent === null ? (
          <div className={styles.indeterminate} />
        ) : (
          // The width is the run-time value; everything else is in the stylesheet.
          <div className={styles.fill} style={{ width: `${percent}%` }} />
        )}
      </div>
      {note && <div className={styles.note}>{note}</div>}
    </div>
  );
};
