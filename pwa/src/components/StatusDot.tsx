// Status dot — glow means life. Busy breathes phosphor; a pending dialog
// pulses amber at exactly double tempo; idle and dead are matte. The dot is
// never the sole signal: it always carries an aria-label AND a glyph (the
// two-glyph rule — colour alone never carries the distinction, which is
// exactly the fusion that used to leave `done` and `idle` both reading as
// "not amber, not busy"), and consumers pair it with a mono status word too.
import type { ReactNode } from 'react';
import type { SessionBucket } from '../../../shared/api';
import './primitives.css';

const DOT: Record<SessionBucket, { className: string; label: string; glyph: string }> = {
  attention: { className: 'dot dot--attention', label: 'waiting on you', glyph: '●' },
  working: { className: 'dot dot--busy', label: 'working', glyph: '◐' },
  done: { className: 'dot dot--done', label: 'finished', glyph: '✓' },
  idle: { className: 'dot dot--idle', label: 'idle', glyph: '○' },
  // U+FE0E (VARIATION SELECTOR-15) is load-bearing, not decoration. U+267B has
  // an emoji presentation, and the --font-mono stack has no coverage for it on
  // Apple platforms, so the bare glyph falls back to Apple Color Emoji: the
  // lamp paints itself the emoji's own green, ignoring --status-cleanup and
  // every ratio design/contrast-check.mjs measured for it — and reading as
  // `working`, whose dot is green by design. VS15 asks for the text
  // presentation, which is the one this file's colour is about.
  cleanup: { className: 'dot dot--cleanup', label: 'merged, ready to clean up', glyph: '♻︎' },
  archived: { className: 'dot dot--idle', label: 'archived', glyph: '○' },
  dead: { className: 'dot dot--dead', label: 'not running', glyph: '✕' },
};

export function StatusDot({ status }: { status: SessionBucket }): ReactNode {
  const dot = DOT[status];
  return (
    <span className={dot.className} role="img" aria-label={dot.label} data-status={status}>
      {dot.glyph}
    </span>
  );
}
