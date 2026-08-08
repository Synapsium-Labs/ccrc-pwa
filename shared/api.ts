// Shared API types — single source of truth between ccrc-server and the PWA.

export type SessionStatus = 'busy' | 'idle' | 'dead';

/** Which attention bucket a session belongs to. THE authority: the fleet
 *  screen's sections, its counts and the row's own state word all read this one
 *  field, so they cannot disagree. Computed by `sessionBucket` below — which
 *  the server runs on every assembled session, and which `reviveFleetSession`
 *  runs on a cached snapshot that predates the field. */
export type SessionBucket =
  | 'attention' | 'working' | 'done' | 'idle' | 'cleanup' | 'archived' | 'dead';

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
  bucket: SessionBucket;
  /** Epoch ms this session ENTERED `bucket`, as evidenced by the underlying
   *  record — never a watcher's memory of when it noticed, which would reset on
   *  every restart and paint the whole fleet as freshly-unseen after a deploy.
   *  Null when no evidence exists. Drives the PWA's unseen watermark. */
  bucketSince: number | null;
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
 * `hookUpdatedAt` is read ONLY by `bucketSince`; no branch's BUCKET depends on
 * it. That is what lets `reviveFleetSession` call this with `null` and keep the
 * bucket while discarding the timestamp.
 */
export function sessionBucket(
  s: BucketInput,
  hookUpdatedAt: number | null,
): { bucket: SessionBucket; bucketSince: number | null } {
  // `archivedAt` is epoch SECONDS (ccd writes `$REG/<id>.archived` as an epoch);
  // every other timestamp on this record is epoch ms.
  if (s.archivedAt !== null) {
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
  // NOT the hook's timestamp: the hook rewrites `updatedAt` on every
  // PostToolUse, so a busy session would report a continuously-refreshed
  // "since" — permanently new, and permanently badged.
  if (s.status === 'busy') return { bucket: 'working', bucketSince: s.statusUpdatedAt };
  // `done` requires hook EVIDENCE: a hookless busy→idle transition never proves
  // a turn finished rather than never starting. It also decays for free —
  // hookstate.ts's 30-minute freshness gate nulls `hookState`, so an
  // unacknowledged `done` falls back to `idle` instead of accumulating.
  if (s.hookState === 'done') return { bucket: 'done', bucketSince: hookUpdatedAt ?? s.statusUpdatedAt };
  return { bucket: 'idle', bucketSince: s.statusUpdatedAt };
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

    // See `BUCKETS`' own comment for the full reasoning — absent derives from
    // the rest of this record, unrecognised rejects. Validated HERE, before the
    // record is built, so an unrecognised token still rejects without the
    // ladder ever running on it.
    const bucketRaw = optStr(o, 'bucket');
    if (bucketRaw !== null && !BUCKETS.includes(bucketRaw)) throw new MalformedSnapshot('bucket');

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

/** The three accounts a session may call HOME — mirrors ccd's `VALID_WRAPPERS`
 *  (ccd:14). `gpt` is deliberately absent: it is a 4th, opt-in-only lane a
 *  session reaches solely by being sent there on purpose, never as a landing
 *  spot chosen for it. Single source of truth for `server/src/limits.ts`'s
 *  `projectHome` (which home-able lanes to score) and
 *  `pwa/src/lib/accounts.ts`'s `homeAbleLabelList` (the same three, spelled
 *  out by label) — both used to hand-maintain their own copy of this list,
 *  linked only by a doc comment referencing the other. */
export const HOME_ABLE_WRAPPERS = ['claude', 'claude2', 'claude-corp'] as const;

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
 *  tap is the entire point of showing it.
 *
 *  On the wire (`GET /api/accounts`'s `projected` field) this is
 *  `ProjectedHome | null`: `null` iff every home-able lane carries the
 *  `<wrapper>-disabled` marker, mirroring `_ws_least_loaded`'s own empty
 *  stdout for the same case — nothing is placeable, and naming an account
 *  anyway would be a display lying about what a tap would actually do. */
export interface ProjectedHome {
  wrapper: string;
  score: number;
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
  | { type: 'runs'; runs: RunSummary[] };

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
  | { type: 'ask'; ask: HookAsk; key: string | null }   // key: answerable via POST /api/sessions/:id/ask; null for approval envelopes
  | { type: 'ask_cleared' }                       // the hook's ask went null, stale, or its hookstate file is gone
  | { type: 'tasks'; tasks: TaskItem[] }          // the session's task list changed (or first read)
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
  kind: 'ask' | 'done' | 'merged';
  sessionId: string; title: string; body: string;
}

/** `resync: true` means "I cannot prove you saw everything" — the epoch moved,
 *  or the client's seq predates what is still retained. The client's answer is
 *  to drop its watermark and trust the fleet snapshot, never to fabricate
 *  badges for events it cannot enumerate. */
export interface CatchUp { epoch: string; seq: number; resync: boolean; events: NotifyEvent[] }

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
 */
export const RUN_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = Object.freeze({
  planned:           ['dispatched', 'failed'],
  dispatched:        ['working', 'failed'],
  working:           ['awaiting-review', 'failed'],
  'awaiting-review': ['merging', 'working', 'failed'],
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
 * Every way the coordination layer can say no, enumerated in one place and
 * pinned in BOTH directions by `mail-routes.test.ts` (every code here is
 * emitted somewhere in `server/src/coord/`, and every code emitted there is
 * here). Orca's rule, adopted: a stale `worker_done` can never settle a run,
 * because the refusal is typed and the run state is unchanged.
 *
 * Groups, and they are not interchangeable:
 *  - INGRESS (spec:145-147): the message never becomes a `mail` row.
 *  - DELIVERY: the mail row is intact; only this delivery is parked.
 *  - DONE-AUTHORITY (spec:127-132): the claim is rejected, the run is unchanged.
 *
 * `tip-unmeasurable`/`pr-unmeasurable` exist because NOT KNOWING IS NOT `[]` —
 * ccd's own three-answer ladder (`ccd/ccd:2018-2035`). A fact the server could
 * not re-measure must never read as a fact that matched.
 */
export const MAIL_REJECT_CODES = [
  // ingress
  'unauthenticated', 'unknown-sender', 'stale-uuid', 'unknown-recipient',
  'unknown-run', 'oversize', 'bad-kind',
  // delivery
  'undeliverable',
  // done-authority
  'stale-tip', 'tip-unmeasurable', 'pr-regressed', 'pr-unmeasurable', 'no-handoff-commit',
] as const;
export type MailRejectCode = (typeof MAIL_REJECT_CODES)[number];

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
  id: number;
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
