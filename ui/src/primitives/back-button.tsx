// BackButton — the chevron out of a detail screen.
//
// FIVE rules declared this, identically, ten declarations each plus an
// `:active`: `.chat-back` (chat.css), `.accounts-back`, `.mail-back`,
// `.runs-back` and `.settings-back` (fleet.css). The stylesheets knew. Two of
// them say so in prose — "Same visual contract as chat.css's `.chat-back`" and
// "the same visual contract `.accounts-back` gives beside `.chat-back`: the
// two controls are the same" — and then declare it again anyway, each time
// giving the reason that a rule of its own is preferable to a shared class.
//
// THE COPIES HAD DRIFTED IN TWO WAYS, which is the argument the prose cannot
// make for itself. Neither drift is visible from any one of the five rules:
//
//   1. DESKTOP. `shell.css` hides `.shell-detail .chat-back` and
//      `.shell-detail .accounts-back`, both with the same stated reason — "the
//      fleet sidebar is always visible on desktop, so an explicit way back out
//      of the detail pane is redundant there". That reasoning is about the
//      SHELL, not about those two screens, and `.mail-back`, `.runs-back` and
//      `.settings-back` are not hidden. Three chevrons render on desktop where
//      the stylesheet's own argument says they should not.
//   2. REDUCED MOTION. chat.css's `prefers-reduced-motion` block names
//      `.chat-back`. fleet.css's names `.fab`, `.card`, `.notice-x`,
//      `.acct-change`, `.acct-list .acct-row` and `.proj-row` — no back
//      button. So four of these five animated for a reader who had asked
//      nothing to animate.
//
// Drift 2 is FIXED here, deliberately and as the one behaviour change in this
// extraction: `motion-reduce:transition-none` rides on the component, which is
// what `Button` already does, so all five now honour the preference. A
// reduced-motion preference is an accessibility contract rather than a visual
// choice, and shipping four controls that ignore it is not a design decision
// worth preserving.
//
// Drift 1 is NOT fixed. Hiding three more controls on desktop is a visible
// change to three screens and is the operator's call, not a refactor's — so
// the per-screen hook class stays on every call site and `shell.css`'s two
// rules keep matching exactly what they matched before. The asymmetry is now
// legible in one place instead of being spread across two stylesheets.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from '../lib/focus';

/** The shared chrome, token for token as all five rules declared it.
 *
 *  The `transition` is an arbitrary property rather than Tailwind's
 *  `transition-*` utilities because the two transitions run at DIFFERENT
 *  durations — `transform` at `--dur-press`, `color` at `--dur-fast` — and a
 *  single `duration-*` utility cannot say that. Spelling it out preserves both
 *  exactly; collapsing them to one duration would have been a silent change to
 *  how the press feels. */
// `bg-transparent` where the rules said `background: none`: equivalent in
// effect, and reset.css:234 already sets `background-color: transparent` on
// every button, so this declaration is explicit rather than load-bearing.
export const BACK_BUTTON =
  'flex-none min-w-tap min-h-tap border-none bg-transparent rounded-sm'
  + ' font-ui text-[26px] font-regular leading-none text-ink-secondary cursor-pointer'
  + ' [transition:transform_var(--dur-press)_var(--curve-swift),color_var(--dur-fast)_var(--curve-swift)]'
  + ' motion-reduce:transition-none'
  + ' active:scale-[0.88] active:text-ink-primary'
  + ` ${FOCUS_RING}`;

export interface BackButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The glyph. Every call site passes `‹` today; it is a prop rather than
   *  baked in because the character is content, and a screen that wants `←`
   *  should not need a variant. */
  children: ReactNode;
  className?: string;
}

export function BackButton({ className, children, ...props }: BackButtonProps): ReactNode {
  return (
    <button type="button" className={cn(BACK_BUTTON, className)} {...props}>
      {children}
    </button>
  );
}
