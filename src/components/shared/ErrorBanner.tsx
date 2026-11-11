import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useRenderStore } from '../../store/renderStore';
import styles from './ErrorBanner.module.css';

/**
 * Shows the current error message from the image store, with a dismiss button.
 * Renders nothing when there is no error.
 */
export const ErrorBanner: React.FC = () => {
  const errorMessage = useRenderStore((s) => s.errorMessage);
  const setErrorMessage = useRenderStore((s) => s.setErrorMessage);

  if (!errorMessage) return null;

  return (
    <div className={styles.banner} role="alert">
      <AlertTriangle size={16} className={styles.icon} aria-hidden="true" />
      <span className={styles.message}>{errorMessage}</span>
      <button className={styles.dismiss} onClick={() => setErrorMessage(null)} aria-label="Dismiss error">
        <X size={14} />
      </button>
    </div>
  );
};
