// "Since you were last here" on the Overlord's place (Overlord W1 home B, Task 6; spec §4.1; plan question 8). L4 (context C5):
// it reads, keeps and draws; `sinceLines` (L1) decides every line.
//
// IT READS ON MOUNT, once: the stamp first (`lastHere.ts`), then the two server reads the block is composed from
// (`GET /api/waiting` and `GET /api/programmes?since=`), each kept as an answer or a failure; the new stamp is written after
// the stamp was read, so the block is measured from the visit before this one. A read that failed, answered with something
// that is not its answer, or was refused is `failed`, and its lines say "unmeasured".
//
// CLASS NAMES for the place's one stylesheet: `ov-since` (the section), `ov-since-title`, `ov-since-lines` (a list with no
// markers, one line per row), `ov-since-line` (a row: the label above the text on a phone), `ov-since-label` (the section's
// name, secondary ink), `ov-since-text`, `ov-since-reading`. A line whose read failed carries `data-measured="false"`.
import { useEffect, useState, type ReactNode } from 'react';
import type { WaitingView } from '../../../shared/ledgers';
import { api } from '../lib/api';
import { isProgrammesAnswer } from '../screens/usePrograms';
import { readLastHere, writeLastHere } from './lastHere';
import { sinceLines, sinceOf, type SinceFacts } from './sinceWords';

export const SINCE_WORDS = { title: 'Since you were last here', reading: 'Reading…' } as const;

type Settled = { [K in keyof SinceFacts]: SinceFacts[K] | null };

const FAILED = { state: 'failed' } as const;

export function SincePart({ now = Date.now }: { readonly now?: () => number }): ReactNode {
  // Read first, written after: one read of the stamp and one clock reading per mount.
  const [visit] = useState(() => ({ lastHere: readLastHere(), nowMs: now() }));
  const [settled, setSettled] = useState<Settled>({ waiting: null, programmes: null });

  useEffect(() => {
    let live = true;
    const keep = <K extends keyof SinceFacts>(key: K, read: SinceFacts[K]): void => {
      if (live) setSettled((s) => ({ ...s, [key]: read }));
    };
    writeLastHere(visit.nowMs);
    api.waiting().then(
      (body): void => {
        // An answer without its list is not an answer (a proxy's page, an older shape): failed, never an empty list.
        const view = (body as { waiting?: WaitingView } | null)?.waiting;
        keep('waiting', view !== undefined && Array.isArray(view.items) ? { state: 'answered', value: view } : FAILED);
      },
      (): void => { keep('waiting', FAILED); },
    );
    api.programmes(sinceOf(visit.lastHere, visit.nowMs)).then(
      (body): void => { keep('programmes', isProgrammesAnswer(body) ? { state: 'answered', value: body } : FAILED); },
      (): void => { keep('programmes', FAILED); },
    );
    return () => { live = false; };
  }, [visit]);

  const { waiting, programmes } = settled;
  const lines = waiting === null || programmes === null ? null : sinceLines({ waiting, programmes }, visit.lastHere, visit.nowMs);
  return (
    <section className="ov-since" aria-label={SINCE_WORDS.title} data-overlord-since>
      <h2 className="ov-since-title">{SINCE_WORDS.title}</h2>
      {lines === null ? (
        <p className="ov-since-reading" role="status">{SINCE_WORDS.reading}</p>
      ) : (
        <ul className="ov-since-lines">
          {lines.map((l) => (
            <li key={l.key} className="ov-since-line" data-since-line={l.key} data-measured={l.measured}>
              <span className="ov-since-label">{l.label}</span>
              <span className="ov-since-text">{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
