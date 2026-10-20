// Session header — the chat's sticky, safe-area-padded top strip: back
// chevron, the session's live name (fleet `name`, falling back to project),
// status meta (breathing dot + mono word; busy ticks a live elapsed clock),
// the account chip, and raised keycaps — `>_` opens the terminal drawer,
// `⋯` opens the lifecycle overflow menu (change model / move account /
// archive), and `esc` interrupts (DIRECTION: "a keycap, not an icon"), enabled
// only while the session is busy. Confirm-free: pressing esc just sends it.
// The esc cap is touch-only: where a physical keyboard exists ((pointer:
// fine)) it hides and the real Escape key takes over instead — the session
// screen's `useEscapeInterrupt`, never this header's (W2 Task S2d, D-5466).
// The ⋯ menu and the PR sheet are `SessionFlows`', opened through
// `useSessionFlows()`, so a skin switch that replaces this chrome keeps them.
import type { ReactNode } from 'react';
import {
  backgroundWork, backgroundWords, sessionWithCoordinator, withCoordinatorWords,
  type FleetSession, type RosterWire, type RouteField, type SessionBucket, type SessionStatus,
} from '../../../shared/api';
import { restartWords } from '../lib/restart';
import {
  BackButton, Chip, Keycap, StatusDot, TypedLabel, cn, useNow,
} from '@ccrc/ui';
import { accountLabel } from '../lib/accounts';
import { commandDoor } from '../command/door';
import { useMediaQuery } from '../lib/useMediaQuery';
import { sessionLabel } from '../fleet/sessionLabel';
// main's TypedLabel import is dropped, not lost: the component lives in
// @ccrc/ui now and the line above already carries it.
import { PrKeycap, hasPrCap } from './PrKeycap';
import { liveStatus } from './liveStatus';
import { useSessionFlows } from './SessionFlows';
import './chat.css';
import { hibernatedSince } from '../fleet/hibernated';
import { headerStatusWord } from '../fleet/sessionFacts';
import { chipTone, metaChipTone } from './chipTones';
import { SessionCoordination, SessionDetails } from './SessionDetails';
import type { Coordination } from '../fleet/fleetTree';
import type { SessionFactSet } from '../fleet/sessionFacts';

export interface SessionHeaderProps {
  session: FleetSession | null;
  status: SessionStatus | null;
  statusUpdatedAt: number | null;
  /** D-5237: called with the control that sent it, which the server records. The keycap's; the Escape key is the
   *  session screen's (`useEscapeInterrupt`). */
  onInterrupt: (source: 'keycap' | 'escape-key') => void;
  onBack: () => void;
  /** A routing write in flight on this field, until the pane reads it back
   *  or the 60s timeout clears it (routing spec §5.3, slice 4, Task 5) — the
   *  chip for THAT field wears a `queued` badge while this is non-null.
   *  Typed as the full `RouteField` union (only `class`/`effort` are ever
   *  passed — the two fields the model/effort pickers write — but the value
   *  arrives through `SessionScreen`'s general-purpose queue state, so this
   *  prop takes the same type rather than a narrower one no caller could
   *  satisfy without a cast). Defaults to `null` so a caller that never wires
   *  the picker's queue state renders exactly as it always did. */
  queuedField?: RouteField | null;
  /** Pre-snapshot identity derived from the session id (`wrapper:project`) —
   *  keeps the header instant on deep links before `/ws/fleet` lands. */
  fallback?: { title: string; wrapper: string };
  /** The account roster (`stores/fleet.ts`'s `roster`) — defaults to `[]` so
   *  a header rendered before the first poll lands degrades to
   *  `accountLabel`'s own raw-wrapper-name fallback rather than needing a
   *  roster it was never given. */
  roster?: readonly RosterWire[];
  /** The repository this session's project was last measured to be — R3:
   *  shown whenever known, there is no card here to imply it. `null`/absent
   *  renders nothing. */
  repo?: string | null;
  /** D-5527: who this session works for (`fleetTree.ts`'s `coordinationOf`) — its coordinator's id and
   *  state and the run number, which the session's facts do not carry. `null`: nobody's worker. */
  coordination?: Coordination | null;
  /** D-5545: the session's facts, from the same model the fleet card reads (`sessionFacts`), so the header
   *  holds every fact the card shows and the rest beside it. `null` before the first fleet frame. */
  facts?: SessionFactSet | null;
}

export function SessionHeader({
  session,
  status,
  statusUpdatedAt,
  onInterrupt,
  onBack,
  fallback,
  roster = [],
  queuedField = null,
  repo = null,
  coordination = null,
  facts = null,
}: SessionHeaderProps): ReactNode {
  const { openMenu } = useSessionFlows();
  // The PR cap runs `session-pr` (D-5469's door rule), which opens `SessionFlows`' PR sheet.
  const prDoor = commandDoor('session-pr');

  // Live stream status wins; the fleet snapshot fills in before it connects (`liveStatus`, the screen's one derivation).
  const st: SessionStatus | null = liveStatus(status, session);
  const at = statusUpdatedAt ?? session?.statusUpdatedAt ?? null;

  // THE bucket — the server's, never this header's. It used to OR
  // `dialogPending`/`hookState` into an `attention` of its own, which is the
  // second writer §1 of the spec forbids and which made the two screens
  // contradict each other from ONE snapshot: a `done` session read `finished`
  // on its fleet row and `idle` here; a `cleanup` one read "merged, ready to
  // clean up" there and "not running" here.
  //
  // The fallback is not a re-derivation: on a deep link, before /ws/fleet
  // lands, there IS no bucket — only the live stream's status — so it is
  // translated into the same vocabulary ('busy' -> 'working'; idle and dead
  // spell the same word in both) purely so the strip can paint something.
  //
  // And neither is the `dead` override. This screen holds a LIVE stream for
  // one session; the fleet snapshot is up to a tick behind it. Making the
  // header snapshot-first (Task 6) dropped the override entirely, so a
  // session whose own stream has already reported it dead kept pulsing amber
  // "waiting on you" — the header contradicting the socket it is attached to,
  // over the one state that asks the reader to act on a process that is gone.
  // It only ever DEMOTES: `dead` is never manufactured into attention, and
  // the bucket the server chose is what paints in every other case. Archived
  // rows are exempt because `ws-archive` stops the session by construction —
  // `dead` is true of every one of them, and saying "not running" there would
  // bury `cleanup`'s merge facts under a liveness fact nobody is waiting on.
  const snapshotBucket = session?.bucket ?? null;
  const bucket: SessionBucket | null =
    st === 'dead' && session != null && session.archivedAt == null
      ? 'dead'
      : snapshotBucket ?? (st === null ? null : st === 'busy' ? 'working' : st);
  // D-5242: a `dead` row `ccd hibernate` put to sleep reads `hibernated` beside the calm dot, never "✕ not running":
  // this screen wakes it on open (SessionScreen), and "not running" above "Waking…" would contradict it. Read off the
  // ROW (`hibernatedSince`, both halves), the same fact the wake trigger reads; the dead override above stays.
  const asleepAt = bucket === 'dead' && session != null ? hibernatedSince(session) : null;

  // `working` drives the visible clock's tempo; `busy` (the LIVE status, not
  // the snapshot's bucket) stays the gate on interrupting, because stopping a
  // turn is a fact about the process right now, not about how the fleet last
  // filed it.
  const working = bucket === 'working';
  const busy = st === 'busy';
  const now = useNow(working ? 1_000 : 30_000);

  // The keycap exists because phone keyboards have no Escape key. Where one
  // exists the key is the better control and the cap is clutter; the binding
  // is the session screen's `useEscapeInterrupt` (W2 Task S2d), which reads the
  // same query, so the cap hides exactly where the key takes over.
  const finePointer = useMediaQuery('(pointer: fine)');

  // Dot, word and tint all read the one bucket, so this strip cannot
  // contradict itself either. The word is the bucket's, with the two facts
  // only this screen has — the live elapsed clock and the relative age —
  // spliced in; StatusDot supplies the glyph and the spoken label.
  // D-5231: a `working` row whose last main Stop left delegated work running
  // reads `working · N in background` (the kinds in the title), as the card does.
  const bg = bucket === 'working' && session != null ? backgroundWork(session) : null;
  const bgWords = bg === null ? null : backgroundWords(bg);
  // D-5296: a `working` row whose parent holds its question reads
  // `with coordinator · <parent>`, in the calm (idle) tint, as the card does.
  // The dialog stays answerable from this screen: nothing here gates it.
  const wc = bucket === 'working' && session != null ? sessionWithCoordinator(session) : null;
  const wcWords = wc === null || session == null ? null : withCoordinatorWords(wc, session.project);
  // D-5237: "restarted · out of memory · 3m ago" for an hour after a process end.
  const restart = session != null ? restartWords(session, now) : null;
  // D-5545 (verifier round 1): the word is the MODEL's (`headerStatusWord`), from the bucket this strip paints —
  // it always begins with the card's word (`exited` on both; the lamp still speaks `not running`), adding only
  // what this screen knows: the live clock, the age, `on you`, `ready to clean up`.
  const word = bucket === null ? '' : headerStatusWord({ bucket, asleepAt, background: bgWords, at, now });
  // Four tints for seven buckets, on purpose: `status-line--*` is the existing,
  // contrast-verified set (chat.css) and the glyph already carries the
  // distinction colour must not carry alone. done/cleanup/archived take idle's
  // matte ink, exactly as their dots do (StatusDot's table).
  const variant =
    bucket === 'attention' ? 'attention' : wcWords !== null || asleepAt !== null ? 'idle' : working ? 'busy' : bucket === 'dead' ? 'dead' : 'idle';

  // The project is the ground; the second crumb is this particular workspace.
  // Without it, two workspaces of one project produce two identical headers.
  const title = session ? session.project : (fallback?.title ?? '…');
  const crumb = session && session.workspace !== null ? sessionLabel(session) : null;
  const wrapper = session?.wrapper ?? fallback?.wrapper ?? '';

  // Model / effort / ultracode / branch — read from the pane statusline the
  // server already parses. Tapping the model or effort chip opens its chooser.
  const model = session?.model ?? null;
  const effort = session?.effort ?? null;
  const ultracode = session?.ultracode ?? false;
  const branch = session?.branch ?? null;
  const hasMeta = st !== 'dead' && (model !== null || branch !== null || effort !== null || ultracode);
  // With no chosen `name`, sessionLabel()'s fallback chain lands on `branch` —
  // so the crumb above and this chip would print the identical string a few
  // pixels apart. Compare the actual rendered text (crumb vs branch), not the
  // fields that produced them, so the two can never disagree about what
  // "duplicate" means. A chosen name, or a main checkout with no crumb at
  // all, always differ — the chip renders exactly as it does today.
  const branchDuplicatesCrumb = crumb !== null && branch === crumb;

  return (
    <header className="chat-head">
      <BackButton className="chat-back" aria-label="Back to fleet" onClick={onBack}>
        ‹
      </BackButton>
      <div className="chat-title-wrap">
        <h1 className="chat-title">
          {title}
          {crumb !== null && (
            <>
              <span className="chat-crumb-sep" aria-hidden="true">
                ›
              </span>
              <TypedLabel className="chat-crumb" text={crumb} />
            </>
          )}
        </h1>
        {/* D-5527: under the name, because it says what this session IS for —
            whose code, whose programme — before the meta row says how it is. */}
        {facts !== null && <SessionCoordination facts={facts} coordination={coordination} />}
        <div className="chat-meta">
          {bucket !== null && (
            <>
              <StatusDot status={bucket} asleep={asleepAt !== null} />
              <span className={cn('status-line', `status-line--${variant}`, wcWords !== null && 'status-line--coordinator')} title={wcWords?.title ?? bgWords?.title}>
                {wcWords !== null ? (
                  // D-5390: the phrase yields width before the parent's name does.
                  <>
                    <span className="status-line-lead">with coordinator</span>
                    {' '}<span className="status-line-name">{`· ${wcWords.short}`}</span>
                  </>
                ) : word}
              </span>
            </>
          )}
          {wrapper !== '' && (
            <Chip dot className={chipTone('active')} title={facts?.lane.label}>
              {accountLabel(roster, wrapper)}
            </Chip>
          )}
          {restart !== null && (
            <Chip className={chipTone('restart')} title={restart.title} data-restart={restart.cause}>
              {restart.text}
            </Chip>
          )}
          {repo !== null && (
            <Chip className={chipTone('repo')} title="repository">
              {repo}
            </Chip>
          )}
          {/* Derived from archivedAt, never from pr.phase — merging archives
              nothing, so a merged PR sits on a live workspace until a human
              archives it, and must not claim the chip meanwhile. */}
          {session?.archivedAt != null && (
            <Chip className={chipTone('archived')}>
              archived{session.pr?.number != null ? ` · merged #${session.pr.number}` : ''}
            </Chip>
          )}
          {/* Status, account, model, effort and branch share ONE wrapping row —
              two fixed rows cost a line of chat height on every screen to say
              what fits comfortably on one. */}
          {hasMeta && (
            <>
              {model !== null ? (
              <button type="button" className={metaChipTone('model')} {...commandDoor('session-model')}>
                <span className="metachip-glyph" aria-hidden="true">🤖</span>
                <span className="metachip-text">{model}</span>
                {queuedField === 'class' && <span className="route-queued">queued</span>}
              </button>
            ) : (
              // The model chip itself is gated on `model !== null`, so a
              // queued `class` write on a freshly spawned session (no model
              // string on the pane yet) would otherwise show no feedback
              // until read-back clears it. A bare chip, same `route-queued`
              // class, stands in for the missing model chip in that one
              // window.
              queuedField === 'class' && <span className="route-queued">queued</span>
            )}
            <button
              type="button"
              className={metaChipTone(ultracode ? 'ultra' : 'plain')}
              {...commandDoor('session-effort')}
            >
              <span className="metachip-text">{ultracode ? 'ultracode' : (effort ?? 'set effort')}</span>
              {queuedField === 'effort' && <span className="route-queued">queued</span>}
            </button>
            {branch !== null && !branchDuplicatesCrumb && (
              <span className={metaChipTone('branch')} title={branch}>
                <span className="metachip-glyph" aria-hidden="true">⎇</span>
                <span className="metachip-text">{branch}</span>
              </span>
            )}
            </>
          )}
          {/* D-5545: every other fact, in full — a details row from 900px, behind one door on a phone. */}
          {facts !== null && <SessionDetails facts={facts} coordination={coordination} />}
        </div>
      </div>
      <Keycap className="keycap--term" aria-label="Terminal" {...commandDoor('open-terminal')}>
        <span aria-hidden="true">&gt;_</span>
      </Keycap>
      <Keycap className="keycap--more" aria-label="More" onClick={openMenu}>
        <span aria-hidden="true">⋯</span>
      </Keycap>
      {/* Top right, to the right of the ···. `esc` keeps the OUTER edge because
          it is the interrupt and its position is muscle memory; on a fine
          pointer esc is absent and this becomes rightmost naturally. */}
      {hasPrCap(session) && (
        <PrKeycap pr={session.pr} onOpen={prDoor.onClick} data-command={prDoor['data-command']} />
      )}
      {!finePointer && (
        <Keycap className="keycap--esc" aria-label="Stop" disabled={!busy} onClick={() => onInterrupt('keycap')}>
          esc
        </Keycap>
      )}
    </header>
  );
}
