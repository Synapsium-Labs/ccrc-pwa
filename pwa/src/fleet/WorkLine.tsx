// One line of words, each a cell, its detail in `title`: the row a project card draws for work it holds, the fleet
// foot's region draws for work whose session is not listed, and the session header draws for each recorded entry.
// ONE spelling of that markup, so the three surfaces cannot drift apart. The words are the caller's, decided by the
// words module; this file draws them and decides nothing, `nameAt` included: the words module names the one part a
// narrow row may cut short (D-7783), and this file only gives that part its class and the box its text is cut in.
import type { ReactNode } from 'react';
import './fleet.css';

export function WorkLine({ parts, title, nameAt = null, children = null }: {
  parts: readonly string[];
  title: string;
  /** The index of the one part that may end in an ellipsis on a narrow row; every other part is drawn whole. */
  nameAt?: number | null;
  /** Chips drawn after the words (a worktree's markers), or nothing. */
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="proj-work" title={title}>
      <span className="proj-work-parts">
        {/* The name's text sits in a box of its own, which alone clips and ends in the ellipsis: the part itself, which
            draws the separator before it, stays under no clip in any engine (D-7783, review 1435 F1). */}
        {parts.map((p, i) => (i === nameAt
          ? <span key={i} className="proj-work-part proj-work-name"><span className="proj-work-name-text">{p}</span></span>
          : <span key={i} className="proj-work-part">{p}</span>))}
      </span>
      {children}
    </div>
  );
}
