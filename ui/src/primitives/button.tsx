// Button — the two treatments the sheet flows use. `primary` is the phosphor:
// accent fill, ink-on-accent text, the one control on a sheet that commits.
// `ghost` is the way out: hairline border, no fill, never competes.
//
// Disabled is a VISIBLE stand-down, not just an inert listener — an
// accent-filled button that ignores taps reads as broken, so primary drops to
// the subtle hairline fill and disabled ink.
//
// HOOK CLASSES. Each element also carries its original bare class name
// (`dot`, `btn-primary`, `sheet-panel`, ...). Those carry no styling any more —
// the utilities do that — they are STABLE SELECTORS other stylesheets and the
// test suite key on (`.sess-line--active .sess-lamp > .dot`,
// `.sheet-panel .proj-ready`, `.block-screen .btn-primary`). Removing one
// silently un-styles a descendant rule in another package with no build error,
// so they stay until every consumer of that selector is migrated too.
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from '../lib/focus';

export const buttonVariants = cva(
  `flex min-h-tap cursor-pointer items-center justify-center rounded-md font-ui transition-transform duration-press ease-swift motion-reduce:transition-none enabled:active:scale-[0.97] disabled:cursor-default ${FOCUS_RING}`,
  {
    variants: {
      variant: {
        primary:
          'btn-primary border-0 bg-accent text-ink-on-accent text-base font-semibold disabled:bg-edge-subtle disabled:text-ink-disabled',
        ghost:
          'btn-ghost border border-edge-strong bg-transparent text-ink-primary text-base font-medium transition-[transform,background-color] motion-reduce:transition-none enabled:active:bg-raised disabled:text-ink-disabled disabled:border-edge-subtle',
        /** `quiet` — the raised mono control. FOUR app rules declared the same
         *  eleven declarations: `.coord-toggle`, `.child-reclaim-toggle` and
         *  `.caps-save` were byte-identical, and `.program-start-door`
         *  differed only in its font size. fleet.css said so itself, twice,
         *  in comments pointing at the other copies ("Same self-grounded pair
         *  as `.coord-toggle`/`.sess-actions` — not reinvented"). A comment
         *  is a request; this is the mechanism.
         *
         *  Self-grounded on purpose: it declares its own `bg-raised` as well
         *  as its ink, so `design/audit.mjs` can recover a ground for the
         *  pair rather than guessing the surface behind it.
         *
         *  The press is `0.96`, not the base's `0.97` — three of the four
         *  rules said 0.96 and the fourth (`.caps-save`) said 0.97, which it
         *  keeps by passing it at the call site. Folding both to one number
         *  would be a visual change, and this wave has none. */
        quiet:
          'border border-edge-subtle bg-raised text-ink-secondary font-mono text-2xs font-medium leading-none not-italic normal-nums enabled:active:scale-[0.96]',
      },
      /** How wide. `full` is the sheet shape and the default — a sheet's
       *  commit button spans it. `fit` is the one every OTHER row wanted:
       *  six app rules said `width: auto; padding: 0 var(--sp-3)` in six
       *  different sheets, which is one variant written out six times.
       *
       *  Deliberately only those TWO declarations. Four of the six also set
       *  `flex: none`, and two did not; folding it in here would change how
       *  the other two shrink, and this wave changes no visual output. A call
       *  site that needs it passes `className="flex-none"` — placement is the
       *  call site's business and always was (`ui-package-boundary.test.ts`),
       *  and in the JSX it is at least visible. */
      size: {
        full: 'w-full',
        fit: 'w-auto px-3',
      },
    },
    defaultVariants: { variant: 'primary', size: 'full' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps): ReactNode {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
