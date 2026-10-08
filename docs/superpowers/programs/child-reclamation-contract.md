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
  - **`expoAI-assistant-calm-mesa`** (branch proven absent; HEAD and every reflog commit on `origin/main`; clean
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
