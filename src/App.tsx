import React from 'react';
import { Toolbar } from './components/toolbar/Toolbar';
import { ToolPanel } from './components/panels/ToolPanel';
import { ViewportCanvas } from './components/canvas/ViewportCanvas';
import { ZoomControls } from './components/canvas/ZoomControls';
import { PropertiesPanel } from './components/panels/PropertiesPanel';
import { LayersPanel } from './components/panels/LayersPanel';
import { CAMPanel } from './components/panels/CAMPanel';
import { AdjustmentsPanel } from './components/panels/AdjustmentsPanel';
import { DitheringPanel } from './components/panels/DitheringPanel';
import { VectorizationPanel } from './components/panels/VectorizationPanel';
import { DepthMapPanel } from './components/panels/DepthMapPanel';
import { AIPanel } from './components/panels/AIPanel';
import { ExportPanel } from './components/panels/ExportPanel';
import { MaterialPresetDialog } from './components/dialogs/MaterialPresetDialog';
import { CanvasSizeDialog } from './components/dialogs/CanvasSizeDialog';
import { MaterialTestGridDialog } from './components/dialogs/MaterialTestGridDialog';
import { ShortcutsDialog } from './components/dialogs/ShortcutsDialog';
import { TextLayerDialog } from './components/dialogs/TextLayerDialog';
import { useUIStore } from './store/uiStore';
import { useWorkerPipeline } from './hooks/useWorker';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import styles from './App.module.css';

export const App: React.FC = () => {
  const activeTab = useUIStore((s) => s.activeTab);
  const isTestGridDialogOpen = useUIStore((s) => s.isTestGridDialogOpen);
  const setTestGridDialogOpen = useUIStore((s) => s.setTestGridDialogOpen);
  const isShortcutsDialogOpen = useUIStore((s) => s.isShortcutsDialogOpen);
  const setShortcutsDialogOpen = useUIStore((s) => s.setShortcutsDialogOpen);
  const isTextDialogOpen = useUIStore((s) => s.isTextDialogOpen);
  const setTextDialogOpen = useUIStore((s) => s.setTextDialogOpen);

  // Initialize the Web Worker execution pipeline & global keyboard shortcuts
  useWorkerPipeline();
  useKeyboardShortcuts();

  const renderActivePanel = () => {
    switch (activeTab) {
      case 'properties':
        return <PropertiesPanel />;
      case 'layers':
        return <LayersPanel />;
      case 'cam':
        return <CAMPanel />;
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
        return <PropertiesPanel />;
    }
  };

  return (
    <div className={styles.appContainer}>
      <Toolbar />
      <div className={styles.mainLayout}>
        <ToolPanel />
        <main className={styles.canvasArea}>
          <ViewportCanvas />
          <ZoomControls />
        </main>
        {renderActivePanel()}
      </div>
      <MaterialPresetDialog />
      <CanvasSizeDialog />
      <MaterialTestGridDialog isOpen={isTestGridDialogOpen} onClose={() => setTestGridDialogOpen(false)} />
      <ShortcutsDialog isOpen={isShortcutsDialogOpen} onClose={() => setShortcutsDialogOpen(false)} />
      <TextLayerDialog isOpen={isTextDialogOpen} onClose={() => setTextDialogOpen(false)} />
    </div>
  );
};
