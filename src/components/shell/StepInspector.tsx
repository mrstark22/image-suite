import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useUIStore, currentStep } from '../../store/uiStore';
import { FLOWS, STEPS, nextStep, previousStep, type StepId } from '../../lib/workflows';
import { AdjustmentsPanel } from '../panels/AdjustmentsPanel';
import { DitheringPanel } from '../panels/DitheringPanel';
import { VectorizationPanel } from '../panels/VectorizationPanel';
import { DepthMapPanel } from '../panels/DepthMapPanel';
import { AIPanel } from '../panels/AIPanel';
import { ExportPanel } from '../panels/ExportPanel';
import { CropStepPanel, ImageStepPanel, SizeStepPanel } from '../panels/PrepSteps';
import styles from './Shell.module.css';

/** The panel of each step. A step with no panel would not compile. */
const STEP_PANELS: Record<StepId, React.FC> = {
  image: ImageStepPanel,
  crop: CropStepPanel,
  background: AIPanel,
  size: SizeStepPanel,
  adjust: AdjustmentsPanel,
  dither: DitheringPanel,
  trace: VectorizationPanel,
  relief: DepthMapPanel,
  export: ExportPanel,
};

/** The current step: its title, its panel, and the way back and on (#53). */
export const StepInspector: React.FC = () => {
  const job = useUIStore((s) => s.job);
  const step = useUIStore(currentStep);
  const goToNextStep = useUIStore((s) => s.goToNextStep);
  const goToPreviousStep = useUIStore((s) => s.goToPreviousStep);

  const flow = FLOWS[job];
  const next = nextStep(job, step);
  const prev = previousStep(job, step);
  const Panel = STEP_PANELS[step];

  return (
    <aside className={styles.inspector} aria-label={`${STEPS[step].label} step`}>
      <header className={styles.inspectorHeader}>
        <div className={styles.inspectorCount}>
          Step {flow.indexOf(step) + 1} of {flow.length}
        </div>
        <h2 className={styles.inspectorTitle}>{STEPS[step].label}</h2>
        <p className={styles.inspectorHint}>{STEPS[step].hint}</p>
      </header>
      <div className={styles.inspectorBody}>
        <Panel />
      </div>
      <footer className={styles.inspectorFooter}>
        <button className={styles.navBtn} disabled={!prev} onClick={goToPreviousStep}>
          <ChevronLeft size={14} /> {prev ? STEPS[prev].label : 'Back'}
        </button>
        {next && (
          <button className={styles.navBtn} onClick={goToNextStep}>
            Next: {STEPS[next].label} <ChevronRight size={14} />
          </button>
        )}
      </footer>
    </aside>
  );
};
