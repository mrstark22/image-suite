import React, { useId } from 'react';
import styles from './Section.module.css';

interface SectionProps {
  title: React.ReactNode;
  /** Drawn before the title. */
  icon?: React.ReactNode;
  /** Small actions on the right of the title, such as a reset link. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * A titled block of a panel. The title is a heading and names the section,
 * so screen readers can list and jump between a panel's sections.
 */
export const Section: React.FC<SectionProps> = ({ title, icon, actions, children }) => {
  const id = useId();
  return (
    <section className={styles.section} aria-labelledby={id}>
      <div className={styles.header}>
        <h3 id={id} className={styles.title}>
          {icon && (
            <span className={styles.icon} aria-hidden="true">
              {icon}
            </span>
          )}
          {title}
        </h3>
        {actions}
      </div>
      {children}
    </section>
  );
};
