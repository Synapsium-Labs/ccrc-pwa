// One session as a compact two-line row: dot · label, ··· on the first line;
// state · tally · ⚠ · account on the second, all inside the same tap target.
// Fighting for one line's worth of horizontal room made every trailing cell
// a candidate for squeezing or hiding (see fleet.css's history on this file);
// a second line ends that fight — the label gets the row's full width and
// the meta cells never need a grid track, a container query, or an
// always-rendered-but-empty placeholder to stay aligned.
//
// Replaces SessionCard in the fleet list. Three things are cut rather than
// shrunk. The attention SENTENCE ("Claude is asking you something") becomes the
// amber dot plus the word `waiting` — same information at a glance, and the
// sentence earned its space on a card that was already large. The limit
// sentence becomes `⚠`, with the full text in the actions sheet where there is
// room to say what will happen. The dead-card long-press becomes an explicit
// sheet action: a hidden gesture is the wrong home for recovery, and a worse
// one for "Remove workspace".
//
// There is no `inGroup` prop. A line is always inside a project card now, so
// the conditional that made SessionCard mean two different things is gone.
import { useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { FleetSession, SessionBucket } from '../../../shared/api';
import { accountColorVar, accountLabel } from '../lib/accounts';
import { StatusDot } from '../components/StatusDot';
import { humanBytes } from '../screens/ArchiveScreen';
import { sessionLabel } from './sessionLabel';
import './fleet.css';

/** Routing policy calls a window critical above this. */
const CRITICAL = 75;

/** The ROW's state word for every bucket — the mono word beside the dot, and
 *  the only place this particular vocabulary is spelled out. Deliberately not
 *  exported: it has no reader outside this file, and an exported table invites
 *  a caller to retitle a surface it does not actually feed. `StatusDot` has
 *  its own glyph/label table (the two-glyph rule's other half) and
 *  `FleetScreen` its own section nouns — three vocabularies over one field,
 *  none of them deciding which bucket a session is in. */
const WORD: Record<SessionBucket, string> = {
  attention: 'waiting', working: 'working', done: 'done', idle: 'idle',
  cleanup: 'merged', archived: 'archived', dead: 'exited',
};

// Only ONE element may carry a given view-transition-name — a second aborts
// the transition entirely. The stamp is never cleared on navigation and these
// nodes are key-stable, so the previous holder has to be released here.
let stamped: HTMLElement | null = null;

export function SessionLine({
  session,
  onOpen,
  selected = false,
  onActions,
}: {
  session: FleetSession;
  onOpen: (id: string) => void;
  selected?: boolean; // the open session in the desktop sidebar
  onActions: (session: FleetSession) => void;
}): ReactNode {
  const dead = session.status === 'dead';
  // THE authority: no local re-derivation of attention/busy/state survives
  // here (nor in sortFleet.ts or groupFleet.ts) — the server decided which of
  // the seven buckets this session is in, and shipped it as `session.bucket`.
  const state = WORD[session.bucket];

  // The cleanup bucket's own facts — the merged PR number and the size
  // ws-archive measured, both already on the wire (`pr.number`,
  // `archivedBytes`). No destructive control lives here or ever will: the
  // actions sheet keeps the reap flow, with its audit, exactly as today.
  const cleanupFacts =
    session.bucket === 'cleanup'
      ? [
          session.pr?.number != null ? `#${session.pr.number}` : null,
          session.archivedBytes !== null ? humanBytes(session.archivedBytes) : null,
        ].filter((x): x is string => x !== null)
      : [];

  const label = sessionLabel(session);

  // Dead sessions stay silent about limits: they are meaningless when nothing runs.
  const five = session.limits?.five ?? null;
  const seven = session.limits?.seven ?? null;
  const critical = !dead && ((five !== null && five > CRITICAL) || (seven !== null && seven > CRITICAL));

  // The tapped label is the shared element of the line->chat view transition:
  // stamping the name here (only on the line being opened) pairs it with the
  // chat header's `view-transition-name: session-title` (session/chat.css:61).
  const labelRef = useRef<HTMLButtonElement>(null);
  const open = (): void => {
    const el = labelRef.current;
    if (el) {
      if (stamped !== null && stamped !== el) stamped.style.viewTransitionName = '';
      el.style.viewTransitionName = 'session-title';
      stamped = el;
    }
    onOpen(session.id);
  };

  // Identity stays in the name; a dead line's account drains to gray.
  const acctVar = accountColorVar(session.wrapper);
  // Inline styles beat every selector short of !important, so the account hue
  // has to be dropped HERE on the selected row: .sess-line--active's achromatic
  // override could never win against it, and the hue measures 1.46:1 on the
  // dark slab. The account survives as its mono name.
  const acctStyle: CSSProperties | undefined = selected
    ? undefined
    : dead
      ? { color: 'var(--ink-secondary)' }
      : { color: `var(${acctVar})` };

  // Running somewhere other than its pinned account — ccd's _auto_swap_check
  // moved it when `home` crossed the swap threshold. Dead sessions are exempt:
  // nothing is running, so "away" would describe a journey that ended.
  const away = !dead && session.wrapper !== session.home;

  return (
    <div className={selected ? 'sess-line sess-line--active' : 'sess-line'} data-state={state}>
      <span className="sess-lamp" data-status={session.bucket}>
        <StatusDot status={session.bucket} />
      </span>

      {/* Selection reached nothing but a className before this: there is no
          other aria-current in src. The row navigates to /s/<id>, so `page`
          is the correct token — this is not a listbox option. */}
      <button
        ref={labelRef}
        type="button"
        className="sess-open"
        aria-current={selected ? 'page' : undefined}
        onClick={open}
      >
        <span className="sess-label">{label}</span>

        {/* Second line: a quiet flex row, not a grid track — a missing cell
            (no tally, no warning) just isn't there, instead of needing to be
            rendered empty to hold a track open (that was only ever a grid
            requirement, and this is no longer a grid). */}
        <span className="sess-meta">
          <span className={`sess-state sess-state--${state}`}>{state}</span>

          {/* The cleanup bucket's merge facts — see `cleanupFacts` above.
              Two cells, not one: the shared `.sess-meta > *:not(:first-child)
              ::before` rule already punctuates siblings with `·`, so a merged
              PR's number and its reclaimable size read as their own cells,
              same as `.sess-tally`/`.sess-warn` below. */}
          {cleanupFacts.map((fact, i) => (
            <span key={`${session.id}-cleanup-${i}`} className="sess-cleanup-fact">{fact}</span>
          ))}

          {!dead && session.tasks !== null && (
            <span className="sess-tally">
              {session.tasks.done}/{session.tasks.total}
            </span>
          )}

          {/* Subagents the hook last reported running. `null` is no fresh hook
              data (same discipline as `hookState`); `[]` is a measurement —
              fresh data, nothing running — so both render nothing here. */}
          {!dead && session.subagents !== null && session.subagents.length > 0 && (
            <span
              className="sess-subagents"
              role="img"
              aria-label={`${session.subagents.length} subagent${session.subagents.length === 1 ? '' : 's'}`}
            >
              ⑂ {session.subagents.length}
            </span>
          )}

          {critical && (
            <span className="sess-warn" role="img" aria-label="account limit near">
              ⚠
            </span>
          )}

          <span
            className="sess-acct"
            style={acctStyle}
            data-away={away || undefined}
            aria-label={
              away
                ? `running on ${accountLabel(session.wrapper)}, pinned to ${accountLabel(session.home)}`
                : undefined
            }
          >
            {accountLabel(session.wrapper)}
            {away && (
              <span className="sess-acct-away" aria-hidden="true">
                ↗
              </span>
            )}
          </span>
        </span>

        {/* A third line, only while the hook is actually waiting on an answer
            AND a summary has landed for it (a hook can report waiting before
            the ask write completes — askSummary stays null until then). Clipped
            to one line like .sess-label; muted like .sess-acct's secondary
            role, one step further (.proj-dir's ink-tertiary convention). */}
        {!dead && session.hookState === 'waiting' && session.askSummary !== null && session.askSummary !== '' && (
          <span className="sess-ask">{session.askSummary}</span>
        )}
      </button>

      <button
        type="button"
        className="sess-actions"
        aria-label={`Actions for ${label}`}
        onClick={() => onActions(session)}
      >
        <span aria-hidden="true">···</span>
      </button>
    </div>
  );
}
