// A run's trail (the runs rebuild, D-8072; spec 2026-11-04 §8.4, F16): every recorded event, newest first, as time, words
// and who. The words are `trailWords.ts`'s; the detail is shown as the server stored it, which has already passed the
// redaction profile. L4: it draws what it is given and decides nothing.
import type { ReactNode } from 'react';
import { Section } from '@ccrc/ui';
import type { RunRecordEvent } from '../../../shared/api';
import { runWhen } from '../fleet/runDetailWords';
import { olderEventsLine, trailBy, trailLine } from '../fleet/trailWords';

export function RunTrail({ events, olderEvents }: { events: readonly RunRecordEvent[]; olderEvents: number }): ReactNode {
  const older = olderEventsLine(olderEvents);
  return (
    <Section title="Trail" level={3} data-group="trail" className="rd-group">
      <ul className="rd-trail">
        {events.map((e, i) => (
          <li key={`${e.at}-${i}`} className="rd-trail-row" data-folded={e.folded === undefined ? undefined : 'true'}>
            {e.folded === undefined && <span className="rd-trail-time">{runWhen(e.at)}</span>}
            <span className="rd-trail-words">{trailLine(e, runWhen)}</span>
            <span className="rd-trail-by">{trailBy(e.by)}</span>
          </li>
        ))}
      </ul>
      {older !== null && <p className="rd-trail-older">{older}</p>}
    </Section>
  );
}
