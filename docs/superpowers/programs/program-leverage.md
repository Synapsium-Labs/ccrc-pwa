# Program: program-leverage

Spec: `docs/superpowers/specs/2026-08-28-program-leverage-design.md` (this branch)
Plan: per-wave, committed by each wave's worker on its workspace branch (registry-durability precedent)
Workspace: `ccrc-pwa-brisk-meadow` — the COORDINATOR's session (workspace `brisk-meadow`, branch
`ws/brisk-meadow`); operator-designated 2026-08-28, workspace-resident (not a main checkout).
Worker workspaces are spawned per wave by dispatch.

Ledger + spec live on `ws/brisk-meadow` (pushed) until program close; a worker reads them by
fetching that ref (D-108 precedent). At close the docs PR to main with the final wave.

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | F1 — drift fixes (ungated-door count, coordinator trigger/resume wording, stale `_id()` anchor) + the coordinator-resume runbook (`references/resume.md`). AGENT-FIRST deploy. | run 10, PR #28 (merged `f5dfd2d9`) | done 2026-08-28 18:08 UTC — CI 5/5 green on `8135118b`, deployed both boxes agent-first, `/health` and fleet `ccd` both report `f5dfd2d9` |
| 2 | F2 — dispatch-time `skillState` preflight (measure, never refuse) + synchronous deviation-floor seed on first allocation | run 12, PR #30 | fix round 2026-08-29 ~09:45 UTC — wave-done `e0949f86` verified, items 4/4, review 18 agents: 1 major cluster (sweep lane) + 5 minors, 0 blocking, 1 refuted; findings mail 101, run back in `working` |
| 3 | F3 — per-project program-ready badge (server measurement + /runs board) | — | planned |
| 4 | F4 — program kickoff rides the idle-gated mail lane (`queueSystemMail`), direct-injection race retired | — | planned |
| 5 | F5 — `POST /api/runs/:id/reclaim` (4th ungated door, dead-proof) + PWA resume affordance; door count → four | — | planned |
| 6 | F6+F7a — `COORD_QUIET_MS`/`COORD_COOLDOWN_MS` for coordinator recipients + `POST /api/coord/caps` operator dial | — | planned |
| 7 | F7 — program health on the board (parked mail, replay high-water, rejection counts, un-briefed coordinator) | — | planned |
| 8 | F8 — measured-read completion (`readFileB64`/`readFileFrom`, agent `stat` EACCES lie) + `MailDeliveryState` terminality audit. AGENT-FIRST deploy. | — | planned |

## Decisions & deviations

- **Operator ruling (2026-08-28): the reclaim door ships UNGATED + dead-proof** — measured-dead
  (registry-proven absent, or present with a gone/dead tmux verdict) is the guard, not a
  credential; unmeasurable refuses, never proceeds. Recorded in spec §7/§11.
- **Operator ruling (2026-08-28): wave-1 dispatch HOLDS for operator review of the spec.** The
  run is opened and the block allocated; dispatch fires on the operator's go.
- **Two programs are active concurrently** (`battlescape-operational`, MekWarLive, wave 2/6 at
  open time): every `toId:'coordinator'` mail in this program MUST carry `runId` — the
  runId-less form resolves only when exactly one program is active. Briefs restate this.
- **Build 9 remnants are a NON-GOAL**: peers/claims/allocator/lifecycle shipped in build 9/9b
  (`docs/superpowers/plans/2026-08-24-build9b-peers-claims-allocator.md`); the pre-program
  memory note claiming build 9 was "awaiting review" was stale and is corrected.
- **Run-open (2026-08-28 ~15:45 UTC):** wave 1 opened as **run 10** (`state:planned`,
  `claimedBy:ccrc-pwa-brisk-meadow`). Deviation block allocated: **D-999..D-1046** (48 numbers,
  floor 1047 after) — every wave records its deviations inside this block; a worker with no
  server access writes `D-TBD-program-leverage` and it is reconciled at wave review.

- **Adjacent lane (operator flag, 2026-08-28): `ws/ccrc-with-graphify-integration`**
  (`ccrc-pwa-amber-cove`, wrapper claude2) — graphify fleet integration, spec rev 3
  approved, 13-task plan, block D-995..D-998, mid-implementation. Its TRUE delta vs
  origin/main is `ccd/ccrc` + its docs + install/update/single-definition tests — ZERO path
  overlap with wave 1 (an apparent overlap was this coordinator's stale local `main` ref;
  always diff against `origin/main`). Peer mail 92 sent with fold notes.
- **Fold rulings for later waves:** waves 2–3 (F2 skill preflight, F3 program-ready badge)
  REUSE graphify's skill-convergence/doctor measurement machinery rather than duplicating it
  (single-definition); both lanes touch `server/test/single-definition.test.ts` (trivial merge,
  either order); wave 1's new `references/resume.md` must ride the installer's assembled SRC —
  verify against graphify's §B change at wave-1 close/deploy if that branch has merged by then.

- **Wave 1 verdict (2026-08-28 ~17:20 UTC):** wave-done fingerprint `d1dcb847` verified by the
  server's re-measurement (dispatched→working→awaiting-review, ok); items settled 4/4. Review ran
  four lenses (pinned-suite integrity, claim-vs-diff honesty, runbook correctness, discipline)
  plus a live re-run of the four touched suites (all green), every finding adversarially
  double-verified: **7 minors, 0 blocking/major, 0 refuted** → one fix round, run returned to
  `working`, findings mailed (mail 94). The seven: (M1) the `same workspace, same id` negative
  pin scans raw text where siblings use flat(); (M2) two new test-comment anchors gone stale via
  the wave's own comment-only commit; (M3) resume.md cites wave-lifecycle §3 for the explicit-runId
  recovery — it is §5; (M4) CoordStore.reconstruct misattributed to reconstruction-drill.test.ts
  (it is coord-store.test.ts); (M5) SKILL.md's absolute "every `program:` hold sits on a WORKER's
  workspace" contradicts the byte-pinned ledger-template (D-1004's own finding) — soften, template
  stays deferred; (M6) six of eight runbook pins shipped without a measured red; (M7) the
  three-door prohibition loop hand-types a second copy of UNGATED with no cross-pin — F5's fourth
  door would drift silently. Worker deviations consumed: D-999..D-1005 (D-1004/D-1005 deferred,
  wave-owned later). Notable worker catches: the census could not see new reference files
  (D-1000 — corpus now derived from readdir), and spec item 3 was unachievable as written
  (D-1001 — the auth sweep forbids method-spelled non-EXEMPT routes in the corpus).

- **Wave 1 fix round + close (2026-08-28 ~18:05 UTC):** all seven minors fixed in one commit
  (`8135118b`), each re-verified by the worker before acting, none pushed back; the two sharpest
  were re-measured both ways (M1's wrap-evasion: flat() form RED / pre-fix raw form GREEN,
  D-1006; M7's door list now HARVESTED from coord-pause-route's `UNGATED` with non-vacuity
  guards, and the F5 fourth-door shape measured RED, D-1010). M6 answered with one measured red
  PER pin appended to the plan's execution record (D-1009). Deviations D-1006..D-1011; block now
  D-999..1011 used, 1012+ free. Fingerprint re-verified by the server (working→awaiting-review→
  merging, all ok), PR #28 merged as `f5dfd2d9`, deployed agent-first then server from a scratch
  worktree pinned at the merge commit. Live confirmation: this coordinator's own installed skill
  now carries the reworded run-record trigger. Lesson carried to later waves (worker's, D-1009):
  write a wave's pins BEFORE the file they pin, or the reds have nothing to fail against.

- **Wave 2 stall + recovery (2026-08-28 ~20:20 UTC):** the worker hit its account's SESSION
  usage limit at ~18:38 mid-plan-verification ("resets 7pm"); Claude Code armed an auto-continue,
  and an operator keystroke into that pane (`/effort ultracode`) CANCELLED it — the banner's own
  "esc or type to cancel" arming. The worker then sat idle ~100 min with the wave-2 plan written
  but uncommitted. Recovery: coordinator wake-up mail 99 (runId 12). Program-relevant lesson for
  F7 (health surfacing): "open run, worker idle, no outstanding mail, no commits for N minutes"
  is a detectable wedge shape, and a usage-limit pause + cancelled auto-continue is one of its
  real causes — F7's un-briefed-coordinator detector should generalise to a stalled-worker row.

- **Wave 2 verdict (2026-08-29 ~09:45 UTC):** wave-done fingerprint `e0949f86` (PR #30, CI 5/5)
  verified by the server (dispatched→working→awaiting-review), items settled 4/4. Review: six
  lenses + adversarial verification, 18 agents; all 12 touched suites re-run live in a scratch
  worktree (375/375 green, `ledger-sweep.test.ts` zero-diff confirmed); the three headline guards
  re-measured red by mutation, including the spec-required preflight-deletion red. Worker
  adjudications D-1013 (own run_events row), D-1015 (configDir as consumer-declared port — the
  spec's "livestate.ts owns the derivation" was wrong) and D-1016 (no-refs 409 is pre-existing
  deliberate fail-shut) all UPHELD. Verdict: **one major cluster + 5 minors, 0 blocking, 1
  refuted** → fix round (mail 101), run back in `working`, fix-round deviations from D-1020.
  The major (three lenses independently): the ledgerseed lift changed the HOURLY SWEEP's
  behaviour despite D-1018's "left exactly as it was" — the sweep silently inherited the 10s
  request budget (seeds from a truncated prefix; date-sorted names put max-ref files last, so a
  truncated FIRST seed plants a low floor the synchronous path never repairs → bb47c9e reissue
  class) and abort-replaced-skip on partial failures (an unlistable `plans/` now skips the
  project where old code seeded from `specs/`); `ledger-sweep.test.ts` "passes unedited" was
  true but vacuous (no partial-failure/budget fixture). Ruling: per-lane policy — sweep lanes
  get skip-and-continue + no budget (making D-1018 true again), allocator seed keeps
  abort+budget+fail-shut, shipped with a sweep-lane partial-failure fixture measured red.
  Minors: stale `recordRunEvent` docstring + duplicate dispatched feed/ring record; 14/19
  mutation rows below the plan's own exact-assertion bar; unmeasurable bullet pinned by label
  without its DO-half; `wave-lifecycle.md:77` omits the third unmeasurable cause (resume arm,
  no registry row); orphaned `watch.ts:1899-1913` docstring asserting the refuted 50-gap bound.
- **D-1012 re-measured (2026-08-29, review refuted-as-of-now):** origin NOW carries
  `ws/ccrc-with-graphify-integration` at `92bf6b76` (pushed 21:16 UTC 2026-08-28, after wave 2's
  tip; `docs/scope-throttle-visible` is gone). D-1012 stands as a correct timestamped
  measurement — not rewritten. Fold adjacency re-measured read-only: merge-tree of the two tips
  shares only `server/test/single-definition.test.ts`, which auto-merges cleanly; graphify does
  not touch `shared/api.ts` (its shared change is `shared/lifecycle.ts`); its three conflicts vs
  main (`ccd/ccd`, `ccd/ccrc`, `server/test/ccrc-install.test.ts`) are its own rebase debt in
  files wave 2 never touches. Standing lesson kept: verify a sibling lane's presence on origin
  with `ls-remote`, never `git branch -r` (~30 stale remote refs in this clone).

## Carried constraints

- Waves 1 and 8 are **AGENT-FIRST** deploys (they touch `ccd/coordinator-skill/` and the agent's
  IO half respectively).
- The destructive-verb census (`coordinator-skill.test.ts:97-105`) counts the three destructive
  verbs across SKILL.md + ALL references — wave 1's new `resume.md` must not name them.
- Wire discipline everywhere: additive-only fields, single reader per field, older-peer omission
  tolerated, no `FLEET_PROTO` bump, no new ccd verbs, no overloaded null at any new seam
  (unmeasurable ≠ false throughout F3/F5/F7).
- Root CLAUDE.md's ungated-door count is corrected exactly once per change, BY the wave that
  changes it: F1 writes three, F5 writes four.
- Wave 5 depends on wave 1 (the runbook's re-kickoff template text) and wave 4 (the mail-lane
  kickoff it reuses). Waves 2, 3, 6, 7 are independent of each other.
- Every wave: mutation-table discipline — a guard ships WITH a test measured red on guard
  deletion; TDD red-first; deviations recorded against this program's allocated block.

## Next-wave brief

**Wave 2 — F2: dispatch-time skill preflight + synchronous deviation-floor seed.** Spec:
`docs/superpowers/specs/2026-08-28-program-leverage-design.md` §4 (fetch `ws/brisk-meadow` from
origin), both design items exactly as numbered. Same workspace as wave 1 (`quiet-meadow`,
reclaimed). Key constraints: `skillState` is additive beside `spawnState`, one reader,
`absent` ≠ `unmeasurable` (no overloaded null — the program's standing rule); the preflight
NEVER refuses a dispatch; the allocator's inline seed answers `not-seeded` only when the
measurement itself fails; the wave-lifecycle.md dispatch-table edit touches the pinned corpus —
keep route-parity/census green, and write pins BEFORE the text they pin (wave 1's D-1009
lesson). Fold: the graphify lane (`ws/ccrc-with-graphify-integration`) is adjacent, unmerged,
building skill-convergence/doctor machinery — keep the skill-presence read ONE helper so the
two lanes can converge on it; no path overlap expected. Deviations from **D-1012** up.
Commit on the workspace's own branch; all coordinator mail names the new run's `runId`.
Plan first (superpowers:writing-plans), execute with superpowers:executing-plans. AGENT-FIRST
at close (installer-shipped reference edit). Deploy is not the worker's act.

---

Prior wave's brief (wave 1, retired — kept for the record):

**Wave 1 — F1: drift fixes + the coordinator-resume runbook.** Spec:
`docs/superpowers/specs/2026-08-28-program-leverage-design.md` §3 (fetch `ws/brisk-meadow` from
origin to read it), tasks 1–4 exactly as numbered there. Write your own plan under
`docs/superpowers/plans/` on your workspace branch first (superpowers:writing-plans), then
execute it with superpowers:executing-plans. Constraints that bind this wave: the destructive-verb
census (spec §3 design item 3 — `resume.md` must not name the three verbs); the trigger-sentence
fix must keep the operator-designation arm and must not assert the coordinator is a main checkout
(this program's own coordinator is workspace-resident); new pins in `coordinator-skill.test.ts`
follow the existing verbatim-literal style; AGENT-FIRST deploy order when shipping. Commit on
this workspace's own branch — never a separate feature branch. All mail to the coordinator names
this run's `runId`. Deviations: use this program's allocated block (number range in the ledger's
run-open entry).
