import React, { useEffect } from 'react';
import { MenuBar } from './components/toolbar/MenuBar';
import { StepBar, StepRail } from './components/shell/StepRail';
import { StepInspector, StepSheet } from './components/shell/StepInspector';
import { PreviewCanvas } from './components/canvas/PreviewCanvas';
import { ZoomControls } from './components/canvas/ZoomControls';
import { SizeDialog } from './components/dialogs/SizeDialog';
import { ReducedOpenDialog } from './components/dialogs/ReducedOpenDialog';
import { CalibrateDialog } from './components/dialogs/CalibrateDialog';
import { ShortcutsDialog } from './components/dialogs/ShortcutsDialog';
import { ProfilesDialog } from './components/dialogs/ProfilesDialog';
import { loadProfiles } from './store/profilesStore';
import { ErrorBanner } from './components/shared/ErrorBanner';
import { useLayout } from './components/shared/breakpoints';
import { useUIStore } from './store/uiStore';
import { startSchedulers } from './lib/schedulers';
import { connectProfileSync } from './lib/profile-sync';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import styles from './App.module.css';

/**
 * The workflow shell (#53): the top bar chooses the job, the rail lists its
 * steps, and the inspector shows the current one. The canvas stays in view
 * through every step.
 *
 * The structure follows the layout (#54): on a desktop the rail, canvas and
 * inspector sit side by side; on a tablet the rail narrows and the inspector
 * can fold away; on a phone a compact step bar sits above the canvas and the
 * step's controls are in a bottom sheet below it.
 */
export const App: React.FC = () => {
  const isShortcutsDialogOpen = useUIStore((s) => s.isShortcutsDialogOpen);
  const setShortcutsDialogOpen = useUIStore((s) => s.setShortcutsDialogOpen);

  // The preview, trace and relief schedulers: created once, outside React.
  useEffect(() => {
    startSchedulers();
  }, []);
  // Machines, materials and calibrations, from this browser's store (#33).
  useEffect(() => {
    void loadProfiles();
  }, []);
  // The photo's dot pitch and tone curve follow the machine and calibration in use (#34, #39).
  useEffect(() => connectProfileSync(), []);
  useKeyboardShortcuts();
  const layout = useLayout();

  return (
    <div className={styles.appContainer} data-layout={layout}>
      <header>
        <MenuBar />
      </header>
      {layout === 'phone' && <StepBar />}
      <div className={styles.mainLayout}>
        {layout !== 'phone' && <StepRail />}
        <main className={styles.canvasArea}>
          <ErrorBanner />
          <PreviewCanvas />
          <ZoomControls />
        </main>
        {layout === 'phone' ? <StepSheet /> : <StepInspector collapsible={layout === 'tablet'} />}
      </div>
      <SizeDialog />
      <ReducedOpenDialog />
      <ShortcutsDialog isOpen={isShortcutsDialogOpen} onClose={() => setShortcutsDialogOpen(false)} />
      <ProfilesDialog />
      <CalibrateDialog />
    </div>
  );
};
