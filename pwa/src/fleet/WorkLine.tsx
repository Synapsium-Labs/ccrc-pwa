// One line of words, each a cell, its detail in `title`: the row a project card draws for work it holds, the fleet
// foot's region draws for work whose session is not listed, and the session header draws for each recorded entry.
// ONE spelling of that markup, so the three surfaces cannot drift apart. The words are the caller's, decided by the
// words module; this file draws them and decides nothing, `nameAt` included: the words module names the one part a
// narrow row may cut short (D-7783), and this file only gives that part its class.
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
        {parts.map((p, i) => <span key={i} className={i === nameAt ? 'proj-work-part proj-work-name' : 'proj-work-part'}>{p}</span>)}
      </span>
      {children}
    </div>
  );
}
