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
import {
  ASK_OPERATOR_PRINCIPAL,
  ctxPressure, graphGateCount, graphReadCount, sessionAsk, substrateFault, turnStall,
  unmeasuredFields,
  type FleetSession, type RosterWire, type SessionBucket,
} from '../../../shared/api';
import { accountColorVar, accountLabel } from '../lib/accounts';
import { StatusDot } from '../components/StatusDot';
import { elapsedWords } from '../lib/elapsed';
import { useNow } from '../lib/useNow';
import { humanBytes } from '../screens/ArchiveScreen';
import { lifecycleQualifier } from './lifecycleWords';
import { sessionLabel } from './sessionLabel';
import { spawnChip } from './spawnWords';
import { TypedLabel } from './TypedLabel';
import './fleet.css';

/** Routing policy calls a window critical above this. */
const CRITICAL = 75;

/** Context-pressure chip floor (D-2011). Matches statusline-command.sh's own
 *  red banding (`pct_int -ge 80`), not ccd's `COMPACT_THRESHOLD` (50): the
 *  compactor already handles the 50-80 band on every ordinary cycle, so a
 *  chip firing there would be noise on ordinary mid-cycle rows, not signal. */
const CTX_PRESSURE = 80;

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

/**
 * The ask chip's two lines of text — the cell and its `title` — for one
 * folded ask.
 *
 * WHO RULED IS `answeredBy`, NEVER `parentId` (whole-branch review F1). The
 * chip was built from `parentId` alone for one wave, on a premise
 * `shared/api.ts` asserted and Task 12 had already falsified: the operator's
 * own lock-screen answer settles the same row with
 * `ASK_OPERATOR_PRINCIPAL`, so an ask the operator answered themselves, from
 * their own phone, inside the grace window, said "ruled by <parent-session-id>"
 * — a false attribution on the one surface this lane exists to make honest.
 *
 * THREE `answered` sentences, because there are three different facts:
 *   - the operator's own answer -> "answered by you". The person reading this
 *     card IS that principal, so the second person is truer here than the
 *     role word the row stores; and the chip's whole job — "why were you not
 *     buzzed about this?" — is answered by "because you had already answered
 *     it", which no third-person spelling says as plainly.
 *   - a parent's answer -> "ruled by <id>", the design doc's own words (§2.8),
 *     naming `answeredBy` (which the route guarantees equals `parentId` on
 *     that path — but it is read from the field that MEANS it).
 *   - a row that names nobody -> "answered", flat. Reachable: `settleAsk` is
 *     guarded on both routes precisely because it can throw after the digit
 *     has landed. Saying less is the honest move; substituting `parentId` is
 *     the defect above, reintroduced.
 */
function askWords(ask: { state: string; parentId: string; answeredBy: string | null }):
  { label: string; title: string } {
  if (ask.state === 'held') {
    return {
      label: `held — ${ask.parentId} may answer`,
      title: `${ask.parentId} may answer this question before the operator is notified`,
    };
  }
  if (ask.answeredBy === ASK_OPERATOR_PRINCIPAL) {
    return {
      label: 'answered by you',
      title: 'you answered this question yourself, before its parent pre-empted it',
    };
  }
  if (ask.answeredBy === null) {
    return {
      label: 'answered',
      title: 'this question was answered before the operator was notified; the row names no principal',
    };
  }
  return {
    label: `ruled by ${ask.answeredBy}`,
    title: `${ask.answeredBy} answered this question before the operator was notified`,
  };
}

export function SessionLine({
  session,
  onOpen,
  selected = false,
  onActions,
  roster = [],
  onOpenRun = null,
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

  // The row's lifecycle qualifier (§4.4) and the swap refusal's durable
  // marker (§2.4). Neither touches `state` above: the bucket ladder is
  // untouched, a dead row stays `exited`, and these are cells beside it.
  const qualifier = lifecycleQualifier(session);

  // Task 19: the ask pre-emption lane's chip. Through `sessionAsk`, never
  // `session.ask` directly — the live `fleet` frame is cast, not revived
  // (see `sessionAsk`'s own docstring), so a server predating this field
  // can omit the key at runtime despite the type calling it required.
  //
  // Fix round 1 (coordinator review, item 2's own finding): `sessionAsk`
  // reads the wire HONESTLY — it passes `released`/`stale`/`unknown`
  // through unchanged, same as `held`/`answered`, because deciding which
  // states the design doc has words for is not that function's job (its own
  // docstring, `shared/api.ts`). A THIS-BUILD server never sends those four
  // (`fleet.ts`'s `fleetAsk` folds them server-side before they ever reach
  // the wire), but `sessionAsk` exists precisely for a server that is NOT
  // this build — so trusting "only held/answered ever come back" here would
  // reintroduce, client-side, exactly the gap `sessionAsk` was written to
  // close. The fold happens here instead: only `held`/`answered` become a
  // chip; anything else reads as no ask, the same "no chip" a genuinely
  // absent `ask` gets.
  const askRaw = sessionAsk(session);
  const ask = askRaw !== null && (askRaw.state === 'held' || askRaw.state === 'answered') ? askRaw : null;

  // §1.6b. ONE chip, never two — every condition that decides which one, and
  // the §1.7 degrade for a verdict this bundle was compiled without, now live
  // in `spawnWords.ts` (see the note at the top of this file for why they
  // moved). This row renders the answer; it no longer holds the vocabulary.
  const chip = spawnChip(session);

  // D-2011/D-2016: context-window pressure, and the wedge signature it feeds.
  // Dead rows stay silent, same reasoning as `critical`'s account limits
  // below — a live pane reading says nothing once nothing is running.
  // `useNow` only ticks while this row is actually busy: nothing can go
  // stale on an idle/dead row, so there is nothing here worth a timer.
  const now = useNow(30_000, !dead && session.status === 'busy');
  // `ctxPressure(session)`, not `session.ctxPct` directly (fix round,
  // Finding 2): the live `fleet` frame is cast, not revived
  // (`stores/fleet.ts`'s `asFleetMsg`), so a server predating D-2011 omits
  // the key at runtime — the same seam `substrateFault`/`unmeasuredFields`/
  // `graphReadCount` already route through a named reader for. It rendered
  // safely without one only by luck (`undefined >= 80` reads `false`), which
  // is not the same as being correct by contract — see `ctxPressure`'s own
  // docstring in shared/api.ts.
  const ctxPct = dead ? null : ctxPressure(session);
  const ctxHigh = ctxPct !== null && ctxPct >= CTX_PRESSURE;
  // The wedge signature (D-2016): high context pressure AND busy AND no turn
  // boundary for a long time reads louder than any one fact alone — the
  // incident this predicate exists for climbed to 91.5% context nine minutes
  // into a turn that then ran 80.7 minutes with no idle boundary at all.
  // `!session.dialogPending` (Finding 5, fix round): `liveSessionStatus`
  // collapses Claude Code's `waiting` into this row's `busy` status
  // (server/src/fleet.ts:316-317) while the SAME read sets `dialogPending`
  // true (fleet.ts:419) — so without this guard a session sitting on a
  // permission prompt for hours at high context reads as wedged. D-2016's
  // own text draws exactly this line: "attention means a human answer
  // unblocks the session, which is false here" — a dialog-pending row is the
  // one shape a human answer DOES unblock, so it is excluded rather than
  // mislabeled. The quiet `ctx NN%` reading (no wedge escalation) still
  // renders for such a row when ctxHigh is true.
  const wedged =
    ctxHigh && !dead && session.status === 'busy' && !session.dialogPending && turnStall(session, now);
  const turnAge =
    wedged && session.statusUpdatedAt !== null ? elapsedWords(now - session.statusUpdatedAt) : null;

  const swapBlocked = session.swapBlocked ?? null;
  // `?? null` on the object, and a type check on the KEY — the same one-level-
  // deeper guard `lifecycleQualifier` carries, for the same reason (the fleet
  // frame is cast, not revived, and ccd/server/PWA are versioned apart).
  // Measured at HEAD: a marker carrying only `at` rendered "swap blocked —
  // undefined". The marker's PRESENCE is the durable fact §2.4 is about and
  // must outlive a reason this build could not read; `undefined` beside it is
  // not a reason, so the cell drops the half it does not have and keeps the
  // half it does.
  const swapReason =
    typeof swapBlocked?.reason === 'string' && swapBlocked.reason !== '' ? swapBlocked.reason : null;
  const swapNote =
    swapBlocked === null ? null
    : swapReason === null ? 'swap blocked'
    : `swap blocked — ${swapReason}`;

  // The supervisor's standing substrate fault (spec §4) — the console cannot
  // currently SEE this session, so every field above may be frozen at its
  // last good measurement. Read through `substrateFault`, never
  // `session.substrate` directly: the live frame is cast, not revived
  // (`asFleetMsg`), so an older server's row lacks the key at runtime — the
  // exact TypeError `unmeasuredFields`' docstring records. `at === 0` is the
  // registry's "marker listed but unreadable" degrade: the fault is real,
  // its date is not, so the title skips the `since` clause rather than
  // claiming tmux has been unreachable since 1970.
  const fault = substrateFault(session);
  const faultTitle =
    fault === null ? undefined
    : fault.at === 0 ? `tmux unreachable — ${fault.text}`
    : `tmux unreachable since ${new Date(fault.at).toLocaleString(undefined, {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      })} — ${fault.text}`;

  // The read counter (R4), through `graphReadCount` and never
  // `session.graphQueries`: the live frame is cast, not revived, so a server
  // predating this ADDITIVE field omits the key and the raw `!== null` test
  // is true for `undefined` — a `graph ` chip with no number (D-1251).
  const graphReads = graphReadCount(session);

  // The gate's own counter (R5, D-1613), through `graphGateCount` for exactly
  // the reason its sibling above gives: the frame is cast, not revived, and a
  // server predating this ADDITIVE field omits the key. `> 0` and NOT
  // `!== null`, which is the inverse of the read counter's rule and
  // deliberate: a measured `gated 0` is the ordinary state of a session that
  // queried its graph first, so rendering it would put a permanent suffix on
  // every healthy row and bury the rows where the gate actually fired. Zero
  // and null differ on the WIRE, where R5's reading is taken; they do not
  // differ in what this chip has to say.
  const gateDenials = graphGateCount(session);
  const graphGated = gateDenials !== null && gateDenials > 0 ? gateDenials : null;

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
  const acctVar = accountColorVar(roster, session.wrapper);
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
        </button>

        {/* Second line: a quiet flex row, not a grid track — a missing cell
            (no tally, no warning) just isn't there, instead of needing to be
            rendered empty to hold a track open (that was only ever a grid
            requirement, and this is no longer a grid). */}
        <span className="sess-meta">
          <span className={`sess-state sess-state--${state}`}>{state}</span>

          {/* Position 2, immediately after `.sess-state`. `.sess-meta` has no
              flex-wrap and no `order`, so DOM order IS visual order, and only
              `.sess-held`/`.sess-acct` shrink — which is why this cell is
              `flex: none` in fleet.css: §2.4 lengthens the hold reason in the
              same build and the two changes compound. */}
          {chip !== null && (
            <span className="sess-spawn" data-spawn={chip.data} title={`last spawn: ${chip.data}`}>
              {chip.word}
            </span>
          )}

          {/* Registry ladder (architecture doc, increment 1's second half —
              Task 2): this row's identity triple could not be fully measured
              this pass, so `status`/`branch`/etc above may be frozen at a
              fallback rather than freshly read. Same small, honest register
              as PrKeycap's own `unknown`-phase grey+reason idiom (chat.css's
              `--pr-dim`) — never a new banner. The reason lives in `title`,
              verbatim, never parsed, same as `.sess-held` next door; the word
              itself stays generic ("unreadable") because THIS surface has no
              per-session detail worth a sentence — the tooltip does. Heals on
              its own the moment a later sweep measures clean, same as every
              other degrade-and-heal surface this ladder feeds. */}
          {/* `unmeasuredFields(session)`, not `session.unmeasured` directly
              (blocking review finding 2): the live `fleet` frame is cast,
              not revived (`stores/fleet.ts`'s `asFleetMsg`), so a row from a
              server that predates this field can lack the key entirely at
              runtime — see `unmeasuredFields`'s own docstring. */}
          {unmeasuredFields(session).length > 0 && (
            <span
              className="sess-unmeasured"
              data-unmeasured="true"
              title={`registry ${unmeasuredFields(session).join('/')} temporarily unreadable — retrying`}
            >
              unreadable
            </span>
          )}

          {/* The substrate fault (spec §4), same quiet register as
              .sess-unmeasured above: generic words on the cell, the REASON
              VERBATIM in `title`, never parsed — the .sess-held contract. An
              AXIS beside the state word, not a takeover of it (M10): the row
              keeps whatever status/bucket said last, and this says the
              console currently cannot re-measure them. See `fault` above for
              the tolerant read and the `at === 0` no-1970 rule. */}
          {fault !== null && (
            <span className="sess-substrate" data-substrate="true" title={faultTitle}>
              unreachable tmux
            </span>
          )}

          {/* The program's claim — a workspace-only meta cell, same idiom as
              .sess-acct next door: reuses .sess-ask's ink-tertiary token, so
              no new contrast pair. THE REASON STRING IS THE DISPLAY
              (shared/api.ts's FleetSession.held) — rendered verbatim, never
              parsed, never iconified beyond this cell's own presence. `title`
              carries the full text past the cell's own ellipsis, same as
              .sess-subagent-name's truncation. */}
          {/* Task 5 — TWO FORMS OF ONE CELL, and the fact never changes
              between them: same class, same `data-held`, same verbatim text,
              same `title`. Only the element differs, and only when the caller
              has somewhere to send the tap.

              THE RUN IS NOT READ OUT OF THIS STRING, and that is not an
              accident of implementation. `rundefs.ts`'s `holdReason` docstring
              and `run-routes.test.ts`'s "the reason names its run, and NOTHING
              in the tree parses one back" both hold this text DISPLAY-ONLY —
              the second SCANS `pwa/src` for a parser and fails the build on
              one — including one written in a comment, which is why this note
              describes the regex rather than spelling it (measured on this
              branch: a helper that read the id out of the reason with a digit
              capture, dropped into `pwa/src`, reds that pin). Run
              awareness comes from `coord.db`, which the PWA already has on the
              `runs` frame, so the caller answers "is there a run to open" from
              the run rows themselves and hands down the answer. Same
              behaviour, better source: a hold left behind by a closed run
              would have parsed to a run id the board cannot show.

              A REAL `<button>`, never a span with a handler: `.sess-body`'s
              click forwarder above stands down on `closest('button')`, so this
              is what stops one tap from ALSO opening the session. */}
          {session.held !== null && (
            onOpenRun === null ? (
              <span className="sess-held" data-held="true" title={session.held}>
                {session.held}
              </span>
            ) : (
              <button
                type="button"
                className="sess-held"
                data-held="true"
                data-open="true"
                title={session.held}
                aria-label={`Open the run board — ${session.held}`}
                onClick={onOpenRun}
              >
                {session.held}
              </button>
            )
          )}

          {/* Task 19: the ask pre-emption lane's chip (design doc §2.8).
              Informational only — no action, no navigation, the operator's
              existing answer path is untouched. Same quiet register as
              .sess-held next door (mono, truncating, ink-tertiary — joins
              its shared rule in fleet.css rather than minting a new pair),
              because it is the same KIND of cell: a short, verbatim fact
              about who else is involved with this session right now. The
              full sentence lives in `title`, past the cell's own ellipsis,
              same contract as .sess-held. */}
          {ask !== null && (
            <span
              className="sess-ask-state"
              data-ask-state={ask.state}
              title={askWords(ask).title}
            >
              {askWords(ask).label}
            </span>
          )}

          {/* WHICH KIND of dead, as a cell rather than a bucket (spec §4.4,
              M10). Same quiet register as .sess-held next door — no new ink,
              no new banner: the row already says the session is not running,
              and this says why and what would fix it. Not gated on `dead`:
              `running unsupervised` describes a LIVE pane with no supervisor,
              which is precisely the state D2 exists to make visible. */}
          {qualifier !== null && (
            <span
              className="sess-lifecycle"
              data-lifecycle={session.lifecycle ?? undefined}
              title={qualifier}
            >
              {qualifier}
            </span>
          )}

          {/* The swap this session refused, still refused (§2.4). M9 is why
              this is a registry-sourced ROW cell and not a notice: a notice
              raised at 21:32 with no socket open is gone, and the operator
              who was not watching is exactly the one who needs to know. THE
              REASON STRING IS THE DISPLAY — rendered verbatim, never parsed,
              `title` carrying the full text past the cell's own ellipsis,
              same contract as .sess-held. */}
          {swapNote !== null && swapBlocked !== null && (
            <span className="sess-swapblocked" data-swapblocked="true" title={swapReason ?? swapNote}>
              {swapNote}
            </span>
          )}

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

          {/* The read counter (R4). `!== null` and NOT a truthiness test: a
              measured zero is the finding this chip exists to show — a session
              with a fresh graph in its tree that has queried it not once — and
              `graphReads && …` would hide exactly that row. Null is the
              other answer (no hook data, a hook too old to count, or a SERVER
              too old to send the field at all — see `graphReadCount`), and it
              renders nothing at all rather than a `graph 0` nobody measured.
              A plain cell in .sess-meta, so the shared
              `.sess-meta > *:not(:first-child)::before` rule punctuates it
              like every sibling; no disclosure, because there is nothing
              underneath a count to open. */}
          {/* The gate's suffix (R5, D-1613) rides THIS chip rather than
              claiming one of its own: R5's whole reading is denials beside
              queries, and two cells would let a row show one without the
              other. See `graphGated` above for why the suffix is `> 0` while
              the chip itself is `!== null`. */}
          {!dead && graphReads !== null && (
            <span
              className="sess-graph"
              title={
                graphGated === null
                  ? `${graphReads} graphify read(s) this session`
                  : `${graphReads} graphify read(s) this session · ${graphGated} search call(s) denied by the graphify gate`
              }
            >
              graph {graphReads}{graphGated === null ? '' : ` · gated ${graphGated}`}
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
              /* Only while the list it names actually exists. `aria-controls`
                 is an IDREF, and the <ul> below is conditionally rendered —
                 so on the collapsed row, which is the state a user would
                 follow the reference FROM, it pointed at nothing. Dropping it
                 there is the honest shape: `aria-expanded` already carries
                 the disclosure's whole contract. */
              aria-controls={subagentsOpen ? subagentsId : undefined}
              aria-label={`${subagentList.length} subagent${subagentList.length === 1 ? '' : 's'}`}
              onClick={() => setSubagentsOpen((o) => !o)}
            >
              ⑂ {subagentList.length}
            </button>
          )}

          {/* Context-window pressure (D-2011), escalated to the wedge
              reading (D-2016) — one cell, not two, same idiom `.sess-spawn`
              already uses for its own variants: a stable className the
              achromatic-group census can answer, and a `data-wedge`
              attribute (not a class) carrying the louder state, so a
              selected+wedged row is answered by ITS OWN higher-specificity
              rule rather than losing a tie to source order (see the matching
              `.sess-ctxpressure[data-wedge]` rule in fleet.css). `title`
              carries the reading's own caveat — this is what CLAUDE CODE
              believes its window is, not this account's real usable wall —
              verbatim, never parsed, same contract as `.sess-held`. */}
          {ctxHigh && (
            <span
              className="sess-ctxpressure"
              data-wedge={wedged || undefined}
              title={
                wedged
                  ? `context ${ctxPct}% · no turn boundary for ${turnAge} — may be wedged in a blocking compaction`
                  : `context window ${ctxPct}% (Claude Code's own reading of its window, not this account's usable wall)`
              }
            >
              ctx {ctxPct}%{wedged ? ` · stalled ${turnAge}` : ''}
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
                ? `running on ${accountLabel(roster, session.wrapper)}, pinned to ${accountLabel(roster, session.home)}`
                : undefined
            }
          >
            {accountLabel(roster, session.wrapper)}
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
