// The strip chrome — a head that toggles, a count, an optional summary line,
// and rows that exist only while open. Three components rendered this same
// shape with three vocabularies before this file: `TaskStrip` and `MailStrip`
// here in the design system, and `HotFilesStrip` over in the app.
//
// IT OWNS THE SHAPE, AND NOW THE PART OF THE SKIN THAT WAS NEVER A CHOICE.
// Every class name still arrives as a prop and each strip's own stylesheet
// still defines it; what changed is that four slots — headline, count,
// summary layout, rows — stopped being written twice. This paragraph used to
// say the hoist was impossible, "because hoisting the identical base rules
// into a `collapsible-strip.css` rekeys every registry entry naming the old
// sheet (`<basename> <selector>` is the key)". That was true, and it was a
// TEST'S KEY FORMAT deciding where code may live; `design/audit.mjs` keys a
// rule by its selector now, so the reason is spent and the rules moved.
//
// The rest stays twinned, and the sheet beside this one argues each case: the
// ROOTS, because `.mail-strip` sets `color` beside its `background` to be
// self-grounded for route 1 while `.task-strip` does not; the SUMMARY'S INK,
// for the same reason one level down; and `.hotfiles` entirely, which has no
// summary line, a different rows padding and a headline that does not
// truncate. Those are differences in what each strip IS.
//
// WHAT DIFFERS is the height of the head: `.mail-strip-head` floors at
// `var(--tap-min)`, `.task-head` at `var(--sp-8)` and `.hotfiles-head` at
// nothing. Two of three heads are under the tap floor. That is said out loud
// as `headFloor` rather than levelled by the shared chrome — levelling it is a
// visual change (+12px on the task strip of the session screen), and this
// change ships none (operator ruling, 2026-10-15). A fourth strip can no longer
// invent a fourth chrome, and the shape now has a story of its own rather than
// being pinned only through whichever domain strip happens to render it.
import { useState } from 'react';
import './collapsible-strip.css';
import type { ReactNode } from 'react';
import { BARE_ROW } from './bare-row';
import { cn } from '../lib/cn';

export interface CollapsibleStripProps {
  /** The root class, e.g. `mail-strip`. Gains `--open` while expanded. */
  root: string;
  /** The prefix for every part class, e.g. `mail-strip` or `task`.
   *
   *  SEPARATE from `root` because the two existing vocabularies disagree:
   *  `.mail-strip` parts are `mail-strip-head`, `.task-strip` parts are
   *  `task-head`. Folding them into one prop would have meant renaming one
   *  side's classes — and those names are load-bearing in both directions,
   *  selected on by three stylesheets and asserted by name in `fleet-css`,
   *  `chat.test` and the strips' own suites. A second prop is cheaper than a
   *  rename nobody asked for. */
  part: string;
  /** `aria-label` on the region. */
  label: string;
  /** The glyph in the head. `aria-hidden`, because it decorates a head whose
   *  headline already says what this is. */
  mark: ReactNode;
  /** Appended to `${part}-mark` — `TaskStrip` passes `task-mark--running` so
   *  the asterisk breathes while something is actually running. */
  markClass?: string;
  headline: ReactNode;
  /** Rendered in `${part}-count` when given. `HotFilesStrip` has none: its
   *  headline already counts ("3 hot-file claims"), and a count beside it
   *  would say the same number twice. */
  count?: ReactNode;
  /** Extra head slots, between the count and the chevron. This is where a
   *  strip puts a signal that must be visible COLLAPSED — `MailStrip`'s
   *  blocked and held marks exist for exactly that reason, since a flag named
   *  only in an expanded row is invisible in the state the operator is in. */
  marks?: ReactNode;
  /** The line under the head, always visible. Absent on `HotFilesStrip`. */
  summary?: ReactNode;
  /** The rows. Rendered inside `${part}-rows` and ONLY while open — not
   *  hidden with CSS: a collapsed strip's rows are off the accessibility tree
   *  and out of the tab order, which is what every one of the three did. */
  children: ReactNode;
  /** The minimum height of the head, AS EACH STRIP HAD IT ON MAIN. `tap`
   *  (44px, `--tap-min`) is what `.mail-strip-head` had; `compact` (32px,
   *  `--sp-8`) is `.task-head`; `content` (no floor — the head sizes to its
   *  padding and line) is `.hotfiles-head`. The two short heads ARE under the tap floor,
   *  and the shared chrome raised them once; the operator ruled this change
   *  ships no visual change beyond the Appearance section and two defect fixes
   *  (2026-10-15), so each strip keeps the height main gave it and the raise is its own
   *  change. `tap` is the default because a new strip should clear the floor. */
  headFloor?: 'tap' | 'compact' | 'content';
}

/** `headFloor` as a utility. `cn` knows `min-h-tap` is a min-height, so the
 *  one given here REPLACES the one in `BARE_ROW` rather than sitting beside it. */
const HEAD_FLOOR = { tap: 'min-h-tap', compact: 'min-h-8', content: 'min-h-0' } as const;

export function CollapsibleStrip({
  root, part, label, mark, markClass, headline, count, marks, summary, children, headFloor = 'tap',
}: CollapsibleStripProps): ReactNode {
  // Collapsed by default, in all three cases and for one reason: every strip
  // sits above the composer or the fleet list, so an open list spends height
  // that belongs to the thing being read.
  const [open, setOpen] = useState(false);
  return (
    <section className={open ? `${root} ${root}--open` : root} aria-label={label}>
      <button
        type="button"
        /* THE HEAD'S CHROME WAS WRITTEN THREE TIMES — `.mail-strip-head` and
           `.task-head` here in the design system, `.hotfiles-head` over in
           fleet.css — and all three agreed on ten declarations. That is the
           drift this component's own header describes finding in the
           STRUCTURE (`.task-head` stood at `--sp-8` where the other two stood
           at the tap floor); the chrome had drifted the same way and nobody
           had looked. `BARE_ROW` is the six those rules shared with five other
           app rows, and the four beside it are the head's own — a row of
           children with a gap, padded, which is what makes it a head rather
           than a line. Each sheet keeps only its ink — and its height, which
           is chosen by `headFloor`: the three heads were 44, 32 and content-sized on
           main, and the shared chrome must not quietly level them. */
        className={cn(BARE_ROW, 'flex items-center gap-2 px-3 py-2', HEAD_FLOOR[headFloor], `${part}-head`)}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span
          className={markClass === undefined ? `${part}-mark` : `${part}-mark ${markClass}`}
          aria-hidden="true"
        >
          {mark}
        </span>
        <span className={`${part}-headline`}>{headline}</span>
        {count !== undefined && <span className={`${part}-count`}>{count}</span>}
        {marks}
        <span className={`${part}-chevron`} aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>

      {summary !== undefined && <p className={`${part}-summary`}>{summary}</p>}

      {open && <ol className={`${part}-rows`}>{children}</ol>}
    </section>
  );
}
