import { configDirFor, type CcrcConfig } from './config.js';
import type { Tmux } from './exec.js';
import type { FleetIO } from './io.js';
import { readRegistry, readSessionRecord } from './registry.js';
import type { SessionRecord } from './registry.js';
import { readLimits } from './limits.js';
import { liveSessionStatus, readLiveState, readLiveStateMeasured } from './livestate.js';
import type { Statusline } from './pane/statusline.js';
import type { HookState } from './hookstate.js';
import type { FleetSession, LifecycleInput, PrState, SessionStatus, TaskProgress } from '../../shared/api.js';
// The ladder lives in `shared/` because `reviveFleetSession` is its second
// producer and the two must not be able to disagree — see its own docstring.
import { sessionBucket, sessionLifecycle, spawnVerdict } from '../../shared/api.js';
import type { Roster } from '../../shared/roster.js';

/** `FleetSession.askSummary`'s ceiling — a fleet card row, not a transcript. */
const ASK_SUMMARY_MAX_LEN = 80;

/**
 * The fleet card's one-line summary of a `waiting` hook state.
 *
 * `null` for anything that isn't an actively-waiting hook state WITH an ask
 * envelope: a hook can report `waiting` a beat before the ask write lands
 * (two separate writes, no lock between them), and that gap must read as
 * "nothing to summarize yet", never as an empty or fabricated line.
 *
 * Questions: the FIRST question's `header?.trim() || question` — the header
 * is the short form a human wrote for exactly this kind of glance, but an
 * EMPTY or whitespace-only header (a real shape: `session-hook.sh` copies
 * `tool_input.questions` verbatim, and a header is optional on the tool call
 * itself) must fall through to the question exactly like an absent one does
 * — `??` alone does not do that, since `''` is neither `null` nor
 * `undefined`. Approval: `` `${tool}: ${summary}` `` — the one pending tool
 * call and its own one-line description, unless BOTH are empty, which is
 * treated as no summary rather than emitting `": "`. Both clipped to
 * `ASK_SUMMARY_MAX_LEN`, and the whole thing is null rather than `''` on the
 * off chance every fallback above is itself empty — this line renders
 * unconditionally on a waiting card, so "no line" must never become a blank
 * one.
 *
 * `liveWaitingFor` (D-76) is the SECOND source, and it is a fallback, not a
 * peer: the hook envelope carries the actual questions and options and is
 * what the answer sheet acts on, while this is one word from Claude Code
 * about why it stopped (`'sandbox request'`, `'input needed'`, …). It is read
 * only when the hook produced no line at all — which for three of the four
 * `waitingFor` causes is always, since no hook event fires for them.
 */
export function hookAskSummary(hs: HookState | null, liveWaitingFor: string | null = null): string | null {
  const text = hookAskText(hs) ?? (liveWaitingFor?.trim() || null);
  return text === null || text === '' ? null : text.slice(0, ASK_SUMMARY_MAX_LEN);
}

function hookAskText(hs: HookState | null): string | null {
  if (hs === null || hs.state !== 'waiting' || hs.ask === null) return null;
  if ('questions' in hs.ask) {
    const q = hs.ask.questions[0];
    return q ? (q.header?.trim() || q.question) : null;
  }
  const { tool, summary } = hs.ask.approval;
  return tool === '' && summary === '' ? null : `${tool}: ${summary}`;
}

/**
 * Which account a session id belongs to, from the id alone — the fallback
 * `assembleFleet` uses when the registry has no explicit `home` written
 * (older sessions; ccd only started writing `home` recently).
 *
 * Longest-id-wins, over `roster.byIdLengthDesc` (`shared/roster.ts`, which
 * sorts by id length descending and then id ascending, so the order is total
 * rather than engine-defined). The prefix an id is matched against is
 * `<account id>-`, which is also the pattern ccd's `_ccrc_id_wrapper` case arms
 * are generated from — one rule, two languages.
 *
 * The ordering is the entire point. Its predecessor was a hand-typed, unordered
 * prefix array that did not even MENTION `claude-dev0`, under which
 * `claude-dev0-quiet-basin` fell through to the bare `claude-` branch and came
 * back `claude` — a live session attributed to the wrong account, which is not
 * hypothetical: `claude-dev0-*` ids exist in the registry today. Get the order
 * wrong here (or in ccd's own `case`) and a `claude-dev0` session is silently
 * re-attributed to `claude`, reproducing the old bug for real. `fleet.test.ts`
 * pins both the real ids and a synthetic prefix-collision roster.
 *
 * Falls back to `roster.upstreamId` — the one account running the Claude Code
 * binary itself — for an id with no account prefix at all, since a main
 * checkout's id is the bare project name, never `<wrapper>-<slug>`. That
 * fallback used to be the literal `'claude'`, which is only that account's name
 * on boxes whose roster happens to call it that; `parseRoster` guarantees
 * exactly one upstream account, so this names the same thing everywhere.
 *
 * Takes the roster rather than reading one: the previous
 * `BY_ID_PREFIX_LENGTH_DESC` was a module-level const evaluated at import time,
 * and runtime roster data does not exist then. `assembleFleet` passes
 * `cfg.roster`, whose `byIdLengthDesc` was sorted once by `parseRoster` — this
 * runs once per registry row, so re-sorting per call would be O(rows ×
 * accounts log accounts) on every fleet tick.
 */
export function idHomeWrapper(roster: Roster, id: string): string {
  for (const a of roster.byIdLengthDesc) if (id.startsWith(`${a.id}-`)) return a.id;
  return roster.upstreamId;
}

/**
 * Authoritative live status for one session — the same signal the fleet uses:
 * dead if no tmux session, else busy/idle from the live status file. Used by
 * the interrupt route: a --remote-control pane never renders the busy marker
 * at all, and an RC-off pane does render it, but the same pane can ALSO be
 * showing a dialog painted right alongside it — either way busy-ness has to
 * come from the live status file, which also sees subagents the pane never
 * shows.
 */
export async function liveStatus(io: FleetIO, cfg: CcrcConfig, tmux: Tmux, id: string): Promise<SessionStatus> {
  // C0.3: this only ever asks about ONE id — no uniqueness or subtraction
  // over the rest of the fleet — so it reads just that id's row rather than
  // the whole registry (readRegistry's 24-generation sweep, ~505 round trips
  // on a 24-session fleet in remote mode, for a question about one session).
  const read = await readSessionRecord(io, cfg, id);
  // A degraded row must never answer 'dead' — the interrupt route's own
  // "not busy" refusal reads THIS, and reporting dead-by-drop on a session
  // this read simply could not measure would let it refuse an interrupt on a
  // plainly busy one. `!read.found` (genuinely absent, or the whole
  // directory unlistable) is still 'dead': there is no pane to ask about
  // either way, the same answer this gave before the ladder existed.
  // D-309 (was D-B8-13): `hasSession` here deliberately collapses `unknown` into 'dead' —
  // which this route turns into a REFUSED interrupt, the safe direction this
  // function's own comment above already argues for. Splitting the pair for
  // the operator's view is the substrate-unreachable spec's job (a state word
  // through shared/server/pwa), not a guard's.
  if (!read.found || !(await tmux.hasSession(id))) return 'dead';
  const rec = read.record;
  const pid = await tmux.panePid(id);
  // Unmeasured wrapper => 'idle', via the EXISTING `!cfgDir` fallback: a
  // degraded `rec.wrapper` is `''`, which `configDirFor` (an unknown wrapper
  // string) already answers `undefined` for — honest-but-blind, and it fails
  // TOWARD refusing an interrupt rather than granting one on a guess.
  const cfgDir = configDirFor(cfg, rec.wrapper);
  if (!pid || !cfgDir) return 'idle';
  // THE FOLDED READ, KEPT ON PURPOSE — do not "finish" D-115 here.
  // `assembleFleet` below takes `readLiveStateMeasured` and paints an
  // unreadable live file `busy`; this function must keep answering `'idle'`
  // for it, and the two are not drift. A card DISPLAYS, so its reassuring
  // word is the dangerous one; this function's sole consumer is
  // `POST /api/sessions/:id/interrupt`'s `… === 'busy'` check, which REFUSES
  // on anything else — so here `'idle'` is what withholds the keystroke, and
  // "fail toward busy" would GRANT an interrupt on a read that measured
  // nothing, inverting D-115's own intent one line from its remedy. Same
  // direction the `!cfgDir` fallback above already argues for, on the same
  // grounds. `fleet.test.ts` pins this answer beside `assembleFleet`'s
  // opposite one, on ONE fixture, so the asymmetry reads as a decision.
  const live = await readLiveState(io, cfgDir, pid);
  return live ? liveSessionStatus(live.status) : 'idle';
}

/** The PR state a session has WITHOUT a live sweep: whatever `ccd pr-state`
 *  last wrote into the registry. `unchecked` when it has never run. Null for a
 *  main checkout, which is the only session that gets no PR control at all.
 *  Deliberately NOT enriched — url/title/checks are not persisted, and
 *  inventing them here would put stale CI colour on screen with a fresh
 *  `checkedAt` beside it. */
function persistedPr(r: SessionRecord): PrState | null {
  if (r.workspace === null) return null;
  return {
    phase: r.prPhase ?? 'unchecked',
    number: r.prNumber, url: null, title: null,
    checks: null, checkNames: null, ahead: 0, reason: null,
    checkedAt: r.prCheckedAt, mergedAt: null,
    // The registry stores no backoff: it is per-process, per-project, in-memory.
    retryAt: null,
  };
}

/**
 * A registry stamp in the units every clock in this server actually compares
 * against. `ccd` writes them with `date +%s` — epoch SECONDS, as
 * `registry.ts`'s own field docstrings say ("Epoch SECONDS, registry-native
 * … `fleet.ts` is the one place it becomes ms") — while `Date.now()`,
 * `SUPERVISED_FRESH_MS` and every other threshold in the tree are
 * milliseconds.
 *
 * D-1157 gave that sentence a FUNCTION rather than leaving it a convention
 * repeated inline. `sweepDivergences` had handed raw seconds to a census that
 * subtracts them from `Date.now()`, which makes every age ~1.78e12 ms — past
 * every freshness window there is, so `archived-but-live` could never fire.
 * A convention that lives only in prose is one a second consumer does not
 * inherit; a named function is one it has to go out of its way to skip.
 */
export function registrySecondsToMs(seconds: number | null): number | null {
  return seconds === null ? null : seconds * 1000;
}

/**
 * A `LifecycleInput` from a registry record — ONE spelling, because there are
 * now two callers and `single-definition.test.ts` exists for the second copy.
 *
 * THE UNITS ARE THE WHOLE REASON THIS TAKES `nowMs` AND NOT `now`. Every stamp
 * on a registry row is epoch SECONDS (ccd writes `date +%s`), and
 * `LifecycleInput` is epoch MILLISECONDS throughout — so the ×1000 belongs
 * here, once, rather than at each call site where one of them would eventually
 * be written without it. `assembleFleet` keeps its own seconds clock and
 * multiplies on the way in; `sweepMail` already holds `Date.now()` and passes
 * it straight through. A caller that hands this seconds would place every
 * stamp ~55 years in the future, which `sessionLifecycle`'s own `>= 0`
 * freshness guard reads as NOT fresh — so the failure would be a silent
 * `restarting` collapsing to `orphan`, not a crash. Hence the parameter name.
 */
export function lifecycleInputFor(
  r: SessionRecord, alive: boolean, nowMs: number,
): LifecycleInput {
  return {
    alive,
    supervisedAt: registrySecondsToMs(r.supervisedAt),
    stoppedAt: r.stopped === null ? null : r.stopped.at * 1000,
    stopSurface: r.stopped?.surface ?? null,
    started: r.started,
    unmeasured: r.lifecycleUnmeasured,
    nowMs,
  };
}

export async function assembleFleet(
  io: FleetIO,
  cfg: CcrcConfig,
  tmux: Tmux,
  now = Math.floor(Date.now() / 1000),
  pendingDialogs?: Set<string>,
  statuslines?: Map<string, Statusline>,
  taskProgress?: Map<string, TaskProgress>,
  /** Last-swept PR state per session id (FleetWatcher's third lane). Absent on
   *  a cold start and in every existing test — which is exactly why the
   *  registry fallback below exists. */
  prStates?: Map<string, PrState>,
  /** Fresh per-session hook state (FleetWatcher's fifth lane), same pattern
   *  as `pendingDialogs`: absent on a cold start and in every existing test,
   *  which is exactly why every hook-derived field below defaults to null. */
  hookStates?: Map<string, HookState>,
  /**
   * The registry rows this assembly must describe, when the caller has
   * ALREADY read them — the same `records ?? await readRegistry(...)` idiom
   * `watch.ts`'s own `sweepTasks`/`archiveMerged` lanes use.
   *
   * Load-bearing for correctness, not just for the saved round trips
   * (bba5c09; restated here — blocking review finding 4 — on its REAL ground,
   * since the claim this comment used to make, "`FleetSession` carries no
   * `unmeasured` field", is false as of Task 2: `unmeasured: r.unmeasured` is
   * assigned into the returned session below). The actual reason a caller
   * MUST pass its own rows rather than let this function take a second,
   * independent read: `watch.ts`'s `tick()` derives its evidence — the
   * `unmeasuredIds` set its busy→idle "✓ Finished" push refuses to fire for —
   * straight off THIS call's own return value (`sessions[i].unmeasured`), not
   * off a separately-read set of `SessionRecord`s. If this function took its
   * OWN read instead of the rows `tick()` already has, that would be a
   * SEPARATE whole-fleet sweep, ~21 field reads per session, a few hundred ms
   * after the one `tick()` used for `sweepHookStates`/`detectDialogs` — and a
   * row that read clean in tick()'s sweep and degraded in THIS one would
   * still land in `sessions` with `unmeasured` empty (wrong), or vice versa.
   * Passing the rows in makes every lane inside one tick describe the
   * IDENTICAL observation, which is the only way they can never disagree —
   * the same reasoning `tick()`'s own comment states for why it shares this
   * read with `sweepHookStates`/`detectDialogs` in the first place.
   */
  records?: SessionRecord[],
): Promise<FleetSession[]> {
  const [recs, limits] = await Promise.all([records ?? readRegistry(io, cfg), readLimits(io, cfg, now)]);
  return Promise.all(recs.map(async (r): Promise<FleetSession> => {
    // D-309: `hasSession` here deliberately collapses `unknown` into `alive
    // = false`, so a substrate fault reads 'dead' in the PWA — a false dead,
    // with the ungated Restart button under it. Known, and deferred BY DECISION
    // to the substrate-unreachable spec: what the fleet view shows for
    // cannot-ask is a product judgement (a new SessionStatus crosses the wire
    // and every render seam), not a guard this assembly may improvise.
    const alive = await tmux.hasSession(r.id);
    let status: SessionStatus = 'dead';
    let name: string | null = null, statusUpdatedAt: number | null = null, version: string | null = null;
    // D-76. Claude Code's own "I am blocked on the human" verdict, hoisted out
    // of the block below because `dialogPending` is assembled far past it.
    // Null means "not waiting, or nothing measured"; a STRING is the reason,
    // and an empty-but-waiting file is `''` — which is why the flag beside it
    // is separate, rather than this field doing double duty as both.
    let liveWaiting = false, liveWaitingFor: string | null = null;
    // D-115: whether `status` below is a READING or this surface's fail-shut
    // guess. Declared rather than inferred — `watch.ts` cannot tell the two
    // apart from the word `busy` alone, and it must (see `statusUnmeasured`'s
    // own docstring in `shared/api.ts`).
    let statusUnmeasured = false;
    if (alive) {
      status = 'idle';
      const pid = await tmux.panePid(r.id);
      const cfgDir = configDirFor(cfg, r.wrapper);
      if (pid && cfgDir) {
        // D-115: `readLiveStateMeasured`, not `readLiveState`. The folded read
        // answered ONE null for four conditions, and this block spent it as
        // "leave `status` at the `alive` default" — which is `'idle'`. So a
        // pane whose `<pid>.json` this box could not read (EACCES; in remote
        // mode one dropped agent-WS round trip) painted `idle · 1m ago` on the
        // fleet card while its own terminal showed the spinner. That is the
        // exact symptom `liveSessionStatus`'s own docstring argues against one
        // file over — "a status we don't recognise is far likelier to be new
        // work than new rest" — reached by a path that never got as far as a
        // status word.
        const read = await readLiveStateMeasured(io, cfgDir, pid);
        if (read.ok) {
          const live = read.state;
          status = liveSessionStatus(live.status);
          // A derived name is Claude Code's session handle (`openclawhetzner-42`
          // — cwd basename plus a counter), never a description of the work, so
          // it is dropped HERE rather than shipped for the PWA to re-judge.
          // `name` on the wire therefore means "a name worth displaying", and
          // the fleet line's `name ?? branch ?? workspace ?? id` falls through
          // to the branch on its own. Only the exact string 'derived' rejects:
          // an absent nameSource is an older file whose name a human chose.
          name = live.nameSource === 'derived' ? null : live.name;
          statusUpdatedAt = live.statusUpdatedAt; version = live.version;
          // Read off the RAW status word, not off `status` — `liveSessionStatus`
          // has already collapsed `waiting` into `busy` by this line, and that
          // collapse is deliberate and frozen (see its docstring). This is the
          // distinction surviving the collapse rather than dying in it.
          liveWaiting = live.status === 'waiting';
          liveWaitingFor = live.waitingFor;
        } else if (read.reason === 'unmeasured') {
          // `busy` is this SURFACE's fail-shut direction, and only this
          // surface's: a card is read as permission to walk away, so the
          // reassuring word is the dangerous one here. `liveStatus` two
          // functions up answers `'idle'` on this identical failure ON
          // PURPOSE — its sole consumer is the interrupt route's
          // `… === 'busy'`, which REFUSES on idle, so "fail toward busy"
          // there would GRANT interrupts on a read that measured nothing.
          // Both are failing away from the act that cannot be taken back;
          // `fleet.test.ts` pins the pair together on ONE fixture so the
          // asymmetry cannot be mistaken for drift and quietly "fixed".
          //
          // `status` ALONE moves. `name`, `statusUpdatedAt`, `version`,
          // `liveWaiting` and `liveWaitingFor` stay at their defaults,
          // because an unmeasured read has no fields to report and inventing
          // them is the same defect one field over — `statusUpdatedAt` in
          // particular renders as the `· 1m ago` beside the word, so a
          // fabricated one would put a fresh timestamp under a status nobody
          // measured. `no-state` — absent, half-written, or naming no session
          // — is untouched and still leaves the whole block at `idle`: that
          // is a real measurement of a pane that has published nothing yet,
          // the ordinary shape in the seconds after `ccd ws-add`.
          status = 'busy';
          // And SAY SO. Painting `busy` without this makes the guess
          // indistinguishable from a measurement one hop downstream, where
          // `watch.ts`'s busy→idle edge turns it into a push asserting a turn
          // completed — for a session that, on the idle→blip→idle path, never
          // started one.
          statusUnmeasured = true;
        }
      }
    }
    const acct = limits[r.wrapper];
    const sl = statuslines?.get(r.id);
    // A running Workflow leaves the orchestrator reporting idle while it waits
    // on subagents — surface it as busy so it doesn't read as finished.
    if (sl?.workflowActive && status === 'idle') status = 'busy';
    // STATUS IS FROZEN above this line: `hs` informs dialogPending and the
    // three hook-derived fields below, and MUST NOT feed back into `status` —
    // that derivation is done the moment this line runs.
    const hs = hookStates?.get(r.id) ?? null;
    // §4.3's ladder, on the evidence THIS assembly measured: the pane it just
    // asked tmux about, plus the three registry stamps `buildRecord` read in
    // the same pass — one observation, never two reads that could disagree
    // (the same reasoning this function's `records` parameter already states).
    //
    // THE UNIT CONVERSION LIVES HERE AND NOWHERE ELSE. Registry stamps are
    // epoch SECONDS (ccd writes `date +%s`, exactly as `archived` does);
    // `LifecycleInput` is epoch MS. `now` is this call's own second-resolution
    // clock, so the whole comparison happens on one timebase and a stale
    // heartbeat cannot read as fresh because two operands disagreed by 1000x.
    //
    // `nowMs` DECISION (task-9-report.md carries the full reasoning, corrected
    // in fix round 1 after MEASUREMENT — see below): `now` is THIS PROCESS's
    // own clock (`Date.now()`, `assembleFleet`'s own default parameter), not
    // the fleet host's — `r.supervisedAt` can be written on a REMOTE box
    // across `remote/io.ts`'s seam, and that protocol carries no clock op at
    // all (`stat`'s `mtimeMs` is the nearest thing, and no caller threads it
    // here); both production callers (`server.ts`, `watch.ts`) confirm this by
    // passing `undefined` and taking the default.
    //
    // MEASURED (sampling a full 30s re-stamp cycle against
    // `SUPERVISED_FRESH_MS`'s `>= 0` guard): the tolerance is ASYMMETRIC, not
    // the roughly-symmetric window the 120s constant alone would suggest. A
    // fleet host as little as 5s AHEAD already misreads part of every cycle,
    // and by ~30s ahead the misclassification is PERMANENT (every re-stamp in
    // the cycle is future-dated, so `>= 0` never passes again). A host BEHIND
    // tolerates roughly 90-119s before the same permanent failure — the 120s
    // window, minus one cycle's slop, working in its favor instead of against
    // it.
    //
    // Left uncompensated HERE, deliberately: the fix for the asymmetry, if
    // ever needed, is a SYMMETRIC freshness window inside `sessionLifecycle`
    // itself (`age > -SUPERVISED_FRESH_MS` in place of `age >= 0`), which
    // would cap false-fresh at 120s on the ahead side exactly as the behind
    // side already is — not a slack constant grafted on at this call site.
    // That changes the shared classifier's guard, which both
    // `session-lifecycle.test.ts` and the bash twin
    // (`ccd-session-lifecycle.test.ts`) pin to match ccd's shipped
    // `_session_state` exactly; changing it here would break that parity, so
    // it is a cross-task decision, not this one. The cost of leaving it as-is
    // is real but bounded today: a display-only qualifier (M10 — no bucket or
    // status ever moves) that nothing server-side reads yet. That bound
    // expires at the PWA-rendering task later in this plan, which exists
    // specifically to render this field — it is not a permanent argument, only
    // this task's.
    const lifecycleInput: LifecycleInput = lifecycleInputFor(r, alive, now * 1000);
    const session: FleetSession = {
      id: r.id, wrapper: r.wrapper, home: r.home ?? idHomeWrapper(cfg.roster, r.id),
      project: r.project, workdir: r.workdir, workspace: r.workspace, name, status, statusUpdatedAt,
      limits: acct ? { five: acct.five, seven: acct.seven } : null,
      // Either source can raise the flag: the pane detector sees an
      // AskUserQuestion/permission menu the hook never gets a write for
      // (older Claude Code, a hook that failed to install), and the hook sees
      // a waiting state before any menu ever paints (headless, or between the
      // hook write and the next pane capture).
      // …and a THIRD source since D-76: Claude Code's own `status: 'waiting'`,
      // which it writes with `working: false` beside it. Three of its four
      // causes (a sandbox request, an elicitation prompt, a managed-settings
      // security prompt) paint no numbered menu for the scraper and fire no
      // hook event, so without this arm they reached the wire as `working`.
      dialogPending: (pendingDialogs?.has(r.id) ?? false) || hs?.state === 'waiting' || liveWaiting, version,
      model: sl?.model ?? null, effort: sl?.effort ?? null,
      // The statusline wins: it is a live pane capture and knows about a manual
      // checkout. The registry fills the gap before the first capture lands.
      ultracode: sl?.ultracode ?? false, branch: sl?.branch ?? r.branch ?? null,
      tasks: taskProgress?.get(r.id) ?? null,
      pr: prStates?.get(r.id) ?? persistedPr(r),
      archivedAt: r.archivedAt,
      archivedBytes: r.archivedBytes,
      held: r.held,
      hookState: hs?.state ?? null,
      askSummary: hookAskSummary(hs, liveWaitingFor),
      subagents: hs?.subagents ?? null,
      // `?? null` and not `?? 0`: no hook data at all and a hook reporting
      // zero reads are two conditions, and `hookstate.ts` already keeps them
      // apart — collapsing them one layer out would undo that on the wire.
      graphQueries: hs?.graphQueries ?? null,
      // Carried straight off the record — this IS the evidence `tick()`'s own
      // `unmeasuredIds` (watch.ts) now derives its Set from directly, one
      // field of these very rows (one derivation of one fact — blocking
      // review finding 4), shipped on the wire so the PWA (grey+reason,
      // SessionLine.tsx) and the offline/state-cache snapshots (Task 2) can
      // tell a degraded row from a measured one too.
      unmeasured: r.unmeasured,
      statusUnmeasured,
      // §4.4: a NEW FIELD, never a new `SessionStatus`/`SessionBucket` member
      // (M10 — an unknown bucket reaches `RANK[bucket]` as a NaN comparator and
      // `DOT[status].cls` THROWS in an already-deployed PWA). The bucket ladder
      // two lines down is untouched, and `bucket.test.ts` pins that.
      //
      // Computed for EVERY row, archived ones included. `ws-archive`
      // unsupervises through `_ws_unsupervise`, which stamps, so an archived
      // workspace honestly reads `stopped`. Suppressing the MEASUREMENT here
      // would be a lie told to make a renderer simpler.
      //
      // And the renderer DOES show it there — measured, correcting what this
      // comment used to claim. `SessionLine.tsx` gates `.sess-lifecycle` on
      // `qualifier !== null` and on nothing else: an `archived` row renders
      // `archived · stopped by ccd, 12d ago · claude`, and a `cleanup` row —
      // which sits in the LIVE list, not the archived fold — renders `stopped
      // by ccd, 3d ago`. That is deliberate on the renderer's side (M10: a
      // renderer that branches on a bucket token is one an unknown token can
      // break) and it is left alone: on a cleanup row the qualifier is
      // genuinely useful, since stopped-by-ccd and stopped-by-an-agent are
      // different facts about a workspace queued for reaping, and on an
      // archived row it is redundant but true. `pwa/test/session-lifecycle
      // .test.tsx` pins both, so this paragraph cannot silently go stale the
      // way its predecessor did.
      lifecycle: sessionLifecycle(lifecycleInput),
      // Epoch MS on the wire — the timebase `statusUpdatedAt`/`bucketSince`
      // already use and the PWA's relative-time helpers already read.
      // `archivedAt` is the one exception, in seconds, because it shipped that
      // way; a second exception would make the unit a coin toss at every site.
      stoppedBy: r.stopped === null ? null : { at: r.stopped.at * 1000, surface: r.stopped.surface },
      swapBlocked: r.swapBlocked === null
        ? null
        : { at: r.swapBlocked.at * 1000, reason: r.swapBlocked.reason },
      // Same seconds→MS conversion, at THIS seam only, like `stoppedBy` and
      // `swapBlocked` above. An unreadable marker's fail-shut `{at: 0}` rides
      // through as 0 (not a real 1970 stamp — the PWA renders text-only when
      // `at === 0` rather than fabricate an epoch-dawn timestamp).
      substrate: r.substrate === null
        ? null
        : { at: r.substrate.at * 1000, text: r.substrate.text },
      // Carried straight off the record. `SessionRecord.spawn: { at; rc } | null`
      // ALREADY EXISTS and is already parsed from `$REG/<id>.spawn` — nothing new
      // is read off disk here, and the `<epoch-seconds> <rc>` encoding is
      // untouched (its timestamp is what `_supervised_start` compares `at >= since`
      // against). This is a PROJECTION onto the wire, not a second field.
      started: r.started,
      spawnState: spawnVerdict(r.spawn === null ? null : r.spawn.rc),
      bucket: 'idle', bucketSince: null,   // replaced immediately below
    };
    // Computed FROM the assembled session, never from a second copy of the
    // same expressions: `dialogPending` in particular is an OR of two sources
    // and must be read once. STATUS IS STILL FROZEN — `sessionBucket` reads
    // `status`, it never writes it.
    //
    // `hs?.event` (blocking review finding, F1): this is the ONE call site
    // that can hand `sessionBucket` the raw hook event, because `hs` (this
    // tick's fresh `HookState` read) is the only place `event` exists at
    // all — it is never carried onto the `FleetSession` wire shape, so
    // `reviveFleetSession`'s own `sessionBucket` call two-argument (defaults
    // to `null`) is not a second copy of this reasoning, it is a caller with
    // no `event` to give.
    return { ...session, ...sessionBucket(session, hs?.updatedAt ?? null, hs?.event ?? null) };
  }));
}
