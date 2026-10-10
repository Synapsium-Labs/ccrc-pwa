// The strip chrome — a head that toggles, a count, an optional summary line,
// and rows that exist only while open. Three components rendered this same
// shape with three vocabularies before this file: `TaskStrip` and `MailStrip`
// here in the design system, and `HotFilesStrip` over in the app.
//
// IT OWNS THE SHAPE, NOT THE SKIN. Every class name arrives as a prop and the
// consumer's own stylesheet still defines it, which is the whole reason this
// extraction costs nothing: `mail-strip.css`, `task-strip.css` and `fleet.css`
// are untouched, so not one contrast-gate rule key moves. The alternative —
// hoisting the identical base rules into a `collapsible-strip.css` — rekeys
// every registry entry naming the old sheet (`<basename> <selector>` is the
// key), and the three skins are NOT in fact identical: `.mail-strip` sets
// `color` to make itself self-grounded for the audit's route 1 while
// `.task-strip` does not, and `.hotfiles` has no summary line at all. Those are
// differences in what each strip IS, not drift to be collapsed.
//
// WHAT DRIFTED was the structure, and it drifted in the direction a shared
// stylesheet would not have caught: `.task-head` has `min-height: var(--sp-8)`
// where the other two have `var(--tap-min)`, so one of three strips had a head
// that could fall under the tap floor. A fourth strip can no longer invent a
// fourth chrome, and the shape now has a story of its own rather than being
// pinned only through whichever domain strip happens to render it.
import { useState } from 'react';
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
}

export function CollapsibleStrip({
  root, part, label, mark, markClass, headline, count, marks, summary, children,
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
           than a line. Each sheet keeps only its ink. */
        className={cn(BARE_ROW, 'flex items-center gap-2 px-3 py-2', `${part}-head`)}
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
