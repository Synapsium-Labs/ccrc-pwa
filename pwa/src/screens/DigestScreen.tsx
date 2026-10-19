// The daily digest (coordinator-first routing spec 2026-10-17 §10, plan Task 17, D-5300): what coordinators decided in
// the operator's name over one UTC day's window, one line per decision, each correctable.
//
// The screen the daily `coord` push opens (`/digest?day=YYYY-MM-DD`), and the door to any past day: the server builds
// every day's digest from its durable tables, so a missed push loses nothing. A line's Correct opens a field under
// it; the sentence is mailed verbatim to that line's coordinator, and the server marks the row corrected, which is
// what the measurement counts as a wrong ruling.
//
// Every text a line carries was redacted by the server when it built the digest. It is the children's words, shown
// as text and never as markup.
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { BackButton, Button } from '@ccrc/ui';
import {
  DIGEST_CORRECTION_MAX_CHARS,
  type DigestAnswer, type DigestCorrectAnswer, type DigestCorrectBody, type DigestLine, type DigestLineKind,
} from '../../../shared/api';
import { api, ApiError, apiErrorText } from '../lib/api';
import { navigate } from '../lib/router';
import './digest.css';

const DAY_MS = 86_400_000;

/** The kind of a decision, in words (never in colour alone). */
export const DIGEST_KIND_WORD: Record<DigestLineKind, string> = {
  answer: 'answered', allow: 'allowed', deny: 'denied', 'hand-over': 'handed over', lapse: 'lapsed',
};

/** The wire guard: an answer this build can render, or null. */
export function asDigestAnswer(raw: unknown): DigestAnswer | null {
  if (raw === null || typeof raw !== 'object') return null;
  const d = raw as Partial<DigestAnswer>;
  if (d.v !== 1 || typeof d.day !== 'string' || !Array.isArray(d.lines) || d.totals === undefined
    || typeof d.fromMs !== 'number' || typeof d.toMs !== 'number') return null;
  const lines = d.lines.filter((l): l is DigestLine => l !== null && typeof l === 'object'
    && (l.rowKind === 'ask' || l.rowKind === 'approval') && typeof l.id === 'number'
    && typeof l.kind === 'string' && l.kind in DIGEST_KIND_WORD && typeof l.at === 'number'
    && typeof l.coordinator === 'string' && typeof l.childId === 'string' && typeof l.text === 'string');
  return { ...(d as DigestAnswer), lines };
}

/** `hh:mm UTC`: the digest's window is a UTC day, so its times are said in UTC too. */
export const utcClock = (ms: number): string => `${new Date(ms).toISOString().slice(11, 16)} UTC`;

const shiftDay = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** The totals line: what was decided, zeros left out, and the guard's refusals named apart (they are not lines). */
export function digestTotalsText(d: DigestAnswer): string {
  const t = d.totals;
  const parts = [`${t.decisions} ${t.decisions === 1 ? 'decision' : 'decisions'}`];
  for (const [n, w] of [[t.answers, 'answered'], [t.allows, 'allowed'], [t.denies, 'denied'], [t.handOvers, 'handed over'],
    [t.lapses, 'lapsed']] as const) if (n > 0) parts.push(`${n} ${w}`);
  if (t.guardForbidden > 0) parts.push(`${t.guardForbidden} refused by the guard`);
  return parts.join(' · ');
}

/** A correction refused, in words. */
function correctionError(err: unknown): string {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
    const word = (err.body as { error?: unknown }).error;
    if (word === 'not-coordinator') return 'No coordinator decided this line, so there is no one to correct.';
    if (word === 'duplicate') return 'Your last correction on this line has not been read yet.';
  }
  return apiErrorText(err);
}

type Load = (day?: string) => Promise<unknown>;
type Correct = (body: DigestCorrectBody) => Promise<DigestCorrectAnswer>;
const LOAD: Load = (day) => api.digest(day);
const CORRECT: Correct = (body) => api.correctDigest(body);

function DigestRow({ line, correct, onCorrected }: {
  line: DigestLine; correct: Correct; onCorrected: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = `${line.rowKind} ${line.id}`;
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (text.trim() === '' || busy) return;
    setBusy(true);
    setError(null);
    correct({ rowKind: line.rowKind, id: line.id, text })
      .then(() => { setOpen(false); setText(''); onCorrected(); })
      .catch((err: unknown) => setError(correctionError(err)))
      .finally(() => setBusy(false));
  };
  const detail = line.rowKind === 'ask'
    ? (line.answer !== null ? `answer: ${line.answer}` : null)
    : [line.tool, line.class, line.reason !== null ? `reason: ${line.reason}` : null].filter(Boolean).join(' · ');
  return (
    <li className="digest-row" data-kind={line.kind} data-corrected={line.corrected ? 'true' : 'false'}>
      <span className="digest-kind">{DIGEST_KIND_WORD[line.kind]}</span>
      <span className="digest-who">
        <span className="digest-coordinator">{line.coordinator}</span>
        <span className="digest-arrow" aria-hidden="true">{' → '}</span>
        <span className="sr-only">{' for '}</span>
        <span className="digest-child">{line.childId}</span>
      </span>
      <span className="digest-when">{utcClock(line.at)}</span>
      <p className="digest-text">
        <span className="digest-what">{line.rowKind === 'ask' ? 'question' : 'command'}</span>
        {line.text === '' ? <span className="digest-cleared">(text cleared after the retention period)</span> : line.text}
      </p>
      {detail !== null && detail !== '' && <p className="digest-detail">{detail}</p>}
      <div className="digest-actions">
        {line.corrected ? (
          <span className="digest-corrected">Correction sent</span>
        ) : !open ? (
          <Button variant="ghost" size="fit" aria-label={`Correct ${label}`} onClick={() => setOpen(true)}>Correct</Button>
        ) : null}
      </div>
      {open && !line.corrected && (
        <form className="digest-correct" onSubmit={submit} aria-label={`Correction for ${label}`}>
          <textarea
            className="digest-correct-input"
            aria-label={`What ${line.coordinator} should have done`}
            placeholder="What should it have decided? This is mailed to the coordinator as written."
            value={text}
            maxLength={DIGEST_CORRECTION_MAX_CHARS}
            rows={3}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
          />
          <div className="digest-correct-actions">
            <Button type="submit" variant="primary" size="fit" disabled={busy || text.trim() === ''}>
              {busy ? 'Sending…' : 'Send correction'}
            </Button>
            <Button variant="ghost" size="fit" disabled={busy} onClick={() => { setOpen(false); setError(null); }}>Cancel</Button>
          </div>
          {error !== null && <p className="digest-error" role="alert">{error}</p>}
        </form>
      )}
    </li>
  );
}

export function DigestScreen({ day, load = LOAD, correct = CORRECT }: {
  day: string | null; load?: Load; correct?: Correct;
}): ReactNode {
  const [digest, setDigest] = useState<DigestAnswer | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  const reload = useCallback(() => setGen((g) => g + 1), []);
  useEffect(() => {
    let live = true;
    setState((s) => (s === 'ok' ? s : 'loading'));
    load(day ?? undefined)
      .then((raw) => {
        if (!live) return;
        const d = asDigestAnswer(raw);
        if (d === null) { setState('error'); setError('This server answered in a shape this app cannot read.'); return; }
        setDigest(d);
        setState('ok');
      })
      .catch((err: unknown) => {
        if (!live) return;
        setState('error');
        setError(err instanceof ApiError && err.status === 501
          ? 'This server keeps no coordination record, so there is no digest.'
          : apiErrorText(err));
      });
    return () => { live = false; };
  }, [day, load, gen]);

  const shown = digest !== null && (day === null || digest.day === day) ? digest : null;
  const hasNext = shown !== null && shown.toMs + DAY_MS <= Date.now();
  return (
    <div className="digest-screen">
      <header className="digest-head">
        <BackButton className="digest-back" aria-label="Back to fleet" onClick={() => navigate('/')}>‹</BackButton>
        <h1 className="digest-title">Coordinator digest</h1>
      </header>
      {shown !== null && (
        <nav className="digest-days" aria-label="digest day">
          <Button variant="ghost" size="fit" aria-label="Previous day" onClick={() => navigate(`/digest?day=${shiftDay(shown.day, -1)}`)}>
            ‹ {shiftDay(shown.day, -1)}
          </Button>
          <span className="digest-day">{shown.day}</span>
          <Button variant="ghost" size="fit" aria-label="Next day" disabled={!hasNext}
                  onClick={() => navigate(`/digest?day=${shiftDay(shown.day, 1)}`)}>
            {shiftDay(shown.day, 1)} ›
          </Button>
        </nav>
      )}
      {shown === null ? (
        <p className="digest-empty" data-state={state === 'error' ? 'error' : 'loading'} role={state === 'error' ? 'alert' : undefined}>
          {state === 'error' ? `Could not read the digest: ${error ?? 'unknown error'}` : 'Loading…'}
        </p>
      ) : (
        <>
          <p className="digest-note">
            What coordinators decided in your name from {utcClock(shown.fromMs)} the day before to {utcClock(shown.toMs)}.
            Correct a line and your words are mailed to its coordinator.
          </p>
          <p className="digest-totals">{digestTotalsText(shown)}</p>
          {shown.byCoordinator.length > 1 && (
            <ul className="digest-coordinators" aria-label="decisions by coordinator">
              {shown.byCoordinator.map((c) => (
                <li key={c.coordinator} className="digest-coordinator-count">{c.coordinator} · {c.decisions}</li>
              ))}
            </ul>
          )}
          {shown.lines.length === 0 ? (
            <p className="digest-empty" data-state="ok">Coordinators decided nothing in your name in this window.</p>
          ) : (
            <ul className="digest-list">
              {shown.lines.map((l) => (
                <DigestRow key={`${l.rowKind}-${l.id}`} line={l} correct={correct} onCorrected={reload} />
              ))}
            </ul>
          )}
          {state === 'error' && error !== null && <p className="digest-error" role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}
