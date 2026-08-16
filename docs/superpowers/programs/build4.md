# Program: build4

Spec: docs/superpowers/specs/2026-08-11-build4-conversation-and-controls-design.md
Plan: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md
Workspace: ccrc-pwa-amber-harbor (spawned by wave-1 dispatch, 2026-08-11; run id 1)
Coordinator: claude-ccrc-pwa (Fable tier — first-ever coordinated program, contract under test;
tier re-evaluated at each wave boundary per the model-selection policy)

This is Build 7's ratified dogfood — the first program driven through the coordinator.
The plan's WAVE MAP is the binding dispatch order: four waves, sequential merges,
each cut from main after the previous merged.

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | Coordination: the writer (Tasks 1–5) | #38 (merged) | done — code merged via ordinary PR; run 1 closed state:failed as BOOKKEEPING (F5: its fingerprint could never measure the feature branch). The work is on main. |
| 2 | Fleet Mutation + run-control substrate (Tasks 6–10) | #44 (merged) | **done** — run 3 on amber-harbor, 8/8, handoff `4f539b35` (main `c8fd87f`). Run 2 was abandoned first (F9); D-1's first production outing (resumed:true + /clear) is in that history. |
| 3 | PWA: the console's hands (Tasks 11–14 — banner, abandon sheet, start-program sheet) | #47 (merged) | **done** — run 4 on brisk-harbor, 9/9, handoff `902faf3` (main `45fe77c`). One BLOCKING review finding fixed before merge. |
| 4 | Session Conversation: the transcript (Tasks 15–19 — envelope parser, mail ChatItem, ask card) | #48 (merged) | **done** — run 5 on brisk-harbor, handoff `8fd1130` (main `90523c4`), closed `final:true`. Two review rounds: D-B4-23 (an expired spec fact) and one ledger correction. |

## Decisions & deviations

- The plan carries D-B4-1..D-B4-17 measured against main@40a41db; the plan-review's four
  blocking findings were fixed before the plan merged (d0c44df). Workers follow the plan's
  deviations, not the spec's original text, where they differ.
- Wave 2 is agent-first at rollout (ccd + whitelist before server), stated in its brief.
- Waves 3 and 4 are file-disjoint and could run in parallel; run sequentially unless the
  coordinator judges the calendar needs it (parallelism only across proven-disjoint workspaces).

## Dogfood findings (live, wave 1)

- F1 — A FRESHLY SPAWNED WORKER CANNOT RECEIVE ITS FIRST BRIEF. The delivery gate
  requires hookstate evidence of a completed turn (hs === null -> skip, correctly
  fail-shut), but a virgin session has never spoken. The brief sat queued ~40min.
  Interim: the coordinator sent a kickoff prompt via the ordinary prompt route; the
  worker's first Stop wrote hookstate and the lane then delivered the brief verbatim.
  FIX CANDIDATE (wave 2 amendment or Build 5): session-hook.sh's SessionStart handler
  writes state=done — a just-started session is definitionally at an idle boundary.
- F3 — BUG #21 REPRODUCED LIVE ON THE MAIL PATH (typed-but-unsent self-block).
  After F1's nudge, the delivery lane typed the 2.8KB brief into the worker's box
  but the Enter did not land; the text sat as an unsent draft; the lane then read
  its OWN un-submitted injection as `draft-present` and refused to redeliver,
  backing off to 5 attempts / ~7min out. The draft guard doing its job (never type
  over a human mid-sentence) is what made the self-block sticky. Recovered by the
  operator via POST /api/sessions/:id/submit with the exact box-prefix as `expect`
  (the box-mismatch safety check itself worked — refused my first wrong guess).
  FIX: this is task #21; the mail delivery path needs the same submit-proof the
  interactive send path has, so a mail injection whose Enter is lost is retried as
  ITS OWN pending delivery rather than abandoned as someone else's draft.
- F4 — VISUAL NESTING GAP (operator-raised). Worker workspaces do not visually nest
  under their program on the fleet screen; the data exists (hold reason
  `program:<slug> wave:N/M`) but the fleet list groups flat by project. Proposed as
  a fast-follow — see task.
- F2 — THE DRAFT GUARD HELD UNDER RACE. The kickoff nudge and the brief delivery
  raced; the sweep answered draft-present twice, backed off, and delivered cleanly
  once the box emptied. The design behaved exactly as specified; recorded as a pass.

## LIVE PROOF PASSED 2026-08-12 — the reference-nudge lane delivers to the corrupted box

PR #40 (robust reference-nudge delivery) merged + deployed (server 6dd7be0).
Acceptance test run against the WORST case — the wave-2 worker
ccrc-pwa-amber-harbor, whose box carried accumulated [Pasted text #N]
fragments AND whose hookstate was null/stale (the F6b deadlock).
Sent a fresh coordination mail (delivery id 4). Result:
  delivery 4 (new lane): state=acked, attempts=0, lastError=null
  deliveries 1,3 (old lane): attempts=5, lastError=draft-present
Delivered on the FIRST attempt, no draft-present, no verify-fail, worker
acked — proving BOTH fixes live: F6b (live-idle gate delivered to a
null-hookstate worker the old lane would skip forever) and F7 (dirty box
cleared, tiny nudge landed clean, zero accumulation). The delivery-lane
class of failures is closed.

Note: the worker, on reading its wave-2 brief, correctly raised the F5
concern itself — it is on feat/build4-w1-items while the run fingerprint
re-measures the workspace branch ws/wave-1-worker-coordination-for-build4.
Smart catch; confirms the SKILL's workspace-branch guidance is the right
fix. This worker's context is polluted from the ordeal, so wave 2 proper
should re-dispatch a FRESH worker on the now-reliable lane.

## F7 — LARGE MULTI-LINE BRIEFS ARE FRAGILE TO TYPE OVER tmux

Live wave-2 delivery (after the hookstate was nudged fresh): attempt 1
verify-failed (send.ts echo-verify of a ~3KB multi-line paste did not match —
the paste had not fully rendered / reflowed when verify ran), leaving partial
content in the box; attempt 2+ draft-present (the deployed F3 resumeIfOwn
cannot match a MANGLED partial envelope, only a clean own-draft, so it
self-blocks again). So there are TWO distinct large-brief failure modes:
(a) Enter lost — the submit-proof fix (wf_ad1d4fd6-896, running) addresses it;
(b) echo-verify flaky on a large multi-line paste — NOT addressed by
submit-proof; a distinct robustness gap.
DEEPER DESIGN QUESTION: typing a ~3KB brief into a tmux pane is inherently
fragile near the 8KB cap. Candidate: deliver a large brief by writing it to a
file in the worker's workspace and injecting a SHORT "read <path>" prompt
instead of typing the whole payload — the short prompt is robust, the file is
the payload. Flag for the fix workflow / a follow-up; do not silently accept
the fragility.

ORCHESTRATOR DISCIPLINE NOTE: stopped hand-nursing wave 2 after three
optimistic half-successes the operator caught. Wave 2 is BLOCKED until the
root-cause fix lands; no more live poking.

## F6 — DISPATCH'S /clear HITS BUG #21; THE HARDENING WAS INCOMPLETE

Wave 2's dispatch (run 2) FAILED to deliver its brief. Root cause: dispatch's
own /clear injection lost its Enter (bug #21 / typed-but-unsent) — /clear sat
as a draft, never ran, so the resumed worker's context was not cleared and its
hookstate stayed 14h stale; the 30-min freshness gate (HOOKSTATE_FRESH_MS)
nulls it; the delivery gate (hs===null) skips the brief forever (0 attempts).
The dispatch response's clearedAt was set on sendPrompt's typed-ok, NOT on
proof the Enter landed — the coordinator (me) trusted the field over the pane.

ORCHESTRATOR ERROR: the F3 hardening fixed the typed-but-unsent race ONLY on
the mail lane and explicitly left dispatch's /clear "unaffected". Wrong: bug
#21 is a property of the INJECTION PRIMITIVE (sendPrompt + its Enter); every
caller is exposed — mail (fixed), dispatch /clear (not), human prompt (escapes
only via the manual Send-it). Per-caller patching is whack-a-mole.

FIX (task #21 at the root): make sendPrompt/submitEnter PROVE its own Enter
landed and self-recover (the resumeIfOwn logic belongs IN the primitive, not
bolted onto callers). One fix covers mail, dispatch /clear, and any future
caller. Dogfood paused until deployed; then wave 2 re-dispatches clean.

## Wave 1 outcome + F5

WAVE 1 CODE IS DONE AND GREEN. Re-measured by the coordinator in the worker's own
worktree: server 2043 tests (57 new), pwa 1317, tsc clean x2. The diff is exactly
the plan's wave-1 file set (coord/items.ts, dispatchRun tx, POST /api/runs/:id/items,
the tally em-dash, gates + mutation tables). 5 commits on feat/build4-w1-items @ 9c3632e.

- F5 — THE BRIEF'S BRANCH INSTRUCTION BREAKS THE DONE-FINGERPRINT. The wave-1 brief
  (coordinator-authored) said "Work on branch feat/build4-w1-items cut from main" —
  the ordinary SDD per-PR convention. But ccrc's done-fingerprint (D-2) is
  handoffCommit === WORKSPACE-branch tip: verifyDone re-measures record.branch
  (ws/wave-1-worker-coordination-for-build4), which is stale at d0c44df while the
  work sits on the feature branch at 9c3632e. So advance/close both return stale-tip
  and there is no non-abandon bookkeeping path to close a run whose work is correct.
  The worker did exactly as instructed — the defect is the coordinator's brief and,
  upstream, the SKILL/plan brief-writing guidance, which must say: the worker commits
  ON ITS WORKSPACE BRANCH; never instruct a separate feature branch. FIX: SKILL
  (references/wave-lifecycle.md brief template) + the plan's brief sketches.
  This is the dogfood's most valuable finding — a whole class of program would have
  wedged at every wave's close.

## F8 — FRESH-SPAWN DISPATCH ORPHANS A WORKSPACE WHEN THE PICKED WRAPPER CANNOT SPAWN

Found 2026-08-12 dispatching wave 2 to a FRESH worker (run 3, no sessionId). Dispatch
answered `{ok:false, stderr:""}` and the run stayed `planned` (the D-46/D-48 ordering fix
held — nothing wedged). But the box was left with an ORPHANED workspace, `swift-harbor`:
worktree + full registry entries present, no session, no run binding.

Cause, in order: `cmd_ws_add` writes the worktree and registry FIRST and runs
`_spawn` + `_ws_supervise` LAST. `_ws_least_loaded` picked wrapper `claude-dev0` by
session-count + disk only — it does NOT consider wrapper HEALTH. dev0 was rate-limited
(logged in, over limit), so the fresh session showed a usage-limit screen that
`_accept_first_run_prompts` does not recognize — it matches ready banners and
`_pane_login_screen`, nothing else — and its `for i in $(seq 1 450); sleep 2` loop polled
toward ~900s. The agent's per-verb ccd budget (`server/src/remote/runner.ts`,
`CCD_TIMEOUT_MS = 90_000`) fired first and killed ws-add mid-`_spawn`.

Signature to recognize it: `<id>.started` marker absent, `claude-session@<id>.service`
inactive(dead) with ZERO journal entries, worktree on disk, registry complete.

DIAGNOSTIC TRAP, recorded because it cost a wrong diagnosis here: the dispatch failure is
`fleetFailed` with EMPTY stderr — the kill leaves nothing on stderr. Empty stderr means
"timed out and was killed", NOT "no error", and NOT the agent's 10s
`DEFAULT_EXEC_TIMEOUT_MS` (the remote runner always sets a per-verb `timeoutMs` for ccd, so
the agent default never applies to it). Threading a longer timeout would only wait longer
for a spawn that was never going to succeed.

Three defects, tracked for Build 5 (safety/ops): (1) placement must consider wrapper health,
not just load; (2) `_accept_first_run_prompts` must fail fast, bounded under the agent
budget, and recognize a limit/usage screen the way it recognizes a login screen;
(3) a failed ws-add must not leave an orphan — roll back or surface it as reclaimable,
without autonomous deletion (ws-rm/ws-reap stay human-only).

WORKAROUND USED, and it is the general one: dispatch onto an already-running HEALTHY session
instead of spawning. Re-`POST /api/runs` with the same (program, wave, claimedBy) plus
`sessionId` — `openRun` is idempotent for a still-`planned` row, so it reuses the run,
attaches the session and places the hold; dispatch then takes the fast `ensure` path, no
ws-add and no spawn. (`dispatched -> dispatched` is illegal, so an already-dispatched run
cannot be re-dispatched — you need a `planned` row.)

## Wave 2 dispatched 2026-08-12 — on amber-harbor, over the proven lane

Run 3, wave 2/4, 8 declared items, on the EXISTING healthy session `ccrc-pwa-amber-harbor`
(operator ruling: reuse the healthy box rather than block on dev0's recovery). Verified in
the pane, not by response code: `/clear` landed, the reference nudge arrived within 60s, the
worker fetched the brief and began executing its first instruction. Statusline: Opus 5,
xhigh, ultracode.

The brief's FIRST instruction is the F5 correction — `git checkout
ws/wave-1-worker-coordination-for-build4 && git reset --hard origin/main` — safe because
BOTH `feat/build4-w1-items` and the workspace branch were fully contained in `origin/main`
(wave 1 already merged), so nothing was lost. Confirmed applied: the worktree now reports
`b1f54fe [ws/wave-1-worker-coordination-for-build4]`.

Run 2 stays `dispatched` and wedged, deliberately: its clean abandon route
(`POST /api/runs/:id/abandon`, no fingerprint, always release, never archive) is Task 9 OF
THIS VERY WAVE. The old close route demands a fingerprint even for an abandon, and
`final:true` would risk the ordinary sweep archiving a box worth keeping. The program is
being blocked by exactly the feature it is building — the purest dogfood signal in the run.

## Wave 2 CLOSED done 2026-08-12 — 8/8, handoff 4f539b35, merged as PR #44 (main c8fd87f)

The first wave in this program to complete the full lifecycle: dispatch -> wave-done ->
review -> fix -> merge -> deploy -> advance -> settle -> close. The run board reads
`run 3: wave 2/4 done items=8/8 handoff=4f539b35`, and wave 1's work-item writer counted a
real wave for the first time.

Reviewed by a 6-lens adversarial workflow (whitelist security, the ungated routes, the
abandon arm, the registry/wire frame, plan conformance, do-the-tests-hold), each finding
handed to an independent agent prompted to REFUTE it. 7 filed, 5 refuted, 2 confirmed, and
ZERO runtime or security defects — the whitelist grant + `REQUIRED_VERB_FLAG` enrolment, both
ungated routes, the abandon arm's four negative pins and the coord frame all survived.

The two confirmed were both test-strength/honesty, and the major one is worth remembering:
the pin that was supposed to keep the D-B4-9 ungated-route ARGUMENT load-bearing sliced a
2000-BYTE window backwards from the route, which overshot the docstring by 437 bytes into the
PREVIOUS route's body — so both its assertions were satisfied by unrelated code and deleting
the whole pause docstring left the suite GREEN. The same disease the worker had already caught
and fixed once in its own mutation table. Fixed by anchoring the window to the route's own
text (previous handler's `});` .. this route's registration) plus a `prose()` normaliser, so a
sentence is not findable-or-not depending on where the 80th column fell. VERIFIED BY THE
COORDINATOR, not accepted on report: mutant applied -> RED 2 failed | 10 passed (the exact two
named pins), restored -> GREEN 12 passed, tree clean, tip unmoved.

The worker also reported a METHOD DEFECT in its own sweep, unprompted: its first mutant run
reverted with `git checkout -- <file>` while the fixes were still UNCOMMITTED, silently
discarding them, so every later mutant ran against the pre-fix tree and reported "killed" for
pins that were not. It caught this by measuring the docstring slices directly rather than
trusting pass/fail, committed first, and re-ran the whole set clean. General rule worth
keeping: a `git checkout`-based mutation sweep is only valid when the tree it reverts TO is
the tree you mean to test.

LIVE VERIFICATION of the shipped capability, agent-first (ccd + whitelist to the fleet host,
then the server; both at c8fd87f):
- `ccd caps` on the fleet host lists `coord-pause`.
- `POST /api/coord/pause {paused:true}` UNAUTHENTICATED -> `{ok:true,requested:true}` and the
  marker appears at `$REG/coordinator-paused`. The whole path — ungated route -> agent WS ->
  whitelisted `ccd coord-pause --state on` -> file on the box — works.
- `{state:"on"}` (wrong shape) -> 400 `bad-request`, marker untouched: fail-shut.
- THE KILL-SWITCH BITES: dispatch while paused -> `{ok:false,refused:"paused"}` and NO
  workspace was created — it refuses at step 1, ahead of caps and ahead of any fleet act.
- Unpause clears the marker; a second unpause is idempotent.
- `POST /api/runs/2/abandon` (no body — D-B4-7) -> `{ok:true,id:2,state:"failed"}`, clearing
  the run-2 wedge WITH THE ROUTE THIS WAVE SHIPPED. The program was blocked by a missing
  feature, built it, and used it to unblock itself.

## F9 — THE HOLD IS PER-SESSION, SO ONE RUN'S ABANDON CAN UNPROTECT ANOTHER RUN'S WORKSPACE

Found closing wave 2. Sequence: PR #44 merged 20:03 -> run 2 (the stale duplicate wave-2 row,
same session) abandoned ~20:09, whose `ws-release` removed the hold -> the ordinary sweep saw
MERGED + UNHELD and archived `amber-harbor` at 20:10:36, reason `merged:#44` -> run 3's close
then failed its fleet act: "ccrc-pwa-amber-harbor is archived — restore first: a hold cannot
protect a pane that is already gone".

The hold is keyed on the SESSION, not the run, and two runs (2 and 3) shared one session. So
abandoning the dead one released the protection the LIVE one still needed, and the archive
sweep took the workspace out from under an open run. Nothing was lost — the work was already
merged to main and the worktree is still on disk — but the bookkeeping could not complete by
its intended path.

D-48 held exactly as designed: the fleet act runs AHEAD of the transition commit, so the
failed `ws-hold` left run 3 retryable in `merging` rather than wedged terminal. The close then
succeeded with `final:true` (release rather than re-hold), which is the honest choice once the
workspace is archived and will not carry wave 3.

Fixes to consider (Build 5, artifact-lifecycle / task #34): refcount the hold across open runs
for a session, or refuse to release while another non-terminal run names the same session; and
make the archive sweep skip a workspace that any open run still points at. Related: the
close route's ws-hold failure mode should say "another run still holds this" rather than
present as an unrelated archive error.

## Wave 3 CLOSED done 2026-08-13 — 9/9, handoff 902faf3, merged as PR #47 (main 45fe77c)

Dispatched 2026-08-12 onto `ccrc-pwa-brisk-harbor` (run 4), the second workspace this program
used. PWA-only by design: nothing under `server/`, `agent/`, `ccd/` or `shared/`, consuming
wave 2's wire rather than authoring any of it.

**A BLOCKING review finding, fixed before merge.** `StartProgramSheet` armed its
"did my spawn land?" match AFTER awaiting `createSession`, so a session that appeared while the
await was in flight was never matched — the sheet could refuse its own spawn. The fix moves the
arming ahead of the await and keys the match on project + wrapper + `workspace === null` +
`status !== 'dead'` + not-already-live (`preLive`), with `startedSessionFor` exported so a unit
test can drive it directly. I reproduced the mutant RED myself before accepting the fix rather
than taking the worker's report on faith — the practice this program settled into.

Two of the worker's corrections to MY review were accepted: "not resolving on this tick" is not
"timing out" (liveness on the wait arm), and its `preLive` freshness rule beat my proposed
"id not seen before". A review that cannot be corrected by the worker is not a review.

**Cost, honestly recorded: an 11.5-hour stall, and it was mine.** I swapped the worker's account
mid-wave to clear a limit, which killed the in-flight turn, and then sent only `/model opus` —
never a resume instruction. The session sat idle until the operator noticed. A bare `ccd swap`
was also silently reverted 15 minutes later by the auto-home reconciler; the working form is
`ccd prefer <id> <wrapper>` FIRST, then `swap`.

## F10, F11, F13, F14 — the four findings waves 3–4 surfaced OUTSIDE the coordination core

Recorded here because the pattern matters more than any one of them: after wave 2, not a single
new defect landed in runs, mail, the ledger or the transitions. All four are in **fleet mutation**
and **operator input** — the two surfaces the coordination build did not touch.

- **F10 — placement ignores the billing lane.** `_ws_least_loaded` ranks home-able accounts by
  `_limit_score` alone (max of the 5h/7d percentages), which knows nothing about how an account
  bills. `claude-dev0` is on Claude API usage credits, so the least-loaded account is exactly the
  one a dispatched worker must not land on. Caught at $2.38. Task #35.
- **F11 — the auto-naming lane renames a coordinator-dispatched workspace.** `ws-add` created
  `ws/brisk-harbor`; within a minute the naming lane renamed the branch out from under the run,
  and the done-fingerprint re-measures a branch by name. Same family as the auto-home reconciler
  undoing a bare `swap`. Task #35.
- **F13 — a multi-line draft wedges the input box against every server route.** A long
  instruction typed via `POST /api/sessions/:id/prompt` can land as an unsent DRAFT; every later
  route that types into that box then appends to the wedge instead of sending. Task #36.
- **F14 — anything in the box silently blocks the coordination mail lane.** `sweepMail` refuses
  to deliver into a dirty box and records `lastError:'draft-present'`, so while a draft sits
  there the coordinator cannot reach that worker AT ALL. F13 and F14 compound: one stuck operator
  prod makes a worker unreachable by mail, and neither surface says so out loud. I cleared such a
  wedge twice this program with `replaceDraft` before mail could land. Task #36, priority raised.

## Wave 4 CLOSED done 2026-08-13 — handoff 8fd1130, merged as PR #48 (main 90523c4)

The final wave, and the one that justified the whole review layer: **CI was fully green (5/5) and
the PR was still wrong.**

A 4-lens adversarial review (14 agents, each finding handed to an independent agent prompted to
REFUTE it) filed 10 findings — 8 refuted, 2 confirmed, and both were the same defect, recorded
as **D-B4-23** below. The fix was reviewed again by a 3-lens pass (11 agents): 6 filed, 5 refuted,
1 confirmed — a one-word arithmetic error the correcting commit had itself introduced into the
plan's deviation ledger ("the last five" enumerating six). Sent back rather than merged past,
because it was a false statement about the ledger shipped by the commit whose job was correcting
false statements.

**Two of the five refutations are worth keeping.** Two independent lenses called the `null` /
`Array.isArray` guard and the `malformed` early return in `parseFetchedMailEnvelope` unreachable
dead code. Both verifiers refuted them WITH MUTANTS rather than argument: mutating the guard to
FIRE turns three tests red, and collapsing the seam at the wider door turns the both-doors pin
red. A guard whose only failure mode is firing wrongly is pinned by mutating it, not by deleting
it — which is exactly what the doctrine says ("deleted/mutated"), and a deletion-only reading of
it would have scored a live guard as dead and invited its removal.

**Three pins that could not fail were found in this wave alone** (D-B4-21, D-B4-22, and M-16
during the review round), and every one was found by APPLYING a mutant — none by reading the
test. M-16 is the sharpest: "still files the fetch as a tool card — the result is not stolen"
asserted only that a `.toolcard` element existed, and a tool card renders whether or not its
result ever arrived. Fixed to assert on the state dot.

## D-B4-23 — THE DEFECT WAS THE SPEC'S OWN MEASURED FACT, EXPIRED BY THIS PROGRAM'S OWN FIX

The finding this program should be remembered for.

Spec §2.1 fact 2 was MEASURED on 2026-08-11 against a delivery lane that typed the whole envelope
into the recipient's pane, where it landed in the JSONL as a `user` turn. Task 17 built the mail
card on that fact and gated it on `e.kind === 'user'`. On 2026-08-12, commit **43b2737 — shipped
mid-program, by this same coordinator, as the robust-delivery fix —** replaced the typed envelope
with a one-line reference nudge. Mail has since reached a transcript only as the `tool_result` of
the worker's own `GET /api/mail/:id`.

So wave 4 executed on 2026-08-13 against a premise its own program had invalidated the day
before. **The trigger had no live producer at all**, and the wave's headline outcome — mail stops
reading as something the operator typed — was not achieved for any current mail. Three shipped
artifacts asserted the expired fact in the present tense, including the canonical `README.md`,
which thereby contradicted `CLAUDE.md`'s own nudge invariant.

Nothing caught it: not the plan, not the worker, not CI, not the worker's own eleven-mutant
sweep. Every test passed because every test asserted the expired premise. Only an adversarial
reader asking "does this trigger ever fire in production?" found it.

**The general lesson, and it is a process lesson, not a code one:** a spec sentence is a
MEASUREMENT WITH A DATE, and a long program can invalidate its own measurements while running.
Waves must re-measure the facts they depend on against the tree at dispatch time, not inherit
them from the spec's prose. The operator's ruling was to fix both halves — make it work with
today's lane AND correct the false claims — which is what shipped.

## PROGRAM CLOSED 2026-08-13

Four waves, five runs (run 2 abandoned under F9), four PRs (#38, #44, #47, #48), two workspaces
(`amber-harbor`, `brisk-harbor`), 23 deviations (D-B4-1..23) of which six were found during
execution. Run 5 closed `final:true`; with no open run the server retired the program.

**What held:** the coordination core. After wave 2 shipped its own controls, runs, mail, the
ledger, the transitions and the done-fingerprint produced no new defect for the rest of the
program — while being used in anger for every dispatch, review round and close.

**What did not:** fleet mutation and operator input (F8–F11, F13, F14). Every remaining failure
this program hit was in spawning, placement, naming, holds, or the input box — never in the
coordination it was built to test. That distribution is the argument for the robustness build
that follows this one.

**What changed in how the work is reviewed:** every could-not-fail pin (five across the program)
was found by running a mutant, never by reading; and both the worker and the coordinator
corrected each other on the record. The discipline that produced that is cheap and stays.

## Carried constraints

- The wave-1 run's own tally reads `—` (no items exist until wave 1 ships the writer and a
  LATER dispatch names items) — expected, spec §3.4, not a defect for reviewers to file.
- shared/api.ts is touched by waves 1, 2 and 4 in three disjoint regions; RunsScreen.tsx by
  waves 1 and 3; coord/store.ts by waves 1 and 2. Sequential merging keeps the conflicts cheap;
  a conflict there is expected, not a finding.
- Suites run FOREGROUND with >=600000ms timeouts on a loaded box; ccd-ws-gc/pr-sweep/
  session-hook/typecheck-tests have known load flakes — isolate before concluding.

## Next-wave brief — SUPERSEDED, the program is closed

Kept for the record: this section carried wave 1's dispatch pointer (the plan's WAVE MAP
"Wave 1 brief sketch", dispatched verbatim minus the ledger excerpt) and the wave-boundary
protocol — re-measure, advance, review the handoff commit, and open wave N+1 BEFORE closing
wave N (`final:false`), close-first being what retires a program early and breaks every
`toId:'coordinator'` mail. Wave 4 was the last wave and closed `final:true`. There is no next
wave; follow-on work is tracked as the robustness build and Builds 5–6.

## Correction, appended 2026-08-16 (robustness build, Wave 1)

Four claims above are wrong. They are left standing, because a ledger that quietly repairs itself
stops being evidence. What follows is what was actually true and how the error was made. The labels
`C1`, `C11` and `C12` are the ones the robustness spec
(`docs/superpowers/specs/2026-08-14-fleet-robustness-design.md`, "twelve shipped claims that are
false against the code") assigned to these same sentences; they are reused here so the two documents
name one thing once.

**1 (C1). "worktree + full registry entries present, no session, no run binding" (line 150).** The
worktree and the registry entries were there. **The session was too.** `tmux new-session -d`
(`ccd:7153`) completes before the blocking wait, and the tmux server is not ccd's child — so killing
`ccd ws-add` at 90 s killed the client that was waiting, never the pane. `ccd ls` printed
`ccrc-pwa-swift-harbor` as `ALIVE yes` throughout, and it was still alive on the box two days later.
"No session" is the sentence that sent three later readings down the wrong path.

**2 (C12). "Signature to recognize it: `<id>.started` marker absent, `claude-session@<id>.service`
inactive(dead) with ZERO journal entries" (lines 161–162).** Every clause is true and the signature
is still uninformative, because it reads only the half of the box that was dead. `_ws_supervise`
never ran, so no unit was ever enabled — an inactive unit with no journal is what a unit that was
never instantiated looks like, not evidence about the pane. **Two liveness signals disagreed and
this ledger believed the one that cannot see a pane.** `systemctl show` on an UNINSTANTIATED
TEMPLATE reports `LoadState=loaded`, so it answers for an id that has no unit at all; the probe that
would have disagreed is `list-units`, which does not name it. `ccd ws-audit` could not have
corrected the reading either: `_ws_reap_eval` refuses `not-archived` first and nulls every
downstream field, and `_alive` appeared nowhere in that verb.

**3 (C11). "`_ws_least_loaded` picked wrapper `claude-dev0` by session-count + disk only" (lines
153–154).** It considers neither. `_ws_least_loaded` ranks home-able accounts by `_account_ok` plus
`_limit_score` (`ccd:1134-1142`) — the max of the 5h/7d percentages. This ledger self-corrects 150
lines later, in F10's own entry ("ranks home-able accounts by `_limit_score` alone"), and the two
sentences have coexisted since the day it merged. The conclusion drawn from the wrong one still
holds: placement does not consider wrapper HEALTH, which is the defect.

**4. "a failed ws-add must not leave an orphan — roll back or surface it as reclaimable" (line
173).** Correct as a requirement, wrong about the evidence available to satisfy it. The spawn's exit
code was on disk the whole time: `$REG/<id>.spawn` is written as `<epoch-seconds> <rc>`. Nothing on
the wire carried it, so no surface could show it — a plumbing gap, not an absence of evidence. And
nothing classified the shape either, because no lifecycle fixture anywhere combined `alive: true`
with `started: false`: the 24-combination cross-language sweep yielded only six tokens, and the row
read `running` for two days.

**What the robustness build changes.** `started` is written between `_spawn_start` and
`_spawn_settle`, before anything blocks, and `_ws_supervise` runs there too — so a kill at any
moment leaves an ordinary, restartable session. `_session_state` and `sessionLifecycle` gain
`unclaimed`, first inside the alive branch, so the shape names itself. `ws-audit` answers
`alive`/`started`/`unit` on every verdict, probing with `list-units` rather than `show`.
`_resupervise_live` adopts an `unclaimed` pane and writes the claim, so `ccd ensure` repairs the
shape rather than reporting success and changing nothing.
