import React, { useId, useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import styles from './BottomSheet.module.css';

/** How far, in CSS pixels, the handle must be dragged to open or close the sheet. */
export const SHEET_DRAG_THRESHOLD = 40;

/**
 * Whether the sheet is open after its handle is dragged by `dy` pixels
 * (negative is up). A short drag leaves it as it was, so a tap is not
 * mistaken for a drag.
 */
export function sheetOpenAfterDrag(wasOpen: boolean, dy: number): boolean {
  if (dy <= -SHEET_DRAG_THRESHOLD) return true;
  if (dy >= SHEET_DRAG_THRESHOLD) return false;
  return wasOpen;
}

interface BottomSheetProps {
  /** Shown on the handle, and names the sheet for screen readers. */
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Open, take only the height of the content (up to the usual share of the
   * screen) instead of the fixed share: for short content such as the empty
   * state before an image is open.
   */
  fit?: boolean;
  children: React.ReactNode;
}

/**
 * A panel docked to the bottom of the screen, for controls on a phone
 * (#54). Open, it takes a fixed share of the screen (the canvas keeps the
 * rest); closed, it is a bar in the inverted selection colour that says
 * "Show", so it reads as a button and not as a divider. Its handle is a button: a tap, Enter or Space opens or closes the
 * sheet, and dragging the handle up or down by more than
 * SHEET_DRAG_THRESHOLD does the same. Escape inside the sheet closes it.
 * Pointer events serve mouse, pen and touch alike.
 */
export const BottomSheet: React.FC<BottomSheetProps> = ({ title, open, onOpenChange, fit = false, children }) => {
  const contentId = useId();
  const drag = useRef<{ pointerId: number; startY: number; moved: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    drag.current = { pointerId: e.pointerId, startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dy = e.clientY - d.startY;
    if (Math.abs(dy) >= SHEET_DRAG_THRESHOLD) {
      d.moved = true;
      onOpenChange(sheetOpenAfterDrag(open, dy));
    }
  };

  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // The click that ends a drag has already been handled as the drag. A
    // click from Enter or Space (detail 0) never is: a drag released off the
    // handle produces no click, and must not swallow the next key press.
    const d = drag.current;
    drag.current = null;
    if (d?.moved && e.detail !== 0) return;
    onOpenChange(!open);
  };

  return (
    <section
      className={`${styles.sheet} ${open ? (fit ? styles.openFit : styles.open) : ''}`}
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          onOpenChange(false);
        }
      }}
    >
      <button
        type="button"
        className={styles.handle}
        aria-expanded={open}
        aria-controls={contentId}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onClick={onClick}
      >
        <span className={styles.grip} aria-hidden="true" />
        <span className={styles.row}>
          <span className={styles.title}>{title}</span>
          <span className={styles.toggle} aria-hidden="true">
            {open ? 'Hide' : 'Show'}
            {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </span>
        </span>
      </button>
      <div id={contentId} className={styles.content} hidden={!open}>
        {children}
      </div>
    </section>
  );
};
