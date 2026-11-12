import React from 'react';
import { Keyboard, X } from 'lucide-react';
import { SHORTCUT_GROUPS } from '../../lib/shortcuts';
import styles from './MaterialTestGridDialog.module.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsDialog: React.FC<Props> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>
            <Keyboard size={16} color="var(--text-2)" />
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
                  color: 'var(--text-3)',
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
                    key={item.keys}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '4px 8px',
                      background: 'var(--surface)',
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: 'var(--text-2)' }}>{item.desc}</span>
                    <kbd
                      style={{
                        background: 'var(--surface-2)',
                        border: '1px solid var(--control-border)',
                        borderRadius: 3,
                        padding: '2px 6px',
                        fontSize: 11,
                        color: 'var(--text)',
                      }}
                    >
                      {item.keys}
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
