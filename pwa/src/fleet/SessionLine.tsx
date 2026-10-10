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
import type { ReactNode } from 'react';
import type {
  FleetSession, ProjectPoolWire, RosterWire, SessionBucket,
} from '../../../shared/api';
import { StatusDot, TypedLabel } from '@ccrc/ui';
import { sessionLabel } from './sessionLabel';
import { SessionMeta } from './SessionMeta';
import './fleet.css';


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

// The spawn verdict's table used to live HERE, private, on the stated grounds
// that it had no reader outside this file. Task 5 gave it one — the run board
// renders the same verdict off the same `FleetSession` — so it moved to
// `spawnWords.ts` WHOLE (the table, the unnameable degrade, and the
// dead/`started` conditions), rather than being exported in place or copied. A
// second table would be two names for one verdict; a second copy of the §1.7
// degrade would be two answers to "what does a build do with a word it has
// never heard of", which is the question that already cost this row one silent
// regression.

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
  roster = [],
  projectPool = null,
  onOpenRun = null,
  repo = null,
}: {
  session: FleetSession;
  onOpen: (id: string) => void;
  selected?: boolean; // the open session in the desktop sidebar
  onActions: (session: FleetSession) => void;
  /** The account roster, threaded down from `ProjectCard`/`FleetScreen`'s own
   *  `stores/fleet.ts` read. Defaults to `[]` so a line rendered before the
   *  first poll lands (or in a test that renders this component standalone)
   *  degrades to `accountLabel`/`accountColorVar`'s own raw-name/neutral-ink
   *  fallback rather than needing a roster it was never given. */
  roster?: readonly RosterWire[];
  /** This session's PROJECT's pool, derived by `ProjectCard` from its
   *  authoritative project measurement. `null` — the DEFAULT — is "nobody
   *  said", and the row then makes no pool claim at all: a line rendered
   *  standalone, or under an older server, stays byte-identical. */
  projectPool?: ProjectPoolWire | null;
  /** Task 5: what a tap on the hold reason should do, or `null` for "there is
   *  nowhere to go" — which is the DEFAULT, so every caller that has not been
   *  taught this renders the inert cell that shipped.
   *
   *  A CALLBACK, not a run id and not the runs list, because the decision is
   *  not this component's to make: whether the run board currently holds a row
   *  for this session is a question about `RunSummary[]`, which `ProjectCard`
   *  already has (Task 4 threaded it down for the nesting tree) and this row
   *  deliberately does not. That division is also what keeps the hold string
   *  DISPLAY-ONLY — see the note at the cell itself. */
  onOpenRun?: (() => void) | null;
  /** The repository this row works in, when the CARD it renders on would
   *  otherwise imply another (spec §6, R3) — decided by `ProjectCard`, never
   *  here: this row does not know which card it is on. Rendered INSIDE the
   *  row button so it is part of the accessible name: workspace slugs are
   *  unique per project only, and `still-river` is live on two projects
   *  today — two rows on one card would otherwise be two identical buttons
   *  in a screen-reader rotor. `null` renders nothing. */
  repo?: string | null;
}): ReactNode {
  const dead = session.status === 'dead';
  // THE authority: no local re-derivation of attention/busy/state survives
  // here (nor in sortFleet.ts or groupFleet.ts) — the server decided which of
  // the seven buckets this session is in, and shipped it as `session.bucket`.
  const state = WORD[session.bucket];


  const label = sessionLabel(session);


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
          meta line's gaps, the ask line) and it stands down for two things:
          any real control that was hit (`closest('button')` — one place, it
          covers every control this row ever grows, and it covers keyboard
          activation for free, since Enter/Space on a <button> dispatches a
          click that bubbles here exactly as a tap does, so the toggle needs
          no `stopPropagation` and no hand-rolled key handler of its own), and
          the expanded subagent list, which is content rather than dead space.
          See the handler for why the second one is not optional. */}
      <div
        className="sess-body"
        onClick={(e) => {
          const el = e.target as HTMLElement;
          // Two stand-downs. Any real control on the row (`closest('button')`
          // covers every one this row ever grows, keyboard activation
          // included — Enter/Space on a <button> dispatches a click that
          // bubbles here). And the expanded subagent list, which is CONTENT,
          // not dead space: it renders inside this block, so a tap on a
          // subagent's name used to navigate away from the disclosure the
          // operator had just opened, and a truncated name could not even be
          // selected to read.
          if (el.closest('button') !== null) return;
          if (el.closest('.sess-subagent-list') !== null) return;
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
          <TypedLabel className="sess-label" text={label} />
          {repo !== null && <span className="sess-repo">{repo}</span>}
        </button>
        <SessionMeta
          session={session}
          roster={roster}
          projectPool={projectPool}
          onOpenRun={onOpenRun}
          selected={selected}
          state={state}
          dead={dead}
          subagentList={subagentList}
          subagentsOpen={subagentsOpen}
          subagentsId={subagentsId}
          onToggleSubagents={() => setSubagentsOpen((v) => !v)}
        />

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
                {/* `title`, because .sess-subagent-name ellipsises: a long
                    agent name is otherwise unreadable on this row and the
                    row is not a link to anywhere that would show it. */}
                <span className="sess-subagent-name" title={sa.name}>{sa.name}</span>
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
