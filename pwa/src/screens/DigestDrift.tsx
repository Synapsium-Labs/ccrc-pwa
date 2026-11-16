// The digest's "Out of step" section (D-5923; plan Task DT4, D-5924; spec 2026-10-20 §4.5, §4.6): the drift reconciler's
// findings open at the window's end, under the decisions and never counted as one. A line is a glance: the kind in words,
// the ids it names, how long it has stood. Its target is the Inbox target model's (`inboxTarget`, P4a): the line is adapted
// to that model's input, a `NotifyEvent` carrying its own `sessionId` and `runId`, so the rule is P4a's and not a copy.
// A line with a target is a row that opens it (`/s/<id>` or `/runs/<id>`); one without says why in a quiet word and is no
// control. No sheet opens from here and no route is added: the remedy lives where the target is.
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { ListRow } from '@ccrc/ui';
import type { DigestAnswer, DriftLine, FleetSession, NotifyEvent, RunSummary } from '../../../shared/api';
import { driftKindWord, driftSubjectText, driftTotalsText } from '../fleet/driftWords';
import { inboxTarget } from '../fleet/inboxTarget';
import { stuckAge } from '../fleet/stuckWords';
import { navigate } from '../lib/router';
import type { FleetStore } from '../stores/fleet';

/** The line as the target model's input: its own session and run, nothing else read. */
const asEvent = (l: DriftLine): NotifyEvent =>
  ({ seq: 0, at: 0, kind: 'coord', sessionId: l.sessionId ?? '', title: '', body: '', runId: l.runId });

/** The glance's three words, one place: the row draws them and its button is named by them. */
const glanceWords = (l: DriftLine): readonly [string, string, string] =>
  [driftKindWord(l.kind), driftSubjectText(l.subject), `for ${stuckAge(0, l.ageMs)}`];

function Glance({ line, why }: { line: DriftLine; why: string | null }): ReactNode {
  const [kind, subject, age] = glanceWords(line);
  return (
    <span className="digest-drift-glance">
      <span className="digest-drift-kind">{kind}</span>
      <span className="digest-drift-subject">{subject}</span>
      <span className="digest-drift-age">{age}</span>
      {why !== null && <span className="digest-drift-why">{why}</span>}
    </span>
  );
}

/** `until` is the window's end in words (`hh:mm UTC`), as the screen says its own times. */
export function DigestDrift({ drift, until, store }: {
  drift: NonNullable<DigestAnswer['drift']>; until: string; store: FleetStore;
}): ReactNode {
  const sessions = store((s) => s.sessions);
  const runs = store((s) => s.runs);
  const sessionsById = useMemo<ReadonlyMap<string, FleetSession>>(
    () => new Map(sessions.map((s) => [s.id, s] as const)), [sessions]);
  const runsById = useMemo<ReadonlyMap<number, Pick<RunSummary, 'id'>>>(
    () => new Map(runs.map((r) => [r.id, r] as const)), [runs]);
  const totals = driftTotalsText(drift.totals);
  return (
    <section className="digest-drift" aria-labelledby="digest-drift-title">
      <h2 className="digest-drift-title" id="digest-drift-title">Out of step</h2>
      <p className="digest-drift-note">Still open at {until}. Not decisions: each opens where its remedy lives.</p>
      {totals !== '' && <p className="digest-drift-totals">{totals}</p>}
      <ul className="digest-drift-list">
        {drift.lines.map((l) => {
          const to = inboxTarget(asEvent(l), sessionsById, runsById);
          return (
            <li key={l.key} className="digest-drift-line" data-kind={l.kind}>
              {to.kind === 'none' ? (
                <div className="digest-drift-still"><Glance line={l} why={to.why} /></div>
              ) : (
                <ListRow className="digest-drift-open" aria-label={glanceWords(l).join(' · ')} onClick={() => navigate(to.path)}>
                  <Glance line={l} why={null} />
                </ListRow>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
