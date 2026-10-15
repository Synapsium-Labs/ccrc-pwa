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
  is non-empty (superseded by §9 R24: judged with `_child_runid_valid`), after `mkdir -p -m 0700` of that directory. Driven by the MARKER, never by ws-add's argv, so
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
  composes `TMPDIR=$HOME/.cc-tmp/<id>` iff the marker is non-empty (§9 R24: a valid run id) AND the leaf is, or was just made, a real
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
  tombstone. Nothing is unseeable — the tree is already gone. The unit and pane step still runs FIRST, as on
  every arm (spec §5.6); only the worktree removal is skipped. A child whose directory EXISTS but git has no
  worktree record answers the existing TERMINAL token `no-worktree-record` (reused, its existing sentence is
  true of a child), which joins the vocabulary and `CHILD_RECLAIM_TOKEN_KIND` as `terminal`.
  R31's complete-only placement rule (run 208, D-3731) is asked of OTHER registry rows, never of this child's
  own proven-absent worktree, so R19's own arm is unchanged: with every other row placed, the vanished child
  still pins its branch and stashes, records `worktree: absent`, and enters this tail. An ambiguous OTHER row
  holds a vanished child just as it holds a present one, and two vanished children hold each other (D-3734; the
  cost is stated under R31).
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
  outcome `done` after `at`. Wave 4 pins both edges.
- **R22′ — the ingest time is never an event time (supersedes R22's last sentence).** `ingestedAt` is the
  server's clock and D8 (`server/src/coord/schema.ts`) forbids reading it as an event time; R22 said
  `e.at ?? e.ingestedAt`, which violated it. Only ccd's own `at` places an event in time. A `create` row
  whose `at` is null cannot open or close a generation and is skipped as a boundary; events between
  boundaries are included by the mirror's own id order, whatever their `at`. The attention list's failure
  clock and its item timestamp read `at` alone: a row with a null `at` cannot be placed, so it neither
  starts a failure clock nor appears on the list.
- **R16′ — review-child edges.** An unreadable reviewed-run row defers (`marker-unreadable`); a reviewed run
  ABSENT from the database keeps the child (`review-report-live`) and wave 4 LOGS it like `minting-run-absent`;
  wave 5's chip keeps the word `pending` but always with the review-kept sentence, never the plain pending
  sentence, for any review child whose reviewed run is not terminal in the list, absent included.
- **R9′ — the frozen boundary is `ccd/ccd:19131`** (the highest anchor into `ccd/ccd` in the two frozen
  compaction-card documents, bare `:<n>` forms included), measured at 507aefe9. Every plan states the same
  figure and the grep that finds it.
- **R23 — the contract is committed** at `docs/superpowers/programs/child-reclamation-contract.md`. Every plan's
  header carries a `**Contract:**` line with that path, and every "contract §N" in a plan means that file.
  Committed CODE comments cite the spec, never the contract.

## 9. Rulings, 2026-09-23 (from wave 1's reports and reviews) — binding; they AMEND sections 1–8

- **R24 — the marker is judged, not merely present (D-3336).** `_child_tmpdir` answers "a child" only when
  `_child_runid_valid "$(_reg_get "$id" child)"` holds. A marker that is present but is not a run id gets no
  child temp root. Its scratch stays under the box's own TMPDIR, where `ccd-tmp-sweep` collects it. Its reclaim
  is DEFERRED by the SERVER: wave 2's `childMarkOf` reads a malformed marker as `unreadable`, and the executor
  defers `marker-unreadable` before any ccd call. ccd's own rung 2 stays a terminal `not-a-child` (re-worded
  2026-09-23 on wave 3's pre-flight; it once said wave 3's rung 2 defers). Every ccd reader of the marker speaks
  the one grammar of R2. Shipped in wave 1 (#175).
- **R25 — an orphaned child temp root has an owner, and it is wave 4 (D-3337; moved to wave 5 by R36).** A child disposed of by a
  human verb (`ws-rm`, `ws-reap`, `ws-gc --prune`, `forget`) loses its marker and its registry row, but keeps
  `$HOME/.cc-tmp/<id>`, which no marker-driven path can find again. Wave 4 collects such a leaf only when all
  of these hold:
  - its name is a session id no registry file names;
  - the registry listed cleanly;
  - it was observed on two consecutive passes;
  - `reclaim-paused` is absent.

  A link or file leaf is unlinked with `rm -f --`, never followed. A directory is removed without following
  a link out of it. Until wave 4 deploys, the leak is accepted. Also accepted, from wave 1's deploy until
  wave 3's: no child's temp root is collected by anything.
- **R26 — R1 is check-once.** `_child_tmpdir` tests the leaf for a symlink once, before `mkdir`/`chmod`, and
  does not test it again. A second test after the `chmod` would move the race window, not close it: TMPDIR is a
  path, and a path can be swapped at any later moment under the fleet's single-user trust model. The defence
  that holds is at removal: wave 3's tail re-judges the leaf when it removes it and never follows a link.
- **R27 — the run-id census is a literal-absence pin (D-3339).** `ccd-ws-add-child.test.ts` reds on a verbatim
  second copy of the pattern and on nothing else. It is accepted as exactly that and is not widened: a scan
  that tried to recognise every spelling of a grammar would be a semantic pin, and no such scan is complete.
  Every run-id parse that wave 3 adds calls `_child_runid_valid`, and wave 3's reviewers check this by
  reading.
- **R28 — spent means a PR was OPENED from the branch, whether or not it binds** (wave 2, review 144). This
  amends §2's `none|no-commits → unspent`. Rule 3's ruling is "a PR opened from its branch spends a child", and
  `phaseFor`'s binding test answers a different question: same base, and the head an ancestor of the local
  tip. So `childSpent`'s live rung answers `spent`, with that row's number, when ANY same-repository PR row names
  the child's branch as its head, in any state and whatever its base or ancestry. `unspent` needs no such row.
  Measured on the real ccd: it can, because ccd lists `gh pr list --head <branch> --state all`. Consequence,
  accepted for BINDS: a recycled slug inherits its head name's PR history and reads `spent`. It is split by
  consumer in R30, because wave 3's close reads `spent` as permission to reclaim.
- **R29 — a listed marker that reads absent is `unreadable`** (wave 2, review 144). This amends the marker's
  listing rung. When the registry listing names `$REG/<id>.child` but the read answers absent (a dangling link,
  or a file removed between list and read), `ChildMark` is `unreadable`, so a bind is refused and a reclaim is
  deferred. ccd's `_reg_get` reads any symlinked field as empty (not a child). The server refusing where ccd
  answers "not a child" is the safe direction, and it is stated as the one place the two readings differ.
- **R30 — incarnation placement, split by consumer** (wave 3 pre-flight, 2026-09-23).
  - **Birth.** A child's birth is its minting run's `dispatchStartedAt` (the server's clock, stamped just before
    the minting `ws-add`, never cleared). It is unplaceable when that row is absent or unreadable, when the stamp
    is null, or when the run's `sessionId` is not this session.
  - **Placement.** Skew is ±120 s. ccd adds `createdAt` to `PR_JSON_FIELDS`. Every same-repository row whose head
    is the child's branch is placed as one of:
    - `this` (created at or after birth + skew);
    - `inherited` (before birth − skew);
    - `unplaced` (no or unparseable `createdAt`, an unplaceable birth, or within the skew).
  - **The BIND** refuses on `this` or `unplaced` (R28 unchanged for binds).
  - **The CLOSE** treats `spent` as finished ONLY when a dated live row proves `this`. `unplaced` and `inherited`
    HOLD. A fast-path `.prnumber`/`.prhistory` spent is re-dated through the live rung before the close decides.
  - **Why the two differ.** A bind that refuses wrongly costs one round. A close that reclaims wrongly destroys a
    held child's clips, temp root, ignored files and pane context. On this repository, merge-commit merges bound
    old PRs to recycled slugs (`quiet-meadow`, `brisk-meadow`).
- **R31 — the reclaim never follows a symlinked workdir, and never acts on a workdir another row names** (wave 3
  pre-flight, 2026-09-23). ccd's ladder, pin and tail each refuse `containment-unproven` when the child's workdir
  LEAF is a symbolic link. An ancestor link, such as a mounted projects volume, stays legal. The tail re-tests at
  removal time. The ladder also refuses `containment-unproven` when any other registry row names the same workdir,
  literally or by resolved path. An unlistable registry refuses too.

  Measured on git 2.43.0: with the child's directory replaced by a link to a dirty sibling worktree, the planned
  WIP commit lands on the sibling's branch. With the child's worktree record gone, `git worktree remove --force`
  deletes the sibling outright.

  **Another row is placed only by a complete resolution** (run 208, D-3731, 2026-10-01). A row proves it lies
  outside the child only through a `complete` current resolution: every component of its spelling walked and
  entered. An `absent-suffix` answer, where the rest is re-attached as text below a proven-absent component, is
  namespace presentation, not identity evidence. A session that entered `<alias>/server` while the alias led into
  the child keeps that cwd once the alias is removed. Measured before this rule: the audit minted a token, and the
  verb removed the live tree.
  - `complete` is necessary, not sufficient (D-3735). It places the spelling as it reads now, not the session. An
    alias re-pointed after a session entered through it also resolves complete and outside, and so does a
    spelling through a bind mount (`pwd -P` never collapses one). Both are pre-existing, unchanged by this rule,
    and left to a follow-up programme.
  - Such a row makes the reclaim `unmeasured` (retryable, no token, no terminal journal row) at the audit and at
    the verb's locked recomputation. At the tail, `_ws_reclaim_owned` asks the same question on the fresh and the
    resumed arm. There a refusal fails the reclaim through `_ws_reclaim_fail` as `worktree-remove-failed`, which
    writes a journal row and keeps the tree, the branch and the breadcrumb (D-3736). A row that cannot be resolved
    at all, and an empty or unknown basis, answer the same way.
  - A row literally at, below or through the child's path stays terminal `containment-unproven`, whatever its
    basis.
  - `--defer-expired` skips rungs 5 and 6 only. It never bypasses this ownership comparison.
  - Diagnostics name such rows by id only, never by their `.workdir`.
  - Process state never grants deletion consent. A pane's cwd, or a modelled session that is up, gone or
    unaskable, is not an input.
  - The cost, stated rather than discovered (D-3734): a row whose directory no longer exists holds every child's
    reclaim at `unmeasured`. That includes a present child, a vanished one under R19, and two vanished children,
    which hold each other. The hold ends safely only once that row is purged after its session has ended, or a
    link on its path is restored to its original target, AND a later attempt runs. Never create a directory in a
    link's place: that re-points the spelling by replacement (D-3735), and the verb then removes a tree a session
    may still hold (review 213, measured). The only retry is wave 4's sweep (spec §5.5: retryable refusals are
    re-tried by the sweep). Until it ships, a held child keeps its tree after its one close-time attempt.
- **R32 — a held child is reclaimed when its programme retires; `not-finished` names its cause** (wave 3's
  wave-done, open item 1, 2026-09-25). R30 has a non-final close HOLD a child whose spent evidence is undated,
  unmeasurable or a merge-commit `.prnumber`, while the bind refuses that same child `workspace-spent`. No later
  close decides a child that an earlier run minted, and the sweep as planned skips held children. Such a child
  would therefore stay held for ever, with nothing destroyed. That breaks the operator's rule 1 ("that workspace
  always gets cleaned up"), and R30's own "reclaimed at a final close or when the programme retires" had no
  executor.
  - **Wave 4's sweep owns it.** A `program:` hold that names a programme with no open run does not protect a marked
    child. The sweep re-judges such a child by its own ladder, and treats it as finished because its programme is
    done with it.
  - A hold naming a programme that still has an open run protects as before.
  - `not-finished` splits into three words at the seam: undated, unmeasurable, and merge-commit. The sweep and
    wave 5's chip act on them differently, so one word would be an overloaded null.
  - Wave 3 is unchanged; it holds, which is the safe side.
- **R33 — a child's birth is the FIRST dispatch stamp** (wave 3's wave-done, open item 2, 2026-09-25).
  `markDispatchStarted` rewrites `dispatchStartedAt` on every attempt. A workspace minted by one attempt and adopted
  by a later one therefore gets a late birth. PRs opened in between would then read `inherited`, and a bind could
  pass, which is a narrow fail-open. R30's "never cleared" held, but "never moved" did not. Wave 4 makes birth the
  earliest stamp for the minting session, either by keeping the first stamp or by adding a separate minted-at field,
  whichever its plan measures as safe for `dispatchStartedAt`'s other readers. The close only holds meanwhile.

## 10. Rulings, 2026-09-26 (wave 4's pre-flight) — binding; they AMEND sections 1–9

Wave 4's pre-flight read its plan against wave 3 as it merges (`1715d410`, PR #187). Three Opus agents then attacked
the rulings before they were sent. The wave-4 plan's appended "Pre-dispatch amendments" carry the detail, as R-1 to R-13
and A1 to A15. These four rulings are the cross-wave ones.

- **R34 — R32 is built as a release, and a hold is accounted, never parsed.**
  - A hold stops protecting a marked child only when all of these hold:
    - its text equals the server's own rendering of a TERMINAL run that names the child (the open/dispatch claim, or
      a non-final close's claim);
    - that run's programme has at least one run and zero open runs;
    - the minting run is present and terminal;
    - no open run names the child;
    - the child has never coordinated.
  - A hand hold is never released, even one written in the programme grammar, which the operator is told to use. So is
    an unreadable hold, and a claim by a run the database lacks.
  - The sweep releases the hold in its own re-checked job. The child is then reclaimed by the ordinary path, on fresh
    passes.
  - R32's three words are spelled `not-finished-undated`, `not-finished-unmeasured` and `not-finished-merge-commit`.
    Plain `not-finished` stays for an unspent hand-over.
  - Residual, accepted: a hold written in the sub-second window between the job's re-read and ccd's unlink is lost.
- **R35 — R33 is built as a write-once birth per bound session** (`runs.sessionBornAt`, server-only).
  - The fresh dispatch arm binds with its own stamp. An adopted winner binds with null, because it may be an earlier
    attempt's workspace. A null birth is unplaceable, which is fail-closed.
  - `dispatchStartedAt` keeps its every-attempt meaning.
- **R36 — R25's collector belongs to wave 5, not wave 4.** It needs its own capability token, grant and SAFETY lens,
  and it is driven by the server lane, because `ccd-tmp-sweep` runs from a systemd timer only. R25's conditions stand.
  Wave 5 adds:
  - a re-check under the per-id lock;
  - no `$REG` entry of any suffix;
  - a leaf older than a stated age;
  - one extracted removal helper shared with wave 3's tail.
- **R37 — a workspace that has ever coordinated a run is never reclaimed automatically.** Neither the sweep nor the
  close reclaims a marked child that is any run's `claimedBy`, in any state. This covers a programme's heir, through the
  reclaim door, and a nested coordinator. The operator's rule 4 reserves manual cleanup for coordinator workspaces, and
  coordinator clause 3 says such a workspace is cleaned up by a human. The close answers `has-coordinated`.

## 11. Rulings, 2026-10-05 (wave 5's pre-flight) — binding; they AMEND sections 1–10

Wave 5's pre-flight read its plan against `334fb722a` (`origin/main` `c41bf8c5` plus the coordinator's ledger
commits), and read the live fleet read-only. Three Opus lenses raised 50 findings. Five design agents turned the
ledger's "Wave 5 inherits" items into options. Four composers wrote the plan's amendments from the coordinator's
rulings. Three Opus agents attacked them, and the coordinator then ruled on the attacks and on the composers' open
issues, and last on the items the section editors raised against one another's text. The rulings below are all of
that, folded together: where a later ruling overlaps an earlier one, this section states the later one. The wave-5
plan's appended "Pre-dispatch amendments (coordinator, 2026-10-05)" carry the detail, including the new Tasks 0b and
0c. The plan carries no rulings subsection of its own: this section is the binding ruling text, appended to this
contract in the same docs PR as those amendments, and they are written to it and cite it as contract §11.

When the coordinator accepted a departure a composer took, it became ruling text in this section. It is named here by
its slug in backticks and takes no number. A composer's rejection stands unless a ruling here says otherwise. Code
citations are to `334fb722a`. They are hints, so locate code by content.

- **R38 — the wave is split. Wave 5 carries the chip and the server-side inherits; a new wave 6 carries R36 and the
  ccd-side inherits.**
  - **Wave 5 (run 260) is server and PWA only.** It changes no file under `ccd/`, `agent/` or `deploy/`. It needs no
    capability token, adds no `coord.db` migration and owes no re-stamp. It pays S6-R11 for every cited file it
    inserts into. Its scope:
    - the run chip (§5, as R41 to R45 amend it);
    - R39: new Task 0b, server only, done first, BLOCKING;
    - R40: new Task 0c, after 0b, BLOCKING;
    - R41 to R46.

    A task that finds it needs a `ccd/`, `agent/` or `deploy/` edit stops and names the departure. It never builds it.
  - **Wave 6** is a new run, opened before run 260 closes, with its own block allocated at its own open.
    - It is AGENT-FIRST.
    - It has its own pre-flight. That pre-flight first measures why `~/.cc-tmp/ccrc-pwa-swift-hollow` reappeared after
      wave 3's tail removed it.
    - It is dispatched only after workspace-lifecycle wave 3 (run 245) merges. It runs under an overlap rule agreed
      with that programme's coordinator, which names `ccd/ccd`'s RECLAIM region and `server/src/watch.ts`'s sweep
      pass.
    - Its SAFETY and SECURITY lenses are mandatory.
  - **Wave 6's scope.** This ruling sets it in outline; wave 6's own pre-flight rules the detail.
    - **R36's collector.** R25's conditions are necessary, not sufficient. "No registry row names it" is never enough,
      because 16 directories (6.5 GB) that sessions wrote straight into `~/.cc-tmp` meet R25 as written. A leaf is a
      candidate only when a positive witness names it, written when ccd made the leaf a child's temp root. The
      collector also needs:
      - an in-use refusal;
      - an idle floor;
      - ONE removal helper, extracted from wave 3's tail as workspace-lifecycle wave 3 leaves it.
    - **Dot-locks.** `.reap-<id>.lock`, `.<id>.compactions.lock` and `.prstate-<id>.lock` are not rows, and they are
      never unlinked. The collector's "no entry" test is `_ws_slug_free` (`ccd/ccd:6526`), not R36's "no `$REG` entry
      of any suffix".
    - **F6 (review 254).** `_ws_reclaim_contained` drops git's whole `--local-env-vars` list, and the reclaim suites
      gain a harness strip. Until that lands, F6 is a residual that wave 5's SAFETY lens measures (R47).
    - **Journaling.** ccd journals the audit-time `unmeasured`, `probe-unmeasured` and the pre-lock dies. Each new
      token is classified as R43 requires.
    - **The gone-branch pin.** A proven-absent registry branch pins HEAD and every per-worktree reflog commit, deletes
      no branch, and the reclaim proceeds. Spec §5.5 step 3's branch-tip pin then reads "the branch tip when the
      branch exists".
    - **The gone-directory alternate-row recovery,** for the hold that R31's stated cost describes.
  - Wave 6 ships a second destructive verb, so §3's "the only destructive wave" no longer holds.
  - No collector in this programme touches the foreign entries in `~/.cc-tmp`. That live residue, and a child whose
    registry branch is already gone, are offered to the operator and never acted on by a session.
  - The path-identity follow-up (R31's re-pointed-alias and bind-mount residuals) opens after wave 6, not after wave
    5.
  - **Run 260 keeps `waveOf` 5.** Hold accounting renders each run's own `wave` and `waveOf` (wave 4's R-1), so
    nothing is mis-accounted when a sixth wave opens. Nothing edits a run's `waveOf`.
  - **Why:**
    - With R36 and every inherit amended in, the wave was estimated above waves 3 and 4: at least 12k insertions over
      at least 80 files.
    - One destructive subject per SAFETY panel keeps each panel narrow.
    - The chip is read-only and need not wait on R36's fix rounds.
    - R36's measured backlog is one empty directory.
    - R36's tail helper must come from workspace-lifecycle wave 3's refactor of the same region.

- **R39 — the wait on presence is bounded by a lease, on clocks that cannot hide a hole, starting from the answer's
  arrival (`bound-three-figures`; G3, G4 and G1 of review 258).** This is new Task 0b. It amends wave 4's R-4 and
  R-5a, wave 4's A9 item 1 and its lens-1 sentence, §8 R4′, and §4's in-memory state.
  - **Notation.**
    - C = `CHILD_RECLAIM_DEFER_CEILING_MS`: 900 000 ms (`server/src/childReclaimSweep.ts:27`).
    - S = the largest monotonic spacing between consecutive passes. The lane's interval is `CHILD_RECLAIM_SWEEP_MS`,
      60 000 ms (`server/src/watch.ts:147`). Measured on 2026-10-05, passes were at most 79.6 s apart, with a median
      of 68.2 s.
    - G = `CHILD_RECLAIM_PRESENCE_GAP_PASSES` × `CHILD_RECLAIM_SWEEP_MS` = 150 000 ms. The multiplier stays 2.5
      (`childReclaimSweep.ts:397`).
    - STALL = `CHILD_RECLAIM_STALL_MS`: 480 000 ms (`watch.ts:165`).
    - L_p and L_r are the largest latencies of a presence answer and of a licensed reclaim.
    - A presence-held child is one whose entry has `presenceHeldSince !== null`: an unlicensed presence answer put it
      in line.
  - **The lease.** L1's `childReclaimAskOrder(due): { order; holderId }` replaces L4's inline fairness sort
    (`due.sort((a, b) => {`, `watch.ts:3386`).
    - The holder is the due presence-held child that is least by (`presenceHeldSince`, `firstEligibleAt`, id).
    - The holder comes first. It is asked on EVERY pass it is due, never on every other pass.
    - Every other due child follows in R-5a's fairness order.
    - `order` is a permutation of `due`. Asks per pass, `CHILD_RECLAIM_MAX_IN_FLIGHT`, the backoff and every pacing
      rule are unchanged or only slower.
    - Only the order reads `presenceHeldSince`. The licence never does.
    - **Accepted cost.** While a lease runs, no other due child is asked, so a backlog drain pauses for at most one
      lease per presence-held child. That reshapes R-5a's fairness for one bounded tenure. An unbounded wedge is what
      spec §5.7 forbids.
  - **The tenure, decided in L1.** Each request carries `asHolder`.
    - A holder forfeits the lease (`presenceHeldSince` → `null`) when its unlicensed presence answer does not continue
      its episode. It re-joins at the back on its next unlicensed presence answer.
    - A waiting member asked as a non-holder keeps its place.
    - **Rejections (`reject-written-as-failed`).** EVERY rejected request is written as a failed attempt, whether or
      not it was a holder's. That ends the episode, forfeits a holder's lease and backs off. At HEAD the rejection arm
      writes nothing (`watch.ts:3442-3444`).
    - **Stalls (`stall-forfeit-by-late-answer`).** A stalled request sent as holder forfeits on its late answer, which
      arrives at least STALL after the request, and STALL > G. Nothing is written at stall time, because such a write
      would make the identity guard drop that late answer.
    - A waiting member that becomes holder after a T2 breach may forfeit on its first answer as holder. That costs
      liveness only. No grace is added.
  - **The bound. These are three separate figures; never combine them into one.**
    - From the lease's first ASK, the holder is licensed within C + S + L_p. That is about 16.5 minutes at the
      2026-10-05 spacing (S = 80 s, L_p = 10 s).
    - One lease, from its first ask to the next lease's first ask, takes at most C + 2S + L_p + L_r. That is about
      18.6 minutes at the same spacing (L_r = 45 s).
    - The k-th presence-held child in the ask order is licensed within k × (C + 2G + STALL) = k × 28 minutes. That is
      the worst case under T1 to T4.
  - **The hypotheses the bound rests on:**
    - T1: S + L_p ≤ G (90 s live);
    - T2: a presence answer settles before the next pass;
    - T3: no wall-clock step or suspend happens during the lease;
    - T4: the lane's memory is not cleared, and each presence-held child stays eligible and answers presence while
      unlicensed.
  - **When the hypotheses fail.**
    - A violation of T1 to T4 forfeits the lease, restarts one episode and fails closed.
    - A persistent breach licenses no presence-held child, exactly as for a lone child today. Every other due child is
      still asked: each presence-held child ahead of it costs at most two asks.
    - A cleared memory restarts every lease and every episode. Memory is cleared by a raised pause, a missing
      capability, a pass-level fail-shut or a restart.
  - **The clocks (G4).**
    - The lane reads `ChildReclaimLaneNow { monoMs; wallMs }` once per pass. It reads it again once per settled
      request, as the first statement of the success callback and of the rejection callback.
    - `monoMs` is `Deps.monotonicMs?.()`, defaulting to `performance.now()`.
    - Every decision clock is monotonic:
      - the throttle, whose never-run sentinel is `null`;
      - the in-flight stall clock;
      - the entry's `firstEligibleAt`, `lastAskedAt`, `lastFailedAt`, `refusedAt`, `firstPresenceDeferredAt`,
        `lastPresenceDeferredAt` and `presenceHeldSince`.
    - The wall clock has exactly three uses:
      - comparisons with another process's stamps (the generation picks, and the attention list's and the verdict's
        `nowMs`);
      - `firstDeferredAt`, which is display only (`deferredSinceMs` and the chip's `at`; a test pins it as an epoch);
      - `lastPresenceWallAt`.
    - The gap and freshness predicates read the LARGER of the monotonic and wall-clock differences, inclusive at G.
      The ceiling's span reads the monotonic clock alone.
    - So a suspend reads as a hole, and so does a backward wall step. A forward step over-reads, which restarts the
      episode.
    - This also closes two forward-step hazards that are live at HEAD: a pass run early, and the one slot freed while
      a reclaim is still in flight.
  - **The arrival (G1).**
    - The episode starts at the ARRIVAL of its first presence answer. The arrival is read in that answer's own
      callback, never taken from the pass's clock.
    - Continuity is measured from the new answer's arrival back to the previous answer's REQUEST.
    - Freshness at the ask is still measured from the request.
    - This reverses the ledger's 2026-10-04 G1 convention for the episode start. In simulation, the request-stamped
      rule licensed 72 times on observation chains shorter than 900 s.
  - **One entry describes one workspace generation (`entry-generation-reset`).** The entry carries `bornAt`: R-5d's
    birth, on ccd's clock, compared for equality only. When `bornAt` differs from the child's current birth, the entry
    is replaced by a first sighting. So a slug recycled between two passes never inherits the old workspace's
    sighting, episode or lease. A null birth never matches.
  - **Interfaces.** These live in L1 (`server/src/childReclaimSweep.ts`), which still imports L0 only.
    - `ChildReclaimLaneNow`, and `ChildReclaimAsk { at: ChildReclaimLaneNow; licensed: boolean; asHolder: boolean }`.
    - `ChildReclaimSweepEntry` gains `lastPresenceWallAt`, `presenceHeldSince` and `bornAt`, each `number | null`.
    - `childReclaimFirstSighting(monoMs, bornAt)` and `childReclaimSameGeneration(entry, bornAt)`.
    - `childReclaimNextEntry(entry, outcome, ask, answered, passIntervalMs)`.
    - `childReclaimDeferExpired(entry, now: ChildReclaimLaneNow, passIntervalMs)`.
    - `childReclaimDue(entry, monoMs, passIntervalMs)`.
    - `childReclaimAskOrder`.

    Nothing is persisted or sent: there is no wire field and no schema change. This ruling leaves
    `ChildReclaimRequest` unchanged, and `deferredSinceMs` stays wall-clock epoch ms (§7 R4).
  - **Nothing that guards deletion moves.**
    - `childReclaimSweepVerdict` keeps every conjunct.
    - The executor's presence skip under `deferExpired` (`server/src/coord/childReclaim.ts:801`) is unchanged, and so
      are ccd's rungs 5 and 6.
    - A licensed request's answer, rejection or stall ends or restarts its episode, so the rule of one licence per
      episode stands.
    - No ask is licensed that a lone child would not get.
  - **Required red.** Without the forfeit, a seeded case in which one breaching holder starves a reclaimable child
    goes red.
  - **The record.** These wave-4 texts are corrected in an append-only `## Post-merge corrections (wave 5,
    2026-10-05)` block at the foot of the wave-4 plan:
    - A9 item 1's backlog sentence, its "Why 2.5", and its lane case that pinned no licence for three due children;
    - lens 1's "presence can defer but never reset the ceiling";
    - the lane's single clock;
    - the lane's rejection arm.

    The block occurs exactly once, and the lines above it stand as the record. No chip sentence promises a bound the
    lane does not keep: the sweep-deferred sentence names the condition that ends the wait, never a time by which it
    ends.

- **R40 — "has coordinated" is fenced to the workspace's current generation (`release-job-fourth-consumer`,
  `unreadable-stamp-folds-unplaced`).** This is new Task 0c. It amends R37, R34's fifth condition, wave 4's R-1
  condition 4 and R-5c, and wave 4's A9 item 3, A10 item 4 and A11.
  - **The rule.** R37's "a workspace that has ever coordinated a run" means this incarnation of the slug. A marked
    child has coordinated when its id has a claim on record and any one of these holds:
    1. A run naming it `claimedBy` is not terminal (`open`). `'unknown'` counts as open, by `programOpenRunCount`'s
       predicate (`server/src/coord/store.ts:3606`).
    2. A terminal claiming run, or a displacement row naming it, carries no readable instant (`unplaced`). That is a
       NULL `closedAt`, or a `closedAt` or displacement `at` that does not read as a positive safe integer, a value
       stored as REAL or TEXT among them, since the schema is not STRICT (`unreadable-stamp-folds-unplaced`: R40's
       "anything unplaceable keeps the child", applied to the stamps).
    3. Its current-generation birth cannot be placed, or either side of the comparison is not a number.
    4. The claim's instant is at or after the birth minus `CHILD_BIRTH_SKEW_MS` (120 000 ms,
       `server/src/coord/childSpent.ts:58`).
  - **A claim's instant** is the greatest of:
    - each terminal `claimedBy` run's `closedAt`;
    - the `at` of every `reclaim:` displacement row that names the id as the displaced side. Its claim ended there,
      and no run names it any more;
    - the `at` of every such row that names it as the heir. Its claim on already-terminal runs began there:
      `reclaimProgram` rewrites terminal runs too (`UPDATE runs SET claimedBy = ?`, `store.ts:1839`), and the reclaim
      door requires no open run.

    Without the heir side, an heir that took a finished programme's chair after its own birth would read as never
    having coordinated.
  - **The birth** is R-5d's: the opening `create` of the current generation,
    `childReclaimGeneration(coord.lifecycleCreatesFor(id), nowMs)[0]?.at ?? null`, with wall-clock `nowMs`. It reads
    ccd's `at` alone (R22′), never R35's `sessionBornAt`. One helper, `childReclaimBornAt`, places it for three
    readers: R-5d's fence, this fence, and R39's `bornAt`.
  - **ONE fence, ONE store read, ONE birth placement.**
    - **L1.** `ChildReclaimCoordinatorClaim = number | 'open' | 'unplaced'`, and `childReclaimCoordinated(claim,
      bornAt: () => number | null, skewMs)`. It reads the birth only for a numeric claim, and it is written so that a
      NaN keeps the child.
    - **The store.** `childReclaimCoordinatorClaims(): ReadonlyMap<string, ChildReclaimCoordinatorClaim>` replaces
      `childReclaimCoordinatorIds()` (`store.ts:3291`), which is deleted. The fold puts `'open'` over everything, then
      `'unplaced'` over any number, then takes the greatest number. An unparseable displacement row throws.
    - **`server/src/coord/childReclaim.ts`.** `childReclaimBornAt(coord, sessionId, nowMs)` and
      `childReclaimHasCoordinated(coord, sessionId, nowMs)`.
  - **Four consumers decide through the one fence.** Each keeps its existing unreadable answer.
    - close's `has-coordinated` (`server/src/coord/close.ts:694`);
    - the executor's step 2a (`childReclaim.ts:767`);
    - the hold-release job's step 5 (`childReclaim.ts:1103`);
    - the sweep's `coordinating` (`watch.ts:3113`). The sweep hands the raw claim to its verdict as
      `coordinatorClaim`.

    No unfenced read decides anything.
  - **R34's fifth condition** now reads "the child has not coordinated in its current generation". Its other four
    conditions are unchanged, and R35 is consumed unchanged. Left unfenced, the release job would answer `changed` on
    every pass for a recycled-slug child under a retired programme hold, while the sweep answered `hold-retired`. That
    would be a new silent wedge.
  - **Why it is safe.**
    - ccd journals a `done create` only at the end of `cmd_ws_add` (`_lc_done create "$id"`, `ccd/ccd:7467`).
    - `cmd_ws_add` refuses `slug in use` while any registry file for the id exists (`_ws_slug_free`, `ccd/ccd:6526`),
      or while the slug's git state is taken.
    - So a newer `create` proves that the earlier workspace, the coordinator's, was removed by `ws-reap`, `ws-rm` or a
      reclaim before this generation was created, and that no session can still be inside it.
    - Rule 4 reserves manual cleanup for coordinator workspaces, and a recycled slug's later child is not one.
    - This incarnation's own coordination always counts, whether as coordinator, nested coordinator or heir.
    - The population is still marker-only.
  - **Doubt keeps the child:** an open claim of any generation, an unplaced claim, an unplaceable birth, a non-number,
    or an unreadable store.
  - **Residuals, accepted.**
    - **Clock offsets (fail-open, in the direction R-5d's fence already names).** The fence compares ccd's clock with
      the server's. An offset beyond `CHILD_BIRTH_SKEW_MS` at those instants can make the child reclaimable: a claim
      this generation ended within that excess after its birth reads as before the birth. The offset may be a
      sustained skew between the boxes, or a step of either box's wall clock.
    - **An heir chosen before its own `ws-add` journaled `create done`** has the same exposure, because the door reads
      `const now = Date.now();` before its awaits (`server/src/coord/reclaim.ts:298`).
    - **Mirror lag fails closed.**
    - **A lost `coord.db`** loses the claim history, and every minting run with it, so the sweep answers
      `minting-run-absent`.
    - **The window between step 2a and ccd's lock** is R37's, unchanged.
  - **The fence is a SAFETY-lens item.** Required red: drop the time bound, and a recycled-slug case whose CURRENT
    generation coordinated is reclaimed.
  - **The live case.** `ccrc-pwa-brisk-meadow`'s August incarnation coordinated program-leverage runs 10, 12, 14, 16,
    18, 19, 28 and 30. All are `done`, and the last closed on 2026-09-04. Its current generation was born on
    2026-09-26, for review 171. It becomes eligible once the server box converges.

- **R41 — the sweep's verdicts are visible.** It amends R5's "from the mirror ONLY", §4's `ChildReclaimAttention` and
  its derivation, §8 R20's failing arm, §5's chip inputs and mapping, §7 R7's switch row, §8 R16′ and §8 R21.
  - **The record.** On every judging pass, the sweep's per-child loop records each marked child's last verdict. That
    verdict is L1's `ChildReclaimSweepVerdict`, itself unedited.
    - The accessor is `FleetWatcher.currentChildReclaimVerdicts(): ReadonlyMap<string, ChildReclaimSweepVerdict> |
      null`, beside `currentChildReclaimDefers()` (`watch.ts:1521`).
    - `null` means no judging pass has run since this process started. An id absent from the map was not judged.
    - A pass that judged nothing reduces the map to its kept verdicts (`childReclaimKeptVerdicts`, L1) and drops the
      transient ones. Those passes are the ones where the defers are cleared: the switch raised, a reclaim capability
      missing, or the mirror or coordination read failed.
    - "No verdict yet" never reads as eligible.
    - The accessor costs no I/O. No decision reads it: not the verdict's inputs, the due set, the lease or the
      executor. The verdicts reach only the run chip and the attention list: its kept arm, and the failing items it
      withholds for a held child. The list reaches the executor only as R44's `feedQuiet`, which decides nothing but
      whether a feed row repeats, and a child is dispatched only on an eligible verdict in the same pass, so no kept
      or held filter changes what a dispatched child's request carries.
    - The lane logs `coordinating` once per child per process, as it logs an absence.
  - **The classes, in ONE table.** `CHILD_RECLAIM_SKIP` (`server/src/childReclaimSweep.ts`) is total over
    `ChildReclaimSweepSkip` and classes each word exactly once:
    - **kept** (L0: `ChildReclaimKeptWord`, `CHILD_RECLAIM_KEPT_WORDS`, `isChildReclaimKeptWord`): `coordinating` (as
      R40 fences it), `minting-run-absent`, `minting-run-postdates-child`, `child-birth-unplaced`,
      `reviewed-run-absent`, `not-a-workspace`;
    - **doubt:** `marker-unreadable`, `identity-unmeasured`, `hold-unmeasured`, `minting-run-unreadable`,
      `reviewed-run-unreadable`, `siblings-unreadable`;
    - **held:** `held`, meaning a hand hold, or an accounted programme hold while its programme has an open run;
    - **ordinary,** with no sentence: `not-a-child`, `hold-retired`, `terminal-refusal`, `minting-run-open`,
      `dispatch-in-flight`, `review-report-live`, `siblings-open`.
  - **Sentences.**
    - A kept sentence says why the child is kept, and ends "ccrc never reclaims it on its own; a person removes it
      once nothing still needs it."
    - The two minting-run words carry "After a rebuild, workers may still be running in these." directly before that
      ending (`rebuild-sentence-before-the-ending`). So a lost database never tells the operator to remove workspaces
      whose workers are still running.
    - `not-a-workspace` (a project's main checkout carrying a child marker) ends instead "ccrc never reclaims it on
      its own; a person removes the marker, never the checkout." (`not-a-workspace-removes-the-marker`).
    - The `coordinating` sentence never says "ever".
    - A doubt sentence says the sweep reads it again on its next pass.
  - **The chip (§5).** There is no sixth word: the five stand. The chip's inputs gain:
    - the sweep's last verdict (`unjudged`, `eligible`, or a skip word);
    - whether the sweep's entry is in a run of failed attempts;
    - when this generation's unbroken run of failure lines began, set only once that run has lasted the ceiling;
    - the composer's wall clock.

    "The gate" is §5's: the registry carries a mark naming this run, and no open run names the session. The first
    match wins:
    1. The run is not terminal, or has no session: `null`.
    2. Settled answers:
       - a latest `done` is `reclaimed`;
       - a token of kind `gone` is `null`;
       - a terminal refusal is `refused`, with ccd's sentence. It outranks every verdict.
    3. The verdict, where the gate holds:
       - kept is `refused`, with its sentence and a null `at`. The switch NEVER replaces it, a pause included;
       - doubt or held is `deferred`, with its sentence. The switch turns it to `paused`.
    4. The remaining events:
       - a failure line (R43) is `deferred`. Once the failure run has lasted the ceiling, it carries the attention
         list's own sentence and `at`;
       - `refused` with no token is `refused`;
       - the `paused` token is `paused`;
       - a retryable token is `deferred`;
       - an unclassified token is `refused`;
       - `intent` or `unknown` falls through to the row rule.
    5. The row rule, where the gate holds:
       - a review child whose reviewed run is not terminal in the list is `pending`, with the review-kept sentence;
       - a sweep failure run is `deferred`;
       - a sweep defer is `deferred`, at `firstDeferredAt`;
       - an eligible or ordinary verdict is `pending`;
       - no verdict yet is `pending`, with its own not-judged sentence and never the eligible one.

    So a done reclaim, a gone answer and a terminal refusal outrank the verdict, and a non-ordinary verdict (kept,
    doubt or held) outranks every other event: a failure line, a retryable refusal, a refusal with no token, the
    `paused` token and an unclassified token (`verdict-outranks-retry-events`). Otherwise R21's latest-event rule
    stands. R16′'s review rows answer only after any non-ordinary verdict has answered. A review child that the sweep
    answers `reviewed-run-absent` reads `refused`, with that sentence. No row promises a retry that a hold or a kept
    word prevents, and the fleet-paused sentence no longer promises a reclaim.
  - **The attention list's shape (§4).** `ChildReclaimAttention` (L0) replaces the interface at `shared/api.ts:3793`
    with four arms:
    - `terminal` and `failing`, each `{ sessionId; runId: number | null; token; sentence; at }`;
    - `kept`, `{ sessionId; runId: number; word: ChildReclaimKeptWord; sentence }`;
    - `kept-many`, `{ word; members: readonly { sessionId; runId }[]; sentence }`.

    `kind` is additive. An item from an older server has no `kind` and reads as before. An older PWA drops a
    `kept-many` item, which is the accepted cost.
  - **R5 now reads:**
    - The attention list is derived from durable state (the lifecycle mirror, the registry listing and `coord.db`) by
      the sweep's own passes.
    - Every pass derives the terminal and failing arms from the mirror.
    - Every pass that JUDGED derives the kept arm. A judging pass is one where the switch is down, both reclaim
      capabilities are advertised, and the mirror and coordination reads succeeded. A pass that judged nothing keeps
      the kept arm and never erases it.
    - No executor answer and no sweep entry is ever an input.
    - A restart rebuilds the mirror arms on its first pass, and the kept arm on its first judging pass.
    - The list has one write site.
  - **The attention list's rules.**
    - Kept words reach the list from the first judging pass that answers one, with one emit per change (the coord
      frame's byte-equality guard). Doubt words and `held` never reach it.
    - **One item per child.** A kept item REPLACES a failing item for the same child
      (`kept-replaces-failing-on-the-banner`). A terminal item stands, and that child gets no kept item.
    - **A held child.** A child whose last measured verdict is `held` is not listed by the failing arm.
      - With no verdict recorded (a restart, or a pause), wave 4's failing arm stands unchanged.
      - Under a pause, the banner's paused state governs.
      - Only `held` is withheld. A child whose last verdict is a doubt word keeps wave 4's failing item: a failed read
        never lists a child by itself, and never takes one off the list.
      - Pinned: a held child whose mirror failure run is past the ceiling is absent from the banner, and a doubt
        child's failing item stands. Dropping the held check reds the first case; widening it to every non-ordinary
        verdict reds the second.
    - **The collapse.** More than five children (`CHILD_RECLAIM_KEPT_MANY_OVER = 5`) answering one kept word collapse
      into one `kept-many` line. Its sentence states the count, and the line lists the children. That is the shape a
      lost or rebuilt coordination database produces. The PWA counts nothing itself.
    - **The feed row.** Each kept word writes one `child reclaim kept` feed row per child, per word, per process. It
      is recorded, never pushed. A child that leaves the registry listing is forgotten, so a recycled id is a new
      child.

- **R42 — the ten close words are not stored.**
  - They are close-time snapshots (`ChildReclaimNotWhy`, `server/src/coord/childReclaim.ts:307`). They ride only
    `CloseOutcome.childReclaimWhy`, and they go stale.
  - No schema, migration, run event or wire field carries them. A run-row column is rejected.
  - The chip reads current state instead:
    - `has-coordinated` reaches it as the sweep's `coordinating`, through R40's fence. That verdict is kept across a
      pause;
    - the four `not-finished` words reach it as `held` while the programme has an open run, then as `hold-retired`,
      then as eligible;
    - `siblings-unreadable` reaches it as the doubt verdict;
    - `not-a-child`, `marker-unreadable` and `siblings-open` are handled by the gate;
    - `review-report-live` reaches it through the review rows.
  - No `pwa/src` file reads `childReclaimWhy`.
  - This answers the question wave 4's R-2 left open. It also replaces R32's "the sweep and wave 5's chip act on them
    differently": the chip acts on the sweep's verdict, never on a close word.

- **R43 — the server reads `flock-unavailable` and `lock-unopenable` as failures, never as `refused`.** Since wave 3,
  ccd journals both as `reclaim` `refused`: `_lc_refuse reclaim "$id" flock-unavailable` at `ccd/ccd:28166`, and
  `lock-unopenable` at `:28169`. The executor reads the same die as a `failed` `pre-lock-die`
  (`server/src/coord/childReclaim.ts:664`), which the sweep retries.
  - **Exactly these two tokens, by name.** Both of these live in `server/src/childReclaimSweep.ts`:
    - `CHILD_RECLAIM_PRE_LOCK_TOKEN`;
    - ONE predicate, `childReclaimFailureLine(e)`: `failed`, or `refused` with one of the two tokens.

    The attention list's failing arm and the chip both read the predicate. On the chip such a line reads `deferred`;
    on the attention list it is listed by the failing arm after 15 minutes of unbroken failure. Any other journal-only
    token stays unclassified and reads `refused` through the fallback.
  - **Unchanged.** `CHILD_RECLAIM_TOKEN_KIND`, `childReclaimTokenKind` and `childReclaimTerminalRefusal` are
    byte-identical to `main`. Neither token is terminal, and retry pacing is unchanged.
  - **Disjoint vocabularies.** The ws-reclaim tokens and the journal-only tokens stay disjoint, pinned by a case.
  - **No quoted literal.** No quoted pre-lock token literal is written under `server/src/coord`; code there reads the
    tokens by property. This keeps `mail-routes.test.ts`'s kebab scanner green.
  - **Wave 6's tokens.** A token that wave 6 starts journaling under `reclaim` is never inherited unclassified. Wave 6
    classifies each new one, in `CHILD_RECLAIM_PRE_LOCK_TOKEN` or in the kind map, when it adds it.
  - **Wave 4's R-11 is corrected.** These two tokens do reach the mirror. The failures the mirror never sees are
    `probe-unmeasured`, the audit-time `unmeasured`, and the pre-lock argv and `python3` dies. Journaling them is wave
    6's work (R38); until then, the chip's sweep-failing row shows them.
  - It amends §7 R7's unclassified-token row for these two tokens, and §8 R20's failure run, which now includes their
    `refused` lines.

- **R44 — feed rows are de-duplicated.** It amends §3's "exactly ONE explicit feed row" per outcome, and spec §5.9's
  "one feed row per outcome".
  - **The rules.**
    - A non-presence deferral writes one feed row per episode, not one per pass.
    - A child the attention list already lists as failing writes no further row for a failure with the same word. A
      row is written again when the word changes, or when the child leaves the list.
    - A ceiling-expired attempt always writes, because its row states the wait it ended (§7 R4).
    - Presence deferrals keep today's shape: the lease holder writes one row per pass for up to about 15 minutes, as a
      lone child does.
    - Each kept word's single row is R41's.
  - **Interfaces.**
    - `ChildReclaimSweepEntry.lastDeferWhy: string | null`.
    - L1: `ChildReclaimFeedQuiet { deferWhy: string | null; failureToken: string | null }`, and
      `childReclaimFeedQuiet(entry, listed, sessionId)`.
    - `ChildReclaimRequest.feedQuiet: ChildReclaimFeedQuiet`. Close sends `CHILD_RECLAIM_FEED_QUIET_NONE`.
    - The `failed` arm of `ChildReclaimOutcome` gains `token: string | null`: ccd's failure word, or the pre-lock
      die's token.
    - `childReclaimFeedSkips(outcome, req)`.
  - **Scope.** The skip decides only whether the executor's own feed row repeats what the feed already says. It
    changes no outcome, dispatch or pacing, and only `childReclaimFeedQuiet` reads `lastDeferWhy`. The de-duplication
    memory is the process's, so after a restart a row is written once more.

- **R45 — the abandon confirmation tells the truth.**
  - **One reader.** The ONE PWA reader of `FleetSession.child` is `childMarkOf` (`pwa/src/fleet/runWords.ts`). It
    gives four answers and never folds them:
    - `child`, with its `runId`;
    - `none`, which includes an absent key from a server that predates markers;
    - `unreadable`;
    - `unrecognised`.

    The fleet line's `childOfRunLabel` and the abandon sheet's `abandonChildOf` both project it, so no null is
    overloaded. Pinned: `pwa/src` reads `FleetSession.child` once, and no `pwa/src` file reads the close response's
    `childReclaimWhy`.
  - **The sheet's four branches.**
    - **No session:** decided on `run.sessionId` alone.
    - **Child:** any child mark, including a child handed over from an earlier wave.
    - **Not a child:** this sentence is byte-identical to `main`'s (`pwa/src/fleet/AbandonSheet.tsx:217`).
    - **Unknown:** no fleet row, or an unreadable or unrecognised mark. This branch hedges both ways.

    Every child sentence, and the label's child title, says what happens WHEN nothing keeps the child ("the server
    reclaims it when nothing keeps it"). None says that it will happen.
  - **The route comment.** The comment above the abandon route (`server/src/coord/routes.ts:1604-1606`, "a release
    destroys nothing, so the two-tap confirm in the sheet is the whole ceremony here") is corrected in the same PR as
    the copy, by the wave's prose task (R46), and so is the sheet's header (`pwa/src/fleet/AbandonSheet.tsx:20-23`),
    which says the same. The ungated abandon door (D-282) can reach a destructive act. That is inside the single-user
    trust model: it is recorded, not changed.
  - **The token pin.** §5's "the PWA maps no token" pin extends to wave 4's two PWA reclaim files and to the abandon
    sheet. Each file is addressed by path.
  - It amends §5's last bullet: the label reads `FleetSession.child` through `childMarkOf`.

- **R46 — prose, and where the spec text lands.**
  - **G2 (review 258).** `childReclaimReleaseAnswered`'s docstring (`server/src/watch.ts`) and wave 4's A10 both give
    a false reason for keeping the release mark. Both get the small-items design's replacement: keeping the mark is a
    choice, not a safety need. A10's own lines are not edited. The correction is a bullet appended under the wave-4
    plan's one `## Post-merge corrections (wave 5, 2026-10-05)` heading (`g2-a10-corrected-by-append`).
  - **G5 (review 258).** `ChildReclaimRequest`'s "on the same clock" is replaced: `deferExpired` is the sweep's
    verdict on a different clock, the current presence episode. The replacement also names the entry's lifetime
    (`g5-names-the-entry-lifetime`). `deferredSinceMs` is the first deferral of any kind since the sweep's in-memory
    entry for this child was last created. Every reset of that entry, a restart included, starts it again. This
    corrects §7 R4's "the first deferral the sweep saw for this child", and bounds §8 R4′'s "the first deferral of ANY
    kind" by the entry's lifetime.
  - Neither text carries a content pin (wave 1's ruling).
  - **Spec text, in the coordinator's docs commit (`wave3-spec-debt-to-coordinator-docs`).** Code comments cite plain
    "spec §5.7" or "spec §5.9" (R23). Every spec text for R39 to R44 lands in the coordinator's docs commit. That
    commit is in the same docs PR as this section and the plan's amendments, and it merges before dispatch. Its
    placement is final. It carries:
    - §5.7: the lease and R39's three figures; R40's "has coordinated", fenced to the current generation; the
      paragraph on a programme's own hold ending with the programme (R34); and the sentences on R-5d's birth fence;
    - §5.9: the visible verdicts, the kept arm, R44's feed rows, and R43's two journal-only lock tokens read as
      failures;
    - wave 3's leftover spec debt: R30's placement in §5.3, with the qualifier it needs in §4's "Spent" ("dated to it
      (§5.3)") and in §5.7's "spent by a PR dated to it (§5.3)"; and T1's counts in §6 and Appendix A. Appendix A's
      other values stay the `46aca9fe` snapshot, with a one-line note that waves 1 to 4 moved other counts and where
      to measure them;
    - §8: its wave table gains a wave-6 row, wave 5's row reads "server + pwa", and the paragraph under the table no
      longer calls wave 3 the only wave that destroys anything;
    - the corrections to §1's "One qualification" and to §7 item 2: each says that the automatic path keeps, for a
      person, the children the sweep's kept verdicts name (R41), a child under a terminal refusal (`branch-elsewhere`
      included), and, until wave 6, a child that fails past the ceiling for good (such as `pin-failed` with its branch
      gone);
    - the status line, whose "five waves" becomes six.
  - **Wave 5's prose task carries only these:**
    - G2 and G5;
    - the comment fixes next to the abandon copy: the abandon route's docstring (`server/src/coord/routes.ts`) and the
      sheet's header (`pwa/src/fleet/AbandonSheet.tsx`);
    - README's "The same row lists…" sentence, which gains the children the sweep keeps for a person (R41),
      re-measured by the README citation cases;
    - wave 3's spec debt for `wip-moves-no-ref` (D-3365): spec §5.5 steps 2 and 3, rewritten to what shipped;
    - in spec §1, the operator's ruled row kept verbatim, with one line added under the table, after a blank line: "As
      built (§5.5 step 2; wave 3's `wip-moves-no-ref`), the WIP commit is pinned in the attic and moves no branch."

- **R47 — process.**
  - **Deploy.** The path is: merge; then the prerelease (`release-main.yml` runs on every push to `main` with no paths
    filter, `.github/workflows/release-main.yml:19-21`); then the fleet's own updater, fleet box first and then the
    server box. The wave is live once the server box converges.
    - Nobody runs `ccrc rollout` or `ccrc update` except with `--check`, which only measures (operator ruling,
      2026-09-30).
    - The coordinator observes convergence read-only, and never acks an update row.
    - Every hand rollout step in the plan's Task 10, Global Constraints and PR body is removed.

    This replaces §6's "the deploy order for the wave".
  - **Deploy class:** server + PWA. There is no ccd re-stamp, no capability token and no `coord.db` migration.
  - **Review lenses.** The SAFETY lens is mandatory (`opus`, `xhigh`), because R39 and R40 change when a destructive
    ask is licensed and which children may be taken. The plan's "this wave destroys nothing, so the safety lens does
    not apply" is struck. The SAFETY lens:
    - re-derives R39's three figures under T1 to T4;
    - runs its own seeded interleavings, with persistent slow answers and rejected licensed requests among the modes,
      and shows that a persistent breach cannot hold the lease for ever;
    - re-derives R40's fence and its four consumers against `cmd_ws_add`'s refusals;
    - confirms that R41's accessor reaches no decision;
    - reads the abandon copy against every condition that keeps a child.

    The plan's lenses run in addition to the held-out panel.
  - **F6's residual (`git-env-whole-local-list`).** Only the FLEET box runs ccd's reclaim: in remote mode the server
    box runs no ccd.
    - So the SAFETY lens measures, read-only and printing names only, that neither the fleet box's ccrc units nor its
      user manager carry any of git's local environment variables. The list comes from `git rev-parse
      --local-env-vars`, which is a superset of `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG`.
    - A non-empty or unmeasured answer stops the landing until the coordinator rules.
    - The server box is out of scope for this measurement, not unmeasured.
  - **Route.** `{class:'opus', effort:'xhigh', subagent:'sonnet', workflow:'on', compact:'40'}`. This is the bulk
    row's workflow mode at `xhigh`, not ultracode, because the amended wave exceeds one context. Before dispatch, the
    coordinator records in the ledger the change from wave 4's route (Opus·high, workflows off) and this reason.
    Routing floors:
    - every implementation task: `sonnet`, `high` at least;
    - Task 0b: `opus`, `xhigh`;
    - Task 0c and the verdict accessor: `opus`, `high` or higher;
    - the entry-condition preflight: may run on `haiku`.

    No subagent inherits the main loop's model. This amends §6's "implementation `sonnet`".
  - **Delivery.** The docs PR that carries this section and the plan's amendments merges before dispatch, and the
    child is minted from `main` after it, so the worker reads the plan at `main`. The worker brief and the review
    brief still each carry `homeRepoRoot`, `planRepoPath` and `planSha`. `planSha` is that docs PR's squash-merge
    commit on `main`.
    - Beside `planSha`, each brief tells its reader to stop and read the blob if their copy of the plan lacks the
      amendments section.
    - That section's first line repeats this only as a backstop.
    - Before dispatch, the coordinator takes `planSha` from that merge commit, and proves that the blob resolves and
      carries the amendments section.
  - **The operator is told before landing (`r40-pre-landing-class-list`).** R39 and R40 widen what reaches the
    destructive path the moment the server box converges, with no capability gate, while F6 waits for wave 6. So,
    before landing and read-only:
    - The coordinator re-measures, from the fleet box, which marked children R40 moves. It reads the child markers,
      the open runs and the closed runs (`ccrc-api runs list`, without and with `--closed 1`), and each claimant's
      `ccrc-api lifecycle list`. For each claimant it records its current birth, its claim instant and its class:
      `open`, `unplaced`, birth unplaced, kept, or would move.
    - A marked child is listed "would move" when at least one run names it `claimedBy`, every such run is terminal,
      and every `closedAt` falls before its current generation's `create` (from `ccrc-api lifecycle list`) minus
      `CHILD_BIRTH_SKEW_MS`. A marked child that no run names is not listed, because R40 does not change it; the one
      exception the API cannot see is the residual below.
    - The list covers claimants only. Displacement rows cannot be read through the API, and no read of the server's
      `coord.db` is made, so a child kept today only by a `reclaim:` displacement row naming it on the `from` side is
      invisible to the list. That is the list's stated residual ("not listed: the API cannot read displacement rows"),
      and the child is not over-listed.
    - The coordinator writes one ledger line before landing. It records the list, the widening, F6's residual as
      measured, and the operator's stop: `reclaim-pause`, on the Runs screen.
    - The coordinator tells the operator about every child the list marks "would move" other than
      `ccrc-pwa-brisk-meadow`.
    - The PR body names `ccrc-pwa-brisk-meadow` and `reclaim-pause`, and asks for no hand rollout.
  - **Deviations (`defined-d-token-exception`).**
    - A departure is named by slug in the wave-done mail.
    - The coordinator numbers each departure from run 260's block and defines it in the plan's `## Deviations found`
      in the same act. The block is 3926, 3927, 3928, 3929, 3930, 3931, 3932, 3933, 3934, 3935, 3936, 3937, 3938,
      3939, 3940, 3941, 3942, 3943, 3944 and 3945.
    - No departure slug accepted in this section takes a number, so the block stays whole for departures found while
      executing.
    - Wave 6's block is allocated at wave 6's own open, and is never drawn from this one.
    - A worker writes no `D-` token for a number that `origin/main` does not define, and none in a commit message. It
      adds a defined one to a file only where the amendments prescribe it verbatim, and D-282 and D-3365 are the only
      two. The comments the plan's own Tasks 5 and 6 prescribe repeat D-2545 and D-287, which
      `server/src/coord/routes.ts` and `pwa/src/screens/RunsScreen.tsx` already carry. No other `D-` token is added by
      this wave.

    This amends §6's single programme block, and relaxes wave 4's R-12 to that one exception.
  - **CI.** Selection is `enforce` (`.github/workflows/ci.yml:94`), so the PR's CI arbitrates only its own selection.
    The worker's FIRST full run in its worktree is the wave-done's `suite:` line. The review brief names the suites to
    run.
  - **Overlaps.** Before dispatch, the coordinator reads `GET /api/claims?project=ccrc-pwa`.
    - On a path another programme holds, edits stay narrow and additive (wave 4's R-13).
    - `server/src/watch.ts`'s sweep pass is shared with workspace-lifecycle wave 3b's planned lane. The coordinator
      tells that programme's coordinator before dispatch.
    - Whichever PR lands second absorbs `main` only when one of worker clause 16's triggers fires, and only with `git
      merge`: never a rebase, a force-push or `update-branch`. After absorbing, it re-runs the sweep suites and every
      suite the merge touched, and re-pays S6-R11 wherever the merge moved a cited file.

## 12. Rulings, 2026-10-06 (wave 6's pre-flight) — binding; they AMEND sections 1–11

Wave 6's pre-flight read `main` at `77c11245` (workspace-lifecycle wave 3, #286, merged), wave 5's open PR #290
at `e79b1da7`, and the live fleet box read-only. Six Opus scouts measured the six areas R38 names, and one more
area R38 did not foresee: why a reclaimed child's temp root came back. The coordinator ruled on their questions.
Wave 6's plan carries the detail, and this section is the binding ruling text.

Code citations are to `77c11245`. They are hints, so locate code by content.

- **R48 — R38's wave 6 becomes three waves: 6, 7 and 8.**
  - **Wave 6 (run 291)** repairs the existing destructive verb. It also lays the collector's groundwork, which is
    not destructive. Its scope:
    - R49, the tail's temp-root removal, and the ONE removal helper;
    - R50, the positive witness;
    - R51, F6;
    - R52, journaling;
    - R53, the gone-branch pin;
    - R54, the gone-directory recovery;
    - R55, the vanish re-read fix.
    Its destructive subject is "what `ws-reclaim` deletes", and its SAFETY lens reads only that subject.
  - **Wave 7** adds the collector verb, R57. It is inert and AGENT-FIRST: no server composes it until wave 8.
  - **Wave 8** adds the collector's server lane, R58.
  - **Each wave is one child and one PR.** Each opens its run before the previous wave's run closes, and each gets
    its own block and its own pre-flight.
  - **Run 291 keeps `waveOf` 6, and run 260 keeps 5.** Nothing edits a run's `waveOf` (R38).
  - **Why:**
    - Unsplit, the inferred size is 8k to 12k insertions over 50 to 70 files, close to waves 3 and 4.
    - The new verb is a second destructive subject, and R38's own reason is one destructive subject per SAFETY panel.
    - The lane shares `sweepChildReclaim` with workspace-lifecycle wave 3b's planned lane, so it cannot land
      before 3b without colliding in `watch.ts`.
    - An inert verb that ships first lets the fleet advertise its token before any server composes it. That is
      the precedent of reclaim waves 3 and 4, and of workspace-lifecycle 3 and 3b.
  - The path-identity follow-up programme now comes after wave 8.

- **R49 — the tail removes a temp root only once nothing uses it, through ONE removal helper.**
  - **Measured cause (R38's first measurement).** Wave 3's tail removed `~/.cc-tmp/ccrc-pwa-swift-hollow` while
    the killed pane's processes were still running. Their environment carried `TMPDIR=<leaf>`, and one of them
    recreated the leaf 3.7 s after `reclaim done`. The leaf's mtime is 22:12:10.735, 2 ms before systemd reported
    the pane's scope ended.
    - The tail asks only whether tmux still has the session (`_session_probe`), and never whether the pane's
      processes have exited.
    - The leaf's birth time of 2026-10-05 15:27 comes from the operator's rsync onto the new disk, which kept
      mtimes. It is not the recreation.
    - The header at `ccd/ccd:28878-28880` ("a reclaim never meets it") is false, and wave 6 corrects it.
  - **ONE removal helper.** It is extracted from `_ws_reclaim_tail`'s artifacts step as `_WS_RCL_ACT` leaves it,
    and it serves the clips leaf and the temp-root leaf, for both flavours, and later wave 7's collector. It:
    - validates the id;
    - resolves the root physically;
    - removes a link or file leaf with `rm -f --` and never follows it;
    - requires a directory leaf to be a real directory owned by this uid, with its physical path equal to
      root/id;
    - matches an expected `dev:ino` when the caller gives one;
    - removes with `--one-file-system`, so it never crosses into another file system. A bind mount of the same
      file system is a stated residual; only root can make one;
    - checks every exit code, which today's step throws away;
    - proves absence with `_ws_reclaim_absent`.
    It answers three ways: removed or absent, refused (with a reason), or unmeasured.
  - **The in-use probe.** A temp root is in use while any process of this uid:
    - carries `TMPDIR` equal to the leaf or under it in `/proc/<pid>/environ`;
    - has its cwd at or under the leaf;
    - holds an fd at or under the leaf.
    The probe keeps the expire probe's discipline: unmeasured is never "nobody", and an unreadable entry
    is stated. On Darwin it answers unmeasured.
    - **Its walk is a fixed point.** It re-lists the process table until a listing names no pid it has not read,
      within a time limit, so a straggler that forks and exits cannot hide its successor. Running out of time is
      unmeasured.
    - A leader whose own entries read as vanished is asked through its threads. A thread already exiting counts as
      vanishing.
    - It is asked only of a real directory leaf. A link or file leaf is no one's temp root, and is unlinked as in
      wave 3.
  - **The tail.**
    - After the kill, the tail waits, bounded, until the probe answers "nobody" for the temp root. The plan states
      the bound; it is at most 15 s.
    - Then it removes the leaf through the helper.
    - If the probe still answers in use or unmeasured, the tail KEEPS the leaf and its witness and completes the
      reclaim otherwise. The `done` row records the kept leaf in its measurements. That is not a refusal.
    - A clips leaf the helper refuses, or cannot measure, is kept and recorded the same way. Nothing collects a
      kept clips leaf, and that goes to wave 7's pre-flight.
    - The worktree's removal is unchanged except for the wait. A straggler that writes into a removed worktree path
      is a stated residual.
  - **The tail's destructive git calls run contained.** `git worktree remove`, `update-ref -d` and the branch
    delete run under `_ws_reclaim_contained`'s environment. Measured: uncontained, they run the repository's
    fsmonitor and its post-index-change and reference-transaction hooks.

- **R50 — the positive witness.**
  - **Where:** `$REG/tmproots/<id>`, a registry subdirectory with no leading dot, following the `pools/`
    precedent.
    - No registry glob sees it.
    - `_reg_purge` does not remove it, so it outlives the row, which is the case R25 exists for.
    - `_ws_slug_free` does not count it.
    - The server can already read it.
    - A file inside the leaf is rejected, because the session it judges can write it, and so is a sidecar in
      `~/.cc-tmp`, because sessions write straight into that root.
  - **What:** one line, versioned key=value: `v=1`, `id`, `run`, `dev`, `ino`, `btime` (`-` where the filesystem
    has none), `uid` and `at`. The values are taken by `stat` of the leaf right after `_child_tmpdir`'s mkdir and
    chmod.
  - **When:** on every rc-0 answer of `_child_tmpdir`, but written (temp file, then `mv`) only when the witness is
    absent, or its `dev`, `ino`, `btime` or `run` no longer match. It is never written on rc 1 or rc 2. A slug's
    new child overwrites it on its first rc 0. A leaf that exists before wave 6 deploys gets its witness on its next
    spawn.
  - **Death:** only after the removal helper has proven the leaf absent. The order is: remove the leaf, prove it
    absent, then `rm -f` the witness. A witness with no leaf is nothing to do, and is cleaned.
  - **Never:** hand-written, backfilled by a separate pass, or matched by name alone. A leaf whose `dev`, `ino` or
    `btime` does not match is never collected. It is offered to the operator. A storage migration therefore moves
    every pre-migration orphan to the operator, which fails closed, and the audit says so in its own word.

- **R51 — F6 and the harness strip.**
  - **The outermost block of `_ws_reclaim_contained`** unsets `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG` and
    `GIT_CONFIG_COUNT` ABOVE its `GIT_CONFIG_COUNT` computation, so the count starts at 0 and the three pins are
    the only entries.
    - Measured on git 2.43: an inherited `GIT_CONFIG_PARAMETERS` overrides the `hooksPath` pin, `GIT_CONFIG`
      redirects the containment's two `git config` reads, and once the count is unset, stale `KEY_n`/`VALUE_n`
      entries do nothing.
    - A test inherits all three variables and shows `hooksPath` is still `/dev/null`.
    - The comment that calls keeping a caller's entries a feature is rewritten.
    - `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` are the same uid's own files. They stay a stated residual.
  - **The harness strip** is one exported helper in a new file, `server/test/gitEnvStrip.ts`. It returns
    `process.env` minus git's `--local-env-vars` list, `GIT_NAMESPACE` and the `GIT_CONFIG_KEY_`/`VALUE_` entries.
    - The reclaim and expire fixtures import it wherever they spread `process.env`.
    - It is never put inside `ghContainedEnv`, whose callers pass git variables on purpose.
    - `ccdWsHelpers.ts` is touched only under R56's overlap rule.
    - A pin sets `GIT_DIR` and shows the harness drops it.
  - F6 reaches `ws-expire` through the shared containment, and workspace-lifecycle's coordinator is told.

- **R52 — journaling (amends R5′).**
  - **`probe-unmeasured` is journaled as `failed`,** with one new `LcRefusalToken`, in both the reclaim arm and
    the `ws-audit` arm. The journal row's `verb` tells the two apart.
    - A `failed` line is already a failure line under wave 5's reader, so every server from wave 5 on reads it the
      same way.
    - R5′'s "audit-time journaling is terminal-only" gains this one exception. R20's backoff bounds the repeat.
  - **The pre-lock dies tied to an id** (a bad token and a bad run id) are journaled as `refused` with new tokens,
    after the session id is validated. Each is classified in `CHILD_RECLAIM_PRE_LOCK_TOKEN` (R43).
  - **Three dies stay unjournaled, each with its stated reason:**
    - the usage die and a bad session id, because neither has a trustworthy id;
    - python3 unavailable, because the journal encoder is python3.
  - `flock-unavailable` and `lock-unopenable` already journal.
  - `ws-expire`'s twin of `probe-unmeasured` is workspace-lifecycle's region, and wave 6 leaves it alone.
  - Every new token carries what R43 requires:
    - a `LC_REFUSAL_WORD` sentence;
    - an `ALL_TOKENS` entry;
    - disjointness from `SENTENCES`;
    - one literal call site;
    - no comment that spells a token-harvesting shape.

- **R53 — the gone-branch pin.**
  - **Absence is proven by `git show-ref --exists`.** It answers rc 0 for present and rc 2 for absent; any other
    answer is unmeasured.
    - Measured on git 2.43: `rev-parse --verify --quiet` and `show-ref --verify --quiet` both answer rc 1 for an
      absent ref, a corrupt ref and an unreadable `refs/heads`.
    - **Old git.** A git older than 2.43 rejects the flag. A successful
      `rev-parse --verify --quiet refs/heads/<b>^{commit}` then still reads present, and anything else reads
      unmeasured.
      - Only `--exists` rc 2 ever proves absent.
      - So a box on an older git (Apple's 2.39, for one) reclaims present branches as today, and fails closed on a
        gone one: unmeasured at the audit, never `pin-failed`.
      - A case pins both.
  - **Every arm takes the three-way read, in one act:**
    - the ladder's tip reads, the present arm and R19's vanished arm alike;
    - the pin;
    - the vanished arm's pin read;
    - the tail's step-5 branch test.
    The token carries an explicit `branch=absent` input, so a token minted over an unreadable ref can never be spent
    as absent. A read failure at step 5 stops the tail with a new `failed` token, `branch-unmeasured`, which
    carries its own sentence.
  - **A proven-absent branch** pins HEAD, the WIP commit and every per-worktree ref and reflog commit (most of
    which the pin already walks), deletes no branch, and the reclaim proceeds.
    - If the branch reappears after the tombstone, the tail stays `branch-moved`.
    - A symbolic registry branch reads unmeasured. Every branch delete in the tail is
      `update-ref -d --no-deref`, so no delete follows a symref to the branch it names.
    - A worktree whose HEAD is still symbolic to the gone branch stays `pin-failed`, because the WIP commit needs a
      HEAD.
  - Spec §5.5 step 3 reads "the branch tip when the branch exists".
  - The manifest and PR-phase reads (`ccd/ccd:10001`, `:10600`) keep their two-way read, which is a carried
    residual, because they are outside the RECLAIM region.

- **R54 — the gone-directory alternate-row recovery.**
  - **It lives inside `_ws_reclaim_workdir_shared`,** as a second placement basis, `recorded`, beside `complete`.
    One resolver keeps answering the audit, the locked recomputation and `_ws_reclaim_owned` (R31).
  - **A row whose workdir is gone stops holding other children only on positive evidence.** That is either arm:
    - **The git-record arm:**
      - exactly one `<common>/worktrees/*/gitdir` names `<w>/.git`;
      - git's porcelain list marks that stanza prunable;
      - the leaf is the only absent component;
      - the parent resolves `complete` to its literal spelling.
      The row is then placed by that physical path.
    - **The breadcrumb arm:**
      - the row's `.reaping` phase is `branch`, `artifacts` or `clips` (for a reclaim, only with the tombstone's
        `worktree: present`);
      - the tombstone's uuid and workdir equal the row's.
      It applies only while git keeps NO record of the tree. A breadcrumb says ccd got past a step, not that ccd
      removed the tree, and a moved tree's record is the git arm's to judge. This is the arm that ends D-3734's
      "two interrupted children hold each other", because after ccd's own `git worktree remove` the git record is
      gone too.
  - **The lifecycle `create` row only corroborates,** and never decides alone.
  - **The moved-tree hole is closed.** No nested checkout of the child, of any repository, may resolve
    `--absolute-git-dir` to the admin directory a recovered row named. It is asked after the nested scan and again
    in `_ws_reclaim_owned`.
  - **The recovery never:**
    - creates a directory at a gone path (D-3735);
    - runs `git worktree prune`;
    - removes the admin directory or purges the other row;
    - reads `/proc`, a pane's cwd, tmux or unit state;
    - follows a leaf link;
    - treats an unreadable `worktrees/` or `gitdir` as "no record".
    Each arm fails closed, and device and inode ancestry stay the path-identity follow-up's.

- **R55 — `vanish-reread-races-mirror` is fixed by a second trigger.** This supersedes the carried candidates.
  - **The fix:**
    - The journal mirror keeps the newest `at` of a reclaim-`done` row it has parsed, in memory, only ever rising.
    - The `coord` frame carries it as one new optional field, read through one PWA reader under absence-permits.
    - The board re-reads the archive when that value CHANGES (never "increases", because a restart reads null) and
      some finished row's chip is still unsettled.
    - When a child-marked id leaves the listing, the watcher resets the mirror's clock without awaiting it, so the
      correction usually lands within one tick.
  - It fires once per measured fact, so it is not a retry cadence. It adds no await to the tick, and changes neither
    the tick's order nor ccd's journal.
  - **Why not the other candidates:**
    - Option A alone still races, because the forced sweep can land inside the gap between the purge and `done`.
    - Reordering ccd alone changes nothing, because nobody awaits the mirror.
    - Both together would change what `done` means in the tail `ws-expire` shares.
  - **A disclosed residual:** ccd dying between `_reg_purge` and `_lc_done` leaves a null chip and no attention
    entry. If that is ever fixed, it is by reading the tombstone, never by reordering ccd.

- **R56 — landing order and overlaps.**
  - **#290 lands first, and wave 6 is dispatched only after it has merged.** So the worker branches from a `main`
    that already carries wave 5, and every R43 classification edit lands on wave 5's code as merged. Whenever the
    worker absorbs `main`, it does so with `git merge`, never a rebase.
  - **The overlap rule with workspace-lifecycle (quiet-river), which also coordinates run 274:**
    - It covers `ccd/ccd`'s RECLAIM and EXPIRE regions, the spawn gate and `_child_tmpdir`, plus `ccdWsHelpers.ts`
      and `README.md`.
    - Edits are additive, in their own regions.
    - The in-use probe is a new function. Wave 6 never edits `_ws_expire_cwd_users`'s body, and folding the two
      probes into one waits until WL 3b's precondition has landed.
    - The second lander merges `main`, re-stamps `ccd/ccd`, and re-runs `ownership.test.ts`,
      `mark.mjs --check`, the citation cases and `deviation-refs`.
  - **The citation tax.**
    - README holds no `ccd/ccd` anchor any more. Its tax is `shared/api.ts` and `session-hook.sh` only, so the
      S6-R11 re-pointer in the continuity plan is stale.
    - Any edit above `ccd/ccd:19109` (the caps list, the entry boundary, `_ws_slug_free`, the LC region) stays
      length-neutral, or re-measures the census with the instrument.
  - New cases go in new test files, because of the 600 s foreground ceiling.

- **R57 — wave 7's outline: the collector verb.** Wave 7's own pre-flight rules the detail.
  - **Shape:** a new sibling verb, as `ws-expire` is. It has:
    - an audit that mints a token on an existing granted shape;
    - a destructive verb gated on `--expect`;
    - its own lifecycle act, capability token and agent grant;
    - the entry guard and `is_protected`;
    - the shared reap lock;
    - `reclaim-paused` honoured inside the lock;
    - R49's helper and probe.
    It is not a flavour of `ws-reclaim`, because rung 2's marker does not exist for this population. Nor is it a
    mode of `ccd-tmp-sweep`, which the agent cannot run and whose root rule keeps the two collectors disjoint.
  - **A leaf is a candidate only when all of these hold:**
    - its witness matches its `dev`, `ino` and `btime`;
    - `_ws_slug_free` answers free (dot-locks are not rows and are never unlinked);
    - the in-use probe answers nobody;
    - the newest of ctime and mtime over every entry under the leaf, the leaf included, is at least 24 h old (a
      knob that can only be raised);
    - it was observed twice, on the server's monotonic clock, with an unchanged token.
  - It audits only witnessed ids, so it never takes a lock for a foreign name.
  - Before wave 7 ships, its plan proves that no spawn under a recycled slug can have its leaf removed: a rename
    into a same-filesystem quarantine under the lock, or an equivalent.
  - It is Linux-first: on Darwin it is unmeasured, which refuses.

- **R58 — wave 8's outline: the lane.**
  - It is dispatched only after workspace-lifecycle wave 3b merges and the fleet box's `ccd caps` advertises wave
    7's token.
  - It lists witnessed candidates through the registry read the server already has.
  - It honours `reclaim-pause`, R39's pacing class and the attached-session defer.
  - Its SAFETY and SECURITY lenses are mandatory.

- **R59 — live residue stays the operator's.** No session acts on any of it.
  - **The leftovers in `~/.cc-tmp`:**
    - `ccrc-pwa-swift-hollow`'s empty, unwitnessed leaf;
    - the foreign entries in `~/.cc-tmp`, measured 2026-10-06 at 18 directories and 105 loose files, about 6.66 GiB.
  - **`project-a-calm-mesa`** (branch proven absent; HEAD and every reflog commit on `origin/main`; clean
    tree) reclaims on its own once wave 6's gone-branch pin is live. Until then the operator may recreate the branch
    at HEAD to reclaim it sooner.

### §12 as built (wave 6, run 291)

Where wave 6's code and its draft rulings narrowed or spelled out R48–R59, sections 1–11 now read as follows.
This note amends; it edits no earlier text.

- **R5′.** Audit-time journaling is terminal-only, with one exception (R52). `ws-audit --reclaim`'s unmeasured
  answer writes one `failed` `probe-unmeasured` line with verb `ws-audit`. The locked recomputation writes the
  same word with verb `ws-reclaim`. `ws-expire`'s own unmeasured answer stays unjournaled: it is
  workspace-lifecycle's region.
- **R43.**
  - "Exactly these two tokens, by name" now names four: `flock-unavailable`, `lock-unopenable`,
    `token-malformed` and `run-id-malformed`, each in `CHILD_RECLAIM_PRE_LOCK_TOKEN` and its die pattern.
  - "The failures the mirror never sees" are now the usage die, the four `--actor`/`--reason` checks, a
    malformed session id, and `python3` unavailable. Each stays unjournaled for its stated reason.
  - `probe-unmeasured` and `branch-unmeasured` are `failed` lines, read as failure lines with no
    classification.
  - The server's one-word `CHILD_RECLAIM_PROBE_UNMEASURED` no longer exists. `CHILD_RECLAIM_PRE_CRUMB_FAILED`
    replaced it in fix round 1: `['probe-unmeasured', 'state-changed']`, typed `as const satisfies readonly
    (LcRefusalToken | ChildReclaimToken)[]`. It is a union because `state-changed` is a `ChildReclaimToken`, not an
    `LcRefusalToken`, and a typo in the set is a compile error.
  - **A `failed` word printed before the breadcrumb reads `not-resumable`, on the fresh arm.**
    - `parseChildReclaimResult` reads a `failed` word in that set as `not-resumable`, and every other `failed` word
      as `resumable`. `state-changed` (the consent binding, spec §5.5) stops the act before the tombstone and the
      breadcrumb, so nothing had started, and the feed says the act is retried from the start. It no longer says
      the box resumes where it stopped. `state-changed` is printed on the fresh arm only, because only the fresh arm
      runs the pin phase. `probe-unmeasured` is pre-breadcrumb on the fresh arm only (see the resumed-arm residual
      below).
    - `pin-failed` and `tombstone-unwritable` stay `resumable`. Each is printed once in the fresh path's pin
      phase, before the breadcrumb, and also by the tail after it (eight producers of `pin-failed` and five of
      `tombstone-unwritable` in the tail), so the word alone cannot tell the two apart.
    - That is a stated residual, carried to wave 7. A `pin-failed` or `tombstone-unwritable` printed in the pin
      phase reads `resumable`, so the feed says the box resumes where it stopped of an act that is retried from the
      start. `ws-expire`'s pin phase prints the same two words before its own breadcrumb, and its parser, which is
      workspace-lifecycle's, reads them the same way. The fix is an additive `crumb:false` field on ccd's document.
    - **The resumed arm's `probe-unmeasured` is a second residual, carried to wave 7 with the same field.** The locked
      recomputation prints `probe-unmeasured` for any unmeasured verdict, and on a resume that verdict can come from
      the resume's own reads (an unreadable tombstone, for one) while an earlier attempt's breadcrumb (for example
      `reclaim:artifacts`) still stands. The server reads it `not-resumable`, so the feed says the act is retried from
      the start, but the box's next attempt resumes from that breadcrumb and completes. It is the mirror image of the
      `pin-failed` case: the same kind of fault, a wrong sentence and never a wrong act. The classification is unchanged in
      wave 6. It agrees with the scoped sentence of `LC_REFUSAL_WORD['probe-unmeasured']` ("this attempt started
      nothing and removed nothing"), which says only what THIS attempt did.
    - **The audit path reaches the same residual, and first.** `ws-audit --reclaim` runs before the verb and goes through
      the same `_ws_reclaim_resume_eval`. Over a standing breadcrumb with an unreadable tombstone it exits 1 with
      `{"resume":…,"verdict":"unmeasured"}` and journals `probe-unmeasured`. The server maps the audit's non-zero exit to
      `unreadable` (`childReclaimAudit`), and the executor then reads not resumable. So the feed says "retried from the
      start" on every attempt while the tombstone stays unreadable, yet ccd's next attempt resumes from the breadcrumb.
      The verb arm is reached only in an audit-to-verb race. Wave 7's `crumb` field carries it.
  - `die "bad run id"` was reclaim's alone, so the sanctioned unjournaled set narrows by one.
- **R31's stated cost.** A row whose directory is gone now holds only while neither arm of R54 places it.
  - Two interrupted children whose trees the tail removed release each other through the breadcrumb arm.
  - Two hand-deleted children of one repository release each other through the git-record arm.
  - These still hold: an unreadable `worktrees/` or `gitdir`, two admin entries naming one tree, a locked
    record, a gone parent or one reached through a link (on the git-record arm; the breadcrumb arm places such
    a row by its literal spelling, below), an interrupted expiry's breadcrumb, and a lifecycle `create` row
    alone.
  - R54's "only corroborates" is built as "never an input".
  - A breadcrumb-arm row is placed by its literal spelling. The ladder header's "compared exactly as a
    `complete` row is" holds for the git-record arm only: a breadcrumb-arm row spelled through a link is
    compared as text (the coordinator's ruling that such a row is placed by its literal spelling). A spelling
    with a `.` or `..` component, a trailing `/` or a `//` is refused before either arm, so such a row holds
    and is never compared as text. That is bounded. The leaf is proven absent, `_ws_reclaim_owned` asks again
    at the tail, and a re-created tree resolves `complete` and holds.
  - The moved-tree refusal reuses `containment-unproven`, whose copy only approximates that case.
- **R54.** The breadcrumb arm also proves that no admin entry names the tree, asked of the git-record arm's own
  reader. Git's list silently omits a record whose `gitdir` it cannot read, so its "no record" alone would read an
  unreadable record as none. An unreadable `gitdir` or `worktrees/` therefore keeps the hold.
- **R54's moved-tree hole (fix round 1).** R54's ruling says "The moved-tree hole is closed", and it asks the
  question of the child's nested checkouts. That reads the worktree alone, and the tail deletes three trees: the
  worktree, `~/.cc-clips/<id>` and `~/.cc-tmp/<id>`. Another session's tree moved into either leaf was placed by the
  recovery (git reads its record as prunable) and removed with the leaf, where base held the child `unmeasured`.
  As built, the hole is closed for all three trees: the worktree by R54's own check, which is unchanged and asks
  only of the worktree, and the clips directory and the temp root by two rules.
  - **The removal helper keeps a leaf holding a checkout git links elsewhere.**
    - `_ws_leaf_remove` asks `_ws_leaf_checkouts` of every directory leaf, after the identity checks (real
      directory, owner, device and inode, mount, owner bits, physical path) and before it normalises or removes
      anything. The question is row-agnostic and asked at the instant of removal, so every caller inherits it: step
      6's clips leaf, `_ws_tmproot_remove`, ws-expire's clips leaf and wave 7's collector.
    - A refusal (rc 1) or an unmeasured answer (rc 2) leaves everything under the leaf untouched. Step 6 keeps and
      records it (`clipsKept` or `tmpRootKept`, `refused` or `unmeasured`, on the done row and in the done document)
      and the act completes: the leaf check never fails the tail. A link or file leaf is unlinked and never scanned.
    - The one write before the question is the owner-bits pass on the leaf itself, which has to run so the leaf can
      be entered. A foreign tree moved in AS the leaf therefore has its root's owner bits set (555 reads 755
      afterwards) even when it is then refused. The question comes before the permission pass and the `rm`, which
      reach the whole tree.
    - The scan is `find -P` from the leaf's physical path, never across a file system, at depth 1 or deeper (so a
      tree moved AS the leaf is seen), bounded by `REAP_SCAN_SECONDS`. At most 64 entries named `.git` are
      examined. A timeout, any find error (an unreadable directory included) or a 65th entry is unmeasured.
    - Each `.git` is asked without being followed, and git is never run inside a leaf. A link is refused. A
      directory, a full clone, passes. A file must be exactly one `gitdir: <path>` line of at most 4096 bytes, else
      it is unmeasured. The admin directory it names is resolved physically, a relative path against the `.git`
      file's own directory as git does. A `..` after another component of a relative gitdir, or any `..` in an
      absolute one, is unmeasured. One proven absent refuses, because git no longer records the tree. One that
      cannot be resolved is unmeasured. One inside the leaf passes: a submodule, or a worktree of a clone in
      the leaf. One outside the leaf passes only as a linked worktree whose admin `gitdir` back-link names THIS
      `.git`, literally or by its directory's physical path, and refuses otherwise. That clause also catches a
      recycled admin name, where a later `ws-add` recreated `worktrees/<name>` for another workspace. A refusal
      outranks an unmeasured entry, whatever order find lists them in.
  - **A registry row at, inside or through a leaf is nested.**
    - `_ws_reclaim_workdir_shared` compares every row, standing or recovered by either arm, against the two leaf
      paths as well as the worktree, in one registry pass, by the four comparisons the worktree uses (literal equal
      or inside, resolved equal or inside) and THROUGH. A leaf proven absent is skipped.
    - Such a row refuses `containment-unproven` at reclaim and at expire alike. No word is added: an unknown word
      reads "unreadable" to the expiry lane. This also closes the older shape, a standing row inside the temp root
      that was removed with the leaf.
    - A leaf whose absence cannot be proven, or whose root cannot be resolved, answers unmeasured.
  - **Limits, stated.**
    - A tree stripped of its `.git`, or content that is no checkout, parked in a leaf is not seen. Base held
      these only by accident, through the blanket hold on a gone row.
    - The question and the `rm` are two looks, not one. A same-uid rename in between is removed with the leaf,
      which wave 7's quarantine rename closes.
    - Beside it, a registry row placed into a leaf after `_ws_reclaim_owned`'s ask at the start of the tail is not
      asked again at step 6. The removal-time question and the temp root's in-use probe still stand, and the
      worktree has the same window class.
    - A clone, a submodule of one, or a worktree of one inside a leaf is the leaf's own and goes with it. That
      includes a foreign MAIN checkout, a `.git` DIRECTORY, moved into a leaf: with no registry row naming it, it
      passes the question and is removed with its object store. This is ruled, because a clone in a leaf is the
      leaf's own. A registry row that names the moved tree's old path is a gone row, and the blanket hold on a gone
      row keeps the child `unmeasured`.
    - The bind-mount alias spelling of a leaf is not compared. This is the existing residual.
    - On a case-insensitive file system (Darwin APFS), a hand-renamed `.GIT` that git honours is missed by
      `find -name .git`. Git never writes that name.
- **R49.**
  - The bound is `WS_RECLAIM_TMPROOT_WAIT_S=15`, lowered only by `CCD_RECLAIM_TMPROOT_WAIT_S`.
  - The wait also ends after `bound*4+1` asks, whichever comes first. The clock alone is not a bound when it steps
    backwards.
  - The probe's walk is bounded by `WS_PATH_USERS_SCAN_S=10`, and an expired walk is unmeasured.
  - The `done` row and the three purge-failure rows carry `meas.tmpRootKept` (`in-use`, `unmeasured` or
    `refused`) and `meas.clipsKept` (`unmeasured` or `refused`), each omitted when nothing was kept.
  - The tail's stdout done document (one `printf`, both verbs) carries the same two words as additive keys,
    `clipsKept` and `tmpRootKept`.
    - Each is the kept word (`refused`, `unmeasured` or `in-use`), or `null` when nothing was kept. A `case` over
      the three words prints them, with no encoder in the way: an empty value prints `null`, and any other value
      prints `"unmeasured"`, never `null`. A kept leaf therefore never reads as nothing kept.
    - A document from an older ccd omits both keys, and a reader treats absence as unmeasured, never as gone.
    - No server reader is added in wave 6. The expiry lane's reader is workspace-lifecycle's next wave, and the
      reclaim side's reader is wave 7's collector. Both parsers read named keys only, so the keys are safe to ship
      agent-first.
  - Each kept reason is cut at 300 bytes of printable ASCII and marked with a trailing "…". Uncapped, a long
    or non-ASCII reason would grow at the journal's encoder until the whole `meas` object were dropped.
  - A clips leaf is kept and recorded the same way as a temp root.
  - A same-uid process the kernel will not let ccd read, or another uid's process, is skipped as a stated
    limit, as the expiry probe does.
  - A process, or one of its descriptors, that exits mid-walk is skipped on proof that it vanished (ENOENT or
    ESRCH), at every read the walker makes, the per-descriptor `readlink` included. That read once caught ENOENT
    alone, so a process that exited between the descriptor listing and the read made the whole walk unmeasured, and
    the tail kept a temp root nobody was using.
  - The helper refuses the whole directory leaf while an entry stays unreadable, so nothing is removed in
    part.
  - The helper also refuses a directory leaf whose device is not its root's (a mount of another file system at
    the leaf), comparing the two before any chmod or rm. A same-file-system bind mount at the leaf carries the
    root's device and is not seen. The helper never uses a root that resolves to nothing or to `/`, and it sets
    the leaf's own owner bits before entering it.
  - **One function resolves a directory's physical path, `_ws_dir_physical`, and it refuses a newline.**
    - A bare `$(cd … && pwd -P)` drops every trailing newline, so a root that resolves to `<vol>\n` read as
      `<vol>`, and `<vol>/<id>`, outside the root, was removed while the real leaf stood. The function uses
      `_ws_reclaim_resolve`'s sentinel idiom, reads the physical path whole, and answers non-zero when the
      directory cannot be entered, the sentinel is missing, or the path holds a newline anywhere.
    - Three sites carry the newline refusal, each mapping it into its own unmeasured arm: the helper's root
      (`_ws_leaf_remove`, rc 2), the in-use probe's parent (`_ws_path_users`, rc 2, where the stripped newline failed
      open), and the expiry probe's parent (`_ws_expire_cwd_users`, whose resolution alone changed, with
      workspace-lifecycle's consent).
    - Fix round 1's checkout question resolves through the same function too (the leaf, each admin directory and each
      checkout's own directory, for the back-link compare), as does the leaf placement in `_ws_reclaim_workdir_shared`. Each maps a failure to
      unmeasured.
    - The leaf's own path takes no sentinel. Under a newline-free physical root, a leaf that is no link resolves to
      exactly `<root>/<id>`, and only a link swapped in between the link test and the `cd` could differ, the same-uid
      check-then-act window the moved-tree bullet above states.
  - On Darwin the helper removes with `rm -rfx`.
- **R50.**
  - `run` joins the staleness test.
  - An unparseable witness is stale and is rewritten.
  - `uid=` is recorded only after the owner test proves the leaf is this uid's.
  - A dot-leading id is refused.
  - A `$REG/tmproots` that is itself a link is never followed: the writer refuses it, the reader answers 2, and
    the remover warns and leaves what it reaches.
  - Birth time comes from `_plat_btime`, in the platform block of both `ccd/ccd` and `ccd/ccrc`.
  - The tail passes no expected device and inode, because the row and the marker prove identity there.
- **R51.** The harness strip is `inheritedEnv()` (`server/test/gitEnvStrip.ts`). It is applied at every
  `process.env` spread, and at every option-less git spawn in the reclaim and expire fixtures. Whatever selects
  git's global or system config file (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG_NOSYSTEM`, and
  `HOME` or `XDG_CONFIG_HOME`) names this uid's own files and sits below the pins' command-line precedence, so it
  stays the stated residual R51 names.
- **R53.**
  - The token's absence input is spelled `branchState=present|absent`, because a second `branch=` line would
    collide with a branch named `absent`. An unmeasured read mints no token.
  - On old git, the positive fallback reads present for a branch that resolves, and unmeasured for anything
    else. R53's "never `pin-failed`" holds on the fresh path only: a resume that enters at `children` or `worktree`
    stops `pin-failed` at the settle (see the old-git residual below).
  - A step-5 read failure is the new `failed` token `branch-unmeasured`.
  - The consent binds the branch's state in both directions. A pin that reads the branch in a different state
    from the in-lock recomputation stops `state-changed` before the tombstone, journaled as a `failed` line.
  - A token minted before the fleet box converged, and spent after it, answers `state-changed` once, on both
    verbs.
- **R55.** `CoordStatus.childReclaimDoneAt` is omitted, never null, while unmeasured. Only a `child` mark
  leaving the listing resets the mirror's clock, and only a reclaim `done` row raises the value.
  - The board's cold read keeps a high-water mark (fix round 1). Each read takes a number, and only a read newer
    than the last applied one sets the chip, so an older read that lands last cannot undo a newer one.
  - A stale rejection sets no error, and a rejection never advances the mark. The mark advances only after the
    body is read, so a success whose body cannot be read still shows the error state.
- **Carried residuals:** spec §7 item 6 holds the stated list. Wave 6 also measured these, in plain words:
  - **Temp root.**
    - The helper's device check and `rm --one-file-system` compare `st_dev` alone. A mount of another file
      system at the leaf is refused, because its device differs from the root's, compared before any chmod or
      rm. A same-file-system bind mount at the leaf is not seen, as inside it, where `rm` crosses it.
    - A mount made at the leaf after that check, during the permission pass, is not seen.
    - The owner-bits chmod dereferences its operand. This is bounded to this uid's own files and owner bits.
    - A probe answering in-use OR unmeasured (always, on Darwin) over a leaf PROVEN absent drops the witness and
      records nothing kept.
      - The drop is `_ws_tmproot_witness_drop`, and `_ws_reclaim_absent`'s rc 0 is the only licence for it. Those
        arms never go through `_ws_tmproot_remove`, whose leaf half would run an unprobed `rm` on a leaf
        re-created in the window.
      - If the absence cannot be proven (rc 2), the leaf is kept and recorded `unmeasured`, and the witness stays.
      - A leaf re-created between the proof of absence and the drop, or by a user that outlives the bound after
        `done`, leaves a leaf with no witness: a leak, never a loss, because no collector takes an unwitnessed
        leaf.
    - **The checkout scan fails closed, and it leaks.** A temp root that holds any directory ccd cannot read, more
      than 64 `.git` entries, or a tree whose walk outlasts `REAP_SCAN_SECONDS` is kept `unmeasured` on every pass,
      where the permission pass used to normalise it and remove it. A clips leaf is mostly spared the first shape,
      because rung 8 normalises clips before the tail. The coordinator measured, on 2026-10-08, 47 `.git` entries in
      6 of 45 temp roots and none in `~/.cc-clips`, so no root was near the cap.
    - With no birth time (`btime=-`), a witness binds dev and ino alone. Wave 7 must not take such a witness on
      dev and ino alone, and must treat the reader's rc 2 as "offer to the operator, never take".
    - A writer killed between its `printf` and its `mv` leaves a dot-leading temp file in `tmproots/`.
    - Nothing collects a kept clips leaf. That is carried to wave 7's pre-flight.
  - **The wait.** It ends by the clock or after `bound*4+1` asks. Under a frozen clock with every walk timing
    out, it can reach about 10 minutes. That is past the 240 s remote budget, but a remote kill lands in the wait,
    before any deletion, and the breadcrumb resumes. The measured worst case with a working clock is about 35 to
    41 s.
  - **Branch.**
    - A tip that MOVES while the branch stays present, between the in-lock recomputation and the pin, is still
      taken over. The compare-and-swap at the pinned tip bounds it.
    - `ws-expire` keeps the recomputation-to-pin branch-state window, because `_ws_expire_locked` is
      workspace-lifecycle's. A branch created in that window is still adopted at its pinned tip there.
    - On a git older than 2.43, a resume whose branch is already gone fails closed on every retry, at one of two
      places.
      - A resume that reaches the tail's branch step reads `unmeasured` at step 5.
      - A resume that enters at `children` or `worktree`, with the branch present at the pin and deleted by someone
        after the tombstone, never reaches step 5. The settle's pin reads `unmeasured` and stops `pin-failed` on
        every retry, with the tree, the breadcrumb and the row standing and nothing deleted.
      - Both are leaks, retried for ever, on old git only. The fleet runs 2.43.
  - **Gone directory.**
    - A stray non-directory entry under `<common>/worktrees/` holds every recovered row of that repository. It
      fails closed, and its reason reads "cannot be searched".
    - Rung 8 (the child's OWN record) still reads git's silent omission as "no record". This is wave-3 code,
      carried.
  - **Journal.**
    - The entry regex admits `.`, `..` and dot-leading session ids. This is pre-existing. Such an id is only a
      JSON field in the journal, and every path site refuses it.
    - A later wave may adopt a no-dot-leading rule at the `ws-reclaim` and `ws-expire` entry.
  - **Board.**
    - An older `done` `at` arriving after a newer one moves nothing.
    - A `purge-incomplete` reclaim journals `failed`, not `done`.
    - A reset sweep that lands between the purge and the `done` can delay that `done`'s ingest by up to 5 s.
    - In each of these the chip settles on the next board load.
  - **The wave-3 ladder.** The raw `_WS_NORMALISE_WHY` refusal detail, a session-chosen filename, is uncapped.
    An over-cap refusal row falls to the encoder's fallback and loses `detail`, `verb` and `dec.*`. Carried; not
    this wave's code.
  - **Recorded, carried to wave 7.**
    - `_ws_reclaim_owned`'s moved-tree arm fails resumable `worktree-remove-failed` on every resume while a foreign
      tree stands in the child. It is fail-closed and deletes nothing. It joins wave 7's persistent per-child
      failures that retry for ever. The expiry lane's answer to a repeating resumable failure is
      workspace-lifecycle's.
    - The nested leaf rows have the same shape. An unprovable leaf, or a standing row at, inside or through a leaf, makes
      the tail fail resumable `worktree-remove-failed` at its start, on every resume, until the row or the leaf is
      fixed. A fresh reclaim is held at the ladder instead, and nothing is deleted in either case.
    - The pre-breadcrumb `pin-failed` and `tombstone-unwritable`, and the resumed arm's `probe-unmeasured` (see R43
      above), wait for the additive `crumb:false` field. That field marks a document with or without a breadcrumb, so
      it covers both directions. The resumed arm's `probe-unmeasured` is reached through the audit path too:
      `ws-audit --reclaim` over a standing breadcrumb with an unreadable tombstone exits 1, the server reads it
      `unreadable`, and the executor reads not resumable, so the feed's "retried from the start" is wrong there on
      every attempt while the tombstone stays unreadable. A wrong sentence, never a wrong act.

## 13. Rulings, 2026-10-06 (wave 5's fix round 1) — binding; they AMEND sections 1–12

- **R60 — `child-birth-unplaced` is a doubt word (fix round 1's F11, number 3941).** This amends R41's class table.
  - The kept class loses `child-birth-unplaced`, and the doubt class gains it.
  - Its sentence reads like the other doubt words: the sweep reads it again on its next pass. It does not end
    "ccrc never reclaims it on its own", and it writes no `child reclaim kept` feed row.
  - The reason is R40's own list: "an unplaceable birth" is doubt there, and each judging pass places the birth
    afresh, so the word can end with no person acting.
  - The spec's §5.9 lists it with the doubt words from wave 5's PR on.
- **R61 — `kept-word-ends-on-late-birth` is a stated residual (number 3944).** It is display-only and gates nothing.
  - **The window.** A slug is recycled, and its new `create` is not placed yet: either it is not ingested, or its
    `at` is ahead of the server's clock. Meanwhile the new marker's minting run is already past `minting-run-open`.
    A judging pass then reads the older generation's birth (`childReclaimBornAt` reads `create` events only). It
    can answer `minting-run-postdates-child`, or, negligibly, `coordinating`.
  - **What that costs.** The chip reads `refused` with a kept sentence, one `child reclaim kept` feed row is
    written, and the banner lists the child. Once the new birth is placed, the same child can turn eligible and is
    reclaimed, so "ccrc never reclaims it on its own" was false for it. The eventual reclaim is correct. In normal
    operation the window lasts seconds.
  - **What stands.** The kept sentences and the spec's §5.9 ending stand unchanged; this is not reworded away.
  - **The closure goes to wave 7's pre-flight,** beside R57's recycled-slug proof. The direction:
    - The birth reader treats the last placed `create` as unplaced when a placed removal of the same id follows it.
      That makes the answer doubt (R60).
    - It never compares the birth with the minting run's dispatch. That comparison would fold every truly
      postdating run into doubt and empty `minting-run-postdates-child` of its meaning.
- **R62 — three stated residuals of fix round 1 (review 303's G3).** "Left as ruled" in number 3939's definition is true
  from this ruling on.
  - A recycled slug's non-kept verdicts (held, doubt, eligible), and its old sweep entry's defer fields, carry no run. So
    they can show on the new run's chip for at most one pass. This is display-only.
  - Under a persistent mirror-read failure, the published attention list keeps its last items until a pass publishes
    again. This is display-only.
  - A same-run re-mint of the same slug is not told apart. That is number 3940's window, as its definition states it.
- **R63 — two pre-existing recycled-slug paths go to wave 7's pre-flight (review 303's X1 and X3).** Neither came in
  with wave 5, and each answers the same on wave 4's code.
  - **X1, SAFETY class.** A licensed request already queued (`deferExpired`) can reach the SAME run's re-minted
    workspace. The executor re-proves the request against the marker's run id alone, and presence is skipped under
    `deferExpired`.
    - The direction: the executor re-proves a licensed request against the generation it was judged under (birth
      and marker run). A licence never crosses a generation.
  - **X3.** The hold-retired memory is keyed by session id, so a slug recycled inside one pass gap queues `ws-release`
    one pass early. `releaseRetiredChildHold` still re-proves its six facts.
    - The direction: key it by generation.
  - Wave 7's SAFETY lens covers both, beside R57's recycled-slug proof and R61's closure.
- **R64 — wave 6's fix round 1 (review 335).**
  - **"Inside the child" means all three trees the tail deletes:** the worktree, `~/.cc-clips/<id>` and `~/.cc-tmp/<id>`.
    - **The removal helper itself refuses** (rc 1, touching nothing) a directory leaf that holds a `.git` file linking to
      an admin directory OUTSIDE the leaf, unless that admin directory's `gitdir` back-link names this checkout. A
      missing admin directory also refuses. An unreadable entry, a timeout or more checkouts than the cap answers
      unmeasured. A clone, or a submodule whose admin directory lies inside the leaf, is the leaf's own.
    - The tail then KEEPS and records that leaf, and the act completes.
    - Every caller of the helper inherits the rule, wave 7's collector included.
    - **Registry rows** at, inside or through either leaf are NESTED.
    - This closes review 335's F1 (a regression of R54's recovery) and the pre-existing shape of a registry row inside
      a leaf.
  - **R53, qualified.** "Never `pin-failed`" holds on the fresh path only. On git older than 2.43, a resume entering
    at `children` or `worktree`, after the branch was deleted past the pin, stops `pin-failed` at the settle on every
    retry. Nothing is deleted.

## 14. Rulings, 2026-10-08 (wave 7's pre-flight) — binding; they AMEND sections 1–13

Wave 7's pre-flight was measured at `b0647d850` by five Opus readers and a completeness critic. The coordinator then
drafted these rulings, and four Opus attackers (SAFETY at xhigh) attacked the draft. Every break they constructed is
closed below. Evidence: the coordinator's `ccr15-evidence-archive/wave7-preflight/` (`preflight.json`, `attack.json`).

- **R65 — the waves are re-cut, because R63 conflicts with R38/R48.**
  - **Why.** X1, X3 and R61's closure are server code. X1 changes when `ws-reclaim` is licensed, which is a second
    destructive subject, and R38/R48 allow one per SAFETY panel.
  - **This amends** R48 (the lane becomes wave 9), R58 (renumbered), R63 (its lens assignment), spec §8 and the
    ledger table.
  - **Wave 7 (run 347): the collector verb** (R66–R68). ccd and the agent grant, AGENT-FIRST and inert. It also carries:
    - the ccd halves in R69 and R70;
    - the ccd half of X1, which binds the reclaim token to the workspace's generation: an additive audit field and a
      token input, minted with the row and never rotated by `/clear` or a swap. Task 0 measures whether
      `$REG/<id>.generation` is that value;
    - R69's word, declared with its emission in one commit.
  - **Wave 8: reclaim's server half.** Server code only. Its SAFETY subject is "what `ws-reclaim` is licensed
    against". It carries:
    - X1's server half (the queued licence is keyed on the generation) and X3;
    - R61's closure. Its removal set is derived once, EXCLUDES the collector's act, and is pinned by a case;
    - the `crumb` reader on the verb's failed document;
    - the audit arm: `childReclaimAudit` reads an exit-1 audit document's `resume` before it folds to `unreadable`;
    - the reclaim side's reader of `clipsKept`/`tmpRootKept`, which reads absence as unmeasured and lists a kept leaf
      for the operator;
    - R69's reader;
    - the persistent-failure pacing tier;
    - review 346's F4 (the two `childReclaim.ts` comments) and review 341's F9.

    It may be built while wave 7 is in flight. It LANDS after wave 7: it merges main once wave 7 has merged, because
    its R69 reader is typed against wave 7's `LcRefusalToken` member. It reads every new ccd field absence-permits.
  - **Wave 9: the collector's lane** (the old R58). It is dispatched once the fleet's `ccd caps` advertises wave 7's
    token AND wave 8 has merged, because both edit the sweep. R58's first gate is already met: workspace-lifecycle 3b
    (#312) is on main.
  - The path-identity follow-up comes after wave 9. Run 347 keeps `waveOf` 8, a display-only figure. Nothing edits a
    run's `waveOf`.

- **R66 — the collector's population and its quarantine record.**
  - **The population** is every witnessed id (`$REG/tmproots/<id>` whose name passes `_ws_tmproot_id_ok`), plus every
    QUARANTINE RECORD `$REG/tmpquarantine/<id>.<ns>.<pid>`.
    - `tmpquarantine/` is a dotless registry subdirectory, on the `pools/` and `tmproots/` precedent. It is pinned
      invisible to `_reg_purge`, `_ws_slug_free` and the server's registry read, and its census is pinned.
    - A record's id is parsed EXACTLY: strip the two trailing all-digit dot-fields. A record is never matched by an
      `<id>.*` prefix, because ids admit dots (a nested id is legal).
    - The audit takes `.reap-<id>.lock` only for an id in that population, so it never takes a lock for a foreign name.
  - **The record is resume authority; the journal is not.**
    - Before any move, the verb writes the record (temp file, then rename). It holds the witness line it acted on, the
      slot path and the pre-move token. A failed write refuses before the move.
    - ccd has no journal reader, and D7 forbids the journal from gating an act. The lifecycle journal records the
      intent and the outcome best-effort, and binds nothing.
    - The record is same-uid writable, like the witness, and so shares its trust note.
  - **Order:**
    1. record;
    2. slot;
    3. move;
    4. re-proofs;
    5. remove the slot's leaf, and prove it absent;
    6. rmdir the empty slot (never a recursive remove);
    7. compare-and-drop the witness;
    8. drop the record, LAST.

    A crash at any point leaves the record. The next audit visits it, whatever the witness now says: rewritten by a
    recycled spawn, dropped by a later tail, or absent.
  - **No orphaned slot.** A witnessed id whose leaf is absent has its witness dropped only when no record names that
    id. This amends R50's "a witness with no leaf is cleaned".
  - **Compare-and-drop.** The witness is moved aside to a dot-leading name with `mv -T -n --no-copy`, re-read, and then
    either unlinked (if it is the collected one) or moved back. It never races the writer's temp-file-then-`mv`.
  - **Kept records.** A record that stays has an owner: the operator, as attention on every audit, never silent. The
    shapes are:
    - an original path retaken;
    - a slot leaf that no longer matches;
    - a probe answering someone.

    No session acts on one (R59).
  - **Unwitnessed leaves are never touched.** That covers:
    - every leaf from before v0.0.124;
    - the three kept by the first wave-6 reclaims;
    - the eight row-less ones (2.87 GiB, measured 2026-10-08 13:45Z).

    They are the operator's (R59). There is no re-witness pass ("§12 as built"), and nothing lists them in waves 7 to
    9: the agent has no read grant on `~/.cc-tmp`, and adding one is a SECURITY decision for a later wave.
  - **Kept clips leaves are out of the collector's scope**, and no clips witness is planned. They reach the operator
    through wave 8's `clipsKept` reader. The 37 row-less clips directories (15.8 MiB) are the operator's (R59).
  - **The collector's audit journals a terminal refusal only,** as ws-expire's audit does. `unmeasured` exits 1 and is
    journaled nowhere. The verb's acts journal.

- **R67 — the recycled-slug proof: quarantine by rename.** All of it runs under `$REG/.reap-<id>.lock`.
  1. **Recompute and compare, before the move.** Recompute the token AND re-ask the idle floor and R68's row rule,
     then compare the token with `--expect`.
     - The move re-stamps the leaf's ctime. Measured on the fleet's ext4: ino, btime and mtime are kept; ctime is not.
     - So neither the floor nor the tree token is ever asked after the move, and a leaf moved back waits a fresh floor.
  2. **lstat the leaf.** It must be a real DIRECTORY matching the witness's dev, ino and btime.
     - A link, a file or a mismatch at the original path is refused and offered to the operator.
     - Anything that reaches a slot through the window before the move is moved back, or kept and listed. It is never
       unlinked.
     - `_ws_leaf_remove` is called on a slot's leaf only directly after an lstat in the same lock shows a real
       directory with the witness's identity, so its link/file arm is unreachable from the collector.
  3. **Check the quarantine directory and write the record.**
     - Q = `<physical ~/.cc-tmp>/.ccd-quarantine` must be a real directory, not a link, owned by this uid, mode 0700.
       If it is absent, make it with a plain `mkdir -m 0700`. Anything else answers unmeasured.
     - Write the R66 record.
     - Make the slot `Q/slot.<id>.<ns>.<pid>` with an exclusive `mkdir`. The `slot.` prefix keeps a slot name clear of
       any rule keyed on a leaf's name; the box's `cdk-out-sweep` matches `cdk.out*` at this depth.
  4. **Move the leaf into the slot.** Use one `renameat2(RENAME_NOREPLACE)`: `mv -T -n --no-copy`, inline in the
     collector's Linux-only region, never a `_plat_` helper.
     - The proof of the move is an lstat of `<slot>/leaf` matching dev, ino and btime, never mv's exit code.
     - A missing `--no-copy` answers unmeasured. So does a cross-mount EXDEV, which `--no-copy` turns into a refusal
       (measured). The verb never copies.
  5. **Re-prove after the move.**
     - `$REG/<id>.child` is asked by DIRECT lookup, the read `_child_tmpdir` makes, and must be absent.
     - `_ws_slug_free` must answer free, AND a wildcarded listing of `$REG` must show the `.reap-<id>.lock` this verb
       holds open. Otherwise the slug answer is unmeasured. Measured: with `$REG` searchable but not listable,
       `_ws_slug_free` answers free over a standing `.child`.
     - The in-use probe must answer nobody, on both spellings.
     - Identity must still hold.
     - R68's row rule must hold, on the pre-move spelling.
     - `/proc/self/mountinfo` must list no mount point at or under `<slot>/leaf`.

     Any doubt moves the leaf back with `mv -T -n --no-copy`. The restore is proven by lstat: the original path holds
     the record's dev and ino, and the slot is empty. If that is not proven, the record and slot are kept and listed,
     and nothing in them is removed.
  6. **Remove the slot's leaf** with `_ws_leaf_remove <slotdir> leaf <witness dev:ino> <pre-move path>`, inheriting
     R64 Rule 1's checkout question. Then follow R66's order to the end.
  - **The checkout question across the move.**
    - Inside the lock and BEFORE the move, the collector asks `_ws_leaf_checkouts` on the original path. Anything but
      0 refuses, and nothing moves. The record notes each outside admin directory that passed by back-link, with its
      back-link value.
    - After the move, `_ws_leaf_remove` and `_ws_leaf_checkouts` take the same ADDITIVE alias argument, passed only by
      the collector. Under it, a back-link naming the pre-move spelling counts as the leaf's own ONLY when both hold:
      - (1) the same admin directory, with the same back-link value, was accepted by the pre-move ask in this lock;
      - (2) `_ws_reclaim_absent` proves that nothing stands at that pre-move spelling now.
    - Any other outside back-link refuses, as today. Measured: a recycled admin name otherwise passes, and deletes a
      moved foreign worktree's uncommitted work.
    - Every other caller is unchanged, and conditions (1) and (2) are each mutation-pinned.
  - **Resume.** A resume never recomputes the tree token or the floor. Its authority is the record. It re-proves:
    - the slot leaf's dev, ino and btime against the record;
    - step 5's checks;
    - a resume token over the id, the record name and those fields.

    A forged slot or record fails one of these and is listed, never taken. There is a case for each.
  - **Why it holds.** Every hand-out of `~/.cc-tmp/<id>` goes through `_child_tmpdir`, which has one call site and
    needs `.child`. Step 5's direct lookup sees `.child` whether or not `$REG` can be listed. So:
    - a spawn before the move is seen;
    - a spawn after the move gets a new inode from `mkdir -p`;
    - step 6 removes only the slot's inode, dev:ino-checked.

    Task 0 pins three facts by scan, each measured red under mutation: one TMPDIR composer, one `.child` writer, and
    the marker read placed before the `mkdir`. btime is never the SOLE guard of a race case. The witness stays v=1, and
    whole-second btime closes by this proof.
  - **Accepted residuals.**
    - A new child on a recycled slug adopts an old leaf through `mkdir -p`, in two cases: the leaf is one the tail
      deliberately KEPT, or the collector's own restore put it back before that child's `mkdir -p`. R64 Rule 1 still
      guards every later removal.
    - rename EBUSY on a mount point, and a same-file-system bind mount inside a leaf, cannot be measured without root
      on this fleet. Step 5's mountinfo check covers the collector; the tail's share stays stated.

- **R68 — the candidate rules, split between ccd and the server.**
  - **ccd checks these at the audit, and again inside the lock BEFORE the move:**
    - The witness matches dev, ino and btime. A btime of `-` is never taken, and witness reader rc 2 is never taken.
      Measured: all 52 live leaves carry a real birth time.
    - `_ws_slug_free` answers free.
    - The in-use probe answers nobody.
    - **No registry row lies at, inside or through the leaf.** This is R64 Rule 2, which `_ws_leaf_remove` does NOT
      carry.
      - It covers rows standing or placed by either R54 arm. It is asked in one registry pass by the four comparisons
        `_ws_reclaim_workdir_shared` uses, plus THROUGH.
      - An unlistable registry, or a row that cannot be placed, answers unmeasured.
      - Measured: without this, a stopped session's clone inside a dead child's leaf is deleted.
    - **The idle floor holds.**
      - The NEWEST CTIME, in ns, over every entry under the leaf, the leaf included, is at least `max(24 h, knob)`
        old.
      - mtime is not consulted. It is user-settable, so a future mtime would hold a leaf forever, and every change
        that moves mtime also stamps ctime.
      - The walk is `find -P <leaf> -xdev`, run with LC_ALL=C. It never follows a link or crosses a file system, and
        it is bounded by a 60 s timeout and a cap of 2,000,000 entries. Measured: the largest live leaf is 76,915
        entries, in at most 4.8 s.
      - A timeout, an unreadable entry or the cap answers unmeasured, and the audit document says which, so that wave
        9 raises attention rather than retrying silently.
      - Nothing writes inside the leaf before step 1's comparison: no normalise pass, no owner-bits pass, no chmod.
    - The box is Linux, and `mv --no-copy` is present. Otherwise the answer is unmeasured.
  - **The token** binds the id, the witness's dev, ino, btime, run and at, the newest ctime in ns, and the entry count.
  - **Stated residuals:**
    - atime is not consulted (a reader with no fd and no cwd at probe time);
    - a nested mount's contents are not walked;
    - a backwards clock step can delay the floor;
    - the operator's `cdk-out-sweep` restarts a CDK-using orphan's floor until it has nothing left to remove.
  - **The collector verb gets its own runner budget row of 240 s,** as ws-reclaim has.
  - **The server (wave 9):**
    - It finds its population with `io.readdir` of `<registryDir>/tmproots` and `<registryDir>/tmpquarantine`. Both
      are new reads under the agent's `.cc-sessions` grant; the existing registry read does not enter subdirectories.
    - It drops dot-leading names. It resolves a null listing with `statMeasured`: proven ENOENT is empty, and anything
      else is unmeasured.
    - It never reads `~/.cc-tmp`.
    - It acts only after two observations with an unchanged token, at least one sweep interval apart on its monotonic
      clock, keyed by (id, token).

- **R69 — `containment-refuted`, one word for persistent proven failures, shared with workspace-lifecycle.**
  - **The ccd side.** `_ws_reclaim_owned` becomes three-valued: 0 own, 1 PROVEN not own, 2 could not be asked.
    - Every rc-2 sub-answer stays 2, including `_ws_reclaim_moved_check`'s rc 2, which is no longer folded into 1.
    - The tail prints and journals `containment-refuted`, from its own literal call site, only on rc 1. That covers:
      - a SHARED, NESTED or THROUGH row at, inside or through the worktree or either leaf;
      - a gone row's moved tree inside the child;
      - a workdir that is the main checkout or the project directory;
      - a link or non-directory at the workdir;
      - a tombstone workdir that is not one plain path.
    - Everything else stays resumable `worktree-remove-failed`.
    - Every refusal arm keeps a non-zero rc, pinned per arm.
  - **Declaring it.** Wave 7 declares the word with its emission, in one commit: in `LcRefusalToken`,
    `LC_REFUSAL_WORD` and `ALL_TOKENS`, and in whatever else the cross-language scans require. Its sentence says only
    what is true under any server: the session was stopped, nothing further was deleted, and a retry finds the same
    thing until the other tree or row is moved or removed.
  - **Until wave 8 lands,** both parsers read the word as a resumable failure and retry it, which is safe: the resumed
    tail deletes nothing before `_ws_reclaim_owned`.
  - **Wave 8 reads it as a new class, `stuck`:**
    - attention at once, with ccd's sentence;
    - retried only on the persistent-failure tier, a long, capped backoff that never stops;
    - excluded from the failing-past-ceiling list;
    - the feed says the box resumes from its breadcrumb once the tree or row is fixed.

    No door is needed: a fixed tree completes on a later pass. `POST /api/runs/:id/reclaim` is the programme takeover
    door and is never used for this.
  - **Workspace-lifecycle** maps the same literal. Its non-resumable arm (`nextAskAt` = +∞ until a restart) would
    strand an archived row behind an expire breadcrumb, so quiet-river chooses the same tier or states the stranding.

- **R70 — what else wave 7 carries.** These are reclaim-ladder and tail corrections, shared with ws-expire.
  - **The ccd half of `crumb`.**
    - `_ws_reclaim_failed_json` and `_ws_reclaim_fail` take an OPTIONAL crumb argument, and print the key only when a
      caller passes one.
    - `_ws_reclaim_locked` passes `false` before its breadcrumb and the resumed state after it. The shared tail passes
      `true`.
    - There is no new `_reg_get`.
    - `_ws_expire_locked` is NOT edited: workspace-lifecycle wave 5 (run 345) edits it. So ws-expire's pre-breadcrumb
      documents carry no `crumb`, which is absence, never a wrong value.
    - The audit already prints `resume`, and is unchanged.
  - **Rung 8's silent omission.**
    - The fix is at the ladder's call site only, never inside `_ws_reclaim_record`, which has six callers. When the
      record answers rc 1, the ladder asks `_ws_reclaim_log_of <main> tree <workdir> 0`, as the breadcrumb arm does.
      A failure is unmeasured, and only a clean "no entry names it" stays `no-worktree-record`.
    - The vanished arm, which proceeds today on rc 1, is measured under a silent omission. It takes the same ask, or
      the plan states why it is safe.
    - This turns a terminal word into a retried unmeasured answer on both lanes.
  - **`_WS_NORMALISE_WHY` is capped** at 300 bytes of printable ASCII, through one shared cutter. Tokens are unchanged.
  - **Prose and pins:** review 346's F1, F2 and F3 prose (ccd comments and plan text), and review 341's pins F4, F5,
    F6 and F7.
  - **The SAFETY bound.** Wave 7's SAFETY panel asks one bounded question of R69 and R70, for both verbs: no arm newly
    reaches the pin, the settle or a removal, and none continues past a stop it used to make. R67 and R68 are the
    panel's full subject.

- **R71 — stated residuals, operator residue and amendments.**
  - **Stated residuals:**
    - the macOS `purge-refused` red, which has not recurred;
    - the witness writer's temp files. Under its id's lock, while the slug reads free, the collector removes only
      files matching exactly `^\.<id>\.[0-9]+\.[0-9]+\.tmp$` whose mtime is at least one hour old. A temp file of an
      id with no witness is never visited.
  - **R59, operator residue:**
    - the 12 leaked `tmux: server` processes whose deleted cwd lies inside `ccrc-pwa-brisk-river`'s leaf (that
      child's reclaim will keep its temp root while they live);
    - the three kept leaves and the eight row-less ones;
    - the 37 row-less clips directories;
    - the 17 foreign names in `~/.cc-tmp`.
  - **Amendments, in wave 7's docs task:**
    - spec §5.6's "only the tail removes a witness" now includes the collector;
    - R50's "a witness with no leaf is cleaned" now reads "only when no quarantine record of that id stands";
    - R25 against R50/R57: the collector never takes a non-directory;
    - R64: Rule 1 is inherited through the helper, while Rule 2 is asked by the collector itself (R68);
    - spec §8's wave rows (waves 7, 8 and 9);
    - R58's stale gate.

- **R72 — overlaps (R56).**
  - **#319 (docs W2)** appends to `REQUIRED_VERB_FLAG` and to the ccd block of `EXEC_WHITELIST`, adds `DOCS_CAP` after
    `EXPIRE_CAP`, adds runner budgets in `server/src/remote/runner.ts`, adds a legit-whitelist entry, and takes bypass
    fixtures g16 to g19. At dispatch, wave 7 measures each append point and appends after whatever is last. Whichever
    lands second merges main and re-measures.
  - **Run 320 (box-token)** holds live claim 1110, over `agent/src/whitelist.ts`, `README.md`, `CLAUDE.md`,
    `agent/CLAUDE.md`, `single-definition.test.ts` and `whitelist-subset.test.ts`, all of them wave 7 sites. Wave 7 is
    dispatched after 1110 ends, or under a line-disjointness agreement with run 320's coordinator recorded before
    dispatch.
  - **#322 (stall-watch W2)** edits `watch.ts` and `shared/api.ts`, line-disjoint. Whichever lands second merges main.
  - **#325** is stale. It collides with any ccd/ccd edit at the line-2 stamp and above the 19109 boundary, so the
    second lander restamps and re-measures the citation census.
  - **CU W15** changes one platform-block line. Whichever lands second merges main.
  - **Workspace-lifecycle (quiet-river; run 345's B4 edits the EXPIRE region).** Wave 7 does not edit
    `_ws_expire_locked`. Quiet-river is told of four things:
    - R69's word;
    - `crumb`'s absence on ws-expire's pre-breadcrumb documents;
    - the rung-8 verdict change;
    - the reason cap.

    Wave 8 and workspace-lifecycle wave 5 both edit `server/src/watch.ts`, and their order is agreed with quiet-river
    before either dispatches.

### §14 as built (wave 7, run 347)

Where wave 7's code and its draft rulings narrowed or spelled out the rulings above (R65, R66, R67, R68, R69, R70,
R71 and R72), they now read as follows. This note amends; it edits no earlier text. It names each departure by slug
and carries no number: the coordinator assigns this wave's numbers; the wave 7 plan's `## Deviations found` defines
them. The spec text every committed comment of this
wave cites is the new §5.10 of the design spec, with edits to §5.2, §5.5, §5.6, §7 and §8.

**R66 (population, record, order).**
- `move-proof-requires-the-source-gone`: the proof of a move requires that nothing stands at the source path as well
  as the identity at the destination, so the restore's "nothing stands at the slot's leaf" half lives inside the one
  move function and is pinned there.
- `collect-audit-lock-held-answers-in-progress`: the audit's own non-blocking lock meets one fact the fixed
  vocabulary had no word for, so it answers ws-reap's and ws-expire's existing `in-progress`, retryable and unjournaled.
- `witness-without-leaf-collectable-at-the-audit`: a witness whose leaf is proven absent, with no record and no slot
  of the id, is `collectable` at the audit under a token of its own (`mode=collect-absent`), so the verb has a consent
  to spend on the drop that "no orphaned slot" allows, once the physical `~/.cc-tmp` is on the device the witness
  carries (`collect-absence-needs-the-recorded-device`, below).
- `witness-only-refuses-a-standing-slot`: a witnessed id whose leaf is absent is refused `quarantine-kept`, terminal,
  while any of its slots stands with no record naming it, and its witness stays; this closes the orphaned-slot shape
  for a record lost out of band, in the collector's own arms only (`fresh-collect-refuses-beside-a-standing-slot` and
  `tail-drop-ignores-a-recordless-slot`, below).
- `fresh-collect-refuses-beside-a-standing-slot`: the fresh present-leaf arm asks the id's slots after the registry
  rung and refuses `quarantine-kept`, terminal and journaled `refused`, while any slot of the id stands with no record
  naming it; a slot listing that fails is unmeasured `quarantine`, a nested id's slot is not counted, and the witness
  stays. The resume never asks, because a record names its own slot there.
- `collect-absence-needs-the-recorded-device`: before either of the collector's arms believes an absence, the resume's
  `removed` phase and the witness-only arm's absent leaf, it compares the device of the physical `~/.cc-tmp` with the
  `dev=` the record or the witness carries; a mismatch, a device that cannot be read, or a `~/.cc-tmp` that cannot be
  resolved answers unmeasured `device`, retried and unjournaled, and nothing is dropped. An empty mount point is thus
  never read as the leaf's absence; the `moved` and `unmoved` phases never ask the device.
- `tail-drop-believes-an-absent-leaf`: a stated residual, carried to wave 9's pre-flight list. The reclaim tail's own
  drop of a witness whose leaf is absent is unchanged and asks no device. Beside it, two more: the device test cannot
  tell an empty bind-mount point from the leaf's absence when the bind source and the mount point share a file system
  (`device-test-cannot-see-a-same-device-bind-mount`), and a PERMANENT change of the physical `~/.cc-tmp`'s device
  holds every witness without a leaf and every `removed` record at unmeasured `device` on every pass, with no terminal
  word and no journal row (`permanent-device-change-holds-every-absence`), fail-closed and never self-healing, so a lane
  must not read a standing `device` answer as transient.
- `tail-drop-ignores-a-recordless-slot`: a stated residual, carried to wave 9's pre-flight list. The reclaim tail's
  witness drop (`_ws_tmproot_remove`) still drops the witness of an id whose recordless slot stands.
- `verb-population-refuses-linked-tmproots`: the verb refuses a `tmproots/` that is itself a link as
  `probe-unmeasured`, before taking any lock, as the audit does, so neither takes a lock for a name it cannot place in
  the population.
- `population-absence-is-measured`: both population checks ask the witness's absence through `_ws_reclaim_absent`, so a
  `tmproots/` that cannot be searched is unmeasured (the audit's `witness`, the verb's `probe-unmeasured` before any
  lock), never `not-witnessed`, whose sentence says ccrc never handed the id out.
- `record-written-from-a-fresh-witness-read`: the writer cannot bind its witness fields to an id, so the verb reads
  the id's witness directly before the record write, and the record's read-back compares it with what the consent bound.
- `spawn-at-consented-stops-at-the-record`: a recycled spawn between the consent and the record that changes the
  witness now stops the verb at that read-back as `probe-unmeasured`, before anything moves, where it used to be
  `registered` after the move; both are retryable and the earlier stop is safer. A same-run recycled child, or one whose
  witness write failed, passes the read-back, so the sentence is false for it and it reaches the move
  (`crash-at-moved-residual-widened`). The race suite's report called it `consented-stops-at-the-witness-re-read`.
- `crash-at-moved-after-a-spawn-keeps-the-leaf-in-its-slot`: a stated residual, widened as
  `crash-at-moved-residual-widened` in three ways. A recycled spawn can adopt the leaf between the record and the move.
  (i) The kill window runs from the move to the putback's move-back rename, not just to the re-proof. (ii) A same-run
  recycled child, or one whose witness write failed, passes the record's read-back. (iii) Before the adopting child's
  `mkdir -p` runs again the next audit reads the phase `moved` and answers `registered` with no token; after it, the
  audit answers TERMINAL `quarantine-kept`, journaled `refused` on every pass for the child's life, and it clears by
  itself once the path is free. The retaken-path arm stays above the registry (R-e and R66: never silent). The live
  child's adopted scratch stays in the slot for the child's life, nothing durable is lost, and once the child's row is
  gone and the path is free the record resumes and the leaf is collected with no idle floor.
- `quarantine-kept-sentence-true-in-every-state`: the `quarantine-kept` lifecycle sentence claims no move by ccrc and no
  "exactly as they are", names a quarantine record or slot it cannot read, prove or clear and the original path taken again among its causes,
  says it keeps "what still stands of it and any record of it" (some `failed quarantine-kept` arms come after the leaf
  was removed or the slot rmdir'd), and says "nothing further was removed", so it is true after a forged record, a
  crash plus a fault, an unwound slot and a retaken path alike.
- `registered-sentence-names-residue`: the `registered` sentence says a workspace with this id, or what one left
  behind, still stands in the registry; the plan had prescribed the old text, so this departs from it.
- `refusal-detail-one-string`: the verb's refusal prints the same cut detail it journals, so the document and the
  journal row never disagree.
- `leaf-why-cut-at-the-sink`: the removal's reason is handed raw to its sinks, which cut it, where an earlier cut at
  the source made each cut unpinnable.
- `records-listed-in-the-verbs-shell`: the verb's population check lists records in the current shell, so the
  listing's reason reaches the detail.
- `keep-says-nothing-further`: a kept record's sentence says "nothing further was removed", because after a rm that
  failed part way "nothing was removed" would be false.
- `rows-clear-also-asks-the-clips-leaf`: the collector's registry-row rule also compares the id's clips leaf, so a row
  there refuses, and a clips leaf whose absence cannot be proven is unmeasured.
- `rows-clear-own-row-refuses`: the rule asks the id's own row first, by its `.workdir`, and refuses when it stands,
  as a backstop behind the registry check that every caller asks first.

**R67 (the recycled-slug proof).**
- `scan-pins-in-task-8`: the three scan pins, one temp-directory composer, one `.child` writer and the marker read
  placed before the `mkdir`, landed in the race suite, each measured red under mutation, not in the entry task.
- `move-asks-identity-before-the-rename`: the move asks the source's identity before it renames, so anything swapped in
  at the id after step 2 is refused before it reaches a slot, as `probe-unmeasured` with the empty slot cleared.
- `slotted-swap-refused-before-rename` and `slotted-swap-never-reaches-a-slot`: the race suite's and the verb
  suite's cases for a file, link or directory swapped in at the original path between the slot and the move now expect
  that refusal and an untouched object, not a kept slot.
- `reached-the-slot-driven-inside-the-move`: the "reached the slot" arm, which keeps what is there and moves nothing
  back, is driven by a shim that swaps the source and then runs the real rename, since only a swap inside the move
  reaches it now.
- `ident-refuses-dot-final-components`: the identity check refuses a path ending in `/`, `/.` or `/..`, all of which
  follow a link before them, so "an lstat, never followed" is true by mechanism.
- `vanished-slot-leaf-is-a-retry`: a slot leaf proven gone is a retry, `probe-unmeasured` at the verb and unmeasured
  `slot` at the audit, with the record and slot standing, never the terminal `quarantine-kept`.
- `alias-refuses-a-non-directory-leaf`: with an alias passed, the removal helper refuses a link or file leaf and
  leaves it standing, so the collector never unlinks one; every other caller is unchanged.
- `alias-extra-pins`: two cases beyond the alias's drafted ones pin the leaf-itself-a-linked-worktree arm and the
  newline-in-the-pre-move-spelling half of the alias check.
- `accepted-on-physical-arm-unreachable`: the accepted-pair record on the physical-spelling arm cannot be reached
  through the question, so its deletion has no red; the line stays so the list is complete if the arm ever becomes
  reachable.
- `quarantine-made-without-setgid`: R67 step 3's "plain `mkdir -m 0700`" gains `chmod g-s` on the directory that call
  made, because on a setgid `~/.cc-tmp` a bare `mkdir` is born 2700 and the mode check refuses it for ever; a quarantine
  that already stands at 2700 stays unmeasured and is the operator's to fix, and a `mkdir` lost to another maker is
  never chmod-ed.
- `audit-asks-the-quarantine-question`: the fresh audit beside a present leaf, and the resume audit, ask a read-only
  check of the quarantine (a real directory, not a link, of this uid, mode exactly 0700, or proven absent) and make and
  write nothing; the verb alone asks the maker. There anything else answers unmeasured `quarantine`, exit 1, so a bad
  quarantine no longer licenses a move that the verb would refuse on every pass. Beside an absent leaf the audit only
  lists the quarantine's slots, so a link, a non-directory or slots that cannot be listed answer unmeasured
  `quarantine` there; it does not ask the uid and mode half, because the witness-only drop moves nothing into the
  quarantine.
- `alias-refusal-ends-at-the-putback`: a stated residual, carried to the path-identity programme. The alias refuses an
  outside back-link that a recycled admin name carries only while the leaf is in its slot; once the putback restores the
  leaf, the pre-existing un-aliased rule decides, as it did before this wave, and the wave adds no deletion class.
- `real-holder-double-forked`: the in-use probe never counts a child of ccd's own process, so the only real-process
  pin double-forks its holder; the verb must stay a ccd process of its own, never run inside a long-lived session's
  process.
- `physical-twin-pinned-by-a-real-process`: the probe's physical-twin spelling is pinned by a real process, and the
  re-proof loop is unchanged.
- `checkout-cases-stub-the-evaluation`: the verb suite's step 3a cases stub the evaluation, because the real one asks
  the stubbed question inside the lock and would answer at the verdict point.

**R68 (the candidate rules).**
- `idle-walk-bound-30s`: R68's 60 s idle-walk bound became 30 s, so the audit fits `ws-audit`'s 90 s runner row:
  30 s for the walk, 10 s for the in-use probe and 30 s for the checkout scan make 70 s, plus the row pass.
- `g9-kill-grace-residual`: each bounded probe adds its TERM-to-KILL grace, so the worst case is about 79 s, and 94 s
  at the widest grace, against the 90 s row; a runner that kills the audit gets no document, which fails closed.
- `malformed-floor-knob-is-unmeasured`: on the FRESH rungs a non-empty floor knob that is not a whole number answers
  unmeasured, naming the knob, and the document prints no floor (`floorS` null) and no instant; a resume decides nothing
  from the floor, and with such a knob its document prints `floorS: null`. A whole number of ten or more significant digits clamps to
  999999999. A raise asked for unreadably is never folded to the 24 hour minimum.
- `floor-knob-reads-its-value-before-the-clamp`: the knob's leading zeros are stripped first and an all-zero knob reads
  0; the clamp is asked of the length of what is left, and only then is the value compared, so `0000000001` is the
  86400 minimum and arithmetic never sees more than nine digits.
- `audit-asks-owner-write`: the fresh audit answers unmeasured `mode` for a leaf whose own mode lacks owner write, or
  whose mode cannot be read, so no move is attempted and no `failed` row is journaled per pass; the leaf stays listed
  and the collector never changes a leaf's mode, because the token binds it.
- `resume-token-binds-checkouts`: the resume token also binds the record's `checkouts=` list, which the removal is
  handed as the checkouts it accepts, so a record whose list changed is another consent.
- `registry-direct-lookups-measured`: the collector's `.child` and `.uuid` lookups are measured by the absence proof,
  not an `-e` test, so a registry that can be searched but not read is unmeasured and never folded into free.
- `rows-cases-ask-contained` and `rows-extra-pins`: the row rule is asked under the reclaim's git containment in every
  case, and three cases beyond the drafted ones pin the dangling own-row disjunct, a row inside the clips leaf, and an
  unsearchable clips directory.
- `idle-token-extra-pins`: five pins beyond the drafted ones cover a walk with no device, inode, epoch time or newest
  change time, a floor knob of `90000+1`, and a failed walk leaving no earlier walk's values standing.
- `idle-scratch-file-in-tmpdir`: the walk's stderr scratch file lives in `$TMPDIR`, so a `$TMPDIR` inside the walked
  leaf makes the leaf read busy; that fails closed, is stated in the walk's comment and is pinned.
- `idle-stderr-arm-unpinned`, `idle-mktemp-arm-unpinned`, `idle-empty-walk-arm-defence` and
  `idle-awk-rc-arm-defence`: the first two arms were unpinned and were pinned in the fix round; the last two are
  defence in depth behind other arms and have no red of their own.
- `four-more-guards-without-a-red`: four fail-closed lines in the slot maker, the identity check and the quarantine
  maker change only a reason when deleted; two of them are pinned by a reason-only case, and the others are redundant
  by construction.
- `nonpoison-collect-cut-stays-green`: removing the collector's region from the non-poison suite's cut list leaves it
  green, because the region spells no harvested shape; it is prophylactic, and the audit suite's source pin is what
  catches a harvested shape there.

**R69 and R70 (the tail's corrections).**
- `crumb-rides-a-global-not-an-argument`: R70's optional crumb argument became a global that the failed document's
  printer reads, `ws-reclaim` assigning it and the shared tail setting `true`, so every failure printer reads one value.
- `crumb-unsaid-over-an-unreadable-breadcrumb`: a breadcrumb that stands but cannot be read leaves `crumb` unsaid,
  since whether an act started is not known; the key is also absent from `ws-expire`'s pre-breadcrumb documents and
  from every `ws-collect` document.
- `rung8-asks-the-admin-walk-not-log-of`: rung 8 and the vanished arm ask the admin-entry walk that
  `_ws_reclaim_log_of` is built on, through a new `_ws_reclaim_no_record`, rather than calling `_ws_reclaim_log_of`
  itself; the gone-arm walk moved into `_ws_reclaim_admin_entries` unchanged, so one matcher serves a standing tree and a
  gone one.
- `rung8-reason-cut`: rung 8's no-record reason names an admin entry whose name a session chose, so both arms cut it
  through `_ws_leaf_why_line` before it reaches the journal, and the reason for an entry that names the tree leads with
  its conclusion ("git's worktree list omitted a record that exists"), so the cut keeps it.
- `rung8-empty-gitdir-is-unreadable`: an admin entry whose `gitdir` names no path on its first line, empty or blank, is
  unreadable too, on the standing arm and the vanished arm alike, so the vanished arm mints no token over a record never
  read; `ws-expire`'s ladder runs the same matcher and answers unmeasured, never `no-worktree-record`.
- `rk-stops-before-the-branch-not-before-any-delete`: R-k's stop for an all-zero tip is before the branch's
  compare-and-swap, not before every delete; a resume whose tree is already gone has by then deleted each nested
  checkout's branch, after an attic pin, and the child's own vanished worktree record, as the base did.
- `rk-tip-case-removes-the-tree`: the red-first case for an all-zero tombstone tip removes the tree first, because with
  the tree standing the branch-holder check stops the tail before the compare-and-swap and the fixture would pin nothing.
- `generation-read-under-the-compaction-lock`: X1's generation read takes the row's compaction lock, as every other
  caller of the reader does, because the reader's alias is a write the canonical-write census counts; an acquire that
  fails is unmeasured, and the reader runs in the caller's shell so its reason reaches the detail.
- `generation-read-unlocked-census` and `acquire-census-prose-outside-boundary`: the escalation that led to that
  ruling, an unlocked read being a new unlocked caller in the census and the locked read needing two prose numerals
  outside the boundary.
- `acquire-site-prose-seven-to-eight`: the compaction-card spec's and the session hook's acquire-site counts each read
  eight where they read seven, because the census counts those sentences.

**Declarations and citations.**
- `collect-act-declared-before-its-first-emitter`: the `collect` act is declared in the first part of the collector's
  building-blocks task, so it is in the tree before anything journals it.
- `retryable-collect-words-declared-with-the-verb`: `not-witnessed`, `registered` and `changed-recently` are declared
  in the commit that journals them at the verb, since the refusal scan holds every declared word set-equal to a
  literal journal site; the audit prints them on stdout only.
- `act-cites-5.10`, `collect-cites-5.10` and `alias-cites-5.10`: committed comments and test titles for the
  collector's mechanics cite the spec's §5.10, never the contract; §5.2 is cited only for the temp root and the
  witness, and §5.6 only for the shared tail, the breadcrumb and the witness drop.
- `append-after-docs`: the collector's cap, its required-flag line, its grant and its bypass fixture append after
  the docs wave's last entries, which landed first.
- `entry-usage-regex-stale`: the audit's widened usage line made nine malformed-audit rows of the entry suite red, and
  the suite's usage pattern was updated in the same part.
- `step7-diff-base-e04bb4588`: the checkout-alias task's diff check was taken against the last commit before the
  building blocks began, not against main, which had moved.
- `mutation-masked-halves-measured-by-supplement`: three act-pin rows predict two reds inside one case, and the first
  assertion masks the second, so each masked half was measured separately and the case was not softened.
- `mutation-extra-rows-x-series`, `row-29-renames-at-every-site`, `row-15-slot-synthesizes-a-record`,
  `proven-gap-slot-leaf-swap-added` and `record-lost-slot-standing-added`: the race suite adds four mutation rows for
  the guards its amended and added cases rest on; renames a slot consistently at all eight sites, since a rename at
  the namer alone fails the record writer first; builds the slot listing's population as a record synthesized from the
  slot leaf's identity; adds the swapped-in slot leaf case for the non-directory refusal; and adds the lost-record case
  that no drafted case reached.
- `writer-link-check-pinned-by-reason`: deleting both of the record writer's link checks stayed green, because the
  read-back's own check hid the write, so one assertion on the reason gives the first check its own red.
- `scannedtext-doc-names-the-rename-cut`: the macOS-platform test's text reader keeps its doc comment, extended by the
  rename cut, where the drafted replacement would have moved the comment onto the wrong constant.
- `lifecycle-count-red-shape` and `commit-subject-style`: a predicted act-count red measured as a set-equality diff,
  and the first commit's subject follows the drafted `fix(ccd): …` style, not the worker example; neither changes
  behaviour.

**Prose and the wave-6 plan.**
- `nul-back-link-prose-corrected`: the sentences on a NUL in an admin directory's back-link say what is measured: the
  tree is refused only when the `.git` path holds no newline, accepted when the NUL sits at that newline's offset, and
  unmeasured otherwise; the corner and its missing pins go to the path-identity programme.
- `wave6-plan-text-corrected-by-deviation-entry`, which Task 9's report calls `wave6-plan-prose-scoped`: one
  departure under two names, so no number is spent twice. The merged wave-6 plan is not edited, and the three
  sentences review 346 found too wide are corrected in a deviation entry of this wave's plan and in the committed ccd
  comments.

**Not edited.** `server/src/deadCoordinator.ts` is workspace lifecycle's and is unedited. The `collect` act's exclusion
from its deliberate put-down set is pinned by a test only (`ws-collect-act.test.ts`), and the file's docstring edit
the first draft proposed was dropped.

## 15. Rulings, 2026-10-08 (wave 8's pre-flight) — binding; they AMEND sections 1–14

Wave 8 (run 348) is reclaim's SERVER half (R65). It is server code and shared L0 only: no ccd, agent or PWA edit. Its
SAFETY subject is "what `ws-reclaim` is licensed against". Its pre-flight was three Opus readers and a critic at
`226bb881c`. The coordinator's draft rulings were then attacked by three Opus attackers, with SAFETY at xhigh. Every
break they found is closed below. Evidence: the coordinator's `ccr15-evidence-archive/wave8/` (`preflight.json`,
`attack.json`).

- **R73 — X1 is closed on the server.** ccd's binding alone does not close X1, because the executor audits and acts
  back to back after the licence has waited in the queue (`childReclaimOutcome`). The server holds a chain of four
  equal generations: the licence's, the one re-read before presence, the audit's `generation`, and the token's (ccd,
  under its lock).
  - **(a) The read.** For every MARKED row, the sweep reads `$REG/<id>.generation` with `readFileMeasured`.
    - Nothing is stripped: no trim, no newline strip, no NUL strip. `fieldMeasured` is never used.
    - A value is EXACTLY 36 characters matching L0's `REG_GENERATION_SHAPE`, with no `m` flag.
    - The answer has three arms: `value`, `absent` (a proven ENOENT only) or `unreadable`.
    - Every marked row's read is gathered concurrently BEFORE the per-child loop, so the loop stays synchronous and no
      await sits between a row's entry read and its write.
    - `REG_GENERATION_SHAPE` is pinned once BY NAME in single-definition, never by its text: `NODE_ID_RE` carries the
      same text for another concept and is not merged with it. A separate test holds the regex text of ccd's
      `_reg_generation_valid` equal to `REG_GENERATION_SHAPE.source`.
    - **Stated residual.** The read follows symlinks on both adapters, and a dangling link answers `absent`. Neither
      shape has a ccd writer. On a wave-7 ccd, either one ends in an audit `unmeasured`, never an act.
  - **(b) The third key.** `ChildReclaimSweepEntry` and `childReclaimFirstSighting` carry the generation as a THIRD key,
    a `value` or `absent`, beside `bornAt` and `markerRunId`. `childReclaimSameGeneration` requires equality: a value
    matches an equal value, and absent matches absent.
    - **An unreadable generation is not a key.** It makes the row's identity unmeasured, so the verdict is the existing
      doubt word `identity-unmeasured`, visible on the chip.
    - It never seeds an entry, and the entry and the hold-retired memory for the id are dropped.
  - **(c) What each request carries.** Every sweep request carries `licenceGeneration`, the entry's key. Close's
    requests carry `none`, and `none` skips (d) and is never compared in (e). That is safe because close queues only
    when the minting row names this session and no other open run does, so no same-run re-mint can follow a close.
  - **(d) The re-read before presence.** After step 2b and BEFORE step 3, the executor re-reads with (a)'s read, for
    EVERY sweep request, licensed or not.
    - A `value` or `absent` that differs from `licenceGeneration` defers with a NEW `ChildReclaimDeferWhy`,
      `generation-changed`, which has its own sentence and kind-map pin.
    - An unreadable re-read defers `marker-unreadable`, with its own detail, never `generation-changed`.
  - **(e) The audit's key.** `parseChildReclaimAudit` reads the audit's `generation` by `hasOwnProperty`. On a
    token-bearing document:
    - a valid value equal to `licenceGeneration` proceeds;
    - a valid value that differs defers `generation-changed`;
    - `null` or a malformed value makes the document `unreadable`, so it is never spent (unreachable on a wave-7 ccd,
      and pinned as defence in depth);
    - an ABSENT key (an older ccd) never spends a LICENSED request: it defers `unsupported`, and the detail says the
      host's `ws-audit` prints no generation. An unlicensed request relies on (d).

    On a refused document the key is read for the record and gates nothing. No exit-1 audit token is ever spent.
  - **What this leaves.** R63's "a licence never crosses a generation" holds as written. The stated residual: on an
    older ccd, an UNLICENSED request keeps the gap between (d)'s read and the act. That is R62's residual, narrowed.
- **R74 — X3: the hold-retired memory is keyed by generation.**
  - The id-keyed Set becomes a Map from id to `{bornAt, markerRunId, generation}`, where `generation` is (a)'s value or
    `absent`, never `unreadable`.
  - ONE L1 predicate, `childReclaimSameGenerationKey`, decides: an EQUAL stored key is the second sighting, so the key is
    deleted and the release is queued. No stored key, or an UNEQUAL one, is a first sighting, and the new key REPLACES the
    stored one.
  - Every delete and clear site of today's Set carries over.
  - The release request carries the generation. `releaseRetiredChildHold` re-reads it with (a)'s read after its step 6,
    nearest the argv: a different value, or `absent` against a value, answers `changed`, and an unreadable read answers
    `failed`.
  - X3's harm is pacing only. A re-mint's own hold is protected by its live minting run.
- **R75 — R61's closure: the removal is a `purge`, and never the row's own.** The removal set is exactly the `{purge}`
  `done` rows, derived once. `collect` never purges, so it is excluded by construction, and a case pins that. A purge
  FOLLOWS the generation's opening create when all of these hold:
  - its mirror id is higher;
  - NOT (`end.at !== null && end.at < create.at`), so a purge that ccd's own clock proves came first does not count;
  - it is not the row's OWN purge.
    - A purge counts only when its `meas.uuid` differs from the listed row's current `.uuid`, or when it carries no
      `meas.uuid`, which counts because doubt is the safe direction.
    - A purge whose `meas.uuid` equals the row's `.uuid` is that row's own unfinished purge: ccd died between the emit
      and the unlinks, or rc 3 left the row standing. It leaves the birth placed, so the sweep asks again and ccd
      resumes from its breadcrumb.
    - `childReclaimBornAt` takes the row's uuid from each of R40's four consumers.

  A purge with a null `at` counts. A NEW store read, `lifecycleBirthEventsFor`, leaves `lifecycleCreatesFor` unchanged
  for its second caller, and the placement pin is rewritten deliberately. An unplaced birth plus an old claim reads
  "coordinated" downstream: each consumer is pinned, close's decline in that window is fail-safe, and it is a stated
  residual. This amends R40's "The birth" bullet.
- **R76 — the readers of wave 7's ccd fields.**
  - **The failed arm of `parseChildReclaimResult`** reads the WORD first, then `crumb`:
    - `containment-refuted` is the stuck class, whatever `crumb` says;
    - `purge-incomplete` has its own feed tail: the reclaim completed and the row was purged, what stands is named, and
      nothing retries it;
    - otherwise `crumb === false` is not-resumable and `crumb === true` is resumable (the act had started);
    - an absent or non-boolean `crumb` falls back to `CHILD_RECLAIM_PRE_CRUMB_FAILED`.

    `ChildReclaimResume` gains exactly one value, `'stuck'`. `childReclaimFeedBody`'s failed tail becomes an exhaustive
    switch with a `never` guard. Review 346's F4 comments are rewritten.
  - **The audit arm.** On `!res.ok`, `childReclaimAudit` applies the identity rules (a JSON object, `id === sessionId`,
    `mode === 'reclaim'`) and accepts ONLY `verdict === 'unmeasured'`.
    - The answer is `failed` with the token `probe-unmeasured`. It is resumable when a non-empty `resume` string is
      present, and not-resumable otherwise.
    - Every other exit-1 shape stays `unreadable` with a null token. The arm can never return a token-bearing kind.
  - **Kept leaves.**
    - **What is shared with workspace-lifecycle.** ONLY the word classifier, `leafKeptWord(v): 'refused' | 'unmeasured' |
      'in-use' | null`. It is defined once, and whichever wave lands first owns it.
    - **Each source keeps its own reader, because the two wires give absence different meanings.** stdout (WL5's) reads
      absence as `unreported` and an explicit `null` as nothing kept. The MIRROR reader (wave 8's) answers
      `kept:<word>`, `none-or-unreported`, or `truncated` (event `truncated` with `meas` null).
    - This amends R65's "absence is unmeasured" for the mirror.
  - **The kept-leaf attention item.**
    - **Source.** Per id, the latest reclaim row of the generation that carries the keys: the `done` row, or a `failed`
      row whose token is `purge-incomplete`, `purge-mechanism-absent` or `purge-refused`. It is found by ONE bounded
      store read over the last 7 days.
    - **One item per id.** It is raised on `kept:<word>` for either leaf, and on `truncated`, whose sentence says the
      line was cut, so whether a leaf was kept is not known, and the feed names it.
    - **How it ends.** The temp-root half ends on a later `collect` `done` for the id. The clips half never ends that
      way. Both end on a later PLACED `create` for the id, or 7 days after the row's `at`, and the sentence names that
      horizon. The feed keeps the record.
    - **Collapse.** Past `CHILD_RECLAIM_KEPT_MANY_OVER`, as `kept-many`, with a word no other kept-many line uses.
  - **Review 341's F9.** Its line is re-aimed at the stuck set's admission, with a mutation row.
- **R77 — R69's `stuck` class.**
  - `containment-refuted` is `stuck`, spelled once in coord/childReclaim.ts and carried to L1 as a tier field.
  - **Attention.** One item per child, at once. Its sentence carries the journal row's `detail`, which names the tree or
    row the operator must fix; `ChildReclaimJournalRow` gains `detail`. With no detail, the sentence says the record
    was cut and points to the feed. The retry clause is conditional: "while automatic reclamation runs, ccrc retries it
    on its long backoff; the box resumes from its breadcrumb once the tree or row is fixed".
  - **Precedence.** `terminal` outranks `stuck`. `stuck` outranks `kept`, `kept-many` and `failing`, and a `held`
    verdict does not withhold it. `childReclaimKeptItems` excludes stuck ids.
  - **The chip** shows `deferred`, R41's word for a failure line and an unsettled word in the PWA, with the stuck item's
    sentence. It is never `refused`, which the PWA treats as settled and never re-reads. There is no new chip word and
    no PWA edit.
  - **The feed.** `childReclaimFeedQuiet` treats a listed stuck item like a failing one, so a tier retry that finds the
    same word writes no new row.
  - **The pin flip.** Only the `parseChildReclaimResult` assertion of wave 7's `containment-refuted-word.test.ts` is
    flipped, in the same commit, to `resume: 'stuck'`. Its `parseExpireResult` assertion is workspace-lifecycle's.
- **R78 — the persistent tier.**
  - **Entry.** A child ENTERS (a) on a `stuck` answer, or (b) on its K-th consecutive failure carrying the SAME non-null
    token. K = 4, where today's ramp first reaches the ceiling, counted in the entry on the monotonic clock. A null token,
    every `CHILD_RECLAIM_PRE_LOCK_TOKEN` member, `flock-unavailable` and `lock-unopenable` never count toward (b).
  - **Exit.** It LEAVES on `reclaimed`, `gone`, any refusal, or a failure with a different token.
  - **Pace.** `min(TIER_CAP, ceiling × 2^j)`, where TIER_CAP = 4 h. There is no +∞ arm, and the pace is only ever slower
    than today's (R39).
  - **Restart.** At first sighting the lane walks the CURRENT generation's journal rows, past `intent`s, for the latest
    token, whether it is stuck, and the count of consecutive same-token failures. It seeds membership and
    `j = max(0, count − K)`, and leaves `lastFailedAt` NULL, so a re-created entry is asked once on its next due pass.
    No clock is read. A memory clear costs at most one extra ask, never a fresh 4-hour wait.
  - **Deferral.** A deferral keeps the tier state (membership, its token, j), and clears `lastFailedAt` and
    `consecutiveFailures` exactly as today, so R39's lease, presence episode and licence are unchanged.
  - **This amends R20.**
  - **Stated residual.** A box-level cure, such as a fleet update, can wait up to TIER_CAP for a child already in the
    tier. Rung 5/6's box-wide `probe-unmeasured` shares its token with rung 8's per-child one, so a long tmux-probe
    outage can put children on the tier.
- **R79 — the inheritances from wave 7, collected here.** The wave 7 plan cites a "Wave 8 inherits" list that does not
  exist in it. These are the inheritances:
  - T1 OPEN3: R77's pin flip;
  - T3 OPEN5: the generation is read with absence permitted, R73(e);
  - T2 OPEN4: `crumb:true` means the act had started, R76;
  - rung 8's `probe-unmeasured` reaches the tier through R76's audit-arm token;
  - on a wave-7 ccd, a reclaimable audit always carries a string `generation`, so R73(e)'s `null`-with-token case is
    unreachable defence in depth;
  - `ws-collect` documents carry no `crumb`, and the reclaim crumb reader is never applied to them;
  - G9's audit budget stays wave 9's.
- **R80 — overlaps, size and numbers.**
  - **Workspace-lifecycle wave 5 (run 345).** It shares `server/src/watch.ts`, `server/src/coord/close.ts` and the
    kept-leaf word classifier with wave 8. Its +∞ arm for `containment-refuted` is its own choice under R69: the same
    tier, or the stranding stated. The order of the two waves is agreed with quiet-river before wave 8 dispatches.
    Whichever lands second merges main (R56).
  - **Wave 7 (run 347).** Its worker holds claims 1113 (`shared/api.ts`) and 1114 (the contract and the spec). Wave 8 is
    built alongside it under this coordinator's line-disjointness agreement: append-only in its own `shared/api.ts`
    regions. Its contract and spec text lands in its docs task, after wave 7 has merged. Wave 8 LANDS after wave 7, and
    merges main first.
  - **Claim 1110.** Edits to `single-definition.test.ts` and README.md wait for claim 1110 to end (hard expiry 21:28Z),
    or for an agreement with run 320's coordinator. The shape's pin may go in a NEW test file.
  - **Size.** About 29 to 35 files and 2.6k to 5.4k lines, server and shared only: one PR. This supersedes the ledger's
    earlier estimate.
  - **Numbers.** Run 348 holds two issued blocks, 16 numbers starting at 4534 and 16 starting at 4571, each listed
    singly in the evidence archive.
- **R81 — the word half answers no null (after workspace-lifecycle's 4045, before wave 8's dispatch).** Amends R76's
  "Kept leaves".
  - **What is shared** is the WORD HALF only: `leafKeptWord(v): 'refused' | 'unmeasured' | 'in-use'`. ccd's three
    words read as themselves, and any other value, `null` included, reads `unmeasured`. It never answers null.
  - **`null` and absence are each carrier's**, asked before the word half. Workspace-lifecycle's done-document carrier
    reads absence as `unreported` and `null` as nothing kept. Wave 8's mirror carrier reads a `meas` lost to a cut as
    `truncated`, and a null value as `none-or-unreported`.
  - **No answer of either carrier changes.** Wave 8 moves workspace-lifecycle's `keptLeafWord` to L0 as `leafKeptWord`
    under its consent (4036, 4045), deleting its word list, word type and reader there, or declares it first if wave 8
    lands first. Either way it is defined once.

### §15 as built (wave 8, run 348)

Where wave 8's code and its draft rulings narrowed or spelled out the rulings above (R73, R74, R75, R76, R77, R78 and
R79), they now read as follows. This note amends; it edits no earlier text. It names each departure by slug and carries
no number: the coordinator assigns this wave's numbers from the two blocks run 348 was issued, and the wave 8 plan's
`## Deviations found` defines them. This wave's committed comments and test titles cite §5.5, §5.6, §5.7 and §5.9 of the
design spec, and a few cite §7 (its stated residuals). The spec text this wave adds is in §5.5, §5.7
and §5.9, with edits to §5.6, §7 and §8.

**R73 (the licence bound to the generation).**
- `pass-clock-after-gather`: R39 says the lane reads its two clocks once per pass; the throttle now takes its monotonic
  reading before the gather and stamps with it, so a tick that lands during the gather is throttled, and the pass's one
  decision reading follows the gather.
- `an-overtaken-gather-decides-nothing`: a pass counter, which R73's text does not name, is bumped before the gather, and
  a pass whose gather settles after a newer pass has begun returns before it decides anything.
- `pass-throttle-restamped-after-gather`: a pass that was not overtaken re-stamps the throttle with its decision clock,
  read after the gather, because the overtaken guard caught only strict overtaking and a gather that settled just short of
  an interval let two decisions land less than one interval apart; any two deciding passes are now at least one interval
  apart.
- `marked-means-marker-reads-as-child`: the gather reads exactly the rows whose marker reads as a child; a row whose marker
  is unreadable answers `marker-unreadable` before identity is judged, so its generation decides nothing and is not read.
- `refused-generation-not-carried`: R73 (e) said a refused document's key is read for the record; it is not. The audit's
  `refused` answer carries no generation, so the key is read by nothing, and, as R73 (e) says, gates nothing.
- `wave7-generation-pins-owed`: the two server-side `absence-permits` cases of wave 7's
  `ccd-child-reclaim-row-generation.test.ts` are flipped in the commit that makes the token arm name its generation,
  because a null `generation` on a token-bearing document is now unreadable.
- `uidn-at-module-scope-per-h7`: the shared lane rig's `let uidN = 0;` sits at module scope from the task that first
  needs the rig, the plan's shared-rig ruling over the task text.

**R74 (the hold-retired memory).**
- `hold-retired-step-in-l1`: which of first, second and forget a hold-retired sighting is lives in one pure L1 function,
  `childReclaimHoldRetiredStep`, which the lane applies, instead of a branch inside the watcher.

**R75 (the birth).**
- `born-at-opens-through-generation`: the birth placement keeps its own opening-create loop over the birth events, which
  carry no `outcome` and so are not `childReclaimGeneration`'s input; the docstring no longer claims the birth calls it,
  and an equivalence case holds the two placements equal.

**R76 (the readers of wave 7's ccd fields).**
- `failed-tail-extracted-as-export`: the failed feed tail is extracted from `childReclaimFeedBody` into the exported,
  exhaustive `childReclaimFailedTail`.
- `purge-incomplete-resume-read-by-crumb`: `purge-incomplete`'s `resume` is read like any other word's, the word first and
  then `crumb`, and the feed's tail for it is decided by its word.
- `wave7-header-comment-stale`: the header comment of wave 7's `containment-refuted-word.test.ts` is corrected for the
  reclaim parser's half only; the expiry half still reads resumable until workspace lifecycle's wave 6.
- `leaf-collapse-members-carry-a-run`: the collapsed kept-leaf line is a separate arm of the attention union whose members
  are `ChildReclaimKeptMember`, carrying a number `runId`, and the existing `kept-many` arm keeps its word unwidened.
- `leaf-kept-yields-to-a-live-item`: a kept-leaf item is dropped when the list already holds any item for the id, a
  `kept-many` member included, so one item per id holds across every arm and the banner's key stays unique.
- `leaf-end-clock-guard`: an end of a kept-leaf item counts only when it follows the row by mirror id and is not dated by
  ccd's clock before it, R75's guard applied to the ends, so doubt keeps the item listed.
- `leaf-kept-ends-read`: the ends come from a second bounded read, one statement over the source's ids, because a later
  `create` or `collect` can lie outside the source's time window.
- `leaf-kept-feed-row`: "the feed keeps the record" is made true by one `child reclaim leaf kept` row per source row per
  process, recorded and never pushed, carrying ccd's own `detail` as one bounded plain line.
- `leaf-kept-null-run-stays-single`: only items with a number run collapse into `kept-many`, because the board drops a
  member whose run is not a number; an item with no run always lists singly.
- `leaf-kept-undated-row-unlisted`: a `reclaim` row ccd journaled with no `at` lies outside the source's window and is never
  listed, since the horizon cannot place it.
- `leaf-kept-feed-memory-unpruned`: the set of source rows already fed is never pruned, because an ended item never
  returns and a prune would be a branch with no observable effect to pin.
- `leaf-kept-session-id-follows-ccds-rule`: a source row whose session id fails ccd's own id rule for its temp roots (the
  session-id shape, never dot-leading) lists nothing and writes no feed row, because the item names the id in a path a
  person is told to remove. Residual: ccd writes every journal line within `LC_LINE_MAX`, but the mirror's ingest does not
  cut a line, so a hand-appended line can carry a long id; it is still one plain line with no separator.
- `leaf-kept-phrase-second-table`: the reclaim lane's `LEAF_PHRASE` keeps its own phrasing of the three kept-leaf words
  beside workspace lifecycle's `LEAF_KEPT_WHY`, two surfaces both keyed by `LeafKeptWord`, so a word added to L0 reds both
  under the compiler.
- `verdict-readers-pin-stale-after-leaf-writer`: the attention list's one write was re-pointed through
  `childReclaimAttentionWithLeaves` without re-pointing `child-reclaim-verdict-readers.test.ts` case (c)'s census literal,
  which a fix-round commit of the same task corrected.
- R76's "nothing retries it" is amended. `purge-incomplete`'s feed tail is conditional: the reclaim completed and the row was
  purged, what still stands is named, and the sweep asks again if the row's own files still stand. It says neither that
  nothing retries it nor that the box resumes.

**R77 (the stuck class).**
- `stuck-outranks-the-verdict-on-the-chip`: R77's precedence is carried onto the chip, which answers a stuck line ahead of
  the sweep's verdict, `deferred` and never `refused`; a kept verdict swaps the retry clause for its reason, and a held one
  for the hold's.
- `stuck-lists-an-unplaced-line`: a stuck line that ccd did not date is listed with a null `at`, because the item needs no
  clock, where the failing arm lists nothing for an undated line.
- `stuck-classifier-injected-into-L1`: L1 imports L0 alone, so the stuck classifier reaches `childReclaimAttention` as
  an injected `stuckOf`, as `kindOf` does.
- `terminal-refusal-reads-the-row-without-detail`: `childReclaimTerminalRefusal` is typed over the journal row without
  `detail`, so a caller holding a row from before the field still compiles.
- The held ruling made at the plan's reconciliation, with no slug of its own: a stuck child the sweep holds also shows no
  retry clause, its sentence says ccrc does not retry it while the hold stands and that the long backoff resumes once the
  hold lifts, and the switch turns that chip answer to `paused` as it turns the hold's own.

**R78 (the persistent tier).**
- `tier-uncountable-failure-neutral`: a failure whose word is not countable (no word, or a pre-lock word) neither enters,
  counts, advances nor ends the tier, and so do a box retry refusal and a refusal this build cannot classify, because ccd
  journals every `ws-reclaim` refusal through one emit and a rule that let them end the tier would make the live memory and
  its restart seed disagree; R78's "a failure with a different token" reads as a different countable token.
- `tier-j-from-run`: live, j is `max(0, run − K)`, the seed's own formula, for both kinds of member, so a stuck child is
  paced at the ceiling for its first four answers and then at 30, 60, 120 and 240 minutes.
- `tier-seed-carries-short-run`: the seed also carries the word and run of a child that is not yet a member, so the K-th
  failure is the same failure live and after a restart.
- `tier-seed-birth-guard`: the seed reads a generation only when its opening `create` is the entry's own birth, so with
  no placed birth it seeds nothing, which paces by the ordinary ramp for longer and never misses an ask.

**R79 (the carried inheritances).**
- `corrupt-admin-entry-holds-the-repository`: wave 7's carried item is classified by the tier. A repeated `pin-failed` is a
  ccd `failed` line, neither a refusal nor a pre-lock word, so it enters the persistent tier on its fourth consecutive
  failure and is retried at `min(4 h, 15 min × 2^j)`; the predicates are `token !== null &&
  !isChildReclaimPreLockToken(token)` and `tier = stuck || run >= 4`, and every `pin-failed` emission is `_ws_reclaim_fail …
  pin-failed`, which is not in `CHILD_RECLAIM_PRE_LOCK_TOKEN`.

**Departures with no rule of their own.**
- `brief-labels-reworded-to-spec-citations`: where the plan's comment and test-title text cited its own or the contract's
  labels (a ruling letter, an R-number, a draft id), the committed text cites the spec only, and no asserted string
  changed.
- `held-verdict-case-narrows-kept-many`: one drafted test case read `a.sessionId` on the attention union, which `kept-many`
  lacks, and narrows with `'sessionId' in a`, expected values unchanged.
- `shared-describe-made-reclaim-only`: NOT applied. Workspace lifecycle's wave 6 was not on main when the reader task
  landed, so the step was done as written.
- `as-built-note-carries-slugs-not-numbers`: the plan's instruction to write each number singly is superseded by the
  rule that a number main does not define is never written; this note names slugs only, as §14's did, and the coordinator
  assigns the numbers.

**As built, not departures** (the spec's §5.7 and §5.9 state each).
- A stuck child the sweep keeps never gets a kept feed row, because it is excluded from the kept items; the feed's latest
  line for it stays the stuck line, and the banner names the kept reason.
- A held stuck child is sighted afresh on the first pass after its hold lifts, and asked once on the next, before the
  tier's pace resumes from that answer.
- The kept-leaf item's horizon and its guard on a placed create read ccd's wall-clock `at`, as the mirror's other arms do,
  and the item gates no decision.

## 16. Rulings, 2026-10-11 (wave 9's pre-flight) — binding; they AMEND sections 1–15

Wave 9 (run 380) is the temp-root collector's SERVER LANE, the old R58 (R65). It writes the one composer that spends
wave 7's `ws-collect` token, so its SAFETY subject is "what `ws-collect` is licensed against". It is server code and
shared L0 only: no ccd, agent or PWA edit. Its pre-flight was four Opus readers and a critic at `d0c2b7803` (wave 8's
merge). The coordinator's draft rulings were then attacked by four Opus attackers (SAFETY at xhigh, pacing and
attention, feasibility, SECURITY), with two Sonnet refuters for every break: 68 agents, no error, and 28 breaks
survived. The revision was checked again by two Opus readers (SAFETY at xhigh) with refuters: 30 agents, no error, and 13
more items survived, among them five SAFETY wedges and stale-answer paths. A last check (22 agents) found no route that
composes when a gate forbids it, and 9 more items (three silent-wedge paths among them). Every one is closed below. Evidence: the coordinator's `ccr15-evidence-archive/wave9-preflight/`
(`preflight.json`, `attack.json`).

**Measured at the pre-flight (2026-10-11; counts only, no contents read):**
- `$REG/tmproots` holds 9 witnesses. Four belong to a live session, so five are orphan candidates.
- `$REG/tmpquarantine` does not exist, and no dot-leading or dash-leading name stands.
- A no-op `chmod 0700` stamps a directory's ctime on this box's ext4 (kernel 6.8), and `~/.cc-tmp` shares `$HOME`'s
  file system. So every spawn on a recycled id changes the fresh token, a same-run respawn included.
- Every witness is a child's: `_child_tmpdir` writes one only when `_child_runid_valid` holds, so a witness's `run`
  names the child's minting run.
- `cmd_ws_collect`'s flag loop takes flags from any position, including `--session`'s value. With the decision flags
  on, the ids `--actor`, `--surface` and `--reason` all parse as the id `agent`. That holds for `ws-reclaim` and
  `ws-expire` too (copies of the three loops, run in scratch). `sweepDec`'s surface is the constant `agent`, so a
  redirect always lands on `agent`, never on an id the planter chooses. The token binds the id in every lane, so each
  fails closed.
- `lstatMeasured` answers `regular`, `symlink` or `other`, or a failure; a directory is `other`. The agent kills no
  in-flight exec when its socket closes. A link failure returns at once with no document while ccd runs on. Local mode's
  runner has no timeout.
- `lock` is per id: a non-file at `$REG/.reap-<id>.lock`, or an id over 244 bytes (`ENAMETOOLONG`), answers it for that
  id alone (fixture HOME). A one-line junk witness answers TERMINAL `witness-mismatch` with `collect.witness: null`, and
  journals.

- **R82 — the lane ships SHADOWED; arming is the operator's.**
  - **The marker.** The lane composes `ws-collect` only while `$REG/collect-lane-live` exists. Nothing in the tree
    writes it: it is hand-touched, on the `expire-lane-live` and `dead-coordinator-lane-live` precedent
    (workspace-lifecycle rulings E and B).
    - Its constant, `COLLECT_LANE_LIVE_MARKER`, is defined once, in the lane's L1 file, which has no `node:` import.
    - Its holders are exactly that definer and the executor. Neither matches single-definition's WRITE pattern: the
      lane's feed and attention writes live outside both files, as the expiry lane's do.
    - A new describe in `single-definition.test.ts` pins this the way `:4747-4772` pins `expire-lane-live`.
  - **Shadow audits.** Without the marker the lane audits under every rule below. Where it would spend, it records
    "would collect" and composes nothing.
    - **An unlistable registry is NOT shadow.** It is a pause this server cannot rule out (R86): the pass audits nothing
      and clears the observation pairs, and a job stops at its step 2 or step 5.
    - **The would-collect episode.** One feed row per (id, token) episode, and an attention item. A later would-collect
      with the same token writes no feed row. The episode ends on another answer, another token, or the id leaving both
      MEASURED listings (R83). The observation pair is cleared at each would-collect (R87's shadow pacing).
  - **The marker is read by the executor alone, nearest the argv,** from the same single listing as `reclaim-paused`
    (R85 step 5). A marker removed between the audit and the act composes nothing.
    - The executor keeps a last-seen-live flag in the lane's memory. It starts as `shadowed` when the lane is
      constructed, so an arming made while the server was down, or before a restart that no job saw, is still seen as a
      flip. A flip either way clears every observation pair, and the job that sees it composes nothing (it frees the
      slot, R85). So the first live spend after arming needs two fresh observations, both composed after the flip.
      Pinned: a lane constructed with `collect-lane-live` standing writes the "now live" row and composes nothing on its
      first job.
    - Each flip writes ONE feed row ("the collector lane is now live" or "now shadowed"). Any same-uid session can
      touch the marker, as with `expire-lane-live`, so the operator sees every change.
  - **Before arming** (the operator's checklist, written by wave 9's docs task): the shadow feed rows have been read;
    every would-collect names an orphan whose run is closed; no box-wide attention line stands, except the line for ids
    held by R86 (b) or (c), which may stand once the operator has read it (those ids stay held, armed or not); and the
    operator knows that any same-uid session can touch the marker. Arming is the §8 measure "an orphaned temp root is collected with
    no human act".

- **R83 — the population: two listings, read exactly.** This supersedes R58's "through the registry read the server
  already has": that read does not enter subdirectories (R68), and R66 pins `tmpquarantine/` invisible to it.
  - **The read.** Per pass, inside the pass's one gather (R87), for each of `<registryDir>/tmproots` and
    `<registryDir>/tmpquarantine`:
    1. `lstatMeasured`. Its vocabulary is `regular | symlink | other` or a failure, on both adapters, with no directory
       kind. A proven `absent` is an EMPTY listing: no `readdir` is made and nothing is raised. Today's absent
       `tmpquarantine` takes this arm. `symlink`, `regular` and every other failure make THAT listing unmeasured. `other`
       goes on to step 2. This mirrors ccd's `verb-population-refuses-linked-tmproots`.
    2. `readdir`. A null listing is resolved with `statMeasured`: `absent` is empty, and every other answer is
       unmeasured. A FIFO, socket or device is `other` at step 1 and unmeasured here. The two are never folded.
    3. Names that are not strings, and dot-leading names, are dropped (the witness writer's `.<id>.<pid>.<rand>.tmp`,
       and review 369 C5's `.<id>.drop.<pid>`).
    4. A listing of more than `COLLECT_POPULATION_MAX` = 1024 names is unmeasured: one box-wide line giving the count
       only. A session that writes 100k names cannot bloat the agent frame or the server's memory.
  - **Stated residual.** A swap of a directory for a link between the lstat and the readdir is not closed by the server,
    and need not be: every audit of such a name answers ccd's `witness` probe and mints no token.
  - **The id predicate.** ONE exported L0 predicate decides a temp-root id: wave 8's private `leafIdOk`
    (`childReclaimSweep.ts:1643`), lifted to `shared/api.ts`'s foot and widened:
    `isSessionIdShape(id) && !id.startsWith('.') && !id.startsWith('-') && id.length <= 255`. The cap is the bound
    `store.ts`'s `CHILD_RECLAIM_MAX_SESSION_ID_CHARS` already names, lifted with it, and it closes
    `line-bound-is-ccds-not-the-mirrors` for the kept-leaf reader too.
    - **The leading `-` is a SAFETY rule, not defence in depth.** Every redirect pattern in ccd's flag loops begins with
      `--`, and `isSessionIdShape` refuses `=`, so `!id.startsWith('-')` closes every redirect (measured).
    - It gates the population BEFORE any argv, the audit's included. It is asserted AGAIN on `job.id` at the executor's
      step 1 (R85), before any `wsCollectAudit` or `wsCollect` call. Each check has its own mutation pin.
    - A name that is not dot-leading and fails the predicate is never audited and never composed. The pass counts such
      names, and a non-zero count raises ONE box-wide line giving the count only, never the name, because the name is
      untrusted same-uid input.
    - **This amends R66's population and spec §5.10's**, both of which admit a leading `-`. A dash-leading witness or
      record stays outside the lane's population until ccd's own refusal lands (R90).
    - Wave 8's kept-leaf reader takes the same predicate. A dash-leading or over-long kept-leaf id is then not listed,
      a display-only change.
    - Pins: `--actor`, `--surface`, `--reason`, `--expect`, `--session`, `--`, `-h` and `-x` compose no argv, audit or
      act; `a--actor` and `a.--actor` are audited as themselves; a 256-character id is refused; single-definition
      holds the predicate's one definer.
  - **Record names** are parsed exactly as ccd's `_ws_collect_rec_id`: `/^(.+)\.([0-9]+)\.([0-9]+)$/`, greedy, and the
    id must pass the predicate. A record is never matched by an `<id>.*` prefix, because ids admit dots. Pins:
    `a.b.17.42` gives `a.b`; `a-b.17`, `a-b.17.x` and `.a.1.2` give nothing.
  - **The population** is the witnessed ids together with the record ids. A record-only id is audited like any other.
  - **Either listing unmeasured:** the lane audits the ids of the measured listing only, and raises ONE box-wide line
    naming the listing. It never reads a name's absence from an unmeasured listing. While `tmpquarantine` is
    unmeasured, the probe `records` is subsumed under its line and lists no per-id item (R87).
  - **The pre-filter is economy, never permission, and never hides a record.** An id is not audited this pass when its
    exact `<id>.child` or `<id>.uuid` name is in the tick's registry names, UNLESS a record in the measured
    `tmpquarantine` listing names it. A record-bearing id is audited at its own pace whatever the registry says,
    because ccd answers a retaken path `quarantine-kept` above its registry rung so that it is never silent (§14 as
    built, `crash-at-moved-residual-widened`; R66). The lookup is exact, never a prefix: `a` is still audited while a
    row `a.b` stands (pinned). The absence of a row is never a reason to compose; ccd's `registered` rung decides.
  - **Forgetting.** An id is forgotten without a feed row (its pacing and episodes dropped) only when BOTH listings were
    measured on the pass and neither names it.
  - **The lane never reads `~/.cc-tmp`.** A scan pins that no lane file passes a path spelling `.cc-tmp` to an `io`
    member or builds one with a path join. A sentence that names the leaf takes the path from the audit document's
    `collect.leaf`, through `childReclaimDetailText` (R88). Seeing orphaned slots would need a read grant that R66 calls
    a SECURITY decision for a later wave, and wave 9 adds none.

- **R84 — the readers.** Each is total, L1, and never borrows reclaim's.
  - **The audit reader** (`ws-audit --session <id> --collect`):
    - The document must be a JSON object with `session === id` and `mode === 'collect'`. Anything else is
      `unreadable`.
    - At exit 0, `collectable` is accepted only with a `token` matching `^[0-9a-f]{64}$`. A missing, null or short token
      is `unreadable`, and never spent.
    - At exit 1, only `verdict === 'unmeasured'` is accepted, with its probe word from `collect.unmeasured`. There is no
      token arm on exit 1. Every other exit-1 shape is `unreadable`.
    - No document at all (a runner kill, a composition die) is its own arm, `no-document`, never folded into a probe.
    - An unknown verdict is a retry, never spent (a `startsWith('collectable')` check is the pinned mutation). An
      unknown probe word is kept verbatim for classification only, and classed load-sensitive (R87).
    - `resume`, `exists`, `collect.idleAt`, `collect.leaf` and `collect.witness` are carried for pacing, the hold and
      display. `resume` here is the QUARANTINE PHASE, not reclaim's breadcrumb. It gates one thing only: R86 (e) tells
      a resume from a fresh collection by the presence of the `resume` key, because the token's mode is not on the wire
      (every document prints `mode: "collect"`).
  - **The verb reader** (`ws-collect --expect <token> --session <id>` plus the decision flags):
    - DONE, exit 0: `{collected, record, resumed, witness}`, and only when `collected === id`; any other `collected` is
      `failed` (pinned). `witness: 'kept'` is a successful collection: a recycled spawn's witness was put back.
    - REFUSED, exit 0: `{refused, detail, paths}`. The word is classed by a total L1 table over L0's collect words AND
      the shared tokens ccd prints there: `state-changed`, `in-use`, `in-progress`, `paused` and
      `containment-unproven`. An unknown word is a retry, never terminal.
    - FAILED, exit 1: `{failed, detail}`, with `probe-unmeasured` or `quarantine-kept`. Collect documents carry no
      `crumb` (R79), and wave 8's crumb reader is never applied to them.
    - **No document: three arms, never folded.**
      1. A RECOGNISED pre-lock die, matched exactly against ccd's own whole stderr, as `archivedExpiry.ts:309` and
         `matchChildReclaimLockUnopenableDie` do. These are `flock-unavailable`, `lock-unopenable` (bash's diagnostic
         lines for that one lock path, then `ccd: cannot open the reap lock at <path>`), the usage die, `bad token`,
         `bad session id` and `python3 unavailable — cannot quote the collection record safely`. Each acted nothing.
         Each recognised text is pinned by reading it off `ccd/ccd`.
      2. A runner kill, a timeout, a client wait expiry or a link failure, which MAY have acted (R85).
      3. Anything else, read as arm 2.
      Only arm 1 carries a word. Every arm-1 word is a deferral, neutral to every tier, on wave 8's precedent
      (`CHILD_RECLAIM_PRE_LOCK_DIE_PATTERNS`), and only `flock-unavailable` latches (R87).
  - A scan pins that the collect readers neither import nor call `parseChildReclaimResult` or
    `parseChildReclaimAuditFailed`.

- **R85 — the licence: two observations, one job, one act.**
  - **The rule, one L1 function.** The server spends a collect token only when ALL of these hold:
    - an earlier audit of the id (observation 1) answered `collectable` with token T;
    - the executor's OWN audit, in the act's job, is observation 2, and answers `collectable` with the same T;
    - observation 2 ARRIVED at least the interval after observation 1 arrived, on the server's monotonic clock. Each is
      stamped when its answer arrives (wave 8's `answered` idiom);
    - every answer for the id between the two was `collectable` with T. Any other answer resets the pair: another
      verdict, an unreadable or missing document, a different token, or any verb outcome.
    The interval is `COLLECT_OBSERVE_INTERVAL_MS`, declared in `watch.ts` beside `CHILD_RECLAIM_SWEEP_MS` and derived
    from it, never a second literal. The L1 rule takes it as an argument, as `childReclaimNextEntry` takes
    `passIntervalMs`, because L1 imports L0 alone.
  - **All three token modes** (`collect`, `collect-absent`, `collect-resume`) take this rule. There is no fast path for
    a witness-only drop: the same-device bind-mount gap (R89) is the reason.
  - **Memory only.** Observations live in process memory, keyed by (id, token), and are never written to coord.db or
    any file. A restart, a raised pause, a missing capability, a pass that fails shut, an unlistable registry or a
    marker flip clears the PAIRS (R87 says what survives). A restart needs two fresh observations (pinned).
  - **The token is a comparand, never carried.**
    - The lane holds T only to compare. The argv is `CCD_ARGV.wsCollect(obs2.token, job.id, dec)`: observation 2's
      token and the job's id.
    - `CollectToken` is declared at `shared/api.ts`'s foot, so `ccdargv.ts` imports nothing from a lane file. It is
      minted only by the collect audit reader, and `wsCollect` takes it. So tsc refuses a plain string to `wsCollect`,
      and a fixture pins `wsCollect(<string>)` as a compile error. In the same commit the existing plain-string calls
      (`ws-collect-wiring.test.ts:25-26` and `:39`, `ccdargv-dec-parity.test.ts:161`) pass a test-only cast,
      `TOKEN as CollectToken` (cast once at each file's token declaration), so `typecheck-tests` stays green.
    - A string brand is assignable to `string`, so it does NOT keep a CollectToken out of `wsReclaim` or `wsExpire`
      (measured: tsc rc 0). No fixture claims that direction. Instead a scan pins that the first argument at the one
      `CCD_ARGV.wsCollect(` site is the identifier bound from observation 2's parsed document in the same function, and
      that no `wsReclaim(` or `wsExpire(` site names a collector type or variable.
    - The builder takes no record, slot or phase: ccd derives them.
  - **The executor job,** on `queue.run(id, …)`. That is the same KeyedQueue key as the reclaim and expiry executors,
    so no two lanes touch one id at once. In order:
    1. `capSupported(COLLECT_CAP)` and `capSupported(RECLAIM_PAUSE_CAP)`; the id predicate again (R83).
    2. The switches, from ONE registry listing: `reclaim-paused` present, or an unlistable registry, stops.
    3. The presence defer (R86).
    4. The audit, as observation 2, compared with observation 1 read from memory; then the open-run hold (R86), judged
       on observation 2's document.
    5. The switches again, from one fresh listing, with the live marker (R82). This is the job's LAST await.
    6. After that await, synchronously, with no further await before the argv:
       - observation 1 is re-read from memory, and a pair cleared since (a pause seen by a pass, a pass that failed
         shut, a marker flip) composes nothing;
       - presence is read again;
       - the open-run hold's store reads are made again (CoordStore is synchronous);
       - `capSupported(COLLECT_CAP)` is asked again, in the act's own scope.
       Then, live: `wsCollect(obs2.token, id, dec)`. Shadow: record "would collect" and stop.
  - **Bounds.**
    - **The pass.** One pass at a time, under a `collectSweeping` guard that spans the gather and the synchronous
      decide-and-enqueue only. The pass NEVER awaits a learning audit, an executor job or an act it enqueued: each is
      tracked in memory (the per-id set, the slot, their enqueued-at and composed-at stamps), and every pass derives the
      unsettled lines from those stamps. So a call that never settles cannot stop later passes.
    - **The per-id set** covers EVERY collector ccd call for the id: the learning audits, the executor's audit and the
      act. Each runs on `queue.run(id, …)`, as `learnExpiry` does. The pass enqueues no further collector call for an
      id whose previous call has not settled.
    - **Stale answers are discarded.** A reset is anything that clears a pair: a verb outcome, any other answer for the
      id, the hold, the presence defer, a would-collect, and the lane-wide clears (a raised pause or an unlistable
      registry, a missing capability, a pass that failed shut, a marker flip). The lane keeps a lane-wide clear
      generation and a per-id one. Both are captured when a request is composed, and its answer is an observation only
      if both are unchanged when it arrives. Pins: a learning audit composed before a job sees the marker appear, and
      answering collectable after it, seeds no observation; the first live act after arming follows two observations,
      both composed after the flip.
    - **At most `COLLECT_AUDITS_PER_PASS` = 2 learning audits per pass, and at most one act job.** In each pass the act
      job is offered FIRST, to the earliest ripe id (by ripening instant, then id) that has no unsettled or
      already-enqueued collector call, skipping any id that has one. Learning audits are then offered to due ids by
      next-ask instant and then id, never by observation age or listing order, again skipping ids with a call pending.
      An id holding an observation is not offered a learning audit: its next ask is its ripening instant (observation
      1's arrival plus the interval). A deferred or held id's next ask moves out (R87), so one id cannot take every
      pass. Pins: with X under a standing presence claim and Y holding a ripe pair, Y's act is composed within two
      passes; a single collectable orphan reaches its executor job within the interval plus two passes; a ripe X with a
      never-settling call does not stop Y's act.
    - **The fleet-wide slot.** At most ONE `ws-collect` is composed per pass, and at most one is in flight fleet-wide.
      The slot is the collector's own, not reclaim's `CHILD_RECLAIM_MAX_IN_FLIGHT`: sharing would let a presence-leased
      reclaim stall collection, and the expiry lane already keeps its own. Its life:
      - it is taken when the act's job is enqueued;
      - it is freed when the job settles having composed no `ws-collect`, at ANY step through 6: a switch, presence, the
        hold, a cleared pair, the cap re-check, the start hold-off, a marker flip and shadow's would-collect alike;
      - it is freed when the act answers a document, or a recognised arm-1 die (R84), which acted nothing;
      - only an act answering no document of arm 2 or 3 keeps BOTH the id and the slot until `CHILD_RECLAIM_STALL_MS`
        (480 s, twice the verb's 240 s row) after the act was composed, and the next act on the id is a fresh audit,
        never a re-spend;
      - a job still unsettled at `CHILD_RECLAIM_STALL_MS` keeps the slot, never reclaim's "stops counting";
      - the lane composes no `ws-collect` until `CHILD_RECLAIM_STALL_MS` after its own start, because a restart forgets
        the slot while the previous process's act may still be running on the box. Every rollout restarts the server,
        so the first act after it waits 8 minutes: only slower.
      A bound shared across the three destructive lanes is not this wave's; it is recorded for the operator.
    - **Stated residual.** A killed ccd's orphaned children, such as the removal's `rm`, can outlive these bounds. They
      hold the id's reap lock, so ccd answers `in-progress` for that id, but they are not counted against the slot.
    - **Unsettled calls and jobs.** A killed audit is `no-document`. ANY collector ccd call still unsettled at its stall
      bound (twice the 90 s row for an audit, `CHILD_RECLAIM_STALL_MS` for the act) raises ONE box-wide unsettled line
      naming the id, because local mode's runner has no timeout. So does an executor JOB not settled
      `CHILD_RECLAIM_STALL_MS` after it took the slot, even if it never composed a call (it may wait behind another
      lane's job on the same KeyedQueue key); that line says the collector's act slot is held. The id is not re-queued
      until its call or job settles.
    - **Stated residual (local mode).** The restart half of "one in flight" rests, in local mode, on the server unit's
      default `KillMode=control-group`, which kills a ccd child with the server. A local install run otherwise can
      leave the old process's act running past the new process's hold-off.
    - Pins: an act answering no document blocks a second id's act for STALL; a lane instance composes no act inside
      STALL of its start; a learning audit for an id runs behind that id's queued reclaim job; two ids each get a
      would-collect on consecutive shadow passes; a step-6 presence abort lets a second id's act be composed on the next
      pass; an arm-1 `lock-unopenable` answer frees the slot; a never-settling learning audit raises the line and is not
      re-queued; an act, and separately an executor audit, that never settles raises the line at its bound while later
      passes still compose learning audits for other ids; an executor job queued behind a never-settling job on its key
      raises the slot-held line at STALL.
  - **Never** `--defer-expired` (ccd's arity guard dies on it, and the collector has no presence rung to licence
    past). The lane never kills a holder.

- **R86 — the gates.**
  - **Capabilities.** The pass starts only when `capSupported(COLLECT_CAP) && capSupported(RECLAIM_PAUSE_CAP)`: never
    run an automatic destructive lane on a box the phone cannot pause. `null` caps answer false. `capSupported` is the
    gate.
    - Every `CCD_ARGV.wsCollectAudit(` site ALSO calls `verbSupported(deps.fleetState, argv)` in its own scope, exactly
      as `childReclaim.ts:1306` and `expireArchived.ts:196` do. The reason: verb-gate keys the site as `ws-audit`,
      which is in `NEW_GENERATION` and not in `CAP_GATED_VERBS`. Where `collect-v1` is advertised that call answers
      true, so it changes no decision. `ws-audit` is never added to `CAP_GATED_VERBS`.
    - `CAP_GATED_VERBS` and `NEW_GENERATION` both gain `ws-collect`.
    - `ws-collect-wiring.test.ts`'s INERT `it` is rewritten on purpose: its builder and `COLLECT_CAP` holder lists name
      the lane's files. Its `'ws-collect'` literal list (`['ccdargv.ts','remote/runner.ts']`) and its `'--collect'` list
      (`['ccdargv.ts']`) stay byte for byte, so the lane spells neither literal.
    - A new scan pins that every `wsCollectAudit(` scope holds `capSupported(` with `COLLECT_CAP`.
  - **Pause.** `reclaim-paused` is read at the pass's start (present: no audit at all, and the pairs clear), at the
    job's start, and after the job's last await. An unlistable registry reads as paused. README `:4199-4201`'s list of
    what `reclaim-paused` stops gains the collector; that line is outside run 358's hunks. The cleanup-pause row
    (`:5310`) stays as it is: "child reclamation" covers the collector, and its two prose pins are run 358's.
  - **Attached.** For a candidate with no row, R58's "attached-session defer" means ccd's `in-use` answer: reported
    naming its holder, never killed, never licensed past and never ceilinged. The server adds a presence defer: an id
    for which `presence.isVisible(id)` answers true composes nothing.
    - It is read at the job's start AND again after the job's last await (R85 step 6). ccd has no presence rung for a
      collection.
    - It has no ceiling and no licence. It resets the pair, and the id's next ask is paced by a presence-deferral count
      of its own (R87), so an open tab never starves other ids. An id it has deferred continuously past
      `CHILD_RECLAIM_DEFER_CEILING_MS` is listed as attention, never licensed.
  - **The open-run hold (new; only slower).** The lane composes nothing for an id while ANY of these stands. All are
    judged on OBSERVATION 2's document, never observation 1's.
    - (a) `collect.witness.run` names a run that is not terminal: `!TERMINAL_RUN_STATES.includes(state)`, so `unknown`
      and an out-of-vocabulary word hold.
    - (b) That run is ABSENT from coord.db. A lost, rebuilt or restored database makes every run absent at once, the
      open ones included. This is the reclaim lane's `minting-run-absent`, never eligible (`watch.ts:3998`).
    - (c) That run opened after the witness's `at` plus `CHILD_BIRTH_SKEW_MS`. Run ids restart after a database loss,
      so such a run is not the minting run, and it holds as (b) does. This is reclaim's birth fence
      (`childReclaimSweep.ts:643`).
    - (d) coord.db names the id as the `sessionId` or `claimedBy` of any non-terminal run, through
      `openRunsForSession(id)` and `openRunsClaimedBy(id)`, the expiry act's destructive-grade reads. A later run may
      bind an unspent child (`childBindGate` admits a row-less id), and two open runs naming one session is a designed
      state. This also holds a record-only id.
    - (e) A collectable document with NO `resume` key (a fresh collection, whose token mode is `collect` or
      `collect-absent`) that carries no `collect.witness.run`. It cannot happen on a wave-7 ccd, and it is pinned as
      defence in depth, in both directions: a fresh collectable document with `witness: null` holds, and a collectable
      `resume` document with `witness: null` and no open run naming the id is not held by (e).
    - (f) Any of these reads fails. An unreadable store holds, at the job as at the pass (wave 8's fail-shut pass).
    - **A record's own `run=` is not on the wire** (`collect.records` holds basenames only). A resume whose document
      carries no witness is held by (d) alone. It finishes an act that began under these same gates, so it is not held
      by (a) to (c). This is a stated residual.
    - **What it raises.** The hold counts nothing, and it clears the observation pair, so a released hold needs two
      fresh observations. A held id's next ask waits `CHILD_RECLAIM_DEFER_CEILING_MS`, never the next pass. An id held past the ceiling is listed as attention. Ids held by (b) or (c) collapse into ONE
      box-wide line: the coordination database cannot vouch for these temp roots' runs, and a person removes them once
      nothing still needs them.
    - Pins, each red under its mutation: an absent run holds; a run opened after the witness's `at` plus skew holds; an
      open run naming the id as its sessionId, which is not the witness's run, holds; a run bound during the audit
      holds; an unreadable store holds.
    - Task 0 measures, read-only, whether each live witness's run is in coord.db and opened before its witness's `at`
      plus skew. Any that is not is held from day one, which is safe, and the checklist then shows no would-collect for
      it.
  - **Older ccd.** No `collect-v1` means no audit and no act. Every key the lane gates on exists on the oldest ccd that
    advertises the token. An absent gating key never spends.

- **R87 — pacing.**
  - **One pass, one gather.** The pass keeps "one await before its loop" (the gather) and wave 8's
    `pass-clock-after-gather` (the throttle re-stamped with the decision clock). The `collectSweeping` guard (R85) spans
    the gather, so a second pass cannot overtake one; wave 8's passSeq check is therefore not needed here. Its throttle and every stored instant are on
    the MONOTONIC clock, never `Date.now()`: the expiry lane's throttle is wall-clock, and this lane follows child
    reclaim's. The population read (R83) is inside the gather.
  - **What a clear clears.** A raised pause, a missing capability, a pass that fails shut, an unlistable registry and a
    marker flip clear the OBSERVATION PAIRS only. The per-id pacing (below) survives all of them: the next-ask instant,
    every run and its j, and the feed episodes. Only a restart loses it. The collector has no mirror seed, unlike
    reclaim.
  - **The per-id pacing state is the collector's own, in L1, and only wave 8's FORMULA is imported.** Wave 8's
    `childReclaimTierAfterFailure` restarts its run on any different countable word, and a collector id answers several
    classes in turn. So the collector keeps three runs per id, each with its own last arrival. It derives membership and
    j for each through `childReclaimTierFrom` (module-private today; it gains the `export` keyword and nothing else, `j = max(0, run − CHILD_RECLAIM_TIER_ENTRY_RUN)`), and
    paces through `childReclaimBackoffMs` and `childReclaimTierPaceMs`. Wave 8's reclaim code is otherwise untouched: no
    new parameter, no widened type, and every reclaim answer unchanged. A new scan pins one definer of the pace formula,
    and that the collector imports it.
    - **The DEFERRAL count** is advanced by a deferral, a box-wide probe, a verb refusal and a recognised pre-lock die
      (R84 arm 1), and cleared by any answer that is none of these. Its wait is `childReclaimBackoffMs` over the count.
      It never enters a tier.
    - **The FAILING run** is advanced by every audit-countable answer, whatever its probe or class: a load-sensitive or
      per-leaf `unmeasured`, `lock`, and `no-document`. It is cleared only by an audit answer that passed every rung
      (`collectable`, `changed-recently`), by `collected`, by `not-witnessed`, or by the id leaving both measured
      listings. Its tier token is the CLASS word `failing`, never the probe, so alternating probes (`idle:timeout` with
      `idle:walk-failed`, `checkouts` with `rows`) never restart it.
      - A per-leaf deterministic answer enters the tier at once (wave 8's `stuck` entry); the others enter at the
        fourth in the run.
      - Attention: per-leaf deterministic at once; the rest, including `no-document` and `lock`, when the run enters the
        tier, whatever any box-wide line says.
    - **The VERB-FAILED run** is advanced by the verb's `failed` and by a no-document act of arm 2 or 3 (R84). It is
      cleared only by `collected`, `not-witnessed` or leaving both measured listings. A `collectable` observation NEVER
      clears it: otherwise a move that fails every time (`source-parent-without-owner-write-loops`; the token survives
      a failed move, because the leaf is never moved and its ctime never stamped) would spend about every second pass for
      ever. The ramp, then the tier at the fourth, and attention at tier entry. Pinned: failed, then collectable twice,
      waits the backoff, and the fourth failure waits the tier pace.
    - **The TERMINAL run** (`witness-mismatch`, `quarantine-kept`, `containment-unproven`) is advanced only by a terminal
      answer, and enters the tier at once, as wave 8's `stuck` does. Its tier token is the class word `terminal`,
      whatever ccd's word. It is cleared only by `collected`, by `not-witnessed`, or by the id leaving both measured
      listings. Any other answer between two terminal answers leaves the run, its j and its last terminal arrival as they
      stand. That covers an `unmeasured`, a deferral, `no-document`, `changed-recently` and an observation.
      - Attention at once.
      - The next ask is never sooner than `childReclaimTierPaceMs(j)` after the last terminal arrival. With j derived as
        above, the asks after entry come at 15, 15, 15, 15, 30, 60 and 120 minutes, then every 4 h. That is at most 12
        journaled terminal audits in the first 24 h and 6 a day after.
      - Pinned against the imported pace, never a copied sequence: that count, and the same count with a terminal answer
        alternating with `unmeasured checkouts`.
      - They are never excluded for ever: `quarantine-kept` clears by itself on a retaken path, and
        `containment-unproven` once the operator fixes the tree.
    - **The next ask** is the LATEST of every wait that applies: the deferral wait, each run's wait (its tier pace once
      in the tier, else the ramp over its count), the `changed-recently` schedule, the hold's flat wait, presence's ramp,
      the ripening instant of a held observation (R85), and the refusal, die and shadow floors below. A "ceiling" named
      for presence, `registered` or `in-progress` is only the clock for its attention, never a wait. Each wait counts from its own last arrival.
  - **One total L1 table,** keyed by the answer and, for `unmeasured`, by the probe's class. Its lists are derived from
    the table. The probe classes are pinned in both directions against ccd's `_ws_collect_unmeasured` call sites (20
    words plus the four `idle:` words). The idle words are pinned from `_ws_collect_eval`'s `case`, never from the
    literal `"idle:$why"`.
    - **`collectable`:** an observation (R85). It clears the deferral count and the failing run, and never the
      verb-failed or terminal run.
    - **`changed-recently`:** clears the deferral count and the failing run.
      - The next ask is `arrivalMono + clamp(idleAt·1000 − arrivalWall, passIntervalMs, 24 h)`. The lower end is the
        lane's `passIntervalMs` argument, and L1 imports no L4 constant. The wall clock is compared once, at arrival,
        with ccd's stamp (R39's rule).
      - An `idleAt` that is not a finite non-negative integer takes the deferral wait, never NaN.
      - A `changed-recently` that has answered continuously for 24 h on the monotonic clock is listed as attention:
        no process of this uid uses the leaf, and something keeps changing it (ccd's in-use probe sees this uid only).
      - idleAt never gates the spend; ccd decides the floor in the lock.
      - Pinned: both clamp ends, the non-numeric idleAt, and the 24 h attention.
    - **`not-witnessed`:** silent and retryable. It clears the three runs and advances the deferral count, so it is
      asked no sooner than the ramp. It raises nothing, ends no item and never marks an id collected (R89).
    - **`unreadable`, and an unknown verdict** (R84): the failing run (countable, class token `failing`): the ramp, then
      the tier at the fourth, with attention at tier entry. A newer ccd that adds a verdict word therefore slows to the
      tier's pace and is listed, never re-audited silently. Pinned: one id answering an unknown verdict four times is
      listed, and is asked no more often than the ramp allows.
    - **`registered`, `in-use`, `paused`, `in-progress` (audit verdicts):** deferrals, neutral to every tier. Each
      fresh audit walks the leaf before it reaches the in-use rung, so the deferral wait matters.
      - `in-use` is attention at once, naming ccd's holder; R71's leaked `tmux: server` holders are a standing case.
      - A `registered` that persists continuously past `CHILD_RECLAIM_DEFER_CEILING_MS` is attention.
      - An `in-progress` that persists continuously past the ceiling is attention. It names the lock path
        `$REG/.reap-<id>.lock`, never a holder ccd did not name. A killed ccd's orphaned children (R85) are its standing
        case.
    - **`unmeasured`, BOX-WIDE (`platform`, `mv`, `flock`, `witness`, `floor`, `clock`, `eval`, `quarantine`):** a
      deferral. ONE box-wide line (R88), never one per id. `platform`, `mv`, `floor` and a `quarantine` of the wrong
      owner or mode never heal by themselves.
    - **`unmeasured`, PER-LEAF and DETERMINISTIC (`idle:cap`, `idle:unreadable`, `mode`, `device`):** the failing run,
      entered at once, with attention at once. R68 names these "so that wave 9 raises attention rather than retrying
      silently". `device` is never read as transient (R89).
    - **`unmeasured`, LOAD-SENSITIVE** (`idle:timeout`, `idle:walk-failed`, `in-use`, `checkouts`, `rows`, `registry`,
      `identity`, `leaf`, `slot`, `records`, `token`, `lock`, and any unknown probe word): the failing run.
      - `lock` is per id: a non-file at `$REG/.reap-<id>.lock`, or an id too long for that name, answers it for one id
        alone (measured). It joins a box-wide line only in a pass where at least two distinct ids answered `lock` and no
        audit answered anything else. Pinned: one id with a planted `.reap-<id>.lock` directory raises no box-wide line
        and reaches the tier.
      - `records` lists no per-id item while the server's own `tmpquarantine` listing is unmeasured (R83).
    - **`no-document`** (the audit): the failing run. Its box-wide line lists no per-id item, and stands only in a pass
      where at least two distinct ids' audits answered it and no audit returned a document; the per-id attention at
      tier entry stands regardless. Pinned: one id answering `no-document` four times is listed.
    - **TERMINAL:** the terminal run (above). A verb REFUSAL or FAILURE whose word is terminal (`refused
      containment-unproven`, `refused quarantine-kept`, `refused witness-mismatch`, `failed quarantine-kept`) is a
      terminal answer: it advances the terminal run and takes precedence over the refusal and verb-failed rows below.
      Pinned: a `refused containment-unproven`, then two collectable audits, waits the terminal pace, and the item is
      listed at once.
    - **The verb's `failed`, and an arm-2 or arm-3 no-document act:** the verb-failed run.
    - **A verb REFUSAL of any word,** retryable included, resets the pair and is a deferral. ccd journals every
      `ws-collect` refusal, so the id's next learning audit also waits at least `CHILD_RECLAIM_DEFER_CEILING_MS` after it,
      as wave 8's `refusedAt` paces a refusal. Pinned: at most 96 verb refusals a day per id.
    - **A recognised pre-lock die (R84 arm 1):** a deferral, neutral to every tier. Only `flock-unavailable` latches.
      Every other arm-1 die also takes the refusal floor (the next learning audit no sooner than
      `CHILD_RECLAIM_DEFER_CEILING_MS` after it), because a `collectable` observation clears the deferral count and the
      cycle would otherwise repeat; the same die recurring past the ceiling is attention.
    - **The hold (R86):** resets the pair, and the next ask waits `CHILD_RECLAIM_DEFER_CEILING_MS` flat.
    - **The presence defer (R86):** resets the pair, and the next ask waits `childReclaimBackoffMs` over a
      presence-deferral count of its own. Each keeps its own continuity clock for its attention.
  - **Stated residual: the collector's pacing is memory-only.** An unmeasured audit is journaled nowhere, and the lane
    adds no mirror read (R89), so nothing is seeded. Every restart, and every rollout is one, re-enters each terminal and
    verb-failed id at j = 0: about eight extra journaled terminal audits, or failing acts, per such id in the 4.5 h after
    it. The 12-then-6 bound holds between restarts only. For every other id a restart costs at most one extra ask, and
    since the observations restart too, it can only delay a collection.
  - **`flock-unavailable`** from the verb latches box-level for the process, as `archivedExpiryBoxRefused` does. While
    it is latched, a box-wide line says so, so an armed lane is never silently off.
  - **Shadow pacing.** A would-collect clears the observation pair and touches no run. The id's next learning audit is
    no sooner than `CHILD_RECLAIM_DEFER_CEILING_MS` after the would-collect's arrival, a floor inside the "latest of"
    rule above, so shadow never audits a collectable id every pass.
  - **The runner budget stays.** `ws-audit --collect` keeps `ws-audit`'s 90 s row. One kill grace is paid
    (`g9-kill-grace-residual`, corrected 10-11 00:05): 30 + 10 + 30 + 3 = 73 s, or 78 s at the 8 s grace. A test reads
    both sides from source and pins `30 + 10 + 30 + grace < 90`.
    - **Stated residual.** The rows rung's git reads of other rows' repositories (`_ws_reclaim_workdir_shared`) carry no
      bound of their own in that sum. A kill there is `no-document`, which fails closed and is paced as above.
    - No mode-keyed row is added, so `remote-runner.test` and the runner comment stay as they are.

- **R88 — attention and the feed.**
  - **Collector attention is an arm of `ChildReclaimAttention`.** No new `CoordStatus` field and no PWA edit: the PWA
    reader keeps any item with a string `sessionId`, a string `sentence` and a null-or-number `runId`, whatever its
    `kind` (`childReclaimWords.ts:78-83`).
    - The arm is declared at `shared/api.ts`'s foot. The union's last-arm line is rewritten in place, line-neutral.
    - Its `runId` is the audit document's `collect.witness.run`, or null; a record's run is not on the wire. It carries
      no `at`: an item built from server memory has no ccd clock to carry, and the union's `at` is ccd's alone.
    - Task 0 reads how `ChildReclaimBanner.tsx` renders `sessionId` (text or a link), and the box-wide label below is
      chosen to render as plain text.
  - **A box-wide line is a SINGLE collector item, never a `kept-many`.** That covers a box-wide probe class, the
    `no-document` and `lock` lines, an unmeasured or over-long listing, the refused-name count, the flock latch, the
    unsettled collector call or job (audit, act or executor job) and the held-by-(b)/(c) line.
    - Its `sessionId` is a fixed label that no session id can equal, because it contains a space or a `/`, which
      `isSessionIdShape` refuses: for example `~/.cc-sessions/tmproots`, `~/.cc-sessions/tmpquarantine` or `the fleet
      box`. The labels are spelled once, in a total table. Its `runId` is null.
    - It takes no id in the one-item-per-id set, so the per-id items beside it still list.
    - Pinned: an unmeasured listing with no measured id renders through `childReclaimAttentionOf`.
  - **A collapsed per-id line** uses `kind: 'kept-many'` with a word no other line uses. Members need a numeric
    `runId`. A collector item with no run (`collect.witness` null) never stays single beyond
    `CHILD_RECLAIM_KEPT_MANY_OVER` of one word: past that, those items collapse into ONE box-wide count line naming the
    count and at most that many ids. Pinned: six unreadable witnesses list as one line.
  - **One item per id, with this precedence:** a reclaim item (about the row that stands) wins over a collector item,
    and a collector item wins over a leaf-kept item. The winner CARRIES the loser's operator instruction as a second
    clause, verbatim, wherever the winner does not already give it:
    - a collector item carries a leaf-kept item's clips clause, because the clips leaf is never the collector's (R66);
    - a reclaim item carries a collector `quarantine-kept` item's sentence, because a kept record is never silent (R66),
      and a recycled row standing over its id is exactly when it arises;
    - a reclaim item also carries a leaf-kept item's clips clause. Wave 8's `leaf-kept-yields-to-a-live-item` dropped the
      leaf item silently; it now yields its clips clause to the winner, by the same mechanism (slug
      `leaf-yield-carries-the-clips-clause`).
    - The clause comes from the function that writes the leaf-kept sentence: `childReclaimLeafKept`'s yield gains
      `clipsClause: string | null`. It is the `its clips directory ~/.cc-clips/<id> (<word>: <phrase>)` part; for a cut
      line, `whether its clips directory ~/.cc-clips/<id> was kept is not known`; and null when clips is
      `none-or-unreported`. `childReclaimAttentionWithLeaves` takes those yields, not bare items.
    - An item that carries a second clause NEVER joins a collapsed line; it stays single.
    - Pinned: an id with both, among six or more collector items with runs, still renders the clips sentence; a reclaim
      item over a kept record still renders the record's sentence.
  - **One write.** The merge happens inside `childReclaimPublishAttention`, the list's one write, which reads the
    collector lane's memory. The collector never assigns `childReclaimAttentionList`, and census (c)'s WRITE literal in
    `child-reclaim-verdict-readers.test.ts` is re-pointed in the same commit. **Stated residual:** collector items reach
    the frame only at the reclaim pass's publish, and stand unchanged while that pass fails shut.
  - **Every ccd-sourced string** that reaches a sentence or a feed row goes only through `childReclaimDetailText`:
    `detail`, `paths`, `collect.leaf`, a record name, and any unknown probe or verdict word. The audit's stdout detail
    is UNCUT and quotes session-chosen paths, including `/proc/<pid>/fd` targets in an in-use holder.
    - Before any collector string reaches a sentence, `detailUnsafe` is widened from a hand list to every code point of
      general category Cc, Cf, Zl, Zp or Cs. That covers LRM, RLM, ALM, U+200B to U+200D, U+FEFF, U+00AD, U+180E,
      U+2060 to U+2064, U+206A to U+206F, U+FFF9 to U+FFFB and lone surrogates; plus, by code point, U+034F (category Mn)
      and the whole tag block U+E0000 to U+E007F by range, whose unassigned points are Cn. Each listed class is pinned with its deletion red, and the narrowed upper bounds of wave 8's classes
      (`detail-unsafe-upper-bounds-unpinned`) are pinned too.
    - The existing `LC_LINE_MAX` cut (2048 code points) is the length bound, pinned at 2048 and 2049.
  - **The feed** writes one row per (id, word) episode, quiet on repeats (wave 8's `childReclaimFeedQuiet` pattern),
    under titles of the lane's own.
    - A witness-only `collected` (`record: null`, `witness: 'dropped'`) says no leaf stood and the witness was dropped.
      It never says a temp root was removed (pinned).
    - Shadow writes "would collect <id>" once per (id, token) episode (R82). Each marker flip writes one row.
  - **The two leaf-kept sentences that become false once the lane is armed** are rewritten so they are true whether
    the lane is shadowed, armed, paused, or on a box without `collect-v1`. Each half is written only when that half
    was kept.
    - `:1630-1631` becomes: "What was kept stays on disk." Then, when clips was kept: "ccrc never removes the clips
      directory; a person removes it once nothing still uses it." Then, when the temp root was kept: "ccrc’s temp-root
      collector removes the temp root once it has stood idle, but only while the collector is switched on, the fleet
      box’s ccd can collect and cleanup is not paused, and only if ccrc recorded handing that directory out; until
      then, or if the collector lists it for you, a person removes it once nothing still uses it. The temp root leaves
      this line once it is collected."
    - `:1706` becomes: "Each clips directory stays until a person removes it; each temp root stays until ccrc’s
      temp-root collector removes it, while the collector is switched on and cleanup is not paused, or until a person
      does. The feed row of each names what was kept and why."
    - A prose case pins both, and pins that "ccrc deletes nothing more of it" is gone. Workspace-lifecycle's similar
      sentence (`archived-expiry-policy.test.ts:522`) stays true and is not touched, because an archived non-child
      workspace's temp root is never witnessed.
  - **`attention-runid-sentence-misses-leaf-arms` is fixed in the same commit as the arm,** line-neutrally
    (`shared/api.ts:3832-3834`). `runId` is the run the item's own evidence names: the registry marker's minting run for
    the terminal, failing, stuck and kept arms; the journal line's `meas.childOf` for leaf-kept; and the audit
    document's `collect.witness.run` for the collector. Otherwise it is null.

- **R89 — what wave 9 does not change, and the residuals it states.**
  - **R75's closure stands.** No act joins `LIFECYCLE_BIRTH_ACT`, and `collect` stays out of the birth, generation,
    latest-event and seed reads. `child-reclaim-birth-removal.test.ts` and `ws-collect-act.test.ts` stay green
    untouched.
  - **The lane adds no mirror read of `collect` rows.** Terminal pacing lives in memory (R87).
  - **Stated residual: a witness-only `collect done` ends wave 8's kept-leaf temp-root half.** `lifecycleLeafEndsFor`
    reads any `collect` `done`. Under `device-test-cannot-see-a-same-device-bind-mount`, or after
    `tail-drop-believes-an-absent-leaf`, the item ends while the leaf still stands under a mount. Wave 9 is the first
    wave that makes such a done happen automatically. Filtering the end on a removal needs a `meas` key from ccd (a
    detail parse is fragile), so it goes to the path-identity follow-up.
  - **Stated residuals, read as standing, never transient:** `permanent-device-change-holds-every-absence`, a
    `~/.cc-tmp` deleted whole, and `source-parent-without-owner-write-loops`. The lane paces each (R87), and the cure of
    each is ccd's. `device-test-cannot-see-a-same-device-bind-mount` loses only a witness, never data; R85's two
    observations are the lane's only mitigation.
  - **`tail-drop-ignores-a-recordless-slot` and `tail-drop-believes-an-absent-leaf`** are the reclaim tail's, and the
    server cannot see a slot or a hidden leaf. `not-witnessed` therefore ends nothing (R87).
  - **Stated residual: ids of 223 to 244 bytes** pass the reap lock but cannot write a slot or record name within
    NAME_MAX. ccd's answer there is paced by the tier like any per-id answer.
  - **No agent, ccd or PWA edit.** The agent's read grant already covers both listings (`isUnder(.cc-sessions)`). The
    CLAUDE.md SAFETY bullet on `ws-collect` is already true once a composer exists and is not edited, and no skill text
    names the verb (`ws-collect-prose.test.ts`).

- **R90 — the carried pre-flight list, placed.**
  - **In wave 9:**
    - `attention-runid-sentence-misses-leaf-arms` (R88);
    - `defer-whys-loop-has-no-floor`: a `toContain('generation-changed')` floor and a length floor, in the sweep-policy
      suite;
    - `leaf-kept-census-title-overclaims`: the title says what the census checks;
    - `spec-presence-constants-citation-stale`: re-pointed by content;
    - `detail-unsafe-upper-bounds-unpinned` and wave 8's deferred `detailUnsafe` classes (R88);
    - `line-bound-is-ccds-not-the-mirrors`, closed by the lifted predicate's 255 cap (R83);
    - `g9-kill-grace-residual`'s prose in the spec (`:1364-1366`), with an as-built note (R87);
    - `corrupt-admin-entry-holds-the-repository`: no reclaim change; the collector's `checkouts` and `rows` are
      load-sensitive (R87).
  - **To the path-identity follow-up, which is ccd-bearing:**
    - ccd's comments and residuals: `witness-only-header-omits-the-pause-rung`, `floor-knob-zero-strip-is-quadratic`,
      `tail-drop-believes-an-absent-leaf`, `tail-drop-ignores-a-recordless-slot` and g9's ccd comment;
    - ccd's own refusal of a dash-leading id: `_ws_tmproot_id_ok` refusing a leading `-`, or the flag loops of
      `ws-collect`, `ws-reclaim` and `ws-expire` stopping at `--session`'s value. All three redirect on `--actor`,
      `--surface` and `--reason` (measured);
    - the collect audit creating `$REG/.reap-<id>.lock` for every name that reaches its lock rung, junk names
      included;
    - review 369's C1 (resume-boundary spawn pins) and C5, and C13's reach (review 374 F6);
    - `maker-under-bsd-order-unpinned`;
    - the kept-leaf end filter (R89);
    - the `rec == f` recycled-admin rule and the NUL back-link corner;
    - `collect-why-cases-red-past-the-cut`. It is test-only, and goes there by choice, to keep wave 9's suite
      unchanged.
  - **Also to the path-identity follow-up, as a SECURITY item:** registry ids come from any `<x>.uuid` name with no shape
    filter (`registry.ts:1119`). `ws-release` and `ws-rename` are composed automatically with registry-derived ids,
    carry no token, and use flag-scanning parses. The follow-up gates `readRegistryMeasured`'s ids, server-side
    (refusing a leading `-`), beside ccd's fix. Wave 9 changes no other builder.
  - **Its SECURITY lens also confirms** that no other builder in the wave puts a listing-derived id after a
    flag-scanning parse.
  - **To a later PWA pass:** the comment at `pwa/src/fleet/childReclaimWords.ts:56-58`.
  - **Recorded only:** `leaf-end-acts-spelled-twice`; the attention census's quote style (review 379); token brands for
    `wsReclaim` and `wsExpire`; an expiry-style review conjunct on the hold, which is not needed because a review's
    report lives in `~/.cc-clips`, outside the collector's scope (R66).

- **R91 — overlaps (R56).**
  - **Workspace-lifecycle wave 6 (run 358, plain-ridge)** holds live claims 1149 to 1153, with hard expiries from 17:02Z
    to 18:13Z on 10-11:
    - 1149: `ccd/ccd`, the crumb and expire-consent-branch tests, and its plan;
    - 1150: `archivedExpiry.ts`, `expireArchived.ts` and the two archived-expiry tests;
    - 1151: `containment-refuted-word.test.ts` and `expire-archived.test.ts`;
    - 1152: `endDeadCoordinator.ts`, `watch.ts` and the two dead-coordinator tests;
    - 1153: `README.md`, the workspace-lifecycle spec and the two prose tests.

    Its branch (`e5fba53e0`) is based on `cc33c8d51`, before wave 8. At `d0c2b7803` its regions are: the `watch.ts`
    import lines `:112`, `:121` and `:125` (its own diff numbers them `:105-121`); the expiry feed call at `:4155`; the
    dead-coordinator deps at `:4366`; and README `:3552-3553`, `:3585` and `:3789-3790`.
    - It will land first, so wave 9 is the second lander: it merges main and re-points by content.
    - At dispatch, if run 358 has not merged, the brief names those regions as off-limits. Wave 9 then adds its pass
      after `sweepDeadCoordinators`'s call, and its import block away from W6's.
  - **`shared/api.ts`** is edited only at its foot, plus line-neutral in-place rewrites above it: the union line, the
    `runId` sentence and the predicate's new declaration at the foot. The predicate's former definitions,
    `leafIdOk` (`childReclaimSweep.ts:1643`) and the module-private cap `CHILD_RECLAIM_MAX_SESSION_ID_CHARS`
    (`store.ts:1493`), are server files and become imports. README cites `shared/api.ts` by line, so any insertion above `:7878` would pay
    the re-anchor and the five citation cases.
  - **PR #322** (stall settings) and **PR #346** (design system: `pwa/`, and CLAUDE.md `:87-100`) are line-disjoint,
    provided wave 9 makes no PWA edit and touches CLAUDE.md, if at all, only at `:10`.
  - **`single-definition.test.ts`** gains the live marker's block, the id predicate and the scans. Claims are re-read
    at dispatch.
  - **Size and numbers.** One PR: about 11–14 tasks, 30–45 files and 4–6.5k lines. 32 numbers are issued before dispatch
    and listed singly in the evidence archive (`wave9/block-numbers.txt`). Wave 8 needed 36 with its fix round, so if a fix round needs more they are
    issued then, never guessed.

- **R92 — amendments.**
  - **R58's listing.** R58's "lists witnessed candidates through the registry read the server already has" is superseded
    by R83.
  - **R57's floor.** R57's "the newest of ctime and mtime" is superseded by R68 (ctime only).
  - **R58's "attached-session defer"** means R86's.
  - **R58's "R39's pacing class"** reads as R85's and R87's bounds: the collector's own destructive slot, at most two
    learning audits a pass, and wave 8's ramp and tier by import. Reclaim's `CHILD_RECLAIM_MAX_IN_FLIGHT` and its
    lease are unchanged.
  - **R66's population and spec §5.10's** exclude a dash-leading or over-long id (R83).
  - **The spec, rewritten by wave 9's docs task** to describe the lane as built, shadowed:
    - §5.10: `:233`, `:1261-1264`, `:1294-1299`, `:1321-1322` and `:1364-1367`;
    - §7: `:1540`, `:1559`, `:1564` and `:1567`;
    - §8: wave 9's row, `:1872` (`:1871` is wave 8's), and the paragraph at `:1878-1881`.
  - **The README, likewise:** the "shipped inert" heading and the three "nothing composes it" sentences (`:3762`,
    `:3780-3781`, `:5307`, `:5317-5318`), plus `:4199-4201` (R86).
  - **§14 as built's `g9-kill-grace-residual` figures** (about 79 s, and 94 s at the widest grace) are superseded by R87:
    one kill grace is paid, about 73 s, or 78 s at the 8 s grace (ledger, 10-11 00:05).
  - **"§16 as built" and the numbers.** The worker writes "§16 as built (wave 9, run 380)", naming departures by slug,
    with no number. The coordinator assigns the numbers at the fix round, singly.

### §16 as built (wave 9, run 380)

Where wave 9's code and the plan's text narrowed or spelled out this section's rulings above, they now read as
follows. This note amends; it edits no earlier text. It names each departure by slug and carries no number: the
coordinator assigns this wave's numbers from the block run 380 was issued, and the wave 9 plan's `## Deviations found`
defines them. This wave's committed comments and test titles cite §5.10 of the design spec, and §5.7 and §5.9 where the
lane reuses reclaim's pacing and attention. The spec text this wave adds is in §5.10, with edits to §5.2, §7, §8 and
Appendix A. The fix wave and fix round 1 refreshed this note so that it reads as the tip stands: each departure they
made, and each residual they stated, is named under the rule it touches.

**R82 (the lane's marker).**
- `flip-rows-are-for-changes-an-act-job-sees`: R82's "the operator sees every change" reads "every change an act job
  sees". The executor reads the marker once, at the act's last check, in step 5's registry listing, and an act job is
  offered only to a ripe id. A job that finds the file changed since the last such read writes one feed row saying which
  way it now stands, clears every id's pair and composes nothing, so the first act after a change it sees waits for two
  fresh audits. A change undone between two such reads is never seen and writes no row, and an arming writes its row only
  when the first id is ready to act. This is no safety gap: no act is composed without a seen flip.
- `marker-removal-after-the-last-listing-still-composes` (a stated residual): the marker is read once, in step 5's
  registry listing, with no await before the argv. A removal after that listing, while the frame crosses the link or
  while `ws-collect` runs, still composes or completes, because ccd never reads the marker. R82's "A marker removed
  between the audit and the act composes nothing" holds for a removal the step-5 listing sees.

**R83 (the population).**
- `population-cap-counts-the-raw-listing`: the 1024 cap counts the raw listing, dot-leading names included, before the lane's own drops. The
  executor's read has already dropped non-string names, so those are not counted. Only stricter.
- `junk-quarantine-names-are-refused-names`: a non-dot name in `tmpquarantine` that is no record of an id the lane may
  take (junk, or a dash-leading id's record) is counted among the refused names, as a refused witness name is.
- `population-ids-and-candidates-split`: the population carries its ids, which forgetting reads, apart from its
  candidates, the ids less the pre-filter, so a pre-filtered id keeps its pacing and its episodes.
- `collector-records-unread`: the pass keeps the `sweepTempRootCollect(records, names)` signature, and does not read
  `records`; the population comes from the two listings alone.
- `an-answer-for-a-forgotten-id-is-dropped` (narrowed by `a-collected-act-always-writes-its-row`): forgetting an id does
  not wait for its in-flight call. That call's late answer folds nothing for the id, but what it says of the box still
  counts (the probes, a pass's tally, an act's box word), and a `collected` act still writes its row, worded from the
  job's own observation 2.
- `a-collected-act-always-writes-its-row`: a `collected` act whose id was forgotten while its `ws-collect` was out writes
  the same feed row a remembered id gets, built from the job's own observation 2. Every other outcome for a forgotten id
  folds nothing.
- `learn-collect-asks-no-id-predicate`: the learning audit does not re-assert the id predicate; the population's check
  and the act job's step 1 are the two checks this rule names.
- `population-reads-tmproots-before-tmpquarantine`: the executor's two listings are read one after the other, `tmproots`
  first, never together. ccd writes the quarantine record, then drops the witness, then drops the record, so a record
  listing taken first could see neither for an id ccd is collecting between the two and forget it once.
- `population-cap-bounds-the-lane-not-the-frame` (a stated residual): the 1024 cap bounds what the lane audits and
  remembers, not the listing itself. The agent's `readdir` returns every name in one frame, as the registry's own `$REG`
  listing already does every tick, so R83's "cannot bloat the agent frame" holds for the lane's memory only.
- `cc-tmp-scan-display-only`: the scan pins three things, because a value handed to `io` cannot be followed across
  lines as text: the pass, the lane and the executor spell `.cc-tmp` only as the display form `~/.cc-tmp`, never beside
  an `io` call or a path join, and the lane and the executor never read the home directory.

**R84 (the readers).**
- `exists-not-carried`: the audit reader does not carry the document's `exists`, since nothing gates on it.

**R85 (the licence).**
- `a-stale-answer-paces-but-never-observes`: a stale answer is never an observation, but its pacing still applies, so a
  lane-wide clear landing between a terminal audit's compose and its answer cannot buy another journaled terminal audit.
- `observation-wait-in-the-next-ask`: while observation 1 stands, the id's next ask is its ripening instant, so a holder
  ripens into the act job instead of taking a learning audit that could only repeat observation 1. §16 now says this.
- `hold-reported-ahead-of-the-licence`: the executor judges the open-run hold on every collectable observation 2,
  licensed or not, and reports `held` whenever it stands, so a held id never seeds a pair. Only slower.
- `lane-bounds-decided-in-l1`: the offers and the slot's freeing rules are pure functions in the lane's L1 file; the
  slot's state stays in the sweep.
- `start-hold-off-asked-at-the-offer`: no act job is offered within `CHILD_RECLAIM_STALL_MS` of the lane's start, shadow
  included, so a restarted lane's first would-collect waits eight minutes; the executor asks no hold-off. Only slower.
- `unsettled-bound-counts-from-the-queue`: the unsettled bounds (twice the 90 s row, and `CHILD_RECLAIM_STALL_MS`) count
  from the lane's enqueue of the call or job, not from ccd's composition.
- `a-thrown-job-reads-as-no-document`: a rejected job or learning audit is folded as an audit with no document; a thrown
  act job keeps the slot and its id until `CHILD_RECLAIM_STALL_MS` after it settled, since its composition time is
  unknown.
- `fold-failure-resets-the-pair-and-floors`: an act job that settled but whose fold threw, by its outcome arm or its
  threw arm, resets the id's pair under a new generation and takes the refusal floor, and nothing else moves. The lane
  does not know what the job did, and a fold defect that recurred on every act would otherwise buy a licensed
  `ws-collect` about every second pass, against R87's bound. The slot is left as it was. The learning audit's catch and
  the tick's catch are left alone: neither can leave a pair standing.
- `settle-throw-before-the-slot-write-wedges-the-slot` (a stated residual): a throw inside the settle step before its
  slot write leaves the slot held by the job, with no flight and no line. It is gated by a defect, and closing it would
  make that path faster.
- `collect-fresh-returns-boolean`: `collectFresh` returns a plain `boolean`, not a type predicate: its false arm is
  "forgotten or stale", and a stale answer's entry is still the id's to pace.
- `older-pass-guard-is-shadowed-by-the-prune`: `collectSettled`'s older-pass guard cannot be reached while the tally
  prune stands, because publishing a pass deletes every tally numbered below it. Their pin holds the two together.
- `collect-act-cap-after-last-await-pinned`: a textual pin of step 6. The act job asks `COLLECT_CAP` at least twice, and
  the last ask follows the job's last await and precedes the argv's statement.

**R86 (the gates).**
- `pass-reads-its-switches-in-its-gather`: the pause read "at the pass's start" is the registry listing inside the
  pass's one gather, before any audit, so an unlistable registry's clear is reachable at the pass.
- `unplaced-witness-instant-holds`: a collectable document whose witness names a run but carries no instant holds under
  (c)'s word, `run-after-witness`, because whether that run minted the temp root cannot be said.
- `audit-gate-refusal-clears-as-caps`: the one audit site refuses when `ws-audit` is not advertised; that refusal is
  reported as a missing capability and clears the pairs as one. A ccd that advertises `collect-v1` never reaches it.
- `collect-switches-tells-raised-from-unlistable`: `CollectSwitches` carries `why: 'raised' | 'unlistable'` on its paused
  arm, so each outcome detail says which; both stop a job alike, and neither is ever shadow.
- `collect-audit-names-its-refusing-gate`: the audit site says which gate refused, `collect-v1` or `ws-audit`, and step 4's
  detail names it.
- `learn-collect-not-asked-keeps-one-caps-word`: the learning audit answers both refusing gates with the one `caps` word,
  since the lane handles them alike.
- `h6-scan-follows-the-reshaped-audit-site`: recorded, not a departure. The scans that bind the act's first argument to
  the executor's own second observation matched the reshaped audit site with no change to either pattern.
- `ccdargv-collect-docstrings-rewritten`: `ccdargv.ts`'s two docstrings that said nothing composes `ws-collect` and
  nothing reads `COLLECT_CAP` were rewritten, line for line, in the commit that composes the verb.
- `outcome-detail-is-diagnostic`: a `CollectJobOutcome`'s `detail` is diagnostic. Tests and reports read it, and the lane
  surfaces no sentence from it, so the raised and unlistable distinction and the capability and verb distinction are
  carried, not shown. A comment, no behaviour.
- `destructive-builder-fence-reads-whole-files`: the fence that keeps the files holding the `ws-reclaim` and `ws-expire`
  sites from naming a collector type or reader reads each scanned file whole, not the one function holding the site, so
  a same-file caller that hands a collector value is seen. A control plants such a caller, and the plan's case title is
  retitled to say so. A narrowing of the whole-file read back to the site's function is caught by no case in the
  tree, the control included: only a caller planted in a real file shows it, a row measured once in a scratch copy (a
  `CollectToken`-typed parameter at a caller in `coord/childReclaim.ts`, outside the function holding the `wsReclaim`
  site, reds the whole-file check while the site's own check stays green).

**R87 (pacing).**
- `collector-l1-imports-the-formula-file`: the lane's L1 file imports `../../shared/api.js` and `./childReclaimSweep.js`
  and nothing else, one way, and the pacing suite pins exactly those two.
- `changed-recently-without-idleat-is-a-deferral`: a `changed-recently` whose `idleAt` is not a finite non-negative
  integer advances the deferral count instead of clearing it, so the leaf is not re-walked every pass.
- `failing-run-stays-on-the-tier-once-entered`: a failing run marked stuck by a per-leaf deterministic answer stays on
  the tier until the run clears, so a later load-sensitive answer cannot take it off.
- `unreadable-and-unknown-verdict-are-failures`: an unreadable document and an exit-0 verdict word the reader does not
  know each advance the failing run, as §16 now says.
- `verb-terminal-refusal-advances-the-terminal-run`: a verb refusal or failure whose word is terminal advances the
  terminal run, ahead of the refusal and verb-failed rows, as §16 now says.
- `continuity-measured-answer-to-answer`: a span "continuously past" is measured from a streak's first answer to its
  latest, never to now, and is inclusive at the span.
- `hold-and-presence-continuity-survive-observations`: a collectable observation never ends the hold's or presence's
  continuity, since a held id is re-observed between holds; every other answer, and every act outcome, ends both.
- `collect-sweeping-is-the-overtaken-guard`: the one-pass-at-a-time `collectSweeping` guard spans the gather, so no pass
  counter is added, as §16 now says.
- `budget-test-pins-the-read-values`: `collect-audit-budget.test.ts` pins the six values it reads (30, 10, 30, 3, 8 and
  90) as well as the inequality, so a change to any bound reds it and the sum is argued again.
- `flock-unavailable-takes-no-floor` (H13): a `flock-unavailable` die takes no refusal floor and starts no die streak.
  It latches box-wide instead and waits the ramp alone.
- `would-collect-ends-the-die-streak` (H13): a shadow would-collect ends a recurring die's streak, as every act outcome
  but the same die does.
- `terminal-refusal-keeps-the-refusal-floor` (H13): a verb refusal whose word is terminal advances the terminal run and
  keeps the refusal row's deferral and floor beside it.
- `terminal-failure-clears-the-deferral-count` (H13): a verb failure whose word is terminal (`failed quarantine-kept`)
  advances the terminal run and clears the deferral count, as every other verb failure does.

**R88 (attention and the feed).**
- `collect-many-arm-declared`: the collapsed per-id collector line is a new L0 arm, `ChildReclaimCollectMany`, whose word
  begins `collect:`, declared in the one rewrite of the attention union's last line.
- `collect-many-word-type-pinned-by-ts-expect-error`: a `@ts-expect-error` pin on an unprefixed collapsed-line word reds
  the mutation that widens it to `string`.
- `terminal-collapsed-and-count-lines-past-tense`: the collapsed terminal lead and the run-less count prefix read in the
  past tense, true after a terminal answer and a later collectable alike ("ccd has answered its temp root with a terminal
  word, so it is listed for you to look at; its feed row names that word and what ccd found."; "N are listed under
  <word>").
- `count-line-word-through-detail-text`: the count line's word goes through the one bounded plain-text reader.
- `would-collect-body-calls-collect-who`: the would-collect feed body takes its run clause from the one helper the other
  bodies use, byte for byte.
- `clips-clause-wrapped-in-one-sentence`: the leaf's clips clause is carried verbatim inside one wrapper sentence that
  is true of both of its shapes.
- `stuck-end-exported`: `childReclaimStuckEnd` gains the `export` keyword and nothing else.
- `unvouched-line-waits-the-ceiling`: ids held because the database cannot vouch for their runs join the one box line
  once held past the ceiling, the rule every per-id hold keeps.
- `no-run-lines-share-one-label`: run-less collector items over the limit share ONE `no-run` line, with one clause per
  word.
- `box-probe-line-clears-on-a-passing-answer`: a box-wide probe line stands until an answer passes every rung. It also
  clears when both listings are measured and the population holds no id (`box-lines-clear-when-their-ids-leave`,
  `box-line-clears-need-both-listings-measured`).
- `box-lines-clear-when-their-ids-leave` (retires `pass-scoped-box-lines-stand-until-the-next-call`): a pass-scoped box
  line drops once none of its ids is still a candidate, with both listings measured, and the probe line clears once the
  population holds no id. With both listings measured and no id in the population, nothing carries the condition. The
  line is memory only, so a restart already clears it, and the next id's first audit raises it again before any
  observation can form. R87's "never heal by themselves" is about an id's condition, which still needs the operator.
- `box-line-clears-need-both-listings-measured`: both of those clears read absence, so both need both listings measured,
  the rule forgetting uses. An unmeasured listing changes nothing.
- `older-answer-never-clears-a-newer-probe`: an answer that arrived before the box probes' latest change says nothing of
  them, at every fold. A tie applies. The stamp moves to an answer's arrival whenever `collectBoxProbesAfter` rebuilds
  the probes from it (a box-wide probe, a re-assertion of a standing one included, and any answer that passed every
  rung), since each is a newer word about the box, and never for an answer that leaves them as they were (a per-id
  probe, a non-passing verdict, no document). So an act job's box effect, applied at its answer's arrival, cannot wipe
  a probe that a later answer raised or re-asserted.
- `reader-made-words-are-ccrcs`: the words `''`, `unreadable` and `no-document` are this build's reader's, so their detail
  is ccrc's text or text ccrc saw, and a sentence leads "What ccrc saw:" for them and "What ccd said:" for a word ccd
  printed. No sentence prints empty brackets. The feed rows for them are chosen by kind, never by word, and say in
  ccrc's words that ccd answered nothing, or that ccrc could not read or accept ccd's answer, then what ccrc saw.
- `a-ccd-word-spelled-like-a-reader-word-reads-as-ccrcs` (a stated residual): the attention lead is chosen by word, so a
  ccd verdict or token spelled exactly `unreadable` or `no-document` is led "What ccrc saw:". The text is still escaped,
  and the feed rows are chosen by kind, so they are unaffected.
- `a-registered-id-projects-no-item`: while an id's exact `<id>.child` or `<id>.uuid` row stands and the measured
  `tmpquarantine` names no record of the id, the id projects no per-id item, a terminal one included. That narrows H8's
  "a terminal item stands while the terminal run stands". Its pacing memory is kept, and its item returns as it stood
  once the row goes. The hide is gated: while `tmpquarantine` is unmeasured or over its cap it does not apply, so the
  `quarantine-kept` item and a reclaim item's second clause stand for such an id, as does any other remembered item of
  it. An absent `tmpquarantine` counts as measured, and a `tmproots` in doubt alone does not lift the hide.
- `registered-id-with-only-an-unparseable-record-stays-hidden` (a stated residual): a quarantine name that fails
  `parseCollectRecordName` is a refused name, not a record id, so a registered id with only such a record stays
  hidden. The refused-names box line counts it, and never names it.
- `a-refusal-or-die-episode-outlives-observations`: R88's "one row per (id, word) episode, quiet on repeats" holds for a
  refusal or a die. A collectable observation, fresh or stale, no longer ends a `refused` or `die` episode, terminal and
  silent words and `flock-unavailable` included. Every audit-opened episode, `collected`, `failed` and
  `act no-document`, and a would-collect of another token still end on an observation. A refused or die episode ends
  at another row key, at forgetting the id, or at a restart. The die streak and every pacing floor are unchanged.
- `a-retryable-refusal-says-once` (a stated residual): after that, a retryable refusal such as `in-use` writes one row and
  has no attention arm, so ccd may refuse it silently up to 96 times a day. A die is covered by its streak's attention, and
  a terminal refusal by its terminal item.
- `failed-flag-not-pinned-at-the-lane` (a stated residual): two mutants of that rule, the flag set on the `failed` arm
  and an observation keeping every episode, red at L1 only. The lane case covers a refusal and a die.
- `act-failure-rows-repeat-per-act` (a stated residual): `failed <token>` and `act no-document` keep one row per act,
  because each may have acted. The verb-failed ramp and tier bound them.
- `would-collect-verdict-collides` (a stated residual, pre-existing): an audit verdict spelled `would-collect <token>`
  would read as a standing would-collect.
- `reclaim-kept-many-member-with-a-clause-stays-single`: a reclaim kept-many member carrying a second clause leaves the
  line and stays single, and the rest are relisted.
- `watch-interim-empty-collector`: until the lane's sweep landed, the publish call passed `CHILD_RECLAIM_COLLECT_NONE`.

**R90 (the carried list).**
- `census-title-control-pins-its-width`: the kept-word census's retitle is held by one CONTROL line. A double-quoted list
  is outside the census, as its title says.

**R91 (the L0 edits).**
- `collect-lane-fields-beside-the-child-reclaim-lane`: the lane's fields follow `childReclaimLeaves` in the watcher, and
  its `currentCollectLane()` follows `currentChildReclaimDoneAt()`, off the regions workspace lifecycle's wave 6 edits.
- `attention-doc-pair-counts-the-collector`: `ChildReclaimAttention`'s doc pair was rewritten in place, line for line,
  so it counts the collector's arms; no README anchor moved.

**R92 (amendments).**
- `r92-section-7-lines-are-section-5-10s`: the four lines R92 lists under §7 lie in §5.10's own residual list, and were
  edited there.
- `spec-stale-sentences-beyond-the-r92-list`: four more sentences of the same class are corrected: §5.10's
  `not-witnessed` paragraph, the "on every pass" device line, the "worst case can exceed" residual, and §7 item 6's echo
  of the old budget figures.
- `collect-lane-prose-pins`: `collect-lane-prose.test.ts` pins the sentences this wave wrote and the stale ones it
  removed. Run 358's prose files are run, never edited.
- `commit-subject-follows-the-frame`: each task's commit subject reads `child-reclamation wave 9 task N: …`, the
  implementer frame's style, and not the draft's `feat(…)` subjects.
- `spec-5-8-pause-sentence-untouched`: §5.8's pause sentence is not in R92's list and is pinned by run 358's suites. It
  is read as R86 reads README `:5310`: "child reclamation" covers the collector.
- `no-pass-fails-shut-clear`: the spec's list of what clears the observation pairs names no "pass that fails shut", and
  the code's comments no longer do: a missing capability at a pass, a job or a learning audit is one clear. This
  contract's older lines and the plan keep the phrase as history.
- `r23-sweep-of-contract-and-ruling-tokens`: the fix wave replaced every contract and ruling token in this wave's code
  comments and test titles with the spec section it argues (§5.10), or dropped it where the sentence stands without it.
- `arming-checklist-names-the-capabilities`: the README's checklist before arming and the spec's list name both
  capabilities: `ccd caps` on the box whose ccd the server drives lists `collect-v1` and `reclaim-pause-v1`, since
  without either the lane does not run at all, shadow included, and an empty shadow feed proves nothing. It is worded as
  a fact the operator checks, never a step ccrc enforces.

**Plan-text corrections and measured red shapes**, per task (some are also named above under their rules):
- Task 1: `attention-doc-pair-counts-the-collector`, `collect-many-word-type-pinned-by-ts-expect-error`,
  `collect-l0-red-at-collection`, `step3-attention-case-reds-at-runtime`, `step3-tsc-shape-differs` and
  `t1-9-dated-directive-stays-consumed`.
- Task 2: `lock-die-mixed-bash-lines-row-added` and `t2-16-longer-id-row-reds`.
- Task 3: `population-header-in-task-2-style`.
- Task 4: `licence-header-in-task-2-style`, `presence-null-already-red`, `r23-sweep-of-contract-and-ruling-tokens`, and
  fix round 1's pacing pins (each answer's effect on the hold, the presence defer and the continuity clocks, and the
  rewritten not-witnessed case), and `changed-recently-row-uses-a-later-idleat`; fix round 2's wording of who reads the
  episode flag.
- Task 5: `stuck-end-exported`, `would-collect-body-calls-collect-who`, `watch-interim-empty-collector`, and fix round
  1's comment above the run-less count line, on which of its words are ccd's own and which are this build's labels;
  fix round 1's shape choices `reasons-hide-row-per-test`, `records-in-doubt-takes-the-doubts`,
  `collect-said-word-nullable` and `collect-read-what-exported`, a CONTROL lane row (an act `failed` with a non-empty
  token keeps the answer body), and three one-clause docstrings beyond the three ruled, indented at fix round 2.
- Task 6: `outcome-detail-is-diagnostic` and `ccdargv-collect-docstrings-rewritten`.
- Task 7: `collect-lane-fields-beside-the-child-reclaim-lane`, `older-pass-guard-is-shadowed-by-the-prune`,
  `t7-38-act-queue-pinned-by-the-registry-listing-count`, `t7-22-reds-as-a-timeout`,
  `publish-docstring-returns-rewrapped`, fix round 1's lane cases for a pause seen at step 5, the learning audit's
  `not-asked` and a learning call that never settles, its two comments on the flip row, and fix round 1's
  `box-probe-stamp-is-a-new-map`, `probes-read-where-they-live-mid-sequence`, `f4-answers-arrive-a-whole-interval-apart`
  and `f4-step-5-hold-armed-after-the-probe-pass`; fix round 2's lane case for a forgotten id's `collected` act, its L1
  row for an empty pass, and its docstrings on the fold-failure floor and on a rebuilt stamp.
- Task 8: `collect-act-cap-after-last-await-pinned`, `budget-test-pins-the-read-values`,
  `census-title-control-pins-its-width`, `h6-scan-follows-the-reshaped-audit-site`,
  `destructive-builder-fence-reads-whole-files`, fix round 1's pin that the act slot's bound covers twice
  `ws-collect`'s remote runner row, and its comment naming the excused vocabularies of the door-code scan; fix round
  2's comment saying twice the row is margin.
- Task 9: `collect-lane-prose-pins`, `r92-section-7-lines-are-section-5-10s`, `spec-stale-sentences-beyond-the-r92-list`,
  `spec-5-8-pause-sentence-untouched`, `no-pass-fails-shut-clear`, `flip-rows-are-for-changes-an-act-job-sees`, this
  note's refresh, `arming-checklist-names-the-capabilities`, and fix round 2's two residuals and slug lists.
- Task 10: `task-10-shards-run-as-halves-after-an-oom` and `commit-subject-follows-the-frame`, the whole-wave one.

**Ruled at fix round 1** (the seven open items the wave-done raised):
- `hold-presence-alternation-can-starve-attention`: not a finding. H9's `hold-and-presence-continuity-survive-observations`
  stands: a hold and a presence defer end each other's continuity clock.
- `collectable-alternation-is-silent`: not a finding as worded. Its feed cost was real and is fixed by
  `a-refusal-or-die-episode-outlives-observations`.
- `lane-silent-without-capabilities`: specified behaviour, the shape of the sibling lanes. The README's checklist and the
  spec's list now name both capabilities (`arming-checklist-names-the-capabilities`).
- `flip-row-filed-under-a-job-id`: prescribed, and nothing reads that attribution.
- `registered-id-with-a-kept-record-hidden-while-quarantine-is-unmeasured`: fixed, by the gate under
  `a-registered-id-projects-no-item`.
- `ccd-collect-budget-comment-sums-a-grace-per-probe`: carried, not fixed here, because `ccd/` is outside this wave and
  generated, so the carrying wave restamps it. The collector's per-probe grace sum and "A budget keyed on the mode is
  wave 9's" (in the header "BOUNDED, AND NOT ALWAYS INSIDE THE RUNNER'S ROW"), and COLLECT-V1's "ships it inert", go to
  the path-identity follow-up. EXPIRE-V1's "wave 3b composes it, this wave ships it inert" is workspace-lifecycle's. The
  budget the wave's test pins, about 73 s, or 78 s at the widest grace, is the right one.
- `spec-ws-expire-crumb-sentence-after-wl-w6`: the sentence is true at the tip. Whichever of wave 9 and
  workspace-lifecycle wave 6 lands second re-reads the spec's `ws-expire` crumb sentence.

`pass-scoped-box-lines-stand-until-the-next-call` is struck: `box-lines-clear-when-their-ids-leave` retired it. Also
retired: `collect-many-word-type-unpinned-by-a-red` (see `collect-many-word-type-pinned-by-ts-expect-error`) and
`projection-hides-items-while-a-listing-is-unmeasured` (narrowed into `a-registered-id-projects-no-item`). Void:
`ws-collect-cap-entry-is-a-classification`.

**Test citations, as built.** §16 and the plan's rulings cite `ws-collect-wiring.test.ts:25-26` and `:39` and
`ccdargv-dec-parity.test.ts:161`, the base lines before Task 1 added its type import. Measured at the tip, the plain-token
`wsCollect` calls in `ws-collect-wiring.test.ts` stand at `:26`, `:27` and `:40`, the token's one cast at its declaration,
`:16`; and `ccdargv-dec-parity.test.ts`'s cast stands inline at `:162`. Neither file's lines were edited to make them hold.

## 17. Rulings, 2026-10-12 (the path-identity W0 spec) — binding; they AMEND sections 1–16

R71 and R90 send a list of items to a "path-identity follow-up". That follow-up is designed in
`docs/superpowers/specs/2026-10-12-path-identity-design.md`, merged as #360 (`837a099c0`) on 2026-10-12. The operator
merged it naming no exception, so the recommended option of each row in its decision tables is a working ruling; both
programme ledgers' 2026-10-12 18:51 entries list them. The operator can change any of them before the wave that builds it
dispatches. This section carries the spec's W0 duties into this contract: the programme's shape, the amendments to R31,
R49 and R82, the reach of a blank admin entry, and the corrections review 388 asked for. Where this section and the spec
differ, the spec's design governs and this section is corrected.

- **R93 — the programme's shape.**
  - The follow-up is a programme of its own, `path-identity`, with its own ledger
    (`docs/superpowers/programs/path-identity.md`). It continues THIS contract: its rulings land here as new sections.
  - Its waves, in order: W1a, the server's id gate (run 399); W1b, ccd's id fix, after workspace-lifecycle wave 6 (#351)
    merges; W2, absences and mounts; W3, worktree path identity. W4 is not scheduled (PG1 B), so the spec's section 3.7
    residuals stand.
  - **The collector's Settings switch is CCR-15's wave 10** (run 400; SW6 A), because it changes what arms this
    programme's destructive lane. R96 is its rule.
  - Every `ccd/ccd` edit waits for #351 and then goes in series. Anything the waves share with `ws-expire` needs
    workspace-lifecycle's coordinator's consent, per wave (PG2 A).
  - R90's carries "to the path-identity follow-up" are placed, item by item, in the spec's section 7 inventory.

- **R94 — R31 amended: process state may refuse.**
  - R31's last bullet now reads: "Process state never grants deletion consent; it may only refuse." The rest of R31
    stands.
  - W3 adds one refusal-only cwd probe (PI4 D). It runs inside the existing post-kill bounded wait and again at step 4,
    and `ws-expire`'s probe moves onto the same helper. A process is in use when today's string compare OR the dev:ino
    ancestry of its `/proc/<pid>/cwd` meets the child. A process is skipped only on ENOENT or ESRCH of its own cwd link
    or stat file, or on the ruled EACCES exception; any other failure in the walk answers unmeasured, never "not
    inside". Darwin keeps `ws-expire`'s `lsof` arm.
  - R31's "left to a follow-up programme" (an alias re-pointed after entry, a spelling through a bind mount) is W3's
    entry identity, `$REG/<id>.workdirid` (PI1 B, PI2 L1, PI3 B). It is add-only: it may hold a row, and it never
    releases one.
  - The two remedies that say "re-point the link" contradict R31, and W3 rewords them (PI7).

- **R95 — R49 amended: a same-uid mount crossing is live, not latent.**
  - R49's "A bind mount of the same file system is a stated residual; only root can make one" is half false on the
    measured box. A same-uid process can make a FUSE mount in ccd's namespace, though not a bind (with unprivileged user
    namespaces blocked), and the design must hold either way.
  - `rm -rf --one-file-system` skips a directory on another device, so it skips a FUSE mount inside a leaf. `git worktree
    remove --force` has no device test, so it crosses a FUSE or sshfs mount inside a child or an archived worktree.
  - W2 asks the mount question (`_ws_collect_mounts_clear`) inside `_ws_leaf_remove`, before the leaf is normalised and
    again directly before `rm`, and before every standing nested-checkout and child forced removal (TR5 C). An answer of
    1 or 2 fails as `worktree-remove-failed` and keeps the tree. Darwin skips both classes, behind mutation pins.
  - After W2 the mount question catches a mount of either kind at or under the path, a same-device bind included. What
    stays a stated residual is the collector's witness device test, which cannot see a same-device bind of `~/.cc-tmp`
    itself (spec section 3.7).

- **R96 — R82 amended: the collector has two arms, then one (wave 10).**
  - **Two arms.** The lane is live when the legacy marker stands and its journaled latch is unset, OR when Settings
    stores exactly `live` for the fleet node measured on the current connection (SW1 A). Pause, an unlistable registry, a
    changed connection epoch and a missing capability beat both arms.
  - **Then one.** Once the operator removes the marker by hand and a successful same-epoch listing proves it absent,
    the server records the marker's retirement through the generation journal, and from then on Settings alone arms
    the lane. A re-created marker is reported and ignored.
  - **The proof of state.** The singleton row and the server-owned generation journal must agree exactly
    (`journalMaximum == rowGeneration`); the untouched seed with no journal is the only bootstrap. Any disagreement, and
    any unreadable or malformed journal, is safety-stopped. A whole-state restore that rolls the database and the journal
    back together is outside the proof: after one, the operator raises the cleanup pause and makes a fresh confirmed
    Settings transition before allowing Live.
  - **Off before the latch** answers `409 marker-still-controls` (SW2, option 3). **Live while sign-in is dark** answers
    `403 sign-in-unarmed` (SW4, option 2). A stored Live re-arms after a version change only once the same node is
    measured on the new connection (SW7 A). The lane flips on the effective boolean, never on its source (SW3).
  - **Unchanged from R82:** nothing in the tree writes the marker. The switch writes only its `coord.db` row and its
    journal. The route is session-gated and consults no box token. No skill names the route or the marker. Arming
    stays the operator's.

- **R97 — the reach of a blank admin entry, stated (PI9 K1).** A blank admin entry in a repository holds every child on
  the box at rung 9 while a gone row of that repository exists (review 378; `ccd/ccd`'s rung 9, located by content). It
  fails closed: it costs time, never a removal. Entry identity does not shrink it, because the entry field never releases a
  gone row (spec section 4.5, step 2). Narrowing it by name is rejected, because git renames entries.

- **R98 — corrections.**
  - **§16 as built, Task 5.** In "and three one-clause docstrings beyond the three ruled, indented at fix round 2", two of
    those docstrings, the watcher's, were indented at fix round 2, not three (review 388, F2).
  - **R90's SECURITY carry** ("gates `readRegistryMeasured`'s ids … refusing a leading `-`") is widened by SEC2 B to the
    registry readers, `knownId`, `POST /api/runs`, every stored-row argv seam and the two executor seams (spec section
    2.3). The predicate refuses a leading `.` as well as a leading `-`.
  - **Citations.** The spec cites lines at `28e8dc1b2`. Every plan that builds it locates code by content.

### §17 as built (wave 10, run 400)

Where wave 10's code and the plan's text narrowed or spelled out R96, they now read as follows. This note amends; it
edits no earlier text. It names each departure by slug and carries no number: the coordinator assigns this wave's
numbers from the block run 400 was issued, and the wave 10 plan's `## Deviations found` defines them. This wave's
committed comments and test titles cite §5 of the path-identity design spec, whose "§5 as built" note states the same
points. The CCR-15 design spec gains an as-built paragraph in §5.10 and a wave row in §8.

**R96 (two arms, then one), reconciled before the build.** The plan's rulings settle where the spec's sections and its
Figure 5 differ, and the code keeps each:
- A stored Live while the current node is unmeasured or in collision is stopped as an unknown fleet, never shadowed;
  a stored Live for a measured, different node is shadowed and asks for a fresh confirm. R96's "the fleet node measured
  on the current connection" is measured directly, never taken from the connection label or the persisted inventory
  row; in local mode the epoch is a constant 0 and the node is the server box's own.
- R96's "a changed connection epoch" beats both arms as a stop: nothing composed, every pair cleared, no feed row. Only
  an incoherent control state is safety-stopped, and only it writes a flip row. An act job carries the epoch it was
  queued under, so a reconnect during the second audit composes nothing.
- R96's "a successful same-epoch listing proves it absent" is any registry listing that is coherent, unpaused and on
  the same epoch: the pass's own and the executor's final one, through one helper and the store's one writer. The
  retirement is decided apart from the arm, never from the route, and never over a mismatch. Its one `kind:'coord'` row
  ends `; by collect sweep`.
- R96's "Off before the latch answers `409 marker-still-controls`" holds whatever the listing says: Off never reads the
  listing, and after the latch it is accepted while the registry is unlistable or the epoch moved.
- R96's "Live while sign-in is dark answers `403 sign-in-unarmed`" is checked after the body parse. Live also needs a
  fresh confirm whose key binds a per-process boot nonce, the epoch, the node, the row, the journal's maximum, the
  file, both capabilities and the pause. A Live that changes nothing still needs the confirm.
- An absent row answers `503 state-unmeasurable` and is never inserted; the GET answers 200 with a safety-stopped view
  for every other fault.

**R82, as R96 leaves it.** Nothing in the tree writes the file, and its constant still has exactly two code holders,
its definer and the executor. The switch writes only its `coord.db` row and `collect-lane-generation.log`. The route
consults no box token, and no skill names the route or the file.

**How the control state fails.** The journal reader accepts value-equal spellings of a number, such as `1.0` or `1e0`,
and a duplicate key resolves last-wins; it proves values, not spelling, and only a hand edit can produce one. A failed
latch retire at the update or commit step leaves the lane safety-stopped, with Off refused, and a confirmed Live is the
repair. A failed journal append undoes itself (as built from fix round 1): the adapter truncates the existing journal to
the length it measured before the call, or removes a file the failed call itself created, before the close and as a
best effort, and rethrows the original error. A failed write therefore leaves the lane exactly as it stood, row and
journal alike, and the route answers `503 write-failed`; a failed Off over a stored Live leaves the collector armed, and
Pause all cleanup still stops it. The undo restores bytes the call itself measured, so it does not rebuild the journal
from the row. An update or commit failure stops the lane and arms nothing. Three residuals stay: (1) a process killed
inside the write, or a power loss before the data reaches the disk (a failed fsync included), can leave a torn, empty or
zero-filled tail that reads malformed; (2) the journal can stand one generation ahead, a mismatch that a fresh confirmed
change repairs (Live, or Off once the latch is recorded) and that arms nothing, after a kill between the write and the
commit, an undo that fails after a full write, a close that throws after a durable record, or a failure at the update or
the commit; (3) an undo that itself fails after a short write, or on the created arm, leaves a torn or empty file with no
crash. Settings cannot repair a malformed journal, and the server never rebuilds it from the row. The hand repair, if
Settings reports the journal malformed after the server stopped mid-write: raise the cleanup pause first (Pause all
cleanup); on the server box cut `~/.ccrc/collect-lane-generation.log` just after its last complete `{"generation":N}`
record, removing only the bytes that follow it and never a complete record; if the file holds no complete record, delete
it, which is valid only beside the untouched seed, as a crash in the very first write leaves it; make a fresh confirmed
change in Settings; lower the pause.

**The stated residual.** An Off accepted after an act's argv was handed to ccd cannot stop that act. It extends
`marker-removal-after-the-last-listing-still-composes` (§16 as built) from the file to the switch, and a 200 says the
choice applies from the collector's next check.

**A second stated residual: `pre-latch-snapshot-repair-readopts-an-unset-latch`.** Suppose `coord.db` is restored on its
own from a snapshot taken before the latch was recorded, and the later journal stays beside it. The lane is then
safety-stopped (path-identity design §5.3). Its only repair is a confirmed Live, because Off is refused while the latch
is unset and the latch never heals a mismatch. That Live keeps the restored row's unset latch. Once it has repaired the
mismatch, a standing or re-created legacy file arms the lane again, on any node, and Off is refused again. This lasts
until the next coherent, unpaused, same-epoch listing shows the file absent and retires the latch. The window needs the
file to stand. While it stands, the confirm sheet says the file also arms the lane until this server records its
removal, and over a mismatch it says the confirm also repairs the control state. It cannot say that this repair keeps
the latch unset, or warn of a file re-created later, because the confirm's facts carry no latch.

**Carried, not fixed.** The coordinator skill's `references/resume.md` still names the newest `coord.db` snapshot as
the restore path with no word on the journal: skill text is outside this wave, and a restore that follows it fails
safe, because no backup holds the journal. The manual-downgrade hint's copy of `coord.db` over a live write-ahead log
is left as it was; this wave adds only the line that leaves the journal in place.

**Departures found while building.**
- `control-state-calls-no-choice-guard` (Task 2): The control state does not call the choice guard: the row measure reads any string as a choice, and the decision compares exact typed tokens.
- `live-refuses-an-empty-node` (Task 2): A Live write with an empty node id is refused, which the plan's text did not state.
- `journal-record-refuses-any-carriage-return` (Task 2): The journal grammar refuses a record that holds any carriage return, stricter than the plan's whitespace rule.
- `oversize-bigint-held-by-two-walls` (Task 2): An oversize integer is stopped by two independent checks, so a mutation that removes only the safe-range fold stays green by construction.
- `control-state-extra-pins` (Task 2): The control-state suite pins more than the plan lists, such as the derived journal-kind and unmeasurable-reason lists.
- `journal-reads-non-canonical-number-spellings` (Task 2): The journal reader proves values, not spelling; see "How the control state fails" above.
- `non-primitive-raw-value-reads-conflict` (Task 2): A non-primitive stored value, which only a hand edit can produce, never equals itself across two reads, so the write decision answers a conflict before unmeasurable; it fails closed and writes nothing.
- `plan-ruling-number-in-shipped-comment` (Task 3): Shipped source comments name a ruling's subject and no longer cite a bare plan ruling number, because those numbers collide with the programme contract's own; the source comments that carried one were reworded, while test titles keep the plan's wording, so four test sites still carry one.
- `node-epoch-guard-two-sided` (Task 4): The resolver's node-epoch guard is an exact comparison, and a case pins both sides: a node measured on a later connection than the one the check stands under is stopped as an unknown fleet, as an earlier one is.
- `error-outcome-publishes-inventory-refused` (Task 5): A sweep whose reads came back but whose apply threw or was refused publishes `inventory-refused` under its captured epoch, rather than publishing nothing.
- `link-down-at-sweep-start-publishes-nothing` (Task 5): A sweep that finds the link down before its await reads and publishes nothing, because the close already invalidated the identity cell.
- `cell-answers-are-frozen` (Task 5): Every answer from the identity cell is a frozen object built field by field.
- `fleet-identity-imports-nothing-pin` (Task 5): An extra case pins that the identity cell's module imports nothing and reads no clock.
- `run-inventory-behaviour-pins` (Task 5): Extra cases run the inventory entry point in local and remote mode and count exactly one publish, beside the source-text pin.
- `sw7-case-reads-the-resolver` (Task 5): The case for a stored Live across an update drives the resolver with the row unchanged: stopped until the same fleet node is known on the new connection, then armed again.
- `boot-timing-red-under-load-also-at-base` (Task 5): The boot suite's 3000 ms bound on a hung ccd delaying listen reds under box load on the base tree too, so it is not this wave's, and CI decides it.
- `journal-reopen-without-create` (Task 6): An append reopens an existing journal without `O_CREAT`, so a file removed between the two opens fails rather than being re-created, a shape the plan's text left open.
- `decide-defect-injected-through-the-reads` (Task 6): The store's decision-defect case is injected through the store's injected reads, not by editing the decision.
- `older-build-boot-emulated-by-a-newer-file` (Task 6): The older-build boot case puts this build where an older one stands, opening a file one version past it, because a test cannot run an older build.
- `append-not-regular-code-eftype` (Task 6): An append to a journal that opens but is not a regular file is refused with the code `EFTYPE`; a link is refused earlier, at the open.
- `adapter-comment-trips-the-handle-reach-scan` (Task 6): The journal adapter's header comment spells `coord.db` in backticks, because the plain spelling tripped the handle-reach scan of the single-definition suite; the scan stays armed and the meaning is unchanged.
- `a-failed-journal-append-can-leave-a-torn-tail` (Task 6): RETIRED, and named without a number, by `a-failed-append-undoes-its-own-bytes` below. The plan's adapter did not undo a failed write; as built from fix round 1 it does, and the residuals the undo cannot cover are in "How the control state fails" above.
- `a-failed-append-undoes-its-own-bytes` (Task 6): The plan's adapter left a torn or empty tail, or a journal one generation ahead, against its own contract that nothing changed at the append. As built, a failed append truncates the existing journal to its measured length, or removes a file the failed call created, before the close and as a best effort, and rethrows the original error, so a failed write leaves the lane as it stood. The three residuals and the hand repair are in "How the control state fails" above; the path-identity spec's §5.2 and §5.3 still govern a malformed journal.
- `epoch-with-pause-reports-the-pause` (Task 7): When the epoch moved and a pause is raised, the executor reports the pause as its stop reason.
- `executor-guard-admits-resolver-kinds` (Task 7): The executor's guard admits the resolver's kinds rather than a list of its own.
- `epoch-detail-reads-the-listing-capture` (Task 7): The `epoch-changed` detail says whether the connection moved after the job was queued or during the final listing, from an epoch captured before that listing.
- `stop-whys-answered-at-step-five` (Task 7): A stop found at the final check (a pause, a moved epoch or an unknown fleet) is answered as step 5, the final listing's step.
- `unchanged-retire-reads-as-not-due` (Task 7): A latch retire that the store reports as unchanged reads as not due.
- `existing-executor-cases-keep-an-epoch-zero-job` (Task 7): The executor's existing cases keep a job stamped with epoch 0, the rig's starting epoch.
- `collect-act-epoch-scan` (Task 7): An extra source-scan pin that the act path carries the job's epoch.
- `lane-port-and-latch-row-cases` (Task 7): Extra cases for the lane's port and the latch's feed row.
- `collect-lane-caps-and-control-now-cases` (Task 7): Extra cases for the lane's capabilities and for the control state read now.
- `latch-warn-key-outlives-an-executor-retire` (Task 8): A warn key for the latch can outlive a retirement made by the executor, so after a database restore under a running server one repeat warning may be suppressed; this is log hygiene only.
- `lane-rig-gains-the-identity-cell-and-switch-handles` (Task 8): The lane's test rig gains the identity cell and the switch's handles, in a file the plan's list did not name.
- `queue-to-start-cases-are-pins` (Task 8): The queue-to-start cases pass at entry, because an earlier task already holds them, so they pin rather than drive code.
- `gather-move-re-seats-the-seen-epoch` (Task 8): An epoch move during a pass's gather re-seats the lane's seen epoch as it clears every pair.
- `three-passes-measured-as-three-act-jobs` (Task 8): Three passes are measured as three separate act jobs.
- `pass-case-title-first-sees-the-marker` (Task 8): One pass case's title is worded around the first pass that sees the legacy file.
- `route-suite-header-list-annotated` (Task 9): The route suite types its list of header sets as string records so that the suite type-checks; its assertions are unchanged.
- `row-12-coord-token-counts-check-sites-only` (Task 9): The coordination token census counts `checkMailToken` call sites only, so a gate added through the `requireMailToken` helper is held by the route suite's behaviour and source-scan rows and by the pause route's ungated set, not by that census.
- `writer-census-reads-server-src` (Task 10): The writer census reads the server's source only, because the PWA client has a method of the same name that posts to the route and is not the store's writer.
- `pins-have-no-red-first-run` (Task 10): The pins cover code already shipped, so their first run is green, and their red half is the mutation table.
- `skill-plant-in-memory-copy` (Task 10): The skill suites prove their plant on an in-memory copy of the skill text and never edit a skill file.
- `journal-adapter-built-once-pin` (Task 10): An extra pin that the journal adapter is constructed exactly once, in the composition root.
- `inventory-throw-publishes-refused-pinned` (Task 10): A sweep case with a throwing store pins that a throw while recording a node publishes an `inventory-refused` cell, not nothing.
- `collect-words-carry-the-sections-copy` (Task 11): The Settings section keeps no words of its own: every line it renders comes from the words module.
- `collect-words-totality-pin-in-a-test-d-file` (Task 11): The words table's totality is pinned in a type-level test file.
- `collect-view-reader-checks-armed-by-agrees` (Task 11): The view reader checks the armed-by field against the agreement rule.
- `an-unknown-post-failure-reads-unconfirmed` (Task 11): Only a known refusal code reads as a refusal in the Settings section. Any other failed answer (an unknown code, a body that is not an object, a gateway or server status, the gate's foreign-origin refusal) reads that the choice "may or may not have been saved", with its detail, and the section re-reads the choice.
- `collect-confirm-lines-name-the-pause` (Task 11): The confirm sheet's lines name a raised pause.
- `collect-off-note-unmeasured-latch-claims-no-control` (Task 11): A latch that was not read gets the unmeasured Off note whatever the listing shows, so the note claims no control.
- `pause-all-cleanup-case-split` (Task 12): The Pause all cleanup cases are split into five inside one describe.
- `inline-refusal-cleared-by-a-newer-view` (Task 12): The plan cleared an inline refusal only when the next write started. As built, a newer view clears it too: a poll's answer, or the re-read after a refusal.
- `stale-line-pinned-in-section` (Task 12): The Settings section pins one case beyond the plan's list: a read that did not land keeps the last view, marked stale, so a kept Live is never shown as current.
- `usage-rewrap-heredoc-neutral` (Task 13): The rewrapped usage text keeps its heredoc's line count.
- `journal-pins-green-at-entry` (Task 13): The restore, watchdog and uninstall cases that leave the journal in place are green at entry, because none of those paths touches it, so their red half is a mutation row.
- `usage-shift-unpinned-by-citations` (Task 13): A shift in the update and backup usage text is measured by the citation anchors' hash, not by the session-hook suite, which stays green.

Smaller departures carry no slug: three further pins in the store and journal suites, an epoch-pair case and a never-throw sentence on the latch writer's docstring added in review, the writer census bounded to the POST handler in review, and Tasks 11 and 12 (PWA only) built before Task 9. The path-identity spec's stale line citations are re-measured in its "§5 as built" note and left as written.

### §17 as built (path-identity W1b, run 433)

Where W1b's code and its plan's text narrowed, corrected or spelled out the spec's working rulings for ccd's half of
the id fix (SEC1 and SEC3 to SEC7, spec §2.4 to §2.8), they now read as follows. This note amends; it edits no earlier
text. It names each departure by slug and carries no deviation number. The coordinator assigns this wave's numbers
from the block run 433 was issued, and the W1b plan's `## Deviations found` defines them. The spec records the same
wave in its §2.9, and where the two differ, the spec governs, as this section's opening says. This wave's committed
comments and test titles cite the spec, never this contract.

**R93 (the programme's shape).**
- W1b was dispatched after workspace lifecycle wave 6 (#351) merged. Its `ccd/ccd` edits went in series, one task at
  a time, and each was restamped with the repository's own tool. When `main` moved during the wave (the supervisor
  tick diet's first wave, #395, merged), it was absorbed with `git merge`; the only conflict was `ccd/ccd`'s stamp
  line, which was restamped, as R56 says for a second lander. `main` moved again, and Task 13 absorbed it before the
  PR opened, a second time, as `65614d35`, of `main` at `c7776b080`. That brought code PRs #189, #190, #191, #403, #406 and #408,
  plus docs PRs. Its one conflict was the stamp line, regenerated. Fix round 1 absorbed `main` a third time, as
  `7bfef06cc`, of `main` at `a3cebde1b`. That brought ten PRs: code PRs #404, #411, #412, #413 (CI and tests), #417,
  #418 and #419, and docs PRs #342, #414 and #416. Its one conflict was `ccd/ccd`'s generated stamp line, restamped.
- Workspace lifecycle's coordinator consented to its three `ws-expire` edits: the loop's identity pair and the verb's
  entry line, each with its short comment, and `_ws_expire_audit_contained`'s entry line. `_ws_expire_locked` and the
  EXPIRE-V1 note were not edited.
- The collector header's COLLECT-V1 note now says the lane acts only once the operator arms it, by the fleet box's
  legacy marker or by the Settings switch where it has shipped. That sentence is true whether or not wave 10 has
  merged.
- `census-blind-below-line-5818`: measured at this tip, the compaction-card corpus's five census passes, and the
  citation-debt and corpus-fact passes beside them, stay green under a one-line insert after any `ccd/ccd` line from
  5818 down. An insert after line 5817, and after every line sampled above it, reds the `|`-row pass and no other
  (bisected to that boundary, then sampled every 500 lines to the end of the file). Every edit of this wave, the stamp
  line aside, lies below that line, so the line neutrality of the functions that start above `cmd_start()` was proven
  by start-line and line-count diffs, not by the census.

**SEC1 and SEC3 (which verbs; predicates and loops).**
- `surface-dash-rule-at-stop-and-ws-add-only`: a dash-leading `--surface` value is refused at stop and ws-add only,
  the two positional-id verbs, where it closes a redirect. The eight `--session` verbs keep their surface grammar,
  since the `--session` pair closes theirs. `stop --surface pwa --surface` is refused by the loop's arity check, not
  by the post-loop id check. Spec §2.9 corrects §2.4 on both points.
- `reg-id-ok-under-lc-all-c`: `_reg_id_ok`, the one dash rule, reads the registry charset under `LC_ALL=C`, with a pin
  of its own.
- `stop-checks-its-residue-and-composed-id`: stop also refuses a dash-leading residue token, and a composed id that
  `_reg_id_ok` refuses. Each refusal is a bare `die` that names what it refused. In the two-argument form a trailing
  dash-leading token was silently ignored, and now answers `bad session id`; no server builder composes it.
- `ws-add-refuses-a-second-actor`: ws-add refuses a second `--actor`, in either spelling or a mix, with its usage line.
  The server's builder order is unchanged.
- `ws-hold-reason-stays-unbounded`: the spec's "non-blank and bounded" holds for the `--actor` and `--reason` decision
  fields only. The hold reason gets no cap.
- `flag-spelled-token-answers-a-malformed-value`: a token or run id spelled as a flag is taken whole and answers
  `bad token` or `bad run id` where it answered the usage line, and ws-reclaim journals that refusal against the real
  id. No server builder composes such an argv.
- `hold-reason-spelling-a-flag-is-held-verbatim`: a hold reason that is itself a flag spelling is held verbatim, where
  the `--surface` arm ate it or the arity rule refused it.
- `rename-branch-value-taken-whole`: a ws-rename `--branch` value that spells a flag is taken whole and answers
  `bad-branch`, where the surface word became the new branch name.
- `valueless-session-key-takes-the-next-flag-as-its-id`: at all eight `--session` verbs, a `--session` with no value of
  its own, followed by a decision flag, takes that flag as its id. `ws-release --session --actor ''` dies on the usage
  line where it died on `--actor must be non-blank`, and at a token verb `--expect <token> --session --surface=w`
  answers `bad session id` where it answered the usage line. At ws-restore the refusal row now names the flag as its
  id (`--surface`, for example), where it named `''`. It is still a refusal, with the same exit code and before any
  act: spec §2.4's atomic consumption.
- The identity pair stays in each loop's residue, so each verb's own arity and order checks keep refusing a
  duplicate, a wrong order and a lone key with the words they used before. No refusal word, probe word or journal act
  was added, and the refusal scan's sanctioned `die` set is unchanged.

**SEC4 (the project predicate).**
- `_ws_project_valid` refuses a leading `-`, after the entry check counted no dash-leading name on either box. Its
  four callers, `enable`'s new project check among them, say "no LEADING dot or dash".
- `enable-validates-its-project`: `enable <wrapper> <project>` calls `_ws_project_valid` before it journals, so a dot-
  or dash-leading project leaves no `enable` row. It refuses more than before. It asks its wrapper first, with
  `cmd_start`'s own check and words, so an unrostered wrapper, or a flag-spelled one that reaches the two-argument
  form, leaves no `enable` row and no reap lock either.

**SEC5 (the cap).**
- `id-cap-from-the-name-census`: the cap is derived from a census of every name derived from an id, not from the slot
  alone. The widest overhead is 81 bytes, so 255 minus 81 is 174. The session hook's peer census skips an id longer
  than `CCRC_ID_MAX`, 128, so `_REG_ID_MAX` is 128, the smaller. It applies at ws-add, at start's creating form and at
  enable's two-argument form, each with its own die line, before any row, worktree, branch or `.uuid`.
  `ccd-id-cap.test.ts` holds the census and the files it left out.
- `ws-add-lock-precedes-the-cap`: ws-add takes its per-project add lock before it chooses a slug, so a cap refusal
  leaves that lock file, as every ws-add refusal after the lock does. No row, worktree, branch or `.uuid` is created.

**SEC6 (dots).**
- `dot-rule-extends-to-the-two-audits`: ws-reclaim, ws-expire and ws-collect refuse a dot-leading id at entry through
  `_ws_tmproot_id_ok`, and so do `ws-audit --reclaim` and `ws-audit --expire`, for symmetry with `isRegistryId`.
  Plain `ws-audit` keeps its check.
- `dot-leading-audit-now-exits-1-and-the-server-retries`: a dot-leading id at the reclaim and expire audits now exits 1,
  which the server's expiry and reclaim lanes read as an unreadable audit, where it got a terminal `no-such-session`
  document at exit 0. It is reachable only through a hand-planted run row, until the server's id gate lands.

**SEC7 (the reap lock).**
- `collect-registry-peek-before-the-lock`:
  - The collect audit and verb open `$REG/.reap-<id>.lock` only after an advisory pass. The pass needs a dash in the
    id, then a record whose body parses and names the id, or, with no record, a witness whose body parses.
  - For a witness that does not parse, a registry peek opens the lock unless `.child` and `.uuid` are proven absent,
    `$REG` can be listed, and the slug is free across every field and dot family. So `registered` still comes ahead
    of `witness-mismatch` for a live row of any kind.
  - R38 stands: no lock is unlinked, and the pass only decides whether one is ever created.
- `collect-verb-prelock-refusal-precedes-the-pause`: the verb reads the cleanup pause under the lock, so a pre-lock
  `witness-mismatch`, `quarantine-kept` or unmeasured answer now comes ahead of `paused`. It is terminal for junk
  either way, and nothing moves.
- `prelock-answer-precedes-in-progress`: the pre-lock answer also comes ahead of the lock's own. At the audit it
  precedes unmeasured `lock` and `in-progress`, and the audit's `mv` and `flock` checks still run first. At the verb it
  precedes `flock-unavailable`, `lock-unopenable` and `in-progress`. Junk input under a held lock therefore answers
  terminal `witness-mismatch` or `quarantine-kept`, as it does when no lock is held, because ccd writes a witness or a
  record by temp file and rename.
- `dash-free-id-answers-unmeasured-registry-before-its-record`: for an id with no `-`, unmeasured `registry` now comes
  ahead of every answer the resume gave before its registry rung and ahead of a standing `.child` or `.uuid`'s
  `registered`. Once the id is in the collector's population, it also comes ahead of the listing's unmeasured
  `records`; an id with no witness is asked its population first, so a failed listing, or `not-witnessed`, answers
  before the pass. The audit document prints `records: []` for it. It is unreachable in practice: every mint composes
  `<a>-<b>`, and the entry check counted no dash-free name on either box.
- `prelock-no-lock-clause-follows-the-detail`: the verb's pre-lock unmeasured answer puts the locked detail first and
  the no-lock clause after it. The refused site keeps its own prefix, unchanged. A cut at the 300-byte reason cap
  takes the clause first, and reaches the detail only when the detail alone passes the cap. The record reader's rc-3
  answer (the quarantine arm) carries the record path, and the `~/.cc-tmp` path when that cannot be resolved, so its
  detail grows with HOME. Under the suites' fixture HOMEs it is at least 318 bytes, and the line is that detail cut at
  300 bytes plus "…", with no clause. Under a short HOME, an unenterable or unusable `~/.cc-tmp` can leave the detail
  under 300 bytes, and the clause is then cut, or whole when the detail is 247 bytes or fewer. Either way the absent
  `.reap-<id>.lock` is the evidence. The answers with short details carry the clause whole. The pin pads a stub reason
  so that the detail's own operative words, "was never derived", end between byte 248 and byte 300 of the line, where
  the no-lock clause placed first would push them past the cut. Its detail passes the cap, so its line is that detail
  cut after those words, with no clause. No case pins the window from 248 to 299 bytes, where the clause itself is
  cut. The cut there is `_ws_leaf_why_line`'s, whose 300-byte position `ccd-ws-collect-reprove.test.ts` pins by
  comparing whole lines.

**The proof (spec §2.8 and §8).**
- `dash-parity-in-its-own-file`: the real-binary proof is `ccdargv-dash-id-parity.test.ts`. `ccdargv-dec-parity.test.ts`
  is unedited.
- `section-2-2-verdicts-measured-at-task-10`: the verdicts in spec §2.2 were measured by that file's matrix, run once
  against the pre-wave binary, not by the entry check, which writes nothing. Of 259 cases, 188 went red there and 71
  stayed green; all 259 are green at the tip. Spec §2.9 carries the measured tables.

**Stated residuals**, named with no number; spec §2.9 says each one in full.
- `dot-rule-only-at-the-token-verbs`: release, archive, restore, hold, rename and stop still accept a dot-leading id.
- `verbs-outside-sec1-keep-the-inline-regex`: ws-attic, pr-open, plain ws-audit, ws-reap, forget, `start <id>`,
  `pr-state --session <id>` and `route --session <id>` keep the id check they had; `ensure <id>` and
  `swap <id> <wrapper>` take their id with no shape check and need an existing row. Among all these verbs the server
  gives only `route` any of the decision flags (`--actor` and `--reason`), and `route` binds `--session` as a pair,
  so an id that spells one of them is bound literally and looked up. `forget` parses a `--reason` of its own, which
  no server builder sends: an id that spells it dies on the usage line or is refused `bad-args`, and never names
  another row. None of the other verbs parses the decision flags, and neither `route` nor `swap` redirects. The
  inline checks, `route`'s included (`swap` has none), run without `LC_ALL=C`, so under a widening locale they admit
  a non-ASCII id and bind it literally.
- `enable-one-arg-journals-an-unchecked-id`: `enable <id>` journals before any check of the id, as it did before.
- `stripped-flag-positional-collapses-to-the-id-form`: start and enable strip `--cross-pool`, `--`,
  `--route=<f>=<v>` and the two-token `--route <v>`, and stop strips `--surface` and `--surface=`, from any position
  before their arity rule, so a positional spelled as one of those never reaches the two-argument checks, and the
  call collapses to the one-argument (id) form. The two-token `--route <v>` takes the next token whole as the route
  pair, so it also eats the positional that follows it. For example, `enable --cross-pool <existing-id>` and
  `enable <wrapper> --` journal `enable` against the other positional and start that existing id,
  `start <existing-id> --route compact=50` (a project spelled `--route`, a workdir spelled as a route pair) restarts
  that row and writes the pair, where an eaten token that is no valid route pair is refused by the route check, and
  `stop <wrapper> --surface=x --surface pwa` stops `<wrapper>`. Not a regression: the pre-wave binary does the same.
  ccd never mints such a name (`=` is outside the charset and a leading `-` is refused). At start and enable it is
  reachable only through an operator-typed request body to the server's session-creation route, whose guard (refuse a
  wrapper outside the roster and a project failing the project rule) is carried to a later server wave. Stop's half is
  reached through the stop route's `stopPair`, which takes the project from the registry row, so it needs a
  hand-planted row whose project spells `--surface=<w>`.
- `hand-planted-ids-over-the-cap`: a row planted by hand above `_REG_ID_MAX` is not refused.
- `files-outside-the-name-census`: the file the cap's census left out.
- `history-spool-names-outside-the-census-patterns`: the history store's own names are built from a bare id or a file
  name that the census scanner does not match: the hook's `spool/<id>.jsonl`, the sweep's `.obs` sidecar, and
  `~/.ccrc/history/recall-off/<id>` (`recallOffPath`), a bare `/<id>` that adds no bytes beyond the id. The table
  holds the draining name, `<id>.<ms>.<pid>.jsonl`, which is still the widest of them, so the cap is unaffected. The
  history CLI's `${P.spool}/${id}.jsonl` (`writeRecallLine`) is now matched, and counted under the `<id>.<field>`
  family with the field `jsonl`.
- `quarantine-record-names-outside-the-census-patterns`: the quarantine record's name and its temp, and the witness
  writer's temp, spell the id in a way the scanner does not match; each is narrower than the widest row.
- `random-slug-decides-the-cap-near-the-boundary`: ws-add caps the id after it chooses the slug, so for a project of
  114 to 118 bytes given no slug, the random slug's length decides success or refusal.
- `projects-over-64-get-no-hook-card`: the cap bounds the composed id, not the project.
- `hold-card-workdir-quote-silent-near-the-cap`: the hook's hold card drops its workdir quote for a worktree path past
  127 characters, which an id near the cap can reach; it degrades to silence, never to a false statement.
- `btime-less-witness-takes-the-lock`: a parsed witness with no birth time opens the lock, and its answer is given
  under it.
- `dash-leading-pool-tag-unclearable-on-an-upgraded-box`: on a box that already holds the pool tag of a dash-leading
  project, `ccd project-pool --project -lead --clear` now refuses; the entry check counted none on either box, and the
  doctor already says to remove such a tag by hand.
- `server-docstrings-call-ccds-predicate-dot-only`: two server docstrings still call ccd's predicate dot-only, carried
  to the next wave that edits those files.
- `comments-say-ccd-scans-the-session-value`: the `isTmpRootId` docstring and the comment above `collect-l0.test.ts`'s
  dash-leading rows still say ccd's destructive verbs read their decision flags from any position, `--session`'s value
  included. That is true only of a box on an older ccd. Carried to the next wave that edits them.

**Found while building, per task.** Tasks 1 and 8 recorded no slug beyond those above; Tasks 4 and 5 found the one
census blindness named under R93. Task 12's slugs concern this record itself (the as-built prose, its prose test and
its draft claims) and are defined in the plan's Task 12 deviation entry only.
- Task 2: `token-verb-controls-use-a-wrong-token`, `collect-control-runs-on-linux-only` and
  `review-335-f9-needle-outgrows-the-cap-under-this-tmpdir`. Each token verb's control case sends a well-formed token
  no audit minted, so the real id binds, takes its own lock and is refused `state-changed`. ws-collect's control runs on
  Linux only, as the verb's end-to-end suite does. Two cases of `ccd-review-335-pins.test.ts` fail under a long
  `TMPDIR`, before the wave as after it, because their expected text outgrows the 300-byte reason cap; they pass under
  a short one, and the file is unedited.
- Task 3: `stop-residue-red-is-the-pair-form`, `stop-pair-project-surface-redirected` and `stop-extra-pins`. Stop's
  residue rule is observable only in the two-argument form, because a one-word residue is refused by the composed-id
  check anyway. Before the wave, `stopPair` with a project of `--surface` stopped `<wrapper>-pwa`; the suite pins it
  refused. It also pins an empty `--surface` value, a dot-leading id and the legitimate
  argv orders as still stopping the right row.
- Task 4: `start-line-gate-split-at-task-1s-insert`, `hold-and-rename-flag-ids-answer-bad-session-id` and
  `strip-reason-mutant-measured`. Line neutrality was measured in two parts: the starts above the id helpers' insertion
  against `main`, and every start against the previous commit, because the helpers moved what lies below them.
  ws-hold's `--actor` and `--surface` ids now die `bad session id` where they gave the usage line, and ws-rename's
  `--actor`, `--surface` and `--reason` ids answer a `bad-args` refusal whose detail is `bad session id: <id>`. The
  mutant that makes ws-hold strip `--reason` as a decision flag reds `ccd-actor-flags.test.ts`.
- Task 5: `merge-moves-a-stale-citation-under-a-rewritten-comment`. A merge of `main` moved `_ws_project_valid` down,
  so a stale `ccd/ccd` line citation in the compaction-card corpus came to name a line of the header comment that
  Task 5 had re-folded, line-neutral, and the new text carried the bare token `ccd` that anchors that citation. The
  session hook's citation debt read one less than on `main`. Fix round 1 re-folded the comment again, still
  line-neutral, so that line carries no bare `ccd`.
- Task 6: `ws-add-dash-test-imports-ccdargv`. The ws-add suite imports the server's argv builder and its decision type
  read-only, to compose the argv a server would send.
- Task 7: `id-cap-census-table-measured-at-the-export`, `census-compares-normalised-shapes`,
  `census-excludes-the-token-generation-file`, `reg-id-cap-under-lc-all-c-pinned` and `enable-cap-written-as-an-if`.
  The census table was measured at the plan's export and is identical on this tree. The scan compares names as
  shapes, each variable part a placeholder, so the spellings of one name are one row. `server/src/token/files.ts` is
  left out, with its reason, in `CENSUS_EXCLUDED`. `_reg_id_cap` counts bytes under `LC_ALL=C`, pinned as text because
  every composed id is already ASCII when it runs. Enable's cap line is an `if` on the argument count, so the
  one-argument form, which names an existing id, is not capped.
- Task 9: `child-uuid-peek-pinned-by-an-unmeasurable-child`, `other-id-record-reached-only-through-a-stubbed-reader`,
  `prelock-second-look-sound-is-unmeasured` and `prelock-reads-the-witness-for-the-document`. The registry peek's
  `.child` arm is pinned by the case where `.child` cannot be measured, because a plain `.child` row is also caught by
  the slug check. A record that parses and names another id is reached only through a stubbed reader, since on a real
  disk a record's name and body must agree. A judgement that reads sound on its second look met a writer between two
  reads, and answers unmeasured `records` or `witness`. The pass reads the witness even when records stand, so the
  audit document reports it as the locked resume does.
- Task 9, measured later: `prelock-prefix-cuts-the-rc3-detail` and `archived-expiry-census-fourth-collect-failed-site`.
  The plan's STOP for the resume suite's rc-3 case fired: under a `TMPDIR` of 67 and of 81 characters, the no-lock
  prefix pushed the detail's operative clause ("was never derived") past the 300-byte reason cap, which a run at about
  47 characters had not shown.
  The repair is `prelock-no-lock-clause-follows-the-detail`, above. And Task 9's pre-lock unmeasured failure is a
  fourth `cmd_ws_collect failed probe-unmeasured` site, so the archived-expiry census of failed and refused sites
  went red until fix round 1 added it, under the coordinator's licence.
- Task 10: `hold-and-rename-arms-are-matrix-blind`. Deleting ws-hold's or ws-rename's identity arm leaves the
  real-binary matrix green, because arity or the post-loop `_reg_id_ok` check already refuses those rows;
  `ccd-session-verbs-dash-id.test.ts` pins both arms.
- Task 11: `expire-v1-note-already-rewritten`. Workspace lifecycle's wave 6 had rewritten the EXPIRE-V1 note already, so
  it no longer says the lane ships inert and the stated residual the plan expected for it does not apply. The note was
  not edited.
- Task 13: `superpowers-tracked-file-count-is-one`. The plan expected no tracked file under `.superpowers`; one is
  tracked on `main`, from before this wave, and this wave's diff holds no `.superpowers` path.
