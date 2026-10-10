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
