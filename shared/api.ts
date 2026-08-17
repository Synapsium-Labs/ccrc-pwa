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
 *  and rendered with different words. */
export type PrChecks = 'pass' | 'fail' | 'pending' | null;

/**
 * Why a `PrState`'s phase is `unknown`. Every member but `merge-unproven` is a
 * FAILED READ; `merge-unproven` is the opposite — GitHub answered fine and said
 * MERGED, and a conjunct of the merge predicate did not hold, so ccrc declines
 * to call it merged. It exists because `error` renders as "GitHub could not be
 * read", which in that case is simply untrue.
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
  | 'merge-unproven';

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
  'merge-unproven': true,
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
   *  vocabulary is defined and where a tenth member is added. Null when the
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
  id: string; branch: string; base: string; workdir: string; project: string; repo: string;
  exists: boolean; headMatchesRegistry: boolean; reaping: string | null;
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
   *  (ccd:3106/3109) answered a failed `du`/`stat` with `0` for as long as this
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
   *  base", which is what `_pr_state_one` (ccd:1650) already refuses to
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
  reaped?: string; branch?: string; pr?: number | null; proof?: string;
  tombstone?: string; attic?: number; bytes?: number | null; resumed?: string | null;
  refused?: string; detail?: string; paths?: string[];
  indeterminate?: boolean;
  sentence: string;
}

/** `$REG/.reaped/<id>.json` — the record that OUTLIVES the workspace.
 *
 *  DECLARED HERE THOUGH NOTHING IMPORTS IT YET, which is the point and is the
 *  cross-lane seam pass's residual #1 closed: `clips[].bytes: null` reaches
 *  `_ws_tombstone` (ccd:3199) and is round-tripped by `_ws_tombstone_reclip`
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
  id: string; project: string; workdir: string; branch: string; base: string; tip: string;
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
 * (`ccd:2178-2185`), but `ccd start`/`ccd ensure` clear `.stopped` and
 * `.swapblocked` on a deliberate revival and leave `$REG/<id>.archived`
 * standing — only `ws-restore` removes it (`ccd:2513`). So a workspace
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
 * THREE KINDS, and the four that were proposed and rejected are named here so
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
 */
export type DivergenceKind =
  | 'unregistered-worktree'   // git records a worktree no registry row claims
  | 'branch-drift'            // registry `.branch` != the worktree's own HEAD
  | 'claim-divergence';       // a hold with no open run, or an open run with no hold
const DIVERGENCE_KIND_MAP: Record<DivergenceKind, true> = {
  'unregistered-worktree': true, 'branch-drift': true, 'claim-divergence': true,
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
const CHECKS: readonly string[] = ['pass', 'fail', 'pending'];
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
      // `lifecycleRaw` is already narrowed to `SessionLifecycle | null` by the
      // guard above — no cast.
      lifecycle: lifecycleRaw,
      stoppedBy: reviveStoppedBy(o, 'stoppedBy'),
      swapBlocked: reviveSwapBlocked(o, 'swapBlocked'),
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
 * Computed in `server/src/transcript/parse.ts`, not here (D-B4-12): L0 imports
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
 * The same envelope, as a FETCH returns it — the live lane (W-1 / D-B4-23).
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
 * ccd's own three-answer ladder (`ccd/ccd:2018-2035`). A fact the server could
 * not re-measure must never read as a fact that matched. `registry-unmeasurable`
 * (D-37) is the INGRESS member of the same family: a `readRegistry` that could
 * not list its directory, or that dropped a listed row for an unreadable
 * sibling field, is not evidence the sender or recipient does not exist — see
 * `coord/routes.ts`'s checks 5/6/7 for where this is measured.
 */
export const MAIL_REJECT_CODES = [
  // ingress
  'unauthenticated', 'unknown-sender', 'stale-uuid', 'registry-unmeasurable',
  'unknown-recipient', 'unknown-run', 'oversize', 'bad-kind',
  // delivery
  'undeliverable',
  // done-authority
  'stale-tip', 'tip-unmeasurable', 'pr-regressed', 'pr-unmeasurable', 'no-handoff-commit',
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
 * tokens) — `paused`, a member of this very union, is invisible to it. Twelve
 * codes exist below today; the next new one would be the thirteenth, not the
 * ninth.
 *
 * The last two are the ledger's (Build 4, spec §3.2): `unknown-item` — "an
 * item id that is not THIS RUN's", 404 — and `item-terminal` — the item
 * already settled, 409, refused rather than silently applied.
 */
export type RunRefuseCode =
  | 'claimed-by-another' | 'paused' | 'mail-disabled' | 'cap-concurrency' | 'cap-daily'
  | 'ambiguous-dispatch' | 'worker-busy' | 'not-dispatched' | 'prhistory-unreadable'
  | 'bad-transition' | 'unknown-item' | 'item-terminal';

const RUN_REFUSE_CODE_MAP: Record<RunRefuseCode, true> = {
  'claimed-by-another': true, paused: true, 'mail-disabled': true, 'cap-concurrency': true,
  'cap-daily': true, 'ambiguous-dispatch': true, 'worker-busy': true, 'not-dispatched': true,
  'prhistory-unreadable': true, 'bad-transition': true, 'unknown-item': true, 'item-terminal': true,
};
export const RUN_REFUSE_CODES: readonly RunRefuseCode[] = Object.keys(RUN_REFUSE_CODE_MAP) as RunRefuseCode[];

/** The validator that goes with the list — `isPrReason`'s own shape and the
 *  same reason: `unknown` in, so nothing is smuggled past by claiming it is
 *  already a code, and the CONSTANT is cast rather than the input. */
export function isRunRefuseCode(v: unknown): v is RunRefuseCode {
  return typeof v === 'string' && (RUN_REFUSE_CODES as readonly string[]).includes(v);
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
  /** Deviation D-1: wave >= 2 resumes its session (no ccd verb can spawn
   *  fresh into an existing workspace) and the dispatch route then injects
   *  /clear through the send path, so the context is fresh even though the
   *  pane was resumed. clearedAt below is the proof the second step ran. */
  resumed: boolean;
  clearedAt: number | null;
  openedAt: number;
  dispatchedAt: number | null;
  closedAt: number | null;
  handoffCommit: string | null;
  items: RunItemTally;
  /** Unacked mail addressed to this run's session. */
  unreadMail: number;
}

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

/** Attachment paths first, each on its own line, then the user's text. Paths
 *  lead so the transcript reads image-above-caption. */
export function composePrompt(text: string, attachments: readonly string[]): string {
  return [...attachments, text].filter((part) => part !== '').join('\n');
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
