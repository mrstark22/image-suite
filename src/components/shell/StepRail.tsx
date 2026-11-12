import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useUIStore, currentStep } from '../../store/uiStore';
import { useDocumentStore } from '../../store/documentStore';
import { FLOWS, JOB_HINT, JOB_LABEL, STEPS, nextStep, previousStep, type StepId } from '../../lib/workflows';
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
              <span className={styles.railLabel}>{STEPS[id].label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
};

/**
 * The phone layout's step navigation (#54): Back, the current step as a
 * select that can jump to any step of the job, and Next, in one compact bar.
 */
export const StepBar: React.FC = () => {
  const job = useUIStore((s) => s.job);
  const step = useUIStore(currentStep);
  const goToStep = useUIStore((s) => s.goToStep);
  const goToNextStep = useUIStore((s) => s.goToNextStep);
  const goToPreviousStep = useUIStore((s) => s.goToPreviousStep);
  const flow = FLOWS[job];
  const next = nextStep(job, step);
  const prev = previousStep(job, step);

  return (
    <nav className={styles.stepBar} aria-label={`${JOB_LABEL[job]} steps`}>
      <button
        type="button"
        className={styles.stepBarBtn}
        disabled={!prev}
        aria-label={prev ? `Back: ${STEPS[prev].label}` : 'Back'}
        onClick={goToPreviousStep}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <select
        className={styles.stepBarSelect}
        aria-label="Step"
        value={step}
        onChange={(e) => goToStep(e.target.value as StepId)}
      >
        {flow.map((id, i) => (
          <option key={id} value={id}>
            Step {i + 1} of {flow.length}: {STEPS[id].label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={styles.stepBarBtn}
        disabled={!next}
        aria-label={next ? `Next: ${STEPS[next].label}` : 'Next'}
        onClick={goToNextStep}
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </nav>
  );
};
