import type { Deps } from './server.js';
import type { Bus } from './bus.js';
import { assembleFleet } from './fleet.js';
import { measuredIdentity, readRegistry, readRegistryMeasured, readSessionRecord } from './registry.js';
import { paneState, parseDialog } from './pane/dialog.js';
import { parseStatusline, type Statusline } from './pane/statusline.js';
import { defaultCachePath, loadSnapshot, saveSnapshot } from './fleetstate.js';
import { readTasks, taskProgress } from './tasks/read.js';
import { CCD_ARGV, verbSupported } from './ccdargv.js';
import { isFullLine, parsePrLines, phaseFor, type CcdPrFailure } from './prstate.js';
import { liveSessionStatus, readLiveState } from './livestate.js';
import { readHookState, type HookState } from './hookstate.js';
import { sendPrompt } from './inject/send.js';
import { askActions } from './askkey.js';
import type { SessionRecord } from './registry.js';
import type {
  CoordStatus, NotifyEvent, PrState, RunSummary, SessionStatus, TaskProgress,
} from '../../shared/api.js';
import { UNCHECKED_PR } from '../../shared/api.js';
// The pause marker's ONE definition in the tree. `MAIL_DISABLED_MARKER` is
// NOT imported beside it: this file holds its own module-local literal
// (`sweepMail` already uses it), a second `const` of that name in one scope is
// a redeclaration (TS2451), and `rundefs.ts` explains on purpose why the two
// literals exist. `single-definition.test.ts` pins both halves of that split.
import { COORDINATOR_PAUSE_MARKER } from './coord/rundefs.js';
import { readWorktreeRecords } from './coord/gitref.js';
import { divergences, unclaimedWorktrees, type DivergenceInput } from './divergence.js';
import type { PushPayload } from './push.js';
import { deriveBranch } from './naming.js';
import { TranscriptResolver } from './transcript/resolve.js';
import { readAiTitle } from './transcript/title.js';
import { MAIL_REPLAY_CEILING_ERROR, toRunSummary } from './coord/store.js';
import { renderMailNudge } from './coord/envelope.js';
import { configDirFor } from './config.js';

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

/** The census lane. A disagreement between sources is a HUMAN-timescale event —
 *  a rename, a hand-made worktree, a run left open — and each sweep reads
 *  `<projectsRoot>/<project>/.git/worktrees/` per project. Six times slower than
 *  the name sweep, deliberately: this one touches the filesystem per PROJECT,
 *  not per pane. */
const DIVERGENCE_SWEEP_MS = 60_000;

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
 *  never actually reaches this lane — see `naming.ts:26-30`.
 *
 *  `held` (Wave 3 §3.1's `ws-rename` rung) is DELIBERATELY ABSENT and must
 *  stay absent. Every member here is permanent BY CONSTRUCTION — nothing about
 *  a later title makes a pushed branch un-pushed. A hold is the opposite: it
 *  exists to be released, and it is the ONE refusal this lane can meet that a
 *  later sweep should retry. Adding it would stop naming that workspace for
 *  the life of the process with no log line saying why. Pinned by
 *  `name-sweep.test.ts`'s "does not retire an incarnation on a `held`
 *  refusal", which goes red the moment the token joins this set. */
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
 *  backs off instead of rejecting on THIS counter — `attempts` keeps
 *  counting on a delivered row too (it is one cumulative column), just
 *  without a ceiling that turns a failing SEND into a park.
 *
 *  A delivered row's own park is `MAIL_REPLAY_MAX_ATTEMPTS` below, a
 *  SEPARATE counter over successful replays (fix — review finding 20: before
 *  it existed, a delivery no one ever acked replayed "forever, bounded by
 *  ack rather than by a count" — true, and that is exactly what left
 *  spec:170-172's own terminal state structurally unreachable for any
 *  delivery that succeeded even once, since `MAIL_COOLDOWN_MS` only SPACES
 *  the injections and a send that keeps succeeding can never fail its way
 *  into this counter).
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

/** The ceiling on successful, UNACKED replays (review finding 20) — see
 *  `MAIL_MAX_ATTEMPTS`'s own docstring for why that counter cannot serve
 *  this role. At `MAIL_REPLAY_MS` (10 min) between replays, 20 attempts is
 *  a little over three hours of a recipient provably receiving the same
 *  envelope and never acking it — long enough that an ordinary slow ack
 *  (a session busy on something else for a while) never comes close, short
 *  enough that `MAIL_COOLDOWN_MS`'s own docstring's "denial of service
 *  dressed as coordination" eventually parks rather than running for the
 *  life of the box. */
const MAIL_REPLAY_MAX_ATTEMPTS = 20;

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
  /** The census lane's clock, and its byte-equality guard. A git-ref read per
   *  project is far too expensive for the 2 s poll, and a census changes on
   *  human timescales; `null` (not `'[]'`) so the first sweep always emits, even
   *  an empty one — mirroring `lastRunsJson`'s own initial value, and the reason
   *  a HEALTHY fleet is a frame rather than a silence. */
  private lastDivergenceSweep = 0;
  private lastDivergenceJson: string | null = null;
  /** `<project>/<name>` for the worktrees the PREVIOUS sweep found unclaimed —
   *  the census's one-interval debounce on `unregistered-worktree`, and the
   *  only cross-sweep memory this lane keeps. Empty at boot, so the first sweep
   *  after a restart reports no worktree of that kind; see `divergences`'s own
   *  note for why one interval of quiet is the right price. */
  private lastUnclaimedWorktrees: ReadonlySet<string> = new Set<string>();
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
  /** The sixth lane's transcript memo (§5.4) — ONE per watcher, shared across
   *  rows, keyed per `(configDir, uuid, dir)`. This lane resolves per eligible
   *  row on a 10 s clock; without the memo, every row with no transcript at its
   *  exact address would run a full uuid search on every sweep, forever. */
  private readonly transcripts: TranscriptResolver;
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
  /** `emitRuns`'s own byte-equality guard, the same idiom as `lastJson`
   *  above, over `RunSummary[]` instead of `FleetSession[]`. `null` (not
   *  `'[]'`) so the very first tick with a real `coord` always emits at
   *  least once, even into an empty fleet — mirroring `lastJson`'s own
   *  initial value. */
  private lastRunsJson: string | null = null;
  /** The `coord` frame's last value and its own byte-equality guard, beside
   *  `lastRunsJson` and for the same reasons. `coord` is `null` until the first
   *  tick measures — see `currentCoord()`. */
  private coord: CoordStatus | null = null;
  private lastCoordJson: string | null = null;
  /** Watermark: the highest `mail_deliveries.id` this lane has already
   *  raised a `mail` NotifyEvent for. Seeded to the CURRENT max id on the
   *  priming tick (`tick()`'s own `!this.primed` arm) rather than left at 0,
   *  so a restart does not replay a notify for mail queued before this
   *  process started — the same "no storm on boot" courtesy `prevStatus`
   *  gives the `done` push above, and spec's own restart semantics name by
   *  name: "the primed-quiet rule... extends to the mail lane." */
  private lastMailNotifyId = 0;
  /** Same watermark discipline as `lastMailNotifyId`, over `run_events.id`
   *  for the `run` NotifyEvent lane. */
  private lastRunNotifyId = 0;
  /** C0.1: `tick()` had NO re-entrancy guard — `start()` fires it every
   *  `intervalMs` off a bare `setInterval`, unconditionally, so a tick still
   *  in flight past the next interval edge (a slow agent-WS registry read, a
   *  wedged pane capture) got a SECOND tick stacked on top of it: two
   *  concurrent full registry reads, two concurrent `assembleFleet`s, twice
   *  the load on exactly the path that was already slow. Mirrors
   *  `SessionStream.ticking` (`sessionws.ts`) verbatim — same field, same
   *  set/clear-in-finally discipline, for the identical reason. */
  private ticking = false;
  /** C0.4-followup: true once a snapshot write has been skipped because the
   *  shrink guard below could not confirm every id that dropped out of this
   *  tick's assembly was a GENUINE purge (see the guard's own comment).
   *  Cleared the moment a write actually lands (growth, an unchanged size, or
   *  a confirmed shrink) — so a refusal warns ONCE per stretch of refusals,
   *  not once per 2-second tick for however long a read fault or a slow purge
   *  confirmation lasts, while still guaranteeing the freeze this field is
   *  named after can never be silent. */
  private snapshotWriteSkippedWarned = false;
  /** Same warn-once-per-episode discipline as `snapshotWriteSkippedWarned`
   *  immediately above, on its OWN flag (Task 2): a shrink-episode and a
   *  degrade-episode are independent conditions — a tick can trip one, the
   *  other, both, or neither — and sharing one flag would let whichever
   *  fires first silence the other's own first warning. Cleared the moment a
   *  write actually lands with every row measured clean. */
  private snapshotWriteSkippedDegradedWarned = false;

  constructor(private deps: Deps, private bus: Bus, private intervalMs = 2000, cachePath?: string) {
    this.cachePath = cachePath ?? deps.stateCachePath ?? defaultCachePath();
    this.transcripts = new TranscriptResolver(deps.io);
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

  /** The last measured marker state, for `/ws/fleet`'s cold start. `null` means
   *  THIS PROCESS HAS NEVER MEASURED — a socket that connects before the first
   *  tick is sent no `coord` frame at all, because inventing `clear` there
   *  would tell the phone the fleet is running on a box nothing has looked at.
   *  That is a different fact from `unmeasurable`, which is a measurement that
   *  came back unreadable. Same reasoning as currentPending(). */
  currentCoord(): CoordStatus | null {
    return this.coord;
  }

  async tick(): Promise<void> {
    // C0.1: a tick already in flight refuses a second one rather than
    // stacking — see `ticking`'s own docstring above. Mirrors
    // `SessionStream.tick` (`sessionws.ts`) verbatim.
    if (this.ticking) return;
    this.ticking = true;
    try {
      // Read once, share with the two lanes that would otherwise each read it
      // again on EVERY tick (detectDialogs, sweepHookStates) — in remote mode
      // every readRegistry() field is its own agent-WS round trip, so this is
      // the difference between one registry read and two, every 2s, forever.
      // sweepTasks/sweepPr below are NOT included: both throttle to their own
      // slower clock and skip the read entirely on most ticks already.
      //
      // `readRegistryMeasured`, not `readRegistry` (blocking review findings
      // 1/3): the old `[]`-on-unlistable signature made a single dropped
      // `io.readdir` — the whole-fleet cousin of the per-row ladder, and the
      // ordinary shape of one lost agent-WS round trip in remote mode — read
      // as "the fleet is now empty" to every lane below. `sweepHookStates`/
      // `sweepTasks` would rebuild both maps from zero rows, silently
      // discarding every entry the retain-don't-erase branch further down
      // exists to protect (findings 1/2's own harm, at fleet scale instead of
      // row scale), and the unconditional `bus.emit('fleet', sessions)` at
      // the bottom of this method would paint "no sessions" on every
      // connected PWA. Fail shut instead, the same evidence-not-time bound
      // `sweepMail` already draws three lanes down (`readRegistryMeasured`,
      // `!registryRead.listed` return) and `registry.ts`'s own docstring
      // states for this exact read: "a failed second listing proves nothing
      // and changes nothing".
      const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);
      // BEFORE the fail-shut return below, and on BOTH arms (D-B4-10). An
      // unlistable registry is not "nothing is set": it is the exact state
      // `dispatchRun` FAILS SHUT on (`dispatch.ts:106-109`), so it must reach
      // the wire as `unmeasurable` on the same tick it happens. Placed beside
      // `emitRuns()` instead, this would be 236 lines below a `return` — the
      // banner would sit frozen on its last value while the server refused
      // every dispatch, which is the precise lie spec §4.2 mints
      // `unmeasurable` to prevent.
      this.emitCoord(registryRead.listed ? registryRead.names : null);
      if (!registryRead.listed) {
        // Retain, don't erase, at fleet scale: `this.hookStates`/
        // `this.taskProgress`/`this.prevStatus`/`this.lastJson` are all left
        // exactly as the prior successful tick set them. Nothing is broadcast
        // this tick — a stale-but-real fleet on the connected client's screen
        // is honest; an empty one is a lie. `registry.ts`'s own
        // `noteWholeFleetListing` already logs this episode's entry and exit
        // once, not per tick (shared by every caller of `readRegistryMeasured`/
        // `readSessionRecord`), so nothing further is logged here — a box
        // that stays unlistable for an hour still gets exactly two log lines.
        // The other per-tick lanes fall into two groups, and this return skips
        // them ALL — say so completely, because the second group is easy to
        // miss. Registry-sourced (`sweepPr`/`sweepNames`/`sweepMail`): each is
        // void-dispatched with its own slower/independent clock and its own
        // registry read (`sweepMail` already fails shut the identical way), so
        // skipping one 2s dispatch costs a few seconds' delay on an
        // already-rare failure, never data. Coord-DB-sourced (`emitRuns`,
        // `pushNewMail`/`pushNewRuns`): their data source is SQLite, perfectly
        // readable while `io.readdir` fails, and they still stall here — a
        // deliberate trade for one simple early return. Bounded and lossless:
        // both notify lanes are watermark-based (`lastMailNotifyId`/
        // `lastRunNotifyId`) and catch up on the next successful tick, and
        // `emitRuns` is byte-equality guarded so it re-emits the moment it
        // runs again. Delay, never loss.
        return;
      }
      const records = registryRead.records;
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
      // NEVER awaited, same reasoning as `sweepNames` above. Own clock: this reads
      // git's admin directory per project, which is not a per-tick cost.
      //
      // NOT HANDED `registryRead.names`, deliberately, though it is sitting
      // right here and this lane needs exactly that listing. It takes its own,
      // AFTER git's records — the census weighs the two against each other, and
      // a listing snapshotted here would be three awaited lanes older than the
      // records it is compared with. `sweepDivergences` states the race in full.
      void this.sweepDivergences(records)
        .catch(() => { /* one bad sweep must not kill the poll */ });
      // NEVER awaited, same reasoning as sweepNames immediately above: this one
      // joins the per-session KeyedQueue AND calls sendPrompt, whose worst case
      // is ~4.3 s of sleeps per message plus one round trip per line
      // (`inject/send.ts:26-36,115,126`). Awaiting it would put the dialog
      // detector and the busy->idle push behind a mail delivery.
      void this.sweepMail().catch(() => { /* one bad sweep must not kill the poll */ });
      // `records` PASSED IN, never re-read here: `assembleFleet` would
      // otherwise take its OWN read (`records ?? await readRegistry(...)`),
      // a SEPARATE whole-fleet sweep a few hundred ms after the one above —
      // in remote mode, ~21 field reads per session, ~505 round trips on a
      // 24-session fleet, doubled for no reason. Sharing the read also keeps
      // `sweepHookStates`/`detectDialogs` (which already consumed `records`
      // above) and this assembly looking at the identical snapshot, which is
      // what lets `unmeasuredIds` below be derived FROM `sessions` rather
      // than computed a second, independent way off `records` — see that
      // derivation's own comment (blocking review finding 4).
      const sessions = await assembleFleet(this.deps.io, this.deps.cfg, this.deps.tmux, undefined, pending, this.statuslines, this.taskProgress, this.prStates, this.hookStates, records);
      // Blocking review finding 4: `FleetSession.unmeasured` (Task 2) now
      // carries the SAME evidence `measuredIdentity(records[i]) === null`
      // would, one hop from `records[i]` in `sessions[i]` — so this reads it
      // off the assembled rows directly (one derivation of one fact) rather
      // than re-deriving it from `records` a second, independent way, which
      // is exactly the kind of drift `fleet.ts`'s own `records`-parameter
      // docstring warns a second copy of one shape invites. Names exactly the
      // rows whose STATUS this tick could not measure: a degraded `r.wrapper`
      // (`''`) makes `configDirFor` answer `undefined`, so `assembleFleet`
      // never reaches `readLiveState` and `status` freezes at the `alive`
      // default of `'idle'` — a session that may be plainly mid-turn.
      const unmeasuredIds = new Set(sessions.filter((s) => s.unmeasured.length > 0).map((s) => s.id));
      // The whole fleet is in scope right here, which is exactly what
      // `pushOne`'s copy rule needs and `detectDialogs`/`sweepPr` below don't
      // have on their own clocks — see `activeProjects`'s own comment.
      const projects = new Set(sessions.filter((s) => s.status !== 'dead').map((s) => s.project));
      // Per-session project, off the SAME fleet assembly — the honest fallback
      // `pushNewMail` uses for run-less mail (review finding 3): a delivery's
      // `project` is null whenever the mail has no run, which `mailQueuedSince`'s
      // own docstring names as a fully supported case, not an edge one, and the
      // RECIPIENT session's own project (known here, not down in that method's
      // own scope) is the honest answer — never an empty string.
      const sessionProjects = new Map(sessions.map((s) => [s.id, s.project]));
      // Push on a busy→idle finish (a session completed a turn). Skip the priming
      // tick — otherwise a restart notifies for every currently-idle session.
      if (this.primed) {
        for (const s of sessions) {
          // Blocking review finding 2: never assert a turn completed on a row
          // this tick could not measure — `status` for a degraded row is a
          // guess (see `unmeasuredIds`'s own comment above), and a push
          // "says it happened" (the architecture doc's own words for exactly
          // this class of surface). `continue`d before the transition check,
          // not just before the push, so `prevStatus` (line ~590 below) is
          // ALSO left untouched for this id this tick — the real busy→idle
          // edge still fires, correctly, once the row heals and a later tick
          // can actually measure it, rather than being silently lost the
          // instant `prevStatus` was overwritten to an unmeasured 'idle'.
          if (unmeasuredIds.has(s.id)) continue;
          if (this.prevStatus.get(s.id) === 'busy' && s.status === 'idle') {
            this.pushOne({ kind: 'done', sessionId: s.id, project: s.project, title: '✓ Finished', body: 'Finished — back to idle' }, projects);
          }
        }
        // Build 7's two new notify kinds ride the SAME primed gate as the
        // `done` push above, for the identical restart reason. EACH WRAPPED
        // (review finding 1): both walk straight into `node:sqlite`, which
        // throws SYNCHRONOUSLY — a full disk (this fleet already ships a 10G
        // floor check, so it is not hypothetical) or a second connection
        // holding coord.db's write lock (`BEGIN IMMEDIATE` takes it eagerly,
        // no busy timeout) is enough. `tick()` is fired by `start()` as `void
        // this.tick()` with no `unhandledRejection` handler anywhere in this
        // tree, so an unguarded throw here would kill the whole process over a
        // fault every NEIGHBOURING lane already survives (sweepPr/sweepNames/
        // sweepMail's `void …().catch(…)`, saveSnapshot's try/catch below,
        // readRegistry's swallow-by-construction) — these two were the
        // exception, not the rule this file otherwise keeps.
        try { this.pushNewMail(projects, sessionProjects); }
        catch (err) {
          console.warn(`ccrc-server: pushNewMail failed (${err instanceof Error ? err.message : String(err)}) — one bad sweep must not kill the poll`);
        }
        try { this.pushNewRuns(projects); }
        catch (err) {
          console.warn(`ccrc-server: pushNewRuns failed (${err instanceof Error ? err.message : String(err)}) — one bad sweep must not kill the poll`);
        }
      } else if (this.deps.coord) {
        // The priming tick seeds both watermarks to "everything that already
        // exists" rather than 0, so the FIRST primed tick's `WHERE id > ?`
        // reads see only what changed after this process started — the mail-
        // lane courtesy spec's restart semantics name, extended here to runs.
        // Guarded for the identical reason as the two calls above (review
        // finding 1): a priming-tick SQLite failure must leave both watermarks
        // at 0, not kill the process — a later primed tick still reads
        // everything queued since the process actually started, which is the
        // same "replay a bit more than strictly necessary" cost every other
        // lane in this file accepts over losing the poll outright.
        try {
          this.lastMailNotifyId = this.deps.coord.maxMailDeliveryId();
          this.lastRunNotifyId = this.deps.coord.maxRunEventId();
        } catch (err) {
          console.warn(`ccrc-server: priming the mail/run watermarks failed (${err instanceof Error ? err.message : String(err)}) — one bad read must not kill the poll`);
        }
      }
      // Skips the SAME unmeasured ids the push loop above skips — see its own
      // comment: overwriting `prevStatus` with a guessed 'idle' here would
      // permanently lose the real busy→idle edge the instant the row heals.
      for (const s of sessions) { if (!unmeasuredIds.has(s.id)) this.prevStatus.set(s.id, s.status); }
      this.activeProjects = projects;
      this.primed = true;
      if (this.deps.cfg.fleetMode === 'remote' && this.deps.fleetState?.connected) {
        // C0.4: `connected` alone is not "this read was complete" — a
        // wedged-yet-connected agent, a socket hiccup mid-sweep, or a handful of
        // sessions timing out inside `readRegistry`'s 24-generation loop all
        // still leave `fleetState.connected` true while `sessions` comes back
        // short. Without a size check, THAT partial assembly overwrites the
        // fuller last-known-good snapshot on disk — and `/api/fleet`
        // (server.ts) serves exactly this file, unconditionally, as `stale:
        // true` for the whole REST of a subsequent real outage. So a single bad
        // tick during an otherwise-healthy stretch degrades every request after
        // it, not just its own. Guard: never let a smaller (or empty) assembly
        // clobber a fuller one already on disk — implementing the intent this
        // class's own docstring already states above ("a stretch of
        // empty/partial reads never clobbers the last known good snapshot").
        //
        // C0.4-FOLLOWUP (blocking review findings 1/2): a bare length
        // comparison cannot tell "this tick's read was partial" apart from
        // "the fleet is genuinely smaller now" — and the second one is the
        // ROUTINE case, not the rare one: `ccd`'s `_reg_purge` unlinks a
        // session's whole registry entry from `cmd_ws_rm` (session rm),
        // `ws-reap`, and `ws-gc --prune` alike. Comparing lengths ALONE turns
        // every purge into a permanent high-water mark: once the fleet drops
        // below it, `sessions.length < prior.sessions.length` stays true on
        // every later tick FOREVER, even fully healthy ones, and the cache —
        // every field of every surviving session included — freezes at the
        // instant of the purge and never updates again. Silently: nothing
        // failed loudly enough to log.
        //
        // The escape hatch is the same evidence `readRegistry`'s own
        // hold-reconfirm already trusts (registry.ts): `_reg_purge` removes
        // the id's `.uuid` too, so a GENUINE purge is a directory listing that
        // no longer names `<id>.uuid` at all. A FAILED field read, by
        // contrast, leaves `.uuid` (and the id's other files) sitting right
        // there in the listing — only the bytes behind one of them came back
        // null. So: when this tick assembled fewer sessions than the prior
        // snapshot, list the registry directory fresh and check every id that
        // dropped out against it. The write is allowed only when EVERY
        // missing id is confirmed gone from that listing — one still-listed
        // id is enough to treat the whole tick as a partial read and keep the
        // prior snapshot, exactly as the original guard intended for that
        // case. A failed (or absent) confirmation listing itself proves
        // nothing either way, so it fails shut the same way.
        try {
          // Task 2: the shrink guard above keys ONLY on `sessions.length`,
          // and a degraded row survives length unchanged — `assembleFleet`
          // still emits one `FleetSession` per readable-or-degraded record,
          // it just carries a non-empty `unmeasured`. So a 24-row assembly
          // with 3 degraded rows sails straight through
          // `sessions.length >= prior.sessions.length` and would be
          // persisted as last-known-good: `status` frozen at a guessed
          // default, `branch`/`workdir` reading stale or empty for reasons
          // that have nothing to do with the session's real state. The
          // snapshot's whole purpose is degraded-mode serving (`/api/fleet`
          // ships it, unconditionally `stale: true`, through a REAL
          // fleet-host outage) — persisting a guess as THAT snapshot defeats
          // the one thing it exists for at the exact moment it matters.
          // Same warn-once-per-episode discipline as the shrink guard below,
          // on its own flag (`snapshotWriteSkippedDegradedWarned`) so the two
          // episodes can each report once without silencing the other.
          const degraded = sessions.filter((s) => s.unmeasured.length > 0);
          if (degraded.length > 0) {
            if (!this.snapshotWriteSkippedDegradedWarned) {
              this.snapshotWriteSkippedDegradedWarned = true;
              console.warn(`ccrc-server: snapshot write skipped — ${degraded.length}/${sessions.length} assembled sessions carry an unmeasured identity field this tick (${degraded.map((s) => s.id).join(', ')}); the cache would otherwise persist a guess as last-known-good`);
            }
          } else {
            this.snapshotWriteSkippedDegradedWarned = false;
            const prior = await loadSnapshot(this.cachePath);
            if (prior === null || sessions.length >= prior.sessions.length) {
              await saveSnapshot(sessions, this.cachePath);
              this.snapshotWriteSkippedWarned = false;
            } else {
              const survivingIds = new Set(sessions.map((s) => s.id));
              const missingIds = prior.sessions.map((s) => s.id).filter((id) => !survivingIds.has(id));
              const names = await this.deps.io.readdir(this.deps.cfg.registryDir);
              const allGenuinelyPurged = names !== null && missingIds.every((id) => !names.includes(`${id}.uuid`));
              if (allGenuinelyPurged) {
                await saveSnapshot(sessions, this.cachePath);
                this.snapshotWriteSkippedWarned = false;
              } else if (!this.snapshotWriteSkippedWarned) {
                this.snapshotWriteSkippedWarned = true;
                console.warn(`ccrc-server: snapshot write skipped — this tick assembled ${sessions.length}/${prior.sessions.length} of the prior snapshot's sessions and at least one missing id is still listed in the registry (a read failure, not a confirmed purge); cache stays at the prior size until that clears`);
              }
            }
          }
        } catch { /* best-effort cache — never blocks the poll */ }
      }
      // Independent of the `fleet` diff below: runs change on a different
      // clock from sessions, and an unchanged session snapshot must not
      // suppress a run transition from reaching an already-connected client.
      this.emitRuns();
      const json = JSON.stringify(sessions);
      if (json === this.lastJson) return;
      this.lastJson = json;
      this.bus.emit('fleet', sessions);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * The `{type:'runs'}` WS frame emitter (Task 10, spec:222-224). Runs every
   * tick, unthrottled: `CoordStore.runs()` is a handful of indexed SQLite
   * reads (synchronous — `DatabaseSync` has no async surface), not a pane
   * capture or a network round trip, so there is nothing here worth a slower
   * clock of its own the way `sweepNames`/`sweepMail` need one.
   *
   * Byte-equality guarded exactly like the `fleet` snapshot above: runs
   * change on human-and-agent timescales, and re-broadcasting an unchanged
   * list every 2 s would be new noise on a socket that spent real effort not
   * having any. No `coord` -> nothing to read -> nothing ever emitted, the
   * same "absent means none of this exists" stance every other coord-gated
   * surface in this build takes.
   *
   * GUARDED (review finding 1): `coord.runs()` is a synchronous `node:sqlite`
   * read, sitting directly on `tick()`'s own poll with no neighbouring
   * `catch` to absorb it — the same fault (a full disk, a locked coord.db)
   * that has a `try`/`.catch` at every OTHER synchronous or async lane in
   * this file. A failure here skips just this tick's `runs` emission;
   * `lastRunsJson` is left untouched so a later successful tick still diffs
   * correctly against whatever was last actually broadcast.
   */
  private emitRuns(): void {
    const coord = this.deps.coord;
    if (!coord) return;
    let runs: RunSummary[];
    try { runs = coord.runs().map(toRunSummary); }
    catch (err) {
      console.warn(`ccrc-server: emitRuns failed (${err instanceof Error ? err.message : String(err)}) — one bad read must not kill the poll`);
      return;
    }
    const json = JSON.stringify(runs);
    if (json === this.lastRunsJson) return;
    this.lastRunsJson = json;
    this.bus.emit('runs', runs);
  }

  /** The `{type:'coord'}` frame (spec §4.2). Derived from the SAME registry
   *  listing this tick already performed — carried out of `readRegistryMeasured`
   *  on `RegistryRead.names` rather than taken again (D-B4-10).
   *
   *  `null` names is an UNLISTABLE directory, not an empty one, and rides the
   *  wire as `unmeasurable` — the state `dispatchRun` fails shut on.
   *
   *  Byte-equality guarded exactly like `emitRuns` above. No `try`/`catch`:
   *  unlike `emitRuns` this touches no `node:sqlite` and no I/O — it is an
   *  array scan, a `JSON.stringify` and a `bus.emit`, and the bus's own
   *  listeners are the two socket writers `emitRuns` already trusts. */
  private emitCoord(names: readonly string[] | null): void {
    const status: CoordStatus = names === null
      ? { pause: 'unmeasurable', mail: 'unmeasurable' }
      : { pause: names.includes(COORDINATOR_PAUSE_MARKER) ? 'set' : 'clear',
          mail: names.includes(MAIL_DISABLED_MARKER) ? 'set' : 'clear' };
    const json = JSON.stringify(status);
    if (json === this.lastCoordJson) return;
    this.lastCoordJson = json;
    this.coord = status;
    this.bus.emit('coord', status);
  }

  /**
   * The `mail` NotifyEvent lane (Task 10, spec:243-244). Fires from the
   * delivery lane's own data at QUEUE time — `mailQueuedSince` walks
   * `mail_deliveries` by insertion order, so a row is raised the first tick
   * after `POST /api/mail` (or the coordinator's own system mail) queued it,
   * regardless of whether `sweepMail` has attempted injection yet. "Not at
   * injection — otherwise a message that never becomes deliverable is a fact
   * nothing recorded."
   *
   * `tag` is `mail-<toId>-<mailId>` (spec:236-237): NON-collapsing per
   * session, on purpose — two different messages about one session must not
   * replace each other in the tray, unlike `ask`/`done`/`merged`'s default
   * `${kind}-${sessionId}` key, where the newest statement supersedes the
   * last. `recordAlways: true` (spec:238-240): a message the operator is
   * looking at the recipient's pane for is still a fact that arrived: only
   * the PUSH is presence-gated, never the record.
   *
   * `sessionProjects` (review finding 3): `m.project` comes off a `LEFT JOIN`
   * to the mail's run and is `null` for ad-hoc mail with no run context — a
   * fully supported, first-class case (`mailQueuedSince`'s own docstring;
   * `POST /api/mail` treats `runId` as optional). Falling back to `''` left a
   * dangling ` · ` in a multi-project fleet: `pushOne` decorates on project
   * COUNT alone, with no test ever exercising a run-less mail there (every
   * mail case in `push-copy.test.ts` seeded one project). The recipient
   * SESSION's own project, read one scope up in `tick()` from this same
   * tick's fleet assembly, is the honest fallback.
   */
  private pushNewMail(projects: Set<string>, sessionProjects: Map<string, string>): void {
    const coord = this.deps.coord;
    if (!coord) return;
    for (const m of coord.mailQueuedSince(this.lastMailNotifyId)) {
      const project = m.project ?? sessionProjects.get(m.toId) ?? '';
      this.pushOne({
        kind: 'mail', sessionId: m.toId, project,
        title: `✉ ${m.kind} › ${m.workspace ?? m.toId}`,
        body: m.subject,
        tag: `mail-${m.toId}-${m.mailId}`,
        recordAlways: true,
      }, projects);
      this.lastMailNotifyId = m.deliveryId;
    }
  }

  /**
   * The `run` NotifyEvent lane (Task 10, spec:243-244): one RECORD per
   * `run_events` row — every transition this run's own state machine
   * records, not just terminal ones. "A run transition is a fact about a
   * program, and the operator watching one pane must not erase it" —
   * `recordAlways: true` for the identical reason `pushNewMail` sets it.
   *
   * `closing` is `recordOnly` (review finding 4): `POST /api/runs/:id/close`
   * commits `advance(id,'closing')` and `advance(id, state)` inside ONE
   * transaction, `CoordStore.closeRun` (corrected — this used to describe
   * two adjacent synchronous route-level statements, true when review
   * finding 4 was fixed but not since `closeRun` was introduced), so the
   * SAME watcher tick always reads both rows, and every close fired TWO
   * pushes, one naming a state that exists for microseconds: internal
   * bookkeeping the operator can neither act on nor ever observe as a
   * resting state. The feed still gets it in full — the record above is
   * unconditional, same as every other transition — only the PUSH is
   * suppressed for this one state.
   *
   * A transition with no `sessionId` yet (e.g. an early refusal before
   * dispatch ever minted one) is skipped rather than guessed: presence
   * gating and the push's own target both need a real session id, and
   * `runEventsSince`'s own docstring states why the caller, not the store,
   * makes that call.
   */
  private pushNewRuns(projects: Set<string>): void {
    const coord = this.deps.coord;
    if (!coord) return;
    for (const r of coord.runEventsSince(this.lastRunNotifyId)) {
      if (r.sessionId !== null) {
        this.pushOne({
          kind: 'run', sessionId: r.sessionId, project: r.project,
          title: `▸ ${r.toState} › ${r.workspace ?? r.project}`,
          body: `program:${r.program} wave ${r.wave}/${r.waveOf ?? '?'}`,
          tag: `run-${r.runId}-${r.toState}`,
          recordAlways: true,
          recordOnly: r.toState === 'closing',
        }, projects);
      }
      this.lastRunNotifyId = r.eventId;
    }
  }

  /**
   * Every push goes through here, so the copy rules are stated once.
   *
   *  - Project context ONLY when more than one project is active. The server
   *    knows the whole fleet at push time, so it can tell — and "✓ ccrc-pwa"
   *    on a fleet running one project is noise dressed as information.
   *  - NOTHING PUSHES for a session the operator is looking at right now. A
   *    notification for the pane on your screen trains you to dismiss
   *    notifications. AMENDED for Build 7 (spec:238-240) — this used to be
   *    absolute, gating the RECORD too, and it still is for `ask`/`done`/
   *    `merged`. But agent-to-agent mail (and a run transition) is a record,
   *    not a "needs your eyes" ping: gating the record on presence would mean
   *    the operator watching a session ERASES the log of a message they
   *    never saw. `recordAlways` exempts the RECORD from this gate; the PUSH
   *    stays gated exactly as before, unconditionally, for every kind.
   *  - The log records what this method DECIDED to raise — after the presence
   *    gate, before delivery, and never corrected by delivery's outcome. It is
   *    not a record of what was sent: recording is unconditional while `push`
   *    is optional, so a reconnecting client's catch-up can and will list
   *    events no device ever received. `NotifyEvent`'s own docstring is the
   *    wire contract for that; keep the two saying the same thing. The
   *    durable feed (`CoordStore.recordFeedEvent`, Task 10) is written at the
   *    SAME point for the SAME reason, over ALL kinds — not just Build 7's
   *    two — so the archive behind the ring can never disagree with what the
   *    ring itself would have said.
   *
   *  `notifyLog` and `push` are independently optional, which is the reason
   *  above: the catch-up log is useful even on a box with no VAPID keys
   *  configured, so it is never gated on `push` being present. `coord` is a
   *  THIRD, independently-optional sink for the identical reason: a box with
   *  no coordination database still gets a working ring and catch-up, it
   *  simply has no durable archive behind either.
   */
  private pushOne(e: {
    kind: NotifyEvent['kind']; sessionId: string; project: string; title: string; body: string;
    actions?: PushPayload['actions'];
    /** Overrides the default `${kind}-${sessionId}` collapse key. Mail MUST
     *  pass one: two different messages about one session must not replace
     *  each other in the tray (spec:236-237), which is exactly what the
     *  default key does — and does correctly for `ask`/`done`/`merged`, where
     *  the newest statement about a session supersedes the last. */
    tag?: string;
    /** Record even when the operator is looking at this session. THE PRESENCE
     *  GATE STILL SUPPRESSES THE PUSH; only the RECORD is exempt. spec:238-240:
     *  agent-to-agent mail is a record, not a "needs your eyes" ping — gating
     *  the record on presence would mean the operator watching a session
     *  ERASES the log of a message they never saw. */
    recordAlways?: boolean;
    /** Record it (subject to the presence gate above, same as every other
     *  kind) but never emit an actual push notification for it. Added for the
     *  `run` lane's `closing` transition alone (review finding 4, see
     *  `pushNewRuns`'s own docstring): the feed genuinely wants every
     *  transition, which `recordAlways` already gets it; the tray does not,
     *  and until now `pushOne` had no way to say so — `recordAlways` only
     *  ever exempted the RECORD from the presence gate above, never the push
     *  from firing at all. */
    recordOnly?: boolean;
  }, projects: Set<string>): void {
    const visible = this.deps.presence?.isVisible(e.sessionId) === true;
    if (visible && !e.recordAlways) return;
    // Decorated only when BOTH more than one project is active AND the
    // project is actually known (review finding 3) — an empty `e.project`
    // (run-less mail whose recipient session could not be resolved either,
    // `pushNewMail`'s own fallback chain) must degrade to no decoration at
    // all, never to a dangling ` · ` with nothing after it.
    const title = projects.size > 1 && e.project !== '' ? `${e.title} · ${e.project}` : e.title;
    const log = this.deps.notifyLog;
    const recorded = log?.record({ kind: e.kind, sessionId: e.sessionId, title, body: e.body });
    void log?.flush();
    // The durable feed archive — same record, same point, ALL kinds (Task
    // 10's orchestrator-added scope). Only reachable when NotifyLog actually
    // produced an event: no `notifyLog` configured means no `{epoch,seq}`
    // pair exists to mirror, and a feed row that mirrors nothing is not an
    // archive of anything. GUARDED (review finding 1): `node:sqlite` throws
    // SYNCHRONOUSLY (a full disk, a second connection holding coord.db's
    // write lock — `tx()`'s `BEGIN IMMEDIATE` takes it eagerly, no busy
    // timeout) and this call sits directly on the poll, reached from every
    // kind this method ever raises (the `done` push above, the ask push in
    // `detectDialogs`, and both new Task 10 lanes). `tick()`'s own rule is
    // that one bad lane must not kill the others — every neighbouring lane
    // already earns that non-throwing property one way or another (see
    // `tick()`'s own comment above `pushNewMail`/`pushNewRuns`) and this call
    // was the one exception reachable from every push, not just two lanes.
    // The ring record and the push below are UNAFFECTED by a failure here —
    // only the archive row is lost.
    if (log && recorded) {
      try { this.deps.coord?.recordFeedEvent(log.epoch, recorded); }
      catch (err) {
        console.warn(`ccrc-server: recordFeedEvent failed (${err instanceof Error ? err.message : String(err)}) — feed archive degraded, ring/push unaffected`);
      }
    }
    if (visible) return;                       // recorded, not pushed
    if (e.recordOnly) return;                   // recorded, deliberately never pushed
    void this.deps.push?.notify({
      title, body: e.body, sessionId: e.sessionId,
      tag: e.tag ?? `${e.kind}-${e.sessionId}`,
      ...(e.actions ? { actions: e.actions } : {}),
    });
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
    let recs: SessionRecord[];
    if (records) {
      recs = records;
    } else {
      // Own read — only exercised when this method is called with no
      // argument (tests only today; `tick()` always supplies its own
      // already-listed `records`). Same fail-shut seam as `tick()`'s shared
      // read and `sweepTasks`' own read below (blocking review findings
      // 1/3): `readRegistryMeasured`, and `this.hookStates` is left
      // UNTOUCHED on `{listed:false}` rather than rebuilt from an empty `[]`
      // — a failed listing must not wipe every retained entry the branch
      // below exists to protect.
      const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);
      if (!registryRead.listed) return;
      recs = registryRead.records;
    }
    const next = new Map<string, HookState>();
    await Promise.all(
      recs.map(async (r) => {
        // RETAIN, DON'T ERASE (Task 2, the heal side): a degraded row's
        // `r.uuid` reads `''` (registry ladder), and `readHookState`'s own
        // identity gate compares that against the hookstate file's REAL
        // `sessionId` — a comparison that can never match, so a fresh read
        // here always answers "nothing pending" for a session that may still
        // be mid-turn. Carry the PREVIOUS sweep's entry forward untouched
        // instead of letting one transient registry-read failure flicker the
        // attention bucket / askSummary off and back on. Pruning a
        // genuinely-reaped id is UNAFFECTED: `next` is rebuilt fresh from
        // THIS tick's `recs` every sweep, so an id truly gone from the
        // registry (not merely degraded — absent from `recs` altogether) is
        // never copied forward and ages out of `this.hookStates` on this
        // very sweep, exactly as it always has (verified: this map has no
        // OTHER pruning mechanism, so the full-rebuild-from-current-listing
        // shape is load-bearing and is preserved here unchanged).
        if (measuredIdentity(r) === null) {
          const prev = this.hookStates.get(r.id);
          if (prev) next.set(r.id, prev);
          return;
        }
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
    // Own read, on its own slower clock — never shared with `tick()`'s
    // (`sweepHookStates` above takes `tick()`'s `records` as a parameter;
    // this method does not). `readRegistryMeasured`, fail shut on
    // `{listed:false}` (blocking review findings 1/3): the old `readRegistry`
    // `[]`-on-unlistable answer made a single dropped `io.readdir` here wipe
    // `this.taskProgress` for the WHOLE fleet — the same harm the
    // retain-don't-erase branch two lines down exists to prevent for one
    // degraded row, at fleet scale, on a clock throttled to fire once per
    // `TASK_SWEEP_MS` — so a hit here can leave every task tally blank for a
    // whole sweep interval, exactly the cost this method's own comment names
    // for a single row. `this.lastTaskSweep` is stamped above regardless
    // (same ordering `sweepMail`'s own fail-shut kill-switch check uses): a
    // failed listing still consumes this sweep's slot rather than retrying
    // every 2 s tick, the same throttle discipline every other sweep here
    // keeps.
    const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);
    if (!registryRead.listed) return;
    const records = registryRead.records;
    const next = new Map<string, TaskProgress>();
    await Promise.all(
      records.map(async (r) => {
        // RETAIN, DON'T ERASE — same reasoning and same pruning guarantee as
        // `sweepHookStates` above: a degraded `r.wrapper` (reads `''`) makes
        // `configDirFor` answer `undefined` even though the session is
        // plainly still there, and this sweep runs on its OWN slower clock
        // (`TASK_SWEEP_MS`) — a value dropped here can sit blank for a
        // whole sweep interval before the next tick even gets a chance to
        // heal it, longer than the 2 s the hook-state lane risks. Carry the
        // last-known tally forward instead of blanking it on a guess.
        // `next` is still rebuilt fresh from THIS sweep's `records` every
        // time, so a genuinely-reaped id (absent from `records`, not merely
        // degraded) is never copied forward — pruning is unchanged.
        if (measuredIdentity(r) === null) {
          const prev = this.taskProgress.get(r.id);
          if (prev) next.set(r.id, prev);
          return;
        }
        const cfgDir = configDirFor(this.deps.cfg, r.wrapper);
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
      // SKIP a degraded row before anything else: an unmeasured `uuid`
      // computes an `incarnation` key (`${r.id}#${identity.uuid}`, below)
      // belonging to no real incarnation — `''` for every degraded session,
      // so two unrelated degraded sessions would collide on the SAME
      // `attemptedRenames`/`nameSweepRetired` budget — and an unmeasured
      // `.archivedAt` would defeat the archived-exclusion test right below
      // (a false null there makes an already-archived row look eligible for
      // a rename it must never receive: `ws-rename` on an archived worktree).
      const identity = measuredIdentity(r);
      if (identity === null) continue;
      // `ws-archive` destroys nothing — an archived row is still `workspace
      // !== null` with `branch` still at the born name — so it is excluded
      // here explicitly, the same shape `archiveMerged` below already uses.
      if (r.workspace === null || r.archivedAt !== null) continue;
      const born = `ws/${r.workspace}`;
      if (r.branch !== born) continue;
      // TWELFTH CONDITION (Wave 3 §3.1). A claimed workspace is not renamed —
      // `sessionLabel` reads `branch` before `workspace`, so a rename mid-wave
      // changes what every surface calls a worker the coordinator's ledger
      // already names. BOTH halves are needed and they are in cost order:
      // `held` is a field on the row this loop already read, and it covers the
      // ordinary dispatch (the hold lands before the brief, and the sweep needs
      // an ai-title that only exists once the worker answers the brief);
      // `openRunsForSession` is a query, short-circuited away for every claimed
      // row, and it covers the workspace created by hand and adopted into a run
      // via `POST /api/runs` with a `sessionId`, which reaches `dispatched`
      // with no `.hold` on disk.
      //
      // `?.`-CHAINED, and not by taste: `testDeps` supplies no `coord` and this
      // class already treats the store as optional on eight other lines. A
      // non-optional call here TypeErrors every watcher test in the tree that
      // does not wire a store.
      //
      // Doubt reads as HELD, matching ccd's four `-e` hold readers:
      // `readRegistry` maps an unreadable-but-listed `.hold` to HOLD_UNREADABLE
      // and an empty one to HOLD_NO_REASON, both NON-null, so `!== null` is the
      // whole test and must not grow an emptiness clause.
      if (r.held !== null || (this.deps.coord?.openRunsForSession(r.id).length ?? 0) > 0) continue;
      // Keyed by id AND uuid, not id alone: `<project>-<slug>` is a SLUG,
      // recycled by ws-reap (`ccd:950-951`'s "144 per project, recycled") —
      // `_ws_slug_free` only ever checks live registry rows, which `_reg_purge`
      // deletes on reap, so nothing stops a later `ws-add` drawing the same
      // slug for an unrelated workspace. `identity.uuid` is the Claude Code
      // session uuid, freshly minted by every `ws-add`, so a recycled id
      // pairs with a NEW uuid and this key cannot collide with a retired
      // incarnation of the same id — the same self-healing property
      // `titleProbe` already has by keying on a transcript PATH that changes
      // with the uuid.
      const incarnation = `${r.id}#${identity.uuid}`;
      // The cheapest question in the function, asked before anything that
      // costs a stat or a read: THIS INCARNATION, once retired by a permanent
      // refusal (`has-upstream` and its siblings), never un-retires — but a
      // uuid rotation (`nameSweepRetired`'s docstring) computes a different
      // incarnation for the same session id, which was never added here.
      if (this.nameSweepRetired.has(incarnation)) continue;
      // A PROBE argv: it is never sent. `verbSupported` reads argv[0] only, and
      // asking here — before `claimTitleRead` writes anything — is what makes
      // "an unsupported verb records no attempt" true of the stat gate as well
      // as of the attempted set. Skips silently, same self-healing caveat as
      // `archiveMerged`'s own `ws-archive` gate below (fix round 4, task 14,
      // Minor #5): automatic in remote mode, on THIS WATCHER's own 60s
      // timer (`CAPS_REFRESH_MS`) — not the agent's, which has none —
      // requires a server restart in local mode (`localcaps.ts`, one probe
      // at boot, no timer).
      if (!verbSupported(this.deps.fleetState, CCD_ARGV.wsRename(r.id, born))) continue;
      const cfgDir = configDirFor(this.deps.cfg, identity.wrapper);
      if (!cfgDir) continue;
      // NO `foreign`: a derived branch name is written into the row with no
      // banner attached to it, and a name taken from another account's frozen
      // copy is exactly the quiet wrongness this spec removes (§5.2). Rungs 1-5
      // are unconditional — a title should follow a transcript that moved
      // inside its own account.
      const file = (await this.transcripts.resolve({
        configDir: cfgDir, dir: identity.workdir, registryWorkdir: identity.workdir, uuid: identity.uuid,
      })).path;
      // `claimTitleRead` already refuses a null stat, so a `fallback` path costs
      // one stat and reads nothing — no extra branch needed here.
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
   * §1.6's census, and THE ONLY PRODUCER OF IT. Named once, deliberately, so
   * nobody adds a second — `reviveFleetSession` in particular must never become
   * one (the `fleet.ts` precedent exists to prevent exactly that shape, and it is
   * what makes splitting `DIVERGENCE_KINDS` in L0 from `divergences()` in L1
   * defensible).
   *
   * L4: it GATHERS (git's worktree records through `FleetIO`, open-run session
   * ids through `coord`) and it PUBLISHES. It DECIDES nothing — no ccd verb runs
   * here and nothing mutates. That is also what keeps `fleet.ts`'s
   * asymmetric-skew deferral valid: lifecycle stays a display-only qualifier, and
   * the deferral's own stated expiry ("if the census makes lifecycle drive an
   * adopt/respawn DECISION") has not been reached.
   *
   * PUBLIC for the reason `sweepNames` is public: `tick()` dispatches it with
   * `void`, so a test that awaits `tick()` has not awaited this.
   *
   * THE PROJECTS IT ASKS GIT ABOUT ARE THE PROJECTS THE REGISTRY NAMES, never a
   * listing of `projectsRoot`. That bounds the per-sweep cost to the fleet's
   * ACTIVE projects rather than to every checkout on the box, and it is a real
   * limit worth stating rather than discovering: a project whose every session
   * has been reaped contributes no rows, so its leftover worktrees go unnamed
   * until something is running there again. Widening it is a `readdir` of
   * `projectsRoot` per sweep plus a `.git/worktrees` read per project found —
   * a deliberate cost, not an oversight to be quietly fixed.
   *
   * `this.deps.coord` is `?.`-chained because `testDeps` supplies none — a
   * non-optional call TypeErrors fourteen `hold-gate` tests plus `pr-sweep`'s.
   */
  async sweepDivergences(records: SessionRecord[]): Promise<void> {
    // `Date.now()`, not an injected clock: this class has none, and `sweepNames`
    // just above reads the same way. `!== 0` is not a style tic — it is what
    // makes the FIRST sweep run immediately after a restart instead of waiting a
    // minute, and it is the shape `sweepNames` already ships.
    const now = Date.now();
    if (this.lastDivergenceSweep !== 0 && now - this.lastDivergenceSweep < DIVERGENCE_SWEEP_MS) return;
    this.lastDivergenceSweep = now;
    const projects = [...new Set(records.map((r) => r.project))];
    const worktrees: DivergenceInput['worktrees'][number][] = [];
    const headBranch = new Map<string, string | null>();
    for (const project of projects) {
      const read = await readWorktreeRecords(this.deps.io, this.deps.cfg.projectsRoot, project);
      // §1.7. Both refusals contribute nothing for this project — a census can
      // only ever suppress a finding here, never manufacture one — but they are
      // NAMED separately rather than collapsed, because they are different facts
      // and only one of them is transient. `refused-project` is STANDING: the
      // registry keeps naming a project whose census this server will never read,
      // every sweep, forever, and silence is how that stays invisible. It gets one
      // line per sweep interval (60 s), which is the same cadence the `runs()`
      // guard just below already logs at. `unlistable` is a read that failed and
      // may succeed next minute — no log, or a broken permission would print
      // hourly for as long as it lasts.
      //
      // `not-a-checkout` and `unreachable` are the two that used to be ONE word,
      // and the reason they are two is that a log line could not say which — a
      // standing condition (a project directory that is not a checkout) and a
      // transient one (a dropped agent socket, which `FleetIO.stat` reports as
      // `null` exactly like a missing path) sharing a value at a seam. They are
      // told apart now by a rung walk up the path, not by a guess: see
      // `WorktreeRead`'s own docstring. BOTH stay quiet, for opposite reasons.
      // `not-a-checkout` is STANDING like `refused-project` but is a normal
      // shape of the box rather than a defect — four fleet projects answer it
      // every sweep, for ever, and four lines a minute is a log nobody reads.
      // `unreachable` is a read that failed and may succeed next minute, the
      // same argument that keeps `unlistable` quiet. What the split buys the
      // census is unchanged and is the point: neither is reported as a measured
      // zero, and the next consumer inherits the distinction instead of a value
      // that already threw it away.
      //
      // `ok: true` with an EMPTY array is the last case and is NOT a refusal:
      // git creates `.git/worktrees` with the first linked worktree, so its
      // absence — once `<project>/.git` has answered, which is what separates it
      // from `unreachable` — is a measured zero. It falls through the loop below
      // contributing nothing, which is the correct handling of a real answer that
      // happens to be empty — not the same code path as not knowing.
      if (!read.ok) {
        if (read.reason === 'refused-project') {
          console.warn(`ccrc-server: sweepDivergences cannot census project ${JSON.stringify(project)} — the name is refused by the path guard, so this project is permanently absent from the census`);
        }
        continue;
      }
      for (const w of read.records) {
        worktrees.push({ project, name: w.name, path: w.path });
        headBranch.set(`${project}/${w.name}`, w.headBranch);
      }
    }
    // THE CLAIM EVIDENCE, READ AFTER THE WORKTREE EVIDENCE IT IS WEIGHED
    // AGAINST — and that ordering is the whole reason this is a second listing
    // rather than the one `tick()` already took (D-B4-10's "one listing,
    // shared"). ccd writes in a fixed order: `git worktree add` first, then the
    // registry field by field. So a listing taken BEFORE these git records —
    // which is what being handed `registryRead.names` from the top of the tick
    // meant, three awaited lanes earlier — can miss a `_reg_set` that had
    // already landed by the time the records were read, and reassemble "a
    // worktree no registry row claims" out of two reads neither of which ever
    // saw that state. That is the mid-`ws-add` false positive 502e35a closed in
    // the predicate, arriving through read order instead, and the debounce does
    // not cover it: the skew repeats every sweep for as long as the write keeps
    // landing in the window. Read late, the listing is never staler than the
    // records, and the only unclaimed worktrees left are the ones that really
    // were unclaimed when git was asked.
    //
    // Cost is ONE readdir per sweep interval (60 s), not per tick — the lane
    // clock above has already returned on every other call by the time this
    // line runs. D-B4-10 was about the per-tick whole-fleet read, ~21 field
    // reads per session in remote mode; this is one round trip a minute.
    const registryNames = await this.deps.io.readdir(this.deps.cfg.registryDir);
    if (registryNames === null) {
      // FAIL SHUT, and this is the one read in this method where the direction
      // is dangerous. Everywhere else a failed read can only SUPPRESS a finding
      // (an unlistable `.git/worktrees` contributes no worktrees). A failed
      // registry listing read as `[]` claims nothing claims anything — every
      // worktree on the box unclaimed at once, on the kind whose repair deletes
      // worktrees. Same evidence-not-time bound `tick()`'s own
      // `!registryRead.listed` return draws, and the memory below is left
      // standing for the reason the `runs()` arm states.
      console.warn('ccrc-server: sweepDivergences could not list the registry — no census this pass, because "nothing claims anything" is not what a failed read proves');
      return;
    }
    let openRunSessionIds = new Set<string>();
    try {
      openRunSessionIds = new Set(
        (this.deps.coord?.runs() ?? [])
          .map((r) => r.sessionId)
          .filter((id): id is string => id !== null),
      );
    } catch (err) {
      // `coord.runs()` walks straight into synchronous `node:sqlite` — the same
      // fault every neighbouring lane already guards. A failed read skips the
      // census this pass rather than killing the poll.
      console.warn(`ccrc-server: sweepDivergences runs() failed (${err instanceof Error ? err.message : String(err)}) — one bad read must not kill the poll`);
      return;
    }
    // THE REGISTRY'S `.branch`, never the assembled `FleetSession.branch`:
    // `assembleFleet` computes `sl?.branch ?? r.branch` (fleet.ts) and the
    // STATUSLINE wins there, so a census fed from `sessions` would compare git's
    // HEAD against whatever Claude Code last rendered. The field a
    // done-fingerprint trusts, and the field a rename moves, is this one — which
    // is exactly why this method takes `records`, the same reason `sweepNames`
    // reads the registry itself.
    const classifierInput = {
      records: records.map((r) => ({
        id: r.id, project: r.project, workspace: r.workspace, workdir: r.workdir,
        branch: r.branch, held: r.held, archivedAt: r.archivedAt,
      })),
      worktrees, headBranch, openRunSessionIds,
      // THE REGISTRY'S OWN DIRECTORY LISTING — the evidence that a workspace
      // mid-`ws-add` is claimed before its row parses (see
      // `unclaimedWorktrees`), taken above AFTER git's records for the ordering
      // reason stated there.
      registryNames,
    };
    const found = divergences({
      ...classifierInput, unclaimedLastSweep: this.lastUnclaimedWorktrees,
    });
    // The memory the debounce runs on, replaced only on a sweep that got this
    // far. An early return above (`coord.runs()` failed) leaves the PREVIOUS
    // observation standing rather than clearing it: a failed read is not
    // evidence that a worktree became claimed, and dropping the memory there
    // would silently re-arm the debounce and delay every finding another
    // interval. The classifier re-derives the same set internally rather than
    // being handed it, so this stays ONE definition of the claim rule.
    this.lastUnclaimedWorktrees = new Set(unclaimedWorktrees(classifierInput));
    const json = JSON.stringify(found);
    if (json === this.lastDivergenceJson) return;
    this.lastDivergenceJson = json;
    this.bus.emit('divergence', found);
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
   *   4. no FRESH hookstate carries an unanswered `ask` (robust-mail-delivery
   *      spec §2.1 / F6b fix). This is a PENDING-QUESTION guard only — a
   *      null/stale `hs` (`readHookState`'s freshness/uuid gates,
   *      `hookstate.ts:149-154`) is NON-BLOCKING here: idle authority moved
   *      wholly to conjunct 5 below, so a resumed long-idle worker, or one
   *      whose `/clear` emitted no registered hook, is still deliverable;
   *   5. the live status file says AFFIRMATIVELY idle and `statusUpdatedAt` is
   *      at least `MAIL_QUIET_MS` old — the SOLE idle authority. Affirmatively,
   *      because `liveStatus` answers `'idle'` for a missing pid, a missing
   *      config dir and an unreadable file (`fleet.ts:118-131`) —
   *      `archiveSafety`'s rule (`:731-736`, "MUST NOT collapse `unknown` to
   *      idle") applies here for the same reason: this ends in a keystroke.
   *
   * ONLY THEN `sendPrompt`, with its whole proof discipline — echo verified,
   * `draft-present` refused, `dialog-open` refused — inside the session's own
   * `KeyedQueue` slot, injecting `renderMailNudge(d.toId)` — a tiny, single-
   * line, ID-AGNOSTIC reference (robust-mail-delivery spec §1), NEVER
   * `d.envelope` — with `resumeIfOwn: true` (F3 / bug #21, fix-round): a box
   * already holding this session's own un-submitted nudge (a prior sweep's
   * lost Enter) is recognized and its Enter finished, rather than misread as
   * `draft-present` and backed off forever — the exact self-block the build4
   * dogfood measured live (`docs/superpowers/programs/build4.md`). See
   * `sendPrompt`'s own docstring for the discrimination. NOTHING HERE TEACHES
   * IT TO RETYPE OR PRESS BLINDLY: the two-Enter budget and `submitEnter`'s
   * one-Enter doctrine (`inject/send.ts:456-460`) are load-bearing, and the
   * escalation for a stuck box is the human.
   *
   * `replaceDraft` IS NEVER PASSED. A half-typed human message outranks every
   * agent-to-agent finding in this system; `draft-present` is a back-off, and
   * the mail is still there in two minutes. `clearMailResidue` IS passed, but
   * only once this delivery has provably been attempted before (spec §2.2) —
   * see the send site's own comment — and it can never clear a human draft
   * either (`isMailResidue`'s own docstring, `inject/send.ts`).
   *
   * WHAT THIS CANNOT SEE, stated because it bounds the guarantee: Claude Code
   * silently QUEUES a prompt sent mid-turn and renders the hint in a dim span
   * that `draftOf` strips (`inject/send.ts:61`, pinned against a live capture
   * at `send.test.ts:642`). So "the box reads empty" is not "nothing is
   * pending", and the gate above is what keeps the lane away from a busy
   * session in the first place — not the send path, which would happily
   * succeed.
   *
   * CROSS-SWEEP SINGLE-FLIGHT (review findings 1/5, hardened by 33/38), on
   * TOP of the six conjuncts and the per-sweep `seen` set: `mailInFlight` is
   * CLAIMED immediately after the `.has` check, with NO `await` between
   * them, so the check-then-claim is atomic with respect to the event loop —
   * no other sweep's turn can run between "is this row claimed" and "claim
   * it". The surrounding try/finally begins at that claim, not at
   * `sendPrompt`, and covers every gate below it (registry lookup, tmux
   * session, hookstate, pane pid, live status, quiet time) as well as the
   * send itself, so a row that fails ANY gate still releases its claim, via
   * `finally`, before the loop moves on — a `continue` inside a `try` runs
   * the `finally` first. A row therefore holds `mailInFlight` for its
   * WHOLE walk through the gates, not just the sub-window where it is
   * already blocked inside `sendPrompt`: a second sweep that starts while
   * the first is still working through those `await`s for the same row
   * — gate-checking OR sending — sees the claim already there and refuses
   * the row, instead of re-passing gates that have not changed and
   * enqueueing a second send for it. (An earlier version of this claim ran
   * AFTER the four gate `await`s instead of before them, leaving exactly
   * that gate-walking window unguarded — two concurrent sweeps could both
   * pass the `.has` check, both clear the gates, and both send the same
   * envelope. Fixed by moving the claim to immediately follow the check.)
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
    // Fix — blocking review findings 1/5: `readRegistry`'s OLD signature
    // collapses a whole-fleet `io.readdir` failure to `[]` — the SAME shape
    // "this recipient is not in the registry" wears below (`rec ===
    // undefined`) — so a single dropped agent-WS round trip on THIS read
    // alone (the kill-switch listing three lines up already succeeded, and
    // is a SEPARATE `readdir` call) used to make EVERY due row read as
    // `unmeasurable = false` (line ~1292's `rec !== undefined`), ratchet
    // `attempts` toward `MAIL_MAX_ATTEMPTS`, and terminally
    // `rejectDelivery(..., 'undeliverable', 'recipient not in registry')` a
    // recipient that is plainly alive and fully listed — the exact
    // "unlistable read as proven absence" bug this ladder's own comment
    // three lines below denies happening. `readRegistryMeasured` draws that
    // line explicitly: `!listed` fails shut, the SAME way the kill-switch's
    // own unreadable listing already does three lines up, rather than
    // silently emptying `records` and letting every row downstream mistake
    // "we could not read the fleet this pass" for "this recipient is gone".
    const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);
    if (!registryRead.listed) return;
    const records = registryRead.records;
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
    //
    // `row.ingestedAt !== null` SKIPS the row entirely (fix — review finding
    // 31): before this, the edge was sampled UNCONDITIONALLY, so every LATER
    // prompt the session submitted — the operator talking to it, the next
    // brief, its own tool loop's own `UserPromptSubmit` — re-dated
    // `ingestedAt` again, and `dueDeliveries`'s `MAX(ingestedAt, deliveredAt)`
    // replay gate never matured for as long as the session kept submitting
    // prompts at least once per `MAIL_REPLAY_MS`, which is what a WORKING
    // session does by definition. `hookstate.ts`'s own docstring calls this
    // edge proof that "the injected turn actually STARTED" — proof of ONE
    // specific turn, not a clock a whole session's later, unrelated activity
    // should keep pushing out. Capturing it once and freezing it means a
    // fresh, later edge from an actual REPLAY still re-dates the clock — via
    // that replay's own `markDelivered`, not this loop — exactly as
    // `dueDeliveries`'s `MAX(...)` already expects (see its own docstring).
    for (const row of unacked) {
      if (row.deliveredAt === null) continue;   // defensive; markDelivered always sets it
      if (row.ingestedAt !== null) continue;
      const hs = await hookStateFor(row.toId);
      if (hs !== null && hs.event === 'UserPromptSubmit' && hs.updatedAt > row.deliveredAt) {
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
      if (this.mailInFlight.has(d.toId)) continue;   // CHECK — review findings 1/5, see this method's docstring
      // CLAIM — immediately after the check, with NO await in between, so the
      // check-then-act is atomic with respect to the event loop: nothing can
      // run between "is it claimed" and "claim it" that would let a second
      // concurrent sweep observe the pre-claim state (fix — review finding
      // 33/38: see this method's docstring). The try/finally now begins HERE,
      // not at the send, so every gate below that `continue`s — cooldown,
      // missing registry row, no tmux session, hookstate not `done`, not
      // idle, not quiet — releases the claim on its way out, exactly once,
      // and never leaves a session claimed across sweeps.
      this.mailInFlight.add(d.toId);
      try {
        const last = this.mailCooldown.get(d.toId) ?? 0;
        if (now - last < MAIL_COOLDOWN_MS) continue;
        const rec = records.find((r) => r.id === d.toId);
        // registry ladder: `records` came from `readRegistryMeasured` above,
        // with `!listed` already refused (fix — blocking review findings
        // 1/5) — so by the time this line runs, a whole-fleet read failure
        // has already returned out of this method entirely, and can no
        // longer masquerade as "every row is absent" here. `readRegistry`'s
        // per-row ladder DEGRADES rather than drops a row whose `.uuid` is
        // listed but a sibling identity field is not (registry.ts's own
        // ladder) — so `rec` being found-but-degraded and `rec` being
        // altogether ABSENT are two different facts, evidence read straight
        // off the row itself (`measuredIdentity(rec)`) rather than the
        // hand-rolled `listing.includes` probe this block used to run.
        // `rec === undefined` therefore NARROWS to PROVEN absence: either
        // never listed, or twice-observed gone within `readRegistryMeasured`'s
        // own second-listing retirement — never "we just couldn't list the
        // registry this pass" (that case is refused above, before this loop
        // is ever reached) and never "we just couldn't read one field this
        // pass" (that is the degraded branch, not this one).
        const identity = rec !== undefined ? measuredIdentity(rec) : null;
        if (identity === null) {
          const unmeasurable = rec !== undefined;
          // Fix — review finding 30: a row whose recipient's registry row is
          // genuinely ABSENT (reaped, purged) used to `continue` here with
          // `attempts` untouched forever — `MAIL_MAX_ATTEMPTS` can only ever be
          // reached through a FAILED `sendPrompt`, which never runs on this
          // path, so the row was re-selected on every `MAIL_SWEEP_MS` tick
          // indefinitely, and a purged workspace slug being re-minted
          // (`_ws_slug_new` draws only from FREE slugs) could eventually hand
          // this exact id to an unrelated program. Backed off on the SAME
          // schedule a send failure gets, and eventually parked — the spec's
          // own `rejected('undeliverable')` terminal state, otherwise
          // structurally unreachable for exactly the recipients this build can
          // prove are gone. Scoped to ONLY this gate: every gate below (no
          // tmux session, hookstate not `done`, not idle, on cooldown) is
          // ORDINARY and expected to hold indefinitely for a session that is
          // merely busy, and must never accrue toward a park.
          //
          // A DEGRADED row (`unmeasurable`) must NEVER park, ever — the
          // recipient plainly still exists, only this one read could not
          // measure it — the same line `POST /api/mail`'s own ingress draws,
          // refusing `registry-unmeasurable` rather than guessing whenever a
          // row's `.uuid` is listed but a sibling is not (D-37,
          // `coord/routes.ts`'s `names.includes` checks, pinned at
          // `mail-routes.test.ts:259`). Without this, one dropped agent-WS
          // round trip on a SINGLE field of a LIVE session's registry row was
          // indistinguishable from that session being reaped, and six
          // backoffs (~15 minutes) permanently parked its mail
          // `rejected('undeliverable')`. "Unmeasurable" therefore keeps
          // backing off forever — the same as every ordinary gate below —
          // while only a recipient PROVEN absent can ever park.
          //
          // `store.backOff`'s `countsAsAttempt: false` on the unmeasurable arm
          // (checked every reader of the `attempts` column first: the ONLY
          // other reader is this same file's own `d.attempts + 1` two lines
          // below and `dueDeliveries`' pass-through select — no ratchet here
          // means this row's own local `attempts` snapshot never advances
          // past 1, so its backoff step stays fixed at `MAIL_BACKOFF_BASE_MS`
          // rather than climbing toward `MAIL_MAX_ATTEMPTS` — the ceiling this
          // branch must never reach) — attempts is SEND-FAILURE budget
          // (`MAIL_MAX_ATTEMPTS`'s own docstring), and this row was never
          // attempted at all, only found unmeasurable before any gate below
          // could even run.
          //
          // No `MailRejectCode` applies here (scoped-verify H6: a `backOff` is
          // not a reject, so `registry-unmeasurable` — a `refuse(...)` code the
          // ingress route returns on the wire — has nowhere typed to land on
          // this row), but the two are the SAME underlying condition, and
          // `mail_deliveries.lastError` is free text a maintainer greps, not a
          // typed column — so the word itself rides along in the message
          // below, not just in this comment, for whoever greps the ROW rather
          // than the source.
          const attempts = d.attempts + 1;
          if (attempts >= MAIL_MAX_ATTEMPTS && !unmeasurable) {
            store.rejectDelivery(d.id, 'undeliverable', 'recipient not in registry');
          } else {
            const step = Math.min(MAIL_BACKOFF_BASE_MS * 2 ** (attempts - 1), MAIL_BACKOFF_MAX_MS);
            store.backOff(d.id,
              unmeasurable ? 'registry row listed but unreadable (registry-unmeasurable)' : 'recipient not in registry',
              now + step, !unmeasurable);
          }
          continue;
        }
        if (!(await this.deps.tmux.hasSession(d.toId))) continue;
        const hs = await hookStateFor(d.toId);
        // Pending-question guard ONLY (robust-mail-delivery spec §2.1 / F6b
        // fix). A null/stale `hs` must NOT block delivery: a resumed
        // long-idle worker, or one whose `/clear` emitted no registered hook,
        // has no fresh hookstate but is plainly deliverable — the live
        // status file, read unconditionally four lines below, is the sole
        // idle authority now (it already ran on this path before this fix;
        // this is not a new read). Block only when a FRESH hs affirmatively
        // carries an unanswered question — `hs.state` is no longer read here
        // at all.
        if (hs !== null && hs.ask !== null) continue;
        const pid = await this.deps.tmux.panePid(d.toId);
        const cfgDir = configDirFor(this.deps.cfg, identity.wrapper);
        if (!pid || !cfgDir) continue;
        const live = await readLiveState(this.deps.io, cfgDir, pid);
        if (!live || liveSessionStatus(live.status) !== 'idle') continue;
        if (live.statusUpdatedAt === null || now - live.statusUpdatedAt < MAIL_QUIET_MS) continue;

        // `seen` is added only HERE, once every gate above has passed and the
        // send is actually about to be attempted — it means "one message per
        // session per sweep", not "one row considered per sweep", and moving
        // the claim earlier must not change that.
        seen.add(d.toId);
        // The REFERENCE NUDGE (robust-mail-delivery spec §1), not `d.envelope`
        // — the lane no longer types the whole stored envelope into the pane.
        // `renderMailNudge` is a pure, ID-AGNOSTIC function of `d.toId` alone
        // (never called with the delivery id): a single-line, ~40-byte
        // reference that cannot wrap, cannot verify-fail on size and cannot
        // collapse to a paste chip. The body/ack instructions still live in
        // the stored envelope, unrendered here, served verbatim over
        // `GET /api/mail/:id` for the worker to fetch.
        //
        // `resumeIfOwn: true` (F3 / bug #21): if a PRIOR sweep's Enter for
        // this session's nudge was lost, the box now holds our own
        // un-submitted text — `sendPrompt` recognizes it (see its own
        // docstring) and presses Enter rather than reading it as
        // `draft-present` and backing off forever. Because the nudge carries
        // no per-delivery identity, resuming it is always correct regardless
        // of which due row this sweep is actually attempting.
        //
        // `clearMailResidue: prior` (spec §2.2): safe to clear ONLY when this
        // delivery has provably been attempted before (a failed send on
        // record, or a prior successful delivery now replaying) — the new
        // lane never types a multi-line payload, so a paste-chip or
        // ```ccrc-mail fence in the box of a delivery that has NEVER been
        // attempted is far likelier a human's own paste than our residue, and
        // is left untouched. `isMailResidue` itself also never matches human
        // text (send.ts's own docstring) — this is belt AND suspenders, not
        // either alone.
        const prior = d.attempts > 0 || d.deliveredAt !== null;
        const res = await sendPrompt({ tmux: this.deps.tmux, queue: this.deps.queue }, d.toId, renderMailNudge(d.toId),
          { resumeIfOwn: true, clearMailResidue: prior });
        if (res.ok) {
          this.mailCooldown.set(d.toId, now);
          store.markDelivered(d.id, now);
          // A REPLAY — this row was already `delivered` before this send —
          // counts against its own ceiling, independent of `attempts` (fix,
          // review finding 20: see `MAIL_REPLAY_MAX_ATTEMPTS`'s own
          // docstring for why `attempts` cannot serve this role). The FIRST
          // delivery (`d.deliveredAt === null`) never counts here.
          if (d.deliveredAt !== null) {
            const replays = store.bumpReplayCount(d.id);
            if (replays >= MAIL_REPLAY_MAX_ATTEMPTS) {
              store.rejectDelivery(d.id, 'undeliverable', MAIL_REPLAY_CEILING_ERROR);
            }
          }
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
    // C0.3: one session's own row, not the whole registry.
    const read = await readSessionRecord(this.deps.io, this.deps.cfg, id);
    if (!read.found) return { verdict: 'unknown', held: null };
    const rec = read.record;
    // SKIP (defer): a row with an unmeasured identity field — `measuredIdentity`
    // answers null — is treated EXACTLY like the previously-dropped row it
    // used to be before the ladder existed — `readSessionRecord` would have
    // answered `{found:false}` for this same fixture, and `!read.found` above
    // already meant `{unknown, held: null}`. `held: null`, not `rec.held`,
    // to preserve that pre-change shape
    // exactly, even though `.held` itself is a separate field that COULD
    // still be readable — the point of this branch is "answer nothing more
    // than the dropped row used to", not "answer everything we happen to
    // still have". Preserved explicitly rather than left to fall out of
    // `cfgDir`'s own failure below (only wrapper degradation would trigger
    // that) — `workdir`/`uuid` degradation must defer too, even though
    // neither is read directly in this function.
    const identity = measuredIdentity(rec);
    if (identity === null) return { verdict: 'unknown', held: null };
    const held = rec.held;
    if (!(await this.deps.tmux.hasSession(id))) return { verdict: 'ok', held };   // no pane: nothing is running
    const pid = await this.deps.tmux.panePid(id);
    const cfgDir = configDirFor(this.deps.cfg, identity.wrapper);
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
      // SKIP, before ANYTHING else — including the workspace/archivedAt test
      // right below, which itself becomes UNSAFE on a degraded row: both
      // fields read null on an unreadable file, and `workspace === null`
      // would make an actually-active merged workspace look like one with no
      // workspace at all (harmless), while `archivedAt !== null` reading
      // false-negative (null) on a row that WAS already archived would make
      // an already-archived workspace look freshly archive-ELIGIBLE again.
      if (measuredIdentity(r) === null) continue;
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
      // THE THIRD RUNG (Wave 2), and it is what makes this surface SAFE
      // rather than merely safer: an ABSENT hold is no longer sufficient to
      // archive. `coord.db` is the authority on "whose claim is this?" — the
      // hold file is one path keyed on a session id whose reason string is
      // display-only and parsed back nowhere. Release-then-crash (hold gone,
      // run still open) and the archive-vs-hold race both stop mattering
      // here, because the sweep now asks the authoritative question.
      //
      // `?.` IS LOAD-BEARING: `test/helpers.ts`'s `testDeps` supplies no
      // `coord`, and every archive test in `hold-gate.test.ts` and
      // `pr-sweep.test.ts` builds its watcher from it. A non-optional call
      // TypeErrors every test that reaches this archive path and has nothing
      // to do with runs — MEASURED by deleting the `?.`: 7 red, 3 in
      // `hold-gate.test.ts` and 4 in `pr-sweep.test.ts`. (The earlier
      // "fourteen" was never measured; this branch's own doctrine is that a
      // stated measurement holds.) The
      // `?? []` is NOT an overloaded null: a server with coordination
      // switched off has no runs to be claimed BY, so "no coord" and "no
      // open run" are the same fact here, not two a caller would handle
      // differently — the same stance every other coord-gated surface in
      // this file takes ("absent means none of this exists").
      //
      // NO CACHE, for the reason the rung two above already states in its own
      // words: a snapshot consulted at a destructive decision point is the
      // shape this function had to fix once. Measured N reaching this query
      // on the live fleet: 0 rows per sweep.
      const openRuns = this.deps.coord?.openRunsForSession(r.id) ?? [];
      if (openRuns.length > 0) {
        const s = openRuns[openRuns.length - 1]!;
        this.notifyHeldMerged(r, pr.number,
          `run ${s.id} is still open — ${s.program} wave ${s.wave}${s.waveOf === null ? '' : `/${s.waveOf}`}`);
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
      // host is upgraded — IN REMOTE MODE, where THIS WATCHER's own 60s
      // timer (`CAPS_REFRESH_MS`, just above) re-asks the agent regardless
      // of any signal from ccd; the agent itself has no timer, it answers
      // when asked and re-execs only when ccd's mtime/size has changed —
      // so no restart is needed.
      // In LOCAL MODE (fix round 4, task 14, Minor #5) `fleetState.ccdVerbs`
      // is read once, at boot (`localcaps.ts`), so a `ccdVerbs` that is
      // `null` (no evidence) or genuinely `[]` (measured, and this box's
      // ccd advertises nothing) self-heals only on the NEXT SERVER RESTART
      // — this sweep goes on skipping silently until then, not until the
      // next upgrade.
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
   *
   * THE ASYMMETRY (Task 2): `sweepHookStates`/`sweepTasks` above now RETAIN a
   * degraded row's last-known entry rather than erase it, because both read
   * something keyed off the identity triple (`r.uuid`, `r.wrapper`) that
   * reads `''` on a degraded row and would otherwise blank a value that may
   * still be true. This sweep has no such hazard to guard against: it keys
   * every read off `r.id` alone (`tmux.capture(r.id)`), which the registry
   * ladder never degrades — an id this loop iterates is, by construction,
   * listed. So a degraded row's dialog/statusline detection here is
   * UNCHANGED and fails stale BY DESIGN by simply running exactly as it
   * always has, needing no retain-don't-erase logic of its own — the code
   * makes that visible by NOT mentioning `measuredIdentity` anywhere below.
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
