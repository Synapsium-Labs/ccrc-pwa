# Landing order wave 5i — binding head and next-to-land cue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task, as the dispatch specifies. Steps use checkbox syntax. This draft does not dispatch a worker or authorise execution.

**Status: UNAPPROVED PROPOSAL.** All mechanics labelled P1–P6 are coordinator proposals for approval, not operator-approved decisions. Approval must include the two explicit invariant amendments below. No implementation, test execution, live arming or rollout has happened as part of drafting.

**Goal:** Make an opted-in project's recorded head binding, maintain its measured main-red hold, and durably mail its current recipient once per exact landing episode and measured base, while repairing a bounded class of unknown rows without inventing a pin.

**Architecture:** Extend `landingOrder`, the radar parser/read pass, `CoordStore`'s guarded transaction boundary and the existing system-mail transaction bodies. L1 decides eligibility and every landed-reader outcome; L3 preserves measurement distinctions and commits facts/mail; L4 gathers and acts through the existing radar and landed scheduler rows. The coordinator still performs every fresh canonical check and every landing itself.

**Tech Stack:** TypeScript ESM, Node >=22.16.0, synchronous `node:sqlite`, Fastify, Vitest, existing FleetIO byte-range operations, fixture-only Python producer tests. No dependency additions.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md`, §§5.3–5.5, 6–7, 9–10; `docs/superpowers/programs/landing-order.md`, Waves 5i–5k and its carried constraints. Also read the 5d lander-key plan and `2026-11-11-landing-order-wave5h-{landed-reader,departures}.md` in `docs/superpowers/plans/`.

**Source baseline:** `6f408451d4a9a5e03bc747db8e6b0a2e647f3ef3`. The approved documents match that baseline. All present-tense source claims below refer to that commit, not the older checkout used to draft this document. A worker must reconcile a newer dispatch base explicitly rather than silently implementing against a different owner.

**Plan review:** one independent Opus static review read all seven tasks against the source baseline and approved scope. Four source-verified findings were corrected: closed-row re-pin follow-through, fence-before-retry recovery, lossless BLOB repair tokens and nullable wave totals. A narrow follow-up by the same reviewer found no remaining findings in those corrections. This was not a fresh full re-review, an implementation review or a held-out multi-lens/refuter panel; no tests or mutations were executed. The coordinator also corrected commit sequencing, isolated typecheck-tests and assigned central ledger/spec publication to the coordinator rather than the worker.

## Global Constraints

- This is 5i only: binding head, main health, lander reader, next-to-land mail, bounded unknown-row repair and the named carries. Waves 5j/5k retain the pause/withdraw routes and PWA controls.
- No automatic merge/enqueue, `land-candidate`, new gh/CcdArgv shape, exec-whitelist expansion, live arm, account operation or altered canonical verdict fence.
- `EXEC_COMMANDS` remains `['tmux','ccd']`; wire changes are additive and `FLEET_PROTO` remains 1. No field absence is proof of readiness.
- Extend one owner per fact. No parallel parser, poller, notifier, store interface, order algorithm or generalized repository. Extend `WatcherCoordPort` only for actually reached members.
- `CoordStore` remains synchronous. No await inside its transaction; no nested `tx`; no filesystem read inside a mail transaction.
- Keep journal authority, attribution, identity-conflict holds, historical-binding checks, fences and the verified-pin witness. Replay creates neither projections nor witnesses and never chooses a head.
- No repair may clear `stale-episode-head`; only an existing verified pin with readable retained fields does that. Terminal repair refuses every quarantine marker.
- A mail is a cue for fresh canonical checks, not landing permission, a guarantee about later GitHub main, or authority to pick a successor.
- Tests use fixture HOMEs and contained forge commands only. Never run destructive lifecycle verbs or inspect live registry/transcripts/secrets/quarantine for this work.
- All verification below is foreground, through `ccrc test`, with `--maxWorkers=2`; the invoking tool timeout is at least 600000 ms. No ad hoc full suites or background test processes.
- Public text uses neutral project/session names and repository-relative symbol or `#@anchor` references; no private deployment coordinates, personal attribution or secret material.
- The recorded mail-latency prerequisite is historical: 1161 mails, median 0.2 min, p90 8.8 min, maximum 1651.8 min, none unmatched and 14 undelivered. Coverage was 8 of 14 coordinators; six full pages were excluded and the closed-run read hit 500. It is not a current latency guarantee or a new blocker.
- The continuity shadow week gates continuity 6c, not this plan. The historically cleared 5h backlog prerequisite is not a claim that today's line is empty.
- D-8355 and D-8356 are accepted differences, not remediation. Do not add the cosmetic title suffix or weaken the existing long-ID redactor.

## Review Focus

1. **Mismatched or unavailable evidence:** absent/foreign/oversize/stale probe or health, an old lstat peer, and symlinked marker ancestors must not produce readiness or clear an earlier red; Task 2's measured-read assertions and Task 3's coherence matrix pin this.
2. **Order versus apparent readiness:** a clean later PR must not bypass an unhealthy selected head, an after edge, a cycle, unknown projection or operator pause; Task 3 pins each refusal, including fixesMain during red.
3. **Episode and recipient churn:** same-millisecond re-pins, base changes, coordinator replacement, terminal acknowledgements and process restart must neither lose a legitimate cue nor duplicate the same cue; Task 5's durable tuple and race tests pin this.
4. **Corrupt projection versus authority:** a valid terminal PR answer must not repair identity/binding conflicts, manufacture a pin, clear quarantine or allow an unreadable equal-head retreat; Task 4's positive and forbidden-repair cases pin this.
5. **Failure at an asynchronous or transaction seam:** stale radar generations, a late landed call, an envelope failure and a failing ambient landing read must preserve exact timing, rollback and the shared handle; Tasks 1, 5 and 6 pin these, with Task 7's binding census guarding their ownership.

---

## 1. Proposed mechanics and approval boundary

These choices make the draft executable. They are not inferred approvals.

| Proposal | Concrete choice | Approval consequence |
|---|---|---|
| P1 — measured evidence | Retain `ProbeDoc.baseSha` in `parseProbe`; add health/lander parsers beside it. Extend `readRegular`'s bounded overload and `readRadarPass`, not a second file parser or pass. Reuse `freshWithin` and `RADAR_PROBE_FRESH_S = 1200`. | No new freshness window or claim about a later base. |
| P2 — order and red | Preserve the existing pin-order surrogate and dependency walk. During persisted main-red, admit only the already-selected, dependency-free fixesMain head; never search for another fix behind it. Require a fresh, same-base red/green measurement independently of the persisted flag. | Explicitly settles D-7623; amendment A below changes the two-flag interpretation. |
| P3 — cue identity | Run-bound recipient is current `runs.claimedBy`; no-run recipient is the journalled creation claimant, not an order setter. Identity includes exact entry, pin/creation episode, full head/base and recipient. | No successor is inferred from a missing/dead recipient; replacement recipients get their own cue. |
| P4 — atomicity | One landing-specific store operation owns flag application, DB eligibility revalidation, dedupe and mail enqueue. Reuse transaction-free bodies extracted from the existing mail owners. | No public `readLanding` inside that transaction and no nested mail transaction. |
| P5 — unknown repair | Permit only a fresh PR-keyed terminal observation of an exact existing, unquarantined row with trustworthy identity/dependencies/counters/binding; preserve invalid pin metadata verbatim. | Amendment B below widens the terminal-mark gate, never the pin gate. |
| P6 — binding delivery | Add an additive `binding` result to the landing read, computed by one pure owner from current DB facts plus the watcher's measured control snapshot. Opted-out projects remain inert; unknown opt-in/readiness holds. | Skill text becomes binding only on positive opt-in; 404 remains the documented older-server fallback. |

**Amendment A — exact proposed replacement for the two-flag rule:**
“`operatorPaused` always suppresses the head. `mainRedHold` suppresses an ordinary head; it does not suppress the dependency-eligible head already selected by `landingOrder` when that head has `fixesMain`. Neither exception bypasses recovery, unreadable open projections, fresh composition evidence or any canonical required-checks gate.”
This intentionally permits `mainRedHold:true` beside `order.paused:false` and a fixesMain head. Update the shared flag/order comments and the spec's Data explanation together. Do not disguise this as existing approved behaviour.

**Amendment B — exact proposed addition to the terminal-mark invariant:**
“A fresh PR-keyed merged/closed/absent observation may retire an exact existing row whose pin-only metadata is unreadable, provided identity, retained ordering data, counters, pin time and current association are measurable and no quarantine or own recovery conflict stands. This changes only state/detail. It restores no metadata, head, pin, association or witness. A quarantined row remains unknown until a verified pin with readable retained fields.”
This is narrower than arbitrary unknown-row repair. Missing projections, invalid identity, unreadable dependencies/counters/pin time and historical binding conflicts remain visible holds, not guessed repairs. Their response names repair rather than promising a restart will fix data. A closed row with retained unreadable pin metadata stays terminal and cannot re-enter through the formerly unconditional closed-row re-pin branch: `decideLandingWrite` keeps it closed unless its projection is readable and unquarantined. This follow-through restriction applies to every closed row, not only those the terminal exception retired; ordinary readable closed rows still re-pin. No setter or witness is fabricated to make it readable.

**In short:** an opted-in project has one selected head and one measured readiness result. A red-main exception is an order exception only, not a merge-check exception. Recovery can remove a terminal PR from the line on real evidence; it cannot turn uncertain history into landing authority.

## 2. File responsibilities

The new files below separate domain decisions from delivery; each has a real owner, not a forwarding layer.

| File | Responsibility |
|---|---|
| `shared/landingLine.ts` | Additive binding vocabulary; explicit repair recovery word and amendment comments. No imports. |
| `server/src/coord/landingLine.ts` | Existing order/after/cycle owner; the single binding and main-red transition decisions. |
| `server/src/coord/radar.ts` | Existing probe parser retains base SHA; sole health/lander parsers and control-read vocabulary. |
| `server/src/coord/lineageRead.ts` | Existing regular-file and radar-pass adapter; bounded bytes, ancestor rejection and all measured distinctions. |
| `server/src/coord/landed.ts`, `landedLane.ts` | Seven pure pass decisions and their mechanical execution; existing cap/backoff retained. |
| `server/src/coord/landingEntry.ts`, `landingWrites.ts` | Strict facts, bounded terminal-repair eligibility, equal-head retreat refusal and creation attribution facts. |
| `server/src/coord/landingNext.ts` (new) | Pure recipient/episode/cue builder. Type-only imports plus inward L1/L0 values; no clock, hashing, SQL or I/O. |
| `server/src/coord/store.ts` | Existing one writer, raw repair-token measurement, project inventory and landing-specific atomic control/mail operation. |
| `server/src/coord/rundefsTx.ts` | Reusable transaction-free notice bodies; original public wrappers retain transaction ownership. |
| `server/src/watch.ts`, `coord/routes.ts`, `coord/ports.ts` | Existing radar/landed scheduling, measured snapshot exposure, route assembly and reached store members. |
| `server/test/landingFixture.ts` | Existing journal-backed fixture; extend with neutral typed control/entry builders used by new tests. |
| `server/test/landing-control.test.ts` (new) | Pure binding, recipient/episode and measured-control cases. |
| `server/test/landing-next-mail.test.ts` (new) | Real SQLite/journal atomicity, durable identity and enqueue failures. |
| Existing radar, landed, landing store/route/census tests | Characterization, terminal repair, symlinks, ownership and exact guards; extend rather than copy harnesses. |
| `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md` | Binding line check beside, never inside or replacing, the canonical verdict fence. |
| `server/test/coordinator-landing-verdict.test.ts`, `coordinator-skill.test.ts` | Pin the skill's bounded change and byte-preserved canonical block/standing clauses. |
| Spec, programme and this plan (coordinator ledger PR only); `README.md` (worker runtime documentation) | Approval amendments, measured departures and accurate user-facing binding/recovery semantics; the worker records evidence in task notes, not central ledgers. |

Do not create `server/src/radarLane.ts`: it does not exist at the baseline. The real owners are `FleetWatcher.sweepRadar` and `coord/lineageRead.ts#readRadarPass`. The watcher already reaches the landing read route as its existing parameter; do not add a second watcher field to `Deps`.

## 3. Task dependency and commit order

`1 → 2 → 3 → 4 → 5 → 6 → 7`. Tasks 2 and 4 are conceptually separable, but execute serially to keep characterization and mutation evidence uncontaminated. Task 1 has a test-only characterization commit followed by a pure move commit. Later intended behaviour changes are separate commits. Do not combine the red-main or repair changes with that move.

Every task's verification command below is used for both red and green, except Task 1's existing-behaviour characterization, which must first be green on the unchanged implementation. Mutation experiments are sequential, bounded by time/process capacity, restored from a saved copy, and followed by the same green command. Record actual assertion and exit status, not an expected result presented as measured.

### Task 1: Characterize and move the seven landed-pass decisions

**Files:** Modify `server/src/coord/{landed,landedLane}.ts`; tests `server/test/{landed-decide,landed-lane,landing-land-words,run-routes}.test.ts`.

**Interfaces — consumes:** existing `LandingReadResult`, `LandingLandResult`, `LandedCandidate`, `LandedMemory`, `CcdResult`, `PrStatePrRead`, `landedNext`, `landedAnswerOf`, `pickLandedReads` and `isHeldRefusal`.

**Interfaces — produces in `landed.ts`:**
- `landedProjectsStep(read: LandingProjectsRead): {act:'projects';projects:string[]} | {act:'stop';error:string}`, where `LandingProjectsRead = ReturnType<WatcherCoordPort['landingReadProjects']>` is a type-only dependency.
- `landedProjectStep(read: LandingReadResult): {act:'candidates';candidates:LandedCandidate[]} | {act:'skip'} | {act:'stop';error:string}`.
- `landedPruneIds(complete: boolean, candidates: readonly LandedCandidate[], memory: ReadonlyMap<number,LandedMemory>): number[]`.
- `landedMarkStep(mark: LandingLandResult, candidate: LandedCandidate): {act:'marked';write:LandingLandWrite} | {act:'held'} | {act:'stop';key:string;line:string}`.
- `landedCallStep(call: CcdResult): {act:'parse';stdout:string} | {act:'failed'} | {act:'not-ran'}`; the lane executes `parse` with the existing PR parser and maps `failed` through `landedAnswerOf({state:'call-failed'})`.
- `landedMissingWarning(candidate: LandedCandidate, next: LandedMemory): {key:string;line:string} | null` and `landedNoticeFailure(candidate: LandedCandidate, error: string): {line:string;continue:true}`.

- [ ] **Step 1: Add characterization rows against the old lane, before moving code.** Project-list refusal stops; projection-unreadable skips and retains all memory; another read refusal stops; only a complete pass prunes; a held mark retries; apply/commit failures warn as a fence; other mark refusals stop; not-ran stops without incrementing reads; ran-failed backs off and continues; second missing-field warns once; failed feed notice warns and continues after its committed mark.
```ts
expect(result).toMatchObject({ read: 0, stopped: 'link' });
expect(memory.get(id)).toEqual({ pinnedAt, lastReadAt: t0, nextAt: t0 + 2 * PR_SWEEP_MS, step: 2 * PR_SWEEP_MS, missingStreak: 0 });
expect(memory.has(unvisitedId), 'an incomplete inventory retains memory').toBe(true);
expect(warns.filter(s => s.includes('missing-field twice'))).toHaveLength(1);
```
- [ ] **Step 2: Run existing behaviour green and commit the characterization only.** Command from `server/`: `timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/landed-decide.test.ts test/landed-lane.test.ts test/landing-land-words.test.ts --maxWorkers=2`. A pre-move failure is a mistaken characterization or an independently reported defect, not permission to change behaviour.
- [ ] **Step 3: Move the seven choices to the signatures above, green-run and commit the move before Step 4.** The lane switches on returned actions; its WeakMap warning latch, reads, SQL calls and notice call remain delivery acts. Preserve exact text, cap 10, complete-pass pruning, PR backoff, missing streak and stop accounting. Import-only changes in characterization tests accompany the move; no new repair/binding behaviour enters this commit. Re-run Step 2's command and commit the pure move with the standing attribution before changing any test strength or intended behaviour.
- [ ] **Step 4: Tighten D-8359 independently after the move.** In the advancing-clock fixture, assert the first mark's `detail.at === t0 + 1000`, waiting memory `lastReadAt === t0`, and held memory `nextAt === t0`. Use a generic checked `advanceLanding` mock returning `LandingLandResult` for the land arm and delegating other arms; remove the held mock's `as never`, not unrelated fixture casts.
```ts
expect(isLandable('pinned', { kind: 'unreadable' })).toBe(false);
expect(isLandable('ejected', { kind: 'readable', quarantine: 'stale-episode-head' })).toBe(false);
expect(detailOf(r.coord, 2701).at).toBe(t0 + 1000);
```
- [ ] **Step 5: Make the held-word vocabulary exhaustive without `Extract` dropping new words.** Spell the hold gate's refusal union directly, derive `HeldWord` from its false arm, and keep `HELD_WORDS: Record<HeldWord,true>`. A third literal added to that gate must produce a missing-key type error. Preserve the two runtime words exactly.
- [ ] **Step 6: Correct D-8360 and run green.** Say “due at once when the hold clears; still competing for ten reads,” and fix the header's value-import description. Run Step 2's command, then `timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/run-routes.test.ts -t 'mark that throws' --maxWorkers=2`. Record CLOSE-4 as deletion of `landOnClose`'s catch causing its 200-done assertion to fail, not the obsolete refused-mark mutation.
- [ ] **Step 7: Commit the subsequent test/comment hardening**, using the standing commit attribution standard. The characterization and pure-move commits were already made in Steps 2 and 3; do not squash this intended change into either. No push yet.

### Task 2: Read one bounded, coherent control bundle through the radar owners

**Files:** Modify `server/src/coord/{radar,lineageRead}.ts`; extend `server/test/{coord-radar,radar-lane,ccd-land-probe,fleetio-contract}.test.ts` and `server/test/landingFixture.ts`; new `server/test/landing-control.test.ts`.

**Interfaces — consumes:** `FleetIO.lstatMeasured`, `statMeasured`, `readFileFromBytesMeasured(path,offset,maxBytes,timeoutMs?,signal?)`; `READ_FROM_MAX_BYTES = 262144`; `RADAR_PROBE_MAX_BYTES = 524288`; `freshWithin(at,1200,nowMs)`; existing `readRadarPass` deadline/concurrency.

**Interfaces — produces in `radar.ts`:**
- Add required `baseSha: string` to successful `ProbeDoc`; populate it from the already-validated producer `base.sha` inside `parseProbe(content,project,nowMs)`. Existing unmeasured probe results remain failures, never fabricated docs.
- `ControlFailure = {ok:false;reason:'absent'|'unreadable'|'oversize'|'malformed'|'stale'|'unmeasured'|'late'|'refused';size?:number}`.
- `LanderDoc = {project:string;lander:'coordinator';at:string}`; `LanderRead = {ok:true;doc:LanderDoc} | ControlFailure`.
- `MainHealthDoc = {project:string;at:string;sha:string|null;state:'green'|'red'|'unmeasured';required:{name:string;app:number|null}[];failing:string[];pending:string[];why?:string}`; `MainHealthRead = {ok:true;doc:MainHealthDoc} | ControlFailure`.
- `LandingControlRead = {lander:LanderRead;probe:ProbeRead|ControlFailure;health:MainHealthRead}`; `parseLander(content:string,project:string,nowMs:number):LanderRead`; `parseMainHealth(content:string,project:string,nowMs:number):MainHealthRead`.

**Interfaces — produces in `lineageRead.ts`:** bounded `readRegular` returns `{ok:true;content:string}|ControlFailure`; `readLandingControl(io:ControlIO,registryDir:string,project:string,probe:ProbeRead|ControlFailure,nowMs:number,signal?:AbortSignal):Promise<LandingControlRead>` consumes an already-read probe. `ControlIO` is the relevant Pick of FleetIO, not a new store port. Extend `readRadarPass(..., controlsWanted?:ReadonlySet<string>)` with `controls:Map<string,LandingControlRead>` beside its existing `reads`, reading each project's probe once.

- [ ] **Step 1: Add parser red tests.** Extend `coord-radar`'s `worked()` expectation with `baseSha:sha(9)` and prove `sessionLandingsOf`'s existing output is unchanged. In `landing-control`, construct producer-shaped health docs, not a second judgement of GitHub checks.
```ts
expect(okDoc(worked()).baseSha).toBe(sha(9));
expect(parseMainHealth(greenJson, 'project-a', now)).toMatchObject({ ok: true, doc: { state: 'green', sha: base } });
expect(parseMainHealth(noRequiredJson, 'project-a', now)).toMatchObject({ ok: true, doc: { state: 'unmeasured', why: 'no-required-set', required: [] } });
expect(parseLander(foreignJson, 'project-a', now)).toEqual({ ok: false, reason: 'malformed' });
```
- [ ] **Step 2: Add adapter red tests for actual read bounds and distinctions.** A pre-stat above cap causes zero byte reads. Every requested byte range is <=262144; a 524288-byte probe needs at most two. A size/mtime change, short range or invalid UTF-8 is unmeasured/unreadable, never parsed as a complete doc. Oversize is not absence. Unsupported lstat remains unmeasured. Read faults remain unreadable. Stale is distinguished from malformed after structural validation.
- [ ] **Step 3: Pin both marker ancestors and the carried producer removal guard.** Lstat each path component from the configured registry boundary through `landing/<project>` before reading `lander`; any symlink on that chain is absent for this marker, any unmeasurable component is unmeasured, and a non-directory is unreadable. `lstatMeasured.kind:'other'` is not proof of a directory: prove traversal with the existing measured listing/stat seams and fail closed. Recheck the chain after the bounded read. No new wire op.
```ts
expect((await readLandingControl(io, reg, p, probe, now)).lander).toEqual({ ok: false, reason: 'absent' });
expect(readByteSpy, 'no target bytes through a symlinked ancestor').not.toHaveBeenCalled();
expect(readFileSync(targetLander, 'utf8')).toBe(beforeLander);
expect(readFileSync(targetEnabled, 'utf8')).toBe(beforeEnabled);
```
  In the existing 5d producer describe, add a **project-directory** symlink fixture with a real `landing/` parent and planted `lander`/`enabled` behind `landing/<project>`. Run both `lander=none` and missing-conf cases. Removing only `remove_own`'s `real_dir(dirpath)` check must delete a planted file and fail the exact-byte assertion.
- [ ] **Step 4: Run red.** From `server/`: `timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/coord-radar.test.ts test/radar-lane.test.ts test/landing-control.test.ts --maxWorkers=2`. Separately: `timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/ccd-land-probe.test.ts -t 'lander key and its mirror' --maxWorkers=2`.
- [ ] **Step 5: Implement the bounded overload and the two parsers.** Keep the unbounded legacy overload's explicit contract for unrelated callers. The bounded overload checks type/size before allocation, assembles at most the cap through existing byte ranges, verifies complete lengths and before/after size/mtime, then decodes once. Keep the same probe cap; use that cap for health and 4096 bytes for lander. The existing parser's malformed-probe `unreadable` remains its documented legacy distinction; new parsers use `malformed`.
  Health green/red require a 40-hex sha, nonempty required set, valid nonempty names and app null or positive safe integer, and failing/pending names contained in rendered required names. Green requires both lists empty; red requires failing nonempty and may also have pending. Unmeasured accepts the producer's empty-list failures, `no-required-set`, pending/app-conflict/app-unverifiable shapes with retained required/pending, and null or valid sha; require a short nonempty why. Do not require unique rendered names or disjoint rendered failing/pending lists: the producer bounds names and distinct originals may collide after truncation. Judge only the producer's overall state, not a recreated verdict from rendered names. Reject unknown states and inconsistent green/red shapes.
- [ ] **Step 6: Preserve time and pass semantics.** Every document uses the existing 1200-second window independently. Lander is written in the tick pre-pass: do not require its `at` to equal probe or health time; do not require probe/health equality either. Preserve the pass's one deadline, safe-name refusal and eight-project concurrency. Older byte-range peers that cannot prove bounded bytes answer unreadable. No parser reads a clock.
- [ ] **Step 7: Green-run Step 4 and the focused FleetIO contract file**, then commit. Extend `landingFixture.ts` with `controlRead(over?:Partial<LandingControlRead>):LandingControlRead` using full neutral SHAs and explicit producer timestamps; later tasks consume this helper. Record the residual: metadata rechecks cannot prove inode identity across remote range calls; the result is a cue snapshot, not merge permission.

### Task 3: Define the binding head and the independent red/readiness gates

**Files:** Modify `shared/landingLine.ts`, `server/src/coord/landingLine.ts`; tests `server/test/landing-line-order.test.ts`, `landing-control.test.ts`.

**Interfaces — consumes:** `LandingMutationFacts`, `LandingControlRead`, existing `landingOrder(entries,flags,recovery?)`, `freshWithin`, strict projection facts and current pin order.

**Interfaces — produces:**
- L0 `LandingBindingReason = 'opt-in-unknown'|'paused'|'recovery'|'projection-unreadable'|'empty-or-blocked'|'probe-unmeasured'|'health-unmeasured'|'base-mismatch'|'head-mismatch'|'composition-not-clean'|'main-red'`.
- L0 `LandingBinding = {mode:'inert'} | {mode:'held';reason:LandingBindingReason;entryId:number|null} | {mode:'ready';entryId:number;pr:number;pinnedSha:string;baseSha:string;landerAt:string;probeAt:string;healthAt:string;fixesMain:boolean}`; add optional `LandingLineView.binding?:LandingBinding`.
- L1 `mainRedNext(previous:boolean, control:LandingControlRead, nowMs:number, project:string): {kind:'keep';value:boolean} | {kind:'set';value:boolean;sha:string;at:string}`.
- L1 `landingBindingOf(facts:LandingMutationFacts, control:LandingControlRead|undefined, nowMs:number):LandingBinding`. `undefined` means unmeasured, never inert.

- [ ] **Step 1: Add pure red tests for P2, without changing the existing topological walk.** Reuse the order test's `e()` helper. The already-selected fixesMain head can survive main-red alone; an ordinary selected head cannot. A fixesMain entry behind an outstanding after target, a cycle or an operator pause never jumps. Recovery still has no head. Healthy later entries are not searched when the chosen head is unhealthy.
```ts
expect(landingOrder([e(1), e(2, { fixesMain: true })], RED)).toMatchObject({ paused: false, head: { pr: 2 } });
expect(landingOrder([e(1), e(2, { fixesMain: true, afterIds: [101] })], RED)).toMatchObject({ paused: true, by: ['main-red'] });
expect(landingOrder([e(2, { fixesMain: true })], BOTH)).toMatchObject({ paused: true, by: ['operator', 'main-red'] });
expect(landingBindingOf(facts, controlRead({ probe: unmeasuredProbe }), now).mode).toBe('held');
```
- [ ] **Step 2: Pin the red transition matrix.** Positive, fresh, coherent health green is the only clearing input. Red sets; pending/unmeasured/stale/absent/oversize/unreadable/mismatched-base inputs keep either prior value. Require successful fresh probe and health with matching full base SHA for a set. Require a positive lander reading; absent opt-in keeps historical flags but makes the binding inert.
```ts
expect(mainRedNext(true, pendingControl, now, p)).toEqual({ kind: 'keep', value: true });
expect(mainRedNext(false, pendingControl, now, p)).toEqual({ kind: 'keep', value: false });
expect(landingBindingOf(clearFlagFacts, pendingControl, now)).toMatchObject({ mode: 'held', reason: 'health-unmeasured' });
expect(mainRedNext(true, greenControl, now, p)).toMatchObject({ kind: 'set', value: false, sha: base });
```
- [ ] **Step 3: Pin evidence binding and refusal precedence.** Precedence: proven marker absence→inert; unmeasured marker→held; operator pause; recovery/identity conflict; unreadable open projection; selected head missing/blocked; probe/health availability/freshness; equal base SHA; exact selected PR+pinnedSha; clean base composition; health policy. Preserve `entryId` when a selected head exists. A no-run probe head may have `id:null`; bind by the DB PR and full pinned SHA, not a made-up registry association.
  A cut head list holds; pairwise annotations do not select successors or require unrelated pending PRs to pass. `health.sha === probe.baseSha` and `probe.heads[pr].head === entry.pinnedSha` are mandatory. Recheck freshness at decision time, not only parse time. Red readiness is allowed only for that chosen fixesMain head; a pending/unmeasured reading holds even that exception.
- [ ] **Step 4: Run red.** `timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/landing-line-order.test.ts test/landing-control.test.ts --maxWorkers=2` from `server/`.
- [ ] **Step 5: Implement the signatures in the existing policy owner.** Keep first-green's current surrogate: fixesMain, then pinnedAt, then PR. Never persist head or a readiness boolean. Unknown/unreadable nonterminal projections hold binding independently of the journal recovery list; terminal rows with retained diagnostic damage do not become open blockers. Preserve flags as facts; only the effective head's main-red exception changes order pausing.
- [ ] **Step 6: Green-run Step 4, record mutation reds for removed base/head/freshness/unknown gates, then commit.** This commit implements proposed amendment A only after approval. The canonical required-checks verdict and merge spellings remain untouched.

### Task 4: Repair terminal unknown rows without repairing authority; close review 1413

**Files:** Modify `shared/landingLine.ts`, `server/src/coord/{landingEntry,landingWrites,landed,landedLane,store}.ts`; tests `server/test/{landing-journal-store,landing-entry-store,landing-land-store,landing-land-words,landing-advance-route,landed-decide,landed-lane}.test.ts` and `landingFixture.ts`.

**Interfaces — consumes:** existing `LandingLand`, `LandingProjectionRead`, `landingHoldGate`, `landingFactsOf`, `landingAssociationReadable`, `CoordStore.advanceLanding`, `landingBoundary` and journal replay.

**Interfaces — produces:**
- Make `LandingInfrastructureFailure` a discriminated union: the projection arm has `error:'landing-projection-unreadable'; recovery:'repair'`; all other infrastructure codes retain `recovery:'replay'|'restart'` and their existing optional evidence. Export the latter arm as `LandingBoundaryFailure`. Type journal replay/fence-only helper failures with that arm, so `'repair'` cannot enter `landingFence`. Update exhaustive readers/pins of the recovery vocabulary; no HTTP status change.
- `LandingTerminalRepair = {kind:'eligible';token:string} | {kind:'blocked';reason:'identity'|'binding'|'quarantine'|'retained-fields'}`; add `terminalRepairs:{id:number;value:LandingTerminalRepair}[]` to `LandingMutationFacts`.
- Extend `LandingLand.expect`'s non-null object with optional `repairToken?:string`; extend `LandedCandidate` with the same optional member. Normal callers and the close's `expect:null` retain their meaning.
- `decideLandingLand({land,current,projection,terminalRepair?})` uses the existing decision return union. A repair-token mismatch returns existing `{kind:'moved'}`; an ineligible repair returns kept. `isLandable` remains the strict normal-row gate.

- [ ] **Step 1: Add equal-head retreat refusal tests, both pure and HTTP.** With a valid owned pin and episode at the same SHA, corrupt `handoffCommit`, then separately `setBy`. Both bare and named retreats refuse before moving the run, touching counts or producing an ask. Apply the same projection check before stale/equal-head branching when the row is the owned pinned row; do not newly refuse unrelated/no-entry plain advances.
```ts
expect(decision).toEqual({ act: 'refuse', failure: { ok: false, error: 'landing-projection-unreadable', recovery: 'repair' } });
expectLandingRefusal(await f.post('working', extra), { code: 'landing-projection-unreadable', recovery: 'repair' });
expectNothingLeft(f, before);
```
  Take review 1425 now: seed `ejections=1` before each relevant refused-retreat fixture, so an incorrect successful retreat would produce the second-ejection ask. Add a positive control proving that the corresponding readable retreat really raises it.
- [ ] **Step 2: Add terminal-repair positive and negative tests.** Eligible: exact safe id/project/PR/run id, readable after/fixes/counters/pin time/base/ejection kind, consistent current association, and no quarantine marker; only pin SHA, handoff, setter or the state word may be unreadable. Keep raw retained values, including damaged ones, unchanged. A fresh merged/closed/absent read changes only state/detail, not pinnedSha/handoff/runId/setBy/afterIds/fixesMain/ejections/pinnedAt or witness.
```ts
expect(repaired.landing).toMatchObject({ kind: 'landed', entry: { id, pr, state: 'landed' } });
expect(afterRetained).toEqual(beforeRetained);
expect(witnessRowsAfter).toEqual(witnessRowsBefore);
expect(landingOrder(afterFacts.entries, afterFacts.flags, afterFacts.recovery)).toMatchObject({ paused: false, head: { id: dependentId } });
```
  Negative rows: stale-head marker; any other marker; missing projection; identity collision in either project; historical-binding mismatch without exact existing witness; invalid PR/id/run id; unreadable afterIds/counter/pin time; open/unmeasured/call-failed PR; changed repair token; newly appeared hold. None repairs or manufactures a recipient/head. Unknown rows cannot be re-pinned merely because terminal repair exists.
  Add the real-store sequence repair→closed→verified pin, separately for a retained blank setter and BLOB/non-string handoff. `decideLandingWrite` must return `{act:'none',write:{kind:'kept',state:'closed'}}` for a closed row whose projection is not readable and unquarantined. Assert the verified attempt makes no projection or witness mutation; no metadata is invented. Add an ordinary readable closed-row positive control that does re-pin. Deleting only the new closed-row readability gate must make the sequence regression red. Implement this guard in the existing pin decider before its closed-row repin return, not as a second pin path.
- [ ] **Step 3: Pin the ambient-read failure and outer boundary.** Fault a landing SELECT inside a caller-owned `tx`, assert it throws to that caller, the caller's prior write rolls back, and after rollback `db.isOpen===true && db.isTransaction===false`. In a standalone `readLanding`, retain typed failure after its own rollback. Unprovable rollback still closes/fail-stops through the outer landing boundary.
```ts
expect(() => tx(db, () => { writeSentinel(); store.readLanding(p); })).toThrow();
expect(readSentinel()).toBeUndefined();
expect(db.isOpen).toBe(true);
expect(db.isTransaction).toBe(false);
```
- [ ] **Step 4: Run red in two bounded groups.** From `server/`: `timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/landing-journal-store.test.ts test/landing-entry-store.test.ts test/landing-advance-route.test.ts --maxWorkers=2`; then `timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/landing-land-store.test.ts test/landing-land-words.test.ts test/landed-decide.test.ts test/landed-lane.test.ts --maxWorkers=2`.
- [ ] **Step 5: Implement proposed amendment B in the existing facts/mark owner.** Measure a full SHA-256 repair token in `landingFactsInner` over exact raw retained row values plus matching authority/subject/witness observations; use the single tagged raw-value grammar in the Terminal repair contract below, including lossless BLOB bytes and unrounded bigints. Pass it into the pure facts fold as values. Derive eligibility there; never hash or inspect SQLite in L1. The reader carries that token to the existing land arm and the arm recomputes it inside its transaction.
  Normal `isLandable` remains unchanged. Add a terminal-repair alternative to the candidate/mark decisions, not a second sweep or writer. The existing PR-keyed reader provides the only external evidence; cap/backoff remain ten and existing values. The close does not get this exception through `expect:null`.
- [ ] **Step 6: Widen `landingReadProjects` at its existing owner.** Return the sorted union of projects with nonterminal/unrecognised-state projections, recovered subjects, or a persisted main-red hold. This includes no-run and unknown-only projects without a session; terminal rows alone need no read. An unrecognised state is not filtered away by a positive pinned/ejected SQL list. Inventory failures remain typed and guarded.
  Keep replay's SQL writes unchanged. Repair never clears fences or appends authority. In `readLanding`, an ambient transaction uses the inner read outside the catch that owns rollback/boundary proof; document that its thrown SQL failures belong to the caller. The new atomic control operation will call `landingFactsInner` directly.
- [ ] **Step 7: Green-run both commands, mutate each repair exclusion independently, then commit.** Record the bounded remaining cases as truthful `recovery:'repair'` holds. Do not claim corrupt identity or lost associations were repaired. No generic manual repair endpoint is added.

### Task 5: Apply health and enqueue the exact cue atomically through existing mail bodies

**Files:** New `server/src/coord/landingNext.ts`, `server/test/landing-next-mail.test.ts`; modify `server/src/coord/{landingWrites,landingEntry,rundefsTx,store,ports}.ts`, `server/test/landingFixture.ts`, `landing-control.test.ts` and existing notice transaction tests reached by the refactor.

**Interfaces — consumes:** `landingBindingOf`, `mainRedNext`, `LandingMutationFacts`, `currentEpisode`, `insertObservation`, `hasMailWithSubject`, `insertSystemMailTx` and the existing notice envelope/stamp transaction body.

**Interfaces — produces:**
- Add `creations:{id:number;seq:number;setBy:string}[]` to landing facts, derived only from valid exact-identity journal creation claims, not mutable projection attribution.
- `NextLandingEpisode = {kind:'run';runId:number;episode:number;toId:string} | {kind:'no-run';creationSeq:number;toId:string}`.
- `NextLandingFacts = {facts:LandingMutationFacts;control:LandingControlRead;nowMs:number;run: {id:number;project:string;state:string;claimedBy:string|null;program:string;wave:number;waveOf:number|null;episode:{e:number;head:string;pr:number|null}|null}|null}`.
- `nextLandingNoticeOf(f:NextLandingFacts): {kind:'no-send';reason:NextLandingNoSendReason} | {kind:'send';entryId:number;pr:number;runId:number|null;toId:string;episode:NextLandingEpisode;identity:string;body:string}`. `identity` is the canonical JSON tuple specified below, not a digest.
- Extract `queueLandingNoticeTx` and `queueRunlessNoticeTx` with exactly their existing public wrapper parameters/return types; neither opens a transaction. Existing wrappers each retain their one `tx` and delegate to its body.
- `CoordStore.applyLandingControl(input:{project:string;control:LandingControlRead;nowMs:number}): LandingControlApplyResult`, where result is `{kind:'no-send';reason:NextLandingNoSendReason;holdChanged:boolean} | {kind:'duplicate';holdChanged:boolean} | {kind:'queued';mailId:number;deliveryId:number;holdChanged:boolean} | {kind:'failure';failure:LandingInfrastructureFailure}`.

- [ ] **Step 1: Pin recipient and tuple policy in pure tests.** A run-bound row requires current same-project run at merging, non-null claimedBy and exact current episode PR/head equal to the pinned row. Never use worker sessionId, historical run binding, latest project coordinator or a guessed successor. A no-run row requires a journal creation claimant/seq; an order setter never replaces that claimant. Missing source means no-send. A valid run with `waveOf:null` is eligible on the same rules: carry null unchanged through the DTO and mail envelope, without a cast or synthetic total. Add a real-store null-wave-total cue assertion.
  Canonical tuple: `["landing-next",1,project,entryId,pr,pinnedSha,handoffCommit,pinnedAt,episode.kind,runIdOrNull,episodeIdOrCreationSeq,baseSha,toId]`. Use exact safe integers and full SHAs. A run re-entry's `currentEpisode.e` distinguishes same-ms re-pins. No-run creationSeq is the immutable creation episode; its conversion to a run uses the new run episode.
```ts
expect(send.toId).toBe('coordinator-a');
expect(JSON.parse(send.identity)).toEqual(['landing-next', 1, p, id, pr, head, handoff, pinnedAt, 'run', runId, episodeId, base, 'coordinator-a']);
expect(noRunSend.toId, 'not the later order setter').toBe('creator-a');
```
- [ ] **Step 2: Add real-store durable dedupe and DB-race red tests.** Queue once, acknowledge/park/reject/deliver it, reopen the store, and retry: duplicate for every delivery state. Distinct base, verified re-entry, no-run→run conversion or new recipient yields one new cue. A→B→A within the same exact episode/base gives one cue to each, not a second cue to A. A head temporarily leaving and returning without a new pin/base does not mint an episode.
  Mutate head/state/order/after/fixesMain/pause/recovery/coordinator/run episode after evidence collection but before invoking the store operation; atomic revalidation must yield no-send or a cue for the newly valid exact recipient, never the stale one.
- [ ] **Step 3: Pin flags and failure atomicity.** Start with pause before red→green, and separately pause between red and green. Both retain operatorPaused. Unknown health never clears red; it independently holds mail when the flag was false. Fault insert, delivery, stamp, observation and COMMIT: no committed half-cue/observation/flag update; failure is not duplicate/no-send. Preserve the established landing writer's fence even after a clean rollback of an applying/committing failure. Assert intermediate `landing-fenced` and that scheduled passes send nothing. In the test, remove the injected fault, perform successful durable `replayLandingJournal`, and only then assert that a subsequent pass queues exactly once. A restart-only fence requires the established restart recovery, not an in-process replay or retry. Do not introduce an automatic replay/fence-clearing lane.
```ts
expect(readFlags()).toEqual({ operatorPaused: true, mainRedHold: false });
expect(out.kind).toBe('failure');
expect(mailRows()).toHaveLength(0);
expect(observationRows()).toHaveLength(0);
expect(store.readLanding(p)).toMatchObject({ ok: false, error: 'landing-fenced' });
```
- [ ] **Step 4: Run red.** `timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/landing-control.test.ts test/landing-next-mail.test.ts --maxWorkers=2` from `server/`.
- [ ] **Step 5: Implement the existing mail-body extraction first.** Public `queueLandingNotice`/`queueRunlessNotice` behaviour and callers do not change. The extracted run body retains `insertObservation(...,{kind:'episode',episode})`; the runless body retains exact-subject dedupe across all mail states. Do not use `hasNotice`, NoticeSink or retained feed rows as mail dedupe. Run the concrete existing notice callers' selected tests after the extraction before adding the new caller.
- [ ] **Step 6: Implement `applyLandingControl` as one landing-specific transaction.** Guard, gather inner facts/current run/current episode, call `mainRedNext`, update only `mainRedHold` on an actual transition, gather/effectively update flags, call the pure cue builder, derive subject `next-to-land:#<pr>:<full SHA-256(identity)>`, then use the appropriate transaction-free notice body. Subject stays below `MAIL_SUBJECT_MAX_BYTES = 200`; never truncate identity. Include the canonical tuple in the durable body for diagnosis and run observation detail `landing:next:v1:<digest>`.
  Use `insertSystemMailTx` transitively, preserving delivery-id envelope stamping. No journal write for measured main health, no operatorPaused UPDATE, no notification from a failed snapshot. Track effects/apply/commit exactly as the existing landing writer; call `landingBoundary` only after the owned transaction unwinds. Add only `applyLandingControl` to the port's reached member list.
- [ ] **Step 7: Use exact cue copy and green-run.** Body starts “Next-to-land cue for <project> #<pr> at <full head>, measured against base <full base>.” Then: “This is not merge permission. Read the landing line again and run the fresh canonical landing verdict and required-checks gate. Do not select another entry, bind a different head, relax a required check or infer that main is still at this base.” Name a fixesMain red exception explicitly. Run Step 4 and the affected transaction-owner tests; commit without pushing.

### Task 6: Compose the existing radar sweep, binding read and coordinator instruction

**Files:** Modify `server/src/watch.ts`, `server/src/coord/{routes,ports}.ts`, `shared/landingLine.ts`; tests `server/test/{radar-lane,landing-read-route,landing-control,coordinator-landing-verdict,coordinator-skill}.test.ts`; modify `ccd/coordinator-skill/references/wave-lifecycle-5b-landing.md` and `README.md`'s landing section.

**Interfaces — consumes:** `readRadarPass(...,controlsWanted)`, `landingReadProjects`, `applyLandingControl`, `landingBindingOf`, existing watcher argument to `registerCoordRoutes`, existing `runLane('landingRadar',...)` and `runLane('landed',...)`.

**Interfaces — produces:** `FleetWatcher.currentLandingControl(project:string):LandingControlRead|undefined`, a defensive snapshot getter; `sweepRadar` retains its public signature and generation fence; GET landing adds `binding` computed from its current coherent facts and the snapshot, using the route's measured now. `LandingLineView.order` is still derived, not stored.

- [ ] **Step 1: Add watcher integration red tests.** Union projects from measured registry rows and the store inventory before the one radar pass. A no-run project and unknown-only project are read without a fleet session. With an unlistable registry, keep chip re-aging behaviour but still read DB-known project control evidence; a failed DB inventory produces no control mutation/cue. A failed listing supplies explicit unavailable evidence, never readiness from a retained green.
```ts
expect(probeReadsFor(noRunProject)).toBe(1);
expect(controlAppliesFor(noRunProject)).toBe(1);
expect(await staleFirstPass).toBeUndefined();
expect(queuedSubjects(), 'superseded async results cannot mail').toEqual(subjectsFromNewPassOnly);
```
- [ ] **Step 2: Pin schedule, cache and deadline boundaries.** Use the existing landingRadar row and its half-beat adapter deadline; no new timer or lane. Check generation immediately after await and before any synchronous apply. Cache only the latest pass's control result, including failure results; no failed read borrows the prior green snapshot. Re-age snapshots when read, and while remote disconnected return held rather than acting on a prior connection's control. Keep `sweepLanded` on its existing row/remote guard; repair uses that lane, not the radar lane.
- [ ] **Step 3: Add route red tests using the existing fixture server/watcher.** Positive absence→`binding.mode:'inert'`; missing/older watcher snapshot→held; positive coherent opt-in+head→ready. `?pr=` still returns that PR's entry but readiness/order are computed over the whole project. Pause, recovery, dirty selected head and malformed evidence hold. Routes perform no control writes or mail. Existing box-token read gating remains unchanged.
- [ ] **Step 4: Run red.** `timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/radar-lane.test.ts test/landing-read-route.test.ts test/landing-control.test.ts --maxWorkers=2` from `server/`.
- [ ] **Step 5: Wire the existing owners.** Extend the real `sweepRadar` rather than moving its scheduling into a new file. For every latest control result, synchronously apply the store operation and cache the measurement; act on discriminated failure with one existing-style warning, never a send on failure. `currentLandingControl` supplies values only; route code hands current facts/control/time to L1. No duplicated eligibility predicates in watch/routes.
- [ ] **Step 6: Replace only the landing-line prose outside the canonical verdict fence.** Proposed instruction: on `binding.mode:'ready'`, land only when its entryId/PR/full pinnedSha identify this run's own pinned entry and bound head. On a ready fixesMain exception, still run the unchanged canonical required-checks gate. `held`, missing binding, a non-head PR, unreadable response or missing entry on a positively opted-in project means stop/report, not choose a successor. `inert` leaves the pre-5i checks in force; 404 remains older-server fallback. A next-to-land mail restarts this read/check procedure, never renews a spent verdict wait.
  Keep all standing clauses and the canonical shell block byte-identical. Apply the same head condition before the existing admin-merge door; do not expand that door. Document that a non-opted-in project's pre-existing line/pause checks are not silently removed by `inert`.
- [ ] **Step 7: Green-run Step 4 and `timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/coordinator-landing-verdict.test.ts test/coordinator-skill.test.ts --maxWorkers=2`.** Update README recovery wording: landing reads/writes are fenced; an uncertain apply and commit can carry mayApply; a restart fence can leave later non-landing route reads on a closed handle. A projection repair refusal is not cured by restart. Commit the integration and prose together.

### Task 7: Strengthen ownership proofs, record departures and prepare one reviewable tip

**Files:** Modify `server/test/landing-entry-census.test.ts`; extend existing area guards under `server/test/single-definition/` only where the new owners need a pin; record task evidence/departure slugs in `docs/superpowers/plans/2026-11-14-landing-order-wave5i-line-head/` task notes. The coordinator, on its own ledger PR, owns the approved spec amendments, programme ledger, central plan/departure-number definitions and approval/landing records; the worker does not edit those documents or allocate IDs. No speculative new policy document.

**Interfaces — consumes:** `parseSource`, `ParsedFile.calls/argSpans/bindings`, `symbolOf`, `callsIn`, existing SQL writer scans, new Task 1–6 symbols and actual mutation evidence.

**Interfaces — produces:** a binding-aware caller assertion local to the existing census, `assertLandingCallerBindings(text:string,file:string):void`; the numeric deviation allocation is not this task's output. Preserve the census's normal three `advanceLanding` callers; terminal repair extends the existing lane's command, not a fourth caller.

- [ ] **Step 1: Replace the fixed 400-character windows with whole AST argument spans.** `advanceAct` passes a run arm; `landedPass` passes the land object; `landOnClose` passes the value produced by `closeLandingOf`. Resolve the identifier to its innermost lexical binding, unwrap satisfies/assertion/parenthesis nodes and follow immutable aliases. Reject parameter shadowing, reassignment, a second producer and unresolved/computed expressions rather than trusting spelling.
```ts
expect(() => assertLandingCallerBindings(closeSource, closeFile)).not.toThrow();
expect(() => assertLandingCallerBindings(reboundCloseSource, closeFile)).toThrow(/closeLandingOf/);
expect(() => assertLandingCallerBindings(paddedRunArmSource, routesFile)).toThrow(/run arm/);
```
- [ ] **Step 2: Pin one-writer and policy ownership additions.** `mainRedHold` runtime writes belong only to `CoordStore.applyLandingControl`; operatorPaused is absent from its UPDATE set. Terminal repair's state/detail update stays inside `advanceLanding`; replay/witness/quarantine-clearing censuses remain unchanged. New policy modules have no I/O/clock. `WatcherCoordPort` equals actual reached members, including transitive mail bodies, with no unused additions.
- [ ] **Step 3: Run red and the focused static/guard set.** From `server/`: `timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/landing-entry-census.test.ts test/coord-policy-rings.test.ts test/rings/watcher-store-port.test.ts --maxWorkers=2`. Run `timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/typecheck-tests.test.ts --maxWorkers=2` separately, with no other suite running. Use `ccrc test -- ./node_modules/.bin/tsc --noEmit` for production typechecking, also alone and foreground with timeout >=600000 ms.
- [ ] **Step 4: Execute and record the mutation matrix below sequentially**, restoring each mutation from its saved copy and proving the same selection green afterwards. No batch of simultaneous mutants, shared-fixture races or “mutation should fail” claims without the measured assertion.
- [ ] **Step 5: Gate growth, tree guards and public text.** From `server/`, run `GROWTH_CHECK=1 timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/growth-check.test.ts --maxWorkers=2`. It must measure against the merge-base with the dispatch's existing `origin/main`, not skip for a missing ref/base. No exemption is inferred; if its armed growth row refuses this design, stop and request an approved decomposition or explicit exemption rather than editing the guard.
  Run `timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/anchors.test.ts test/citations.test.ts test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts --maxWorkers=2`, plus affected single-definition area guards, on the final tracked plan/departure text. Treat `D-NEW-*` as local-draft labels only: remove/replace them with issued IDs or departure slugs before a tracked publication, never guessed numbers.
  Run the established privacy scanner on every changed file and proposed commit/PR text; zero hits and scanner rc=0 are both required. Topology-clean also scans branch history: a later scrub does not make a leaked commit safe to push. Do not copy this drafting environment's coordinates or raw evidence paths into public notes. Check `git diff --check`; confirm no dependency/lockfile, canonical verdict, whitelist, PWA-door or live-setting diff.
- [ ] **Step 6: Re-run the impacted Task 1–6 selections after fixes, in the same bounded groups.** Record exact commands, tip and outcomes. There is no request here for a full-suite dispatch or live proving run. A selected fast check proves only what its summary actually ran.
- [ ] **Step 7: Commit the completed round's code/tests/notes with standing attribution; check queued rulings before its one push.** Departures go by slug to the coordinator; only that coordinator may obtain/define issued numbers. Push once when the round is complete. Wait for the PR's fast CI on this exact pushed tip before wave-done. Any changed tip needs its own fast evidence and review disposition. Normal review, whole-branch pass and merge queue remain mandatory; this draft/completion report is no approval.

## Contract details for Tasks 1–7

This section fixes cross-task seams; it adds no task, service or approval.
Use these definitions when the shorter Interfaces blocks refer to the same names.

### Control evidence, clocks and failure precedence

- `mainRedNext` takes the explicit project as its fourth parameter.
- Before setting either value, compare every successful document's project with that parameter.
- A foreign but otherwise valid bundle keeps the old flag and holds binding.
- `landingBindingOf` compares the same documents with `facts.project`.
- Freshness is tested against the supplied `nowMs` at parsing and again at use.
- A document exactly at the existing freshness boundary follows `freshWithin`, not a locally restated inequality.
- A future/odd timestamp follows that owner's existing refusal; do not add clock tolerance here.
- `operatorPaused` is never inferred from a producer file or health state.
- Lander absence means the producer has not opted the project into this mechanism.
- A lstat/read/decode failure is not lander absence, even if the previous pass was opted out.
- Marker-only staleness holds the line's binding rather than silently switching it off.
- A successful marker may precede the two measurements by many seconds and still be valid.
- Probe and health may have different timestamps; full base equality and independent freshness are the binding proof.
- The producer's fetched base is the only measured base in this wave.
- No wording may call an unqueried later GitHub branch tip the measured current main.
- Eight concurrent project bundles remain the concurrency unit; do not spawn an unbounded per-file fan-out.
- Controls for a project not returned by a successful listing get explicit absent/unmeasured inputs, not an old cache hit.
- A pass deadline failure becomes `late`; an unsupported path-kind measurement stays `unmeasured`.
- Malformed JSON is never converted to an empty required set, an opted-out marker or a green probe.
- Rendered required-check names may collide: producer state remains authoritative for health colour.

### Fixture contracts and targeted test cases

Extend the existing `landingFixture.ts`, rather than introducing another journal harness.
Task 2's exported `controlRead(over?)` provides the following baseline.

| Field | Baseline fixture value |
|---|---|
| project | `project-a` in all three successful docs |
| lander | version-1 coordinator marker, `at = now - 2000 ms` |
| probe | measured main base, full base SHA, `at = now - 1000 ms` |
| selected PR | 7, full head SHA, clean base composition, no head cut |
| health | same full base SHA, green, `at = now`, one required context |
| required context | `{name:'required-a',app:null}` |
| pin | safe positive id, `pinnedAt = now - 3000 ms`, full head/handoff |
| flags | operatorPaused false, mainRedHold false |
| recovery | empty subjects, null hold |

The tests' `now` is fixed; it is passed to parsers and deciders, not read globally.
Use `landingStoreOver(db,dbPath)` for every store fixture that expects an open journal fence.
An intentionally missing journal fixture constructs `new CoordStore` explicitly.
Neutral fixture recipients are `coordinator-a`, `coordinator-b` and `creator-a`.
These are examples, never new shipped account-name enumerations.

| Case name | Perturbation | Exact expectation beyond the task's main assertions |
|---|---|---|
| CONTROL-foreign | all docs name another project | keep previous red; held binding; zero cue |
| CONTROL-prepass | marker is two seconds older than probe | ready when all independent windows pass |
| CONTROL-oversize | measured size is cap+1 | zero range reads; oversize with measured size |
| CONTROL-growth | file grows between range reads | no parser call on assembled partial content |
| CONTROL-old-peer | lstat cannot be measured | unmeasured, never absent |
| CONTROL-name-collision | red contains same rendered name in failing/pending | valid red doc, not malformed |
| ORDER-no-skip | oldest selected PR is conflict; next PR is clean | held on selected entry; zero cue to next |
| ORDER-fix-blocked | fixesMain depends on ordinary pinned PR | ordinary head stays blocked during red |
| ORDER-unknown | readable identity with unknown open projection | binding held even without a journal recovery subject |
| RECOVERY-only-unknown | project has no pinned/ejected rows | project still appears in the reader inventory |
| RECOVERY-terminal | invalid handoff, valid identity and ordering facts | terminal mark only; all damaged metadata retained |
| RECOVERY-quarantine | same row has stale-head marker | no terminal repair, even when forge says merged |
| NOTICE-same-ms | two verified merging episodes have equal pinnedAt | distinct episode ids and one mail for each |
| NOTICE-return | coordinator A→B→A, same pin/base | exactly two total mails, one per recipient |
| NOTICE-replay | ack mail, close/open store, replay journal | same cue remains duplicate |
| NOTICE-stamp-fault | delivery exists transiently, stamp fails | rollback leaves no cue or observation |
| ROUTE-pr-scope | query asks for a later PR | returned entry is scoped, binding still names real head |
| ROUTE-no-snapshot | positively configured store, no measured cache | held binding, not inert or ready |

### Terminal repair input and compare-and-set

Add `terminalTokens:{id:number;token:string}[]` to `LandingStoreRows`.
The token producer is `CoordStore.landingFactsInner`; the fold consumes tokens as values.
The new `terminalRepairs` fact does not replace `projections` or `dependencies`.
It is an independent terminal-evidence permission, never a repaired display projection.

A repair token covers these exact inputs, with field order fixed in its one builder.

| Token part | Included values |
|---|---|
| row | id, project, pr, pinnedSha, handoffCommit, runId, state, baseSha, ejectionKind, ejections, afterIds, fixesMain, setBy, pinnedAt, quarantineKind |
| subject | exact matching identity, bindingKind, observedRunId, observedSeq, creationSeq and creationClaim, or an explicit absent tag |
| authority | exact matching afterIds, fixesMain, setBy and seq, or an explicit absent tag |
| witness | exact matching entryId, project, pr, observedSeq, runId, pinnedSha and handoffCommit, or an explicit absent tag |

Serialize raw values with distinct string/number/bigint/null/absent/byte-value tags. Encode each SQLite BLOB (`Uint8Array`, including Buffer) as the complete lowercase hexadecimal bytes with an explicit byte tag: bytes `[0,255]` encode as `["bytes","00ff"]`, distinct from the text `["string","00ff"]`. Preserve empty BLOB versus empty string and null. Other non-SQLite value kinds make eligibility blocked/retained-fields; do not stringify them or silently omit them.
Add a real-store eligible BLOB-handoff/setter case: a successful terminal mark retains identical raw bytes; changing one byte after token collection makes the old token return moved with no state/detail/witness update. Deleting the byte-value tag or using display-string coercion must make the scalar/BLOB distinction assertion red.
Do not round oversized integers or hash display placeholders instead of retained values.
Keep one private token builder in the store; policy sees only its supplied string.
Recompute the same token before the state/detail UPDATE, inside the mark's existing transaction.
A token mismatch is moved, not a new repair attempt using the newly observed row.
A newly present identity conflict is refused by the existing recovery gate before token acceptance.

The terminal→pin transition is independently guarded: a closed row with unreadable or quarantined projection returns kept/closed and writes no pin witness; readable unquarantined closed rows retain their existing re-pin behavior. Neither a prior terminal observation nor the presence of a repair token supplies projection readability.

Normal candidates still require `isLandable`; repair candidates require the separate eligible fact.
Every repair candidate carries `repairToken`; the lane preserves it in `LandingLand.expect`.
A terminal result for a normal candidate does not acquire repair permission automatically.
A repair result must come from the PR-keyed reader's fresh terminal response in that attempt.
Open, unavailable, timeout, malformed, missing-field and unresolved train answers cannot retire a row.
An absent PR is terminal only when the existing PR parser proves that definite producer answer.
The mark may record the terminal response's actual head in detail; it never writes pinnedSha from it.
Invalid setters remain diagnostic retained data; no new setter is invented by a repair.
A normal verified pin can still reconcile exactly the bounded association cases already approved.
It gains no exception for arbitrary unknown state or unreadable retained metadata in this wave.

### Notice refusal and transaction contracts

Define `NextLandingNoSendReason` in `landingNext.ts` as the union of `LandingBindingReason` with
`'inert' | 'run-unreadable' | 'run-not-merging' | 'episode-unreadable' | 'episode-changed' | 'recipient-missing' | 'creation-unrecorded'`.
Use that type, not unconstrained string, in both `nextLandingNoticeOf` and `LandingControlApplyResult`.
No-send means an eligibility refusal, duplicate means durable prior mail, and failure means the operation did not prove success.
A missing claimedBy is recipient-missing; a missing/unreadable run is run-unreadable.
A run that left merging is run-not-merging; no episode is episode-unreadable.
An episode PR/head mismatch is episode-changed, not a cue using its newer head.
A no-run row without valid journal creation evidence is creation-unrecorded.
For a ready result, apply the health transition before calculating the final binding against effective stored flags.
Use one upsert of `(project,mainRedHold)` with conflict-update of `mainRedHold` only.
Do not update operatorPaused on either the insert-conflict arm or a green transition.
A keep transition performs no health UPDATE; a set equal to the stored boolean is also no change.
`holdChanged` describes the transaction's committed health change, never a cached expectation.
A duplicate cue may still commit a newly measured health change; a failure may not report that change as committed.

The store calls `queueLandingNoticeTx` for a run episode and `queueRunlessNoticeTx` for a creation episode.
Both bodies reach the same `insertSystemMailTx` envelope path as their original wrappers.
The run body rechecks the episode predicate even after the specialized DB eligibility read.
That deliberate TOCTOU/ownership guard is retained, not replaced by subject matching alone.
The no-run subject is a full-digest encoding of the canonical tuple; the full tuple is stored in its body.
`hasMailWithSubject` is over mail, not delivery status; no ack/reject/parking transition re-arms a cue.
No new outbox, dedupe table, notice-retention assumption or delivery retry loop is introduced.
A clean rollback does not itself clear a landing fence. After an applying/committing failure, scheduled passes remain fenced and may not retry. Only after the established successful durable replay (or required restart recovery) clears that fence may a subsequent pass retry without spending a cue identity. No timer invokes replay or clears a fence in this wave.
After an uncertain commit, retain the landing fence and require its established replay/restart path; never classify the failure as duplicate or assume that mail was absent.

For the mail-body extraction, the exact additional foreground command is
`timeout 600s ccrc test -- ./node_modules/.bin/vitest related src/coord/rundefsTx.ts --run --maxWorkers=2`
from `server/`, plus the new focused mail test. This is an impacted-import selection, not a full-suite request.
A selected existing caller that fails is investigated before the new caller is added.
Record a too-long selection as a verification limitation; do not background it or silently replace it with only the new tests.

## 4. Mutation proof matrix

Each row has one owner and a concrete red assertion. Mutating a type guard may be proved by a focused typecheck; do not substitute it for a required behavioural red.

| Row | Delete or mutate | Exact red assertion | Owner task |
|---|---|---|---|
| M1 | Stop→continue on project-list refusal | second project's reader call count is 0 | 1, landed-lane |
| M2 | Prune on incomplete inventory | `memory.has(unvisitedId) === true` | 1, landed-lane |
| M3 | Drop held-mark retry | held memory has `nextAt === t0` and next sweep calls it | 1, landed-lane |
| M4 | Use pass-start for mark, or write-time for memory | `detail.at === t0+1000`; memory `lastReadAt === t0` | 1, advancing clock |
| M5 | Ignore projection in `isLandable` | pinned + unreadable projection returns false | 1, landing-land-words |
| M6 | Add a third hold word without HELD_WORDS entry | typecheck reports missing required key in Record | 1, hold vocabulary |
| M7 | Remove `landOnClose` catch | “a mark that throws” still expects HTTP 200 done | 1, run-routes CLOSE-4 |
| M8 | Remove `remove_own` project `real_dir` guard only | target lander and enabled bytes equal their seeds | 2, producer project symlink |
| M9 | Follow marker ancestor symlink | lander absent and target byte-read count 0 | 2, radar-lane |
| M10 | Remove pre-read cap or request >range limit | oversize file causes 0 range calls; every maxBytes <=262144 | 2, radar-lane |
| M11 | Drop probe base SHA binding | mismatched base yields held/base-mismatch | 3, landing-control |
| M12 | Drop full selected-head equality or skip bad head | stale selected head holds; later clean entry queues 0 mails | 3/5 |
| M13 | Clear red on pending/unmeasured | previous true stays true; false flag still holds mail | 3/5 |
| M14 | UPDATE operatorPaused on health | both pause-before-red and pause-during-red end paused | 5, real store |
| M15 | Let a fix jump after/recovery/operator pause | order/head and held assertions remain blocked | 3, landing-line-order |
| M16 | Remove equal-head projection guard | retreat 503/repair; run unchanged; seeded second ask count 0 | 4, advance route |
| M17 | Accept repair with marker/conflicting binding/token drift | kept/moved/refusal; retained/witness snapshots unchanged | 4, land store |
| M18 | Catch ambient read inside readLanding boundary | shared db remains open after caller rollback; sentinel absent | 4, journal store |
| M19 | Dedupe only outstanding mail or feed retention | retry after ack/restart is duplicate, mail count remains 1 | 5, next mail |
| M20 | Omit episode/base/recipient from tuple | same-ms re-entry/base/new coordinator each has exactly one new mail | 5, next mail |
| M21 | Remove enqueue-time DB revalidation or episode predicate | changed head/pause/run episode sends 0 stale cues | 5, next mail |
| M22 | Ignore failed envelope stamp | failure result; no mail/delivery/observation committed | 5, next mail |
| M23 | Remove radar generation check | superseded pass adds 0 applies/cues | 6, radar-lane |
| M24 | Rebind close `land` to cast run arm; pad call beyond 400 chars | `assertLandingCallerBindings` throws producer/run-arm assertion | 7, census |
| M25 | Remove closed-row projection readability gate | repair→closed→verified pin remains kept/closed; projection and witness snapshots unchanged | 4, real store |
| M26 | Collapse BLOB tag/bytes or omit them from repair token | byte/string encodings differ; one-byte drift returns moved and successful retirement preserves exact bytes | 4, real store |
| M27 | Retry applying/committing failure without durable recovery | intermediate landing-fenced sends zero cues; only successful durable replay permits one subsequent cue | 5, next mail |

## 5. Coverage and acceptance map

| Requirement | Deliverable/assertion |
|---|---|
| Spec §5.3 measurement and §5.5 same-base composition | Task 2 single parser/bounded pass; Task 3 full base/head binding and freshness recheck |
| Spec §5.5 first-green, after, fixesMain and two flags | Task 3 stable selected head; Task 5 independent persisted flag update; amendment A explicitly approved |
| Spec §5.5 once-only mail and coordinator landing | Task 5 exact durable tuple/atomic bodies; Task 6 binding skill read outside unchanged canonical fence |
| Spec §§6–7 ownership, additive wire, no merge surface | Tasks 1/7 policy/binding/SQL census; Task 6 optional binding field and no new authority door |
| Spec §§9–10 sequencing and measured prerequisite | Global constraints retain 5d/5h prerequisite facts and historical latency qualifications, without a new shadow gate |
| D-8357 / D-8360 | Task 1 seven choices characterized then moved; due-at-once wording and import header corrected |
| D-8358 / D-8359 | Tasks 1/7 AST producer binding, independent projection guard, typed mock, exact clock, complete hold union and actual CLOSE-4 row |
| Reviews 1413 / 1357 / 1425 | Task 4 equal-head refusal, truthful repair recovery, ambient boundary and bounded terminal repair; Task 2 project symlink mutation; Task 4 seeded prior-ejection test |
| Waves 5j / 5k boundary | No pause/withdraw route, successor-selection door, PWA screen or account/live-arm change in this wave |

## 6. Proposed departures — local draft only

These labels reserve no numeric IDs. Approval accepts a design choice, not a fabricated allocator receipt.

| Local label | Proposal / reason | Resolution required before execution/publication |
|---|---|---|
| D-8625 | Amendment A permits only the already-selected fixesMain head through main-red; all other gates remain. | Explicit plan/spec approval; issued ID only through the coordinator's allocator act. |
| D-8626 | Amendment B retires bounded unreadable pin metadata on fresh terminal evidence, preserving all retained values and quarantine. | Explicit invariant amendment approval; do not broaden the eligible damage set during implementation. |
| D-8627 | `recovery:'repair'` states that data damage is not fixed by restart. | Approve additive vocabulary and exhaustive-reader updates together. |
| D-8628 | Durable tuple includes current run episode or no-run creation seq, full base/head and recipient; return to an already-told recipient is duplicate. | Approve recipient and once-only semantics, not just the subject spelling. |
| D-8629 | Existing bounded byte ranges plus metadata checks, one freshness window and explicit same-size replacement residual; no new wire operation. | Accept cue-only measurement limit; fresh canonical landing checks remain mandatory. |

## Deviations found

The coordinator issued the five plan-proposal IDs below together and defines them here. They are proposals awaiting plan approval, not as-built departures or execution permission. Existing numbered carries remain authoritative history. A worker reports actual execution departures by slug; the coordinator numbers and records them.

- **D-8625 (2026-11-14)** — `fixes-main-red-exception`: Amendment A permits only the already-selected, dependency-eligible fixesMain head through main-red, while operator pause, recovery, measured readiness and canonical required checks remain gates. Proposed for explicit approval, not an existing operator ruling.
- **D-8626 (2026-11-14)** — `terminal-evidence-repair`: Amendment B permits terminal-evidence retirement of narrowly eligible, unquarantined pin-metadata damage without inventing retained fields or witnesses. A closed row with unreadable projection remains kept/closed on a pin attempt; ordinary readable closed rows still re-pin. Proposed for explicit approval.
- **D-8627 (2026-11-14)** — `projection-repair-word`: An unreadable projection answers recovery repair instead of promising that restart fixes damaged retained data. Replay/restart fences keep their existing separate recovery contract. Proposed additive vocabulary for approval.
- **D-8628 (2026-11-14)** — `next-cue-episode`: The once-only cue identity binds exact entry/pin or creation episode, full head/base and recipient; mail and DB eligibility are committed atomically through existing owners. Returning to an already-told recipient does not re-arm the same identity. Proposed for approval.
- **D-8629 (2026-11-14)** — `bounded-control-snapshot`: The existing bounded FleetIO ranges and metadata rechecks produce a cue snapshot under the existing freshness window, not an atomic no-follow handle or proof about later GitHub main. Fresh canonical landing checks remain mandatory. Proposed measured-limit acceptance for approval.

## Where things stand

**Agreed scope:** 5i's head/health/marker/mail and the named hardening; no automatic landing, new merge authority or PWA doors. Existing journal and canonical landing safeguards survive.

**Waiting on approval:** P1–P6, especially amendments A/B, `recovery:'repair'`, the recipient/episode tuple and the bounded snapshot residual. These are approval questions, not missing technical contracts. No unavoidable technical blocker was found while drafting.

**Later:** 5j/5k doors/UI; any broader corrupt-identity, lost-projection or historical-binding repair requires a separately approved recovery design. This wave reports those holds accurately rather than claiming terminal repair solves them.

**Self-review:** Seven cohesive tasks, concrete inputs/outputs, foreground red/green selections and mutation owners are specified. All five Review Focus classes map to assertions. No source execution or verification result is claimed here. Before dispatch, the coordinator must reconcile the eventual base and review this draft; completion of planning is not review or approval.
