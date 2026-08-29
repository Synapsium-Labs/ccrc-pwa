// Shared API types — single source of truth between ccrc-server and the PWA.
//
// The one import in this file, and the only kind it may ever have: a TYPE from
// a sibling in `shared/`, which erases at build time. `shared/` is L0 (the
// architecture doc) — it bundles into the PWA, so it imports no runtime module
// and nothing from `node:*`. `Hue` belongs to the roster's own file because
// `parseRoster` is what validates and auto-assigns it; `RosterWire` below only
// carries it.
import type { Hue } from './roster.js';

export type SessionStatus = 'busy' | 'idle' | 'dead';

/** Which attention bucket a session belongs to. THE authority: the fleet
 *  screen's sections, its counts and the row's own state word all read this one
 *  field, so they cannot disagree. Computed by `sessionBucket` below — which
 *  the server runs on every assembled session, and which `reviveFleetSession`
 *  runs on a cached snapshot that predates the field. */
export type SessionBucket =
  | 'attention' | 'working' | 'done' | 'idle' | 'cleanup' | 'archived' | 'dead';

/** The identity triple a registry read either measures or does not:
 *  `uuid`/`wrapper`/`workdir`, together — the fields `server/src/registry.ts`'s
 *  `SessionRecord.unmeasured` and `measuredIdentity()` gate on. Lives here,
 *  not only server-side, because `FleetSession.unmeasured` below carries the
 *  SAME evidence onto the wire (architecture doc, increment 1's second half,
 *  Task 2) — the registry ladder's presence/absence/unmeasurable vocabulary
 *  is exactly the kind of ubiquitous-language artifact `shared/` exists for,
 *  and the alternative (a second, server-only definition `fleet.ts` casts
 *  into) is the drift `UNCHECKED_PR`'s own docstring above spends thirty
 *  lines warning about. */
export type IdentityField = 'uuid' | 'wrapper' | 'workdir';

export interface FleetSession {
  id: string; wrapper: string; home: string; project: string; workdir: string;
  /** The worktree slug when this session is a workspace; null for a project's
   *  main checkout. Grouping and ws-rm both key off its presence. */
  workspace: string | null;
  name: string | null;                       // live display name from sessions/<pid>.json
  status: SessionStatus;
  statusUpdatedAt: number | null;            // epoch ms
  limits: { five: number | null; seven: number | null } | null;  // account of current wrapper
  dialogPending: boolean;                    // watcher saw an unanswered pane menu
  version: string | null;
  // Read from the pane statusline/mode-line the watcher already captures.
  model: string | null;                      // display name, e.g. "Opus 4.8 (1M context)"
  effort: string | null;                     // effort level, e.g. "xhigh"
  ultracode: boolean;                        // ultracode super-mode active
  branch: string | null;                     // current git branch
  tasks: TaskProgress | null;                // plan progress; null = this session has no task list
  /** This workspace's pull request, or null for a main checkout — which is the
   *  ONLY thing that suppresses the header control. */
  pr: PrState | null;
  /** Epoch SECONDS this workspace was archived (ccd writes `$REG/<id>.archived`
   *  as an epoch), or null. Every piece of archive copy in the UI derives from
   *  THIS, never from `pr.phase`: a merged PR whose archive was deferred
   *  because the session was busy must not claim it was archived. */
  archivedAt: number | null;
  /** The worktree size ws-archive measured AT ARCHIVE TIME. Null when the
   *  manifest is absent or half-written — never 0, which would argue
   *  against a cleanup that would free gigabytes. */
  archivedBytes: number | null;
  /** The workspace's program claim — the `.hold` file's reason string,
   *  verbatim; null when unheld. THE REASON STRING IS THE DISPLAY: this is
   *  what the fleet chip, the actions sheet's Release confirm and the
   *  held-merged push all render, with no parsing anywhere on any surface.
   *  `server/src/registry.ts`'s `SessionRecord.held` carries the fail-shut
   *  reasoning server-side — a present-but-unreadable `.hold` file reads as
   *  held THERE, never as this field's null.
   *
   *  `reviveFleetSession` below: absent → null (an older snapshot simply
   *  predates holds — degrade, do not reject), any non-string → reject the
   *  WHOLE session, the same split ruling `bucket` takes two fields up for
   *  the identical reason — an affirmative-looking value this build cannot
   *  parse must never be laundered into "unheld". */
  held: string | null;
  /** Hook-reported attention state, straight from `~/.cc-sessions/<id>.hookstate.json`
   *  (see `hookstate.ts`'s `readHookState`). Null means NO FRESH HOOK DATA —
   *  a hookless session, a stale file the freshness gate rejected, or a
   *  restarted session whose uuid moved on — never a fourth state. */
  hookState: 'working' | 'waiting' | 'done' | null;
  /** One line for the fleet card explaining what this session is blocked on
   *  (`fleet.ts`'s `hookAskSummary`). TWO sources, in order: a `waiting` hook
   *  state's `ask` envelope, and — when that produced nothing — Claude Code's
   *  own `waitingFor` reason off the live status file (D-76).
   *
   *  So this is NOT gated on `hookState === 'waiting'`: three of the four
   *  things Claude Code reports `waiting` for fire no hook event at all, and
   *  those rows carry a summary with `hookState` null. Still null whenever
   *  neither source said anything — a hook can report waiting before its ask
   *  write completes, and a `waiting` live file need not carry a reason —
   *  and never `''`, since this line renders unconditionally on a waiting
   *  card. */
  askSummary: string | null;
  /** Subagents the hook last reported running. Null mirrors `hookState`: no
   *  fresh hook data at all. `[]` is a MEASUREMENT — fresh hook data, zero
   *  subagents running — same null-vs-empty-array discipline as `WsAudit`'s
   *  array fields above. */
  subagents: { name: string; startedAt: number }[] | null;
  bucket: SessionBucket;
  /** Epoch ms this session ENTERED `bucket`, as evidenced by the underlying
   *  record — never a watcher's memory of when it noticed, which would reset on
   *  every restart and paint the whole fleet as freshly-unseen after a deploy.
   *  Null when no evidence exists. Drives the PWA's unseen watermark. */
  bucketSince: number | null;
  /** Which of the identity triple THIS assembly could not measure (registry
   *  ladder — `server/src/registry.ts`'s `SessionRecord.unmeasured`, carried
   *  onto the wire verbatim by `fleet.ts`'s `assembleFleet`). Empty on every
   *  fully-measured row, which is every row before this field existed and
   *  the overwhelming majority after. Non-empty means DEGRADED: `status`,
   *  `branch`, and every other field this assembly could only derive via
   *  `configDirFor(wrapper)`/`readLiveState` may be frozen at a fallback
   *  default rather than freshly read, because the wrapper/uuid/workdir this
   *  pass needed for that lookup came back unreadable, not absent (THE
   *  PRINCIPLE: degrade-and-heal for display, never guess and call it fact).
   *
   *  Two consumers this field exists for: the PWA renders a degraded row in
   *  the small, honest `PrKeycap` grey+reason register — never a new banner
   *  (`pwa/src/fleet/SessionLine.tsx`) — and `pwa/src/lib/offline.ts`'s
   *  `saveFleetSnapshot` refuses to persist a frame carrying one as
   *  last-known-good, the same reasoning `lib/seen.ts`'s `prune` already
   *  states for an empty frame: absent evidence proves nothing, and a guess
   *  persisted as fact defeats the one thing a last-known-good cache is for. */
  unmeasured: readonly IdentityField[];
  /** True when this assembly could not measure this session's LIVE STATUS —
   *  `<cfgDir>/sessions/<pid>.json` was there and its bytes never came back —
   *  so the `status` word above is this surface's fail-shut guess (`busy`,
   *  see `fleet.ts`'s `assembleFleet`) rather than a reading.
   *
   *  A SECOND FIELD, NOT AN ENTRY IN `unmeasured` ABOVE (D-115). That array is
   *  typed `IdentityField[]` and means precisely "which of the identity TRIPLE
   *  this assembly could not measure"; `measuredIdentity` gates on its being
   *  EMPTY, so a non-identity marker pushed into it would make every such
   *  row's identity read as unmeasurable fleet-wide — a much larger lie than
   *  the one it would be fixing. The two facts are genuinely different: a
   *  degraded uuid/wrapper/workdir means the lookup never happened, while this
   *  means the lookup happened and the file would not answer.
   *
   *  The consumer this exists for is `watch.ts`'s `unmeasuredIds`, which is
   *  the UNION of the two routes: a row whose status is a guess must never
   *  fire the busy→idle "✓ Finished" push and must never overwrite
   *  `prevStatus`, whichever way the status stopped being a measurement.
   *  Absent on an older peer's frame → `false`, which is the honest tolerant
   *  reading: an older build had no way to guess, so its status word was
   *  always either measured or frozen at a default `unmeasured` already
   *  covers. */
  statusUnmeasured: boolean;
  /**
   * WHY this row is not alive — spec §4.3's classification, computed by
   * `sessionLifecycle` in `fleet.ts` from the pane plus three registry stamps.
   *
   * A NEW FIELD, NOT A NEW `SessionStatus`/`SessionBucket` MEMBER (M10). The
   * bucket ladder is untouched: a dead row stays in the `dead` bucket and gains
   * a qualifier — "stopped by pwa, 2d ago", "orphan — nothing is watching it",
   * "running unsupervised".
   *
   * `null` means NO LIFECYCLE WAS RECORDED, which today is exactly one thing: a
   * snapshot written before this build. It is never a fourth classification —
   * `unmeasurable` is what "we could not measure" looks like, and it is a
   * member of the union, not this null.
   */
  readonly lifecycle: SessionLifecycle | null;
  /** The deliberate stop, as recorded (§4.1). Epoch MS — the timebase
   *  `statusUpdatedAt`/`bucketSince` already use, NOT `archivedAt`'s seconds.
   *  Null when no stop was recorded. The surface is a DECLARATION: it says the
   *  caller claimed to be the PWA, not that anything authenticated it. */
  readonly stoppedBy: { readonly at: number; readonly surface: StopSurface } | null;
  /** The last swap refusal (§2.4), epoch MS and the reason verbatim. Null when
   *  no refusal stands — cleared by a successful swap and by any deliberate
   *  revival (`ccd start`/`enable`/`ensure`), because a revive control that
   *  leaves the refusal banner standing on the row it just revived teaches the
   *  operator to ignore banners. */
  readonly swapBlocked: { readonly at: number; readonly reason: string } | null;
  /** The supervisor's standing substrate fault — `$REG/<id>.substrate`, the
   *  decision record `cmd_supervise` writes while tmux answers neither `live`
   *  nor `gone` (spec §2). Epoch MS (converted from the registry's seconds in
   *  `fleet.ts`, like `stoppedBy`) and the reason VERBATIM; the reason is the
   *  display on every surface, never parsed. Null when no fault stands.
   *
   *  AN AXIS, NOT A STATE (spec §3, M10): a new FIELD riding beside
   *  `status`/`bucket`/`lifecycle`, never a new member of any of them — the
   *  row keeps whatever those said last, and this says the console currently
   *  cannot re-measure them. `at: 0` is the "marker listed but unreadable"
   *  degrade from the registry read; renderers show the text without
   *  fabricating a 1970 timestamp.
   *
   *  `reviveFleetSession` below: absent → null (an older snapshot predates
   *  the axis), present-but-malformed → reject the WHOLE session — the
   *  `swapBlocked` contract, because free text has no vocabulary to degrade
   *  onto and "no fault recorded" over a flagged row is the destructive
   *  direction (the affordance gates key off this field). Live frames are
   *  CAST, not revived — read this field through `substrateFault` below. */
  readonly substrate: { readonly at: number; readonly text: string } | null;
  /** `$REG/<id>.started` reads `1`. MEASURED every snapshot as
   *  `SessionRecord.started` and, before Wave 1, discarded one branch later
   *  inside `sessionLifecycle`. It reaches the wire because the spawn chip needs
   *  it: `swift-harbor` has NO `spawn` stamp, so `started === false` is the only
   *  signal that shape ever emits. */
  readonly started: boolean;
  /** How the LAST spawn attempt ended (§1.6b). `null` = NOT RECORDED — never
   *  `ready`, never a warning. ORTHOGONAL to `lifecycle`: a row can be `running`
   *  today after a failed spawn yesterday, and showing one as the other would be
   *  an adapter narrowing a distinction it received. */
  readonly spawnState: SpawnVerdict | null;
}

/**
 * Tolerant read of `FleetSession.unmeasured` for a value that has NOT been
 * through `reviveFleetSession` — i.e. the live `fleet` WS frame.
 * `pwa/src/stores/fleet.ts`'s `asFleetMsg` validates only
 * `Array.isArray(sessions)` and casts (`return m as FleetMsg`); a LIVE frame
 * never revives. `FLEET_PROTO` stays 1 for this field on purpose (additive,
 * so an older server keeps talking to a newer client by design), so a row
 * from a server that predates Task 2 — a rollback, a `dist-pwa` deployed
 * before the process restarts, a cached client shell reconnecting to an old
 * process — can genuinely omit the `unmeasured` key at runtime even though
 * the type says it is required. Reading `.unmeasured.length` directly on
 * such a row is a hard `TypeError` (blocking review finding 2, MEASURED: it
 * killed `saveFleetSnapshot` and, via `SessionLine.tsx`, the renderer too).
 *
 * This is the one place both call sites (`pwa/src/lib/offline.ts`,
 * `pwa/src/fleet/SessionLine.tsx`) read the field, so they cannot drift onto
 * two different fallbacks. Absence reads as measured (`[]`) — the same rule
 * `optUnmeasured` below already applies on the persisted-snapshot revival
 * path: every session a pre-Task-2 build ever sent was, by that build's own
 * registry read, either fully measured or dropped outright, so there is no
 * history here to be ignorant about.
 */
export function unmeasuredFields(s: { unmeasured?: readonly IdentityField[] }): readonly IdentityField[] {
  return s.unmeasured ?? [];
}

/**
 * Tolerant read of `FleetSession.substrate` for a value that has NOT been
 * through `reviveFleetSession` — the live `fleet` WS frame, cast on arrival
 * (`unmeasuredFields` above records the whole argument, and the TypeError it
 * cost the one time a field was read directly). The ONE place every PWA
 * surface (chip, affordance gates, banner) reads the field, so they cannot
 * drift onto different fallbacks: a missing key or a null reads as "no fault".
 *
 * A PRESENT object degrades PER-HALF, never per-object — the `stampParts`
 * discipline (`pwa/src/fleet/lifecycleWords.ts`): the object's presence is
 * itself the fault claim, and collapsing a half-valid one to null would
 * un-flag a row a supervisor flagged. A bad `at` keeps the text (`at: 0`, the
 * same "undatable" value the unreadable-marker registry arm ships, so
 * renderers already suppress the timestamp for it); a bad or empty text keeps
 * the fault with a synthesized reason — never `''`, which renders as a blank
 * chip that looks like a styling bug instead of a fault.
 */
export function substrateFault(
  s: { substrate?: { at: number; text: string } | null },
): { at: number; text: string } | null {
  const v = s.substrate ?? null;
  if (v === null || typeof v !== 'object') return null;
  const raw = v as { at?: unknown; text?: unknown };
  return {
    at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : 0,
    text: typeof raw.text === 'string' && raw.text !== '' ? raw.text : 'substrate fault (reason unreadable)',
  };
}

/** The task list Claude Code keeps for a session, as the TUI's widget shows it:
 *  `subject` is the row label, `activeForm` the present-participle line the
 *  spinner wears while the task runs ("Building claude_spend_reader…"). */
export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface TaskItem {
  id: string;            // numeric string — Claude Code's own file name / task number
  subject: string;
  activeForm: string;
  description: string;
  status: TaskStatus;
}

/** Card-sized summary of the same list — what a glance needs, without the rows. */
export interface TaskProgress {
  total: number;
  done: number;
  running: number;
  active: string | null; // activeForm of the first in-progress task, else null
}

/** Where a workspace's pull request is, as ccrc last managed to find out.
 *
 *  `unchecked` is a FIRST-CLASS state, not a synonym for "no PR": keying the
 *  header control's visibility on `pr !== null` would make its absence an
 *  affirmative claim ("this session cannot have a PR") rendered identically to
 *  "we have not looked", and would put the retry affordance behind a control
 *  that is not on screen. */
export type PrPhase =
  | 'unchecked' | 'none' | 'no-commits' | 'open' | 'draft' | 'merged' | 'closed' | 'unknown';

/** CI rollup. `null` means NO CHECKS ARE CONFIGURED — distinct from 'pending',
 *  and rendered with different words.
 *
 *  `'unmeasured'` is the arm `null` used to swallow. Since the check rollup
 *  became its OWN gh call (it cannot ride the 100-PR window — that is answered
 *  `HTTP 504`), it can fail on its own while the rows come back perfectly: a
 *  timeout, a 5xx, or a join that would not run. Every one of those left the
 *  row with no `statusCheckRollup` key, which `checksFor` read as `null`, which
 *  this file defines as the AFFIRMATIVE claim "no checks are configured" and
 *  `PrKeycap` renders as exactly that — under a fresh `checkedAt`, on a PR
 *  whose build may be red. A read that did not happen must not wear the words
 *  of a read that did. */
export type PrChecks = 'pass' | 'fail' | 'pending' | 'unmeasured' | null;

/**
 * Why a `PrState`'s phase is `unknown`. Every member but `merge-unproven` and
 * `branch-drift` is a FAILED READ; those two are the opposite — nothing failed.
 * `merge-unproven`: GitHub answered fine and said MERGED, and a conjunct of the
 * merge predicate did not hold, so ccrc declines to call it merged. It exists
 * because `error` renders as "GitHub could not be read", which in that case is
 * simply untrue. `branch-drift`: ccrc's registry and git's worktree record name
 * different branches for one workspace, so "this workspace's branch" has two
 * candidate answers and ccd measures neither — the poller BINDS a PR to a name
 * and persists that binding, so picking a side would rewrite lineage rather
 * than report a fact. Reconcile with `ccd ws-rename`.
 *
 * Among the FAILED reads, `unavailable` and `truncated` are the two that name
 * GitHub's own fault rather than ours, and they exist because `error` — the
 * catch-all, which renders "GitHub could not be read." — was spending one
 * sentence on three unrelated worlds. Measured 2026-08-26 against a live repo
 * with several thousand PRs of history: `unavailable` is a 5xx from
 * api.github.com/graphql (500/502/503/504) — the request arrived and the far
 * side could not finish it, on 3/3 attempts, so the identical query will fail
 * identically and the remedy is to ask GitHub for less rather than to check
 * the token. `truncated` is a body that started and stopped (`unexpected end
 * of JSON input`), where a retry may simply succeed. `error` keeps everything
 * whose shape is genuinely unknown, which is the only thing it was ever an
 * honest answer for.
 *
 * Integration finding 7. This vocabulary lived in FOUR places: this union
 * (inline in `PrState.reason`), the snapshot-revival list below, `prstate.ts`'s
 * `REASONS` Set, and `PrKeycap.tsx`'s `REASON_TEXT`. Only the last of the four
 * failed when a member was added — `Record<PrReason, string>` over the union is
 * exhaustive — so a tenth reason could ship, be produced by ccd, be accepted by
 * neither validator, and arrive at the cap as `null`: a greyed control with no
 * explanation, which is the exact failure §6 forbids and the exact failure that
 * looks like nothing is wrong.
 *
 * Naming the union is half the fix; the other half is `PR_REASONS` below, which
 * is DERIVED from it rather than restated, so the runtime list gets the same
 * compile-time exhaustiveness the map already had.
 */
export type PrReason =
  | 'timeout' | 'offline' | 'unauthenticated' | 'rate-limit'
  | 'no-remote' | 'unsupported' | 'agent-down' | 'error'
  | 'merge-unproven' | 'branch-drift'
  | 'unavailable' | 'truncated';

/**
 * The runtime list, derived from the type. `Record<PrReason, true>` is what
 * makes adding a member to `PrReason` FAIL LOUDLY here — TS2739, "missing the
 * following properties" — instead of silently producing a list that is one
 * short. It fails in the other direction too (TS2353 on a key the union does
 * not have), which a hand-maintained array cannot do at all: today's arrays
 * were typed `readonly string[]`, and `readonly string[]` accepts a typo.
 *
 * This is the same technique `PR_PHASES`' own comment names for the phase list,
 * applied to the value rather than only to a test.
 *
 * `Object.keys` is safe to derive an ORDER from here because the map's keys are
 * all non-numeric strings, for which insertion order is specified. Nothing
 * downstream depends on the order regardless — both consumers ask membership.
 */
const PR_REASON_MAP: Record<PrReason, true> = {
  timeout: true, offline: true, unauthenticated: true, 'rate-limit': true,
  'no-remote': true, unsupported: true, 'agent-down': true, error: true,
  'merge-unproven': true, 'branch-drift': true,
  unavailable: true, truncated: true,
};
export const PR_REASONS: readonly PrReason[] = Object.keys(PR_REASON_MAP) as PrReason[];

/**
 * The validator that goes with the list, and the only way to narrow an
 * untrusted string to a `PrReason`. Same shape and same reasoning as
 * `isPrPhase` below: the parameter is `unknown` so nothing can be smuggled in
 * by claiming it is already a reason, and the CONSTANT is cast rather than the
 * input — `PR_REASONS.includes(raw as PrReason)` asserts the very thing the
 * check is asking.
 *
 * The `typeof` guard carries `isPrPhase`'s disclosed limitation verbatim: it
 * cannot be pinned by a test, because `Array.prototype.includes` uses
 * SameValueZero and no non-string is ever SameValueZero-equal to a string, so
 * dropping it returns the identical answer for every value in the universe. It
 * stays because the castless mutation is a type error, which means the only way
 * to remove it is to write an assertion on untrusted input.
 */
export function isPrReason(v: unknown): v is PrReason {
  return typeof v === 'string' && (PR_REASONS as readonly string[]).includes(v);
}

export interface PrState {
  phase: PrPhase;
  number: number | null;
  url: string | null;
  title: string | null;
  checks: PrChecks;
  /** Names of the FAILING checks. GitHub-sourced and attacker-controllable on
   *  any repo that accepts fork PRs, so this is inert text everywhere it is
   *  rendered: never a prompt, never an argv, never a shell word. */
  checkNames: string[] | null;
  ahead: number;                 // commits past base
  /** Why `phase` is `unknown` — see `PrReason` above, which is where the
   *  vocabulary is defined and where the next member is added. Null when the
   *  phase is not `unknown`, or when a read succeeded. */
  reason: PrReason | null;
  checkedAt: number | null;      // epoch ms of the gh read that produced this
  mergedAt: number | null;
  /** Epoch ms the sweep will next try this project, or null when nothing is
   *  scheduled. §6's rate-limit row promises the UI shows the reason AND the
   *  retry time, and `prBackoff` is the only thing that knows it — 15 minutes
   *  of a greyed cap with no explanation reads as broken rather than as
   *  waiting. Null on a ROUTE read failure, which backs nothing off and must
   *  not borrow the lane's clock. */
  retryAt: number | null;
}

/**
 * "We have not looked yet", as ONE object.
 *
 * Integration finding 6. This literal existed three times — `PrKeycap.tsx:17`,
 * `watch.ts:38` and `prstate.ts:190` (as `UNCHECKED`) — and the first of them
 * carried the docstring "Exported because `PrSheet` needs the identical object
 * and a second copy would drift." Two more copies appeared anyway, which is the
 * finding: a comment saying "do not copy this" is not a mechanism, and the two
 * copies were in a package that could not import the first one. `shared/` is
 * the only module all three sides already depend on, so this is the only place
 * the definition can live and still be reachable from the pwa, the server and
 * the agent.
 *
 * The drift is not hypothetical bookkeeping. `PrState` has eleven fields;
 * `watch.ts` spreads this as the base for a state it then marks `unknown`, and
 * `prstate.ts` spreads it inside `unknownView`. A field added to the interface
 * and to two of three copies gives the third `undefined` where the type
 * promises `null`, and `undefined !== null` is TRUE — the exact shape the
 * snapshot-revival comment below spends thirty lines on.
 *
 * FROZEN, because one shared object is exactly the situation where a caller
 * mutating it in place creates a fourth copy that no grep can find. Every
 * consumer spreads it; nothing needs to write to it.
 *
 * A FOURTH COPY IS CAUGHT, not merely discouraged:
 * `server/test/single-definition.test.ts` scans `shared/`, `server/src`,
 * `pwa/src` and `agent/src` for an object literal opening `phase: 'unchecked'`
 * and fails on any occurrence outside this file.
 */
export const UNCHECKED_PR: PrState = Object.freeze({
  phase: 'unchecked', number: null, url: null, title: null, checks: null, checkNames: null,
  ahead: 0, reason: null, checkedAt: null, mergedAt: null, retryAt: null,
});

/**
 * The eight phases as a runtime value, so a string read off disk (written by
 * ccd, possibly a version behind) can be validated rather than trusted.
 *
 * MODULE-PRIVATE (verify round 2, P3), and that is the pin. The fix for
 * integration finding 3 removed the double cast from `registry.ts` but nothing
 * stopped it coming back: the verifier reverted that line to the reported
 * defect verbatim and measured `tsc -p server` clean, the server suite
 * 1005/1005 and `typecheck-tests` 7/7 — the fix was not pinned against its own
 * reversal at the very call site the finding named.
 *
 * I tried to close that with a type first, and it does not work. MEASURED, not
 * assumed: branding the registry read (`type UntrustedField = string & {
 * readonly [B]: true }`) does NOT make `raw as PrPhase` an error, because
 * TypeScript's COMPARABLE relation permits asserting an intersection to a
 * subtype of one of its constituents. Both brand shapes I tried, and the whole
 * reverted expression built on them, compiled clean. A cast is what a cast is
 * for; no type in this language refuses one.
 *
 * What DOES refuse it is not having the constant. With `PR_PHASES` unexported,
 * `PR_PHASES.includes(prPhaseRaw as PrPhase)` cannot be written in
 * `registry.ts`, in `watch.ts`, in the PWA or anywhere else — it is TS2459
 * ("declared locally, but it is not exported") before the casts are even
 * considered. `isPrPhase` is the only door, which is what the rule three lines
 * down has been asking for in prose since it was written. Nothing outside this
 * module used the list (checked across server/src, shared, pwa/src and agent);
 * the test that needs the eight values derives them from `Record<PrPhase,true>`
 * instead, which is a stronger statement anyway.
 *
 * DISCLOSED RESIDUAL, stated rather than implied: inside THIS module the list
 * is in scope, so the shape is still writable here — see `isPrPhase`'s own
 * comment. Re-exporting the constant is also always available. What is closed
 * is the class the verifier found: a one-line reversal at a call site, in a
 * different file, that reads as ordinary and leaves every gate green.
 */
const PR_PHASES: readonly PrPhase[] =
  ['unchecked', 'none', 'no-commits', 'open', 'draft', 'merged', 'closed', 'unknown'];

/**
 * The validator that goes with the list. Use THIS, never `PR_PHASES.includes(x
 * as PrPhase)` (final review, integration finding 3).
 *
 * `PR_PHASES` is typed `readonly PrPhase[]`, so `.includes` demands a `PrPhase`
 * argument — which forces a caller holding an untrusted string to write
 * `raw as PrPhase`, asserting the very thing the check is asking, and then a
 * SECOND cast on the result. `registry.ts` did exactly that
 * (`PR_PHASES.includes(prPhaseRaw as PrPhase) ? (prPhaseRaw as PrPhase) : null`),
 * three lines under a comment in this file telling it not to. Behaviourally it
 * was fine — `null as PrPhase` is not in the array, so it fell through to
 * `null` — but the same shape one refactor later ("the raw read is now
 * `unknown`", "the phase list is now built from config") reads as validated
 * while asserting its way past the validation.
 *
 * A predicate removes both casts and narrows for real: the `unknown` parameter
 * means nothing can be smuggled in by claiming it is already a phase, and the
 * `typeof` guard means a non-string (a `null` off a half-written registry
 * entry, a number from a JSON snapshot) answers `false` rather than reaching
 * `.includes` as a `PrPhase`-shaped lie.
 *
 * The `typeof` guard is load-bearing and CANNOT be pinned by a test (verify
 * round 2, P3): dropping it and writing `.includes(v as string)` returns the
 * identical answer for every value in the universe, because
 * `Array.prototype.includes` uses SameValueZero and no non-string is ever
 * SameValueZero-equal to a string. That is a proof, not a guess — it is why the
 * seven "rejects a non-string" cases next door discriminate nothing. The guard
 * stays because the CASTLESS form of the mutation (`.includes(v)` on an
 * `unknown`) is TS2345, so the only way to remove it is to write an assertion
 * on the untrusted input, in the one function whose entire job is not doing
 * that, four lines under a comment saying so.
 */
export function isPrPhase(v: unknown): v is PrPhase {
  return typeof v === 'string' && (PR_PHASES as readonly string[]).includes(v);
}

/** What `GET /api/sessions/:id/pr` answers. `draft` is present ONLY in phase
 *  `none` — the one phase whose sheet is a composer — and `facts` is the line
 *  the composer always shows above the confirm. */
export interface PrView {
  pr: PrState;
  draft: { title: string; body: string } | null;
  /** `commits` and `dirty` are null for UNMEASURED — the branch did not resolve,
   *  or the worktree could not be corroborated and its tree read (deviation 10).
   *  Null is not 0: 0 is the claim "nothing past base" / "nothing uncommitted". */
  facts: {
    branch: string; baseShort: string; repo: string;
    commits: number | null; dirty: number | null;
  } | null;
}

/** One checkout nested under a workspace's worktree, as `_ws_child_manifest`
 *  reports it on the audit wire — a REGISTERED child (`git worktree add`
 *  ccd itself ran, found via `_ws_children`) or a filesystem `stray` it
 *  merely found sitting there. These are exactly the fields `_ws_fingerprint`
 *  hashes into `childrenDigest`, so what changes here is what invalidates a
 *  reap token.
 *
 *  `stray: true` carries `branch`, `headOid`, `dirty` and `busy` all `null` —
 *  an unregistered checkout ccd did not create earns no claim about its
 *  state, only the fact that something is there at `path`. A registered
 *  child gets the real reading: `dirty` is a count of uncommitted paths in
 *  ITS worktree (`0` is a real measurement, "clean"), `busy` is the git
 *  operation in progress there or `null`, and `headOid` is its resolved HEAD. */
export interface WsAuditChild {
  path: string;
  branch: string | null;
  headOid: string | null;
  dirty: number | null;
  busy: string | null;
  stray: boolean;
}

/** `enabled` = a `default.target.wants` symlink exists; `loaded` = the manager
 *  knows the unit but it is not boot-persistent; `absent` = `list-units` does
 *  not name it. NB `systemctl show` on an uninstantiated template reports
 *  `LoadState=loaded`, which is why ccd's probe must be `list-units`. */
export type WsAuditUnit = 'enabled' | 'loaded' | 'absent';
const WS_AUDIT_UNIT_MAP: Record<WsAuditUnit, true> = { enabled: true, loaded: true, absent: true };
export const WS_AUDIT_UNITS: readonly WsAuditUnit[] =
  Object.keys(WS_AUDIT_UNIT_MAP) as WsAuditUnit[];
export function isWsAuditUnit(v: unknown): v is WsAuditUnit {
  return typeof v === 'string' && (WS_AUDIT_UNITS as readonly string[]).includes(v);
}

/** `ccd ws-audit --session <id>`, with a server-added `sentence`. `token` is
 *  present ONLY when `verdict === 'reapable'`; the client sends it back as
 *  `expect`, and ccd re-proves the world state matches it. */
export interface WsAudit {
  id: string;
  /** THE BRANCH A REAP WOULD REMOVE — git's worktree record for this workspace
   *  when git has one, which is what `_ws_reap_eval` evaluates and what step
   *  (g) CAS-deletes. It is NOT necessarily the registry's `branch` field: an
   *  operator who switches branch inside a workspace makes the two diverge, and
   *  that is the normal end state of a workspace that was archived and reused.
   *  ccd used to refuse that state outright; it now resolves it the way
   *  `ccd ws-rm` always has (git decides, the registry witnesses), so this
   *  field and `registryBranch` are two facts rather than one. */
  branch: string;
  /** The registry's own `branch` field — reported, never acted on. `null` from
   *  an older ccd that did not emit it (absence-permits); equal to `branch`
   *  whenever the two records agree, which is the ordinary case. */
  registryBranch: string | null;
  /** The one sentence naming both branches and which one goes, built on the box
   *  where both names and the workdir are in hand. Empty string when the two
   *  records agree, `null` from an older ccd. A client MUST NOT reassemble this
   *  from the two names — that would be a second definition of the same rule. */
  drift: string | null;
  base: string; workdir: string; project: string; repo: string;
  exists: boolean;
  /** `REAP_WTHEAD === the registry's branch` — and it is FALSE for two
   *  different reasons, which is why nothing should render off it alone.
   *  Either the two records genuinely disagree (drift), or git's record was
   *  never read at all: every Phase-A refusal that returns before the worktree
   *  block leaves `REAP_WTHEAD` empty (`no-such-session`, `not-archived`,
   *  `worktree-missing`, `detached-head`, `no-worktree-record`), as does the
   *  resume-shaped path. `drift` is the field that separates them — non-empty
   *  only where a disagreement was measured — and it is what the sheet renders.
   *  It used to imply a refusal (drift was one); it no longer does, so a
   *  `reapable` verdict can carry `false` here. */
  headMatchesRegistry: boolean;
  reaping: string | null;
  /* ── THE SESSION BEHIND THE WORKSPACE ──────────────────────────────────────
   * Computed by ccd BEFORE `_ws_reap_eval`'s early refusal, unlike everything
   * in the `null MEANS NOBODY LOOKED` block below — a `not-archived` verdict
   * nulls those and that is exactly the shape that made F8's orphan invisible
   * to the one artifact whose job is answering "what is the state of this
   * workspace". These three are answerable on every verdict, so they are
   * answered on every verdict. */
  alive: boolean;
  started: boolean;
  /** `null` when the fleet host has no `systemctl` at all — and, by the same
   *  degrade, when the ccd that answered predates these fields. Never a fourth
   *  state; "we could not see a unit" is one fact, not two. */
  unit: WsAuditUnit | null;
  /* ── `null` MEANS NOBODY LOOKED ────────────────────────────────────────────
   *
   * The six fields below, plus `stashes` and `merge.fetchedAt`, are `null`
   * when the read that would fill them never happened — final-round tests
   * review F3, the fourteenth instance of the class deviation 10 named ("a
   * number is a measurement") and the FIRST to reach the delete-confirmation
   * surface itself.
   *
   * They were `string[]` / `number` and ccd emitted `[]` / `0` on every
   * verdict, straight out of `_ws_reap_reset`. `ReapSheet.tsx` renders these
   * rows unconditionally and the refusal paragraph comes AFTER them, so a
   * workspace refused in Phase A — before `_ws_collect_ignored`, before the
   * stash read, before the PR fetch — was described to the human as
   * "uncommitted: none / not in git: 0 entries, 0 B / stashes: none". Every
   * PWA-reachable Phase-A refusal (`registry-branch-drift`,
   * `foreign-worktree`, `no-worktree-record`, `detached-head`,
   * `incomplete-registry`) leaves the worktree ON DISK, holding whatever those
   * rows deny.
   *
   * The nullability is the enforcement, not the documentation. `worktreeBytes`
   * and `clips[].bytes` are `| null` for the same reason and the docstring
   * below says why in full: a producer that must emit a `number` has exactly
   * two options for a read that did not happen, and one of them compiles. Any
   * reader that folds these into a total or a sentence has to say which
   * branch it is on, and `ReapSheet` says "not scanned".
   *
   * `dirty` is `null` on a narrower condition than the rest, deliberately:
   * `cmd_ws_audit` reads the working tree ITSELF rather than taking the
   * eval's count, so on a refusal whose worktree is present and readable the
   * list is a real measurement and stays an array. It is `null` only when
   * there was no directory to read, or when the read failed or half-finished
   * (rc plus stderr, the rule `_ws_gc_dirty` states for the file). */
  dirty: string[] | null;
  ignored: { path: string; bytes: number; sensitive: boolean }[] | null;
  ignoredCount: number | null; ignoredBytes: number | null;
  sensitive: string[] | null;
  /** How many secret-SHAPED names the F3 refinement filtered as vendored or
   *  template noise (`credentials.d.ts`, `.env.example`, …) rather than
   *  treating as sensitive — a count, never a silent drop, so a wrong filter
   *  is something anyone can notice from the audit's own output. `null` when
   *  the scan that would have filtered them never ran: this and `sensitive`
   *  are two answers from the one scan, so they are unmeasured together. */
  sensitiveFiltered: number | null;
  /** `~/.cc-clips/<id>` — the reap `rm -rf`s it, so the sheet has to list it.
   *  It is fingerprinted too (`clipsDigest`), so a clip pasted between the
   *  sheet and the tap refuses `state-changed` rather than being deleted.
   *
   *  `bytes` is `number | null` and the `null` is the POINT (cross-lane seam
   *  round, the thirteenth measurement forgery). `_ws_clip_manifest`
   *  (ccd:6935/6917) answered a failed `du`/`stat` with `0` for as long as this
   *  field was typed `number`, and that is not a coincidence: a producer that
   *  must emit a `number` has exactly two options for an unreadable clip, and
   *  one of them compiles. Typing the absence is what stops the next person
   *  reintroducing the fabrication to satisfy the compiler — it is how this
   *  class survived twelve closures.
   *
   *  Null is NOT 0 and it is NOT "empty file": 0 is the claim that `rm -rf`
   *  will reclaim nothing here. `ReapSheet.tsx`'s `clipsSizeText` is the only
   *  reader; it never folds a null into the sum, because a partial total is
   *  banned by name alongside 0 — it states what was measured and discloses
   *  the rest ("1 MB + 1 unmeasured"). Same rule, same wording, as
   *  `worktreeBytes` below and `archivedBytes` on the archive sheet.
   *
   *  AND THE ARRAY ITSELF IS `| null` — the sixteenth instance of the class
   *  (final-round confirmation-surface review), one rung above the thirteenth.
   *  The thirteenth typed an entry's SIZE; this types the LIST. A clips
   *  directory that exists and cannot be enumerated (`chmod 000`, measured:
   *  `find` exits 1 printing nothing) used to reach the wire as `[]`, and `[]`
   *  is not a degraded answer on this surface — `ReapSheet` renders it as
   *  **clips: none**, on a sheet whose Remove button was reachable, about
   *  pastes that exist nowhere else. `clipsDigest` was taken over the same
   *  `[]` on both sides, so the fingerprint agreed with itself and step (h)
   *  destroyed what nothing had listed.
   *
   *  `null` is "nobody could open the directory", `[]` is "it was opened and
   *  is empty", and ccd now refuses `clips-unreadable` rather than issue a
   *  token beside the null — so the only documents carrying it are refusals.
   *  Typed rather than documented for the reason `bytes` is: the empty array
   *  is the answer that compiles. */
  clips: { name: string; bytes: number | null }[] | null;
  /** `null` when `du` could not read the whole worktree — even partially, even
   *  a subdirectory — never a fabricated (and possibly ten-times-too-small)
   *  number (pre-merge fix round, finding F; deviation 10's rule). This is the
   *  figure `ReapSheet.tsx`'s confirm button prints before a destructive
   *  action, so it must say "unknown" rather than a number it cannot stand
   *  behind. */
  /** `stashes` is `null` until `_ws_reap_eval` has read the stash list — 0 is
   *  the claim "nothing stashed is at stake", and the sheet renders it as the
   *  word "none". */
  /** `commitsAheadOfBase` is `null` when `$base` did not resolve, `$branch` was
   *  empty, or the `rev-list` failed — final-round destructive review F2, the
   *  last surviving `|| x=0` in ccd. 0 is the claim "this branch is level with
   *  base", which is what `_pr_state_one` (ccd:4656) already refuses to
   *  fabricate for the identical figure on the PR sheet. */
  stashes: number | null; worktreeBytes: number | null; commitsAheadOfBase: number | null;
  pr: { number: number | null; url: string; mergeCommit: string; headRefOid: string };
  /** `fetchedAt` is `null` until Phase C actually fetched. 0 is a real epoch
   *  second and the sheet printed it through a relative-date formatter, so a
   *  refusal that never reached the fetch read "merged … 20669 days ago" —
   *  beside `pr.number` and `proof`, which have said `null` for that same
   *  state since deviation 10. */
  /** `contained` is the fifth proof and the one with no PR beside it: the
   *  branch was never pushed and its tip is an ancestor of a freshly fetched
   *  origin/HEAD, so nothing unique exists to lose. `pr.number` is `null` on
   *  that verdict — the audit claims no merge it did not witness. */
  merge: { proof: 'ancestor' | 'tree' | 'patch-id' | 'cherry' | 'contained' | null; fetchedAt: number | null };
  transcript: string;
  /** The checkouts nested under this workspace's worktree — registered
   *  children ccd created plus any filesystem strays found beside them
   *  (`_ws_child_manifest`), populated INDEPENDENTLY of `verdict`: the
   *  per-child ladder in `_ws_reap_eval` stops descending at the first
   *  refusal, but this array is the audit's own walk, so a workspace refused
   *  on its very first stray still reports every child behind it.
   *
   *  Same rule as `dirty`/`ignored`/`clips` above, one rung earlier: `null`
   *  is NOBODY LOOKED — Phase A refused before the worktree HEAD was even
   *  read, which is the exact signal the walk itself gates on, so it never
   *  ran. `[]` is a MEASUREMENT — the walk ran and this workspace has no
   *  children, registered or stray. Never conflate the two: a refusal that
   *  never reached the walk is not the same claim as a childless workspace. */
  children: WsAuditChild[] | null;
  verdict: string; detail: string; token?: string;
  sentence: string;
}

/** `ccd ws-reap`. Exactly one of `reaped`, `refused` or `indeterminate` is set. */
export interface ReapResult {
  /** `bytes` is `number | null` — final-round tests review F2, the third and
   *  last of ccd's `_ws_gc_bytes "$workdir"` sites to stop fabricating a 0
   *  (`_ws_archive_manifest` and `cmd_ws_audit.worktreeBytes` were closed in
   *  earlier rounds). This one is the RECEIPT, printed after the irreversible
   *  delete, so `0` reads as "this deletion reclaimed nothing" — and on the
   *  resume path, where the worktree was already removed by the interrupted
   *  run, it was 0 every time. Nothing in the PWA renders it today; the type
   *  is what stops a future reader folding it into a total. */
  reaped?: string;
  /** On a receipt this is the branch that was DELETED — git's worktree record,
   *  which under drift is not the registry's name. */
  branch?: string;
  /** The registry's own branch, beside `branch`: the name this reap left alone.
   *  `''` when the two agreed, ABSENT on every refusal receipt (those printfs
   *  carry only `refused`/`detail`/`paths`) and from an older ccd — three
   *  distinct facts, kept distinct. Declared for the same reason `bytes` is:
   *  `parseReap` launders the object through a cast, so the type is the only
   *  thing that stops a future reader inventing a meaning for it. */
  registryBranch?: string;
  pr?: number | null; proof?: string;
  tombstone?: string; attic?: number; bytes?: number | null; resumed?: string | null;
  refused?: string; detail?: string; paths?: string[];
  indeterminate?: boolean;
  sentence: string;
}

/** `$REG/.reaped/<id>.json` — the record that OUTLIVES the workspace.
 *
 *  DECLARED HERE THOUGH NOTHING IMPORTS IT YET, which is the point and is the
 *  cross-lane seam pass's residual #1 closed: `clips[].bytes: null` reaches
 *  `_ws_tombstone` (ccd:6973) and is round-tripped by `_ws_tombstone_reclip`
 *  through `python3 json` on every resume, both JSON-transparent and both
 *  exercised — but the tombstone had NO declared type at all, so the one
 *  document that survives the delete was the only place on this branch where
 *  "bytes may be null" existed purely as ccd's behaviour. `WsAudit.clips` says
 *  it and is enforced; this said it nowhere. The first consumer written
 *  against this file (`ccd ws-attic`'s reader, a recovery tool, a support
 *  script) inherits the null instead of discovering it.
 *
 *  Written by ccd only. The field list is `_ws_tombstone`'s printf, in its
 *  order; `reflog` is a raw text dump and `attic` holds full ref names
 *  (`refs/ccrc/attic/<id>/…`), read back from git rather than passed in so the
 *  list has one producer. */
export interface WsTombstone {
  id: string; project: string; workdir: string;
  /** THE BRANCH THIS CLEANUP DELETED — git's worktree record for the workspace,
   *  the same fact as `WsAudit.branch`, and NOT the registry field this used to
   *  read. The two differ whenever the operator switched branch inside the
   *  workspace, and this document is what the RESUME path reads its branch back
   *  out of before step (g) CAS-deletes that ref — so a consumer that treated
   *  it as the registry's name would be describing a branch this cleanup went
   *  out of its way to leave alone. */
  branch: string;
  /** The registry's own `branch` field, the witness beside `branch`: reported,
   *  never acted on, still there after the reap. `''` when the two records
   *  agreed. ABSENT from a tombstone written before this field existed — where
   *  `branch` held the registry's name, which under the rung that then refused
   *  every drift was equal to git's by construction, so the two readings agree
   *  for every document that can lack it. */
  registryBranch?: string;
  base: string; tip: string;
  uuid: string; wrapper: string; mergeCommit: string; proof: string;
  pr: number | null; prUrl: string;
  /** Same shape and same producer as `WsAudit.ignored` — the manifest of what
   *  the delete destroyed, which is this document's reason to exist. */
  ignored: { path: string; bytes: number; sensitive: boolean }[];
  /** `bytes: number | null`, identical to `WsAudit.clips`, and re-measured on
   *  every resume by `_ws_tombstone_reclip` because (h) `rm -rf`s whatever is
   *  on disk at THAT instant. Null is a clip ccd could not size, never an
   *  empty file and never "nothing was reclaimed here".
   *
   *  THE WHOLE FIELD IS `| null` for the sixteenth instance of the same class,
   *  and here it is a RECORD rather than a refusal — the one consumer of
   *  `_ws_clip_manifest` that gets one. `_ws_reap_tail` writes `null` when the
   *  clips directory could not be enumerated, because this document outlives
   *  the workspace and `[]` in it is the permanent statement "this cleanup
   *  destroyed no pasted images" about a directory ccd could not open. The
   *  other two consumers refuse instead (`clips-unreadable`); refusing HERE,
   *  on the resume path, would strand a workspace half-deleted rather than
   *  finish it with a truthful record. */
  clips: { name: string; bytes: number | null }[] | null;
  transcript: string; attic: string[]; reflog: string;
  /** The children consented to at reap time (D2's per-child ladder), one RAW
   *  line per entry — `path<TAB>branch<TAB>head<TAB>dirty`, exactly the text
   *  `_ws_reap_eval` built into `REAP_CHILDLINES` and the teardown loop tears
   *  down in that same innermost-first order. `[]` is a MEASUREMENT (a
   *  workspace with no registered children), never absent or `null`: this
   *  document is written only on the fresh reap path, after Phase A/D2 has
   *  already run, so there is no unmeasured case to represent here — same
   *  discipline as `ignored`/`attic` two fields up, one rung earlier than
   *  `clips`'s own nullability. `_ws_tomb_children` (ccd) is the one reader,
   *  on a resume: it splits each line back into its four fields to rebuild
   *  the teardown loop's own consented set from disk rather than trust
   *  `REAP_CHILDLINES`, which a killed process never leaves behind. */
  children: string[];
  reapedAt: number;
}

/* ---------------------------------------------------------------------------
 * Snapshot revival — reading a FleetSession[] that an OLDER BUILD persisted.
 *
 * A `/ws/fleet` frame is NOT guaranteed to come from this build — that used
 * to be this comment's premise, and it is false: Rider E's handshake exists
 * exactly because it is false. `autoUpdate`'s 15-minute SW check leaves a
 * window where an open tab holds pre-deploy JS against a post-deploy server
 * (`FleetMsg`'s `hello` frame below, `FLEET_PROTO`/`FLEET_PROTO_MIN`, and the
 * block screen's "This app build is too old for the fleet server." all exist
 * to manage exactly that skew). The conclusion below still holds, but for a
 * narrower reason than "can't happen": the stale-client window is
 * new-writer/old-reader ONE-WAY — a newer server only ever ADDS frame fields
 * or types, and an already-deployed PWA already drops an unknown fleet frame
 * type silently (`fleet.ts`) — so the failure mode this file exists to catch
 * below (`undefined !== null` reading a whole fleet as archived) cannot arise
 * from a live `/ws/fleet` frame. It is real for the two PERSISTED snapshots,
 * because those are read back by whatever build starts NEXT — older, same,
 * or newer than the one that wrote them, unlike a stale tab on a forward
 * deploy, which can only ever be older than the server it talks to. (A
 * rollback breaks even that: deploy.sh keeps per-timestamp backups
 * precisely so the server can go back to a build older than a tab already
 * holds — the "older, same, or newer" span above is the honest one, not a
 * hedge.) The two snapshots: `ccrc.fleet-snapshot.v1` in localStorage
 * (pwa/src/lib/offline.ts) and `~/.ccrc/state-cache.json`
 * (server/src/fleetstate.ts).
 *
 * Reading them with a blind `as FleetSession[]` is not a cosmetic sin. Every
 * consumer tests `archivedAt !== null`, and `undefined !== null` is TRUE, so a
 * snapshot written before `archivedAt` existed reads as an ENTIRELY ARCHIVED
 * FLEET, offering "clean up workspace" on live ones; an absent `pr` gets
 * dereferenced for `.title`. Offline, that state never self-heals — the frame
 * that would overwrite the snapshot never arrives. `tasks` has had the same
 * hole since it was added (SessionLine renders `undefined/undefined`).
 *
 * The rule is uniform and deliberately incapable of inventing anything:
 *   - a NULLABLE field, absent            → null  (an older build lacked it)
 *   - a token from a newer build, where the type has a designated "we do not
 *     know" member                        → that member ('unchecked', null)
 *   - a NON-NULLABLE field absent, or ANY field of the wrong type
 *                                         → the whole snapshot is rejected
 *
 * Rejection collapses to `null`, which both readers already treat as "no
 * snapshot" — precisely the empty cold start that bumping the storage key would
 * have forced. So the worst a future required field can do is fall back to the
 * cheap fix; it can never fabricate state. One bad session rejects the whole
 * FILE rather than being dropped from it: a fleet quietly missing a session
 * looks exactly like a fleet, while an empty one looks empty.
 *
 * `reviveFleetSession` returns a FleetSession LITERAL, so a field added to the
 * interface and forgotten here is a compile error rather than a fourth outage.
 * ------------------------------------------------------------------------- */

/** The record fields the bucket ladder reads. A `Pick`, so `sessionBucket`
 *  accepts an assembled `FleetSession`, a revived one, or a test literal
 *  without any of them needing to be the whole shape. */
export type BucketInput = Pick<
  FleetSession,
  'status' | 'statusUpdatedAt' | 'dialogPending' | 'hookState' | 'archivedAt' | 'pr'
>;

/**
 * One session → one bucket, plus when it entered.
 *
 * Lives in `shared/` rather than server-side because there are TWO producers of
 * the `bucket` field and they must not be able to disagree: `fleet.ts` computes
 * it for the live wire, and `reviveFleetSession` below computes it for a cached
 * snapshot written before the field existed. `shared/` cannot import from
 * `server/`, so the only alternatives were a second copy of this ladder and a
 * test to shame it, or this — one definition both sides reach. It is not an
 * invitation for the PWA to bucket sessions itself: the live fleet's `bucket`
 * arrives on the wire already computed, and the client reads it.
 *
 * Pure, and deliberately memory-free: every branch below reads a timestamp that
 * is ALREADY on the record and already means "when this began", so the function
 * survives a server restart with identical answers. A `Map<id, since>` held by
 * the watcher would reset on every deploy — and ccrc deploys several times a
 * day — training the operator to ignore the unseen badge within a week.
 *
 * Order is load-bearing. The archived rows come first because `ws-archive`
 * stops the session: every cleanup candidate is ALSO `status: 'dead'`, so a
 * dead-first ladder would leave the cleanup bucket permanently empty.
 *
 * …and that sentence is also the archived rungs' PRECONDITION, not merely
 * their justification (D-74). They are entered on `archivedAt !== null` AND
 * `status === 'dead'`, because a live pane is proof the marker has outlived
 * what it describes: `cmd_ws_archive` kills the session before it stamps
 * (`ccd:3958`), but `ccd start`/`ccd ensure` clear `.stopped` and
 * `.swapblocked` on a deliberate revival and leave `$REG/<id>.archived`
 * standing — only `ws-restore` removes it (`ccd:4498`). So a workspace
 * archived on merge and later revived for more work carried a marker that
 * outranked every live rung below, for ever. MEASURED on the live fleet
 * 2026-08-17: 5 of the 7 archive markers on the box sat on sessions with a
 * live tmux pane, 4 of them mid-turn — a quarter of the fleet reading
 * `merged` while working, ranked below idle and counted out of its project's
 * busy total, and a revived workspace's QUESTION unreachable through the
 * attention section it belongs in.
 *
 * The conjunct costs the cleanup bucket nothing: an ordinary archive is dead,
 * which is what every archived case in `bucket.test.ts` already fixtures. And
 * it hides nothing on the disk side — `archivedAt` is untouched on the wire,
 * so the fleet footer's `/archive` route (which reads that field, not this
 * bucket), `ws-attic` and the reap flow all still find the workspace. The
 * bucket answers "what is this session doing"; `archivedAt` answers "what is
 * staged on disk". A revived workspace is honestly both, and only the second
 * question has an archive in its answer.
 *
 * `hookUpdatedAt` is read ONLY by `bucketSince`; no branch's BUCKET depends on
 * it. That is what lets `reviveFleetSession` call this with `null` and keep the
 * bucket while discarding the timestamp.
 *
 * `hookEvent` (optional, default `null`) is read ONLY by the `done` branch
 * below, and only to tell one specific `done` apart from every other: F1
 * (build4 dogfood) made `session-hook.sh`'s `SessionStart` write `state:
 * 'done'` so the mail delivery gate's `hs.state === 'done'` conjunct is
 * satisfied for a session that has never taken a turn (a just-started
 * session IS at an idle boundary — the gate's reasoning is sound). But
 * `done` is ALSO this ladder's own bucket for "finished a turn", surfaced
 * verbatim on the wire (`fleet.ts`) and BADGED (`pwa/src/lib/seen.ts`'s
 * `BADGED` set) — and a `SessionStart` `done` proves no such thing: it is
 * "never started", not "just finished", the exact false positive this
 * ladder's own `done` docstring below warns a hookless idle→done claim would
 * be. Without this parameter a virgin worker would flash the `done` bucket
 * and get badged for ordinary spawn, training the operator to ignore the
 * badge — precisely what `seen.ts`'s own docstring says a badge must never
 * do. `reviveFleetSession` never has an `event` to pass (`FleetSession`
 * carries no such field on the wire — only `fleet.ts`'s LIVE assembly reads
 * `HookState.event` directly), so it always takes the default and keeps the
 * pre-F1 behaviour on a cached snapshot; that path is not where F1's virgin
 * session ever appears; it also self-heals independently of this parameter
 * (`HOOKSTATE_FRESH_MS`'s 30-minute freshness gate nulls a stale `hookState`,
 * so an unacknowledged bucket does not persist).
 */
export function sessionBucket(
  s: BucketInput,
  hookUpdatedAt: number | null,
  hookEvent: string | null = null,
): { bucket: SessionBucket; bucketSince: number | null } {
  // `archivedAt` is epoch SECONDS (ccd writes `$REG/<id>.archived` as an epoch);
  // every other timestamp on this record is epoch ms.
  //
  // `&& s.status === 'dead'` is D-74's conjunct — see this function's own
  // docstring for the measurement. `status === 'dead'` IS "no tmux pane" as
  // this ladder's callers compute it (`fleet.ts`'s `assembleFleet` starts every
  // row at `'dead'` and only leaves it when `tmux.hasSession` says otherwise),
  // so no new field, no wire change and no second liveness derivation.
  if (s.archivedAt !== null && s.status === 'dead') {
    const archivedMs = s.archivedAt * 1000;
    if (s.pr?.phase === 'merged') {
      // `cleanup` needs BOTH conjuncts, so it is entered at the LATER of the
      // two events — not at whichever one this branch happens to read first.
      // The auto-archive path makes them nearly coincide (sweepPr flips the
      // phase, archiveMerged archives seconds later), which is why plain
      // `archivedAt` looked correct: there, archiving IS the later event.
      // The MANUAL path inverts it. Archive a workspace whose PR is still
      // open at T0, open it at T1 (which acks it at T1), let the PR merge at
      // T2: the session enters `cleanup` at T2 while `archivedAt` still says
      // T0, so `isUnseen` compares T0 > T1 and the leapfrog bucket's badge
      // never fires in the exact flow it exists for. `pr.mergedAt` is already
      // on the wire (prstate.ts parses gh's own `mergedAt`), so the honest
      // stamp costs nothing. Null when the registry fallback supplied the
      // phase without a timestamp (`persistedPr`), which degrades to exactly
      // the old answer rather than to zero.
      return { bucket: 'cleanup', bucketSince: Math.max(archivedMs, s.pr.mergedAt ?? 0) };
    }
    return { bucket: 'archived', bucketSince: archivedMs };
  }
  if (s.status === 'dead') return { bucket: 'dead', bucketSince: s.statusUpdatedAt };
  if (s.dialogPending || s.hookState === 'waiting') {
    // The hook's timestamp is the honest episode start ONLY when the hook is
    // why we are here; a pane-scraped dialog has no hook write behind it.
    const since = s.hookState === 'waiting' ? hookUpdatedAt ?? s.statusUpdatedAt : s.statusUpdatedAt;
    return { bucket: 'attention', bucketSince: since };
  }
  // D-75. "Is a turn in flight" has TWO independent observers — Claude Code's
  // own `sessions/<pid>.json` (which becomes `status`) and `session-hook.sh`
  // (which becomes `hookState`) — and until now only the first could reach
  // this rung. Both of them fail, in opposite directions, and neither failure
  // is rare (see the D-75 block in `bucket.test.ts` for the measurements).
  // So: whichever observation carries the LATER timestamp is the one this
  // ladder believes. One comparison, computed once, read by both rungs below.
  //
  // A null `hookUpdatedAt` means there is no rival observation to compare
  // against — `reviveFleetSession` passes null for every cached snapshot —
  // and it reads as "the hook is not newer", which leaves that whole path on
  // exactly the pre-D-75 answers. A null `statusUpdatedAt` is the opposite:
  // the live file is absent or unreadable, so a hook write of ANY age is the
  // only observation there is, and it wins outright rather than losing to a
  // `status` that was never measured (`fleet.ts` leaves it at the `'idle'`
  // fallback).
  const hookNewer = hookUpdatedAt !== null &&
    (s.statusUpdatedAt === null || hookUpdatedAt > s.statusUpdatedAt);
  // `SessionStart` is excluded for the same reason the `done` rung below
  // excludes it: F1's synthetic write proves "never started", not "just
  // finished", so it is not evidence that a turn ENDED and must not unseat a
  // live `busy` — a resuming session is legitimately working while that write
  // is the newest hook fact on disk.
  const finishedAfterStatus =
    hookNewer && s.hookState === 'done' && hookEvent !== 'SessionStart';
  // NOT the hook's timestamp: the hook rewrites `updatedAt` on every
  // PostToolUse, so a busy session would report a continuously-refreshed
  // "since" — permanently new, and permanently badged. That holds for the
  // hook-raised arm too: `statusUpdatedAt` is the only stamp here that means
  // "when this episode began" rather than "when we last heard anything".
  if (s.status === 'busy' && !finishedAfterStatus) {
    return { bucket: 'working', bucketSince: s.statusUpdatedAt };
  }
  if (s.hookState === 'working' && hookNewer) {
    return { bucket: 'working', bucketSince: s.statusUpdatedAt };
  }
  // `done` requires hook EVIDENCE: a hookless busy→idle transition never proves
  // a turn finished rather than never starting. It also decays for free —
  // hookstate.ts's 30-minute freshness gate nulls `hookState`, so an
  // unacknowledged `done` falls back to `idle` instead of accumulating.
  if (s.hookState === 'done') {
    // `SessionStart` is F1's write, not a finished turn — see this
    // function's own docstring for `hookEvent`. Degrade to `idle`: exactly
    // the bucket a virgin session would report if `SessionStart` had never
    // touched `state` at all, which is the honest fact on the ground.
    if (hookEvent === 'SessionStart') return { bucket: 'idle', bucketSince: s.statusUpdatedAt };
    return { bucket: 'done', bucketSince: hookUpdatedAt ?? s.statusUpdatedAt };
  }
  return { bucket: 'idle', bucketSince: s.statusUpdatedAt };
}

/* ---------------------------------------------------------------------------
 * Session lifecycle — WHY a row is not alive.
 *
 * Spec §4.3. `ccd ls` used to print `ALIVE=no` for a session that was
 * deliberately stopped, one that died, and one that never started: three
 * different facts, one word. This is the vocabulary for the difference, and the
 * single pure ladder both producers run — `fleet.ts`'s live assembly here, and
 * ccd's bash twin `_session_state` on the fleet host, pinned against this one
 * by `server/test/ccd-session-lifecycle.test.ts` from a fixture neither side
 * writes by hand.
 *
 * A NEW FIELD, NOT A NEW `SessionStatus` OR `SessionBucket` MEMBER (M10). The
 * live fleet frame is cast, not revived (`asFleetMsg`), so an unknown bucket
 * reaches `RANK[bucket]` as a NaN comparator, `WORD[bucket]` as `undefined`,
 * and `DOT[status]`, where `dot.className = DOT[status].cls` THROWS in an
 * already-deployed PWA. A dead row's KIND of dead is a qualifier on the row,
 * never a new sorting class.
 *
 * PURE, and deliberately clock-free: `nowMs` is an input, so the whole table is
 * testable with no timers and the bash twin can be driven against the identical
 * fixed clock. State — the heartbeat's freshness window aside — lives at the
 * caller.
 * ------------------------------------------------------------------------- */

export type SessionLifecycle =
  | 'running' | 'unsupervised' | 'unclaimed' | 'stopped' | 'restarting'
  | 'orphan' | 'never-started' | 'unmeasurable';

/** Derived from the type, not restated beside it — `Record<SessionLifecycle,
 *  true>` makes a member added to the union fail LOUDLY here (TS2739) instead
 *  of silently producing a list one short, and fails the other way too (TS2353)
 *  on a key the union does not have. Same technique, same reasoning, as
 *  `PR_REASONS` above. */
const SESSION_LIFECYCLE_MAP: Record<SessionLifecycle, true> = {
  running: true, unsupervised: true, unclaimed: true, stopped: true, restarting: true,
  orphan: true, 'never-started': true, unmeasurable: true,
};
export const SESSION_LIFECYCLES: readonly SessionLifecycle[] =
  Object.keys(SESSION_LIFECYCLE_MAP) as SessionLifecycle[];

/** The only way to narrow an untrusted string to a `SessionLifecycle` — the
 *  snapshot-revival path reads one out of a cache an OLDER OR NEWER build
 *  wrote. `unknown` parameter so nothing can be smuggled in by claiming it is
 *  already a lifecycle, and the CONSTANT is cast rather than the input, exactly
 *  as `isPrPhase`'s own docstring insists. */
export function isSessionLifecycle(v: unknown): v is SessionLifecycle {
  return typeof v === 'string' && (SESSION_LIFECYCLES as readonly string[]).includes(v);
}

/** ccd's `_spawn` verdict as a word — a projection of the rc table ALREADY
 *  written to `$REG/<id>.spawn` (`<epoch-seconds> <rc>`) and already parsed into
 *  `SessionRecord.spawn: { at, rc } | null`. Derived ONCE, here, in L0.
 *
 *  There is no `spawnstate` registry field and there must never be one: the
 *  timestamp in `spawn` is load-bearing (`_supervised_start` compares
 *  `at >= since` to tell THIS attempt's failure from the previous one's), and a
 *  word-only field would destroy it.
 *
 *  `unrecognised` is the designated-ignorance member: an rc this build never
 *  heard of — rc 1, a ccd `die`, included — revives as that, never a throw and
 *  never `ready`. Orthogonal to `SessionLifecycle`: this says how the LAST
 *  SPAWN ATTEMPT ended, not what the row IS. A row can be `running` today after
 *  a failed spawn yesterday, and collapsing one into the other would be an
 *  adapter narrowing a distinction it received. */
export type SpawnVerdict =
  | 'ready' | 'login' | 'vanished' | 'expired' | 'blocked' | 'unrecognised';

/** Same derived-enumeration discipline as `SESSION_LIFECYCLE_MAP` above:
 *  `Record<SpawnVerdict, true>` fails LOUDLY (TS2739) on a member added to the
 *  union with no key here, and the other way (TS2353) on a key the union does
 *  not have. */
const SPAWN_VERDICT_MAP: Record<SpawnVerdict, true> = {
  ready: true, login: true, vanished: true, expired: true,
  blocked: true, unrecognised: true,
};
export const SPAWN_VERDICTS: readonly SpawnVerdict[] =
  Object.keys(SPAWN_VERDICT_MAP) as SpawnVerdict[];

/** The only way to narrow an untrusted string to a `SpawnVerdict`. `unknown`
 *  parameter, and the CONSTANT is cast rather than the input — `isPrPhase`'s
 *  own rule, for its own reason. */
export function isSpawnVerdict(v: unknown): v is SpawnVerdict {
  return typeof v === 'string' && (SPAWN_VERDICTS as readonly string[]).includes(v);
}

/**
 * What a MEASUREMENT of one skill's presence in one config dir found
 * (program-leverage wave 2, F2).
 *
 *  - `present`      — the skill's `SKILL.md` was read.
 *  - `absent`       — a PROVEN ENOENT. The installer has not run on this home,
 *                     which is ordinary rather than alarming:
 *                     `install-worker-skill.sh` skips a rostered account whose
 *                     config dir does not exist on that box.
 *  - `unmeasurable` — no answer was obtained. Either there was no path to read
 *                     (the wrapper is not in this box's roster, or the session
 *                     has no registry row), or the read itself failed — EACCES,
 *                     EISDIR, an agent whitelist refusal, a remote timeout, a
 *                     dropped socket.
 *
 * `absent` and `unmeasurable` are DIFFERENT ANSWERS and this declaration is
 * where they stay different: `absent` is evidence about the fleet,
 * `unmeasurable` is an admission about the measurement. Folding them would
 * claim an installation fact nobody measured — the overloaded-null defect this
 * codebase bans by name, and the one a reader acts on wrongly in both
 * directions (going to install a skill that is already there, or trusting a
 * home nothing ever looked at).
 *
 * DELIBERATELY NOT spelled with the read-failure pair that `ReadFailure`
 * declares in `server/src/io.ts`. That vocabulary describes ONE read's failure;
 * this one describes a conclusion drawn from a read that may never have
 * happened, and `unmeasurable` is the wider word on purpose.
 * `single-definition.test.ts` pins that pair to `server/src/io.ts` alone — and
 * pins it as TEXT, so even naming it in a docstring here reds the build
 * (measured, while this comment was being written). Say `ReadFailure`, not its
 * members.
 */
export type SkillState = 'present' | 'absent' | 'unmeasurable';

/** Presentational only, and keyed BY the type so the compiler keeps it total —
 *  a member added to the union with no key here is a compile error, which is
 *  what makes the derived list below trustworthy. */
export const SKILL_STATE_MAP: Record<SkillState, string> = {
  present: 'installed',
  absent: 'not installed',
  unmeasurable: 'could not be measured',
};

export const SKILL_STATES: readonly SkillState[] =
  Object.keys(SKILL_STATE_MAP) as SkillState[];

export function isSkillState(v: unknown): v is SkillState {
  return typeof v === 'string' && (SKILL_STATES as readonly string[]).includes(v);
}

/** The word for `spawnVerdict(...) === null` wherever a verdict has to be
 *  RENDERED as text rather than carried as a value — today, `dispatch.ts`'s
 *  `spawn-adopted:<verdict>` run event.
 *
 *  DELIBERATELY NOT A `SpawnVerdict` MEMBER, and `isSpawnVerdict` answering
 *  `false` for it is pinned by a test. "No spawn fact was recorded" is a fact
 *  about the REGISTRY; every member of the union is a fact about an rc ccd
 *  actually wrote. `unrecognised` is the member that gets reached for by mistake
 *  here, and it is the narrower, opposite claim — ccd DID record an rc, and this
 *  build's table has no name for it. Reusing it for absence makes "ccd said
 *  something strange" and "ccd said nothing" the same sentence. */
export const SPAWN_NOT_RECORDED = 'not-recorded';

/** ccd's rc table, in one place. `null` in -> `null` out, and `null` means NOT
 *  RECORDED (`$REG/<id>.spawn` absent, or its rc unparseable — `registry.ts`
 *  collapses both to `spawn: null` deliberately). rc 5 is `_spawn_settle`'s
 *  hard-block verdict (`_pane_hard_blocked`); 3 and 4 are NOT renumbered,
 *  because four ccd call sites plus `_supervised_start` branch on
 *  `[[ "$rc" -eq 3 || "$rc" -eq 4 ]]`. */
export function spawnVerdict(rc: number | null): SpawnVerdict | null {
  if (rc === null) return null;
  switch (rc) {
    case 0: return 'ready';
    case 2: return 'login';
    case 3: return 'vanished';
    case 4: return 'expired';
    case 5: return 'blocked';
    default: return 'unrecognised';
  }
}

/**
 * A disagreement BETWEEN SOURCES — which is precisely what a per-row ladder
 * structurally cannot express, and the only reason this vocabulary exists beside
 * `SessionLifecycle` rather than inside it.
 *
 * FIVE KINDS, and the four that were proposed and rejected are named here so
 * nobody re-adds them: `dead-row` IS `lifecycle === 'orphan'` and strictly
 * broader (the shipped ladder splits that population three ways);
 * `unclaimed-session` was promoted to a `SessionLifecycle` member.
 *
 * `unsupervised` and `not-boot-persistent` die on COST, and the distinction is
 * worth stating precisely: `ccd ws-audit --session <id>` DOES report a `unit`
 * state (read from `systemctl --user list-units`) and IS already whitelisted, so
 * the server can see systemd for one row on demand. What it will not do is pay
 * one exec per session per sweep on a whole-fleet lane. Separately, the shipped
 * `unsupervised` token is a HEARTBEAT verdict, chosen deliberately over unit
 * introspection — reusing the word for a unit fact would be a second name for a
 * different thing. `EXEC_COMMANDS` stays the closed set `['tmux','ccd']`.
 *
 * `unregistered-worktree` KEEPS ITS NAME even though ccd's `_ws_gc_row` calls the
 * same thing `orphan`. That overload already exists and in the worst possible
 * form — `orphan` means "a registry row with no pane" in one half of this repo
 * and "a worktree with no registry row", the exact opposite, in the other.
 * Naming this kind explicitly defuses it.
 *
 * `provenance-mismatch` (build 9 D2). `corroboration()` is the ONE pure
 * function allowed to relate the three identity families, and a `disagrees` is
 * a fact the operator sees, never a silently picked winner. ccd cannot refuse
 * on identity — single UNIX user, attribution not authentication — and does
 * not pretend to, so the record IS the mechanism. NOT a boolean on the event
 * row: a disagreement is about the pair, and the census is where pairs are
 * weighed.
 *
 * `archived-but-live` (build 9 D9). Four rows measured on the live box are
 * stamped `merged:#N` and heartbeating. `.archived` is cleared only by
 * ws-restore and `_reg_purge`, never by start/ensure, so the one registry
 * field carrying a WHY is false on half the rows that have it — and a field
 * that is silently false reads as authoritative, which is worse than absence.
 * This kind names the contradiction with ZERO ccd semantic change. It does not
 * clear the stamp: clearing it destroys the archive record exactly as
 * `ws-restore` did until wave 3.
 */
export type DivergenceKind =
  | 'unregistered-worktree'   // git records a worktree no registry row claims
  | 'branch-drift'            // registry `.branch` != the worktree's own HEAD
  | 'claim-divergence'        // a hold with no open run, or an open run with no hold
  | 'provenance-mismatch'     // the kernel field contradicts the declared surface
  | 'archived-but-live'       // a row stamped archived that is heartbeating now
  | 'claim-orphan';           // a live path claim naming a run that is no longer open
const DIVERGENCE_KIND_MAP: Record<DivergenceKind, true> = {
  'unregistered-worktree': true, 'branch-drift': true, 'claim-divergence': true,
  'provenance-mismatch': true, 'archived-but-live': true, 'claim-orphan': true,
};
export const DIVERGENCE_KINDS: readonly DivergenceKind[] =
  Object.keys(DIVERGENCE_KIND_MAP) as DivergenceKind[];

/** The only way to narrow an untrusted string to a `DivergenceKind` — same rule,
 *  same reason, as `isSpawnVerdict` above: the CONSTANT is cast, never the
 *  input. */
export function isDivergenceKind(v: unknown): v is DivergenceKind {
  return typeof v === 'string' && (DIVERGENCE_KINDS as readonly string[]).includes(v);
}

export interface Divergence {
  readonly kind: DivergenceKind;
  /** Registry id when the kind is about a row; null for `unregistered-worktree`. */
  readonly id: string | null;
  /** Absolute worktree path when the kind is about a directory; null otherwise. */
  readonly path: string | null;
  /** One actionable line. DISPLAY-ONLY — nothing parses it back. */
  readonly detail: string;
}

/** Who asked for the stop — a DECLARATION, not an authentication (spec §4.1).
 *  `--surface pwa` means the caller said it was the PWA; a session that shells
 *  `ccd stop` from its own Bash tool passes no flag and records `cli`, which is
 *  honest — that is exactly what it looks like from the box. */
export type StopSurface = 'cli' | 'pwa' | 'agent' | 'ccd' | 'unknown';

const STOP_SURFACE_MAP: Record<StopSurface, true> = {
  cli: true, pwa: true, agent: true, ccd: true, unknown: true,
};
/** MODULE-PRIVATE, for the reason `PR_PHASES`' own docstring gives at length:
 *  with the list unexported, `STOP_SURFACES.includes(raw as StopSurface)`
 *  cannot be written in `registry.ts` at all — it is TS2459 before the casts
 *  are even considered — so `isStopSurface` is the only door. */
const STOP_SURFACES: readonly StopSurface[] = Object.keys(STOP_SURFACE_MAP) as StopSurface[];

export function isStopSurface(v: unknown): v is StopSurface {
  return typeof v === 'string' && (STOP_SURFACES as readonly string[]).includes(v);
}

/** The REGISTRY fields the ladder below reads. `alive` is deliberately not one:
 *  it comes from tmux, not from `$REG`, and arrives as a plain boolean. Naming
 *  a field here that the ladder does not read would make an unrelated degraded
 *  read (a stuck `.branch`) print `unmeasurable` over a perfectly measured row. */
export type LifecycleField = 'started' | 'stopped' | 'supervised';
const LIFECYCLE_FIELD_MAP: Record<LifecycleField, true> = {
  started: true, stopped: true, supervised: true,
};
export const LIFECYCLE_FIELDS: readonly LifecycleField[] =
  Object.keys(LIFECYCLE_FIELD_MAP) as LifecycleField[];

/** A `$REG/<id>.supervised` stamp younger than this means A SUPERVISOR IS
 *  WATCHING RIGHT NOW (spec §4.2) — strictly more useful than an enable
 *  symlink, which only promises a start at next boot. ccd re-stamps every 30
 *  seconds, so the window is four heartbeats wide: one missed tick is not an
 *  alarm, four is. The bash twin carries the same number in seconds. */
export const SUPERVISED_FRESH_MS = 120_000;

export interface LifecycleInput {
  /** A tmux pane exists for this id. */
  readonly alive: boolean;
  /** Epoch ms of the supervisor heartbeat; null = no stamp on disk. */
  readonly supervisedAt: number | null;
  /** Epoch ms of the stop stamp; null = no stamp on disk. */
  readonly stoppedAt: number | null;
  /** Who declared the stop. Carried so the input IS the stamp as read, rather
   *  than a lossy projection of it — the ladder deliberately does not branch on
   *  it (`session-lifecycle.test.ts` pins that no surface changes the answer),
   *  because "somebody stopped it" is the fact, and who is the row's copy. */
  readonly stopSurface: StopSurface | null;
  /** `$REG/<id>.started` reads `1` — this row ever had a session. */
  readonly started: boolean;
  /** Registry field names this pass could not MEASURE — listed in the registry
   *  directory but their bytes never came back. Three-valued input, collapsed
   *  to a name list: the present/absent/unreadable discrimination happens in
   *  the registry reader, which has the directory listing to do it with; this
   *  function only reads the verdict. Any member of `LIFECYCLE_FIELDS` here
   *  makes the answer `unmeasurable`; anything else is ignored. */
  readonly unmeasured: readonly string[];
  readonly nowMs: number;
}

/**
 * §4.3's table, in order. The order is the specification:
 *
 *   alive + no `started` claim         -> unclaimed      (§1.6, FIRST in the
 *                                                        alive branch — the F8
 *                                                        specimen was alive AND
 *                                                        supervised AND unclaimed)
 *   alive + fresh heartbeat            -> running
 *   alive + stale/absent heartbeat     -> unsupervised
 *   dead  + stop stamp                 -> stopped
 *   dead  + fresh heartbeat            -> restarting
 *   dead  + started                    -> orphan
 *   dead                               -> never-started
 *   any lifecycle field unreadable     -> unmeasurable   (checked FIRST)
 *
 * `unmeasurable` is checked before everything because architecture rule (b)
 * forbids a seam value that stands for more than one condition: remote
 * `readFile` collapses "missing", "forbidden" and "agent disconnected" into one
 * `null` (`remote/io.ts`), and an unreadable registry must NOT print `orphan` —
 * the one answer that says "nothing is watching this session" about a session
 * nobody managed to look at.
 *
 * The stop stamp is checked before the heartbeat in the not-alive branch so a
 * stop taken INSIDE the 120-second freshness window reads `stopped`
 * immediately, rather than spending two minutes claiming to be `restarting`.
 *
 * A stamp from the FUTURE is NOT fresh. This is a DEVIATION FROM THE BRIEF
 * (recorded in full in task-8-report.md): an earlier draft of this function
 * computed freshness as `nowMs - supervisedAt < SUPERVISED_FRESH_MS` alone,
 * on the theory that the honest reading of a skewed clock is "a supervisor
 * wrote this," never "nobody is watching." But ccd's shipped bash twin,
 * `_session_state` (ccd/ccd), computes freshness as `now - sup >= 0 &&
 * now - sup < 120`, and its own comment names exactly why the `>= 0` half is
 * there: without it, `now - sup` runs deeply negative for a future-dated
 * stamp and stays "< 120" for the life of the row, so a skewed or
 * hand-edited stamp would read fresh forever. Two implementations of one
 * rule must not diverge on a boundary neither the fixture nor ccd's own
 * enumeration test happens to probe — DISPATCH-CONTEXT §5's rule ("where a
 * brief and the shipped tree disagree, the tree wins") applies here exactly
 * as it would to a table row, so this ladder carries the identical `>= 0`
 * guard bash does.
 *
 * WHAT `orphan` CLAIMS, AND WHAT IT DOES NOT: it says nothing is watching this
 * session and nobody recorded stopping it. It does NOT claim the unit file is
 * absent — the server cannot see systemd at all (§4.2 chose a heartbeat over
 * introspection precisely so the agent's read whitelist stayed unwidened) — so
 * a unit that is enabled but `failed` and one that was never enabled both land
 * here. That conflation is deliberate and safe: the two have the same answer,
 * `ccd start <id>`.
 */
export function sessionLifecycle(input: LifecycleInput): SessionLifecycle {
  if (input.unmeasured.some((f) => (LIFECYCLE_FIELDS as readonly string[]).includes(f))) {
    return 'unmeasurable';
  }
  // A stamp from the FUTURE is NOT fresh — see this function's own docstring
  // for why the `>= 0` guard exists and why it matches ccd's shipped bash
  // rather than an earlier draft of this file.
  const supervised = input.supervisedAt !== null
    && input.nowMs - input.supervisedAt >= 0
    && input.nowMs - input.supervisedAt < SUPERVISED_FRESH_MS;
  // §1.6. THE ORDERING IS THE CONTRACT, and both implementations must agree on
  // it: `unclaimed` goes BEFORE the supervised split, because F8's specimen was
  // alive AND supervised AND unclaimed — an `unclaimed` checked after `running`
  // could never have fired on the row that motivated it. `unmeasurable` still
  // precedes everything above, so an UNREADABLE `started` (a LIFECYCLE_FIELD)
  // cannot be mistaken for an absent one.
  //
  // AND THE REPAIR IS THE OPPOSITE OF `orphan`'s: `orphan` says nothing is
  // bringing this back (the repair is a PROCESS); `unclaimed` says a process is
  // running that no registry row claims (the repair is a CLAIM — `ccd ensure`).
  if (input.alive) {
    if (!input.started) return 'unclaimed';
    return supervised ? 'running' : 'unsupervised';
  }
  if (input.stoppedAt !== null) return 'stopped';
  if (supervised) return 'restarting';
  return input.started ? 'orphan' : 'never-started';
}

type RawObj = Record<string, unknown>;

/** Thrown internally, caught at the boundary of `reviveFleetSession`, where it
 *  becomes a null return. Carries the field name for the debugger's benefit. */
class MalformedSnapshot extends Error {}

const asObj = (v: unknown, at: string): RawObj => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new MalformedSnapshot(at);
  return v as RawObj;
};

/** Absent or explicitly null → null. Present → must be the declared type. */
const optStr = (o: RawObj, k: string): string | null => {
  const v = o[k];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new MalformedSnapshot(k);
  return v;
};
const optNum = (o: RawObj, k: string): number | null => {
  const v = o[k];
  if (v === undefined || v === null) return null;
  // NaN/Infinity cannot survive JSON.stringify, but a hand-edited cache can
  // carry anything, and `NaN` typed as `number` is registry.ts's silent lie.
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new MalformedSnapshot(k);
  return v;
};
/** Absent or explicitly null → the caller's `dflt`. Present → must be a
 *  boolean. The default is a PARAMETER rather than `null`, because the fields
 *  that need this ("we could not see a session") have a meaningful degraded
 *  answer and inventing a third state for "an older peer did not say" would
 *  make every reader carry it. */
const optBool = (o: RawObj, k: string, dflt: boolean): boolean => {
  const v = o[k];
  if (v === undefined || v === null) return dflt;
  if (typeof v !== 'boolean') throw new MalformedSnapshot(k);
  return v;
};
const reqStr = (o: RawObj, k: string): string => {
  const v = o[k];
  if (typeof v !== 'string') throw new MalformedSnapshot(k);
  return v;
};
const reqNum = (o: RawObj, k: string): number => {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new MalformedSnapshot(k);
  return v;
};
const reqBool = (o: RawObj, k: string): boolean => {
  const v = o[k];
  if (typeof v !== 'boolean') throw new MalformedSnapshot(k);
  return v;
};

// Typed `readonly string[]` on purpose: validating an untrusted string against a
// `readonly PrPhase[]` needs `raw as PrPhase` on the value being checked, which
// asserts the very thing the check is asking. Cast the CONSTANT, never the input.
const STATUSES: readonly string[] = ['busy', 'idle', 'dead'];
// DERIVED, not restated — `PR_REASONS`' idiom above, and for a reason this
// list learned the hard way. It shipped as a hand-written `['pass', 'fail',
// 'pending']` and then `PrChecks` grew `unmeasured`, which the server began
// WRITING (a rollup GitHub answered with a 504 is not a verdict) while this
// validator still refused it — and refusal here is not a degraded field, it
// throws `MalformedSnapshot` and discards the WHOLE snapshot. A state cache
// written by this build would have been rejected by this build on its next
// boot. The `Record` makes the next member a compile error at this line
// instead. Cast the CONSTANT, never the input: `Object.keys` already answers
// `string[]`, so there is no cast left to get wrong. (D-638.)
const CHECKS_MAP: Record<Exclude<PrChecks, null>, true> = {
  pass: true, fail: true, pending: true, unmeasured: true,
};
const CHECKS: readonly string[] = Object.keys(CHECKS_MAP);
// Same shape as CHECKS, not PR_PHASES: `hookState` is already nullable and
// null already has a specific meaning ("no fresh hook data"), so an
// unrecognised token has nowhere honest to degrade to — landing it on null
// would claim "nothing was recorded" about a file that in fact recorded
// something this build cannot parse. Reject the whole snapshot instead, the
// same stance `checks` takes for the identical reason.
const HOOK_STATES: readonly string[] = ['working', 'waiting', 'done'];
// `bucket` splits from every sibling above it, on purpose (final review):
// ABSENT and UNRECOGNISED are not the same claim, so they get different
// answers, both enforced at the call site below.
//
// ABSENT is DERIVED, by running `sessionBucket` over the record that was
// revived alongside it. Every snapshot on disk the moment this field ships is
// missing it — that is not a corrupt file, it is just version skew, and
// rejecting it outright would discard the only degraded-mode data at exactly
// the moment it is needed (`server.ts` serves this snapshot during a
// fleet-host outage; `offline.ts` exists specifically to avoid an empty cold
// start).
//
// It used to land flat on `idle`, and that contradicted the record it sat on
// (whole-branch review, Important 3): a snapshot with `archivedAt` set and
// `pr.phase === 'merged'` is a cleanup row by every other surface's reckoning,
// and `ArchiveScreen` keys off `archivedAt` directly — so in exactly the
// degraded mode this cache exists for, the archive screen would list rows the
// bucket called `idle`, while attention and cleanup read empty. `bucket` is
// THE authority for sections, counts and the row's state word (spec §1); an
// authority that disagrees with its own record is worse than no field.
// Deriving costs nothing: the archived / cleanup / dead / attention / working
// rungs read `archivedAt`, `pr.phase`, `status`, `dialogPending` and
// `hookState`, all of which the revived literal already holds.
//
// `bucketSince` still degrades to `null`, and that asymmetry is the honest
// one: it is the single thing the ladder needs `hookUpdatedAt` for, and a
// snapshot never carried it. A timestamp for an episode we cannot date is a
// claim; the bucket is a reading of fields we have.
//
// UNRECOGNISED — a token PRESENT but not in this list, e.g. a future build's
// retired or renamed bucket — rejects the whole snapshot instead, same stance
// `checks`/`hookState` take two lines up and for the identical reason: unlike
// an absent field, a stray-but-present token is not an admission of ignorance
// the way `'unchecked'` or a null `hookState` is. `idle` is an AFFIRMATIVE
// claim that nothing is pending, and landing an unrecognised token there
// would silently empty the attention section — the one thing this field
// exists to keep honest.
const BUCKETS: readonly string[] = ['attention', 'working', 'done', 'idle', 'cleanup', 'archived', 'dead'];
// The reason list is NOT restated here (integration finding 7). It was the
// second of four copies; it is now `isPrReason`, over `PR_REASONS`, which is
// derived from the union. The comment above about casting the constant rather
// than the input is exactly why a predicate is the right shape for it.

/** `stoppedBy.surface` splits from `lifecycle` right below it, and takes the
 *  `pr.phase` ruling rather than the `bucket` one: `StopSurface` HAS a
 *  designated "we cannot say" member (`unknown`), so a surface from a newer ccd
 *  degrades onto it instead of rejecting a whole fleet's cache.
 *
 *  `SessionLifecycle` DOES have its own designated-ignorance member —
 *  `unmeasurable`, the exact counterpart to `unknown` above — but it means "we
 *  tried to classify this row and the evidence was degraded," not "this is a
 *  token from a build we do not understand." Landing an UNRECOGNISED token
 *  (an 8th union member some future build ships) on `unmeasurable` would claim
 *  a measurement attempt that never happened, the same reason `bucket` does
 *  not launder an unrecognised token onto `idle`. So an unrecognised
 *  `lifecycle` still rejects the whole snapshot, the same stance
 *  `bucket`/`hookState`/`checks` take three constants up — `null` (absent) is
 *  the only degrade this field has, and it means "never recorded", an
 *  affirmative claim about THIS build, not "we couldn't tell." */
const reviveStoppedBy = (o: RawObj, k: string): { at: number; surface: StopSurface } | null => {
  const v = o[k];
  if (v === undefined || v === null) return null;
  const s = asObj(v, k);
  const surfaceRaw = optStr(s, 'surface');
  return { at: reqNum(s, 'at'), surface: isStopSurface(surfaceRaw) ? surfaceRaw : 'unknown' };
};

/** No vocabulary to degrade onto: the reason is free text ccd wrote, and it IS
 *  the display. Absent → null; present-but-malformed rejects the session. */
const reviveSwapBlocked = (o: RawObj, k: string): { at: number; reason: string } | null => {
  const v = o[k];
  if (v === undefined || v === null) return null;
  const s = asObj(v, k);
  return { at: reqNum(s, 'at'), reason: reqStr(s, 'reason') };
};

/** `reviveSwapBlocked`'s contract exactly, for the same reason: the text is
 *  free prose the supervisor wrote and it IS the display, so a malformed value
 *  has no vocabulary to degrade onto. Absent → null (an older snapshot
 *  predates the axis); present-but-malformed rejects the session — null would
 *  read "no fault recorded" over a row a supervisor flagged unreachable,
 *  which is the direction the affordance gates fail open. (The per-half
 *  tolerance lives in `substrateFault`, for CAST live frames only — a
 *  PERSISTED snapshot this build wrote is held to the full shape.) */
const reviveSubstrate = (o: RawObj, k: string): { at: number; text: string } | null => {
  const v = o[k];
  if (v === undefined || v === null) return null;
  const s = asObj(v, k);
  return { at: reqNum(s, 'at'), text: reqStr(s, 'text') };
};

function revivePr(raw: unknown): PrState {
  const o = asObj(raw, 'pr');

  // A phase (or reason) this build does not know is exactly what version skew
  // looks like, and both types carry a designated "we have not looked": degrade,
  // do not reject. Same stance as registry.ts reading `prphase` off disk.
  const phaseRaw = optStr(o, 'phase');
  const phase: PrPhase = isPrPhase(phaseRaw) ? phaseRaw : 'unchecked';
  const reasonRaw = optStr(o, 'reason');
  const reason: PrReason | null = isPrReason(reasonRaw) ? reasonRaw : null;

  // `checks` is the opposite case: null means NO CHECKS ARE CONFIGURED, an
  // affirmative claim, so an unrecognised token has nothing safe to land on —
  // flattening it into null would print "no checks" over a failing build.
  const checksRaw = optStr(o, 'checks');
  if (checksRaw !== null && !CHECKS.includes(checksRaw)) throw new MalformedSnapshot('pr.checks');

  const namesRaw = o['checkNames'];
  let checkNames: string[] | null = null;
  if (namesRaw !== undefined && namesRaw !== null) {
    if (!Array.isArray(namesRaw) || (namesRaw as unknown[]).some((n) => typeof n !== 'string')) {
      throw new MalformedSnapshot('pr.checkNames');
    }
    checkNames = namesRaw as string[];
  }

  return {
    phase,
    number: optNum(o, 'number'),
    url: optStr(o, 'url'),
    title: optStr(o, 'title'),
    checks: checksRaw as PrChecks,
    checkNames,
    // No honest stand-in for "how many commits past base": 0 is a claim.
    ahead: reqNum(o, 'ahead'),
    reason,
    checkedAt: optNum(o, 'checkedAt'),
    mergedAt: optNum(o, 'mergedAt'),
    retryAt: optNum(o, 'retryAt'),
  };
}

type SubagentEntry = { name: string; startedAt: number };
const reviveSubagentEntry = (raw: unknown, at: string): SubagentEntry => {
  const o = asObj(raw, at);
  return { name: reqStr(o, 'name'), startedAt: reqNum(o, 'startedAt') };
};
/** `FleetSession.subagents` — `null` is NO HOOK DATA (same reason `hookState`
 *  is null), `[]` is MEASURED NONE. Same array-of-objects discipline as
 *  `optChildArray`/`optClipArray` above. */
const optSubagents = (o: RawObj, k: string): SubagentEntry[] | null => {
  const v = o[k];
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) throw new MalformedSnapshot(k);
  return (v as unknown[]).map((item, i) => reviveSubagentEntry(item, `${k}[${i}]`));
};

const IDENTITY_FIELDS: readonly string[] = ['uuid', 'wrapper', 'workdir'];

/** `FleetSession.unmeasured` — split from every OTHER array field above on
 *  purpose: absent degrades to `[]`, not to `null` (`optSubagents`'s own
 *  shape), because `[]` here does not mean "no data" — it means MEASURED,
 *  the honest reading for a field this snapshot predates. Every session a
 *  pre-Task-2 build ever persisted was, by that build's own registry read,
 *  either fully measured or dropped outright (the ladder's degrade-instead-
 *  of-drop behaviour is exactly what this field exists to report), so an
 *  absent field is not an admission of ignorance the way `subagents: null`
 *  is — there is no history here to be ignorant ABOUT. Present-but-wrong-
 *  shaped (not a string array, or a string outside the identity triple)
 *  rejects the whole snapshot, same as every other array field on this
 *  record: a value this build cannot parse must never be laundered into
 *  "measured clean". */
const optUnmeasured = (o: RawObj, k: string): readonly IdentityField[] => {
  const v = o[k];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || (v as unknown[]).some((x) => typeof x !== 'string' || !IDENTITY_FIELDS.includes(x))) {
    throw new MalformedSnapshot(k);
  }
  return v as IdentityField[];
};

/** One persisted session in today's shape, or null if it cannot be one. */
export function reviveFleetSession(raw: unknown): FleetSession | null {
  try {
    const o = asObj(raw, 'session');

    const status = reqStr(o, 'status');
    // SessionStatus has no "unknown" member, and it drives a CSS class name.
    if (!STATUSES.includes(status)) throw new MalformedSnapshot('status');

    const limitsRaw = o['limits'];
    let limits: FleetSession['limits'] = null;
    if (limitsRaw !== undefined && limitsRaw !== null) {
      const l = asObj(limitsRaw, 'limits');
      limits = { five: optNum(l, 'five'), seven: optNum(l, 'seven') };
    }

    const tasksRaw = o['tasks'];
    let tasks: TaskProgress | null = null;
    if (tasksRaw !== undefined && tasksRaw !== null) {
      const t = asObj(tasksRaw, 'tasks');
      tasks = {
        total: reqNum(t, 'total'), done: reqNum(t, 'done'), running: reqNum(t, 'running'),
        active: optStr(t, 'active'),
      };
    }

    const prRaw = o['pr'];
    const pr = prRaw === undefined || prRaw === null ? null : revivePr(prRaw);

    // Same shape as `checks` above: absent/null → null (no fresh hook data,
    // the overwhelmingly common case — most snapshots predate this field
    // entirely); a recognised token → itself; anything else rejects the
    // whole snapshot rather than launder an unparseable value into "no data".
    const hookStateRaw = optStr(o, 'hookState');
    if (hookStateRaw !== null && !HOOK_STATES.includes(hookStateRaw)) {
      throw new MalformedSnapshot('hookState');
    }

    // See `BUCKETS`' own comment for the full reasoning — absent derives from
    // the rest of this record, unrecognised rejects. Validated HERE, before the
    // record is built, so an unrecognised token still rejects without the
    // ladder ever running on it.
    const bucketRaw = optStr(o, 'bucket');
    if (bucketRaw !== null && !BUCKETS.includes(bucketRaw)) throw new MalformedSnapshot('bucket');

    // Absent → null (an older cache predates the field entirely — THE
    // compatibility contract, pinned in fleetstate.test.ts). NOT derived the
    // way `bucket` is: the ladder needs `alive` and a supervisor heartbeat no
    // snapshot ever carried, and a classification computed from fields we do
    // not have would be a claim, not a reading. `unmeasurable` (the
    // classifier's own designated-ignorance answer, `reviveStoppedBy`'s
    // docstring above has the full reasoning) is not the right degrade either:
    // it means the classifier RAN and its evidence was degraded, not that
    // revival never ran the classifier at all — a different kind of "we do not
    // know" than an absent field is.
    const lifecycleRaw = optStr(o, 'lifecycle');
    if (lifecycleRaw !== null && !isSessionLifecycle(lifecycleRaw)) {
      throw new MalformedSnapshot('lifecycle');
    }

    // Absent → null ("not recorded"). An unrecognised STRING rejects the whole
    // session rather than being laundered — the same rule `lifecycle` above
    // follows. Note the asymmetry with L0: an unrecognised RC becomes
    // `'unrecognised'` inside `spawnVerdict`, because an rc is ccd's own output
    // and a word off a cache is not.
    const spawnRaw = optStr(o, 'spawnState');
    if (spawnRaw !== null && !isSpawnVerdict(spawnRaw)) {
      throw new MalformedSnapshot('spawnState');
    }

    // Everything except `bucket`/`bucketSince`, so the ladder can read the
    // fields it needs off the SAME literal that ships — never off a second
    // reading of `o`, which is how the two could drift apart.
    const revived = {
      id: reqStr(o, 'id'),
      wrapper: reqStr(o, 'wrapper'),
      home: reqStr(o, 'home'),
      project: reqStr(o, 'project'),
      workdir: reqStr(o, 'workdir'),
      workspace: optStr(o, 'workspace'),
      name: optStr(o, 'name'),
      status: status as SessionStatus,
      statusUpdatedAt: optNum(o, 'statusUpdatedAt'),
      limits,
      dialogPending: reqBool(o, 'dialogPending'),
      version: optStr(o, 'version'),
      model: optStr(o, 'model'),
      effort: optStr(o, 'effort'),
      ultracode: reqBool(o, 'ultracode'),
      branch: optStr(o, 'branch'),
      tasks,
      pr,
      archivedAt: optNum(o, 'archivedAt'),
      archivedBytes: optNum(o, 'archivedBytes'),
      // Absent → null (`optStr`'s own rule) is the degrade this field wants —
      // an older snapshot predates holds entirely. Present-but-non-string
      // throws inside `optStr`, which `reviveFleetSession`'s catch turns into
      // "reject the whole session" — no custom parsing needed here, unlike
      // `bucket`'s derive-vs-reject split, because `held` has no absent-derive
      // case: nothing else on the record can tell you a workspace is claimed.
      held: optStr(o, 'held'),
      hookState: hookStateRaw as FleetSession['hookState'],
      askSummary: optStr(o, 'askSummary'),
      subagents: optSubagents(o, 'subagents'),
      unmeasured: optUnmeasured(o, 'unmeasured'),
      statusUnmeasured: optBool(o, 'statusUnmeasured', false),
      // `lifecycleRaw` is already narrowed to `SessionLifecycle | null` by the
      // guard above — no cast.
      lifecycle: lifecycleRaw,
      stoppedBy: reviveStoppedBy(o, 'stoppedBy'),
      swapBlocked: reviveSwapBlocked(o, 'swapBlocked'),
      substrate: reviveSubstrate(o, 'substrate'),
      // THE DEGRADE, DOCUMENTED: absent reads TRUE, not false. Every session a
      // pre-Wave-1 build persisted had a claim, and `false` would light
      // `unstarted` on every restored row — the false-positive direction that
      // makes a surface ignorable.
      started: optBool(o, 'started', true),
      spawnState: spawnRaw,
    };

    // A recorded bucket is taken as recorded, timestamp and all — the server
    // that wrote it had `hookUpdatedAt` and we do not. An absent one is derived
    // and dated `null`: the ladder's bucket needs nothing this record lacks,
    // its `bucketSince` does.
    return {
      ...revived,
      bucket: bucketRaw === null ? sessionBucket(revived, null).bucket : (bucketRaw as SessionBucket),
      bucketSince: bucketRaw === null ? null : optNum(o, 'bucketSince'),
    };
  } catch (err) {
    if (err instanceof MalformedSnapshot) return null;
    throw err;   // a real bug in here must not read as a corrupt snapshot
  }
}

/** A persisted `sessions` array in today's shape, or null — one unrevivable
 *  session rejects the file, which both readers already handle as "no data". */
export function reviveFleetSessions(raw: unknown): FleetSession[] | null {
  if (!Array.isArray(raw)) return null;
  const out: FleetSession[] = [];
  for (const item of raw as unknown[]) {
    const session = reviveFleetSession(item);
    if (session === null) return null;
    out.push(session);
  }
  return out;
}

/*
 * `reviveWsAudit` — same discipline as `reviveFleetSession` above, over
 * `ccd ws-audit`'s stdout rather than a persisted snapshot. The skew here is
 * not across time but across TRUST: `ccd` is a shell script a fleet host runs
 * an older or newer build of, so its JSON is exactly as untrusted as a
 * localStorage snapshot from a prior release — a field it forgot to print
 * must not read as `undefined` where the type promises `null`, and a field it
 * prints that this build's `WsAudit` no longer has must not survive a blind
 * `...(v as WsAudit)` spread (`server/src/wsaudit.ts`'s old `parseAudit` did
 * exactly that passthrough). `reviveWsAudit` returns a `WsAudit` LITERAL, so a
 * field added to the interface and forgotten here is a compile error, the
 * same guarantee `reviveFleetSession` gives `FleetSession`.
 *
 * Unlike `reviveFleetSession`, this function does NOT catch `MalformedSnapshot`
 * itself — it lets the throw travel. `parseAudit` is the one boundary that
 * turns "could not revive" into its existing null-return contract (which the
 * audit route already reads as a 502), so catching twice would just be two
 * places agreeing to do the same thing.
 */

/** `string[] | null` — absent/null → null; present must be an array of
 *  strings. Same shape as `pr.checkNames` above, used here for `WsAudit`'s
 *  `dirty` and `sensitive`: both are unmeasured-as-null, never unmeasured-as-
 *  `[]` (see `WsAudit`'s own docstring on the class). */
const optStrArray = (o: RawObj, k: string): string[] | null => {
  const v = o[k];
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || (v as unknown[]).some((x) => typeof x !== 'string')) {
    throw new MalformedSnapshot(k);
  }
  return v as string[];
};

type IgnoredEntry = { path: string; bytes: number; sensitive: boolean };
const reviveIgnoredEntry = (raw: unknown, at: string): IgnoredEntry => {
  const o = asObj(raw, at);
  return { path: reqStr(o, 'path'), bytes: reqNum(o, 'bytes'), sensitive: reqBool(o, 'sensitive') };
};
/** `WsAudit.ignored` — `null` is unmeasured, `[]` is measured-and-empty,
 *  identical rule to `optStrArray` above, one rung richer (an array of
 *  objects rather than of strings). */
const optIgnoredArray = (o: RawObj, k: string): IgnoredEntry[] | null => {
  const v = o[k];
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) throw new MalformedSnapshot(k);
  return (v as unknown[]).map((item, i) => reviveIgnoredEntry(item, `${k}[${i}]`));
};

type ClipEntry = { name: string; bytes: number | null };
const reviveClipEntry = (raw: unknown, at: string): ClipEntry => {
  const o = asObj(raw, at);
  return { name: reqStr(o, 'name'), bytes: optNum(o, 'bytes') };
};
/** `WsAudit.clips` — the array itself is `| null` (unmeasured vs. measured
 *  empty), and each entry's `bytes` is separately `| null` (an unreadable
 *  clip within a directory that WAS enumerated). Two independent nulls,
 *  two independent reasons — see the field's own docstring on `WsAudit`. */
const optClipArray = (o: RawObj, k: string): ClipEntry[] | null => {
  const v = o[k];
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) throw new MalformedSnapshot(k);
  return (v as unknown[]).map((item, i) => reviveClipEntry(item, `${k}[${i}]`));
};

/** `WsAuditChild` — a registered child's `dirty`/`branch`/`headOid`/`busy`
 *  are all independently nullable per-field (a stray carries all four null),
 *  while `path` and `stray` are always present. */
const reviveChild = (raw: unknown, at: string): WsAuditChild => {
  const o = asObj(raw, at);
  return {
    path: reqStr(o, 'path'),
    branch: optStr(o, 'branch'),
    headOid: optStr(o, 'headOid'),
    dirty: optNum(o, 'dirty'),
    busy: optStr(o, 'busy'),
    stray: reqBool(o, 'stray'),
  };
};
/** `WsAudit.children` — `null` is Phase A refusing before the independent
 *  child walk ever ran, `[]` is the walk running and finding nothing. Same
 *  class as `optIgnoredArray`/`optClipArray` above; see the field's own
 *  docstring on `WsAudit` for why the two must never be conflated. */
const optChildArray = (o: RawObj, k: string): WsAuditChild[] | null => {
  const v = o[k];
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) throw new MalformedSnapshot(k);
  return (v as unknown[]).map((item, i) => reviveChild(item, `${k}[${i}]`));
};

type AuditPr = { number: number | null; url: string; mergeCommit: string; headRefOid: string };
/** `WsAudit.pr` — unlike `PrState` (the fleet-header PR summary), this object
 *  is REQUIRED: `cmd_ws_audit` always prints it, with `url`/`mergeCommit`/
 *  `headRefOid` as empty strings when there is no bound PR, never as an
 *  absent key or a null object. */
const reviveAuditPr = (raw: unknown): AuditPr => {
  const o = asObj(raw, 'pr');
  return {
    number: optNum(o, 'number'),
    url: reqStr(o, 'url'),
    mergeCommit: reqStr(o, 'mergeCommit'),
    headRefOid: reqStr(o, 'headRefOid'),
  };
};

const PROOFS: readonly string[] = ['ancestor', 'tree', 'patch-id', 'cherry', 'contained'];
type AuditMerge = { proof: 'ancestor' | 'tree' | 'patch-id' | 'cherry' | 'contained' | null; fetchedAt: number | null };
/** `WsAudit.merge` — `proof` is a closed vocabulary (the four ways
 *  `_pr_state_one` can corroborate a merge, plus `contained` — the reap
 *  ladder's never-pushed-nothing-unique rung), validated the same way
 *  `isPrPhase`/`isPrReason` validate theirs: cast the CONSTANT, never the
 *  input. `fetchedAt` is `null` until Phase C actually fetched — the field's
 *  own docstring on `WsAudit` is why `0` cannot stand in for that. */
const reviveMerge = (raw: unknown): AuditMerge => {
  const o = asObj(raw, 'merge');
  const proofRaw = optStr(o, 'proof');
  if (proofRaw !== null && !PROOFS.includes(proofRaw)) throw new MalformedSnapshot('merge.proof');
  return { proof: proofRaw as AuditMerge['proof'], fetchedAt: optNum(o, 'fetchedAt') };
};

/** `ccd ws-audit --session <id>`'s stdout, already `JSON.parse`d, plus the
 *  server-computed `sentence` — to a `WsAudit` literal, or throws
 *  `MalformedSnapshot`. See the block comment above for why this does not
 *  catch its own throw. */
export function reviveWsAudit(v: unknown, sentence: string): WsAudit {
  const o = asObj(v, 'audit');
  const token = optStr(o, 'token');
  const unitRaw = optStr(o, 'unit');
  if (unitRaw !== null && !isWsAuditUnit(unitRaw)) throw new MalformedSnapshot('unit');

  return {
    id: reqStr(o, 'id'),
    branch: reqStr(o, 'branch'),
    // optStr, NOT reqStr, for the reason the `alive`/`started` block below
    // states in full: an older ccd on the fleet host omits both, and a required
    // read would throw away the whole sheet rather than one note.
    registryBranch: optStr(o, 'registryBranch'),
    drift: optStr(o, 'drift'),
    base: reqStr(o, 'base'),
    workdir: reqStr(o, 'workdir'),
    project: reqStr(o, 'project'),
    repo: reqStr(o, 'repo'),
    exists: reqBool(o, 'exists'),
    headMatchesRegistry: reqBool(o, 'headMatchesRegistry'),
    reaping: optStr(o, 'reaping'),
    // optBool/optStr, NOT reqBool — DELIBERATE, and decided beside the writer.
    // An older ccd on the fleet host omits all three; reqBool would throw and
    // the whole sheet would render nothing, against a rolled-back ccd or a
    // second fleet host. `false`/`null` say "we could not see a session",
    // which is what a build that cannot answer means.
    alive: optBool(o, 'alive', false),
    started: optBool(o, 'started', false),
    unit: unitRaw,
    dirty: optStrArray(o, 'dirty'),
    ignored: optIgnoredArray(o, 'ignored'),
    ignoredCount: optNum(o, 'ignoredCount'),
    ignoredBytes: optNum(o, 'ignoredBytes'),
    sensitive: optStrArray(o, 'sensitive'),
    sensitiveFiltered: optNum(o, 'sensitiveFiltered'),
    clips: optClipArray(o, 'clips'),
    stashes: optNum(o, 'stashes'),
    worktreeBytes: optNum(o, 'worktreeBytes'),
    commitsAheadOfBase: optNum(o, 'commitsAheadOfBase'),
    pr: reviveAuditPr(o['pr']),
    merge: reviveMerge(o['merge']),
    transcript: reqStr(o, 'transcript'),
    children: optChildArray(o, 'children'),
    verdict: reqStr(o, 'verdict'),
    detail: reqStr(o, 'detail'),
    ...(token !== null ? { token } : {}),
    sentence,
  };
}

/** `/api/fleet/health` — degraded-mode signal for the remote fleet host.
 *  `mode: 'local'` is always `{connected: true, downSince: null}` — there is
 *  no separate fleet host to lose. */
export interface FleetHealth {
  mode: 'local' | 'remote';
  connected: boolean;
  downSince: number | null;   // epoch ms since the agent connection dropped
  /**
   * Whether the fleet host's installed roster projection matches the one this
   * server's roster produces (`rosterAgreement`, server/src/fleetstate.ts).
   *
   * `'unknown'` is a real answer and not a null in disguise: local mode has no
   * second box, and an older agent does not report a digest. A reader must
   * render `'divergent'` and stay silent on `'unknown'` — treating the two
   * alike would warn on every deploy of an older agent, and a warning that
   * fires when nothing is wrong stops being read.
   *
   * Optional so an older SERVER's response still parses here — same
   * absence-permits rule the rest of the wire follows. Absent reads as
   * `'unknown'`.
   */
  roster?: 'agreed' | 'divergent' | 'unknown';
  /**
   * Whether the two boxes are running the same BUILD (`buildAgreement`,
   * server/src/fleetstate.ts, which re-exports the union declared just below
   * rather than restating it, so there is one vocabulary and not a wire copy).
   *
   * Same three-state rule as `roster`, for the same reason and with a different
   * remedy: `'skewed'` means deploy the lagging box, agent-first; `'unknown'`
   * means nobody could tell, and a reader must stay silent on it.
   *
   * Optional for the same absence-permits reason `roster` is — an older
   * server's response omits it, and absent reads as `'unknown'`.
   */
  build?: BuildAgreement;
  /**
   * The lifecycle journal mirror (build 9). Optional for the same
   * absence-permits reason `roster` and `build` are — an older server's
   * response omits it, and a reader must treat an absent block as
   * `state: 'unknown'`, never as `'ok'` and never as an empty history.
   */
  lifecycle?: LifecycleHealth;
}

/**
 * The two boxes' builds: same commit, different commits, or no evidence.
 *
 * DECLARED HERE, in L0, rather than beside `buildAgreement` in
 * `server/src/fleetstate.ts` where the function lives, for the one reason that
 * settles it: `FleetHealth` above is the wire shape, this file imports nothing
 * and is imported by everything, and `shared/` may not import `server/src`. The
 * alternative — the union spelled out inline on `FleetHealth.build` and again
 * as a `type` in `fleetstate.ts` — is what `roster` did, and it is two
 * declarations of one vocabulary that a third state would have to be added to
 * twice. `fleetstate.ts` re-exports this name so the decision function still
 * answers in the type its own module names (the same re-export shape
 * `server/src/buildinfo.ts` uses for `BuildInfo`).
 *
 * `'skewed'` and not `'divergent'`: `roster` already owns that word for a
 * different disagreement between the same two boxes, and a reader looking at
 * `{roster: 'divergent', build: 'divergent'}` should be able to tell which
 * sentence it is reading.
 */
export type BuildAgreement = 'agreed' | 'skewed' | 'unknown';

/* ---------------------------------------------------------------------------
 * The lifecycle JOURNAL's MIRROR — build 9's provenance record, server side.
 *
 * DISAMBIGUATION, said out loud because the name is already taken twice in
 * this file: `SessionLifecycle`/`sessionLifecycle()` classify why a REGISTRY
 * ROW is not alive, and `LifecycleField`/`LifecycleInput` are that ladder's
 * inputs. NOTHING below is related to them. These types describe
 * `$REG/.lifecycle/journal-<epochNs>.ndjson` — an append-only file `_reg_purge`
 * cannot reach — and its mirror in `coord.db`.
 *
 * `LifecycleEvent`, `MirroredLifecycleEvent` and `LC_OUTCOME_UNKNOWN` already
 * live above (wave 1, Task 4) — not restated here, so there is one home for
 * each rather than a second copy under this banner.
 * ------------------------------------------------------------------------- */

/** Why the mirror could not read bytes it knows existed. RECORDED, never
 *  silently skipped (spec D6): a byte we saw and could not model is a
 *  different fact from a byte that was never there.
 *
 *  `rotated-away` — a generation stopped being listed while undrained.
 *  `shrank` — an immutably-named generation got smaller, i.e. a truncation;
 *             the cursor resets to 0 and the whole file is re-read, and `uid`
 *             dedupes what comes back. Only genuinely-lost bytes are lost.
 *  `unknown` — the we-do-not-know member. `lifecycle_gaps.reason` IS a column
 *             read back, so a token a newer build wrote lands here rather than
 *             being switched on and rendered as nothing. It is also what a
 *             name that LOOKS like a generation but cannot be ORDERED gets
 *             (`looksLikeGenerationFile` true, `parseLifecycleGeneration`
 *             null) — the mirror saw a file it could not place in the
 *             sequence, which is a hole and not an absence. */
export type LifecycleGapReason = 'rotated-away' | 'shrank' | 'unknown';
const LIFECYCLE_GAP_REASON_MAP: Record<LifecycleGapReason, true> = {
  'rotated-away': true, shrank: true, unknown: true,
};
export const LIFECYCLE_GAP_REASONS: readonly LifecycleGapReason[] =
  Object.keys(LIFECYCLE_GAP_REASON_MAP) as LifecycleGapReason[];
/** The only way to narrow an untrusted string to a `LifecycleGapReason` — the
 *  CONSTANT is cast, never the input, exactly as `isDivergenceKind` above. */
export function isLifecycleGapReason(v: unknown): v is LifecycleGapReason {
  return typeof v === 'string' && (LIFECYCLE_GAP_REASONS as readonly string[]).includes(v);
}

/** One recorded hole in the mirror. `lostFrom`/`lostTo` are BYTE offsets in
 *  the named generation and are `null` together when the range could not be
 *  bounded — never 0, which would claim a measured empty loss. */
export interface LifecycleGap {
  readonly at: number;
  readonly gen: string;
  readonly reason: LifecycleGapReason;
  /** One actionable line. DISPLAY-ONLY — nothing parses it back. */
  readonly detail: string;
  readonly lostFrom: number | null;
  readonly lostTo: number | null;
}

/**
 * Whether the journal is being mirrored, and it is FOUR states rather than a
 * boolean for the reason `roster`/`build` above are three: a second
 * disagreement between the same two boxes gets its own word.
 *
 *   `ok`          — a sweep succeeded recently.
 *   `stale`       — no sweep has succeeded inside the staleness window. A
 *                   silently-stopped mirror must be distinguishable from a
 *                   quiet fleet, which is the whole point of reporting it.
 *   `unavailable` — the fleet host's ccd advertised its caps and
 *                   `lifecycle-v1` was NOT among them. A MEASURED ABSENCE,
 *                   never an empty history.
 *   `unknown`     — nothing has been measured (no caps evidence yet, or no
 *                   sweep has run). Not `ok`, and not `unavailable` either.
 */
export type LifecycleHealthState = 'ok' | 'stale' | 'unavailable' | 'unknown';
const LIFECYCLE_HEALTH_STATE_MAP: Record<LifecycleHealthState, true> = {
  ok: true, stale: true, unavailable: true, unknown: true,
};
export const LIFECYCLE_HEALTH_STATES: readonly LifecycleHealthState[] =
  Object.keys(LIFECYCLE_HEALTH_STATE_MAP) as LifecycleHealthState[];
export function isLifecycleHealthState(v: unknown): v is LifecycleHealthState {
  return typeof v === 'string' && (LIFECYCLE_HEALTH_STATES as readonly string[]).includes(v);
}

/** The `/api/fleet/health` block. `horizon`/`newestAt` are CCD's clock (event
 *  times); `lastOk` is THE SERVER'S (when a sweep last succeeded) — two clocks,
 *  two fields, never one. `writeErrors` is `$REG/.lifecycle/errors` as last
 *  measured: `null` = never measured, `0` = measured zero. */
export interface LifecycleHealth {
  readonly state: LifecycleHealthState;
  readonly newestAt: number | null;
  /** The oldest event still mirrored — the reconstruction window's floor
   *  (spec D8: `LC_TOTAL_MAX_BYTES` is roughly one year). Beyond it the mirror
   *  holds history the file no longer does. */
  readonly horizon: number | null;
  readonly rows: number;
  readonly generations: number;
  readonly gaps: number;
  readonly writeErrors: number | null;
  readonly lastOk: number | null;
}

/** `GET /api/lifecycle` — one session's past tense, oldest-first. `gaps` rides
 *  alongside the events deliberately: a timeline with a hole in it must say so
 *  in the same answer, not in a second call nobody makes. */
export interface LifecycleQueryResult {
  readonly events: readonly MirroredLifecycleEvent[];
  readonly gaps: readonly LifecycleGap[];
}

/**
 * "An account" (the operator's word) and "a wrapper" (ccd's word) are the same
 * concept — a `CLAUDE_CONFIG_DIR`-scoped Claude Code identity a session runs
 * under. This alias is the whole of what that concept still is IN THE TYPE
 * SYSTEM, and its emptiness is the point of Stage 2a: the roster stopped being
 * source code.
 *
 * It used to be a five-member union (`'claude' | 'claude2' | 'claude-corp' |
 * 'gpt' | 'claude-dev0'`) beside an `ACCOUNTS: Record<Wrapper, AccountDef>`
 * literal in this file, from which every other enumeration was derived. That
 * literal was itself the fix for a worse defect — one concept hand-enumerated
 * in eight places across three languages, no two of them the same set. A
 * missing entry in the first of those killed chat for six of `claude-dev0`'s
 * 24 sessions, silently, for the account's entire life (`resolve()` in
 * `sessionws.ts` returned null; the client only ever saw "unknown session",
 * indistinguishable from a reaped one). A hand-written, unordered prefix list
 * in the second attributed `claude-dev0-quiet-basin` to `claude`. Deriving
 * every list from one literal closed that class of bug: N=1.
 *
 * What one literal could NOT close is that it was still a compile-time fact.
 * Adding an account meant editing TypeScript, rebuilding, and redeploying to
 * every box; a box whose real accounts differed from the build's roster had no
 * way to say so. So the roster is now DATA: `~/.ccrc/accounts.json`, parsed and
 * validated by `shared/roster.ts`'s `parseRoster` (which refuses to boot on a
 * malformed one rather than degrading into a partial fleet), carried on
 * `CcrcConfig.roster` (`server/src/config.ts`), shipped to the PWA on
 * `GET /api/accounts` as `RosterWire[]`, and generated into bash for `ccd` as
 * `~/.ccrc/accounts.sh`. One roster, three languages, read at boot. N is still
 * 1; it just is not a literal any more.
 *
 * A wrapper is therefore a `string` here — and every boundary that receives one
 * already treated it as untrusted, because it always was: a
 * `SessionRecord.wrapper` is read off disk, an `AccountUsage.wrapper` is a
 * `.cc-limits/<name>.json` filename, and a swap target is whatever the server
 * last reported. The work the union used to do is all still done, as runtime
 * lookups against the roster:
 *
 *   `configDirFor(cfg, w)`   (server/src/config.ts) — `undefined` for an id the
 *                            roster does not have; THE one place a wrapper
 *                            becomes a directory
 *   `inRoster(roster, w)`    (shared/roster.ts) — the membership test
 *                            `isWrapper` used to be; `readLimits` uses it to
 *                            stop `autocompact-disabled`, a fleet-wide kill
 *                            switch that is not an account, from becoming a
 *                            phantom row on `GET /api/accounts`
 *   `roster.byIdLengthDesc`  (shared/roster.ts) — longest id first, so
 *                            `claude-dev0-quiet-basin` resolves to
 *                            `claude-dev0` rather than to the shorter `claude`
 *                            (`idHomeWrapper`, server/src/fleet.ts)
 *   `roster.homeAble`        — the accounts ccd's `_ws_least_loaded` may land a
 *                            new workspace on (`projectHome`, limits.ts)
 *   `rank()` in `GET /api/accounts` (server/src/server.ts) — roster declaration
 *                            order, with an unknown wrapper sorting LAST rather
 *                            than disappearing
 *
 * The alias survives its own union because it is documentation at a call site:
 * a `Wrapper` says which strings are meant where a bare `string` would not. It
 * narrows NOTHING — to the compiler it is `string` — so it must never be used
 * as though it did. That is exactly why `isWrapper(v): v is Wrapper` was
 * deleted rather than re-pointed at the roster: a predicate that narrows to
 * `string` reads like a guard while enforcing nothing, which is worse than no
 * guard at all.
 */
export type Wrapper = string;

/** One account's usage, read from telemetry (cc-limits) independent of whether a
 *  session is currently on it — so the display survives restarts/respawns/swaps.
 *  `ts` is epoch seconds of the last report. Telemetry is a byproduct of a
 *  session rendering its statusline, so an idle account simply stops reporting —
 *  which is why the rolledOver flags exist. */
export interface AccountUsage {
  wrapper: Wrapper;
  five: number | null;
  seven: number | null;
  ts: number | null;
  fiveResetAt: number | null;   // epoch seconds the 5h window resets
  sevenResetAt: number | null;  // epoch seconds the 7d window resets
  fiveRolledOver: boolean;      // the 5h window reset; the 0 above is inferred, not measured
  sevenRolledOver: boolean;     // the 7d window reset; the 0 above is inferred, not measured
  disabled: boolean;            // ccd's kill-switch for this lane is on
}

/** The account a new workspace would land on, projected server-side.
 *
 *  The routing rule lives in ccd (`_ws_least_loaded`) and the server owns the
 *  only other copy — the PWA must never compute a third, which would drift
 *  from both. `score` is the account's pressure, max(5h%, 7d%), so headroom is
 *  `100 - score`. It can exceed the swap ceiling: the rule returns the least
 *  loaded account even when every account is pinned, and saying so before the
 *  tap is the entire point of showing it.
 *
 *  On the wire (`GET /api/accounts`'s `projected` field) this is
 *  `ProjectedHome | null`: `null` iff every home-able lane carries the
 *  `<wrapper>-disabled` marker, mirroring `_ws_least_loaded`'s own empty
 *  stdout for the same case — nothing is placeable, and naming an account
 *  anyway would be a display lying about what a tap would actually do. */
export interface ProjectedHome {
  wrapper: Wrapper;
  score: number;
}

/**
 * One roster entry as the wire carries it — the PWA's entire view of an
 * account's identity, and deliberately NOT the parsed `AccountDef`
 * (`shared/roster.ts`). `configDirSuffix`, `exec` and `telemetry` describe how
 * the SERVER launches and measures an account; a browser has no use for them,
 * and `exec.secretsFile` in particular is a path into `~/.cc-secrets` with no
 * reader on the other end.
 *
 * `hue` is a colour NAME, never a colour value: `pwa/src/styles/tokens.css`
 * owns the actual colours and resolves each hue per theme, so shipping a hex
 * here would freeze one theme's palette into the wire.
 */
export interface RosterWire {
  id: Wrapper;
  /** Jargon-free, for a human — the one place a wrapper name is translated
   *  (plan: "Move to another account", never "swap wrapper"). */
  label: string;
  hue: Hue;
  /** Whether ccd's least-loaded picker may land a fresh session here. */
  homeAble: boolean;
  /** True when the roster declares this entry PLUMBING rather than an account —
   *  see `AccountDef.hidden` (`shared/roster.ts`) for what that means and why
   *  no predicate over the other fields can derive it.
   *
   *  ADDITIVE, and `FLEET_PROTO` is deliberately not bumped for it. A reader
   *  must test `=== true` and never truthiness: a server built before this
   *  field omits it, and ABSENCE MEANS "an account", so an older payload must
   *  keep rendering every entry exactly as it did. `rosterWrapperIds`
   *  (`pwa/src/lib/accounts.ts`) is the single reader that applies it. */
  hidden: boolean;
}

/**
 * `GET /api/accounts`, named once.
 *
 * This shape was restated by hand in three places — the handler's return
 * (`server/src/server.ts`), the PWA's fetch generic (`pwa/src/lib/api.ts`) and
 * the route test's cast (`server/test/accounts-route.test.ts`) — and this task
 * added a fourth field to it. Three hand-written copies is exactly the shape of
 * change where two get the new field and the third quietly drops it, with no
 * compiler anywhere to notice: the wire just loses the value. One interface,
 * three importers.
 */
export interface AccountsResponse {
  /** One row per account telemetry knows about (`.cc-limits/*.json`), plus any
   *  lane declared off — NOT one row per rostered account. */
  accounts: AccountUsage[];
  projected: ProjectedHome | null;
  /** Every account this box knows, in roster declaration order — including
   *  accounts nothing has measured yet, which `accounts` has no row for at
   *  all. This is what lets the PWA label and colour an account before any
   *  telemetry for it exists. */
  roster: RosterWire[];
}

/** Wire shape of `/ws/fleet`, the single source of truth for both ends — it
 *  used to be a private type duplicated in `fleet.ts` and server.ts literals,
 *  the exact two-copies failure this file's own revival logic elsewhere
 *  documents. `hello` is the dormant protocol handshake (see `FLEET_PROTO`
 *  below): sent synchronously as the first frame, before the async `fleet`
 *  snapshot. `notice`'s shape is `Notice` (`server/src/bus.ts`) plus the
 *  discriminant — copy the server's literal exactly if that type ever grows a
 *  field; a tidier-looking union here that the server does not actually send
 *  is worse than an ugly one that matches. */
export type FleetMsg =
  | { type: 'hello'; proto: number; min: number }
  | { type: 'fleet'; sessions: FleetSession[] }
  | { type: 'notice'; message: string }
  /** Build 7. ADDITIVE, so no FLEET_PROTO bump: an already-deployed PWA drops
   *  an unknown frame type silently (`pwa/src/stores/fleet.ts:54-73`), which is
   *  the one-way new-writer/old-reader rule this file states at :560-566. */
  | { type: 'runs'; runs: RunSummary[] }
  /** Build 4, spec §4.2. Additive on the same terms as `runs` above. */
  | { type: 'coord'; coord: CoordStatus }
  /** §1.6's census. Additive on the same terms as `runs`/`coord` above — an
   *  already-deployed PWA drops an unknown frame type silently, so NO
   *  `FLEET_PROTO` bump. FLEET-LEVEL, not row-level: a divergence names a
   *  disagreement BETWEEN sources, so it cannot ride on a `FleetSession` — and
   *  keeping it off `FleetSession` is what keeps `reviveFleetSession` from
   *  becoming a second producer. */
  | { type: 'divergence'; divergences: Divergence[] };

/**
 * What a registry MARKER file was measured to be. One type covers both markers
 * because they are one concept read one way: a name present or absent in the
 * single `readdir` the fleet lane already performs each tick.
 *
 * `unmeasurable` is not decoration and is not a third flavour of "no". The
 * registry directory can fail to list — and when it does, `dispatchRun` treats
 * that as a pause it cannot rule out and FAILS SHUT (`coord/dispatch.ts`). If
 * the wire could only say `clear`/`set`, the phone would render "running" for a
 * state the server would refuse to dispatch in. Not knowing is not `[]`.
 */
export type MarkerState = 'clear' | 'set' | 'unmeasurable';

const MARKER_STATES: readonly MarkerState[] = ['clear', 'set', 'unmeasurable'];

/** Use THIS, never `MARKER_STATES.includes(x as MarkerState)` — `isRunState`'s
 *  own rule, for its own reason (the array's element type would force a caller
 *  to assert the very thing it is asking). */
export function isMarkerState(v: unknown): v is MarkerState {
  return typeof v === 'string' && (MARKER_STATES as readonly string[]).includes(v);
}

/** The two markers the coordination lane is governed by: `coordinator-paused`
 *  (spec §4.2 — the one file that stops a program mid-flight) and
 *  `mail-disabled` (the injection kill-switch `sweepMail` already gates on).
 *  Read together because they come from one listing. */
export interface CoordStatus { pause: MarkerState; mail: MarkerState }

/** A `/`-command the composer can autocomplete. `insert` is what gets typed
 *  (with a trailing space so arguments follow naturally). */
export interface SlashCommand {
  name: string;                 // e.g. "compact" or "superpowers:brainstorming"
  desc: string;
  kind: 'builtin' | 'skill';
}

/**
 * `truncatedBytes` — THREE DOCUMENTED STATES, and the third is why the field
 * is optional (Build 4, spec §2.2/§2.4):
 *
 * - **absent** — *this server did not report*. An old server can only ever
 *   produce this, and it renders NO CUE. Never a claim of completeness: the
 *   fragment is presented as a fragment of unknown size, which is the honest
 *   thing a reader can act on.
 * - **`0`** — not truncated. The whole payload is here.
 * - **`>0`** — this many BYTES were cut off the end.
 *
 * Computed in `server/src/transcript/parse.ts`, not here (D-285 (was D-B4-12)): L0 imports
 * nothing, "not even `node:*`", so there is no `Buffer` in this file. The caps
 * upstream are CHARACTER caps and this report is in BYTES, deliberately — a
 * byte count is what an operator can compare against a file on disk.
 *
 * NO NEW `ChatEvent` KIND was added for this, and none may be: `buildChatItems`
 * funnels every non-tool event into `MessageBubble`, so an unknown kind renders
 * as a broken bubble in older PWAs rather than degrading honestly (spec §2.2).
 * An optional field on an existing member is the additive shape old readers
 * simply ignore.
 */
export type ChatEvent =
  | { kind: 'user'; uuid: string; ts: string; text: string }
  | { kind: 'assistant'; uuid: string; ts: string; text: string }
  | { kind: 'tool_use'; uuid: string; ts: string; toolId: string; name: string; input: string; truncatedBytes?: number }
  | { kind: 'tool_result'; ts: string; toolId: string; text: string; isError: boolean; truncatedBytes?: number }
  | { kind: 'system'; uuid: string; ts: string; text: string };

export interface AskOption { label: string; description?: string; preview?: string }
export interface AskQuestion {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: AskOption[];
}

/** An AskQuestion as it rides a Dialog: `options` is head-anchored to the PANE's
 *  rows by POSITION — entry k is the copy for row k+1 — and carries `null`
 *  wherever that row and the transcript disagreed (as do the rows past its end,
 *  the TUI's own, by simply not being there). The alignment tolerates one such
 *  disagreement from four options up — a capture taken mid-redraw loses a row —
 *  and that row is precisely the one whose copy is known to be wrong. Its index
 *  still types the pane's option, so the sheet keeps the pane's own label,
 *  description and no preview there rather than describe an answer the tap does
 *  not send. */
export interface DialogAsk extends Omit<AskQuestion, 'options'> {
  options: (AskOption | null)[];
}

export interface Dialog {
  id: string;               // sha1 of the option block text
  title: string;            // nearest non-empty line above the options
  body?: string;            // the full question / preamble above the options (multi-line)
  options: { index: number; label: string; description?: string }[]; // description = the option's sub-text
  selectedIndex: number;    // option with the ❯ marker
  parsed: boolean;          // false → render raw + point to terminal drawer
  raw: string;              // full pane tail for the unparsed case
  /** The real question, when the live menu is an AskUserQuestion and the
   *  transcript could be matched to it. Absent for scraped confirms (/model,
   *  /effort, permission prompts), which render exactly as they do today. */
  ask?: DialogAsk;
}

/** One AskUserQuestion question, as `session-hook.sh` copies it VERBATIM from
 *  the hook payload's `tool_input.questions` — the tool call's own JSON,
 *  never inferred from terminal text the way `AskQuestion` above is. That
 *  distinction is why the two types stay separate rather than sharing one:
 *  `multiSelect` is optional here because a hook payload that omitted it must
 *  not read as `false` (the pane-scraper always knows), and there is no
 *  `preview` — nothing here was OCR'd off a rendered pane. */
export interface HookAskQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}

/** `~/.cc-sessions/<id>.hookstate.json`'s `ask` field: either an
 *  AskUserQuestion envelope (one or more questions awaiting an answer) or a
 *  PermissionRequest envelope (one tool call awaiting Allow/Deny) — never
 *  both, since `session-hook.sh` writes exactly one shape per waiting state. */
export type HookAsk =
  | { questions: HookAskQuestion[] }
  | { approval: { tool: string; summary: string } };

export type SessionStreamMsg =
  /** `missing: true` → no transcript file at `file`; the UI shows a diagnostic
   *  banner. D4 (§5.2) adds the two facts that banner cannot be honest without,
   *  both OPTIONAL so an older PWA build ignores them and an older server that
   *  never sends them is not a protocol violation:
   *    - `foreignAccount`: the account a rung-6 answer was found under — the
   *      "stranded history, held by `claude`" banner. Null for every
   *      own-account answer, which is all of them until a pre-fix swap's
   *      residue is the only copy left.
   *    - `searchComplete`: false when a `readdir` answered null, so rungs 5/6
   *      never ran. `missing: true` with `searchComplete: false` is "can't read
   *      the fleet host right now" — NEVER "no messages yet". Remote `readdir`
   *      returns null for a missing directory, a forbidden path and a
   *      disconnected agent alike, and this build refuses to render that
   *      ambiguity as a confident empty chat. */
  | { type: 'backlog'; uuid: string; events: ChatEvent[]; offset: number; file: string; missing: boolean;
      foreignAccount?: string | null; searchComplete?: boolean }
  | { type: 'events'; uuid: string; events: ChatEvent[]; offset: number }
  | { type: 'status'; status: SessionStatus; statusUpdatedAt: number | null }
  | { type: 'dialog'; dialog: Dialog }            // a pane menu is awaiting an answer
  | { type: 'dialog_cleared' }
  /** The hook-sourced envelope: `~/.cc-sessions/<id>.hookstate.json`'s `ask`,
   *  reported by `session-hook.sh` rather than scraped off the pane. It
   *  streams BESIDE `dialog` above, never in place of it — the two are read
   *  by independent clocks (a pane capture vs. a hook write) and can
   *  legitimately disagree mid-transition, so the server never guesses which
   *  one is right and sends both exactly as read. The CLIENT is where the
   *  preference lives: it prefers this envelope over the scraped `dialog`
   *  when both are present. */
  | { type: 'ask'; ask: HookAsk; key: string | null }   // key: answerable via POST /api/sessions/:id/ask; null for approval envelopes
  | { type: 'ask_cleared' }                       // the hook's ask went null, stale, or its hookstate file is gone
  | { type: 'tasks'; tasks: TaskItem[] }          // the session's task list changed (or first read)
  /** This session's own OUTSTANDING mail — `state` restricted server-side to
   *  `queued` or `delivered`, never `acked`/`rejected` (`sessionws.ts`'s
   *  `checkMail`). Read directly off `CoordStore.outstandingMailFor` in-process,
   *  the same way `tasks` reads `readTasks` — NOT a client of the
   *  box-token-gated `GET /api/mail?to=` (`coord/routes.ts`'s
   *  `requireMailToken`): that route authenticates the anonymous box->server
   *  ingress and a browser has no business holding that secret. Replaced
   *  wholesale, like `tasks`, because it is a statement about the present. */
  | { type: 'mail'; mail: MailSummary[] }
  | { type: 'rotated'; uuid: string }             // transcript switched (clear/compact/swap) — client refetches
  | { type: 'notice'; message: string };

/** PWA → server, on the per-session socket. `visible` is the operator's own
 *  report that this session is on screen and focused; the server suppresses
 *  pushes for it while any client says so — for as long as the claim stays
 *  fresh (see the two constants below). */
export type SessionClientMsg = { type: 'visible'; visible: boolean };

/**
 * The presence heartbeat, defined ONCE for both halves because they are one
 * mechanism: the client re-states "this session is on screen" every
 * `PRESENCE_REFRESH_MS`, and the server stops believing a claim it has not
 * heard for `PRESENCE_TTL_MS`.
 *
 * A close frame is not guaranteed. A phone that loses signal in a lift or a
 * tunnel sends no FIN, the socket's 'close' never fires, and a claim held for
 * the socket's lifetime would suppress every notification for that session
 * until the OS gave up retransmitting — which, on a stream with nothing to
 * send, is never. So the claim expires instead, and expiry means NOTIFY: a
 * notification for a session someone is looking at is noise, but a suppressed
 * one for a viewer who is gone is a question nobody ever sees.
 *
 * Three refreshes of slack, the same 15 s / 2-miss shape `remote/client.ts`
 * already runs its agent heartbeat on. Two devices, one screen-lock and one
 * backgrounded tab all resolve to the same rule: keep saying it, or stop
 * counting.
 */
export const PRESENCE_REFRESH_MS = 15_000;
export const PRESENCE_TTL_MS = 45_000;

/** Wire protocol generation of the PWA↔server pair. Bump on a breaking
 *  wire change. FLEET_PROTO_MIN is the kill-switch: raise it above an
 *  old build's FLEET_PROTO to block that client. Dormant until then —
 *  both stay 1 and the invariant MIN <= PROTO is test-pinned. */
export const FLEET_PROTO = 1;
export const FLEET_PROTO_MIN = 1;

/** One notification the server DECIDED to raise: recorded after the presence
 *  gate ("nothing fires for a session the operator is looking at"), before any
 *  delivery is attempted, and never revised by what delivery did.
 *
 *  NOT a delivery receipt, and the difference is the point. `pushOne` records
 *  unconditionally: `deps.push` is undefined whenever VAPID is unconfigured —
 *  the gate that used to suppress recording in that case was removed
 *  deliberately, because a catch-up log is exactly what a box with no push keys
 *  needs — and even with push wired, `notify()` can fail or find no
 *  subscriptions. A catch-up client must therefore read this as "what you would
 *  have been told about while you were away", never as "what reached a device". */
export interface NotifyEvent {
  seq: number; at: number;
  /** `mail` and `run` are Build 7's. `unknown` is the CLIENT-SIDE degradation
   *  member and the server never records it: it is what a kind from a newer
   *  server becomes on an older client, via `reviveNotifyEvent`. Without it
   *  this union was closed and unvalidated — a bare `getJson<CatchUp>`
   *  (`pwa/src/lib/api.ts`) hands a browser's JSON straight to a renderer that
   *  switches on three members, so a fourth arrived typed as one of the three
   *  it is not. */
  kind: 'ask' | 'done' | 'merged' | 'mail' | 'run' | 'unknown';
  sessionId: string; title: string; body: string;
}

/** `resync: true` means "I cannot prove you saw everything" — the epoch moved,
 *  or the client's seq predates what is still retained. The client's answer is
 *  to drop its watermark and trust the fleet snapshot, never to fabricate
 *  badges for events it cannot enumerate. */
export interface CatchUp { epoch: string; seq: number; resync: boolean; events: NotifyEvent[] }

/** The recognised `NotifyEvent.kind` tokens. Kept private; the door in is
 *  `isNotifyKind` below, the same split `PR_PHASES`/`isPrPhase` use and for
 *  the identical reason (that function's own docstring has the argument). */
const NOTIFY_KINDS: readonly NotifyEvent['kind'][] = ['ask', 'done', 'merged', 'mail', 'run', 'unknown'];

/**
 * Use THIS, never `NOTIFY_KINDS.includes(x as NotifyEvent['kind'])` — the
 * same reason `isPrPhase`/`isRunState` give: the array's element type would
 * force a caller to assert the very thing it is asking. Exported, unlike
 * `NOTIFY_KINDS` itself, because `reviveNotifyEvent` below is no longer the
 * only caller: `CoordStore.feedEvents` (`server/src/coord/store.ts`) reads
 * `feed_events.kind` through this too (review finding 2, `coord/schema.ts`).
 * That table's kind column was cast straight into `NotifyEvent['kind']` on
 * an exemption whose own justification — "written only from a value this
 * server itself already typed" — is the identical same-build-wrote-it
 * assumption `user_version` and this file's own rollback paragraph (above,
 * `:567-571`) exist to refuse: a rollback to an older server against a
 * newer store, or a later build that adds a seventh `NotifyEvent.kind`, both
 * put a token in that column this server never wrote and does not
 * recognise. Every sibling vocabulary in this file (`isRunState`,
 * `isWorkItemState`, `isProgramState`, `isMailDeliveryState`, `isPrReason`)
 * already has a predicate; `NotifyEvent.kind` was the one left out.
 */
export function isNotifyKind(v: unknown): v is NotifyEvent['kind'] {
  return typeof v === 'string' && (NOTIFY_KINDS as readonly string[]).includes(v);
}

/**
 * One catch-up event, revived into today's shape — the same discipline
 * `reviveFleetSession` states once at :838-931 and for the same reason:
 *  - a token from a newer build, where the type has a designated "we do not
 *    know" member, becomes that member;
 *  - a field of the wrong type, or a missing non-nullable one, REJECTS the
 *    whole event (null), because a half-revived notification is a badge for
 *    something that may not have happened.
 *
 * Rejection here collapses to `null` and the caller DROPS the event, which is
 * the same answer the feed already gives for a resync (`notifymark.ts`'s
 * `applyCatchUp`): nothing surfaced retroactively, ever, on doubt.
 */
export function reviveNotifyEvent(raw: unknown): NotifyEvent | null {
  try {
    const o = asObj(raw, 'notifyEvent');
    const kindRaw = reqStr(o, 'kind');
    // A kind this build does not recognise is exactly what a newer server's
    // frame looks like on an older client — degrade to `unknown`, the
    // client-side member this union carries for exactly this purpose, never
    // reject the whole event over it. Through `isNotifyKind`, never a cast.
    const kind = isNotifyKind(kindRaw) ? kindRaw : 'unknown';
    return {
      seq: reqNum(o, 'seq'),
      at: reqNum(o, 'at'),
      kind,
      sessionId: reqStr(o, 'sessionId'),
      title: reqStr(o, 'title'),
      body: reqStr(o, 'body'),
    };
  } catch (err) {
    if (err instanceof MalformedSnapshot) return null;
    throw err;   // a real bug in here must not read as a corrupt snapshot
  }
}

// ── Build 7: coordination ────────────────────────────────────────────────────
// The nouns, once, in the one module all four source roots import.
// `TaskItem`/`TaskProgress`/`tasks` above are Claude Code's TodoWrite plan
// items and have NOTHING to do with programs; the unit here is a WorkItem, its
// table is `work_items`, and the wire tally is `items` — never `tasks`.
// `single-definition.test.ts` holds that line, because a comment is a request
// and a red suite is a mechanism.

/** One wave of a program in one workspace: dispatch -> work -> PRs -> handoff
 *  commit -> close.
 *
 *  `'unknown'` is the designated we-do-not-know member (spec:77) and is NEVER
 *  WRITTEN: it is what a row from a newer build reads as, exactly the way
 *  `PrPhase`'s `'unchecked'` degrades (`server/src/registry.ts:133-140`). A
 *  state this build does not know must never reach a `switch` as a raw string
 *  and render as nothing. */
export type RunState =
  | 'planned' | 'dispatched' | 'working' | 'awaiting-review'
  | 'merging' | 'closing' | 'done' | 'failed' | 'unknown';

/** The runtime list. Exported (the plan's own task-3 "Produces (shared)" list
 *  names it, even though the plan's illustrative code block left it as a
 *  module-private `const` — `CoordStore`'s tests and, later, PR J's renderer
 *  both need to walk the full state space, and a second, module-private copy
 *  is exactly the drift this file's other enums (`PR_REASONS`, `PR_PHASES`)
 *  exist to prevent). */
export const RUN_STATES: readonly RunState[] = [
  'planned', 'dispatched', 'working', 'awaiting-review',
  'merging', 'closing', 'done', 'failed', 'unknown',
];

/** Use THIS, never `RUN_STATES.includes(x as RunState)` — the same rule, for
 *  the same reason, as `isPrPhase` (see its docstring: the array's element type
 *  forces a caller to assert the very thing it is asking). */
export function isRunState(v: unknown): v is RunState {
  return typeof v === 'string' && (RUN_STATES as readonly string[]).includes(v);
}

/**
 * The machine. A transition absent from this table is REFUSED, and the refusal
 * is an answer the caller reads — never a silent no-op, and never an
 * unconditional write.
 *
 * `working` is reachable from `awaiting-review` and `merging` on purpose: a
 * review that sends work back, or a merge that loses a race, is the ordinary
 * case and not a failure. `failed` is reachable from everything that is not
 * already terminal. `unknown` is not in the table at all — nothing transitions
 * to or from a state this build cannot name.
 *
 * `dispatched` and `working` both reach `closing` directly (deviation, found
 * in Task 3 review — see the plan's D-9); `merging` always has (a merge
 * succeeding closes it). Corrected (scoped-verify R3; D-9's own text no
 * longer describes this tree): D-9 also said "PR I never writes
 * `awaiting-review` or `merging`... `POST /api/runs/:id/advance` [is] PR J's
 * [route]" — true when D-9 was written, false since `/advance` landed in
 * this SAME PR (`coord/routes.ts`'s own docstring on that route records the
 * same correction). `awaiting-review` is therefore genuinely reachable by
 * ordinary flow now (`dispatch` -> `working` -> `/advance` ->
 * `awaiting-review`), and gains the identical direct `closing` edge
 * `working`/`merging` already carry: an operator abandon must be reachable
 * from every DISPATCHED, live, non-terminal state in ONE `POST .../close`
 * call, the same guarantee `working` and `merging` already give, not a
 * two-call `/advance` back to `working` first — nothing about "a review that
 * sends work back is the ordinary case, not a failure" (the paragraph above)
 * argues against closing being reachable too; that paragraph is about REVIEW
 * OUTCOMES, an orthogonal axis to an administrative abandon. `/advance`
 * itself still refuses to reach `closing` (`ADVANCE_TARGETS` in
 * `coord/routes.ts` — that stays `POST .../close`'s own job, fleet act and
 * all); only `RUN_TRANSITIONS` gates it here.
 *
 * `planned` is DELIBERATELY excluded from that "every live, non-terminal
 * state" guarantee (narrowed, scoped-verify H4 — the prior wording read
 * "every live, non-terminal state" with no carve-out, which is false of this
 * state): a `planned` run has never been dispatched, so there is no worker
 * session for the fleet act to release under the ORDINARY meaning of that
 * word, and the close route's own first precondition already refuses one
 * with no `sessionId` at all as `not-dispatched` before it ever reaches this
 * table. The one live sub-case — `sessionId` set at OPEN time by a wave N>=2
 * reclaim (`CoordStore.setSession`, D-45), but the run itself never actually
 * dispatched — the close route's own precondition names BY HAND
 * (`coord/routes.ts`, "still `planned` (sessionId set at OPEN time for a
 * wave N>=2 reclaim, but never actually dispatched) — must never reach the
 * fleet act at all") and 409s `bad-transition` rather than closing: the
 * plan's own D-48 adaptation lists this exact interleaving as one the
 * precondition exists to catch, not a gap it left open by accident. Closing
 * that gap — giving `planned` a `closing` edge so a reclaimed-but-never-
 * dispatched hold can be released through this route too — is a real,
 * separate improvement nothing in this build's spec asks for; left alone
 * here rather than folded into an unrelated correction pass.
 */
export const RUN_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = Object.freeze({
  planned:           ['dispatched', 'failed'],
  dispatched:        ['working', 'closing', 'failed'],
  working:           ['awaiting-review', 'closing', 'failed'],
  'awaiting-review': ['merging', 'working', 'closing', 'failed'],
  merging:           ['closing', 'working', 'failed'],
  closing:           ['done', 'failed'],
  done:              [],
  failed:            [],
  unknown:           [],
});

/** A unit inside a run. `'unknown'` is the we-do-not-know member, as above. */
export type WorkItemState = 'pending' | 'claimed' | 'done' | 'failed' | 'abandoned' | 'unknown';
const WORK_ITEM_STATES: readonly WorkItemState[] =
  ['pending', 'claimed', 'done', 'failed', 'abandoned', 'unknown'];
export function isWorkItemState(v: unknown): v is WorkItemState {
  return typeof v === 'string' && (WORK_ITEM_STATES as readonly string[]).includes(v);
}

/** A program's own lifecycle (`programs.state`) — `docs/superpowers/programs/
 *  <slug>.md`'s machine-readable shadow. Deviation D-8: `schema.ts`'s header
 *  comment originally claimed blanket we-do-not-know coverage for every v1
 *  enum column, and this was one of the two it did not actually give one to.
 *  Closed here, on the READ side, rather than reproduced on the wire —
 *  `CoordStore.programs()` reads through `isProgramState`, never a cast. */
export type ProgramState = 'active' | 'paused' | 'done' | 'abandoned' | 'unknown';
const PROGRAM_STATES: readonly ProgramState[] = ['active', 'paused', 'done', 'abandoned', 'unknown'];
export function isProgramState(v: unknown): v is ProgramState {
  return typeof v === 'string' && (PROGRAM_STATES as readonly string[]).includes(v);
}

/** An agent-to-agent message. `artifact` carries PATHS, NEVER PAYLOADS
 *  (spec:52-53). `'unknown'` is the read-side degradation member and is never
 *  accepted at ingress — `bad-kind` is what an unrecognised kind gets there. */
export type MailKind = 'finding' | 'question' | 'answer' | 'status' | 'artifact' | 'unknown';
export const MAIL_KINDS: readonly MailKind[] =
  ['finding', 'question', 'answer', 'status', 'artifact', 'unknown'];
export function isMailKind(v: unknown): v is MailKind {
  return typeof v === 'string' && (MAIL_KINDS as readonly string[]).includes(v);
}
/** The kinds an INGRESS may name. `unknown` is deliberately excluded: a sender
 *  cannot ask for the we-do-not-know bucket. */
export function isSendableMailKind(v: unknown): v is Exclude<MailKind, 'unknown'> {
  return isMailKind(v) && v !== 'unknown';
}

/** `mail_deliveries.state` — the other of D-8's two exempt columns. The wire
 *  type it feeds (`MailSummary.state` below) gets the same guard/`'unknown'`-
 *  member shape `RunState`/`WorkItemState`/`ProgramState` already have, rather
 *  than the closed four-member union the plan's own draft carried. */
export type MailDeliveryState = 'queued' | 'delivered' | 'acked' | 'rejected' | 'unknown';
const MAIL_DELIVERY_STATES: readonly MailDeliveryState[] =
  ['queued', 'delivered', 'acked', 'rejected', 'unknown'];
export function isMailDeliveryState(v: unknown): v is MailDeliveryState {
  return typeof v === 'string' && (MAIL_DELIVERY_STATES as readonly string[]).includes(v);
}

/** ≤8KB, spec:114. Measured in UTF-8 BYTES, not string length — the same
 *  char-vs-byte care `hookstate.ts:128-135` already takes with its own cap. */
export const MAIL_BODY_MAX_BYTES = 8 * 1024;

/** The PRE-DELIVERY attempt budget for one mail delivery — the `6` in
 *  "attempt 3 of 6". L0 because BOTH sides name it now: `watch.ts`'s
 *  `sweepMail` ENFORCES it, and (Task 408) `MailSummary.attempts` puts the
 *  running count on the wire, so a client that wants to show how much room is
 *  left before a park would otherwise carry a second copy of a policy number.
 *  The reasoning for the VALUE — and for everything this counter deliberately
 *  does NOT count — lives beside its enforcement, on `watch.ts`'s import. */
export const MAIL_MAX_ATTEMPTS = 6;

/**
 * The two envelope fields `MAIL_BODY_MAX_BYTES` does NOT bound (fix-round
 * finding 8 / D-44): `subject` renders as one envelope line and `artifacts`
 * renders one line PER ENTRY (`coord/envelope.ts`'s own `renderEnvelope`),
 * and `sendPrompt` costs one agent round trip PER LINE it types
 * (`inject/send.ts:300-305`). A message whose `body` is well under 8KB can
 * still carry tens of thousands of artifact-path lines and stay under
 * Fastify's default 1 MiB request-body ceiling — `coord/envelope.ts`'s own
 * COST paragraph names "a few hundred round trips" as the worst case the
 * body cap prices in; these two caps keep `subject`/`artifacts` inside the
 * same order of magnitude rather than leaving them open to blow past it by
 * two.
 */
export const MAIL_SUBJECT_MAX_BYTES = 200;
export const MAIL_ARTIFACTS_MAX = 64;
export const MAIL_ARTIFACT_PATH_MAX_BYTES = 4096;

/**
 * Peer-mail producer bounds (Build 9b wave 0, spec D10 hole 2) —
 * `runId === null` traffic ONLY; run mail is bounded by its run's own
 * lifecycle and is deliberately untouched (the dark-behavior pin in
 * `server/test/mail-peer-quota.test.ts` holds that door shut). "Bound the
 * producer, never the record": nothing in the tree DELETEs from `mail` or
 * `mail_deliveries`, so the only sustainable cap is at the ingress. Three
 * arms, two codes: same (fromId,toId,subject) outstanding → 409
 * 'duplicate'; PEER_MAIL_MAX_OUTSTANDING outstanding per (fromId,toId)
 * pair, or PEER_MAIL_HOURLY ACCEPTED sends per sender per hour → 429
 * 'peer-quota'. "Outstanding" is `queued`/`delivered` unacked (an ack
 * frees the slot); the hourly arm counts accepted rows regardless of
 * delivery state (an ack does not refund the hour). L0 because both sides
 * name them: the route enforces, and a peer client showing remaining
 * headroom must not carry a second copy of a policy number
 * (`MAIL_MAX_ATTEMPTS`'s own argument).
 */
export const PEER_MAIL_MAX_OUTSTANDING = 3;
export const PEER_MAIL_HOURLY = 12;

/** The info string on the fence `renderEnvelope` emits (`coord/envelope.ts`).
 *  ONE definition, here in L0, imported by the renderer — the grammar is
 *  minted server-side and parsed from the same constant, so the round-trip
 *  test (`server/test/mail-envelope-parse.test.ts`) is a property of the
 *  system rather than of two files agreeing. */
export const MAIL_ENVELOPE_FENCE = 'ccrc-mail';

/** A delivered envelope, read back out of a transcript turn. The same ten
 *  fields `coord/envelope.ts`'s `EnvelopeInput` renders FROM — deliberately,
 *  so `parse(render(x)) === x` is an object comparison and a field one side
 *  silently drops cannot hide. */
export interface MailEnvelope {
  id: number; fromId: string; toId: string;
  runId: number | null; program: string | null; wave: number | null; waveOf: number | null;
  kind: MailKind; subject: string; artifacts: string[]; body: string;
}

/**
 * A TYPED UNION, NEVER A BARE NULL.
 *
 * `not-mail` (this text is an ordinary message) and `malformed` (this text
 * CLAIMS to be an envelope and is not) are two conditions a caller would
 * handle differently, and collapsing them would be the overloaded null
 * `architecture:99-100` bans. Today both render identically — an ordinary
 * bubble — and that is a deliberate choice, pinned by a test asserting
 * `malformed` never renders as a mail card. The seam keeps the distinction
 * the renderer does not yet need.
 *
 * `at` is the 0-based index into the trimmed text's own lines — line 0 is the
 * OPENING FENCE, so the first header line is 1. Counting from the text rather
 * than from the header means the number names a line an operator can find in
 * what they are looking at.
 */
export type MailEnvelopeParse =
  | { ok: true; envelope: MailEnvelope }
  | { ok: false; why: 'not-mail' }
  | { ok: false; why: 'malformed'; at: number };

/**
 * Parse a delivered envelope back out of a transcript turn.
 *
 * IT ASSERTS NOTHING ABOUT AUTHENTICITY. The transcript is a rank-3 source
 * and a session can type a fake envelope into itself; the authoritative mail
 * rows come from the database (`{type:'mail'}`, `GET /api/feed`). Consequence
 * of a forgery: one bubble looks like mail. Named, accepted.
 *
 * It walks the header in `renderEnvelope`'s own order and refuses at the FIRST
 * line that does not fit. Two structural rules are worth stating because they
 * are what keep a forged or half-typed turn out of the card:
 *
 * - The fence must be the WHOLE text (after trimming): opening fence on line
 *   0, the identical run of backticks on the last line, nothing outside. Prose
 *   above or below is `not-mail`, not a mail card with commentary attached.
 * - Everything after the `--` terminator is body, VERBATIM, including lines
 *   that look like headers. The header walk stops at the `--` that closes the
 *   `ack:` block, so a body containing its own `--` is not a second parse.
 *
 * Known, named limitation: an artifact path with LEADING whitespace does not
 * round-trip (the renderer indents each path by two spaces and this reads that
 * indent off again). Ingress caps paths but does not forbid such a path; the
 * cost is one card rendering a path short by its own leading spaces, which is
 * strictly less than refusing the whole envelope over it.
 */
export function parseMailEnvelope(text: string): MailEnvelopeParse {
  const trimmed = text.trim();
  // A cheap refusal BEFORE any splitting. `buildChatItems` calls this for
  // every user turn in a backlog that can run to thousands of events, and the
  // overwhelming majority are ordinary messages; splitting each one into lines
  // to discover that is work proportional to the whole transcript on every
  // rebuild. This rejects strictly less than the opener regex below — that
  // regex requires three backticks at the start of line 0, which is the start
  // of the trimmed text — so it changes no answer, only when the answer costs
  // an allocation.
  if (!trimmed.startsWith('```')) return { ok: false, why: 'not-mail' };
  const lines = trimmed.split('\n');
  const opener = /^(`{3,})(.*)$/.exec(lines[0] ?? '');
  if (!opener || opener[2] !== MAIL_ENVELOPE_FENCE) return { ok: false, why: 'not-mail' };
  const fence = opener[1];
  // The closing fence is EXACTLY the opener — that is what `fenceFor` emits.
  // A shorter one does not close the block at all (Markdown's own rule) and a
  // longer one is not this renderer's output; either way the text is not an
  // envelope this parser is looking at.
  const end = lines.length - 1;
  if (end < 1 || lines[end] !== fence) return { ok: false, why: 'not-mail' };

  const malformed = (at: number): MailEnvelopeParse => ({ ok: false, why: 'malformed', at });
  let i = 1;
  /** The current header line, or `null` once the walk has run into the closing
   *  fence — which is itself a refusal, at the fence's own index. */
  const cur = (): string | null => (i < end ? (lines[i] as string) : null);

  const idLine = /^id: (\d+)$/.exec(cur() ?? '');
  if (!idLine) return malformed(i);
  const id = Number(idLine[1]);
  i += 1;

  const fromLine = /^from: (.+)$/.exec(cur() ?? '');
  if (!fromLine) return malformed(i);
  const fromId = fromLine[1] as string;
  i += 1;

  const toLine = /^to: (.+)$/.exec(cur() ?? '');
  if (!toLine) return malformed(i);
  const toId = toLine[1] as string;
  i += 1;

  // `run:` and its parenthetical are INDEPENDENTLY optional, mirroring
  // `renderEnvelope`'s own three conditionals: no line at all when there is no
  // run; `run: N` when the program is unknown; `run: N (program:S)` with the
  // wave suffix only when there is a wave, and `/M` only when the total is
  // known. A line that STARTS `run:` and does not fit is malformed rather than
  // skipped — silently reading it as the `kind:` line would put a card on
  // screen naming the wrong run.
  let runId: number | null = null;
  let program: string | null = null;
  let wave: number | null = null;
  let waveOf: number | null = null;
  if ((cur() ?? '').startsWith('run:')) {
    const runLine = /^run: (\d+)(?: \((.+)\))?$/.exec(cur() as string);
    if (!runLine) return malformed(i);
    runId = Number(runLine[1]);
    if (runLine[2] !== undefined) {
      const inner = /^program:(.+?)(?: wave (\d+)(?:\/(\d+))?)?$/.exec(runLine[2]);
      if (!inner) return malformed(i);
      program = inner[1] as string;
      wave = inner[2] === undefined ? null : Number(inner[2]);
      waveOf = inner[3] === undefined ? null : Number(inner[3]);
    }
    i += 1;
  }

  const kindLine = /^kind: (.+)$/.exec(cur() ?? '');
  if (!kindLine || !isMailKind(kindLine[1])) return malformed(i);
  const kind = kindLine[1];
  i += 1;

  // `(.*)`, not `(.+)`: an EMPTY subject is a legal envelope. The renderer
  // emits `subject: ` for it and refusing that would make a card impossible
  // for a message whose subject a sender simply left blank.
  const subjectLine = /^subject: (.*)$/.exec(cur() ?? '');
  if (!subjectLine) return malformed(i);
  const subject = subjectLine[1] as string;
  i += 1;

  // The `artifacts:` marker is valid ONLY when at least one indented path
  // follows it — the renderer never emits a bare marker. The refusal is
  // reported AT THE MARKER, which is the line that made the promise the text
  // does not keep.
  const artifacts: string[] = [];
  if (cur() === 'artifacts:') {
    const marker = i;
    i += 1;
    while (cur() !== null && (cur() as string).startsWith('  ')) {
      artifacts.push((cur() as string).slice(2));
      i += 1;
    }
    if (artifacts.length === 0) return malformed(marker);
  }

  // The ack block: one `ack:` line plus its indented continuation, then the
  // `--` terminator. The wording is NOT asserted here — that is
  // `coord-envelope.test.ts`'s job, and pinning the copy in two places is how
  // an edit to the instruction would start refusing real mail.
  if (!(cur() ?? '').startsWith('ack: ')) return malformed(i);
  i += 1;
  while (cur() !== null && (cur() as string).startsWith('  ')) i += 1;
  if (cur() !== '--') return malformed(i);
  i += 1;

  return {
    ok: true,
    envelope: {
      id, fromId, toId, runId, program, wave, waveOf, kind, subject, artifacts,
      body: lines.slice(i, end).join('\n'),
    },
  };
}

/**
 * The same envelope, as a FETCH returns it — the live lane (W-1 / D-296 (was D-B4-23)).
 *
 * WHY THIS EXISTS: spec §2.1's fact 2 measured a lane that typed the whole
 * envelope into the recipient's pane, where it landed in the JSONL as a `user`
 * turn. Commit 43b2737 — shipped mid-program, before this wave's own base —
 * replaced that with the one-line reference nudge, so an envelope now reaches
 * a transcript ONLY as the output of the worker's own `GET /api/mail/:id`,
 * which the transcript parser maps to `tool_result`. `parseMailEnvelope`
 * above is unchanged and stays the LEGACY user-turn parser; this is a
 * separate, wider door for the live one.
 *
 * TWO SHAPES, both measured in real transcripts on the fleet box:
 *   - the RAW FENCE — a fetch that piped the response through and printed the
 *     `envelope` field, so the output IS the envelope text;
 *   - the JSON RESPONSE `GET /api/mail/:id` actually sends,
 *     `{ok, id, toId, state, envelope}` (`coord/routes.ts`), which is what a
 *     bare curl leaves in the transcript.
 *
 * IT ASSERTS NOTHING ABOUT AUTHENTICITY, and the aperture here is WIDER than
 * the user-turn door, so the caveat is worth restating rather than inheriting:
 * a `tool_result` is command output. `cat`-ing a file whose whole content is a
 * fenced envelope renders a card, as does any command whose entire output is
 * one. That is the same rank-3 transcript this repo already refuses to treat
 * as authority — authoritative mail rows come from the database
 * (`{type:'mail'}`, `GET /api/feed`) — and the consequence is unchanged: one
 * bubble looks like mail. Named, accepted. Do NOT write, here or at any call
 * site, that a `tool_result` card is authenticated.
 *
 * `malformed` survives BOTH doors. Text that claims to be an envelope and is
 * not keeps saying so whether it arrived raw or wrapped, so the seam the
 * architecture doc's overloaded-null ban protects is not quietly lost on the
 * way in.
 */
export function parseFetchedMailEnvelope(text: string): MailEnvelopeParse {
  const direct = parseMailEnvelope(text);
  // `malformed` is returned as-is, never retried as JSON: it already means
  // "this text claims to be an envelope", which is an answer, not a miss.
  if (direct.ok || direct.why === 'malformed') return direct;

  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return direct;
  let body: unknown;
  try {
    body = JSON.parse(trimmed);
  } catch {
    return direct;
  }
  // Arrays and null are objects to `typeof`; only a plain object carries the
  // route's `envelope` field, and only a string one is an envelope.
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return direct;
  const envelope = (body as { envelope?: unknown }).envelope;
  if (typeof envelope !== 'string') return direct;
  return parseMailEnvelope(envelope);
}

/**
 * The declared ledger's two caps (Build 4, spec §3.1). BYTES for the title,
 * for `MAIL_SUBJECT_MAX_BYTES`'s own reason one block up: a title is one line
 * an operator reads on a phone-width board, and a character count is not what
 * bounds the width of an emoji- or CJK-bearing one. The same cap value, too —
 * a work-item title and a mail subject are the same KIND of thing (one line
 * naming one unit of work), and two different numbers for that would be a
 * distinction nothing downstream makes.
 *
 * 32 items, because a wave with more than 32 declared items is a wave that
 * should have been two — the ledger is fixed at dispatch (spec §3.1's last
 * paragraph: no route adds an item to a dispatched run), so the cap is also
 * the honest statement of how much work one wave brief can carry.
 */
export const WORK_ITEM_TITLE_MAX = 200;
export const WORK_ITEM_MAX = 32;

/**
 * Every way the coordination layer can say no, enumerated in one place.
 * PINNED IN BOTH DIRECTIONS by `mail-routes.test.ts`, WITH ONE NAMED
 * EXCEPTION (D-38): `undeliverable` is emitted by `watch.ts`'s mail-sweep
 * lane (Task 8), and `watch.ts` sits entirely outside `server/src/coord` —
 * the forward-direction scan (`mail-routes.test.ts`'s "every declared
 * INGRESS/DONE-AUTHORITY code is emitted somewhere in server/src/coord"
 * test) is scoped to that one directory and excludes `undeliverable` BY
 * NAME, with its own comment saying so, not by an oversight this docstring
 * used to paper over. Every OTHER code here is emitted somewhere in
 * `server/src/coord`, and every code emitted there is here. Orca's rule,
 * adopted: a stale `worker_done` can never settle a run, because the
 * refusal is typed and the run state is unchanged.
 *
 * Groups, and they are not interchangeable:
 *  - INGRESS (spec:145-147): the message never becomes a `mail` row.
 *  - DELIVERY: the mail row is intact; only this delivery is parked.
 *  - DONE-AUTHORITY (spec:127-132): the claim is rejected, the run is unchanged.
 *
 * `tip-unmeasurable`/`pr-unmeasurable` exist because NOT KNOWING IS NOT `[]` —
 * ccd's own three-answer ladder (`ccd/ccd:1957-1963`). A fact the server could
 * not re-measure must never read as a fact that matched. `registry-unmeasurable`
 * (D-37) is the INGRESS member of the same family: a `readRegistry` that could
 * not list its directory, or that dropped a listed row for an unreadable
 * sibling field, is not evidence the sender or recipient does not exist — see
 * `coord/routes.ts`'s checks 5/6/7 for where this is measured.
 *
 * `branch-unmeasurable` is the third member of that family and it answers a
 * question one rung earlier: not "what is this branch's tip" but "which
 * branch". A registry row that is present and whose own `.branch` reads null
 * has DECLINED to name one, and the run row's frozen `branch` column is not
 * an answer — `markDispatched` writes it once and nothing updates it, so
 * after a rename it names a ref `git branch -m` deleted.
 */
export const MAIL_REJECT_CODES = [
  // ingress
  'unauthenticated', 'unknown-sender', 'stale-uuid', 'registry-unmeasurable',
  'unknown-recipient', 'unknown-run', 'oversize', 'bad-kind',
  // ingress — peer-mail bounds (Build 9b wave 0, D10): `runId === null`
  // traffic only; run mail is deliberately untouched and pinned dark
  // (server/test/mail-peer-quota.test.ts). 'duplicate' is one word and so
  // invisible to mail-routes.test.ts's kebab-token scan BY CONSTRUCTION
  // (it matches only hyphenated tokens — same standing note that union's
  // docstring already makes for 'paused'); the both-directions membership
  // scan still covers it.
  'duplicate', 'peer-quota',
  // delivery
  'undeliverable',
  // done-authority
  'stale-tip', 'tip-unmeasurable', 'branch-unmeasurable', 'pr-regressed', 'pr-unmeasurable',
  'no-handoff-commit',
] as const;
export type MailRejectCode = (typeof MAIL_REJECT_CODES)[number];

/**
 * Every TYPED run-refusal code declared for `POST /api/runs`,
 * `POST /api/runs/:id/dispatch`, `POST /api/runs/:id/close` and
 * `POST /api/runs/:id/advance` (`server/src/coord/routes.ts`) THAT IS NOT
 * ALREADY A `MailRejectCode` — the done-authority re-measurement codes
 * (`stale-tip`/`tip-unmeasurable`/`pr-regressed`/`pr-unmeasurable`/
 * `no-handoff-commit`) and `unknown-run`/`oversize` are shared verbatim with
 * the mail routes (`verifyDone` backs both `POST .../close` and
 * `POST .../advance`, and both re-use `MailRejectCode` for it) and are
 * DELIBERATELY not repeated here — a run refusal is either a member of this
 * union or of `MAIL_REJECT_CODES`, never both, so the two are checked
 * TOGETHER by the scanner below rather than merged into one list.
 *
 * NOT the complete set of ways those four routes can refuse a request: none
 * of `error:'unsupported'` (501, an unsupported ccd verb), `error:'bad-request'`
 * (400, a malformed body) or a bare 502 `{ok:false, stderr}` (a failed fleet
 * act) carries a code from this union, from `MailRejectCode`, or from
 * anywhere else — those are a separate, untyped refusal shape, and a caller
 * that assumes every non-2xx response here carries a `RunRefuseCode` is wrong.
 *
 * `Record<RunRefuseCode, true>` is the `PR_REASON_MAP` idiom (above), but a
 * NARROWER guarantee than that idiom's own docstring claims for itself: it
 * is a compile error HERE for this list to lose a member `RUN_REFUSE_CODE_MAP`
 * still has, or to gain one it does not. It is NOT a compile error — or any
 * error — at a call site that actually SENDS a refusal: no route in
 * `server/src` types its `refused`/`error` field as `RunRefuseCode`, every
 * one sends a bare inline string literal, so a route emitting a code this
 * union has never seen is not caught here. The one runtime check on the
 * PRODUCER side is `mail-routes.test.ts`'s kebab-token scanner, and it
 * cannot see a single-word code by construction (it matches only hyphenated
 * tokens) — `paused`, a member of this very union, is invisible to it.
 * Thirteen codes exist below today; the next new one would be the
 * fourteenth, not the ninth.
 *
 * `hookstate-unmeasurable` is `worker-busy`'s twin at the same gate and the
 * distinction between them is the whole of D-115: `worker-busy` asserts a
 * MEASUREMENT — the session's hookstate was read and says it is mid-turn —
 * while this one asserts that no measurement happened at all, because the
 * file could not be read (`hookstate.ts`'s `HookStateRead`). They are
 * separate codes rather than one because the recovery differs: a coordinator
 * waits out a `worker-busy` and the turn ends on its own, but waiting out an
 * unreadable registry file changes nothing on the fleet. Emphatically NOT
 * `registry-unmeasurable`, whose own recovery rule ("never a blind retry — it
 * can ORPHAN a workspace `ccd ws-add` already spawned", `coordinator-skill/
 * references/wave-lifecycle.md` §2) is about a refusal that lands AFTER a
 * spawn; this one lands after a RESUME, with nothing minted and nothing to
 * strand.
 *
 * The last two are the ledger's (Build 4, spec §3.2): `unknown-item` — "an
 * item id that is not THIS RUN's", 404 — and `item-terminal` — the item
 * already settled, 409, refused rather than silently applied.
 */
export type RunRefuseCode =
  | 'claimed-by-another' | 'paused' | 'mail-disabled' | 'cap-concurrency' | 'cap-daily'
  | 'ambiguous-dispatch' | 'worker-busy' | 'hookstate-unmeasurable' | 'not-dispatched'
  | 'prhistory-unreadable' | 'bad-transition' | 'unknown-item' | 'item-terminal';

const RUN_REFUSE_CODE_MAP: Record<RunRefuseCode, true> = {
  'claimed-by-another': true, paused: true, 'mail-disabled': true, 'cap-concurrency': true,
  'cap-daily': true, 'ambiguous-dispatch': true, 'worker-busy': true,
  'hookstate-unmeasurable': true, 'not-dispatched': true,
  'prhistory-unreadable': true, 'bad-transition': true, 'unknown-item': true, 'item-terminal': true,
};
export const RUN_REFUSE_CODES: readonly RunRefuseCode[] = Object.keys(RUN_REFUSE_CODE_MAP) as RunRefuseCode[];

/**
 * WHAT REFUSED A DELIVERY, when the refusal was ordinary.
 *
 * D-792. `sweepMail`'s ladder has ten refusal paths and two of them record
 * anything. The silence is correct as a SCHEDULING decision — those gates are
 * expected to hold indefinitely for a session that is merely busy, and
 * charging them toward `MAIL_MAX_ATTEMPTS` would park the mail of every busy
 * worker. But "must not park" was implemented as "must not be written down",
 * and those are two different requirements: a delivery sat `delivered` with
 * `attempts: 0` for ELEVEN HOURS, re-selected and refused on every
 * `MAIL_SWEEP_MS` tick — on the order of 4,000 times — while `GET /api/peers`
 * called the session `deliverable: 'yes'`, the run showed a tidy
 * `unreadMail: 1`, and nothing anywhere named the gate.
 *
 * ONE MEMBER PER CONDITION, not per `continue`. `if (!pid || !cfgDir)` folds
 * two an operator acts on completely differently — the pane is gone, versus
 * this wrapper resolves to no config dir, which is a ROSTER problem — so they
 * are `no-pane` and `no-config-dir` here and the ladder splits to match.
 *
 * NOT A SCHEDULING INPUT. Nothing reads this to decide whether, when or how
 * often to deliver; it is written after the decision has already been made and
 * exists so a human can tell "waiting" from "wedged".
 */
export type MailGate =
  | 'same-sweep' | 'in-flight' | 'cooldown'
  | 'registry-absent' | 'registry-unmeasurable'
  | 'tmux-gone' | 'tmux-unknown'
  | 'pending-ask' | 'no-pane' | 'no-config-dir'
  | 'not-idle' | 'not-quiet';

/** Total, so a refusal path added to `sweepMail` without a member here is a
 *  TS2739 rather than a silent hole — the `RUN_REFUSE_CODE_MAP` shape, and the
 *  reason `single-definition.test.ts` forbids a second hand-written copy. */
const MAIL_GATE_MAP: Record<MailGate, true> = {
  'same-sweep': true, 'in-flight': true, cooldown: true,
  'registry-absent': true, 'registry-unmeasurable': true,
  'tmux-gone': true, 'tmux-unknown': true,
  'pending-ask': true, 'no-pane': true, 'no-config-dir': true,
  'not-idle': true, 'not-quiet': true,
};
export const MAIL_GATES: readonly MailGate[] = Object.keys(MAIL_GATE_MAP) as MailGate[];

export function isMailGate(v: unknown): v is MailGate {
  return typeof v === 'string' && (MAIL_GATES as readonly string[]).includes(v);
}

/** The validator that goes with the list — `isPrReason`'s own shape and the
 *  same reason: `unknown` in, so nothing is smuggled past by claiming it is
 *  already a code, and the CONSTANT is cast rather than the input. */
export function isRunRefuseCode(v: unknown): v is RunRefuseCode {
  return typeof v === 'string' && (RUN_REFUSE_CODES as readonly string[]).includes(v);
}

/**
 * Build 9's synchronous coordination refusals — the peers/claims/ledger routes'
 * own vocabulary (`coord/routes.ts`), a FIFTH union through
 * `mail-routes.test.ts`'s kebab scanner, checked together with the other four
 * and never merged: a claim refusal is not a mail rejection (nothing is
 * recorded or replayed — the 4xx lands in the live caller's hand,
 * synchronously, which is D10's whole bargain), not a run refusal, and not a
 * gap reason. Admitted through this exported guard rather than the scanner's
 * `NOT_CODES` allowlist, for the reason the `LifecycleGapReason` entry there
 * states: a guard accepts a member added later and still rejects a typo'd one.
 *
 *   unknown-session — GET /api/peers?of= names no registry row. Absence is
 *                     measured against the directory LISTING; an unlistable
 *                     registry is `registry-unmeasurable`, never this (D-37)
 *   claim-conflict  — POST /api/claims lost the race; the 409 names EVERY
 *                     conflicting path and hands each holder's address (D12)
 *   bad-path        — a claim on '.' or '' or a path that escapes the repo;
 *                     claiming the whole repo IS the module wedge
 *   unknown-claim   — release/break: no such claim id
 *   not-owner       — release: the claim is live and not yours; heldBy names who
 *   claim-terminal  — release/break: the row already ended; state rides along.
 *                     Lapse-don't-delete (D12) is why this arm exists at all
 *   not-seeded      — the allocator refuses before sweepLedgerFloor has scanned
 *                     the project (D13: fail shut, never mint from a guess)
 *
 * Producers land across wave 7 (Tasks 18-20); `claims-envelope.test.ts` pins
 * the producer direction once all seven exist.
 */
export const CLAIM_REFUSE_CODES = [
  'unknown-session', 'claim-conflict', 'bad-path', 'unknown-claim', 'not-owner',
  'claim-terminal', 'not-seeded',
] as const;
export type ClaimRefuseCode = (typeof CLAIM_REFUSE_CODES)[number];
export function isClaimRefuseCode(v: unknown): v is ClaimRefuseCode {
  return typeof v === 'string' && (CLAIM_REFUSE_CODES as readonly string[]).includes(v);
}

/** Work-item counts for one run. `items`, never `tasks` (D-7). */
export interface RunItemTally { done: number; total: number }

/** One run, as `/ws/fleet`'s `runs` frame and `GET /api/runs` carry it.
 *  Deliberately flat and deliberately small: this rides the fleet socket
 *  alongside a full session snapshot on every change. */
export interface RunSummary {
  id: number;
  program: string;              // slug
  programTitle: string;
  wave: number;
  waveOf: number | null;
  project: string;
  sessionId: string | null;
  workspace: string | null;
  branch: string | null;
  state: RunState;
  /** The ONE coordinator that owns this run: the tmux-derived session id of
   *  the session that opened it, fixed at `POST /api/runs` and rewritten by no
   *  route afterwards. That immutability is the mechanism behind the
   *  `claimed-by-another` refusal — a second coordinator, in a fresh
   *  workspace, naming a programme this one already claimed is refused
   *  FOREVER, because nothing lowers this flag; recovering from it means
   *  reaching the original session or opening a new programme, never
   *  reassigning the run.
   *
   *  THE PWA READS IT AS THE PROGRAMME-OWNERSHIP EDGE: this field (the
   *  parent) paired with `sessionId` (the child, the worker this run
   *  dispatched) is what lets the fleet tree nest a worker under the
   *  coordinator that asked for it, instead of scattering both through one
   *  flat list. Server-side it is older than that use — `resolveCoordinator`
   *  reads it to address `toId:'coordinator'` mail — and this field is a
   *  READ of that same column, never a second copy of the decision.
   *
   *  `null` means no owner was recorded — a row from a database written
   *  before the column had a writer, or a hand-inserted recovery row. Absence
   *  permits: a renderer brackets nothing under a `null`, which is the honest
   *  answer, where a fabricated owner would nest a run under a coordinator
   *  that never claimed it. */
  claimedBy: string | null;
  /** Deviation D-1: wave >= 2 resumes its session (no ccd verb can spawn
   *  fresh into an existing workspace) and the dispatch route then injects
   *  /clear through the send path, so the context is fresh even though the
   *  pane was resumed. clearedAt below is the proof the second step ran. */
  resumed: boolean;
  clearedAt: number | null;
  openedAt: number;
  /** When THIS run's FRESH-SPAWN dispatch began — stamped immediately before
   *  the `ws-add` that mints the workspace, which is the one moment a dispatch
   *  is in flight and `sessionId` is still null (the server learns the id by
   *  registry diff, after the call returns, so until then nothing can name the
   *  row).
   *
   *  ABSENT (`null`) MEANS NO FRESH-SPAWN DISPATCH HAS STARTED for this run,
   *  and that is TWO named conditions, not one — never a stand-in for a value
   *  that could not be read:
   *    • nobody has dispatched it at all — the ordinary state of a wave N+1
   *      opened and waiting; and
   *    • every dispatch it has had was a wave N>=2 RESUME (D-1: `ensure` into
   *      the existing workspace), which mints no workspace and stamps nothing.
   *  The scope is deliberate: a resume already knows its `sessionId` before the
   *  call, so the console has a row to point at from the first frame and needs
   *  no stamp to say a dispatch is happening. `state` — not this field — is
   *  what answers "has this run been dispatched", on every path.
   *
   *  NEVER CLEARED. `state` moving to `dispatched` is what stops a renderer
   *  saying "dispatching"; this stays, and `dispatchedAt - dispatchStartedAt`
   *  is then how long the spawn actually took — available for a fresh spawn,
   *  and NOT for a resume, which sets `dispatchedAt` over a null start. A
   *  retry overwrites it with the new attempt's start.
   *
   *  AND IT NAMES THE WEDGE: a run still `planned` carrying a
   *  `dispatchStartedAt` older than `SPAWN_STALL_MS` is a dispatch that never
   *  completed — very likely beside a workspace nothing claimed. That state
   *  previously had no name at all. */
  dispatchStartedAt: number | null;
  dispatchedAt: number | null;
  closedAt: number | null;
  handoffCommit: string | null;
  items: RunItemTally;
  /** Unacked mail addressed to this run's session. */
  unreadMail: number;
}

/** How long a `planned` run may carry a `dispatchStartedAt` before the
 *  console calls the dispatch stalled. Deliberately >= the `ws-add` verb
 *  ceiling (`CCD_VERB_TIMEOUT_MS`, server-side) rather than a copy of it:
 *  that number is a TIMEOUT — what the runner enforces, and the point at
 *  which the call is killed — and this one is a RENDERING threshold, which
 *  must not fire until the timeout has certainly elapsed. Two different
 *  questions, so two different names; neither is derived from the other, and
 *  `single-definition` sees one of each. Widening the verb ceiling therefore
 *  does NOT silently move what the console calls stalled — that is a
 *  deliberate edit here, made with this paragraph's inequality in hand. */
export const SPAWN_STALL_MS = 360_000;

/** D-792, §6. WHEN the console is allowed to name the gate holding a delivery.
 *
 *  Three conditions, all of which must hold, and they are here for the same
 *  reason `SPAWN_STALL_MS` is: a threshold the console DRAWS ON must not be a
 *  copy of a number the lane ENFORCES. Nothing in `sweepMail` reads any of
 *  these — reading one would make a gate column a scheduling input, which the
 *  design forbids by name.
 *
 *  `MAIL_GATE_HELD_MS` — how long ONE gate must have held a delivery unbroken
 *  (`now - gateSince`) before that is worth saying out loud. Deliberately far
 *  above a busy worker's ordinary turn: fifteen minutes clears a full server
 *  suite (~9 min) with room, so `not-idle` on a session doing real work stays
 *  silent. Below it the row renders exactly as it did before this field
 *  existed — a worker busy for ninety seconds is not a fault, and drawing it
 *  as one would re-introduce the very lie this design was written against.
 *
 *  `MAIL_GATE_HELD_COUNT` — how many consecutive refusals at that same gate.
 *  `gateSince` alone is not enough: a sweep that ran once, recorded a gate and
 *  then stopped leaves an ageing `gateSince` behind it, and one observation is
 *  not a pattern.
 *
 *  `MAIL_GATE_FRESH_MS` — how recently the most recent refusal was observed
 *  (`now - gateAt`). This is the whole reason `gateAt` is a separate column
 *  from `gateSince`: a sweep that has STOPPED leaves `gateSince` looking
 *  exactly like a sweep that is running and still refusing. Five minutes, not
 *  a small multiple of the sweep cadence, because `gateAt` is stamped by the
 *  SERVER's clock and compared against the VIEWER's — a phone minutes off UTC
 *  must not silence the line.
 *
 *  THE TEST IS ONE-SIDED, deliberately, and this sentence used to claim
 *  otherwise. Only a `gateAt` too far in the PAST silences the line; one in the
 *  FUTURE — which is what a viewer clock running behind the server's produces —
 *  passes, and is pinned that way. The asymmetry is the safe one: a future
 *  stamp means the refusal is at most as old as the skew, so the line is if
 *  anything under-stating the hold. A past-side miss costs a warning nobody
 *  sees; a two-sided test would cost the warning AND make a viewer's wrong
 *  clock look like a wedged sweep. */
export const MAIL_GATE_HELD_MS = 900_000;
export const MAIL_GATE_HELD_COUNT = 3;
export const MAIL_GATE_FRESH_MS = 300_000;

/** One mail row, for the feed and the session strip (both PR J). */
export interface MailSummary {
  /** The MAIL id (`mail.id`) — identifies the message, not any one
   *  recipient's copy of it. NOT the id `GET /api/mail/:id` or
   *  `POST /api/mail/:id/ack` key on — see `deliveryId` below. */
  id: number;
  /** The DELIVERY id (`mail_deliveries.id`) — a SEPARATE `AUTOINCREMENT`
   *  sequence from `id` above (`server/src/coord/schema.ts`) that only
   *  happens to walk alongside it while every mail resolves to exactly one
   *  delivery, and diverges the first time it does not (one mail fanned to
   *  several recipients). This is the id both `GET /api/mail/:id`
   *  (`deliveryEnvelope`) and `POST /api/mail/:id/ack` (`coord.delivery`)
   *  resolve against — the reference-nudge protocol (`renderMailNudge`,
   *  `coord/envelope.ts`) tells a worker to read THIS field, never `id`,
   *  for both calls (re-opened D-41, blocking review finding). */
  deliveryId: number;
  at: number;
  fromId: string;
  toId: string;
  runId: number | null;
  kind: MailKind;
  subject: string;
  artifacts: string[];
  state: MailDeliveryState;
  /** Send attempts this DELIVERY has made (`mail_deliveries.attempts`), as the
   *  lane counts them toward `MAIL_MAX_ATTEMPTS`. On the wire so a back-off is
   *  visible BEFORE the park: without it, a delivery blocked against a dirty
   *  input box for fifteen minutes is byte-identical to one merely waiting its
   *  turn, and the first thing anyone hears is `undeliverable`.
   *
   *  It counts SEND FAILURES only, matching the ceiling exactly — a gate the
   *  lane declines to charge for (`backOff(..., countsAsAttempt: false)`, an
   *  unmeasurable registry row) does not advance it here either, or the number
   *  would be a second, disagreeing story about the same row. */
  attempts: number;
  /**
   * The delivery lane's last failure, RAW (`mail_deliveries.lastError`).
   *
   * FREE TEXT, and it has to be treated as such: four writers put four
   * different kinds of thing here — a typed `sendPrompt` error code,
   * `'recipient not in registry'`, `'run closed'`, and a whole English
   * sentence (`MAIL_REPLAY_CEILING_ERROR`). The column is a maintainer's grep
   * target, not a vocabulary, and it has never been validated on the way in.
   *
   * SO THE RULE FOR EVERY CLIENT, and it is not negotiable: branch on the ONE
   * literal token you have a surface for (`=== 'draft-present'`), never key a
   * total `Record<string, …>` off it — a value a newer server writes would
   * render as `undefined` on an older client — and never display it raw to an
   * operator. `pwa/test/mail-strip.test.tsx` scans `pwa/src` for both shapes,
   * so this paragraph is a mechanism rather than a request.
   *
   * `null` means no failure is on record, which is not the same as an empty
   * one: it is the shape of a delivery that has never been attempted.
   */
  lastError: string | null;
  /**
   * D-792, and the four fields answer four different questions on purpose.
   *
   * `lastGate` — WHICH ordinary gate refused this delivery most recently, or
   * `null` for "none has", which is a fresh row or one that moved. It is a
   * CLOSED union (`MailGate`), the exact opposite of `lastError` above, so a
   * client MAY key a total `Record<MailGate, …>` off it — while still
   * rendering an unrecognised token raw rather than `undefined`, because an
   * older client can meet a newer server's member.
   *
   * `gateCount` — consecutive refusals at that same gate; `gateSince` — when
   * that gate first refused this row unbroken; `gateAt` — when the most recent
   * refusal was observed. The last two are not redundant: a sweep that has
   * STOPPED leaves `gateSince` looking exactly like one still refusing, and
   * `now - gateAt` is the only thing that separates them.
   *
   * ADDITIVE; `FLEET_PROTO` is deliberately not bumped. An older server omits
   * all four, and absence means "nothing to say about a gate" — never "no gate
   * is holding it", which is a claim this build would be making on that
   * server's behalf.
   *
   * NONE OF THEM IS A SCHEDULING INPUT. They are written after every decision
   * is made, and exist so a reader can tell a delivery that is WAITING from one
   * that is WEDGED — a distinction that previously existed nowhere, and cost
   * eleven hours of an unread nudge to notice.
   */
  lastGate: MailGate | null;
  gateCount: number;
  gateSince: number | null;
  gateAt: number | null;
}

/** The two enforced caps (spec:199-201). The two COUNTS are queries over
 *  `runs`, never stored beside these — see `CoordStore.capsUsage`. */
export interface CoordCaps { maxConcurrentWorkers: number; maxSessionsPerDay: number }

/** A file staged into ~/.cc-clips/<id>/, ready to be named in a prompt. The
 *  server reports no dimensions — it has no image decoder, and never will. */
export interface StagedClip { path: string; name: string; bytes: number }

/**
 * A clip path anywhere in a string: `…/.cc-clips/<session>/clip-<stem>.<ext>`.
 * Matched by SHAPE, never by touching the filesystem, so it works client-side.
 * Exported WITHOUT the `g` flag to avoid stateful `lastIndex` — a g-flagged
 * module-scope regex returns alternating true/false on successive `.test()` calls.
 * Internal consumers build their own `new RegExp(CLIP_PATH_RE.source, 'g')`.
 */
export const CLIP_PATH_RE =
  /\/[^\s]*\/\.cc-clips\/[^/\s]+\/clip-[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)/;

/**
 * Attachment paths first, each on its own line, then the user's text. Paths
 * lead so the transcript reads image-above-caption.
 *
 * LEADING BLANK LINES ARE STRIPPED FROM `text`. This filter used to drop empty
 * ARRAY MEMBERS only, so a prompt beginning with a newline typed an empty
 * literal, then M-Enter, then the real text — leaving the input box's MARKER
 * ROW blank. That is not cosmetic: `submitted()` proves a send with
 * `!draftOf(pane).startsWith(needle)` and `needle` is the first NON-blank
 * line, so on a blank marker row the proof is vacuous — measured, a pane
 * byte-identical before and after Enter returns ok:true and the message is
 * silently lost. Typing one is never worth what it costs: the blank row DOES
 * land in the box — that is the bug above, not a hypothetical — it carries
 * nothing the message needed, and it takes the send proof with it.
 *
 * NOT "the box cannot hold a blank marker row", which is what this passage
 * said when it landed and which the rest of this wave then falsified: it can,
 * and two shipped guards exist because it can — `submitEnter`'s
 * `blank-first-row` and the clobber guard's `hasContentBelowMarker`
 * (`server/src/inject/send.ts`, which states the same position). What is
 * removed here is US as a producer of that shape; a human pressing Enter in
 * the box before typing still is one.
 *
 * INTERIOR and TRAILING blank lines are untouched: only the marker row is at
 * stake, and an interior blank line is the message.
 *
 * PRICE, stated rather than discovered: stripping on this side makes the
 * `splitClipPaths` round-trip LOSSY. `splitClipPaths(composePrompt(t, a))`
 * cannot return a `rest` that begins with the blank lines `t` began with. That
 * is accepted — `splitClipPaths` already trims leading blank lines off its own
 * result, so the round trip was never byte-exact at that edge anyway.
 */
export function composePrompt(text: string, attachments: readonly string[]): string {
  // `[^\S\n]` (horizontal whitespace) rather than `\s`, so a run of blank-ish
  // lines is eaten one WHOLE LINE at a time and the first content line keeps
  // its own indentation — a `\s*` strip would reflow an opening code fence or
  // a bullet's hanging indent.
  const body = text.replace(/^(?:[^\S\n]*\n)+/, '');
  return [...attachments, body].filter((part) => part !== '').join('\n');
}

/**
 * Inverse of composePrompt, for rendering. Pulls every clip path out wherever it
 * sits — own line, leading, trailing or mid-line — because `ccd clip` types the
 * path with no Enter, so the user's prose lands on either side of it. Paths come
 * back in document order and deduplicated; the prose has the holes closed up.
 *
 * Whitespace is touched on the lines a path came OUT of and nowhere else. An
 * earlier revision collapsed space runs on every line, and MessageBubble runs
 * this over every user turn into a `white-space: pre-wrap` bubble — so every
 * pasted code block, stack trace, log line and aligned table in the entire
 * history rendered flattened, attachment or not.
 */
export function splitClipPaths(text: string): { paths: string[]; rest: string } {
  const paths: string[] = [];

  const cleanedLines = text.split('\n').map((line) => {
    let hit = false;
    const stripped = line.replace(new RegExp(CLIP_PATH_RE.source, 'g'), (match) => {
      hit = true;
      if (!paths.includes(match)) paths.push(match);
      return '';
    });
    // No path left this line: hand it back byte-identical, indentation and all.
    if (!hit) return line;
    // A path DID leave a hole here — close it up. `ccd clip` types the path with
    // a trailing space, and pulling one out mid-line would leave a double space.
    const cleaned = stripped.replace(/[^\S\n]+/g, ' ').trim();
    // Non-empty before, empty now: the line held only a path. Drop it entirely
    // rather than leave a blank that merges nothing and separates nothing.
    return cleaned === '' ? null : cleaned;
  });

  const kept = cleanedLines.filter((line): line is string => line !== null);
  // Trim by LINE, not by character: a `.trim()` over the joined result would eat
  // the indentation of a message that opens on an indented line.
  while (kept.length > 0 && kept[0]!.trim() === '') kept.shift();
  while (kept.length > 0 && kept[kept.length - 1]!.trim() === '') kept.pop();

  return { paths, rest: kept.join('\n') };
}

// ─── Auth — the session gate's wire vocabulary (Stage 3a) ───────────────────
//
// Declared HERE for `AccountsResponse`'s reason, one section up: the server
// produces these shapes and the PWA consumes them, and a shape restated on each
// side is a shape that drifts. `server/test/auth-wire.test.ts` pins the runtime
// half and `pwa/test/auth-wire.test-d.ts` pins that the same declarations
// resolve under the PWA's bundler resolution — one definition, two importers.
//
// NOTHING IN THIS SECTION IS A FLEET FRAME, so `FLEET_PROTO`/`FLEET_PROTO_MIN`
// do not move; they stay 1. Adding a route family is not a protocol change, and
// the wire-discipline rule this file states at :560-566 is about a peer reading
// a frame it did not expect — an HTTP route an old client never calls cannot
// present that problem.

/**
 * Why the gate answered the way it did. SIX outcomes, a union, never a boolean —
 * and the boolean is not a hypothetical alternative, it is the shipped defect
 * this vocabulary is written against.
 *
 * `server/src/coord/token.ts` (D-39) folded `'unconfigured'` into `'ok'`: a box
 * with NO token configured returned the same answer as a box whose token
 * matched, and the mail lane ran unauthenticated. The two conditions a caller
 * handles differently had collapsed to one value — the overloaded-null defect
 * (`CLAUDE.md`), wearing an enum's clothes. Here the polarity is inverted and
 * each member names a DIFFERENT thing the operator must do:
 *
 *  - `ok`            — a live session, or the flag is off. Proceed.
 *  - `wrong`         — the passphrase (or the assertion) did not verify. Retry
 *                      is the remedy, and it is rate-limited.
 *  - `unconfigured`  — `CCRC_AUTH=on` but no `~/.ccrc/auth.scrypt` exists. NOT
 *                      "wrong": nothing the user can type will ever match, and
 *                      the login screen must say `ccrc passwd`, not "try again".
 *                      Fails SHUT — an absent secret never means "let them in".
 *  - `locked-out`    — the login rate limiter's window is closed. Distinct from
 *                      `wrong` because the answer is a clock, not a keyboard.
 *  - `expired`       — a session that WAS valid no longer is: past its TTL, or
 *                      stamped with a generation `ccrc passwd` has since bumped.
 *                      Distinct from `no-session` so the PWA can say "you were
 *                      signed out" instead of showing a cold login screen.
 *  - `no-session`    — no cookie, or one this build cannot parse. The ordinary
 *                      first visit, and the ordinary unparseable-cookie case:
 *                      both mean "present credentials", neither is an error.
 *
 * `AuthStatus['mode']` below is a DIFFERENT axis and deliberately not this type
 * — see its own note.
 */
export type AuthVerdict =
  | 'ok' | 'wrong' | 'unconfigured' | 'locked-out' | 'expired' | 'no-session';

/**
 * The runtime list, derived from the type — `PR_REASON_MAP`'s idiom (:264) and
 * its exact guarantee: `Record<AuthVerdict, true>` makes a seventh verdict a
 * TS2739 here ("missing the following properties") instead of a list that is
 * silently one short, and a key the union does not have a TS2353. A
 * hand-written `readonly AuthVerdict[]` gives neither.
 *
 * `Object.keys` is safe to derive an order from: every key is a non-numeric
 * string, for which insertion order is specified. Nothing downstream depends on
 * the order regardless — the consumers ask membership.
 */
const AUTH_VERDICT_MAP: Record<AuthVerdict, true> = {
  ok: true, wrong: true, unconfigured: true, 'locked-out': true,
  expired: true, 'no-session': true,
};
export const AUTH_VERDICTS: readonly AuthVerdict[] =
  Object.keys(AUTH_VERDICT_MAP) as AuthVerdict[];

/**
 * The only way to narrow an untrusted string to an `AuthVerdict` — same shape
 * and same reasoning as `isPrReason` (:286): the parameter is `unknown`, so
 * nothing is smuggled in by claiming it is already a verdict, and the CONSTANT
 * is cast rather than the input (`AUTH_VERDICTS.includes(raw as AuthVerdict)`
 * would assert the very thing the check is asking).
 *
 * The PWA is the caller that needs it: a 401's JSON body arrives as `unknown`
 * and has to become a verdict before the login screen can choose its sentence.
 */
export function isAuthVerdict(v: unknown): v is AuthVerdict {
  return typeof v === 'string' && (AUTH_VERDICTS as readonly string[]).includes(v);
}

/**
 * `POST /api/auth/login`'s body. The passphrase travels in the body and NOWHERE
 * else — never a query string, never a header — because both of those are
 * routinely logged by proxies and by the server's own request logging.
 *
 * There is deliberately NO `LoginResponse` type. A successful login is `204 No
 * Content` plus `Set-Cookie`: the cookie IS the response, and an empty
 * interface would be a shape the server never sends and the PWA would then be
 * tempted to parse. A REFUSAL does carry a body (`{ verdict: AuthVerdict }`
 * plus, when `locked-out`, a retry hint) — that shape belongs to the route that
 * sends it (Task 5), not here, because it is a refusal envelope shared with the
 * gate rather than a login-specific document.
 */
export interface LoginRequest {
  passphrase: string;
}

/**
 * `GET /api/auth/status` — the box's standing gate posture, which is what the
 * login screen reads BEFORE anyone types anything.
 *
 * `mode` is not an `AuthVerdict` and must not be conflated with one: a verdict
 * is THIS REQUEST's outcome, `mode` is how the box is configured. `'off'` and
 * `'passphrase'` are not verdicts at all, which is the proof they are different
 * axes; `'locked-out'` appears in both spellings on purpose, because a browser
 * arriving mid-window needs to be told to wait before it offers a field that
 * cannot succeed.
 *
 *  - `'off'`        — `CCRC_AUTH` is off; the gate is a passthrough and
 *                     `authed` is true for everyone. The shipped default.
 *  - `'passphrase'` — the gate is armed and a secret exists.
 *  - `'locked-out'` — armed, and the login rate limiter's window is closed.
 *
 * `passkeysEnrolled` is a COUNT, not a boolean, for two surfaces: the login
 * screen decides whether to offer the passkey button at all (`> 0`), and the
 * enroll screen renders the number. It is intentionally not a list of
 * credential ids — an unauthenticated caller learns how many keys exist, which
 * it must to draw the right screen, and nothing that identifies them.
 *
 * NOTE the state this shape does NOT have: "armed but no secret file"
 * (`AuthVerdict`'s `'unconfigured'`). That is a misconfigured box, and it is
 * reported by `ccrc doctor` (Task 9) rather than published on an unauthenticated
 * route, where it would advertise exactly which boxes are unenterable-but-open.
 */
export interface AuthStatus {
  authed: boolean;
  passkeysEnrolled: number;
  mode: 'off' | 'passphrase' | 'locked-out';
  /**
   * The DISTINCT `rpId` values over this box's stored passkeys, sorted — names
   * only, never a credential id, a count, or key material (Stage 3b, spec D7).
   *
   * It exists for ONE sentence: a box renamed by `ccrc expose` keeps its old
   * credentials on disk, every ceremony against them fails with the browser's
   * generic `NotAllowedError`, and the login screen used to render "cancelled"
   * for a state that is really "enrolled under the old name". With this field
   * the screen can say what is true — and the anonymous ruling is
   * `passkeysEnrolled`'s: the login screen reads it BEFORE anyone signs in, and
   * "some passkey exists for some name" is already disclosed by the passkey
   * button being drawn at all.
   *
   * ADDITIVE, `FLEET_PROTO` stays 1, and ABSENT means "unknown", never "no
   * passkeys": an older server omits the field entirely, and the producer emits
   * it only when at least one credential exists, so absence and emptiness never
   * become two spellings from one build. A reader that collapsed absent to `[]`
   * would tell every operator on an older server their keys were gone.
   */
  enrolledRpIds?: string[];
}

// ── WebAuthn (Task 8) ──
//
// EVERY `…B64url` field below is base64url — RFC 4648 §5, the `-`/`_` alphabet
// with NO `=` padding. That is what the browser's own WebAuthn JSON helpers
// emit and what `Buffer.from(s, 'base64url')` reads; standard base64 would
// round-trip through `+`/`/` and break the first time one of these rides in a
// URL or a JSON string that something re-encodes. The suffix is on the field
// NAME rather than only in a comment so a caller cannot hand `toString('base64')`
// to it without reading what it is called.
//
// These are the shapes only — no crypto lives in L0, and none can: `shared/`
// imports nothing, not even `node:*`.

/**
 * The COSE algorithm identifier for ECDSA-P256-SHA256 — the ONE algorithm this
 * box's passkeys use, and a WIRE value rather than a server implementation
 * detail, which is why it lives here.
 *
 * THREE CONSUMERS, ONE DEFINITION, and that is the whole reason it is not just
 * written `-7` where each needs it. The PWA hands it to
 * `navigator.credentials.create` as `pubKeyCredParams`; the server verifies
 * `PasskeyRegisterFinish.algorithm` against it, and re-checks it on every
 * assertion; `server/src/auth/webauthn.ts` derives its `SUPPORTED_ALGS` list
 * from it. Three hand-typed `-7`s across two packages is precisely the shape
 * `single-definition.test.ts` exists to fail the build on — and the failure
 * would be silent rather than loud: a PWA asking for one algorithm while the
 * server accepts another produces an enrolment the browser completes and the
 * server refuses, with nothing anywhere naming the mismatch.
 *
 * WHY ONLY THIS ONE — and why the server's list is a list rather than this
 * constant alone — is argued at `SUPPORTED_ALGS` in `server/src/auth/webauthn.ts`:
 * ES256 is mandatory-to-implement for WebAuthn authenticators, so one member
 * costs no device compatibility, and every other algorithm is verification
 * surface nobody needs.
 */
export const COSE_ES256 = -7;

/**
 * Server→client, `POST /api/auth/passkey/register/start`. Behind the session
 * gate: enrolling a key requires already being logged in with the passphrase.
 *
 * `rpId` is SENT, not derived by the client from its own origin, and not
 * derived by the server by stripping labels off a hostname. It is the
 * registrable domain from `CCRC_RP_ID` config, and label-stripping walks
 * straight into the public-suffix hazard (`ts.net`, `duckdns.org` are public
 * suffixes; a credential scoped to one would be offered to every other box
 * under it). It is echoed here so the client's `create()` call and the server's
 * stored binding cannot disagree — a box renamed between enroll and use fails
 * loudly ("enrolled for localhost — re-enroll") instead of silently not
 * matching.
 */
export interface PasskeyRegisterStart {
  challengeB64url: string;
  rpId: string;
  /** The `user.id` handed to `navigator.credentials.create` — an opaque
   *  per-box handle, never an email or a username. Single-operator boxes have
   *  no user identity to carry (spec §6 holds that seam for the team edition),
   *  so this exists to satisfy the ceremony, not to name anyone. */
  userHandleB64url: string;
}

/**
 * Client→server, `POST /api/auth/passkey/register/finish`. The client sends the
 * PUBLIC KEY ALREADY EXTRACTED — `PublicKeyCredential`'s own
 * `response.getPublicKey()` returns SPKI DER — which is what lets the server
 * verify assertions with `node:crypto` alone and parse NO CBOR. That is the
 * whole no-new-dependency argument, and it lives in the shape of this
 * interface: an `attestationObject` field here would drag a COSE decoder in
 * behind it.
 */
export interface PasskeyRegisterFinish {
  credentialIdB64url: string;
  /** SubjectPublicKeyInfo DER, from `response.getPublicKey()`. */
  publicKeySpkiB64url: string;
  /** The COSE algorithm identifier, from `response.getPublicKeyAlgorithm()` — a
   *  NUMBER (ES256 is -7, RS256 is -257), never a name, so the server refuses
   *  an algorithm it cannot verify rather than guessing from a string. */
  algorithm: number;
  authenticatorDataB64url: string;
  clientDataJsonB64url: string;
}

/** Server→client, `POST /api/auth/passkey/assert/start`. Unauthenticated by
 *  necessity — this is how you log IN — and rate-limited on its own looser
 *  budget, because a free challenge is a free CPU oracle. */
export interface PasskeyAssertStart {
  challengeB64url: string;
  /** As `PasskeyRegisterStart.rpId`, and for the same public-suffix reason. */
  rpId: string;
  /** `allowCredentials`, flattened to the ids: every credential this box would
   *  accept. Empty means none are enrolled, and the client must fall back to
   *  the passphrase rather than prompting for a key that cannot exist. */
  allowCredentialIdsB64url: readonly string[];
}

/** Client→server, `POST /api/auth/passkey/assert/finish`. `signatureB64url` is
 *  DER as the authenticator produced it — `createVerify('SHA256')` reads DER
 *  natively, so nothing here unpacks it into (r, s). */
export interface PasskeyAssertFinish {
  credentialIdB64url: string;
  authenticatorDataB64url: string;
  clientDataJsonB64url: string;
  signatureB64url: string;
}

/**
 * One enrolled key, as the ENROLMENT SCREEN sees it — `GET /api/auth/passkeys`,
 * which is BEHIND the session gate.
 *
 * NOT an anonymous shape, and the difference from {@link PasskeyAssertStart}'s
 * bare id list is the point: `enrolledAt`/`lastUsedAt`/`label` are how an
 * operator tells one key from another when deciding which to revoke ("the phone
 * I lost, last used three weeks ago"), and they are exactly the fields that
 * would be a fingerprinting gift to an anonymous caller. Two routes, two
 * audiences, two shapes.
 *
 * `label` is the enrolling device's user-agent, truncated. It is attacker-
 * controlled text that a browser will render, so the PWA must treat it as text
 * and never as markup — React does that by default, which is why it is safe to
 * carry here at all.
 */
export interface PasskeySummary {
  /** base64url — the id `DELETE /api/auth/passkey/:id` takes. */
  credentialIdB64url: string;
  label: string;
  enrolledAt: number;
  lastUsedAt: number;
  /** Whether user verification was performed at enrolment. Informational: the
   *  policy is enforced on every assertion from the authenticator's own flags,
   *  never from this. */
  uvAtEnrollment: boolean;
}

/**
 * `GET /api/auth/passkeys` — the enrolment screen's whole view. Gated.
 *
 * `storeUnreadable` IS NOT A NICETY (D-132). The credential file has three
 * states, not two — absent, readable, and PRESENT-BUT-UNREADABLE — and the third
 * one used to be reported as an empty list, i.e. as "no passkey is enrolled on
 * this box". An operator who believes that enrols, and the enrolment REWRITES
 * the file from an in-memory array that is empty only because the read failed,
 * destroying the credentials that were there. So the screen is told the
 * difference, and the server refuses the enrolment besides.
 */
export interface PasskeyListResponse {
  credentials: PasskeySummary[];
  /** True iff the file EXISTS and could not be read or parsed. `credentials` is
   *  then empty for a reason that is not "there are none". */
  storeUnreadable: boolean;
}

/* ---------------------------------------------------------------------------
 * THE LIFECYCLE JOURNAL — build 9, §1 (D1-D7). The fleet's PAST TENSE.
 *
 * Every act a session or a human takes on the fleet leaves an append-only
 * NDJSON line in `$REG/.lifecycle/`, a dot-prefixed DIRECTORY that `_reg_purge`
 * (`ccd:458-556`) structurally cannot reach — its suffix filter globs
 * `$REG/<id>.*` and ids never begin with a dot. That is what makes a
 * destruction record possible at all: a new registry FIELD would be destroyed
 * by the loop the day it was added.
 *
 * NAME COLLISION, SAID OUT LOUD SO THE NEXT READER DOES NOT CONFLATE THEM.
 * `SessionLifecycle` / `sessionLifecycle()` / `LifecycleField` /
 * `LifecycleInput` (:963-1260 above) classify a registry row AS IT IS NOW —
 * WHY a session is not alive. Everything below is what was DONE, by whom, and
 * with what result. Two different lifecycles, two different questions. The
 * journal half is prefixed `LC_` / `Lifecycle{Act,Outcome,Obs,Dec,Meas,Event}`
 * and lives here, at the far end of the file, rather than beside them.
 *
 * Nothing here decides anything about the fleet. ccd cannot refuse on identity
 * — single UNIX user, attribution not authentication — and this vocabulary does
 * not pretend otherwise. The record IS the mechanism.
 * ------------------------------------------------------------------------- */

/**
 * Every act ccd can journal. ONE WORD PER OPERATOR-VISIBLE ACT, named for the
 * verb a person would say and not for the bash function that implements it:
 * `destroy`, because `ws-rm` and `ws-gc --prune` both destroy a workspace and
 * a reader asking "what destroyed this" must not have to know which ran. The
 * verb itself travels separately, in `LifecycleEvent.verb`.
 *
 * `unknown` IS THE READER'S DEGRADE, NEVER A CALL SITE'S CHOICE (D6). A line
 * naming an act this build does not model is ingested as `unknown`, with the
 * token preserved in `LifecycleEvent.badact` and the bytes in `raw`: a byte we
 * saw and could not model is a different fact from a byte that was never
 * there, and both differ from a row we dropped. So ccd's own `_LC_ACTS` holds
 * this list MINUS `unknown` — set-equal in both directions, pinned by
 * `server/test/lifecycle-vocabulary.test.ts`, which EXECUTES the bash array
 * rather than grepping for it.
 *
 * Adding an act is a two-line edit here (union member + map key) and a
 * `_LC_ACTS` entry in ccd. `Record<LifecycleAct, true>` makes forgetting the
 * map a TS2739 and an extra key a TS2353; the cross-language test makes
 * forgetting ccd a red suite. A hand-written `readonly LifecycleAct[]` gives
 * neither, which is why `LIFECYCLE_ACTS` is derived below.
 */
export type LifecycleAct =
  | 'create'        // ws-add minted a workspace
  | 'claim'         // _reg_claim wrote `started`
  | 'purge'         // _reg_purge is about to unlink the row (the D3 backstop)
  | 'supervise'     // _ws_supervise enabled the unit
  | 'unsupervise'   // _ws_unsupervise disabled it and stamped `.stopped`
  | 'destroy'       // ws-rm / ws-gc --prune removed a workspace
  | 'rename'        // ws-rename moved the branch
  | 'hold' | 'release'
  | 'archive' | 'restore'
  | 'attic-drop'    // ws-attic --drop deleted pinned refs
  | 'reap'          // ws-reap
  | 'gc'            // RESERVED, and nothing emits it — `ws-gc --prune`'s
                    // per-row removals go out as `destroy` with `verb ws-gc`
                    // (ccd:8699, ccd:8812). A run-level line would need an
                    // identity `_lc_emit` cannot express: it takes a session
                    // id, and a prune RUN sweeps many. Kept rather than
                    // removed because this vocabulary is wire-facing and
                    // additive-only — a newer ccd emitting `gc` at an older
                    // server is what absence-permits exists to survive.
  | 'spawn'         // _spawn_settle, CHANGE-ONLY (§2)
  | 'start' | 'ensure' | 'swap' | 'enable' | 'stop' | 'forget'
  | 'unknown';      // the reader's degrade. NEVER written by a ccd call site.

/** Derived from the type, never restated beside it — `PR_REASON_MAP`'s idiom
 *  (:299) and its exact guarantee. Module-private: only the derived list and
 *  the guard are exported, so `LIFECYCLE_ACTS.includes(raw as LifecycleAct)`
 *  — asserting the very thing the check asks — has no shorter route than
 *  `isLifecycleAct`. */
const LIFECYCLE_ACT_MAP: Record<LifecycleAct, true> = {
  create: true, claim: true, purge: true, supervise: true, unsupervise: true,
  destroy: true, rename: true, hold: true, release: true, archive: true, restore: true,
  'attic-drop': true, reap: true, gc: true, spawn: true, start: true, ensure: true,
  swap: true, enable: true, stop: true, forget: true,
  unknown: true,
};
export const LIFECYCLE_ACTS: readonly LifecycleAct[] =
  Object.keys(LIFECYCLE_ACT_MAP) as LifecycleAct[];

/** The one act ccd may never name at a call site. Exported so every filter
 *  that excludes the degrade filters by THIS, not by a literal a later edit
 *  could quietly point at the wrong member — the improvement on
 *  `SESSION_LIFECYCLES.filter((s) => s !== 'unmeasurable')`, which spells its
 *  exclusion inline in two suites. */
export const LC_ACT_UNKNOWN: LifecycleAct = 'unknown';

/** The only way to narrow an untrusted string to a `LifecycleAct`. The
 *  parameter is `unknown` so nothing can be smuggled in by claiming it is
 *  already an act, and the CONSTANT is cast rather than the input. */
export function isLifecycleAct(v: unknown): v is LifecycleAct {
  return typeof v === 'string' && (LIFECYCLE_ACTS as readonly string[]).includes(v);
}

/**
 * What happened to the act. D4: the destructive verbs (`ws-rm`, `ws-reap`,
 * `ws-gc --prune`, `forget`) write one `intent` line BEFORE the irreversible
 * act and one outcome line after, sharing a `tx`.
 *
 * THERE IS DELIBERATELY NO `orphaned` MEMBER. "An `intent` with a `failed`
 * sibling is a half-destroyed workspace; an `intent` with no sibling at all is
 * a process that died mid-destroy" is a fact about a PAIR of rows, DERIVED BY
 * THE READER and never stored — a writer cannot know it, and storing it would
 * give the reader two sources for one fact.
 *
 * `_lc_obs` gathers the `obs` block once per process and emits nothing, so it
 * contributes no outcome — there is NO `observed` member. If wave 2 finds it
 * must emit, adding one here is the same two-line edit as an act.
 */
export type LifecycleOutcome =
  | 'intent'    // said before the irreversible act
  | 'done'      // it happened
  | 'refused'   // ccd declined; `LifecycleEvent.refusal` carries the token
  | 'failed'    // it was attempted past the point of no return and did not finish
  | 'unknown';  // the reader's degrade, exactly as `LifecycleAct.unknown`

const LIFECYCLE_OUTCOME_MAP: Record<LifecycleOutcome, true> = {
  intent: true, done: true, refused: true, failed: true, unknown: true,
};
export const LIFECYCLE_OUTCOMES: readonly LifecycleOutcome[] =
  Object.keys(LIFECYCLE_OUTCOME_MAP) as LifecycleOutcome[];

/** The outcome side's degrade, named once for the same reason `LC_ACT_UNKNOWN`
 *  is: `journalparse.ts`'s `isLifecycleOutcome(raw) ? raw : LC_OUTCOME_UNKNOWN`
 *  and ccd's `_LC_OUTCOMES` (this list minus this member) must not each spell
 *  it inline. Both halves of the vocabulary have a degrade; both name it. */
export const LC_OUTCOME_UNKNOWN: LifecycleOutcome = 'unknown';

export function isLifecycleOutcome(v: unknown): v is LifecycleOutcome {
  return typeof v === 'string' && (LIFECYCLE_OUTCOMES as readonly string[]).includes(v);
}

/**
 * What the KERNEL says about the process that ran ccd, resolved from
 * `/proc/self/cgroup`'s `0::` path (D2). Unforgeable by env — the systemd unit
 * names the session id in the path, which is respawn provenance nothing on
 * this box has today.
 *
 *   `app.slice/ccrc-agent.service`           -> agent
 *   `app.slice/tmux-spawn-<uuid>.scope`      -> pane
 *   `app.slice/claude-session@<id>.service`  -> supervisor
 *   `user.slice/session-N.scope`             -> login
 *
 * TWO SPELLINGS, ONE FACT, AND THE MAPPING IS WRITTEN DOWN HERE SO NOBODY
 * "FIXES" EITHER: on the WIRE this value is `LifecycleObs.cg` (ccd writes
 * `obs.cg`, spec-mandated); as a DERIVED PAIR crossing the L1/L3 seams it is
 * `obsClass`, matching this file's `corroboration(obsClass, decSurface)`
 * parameter names and `ProvenancePair` in `server/src/coord/store.ts`. Same
 * for `LifecycleDec.surface` <-> `decSurface`. Wire names are short because a
 * million lines carry them; seam names are explicit because a reader of one
 * call site has no object to look at.
 *
 * `unknown` means the path WAS read and matched none of the four. It is not
 * the same condition as "no cgroup was read at all", which the wire spells
 * `obs.cg === null` — two conditions a caller handles differently, so two
 * values (`corroboration` answers `not-comparable` for the first and
 * `unmeasured` for the second).
 *
 * A double fork makes a caller ANONYMOUS (`ppid 1`), never someone else. The
 * raw path travels beside this in `obs.cgraw` and is never dropped, so a fifth
 * shape this build cannot name is still recoverable from the record.
 */
export type ActorClass = 'agent' | 'pane' | 'supervisor' | 'login' | 'unknown';
const ACTOR_CLASS_MAP: Record<ActorClass, true> = {
  agent: true, pane: true, supervisor: true, login: true, unknown: true,
};
export const ACTOR_CLASSES: readonly ActorClass[] =
  Object.keys(ACTOR_CLASS_MAP) as ActorClass[];

export function isActorClass(v: unknown): v is ActorClass {
  return typeof v === 'string' && (ACTOR_CLASSES as readonly string[]).includes(v);
}

/**
 * What the CALLER said (D2, wire `dec.surface`, seam `decSurface`): ccd's own
 * closed set (`ccd:1523`) plus `'none'`, which is what the journal writes when
 * no `--surface` flag was passed at all.
 *
 * `StopSurface` IS UNCHANGED (spec §2) — no fifth surface word. `'none'` is a
 * journal-only member, and it is a MEASUREMENT of absence rather than a
 * default: `cmd_stop` defaults its own `surface` to `cli` (`ccd:11151`) and
 * `_ws_unsupervise` defaults its second parameter to `ccd` (`ccd:650-663`,
 * `${2-ccd}` and not `${2:-ccd}`), and NEITHER of those internal defaults may
 * reach this field. Journaling a default as a declaration would manufacture
 * corroboration out of silence, which is the one thing this family exists to
 * prevent.
 */
export type DecSurface = StopSurface | 'none';

/** Derived from `isStopSurface` (:1146) rather than restating its list — the
 *  list is module-private there precisely so there is one door. */
export function isDecSurface(v: unknown): v is DecSurface {
  return v === 'none' || isStopSurface(v);
}

/** What `corroboration()` can answer. Four words, because there are four
 *  conditions and a reader handles each differently: only `disagrees` raises
 *  `divergence.provenance-mismatch`. */
export type Corroboration = 'agrees' | 'disagrees' | 'not-comparable' | 'unmeasured';
const CORROBORATION_MAP: Record<Corroboration, true> = {
  agrees: true, disagrees: true, 'not-comparable': true, unmeasured: true,
};
export const CORROBORATIONS: readonly Corroboration[] =
  Object.keys(CORROBORATION_MAP) as Corroboration[];

export function isCorroboration(v: unknown): v is Corroboration {
  return typeof v === 'string' && (CORROBORATIONS as readonly string[]).includes(v);
}

/**
 * Which declared surfaces the observed host CORROBORATES. Total over
 * `ActorClass` so a sixth class is a TS2739 here rather than a silent
 * `undefined.includes`.
 *
 * `supervisor` and `unknown` map to the empty list, and the two empties are
 * not the same statement: `unknown` is unreachable (rung 3 of the ladder
 * catches it first, and the ladder's own test pins that), while `supervisor`
 * is genuinely reachable and genuinely disagrees with every declaration — the
 * supervisor passes no flags, so a declaration arriving from
 * `claude-session@<id>.service` is a fact worth showing an operator.
 */
const DEC_CORROBORATES: Record<ActorClass, readonly DecSurface[]> = {
  agent: ['pwa', 'agent'],   // PWA -> server -> agent -> ccd, and the agent itself
  pane: ['cli'],             // a session shelling ccd from its own Bash tool
  login: ['cli'],            // a human at an ssh shell
  supervisor: [],
  unknown: [],
};

/**
 * The ONE function permitted to relate the `obs` and `dec` families (D2).
 * PURE, and deliberately clock-free — inputs only, no `fs`, no timers — for
 * the reasons `sessionLifecycle` states at :1242.
 *
 * THE PARAMETER NAMES ARE THE SEAM SPELLING and are load-bearing: callers hand
 * it `obsClass` / `decSurface` (`ProvenancePair`), which are the same two
 * facts the wire spells `obs.cg` / `dec.surface`. Both arguments must be
 * NARROWED, never cast: `isActorClass` and `isDecSurface` are the only doors,
 * and a value that passes neither is not a disagreement — it is a value this
 * build cannot model, which a caller drops rather than reports.
 *
 * IT REPORTS, IT NEVER DECIDES. A `disagrees` raises
 * `divergence.provenance-mismatch` for a human to read; it refuses nothing and
 * picks no winner. ccd cannot authenticate a caller on a single-uid box and
 * this does not pretend to — "a disagreement is a fact the operator sees,
 * never a silently picked winner".
 *
 * The ladder's ORDER is the design. Each rung exists because collapsing it
 * into the table below would turn "we cannot compare these" into "you lied":
 *   1. no observation at all       -> unmeasured
 *   2. no declaration at all       -> unmeasured
 *   3. a word one side cannot name -> not-comparable
 *   4. `ccd` names a LAYER, not a host (ccd re-entering itself: `cmd_swap`'s
 *      `|| cmd_ensure "$id"` fallback at `ccd:11061`, `cmd_enable`'s
 *      `cmd_start "$@"` at `ccd:11105`), so it corroborates nothing about who
 *      was at the keyboard
 *                                  -> not-comparable
 *   5. the table                   -> agrees | disagrees
 */
export function corroboration(obsClass: ActorClass | null, decSurface: DecSurface): Corroboration {
  if (obsClass === null) return 'unmeasured';
  if (decSurface === 'none') return 'unmeasured';
  if (obsClass === 'unknown' || decSurface === 'unknown') return 'not-comparable';
  if (decSurface === 'ccd') return 'not-comparable';
  return DEC_CORROBORATES[obsClass].includes(decSurface) ? 'agrees' : 'disagrees';
}

/**
 * D2 — kernel-observed. Unforgeable by env: read from `/proc`, not from
 * argv or the environment. A double fork makes a caller ANONYMOUS
 * (`ppid 1`), never someone else.
 */
export interface LifecycleObs {
  /** The `0::` path, classified. `null` = no cgroup was read at all;
   *  `'unknown'` = it was read and matched none of the four shapes. The seam
   *  spelling of this same fact is `obsClass` — see `ActorClass`'s docstring. */
  readonly cg: ActorClass | null;
  /** The `0::` path VERBATIM, and it is never dropped even when `cg` names it.
   *  A fifth cgroup shape a later build learns to classify is re-projectable
   *  from this without touching the fleet box — which is what makes the mirror
   *  a re-measurement rather than an authority (D8). */
  readonly cgraw: string | null;
  readonly pid: number | null;
  /** From `/proc/<pid>/status`'s `PPid:` line, NEVER `stat` field 4 — `comm`
   *  can contain spaces, so field-4 parsing is wrong for any process whose
   *  name has one. */
  readonly ppid: number | null;
  /** The tmux `session_name` owning an ancestor pid, from
   *  `tmux list-panes -a -F '#{session_name} #{pane_pid}'` intersected with
   *  the ppid ancestry. `null` when no pane owns this process. */
  readonly pane: string | null;
  /** ccd's own word for HOW the `pane` answer was reached, so a null `pane` is
   *  not overloaded across "no ancestor is a pane", "tmux did not answer" and
   *  "the caller double-forked itself anonymous". DISPLAY-ONLY — nothing
   *  parses it back, exactly as `Divergence.detail` (:1128). */
  readonly paneWhy: string | null;
  /** `[[ -t 0 ]]` — a human was at a terminal. */
  readonly tty: boolean | null;
  /** `$SSH_CONNECTION` verbatim, or null. Environment, so self-asserted in
   *  principle; kept in `obs` because it is read the same way and at the same
   *  moment as the rest, and `corroboration()` does not consult it. */
  readonly ssh: string | null;
}

/**
 * D2 — declared. SELF-ASSERTED, and the wire says so by keeping it in its own
 * object: `--surface pwa` means only that the caller said so
 * (`ccd:658-661`'s own words about the same field).
 */
export interface LifecycleDec {
  /** `'none'` when NO flag was passed. ccd's internal defaults — `cmd_stop`'s
   *  `cli` (`ccd:11151`), `_ws_unsupervise`'s `ccd` (`ccd:663`) — must never
   *  reach this field. Seam spelling: `decSurface`. */
  readonly surface: DecSurface;
  /** `--actor`, free text, or null. Attribution, not authentication. */
  readonly actor: string | null;
  /** `--reason`, <= `LC_REASON_MAX_BYTES` BYTES, or null — on every FLAG-
   *  CARRIED `--reason` (ws-rm/forget's own `--reason`; wave 5's on
   *  rename/release/archive/restore) ccd REFUSES a longer one rather than
   *  truncating it, because a 900-byte
   *  reason recorded as 512 reads as the operator's own words. Written
   *  verbatim, PARSED NOWHERE — `cmd_ws_hold`'s standing rule for the same
   *  kind of value (`ccd:3585`). It is free text off the wire, so it must
   *  never reach an arithmetic context, an array subscript, an `eval` or an
   *  unquoted expansion: `ccd:9937-9941` is the paid lesson.
   *
   *  THE CAP IS NOT UNIFORM ACROSS EVERY WRITER OF THIS FIELD (final review,
   *  F3, disclosed rather than fixed here): `cmd_ws_hold` journals its own
   *  mandatory hold reason into this SAME field UNCAPPED — bound at
   *  `ccd:3635`, blank-checked at `ccd:3657`, but never passed through
   *  `_lc_dec_ok` before it lands at `ccd:3696`. A hold therefore accepts and
   *  records a reason that `ws-release` would refuse verbatim as `--reason`.
   *  Unifying the two (capping the hold reason, or truncating instead of
   *  refusing) is a verb-contract change on a LIVE verb and is explicitly
   *  OUT of this fix's scope — this docstring now states what is true of
   *  every writer rather than what only the flag-carried ones guarantee. */
  readonly reason: string | null;
}

/**
 * D2 — measured about the SUBJECT, read BEFORE any destruction. Every field is
 * nullable and `null` MEANS NOT MEASURED — never zero, never empty string.
 * `attic: 0` is a pin that ran and created no refs; `attic: null` is a pin
 * that was never taken. `archivedReason: ''` is a blank reason;
 * `archivedReason: null` is a row that was never archived.
 *
 * THIS TWENTY-FIVE IS CLOSED, AND THAT IS A RULING, NOT AN OVERSIGHT —
 * widened from the original ten in wave 2 (Task 21) because "closed ten, the
 * rest lives on in `raw`" turned out to be the wrong shape for THIS field
 * specifically: `LifecycleEvent.raw` is a per-event escape hatch, but wave
 * 4's `reviveMeas` reads `meas.*` through this interface's OWN key list, and a
 * key not on that list is not merely deferred to `raw` — it is silently
 * DROPPED from the mirror's typed shape, with nothing anywhere reporting the
 * loss. Measured at wave 2 HEAD (`awk '/export interface LifecycleMeas/,/^}/'
 * shared/api.ts` against `grep -oE "meas\.[a-zA-Z]+" ccd/ccd | sort -u`): ccd
 * emitted 22 distinct `meas.<key>` names; 13 of them — `base`, `bytes`,
 * `dropped`, `from`, `inUnit`, `mode`, `old`, `rc`, `registered`, `resumed`,
 * `state`, `tombstone`, `workdir` — were emitted but undeclared, i.e. silently
 * lost at ingest. Those 13 were named then; the union with the original ten
 * was 23. `tip` stays even though nothing currently emits it — a reader
 * tolerating a key the writer does not yet produce is fine, the reverse is
 * the defect this widening fixes.
 *
 * NAMED MEMBERS, NOT AN INDEX SIGNATURE — deliberately, and that is the other
 * half of the ruling. An index signature would let any key through and
 * destroy the closed vocabulary; this project's doctrine runs the other way
 * (`_LC_ACTS` pinned set-equal to `LIFECYCLE_ACTS`, `single-definition.test.ts`
 * failing the build on a second copy of an enumerated value). A 26th key
 * ccd starts emitting is a compile error here AND a red
 * `server/test/ccd-lifecycle-contain.test.ts`, which derives ccd's side by
 * scanning `ccd/ccd` rather than hand-maintaining a second list — that is
 * the point, not an inconvenience.
 *
 * `manifestBytes` and `atticsrc` — RESTORED, wave 3 (Task 24 fix round 1).
 * Wave 2 (Task 21) speculated on both, found neither emitted anywhere in the
 * shipped `ccd/ccd` at that HEAD, and removed them as dead members — a guard
 * (`ccd-lifecycle-contain.test.ts`'s "never invents an emit" case, now
 * inverted, see there) was pinned specifically to stop either being re-added
 * "on the brief's say-so" without the wire evidence to back it. Wave 3
 * supplied that evidence: `cmd_ws_rm`'s attic pin now emits `meas.atticsrc`
 * (`ccd:2983`) and `cmd_ws_restore`'s supersede now emits
 * `meas.manifestBytes` (`ccd:4493`), so the union returns to the plan's
 * original 25.
 */
export interface LifecycleMeas {
  readonly project: string | null;
  readonly workspace: string | null;
  readonly branch: string | null;
  readonly uuid: string | null;
  readonly wrapper: string | null;
  /** The tip commit as resolved before the act. */
  readonly tip: string | null;
  /** How many `refs/ccrc/attic/<id>/` refs `_ws_attic_pin` created. */
  readonly attic: number | null;
  /** Where the attic pin's tip came from — `worktree` (read live off
   *  `$workdir`'s HEAD), `registry` (the worktree was already gone; read off
   *  the registry's own `branch` field instead), or `none` (neither had one
   *  to pin). `cmd_ws_rm`'s attic pin (`ccd:2983`); the local starts `none`
   *  and only ever moves to `worktree` or `registry` (`ccd:2952,2954,2965`). */
  readonly atticsrc: 'worktree' | 'registry' | 'none' | null;
  /** Epoch SECONDS as `_reg_set "$id" archived "$(date +%s)"` wrote it
   *  (`ccd:4000`) — the registry's own unit, carried unconverted so the record
   *  is what the file said. */
  readonly archivedAt: number | null;
  /** `merged:#N | empty | manual` as `ccd:4001` wrote it, or null when the row
   *  carries no reason. Not proven present by any guard — absent is a
   *  legitimate state. */
  readonly archivedReason: string | null;
  /** The byte total of the `.archivemanifest` file `ws-restore` is about to
   *  remove, read fresh with `stat` right before the removal (`cmd_ws_restore`
   *  R4-2 supersede, `ccd:4493`) — null when `stat` could not measure it
   *  (missing or unreadable), never a fabricated 0. Nothing in ccd reads the
   *  manifest back; this byte count is the one thing preserved of it. */
  readonly manifestBytes: number | null;
  /** The `.hold` text, verbatim, or null. */
  readonly held: string | null;
  /** The worktree path, as `_reg_get "$id" workdir` or the just-created path
   *  read it back (`cmd_ws_create`, `cmd_ws_rename`, `ws-gc`, `ws-reap`). */
  readonly workdir: string | null;
  /** The base branch a new workspace was created from (`cmd_ws_create`). */
  readonly base: string | null;
  /** The name a rename REPLACED — `branch` carries what it became
   *  (`cmd_ws_rename`, `ccd:3291`). */
  readonly old: string | null;
  /** The prompt's exit status on a re-spawn (`cmd_ensure`, `ccd:9867`).
   *  Carried unconverted, like `archivedAt`. */
  readonly rc: number | null;
  /** The start mode `cmd_start` resolved before spawning. */
  readonly mode: string | null;
  /** `${CCD_IN_UNIT:-0}` — whether `cmd_ensure` ran inside the supervising
   *  unit or as an outside request for one (`ccd:10339`). */
  readonly inUnit: number | null;
  /** The wrapper a swap moved AWAY from; `wrapper` carries the target
   *  (`cmd_swap`, `ccd:11055`). */
  readonly from: string | null;
  /** How many `refs/ccrc/attic/<id>/` refs `--drop` destroyed this call —
   *  `attic` is the pin count, this is the drop count. */
  readonly dropped: number | null;
  /** `_ws_wt_branch`'s exit status for the worktree being removed — decides
   *  whether there is a git-side record to clean up (`cmd_ws_rm`'s intent). */
  readonly registered: number | null;
  /** A `ws-gc` sweep's classification of the row it is about to reclaim —
   *  `dead-reg` or `orphan`, never anything else the encoder has seen. */
  readonly state: string | null;
  /** How many bytes `ws-reap` measured before destroying the worktree, or
   *  `null` when `_ws_gc_bytes` did not return a plain integer. */
  readonly bytes: number | null;
  /** The reap PHASE (`children` | `worktree` | `branch` | `clips`) a resumed
   *  `ws-reap` was interrupted at, read back from the registry's own
   *  `.reaping` marker — not a boolean; an interrupted reap resumes from
   *  wherever it stopped. */
  readonly resumed: string | null;
  /** The tombstone record's own path, as `_ws_tombstone` returned it. */
  readonly tombstone: string | null;
}

/** Derived from the interface, never restated beside it — `LIFECYCLE_ACT_MAP`'s
 *  exact idiom (:3418), and the fix for the same defect it already prevents
 *  for acts: a hand-written `readonly string[]` of key names drifts silently
 *  from the interface it claims to describe (measured — FIX ROUND 1, task 21
 *  review: `ccd-lifecycle-contain.test.ts` shipped with a hand-listed
 *  `DECLARED` array that happened to agree with this interface today but
 *  nothing enforced that forward). `Record<keyof LifecycleMeas, true>` makes
 *  a member added to the interface without a map entry a TS2741/TS2739, and
 *  an extra map key with no interface member a TS2353 — the same two-sided
 *  compile-time guarantee `LIFECYCLE_ACT_MAP` gives acts. Module-private:
 *  only the derived array is exported, so a consumer reads the list, never
 *  the map. */
const LIFECYCLE_MEAS_KEY_MAP: Record<keyof LifecycleMeas, true> = {
  project: true, workspace: true, branch: true, uuid: true, wrapper: true,
  tip: true, attic: true, atticsrc: true, archivedAt: true,
  archivedReason: true, manifestBytes: true, held: true,
  workdir: true, base: true, old: true, rc: true, mode: true, inUnit: true,
  from: true, dropped: true, registered: true, state: true, bytes: true,
  resumed: true, tombstone: true,
};
/** The one list `server/test/ccd-lifecycle-contain.test.ts` checks ccd's
 *  emitted keys against — imported, not re-typed, so the two sides cannot
 *  independently drift the way a second hand-written copy would let them. */
export const LIFECYCLE_MEAS_KEYS: readonly (keyof LifecycleMeas)[] =
  Object.keys(LIFECYCLE_MEAS_KEY_MAP) as (keyof LifecycleMeas)[];

/**
 * One journal line. NDJSON, UTF-8, LF-terminated, <= `LC_LINE_MAX` bytes, one
 * `printf '%s\n' "$line" >> "$f"` per event — an `O_APPEND` write to a regular
 * file on Linux is serialised under the inode lock, so concurrent writers
 * cannot interleave. The precedent is measured, not assumed: `$REG/swap.log`,
 * 13 concurrent write sites over 49 days, zero corruption.
 *
 * THE THREE IDENTITY FAMILIES ARE THREE FIELDS AND THEY NEVER MERGE (operator
 * ruling R3). There is no `who`. `corroboration(obs.cg, dec.surface)` is the
 * only sanctioned relation between two of them, and it reports rather than
 * resolves.
 *
 * THIS IS THE LINE, NOT THE ROW. `gen` and `ingestedAt` are the MIRROR's own
 * facts and live on `MirroredLifecycleEvent` below; no ccd emit carries
 * either. Two wire fields ccd writes are deliberately NOT modelled here and
 * are read by `parseJournalLine` without being carried: `v` (the envelope's
 * version — the wire is additive-only, so a version is not a fact about the
 * act) and `atNs` (the same clock read `uid`'s prefix already holds). Both
 * survive in `raw`.
 *
 * There is no `reviveLifecycleEvent` here on purpose: parsing a line is
 * `parseJournalLine` in `server/src/coord/journalparse.ts`, which D8 requires
 * to be PURE and TOTAL (no clock, no lookup, no registry, no other row) —
 * that is what makes `lifecycle_events` a re-measurement rather than an
 * authority, and what makes replay from offset 0 idempotent.
 */
export interface LifecycleEvent {
  /** `<epochNs>.<BASHPID>.<seq>` — INTRINSIC, not positional (D6). `UNIQUE`
   *  in the mirror, inserted `OR IGNORE`, so re-reading a generation from
   *  offset 0 is always no-op-or-catch-up and a truncation is recoverable
   *  rather than fatal.
   *
   *  NULL WHEN THE LINE CARRIED NONE, and that is not a widening for
   *  convenience: an unparseable line is INSERTED rather than dropped (a byte
   *  we saw and could not model is a different fact from a byte that was never
   *  there), and such a row has no uid to carry. `lifecycle_raw_uid` dedupes
   *  it on its bytes within its generation instead. */
  readonly uid: string | null;
  /** Epoch MILLISECONDS, ccd's clock. Derived from the SAME clock read as
   *  `uid`'s nanosecond prefix, so the two can never disagree about one event.
   *  Never the server's clock: `MirroredLifecycleEvent.ingestedAt` is a
   *  separate, explicitly server-owned value and is never read as an event
   *  time. NULL = the line carried no readable `at`; NEVER 0, which is a date
   *  and not an absence. */
  readonly at: number | null;
  readonly act: LifecycleAct;
  /** The act token ccd wrote when this build cannot name it; null whenever
   *  `act` is not `LC_ACT_UNKNOWN`. The two are never both set. */
  readonly badact: string | null;
  readonly outcome: LifecycleOutcome;
  /** `badact`'s twin on the outcome side; null whenever `outcome` is not
   *  `LC_OUTCOME_UNKNOWN`. Both halves of the vocabulary degrade the same way
   *  and keep the token, so neither sends a reader to `raw` for it. */
  readonly badoutcome: string | null;
  /** The SUBJECT session id, or null for an act about no single row. Spelled
   *  `id` here and on every seam; the mirror's COLUMN is `sessionId`, which is
   *  the one sanctioned rename and is `JournalRow`'s business, not this
   *  type's. */
  readonly id: string | null;
  /** Pairs an `intent` with its outcome (D4). Null for a single-shot act. An
   *  intent with no sibling at all is a process that died mid-destroy —
   *  DERIVED BY THE READER over the pair, never stored as an outcome. */
  readonly tx: string | null;
  /** The ccd verb that ran (`ws-rm`, `ws-gc`, `forget`, ...). */
  readonly verb: string | null;
  /** The refusal token when `outcome === 'refused'`.
   *
   *  SPELLED `refusal`, NEVER `refused`, AND THAT IS LOAD-BEARING (D15).
   *  `server/test/wsaudit.test.ts:57` greps ccd's raw text — comments included
   *  — with /"refused":"([a-zA-Z0-9-]+)"/ and holds the result set-equal in
   *  both directions to `wsaudit.ts`'s SENTENCES. An emitter whose format
   *  string spelled `"refused":"%s"` would inject tokens into that scan and
   *  red it; that suite must stay green WITH NO EDIT, which is itself an
   *  assertion of this program. Journal-only tokens get their word from
   *  `LC_REFUSAL_WORD` below instead. */
  readonly refusal: string | null;
  /** One line for a person. DISPLAY-ONLY — nothing parses it back. */
  readonly detail: string | null;
  /** The emitter hit `LC_LINE_MAX` and dropped fields to fit — `dec.reason`,
   *  then `obs.cgraw`, then `meas`, in that order. FALSE when the wire says
   *  nothing, because absence-permits.
   *
   *  MODELLED RATHER THAN INFERRED, and that is the point: without it a
   *  `meas: null` from truncation and a `meas: null` from "nothing was
   *  measured" would be one value for two conditions a reader handles
   *  differently. `refusal` and `detail` are never in the drop set — a refusal
   *  whose token was dropped would be an untyped refusal. */
  readonly truncated: boolean;
  readonly obs: LifecycleObs | null;
  readonly dec: LifecycleDec | null;
  readonly meas: LifecycleMeas | null;
  /** The line VERBATIM, on EVERY path — parsed, degraded and unparseable
   *  alike. A byte we saw and could not model is a different fact from a byte
   *  that was never there; keeping all of them is what makes wave 4's replay
   *  drill byte EQUALITY rather than resemblance, and what lets an unmodelled
   *  `meas.*` key or a future wire field be re-projected without touching the
   *  fleet box. */
  readonly raw: string;
}

/**
 * A journal line AS THE MIRROR HOLDS IT.
 *
 * `gen` (which generation FILE it was read from) and `ingestedAt` (the
 * SERVER's clock, at insert) are facts about the READING, not about the act —
 * no ccd emit carries either, and neither may travel as though it did. They
 * live here so `LifecycleEvent` stays exactly what a line says, and so the
 * replay drill can exclude `ingestedAt` by name and still compare everything
 * else byte for byte.
 *
 * One-way: every `MirroredLifecycleEvent` IS a `LifecycleEvent`; the reverse
 * is a TS2739, which is the compile error that stops a reader inventing a
 * generation for a line that came off the wire.
 */
export interface MirroredLifecycleEvent extends LifecycleEvent {
  /** The generation's epoch-nanosecond digits — `parseLifecycleGeneration`'s
   *  answer for the file this line was read from. */
  readonly gen: string;
  /** Epoch milliseconds, the SERVER's clock, at insert. Never an event time. */
  readonly ingestedAt: number;
}

/**
 * Refusal tokens that live ONLY in the journal — the ones `_lc_refuse` /
 * `_lc_fail` write and no `"refused":"…"` JSON on ccd's stdout ever carries.
 *
 * DELIBERATELY DISJOINT FROM `wsaudit.ts`'s SENTENCES, and the disjointness is
 * a red suite (`server/test/lifecycle-refusal-word.test.ts`). D15's ruling:
 * `wsaudit.test.ts` holds SENTENCES set-equal IN BOTH DIRECTIONS to the tokens
 * its four regexes grep out of ccd's source, and a `_lc_refuse` call changes
 * no stdout and no exit contract — so it contributes no token to that scan. An
 * entry there for a journal-only token would red the stale-copy direction, and
 * the only fixes would be deleting copy or weakening an approved mechanism
 * (`ccd:2121-2128` records that argument being had once already).
 * `wsaudit.test.ts` must stay green WITH NO EDIT; that is itself an assertion
 * of this program. The shared rungs — `held`, `dirty-tree`, `no-such-session`,
 * `foreign-worktree`, `tree-unreadable`, `nested-checkouts-present`,
 * `in-progress` and the rest of the 54 — keep their single home over there.
 *
 * THE CONTRACT WAVE 3 HONOURS, AND WHAT ENFORCES IT: every token wave 3 hands
 * `_lc_refuse` / `_lc_fail` is a member of this union OR already a SENTENCES
 * key, and wave 3's own cross-language scan over `ccd/ccd` asserts it in both
 * directions with a coverage floor. It cannot live here — it would be red
 * until wave 3 lands. Adding a tenth token is a two-line edit;
 * `Record<LcRefusalToken, string>` makes forgetting its word a TS2739.
 */
export type LcRefusalToken =
  | 'scratch-unwritable'       // ws-rm could not make the scratch file it reads $workdir with
  | 'tip-unreadable'           // ws-rm could not resolve a tip while the worktree is STILL THERE
  | 'bad-session-id'           // ws-restore / forget: the id is not a shape ccrc mints
  | 'flock-unavailable'        // no util-linux flock — a destructive verb refuses to run unserialised
  | 'lock-unopenable'          // the reap lock could not be opened
  | 'is-a-workspace'           // forget, aimed at a workspace: use the audited path
  | 'session-live'             // forget, on a running session
  | 'session-verdict-unknown'  // tmux did not answer: fail-shut, nothing removed
  | 'spawn-failed';            // _lc_fail: the undo landed, the session did not come back

/**
 * The word for each. DECLARED ONCE AND EXPORTED — there is no module-private
 * `…_MAP` twin, on purpose. The "total maps stay module-private" rule exists
 * for NARROWING maps, where an exported map gives a second route past the
 * guard (`LIFECYCLE_ACT_MAP[raw]`); this is a RENDERING map, the PWA types its
 * own `Record<LcRefusalToken, …>` renderer against it, and `isLcRefusalToken`
 * is still the only narrowing door. `SENTENCES` (`wsaudit.ts:17`) is the
 * precedent and is exported directly for exactly this reason. An alias
 * declared only to satisfy a guard written for the other case would be a
 * second name for one value.
 */
export const LC_REFUSAL_WORD: Record<LcRefusalToken, string> = {
  'scratch-unwritable':
    'ccrc could not make a scratch file to read this worktree, so it proved nothing about what removing it would delete. Nothing was touched.',
  'tip-unreadable':
    'ccrc could not resolve this workspace’s tip commit while its worktree is still here, so it could not pin the commits before deleting them. Nothing was touched.',
  'bad-session-id':
    'That is not a shape a ccrc session id can have, so nothing was looked up and nothing was touched.',
  'flock-unavailable':
    'This box has no flock, so ccrc refused to run a destructive verb without serialising it against a concurrent cleanup.',
  'lock-unopenable':
    'ccrc could not open the cleanup lock for this session, so it refused to act unserialised.',
  'is-a-workspace':
    'This is a workspace, and removing one is audited and confirmed. Use the workspace sheet, or ccd ws-rm.',
  'session-live':
    'This session is still running. Stop it first, then try again.',
  'session-verdict-unknown':
    'tmux did not answer, so ccrc cannot tell whether this session is still running. Nothing was removed.',
  'spawn-failed':
    'The undo landed, but the session did not come back up. The workspace and its branch are intact.',
};

/** Derived from the map — the `PR_REASON_MAP` idiom, so a member added to the
 *  union is a TS2739 rather than a runtime list one short. */
export const LC_REFUSAL_TOKENS: readonly LcRefusalToken[] =
  Object.keys(LC_REFUSAL_WORD) as LcRefusalToken[];

export function isLcRefusalToken(v: unknown): v is LcRefusalToken {
  return typeof v === 'string' && (LC_REFUSAL_TOKENS as readonly string[]).includes(v);
}

/**
 * The word for a journal refusal token, or `null`.
 *
 * NULL IS A POSITIVE ANSWER — "this token is not mine, ask
 * `refusalSentence()`" — and never an error. L0 imports nothing, so it cannot
 * fall through to `wsaudit.ts` itself; the caller composes
 * `lcRefusalWord(t) ?? refusalSentence(t)`. Two maps, one lookup order, no
 * token with copy in both.
 */
export function lcRefusalWord(token: string): string | null {
  return isLcRefusalToken(token) ? LC_REFUSAL_WORD[token] : null;
}

/* --- The journal's names and ceilings. -----------------------------------
 *
 * Every name here has a bash twin in ccd, and the numbers are bound to their
 * twins by `server/test/lifecycle-constants-twin.test.ts`. `LC_SWEEP_MS` is
 * deliberately NOT here: it is a server tick-gate with no bash twin and no
 * wire meaning, and its siblings (`TASK_SWEEP_MS`, `NAME_SWEEP_MS`,
 * `DIVERGENCE_SWEEP_MS`, `MAIL_SWEEP_MS`) all live in `server/src/watch.ts`.
 * One sweep interval in L0 would be a second home for one class of value.
 * ------------------------------------------------------------------------ */

/** `$REG/.lifecycle/`. A DOT-PREFIXED DIRECTORY, and that is the whole
 *  feature: `_reg_purge`'s suffix filter (`ccd:527-536`) globs `$REG/<id>.*`
 *  and ids never begin with a dot, so no id's purge glob matches it — and
 *  `rm -f` cannot take a directory regardless. Precedent already load-bearing:
 *  `$REG/.reaped/` has survived since Aug 6 with zero deleters in 9,815 lines.
 *  ccd's `$REG` inventory comment (`ccd:1536`) today says SEVEN dot-prefixed
 *  artifacts live there; wave 2 amends it to EIGHT — not nine, because
 *  `.rotate.lock` and the generations live INSIDE `.lifecycle/` and are
 *  counted with it exactly as `.reaped/`'s contents are. An inventory a future
 *  reader trusts and a future writer copies is exactly the defect
 *  `_reg_purge`'s own header records having shipped once. */
export const LC_DIR_NAME = '.lifecycle';

/** `journal-<epochNs>.ndjson`. THE GENERATION IS IN THE FILENAME (D1): a
 *  `readdir` alone tells the mirror the whole generation set with no second
 *  read; a rotation is "a new name appeared", never "the same file got
 *  smaller"; and a shrink on an immutably-named generation is unambiguously a
 *  truncation rather than an ambiguity to guess at. */
export const LC_GEN_PREFIX = 'journal-';
export const LC_GEN_SUFFIX = '.ndjson';

/** The counted write-failure file (D7), temp+rename. Surfaced as
 *  `lifecycle.writeErrors` in the fleet health payload, because a silently
 *  stopped journal must not be indistinguishable from a quiet fleet. */
export const LC_ERRORS_NAME = 'errors';

/** `_lc_rotate`'s lock. NEVER UNLINKED, not even as cleanup — "unlinking a
 *  lock file while another process holds it is exactly how two processes come
 *  to hold the lock on two different inodes" (`ccd:1094-1095`), and all four
 *  of ccd's existing lock paths already follow that rule. */
export const LC_ROTATE_LOCK_NAME = '.rotate.lock';

/** Bytes, not characters — the same char-vs-byte care `MAIL_BODY_MAX_BYTES`
 *  (:2498) and `hookstate.ts:128-135` already take. One event per line, LF
 *  terminated. Over-length lines are not truncated silently: the emitter drops
 *  named fields in a stated order and sets `LifecycleEvent.truncated`. */
export const LC_LINE_MAX = 2048;

/** `--reason`'s cap. BYTES, and the policy is REFUSE — an over-cap reason is
 *  declined at the surface that received it, never shortened to fit. A
 *  900-byte reason recorded as 512 reads as the operator's own words, which is
 *  the overloaded-value defect at the one seam whose whole job is to record
 *  what a person said. Free text off the wire: written verbatim, parsed
 *  nowhere. ccd's twin is `_LC_DEC_MAX=512` (wave 3), measured with
 *  `LC_ALL=C` so `${#s}` counts bytes; the two are held equal by
 *  `server/test/lifecycle-constants-twin.test.ts`. */
export const LC_REASON_MAX_BYTES = 512;

/** Rotation: 4 MiB per generation, 4 generations. Measured sizing — ~100 acts
 *  a day at ~350 B is ~35 KB/day, so one generation is about three months and
 *  four about a year. RETENTION IS A CEILING, NOT A SCHEDULE, which is the
 *  answer to "is the flat file really still ground truth". Rotation MINTS A
 *  GREATER NAME and never truncates: `agent/src/tail.ts:53-58` treats a shrink
 *  as a reset and hands its reader an `onReset(size)` it must model, so a
 *  truncating rotation would turn every ordinary roll into a reset. */
export const LC_GEN_MAX_BYTES = 4 * 1024 * 1024;
export const LC_GEN_KEEP = 4;

/** The hard ceiling, DERIVED — 16 MiB is not a second number to keep in step
 *  with the two above. A hand-maintained constant beside a computed pair is
 *  how the pair goes out of step, and the failure is silent. */
export const LC_TOTAL_MAX_BYTES = LC_GEN_MAX_BYTES * LC_GEN_KEEP;

/** `_spawn_settle` emits CHANGE-ONLY — a differing rc, or this long since this
 *  id's last `spawn` line. Without the rule, `Restart=always` across 18
 *  sessions is the whole disk budget. ccd's twin carries 300, in SECONDS;
 *  wave 2 names it and adds its row to the twin test. */
export const LC_SPAWN_QUIET_MS = 300_000;

/**
 * "Is this a generation file at all?" — prefix and suffix only.
 *
 * Deliberately a SEPARATE question from `parseLifecycleGeneration`, because a
 * generation whose name cannot be ordered (a `date +%N` that did not expand
 * would mint `journal-1755000000N.ndjson`) is a file FULL OF REAL EVENTS, not
 * a stray. Collapsing the two into one null would make the mirror ignore it
 * silently; kept apart, `looksLike && !parse` is a gap the reader records.
 */
export function looksLikeGenerationFile(name: string): boolean {
  return name.startsWith(LC_GEN_PREFIX) && name.endsWith(LC_GEN_SUFFIX)
    && name.length > LC_GEN_PREFIX.length + LC_GEN_SUFFIX.length;
}

/** The generation's epoch-nanosecond digits, or null when the name cannot be
 *  ordered. Bounded at 25 digits so a pathological name is refused rather than
 *  compared. */
export function parseLifecycleGeneration(name: string): string | null {
  if (!looksLikeGenerationFile(name)) return null;
  const mid = name.slice(LC_GEN_PREFIX.length, name.length - LC_GEN_SUFFIX.length);
  return /^[0-9]{1,25}$/.test(mid) ? mid : null;
}

/**
 * Orders two parsed generation strings; "greatest name is live" (D1), made a
 * single reader so nobody hand-rolls it — and so nobody reaches for a bare
 * `.sort()` on the filenames, which is the bug below in disguise.
 *
 * BY LENGTH FIRST, and that is the whole point: plain lexicographic compare
 * puts a 20-digit name BEFORE a 19-digit one, so a clock that crossed a digit
 * boundary would make the live generation read as an old one and the mirror
 * would ingest a stale file forever. Equal lengths compare lexicographically,
 * which for digit strings IS numerically — and stays exact past
 * `Number.MAX_SAFE_INTEGER`, which a 19-digit nanosecond epoch is.
 */
export function compareGenerations(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ---------------------------------------------------------------------------
 * PEERS, CLAIMS AND THE DEVIATION LEDGER — build 9, §1 (D9-D14). The fleet's
 * PRESENT TENSE, beside the journal's past tense above.
 *
 * The journal answers "what happened"; this vocabulary answers "who is here,
 * who holds what, and what number is free" — synchronously, at the moment of
 * asking, not at merge (spec §0). Nothing here decides anything on its own:
 * `peerDeliverable()` (server/src/coord/peers.ts, L1) produces `PeerDeliverable`,
 * `decideClaim()` (claims.ts) produces the conflict set, `decideAllocation()`
 * (ledger.ts) produces the numbers, and the one compare-and-swap lives in
 * coord.db's synchronous `tx()` (D11). L0 owns only the words.
 * ------------------------------------------------------------------------- */

/**
 * Can mail reach this peer NOW, as decided by `peerDeliverable()` from the
 * STRUCTURAL rungs of `sweepMail`'s own ladder — registry row measured, tmux
 * verdict, pane pid, lifecycle not stopped/orphan/never-started (D9). The
 * TRANSIENT rungs (cooldown, single-flight latch, unanswered ask, quiet
 * window) stay in `sweepMail`: they are lane state, and reporting them here
 * would tell a caller a BUSY peer is unreachable — the exact lie R2 forbids.
 *
 * THREE ANSWERS, NOT TWO. `'unknown'` is a registry this pass could not
 * measure, and it is NOT `'no'` — doubt about a peer is not evidence against
 * it, the same not-knowing-is-not-death ruling `renewClaims` applies to
 * leases (D12). A `'no'` always carries its reason (`no:stopped`,
 * `no:orphan`, ...); the template type cannot refuse an EMPTY reason, so
 * `isPeerDeliverable` does — an unexplained no is the overloaded value this
 * file's own seam rule forbids, not a shorter one.
 *
 * The reason suffix is OPEN on the wire, deliberately: a newer server naming
 * a rung this build has not met still parses here (absence-permits, one
 * reader). The PRODUCER is held to the ladder by
 * `deliverability-parity.test.ts` (D9), never by this type.
 */
export type PeerDeliverable = 'yes' | 'unknown' | `no:${string}`;

export function isPeerDeliverable(v: unknown): v is PeerDeliverable {
  if (v === 'yes' || v === 'unknown') return true;
  return typeof v === 'string' && v.startsWith('no:') && v.length > 'no:'.length;
}

/**
 * One row of `GET /api/peers` (D9) — a same-project session as the route
 * measured it THIS pass. The route reports; it never filters: `archivedAt`
 * is the registry stamp VERBATIM and decides nothing, because a field that
 * is silently false (four measured rows at design time) must not be
 * laundered into a filter. `archivedStale` NAMES the contradiction —
 * stamped archived, measured live — the same lie `divergence.archived-but-live`
 * names from the supervisor heartbeat, by a different measurement; an
 * adapter may not narrow a distinction it received.
 *
 * `lifecycle` is the row's OWN present tense (etiquette rule 3: read it,
 * never the stamp) and is never null — `'unmeasurable'` is the honest word
 * when the ladder could not run, and a route that measured nothing reports
 * that word, not an absence. `intent` is the holder's most recently renewed
 * live claim's stated intent — the REPLACEMENT (D12) for the ai-title
 * signal `sweepNames` freezes on held rows: a branch name is written once,
 * an intent can be written every ten minutes. Null = no live claim; one
 * condition, not an overload.
 */
export interface PeerSummary {
  readonly id: string;
  /** From `$REG/<id>.uuid`; null = unmeasured, never "no uuid". */
  readonly uuid: string | null;
  readonly project: string | null;
  /** The worktree slug; null for a project's main checkout —
   *  `FleetSession.workspace`'s exact contract (:37). */
  readonly workspace: string | null;
  readonly branch: string | null;
  readonly wrapper: string | null;
  readonly lifecycle: SessionLifecycle;
  readonly deliverable: PeerDeliverable;
  /** Epoch SECONDS as the registry wrote it, verbatim, or null. DECIDES
   *  NOTHING (D9). No `archivedReason` rides beside it, deliberately:
   *  `readRegistry` parses no `.archivedreason`, so no producer exists, and
   *  a declared-but-never-sent field invites reading its absence as "never
   *  archived" — the overloaded null the seam rule forbids. The reason
   *  lives where it is measured: `LifecycleMeas.archivedReason`. */
  readonly archivedAt: number | null;
  /** Stamped archived AND measured live this pass. */
  readonly archivedStale: boolean;
  /** The `.hold` text verbatim, or null — `FleetSession.held`'s contract. */
  readonly held: string | null;
  readonly intent: string | null;
}

/**
 * The five rules, one per primitive — claims, discovery, history, mail, the
 * ledger. THE PRIMARY HOME IS THE ROUTE RESPONSE (D17): a skill reaches a
 * config dir only once its installer has run there (D-107), so a session
 * that can discover peers is handed the rules in the same answer, installer
 * or no installer — and this text cannot go stale relative to the route
 * that serves it. Worker clause 11 and coordinator clause 10 SAY these
 * rules in their own words; they do not define them.
 *
 * QUOTABLE IN BOTH SKILL STYLES, AND THAT IS A GUARD, NOT A PREFERENCE
 * (D17, D-104): worker clauses are double-quoted bash literals — no `"`
 * character may appear in a rule — and coordinator clauses are
 * single-quoted — apostrophes must be curly, as `LC_REFUSAL_WORD`'s copy
 * above already writes them. `peers-claims-l0.test.ts` holds both, so a
 * rule edited into unquotability reds here before a skill wave trips on it.
 */
export const PEER_ETIQUETTE = [
  'Claim before you edit: POST /api/claims names every path you will touch, all-or-nothing, and a 409 names the holder — the 409 is the address, not a rejection to work around.',
  'Discovery is GET /api/peers?of=<your id> — the peers you cannot see from your own session list are the ones this route exists for.',
  'History is GET /api/lifecycle. Read each row’s own lifecycle, never its archive stamp — the stamp is reported verbatim and decides nothing.',
  'Peer mail is human-timescale: a busy peer reads it when it next idles, and losing a race is learned from the 409 you are already reading, never from mail.',
  'Never invent a deviation number. POST /api/ledger/deviations allocates; a server you cannot reach is a mechanical blocker to report, not a licence to guess.',
] as const;

/**
 * A claim's four states, AS A TABLE THE TYPE DERIVES FROM — the
 * `MAIL_REJECT_CODES` as-const idiom (:3012) rather than the union-first
 * `PR_REASON_MAP` one. The landed migration puts NO CHECK constraint on
 * `claims.state` (MIGRATIONS[3] declares the column bare `TEXT NOT NULL`):
 * the vocabulary is enforced by the WRITERS — every state the store writes
 * is a literal from this set — and read back through `isClaimState`, never
 * a cast, with the suites pinning both. The array stays the single
 * definition and the type follows it, so a reorder or a rename is still an
 * edit a reviewer sees in one place.
 *
 * `'live'` is the only non-terminal state. The other three are three
 * different ends a reader handles differently (no overloaded terminal):
 * `'released'` — the holder said done, or its run's close did;
 * `'lapsed'` — the lease ran out, `endedBy` says why (a holder measured
 * gone is `'session-gone'`; the 8 h hard cap is what no measurement can
 * extend); `'broken'` — the operator door, `POST /api/claims/:id/break`,
 * the one claims route the claimant is not the one to walk through (D16).
 * LAPSE, DO NOT DELETE (D12): an ended claim is a row with an end, and
 * `GET /api/claims?all=1` shows "held by X until it died". A destroyed
 * claim is destroyed history.
 */
export const CLAIM_STATES = ['live', 'released', 'lapsed', 'broken'] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

export function isClaimState(v: unknown): v is ClaimState {
  return typeof v === 'string' && (CLAIM_STATES as readonly string[]).includes(v);
}

/**
 * One claim as coord.db holds it and `GET /api/claims` reports it.
 * ADVISORY, NEVER ENFORCING (D12) — nothing in ccd knows this row exists
 * (`claims-advisory.test.ts` holds that at zero references), and its loss
 * is FREE by construction: no flat file backs it, every lease is bounded,
 * and the pre-feature state is "no claims". Sessions lose protection,
 * never work.
 *
 * `paths` is the ALL-OR-NOTHING set as claimed: five paths, one conflict,
 * zero acquired. `expiresAt` is the lease `renewClaims` renews while the
 * holder measures RUNNING (registry unmeasurable reads as HELD — doubt is
 * not death); `hardExpiresAt` is NEVER renewed, so doubt cannot hold
 * forever. `endedBy` is display/forensic — `Divergence.detail`'s contract:
 * written by the closer (`'session-gone'`, the run close, the break door),
 * parsed back by nothing.
 */
export interface ClaimSummary {
  /** coord.db's own row id — the `:id` of release and break. */
  readonly id: number;
  readonly project: string;
  readonly paths: readonly string[];
  readonly heldBy: string;
  readonly heldByUuid: string | null;
  /** <= `CLAIM_INTENT_MAX_BYTES`; re-POSTing the same paths re-writes it
   *  AND renews the lease. Rendered on `PeerSummary`, the HotFilesStrip
   *  and the session line — the signal that replaces the frozen ai-title
   *  (D12). */
  readonly intent: string;
  readonly runId: number | null;
  readonly state: ClaimState;
  /** Epoch ms, the SERVER's clock — a claim exists only in coord.db, so
   *  for once the server's clock IS the event's clock. */
  readonly createdAt: number;
  readonly renewedAt: number;
  readonly expiresAt: number;
  readonly hardExpiresAt: number;
  readonly endedAt: number | null;
  readonly endedBy: string | null;
}

/**
 * One entry of the 409's conflict list — `POST /api/claims` refuses
 * all-or-nothing and names EVERY conflicting path, not the first (D12).
 *
 * THE CONFLICT RESPONSE IS ITSELF AN ADDRESS: the measured conflict record
 * proves awareness alone does not prevent a collision (spec §0, class 8),
 * so the mechanism does not stop at telling you — it hands you the
 * envelope. `mailHint` is pre-addressed to the holder; it is null exactly
 * when `deliverable` answers `'no:<reason>'` — the hint degrades to
 * "escalate to the operator", never to a silent send. An `'unknown'` peer
 * keeps its envelope: doubt is not undeliverability (D9).
 *
 * `path` is what the REQUEST asked for; `claimedPath` is the standing
 * claim's path it collided with. They differ under directory containment —
 * `shared/api.ts` collides with a claim on `shared/` and vice versa, which
 * no index can express and is why the in-transaction read is the CAS
 * (D11).
 */
export interface ClaimConflict {
  readonly path: string;
  readonly claimedPath: string;
  readonly claimId: number;
  readonly heldBy: string;
  readonly heldByUuid: string | null;
  readonly intent: string;
  readonly runId: number | null;
  readonly expiresAt: number;
  readonly deliverable: PeerDeliverable;
  readonly mailHint: { readonly toId: string; readonly subject: string } | null;
}

/**
 * The deviation ledger's two STORED states. `'stale'` is deliberately not
 * here: a number allocated and never landed for `LEDGER_STALE_MS` is
 * REPORTED, never marked — D13 says "marks allocated → landed" but only
 * "reported" for stale, and D4's doctrine settles the difference: a fact
 * about a row and a clock is DERIVED BY THE READER, never stored, so it
 * cannot disagree with its own inputs, and a stale number that finally
 * lands needs no un-marking transition nothing else has.
 */
export const DEVIATION_ALLOC_STATES = ['allocated', 'landed'] as const;
export type DeviationAllocState = (typeof DEVIATION_ALLOC_STATES)[number];

export function isDeviationAllocState(v: unknown): v is DeviationAllocState {
  return typeof v === 'string' && (DEVIATION_ALLOC_STATES as readonly string[]).includes(v);
}

/**
 * One allocated deviation number, as `GET /api/ledger` reports it. The row
 * is AUTHORITATIVE with a flat-file ground truth (D8): appended to
 * `~/.ccrc/ledger-alloc.log` FIRST, committed SECOND, recovered as
 * `MAX(file, db)` — a number is skipped, never reissued. Gaps cost
 * nothing (the ledger is prose, parsed by nothing); a reissue cost 394
 * rewritten D-ref lines across 30 files under merge pressure.
 *
 * `'landed'` means the number appears in a plan in the MAIN checkout
 * (`sweepLedgerReconcile`) — genuinely merged, the signal the incident
 * lacked. `stale` is DERIVED at read time from `allocatedAt`, `state` and
 * the clock, never stored (see `DEVIATION_ALLOC_STATES`); it rides the
 * wire so a phone can see it without owning a clock policy.
 */
export interface DeviationAllocation {
  readonly project: string;
  /** The number itself — `PRIMARY KEY (project, n)` in the mirror, the
   *  loud backstop if a refactor ever loses the transaction (D11). */
  readonly n: number;
  readonly title: string;
  readonly allocatedTo: string;
  readonly runId: number | null;
  /** Epoch ms, the server's clock — like `ClaimSummary.createdAt`, the
   *  allocator lives only on the server, so its clock is the event's. */
  readonly allocatedAt: number;
  readonly state: DeviationAllocState;
  readonly landedAt: number | null;
  /** The plan file reconcile found the number in, repo-relative; null
   *  until landed. */
  readonly landedIn: string | null;
  readonly stale: boolean;
}

/* --- The present tense's numbers. ----------------------------------------
 *
 * All milliseconds unless the name says BYTES, and every one lives HERE and
 * nowhere else — `single-definition.test.ts`'s standing rule. Unlike the
 * journal's ceilings above, none of these has a bash twin: ccd never sees a
 * claim, a quota or the ledger (D12's advisory ruling), so there is no twin
 * test to keep in step. (The peer-mail pair, `PEER_MAIL_MAX_OUTSTANDING`
 * and `PEER_MAIL_HOURLY`, landed with wave 0 beside the mail vocabulary
 * above — same family, earlier commit.)
 * ------------------------------------------------------------------------ */

/** A claim's lease. Renewed by `renewClaims` on FleetWatcher's EXISTING
 *  tick while the holder measures RUNNING; a holder measured gone lapses at
 *  the standing expiry with `endedBy:'session-gone'`; a registry this pass
 *  could not measure reads as HELD — doubt is not death, matching ccd's
 *  four `-e` hold readers and `registry.ts`'s `HOLD_UNREADABLE` (D12).
 *  There is no session-side heartbeat, deliberately: a protocol a model
 *  must remember is a protocol that will be forgotten, and the failure is
 *  a wedged module. */
export const CLAIM_LEASE_MS = 45 * 60_000;

/** The horizon no renewal moves (D12). Doubt cannot hold forever: every
 *  claim must be periodically re-declared (re-POSTing the same paths renews
 *  AND re-states intent), and eight hours outlasts any honest wave. */
export const CLAIM_HARD_CAP_MS = 8 * 60 * 60_000;

/** `intent`'s cap, BYTES — the same number and the same char-vs-byte care
 *  as the journal's `LC_REASON_MAX_BYTES` above, and a SEPARATE constant on
 *  purpose: that one is ccd's `--reason` contract with a bash twin, this
 *  one is a server-only route contract, and tying them would let a ccd cap
 *  change silently rewrite a route's refusal threshold. Policy is REFUSE,
 *  never truncate, for `LC_REASON_MAX_BYTES`'s own stated reason. */
export const CLAIM_INTENT_MAX_BYTES = 512;

/** `POST /api/claims`' remaining wire caps — BYTES where the name says
 *  bytes, the `MAIL_BODY_MAX_BYTES` char-vs-byte care, and the same
 *  refuse-never-truncate policy as `CLAIM_INTENT_MAX_BYTES` directly above:
 *  a trimmed path is a DIFFERENT path, and a claim on a path the caller did
 *  not name is worse than a 413. Thirty-two entries outlasts any honest
 *  wave's hot-file set; a bigger one is a claim on the module wedge by
 *  another spelling. */
export const CLAIM_PATHS_MAX = 32;
export const CLAIM_PATH_MAX_BYTES = 512;

/** `floor = max(D-<n> found in the docs scan) + this` (D13). NOT
 *  decoration: numbers allocated but not yet written into any plan are
 *  invisible to the scan, and re-issuing one IS the measured failure.
 *  Burning fifty integers costs nothing. */
export const LEDGER_SEED_GAP = 50;

/** An `'allocated'` row older than this and never landed is REPORTED stale
 *  (derived, never stored — see `DEVIATION_ALLOC_STATES`) and NEVER
 *  reclaimed (D13). */
export const LEDGER_STALE_MS = 7 * 24 * 60 * 60_000;

/** `title`'s cap, BYTES — `MAIL_SUBJECT_MAX_BYTES`'s number and its
 *  char-vs-byte care, and a SEPARATE constant for `CLAIM_INTENT_MAX_BYTES`'s
 *  stated reason: tying two seams' caps together lets a change to one
 *  silently rewrite the other's refusal threshold. What earns a one-line
 *  title its own cap is the MULTIPLIER behind it: `LedgerLog.append` writes
 *  one line PER ALLOCATED NUMBER, each carrying the full title, into an
 *  append-only file nothing ever deletes from — so an uncapped title rides
 *  out up to `LEDGER_ALLOC_MAX` times per request (`coord/ledger.ts`).
 *  Policy is REFUSE, never truncate: a trimmed title is a different sentence
 *  in the durable record. */
export const LEDGER_TITLE_MAX_BYTES = 200;
