import { create } from 'zustand';
import type { ModelProgress } from '../lib/background';

/**
 * The background removal model's progress as the worker reports it: the
 * download in bytes, then starting and running the model. A view of work in
 * progress, never part of the document.
 */
interface BackgroundState {
  progress: ModelProgress | null;
  setProgress: (progress: ModelProgress | null) => void;
}

export const useBackgroundStore = create<BackgroundState>((set) => ({
  progress: null,
  setProgress: (progress) => set({ progress: progress?.stage === 'done' ? null : progress }),
}));
