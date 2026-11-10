import React from 'react';
import { Keyboard, X } from 'lucide-react';
import styles from './MaterialTestGridDialog.module.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    category: 'Tools & Canvas Modes',
    items: [
      { key: 'H', desc: 'Pan Canvas Viewport Tool' },
      { key: 'C', desc: 'Crop Tool' },
      { key: 'Space + Drag', desc: 'Temporary Viewport Pan' },
      { key: 'Enter', desc: 'Apply Crop' },
      { key: 'Esc', desc: 'Cancel Crop / Close Modal' },
    ],
  },
  {
    category: 'View & Simulation',
    items: [
      { key: 'Ctrl + 1', desc: 'Reset Zoom to 100% (Actual Size)' },
      { key: 'Ctrl + + / -', desc: 'Zoom In / Zoom Out' },
      { key: 'Ctrl + R', desc: 'Toggle Physical Canvas Rulers' },
      { key: 'Ctrl + \\', desc: 'Toggle Split View (Before / After)' },
      { key: 'Ctrl + B', desc: 'Toggle Substrate Dark Burn Simulation' },
    ],
  },
  {
    category: 'History & File Operations',
    items: [
      { key: 'Ctrl + Z', desc: 'Undo Last Action / Parameter Change' },
      { key: 'Ctrl + Y', desc: 'Redo Action' },
      { key: 'Ctrl + O', desc: 'Open Image' },
      { key: 'Ctrl + S', desc: 'Open Production Export Dialog' },
    ],
  },
];

export const ShortcutsDialog: React.FC<Props> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>
            <Keyboard size={16} color="var(--accent-primary)" />
            <span>Keyboard Shortcuts & Workflow Cheatsheet</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.body} style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {SHORTCUT_GROUPS.map((grp) => (
            <div key={grp.category} style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--accent-primary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 6,
                }}
              >
                {grp.category}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {grp.items.map((item) => (
                  <div
                    key={item.key}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '4px 8px',
                      background: 'var(--bg-surface, #0d1117)',
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: 'var(--text-secondary)' }}>{item.desc}</span>
                    <kbd
                      style={{
                        background: 'var(--bg-surface-raised, #21262d)',
                        border: '1px solid var(--border-medium, #30363d)',
                        borderRadius: 3,
                        padding: '2px 6px',
                        fontFamily: 'var(--font-mono, monospace)',
                        fontSize: 11,
                        color: 'var(--text-primary)',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
                      }}
                    >
                      {item.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <button className={styles.btnPrimary} onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
