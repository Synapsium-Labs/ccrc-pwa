// Door — a labelled way into another screen, from a header.
//
// `.accounts-door` and `.settings-door` were byte-identical: nine declarations,
// an `:active`, and a `-glyph` rule each. Their call sites sit adjacent in
// FleetScreen.tsx and the second one's comment points at the first — "the
// `.accounts-door` pattern directly above, for the argument its comment
// makes". That argument is the component's reason to exist, so it is restated
// here rather than left in a stylesheet: a glyph AND a short text label,
// because an icon-only gear would be exactly as undiscoverable as the
// AccountsStrip tap target that D-161 found was the only door to /accounts.
//
// A SIBLING OF BackButton, NOT A VARIANT OF IT. They share the press
// (`scale(0.88)` and a lift to `--ink-primary`) and the two-duration
// transition, and nothing else: a door is `inline-flex` with a mono micro-label
// beside a glyph, where a back chevron is a square tap target holding one
// 26px character. Folding them into one cva would mean a variant axis whose
// two values share no base, which is two components wearing a trench coat.
//
// REDUCED MOTION, same as BackButton and for the same reason: fleet.css's
// `prefers-reduced-motion` block named `.fab`, `.card`, `.notice-x`,
// `.acct-change`, `.acct-list .acct-row` and `.proj-row` — neither door. So
// both ignored the preference, and `motion-reduce:transition-none` now rides
// on the component. The one behaviour change in this extraction, stated as
// one.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

/** The shared chrome, token for token as both rules declared it.
 *
 *  `gap-[5px]` is a literal because the rules were: 5px is between `--sp-1`
 *  (4px) and `--sp-2` (8px), and neither reads right against a mono micro-label.
 *  Preserved rather than rounded to a token — rounding it would be a visual
 *  change dressed up as tidying, and inventing a `--sp-1_5` for one gap is
 *  worse than the literal. */
export const DOOR =
  'inline-flex items-center gap-[5px] min-h-tap px-1 py-0 border-0 rounded-sm'
  + ' bg-transparent text-ink-secondary font-mono text-2xs font-medium leading-none'
  + ' cursor-pointer'
  + ' [transition:transform_var(--dur-press)_var(--curve-swift),color_var(--dur-fast)_var(--curve-swift)]'
  + ' motion-reduce:transition-none'
  + ' active:scale-[0.88] active:text-ink-primary';

/** The glyph beside the word. It is DECORATION — `aria-hidden`, because the
 *  label carries the meaning — and it drops to the UI font because the mono
 *  stack has no coverage for an emoji key or a gear. */
export const DOOR_GLYPH = 'font-ui text-xs leading-none';

export interface DoorProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The decorative glyph. Rendered `aria-hidden` in its own span. */
  glyph: ReactNode;
  /** The visible word. SHORT, and it must be a word: the accessible name
   *  begins with it so a voice user saying what they see still reaches the
   *  control. */
  children: ReactNode;
  /** `aria-label`. Required rather than optional because neither shipped door
   *  can rely on its own word — "Account" is what the AccountsStrip already
   *  failed to communicate, and "Settings" names no content — so each says
   *  what is actually behind it. */
  'aria-label': string;
  className?: string;
}

export function Door({ className, glyph, children, ...props }: DoorProps): ReactNode {
  return (
    <button type="button" className={cn(DOOR, className)} {...props}>
      <span className={DOOR_GLYPH} aria-hidden="true">{glyph}</span>
      {children}
    </button>
  );
}
