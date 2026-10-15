// PoolList — every roster pool, then "no pool".
//
// THE BLOCK THAT ARGUED FOR THE MARKUP CENSUS. `.pool-row` is one rule in
// fleet.css, correctly shared by both pool sheets, and the twenty lines of
// markup around it were written out twice. The stylesheet census saw one rule
// and said nothing; a reader asked why `.pool-row` had been skipped and the
// honest answer was that no mechanism could see it. This is the first thing
// the mechanism found.
//
// ROSTER-DERIVED OPTIONS ONLY, which is fleet.css's own note on `.pool-list`:
// a free-text pool with no member would strand every constrained session. The
// one place a pool is NAMED is `AccountPoolSheet`'s own field below this list,
// and that field is not part of this shape.
//
// `noneLabel` IS A PROP BECAUSE THE TWO SHEETS MEAN DIFFERENT THINGS BY IT.
// Clearing a PROJECT's tag means every account may serve it; clearing an
// ACCOUNT's means this box defers to the roster's declared default. Same row,
// two sentences, and the sentence is what a screen reader reads out — so it
// is the caller's, not this component's.
import type { ReactNode } from 'react';

export interface PoolListProps {
  /** The pools on offer, in the order the caller wants them read. */
  options: string[];
  /** `null` is the "no pool" row. */
  onPick: (pool: string | null) => void;
  /** The "no pool" row's aria-label — see the header. */
  noneLabel: string;
  /** `PoolSheet` locks the list while a write is in flight; `AccountPoolSheet`
   *  does not, because its write is optimistic. */
  disabled?: boolean;
}

export function PoolList({ options, onPick, noneLabel, disabled = false }: PoolListProps): ReactNode {
  return (
    <div className="pool-list">
      {options.map((name) => (
        <button
          key={name}
          type="button"
          className="pool-row"
          disabled={disabled}
          aria-label={`pool ${name}`}
          onClick={() => onPick(name)}
        >
          {name}
        </button>
      ))}
      <button
        type="button"
        className="pool-row"
        data-none="true"
        disabled={disabled}
        aria-label={noneLabel}
        onClick={() => onPick(null)}
      >
        no pool
      </button>
    </div>
  );
}
