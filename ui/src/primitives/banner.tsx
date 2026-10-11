// Banner — a screen-level statement with an optional action.
//
// shadcn's Alert, wearing ccrc tokens. The STRUCTURE is Alert's (a tone
// variant set, a message region, an optional trailing action) and the
// VOCABULARY is this palette's, because shadcn's own token names mean
// different things here: its `accent` is a muted hover surface while
// `--accent` is the phosphor, and its `destructive` has no counterpart in a
// system whose variant axis is session state. Taking the shape and leaving the
// names is the whole of what adopting shadcn means in this package.
//
// WHAT IT REPLACED. Three stylesheet blocks saying the same thing in
// fleet.css: `.fleet-host-banner` (dead red, carries a destructive action),
// `.fleet-host-banner--warn` (attention amber, roster divergence) and
// `.substrate-banner` (attention amber, no action). 77 lines of CSS for one
// shape in two tones. The declarations are reproduced here token for token —
// see banner.test.tsx, which measures the old rules against this cva rather
// than trusting that claim.
//
// NO STYLESHEET, deliberately. Every tone sets both its ground and its ink, so
// each pair is self-grounded and `pwa/test/utility-pairs.test.ts` derives and
// measures it across all twelve palettes straight from the cva below. A
// `banner.css` would move the measurement to `design/audit.mjs` and buy
// nothing — and it is the stylesheet half that the hook-class scheme exists to
// serve, which this component has no consumer for.
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export const bannerVariants = cva(
  // `pl-4` against `pr-2` is not drift: the right side holds a Button whose own
  // padding supplies the gap, so matching the left would read as a double
  // indent. Both migrated rules had exactly this asymmetry.
  'banner flex items-center gap-3 rounded-md border py-2 pr-2 pl-4'
  + ' font-ui text-sm leading-normal font-regular'
  // A path, a token or a command named inside the sentence drops to mono at
  // one step down. Two rules said this before — `.fleet-host-banner--warn
  // code` and `.substrate-banner-reason`, the second a hand-applied class for
  // what the first did structurally — and they agreed on both declarations, so
  // this is one statement rather than a merge. The `[&_code]` form is shadcn's
  // own Alert idiom (`[&>svg]` there) and keeps it out of a stylesheet.
  + ' [&_code]:font-mono [&_code]:text-xs',
  {
    variants: {
      /** The two the fleet actually speaks. There is no `quiet` tone here:
       *  the slim offline strip is a different shape (centred, mono, caps,
       *  with a pulse dot) and stays its own rule until it earns a component. */
      tone: {
        // Louder, because it carries a destructive action. --status-dead-tint-solid
        // rather than --status-dead-tint: the 12%-alpha tint is priced over a
        // CARD in tokens.css, and a banner floats on --bg-page, where the same
        // tint lets a darker ground through and the text pair falls to 4.44 in
        // light — under the floor. The -tint-solid token IS that wash
        // pre-composited on --bg-surface, which buys the measured ground back.
        dead: 'border-status-dead bg-status-dead-tint-solid text-status-dead-text',
        // The host is UP, so this is not the dead language — it is the amber
        // the fleet already uses for "waiting on you". Both tokens are solid in
        // both themes, so no pre-composition is needed on this side.
        attention:
          'border-status-attention bg-status-attention-tint text-status-attention-text',
      },
      /** Pinned under the header while the fleet scrolls. On for a banner
       *  whose action must stay in reach, off when recovery is a human at a
       *  terminal and there is nothing here to tap. */
      sticky: {
        true: 'sticky top-[calc(var(--sp-2)+var(--safe-top))] z-header',
        false: '',
      },
    },
    defaultVariants: { tone: 'attention', sticky: false },
  },
);

export interface BannerProps extends VariantProps<typeof bannerVariants> {
  /** The sentence. Wrapped in a `flex-1 min-w-0` region so a long reason
   *  wraps rather than pushing a trailing Button off the edge. */
  children: ReactNode;
  /** The trailing control, if the banner has one to offer. */
  action?: ReactNode;
  /** `role` — `status` for everything shipped today. Left settable rather
   *  than hardcoded because a banner announcing a failure the operator must
   *  act on is an `alert`, and that is the consumer's call, not this file's. */
  role?: string;
  className?: string;
}

export function Banner({
  children, action, tone, sticky, role = 'status', className,
}: BannerProps): ReactNode {
  return (
    <div className={cn(bannerVariants({ tone, sticky }), className)} role={role}>
      <span className="banner-msg flex-1 min-w-0">{children}</span>
      {action}
    </div>
  );
}
