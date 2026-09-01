import React from 'react';
import {
  Layers,
  SlidersHorizontal,
  Grid,
  PenTool,
  Box,
  Wand2,
  Download,
  Sun,
  Moon,
  Settings2,
} from 'lucide-react';
import { useUIStore, type ToolTab } from '../../store/uiStore';
import { useLayerStore } from '../../store/layerStore';
import { useSceneStore } from '../../core/scene-store';
import styles from './ToolPanel.module.css';

interface ToolItem {
  id: ToolTab;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

export const ToolPanel: React.FC = () => {
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const layerCount = useLayerStore((s) => s.layers.length);
  const selectedCount = useSceneStore((s) => s.selectedIds.length);

  const tools: ToolItem[] = [
    { id: 'properties', label: 'Inspector', icon: <Settings2 size={18} />, badge: selectedCount > 0 ? selectedCount : undefined },
    { id: 'layers', label: 'Layers', icon: <Layers size={18} />, badge: layerCount > 1 ? layerCount : undefined },
    // CAM is hidden for now until further development:
    // { id: 'cam', label: 'CAM/Laser', icon: <Cpu size={18} /> },
    { id: 'adjustments', label: 'Tonal', icon: <SlidersHorizontal size={18} /> },
    { id: 'dither', label: 'Dither', icon: <Grid size={18} /> },
    { id: 'vector', label: 'Vector', icon: <PenTool size={18} /> },
    { id: 'depth', label: '3D Depth', icon: <Box size={18} /> },
    { id: 'ai', label: 'AI Tools', icon: <Wand2 size={18} /> },
    { id: 'export', label: 'Export', icon: <Download size={18} /> },
  ];

  return (
    <aside className={styles.toolPanel}>
      {tools.map((tool) => {
        const isActive = activeTab === tool.id;
        return (
          <button
            key={tool.id}
            className={`${styles.toolButton} ${isActive ? styles.toolButtonActive : ''}`}
            onClick={() => setActiveTab(tool.id)}
            title={tool.label}
          >
            {isActive && <div className={styles.activeIndicator} />}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {tool.icon}
              {tool.badge && (
                <span
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -8,
                    backgroundColor: 'var(--accent-primary)',
                    color: '#000',
                    fontSize: 9,
                    fontWeight: 700,
                    borderRadius: 8,
                    padding: '0 4px',
                    minWidth: 14,
                    height: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {tool.badge}
                </span>
              )}
            </div>
            <span className={styles.toolLabel}>{tool.label}</span>
          </button>
        );
      })}

      <div className={styles.spacer} />

      <div className={styles.bottomSection}>
        <button
          className={styles.toolButton}
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </aside>
  );
};
