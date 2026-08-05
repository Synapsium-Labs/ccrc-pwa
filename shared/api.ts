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
  /** Hook-reported attention state, straight from `~/.cc-sessions/<id>.hookstate.json`
   *  (see `hookstate.ts`'s `readHookState`). Null means NO FRESH HOOK DATA —
   *  a hookless session, a stale file the freshness gate rejected, or a
   *  restarted session whose uuid moved on — never a fourth state. */
  hookState: 'working' | 'waiting' | 'done' | null;
  /** One line for the fleet card, derived from a `waiting` hook state's `ask`
   *  envelope (`fleet.ts`'s `hookAskSummary`). Null unless `hookState` is
   *  `'waiting'` AND an ask envelope actually landed — a hook can report
   *  waiting before the ask write completes. */
  askSummary: string | null;
  /** Subagents the hook last reported running. Null mirrors `hookState`: no
   *  fresh hook data at all. `[]` is a MEASUREMENT — fresh hook data, zero
   *  subagents running — same null-vs-empty-array discipline as `WsAudit`'s
   *  array fields above. */
  subagents: { name: string; startedAt: number }[] | null;
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

/** `ccd ws-audit --session <id>`, with a server-added `sentence`. `token` is
 *  present ONLY when `verdict === 'reapable'`; the client sends it back as
 *  `expect`, and ccd re-proves the world state matches it. */
export interface WsAudit {
  id: string; branch: string; base: string; workdir: string; project: string; repo: string;
  exists: boolean; headMatchesRegistry: boolean; reaping: string | null;
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
  merge: { proof: 'ancestor' | 'tree' | 'patch-id' | 'cherry' | null; fetchedAt: number | null };
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
// Same shape as CHECKS, not PR_PHASES: `hookState` is already nullable and
// null already has a specific meaning ("no fresh hook data"), so an
// unrecognised token has nowhere honest to degrade to — landing it on null
// would claim "nothing was recorded" about a file that in fact recorded
// something this build cannot parse. Reject the whole snapshot instead, the
// same stance `checks` takes for the identical reason.
const HOOK_STATES: readonly string[] = ['working', 'waiting', 'done'];
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
      hookState: hookStateRaw as FleetSession['hookState'],
      askSummary: optStr(o, 'askSummary'),
      subagents: optSubagents(o, 'subagents'),
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

const PROOFS: readonly string[] = ['ancestor', 'tree', 'patch-id', 'cherry'];
type AuditMerge = { proof: 'ancestor' | 'tree' | 'patch-id' | 'cherry' | null; fetchedAt: number | null };
/** `WsAudit.merge` — `proof` is a closed vocabulary (the four ways
 *  `_pr_state_one` can corroborate a merge), validated the same way
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
  | { type: 'backlog'; uuid: string; events: ChatEvent[]; offset: number; file: string; missing: boolean }  // missing=true → transcript file not found at `file`; UI shows a diagnostic banner
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
  | { type: 'ask'; ask: HookAsk }
  | { type: 'ask_cleared' }                       // the hook's ask went null, stale, or its hookstate file is gone
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
