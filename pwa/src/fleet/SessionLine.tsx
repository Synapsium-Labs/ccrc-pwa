// One session as a compact two-line row: dot · label, ··· on the first line;
// state · tally · ⚠ · account on the second, all on the same tap surface.
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
import { useId, useRef, useState } from 'react';
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

/** '<1m' | '5m' | '3h' | '2d' since a subagent's hook-reported `startedAt`.
 *  Same shape as PrKeycap's `rel()` (a PR's age) — reimplemented locally for
 *  the same reason that file gives: there is no shared time-formatting
 *  module yet to import from. Unlike `rel()`, this never returns null: a
 *  subagent row always shows SOME elapsed time, even a fresh one. */
function subagentElapsed(startedAt: number): string {
  const m = Math.floor(Math.max(0, Date.now() - startedAt) / 60_000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

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

  // Dead sessions stay silent about subagents too, same reasoning as limits
  // above: nothing is running, so a hook-reported roster from before the
  // exit would describe work that no longer exists. `null` is no fresh hook
  // data (same discipline as `hookState`); `[]` is a measurement — fresh
  // data, nothing running — so both leave nothing to disclose below. Left as
  // `FleetSession['subagents'] | null` rather than hoisted into a plain
  // boolean so every read of it stays a real `!== null` narrowing TS can
  // verify, not a second, disconnected flag that could drift from it.
  const subagentList = dead ? null : session.subagents;
  const [subagentsOpen, setSubagentsOpen] = useState(false);
  // Names the region the toggle owns, so `aria-expanded` is about something a
  // screen reader can then be taken to — the same useId + aria-controls
  // pairing DialogSheet's `OptionPreview` uses, including its conditional
  // render of the controlled element.
  const subagentsId = useId();

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

      {/* The two-line block. A plain <div>, NOT the row's button: the subagent
          disclosure below is a real <button>, and a control inside a control
          is both invalid and unusable. Invalid because a <button>'s content
          model forbids ANY descendant with a tabindex attribute, interactive
          element or not — a `role="button"` span with `tabIndex={0}` (what fix
          round 1 shipped here) is exactly that. Unusable because the `button`
          role is Children-Presentational: Safari/VoiceOver exposes the whole
          subtree as ONE element, so the inner control is never a swipe stop,
          its `aria-expanded` is never announced, and a double-tap activates
          the ANCESTOR — i.e. this feature was unreachable on iOS, while RTL's
          `getByRole` (which does not model presentational children) reported
          a healthy button.

          The row keeps its full-block tap surface anyway. This div's onClick
          is a CONVENIENCE forwarder for the dead space between cells (the
          meta line's gaps, the ask line) and it stands down whenever a real
          control was hit: `closest('button')` is the whole guard. One place,
          it covers every control this row ever grows, and it covers keyboard
          activation for free — Enter/Space on a <button> dispatches a click
          that bubbles here exactly as a tap does, so the toggle needs no
          `stopPropagation` and no hand-rolled key handler of its own. */}
      <div
        className="sess-body"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button') !== null) return;
          open();
        }}
      >
        {/* Selection reached nothing but a className before this: there is no
            other aria-current in src. The row navigates to /s/<id>, so `page`
            is the correct token — this is not a listbox option. Still the
            element that carries the view-transition stamp, so chat.css's
            `view-transition-name: session-title` and shell.css's desktop
            opt-out both keep naming `.sess-open` and neither had to move. */}
        <button
          ref={labelRef}
          type="button"
          className="sess-open"
          aria-current={selected ? 'page' : undefined}
          onClick={open}
        >
          <span className="sess-label">{label}</span>
        </button>

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

          {/* The subagent tally, now a disclosure — see `subagentList` above
              for the null-vs-empty-array discipline. Tapping it opens
              `.sess-subagent-list` below with each one's name and elapsed
              time; nothing more, because that's all Claude's own
              SubagentStart/Stop hooks ever hand the server (no
              working/blocked signal to source an Orca-style glyph from —
              StatusDot's dot vocabulary has no counterpart for a subagent
              row). A REAL `<button>`, with native Enter/Space activation and
              no key handler of its own — see `.sess-body`'s comment above for
              why the row's own control had to stop being this one's
              ancestor. */}
          {subagentList !== null && subagentList.length > 0 && (
            <button
              type="button"
              className="sess-subagents"
              aria-expanded={subagentsOpen}
              aria-controls={subagentsId}
              aria-label={`${subagentList.length} subagent${subagentList.length === 1 ? '' : 's'}`}
              onClick={() => setSubagentsOpen((o) => !o)}
            >
              ⑂ {subagentList.length}
            </button>
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

        {/* The disclosure's own content, open only once the toggle above has
            been tapped, and the element its `aria-controls` names. A real
            `<ul>/<li>`, not `role="list"` spans: flow content is legal here
            now that this is a <div> and not the row's <button> — the ARIA
            stand-ins only ever existed to satisfy that button's
            phrasing-content model. Name + elapsed time, nothing else; see the
            toggle's own comment for why there is no third field to add. The
            hook itself caps the set at 32; nothing here re-caps it. */}
        {subagentsOpen && subagentList !== null && subagentList.length > 0 && (
          <ul id={subagentsId} className="sess-subagent-list">
            {subagentList.map((sa) => (
              <li key={`${sa.name}-${sa.startedAt}`} className="sess-subagent-row">
                <span className="sess-subagent-name">{sa.name}</span>
                <span className="sess-subagent-elapsed">{subagentElapsed(sa.startedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

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
