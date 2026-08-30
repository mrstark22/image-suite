import React from 'react';
import {
  SlidersHorizontal,
  Grid,
  PenTool,
  Box,
  Wand2,
  Download,
  Sun,
  Moon,
} from 'lucide-react';
import { useUIStore, type ToolTab } from '../../store/uiStore';
import styles from './ToolPanel.module.css';

interface ToolItem {
  id: ToolTab;
  label: string;
  icon: React.ReactNode;
}

const TOOLS: ToolItem[] = [
  { id: 'adjustments', label: 'Tonal', icon: <SlidersHorizontal size={18} /> },
  { id: 'dither', label: 'Dither', icon: <Grid size={18} /> },
  { id: 'vector', label: 'Vector', icon: <PenTool size={18} /> },
  { id: 'depth', label: '3D Depth', icon: <Box size={18} /> },
  { id: 'ai', label: 'AI Tools', icon: <Wand2 size={18} /> },
  { id: 'export', label: 'Export', icon: <Download size={18} /> },
];

export const ToolPanel: React.FC = () => {
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  return (
    <aside className={styles.toolPanel}>
      {TOOLS.map((tool) => {
        const isActive = activeTab === tool.id;
        return (
          <button
            key={tool.id}
            className={`${styles.toolButton} ${isActive ? styles.toolButtonActive : ''}`}
            onClick={() => setActiveTab(tool.id)}
            title={tool.label}
          >
            {isActive && <div className={styles.activeIndicator} />}
            {tool.icon}
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
