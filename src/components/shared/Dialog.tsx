import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import styles from './Dialog.module.css';

/** Elements that can take focus with Tab. */
const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** The elements inside `root` that Tab moves between, in order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** Drawn before the title. */
  icon?: React.ReactNode;
  /** `md` is 480px wide, `lg` 560px; both shrink to fit a narrow screen. */
  size?: 'md' | 'lg';
  /** The buttons at the bottom. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * A modal dialog. While it is open, focus starts on its first control and
 * Tab and Shift+Tab stay inside it; Escape, the close button and a click on
 * the backdrop close it; and focus returns to what had it before.
 */
export const Dialog: React.FC<DialogProps> = ({ open, onClose, title, icon, size = 'md', footer, children }) => {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = panel.current;
    if (root) (focusableIn(root)[0] ?? root).focus();
    return () => before?.focus();
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Handled here, so the app's own Escape shortcut does not run as well.
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = focusableIn(panel.current);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panel.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !panel.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={panel}
        className={`${styles.dialog} ${styles[size]}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {icon && (
              <span className={styles.icon} aria-hidden="true">
                {icon}
              </span>
            )}
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
};
