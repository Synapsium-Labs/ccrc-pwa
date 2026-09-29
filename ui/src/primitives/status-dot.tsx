// Status dot — GLOW MEANS LIFE. Busy breathes phosphor; a pending dialog
// pulses amber at exactly double tempo; everything else is matte. The dot is
// never the sole signal: it carries an aria-label AND a glyph (the two-glyph
// rule — colour alone never carries the distinction, which is the fusion that
// used to leave `done` and `idle` both reading as "not amber, not busy").
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import type { SessionBucket } from '../../../shared/api';
import { cn } from '../lib/cn';

export const dotVariants = cva(
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
