// The operator's view of one session's timers (Overlord W1a, timers PR E, Task 13; spec §3.3.12 C61 to C65, Table 11.1e).
// L4: it reads `GET /api/sessions/:id/timers`, cancels through `POST /api/sessions/:id/timers/:timerId/cancel`, and renders
// what `timersWords.ts` decides. The session page shows it under the transcript, only while it has something to say (quiet:
// no line for a session with no timers, as the workflow strip); the run page shows it for the run's worker and its
// coordinator, always. A row the Overlord's role holds says "Overlord's"; an answer that could not read the Overlord's
// timers says so in one sentence.
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

function TimerItem({ t, nowMs, busy, locked, onCancel }: {
  /** `busy`: this row's cancel is in flight. `locked`: some cancel is (review 2060 F1). */
  t: TimerRow; nowMs: number; busy: boolean; locked: boolean; onCancel: (id: number) => void;
}): ReactNode {
  const id = t.id;
  return (
    <li className={ROW} data-timer={id ?? undefined}>
      <div className={ROW_HEAD}>
        <p className={ROW_FACTS}>
          {`${timerDueLine(t, nowMs)} · ${timerBinding(t)}`}
          {t.owner === 'overlord' && <span className="ml-2 text-ink-secondary" data-timer-owner="overlord">{TIMERS_WORDS.overlordOwner}</span>}
        </p>
        {id !== null && (
          <Button
            variant="ghost" size="fit" disabled={locked} aria-busy={busy} aria-label={`Cancel timer ${id}`} onClick={() => onCancel(id)}
          >
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
  // The newest read or cancel wins: one started for another session, or before a newer one, lands nowhere (review 2060 F2).
  const seq = useRef(0);
  // The cancel in flight, if any: one at a time across the section (review 2060 F1). A ref, so a second tap in the same
  // render is refused before any state has moved.
  const inFlight = useRef<number | null>(null);
  // A notice survives the one read that follows it (the re-read after a cancel), so the operator sees it; the next
  // successful read clears it (review 2060 F3).
  const keepNotice = useRef(false);
  const load = useCallback((): void => {
    const mine = ++seq.current;
    // Through `then`, so a client without the call (an older build's stub) is an unread read, never a throw.
    Promise.resolve().then(() => api.sessionTimers(sessionId)).then(
      (body) => {
        if (seq.current !== mine) return;
        setRead(readTimers(body));
        if (keepNotice.current) keepNotice.current = false;
        else setNotice(null);
      },
      () => { if (seq.current === mine) setRead({ kind: 'unread' }); },
    );
  }, [sessionId]);
  useEffect(() => {
    setRead({ kind: 'loading' });
    setNotice(null);
    setBusy(null);
    inFlight.current = null;
    keepNotice.current = false;
    load();
    // A cancel in flight reads the list itself when it answers; a read beside it would drop that answer.
    const stop = onPageVisible(() => { if (inFlight.current === null) load(); });
    return () => { seq.current += 1; stop(); };
  }, [load]);
  const listed = read.kind === 'listed' ? read.timers : [];
  const nowMs = useNow(30_000, listed.length > 0);

  const cancel = useCallback((timerId: number): void => {
    if (inFlight.current !== null) return;
    inFlight.current = timerId;
    const mine = ++seq.current;
    setBusy(timerId);
    setNotice(null);
    keepNotice.current = false;
    const done = (): boolean => {
      if (seq.current !== mine) return false;
      inFlight.current = null;
      setBusy(null);
      return true;
    };
    Promise.resolve().then(() => api.cancelSessionTimer(sessionId, timerId)).then(
      () => { if (done()) load(); },
      (err: unknown) => {
        if (!done()) return;
        const outcome = cancelOutcome(err);
        keepNotice.current = outcome.kind === 'gone';
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
      {read.kind === 'listed' && read.overlordTimers === 'unmeasured' && <p className={STATUS}>{TIMERS_WORDS.overlordUnmeasured}</p>}
      {listed.length > 0 && (
        <ul className={LIST}>
          {listed.map((t, i) => (
            <TimerItem
              key={t.id ?? `unread-${i}`} t={t} nowMs={nowMs} busy={busy !== null && busy === t.id} locked={busy !== null} onCancel={cancel}
            />
          ))}
        </ul>
      )}
      {/* Mounted empty, so a notice that arrives is announced (review 2060 F3). */}
      <p className={STATUS} aria-live="polite">{notice ?? ''}</p>
    </Section>
  );
}
