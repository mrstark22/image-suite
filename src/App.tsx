import React from 'react';
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
import { useUIStore } from './store/uiStore';
import { useWorkerPipeline } from './hooks/useWorker';
import styles from './App.module.css';

export const App: React.FC = () => {
  const activeTab = useUIStore((s) => s.activeTab);

  // Initialize the Web Worker execution pipeline
  useWorkerPipeline();

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
          <PreviewCanvas />
          <ZoomControls />
        </main>
        {renderActivePanel()}
      </div>
      <MaterialPresetDialog />
    </div>
  );
};
