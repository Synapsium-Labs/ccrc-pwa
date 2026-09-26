# Child reclamation, wave 4 — the sweep, the switch and the attention list (AGENT-FIRST) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close rule 4's loop with no human in it. A sweep lane reclaims every marked child the close path could not reach (dispatch's two orphan arms, a close whose reclaim deferred or failed), backing off a child whose reclaim keeps failing; a fleet-wide kill-switch the operator raises from the phone stops it — and `ws-reclaim` itself honours that switch on the box — and one attention list reports, asking nothing of anyone, every child a terminal refusal left standing and every child whose reclaim has kept failing past the defer ceiling.

**Architecture:** Five mechanisms, each with a test that reds when it is deleted. (1) `ccd reclaim-pause --state on|off` — `cmd_coord_pause` copied in every respect onto `$REG/reclaim-paused`, advertised as `reclaim-pause-v1`, and placed directly after `cmd_ls`'s closing brace: below the frozen corpus's highest `ccd/ccd` anchor (`:19131`) AND outside every function slice `ccd-refusal-scan.test.ts` reads (its `cmd_forget() {` … `cmd_ls() {` slice would otherwise count the new verb's `die`s as `cmd_forget`'s). (2) The grant: `['reclaim-pause','--state']` enrolled in `REQUIRED_VERB_FLAG` (negative type fixture `g14`), and the server's `CCD_ARGV.reclaimPause` + `RECLAIM_PAUSE_CAP`, read with `capSupported` only. (3) `POST /api/coord/reclaim-pause`, session-gated and carrying no box token, registered beside the coordinator pause route in `coord/routes.ts` so every census that pins that file's doors harvests it; the marker reaches the wire as `CoordStatus.reclaim`, and wave 3's one executor reads the same listing at the place wave 3 marked inside `childReclaimOutcome` — after the marker and sibling re-reads, BEFORE presence, the capability and any argv — answering `paused-at-server` through that function's own `deferred(...)`, so `reclaimChild` writes its one feed row for it (contract §7 R8, §8 R8′): the close path's skip, spec §5.8's second reader. (4) `sweepChildReclaim`, a SIBLING lane in `watch.ts` (the census lane may not mutate) whose every decision is a pure L1 function in `server/src/childReclaimSweep.ts`: the marker is the subject, an absent minting run is NEVER eligible (and is logged once), orphans are reached through a minting run that names a different session outside the spawn-stall window, a REVIEW child is kept while the run it reviewed is not terminal (contract §7 R16; an absent reviewed run is logged exactly like an absent minting run, §8 R16′), and eligibility is observed twice. The in-memory entry keeps TWO clocks (contract §8 R4′): `firstDeferredAt`, the first deferral of ANY kind, which every request carries as `deferredSinceMs` so wave 3's executor states in its feed row how long the child waited and why (§7 R4); and `firstPresenceDeferredAt`, the first presence-class deferral (`presence`, `attached`, `tree-busy`), which ALONE drives the 15-minute `CHILD_RECLAIM_DEFER_CEILING_MS` and so `deferExpired`. It also counts `consecutiveFailures`: after the k-th `failed` outcome in a row the next attempt waits `min(ceiling, CHILD_RECLAIM_SWEEP_MS × 2^k)` (§8 R20). Every request goes to that one executor, `reclaimChild`, through `deps.queue`. (5) `CoordStatus.childReclaimAttention`, derived from the lifecycle mirror ALONE (contract §4 and §7 R5; spec §5.9, "so a restart does not lose it"): per listed session, its events cut to its CURRENT WORKSPACE GENERATION by `childReclaimGeneration(events, now)` (§7 R6, its edges as §8 R22 rules them: no `done` create at or before now answers `[]`, and the closing bound is the first `done` create after it), and within that generation the latest `reclaim` event of ANY outcome, `intent` included, picked by `childReclaimLatest` (§8 R21 — an `intent` newer than every outcome lists nothing) — both created and exported from `server/src/coord/childReclaim.ts` for wave 5 to import. The child is listed when that event is a refusal whose token wave 3 classes `terminal`, or a `failed` row closing an unbroken run of failures that has lasted the ceiling (§8 R20, with the failure's sentence), and the session's registry row still exists; a failing child is listed AND still retried. A terminal refusal found at AUDIT time reaches the mirror through the `verb ws-audit` line wave 3's `cmd_ws_audit --reclaim` writes for exactly the kind map's TERMINAL tokens (§8 R5′ — a retryable one found there recurs every pass and is journaled nowhere; the sweep retries it by design, and wave 5 shows it through the sweep's defer state); `ws-reclaim`'s own refusals and its `_lc_fail` failures reach it through `ws-reclaim`'s lines. No in-memory memo feeds `CoordStatus` or the frame, and no executor answer is a source. Rendered by a `ChildReclaimBanner` row under the pause banner on `/runs` with the toggle beside it.

**Tech Stack:** bash 5 (`ccd/ccd`, `set -uo pipefail`, no `-e`), TypeScript 7.0.2 (server, agent) / 6.0.3 (pwa), vitest 4, `node:sqlite` `DatabaseSync`, React 19 + zustand (pwa).

**Spec:** `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` — §5.7 "On the sweep" and "Presence, and its bound" (AS AMENDED: an absent minting run is never eligible), §5.8 in full, §5.9 "One fleet-level attention item", §6 (the censuses that move), §8's wave-4 row, §9. Cross-wave names: the programme's interface contract (next line), §4 (wave 4) and §3 (the wave-3 surfaces this wave consumes), as its §7 and §8 rulings amend them. Ledger: `docs/superpowers/programs/child-reclamation.md`.
**Contract:** `docs/superpowers/programs/child-reclamation-contract.md` (cross-wave names and types; §7–§8 rulings; §9 R24–R33; §10 R34–R37) — and **the Pre-dispatch amendments at the end of this file bind every task and win over any task text they contradict**

**Depends on:** waves 1, 2 and 3 of this programme merged into this branch's base. Task 1 measures that before anything is edited, and STOPS if it is not so.

---

## Global Constraints

Copied verbatim from `CLAUDE.md`, the spec and the contract where the value matters. Every task's requirements implicitly include this section.

- **Deploy class for THIS wave: AGENT-FIRST.** `ccd/ccd` (the verb, the token) and `agent/src/whitelist.ts` (the grant) must be on the FLEET box before the server that composes `ccd reclaim-pause`. `ccrc rollout`'s DEFAULT order is fleet box first — "fleet box first because the server reads what the hook writes and the agent caches `ccd caps` at boot" — and this wave must NOT pass `--server-first`. Task 10 carries the order.
- **The contract is a committed file** (contract §8 R23): `docs/superpowers/programs/child-reclamation-contract.md`. Every "contract §N" in this plan means that file, §7 and §8 being its binding rulings. **Committed CODE comments cite the spec, never the contract** — every code block below (TypeScript source, tests, bash) names a spec section or states its reason inline; a contract ruling is named in this plan's prose, its mutation tables and its review lenses only.
- **Nothing in this wave deletes anything by itself.** The only destructive act is wave 3's `ws-reclaim`, reached only through wave 3's `reclaimChild`. This wave decides WHEN to ask, and it adds a switch that can only STOP deletion. Every eligibility rule fails SHUT: unreadable, unmeasured, absent and unknown all mean "not this pass", never "go".
- **A REVIEW child lives until the run it reviewed is terminal** (contract §7 R16; spec §5.7, "A review child is finished later than its own run"). The reviewer's report stays in its own clips and the coordinator cites it by path in fix-round mail, so a child whose minting run is a review run (`runs.reviews` non-null) is ineligible — `review-report-live`, the word wave 3's `childReclaimDecision` answers — while the run it reviews is not terminal. A reviewed run that is absent or unreadable is doubt, and doubt waits. An ABSENT reviewed run is logged — once per child per process — exactly as an absent minting run is (contract §8 R16′; spec §5.7, "Absence is logged and skipped").
- **Two deferral clocks, one backoff** (contract §8 R4′, R20; spec §5.7 "Presence, and its bound", §5.9). The sweep's in-memory entry keeps `firstDeferredAt` — the first deferral of ANY kind, which every request carries as `deferredSinceMs` so every deferred feed row states how long — and `firstPresenceDeferredAt` — presence-class deferrals only (`presence`, `attached`, `tree-busy`), which ALONE drives the 15-minute ceiling. A `held` or `state-changed` deferral must never expire presence. After the k-th consecutive `failed` outcome the next attempt waits `min(CHILD_RECLAIM_DEFER_CEILING_MS, CHILD_RECLAIM_SWEEP_MS × 2^k)`; any other outcome ends the run. A child whose failures have lasted the ceiling is LISTED with the failure's sentence and still RETRIED — a failure is retryable (contract §7 R11), and only a terminal refusal keeps a child off the lane.
- **The sweep's subject is the MARKER, never a run row** (spec §5.7): "A predicate written over run rows can never reach those." And (as amended) "**A minting run absent from the database makes a child ineligible**, not eligible … a lost or rebuilt coordination database makes *every* child's run absent at once, the live ones included. Absence is logged and skipped."
- **Two authorities, always** (ledger, carried constraint): child-ness is the box marker AND the server's `--child-of` argv, equal. The sweep takes the run id from `SessionRecord.child` (`ChildMark`, `kind:'child'`) and hands it to `reclaimChild` as `runId`; it never infers child-ness from `--no-rc`, a hold reason, a run row alone, or anything else.
- **No boolean at the child seam.** `ChildMark` is three-way; `kind:'unreadable'` DEFERS a reclaim. Any code in this wave that folds it into `none` or `child` is the fail-open Appendix B item 6 exists to prevent.
- **Every new surface is capability-gated and read with `capSupported`, never `verbSupported`** (which permits when the box's verb list is absent). This wave's token is `reclaim-pause-v1`; the sweep additionally reads wave 3's `reclaim-v1` and does nothing on a box that does not advertise it.
- **The pause file is read inside `ws-reclaim`** (wave 3's rung 3, fresh arm and resume). This wave ships the file's WRITER and proves, by a scan, that the writer and that reader name one path. Spec §5.8 names four readers — "The sweep skips; the close path skips; the PWA renders" and `ws-reclaim` — and this wave ships all three server-side ones: the frame (Task 4), the executor both triggers share (Task 5, the close path's skip) and the sweep (Task 8).
- **Node floor `>=22.13.0`, identical across the three engines**, pinned by `server/test/node-floor.test.ts`. If node-floor's absolute assertion (3) is red while (1–2) are green, **RAISE engines — never lower them to make it green.**
- **No root `package.json`, no root runner.** Four packages, each `"type":"module"`, run cd'd in: `server/` `agent/` `pwa/` `shared/`. Every command below is written from the worktree root unless it begins with `cd <package>`.

      cd server && npm ci && npm run test    # vitest run — hermetic
      cd agent  && npm ci && npm run test
      cd pwa    && npm ci && npm run test

- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`** — it resolves a global copy with no jsdom and falsely reports "no tests".
- **Run suites in the FOREGROUND, timeout ≥600000ms.** Backgrounding hides a hang; the suites are load-sensitive. The whole server suite does not fit one 600 s foreground run on the fleet box: run it as the six shards `--shard=1/6` through `--shard=6/6`, SEQUENTIALLY. **Never mix denominators:** vitest 4's `calculateShardRange` hands the remainder files to the LOW shards, so a mixed set such as `1/3` + `3/6…6/6` skips one file whenever the file count `n` has `n % 6` in {2, 3} (at 375 files, sorted index 125 runs in no shard). A shard that overruns 600 s is split into `k/12` for the WHOLE set, never alone. The sum of the shards' `Test Files` counts must equal `find server/test -name '*.test.ts' | wc -l`; Task 10 checks it.
- **Known load flakes** (re-run IN ISOLATION before calling a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`. CI on the quiet box is the arbiter.
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** Harness: `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`). A test that builds its own env via `execFileSync` passes `ghContainedEnv(h.home, {...}, { systemd: true, tmux: true })`. `$REG` is `$HOME/.cc-sessions`: a test that wrote the real `reclaim-paused` would stop the real fleet's reclamation.
- **NEVER run destructive `ccd` verbs against the live host** (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore` — and, from wave 3, `ws-reclaim`), **never touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*.service` directly**, and never print secret file CONTENTS.
- **Rings / bounded contexts:** ring membership is a property of a file's IMPORTS, not its path. L0 `shared/*.ts` imports NOTHING. L1 policy = pure decisions, no `fs`/fastify/`reply` — `server/src/childReclaimSweep.ts` imports `shared/api.ts` and nothing else. L4 delivery (`watch.ts`) owns timers but is NOT allowed to DECIDE: it gathers, calls the L1 verdict, and applies it. **An adapter may not narrow a distinction it received.**
- **No overloaded null at a seam.** `childReclaimMarker(coord)` answers `null` for "this server predates the field" and `'unmeasurable'` for "the registry did not list" — two conditions the banner handles differently (render nothing vs render the doubt), never folded.
- **Single-source-of-truth values are enumerated once.** `'reclaim-paused'` is a literal in exactly one source file (`server/src/coord/rundefs.ts`); `'reclaim-pause-v1'` exactly once in `server/src` (`server/src/ccdargv.ts`). The bash copies live in `ccd/ccd`, outside the scanned roots, and tests hold each pair equal.
- **Wire discipline — additive-only, absence-permits:** `CoordStatus` gains two fields; do NOT bump `FLEET_PROTO`. The PWA reads each new field through ONE tolerant reader (`childReclaimMarker`, `childReclaimAttentionOf`), and a frame from an older server that lacks them renders exactly what it rendered before this wave.
- **Mutation-table discipline:** a new guard ships WITH a test that goes RED when the guard is deleted/mutated (measured before/after, not a comment). "A comment is a request; a red suite is a mechanism." TDD red-first.
- **`ccd/ccd` is a provenance-STAMPED file.** Line 2 is `# ccrc:generated 1 sha256=…`. **Every task that edits `ccd/ccd` re-stamps AFTER its last `ccd/ccd` edit**, or `server/test/ownership.test.ts` goes red:

      node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
        const { markGenerated } = await import('./shared/mark.mjs'); \
        writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"

- **The citation tax is owed by every CITED file** (contract §7 R9): any insertion into a file `README.md` or the frozen compaction-card corpus cites by line — `ccd/ccd` and `shared/api.ts` today; the census (`session-hook.test.ts`'s `byFile` and `TOUCHED`) names the set — pays S6-R11 in the same task. This wave also inserts into `server/test/single-definition.test.ts`, a cited file, but BELOW its highest anchor (`:1303`; Task 4's `describe` lands after the Build 4 block, at planning line 2142), so it moves nothing — Task 4 Step 8's census run is the measurement. **Edit length above the corpus's highest anchor into `ccd/ccd` (`:19131`) is a DECISION** (wave 1's rule): prose there stays length-neutral, and long comments go below it. The figure is contract §8 R9′'s — the highest anchor into `ccd/ccd` in the two frozen compaction-card documents, bare `:<n>` forms included, measured at `507aefe9` — and this is the grep that finds it:

      grep -ohE '(ccd/ccd)?:[0-9]{4,5}\b' docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
        docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md | grep -oE '[0-9]+' | sort -n | tail -1

  Expected: `19131` (neither document may change on this branch, so neither may the figure). So Task 2 puts `cmd_reclaim_pause` — the function and its whole argument — below that anchor, directly after `cmd_ls`'s closing brace (at planning `ccd/ccd:23049`, before `cmd_attach() {`), and adds exactly TWO lines above it (the `reclaim-pause` heredoc line and the `echo reclaim-pause-v1` line in `cmd_caps`). NOT between `cmd_forget` and `cmd_ls`: `server/test/ccd-refusal-scan.test.ts` slices `cmd_forget() {` … `cmd_ls() {` as `cmd_forget`'s body and reds on every unrecorded `die` in it, and the new verb's three `die`s would read as `cmd_forget`'s. After `cmd_ls` lies outside every slice that suite's `VERBS` names.
- **A `ccd/ccd` edit pays the citation-corpus tax** (`server/test/session-hook.test.ts`, procedure S6-R11, no D-number). Inserting lines into `ccd/ccd` shifts anchors that two frozen corpus documents and `README.md` cite. README is REPAIRED by content (its census is an equality with EMPTY); everything else is RE-MEASURED with its composition stated. The sets are long — DUMP them, never retype an anchor. Task 2 Step 7 carries the procedure; Task 10 re-runs it on the merged tree.
- **So does a `shared/api.ts` insertion — `shared/api.ts` is a CITED file too** (waves 2 and 3 paid the same tax). `README.md` anchors four operator pointers into it by line number (the purge-refusal vocabulary: the three `LcRefusalToken` union arms `'purge-refused'`/`'purge-incomplete'`/`'purge-mechanism-absent'` and their three map keys — `shared/api.ts:7465-7467`, `:7505`, `:7513`, `:7526` at `62d9c485`, since moved by waves 2 and 3's inserts and re-anchored by content), and the citation-debt census counts stale `shared/api.ts` anchors in the frozen spec/plan corpus. Task 4 inserts `ChildReclaimAttention` and widens `CoordStatus` (at planning line 3640) ABOVE every one of those anchors, so Task 4 pays S6-R11 in its own Step 8 — README re-anchored by CONTENT, the debt census's `'shared/api.ts'` entry and its sum re-measured — and runs `session-hook` in its own suites. No other task of this wave edits `shared/api.ts`. Never re-anchor by adding a line delta to a number.
- **The `_reg_get` census** (contract §7 R10): a task that adds a `_reg_get` call to `ccd/ccd` re-measures `server/test/ccd-reg-get-census.test.ts`'s header sentence by wave 1's procedure, in that task. This wave adds NONE — `cmd_reclaim_pause` reads no registry field, it tests one file with `-e` — and Task 2 Step 6 runs that census to prove it (unchanged).
- **Zero new ccd verbs for coordination mutation** is not engaged: `reclaim-pause` writes a registry FILE, exactly as `coord-pause` does, and mutates no coordination row. The exec surface stays `EXEC_COMMANDS = ['tmux','ccd']`.
- **`gh` has NO exec-whitelist entry, deliberately.** Never add one.
- **The box token gates machine lanes; this route is not one.** `POST /api/coord/reclaim-pause` is session-gated only (armed, it sits behind `auth/gate.ts` like every PWA write), goes in `coord-pause-route.test.ts`'s `SESSION_ONLY` (NOT `UNGATED` — raising the switch releases no wedge), and is exempt from the coordinator skill's route census AND forbidden from its corpus: a coordinator told about this dial would be told how to stop or restart the reclamation of its own children.
- **The ccrc-api 30 s client ceiling is not engaged:** the sweep runs inside the server, `void`-dispatched from the tick, and joins the per-session `KeyedQueue` exactly as wave 3's close path does. Nothing in this wave makes an HTTP caller wait on a reclaim.
- **Naming** (contract §0): every NEW TypeScript identifier, file, CSS class and test file this wave adds says `childReclaim`/`ChildReclaim`/`child-reclaim`. The contract's own names are kept exactly: `RECLAIM_PAUSE_CAP`, `CCD_ARGV.reclaimPause`, `RECLAIM_PAUSE_MARKER`, `CoordStatus.reclaim`. `server/src/coord/reclaim.ts`, `ReclaimRefuseCode`, `RECLAIM_COPY` and `POST /api/runs/:id/reclaim` mean something else (reassigning a dead coordinator's claim) and are not touched.
- **Claim before you edit** (worker clause 11): `POST /api/claims` with every path in the File Structure table below, all-or-nothing, before Task 2.
- **Branch discipline:** commit on this workspace's own branch only; never a separate feature branch (a feature branch wedges every close with `stale-tip`). One commit per task (Task 1 commits nothing).
- **Locate code by CONTENT.** Every line number below is "as of the branch tip at planning" (`62d9c485`, before waves 1–3 merged) and is a hint, never an address. Waves 1–3 and two other live programmes edit the same files.
- **`## Deviations found` numbers are ISSUED, never chosen** — see that section at the foot of this plan.

---

## File Structure

| File | Created / Modified | Its one responsibility |
|---|---|---|
| `ccd/ccd` | Modify (`cmd_reclaim_pause` directly AFTER `cmd_ls`'s closing brace, before `cmd_attach() {` — BELOW every frozen corpus anchor into this file, `:19131` (contract §7 R9, §8 R9′), and OUTSIDE `ccd-refusal-scan.test.ts`'s `cmd_forget() {` … `cmd_ls() {` slice; `cmd_caps`'s verb heredoc and its token tail, ONE line each and no prose; the dispatcher `case` and its `*)` usage line) | The fleet box's writer of `$REG/reclaim-paused`, and the `reclaim-pause-v1` token |
| `server/test/ccd-child-reclaim-pause.test.ts` | Create | The verb's own suite, and the scan that holds its path equal to the one `ws-reclaim` reads |
| `server/test/ccd-archive.test.ts` | Modify (`KNOWN_CAPABILITY_TOKENS`; one `toContain`; its `ccdargv.js` import) | caps↔dispatcher parity, and the third spelling of `reclaim-pause-v1` |
| `server/test/session-hook.test.ts`, `README.md` | Modify ONLY if S6-R11 moves them (Task 2 Step 7, for the `ccd/ccd` edit) — and in Task 4 Step 8, whose `shared/api.ts` insertion lands above README's four `shared/api.ts` anchors | The citation corpus's census, re-measured; README anchors repaired by content |
| `agent/src/whitelist.ts` | Modify (`REQUIRED_VERB_FLAG`; `EXEC_WHITELIST.ccd` after `['coord-pause', '--state']`) | The grant — two tokens wide, enrolled so it cannot narrow |
| `agent/test/types/bypasses/g14-reclaim-pause-without-state.ts` | Create (the next free `gN` — Task 1 measures it) | Negative type fixture: the bare `['reclaim-pause']` MUST NOT COMPILE |
| `agent/test/types/ok/legit-whitelist.ts` | Modify (type-assert block) | `ChildReclaimPauseNeedsState` — the enrolment pinned as a type |
| `agent/test/whitelist-structural.test.ts` | Modify (`EXPECTED`) | The fixture's expected TS code |
| `server/src/ccdargv.ts` | Modify (`CCD_ARGV.reclaimPause` after `coordPause`; `RECLAIM_PAUSE_CAP` after wave 3's `RECLAIM_CAP`) | The one argv mint site for the verb, and the capability token |
| `server/test/whitelist-subset.test.ts` | Modify (`SAMPLES`; layer 2c `EXPECTED`; one layer-3 case) | The argv the server builds is exactly what the agent grants |
| `server/test/capsupported.test.ts` | Modify (one `it`; import) | `RECLAIM_PAUSE_CAP` spelled once, read with the refusing default |
| `shared/api.ts` | Modify (`ChildReclaimAttention` + `CoordStatus` beside `MarkerState`) — a CITED file: Task 4 Step 8 pays S6-R11 for this insertion | L0 wire types |
| `server/src/coord/rundefs.ts` | Modify (after `COORDINATOR_PAUSE_MARKER`) | `RECLAIM_PAUSE_MARKER`, the one spelling of the file name |
| `server/src/coord/childReclaim.ts` | Modify (wave 3's file: `childReclaimPauseRead`; the pause read REPLACING wave 3's marked comment inside `childReclaimOutcome` — after the sibling re-read, before presence, returning through that function's own `deferred(...)`; `reclaimChild`'s re-read docstring — Task 5. `export const childReclaimTokenKind`, `export function childReclaimGeneration` and `export function childReclaimLatest`, directly after `CHILD_RECLAIM_TOKEN_KIND` — Task 8) — and, only if Task 1 Step 3 found one, its `'reclaim-paused'` literal | The close path's skip (contract §7 R8, placed as §8 R8′ rules): the one executor reads the switch before it asks ccd anything, and its one feed row records it; THE one total reader of wave 3's token-kind map, beside the map it reads (R15); THE one generation fence (§7 R6, edges §8 R22); and THE one latest-event rule (§8 R21) — wave 5 imports all three as-is |
| `server/test/child-reclaim-paused-at-server.test.ts` | Create | `paused-at-server` has a producer at the ruled place: both triggers, past the ceiling, before presence, after the sibling re-read, through the executor's one feed row |
| `server/src/watch.ts` | Modify (imports — `childReclaimTokenKind`, `childReclaimGeneration` and `childReclaimLatest` among them, never a local copy; `CHILD_RECLAIM_SWEEP_MS`; five fields; `emitCoord`; `sweepChildReclaim` + `childReclaimLogAbsence` + `execChildReclaim`; one `void` dispatch in `tick()`; `currentChildReclaimDefers()`) | Gathers and applies; decides nothing |
| `server/src/childReclaimSweep.ts` | Create | L1: the eligibility verdict (the review-child rule of contract §7 R16 among its conjuncts), the twice-observed memory with its two deferral clocks (§8 R4′) and its failure backoff (§8 R20), the attention input row of one generation's latest reclaim event with its run of failures, the one reading of "under a terminal refusal", and the attention derivation — terminal refusals and failures past the ceiling, from the mirror rows and the live registry map, nothing else |
| `server/src/coord/store.ts` | Modify (`childReclaimSessionIds()` after `lifecycleFor`) | The narrowing mirror read: which ids have any `reclaim` history (the per-session reads are the existing `lifecycleFor`) |
| `server/src/server.ts` | Modify (`Deps.childReclaimExec?`) | The one test seam for the sweep's executor call |
| `server/src/coord/routes.ts` | Modify (the route, directly after `POST /api/coord/pause`'s handler; import) | `POST /api/coord/reclaim-pause` |
| `server/test/child-reclaim-pause-route.test.ts` | Create | The route's behaviour |
| `server/test/coord-pause-route.test.ts` | Modify (`SESSION_ONLY`) | The door census, both directions |
| `server/test/coordinator-skill.test.ts` | Modify (`EXEMPT` + one forbid-mention case) | The skill corpus neither names nor needs the dial |
| `server/test/auth-gate.test.ts` | Modify (two exact counts + their comments; one registration) | The route surface's cardinals, re-measured |
| `server/test/verb-gate.test.ts` | Modify (`CAP_GATED_VERBS`) | The route answers the skew question with its capability |
| `CLAUDE.md` | Modify (the box-token bullet's session-only sentence) | The prose `box-token-census.test.ts` derives against |
| `server/test/fleetws.test.ts` | Modify (eight `coord` equalities; one new case) | The frame carries `reclaim` |
| `server/test/single-definition.test.ts` | Modify (one `describe`) | `'reclaim-paused'` has one home and `watch.ts` reaches it |
| `server/test/mail-routes.test.ts` | Modify (`NOT_CODES`) | A marker file name is not a refusal code |
| `server/test/child-reclaim-sweep-policy.test.ts` | Create | The L1 verdicts, table-driven |
| `server/test/child-reclaim-sweep.test.ts` | Create | The lane, wired: what reaches the executor, when, and with which `deferExpired` and `deferredSinceMs`; the backoff; the two absence logs; the attention list on the frame, failures included |
| `server/test/child-reclaim-generation.test.ts` | Create | `childReclaimGeneration` (its R22 edges as R22′ corrects them among the rows, a recycled slug and a clockless `create` among them) and `childReclaimLatest` (an intent after a refusal among its rows), table-driven, and the scan that finds each defined once |
| `pwa/src/lib/api.ts` | Modify (`childReclaimPause`) | The client call |
| `pwa/src/fleet/childReclaimWords.ts` | Create | The marker's word/glyph tables and the two tolerant readers |
| `pwa/src/fleet/ChildReclaimBanner.tsx` | Create | The reclaim row: word, glyph, toggle, attention list |
| `pwa/src/fleet/CoordBanner.tsx` | Modify (export `inlinePauseError`) | One 501/502 inline policy, two banners |
| `pwa/src/screens/RunsScreen.tsx` | Modify (mount after `<CoordBanner />`) | The row ships on `/runs` and nowhere else |
| `pwa/src/fleet/fleet.css` | Modify (after the `.coord-toggle` rules) | The row's self-grounded rules |
| `pwa/test/child-reclaim-banner.test.tsx` | Create | The row's behaviour and its mount |
| `pwa/test/api.test.ts`, `pwa/test/fleet-css.test.ts`, `pwa/test/tap-targets.test.tsx` | Modify | The client call's URL/body; no glow; tap floors |
| `pwa/test/coord-banner.test.tsx`, `pwa/test/abandon-sheet.test.tsx`, `pwa/test/runs-screen.test.tsx`, `pwa/test/start-program.test.tsx` | Modify (their `CoordStatus` literals) | Fixtures typecheck against the widened `CoordStatus` |

---

### Task 1: Preflight — waves 1–3 are here, and every anchor this plan names exists

**Model routing:** `haiku`, effort `low` — grep and `ls`, zero judgment. It STOPS on any missing precondition rather than working around it.

**Files:** none modified. Nothing is committed.

**Interfaces:**
- Consumes: the merged base.
- Produces: six measured facts the later tasks read — the next free bypass-fixture number, the shipped `ChildReclaimDeps` member list (and `childReclaimOutcome`'s local `deferred(...)` helper, whose every return reaches `reclaimChild`'s single feed row), whether wave 3 spelled `'reclaim-paused'` as a TypeScript literal, that wave 3's executor does NOT yet produce `paused-at-server` and MARKS the place it goes (contract §7 R8, §8 R8′ put the producer here), the two `auth-gate.test.ts` counts before this wave, and that every TERMINAL refusal found at AUDIT time — and no retryable one — reaches the lifecycle mirror, through a `verb ws-audit` journal line whose token list equals `CHILD_RECLAIM_TOKEN_KIND`'s terminal arm (contract §7 R5 as §8 R5′ amends it).

- [ ] **Step 1: The branch carries waves 1–3**

```bash
git fetch origin main
git log --oneline -1 origin/main
grep -n 'export type ChildMark' shared/api.ts
grep -n 'child: ChildMark' server/src/registry.ts shared/api.ts
grep -n "export async function reclaimChild\|export const CHILD_RECLAIM_TOKEN_KIND\|export interface ChildReclaimRequest\|export type ChildReclaimOutcome\|ChildReclaimDeps\b" server/src/coord/childReclaim.ts
sed -n '/export interface ChildReclaimRequest/,/}/p' server/src/coord/childReclaim.ts | grep -n 'readonly deferredSinceMs: number | null'
grep -n "'review-report-live'" server/src/coord/childReclaim.ts
grep -n "'no-worktree-record': 'terminal'" server/src/coord/childReclaim.ts
grep -n 'reviews: number | null;' shared/api.ts
grep -n "export const RECLAIM_CAP\|wsReclaimAudit:\|wsReclaim:" server/src/ccdargv.ts
grep -n '^cmd_ws_reclaim()\|echo reclaim-v1\|echo child-argv-v1' ccd/ccd
grep -n "'reclaim'" shared/api.ts | head -3
```

Expected: every `grep` prints at least one line. `ChildMark` is declared in `shared/api.ts` and carried as `child: ChildMark` on `SessionRecord` and `FleetSession`; `childReclaim.ts` exports `reclaimChild`, `CHILD_RECLAIM_TOKEN_KIND`, `ChildReclaimRequest`, `ChildReclaimOutcome` and declares `ChildReclaimDeps`; `ChildReclaimRequest` carries `readonly deferredSinceMs: number | null` (contract §7 R4 — wave 3 adds the field and renders it in the executor's feed row; this wave's sweep passes it); `childReclaimDecision` answers `'review-report-live'` (contract §7 R16 — the close half of the rule whose sweep half Task 7 adds); `CHILD_RECLAIM_TOKEN_KIND` classes `no-worktree-record` as `terminal` (contract §8 R19 — the fourteenth token, which fact 6 reads); `RunSummary` carries `reviews: number | null` (the review run's reviewed run, which Task 8 reads); `ccdargv.ts` exports `RECLAIM_CAP` and both wave-3 builders; `ccd/ccd` defines `cmd_ws_reclaim` and echoes both `reclaim-v1` and `child-argv-v1`; `'reclaim'` is a `LifecycleAct` member.

**If ANY of these is missing, STOP.** Report which, and do not start Task 2: every later task imports or edits one of them.

- [ ] **Step 2: Wave 3 reads the pause file on the box**

```bash
grep -n 'reclaim-paused' ccd/ccd | grep -v '^[0-9]*:[[:space:]]*#'
grep -n 'reclaim-paused' ccd/ccd | grep -v '^[0-9]*:[[:space:]]*#' \
  | grep -v -E '(\$REG|\$\{REG\}|"\$REG"|"\$\{REG\}")/reclaim-paused'
```

This is the SAME filter Task 2's path-identity scan applies (drop whole-line comments, keep every other line naming the file), so what passes here passes there. Expected: the first command prints at least one line inside wave 3's `ws-reclaim` code; the second prints NOTHING — every non-comment line naming the file spells it as a `$REG` path (`$REG/`, `${REG}/`, `"$REG"/` or `"${REG}"/`, the four spellings the scan accepts). Record the line(s).

**STOP and report** in either failure: (a) the first command prints nothing — this wave's writer would be a switch wired to nothing; (b) the second prints anything — a wave-3 line names the file some other way (a bare refusal detail such as `"reclaim-paused is raised"`, or a code line whose trailing `# …` comment names it), which would turn Task 2's scan red for a reason outside this wave. Name the line; the coordinator rules whether wave 3's wording moves or the scan narrows.

- [ ] **Step 3: The six facts later tasks read**

```bash
ls agent/test/types/bypasses/ | sort -V | tail -3
sed -n '/export interface ChildReclaimDeps/,/^}/p' server/src/coord/childReclaim.ts
grep -n 'reclaimChild(' server/src/coord/routes.ts server/src/coord/close.ts
sed -n '/export async function reclaimChild/,/^}/p' server/src/coord/childReclaim.ts
grep -n 'const deferred = (why: ChildReclaimDeferWhy' server/src/coord/childReclaim.ts
sed -n '/^async function childReclaimOutcome/,/^}/p' server/src/coord/childReclaim.ts \
  | grep -n 'openRunsForSession\|WAVE 4 ADDS THE SERVER-SIDE PAUSE READ HERE\|isVisible\|capSupported'
grep -rn "'reclaim-paused'" shared server/src pwa/src agent/src
grep -rn "'paused-at-server'" server/src
grep -n "'reclaim-paused'" server/test/mail-routes.test.ts
grep -n 'toBe([0-9]' server/test/auth-gate.test.ts | head -4
grep -n "CAP_GATED_VERBS: ReadonlySet<string> = new Set" server/test/verb-gate.test.ts
awk '/^cmd_ws_audit\(\) \{/,/^}/' ccd/ccd | grep -n '_lc_'
awk '/^cmd_ws_audit\(\) \{/,/^}/' ccd/ccd | grep -n -B2 '_lc_emit reclaim refused "\$id" "" verb ws-audit refusal'
sed -n '/export const CHILD_RECLAIM_TOKEN_KIND/,/^};/p' server/src/coord/childReclaim.ts | grep -cE ": '(gone|terminal|retry)',"
sed -n '/export const CHILD_RECLAIM_TOKEN_KIND/,/^};/p' server/src/coord/childReclaim.ts | grep -E ": 'terminal',"
grep -n 'the audit journals exactly the TERMINAL words' server/test/child-reclaim.test.ts
```

Record, for the tasks that read them:

1. **The next free fixture number.** Expected `g13-ws-reclaim-without-expect.ts` as the highest, so this wave's fixture is **`g14-reclaim-pause-without-state.ts`**. If wave 3 shipped more than one fixture (a `g14` of its own), this wave takes the next free number instead and says so in the wave-done mail as a departure (the precedent is the terminal-drawer wave's `g11` → `g12`).
2. **`ChildReclaimDeps`'s members**, exactly as shipped, and the object literal the close route passes to `reclaimChild`. Task 8 composes the SAME members from the watcher's `this.deps`. The list MUST include `io` and `cfg` (the contract's `ChildSpentDeps` carries both, and `reclaimChild` re-reads the registry marker through them); if either is absent, **STOP and report** — Task 5's pause read has nothing to list the registry with. Also record, from `reclaimChild`'s body and the `grep` for `const deferred`, how a `deferred` outcome gets its feed row: wave 3's shape is `reclaimChild` = `childReclaimOutcome(deps, req)` then ONE `recordChildReclaimFeed` for every outcome but `gone`, and `childReclaimOutcome` builds each deferral through its local `deferred(why, detail)` helper. Task 5 returns its deferral through that same `deferred(...)`, INSIDE `childReclaimOutcome` (contract §8 R8′). If the base has no `childReclaimOutcome` with a local `deferred` helper, **STOP and report** — the ruled placement has no home.
3. **Whether wave 3 spelled `'reclaim-paused'` in TypeScript.** Expected: no hits. If there is one, Task 4 replaces it with an import of `RECLAIM_PAUSE_MARKER` (the single-definition pin Task 4 adds would otherwise red on it) and Task 4 Step 9 commits that file.
4. **That `'paused-at-server'` is declared, NOT YET PRODUCED, and its place is MARKED** — no executor read of the registry listing for the pause file. Expected: declared in `ChildReclaimDeferWhy`, produced nowhere, and the `sed … | grep` over `childReclaimOutcome` printing four lines IN THIS ORDER: `openRunsForSession` (the sibling re-read), `WAVE 4 ADDS THE SERVER-SIDE PAUSE READ HERE` (wave 3's marked comment), `isVisible` (presence), `capSupported` (the capability). That is the ruled split and the ruled place (contract §7 R8: "Wave 4 adds the `paused-at-server` producer inside `reclaimChild` using `RECLAIM_PAUSE_MARKER`"; §8 R8′: "At wave 3's marked comment inside `childReclaimOutcome`, after the sibling read and BEFORE presence, returning through that function's own `deferred(...)` helper"), so Task 5 replaces the comment with the read. **If a producer already exists, STOP and report**: two server-side pause reads would be two definitions of one skip, and the base disagrees with the ruling. **If the marked comment is missing, or the four lines print in any other order, STOP and report** — Task 5 has no ruled place to put the read.
5. **Whether `mail-routes.test.ts`'s `NOT_CODES` already holds `'reclaim-paused'`**, and the auth-gate counts (expected `51`, `30`, `81` — waves 1–3 register no route) and `CAP_GATED_VERBS`'s current members.
6. **That every TERMINAL refusal found at AUDIT time reaches the lifecycle mirror, and no retryable one does** (contract §7 R5, as §8 R5′ amends it: "`ws-audit --reclaim` journals the refusals whose kind is `terminal` and no others … The terminal list the audit journals EQUALS `CHILD_RECLAIM_TOKEN_KIND`'s terminal arm, pinned by a test. Wave 4's pre-flight expects exactly that shape."). The contract's executor runs `ws-audit --reclaim` first, and the audit prints a `token` ONLY when the reclaim ladder passes, so a child refused on a terminal rung never reaches `ws-reclaim` — the audit's own journal line is the only way that refusal reaches the mirror. Expected, all of it: the second `awk` prints exactly ONE `_lc_emit reclaim refused "$id" "" verb ws-audit refusal "$REAP_VERDICT" …` line, and its two lines of context show it as the body of a terminal-only arm — `case "$REAP_VERDICT" in` and then ONE pattern line listing exactly the six terminal tokens, `not-a-workspace`, `not-a-child`, `branch-elsewhere`, `tree-unreadable`, `containment-unproven` and `no-worktree-record` (contract §8 R19), in any order; the kind map has `14` entries (the first count) of which exactly those six are `terminal` (the second `grep` prints six lines, the same six names); and wave 3's pin holding the two equal exists (`the audit journals exactly the TERMINAL words`, in `child-reclaim.test.ts`). (At `62d9c485`, before wave 3, the first `awk` printed nothing — the reason this fact is measured rather than assumed.) Record the pattern line. A RETRYABLE refusal found at audit time is journaled nowhere, by the ruling: it recurs every pass and would flood the journal, the attention list needs terminal rows only, and wave 5 shows it through the sweep's own defer state — so nothing in this wave needs it in the mirror. This is what lets Tasks 7 and 8 derive the attention list, and the lane's terminal exclusion, from the mirror ALONE — no in-memory memo feeds `CoordStatus` or the frame (R5), so a restart loses nothing. **STOP and report** if: the `_lc_emit` line is missing (the base predates R5, and the mirror-only attention list would miss what the audit refused terminally); it journals outside a terminal-only arm, or its arm names a retryable or gone token (the base disagrees with R5′); its token list differs from the kind map's terminal arm — `no-worktree-record` missing from either side above all (R19); or wave 3's pin is absent. The remedy is wave 3's line and its pin, never a second source in this wave.

---

### Task 2: `ccd reclaim-pause --state on|off`, and the `reclaim-pause-v1` token

**Model routing:** `sonnet`, effort `high` — a line-for-line copy of a verb that already exists, plus the census tax.

**Files:**
- Modify: `ccd/ccd` — `cmd_reclaim_pause` inserted directly AFTER `cmd_ls`'s closing brace and before `cmd_attach() {` (at planning `ccd/ccd:23049`, below the frozen corpus's highest anchor into this file, `:19131`; `cmd_coord_pause`, its model, sits at `8679-8711`, ABOVE that anchor, which is why the copy does not sit beside it — contract §7 R9 and §8 R9′, wave 1's rule: every line added above the anchor permanently moves the corpus's citations — and NOT directly above `cmd_ls() {`, because `ccd-refusal-scan.test.ts` slices `cmd_forget() {` … `cmd_ls() {` as `cmd_forget`'s body); `cmd_caps`'s verb heredoc (at planning `8190-8227`) and its token tail (the `}` directly above `cmd_version() {`) — ONE bare line each, no comment, so this task adds exactly two lines above `:19131`; the dispatcher `case` (at planning `23120`) and its `*)` usage line (`23128`)
- Modify: `server/test/ccd-archive.test.ts` — `KNOWN_CAPABILITY_TOKENS` (at planning line 154)
- Create: `server/test/ccd-child-reclaim-pause.test.ts`
- Run, never edited: `server/test/ccd-refusal-scan.test.ts` — the placement guard (Step 6)
- Modify, only if Step 7 says so: `server/test/session-hook.test.ts`, `README.md`

**Interfaces:**
- Consumes: `die()` (prints `ccd: $*` on stderr, exits 1); `$REG` (`$HOME/.cc-sessions`); wave 3's reader of `$REG/reclaim-paused` inside `ws-reclaim`.
- Produces: the bash function `cmd_reclaim_pause()` (argv exactly `--state on|off`; stdout `paused` or `running`, exit 0; every refusal is `die`, exit 1; the ONLY effect is creating or removing `$REG/reclaim-paused`); the dispatcher verb `reclaim-pause`; the `cmd_caps` lines `reclaim-pause` (verb) and `reclaim-pause-v1` (capability token). Task 3 consumes the token and the verb; Task 6's route reaches the verb through `CCD_ARGV.reclaimPause`.

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-child-reclaim-pause.test.ts`:

```ts
// `ccd reclaim-pause --state on|off` — the writer of `$REG/reclaim-paused`, the
// fleet-wide kill-switch on the AUTOMATIC reclamation of child workspaces
// (child-reclamation spec §5.8). A copy of `ccd coord-pause` in every respect,
// and this file is `ccd-coord-pause.test.ts`'s shape for the same reason that
// file is `ccd-hold.test.ts`'s: the server may write only `~/.cc-clips` on the
// fleet host and `FleetIO` has no unlink, so a registry marker is raised and
// cleared through a ccd verb or not at all.
//
// The one case with no coord-pause twin is the LAST one: a switch is only a
// switch if the verb that deletes reads it. Wave 3's `ws-reclaim` reads this
// file at its rung 3 and again on resume; the scan below holds the writer's
// path and the reader's path to one spelling, so neither can move alone.
//
// Everything runs against the isolated fixture HOME (`makeCcdHarness`), never
// the live one: `$REG` is `$HOME/.cc-sessions`, so a test that wrote the real
// marker would stop the real fleet's reclamation.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-child-reclaim-pause-'); });
afterEach(() => { h.cleanup(); });

/** stdout BESIDE stderr and the code: on this verb the defect that matters is
 *  a refusal that STILL printed `paused`. */
const shFail = (snippet: string): { code: number; stderr: string; stdout: string } => {
  try { return { code: 0, stderr: '', stdout: h.sh(snippet) }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? ''), stdout: String(err.stdout ?? '') };
  }
};

/** The dispatcher, not the function — the agent runs `ccd reclaim-pause --state on`,
 *  so the `case` arm is production surface. */
const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  const opts = {
    encoding: 'utf8' as const, cwd: h.home,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
  };
  try { return { code: 0, stdout: execFileSync('bash', [CCD, ...args], opts).trim(), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? '').trim(), stderr: String(err.stderr ?? '') };
  }
};

const REG = (): string => path.join(h.home, '.cc-sessions');
const marker = (): string => path.join(REG(), 'reclaim-paused');

describe('ccd reclaim-pause', () => {
  it('creates $REG/reclaim-paused with --state on, and says paused', () => {
    expect(h.sh('cmd_reclaim_pause --state on')).toBe('paused');
    expect(fs.existsSync(marker())).toBe(true);
  });

  it('is idempotent: twice on leaves one marker and one answer', () => {
    expect(h.sh('cmd_reclaim_pause --state on')).toBe('paused');
    expect(h.sh('cmd_reclaim_pause --state on')).toBe('paused');
    expect(fs.statSync(marker()).isFile()).toBe(true);
  });

  it('removes it with --state off, and says running', () => {
    h.sh('cmd_reclaim_pause --state on');
    expect(h.sh('cmd_reclaim_pause --state off')).toBe('running');
    expect(fs.existsSync(marker())).toBe(false);
  });

  it('is idempotent off: off with no marker still says running, exit 0', () => {
    expect(fs.existsSync(marker())).toBe(false);
    expect(h.sh('cmd_reclaim_pause --state off')).toBe('running');
    expect(fs.existsSync(marker())).toBe(false);
  });

  it('refuses a malformed argv by the usage line, and a bad state by its OWN sentence', () => {
    for (const argv of ['', '--state', 'on', '--state on extra', '--flag on']) {
      const r = shFail(`cmd_reclaim_pause ${argv}`);
      expect(r.code, `argv: ${argv}`).not.toBe(0);
      expect(r.stderr, `argv: ${argv}`).toContain('usage: ccd reclaim-pause --state on|off');
    }
    // The shape was right and the word was wrong: a different refusal, so
    // "usage" is never answered to a caller whose usage was fine.
    const bad = shFail('cmd_reclaim_pause --state maybe');
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toContain('bad state: maybe (want on|off)');
    expect(bad.stderr).not.toContain('usage: ccd reclaim-pause');
    expect(bad.stdout).not.toContain('running');
    expect(fs.existsSync(marker())).toBe(false);
  });

  it('refuses when $REG is not a directory — the marker has nowhere to live', () => {
    // A FILE at the path is the state the guard answers: ccd's source-time
    // `mkdir -p "$REG"` is unchecked, so it fails silently and leaves `-d`
    // false. Discriminates for any uid, root included.
    fs.rmSync(REG(), { recursive: true, force: true });
    fs.writeFileSync(REG(), 'not a directory\n');
    const r = shFail('cmd_reclaim_pause --state on');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('no registry');
    expect(r.stdout).not.toContain('paused');
  });

  // Root writes through any mode bit, and `touch` on a DIRECTORY at the path
  // succeeds, so this arm has no root-proof stand-in — skipped as root rather
  // than passing for the wrong reason (`ccd-coord-pause.test.ts`'s idiom).
  it.skipIf(process.getuid?.() === 0)(
    'refuses LOUDLY when the marker cannot be written — never a false "paused"', () => {
      // `set -uo pipefail` with NO `-e`: an unguarded failed `touch` falls
      // through to the echo, and the phone is told reclamation STOPPED while
      // the sweep keeps deleting. The one polarity that must never be false.
      fs.chmodSync(REG(), 0o500);
      try {
        const r = shFail('cmd_reclaim_pause --state on');
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('reclamation is NOT paused');
        expect(r.stdout).not.toContain('paused');
        expect(fs.existsSync(marker())).toBe(false);
      } finally {
        fs.chmodSync(REG(), 0o700);
      }
    });

  it('refuses LOUDLY when the marker cannot be removed — reclamation is STILL paused', () => {
    // `rm -f` suppresses ENOENT only. A directory at the path fails for any uid.
    fs.mkdirSync(marker());
    const r = shFail('cmd_reclaim_pause --state off');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('reclamation is STILL paused');
    expect(r.stdout).not.toContain('running');
    expect(fs.existsSync(marker())).toBe(true);
  });

  it('advertises BOTH the verb and its capability token in ccd caps', () => {
    // The VERB is what the dispatcher-parity check reads; the TOKEN is what the
    // server's `capSupported(state, RECLAIM_PAUSE_CAP)` reads — null REFUSES, so
    // a box without this ccd answers the phone 501 rather than a usage error.
    const advertised = h.sh('cmd_caps').split('\n');
    expect(advertised).toContain('reclaim-pause');
    expect(advertised).toContain('reclaim-pause-v1');
  });

  it('is reachable through the dispatcher, with argv shifted, and is named in the usage line', () => {
    const on = runCcd('reclaim-pause', '--state', 'on');
    expect(on.code).toBe(0);
    expect(on.stdout).toBe('paused');
    expect(fs.existsSync(marker())).toBe(true);

    const off = runCcd('reclaim-pause', '--state', 'off');
    expect(off.code).toBe(0);
    expect(off.stdout).toBe('running');
    expect(fs.existsSync(marker())).toBe(false);

    const usage = runCcd('no-such-verb');
    expect(usage.code).not.toBe(0);
    expect(usage.stderr).toContain('|reclaim-pause|');
  });

  it("touches nothing else in $REG — and never the coordinator's own marker", () => {
    // Two switches, two files. A reclaim pause that also paused dispatch — or a
    // coordinator pause that silently stopped reclamation — would be one
    // operator act with two effects nobody asked for.
    h.sh('cmd_reclaim_pause --state on');
    expect(fs.readdirSync(REG()).sort()).toEqual(['reclaim-paused']);
    h.sh('cmd_coord_pause --state on');
    h.sh('cmd_reclaim_pause --state off');
    expect(fs.readdirSync(REG()).sort()).toEqual(['coordinator-paused']);
  });

  it('writes the SAME path ws-reclaim reads — one marker, one spelling, two verbs', () => {
    // Spec §5.8: "`ws-reclaim` itself reads it — in the eval ladder and again on
    // resume — because a gate evaluated only by the server fails open into
    // deletion." That reader is wave 3's; this verb is its only writer. A path
    // typo on either side leaves a toggle that works, a frame that reports it,
    // and a deleting verb that never sees it — every suite green. So: every
    // NON-COMMENT line of ccd that names the file spells it as a `$REG` path
    // (`$REG/`, `${REG}/`, `"$REG"/` or `"${REG}"/` — one path, four bash
    // spellings), exactly one of them is inside the writer, and at least one is
    // outside it. Task 1 Step 2 ran this exact filter over wave 3's lines first.
    const src = fs.readFileSync(CCD, 'utf8').split('\n');
    const start = src.findIndex((l) => l.startsWith('cmd_reclaim_pause() {'));
    expect(start, 'cmd_reclaim_pause is not defined at column 0').toBeGreaterThan(-1);
    const end = src.findIndex((l, i) => i > start && l === '}');
    expect(end, 'cmd_reclaim_pause has no closing brace at column 0').toBeGreaterThan(start);
    const code = src
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => !/^\s*#/.test(l) && l.includes('reclaim-paused'));
    for (const { l, i } of code) {
      expect(l, `ccd/ccd:${i + 1} names the file without $REG/`)
        .toMatch(/(\$REG|\$\{REG\}|"\$REG"|"\$\{REG\}")\/reclaim-paused\b/);
    }
    const inside = code.filter(({ i }) => i > start && i < end);
    const outside = code.filter(({ i }) => i < start || i > end);
    expect(inside.length, 'the writer names the path exactly once').toBe(1);
    expect(outside.length, "ws-reclaim's reader (wave 3) — a switch no deleting verb reads is wired to nothing")
      .toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pause.test.ts`

Expected: FAIL, 12 of 12 (11 of 11 plus one skipped when run as root). The ten verb cases die with `cmd_reclaim_pause: command not found` (exit 127) — `h.sh` throws, and the `shFail` cases see stderr without the expected sentence; the caps case fails `expected [ … ] to contain 'reclaim-pause'`; the dispatcher case fails on its first `expect(on.code).toBe(0)` (the `*)` arm answers the usage line at exit 1); the path case fails `cmd_reclaim_pause is not defined at column 0: expected -1 to be greater than -1`.

- [ ] **Step 3: Write the verb**

In `ccd/ccd`, insert directly AFTER `cmd_ls`'s closing brace — i.e. after the `}` that ends `cmd_ls` and its blank line, directly above `cmd_attach() {`, followed by one blank line of its own. NOT beside `cmd_coord_pause`: that function sits above the frozen compaction-card corpus's highest anchor into `ccd/ccd` (`:19131`, contract §8 R9′'s figure and grep — Global Constraints), and every line added above it is a permanent move of anchors neither corpus document may re-point (contract §7 R9). And NOT directly above `cmd_ls() {`, between `cmd_forget` and `cmd_ls`: `server/test/ccd-refusal-scan.test.ts` slices `cmd_forget() {` … `cmd_ls() {` as `cmd_forget`'s body, and this function's three `die`s — none of them an `_lc_refuse`/`_lc_fail`, by `cmd_coord_pause`'s design — would read as three unrecorded refusals in a destructive verb. Placement is free for a bash function (the dispatcher resolves it at call time), so the whole function — its argument included — goes after `cmd_ls`. Measure the place first:

```bash
grep -c '^cmd_ls() {' ccd/ccd
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const t = readFileSync('server/test/ccd-refusal-scan.test.ts', 'utf8');
const src = readFileSync('ccd/ccd', 'utf8').split('\n');
const at = (name) => src.findIndex((l) => l.startsWith(name + '() {')) + 1;
const lsEnd = src.findIndex((l, i) => i >= at('cmd_ls') && l === '}') + 1;
for (const m of t.matchAll(/\['(\w+)', '(\w+)', \d+\]/g)) {
  const [a, b] = [at(m[1]), at(m[2])];
  console.log(m[1], a, '..', m[2], b, a <= lsEnd && lsEnd < b ? 'CONTAINS THE INSERTION POINT' : 'clear');
}
console.log('cmd_ls closes at', lsEnd, '— then:', JSON.stringify(src[lsEnd]), JSON.stringify(src[lsEnd + 1]));
"
```

Expected: `1`; one line per `VERBS` entry of `ccd-refusal-scan.test.ts`, every one `clear` (measured at planning: `cmd_ws_rm 7387 .. cmd_ws_rename 7768`, `cmd_forget 22847 .. cmd_ls 22997`, `cmd_ws_restore 9930 .. cmd_ws_attic 10256`, `cmd_ws_reap 13483 .. _ws_reap_locked 13651`, all `clear`; wave 3 adds a `cmd_ws_reclaim` entry, which must print `clear` too); and `cmd_ls closes at <n>` with `<n>` greater than `19131` (`23049` at planning), then `""` and `"cmd_attach() {   # create-on-demand, then exec tmux attach"`. **If any entry prints `CONTAINS THE INSERTION POINT`, STOP and report** — the base moved a sliced verb around `cmd_ls`, and the placement needs a ruling, not a guess.

```bash
cmd_reclaim_pause() {   # ccd reclaim-pause --state on|off — raise or lower the
  # fleet-wide RECLAIM kill-switch (child-reclamation spec §5.8). While
  # `$REG/reclaim-paused` exists, nothing reclaims a child workspace: the
  # server's sweep skips, the server's close path skips, and — the reader that
  # matters — `ws-reclaim` itself refuses `paused` at its rung 3 and again on
  # resume, because a gate only the server evaluates fails open into deletion
  # the moment the pause lands mid-flight, the server's snapshot is one tick
  # stale, or a crashed reclaim resumes. Pausing stops reclamation and nothing
  # else; lowering it lets the sweep drain what waited.
  #
  # A COPY OF `cmd_coord_pause` IN EVERY RESPECT, and granted on its argument: a
  # registry-file write/unlink, non-destructive and idempotent, that widens
  # nothing that deletes — it can only STOP a deletion. CHECKED on both arms,
  # for `cmd_ws_hold`'s reason: ccd runs `set -uo pipefail` with NO `-e`, so an
  # unchecked `touch` that failed would fall straight through to the echo and
  # tell the phone reclamation had stopped while the sweep kept deleting — the
  # one polarity on this verb that may never be false. Journals nothing, for
  # `cmd_coord_pause`'s reason.
  #
  # It lives HERE, not beside `cmd_coord_pause`, because that neighbourhood is
  # above the frozen citation corpus's anchors into this file (line 19131);
  # and after `cmd_ls`, not before it, because `ccd-refusal-scan.test.ts` reads
  # everything from `cmd_forget` to `cmd_ls` as `cmd_forget`'s body;
  # `cmd_caps` carries its two lines — the verb and the token — bare, for the
  # same reason, so the token's argument is this paragraph: `reclaim-pause-v1`
  # says this ccd has this verb, and the server gates its route on
  # `capSupported(state,'reclaim-pause-v1')` — no evidence REFUSES, the opposite
  # of `verbSupported`'s default, which is right for verbs that have always
  # existed and wrong for one that never did: a phone toggle sent to a box
  # without this verb would come back as a usage error, not a 501.
  #
  # The echoed word is for a human reading a journal. NOTHING parses it: the
  # server learns the state by listing $REG (`emitCoord`'s `reclaim` field).
  [[ $# -eq 2 && $1 == --state ]] || die "usage: ccd reclaim-pause --state on|off"
  local state=$2
  [[ $state == on || $state == off ]] || die "bad state: $state (want on|off)"
  [[ -d "$REG" ]] || die "no registry at $REG"
  local marker="$REG/reclaim-paused"
  if [[ $state == on ]]; then
    touch -- "$marker" || die "could not raise the reclaim pause marker — reclamation is NOT paused"
    echo "paused"
  else
    if [[ -e $marker ]]; then
      rm -f -- "$marker" || die "could not clear the reclaim pause marker — reclamation is STILL paused"
    fi
    echo "running"
  fi
}
```

- [ ] **Step 4: Advertise it, and wire the dispatcher**

(a) In `cmd_caps`'s verb heredoc, insert `reclaim-pause` on its own line between `project-pool` and `route` (the heredoc is alphabetical there). The `old_string` for the Edit is the two unindented lines `project-pool` / `route`; confirm first that the pair occurs once: `grep -c -x 'project-pool' ccd/ccd` must print `1` (the heredoc line; the dispatcher arm is indented).

(b) At the tail of `cmd_caps` — immediately above the `}` that is the second line above `cmd_version() {`, i.e. after the last `echo <token>` line (at planning `echo win-size-v1`; after waves 1 and 3, whichever of `echo child-argv-v1` / `echo reclaim-v1` they placed last) — add ONE bare line, and no comment (contract §7 R9: `cmd_caps` is above the frozen anchors, so prose there must be length-neutral; the token's argument lives in `cmd_reclaim_pause`'s header, below them):

```bash
  echo reclaim-pause-v1
```

After (a) and (b), measure the length decision rather than assert it — exactly two lines were added above the corpus's highest anchor:

```bash
git diff -U0 -- ccd/ccd | grep -E '^@@' | awk '{ split($3, a, /[+,]/); if (a[2] + 0 < 19131) print }'
```

Expected: exactly the two hunks, each `+<n>` with a count of 1 (the heredoc line and the `echo`). A third hunk above `:19131`, or a larger count, is prose that must move below the anchor before Step 6.

(c) In the dispatcher `case`, directly after the `  coord-pause) shift; cmd_coord_pause "$@" ;;` arm, with EXACTLY two leading spaces (`ccd-archive.test.ts` matches `/^ {2}([a-z][a-z|-]*)\)/gm`):

```bash
  reclaim-pause) shift; cmd_reclaim_pause "$@" ;;
```

(d) The usage string: `grep -c '|coord-pause|' ccd/ccd` must print `1`, then:

```bash
sed -i 's/|coord-pause|/|coord-pause|reclaim-pause|/' ccd/ccd
grep -c '|coord-pause|reclaim-pause|' ccd/ccd
```

Expected: `1`.

- [ ] **Step 5: Teach the caps parity test the token — by APPENDING**

In `server/test/ccd-archive.test.ts`, `KNOWN_CAPABILITY_TOKENS` (at planning line 154) carries ten tokens plus whatever waves 1 and 3 appended (`child-argv-v1`, `reclaim-v1`). **Insert `'reclaim-pause-v1'` into the existing array; never rewrite the array from this plan** — the terminal-drawer wave rewrote it from a stale plan once and silently dropped `route-v1`, which re-classified that token as a VERB and red the parity check (D-2777). After the edit:

```bash
grep -n "KNOWN_CAPABILITY_TOKENS = \[" server/test/ccd-archive.test.ts
```

Expected: one line containing `'reclaim-pause-v1'` AND every token that was there before this step.

- [ ] **Step 6: Re-stamp ccd, run the tests to verify they pass**

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pause.test.ts test/ccd-coord-pause.test.ts \
  test/ccd-archive.test.ts test/caps-token-shape.test.ts test/ownership.test.ts test/ccd-reg-get-census.test.ts \
  test/ccd-refusal-scan.test.ts
```

Expected: PASS — `ccd-child-reclaim-pause` 12/12 (11 + 1 skipped as root); `ccd-refusal-scan` green with NO edit, its case count unchanged — `cmd_forget`'s slice (`cmd_forget() {` … `cmd_ls() {`) still holds only `cmd_forget`, so its coverage floor and its bare-`die` scan see nothing new, and no other `VERBS` slice reaches past `cmd_ls` (Step 3's measurement); `ccd-coord-pause` unchanged and green; `ccd-archive`'s parity sees `reclaim-pause` on both sides and `reclaim-pause-v1` in the known set; `caps-token-shape` picks up `echo reclaim-pause-v1` through `parseCcdCaps`; `ownership` proves the re-stamp landed; `ccd-reg-get-census` green with NO edit — this task adds no `_reg_get` call (contract §7 R10), and that census is what would say otherwise.

- [ ] **Step 7: Pay the citation-corpus tax (S6-R11)**

This step runs AFTER the re-stamp and AFTER every `ccd/ccd` edit of this task. `ccd/ccd` gained two lines inside `cmd_caps` (above the frozen anchors), and the function after `cmd_ls`, the dispatcher arm and the usage word (below them); the two above shift every cited anchor below them.

(a) Run the five census cases:

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS ITS OWN CENSUS ENTRY|LISTS ARE LOCATION INDEXES|ROW PASS: the exact set|THE RANGE BOUND'
```

If all pass, record "no anchor moved" for the wave-done mail and go to Step 8.

(b) If the README case is red: **repair README FIRST**, by CONTENT, never by arithmetic. For each `ccd/ccd:<n>` the failure names, find the bytes the README sentence quotes in the current `ccd/ccd` (`grep -n -F '<quoted bytes>' ccd/ccd`), and edit README's anchor to that line. Re-run (a). README's census must be EMPTY.

(c) Then measure the COMPOSITION of what remains red — which anchors this task moved — rather than inferring it. `git rev-parse HEAD origin/main` first: if `origin/main` is ahead of this branch's base, measure against `HEAD` only.

```bash
mkdir -p "$SCRATCHPAD/w4-cite"
cp ccd/ccd "$SCRATCHPAD/w4-cite/ccd.new"
cp server/test/session-hook.test.ts "$SCRATCHPAD/w4-cite/session-hook.test.ts.orig"
git show HEAD:ccd/ccd > ccd/ccd
```

Insert, immediately above EACH failing assertion in `server/test/session-hook.test.ts`, one dump line of the form `fs.writeFileSync(path.join(process.env.SCRATCHPAD!, 'w4-cite', 'before-<case>.json'), JSON.stringify(<the expression that assertion passes to expect(…)>, null, 1));` (`<case>` one of `debt`, `total`, `files`, `rows`, `sites`; `fs` and `path` are already imported there). **Use `fs.writeFileSync`, never `console.log`** — vitest's reporter swallows stdout on a passing run. Run (a) with `SCRATCHPAD` exported. Then:

```bash
cp "$SCRATCHPAD/w4-cite/ccd.new" ccd/ccd
```

change each dump's file name `before-` → `after-`, run (a) again, and diff each `before-*.json` against its `after-*.json`. Restore the test file from `session-hook.test.ts.orig`.

(d) Replace each failing census value with its `after-*.json` value, pasted IN THE INSTRUMENT'S ORDER (`toEqual` on an array is order-sensitive), and beside it add ONE comment naming the composition — which refs entered, which left, and the one cause: "child-reclamation wave 4 Task 2: two lines above the frozen anchors — `reclaim-pause` in `cmd_caps`'s verb heredoc and `echo reclaim-pause-v1` at its tail; `cmd_reclaim_pause` itself sits below `:19131`, the frozen corpus's highest `ccd/ccd` anchor, and moves nothing; no rule changed. No D-number (S6-R11)." (A committed comment: it names the reason, never the contract section — contract §8 R23.) **Never adjust a number to make it green, and never widen the rule.** Re-run (a): PASS.

- [ ] **Step 8: Mutation check, then commit**

Five mutations, each restored and re-stamped before the next:

| # | Edit | Command | Expected red |
|---|---|---|---|
| 1 | Delete the line `[[ $state == on \|\| $state == off ]] \|\| die "bad state: $state (want on\|off)"` | `cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pause.test.ts` | *refuses a malformed argv by the usage line, and a bad state by its OWN sentence* — `--state maybe` falls to the `else` arm, prints `running`, exits 0: `expected 0 not to be 0` |
| 2 | Delete the `\|\| die "could not clear the reclaim pause marker — reclamation is STILL paused"` tail | same | *refuses LOUDLY when the marker cannot be removed* — `expected 0 not to be 0` (runs as root too) |
| 3 | Delete the `reclaim-pause)` dispatcher arm | same, plus `test/ccd-archive.test.ts` | *is reachable through the dispatcher* — `expected 1 to be 0`; `ccd-archive`'s parity — `reclaim-pause` advertised but not dispatched |
| 4 | Change `local marker="$REG/reclaim-paused"` to `local marker="$REG/reclaim-pause"` | same | the four marker-file cases (`existsSync` false) AND *writes the SAME path ws-reclaim reads* — `the writer names the path exactly once: expected 0 to be 1` |
| 5 | Move the whole of `cmd_reclaim_pause` (and its blank line) to directly above `cmd_ls() {` — the placement this plan once named | `cd server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts` | *leaves no bare `die "` behind* — `a destructive verb refuses or fails without a record …: expected [ 'cmd_forget: [[ $# -eq 2 && $1 == --state ]] \|\| die "usage: ccd reclaim-pause --state on\|off"', … ] to deeply equal []` — the placement is the guard; `ccd-child-reclaim-pause` stays green, its control |

Re-stamp after the last restore, re-run Step 6's command (PASS), then:

```bash
git add ccd/ccd server/test/ccd-child-reclaim-pause.test.ts server/test/ccd-archive.test.ts
git add server/test/session-hook.test.ts README.md   # only if Step 7 edited them
git commit -m "$(cat <<'MSG'
feat(ccd): reclaim-pause — the fleet-wide switch on child reclamation

`ccd reclaim-pause --state on|off` raises and lowers `$REG/reclaim-paused`,
a copy of `coord-pause` in every respect: non-destructive, idempotent,
checked on both arms so a failed write never reports a pause that is not
there. Advertised as `reclaim-pause-v1`. A scan holds its path equal to the
one `ws-reclaim` reads at rung 3 and on resume, so the switch cannot come
unwired from the only verb that deletes (spec §5.8).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: The grant, the builder and the token — two tokens wide, enrolled so it cannot narrow

**Model routing:** `sonnet`, effort `high` — the contract's routing (§6: implementation is `sonnet`; `opus` is reserved for wave 3's ccd ladder, pin phase and tail arm). The code is fixed by this plan to the token; the judgment on it belongs to the wave's mandatory `opus`/`xhigh` SECURITY lens, whose subject is exactly this diff — the exec whitelist is the sole gate between the PWA and the fleet box.

**Files:**
- Modify: `agent/src/whitelist.ts` — `REQUIRED_VERB_FLAG` (at planning `252-256`, grown by wave 3's `ws-reclaim`); `EXEC_WHITELIST.ccd`, directly after `['coord-pause', '--state'],` (at planning line 377)
- Create: `agent/test/types/bypasses/g14-reclaim-pause-without-state.ts` (the number Task 1 Step 3 measured)
- Modify: `agent/test/types/ok/legit-whitelist.ts` (the type-assert block, after `WinSizeNeedsSession`)
- Modify: `agent/test/whitelist-structural.test.ts` (`EXPECTED`, after the last `gN` entry)
- Modify: `server/src/ccdargv.ts` — `CCD_ARGV.reclaimPause` directly after `coordPause` (at planning line 396); `RECLAIM_PAUSE_CAP` directly after wave 3's `export const RECLAIM_CAP`
- Modify: `server/test/whitelist-subset.test.ts` — `SAMPLES` (after `coordPause`, at planning line 67); layer 2c `EXPECTED` (after `coordPause`, line 445); a layer-3 case after `win-size is grantable ONLY with --session` (line 258)
- Modify: `server/test/capsupported.test.ts` — one `it` after `spells the win-size token exactly once in server/src`; the `ccdargv.js` import
- Modify: `server/test/ccd-archive.test.ts` — one `toContain` beside `toContain(WIN_SIZE_CAP)`; the `ccdargv.js` import

**Interfaces:**
- Consumes: the verb `reclaim-pause` and the token `reclaim-pause-v1` (Task 2).
- Produces: `EXEC_WHITELIST.ccd` gains `['reclaim-pause', '--state']`; `REQUIRED_VERB_FLAG` gains `'reclaim-pause': '--state'`; `server/src/ccdargv.ts` gains `reclaimPause: (state: 'on' | 'off') => CcdArgv` and `export const RECLAIM_PAUSE_CAP = 'reclaim-pause-v1';`. Task 6 consumes both server exports. **No `reclaimPauseSupported` wrapper**: Task 6 calls `capSupported(deps.fleetState, RECLAIM_PAUSE_CAP)` at its own seam, where the mutation test can red on it.

- [ ] **Step 1: Write the failing tests**

(a) Create `agent/test/types/bypasses/g14-reclaim-pause-without-state.ts`:

```ts
// BYPASS FIXTURE — MUST NOT COMPILE.
//
// CHILD RECLAMATION, wave 4: `['reclaim-pause', '--state']` -> `['reclaim-pause']`,
// i.e. a grant that keeps the verb and drops the flag that is its entire
// argument surface — g9's `coord-pause` finding, one verb over.
//
// `isExecAllowed` is PREFIX-matching (tokens after the prefix are
// unconstrained), so `['reclaim-pause']` admits
// `ccd reclaim-pause --state on` exactly as the two-token grant does, and
// `server/test/whitelist-subset.test.ts`'s layer 2 and layer 3's reachability
// check both stay green on the narrowed grant. What refuses the narrowing HERE
// is the ENROLMENT in `REQUIRED_VERB_FLAG`: a TS2322 on the proof line below,
// and a boot refusal at module load.
//
// A bare `reclaim-pause` is not a narrower grant. It permits every positional
// form the verb might ever grow, reached from `POST /api/coord/reclaim-pause`,
// a route that carries no box token — and the verb it guards is the switch
// that decides whether automation may DELETE workspaces.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['reclaim-pause']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
```

(b) In `agent/test/whitelist-structural.test.ts`, `EXPECTED`, directly after the last existing `gN` entry and before the closing `};`:

```ts
  // CHILD RECLAMATION wave 4, g9's shape a fifth time: a two-token grant is
  // only two tokens wide while its verb is ENROLLED in `REQUIRED_VERB_FLAG`.
  'g14-reclaim-pause-without-state.ts': {
    what: 'the reclaim kill-switch granted without the flag that is its whole argument surface',
    codes: ['TS2322'],
  },
```

(c) In `agent/test/types/ok/legit-whitelist.ts`, directly after the `WinSizeNeedsSession` line (or after wave 3's own enrolment assert, if it added one below it):

```ts
/** The reclaim kill-switch (child-reclamation wave 4). Deleting this ENROLMENT
 *  turns `['reclaim-pause','--state']` into a bare `['reclaim-pause']` with every
 *  subset test still green; asserted here, losing it stops this project
 *  compiling. `g14-reclaim-pause-without-state.ts` is the other side. */
export type ChildReclaimPauseNeedsState = Assert<Equals<(typeof REQUIRED_VERB_FLAG)['reclaim-pause'], '--state'>>;
```

(d) In `server/test/whitelist-subset.test.ts`, `SAMPLES`, directly after `coordPause: ['on'],`:

```ts
  // CHILD RECLAMATION wave 4 — `coordPause`'s shape exactly.
  reclaimPause: ['on'],
```

…layer 2c's `EXPECTED`, directly after `coordPause: ['coord-pause', '--state', 'on'],`:

```ts
    reclaimPause: ['reclaim-pause', '--state', 'on'],
```

…and a layer-3 case directly after the `win-size is grantable ONLY with --session` case:

```ts
  // Enrolled for its ARGUMENT SURFACE, `coord-pause`'s reason, and reached
  // from a door as open: `POST /api/coord/reclaim-pause` carries no box token.
  // What this verb guards is whether automation may DELETE child workspaces,
  // so a bare `['reclaim-pause']` — green in layer 2 and in layer 3's
  // reachability check, because it is a genuine prefix of the argv
  // `CCD_ARGV.reclaimPause` builds — is refused here, cross-PACKAGE and
  // object-reading, for the reasons the ws-reap assertion above states.
  it('reclaim-pause is grantable ONLY with --state', () => {
    const rp = EXEC_WHITELIST.ccd.filter((p) => p[0] === 'reclaim-pause');
    expect(rp.length, 'exactly one reclaim-pause grant').toBe(1);
    expect(rp[0]).toEqual(['reclaim-pause', '--state']);
    expect(isExecAllowed('ccd', ['reclaim-pause', 'on'])).toBe(false);
    expect(isExecAllowed('ccd', ['reclaim-pause'])).toBe(false);
    expect(isExecAllowed('ccd', [...CCD_ARGV.reclaimPause('on')])).toBe(true);
    expect(isExecAllowed('ccd', [...CCD_ARGV.reclaimPause('off')])).toBe(true);
  });
```

(e) In `server/test/capsupported.test.ts`, directly after the `spells the win-size token exactly once in server/src` case:

```ts
  it('spells the reclaim-pause token exactly once in server/src, and reads it with the REFUSING default', () => {
    // The other two spellings: ccd's own `echo reclaim-pause-v1` and
    // `ccd-archive.test.ts`'s KNOWN_CAPABILITY_TOKENS, whose `toContain` holds
    // all three equal. The scan proves it is reading files by finding the one.
    expect(RECLAIM_PAUSE_CAP).toBe('reclaim-pause-v1');
    expect(literalSpellings(RECLAIM_PAUSE_CAP)).toBe(1);
    // THE POLARITY, asserted rather than left in a docstring: no evidence
    // REFUSES, and the VERB's presence is not the TOKEN's presence.
    expect(capSupported(state(null), RECLAIM_PAUSE_CAP)).toBe(false);
    expect(capSupported(undefined, RECLAIM_PAUSE_CAP)).toBe(false);
    expect(capSupported(state(['reclaim-pause']), RECLAIM_PAUSE_CAP)).toBe(false);
    expect(capSupported(state([RECLAIM_PAUSE_CAP]), RECLAIM_PAUSE_CAP)).toBe(true);
    expect(verbSupported(state(null), ['reclaim-pause'])).toBe(true);
  });
```

Extend that file's `ccdargv.js` import to add `RECLAIM_PAUSE_CAP` (keep every existing member).

(f) In `server/test/ccd-archive.test.ts`, directly after `expect(KNOWN_CAPABILITY_TOKENS).toContain(WIN_SIZE_CAP);` (and after wave 3's `RECLAIM_CAP` line if it sits there):

```ts
    // Child-reclamation wave 4's token: holds the STRING Task 2 appended equal
    // to the constant `POST /api/coord/reclaim-pause` reads.
    expect(KNOWN_CAPABILITY_TOKENS).toContain(RECLAIM_PAUSE_CAP);
```

…and add `RECLAIM_PAUSE_CAP` to that file's `ccdargv.js` import.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd agent  && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts
cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts test/capsupported.test.ts test/ccd-archive.test.ts
```

Expected failures:
- agent `whitelist-structural`: `g14-reclaim-pause-without-state.ts` FAILS with `expected [] to equal [ 'TS2322' ]` (the fixture compiles clean — nothing is enrolled yet); `the positive control compiles clean` FAILS (`ChildReclaimPauseNeedsState`: `Property 'reclaim-pause' does not exist on type …`).
- server `whitelist-subset`: `has a sample for every CCD_ARGV entry` FAILS (`reclaimPause` in `SAMPLES`, absent from `CCD_ARGV`); `reclaim-pause is grantable ONLY with --state` FAILS on its FIRST assertion, before the builder is ever called — `exactly one reclaim-pause grant: expected 0 to be 1` (nothing is granted yet). Every other case passes.
- server `capsupported`, `ccd-archive`: the FILES LOAD. Under vitest's module transform a named import the module does not export reads as `undefined`, never a collection error (measured at planning: `import { x, y }` from a module exporting only `x` gives `AssertionError: expected undefined to be 2`, `1 failed | 1 passed`). So `capsupported`'s new case fails on its first line, `expected undefined to be 'reclaim-pause-v1'`, and `ccd-archive`'s case that holds the `toContain` lines fails `expected [ …, 'reclaim-pause-v1' ] to include undefined` (Task 2 already put the string in the array). Every other case in both files passes.

- [ ] **Step 3: Add the grant and the enrolment**

In `agent/src/whitelist.ts`, `REQUIRED_VERB_FLAG`: add one line directly above `} as const;` — **APPEND, never rewrite the object from this plan** (it carries entries waves 1–3 and other programmes added; D-2776 records a rewrite that silently dropped a live enrolment):

```ts
  'reclaim-pause': '--state',
```

In `EXEC_WHITELIST.ccd`, directly after the `['coord-pause', '--state'],` entry:

```ts
    // The reclaim kill-switch's writer (child-reclamation wave 4, spec §5.8),
    // granted on `coord-pause`'s argument exactly: `$REG/reclaim-paused` is a
    // registry-file write/unlink, non-destructive, and granting it widens
    // nothing that deletes — the file can only STOP a deletion. The server may
    // write only `~/.cc-clips` here and `FleetIO` has no unlink, so the marker
    // is raised through this verb or not at all.
    //
    // ENROLLED in `REQUIRED_VERB_FLAG` above: `--state` is the verb's whole
    // argument surface, reached from `POST /api/coord/reclaim-pause`, which
    // carries no box token. A bare `['reclaim-pause']` would admit every
    // positional form the verb might grow and stay green in
    // `whitelist-subset.test.ts`'s layers 2 and 3 (g14 is the other side).
    ['reclaim-pause', '--state'],
```

- [ ] **Step 4: Add the server-side builder and token — and NO wrapper**

In `server/src/ccdargv.ts`, inside `CCD_ARGV`, directly after the `coordPause` entry:

```ts
  /** The reclaim kill-switch's writer (child-reclamation wave 4, spec §5.8) —
   *  `coordPause`'s shape exactly: `state` is a two-member union, so the on|off
   *  vocabulary is ccd's and no route can invent a third word the verb would
   *  `die` on. The flag LEADS, where the agent's two-token grant expects it. */
  reclaimPause: (state: 'on' | 'off') => argv(['reclaim-pause', '--state', state]),
```

Directly after wave 3's `export const RECLAIM_CAP = 'reclaim-v1';` (and its docstring):

```ts
/** The `ccd caps` token that says this box has `ccd reclaim-pause` — the
 *  writer of `$REG/reclaim-paused` (child-reclamation wave 4). Spelled ONCE in
 *  `server/src`, for `ACTOR_FLAGS_CAP`'s reason; ccd's own
 *  `echo reclaim-pause-v1` and `ccd-archive.test.ts`'s
 *  `KNOWN_CAPABILITY_TOKENS` are the other two spellings, and that test's
 *  `toContain` holds this one equal to them.
 *
 *  READ IT WITH `capSupported`, NEVER `verbSupported`: the route that composes
 *  this verb answers 501 on a box that never advertised it, rather than
 *  sending a verb an older ccd answers with its usage line — which the phone
 *  would render as "the switch is broken" when the truth is "the fleet host is
 *  older than this server". A note on the token, not a wrapper: the gate lives
 *  at the route's own seam, where its mutation test reds on it. */
export const RECLAIM_PAUSE_CAP = 'reclaim-pause-v1';
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd agent  && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts test/whitelist.test.ts test/whitelist-noghosts.test.ts test/whitelist-prototype.test.ts test/exec.test.ts
cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts test/capsupported.test.ts test/ccd-archive.test.ts test/ccdargv-brand.test.ts test/single-definition.test.ts test/typecheck-tests.test.ts
```

Expected: PASS everywhere. (`typecheck-tests` is a known load flake — re-run it in isolation before calling it a break. `verb-gate.test.ts` is NOT in this list on purpose: no call site composes `reclaimPause` yet, so it has nothing to say until Task 6.)

- [ ] **Step 6: Mutation check, then commit**

| # | Edit | Command | Expected red |
|---|---|---|---|
| 1 | Delete `'reclaim-pause': '--state',` from `REQUIRED_VERB_FLAG` (leave the grant) | `cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts` | `g14-reclaim-pause-without-state.ts` — `expected [] to equal [ 'TS2322' ]`, and *the positive control compiles clean* — proves the ENROLMENT, not the grant, refuses the bare shape |
| 2 | Narrow `['reclaim-pause', '--state']` to `['reclaim-pause']` (the enrolment stays) | `cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts`, then `cd agent && ./node_modules/.bin/tsc --noEmit` | `whitelist-subset.test.ts` FAILS AT IMPORT, zero cases run: `agent/src/whitelist.ts` calls `auditExecWhitelist()` at module load, which throws `ccrc-agent: EXEC_WHITELIST['ccd'] grants 'reclaim-pause', but 'reclaim-pause' is only grantable with '--state' immediately after it. … Refusing to start.` — the layer-3 case's own `toEqual` message never appears. And the agent's `tsc` reports `TS2322` on the `LAWFUL_EXEC_WHITELIST: LawfulGrants<typeof EXEC_WHITELIST>` proof line. The layer-3 case stays as the pin for a table that bypasses the boot audit |
| 3 | Change `RECLAIM_PAUSE_CAP` to `'reclaim-pause-v2'` | `cd server && ./node_modules/.bin/vitest run test/capsupported.test.ts test/ccd-archive.test.ts` | `expected 'reclaim-pause-v2' to be 'reclaim-pause-v1'`, and `ccd-archive`'s `toContain` — together they hold the server spelling equal to ccd's `echo` |
| 4 | Swap the builder's tokens to `argv(['reclaim-pause', state, '--state'])` | `cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts` | layer 2c `reclaimPause builds the exact argv, token for token`, and the layer-3 case's `isExecAllowed(…reclaimPause('on'))` — `expected false to be true` |

```bash
git add agent/src/whitelist.ts agent/test/types/bypasses/g14-reclaim-pause-without-state.ts \
        agent/test/types/ok/legit-whitelist.ts agent/test/whitelist-structural.test.ts \
        server/src/ccdargv.ts server/test/whitelist-subset.test.ts \
        server/test/capsupported.test.ts server/test/ccd-archive.test.ts
git commit -m "$(cat <<'MSG'
feat(agent): grant `ccd reclaim-pause --state`, enrolled so it cannot narrow

Two tokens wide in EXEC_WHITELIST.ccd and enrolled in REQUIRED_VERB_FLAG, so a
bare ['reclaim-pause'] is a TS2322 on the LawfulGrants proof line and a boot
refusal — pinned from the other side by g14 and cross-package by
whitelist-subset. The server gains CCD_ARGV.reclaimPause and
RECLAIM_PAUSE_CAP, read with capSupported only: no evidence must REFUSE for a
verb that never existed (child-reclamation spec §5.8, §6).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: The marker reaches the wire — `RECLAIM_PAUSE_MARKER`, `CoordStatus.reclaim`, and the attention field's slot

**Model routing:** `sonnet`, effort `medium` — an additive wire field following `pause`/`mail` exactly, plus fixture churn.

**Files:**
- Modify: `server/src/coord/rundefs.ts` — after `COORDINATOR_PAUSE_MARKER` (at planning line 57)
- Modify: `shared/api.ts` — `CoordStatus` (at planning line 3640) and a new `ChildReclaimAttention` directly above it
- Modify: `server/src/watch.ts` — the `./coord/rundefs.js` import (line 41-43); the `../../shared/api.js` type import (line 27-30); one field beside `private coord: CoordStatus | null` (line 646); `emitCoord` (line 1207)
- Modify: `server/test/fleetws.test.ts` (eight `coord` equalities at planning lines 839-925; one new case)
- Modify: `server/test/single-definition.test.ts` (one `describe` after `Build 4 — one MarkerState, one coordinator-paused literal`)
- Modify: `server/test/mail-routes.test.ts` (`NOT_CODES`, beside `'coordinator-paused'`)
- Modify: `pwa/test/coord-banner.test.tsx` (the `coord()` helper, line 26), `pwa/test/tap-targets.test.tsx` (the `coordStatus()` helper, line 109), `pwa/test/abandon-sheet.test.tsx`, `pwa/test/runs-screen.test.tsx`, `pwa/test/start-program.test.tsx` (their `CoordStatus` literals)
- Modify, only if Task 1 Step 3 found one: the wave-3 file spelling `'reclaim-paused'`
- Modify: `README.md` (its four `shared/api.ts` anchors, re-anchored by content) and `server/test/session-hook.test.ts` (the citation-debt census's `'shared/api.ts'` entry and its sum, re-measured) — Step 8, the S6-R11 tax on this task's `shared/api.ts` insertion

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export const RECLAIM_PAUSE_MARKER = 'reclaim-paused';` (`server/src/coord/rundefs.ts`) — this task's `emitCoord`, Task 5's `childReclaimPauseRead` and Task 8's sweep read it.
  - `export interface ChildReclaimAttention { readonly sessionId: string; readonly runId: number | null; readonly token: string; readonly sentence: string; readonly at: number }` (L0).
  - `CoordStatus` becomes `{ pause: MarkerState; mail: MarkerState; reclaim: MarkerState; childReclaimAttention: readonly ChildReclaimAttention[] }`.
  - `FleetWatcher`'s private `childReclaimAttentionList: readonly ChildReclaimAttention[]`, initialised `[]`; Task 8's mirror derivation is its only writer (contract §7 R5, §8 R5′: no in-memory memo feeds `CoordStatus` or the frame — this field caches the mirror derivation's last RESULT, terminal refusals and failures past the ceiling alike, and holds no fact the mirror does not; no executor answer ever writes it).

- [ ] **Step 1: Write the failing tests**

(a) `server/test/fleetws.test.ts`: bring the eight existing `coord` equalities to the widened shape, then add one case. The eight are the only `toEqual({ pause: … })` lines in the file:

```bash
sed -i -E \
  -e "s/toEqual\(\{ pause: '(clear|set)', mail: '(clear|set)' \}\)/toEqual({ pause: '\1', mail: '\2', reclaim: 'clear', childReclaimAttention: [] })/g" \
  -e "s/toEqual\(\{ pause: 'unmeasurable', mail: 'unmeasurable' \}\)/toEqual({ pause: 'unmeasurable', mail: 'unmeasurable', reclaim: 'unmeasurable', childReclaimAttention: [] })/g" \
  server/test/fleetws.test.ts
grep -c "reclaim: 'clear', childReclaimAttention: \[\]" server/test/fleetws.test.ts
grep -c "reclaim: 'unmeasurable', childReclaimAttention: \[\]" server/test/fleetws.test.ts
```

Expected: `6` and `2`.

Then, directly after the `reports set for coordinator-paused and clear for mail-disabled independently` case:

```ts
    it('reports set for reclaim-paused, independently of the other two markers', async () => {
      // Child-reclamation wave 4 (spec §5.8): the third marker off the SAME
      // listing. Independence is the property — a reclaim pause is not a
      // dispatch pause, and the phone must not read one as the other.
      marker('reclaim-paused');
      const { ws, next, watcher } = await connect();
      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');
      expect((await next()).coord).toEqual(
        { pause: 'clear', mail: 'clear', reclaim: 'set', childReclaimAttention: [] });

      marker('coordinator-paused');
      await watcher.tick();
      expect((await next()).coord).toEqual(
        { pause: 'set', mail: 'clear', reclaim: 'set', childReclaimAttention: [] });
      ws.close();
    });
```

(b) `server/test/single-definition.test.ts`, directly after the `describe('Build 4 — one MarkerState, one coordinator-paused literal', …)` block:

```ts
// — Child-reclamation wave 4: the reclaim switch's file name —
describe("child-reclamation wave 4 — one 'reclaim-paused' literal", () => {
  it("'reclaim-paused' is a literal in exactly one source file", () => {
    // `RECLAIM_PAUSE_MARKER` (`server/src/coord/rundefs.ts`) is the ONE
    // definition. A second literal is how the banner and the sweep would come
    // to disagree about what "paused" means — one reading a name the other
    // never checks, with the deleting side the one that is wrong.
    const holders = ALL.filter((f) => readFileSync(f, 'utf8').includes("'reclaim-paused'")).map(rel);
    expect(holders).toEqual(['server/src/coord/rundefs.ts']);
  });

  it('watch.ts reaches the reclaim marker through the shared constant, never a copy', () => {
    // Not just "no second literal" — that is satisfied by deleting the reader.
    const src = readFileSync(path.join(ccrcRoot, 'server', 'src', 'watch.ts'), 'utf8');
    expect(src).toContain('names.includes(RECLAIM_PAUSE_MARKER)');
    expect(src).toMatch(/import \{[^}]*\bRECLAIM_PAUSE_MARKER\b[^}]*\} from '\.\/coord\/rundefs\.js'/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/fleetws.test.ts test/single-definition.test.ts
```

Expected: FAIL — SIX `fleetws` cases: the five existing cases that hold the eight rewritten equalities (`sends coord after hello/fleet/runs on connect`, `re-emits only on CHANGE`, `reports set for coordinator-paused and clear for mail-disabled independently`, `reports unmeasurable for BOTH markers`, `emits coord on the tick that FAILS SHUT`), plus the new case — each with `- Expected` carrying `reclaim` and `childReclaimAttention` and `+ Received` lacking both; `single-definition`'s two new cases (`expected [] to deeply equal [ 'server/src/coord/rundefs.ts' ]`, and `expected '…' to contain 'names.includes(RECLAIM_PAUSE_MARKER)'`). Every other `single-definition` case stays green.

- [ ] **Step 3: The constant, and the one exclusion the kebab scanner needs**

In `server/src/coord/rundefs.ts`, directly after `export const COORDINATOR_PAUSE_MARKER = 'coordinator-paused';`:

```ts
/** `$REG/reclaim-paused` — the fleet-wide kill-switch on the AUTOMATIC
 *  reclamation of child workspaces (child-reclamation spec §5.8). Written only
 *  by `ccd reclaim-pause` (through `POST /api/coord/reclaim-pause`), read by
 *  FOUR parties, spec §5.8's four: the watcher's frame (`emitCoord`, which
 *  renders it); the watcher's sweep (`sweepChildReclaim`, which skips before
 *  asking); the one executor both triggers share (`reclaimChild`, through
 *  `childReclaimPauseRead` in `childReclaimOutcome`, which defers
 *  `paused-at-server` after its sibling re-read and before presence or any
 *  argv — that is the close path's skip, and the sweep's for a reclaim that
 *  was queued before the switch went up); and — the one that matters —
 *  `ws-reclaim` itself on the box, which refuses `paused`. Not
 *  `-disabled`-suffixed, for `COORDINATOR_PAUSE_MARKER`'s reason: `limits.ts`
 *  reads `<name>-disabled` as a wrapper's lane switch. */
export const RECLAIM_PAUSE_MARKER = 'reclaim-paused';
```

In `server/test/mail-routes.test.ts`, `NOT_CODES`, directly after `'coordinator-paused',   // $REG marker filename, not a code` — and ONLY if Task 1 Step 3 found it absent:

```ts
      'reclaim-paused',       // $REG marker filename, not a code (child-reclamation wave 4)
```

(`rundefs.ts` lives in `server/src/coord`, which that test scans for every single-quoted kebab literal; a marker file name is not a refusal code.)

If Task 1 Step 3 found a `'reclaim-paused'` literal in a wave-3 file, replace it there with `RECLAIM_PAUSE_MARKER`, imported from `./rundefs.js` (or `./coord/rundefs.js` from `server/src`).

- [ ] **Step 4: The L0 types**

In `shared/api.ts`, replace the one-line `export interface CoordStatus { pause: MarkerState; mail: MarkerState }` and its docstring with:

```ts
/** One child the fleet-level attention item reports (child-reclamation spec
 *  §5.9): a child a TERMINAL reclaim refusal left standing, or one whose
 *  reclaim has kept FAILING past the defer ceiling — which is still retried,
 *  backing off in between. A REPORT, never a tap: nothing waits on it, and
 *  ignoring it costs disk rather than correctness. DERIVED on the server from
 *  the lifecycle mirror ALONE (the latest `reclaim` event of any outcome in the
 *  id's current workspace generation is that refusal, or the last of that run
 *  of failures, and the registry row still exists), so a restart does not
 *  lose it.
 *
 *  `sentence` is the SERVER's — a refusal's through `wsaudit.ts`'s one lookup,
 *  a failure's from the journal's own word for it — and the PWA renders it and
 *  maps no token itself: several of `ws-reclaim`'s tokens share names with the
 *  audit's, and the two vocabularies are held disjoint server-side. `token` is
 *  the refusal's or the failure's (empty when ccd journaled a failure with
 *  none) and rides beside it for a maintainer's grep, never for a renderer's
 *  switch. `runId` is the minting run the registry marker names, or null when
 *  the marker no longer reads as a child. `at` (epoch ms) is since when, on
 *  ccd's clock alone: a refusal's journal line, or the first failure of the
 *  run that ccd placed. A child whose latest line carried no `at` cannot be
 *  placed and is not listed — the mirror's `ingestedAt` is the server's clock
 *  and is never read as an event time (D8, `server/src/coord/schema.ts`). */
export interface ChildReclaimAttention {
  readonly sessionId: string;
  readonly runId: number | null;
  readonly token: string;
  readonly sentence: string;
  readonly at: number;
}

/** The three markers the coordination lane is governed by, read together
 *  because they come from one listing: `coordinator-paused` (spec §4.2 — the
 *  one file that stops a program mid-flight), `mail-disabled` (the injection
 *  kill-switch `sweepMail` already gates on) and `reclaim-paused`
 *  (child-reclamation §5.8 — the one file that stops automatic reclamation).
 *  Plus the reclaim attention list, which rides this frame because it is
 *  shown in the same banner row as the reclaim switch.
 *
 *  ADDITIVE on the wire (no `FLEET_PROTO` bump): a frame from a server that
 *  predates `reclaim`/`childReclaimAttention` omits both, and the PWA's ONE
 *  reader per field (`pwa/src/fleet/childReclaimWords.ts`) renders exactly
 *  what it rendered before. */
export interface CoordStatus {
  pause: MarkerState;
  mail: MarkerState;
  reclaim: MarkerState;
  childReclaimAttention: readonly ChildReclaimAttention[];
}
```

- [ ] **Step 5: The frame**

In `server/src/watch.ts`:

1. Add `RECLAIM_PAUSE_MARKER` to the `./coord/rundefs.js` import (the one that already names `COORDINATOR_PAUSE_MARKER`), and `ChildReclaimAttention` to the `../../shared/api.js` type import that names `CoordStatus`.
2. Directly after `private lastCoordJson: string | null = null;`:

```ts
  /** The reclaim attention list as `sweepChildReclaim` last derived it from
   *  the lifecycle mirror (child-reclamation wave 4). `emitCoord` reads it on
   *  every tick; the sweep's MIRROR DERIVATION is its ONLY writer, on its own
   *  slower clock, so a frame never waits on a database read. A cache of that
   *  derivation's result, never a memo of anything else: no executor answer
   *  writes it (spec §5.9: "derived from the lifecycle mirror so a restart
   *  does not lose it" — every terminal refusal reaches the mirror through
   *  ccd's own journal line, `ws-reclaim`'s or the one `ws-audit --reclaim`
   *  writes for a terminal verdict, and every failure through `ws-reclaim`'s
   *  `_lc_fail`; the mirror is the ONLY source). `[]` until the first
   *  sweep — which runs on the first tick after a restart, so the list is
   *  rebuilt from the mirror within one tick rather than lost. */
  private childReclaimAttentionList: readonly ChildReclaimAttention[] = [];
```

3. `emitCoord`'s object literal becomes:

```ts
    const status: CoordStatus = names === null
      ? { pause: 'unmeasurable', mail: 'unmeasurable', reclaim: 'unmeasurable',
          childReclaimAttention: this.childReclaimAttentionList }
      : { pause: names.includes(COORDINATOR_PAUSE_MARKER) ? 'set' : 'clear',
          mail: names.includes(MAIL_DISABLED_MARKER) ? 'set' : 'clear',
          reclaim: names.includes(RECLAIM_PAUSE_MARKER) ? 'set' : 'clear',
          childReclaimAttention: this.childReclaimAttentionList };
```

…and its docstring's last sentence gains: "The attention list is a cached field, not a read: this method still touches no `node:sqlite` and no I/O."

- [ ] **Step 6: The PWA fixtures that construct a `CoordStatus`**

`pwa/test/coord-banner.test.tsx`, the helper (line 26):

```ts
const coord = (over: Partial<CoordStatus> = {}): CoordStatus =>
  ({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], ...over });
```

`pwa/test/tap-targets.test.tsx`, the helper (line 109):

```ts
const coordStatus = (over: Partial<CoordStatus> = {}): CoordStatus =>
  ({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], ...over });
```

The three files that write the literal inline:

```bash
sed -i -E "s/coord: \{ pause: '(clear|set|unmeasurable)', mail: '(clear|set)' \}/coord: { pause: '\1', mail: '\2', reclaim: 'clear', childReclaimAttention: [] }/g" \
  pwa/test/abandon-sheet.test.tsx pwa/test/runs-screen.test.tsx pwa/test/start-program.test.tsx
grep -c "reclaim: 'clear', childReclaimAttention: \[\]" pwa/test/abandon-sheet.test.tsx pwa/test/runs-screen.test.tsx pwa/test/start-program.test.tsx
```

Expected: `1`, `2`, `2`. The `as unknown as CoordStatus` casts (`'quarantined'`) are deliberately untouched — they model a frame from a build this one does not know. `pwa/test/stores.test.ts` sends its frames as JSON strings and compares what it sent; it needs no edit.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/fleetws.test.ts test/single-definition.test.ts test/mail-routes.test.ts test/typecheck-tests.test.ts
cd pwa && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run test/coord-banner.test.tsx test/tap-targets.test.tsx test/abandon-sheet.test.tsx test/runs-screen.test.tsx test/start-program.test.tsx test/stores.test.ts
```

Expected: PASS; `tsc --noEmit` prints nothing. (`session-hook` is deliberately not in this list: Step 4's insertion has just moved README's `shared/api.ts` anchors, and Step 8 is where that red is paid.)

- [ ] **Step 8: Pay the citation tax on `shared/api.ts` (S6-R11) — README by content, the debt census by measurement**

Step 4 inserted `ChildReclaimAttention` and three lines of `CoordStatus` ABOVE README's four `shared/api.ts` anchors (see Global Constraints), so `session-hook.test.ts`'s *README HAS ITS OWN CENSUS ENTRY* and *the citation debt moved* cases are red now. (This task's other cited file, `server/test/single-definition.test.ts`, takes its insertion BELOW the corpus's highest anchor into it — `:1303` — so it moves nothing; (c) below is the measurement, and a red naming `single-definition.test.ts` there means the insertion landed above `:1303` and must move down, never that a number is re-typed. Contract §7 R9.) This is wave 2's Task 5 Step 9 procedure, with this task's own `HEAD` (the commit before Step 4) as the base, because waves 2 and 3 have already re-anchored README once. Never by adding a line delta to a number.

(a) Measure where README's four anchors stand in the base and where those same bytes stand now, and prove the bytes are identical:

```bash
OLD_U=$(grep -oE 'shared/api\.ts:[0-9]+-[0-9]+' README.md | sed 's/.*://')
OLD_M=$(sed -n '/`purge-mechanism-absent` (`shared\/api\.ts:/,+1p' README.md | grep -oE '`:[0-9]+`' | tr -d '`:' | paste -sd' ')
NEW_U=$(grep -nE "^  \| 'purge-(refused|incomplete|mechanism-absent)'" shared/api.ts | cut -d: -f1 | paste -sd' ')
NEW_M=$(grep -nE "^  'purge-(refused|incomplete|mechanism-absent)':$" shared/api.ts | cut -d: -f1 | paste -sd' ')
echo "old union ${OLD_U}  old map ${OLD_M}  |  new union ${NEW_U}  new map ${NEW_M}"
read -r U1 _ U3 <<<"$NEW_U"; read -r M1 M2 M3 <<<"$NEW_M"; read -r OM1 OM2 OM3 <<<"$OLD_M"
diff <(git show "HEAD:shared/api.ts" | sed -n "${OLD_U/-/,}p;${OM1}p;${OM2}p;${OM3}p") \
     <(sed -n "${U1},${U3}p;${M1}p;${M2}p;${M3}p" shared/api.ts) && echo SAME-BYTES
```

Expected: one README union range and three map numbers (whatever waves 2 and 3 left — read them from the output, never from this plan); three new union lines, consecutive, and three new map lines, all below the old ones by the SAME count (the net insertion Step 4 made above them); then `SAME-BYTES`. If README's numbers do NOT address the purge lines in `HEAD:shared/api.ts` (the `diff` prints something), STOP: an earlier wave left README stale, or the anchors' bytes changed, and this procedure cannot repair either by position — report it in the wave-done mail.

(b) Re-point README to the bytes, in the same shell:

```bash
perl -pi -e "s/shared\/api\.ts:${OLD_U}\`/shared\/api.ts:${U1}-${U3}\`/; s/\`:${OM1}\`/\`:${M1}\`/; s/\`:${OM2}\`/\`:${M2}\`/; s/\`:${OM3}\`/\`:${M3}\`/" README.md
git diff --stat -- README.md
```

Expected: `README.md | 4 ++--` — the two lines of the purge-refusal sentence, nothing else.

(c) Re-measure the census:

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
```

Expected: *README HAS ITS OWN CENSUS ENTRY, and it is EMPTY* now PASSES. *the citation debt moved — re-measure, and lower the census rather than the rule* is RED only if the frozen spec/plan corpus cites a `shared/api.ts` line at or below Step 4's insertion, and then its received map differs from the expected one in the `'shared/api.ts'` entry only; its sum assertion (*the narrated headline is the sum of the census*) is red by the same difference. Neither corpus document may be re-pointed, so this is a RE-MEASUREMENT under the standing rule, not a rule change and not a D-number. If both are green, record "the debt census did not move" for the wave-done mail and skip (d).

(d) In `server/test/session-hook.test.ts`, replace the `'shared/api.ts'` entry's value in that `byFile` map with the RECEIVED value, and put this comment directly above it (fill in the two numbers from the red, never from this plan), after any comment waves 2 and 3 left there:

```ts
      // RE-MEASURED at child-reclamation wave 4 Task 4 (S6-R11, no rule
      // changed, no D-number): `shared/api.ts` <old> -> <new>. This task
      // inserted `ChildReclaimAttention` and widened `CoordStatus` above
      // anchors the frozen spec/plan corpus cites by line, and neither
      // document may be re-pointed. README's four anchors into the same file
      // were RE-ANCHORED BY CONTENT in the same commit (the three
      // `LcRefusalToken` union arms and their three map keys, `diff`-proved
      // byte-identical), so README contributes nothing here.
```

and set the sum's `.toBe(<n>)` to the received total. Re-run (c): Expected PASS. Any OTHER red in this file that names a `shared/api.ts` anchor is the same tax — re-measure it the same way and name it in the wave-done mail; never widen a rule to make it green. `session-hook` is a known load flake: a red that does NOT name `shared/api.ts` gets an isolated re-run before anything else.

- [ ] **Step 9: Mutation check, then commit**

| # | Edit | Command | Expected red |
|---|---|---|---|
| 1 | In `emitCoord`'s listed arm, write `reclaim: 'clear',` | `cd server && ./node_modules/.bin/vitest run test/fleetws.test.ts` | *reports set for reclaim-paused, independently* — `reclaim: 'set'` expected, `'clear'` received |
| 2 | In the `names === null` arm, write `reclaim: 'clear',` | same | *reports unmeasurable for BOTH markers* and *emits coord on the tick that FAILS SHUT* — an unlistable registry must never read as "not paused" |
| 3 | Replace `names.includes(RECLAIM_PAUSE_MARKER)` with `names.includes('reclaim-paused')` | `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts` | both new cases — a second holder `server/src/watch.ts`, and the constant no longer read |

```bash
git add shared/api.ts server/src/coord/rundefs.ts server/src/watch.ts \
        server/test/fleetws.test.ts server/test/single-definition.test.ts server/test/mail-routes.test.ts \
        pwa/test/coord-banner.test.tsx pwa/test/tap-targets.test.tsx pwa/test/abandon-sheet.test.tsx \
        pwa/test/runs-screen.test.tsx pwa/test/start-program.test.tsx
git add README.md server/test/session-hook.test.ts   # Step 8's S6-R11 repair (README always; session-hook only if (d) ran)
git add <the wave-3 file Task 1 Step 3 fact 3 named>   # ONLY if Step 3 edited it
git status --short
```

Expected from `git status --short`: no ` M` line under `server/src`, `shared` or `pwa` — every file this task edited is staged. A conditional edit left unstaged is a tree that is green locally and red in CI (`single-definition` would find `'reclaim-paused'` in two committed files).

```bash
git commit -m "$(cat <<'MSG'
feat(coord): the reclaim switch rides the coord frame

RECLAIM_PAUSE_MARKER is the one spelling of `$REG/reclaim-paused`, and
CoordStatus gains `reclaim` (set/clear/unmeasurable off the SAME listing
`pause` and `mail` read) and `childReclaimAttention`, the slot the reclaim
lane fills. Additive: no FLEET_PROTO bump; an older frame omits both.
README's `shared/api.ts` anchors re-pointed by content and the citation
census re-measured (S6-R11): the insertion lands above them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: The close path skips too — the executor reads the switch at wave 3's marked place, and `paused-at-server` gets its producer

**Model routing:** `sonnet`, effort `high` — one read and one early return in wave 3's executor, placed exactly; the SAFETY lens judges it.

Spec §5.8: "**Four readers, and the fourth is the one that matters.** The sweep skips; the close path skips; the PWA renders. And `ws-reclaim` itself reads it". The contract's wave-3 executor re-reads the mark, the siblings, presence and the capability — not the pause — and declares `paused-at-server` in `ChildReclaimDeferWhy`; contract §7 R8 rules that its producer lives in this wave, and §8 R8′ rules WHERE: "At wave 3's marked comment inside `childReclaimOutcome`, after the sibling read and BEFORE presence, returning through that function's own `deferred(...)` helper, so `reclaimChild`'s one feed row records it. Never inside the `reclaimChild` wrapper." This is the wave where `RECLAIM_PAUSE_MARKER` first exists, so it lands here, in the ONE executor both triggers share: the close route's `deps.childReclaim` port and the sweep both reach `reclaimChild`, so one read covers the close path AND a sweep reclaim that was queued behind a session's `KeyedQueue` before the switch went up. It is not the authority — ccd's rung 3 is, inside its lock — it is the server declining to compose an argv it already knows ccd will refuse, which also spares the fleet box a `ws-audit` walk per close while the fleet is paused. (Task 1 Step 3 fact 4 confirmed wave 3 left it unproduced and marked the place; had it not, Task 1 stopped.)

The placement is three facts, each pinned by a test below: AFTER the marker and sibling re-reads (a child another run still names says `siblings-open`, paused or not — the more specific answer); BEFORE presence (a watched child under a raised switch says `paused-at-server`, the reason that outlasts the watcher, and the one the ceiling cannot reach past); and THROUGH `deferred(...)` inside `childReclaimOutcome`, whose every return reaches `reclaimChild`'s single `recordChildReclaimFeed` call — a pre-check in the wrapper would skip that row.

**Files:**
- Modify: `server/src/coord/childReclaim.ts` — its `./rundefs.js` import and its `../../../shared/api.js` import (`server/src/coord/` is three levels below the root); one exported function `childReclaimPauseRead`; wave 3's marked comment inside `childReclaimOutcome`, REPLACED by the read; the re-read list in `reclaimChild`'s docstring
- Create: `server/test/child-reclaim-paused-at-server.test.ts`

**Interfaces:**
- Consumes: `RECLAIM_PAUSE_MARKER` (Task 4); `MarkerState` (`shared/api.ts`); `FleetIO['readdir']` (answers `null` when the directory cannot be listed); wave 3's `reclaimChild`, its module-private `childReclaimOutcome` and that function's local `deferred(why, detail)` helper, `ChildReclaimDeps` (with `io` and `cfg` — Task 1 Step 3 fact 2), the marked comment `WAVE 4 ADDS THE SERVER-SIDE PAUSE READ HERE` (Task 1 Step 3 fact 4); `RECLAIM_CAP`, `ACTOR_FLAGS_CAP` (`server/src/ccdargv.ts`); `NotifyLog` (`server/src/notifylog.ts`) and `CoordStore.feedEvents` for the feed-row case.
- Produces: `export async function childReclaimPauseRead(io: Pick<FleetIO, 'readdir'>, registryDir: string): Promise<MarkerState>` — `set` when the listing names the marker, `clear` when it lists without it, `unmeasurable` when it does not list (three answers, never folded; `emitCoord`'s mapping of the same listing). `childReclaimOutcome` answers `deferred(...)`'s `{ kind: 'deferred', sessionId, runId, why: 'paused-at-server', detail }` on anything but `clear` — after the marker and sibling re-reads, before presence, the capability and any ccd argv — whatever `req.trigger` and whatever `req.deferExpired`; `reclaimChild` writes its one feed row for it like every other deferral. Task 8's sweep does not call it (it skips on the tick's own listing before asking); the close route reaches it through the executor.

- [ ] **Step 1: Write the failing test**

Create `server/test/child-reclaim-paused-at-server.test.ts`:

```ts
// The close path's skip (child-reclamation spec §5.8: "The sweep skips; the
// close path skips; the PWA renders. And `ws-reclaim` itself reads it"). The
// executor both triggers share reads `$REG/reclaim-paused` before it composes
// ANY argv, and answers `deferred` / `paused-at-server` — the member wave 3
// declared in `ChildReclaimDeferWhy` and produces nowhere.
//
// Not the authority: ccd's rung 3 re-reads the file inside its lock. This is
// the server declining to ask for what it already knows will be refused, and
// the one server-side read that covers a reclaim QUEUED behind a session's
// KeyedQueue before the switch went up. Where it sits is pinned three ways:
// after the sibling re-read, before presence, and inside the function whose
// every answer gets the executor's one feed row (spec §5.9: "One feed row per
// outcome").
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { childReclaimPauseRead, reclaimChild, type ChildReclaimDeps } from '../src/coord/childReclaim.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { NotifyLog } from '../src/notifylog.js';
import { ACTOR_FLAGS_CAP, CCD_ARGV, RECLAIM_CAP } from '../src/ccdargv.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

describe('childReclaimPauseRead — three answers off one listing', () => {
  const io = (names: string[] | null) => ({ readdir: async () => names });
  it('set when the listing names the marker, clear when it lists without it', async () => {
    expect(await childReclaimPauseRead(io(['demo-a.uuid', 'reclaim-paused']), '/reg')).toBe('set');
    expect(await childReclaimPauseRead(io(['demo-a.uuid', 'coordinator-paused']), '/reg')).toBe('clear');
  });
  it('unmeasurable when the registry does not list — a pause that cannot be ruled out', async () => {
    expect(await childReclaimPauseRead(io(null), '/reg')).toBe('unmeasurable');
  });
});

/** A marked child of a FINISHED run with nothing open on it — the executor's
 *  own re-reads all pass, so the pause read is the only thing that can stop it
 *  before the audit. `visible` makes the presence claim answer yes. */
const fixture = async (over: { visible?: boolean } = {}) => {
  const home = mkTmp('ccrc-child-reclaim-paused-');
  const calls: string[][] = [];
  const base = testDeps(home, async (_cmd, args) => { calls.push(args); return { code: 1, stdout: '', stderr: '' }; });
  const reg = base.cfg.registryDir;
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'w4-paused', title: 'w4-paused', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
  if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
  const closed = coord.closeRun({ runId: opened.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program: 'w4-paused', viaClosing: false });
  if (!closed.ok) throw new Error(`abandon refused: ${JSON.stringify(closed)}`);
  const fields: Record<string, string> = {
    uuid: 'u-demo-a', wrapper: 'claude', project: 'demo', workdir: '/w/demo-a', workspace: 'a',
    branch: 'ws/demo-a', base: 'origin/main', started: '1', child: String(opened.id),
  };
  for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `demo-a.${f}`), v);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  // The member set Task 1 Step 3 fact 2 recorded — the one the close route
  // composes. The verbs are the ones wave 3's executor checks before it
  // reaches the audit, as its own test's `CAPS` spells them: `ws-audit`
  // (`verbSupported`, which REFUSES a verb a present list does not name),
  // `reclaim-v1` (`capSupported`), and `ws-reclaim` + `actor-flags-v1` (the
  // act and its dec). Without `ws-audit` the CONTROL below never sees an argv.
  const deps: ChildReclaimDeps = {
    coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd,
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
      ccdVerbs: ['ws-audit', 'ws-reclaim', RECLAIM_CAP, ACTOR_FLAGS_CAP] },
    presence: { isVisible: (id: string) => over.visible === true && id === 'demo-a' },
    notifyLog,
  };
  const ccdCalls = (): string[][] => calls.filter((c) => c[0] === 'ws-audit' || c[0] === 'ws-reclaim');
  const feed = (): string[] => coord.feedEvents(50).filter((e) => e.sessionId === 'demo-a').map((e) => e.title);
  const bodies = (): string[] => coord.feedEvents(50).filter((e) => e.sessionId === 'demo-a').map((e) => e.body);
  const raise = (): void => writeFileSync(path.join(reg, 'reclaim-paused'), '');
  return { reg, coord, deps, runId: opened.id, ccdCalls, feed, bodies, raise };
};

describe('reclaimChild — the pause, read before any argv', () => {
  it('defers paused-at-server on the CLOSE trigger, and asks ccd nothing', async () => {
    const f = await fixture();
    f.raise();
    // `deferredSinceMs: null` — close never deferred before (spec §5.7: close
    // is a first attempt; the sweep carries the wait).
    const out = await reclaimChild(f.deps, {
      sessionId: 'demo-a', runId: f.runId, trigger: 'close', deferExpired: false, deferredSinceMs: null,
    });
    expect(out).toMatchObject({ kind: 'deferred', sessionId: 'demo-a', runId: f.runId, why: 'paused-at-server' });
    expect(f.ccdCalls()).toEqual([]);
  });

  it('the defer ceiling never overrides the switch: deferExpired defers too', async () => {
    // `--defer-expired` skips PRESENCE (rungs 5 and 6 and the visibility
    // claim) and nothing else — the pause is not presence (spec §5.7).
    const f = await fixture();
    f.raise();
    // The sweep's ceiling-expired shape exactly: `deferExpired` AND the first
    // deferral it saw, a full ceiling ago.
    const out = await reclaimChild(f.deps, {
      sessionId: 'demo-a', runId: f.runId, trigger: 'sweep', deferExpired: true,
      deferredSinceMs: Date.now() - 15 * 60_000,
    });
    expect(out).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
    expect(f.ccdCalls()).toEqual([]);
  });

  it('is read BEFORE presence: a watched child under a raised switch says paused-at-server, not presence', async () => {
    // The reason that outlasts the watcher, and the one no ceiling reaches past.
    const f = await fixture({ visible: true });
    f.raise();
    const out = await reclaimChild(f.deps, {
      sessionId: 'demo-a', runId: f.runId, trigger: 'close', deferExpired: false, deferredSinceMs: null,
    });
    expect(out).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
  });

  it('is read AFTER the sibling re-read: a child an open run still names says siblings-open, paused or not', async () => {
    const f = await fixture();
    f.raise();
    const next = f.coord.openRun({ program: 'w4-paused-2', title: 'w4-paused-2', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in next)) throw new Error(`openRun refused: ${JSON.stringify(next)}`);
    f.coord.setSession(next.id, 'demo-a');
    const out = await reclaimChild(f.deps, {
      sessionId: 'demo-a', runId: f.runId, trigger: 'close', deferExpired: false, deferredSinceMs: null,
    });
    expect(out).toMatchObject({ kind: 'deferred', why: 'siblings-open' });
  });

  it('gets the executor\'s ONE feed row, like every other deferral — never a second writer, never none', async () => {
    const f = await fixture();
    f.raise();
    await reclaimChild(f.deps, {
      sessionId: 'demo-a', runId: f.runId, trigger: 'close', deferExpired: false, deferredSinceMs: null,
    });
    expect(f.feed()).toEqual(['child reclaim deferred']);
    expect(f.bodies()[0]).toContain('paused-at-server');
  });

  it('CONTROL — with the switch down the same child reaches wave 3\'s audit argv', async () => {
    // Without this, the cases above would pass for ANY reason the executor
    // stopped early (a fixture the marker re-read rejects, say, or a verb list
    // the audit's own gate refuses).
    const f = await fixture();
    await reclaimChild(f.deps, {
      sessionId: 'demo-a', runId: f.runId, trigger: 'close', deferExpired: false, deferredSinceMs: null,
    });
    expect(f.ccdCalls()).toContainEqual([...CCD_ARGV.wsReclaimAudit('demo-a', false)]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-paused-at-server.test.ts`

Expected: the file loads (a missing named export reads as `undefined` under vitest's transform — see Task 3 Step 2). The two `childReclaimPauseRead` cases fail `TypeError: childReclaimPauseRead is not a function`; the two paused cases fail — the executor composes the audit argv, so `ccdCalls()` is `[ [ 'ws-audit', … ] ]` where `[]` was expected (or, if wave 3's executor answers something other than `deferred` first, the `toMatchObject` names that); *is read BEFORE presence* fails `expected { …, why: 'presence' } to match object { …, why: 'paused-at-server' }`; the feed-row case fails `expected [ 'child reclaim failed' ] to deeply equal [ 'child reclaim deferred' ]` (the audit ran against the recording runner's exit 1 and failed); *is read AFTER the sibling re-read* PASSES already (nothing reads the switch yet, so the sibling answer stands) — it is the placement guard for Step 3, and its mutation row below proves it bites; the CONTROL passes. **If the CONTROL fails, STOP**: the fixture does not reach the audit — check the verb list against wave 3's `childReclaimAudit` gate and the member set against Task 1 Step 3 fact 2 — and the paused cases prove nothing until it does.

- [ ] **Step 3: The read, at the marked place**

In `server/src/coord/childReclaim.ts`, add `import { RECLAIM_PAUSE_MARKER } from './rundefs.js';` (or add the name to that import if the file has one), and `type MarkerState` to its `../../../shared/api.js` import (wave 3's one import from that path — `TERMINAL_RUN_STATES`, `ChildMark` and `RunState` among its members in wave 3's plan; keep every existing member). `FleetIO` is already imported there (`ChildReclaimDeps.io: FleetIO`). Then, as a top-level export beside the file's other helpers:

```ts
/** The server's read of the reclaim kill-switch (child-reclamation spec §5.8,
 *  wave 4) — the close path's skip, and the one server-side read that covers a
 *  sweep reclaim queued behind a session's `KeyedQueue` before the switch went
 *  up. `emitCoord`'s mapping of the same listing: THREE answers, because "the
 *  registry did not list" is not "the switch is down". NOT the authority —
 *  `ws-reclaim` re-reads the file inside its lock at rung 3 and again on
 *  resume; this spares the box an audit walk the server already knows ccd will
 *  refuse. */
export async function childReclaimPauseRead(
  io: Pick<FleetIO, 'readdir'>, registryDir: string,
): Promise<MarkerState> {
  const names = await io.readdir(registryDir);
  if (names === null) return 'unmeasurable';
  return names.includes(RECLAIM_PAUSE_MARKER) ? 'set' : 'clear';
}
```

In `childReclaimOutcome`, REPLACE wave 3's marked comment — the whole comment block that begins `// WAVE 4 ADDS THE SERVER-SIDE PAUSE READ HERE` and ends on the line directly above `// 3 — a human looking at it, unless the defer's ceiling was reached.`, sitting directly after the sibling re-read's `siblings-open` return (locate it by those two anchors, never by its line count, which wave 3 may have reworded) — with:

```ts
  // 2b — THE SWITCH, READ BY THE SERVER (spec §5.8: "the close path skips").
  // After the marker and sibling re-reads and BEFORE presence, the capability
  // and any argv: a raised switch — or a registry that did not list, which
  // cannot rule one out — defers, on EITHER trigger and WHATEVER
  // `deferExpired` says (the ceiling bounds presence; the pause is not
  // presence). Through this function's own `deferred(...)`, so `reclaimChild`
  // writes its one feed row for it like every other deferral. ccd's rung 3,
  // read on the box inside the lock at the instant of deletion, is still the
  // read that matters.
  const pause = await childReclaimPauseRead(deps.io, deps.cfg.registryDir);
  if (pause !== 'clear') {
    return deferred('paused-at-server', pause === 'set'
      ? `${RECLAIM_PAUSE_MARKER} is raised: automatic reclamation is paused fleet-wide`
      : `the registry did not list, so a raised ${RECLAIM_PAUSE_MARKER} cannot be ruled out`);
  }
```

Nothing is added to `reclaimChild` itself — its body stays `childReclaimOutcome` then the one `recordChildReclaimFeed`. In `reclaimChild`'s docstring, the sentence that lists what it re-reads (`the marker against \`req.runId\`, the open siblings, presence, the capability`) becomes `the marker against \`req.runId\`, the open siblings, the reclaim switch (\`childReclaimPauseRead\`, wave 4), presence, the capability`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-paused-at-server.test.ts test/child-reclaim.test.ts \
  test/single-definition.test.ts test/mail-routes.test.ts test/typecheck-tests.test.ts
```

Expected: PASS — `child-reclaim-paused-at-server` 8/8; wave 3's `child-reclaim` suite unchanged (its cases never raise the switch, and its registry lists, so every one of them reads `clear` and goes on exactly as before); `single-definition`'s one-literal pin still finds `'reclaim-paused'` only in `rundefs.ts` (the executor reaches it through the constant); `mail-routes`' kebab scan over `server/src/coord` sees no new literal (`'paused-at-server'` is wave 3's, already in this file's type union and admitted by `isChildReclaimKebab`).

- [ ] **Step 5: Mutation check, then commit**

Each run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-paused-at-server.test.ts`.

| # | Edit (in `server/src/coord/childReclaim.ts`) | Expected red |
|---|---|---|
| 1 | In `childReclaimPauseRead`, `if (names === null) return 'unmeasurable';` → `if (names === null) return 'clear';` | *unmeasurable when the registry does not list* — `expected 'clear' to be 'unmeasurable'`: an unlistable registry read as "switch down" is the fail-open |
| 2 | Delete the `2b` block in `childReclaimOutcome` | *defers paused-at-server on the CLOSE trigger*, *deferExpired defers too*, *is read BEFORE presence* and the feed-row case — the audit argv is composed; CONTROL stays green |
| 3 | Guard the block with `!req.deferExpired &&` | *the defer ceiling never overrides the switch* alone — the proof that the ceiling cannot reach past the pause |
| 4 | Move the block below step 3's presence `if` | *is read BEFORE presence* — `expected { …, why: 'presence' } to match object { …, why: 'paused-at-server' }` (contract §8 R8′) |
| 5 | Move the block above `const sib = deps.coord.openRunsForSession(sessionId);` | *is read AFTER the sibling re-read* — `expected { …, why: 'paused-at-server' } to match object { …, why: 'siblings-open' }` (contract §8 R8′) |
| 6 | Move the block into `reclaimChild`, above `const outcome = await childReclaimOutcome(deps, req);`, returning `{ kind: 'deferred', sessionId: req.sessionId, runId: req.runId, why: 'paused-at-server', detail: '…' }` directly — the wrapper placement the ruling forbids | the feed-row case — `expected [] to deeply equal [ 'child reclaim deferred' ]`: the deferral bypasses `recordChildReclaimFeed` (contract §8 R8′: "Never inside the `reclaimChild` wrapper") |

```bash
git add server/src/coord/childReclaim.ts server/test/child-reclaim-paused-at-server.test.ts
git commit -m "$(cat <<'MSG'
feat(reclaim): the close path skips while reclaim-paused stands

The one executor close and the sweep share reads the reclaim switch off
the registry listing at the place wave 3 marked in childReclaimOutcome —
after the marker and sibling re-reads, before presence, the capability and
any argv — and defers `paused-at-server` through that function's own
deferred(), so the executor's one feed row records it. Three answers
(set/clear/unmeasurable); an unlistable registry defers too, and
deferExpired never reaches past it. ccd's rung 3 stays the authority
(spec §5.8's second reader).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: `POST /api/coord/reclaim-pause`, and every census it moves

**Model routing:** `sonnet`, effort `high` — one small route and six guards that each describe the door surface; every one of them must move in this commit or the census it pins goes stale green.

**Files:**
- Modify: `server/src/coord/routes.ts` — the import of `../ccdargv.js` (line 14); the route inserted DIRECTLY AFTER `POST /api/coord/pause`'s handler (its `});`, at planning line 2225) and before the `GET`/`POST /api/coord/caps` docstring
- Create: `server/test/child-reclaim-pause-route.test.ts`
- Modify: `server/test/coord-pause-route.test.ts` (`SESSION_ONLY`, line 214, and its docstring)
- Modify: `server/test/coordinator-skill.test.ts` (`EXEMPT`, after `'POST /api/coord/caps'`, line 350; one new case after `never names the caps dial`, line 1345)
- Modify: `server/test/auth-gate.test.ts` (the two exact counts and their comments, lines 217-282; the registrations list, line 303)
- Modify: `server/test/verb-gate.test.ts` (`CAP_GATED_VERBS`, line 87)
- Modify: `CLAUDE.md` (the box-token bullet's session-only sentence, at planning lines 230-235)

**Interfaces:**
- Consumes: `CCD_ARGV.reclaimPause`, `RECLAIM_PAUSE_CAP` (Task 3); `capSupported` (existing); `deps.runCcd` (existing).
- Produces: `POST /api/coord/reclaim-pause`, body `{ state: 'on' | 'off' }`. `400 {ok:false,error:'bad-request'}` on any other body; `501 {ok:false,error:'unsupported'}` when `!capSupported(deps.fleetState, RECLAIM_PAUSE_CAP)`; `502 {ok:false,stderr}` when the verb fails; `200 {ok:true,requested:'on'|'off'}` otherwise. `requested`, never `paused`: the authoritative answer is the next `{type:'coord'}` frame's `reclaim`. No box token, no `coordMutex`, no `notConfigured` arm. Task 9's client calls it.

- [ ] **Step 1: Write the failing tests**

(a) Create `server/test/child-reclaim-pause-route.test.ts`:

```ts
// `POST /api/coord/reclaim-pause` — the operator's door onto `$REG/reclaim-paused`
// (child-reclamation spec §5.8): the fleet-wide switch on the AUTOMATIC
// reclamation of child workspaces, toggled from the phone.
//
// `POST /api/coord/pause`'s shape in every respect but two, and both are
// deliberate. (1) It is SESSION_ONLY, not UNGATED: raising it releases no wedge,
// so it has no D-282 release-valve argument — it is an ordinary same-origin PWA
// write that no machine lane calls, and the fleet's shared secret is the wrong
// key for it. (2) Its skew gate is a CAPABILITY token read with `capSupported`
// (no evidence REFUSES), not `verbSupported`.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import type { Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { CCD_ARGV, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { isExecAllowed } from '../../agent/src/whitelist.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);

/** A fleet host that advertises the verb AND its token. */
const WITH_CAP = {
  connected: true, downSince: null, ccdVerbs: ['reclaim-pause', RECLAIM_PAUSE_CAP],
  rosterFp: null, build: null,
} satisfies NonNullable<Deps['fleetState']>;

const makeRunner = (fail = false): { run: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    if (fail && args[0] === 'reclaim-pause') return { code: 1, stdout: '', stderr: 'ccd: reclaim-pause refused on the box' };
    return { code: 0, stdout: args[0] === 'reclaim-pause' ? 'paused' : '', stderr: '' };
  };
  return { run, calls };
};

const openApp = async (run: Runner, over: Partial<Omit<Deps, 'cfg'>> = {}, withCoord = true) => {
  const home = mkTmp('ccrc-child-reclaim-pause-');
  const base = testDeps(home, run);
  const coord = withCoord ? new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))) : undefined;
  return buildServer({
    ...base, mailToken: TOKEN, fleetState: WITH_CAP, ...(coord ? { coord } : {}), ...over,
  });
};

const post = (app: FastifyInstance, body: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/coord/reclaim-pause', headers, payload: body as Record<string, unknown> });

const pauses = (calls: string[][]): string[][] => calls.filter((c) => c[0] === 'reclaim-pause');

describe('POST /api/coord/reclaim-pause', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it("runs reclaim-pause --state on for {state:'on'}, and off for 'off'", async () => {
    const { run, calls } = makeRunner();
    app = await openApp(run);
    const on = await post(app, { state: 'on' });
    expect(on.statusCode).toBe(200);
    expect(on.json()).toEqual({ ok: true, requested: 'on' });
    const off = await post(app, { state: 'off' });
    expect(off.statusCode).toBe(200);
    // `requested`, never `paused`: the route RAN a verb, it did not read the
    // marker. The authoritative answer is the next coord frame's `reclaim`.
    expect(off.json()).toEqual({ ok: true, requested: 'off' });
    expect(pauses(calls)).toEqual([['reclaim-pause', '--state', 'on'], ['reclaim-pause', '--state', 'off']]);
  });

  it('mints the argv AT THE CALL SITE, and the grant admits it', async () => {
    const { run, calls } = makeRunner();
    app = await openApp(run);
    await post(app, { state: 'on' });
    expect(pauses(calls)).toEqual([[...CCD_ARGV.reclaimPause('on')]]);
    expect(isExecAllowed('ccd', [...CCD_ARGV.reclaimPause('on')])).toBe(true);
    expect(isExecAllowed('ccd', [...CCD_ARGV.reclaimPause('off')])).toBe(true);
  });

  it('answers 501 when the fleet ccd advertises the VERB but not the TOKEN — capSupported, never verbSupported', async () => {
    const { run, calls } = makeRunner();
    app = await openApp(run, {
      fleetState: { connected: true, downSince: null, ccdVerbs: ['reclaim-pause'], rosterFp: null, build: null },
    });
    const res = await post(app, { state: 'on' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
    expect(pauses(calls), 'a 501 is a refusal: the verb never ran').toEqual([]);
  });

  it('answers 501 on NO evidence at all — the refusing default', async () => {
    // `verbSupported` would PERMIT here ("an absent list must never grey out
    // the fleet"); for a verb that never existed that is the wrong default.
    const { run, calls } = makeRunner();
    app = await openApp(run, { fleetState: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null } });
    expect((await post(app, { state: 'on' })).statusCode).toBe(501);
    expect(pauses(calls)).toEqual([]);
  });

  it("answers 502 with ccd's stderr when the verb fails on the box", async () => {
    const { run } = makeRunner(true);
    app = await openApp(run);
    const res = await post(app, { state: 'on' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, stderr: 'ccd: reclaim-pause refused on the box' });
  });

  it("answers 400 on a body that is not {state:'on'|'off'} — and runs nothing", async () => {
    const { run, calls } = makeRunner();
    app = await openApp(run);
    for (const body of [{}, { state: 'maybe' }, { state: true }, { state: null }, { paused: true }, { state: 'ON' }]) {
      const res = await post(app, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    }
    expect(pauses(calls)).toEqual([]);
  });

  it('answers WITHOUT the box token, and ignores a wrong one', async () => {
    const { run } = makeRunner();
    app = await openApp(run);
    expect((await post(app, { state: 'on' })).statusCode).toBe(200);
    expect((await post(app, { state: 'off' }, { 'x-ccrc-mail-token': 'a'.repeat(64) })).statusCode).toBe(200);
  });

  it('answers with NO coordination database: the switch is a fleet-host file, not a run', async () => {
    const { run, calls } = makeRunner();
    app = await openApp(run, {}, false);
    const res = await post(app, { state: 'on' });
    expect(res.statusCode).toBe(200);
    expect(pauses(calls)).toEqual([['reclaim-pause', '--state', 'on']]);
  });
});
```

(b) `server/test/auth-gate.test.ts` — the counts move with this route, and they are RED FIRST: change nothing yet. In the registrations list of `found the specific registrations this file reasons about`, add `'POST /api/coord/reclaim-pause',` directly after `'POST /api/coord/pause',`.

(c) `server/test/coordinator-skill.test.ts` — add, directly after the `never names the caps dial` case:

```ts
  it('never names the reclaim switch — a door that would tell a coordinator how to stop its own children being reclaimed', () => {
    // Child-reclamation wave 4, the caps dial's accounting: EXEMPT only
    // PERMITS the omission; this is what FORBIDS the mention. Rule 4 takes
    // the reclamation of a coordinator's children out of every session's
    // hands and gives it to the server; the one switch over that is the
    // operator's, from the phone.
    expect(allSkillText).not.toContain('/api/coord/reclaim-pause');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-pause-route.test.ts test/auth-gate.test.ts test/coordinator-skill.test.ts
```

Expected: `child-reclaim-pause-route` FAILS 8/8 — every inject answers `404` (the route does not exist); `auth-gate`'s `found the specific registrations` FAILS (`POST /api/coord/reclaim-pause was not found by the scanner`); `coordinator-skill`'s new case PASSES already (nothing names the route yet) — it is a guard for later edits, not red-first, and its mutation row below proves it bites.

- [ ] **Step 3: Write the route**

In `server/src/coord/routes.ts`, extend the `../ccdargv.js` import to `CCD_ARGV, RECLAIM_PAUSE_CAP, ROUTE_CAP, capSupported, verbSupported, sweepDec` (keep every existing member). Then insert, directly after `POST /api/coord/pause`'s closing `});` and before the `/** \`GET\`/\`POST /api/coord/caps\`` docstring:

```ts
  /** `POST /api/coord/reclaim-pause` — the operator's door onto
   *  `$REG/reclaim-paused` (child-reclamation spec §5.8), the fleet-wide switch
   *  on the AUTOMATIC reclamation of child workspaces. Body `{ state: 'on' |
   *  'off' }` — ccd's own vocabulary, passed through, rather than the pause
   *  route's boolean: there is no mapping here for a route to get wrong.
   *
   *  SESSION-GATED, AND NO BOX TOKEN — `coord-pause-route.test.ts`'s
   *  `SESSION_ONLY`, beside `/api/coord/caps`, and deliberately NOT `UNGATED`.
   *  The box token gates machine lanes; an operator toggling this from the phone
   *  is not one, and gating it on the fleet's shared secret would put it behind
   *  a key the phone does not hold. Nor is it a release valve: raising it
   *  releases no wedge, so the D-282 argument does not apply. Armed, it sits
   *  behind `auth/gate.ts` like every other PWA write. The coordinator skill is
   *  exempt from naming it AND forbidden from it (`coordinator-skill.test.ts`):
   *  a coordinator told about this door would be told how to stop or restart
   *  the reclamation of its own children.
   *
   *  THE SKEW GATE IS THE CAPABILITY TOKEN, read with `capSupported` — no
   *  evidence REFUSES. `verbSupported` would permit on an absent verb list and
   *  send `ccd reclaim-pause` to a box whose ccd answers a usage error, which
   *  the phone would render as a broken switch rather than an older fleet host.
   *
   *  NOT a guard on anything that deletes, and it says so: `ws-reclaim` reads
   *  the file on the box, inside its lock, at the instant of deletion, and that
   *  read is what makes the switch real. This route only moves the file.
   *
   *  No `coordMutex` (it writes no coordination row) and no `notConfigured` arm
   *  (a box with no coordination database can still carry the file) — the
   *  pause route's two reasons, unchanged. */
  app.post('/api/coord/reclaim-pause', async (req, reply) => {
    const body = (req.body ?? {}) as { state?: unknown };
    if (body.state !== 'on' && body.state !== 'off') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    if (!capSupported(deps.fleetState, RECLAIM_PAUSE_CAP)) {
      return reply.code(501).send({ ok: false, error: 'unsupported' });
    }
    const res = await deps.runCcd(CCD_ARGV.reclaimPause(body.state));
    if (!res.ok) return reply.code(502).send({ ok: false, stderr: res.stderr });
    // `requested`, never `paused`: the authoritative answer is the next
    // `{type:'coord'}` frame's `reclaim` field, and the toggle settles on that.
    return reply.code(200).send({ ok: true, requested: body.state });
  });
```

- [ ] **Step 4: Move every census the route moves**

(a) `server/test/coord-pause-route.test.ts`: `const SESSION_ONLY = new Set(['/api/coord/caps']);` becomes

```ts
  const SESSION_ONLY = new Set(['/api/coord/caps', '/api/coord/reclaim-pause']);
```

…and in `SESSION_ONLY`'s docstring, directly after the `/api/coord/caps` paragraph (`… Raising a cap releases no wedge.`), add:

```ts
   *  `/api/coord/reclaim-pause` (child-reclamation wave 4): the operator's
   *  switch on the automatic reclamation of child workspaces. Raising it
   *  releases no wedge either — it stops a deleting lane, which is an
   *  operator's act from the phone, not a machine lane's.
```

(b) `server/test/coordinator-skill.test.ts`, `EXEMPT`, directly after `'POST /api/coord/caps',`:

```ts
      // CHILD-RECLAMATION wave 4 — the operator-dial shape once more, and the
      // `POST /api/coord/pause` argument applied to the lane that deletes. A
      // coordinator told about this route would be told how to stop, or
      // restart, the reclamation of its OWN children — the act rule 4 takes out
      // of every session's hands. The forbid-mention case below is what turns
      // this permission-to-omit into a prohibition.
      'POST /api/coord/reclaim-pause',
```

(c) `server/test/verb-gate.test.ts`: `const CAP_GATED_VERBS: ReadonlySet<string> = new Set(['route']);` gains `'reclaim-pause'` — ADD the member to whatever the set holds after wave 3 (never rewrite it) — and the docstring above it gains one sentence after its `route` paragraph — phrased without an ordinal, because waves 1–3 may already have added members and a count in prose is a claim nothing re-measures:

```ts
 * `reclaim-pause` joins it (child-reclamation wave 4): its route gates on
 * `capSupported(deps.fleetState, RECLAIM_PAUSE_CAP)` alone, for the reason
 * above — a box that echoes the token necessarily dispatches the verb.
```

(d) `server/test/auth-gate.test.ts`: run it first and READ the two failing counts rather than typing them:

```bash
cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts -t 'EXACTLY the route count'
```

Expected: `expected 31 to be 30` (`coord/routes.ts`) — and, once that line is corrected and re-run, `expected 82 to be 81` (`ROUTES.length`). `scanRoutes('server.ts')` stays `51`. Write the measured values, each with its comment in the file's own style. Directly above `expect(scanRoutes('coord/routes.ts').length).toBe(31);`:

```ts
    // 31 since `POST /api/coord/reclaim-pause` (child-reclamation wave 4) — the
    // operator's switch on automatic child reclamation: `SESSION_ONLY` like the
    // caps dial, NOT EXEMPT, carrying no box token.
```

…and directly above `expect(ROUTES.length).toBe(82);`, as the last paragraph of that comment block:

```ts
    //
    // 82 since the same route: registered in `coord/routes.ts`, so that half
    // moved 30 -> 31 and `server.ts` stayed at 51 — 51 + 31 = 82. Its home is
    // not taste: in `server.ts` it would sit outside the literal
    // `coord-pause-route.test.ts`'s `SESSION_ONLY` census scans.
```

(e) `CLAUDE.md`, the box-token bullet. Replace the lines from `  its own argument — are the census, not this bullet.` through the line ending ``now checks this sentence against it in both directions (D-1231).`` (at planning lines 229–235; the bullet's closing `Don't assume — read the guards.` line stays) with (keep every backticked route on ONE line — `box-token-census.test.ts` flattens whitespace, but a path broken mid-token is a path it cannot read; and add NO upper-case count word — `coord-pause-route.test.ts` requires this bullet's only CAPS cardinal to be the ungated-door count):

```
  its own argument — are the census, not this bullet. What does need saying here are the
  coordination WRITES that carry no box token at all: `POST /api/sessions/:id/kickoff` (wave 4),
  `POST /api/coord/caps` (wave 6) and `POST /api/coord/reclaim-pause` (child-reclamation wave 4) are
  session-gated only — armed, they sit behind the auth gate like every other PWA-surface write. The first
  needs prose because no scanner can see it: `coord-pause-route.test.ts` reads
  `server/src/coord/routes.ts` alone, and that route is registered in `server.ts`, so a door opened outside
  that one file is invisible to the set that pins the doors. The other two are in that file's `SESSION_ONLY`
  set, and `box-token-census.test.ts` checks this sentence against it in both directions (D-1231).
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-pause-route.test.ts test/coord-pause-route.test.ts \
  test/coordinator-skill.test.ts test/auth-gate.test.ts test/verb-gate.test.ts test/box-token-census.test.ts \
  test/mail-routes.test.ts test/single-definition.test.ts
```

Expected: PASS — the route 8/8; `coord-pause-route`'s token-gate scan skips the new handler through `SESSION_ONLY`, and its `every SESSION_ONLY route really IS ungated, and really EXISTS` finds it; `coordinator-skill` finds it registered and exempt; `auth-gate` at 51/31/82, with the armed-gate sweep refusing the new route unauthenticated; `verb-gate` finds the call site gated by `capSupported`; `box-token-census` finds `/api/coord/reclaim-pause` named in CLAUDE.md's bullet and carrying no box token.

- [ ] **Step 6: Mutation check, then commit**

| # | Edit | Command | Expected red |
|---|---|---|---|
| 1 | Replace `capSupported(deps.fleetState, RECLAIM_PAUSE_CAP)` with `verbSupported(deps.fleetState, CCD_ARGV.reclaimPause(body.state))` | `cd server && ./node_modules/.bin/vitest run test/child-reclaim-pause-route.test.ts` | both 501 cases — the verb-present/token-absent box and the no-evidence box each answer `200` and run the verb |
| 2 | Remove `'/api/coord/reclaim-pause'` from `SESSION_ONLY` | `… test/coord-pause-route.test.ts` | *every app.post handler in coord/routes.ts checks the box token, except the named ones* — `expected [ '/api/coord/reclaim-pause' ] to deeply equal []` |
| 3 | Remove `POST /api/coord/reclaim-pause` from CLAUDE.md's bullet | `… test/box-token-census.test.ts` | *CLAUDE.md's box-token bullet is TRUE* — "does not name /api/coord/reclaim-pause — the class grew and the sentence did not" |
| 4 | Remove `'POST /api/coord/reclaim-pause'` from `EXEMPT` | `… test/coordinator-skill.test.ts` | *names every coordinator-domain route the server registers* — the route "is registered in coord/routes.ts but is named nowhere in the route corpus" |
| 5 | Append the line `` Never touch `POST /api/coord/reclaim-pause`. `` to `ccd/coordinator-skill/SKILL.md` | same | *never names the reclaim switch* — `expected '…' not to contain '/api/coord/reclaim-pause'` |
| 6 | Remove `'reclaim-pause'` from `CAP_GATED_VERBS` | `… test/verb-gate.test.ts` | *has no ungated call site outside UNGATED_BY_DECISION* — `coord/routes.ts:<n> reclaimPause (reclaim-pause)` |

```bash
git add server/src/coord/routes.ts server/test/child-reclaim-pause-route.test.ts server/test/coord-pause-route.test.ts \
        server/test/coordinator-skill.test.ts server/test/auth-gate.test.ts server/test/verb-gate.test.ts CLAUDE.md
git commit -m "$(cat <<'MSG'
feat(coord): POST /api/coord/reclaim-pause — the reclaim switch, from the phone

Session-gated with no box token (SESSION_ONLY beside the caps dial, not an
UNGATED release valve), registered beside the pause route so every door
census harvests it, gated on RECLAIM_PAUSE_CAP through capSupported. The
coordinator skill is exempt from naming it and forbidden from it. Moves
auth-gate's coord/routes.ts and whole-tree counts by one each, CLAUDE.md's
session-only sentence and verb-gate's CAP_GATED_VERBS (spec §5.8, §6).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: The sweep's decisions — one pure L1 file

**Model routing:** `sonnet`, effort `high` — the contract's routing (§6: implementation `sonnet`). Every verdict below is written out in full and pinned row by row; the judgment on it — this is the eligibility rule of the only path that asks for a deletion with no human in it, and every fail direction must be SHUT — is the mandatory `opus`/`xhigh` SAFETY lens's.

**Files:**
- Create: `server/src/childReclaimSweep.ts` (L1 — imports `shared/api.ts` only; beside `server/src/divergence.ts`, the precedent L1 file of this shape, and deliberately NOT under `server/src/coord/`, whose every single-quoted kebab literal `mail-routes.test.ts` requires to be a declared refusal code)
- Create: `server/test/child-reclaim-sweep-policy.test.ts`

**Interfaces:**
- Consumes: `ChildMark` (wave 2), `ChildReclaimAttention` (Task 4), `SPAWN_STALL_MS`, `TERMINAL_RUN_STATES`, `RunState`, `LifecycleAct`, `LifecycleOutcome`, `MirroredLifecycleEvent`, `lcRefusalWord` (all `shared/api.ts`).
- Produces (all exported from `server/src/childReclaimSweep.ts`):
  - `CHILD_RECLAIM_DEFER_CEILING_MS = 15 * 60_000` (the contract's server constant) — the presence ceiling, the cap on the failure backoff, and how long a run of failures lasts before it is listed.
  - `CHILD_RECLAIM_PRESENCE_DEFERS = ['presence', 'attached', 'tree-busy'] as const` — the presence-class defers (contract §8 R4′): wave 3's `ChildReclaimDeferWhy` members that measure presence; `deferExpired` skips exactly rungs 5 and 6 and the server's presence read.
  - `interface ChildReclaimSweepEntry { readonly firstEligibleAt: number; readonly firstDeferredAt: number | null; readonly firstPresenceDeferredAt: number | null; readonly consecutiveFailures: number; readonly lastFailedAt: number | null }` — the contract's in-memory state shape (§4) with contract §8 R4′'s second clock (`firstDeferredAt` is any deferral and is what `deferredSinceMs` carries; `firstPresenceDeferredAt` is presence-class only and alone drives the ceiling) and contract §8 R20's failure count (`lastFailedAt` is where the backoff is measured from). `childReclaimFirstSighting(nowMs: number): ChildReclaimSweepEntry` builds the first one.
  - `type ChildReclaimMintingRunRead`, `type ChildReclaimReviewedRunRead` (contract §7 R16: `{kind:'not-a-review'} | {kind:'run'; state: RunState} | {kind:'absent'} | {kind:'unreadable'; detail}` — the run a review child's minting run reviews), `type ChildReclaimSiblingsRead`, `interface ChildReclaimSweepInput` (with `reviewedRun: ChildReclaimReviewedRunRead`), `type ChildReclaimSweepSkip` (with `'review-report-live'` — the word wave 3's `childReclaimDecision` answers for the same condition — `'reviewed-run-absent'` and `'reviewed-run-unreadable'`; Task 8 logs `'reviewed-run-absent'` as it logs `'minting-run-absent'`, contract §8 R16′), `type ChildReclaimSweepVerdict`, `function childReclaimSweepVerdict(input: ChildReclaimSweepInput): ChildReclaimSweepVerdict`.
  - `type ChildReclaimSweepOutcome` (structural: wave 3's `ChildReclaimOutcome` is assignable to it — its `refused` member carries `token`) and `function childReclaimNextEntry(entry: ChildReclaimSweepEntry, outcome: ChildReclaimSweepOutcome, nowMs: number): ChildReclaimSweepEntry | null` (`null` = forget).
  - `function childReclaimDeferExpired(entry: ChildReclaimSweepEntry, nowMs: number): boolean` — reads `firstPresenceDeferredAt` ALONE.
  - `function childReclaimBackoffMs(consecutiveFailures: number, passIntervalMs: number): number` — `min(CHILD_RECLAIM_DEFER_CEILING_MS, passIntervalMs × 2^k)`, `0` with no failure (contract §8 R20); `function childReclaimBackoffOver(entry: ChildReclaimSweepEntry, nowMs: number, passIntervalMs: number): boolean`. The pass interval is an ARGUMENT: it is `watch.ts`'s `CHILD_RECLAIM_SWEEP_MS`, and L1 imports no L4 constant.
  - `interface ChildReclaimJournalRow { readonly sessionId: string; readonly outcome: string; readonly refusal: string | null; readonly at: number | null; readonly failingSince: number | null }` — the attention derivation's input row (declared by its consumer, L2 discipline): ONE generation's latest `reclaim` event, of any outcome, and — when that event is `failed` — the time the unbroken run of failures ending at it began. Both times are ccd's clock ALONE (contract §8 R22′): the row carries no `ingestedAt`, because nothing may read the server's clock as an event time (D8); `at` is null when the line carried none, and `failingSince` is the earliest failure of the run whose line carried an `at` (null when none did).
  - `function childReclaimJournalRow(generation: readonly MirroredLifecycleEvent[], latest: MirroredLifecycleEvent | null): ChildReclaimJournalRow | null`. Its inputs are always `childReclaimGeneration(events, at)`'s answer and `childReclaimLatest` of it (contract §7 R6, §8 R21; Task 8 creates both in `coord/childReclaim.ts`, which this L1 file cannot import), so this file never decides where a generation starts or which event is latest — the latter is passed IN, which is how the one rule stays one.
  - `type ChildReclaimTokenKind = 'gone' | 'terminal' | 'retry'` — the answer shape of the INJECTED `kindOf` lookup. This L1 file cannot import `coord/childReclaim.ts`, so it declares the shape and Task 8 injects wave 3's map through `childReclaimTokenKind`, the one total reader exported beside `CHILD_RECLAIM_TOKEN_KIND` (Task 8 Step 4).
  - `function childReclaimTerminalRefusal(row: ChildReclaimJournalRow, kindOf: (token: string) => ChildReclaimTokenKind | null): boolean` — the ONE reading of "this child is under a terminal refusal", shared by the attention list and the lane's terminal exclusion; `function childReclaimFailingPastCeiling(row: ChildReclaimJournalRow, nowMs: number): boolean`; `function childReclaimFailingSentence(word: string | null): string` — the server's sentence for a child listed for failing (contract §8 R20).
  - `interface ChildReclaimAttentionInput` (the mirror rows, the live registry map, the two lookups, the clock — and nothing else: contract §4 and §7 R5 derive the attention item from the lifecycle mirror ONLY, and every audit-time TERMINAL refusal reaches that mirror through wave 3's `verb ws-audit` line, Task 1 Step 3 fact 6) and `function childReclaimAttention(input: ChildReclaimAttentionInput): ChildReclaimAttention[]` — terminal refusals, and failures that have lasted the ceiling (contract §8 R20), of children whose registry row still exists and whose latest reclaim line ccd placed in time (a null `at` lists nothing, contract §8 R22′).

- [ ] **Step 1: Write the failing test**

Create `server/test/child-reclaim-sweep-policy.test.ts`:

```ts
// The child-reclaim sweep's DECISIONS, table-driven (child-reclamation spec
// §5.7 "On the sweep", as amended; §5.9). Pure: every input is an argument,
// the clock included, so each fail direction is one row with one answer.
//
// The rule these rows exist for is the amendment: "A minting run absent from
// the database makes a child ineligible, not eligible … a lost or rebuilt
// coordination database makes every child's run absent at once, the live ones
// included." Orphans are reached the OTHER way — through a minting run that
// names a different session — and never through absence.
import { describe, it, expect } from 'vitest';
import {
  CHILD_RECLAIM_DEFER_CEILING_MS, CHILD_RECLAIM_PRESENCE_DEFERS, childReclaimAttention, childReclaimBackoffMs,
  childReclaimBackoffOver, childReclaimDeferExpired, childReclaimFailingSentence, childReclaimFirstSighting,
  childReclaimJournalRow, childReclaimNextEntry, childReclaimSweepVerdict,
  type ChildReclaimJournalRow, type ChildReclaimSweepEntry, type ChildReclaimSweepInput,
  type ChildReclaimTokenKind,
} from '../src/childReclaimSweep.js';
import {
  LC_REFUSAL_WORD, SPAWN_STALL_MS, TERMINAL_RUN_STATES,
  type LifecycleAct, type LifecycleOutcome, type MirroredLifecycleEvent,
} from '../../shared/api.js';

const NOW = 1_790_000_000_000;
/** The lane's pass interval (`watch.ts`'s `CHILD_RECLAIM_SWEEP_MS`) — an
 *  ARGUMENT to the backoff, because this L1 file imports no L4 constant. */
const PASS = 60_000;
const C = CHILD_RECLAIM_DEFER_CEILING_MS;

/** A child that is eligible on every count: minted by run 7, which is
 *  terminal, with nothing open on it. Each case below breaks ONE thing. */
const base = (over: Partial<ChildReclaimSweepInput> = {}): ChildReclaimSweepInput => ({
  sessionId: 'demo-a',
  child: { kind: 'child', runId: 7 },
  identityMeasured: true,
  held: null,
  terminal: false,
  mintingRun: { ok: true, run: { state: 'done', sessionId: 'demo-a', dispatchStartedAt: NOW - 3_600_000 } },
  // A WORK run's child: its minting run reviews nothing (spec §5.7).
  reviewedRun: { kind: 'not-a-review' },
  siblings: { ok: true, open: 0 },
  nowMs: NOW,
  ...over,
});

const skip = (over: Partial<ChildReclaimSweepInput>) => childReclaimSweepVerdict(base(over));

describe('childReclaimSweepVerdict', () => {
  it('a child of a finished run with nothing open on it is eligible, carrying the MARKER\'s run id', () => {
    expect(childReclaimSweepVerdict(base())).toEqual({ eligible: true, runId: 7 });
    expect(skip({ mintingRun: { ok: true, run: { state: 'failed', sessionId: 'demo-a', dispatchStartedAt: null } } }))
      .toEqual({ eligible: true, runId: 7 });
  });

  it('a row with no marker is not a child — and nothing is inferred from anything else', () => {
    expect(skip({ child: { kind: 'none' } })).toEqual({ eligible: false, why: 'not-a-child' });
  });

  it('an unreadable marker DEFERS — it is never read as "a child" or as "not a child"', () => {
    expect(skip({ child: { kind: 'unreadable' } })).toEqual({ eligible: false, why: 'marker-unreadable' });
    // …and it wins over every other fact, because nothing else can be trusted
    // about a row whose child-ness is unknown.
    expect(skip({ child: { kind: 'unreadable' }, held: 'x' })).toEqual({ eligible: false, why: 'marker-unreadable' });
  });

  it('a row whose identity this read did not measure is skipped', () => {
    expect(skip({ identityMeasured: false })).toEqual({ eligible: false, why: 'identity-unmeasured' });
  });

  it('a held child is never eligible — a hold claims the workspace, whatever the reason reads', () => {
    expect(skip({ held: 'program:demo wave:2/3 run:8' })).toEqual({ eligible: false, why: 'held' });
  });

  it('a child under a terminal refusal is not retried — it is on the attention list instead', () => {
    expect(skip({ terminal: true })).toEqual({ eligible: false, why: 'terminal-refusal' });
  });

  it('an unreadable minting run is skipped, never read as absent or terminal', () => {
    expect(skip({ mintingRun: { ok: false, detail: 'run-unreadable' } }))
      .toEqual({ eligible: false, why: 'minting-run-unreadable' });
  });

  it('a minting run ABSENT from the database is NEVER eligible — the amended rule', () => {
    expect(skip({ mintingRun: { ok: true, run: null } })).toEqual({ eligible: false, why: 'minting-run-absent' });
  });

  it('a lost database makes EVERY child absent at once, and not one of them is eligible', () => {
    const verdicts = ['demo-a', 'demo-b', 'demo-c'].map((sessionId, i) =>
      childReclaimSweepVerdict(base({ sessionId, child: { kind: 'child', runId: 900 + i }, mintingRun: { ok: true, run: null } })));
    expect(verdicts.filter((v) => v.eligible)).toEqual([]);
  });

  it('a live minting run that names THIS child, or no session at all, keeps it', () => {
    for (const state of ['planned', 'dispatched', 'working', 'awaiting-review', 'merging', 'closing', 'unknown'] as const) {
      expect(skip({ mintingRun: { ok: true, run: { state, sessionId: 'demo-a', dispatchStartedAt: NOW - 3_600_000 } } }),
        state).toEqual({ eligible: false, why: 'minting-run-open' });
      expect(skip({ mintingRun: { ok: true, run: { state, sessionId: null, dispatchStartedAt: NOW - 3_600_000 } } }),
        `${state}, no session`).toEqual({ eligible: false, why: 'minting-run-open' });
    }
  });

  it('an ORPHAN — its live minting run names a DIFFERENT session — is eligible', () => {
    // Dispatch's two arms that mint a child and fail to bind it: the run was
    // re-dispatched and names the child that DID get bound.
    expect(skip({ mintingRun: { ok: true, run: { state: 'working', sessionId: 'demo-b', dispatchStartedAt: NOW - 3_600_000 } } }))
      .toEqual({ eligible: true, runId: 7 });
  });

  it('…except inside the spawn-stall window of a planned run, where the dispatch may still be binding', () => {
    const planned = (dispatchStartedAt: number | null) =>
      skip({ mintingRun: { ok: true, run: { state: 'planned', sessionId: 'demo-b', dispatchStartedAt } } });
    expect(planned(NOW - 1_000)).toEqual({ eligible: false, why: 'dispatch-in-flight' });
    expect(planned(NOW - SPAWN_STALL_MS + 1)).toEqual({ eligible: false, why: 'dispatch-in-flight' });
    // The boundary is exclusive of the window: at exactly SPAWN_STALL_MS the
    // dispatch reads as stalled, which is what the field's own docstring names it.
    expect(planned(NOW - SPAWN_STALL_MS)).toEqual({ eligible: true, runId: 7 });
    // A planned run naming another session with NO dispatch stamp is not a
    // shape the fleet produces; if it appears, it is doubt, and doubt waits.
    expect(planned(null)).toEqual({ eligible: false, why: 'dispatch-in-flight' });
  });

  it('an unreadable sibling list is INELIGIBLE, never "none"', () => {
    expect(skip({ siblings: { ok: false, detail: 'run-unreadable' } })).toEqual({ eligible: false, why: 'siblings-unreadable' });
  });

  it('an open run naming the child keeps it', () => {
    expect(skip({ siblings: { ok: true, open: 1 } })).toEqual({ eligible: false, why: 'siblings-open' });
  });

  // SPEC §5.7 — a REVIEW child lives until the run it reviewed is
  // terminal: the reviewer's report stays in its clips, and the coordinator
  // cites that path in fix-round mail for as long as the reviewed work is open.
  it('a REVIEW child is kept while the run it reviewed is not terminal — its report is still cited', () => {
    for (const state of ['planned', 'dispatched', 'working', 'awaiting-review', 'merging', 'closing', 'unknown'] as const) {
      expect(skip({ reviewedRun: { kind: 'run', state } }), state)
        .toEqual({ eligible: false, why: 'review-report-live' });
    }
  });

  it('…and is reclaimed like any other child once the reviewed run is terminal', () => {
    for (const state of TERMINAL_RUN_STATES) {
      expect(skip({ reviewedRun: { kind: 'run', state } }), state).toEqual({ eligible: true, runId: 7 });
    }
  });

  it('a reviewed run that is absent or unreadable keeps the review child — doubt waits', () => {
    expect(skip({ reviewedRun: { kind: 'absent' } })).toEqual({ eligible: false, why: 'reviewed-run-absent' });
    expect(skip({ reviewedRun: { kind: 'unreadable', detail: 'run-unreadable' } }))
      .toEqual({ eligible: false, why: 'reviewed-run-unreadable' });
  });

  it('an ORPHANED review child is kept too, while its reviewed run is open', () => {
    // The orphan branch (a live minting run naming a different session) is
    // not a way round the review rule.
    expect(skip({
      mintingRun: { ok: true, run: { state: 'working', sessionId: 'demo-b', dispatchStartedAt: NOW - 3_600_000 } },
      reviewedRun: { kind: 'run', state: 'awaiting-review' },
    })).toEqual({ eligible: false, why: 'review-report-live' });
  });
});

describe('the twice-observed memory, its two clocks, and the failure backoff', () => {
  const entry: ChildReclaimSweepEntry = childReclaimFirstSighting(NOW - 60_000);

  it('a first sighting starts no clock and counts no failure', () => {
    expect(entry).toEqual({ firstEligibleAt: NOW - 60_000, firstDeferredAt: null, firstPresenceDeferredAt: null,
      consecutiveFailures: 0, lastFailedAt: null });
  });

  it('forgets a child whose reclaim ended — reclaimed, gone or terminally refused', () => {
    expect(childReclaimNextEntry(entry, { kind: 'reclaimed' }, NOW)).toBeNull();
    expect(childReclaimNextEntry(entry, { kind: 'gone' }, NOW)).toBeNull();
    expect(childReclaimNextEntry(entry, { kind: 'refused', token: 'tree-unreadable' }, NOW)).toBeNull();
  });

  it('counts a failed attempt and stamps when it was asked — both clocks untouched', () => {
    const once = childReclaimNextEntry(entry, { kind: 'failed' }, NOW);
    expect(once).toEqual({ ...entry, consecutiveFailures: 1, lastFailedAt: NOW });
    expect(childReclaimNextEntry(once!, { kind: 'failed' }, NOW + 120_000))
      .toEqual({ ...entry, consecutiveFailures: 2, lastFailedAt: NOW + 120_000 });
  });

  it('any deferral ends a run of failures — a defer is not a failure', () => {
    const failing: ChildReclaimSweepEntry = { ...entry, consecutiveFailures: 3, lastFailedAt: NOW - 1 };
    expect(childReclaimNextEntry(failing, { kind: 'deferred', why: 'held' }, NOW))
      .toMatchObject({ consecutiveFailures: 0, lastFailedAt: null });
  });

  it('a PRESENCE defer starts BOTH clocks, once, and never restarts either', () => {
    for (const why of CHILD_RECLAIM_PRESENCE_DEFERS) {
      const first = childReclaimNextEntry(entry, { kind: 'deferred', why }, NOW);
      expect(first, why).toEqual({ ...entry, firstDeferredAt: NOW, firstPresenceDeferredAt: NOW });
      expect(childReclaimNextEntry(first!, { kind: 'deferred', why }, NOW + 60_000), why).toEqual(first);
    }
  });

  it('a defer that is not presence starts the ANY-kind clock, and never the presence clock', () => {
    for (const why of ['state-changed', 'paused', 'held', 'in-progress', 'reap-in-progress', 'siblings-open',
      'unsupported', 'paused-at-server']) {
      expect(childReclaimNextEntry(entry, { kind: 'deferred', why }, NOW), why)
        .toEqual({ ...entry, firstDeferredAt: NOW, firstPresenceDeferredAt: null });
    }
  });

  it('a presence defer AFTER another kind keeps the earlier any-kind clock and starts its own', () => {
    const other = childReclaimNextEntry(entry, { kind: 'deferred', why: 'state-changed' }, NOW)!;
    expect(childReclaimNextEntry(other, { kind: 'deferred', why: 'attached' }, NOW + 60_000))
      .toEqual({ ...entry, firstDeferredAt: NOW, firstPresenceDeferredAt: NOW + 60_000 });
  });

  it('names exactly the three presence defers — rungs 5 and 6 and the server\'s visibility claim', () => {
    expect([...CHILD_RECLAIM_PRESENCE_DEFERS]).toEqual(['presence', 'attached', 'tree-busy']);
  });

  it('the ceiling is fifteen minutes, reached at exactly fifteen — on the PRESENCE clock alone', () => {
    // A HARDCODED literal on purpose — the mutation control for the constant.
    expect(CHILD_RECLAIM_DEFER_CEILING_MS).toBe(900_000);
    const presence: ChildReclaimSweepEntry = { ...entry, firstDeferredAt: NOW - 10 * C, firstPresenceDeferredAt: NOW };
    expect(childReclaimDeferExpired(entry, NOW + 10 * C)).toBe(false);
    // An any-kind deferral ten ceilings old expires nothing: only presence is bounded.
    expect(childReclaimDeferExpired({ ...entry, firstDeferredAt: NOW - 10 * C }, NOW)).toBe(false);
    expect(childReclaimDeferExpired(presence, NOW + C - 1)).toBe(false);
    expect(childReclaimDeferExpired(presence, NOW + C)).toBe(true);
  });

  it('backs off min(ceiling, pass interval × 2^k) after k failures in a row — and not at all with none', () => {
    expect([0, 1, 2, 3, 4, 40].map((k) => childReclaimBackoffMs(k, PASS)))
      .toEqual([0, 120_000, 240_000, 480_000, 900_000, 900_000]);
  });

  it('a backed-off child waits until exactly its backoff has passed; a child with no failure never waits', () => {
    const failed: ChildReclaimSweepEntry = { ...entry, consecutiveFailures: 1, lastFailedAt: NOW };
    expect(childReclaimBackoffOver(entry, NOW, PASS)).toBe(true);
    expect(childReclaimBackoffOver(failed, NOW + 119_999, PASS)).toBe(false);
    expect(childReclaimBackoffOver(failed, NOW + 120_000, PASS)).toBe(true);
  });
});

/** One mirrored journal row of session `demo-a` — every field
 *  `MirroredLifecycleEvent` carries, so the literal is the type's, not a cast. */
const ev = (act: LifecycleAct, outcome: LifecycleOutcome, over: Partial<MirroredLifecycleEvent> = {}):
  MirroredLifecycleEvent => ({
  uid: null, at: NOW, act, badact: null, outcome, badoutcome: null, id: 'demo-a', tx: null,
  verb: act === 'create' ? 'ws-add' : 'ws-reclaim', refusal: null, detail: null, truncated: false,
  obs: null, dec: null, meas: null, raw: '', gen: '1', ingestedAt: NOW + 5, ...over,
});

describe('childReclaimJournalRow — one generation\'s latest reclaim event, as the attention input row', () => {
  it('null when the generation has no latest reclaim event', () => {
    expect(childReclaimJournalRow([ev('create', 'done')], null)).toBeNull();
  });

  it('carries a refusal as it is, with no failure run', () => {
    const gen = [ev('create', 'done'), ev('reclaim', 'refused', { refusal: 'tree-unreadable' })];
    // `toEqual`, so the row's WHOLE shape is pinned: it carries no `ingestedAt`.
    expect(childReclaimJournalRow(gen, gen[1]!)).toEqual({ sessionId: 'demo-a', outcome: 'refused',
      refusal: 'tree-unreadable', at: NOW, failingSince: null });
  });

  it('carries an INTENT when the intent is the latest — the latest event decides, whatever its outcome', () => {
    const gen = [ev('reclaim', 'refused', { refusal: 'tree-unreadable' }), ev('reclaim', 'intent', { at: NOW + 1 })];
    expect(childReclaimJournalRow(gen, gen[1]!)).toMatchObject({ outcome: 'intent', refusal: null, failingSince: null });
  });

  it('a latest FAILURE carries when its unbroken run of failures began — intents and other acts do not break it', () => {
    const gen = [
      ev('reclaim', 'intent', { at: NOW }), ev('reclaim', 'failed', { at: NOW + 1, refusal: 'pin-failed' }),
      ev('reclaim', 'intent', { at: NOW + 2 }), ev('hold', 'done', { at: NOW + 3 }),
      ev('reclaim', 'failed', { at: NOW + 4, refusal: 'unit-still-active' }),
    ];
    expect(childReclaimJournalRow(gen, gen[4]!))
      .toMatchObject({ outcome: 'failed', refusal: 'unit-still-active', failingSince: NOW + 1 });
  });

  it('any other reclaim outcome ends the run: only the failures after it count', () => {
    const gen = [
      ev('reclaim', 'failed', { at: NOW, refusal: 'pin-failed' }), ev('reclaim', 'refused', { at: NOW + 1, refusal: 'attached' }),
      ev('reclaim', 'failed', { at: NOW + 2, refusal: 'pin-failed' }),
    ];
    expect(childReclaimJournalRow(gen, gen[2]!)).toMatchObject({ failingSince: NOW + 2 });
  });

  // `ingestedAt` is the server's clock and never an event time (D8): a
  // failure line with no `at` cannot be placed, so it starts no failure clock
  // — it is read past, and the run's clock is its earliest PLACED failure.
  it('a failure with no ccd clock starts no failure clock — never placed by its ingest time', () => {
    const lone = [ev('reclaim', 'failed', { at: null, ingestedAt: NOW + 7, refusal: 'pin-failed' })];
    expect(childReclaimJournalRow(lone, lone[0]!)).toMatchObject({ at: null, failingSince: null });
    const run = [
      ev('reclaim', 'failed', { at: null, ingestedAt: NOW + 1, refusal: 'pin-failed' }),
      ev('reclaim', 'failed', { at: NOW + 4, refusal: 'pin-failed' }),
    ];
    expect(childReclaimJournalRow(run, run[1]!)).toMatchObject({ at: NOW + 4, failingSince: NOW + 4 });
  });
});

const KIND: Record<string, ChildReclaimTokenKind> = {
  'tree-unreadable': 'terminal', 'containment-unproven': 'terminal', attached: 'retry', 'no-such-session': 'gone',
};
const kindOf = (t: string): ChildReclaimTokenKind | null => KIND[t] ?? null;

describe('childReclaimAttention', () => {
  // The mirror rows and the live registry map are the WHOLE input (spec §5.9:
  // "derived from the lifecycle mirror so a restart does not lose it"): there
  // is no in-memory source to merge, so a restart loses nothing.
  const input = (latest: ChildReclaimJournalRow[], live: [string, number | null][], nowMs = NOW) => ({
    latest,
    live: new Map(live),
    kindOf,
    sentenceFor: (t: string): string => `sentence for ${t}`,
    nowMs,
  });
  const row = (over: Partial<ChildReclaimJournalRow> = {}): ChildReclaimJournalRow => ({
    sessionId: 'demo-a', outcome: 'refused', refusal: 'tree-unreadable', at: NOW, failingSince: null, ...over,
  });

  it('reports a terminal refusal of a child whose registry row still exists, with the SERVER\'s sentence', () => {
    expect(childReclaimAttention(input([row()], [['demo-a', 7]]))).toEqual([
      { sessionId: 'demo-a', runId: 7, token: 'tree-unreadable', sentence: 'sentence for tree-unreadable', at: NOW },
    ]);
  });

  it('drops a child whose registry row is gone — reclaimed since, or reaped', () => {
    expect(childReclaimAttention(input([row()], [['demo-b', 9]]))).toEqual([]);
    expect(childReclaimAttention(input([row({ outcome: 'failed', failingSince: NOW - C })], [['demo-b', 9]])))
      .toEqual([]);
  });

  it('drops a retryable refusal, a gone token, and a token this build does not know', () => {
    expect(childReclaimAttention(input([
      row({ refusal: 'attached' }), row({ sessionId: 'demo-b', refusal: 'no-such-session' }),
      row({ sessionId: 'demo-c', refusal: 'from-a-newer-ccd' }),
    ], [['demo-a', 7], ['demo-b', 8], ['demo-c', 9]]))).toEqual([]);
  });

  it('drops an outcome that is neither a refusal nor a failure — an INTENT above all — and a refusal row with no token', () => {
    expect(childReclaimAttention(input([
      row({ outcome: 'done', refusal: null }), row({ sessionId: 'demo-b', outcome: 'intent', refusal: null }),
      row({ sessionId: 'demo-c', refusal: null }),
    ], [['demo-a', 7], ['demo-b', 8], ['demo-c', 9]]))).toEqual([]);
  });

  it('carries a null run id when the marker no longer reads as a child', () => {
    expect(childReclaimAttention(input([row()], [['demo-a', null]]))).toEqual([
      { sessionId: 'demo-a', runId: null, token: 'tree-unreadable', sentence: 'sentence for tree-unreadable', at: NOW },
    ]);
  });

  // Only ccd's own `at` places a line in time; the mirror's ingest time is the
  // server's clock and never an event time (D8). A latest line with no `at`
  // cannot say since when, so it is not listed — a terminal refusal, or a
  // failure whose run ccd DID place (`failingSince` is set) alike.
  it('never lists a child whose latest line carried no ccd clock — a terminal refusal or a failure past the ceiling', () => {
    expect(childReclaimAttention(input([
      row({ at: null }),
      row({ sessionId: 'demo-b', outcome: 'failed', refusal: 'purge-refused', at: null, failingSince: NOW - C }),
    ], [['demo-a', 7], ['demo-b', 8]]))).toEqual([]);
  });

  // Spec §5.9: "children whose reclaim has kept failing past the defer
  // ceiling (retries back off in between), with each one's sentence".
  it('lists a child whose reclaim has kept FAILING for the whole ceiling, with the failure\'s sentence and since when', () => {
    const since = NOW - C;
    expect(childReclaimAttention(input([row({ outcome: 'failed', refusal: 'purge-refused', failingSince: since })],
      [['demo-a', 7]]))).toEqual([{ sessionId: 'demo-a', runId: 7, token: 'purge-refused',
      sentence: childReclaimFailingSentence(LC_REFUSAL_WORD['purge-refused']), at: since }]);
  });

  it('…not one millisecond before the ceiling, and never a failure row that carries no run start', () => {
    expect(childReclaimAttention(input([
      row({ outcome: 'failed', refusal: 'purge-refused', failingSince: NOW - C + 1 }),
      row({ sessionId: 'demo-b', outcome: 'failed', refusal: 'purge-refused', failingSince: null }),
    ], [['demo-a', 7], ['demo-b', 8]]))).toEqual([]);
  });

  it('a failure word outside the journal-only map takes the server\'s sentence; no word at all says so', () => {
    const since = NOW - C;
    expect(childReclaimAttention(input([
      row({ outcome: 'failed', refusal: 'branch-moved', failingSince: since }),
      row({ sessionId: 'demo-b', outcome: 'failed', refusal: null, failingSince: since }),
    ], [['demo-a', 7], ['demo-b', 8]])).map((a) => [a.token, a.sentence])).toEqual([
      ['branch-moved', childReclaimFailingSentence('sentence for branch-moved')],
      ['', childReclaimFailingSentence(null)],
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep-policy.test.ts`

Expected: FAIL at collection — `Failed to load url ../src/childReclaimSweep.js` (the module does not exist); every case unrun.

- [ ] **Step 3: Write the policy**

Create `server/src/childReclaimSweep.ts`:

```ts
// The child-reclaim sweep's DECISIONS (child-reclamation spec §5.7 "On the
// sweep" as amended, §5.9's attention item). L1: pure, clock-free (the clock
// is an argument), `fs`-free and fastify-free — `divergence.ts`'s shape. It
// imports L0 alone. `watch.ts`'s `sweepChildReclaim` (L4) GATHERS the evidence
// and APPLIES these verdicts; nothing in this file reads a file, a row or a
// clock, which is what lets every fail direction below be one test row.
//
// EVERY UNCERTAIN ANSWER IS "NOT THIS PASS". The path these verdicts feed asks
// for a deletion with no human in it. Nothing here can make a child eligible
// that the evidence does not positively make eligible, and the executor that
// follows (wave 3's `reclaimChild`) re-reads, and ccd re-proves inside its lock
// at the instant of deletion — this file narrows the window, it does not close it.
import {
  SPAWN_STALL_MS, TERMINAL_RUN_STATES, lcRefusalWord,
  type ChildMark, type ChildReclaimAttention, type LifecycleAct, type LifecycleOutcome,
  type MirroredLifecycleEvent, type RunState,
} from '../../shared/api.js';

/** How long a presence defer may continue before the reclaim proceeds past it
 *  (spec §5.7, "Presence, and its bound"). Unbounded would be worse than
 *  absent: the PWA's terminal drawer opens a real `tmux attach`, so a phone
 *  that locks with the drawer open would wedge a child forever, and the only
 *  exit would be a human detaching from a sub-workspace — rule 4 inverted by
 *  its own safeguard. The same span caps the failure backoff and is how long
 *  a run of failures lasts before the child is listed (spec §5.9: "kept
 *  failing past the defer ceiling"). */
export const CHILD_RECLAIM_DEFER_CEILING_MS = 15 * 60_000;

/** The defers the ceiling bounds: the server's per-session visibility claim
 *  (`presence`) and ccd's rungs 5 (`attached`) and 6 (`tree-busy`) — exactly
 *  what `deferExpired` skips. Every other defer (`paused`, `held`,
 *  `state-changed`, …) is a condition the ceiling must never override, so it
 *  starts the any-kind clock only, never the presence clock. */
export const CHILD_RECLAIM_PRESENCE_DEFERS = ['presence', 'attached', 'tree-busy'] as const;

/** The sweep's memory of one marked child. IN MEMORY ONLY: a restart loses
 *  it, and losing it can only DELAY a reclaim, or retry a failing one sooner —
 *  never cause one. TWO deferral clocks, never folded into one, because they
 *  answer two questions: how long has this child been waiting (any deferral —
 *  spec §5.9 shows a deferral "with its elapsed time"), and how long has a
 *  PRESENCE kept it (the only thing the 15-minute ceiling bounds — spec §5.7,
 *  "Presence, and its bound"). A single clock would either let a `held` or a
 *  `state-changed` deferral expire presence, or leave every non-presence
 *  deferral's feed row with no wait to state. */
export interface ChildReclaimSweepEntry {
  readonly firstEligibleAt: number;
  /** The FIRST deferral of ANY kind the sweep saw — what each request carries
   *  as `deferredSinceMs`. */
  readonly firstDeferredAt: number | null;
  /** The first PRESENCE-class deferral (`CHILD_RECLAIM_PRESENCE_DEFERS`) — the
   *  only clock `childReclaimDeferExpired` reads. */
  readonly firstPresenceDeferredAt: number | null;
  /** `failed` outcomes in a row (spec §5.9: "retries back off in between");
   *  any other outcome ends the run. */
  readonly consecutiveFailures: number;
  /** The pass time of the last failed attempt — the backoff's origin. */
  readonly lastFailedAt: number | null;
}

/** A child seen eligible for the first time: no clock, no failure. */
export const childReclaimFirstSighting = (nowMs: number): ChildReclaimSweepEntry => ({
  firstEligibleAt: nowMs, firstDeferredAt: null, firstPresenceDeferredAt: null,
  consecutiveFailures: 0, lastFailedAt: null,
});

/** The minting run as the store answered: a row, no row, or a row this process
 *  could not represent — three answers, never folded. */
export type ChildReclaimMintingRunRead =
  | { readonly ok: true; readonly run: {
      readonly state: RunState; readonly sessionId: string | null; readonly dispatchStartedAt: number | null;
    } | null }
  | { readonly ok: false; readonly detail: string };

/** The run a REVIEW child's minting run reviews (`runs.reviews`), as the
 *  store answered (spec §5.7, "A review child is finished later than its own
 *  run"). `not-a-review` is the minting run's own
 *  answer ("reviews nothing", a work run), never a failed read; `absent` and
 *  `unreadable` are the two answers that are not a run, never folded. */
export type ChildReclaimReviewedRunRead =
  | { readonly kind: 'not-a-review' }
  | { readonly kind: 'run'; readonly state: RunState }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** The open runs naming this child, counted — or unreadable. */
export type ChildReclaimSiblingsRead =
  | { readonly ok: true; readonly open: number }
  | { readonly ok: false; readonly detail: string };

export interface ChildReclaimSweepInput {
  /** The registry row's id — the child's session id. */
  readonly sessionId: string;
  /** The registry's three-way reading of `$REG/<id>.child` (wave 2). */
  readonly child: ChildMark;
  /** False when this read could not measure the row's identity triple. */
  readonly identityMeasured: boolean;
  /** `SessionRecord.held`: non-null is held, an unreadable hold included. */
  readonly held: string | null;
  /** The child's latest reclaim outcome is a TERMINAL refusal. */
  readonly terminal: boolean;
  readonly mintingRun: ChildReclaimMintingRunRead;
  /** Read only when the minting run is a review run; `not-a-review` otherwise. */
  readonly reviewedRun: ChildReclaimReviewedRunRead;
  readonly siblings: ChildReclaimSiblingsRead;
  readonly nowMs: number;
}

export type ChildReclaimSweepSkip =
  | 'not-a-child' | 'marker-unreadable' | 'identity-unmeasured' | 'held' | 'terminal-refusal'
  | 'minting-run-unreadable' | 'minting-run-absent' | 'minting-run-open' | 'dispatch-in-flight'
  | 'review-report-live' | 'reviewed-run-absent' | 'reviewed-run-unreadable'
  | 'siblings-unreadable' | 'siblings-open';

export type ChildReclaimSweepVerdict =
  | { readonly eligible: true; readonly runId: number }
  | { readonly eligible: false; readonly why: ChildReclaimSweepSkip };

const TERMINAL_STATES: readonly string[] = TERMINAL_RUN_STATES;

/** Is this marked child eligible THIS pass? (The twice-observed rule is the
 *  caller's: this answers one pass.) The order is the order of trust — a row
 *  whose child-ness is unknown says nothing else trustworthy. */
export function childReclaimSweepVerdict(i: ChildReclaimSweepInput): ChildReclaimSweepVerdict {
  if (i.child.kind === 'none') return { eligible: false, why: 'not-a-child' };
  if (i.child.kind === 'unreadable') return { eligible: false, why: 'marker-unreadable' };
  if (!i.identityMeasured) return { eligible: false, why: 'identity-unmeasured' };
  if (i.held !== null) return { eligible: false, why: 'held' };
  if (i.terminal) return { eligible: false, why: 'terminal-refusal' };
  if (!i.mintingRun.ok) return { eligible: false, why: 'minting-run-unreadable' };
  const run = i.mintingRun.run;
  // THE AMENDED RULE. An absent minting run is NEVER eligible: a lost or
  // rebuilt coordination database makes every child's run absent at once, the
  // live ones included. The orphans the first draft reached through absence
  // are reached through the branch below instead.
  if (run === null) return { eligible: false, why: 'minting-run-absent' };
  if (!TERMINAL_STATES.includes(run.state)) {
    // A live minting run keeps its child unless it provably moved on to a
    // DIFFERENT one — which is what a re-dispatched run that bound the child it
    // did get looks like. Naming this child, or no session, keeps it.
    if (run.sessionId === null || run.sessionId === i.sessionId) {
      return { eligible: false, why: 'minting-run-open' };
    }
    // …and a planned run inside the spawn-stall window may still be binding.
    // A missing stamp is doubt, and doubt waits.
    if (run.state === 'planned'
        && (run.dispatchStartedAt === null || i.nowMs - run.dispatchStartedAt < SPAWN_STALL_MS)) {
      return { eligible: false, why: 'dispatch-in-flight' };
    }
  }
  // A REVIEW child (spec §5.7, "A review child is finished
  // later than its own run"): the reviewer's report lives in this child's
  // clips and the coordinator cites its path in fix-round mail, so the child
  // is kept while the run it reviewed is not terminal — the orphan branch
  // above included. `review-report-live` is wave 3's `childReclaimDecision`
  // word for the same condition. Absent or unreadable is doubt, and doubt waits.
  switch (i.reviewedRun.kind) {
    case 'not-a-review': break;
    case 'absent': return { eligible: false, why: 'reviewed-run-absent' };
    case 'unreadable': return { eligible: false, why: 'reviewed-run-unreadable' };
    case 'run':
      if (!TERMINAL_STATES.includes(i.reviewedRun.state)) return { eligible: false, why: 'review-report-live' };
      break;
  }
  if (!i.siblings.ok) return { eligible: false, why: 'siblings-unreadable' };
  if (i.siblings.open > 0) return { eligible: false, why: 'siblings-open' };
  return { eligible: true, runId: i.child.runId };
}

/** The executor's outcome, as far as this memory needs it. STRUCTURAL:
 *  wave 3's `ChildReclaimOutcome` is assignable to it without this file
 *  importing `coord/childReclaim.ts` (an L3/L4 module). */
export type ChildReclaimSweepOutcome =
  | { readonly kind: 'reclaimed' | 'gone' | 'failed' }
  | { readonly kind: 'refused'; readonly token: string }
  | { readonly kind: 'deferred'; readonly why: string };

/** The memory after one attempt. `null` = forget the child's entry: its
 *  reclaim ENDED (reclaimed, already gone, or refused — a terminal refusal is
 *  then held by the lifecycle mirror, which keeps it off the lane and on the
 *  attention list: ccd journals it whichever verb found it, `ws-reclaim` or the
 *  `ws-audit --reclaim` that precedes it, and the mirror ingests it within
 *  `LC_SWEEP_MS` — long before forgetting lets the child read eligible on two
 *  fresh passes again). A FAILURE counts one more in the run and stamps when
 *  it was asked, clocks untouched. A DEFERRAL ends any run of failures, starts
 *  the any-kind clock once, and — if it is presence — the presence clock
 *  once; neither clock ever restarts while the entry lives. */
export function childReclaimNextEntry(
  entry: ChildReclaimSweepEntry, outcome: ChildReclaimSweepOutcome, nowMs: number,
): ChildReclaimSweepEntry | null {
  switch (outcome.kind) {
    case 'reclaimed': case 'gone': case 'refused': return null;
    case 'failed':
      return { ...entry, consecutiveFailures: entry.consecutiveFailures + 1, lastFailedAt: nowMs };
    case 'deferred': {
      const presence = (CHILD_RECLAIM_PRESENCE_DEFERS as readonly string[]).includes(outcome.why);
      return {
        ...entry,
        firstDeferredAt: entry.firstDeferredAt ?? nowMs,
        firstPresenceDeferredAt: presence ? (entry.firstPresenceDeferredAt ?? nowMs) : entry.firstPresenceDeferredAt,
        consecutiveFailures: 0, lastFailedAt: null,
      };
    }
  }
}

/** Has this child's PRESENCE defer lasted the ceiling? At EXACTLY the ceiling,
 *  yes. The presence clock alone: any other deferral is a condition the
 *  ceiling must never override. How long the child waited is not this
 *  function's to say: the lane passes `entry.firstDeferredAt` — the OTHER
 *  clock — on every request as `ChildReclaimRequest.deferredSinceMs`, and the
 *  executor's ONE feed row states the wait and its why for a `deferred`
 *  outcome and for a ceiling-expired reclaim (spec §5.7, §5.9). */
export const childReclaimDeferExpired = (entry: ChildReclaimSweepEntry, nowMs: number): boolean =>
  entry.firstPresenceDeferredAt !== null && nowMs - entry.firstPresenceDeferredAt >= CHILD_RECLAIM_DEFER_CEILING_MS;

/** The wait after `consecutiveFailures` failed attempts in a row (spec §5.9:
 *  "retries back off in between"): `min(ceiling, passInterval × 2^k)` — two
 *  intervals after the first failure, doubling, never longer than the
 *  ceiling, so a child that keeps failing is still asked for at least once a
 *  ceiling. `0` with no failure. */
export function childReclaimBackoffMs(consecutiveFailures: number, passIntervalMs: number): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(CHILD_RECLAIM_DEFER_CEILING_MS, passIntervalMs * 2 ** consecutiveFailures);
}

/** May the lane ask for this child again? Always with no failure on record;
 *  otherwise only once the backoff has passed since the failed attempt's pass —
 *  at EXACTLY the backoff, yes. */
export const childReclaimBackoffOver = (entry: ChildReclaimSweepEntry, nowMs: number, passIntervalMs: number): boolean =>
  entry.lastFailedAt === null
  || nowMs - entry.lastFailedAt >= childReclaimBackoffMs(entry.consecutiveFailures, passIntervalMs);

/** One row of the mirror read the attention list and the terminal exclusion
 *  share: the LATEST `reclaim` event of one session's CURRENT GENERATION, of
 *  any outcome — declared here, by its consumer. `outcome` is the mirror's
 *  outcome; `at` is ccd's clock, or null when the line carried none;
 *  `failingSince`, only when that event is `failed`, is when the unbroken run
 *  of failures ending at it began, on ccd's clock. NO `ingestedAt`: it is the
 *  server's clock and never an event time (D8, `coord/schema.ts`), so this
 *  row does not carry it and nothing here can read it as one. */
export interface ChildReclaimJournalRow {
  readonly sessionId: string;
  readonly outcome: string;
  readonly refusal: string | null;
  readonly at: number | null;
  readonly failingSince: number | null;
}

/** The answer shape of wave 3's token classification, as this file receives
 *  it: an INJECTED lookup (`kindOf`), because L1 imports L0 alone. The lookup
 *  itself is `childReclaimTokenKind`, exported beside `CHILD_RECLAIM_TOKEN_KIND`
 *  in `coord/childReclaim.ts` — the one total reader of the one map. */
export type ChildReclaimTokenKind = 'gone' | 'terminal' | 'retry';

const RECLAIM_ACT: LifecycleAct = 'reclaim';
const INTENT: LifecycleOutcome = 'intent';
const REFUSED: LifecycleOutcome = 'refused';
const FAILED: LifecycleOutcome = 'failed';

/** ONE session's attention input row. `generation` is
 *  `childReclaimGeneration(events, at)`'s answer and `latest` is
 *  `childReclaimLatest(generation)`'s (`coord/childReclaim.ts`): where a
 *  generation starts and which event is latest — `intent` included — are
 *  decided there, once, and this file cannot import either, so the latest
 *  event is passed IN rather than picked again here. What this adds is the
 *  failure run: walking back from the end over `reclaim` events, `intent`s
 *  (the start of each attempt) and other acts are read past, each `failed`
 *  that ccd placed moves the start back, and any other outcome ends the walk.
 *  Time is ccd's clock ALONE: a `failed` line that carried no `at` is still
 *  a failure — it does not end the run — but it cannot be placed, so it
 *  starts no clock. The mirror's `ingestedAt` is never read (D8). */
export function childReclaimJournalRow(
  generation: readonly MirroredLifecycleEvent[], latest: MirroredLifecycleEvent | null,
): ChildReclaimJournalRow | null {
  if (latest === null || latest.id === null) return null;
  let failingSince: number | null = null;
  if (latest.outcome === FAILED) {
    for (let k = generation.length - 1; k >= 0; k -= 1) {
      const e = generation[k]!;
      if (e.act !== RECLAIM_ACT || e.outcome === INTENT) continue;
      if (e.outcome !== FAILED) break;
      if (e.at !== null) failingSince = e.at;
    }
  }
  return { sessionId: latest.id, outcome: latest.outcome, refusal: latest.refusal, at: latest.at, failingSince };
}

/** THE reading of "this child stands under a TERMINAL refusal": its latest
 *  reclaim event is a refusal whose token wave 3 classes terminal. Shared by
 *  the attention list and the lane's terminal exclusion, so the two can never
 *  disagree — and deliberately NOT "is on the attention list", which also
 *  names children whose reclaim keeps FAILING, and a failure is retried. */
export const childReclaimTerminalRefusal = (
  row: ChildReclaimJournalRow, kindOf: (token: string) => ChildReclaimTokenKind | null,
): boolean => row.outcome === REFUSED && row.refusal !== null && kindOf(row.refusal) === 'terminal';

/** Has this child's reclaim kept failing for the whole ceiling (spec §5.9)?
 *  At EXACTLY the ceiling, yes. A failure row with no run start says nothing. */
export const childReclaimFailingPastCeiling = (row: ChildReclaimJournalRow, nowMs: number): boolean =>
  row.outcome === FAILED && row.failingSince !== null && nowMs - row.failingSince >= CHILD_RECLAIM_DEFER_CEILING_MS;

/** The server's sentence for a child listed because its reclaim keeps failing
 *  — the last failure's own word inside it, or a plain statement that ccd
 *  gave none. Says it is still retried, because it is: a report, not a stop. */
export const childReclaimFailingSentence = (word: string | null): string =>
  `Every attempt to reclaim this child has failed for at least ${CHILD_RECLAIM_DEFER_CEILING_MS / 60_000} minutes; `
  + `ccrc keeps retrying, backing off in between. The last failure: ${word ?? 'ccd recorded no reason.'}`;

export interface ChildReclaimAttentionInput {
  readonly latest: readonly ChildReclaimJournalRow[];
  /** Every registry row this read listed → its minting run id, or null when
   *  its marker does not read as a child. PRESENCE in this map IS "the row
   *  still exists". */
  readonly live: ReadonlyMap<string, number | null>;
  /** Wave 3's classification, read totally — null for a token this build does
   *  not know, which is therefore never reported as terminal. */
  readonly kindOf: (token: string) => ChildReclaimTokenKind | null;
  /** The server's one sentence per token (`wsaudit.ts`'s `refusalSentence`). */
  readonly sentenceFor: (token: string) => string;
  readonly nowMs: number;
}

/** The fleet-level attention list (spec §5.9): each child whose latest reclaim
 *  event in its current generation is a refusal wave 3 classes TERMINAL, or a
 *  failure closing a run of failures that has lasted the ceiling, and whose
 *  registry row still exists — with the server's sentence. An `intent` as the
 *  latest event lists nothing: an attempt is in flight, or died mid-way.
 *  DERIVED FROM THE MIRROR ALONE, "so a restart does not lose it": an
 *  audit-time terminal refusal is a mirror row like any other, because wave
 *  3's `cmd_ws_audit --reclaim` journals each terminal verdict it answers
 *  (`verb ws-audit`), and a failure is the `_lc_fail` line of an attempt that
 *  started. No executor answer and no in-memory memo is an input. A report:
 *  nothing waits on it. A failure's sentence is its journal word first
 *  (`lcRefusalWord`, the journal-only map) and the server's lookup second —
 *  the order `lcRefusalWord`'s own docstring prescribes. Only ccd's own `at`
 *  places a line in time: a child whose latest line carried none cannot say
 *  since when, and is not listed — the mirror's ingest time is the server's
 *  clock and never an event time (D8, `coord/schema.ts`). */
export function childReclaimAttention(i: ChildReclaimAttentionInput): ChildReclaimAttention[] {
  const out: ChildReclaimAttention[] = [];
  for (const row of i.latest) {
    if (!i.live.has(row.sessionId)) continue;
    // Unplaceable: no `at`, no item — whichever arm below it would reach.
    if (row.at === null) continue;
    const runId = i.live.get(row.sessionId) ?? null;
    if (childReclaimTerminalRefusal(row, i.kindOf)) {
      out.push({
        sessionId: row.sessionId, runId, token: row.refusal!, sentence: i.sentenceFor(row.refusal!),
        // Since when: the refusal's own line, on ccd's clock.
        at: row.at,
      });
    } else if (childReclaimFailingPastCeiling(row, i.nowMs)) {
      const word = row.refusal === null ? null : (lcRefusalWord(row.refusal) ?? i.sentenceFor(row.refusal));
      out.push({
        sessionId: row.sessionId, runId, token: row.refusal ?? '', sentence: childReclaimFailingSentence(word),
        // Since when: the start of the run of failures, not its latest line.
        at: row.failingSince!,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep-policy.test.ts test/single-definition.test.ts test/typecheck-tests.test.ts
```

Expected: PASS — `child-reclaim-sweep-policy` 44/44 (eighteen verdict cases, eleven memory/clock/backoff cases, six `childReclaimJournalRow` cases, nine attention cases); `single-definition` green (the file spells no guarded enumeration); `typecheck-tests` compiles the new test.

- [ ] **Step 5: Mutation check, then commit**

| # | Edit (in `server/src/childReclaimSweep.ts`) | Expected red (`cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep-policy.test.ts`) |
|---|---|---|
| 1 | `if (run === null) return { eligible: false, why: 'minting-run-absent' };` → `if (run === null) return { eligible: true, runId: i.child.runId };` | *a minting run ABSENT from the database is NEVER eligible* and *a lost database makes EVERY child absent at once* — the first draft's fail-open, reproduced |
| 2 | Delete the `if (run.sessionId === null \|\| run.sessionId === i.sessionId) { … }` block | *a live minting run that names THIS child, or no session at all, keeps it* |
| 3 | `i.nowMs - run.dispatchStartedAt < SPAWN_STALL_MS` → `<=` | *…except inside the spawn-stall window* — the exact-boundary row answers `dispatch-in-flight` |
| 4 | Delete the `if (i.child.kind === 'unreadable') …` line | *an unreadable marker DEFERS* — it falls through and reads `runId` off a mark that has none |
| 5 | `if (!i.siblings.ok) return … 'siblings-unreadable'` → delete it | *an unreadable sibling list is INELIGIBLE, never "none"* |
| 6 | In `childReclaimDeferExpired`, `>= CHILD_RECLAIM_DEFER_CEILING_MS` → `>` | *the ceiling is fifteen minutes, reached at exactly fifteen* |
| 7 | In `childReclaimNextEntry`, `(entry.firstPresenceDeferredAt ?? nowMs)` → `nowMs` | *a PRESENCE defer starts BOTH clocks, once, and never restarts either* — the second defer moves the presence clock to `NOW + 60000` |
| 8 | In `childReclaimTerminalRefusal`, `kindOf(row.refusal) === 'terminal'` → `kindOf(row.refusal) !== null` | *drops a retryable refusal, a gone token, and a token this build does not know* — `attached` and `no-such-session` are listed |
| 9 | In `childReclaimAttention`, delete the `if (!i.live.has(row.sessionId)) continue;` line | *drops a child whose registry row is gone* — both its refusal and its failure row are listed |
| 10 | In `childReclaimSweepVerdict`'s review `switch`, delete the `if (!TERMINAL_STATES.includes(i.reviewedRun.state)) return … 'review-report-live' …;` line | *a REVIEW child is kept while the run it reviewed is not terminal* and *an ORPHANED review child is kept too* — each answers `{ eligible: true, runId: 7 }` (contract §7 R16's fail-open: a report the coordinator still cites is deleted) |
| 11 | In the same `switch`, `case 'absent': return …` → `case 'absent': break;` | *a reviewed run that is absent or unreadable keeps the review child* — the absent row answers eligible |
| 12 | In `childReclaimNextEntry`'s `deferred` arm, `firstDeferredAt: entry.firstDeferredAt ?? nowMs,` → `firstDeferredAt: presence ? (entry.firstDeferredAt ?? nowMs) : entry.firstDeferredAt,` | *a defer that is not presence starts the ANY-kind clock* — `firstDeferredAt: null` where `NOW` was expected, for every non-presence why (contract §8 R4′: every deferred feed row states how long) |
| 13 | In `childReclaimDeferExpired`, read `entry.firstDeferredAt` in both places instead of `entry.firstPresenceDeferredAt` | *the ceiling is fifteen minutes … on the PRESENCE clock alone* — the any-kind entry ten ceilings old answers `true` (contract §8 R4′: a `held` deferral must never expire presence) |
| 14 | In `childReclaimNextEntry`'s `failed` arm, `return { ...entry, consecutiveFailures: …, lastFailedAt: nowMs };` → `return entry;` | *counts a failed attempt and stamps when it was asked* — `consecutiveFailures: 0` where `1` was expected (contract §8 R20) |
| 15 | In the `deferred` arm, drop `consecutiveFailures: 0, lastFailedAt: null,` | *any deferral ends a run of failures* — `consecutiveFailures: 3` |
| 16 | In `childReclaimBackoffMs`, `2 ** consecutiveFailures` → `2 ** (consecutiveFailures - 1)` | *backs off min(ceiling, pass interval × 2^k)* — `[0, 60000, 120000, 240000, 480000, 900000]` |
| 17 | In `childReclaimBackoffMs`, drop the `Math.min(CHILD_RECLAIM_DEFER_CEILING_MS, …)` cap | the same case — `960000` where `900000` was expected at k = 4, and an unbounded wait at k = 40 |
| 18 | In `childReclaimBackoffOver`, `>= childReclaimBackoffMs(…)` → `> childReclaimBackoffMs(…)` | *a backed-off child waits until exactly its backoff has passed* — `expected false to be true` at `NOW + 120_000`. (The `lastFailedAt === null` arm is not a mutation row: `NOW - null` is `NOW`, and the no-failure backoff is `0`, so deleting it is GREEN behaviourally and a TS2531 at compile — it is there for the type, not the verdict) |
| 19 | In `childReclaimJournalRow`, `if (e.outcome !== FAILED) break;` → `if (e.outcome !== FAILED) continue;` | *any other reclaim outcome ends the run* — `failingSince: NOW` where `NOW + 2` was expected |
| 20 | In `childReclaimFailingPastCeiling`, `>=` → `>` | *lists a child whose reclaim has kept FAILING for the whole ceiling* — `[]` at exactly the ceiling |
| 21 | In `childReclaimAttention`, delete the `else if (childReclaimFailingPastCeiling(row, i.nowMs)) { … }` arm | the same case, and *a failure word outside the journal-only map* — `[]` (spec §5.9's second population, gone) |
| 22 | In `childReclaimAttention`'s failure arm, `(lcRefusalWord(row.refusal) ?? i.sentenceFor(row.refusal))` → `i.sentenceFor(row.refusal)` | *lists a child whose reclaim has kept FAILING* — the `purge-refused` sentence reads `sentence for purge-refused` where `LC_REFUSAL_WORD['purge-refused']` was expected |
| 23 | In `childReclaimAttention`, delete `if (row.at === null) continue;` | *never lists a child whose latest line carried no ccd clock* — the refusal is listed with `at: null` and the failure at `NOW - C`: `expected [ …(2) ] to deeply equal []` (contract §8 R22′). Also a TS2322 under `tsc` — `at: row.at` is `number \| null` against `number` — but vitest strips types, so the red named here is the behavioural one |
| 24 | In `childReclaimJournalRow`, `if (e.at !== null) failingSince = e.at;` → `failingSince = e.at ?? e.ingestedAt;` — R22's retired reading | *a failure with no ccd clock starts no failure clock* — `failingSince: NOW + 7` where `null` was expected (the server's clock read as an event time: D8, contract §8 R22′) |
| 25 | In `childReclaimJournalRow`, `if (e.at !== null) failingSince = e.at;` → `failingSince = e.at;` | the same case's second half — `failingSince: null` where `NOW + 4` was expected (an unplaceable failure erases the start ccd did place) |

```bash
git add server/src/childReclaimSweep.ts server/test/child-reclaim-sweep-policy.test.ts
git commit -m "$(cat <<'MSG'
feat(reclaim): the child-reclaim sweep's decisions, as one pure L1 file

The marker is the subject; an absent minting run is NEVER eligible (a lost
database makes every child's run absent at once); orphans are reached
through a live minting run that names a different session, outside the
spawn-stall window; unreadable anything is "not this pass"; a review child
is kept while the run it reviewed is open. The memory keeps two clocks —
the first deferral of any kind, and the first presence deferral that alone
drives the 15-minute ceiling — and backs a failing child off by
min(ceiling, interval x 2^k). The attention derivation lists terminal
refusals, and failures that have lasted the ceiling, of children whose
rows still exist, from one generation's latest reclaim event (spec §5.7 as
amended, §5.9).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: The lane — `sweepChildReclaim`, the mirror read, and the attention list on the frame

**Model routing:** `sonnet`, effort `high` — the contract's routing (§6: implementation `sonnet`). The code is written out below in full; it is the automatic trigger of a destructive verb, and its seam decisions (what reaches the executor, the in-flight guard, the backoff, the stale write-back, the queue) are this wave's highest-stakes code — which is why the mandatory `opus`/`xhigh` SAFETY lens reads this diff against `childReclaimSweepVerdict` line by line.

**Files:**
- Modify: `server/src/coord/store.ts` — `childReclaimSessionIds()` directly after `lifecycleFor` (at planning line 4254-4300); `LifecycleAct` in its `shared/api.js` type import if missing
- Modify: `server/src/server.ts` — `Deps` gains `childReclaimExec?` (after `presence?`, at planning line 276)
- Modify: `server/src/coord/childReclaim.ts` (wave 3's file) — `export const childReclaimTokenKind` (contract §7 R15), `export function childReclaimGeneration` (contract §7 R6, its edges as §8 R22 rules them and R22′ corrects them) and `export function childReclaimLatest` (contract §8 R21), all three directly after `export const CHILD_RECLAIM_TOKEN_KIND` (Step 4); `LifecycleAct`, `LifecycleOutcome`, `MirroredLifecycleEvent` in its `../../../shared/api.js` import
- Modify: `server/src/watch.ts` — imports; `CHILD_RECLAIM_SWEEP_MS` beside `DIVERGENCE_SWEEP_MS` (line 93); four fields beside `lastDivergenceSweep` (line 479); `currentChildReclaimDefers()` beside `currentCoord()` (line 762); `sweepChildReclaim`, `childReclaimLogAbsence` and `execChildReclaim` directly after `sweepDivergences`; one `void` dispatch in `tick()` directly after `sweepDivergences`'s
- Create: `server/test/child-reclaim-sweep.test.ts`
- Create: `server/test/child-reclaim-generation.test.ts` — the generation fence and the latest-event rule, table-driven (contract §7 R6, §8 R21, §8 R22, §8 R22′)

**Interfaces:**
- Consumes: `childReclaimSweepVerdict`, `childReclaimFirstSighting`, `childReclaimNextEntry`, `childReclaimDeferExpired`, `childReclaimBackoffOver`, `childReclaimJournalRow`, `childReclaimTerminalRefusal`, `childReclaimAttention`, `ChildReclaimJournalRow`, `ChildReclaimReviewedRunRead`, `ChildReclaimSweepSkip`, `ChildReclaimTokenKind` and friends (Task 7); `ChildReclaimRequest.deferredSinceMs` (wave 3, contract §7 R4); `RunSummary.reviews` (the reviewed run, contract §7 R16); `CoordStore.lifecycleFor` (existing); `RECLAIM_PAUSE_MARKER` (Task 4); wave 3's `reclaimChild` (with Task 5's pause read), `ChildReclaimDeps`, `ChildReclaimRequest`, `ChildReclaimOutcome`, `ChildReclaimToken`, `CHILD_RECLAIM_TOKEN_KIND` (`server/src/coord/childReclaim.ts` — the last two read only by the new export beside them) and `RECLAIM_CAP`, `ACTOR_FLAGS_CAP` (`server/src/ccdargv.ts`); wave 3's `cmd_ws_audit --reclaim` journal line for each TERMINAL refusal it answers (`verb ws-audit`, contract §8 R5′, Task 1 Step 3 fact 6) — the evidence that puts an audit-time terminal refusal in the mirror — and `ws-reclaim`'s own `refused`/`failed` lines (`_lc_emit`, `_lc_fail`); `refusalSentence` (`server/src/wsaudit.ts`); `capSupported`; `coord.run` (twice for a review child: its minting run, then the run that one `reviews`), `coord.openRunsForSession`; `this.deps.queue` (`KeyedQueue`). Nothing in this lane writes a run event — contract §7 R4 retired the run-trail stand-in.
- Produces:
  - `export const childReclaimTokenKind: (token: string) => 'gone' | 'terminal' | 'retry' | null` (`server/src/coord/childReclaim.ts`, directly after `CHILD_RECLAIM_TOKEN_KIND`) — contract §7 R15: the ONE total reader of the one kind map, EXPORTED because this wave is its first second consumer; `watch.ts` imports it, and wave 5 imports it as-is and moves nothing. No module-private copy exists at any wave.
  - `export function childReclaimGeneration(events: readonly MirroredLifecycleEvent[], at: number): readonly MirroredLifecycleEvent[]` (`server/src/coord/childReclaim.ts`, directly after `childReclaimTokenKind`) — contract §7 R6 with §8 R22's edges as §8 R22′ corrects them: ONE session's events in the mirror's `id` order, cut to one workspace generation, from the last `create` row with outcome `done` whose `at` — ccd's clock ALONE, never `ingestedAt` (D8) — is at or before `at` up to (not including) the first `create` `done` after it whose `at` is set — and `[]` when no such opening `create` exists (no evidence, never another generation's rows). A `done` create whose `at` is null is no boundary, opening or closing; it and every row between two boundaries are included by the mirror's `id` order, whatever their `at`. The attention list calls it with `at` = now; wave 5's run chip imports it and calls it with `at` = the run's `closedAt`. No second implementation (`child-reclaim-generation.test.ts` scans for one).
  - `export function childReclaimLatest(events: readonly MirroredLifecycleEvent[]): MirroredLifecycleEvent | null` (`server/src/coord/childReclaim.ts`, directly after `childReclaimGeneration`) — contract §8 R21: the latest `reclaim`-act event of ANY outcome, `intent` included, in the mirror's `id` order; `null` when there is none. An `intent` newer than every outcome means an attempt is in flight or died mid-way, so the attention list lists nothing for that child. Wave 5's chip imports it as-is. No second implementation (the same scan).
  - `CoordStore.childReclaimSessionIds(): Set<string>` — every session id the mirror holds a `reclaim` row for; the narrowing read before the per-session `lifecycleFor` reads (a superset: the generation fence drops an earlier workspace's rows).
  - `ChildReclaimRequest.deferredSinceMs` on every sweep request: `entry.firstDeferredAt` — the epoch ms of the first deferral of ANY kind the sweep saw for this child, `null` before any (contract §7 R4 as §8 R4′ amends it). `deferExpired` reads the OTHER clock, `entry.firstPresenceDeferredAt`. The executor's feed row states the wait from `deferredSinceMs`; this wave writes NO run-trail stand-in for it.
  - The failure backoff (contract §8 R20): after the k-th `failed` outcome in a row, the lane asks for the child again only once `min(CHILD_RECLAIM_DEFER_CEILING_MS, CHILD_RECLAIM_SWEEP_MS × 2^k)` has passed since that attempt's pass.
  - `Deps.childReclaimExec?: (req: ChildReclaimRequest) => Promise<ChildReclaimOutcome>` — a TEST SEAM; production leaves it unset.
  - `export const CHILD_RECLAIM_SWEEP_MS = 60_000;` (`server/src/watch.ts`).
  - `FleetWatcher.sweepChildReclaim(records: readonly SessionRecord[], names: readonly string[]): Promise<void>` — public so a test can await it (`sweepDivergences`'s reason).
  - `FleetWatcher.currentChildReclaimDefers(): ReadonlyMap<string, ChildReclaimSweepEntry>` — the sweep's in-memory state, read-only, for wave 5's `childReclaimStatus`.
  - The attention list reaches `CoordStatus.childReclaimAttention` through Task 4's `emitCoord`.

- [ ] **Step 1: Read what wave 3 shipped**

```bash
sed -n '/export interface ChildReclaimDeps/,/^}/p' server/src/coord/childReclaim.ts
grep -n 'reclaimChild(' server/src/coord/routes.ts server/src/coord/close.ts
grep -n 'export type ChildReclaimToken\b' server/src/coord/childReclaim.ts
grep -n "from '../../../shared/api.js'" server/src/coord/childReclaim.ts
```

`execChildReclaim` in Step 5 composes `ChildReclaimDeps` from `this.deps` with the members `coord, io, cfg, runCcd, fleetState, presence, notifyLog`. **If the shipped interface declares a different member set, the literal takes exactly the shipped members, taken from `this.deps` under the same names the close route takes them from `Deps`** — the route builds it from `Deps`, so every member exists on `this.deps`. If wave 3 exported a builder for it, call that builder instead. Either way, name the resulting literal in the wave-done mail, because the two triggers are only one executor if they compose one deps shape. The last `grep` prints the one `shared/api.js` import Step 4 extends (`server/src/coord/` is three levels below the root).

- [ ] **Step 2: Write the failing tests**

(a) Create `server/test/child-reclaim-sweep.test.ts`:

```ts
// The child-reclaim lane, wired (child-reclamation spec §5.7 "On the sweep").
// `child-reclaim-sweep-policy.test.ts` pins the verdicts; what is only provable
// HERE is what reaches the executor, when, how often, and with which
// `deferExpired` and `deferredSinceMs` — and that everything else reaches nothing.
//
// The executor is stubbed at `Deps.childReclaimExec`, the ONE seam the watcher
// calls through, so these cases assert on the requests themselves. The last
// wiring case removes the stub and proves the production path composes wave 3's
// own audit argv through `runCcd`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { ACTOR_FLAGS_CAP, CCD_ARGV, RECLAIM_CAP } from '../src/ccdargv.js';
import { refusalSentence } from '../src/wsaudit.js';
import {
  CHILD_RECLAIM_DEFER_CEILING_MS, childReclaimFailingSentence, childReclaimJournalRow,
} from '../src/childReclaimSweep.js';
import {
  CHILD_RECLAIM_TOKEN_KIND, childReclaimGeneration, childReclaimLatest, childReclaimTokenKind,
  type ChildReclaimOutcome, type ChildReclaimRequest,
} from '../src/coord/childReclaim.js';
import { SPAWN_STALL_MS, lcRefusalWord } from '../../shared/api.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

const T0 = 1_790_000_000_000;
const GEN = '1790000000000000000';

interface FixtureOpts {
  /** false → the fleet host does not advertise `reclaim-v1`. */
  cap?: boolean;
  /** 'real' → no stub; the production path runs against the recording runner. */
  exec?: 'stub' | 'real';
  /** The stub's answer; defaults to `reclaimed`. */
  outcome?: (req: ChildReclaimRequest) => ChildReclaimOutcome | Promise<ChildReclaimOutcome>;
  /** Reuse a coordination database (the restart case). */
  coord?: CoordStore;
  home?: string;
}

const fixture = (opts: FixtureOpts = {}) => {
  let clock = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const home = opts.home ?? mkTmp('ccrc-child-reclaim-sweep-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  const calls: string[][] = [];
  const run = async (_cmd: string, args: string[]) => { calls.push(args); return { code: 1, stdout: '', stderr: '' }; };
  const coord = opts.coord ?? new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const requests: ChildReclaimRequest[] = [];
  const answer = opts.outcome ?? ((req: ChildReclaimRequest): ChildReclaimOutcome =>
    ({ kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: null }));
  const deps = {
    ...testDeps(home, run), cfg, coord,
    // The verbs wave 3's executor checks before it reaches the audit — its own
    // test's `CAPS`: `ws-audit` (`verbSupported`, which REFUSES a verb a
    // present list does not name), `reclaim-v1` (`capSupported`, the lane's
    // own gate and the executor's) and `ws-reclaim` + `actor-flags-v1` (the act
    // and its dec). `[]` is the arm with no `reclaim-v1` at all.
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
      ccdVerbs: opts.cap === false ? [] : ['ws-audit', 'ws-reclaim', RECLAIM_CAP, ACTOR_FLAGS_CAP] },
    ...(opts.exec === 'real' ? {} : {
      childReclaimExec: async (req: ChildReclaimRequest) => { requests.push(req); return answer(req); },
    }),
  };
  const bus = new Bus();
  const watcher = new FleetWatcher(deps as never, bus, 10_000);

  let uidN = 0;
  /** One journal line, mirrored — a `reclaim` line is what wave 3's ccd
   *  writes (`verb` `ws-reclaim`; or `ws-audit` for a TERMINAL refusal the
   *  reclaim-mode audit answered, spec §5.9); `act: 'create'` is ws-add
   *  minting a workspace under that id. */
  const journal = (id: string, outcome: string, refusal: string | null, act: 'reclaim' | 'create' = 'reclaim',
    verb?: 'ws-reclaim' | 'ws-audit'): void => {
    uidN += 1;
    const line = JSON.stringify({ uid: `w4.1.${uidN}`, at: clock, act, outcome,
      verb: act === 'create' ? 'ws-add' : (verb ?? 'ws-reclaim'), id,
      ...(refusal === null ? {} : { refusal }) });
    coord.ingestJournal({ gen: GEN, rows: [parseJournalLine(line)], cursor: uidN * 200, size: uidN * 200, at: clock });
  };
  /** A registry row, `divergence-sweep.test.ts`'s idiom. `child` is the
   *  marker. ws-add journals the workspace's `create` as it mints it, so the
   *  row gets that line too: without it the mirror holds no generation for
   *  the id at all, and the fence answers nothing (spec §5.6's recycled slugs). */
  const plant = (id: string, extra: Record<string, string> = {}): void => {
    const fields: Record<string, string> = {
      uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`,
      workspace: id.slice('demo-'.length), branch: `ws/${id}`, base: 'origin/main', started: '1', ...extra,
    };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
    journal(id, 'done', null, 'create');
  };
  let progN = 0;
  const openRun = (): { id: number; program: string } => {
    const program = `w4-prog-${++progN}`;
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    return { id: r.id, program };
  };
  /** A REVIEW run of `work` (spec §5.7, "A review child is finished later
   *  than its own run") — `runs.reviews` names it. The store writes it as-is;
   *  the route's own checks are not what is tested. */
  const openReview = (work: { id: number; program: string }): { id: number; program: string } => {
    const r = coord.openRun({ program: work.program, title: work.program, project: 'demo', wave: 1, waveOf: null,
      claimedBy: 'demo-coord', kind: 'review', reviews: work.id });
    if (!('id' in r)) throw new Error(`openRun (review) refused: ${JSON.stringify(r)}`);
    return { id: r.id, program: work.program };
  };
  const abandon = (r: { id: number; program: string }): void => {
    const res = coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program: r.program, viaClosing: false });
    if (!res.ok) throw new Error(`abandon refused: ${JSON.stringify(res)}`);
  };
  const pass = async (): Promise<void> => {
    await watcher.sweepChildReclaim(await readRegistry(deps.io, cfg), readdirSync(reg));
  };
  const advance = (ms: number): void => { clock += ms; };
  const next = (): void => advance(CHILD_RECLAIM_SWEEP_MS + 1);
  /** The lane's own read of one session's attention input row, at `now` —
   *  the generation fence, the latest-event rule and the L1 row, exactly as
   *  the lane composes them. */
  const latestOf = (id: string) => {
    const gen = childReclaimGeneration(coord.lifecycleFor({ sessionId: id }), clock);
    return childReclaimJournalRow(gen, childReclaimLatest(gen));
  };
  const entryOf = (id: string) => watcher.currentChildReclaimDefers().get(id);
  return { home, reg, coord, watcher, bus, calls, requests, plant, openRun, openReview, abandon, journal, pass, next,
    advance, latestOf, entryOf, now: () => clock };
};

/** A child minted by a run that has since been abandoned — the plain case. */
const finishedChild = (f: ReturnType<typeof fixture>, id = 'demo-a'): number => {
  const r = f.openRun();
  f.abandon(r);
  f.plant(id, { child: String(r.id) });
  return r.id;
};

const deferredAs = (why: 'presence' | 'state-changed', req: ChildReclaimRequest): ChildReclaimOutcome =>
  ({ kind: 'deferred', sessionId: req.sessionId, runId: req.runId, why, detail: `deferred: ${why}` });

describe('sweepChildReclaim — what reaches the executor', () => {
  it('nothing on the FIRST eligible pass; one request on the second — twice observed', async () => {
    const f = fixture();
    const runId = finishedChild(f);
    await f.pass();
    expect(f.requests).toEqual([]);
    f.next();
    await f.pass();
    // `deferredSinceMs: null` — nothing has deferred yet (spec §5.9: a
    // deferral is shown with its elapsed time, so the request carries when it began).
    expect(f.requests).toEqual([{ sessionId: 'demo-a', runId, trigger: 'sweep', deferExpired: false, deferredSinceMs: null }]);
  });

  it('keeps its own clock: a second call inside CHILD_RECLAIM_SWEEP_MS is not a second pass', async () => {
    const f = fixture();
    finishedChild(f);
    await f.pass();
    f.advance(CHILD_RECLAIM_SWEEP_MS - 1);
    await f.pass();
    expect(f.requests).toEqual([]);
    f.advance(2);
    await f.pass();
    expect(f.requests).toHaveLength(1);
  });

  it('forgets the child once reclaimed — no third request', async () => {
    const f = fixture();
    finishedChild(f);
    await f.pass(); f.next(); await f.pass();
    expect(f.entryOf('demo-a')).toBeUndefined();
  });

  it('never reaches a child whose minting run is ABSENT, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fixture();
    f.plant('demo-a', { child: '999' });
    await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('demo-a'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('never eligible');
  });

  it('never reaches a review child whose reviewed run is ABSENT, and says so once — as for an absent minting run', async () => {
    // Spec §5.7: "Absence is logged and skipped." A reviewed run the database
    // does not hold is not proven terminal, so the review child is kept — and
    // the operator is told once, not once a minute.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fixture();
    const work = f.openRun();
    const review = f.openReview(work);
    f.abandon(review);
    f.plant('demo-r', { child: String(review.id) });
    // `runs.reviews` REFERENCES runs(id) and coord.db runs with foreign keys
    // ON, so the store cannot hold a review of a run it lacks: the one read
    // that asks for the reviewed row is stubbed to answer "no row".
    const real = f.coord.run.bind(f.coord);
    vi.spyOn(f.coord, 'run').mockImplementation((id: number) =>
      (id === work.id ? { ok: true as const, run: null } : real(id)));
    await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('demo-r'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`reviews run ${work.id}`);
    expect(lines[0]).toContain('kept');
  });

  it('reaches an ORPHAN whose minting run names a different session, outside the stall window', async () => {
    const f = fixture();
    const r = f.openRun();
    f.coord.markDispatchStarted(r.id, f.now() - SPAWN_STALL_MS - 1);
    f.coord.setSession(r.id, 'demo-b');
    f.plant('demo-a', { child: String(r.id) });
    await f.pass(); f.next(); await f.pass();
    expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-a']);
  });

  it('leaves an orphan alone while its run is planned INSIDE the stall window', async () => {
    const f = fixture();
    const r = f.openRun();
    f.coord.markDispatchStarted(r.id, f.now() - 1_000);
    f.coord.setSession(r.id, 'demo-b');
    f.plant('demo-a', { child: String(r.id) });
    await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
  });

  it('leaves a child an OPEN run names — the hand-over case', async () => {
    const f = fixture();
    finishedChild(f);
    const wave2 = f.openRun();
    f.coord.setSession(wave2.id, 'demo-a');
    await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
  });

  it('keeps a REVIEW child while the run it reviewed is open, and reclaims it once that run is terminal', async () => {
    // Spec §5.7: the reviewer's report lives in the review child's clips and
    // the coordinator cites it by path in fix-round mail, so the child is not
    // finished when its own review run closes.
    const f = fixture();
    const work = f.openRun();
    const review = f.openReview(work);
    f.abandon(review);                                        // the review run is terminal…
    f.plant('demo-r', { child: String(review.id) });
    await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests, 'reclaimed a review child whose report is still cited').toEqual([]);   // …the reviewed run is not
    f.abandon(work);
    f.next(); await f.pass();                                 // a FIRST eligible sighting
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();
    expect(f.requests).toEqual([
      { sessionId: 'demo-r', runId: review.id, trigger: 'sweep', deferExpired: false, deferredSinceMs: null }]);
  });

  it('leaves a held child, a child with an unreadable marker, and a row with no marker', async () => {
    const f = fixture();
    const r = f.openRun(); f.abandon(r);
    f.plant('demo-a', { child: String(r.id), hold: 'program:demo wave:2/3 run:8' });
    f.plant('demo-b', { child: 'not-a-run-id' });
    f.plant('demo-c');
    await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
  });

  it('does nothing while reclaim-paused stands, and needs two FRESH passes once it is lowered', async () => {
    const f = fixture();
    finishedChild(f);
    await f.pass();                                           // first sighting
    writeFileSync(path.join(f.reg, 'reclaim-paused'), '');
    f.next(); await f.pass();                                 // paused: nothing, memory cleared
    expect(f.requests).toEqual([]);
    rmSync(path.join(f.reg, 'reclaim-paused'));
    f.next(); await f.pass();                                 // a first sighting again
    expect(f.requests).toEqual([]);
    f.next(); await f.pass();
    expect(f.requests).toHaveLength(1);
  });

  it('does nothing on a fleet host that does not advertise reclaim-v1 — and still REPORTS', async () => {
    // The attention list is computed BEFORE the switches' early return: a
    // fleet host older than wave 3, or a paused fleet, still has children
    // standing under terminal refusals, and the report must not go dark
    // because the lane is idle.
    const f = fixture({ cap: false });
    finishedChild(f);
    finishedChild(f, 'demo-b');
    f.journal('demo-b', 'refused', 'tree-unreadable');
    await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention.map((a) => a.sessionId)).toEqual(['demo-b']);
  });

  it('passes deferExpired only once a PRESENCE defer has lasted the ceiling — and hands the executor when deferral began', async () => {
    const f = fixture({ outcome: (req) => deferredAs('presence', req) });
    finishedChild(f);
    await f.pass(); f.next(); await f.pass();                 // request 1 → deferred; BOTH clocks start NOW
    const deferredAt = f.now();
    f.next(); await f.pass();                                 // request 2, inside the ceiling
    f.advance(deferredAt + CHILD_RECLAIM_DEFER_CEILING_MS - f.now()); await f.pass();   // request 3, AT it
    // Spec §5.7: past the ceiling, the feed row "says how long it waited and
    // why". The elapsed defer RIDES THE REQUEST — every request after the
    // first deferral carries when it began, and wave 3's executor renders the
    // wait in its one feed row. Nothing is written on the run's trail in its place.
    expect(f.requests.map((q) => [q.deferExpired, q.deferredSinceMs]))
      .toEqual([[false, null], [false, deferredAt], [true, deferredAt]]);
    expect(f.entryOf('demo-a')).toMatchObject({ firstDeferredAt: deferredAt, firstPresenceDeferredAt: deferredAt });
  });

  it('a non-presence defer starts the any-kind clock, which the request carries, and never the ceiling', async () => {
    const f = fixture({ outcome: (req) => deferredAs('state-changed', req) });
    finishedChild(f);
    await f.pass(); f.next(); await f.pass();                 // request 1 → state-changed
    const deferredAt = f.now();
    f.advance(CHILD_RECLAIM_DEFER_CEILING_MS + 1); await f.pass();   // request 2, a ceiling later
    // Spec §5.9: "deferred with its elapsed time" — for EVERY deferral, so the
    // wait rides the request whatever deferred it; the ceiling bounds presence
    // and nothing else (spec §5.7), so `deferExpired` stays false.
    expect(f.requests.map((q) => [q.deferExpired, q.deferredSinceMs])).toEqual([[false, null], [false, deferredAt]]);
    expect(f.entryOf('demo-a')).toMatchObject({ firstDeferredAt: deferredAt, firstPresenceDeferredAt: null });
  });

  it('keeps TWO clocks: deferredSinceMs is the first deferral of ANY kind, the ceiling counts PRESENCE alone', async () => {
    let asked = 0;
    const f = fixture({ outcome: (req) => { asked += 1; return deferredAs(asked === 1 ? 'state-changed' : 'presence', req); } });
    finishedChild(f);
    await f.pass(); f.next(); await f.pass();                 // request 1 → state-changed: the ANY-kind clock starts
    const firstDefer = f.now();
    f.next(); await f.pass();                                 // request 2 → presence: the presence clock starts
    const firstPresence = f.now();
    f.advance(firstDefer + CHILD_RECLAIM_DEFER_CEILING_MS - f.now()); await f.pass();     // request 3: a ceiling after the FIRST deferral
    f.advance(firstPresence + CHILD_RECLAIM_DEFER_CEILING_MS - f.now()); await f.pass();  // request 4: a ceiling of PRESENCE
    expect(f.requests.map((q) => [q.deferExpired, q.deferredSinceMs])).toEqual([
      [false, null], [false, firstDefer], [false, firstDefer], [true, firstDefer]]);
    expect(f.entryOf('demo-a')).toMatchObject({ firstDeferredAt: firstDefer, firstPresenceDeferredAt: firstPresence });
  });

  it('never dispatches a child twice while its reclaim is still in flight', async () => {
    let release!: () => void;
    const f = fixture({ outcome: (req) => new Promise<ChildReclaimOutcome>((resolve) => {
      release = () => resolve({ kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: null });
    }) });
    finishedChild(f);
    await f.pass(); f.next();
    const first = f.pass();                                   // dispatches; the executor has not answered
    await vi.waitFor(() => expect(f.requests).toHaveLength(1));
    f.next(); await f.pass();                                 // a pass while in flight
    expect(f.requests).toHaveLength(1);
    release();
    await first;
  });

  it('drops an answer that comes back after a pass cleared the memory — the pause still needs two FRESH passes', async () => {
    // The reclaim was asked for, then the switch went up while it was in
    // flight (a pass cleared the memory), then it answered `failed`. Writing
    // that answer back would re-seed the memory the pause cleared, and the
    // child would be asked for on the FIRST pass after the switch came down.
    let release!: () => void;
    const f = fixture({ outcome: (req) => new Promise<ChildReclaimOutcome>((resolve) => {
      release = () => resolve({ kind: 'failed', sessionId: req.sessionId, runId: req.runId, detail: 'ccd exited 1' });
    }) });
    finishedChild(f);
    await f.pass(); f.next();
    const first = f.pass();                                   // request 1, in flight
    await vi.waitFor(() => expect(f.requests).toHaveLength(1));
    writeFileSync(path.join(f.reg, 'reclaim-paused'), '');
    f.next(); await f.pass();                                 // paused: memory cleared
    release();
    await first;                                              // `failed` comes back to a cleared map
    expect(f.entryOf('demo-a')).toBeUndefined();
    rmSync(path.join(f.reg, 'reclaim-paused'));
    f.next(); await f.pass();                                 // a FIRST sighting, not a second
    expect(f.requests).toHaveLength(1);
    f.next(); await f.pass();
    expect(f.requests).toHaveLength(2);
  });

  it('backs off a child whose reclaim keeps failing: min(ceiling, pass interval × 2^k) after the k-th failure', async () => {
    // Spec §5.9: "retries back off in between". k counts failed outcomes in
    // a row; the wait is measured from the pass that asked.
    const f = fixture({ outcome: (req) => ({ kind: 'failed', sessionId: req.sessionId, runId: req.runId, detail: 'ccd exited 1' }) });
    finishedChild(f);
    await f.pass(); f.next(); await f.pass();                 // request 1 → failed: k = 1, wait 2 intervals
    expect(f.requests).toHaveLength(1);
    expect(f.entryOf('demo-a')?.consecutiveFailures).toBe(1);
    f.next(); await f.pass();                                 // one interval later: backing off
    expect(f.requests, 'asked again inside the backoff').toHaveLength(1);
    f.next(); await f.pass();                                 // two intervals (+2 ms) later: asked
    expect(f.requests).toHaveLength(2);
    expect(f.entryOf('demo-a')?.consecutiveFailures).toBe(2);
    for (let i = 0; i < 3; i += 1) { f.next(); await f.pass(); }   // k = 2: four intervals; three passes wait
    expect(f.requests).toHaveLength(2);
    f.next(); await f.pass();                                 // the fourth pass asks
    expect(f.requests).toHaveLength(3);
  });
});

describe('the attention list — derived from the mirror, carried on the coord frame', () => {
  it('reports a terminal refusal with the server sentence, and never retries that child', async () => {
    const f = fixture();
    const runId = finishedChild(f);
    f.journal('demo-a', 'refused', 'tree-unreadable');
    await f.pass(); f.next(); await f.pass();
    expect(f.requests).toEqual([]);
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([{
      sessionId: 'demo-a', runId, token: 'tree-unreadable', sentence: refusalSentence('tree-unreadable'), at: T0,
    }]);
  });

  it('an AUDIT-TIME terminal refusal reaches the mirror through ws-audit\'s own line — listed, never retried, kept across a restart', async () => {
    // The executor audits first; a child that fails a terminal rung there gets
    // no token and never reaches `ws-reclaim`. Wave 3's `cmd_ws_audit
    // --reclaim` journals that verdict itself when it is TERMINAL (`verb
    // ws-audit`; a retryable one recurs every pass and is journaled nowhere),
    // so the mirror — the attention list's ONLY source (spec §5.9: "derived
    // from the lifecycle mirror so a restart does not lose it") — sees it as
    // it sees ws-reclaim's own. The stub stands in for ccd, so the test writes
    // the line ccd writes at that audit, as the mirror lane ingests it.
    const f = fixture({ outcome: (req) => ({ kind: 'refused', sessionId: req.sessionId, runId: req.runId,
      token: 'tree-unreadable', sentence: refusalSentence('tree-unreadable'), detail: 'audit: tree-unreadable' }) });
    const runId = finishedChild(f);
    await f.pass(); f.next(); await f.pass();                 // request 1 → refused, terminally, at the audit
    expect(f.requests).toHaveLength(1);
    // The executor's ANSWER is not a source. Until the mirror holds ccd's own
    // line, nothing is listed — no in-memory memo feeds the frame. (A tick,
    // not a pass: a pass would re-derive and hide a memo.)
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention, 'an executor answer fed the frame').toEqual([]);
    f.journal('demo-a', 'refused', 'tree-unreadable', 'reclaim', 'ws-audit');
    const refusedAt = f.now();
    expect(f.latestOf('demo-a')).toMatchObject({ sessionId: 'demo-a', outcome: 'refused', refusal: 'tree-unreadable' });
    for (let i = 0; i < 4; i += 1) { f.next(); await f.pass(); }
    expect(f.requests, 'retried a terminal refusal').toHaveLength(1);
    await f.watcher.tick();
    const item = { sessionId: 'demo-a', runId, token: 'tree-unreadable', sentence: refusalSentence('tree-unreadable'), at: refusedAt };
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([item]);
    // "so a restart does not lose it" (spec §5.9): a new watcher over the same
    // database lists it on its first pass and never asks for the child.
    const g = fixture({ coord: f.coord, home: f.home });
    await g.pass(); g.next(); await g.pass(); g.next(); await g.pass();
    expect(g.requests, 'a restart retried a terminal refusal').toEqual([]);
    await g.watcher.tick();
    expect(g.watcher.currentCoord()?.childReclaimAttention).toEqual([item]);
  });

  it('a recycled id does not inherit an old child\'s terminal refusal — and its own is still listed', async () => {
    // The OLD demo-a was refused terminally and later removed by a human; ws-add
    // then minted a NEW demo-a (the `create` line). The refusal described a
    // workspace that no longer exists: the new child is neither listed nor
    // skipped. The fence is `childReclaimGeneration(events, now)` (spec §5.6:
    // slugs recycle) — and it FENCES, it does not blank: a refusal of the NEW
    // workspace, after its `create`, is listed like any other.
    const f = fixture({ outcome: (req) => ({ kind: 'refused', sessionId: req.sessionId, runId: req.runId,
      token: 'containment-unproven', sentence: refusalSentence('containment-unproven'), detail: 'nested repo' }) });
    f.journal('demo-a', 'done', null, 'create');              // the OLD workspace
    f.journal('demo-a', 'refused', 'tree-unreadable');
    const runId = finishedChild(f);                           // the NEW one — `plant` journals its create
    expect(f.latestOf('demo-a')).toBeNull();
    await f.pass(); f.next(); await f.pass();
    expect(f.requests.map((q) => q.sessionId)).toEqual(['demo-a']);
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([]);
    f.advance(1);
    f.journal('demo-a', 'refused', 'containment-unproven');   // the NEW workspace's own refusal
    const at = f.now();
    f.next(); await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([{
      sessionId: 'demo-a', runId, token: 'containment-unproven', sentence: refusalSentence('containment-unproven'), at,
    }]);
  });

  it('keeps retrying a RETRYABLE refusal, and never lists it', async () => {
    const f = fixture();
    finishedChild(f);
    f.journal('demo-a', 'refused', 'attached');
    await f.pass(); f.next(); await f.pass();
    expect(f.requests).toHaveLength(1);
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([]);
  });

  it('an INTENT newer than the refusal lists nothing — the latest reclaim event of ANY outcome decides', async () => {
    // An `intent` after the refusal is an attempt in flight, or one that died
    // mid-way: whatever it finds is not known yet, so nothing is reported
    // until ccd answers it (spec §5.9: a report of what stands, never a guess).
    const f = fixture();
    finishedChild(f);
    f.journal('demo-a', 'refused', 'containment-unproven');
    f.journal('demo-a', 'intent', null);
    expect(f.latestOf('demo-a')).toMatchObject({ outcome: 'intent', refusal: null });
    await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([]);
    f.journal('demo-a', 'refused', 'containment-unproven');   // the attempt answered
    f.next(); await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention.map((a) => a.token)).toEqual(['containment-unproven']);
  });

  it('drops the child once its registry row is gone', async () => {
    const f = fixture();
    finishedChild(f);
    f.journal('demo-a', 'refused', 'tree-unreadable');
    await f.pass();
    for (const n of readdirSync(f.reg)) if (n.startsWith('demo-a.')) rmSync(path.join(f.reg, n));
    f.next(); await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([]);
  });

  it('survives a restart: a new watcher over the same database rebuilds it on its first pass', async () => {
    const f = fixture();
    finishedChild(f);
    f.journal('demo-a', 'refused', 'tree-unreadable');
    const g = fixture({ coord: f.coord, home: f.home });
    await g.pass();
    await g.watcher.tick();
    expect(g.watcher.currentCoord()?.childReclaimAttention.map((a) => a.sessionId)).toEqual(['demo-a']);
  });

  it('lists a child whose reclaim has kept FAILING past the ceiling, with the failure\'s sentence — and keeps asking for it', async () => {
    // Spec §5.9: "children whose reclaim has kept failing past the defer
    // ceiling (retries back off in between)". The failures are the mirror's —
    // what `_lc_fail` journals once an attempt has started — so a restart
    // keeps them too. A failure is RETRYABLE: listing it must not take the
    // child off the lane the way a terminal refusal does.
    const f = fixture();
    const runId = finishedChild(f);
    f.journal('demo-a', 'failed', 'pin-failed');
    const since = f.now();
    await f.pass();                                           // a first sighting; failing for 0 ms
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention, 'listed before the ceiling').toEqual([]);
    f.advance(CHILD_RECLAIM_DEFER_CEILING_MS);
    f.journal('demo-a', 'intent', null);
    f.journal('demo-a', 'failed', 'pin-failed');              // still failing, a ceiling later
    await f.pass();                                           // listed — AND asked for: the second sighting
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([{
      sessionId: 'demo-a', runId, token: 'pin-failed',
      sentence: childReclaimFailingSentence(lcRefusalWord('pin-failed') ?? refusalSentence('pin-failed')), at: since,
    }]);
    expect(f.requests.map((q) => q.sessionId), 'a failing child was excluded like a terminal refusal').toEqual(['demo-a']);
  });

  it('reads a run of failures within the current generation: an earlier workspace\'s failures under a recycled id do not count', async () => {
    const f = fixture();
    f.journal('demo-a', 'done', null, 'create');              // the OLD workspace
    f.journal('demo-a', 'failed', 'pin-failed');
    f.advance(CHILD_RECLAIM_DEFER_CEILING_MS);
    finishedChild(f);                                         // the NEW demo-a — `plant` journals its create
    f.journal('demo-a', 'failed', 'pin-failed');
    expect(f.latestOf('demo-a')).toMatchObject({ outcome: 'failed', failingSince: f.now() });
    await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.childReclaimAttention).toEqual([]);
  });
});

describe('childReclaimTokenKind — wave 3\'s classification, read totally, from ONE place', () => {
  it('answers every token the map classifies, and null for anything else — never a prototype member', () => {
    for (const [token, kind] of Object.entries(CHILD_RECLAIM_TOKEN_KIND)) {
      expect(childReclaimTokenKind(token), token).toBe(kind);
    }
    // A newer ccd's token is never terminal, so never listed; `'toString' in {}`
    // is true, which is why the reader uses hasOwnProperty.
    expect(childReclaimTokenKind('from-a-newer-ccd')).toBeNull();
    expect(childReclaimTokenKind('toString')).toBeNull();
  });

  it('watch.ts imports it rather than keeping a copy', () => {
    const src = readFileSync(path.join(__dirname, '../src/watch.ts'), 'utf8');
    expect(src).not.toContain('CHILD_RECLAIM_TOKEN_KIND');
    expect(src).toMatch(/import \{[^}]*\bchildReclaimTokenKind\b[^}]*\} from '\.\/coord\/childReclaim\.js'/);
  });

  it('watch.ts reads a generation through the ONE fence and its latest event through the ONE rule — imported, never its own', () => {
    const src = readFileSync(path.join(__dirname, '../src/watch.ts'), 'utf8');
    expect(src).toMatch(/import \{[^}]*\bchildReclaimGeneration\b[^}]*\} from '\.\/coord\/childReclaim\.js'/);
    expect(src).toMatch(/import \{[^}]*\bchildReclaimLatest\b[^}]*\} from '\.\/coord\/childReclaim\.js'/);
    expect(src).toContain('const gen = childReclaimGeneration(coord.lifecycleFor({ sessionId: r.id }), now);');
    expect(src).toContain('childReclaimJournalRow(gen, childReclaimLatest(gen))');
  });
});

describe('the production path', () => {
  it("reaches wave 3's own audit argv through runCcd — no stub", async () => {
    const f = fixture({ exec: 'real' });
    finishedChild(f);
    await f.pass(); f.next(); await f.pass();
    expect(f.calls).toContainEqual([...CCD_ARGV.wsReclaimAudit('demo-a', false)]);
  });

  it("goes through the session's own KeyedQueue — the one the close path and the reap route join", () => {
    // Behaviourally invisible to the case above (the argv is composed either
    // way), and the whole of what serialises this lane against the close
    // path's reclaim of the same child. So it is pinned as text, on the one
    // call that composes the production executor.
    const src = readFileSync(path.join(__dirname, '../src/watch.ts'), 'utf8');
    expect(src).toMatch(/this\.deps\.queue\.run\(req\.sessionId, \(\) => reclaimChild\(deps, req\)\)/);
  });
});
```

(b) Create `server/test/child-reclaim-generation.test.ts` — contract §7 R6's fence with §8 R22's edges as §8 R22′ corrects them (ccd's `at` alone places a boundary), and §8 R21's latest-event rule, each a table with a recycled slug, a clockless `create` or an intent-after-refusal among its rows:

```ts
// `childReclaimGeneration` and `childReclaimLatest` — the ONE generation fence
// and the ONE latest-event rule (child-reclamation spec §5.6: session ids are
// slugs and slugs recycle; §5.9: the attention item and the chip read the
// lifecycle mirror). "The latest `reclaim` event for a session" is only ever
// read within ONE workspace generation: from the last `create` row (outcome
// `done`) at or before T to the first `create` `done` after it — and NOTHING
// when no such `create` exists, never another generation's rows. Only ccd's
// own `at` places a boundary: `ingestedAt` is the server's clock and never an
// event time (D8, `server/src/coord/schema.ts`), so a `done` create whose line
// carried no `at` opens nothing and closes nothing, and rows between two
// boundaries are kept by the mirror's id order whatever their `at`. Within it,
// the latest `reclaim` event of ANY outcome decides, `intent` included. The
// attention list reads both at T = now (wave 4); the run chip at T = the run's
// `closedAt` (wave 5). One table each, one implementation each — the last case
// scans for a second.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { childReclaimGeneration, childReclaimLatest } from '../src/coord/childReclaim.js';
import type { LifecycleAct, LifecycleOutcome, MirroredLifecycleEvent } from '../../shared/api.js';

const T = 1_790_000_000_000;
let uidN = 0;
/** One mirrored row of session `demo-a`, labelled through `detail` so a row
 *  list reads as the table. `ingestedAt` is a FIXTURE VALUE, 5 ms after ccd's
 *  clock (after T for a clockless row, so it falls inside every window below);
 *  no row reads it as a time and no expectation depends on it — it is there
 *  so that reading it would red the clockless rows (D8). */
const ev = (label: string, act: LifecycleAct, outcome: LifecycleOutcome, at: number | null):
  MirroredLifecycleEvent => ({
  uid: `g.${++uidN}`, at, act, badact: null, outcome, badoutcome: null, id: 'demo-a', tx: null,
  verb: act === 'create' ? 'ws-add' : 'ws-reclaim', refusal: null, detail: label, truncated: false,
  obs: null, dec: null, meas: null, raw: '', gen: '1', ingestedAt: (at ?? T) + 5,
});
const labels = (xs: readonly MirroredLifecycleEvent[]): (string | null)[] => xs.map((e) => e.detail);

/** A RECYCLED SLUG: the first demo-a was refused and then removed by a human;
 *  ws-add minted a second demo-a under the same id (its `intent`, then its
 *  `done`), and that one was refused too. */
const RECYCLED: readonly MirroredLifecycleEvent[] = [
  ev('old-create', 'create', 'done', T),
  ev('old-refused', 'reclaim', 'refused', T + 10),
  ev('new-create-intent', 'create', 'intent', T + 20),
  ev('new-create', 'create', 'done', T + 21),
  ev('new-refused', 'reclaim', 'refused', T + 30),
];

const ROWS: readonly [string, readonly MirroredLifecycleEvent[], number, (string | null)[]][] = [
  ['recycled slug, T = now: the NEW workspace only', RECYCLED, T + 100, ['new-create', 'new-refused']],
  ['recycled slug, T between the creates: the OLD workspace, ending before the new done create',
    RECYCLED, T + 15, ['old-create', 'old-refused', 'new-create-intent']],
  ['T exactly at a done create: that create opens the generation', RECYCLED, T + 21, ['new-create', 'new-refused']],
  ['T before every create: no done create at or before T, so nothing', RECYCLED, T - 1, []],
  ['no done create in the history at all: nothing — never another generation\'s rows',
    [ev('r1', 'reclaim', 'refused', T), ev('r2', 'reclaim', 'done', T + 1)], T + 100, []],
  ['a create that never completed opens nothing',
    [ev('ci', 'create', 'intent', T), ev('r', 'reclaim', 'refused', T + 1)], T + 100, []],
  ['an empty history is an empty generation', [], T, []],
  ['rows before the first done create stay out of the generation it opens',
    [ev('pre', 'reclaim', 'done', T), ev('c', 'create', 'done', T + 1), ev('post', 'reclaim', 'refused', T + 2)],
    T + 100, ['c', 'post']],
  ['a REFUSED create opens nothing and closes nothing — ws-add minted nothing',
    [ev('c', 'create', 'done', T), ev('r', 'reclaim', 'refused', T + 1), ev('c2', 'create', 'refused', T + 2),
      ev('r2', 'reclaim', 'refused', T + 3)], T + 100, ['c', 'r', 'c2', 'r2']],
  ['a done create with no ccd clock CLOSES nothing — the rows after it stay in the generation before it, by id order',
    [ev('c0', 'create', 'done', T), ev('c1', 'create', 'done', null), ev('r', 'reclaim', 'refused', T + 60)],
    T + 40, ['c0', 'c1', 'r']],
  ['a done create with no ccd clock OPENS nothing — with no placed create at or before T, nothing',
    [ev('c0', 'create', 'done', null), ev('r', 'reclaim', 'refused', T + 20)], T + 100, []],
  ['a clockless create is skipped as a boundary: the next PLACED done create still closes the generation',
    [ev('c0', 'create', 'done', T), ev('c1', 'create', 'done', null), ev('r', 'reclaim', 'refused', T + 20),
      ev('c2', 'create', 'done', T + 30), ev('r2', 'reclaim', 'refused', T + 40)], T + 25, ['c0', 'c1', 'r']],
  ['the mirror\'s id order is kept — never re-sorted by ccd\'s clock',
    [ev('c', 'create', 'done', T + 10), ev('r', 'reclaim', 'refused', T)], T + 100, ['c', 'r']],
];

const LATEST: readonly [string, readonly MirroredLifecycleEvent[], string | null][] = [
  ['an empty generation has no latest event', [], null],
  ['a generation with no reclaim act has none', [ev('c', 'create', 'done', T), ev('h', 'hold', 'done', T + 1)], null],
  ['the newest reclaim event wins, whatever its outcome',
    [ev('r1', 'reclaim', 'refused', T), ev('r2', 'reclaim', 'done', T + 1)], 'r2'],
  ['an INTENT after a refusal IS the latest — an attempt in flight, or one that died mid-way',
    [ev('ref', 'reclaim', 'refused', T), ev('int', 'reclaim', 'intent', T + 1)], 'int'],
  ['a refusal after an intent is the latest', [ev('int', 'reclaim', 'intent', T), ev('ref', 'reclaim', 'refused', T + 1)], 'ref'],
  ['a failure is an outcome like any other', [ev('ref', 'reclaim', 'refused', T), ev('f', 'reclaim', 'failed', T + 1)], 'f'],
  ['later rows of other acts are read past',
    [ev('ref', 'reclaim', 'refused', T), ev('h', 'hold', 'done', T + 1), ev('s', 'supervise', 'done', T + 2)], 'ref'],
  ['id order decides, never ccd\'s clock', [ev('a', 'reclaim', 'refused', T + 10), ev('b', 'reclaim', 'done', T)], 'b'],
];

describe('childReclaimGeneration', () => {
  it.each(ROWS)('%s', (_name, events, at, want) => {
    expect(labels(childReclaimGeneration(events, at))).toEqual(want);
  });
});

describe('childReclaimLatest', () => {
  it.each(LATEST)('%s', (_name, events, want) => {
    expect(childReclaimLatest(events)?.detail ?? null).toBe(want);
  });
});

describe('one implementation each', () => {
  it('each is defined ONCE, in server/src/coord/childReclaim.ts — no second implementation at any wave', () => {
    const root = path.resolve(__dirname, '../..');
    const files = ['server/src', 'shared', 'pwa/src'].flatMap((r) =>
      (fs.readdirSync(path.join(root, r), { recursive: true }) as string[])
        .filter((f) => /\.(ts|tsx)$/.test(f))
        .map((f) => [path.join(r, f), fs.readFileSync(path.join(root, r, f), 'utf8')] as const));
    for (const [name, re] of [
      ['childReclaimGeneration', /function childReclaimGeneration\b|\bchildReclaimGeneration\s*=\s*\(/],
      ['childReclaimLatest', /function childReclaimLatest\b|\bchildReclaimLatest\s*=\s*\(/],
    ] as const) {
      expect(files.filter(([, text]) => re.test(text)).map(([f]) => f), name)
        .toEqual(['server/src/coord/childReclaim.ts']);
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep.test.ts test/child-reclaim-generation.test.ts`

Expected: each FILE LOADS — a named import a module does not export reads as `undefined` under vitest's module transform, never a collection error (Task 3 Step 2's measurement) — and EVERY case fails on its own line: each case that calls `f.pass()` with `TypeError: watcher.sweepChildReclaim is not a function` (and `CHILD_RECLAIM_SWEEP_MS` is `undefined`, so `f.next()` would advance the clock by `NaN` — the TypeError lands first); the cases that call `f.latestOf` before any pass with `TypeError: childReclaimGeneration is not a function`; the first `childReclaimTokenKind` case with `TypeError: childReclaimTokenKind is not a function`, and the second with `expected '…' to match /import \{[^}]*\bchildReclaimTokenKind\b…/`; the generation/latest import pin with `expected '…' to match /import \{[^}]*\bchildReclaimGeneration\b…/`; the KeyedQueue text pin with `expected '…' to match /this\.deps\.queue\.run\(req\.sessionId, …/`. And `child-reclaim-generation.test.ts` (Step 2b): every `ROWS` row with `TypeError: childReclaimGeneration is not a function`, every `LATEST` row with `TypeError: childReclaimLatest is not a function`, and the one-definition scan with `childReclaimGeneration: expected [] to deeply equal [ 'server/src/coord/childReclaim.ts' ]`. A case that passes here is a case that pins nothing — stop and find out why.

- [ ] **Step 4: The token-kind reader, the generation fence, the latest-event rule, the mirror read, and the seam**

In `server/src/coord/childReclaim.ts` (wave 3's file), directly after `export const CHILD_RECLAIM_TOKEN_KIND`'s closing `};`:

```ts
/** `CHILD_RECLAIM_TOKEN_KIND` read TOTALLY: a token's classification, or null
 *  for one this build was never compiled to know (a newer ccd's), which is
 *  therefore never terminal and never listed. Never a cast: the journal's
 *  `refusal` is free text. `hasOwnProperty`, not `in`: `'toString' in {}` is
 *  true.
 *
 *  THE ONE LOOKUP, exported beside the table it reads: the kind map is
 *  spelled once, and a second reader would be a second place a
 *  classification could drift (spec §5.9: the sentence and its meaning come
 *  from one server-side lookup keyed by the token). The sweep (`watch.ts`)
 *  imports it and injects it into the L1 attention derivation as `kindOf`;
 *  wave 5's run chip imports it as-is and moves nothing. */
export const childReclaimTokenKind = (token: string): 'gone' | 'terminal' | 'retry' | null =>
  Object.prototype.hasOwnProperty.call(CHILD_RECLAIM_TOKEN_KIND, token)
    ? CHILD_RECLAIM_TOKEN_KIND[token as ChildReclaimToken]
    : null;

const CREATE_ACT: LifecycleAct = 'create';
const CREATE_DONE: LifecycleOutcome = 'done';
const RECLAIM_ACT: LifecycleAct = 'reclaim';

/** ONE WORKSPACE GENERATION of one session's lifecycle events. Session ids
 *  are slugs and slugs recycle (spec §5.6): once a child is reclaimed or
 *  reaped, ws-add may mint a NEW workspace under the same id, and "the latest
 *  `reclaim` event for this session" would then describe a workspace that no
 *  longer exists — inheriting a terminal refusal would list the new child and
 *  keep the sweep off it for good. So every such read is taken within one
 *  generation: from the last `create` row with outcome `done` whose `at` is
 *  at or before `at`, up to (not including) the first such `create` after it.
 *
 *  NO OPENING `create`, NO GENERATION. When no placed `done` create lies at
 *  or before `at` — a workspace minted before the mirror existed, one whose
 *  `create` has scrolled out of the window read or carried no clock, or a
 *  history of rows alone — the answer is `[]`: there is no evidence which
 *  workspace those rows describe, and a guess would be another generation's
 *  rows.
 *
 *  `events` is ONE session's rows in the mirror's `id` order, oldest first —
 *  `CoordStore.lifecycleFor({ sessionId })`'s answer — and the answer keeps
 *  that order: `id` orders, never `at`. TIME IS CCD'S CLOCK ALONE, and it only
 *  PLACES the fence. The mirror's `ingestedAt` is the server's clock and is
 *  never read as an event time (D8, `coord/schema.ts`), so a `done` create
 *  whose line carried no `at` cannot be placed: it is no boundary — it opens
 *  nothing and closes nothing — and it, like every row between two
 *  boundaries, belongs to the generation its `id` falls in, whatever its
 *  `at`. Only a `done` create opens or closes a generation: a refused
 *  `ws-add` minted nothing, and an `intent` without its `done` is a create
 *  that never completed.
 *
 *  THE ONE IMPLEMENTATION. The sweep's attention list calls it with `at` =
 *  now; wave 5's run chip imports it and calls it with `at` = the run's
 *  `closedAt`. `child-reclaim-generation.test.ts` scans for a second. */
export function childReclaimGeneration(
  events: readonly MirroredLifecycleEvent[], at: number,
): readonly MirroredLifecycleEvent[] {
  /** A generation BOUNDARY: a `done` create that ccd placed in time. */
  const bound = (e: MirroredLifecycleEvent): e is MirroredLifecycleEvent & { readonly at: number } =>
    e.act === CREATE_ACT && e.outcome === CREATE_DONE && e.at !== null;
  let start = -1;
  for (let k = 0; k < events.length; k += 1) {
    const e = events[k]!;
    if (bound(e) && e.at <= at) start = k;
  }
  if (start === -1) return [];
  let end = events.length;
  for (let k = start + 1; k < events.length; k += 1) {
    if (bound(events[k]!)) { end = k; break; }
  }
  return events.slice(start, end);
}

/** The LATEST `reclaim` event of a generation, of ANY outcome — `intent`
 *  included — or null when it holds none. An `intent` newer than every outcome
 *  is an attempt in flight, or one that died mid-way: what it will find is not
 *  known yet, so the attention list lists nothing for that child and the
 *  chip falls through to its row rule (spec §5.9 — a report of what stands,
 *  never of what an unfinished attempt might say). The mirror's `id` order
 *  decides "latest", never ccd's nullable clock (`lifecycleFor`'s rule).
 *
 *  THE ONE RULE: the sweep's attention list reads it over
 *  `childReclaimGeneration(events, now)`; wave 5's chip imports it as-is.
 *  `child-reclaim-generation.test.ts` scans for a second. */
export function childReclaimLatest(events: readonly MirroredLifecycleEvent[]): MirroredLifecycleEvent | null {
  for (let k = events.length - 1; k >= 0; k -= 1) {
    if (events[k]!.act === RECLAIM_ACT) return events[k]!;
  }
  return null;
}
```

Add `type LifecycleAct, type LifecycleOutcome, type MirroredLifecycleEvent` to `childReclaim.ts`'s `../../../shared/api.js` import — the one Step 1's last `grep` printed, which Task 5 already extended with `type MarkerState` (keep every existing member). `'create'`, `'done'` and `'reclaim'` are not kebab literals, so `mail-routes.test.ts`'s scan over `server/src/coord` sees nothing new.

In `server/src/coord/store.ts`, add `LifecycleAct` to its `shared/api.js` type import if it is missing. Directly after `lifecycleFor`'s closing brace:

```ts
  /** Every session id the lifecycle mirror holds a `reclaim` row for
   *  (child-reclamation wave 4, spec §5.9) — the NARROWING read before the
   *  sweep's per-session history reads: it asks `lifecycleFor` only for the
   *  listed rows in this set, so a registry full of non-children costs one
   *  statement a sweep, not one per row. A SUPERSET on purpose: it names ids
   *  whose only `reclaim` rows belong to an EARLIER workspace under a recycled
   *  slug (spec §5.6), and the generation fence (`childReclaimGeneration`) is
   *  what drops those — this method decides nothing about generations. The
   *  act is BOUND, typed against its union, so it is not a second hand-spelled
   *  literal. Once per sweep interval (60 s), never per tick: `emitCoord` reads
   *  the list the sweep cached, not the mirror. */
  childReclaimSessionIds(): Set<string> {
    const act: LifecycleAct = 'reclaim';
    const rows = this.db.prepare(
      'SELECT DISTINCT sessionId FROM lifecycle_events WHERE act = ? AND sessionId IS NOT NULL',
    ).all(act) as { sessionId: string }[];
    return new Set(rows.map((r) => r.sessionId));
  }
```

In `server/src/server.ts`, add `import type { ChildReclaimOutcome, ChildReclaimRequest } from './coord/childReclaim.js';` beside the file's type imports, and in `Deps`, directly after `presence?: Presence;`:

```ts
  /** The child-reclaim sweep's call into wave 3's executor, as a SEAM
   *  (child-reclamation wave 4). Production leaves it UNSET: the watcher then
   *  composes the one executor both triggers share — `reclaimChild` on the
   *  session's own `KeyedQueue` — so a close and a sweep reclaim identically.
   *  A test sets it to assert what the lane asks for without a fleet box. */
  childReclaimExec?: (req: ChildReclaimRequest) => Promise<ChildReclaimOutcome>;
```

- [ ] **Step 5: The lane**

In `server/src/watch.ts`:

(a) Imports — add to the existing import lines (keep every existing member): `RECLAIM_CAP, capSupported` to `./ccdargv.js`; and new lines:

```ts
import { refusalSentence } from './wsaudit.js';
import {
  childReclaimGeneration, childReclaimLatest, childReclaimTokenKind, reclaimChild,
  type ChildReclaimDeps, type ChildReclaimOutcome, type ChildReclaimRequest,
} from './coord/childReclaim.js';
import {
  childReclaimAttention, childReclaimBackoffOver, childReclaimDeferExpired, childReclaimFirstSighting,
  childReclaimJournalRow, childReclaimNextEntry, childReclaimSweepVerdict, childReclaimTerminalRefusal,
  type ChildReclaimJournalRow, type ChildReclaimMintingRunRead, type ChildReclaimReviewedRunRead,
  type ChildReclaimSiblingsRead, type ChildReclaimSweepEntry, type ChildReclaimSweepSkip,
} from './childReclaimSweep.js';
```

(b) Directly after `const DIVERGENCE_SWEEP_MS = 60_000;`:

```ts
/** The child-reclaim lane (child-reclamation wave 4, spec §5.7). The census's
 *  cadence, for the census's reason — a child's eligibility moves on human
 *  timescales (a run closes, a re-dispatch binds) — and the TWICE-OBSERVED rule
 *  is measured in these intervals: a child must read eligible on two passes at
 *  least this far apart before anything is composed. It is also the base of
 *  the failure backoff (spec §5.9: "retries back off in between"). EXPORTED so
 *  its suite advances by the real constant. */
export const CHILD_RECLAIM_SWEEP_MS = 60_000;
```

(No token-kind, generation or latest-event helper here: `childReclaimTokenKind`, `childReclaimGeneration` and `childReclaimLatest` are imported from `./coord/childReclaim.js`, where Step 4 put them — contract §7 R15, §7 R6 and §8 R21, one definition each.)

(c) Directly after `private lastDivergenceJson: string | null = null;`:

```ts
  /** The child-reclaim lane's clock (child-reclamation wave 4). */
  private lastChildReclaimSweep = 0;
  /** Per marked child: the twice-observed sighting, the two deferral clocks
   *  (the first deferral of any kind, which each request carries; the first
   *  PRESENCE deferral, which alone the ceiling reads) and the run of failed
   *  attempts the backoff reads — `ChildReclaimSweepEntry`. IN MEMORY ONLY,
   *  deliberately: a restart loses it, and losing it can only DELAY a reclaim
   *  (two passes rebuild eligibility, the ceiling clock restarts) or retry a
   *  failing one sooner, which ccd's re-proof on the box makes safe — never
   *  cause one. */
  private childReclaimSweepState = new Map<string, ChildReclaimSweepEntry>();
  /** Children whose reclaim this lane has asked for and not heard back on.
   *  A pass never asks twice: the executor can hold a session's queue for
   *  minutes (`ws-reclaim`'s remote budget is `ws-reap`'s). */
  private childReclaimInFlight = new Set<string>();
  /** One log line per absence per child per process, not one a minute —
   *  keyed `<why> <id>`, because an absent minting run and an absent reviewed
   *  run are two conditions with two sentences. */
  private childReclaimAbsentLogged = new Set<string>();
```

(d) Directly after `currentCoord()`'s closing brace:

```ts
  /** The sweep's in-memory state, read-only — what wave 5's run chip reads to
   *  tell `deferred` from `pending`. Empty after a restart, by design. */
  currentChildReclaimDefers(): ReadonlyMap<string, ChildReclaimSweepEntry> {
    return this.childReclaimSweepState;
  }
```

(e) In `tick()`, directly after the `void this.sweepDivergences(records).catch(…)` statement:

```ts
      // NEVER awaited, same reasoning as `sweepNames` above and then some: this
      // lane joins the per-session KeyedQueue behind wave 3's `ws-reclaim`,
      // whose remote budget is `ws-reap`'s four minutes. Own clock
      // (`CHILD_RECLAIM_SWEEP_MS`). HANDED `registryRead.names`, unlike the
      // census: the only fact it takes from the listing is the reclaim switch,
      // and a listing a few awaited lanes old is safe for that one — ccd re-reads
      // `$REG/reclaim-paused` inside `ws-reclaim`'s lock at the instant of
      // deletion, which is the read that makes the switch real.
      void this.sweepChildReclaim(records, registryRead.names)
        .catch(() => { /* one bad sweep must not kill the poll */ });
```

(f) Directly after `sweepDivergences`'s closing brace:

```ts
  /**
   * THE CHILD-RECLAIM LANE (child-reclamation wave 4, spec §5.7 "On the
   * sweep"). A SIBLING of `sweepDivergences`, never a branch of it: that lane
   * "DECIDES nothing — no ccd verb runs here and nothing mutates", and this one
   * asks for a deletion. It decides nothing either — every verdict is
   * `childReclaimSweepVerdict`'s (L1) — but it APPLIES them, through wave 3's
   * one executor, which both triggers share.
   *
   * THE SUBJECT IS THE MARKER. It walks the registry rows this tick already
   * read and acts only on those whose `.child` marker names a minting run, so
   * it reaches the children the close path cannot: dispatch's two arms that
   * mint a child and fail to bind it. An absent minting run is never eligible.
   *
   * WHICH PASS, AND WHY IT DOES NOT RACE THE WRITE ROUTES. The 2 s tick's own
   * registry read, throttled to `CHILD_RECLAIM_SWEEP_MS`. It cannot take the
   * coordination mutex (not exported, and the watcher holds no handle on it),
   * so it does not try: every coord.db read here is one synchronous
   * `DatabaseSync` statement, atomic against the routes' writes; the executor
   * re-reads the marker and the sibling list itself immediately before it
   * composes the argv; the session's `KeyedQueue` serialises this lane against
   * the close path's reclaim and the reap route for that session; and ccd
   * recomputes the `--expect` fingerprint inside its lock, refusing
   * `state-changed` on any drift. The server narrows the window; the re-proof
   * on the box ends it.
   *
   * PRESENCE IS A DEFER, NOT AN INELIGIBILITY — the executor measures it (the
   * server's visibility claim) and ccd measures it (rungs 5 and 6), and each
   * answers `deferred`. That is what lets the ceiling bound it: a presence that
   * reset eligibility would reset the clock with it, and the drawer's
   * `tmux attach` on a locked phone would wedge a child forever.
   *
   * PUBLIC for `sweepDivergences`'s reason: `tick()` dispatches it with `void`.
   */
  async sweepChildReclaim(records: readonly SessionRecord[], names: readonly string[]): Promise<void> {
    const coord = this.deps.coord;
    if (!coord) return;
    const now = Date.now();
    if (this.lastChildReclaimSweep !== 0 && now - this.lastChildReclaimSweep < CHILD_RECLAIM_SWEEP_MS) return;
    this.lastChildReclaimSweep = now;

    // ONE — the attention list, from the mirror ALONE (spec §5.9: "derived
    // from the lifecycle mirror so a restart does not lose it"), BEFORE either
    // early return below: a paused fleet, or a fleet host without
    // `reclaim-v1`, still has children standing under terminal refusals or
    // failing past the ceiling, and the report must not go dark because the
    // lane is idle. Per LISTED row whose id the mirror has a `reclaim` row
    // for: that session's history, cut to its CURRENT workspace generation by
    // the one fence (`at` = now; spec §5.6 — a refusal of an earlier
    // workspace under a recycled slug is not this child's), then the LATEST
    // reclaim event of that generation, of ANY outcome, `intent` included (an
    // attempt in flight, or one that died mid-way, lists nothing), as the L1
    // input row. `lifecycleFor` answers the newest `LIFECYCLE_PAGE_MAX` rows; a
    // window whose `done` create has scrolled out of it — or carried no ccd
    // clock, which places no boundary — is an EMPTY generation —
    // no evidence, never another generation's rows — so such a child is
    // neither listed nor held off the lane: a retry that ccd refuses again on
    // the box, slower and never less safe. The list is in registry-read order.
    let latest: ChildReclaimJournalRow[];
    try {
      const withReclaim = coord.childReclaimSessionIds();
      latest = [];
      for (const r of records) {
        if (!withReclaim.has(r.id)) continue;
        const gen = childReclaimGeneration(coord.lifecycleFor({ sessionId: r.id }), now);
        const row = childReclaimJournalRow(gen, childReclaimLatest(gen));
        if (row !== null) latest.push(row);
      }
    } catch (err) {
      // FAIL SHUT, and keep the last list: a failed read proves nothing about
      // which children are terminal, so this pass neither reports differently
      // nor decides anything — and the twice-observed memory is dropped, so no
      // child acts on the strength of a pass that measured nothing.
      console.warn(`ccrc-server: sweepChildReclaim could not read the lifecycle mirror (${err instanceof Error ? err.message : String(err)}) — no reclaim decisions this pass`);
      this.childReclaimSweepState.clear();
      return;
    }
    const live = new Map<string, number | null>(
      records.map((r): [string, number | null] => [r.id, r.child.kind === 'child' ? r.child.runId : null]));
    // The ONLY write of the list: the mirror derivation's result. No executor
    // answer ever writes it (spec §5.9 — see the `.then` below).
    this.childReclaimAttentionList = childReclaimAttention({
      latest, live, kindOf: childReclaimTokenKind, sentenceFor: refusalSentence, nowMs: now,
    });

    // TWO — the switches. No `reclaim-v1` on the fleet host means the executor
    // would answer `unsupported` for every child every minute, each with a feed
    // row; a raised `reclaim-paused` means stop. Either way the memory is
    // dropped: "reclaim-paused is absent" is itself an eligibility conjunct, so
    // a child needs two FRESH passes once the switch is lowered.
    if (!capSupported(this.deps.fleetState, RECLAIM_CAP) || names.includes(RECLAIM_PAUSE_MARKER)) {
      this.childReclaimSweepState.clear();
      return;
    }

    // THREE — eligibility, per marked child, then twice-observed, then the
    // backoff, then ask. The TERMINAL set is the mirror's terminal refusals
    // ONLY — never the attention list, which also names children whose
    // reclaim keeps FAILING past the ceiling, and a failure is retried
    // (backing off) for as long as it fails. It comes from the mirror alone
    // (bound to the current generation) and survives a restart, and it
    // includes a terminal ladder refusal found at AUDIT time: wave 3's
    // `cmd_ws_audit --reclaim` journals exactly the terminal verdicts (`verb
    // ws-audit`), so the mirror holds them as it holds `ws-reclaim`'s. A
    // retryable verdict found there is journaled nowhere and needs no
    // exclusion — it is retried by design. Between the executor's `refused`
    // answer and the mirror lane's ingest (`LC_SWEEP_MS`) the child's
    // twice-observed entry is forgotten (`childReclaimNextEntry`), so it cannot
    // be asked for again until two fresh passes — long after.
    const terminal = new Set(latest
      .filter((row) => childReclaimTerminalRefusal(row, childReclaimTokenKind)).map((row) => row.sessionId));
    const seen = new Set<string>();
    const acts: Promise<void>[] = [];
    for (const r of records) {
      if (r.child.kind === 'none') continue;
      seen.add(r.id);
      let mintingRun: ChildReclaimMintingRunRead = { ok: true, run: null };
      let reviewedRun: ChildReclaimReviewedRunRead = { kind: 'not-a-review' };
      let reviewedId: number | null = null;
      let siblings: ChildReclaimSiblingsRead = { ok: true, open: 0 };
      if (r.child.kind === 'child') {
        try {
          const run = coord.run(r.child.runId);
          mintingRun = run.ok ? { ok: true, run: run.run } : { ok: false, detail: run.detail };
          // A REVIEW run's child waits on the run it reviewed (`runs.reviews`;
          // spec §5.7, "A review child is finished later than its own run"):
          // the reviewer's report lives in the child's clips while the
          // coordinator still cites it. Three answers that are not "not a
          // review", never folded into it.
          if (run.ok && run.run !== null && run.run.reviews !== null) {
            reviewedId = run.run.reviews;
            const reviewed = coord.run(reviewedId);
            reviewedRun = !reviewed.ok ? { kind: 'unreadable', detail: reviewed.detail }
              : reviewed.run === null ? { kind: 'absent' }
              : { kind: 'run', state: reviewed.run.state };
          }
          const sib = coord.openRunsForSession(r.id);
          siblings = sib.ok ? { ok: true, open: sib.siblings.length } : { ok: false, detail: sib.detail };
        } catch (err) {
          // `node:sqlite` throws synchronously; an unread run is not an absent one.
          mintingRun = { ok: false, detail: err instanceof Error ? err.message : String(err) };
        }
      }
      const v = childReclaimSweepVerdict({
        sessionId: r.id, child: r.child, identityMeasured: r.unmeasured.length === 0, held: r.held,
        terminal: terminal.has(r.id), mintingRun, reviewedRun, siblings, nowMs: now,
      });
      if (!v.eligible) {
        this.childReclaimSweepState.delete(r.id);
        this.childReclaimLogAbsence(r, v.why, reviewedId);
        continue;
      }
      const entry = this.childReclaimSweepState.get(r.id);
      if (entry === undefined) {
        this.childReclaimSweepState.set(r.id, childReclaimFirstSighting(now));
        continue;
      }
      if (this.childReclaimInFlight.has(r.id)) continue;
      // A run of failures BACKS OFF (spec §5.9: "retries back off in
      // between"): after the k-th failed attempt in a row, the next waits
      // min(ceiling, pass interval × 2^k) from the pass that asked. Any other
      // outcome ends the run (`childReclaimNextEntry`).
      if (!childReclaimBackoffOver(entry, now, CHILD_RECLAIM_SWEEP_MS)) continue;
      const req: ChildReclaimRequest = {
        sessionId: r.id, runId: v.runId, trigger: 'sweep',
        // THE CEILING READS THE PRESENCE CLOCK ALONE (spec §5.7, "Presence,
        // and its bound": the ceiling bounds presence and nothing else).
        deferExpired: childReclaimDeferExpired(entry, now),
        // THE ELAPSED DEFER RIDES THE REQUEST. Spec §5.7: past the ceiling
        // "the feed row says how long it waited and why"; §5.9: a deferral is
        // shown "with its elapsed time". So it is the FIRST deferral of ANY
        // kind this sweep saw for the child — the other clock — and null
        // before any; the executor's ONE feed row renders the wait from it. In
        // memory, so a restart restarts it: a later `deferredSinceMs`, never
        // an earlier one.
        deferredSinceMs: entry.firstDeferredAt,
      };
      this.childReclaimInFlight.add(r.id);
      acts.push(this.execChildReclaim(coord, req).then(
        (outcome) => {
          // A terminal refusal, or a failure, needs no memory here beyond the
          // entry, and gets none: ccd journalled it, and the mirror is where
          // the attention list and the terminal exclusion read it (spec §5.9 —
          // an executor answer never feeds `CoordStatus`). The entry: write
          // back ONLY when it is still the live one. A pass that ran while this
          // was in flight may have cleared the memory (switch raised,
          // capability lost, mirror unread, row unlisted, child ineligible);
          // re-seeding it from a stale entry would let the child be asked for
          // on the FIRST pass after, and "two FRESH passes" would be false.
          if (this.childReclaimSweepState.get(r.id) !== entry) return;
          const nextEntry = childReclaimNextEntry(entry, outcome, now);
          if (nextEntry === null) this.childReclaimSweepState.delete(r.id);
          else this.childReclaimSweepState.set(r.id, nextEntry);
        },
        (err: unknown) => {
          console.warn(`ccrc-server: sweepChildReclaim: the reclaim of ${r.id} threw (${err instanceof Error ? err.message : String(err)}) — left for the next pass`);
        },
      ).finally(() => { this.childReclaimInFlight.delete(r.id); }));
    }
    // A child the registry no longer lists has no twice-observed entry to keep.
    for (const id of [...this.childReclaimSweepState.keys()]) {
      if (!seen.has(id)) this.childReclaimSweepState.delete(id);
    }
    await Promise.all(acts);
  }

  /** Absence is logged and skipped (spec §5.7) — ONCE per child per
   *  condition per process. Two absences, two sentences: an absent MINTING run
   *  is never eligible, because a lost or rebuilt database makes every child's
   *  minting run absent at once; an absent REVIEWED run keeps a review child,
   *  because a run the database does not hold is not proven terminal and the
   *  report in the child's clips may still be cited. Every other skip is an
   *  ordinary state of the world and says nothing. */
  private childReclaimLogAbsence(r: SessionRecord, why: ChildReclaimSweepSkip, reviewedId: number | null): void {
    if (why !== 'minting-run-absent' && why !== 'reviewed-run-absent') return;
    const key = `${why} ${r.id}`;
    if (this.childReclaimAbsentLogged.has(key)) return;
    this.childReclaimAbsentLogged.add(key);
    const runId = r.child.kind === 'child' ? String(r.child.runId) : '?';
    console.warn(why === 'minting-run-absent'
      ? `ccrc-server: sweepChildReclaim: ${r.id} is marked as a child of run ${runId}, which coord.db does not hold — never eligible, because a lost or rebuilt database makes every child's minting run absent at once, the live ones included`
      : `ccrc-server: sweepChildReclaim: ${r.id} is a review child of run ${runId}, which reviews run ${reviewedId ?? '?'}, which coord.db does not hold — kept, because an absent reviewed run is not a terminal one and its report may still be cited`);
  }

  /** The ONE executor, as both triggers reach it: `reclaimChild` on the
   *  session's own `KeyedQueue`, with the deps the close route composes —
   *  so presence, the ceiling and the feed row behave identically however a
   *  reclaim was started (spec §5.7). `Deps.childReclaimExec` replaces the
   *  whole call in a test, and nowhere else. */
  private execChildReclaim(coord: CoordStore, req: ChildReclaimRequest): Promise<ChildReclaimOutcome> {
    const seam = this.deps.childReclaimExec;
    if (seam) return seam(req);
    const deps: ChildReclaimDeps = {
      coord, io: this.deps.io, cfg: this.deps.cfg, runCcd: this.deps.runCcd,
      fleetState: this.deps.fleetState, presence: this.deps.presence, notifyLog: this.deps.notifyLog,
    };
    return this.deps.queue.run(req.sessionId, () => reclaimChild(deps, req));
  }
```

(`CoordStore` is already imported as a type in `watch.ts` from `./coord/store.js`.) If Step 1 found a different `ChildReclaimDeps` member set, the literal in `execChildReclaim` takes that set, as Step 1 says.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep.test.ts test/child-reclaim-generation.test.ts \
  test/child-reclaim-sweep-policy.test.ts test/child-reclaim-paused-at-server.test.ts \
  test/divergence-sweep.test.ts test/lifecycle-sweep.test.ts test/lifecycle-store.test.ts test/fleetws.test.ts \
  test/verb-gate.test.ts test/single-definition.test.ts test/mail-routes.test.ts test/typecheck-tests.test.ts
```

Expected: PASS — `child-reclaim-sweep` 32/32 (eighteen executor cases, nine attention cases, three token-kind/import cases, two production-path cases — count them before and after: a smaller green is still green only if nothing was dropped); `child-reclaim-generation` 22/22 (thirteen fence rows, eight latest-event rows and the one-definition scan); `child-reclaim-sweep-policy` 44/44 and `child-reclaim-paused-at-server` 8/8 unchanged; `mail-routes`' kebab scan over `server/src/coord` finds no new literal in `childReclaim.ts`; `divergence-sweep` unchanged (its lane is untouched; `the tick itself` still finds one `setInterval(`); `verb-gate` finds no new `CCD_ARGV.` call site in `watch.ts`.

- [ ] **Step 7: Mutation check, then commit**

Each run: `cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep.test.ts` — rows 16–18, 23, 24, 27 and 28 run `test/child-reclaim-generation.test.ts` instead (row 24 both files).

| # | Edit (in `server/src/watch.ts` unless named) | Expected red |
|---|---|---|
| 1 | Delete the `if (entry === undefined) { … continue; }` block, and read `entry ?? childReclaimFirstSighting(now)` below | *nothing on the FIRST eligible pass; one request on the second* — a request on pass one |
| 2 | Drop `\|\| names.includes(RECLAIM_PAUSE_MARKER)` from the switches `if` | *does nothing while reclaim-paused stands* |
| 3 | Drop `!capSupported(this.deps.fleetState, RECLAIM_CAP) \|\|` | *does nothing on a fleet host that does not advertise reclaim-v1* |
| 4 | `deferExpired: childReclaimDeferExpired(entry, now)` → `deferExpired: false` | *passes deferExpired only once a PRESENCE defer has lasted the ceiling* — the third pair reads `[false, <deferredAt>]` where `[true, <deferredAt>]` was expected |
| 5 | Delete `if (this.childReclaimInFlight.has(r.id)) continue;` | *never dispatches a child twice while its reclaim is still in flight* — `expected length 1, got 2` |
| 6 | `terminal: terminal.has(r.id)` → `terminal: false` | *reports a terminal refusal … and never retries that child* — one request; AND *an AUDIT-TIME terminal refusal reaches the mirror through ws-audit's own line* — `retried a terminal refusal: expected [ …(3) ] to have a length of 1 but got 3` (the mirror-derived exclusion is the ONLY thing that keeps such a child off the lane) |
| 7 | Replace `const gen = childReclaimGeneration(coord.lifecycleFor({ sessionId: r.id }), now);` with `const gen = coord.lifecycleFor({ sessionId: r.id });` | *a recycled id does not inherit an old child's terminal refusal* — the old `tree-unreadable` row is the lane's latest again, so the new child is listed and never asked for: `expected [] to deeply equal [ 'demo-a' ]`; *reads a run of failures within the current generation* — the old failure starts the run, and the child is listed; and *watch.ts reads a generation through the ONE fence* |
| 8 | Move the attention block (`ONE`) below the switches' early return | *does nothing on a fleet host that does not advertise reclaim-v1 — and still REPORTS* — the list reads `[]` |
| 9 | In `execChildReclaim`, `return this.deps.queue.run(req.sessionId, () => reclaimChild(deps, req));` → `return reclaimChild(deps, req);` | *goes through the session's own KeyedQueue* — and ONLY that case: the production-path case stays green, because the argv is composed either way. That is why the queue has a pin of its own |
| 10 | In the `.then` callback, delete `if (this.childReclaimSweepState.get(r.id) !== entry) return;` | *drops an answer that comes back after a pass cleared the memory* — `entryOf('demo-a')` is defined after the `failed` answer, and the first pass after the switch comes down asks |
| 11 | In the attention gather, delete `if (!withReclaim.has(r.id)) continue;` | CONTROL, expected GREEN: the narrowing read is a cost bound, not a guard — every case still passes, because a row with no `reclaim` history yields `null`. Recorded so a reviewer does not read the set as a safety check |
| 12 | `deferredSinceMs: entry.firstDeferredAt` → `deferredSinceMs: null` | *passes deferExpired only once a PRESENCE defer has lasted the ceiling — and hands the executor when deferral began* — `[[false, null], [false, null], [true, null]]` where `[[false, null], [false, <deferredAt>], [true, <deferredAt>]]` was expected (the executor's feed row would have no wait to state) |
| 13 | In `server/src/coord/childReclaim.ts`'s `childReclaimTokenKind`, `Object.prototype.hasOwnProperty.call(CHILD_RECLAIM_TOKEN_KIND, token)` → `token in CHILD_RECLAIM_TOKEN_KIND` | *answers every token the map classifies, and null for anything else* — `expected [Function toString] to be null` |
| 14 | In `watch.ts`, replace the `childReclaimTokenKind` import with a module-private copy (`const childReclaimTokenKind = (t: string) => …CHILD_RECLAIM_TOKEN_KIND…`, importing the map) | *watch.ts imports it rather than keeping a copy* — `expected '…' not to contain 'CHILD_RECLAIM_TOKEN_KIND'` (contract §7 R15) |
| 15 | In the `.then` callback, add the memo contract §7 R5 forbids as its first line: `if (outcome.kind === 'refused' && childReclaimTokenKind(outcome.token) === 'terminal') this.childReclaimAttentionList = [...this.childReclaimAttentionList, { sessionId: r.id, runId: v.runId, token: outcome.token, sentence: outcome.sentence, at: now }];` | *an AUDIT-TIME terminal refusal reaches the mirror through ws-audit's own line* — `an executor answer fed the frame: expected [ { sessionId: 'demo-a', … } ] to deeply equal []` |
| 16 | In `server/src/coord/childReclaim.ts`'s `childReclaimGeneration`, in `bound`, `e.act === CREATE_ACT && e.outcome === CREATE_DONE && e.at !== null` → `e.act === CREATE_ACT && e.at !== null` | *recycled slug, T between the creates* — the new create's `intent` closes the old generation early, `[ 'old-create', 'old-refused' ]`; *a create that never completed opens nothing* — `[ 'ci', 'r' ]`; and *a REFUSED create opens nothing* — `[ 'c2', 'r2' ]` |
| 17 | In `childReclaimGeneration`, `bound(e) && e.at <= at` → `bound(e) && e.at < at` | *T exactly at a done create* — `[ 'old-create', 'old-refused', 'new-create-intent' ]` |
| 18 | In `childReclaimGeneration`'s `bound`, drop `&& e.at !== null` (a null `at` then compares as `0`, so a clockless create is placed at the epoch) | *a done create with no ccd clock OPENS nothing* — `[ 'c0', 'r' ]` where `[]` was expected; *…CLOSES nothing* — `[ 'c1', 'r' ]` where `[ 'c0', 'c1', 'r' ]` was expected; *a clockless create is skipped as a boundary* — `[ 'c1', 'r' ]` where `[ 'c0', 'c1', 'r' ]` was expected (contract §8 R22′: only ccd's `at` places a boundary). Compiles clean — the type predicate is not checked against its body — so the red is the only witness |
| 19 | In `sweepChildReclaim`, delete the `if (run.ok && run.run !== null && run.run.reviews !== null) { … }` block (`reviewedRun` stays `not-a-review`) | *keeps a REVIEW child while the run it reviewed is open* — `reclaimed a review child whose report is still cited: expected [ { sessionId: 'demo-r', … } ] to deeply equal []` (contract §7 R16) |
| 20 | In `childReclaimLogAbsence`, `if (why !== 'minting-run-absent' && why !== 'reviewed-run-absent') return;` → `if (why !== 'minting-run-absent') return;` | *never reaches a review child whose reviewed run is ABSENT, and says so once* — `expected [] to have a length of 1 but got 0` (contract §8 R16′); the minting-run case stays green, its control |
| 21 | Delete `if (!childReclaimBackoffOver(entry, now, CHILD_RECLAIM_SWEEP_MS)) continue;` | *backs off a child whose reclaim keeps failing* — `asked again inside the backoff: expected [ …(2) ] to have a length of 1 but got 2` (contract §8 R20) |
| 22 | Build the terminal set from the attention list: `const terminal = new Set(this.childReclaimAttentionList.map((a) => a.sessionId));` | *lists a child whose reclaim has kept FAILING past the ceiling … and keeps asking for it* — `a failing child was excluded like a terminal refusal: expected [] to deeply equal [ 'demo-a' ]` (a retryable failure taken off the lane for good) |
| 23 | In `childReclaimGeneration`, delete `if (start === -1) return [];` and write `events.slice(Math.max(start, 0), end)` — the pre-ruling fallback | *no done create in the history at all* — `[ 'r1', 'r2' ]` where `[]` was expected; *a create that never completed opens nothing* — `[ 'ci', 'r' ]`; *a done create with no ccd clock OPENS nothing* — `[ 'c0', 'r' ]` (contract §8 R22: no opening create, no generation) |
| 24 | In `childReclaimLatest`, `if (events[k]!.act === RECLAIM_ACT)` → `if (events[k]!.act === RECLAIM_ACT && events[k]!.outcome !== 'intent')` — the retired "newest outcome" pick | `child-reclaim-generation`: *an INTENT after a refusal IS the latest* — `expected 'ref' to be 'int'`; `child-reclaim-sweep`: *an INTENT newer than the refusal lists nothing* — `expected { …, outcome: 'refused', … } to match object { outcome: 'intent', refusal: null }` (contract §8 R21) |
| 25 | In `sweepChildReclaim`, `childReclaimJournalRow(gen, childReclaimLatest(gen))` → `childReclaimJournalRow(gen, gen[gen.length - 1] ?? null)` | *watch.ts reads … its latest event through the ONE rule* — `expected '…' to contain 'childReclaimJournalRow(gen, childReclaimLatest(gen))'` (a lane-local pick is a second rule) |
| 26 | `deferredSinceMs: entry.firstDeferredAt` → `deferredSinceMs: entry.firstPresenceDeferredAt` — the two clocks folded the other way | *keeps TWO clocks* — `[[false, null], [false, null], [false, <firstPresence>], [true, <firstPresence>]]` where `[[false, null], [false, <firstDefer>], [false, <firstDefer>], [true, <firstDefer>]]` was expected; and *a non-presence defer starts the any-kind clock, which the request carries* — `[false, null]` (contract §8 R4′: every deferred feed row states how long, whatever deferred it) |
| 27 | In `childReclaimGeneration`'s CLOSING loop only, `if (bound(events[k]!))` → `if (events[k]!.act === CREATE_ACT && events[k]!.outcome === CREATE_DONE)` — a clockless create closes again | *a done create with no ccd clock CLOSES nothing* — `[ 'c0' ]` where `[ 'c0', 'c1', 'r' ]` was expected; *a clockless create is skipped as a boundary* — `[ 'c0' ]` likewise (contract §8 R22′: the closing bound is placed by ccd's clock too, not the opening one alone) |
| 28 | Restore R22's retired reading: `bound` drops `&& e.at !== null`, and the opening test reads `bound(e) && (e.at ?? e.ingestedAt) <= at` | *a done create with no ccd clock OPENS nothing* — `[ 'c0', 'r' ]` where `[]` was expected; *…CLOSES nothing* and *a clockless create is skipped as a boundary* — each `[ 'c1', 'r' ]` (the fixture's `ingestedAt` sits inside every window, so the server's clock read as an event time reds all three: D8, contract §8 R22′) |

```bash
git add server/src/watch.ts server/src/coord/store.ts server/src/coord/childReclaim.ts server/src/server.ts \
        server/test/child-reclaim-sweep.test.ts server/test/child-reclaim-generation.test.ts
git commit -m "$(cat <<'MSG'
feat(reclaim): the sweep lane — orphans reclaimed with no human act

sweepChildReclaim walks the marked rows of the tick's own registry read on
its own 60 s clock, applies the L1 verdict, observes eligibility twice,
never asks twice while a reclaim is in flight, keeps a review child while
the run it reviewed is open (and logs an absent reviewed run once, as it
does an absent minting run), passes the first deferral's time on every
request as `deferredSinceMs` and `deferExpired` once a PRESENCE deferral
has lasted 15 minutes, and backs a failing child off by min(ceiling,
interval x 2^k). It does nothing while reclaim-paused stands or without
reclaim-v1, and an answer that returns after a pass cleared the memory is
dropped. The attention list — terminal refusals, and failures past the
ceiling, of children whose rows still exist — is derived from the
lifecycle mirror alone within each id's current workspace generation
(`childReclaimGeneration`: no opening create, no generation) from its
latest reclaim event of any outcome (`childReclaimLatest`: an intent lists
nothing); both are exported for wave 5, beside one exported token-kind
reader (spec §5.6, §5.7 as amended, §5.9).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: The reclaim row on `/runs` — toggle and attention list, in the pause banner's shape

**Model routing:** `sonnet`, effort `high` — a second instance of a shipped, reviewed component shape.

**Files:**
- Modify: `pwa/src/lib/api.ts` — `childReclaimPause` directly after `coordPause` (at planning line 786)
- Create: `pwa/src/fleet/childReclaimWords.ts`
- Create: `pwa/src/fleet/ChildReclaimBanner.tsx`
- Modify: `pwa/src/fleet/CoordBanner.tsx` — `function inlinePauseError` becomes `export function inlinePauseError`
- Modify: `pwa/src/screens/RunsScreen.tsx` — import; `<ChildReclaimBanner store={store} />` directly after `<CoordBanner store={store} />` (at planning line 666)
- Modify: `pwa/src/fleet/fleet.css` — directly after `.coord-toggle:disabled { cursor: default; }`
- Create: `pwa/test/child-reclaim-banner.test.tsx`
- Modify: `pwa/test/api.test.ts` (one case in the `coordPause` describe), `pwa/test/fleet-css.test.ts` (one describe after the coord banner's), `pwa/test/tap-targets.test.tsx` (the floored-rule loop)

**Interfaces:**
- Consumes: `POST /api/coord/reclaim-pause` (Task 6); `CoordStatus.reclaim` and `CoordStatus.childReclaimAttention` (Task 4); `isMarkerState`, `MarkerState`, `ChildReclaimAttention` (`shared/api.ts`); `COORD_CONFIRM_MS` (`coordWords.ts`); `COORD_UNSUPPORTED_TEXT`, `apiErrorText`, `ApiError` (`lib/api.ts`).
- Produces: `api.childReclaimPause(state: 'on' | 'off'): Promise<void>`; `CHILD_RECLAIM_MARKER_WORD`, `CHILD_RECLAIM_MARKER_GLYPH: Record<MarkerState, string>`; `childReclaimMarker(coord: unknown): MarkerState | null` (THE ONE READER of `CoordStatus.reclaim` — `null` means the server predates the field); `childReclaimAttentionOf(coord: unknown): ChildReclaimAttention[]` (THE ONE READER of `CoordStatus.childReclaimAttention`); `export function ChildReclaimBanner({ store?, childReclaimPause? }): ReactNode`; `export function inlinePauseError(err: unknown): string | null` (existing body, now exported).

- [ ] **Step 1: Write the failing tests**

(a) Create `pwa/test/child-reclaim-banner.test.tsx`:

```tsx
// The reclaim row on /runs (child-reclamation spec §5.8, §5.9): the switch on
// automatic child reclamation and the fleet-level attention list, in the pause
// banner's shape — rendered only once a coord frame has arrived, never
// optimistic, refusals inline. `coord-banner.test.tsx` is the template, case
// for case, because the row must behave exactly as its neighbour does.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { ChildReclaimAttention, CoordCapsView, CoordStatus } from '../../shared/api';
import { ChildReclaimBanner } from '../src/fleet/ChildReclaimBanner';
import {
  CHILD_RECLAIM_MARKER_GLYPH, CHILD_RECLAIM_MARKER_WORD, childReclaimAttentionOf, childReclaimMarker,
} from '../src/fleet/childReclaimWords';
import { COORD_CONFIRM_MS } from '../src/fleet/coordWords';
import { ApiError, COORD_UNSUPPORTED_TEXT } from '../src/lib/api';
import { ToastHost } from '../src/components/Toast';
import { FleetScreen } from '../src/screens/FleetScreen';
import { RunsScreen } from '../src/screens/RunsScreen';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null,
    close(): void {} }) as unknown as WebSocket,
});

const coord = (over: Partial<CoordStatus> = {}): CoordStatus =>
  ({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], ...over });

const item = (over: Partial<ChildReclaimAttention> = {}): ChildReclaimAttention => ({
  sessionId: 'ccrc-pwa-quiet-basin', runId: 41, token: 'tree-unreadable',
  sentence: 'ccrc could not read this worktree, so it cannot prove nothing here would be lost. Nothing was removed.',
  at: Date.now() - 60_000, ...over,
});

const NO_CAPS = (): Promise<CoordCapsView> => new Promise<CoordCapsView>(() => {});

const seen = (store: FleetStore, c: CoordStatus | unknown): void => {
  act(() => { store.setState({ coord: c as CoordStatus, coordFrameSeen: true }); });
};

describe('the reclaim row', () => {
  it('renders NOTHING before any coord frame — absence is not "running"', () => {
    const { container } = render(<ChildReclaimBanner store={makeStore()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the payload is there but coordFrameSeen is not — the flag gates, not the payload', () => {
    const store = makeStore();
    act(() => { store.setState({ coord: coord({ reclaim: 'set' }), coordFrameSeen: false }); });
    const { container } = render(<ChildReclaimBanner store={store} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a frame from a server that predates the field — not "unmeasurable"', () => {
    // An older server sends `{pause, mail}` alone. That is not a registry that
    // failed to list; it is a server that has no switch to show.
    const store = makeStore();
    seen(store, { pause: 'clear', mail: 'clear' });
    const { container } = render(<ChildReclaimBanner store={store} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders two cues, word and glyph, from parallel tables — never colour alone', () => {
    const store = makeStore();
    seen(store, coord({ reclaim: 'set' }));
    render(<ChildReclaimBanner store={store} />);
    expect(screen.getByText(CHILD_RECLAIM_MARKER_WORD.set)).toBeInTheDocument();
    const glyph = document.querySelector('.child-reclaim-glyph');
    expect(glyph?.textContent).toBe(CHILD_RECLAIM_MARKER_GLYPH.set);
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'Resume reclaim' })).toHaveClass('child-reclaim-toggle');
  });

  it('degrades a MarkerState from a newer build to unmeasurable, never a blank cell', () => {
    const store = makeStore();
    seen(store, { ...coord(), reclaim: 'quarantined' });
    render(<ChildReclaimBanner store={store} />);
    expect(screen.getByText(CHILD_RECLAIM_MARKER_WORD.unmeasurable)).toBeInTheDocument();
  });

  it("taps call childReclaimPause('on') and show pausing… — the word does NOT flip", async () => {
    const store = makeStore();
    seen(store, coord({ reclaim: 'clear' }));
    const childReclaimPause = vi.fn(() => new Promise<void>(() => {}));
    render(<ChildReclaimBanner store={store} childReclaimPause={childReclaimPause} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause reclaim' }));
    expect(childReclaimPause).toHaveBeenCalledWith('on');
    expect(await screen.findByText('pausing…')).toBeInTheDocument();
    expect(screen.getByText(CHILD_RECLAIM_MARKER_WORD.clear)).toBeInTheDocument();
  });

  it("a set switch taps childReclaimPause('off')", () => {
    const store = makeStore();
    seen(store, coord({ reclaim: 'set' }));
    const childReclaimPause = vi.fn(() => new Promise<void>(() => {}));
    render(<ChildReclaimBanner store={store} childReclaimPause={childReclaimPause} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume reclaim' }));
    expect(childReclaimPause).toHaveBeenCalledWith('off');
  });

  it('settles only when a LATER frame reports the value the tap asked for', async () => {
    const store = makeStore();
    seen(store, coord({ reclaim: 'clear' }));
    render(<ChildReclaimBanner store={store} childReclaimPause={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('pausing…')).toBeInTheDocument();
    seen(store, coord({ reclaim: 'clear', childReclaimAttention: [item()] }));   // a frame, still disagreeing
    expect(screen.getByText('pausing…')).toBeInTheDocument();
    seen(store, coord({ reclaim: 'set' }));
    expect(await screen.findByText('Resume reclaim')).toBeInTheDocument();
    expect(screen.getByText(CHILD_RECLAIM_MARKER_WORD.set)).toBeInTheDocument();
  });

  it('renders "unconfirmed — check /runs" when no frame confirms inside COORD_CONFIRM_MS', async () => {
    vi.useFakeTimers();
    try {
      const store = makeStore();
      seen(store, coord({ reclaim: 'clear' }));
      render(<ChildReclaimBanner store={store} childReclaimPause={vi.fn().mockResolvedValue(undefined)} />);
      fireEvent.click(screen.getByRole('button'));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => { await vi.advanceTimersByTimeAsync(COORD_CONFIRM_MS); });
      expect(screen.getByText('unconfirmed — check /runs')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the 501 inline with the one shared sentence, and drops back to idle', async () => {
    const store = makeStore();
    seen(store, coord());
    const childReclaimPause = vi.fn().mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
    render(<ChildReclaimBanner store={store} childReclaimPause={childReclaimPause} />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText(COORD_UNSUPPORTED_TEXT)).toBeInTheDocument();
    expect(document.querySelector('.child-reclaim-error')).not.toBeNull();
    expect(screen.queryByText('pausing…')).toBeNull();
  });

  it("renders the 502's stderr inline, not as a toast", async () => {
    const store = makeStore();
    seen(store, coord());
    const childReclaimPause = vi.fn().mockRejectedValue(
      new ApiError(502, { ok: false, stderr: 'ccd: reclaim-pause: permission denied' }));
    render(<><ChildReclaimBanner store={store} childReclaimPause={childReclaimPause} /><ToastHost /></>);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('ccd: reclaim-pause: permission denied')).toBeInTheDocument();
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('lists each child a terminal refusal left standing, with the SERVER\'s sentence and its run', () => {
    const store = makeStore();
    const a = item();
    const b = item({ sessionId: 'ccrc-pwa-dry-fern', runId: null, token: 'containment-unproven', sentence: 'a nested checkout of another repository holds work' });
    seen(store, coord({ childReclaimAttention: [a, b] }));
    render(<ChildReclaimBanner store={store} />);
    const rows = [...document.querySelectorAll('.child-reclaim-item')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('run #41');
    expect(rows[0]!.textContent).toContain(a.sessionId);
    expect(rows[0]!.textContent).toContain(a.sentence);
    expect(rows[1]!.textContent).toContain(b.sessionId);
    expect(rows[1]!.textContent).not.toContain('run #');
    // The PWA maps no token: the token itself is never the rendered text.
    expect(rows[0]!.textContent).not.toContain('tree-unreadable');
    // A report, not a tap: the only button on the row is the switch.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('renders no list when nothing is standing', () => {
    const store = makeStore();
    seen(store, coord());
    render(<ChildReclaimBanner store={store} />);
    expect(document.querySelector('.child-reclaim-attention')).toBeNull();
  });

  it('mounts on /runs, after the pause banner, and nowhere else', () => {
    const store = makeStore();
    seen(store, coord());
    const { container } = render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} />);
    const order = [...container.querySelectorAll('.coord-banner, .child-reclaim-banner')];
    expect(order).toEqual([container.querySelector('.coord-banner'), container.querySelector('.child-reclaim-banner')]);
    cleanup();
    const fleet = makeStore();
    act(() => { fleet.setState({ conn: 'open', sessions: [], coord: coord(), coordFrameSeen: true }); });
    render(<FleetScreen store={fleet} />);
    expect(document.querySelector('.child-reclaim-banner')).toBeNull();
  });
});

describe('the two tolerant readers', () => {
  it('childReclaimMarker: absent → null, unknown → unmeasurable, known → itself', () => {
    expect(childReclaimMarker(null)).toBeNull();
    expect(childReclaimMarker({ pause: 'clear', mail: 'clear' })).toBeNull();
    expect(childReclaimMarker({ reclaim: 'weird' })).toBe('unmeasurable');
    expect(childReclaimMarker({ reclaim: 'set' })).toBe('set');
  });

  it('childReclaimAttentionOf: absent or malformed → [], and a malformed member is dropped alone', () => {
    expect(childReclaimAttentionOf({ pause: 'clear' })).toEqual([]);
    expect(childReclaimAttentionOf({ childReclaimAttention: 'nope' })).toEqual([]);
    const good = item();
    expect(childReclaimAttentionOf({ childReclaimAttention: [good, { sessionId: 7 }, null, { ...good, runId: '41' }] }))
      .toEqual([good]);
  });
});
```

(b) `pwa/test/api.test.ts`, at the end of the `describe('coordPause (Task 11, spec §4.2)', …)` block:

```ts
  it('POSTs {state} as JSON to /api/coord/reclaim-pause — no box token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, requested: 'on' }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await api.childReclaimPause('on');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/coord/reclaim-pause');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ state: 'on' });
    expect(new Headers(init.headers).get('x-ccrc-mail-token')).toBeNull();
  });
```

(c) `pwa/test/fleet-css.test.ts`, directly after the `describe('the coord banner is not a living pane, and its toggle is a real target', …)` block:

```ts
// Child-reclamation wave 4: the reclaim row is the pause banner's shape, and
// holds its discipline — a switch is a STATE, not a living pane.
describe('the reclaim row is not a living pane, and its toggle is a real target', () => {
  const SELECTORS = ['.child-reclaim-banner', '.child-reclaim-banner .child-reclaim-glyph', '.child-reclaim-word',
    '.child-reclaim-toggle', '.child-reclaim-banner .child-reclaim-error', '.child-reclaim-banner .child-reclaim-attention',
    '.child-reclaim-banner .child-reclaim-who'];
  it('no .child-reclaim-* rule glows, breathes or animates', () => {
    for (const sel of SELECTORS) {
      const rule = norm(stripComments(ruleIn(css, sel)));
      expect(rule, sel).not.toContain('--glow');
      expect(rule, sel).not.toContain('animation');
      expect(rule, sel).not.toContain('box-shadow');
    }
  });
  it('.child-reclaim-toggle and the row clear the tap floor, off the shared token', () => {
    expect(declValue(ruleFor('.child-reclaim-toggle'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleFor('.child-reclaim-banner'), 'min-height')).toBe('var(--tap-min)');
  });
  it('.child-reclaim-banner is self-grounded — its own color AND background', () => {
    const rule = ruleFor('.child-reclaim-banner');
    expect(declValue(rule, 'color')).not.toBeNull();
    expect(declValue(rule, 'background')).not.toBeNull();
  });
});
```

(d) `pwa/test/tap-targets.test.tsx`: in the floored-rule loop (the array that already carries `ruleIn(fleetCss, '.coord-banner'), ruleIn(fleetCss, '.coord-toggle'),`), add directly after that pair:

```ts
      ruleIn(fleetCss, '.child-reclaim-banner'), ruleIn(fleetCss, '.child-reclaim-toggle'),
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd pwa && ./node_modules/.bin/vitest run test/child-reclaim-banner.test.tsx test/api.test.ts test/fleet-css.test.ts test/tap-targets.test.tsx
```

Expected: `child-reclaim-banner` FAILS at collection (`Failed to resolve import "../src/fleet/ChildReclaimBanner"`); `api` FAILS `api.childReclaimPause is not a function`; `fleet-css`'s three new cases and `tap-targets`' loop FAIL because `ruleIn` finds no `.child-reclaim-*` rule.

- [ ] **Step 3: The client call and the words**

`pwa/src/lib/api.ts`, directly after the `coordPause` entry:

```ts
    /** `POST /api/coord/reclaim-pause` (child-reclamation wave 4, spec §5.8) —
     *  the switch on automatic child reclamation. `state` is ccd's own on|off,
     *  passed through. Like `coordPause`, `ChildReclaimBanner` ignores the
     *  response and waits for the next `{type:'coord'}` frame's `reclaim` to
     *  confirm. No box token: an operator's same-origin write. */
    childReclaimPause: (state: 'on' | 'off') => post('/api/coord/reclaim-pause', { state }),
```

Create `pwa/src/fleet/childReclaimWords.ts`:

```ts
// The reclaim row's small vocabulary (child-reclamation wave 4) — parallel
// `Record<MarkerState, …>` tables, word and glyph, so no state is read out of
// colour alone (coordWords.ts's own discipline), and the ONE reader for each of
// the two `CoordStatus` fields this row renders.
//
// ITS OWN TABLES, not `MARKER_WORD`'s: those words are written for the
// coordinator pause ("dispatch would refuse"), and `coordWords.ts` says a
// second marker needs its own table rather than a widened reuse.
import { isMarkerState, type ChildReclaimAttention, type MarkerState } from '../../../shared/api';

export const CHILD_RECLAIM_MARKER_WORD: Record<MarkerState, string> = {
  clear: 'children are reclaimed when their runs close',
  set: 'child reclaim paused',
  unmeasurable: 'reclaim switch unreadable — the registry did not list',
};

export const CHILD_RECLAIM_MARKER_GLYPH: Record<MarkerState, string> = {
  clear: '·',
  set: '⏸',
  unmeasurable: '?',
};

/** THE ONE READER of `CoordStatus.reclaim`. THREE answers, never folded:
 *  `null` — the frame carries no such field, i.e. a server older than this
 *  switch, and the row renders NOTHING; a `MarkerState` it knows; and
 *  `'unmeasurable'` for a value it does not — a newer server's word degrades
 *  to doubt, never to `clear`, `markerState`'s own posture. */
export function childReclaimMarker(coord: unknown): MarkerState | null {
  if (typeof coord !== 'object' || coord === null) return null;
  const v = (coord as { reclaim?: unknown }).reclaim;
  if (v === undefined) return null;
  return isMarkerState(v) ? v : 'unmeasurable';
}

const isAttention = (a: unknown): a is ChildReclaimAttention => {
  if (typeof a !== 'object' || a === null) return false;
  const o = a as Record<string, unknown>;
  return typeof o.sessionId === 'string' && typeof o.token === 'string' && typeof o.sentence === 'string'
    && typeof o.at === 'number' && (o.runId === null || typeof o.runId === 'number');
};

/** THE ONE READER of `CoordStatus.childReclaimAttention`. The coord frame is
 *  shape-checked only at FRAME level (`stores/fleet.ts`), so an absent field
 *  (an older server) reads as no items, and a malformed member is dropped on
 *  its own rather than taking the list with it. */
export function childReclaimAttentionOf(coord: unknown): ChildReclaimAttention[] {
  if (typeof coord !== 'object' || coord === null) return [];
  const list = (coord as { childReclaimAttention?: unknown }).childReclaimAttention;
  return Array.isArray(list) ? list.filter(isAttention) : [];
}
```

In `pwa/src/fleet/CoordBanner.tsx`, change `function inlinePauseError(err: unknown): string | null {` to `export function inlinePauseError(err: unknown): string | null {` — one 501/502 inline policy for both rows, not a second copy.

- [ ] **Step 4: The row**

Create `pwa/src/fleet/ChildReclaimBanner.tsx`:

```tsx
// The reclaim row on /runs (child-reclamation spec §5.8, §5.9): the switch on
// AUTOMATIC reclamation of child workspaces, and the one fleet-level attention
// list — the children a terminal refusal left standing, and those whose reclaim
// has kept failing past the defer ceiling, each with the server's sentence.
// `CoordBanner`'s shape, deliberately, because an operator reading two
// switches in one place must not have to learn two behaviours:
//
//   • NOTHING renders until a `coord` frame has arrived (`coordFrameSeen`), and
//     nothing renders for a frame from a server that predates the field
//     (`childReclaimMarker` → null). An absent reading is not "running".
//   • The toggle is NOT optimistic: a tap moves only the button's own label, and
//     it settles only when a LATER frame reports the value the tap asked for;
//     `COORD_CONFIRM_MS` bounds the wait with an honest "unconfirmed".
//   • A 501 or 502 renders inline (`inlinePauseError`, shared with the pause
//     banner); anything else goes to the ordinary toast.
//
// The attention list is a REPORT, not a tap: no button, no link, no remedy
// offered. Rule 4 says the human does not tend sub-workspaces; this tells them
// what is costing disk, and asks nothing. The sentences are the SERVER's — the
// PWA renders them and maps no token.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { MarkerState } from '../../../shared/api';
import { COORD_CONFIRM_MS } from './coordWords';
import {
  CHILD_RECLAIM_MARKER_GLYPH, CHILD_RECLAIM_MARKER_WORD, childReclaimAttentionOf, childReclaimMarker,
} from './childReclaimWords';
import { inlinePauseError } from './CoordBanner';
import { api, apiErrorText } from '../lib/api';
import { toast } from '../components/Toast';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import './fleet.css';

type Phase = 'idle' | 'pausing' | 'resuming' | 'unconfirmed';

export function ChildReclaimBanner({
  store = useFleetStore,
  childReclaimPause = api.childReclaimPause,
}: {
  store?: FleetStore;
  /** Injectable so a test drives the toggle without a server — `CoordBanner`'s
   *  `coordPause` seam. Defaults to `api.childReclaimPause`. */
  childReclaimPause?: (state: 'on' | 'off') => Promise<void>;
}): ReactNode {
  const coord = store((s) => s.coord);
  const coordFrameSeen = store((s) => s.coordFrameSeen);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const wantedRef = useRef<MarkerState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const marker = childReclaimMarker(coord);

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // A NEW frame is a fresh measurement: it retires an inline refusal about the
  // old one (CoordBanner's M4), and it settles the outstanding tap ONLY when it
  // reports the value the tap asked for.
  useEffect(() => {
    setError(null);
    if (wantedRef.current !== null && childReclaimMarker(coord) === wantedRef.current) {
      wantedRef.current = null;
      clearTimer();
      setPhase('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coord]);

  useEffect(() => () => clearTimer(), []);

  if (!coordFrameSeen || coord === null || marker === null) return null;
  const attention = childReclaimAttentionOf(coord);

  const onToggle = (): void => {
    setError(null);
    const wantPause = marker !== 'set';
    const wanted: MarkerState = wantPause ? 'set' : 'clear';
    wantedRef.current = wanted;
    setPhase(wantPause ? 'pausing' : 'resuming');
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (wantedRef.current === wanted) setPhase('unconfirmed');
    }, COORD_CONFIRM_MS);
    childReclaimPause(wantPause ? 'on' : 'off').catch((err: unknown) => {
      wantedRef.current = null;
      clearTimer();
      setPhase('idle');
      const inline = inlinePauseError(err);
      if (inline !== null) { setError(inline); return; }
      toast(apiErrorText(err), 'error');
    });
  };

  const busy = phase === 'pausing' || phase === 'resuming';
  const toggleLabel =
    phase === 'pausing' ? 'pausing…'
    : phase === 'resuming' ? 'resuming…'
    : phase === 'unconfirmed' ? 'unconfirmed — check /runs'
    : marker === 'set' ? 'Resume reclaim' : 'Pause reclaim';

  return (
    <div className="child-reclaim-banner" role="status">
      <span className="child-reclaim-glyph" aria-hidden="true">{CHILD_RECLAIM_MARKER_GLYPH[marker]}</span>
      <span className="child-reclaim-word">{CHILD_RECLAIM_MARKER_WORD[marker]}</span>
      <button type="button" className="child-reclaim-toggle" disabled={busy} onClick={onToggle}>
        {toggleLabel}
      </button>
      {error !== null && <p className="child-reclaim-error">{error}</p>}
      {attention.length > 0 && (
        <ul className="child-reclaim-attention" aria-label="children reclamation could not clean up">
          {attention.map((a) => (
            <li key={a.sessionId} className="child-reclaim-item">
              <span className="child-reclaim-who">
                {a.runId === null ? a.sessionId : `run #${a.runId} · ${a.sessionId}`}
              </span>
              <span className="child-reclaim-sentence">{a.sentence}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

`pwa/src/screens/RunsScreen.tsx`: add `import { ChildReclaimBanner } from '../fleet/ChildReclaimBanner';` beside the `CoordBanner` import, and directly after `<CoordBanner store={store} />`:

```tsx
      {/* Child-reclamation wave 4 (spec §5.8, §5.9): the reclaim switch and the
          attention list, one row under the pause banner — `/runs` and nowhere
          else, rendering nothing until a coord frame that carries the field. */}
      <ChildReclaimBanner store={store} />
```

`pwa/src/fleet/fleet.css`, directly after `.coord-toggle:disabled { cursor: default; }`:

```css
/* The reclaim row (child-reclamation wave 4) — the pause banner's shape and its
   discipline: a switch is a STATE, not a living pane, so no --glow, no animation
   and no box-shadow anywhere under .child-reclaim-*. Self-grounded (its own
   color AND background) so `design/audit.mjs` recovers a ground for every
   descendant below; every ink here is one the coord banner already measures on
   --bg-surface, so no new colour pair is priced. */
.child-reclaim-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  min-height: var(--tap-min);
  padding: var(--sp-1) var(--sp-3);
  background: var(--bg-surface);
  border: 1px solid var(--edge-subtle);
  border-radius: var(--r-md);
  font: var(--weight-regular) var(--text-xs) / var(--leading-normal) var(--font-mono);
  color: var(--ink-secondary);
}
.child-reclaim-banner .child-reclaim-glyph { color: var(--ink-tertiary); flex: none; }
.child-reclaim-word { flex: 1; min-width: 0; }
.child-reclaim-toggle {
  flex: none;
  min-height: var(--tap-min);
  padding: 0 var(--sp-3);
  background: var(--bg-raised);
  border: 1px solid var(--edge-subtle);
  border-radius: var(--r-md);
  color: var(--ink-secondary);
  font: var(--weight-medium) var(--text-2xs) / 1 var(--font-mono);
  cursor: pointer;
  transition: transform var(--dur-press) var(--ease-swift);
}
.child-reclaim-toggle:active { transform: scale(0.96); }
.child-reclaim-toggle:disabled { cursor: default; }
.child-reclaim-banner .child-reclaim-error { flex-basis: 100%; margin: 0; color: var(--ink-secondary); }
.child-reclaim-banner .child-reclaim-attention {
  flex-basis: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--ink-secondary);
}
.child-reclaim-banner .child-reclaim-item { display: flex; flex-wrap: wrap; gap: var(--sp-2); min-width: 0; }
.child-reclaim-banner .child-reclaim-who { color: var(--ink-tertiary); }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd pwa && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run test/child-reclaim-banner.test.tsx \
  test/coord-banner.test.tsx test/api.test.ts test/fleet-css.test.ts test/tap-targets.test.tsx test/contrast.test.ts \
  test/runs-screen.test.tsx test/abandon-sheet.test.tsx
```

Expected: PASS — `child-reclaim-banner` 16/16; `coord-banner` unchanged; `contrast` finds every new colour rule under a self-grounded ancestor (its `uncovered` census does not grow); `runs-screen`'s banner-order cases still see `.coord-banner` where they expect it.

- [ ] **Step 6: Mutation check, then commit**

Each run: `cd pwa && ./node_modules/.bin/vitest run test/child-reclaim-banner.test.tsx` unless named.

| # | Edit | Expected red |
|---|---|---|
| 1 | Render the word from the tap: `CHILD_RECLAIM_MARKER_WORD[phase === 'pausing' ? 'set' : marker]` | *taps call childReclaimPause('on') … the word does NOT flip* |
| 2 | Delete `!coordFrameSeen \|\|` from the render gate | *renders nothing when the payload is there but coordFrameSeen is not* |
| 3 | In `childReclaimMarker`, `if (v === undefined) return null;` → `if (v === undefined) return 'unmeasurable';` | *renders nothing for a frame from a server that predates the field* and *childReclaimMarker: absent → null* |
| 4 | Render `{a.token}` in place of `{a.sentence}` | *lists each child … with the SERVER's sentence* |
| 5 | Delete `<ChildReclaimBanner store={store} />` from `RunsScreen.tsx` | *mounts on /runs, after the pause banner* |
| 6 | Add `box-shadow: var(--shadow-1);` to `.child-reclaim-banner` | `cd pwa && ./node_modules/.bin/vitest run test/fleet-css.test.ts` — *no .child-reclaim-* rule glows* |

```bash
git add pwa/src/lib/api.ts pwa/src/fleet/childReclaimWords.ts pwa/src/fleet/ChildReclaimBanner.tsx \
        pwa/src/fleet/CoordBanner.tsx pwa/src/screens/RunsScreen.tsx pwa/src/fleet/fleet.css \
        pwa/test/child-reclaim-banner.test.tsx pwa/test/api.test.ts pwa/test/fleet-css.test.ts pwa/test/tap-targets.test.tsx
git commit -m "$(cat <<'MSG'
feat(pwa): the reclaim row on /runs — the switch and the attention list

A second row under the pause banner, in its shape: nothing until a coord
frame that carries the field, a toggle that settles only on the frame that
confirms it, 501/502 inline through the pause banner's own policy. Below
it, each child a terminal refusal left standing or whose reclaim keeps
failing, with the server's sentence — a report with no control on it
(spec §5.8, §5.9).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: Whole-branch verification, the AGENT-FIRST deploy order, and the PR

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified, unless Step 3's re-measurement moves the citation census (then `server/test/session-hook.test.ts` / `README.md`, committed as its own `docs(census)` commit on this branch). The census has two taxed sources in this wave — `ccd/ccd` (Task 2) and `shared/api.ts` (Task 4).

**Interfaces:**
- Consumes: everything Tasks 2–9 produced.
- Produces: the wave-4 PR, and — after it merges — a fleet box advertising `reclaim-pause-v1` before the server that composes the verb. Wave 5 consumes `FleetWatcher.currentChildReclaimDefers()`, `CHILD_RECLAIM_DEFER_CEILING_MS`, `CoordStatus.childReclaimAttention` (and `CoordStatus.reclaim`, contract §7 R7's fleet-wide `paused`), `ChildReclaimAttention`, and the three exports of `server/src/coord/childReclaim.ts` it imports as-is and moves nothing: `childReclaimTokenKind` (contract §7 R15), `childReclaimGeneration` (contract §7 R6, its edges as §8 R22 pins them — the chip calls it with `at` = the run's `closedAt`) and `childReclaimLatest` (contract §8 R21 — the chip reads the same latest event, `intent` included, and falls through to its row rule on an `intent`). The sweep entry it reads carries both clocks and the failure count (`firstDeferredAt`, `firstPresenceDeferredAt`, `consecutiveFailures`, `lastFailedAt` — contract §8 R4′, R20).

- [ ] **Step 1: All three package suites, in the foreground**

```bash
cd server && npm ci && find test -name '*.test.ts' | wc -l
cd server && ./node_modules/.bin/vitest run --shard=1/6
cd server && ./node_modules/.bin/vitest run --shard=2/6
cd server && ./node_modules/.bin/vitest run --shard=3/6
cd server && ./node_modules/.bin/vitest run --shard=4/6
cd server && ./node_modules/.bin/vitest run --shard=5/6
cd server && ./node_modules/.bin/vitest run --shard=6/6
cd agent  && npm ci && npm run test
cd pwa    && npm ci && ./node_modules/.bin/tsc --noEmit && npm run test
```

Each command in the FOREGROUND with a timeout of 600000 ms, one after another — never as parallel calls (the timing suites red under concurrent load). ONE denominator for the whole set: vitest 4's `calculateShardRange` gives the remainder files to the low shards, so `1/3` + `3/6…6/6` — the set this plan once named — leaves one file in no shard whenever the count `n` has `n % 6` in {2, 3} (375 files at planning: index 125 ran nowhere). If a shard overruns 600 s, re-run the WHOLE set as `--shard=k/12`, never one shard split alone. Expected: PASS in all. Record each shard's `Test Files` and `Tests` counts, and check the file counts: **the six `Test Files` numbers must sum to the `find … | wc -l` printed first.** A shortfall is a file no shard ran — find it (`./node_modules/.bin/vitest list --filesOnly --shard=k/6` per shard, diffed against the `find`) and run it by name before calling the suite green. Re-run `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state` and `ccd-bounded-reads` IN ISOLATION before calling any of them a real break. The wave-done mail's `suite:` line is `green` only if this FIRST full run was green (worker clause 15).

- [ ] **Step 2: Cross-tree deviation check**

```bash
git fetch origin main && cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```

Expected: PASS. It compares this branch's `D-N` definitions against `origin/main`'s without merging and reds on any allocator-era number defined in two plans.

- [ ] **Step 3: The citation corpus, re-measured on the tree that will merge**

```bash
git merge-base --is-ancestor origin/main HEAD && echo "base is current" || echo "origin/main moved"
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS ITS OWN CENSUS ENTRY|LISTS ARE LOCATION INDEXES|ROW PASS: the exact set|THE RANGE BOUND'
```

If `origin/main` moved and touched `ccd/ccd`, `ccd/ccrc` or `shared/api.ts`, merge it into this branch first (`git merge origin/main`, resolving `ccd/ccd`'s line 2 by RE-STAMPING, never by taking a side), then run the filter. Expected: PASS. If red, apply the procedure for the file the red names — Task 2 Step 7's for a `ccd/ccd` anchor (README first, then dump and re-measure with the composition named), Task 4 Step 8's for a `shared/api.ts` anchor (README by content, `diff`-proved, then the debt census re-measured) — and commit it as `docs(census): re-measure the citation corpus on the merged tree (S6-R11)`.

- [ ] **Step 4: The wave's own surface, in one run**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pause.test.ts test/ccd-coord-pause.test.ts \
  test/ccd-archive.test.ts test/caps-token-shape.test.ts test/ownership.test.ts test/whitelist-subset.test.ts \
  test/capsupported.test.ts test/child-reclaim-pause-route.test.ts test/coord-pause-route.test.ts \
  test/coordinator-skill.test.ts test/auth-gate.test.ts test/verb-gate.test.ts test/box-token-census.test.ts \
  test/fleetws.test.ts test/single-definition.test.ts test/mail-routes.test.ts \
  test/child-reclaim-sweep-policy.test.ts test/child-reclaim-sweep.test.ts test/child-reclaim-paused-at-server.test.ts \
  test/child-reclaim-generation.test.ts test/ccd-reg-get-census.test.ts test/ccd-refusal-scan.test.ts \
  test/child-reclaim.test.ts
cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts
cd pwa && ./node_modules/.bin/vitest run test/child-reclaim-banner.test.tsx test/coord-banner.test.tsx test/api.test.ts test/fleet-css.test.ts test/tap-targets.test.tsx
```

Expected: PASS. If `ownership` reds, `ccd/ccd` was edited after the last re-stamp.

- [ ] **Step 5: Push and open the PR — this workspace's own branch**

```bash
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Child reclamation wave 4: the sweep, the switch and the attention list" --body-file - <<'EOF'
Wave 4 of the child-reclamation programme (spec §5.7–§5.9), **AGENT-FIRST**. Rule 4, measured: an orphaned child is reclaimed with no human act, and the switch stops it from a phone.

1. **`ccd reclaim-pause --state on|off`** — `coord-pause` copied in every respect onto `$REG/reclaim-paused`, advertised as `reclaim-pause-v1`. A scan holds its path equal to the one wave 3's `ws-reclaim` reads at rung 3 and on resume: the switch is real because the deleting verb reads it on the box. The function sits directly after `cmd_ls`, below the frozen citation corpus's anchors into `ccd/ccd` (`:19131`) and outside every function slice `ccd-refusal-scan` reads; `cmd_caps` gains two bare lines (contract §7 R9, §8 R9′).
2. **The grant** — `['reclaim-pause','--state']`, enrolled in `REQUIRED_VERB_FLAG` (negative fixture `g14`). `CCD_ARGV.reclaimPause` and `RECLAIM_PAUSE_CAP`, read with `capSupported` only.
3. **`POST /api/coord/reclaim-pause`** — session-gated, no box token: `SESSION_ONLY` beside the caps dial, not an `UNGATED` release valve. Exempt from, and forbidden in, the coordinator skill corpus. `auth-gate` moves 30→31 and 81→82; CLAUDE.md's session-only sentence and `verb-gate`'s `CAP_GATED_VERBS` move with it. The marker rides the coord frame as `CoordStatus.reclaim`, and the one executor close and the sweep share reads it at the place wave 3 marked in `childReclaimOutcome` — after the sibling re-read, before presence and any argv — and defers `paused-at-server` through that function's own `deferred(...)`, so its one feed row records it (the close path's skip, spec §5.8; its producer and its place are contract §7 R8 and §8 R8′).
4. **`sweepChildReclaim`** — a sibling lane (the census may not mutate) whose decisions are one pure L1 file. The marker is the subject; an absent minting run is NEVER eligible (a lost database makes every child's run absent at once) and is logged once; orphans are reached through a live minting run naming a different session outside the spawn-stall window; a REVIEW child is kept while the run it reviewed is not terminal (contract §7 R16), and an absent reviewed run is logged exactly like an absent minting run (§8 R16′); eligibility is observed twice, 60 s apart. The in-memory entry keeps two clocks (§8 R4′): every request carries `deferredSinceMs`, the first deferral of ANY kind the sweep saw (§7 R4), and `deferExpired` is set only once the first PRESENCE deferral has lasted 15 minutes — to wave 3's one executor, on the session's own queue, whose feed row states the wait. A child whose reclaim keeps failing backs off `min(ceiling, 60 s × 2^k)` (§8 R20). Nothing while `reclaim-paused` stands or without `reclaim-v1`.
5. **The attention list** — each child whose latest reclaim event is a terminal refusal, or the last of a run of failures that has lasted the ceiling (§8 R20; the failing child is still retried), while its registry row still exists, with the server's sentence; derived from the lifecycle mirror alone, so a restart rebuilds it — an audit-time TERMINAL refusal is there through wave 3's `verb ws-audit` journal line, whose token list equals the kind map's terminal arm (§8 R5′), and no executor answer feeds the frame (§7 R5) — within each id's current workspace generation, cut by `childReclaimGeneration(events, now)` (§7 R6; no `done` create at or before now answers nothing, §8 R22; only ccd's own `at` places a boundary or an item, never the mirror's ingest time, §8 R22′), its latest reclaim event of ANY outcome picked by `childReclaimLatest` (an `intent` newer than every outcome lists nothing, §8 R21) — both exported for wave 5; rendered as a report under the switch on `/runs`. The token kind is read through `childReclaimTokenKind`, one exported reader beside wave 3's `CHILD_RECLAIM_TOKEN_KIND` (§7 R15).

**Deploy order is not optional.** After merge, the release lane cuts a prerelease; move the fleet with `ccrc rollout --to <that tag>` WITHOUT `--server-first` — its default moves the fleet box first. Confirm the fleet box echoes `reclaim-pause-v1` before calling the server side live.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 6: Deploy — after merge, fleet box FIRST (run by the session the coordinator names)**

A merge to `main` becomes a GitHub PRERELEASE within about a minute (`release-main.yml`); a bare `ccrc rollout` pins the newest STABLE, so a dev build is `rollout --to`. From a machine with ssh to both boxes, with `~/.ccrc/deploy.env` supplying `CCRC_BOX`, `CCRC_AGENT_BOX`, `CCRC_SSH_KEY` and `CCRC_SSH_PORT`:

```bash
TAG=$(gh release list --limit 1 --json tagName --jq '.[0].tagName')   # the prerelease this merge cut
ccrc rollout --to "$TAG" --check      # preflight: each box's CCRC_ROLE, the pinned version, what would move
ccrc rollout --to "$TAG"              # DEFAULT ORDER: fleet box, then server box — never --server-first here
set -a; . ~/.ccrc/deploy.env; set +a
ssh -i "$CCRC_SSH_KEY" -p "$CCRC_SSH_PORT" "$CCRC_AGENT_BOX" '~/.local/bin/ccd caps' | grep -x -e reclaim-pause-v1 -e reclaim-v1
```

Expected: `--check` names both boxes and `$TAG`; the rollout moves the fleet box, then the server box, and exits 0 (exit 3 means a box is ON the new build with FAIL doctor lines — report them, do not re-run); the `grep` prints `reclaim-pause-v1` and `reclaim-v1`. If `reclaim-pause-v1` is missing, the fleet half did not land: **stop, report, and move nothing further.** On a fleet box where it is present, the phone's reclaim row answers 200 rather than 501 once the server has cached the agent's new caps.

- [ ] **Step 7: Report**

The wave-done mail to the coordinator, opening with the two signal lines (worker clause 15), then: the branch tip sha; each suite's result and the shard set; `ccd caps`' two token lines from the fleet box (when Step 6 ran); the deploy order actually executed; Task 1 Step 3's six facts (the fixture number used, the `ChildReclaimDeps` literal `execChildReclaim` composes, whether wave 3 spelled `'reclaim-paused'`, that `paused-at-server` was unproduced before Task 5 as contract §7 R8 has it and that wave 3 marked its place inside `childReclaimOutcome` between the sibling re-read and presence (§8 R8′), the pre-wave auth-gate counts, and the terminal-only `verb ws-audit` journal line with its six-token pattern, equal to `CHILD_RECLAIM_TOKEN_KIND`'s terminal arm, R5 as §8 R5′ amends it) and Step 1's three ruled surfaces found on the base (`ChildReclaimRequest.deferredSinceMs`, `childReclaimDecision`'s `review-report-live`, `RunSummary.reviews`); Task 2 Step 3's placement measurement (every `ccd-refusal-scan` slice `clear`, and where `cmd_ls` closes) and Step 4's two-line length measurement above `ccd/ccd:19131`, and Task 2 Step 7's, Task 4 Step 8's and Task 10 Step 3's census composition (Task 4 Step 8's README re-pointing and the `'shared/api.ts'` debt entry, old -> new); that `ccd-reg-get-census` moved nothing (R10); the shard file-count sum against the `find` total; and every departure from this plan, each named by slug for the coordinator to number (never a number the worker chose — a session that cannot reach the coordinator writes `D-TBD-<slug>` and says so). The contract's §7 and §8 rulings answered every question this plan once held for the coordinator — the pause producer (§7 R8) and its place (§8 R8′), the elapsed wait (§7 R4, which REPLACED the run-trail stand-in this plan once wrote) and its two clocks (§8 R4′), the failure backoff and its listing (§8 R20), the latest-event rule (§8 R21) and the generation edges (§8 R22) — so the mail carries no contract-gap report.

---

## Deviations found

Numbers are ISSUED, never chosen. This programme's coordinator allocated ONE block at run-open, and every wave draws from it; a worker never calls the allocator (worker clause 11). A departure from this plan found while executing it is named by a short slug in the wave-done mail, and the coordinator assigns it a number from the block and defines it here — number and definition in one act. A session that cannot reach the coordinator writes `D-TBD-<slug>` in its report and says why. No block is written as a range, and no headroom count lives in this file.

---

## Review lenses

Four lenses for this wave, all `opus`. The first two are MANDATORY, effort **`xhigh`**; the others `high`.

1. **SAFETY — the automatic trigger (opus, xhigh, MANDATORY).** This wave adds the only path that asks for a deletion with no human in it. Prove every fail direction is SHUT, by reading `childReclaimSweepVerdict` and its call site together: an absent minting run is never eligible (and a lost database cannot make any child eligible); unreadable marker, unreadable run, unreadable siblings, unmeasured identity and a failed mirror read each mean "not this pass"; a REVIEW child is ineligible while the run it reviewed is not terminal, and an absent or unreadable reviewed run keeps it too — the orphan branch included (contract §7 R16); presence can defer but never reset the ceiling; the entry's TWO clocks never fold (contract §8 R4′) — `deferExpired` can only be set by `firstPresenceDeferredAt`, a presence-class deferral that lasted `CHILD_RECLAIM_DEFER_CEILING_MS`, so a `held`, `paused` or `state-changed` deferral can never expire presence, while `deferredSinceMs` is `firstDeferredAt`, the first deferral of any kind, never an earlier one (§7 R4); a run of failures backs off `min(ceiling, interval × 2^k)`, any other outcome ends it, and a child listed for failing past the ceiling is still RETRIED — the lane's terminal exclusion reads terminal refusals through `childReclaimTerminalRefusal`, never the attention list (§8 R20); a child is never asked for twice while in flight; nothing is asked on a box without `reclaim-v1` or while `reclaim-paused` stands; an executor answer that returns after a pass cleared the memory is dropped rather than written back; a terminal refusal found at AUDIT time reaches the mirror through wave 3's `verb ws-audit` journal line — terminal-only, its token list equal to the kind map's terminal arm, `no-worktree-record` included (contract §8 R5′, R19) — and so keeps the child off the lane and on the attention list, across a restart, because the mirror is the ONLY source (contract §4, §7 R5) and no executor answer or in-memory memo feeds either; the latest reclaim event decides whatever its outcome, so an `intent` newer than a refusal lists nothing (§8 R21, one `childReclaimLatest`, no lane-local pick); the token kind comes from the one exported `childReclaimTokenKind`, never a copy in `watch.ts` (R15); a mirror refusal or failure binds to the current workspace generation through `childReclaimGeneration(events, now)` — re-derive its two bounds against `ws-add`'s `create` journal lines (a refused or unfinished `create` must open nothing; no `done` create at or before `at` answers `[]`, never another generation's rows; the closing bound is the first `done` create after `at`; time is ccd's `at` ALONE, never `ingestedAt` (D8), so a `done` create with a null `at` opens and closes nothing and the rows around it fall by `id` order — §8 R22′), state what an empty generation costs (a child neither listed nor held off the lane: a retry ccd refuses again on the box), and confirm there is no second implementation of it or of `childReclaimLatest` (§7 R6, §8 R21). An absent minting run and an absent reviewed run are each logged once (§8 R16′). And the executor: the pause is read at wave 3's marked place in `childReclaimOutcome` — after the sibling re-read, before presence and any argv, through its own `deferred(...)` so the one feed row records it, never in the `reclaimChild` wrapper (§8 R8′) — on both triggers, and `deferExpired` cannot reach past it (Task 5). Re-derive the orphan predicate against dispatch's two unbound-child arms in `coord/dispatch.ts` rather than trusting the docstring. Confirm the sweep composes wave 3's executor with the SAME deps the close route does, on `deps.queue` keyed by session id.
2. **SECURITY — the grant and the door (opus, xhigh, MANDATORY).** The untrusted-input lens. `['reclaim-pause','--state']` is two tokens wide and enrolled (`g14` is TS2322; `auditExecWhitelist` refuses the bare shape at module load); `gh` is still ungranted; the route is session-gated when armed and carries no box token; the coordinator corpus neither names the route nor may; the route validates the body to exactly `on|off` before any argv exists; the `capSupported` gate refuses on no evidence. And the switch's REALITY: re-derive, from `ccd/ccd` itself, that `ws-reclaim` reads `$REG/reclaim-paused` on its fresh arm and on resume — this wave's scan asserts the spelling, and the lens asserts the semantics.
3. **Census and prose (opus, high).** Every guard that describes the door surface moved in the commit that moved the surface: `SESSION_ONLY` (both directions), `EXEMPT` plus the forbid-mention case, CLAUDE.md's session-only sentence (and no CAPS count word added to that bullet), `auth-gate`'s counts re-measured rather than typed (51 / 31 / 82), `verb-gate`'s `CAP_GATED_VERBS`, the single-definition pin, `mail-routes`' `NOT_CODES`, `KNOWN_CAPABILITY_TOKENS` appended not rewritten, `cmd_reclaim_pause` placed after `cmd_ls` and outside every `ccd-refusal-scan` slice (its mutation row moves it back and reds that suite), the `CAP_GATED_VERBS` docstring phrased without an ordinal, no committed code comment citing the contract rather than the spec (contract §8 R23), Task 2's (`ccd/ccd`) and Task 4's (`shared/api.ts`) S6-R11 compositions stated rather than inferred — README re-anchored by content and `diff`-proved, never by a delta, and the whole-branch run on ONE shard denominator whose file counts sum to the `find` total.
4. **PWA honesty (opus, high).** The row renders nothing before a frame and nothing for an older server (never "unmeasurable" for absence); the toggle is not optimistic and settles only on a confirming frame; 501/502 inline through the one shared policy; the attention list is a report with no control on it and renders the server's sentence, never a token; `.child-reclaim-*` carries no glow and clears the tap floor; the wire readers tolerate every absent and malformed shape.

## Pre-dispatch amendments (coordinator, 2026-09-26) — binding

This plan was written on 2026-09-22. That was before wave 3 was amended (its plan's R-1 to R-8 and A1 to A10), before wave 3
shipped with its ruled departures (3352 to 3368 and 3513 to 3520, defined in wave 3's plan), before contract R25, R32 and R33, and before the
ledger carried a dozen items into this wave.

On 2026-09-26 a pre-flight read the plan against three sources:
- wave 3 as it merges (`1715d410`, PR #187);
- the contract (§9, R24 to R33);
- the ledger.

It ran four Opus lenses: interfaces, carried items, safety, and rulings. It found three BLOCKING defects:
- Task 1 stops on its own fact 4 (A1);
- the presence ceiling licenses `--defer-expired` for good (A9);
- R32 is contradicted by the plan's own tests (A9, A10).

It also found every carried item unplaced. The coordinator drafted rulings, and three more Opus agents then attacked them
before they were sent. The attacks turned up three more problems, and the rulings below incorporate their amendments:
- a hand hold in the programme grammar, which the operator is told to write (R-1);
- a cross-attempt adoption, which is live (R-3);
- starvation and a stranding fence (R-5).

These amendments are part of the plan: where one contradicts a task's text, the amendment wins. Plan citations inside
this section (`plan:NNNN`) refer to this file as it stood before this section was appended; every line above it is
unchanged except line 12's pointer. Code citations are to wave 3's tip. They are snapshots, so locate code by content.
The pre-flight's and the attacks' records are in the coordinator's clips (`wave4-preflight/`) and are summarised here.

### Rulings (the coordinator's, 2026-09-26; contract §10, R34 to R37)

- **R-1 — R32 is built as a RELEASE, then the ordinary path, and a hold is ACCOUNTED, never parsed.**

  A hold does not protect a marked child when all of the following hold. They are decided in this order, and any
  unmeasured answer keeps the hold:
  1. The minting run is proven present and TERMINAL (the orphan branch never releases a hold), and R-5d's fence passes.
     This is decided after `minting-run-absent` and `minting-run-open`, never above them.
  2. The hold is ACCOUNTED FOR. Among the runs whose `sessionId` is this child, plus the minting run, some TERMINAL run R
     renders exactly the hold's text as the registry reads it (trimmed). The text must match one of two renderings:
     - `holdReason(R.program, R.wave, R.waveOf, R.id)`, the open/dispatch claim;
     - `holdReason(R.program, R.wave + 1, R.waveOf, null)`, a non-final close's claim.

     The text is compared with the server's own renderings, never parsed. `run-routes.test.ts`'s "NOTHING in the tree
     parses one back" stays green and unedited. Everything else protects:
     - a human's hold, in or out of the programme grammar. Build 8's hand-hold convention and the PWA's
       `program:name wave:2/4` placeholder both write the grammar on purpose;
     - `HOLD_UNREADABLE` and `HOLD_NO_REASON`;
     - a claim written by a run the database does not have, as after a restored snapshot.
  3. R.program's open-run count reads, and reads zero.
  4. No open run names the child, and the child has never coordinated a run (R-5c).

  **The mechanism.** The sweep does NOT reclaim such a child directly, because ccd's rung 4 refuses any hold.
  - When the conditions hold on two consecutive passes, the lane queues ONE release job on the child's own `KeyedQueue`
    key.
  - The job re-reads everything it relies on:
    - the row: the marker names the same run, and the held text is equal after the trim;
    - the accounting: the same R;
    - R.program's count;
    - the child's open runs;
    - the coordinator reads.
  - Every read is try-wrapped. A throw or an `ok:false` answers `failed` and composes no argv.
  - Only then does it compose `CCD_ARGV.wsRelease`, gated as the close gates it (`verbSupported`). The release deletes
    nothing but the hold file.
  - The now-unheld child is then judged afresh by the ordinary verdict. It is reclaimed only after two further passes,
    through `reclaimChild`, whose re-reads and ccd's in-lock ladder stand unchanged.

  **The in-lock compare-and-swap is declined.** It would be a `--retired-hold <reason>` flag on `ws-audit --reclaim` and
  `ws-reclaim`. Neither `ws-hold` nor `ws-release` takes a lock, so an in-lock compare only moves the window; it does not
  close it. The tail's `_reg_purge` already removes a hold written after rung 4. The flag would also need new argument
  parsing in `cmd_ws_audit`, above the frozen boundary.

  **The residual, accepted and recorded:**
  - (a) A hold written between the job's re-read and ccd's unlink is removed. That window is under a second: one agent
    exec, ccd startup, and its journal write. A hand hold lost this way means the child is reclaimed two passes later.
    Its commits and uncommitted work are pinned, but its pane, clips, temp root and ignored files are not (R30). A
    re-bind in the window stays protected by its open run, and is re-held at its dispatch.
  - (b) A hand hold that is byte-identical to the claim the server itself last wrote is treated as that claim.
- **R-2 — R32's three words.** `ChildReclaimNotWhy` gains three words. The contract's "unmeasurable" is spelled
  `-unmeasured`, to match `ChildSpentVerdict`:
  - `not-finished-undated`: the live rung answered spent, but no dated row proves `this`;
  - `not-finished-unmeasured`: the spent verdict was unmeasured;
  - `not-finished-merge-commit`: a fast-path (registry or `.prhistory`) spent was re-dated `unspent`.

  Plain `not-finished` stays for the ordinary unspent hand-over. With R-5c's `has-coordinated` (A6), there are ten words.
  They ride the close response only; nothing persists them in this wave. Whether wave 5 records them is wave 5's
  pre-flight's question.
- **R-3 — R33 is built as a write-once birth per BOUND session.** It is not a first stamp per run.
  - A new server-only column, `sessionBornAt`. The fresh arm captures its stamp once, passes it to
    `markDispatchStarted`, and binds with it. An ADOPTED winner binds with null, because an adopted workspace may be an
    earlier attempt's: `dispatch.ts`'s BEFORE read tolerates an unlistable registry as empty, and its own §1.5 comment
    says such a false-new "WOULD BE ADOPTED". That is contract R33's live path. A null birth is unplaceable, so the bind
    refuses on any PR evidence and the close holds. A final close, R-1 and the sweep still reclaim the child, because none
    of them reads the birth.
  - The open route's bind leaves a same-session birth untouched, and nulls it when the session changes. `clearSession`
    nulls it. `dispatchStartedAt` keeps its every-attempt meaning, for the stall render, `SPAWN_STALL_MS` and this
    plan's `dispatch-in-flight` rule.
  - Backfill: `sessionBornAt = dispatchStartedAt` where `sessionId` is not null, EXCEPT runs with a `spawn-adopted:` run
    event. Residual: an adoption whose dispatch never committed wrote no event, and keeps a possibly late birth, in
    R33's narrow class.
  - A COALESCE'd first stamp per run is declined. A failed fresh attempt followed, perhaps days later, by a successful
    mint would date the child to the failed attempt.
- **R-4 — the presence ceiling licenses ONE attempt per continuous episode** (spec §5.7: "15 minutes of continuous
  deferral"). Any outcome other than a presence-class deferral ends the episode, including a refusal (R-5g). A request
  sent licensed restarts the episode if it still comes back presence-class (A9). This is BLOCKING. As written, every
  later retry would skip ccd's `attached` and `tree-busy` rungs, and the tail would kill a pane an operator had just
  opened.
- **R-5 — the sweep's own bounds.**
  - (a) At most `CHILD_RECLAIM_MAX_IN_FLIGHT = 1` lane-asked reclaim at once. Close-path reclaims are not counted, and
    neither is R-1's release job. Due children are sorted by `lastAskedAt` (never-asked first), then `firstEligibleAt`,
    then id, so a child that defers every pass cannot hog the slot. A request that has not settled after twice the
    reclaim budget (480 s) stops counting against the bound. It stays in flight, and the stall is logged once.
  - (b) The lane runs only where BOTH `reclaim-v1` and `reclaim-pause-v1` are advertised, so no automatic reclaim runs
    on a box whose kill-switch the phone cannot raise. The attention list is still computed.
  - (c) A child that has EVER coordinated a run is never reclaimed automatically: not by the sweep, and not by the
    close. The operator's rule 4 reserves manual cleanup for coordinator workspaces, and clause 3 says a coordinator's
    own workspace is cleaned up by a human, never by a sweep. It covers a child made a programme's heir (the reclaim
    door re-writes `claimedBy`) and any nested coordinator. The lane skips such a child as `coordinating`. The close
    answers `has-coordinated` (A6). The executor defers `siblings-open`, detail "`<id>` has coordinated run(s)". An
    unreadable read defers or skips, and never proceeds.
  - (d) Run ids restart after a coord.db loss (`reconstruct` mints fresh AUTOINCREMENT ids). So a minting run opened
    after the OPENING `create` row of the child's CURRENT generation, plus the skew, is not its minting run: skip it as
    `minting-run-postdates-child`. A child with no such row skips as `child-birth-unplaced`.
    - The row is read by a new, uncapped store read of the session's `create` rows. It is never the 500-row lifecycle
      window, which a failing child scrolls through in days, and never the oldest `create`, which would skip every
      recycled slug.
    - The check sits after `minting-run-open` and `dispatch-in-flight`, and before R-1.
    - Each skip is logged once, naming both instants, their difference, and both possible causes: a rebuilt database, or
      the fleet box's clock behind the server's.
    - After a database loss, pre-loss children are skipped until a human acts. That is fail-closed and accepted.
  - (e) The lane's defaults are unmeasured, never "absent" or "zero".
  - (g) A terminal refusal keeps its entry, with `firstPresenceDeferredAt: null` and `refusedAt: now`, and is re-asked no
    sooner than the defer ceiling after `refusedAt`. This is lane pacing only; nothing feeds the frame (R5).
  - (h) A workspace-less row is `not-a-workspace` (defence in depth; ccd's rung 1 refuses it too).
  - The pre-flight's (f), clearing the memory after a tick gap, is DROPPED. Both verdicts it would discard are fresh
    reads, and ccd re-checks everything under its lock.
- **R-6 — R25's orphan temp-root collector moves to wave 5**, with its own token, grant and SAFETY lens.
  - It is a second no-human destructive path, and R25 itself accepts the interim leak. `ccd-tmp-sweep` runs from a
    systemd timer only, so the collector will be a capability-gated verb driven by the server lane.
  - The requirements the pre-flight measured go to wave 5's plan:
    - re-check under the per-id lock;
    - no `$REG` entry of any suffix;
    - two consecutive clean listings;
    - the pause absent;
    - a leaf older than a stated age;
    - never follow a link;
    - extract the tail's temp-root removal as the one helper.
  - This plan's line 24 is corrected for R-1 (A15).
- **R-7 — `is_ours` three-valued leaves this programme.** Since R28 no reclamation reader consults `ours`, and every
  remaining effect is fail-closed or cosmetic. It goes to a follow-up, with the pre-flight's measured instrument, taken
  with the `^{commit}` peel `is_ours` uses:
  - `cat-file -e` answers 128 both for a missing object and for an unreadable repository;
  - `cat-file --batch-check` answers `missing` at rc 0, and 128 when the repository is unreadable.
- **R-8 — `_ws_attic_pin`'s capped reflog read leaves this wave for a one-wave follow-up, `reap-attic-complete`.**
  Number 3515 (wave 3's plan) said its copy of F3's defect was wave 4's, but the attack measured that it cannot be fixed in place:
  - it has two callers, `ws-reap` and `ws-rm`, both ignoring its status;
  - `ws-reap` has no pin-failure path;
  - the attic's one-ref-per-commit shape is read by the tombstone, the reap sheet's "N commits pinned", two specs and
    `ccd-ws-reap`/`ccd-ws-rm-attic`'s tests.

  The follow-up owns both callers, a ruled attic shape, every consumer, and a real failure path.
- **R-9 — nested checkouts get rung 6's parity.** A held `index.lock` and an in-progress operation each refuse
  `tree-busy`, naming the nested path (A3).
- **R-10 — the close's second `pr-state` call is removed, not documented.** It is replaced by `verifyDone`'s measured
  line, which is the same measurement (A7).
- **R-11 — failures that never reach the mirror stay off the attention list in this wave.** These are:
  - the audit-time `unmeasured`;
  - `probe-unmeasured`;
  - pre-lock dies;
  - `flock-unavailable` and `lock-unopenable`.

  They are retried with backoff and appear in the feed. The plan's claims are narrowed to match (A15). Journaling them
  in ccd is carried. So is listing R-5c's and R-5d's skips on the attention list, which is wave 5's pre-flight's
  question.
- **R-12 — departures are named by slug in the wave-done mail only.** The worker writes no `D-` token of any form in
  any tracked file or commit. The coordinator numbers them from this wave's block.
- **R-13 — claims.** Proceed on paths another programme holds (`shared/api.ts`, `server/src/coord/schema.ts`,
  `server/src/coord/store.ts`, `README.md`), as waves 2 and 3 did.
  - Edits stay narrow and additive.
  - Whichever PR merges second merges main (never rebases), resolves, and re-runs S6-R11.
  - The schema slot is measured in-task, because the update programme's migrations collide on `user_version`.

### A1 — Task 1: fact 4 stops the preflight; fact 5's grep; four new facts — BLOCKING

- **Fact 4 (plan:175-176, :194).** At wave 3's tip its grep prints FIVE lines. `capSupported` also matches the comment
  above the call ("`capSupported` refuses on no"). Replace it with this grep, which measures exactly four lines (slice
  offsets 41, 46, 54 and 59):
  `  | grep -n 'openRunsForSession(\|WAVE 4 ADDS THE SERVER-SIDE PAUSE READ HERE\|isVisible(\|capSupported('`
- **Fact 5 (plan:180, :195).** Replace plan:180's grep with `grep -n "length).toBe([0-9]" server/test/auth-gate.test.ts`.
  It prints exactly :216 `51`, :239 `30`, :244 `5` and :295 `86`. plan:132 reads "the four `auth-gate.test.ts` counts"
  and "ten measured facts". plan:4697 reads "Task 1 Step 3's ten facts".
- **New facts 7–9, each a STOP on mismatch:**
  7. `sed -n '/^export type ChildReclaimNotWhy =/,/;$/p' server/src/coord/childReclaim.ts` prints six words ending
     `'not-finished'`, and `grep -n "toHaveLength(6)" server/test/coordinator-skill.test.ts` prints one line.
  8. `sed -n '/^  markDispatchStarted(/,/^  }/p' server/src/coord/store.ts` prints one `UPDATE runs SET
     dispatchStartedAt = ?`, and `grep -n "ms: read.run.dispatchStartedAt" server/src/coord/childSpent.ts` prints one
     line.
  9. `awk '/^_ws_reclaim_eval\(\) \{/,/^}/' ccd/ccd | grep -c 'if \[\[ -e "\$REG/\$id.hold" \]\]'` prints `1`, and the
     same over `_ws_reclaim_resume_eval` prints `1`.
- **Fact 10, a record, not a STOP.** From `server/`, run `./node_modules/.bin/vitest run
  test/ccd-child-reclaim-verb.test.ts` in the foreground with a 600000 ms timeout. Record the executed and skipped counts
  and the wall time; this is Task 1b's baseline. A run that cannot finish is recorded as such.

### A2 — NEW Task 1b: split the reclaim verb suite (directly after Task 1)

**Model routing:** `sonnet`, effort `high`.

`server/test/ccd-child-reclaim-verb.test.ts` is 2424 lines with 21 top-level `describe`s, and runs in about 414 s against
the 600 s ceiling.
- Its helpers (~:25-94) close over a module-level `let h: PrHarness`. `server/test/childReclaimVerbHelpers.ts` exports
  `verbHelpers(getH: () => PrHarness)`, returning the same names.
- Split the file along its `describe`s into three `ccd-child-reclaim-verb*.test.ts` files. Each declares its own
  `let h`, its `beforeEach`/`afterEach`, and one destructuring line.
- No `it(...)` body changes. The executed count before and after is equal, and each file runs in under ~250 s,
  recorded.

### A3 — NEW Task 2b: ccd below the boundary — nested checkouts, the kill deadline, one comment (after Task 2)

**Model routing:** `opus`, effort `high`. The SAFETY lens reads it. Re-stamp and pay S6-R11.

1. **Nested checkouts (R-9).** In rung 9's same-repository arm, directly after the `_WS_GITDIR_WHY` refusal, and under
   `(( ! defer ))` as rung 6 is:
   - locate the nested tree's index with `git -C "$p" rev-parse --path-format=absolute --git-path index`. A failure is
     `_ws_reclaim_unmeasured`, naming the path;
   - a present or symlinked `$h.lock` refuses `tree-busy`: "a git command holds the index lock of the nested checkout at
     $p";
   - `_ws_child_op "$p"`, the test rung 6 applies to the child's own tree, refuses `tree-busy` on an in-progress
     operation, naming the path.

   Cases (`ccd-child-reclaim-ladder.test.ts`):
   - a nested same-repository checkout with `index.lock` → `ws-audit --reclaim` answers `tree-busy`, naming the path;
   - the same with a nested `rebase-merge` → `tree-busy`;
   - either one with `--defer-expired` → `reclaimable`;
   - control: neither → `reclaimable`.

   Mutation: delete each refusal line, and its case reds.
2. **The tail's anchored `kill-session` gets a deadline.** When `tmux` is not a shell function, run it through
   `_plat_timeout "$SUBSTRATE_PROBE_DEADLINE_S"`, as `_session_probe` bounds the same substrate. A timed-out kill is rc
   124, never 0, so F1's exit-empty exception cannot admit it, and the tail answers `unit-still-active`.
   - The case spawns `bash -c 'source ccd; SUBSTRATE_PROBE_DEADLINE_S=2; …'` through `execFileSync` with its own
     `timeout: 20_000`. The harness's `h.sh` has none, and vitest cannot interrupt a synchronous spawn.
   - A PATH `tmux` stub's `kill-session` runs `sleep 30`, and its `has-session` prints `no server running`.
   - With the deadline, the verb answers `unit-still-active` in about 5 s, with nothing deleted.
   - Mutation: drop `_plat_timeout`, and the spawn is killed at 20 s (ETIMEDOUT), a bounded red.
3. **The comment above `_ws_wip_commit`'s index copy (3520), line-neutral.** It becomes "a same-size edit to a tracked
   file in that second would be read as unchanged and never staged (a hidden-flag edit is found by content, step 3)".

### A4 — NEW Task 2c: ccd ABOVE the boundary, in place and line-neutral (after Task 2b)

**Model routing:** `opus`, effort `xhigh`. The SAFETY lens reads it.

It is one task, so line-neutrality is proven by one measurement:
- the diff above the boundary is replaced lines only;
- `wc -l` moves only by Tasks 2, 2b and 9c;
- wave 3's line-19131 bytes stand at 19131 plus Task 2's two lines;
- then re-stamp and pay S6-R11.

The frozen corpus cites none of these sites by content (measured).

1. **`ws-reap` never follows a symlinked workdir** (R31's mirror).
   - In `_ws_reap_eval`, on the `main="$PROJECTS_ROOT/$project"` line, before its first `-d "$workdir"` fork, refuse
     `containment-unproven` when the workdir LEAF is a link. The sentence says ccd never follows a link to a tree it
     would delete. Ancestor links stay legal.
   - On the tail's `worktree remove` line, re-test `-L` at removal time, and answer the existing
     `worktree-remove-failed` document.
   - Add no vocabulary; `wsaudit.ts`'s `containment-unproven` sentence already covers a link.
   - Cases:
     - (a) an archived workspace whose workdir is replaced by a link to a sibling worktree → `ws-audit` answers
       `containment-unproven`, and `ws-reap` leaves the sibling's files and branch intact;
     - (b) an interrupted reap with breadcrumb `worktree`, the child's admin directory `.git/worktrees/<child>` removed,
       and the workdir replaced by a link to a clean sibling worktree → `ws-reap` resumes and answers
       `worktree-remove-failed`, with the sibling's directory, record and branch intact. The resume path does not call
       `_ws_reap_eval`, and git 2.43 deletes the sibling with no `--force` once the record is gone (measured).
   - Mutation: revert either guard, and its case reds.
2. **`_ws_tombstone`'s `reflog` field** reads only the workdir's HEAD reflog and the tombstoned branch's reflog (`tbranch`),
   never `--all`. It stays capped at 200, as a display field.
   - Case: a child's tombstone does not name a commit that only another branch's reflog names.
   - Mutation: restore `--all`.
3. **F8: `_ws_tombstone`'s comment**, the same nine lines, says:
   - `branch` is the branch this cleanup deletes: for `ws-reap`, git's worktree record; for `ws-reclaim`, the
     registry's;
   - a drifted HEAD's branch is kept, in `keptBranches`;
   - `registryBranch` is the registry's name `ws-reap` left alone, and for `ws-reclaim` it equals `branch`.

### A5 — NEW Task 4b: R33, the write-once birth (after Task 4)

**Model routing:** `sonnet`, effort `high`. The SAFETY lens reads `childBirthOf`'s input and the adopted arm.

- **`server/src/coord/schema.ts`.** The next `user_version` migration:
  - `ALTER TABLE runs ADD COLUMN sessionBornAt INTEGER;`
  - then `UPDATE runs SET sessionBornAt = dispatchStartedAt WHERE sessionId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM
    run_events e WHERE e.runId = runs.id AND e.detail LIKE 'spawn-adopted:%')`.

  Measure the event table's and column's real names at the tip.
- **`server/src/coord/store.ts`.**
  - `setSession(runId, sessionId, bornAt?: number | null)` forwards `bornAt` to the binding write. After its one
    `sessionId` UPDATE:
    - if `bornAt !== undefined`, write `sessionBornAt = bornAt`;
    - else, if the predecessor session differs, write NULL;
    - else leave it.
  - Neither statement names `sessionId` in its SET list, so the one-writer scan is unchanged.
  - A crash between the two statements leaves a bound session with a null birth, which is unplaceable and fail-closed.
  - `clearSession` adds `sessionBornAt = NULL`.
  - The column rides `RunRow` server-only, beside `coordProject`, and `toRunSummary` strips it: it never reaches the wire.
  - The 65 two-argument `setSession` calls in `server/test` stay valid.
- **`server/src/coord/dispatch.ts`.** On the fresh arm, `const startedAt = Date.now()` is passed to
  `markDispatchStarted(id, startedAt)` and to `setSession(id, sessionId, adopted ? null : startedAt)`. `routes.ts` is
  unchanged: it passes no birth.
- **`childBirthOf`** reads `sessionBornAt`. Its null detail becomes "the minting run recorded no birth for this session".
  `ChildReclaimMinting`, `close.ts`'s minting read and `childBind.ts` follow it.
- **Cases:**
  - a clean spawn binds its stamp; an adopted spawn binds null (`dispatch-adopt.test.ts`). Mutation: pass the stamp on
    adoption → red;
  - two stamps T1 then T2 with the bind on the second: `sessionBornAt === T2`;
  - a bound session, then a direct `markDispatchStarted`: `sessionBornAt` unchanged and `dispatchStartedAt` moved.
    Mutation: write the birth inside `markDispatchStarted` → red;
  - an open-route re-bind to another session → null; the same session keeps its birth;
  - `clearSession` nulls it;
  - `toRunSummary` has no `sessionBornAt` key;
  - the migration backfills a bound row, and leaves an unbound row and a `spawn-adopted:` row null;
  - the existing pin that `dispatchStartedAt` moves on retry stays green.
- **Re-point wave 3's fixtures** that set a birth through `markDispatchStarted` to `setSession(id, ID, BIRTH_MS)`:
  - `child-reclaim-close.test.ts`'s four;
  - `child-reclaim-bind.test.ts`'s, including its case titled "markDispatchStarted is the birth", retitled;
  - rename `dispatchStartedAt` fields in `child-reclaim-bind`, `-spent` and `child-reclaim.test.ts` where they mean the
    birth.

  Every case keeps its expected answer.

### A6 — NEW Task 5b: R32's words, and `has-coordinated` (after Task 5)

**Model routing:** `sonnet`, effort `high`. The SAFETY lens reads `childReclaimDecision`.

- **Vocabulary.** `ChildReclaimNotWhy` and `CHILD_RECLAIM_NOT_WHY` gain R-2's three words and `has-coordinated`, and
  `isChildReclaimKebab` admits them.
- **`ChildReclaimDecisionInput` gains:**
  - `readonly spentFastPath: boolean`, true exactly when `spent.kind === 'spent' && spent.source !== 'live'` triggered
    the re-date;
  - `readonly hasCoordinated: boolean`, from a new store read of every `claimedBy`, any state. An unreadable read
    answers the existing `siblings-unreadable`.
- **The decision:**
  - `hasCoordinated` → `has-coordinated`, placed beside the sibling check, before `finished`;
  - after `finished`: `spent` → `not-finished-undated`; `unmeasured` → `not-finished-unmeasured`; `unspent` with
    `spentFastPath` → `not-finished-merge-commit`; otherwise `not-finished`. `unasked` falls through to `not-finished`.
- **Re-point wave 3's rows:**
  - `child-reclaim.test.ts`: `unplaced` → `-undated`; `unmeasured` → `-unmeasured`; a new `spentFastPath` row →
    `-merge-commit`; the ordinary row stays;
  - `child-reclaim-close.test.ts`: (i) stays `not-finished`, (ii) → `-undated`, (iii) → `-merge-commit`;
  - `run-routes.test.ts`'s `not-finished` case is an unspent child with no fast path, so it stays;
  - `coordinator-skill.test.ts` → `toHaveLength(10)`.

  Add a `has-coordinated` row.
- **`wave-lifecycle.md` §6** lists the new words before `not-finished`, keeping the ` — the last is` ending, and adds:
  "`not-finished-undated`, `-merge-commit` and `-unmeasured` hold a child whose spent evidence the server could not use:
  a PR from its branch that no dated row places in this workspace's life, a registry PR number the live read dated to
  an earlier workspace of the same name, or a spent read that did not answer. A next wave's bind re-reads it and refuses
  `workspace-spent` or `spent-unmeasured` rather than take a spent child; the server reclaims it once your program has
  no open run. `has-coordinated` means the child has coordinated a run, so its workspace is cleaned up by a human."

  It must not name `/api/coord/reclaim-pause` (Task 6's forbid case).
- **Mutations:**
  - drop the `spentFastPath` arm → (iii) reds;
  - swap two words → their rows red;
  - drop the `hasCoordinated` check → its row reds;
  - omit a word from §6 → the set equality reds.

### A7 — NEW Task 5c: one `pr-state` call per close, not two (with Task 5b; R-10)

**Model routing:** `sonnet`, effort `high`. The SAFETY lens reads it, because this line decides a destroy.

- `verifyDone`'s ok verdict carries its measured `CcdPrLine` (server-internal). It is the same
  `CCD_ARGV.prStateSession` call and the same `parsePrLines`, and ccd's `--head` rows are unfiltered.
- `childSpentLive` splits into a pure `childSpentLiveFrom(line, rec, birth)` plus the fetch. `childSpent` takes an
  optional pre-read line for its live rung.
- `childGateAtClose` passes `verifyDone`'s line when that line's id names this session, and otherwise fetches as today.
- R30 holds: it is a live read, taken in the same mutex section. A PR opened in between can only hold the child.
- **Cases:** count the recorded `pr-state` argv in a re-dated fast-path close and in a fast-path miss. Each is exactly
  1; today each is 2.
- **Mutation:** stop passing the line → 2.
- Update the COST notes in `childSpent.ts` and the ~40 s comment in `close.ts` to the measured count.

### A8 — Task 6: the route counts and the CLAUDE.md span

- **Step 4(d) (plan:1748, :1756-1763, :1787).** Expected `expected 31 to be 30`, then `expected 87 to be 86`
  (`ROUTES.length`). `server.ts` stays `51` and `update/routes.ts` stays `5`. The comment reads "51 + 31 + 5 = 87". The
  PR body and review lens 3 say "51 / 31 / 5 / 87" and "86→87".
- **Step 4(e) (plan:1766-1777).** Replace ONLY the mid-line span from `What does need saying here are the` through
  `in both directions (D-1231).`. Leave `with its own argument — are the census, not this bullet.` before it and
  ` The update control plane's …` after it untouched. Keep each backticked route on one line.

### A9 — Task 7: the presence episode (BLOCKING), the hold, the fence, the skips

1. **Presence (R-4).** `childReclaimNextEntry` takes `licensed = req.deferExpired`, and the arms at plan:2438-2445 become:
   - `failed` → `firstPresenceDeferredAt: null`, beside its failure count;
   - `refused` (R-5g) → `firstPresenceDeferredAt: null`, `refusedAt: nowMs`;
   - `deferred`, presence-class → `licensed ? nowMs : (entry.firstPresenceDeferredAt ?? nowMs)`;
   - `deferred`, anything else → null.

   Every arm except `refused` sets `refusedAt: null`, and the entry gains `lastAskedAt` (R-5a).

   **The Global Constraint at plan:26 gains:** "Any outcome other than a presence-class deferral ends the presence
   episode, and a licensed request restarts it. The ceiling licenses exactly ONE attempt per continuous episode." This
   ties to plan:3035's expected `firstPresenceDeferredAt`, now request 3's `now`.

   **Cases:**
   - for `failed`, `refused` and each non-presence `why`, starting past the ceiling, `childReclaimDeferExpired` is
     false;
   - a licensed presence answer restarts the episode;
   - lane (Task 8): presence until the ceiling, then one licensed request answered `failed` or `refused`, and the next
     request carries `deferExpired: false`.

   **Mutation:** restore the old clock in any arm, and its case reds.
2. **The hold (R-1).** This replaces `held: string | null` (plan:2343-2344) and plan:2373's check:
   ```ts
   export type ChildReclaimHoldRead =
     | { readonly kind: 'none' }
     | { readonly kind: 'held'; readonly reason: string }          // no terminal run naming this child renders these bytes
     | { readonly kind: 'unmeasured'; readonly reason: string; readonly detail: string }
     | { readonly kind: 'program'; readonly reason: string; readonly program: string; readonly accountedRunId: number;
         readonly open: { readonly ok: true; readonly count: number } | { readonly ok: false; readonly detail: string } };
   ```
   The L1 matcher renders with `shared/api.ts`'s `holdReason` (L0, pure) over the runs naming the child plus the minting
   run, and keeps only TERMINAL runs.

   **The verdict:**
   - `held` → `'held'`, at plan:2373's place;
   - `unmeasured` → `hold-unmeasured` (a new skip);
   - `program` is decided only after `minting-run-absent`, `minting-run-open`, `dispatch-in-flight` and R-5d's fence:
     - a non-terminal minting run → `'held'`;
     - `!open.ok` → `hold-unmeasured`;
     - `count > 0` → `'held'`;
     - otherwise, after the review, sibling and coordinating conjuncts, it answers
       `{ eligible: false, why: 'hold-retired', runId, release: { reason, program, accountedRunId } }` where it would
       have answered eligible.

   It is never `eligible: true` while a hold exists.

   **Policy rows:**
   - a human hold in free text → `held`;
   - the placeholder-shaped hand hold `program:demo wave:2/4`, where the child's only run is wave 2 → `held`;
   - `program:demo wave:2/3 run:99`, with run 99 absent → `held`;
   - a rendering of a run that names another session → `held`;
   - `wave:02/3` → `held`;
   - `HOLD_UNREADABLE` → `held`;
   - a programme with an open run → `held`;
   - an unreadable count → `hold-unmeasured`;
   - an absent minting run plus a programme hold → `minting-run-absent`;
   - a retired programme, accounted by a terminal run → `hold-retired`;
   - retired, but siblings open → `siblings-open`;
   - an open orphan-branch minting run with a retired-programme hold → `held`.

   **Mutation rows**, each reds its row:
   - drop the accounting (the placeholder row);
   - account against every run, not only those naming the child (the other-session row);
   - drop the terminal requirement;
   - hoist the decision above `minting-run-absent`;
   - read an unreadable count as zero.

   The held case at plan:1917-1919 becomes these rows.
3. **Coordinating (R-5c).** The input gains `coordinating: boolean` (ever), read from the same store read Task 5b adds.
   It skips as `coordinating`, a word in the L1 file, which is outside the coordination kebab scan. It gets a row and a
   mutation.
4. **The run-id fence (R-5d).** The minting run's read gains `openedAt`. The input gains `childBornAt: number | null` and
   `skewMs` (`CHILD_BIRTH_SKEW_MS`). After `dispatch-in-flight` and before the hold:
   - a null birth → `child-birth-unplaced`;
   - `openedAt > childBornAt + skewMs` → `minting-run-postdates-child`.

   Rows: exactly `+skewMs` passes, `+skewMs+1` skips, and a null birth skips. There is a mutation for each line.
5. **R-5h.** A `workspace === null` row → `not-a-workspace`, with one row.

### A10 — Task 8: the lane

1. **The release (R-1).**
   - **The read.** The lane builds `ChildReclaimHoldRead` from the row's trimmed `held`. It uses a new
     `CoordStore.runsNamingSession(id)`, shaped like `openRunsForSession` but with no state filter, in its own try, where
     a throw or `!ok` gives `unmeasured`. `programOpenRunCount`, which throws bare, gets its own try.
   - **The memory entry** records which verdict it counts (`'eligible' | 'hold-retired'`). A verdict of the other kind
     starts a fresh sighting. The lane has no re-entrancy guard, and an overlapping pass must not turn "two further
     passes" into one.
   - **The job.** On the second pass the lane queues ONE `releaseRetiredChildHold(deps, { sessionId, runId, reason,
     program, accountedRunId })`, a new export of `server/src/coord/childReclaim.ts`, on
     `this.deps.queue.run(sessionId, …)`. The job re-reads as R-1 says, then composes
     `CCD_ARGV.wsRelease(sessionId, sweepDec(fleetState, `run:${runId} reclaim sweep: program ${program} retired`))`
     behind `verbSupported`.
   - **Its answer** is `'released' | 'not-held' | 'changed' | 'failed'`. ccd prints `released <id>` or `not held <id>`,
     both at exit 0. The job enters `childReclaimInFlight` but does not count against R-5a. Its answer deletes the entry
     unconditionally.
   - **Censuses.** The switches' early return covers the release. Every census the new `ws-release` site moves (the
     unattended-actor SITES, the verb gate) is updated with its measured count. Any new hyphenated literal under
     `server/src/coord` is admitted through an exported guard, because of the kebab scan.
   - **Cases** (`exec: 'real'`, argv recorded). They replace plan:2983-2991's hold half:
     - (i) an accounted `program:` hold protects while its programme has an open run;
     - (ii) after the programme retires: pass 1 nothing; pass 2 one `ws-release` and no reclaim request; then two more
       passes and one reclaim request;
     - (iii) a human hold → nothing, ever;
     - (iv) the hold text changes before the job runs → no release;
     - (v) a run of that programme opens between the passes → no release;
     - (vi) a lost database (the minting run absent) → nothing;
     - (vii) the placeholder-shaped hand hold → nothing, ever;
     - (viii) a restored-snapshot hold naming a run the database lacks → nothing;
     - (ix) a release answered after the next pass began still needs two fresh unheld passes.
   - **Mutations:** delete the byte re-check → (iv) reds; delete the count re-check → (v) reds; delete the accounting
     re-read → (iv′) reds, where (iv′) is a different but equally renderable text.
   - **The docstring** states R-1's residual.
2. **Both caps (R-5b).** The early return reads:
   `!capSupported(…, RECLAIM_CAP) || !capSupported(…, RECLAIM_PAUSE_CAP) || names.includes(RECLAIM_PAUSE_MARKER)`.
   - The fixture's `ccdVerbs` (plan:2787) gains the pause token.
   - Case: "does nothing on a box that advertises reclaim-v1 but not reclaim-pause-v1, and still reports".
   - A mutation row.
3. **In flight (R-5a).** Add `CHILD_RECLAIM_MAX_IN_FLIGHT = 1` beside `CHILD_RECLAIM_SWEEP_MS`. Step three collects the due
   children, sorts them by `lastAskedAt` (null first), then `firstEligibleAt`, then id, and dispatches at most the free
   slots. A request older than twice the reclaim budget stops counting, and is logged once.
   - **Cases:**
     - three finished children → one request, none while it is in flight, and the second after it settles;
     - A answers `state-changed` every time and B answers `reclaimed` → B is asked on the pass after A's first request;
     - a request that never settles → after 480 s, the next child is asked.
   - **Mutations:**
     - drop the bound → three requests;
     - sort by `firstEligibleAt` alone → B is never asked.
4. **Coordinating (R-5c).** One store read of every `claimedBy` per pass, inside the pass's try. A throw fails the pass
   shut, like the mirror read. There is a case.
5. **The run-id fence (R-5d).** Take the opening `create` of the current generation:
   `childBornAt = childReclaimGeneration(coord.lifecycleCreatesFor(r.id), now)[0]?.at ?? null`.
   - `lifecycleCreatesFor` is a new uncapped read of the session's `create` rows through the lifecycle columns and its
     session index.
   - It is computed inside the per-child try.
   - **Cases:**
     - a marker naming a run opened after the child's `create` → no request, and one log line;
     - a child with more than 500 newer lifecycle rows is still placed.
6. **The attention list and the terminal exclusion (plan:3745)** build their generation over `lifecycleCreatesFor` merged
   by id with the window's rows. A long-refused child must not drop off the list once its `create` scrolls out of the
   500-row window. There is a case.
7. **The ports.**
   - `execChildReclaim` composes EXACTLY the close port's seven members (`coord, io, cfg, runCcd, fleetState, presence,
     notifyLog`), with `now` unset. It builds the literal inside the queue callback, as the close port does. The text pin
     at plan:3330 widens to match.
   - New case: "composes the SAME ports the close route does — presence and the feed log included", with a recording
     `presence.isVisible` that answers true, and a feed assertion.
   - Mutation rows: delete `presence` (the feed reads `child reclaim failed`); delete `notifyLog` (the feed is empty).
8. **Stubs (plan:2778, :3069, :3088, :3109).** A reclaimed outcome carries `wip: { kind: 'none' }, secretsDropped: 0`. A
   `failed` outcome carries `resume: 'resumable'` in the backoff case, and there is one `'pre-lock-die'` row.
   `typecheck-tests` stays green.
9. **Defaults (R-5e).** plan:3797-3800's `mintingRun`, `siblings` and `reviewedRun` defaults become unmeasured shapes.
10. **Terminal pacing (R-5g).**
    - Case: two passes after a terminal refusal make no second request.
    - Case: a licensed request refused with no mirror line → the next request carries `deferExpired: false`.
11. **Lost triggers.** Two regression cases, each on a new watcher over the same database:
    - (a) the minting run closed `done` non-final while the programme stays open on another session, with no hold and no
      executor run → one request after two passes;
    - (b) a planned run that named the child was unbound by wave 2's dispatch refusal, which released the child → one
      request after two passes.
12. **R-11.** Case: an executor `failed` with no mirror line is retried with backoff and never listed.

### A11 — Task 5: the executor's coordinating re-read, and a wrapped phrase

- Inside Task 5's edit block, after the sibling re-read and before the pause read, add a try-wrapped read of every
  `claimedBy`, the same store read Task 5b adds:
  - a throw → `deferred('siblings-unreadable', …)`;
  - a hit → `deferred('siblings-open', "<id> has coordinated run(s)")`.

  This covers both triggers. It gets a case and a mutation row.
- plan:1427: the docstring phrase wraps at the tip. Locate it by `the open siblings, presence,` and edit across the wrap.

### A12 — NEW Task 9b: prose and test text (after Task 9)

**Model routing:** `sonnet`, effort `high`.

1. **Coordinator clause 3.** Change `ccd/coordinator-skill/SKILL.md` and `CONTRACT[2]` in `coordinator-skill.test.ts`
   together. The clause becomes:

   "3. This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for
   any reason. A child this session dispatched is reclaimed by the server once this session is finished with it — at its
   run’s close when nothing still needs it, otherwise later by the server’s sweep (a child held for its program’s next
   wave once that program has no open run, a review child once the run it reviewed has closed, a child whose reclaim was
   deferred or never started); this session’s own workspace is cleaned up by a human, never by a sweep."

   The last clause stays byte-identical and true: R-5c keeps every workspace that has coordinated out of automatic
   reclamation. The three-verb census still passes. Mutation: revert SKILL.md only → the verbatim case reds.
2. **`wave-lifecycle.md` and the coordinator SKILL.md:**
   - "it commits anything left uncommitted on the child's branch as a WIP commit" becomes "it records anything left
     uncommitted as a WIP commit pinned in the attic (it moves no branch)".
   - SKILL.md's "before wave 1's deploy" sentence (~:372-374), and the same sentence in wave-lifecycle.md (~:739-741,
     keeping "(§2)"), read "every workspace minted without a marker: by a box whose ccd did not yet mark children, or
     by a dispatch that journaled `child-omitted` —".
3. **The worker and reviewer skills.** "This workspace ends when its run closes" (worker ~:262-266, reviewer ~:145-148)
   becomes true of a held child: "This workspace ends when the coordinator is finished with it — usually when its run
   closes". Keep "committed for you as a WIP commit and attic-pinned" byte-identical. If a clause pin covers the
   sentence, change the pin in the same commit.
4. **Review 163's three minors** (`server/test/ccd-child-tmpdir.test.ts`):
   - the census comment names line continuation among its blind spots;
   - "the decision lives in _spawn_start…" moves out of `describe.each(CHMODS)` into a plain `describe`. `CHMODS` has
     two entries, so the executed count drops by exactly one; state it;
   - the shim comment says the real chmod was measured BSD-order on the CI macOS runner (test-macos 2/2, job
     107809367324).

### A13 — NEW Task 9c: ws-slug-collision's residue (ccd below the boundary)

**Model routing:** `sonnet`, effort `high`. Re-stamp and pay S6-R11.

This is `_ws_slug_git_state`, per that programme's ledger, "Residue".
- **Cases**, each with a mutation row for its arm:
  - a `git` stub that fails only `for-each-ref` → `unmeasurable`;
  - `$WORKTREES_ROOT` itself unsearchable → `unmeasurable`.
- **The header:**
  - lists every `taken` shape and every `free` condition;
  - says "an unreadable or corrupt `packed-refs`";
  - names the two levels checked, with the rest as residual;
  - names the stale `refs/heads/ws/<slug>.lock`.
- **An absent `$common/refs/heads`** answers `unmeasurable … refs/heads is absent`: narrowed, and still fail-closed.
- **In `docs/superpowers/plans/2026-09-23-ws-slug-git-collision.md`,** edited in place with no new number:
  - D-3474's mechanism says masking, not ordering;
  - D-3476 cites rows 13–21 and gains one reftable sentence;
  - the Global Constraints' show-ref premise gains "(false; see D-3476)".

### A14 — Task 10: Darwin evidence and the file lists

- New Step 5a: from the PR's CI, record the macOS job id that ran `ccd-child-reclaim-ladder`, `child-reclaim`,
  `wsaudit`, and this wave's new and split ccd suites. Name each one not reached UNMEASURED, with the job id of the leg
  that hung first. Report it in Step 7.
- Step 4's suite list gains every file Tasks 1b to 9c create or split.

### A15 — the header, Global Constraints, `## Deviations found`, `## Review lenses`, routing

- **A new Global Constraint:**
  - names R32 and R33 (built as R-1 to R-3) and R34 to R37 as this wave's;
  - names R24, R27, R29, R30 and R31 as consumed unchanged;
  - names R25 as wave 5's.
- **plan:24:** "…The only destructive acts are wave 3's `ws-reclaim`, reached only through `reclaimChild`, and R-1's
  `ws-release` of a retired programme's hold, which removes the hold file alone."
- **plan:5, :7 and :4673:** the attention list is "every child whose `ws-reclaim` has kept failing, once an attempt has
  started (its `_lc_fail` line), past the ceiling" (R-11).
- **plan:4697 and :4703:** R-12's sentence replaces "writes `D-TBD-<slug>` in its report".
- **Routing:** plan:126 becomes "`haiku` (no effort level)"; plan:873 (Task 4) becomes `sonnet`, effort `high`.
- **`## Review lenses` (plan:4707-).** Prepend: "These four run IN ADDITION to the held-out panel
  (`references/review-panel.md`), run as written. Every finding from them gets the panel's three Sonnet·high refuters.
  A lens that dies or returns nothing is unverified. Each reviewer reads in its own worktree at one measured tip."

  Lens 1 (SAFETY) gains:
  - R-1: the accounting, the order, the in-job re-reads, and that a lost or restored database releases nothing;
  - R-3: the adopted arm;
  - R-4's single licensed attempt;
  - R-5's in-flight bound and sort, both caps, coordinating children, and the fence's uncapped read;
  - Task 2b's nested refusals and kill deadline;
  - Task 2c's `ws-reap` link guard.
