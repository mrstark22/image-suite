import React from 'react';
import { ChevronLeft, ChevronRight, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useUIStore, currentStep } from '../../store/uiStore';
import { FLOWS, STEPS, nextStep, previousStep, type StepId } from '../../lib/workflows';
import { AdjustmentsPanel } from '../panels/AdjustmentsPanel';
import { DitheringPanel } from '../panels/DitheringPanel';
import { VectorizationPanel } from '../panels/VectorizationPanel';
import { DepthMapPanel } from '../panels/DepthMapPanel';
import { AIPanel } from '../panels/AIPanel';
import { ExportPanel } from '../panels/ExportPanel';
import { CropStepPanel, ImageStepPanel, SizeStepPanel } from '../panels/PrepSteps';
import { BottomSheet } from '../shared/BottomSheet';
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

interface StepInspectorProps {
  /**
   * Tablet layout (#54): the panel has a button that folds it to a narrow
   * strip, and the strip's button unfolds it again.
   */
  collapsible?: boolean;
}

/** The current step: its title, its panel, and the way back and on (#53). */
export const StepInspector: React.FC<StepInspectorProps> = ({ collapsible = false }) => {
  const job = useUIStore((s) => s.job);
  const step = useUIStore(currentStep);
  const goToNextStep = useUIStore((s) => s.goToNextStep);
  const goToPreviousStep = useUIStore((s) => s.goToPreviousStep);
  const isPanelCollapsed = useUIStore((s) => s.isPanelCollapsed);
  const setPanelCollapsed = useUIStore((s) => s.setPanelCollapsed);

  const flow = FLOWS[job];
  const next = nextStep(job, step);
  const prev = previousStep(job, step);
  const Panel = STEP_PANELS[step];

  if (collapsible && isPanelCollapsed) {
    return (
      <aside className={styles.inspectorStrip} aria-label={`${STEPS[step].label} step`}>
        <button
          type="button"
          className={styles.stripBtn}
          aria-expanded={false}
          aria-label={`Show ${STEPS[step].label} controls`}
          title={`Show ${STEPS[step].label} controls`}
          onClick={() => setPanelCollapsed(false)}
        >
          <PanelRightOpen size={16} aria-hidden="true" />
        </button>
        <span className={styles.stripLabel} aria-hidden="true">
          {STEPS[step].label}
        </span>
      </aside>
    );
  }

  return (
    <aside className={styles.inspector} aria-label={`${STEPS[step].label} step`}>
      <header className={styles.inspectorHeader}>
        <div className={styles.inspectorHeaderRow}>
          <div className={styles.inspectorCount}>
            Step {flow.indexOf(step) + 1} of {flow.length}
          </div>
          {collapsible && (
            <button
              type="button"
              className={styles.collapseBtn}
              aria-expanded={true}
              aria-label="Hide controls"
              title="Hide controls"
              onClick={() => setPanelCollapsed(true)}
            >
              <PanelRightClose size={16} aria-hidden="true" />
            </button>
          )}
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

/**
 * The phone layout's controls (#54): the current step's panel in a bottom
 * sheet under the canvas. Back and Next are in the step bar above the canvas,
 * so the sheet holds only the step's hint and its panel.
 */
export const StepSheet: React.FC = () => {
  const step = useUIStore(currentStep);
  const open = useUIStore((s) => s.isSheetOpen);
  const setSheetOpen = useUIStore((s) => s.setSheetOpen);
  const Panel = STEP_PANELS[step];

  return (
    <BottomSheet title={`${STEPS[step].label} controls`} open={open} onOpenChange={setSheetOpen}>
      <p className={styles.sheetHint}>{STEPS[step].hint}</p>
      <div className={styles.sheetBody}>
        <Panel />
      </div>
    </BottomSheet>
  );
};
