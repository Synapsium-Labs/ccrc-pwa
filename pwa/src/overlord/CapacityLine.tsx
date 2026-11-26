// The capacity line on the Overlord's place (Overlord W1 home B, Task 6; plan question 6, slug `runway-read-is-serviceabilitys`).
// L4 (context C5): it reads `GET /api/pools/runway` once on mount, keeps it as a `ReadState` through `nextReadState`, and draws
// what `capacityView` (L1) answers. It decides nothing: a read that is absent (404) or still loading draws NOTHING, a failure
// draws "Capacity unmeasured", and every sentence is `runwayWords.ts`'s.
//
// CLASS NAMES for the place's one stylesheet: `ov-capacity` (the section), `ov-capacity-title`, `ov-capacity-note` (the stale
// note and the unmeasured sentence), `ov-capacity-pools` (a list with no markers), `ov-capacity-pool` (a row: the pool above
// its two sentences on a phone), `ov-capacity-name`, `ov-capacity-runway`, `ov-capacity-reset`.
import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, ApiTimeout } from '../lib/api';
import { nextReadState, type ReadOutcome } from './readOutcome';
import type { ReadState } from './readState';
import { CAPACITY_WORDS, capacityView } from './runwayWords';
import type { PoolRunwayWire } from '../../../shared/loadLines';

/** A failure's words, as the line prints them. */
function failureWords(err: unknown): string {
  if (err instanceof ApiError) return `HTTP ${err.status}`;
  if (err instanceof ApiTimeout) return 'timeout';
  return err instanceof Error ? err.message : String(err);
}

async function readRunway(): Promise<ReadOutcome<PoolRunwayWire>> {
  try {
    const body = await api.poolRunway();
    if ('absent' in body) return { kind: 'absent' };
    // A 2xx body without its list is not an answer: a failure the line prints, never an empty list.
    return Array.isArray(body.pools) && typeof body.nowS === 'number' ? { kind: 'value', value: body } : { kind: 'failed', error: 'unreadable answer' };
  } catch (err) {
    return { kind: 'failed', error: failureWords(err) };
  }
}

export function CapacityLine({ now = Date.now }: { readonly now?: () => number }): ReactNode {
  const [read, setRead] = useState<ReadState<PoolRunwayWire>>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    void readRunway().then((outcome) => {
      if (live) setRead((prev) => nextReadState(prev, outcome, now()));
    });
    return () => { live = false; };
  }, [now]);

  const view = capacityView(read);
  if (view.kind === 'hidden') return null;
  return (
    <section className="ov-capacity" aria-label={CAPACITY_WORDS.title} data-overlord-capacity>
      <h2 className="ov-capacity-title">{CAPACITY_WORDS.title}</h2>
      {view.kind === 'unmeasured' ? (
        <p className="ov-capacity-note" data-capacity="unmeasured">{view.text}</p>
      ) : (
        <>
          {view.stale !== null && <p className="ov-capacity-note" data-capacity="stale">{view.stale}</p>}
          {view.pools.length === 0 ? (
            <p className="ov-capacity-note">{CAPACITY_WORDS.noPools}</p>
          ) : (
            <ul className="ov-capacity-pools">
              {view.pools.map((p) => (
                <li key={p.key} className="ov-capacity-pool" data-capacity-pool>
                  <span className="ov-capacity-name">{p.pool}</span>
                  <span className="ov-capacity-runway">{p.runway}</span>
                  <span className="ov-capacity-reset">{p.reset}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
