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
| 2 | F2 — dispatch-time `skillState` preflight (measure, never refuse) + synchronous deviation-floor seed on first allocation | run 12, PR #30 (merged `4e2a04f5`) | done 2026-08-29 ~10:45 UTC — fix round `c026e151` verified (all findings fixed, D-1020..D-1022), CI 5/5, merged, deployed both boxes agent-first; `/health` and fleet `ccd` both report `4e2a04f5` |
| 3 | F3 — per-project program-ready badge (server measurement; seam re-ruled to `GET /api/projects` + StartProgramSheet, D-1023) | run 14, PR #33 (tip `768913f8`) | fix round 2026-08-30 — reviewed: 2 majors (remote-mode token read makes `ready` unreachable; D-1030 entries unpinned) + 8 minors, 0 blocking, 0 refuted; ruling mailed (107), run back in `working`, fix deviations from D-1034 |
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

- **Wave 2 fix round + close (2026-08-29 ~10:45 UTC):** all findings fixed in one commit
  (`c026e151`), each re-verified by the worker first, none pushed back; CI 5/5 on the tip. The
  major landed exactly per the ruling and then some: `LedgerReadPolicy` is a REQUIRED parameter
  (no default — "a default is exactly how one lane acquires another's policy without anyone
  deciding it should"), `SWEEP_POLICY` = skip+unbounded, `SEED_POLICY` = abort+bounded, two new
  sweep-lane fixtures in `ledger-sweep.test.ts` + four in `ledgerseed.test.ts`, all mutation-
  measured red; orphaned docstring deleted. Worker's own catches this round: its first two
  sweep fixtures passed against the broken code (fixture blind spots — same class as the
  original defect; recorded in test comments), and NEW **D-1022**: `complete` is the seed's
  actual guard, `abort` only an early exit — making the seed lane tolerant reds nothing,
  deleting the completeness check reds 5; written into `ledgerseed.ts` so an optimisation pass
  cannot mistake one for the other. Minor 1 fixed at the notify lane (pushNewRuns skips
  `fromState === toState` observation rows; `runEventsSince` gained `fromState`, one reader;
  `recordRunEvent` docstring amended "the future it warned about arrived"). Mutation table
  re-run in full, 24 rows with exact assertion text, two of the re-run's own mutations recorded
  as wrong rather than hidden. Deviations D-1020..D-1022 (1023+ free). Fingerprint re-verified
  (working→awaiting-review→merging), PR #30 merged as `4e2a04f5`, deployed agent-first then
  server from a scratch worktree at the merge sha; all live sessions verified through the
  sweep. Lesson carried (worker's words): "a suite that cannot express a change cannot witness
  it" — partial-failure fixtures must exist before an "unchanged behaviour" claim means
  anything.

- **Wave 3 wave-done re-measured (2026-08-30 ~10:10 UTC):** worker mail (delivery 104, run 14)
  reports tip `768913f8` = handoffCommit, PR #33 open. Re-measured true: workspace HEAD matches,
  PR #33 MERGEABLE/CLEAN onto main, CI run 33258091996 5/5 green on that exact sha, merge-base
  with origin/main is `7fb93b3e` (the graphify merge — 0 behind). Run 14 advanced
  dispatched→working→awaiting-review with the exact reported fingerprint; items 4/4 settled.
  Headline deviations claimed (verification pending review): **D-1023** — the seam is NEITHER
  spec-named seam; both measured structurally unable (`GET /api/runs` JOINs away run-less
  projects — the exact case F3 exists for; the coord emit sits above the registry fail-shut with
  no project names in scope, pinned by `fleetws.test.ts:843-869`). Put to the operator with
  measurements; **operator ruling: ship on `GET /api/projects`, badge in StartProgramSheet
  ONLY** (the /runs board groups by PROGRAM slug and nothing constrains a program's runs to one
  project — a group-header badge would be a program wearing a project's answer). **D-1026** —
  the aggregate is `ready|blocked|unknown`, not the approved boolean (`ready:false` would fold
  proven-missing into could-not-tell); blocked outranks unknown. **D-1024/D-1025** — spec's
  precondition arms corrected against the shipped process (coord-DB false is unreachable while
  the server runs; the real degraded arm is a post-boot throwing read, previously swallowed;
  the token's unmeasurable arm only exists because the sweep re-measures the path). **D-1028**
  (three spellings of the projects row, inline twin now scanned by single-definition),
  **D-1030** (contrast gate didn't cover the badge — same-stylesheet grounding blindness),
  **D-1031** (the one mutation survivor: tree-wide inert `lastX !== 0` idiom, kept + prose
  corrected), **D-1032** (green single suite ≠ typecheck), **D-1033** (badge-absent grid
  re-flow — invisible to jsdom, shipped then caught). Mutation table per the review's count:
  21 applied / 20 killed / 1 survivor (the wave-done's "22/21" was off-by-one bookkeeping —
  the extra was a run the record itself disqualifies; this entry originally echoed the claim).
  Wire: additive field on `GET /api/projects`, key-absent vs null vs object trichotomy. NOT
  agent-first (server+PWA only).

- **Wave-3 reviewed (2026-08-30 ~10:35 UTC): 2 majors + 8 minors, 0 blocking, 0 refuted →
  fix round (mail 107), run 14 back in `working`, fix-round deviations from D-1034.** Review:
  6 lenses + per-finding adversarial verification (workflow `wf_6eed1287-34a`, 16 agents);
  live suites green in a scratch worktree (server 8 suites, pwa 100/100); all four sampled
  mutations killed with the worker's recorded assertions matching verbatim. D-1023/D-1024/
  D-1025-arms/D-1026/D-1031/D-1032 all UPHELD with independent evidence; the reuse-fold lens
  (skillstate extension, mid-wave union merge, D-1027 doctor-lane vocabulary boundary) found
  nothing. **Major 1:** in remote fleet mode — the live server's standing config — the
  box-token sweep rides `deps.io` (the agent-backed FleetIO), asking the FLEET box's agent to
  read a SERVER-box path (`~/.ccrc/mail.token`) its read whitelist refuses (no `.ccrc` arm) →
  boxToken permanently `unmeasurable` → **`ready` is unreachable in production**; even
  whitelisted it would measure the wrong box (fleet host's token lives at `~/.cc-secrets/`).
  Honest failure (permanent unknown, never a false ready), hence major not blocking. Ruling:
  server-local read port on the readiness deps (D-1015 precedent), never fleet io, with a
  fixture pinning the wiring (fleet io refuses `.ccrc` + local file exists ⇒ `configured`).
  **Major 2:** D-1030's three `INHERITED_GROUNDS` entries ship with no test that reds on
  their deletion — the pre-fix state was measured GREEN, so deletion restores it silently
  (the census recoverability check only flags color+background painters; `.sheet-panel` sets
  only background). Ruling: the precedent-shaped `contrast.test.ts` pin (spawn-chip shape).
  Minors: sweep tick dispatch unpinned (`watch.ts:881`); `configured`-vs-extractable recorded
  as deviation, NOT content-validated (no honest arm in the three-state vocabulary — verifier
  ruling adopted); D-1028's twin scan dodges the `interface` spelling with a LIVE pre-existing
  twin in `NewSessionSheet.tsx:21-24` (widen scan + convert in one commit); blocked badge's
  missing-precondition list is title-only, invisible on mobile — render it; `missingPreconditions`
  re-spells `readyVerdict`'s ok-member predicate with no agreement pin; D-1030's recorded
  mechanism is a MIS-DIAGNOSIS (the real gate is colorless painters, not same-stylesheet — 15
  pre-existing census rules sit under colorless painters, sweep deferred + recorded); mutation
  totals off-by-one; row 5.4's dropped suite unexplained (drop was right, sentence missing).

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

**Wave 3 — F3: the per-project program-ready badge.** Spec:
`docs/superpowers/specs/2026-08-28-program-leverage-design.md` §5 (fetch `ws/brisk-meadow` from
origin). Same workspace as waves 1–2 (`quiet-meadow`, reclaimed). Server-side per-project
readiness from reads the server ALREADY owns — four preconditions: worker+coordinator skill
present in every rostered wrapper HOME (REUSE wave 2's `SkillState` vocabulary and
`server/src/skillstate.ts` reader — extend, don't duplicate; `single-definition` forbids a 2nd
copy), deviation floor seeded (coord.db), box token configured (measured at boot), coord DB
available (`not-configured` arm). Ships ADDITIVELY on an existing read the /runs board already
consumes (`GET /api/runs` summary or the coord status emit, `server/src/registry.ts:775-783` —
the plan picks the seam and says why); PWA: compact per-project badge on the /runs board
("program-ready" / list of missing preconditions). No new ccd verbs; reads only. Tests: every
precondition's measurement has an `unmeasurable` arm DISTINCT from false (no overloaded null);
a mutation test per precondition (delete the measurement → red); write pins BEFORE the prose
they pin (D-1009), and give every "behaviour unchanged" claim a fixture that could actually
witness the change (wave 2's sweep lesson). Wire: additive field, single reader, older-server
omission tolerated, no `FLEET_PROTO` bump. Fold: the graphify lane is now ON origin
(`ws/ccrc-with-graphify-integration`, `92bf6b76`, fetchable); its skill-convergence machinery
is bash/doctor-side — converge on the VOCABULARY, not the code; `single-definition.test.ts`
merges cleanly with it. Deviations from **D-1023** up. Commit on the workspace's own branch;
all coordinator mail names the new run's `runId`. Plan first (superpowers:writing-plans),
execute with superpowers:executing-plans. Deploy is not the worker's act.

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
