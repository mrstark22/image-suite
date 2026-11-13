import { create } from 'zustand';
import { FLOWS, nextStep, previousStep, type Job, type StepId } from '../lib/workflows';

interface UIState {
  /** The job being done: its flow of steps is shown, and the canvas shows its output (#53). */
  job: Job;
  /** The current step of each job, so switching jobs and back returns to where the user was. */
  stepByJob: Record<Job, StepId>;

  isSplitView: boolean;
  isInvertedView: boolean;
  showRulers: boolean;
  showVectorOverlay: boolean;
  theme: 'dark' | 'light';
  /** Tablet layout: the step panel is folded to a strip, giving the canvas the width (#54). */
  isPanelCollapsed: boolean;
  /**
   * Phone layout: the bottom sheet holding the step's controls is open (#54).
   * It opens on every change of step or job, so entering a step always shows
   * its controls; the user can fold it away afterwards.
   */
  isSheetOpen: boolean;

  // Modal Dialogs
  isSizeDialogOpen: boolean;
  isShortcutsDialogOpen: boolean;
  /**
   * A file that was too large to open at its own size, with why and its
   * size: the reduced-open dialog is shown while this is set (#69).
   */
  reducedOpenOffer: { file: File; message: string; widthPx: number; heightPx: number } | null;

  // Actions
  setJob: (job: Job) => void;
  /** Goes to `step` of the current job. A step that is not in its flow is ignored. */
  goToStep: (step: StepId) => void;
  goToNextStep: () => void;
  goToPreviousStep: () => void;
  toggleSplitView: () => void;
  toggleInvertedView: () => void;
  toggleRulers: () => void;
  toggleVectorOverlay: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  setPanelCollapsed: (collapsed: boolean) => void;
  setSheetOpen: (open: boolean) => void;

  setSizeDialogOpen: (open: boolean) => void;
  setShortcutsDialogOpen: (open: boolean) => void;
  setReducedOpenOffer: (offer: UIState['reducedOpenOffer']) => void;
}

/** Sets the theme on the page; there is no page when the store runs in tests. */
function applyTheme(theme: 'dark' | 'light'): void {
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', theme);
}

/** Every job at its first step. */
export function firstSteps(): Record<Job, StepId> {
  return { vector: FLOWS.vector[0], photo: FLOWS.photo[0], relief: FLOWS.relief[0] };
}

/** The current step of the current job. */
export function currentStep(state: Pick<UIState, 'job' | 'stepByJob'>): StepId {
  return state.stepByJob[state.job];
}

export const useUIStore = create<UIState>((set, get) => ({
  job: 'photo',
  stepByJob: firstSteps(),
  isSplitView: false,
  isInvertedView: false,
  showRulers: true,
  showVectorOverlay: true,
  theme: 'dark',
  isPanelCollapsed: false,
  isSheetOpen: true,

  isSizeDialogOpen: false,
  isShortcutsDialogOpen: false,
  reducedOpenOffer: null,

  setJob: (job) => set({ job, isSheetOpen: true, isPanelCollapsed: false }),
  goToStep: (step) => {
    const { job, stepByJob } = get();
    if (!FLOWS[job].includes(step)) return;
    set({ stepByJob: { ...stepByJob, [job]: step }, isSheetOpen: true, isPanelCollapsed: false });
  },
  goToNextStep: () => {
    const next = nextStep(get().job, currentStep(get()));
    if (next) get().goToStep(next);
  },
  goToPreviousStep: () => {
    const prev = previousStep(get().job, currentStep(get()));
    if (prev) get().goToStep(prev);
  },
  toggleSplitView: () => set((state) => ({ isSplitView: !state.isSplitView })),
  toggleInvertedView: () => set((state) => ({ isInvertedView: !state.isInvertedView })),
  toggleRulers: () => set((state) => ({ showRulers: !state.showRulers })),
  toggleVectorOverlay: () => set((state) => ({ showVectorOverlay: !state.showVectorOverlay })),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  setPanelCollapsed: (isPanelCollapsed) => set({ isPanelCollapsed }),
  setSheetOpen: (isSheetOpen) => set({ isSheetOpen }),

  setSizeDialogOpen: (isSizeDialogOpen) => set({ isSizeDialogOpen }),
  setShortcutsDialogOpen: (isShortcutsDialogOpen) => set({ isShortcutsDialogOpen }),
  setReducedOpenOffer: (reducedOpenOffer) => set({ reducedOpenOffer }),
}));
