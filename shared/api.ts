// Shared API types — single source of truth between ccrc-server and the PWA.

export type SessionStatus = 'busy' | 'idle' | 'dead';

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

/** `ccd ws-audit --session <id>`, with a server-added `sentence`. `token` is
 *  present ONLY when `verdict === 'reapable'`; the client sends it back as
 *  `expect`, and ccd re-proves the world state matches it. */
export interface WsAudit {
  id: string; branch: string; base: string; workdir: string; project: string; repo: string;
  exists: boolean; headMatchesRegistry: boolean; reaping: string | null;
  dirty: string[];
  ignored: { path: string; bytes: number; sensitive: boolean }[];
  ignoredCount: number; ignoredBytes: number;
  sensitive: string[];
  /** How many secret-SHAPED names the F3 refinement filtered as vendored or
   *  template noise (`credentials.d.ts`, `.env.example`, …) rather than
   *  treating as sensitive — a count, never a silent drop, so a wrong filter
   *  is something anyone can notice from the audit's own output. */
  sensitiveFiltered: number;
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
   *  `worktreeBytes` below and `archivedBytes` on the archive sheet. */
  clips: { name: string; bytes: number | null }[];
  /** `null` when `du` could not read the whole worktree — even partially, even
   *  a subdirectory — never a fabricated (and possibly ten-times-too-small)
   *  number (pre-merge fix round, finding F; deviation 10's rule). This is the
   *  figure `ReapSheet.tsx`'s confirm button prints before a destructive
   *  action, so it must say "unknown" rather than a number it cannot stand
   *  behind. */
  stashes: number; worktreeBytes: number | null; commitsAheadOfBase: number;
  pr: { number: number | null; url: string; mergeCommit: string; headRefOid: string };
  merge: { proof: 'ancestor' | 'tree' | 'patch-id' | 'cherry' | null; fetchedAt: number };
  transcript: string;
  verdict: string; detail: string; token?: string;
  sentence: string;
}

/** `ccd ws-reap`. Exactly one of `reaped`, `refused` or `indeterminate` is set. */
export interface ReapResult {
  reaped?: string; branch?: string; pr?: number | null; proof?: string;
  tombstone?: string; attic?: number; bytes?: number; resumed?: string | null;
  refused?: string; detail?: string; paths?: string[];
  indeterminate?: boolean;
  sentence: string;
}

/* ---------------------------------------------------------------------------
 * Snapshot revival — reading a FleetSession[] that an OLDER BUILD persisted.
 *
 * The skew is across TIME, not across the wire: the server serves the PWA it
 * was built with, so a `/ws/fleet` frame always comes from this build. Two
 * snapshots do not — `ccrc.fleet-snapshot.v1` in localStorage
 * (pwa/src/lib/offline.ts) and `~/.ccrc/state-cache.json`
 * (server/src/fleetstate.ts) are read back by whatever build starts next.
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
// The reason list is NOT restated here (integration finding 7). It was the
// second of four copies; it is now `isPrReason`, over `PR_REASONS`, which is
// derived from the union. The comment above about casting the constant rather
// than the input is exactly why a predicate is the right shape for it.

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

    return {
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

/** `/api/fleet/health` — degraded-mode signal for the remote fleet host.
 *  `mode: 'local'` is always `{connected: true, downSince: null}` — there is
 *  no separate fleet host to lose. */
export interface FleetHealth {
  mode: 'local' | 'remote';
  connected: boolean;
  downSince: number | null;   // epoch ms since the agent connection dropped
}

/** One account's usage, read from telemetry (cc-limits) independent of whether a
 *  session is currently on it — so the display survives restarts/respawns/swaps.
 *  `ts` is epoch seconds of the last report. Telemetry is a byproduct of a
 *  session rendering its statusline, so an idle account simply stops reporting —
 *  which is why the rolledOver flags exist. */
export interface AccountUsage {
  wrapper: string;
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
 *  tap is the entire point of showing it. */
export interface ProjectedHome {
  wrapper: string;
  score: number;
}

/** A `/`-command the composer can autocomplete. `insert` is what gets typed
 *  (with a trailing space so arguments follow naturally). */
export interface SlashCommand {
  name: string;                 // e.g. "compact" or "superpowers:brainstorming"
  desc: string;
  kind: 'builtin' | 'skill';
}

export type ChatEvent =
  | { kind: 'user'; uuid: string; ts: string; text: string }
  | { kind: 'assistant'; uuid: string; ts: string; text: string }
  | { kind: 'tool_use'; uuid: string; ts: string; toolId: string; name: string; input: string }
  | { kind: 'tool_result'; ts: string; toolId: string; text: string; isError: boolean }
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

export type SessionStreamMsg =
  | { type: 'backlog'; uuid: string; events: ChatEvent[]; offset: number; file: string; missing: boolean }  // missing=true → transcript file not found at `file`; UI shows a diagnostic banner
  | { type: 'events'; uuid: string; events: ChatEvent[]; offset: number }
  | { type: 'status'; status: SessionStatus; statusUpdatedAt: number | null }
  | { type: 'dialog'; dialog: Dialog }            // a pane menu is awaiting an answer
  | { type: 'dialog_cleared' }
  | { type: 'tasks'; tasks: TaskItem[] }          // the session's task list changed (or first read)
  | { type: 'rotated'; uuid: string }             // transcript switched (clear/compact/swap) — client refetches
  | { type: 'notice'; message: string };

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
