import React, { useEffect } from 'react';
import { Toolbar } from './components/toolbar/Toolbar';
import { ToolPanel } from './components/panels/ToolPanel';
import { PreviewCanvas } from './components/canvas/PreviewCanvas';
import { ZoomControls } from './components/canvas/ZoomControls';
import { AdjustmentsPanel } from './components/panels/AdjustmentsPanel';
import { DitheringPanel } from './components/panels/DitheringPanel';
import { VectorizationPanel } from './components/panels/VectorizationPanel';
import { DepthMapPanel } from './components/panels/DepthMapPanel';
import { AIPanel } from './components/panels/AIPanel';
import { ExportPanel } from './components/panels/ExportPanel';
import { MaterialPresetDialog } from './components/dialogs/MaterialPresetDialog';
import { SizeDialog } from './components/dialogs/SizeDialog';
import { MaterialTestGridDialog } from './components/dialogs/MaterialTestGridDialog';
import { ShortcutsDialog } from './components/dialogs/ShortcutsDialog';
import { ErrorBanner } from './components/shared/ErrorBanner';
import { useUIStore } from './store/uiStore';
import { startSchedulers } from './lib/schedulers';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import styles from './App.module.css';

export const App: React.FC = () => {
  const activeTab = useUIStore((s) => s.activeTab);
  const isTestGridDialogOpen = useUIStore((s) => s.isTestGridDialogOpen);
  const setTestGridDialogOpen = useUIStore((s) => s.setTestGridDialogOpen);
  const isShortcutsDialogOpen = useUIStore((s) => s.isShortcutsDialogOpen);
  const setShortcutsDialogOpen = useUIStore((s) => s.setShortcutsDialogOpen);

  // Initialize the Web Worker execution pipeline & global keyboard shortcuts
  // The preview, trace and relief schedulers: created once, outside React.
  useEffect(() => {
    startSchedulers();
  }, []);
  useKeyboardShortcuts();

  const renderActivePanel = () => {
    switch (activeTab) {
      case 'adjustments':
        return <AdjustmentsPanel />;
      case 'dither':
        return <DitheringPanel />;
      case 'vector':
        return <VectorizationPanel />;
      case 'depth':
        return <DepthMapPanel />;
      case 'ai':
        return <AIPanel />;
      case 'export':
        return <ExportPanel />;
      default:
        return <AdjustmentsPanel />;
    }
  };

  return (
    <div className={styles.appContainer}>
      <Toolbar />
      <div className={styles.mainLayout}>
        <ToolPanel />
        <main className={styles.canvasArea}>
          <ErrorBanner />
          <PreviewCanvas />
          <ZoomControls />
        </main>
        {renderActivePanel()}
      </div>
      <MaterialPresetDialog />
      <SizeDialog />
      <MaterialTestGridDialog isOpen={isTestGridDialogOpen} onClose={() => setTestGridDialogOpen(false)} />
      <ShortcutsDialog isOpen={isShortcutsDialogOpen} onClose={() => setShortcutsDialogOpen(false)} />
    </div>
  );
};
