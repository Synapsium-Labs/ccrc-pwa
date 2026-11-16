// The project picker's frame — search, load state, and the empty sentence.
//
// WHY IT EXISTS. `NewSessionSheet` and `StartProgramSheet` both pick a
// project, and both wrote this frame out: the same search field, the same
// three-arm load state, and the same sentence when nothing matches. The
// markup census paired neither, because what sits INSIDE the list genuinely
// differs — one splits in-pool from other-pool behind a disclosure, the other
// shows each row's program readiness — and an exact structural match cannot
// see a shared frame around two different contents.
//
// SO THE FRAME IS THE COMPONENT AND THE ROWS ARE `children`. That is the
// honest seam: the two sheets disagree about rows and agree about everything
// around them.
//
// THE COPY IS THE POINT, more than the lines. "Couldn't load the project
// list — …" and `No project matches "…"` were each written twice, and copy
// written twice drifts in a way no type catches — the same argument
// `TerminalCta` records for its two buttons.
//
// THREE ARMS, NOT TWO. `list === null && listError === null` is loading;
// `listError !== null` is a failure the operator can read; anything else is
// an answer, even an empty one. Collapsing the first two would render the
// skeleton forever on a fleet whose project list cannot be read.
import type { ReactNode } from 'react';
import { Skeleton, TextInput, TEXT_INPUT_STACKED } from '@ccrc/ui';
import './fleet.css';

export interface ProjectPickerProps {
  query: string;
  onQuery: (query: string) => void;
  /** `null` until the list lands. */
  /** The rows themselves are not read here — only whether they ARRIVED. The
   *  type is `readonly` because the single reader (`useProjectList`) hands back
   *  a frozen view, and an adapter may not widen what it received. */
  list: readonly unknown[] | null;
  /** The read's own failure sentence, or `null`. */
  listError: string | null;
  /** The list loaded and nothing in it matches `query`. The caller decides
   *  this because the two sheets count different things: one counts its two
   *  pool buckets together, the other its single filtered array. */
  empty: boolean;
  /** The rows, and whatever else belongs inside the list — the pool
   *  disclosure, the unknown-pool note. */
  children: ReactNode;
}

export function ProjectPicker(
  { query, onQuery, list, listError, empty, children }: ProjectPickerProps,
): ReactNode {
  return (
    <>
      <TextInput
        className={TEXT_INPUT_STACKED}
        type="search"
        placeholder="Search projects"
        aria-label="Search projects"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      {list === null && listError === null ? (
        <Skeleton lines={4} className="proj-skel" />
      ) : listError !== null ? (
        <p className="proj-error" role="alert">
          Couldn't load the project list — {listError}
        </p>
      ) : (
        <div className="proj-list">
          {children}
          {empty && <p className="proj-none">No project matches "{query}"</p>}
        </div>
      )}
    </>
  );
}
