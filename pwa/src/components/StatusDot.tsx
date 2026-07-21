// Status dot — glow means life. Busy breathes phosphor; a pending dialog
// pulses amber at exactly double tempo; idle and dead are matte. The dot is
// never the sole signal: it always carries an aria-label, and consumers pair
// it with a mono status word or badge.
import type { ReactNode } from 'react';
import type { SessionStatus } from '../../../shared/api';
import './primitives.css';

const DOT: Record<SessionStatus | 'dialog', { className: string; label: string }> = {
  busy: { className: 'dot dot--busy', label: 'working' },
  idle: { className: 'dot dot--idle', label: 'idle' },
  dead: { className: 'dot dot--dead', label: 'not running' },
  dialog: { className: 'dot dot--attention', label: 'waiting on you' },
};

export function StatusDot({ status }: { status: SessionStatus | 'dialog' }): ReactNode {
  const dot = DOT[status];
  return <span className={dot.className} role="img" aria-label={dot.label} data-status={status} />;
}
