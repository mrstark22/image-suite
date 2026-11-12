import React from 'react';
import { Keyboard } from 'lucide-react';
import { SHORTCUT_GROUPS } from '../../lib/shortcuts';
import { Button } from '../shared/Button';
import { Dialog } from '../shared/Dialog';
import styles from './ShortcutsDialog.module.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/** The keyboard shortcuts, from the same list the menus and the key handler use. */
export const ShortcutsDialog: React.FC<Props> = ({ isOpen, onClose }) => (
  <Dialog
    open={isOpen}
    onClose={onClose}
    size="lg"
    icon={<Keyboard size={16} />}
    title="Keyboard Shortcuts & Workflow Cheatsheet"
    footer={
      <Button variant="primary" compact onClick={onClose}>
        Got it
      </Button>
    }
  >
    {SHORTCUT_GROUPS.map((grp) => (
      <section key={grp.category} className={styles.group}>
        <h3 className={styles.groupTitle}>{grp.category}</h3>
        <ul className={styles.list}>
          {grp.items.map((item) => (
            <li key={item.keys} className={styles.item}>
              <span className={styles.desc}>{item.desc}</span>
              <kbd className={styles.keys}>{item.keys}</kbd>
            </li>
          ))}
        </ul>
      </section>
    ))}
  </Dialog>
);
