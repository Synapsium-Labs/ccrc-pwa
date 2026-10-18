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
import { useRef } from 'react';
import type { ReactNode } from 'react';
import type { FleetSession, ProjectPoolWire, RosterWire } from '../../../shared/api';
import { Icon, StatusDot, TypedLabel, useNow } from '@ccrc/ui';
import type { ChildRunContext } from './runWords';
import type { CoordPresence } from './coordWords';
import { SessionMeta } from './SessionMeta';
import { cardFacts, sessionFacts } from './sessionFacts';
import './fleet.css';


// The ROW's state word table moved to `sessionFacts.ts` (`STATE_WORD`, D-5545): the card and the header both
// read it there, so the two can never call one bucket by two words.


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



export function SessionLine({
  session,
  onOpen,
  selected = false,
  onActions,
  roster = [],
  projectPool = null,
  onOpenRun = null,
  workingOn = null,
  childRun,
  coordinator = null,
  coordinatorTitle,
  now,
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
  /** D-5527: the project whose code this row works on, when the card it renders
   *  on is another project's — a coordinator's dispatched child from a different
   *  project (`fleetTree.ts`'s `workingOnCard`, decided by the card, never here).
   *  Rendered INSIDE the row button, so it rides the accessible name. `null`
   *  renders nothing: a same-project row reads exactly as it did. */
  workingOn?: string | null;
  /** The active run and coordinator name for the child label (`SessionMeta`). */
  childRun?: ChildRunContext;
  /** D-5545: the presence of this row's coordinator when it is not a live row on this card (`orphanNote`):
   *  `dead` puts "coordinator gone" on the row, its one marker — the line the card used to repeat under it. */
  coordinator?: CoordPresence | null;
  /** The orphan marker's guidance (`orphanNote`'s `title`). */
  coordinatorTitle?: string;
  /** The clock, for a test; the row ticks its own otherwise. */
  now?: number;
}): ReactNode {
  // D-5545: every fact this row shows is decided by `sessionFacts`, the model the session header reads too —
  // so the card is a glance (the name, the state word, ONE context fact, at most ONE marker and the
  // cross-project chip) and the header a superset of it. The state word, the hibernated reading (D-5242), the
  // `role` read (D-5301 — THE ONE READER of `FleetSession.role` in `pwa/src` is `sessionFacts.ts` now) and the
  // dead row's silence about subagents and limits all moved there with it. The role badge, the account lane,
  // the task tally, the subagent disclosure and the waiting question's summary are header facts now
  // (`SessionDetails`), each still one tap away.
  const busy = session.status === 'busy';
  const tick = useNow(30_000, busy && now === undefined);
  const facts = sessionFacts({
    session, now: now ?? tick, roster, projectPool, ...(childRun === undefined ? {} : { childRun }),
    workingOn, coordinator, coordinatorTitle: coordinatorTitle ?? null,
  });
  const glance = cardFacts(facts);
  const label = glance.name.text;
  const asleep = facts.asleepAt !== null;

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
    <div className={selected ? 'sess-line sess-line--active' : 'sess-line'} data-state={facts.state}>
      <span className="sess-lamp" data-status={session.bucket}>
        <StatusDot status={session.bucket} asleep={asleep} />
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
          title={glance.name.short === undefined || glance.name.short === label ? undefined : label}
          onClick={open}
        >
          {/* D-5545: the full name wherever the column holds it (wrapping at a hyphen, never an ellipsis), and
              shortened by whole tokens only in a phone-narrow column (`Fit`, fleet.css's container query). The
              button's accessible name is the FULL name either way (verifier round 1): both drawn forms are
              `aria-hidden`, and the name is spoken once. */}
          {glance.name.short === undefined || glance.name.short === label ? (
            <TypedLabel className="sess-label" text={label} />
          ) : (
            <span className="sess-label-fit">
              <span className="sr-only">{label}</span>
              <span className="fit-full" aria-hidden="true"><TypedLabel className="sess-label" text={label} /></span>
              <span className="fit-short" aria-hidden="true"><TypedLabel className="sess-label" text={glance.name.short} /></span>
            </span>
          )}
          {/* D-5527: whose code this row works on, when its card is another
              project's. An icon beside a WORD (nothing is read out of shape
              alone); the hidden lead makes the accessible name a sentence. */}
          {workingOn !== null && (
            <span className="sess-workson" data-project={workingOn} title={`works on ${workingOn}’s code`}>
              <Icon name="folder-code" />
              <span className="sr-only">works on </span>
              <span className="sess-workson-name">{workingOn}</span>
            </span>
          )}
          {/* D-5545: the repo label (spec §6, R3) and the role badge (D-5301) are header facts now — a row whose
              repo differs from its card's always carries the cross-project chip above, which already keeps two
              same-slug rows' accessible names apart. */}
        </button>
        <SessionMeta facts={facts} mode="card" onOpenRun={onOpenRun} />
        {/* D-5545: the waiting question's summary (it was a third line, clipped to an ellipsis) and the subagent
            disclosure are the session header's now — the row says `needs you`, the header says what. */}
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
