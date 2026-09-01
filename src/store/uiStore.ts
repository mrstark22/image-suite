import { create } from 'zustand';

export type ToolTab =
  | 'properties'
  | 'layers'
  | 'cam'
  | 'adjustments'
  | 'dither'
  | 'vector'
  | 'depth'
  | 'ai'
  | 'export';

interface UIState {
  activeTab: ToolTab;
  isSplitView: boolean;
  isInvertedBurn: boolean;
  showRulers: boolean;
  showVectorOverlay: boolean;
  theme: 'dark' | 'light';

  // Modal Dialogs
  isPresetDialogOpen: boolean;
  isExportDialogOpen: boolean;
  isSettingsDialogOpen: boolean;
  isCanvasSizeDialogOpen: boolean;
  isTestGridDialogOpen: boolean;
  isShortcutsDialogOpen: boolean;
  isTextDialogOpen: boolean;

  // Actions
  setActiveTab: (tab: ToolTab) => void;
  toggleSplitView: () => void;
  toggleInvertedBurn: () => void;
  toggleRulers: () => void;
  toggleVectorOverlay: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;

  setPresetDialogOpen: (open: boolean) => void;
  setExportDialogOpen: (open: boolean) => void;
  setSettingsDialogOpen: (open: boolean) => void;
  setCanvasSizeDialogOpen: (open: boolean) => void;
  setTestGridDialogOpen: (open: boolean) => void;
  setShortcutsDialogOpen: (open: boolean) => void;
  setTextDialogOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeTab: 'adjustments',
  isSplitView: false,
  isInvertedBurn: false,
  showRulers: true,
  showVectorOverlay: true,
  theme: 'dark',

  isPresetDialogOpen: false,
  isExportDialogOpen: false,
  isSettingsDialogOpen: false,
  isCanvasSizeDialogOpen: false,
  isTestGridDialogOpen: false,
  isShortcutsDialogOpen: false,
  isTextDialogOpen: false,

  setActiveTab: (activeTab) => set({ activeTab }),
  toggleSplitView: () => set((state) => ({ isSplitView: !state.isSplitView })),
  toggleInvertedBurn: () => set((state) => ({ isInvertedBurn: !state.isInvertedBurn })),
  toggleRulers: () => set((state) => ({ showRulers: !state.showRulers })),
  toggleVectorOverlay: () => set((state) => ({ showVectorOverlay: !state.showVectorOverlay })),
  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },
  toggleTheme: () =>
    set((state) => {
      const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nextTheme);
      return { theme: nextTheme };
    }),

  setPresetDialogOpen: (isPresetDialogOpen) => set({ isPresetDialogOpen }),
  setExportDialogOpen: (isExportDialogOpen) => set({ isExportDialogOpen }),
  setSettingsDialogOpen: (isSettingsDialogOpen) => set({ isSettingsDialogOpen }),
  setCanvasSizeDialogOpen: (isCanvasSizeDialogOpen) => set({ isCanvasSizeDialogOpen }),
  setTestGridDialogOpen: (isTestGridDialogOpen) => set({ isTestGridDialogOpen }),
  setShortcutsDialogOpen: (isShortcutsDialogOpen) => set({ isShortcutsDialogOpen }),
  setTextDialogOpen: (isTextDialogOpen) => set({ isTextDialogOpen }),
}));
