import React from 'react';
import { useUIStore, currentStep } from '../../store/uiStore';
import { useDocumentStore } from '../../store/documentStore';
import { FLOWS, JOB_HINT, JOB_LABEL, STEPS } from '../../lib/workflows';
import styles from './Shell.module.css';

/**
 * The current job's steps, in order (#53). Any step can be visited; until an
 * image is open the steps after Image are dimmed, and say so in the inspector.
 */
export const StepRail: React.FC = () => {
  const job = useUIStore((s) => s.job);
  const step = useUIStore(currentStep);
  const goToStep = useUIStore((s) => s.goToStep);
  const hasDoc = useDocumentStore((s) => s.doc !== null);

  return (
    <nav className={styles.rail} aria-label={`${JOB_LABEL[job]} steps`}>
      <div className={styles.railJob}>{JOB_LABEL[job]}</div>
      <div className={styles.railHint}>{JOB_HINT[job]}</div>
      <ol className={styles.railSteps}>
        {FLOWS[job].map((id, i) => (
          <li key={id}>
            <button
              className={`${styles.railStep} ${id === step ? styles.railStepActive : ''} ${
                id !== 'image' && !hasDoc ? styles.railStepWaiting : ''
              }`}
              aria-current={id === step ? 'step' : undefined}
              title={id !== 'image' && !hasDoc ? 'Open an image first' : STEPS[id].hint}
              onClick={() => goToStep(id)}
            >
              <span className={styles.railNumber}>{i + 1}</span>
              <span>{STEPS[id].label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
};
