// The run board's "Waiting on you" band (D-6911, #1410): every open work run whose review cap's ask is raised. A run
// not yet lifted carries the Lift cap door, which hands the run to the board's one `LiftCapSheet`; a lifted run says
// when it was lifted, until the run closes. On a band, not on the run card, because `RunRow.tsx` was under another
// wave's claim when this shipped (D-6911); a later wave may move the door onto the card.
import type { ReactNode } from 'react';
import type { RunSummary } from '../../../shared/api';
import { Button } from '@ccrc/ui';
import { formatAge } from './formatReset';
import { capWaiting, reviewCapOf } from './reviewCapWords';
import './fleet.css';

export function ReviewCapBand({ runs, nowMs, onLift }: {
  runs: readonly RunSummary[];
  nowMs: number;
  onLift: (run: RunSummary) => void;
}): ReactNode {
  const entries = runs.flatMap((run) => {
    const waiting = capWaiting(run);
    const cap = reviewCapOf(run);
    return waiting === null || cap === null || cap === 'unmeasured' ? [] : [{ run, waiting, cap }];
  });
  if (entries.length === 0) return null;
  return (
    <div className="review-cap-band" role="group" aria-label="Waiting on you">
      <p className="review-cap-band-head">Waiting on you</p>
      <ul className="review-cap-band-list">
        {entries.map(({ run, waiting, cap }) => (
          <li key={run.id} className="review-cap-band-row">
            {waiting === 'waiting' ? (
              <>
                <span>{`Run ${run.id} · ${run.programTitle} wave ${run.wave}: review cap reached, ${cap.rounds} of ${cap.cap} rounds`}</span>
                <Button variant="primary" size="fit" className="text-xs leading-none" onClick={() => onLift(run)}>
                  Lift cap
                </Button>
              </>
            ) : (
              <span>{`Run ${run.id}: review cap lifted ${formatAge(cap.liftedAt === null ? null : Math.floor((nowMs - cap.liftedAt) / 1000))}`}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
