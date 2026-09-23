# Cross-wave interface contract — programme `child-reclamation`

This file is the authority every wave plan cites as "contract §N". Sections 1–6 were written before the
plans; sections 7 and 8 are the rulings made after reading them, and they amend 1–6 where they overlap.

Authority order: the operator's rules (spec §1) > the spec > THIS contract > a scout report > a plan drafter's
judgement. This contract exists so five plans drafted in parallel use one set of names. Where a plan needs a
name, type, token, flag or file that crosses a wave boundary, it uses EXACTLY the one below. A plan may add
private helpers of its own; it may not rename anything here. If a drafter finds something here that is false
against the code, it says so in its return value and does NOT silently diverge.

Spec: `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` (amended 2026-09-22 with
planning refinements — read the CURRENT file). Ledger: `docs/superpowers/programs/child-reclamation.md`.
The six scout reports this contract was written from measured the code at the planning base; they were
planning inputs and are not committed. Every plan re-measures what it relies on.

## 0. Naming

- **ccd surfaces keep the spec's names:** verbs `ws-reclaim` and `reclaim-pause`; the `--reclaim` flag on
  `ws-audit`; the journal act `reclaim`; capability tokens `child-argv-v1`, `reclaim-v1`, `reclaim-pause-v1`;
  registry files `$REG/<id>.child` and `$REG/reclaim-paused`; breadcrumb value prefix `reclaim:`; temp root
  `$HOME/.cc-tmp/<id>`.
- **Every TypeScript identifier, file, CSS class and test file says `childReclaim` / `ChildReclaim` /
  `child-reclaim`.** Never a bare `Reclaim*`/`reclaim*`: `server/src/coord/reclaim.ts`, `ReclaimRefuseCode`,
  `RECLAIM_REFUSE_CODES`, `RECLAIM_COPY` and `POST /api/runs/:id/reclaim` already mean *reassigning a dead
  coordinator's claim*. Exception: the three `*_CAP` constants below, named after their tokens.

## 1. Wave 1 — the marker and containment (AGENT-FIRST; one PR carrying both halves)

**ccd**
- Usage becomes `ccd ws-add [--no-rc] [--child <runId>] [--surface <word>] [--actor <text>] [--route <field>=<value>]... <project> [slug]`.
  `--child` is parsed in `cmd_ws_add`'s EXISTING strip-then-bind loop, both `--child <v>` and `--child=<v>`
  forms, arity-checked like its siblings. `<runId>` must match `^[1-9][0-9]{0,9}$`, else
  `die "--child needs a run id (a positive integer), got: <v>"` BEFORE any worktree, registry row or pane
  exists.
- The marker is written with the existing registry setter: `_reg_set "$id" child "$runId"` →
  `$REG/<id>.child` holding the decimal run id (whatever terminator `_reg_set` writes). Written before the
  spawn, so the first launch already sees it.
- `_spawn_start` (the one spawn function every path uses) composes `TMPDIR=$HOME/.cc-tmp/<id>` into the
  claude launch environment beside the existing `genenv`/`resenv` precedent, **iff** `_reg_get "$id" child`
  is non-empty, after `mkdir -p -m 0700` of that directory. Driven by the MARKER, never by ws-add's argv, so
  every respawn (ensure, start, swap, supervisor restart, ws-restore) keeps it and a non-child never gets it.
- `cmd_caps` echoes `child-argv-v1` in its capability-token block.
- `_reg_purge` already globs `$REG/$id.*`; wave 1 adds a test proving `.child` is collected.

**server**
- `export const CHILD_ARGV_CAP = 'child-argv-v1';` in `server/src/ccdargv.ts`, beside `ROUTE_ARGV_CAP`, with a
  docstring on the D-410 hazard it gates.
- `CCD_ARGV.wsAddWorker(p, dec, route, child: number | null = null)`: when `child !== null` the argv carries
  `'--child', String(child)` IMMEDIATELY AFTER `'--no-rc'`; `null` yields today's argv token for token.
- `dispatchRun`'s fresh-spawn arm: `const child = capSupported(deps.fleetState, CHILD_ARGV_CAP) ? run.id : null;`
  passed to `wsAddWorker`; when `null`, `coord.recordRunEvent(id, 'coordinator', 'child-omitted:no-child-argv-cap')`
  — the `route-omitted:no-route-argv-cap` precedent, same placement. Review runs are dispatched through the same
  arm and are children too.
- `server/test/ccd-archive.test.ts`'s `KNOWN_CAPABILITY_TOKENS` gains `'child-argv-v1'` and a
  `toContain(CHILD_ARGV_CAP)` line; `capsupported.test.ts` gains its spelled-once case. These land in the SAME
  commit as ccd's echo — the parity test reads the real `ccd/ccd`.

**Measurements wave 1 owes** (recorded in the wave-done mail; the coordinator writes them into the ledger):
(a) where Claude Code's scratchpad lands when `TMPDIR` is set — one headless `claude -p` run with `TMPDIR`
pointed at a scratch dir, then `find` under it; (b) the pre-policy count — workspaces with no `.child` marker
on the fleet box at the moment the ccd ships, measured read-only with `ls`.

## 2. Wave 2 — the three-way reading, the spent verdict, the two refusals (server)

**shared/api.ts (L0)**
```ts
/** Whether a registry row is a CHILD (spec §4, §5.1). Three answers, never two: an unreadable or malformed
 *  marker is neither "a child" nor "not a child", and callers act on it in OPPOSITE directions — a bind
 *  REFUSES, a reclaim DEFERS. */
export type ChildMark =
  | { readonly kind: 'none' }                                  // no marker file: not a child
  | { readonly kind: 'child'; readonly runId: number }         // marker names the minting run
  | { readonly kind: 'unreadable' };                           // listed but unreadable, or not a decimal run id
```
- `SessionRecord.child: ChildMark` (server/src/registry.ts), read through `fieldMeasured`, cloned from the
  `held` reader's absent/unreadable ladder. Malformed content → `unreadable`.
- `FleetSession.child: ChildMark` on the wire, computed in `fleet.ts`'s assembly and revived through
  `reviveFleetSession`; ABSENT on a persisted older frame → `{ kind: 'none' }` (a frame from before markers
  existed describes no children).
- `RunRefuseCode` gains `'workspace-spent'` and `'spent-unmeasured'` (19 → 21) with one docstring paragraph
  for the pair, modelled on `project-mismatch`/`home-mismatch`'s; the "Nineteen codes exist below today"
  sentence is updated.
- `server/test/registry.test.ts`'s registry-read census is DERIVED and moves (30/31/721 today per the w2 scout)
  with every tagged citation site it cross-checks — re-measure, never type the new numbers.

**server/src/coord/childSpent.ts** (new)
```ts
export type ChildSpentVerdict =
  | { readonly kind: 'spent'; readonly pr: number; readonly source: 'registry' | 'prhistory' | 'live' }
  | { readonly kind: 'unspent' }
  | { readonly kind: 'unmeasured'; readonly detail: string };
export interface ChildSpentDeps { io: FleetIO; cfg: CcrcConfig; runCcd: Deps['runCcd']; fleetState?: FleetState }
export async function childSpent(deps: ChildSpentDeps, rec: SessionRecord): Promise<ChildSpentVerdict>;
```
Order, exactly: (1) `rec.prNumber !== null` → `spent/registry` (a present number is evidence; a null is
evidence of nothing — the reader collapses absent and unreadable); (2) `readPrHistory` → unreadable →
`unmeasured`; ≥1 entry → `spent/prhistory` with the newest entry's PR; (3) live `CCD_ARGV.prStateSession(id)`
(gated like the existing on-demand route) → phase `open|draft|merged|closed` with a number → `spent/live`;
phase `none|no-commits` → `unspent`; everything else — `unknown`, `branch-drift`, a failure line, a parse
failure, a ccd failure, an unsupported verb — → `unmeasured` with the reason in `detail`.

**server/src/coord/childBind.ts** (new) — the ONE gate both callers use:
```ts
export type ChildBindVerdict =
  | { readonly ok: true }   // not a child (no marker, or no registry row — today's behaviour), or an unspent child
  | { readonly ok: false; readonly code: 'workspace-spent'; readonly pr: number }
  | { readonly ok: false; readonly code: 'spent-unmeasured'; readonly detail: string };
export async function childBindGate(deps: ChildSpentDeps, sessionId: string): Promise<ChildBindVerdict>;
```
`ChildMark` `unreadable` → `spent-unmeasured` with detail `the child marker could not be read`.

**Callers**
- `POST /api/runs` with a string `sessionId`: the gate runs BEFORE `openRun` inserts anything. 409 bodies:
  `{ ok: false, refused: 'workspace-spent', pr }` and `{ ok: false, refused: 'spent-unmeasured', detail }` —
  the route's existing 409 shape.
- `dispatchRun`'s resume arm (`run.sessionId !== null`): the gate runs before `ensure`. `spent-unmeasured`
  refuses and KEEPS the binding (unknown is not spent; retry). `workspace-spent` first runs
  `CCD_ARGV.wsRelease(sessionId, sweepDec(deps.fleetState, \`run:${id} dispatch\`))` (fleet act first, D-48),
  then `coord.clearSession(run.id)`, and returns a NEW `DispatchOutcome` member
  `{ ok: false; kind: 'childSpent'; code: 'workspace-spent' | 'spent-unmeasured'; pr?: number; detail?: string; unbound: boolean }`,
  mapped by the dispatch route to 409 `{ ok: false, refused: code, pr?, detail?, unbound }`.
- `CoordStore.clearSession(runId: number): { ok: true; cleared: boolean }` — ONE transaction:
  `UPDATE runs SET sessionId = NULL, workspace = NULL, branch = NULL WHERE id = ? AND state = 'planned'` plus a
  `recordRunEvent(runId, 'coordinator', 'session-unbound: <sid> (workspace-spent #<pr>)')`. `cleared:false`
  when no row matched.

**Prose (wave 2 owns it, because wave 2 is when the refusals start):** coordinator `SKILL.md`'s refusal
sentence names both codes; `wave-lifecycle.md` §5 explains them and is rewritten for one PR per child: after
a wave that opened a PR, wave N+1 opens WITHOUT `sessionId`; on `workspace-spent` with `unbound:true`,
dispatch again and a fresh child is minted; on `spent-unmeasured`, retry. Coordinator clause 3 is NOT touched
in wave 2.

## 3. Wave 3 — the verb, its token, close's act (AGENT-FIRST; the only destructive wave)

**ccd**
- `ccd ws-audit --session <id> --reclaim [--defer-expired]` — the existing audit's JSON shape plus
  `"mode":"reclaim"` and `"childOf":<runId>`; a `"token":"<64 hex>"` ONLY when the reclaim ladder passes.
  `ccd ws-audit --session <id>` with no flag stays byte-identical. The existing grant `['ws-audit','--session']`
  already covers the new argv — NO new audit grant.
- `ccd ws-reclaim --expect <64 hex> --child-of <runId> --session <id> [--defer-expired] [--surface <w>] [--actor <t>] [--reason <t>]`.
  stdout is one JSON line. Success: `{"reclaimed":"<id>","childOf":<runId>,"wip":"<40 hex>"|null,"attic":<n>,"residueBytes":<n>|null}`.
  Refusal: `{"refused":"<token>","detail":<json str>,"paths":[...]}` at exit 0 — `ws-reap`'s shape, so the
  existing token harvest sees every literal. Usage errors `die` (rc 1).
- `--defer-expired` skips rungs 5 (`attached`) and 6 (`tree-busy`) and NOTHING else, and is an input to the
  fingerprint.
- **The ws-reclaim token vocabulary** (the only tokens `cmd_ws_reclaim`/`_ws_reclaim_eval` emit):

  | token | kind | notes |
  |---|---|---|
  | `no-such-session` | gone | reused; the server reads it as "already gone", never an attention item |
  | `not-a-workspace` | terminal | reused |
  | `not-a-child` | terminal | NEW; marker absent, unreadable, or ≠ `--child-of`. No override anywhere |
  | `paused` | retryable | NEW; `$REG/reclaim-paused` exists (wave 4 ships its writer; the rung ships in wave 3) |
  | `held` | retryable | reused |
  | `attached` | retryable | NEW; a tmux client is attached (`tmux list-clients -t =cc-<id>` — ANCHORED target) |
  | `tree-busy` | retryable | NEW; an in-progress git operation in the child's OWN tree (`_ws_child_op` on the parent workdir) |
  | `branch-elsewhere` | terminal | reused |
  | `tree-unreadable` | terminal | reused; after a permission-normalisation pass over the child's tree |
  | `containment-unproven` | terminal | NEW; a nested checkout of a DIFFERENT repository (different git common dir) that is dirty or holds commits unreachable from its own upstream |
  | `state-changed` | retryable | reused; fingerprint mismatch |
  | `in-progress` | retryable | reused; the shared reap lock is contended |
  | `reap-in-progress` | retryable | NEW; the breadcrumb carries a `ws-reap` phase |

  Nested checkouts of the child's OWN repository (registered children and strays alike) are pinned and
  removed, never refused. `ws-reap`'s resume fork gains the mirror refusal `reclaim-in-progress` when the
  breadcrumb starts `reclaim:`.
- Every NEW token gets a sentence in `server/src/wsaudit.ts`'s `SENTENCES` (the harvest-equality census), and
  every reused token's existing sentence must be TRUE of a child — if it gives a human remedy a child must not
  need, the plan says so and proposes the wording.
- Breadcrumb: `$REG/<id>.reaping` holds `reclaim:<phase>`. Shared lock `$REG/.reap-<id>.lock`.
- Pin phase (before anything is destroyed): secret-shape classifier over untracked AND ignored files, secret
  paths never staged; `_ws_wip_commit` (new, the only `git commit` in ccd) makes one commit of everything
  else on the child's branch with `-c user.name='ccrc reclaim' -c user.email='ccrc-reclaim@invalid'`,
  `--no-verify`, message `ccrc: WIP pinned at reclaim of <id> (run <runId>)`; attic pins extended to stashes
  attributed to the branch and `REBASE_HEAD`/`MERGE_HEAD`/`CHERRY_PICK_HEAD`/`ORIG_HEAD` where present; the
  tombstone gains `mode:"reclaim"`, `childOf`, `wip`, `secretsDropped`, `containment`, `residueBytes`.
- The reclaim tail arm: unsupervise + anchored pane kill FIRST, unconditionally on fresh AND resume → nested
  children → worktree remove → branch CAS delete → clips rm (its two containment re-checks) → rm of
  `$HOME/.cc-tmp/<id>` (same discipline: id regex re-validated, `pwd -P` equality under `$HOME/.cc-tmp`) →
  `_reg_purge` last. The resume arm re-asserts the marker = `--child-of` and re-reads the pause file.
- Journal: act `reclaim` via the existing `_lc_*` helpers; a refusal's reason is its token. The act joins all
  seven vocabulary sites (union + map in shared/api.ts, `_LC_ACTS`, `ACT_WORD`, and the four cardinals
  25→26 / 24→25).
- `cmd_caps` echoes `reclaim-v1`; the dispatcher routes `ws-reclaim`; `ccd-refusal-scan.test.ts`'s `VERBS`
  gains `cmd_ws_reclaim` (and `_ws_reclaim_eval` if it dies).
- Agent: grant `['ws-reclaim','--expect']`, `REQUIRED_VERB_FLAG['ws-reclaim'] = '--expect'`, the next free
  bypass fixture `g<N>-ws-reclaim-without-expect.ts`, its `EXPECTED` row and a `legit-whitelist.ts` type
  assert. `server/src/remote/runner.ts`'s `CCD_VERB_TIMEOUT_MS` gains `'ws-reclaim': 240_000`.

**server**
- `export const RECLAIM_CAP = 'reclaim-v1';` read with `capSupported` only.
  `CCD_ARGV.wsReclaimAudit(id: string, deferExpired: boolean)`,
  `CCD_ARGV.wsReclaim(token: string, childOf: number, id: string, deferExpired: boolean, dec: ActorFlags | null)`.
- `server/src/coord/childReclaim.ts` (new):
```ts
export type ChildReclaimToken =
  | 'no-such-session' | 'not-a-workspace' | 'not-a-child' | 'paused' | 'held' | 'attached' | 'tree-busy'
  | 'branch-elsewhere' | 'tree-unreadable' | 'containment-unproven' | 'state-changed' | 'in-progress'
  | 'reap-in-progress';
/** 'gone' | 'terminal' | 'retry' — spelled once; a test holds its keys equal to the tokens cmd_ws_reclaim emits. */
export const CHILD_RECLAIM_TOKEN_KIND: Readonly<Record<ChildReclaimToken, 'gone' | 'terminal' | 'retry'>>;
export type ChildReclaimDeferWhy =
  | 'presence' | 'siblings-open' | 'siblings-unreadable' | 'marker-unreadable' | 'marker-mismatch'
  | 'unsupported' | 'paused-at-server'
  | Extract<ChildReclaimToken, 'paused' | 'held' | 'attached' | 'tree-busy' | 'state-changed' | 'in-progress' | 'reap-in-progress'>;
export type ChildReclaimOutcome =
  | { readonly kind: 'reclaimed'; readonly sessionId: string; readonly runId: number; readonly wip: string | null }
  | { readonly kind: 'deferred'; readonly sessionId: string; readonly runId: number; readonly why: ChildReclaimDeferWhy; readonly detail: string }
  | { readonly kind: 'refused'; readonly sessionId: string; readonly runId: number; readonly token: ChildReclaimToken; readonly sentence: string; readonly detail: string }
  | { readonly kind: 'gone'; readonly sessionId: string }
  | { readonly kind: 'failed'; readonly sessionId: string; readonly runId: number; readonly detail: string };
export interface ChildReclaimRequest { readonly sessionId: string; readonly runId: number; readonly trigger: 'close' | 'sweep'; readonly deferExpired: boolean }
export async function reclaimChild(deps: ChildReclaimDeps, req: ChildReclaimRequest): Promise<ChildReclaimOutcome>;
```
  THE ONE EXECUTOR both triggers use. It re-reads, in order: the registry `ChildMark` (must be `child` with
  `runId === req.runId`), `openRunsForSession` (`ok:false` → `siblings-unreadable`, non-empty →
  `siblings-open`), presence (`deps.presence?.isVisible` unless `deferExpired`), `capSupported(RECLAIM_CAP)`;
  then audit → parse → token → `ws-reclaim` → parse. On `reclaimed`: `coord.cancelDeliveriesTo(sessionId)`.
  On every outcome except `gone`: exactly ONE explicit feed row, through the existing feed writer.
- `CoordStore.cancelDeliveriesTo(toId: string): number` — a new `mail_deliveries` writer keyed on the
  recipient, guarded by the shared `OUTSTANDING_STATES_SQL` fragment, RETURNING its change count (never
  `void`), admitted by `mail-hardening.test.ts`'s writer scan.
- **close** — a pure decision in `childReclaim.ts`:
  `childReclaimDecision(input): { readonly reclaim: true } | { readonly reclaim: false; readonly why: 'not-a-child' | 'marker-unreadable' | 'siblings-open' | 'siblings-unreadable' | 'not-finished' }`,
  over: the `ChildMark`, the sibling read (taken inside the mutex), `final`, `state`, the spent verdict, and
  `retiresProgram` ("no OTHER open run of this run's PROGRAM", the SAME predicate D-51's retirement check uses —
  one definition, found or extracted, never re-spelled). Eligible iff child ∧ no sibling ∧ (final ∨ spent ∨
  state='failed' ∨ retiresProgram).
  When eligible, closeRun's fleet act is `ws-release` (never `ws-hold` — that is the retirement fix), and after
  the transaction commits it calls the OPTIONAL port `deps.childReclaim?.(req)` WITHOUT awaiting; the route wires
  that port to `deps.queue.run(sessionId, () => reclaimChild(...))`. `CloseOutcome`'s ok arm gains
  `childReclaim: 'queued' | 'not-queued'` plus `childReclaimWhy?` (additive). Close never waits on the act:
  `ccrc-api` times out at a flat 30 s, `ws-reap`'s remote budget is 240 s.
- Contracts that change in wave 3 (spec §6): coordinator clause 3 rewritten keeping all three verb names inside
  it (verbatim pin moves in the same commit); worker and reviewer skills gain the non-clause sentence;
  `wave-lifecycle.md` §6 rewritten; CLAUDE.md SAFETY bullet and README's "why ws-reap stays human-only"
  paragraph narrowed.

## 4. Wave 4 — the sweep, the switch, the attention item (AGENT-FIRST)

**ccd + agent**: `ccd reclaim-pause --state on|off` — a copy of `cmd_coord_pause` in every respect, marker
`$REG/reclaim-paused`; `cmd_caps` echoes `reclaim-pause-v1`; dispatcher arm; grant
`['reclaim-pause','--state']` + `REQUIRED_VERB_FLAG` + the next bypass fixture + `EXPECTED` + legit assert.

**server**
- `export const RECLAIM_PAUSE_CAP = 'reclaim-pause-v1';` `CCD_ARGV.reclaimPause(state: 'on' | 'off')`.
  `RECLAIM_PAUSE_MARKER = 'reclaim-paused'` in `server/src/coord/rundefs.ts` beside `COORDINATOR_PAUSE_MARKER`.
- `POST /api/coord/reclaim-pause` in `server/src/coord/routes.ts`, body `{ state: 'on' | 'off' }`,
  session-gated, NO box token, 501 when `!capSupported(RECLAIM_PAUSE_CAP)`, 502 on ccd failure. Joins
  `coord-pause-route.test.ts`'s `SESSION_ONLY`; `coordinator-skill.test.ts`'s `EXEMPT` gains it with the
  coord-pause argument; CLAUDE.md's box-token bullet names it; `auth-gate.test.ts` 30→31 and 81→82 (re-measure).
- `CoordStatus` gains `reclaim: MarkerState` (set/clear/unmeasurable from the same registry listing).
- The attention item: the coord frame gains
  `childReclaimAttention: readonly ChildReclaimAttention[]` where
  `export interface ChildReclaimAttention { readonly sessionId: string; readonly runId: number | null; readonly token: string; readonly sentence: string; readonly at: number }`
  (L0), derived from the lifecycle mirror: the latest `reclaim` refusal per session whose token is terminal and
  whose registry row still exists.
- The sweep: `sweepChildReclaim` in `server/src/watch.ts`, a SIBLING lane (`sweepDivergences` forbids
  mutation), on the pass that already lists the registry, dispatching through `deps.queue` to `reclaimChild`.
  Eligibility (spec §5.7 as amended): `ChildMark` is `child` (unreadable → skip); the minting run EXISTS and is
  terminal, or names a different session and is not (`planned` with `dispatchStartedAt` within
  `SPAWN_STALL_MS`); `openRunsForSession` ok and empty; no hold; not paused; eligible on this pass AND the
  previous one. Minting run absent → skip and log, never eligible. In-memory state
  `Map<sessionId, { firstEligibleAt: number; firstDeferredAt: number | null }>`, lost on restart (fail-safe:
  delays). `CHILD_RECLAIM_DEFER_CEILING_MS = 15 * 60_000` (server constant); `deferExpired` when a defer has
  lasted that long.
- PWA: a reclaim row in the Runs-screen banner, in `CoordBanner`'s shape (renders only after a frame, non-
  optimistic, inline refusal text), holding the toggle and the attention list.

## 5. Wave 5 — the run chip (server read + pwa)

```ts
export type ChildReclaimWord = 'reclaimed' | 'pending' | 'deferred' | 'paused' | 'refused';
export interface ChildReclaimStatus { readonly word: ChildReclaimWord; readonly sentence: string | null; readonly at: number | null }
```
- `RunSummary.childReclaim: ChildReclaimStatus | null` (additive, tolerant reader), derived server-side by ONE
  pure function `childReclaimStatus(input)` from: the run's own row, the latest lifecycle-mirror `reclaim`
  event for its session, whether that session's registry row still carries a `ChildMark` naming this run, and
  the sweep's in-memory defer state when present. Mapping: `done` → reclaimed; `refused` with a terminal token
  → refused + server sentence; `refused` `paused` → paused; `refused` with any other retryable token →
  deferred; no reclaim event while the marked row exists and the run is terminal → pending (or deferred when
  the sweep holds a defer for it); anything else → `null`. `failed` → deferred.
- The PWA renders `word` and `sentence` and maps no token itself. A run whose chip reads `reclaimed` renders
  its row inert — no open-session affordance to a session that no longer exists.
- `SessionLine` gains a small `child of run #N` label from `FleetSession.child`, `.sess-held`'s shape.

## 6. Rules every plan obeys

- The writing-plans header (Goal, Architecture, Tech Stack, **Spec**), `## Global Constraints` (copied from
  CLAUDE.md + spec, each line verbatim where the value matters), `## File Structure`, tasks each with
  **Files**, **Interfaces** (Consumes / Produces with exact signatures from THIS contract), **Model routing**,
  and checkbox steps with REAL code, exact commands and expected output; TDD red-first; one commit per task on
  the workspace's own branch.
- Final task: whole-branch verification (all three package suites in the foreground, `deviation-refs` after
  `git fetch origin main`), the deploy order for the wave, and the PR.
- `## Deviations found` carries ONLY the issuing preamble (numbers are issued by the coordinator from the
  programme block; a worker never calls the allocator; a departure goes in the wave-done mail). No `D-<n>`
  definition. The literal token `D-TBD-` followed by a letter or digit must never appear (it reds
  `server/test/dtbd.test.ts`); the meta-form `D-TBD-<slug>` is allowed.
- `## Review lenses` naming the wave's lenses (wave 3's safety lens is MANDATORY, opus, xhigh).
- No hostnames, IPs, tailnet names or docserver URLs anywhere (topology-clean).
- Locate code by CONTENT; line numbers are "as of the branch tip at planning" hints, never addresses.
- Every new guard carries a mutation row that ACTUALLY mutates: the exact edit, the command, the expected red.
- Every `ccd/ccd` edit re-stamps (`shared/mark.mjs`) and pays the citation-corpus tax
  (`server/test/session-hook.test.ts`, procedure S6-R11) — each ccd task says so in its own steps.
- Model routing: implementation `sonnet`; wave 3's ccd ladder, pin phase and tail arm `opus` (security-sensitive,
  destructive).

## 7. Rulings, 2026-09-23 — binding on every plan; they AMEND sections 1–6 above

Made by the contract's owner after the first drafting round, so that no plan waits on a coordinator ruling
before it can be dispatched. Every "held for the coordinator", "ruling gate", "unruled" or "reported for a
ruling" passage in a plan that one of these rulings answers is REWRITTEN to state the ruling as settled and
to build the ruled form. A plan keeps its one-line revert notes only where they help a reviewer; it may not
leave a wave undispatchable pending a ruling below.

- **R1 — an unusable temp root spawns without TMPDIR (wave 1's rc 2): ACCEPTED.** §1 now reads: `_spawn_start`
  composes `TMPDIR=$HOME/.cc-tmp/<id>` iff the marker is non-empty AND the leaf is, or was just made, a real
  directory (not a symlink) owned by this user with mode 0700; otherwise the session spawns WITHOUT `TMPDIR`
  and ccd warns on stderr. Wave 3's tail unlinks a symlink or regular-file leaf at exactly that path with
  `rm -f --`, never following it and never `-rf`.
- **R2 — one run-id grammar.** `^[1-9][0-9]{0,9}$`, ASCII only: at most ten digits, no leading zero. ccd
  checks it ONLY through wave 1's `_child_runid_valid` (which shadows `LC_ALL=C`); wave 3 calls that helper at
  every parse (`--child-of`, the marker read on the fresh arm and on resume) and never re-spells the regex.
  The server's `ChildMark` reader accepts exactly the same set; anything else is `unreadable`.
- **R3 — wave 2's four items: all ACCEPTED.** (1) `CoordStore.clearSession(runId: number, pr: number)`, one
  transaction writing `session-unbound: <sid> (workspace-spent #<pr>)`. (2) The dispatch `workspace-spent` arm
  releases only when nothing else claims the child (`releaseIsSafe`), and otherwise re-holds with the
  surviving run's own reason — `closeRun`'s F9 rule. (4) An unlistable registry answers `spent-unmeasured`
  for ANY `sessionId`; `absent` is re-read with a second listing; a listed `.child` with no built row is
  `spent-unmeasured`. This is the one change to the non-child path, and it is fail-shut and retryable. (6) A
  `planned` run whose binding is already NULL answers `cleared: false` and writes nothing.
- **R4 — the elapsed defer rides the request.** `ChildReclaimRequest` gains
  `readonly deferredSinceMs: number | null` — epoch ms of the first deferral the sweep saw for this child,
  `null` from close. The executor's feed row for `deferred` and for a ceiling-expired reclaim states how long
  it waited and why (spec §5.7, §5.9). Wave 3 adds the field and renders it; wave 4 passes it and DROPS its
  run-trail stand-in (`child-reclaim-defer-expired` run event).
- **R5 — audit-time refusals are journaled: ACCEPTED.** `ccd ws-audit --session <id> --reclaim` journals each
  refusal it answers (act `reclaim`, outcome `refused`, the token as reason), so every refusal reaches the
  lifecycle mirror whichever step found it. Wave 4 expects that line (its pre-flight fact flips) and derives
  the attention list from the mirror ONLY — no in-memory memo feeds `CoordStatus` or the frame.
- **R6 — one generation fence.** Session ids are recycled, so "the latest `reclaim` event for a session" is
  always read within ONE workspace generation: from the last `create` row (outcome `done`) at or before time
  T to the first `create` after it. ONE exported function in `server/src/coord/childReclaim.ts`,
  `childReclaimGeneration(events: readonly MirroredLifecycleEvent[], at: number): readonly MirroredLifecycleEvent[]`,
  created by WAVE 4 (the attention list reads it with `at` = now) and imported by WAVE 5 (the chip reads it with
  `at` = the run's `closedAt`). No second implementation.
- **R7 — wave 5's mapping.** Both flagged readings ACCEPTED (the R6 fence; the pending row also requires that no
  open run names the session, else `null`). All four held proposals ACCEPTED: a fleet-wide pause
  (`CoordStatus.reclaim === 'set'`) answers `paused`; a `refused` event with no token answers `refused` with a
  sentence saying ccd recorded no reason; a token this build cannot classify answers `refused` through
  `tokenSentence`'s fallback; an `intent`/`unknown` event falls through to the row rule. The `.sess-child`
  label takes the drafter's proposed shape (`color: var(--ink-tertiary); flex: none`, no truncation).
- **R8 — the server-side pause read lives in wave 4.** Wave 4 adds the `paused-at-server` producer inside
  `reclaimChild` using `RECLAIM_PAUSE_MARKER`; wave 3's plan says, where it defines the executor, that wave 4
  adds this read. ccd's own on-box rung (wave 3) is the read that matters and is unchanged.
- **R9 — the citation tax is owed by every CITED file.** §6 now reads: any insertion into a file the README
  or the frozen compaction-card corpus cites by line — `ccd/ccd` and `shared/api.ts` today; the census names
  the set — pays S6-R11 in the same task. Edit length above the frozen corpus's highest anchor into `ccd/ccd`
  is a decision: keep prose there length-neutral and put long comments below it (wave 1's rule).
- **R10 — the `_reg_get` census.** Every task that adds `_reg_get` calls to `ccd/ccd` re-measures
  `server/test/ccd-reg-get-census.test.ts`'s header sentence by wave 1's procedure, in that task.
- **R11 — answers outside the thirteen refusal tokens: ACCEPTED.** Besides a refusal, `ws-reclaim` and
  `ws-audit --reclaim` may answer a `failed` document (exit 1): `probe-unmeasured` for a probe that could not
  run, and the post-start failures `pin-failed` and `unit-still-active`, journaled as `LcRefusalToken`s whose
  words live in `LC_REFUSAL_WORD`. The executor maps any `failed` document to the `failed` outcome (retried by
  the sweep; `deferred` on the chip). `tree-unreadable` means ONLY "unreadable after normalisation".
- **R12 — `readSessionRecord`'s `absent` is read wave 2's way everywhere.** Wave 3's executor re-lists once on
  `absent`; absent twice → `gone`; a listed `.child` with no built row → deferred `marker-unreadable`; unlistable
  → deferred `marker-unreadable`.
- **R13 — no test file is created twice.** Wave 2 owns `server/test/child-reclaim-store.test.ts`; wave 3's store
  tests go in `server/test/child-reclaim-mail-store.test.ts`.
- **R14 — the scanner guard in wave 3 is `isChildReclaimKebab`**; `isChildReclaimWord` belongs to wave 5 in
  `shared/api.ts` only.
- **R15 — one token-kind reader.** Wave 4 EXPORTS `childReclaimTokenKind` from `server/src/coord/childReclaim.ts`
  (it is the first second consumer of `CHILD_RECLAIM_TOKEN_KIND`); `watch.ts` imports it; no module-private copy
  exists at any wave; wave 5 imports it and moves nothing.
- **R16 — a REVIEW child lives until the run it reviewed is terminal.** Reviewer clause 7 keeps the report in
  the reviewer's clips and the coordinator cites it by path in fix-round mail, so a review child is not
  finished when its own review run closes. `childReclaimDecision` gains the answer
  `{ reclaim: false; why: 'review-report-live' }` for a child whose minting run is a review run while the run it
  reviews (`runs.reviews`) is not terminal; the sweep's eligibility gains the same condition; once the reviewed
  run is terminal the review child is reclaimed like any other. Wave 3 DROPS its coordinator step-6
  "copy the report before closing" change and restores the step's text and pins. Wave 5's row for such a child
  answers `pending` with a sentence saying it is kept while the run it reviewed is open.
- **R17 — an archive request on an eligible child is overruled: ACCEPTED** (wave 3's
  `child-archive-overruled`). For an eligible child, `state:'failed', archive:true` takes the release arm and
  the child is reclaimed; a non-child's archive is unchanged. Rule 4: an archived child would wait on a human.
- **R18 — wave 2 is dispatchable as written after R3.** Its "ruling gate" paragraph is rewritten to record the
  four items as ruled.

## 8. Rulings, 2026-09-23 (second set) — binding; they AMEND section 7 where they overlap

- **R5′ — audit-time journaling is TERMINAL-only.** `ws-audit --reclaim` journals the refusals whose kind is
  `terminal` and no others: a retryable refusal found at audit time recurs every pass and would flood the
  journal, and the attention list needs terminal rows only. The terminal list the audit journals EQUALS
  `CHILD_RECLAIM_TOKEN_KIND`'s terminal arm, pinned by a test. Wave 4's pre-flight expects exactly that shape.
  A retryable refusal the audit finds is visible on the chip through the sweep's own defer state (wave 5).
- **R4′ — two clocks.** The sweep's in-memory entry keeps `firstDeferredAt` (the first deferral of ANY kind —
  this is what `deferredSinceMs` carries, so every deferred feed row states how long) and a separate
  `firstPresenceDeferredAt` (presence-class deferrals only: `presence`, `attached`, `tree-busy` — this alone
  drives the 15-minute ceiling).
- **R8′ — where the server-side pause read goes.** At wave 3's marked comment inside `childReclaimOutcome`,
  after the sibling read and BEFORE presence, returning through that function's own `deferred(...)` helper,
  so `reclaimChild`'s one feed row records it. Never inside the `reclaimChild` wrapper.
- **R11′ — the audit's unmeasured answer keeps wave 3's shape**: a reclaim document with
  `"verdict":"unmeasured"` at exit 1. The executor maps any audit exit 1 to the `failed` outcome.
- **R19 — a child whose worktree is gone is reclaimed, not retried.** When the child's workdir does not exist
  and there is no breadcrumb, the reclaim ladder does not answer `probe-unmeasured`: it pins the branch tip
  and the stashes attributed to the branch into the attic, then runs the tail from the branch delete on
  (branch CAS delete → clips → temp root → unit/pane → registry purge), recording `worktree: absent` in the
  tombstone. Nothing is unseeable — the tree is already gone. A child whose directory EXISTS but git has no
  worktree record answers the existing TERMINAL token `no-worktree-record` (reused, its existing sentence is
  true of a child), which joins the vocabulary and `CHILD_RECLAIM_TOKEN_KIND` as `terminal`.
- **R20 — repeated failures back off.** The sweep keeps `consecutiveFailures` per child; after a `failed`
  outcome the next attempt waits `min(ceiling, passInterval × 2^k)`. A child whose failures have lasted past the
  ceiling is listed on the attention list with the failure's sentence (the attention derivation reads the
  mirror's `failed` reclaim rows as well as terminal refusals, bounded to the current generation).
- **R21 — one "latest event" rule.** Within a generation, the latest `reclaim`-act event of ANY outcome decides,
  INCLUDING `intent`: an `intent` newer than any outcome means an attempt is in flight or died mid-way, so the
  attention list lists nothing for that child and the chip falls through to the row rule. ONE exported helper,
  `childReclaimLatest(events: readonly MirroredLifecycleEvent[]): MirroredLifecycleEvent | null`, beside
  `childReclaimGeneration` in `childReclaim.ts`, created by wave 4, imported by wave 5.
- **R22 — generation edges.** `childReclaimGeneration` answers `[]` when no `create` (outcome `done`) exists at
  or before `at` — no evidence, never another generation's rows. The closing bound is the first `create` with
  outcome `done` after `at`. Time is `e.at ?? e.ingestedAt`. Wave 4 pins both edges.
- **R16′ — review-child edges.** An unreadable reviewed-run row defers (`marker-unreadable`); a reviewed run
  ABSENT from the database keeps the child (`review-report-live`) and wave 4 LOGS it like `minting-run-absent`;
  wave 5's chip answers the review-kept sentence (never `pending`) for any review child whose reviewed run is
  not terminal in the list, absent included.
- **R9′ — the frozen boundary is `ccd/ccd:19131`** (the highest anchor into `ccd/ccd` in the two frozen
  compaction-card documents, bare `:<n>` forms included), measured at 507aefe9. Every plan states the same
  figure and the grep that finds it.
- **R23 — the contract is committed** at `docs/superpowers/programs/child-reclamation-contract.md`. Every plan's
  header carries a `**Contract:**` line with that path, and every "contract §N" in a plan means that file.
  Committed CODE comments cite the spec, never the contract.
