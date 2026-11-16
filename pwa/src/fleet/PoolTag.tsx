// A pool membership, as one chip.
//
// TWO RENDERERS, ONE SENTENCE — and that is the whole reason this exists.
// `AccountRow` tags an ACCOUNT's pool and `NewSessionSheet`'s project row
// tags a PROJECT's, and the two had the same four lines each: the same class,
// the same `pool · <name>` label used as BOTH the accessible name and the
// title, and the same "quiet when there is nothing to say" rule. A label
// written twice drifts in a way no type catches (`TerminalCta`'s own argument,
// one screen over).
//
// THE GUARD IS THE STRICTER OF THE TWO, measured rather than chosen: the
// account side refused `''` as well as absence, the project side refused only
// absence — and a `''` there would have rendered the bare words "pool · " with
// no name. It is unreachable either way (the project side's name comes from a
// `tagged` wire state, whose name is validated against `POOL_NAME_RE`, and the
// account side's from the roster), so taking the stricter one moves no pixels.
//
// The class stays `acct-pool`: fleet.css grounds it, and `fleet-css.test.ts`
// pins both the base rule and the selected-row override. The shape moves, the
// ground stays.
import type { ReactNode } from 'react';
import './fleet.css';

export function PoolTag({ pool }: { pool: string | null | undefined }): ReactNode {
  if (pool === null || pool === undefined || pool === '') return null;
  const label = `pool · ${pool}`;
  return (
    <span className="acct-pool" aria-label={label} title={label}>
      {label}
    </span>
  );
}
