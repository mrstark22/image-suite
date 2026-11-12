import React, { useEffect } from 'react';
import { MenuBar } from './components/toolbar/MenuBar';
import { StepRail } from './components/shell/StepRail';
import { StepInspector } from './components/shell/StepInspector';
import { PreviewCanvas } from './components/canvas/PreviewCanvas';
import { ZoomControls } from './components/canvas/ZoomControls';
import { SizeDialog } from './components/dialogs/SizeDialog';
import { MaterialTestGridDialog } from './components/dialogs/MaterialTestGridDialog';
import { ShortcutsDialog } from './components/dialogs/ShortcutsDialog';
import { ErrorBanner } from './components/shared/ErrorBanner';
import { useUIStore } from './store/uiStore';
import { startSchedulers } from './lib/schedulers';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import styles from './App.module.css';

/**
 * The workflow shell (#53): the top bar chooses the job, the rail lists its
 * steps, and the inspector shows the current one. The canvas stays in view
 * through every step.
 */
export const App: React.FC = () => {
  const isTestGridDialogOpen = useUIStore((s) => s.isTestGridDialogOpen);
  const setTestGridDialogOpen = useUIStore((s) => s.setTestGridDialogOpen);
  const isShortcutsDialogOpen = useUIStore((s) => s.isShortcutsDialogOpen);
  const setShortcutsDialogOpen = useUIStore((s) => s.setShortcutsDialogOpen);

  // The preview, trace and relief schedulers: created once, outside React.
  useEffect(() => {
    startSchedulers();
  }, []);
  useKeyboardShortcuts();

  return (
    <div className={styles.appContainer}>
      <header>
        <MenuBar />
      </header>
      <div className={styles.mainLayout}>
        <StepRail />
        <main className={styles.canvasArea}>
          <ErrorBanner />
          <PreviewCanvas />
          <ZoomControls />
        </main>
        <StepInspector />
      </div>
      <SizeDialog />
      <MaterialTestGridDialog isOpen={isTestGridDialogOpen} onClose={() => setTestGridDialogOpen(false)} />
      <ShortcutsDialog isOpen={isShortcutsDialogOpen} onClose={() => setShortcutsDialogOpen(false)} />
    </div>
  );
};
