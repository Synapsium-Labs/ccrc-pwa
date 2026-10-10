// TextInput — one line of text entry.
//
// shadcn's Input, wearing ccrc tokens. Three app rules declared this same
// object, and the stylesheet comments admit it in their own words:
// `.sess-hold-input`'s block says it "copies .proj-search's declarations
// verbatim … same tokens, no new pair", and `.login-input` in shell.css is
// the same ten declarations again a package away.
//
// The copies had already drifted in exactly the way a copy does. `.proj-search`
// declared `::placeholder`, `.sess-hold-input` did not — until a fix wave
// noticed, and `pwa/test/fleet-css.test.ts` still carries the observation:
// "Left undeclared the placeholder falls to the UA default in both colour
// schemes — and this placeholder is the ONLY place the reason convention
// (`program:name wave:2/4`) is shown to whoever is typing it." That is the
// whole argument for one component: the fix had to be applied twice, and the
// second application was found by reading rather than by a red suite.
//
// `--fs-input` IS LOAD-BEARING and is why there is no size variant. iOS Safari
// zooms the viewport on focus for any text entry under 16px, so every text
// entry in this app sits on this one token — `.caps-input`'s comment makes the
// same point about the runs board. A `size="sm"` prop here would be a loaded
// gun pointed at mobile.
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from '../lib/focus';

/** The shared object, token for token as all three rules declared it.
 *
 *  NOT a cva: there is one shape and no variant axis. `className` is the
 *  whole extension mechanism, which is what the two differences between the
 *  old rules actually needed — `.proj-search` carried a `margin-bottom` and a
 *  focus `transition` that the other two did not, and both are the call site's
 *  business rather than a variant of what an input IS. */
export const TEXT_INPUT =
  'w-full min-h-tap rounded-md border border-edge-subtle bg-raised text-ink-primary'
  + ' font-ui text-input font-regular leading-normal px-3 py-0 outline-none'
  // The focus cue is a border colour change, not a ring: a 44px field on a
  // phone has no room for an offset ring, and the phosphor on the edge is the
  // same cue every other focusable surface in this palette uses.
  + ' focus:border-accent'
  // The placeholder ink, which is the declaration one of the three copies
  // was missing. On a field with no placeholder attribute it is inert, which
  // is why putting it on the shared base changes nothing for the login field.
  + ' placeholder:text-ink-tertiary'
  + ` ${FOCUS_RING}`;

/** The same object, sharing a row with something else.
 *
 *  `.pr-title-input` (the PR sheet's title field) and `.pool-new-input` (the
 *  pool sheet's name field) declared the same nine declarations as each other
 *  and differed from the three above in exactly three: a `--r-sm` corner, an
 *  `--edge-strong` hairline and `--sp-2` of side padding. That is not drift —
 *  it is what a field looks like when it sits in a row beside a button rather
 *  than alone on a panel, which is what both of these do and none of the
 *  other three does.
 *
 *  A CONSTANT, NOT A VARIANT AXIS. The header above argues there is one shape
 *  here and `className` is the whole extension mechanism; that still holds.
 *  What two call sites needed was not a prop but one place to spell three
 *  utilities, so a third copy has somewhere to come from. A `size` prop would
 *  have meant a cva, a story per value and a type — for three utilities. */
export const TEXT_INPUT_INLINE = 'rounded-sm border-edge-strong px-2';

/** The same object, stacked in a sheet above the thing it filters or names.
 *
 *  These are the two declarations the header above calls "the call site's
 *  business" — `.proj-search`'s margin and its focus transition. They were,
 *  and the markup census found what happened next: FOUR call sites spelling
 *  the same five utilities, across `NewSessionSheet` and `StartProgramSheet`.
 *  A decision written four times is a decision with no owner.
 *
 *  NOT folded into `TEXT_INPUT`. Every other field in the app — the login
 *  field, the hold-reason field, the two inline ones — sits where a margin
 *  below it would move something, and none of them animates its border. The
 *  base stays the base; this is the composition a stacked field reaches for.
 *
 *  `motion-reduce:transition-none` rides along because the transition does:
 *  the pair is the one unit, and separating them is how a reduced-motion
 *  escape hatch gets left behind by the next copy. */
export const TEXT_INPUT_STACKED =
  'mb-2 transition-[border-color] duration-fast ease-swift motion-reduce:transition-none';

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

export function TextInput({ className, type = 'text', ...props }: TextInputProps): ReactNode {
  return <input type={type} className={cn(TEXT_INPUT, className)} {...props} />;
}
