// One line of words, each a cell, its detail in `title`: the row the session's own page draws for each worktree (its section);
// a project card and the fleet list draw none (D-8782).
// ONE spelling of that markup, so the surfaces cannot drift apart. The words are the caller's, decided by the words module;
// this file draws them and decides nothing, `nameAt` included: the words module names the one free-text part, the path, the
// formatters say where it may break (`pathBreaks`, `lib/format.ts`), and this file gives that part its class and draws each
// piece as a box of its own (`.proj-work-seg`), so the line breaks between pieces and inside one only when it is wider than
// the line (session helpers HF2, D-8877; review 3123 F3).
import type { ReactNode } from 'react';
import { pathBreaks } from '../lib/format';
import './fleet.css';

export function WorkLine({ parts, title, nameAt = null, children = null }: {
  parts: readonly string[];
  title: string;
  /** The index of the one free-text part (the path), which wraps at its break points; every part is drawn whole. */
  nameAt?: number | null;
  /** Chips and controls drawn after the words (a worktree's markers and its controls), or nothing. */
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="proj-work" title={title}>
      <span className="proj-work-parts">
        {/* The name's text sits in a box of its own (D-7783, review 1435 F1): the part itself draws the separator before it. */}
        {parts.map((p, i) => (i === nameAt
          ? (
            <span key={i} className="proj-work-part proj-work-name">
              <span className="proj-work-name-text">
                {pathBreaks(p).map((piece, k) => <span key={k} className="proj-work-seg">{piece}</span>)}
              </span>
            </span>
          )
          : <span key={i} className="proj-work-part">{p}</span>))}
      </span>
      {children}
    </div>
  );
}
