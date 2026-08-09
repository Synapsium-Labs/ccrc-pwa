import type { Deps } from './server.js';
import type { Bus } from './bus.js';
import { assembleFleet } from './fleet.js';
import { readRegistry } from './registry.js';
import { paneState, parseDialog } from './pane/dialog.js';
import { parseStatusline, type Statusline } from './pane/statusline.js';
import { defaultCachePath, saveSnapshot } from './fleetstate.js';
import { readTasks, taskProgress } from './tasks/read.js';
import { CCD_ARGV, verbSupported } from './ccdargv.js';
import { isFullLine, parsePrLines, phaseFor, type CcdPrFailure } from './prstate.js';
import { liveSessionStatus, readLiveState } from './livestate.js';
import { readHookState, type HookState } from './hookstate.js';
import { sendPrompt } from './inject/send.js';
import { askActions } from './askkey.js';
import type { SessionRecord } from './registry.js';
import type { NotifyEvent, PrState, SessionStatus, TaskProgress } from '../../shared/api.js';
import { UNCHECKED_PR } from '../../shared/api.js';
import type { PushPayload } from './push.js';
import { deriveBranch } from './naming.js';
import { transcriptPath } from './transcript/resolve.js';
import { readAiTitle } from './transcript/title.js';

/** Task sweeps read every task file of every session, so they run on their own
 *  slower clock than the 2 s pane poll — a plan advances on the scale of
 *  minutes, and the fleet chip is a glance, not a readout. The open session's
 *  own stream reads its list every tick, so the screen you're looking at stays
 *  live regardless. */
const TASK_SWEEP_MS = 10_000;

/** The sixth lane (the fifth is hook-state sweeping, which rides the 2 s tick).
 *  Naming does NOT ride that tick: a title that appears ten seconds late costs
 *  nothing, and reading transcripts thirty times a minute to learn nothing costs
 *  real work. `claimTitleRead`'s own docstring has the arithmetic for the nine
 *  transcripts on this box that carry no `ai-title` at all, re-read forever at
 *  THIS lane's real 10 s cadence: roughly 7.7 MB/min across the agent WS. The
 *  2 s tick is five times faster, so riding it would cost five times that on
 *  those same nine transcripts to learn nothing — roughly 38.5 MB/min. */
const NAME_SWEEP_MS = 10_000;

/** Refusal tokens (of ccd's fourteen, `spec:252-266` — the spec's own table
 *  predates the ninth and the fourteenth, `spec:49` is the unrelated `ws/`-
 *  prefix paragraph) that cannot stop being true: a branch, once pushed, is
 *  never un-pushed (`has-upstream`); a checkout that is not a workspace, a
 *  worktree ccd cannot find registered, and a worktree whose directory
 *  belongs to a different session are all facts about the session's shape
 *  that a title landing later cannot change (the last two ship their own
 *  remedy in the refusal detail, `git -C $main worktree add …`, which
 *  "cannot stop being true" only in the narrower sense that no TITLE fixes
 *  it). `name-taken-local`/`name-taken-origin` and `unchanged` are
 *  deliberately absent — a name collision or a since-changed title can
 *  resolve on the next sweep. See `FleetWatcher.nameSweepRetired` and review
 *  finding 1.
 *
 *  `registry-branch-drift` joins the set for the same "no title fixes it"
 *  reason as the worktree pair above: `cmd_ws_rename` now refuses when git's
 *  own worktree record disagrees with the registry's `branch` field — the
 *  corroboration `cmd_ws_reap` already requires (`ccd:3381`) — because
 *  without it a hand `git branch -m` (which moves git's answer but never
 *  updates the registry) leaves this sweep's own condition 2 believing the
 *  branch is still at its born name while `ws-rename` would act on whatever
 *  git says instead. The remedy is IN THE REFUSAL, same shape as the other
 *  two repairable tokens: a rename of that same branch through `ccd
 *  ws-rename` re-syncs the registry, which is a human action a later TITLE
 *  cannot substitute for — hence session-level retirement, not a
 *  per-derived-name retry.
 *
 *  `bad-branch` is deliberately NOT here, unlike the earlier draft of this
 *  set (review finding 5): it is a verdict on `deriveBranch(title)`, not on
 *  the workspace, and a later title is exactly the thing that can change it.
 *  Retiring the SESSION on `bad-branch` would be wrong the day it ever fires
 *  — `attemptedRenames`'s per-(incarnation, derived-branch) key is already the
 *  correct guard for a name-dependent refusal. Today the arm is dead code:
 *  `deriveBranch` only ever emits `ws/[a-z0-9]+(-[a-z0-9]+)*`, a subset
 *  `_ws_branch_valid` (`ccd/ccd:1337-1347`) always accepts, so `bad-branch`
 *  never actually reaches this lane — see `naming.ts:26-30`. */
const PERMANENT_REFUSALS: ReadonlySet<string> = new Set([
  'has-upstream', 'not-a-workspace', 'worktree-unregistered', 'worktree-foreign',
  'registry-branch-drift',
]);

/** The fourth lane. A ccd install is a deliberate act by a human who is
 *  waiting, so a minute is the longest anyone should have to wonder whether
 *  the fleet noticed — and the agent's stat gate means an unchanged ccd costs
 *  a stat, not a bash process. */
const CAPS_REFRESH_MS = 60_000;

/** The third lane. 8 projects x 1 call / 120 s is ~240 GraphQL calls an hour
 *  against a 5000/hr budget with ~4900 free — about 5%. Measured latency
 *  0.51-0.69 s per call. */
const PR_SWEEP_MS = 120_000;
const PR_SWEEP_ACTIVE_MS = 30_000;      // any project with an open PR whose checks are pending
const PR_BACKOFF_MAX_MS = 900_000;
/** How long one sweep may be in flight before the next is allowed to start
 *  anyway. In local mode `realRunner` passes NO timeout to `execFile`
 *  (`exec.ts:6-12`), so nothing bounds the awaited `ccd` call and a wedged `gh`
 *  would otherwise hold the single-flight latch for the process's lifetime —
 *  the cap would never update again and there would be no error anywhere to say
 *  why. Same 15 minutes as the backoff ceiling: far longer than any real sweep
 *  (measured 0.51-0.69 s per project call), short enough that wedged is not
 *  permanent. */
const PR_SWEEP_STUCK_MS = PR_BACKOFF_MAX_MS;

/** The SEVENTH lane. (Sixth is naming, fifth is hook-state sweeping.) spec:159
 *  fixes the cadence; the rest of this block is the gate's arithmetic.
 *
 *  Ten seconds is not how fast mail should arrive — it is how often the lane
 *  is allowed to ASK. Actual delivery is bounded below by `MAIL_QUIET_MS`,
 *  which is the point: mail lands at a turn boundary, not mid-thought. */
const MAIL_SWEEP_MS = 10_000;

/** How long a session must have been idle before it is interruptible. ccd's
 *  own `COMPACT_QUIET` (`ccd/ccd:45`), taken rather than re-derived: this is
 *  the same judgement about the same panes, and two numbers for one policy is
 *  two numbers to get out of step. Measured from `statusUpdatedAt`, which
 *  Claude Code ticks on every busy<->idle transition (`ccd/ccd:6697-6698`). */
const MAIL_QUIET_MS = 60_000;

/** No session gets two injections inside this window, however much mail is
 *  queued for it. A fan-out of six findings arriving as six prompts in ninety
 *  seconds is a denial of service dressed as coordination. */
const MAIL_COOLDOWN_MS = 120_000;

/** How long an UNACKED delivery waits before it is replayed. Dated from the
 *  `UserPromptSubmit` edge when there is one, from `deliveredAt` otherwise —
 *  the edge proves the turn started, so the recipient is thinking, not
 *  ignoring. */
const MAIL_REPLAY_MS = 600_000;

/** The PRE-DELIVERY attempt budget, and the spacing between attempts —
 *  applies ONLY while a delivery's own `deliveredAt` is still null (review
 *  finding 4). A row that has NEVER been delivered parks as
 *  `rejected('undeliverable')` at the cap, and THE MAIL ROW IS UNTOUCHED
 *  (spec:170-172): the record of what was said survives the failure to say
 *  it. The instant `deliveredAt` is set, this budget stops applying: the
 *  row's own history already disproves 'undeliverable', so a failing REPLAY
 *  backs off instead of rejecting — forever, bounded by ack rather than by a
 *  count, which is what spec:174-177's "replays … until acked" actually
 *  requires. `attempts` keeps counting on a delivered row too (it is one
 *  cumulative column), just without a ceiling that turns it into a park.
 *
 *  That is also what makes the constant below real (review finding 9): a
 *  NEVER-delivered row's own schedule (attempts 1..5, 30 s doubling to 8 min)
 *  never reaches `MAIL_BACKOFF_MAX_MS` before `MAIL_MAX_ATTEMPTS` parks it —
 *  `Math.min` never binds on that path and the ceiling is decorative there.
 *  A delivered row's `attempts` is not capped at 6, so by attempt 6
 *  (30 000 * 2^5 = 960 000) `Math.min` genuinely clamps to the ceiling —
 *  doubling from 30 s to the same 15-minute ceiling `PR_BACKOFF_MAX_MS`
 *  already uses, one ceiling for "this keeps not working" across the whole
 *  watcher. */
const MAIL_MAX_ATTEMPTS = 6;
const MAIL_BACKOFF_BASE_MS = 30_000;
const MAIL_BACKOFF_MAX_MS = PR_BACKOFF_MAX_MS;

/** The fleet kill-switch, `$REG/mail-disabled` — ccd's `-disabled` family
 *  (`ccd/ccd:20-22`, `_lane_enabled` at `:53`), which the operator already
 *  knows how to use: `touch` to stop, `rm` to resume. Read by LISTING the
 *  registry directory, never by reading the file: `FleetIO.readFile` maps
 *  every failure to null (`io.ts:41-43`), so a read would make an unreadable
 *  kill-switch look like an absent one — fail-OPEN on the one control whose
 *  entire job is to stop injection. `limits.ts:134-142` already filters
 *  unknown `<name>-disabled` markers out of `/api/accounts`, so this name
 *  cannot fabricate an account row there. */
const MAIL_DISABLED_MARKER = 'mail-disabled';

// `UNCHECKED_PR` was a local copy of the literal `PrKeycap.tsx` and
// `prstate.ts` each also held — integration finding 6. One definition now, in
// `shared/api.ts`, which is the only module all three sides can import.

/**
 * Polls the fleet: captures every registered pane to detect menu dialogs
 * (emitting `session:<id>` dialog / dialog_cleared messages on change), then
 * emits 'fleet' on the bus only when the assembled JSON changed.
 *
 * In remote mode, every poll taken while actually connected also persists a
 * snapshot to the degraded-mode cache (fleetstate.ts) — skipped while
 * disconnected so a stretch of empty/partial reads never clobbers the last
 * known good snapshot `/api/fleet` falls back to.
 */
export class FleetWatcher {
  private timer: NodeJS.Timeout | null = null;
  private lastJson: string | null = null;
  /** Last-reported dialog id per session id. */
  private dialogIds = new Map<string, string>();
  /**
   * Session id → the dialog id of an ask push that went out with NO actions,
   * still pending an envelope.
   *
   * The ask push is edge-triggered on the dialog id, and `parseDialog`'s id is
   * a hash of the menu's labels and title — it does not change as the cursor
   * moves — so without this latch a question whose hookstate landed a beat
   * after its pane (see the ordering note in `tick()`) could NEVER become
   * answerable from the phone: the appear-edge is spent, and nothing else
   * produces `kind:'ask'`. With it, the first tick that can prove the envelope
   * re-raises the same notification, in the same tag, now carrying its
   * options.
   */
  private actionlessAsks = new Map<string, string>();
  /**
   * `id#prNumber` keys already told "merged, held, nothing archived" — so
   * `archiveMerged`'s held branch fires that push ONCE per (workspace, PR)
   * rather than on every 2-minute sweep for as long as the hold stands.
   *
   * IN-MEMORY BY DESIGN, not a gap: a server restart forgets the latch and
   * may repeat the push, but `pushOne`'s tag is `merged-<id>` — the SAME
   * collapse key the real archive push uses — so the repeat REPLACES the
   * prior notification on the phone rather than stacking a duplicate. The
   * cost of losing this latch on restart is one redundant, silently-replaced
   * notification; persisting it would buy nothing back for that price.
   */
  private heldMergedNotified = new Set<string>();
  /** Last-seen model/effort/ultracode/branch per live session (from the pane). */
  private statuslines = new Map<string, Statusline>();
  /** Prior status per session — drives the busy→idle push. */
  private prevStatus = new Map<string, SessionStatus>();
  /** Last swept task progress per session id, and when the sweep ran. */
  private taskProgress = new Map<string, TaskProgress>();
  private lastTaskSweep = 0;
  /** Last-swept PR state per SESSION id. */
  private prStates = new Map<string, PrState>();
  /** Last-read hook state per session id (the fifth lane) — rebuilt every
   *  tick, same cadence as dialog detection: `readHookState` is a single
   *  local JSON read per session, cheap enough not to need its own slower
   *  clock the way task/PR sweeps do. */
  private hookStates = new Map<string, HookState>();
  /** Per-PROJECT backoff after a failed read: one repo failing must not slow
   *  or silence the other seven. */
  private prBackoff = new Map<string, { until: number; step: number }>();
  private lastPrSweep = 0;
  /** The fourth lane's clock. Starts at 0 so the first tick after start
   *  always refreshes — which is what recovers a server that connected to an
   *  agent whose boot-time caps read had already failed. */
  private lastCapsAt = 0;
  /** The sixth lane's clock. */
  private lastNameSweep = 0;
  /** `<id>#<uuid>:<derived-branch>` for every pair already tried. THE DERIVED
   *  NAME, not the born slug: a title that changes while the branch is still
   *  at its born name earns exactly one fresh attempt, and a server restart
   *  earns one retry — which is the right amount, because the usual reason a
   *  rename failed is a condition a restart does not change, and the one
   *  reason it might have (a transient fleet outage) is worth one more try.
   *  Deliberately not durable: a registry marker would be state ccd has to
   *  own, write and purge on reap, for a retry budget whose entire purpose is
   *  to be forgotten.
   *
   *  KEYED ON `<id>#<uuid>`, not `<id>` alone: `<project>-<slug>` is a SLUG,
   *  recycled by `ws-reap` (`ccd:950-951`), and nothing in this map is ever
   *  pruned when a row disappears — so a bare `<id>` key would let a reaped
   *  workspace's stale pairs shadow an unrelated LATER workspace that drew the
   *  same recycled slug. `r.uuid` is minted fresh by every `ws-add`, so the
   *  combined key cannot survive a slug's reap-and-redraw cycle — the same
   *  self-healing property `titleProbe` already has via a transcript path that
   *  changes with the uuid.
   *
   *  THE SAME KEY CHANGE ALSO HAPPENS WITHOUT A REAP: `ccd`'s `_sync_uuid`
   *  (`ccd:6417`) rewrites the registry's `uuid` field in place, on the SAME
   *  live session, whenever Claude Code rotates its own session uuid (a
   *  `/clear`, a compaction) — no `ws-reap`/`ws-add` cycle required. So "a
   *  server restart earns one retry", above, is not the only way a pair earns
   *  a fresh attempt without a title change: the next sweep after a uuid
   *  rotation reads a different `r.uuid`, computes a different incarnation,
   *  and finds no entry here either — the same consequence a restart has, on
   *  the process's own clock instead of one session's. */
  private attemptedRenames = new Set<string>();
  /** `<id>#<uuid>` incarnations the sweep will never spend another transcript
   *  read on. `attemptedRenames` is keyed per (incarnation, derived branch)
   *  and cannot express this: a title that keeps changing on a workspace whose
   *  branch was already pushed would keep minting fresh pairs forever, and
   *  each one earns its "one fresh attempt" — the stat gate (`claimTitleRead`)
   *  never closes on a session whose transcript is still growing. Populated
   *  only by a refusal that is permanent BY CONSTRUCTION (`PERMANENT_REFUSALS`),
   *  never by a transient one — a fleet outage or a name collision can stop
   *  being true; a pushed branch cannot become un-pushed. Review finding 1:
   *  without this, a live workspace stuck on `has-upstream` re-reads a 256 KB
   *  tail every ten seconds indefinitely, the exact cost the stat gate exists
   *  to price out. Deliberately not durable, same reasoning as
   *  `attemptedRenames`.
   *
   *  KEYED ON `<id>#<uuid>`, same reason and same recycling hazard as
   *  `attemptedRenames` above — but sharper here: this set never expires a key
   *  by (id, branch) at all, so a bare `<id>` key would silently retire every
   *  future workspace that ever draws a previously-retired slug, for the life
   *  of the process, with no log line anywhere to say why naming stopped
   *  working for that one workspace.
   *
   *  THE SAME KEYING MEANS RETIREMENT IS NOT RESTART-ONLY EITHER: a session
   *  `PERMANENT_REFUSALS` retired stays out of THIS incarnation's way for the
   *  rest of the process's life, but `_sync_uuid` rotating that session's own
   *  uuid mid-life (`attemptedRenames`'s docstring above has the mechanism) is
   *  a second, independent way to earn a fresh incarnation that was never
   *  added here — the sweep tries it again on the next tick, no server
   *  restart required. */
  private nameSweepRetired = new Set<string>();
  /** Per session: the transcript state whose title the sweep has already acted
   *  on. Same gate, for the same reason, as `SessionStream.claimAskRead`
   *  (`sessionws.ts:178-187`). */
  private titleProbe = new Map<string, { file: string; size: number; mtimeMs: number }>();
  /** Epoch ms the in-flight sweep started, or 0 when none is. A TIMESTAMP, not
   *  a boolean: see `PR_SWEEP_STUCK_MS`. */
  private prSweepStartedAt = 0;
  /** The first tick primes dialog/status state WITHOUT firing pushes, so a ccrc
   *  restart doesn't notify for every already-pending dialog / idle session. */
  private primed = false;
  private readonly cachePath: string;
  /** The set of projects with at least one non-dead session, as of the last
   *  completed `tick()` — feeds `pushOne`'s "name the project only when more
   *  than one is active" rule. `detectDialogs` and `sweepPr`/`archiveMerged`
   *  run on their own clocks (the pane sweep runs before this tick's own
   *  `assembleFleet`; the PR sweep is a `void`-dispatched lane that can still
   *  be in flight ticks later) and neither has the current tick's session list
   *  in scope, so both read this cached, at-most-one-tick-stale set rather
   *  than recomputing the fleet — which `sweepPr` deliberately never does,
   *  since it must not block on `gh`. A push firing with last tick's project
   *  count is the honest cheap answer; the alternative (a fresh fleet read
   *  inside a lane that promises never to block) is not on offer.
   */
  private activeProjects = new Set<string>();
  /** The seventh lane's clock. */
  private lastMailSweep = 0;
  /** Per session: when this lane last injected. IN MEMORY BY DESIGN, and the
   *  direction of the failure is why: a restart forgets the cooldown and may
   *  deliver one message sooner than it should have. Persisting it would buy
   *  a politeness guarantee across a restart at the price of a column and a
   *  purge — the same trade `attemptedRenames` already declined (`:172-181`).
   *  The ATTEMPT budget, which protects a session from a loop rather than
   *  from a moment, IS durable: it is a column on the delivery. */
  private mailCooldown = new Map<string, number>();
  /** Session ids with a `sendPrompt` currently in flight from THIS lane —
   *  the cross-sweep single-flight guard `sweepMail` was missing (review
   *  findings 1/5). `tick()` void-dispatches `sweepMail` every
   *  `MAIL_SWEEP_MS`, and `sendPrompt` alone can run past that (four-plus
   *  seconds of its own polling, longer still behind another
   *  server-originated write holding the session's `KeyedQueue` slot — a
   *  reap, an inject, `sweepNames`) — so without this, a second sweep starting
   *  while the first is still blocked inside `sendPrompt` re-reads the SAME
   *  still-`queued`/still-`delivered` row (`markDelivered`/`backOff` have not
   *  run yet) and enqueues a SECOND send for it. Written BEFORE `sendPrompt`
   *  is called and cleared in a `finally`, same before-the-call discipline
   *  `sweepNames`'s `attemptedRenames` uses and for the identical reason —
   *  except this one must be cleared once the send resolves (attempted-once
   *  guards a lifetime; in-flight guards one send), so a `Set`, not a durable
   *  marker. IN MEMORY BY DESIGN, same reasoning as `mailCooldown` just
   *  above: a restart forgets an in-flight send along with the process that
   *  was making it, and there is nothing left to guard once the process is
   *  gone. */
  private mailInFlight = new Set<string>();

  constructor(private deps: Deps, private bus: Bus, private intervalMs = 2000, cachePath?: string) {
    this.cachePath = cachePath ?? deps.stateCachePath ?? defaultCachePath();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * The set of session ids that currently have a pending menu dialog. Exposed
   * so a one-shot fleet assembly (the /api/fleet REST + the initial /ws/fleet
   * push on connect) can reflect an ALREADY-pending dialog. Without this, a
   * dialog that appeared before a client connected shows no "needs you" marker
   * on the fleet overview: the initial push omits it and the watcher only
   * re-emits 'fleet' when the JSON *changes*, so an unchanged pending state is
   * never resent to the newcomer.
   */
  currentPending(): Set<string> {
    return new Set(this.dialogIds.keys());
  }

  /** Last-seen statuslines — passed into a one-shot fleet assembly (REST +
   *  initial /ws/fleet push) so model/effort/ultracode/branch show immediately,
   *  same reasoning as currentPending(). */
  currentStatuslines(): Map<string, Statusline> {
    return new Map(this.statuslines);
  }

  /** Last-swept plan progress — same reasoning as currentPending(). */
  currentTaskProgress(): Map<string, TaskProgress> {
    return new Map(this.taskProgress);
  }

  /** Last-swept PR state — passed into a one-shot fleet assembly (REST +
   *  initial /ws/fleet push) so the cap is right immediately rather than two
   *  minutes late. Same reasoning as currentPending(). */
  currentPrStates(): Map<string, PrState> {
    return new Map(this.prStates);
  }

  /** Last-read hook state — passed into a one-shot fleet assembly (REST +
   *  initial /ws/fleet push) so an already-waiting hook state shows
   *  immediately. Same reasoning as currentPending(). */
  currentHookStates(): Map<string, HookState> {
    return new Map(this.hookStates);
  }

  async tick(): Promise<void> {
    // Read once, share with the two lanes that would otherwise each read it
    // again on EVERY tick (detectDialogs, sweepHookStates) — in remote mode
    // every readRegistry() field is its own agent-WS round trip, so this is
    // the difference between one registry read and two, every 2s, forever.
    // sweepTasks/sweepPr below are NOT included: both throttle to their own
    // slower clock and skip the read entirely on most ticks already.
    const records = await readRegistry(this.deps.io, this.deps.cfg);
    // hook states FIRST, dialogs second — the order is load-bearing and there
    // is a test on it. `detectDialogs` composes the ask push, and the actions
    // it attaches come from `this.hookStates`; with the old ordering that map
    // was always one tick behind, so whether a question arrived answerable
    // from the notification depended on how the 2-second poll happened to
    // straddle the hook's write. Sweeping first costs nothing (both lanes
    // share the one `records` read below).
    //
    // It NARROWS that window; it does not close it. The sweep reads a
    // session's hookstate at time s and `detectDialogs` captures its pane at
    // time c, sequentially, each capture an agent round trip in remote mode —
    // so for the last session of eight, c-s is a couple of hundred ms of a
    // 2000 ms tick. A `session-hook.sh` write landing inside (s, c) still
    // yields a menu with no envelope, and therefore an action-less ask push.
    // What covers the residue is `actionlessAsks` in `detectDialogs` below:
    // the latch remembers that push and amends it when the envelope turns up.
    await this.sweepHookStates(records);
    const pending = await this.detectDialogs(this.primed, records);
    await this.sweepTasks();
    // NEVER awaited: it shells out over the network and `gh` has no
    // --timeout, so awaiting it would stall the dialog detector and the
    // busy->idle push behind GitHub's reachability.
    void this.sweepPr().catch(() => { /* one bad sweep must not kill the poll */ });
    if (this.deps.refreshCaps && Date.now() - this.lastCapsAt >= CAPS_REFRESH_MS) {
      this.lastCapsAt = Date.now();
      // NEVER awaited: same reasoning as sweepPr immediately above — caps()
      // swallows its own failures today, but a wedged-yet-connected agent
      // must not stall assembleFleet behind an up-to-15s request timeout,
      // and a future implementation that DOES reject must not become an
      // unhandled rejection via start()'s `void this.tick()`.
      void this.deps.refreshCaps().catch(() => { /* one bad refresh must not kill the poll */ });
    }
    // NEVER awaited, same reasoning as sweepPr above and then some: this one
    // joins the per-session KeyedQueue, which `POST /workspace/reap` can hold
    // for minutes. Awaiting it would put the dialog detector and the
    // busy->idle push behind a reap. Overlapping sweeps are harmless — the
    // attempted-set is written BEFORE the call, so a second sweep's condition 4
    // refuses the pair the first is still running.
    void this.sweepNames().catch(() => { /* one bad sweep must not kill the poll */ });
    // NEVER awaited, same reasoning as sweepNames immediately above: this one
    // joins the per-session KeyedQueue AND calls sendPrompt, whose worst case
    // is ~4.3 s of sleeps per message plus one round trip per line
    // (`inject/send.ts:26-36,115,126`). Awaiting it would put the dialog
    // detector and the busy->idle push behind a mail delivery.
    void this.sweepMail().catch(() => { /* one bad sweep must not kill the poll */ });
    const sessions = await assembleFleet(this.deps.io, this.deps.cfg, this.deps.tmux, undefined, pending, this.statuslines, this.taskProgress, this.prStates, this.hookStates);
    // The whole fleet is in scope right here, which is exactly what
    // `pushOne`'s copy rule needs and `detectDialogs`/`sweepPr` below don't
    // have on their own clocks — see `activeProjects`'s own comment.
    const projects = new Set(sessions.filter((s) => s.status !== 'dead').map((s) => s.project));
    // Push on a busy→idle finish (a session completed a turn). Skip the priming
    // tick — otherwise a restart notifies for every currently-idle session.
    if (this.primed) {
      for (const s of sessions) {
        if (this.prevStatus.get(s.id) === 'busy' && s.status === 'idle') {
          this.pushOne({ kind: 'done', sessionId: s.id, project: s.project, title: '✓ Finished', body: 'Finished — back to idle' }, projects);
        }
      }
    }
    for (const s of sessions) this.prevStatus.set(s.id, s.status);
    this.activeProjects = projects;
    this.primed = true;
    if (this.deps.cfg.fleetMode === 'remote' && this.deps.fleetState?.connected) {
      try { await saveSnapshot(sessions, this.cachePath); } catch { /* best-effort cache — never blocks the poll */ }
    }
    const json = JSON.stringify(sessions);
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.bus.emit('fleet', sessions);
  }

  /**
   * Every push goes through here, so the copy rules are stated once.
   *
   *  - Project context ONLY when more than one project is active. The server
   *    knows the whole fleet at push time, so it can tell — and "✓ ccrc-pwa"
   *    on a fleet running one project is noise dressed as information.
   *  - NOTHING fires for a session the operator is looking at right now. A
   *    notification for the pane on your screen trains you to dismiss
   *    notifications.
   *  - The log records what this method DECIDED to raise — after the presence
   *    gate, before delivery, and never corrected by delivery's outcome. It is
   *    not a record of what was sent: recording is unconditional while `push`
   *    is optional, so a reconnecting client's catch-up can and will list
   *    events no device ever received. `NotifyEvent`'s own docstring is the
   *    wire contract for that; keep the two saying the same thing.
   *
   *  `notifyLog` and `push` are independently optional, which is the reason
   *  above: the catch-up log is useful even on a box with no VAPID keys
   *  configured, so it is never gated on `push` being present.
   */
  private pushOne(e: { kind: NotifyEvent['kind']; sessionId: string; project: string; title: string; body: string; actions?: PushPayload['actions'] }, projects: Set<string>): void {
    if (this.deps.presence?.isVisible(e.sessionId)) return;
    const title = projects.size > 1 ? `${e.title} · ${e.project}` : e.title;
    this.deps.notifyLog?.record({ kind: e.kind, sessionId: e.sessionId, title, body: e.body });
    void this.deps.notifyLog?.flush();
    void this.deps.push?.notify({ title, body: e.body, sessionId: e.sessionId, tag: `${e.kind}-${e.sessionId}`, ...(e.actions ? { actions: e.actions } : {}) });
  }

  /**
   * Refresh every session's hook state, every tick — no slower clock of its
   * own, unlike sweepTasks/sweepPr below: `readHookState` is one local JSON
   * read per session and already gates its own freshness and identity, so
   * there is nothing to amortize by sampling it less often. The map is
   * rebuilt each tick, same discipline as sweepTasks, so a de-registered
   * session's state can't linger.
   *
   * `records` is `tick()`'s own registry read, passed in rather than fetched
   * again here — see the comment in `tick()`. Optional (defaulting to its own
   * read) so this stays independently callable, same shape as
   * `detectDialogs` below.
   */
  private async sweepHookStates(records?: SessionRecord[]): Promise<void> {
    const now = Date.now();
    const recs = records ?? await readRegistry(this.deps.io, this.deps.cfg);
    const next = new Map<string, HookState>();
    await Promise.all(
      recs.map(async (r) => {
        const hs = await readHookState(this.deps.io, this.deps.cfg.registryDir, r.id, r.uuid, now);
        if (hs) next.set(r.id, hs);
      }),
    );
    this.hookStates = next;
  }

  /**
   * Refresh every session's plan progress, at most once per TASK_SWEEP_MS. The
   * map is rebuilt from the registry each sweep, so a de-registered session's
   * progress can't linger.
   */
  private async sweepTasks(): Promise<void> {
    const now = Date.now();
    if (this.lastTaskSweep !== 0 && now - this.lastTaskSweep < TASK_SWEEP_MS) return;
    this.lastTaskSweep = now;
    const records = await readRegistry(this.deps.io, this.deps.cfg);
    const next = new Map<string, TaskProgress>();
    await Promise.all(
      records.map(async (r) => {
        const cfgDir = this.deps.cfg.wrappers[r.wrapper];
        if (!cfgDir) return;
        const p = taskProgress(await readTasks(this.deps.io, cfgDir, r.uuid));
        if (p) next.set(r.id, p);
      }),
    );
    this.taskProgress = next;
  }

  /**
   * May we spend a transcript tail read on this session's title? Records the
   * state we read at, so the next sweep can tell whether anything could have
   * changed.
   *
   * A transcript with no `ai-title` is a PERMANENT state, not a startup window
   * — nine of the 609 on this box carry none, including some very large ones
   * — so re-reading them every ten seconds (`NAME_SWEEP_MS`, THIS lane's real
   * cadence, not a hypothetical one) forever is roughly 7.7 MB/min across the
   * agent WS to learn nothing: six sweeps a minute times nine transcripts
   * averaging under the 256 KB tail cap (`TITLE_TAIL_BYTES`). `NAME_SWEEP_MS`'s
   * own comment derives the faster, rejected 2 s-tick cost from this same
   * figure rather than re-measuring — the two must never state two different
   * numbers for the same nine files. Byte-identical bytes cannot have started
   * saying something they did not say last time. Copied from
   * `SessionStream.claimAskRead` (`sessionws.ts:178-187`), keyed per SESSION
   * rather than per stream because this map outlives any one socket.
   */
  private claimTitleRead(id: string, file: string, st: { size: number; mtimeMs: number } | null): boolean {
    if (st === null) {              // no transcript yet — nothing to read, nothing to remember
      this.titleProbe.delete(id);
      return false;
    }
    const p = this.titleProbe.get(id);
    if (p !== undefined && p.file === file && p.size === st.size && p.mtimeMs === st.mtimeMs) return false;
    this.titleProbe.set(id, { file, size: st.size, mtimeMs: st.mtimeMs });
    return true;
  }

  /**
   * Rename every workspace that is still on its born branch to the name Claude
   * Code already wrote. Four conditions, in this order, and the order is the
   * design:
   *
   *   1. it is a workspace, not a main checkout, and not archived — `ccd
   *      ws-archive` "DESTROYS NOTHING" (`ccd:1711`), so an archived row keeps
   *      `workspace`, `branch = ws/<slug>`, its worktree and its transcript,
   *      fully in scope for conditions 2-4 unless excluded here; same guard,
   *      same shape, as the write right below this one in the file
   *      (`archiveMerged`, `r.workspace === null || r.archivedAt !== null`) —
   *      review finding 2;
   *   2. the REGISTRY says the branch is still exactly `ws/<workspace>` —
   *      condition 2 is also the idempotence marker, which is why there is no
   *      new registry field, no marker file and nothing to purge on reap;
   *   3. the fleet's ccd implements the verb — asked BEFORE the probe below is
   *      recorded, so a fleet that installs a newer ccd re-reads transcripts
   *      that have not changed since;
   *   4. this `(incarnation, derived name)` pair has not been attempted, AND
   *      the incarnation has not been retired outright by an earlier refusal
   *      that is permanent by construction (`PERMANENT_REFUSALS` — review
   *      finding 1; `nameSweepRetired` is checked first, since it is the
   *      cheaper question and answers it without a stat or a transcript
   *      read). "Incarnation" is `<id>#<uuid>`, not the bare session id — see
   *      `attemptedRenames`'s own docstring for why a recycled slug needs the
   *      uuid too.
   *
   * KNOWN GAP IN CONDITION 3, accepted and not engineered around: `ccd caps`
   * has advertised `ws-rename` since long before it took flags (`ccd:1628`), so
   * a fleet on an older ccd passes the verb gate. The old body binds the verb's
   * two arguments positionally — `local id="${1:?usage: …}"; local
   * new="${2:?…}"` — and this argv is `['ws-rename', '--session', <id>,
   * '--branch', <name>]`, so `$1` is the literal string `--session` and `$2`
   * is `<id>` — BOTH non-empty, so neither `${1:?}` nor `${2:?}` fires. It
   * falls through to `[[ -f "$REG/$id.uuid" ]] || die "no such session: $id"`
   * with `id` bound to `--session`, and dies `no such session: --session` —
   * NOT bash's own usage refusal (measured; see review finding 3). That is one
   * non-ok result per (session, derived name), absorbed by the retry guard,
   * and the rollout is agent-first so the window is one deploy long.
   *
   * The `<id>.uuid` inherited limitation applies and is not fixed here: it is
   * written once at `ccd start` and never refreshed, so after a `/clear` the
   * resolved path points at the superseded transcript. The chat stream and
   * `sessionCommands` share it; in practice this fires minutes after creation,
   * when the uuid is fresh.
   *
   * PUBLIC, unlike `sweepTasks`/`sweepPr`, and for a reason that is about the
   * tests being real rather than about convenience: `tick()` dispatches this
   * with `void` (it can sit on the queue for minutes), so a test that awaits
   * `tick()` has NOT awaited the sweep — every negative assertion about it
   * would pass while it was still running. `tick()` is already public for the
   * same class of reason.
   */
  async sweepNames(): Promise<void> {
    const now = Date.now();
    if (this.lastNameSweep !== 0 && now - this.lastNameSweep < NAME_SWEEP_MS) return;
    this.lastNameSweep = now;
    // The REGISTRY's branch, never the assembled `FleetSession.branch`: that one
    // is `sl?.branch ?? r.branch` (fleet.ts:155) and the statusline wins, so it
    // lags a rename by however long Claude Code takes to re-render its pane.
    // Same reason sweepTasks and sweepPr read the registry themselves.
    const records = await readRegistry(this.deps.io, this.deps.cfg);
    for (const r of records) {
      // `ws-archive` destroys nothing — an archived row is still `workspace
      // !== null` with `branch` still at the born name — so it is excluded
      // here explicitly, the same shape `archiveMerged` below already uses.
      if (r.workspace === null || r.archivedAt !== null) continue;
      const born = `ws/${r.workspace}`;
      if (r.branch !== born) continue;
      // Keyed by id AND uuid, not id alone: `<project>-<slug>` is a SLUG,
      // recycled by ws-reap (`ccd:950-951`'s "144 per project, recycled") —
      // `_ws_slug_free` only ever checks live registry rows, which `_reg_purge`
      // deletes on reap, so nothing stops a later `ws-add` drawing the same
      // slug for an unrelated workspace. `r.uuid` is the Claude Code session
      // uuid, freshly minted by every `ws-add`, so a recycled id pairs with a
      // NEW uuid and this key cannot collide with a retired incarnation of the
      // same id — the same self-healing property `titleProbe` already has by
      // keying on a transcript PATH that changes with the uuid.
      const incarnation = `${r.id}#${r.uuid}`;
      // The cheapest question in the function, asked before anything that
      // costs a stat or a read: THIS INCARNATION, once retired by a permanent
      // refusal (`has-upstream` and its siblings), never un-retires — but a
      // uuid rotation (`nameSweepRetired`'s docstring) computes a different
      // incarnation for the same session id, which was never added here.
      if (this.nameSweepRetired.has(incarnation)) continue;
      // A PROBE argv: it is never sent. `verbSupported` reads argv[0] only, and
      // asking here — before `claimTitleRead` writes anything — is what makes
      // "an unsupported verb records no attempt" true of the stat gate as well
      // as of the attempted set.
      if (!verbSupported(this.deps.fleetState, CCD_ARGV.wsRename(r.id, born))) continue;
      const cfgDir = this.deps.cfg.wrappers[r.wrapper];
      if (!cfgDir) continue;
      const file = transcriptPath(cfgDir, r.workdir, r.uuid);
      if (!this.claimTitleRead(r.id, file, await this.deps.io.stat(file))) continue;
      const title = await readAiTitle(this.deps.io, file);
      if (title === null) continue;
      const branch = deriveBranch(title);
      // A title that slugifies to nothing has no pair to mark: the retry key is
      // `<incarnation>:<derived-branch>` and there is no derived branch. The
      // stat gate is what stops it being re-read, which is the same protection
      // the marked pairs get.
      if (branch === null) continue;
      const key = `${incarnation}:${branch}`;
      if (this.attemptedRenames.has(key)) continue;
      this.attemptedRenames.add(key);
      // AFTER the add, deliberately: the spec's error table marks this pair
      // attempted, and the key is the one this session would have used.
      if (branch === born) continue;      // the title already names the workspace
      // Through the per-session queue, so it serialises against every other
      // server-originated write on this session — the reap it must not race is
      // POST /workspace/reap, which is already queued. It does NOT serialise
      // against a ws-reap or ws-restore run by hand on the box: those take
      // `$REG/.reap-$id.lock`, which ws-rename does not, and that residue is
      // accepted (a hand-run reap on a workspace whose first turn is still
      // landing is not a case worth a lock for, and the rename is a
      // `git branch -m` a reap would immediately make moot).
      const res = await this.deps.queue.run(r.id, () => this.deps.runCcd(CCD_ARGV.wsRename(r.id, branch)));
      if (!res.ok) {
        console.warn(`ccrc-server: ws-rename ${r.id} -> ${branch} failed: ${res.stderr.trim()}`);
        continue;
      }
      let answer: { refused?: unknown; old?: unknown; new?: unknown } = {};
      try { answer = JSON.parse(res.stdout.trim()) as typeof answer; }
      catch { /* not an answer we can read — an older ccd, or a fault */ }
      if (typeof answer.refused === 'string') {
        console.warn(`ccrc-server: ws-rename ${r.id} -> ${branch} refused: ${answer.refused}`);
        // Permanent by construction: nothing about a LATER title can make a
        // pushed branch un-pushed, or a foreign/unregistered worktree become
        // this session's own. Retire the session, not just this pair — see
        // `nameSweepRetired`.
        if (PERMANENT_REFUSALS.has(answer.refused)) this.nameSweepRetired.add(incarnation);
      } else if (typeof answer.old === 'string' && typeof answer.new === 'string') {
        // THE only line a successful rename ever writes — without it, the
        // sweep's most common outcome (the branch actually landing on the
        // title) leaves nothing a post-deploy audit can grep for.
        console.log(`ccrc-server: ws-rename ${r.id} ${answer.old} -> ${answer.new}`);
        // `res.ok` is true here even when `ccd`'s two origin probes
        // (`has-upstream`'s second check, the `$new` collision check) could
        // not reach origin: both warn-and-continue rather than refuse, so the
        // rename still succeeds and the only trace of the degradation is this
        // stderr string. Discarding it on the success arm alone (the `!res.ok`
        // branch above already surfaces stderr on a hard failure) lost the one
        // signal that a rename which LOOKED clean actually ran origin-blind.
        const warn = res.stderr.trim();
        if (warn !== '') console.warn(`ccrc-server: ws-rename ${r.id} -> ${branch}: ${warn}`);
      }
    }
  }

  /**
   * Deliver queued mail, one message per eligible session per sweep.
   *
   * SIX CONJUNCTS, in this order, cheapest first — and the order is the design,
   * because every rung below the first is a read that crosses the agent WS in
   * remote mode:
   *
   *   0. the lane is primed (a restart delivers no storm — spec:256-258);
   *   1. `$REG/mail-disabled` is absent, by DIRECTORY LISTING, fail-shut;
   *   2. this session is off its per-session cooldown;
   *   3. tmux has the session;
   *   4. the hookstate is fresh AND says `done` AND carries no ask — `done` is
   *      the hook's idle, and `readHookState` has already applied the freshness
   *      and uuid gates (`hookstate.ts:149-154`), so a stale or foreign file
   *      reads as null and null is NOT idle;
   *   5. the live status file says AFFIRMATIVELY idle and `statusUpdatedAt` is
   *      at least `MAIL_QUIET_MS` old. Affirmatively, because `liveStatus`
   *      answers `'idle'` for a missing pid, a missing config dir and an
   *      unreadable file (`fleet.ts:118-131`) — `archiveSafety`'s rule
   *      (`:731-736`, "MUST NOT collapse `unknown` to idle") applies here for
   *      the same reason: this ends in a keystroke.
   *
   * ONLY THEN `sendPrompt`, unchanged, with its whole proof discipline —
   * echo verified, `draft-present` refused, `dialog-open` refused — inside the
   * session's own `KeyedQueue` slot. NOTHING HERE TEACHES IT TO RETRY: the
   * two-Enter budget and `submitEnter`'s one-Enter doctrine
   * (`inject/send.ts:456-460`) are load-bearing, and the escalation for a stuck
   * box is the human.
   *
   * `replaceDraft` IS NEVER PASSED. A half-typed human message outranks every
   * agent-to-agent finding in this system; `draft-present` is a back-off, and
   * the mail is still there in two minutes.
   *
   * WHAT THIS CANNOT SEE, stated because it bounds the guarantee: Claude Code
   * silently QUEUES a prompt sent mid-turn and renders the hint in a dim span
   * that `draftOf` strips (`inject/send.ts:61`, pinned against a live capture
   * at `send.test.ts:642`). So "the box reads empty" is not "nothing is
   * pending", and the gate above is what keeps the lane away from a busy
   * session in the first place — not the send path, which would happily
   * succeed.
   *
   * CROSS-SWEEP SINGLE-FLIGHT (review findings 1/5), on TOP of the six
   * conjuncts and the per-sweep `seen` set: `mailInFlight` is written BEFORE
   * `sendPrompt` is called and cleared once it resolves, so a second sweep
   * that starts while the first is still blocked inside `sendPrompt` (behind
   * this session's `KeyedQueue`, which any other server-originated write can
   * be holding) refuses the SAME row instead of re-passing a gate that has
   * not changed and enqueueing a second send for it.
   *
   * THE `UserPromptSubmit` EDGE IS SAMPLED SEPARATELY (review finding 3),
   * over `store.deliveredUnacked()` — every `delivered`, unacked row, with NO
   * due-timing filter — rather than folded into the loop below over
   * `store.dueDeliveries()`. `dueDeliveries`'s replay arm does not select a
   * `delivered` row until `MAIL_REPLAY_MS` has already elapsed, so sampling
   * the edge only from ITS result could never observe a turn that started
   * (and, ordinarily, ended) any time before that — which is every ordinary
   * turn. See `CoordStore.deliveredUnacked`'s own docstring.
   *
   * `tick()` dispatches this with `void` (it can sit on the queue for as long
   * as `sendPrompt` does), so a test that awaits `tick()` has NOT awaited the
   * sweep — every negative assertion about it would pass while it was still
   * running. PUBLIC for the same reason `sweepNames` is.
   */
  async sweepMail(): Promise<void> {
    if (!this.primed) return;
    const store = this.deps.coord;
    if (!store) return;
    const now = Date.now();
    if (this.lastMailSweep !== 0 && now - this.lastMailSweep < MAIL_SWEEP_MS) return;
    this.lastMailSweep = now;

    // Fail-shut: a registry we cannot list is a kill-switch we cannot read.
    const listing = await this.deps.io.readdir(this.deps.cfg.registryDir);
    if (listing === null || listing.includes(MAIL_DISABLED_MARKER)) return;

    const unacked = store.deliveredUnacked();
    const dueBefore = store.dueDeliveries(now, MAIL_REPLAY_MS);
    if (unacked.length === 0 && dueBefore.length === 0) return;
    const records = await readRegistry(this.deps.io, this.deps.cfg);
    const uuidByToId = new Map(records.map((r) => [r.id, r.uuid] as const));
    // One hookstate read per SESSION this sweep, shared between the edge
    // sample below and the gate's own read further down — both use this same
    // `now`, so a cached answer is exactly as fresh as a second read would
    // be. A `Map`, not a plain object, so a session with no readable
    // hookstate (a real miss) is distinguishable from "not looked up yet"
    // via `.has` rather than an `undefined` that could mean either.
    const hsCache = new Map<string, HookState | null>();
    const hookStateFor = async (toId: string): Promise<HookState | null> => {
      if (hsCache.has(toId)) return hsCache.get(toId) ?? null;
      const uuid = uuidByToId.get(toId);
      const hs = uuid === undefined ? null
        : await readHookState(this.deps.io, this.deps.cfg.registryDir, toId, uuid, now);
      hsCache.set(toId, hs);
      return hs;
    };

    // The UserPromptSubmit edge, over EVERY delivered-unacked row — see this
    // method's own docstring and review finding 3. A recipient that has gone
    // (`uuidByToId` has no entry) reads as no edge, same as `due`'s own loop
    // treats a vanished recipient: the row waits.
    for (const row of unacked) {
      if (row.deliveredAt === null) continue;   // defensive; markDelivered always sets it
      const hs = await hookStateFor(row.toId);
      if (hs !== null && hs.event === 'UserPromptSubmit' && hs.updatedAt > (row.ingestedAt ?? row.deliveredAt)) {
        store.markIngested(row.id, hs.updatedAt);
      }
    }

    // Re-read due-ness AFTER the edge sample above, not before: `markIngested`
    // can only ever push a row's replay clock LATER, so a `dueBefore` row
    // whose edge just landed could have gone from due to not-due in the same
    // sweep. Skipped when nothing was sampled (`unacked.length === 0`) —
    // nothing could have changed, so `dueBefore` is still exact and a second
    // identical query would only cost, never correct, anything.
    const due = unacked.length === 0 ? dueBefore : store.dueDeliveries(now, MAIL_REPLAY_MS);
    if (due.length === 0) return;
    const seen = new Set<string>();          // one message per session per sweep
    for (const d of due) {
      if (seen.has(d.toId)) continue;
      if (this.mailInFlight.has(d.toId)) continue;   // review findings 1/5 — see this method's docstring
      const last = this.mailCooldown.get(d.toId) ?? 0;
      if (now - last < MAIL_COOLDOWN_MS) continue;
      const rec = records.find((r) => r.id === d.toId);
      if (!rec) continue;                    // a recipient that went away: the row waits
      if (!(await this.deps.tmux.hasSession(d.toId))) continue;
      const hs = await hookStateFor(d.toId);
      if (hs === null || hs.state !== 'done' || hs.ask !== null) continue;
      const pid = await this.deps.tmux.panePid(d.toId);
      const cfgDir = this.deps.cfg.wrappers[rec.wrapper];
      if (!pid || !cfgDir) continue;
      const live = await readLiveState(this.deps.io, cfgDir, pid);
      if (!live || liveSessionStatus(live.status) !== 'idle') continue;
      if (live.statusUpdatedAt === null || now - live.statusUpdatedAt < MAIL_QUIET_MS) continue;

      seen.add(d.toId);
      this.mailInFlight.add(d.toId);
      try {
        // The stored envelope, byte for byte. `renderEnvelope` is not called
        // here and must never be: spec:176-177's "verbatim, never re-rendered".
        const res = await sendPrompt({ tmux: this.deps.tmux, queue: this.deps.queue }, d.toId, d.envelope);
        if (res.ok) {
          this.mailCooldown.set(d.toId, now);
          store.markDelivered(d.id, now);
          continue;
        }
        const attempts = d.attempts + 1;
        // The park below applies ONLY to a row that has NEVER been delivered
        // (review finding 4): `d.deliveredAt === null` is the row's own,
        // durable proof of that. Rejecting a row that HAS been delivered
        // would write a false 'undeliverable' record over a message that
        // demonstrably reached the recipient, and would silently end
        // replay-until-ack (spec:174-177) — see `MAIL_MAX_ATTEMPTS`'s own
        // docstring for the full reasoning, including why this is also what
        // makes `MAIL_BACKOFF_MAX_MS` reachable (review finding 9).
        if (d.deliveredAt === null) {
          // `enter-ignored` is terminal HERE and nowhere else, and only for a
          // row that has never been delivered: the text is sitting in a
          // FRESH box, `submitEnter`'s doctrine forbids a blind third Enter,
          // and the rescue is a human looking at the pane. Re-injecting would
          // type the whole envelope a second time UNDER the first one.
          if (res.error === 'enter-ignored') {
            store.rejectDelivery(d.id, 'undeliverable', res.error);
            continue;
          }
          if (attempts >= MAIL_MAX_ATTEMPTS) {
            store.rejectDelivery(d.id, 'undeliverable', res.error);
            continue;
          }
        }
        const step = Math.min(MAIL_BACKOFF_BASE_MS * 2 ** (attempts - 1), MAIL_BACKOFF_MAX_MS);
        store.backOff(d.id, res.error, now + step);
      } finally {
        this.mailInFlight.delete(d.toId);
      }
    }
  }

  /**
   * One `ccd pr-state --project <p>` per project with at least one workspace,
   * then a LEVEL evaluation of the archive condition. Level, not edge: there
   * is no prevPhase file and no "did we see the transition" flag, because the
   * producer and the consumer are different processes on different boxes with
   * no acknowledgement — a partial sweep killed at the outer timeout, an agent
   * disconnect or a busy-skip would destroy the edge permanently and strand
   * the workspace in a state the UI claims was archived. `ws-archive` is
   * idempotent, so retrying every 120 s is free and self-healing.
   */
  private async sweepPr(): Promise<void> {
    const now = Date.now();
    // Single-flight, but never permanently. A sweep still running after
    // PR_SWEEP_STUCK_MS is abandoned — not cancelled, there is nothing to
    // cancel; it is simply no longer allowed to hold the lane shut.
    if (this.prSweepStartedAt !== 0 && now - this.prSweepStartedAt < PR_SWEEP_STUCK_MS) return;
    // The same guard tick() already applies before saveSnapshot: with the
    // agent down there is nothing to read and every state keeps its checkedAt.
    if (this.deps.cfg.fleetMode === 'remote' && !this.deps.fleetState?.connected) return;
    const anyPending = [...this.prStates.values()].some((s) => s.phase === 'open' && s.checks === 'pending');
    const due = anyPending ? PR_SWEEP_ACTIVE_MS : PR_SWEEP_MS;
    if (this.lastPrSweep !== 0 && now - this.lastPrSweep < due) return;
    this.lastPrSweep = now;
    const mySweep = now;
    this.prSweepStartedAt = mySweep;
    try {
      const records = await readRegistry(this.deps.io, this.deps.cfg);
      const projects = [...new Set(records.filter((r) => r.workspace !== null).map((r) => r.project))];
      for (const project of projects) {
        const back = this.prBackoff.get(project);
        if (back && now < back.until) continue;
        const argv = CCD_ARGV.prStateProject(project);
        if (!verbSupported(this.deps.fleetState, argv)) {
          for (const r of records.filter((x) => x.project === project && x.workspace !== null)) {
            // retryAt: null — an unsupported verb is not a scheduled retry, and a
            // stale `until` from an earlier backoff must not survive as a promise.
            this.prStates.set(r.id, { ...(this.prStates.get(r.id) ?? UNCHECKED_PR), phase: 'unknown', reason: 'unsupported', retryAt: null });
          }
          continue;
        }
        const res = await this.deps.runCcd(argv);
        if (!res.ok) { this.backoffPr(project, now, 'agent-down', records); continue; }
        const lines = parsePrLines(res.stdout);
        // A WHOLE-REPO failure — the id-less shape, emitted by `_gh_repo_slug`,
        // `_gh_pr_list`, and `_pr_py` for an unparseable rc-0 body — really
        // does mean every session of this repo is unreadable (each is one gh
        // answer for the whole repo), so it backs the project off. Note the
        // unparseable-body case emits one id-less object PER SESSION in a
        // --project sweep; `find` taking the first is correct because they all
        // describe the same repo-wide fact. A PER-SESSION failure
        // carries an `id` and must not: one workspace whose registry lost its
        // `branch` is one broken session, and §6's "Partial sweep" row promises
        // its seven siblings keep their own answers.
        const failure = lines.find((l) => !('id' in l)) as CcdPrFailure | undefined;
        if (failure !== undefined) { this.backoffPr(project, now, failure.reason, records); continue; }
        this.prBackoff.delete(project);
        for (const line of lines) {
          if (!isFullLine(line)) {
            // Greyed alone, and NEVER passed to phaseFor: it has no `rows`, so
            // `boundRow(undefined, …)` would throw inside this void-dispatched
            // sweep and lose every project after this one.
            //
            // The id-LESS shape already backed the project off and `continue`d
            // above, so anything reaching here carries an id — but the union
            // still admits CcdPrFailure, so NARROW rather than assert: a cast
            // here would be the same "trust the shape" move that made
            // discriminating on `id` wrong in the first place.
            if (!('id' in line)) continue;
            this.prStates.set(line.id, { ...(this.prStates.get(line.id) ?? UNCHECKED_PR), phase: 'unknown', reason: line.reason, retryAt: null });
            continue;
          }
          this.prStates.set(line.id, phaseFor(line));
        }
      }
      await this.archiveMerged(records);
    } finally {
      // Only the CURRENT sweep may clear the stamp. An abandoned sweep that
      // finally returns half an hour later must not unlatch the one that
      // replaced it — `lastPrSweep` gating makes two starts in the same
      // millisecond impossible, so the timestamp is a sufficient identity.
      if (this.prSweepStartedAt === mySweep) this.prSweepStartedAt = 0;
    }
  }

  /** A failed read never overwrites a good phase — only greys it — and an
   *  unauthenticated lane jumps straight to the ceiling, because retrying a
   *  revoked token every two minutes buys nothing. */
  private backoffPr(project: string, now: number, reason: PrState['reason'], records: SessionRecord[]): void {
    const prev = this.prBackoff.get(project);
    const step = reason === 'unauthenticated' || reason === 'rate-limit'
      ? PR_BACKOFF_MAX_MS
      : Math.min((prev?.step ?? PR_SWEEP_MS) * 2, PR_BACKOFF_MAX_MS);
    this.prBackoff.set(project, { until: now + step, step });
    for (const r of records.filter((x) => x.project === project && x.workspace !== null)) {
      const keep = this.prStates.get(r.id) ?? UNCHECKED_PR;
      // `retryAt` is `until` on the wire. §6's rate-limit row promises reason AND
      // retry time, and a 15-minute flat backoff with neither is indistinguishable
      // from a cap that has simply stopped working.
      this.prStates.set(r.id, { ...keep, phase: 'unknown', reason, retryAt: now + step });
    }
  }

  /**
   * `'ok' | 'busy' | 'attached' | 'unknown'`, and it MUST NOT collapse
   * `unknown` to idle. `liveStatus` answers `'idle'` when the pid or the
   * config dir is missing or the status file is unreadable, and in remote mode
   * both of those reads cross the agent WS — so a socket hiccup reads as "not
   * working". Archive needs an AFFIRMATIVE idle.
   *
   * IT ALSO CARRIES `held`, read from the SAME fresh registry read — fix-wave
   * findings 1/5. This is the only registry read that happens at the archive
   * DECISION POINT; `archiveMerged`'s own `records` argument is the snapshot
   * `sweepPr` took before it awaited one gh-bound `ccd pr-state` per project
   * (20 s budget each, and a sweep is only abandoned after PR_SWEEP_STUCK_MS =
   * 15 min), so a hold placed while the sweep is in flight is invisible there.
   * The wave boundary IS the modal instant for placing one — the merge that
   * ends wave N is what tells the orchestrator to hold for wave N+1 — so the
   * stale window is exactly the window the feature exists for, and
   * `ccd ws-archive` has no held rung of its own to catch what slips through
   * (deliberately: a by-hand archive of a held workspace must still work, see
   * README and PrSheet). This function already had the fresh record in hand
   * and threw the field away; now it returns it.
   *
   * `held` is null for the `attached` answer, which returns BEFORE the read:
   * that answer defers the archive anyway, so nothing can be destroyed by not
   * knowing — the only thing lost is the held-merged push, which the caller's
   * snapshot rung fires whenever the hold predates the sweep.
   */
  async archiveSafety(id: string): Promise<{ verdict: 'ok' | 'busy' | 'attached' | 'unknown'; held: string | null }> {
    if (this.bus.listenerCount(`session:${id}`) > 0) return { verdict: 'attached', held: null };
    const rec = (await readRegistry(this.deps.io, this.deps.cfg)).find((r) => r.id === id);
    if (!rec) return { verdict: 'unknown', held: null };
    const held = rec.held;
    if (!(await this.deps.tmux.hasSession(id))) return { verdict: 'ok', held };   // no pane: nothing is running
    const pid = await this.deps.tmux.panePid(id);
    const cfgDir = this.deps.cfg.wrappers[rec.wrapper];
    if (!pid || !cfgDir) return { verdict: 'unknown', held };
    const live = await readLiveState(this.deps.io, cfgDir, pid);
    if (!live) return { verdict: 'unknown', held };
    return { verdict: liveSessionStatus(live.status) === 'busy' ? 'busy' : 'ok', held };
  }

  /** The held-merged push: once per (workspace, PR), from whichever rung saw
   *  the hold — the snapshot's or `archiveSafety`'s fresh read. One latch key,
   *  so the two rungs can never both announce the same pair. */
  private notifyHeldMerged(r: SessionRecord, number: number | null, reason: string): void {
    const key = `${r.id}#${number ?? '?'}`;
    if (this.heldMergedNotified.has(key)) return;
    this.heldMergedNotified.add(key);
    this.pushOne({
      kind: 'merged', sessionId: r.id, project: r.project,
      title: `✓ merged › ${r.workspace}`,
      body: `PR #${number ?? '?'} merged — ${reason}; nothing archived.`,
    }, this.activeProjects);
  }

  private async archiveMerged(records: SessionRecord[]): Promise<void> {
    for (const r of records) {
      const pr = this.prStates.get(r.id);
      if (r.workspace === null || r.archivedAt !== null) continue;
      if (pr?.phase !== 'merged') continue;                 // unknown NEVER archives
      if (r.held !== null) {
        // A program claims this workspace: the merge is a WAVE boundary, not
        // the end. Archive nothing; say so once per (workspace, PR) — the
        // in-memory latch (see its own comment) means a server restart may
        // repeat the push, which the shared `merged-<id>` collapse tag turns
        // into a replace, not a stack. The bucket ladder is untouched: no
        // `archivedAt` is written, so the workspace stays in the live
        // buckets exactly as an ordinary session would.
        //
        // THE SNAPSHOT'S RUNG, and it is the fast one, not the authoritative
        // one: `records` was read at the top of `sweepPr`, before every
        // gh-bound round trip. It can only ever be a hold that ALREADY
        // existed then, so it can never be wrong in the destructive direction
        // — but it can be blind, and the `archiveSafety` rung below is the one
        // that answers for holds placed while this sweep was in flight.
        this.notifyHeldMerged(r, pr.number, r.held);
        continue;
      }
      // The FRESH answer, at the decision point: verdict and hold from one
      // registry read taken now, not from the snapshot above (findings 1/5).
      // The hold is checked FIRST because it is not a deferral of the same
      // kind — 'busy'/'attached' say "not yet", a hold says "not until a
      // human releases it", and the operator gets told which.
      const safety = await this.archiveSafety(r.id);
      if (safety.held !== null) {
        this.notifyHeldMerged(r, pr.number, safety.held);
        continue;
      }
      if (safety.verdict !== 'ok') continue;   // defers; the next sweep retries
      const argv = CCD_ARGV.wsArchive(r.id);
      // The same gate the `pr-state` sweep above and the `/archive` route
      // apply. Third instance of NF10's class, found in round 3: on a host
      // whose ccd predates `ws-archive` this call can only fail its usage
      // check, and being level-triggered it would re-fire for every merged
      // session on every sweep, forever. Skipping writes no state — the level
      // stays `merged`, so the archive happens on the first sweep after the
      // host is upgraded.
      if (!verbSupported(this.deps.fleetState, argv)) continue;
      const res = await this.deps.runCcd(argv);
      if (!res.ok) continue;
      if (res.stdout.startsWith('already archived')) continue;   // idempotent re-fire: no second push
      // AFTER the fact, and it promises only navigation: no `actions` here,
      // so an older service worker renders it exactly like every other push.
      // `this.activeProjects` — this sweep has no fleet list of its own in
      // scope (see the field's own comment) and must not block on `gh` to get
      // one.
      // `›`, not `·`: `pushOne` appends the project with `·` when more than
      // one is active, and reusing that separator here would render
      // "✓ merged · wt-foo · ccrc-pwa" with no way to tell workspace from
      // project. The old copy used `›` for exactly this reason.
      this.pushOne({
        kind: 'merged', sessionId: r.id, project: r.project,
        title: `✓ merged › ${r.workspace}`,
        body: `PR #${pr.number ?? '?'} merged; workspace archived, nothing deleted.`,
      }, this.activeProjects);
    }
  }

  /**
   * Capture each registered session's pane (dead panes capture as null); a menu
   * pane parses to a dialog. Emit `dialog` when the id changed since last tick,
   * `dialog_cleared` when a previously-reported dialog vanished. Returns the
   * set of session ids with a dialog pending, for the fleet assembly.
   *
   * The id alone is the right gate HERE, unlike the per-session stream's
   * (`nextDialogFrame`): this sweep only ever sees the bare pane parse, and its
   * `dialog` emission is consumed for the push notification and the fleet's
   * dialogPending flag — the open session's own stream owns the frame the client
   * renders, and drops these (`sessionws.ts` onSessionMsg). Enrich the parse here
   * and this gate needs the same upgrade path.
   *
   * `records` is `tick()`'s own registry read, passed in rather than fetched
   * again here (optional, defaulting to its own read, so this stays
   * independently callable) — same sharing as `sweepHookStates` above.
   */
  private async detectDialogs(notify: boolean, records?: SessionRecord[]): Promise<Set<string>> {
    const pending = new Set<string>();
    const recs = records ?? await readRegistry(this.deps.io, this.deps.cfg);
    for (const r of recs) {
      const pane = await this.deps.tmux.capture(r.id);
      // Same capture feeds the statusline read — no extra tmux call. A tick
      // whose pane has no statusline (a dialog/permission overlay covers it, or
      // the session is mid-render) must NOT blank the last-known model/branch —
      // only update when we actually parsed something; drop only on a dead pane.
      if (pane === null) this.statuslines.delete(r.id);
      else {
        const sl = parseStatusline(pane);
        if (sl.model || sl.branch || sl.effort) this.statuslines.set(r.id, sl);
      }
      const dialog = pane !== null && paneState(pane) === 'menu' ? parseDialog(pane) : null;
      const last = this.dialogIds.get(r.id);
      if (dialog) {
        pending.add(r.id);
        // The pane is what raises this push (`kind: 'ask'` has exactly one
        // producer, and it is this scrape), but the ANSWERABLE part comes from
        // the hook envelope: only it carries the option labels and the content
        // key `answerAsk` gates on. `askActions` returns null wherever that
        // route would refuse, so a notification never offers a button the
        // server has already decided it will not honour. `this.hookStates` is
        // this tick's — see the ordering note in `tick()`.
        const actions = askActions(this.hookStates.get(r.id) ?? null);
        const raise = (): void => {
          // `this.activeProjects` — this sweep runs BEFORE this tick's own
          // `assembleFleet` (see `tick()`), so the current fleet's project
          // set isn't computed yet; it reads last tick's, same reasoning as
          // `archiveMerged` above.
          this.pushOne({
            kind: 'ask', sessionId: r.id, project: r.project,
            title: '❓ Question', body: dialog.title || 'Claude has a question',
            ...(actions ? { actions } : {}),
          }, this.activeProjects);
          // Latched whenever this raise had no actions, cleared the moment one
          // has them — so the amendment below fires at most once per question.
          //
          // `notify` gates the CALL, not delivery: `pushOne` returns before
          // `push.notify` whenever presence says the operator is looking at
          // this session. So the latch can be set for a question whose push was
          // suppressed, and the amendment can then "replace" a notification
          // that was never shown. Harmless in both directions — a suppressed
          // amendment is suppressed too (same presence check), and a claim that
          // lapses in between produces one answerable notification, which is
          // the outcome we wanted anyway. What it must NOT be called is proof
          // that a push went out.
          if (actions) this.actionlessAsks.delete(r.id);
          else this.actionlessAsks.set(r.id, dialog.id);
        };
        if (last !== dialog.id) {
          this.dialogIds.set(r.id, dialog.id);
          this.bus.emit(`session:${r.id}`, { type: 'dialog', dialog });
          if (notify) raise();
        } else if (notify && actions && this.actionlessAsks.get(r.id) === dialog.id) {
          // The amendment. Same question, same tag — `push-sw.js` sets
          // `renotify` from the tag, so this REPLACES the un-answerable
          // notification in its slot rather than stacking a second one under
          // it. It is a second raise, so `pushOne` records a second event in
          // the catch-up ring: the ring is a record of what was raised, and
          // two really were, which is the honest cost of not leaving the
          // question un-answerable.
          raise();
        }
      } else if (last !== undefined) {
        this.dialogIds.delete(r.id);
        this.actionlessAsks.delete(r.id);
        this.bus.emit(`session:${r.id}`, { type: 'dialog_cleared' });
      }
    }
    return pending;
  }
}
