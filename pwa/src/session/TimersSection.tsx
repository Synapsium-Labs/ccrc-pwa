// The operator's view of one session's timers (Overlord W1a, timers PR E, Task 13; spec §3.3.12 C61 to C65, Table 11.1e).
// L4: it reads `GET /api/sessions/:id/timers`, cancels through `POST /api/sessions/:id/timers/:timerId/cancel`, and renders
// what `timersWords.ts` decides. The session page shows it under the transcript, only while it has something to say (quiet:
// no line for a session with no timers, as the workflow strip); the run page shows it for the run's worker and its
// coordinator, always.
//
// Each timer shows its due time, how long until then, its run or programme, and its note as data: a quoted, muted block
// under "The session's own note, not an instruction", rendered as text, so a note with markup stays text. A cancel that
// answers `timer-not-pending` or `timer-not-found` reads the list again and says the timer had already fired, been
// cancelled or gone. A failed read says so, never "No pending timers."
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, SECTION_PURPOSE, Section, useNow } from '@ccrc/ui';
import { api } from '../lib/api';
import { onPageVisible } from '../lib/pageClock';
import {
  TIMERS_WORDS, cancelOutcome, readTimers, timerBinding, timerDueLine, type TimerRow, type TimersRead,
} from './timersWords';

const LIST = 'm-0 grid list-none gap-3 p-0';
const ROW = 'grid min-w-0 gap-1';
const ROW_HEAD = 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1';
const ROW_FACTS = 'm-0 min-w-0 text-meta text-ink-primary';
const NOTE_LABEL = 'm-0 text-2xs uppercase tracking-caps text-ink-tertiary';
const NOTE = 'm-0 whitespace-pre-wrap border-l-2 border-edge-subtle pl-3 text-meta text-ink-secondary [overflow-wrap:anywhere]';
// A state line or a notice: the design system's one-sentence line, never a second spelling of it (the literal census).
const STATUS = SECTION_PURPOSE;

function TimerItem({ t, nowMs, busy, onCancel }: {
  t: TimerRow; nowMs: number; busy: boolean; onCancel: (id: number) => void;
}): ReactNode {
  const id = t.id;
  return (
    <li className={ROW} data-timer={id ?? undefined}>
      <div className={ROW_HEAD}>
        <p className={ROW_FACTS}>{`${timerDueLine(t, nowMs)} · ${timerBinding(t)}`}</p>
        {id !== null && (
          <Button variant="ghost" size="fit" disabled={busy} aria-label={`Cancel timer ${id}`} onClick={() => onCancel(id)}>
            {busy ? TIMERS_WORDS.cancelling : TIMERS_WORDS.cancel}
          </Button>
        )}
      </div>
      <p className={NOTE_LABEL}>{TIMERS_WORDS.noteLabel}</p>
      <blockquote className={NOTE}>{t.note ?? TIMERS_WORDS.noteUnread}</blockquote>
    </li>
  );
}

export function TimersSection({ sessionId, title = TIMERS_WORDS.title, quiet = false, className }: {
  sessionId: string;
  title?: string;
  /** The session page's mode: nothing at all while the read is in flight or lists no timer. */
  quiet?: boolean;
  className?: string;
}): ReactNode {
  const [read, setRead] = useState<TimersRead>({ kind: 'loading' });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  // The newest read wins: a read started for another session, or before a newer one, lands nowhere.
  const seq = useRef(0);
  const load = useCallback((): void => {
    const mine = ++seq.current;
    // Through `then`, so a client without the call (an older build's stub) is an unread read, never a throw.
    Promise.resolve().then(() => api.sessionTimers(sessionId)).then(
      (body) => { if (seq.current === mine) setRead(readTimers(body)); },
      () => { if (seq.current === mine) setRead({ kind: 'unread' }); },
    );
  }, [sessionId]);
  useEffect(() => {
    setRead({ kind: 'loading' });
    setNotice(null);
    load();
    const stop = onPageVisible(load);
    return () => { seq.current += 1; stop(); };
  }, [load]);
  const listed = read.kind === 'listed' ? read.timers : [];
  const nowMs = useNow(30_000, listed.length > 0);

  const cancel = useCallback((timerId: number): void => {
    setBusy(timerId);
    setNotice(null);
    Promise.resolve().then(() => api.cancelSessionTimer(sessionId, timerId)).then(
      () => { setBusy(null); load(); },
      (err: unknown) => {
        setBusy(null);
        const outcome = cancelOutcome(err);
        setNotice(outcome.kind === 'gone' ? TIMERS_WORDS.gone : outcome.text);
        if (outcome.kind === 'gone') load();
      },
    );
  }, [sessionId, load]);

  const silent = read.kind === 'loading' || (read.kind === 'listed' && listed.length === 0);
  const stateLine = read.kind === 'loading' ? TIMERS_WORDS.loading
    : read.kind === 'unread' ? TIMERS_WORDS.unread
      : listed.length === 0 ? TIMERS_WORDS.empty : null;
  if (quiet && silent && notice === null) return null;
  return (
    <Section title={title} level={3} className={className} data-timers={sessionId}>
      {stateLine !== null && <p className={STATUS} role="status">{stateLine}</p>}
      {listed.length > 0 && (
        <ul className={LIST}>
          {listed.map((t, i) => (
            <TimerItem key={t.id ?? `unread-${i}`} t={t} nowMs={nowMs} busy={busy !== null && busy === t.id} onCancel={cancel} />
          ))}
        </ul>
      )}
      {notice !== null && <p className={STATUS} aria-live="polite">{notice}</p>}
    </Section>
  );
}
