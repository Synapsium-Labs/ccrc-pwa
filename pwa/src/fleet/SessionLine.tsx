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
  substrateFault, unmeasuredFields,
  type FleetSession, type RosterWire, type SessionBucket, type SpawnVerdict,
} from '../../../shared/api';
import { accountColorVar, accountLabel } from '../lib/accounts';
import { StatusDot } from '../components/StatusDot';
import { humanBytes } from '../screens/ArchiveScreen';
import { lifecycleQualifier } from './lifecycleWords';
import { sessionLabel } from './sessionLabel';
import { TypedLabel } from './TypedLabel';
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

/** The spawn verdict's DISPLAYED word — a third presentational table over one
 *  field, which is this file's existing convention (`WORD`, `StatusDot`'s own
 *  glyph/label pair). PRIVATE on purpose: an exported table invites a caller to
 *  retitle a surface it does not feed, and the L0 vocabulary
 *  (`SPAWN_VERDICTS`) is not this list.
 *
 *  `expired -> 'unconfirmed'` and its quiet ink are deliberate: a systemd
 *  restart of a large session legitimately settles unconfirmed, and painting a
 *  healthy row dead-red trains the operator to ignore the chip. `ready -> null`
 *  because a healthy row has nothing to qualify. */
const SPAWN_WORD: Record<SpawnVerdict, string | null> = {
  ready: null,
  login: 'login',
  vanished: 'vanished',
  expired: 'unconfirmed',
  blocked: 'blocked',
  unrecognised: 'unknown',
};

/** How many characters of an unnameable verdict the chip will show. `.sess-spawn`
 *  is `flex: none`, so it takes whatever length it is handed and squeezes
 *  `.sess-held` — the one shrinkable cell in the row — out of the way. The token
 *  is untrusted text off the socket; React escapes it, so this is a LAYOUT bound,
 *  not an injection one. Every real member is under 12. */
const UNNAMEABLE_MAX = 18;

/** §1.7's render-seam rule, in one place: a value this build cannot NAME is shown
 *  as ITSELF, prefixed so the operator can tell "the fleet said something this
 *  app is too old to translate" from any word the app chose. Never a member of
 *  `SpawnVerdict`, and never nothing.
 *
 *  The parameter is `unknown` because that is the truth: the field is CAST off
 *  the wire, so a newer server's value need not even be a string. */
function unnameableVerdict(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? '? unnameable' : `? ${s.slice(0, UNNAMEABLE_MAX)}`;
}

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

  // §1.6b. ONE chip, never two, and never on a dead row (the exemption
  // `critical`/`subagentList` already take — nothing is running, so how the last
  // spawn ended describes work that no longer exists).
  //
  // THE RULE IS NOT "chip on anything not ready": `null` satisfies "not ready",
  // and `null` is what all 18 live sessions carry, so that rule would light a
  // warning on every healthy row. `swift-harbor` has NO spawn stamp at all — its
  // `spawnState` is correctly `null` and `started === false` is the ONLY signal
  // that shape emits, which is why the second arm is not optional.
  //
  // Both fields read DEFENSIVELY (`?? null`, `!== false`): the live `fleet` frame
  // is CAST, not revived (`stores/fleet.ts`'s `asFleetMsg` validates frames, not
  // members), so an older server's row lacks the keys at runtime.
  //
  // §1.7 — THE TABLE LOOKUP, WHICH USED TO READ `SPAWN_WORD[spawnState] ?? null`.
  // The `?? null` was reached by exactly one input — a verdict a NEWER server
  // sent that this bundle's `SPAWN_WORD` was compiled without — and it rendered
  // NO CHIP: byte for byte the healthy row. A verdict the operator was meant to
  // see vanished BECAUSE it was new, and the two deploy lanes (`deploy.sh` server
  // vs agent, no version handshake between them) make that window real rather
  // than theoretical. Hiding an unknown verdict is strictly worse than showing an
  // ugly one, so the unknown DEGRADES VISIBLY: shown as ITSELF, prefixed, never
  // as a member it is not and never as silence. `unrecognised` would be the
  // wrong member to borrow — it means the SERVER could not name ccd's rc, one
  // layer in from "this CLIENT cannot name the server's word".
  //
  // ABSENCE IS ASKED FOR BY NAME, and `?? unnameableVerdict(...)` could not ask:
  // it fires on `undefined` (no row — the case above) AND on a row whose word is
  // deliberately `null`. `SPAWN_WORD` is typed `string | null` precisely so a
  // member can be SILENT, and its own docstring justifies `ready -> null` on
  // those grounds — so the next member added with a `null` word would have
  // rendered `? <token>` instead of nothing, which is this same collapse one
  // level down. `Object.hasOwn` separates the two, and it is also what lets the
  // `ready` case go through the table rather than being special-cased in this
  // condition — one definition of "a healthy spawn says nothing", in the table
  // that holds every other verdict's word.
  const spawnState = session.spawnState ?? null;
  const spawnWord: string | null =
    spawnState === null
      ? null
      // The cast is the honest one: TS believes this lookup is total, and the
      // whole point is that at runtime it is not.
      : Object.hasOwn(SPAWN_WORD, spawnState as string)
        ? (SPAWN_WORD as Record<string, string | null>)[spawnState as string] ?? null
        : unnameableVerdict(spawnState);
  const spawnChip: string | null =
    dead ? null
    : spawnWord !== null ? spawnWord
    : session.started === false ? 'unstarted'
    : null;
  // `data-spawn` keeps the RAW value so the CSS hook and the tooltip name what
  // actually arrived; an unknown token simply matches no rule and takes
  // `.sess-spawn`'s loud default ink, which is the correct degrade direction.
  const spawnData = spawnChip === null ? undefined : (spawnState ?? 'unstarted');

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
          {spawnChip !== null && (
            <span className="sess-spawn" data-spawn={spawnData} title={`last spawn: ${spawnData}`}>
              {spawnChip}
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
          {session.held !== null && (
            <span className="sess-held" data-held="true" title={session.held}>
              {session.held}
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
