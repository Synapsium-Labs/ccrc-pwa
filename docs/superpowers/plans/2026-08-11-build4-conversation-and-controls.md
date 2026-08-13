# Build 4 — the conversation surface tells the truth, and the run board grows hands

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The transcript stops misattributing the machine's own words to the operator and stops rendering a live question as a dead row; the run board's `0/0` tally gets the writer no production code has ever had; and the operator's phone gets three controls it does not have — pause the fleet, abandon a wedged run, start a program.

**Architecture:** Four bounded contexts, four waves, no two waves touching the same file. Coordination gains a work-item writer (`items` on the dispatch body, `POST /api/runs/:id/items`, one terminality point in `setWorkItemState`, one batch commit in `CoordStore.settleItems`). Fleet Mutation gains exactly one new ccd verb, `coord-pause`, its whitelist grant **and its `REQUIRED_VERB_FLAG` enrolment**. The wire gains one `FleetMsg` member (`{type:'coord'}`), two `RunRefuseCode` members, one `shared/` fence constant + parser, one optional `ChatEvent` field, and one additive field on `RegistryRead`'s `listed:true` arm — nothing else. Session Conversation gains a derived `ChatItem` and a three-state ask card, both PWA-owned. **No new session frame, no new `ChatEvent` kind, no edit to `RUN_TRANSITIONS`.**

**Tech Stack:** TypeScript ESM (Node ≥22.13, Fastify), `node:sqlite`, vitest, React 19, bash (ccd). **No new dependencies in any package.json.**

**Spec:** `docs/superpowers/specs/2026-08-11-build4-conversation-and-controls-design.md` — APPROVED 2026-08-11, its five embedded recommendations ratified as written. Also binding: `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` (the six rings; increment 4's `dispatchRun`/`closeRun` precedent is the model for every new route decision here).

**Baseline for every anchor:** `main` at `40a41db`. Every `file:line` below was re-derived by read/grep against that tree while writing this plan, and every anchor named in a review finding was re-derived a second time while correcting it. **An anchor is a snapshot at plan-writing time, not a live index** — once execution starts moving lines, trust the shipped source's own comments over this document.

**Dogfood:** this plan is Build 7's ratified first program (`build7-fleet-coordination-design.md:281-284, 300`). It is executed through the coordinator: one run per wave, a worker session per wave, a wave brief under 8 KB, a wave-done mail whose `handoffCommit === branchTip`. The Wave Map at the end of this document is the coordinator's dispatch order and is binding.

---

## Deviations found

Twenty-three. Three are the spec's own (D-B4-1/2/3, restated here so an executor never has to leave this file); fourteen were found while measuring the tree against the spec — three of those (D-B4-10 restated, D-B4-16, D-B4-17) by a blocking review of this plan's own first draft, which had credited two mechanisms that cannot kill their mutants, written a `coord` emitter against a variable that is not in scope on a path it can never reach, and put a transaction in a ring that holds no database handle anywhere else in the tree. The last six were found DURING EXECUTION and are dated by their wave: D-B4-18/19/20 in wave 3 (the start-a-program sheet's match, and the reversal of a rule a test had pinned), D-B4-21/22 in wave 4, and D-B4-23 in wave 4's coordinator review — where the defect was the SPEC'S OWN MEASURED FACT, expired by a fix shipped earlier in this same program.

### D-B4-1 (spec) — an abandon carries no fingerprint

`closeRun` (`coord/close.ts:85-94`) demands a shape-valid `{branchTip, prNumber, prPhase, handoffCommit}` and a boolean `final` **before** D-49's branch that skips re-measuring it. An operator abandoning a wedged run has no such claim. `CloseRunBody` gains an explicit `{intent:'abandon'}` variant, validated as its own shape; `handoffCommit` is written `null`, which is exactly what the existing `HANDOFF_SHA` guard (`rundefs.ts:31`) would have produced anyway. **How** it skips that block is D-B4-17.

### D-B4-2 (spec) — an abandon skips the `.prhistory` fold

`close.ts:125-129` refuses the close on an unreadable ledger (`prhistory-unreadable`) — which would disable the abandon in precisely the broken-box case it exists for. An abandon asserts nothing about PR lineage, the same reasoning D-49 already uses for skipping `verifyDone`. `prLineage` stays unfolded.

### D-B4-3 (spec) — `causedBy` becomes a parameter

`close.ts:171` hardcodes `causedBy: 'coordinator'`. An operator abandon records `'operator'`, which `coord/schema.ts:96` has always allowed.

### D-B4-4 — "the same transaction as `markDispatched`/`advance`" does not exist yet

Spec §3.1 says items are inserted "in the same transaction as `markDispatched`/`advance`, after the transition commits". Measured: `dispatch.ts:286-290` runs `coord.markDispatched(...)`, then `coord.setClearedAt(...)`, then `coord.advance(...)` — **three independent transactions** (`advance` wraps itself in `tx`, `store.ts:252-254`). **Adaptation:** fold all four writes into one `CoordStore.dispatchRun(...)`, mirroring `CoordStore.closeRun` (`store.ts:305-334`), which was created for the identical reason (review finding 25). `advanceInner` is already split out for exactly this (`store.ts:256-263`: "`DatabaseSync`'s transactions do not nest… a caller that needs atomicity across more than one state write must call THIS").

### D-B4-5 — `setWorkItemState` cannot express `unknown-item`

Spec §3.2 defines `unknown-item` as "an item id that is not **this run's**". Today's signature is `setWorkItemState(id, state, claimedBy)` (`store.ts:629`) — no `runId`, so a settle body could move another run's item. **Adaptation:** the signature becomes `(runId, id, state, claimedBy)`. Its only existing caller is `server/test/coord-store.test.ts` (spec fact 4: "called **only** from" there), which is updated in the same task.

### D-B4-6 — `closeRun`'s `causedBy` parameter gets no default

A default is exactly how the operator arm would silently record `'coordinator'`. Both call sites pass it explicitly.

### D-B4-7 — the abandon route never reads `req.body`

Spec §4.3: "The abandon route does not accept the flag at all." Validating `archive` away is weaker than never reading it. **Adaptation:** the route calls `closeRun(deps, id, { intent: 'abandon' }, 'operator')` with a body it constructs itself; `req.body` is not referenced. "The phone can never archive" becomes structural rather than a validation anyone can loosen. `closeRun` still validates the abandon shape for its own contract, pinned by a direct unit test.

### D-B4-8 — `planned → failed` needs a store affordance, and `RUN_TRANSITIONS` is not edited

`RUN_TRANSITIONS.planned = ['dispatched','failed']` (`shared/api.ts:1741`) — the `failed` edge is already there; there is no `closing` edge, deliberately (`shared/api.ts:1720-1739`). `CoordStore.closeRun` hardcodes the `closing` hop (`store.ts:310-311`). **Adaptation:** it gains a required `viaClosing: boolean`; `close.ts` decides (`run.state === 'planned'` → `false`). The table is untouched — clients read it as a refusal vocabulary.

### D-B4-9 — `POST /api/coord/pause` is the first ungated route in `coord/routes.ts`

Every write route in that file carries `requireMailToken` (`routes.ts:200-211`), and spec §4.1 rules the box token is deliberately the **wrong key** here (it would hand the coordinator its own unpause). Splitting the file is rejected by the architecture doc (`architecture:143-144`). **Adaptation:** the route lives in `coord/routes.ts` with its reason written at the call site, and `run-routes.test.ts` gains a source scanner asserting every `app.post('/api/runs`/`/api/mail` handler is preceded by a `requireMailToken` line, **excluding `/api/coord/pause` and `/api/runs/:id/abandon` by name** — the `MAIL_REJECT_CODES`-excludes-`undeliverable` idiom (`architecture:64-68`).

### D-B4-10 (restated after review) — the tick's `readdir` exists, but the tick does not hand it out, and the emit must run BEFORE the fail-shut return

The intent stands: `watch.ts`'s tick already reads the registry directory once and shares it between lanes (`watch.ts:496`), `dispatchRun` fails shut on an unlistable one (`dispatch.ts:106-109`), and a second `readdir` for the banner would be a second clock for one fact. Two measured facts make it more than the one-line change the first draft assumed:

1. **There is no `names` to pass.** The tick's shared read is `readRegistryMeasured` (`watch.ts:496`), whose result type is `RegistryRead = { listed: true; records: SessionRecord[] } | { listed: false }` (`registry.ts:356`). The raw `names` array is a local inside `readRegistryMeasured` (`registry.ts:360`) and is never returned. Nothing named `names` is in scope at `watch.ts:757`; the only one nearby (`:741`) is declared inside the snapshot-cache shrink branch, is a **second** `readdir` taken for a different question, and is reached only when a prior snapshot exists and shrank.
2. **The emit cannot live beside `emitRuns`.** `tick()` returns early at `watch.ts:497-521` (`if (!registryRead.listed) { … return; }`) — 236 lines before `emitRuns()` (`:757`). An unlistable registry is *exactly* the `names === null` case `emitCoord` exists to report; an emitter placed at `:757` never runs there, so `coord.pause` would stay frozen at its last value while `dispatchRun` refuses to dispatch — the precise lie spec §4.2 mints `unmeasurable` to prevent ("the phone would render 'running' for a state the server would refuse to dispatch in").

**Adaptation:** `RegistryRead`'s `listed: true` arm gains `names: readonly string[]` — the raw listing the records were derived from, carried rather than re-read. The widening is additive on one arm; `readRegistryMeasured` is shared by `sweepPr` (`watch.ts:1017`), `sweepNames` (`:1075`), `sweepMail` (`:1403`) and `readRegistry` (`registry.ts:412`), and none of them changes. `tick()` then calls `this.emitCoord(registryRead.listed ? registryRead.names : null)` on the line **after** the read and **before** the `!listed` return, so both arms report. The FIRST listing is what is carried, deliberately: the second listing (`registry.ts:400-408`) exists to resolve a per-row reap race, runs on some ticks only, and hanging the markers' clock on it would make the banner's cadence depend on whether an unrelated session happened to be mid-reap. `server/src/registry.ts` and `server/test/registry.test.ts` are therefore wave-2 files and appear in the File Structure table and the wave-2 brief.

### D-B4-11 — `POST /api/sessions` requires a `wrapper`

`api.createSession` takes `{wrapper, project, workdir?}` (`pwa/src/lib/api.ts:194`) — there is no server-side least-loaded placement on that route. **Adaptation:** the start-a-program sheet reads the projection through `useProjectedHome()` (`pwa/src/fleet/useProjectedHome.ts`), which carries `limits.ts`'s own mirror of `_ws_least_loaded`, and names the account **before** the tap. `projected === null` (every home-able lane disabled) refuses with copy rather than guessing a wrapper; `undefined` (no answer yet) renders the in-flight state.

### D-B4-12 — `truncatedBytes` is computed in `parse.ts`, not `shared/`

L0 imports nothing, "not even `node:*`" (`architecture:75-76`), so no `Buffer` there. The caps are CHARACTER caps today (`transcript/parse.ts:3-6`); the field is named for BYTES because a byte count is what an operator can compare against a file. Both stay: the cap is unchanged (changing it changes what every existing transcript renders), and the report is `Buffer.byteLength(whole) - Buffer.byteLength(kept)`. Said at the call site.

### D-B4-13 — `DialogSheet`'s `dismissedKey` is component-local

`DialogSheet.tsx:160` holds it in `useState`, so a transcript control cannot raise a dismissed sheet. **Adaptation:** a `raise?: number` nonce prop, cleared into `dismissedKey: null` by an effect. No store change, no second answer path — the sheet stays the one hardened sender (spec §2.3, "One control, one meaning").

### D-B4-14 — the abandon control cannot nest inside `RunRow`'s button

`RunsScreen.tsx:118-122` wraps the whole row body in a `<button className="run-open">`. A nested button is invalid HTML and unreachable to a screen reader. **Adaptation:** the abandon control is a **sibling** inside the `<li>`, and a test asserts no `button` is a descendant of another.

### D-B4-15 — the em dash needs a home

Spec §3.3's `total === 0` rule stated at the one call site (`RunsScreen.tsx:97`) is a rule with no home. **Adaptation:** `itemTallyLabel(items)` joins `runItems` in `pwa/src/fleet/runWords.ts`, where the tolerant-read idiom already lives.

### D-B4-16 (found in review) — the settle batch commits in the store, not in L1

The first draft opened a transaction inside `server/src/coord/items.ts` (`tx(coord.db, …)`) while declaring that file "L1 (architecture increment 4)". Measured against the tree, no L1 decision function does this: `dispatch.ts`, `close.ts`, `fingerprint.ts`, `prhistory.ts` and `gitref.ts` import neither `./db.js` nor `node:sqlite`; `tx` is imported by `store.ts` (L3), `rundefs.ts` and `routes.ts` only. `architecture:78-81` puts `store.ts`/`coord/db.ts` at L3 and allows L1 to import L2 *as types only*, with "no `node:sqlite`". The inconsistency was also internal to this plan: D-B4-4 folds the dispatch batch into `CoordStore.dispatchRun` and argues the case explicitly, and Task 9 extends `CoordStore.closeRun` with `viaClosing` rather than reaching around it — two identical rulings on the same class of problem (an all-or-nothing multi-row commit), then a third that went the other way.

**Adaptation:** `CoordStore.settleItems(runId, items)` owns the transaction and returns a typed batch result; `items.ts` stays a pure validate-and-map decision with `coord` as its only dep. The all-or-nothing property is carried by a **pre-pass inside the one transaction** rather than by a thrown sentinel: `tx` takes the write lock at `BEGIN IMMEDIATE` and `DatabaseSync` never yields the event loop mid-transaction (`db.ts:235-240`: "a whole transaction runs without yielding the event loop, so no route, sweep or socket can interleave inside one"), so nothing can slip between the pre-pass and the writes. A refusal therefore returns **before any write happens**, no rollback is needed, and the draft's `SettleAbort` sentinel — a private class whose only job was to smuggle a typed refusal out through `tx`'s throw-to-rollback contract — is deleted rather than relocated.

### D-B4-17 (found in review) — the abandon is one contiguous arm of `closeRun`, not five interleaved conditionals

`closeRun` rejects any body without a shape-valid fingerprint and a boolean `final` at `close.ts:85-94`, then dereferences `fp` at `:95-102` (`fp.branchTip`, `fp.prNumber as number|null`, `fp.prPhase`, `fp.handoffCommit`) and reads the claim again at `:171` (`HANDOFF_SHA.test(claim.handoffCommit)`). An abandon carries none of that. The first draft's skip list named `not-dispatched` (`:64-68`), the transition precondition (`:81-83`), `verifyDone`, `.prhistory` and the fleet act — and never mentioned `:85-102` at all, so an executor following it literally ships a route that answers `bad-request` for every abandon; deleting only the `return` leaves `:95-102` throwing a TypeError on `fp`. It also instructed the insertion point as "before the existing fingerprint validation" while two of its own bullets needed `abandon` in scope twenty lines earlier, and its snippet redeclared `const b` in the same scope (TS2451).

**Adaptation:** `abandon` is derived at `:63a`, immediately after `if (!run) return`, together with a hoisted `const b` (the duplicate at `:85` is removed). The abandon then runs as ONE contiguous arm that returns: its own transition precondition, its own conditional `ws-release`, its own commit. `:85-102` is not reached on that path at all, so `handoffCommit`/`final`/`state`/`archive` are `null`/`false`/`'failed'`/`false` **by construction** rather than by four skipped guards — and "never calls `verifyDone`", "never reads `.prhistory`", "cannot reach `wsArchive`" are true because none of those calls exists inside the arm. It also keeps the compiler honest about `run.sessionId`: the ordinary path's `not-dispatched` guard is untouched and still narrows it to `string` for `verifyDone` and the three fleet-act arms, while the abandon arm narrows it inside its own `if (run.sessionId !== null)`. Cost, named: ~14 lines of transition/fleet-act/commit shape appear twice inside one function. That is the price of the property, and it is cheaper than the alternative this review round measured. The spec's §4.3 requirement is unchanged and still met — the abandon route calls the **same L1 function** `closeRun`, and `sendCloseOutcome` is not duplicated.

### D-B4-18 — the new session's id is not in the create response; matched by server-reported facts, not recomputed

`POST /api/sessions`'s success response is the literal `{ok:true}` (`server/src/server.ts:593-596`, `runCcdOr502`) — no id. `ccd` derives the id as `${wrapper}-${project}` (`ccd/ccd:185`, `_id()`) and only echoes it to stdout (`ccd/ccd:7192-7210`, `cmd_start`'s own `echo "started $id …"`), which that route discards. The obvious fix — compute `${wrapper}-${project}` in the PWA — was measured and rejected: it would be a second implementation of a rule ccd owns, the exact drift `useProjectedHome.ts`'s own docstring already refuses for the placement rule one door over ("Two implementations of one rule drift; that is what they do.").

**Adaptation:** after `createSession` resolves, `StartProgramSheet` waits for the new session to appear in a `/ws/fleet` snapshot and matches it on `FleetSession.wrapper`/`.project`/`.workspace` (`shared/api.ts:33-37`, all three server-reported), never on a recomputed id. The wait is bounded at `START_PROGRAM_WAIT_MS` (20 s — the fleet watcher's own 2 s tick, `server/src/watch.ts:424`'s `intervalMs`, plus a generous margin for a cold process spawn, the same reasoning `coordWords.ts`'s `COORD_CONFIRM_MS` states for the pause toggle's own bounded wait, sized up because this one waits on tmux + a wrapper CLI cold start rather than a marker-file flip). A miss renders honest "started, not shown yet" copy — never framed as failure, never navigating to a guessed id — and the wait is generation-guarded (`gen.current`) so a sheet closed mid-wait cannot have a later match write into whatever it shows next.

### D-B4-19 — `cmd_start` is idempotent, so a blind kickoff can hijack a session mid-task

`cmd_start` (`ccd/ccd:7192-7210`) is a no-op for an already-running `${wrapper}-${project}` — it prints `already running: $id …` and returns 0 rather than refusing. A sheet that always posted `POST /api/sessions/:id/prompt` after `createSession` resolved would, for that case, inject a coordinator brief into a session that may be mid-task, with the operator never told anything unusual happened.

**Adaptation:** `StartProgramSheet` derives `existing` on every render from the reactive store selector — a LIVE MAIN CHECKOUT of the target `project` (the operator's own pick), i.e. `project` + `workspace === null` + `status !== 'dead'` (`liveMainCheckoutIn`; see the C1 correction below for the first two conjuncts, and the wrapper ruling immediately below that) — server-reported fields only, never a recomputed id. When one exists, the sheet refuses before the tap: copy naming the existing session, **no confirm button rendered at all**, not merely a disabled one — mirroring how the projection already names the account before the tap rather than guessing.

**Corrected again, re-review of the C1 fix — the REFUSAL is wrapper-independent; `cmd_swap` keeps the id while moving the wrapper.** The C1 fix left both arms matching on `wrapper`, which is only sound while a session's registry `wrapper` still agrees with the `_id()` its own id encodes. It does not: `cmd_swap` ends with `_reg_set "$id" wrapper "$target"` (`ccd/ccd:7307`) — the wrapper field moves, **the id does not** — while `cmd_start`'s collision test is `_alive "$(_id "$wrapper" "$project")"` (`ccd/ccd:7202-7203`), keyed on the id. Measured on the live fleet: **5 of 10 main checkouts report a `wrapper` that differs from their own id prefix** (`claude-rp-llm` reports `wrapper=claude2`). The residual defect that leaves is a dead end, not a hijack: session `W-P` exists but has been swapped to `Y`; the projection says `W`; the wrapper-scoped refusal looks for `wrapper===W`, the row reports `Y`, so it misses; the operator taps Start; `ccd start W P` resolves `_id` to the live `W-P`, prints `already running` and **exits 0**, so the HTTP call succeeds; the wrapper-scoped wait then never matches either, and the sheet ends on *"Started — the board just hasn't shown it yet"* for a program that never started. Reachable on half this fleet's projects.

**Fix:** the refusal arm drops `wrapper` entirely — `project` + `workspace === null` + `status !== 'dead'`. Its question is genuinely wrapper-independent ("is a live main checkout already running in this project?"), which is what `cmd_start` collides with however the row's wrapper field has since been rewritten. It cannot ask the exact question (`_alive(_id(W,P))`) without recomputing the id, which D-B4-18 forbids, so it asks the wider one and **accepts over-refusing**: when the live main checkout is one `cmd_start` would not have collided with, this still refuses. Safe, because this arm renders no confirm button and never acts — refusing more is conservative, and the arm that ACTS (`startedSessionFor`) stays wrapper-scoped, so no widening here can send a kickoff anywhere. The **copy was corrected with it**: it names the session (never the account — the matched row's wrapper may not be the projected one) and covers both outcomes, *"would either send the kickoff into that session, which may be mid-task, or leave the project running two coordinators"*, because the arm cannot tell them apart without the id.

**`isOwnAttempt` moved with it, to `project` alone.** `myAttemptRef` used to hold and compare `wrapper`+`project`, coherent only while the refusal was itself wrapper-scoped. Left as it was, a session this sheet started at `W` and that a swap then reported at `Y` would fail the ownership test and be refused as someone else's — the review fix round 1 (Important 2) defect exactly, resurrected through the swap path. Still bounded: non-null only after a `createSession` for **this** project succeeded in the sheet's current lifetime, cleared on close, overwritten by a newer attempt, and compared on `project`, so switching project drops the suppression on the same render (pinned). And the suppression can only ever hide a warning — the acting arm is unaffected.

**Superseded, whole-branch review (C1) — the match is `wrapper` + `project` + `workspace === null`, and liveness is ASYMMETRIC between the two arms.** (The `workspace`/liveness half stands; the `wrapper` half is corrected above.) Both arms shipped matching on `wrapper`+`project` alone, which is not the session `cmd_start` would collide with. `cmd_ws_add` writes `_reg_set "$id" project "$project"` and `_reg_set "$id" wrapper "$hw"` with `$hw = _ws_least_loaded` (`ccd/ccd:1164+`) onto every WORKSPACE row, and `useProjectedHome`'s wrapper comes from `projectHome` (`server/src/limits.ts:96`), the server's mirror of that same `_ws_least_loaded` — so the projected wrapper is exactly the wrapper workspaces cluster on. Measured against the live registry: workspace `ccrc-pwa-brisk-harbor` reports `project=ccrc-pwa`, `wrapper=claude2`, `workspace=brisk-harbor`, while the coordinator `claude-ccrc-pwa` reports `workspace` absent (null on the wire). Two consequences, one dominant: (1) on a box running ~11 sessions the D-B4-19 refusal fired for the fleet's NORMAL state, rendering *"…is already running… may be mid-task"* with no confirm button and no path forward from the phone — and false on the facts, since `_id('claude2','ccrc-pwa')` is a different id that is not alive and that `cmd_start` would have spawned correctly; (2) race-gated hijack — with no match at tap time the refusal does not fire, `createSession` spawns, a concurrent `ccd ws-add` lands the workspace row on the same wrapper, and the next frame carries both, where `.find()` decides by ARRAY ORDER: a workspace row first sends the coordinator kickoff to a live WORKER, verbatim the harm D-B4-19 exists to prevent.

**Fix:** `FleetSession.workspace` is server-reported and documented as "null for a project's main checkout" (`shared/api.ts:35-37`), so `s.workspace === null` separates a `_id(wrapper,project)` session from a `$project-$slug` one with **no id arithmetic** — D-B4-18's "never recompute the id" holds unchanged. That conjunct is shared by both arms (`isMainCheckoutOf`); everything else about them differs, so they are **two named functions, not one predicate with a flag**:

- **D-B4-18's wait — `startedSessionFor`: wrapper-scoped, ALIVE, and FRESH.** It asks "has the session I just asked for appeared?" and it ACTS (kickoff + navigate), so it must resolve only onto the session this sheet created, at the wrapper it passed to `createSession`.

  **Corrected, coordinator review B-2 — this arm shipped with no liveness conjunct, on reasoning that was wrong.** The original argument was: "`cmd_start` writes the registry fields before tmux is necessarily up, so for a beat the new session is reported `dead`; excluding it would time out a wait on a session that really did start." That **conflates "not resolving on this tick" with "timing out"**. `checkForMatch` re-runs on every later `/ws/fleet` frame and the wait is bounded at `START_PROGRAM_WAIT_MS`, so excluding a dead row costs nothing — the row resolves the moment it is reported alive. The reasoning is corrected here rather than preserved, because it was load-bearing for a rule that let the kickoff reach a DEAD session.

  What it cost: project + wrapper + `workspace === null` is **not a unique key**, by the same `cmd_swap` fact that widened the refusal (`ccd/ccd:7307` moves the wrapper, keeps the id). A main checkout `claude-ccrc-pwa` swapped to `claude2` and since dead is skipped by the refusal, so Start is offered; the projection says `claude2`; `cmd_start` spawns a new `claude2-ccrc-pwa`; the next frame carries both in registry-id sort order (`registry.ts:375`), and `'claude-'` sorts before `'claude2'` (`-` 0x2D < `2` 0x32) — so `.find()` returned the dead swapped row, which satisfies all three conjuncts. The kickoff went to a dead session while the coordinator that actually started never got its brief.

  **Fix:** `status !== 'dead'` **and** a freshness discriminator `!preLive.has(s.id)`, where `preLive` is the set of ids alive in a snapshot taken from `fleet.getState()` immediately BEFORE the create. The rule is "this row became live as a result of my create". Freshness is deliberately **not** "an id I had not seen": a dead row with the same id that `cmd_start` revives is a legitimate resolution (the refusal skips dead rows, so Start is offered, and `ccd start` respawns exactly that id), and it is absent from `preLive` by construction because `preLive` holds only ids that were *alive*.

  `preLive` is unreachable through the component — `start()` refuses to run while `existing !== null`, and `existing` is any live main checkout in the project, so no tap can produce a snapshot already holding a live matching row. Measured: deleting that conjunct alone left the whole integration suite green. `startedSessionFor` is therefore **exported and unit-tested directly**, rather than shipping a guard no test can see.
- **D-B4-19's refusal — `liveMainCheckoutIn`, wrapper-INDEPENDENT, alive-only.** See D-B4-19's own entry below for the wrapper question (`cmd_swap`). `status !== 'dead'` is here and only here: `cmd_start`'s idempotency test is `_alive` (tmux has-session), and without the mirror a dead-but-unreaped row refuses the sheet forever with copy false on every clause, while `ws-reap` is human-only-at-a-terminal by contract — no way out from the phone.

Each arm's conjuncts are pinned **on that arm**, individually — measured by deleting one conjunct from one function at a time, never from the shared `isMainCheckoutOf`. The wait's `project`, `workspace === null`, `wrapper` and `status !== 'dead'` each have their own named killer through the component; its `preLive` freshness conjunct is not reachable that way and is killed by `startedSessionFor`'s own unit test. The refusal's `workspace === null` and `status !== 'dead'` each have one, as does its wrapper-INDEPENDENCE (re-adding a wrapper filter is red); its `project` conjunct is covered by two refusal-side tests rather than a dedicated one. This precision is the correction of an earlier, FALSE claim in this same entry that "every conjunct is red in both directions" — written while three of the wait's own conjuncts were reachable only through the shared helper, so a per-arm deletion left the suite green. The lesson that keeps recurring here: **a conjunct is covered only when a test fails on deleting it at the site it is written**, and extracting or sharing a predicate does not carry that coverage with it.

**Scoped, review fix round 1 (Important 2) — this arm does not fire on the sheet's own attempt.** D-B4-18's timeout and this refusal interact: `existing` cannot by itself tell "someone else's session is in the way" apart from "the session I just started has arrived a moment after the timeout fired" — both are `existing !== null`. Before this fix, a cold spawn that landed after `START_PROGRAM_WAIT_MS` rendered *"…is already running… may be mid-task"* for the session the sheet itself had just asked for — false on both counts, and the kickoff (`waitRef` had been nulled by the timeout) was never sent, leaving the operator holding an un-briefed session under a warning telling them not to start one. **Fix:** `myAttemptRef` (a ref, not tied to `waitRef`'s own bounded lifecycle) remembers the `wrapper`+`project` of the sheet's own last successful `createSession` — **narrowed to `project` alone by the swap correction above, which see** — cleared only on close or a newer attempt; `isOwnAttempt` compares it against `existing` and suppresses this arm when they match. `waitRef` itself is no longer nulled at timeout either — only the busy UI stands down; the wait keeps watching every later `/ws/fleet` frame, so a session that lands late still gets its kickoff and still navigates, exactly as if the timeout had never fired.

### D-B4-20 — a PINNED rule reversed: the wait arm's "no liveness conjunct" was wrong

`startedSessionFor` (`pwa/src/fleet/StartProgramSheet.tsx:144`) shipped **deliberately** without a liveness conjunct, and that choice was not an oversight — it was argued in the function's own docstring, recorded under D-B4-18, and **pinned by a test** (`pwa/test/start-program.test.tsx`, *"D-B4-18's own match carries NO liveness conjunct — a row written before tmux is up still resolves the wait"*). Its stated reason: `cmd_start` writes the registry fields before tmux is necessarily up, so for a beat the new session is reported `dead`, and excluding it "would time out a wait on a session that really did start".

**The reason was false, and the pin made it durable.** It conflates *not resolving on this tick* with *timing out*. `checkForMatch` re-runs on every later `/ws/fleet` frame and the wait is bounded at `START_PROGRAM_WAIT_MS`, so excluding a dead row costs nothing — the row resolves the moment it is reported alive. Because project + wrapper + `workspace === null` is **not a unique key** (`cmd_swap` moves the wrapper and keeps the id, `ccd/ccd:7307`), the missing conjunct let `.find()` return a dead swapped row that sorts before the freshly spawned one, sending the coordinator kickoff to a **dead session** while the session that actually started never got its brief.

**Adaptation:** the wait arm gains `status !== 'dead'` **and** a freshness discriminator — alive now, and either absent from a pre-create snapshot of live ids or present in it but dead ("became live as a result of my create"). Freshness is deliberately *not* "an id I had not seen": a dead row `cmd_start` revives keeps its id and is a legitimate resolution. The pinning test was **replaced, not deleted** — it also carried the arm's `wrapper` coverage, so the replacement pins the corrected rule *and* still fails if `wrapper` is dropped. `startedSessionFor` is exported and unit-tested because the freshness conjunct is unreachable through the component. Full reasoning, the `cmd_swap` non-uniqueness and the sort-order chain live in D-B4-18/19 above; this entry exists so the reversal is discoverable from the index rather than only from inside the entry it corrects.

**Trail:** raised by the implementer while applying the coordinator's review (which had ordered liveness on reasoning of its own that was also wrong about the freshness rule), and **accepted explicitly by the coordinator in review** — both the reversal and the corrected freshness definition. The general lesson, which cost two rounds here: **a test pinning a rule makes the rule durable, not correct** — when a pinned rule is found wrong, the pin is the thing that must be re-argued first, and replaced rather than removed if it also covers something else.

### D-B4-21 (wave 4) — the fence has a SECOND holder, and it is recorded as a gap rather than fixed

Task 15 Step 4 specifies the `single-definition` guard as "`'ccrc-mail'` appears as a literal in exactly one source file … and that file is `shared/api.ts`". Measured: it appears in two. `server/src/inject/send.ts`'s `isMailResidue` tests a DRAFT for a stranded envelope opener with `draft.startsWith('```') && draft.includes('ccrc-mail')` — a genuine second spelling of the same fact, and one that would drift with the fence exactly as the guard fears.

**Adaptation:** the guard ships as a NAMED LIST (`['server/src/inject/send.ts', 'shared/api.ts']`) with the exclusion written down and its reason at the assertion — the `MAIL_REJECT_CODES`-excludes-`undeliverable` idiom this very file already uses for `'mail-disabled'` one describe up. It is NOT fixed here, and that is the brief's own instruction rather than a preference: wave 4's dispatched brief forbids touching `inject/send.ts` by name (it is the hardened send path; this wave has no business inside it). Any NEW holder still fails, so the guard is a mechanism and not a comment. **The gap is real and is stated as such:** whoever next has a reason to edit that file should import `MAIL_ENVELOPE_FENCE` there and shorten the list to `shared/api.ts` alone.

### D-B4-22 (wave 4) — two of this wave's own pins could not fail, and were found by applying the mutants rather than by reading them

Task 19's mutation sweep is what caught both; neither was visible by inspection, and both had passed a full green suite.

1. **The whole-turn rule's PWA pin was covering a different rule.** `mail-card.test.tsx`'s "leaves a turn that is one fenced block PLUS prose as an ordinary bubble" used a fixture with prose ABOVE the fence only. Prose above is refused by the OPENING-fence rule (line 0 is not a fence), so with the closing-fence rule mutated to accept a fence anywhere, the server suite went red and this test stayed **green**. Fixed by covering prose below and both, which is the case only the whole-turn rule can refuse.
2. **The `'ccrc-mail'` literal scan was blind to the spelling the regression would actually use.** It scanned for the single-quoted literal; the realistic mutant — re-inlining the fence into `renderEnvelope`'s own template literal, `` `${fence}ccrc-mail\n` `` — carries no quotes at all, and left the scan green while only its sibling assertion caught it. Rewritten to scan the bare token in comment-stripped source, with the three non-fence spellings (`ccrc-mail.token`, `x-ccrc-mail-token`, and the nudge's `ccrc-mail: …` sentence) excluded by the character that follows them rather than by file name.

**The lesson is the program's own standing one, earned a fourth time:** a pin that cannot fail is worse than no pin, because it is counted. Neither of these was a careless test — both read correctly and both named the right rule. What separated them from working pins was only that nobody had run the mutant. Every guard in this wave was subsequently applied-and-watched: eleven mutants, each observed RED at a named test and GREEN again after restore.

### D-B4-23 (wave 4, coordinator review W-1) — THE SPEC'S MEASURED FACT EXPIRED MID-PROGRAM, and the mail card had no live producer

Spec §2.1's fact 2 — the fact the whole of Task 17 is built on — was measured on 2026-08-11: `sweepMail` typed the rendered envelope into the recipient's pane through `sendPrompt`, so it landed in the JSONL as a **`user` turn**, and "there is no missing mail *event* — there is a missing **attribution**." Task 17 implemented exactly that, gating `buildChatItems` on `e.kind === 'user'`.

**On 2026-08-12, commit `43b2737` (`fix(server): sweepMail injects the reference nudge…`) replaced the typed envelope with a one-line reference nudge — and it shipped EARLIER IN THIS SAME PROGRAM.** It is an ancestor of wave 4's own base (`45fe77c`), and `watch.ts:1650-1657` says so in its own words: "the lane no longer types the whole stored envelope into the pane". So by the time wave 4 was dispatched, mail reached a transcript **only** as the `tool_result` of the worker's own `GET /api/mail/:id`, which `transcript/parse.ts` maps to `kind:'tool_result'`, never `'user'`. Task 17's headline outcome — *"it stops reading as something the operator typed"* — was **not achieved for any current mail**. The code was correct; the premise underneath it had expired. Nothing in the plan, the brief or the wave's own gates could catch it, because every one of them was written against the spec's sentence rather than against the tree.

Three shipped claims were false as written and are corrected: `ChatList.tsx`'s "delivered mail can only ever arrive as a user turn", `MailCard.tsx`'s restatement of the same premise, and `README.md`'s "the envelope was always there, in the JSONL, as a `user` turn" — the last of which matters most, because `CLAUDE.md` designates the README the canonical system overview and the sentence contradicted `CLAUDE.md`'s own invariant ("what lands in a session is a one-line nudge; the body lives in the durable store").

**Adaptation (operator ruling: make it work with today's lane, not merely correct the docs).** Both halves ship.

- `parseFetchedMailEnvelope` joins `parseMailEnvelope` in `shared/`. It takes the two shapes measured in real transcripts on the box: the **raw fence** (a fetch that printed the `envelope` field) and the **JSON response** `GET /api/mail/:id` actually sends (a bare curl). `malformed` survives both doors, so the overloaded-null seam is not lost on the way in.
- `buildChatItems` gains a second arm, in the `tool_result` branch. Two guards, both about what a card CLAIMS: `isError` (a fetch that did not come back cleanly returned no envelope) and `truncatedBytes > 0` (the server has told us it cut this result). **Absent is not zero** — an older server did not report, which is every transcript written before Task 16, and refusing those would make the live path dead for all of them. The truncation guard is deliberately explicit rather than left to emerge: the parse refuses *most* truncated envelopes unaided, because the closing fence is the last line and the cut takes the tail, but "most" is not a property a card may rest on.
- **The result is still attached to its tool card** — the mail card is ADDED, never substituted, or the fetch would render as a call still crunching forever.
- **The legacy user-turn arm STAYS and is not widened.** A verifier scanned the box's transcripts and found real fenced-envelope user turns from waves 1-2, which still render as cards. It is now the legacy/forgery door, not the live one, and it keeps the strict parser: a typed envelope is never a JSON response. Pinned at the call site, not only inside `shared/`.
- **Two fetches of one delivery render TWO cards.** Stated as a decision: the card answers "what was said, and *when*, relative to what the session did next", and two fetches are two things the session did. De-duplicating would need cross-item state keyed on envelope id — the reconciliation problem spec §2.2 refused a second frame over — and would break the derived-from-one-event property that lets the revival discipline stay unchanged. Keyed `mail-${toolId}`, a namespace the tool card's own key cannot collide with.
- **Authenticity is unchanged and is not overclaimed.** The aperture is wider — a `tool_result` is command output, so `cat`-ing a file whose whole content is an envelope renders a card — so the rank-3 caveat is restated at the new function rather than inherited silently. Measured for scale: twelve `tool_result`s in this worker's own transcript carry the characters `ccrc-mail` (greps, file reads, the README) and the whole-turn rule refuses every one.

**A THIRD pin that could not fail was found by this round's sweep** (M-16), and it belongs with D-B4-22's two rather than in a footnote: "still files the fetch itself as a tool card — the result is not stolen" asserted only that a `.toolcard` element EXISTED. A tool card renders whether or not its result ever arrived, so a mutant that skipped `tool.result = e` for envelope-bearing results — leaving the fetch spinning forever — passed it, and passed every other assertion in the file. Fixed by asserting on the state dot (`--run` vs `--ok`), which is the thing that actually differs. **Three for three now: every pin in this wave that could not fail was found by applying a mutant, and none by reading.**

---

## Global Constraints (from the spec, verbatim where quoted)

- **"No new session frame. No new `ChatEvent` kind."** Both were the obvious designs and both are refused (spec §2.2). The `{type:'mail'}` session frame stays exactly what Build 7 Task 6 built: *outstanding* mail for `MailStrip`, replaced wholesale. `applySessionMsg`'s `satisfies never` default arm (`pwa/src/stores/session.ts`) must be untouched at the end of this build — a test asserts it.
- **The only wire additions are the ones in the spec's table**, plus D-B4-10's one additive field on `RegistryRead`'s `listed:true` arm (a server-internal type, not a wire type). **No `FLEET_PROTO` bump** — additive frames are the one-way new-writer/old-reader rule this repo already states (`shared/api.ts:560-566`, and `:1416-1419`'s own precedent).
- **Three documented states for `truncatedBytes`**: absent = *this server did not report*; `0` = not truncated; `>0` = this many bytes were cut. An old server can only produce "absent", which renders **no cue** — never a false claim of completeness.
- **`parseMailEnvelope` returns a typed union, never a bare null**: `{ok:true, envelope}` | `{ok:false, why:'not-mail'}` | `{ok:false, why:'malformed', at}`. The two refusals render identically today; that is a deliberate choice with a test pinning that `malformed` never renders as a mail card. Collapsing them would be the overloaded null the architecture doc bans (`architecture:99-100`).
- **The PWA holds no rule the server does not also hold.** The fence has ONE definition, in `shared/`; `coord/envelope.ts` imports it. A round-trip test proves `parse(render(x))`.
- **The mail card is a rendering, never an authorization.** The transcript is a rank-3 source and a session can type a fake envelope into itself. Consequence: one bubble looks like mail. Named, accepted. Authoritative mail rows keep coming from the DB via `{type:'mail'}` and `GET /api/feed`.
- **"The ledger is fixed at dispatch."** No route adds an item to a dispatched run. `total` never grows and the tally can never move backwards.
- **Done-authority is a fingerprint, not a claim.** `POST /api/runs/:id/items` is the coordinator's write, made **after** `verifyDone` re-measures. The mail bus never routes on `subject` text.
- **One enforcement point, no transition table.** Work items have one invariant — `done`/`failed`/`abandoned` are terminal — and it gets one home, carried in the `UPDATE`'s own `WHERE` clause (`architecture:145-147` rejects a `MAIL_DELIVERY_TRANSITIONS`-shaped answer for exactly this reason).
- **A batch is all-or-nothing.** "Partial success on a ledger write is how tallies drift."
- **No L1 file holds a database handle** (`architecture:78-81`, and D-B4-16). Every multi-row all-or-nothing commit in this build lands as a `CoordStore` method — `dispatchRun`, `settleItems`, `closeRun` — and `single-definition.test.ts` gains the scanner that says so: no file under `server/src/coord/` other than `store.ts`, `rundefs.ts` and `routes.ts` imports `./db.js` or `node:sqlite`.
- **A grant that names a flag is enrolled in `REQUIRED_VERB_FLAG`.** The ladder is `CCD_ARGV` entry → `EXEC_WHITELIST` prefix → `REQUIRED_VERB_FLAG` when the prefix is more than one token → a `test/types/bypasses` fixture. `isExecAllowed` is prefix-matching and says so in its own comment ("tokens after the prefix are unconstrained"), so an *unenrolled* two-token prefix enforces nothing: `['coord-pause']` would still admit `['coord-pause','--state','on']` and every subset test would stay green.
- **The `coord` frame is emitted on EVERY tick outcome, including the one that fails shut** (D-B4-10). An emitter that only runs on the healthy path cannot report the state it exists to report.
- **Operator controls ride the PWA's existing unauthenticated surface** and the box token is deliberately the wrong key for them (spec §4.1). The tailnet stays the perimeter. Honesty clause, restated in the register of Build 7's own spec: on a single-uid box any session can `rm` the marker directly; this adds a recorded chokepoint and a speed bump, and names it as exactly that.
- **`RUN_TRANSITIONS` is not modified.** Clients read that table as a refusal vocabulary; changing it changes what every deployed client believes.
- **No-glow governance, extended.** `.mail-*` is a record and goes still. `.ask-*` may carry the live cue **only** in `awaiting`. A stylesheet test bans `--glow`/`animation`/`box-shadow` everywhere else under those prefixes, with the one exception named BY NAME.
- **Rollout order is forced and is Build 7's:** ccd verb + agent whitelist + coordinator skill (fleet host) → server → PWA. A PWA that ships before the verb renders a pause toggle that answers `501` for every tap. Wave 2 is therefore deployed agent-first.
- Run ALL verification **FOREGROUND** in single blocking calls. The server suite is ~200 s and the ccd files alone are ~90 s — use `timeout: 600000` ms. Report REAL printed counts. **Never background a suite.**
- **Mutation duty in `coord/`**: every guard added here ships with a test that goes red when it is **deleted** and when it is **reordered** — and every mutation-table row names a test that can actually discriminate it. A row whose named killer cannot see the edit is the failure commit `8cbb716` exists to prevent; if a row cannot be earned, the row is deleted and the gap is recorded.
- **Never run `ccd` against the live HOME. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits`, `~/.cc-secrets`. No `git push`, no `gh`.** The ccd suites already run the real script against fixture HOMEs; that is the only place ccd executes.

**Read the code before you write it.** Every code block below is **shape-authoritative, not text-authoritative**. Where it disagrees with a harness helper or a neighbouring file's idiom, **the tree wins**. `server/test/helpers.ts` owns `testDeps`; `server/test/tmpHelpers.ts` owns fixture lifetimes; `server/test/ccdWsHelpers.ts` owns the ccd fixture HOME; `server/test/run-routes.test.ts` is the authority on driving the coord routes; `server/test/fleetws.test.ts` on driving `/ws/fleet`; `server/test/registry.test.ts` on driving `readRegistryMeasured`; `agent/test/whitelist-structural.test.ts` on the bypass-fixture protocol; `pwa/test/cssRule.ts` on reading a stylesheet as text; `pwa/test/mail-strip.test.tsx` on the negative-pin idiom ("offers no way to answer").

---

## File Structure

| file | responsibility | change | wave |
|---|---|---|---|
| `shared/api.ts` | the ubiquitous language | `+WORK_ITEM_TITLE_MAX`/`WORK_ITEM_MAX`; `RunRefuseCode` `+unknown-item`/`+item-terminal`; `+MarkerState`/`isMarkerState`/`CoordStatus`; `FleetMsg` `+{type:'coord'}`; `+MAIL_ENVELOPE_FENCE`/`MailEnvelope`/`MailEnvelopeParse`/`parseMailEnvelope`; `ChatEvent` `+truncatedBytes?` | 1,2,4 |
| `server/src/coord/store.ts` | rows and transitions | `+dispatchRun` (one tx); `setWorkItemState` typed + run-scoped; `+TERMINAL_ITEM_STATES`; `+settleItems` (the batch tx, D-B4-16); `closeRun` `+viaClosing`; `+workItems(runId)` | 1,2 |
| `server/src/coord/dispatch.ts` | the dispatch decision (L1) | `+items` validation; step 6 becomes one `coord.dispatchRun` call | 1 |
| `server/src/coord/items.ts` | **new** — the settle decision (L1), validate-and-map only | create | 1 |
| `server/src/coord/close.ts` | the close decision (L1) | `+intent:'abandon'` arm, D-B4-1/2/3/8/17 | 2 |
| `server/src/coord/routes.ts` | union→status maps + the token gate | `+POST /api/runs/:id/items`, `+POST /api/runs/:id/abandon`, `+POST /api/coord/pause` | 1,2 |
| `server/src/coord/envelope.ts` | the fenced envelope | imports `MAIL_ENVELOPE_FENCE` (one definition) | 4 |
| `server/src/registry.ts` | the fleet read | `RegistryRead.listed:true` `+names` (D-B4-10) | 2 |
| `server/src/ccdargv.ts` | the argv table | `+coordPause(state)` | 2 |
| `server/src/watch.ts` | the lanes | `+emitCoord()` + `currentCoord()`, called on BOTH arms of the tick's registry read | 2 |
| `server/src/bus.ts` | the typed bus | `+'coord'` overloads | 2 |
| `server/src/server.ts` | `/ws/fleet` | `+coord` frame fan-out + cold start | 2 |
| `server/src/transcript/parse.ts` | JSONL → `ChatEvent` | `truncate` reports what it cut | 4 |
| `agent/src/whitelist.ts` | the grant table | `+['coord-pause','--state']` **and** `REQUIRED_VERB_FLAG['coord-pause']='--state'`; the audit message stops calling every gated verb destructive | 2 |
| `agent/test/types/bypasses/g9-coord-pause-without-state.ts` | **new** — the compile pin for the mutant | create | 2 |
| `agent/test/whitelist-structural.test.ts` | the three mechanisms | `+g9` expectation, `+` the runtime-audit case | 2 |
| `ccd/ccd` | the fleet-host verb surface | `+cmd_coord_pause`, dispatch arm, `cmd_caps` entry, usage line | 2 |
| `ccd/coordinator-skill/SKILL.md` | the coordinator's contract | dispatch body gains `items`; the settle call joins the lifecycle | 1 |
| `ccd/coordinator-skill/references/wave-lifecycle.md` | §2 dispatch, §4 advance | `items` on dispatch; `POST .../items` after a green re-measurement | 1 |
| `pwa/src/fleet/runWords.ts` | the board's vocabulary | `+itemTallyLabel` | 1 |
| `pwa/src/fleet/coordWords.ts` | **new** — the marker vocabulary | create | 3 |
| `pwa/src/fleet/CoordBanner.tsx` | **new** — pause banner + toggle | create | 3 |
| `pwa/src/fleet/AbandonSheet.tsx` | **new** — two-tap abandon | create | 3 |
| `pwa/src/fleet/StartProgramSheet.tsx` | **new** — composition, not a route | create | 3 |
| `pwa/src/screens/RunsScreen.tsx` | the board | `itemTallyLabel`; the banner, the abandon control, the door | 1,3 |
| `pwa/src/stores/fleet.ts` | the fleet slice | `+coord`/`coordFrameSeen` + the `coord` arm in `asFleetMsg` | 3 |
| `pwa/src/lib/api.ts` | the client surface | `+coordPause`, `+abandonRun` | 3 |
| `pwa/src/session/MailCard.tsx` | **new** — the attributed mail card | create | 4 |
| `pwa/src/session/ChatList.tsx` | the render model | `ChatItem` `+{kind:'mail'}`; `buildChatItems` derives it; `askPending`/`onAnswer` props | 4 |
| `pwa/src/session/ToolCard.tsx` | the ask card | three-state axis + the `Answer` control | 4 |
| `pwa/src/session/DialogSheet.tsx` | the one answer path | `+raise?: number` (D-B4-13) | 4 |
| `pwa/src/screens/SessionScreen.tsx` | the session surface | holds the raise nonce, threads `askPending` | 4 |
| `pwa/src/session/chat.css` | conversation styling | `.mail-card-*`, `.ask-*` | 4 |
| `pwa/src/fleet/fleet.css` | board styling | `.coord-*`, `.run-abandon`, `.program-start-*` | 3 |
| `server/test/coord-items.test.ts` | **new** — the settle route, both directions | create | 1 |
| `server/test/ccd-coord-pause.test.ts` | **new** — the real verb against a fixture HOME | create | 2 |
| `server/test/coord-pause-route.test.ts` | **new** — grant, 501, 502, the ungated pin | create | 2 |
| `server/test/coord-abandon.test.ts` | **new** — the four wedged shapes + the negative pins | create | 2 |
| `server/test/mail-envelope-parse.test.ts` | **new** — the round trip | create | 4 |
| `pwa/test/coord-banner.test.tsx`, `abandon-sheet.test.tsx`, `start-program.test.tsx` | **new** | create | 3 |
| `pwa/test/mail-card.test.tsx`, `ask-live.test.tsx` | **new** | create | 4 |
| existing suites touched | `coord-store.test.ts`, `run-routes.test.ts`, `registry.test.ts`, `single-definition.test.ts`, `whitelist-subset.test.ts`, `verb-gate.test.ts`, `fleetws.test.ts`, `coordinator-skill.test.ts`, `transcript-parse.test.ts`, `runs-screen.test.tsx`, `chat.test.tsx`, `tap-targets.test.tsx`, `fleet-css.test.ts`, `stores.test.ts` | extend | all |

---

## Task order and why it is this order

The ledger before the controls before the console before the transcript. Wave 1 first because the dogfood wants live tallies as early as possible — the build proves its own feature, and waves 2–4 are counted by the ledger wave 1 builds. Wave 2 before wave 3 because a PWA that ships before the verb renders a toggle that 501s. Wave 4 last because it is the only wave that touches `ChatList`/`ToolCard` and depends on nothing else.

1. The dispatch body declares the ledger — one transaction
2. `setWorkItemState` stops returning `void`, and the batch gets its commit
3. `POST /api/runs/:id/items` — the coordinator settles after re-measurement
4. The tally stops lying at zero, and the skill learns to declare items
5. Wave 1 gates — mutants, scanners, the handoff commit
6. `ccd coord-pause --state on|off` — the marker gets a writer
7. The grant, its enrolment, the argv, and `POST /api/coord/pause`
8. `MarkerState` and the `{type:'coord'}` frame — off the tick's own listing, on both arms
9. `POST /api/runs/:id/abandon` — a wedged run can be let go
10. Wave 2 gates — verb gates, agent-first, the handoff commit
11. The pause banner and its toggle — no optimism, four states
12. The abandon sheet — two taps, and never an archive
13. Start a program — composition, not a compound route
14. Wave 3 gates — design gates, tap floor, no-glow, the handoff commit
15. `MAIL_ENVELOPE_FENCE` and `parseMailEnvelope` — one grammar, one definition
16. `truncatedBytes` — a cut result says it was cut
17. The mail `ChatItem` — the machine's words stop being the operator's
18. The ask card's third state, and one control that only opens the sheet
19. Wave 4 gates — negative pins, the program's own close

---

# WAVE 1 — Coordination: the writer

### Task 1: the dispatch body declares the ledger, and the commit becomes one transaction

Spec §3.1. `POST /api/runs/:id/dispatch` gains `items?: string[]`. **The brief stays opaque prose and is parsed by nothing** — the coordinator, which wrote the brief, also declares the item titles.

**Files:**
- Modify: `shared/api.ts` (beside `MAIL_SUBJECT_MAX_BYTES`, `:1798-1817`)
- Modify: `server/src/coord/store.ts` (`addWorkItem` `:622-627`; new `dispatchRun` beside `closeRun` `:305-334`)
- Modify: `server/src/coord/dispatch.ts` (`:68` signature, `:84-99` validation, `:286-290` the commit)
- Modify: `server/src/coord/routes.ts` (`:730-733` — the body read)
- Modify: `server/test/run-routes.test.ts`

**Interfaces:**
```ts
// shared/api.ts
export const WORK_ITEM_TITLE_MAX = 200;   // UTF-8 BYTES, like MAIL_SUBJECT_MAX_BYTES
export const WORK_ITEM_MAX = 32;

// server/src/coord/store.ts — mirrors closeRun's shape and its reason (D-B4-4)
dispatchRun(input: {
  runId: number; sessionId: string; workspace: string | null; branch: string | null;
  resumed: boolean; clearedAt: number | null; items: readonly string[]; detail?: string;
}): AdvanceResult

// server/src/coord/dispatch.ts
export async function dispatchRun(
  deps: DispatchRunDeps, id: number, brief: unknown, items: unknown,
): Promise<DispatchOutcome>
```

- [ ] **Step 1: Write the failing tests** in `server/test/run-routes.test.ts`:

```ts
describe('POST /api/runs/:id/dispatch — the declared ledger', () => {
  it('inserts one pending work item per title, in body order', …);
  it('treats an absent items field and [] identically: the run has no declared ledger', …);
  it('refuses bad-request on a non-array, a non-string entry, or an empty/whitespace title', …);
  it(`refuses bad-request past WORK_ITEM_MAX entries`, …);
  it('refuses bad-request on a title over WORK_ITEM_TITLE_MAX BYTES, measured in utf-8', …);
  it('leaves NO work_items rows behind when the transition is refused', …);   // D-B4-4
  it('leaves NO work_items rows behind when the hold fails 502 before the commit', …);
  it('needs no dedupe key: RUN_TRANSITIONS.dispatched has no self-edge, so a second dispatch 409s', …);
});
```

- [ ] **Step 2: Run it and watch it fail**
Run: `cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts` (`timeout: 600000`) → FAIL.

- [ ] **Step 3: Add the caps to `shared/api.ts`**, docstring naming why they are bytes (`MAIL_SUBJECT_MAX_BYTES`'s own reasoning, `:1798-1815`) and why 32 (a wave with more than 32 declared items is a wave that should have been two).

- [ ] **Step 4: Add `CoordStore.dispatchRun`**, beside `closeRun` and citing it:

```ts
  /**
   * The WHOLE dispatch commit, as ONE transaction (D-B4-4). Before this, the
   * dispatch route ran `markDispatched`, `setClearedAt` and `advance` as three
   * independent `tx()`s — the identical split `closeRun` above was created to
   * close (review finding 25). The work items make it load-bearing rather than
   * merely tidy: spec §3.1 requires that "a refused or failed dispatch leaves
   * no orphan rows", and rows inserted by a fourth independent statement after
   * a crashed third are exactly such orphans — a `planned` run carrying a
   * ledger nothing ever dispatched.
   *
   * Items are inserted AFTER the transition succeeds and INSIDE the same
   * transaction: `advanceInner`'s write is visible to the reads that follow it
   * within one `tx()`, and a refused transition returns before any INSERT runs.
   */
  dispatchRun(input: { … }): AdvanceResult {
    return tx(this.db, () => {
      this.markDispatched(input.runId, input.sessionId, input.workspace, input.branch, input.resumed);
      if (input.clearedAt !== null) this.setClearedAt(input.runId, input.clearedAt);
      const adv = this.advanceInner(input.runId, 'dispatched', 'coordinator', input.detail);
      if (!adv.ok) return adv;
      for (const title of input.items) this.addWorkItem(input.runId, title, []);
      return adv;
    });
  }
```

- [ ] **Step 5: Validate `items` in `dispatchRun` (`dispatch.ts`)**, in the same block as the brief checks (`:84-99`), i.e. BEFORE the pause check — a malformed body is the cheapest refusal and D-46's ordering rule puts it first:

```ts
  // Spec §3.1. The BRIEF stays opaque prose and is parsed by nothing
  // (build7:216-217, :246-248) — the server never learns to read a wave plan
  // out of English. The coordinator, which wrote the brief, declares the item
  // titles beside it, as a structured field. `undefined` and `[]` are the same
  // legal answer: this run declared no ledger, and its tally renders an em
  // dash rather than 0/0 (spec §3.3).
  if (items !== undefined) {
    if (!Array.isArray(items) || items.length > WORK_ITEM_MAX) {
      return { ok: false, kind: 'bad-request' };
    }
    for (const t of items) {
      if (typeof t !== 'string' || t.trim() === '' ||
          Buffer.byteLength(t, 'utf8') > WORK_ITEM_TITLE_MAX) {
        return { ok: false, kind: 'bad-request' };
      }
    }
  }
  const itemTitles: readonly string[] = (items as string[] | undefined) ?? [];
```

Then replace `:286-290` with the single `coord.dispatchRun({...})` call, keeping the `clear-refused:` detail string exactly as it is.

- [ ] **Step 6: Thread the body field at the route** (`routes.ts:730`): `const body = (req.body ?? {}) as { brief?: unknown; items?: unknown };` and pass `body.items` through.

- [ ] **Step 7: Run the gates this task moves**
Run: `cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts test/coord-store.test.ts test/dispatch-mutex-gate.test.ts test/reconstruction-drill.test.ts` (`timeout: 600000`) → PASS.

- [ ] **Step 8: Commit**
```bash
git add shared/api.ts server/src/coord/store.ts server/src/coord/dispatch.ts server/src/coord/routes.ts server/test/run-routes.test.ts
git commit -m "feat(server): a wave declares its ledger at dispatch, and the whole commit becomes one transaction"
```

---

### Task 2: `setWorkItemState` stops returning `void`, and the batch gets its commit

Spec §3.2, and `architecture:25-30` names this exact defect shape for `markDelivered`. Per `architecture:145-147` work items get **one enforcement point, not a transition table** — and per D-B4-16 the all-or-nothing batch commits **here**, in the ring that owns `DatabaseSync`'s synchrony invariant, not in the L1 decision function that will call it.

**Files:**
- Modify: `server/src/coord/store.ts` (`:629-631`, and beside `itemTally` `:633-639`)
- Modify: `server/test/coord-store.test.ts` (the only existing caller — spec fact 4)

**Interfaces:**
```ts
/** The three terminal members, ONCE. The SQL literal below is built from this
 *  list, so the guard in the `WHERE` and the batch pre-pass cannot drift. */
export const TERMINAL_ITEM_STATES = ['done', 'failed', 'abandoned'] as const satisfies
  readonly WorkItemState[];

export type SetWorkItemResult =
  | { ok: true; state: WorkItemState }
  | { ok: false; why: 'unknown-item' }
  | { ok: false; why: 'terminal'; state: WorkItemState };

export interface SettleItem { id: number; state: WorkItemState; claimedBy: string | null }

export type SettleItemsResult =
  | { ok: true; items: RunItemTally }
  | { ok: false; itemId: number; why: 'unknown-item' }
  | { ok: false; itemId: number; why: 'terminal'; state: WorkItemState };

setWorkItemState(runId: number, id: number, state: WorkItemState,
                 claimedBy: string | null): SetWorkItemResult
settleItems(runId: number, items: readonly SettleItem[]): SettleItemsResult
workItems(runId: number): { id: number; title: string; state: WorkItemState; claimedBy: string | null }[]
```

- [ ] **Step 1: Write the failing tests** in `server/test/coord-store.test.ts`:

```ts
describe('setWorkItemState — one terminality point', () => {
  it('settles a pending item and answers ok', …);
  it('settles a CLAIMED item — only done/failed/abandoned are terminal', …);
  it('answers unknown-item for an id that belongs to ANOTHER run', …);      // D-B4-5
  it('answers unknown-item for an id no run has', …);
  it('refuses to move a settled item, and names the state it is already in', …);  // mutant A
  it('leaves a refused row EXACTLY as it was — same state, same claimedBy', …);   // mutant B
  it('reads every state back through isWorkItemState, never a cast', …);
});

describe('settleItems — the batch, all-or-nothing, in ONE transaction', () => {
  it('settles every item in the body and answers the fresh tally', …);
  it('settles NOTHING when one id in the batch is unknown — the earlier ids are untouched', …);
  it('settles NOTHING when one id in the batch is already terminal, and names it', …);
  it('refuses a body naming the SAME id twice when the first settle is terminal, and writes nothing', …);
  it('allows the same id twice when the first target is NOT terminal (pending -> claimed -> done)', …);
  it('scopes every id to the run: another run\'s item is unknown-item, and that run is untouched', …);
  it('holds NO database handle outside this class — items.ts imports neither db.js nor node:sqlite', …);
});
```

- [ ] **Step 2: Run it and watch it fail**
Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts` (`timeout: 600000`) → FAIL.

- [ ] **Step 3: Write the guard**, with the terminality carried in the `WHERE`:

```ts
  /** Work items have ONE invariant — `done`/`failed`/`abandoned` are terminal —
   *  and per `architecture:145-147` it gets one enforcement point rather than a
   *  `WORK_ITEM_TRANSITIONS` table (`RUN_TRANSITIONS` earns its place by
   *  encoding ~15 edges clients read as refusals; this encodes one).
   *
   *  THE GUARD IS IN THE `WHERE`, not in a read above it. A read-then-write
   *  would answer `ok` for a row a concurrent writer settled between the two
   *  statements — and, worse under a careless edit, would MOVE the row and then
   *  report the refusal. `changes === 0` past a successful lookup means exactly
   *  one thing: the row was already terminal. Mutant duty: deleting the
   *  `state NOT IN` clause, and moving the guard after the UPDATE, each go red
   *  (`coord-store.test.ts`'s two `setWorkItemState` refusal cases, which call
   *  this method DIRECTLY — `settleItems` below refuses earlier, so only a
   *  direct call can discriminate this clause). */
  private static readonly TERMINAL_SQL = `('${TERMINAL_ITEM_STATES.join("','")}')`;

  setWorkItemState(runId: number, id: number, state: WorkItemState,
                   claimedBy: string | null): SetWorkItemResult {
    const row = this.db.prepare('SELECT state FROM work_items WHERE id = ? AND runId = ?')
      .get(id, runId) as { state: string } | undefined;
    if (!row) return { ok: false, why: 'unknown-item' };
    const res = this.db.prepare(
      'UPDATE work_items SET state = ?, claimedBy = ? WHERE id = ? AND runId = ? ' +
      `AND state NOT IN ${CoordStore.TERMINAL_SQL}`,
    ).run(state, claimedBy, id, runId);
    if (Number(res.changes) === 0) {
      return { ok: false, why: 'terminal', state: isWorkItemState(row.state) ? row.state : 'unknown' };
    }
    return { ok: true, state };
  }
```

- [ ] **Step 4: Write the batch commit** (D-B4-16), beside it:

```ts
  /**
   * The settle batch, as ONE transaction — the third member of the family
   * `dispatchRun` and `closeRun` already belong to (D-B4-4, review finding 25),
   * and here for the same reason plus one more: spec §3.2 requires that "a body
   * naming one bad id settles nothing", because "partial success on a ledger
   * write is how tallies drift".
   *
   * WHY THE PRE-PASS AND NOT A THROW. `tx` rolls back on a throw and only on a
   * throw (`db.ts:241-253`), so an in-flight refusal used to need a private
   * sentinel class to travel out — in an L1 file that has no business holding
   * this handle at all (D-B4-16). It does not need one HERE: `tx` takes the
   * write lock at `BEGIN IMMEDIATE` and `DatabaseSync` never yields the event
   * loop mid-transaction (`db.ts:235-240`: "no route, sweep or socket can
   * interleave inside one"), so a read taken in the pre-pass cannot be
   * overtaken before the writes below it. A refusal therefore returns BEFORE
   * anything is written, and there is nothing to roll back.
   *
   * The pre-pass carries the batch's OWN effect forward in `effective`: a body
   * naming the same id twice sees the first settle, so a second write onto a
   * now-terminal row is refused — the refusal it would earn from the `WHERE`
   * clause anyway, reached before the first write instead of after it.
   *
   * `setWorkItemState`'s `WHERE` guard stays exactly where it is and is still
   * the invariant's one home. This pass is a PRECHECK, not a second guard, and
   * it reads `TERMINAL_ITEM_STATES` — the same list the SQL literal is built
   * from — so the two cannot drift. If they somehow do, the write loop throws
   * rather than half-writing, and `tx` rolls the whole batch back.
   */
  settleItems(runId: number, items: readonly SettleItem[]): SettleItemsResult {
    return tx(this.db, () => {
      const effective = new Map<number, string>();
      for (const it of items) {
        const current = effective.get(it.id) ?? (this.db
          .prepare('SELECT state FROM work_items WHERE id = ? AND runId = ?')
          .get(it.id, runId) as { state: string } | undefined)?.state;
        if (current === undefined) return { ok: false as const, itemId: it.id, why: 'unknown-item' as const };
        if ((TERMINAL_ITEM_STATES as readonly string[]).includes(current)) {
          return { ok: false as const, itemId: it.id, why: 'terminal' as const,
            state: isWorkItemState(current) ? current : 'unknown' };
        }
        effective.set(it.id, it.state);
      }
      for (const it of items) {
        const res = this.setWorkItemState(runId, it.id, it.state, it.claimedBy);
        if (!res.ok) {
          throw new Error(
            `settleItems: item ${it.id} refused '${res.why}' inside its own transaction — ` +
            'the pre-pass and the WHERE guard disagree, which is a bug, not a refusal',
          );
        }
      }
      return { ok: true as const, items: this.itemTally(runId) };
    });
  }
```

Add `workItems(runId)` beside `itemTally` (`:633-639`), reading every enum through `isWorkItemState` — `hydrateRun`'s rule (`:538-541`), one file over.

- [ ] **Step 5: Update the existing caller** in `coord-store.test.ts` to the new signature.

- [ ] **Step 6: Run the gates**
Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts test/reconstruction-drill.test.ts` (`timeout: 600000`) → PASS.

- [ ] **Step 7: Commit**
```bash
git add server/src/coord/store.ts server/test/coord-store.test.ts
git commit -m "fix(server): a work item's terminality gets one home, the writer stops answering void, and the batch commits where the handle lives"
```

---

### Task 3: `POST /api/runs/:id/items` — the coordinator settles after re-measurement

Spec §3.2. The **coordinator** is the writer at both ends: it creates items at dispatch and settles them when it processes a `wave-done` — after `verifyDone` re-measures, "which is the moment ccrc is allowed to believe a worker."

**Files:**
- Create: `server/src/coord/items.ts`
- Modify: `server/src/coord/routes.ts`, `shared/api.ts` (`RunRefuseCode` `:1891-1901`)
- Create: `server/test/coord-items.test.ts`

**Interfaces:**
```ts
// shared/api.ts
export type RunRefuseCode = … | 'unknown-item' | 'item-terminal';   // + both in RUN_REFUSE_CODE_MAP

// server/src/coord/items.ts — an L1 decision function (architecture increment 4)
export interface SettleItemsDeps { coord: CoordStore }
export type SettleItemsOutcome =
  | { ok: true; id: number; items: RunItemTally }
  | { ok: false; kind: 'unknown-run' }
  | { ok: false; kind: 'bad-request' }
  | { ok: false; kind: 'refused';
      code: Extract<RunRefuseCode, 'unknown-item' | 'item-terminal'>;
      itemId: number; state?: WorkItemState };
export function settleItems(deps: SettleItemsDeps, id: number, body: unknown): SettleItemsOutcome;
```

- [ ] **Step 1: Write the failing test** — `server/test/coord-items.test.ts`:

```ts
describe('POST /api/runs/:id/items', () => {
  it('401s without the box token, like every other coordination write route', …);
  it('501 not-configured without a coord store', …);
  it('marks the named items and answers the fresh tally', …);
  it('404 unknown-run', …);
  it('404 unknown-item, naming the id, for an item of a DIFFERENT run', …);
  it('409 item-terminal, naming the id and the state it is already in', …);
  it('settles NOTHING when one id in the batch is bad — all-or-nothing', …);
  it('settles nothing when the same id appears twice and the first settle is terminal', …);
  it('400 bad-request on a missing items array, a non-integer id, or an unknown state', …);
  it('refuses "unknown" as a settle target — a caller cannot ask for the we-do-not-know bucket', …);
  it('leaves an ABANDONED run\'s items exactly where they were: 3/7 stays 3/7', …);
});

describe('items.ts is a decision, not an adapter', () => {
  it('imports neither ./db.js nor node:sqlite, and never names `coord.db`', …);   // D-B4-16
});
```

- [ ] **Step 2: Run it and watch it fail**
Run: `cd server && ./node_modules/.bin/vitest run test/coord-items.test.ts` (`timeout: 600000`) → FAIL, 404s.

- [ ] **Step 3: Add the two refusal codes** to `RunRefuseCode` **and** `RUN_REFUSE_CODE_MAP` (both, or the compile fails — that is the point of the map, `shared/api.ts:1877-1889`). Correct the docstring's "Ten codes exist below today; the next new one would be the eleventh" sentence to twelve/thirteenth.

- [ ] **Step 4: Write `server/src/coord/items.ts`** — validate, map, delegate. **No `tx`, no `coord.db`, no sentinel** (D-B4-16):

```ts
/** L1 (architecture increment 4). No `reply`, no `node:sqlite`, no `tx` —
 *  narrow deps in, typed union out. The all-or-nothing COMMIT belongs to the
 *  ring that owns `DatabaseSync`'s synchrony invariant (`architecture:141-142`),
 *  so this file validates and maps and `CoordStore.settleItems` commits
 *  (D-B4-16) — the same split `dispatchRun`/`CoordStore.dispatchRun` and
 *  `closeRun`/`CoordStore.closeRun` already draw, reached here for the third
 *  time rather than reasoned out afresh.
 *
 *  It performs no fleet act at all — the ledger is a database fact, and the
 *  RE-MEASUREMENT that authorises this write already happened, at
 *  `POST /api/runs/:id/advance` (or `/close`), before the coordinator called
 *  here. That ordering is spec §3.2's whole argument and it is not restated
 *  as a second check here: a per-item done fingerprint is an explicit
 *  non-goal (spec §5). */
export function settleItems(deps: SettleItemsDeps, id: number, body: unknown): SettleItemsOutcome {
  const coord = deps.coord;
  if (!coord.run(id)) return { ok: false, kind: 'unknown-run' };

  const b = (body ?? {}) as { items?: unknown };
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > WORK_ITEM_MAX) {
    return { ok: false, kind: 'bad-request' };
  }
  const parsed: SettleItem[] = [];
  for (const raw of b.items) {
    const e = (raw ?? {}) as { id?: unknown; state?: unknown; claimedBy?: unknown };
    // `isWorkItemState` accepts `'unknown'` — the READ-side degradation member.
    // A WRITER may not name it, exactly as `isSendableMailKind` refuses it at
    // the mail ingress (`shared/api.ts:1781-1785`).
    if (typeof e.id !== 'number' || !Number.isInteger(e.id) ||
        !isWorkItemState(e.state) || e.state === 'unknown' ||
        !(e.claimedBy === undefined || e.claimedBy === null || typeof e.claimedBy === 'string')) {
      return { ok: false, kind: 'bad-request' };
    }
    parsed.push({ id: e.id, state: e.state, claimedBy: (e.claimedBy as string | null | undefined) ?? null });
  }

  const res = coord.settleItems(id, parsed);
  if (res.ok) return { ok: true, id, items: res.items };
  return res.why === 'unknown-item'
    ? { ok: false, kind: 'refused', code: 'unknown-item', itemId: res.itemId }
    : { ok: false, kind: 'refused', code: 'item-terminal', itemId: res.itemId, state: res.state };
}
```

- [ ] **Step 5: Wire the route** in `coord/routes.ts`, beside `/advance`, as a union→status map with the same `_exhaustive: never` totality guard the two existing maps carry (`routes.ts:118-121`, `:141-143`):

```ts
function sendSettleItemsOutcome(reply: FastifyReply, r: SettleItemsOutcome) {
  if (r.ok) return reply.code(200).send({ ok: true, id: r.id, items: r.items });
  switch (r.kind) {
    case 'unknown-run': return reply.code(404).send({ ok: false, error: 'unknown-run' });
    case 'bad-request': return reply.code(400).send({ ok: false, error: 'bad-request' });
    case 'refused':
      return reply.code(r.code === 'unknown-item' ? 404 : 409)
        .send({ ok: false, refused: r.code, itemId: r.itemId, ...(r.state ? { state: r.state } : {}) });
    default: { const _exhaustive: never = r; return reply.code(500).send({ ok: false, error: 'internal' }); }
  }
}

app.post('/api/runs/:id/items', async (req, reply) => {
  if (!deps.coord) return notConfigured(reply);
  if (!requireMailToken(req, reply, 'POST /api/runs/:id/items')) return;
  const coord = deps.coord;
  const { id: idParam } = req.params as { id: string };
  const id = Number(idParam);
  if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });
  const outcome = await coordMutex.run(async () => settleItems({ coord }, id, req.body));
  return sendSettleItemsOutcome(reply, outcome);
});
```

- [ ] **Step 6: Run the gates**
Run: `cd server && ./node_modules/.bin/vitest run test/coord-items.test.ts test/run-routes.test.ts test/mail-routes.test.ts test/coord-store.test.ts` (`timeout: 600000`) → PASS. `mail-routes.test.ts`'s totality scanner must see both new codes emitted inside `server/src/coord`.

- [ ] **Step 7: Commit**
```bash
git add shared/api.ts server/src/coord/items.ts server/src/coord/routes.ts server/test/coord-items.test.ts
git commit -m "feat(server): POST /api/runs/:id/items — the ledger settles all-or-nothing, after the server re-measured"
```

---

### Task 4: the tally stops lying at zero, and the skill learns to declare items

Spec §3.3 and §3.1's last paragraph. `total === 0` renders an em dash, not `0/0` — the `summarize()` rule ("drop zero-count clauses rather than print `0 X`", `MailStrip.tsx:32-41`) applied to the one place it was not.

**Files:**
- Modify: `pwa/src/fleet/runWords.ts`, `pwa/src/screens/RunsScreen.tsx` (`:97`)
- Modify: `pwa/test/runs-screen.test.tsx`
- Modify: `ccd/coordinator-skill/SKILL.md`, `ccd/coordinator-skill/references/wave-lifecycle.md`
- Modify: `server/test/coordinator-skill.test.ts`

**Interfaces:**
```ts
export const itemTallyLabel = (items: RunItemTally): string =>
  items.total === 0 ? '—' : `${items.done}/${items.total}`;
```

- [ ] **Step 1: Write the failing tests**
`pwa/test/runs-screen.test.tsx`: `it('renders an em dash, never 0/0, for a run that declared no ledger')`, `it('renders 3/7 for a run that declared seven')`, `it('gives the tally no glyph — it is a count, not a state')`.
`server/test/coordinator-skill.test.ts`: `it('documents items on the dispatch body')`, `it('names POST /api/runs/:id/items after the re-measurement, never before')`, `it('still forbids the coordinator from settling on a worker\'s claim alone')`.

- [ ] **Step 2: Run both and watch them fail**
Run: `cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx` and `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts` (`timeout: 600000`) → FAIL.

- [ ] **Step 3: Add `itemTallyLabel`** to `runWords.ts` beside `runItems`, with the docstring naming D-B4-15 and `MailStrip.tsx:32-41`. `RunsScreen.tsx:97` becomes `<span className="run-tally">{itemTallyLabel(items)}</span>`.

- [ ] **Step 4: Update the skill.** SKILL.md's lifecycle step 2 gains: the dispatch body is `{"brief": "...", "items": ["<title>", …]}`, at most 32 titles of at most 200 bytes, and *the brief is prose the server never reads — the items are the machine-readable half of the same wave plan, and they must agree*. Step 4 gains: **after** `POST /api/runs/:id/advance` answers `ok`, `POST /api/runs/:id/items` with `{"items":[{"id":<n>,"state":"done"}]}`. `wave-lifecycle.md` §2's refusal table gains `bad-request` for a malformed `items`; a new §4 subsection carries `unknown-item` (404) / `item-terminal` (409) with "stop and report — a tally that moved backwards is a lie on the console".

- [ ] **Step 5: Run the gates**
Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/install-coordinator-skill.test.ts` and `cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx test/tap-targets.test.tsx` (`timeout: 600000`) → PASS. `REQUIRED_REFS` (`install-coordinator-skill.sh:51`) is unchanged — no new reference file.

- [ ] **Step 6: Commit**
```bash
git add pwa/src/fleet/runWords.ts pwa/src/screens/RunsScreen.tsx pwa/test/runs-screen.test.tsx ccd/coordinator-skill server/test/coordinator-skill.test.ts
git commit -m "feat: a wave with no declared ledger reads as a dash, and the coordinator learns to declare one"
```

---

### Task 5: wave 1 gates — mutants, scanners, and the handoff commit

- [ ] **Step 1: Extend `server/test/single-definition.test.ts`** — under the existing "Build 7 nouns" block (`:261`):
  - `WORK_ITEM_TITLE_MAX`/`WORK_ITEM_MAX` are defined exactly once, in `shared/`;
  - the terminal trio is spelled once: `TERMINAL_ITEM_STATES` is the only place under the four roots where `'done'`, `'failed'` and `'abandoned'` appear as one adjacent list, and no source file contains a hand-written `('done','failed','abandoned')` SQL literal (the shipped one is built by `join`, so the scanner sees no literal at all);
  - **the ring guard** (D-B4-16): every file under `server/src/coord/` except `store.ts`, `rundefs.ts` and `routes.ts` imports neither `./db.js` nor `node:sqlite`, and none of them contains the token `.db` on a `coord`/`store` receiver. Scanner-coverage pin: the walk must visit ≥ 6 files, or a moved directory silently deletes the guard (`architecture:104-105`).

- [ ] **Step 2: Mutation sweep the wave's diff.** One literal mutant per added construct, full server suite per mutant, sha256-verified restore between. The table this wave must produce, each row naming the test that kills it:

| construct | mutant | killed by |
|---|---|---|
| `WORK_ITEM_MAX` bound | `>` → `>=` | run-routes "refuses past WORK_ITEM_MAX" |
| byte-vs-char title cap | `Buffer.byteLength` → `.length` | run-routes "over the cap, measured in utf-8" (a multi-byte fixture) |
| items after the transition | move the INSERT loop above `advanceInner` | run-routes "leaves NO rows behind when the transition is refused" |
| one dispatch transaction | split `dispatchRun` back into three `tx`s | run-routes "no rows behind when the hold fails" |
| terminality `WHERE` | delete `AND state NOT IN (…)` | coord-store "refuses to move a settled item" (a DIRECT `setWorkItemState` call — `settleItems` refuses earlier and cannot discriminate this) |
| terminality ordering | UPDATE first, then check | coord-store "leaves a refused row exactly as it was" |
| run scoping | drop `AND runId = ?` from both statements | coord-store "another run's item is unknown-item" + coord-items "404 for an item of a DIFFERENT run" |
| batch all-or-nothing | delete the pre-pass; write straight through | coord-store "settles NOTHING when one id in the batch is unknown" + coord-items "settles NOTHING when one id is bad" |
| pre-pass carry-forward | delete `effective.set(...)` | coord-store "refuses a body naming the SAME id twice" |
| pre-pass agrees with the `WHERE` | add `'claimed'` to the pre-pass's terminal test | coord-store "settles a CLAIMED item" |
| writer may not name `unknown` | delete `&& e.state !== 'unknown'` | coord-items "refuses unknown as a settle target" |

- [ ] **Step 3: Full suites, foreground**
Run: `cd server && ./node_modules/.bin/vitest run` then `cd pwa && ./node_modules/.bin/vitest run` (`timeout: 600000`). Report REAL printed counts.

- [ ] **Step 4: The handoff commit.** Squash nothing; the wave's last commit IS the handoff. Its message names what a reviewer must read first (`coord/items.ts`, `store.ts`'s three new methods) and what did NOT change (`RUN_TRANSITIONS`, the mail bus, the brief's opacity). Record `git rev-parse HEAD` — the wave-done mail's `handoffCommit` must equal it and must equal `branchTip`.

- [ ] **Step 5: Mail wave-done** with the fingerprint, then stop. Wave 1's own tally reads `—` (spec §3.4) — that is not a defect.

---

# WAVE 2 — Fleet Mutation + Coordination: the run-control substrate

### Task 6: `ccd coord-pause --state on|off` — the marker gets a writer on the box

Spec §4.2. The server may write only `~/.cc-clips` on the fleet host (`agent/src/whitelist.ts:79-80`) and `FleetIO` has no unlink at all, so this **cannot be built server-side**. The precedent is exact: `ws-hold`/`ws-release` were granted for the same reason and with the same argument (`agent/src/whitelist.ts:329-338`).

**Files:**
- Modify: `ccd/ccd` (`cmd_ws_release` is the shape to copy; `cmd_caps` list; the dispatch `case`; the usage line)
- Create: `server/test/ccd-coord-pause.test.ts`

**Interfaces:** `ccd coord-pause --state on|off` → stdout `paused` | `running`, exit 0; any doubt → `die`.

- [ ] **Step 1: Write the failing test** — `server/test/ccd-coord-pause.test.ts`, against a fixture HOME (`ccdWsHelpers.ts`), never the live one:

```ts
it('creates $REG/coordinator-paused with --state on, and says paused', …);
it('is idempotent: twice on leaves one marker and one answer', …);
it('removes it with --state off, and says running', …);
it('is idempotent off: off with no marker still says running, exit 0', …);
it('refuses a missing/extra argument and a state that is not on|off', …);
it('refuses LOUDLY when the marker cannot be written — never a false success', …);   // chmod 500 $REG
it('refuses LOUDLY when the marker cannot be removed — it is STILL paused', …);
it('appears in ccd caps', …);
it('touches nothing else in $REG', …);
```

- [ ] **Step 2: Run it and watch it fail**
Run: `cd server && ./node_modules/.bin/vitest run test/ccd-coord-pause.test.ts` (`timeout: 600000`) → FAIL.

- [ ] **Step 3: Write `cmd_coord_pause`** beside `cmd_ws_release`:

```bash
cmd_coord_pause() {   # ccd coord-pause --state on|off — raise or lower the
  # coordinator's pause marker. `$REG/coordinator-paused` is read by the
  # server's dispatch path (`coord/dispatch.ts`) and by nothing else, and it
  # is the ONE file that stops a program mid-flight. It had no writer in this
  # tree at all: the operator was expected to `touch`/`rm` it by hand over
  # ssh, which is not a control a phone can reach.
  #
  # Non-destructive and idempotent, exactly like `ws-hold`/`ws-release`, and
  # granted on the same argument: a registry-file write/unlink that widens
  # nothing that deletes. CHECKED on both arms, for `cmd_ws_hold`'s reason:
  # ccd runs `set -uo pipefail` with NO `-e`, so an unchecked write that
  # failed would fall straight through to the echo and report a pause that is
  # not there — the polarity that matters most on this verb, since the caller
  # then believes the fleet is stopped.
  #
  # The echoed word is for a human reading a journal. NOTHING parses it: the
  # server learns the state by listing $REG, the same way `dispatchRun` always
  # has (`dispatch.ts:106-109`), and for the reason that file's own comment
  # gives about ccd's echoed sentences.
  [[ $# -eq 2 && $1 == --state ]] || die "usage: ccd coord-pause --state on|off"
  local state=$2
  [[ $state == on || $state == off ]] || die "bad state: $state (want on|off)"
  [[ -d "$REG" ]] || die "no registry at $REG"
  local marker="$REG/coordinator-paused"
  if [[ $state == on ]]; then
    touch -- "$marker" || die "could not raise the pause marker — the fleet is NOT paused"
    echo "paused"
  else
    if [[ -e $marker ]]; then
      rm -f -- "$marker" || die "could not clear the pause marker — the fleet is STILL paused"
    fi
    echo "running"
  fi
}
```

Add `coord-pause` to `cmd_caps`'s list (keeping its order), the dispatch arm `coord-pause) shift; cmd_coord_pause "$@" ;;`, and the verb into the `usage:` line.

- [ ] **Step 4: Run the ccd suites** (~90 s)
Run: `cd server && ./node_modules/.bin/vitest run test/ccd-coord-pause.test.ts test/ccd-hold.test.ts test/ccd-workspaces.test.ts` (`timeout: 600000`) → PASS.

- [ ] **Step 5: Commit**
```bash
git add ccd/ccd server/test/ccd-coord-pause.test.ts
git commit -m "feat(ccd): coord-pause — the one file that stops a program gets a writer, and it fails loudly"
```

---

### Task 7: the grant, its enrolment, the argv, and `POST /api/coord/pause`

A two-token grant enforces nothing unless its verb is **enrolled** in `REQUIRED_VERB_FLAG` — `IllegalGrant<P>` only fires for `H extends GatedVerb` (`whitelist.ts:262-272`), `GatedVerb = keyof typeof REQUIRED_VERB_FLAG` (`:231`), and `isExecAllowed` is prefix-matching, so an unenrolled `['coord-pause']` is a lawful grant that still admits `['coord-pause','--state','on']`. Spec §4.2 asks for the enrolment in as many words ("two tokens wide, matching `REQUIRED_VERB_FLAG` discipline"); this task does it, and Task 10's mutation row is pointed at the mechanism that then actually earns the kill.

**Files:**
- Modify: `agent/src/whitelist.ts` (`REQUIRED_VERB_FLAG` + its docstring `:210-231`; the `ccd:` list `:310-343`; `auditExecWhitelist`'s required-flag message `:531-540`; `LAWFUL_EXEC_WHITELIST` `:346` is the proof line)
- Create: `agent/test/types/bypasses/g9-coord-pause-without-state.ts`
- Modify: `agent/test/whitelist-structural.test.ts` (`EXPECTED` `:81-95`; the runtime-audit describe `:278-295`)
- Modify: `server/src/ccdargv.ts` (`CCD_ARGV` `:56-89`)
- Modify: `server/src/coord/routes.ts`
- Create: `server/test/coord-pause-route.test.ts`; modify `server/test/whitelist-subset.test.ts` (`SAMPLES`)

**Interfaces:**
```ts
// agent/src/whitelist.ts
export const REQUIRED_VERB_FLAG = {
  'ws-reap': '--expect', 'ws-rename': '--session', 'coord-pause': '--state',
} as const;
// inside EXEC_WHITELIST.ccd
['coord-pause', '--state'],   // two tokens wide, AND enrolled above — the flag is
                              // what makes the grant two tokens; the enrolment is
                              // what makes losing it a compile error and a boot refusal

// server/src/ccdargv.ts
coordPause: (state: 'on' | 'off') => argv(['coord-pause', '--state', state]),

// POST /api/coord/pause  {paused: boolean}
//   200 {ok:true, requested:boolean}   501 {ok:false,error:'unsupported'}
//   502 {ok:false, stderr}             400 {ok:false,error:'bad-request'}
```

- [ ] **Step 1: Write the failing tests.**

`server/test/coord-pause-route.test.ts`:
```ts
it('runs coord-pause --state on for {paused:true}, and off for false', …);
it('mints the argv AT THE CALL SITE — never table-looked-up (cross-cutting rule d)', …);
it('answers 501 unsupported when the fleet ccd does not advertise the verb', …);
it('answers 502 with ccd\'s stderr when the verb fails on the box', …);
it('answers 400 on a body that is not {paused:boolean}', …);
it('answers WITHOUT the box token — deliberately (spec §4.1), and says so at the call site', …);
it('answers even with NO coordination database: a pause is a fleet-host file, not a run', …);
it('is the ONLY route in coord/routes.ts that skips requireMailToken', …);   // the source scanner, D-B4-9
```

`agent/test/whitelist-structural.test.ts`, in the runtime-audit describe (copy `:278-294`'s `ws-reap` cases exactly):
```ts
it('throws on a coord-pause grant with no --state — the flag is the whole grant', () => {
  expect(() => auditExecWhitelist(withCcd([['coord-pause']]))).toThrow(/only grantable with '--state'/);
  expect(() => auditExecWhitelist(withCcd([['coord-pause', '--session']]))).toThrow(/only grantable with '--state'/);
  expect(() => auditExecWhitelist(withCcd([['coord-pause', '--state']]))).not.toThrow();
});
```
and add to `EXPECTED`:
```ts
'g9-coord-pause-without-state.ts': {
  what: 'the plan-review mutant: a two-token grant whose verb was never enrolled',
  codes: ['TS2322'],
},
```
(the file's own "an expectation for every fixture and a fixture for every expectation" case, `:105-109`, makes the pairing mandatory.)

- [ ] **Step 2: Run them and watch them fail**
Run: `cd server && ./node_modules/.bin/vitest run test/coord-pause-route.test.ts` and `cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts` (`timeout: 600000`) → FAIL.

- [ ] **Step 3: Enrol the verb and add the grant.**

`REQUIRED_VERB_FLAG` gains its **third** entry, and the first one that is not about a destructive act:

```ts
/** … existing docstring …
 *
 *  `coord-pause` is the third entry and the first NON-destructive one, so the
 *  table's own reasoning is widened rather than stretched: the flag is not a
 *  confirmation token here, it is the whole argument surface. A one-token
 *  `['coord-pause']` grant would permit `ccd coord-pause <anything…>` — every
 *  positional form the verb might ever grow — for a route the PWA reaches with
 *  NO token of any kind (D-B4-9). Enrolment is what makes dropping `--state`
 *  a compile error on `LAWFUL_EXEC_WHITELIST` and a boot refusal, instead of a
 *  green diff: `isExecAllowed` is prefix-matching ("tokens after the prefix are
 *  unconstrained"), so no subset test can tell the two grants apart. */
export const REQUIRED_VERB_FLAG = {
  'ws-reap': '--expect', 'ws-rename': '--session', 'coord-pause': '--state',
} as const;
```

Add the grant to `EXEC_WHITELIST.ccd`, after `['ws-release','--session']`, with the reason written beside the `ws-hold`/`ws-release` pair's own paragraph: a registry-file write/unlink, non-destructive, granting it widens nothing that deletes — and the one sentence that pair does not have, that this verb is enrolled above.

Correct the audit's own message, which is now read by a non-destructive verb (`:534-539`) — the docstring-claim rule applies to what the process prints, and no test pins the tail (`whitelist-structural.test.ts` matches `/only grantable with '<flag>'/`, which survives):

```ts
          `EXEC_WHITELIST['${key}'] grants '${tokens.join(' ')}', but '${verb!}' is only ` +
          `grantable with '${required}' immediately after it. Dropping the flag widens the ` +
          `grant to the verb's whole positional argv surface — for ws-reap that is an ` +
          `UNCONFIRMED destructive call; for every gated verb it is an argv surface nobody declared.`,
```

- [ ] **Step 4: Write the bypass fixture** `agent/test/types/bypasses/g9-coord-pause-without-state.ts`, copying `g5-ws-reap-without-expect.ts` **including its `as const satisfies ExecWhitelist` form** — the "every whitelist literal in the fixtures uses the SHIPPED construct" scan (`whitelist-structural.test.ts:117-146`) fails an annotation-form literal.

- [ ] **Step 5: Add `CCD_ARGV.coordPause`** (and its `SAMPLES` entry in `server/test/whitelist-subset.test.ts` — that file's `Object.keys` comparison is exhaustive in both directions), then the route:

```ts
  /**
   * `POST /api/coord/pause` — the OPERATOR's door, and the ONE route in this
   * file that is deliberately NOT behind `requireMailToken` (D-B4-9).
   *
   * The box token authenticates the FLEET HOST (build7:136-143) and the
   * coordinator holds it by design. `$REG/coordinator-paused` exists precisely
   * so the coordinator CANNOT unpause itself — "no verb, no route, no way"
   * (`rundefs.ts:47-52`). A pause route gated by that token would hand the
   * coordinator its own unpause: the same key, both sides of a boundary that
   * only means anything because the two callers are different. So this rides
   * the PWA's existing unauthenticated surface, the same perimeter
   * `hold`/`release`/`archive`/`reap`/`prompt`/`ask` have always ridden
   * (`pwa/src/lib/api.ts` sends no token of any kind).
   *
   * Honesty clause, in the register of Build 7's own spec: on a single-uid box
   * any session can `rm` this marker directly. This route removes no
   * enforcement that ever existed — the skill's contract (clause 4) plus a
   * recorded chokepoint is the boundary, and it is convention with a speed
   * bump, named as exactly that.
   *
   * NO `notConfigured` ARM. Every other route here needs `deps.coord`; a pause
   * is a file on the fleet host and a box with no coordination database can
   * still be paused — answering 501 would be a lie about what the act needs.
   */
  app.post('/api/coord/pause', async (req, reply) => {
    const body = (req.body ?? {}) as { paused?: unknown };
    if (typeof body.paused !== 'boolean') return reply.code(400).send({ ok: false, error: 'bad-request' });
    const argv = CCD_ARGV.coordPause(body.paused ? 'on' : 'off');
    if (!verbSupported(deps.fleetState, argv)) return reply.code(501).send({ ok: false, error: 'unsupported' });
    const res = await deps.runCcd(argv);
    if (!res.ok) return reply.code(502).send({ ok: false, stderr: res.stderr });
    // `requested`, never `paused`: this route ran a verb, it did not READ the
    // marker. The authoritative answer is the `{type:'coord'}` frame (Task 8),
    // and the toggle settles on that — never on this response (spec §4.2).
    return reply.code(200).send({ ok: true, requested: body.paused });
  });
```

- [ ] **Step 6: Run the gates this task moves**
Run: `cd server && ./node_modules/.bin/vitest run test/coord-pause-route.test.ts test/verb-gate.test.ts test/whitelist-subset.test.ts test/ccdargv-brand.test.ts test/run-routes.test.ts test/mail-routes.test.ts` and `cd agent && ./node_modules/.bin/vitest run` (`timeout: 600000`) → PASS. `whitelist-subset.test.ts` enumerates `CCD_ARGV` against the agent's grants in both directions and must be green with the new pair on both sides; the agent suite must be green **with the third `REQUIRED_VERB_FLAG` entry live**, which is also the proof that `auditExecWhitelist()` still boots.

- [ ] **Step 7: Commit**
```bash
git add agent/src/whitelist.ts agent/test/types/bypasses/g9-coord-pause-without-state.ts agent/test/whitelist-structural.test.ts server/src/ccdargv.ts server/src/coord/routes.ts server/test/coord-pause-route.test.ts server/test/whitelist-subset.test.ts
git commit -m "feat: the pause marker reaches the phone — one verb, one enrolled grant, and the one route the box token is the wrong key for"
```

---

### Task 8: `MarkerState` and the `{type:'coord'}` frame — off the tick's own listing, on both arms

Spec §4.2, "Reading the state back". `unmeasurable` is not decoration: `dispatchRun` treats an unlistable registry as a pause it cannot rule out and **fails shut** (`dispatch.ts:106-109`). The wire must be able to say the same thing — which means the emitter must run on the tick that fails shut (D-B4-10), and the tick must hand it the listing it already took.

**Files:**
- Modify: `shared/api.ts` (`FleetMsg` `:1412-1419`)
- Modify: `server/src/registry.ts` (`RegistryRead` `:356`, `readRegistryMeasured` `:358-410`)
- Modify: `server/test/registry.test.ts` (`:416-440`)
- Modify: `server/src/watch.ts` (`tick()`'s read `:496-523`; `emitRuns` `:781-802` is the shape to copy), `server/src/bus.ts`, `server/src/server.ts` (`:249-302`)
- Modify: `server/test/fleetws.test.ts`

**Interfaces:**
```ts
// shared/api.ts
export type MarkerState = 'clear' | 'set' | 'unmeasurable';
const MARKER_STATES: readonly MarkerState[] = ['clear', 'set', 'unmeasurable'];
export function isMarkerState(v: unknown): v is MarkerState;
export interface CoordStatus { pause: MarkerState; mail: MarkerState }
// FleetMsg += { type: 'coord'; coord: CoordStatus }

// server/src/registry.ts — ADDITIVE on ONE arm (D-B4-10)
export type RegistryRead =
  | { listed: true; records: SessionRecord[]; names: readonly string[] }
  | { listed: false };

// server/src/watch.ts
private emitCoord(names: readonly string[] | null): void;
currentCoord(): CoordStatus | null;   // null = this process has never measured
```

- [ ] **Step 1: Write the failing tests.**

`server/test/registry.test.ts`:
```ts
it('carries the RAW listing it derived the records from, so a caller needing a non-session ' +
   'fact out of the same directory shares the one readdir', …);
it('carries the FIRST listing even when the reap-race re-listing ran', …);   // the second read is not the clock
```

`server/test/fleetws.test.ts`:
```ts
it('sends coord after hello/fleet/runs on connect, when it has ever measured', …);
it('sends NOTHING for coord before the first tick — never a fabricated "clear"', …);
it('re-emits only on CHANGE, byte-equality guarded like runs', …);
it('reports unmeasurable for BOTH markers when the registry cannot be listed', …);   // drives a WHOLE tick
it('emits coord on the tick that FAILS SHUT — before the early return, not after it', …);
it('reports set for coordinator-paused and clear for mail-disabled independently', …);
it('an old client still shrugs: an unknown frame type is dropped silently', …);
it('does not bump FLEET_PROTO', …);
```

The fourth and fifth cases are the ones the first draft could not have passed: they must drive `FleetWatcher.tick()` with an `io.readdir` that answers `null`, and assert a `coord` frame arrives on that same tick.

- [ ] **Step 2: Run them and watch them fail**
Run: `cd server && ./node_modules/.bin/vitest run test/fleetws.test.ts test/registry.test.ts` (`timeout: 600000`) → FAIL.

- [ ] **Step 3: Add the wire types**, with the docstring stating: one `MarkerState` covers both markers because they are one concept read one way, from the single `readdir` the fleet lane already performs; `unmeasurable` exists because "not knowing is not `[]`" and because the phone must not render "running" for a state the server would refuse to dispatch in.

- [ ] **Step 4: Widen `RegistryRead`** (D-B4-10) — one field, one arm:

```ts
/** … existing docstring …
 *
 *  `names` (Build 4, D-B4-10) is the RAW listing this read derived its records
 *  from, carried rather than re-read. It exists for the one caller that needs a
 *  NON-session fact out of the same directory — `watch.ts`'s `emitCoord`, which
 *  reports `$REG/coordinator-paused` and `$REG/mail-disabled` to the wire. A
 *  second `readdir` for that would be a second clock for one fact, and the two
 *  would disagree on exactly the ticks that matter. It is the FIRST listing,
 *  deliberately: the re-listing below exists to resolve a per-row reap race,
 *  runs on some calls only, and hanging the markers' cadence on it would make
 *  the banner's clock depend on whether an unrelated session was mid-reap. */
export type RegistryRead =
  | { listed: true; records: SessionRecord[]; names: readonly string[] }
  | { listed: false };
```

Both `return { listed: true, … }` sites (`registry.ts:406`, `:409`) carry `names`. Nothing else changes: the field is additive on one arm, and `sweepPr` (`watch.ts:1017`), `sweepNames` (`:1075`), `sweepMail` (`:1403`) and `readRegistry` (`:412`) read only `.listed`/`.records`. The `{listed:false}` arm is untouched, and `registry.test.ts:433-437`'s `toEqual({listed:false})` stays green.

- [ ] **Step 5: Emit from that listing, on BOTH arms, before the early return.** In `tick()`, immediately after the read at `watch.ts:496` and **above** `if (!registryRead.listed)` (`:497`):

```ts
      const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);
      // BEFORE the fail-shut return below, and on BOTH arms (D-B4-10). An
      // unlistable registry is not "nothing is set": it is the exact state
      // `dispatchRun` FAILS SHUT on (`dispatch.ts:106-109`), so it must reach
      // the wire as `unmeasurable` on the same tick it happens. Placed beside
      // `emitRuns()` (`:757`) instead, this would be 236 lines below a
      // `return` — the banner would sit frozen on its last value while the
      // server refused every dispatch, which is the precise lie spec §4.2
      // mints `unmeasurable` to prevent.
      this.emitCoord(registryRead.listed ? registryRead.names : null);
      if (!registryRead.listed) {
        …unchanged…
```

and the emitter itself, beside `emitRuns`:

```ts
  /** The `{type:'coord'}` frame (spec §4.2). Derived from the SAME registry
   *  listing this tick already performed — carried out of `readRegistryMeasured`
   *  on `RegistryRead.names` rather than taken again (D-B4-10).
   *
   *  `null` names is an UNLISTABLE directory, not an empty one, and rides the
   *  wire as `unmeasurable`.
   *
   *  Byte-equality guarded exactly like `emitRuns` above. No `try`/`catch`:
   *  unlike `emitRuns` this touches no `node:sqlite` and no I/O — it is an
   *  array scan, a `JSON.stringify` and a `bus.emit`, and the bus's own
   *  listeners are the two socket writers `emitRuns` already trusts. */
  private emitCoord(names: readonly string[] | null): void {
    const status: CoordStatus = names === null
      ? { pause: 'unmeasurable', mail: 'unmeasurable' }
      : { pause: names.includes(COORDINATOR_PAUSE_MARKER) ? 'set' : 'clear',
          mail:  names.includes(MAIL_DISABLED_MARKER) ? 'set' : 'clear' };
    const json = JSON.stringify(status);
    if (json === this.lastCoordJson) return;
    this.lastCoordJson = json;
    this.coord = status;
    this.bus.emit('coord', status);
  }
```

with `private coord: CoordStatus | null = null;` and `private lastCoordJson: string | null = null;` beside `lastRunsJson` (`:372`), and `currentCoord(): CoordStatus | null { return this.coord; }`.

**The two constants, named exactly.** `COORDINATOR_PAUSE_MARKER` is imported from `./coord/rundefs.js` — it has exactly one definition in the tree (`rundefs.ts:52`) and Task 10 pins that. `MAIL_DISABLED_MARKER` is the **module-local** one at `watch.ts:184`, which `sweepMail` already uses (`:1382`): importing the `rundefs.ts` copy as well would be a redeclaration in one scope (TS2451), and `rundefs.ts:33-44` explains on purpose why that second literal exists. `watch.ts` already imports values from `./coord/store.js` (`:22`), so the new `./coord/rundefs.js` import adds no module-graph weight class.

- [ ] **Step 6: Fan it out.** `Bus` gains the three `'coord'` overloads (`bus.ts:32`, `:40`, `:48` are the `runs` shapes to copy). `/ws/fleet` adds `onCoord`, subscribes, unsubscribes on close, and cold-starts from `watcher?.currentCoord()` — **chained after `runs`** inside the same `.then` (`server.ts:268-293`), preserving the wire order every client and `fleetws.test.ts` rely on: hello, fleet, runs, coord. A `null` current value sends nothing.

- [ ] **Step 7: Run the gates**
Run: `cd server && ./node_modules/.bin/vitest run test/fleetws.test.ts test/registry.test.ts test/bus.test.ts test/fleet-protocol.test.ts test/routes.test.ts test/mail-sweep.test.ts test/name-sweep.test.ts` (`timeout: 600000`) → PASS. The last three are the other `readRegistryMeasured` consumers and must be green **untouched**.

- [ ] **Step 8: Commit**
```bash
git add shared/api.ts server/src/registry.ts server/src/watch.ts server/src/bus.ts server/src/server.ts server/test/registry.test.ts server/test/fleetws.test.ts
git commit -m "feat(server): the pause and kill-switch markers reach the wire off the tick's own listing, and an unlistable registry says so on the tick it happens"
```

---

### Task 9: `POST /api/runs/:id/abandon` — a wedged run can be let go

Spec §4.3. It calls the **same L1 decision function** `closeRun` — architecture increment 4's "deciding split from acting" is not duplicated for a second caller. Per D-B4-17 the abandon is one contiguous arm inside that function, entered before any of the ordinary close's own body validation.

**Files:**
- Modify: `server/src/coord/close.ts`, `server/src/coord/store.ts` (`closeRun` `:305-334`), `server/src/coord/routes.ts`
- Create: `server/test/coord-abandon.test.ts`

**Interfaces:**
```ts
export interface CloseRunBody {
  intent?: unknown;              // 'abandon' | absent
  fingerprint?: { branchTip?: unknown; prNumber?: unknown; prPhase?: unknown; handoffCommit?: unknown };
  final?: unknown; state?: unknown; archive?: unknown;
}
export async function closeRun(
  deps: CloseRunDeps, id: number, body: unknown,
  causedBy: 'coordinator' | 'operator',        // D-B4-3/6 — no default
): Promise<CloseOutcome>;

// CoordStore
closeRun(input: { …; viaClosing: boolean }): AdvanceResult;   // D-B4-8
```

- [ ] **Step 1: Write the failing test** — `server/test/coord-abandon.test.ts`, one case per row of the spec's wedged-shape table plus the negative pins:

```ts
describe('POST /api/runs/:id/abandon', () => {
  it('planned with NO session: no fleet act at all, planned → failed', …);
  it('planned WITH a session (a wave≥2 reclaim, D-45): ws-release, then planned → failed', …);
  it('dispatched/working/awaiting-review/merging: ws-release, then → closing → failed', …);
  it('done or failed: 409 bad-transition, carrying `from` so the phone can say "already closed"', …);
  it('404 unknown-run', …);
  it('501 when the fleet ccd does not support ws-release', …);
  it('502 with stderr, leaving the run RETRYABLE — the fleet act stays ahead of the commit (D-48)', …);
  it('records causedBy=operator in run_events, never coordinator', …);
  it('writes handoffCommit null', …);
  it('cancels the run\'s own outstanding deliveries and retires the program when it was the last run', …);

  // negative pins (spec §6)
  it('CANNOT reach ws-archive: the route never reads req.body, so archive:true is not a field', …);
  it('never calls verifyDone — the five done-authority codes are unreachable here', …);
  it('never reads .prhistory — prhistory-unreadable is unreachable here', …);
  it('never answers not-dispatched on this path', …);
  it('never answers bad-request for a MISSING fingerprint — that block is not on this path', …);
});

describe('closeRun\'s abandon arm, called directly', () => {
  it('accepts the bare {intent:"abandon"} body and answers ok — no fingerprint, no final', …);
  it('refuses bad-request for {intent:"abandon", archive:true} — a mixed shape is not a shape', …);
  it('refuses bad-request for {intent:"abandon", fingerprint:{…}} likewise', …);
  it('still demands the full fingerprint on the ORDINARY close path', …);
  it('still answers not-dispatched on the ORDINARY path for a run with no session', …);
});
```

- [ ] **Step 2: Run it and watch it fail**
Run: `cd server && ./node_modules/.bin/vitest run test/coord-abandon.test.ts` (`timeout: 600000`) → FAIL.

- [ ] **Step 3: Teach `CoordStore.closeRun` the direct edge** (D-B4-8) — `store.ts:310-311`:

```ts
      // `viaClosing: false` is the ABANDON of a `planned` run (D-B4-8).
      // `RUN_TRANSITIONS.planned` has a `failed` edge and deliberately no
      // `closing` one (`shared/api.ts:1720-1739`), and that table is NOT
      // edited here — clients read it as a refusal vocabulary. So the hop is
      // skipped rather than the table widened; every other statement in this
      // transaction (the handoff write, the delivery cancellation, the
      // program-retirement check) is unchanged and still one commit.
      if (input.viaClosing) {
        const closingAdv = this.advanceInner(input.runId, 'closing', input.causedBy);
        if (!closingAdv.ok) return closingAdv;
      }
```

Both existing call sites pass `viaClosing` explicitly — no default (the D-B4-6 argument, applied to the second parameter this build adds).

- [ ] **Step 4: Add the abandon arm to `closeRun`** (`close.ts`). **Order matters and is the whole point** (D-46/D-48/D-B4-17). Replace `close.ts:60-63`'s head with the following, and **delete the now-duplicate `const b` at `:85`** — the ordinary path uses the hoisted one:

```ts
export async function closeRun(deps: CloseRunDeps, id: number, body: unknown,
                               causedBy: 'coordinator' | 'operator'): Promise<CloseOutcome> {
  const coord = deps.coord;
  const run = coord.run(id);
  if (!run) return { ok: false, kind: 'unknown-run' };

  // The body is read HERE, above every precondition, because the abandon arm
  // below branches on it — and the ordinary path's own validation (:85-102 as
  // shipped) is left exactly where it was, one `const b` shorter.
  const b = (body ?? {}) as CloseRunBody;
  const abandon = b.intent === 'abandon';
  if (abandon && (b.fingerprint !== undefined || b.final !== undefined ||
                  b.state !== undefined || b.archive !== undefined)) {
    // A mixed shape is not a shape. An abandon asserts nothing about a branch,
    // a PR or a wave boundary, so a body carrying those fields is a caller
    // that has confused two acts — answered as `bad-request` rather than
    // silently ignoring half of it.
    return { ok: false, kind: 'bad-request' };
  }

  if (abandon) {
    /**
     * THE OPERATOR ABANDON, as ONE contiguous arm (D-B4-17). It returns; it
     * never falls through into the ordinary close below.
     *
     * What is skipped is skipped BY CONSTRUCTION, not by four flags threaded
     * through a hundred lines:
     *   - the `not-dispatched` refusal (`:64-68`): a `planned` run with no
     *     session is precisely the `ambiguous-dispatch` wedge this route exists
     *     for, so there is nothing to refuse;
     *   - the fingerprint validation and its derivations (`:85-102`): an
     *     abandon carries no claim, so `handoffCommit`/`final`/`state`/`archive`
     *     are `null`/`false`/`'failed'`/`false` here and are not read from a
     *     body at all (D-B4-1);
     *   - `verifyDone` (step 1): D-49's own reasoning, reached from a second
     *     door — there is no done-claim to re-measure;
     *   - the `.prhistory` fold (step 2, D-B4-2): an unreadable ledger must not
     *     disable the control that exists for a broken box;
     *   - `wsArchive` (step 3): a release destroys nothing and this arm has no
     *     archive branch to reach (D-B4-7 closes the other half at the route).
     * Each of those is pinned by a negative test in `coord-abandon.test.ts`,
     * and each is true because the call is absent, not because a guard skipped
     * it.
     */
    const target: RunState = run.state === 'planned' ? 'failed' : 'closing';
    if (!RUN_TRANSITIONS[run.state].includes(target)) {
      return { ok: false, kind: 'bad-transition', from: run.state, to: target };
    }
    // The fleet act, AHEAD of the commit (D-48), and only when there is
    // something to release: a `planned` run that never dispatched holds no
    // workspace. Always `wsRelease`, never `wsArchive`.
    if (run.sessionId !== null) {
      const argv = CCD_ARGV.wsRelease(run.sessionId);
      if (!verbSupported(deps.fleetState, argv)) return { ok: false, kind: 'unsupported' };
      const res = await deps.runCcd(argv);
      if (!res.ok) return { ok: false, kind: 'fleetFailed', stderr: res.stderr };
    }
    const closed = coord.closeRun({
      runId: id, finalState: 'failed', causedBy, handoffCommit: null,
      program: run.program, viaClosing: target === 'closing',
    });
    if (!closed.ok) return { ok: false, kind: 'advanceFailed', adv: closed };
    return { ok: true, id, state: 'failed' };
  }

  if (run.sessionId === null) {
    …unchanged `not-dispatched` refusal (`:64-68`)…
```

The ordinary tail below is otherwise **untouched**, with exactly two edits: `causedBy` replaces the hardcoded `'coordinator'` in the `coord.closeRun({…})` call (`:172`, D-B4-3), and that same call gains `viaClosing: true` (D-B4-8). `HANDOFF_SHA.test(claim.handoffCommit)` at `:171` is reached only on the ordinary path, where `claim` exists.

- [ ] **Step 5: Wire the route** (ungated, operator surface), constructing its own body (D-B4-7):

```ts
  /**
   * `POST /api/runs/:id/abandon` — the operator's release valve for a wedged
   * run. Same L1 decision as `POST .../close` (`close.ts`'s `closeRun`), same
   * union→status map (`sendCloseOutcome`): increment 4's split is not
   * duplicated for a second caller.
   *
   * THE REQUEST BODY IS NEVER READ (D-B4-7). `{intent:'abandon'}` is
   * constructed here, so `archive` is not a field a caller can send — "the
   * phone can abandon; the phone can never archive" is structural rather than
   * a validation a later edit can loosen. Destruction keeps its existing
   * ceremony (audit → reap, typed `expect`); a release destroys nothing, so
   * the two-tap confirm in the sheet is the whole ceremony here.
   */
  app.post('/api/runs/:id/abandon', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    const { id: idParam } = req.params as { id: string };
    const id = Number(idParam);
    if (!Number.isInteger(id)) return reply.code(400).send({ ok: false, error: 'bad-request' });
    const closeDeps: CloseRunDeps = { coord, io: deps.io, cfg: deps.cfg,
      runCcd: deps.runCcd, fleetState: deps.fleetState };
    const outcome = await coordMutex.run(() => closeRun(closeDeps, id, { intent: 'abandon' }, 'operator'));
    return sendCloseOutcome(reply, outcome);
  });
```

Update the existing close route's call (`routes.ts:757`) to pass `'coordinator'` explicitly, and extend the D-B4-9 gate scanner's exclusion list to name `/api/runs/:id/abandon` too, with its reason.

- [ ] **Step 6: Run the gates**
Run: `cd server && ./node_modules/.bin/vitest run test/coord-abandon.test.ts test/run-routes.test.ts test/coord-decide.test.ts test/coord-store.test.ts test/mail-sweep.test.ts` (`timeout: 600000`) → PASS.

- [ ] **Step 7: Commit**
```bash
git add server/src/coord/close.ts server/src/coord/store.ts server/src/coord/routes.ts server/test/coord-abandon.test.ts
git commit -m "feat(server): an operator can let a wedged run go — no fingerprint, no ledger read, and never an archive"
```

---

### Task 10: wave 2 gates — verb gates, agent-first rollout, the handoff commit

- [ ] **Step 1: Extend `single-definition.test.ts`** — `MarkerState` is defined exactly once; `'coordinator-paused'` appears as a literal in exactly one source file under the four roots (`server/src/coord/rundefs.ts:52`). **`'mail-disabled'` is deliberately NOT asserted**, and the test says why by name: `watch.ts:184` holds a second literal on purpose and `rundefs.ts:33-44` carries the argument for it — the `MAIL_REJECT_CODES`-excludes-`undeliverable` idiom, an exclusion that is written down rather than a scanner quietly narrowed.

- [ ] **Step 2: Mutation sweep**, full server suite per mutant (and the agent suite for the two whitelist rows):

| construct | mutant | killed by |
|---|---|---|
| `coord-pause` enrolment | delete `'coord-pause': '--state'` from `REQUIRED_VERB_FLAG` | whitelist-structural "throws on a coord-pause grant with no --state" (the audit stops firing) **and** its `g9` expectation (`codesFor` returns `[]` where `['TS2322']` is expected) |
| `--state` grant width | `['coord-pause','--state']` → `['coord-pause']` | `auditExecWhitelist()` runs at MODULE LOAD (`whitelist.ts:543`) and now throws for this verb, so `server/test/whitelist-subset.test.ts` — which imports `agent/src/whitelist.js` at its top (`:6-8`) — fails at import, as does the whole agent suite; `g9` pins the same edit as a TS2322 on `LAWFUL_EXEC_WHITELIST`. *(Not `whitelist-subset`'s own assertions: `isExecAllowed` is prefix-matching, so layer 2 stays green on the narrowed grant — the kill is the boot refusal, which is why the enrolment above is a task step and not a comment.)* |
| ccd write check | drop `\|\| die` from the `touch` arm | ccd-coord-pause "refuses LOUDLY when it cannot write" |
| ccd unlink check | drop `\|\| die` from the `rm` arm | ccd-coord-pause "…cannot remove" |
| the carried listing | drop `names` from `RegistryRead`'s `listed:true` arm | typecheck (`watch.ts`'s emit call) + registry "carries the RAW listing" |
| emit before the fail-shut return | move `this.emitCoord(...)` below the `!listed` early return | fleetws "emits coord on the tick that FAILS SHUT" and "reports unmeasurable for BOTH markers" |
| `unmeasurable` | `names === null` → `{pause:'clear'}` | fleetws "reports unmeasurable for BOTH" |
| change-only emit | delete `lastCoordJson` | fleetws "re-emits only on CHANGE" |
| cold start | send a fabricated `clear` when `currentCoord()` is null | fleetws "sends NOTHING before the first tick" |
| abandon arm placement | move the `if (abandon)` block below the `not-dispatched` guard | coord-abandon "planned with NO session" (answers `not-dispatched`) |
| abandon skips the fingerprint block | delete the arm's early `return`, falling through | coord-abandon "never answers bad-request for a MISSING fingerprint" |
| abandon skips verifyDone | call it inside the arm | coord-abandon "never calls verifyDone" |
| abandon skips prhistory | fold it inside the arm | coord-abandon "never reads .prhistory" |
| `causedBy` parameter | reinstate the `'coordinator'` default | coord-abandon "records causedBy=operator" |
| `viaClosing` | force `true` | coord-abandon "planned with no session" (409s) |
| body ignored | read `req.body` through at the route | coord-abandon "cannot reach ws-archive" |

- [ ] **Step 3: Full suites, foreground.** `cd server && ./node_modules/.bin/vitest run`, `cd agent && ./node_modules/.bin/vitest run`, `cd pwa && ./node_modules/.bin/vitest run` (`timeout: 600000`). Real counts. The agent suite is new to this wave's gate list and is there because this wave is the first to touch `agent/src`.

- [ ] **Step 4: The agent-first note, written where it will be read.** The wave-done mail says, in its own words: this wave is **not deployable server-first**. `ccd` + the agent whitelist ship to the fleet host before the server, or `POST /api/coord/pause` answers 502 `forbidden` for every tap while `verbSupported` still says yes (the agent's grant, not `ccd caps`, is what refuses). The deploy itself is the operator's; the mail names the order and stops.

- [ ] **Step 5: The handoff commit**, `handoffCommit === branchTip`. Mail wave-done.

---

# WAVE 3 — PWA: the console's hands

*Consumes wave 2's wire off `main`. Touches no server file.*

### Task 11: the pause banner and its toggle — no optimism, four states

Spec §4.2's client rules. *Frame not yet seen* is a fourth, **client-side** state rendered as **nothing** — never as "not paused".

**Files:**
- Modify: `pwa/src/stores/fleet.ts` (`asFleetMsg` `:104-126`, the state interface, `onMessage` `:225+`)
- Create: `pwa/src/fleet/coordWords.ts`, `pwa/src/fleet/CoordBanner.tsx`
- Modify: `pwa/src/lib/api.ts`, `pwa/src/screens/RunsScreen.tsx`, `pwa/src/fleet/fleet.css`
- Create: `pwa/test/coord-banner.test.tsx`; modify `pwa/test/stores.test.ts`, `pwa/test/fleet-css.test.ts`, `pwa/test/tap-targets.test.tsx`

**Interfaces:**
```ts
// stores/fleet.ts
coord: CoordStatus | null;      // null = no frame has ever arrived
coordFrameSeen: boolean;        // sticky, never reset on reconnect — runsFrameSeen's idiom
// lib/api.ts
coordPause: (paused: boolean) => post('/api/coord/pause', { paused }),
// fleet/coordWords.ts
export const MARKER_WORD: Record<MarkerState, string>;
export const MARKER_GLYPH: Record<MarkerState, string>;
export const markerState = (v: unknown): MarkerState => isMarkerState(v) ? v : 'unmeasurable';
export const COORD_CONFIRM_MS = 15_000;
```

- [ ] **Step 1: Write the failing tests** — `pwa/test/coord-banner.test.tsx`:

```ts
it('renders NOTHING before any coord frame — absence is not "not paused"', …);
it('renders two cues, word and glyph, from parallel tables — never colour alone', …);
it('renders unmeasurable honestly: "the registry could not be read — dispatch would refuse"', …);
it('shows pausing… on tap and does NOT flip the state', …);          // no optimism
it('settles only when the next coord frame confirms', …);
it('renders "unconfirmed — check /runs" when no frame confirms inside COORD_CONFIRM_MS', …);
it('renders the 501 as "the fleet host needs the newer ccd"', …);
it('renders the 502 stderr, not a generic toast', …);
it('lives on /runs and nowhere else', …);                              // a FleetScreen render finds none
it('carries a tap target at var(--tap-min)', …);
it('degrades an unknown MarkerState through markerState, never a blank cell', …);
```

- [ ] **Step 2: Run it and watch it fail** — `cd pwa && ./node_modules/.bin/vitest run test/coord-banner.test.tsx` (`timeout: 600000`) → FAIL.

- [ ] **Step 3: Extend the store.** `asFleetMsg` gains a `coord` arm, shape-validated at the same depth as `fleet`/`runs` (`typeof m.coord === 'object' && m.coord !== null`) — per-member tolerance is the renderer's job, via `markerState`, exactly as `runState`/`runItems` do for runs (`stores/fleet.ts:60-66`). `coordFrameSeen` is sticky for `runsFrameSeen`'s stated reason.

- [ ] **Step 4: Write `coordWords.ts` and `CoordBanner.tsx`.** The banner is `role="status"`. The toggle is **not** optimistic: local `pending: 'pausing' | 'resuming' | null`, cleared by a `useEffect` on the incoming `coord.pause` value, plus a `COORD_CONFIRM_MS` timer whose expiry renders `unconfirmed — check /runs`. The constant's docstring ties 15 s to the 2 s fleet poll plus a generous margin, and says why a silent flip would be worse than an honest "unconfirmed".

- [ ] **Step 5: Mount it on `/runs` only**, above the groups and below the `Reconnecting…` banner. `.coord-*` rules in `fleet.css`, no `--glow`/`animation`/`box-shadow` (a paused fleet is a state, not a living pane), tap floor via `var(--tap-min)`, scraped in `fleet-css.test.ts` and rendered in `tap-targets.test.tsx` — both halves, per that file's own header.

- [ ] **Step 6: Run the gates** — `cd pwa && ./node_modules/.bin/vitest run test/coord-banner.test.tsx test/stores.test.ts test/fleet-css.test.ts test/tap-targets.test.tsx test/runs-screen.test.tsx test/contrast.test.ts` (`timeout: 600000`) → PASS.

- [ ] **Step 7: Commit**
```bash
git add pwa/src/stores/fleet.ts pwa/src/fleet/coordWords.ts pwa/src/fleet/CoordBanner.tsx pwa/src/lib/api.ts pwa/src/screens/RunsScreen.tsx pwa/src/fleet/fleet.css pwa/test/coord-banner.test.tsx pwa/test/stores.test.ts pwa/test/fleet-css.test.ts pwa/test/tap-targets.test.tsx
git commit -m "feat(pwa): the board says whether the fleet is paused, and the toggle never claims a flip it has not seen"
```

---

### Task 12: the abandon sheet — two taps, and never an archive

**Files:**
- Create: `pwa/src/fleet/AbandonSheet.tsx`; modify `RunsScreen.tsx`, `lib/api.ts`, `fleet.css`
- Create: `pwa/test/abandon-sheet.test.tsx`

**Interfaces:**
```ts
abandonRun: (id: number) => post(`/api/runs/${id}/abandon`),
export interface AbandonSheetProps { run: RunSummary | null; onClose: () => void; onDone?: () => void }
export const ABANDON_COPY: Record<'unknown-run' | 'bad-transition' | 'unsupported' | 'fleet-failed' | 'unknown', string>;
```

- [ ] **Step 1: Write the failing test** — `pwa/test/abandon-sheet.test.tsx`:

```ts
it('needs two taps: the row control opens the sheet, the sheet\'s button abandons', …);
it('names the run AND its workspace in the confirm line', …);
it('says a release destroys nothing — the worktree survives, the record stays', …);
it('offers NO archive control anywhere in the sheet', …);            // negative pin
it('renders 409 bad-transition as "this run already closed", using `from`', …);
it('renders 404 as "that run is gone — the board will catch up"', …);
it('renders 501 as "the fleet host needs the newer ccd"', …);
it('renders a 502\'s stderr verbatim and leaves the sheet open to retry', …);
it('the run row never nests a button inside a button', …);            // D-B4-14
it('an inert row (no session) still offers abandon — that is the wedge it exists for', …);
```

- [ ] **Step 2: Run it and watch it fail.** → FAIL.

- [ ] **Step 3: Write the sheet** on `Sheet`, not `QuickConfirm` — it needs per-refusal copy and must stay open on failure, which `QuickConfirm`'s close-on-confirm shape forbids. `ABANDON_COPY` is a total `Record`, its `unknown` member covering a refusal this build has never heard of.

- [ ] **Step 4: Add the row control** as a **sibling** of `.run-open` inside the `<li>` (D-B4-14), `aria-label={`Abandon run ${run.id}`}`, `var(--tap-min)`.

- [ ] **Step 5: Refresh on success** — call the screen's existing `loadCold()` so the run moves into Finished; the live frame's own vanish-diff (`RunsScreen.tsx:208-220`) also fires, and both landing is harmless because they feed separate slices.

- [ ] **Step 6: Run the gates** — `cd pwa && ./node_modules/.bin/vitest run test/abandon-sheet.test.tsx test/runs-screen.test.tsx test/tap-targets.test.tsx test/fleet-css.test.ts test/sheet.test-d.tsx` (`timeout: 600000`) → PASS.

- [ ] **Step 7: Commit**
```bash
git add pwa/src/fleet/AbandonSheet.tsx pwa/src/screens/RunsScreen.tsx pwa/src/lib/api.ts pwa/src/fleet/fleet.css pwa/test/abandon-sheet.test.tsx
git commit -m "feat(pwa): a wedged run can be let go from the phone — two taps, named consequences, and no archive anywhere"
```

---

### Task 13: start a program — composition, not a compound route

Spec §4.4. `POST /api/runs` is the coordinator's own route and demands a live coordinator session id; there is no coordinator to name before one exists. This build does **not** add a compound route that both spawns a session and opens a run.

**Files:**
- Create: `pwa/src/fleet/StartProgramSheet.tsx`; modify `RunsScreen.tsx`, `fleet.css`
- Create: `pwa/test/start-program.test.tsx`

**Interfaces:** none new on `api` — the flow is `api.projects()`, `useProjectedHome()`, `api.createSession({wrapper, project})`, `api.prompt(id, text)`, all existing.

- [ ] **Step 1: Write the failing test** — `pwa/test/start-program.test.tsx`:

```ts
it('collects slug, title and project, and refuses an empty slug', …);
it('names the account it will place into BEFORE the tap (the projection, not a guess)', …);
it('refuses with copy when the projection is null: nothing is placeable', …);   // D-B4-11
it('renders the in-flight state on the session create — the one long call', …);
it('navigates to the new session on success', …);
it('says in one line that the run row arrives later, from the coordinator', …);
it('sends ONE kickoff prompt naming the slug, the ledger path and the skill', …);
it('never calls POST /api/runs', …);                                   // negative pin
it('never claims the ledger exists — it names the path the operator committed', …);
it('warns, and does NOT block, when coord.pause is set', …);
it('renders unknown project as 400 copy and a spawn failure as its stderr', …);
```

- [ ] **Step 2: Run it and watch it fail.** → FAIL.

- [ ] **Step 3: Write the sheet.** The kickoff prompt is one standing message, built from a single template constant so the text has one home:

```ts
/** The one standing kickoff. It names three things and asserts nothing:
 *  the program slug, the ledger path the operator is expected to have
 *  committed, and the skill to run. THE SERVER NEVER VALIDATES THE LEDGER
 *  (`coord/routes.ts`'s open route: "PARSED BY NOTHING") and this sheet must
 *  not pretend to either — naming the path is exactly what that route already
 *  does in its own response, and this stops there. */
export const kickoff = (slug: string, title: string): string =>
  `You are the coordinator for program \`${slug}\` (${title}).\n` +
  `Its ledger is \`docs/superpowers/programs/${slug}.md\`.\n` +
  `Run the ccrc-coordinator skill and open the run for wave 1.`;
```

- [ ] **Step 4: Add the door** on `/runs` — one door, rendered at zero runs too (the design gate `/runs` already holds).

- [ ] **Step 5: Run the gates** — `cd pwa && ./node_modules/.bin/vitest run test/start-program.test.tsx test/runs-screen.test.tsx test/useProjectedHome.test.ts test/tap-targets.test.tsx test/fleet-css.test.ts` (`timeout: 600000`) → PASS.

- [ ] **Step 6: Commit**
```bash
git add pwa/src/fleet/StartProgramSheet.tsx pwa/src/screens/RunsScreen.tsx pwa/src/fleet/fleet.css pwa/test/start-program.test.tsx
git commit -m "feat(pwa): start a program from the phone — three existing routes composed, and the run row arrives on its own"
```

---

### Task 14: wave 3 gates — design gates, tap floor, no-glow, the handoff commit

- [ ] **Step 1: Design gates**, each as a test: one stylesheet block per new surface with self-grounded rules; every new control's tap floor via `var(--tap-min)` proven on a **rendered** element as well as scraped; a no-glow scan over `.coord-*`, `.run-abandon`, `.program-start-*`; `role="group"` never a named landmark that can be empty; the door on `/runs` still renders at zero runs; `contrast.test.ts` green.

- [ ] **Step 2: Mutation sweep** (PWA suite per mutant): delete `coordFrameSeen` (banner renders "running" on silence); make the toggle optimistic; delete the `COORD_CONFIRM_MS` timer; collapse `ABANDON_COPY` to one string; nest the abandon button inside `.run-open`; default `projected === null` to the first account.

- [ ] **Step 3: Full suites, foreground.** Both. Real counts.

- [ ] **Step 4: The handoff commit**, `handoffCommit === branchTip`. Mail wave-done, naming that this wave is deployable last and needs no fleet-host step.

---

# WAVE 4 — Session Conversation: the transcript

*One context, one vertical slice. The only wave that touches `ChatList`/`ToolCard` — the two files three prior specs reserved for exactly this.*

### Task 15: `MAIL_ENVELOPE_FENCE` and `parseMailEnvelope` — one grammar, one definition

**Files:**
- Modify: `shared/api.ts`, `server/src/coord/envelope.ts` (`:84`)
- Create: `server/test/mail-envelope-parse.test.ts`; modify `server/test/single-definition.test.ts`

**Interfaces:**
```ts
export const MAIL_ENVELOPE_FENCE = 'ccrc-mail';
export interface MailEnvelope {
  id: number; fromId: string; toId: string;
  runId: number | null; program: string | null; wave: number | null; waveOf: number | null;
  kind: MailKind; subject: string; artifacts: string[]; body: string;
}
export type MailEnvelopeParse =
  | { ok: true; envelope: MailEnvelope }
  | { ok: false; why: 'not-mail' }
  | { ok: false; why: 'malformed'; at: number };   // 0-based header line index
export function parseMailEnvelope(text: string): MailEnvelopeParse;
```

- [ ] **Step 1: Write the failing test** — `server/test/mail-envelope-parse.test.ts`:

```ts
it('round-trips every header field: parse(render(x)) === x, artifact-bearing', …);
it('round-trips the artifact-FREE shape', …);
it('round-trips the run-less shape (runId null: no run: line at all)', …);
it('round-trips a run with a program but no wave', …);
it('round-trips a body containing backticks, exercising fenceFor\'s longer fence', …);
it('round-trips an EMPTY body', …);
it('answers not-mail for an ordinary message', …);
it('answers not-mail for a fenced block with a DIFFERENT info string', …);
it('answers not-mail when the fence is not the whole text (prose above or below)', …);
it('answers malformed, with `at`, for a missing id:/from:/to:/kind:/subject: line', …);
it('answers malformed for a non-numeric id and for an unknown kind', …);
it('never returns a bare null, and never a half-populated envelope', …);
```

- [ ] **Step 2: Run it and watch it fail.** → FAIL.

- [ ] **Step 3: Write both in `shared/api.ts`**, beside the mail vocabulary:

```ts
/** The info string on the fence `renderEnvelope` emits (`coord/envelope.ts`).
 *  ONE definition, here in L0, imported by the renderer — the grammar is
 *  minted server-side and parsed from the same constant, so the round-trip
 *  test (`mail-envelope-parse.test.ts`) is a property of the system rather
 *  than of two files agreeing. */
export const MAIL_ENVELOPE_FENCE = 'ccrc-mail';

/**
 * Parse a delivered envelope back out of a transcript turn.
 *
 * A TYPED UNION, NEVER A BARE NULL. `not-mail` (this text is an ordinary
 * message) and `malformed` (this text CLAIMS to be an envelope and is not)
 * are two conditions a caller would handle differently, and collapsing them
 * would be the overloaded null `architecture:99-100` bans. Today both render
 * identically — an ordinary bubble — and that is a deliberate choice, pinned
 * by a test asserting `malformed` never renders as a mail card. The seam
 * keeps the distinction the renderer does not yet need.
 *
 * IT ASSERTS NOTHING ABOUT AUTHENTICITY. The transcript is a rank-3 source
 * and a session can type a fake envelope into itself; the authoritative mail
 * rows come from the database (`{type:'mail'}`, `GET /api/feed`). Consequence
 * of a forgery: one bubble looks like mail. Named, accepted.
 */
export function parseMailEnvelope(text: string): MailEnvelopeParse { … }
```

The parser: trim; require the first line to be `` `{3,}ccrc-mail `` and the last to be the same run of backticks, with nothing outside — anything else is `not-mail`. Then walk the header in the renderer's own order (`id`, `from`, `to`, optional `run`, `kind`, `subject`, optional `artifacts` + indented paths, the `ack:` block, `--`), returning `{why:'malformed', at:<line index>}` at the first line that does not fit. Everything after `--` up to the closing fence is the body. `run: 12 (program:slug wave 2/4)` parses back to all four fields; the parenthetical and the wave suffix are independently optional, mirroring `renderEnvelope`'s own three conditionals (`envelope.ts:66-69`).

- [ ] **Step 4: Import the constant in `envelope.ts`** — `return `${fence}${MAIL_ENVELOPE_FENCE}\n…`` — and add the `single-definition.test.ts` guard: `'ccrc-mail'` appears as a literal in exactly one source file under the four roots, and that file is `shared/api.ts`.

- [ ] **Step 5: Run the gates** — `cd server && ./node_modules/.bin/vitest run test/mail-envelope-parse.test.ts test/coord-envelope.test.ts test/single-definition.test.ts test/mail-routes.test.ts` (`timeout: 600000`) → PASS.

- [ ] **Step 6: Commit**
```bash
git add shared/api.ts server/src/coord/envelope.ts server/test/mail-envelope-parse.test.ts server/test/single-definition.test.ts
git commit -m "feat(shared): one envelope grammar, minted and parsed from one definition, proven by a round trip"
```

---

### Task 16: `truncatedBytes` — a cut result says it was cut

Spec §2.1's third bullet and §2.4. Today `TOOL_RESULT_MAX = 20_000` / `TOOL_INPUT_MAX = 4_000` (`transcript/parse.ts:3-4`) cut silently and the PWA renders the fragment as if it were the whole thing.

**Files:**
- Modify: `shared/api.ts` (`ChatEvent` `:1429-1434`), `server/src/transcript/parse.ts`, `pwa/src/session/ToolCard.tsx`, `pwa/src/session/chat.css`
- Modify: `server/test/transcript-parse.test.ts`, `pwa/test/chat.test.tsx`

**Interfaces:**
```ts
| { kind: 'tool_use'; …; truncatedBytes?: number }
| { kind: 'tool_result'; …; truncatedBytes?: number }
// server/src/transcript/parse.ts
const truncate = (s: string, max: number): { text: string; truncatedBytes: number } =>
  s.length > max
    ? { text: s.slice(0, max), truncatedBytes: Buffer.byteLength(s, 'utf8') - Buffer.byteLength(s.slice(0, max), 'utf8') }
    : { text: s, truncatedBytes: 0 };
```

- [ ] **Step 1: Write the failing tests.** Server: `it('reports 0 on a result under the cap')`, `it('reports the BYTES cut, not the characters, on a multi-byte tail')`, `it('reports on tool_use input too')`, `it('never omits the field — absence can only come from an older server')`. PWA: `it('renders no cue when the field is absent')`, `it('renders no cue at 0')`, `it('renders "+N bytes cut" at >0, inside the expanded well')`, `it('never says "complete" anywhere')`.

- [ ] **Step 2: Run both and watch them fail.** → FAIL.

- [ ] **Step 3: Add the field**, with the three-state docstring verbatim from the spec, plus D-B4-12's char-cap/byte-report note at the `truncate` call site.

- [ ] **Step 4: Render the cue** in `GenericToolCard`'s expanded body (`ToolCard.tsx:244-263`) and in `AskOutcome`'s well, through one small helper so the sentence has one home. Still, no glow: a truncation note is a record.

- [ ] **Step 5: Run the gates** — `cd server && ./node_modules/.bin/vitest run test/transcript-parse.test.ts test/sessionws.test.ts` and `cd pwa && ./node_modules/.bin/vitest run test/chat.test.tsx` (`timeout: 600000`) → PASS.

- [ ] **Step 6: Commit**
```bash
git add shared/api.ts server/src/transcript/parse.ts pwa/src/session/ToolCard.tsx pwa/src/session/chat.css server/test/transcript-parse.test.ts pwa/test/chat.test.tsx
git commit -m "feat: a truncated tool result says so, and an old server's silence never reads as completeness"
```

---

### Task 17: the mail `ChatItem` — the machine's words stop being the operator's

Spec §2.3. `ChatItem` gains **exactly one** member. Nothing is minted into `s.events`: the item is derived at render time from the event already there, so the revival discipline (`stores/session.ts:116-177`, the local-divider rule at `:89-96`) needs **no new clause** — a reconnect re-derives the same card from the same JSONL bytes.

**Files:**
- Create: `pwa/src/session/MailCard.tsx`; modify `pwa/src/session/ChatList.tsx` (`:21-26`, `:44-93`, `:270-281`), `pwa/src/session/chat.css`
- Create: `pwa/test/mail-card.test.tsx`; modify `pwa/test/chat.test.tsx`

**Interfaces:**
```ts
export type ChatItem = … | { kind: 'mail'; key: string; envelope: MailEnvelope; event: MessageEvent };
export function MailCard({ envelope }: { envelope: MailEnvelope }): ReactNode;
```

- [ ] **Step 1: Write the failing test** — `pwa/test/mail-card.test.tsx`:

```ts
it('renders a delivered envelope as a mail card attributed to its sender', …);
it('names kind, subject and run/wave, and renders artifacts AS PATHS', …);
it('folds the ack boilerplate away and shows the body', …);
it('does NOT render as a "you" bubble', …);                              // the whole point
it('offers no ack control and no reply control', …);                     // negative pin, mail-strip idiom
it('leaves a MALFORMED envelope as an ordinary bubble, never a half-populated card', …);
it('leaves a turn that is one fenced block PLUS prose as an ordinary bubble', …);
it('derives from the event, minting nothing into the store — a reconnect re-derives it', …);
it('keys on the event uuid, so the virtual list is stable', …);
it('goes still: no --glow, no animation, no box-shadow under .mail-card', …);
it('does not overlap MailStrip: the strip answers "unacted-on", the card "what was said, when"', …);
```

- [ ] **Step 2: Run it and watch it fail.** → FAIL.

- [ ] **Step 3: Extend `buildChatItems`.** In the `else` arm (`ChatList.tsx:71-73`), for a `user` event only:

```ts
      if (e.kind === 'user') {
        // Only when the WHOLE turn is one fenced ccrc-mail block —
        // `parseMailEnvelope` enforces that itself, so this file holds no
        // second copy of the rule (the PWA holds no rule the server does not
        // also hold; the grammar is one definition in `shared/`).
        const parsed = parseMailEnvelope(e.text);
        if (parsed.ok) { items.push({ kind: 'mail', key: e.uuid, envelope: parsed.envelope, event: e }); continue; }
      }
```

with `ChatItemView` gaining `case 'mail': return <MailCard envelope={item.envelope} />;`.

- [ ] **Step 4: Write `MailCard`.** Header line `coordinator → this worker`, then kind/subject/run·wave, artifacts as a plain path list, body in a well. No controls of any kind — ack is box-token gated and is the agent's act (`envelope.ts`'s own `ack:` lines). `.mail-card-*` in `chat.css`, still.

- [ ] **Step 5: Run the gates** — `cd pwa && ./node_modules/.bin/vitest run test/mail-card.test.tsx test/chat.test.tsx test/mail-strip.test.tsx test/stores.test.ts test/tap-targets.test.tsx` (`timeout: 600000`) → PASS.

- [ ] **Step 6: Commit**
```bash
git add pwa/src/session/MailCard.tsx pwa/src/session/ChatList.tsx pwa/src/session/chat.css pwa/test/mail-card.test.tsx pwa/test/chat.test.tsx
git commit -m "feat(pwa): agent-to-agent mail stops reading as something the operator typed"
```

---

### Task 18: the ask card's third state, and one control that only opens the sheet

Spec §2.3's table. The ask card needs **no** new `ChatItem` kind. `Answer` does not answer — it raises `EnvelopeSheet`, the one hardened answer path, and the mechanical reason is that `ChatList` is virtualized: a row owning an in-flight answer could be unmounted mid-send by an ordinary scroll.

**Files:**
- Modify: `pwa/src/session/ToolCard.tsx` (`AskCard` `:163-186`, `ToolCard` `:188-200`), `pwa/src/session/ChatList.tsx`, `pwa/src/session/DialogSheet.tsx` (`:146-181`), `pwa/src/screens/SessionScreen.tsx`, `pwa/src/session/chat.css`
- Create: `pwa/test/ask-live.test.tsx`

**Interfaces:**
```ts
export type AskState = 'awaiting' | 'unanswered' | 'answered';
export interface ChatListProps { …; askPending?: boolean; onAnswer?: () => void }
export interface DialogSheetProps { …; raise?: number }   // D-B4-13
export const ASK_WORD: Record<AskState, string>;
export const ASK_GLYPH: Record<AskState, string>;
```

- [ ] **Step 1: Write the failing test** — `pwa/test/ask-live.test.tsx`:

```ts
it('awaiting: no tool_result AND a live ask in the store → word, glyph and one Answer control', …);
it('unanswered: no tool_result and NO live envelope → word and glyph, and NO control', …);
it('a dead session does not beg forever: the row reads unanswered, never "waiting for you"', …);
it('answered/declined renders exactly as it does today', …);
it('Answer does not POST anything — it raises the sheet', …);           // negative pin
it('Answer un-dismisses a sheet the reader had waved away', …);          // D-B4-13
it('the live cue is permitted ONLY in awaiting: .ask-live is the one glow-bearing rule', …);
it('the control clears var(--tap-min)', …);
it('dialogs stay screen-hosted — no dialog control is rendered in the transcript', …);
```

- [ ] **Step 2: Run it and watch it fail.** → FAIL.

- [ ] **Step 3: Derive the axis** in `AskCard` from the two sources at once (`result` and `askPending`), through total `Record` tables — never a raw index, `runWords.ts`'s stated rule one directory over. `Answer` is a plain `<button>` calling `onAnswer`, nothing else; its `title` says it opens the answer sheet.

- [ ] **Step 4: Thread the two props** — `SessionScreen` computes `askPending = ask !== null || dialog !== null` and holds `const [raise, setRaise] = useState(0)`; `ChatList`/`ChatListInner`/`ChatItemView`/`ToolCard` pass both down, following `onRetry`/`onDiscard`'s existing drill exactly. `DialogSheet` gains `raise?: number` and `useEffect(() => { if (raise) setDismissedKey(null); }, [raise])`, with D-B4-13's reasoning at the prop.

- [ ] **Step 5: Style.** `.ask-live` is the one rule permitted a live cue and is named BY NAME in the no-glow scan's exclusion, with its own comment — the `MAIL_REJECT_CODES`-excludes-`undeliverable` idiom. `.ask-answer` and every other `.ask-*`/`.mail-card-*` rule go still.

- [ ] **Step 6: Run the gates** — `cd pwa && ./node_modules/.bin/vitest run test/ask-live.test.tsx test/chat.test.tsx test/dialog-sheet.test.tsx test/tasks.test.tsx test/tap-targets.test.tsx test/polish.test.tsx` (`timeout: 600000`) → PASS.

- [ ] **Step 7: Commit**
```bash
git add pwa/src/session/ToolCard.tsx pwa/src/session/ChatList.tsx pwa/src/session/DialogSheet.tsx pwa/src/screens/SessionScreen.tsx pwa/src/session/chat.css pwa/test/ask-live.test.tsx
git commit -m "feat(pwa): a question the agent is blocked on stops rendering as running, and one control opens the one answer path"
```

---

### Task 19: wave 4 gates, and the program's own close

- [ ] **Step 1: Wire-totality and negative pins, as tests.** `applySessionMsg`'s `satisfies never` default arm is **untouched** — no session frame was added. `ChatEvent` gained no kind. `FLEET_PROTO` is unchanged. The mail card offers no ack/reply; the ask card offers no direct answer; `malformed` never renders as a card.

- [ ] **Step 2: Mutation sweep**: delete the whole-turn check (prose+fence renders as a card); collapse `not-mail`/`malformed` into one member; drop `truncatedBytes` from `tool_use`; make absent `truncatedBytes` render "complete"; let `Answer` call `api.answerAsk` directly; give `.ask-live`'s cue to `.ask-unanswered`.

- [ ] **Step 3: Full suites, foreground.** `cd server && ./node_modules/.bin/vitest run`; `cd agent && ./node_modules/.bin/vitest run`; `cd pwa && ./node_modules/.bin/vitest run`; typecheck all three. Real counts.

- [ ] **Step 4: The operator record.** One README section: the three new phone controls, the pause verb's rollout order, and the sentence that `POST /api/runs/:id/items` is the coordinator's write and is made only after the server re-measured.

- [ ] **Step 5: The handoff commit and the final close.** Mail wave-done; the coordinator closes wave 4's run with `final: true`, which releases the hold and lets the ordinary sweep archive the workspace.

---

## Spec Coverage

| spec section | where |
|---|---|
| §2.1 mail card / live ask / truncation cue | Tasks 16, 17, 18 |
| §2.2 wire additions table; no frame, no ChatEvent kind | Tasks 15, 16; pinned in Task 19 |
| §2.3 the `ChatItem` member; the three-state ask; one control; no-glow | Tasks 17, 18 |
| §2.4 degradation rules (backlog.missing, malformed, absent field, no ack, MailStrip) | Tasks 15–17, pinned Task 19 |
| §3.1 items at dispatch, validation, ordering, idempotence, fixed ledger | Task 1 |
| §3.2 the settle route, one terminality point, refusals, all-or-nothing | Tasks 2, 3 |
| §3.3 the tally's meaning, em dash, two-cue discipline | Task 4 |
| §3.4 edges (closing leaves items, `blockedBy` unused, wave 1 reads `—`) | Tasks 3, 5 |
| §4.1 the authorization ruling and its honesty clause | Task 7 (D-B4-9) |
| §4.2 the verb, the grant **and its enrolment**, the argv, the route, the frame, the client rules | Tasks 6, 7, 8, 11 |
| §4.3 abandon: D-B4-1/2/3/17, the `planned` table, never archive, the refusals | Tasks 9, 12 |
| §4.4 start-a-program as composition; ledger not validated; pause warning | Task 13 |
| §5 non-goals | none added: no thinking blocks, no history route, no terminal fidelity, no `ai-title`, no second answer path, no PWA compose/ack, no `blockedBy` semantics, no `RUN_TRANSITIONS` edit, no new PWA auth |
| §6 testing, rollout, failure modes, design gates | Tasks 5, 10, 14, 19 |
| §7 dogfood shape | the Wave Map below |

---

## WAVE MAP

**Merge order is sequential and is the dispatch order.** Each wave's work lands **after** the previous wave has merged to `main`; nothing in a later wave depends on an unmerged earlier one. Stated as the assumption it is: waves 3 and 4 are independent of each other and could run in parallel across two workers (different directories, no shared files) — but wave 3 depends on wave 2's wire being on `main`, and every wave depends on this plan document being committed to `main` before execution begins, because each brief points at it.

**CORRECTED post-dogfood (F5, `docs/superpowers/programs/build4.md`): the "branch" column below is HISTORICAL — a name this plan used when it was written as an ordinary multi-PR SDD plan, before Build 7's coordinator existed to dispatch it through a run/workspace. It is NOT an instruction for a coordinator to give a worker. Under coordinator-driven dispatch, `ws-add` already creates the workspace on its own branch (`ws/<slug>`), and ccrc's done-fingerprint re-measures THAT branch — never a branch a brief merely names. The build4 wave-1 dogfood's own brief said "work on branch `feat/build4-w1-items` cut from main", copying this column verbatim; the worker complied exactly, and every subsequent `/advance`/`/close` then re-measured the UNMOVED workspace branch and refused `stale-tip` forever, with no non-abandon path to close a run whose work was otherwise correct and reviewed. Every wave's actual dispatched brief must instead say: "commit on this workspace's own branch; do not create or switch to a separate feature branch" — see `ccd/coordinator-skill/references/wave-lifecycle.md` §2. Read the "branch" column below as "what this task grouping used to be called", nothing more.**

| wave | tasks | context | branch (historical name — see note above, NOT a dispatch instruction) | touches |
|---|---|---|---|---|
| 1 | 1–5 | Coordination | `feat/build4-w1-items` | `shared/api.ts`, `server/src/coord/{store,dispatch,items,routes}.ts`, `ccd/coordinator-skill/**`, `pwa/src/fleet/runWords.ts`, `pwa/src/screens/RunsScreen.tsx` (one line) |
| 2 | 6–10 | Fleet Mutation + Coordination | `feat/build4-w2-controls` | `ccd/ccd`, `agent/src/whitelist.ts` + `agent/test/**`, `server/src/{ccdargv,registry,watch,bus,server}.ts`, `server/src/coord/{close,store,routes}.ts`, `shared/api.ts` |
| 3 | 11–14 | PWA | `feat/build4-w3-hands` | `pwa/src/{stores/fleet.ts,lib/api.ts,fleet/**,screens/RunsScreen.tsx}` |
| 4 | 15–19 | Session Conversation | `feat/build4-w4-transcript` | `shared/api.ts`, `server/src/{transcript/parse.ts,coord/envelope.ts}`, `pwa/src/session/**`, `pwa/src/screens/SessionScreen.tsx` |

Overlaps, named so a merge conflict is expected rather than discovered: `shared/api.ts` is touched by waves 1, 2 and 4 — in three disjoint regions (the mail-cap block, the `FleetMsg`/marker block, the `ChatEvent`/envelope block). `RunsScreen.tsx` is touched by waves 1 and 3 — one line versus the banner and the door. `server/src/coord/store.ts` is touched by waves 1 and 2 — the work-item block versus `closeRun`. Sequential merging is what keeps all three cheap.

**Wave 1 brief sketch** (≈2.4 KB — fits the 8 KB cap with room for the ledger excerpt):

> Program `build4`, wave 1 of 4 — **Coordination: the writer.** Commit on THIS WORKSPACE'S OWN branch — never create or switch to a separate feature branch (`ws-add` already put you on it; the done-fingerprint re-measures that exact branch, and nothing else). Read `docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md` on `main`, Global Constraints and Tasks 1–5, and `docs/superpowers/specs/2026-08-11-build4-conversation-and-controls-design.md` §3 for the why. Implement Tasks 1–5 in order, red-first, committing at each task's own commit step.
> Deliver: `items?: string[]` on the dispatch body (validated ≤32 entries, ≤200 UTF-8 bytes each, `bad-request` otherwise); `CoordStore.dispatchRun` folding `markDispatched`/`setClearedAt`/`advance`/the item INSERTs into ONE transaction (D-B4-4); `setWorkItemState` returning a typed result with the terminality guard in the `UPDATE`'s own `WHERE` and scoped to the run (D-B4-5); `CoordStore.settleItems` — the all-or-nothing batch, in ONE `tx`, refusing in a pre-pass BEFORE any write so no sentinel is needed (D-B4-16); `POST /api/runs/:id/items` (box-token gated; `coord/items.ts` is a pure validate-and-map L1 decision that imports neither `./db.js` nor `node:sqlite`; refusals `unknown-item` 404 / `item-terminal` 409, both entered in `RUN_REFUSE_CODE_MAP`); `itemTallyLabel` rendering an em dash at `total === 0`; the coordinator skill documenting `items` at dispatch and the settle call **after** `POST .../advance` answers ok.
> Do not: teach the mail bus to route on `subject`; add an item to a dispatched run; touch `RUN_TRANSITIONS`; write `blockedBy` or `doneFingerprint`; parse the brief; open a transaction outside `CoordStore`.
> Gates: full server and pwa suites foreground, real counts; the Task 5 mutation table with every row killed by a named test (the `WHERE`-guard rows are killed by DIRECT `setWorkItemState` calls — `settleItems` refuses earlier and cannot discriminate them); `single-definition` extended with the terminal-trio guard and the L1-holds-no-handle scanner.
> Handoff: your last commit is the handoff. Mail `wave-done` with `handoffCommit === branchTip` and the fingerprint. This wave's own tally will read `—` — that is expected (spec §3.4), not a defect.

**Wave 2 brief sketch** (≈2.9 KB):

> Program `build4`, wave 2 of 4 — **Fleet Mutation + Coordination: the run-control substrate.** Commit on THIS WORKSPACE'S OWN branch — never a separate feature branch (same rule as wave 1's brief; the done-fingerprint only ever re-measures the workspace branch). Plan doc as above, Tasks 6–10; spec §4.1–§4.3. Read D-B4-10 and D-B4-17 before writing any code: both are corrections to an earlier draft that did not compile.
> Deliver: `ccd coord-pause --state on|off` (touch/rm `$REG/coordinator-paused`, idempotent, `die` on either failed write — `cmd_ws_hold`/`cmd_ws_release` are the shape); the verb in `cmd_caps`, the dispatch arm, the usage line; `['coord-pause','--state']` in `EXEC_WHITELIST.ccd` **and `'coord-pause': '--state'` in `REQUIRED_VERB_FLAG`** — the grant without the enrolment enforces nothing (`isExecAllowed` is prefix-matching), so also add `agent/test/types/bypasses/g9-coord-pause-without-state.ts` + its `EXPECTED` entry + the runtime-audit case; `CCD_ARGV.coordPause` (+ its `SAMPLES` entry); `POST /api/coord/pause` — **ungated, deliberately** (D-B4-9), with the source-scanner test naming it as an exclusion; `RegistryRead.listed:true` gains `names` and `tick()` calls `emitCoord(...)` **above** the `!listed` early return so an unlistable registry reports `unmeasurable` on the tick it happens (D-B4-10); `MarkerState`/`CoordStatus`/`{type:'coord'}`, byte-equality guarded, cold-started after `runs`; `POST /api/runs/:id/abandon` calling the SAME `closeRun` with the abandon as ONE contiguous arm derived immediately after `if (!run) return` and returning from inside it (D-B4-17) — D-B4-1 (no fingerprint; `:85-102` is not on that path), D-B4-2 (no `.prhistory`), D-B4-3 (`causedBy:'operator'`, no default), D-B4-8 (`viaClosing:false` for `planned → failed`), D-B4-7 (the route never reads `req.body`).
> Do not: edit `RUN_TRANSITIONS`; add a second ccd verb; import `MAIL_DISABLED_MARKER` into `watch.ts` (it already has its own, deliberately — `rundefs.ts:33-44`); let the abandon path reach `wsArchive`, `verifyDone`, `prhistory-unreadable` or the fingerprint validation — all four are pinned by negative tests.
> Rollout: this wave is **agent-first**. Say so in the wave-done mail: `ccd` + whitelist to the fleet host before the server, or the route 502s `forbidden` for every tap.
> Gates: server + **agent** + pwa suites foreground; Task 10's mutation table, whose two whitelist rows are killed by the module-load `auditExecWhitelist()` throw and by `g9`'s TS2322 — not by `whitelist-subset`'s assertions, which cannot see a narrowed prefix.

**Wave 3 brief sketch** (≈2.0 KB):

> Program `build4`, wave 3 of 4 — **PWA: the console's hands.** Commit on THIS WORKSPACE'S OWN branch — never a separate feature branch. Plan Tasks 11–14; spec §4.2's client rules, §4.3, §4.4. Wave 2's wire is on `main`; consume it, author nothing server-side.
> Deliver: `coord`/`coordFrameSeen` on the fleet store with a shape-checked `coord` arm; `coordWords.ts`'s two parallel tables and the total `markerState` door; `CoordBanner` on `/runs` only — renders **nothing** before the first frame, two cues always, `pausing…`/`resuming…` with **no optimism**, settling only on the next frame and rendering `unconfirmed — check /runs` after `COORD_CONFIRM_MS`, with 501 and 502 copy; `AbandonSheet` — two taps, naming the run and its workspace, per-refusal copy from a total map, **no archive control anywhere**, and the row control as a sibling of `.run-open` (D-B4-14); `StartProgramSheet` composing `api.projects` + `useProjectedHome` + `createSession` + `prompt`, warning-not-blocking when `coord.pause` is `set`, refusing when the projection is `null` (D-B4-11), and never calling `POST /api/runs`.
> Do not: add a server route; poll for the run row; claim the ledger exists.
> Gates: design gates as tests — one stylesheet block per surface, tap floor scraped AND rendered, no-glow over `.coord-*`/`.run-abandon`/`.program-start-*`, the door still renders at zero runs, contrast green.

**Wave 4 brief sketch** (≈2.1 KB):

> Program `build4`, wave 4 of 4 — **Session Conversation: the transcript.** Commit on THIS WORKSPACE'S OWN branch — never a separate feature branch. Plan Tasks 15–19; spec §2 in full.
> Deliver: `MAIL_ENVELOPE_FENCE` + `parseMailEnvelope` in `shared/` returning `{ok:true}` | `not-mail` | `malformed`+`at` — never a bare null — with `coord/envelope.ts` importing the constant so the fence has ONE definition and a round-trip test proving `parse(render(x))` across the artifact-bearing, artifact-free, run-less, long-fence and empty-body shapes; `truncatedBytes?: number` on `tool_use`/`tool_result` with the three documented states, computed in `parse.ts` (D-B4-12) and rendered as a cue only at `>0`; the single `{kind:'mail'}` `ChatItem`, DERIVED at render time from the event already in the store (nothing minted into `s.events`, so the revival discipline needs no new clause), rendering a card with no ack and no reply; the ask card's three-state axis with `Answer` raising the existing sheet through a `raise` nonce (D-B4-13) and never sending anything itself.
> Do not: add a session frame or a `ChatEvent` kind; touch `inject/ask.ts` or `inject/send.ts`; add a second way to answer; render a `malformed` envelope as a card; give a live cue to anything but `.ask-live`.
> Gates: Task 19's negative pins and mutation table; `applySessionMsg`'s `satisfies never` arm untouched; `FLEET_PROTO` unchanged; the README operator section; then the final close with `final: true`.