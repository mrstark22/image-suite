import React from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import styles from './StatusMessage.module.css';

/** What a message reports. An error is never shown in another tone. */
export type StatusTone = 'info' | 'success' | 'warning' | 'error';

/** A message and its tone, as panels hold them in state. */
export interface Status {
  tone: StatusTone;
  text: string;
}

const ICONS: Record<StatusTone, React.ReactNode> = {
  info: <Info size={14} />,
  success: <CheckCircle2 size={14} />,
  warning: <AlertTriangle size={14} />,
  error: <XCircle size={14} />,
};

interface StatusMessageProps {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}

/**
 * A message about the outcome of an action. Each tone has its own colour and
 * icon. An error is announced at once (role "alert"); the other tones are
 * announced politely (role "status").
 */
export const StatusMessage: React.FC<StatusMessageProps> = ({ tone, children, className }) => (
  <div
    className={`${styles.message} ${styles[tone]} ${className ?? ''}`}
    role={tone === 'error' ? 'alert' : 'status'}
    data-tone={tone}
  >
    <span className={styles.icon} aria-hidden="true">
      {ICONS[tone]}
    </span>
    <span>{children}</span>
  </div>
);
