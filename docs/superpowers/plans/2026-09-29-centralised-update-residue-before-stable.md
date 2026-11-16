# Centralised update management — residue before stable (R1, R5, R6): a link failure after the hand-off holds the lease, the answer follows the lease, and wave 5's prose — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three post-rollout residue items the coordinator marked for this round before `stable` is promoted. **R1** (bar class 1): a fleet-link failure that comes AFTER the `update` op frame was handed to the link HOLDS the lease exactly as an `accepted` answer does, and settles only by the node's own report of the run or by the deadline. A failure before the frame reached the link still releases `idle`. **R5** (review 176 F1): the dispatcher's post-answer writes follow the lease by identity, so a revive during the await releases the heir instead of missing it. **R6** (review 176 F2–F5): item 9's false EAGAIN premise, `update-watchdog-revert`'s vacuous tmux line, the wave 5 plan's stale Task 2 snippets, and the `UPDATE_STORE_REFUSE_CODES` glossary.

**Architecture:** Server side only.
- **R1, client half.** One new error class, `LinkNotSentError`, in `server/src/remote/client.ts` beside `AgentOpError`. `FleetClient.request()` throws it from the three arms that never handed the frame to `ws`'s sender, and from nowhere else. Its `message` is the same word the plain `Error` carried before, so every `.message` reader is unchanged.
- **R1, dispatcher half.**
  - `OpAnswer`'s `transport` arm gains `reached: 'never' | 'maybe'`. `linkAnswer` answers `never` only for a `LinkNotSentError` (or no link wired); everything else is `maybe`. The uncertain case folds into HOLD.
  - `classifyOpAnswer` holds a `maybe`, with words beginning `LINK_FAILED_HOLD_PREFIX`. `runDispatch` writes those words through W5's `noteLeaseDetail` and reports `result: 'held'`.
  - The deadline sweep words such a lease's `failed` with `linkFailedDeadlineDetail` (L1). Every such failure names the link failure; the "the row's last report does not name `<tag>`" clause (fix round 1, review 178 F1 — corrected from "no run of `<tag>` was reported", which claimed more history than the row's LAST stored report can prove) is written only where it is true (see the deviation's "Narrowing, confirmed by the coordinator").
  - Settling is W2/W4's unchanged sweep: `leaseActionFor`'s identity clause (D-3405) settles or releases on a changed report naming the lease's tag.
- **R5.** A pure L1 `leaseHolder(rows, label, startedAt)` names the one live busy row holding the lease this run acquired. `runDispatch` resolves it after the await, in the same synchronous stretch as its write, and sends the release (with `expectedStartedAt: now`) and the note there.
- **R6.** Prose and pins only, plus new pins: the real runner's errno split, and a poisoned tmux/gh in the watchdog box.
- No new store writer, no schema change, no wire change (`FLEET_PROTO` stays 1). No `agent/` edit.

**Tech Stack:** TypeScript on node `>=22.13.0`; `ws` 8.x (the agent link, transport unchanged); `node:sqlite` `DatabaseSync` via W2's `CoordStore`; vitest in `server/`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md` §10, "A refusal is an answer, not silence — and it does not consume the request" (`:812-818` at `af5a29f8`). This round departs from that paragraph's transport sentence, recorded as D-3555 below. §10's "Result by re-measurement, never by the reply" (`:807-810`) is what the hold relies on.

**Producers:** All merged on `main` at `af5a29f8`: waves 1–5 of the programme. W2's store: `releaseLease`, `settleNode`, `rekeyNode`, `upsertNodeMeasurement`. W4's `leaseActionFor` identity clause. W5's `runDispatch`, `classifyOpAnswer`, `noteLeaseDetail`, `handOffLease` and `leaseFollowsLabel`, and its plan `docs/superpowers/plans/2026-09-23-centralised-update-w5-convergence.md` with D-3373, D-3400, D-3405, D-3412 and D-3413 as shipped. Rulings: the coordinator's R1/R5/R6 (post-rollout residue, programme ledger), review 176 (`325d4072`) and its rulings.

**Out of scope, said once:**
- Any edit to `ccd/`, `deploy/`, `agent/` (including `agent/src/whitelist.ts`) or a systemd unit. Wave 6 is editing `ccd/ccrc` in parallel.
- Residue R2, R3 and R4. That includes R2's no-revive supersede, which still drops a busy row's lease: `leaseHolder` then finds no holder and falls back to today's target.
- An agent-side replay of the last op, recorded as Not chosen below.
- An acquire-time snapshot of the row's report (a schema change), which is what telling "a previous run's same-tag report" from "this run's" at the deadline would need. See the deviation's narrowing.
- Any change to the server-role local spawn's mapping. Its transport arms stay `release idle`, because nothing started there.
- The spec's own text. The departure is ledgered, and the spec is not edited.

## Global Constraints

- **Anchors are measured at `af5a29f8`**, quoted, and given as `file:line`. Wave 6 may merge first and move README, CLAUDE.md and `single-definition.test.ts`. So Task 1 Step 1 re-measures every anchor this plan cites on the tip being built, by its quoted text, and the quote wins over the number.
- **Server side only:** `server/`, `shared/` only if needed (this plan touches `shared/api.ts`'s glossary comment and nothing else there), `README.md`, and `docs/`. Nothing under `ccd/`, `deploy/`, `agent/`, `*.service` or `*.timer`. The whole-branch check is `git diff --stat origin/main...HEAD -- ccd deploy agent '*.service' '*.timer'`, which must be empty.
- **The one-lease invariant is the point of R1:** no path may release a lease while the node's run may be live. The ONLY positive proof that the op never reached the agent is `LinkNotSentError`. A rejection that does not carry it is `reached: 'maybe'` and HOLDS. A future wrapper around `SendUpdateOp`, a non-`Error` rejection, or an unknown message all hold. Never add a second "not sent" signal by message text: `AgentOpError`'s docstring (`client.ts:98-102`) says why a message string cannot carry that distinction.
- **L1 stays pure.** `server/src/update/dispatch.ts` gains `LINK_FAILED_HOLD_PREFIX`, `linkFailedHoldDetail`, `LinkHoldRow`, `linkFailedDeadlineDetail` and `leaseHolder`, all appended after `deadlineDetail`, which is the file's last function (`:421`). It gains no import specifier: `update-dispatch.test.ts`'s import-block assertion pins four. `OpAnswer`, `AnswerAction`'s docstring and `classifyOpAnswer`'s transport arm are edited in place.
- **`coord.db` stays synchronous, and nothing yields between the read and the write.** `leaseHolder(store.nodes(), …)` and the `releaseLease`/`noteLeaseDetail` it targets run in one synchronous stretch after the op's await. `update-converge.test.ts`'s D-3377 scan still pins the stretch above the acquire, and stays green unedited.
- **Wire discipline:** no frame changes. `LinkNotSentError` is in-process only and extends `Error`, and its `message` is the pre-existing word, so `createRunner`'s `.message` reader and every `catch` that ignores the error are unchanged. The two prose surfaces that say "a link failure stays a plain `Error`" (`AgentOpError`'s docstring, `client.ts:98-100`, and the wave 5 plan's D-3373, `:64`) are amended in place in Task 1: after this round that is true of a POST-send failure only.
- **Fixture HOMEs only.** Any case that runs W4's real `ccd/ccrc` is contained structurally. Its env is built from scratch (HOME the fixture, PATH `<home>/bin:/usr/local/bin:/usr/bin:/bin`), with a poisoned, recording `systemd-run` first on that PATH, asserted not invoked. Task 4 adds a poisoned, recording `tmux` and `gh` to the watchdog box, and two controls prove they resolve first and that `expectContained`'s lines can red. The controls resolve the recorders with `command -v` and execute them only by their ABSOLUTE planted path, never through PATH. A mutation that removes a plant (Task 4 M4/M5) is run against those controls ALONE, by `-t`: no real-sequence case in `update-watchdog-revert.test.ts` — titled `a successful revert: every report names P…`, `` a FAILED revert (its own gate fails, `_upd_rollback_no_restore`)… `` (wave 9, R7b: the span's inner backticks no longer end it), `the negatives, over the same real final report: a watchdog report that is NOT later than the lease…`, `the negatives: the same real report re-attributed to another writer (from cli) keeps the plain word` and `the negatives: a FLEET-role row (agentOps set) that fails the deadline reads NO file…` (fix round 1, review 178 F3: named by title, which does not move, rather than by line) — which spawn the real `bash ccd/ccrc rollback --from watchdog`, may run while a plant is removed, because the contained PATH would then resolve the real `/usr/bin/tmux` (the live fleet server) or the real `gh` (a repo-WRITE token) if a merged wave-6 `ccd/ccrc` called either.
- **Mutation-table discipline.** Every new guard ships with a case that reds when the guard is removed or mutated, measured red-first.
  - Each mutation is applied to the working file after `cp <file> "$SCRATCH/<name>.orig"` (never `git checkout --`), run, and restored with `cp`, then `cmp` byte-identical.
  - A row without a measured red count is not done.
  - A green mutation needs a control. Where a row is defence in depth that cannot red, the table says so and no pin is claimed.
- **D-numbers.** The one new departure is D-3555, minted by the coordinator for this run and defined in this plan's `## Deviations found`. The plan reaches the worker as a commit to cherry-pick, so the definition is in the tree before any code cites it.
  - Task 2's commit completes D-3555's entry with the Task 1–2 measured counts (they are marked pending until then).
  - The run's reserve for departures found while executing is named in the wave brief, never here. Take its numbers in order, and define each in `## Deviations found` in the commit that first cites it. Never write an unspent one anywhere tracked, and never call the allocator. A `D-TBD-` spelling never lands (`dtbd.test.ts`).
  - Existing numbers (D-3373, D-3377, D-3400, D-3405, D-3407, D-3411, D-3412, D-3413) are cited as they are. D-3373, D-3400 and D-3412 are amended IN PLACE, with no new number.
- **README moves no line:** `wc -l README.md` reads the same before and after, 3505 at `af5a29f8`. Task 2's edit reflows only the one paragraph it corrects, and `git diff --numstat -- README.md` shows equal insertions and deletions.
- **Suites run in the foreground, one command per call, inside the package, with timeout ≥ 600000 ms:** `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. Never bare `npx vitest`. Run `npm ci` first where `node_modules` is absent: this includes `agent/` and `pwa/`, because `typecheck-tests.test.ts` spawns their compilers.
- **No residue in tracked text:** no hostname, username, absolute home path, `/mnt` path, docserver URL or org name. The shards' `TMPDIR` is a shell variable (`$SHARD_TMP`), never a committed value. `topology-clean.test.ts` runs after `git add` of any new file.
- **Commit on the workspace branch only:** at least one commit per task, `feat(update): …` / `fix(update): …` / `test(update): …` / `docs(update): …`, never a separate feature branch. Wave-done goes in the same turn as the push; never end a turn to wait on CI.

## Review Focus

1. **A rejection that is "not sent" but was sent.** This is the class-1 hole R1 closes. Only three arms of `request()` may throw `LinkNotSentError`, and all three are before `ws.send` returns. Task 1's post-send cases pin that `timeout`, a socket close with the request pending (`onClose`, `:476`), `close()` with the request pending (`:283`), and an abort after the send are all plain `Error`s. Task 2's end-to-end cases pin that such a failure holds, and that the server is not dispatched beside it, even when the fleet node measures AT the target (the `met` path, which reads idle rows only, `dispatch.ts:280`).
2. **A held lease that nothing settles.** The deadline bounds it (`deadlineExpired`, D-3407's hard cap), and its words must be true. Every deadline of a link-failure hold says the link failed mid-op. "The row's last report does not name `<tag>`" (fix round 1, review 178 F1) is written only when the row's `reportedTarget` is not the lease's tag — the row's LAST STORED report is all this column can prove, since a later writer's report can replace this run's own and D-3214's `stamp-unmeasured` override can write a previous report back over a genuine one. A same-tag report, which may be a previous run's (D-3405's accepted hole), gets "the row's last report names `<tag>`, which may be an earlier run's" instead: no column holds the report as it stood at acquire, so the deadline cannot tell the two apart. That is the narrowing the coordinator confirmed; the VERDICT (halting `failed`) is the same either way.
3. **The heir after a revive mid-op (R5).** Every release word and every hold word must land on the one live busy row, which is the heir. Exactly one live busy row remains through the await, and after a release word none remains, so no false `failed: deadline` follows.
4. **Prose that claims a pin.** R6's glossary pin proves each word HAS a gloss, not that the gloss is true: a regex cannot decide a sentence. The table says so. Premise case (b) pins Node's own behaviour AND the runner's shape (Task 4 M8).

## Deviations found

Plan-level departures from the spec's literal text. D-3555 was minted by the coordinator for this run and is defined here; Task 2's commit completes its counts.

- **D-3555** — Residue R1, ruled by the coordinator before stable (bar class 1). It departs from spec §10 `:812-818` at `af5a29f8`: "`ResErr`, a `disconnected` rejection or a request timeout releases the lease in the same turn through `releaseLease` … `disconnected`/timeout → `idle` with the detail (the node dropped; **re-eligible when it returns, because the request is still there**). … The lease never waits for the deadline on a refusal."
  - **The hazard (D-3400's "WHAT THIS AMENDMENT DID NOT REMOVE" sentence).** After the op frame reached the link, the agent may already have spawned the `--detach` parent. Releasing `idle` then lets two things happen beside a live fleet run: a `met` settle (`planDispatch`, `dispatch.ts:280`, which settles an IDLE row already at its target), and the server-role node's move once the fleet request is cleared.
  - **What changes.**
    - Once the op frame has been handed to the link, EVERY transport failure HOLDS the lease exactly as `accepted` does: `timeout`, `disconnected` on a socket close or a `close()` with the request pending, `aborted` after the send, and any other rejection that is not proven pre-send.
    - The hold's detail names the failure: `link failed mid-op (<why>) — the op reached the fleet link and no answer came back, so the node may have started the run; the lease holds until its report or the deadline`, cut to `UPDATE_OP_DETAIL_MAX`, with `other`'s message through `said()`. It is written by `noteLeaseDetail` on the lease's holder (R5).
      - **AMENDED 2026-09-29 (fix round 1, review 178 O1/CAP).** The literal above overstated it for one `why` and understated the cap. `disconnected`, `timeout` and `aborted` are measured strictly AFTER `ws.send` returned, so for those three the sentence keeps "the op reached the fleet link"; `other` covers a non-`Error` rejection and any rejection `request()` does not otherwise name, which carries no such proof, so for `why === 'other'` it says "the op may have reached the fleet link" instead. And the `UPDATE_OP_DETAIL_MAX` cut applies to the MESSAGE part alone — the budget is computed from the fixed parts' own lengths (`linkFailedHoldDetail`, `dispatch.ts:443-458`) — never a whole-string `.slice`, so the composed sentence always ENDS "the lease holds until its report or the deadline" even for a long `other` message. Pinned by `server/test/update-op-answer.test.ts`'s O1 case (the `other` detail contains "may have reached"; the three named whys contain "reached" but not "may have reached") and its CAP case (a 500-character `other` message still fits `UPDATE_OP_DETAIL_MAX` and ends with the tail).
    - It settles by the node's own reports naming the lease's tag (D-3405's identity clause, `inventory.ts:412`: `if (row.updateTarget !== null && r.target !== row.updateTarget) return { kind: 'none', why: 'stale-report' };`). Otherwise it fails at the deadline, halting, with a server-composed detail that says the link failed mid-op: `deadline — the fleet link failed mid-op; the row's last report does not name <tag>` (fix round 1, review 178 F1) when the row holds no report of the tag, and `deadline — the fleet link failed mid-op; the row's last report names <tag>, which may be an earlier run's` when it does.
    - A failure BEFORE the frame reached the link keeps today's `release idle` with the request standing, because the op never reached the agent: no link wired, the link down at send, a signal already aborted, or a synchronous send throw. The detail is corrected from "the node dropped mid-dispatch" to `<why> — the op never reached the fleet link; the request stands`.
  - **Narrowing, confirmed by the coordinator (2026-09-29).** The ruling words the deadline "saying the link failed mid-op and no run of `<tag>` was reported". This plan writes the first half in every case and the second half only where it is true. Measured: the report columns never write `updateDetail` (its writers are `store.ts:6401/6426/6465/6547/6578/6598/6621`), and no column keeps the report as it stood at the acquire. So when the row's last report already names the lease's tag (a retry of the same tag after an ack, or a genuine report of this run that then stalled), the deadline sweep cannot tell "a previous run's report, unchanged" from "this run reported" (D-3405 decides that by change plus tag in `sweepPlanFor`'s `sameReport`, `inventory.ts:379-412`, at sweep time, not at the deadline). Writing "no run was reported" there could be false. The alternative, an acquire-time snapshot, is a schema change this round does not make. The verdict is unchanged: halting `failed`, the operator acks. The coordinator confirmed this narrowing before dispatch: a deadline sentence that could be false is worse than one that says less.
    - **AMENDED 2026-09-29 (fix round 1, review 178 F1).** Even that narrower claim overreached: `reportedTarget` is only the row's LAST STORED report, and review 178 built two real cases where it disagrees with history while still being the row's honest last value — a LATER writer's report can replace this lease's own genuine report of `<tag>` (case i), and D-3214's `stamp-unmeasured` override (`inventory.ts:603-605`) can write the row's PREVIOUS report back over a genuine `done <tag>` the node just sent (case ii). In both, "no run of `<tag>` was reported" is false: a run WAS reported: the column just no longer says so. The clause now claims only what `reportedTarget` can prove: "the row's last report does not name `<tag>`". The verdict is unchanged: halting `failed`, the operator acks. Pinned by `server/test/update-converge.test.ts` (two new cases, built through the real `sweepInventory`/`sweepPlanFor`/store-writer paths, never a literal `linkFailedDeadlineDetail` input) and `server/test/update-op-answer.test.ts`'s unit cases, all asserting `.not.toContain('was reported')`.
  - **Measured (`server/src/remote/client.ts` at `af5a29f8`, `request()` `:226-259`).**
    - The frame is handed at `:257`, `ws.send(JSON.stringify(req));`. `ws` 8.21.1's `send` (`lib/websocket.js:455-485`; the copy carries no `node_modules`, so it was measured in an installed `server/node_modules/ws` of the same `^8.21.1` range) throws synchronously only at `CONNECTING` (which `:227` excludes in the same tick), drops the frame into `sendAfterClose` when not `OPEN`, and otherwise hands it to `this._sender.send(…)`, which corks the socket and writes. A string payload cannot make the sender's framing throw, and `net.Socket.write` on a destroyed socket reports asynchronously. So the throw sites MEASURED ahead of the hand-off are `JSON.stringify` and `ws.send`'s own `CONNECTING` check; a throw from further below is not reachable by any input found. "Handed to the link" means: `send` returned, so the frame reached `ws`'s sender, not necessarily the agent.
    - Pre-send arms:
      - `:227-229` `if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) { return Promise.reject(new Error('disconnected')); }`
      - `:230` `if (signal?.aborted) return Promise.reject(new Error('aborted'));`
      - a throw inside the executor at `:256-257`, which today rejects with the raw thrown `Error` and leaves the `pending` entry, its timer and its abort listener registered at `:249-254`.
    - Post-send arms:
      - `:247` `reject(new Error('timeout'));`
      - `:241` `reject(new Error('aborted'));`, the abort listener
      - `rejectAllPending(new Error('disconnected'))` at `:476` (socket close) and `:283` (`close()`). `close()`'s only production entry is `ConnectedFleet.close` (`:577`), which nothing in `server/src` calls today, so the `:283` arm is pinned (Task 1 case 4, fourth row) as a guard against a future caller, not a live path.
    - So `disconnected` is ambiguous (`:228` vs `:283`/`:476`), and so is `aborted` (`:230` vs `:241`). Production passes no signal (`index.ts:135`: `sendUpdateOp: (tag, kind) => fleet.client.request({ t: 'req', op: 'update', tag, kind }, UPDATE_OP_TIMEOUT_MS)`), so neither `aborted` arm is reachable for this op today. `timeout` is post-send only.
    - The only reader today, `linkAnswer` (`converge.ts:143-157`), sees message strings (`transportWhy`, `:139-141`). "Handed" is therefore NOT distinguishable from "never sent" at the caller. The fix makes it distinguishable at the source, by a positive marker on the three pre-send arms only. Everything without the marker folds into HOLD.
    - The dispatcher's own pre-send refusals (`unsendableDetail`, `converge.ts:131-137`: no link wired, `state.connected` false, the live agent not advertising the op) take no lease at all, and are unchanged.
  - **Cost, stated.**
    - A link blip mid-op no longer costs one idle retry on the next sweep. It holds the fleet's one lease for up to `CCRC_UPDATE_DEADLINE_MS` (default 15 minutes) from the later of the acquire and the last report, and at most 4 deadlines from the acquire (D-3407). Meanwhile no other node moves, and `ackNode` refuses the busy row.
    - If the node reports no run of the tag, the lease ends in a HALTING `failed: deadline` row the operator must ack. That ack also clears the request (W2 D-3183), so the move is tapped again.
    - If the node did run and its reports reach the server, the lease settles normally.
  - **Not chosen: agent-side replay,** meaning the agent reporting its last op's outcome on reconnect.
    - It needs an `agent/` change and a new additive wire field on `ready`. Both are outside this server-side round, and wave 6 is on the box side.
    - It is weakest exactly where it is needed. The drop that loses the answer is often the agent restarting or dying, which loses an in-memory "last op" too, and a persisted one is a new node file with its own torn-write story.
    - An older agent never replays, so the server must hold on a missing replay anyway: the hold is required in every case, and replay could only shorten it.
    - The fact a replay would carry is already durable, and already read by identity: the node's own `~/.ccrc/update.json`, whose reports name the lease's tag (D-3405). A second channel for the same fact would need its own precedence rule against the first.
  - **Pinned by:**
    - `server/test/remote-connect.test.ts`: the three pre-send arms carry the marker, and the synchronous throw unregisters its timer, pending entry and abort listener; the four post-send arms do not carry it.
    - `server/test/update-op-answer.test.ts`: `never` releases, `maybe` holds, both for each `why`; `linkFailedDeadlineDetail`'s three outcomes.
    - `server/test/update-converge.test.ts`: every post-send failure holds; the server is not dispatched and no `met` settles beside the held row; a report naming the tag settles it; another tag's report does not; the deadline's words, each way; a pre-send failure still releases.
  - **Mutation-measured.** Task 1 (`remote-connect.test.ts`): M1–M9, incl. M4b, each 1 failed — its own targeted
    assertion (M3's stops at its first, `pending.size` still 1; M7/M8/M9 isolate the same synchronous-throw case's
    later assertions, independently). Task 2 (`update-op-answer.test.ts` + `update-converge.test.ts`): M1 19 failed
    (8 op-answer `maybe` rows, converge cases 1 (5 rows), 2, 3, 4, 5, 6, the rewritten `:398` case), M2 11 failed
    (the same converge cases as M1), M3 1 failed (the rewritten `:381` `LinkNotSentError` case), M4 9 failed (case 1's rows,
    cases 4/5/6, the rewritten `:398` case), M5 3 failed (cases 4/5/6), M6 2 failed (case 6, the op-answer
    `reportedTarget: 'v0.0.10'` row), M7 3 failed (the `:494` never-wrote-a-report deadline case, the op-answer
    `accepted —` and null-detail rows), M8 4 failed (the op-answer `never` rows, the rewritten `:381` case). Every
    row applied to a `cp` backup under `$SCRATCH`, run, then restored with `cp` and `cmp` byte-identical.
  - **Cost if wrong:** a transport failure that truly never reached the agent but lacks the marker holds the lease to the deadline. That is an over-hold, bounded, with an ack exit. It never lets a second node move.
- **No separate number for releasing by lease identity.** Measured: spec §10 releases "the lease in the same turn through `releaseLease`" (`:812-813`) and names no row id. Releasing the lease where it now lives is therefore what the spec says. R5 changes what D-3412 describes (its hand-off can land during an in-flight op), so D-3412 is AMENDED IN PLACE in the wave 5 plan (Task 3), with no new number.
- **Amended in place, with no new number:** D-3373 in the wave 5 plan (Task 1: a transport failure is a plain `Error` only after the send; a pre-send one is `LinkNotSentError`), D-3400 in the wave 5 plan (Task 2: its "DID NOT REMOVE" sentence now points at D-3555; Task 4: its ITEM 9 premise), and D-3412 in the wave 5 plan (Task 3).

## File structure

**New**
- `server/test/update-lease-holder.test.ts` — `leaseHolder`'s unit table (Task 3).
- `server/test/update-store-refuse-glossary.test.ts` — every `UPDATE_STORE_REFUSE_CODES` word has a glossary line above the array (Task 4).
- `docs/superpowers/plans/2026-09-29-centralised-update-residue-before-stable.md` — this plan, added in Task 1's commit with the minted number's entry defined; its counts filled by Tasks 1–4.

**Changed**
- `server/src/remote/client.ts` — L3. `LinkNotSentError`, inserted after `AgentOpError` (`:112-121`). `AgentOpError`'s docstring sentence at `:98-100`, amended in place. `request()`'s three pre-send arms throw it, and its send is wrapped so that a synchronous throw unregisters the request (Task 1).
- `server/src/update/dispatch.ts` — L1.
  - Edited in place: `OpAnswer`'s transport arm (`:323`), `AnswerAction`'s docstring (`:325-326`, "`hold` writes nothing" is stale since D-3413 and more so after R1), `classifyOpAnswer`'s docstring (`:336-344`) and its transport arm (`:353-356`).
  - Appended after `deadlineDetail`: `LINK_FAILED_HOLD_PREFIX`, `linkFailedHoldDetail`, `LinkHoldRow` and `linkFailedDeadlineDetail` (Task 2), then `leaseHolder` (Task 3).
- `server/src/update/converge.ts` — L3.
  - `linkAnswer`'s `reached` (Task 2), the local arms' `reached: 'never'` (Task 2), `MoveOutcome`'s `'held'` (Task 2).
  - The deadline sweep's detail (Task 2).
  - The hold arm's note for a transport hold (Task 2).
  - The holder resolution and both post-answer writes (Task 3).
  - Item 9's comment (Task 4).
- `shared/api.ts` — L0, the `UPDATE_STORE_REFUSE_CODES` glossary comment only (`:8641-8646` and one new gloss). It is below `:7672` (R13), and no line of code moves (Task 4).
- `server/test/remote-connect.test.ts` — one appended describe; the import at `:6` gains `LinkNotSentError` (Task 1).
- `server/test/update-op-answer.test.ts` — the transport cases at `:96-104` replaced (Task 2).
- `server/test/update-converge.test.ts`:
  - the import line from `'../src/remote/client.js'` (`:20`) gains `LinkNotSentError` in place;
  - the import from `'../src/update/dispatch.js'` (`:27`) gains `LINK_FAILED_HOLD_PREFIX` and `linkFailedHoldDetail` in place;
  - the two transport cases at `:381-396` and `:398-416` are rewritten (Task 2);
  - one appended describe for R1 (Task 2) and one for R5 (Task 3), the latter declaring its own `FLEET_ID2` at describe level (the file declares it only inside cases, `:223`, `:254`).
- `server/test/update-local-spawn-throw.test.ts` — the header `:1-4` and the rejected-promise case `:40-51` (Task 4), plus the real-runner premise cases.
- `server/test/update-watchdog-revert.test.ts` — `watchdogBox` (`:254-265`) plants a poisoned, recording `tmux` and `gh`; `expectContained` (`:305-310`) asserts both unreached; two control cases (Task 4).
- `README.md` — the one-tap paragraph's refusal sentence (`:652-653`), line-neutral (Task 2).
- `docs/superpowers/plans/2026-09-23-centralised-update-w5-convergence.md`:
  - D-3373 (`:64`, Task 1);
  - D-3400 (`:91`, two sentences: Task 2 and Task 4);
  - D-3412 (`:107`, Task 3);
  - Task 2's stale snippets (Task 4).
- **Run, not edited:**
  - `server/test/update-dispatch.test.ts` (its four-specifier import-block assertion);
  - `update-killed-arms`, `update-auto-dispatch`, `update-routes`, `update-apply-routes`, `update-store-nodes`, `update-store-lease-detail`, `update-writer-groups`, `update-spawn-twin-bodies`;
  - `remote-runner`, `remote-io`, `remote-tail`, `remote-pty`;
  - `mail-routes`, `single-definition`, `macos-platform`, `session-hook`, `deviation-refs`.

## Tasks

### Task 1: The link says what it never sent (R1, client half)

**Files:**
- Modify: `server/src/remote/client.ts`:
  - `AgentOpError`'s docstring sentence "A link failure stays a plain `Error` whose message is `disconnected`, `timeout` or `aborted`." (`:98-100`) becomes "A link failure AFTER the send stays a plain `Error` whose message is `disconnected`, `timeout` or `aborted`; one before the send is a `LinkNotSentError` (below, D-3555) with the same message.";
  - `LinkNotSentError`, inserted directly after `AgentOpError`'s closing `}` (the class at `:112-121`, whose first line is `export class AgentOpError extends Error {`);
  - `request()`, lines `:228`, `:230` and `:257`.
- Modify: `docs/superpowers/plans/2026-09-23-centralised-update-w5-convergence.md` — D-3373 (`:64`), in place: after "A transport failure stays a plain `Error` (`disconnected`, `timeout`, `aborted`)," insert "— AMENDED 2026-09-29 by D-3555 (residue R1): after the send; a request `client.ts` provably never handed to the socket rejects with `LinkNotSentError`, a subclass with the same message —".
- Test: `server/test/remote-connect.test.ts`. One describe appended after the file's last `});` (`:787`); the file's import line from `'../src/remote/client.js'` (`:6`) gains `LinkNotSentError` in place.
- Run, not edited: `server/test/remote-runner.test.ts`, `remote-io.test.ts`, `remote-tail.test.ts`, `remote-pty.test.ts`. They assert `rejects.toThrow('disconnected')` and the like by message, which is unchanged.

**Interfaces:**
```ts
/** D-3555: a request this client never handed to `ws`'s sender — no ready link at the call
 *  (`disconnected`), a signal already aborted (`aborted`), or a synchronous throw from `JSON.stringify` or `ws.send`
 *  (the thrown message). `ws.send`'s measured throw sites are before it queues the frame (its `CONNECTING` check, which
 *  the OPEN test above excludes in the same tick); nothing below it was found to throw synchronously. Every other
 *  rejection of `request()` — `timeout`, an abort after the send, `disconnected` when the socket closes or `close()`
 *  runs with the request pending — comes AFTER `ws.send` returned, when the frame may already be with the agent, and
 *  stays a plain `Error`. `message` is the word a plain `Error` carried before this class existed, so every `.message`
 *  reader is unchanged; only `instanceof` tells the two apart (the dispatcher's `linkAnswer`). A `send` that returns
 *  proves the frame reached `ws`'s sender, not the agent: that is all "handed to the link" means. */
export class LinkNotSentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkNotSentError';
  }
}
```
Do not add `{ cause }`: `server.ts:460`'s standing reason, "NO `{ cause: err }`, deliberately", applies to anything that may be logged.

- [ ] **Step 1: Re-measure the base.** On the tip being built, after `git fetch origin main` and a merge of `origin/main` if it moved:
  ```bash
  grep -n "return Promise.reject(new Error('disconnected'));\|if (signal?.aborted) return Promise.reject(new Error('aborted'));\|reject(new Error('aborted'));\|reject(new Error('timeout'));\|ws.send(JSON.stringify(req));\|rejectAllPending(new Error('disconnected'))\|A link failure stays a plain" server/src/remote/client.ts
  grep -n "sendUpdateOp: (tag, kind) => fleet.client.request" server/src/index.ts
  grep -rn "fleet.close()\|client.close()" server/src
  grep -n "never waits for the deadline on a refusal" docs/superpowers/specs/2026-09-20-centralised-update-management-design.md
  grep -n "A transport failure stays a plain" docs/superpowers/plans/2026-09-23-centralised-update-w5-convergence.md
  wc -l README.md
  ```
  - Expected at `af5a29f8`: client.ts `:98`, `:228`, `:230`, `:241`, `:247`, `:257`, `:283`, `:476`; index.ts `:135`; `close()` callers: only `client.ts:577`; spec `:818`; w5 plan `:64`; README 3505.
  - Record what the tip reads. Every later step anchors by the quoted text.
  - If `index.ts:135` now passes a signal, the `aborted` arms become reachable; if a production `close()` caller appeared, the `:283` arm is live. Say either in the wave-done report. Nothing else changes.
- [ ] **Step 2: Write the failing tests.** Append to `remote-connect.test.ts` a describe titled `FleetClient.request — what never reached the link is a LinkNotSentError, and nothing after the send is (D-3555, residue R1)`. It gets its own `afterEach`, the same shape as the `FleetClient.request — every settlement releases its pending resources` describe's (`:178-192`), and a local `listen()` helper built from that describe's `WebSocketServer` scaffold (hello → ready, requests recorded). Cases:
  1. **No ready link at the call.** `fleet = connectFleet({ url: 'ws://127.0.0.1:1', token: TOKEN, heartbeatMs: 60_000, reconnectMinMs: 60_000 })`. Before any handshake, `fleet.client.request({ t: 'req', op: 'caps' })` rejects. The rejection `toBeInstanceOf(LinkNotSentError)`, has `.message` `'disconnected'`, and leaves `pending.size` at 0.
  2. **A signal already aborted.** Against a live `listen()` server, after `connected`: rejects `toBeInstanceOf(LinkNotSentError)` with message `'aborted'`. The server's recorded request frames are `[]`.
  3. **A synchronous send throw.**
     - After `connected`, `vi.spyOn((fleet.client as unknown as { socket: WebSocket }).socket, 'send').mockImplementation(() => { throw new Error('send refused'); })`.
     - Under `vi.useFakeTimers()`, record `vi.getTimerCount()`, then call `request(…, 60_000, controller.signal)` with a spied `removeEventListener` on `controller.signal`.
     - It rejects `toBeInstanceOf(LinkNotSentError)` with message `'send refused'`.
     - `pending.size` is 0, the timer count equals the recorded one, `removeEventListener` was called once with `'abort'`, and the server recorded no frame.
  4. **After the send, never the marker** (`it.each` over four settlements, each first awaiting the server having SEEN the frame):
     - `timeout`: request with a 25 ms wait. It rejects with message `'timeout'` and `.not.toBeInstanceOf(LinkNotSentError)`.
     - a socket close: the server `terminate()`s the socket that sent the frame, with `reconnectMinMs: 60_000`. Message `'disconnected'`, not the marker (the `onClose` arm, `:476`).
     - `close()`: the client side calls `fleet.close()` (not awaited before the assertion's `await expect(p).rejects…`). Message `'disconnected'`, not the marker (the `:283` arm).
     - an abort: `controller.abort()` after the frame was seen. Message `'aborted'`, not the marker.
- [ ] **Step 3: Run to verify they fail.**
  ```bash
  cd server && ./node_modules/.bin/vitest run test/remote-connect.test.ts
  ```
  - Expected: FAIL. Case 1–3 on `LinkNotSentError is not a constructor` or the import; after a stub export, on `toBeInstanceOf`. Case 3 also on `pending.size` 1 and the timer count.
  - Case 4 is green once it compiles. It is the control that pins the post-send arms, and Step 6's rows M4, M4b, M5, M6 are what prove it can red.
- [ ] **Step 4: Implement.**
  - Insert the class above, and amend `AgentOpError`'s docstring sentence as in Files.
  - In `request()`, change `:228` to `return Promise.reject(new LinkNotSentError('disconnected'));` and `:230` to `if (signal?.aborted) return Promise.reject(new LinkNotSentError('aborted'));`.
  - Replace `:256-257` with:
  ```ts
      const req = { ...payload, t: 'req', id } as AgentReq;
      try {
        ws.send(JSON.stringify(req));
      } catch (e) {
        // D-3555: `JSON.stringify` or `ws.send` threw before queuing the frame (ws throws only at
        // CONNECTING, which the OPEN check above excludes), so undo the registration above and say so. After this
        // `send` returns, every rejection is a plain Error: the frame may already be with the agent.
        clearTimeout(timer);
        this.pending.delete(id);
        dispose();
        reject(new LinkNotSentError(e instanceof Error ? e.message : String(e)));
      }
  ```
  - Leave `:241`, `:247`, `:283`, `:476` and `rejectAllPending` exactly as they are.
  - Amend D-3373 in the wave 5 plan as in Files.
- [ ] **Step 5: Run to verify they pass.** One command per call:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/remote-connect.test.ts
  cd server && ./node_modules/.bin/vitest run test/remote-runner.test.ts test/remote-io.test.ts test/remote-tail.test.ts test/remote-pty.test.ts
  cd server && ./node_modules/.bin/tsc --noEmit; echo "exit $?"
  git fetch origin main
  cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts
  ```
  Expected: PASS, and `exit 0`.
- [ ] **Step 6: Mutation measurement.** For each row: `cp server/src/remote/client.ts "$SCRATCH/client.ts.orig"`, edit, run `cd server && ./node_modules/.bin/vitest run test/remote-connect.test.ts`, `cp` back, `cmp`. Record the failing-case counts in the table below.
- [ ] **Step 7: Commit.** `git add server/src/remote/client.ts server/test/remote-connect.test.ts docs/superpowers/plans/2026-09-23-centralised-update-w5-convergence.md docs/superpowers/plans/2026-09-29-centralised-update-residue-before-stable.md`, then `git commit -m "feat(update): the fleet link marks a request it never sent (residue R1, client half)"`. This commit is the first to cite the minted number, and it carries the definition.

**Mutation table (Task 1):**

| # | Guard | Mutation (`server/src/remote/client.ts`) | Must red | Measured |
|---|---|---|---|---|
| M1 | no-ready arm carries the marker | `:228` back to `new Error('disconnected')` | case 1 | 1 failed — "no ready link at the call" (`toBeInstanceOf(LinkNotSentError)`) |
| M2 | pre-aborted arm carries the marker | `:230` back to `new Error('aborted')` | case 2 | 1 failed — "a signal already aborted" (`toBeInstanceOf(LinkNotSentError)`) |
| M3 | a synchronous send throw is not-sent and unregistered | the `try { … } catch` back to the bare `ws.send(JSON.stringify(req));` | case 3 (not the marker; `pending.size` 1) | 1 failed — "a synchronous send throw" (`toBeInstanceOf(LinkNotSentError)`, first assertion; test stops there) |
| M4 | a socket close after the send is NOT not-sent | `onClose`'s `rejectAllPending(new Error('disconnected'))` (`:476`) → `rejectAllPending(new LinkNotSentError('disconnected'))` | case 4, socket-close row | 1 failed — "a socket close after the send" (`.not.toBeInstanceOf(LinkNotSentError)`) |
| M4b | a `close()` after the send is NOT not-sent | `close()`'s `this.rejectAllPending(new Error('disconnected'))` (`:283`) → `new LinkNotSentError('disconnected')` | case 4, `close()` row | 1 failed — "close() after the send" (`.not.toBeInstanceOf(LinkNotSentError)`) |
| M5 | a timeout is NOT not-sent | `:247` → `reject(new LinkNotSentError('timeout'))` | case 4, timeout row | 1 failed — "a timeout after the send" (`.not.toBeInstanceOf(LinkNotSentError)`) |
| M6 | an abort after the send is NOT not-sent | `:241` → `reject(new LinkNotSentError('aborted'))` | case 4, abort row | 1 failed — "an abort after the send" (`.not.toBeInstanceOf(LinkNotSentError)`) |
| M7 | the catch drops the pending entry | drop `this.pending.delete(id);` from the catch | case 3 (`pending.size`) | 1 failed — "a synchronous send throw" (`pending.size` 1, expected 0) |
| M8 | the catch clears the timer | drop `clearTimeout(timer);` from the catch | case 3 (timer count) | 1 failed — "a synchronous send throw" (timer count 1, expected 0) |
| M9 | the catch removes the abort listener | drop `dispose();` from the catch | case 3 (`removeEventListener` count) | 1 failed — "a synchronous send throw" (`removeEventListener` called 0 times, expected 1) |

### Task 2: A link failure after the hand-off holds the lease (R1, dispatcher half)

**Files:**
- Modify: `server/src/update/dispatch.ts`:
  - `OpAnswer` (`:320-323`): the transport arm gains `reached: 'never' | 'maybe'`, one line in place.
  - `AnswerAction`'s docstring (`:325-326`): "`hold` writes nothing: only the inventory sweep (or a met request) settles a lease" becomes "`hold` settles nothing: only the inventory sweep (or a met request) settles a lease … the dispatcher may NOTE the hold's words on the lease (D-3413's arms B/D; D-3555's link-failure hold)".
  - `classifyOpAnswer`'s docstring (`:336-344`): "and every transport failure release the lease `idle`" becomes the two arms.
  - `classifyOpAnswer`'s transport arm (`:353-356`).
  - APPENDED after `deadlineDetail` (`:421` to the file's last line): `LINK_FAILED_HOLD_PREFIX`, `linkFailedHoldDetail`, `LinkHoldRow`, `linkFailedDeadlineDetail`.
- Modify: `server/src/update/converge.ts`:
  - the import line from `'../remote/client.js'` (`:30`) gains `LinkNotSentError` in place;
  - the import from `'./dispatch.js'` (`:22-25`) gains `linkFailedDeadlineDetail` in place;
  - `MoveOutcome` (`:115-120`) gains `| { nodeId: string; result: 'held'; detail: string }`;
  - `linkAnswer` (`:144-157`);
  - `localAnswer`'s two transport returns (`:203`, `:245`) gain `reached: 'never'`;
  - the deadline sweep's release (`:275`);
  - the hold arm (`:310-317`).
- Modify: `README.md` — `:652-653`, line-neutral.
- Modify: `docs/superpowers/plans/2026-09-23-centralised-update-w5-convergence.md` — D-3400 (`:91`), the sentence beginning "WHAT THIS AMENDMENT DID NOT REMOVE".
- Modify: this plan's `## Deviations found`, where D-3555's entry gets the Task 1–2 measured counts.
- Test: `server/test/update-op-answer.test.ts` — `:96-104` replaced.
- Test: `server/test/update-converge.test.ts`:
  - `:20`'s import gains `LinkNotSentError`; `:27`'s gains `LINK_FAILED_HOLD_PREFIX` and `linkFailedHoldDetail`;
  - `:381-396` and `:398-416` are rewritten;
  - one describe is appended after the last `});` (`:920`).

**Interfaces:**
```ts
// dispatch.ts, in place:
  | { kind: 'transport'; why: 'disconnected' | 'timeout' | 'aborted' | 'other'; message: string; reached: 'never' | 'maybe' };

// dispatch.ts, appended:
/** D-3555: the words a lease HELD after the fleet link failed mid-op begins with. This server writes
 *  them (`converge.ts`, through `noteLeaseDetail`) and `linkFailedDeadlineDetail` reads them back. A node could spell
 *  them in an arm-B/D detail; that changes only the deadline's WORDS, never its verdict. */
export const LINK_FAILED_HOLD_PREFIX = 'link failed mid-op';
export function linkFailedHoldDetail(why: 'disconnected' | 'timeout' | 'aborted' | 'other', message: string): string;
//   `${LINK_FAILED_HOLD_PREFIX} (${why === 'other' ? `other: ${said(message, 'no message')}` : why}) — the op
//   ${why === 'other' ? 'may have reached' : 'reached'} the fleet link and no answer came back, so the node may have
//   started the run; the lease holds until its report or the deadline` (fix round 1, review 178 O1: the three named
//   post-send arms are measured after `ws.send` returned, so they keep "reached"; `other` carries no such proof).
//   Fix round 1, item 3: the MESSAGE part alone is capped (computed from the fixed parts' own lengths), so the
//   whole sentence always fits UPDATE_OP_DETAIL_MAX and always ENDS with the tail above — never a `.slice` over
//   the whole string, which could cut the tail off a long `other` message.
export interface LinkHoldRow { updateDetail: string | null; updateTarget: string | null; reportedTarget: string | null }
/** The failed-deadline words for a lease held after a link failure, or `null` (the caller then uses `deadlineDetail`).
 *  Only when the row's detail begins `${LINK_FAILED_HOLD_PREFIX} (` and it names a tag. The words always say the link
 *  failed mid-op; they say "the row's last report does not name <tag>" (fix round 1, review 178 F1 — corrected from
 *  "no run of <tag> was reported", which claimed more history than `reportedTarget`, the row's LAST STORED report,
 *  can prove) only when the row holds no report of THAT tag. A same-tag
 *  report — which may be a previous run's (D-3405's accepted hole; no column keeps the report as it stood at the
 *  acquire) — gets the qualified sentence instead. */
export function linkFailedDeadlineDetail(row: LinkHoldRow): string | null;
//   reportedTarget !== updateTarget:
//     `${DEADLINE_DETAIL} — the fleet link failed mid-op; the row's last report does not name ${row.updateTarget}`
//   reportedTarget === updateTarget:
//     `${DEADLINE_DETAIL} — the fleet link failed mid-op; the row's last report names ${row.updateTarget}, which may be an earlier run's`
//   each sliced to UPDATE_OP_DETAIL_MAX.
```

- [ ] **Step 1: Re-measure.**
  ```bash
  grep -n "kind: 'transport'" server/src/update/dispatch.ts server/src/update/converge.ts server/test/*.test.ts
  grep -n "if (store.releaseLease(row.nodeId, 'failed', deadlineDetail(row, ownReport), null).ok) expired.push(row.nodeId);" server/src/update/converge.ts
  grep -n "if (answer.kind === 'accepted' && answer.detail !== undefined) store.noteLeaseDetail(move.nodeId, action.detail, now);" server/src/update/converge.ts
  grep -n "hold. writes nothing" server/src/update/dispatch.ts
  grep -n "from '../src/update/dispatch.js'" server/test/update-converge.test.ts
  grep -n "a dropped link or a timeout" README.md
  ```
  - Expected at `af5a29f8`: dispatch.ts `:323`, `:325` and `:353`; converge.ts `:145`, `:155`, `:203` and `:245`; update-op-answer.test.ts `:97` and `:102`; converge.ts `:275` and `:314`; update-converge.test.ts `:27`; README `:652`.
  - No other file builds an `OpAnswer` transport literal. If one does, it gains `reached` in this task.
- [ ] **Step 2: Write the failing tests.**
  - **`update-op-answer.test.ts`**, replacing `:96-104` (`it.each(['disconnected', 'timeout', 'aborted'] …` and `it('other carries its own message …'`):
    - `it.each(['disconnected', 'timeout', 'aborted'] as const)('%s that never reached the link releases idle — the op never left, so the request stands')`: `classifyOpAnswer({ kind: 'transport', why, message: why, reached: 'never' }, true)` equals `{ kind: 'release', to: 'idle', detail: \`${why} — the op never reached the fleet link; the request stands\` }`.
    - `other` with `reached: 'never'` and message `'EPIPE\nstack'` → `{ kind: 'release', to: 'idle', detail: 'other — EPIPE; the request stands' }`. Unchanged: it is the server-role local arm's shape, pinned also by `update-local-spawn-throw.test.ts`.
    - `it.each([true, false])` over `advertised`, and over all four `why`, with `reached: 'maybe'` → `{ kind: 'hold', detail: linkFailedHoldDetail(why, message) }`. The literal spelled out for `timeout` is `link failed mid-op (timeout) — the op reached the fleet link and no answer came back, so the node may have started the run; the lease holds until its report or the deadline`. For `other` with `'EPIPE\nstack'` it begins `link failed mid-op (other: EPIPE) — `.
    - A `maybe` `other` whose message is 5000 characters yields a detail of at most `UPDATE_OP_DETAIL_MAX` that still begins with `LINK_FAILED_HOLD_PREFIX`.
    - Unit cases for `linkFailedDeadlineDetail`:
      - `{ updateDetail: linkFailedHoldDetail('timeout', 'timeout'), updateTarget: 'v0.0.10', reportedTarget: null }` → `deadline — the fleet link failed mid-op; the row's last report does not name v0.0.10` (fix round 1, review 178 F1);
      - `reportedTarget: 'v0.0.9'` → the same;
      - `reportedTarget: 'v0.0.10'` → `deadline — the fleet link failed mid-op; the row's last report names v0.0.10, which may be an earlier run's`;
      - `updateDetail: 'accepted — the node queued a detached run'` → `null`;
      - `updateDetail: null` → `null`;
      - `updateTarget: null` → `null`.
  - **`update-converge.test.ts`, rewriting `:381-396`** as `a link that failed BEFORE the frame was handed (LinkNotSentError) → idle, the request standing; not sent while the sweep says unreachable; sent again once measured reachable (D-3555)`.
    - It has the same body with `throw new LinkNotSentError('disconnected')`.
    - The expected detail is `'disconnected — the op never reached the fleet link; the request stands'`.
  - **Rewriting `:398-416`** as `a send that timed out after the frame was handed HOLDS the lease; the detached run's own report of the tag settles it and clears the request, and nothing is sent twice (Review Focus 1, D-3555)`:
    1. `send` throws `new Error('timeout')`, and `seedFleet(h)` runs.
    2. The first run's outcome is `{ nodeId: FLEET_ID, result: 'held' }`. The row is `pending`, its `updateDetail` is `linkFailedHoldDetail('timeout', 'timeout')`, and its `requestedTag` is `'v0.0.10'`. `h.accepted()` is 1.
    3. `sweepOnce(h.store, fleetMeas({ currentVersion: 'v0.0.10', highestVersion: 'v0.0.10', measuredAt: T0 + 60_000, report: { phase: 'done', target: 'v0.0.10', startedAt: T0 + 6000, updatedAt: T0 + 50_000, detail: null } }))` gives `.lease.kind` `'settle'`.
    4. The row is `{ updateState: 'idle', updateDetail: 'done: v0.0.10', requestedTag: null }`.
    5. A run at `T0 + 61_000` sends nothing (`h.sent` length 1).
  - **Appended describe** `runDispatch — a fleet-link failure after the op was handed holds the lease, and only a report or the deadline ends it (D-3555, residue R1)`:
    1. **Every post-send failure holds.** `it.each` over `[new Error('timeout'), new Error('disconnected'), new Error('aborted'), new Error('EPIPE'), 'not an Error at all']`.
       - The first run's outcome is `result: 'held'`. The row is `pending` with `updateDetail.startsWith(\`${LINK_FAILED_HOLD_PREFIX} (\`)`, the request stands, `h.accepted()` is 1 and `h.sent` has length 1.
       - The `'EPIPE'` and string rows read `(other: …)`.
    2. **The one-lease invariant (the class-1 pin).**
       - `seedFleet(h)` and `seedServer(h)`; the fleet op throws `new Error('timeout')`.
       - `sweepOnce` then measures the fleet node AT `v0.0.10` with NO report (the shape of a node whose run finished while its link was down).
       - Runs at `T0 + 121_000` and `T0 + 181_000` each read `settled` `[]` and `plan.gate.leaseHeldBy` `FLEET_ID`. The fleet row stays `pending` and `h.spawned` stays `[]`: no `met` settle, and no server move beside the fleet box's possibly-live run.
    3. **A report naming another tag never settles it.** After a timeout hold, `sweepOnce` with `report: { phase: 'installing', target: 'v0.0.9', startedAt: T0 + 2000, updatedAt: T0 + 3000, detail: null }` gives `lease` `{ kind: 'none', why: 'stale-report' }`, and the row stays `pending`.
    4. **Words at the deadline, and they halt.**
       - Timeout hold at `T0 + 1000`, no report at all, server requested.
       - At `T0 + 1000 + DEADLINE - 1`: `expired` `[]`, and the row is `pending`.
       - At `T0 + 1000 + DEADLINE + 1`: `expired` `[FLEET_ID]`. The row is `{ updateState: 'failed', updateDetail: "deadline — the fleet link failed mid-op; the row's last report does not name v0.0.10" (fix round 1, review 178 F1), requestedTag: 'v0.0.10' }`, `plan.gate.haltedBy` is `[FLEET_ID]`, and `h.spawned` is `[]`.
       - `h.store.ackNode(FLEET_ID).ok` is `true`, and the row then reads `idle`, its request cleared: the operator's exit, and the cost stated in the deviation.
    5. **The same words after another tag's report.** Case 3's stale report, then the deadline measured from that report's `updatedAt` (`deadlineExpired`'s later-of rule), gives the same `deadline — the fleet link failed mid-op; the row's last report does not name v0.0.10` (fix round 1, review 178 F1).
    6. **A report of the tag on the row gets the qualified words.** After a timeout hold, `sweepOnce` with `report: { phase: 'installing', target: 'v0.0.10', … }` gives `in-flight`. Past the deadline from that report, the row fails with `deadline — the fleet link failed mid-op; the row's last report names v0.0.10, which may be an earlier run's`, halting.
    7. **A later writer's report replaces this run's own (fix round 1, review 178 F1, case i).** After the timeout hold, a genuine in-flight report of THIS lease's own target (`installing v0.0.10`) is followed by a LATER sweep's `done v0.0.9` from another writer — a stale report that overwrites the row's `reportedTarget`. Past the deadline the row still reads the "does not name" sentence (case 1's words), never "was reported": the row's last report is honestly v0.0.9, whatever a report of v0.0.10 said in between.
    8. **D-3214's `stamp-unmeasured` override writes a previous report back over a genuine one (fix round 1, review 178 F1, case ii).** A row already holding `done v0.0.9` acquires the lease for v0.0.10 and holds after a link failure. The node's `update.json` now says `done v0.0.10` — a genuine report of this run — but its build stamp cannot be read on that sweep, so `applyMeasurement`'s override (`inventory.ts:603-605`) restores the row's own previous report instead of storing the new one: `reportedTarget` stays v0.0.9. Past the deadline the row still reads the "does not name" sentence, never "was reported". Built through the real `sweepInventory`/`sweepPlanFor` paths and the store's own writers (never a literal `linkFailedDeadlineDetail` input), because this file's own `sweepOnce` shortcut deliberately skips the override.
- [ ] **Step 3: Run to verify they fail.**
  ```bash
  cd server && ./node_modules/.bin/vitest run test/update-op-answer.test.ts test/update-converge.test.ts
  ```
  Expected: FAIL. The compile errors come first (`reached`, `linkFailedHoldDetail`, `LINK_FAILED_HOLD_PREFIX`). Then every hold case reads `released`/`idle`, and the deadline cases read `deadline`.
- [ ] **Step 4: Implement.**
  - **`dispatch.ts`:**
    - the `OpAnswer` line as in Interfaces; `AnswerAction`'s docstring as in Files;
    - the `classifyOpAnswer` docstring sentence reworded to name both arms ("a transport failure that NEVER reached the agent releases the lease `idle` … one that MAY have reached it holds, D-3555");
    - the transport arm:
    ```ts
      if (a.kind === 'transport') {
        // D-3555: a failure after the op was handed to the link may follow a spawn, so the lease HOLDS
        // like `accepted`; only a failure proven before the hand-off releases, and the request stands.
        if (a.reached === 'maybe') return { kind: 'hold', detail: linkFailedHoldDetail(a.why, a.message) };
        const what = a.why === 'other' ? said(a.message, 'no message') : 'the op never reached the fleet link';
        return { kind: 'release', to: 'idle', detail: `${a.why} — ${what}; the request stands` };
      }
    ```
    - then append the four exports from Interfaces. `linkFailedDeadlineDetail` returns `null` unless `row.updateDetail?.startsWith(\`${LINK_FAILED_HOLD_PREFIX} (\`) === true && row.updateTarget !== null`; then it returns the "the row's last report does not name …" sentence (fix round 1, review 178 F1 — corrected from "no run … was reported") when `row.reportedTarget !== row.updateTarget`, and the qualified sentence otherwise.
  - **`converge.ts`:**
    - `linkAnswer`'s no-link return (`:145`) gains `reached: 'never'`. Its catch becomes:
    ```ts
      } catch (e) {
        if (e instanceof AgentOpError) return { kind: 'refused', err: e.code, detail: e.detail };
        const message = e instanceof Error ? e.message : String(e);
        // D-3555: only the client's positive marker proves the frame never left; anything else — a
        // timeout, a close or abort after the send, a rejection this build cannot name — MAY have reached the agent.
        return { kind: 'transport', why: transportWhy(message), message, reached: e instanceof LinkNotSentError ? 'never' : 'maybe' };
      }
    ```
    - `localAnswer`'s `:203` and `:245` returns gain `reached: 'never'`. Nothing started on either: no runner, or a spawn that threw inside the runner's executor (Task 4's premise).
    - The deadline sweep `:275` becomes `if (store.releaseLease(row.nodeId, 'failed', linkFailedDeadlineDetail(row) ?? deadlineDetail(row, ownReport), null).ok) expired.push(row.nodeId);`. `row` is a `NodeRow`, which carries `reportedTarget`, so it satisfies `LinkHoldRow` structurally.
    - The hold arm:
    ```ts
      if (action.kind === 'hold') {
        // D-3413: the bound's arms B/D carry the node's words; D-3555: a link failure after the hand-off
        // carries the server's. Either is written on the lease this run acquired (`now`, its identity); a refused note
        // is silent (a report settled the row first, or a newer lease).
        if ((answer.kind === 'accepted' && answer.detail !== undefined) || answer.kind === 'transport') {
          store.noteLeaseDetail(move.nodeId, action.detail, now);
        }
        deps.onAccepted();
        return done({ nodeId: move.nodeId, result: answer.kind === 'transport' ? 'held' : 'accepted', detail: action.detail });
      }
    ```
    (Task 3 retargets both `move.nodeId`s here to the holder.)
  - **`README.md` `:652-653`.** Replace "— `busy`, a dropped link or a timeout returns the row to `idle` for a later sweep, while" with words saying: `busy`, or a link that was down before the op left the server, returns the row to `idle`; a link that fails AFTER the op was handed to it holds the lease until the node's own report of the run settles it or the deadline fails it, because the node may already have started the run. Reflow only this paragraph (`:630-660`) so `wc -l README.md` is unchanged and `git diff --numstat -- README.md` shows equal counts.
  - **The wave 5 plan's D-3400 (`:91`).** Append to the sentence beginning "WHAT THIS AMENDMENT DID NOT REMOVE" (after "…so a second node can move).") the text: `CLOSED by D-3555 (residue R1, 2026-09-29): a link failure after the op frame was handed to the link now HOLDS the lease to the node's own report or the deadline; only a failure proven before the hand-off (the client's LinkNotSentError) releases idle.` It is one line, in place.
- [ ] **Step 5: Run to verify they pass.** One command per call:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/update-op-answer.test.ts test/update-converge.test.ts
  cd server && ./node_modules/.bin/vitest run test/update-killed-arms.test.ts test/update-local-spawn-throw.test.ts test/update-auto-dispatch.test.ts test/update-routes.test.ts test/update-apply-routes.test.ts test/update-watchdog-revert.test.ts test/update-dispatch.test.ts
  cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
  cd server && ./node_modules/.bin/tsc --noEmit; echo "exit $?"
  wc -l README.md
  ```
  - Expected: PASS, `exit 0`, and 3505, or Step 1's number if wave 6 moved it.
  - `session-hook` runs under the DEFAULT `TMPDIR` (its "skips a scratch slug" case fails under a non-default one; measured by wave 5's gate). It covers README's line citations.
- [ ] **Step 6: Mutation measurement.** Same procedure as Task 1 (a `cp` to `$SCRATCH`, edit, run the two Step 3 files, `cp` back, `cmp`). Record the counts.
- [ ] **Step 7: Commit.** `git add server/src/update/dispatch.ts server/src/update/converge.ts server/test/update-op-answer.test.ts server/test/update-converge.test.ts README.md docs/superpowers/plans/2026-09-23-centralised-update-w5-convergence.md docs/superpowers/plans/2026-09-29-centralised-update-residue-before-stable.md`, then `git commit -m "feat(update): a fleet-link failure after the hand-off holds the lease to a report or the deadline (residue R1)"`. This commit completes the entry Task 1 defined, with the Task 1–2 counts.

**Mutation table (Task 2):**

| # | Guard | Mutation | Must red | Measured |
|---|---|---|---|---|
| M1 | a `maybe` holds | `dispatch.ts`: drop the `if (a.reached === 'maybe') return { kind: 'hold', … }` line (every transport releases idle, today's behaviour) | op-answer `maybe` rows; converge describe cases 1, 2, 4, 5, 6; the rewritten `:398` case | 19 failed (8 op-answer `maybe` rows, 4 `why` × 2 `advertised` + 11 converge tests: the rewritten `:398` case and all 10 in the appended describe, incl. case 3's fallout — the row's state change under the mutation also breaks the case-3 stale-report assertion, over-coverage beyond the table's minimum) |
| M2 | only the marker is "never" | `converge.ts` `linkAnswer`: `reached: 'never'` for every non-`AgentOpError` | the same converge cases as M1 | 11 failed (the rewritten `:398` case, and all 10 tests in the appended describe — op-answer unaffected since this mutation is converge.ts-only) |
| M3 | the marker releases | `converge.ts` `linkAnswer`: `reached: 'maybe'` for every rejection | the rewritten `:381` case | 1 failed (exactly the rewritten `:381` `LinkNotSentError` case) |
| M4 | the hold's words are written | `converge.ts`: drop `\|\| answer.kind === 'transport'` from the note condition | case 1's `updateDetail`; cases 4, 5, 6 (the words fall back to `deadline`) | 9 failed (case 1's 5 `why` rows + cases 4, 5, 6 + the rewritten `:398` case) |
| M5 | the deadline reads the hold | `converge.ts:275`: drop `linkFailedDeadlineDetail(row) ??` | cases 4, 5, 6 | 3 failed (exactly cases 4, 5, 6) |
| M6 | "the row's last report does not name …" (fix round 1, review 178 F1 — was "no run … was reported") only where true | `linkFailedDeadlineDetail`: always return the "does not name" sentence (drop the `reportedTarget` branch) | case 6; the op-answer `reportedTarget: 'v0.0.10'` row | 2 failed (exactly case 6 + the op-answer `reportedTarget: 'v0.0.10'` row) |
| M7 | only a link-failure hold gets the sentence (control) | `linkFailedDeadlineDetail`: drop the prefix test | the existing `a lease whose node never wrote a report … fails \`deadline\`` case (`update-converge.test.ts:494`); the op-answer `accepted —` row | 3 failed (the `:494` case, the op-answer `accepted —` row, and the op-answer null-detail row the same dropped guard also stops catching) |
| M8 | the not-sent words are true | `dispatch.ts`: `'the op never reached the fleet link'` → `'the node dropped mid-dispatch'` | the op-answer `never` rows; the rewritten `:381` case | 4 failed (the 3 op-answer `never` rows + the rewritten `:381` case) |

### Task 3: The answer follows the lease, not the node id (R5)

**Files:**
- Modify: `server/src/update/dispatch.ts` — `leaseHolder`, APPENDED after Task 2's exports.
- Modify: `server/src/update/converge.ts`:
  - the import from `'./dispatch.js'` gains `leaseHolder` in place;
  - in `runDispatch`, directly after `const action = classifyOpAnswer(answer, advertised);` (`:309`), one holder line. The hold arm's note, its `done` nodeId, the release `:318` and both `done` returns after it target `holder`; the release passes `now` as `expectedStartedAt`.
- Modify: `docs/superpowers/plans/2026-09-23-centralised-update-w5-convergence.md` — D-3412 (`:107`), amended in place.
- Test: `server/test/update-lease-holder.test.ts` (create). This is a new file, so no import line is added to `update-dispatch.test.ts`, whose four-specifier assertion stays as is.
- Test: `server/test/update-converge.test.ts` — one describe appended, declaring its own `FLEET_ID2` at describe level.

**Interfaces:**
```ts
/** R5 (review 176 F1; D-3412 amended): the LIVE row that holds the lease a dispatch run acquired — the same `label`, the
 *  same `updateStartedAt` (the acquire's `now`, which `handOffLease` copies onto a revived heir), still busy. A revive
 *  during the op hands the lease to the heir, so the heir is found here and the retired donor (not live) is not. `null`
 *  unless EXACTLY one row matches — none (a report or the deadline settled it first, or R2's no-revive supersede dropped
 *  it) or two (a state the one-lease invariant forbids) — and the caller then writes to the id it acquired, whose own
 *  guards name what happened. `rows` are `nodes()`'s: live rows only. */
export function leaseHolder(
  rows: readonly Pick<DispatchRow, 'nodeId' | 'label' | 'updateState' | 'updateStartedAt'>[], label: string, startedAt: number,
): string | null;
//   const held = rows.filter((r) => r.label === label && r.updateStartedAt === startedAt && !isSettled(r.updateState));
//   return held.length === 1 ? held[0]!.nodeId : null;
```

- [ ] **Step 1: Re-measure.**
  ```bash
  grep -n "const released = store.releaseLease(move.nodeId, action.to, action.detail, null);" server/src/update/converge.ts
  grep -n "if (revived) this.leaseFollowsLabel(label, nodeId, donor === undefined ? null : donor.nodeId);\|if (donorId !== null && this.handOffLease(donorId, nodeId).ok) return;\|'updateStartedAt = f.updateStartedAt, updateDetail = f.updateDetail FROM nodes f '\|'AND (? IS NULL OR updateStartedAt IS NULL OR updateStartedAt IS ?)'" server/src/coord/store.ts
  grep -n "const FLEET_ID2" server/test/update-converge.test.ts
  ```
  - Expected at `af5a29f8`: converge.ts `:318`; store.ts `:6350`, `:6371`, `:6403` and `:6621`; `FLEET_ID2` at `:223` and `:254` only (case-local).
  - `:6621` is the proof that the heir inherits `updateStartedAt`, which is what makes `(label, updateStartedAt)` the lease's identity. `:6403` is `releaseLease`'s identity clause; its refusal order (`unknown-node`, `superseded`, `not-busy`, then the identity refusal, `:6405-6412`) means a settled row still answers `not-busy` with `expectedStartedAt` set.
- [ ] **Step 2: Write the failing tests.**
  - **`update-lease-holder.test.ts`**, over plain `Pick` rows:
    - (a) one live busy row with the label and the time → its id;
    - (b) a row with another label and the same time, busy, beside a matching row → the matching one;
    - (c) the same label with another time, busy → `null`;
    - (d) the same label and time but `idle`, and separately `failed` → `null`;
    - (e) `unknown` (busy, out of vocabulary) → its id;
    - (f) two matching busy rows → `null`;
    - (g) no rows → `null`.
  - **`update-converge.test.ts`, appended describe** `runDispatch — a revive during the op hands the lease to the heir, and the answer lands on the heir (residue R5, review 176 F1)`, with `const FLEET_ID2 = '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e';` at describe level.
    - **The reviewer's interleaving, per case:**
      1. `seedFleet(h, null)` gives U1 = `FLEET_ID`, idle, with no request.
      2. `h.store.rekeyNode(FLEET_LABEL, FLEET_ID2)` gives `{ ok: true, retired: 1, revived: false }`.
      3. `upsertNodeMeasurement(fleetMeas({ nodeId: FLEET_ID2 }))`, then `requestNode(FLEET_ID2, 'v0.0.10', 'update', T0)`.
      4. The harness's `send` first calls `h.store.rekeyNode(FLEET_LABEL, FLEET_ID)` and asserts `{ ok: true, revived: true }`. It then asserts that exactly one live busy row exists and that it is `FLEET_ID`, holding `updateStartedAt` `T0 + 1000`. Then it answers the case's word. Build it with a holder object (`const box: { h?: Harness } = {}`) so the closure can reach `h`.
      5. `runDispatch(h.deps, T0 + 1000)`.
    - **Every release word** (`it.each`), with the expected `to` and detail:

      | Answer | `to` | Detail |
      |---|---|---|
      | `AgentOpError('busy', IN_FLIGHT)` | `idle` | `busy — ${IN_FLIGHT}` |
      | `AgentOpError('not-queued', 'stopped before it queued anything')` | `idle` | `not-queued — stopped before it queued anything` |
      | `AgentOpError('spawn-failed', 'boom')` | `failed` | `spawn-failed — boom` |
      | `AgentOpError('bad-tag', null)` | `failed` | `agent refused the op: bad-tag` |
      | `AgentOpError('bad-kind', null)` | `failed` | `agent refused the op: bad-kind` |
      | `AgentOpError('bad-request', null)` | `failed` | `AGENT_REJECTED_DETAIL` |
      | `AgentOpError('forbidden', null)` | `failed` | `agent answered forbidden` |
      | an ok `{ t: 'res', id: 1, ok: true }` | `failed` | `agent answered ok-without-accepted` |
      | `LinkNotSentError('disconnected')` | `idle` | `disconnected — the op never reached the fleet link; the request stands` |

      Each case asserts:
      - the outcome is `{ nodeId: FLEET_ID, result: 'released', to, detail }`;
      - `h.store.node(FLEET_ID)` reads that state and detail;
      - no live row is busy;
      - `h.store.node(FLEET_ID2)?.supersededBy` is `FLEET_ID`;
      - a run at `T0 + 1000 + DEADLINE + 1` has `expired` `[]`, so no false `failed: deadline` follows.
    - **Every hold word** (`it.each`): an ok `{ accepted: true, detail: 'held at the bound: it queued v0.0.10' }`, and `new Error('timeout')` (Task 2's hold). Each asserts:
      - the outcome's `nodeId` is `FLEET_ID`;
      - `h.store.node(FLEET_ID)` is `pending` with the hold's words;
      - exactly one live busy row remains, and it is `FLEET_ID`.
    - **The fallback** (control): `send` sweeps a `done v0.0.10` report onto U2 BEFORE answering `busy`, with no rekey.
      - The lease is settled, so no holder exists.
      - The outcome is `{ nodeId: FLEET_ID2, result: 'release-refused', why: 'not-busy' }`, which is today's behaviour, unchanged (the settled check precedes the identity refusal, so `expectedStartedAt: now` does not change the word).
- [ ] **Step 3: Run to verify they fail.**
  ```bash
  cd server && ./node_modules/.bin/vitest run test/update-lease-holder.test.ts test/update-converge.test.ts
  ```
  - Expected: FAIL. The lease-holder file fails on the missing export.
  - Every release-word case reads `release-refused` `superseded` on `FLEET_ID2`, with `FLEET_ID` still `pending`, and at the deadline `expired` is `[FLEET_ID]`: the reviewer's F1, reproduced.
  - Every hold-word case reads the donor's detail on the heir.
- [ ] **Step 4: Implement.**
  - Append `leaseHolder`.
  - In `runDispatch`, directly after `const action = classifyOpAnswer(answer, advertised);`:
  ```ts
    // R5 (review 176 F1, D-3412 amended): the answer is written on the LEASE, found by identity — the live busy row with
    // this move's label and this run's `now` — never on the id acquired: a revive during the await hands the lease to the
    // heir. Read and written with no await between. No holder (settled, or dropped by a no-revive supersede, R2): the id
    // acquired, whose own guards name what happened.
    const holder = leaseHolder(store.nodes(), view.row.label, now) ?? move.nodeId;
  ```
  - Then `move.nodeId` becomes `holder` in:
    - the hold arm's `noteLeaseDetail` and its `done`;
    - `store.releaseLease(holder, action.to, action.detail, now)`;
    - both `done` returns after it.
  - The release now passes `now` as `expectedStartedAt`, so the identity follows the write onto the fallback path too: there, `releaseLease(move.nodeId, …)` can only release the lease THIS run acquired. On the holder path the holder was chosen by that identity in the same synchronous stretch, and today no sequence gives `move.nodeId` another lease on the fallback path (dispatch is single-flight, and `handOffLease` copies `updateStartedAt`), so the `now` cannot red: defence in depth, no pin claimed.
  - **D-3412 (`:107`), amended in place.** Append before its closing "Cost if wrong:" sentence:
    - "AMENDED 2026-09-29 (residue R5, review run 176 F1): the hand-off can land DURING an in-flight op — `runDispatch` acquires U2 and awaits the op, the inventory sweep measures node-id U1 on the same connection, and `rekeyNode` revives U1 and hands it U2's lease — and the dispatcher's post-answer write went to `move.nodeId`, so `releaseLease` answered `superseded` and U1's copy stayed `pending` for a run nobody started until a halting `failed: deadline`."
    - "The dispatcher's post-answer writes (the release, and `noteLeaseDetail`'s arms B/D and D-3555's hold words) now target the lease by identity: `leaseHolder` (L1, `update/dispatch.ts`) names the one live busy row with the acquired row's label and `updateStartedAt`, which `handOffLease` copies; with none or two, the write goes to the id acquired, as before, and the release carries the acquire's `now` as `expectedStartedAt` on either path."
    - "Not a spec departure: §10 releases \"the lease … through `releaseLease`\" and names no row. Pinned by `server/test/update-lease-holder.test.ts` and `server/test/update-converge.test.ts` (the reviewer's interleaving under every release word and every hold word, and the no-holder fallback). Mutation-measured: <this task's rows and counts>."
- [ ] **Step 5: Run to verify they pass.** One command per call:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/update-lease-holder.test.ts test/update-converge.test.ts
  cd server && ./node_modules/.bin/vitest run test/update-store-nodes.test.ts test/update-killed-arms.test.ts test/update-store-lease-detail.test.ts test/update-writer-groups.test.ts test/update-dispatch.test.ts
  cd server && ./node_modules/.bin/tsc --noEmit; echo "exit $?"
  ```
  - Expected: PASS and `exit 0`.
  - `update-store-nodes`' 27-store differential case timed out once under load in review 176 and passed in isolation. Re-run it alone before calling it a break.
- [ ] **Step 6: Mutation measurement**, as before. Record the counts.
- [ ] **Step 7: Commit.** `git add server/src/update/dispatch.ts server/src/update/converge.ts server/test/update-lease-holder.test.ts server/test/update-converge.test.ts docs/superpowers/plans/2026-09-23-centralised-update-w5-convergence.md docs/superpowers/plans/2026-09-29-centralised-update-residue-before-stable.md`, then `git commit -m "fix(update): the op's answer is written on the lease a revive handed on, not the id acquired (residue R5)"`.

**Mutation table (Task 3):**

| # | Guard | Mutation | Must red | Measured |
|---|---|---|---|---|
| M1 | the release follows the lease | `converge.ts`: `store.releaseLease(holder, …)` → `store.releaseLease(move.nodeId, …)` | every release-word case | 9 failed (all 9 release-word cases) |
| M2 | the hold's words follow the lease | `converge.ts`: `noteLeaseDetail(holder, …)` → `noteLeaseDetail(move.nodeId, …)` | both hold-word cases | 2 failed (both hold-word cases) |
| M3 | the holder is resolved at all | `converge.ts`: `const holder = move.nodeId;` | every release-word and hold-word case | 11 failed (all 9 release-word + both hold-word cases) |
| M4 | the fallback stands | `converge.ts`: `?? move.nodeId` → `!` (a non-null assertion) | the fallback case (`unknown-node`, not `not-busy`) | 1 failed (the fallback case only; `why` read `unknown-node`), 77 passed |
| M5 | identity includes the label | `leaseHolder`: drop `r.label === label` | lease-holder (b) | 1 failed (case (b) only), 77 passed |
| M6 | identity includes the lease's time | `leaseHolder`: drop `r.updateStartedAt === startedAt` | lease-holder (c) | 1 failed (case (c) only), 77 passed |
| M7 | only a busy row holds | `leaseHolder`: drop `!isSettled(r.updateState)` | lease-holder (d) | 1 failed (case (d) only), 77 passed |
| M8 | exactly one, never a guess | `leaseHolder`: `held.length === 1` → `held.length >= 1` | lease-holder (f) | 1 failed (case (f) only), 77 passed |
| — | the release's `expectedStartedAt: now` | `now` → `null` | nothing: defence in depth, no sequence reaches it; no pin claimed | n/a |

### Task 4: Item 9's premise, the watchdog box's tmux and gh, wave 5's stale snippets, the glossary (R6) — then the gate and the PR

**Files:**
- Modify: `server/src/update/converge.ts` — `localAnswer`'s item-9 comment (`:216-218`) and the rejected arm's catch (`:244-245`, comment only).
- Modify: `server/test/update-local-spawn-throw.test.ts`:
  - the header (`:1-4`);
  - the case at `:40-51` (`it('a REJECTED promise from the runner stays non-halting transport \`other\` …'`);
  - two premise cases appended inside its describe.
- Modify: `server/test/update-watchdog-revert.test.ts`:
  - `watchdogBox` (`:254-265`) plants `tmux` and `gh`;
  - `expectContained` (`:305-310`);
  - two control cases in the file's real-sequence describe;
  - the containment paragraph of the header (`:9-16`).
- Modify: `shared/api.ts` — the glossary comment above `UPDATE_STORE_REFUSE_CODES`: `not-busy` (`:8641`), `stale-report` (`:8642-8646`), and a new `no-lease-to-hand` gloss after `not-idle` (`:8680-8682`). It is comment-only and below `:7672`.
- Test: `server/test/update-store-refuse-glossary.test.ts` (create).
- Modify: `docs/superpowers/plans/2026-09-23-centralised-update-w5-convergence.md`:
  - D-3400's ITEM 9 sentence (`:91`);
  - Task 2's snippets at `:1173-1181`, `:1630-1656` and `:1712-1713` (measured at `af5a29f8`, the same lines as review 176 cites at `325d4072`).
- Modify: this plan: every mutation count, measured.

**The corrections, measured at `af5a29f8`:**

- **F2, item 9's premise.**
  - `converge.ts:216-218` reads "It is NOT the rejected-promise arm below, where a transient spawn error lands and the request simply stands."
  - `update-local-spawn-throw.test.ts:3-4` reads "a rejected promise from the runner (where a transient spawn error lands) stays non-halting transport `other`".
  - Its fixture at `:42` is `Promise.reject(new Error('spawn EAGAIN: resource temporarily unavailable'))`.
  - D-3400's ITEM 9 reads "while a REJECTED promise from the runner (where a transient spawn error lands) stays non-halting transport `other`".
  - The truth: `boundedUpdateSpawn` (`spawn.ts:42`, `const child = spawn(file, [...args], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env });`, inside the `new Promise((resolve) => …)` executor at `:33`) answers an `error` event on a child that has no pid (`:89-96`) as `{ code: 1, stderr: \`could not start the launcher (${…})\`, pid: null }`. `localAnswer` maps that to a HALTING `spawn-failed` (`converge.ts:242-243`).
  - Node delivers EACCES, EAGAIN, EMFILE, ENFILE and ENOENT through that event. Only an errno `child_process.spawn` THROWS inside the runner's promise executor rejects it. Measured on this box's node v24.14.1 by `node -e`: a 3 MiB single argument threw `E2BIG` synchronously; an argument with a NUL byte threw `ERR_INVALID_ARG_VALUE` synchronously; a missing file emitted `error` `ENOENT` asynchronously with `pid` undefined. ENOMEM is in the synchronous set too.
  - Nothing starts on the rejected arm, so its non-halting release with the request standing is right. Only the premise and the example are wrong.
- **F3.** `expectContained`'s `expect(existsSync(join(home, 'tmux-argv'))).toBe(false);` (`:309`) can never red. No case plants a recording `tmux`, and the contained PATH resolves the real `/usr/bin/tmux`, whose socket is not under HOME. `gh` is the same, and so are `ssh` and `loginctl`, which the ruling does not name and this task does not add.
- **F4.** The wave 5 plan's Task 2 snippets still show the pre-fix mapping:
  - `:1630-1634`: `const inFlight = readInFlightReport(home); if (inFlight !== null) { send(ws, failUpdate(req.id, 'busy', …` answers busy with no writer-liveness check;
  - `:1655-1656`: `if (spawned.code !== 0) { send(ws, failUpdate(req.id, 'spawn-failed', firstStderrLine(spawned.stderr)));` has no lock-prefix busy arm;
  - `:1650-1653`: the killed block still sends `spawn-failed` under its correction marker;
  - `:1712-1713`: the `readInFlightReport` docstring's "a held lock comes back as `spawn-failed` with the lock's sentence";
  - `:1176-1181`: `it('a parent killed at the bound is spawn-failed naming the timeout (Review Focus 4)'`.
  - The shipped texts are `agent/src/server.ts:639-692` (from `      const home = ctx.cfg.home;` through `      send(ws, ok(req.id, { accepted: true }));`), `agent/src/server.ts:939-941`, and `agent/test/update-op.test.ts:221-230`.
- **F5.** The glossary (`shared/api.ts:8627-8682`) has no line for `no-lease-to-hand`. The array appends it at `:8689`, and its meaning is at `store.ts:441-444`.
  - `not-busy` is glossed only as "`releaseLease` on a settled row: there is no lease". `noteLeaseDetail` returns it too (`store.ts:434-436`): a report or the deadline settled the row first.
  - `stale-report` is glossed as a report "whose run began before the lease (even the last ms its whole-second `startedAt` covers …)". That is the clock rule D-3405 removed (`releaseLease`'s docstring, `store.ts:6380-6398`: "never a report's own `startedAt` (W4 review 155, C33, D-3405)"). Today it is the identity guard's refusal in `releaseLease`/`settleNode`, where the row's `updateStartedAt` moved on since the caller read it, and `noteLeaseDetail`'s, where the row holds a newer lease than the one the caller acquired (D-3413).

- [ ] **Step 1: Re-measure** every quote above on the tip by `grep -n`, and record the tip's lines. A snippet already corrected on arrival (wave 6 does not touch this plan, so none should be) is reported as closed and gets no edit. Also `grep -n "tmux\|\bgh\b" ccd/ccrc` on the tip, and report whether a merged wave-6 `ccd/ccrc` now calls either (it raises the stakes of Global Constraints' M4/M5 rule, and changes nothing else here).
- [ ] **Step 2: Pins first, red first.**
  - **`update-local-spawn-throw.test.ts`:**
    - Rewrite the `:40-51` case as `a REJECTED promise from the runner — reached only by an errno spawn() throws synchronously — stays non-halting transport \`other\`: idle, the request standing`, with the fixture `() => Promise.reject(Object.assign(new Error('spawn E2BIG'), { code: 'E2BIG', syscall: 'spawn' }))` and the detail `'other — spawn E2BIG; the request stands'`.
    - Append two premise cases on the REAL runner, contained: nothing runs, because a missing file never starts, and an E2BIG never execs.
      - (a) `await boundedUpdateSpawn('/nonexistent-ccrc-launcher', [], { env: { PATH: '/nonexistent' } })` equals `{ code: 1, stdout: '', stderr: 'could not start the launcher (ENOENT)', killed: false, pid: null }`. Then `runDispatch` over a server row whose `runLocal` is `() => boundedUpdateSpawn('/nonexistent-ccrc-launcher', [], { env: { PATH: '/nonexistent' } })` releases `failed` with `spawn-failed — could not start the launcher (ENOENT)`, and the next run's `plan.gate.haltedBy` is `[SERVER_ID]`. The errno class the old premise called non-halting HALTS.
      - (b) `await expect(boundedUpdateSpawn('/bin/true', ['x'.repeat(3 * 1024 * 1024)], { env: { PATH: '/nonexistent' } })).rejects.toMatchObject({ code: 'E2BIG' })`: the synchronous arm is the one that rejects.
      - If the macOS runner answers differently for (b), mark it `itLinux` with the `PLATFORM-ONLY` note `macos-platform.test.ts`'s D-2765 census demands. Wave 5's gate caught three missing notes this way.
  - **`update-watchdog-revert.test.ts`:**
    - In `watchdogBox`, after the `df` plant, add:
      ```ts
      plant(join(home, 'bin', 'tmux'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/tmux-argv"\nexit 97\n');
      plant(join(home, 'bin', 'gh'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/gh-argv"\nexit 97\n');
      ```
    - `expectContained` gains `expect(existsSync(join(home, 'gh-argv')), 'a rollback reached gh (poisoned, recording)').toBe(false);`, and its tmux line gains the message `'a rollback reached tmux (poisoned, recording)'`.
    - Add two control cases, `itLinux` like their siblings:
      - `the watchdog box resolves tmux and gh to its own poisoned recorders first (the containment lines above can red)`. It runs `spawnSync('/bin/sh', ['-c', 'command -v tmux; command -v gh'], { env: box.env, encoding: 'utf8' })` and expects stdout to equal `${join(box.home, 'bin', 'tmux')}\n${join(box.home, 'bin', 'gh')}\n`. `command -v` executes neither binary.
      - `a call that reaches a recorder is what expectContained reds on`. It runs each recorder by its ABSOLUTE planted path (`spawnSync(join(box.home, 'bin', 'tmux'), ['probe'], { env: box.env })`, and the same for `gh`), then asserts `tmux-argv` and `gh-argv` exist under `box.home` and that `expect(() => expectContained(box.home)).toThrow(/poisoned, recording/)`. Nothing resolves through PATH here, so no mutation can make it run a real binary.
    - The header's containment paragraph (`:9-16`) gains one sentence naming the two poisoned recorders and the rule that a plant-removing mutation runs only these controls.
  - **`update-store-refuse-glossary.test.ts`:** it reads `shared/api.ts` as text, takes the doc comment directly above `export const UPDATE_STORE_REFUSE_CODES = [`, and asserts that for every word in `UPDATE_STORE_REFUSE_CODES` (imported, never re-typed) a line matches `^ \*    <word> +— ` (the glossary's own indentation and dash, as measured at `:8627`). The file's header says what it proves: every word HAS a gloss, not that the gloss is true; the meanings are reviewed, not scanned.
  - Run each new or rewritten case against the unmutated tree:
    ```bash
    cd server && ./node_modules/.bin/vitest run test/update-local-spawn-throw.test.ts test/update-watchdog-revert.test.ts test/update-store-refuse-glossary.test.ts
    ```
    - Expected: the glossary file FAILS on `no-lease-to-hand` alone. That is its red-first, measured before Step 3.
    - The rest are green: the premise cases pin today's behaviour, and the controls are green once the plants exist. Their reds are the mutation rows below.
- [ ] **Step 3: Prose.**
  - **`converge.ts:216-218`.** The third line becomes: "It is NOT the rejected-promise arm below. That arm is reached only by an errno `child_process.spawn` throws synchronously inside the runner's executor (E2BIG, ENOMEM, an invalid argument), and nothing started there; EAGAIN, EMFILE, ENFILE, EACCES and ENOENT arrive as the child's `error` event, which the runner answers as code 1 `could not start the launcher (<code>)` — a halting `spawn-failed` below (residue R6, review 176 F2)." The catch at `:244` gains one comment line naming the same.
  - **`update-local-spawn-throw.test.ts:1-4`.** Rewritten to the same truth.
  - **D-3400's ITEM 9 sentence (`:91`), in place.** Replace "while a REJECTED promise from the runner (where a transient spawn error lands) stays non-halting transport `other`" with "while a REJECTED promise from the runner stays non-halting transport `other` (CORRECTED 2026-09-29, residue R6 / review 176 F2: a transient spawn errno does NOT land there — Node reports EAGAIN, EMFILE, ENFILE, EACCES and ENOENT through the child's `error` event, which the bounded runner answers as code 1 `could not start the launcher (<code>)`, a HALTING `spawn-failed`; only an errno `spawn` throws synchronously inside the runner's executor, E2BIG or ENOMEM, rejects, and nothing started there)". The sentence's pin list also names the two premise cases.
  - **The wave 5 plan's Task 2 snippets.** Replace:
    - the handler block from `      const home = ctx.cfg.home;` to `      send(ws, ok(req.id, { accepted: true }));` (`:1629-1659`) with `agent/src/server.ts:639-692` verbatim;
    - the docstring's two lines (`:1712-1713`) with `agent/src/server.ts:939-941` verbatim;
    - the test snippet `:1174-1181` with `agent/test/update-op.test.ts:221-230` verbatim.

    Keep each block's fence and its surrounding prose. Measured: nothing cites that plan by line (`grep -rn "w5-convergence.md:[0-9]"` over the tree finds nothing), so its line counts may change.
  - **`shared/api.ts` glossary.**
    - `not-busy`: "`releaseLease`, `noteLeaseDetail` on a settled row: there is no lease (for the note, a report or the deadline settled it first, and its verdict is not the dispatcher's to overwrite)."
    - `stale-report`: "the identity guard refused: `releaseLease`/`settleNode`'s row no longer holds the `updateStartedAt` the caller read (the lease moved on), or `noteLeaseDetail`'s row holds a newer lease than the one the caller acquired (D-3413). Freshness is change plus the lease's tag, never a clock (D-3405)."
    - A new line after `not-idle`'s gloss: `no-lease-to-hand — \`handOffLease\` (D-3412): the donor is not a BUSY row of the heir's label retired TOWARD the heir (absent, live, settled, retired toward another node, or another box's row); nothing is written.`
    - Keep the `*    word — ` shape the pin reads.
- [ ] **Step 4: Run.** One command per call:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/update-local-spawn-throw.test.ts test/update-watchdog-revert.test.ts test/update-store-refuse-glossary.test.ts
  cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts test/single-definition.test.ts test/macos-platform.test.ts test/peers-claims-l0.test.ts test/update-spawn-twin-bodies.test.ts
  cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
  ```
  Expected: PASS. `session-hook` runs under the default `TMPDIR`.
- [ ] **Step 5: Mutation measurement**, as before, for every row of the table below, with each row's own run command (the table's last column). Record the counts. **M4 and M5 run ONLY the two control cases**, never the whole file: `cd server && ./node_modules/.bin/vitest run test/update-watchdog-revert.test.ts -t "recorder"` (fix round 1, review 178 F3: the old filter selected only the first control; `-t "recorder"` selects both, as the table and the PR body record). No real-sequence case runs while a plant is removed (Global Constraints).
- [ ] **Step 6: Commit.** `git add` the Files above, then `git commit -m "test(update): item 9's errno premise, the watchdog box's tmux and gh, wave 5's Task 2 snippets, the store glossary (residue R6)"`.
- [ ] **Step 7: The gate.** First `test -d agent/node_modules || (cd agent && npm ci)` and `test -d pwa/node_modules || (cd pwa && npm ci)`. Set `SHARD_TMP` to a fresh scratch directory on the box's large volume (never committed), and `SCRATCH` for the logs. Then each command in the FOREGROUND, timeout 600000 ms, one per call:
  ```bash
  cd server && TMPDIR="$SHARD_TMP" ./node_modules/.bin/vitest run --shard=1/6 2>&1 | tee "$SCRATCH/r-server-1.log"; echo "exit ${PIPESTATUS[0]}"
  cd server && TMPDIR="$SHARD_TMP" ./node_modules/.bin/vitest run --shard=2/6 2>&1 | tee "$SCRATCH/r-server-2.log"; echo "exit ${PIPESTATUS[0]}"
  cd server && TMPDIR="$SHARD_TMP" ./node_modules/.bin/vitest run --shard=3/6 2>&1 | tee "$SCRATCH/r-server-3.log"; echo "exit ${PIPESTATUS[0]}"
  cd server && TMPDIR="$SHARD_TMP" ./node_modules/.bin/vitest run --shard=4/6 2>&1 | tee "$SCRATCH/r-server-4.log"; echo "exit ${PIPESTATUS[0]}"
  cd server && TMPDIR="$SHARD_TMP" ./node_modules/.bin/vitest run --shard=5/6 2>&1 | tee "$SCRATCH/r-server-5.log"; echo "exit ${PIPESTATUS[0]}"
  cd server && TMPDIR="$SHARD_TMP" ./node_modules/.bin/vitest run --shard=6/6 2>&1 | tee "$SCRATCH/r-server-6.log"; echo "exit ${PIPESTATUS[0]}"
  cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts 2>&1 | tee "$SCRATCH/r-session-hook.log"; echo "exit ${PIPESTATUS[0]}"
  cd server && ./node_modules/.bin/tsc --noEmit; echo "exit $?"
  cd agent && ./node_modules/.bin/vitest run 2>&1 | tee "$SCRATCH/r-agent.log"; echo "exit ${PIPESTATUS[0]}"
  cd agent && ./node_modules/.bin/tsc --noEmit; echo "exit $?"
  cd pwa && ./node_modules/.bin/vitest run 2>&1 | tee "$SCRATCH/r-pwa.log"; echo "exit ${PIPESTATUS[0]}"
  git fetch origin main
  cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts; echo "exit $?"
  git diff --stat origin/main...HEAD -- ccd deploy agent '*.service' '*.timer'
  ```
  - Expected:
    - every `exit 0`, except shard K's known `session-hook` "skips a scratch slug" under a non-default `TMPDIR`, which the default-`TMPDIR` run above must show green;
    - the last command prints nothing;
    - `deviation-refs` sees exactly one new definition, the minted number, defined in this plan.
  - A red in a known load flake (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`, and `update-store-nodes`' differential) is re-run in isolation before it is called a break.
  - The counts come from the logs, never retyped: `grep -hE '^ *(Test Files|Tests) ' "$SCRATCH"/r-*.log`.
  - Every mutation row of Tasks 1–4 re-reds on the final tree for at least its M1. Re-run each task's M1 and record it.
- [ ] **Step 8: Push, PR, wave-done in the same turn.**
  - `git push`. Open the PR with `gh pr create --base main` and a body file that names R1, R5 and R6, the minted number, the measurement of `request()`, the stated cost, the Not-chosen replay, the deadline-words narrowing (confirmed by the coordinator), every mutation table with its measured counts, and the gate's counts from the logs.
  - The body ends with the attribution line this session's instructions give.
  - Mail the coordinator the wave-done fingerprint in the same turn, naming the narrowing as an open confirmation. Never end a turn to wait on CI.

**Mutation table (Task 4):**

| # | Guard | Mutation | Must red | Run | Measured |
|---|---|---|---|---|---|
| M1 | the ENOENT class halts (F2's premise) | `converge.ts` `localAnswer`: map a `could not start the launcher` stderr to `{ kind: 'transport', why: 'other', message: …, reached: 'never' }` before the `spawn-failed` return | premise case (a), the `runDispatch` half | `update-local-spawn-throw.test.ts` | RED — 1 test failed (`toMatchObject` `to: 'idle'` vs expected `'failed'`); restored, `cmp` identical |
| M2 | the runner resolves, never rejects, an `error` event | `spawn.ts`: the `child.on('error', …)` handler returns early always (answer never comes from it) | premise case (a), the runner half (it times out: record it as a red) | `update-local-spawn-throw.test.ts` | RED (timeout) — 1 test timed out at the suite's 20000 ms `testTimeout` (`Error: Test timed out in 20000ms`), recorded as a red per this row's own note; restored, `cmp` identical |
| M3 | the rejected arm stays non-halting | `converge.ts:245`: `return { kind: 'refused', err: 'spawn-failed', detail: … }` | the rewritten E2BIG-fixture case | `update-local-spawn-throw.test.ts` | RED — 1 test failed (`to: 'failed'`/`spawn-failed —` vs expected `'idle'`/`other —`); restored, `cmp` identical |
| M4 | tmux resolves to the recorder | `update-watchdog-revert.test.ts`: delete the `tmux` plant | both control cases | the two controls ONLY, by `-t` | RED — 2/2 of the `-t "recorder"` selection failed (both controls); restored, `cmp` identical. Selected by `-t "recorder"`: 2 tests (both controls), 14 skipped, 0 others — confirmed on the unmutated tree first |
| M5 | gh resolves to the recorder | `update-watchdog-revert.test.ts`: delete the `gh` plant | both control cases | the two controls ONLY, by `-t` | RED — 2/2 of the `-t "recorder"` selection failed (both controls); restored, `cmp` identical |
| M6 | every refuse word has a gloss | `shared/api.ts`: delete the `no-lease-to-hand` gloss line | the glossary test (its red-first, Step 2) | `update-store-refuse-glossary.test.ts` | RED — 1 test failed (`missing` = `['no-lease-to-hand']`); this is the same red Step 2 measured before the gloss was added. Restored, `cmp` identical |
| M7 | the gloss pin reads the array, not a copy | the glossary test's control: append `'zz-no-gloss'` to a scratch copy of the array (restored after) | the glossary test | `update-store-refuse-glossary.test.ts` | RED — 1 test failed (`missing` = `['zz-no-gloss']`), proving the test reads the live imported array, not a hardcoded copy; restored, `cmp` identical |
| M8 | only a synchronous spawn throw rejects the runner (F2's premise, runner side) | `spawn.ts:42`: wrap `spawn(...)` in `try { … } catch (e) { resolve({ code: 1, stdout: '', stderr: String(e), killed: false, pid: null }); return; }` | premise case (b) | `update-local-spawn-throw.test.ts` | RED — 1 test failed (promise resolved `{code:1,…}` instead of rejecting `E2BIG`); restored, `cmp` identical |
| M9 | expectContained's lines can red | `update-watchdog-revert.test.ts`: drop the `gh-argv` line from `expectContained` | the second control (`toThrow` on gh's recorder) | the two controls ONLY, by `-t` | RED — 1 test failed. NOTE (measured, not as originally drafted): the second control as first written called BOTH tmux and gh together before one shared `toThrow`, and under THIS mutation alone it stayed GREEN — `expectContained`'s tmux-argv check (unaffected by this mutation) still threw first, at a line the shared regex `/poisoned, recording/` could not distinguish from gh's. Measured empirically before landing. Corrected the control to call gh ALONE first (asserting gh-argv exists, tmux-argv does not, and the throw names gh specifically), then tmux — this isolates each guard so M9 reds without weakening M4/M5's coverage (re-measured RED for M4 and M5 too, 2/2 each, after the correction). Restored, `cmp` identical. **Fix round 1 (review, Important):** the SECOND (gh-alone) assertion pins the gh-argv line and was unaffected; the FIRST (tmux-then-both) assertion originally used the same generic `/poisoned, recording/` regex, which review found could not tell tmux's own line apart from gh's (tmux's check runs first and throws first when both files exist, so deleting the TMUX line left gh's message still matching — the control stayed green under that mutation, moving the blind spot from gh to tmux rather than closing it). Fixed by narrowing that regex to `/tmux \(poisoned, recording\)/`; see M9b for the mutation this closes, and the corrected comment now says truthfully which assertion pins which line |
| M9b | expectContained's tmux line can red | `update-watchdog-revert.test.ts`: drop the `tmux-argv` line from `expectContained` | the second control (`toThrow` on tmux's message) | the two controls ONLY, by `-t` | RED — 1 test failed (`expected [Function] to throw error matching /tmux \(poisoned, recording\)/ but got 'a rollback reached gh (poisoned, reco…'`). Re-measured M9 (drop gh-argv) still RED — 1 test failed, unchanged, on the fixed control — and M4/M5 (drop tmux/gh plant) still RED — 2/2 each — all under the same `-t "recorder"` selection (2 tests selected, 14 skipped, confirmed on the unmutated tree first). Restored, `cmp` identical for all four re-measurements |

M2 and M8 edit `spawn.ts`, which the agent twin must equal (`update-spawn-twin-bodies.test.ts`). Apply each to a scratch-backed copy of `server/src/update/spawn.ts` only (never the agent's), run only `update-local-spawn-throw.test.ts`, and restore it byte-identical (`cmp`) before any other run; Step 4's run of `update-spawn-twin-bodies.test.ts` then confirms the twins still equal.

### Fix round 1 (review 178) — mutation table

Coordinator rulings on review run 178 (summarised in the programme ledger's wave 7 row; the ledger is on the coordinator's branch, not `main`, so no path is cited) (wave 9, R7b), against `server/src/update/dispatch.ts`. Each row: `cp` to `$SCRATCH`, mutate, run the covering file(s) (`update-op-answer.test.ts` and/or `update-converge.test.ts`), `cp` back, `cmp` byte-identical.

| # | Guard | Mutation | Must red | Measured |
|---|---|---|---|---|
| F1-M | `linkFailedDeadlineDetail` says only what the row's last report proves (item 1) | restore the old clause: `` `${DEADLINE_DETAIL} — the fleet link failed mid-op; the row's last report does not name ${target}` `` → `` `${DEADLINE_DETAIL} — the fleet link failed mid-op and no run of ${target} was reported` `` | both review-178 cases (i, ii) and the other pins carrying the sentence | RED — 6 failed: `update-converge.test.ts`'s "words at the deadline, and they halt", "the same words follow another tag's report", the new case i and the new case ii; `update-op-answer.test.ts`'s two `linkFailedDeadlineDetail` "no report"/"different tag" pins. Restored, `cmp` identical |
| O1-M | `linkFailedHoldDetail` says "may have reached" only for `other` (item 2) | one sentence for all four whys: `const reached = 'reached';` (drop the `why === 'other'` branch) | the `other` row | RED — 1 failed: the new O1 pin ("why=other says the op MAY have reached the link…"). Restored, `cmp` identical |
| CAP-M | the hold sentence keeps its tail under a long `other` message (item 3) | drop the message-only cap: `` return `${headPrefix}other: ${said(message, 'no message')}${tail}`.slice(0, UPDATE_OP_DETAIL_MAX); `` (the old whole-string slice, budget computation removed) | the 500-character message pin | RED — 1 failed: the new CAP pin ("a 500-character other message still fits… and keeps its tail"), on `.endsWith(...)`. Restored, `cmp` identical |
| F2 | premise (b) is Linux-only (item 4) | **no mutation** — item 4 is a coverage/platform-split correction (`itLinux` + `PLATFORM-ONLY`), not a new guard with a red/green pair. Nothing to mutate; said here per the brief's own note. | n/a | n/a |

Item 7 (the three watchdog-revert real-verb cases gaining `expectContained`) is not in the table above: ruling item 7 first asked for a remove-the-plant measurement against those three real-sequence cases, and the worker STOPPED it — a removed plant would resolve the real `/usr/bin/tmux` (the live fleet server) or the real `gh` (a repo-WRITE token) for a merged `ccd/ccrc`, which the plan's own containment rule forbids running. The coordinator withdrew that measurement and ruled a pre-write measurement instead (mail re 2551), whose rows follow.

### Fix round 1 (item 7) — containment measurement (ruling re mail 2551)

The three real-verb cases that gained `expectContained(box.home)` this round are `update-watchdog-revert.test.ts`'s "the negatives, over the same real final report…" (`-t "NOT later than the lease"`), "the negatives: the same real report re-attributed to another writer (from cli)…" (`-t "re-attributed to another writer"`), and "the negatives: a FLEET-role row (agentOps set)…" (`-t "FLEET-role row \(agentOps set\) that fails the deadline reads NO file"`). Each `-t` pattern was confirmed to select exactly 1 test on the UNMUTATED file before any edit (`Tests  1 passed | 15 skipped (16)`).

Per case, per row: `cp` the file to `$SCRATCH/wdr.orig`, insert one `writeFileSync(join(box.home, '<file>-argv'), 'pre-written\n');` right after `const box = watchdogBox(...)` and before that case's `runWatchdogRollback(box)` call (the box's tmux/gh plants stay in place throughout — never removed), run that one case by `-t`, `cp` back, `cmp` byte-identical. The control additionally deletes that case's own `expectContained(box.home);` line, using the tmux-argv pre-write.

| Case | Pre-write | `expectContained` call | Result |
|---|---|---|---|
| "NOT later than the lease" | `tmux-argv` | present | RED — 1 failed: `a rollback reached tmux (poisoned, recording): expected true to be false` at `expectContained`'s `tmux-argv` line. Restored, `cmp` identical |
| "NOT later than the lease" | `gh-argv` | present | RED — 1 failed: `a rollback reached gh (poisoned, recording): expected true to be false` at `expectContained`'s `gh-argv` line. Restored, `cmp` identical |
| "NOT later than the lease" | `tmux-argv` | **deleted (control)** | GREEN — 1 passed. Restored, `cmp` identical |
| "re-attributed to another writer" | `tmux-argv` | present | RED — 1 failed: `a rollback reached tmux (poisoned, recording): expected true to be false`. Restored, `cmp` identical |
| "re-attributed to another writer" | `gh-argv` | present | RED — 1 failed: `a rollback reached gh (poisoned, recording): expected true to be false`. Restored, `cmp` identical |
| "re-attributed to another writer" | `tmux-argv` | **deleted (control)** | GREEN — 1 passed. Restored, `cmp` identical |
| "FLEET-role row (agentOps set) …reads NO file" | `tmux-argv` | present | RED — 1 failed: `a rollback reached tmux (poisoned, recording): expected true to be false`. Restored, `cmp` identical |
| "FLEET-role row (agentOps set) …reads NO file" | `gh-argv` | present | RED — 1 failed: `a rollback reached gh (poisoned, recording): expected true to be false`. Restored, `cmp` identical |
| "FLEET-role row (agentOps set) …reads NO file" | `tmux-argv` | **deleted (control)** | GREEN — 1 passed. Restored, `cmp` identical |

Nine runs total, six reds (three cases × two files) and three controls, exactly as ruled. Each red proves `expectContained`'s own line is capable of failing on that case — the pre-write stands in for "the recorder was reached" without ever removing a plant or letting the real verb touch a live `tmux`/`gh`; each control proves the pre-write alone, with the assertion removed, does not otherwise fail the case. After all nine, the unmutated file was run in full once: 16/16 passed.

## Revision notes (attack round)

All nine attack findings held on the copy.
- F1 (the deadline's words): accepted. The fix differs from the finding's suggestion: every deadline of a link-failure hold now says the link failed mid-op, and only the "the row's last report does not name `<tag>`" clause is conditional (fix round 1, review 178 F1 — corrected from "no run was reported", which review 178 found could itself be false). The coordinator confirmed the narrowing before dispatch.
- F2: `close()` arm pinned (M4b).
- F3: wording of the send-throw justification narrowed to the measured throw sites.
- F4: the definition now rides Task 1's commit.
- F5: M4/M5 run the controls alone, and a second control proves `expectContained` can red.
- F6: M8/M9 added in Task 1.
- F7: a spawn.ts row added in Task 4 (M8).
- F8: `AgentOpError`'s docstring, D-3373 and `AnswerAction`'s docstring are amended; the `:27` import and a describe-level `FLEET_ID2` are listed.
- F9: the release passes `now`, and no pin is claimed for it.