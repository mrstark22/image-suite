import React, { useId } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import styles from './Section.module.css';

interface SectionProps {
  title: React.ReactNode;
  /** Drawn before the title. */
  icon?: React.ReactNode;
  /** Small actions on the right of the title, such as a reset link. */
  actions?: React.ReactNode;
  /**
   * Makes the section collapsible: the title becomes a button that shows or
   * hides the content, and says whether it is shown.
   */
  collapse?: { open: boolean; onToggle: () => void };
  children: React.ReactNode;
}

/**
 * A titled block of a panel. The title is a heading and names the section,
 * so screen readers can list and jump between a panel's sections.
 */
export const Section: React.FC<SectionProps> = ({ title, icon, actions, collapse, children }) => {
  const id = useId();
  const contentId = useId();
  const open = collapse ? collapse.open : true;
  const heading = (
    <>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      {title}
    </>
  );
  return (
    <section className={`${styles.section} ${open ? '' : styles.collapsed}`} aria-labelledby={id}>
      <div className={styles.header}>
        <h3 id={id} className={`${styles.title} ${collapse ? styles.grow : ''}`}>
          {collapse ? (
            <button
              type="button"
              className={styles.toggle}
              aria-expanded={open}
              aria-controls={contentId}
              onClick={collapse.onToggle}
            >
              <span className={styles.chevron} aria-hidden="true">
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
              {heading}
            </button>
          ) : (
            heading
          )}
        </h3>
        {actions}
      </div>
      <div id={contentId} hidden={!open}>
        {open && children}
      </div>
    </section>
  );
};
