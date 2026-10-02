// Status dot — GLOW MEANS LIFE. Busy breathes phosphor; a pending dialog
// pulses amber at exactly double tempo; everything else is matte. The dot is
// never the sole signal: it carries an aria-label AND a glyph (the two-glyph
// rule — colour alone never carries the distinction, which is the fusion that
// used to leave `done` and `idle` both reading as "not amber, not busy").
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import type { SessionBucket } from '../../../shared/api';
import { cn } from '../lib/cn';

export /* `motion-reduce:opacity-85` is 0.85, NOT 0.8, and the value is measured rather
 * than chosen. Element opacity composites over the ground and these dots are
 * non-text UI at a 3:1 floor. At 0.8 the light-theme attention dot fell to 2.88
 * on a card. At 0.85 the four grounds these dots use read 7.57/3.10 (attention
 * on a card), 8.20/3.68 (attention on a lamp well), 7.22/3.45 and 7.82/3.30
 * (busy on each) — the tightest is 3.10. Same value as the reduced-motion pin
 * on `.task-mark--running` (components/task-strip.css, which travelled there with
 * TaskStrip in the composite-migration wave).
 *
 * This note moved here from `styles/legacy.css`'s reduced-motion block when
 * that block retired (wave 2). The utility is invisible to `design/audit.mjs`,
 * which reads stylesheets — so this comment is now the only record of why the
 * number is what it is. Do not lower it. */
const dotVariants = cva(
  'dot inline-flex min-w-2 min-h-2 flex-none items-center justify-center rounded-full font-mono text-[9px] leading-none',
  {
    variants: {
      tone: {
        // The two living states, and the only two allowed to emit light.
        busy: 'dot--busy text-status-busy shadow-glow-dot-busy animate-breathe motion-reduce:animate-none motion-reduce:opacity-85',
        attention:
          'dot--attention text-status-attention shadow-glow-dot-attention animate-pulse-attention motion-reduce:animate-none motion-reduce:opacity-85',
        // Matte. `done` and `cleanup` alias idle's hue on purpose — nothing is
        // running, so nothing glows, and the GLYPH is what tells them apart.
        idle: 'dot--idle text-status-idle',
        done: 'dot--done text-status-done',
        cleanup: 'dot--cleanup text-status-cleanup',
        dead: 'dot--dead text-status-dead',
      },
    },
    defaultVariants: { tone: 'idle' },
  },
);

const DOT: Record<
  SessionBucket,
  { tone: NonNullable<VariantProps<typeof dotVariants>['tone']>; label: string; glyph: string }
> = {
  attention: { tone: 'attention', label: 'waiting on you', glyph: '●' },
  working: { tone: 'busy', label: 'working', glyph: '◐' },
  done: { tone: 'done', label: 'finished', glyph: '✓' },
  idle: { tone: 'idle', label: 'idle', glyph: '○' },
  // U+FE0E (VARIATION SELECTOR-15) is load-bearing, not decoration. U+267B has
  // an emoji presentation and the mono stack has no coverage for it on Apple
  // platforms, so the bare glyph falls back to Apple Color Emoji: the lamp
  // paints itself the emoji's own green, ignoring --status-cleanup and every
  // ratio contrast-check.mjs measured for it — and reading as `working`, whose
  // dot is green by design. VS15 asks for the text presentation.
  cleanup: { tone: 'cleanup', label: 'merged, ready to clean up', glyph: '♻︎' },
  archived: { tone: 'idle', label: 'archived', glyph: '○' },
  dead: { tone: 'dead', label: 'not running', glyph: '✕' },
};

export interface StatusDotProps {
  status: SessionBucket;
  className?: string;
}

export function StatusDot({ status, className }: StatusDotProps): ReactNode {
  const dot = DOT[status];
  return (
    <span
      className={cn(dotVariants({ tone: dot.tone }), className)}
      role="img"
      aria-label={dot.label}
      data-status={status}
    >
      {dot.glyph}
    </span>
  );
}
