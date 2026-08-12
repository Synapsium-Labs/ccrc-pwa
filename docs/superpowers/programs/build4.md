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
| 2 | Fleet Mutation + run-control substrate (Tasks 6–10) | — | dispatched (run 2, same workspace, resumed:true + /clear via dispatch — D-1's first production outing; brief 3075B + SEVEN DECLARED ITEMS — wave 1's feature in service; hardened machinery: F1/F3/F5 all deployed) |
| 3 | PWA: the console's hands (Tasks 11–14 — banner, abandon sheet, start-program sheet) | — | pending |
| 4 | Session Conversation: the transcript (Tasks 15–19 — envelope parser, mail ChatItem, ask card) | — | pending |

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

## Carried constraints

- The wave-1 run's own tally reads `—` (no items exist until wave 1 ships the writer and a
  LATER dispatch names items) — expected, spec §3.4, not a defect for reviewers to file.
- shared/api.ts is touched by waves 1, 2 and 4 in three disjoint regions; RunsScreen.tsx by
  waves 1 and 3; coord/store.ts by waves 1 and 2. Sequential merging keeps the conflicts cheap;
  a conflict there is expected, not a finding.
- Suites run FOREGROUND with >=600000ms timeouts on a loaded box; ccd-ws-gc/pr-sweep/
  session-hook/typecheck-tests have known load flakes — isolate before concluding.

## Next-wave brief

Wave 1 brief is the plan's WAVE MAP "Wave 1 brief sketch", dispatched verbatim (minus this
ledger excerpt). On wave-done: re-measure, advance, review the handoff commit, open wave 2
BEFORE closing wave 1 (final:false).
