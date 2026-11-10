import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useImageStore } from '../../store/imageStore';
import styles from './ErrorBanner.module.css';

/**
 * Shows the current error message from the image store, with a dismiss button.
 * Renders nothing when there is no error.
 */
export const ErrorBanner: React.FC = () => {
  const errorMessage = useImageStore((s) => s.errorMessage);
  const setErrorMessage = useImageStore((s) => s.setErrorMessage);

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
