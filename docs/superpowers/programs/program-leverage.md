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
| 3 | F3 — per-project program-ready badge (server measurement; seam re-ruled to `GET /api/projects` + StartProgramSheet, D-1023) | run 14, PR #33 (merged `1f6ed803`) | done 2026-08-30 ~14:35 UTC — fix round `60bb451e` verified (all ten rulings landed, D-1034..D-1038), CI 5/5, merged, deployed server lane from the merge sha; `/health` reports `1f6ed803` (NOT agent-first — server+PWA only) |
| 4 | F4 — program kickoff rides the idle-gated mail lane (`queueSystemMail`), direct-injection race retired | run 16, PR #36 (merged `592ec425`) | done 2026-08-31 ~06:05 UTC — fix round `f1ccd9cd` verified hunk-by-hunk (all 8 rulings landed; worker found a THIRD supersession arm, the `finally`), CI 5/5, merged, deployed server lane from the merge sha; `/health` reports `592ec425` (NOT agent-first); D-1039..D-1046 consumed (block EXHAUSTED) + D-1119..D-1122 allocated |
| 5 | F5 — `POST /api/runs/:id/reclaim` (4th ungated door, dead-proof) + PWA resume affordance; door count → four; **corrects the coordinator corpus → AGENT-FIRST** | run 18, PR #37 (merged `6458a14d`) | done 2026-08-31 ~18:57 UTC — fix round `8262d2b3` verified hunk-by-hunk (all 11 rulings landed with measured reds), CI 5/5, merged, deployed **AGENT-FIRST** (fleet host then server; `ccd` and `/health` both report `6458a14d`, all live sessions verified active through it). Review was SHIP-WITH-FIXES: 3 majors + 1 raised to must-fix, 7 minors, 2 refuted. D-1123..D-1156 spent, floor 1157 |
| 6 | F6+F7a — `COORD_QUIET_MS`/`COORD_COOLDOWN_MS` for coordinator recipients + `POST /api/coord/caps` operator dial + D-1156's derived box-token census | run 19 | dispatched 2026-08-31 ~19:00 UTC (resumed quiet-meadow, brief queued, `skillState:present`) |
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

- **Wave 3 closes (2026-08-30 ~14:35 UTC):** fix-round wave-done (delivery 108) re-measured
  true — tip `60bb451e` = PR #33 head, CI run 33307756487 5/5 green on that exact sha,
  MERGEABLE/CLEAN, 0 behind. All ten rulings from mail 107 verified hunk-by-hunk across the
  four fix commits: **MAJOR 1** → `ReadinessDeps.localIo` consumer-declared port, production
  topology as a fixture in BOTH suites (fleet io refusing `.ccrc` beside a real local token ⇒
  `configured` AND a reachable `ready`; both collapses measured red, 11 module-level / 5
  call-site), cost prose corrected; **MAJOR 2** → spawn-chip-shaped `contrast.test.ts` pin over
  all FOUR entries (including minor 4's new `.proj-ready-why`, which shipped WITH its entry and
  pin, not after); minor 1 tick-dispatch pin (`expected undefined to be defined`); minor 3
  prefix-less field-pair twin scan allowlisting `shared/api.ts` alone, `NewSessionSheet`
  converted in the same commit (a FOURTH copy — D-1028 amended twice); minor 5 →
  `READINESS_CELL` single predicate table keyed by `ReadinessFacts` (a new precondition with no
  entry is a compile error), both consumers derive from it, exhaustive agreement test plus the
  27-case empty-list corollary; minors 2/6/7/8 recorded per rulings (D-1036: `configured` means
  readable, not usable — a green badge does not certify the next boot; D-1030 mechanism amended
  to self-grounded-host with the `chat.css` counter-example; totals corrected 21/20/1; row 5.4's
  drop explained). New deviations **D-1034..D-1038**; D-1037 defers the 15-rule
  colourless-painter census sweep with the measurement attached; D-1038 records the worker's own
  mutation-driver revert corruption (empty-string `replace` inserts at position 0 — both files
  repaired, the measurements stand, apply half was always correct). Process lesson carried
  (worker's words): its first MAJOR-1 fixture used a token path with no `.ccrc` and PASSED
  against the broken code — a fixture that cannot reproduce the topology proves nothing, the
  same class as wave 2's sweep lesson. Run 14 advanced working→awaiting-review→merging on the
  fresh fingerprint; PR #33 merged as `1f6ed803`; deployed server lane from a scratch worktree
  at the merge sha, `/health` reports `1f6ed803`, service stable (NOT agent-first). Items 4/4.

- **Wave 4 opens as run 16 and dispatches (2026-08-30 ~14:40 UTC):** opened BEFORE closing
  run 14 (the ordering rule — the program can never read zero open runs); run 14 then closed
  `done`, `released:false` (expected: run 16 holds quiet-meadow, hold rewritten
  `program:program-leverage wave:4/8`). Note the id: the server allocated **run 16**, not 15 —
  run ids are a global sequence shared with the other active program, never per-program. Wave-4
  mail therefore names **runId 16**. Dispatch resumed the workspace (`resumed:true`,
  `briefQueued:true`) and the wave-2 preflight measured `skillState:present` live.

- **Wave 4 verdict (2026-08-30 ~18:15 UTC):** wave-done (delivery 110) fingerprint `9df76bf0`
  (PR #36, CI 5/5 on that exact sha) verified by the server (dispatched→working→awaiting-review),
  items 4/4. Review: 6 lenses + per-finding refute-default verifiers, 26 agents; live
  re-measurement in a scratch worktree matched the record exactly (server 241 files/6021 passed/
  56 skipped, pwa 75/2007/0 type errors, 4 mutations re-run red with verbatim-matching first
  assertions — incl. the queue-not-inject pin on a live pane and the gate EXEMPT-insertion
  redding both directions). **18 confirmed (1 MAJOR, 7 minors, 9 notes), 2 refuted → fix round
  (mail 113).** MAJOR: `retryKickoff` lacks the `gen.current` supersession guard `finish()`
  carries — a retry settling after close navigates under the operator's feet or re-plants the
  cleared failure state. Minors: kickoff is the one system-mail producer with caller-supplied
  content and NO byte cap (bypasses `MAIL_BODY_MAX_BYTES`; fix in dispatch.ts's composed-body
  idiom); honest failure modes stop at 2 of the route's 4 codes (a 404 renders under copy
  asserting the session "is running"); `kickoffFailed` never cleared by a new `start()` (the
  file's own M3/timedOut class); the 'sends NO prose' pin greps a JSDoc line, not code (cannot
  fire — verifier re-simulated it); D-292 refusal copy hardened "may be mid-task" into an
  unmeasured factual claim (against plan task 6.9's own order); four stale api.prompt comments
  incl. the canonical header; record miscounts ("Twelve mutations" over a 19-row table; row 210's
  high-water claim false — tree high-water was D-1065, not D-1038, and the record's contiguous
  D-1046 tokens stayed green only *because* the claim was false). Notes: `queued:false` folds
  same-program vs cross-program refusal (wave 5 needs the distinction); `KickoffOutcome`
  re-declares `SystemMailQueued`'s union; repo CLAUDE.md's box-token WRITE sentence now has an
  unnamed session-gated exception (fold into wave 5's CLAUDE.md correction); typecheck-tests
  needs sibling packages' node_modules. Worker's brief-divergence ACCEPTED: the shipped
  queue-not-inject pin is a measured-stronger superset of the brief's literal spelling. Fix
  deviations: D-1046 then `ledger allocate` (block exhausted).

- **Wave 4 closes (2026-08-31 ~06:05 UTC):** fix-round wave-done (delivery 117) fingerprint
  `f1ccd9cd` re-measured independently (tip via ls-remote = PR #36 head, MERGEABLE/CLEAN, CI
  success on that exact sha) and verified **hunk-by-hunk against mail 113** — the waves-1–3
  precedent, no second workflow. All 8 rulings landed with measured-red pins (verbatim first-fail
  rows F1a..F6 appended to the plan's mutation table): the MAJOR shipped with THREE guarded arms,
  not two — the worker's own self-review found the `finally` (a superseded retry clearing
  `retrying` re-enables a button whose newer call is still outstanding; pinned as F1c, a write a
  superseded call must not UNDO, invisible to both write-pins). MINOR 6 escalated from copy to
  guard defect: the four D-292 suppression pins matched a sentence the wave had reworded — absence
  assertions, trivially green — re-pointed at `/two coordinators/i`, 11 red against an
  `!isOwnAttempt` mutant (second half of D-1122). `KickoffOutcome` now INTERSECTS
  `SystemMailQueued` (drift note acted on); the cap sits at `queueProgramKickoff` so wave 5's
  reclaim door inherits it (D-1119). **Scope declined and ACCEPTED by this review:** the retry
  door still renders for `unknown-session` — suppressing controls per code class would re-derive
  a server-stated distinction in the client for a harm of one wasted round trip; the copy no
  longer lies, which was the defect. Fold: PR #35 (`5d6c5c2d`, D-1068/D-1069) auto-merged clean
  mid-round, read semantically — its edits sit at the two STRUCTURAL mail gates that return
  before any send; `tellSender` fires only on the three post-send outcomes, so it is disjoint
  from D-1040 and refines (not extends) D-1045's park list; zero post-merge edits to either file.
  Suites after the round: server 241/6031/56, pwa 75/2014/0, agent 18/281, tails read. Advanced
  working→awaiting-review→merging on the exact reported fingerprint; merged `592ec425`; deployed
  the SERVER LANE from a scratch worktree at the merge sha, `/health` reports `592ec425`,
  service stable (NOT agent-first). Items 4/4. Deviation floor now 1123 — wave 5 allocates via
  `POST /api/ledger/deviations`, never from the exhausted block.

- **Wave 5 opens as run 18 and dispatches (2026-08-31 ~06:08 UTC):** opened BEFORE closing run 16
  (the ordering rule); run 16 then closed `done`, `released:false` (expected handover: run 18
  holds quiet-meadow, hold rewritten `program:program-leverage wave:5/8`). The worker's Claim 12
  (15 paths) released with the close — claims table empty, verified. Note the id: **run 18**, not
  17 — global sequence shared with the other active program, read from the open response. Wave-5
  mail therefore names **runId 18**. Dispatch resumed the workspace (`resumed:true`,
  `briefQueued:true`, `adopted:false`) and the preflight measured `skillState:present` live.

- **Wave 5, two operator rulings mid-wave (2026-08-31 ~12:18 UTC, worker finding 119):** twelve
  read-only scouts measured two things that defeated the spec as written; both went to the
  operator with evidence and are ruled. **Ruling 1 — the rewrite covers ALL the program's runs,
  terminal included.** `openRun`'s claimed-by-another guard (`store.ts:369-371`) and
  `resolveCoordinator(null)` (`store.ts:1188-1191`) run the IDENTICAL query —
  `SELECT claimedBy FROM runs WHERE program = ? AND claimedBy IS NOT NULL ORDER BY id LIMIT 1` —
  with **no state predicate and lowest-id-first** (re-verified on `origin/main` by this
  coordinator). At wave 5 the wave-1 run (run 10) is `done` and holds the lowest id, so a
  non-terminal-only rewrite leaves BOTH readers naming the dead session: the door would answer
  `ok` while the program stayed wedged at exactly the boundary it was wedged at. Attribution moves
  from the column into `run_events` (one row per run, `causedBy:'operator'`, old → new). The
  rejected alternative (state predicates on those two queries) was measured worse — it makes
  `resolveCoordinator(null)` answer null in the close-then-open window. **Consumer-side evidence
  added by this coordinator:** the only `claimedBy` readers outside the store are
  `pwa/src/fleet/nestFleet.ts` (the /runs board's parent edge, already filtered by `onList`, so a
  dead coordinator's edge is dropped TODAY — the rewrite restores nesting rather than falsifying
  it) and `watch.ts:2705` (mail sender resolution, which is the door's whole point). Nothing reads
  a terminal run's `claimedBy` as an archival record of who ran wave N, so the move loses nothing
  measurable. **Ruling 2 — the wave is AGENT-FIRST.** The shipped corpus asserts the opposite of
  this door: `resume.md:38` ("The refusal is PERMANENT … nothing in the HTTP API ever rewrites
  `claimedBy`"), `resume.md:110`, `SKILL.md:31`. The pin asserts PRESENCE
  (`coordinator-skill.test.ts:1053`), so the suite stays green while the runbook tells every
  revived coordinator its program is unrecoverable — standing in front of the one door built for
  it. Corrected in THIS wave, without naming the route (forbid-mention + the UNGATED harvest at
  `:1082-1105` + auth-passkey's method-spelling sweep all forbid it). **Bound this coordinator
  measured and mailed back:** clause 8 itself (`:112`) stays TRUE and must NOT be touched — a
  softened clause is a red suite; what F5 falsifies is the PERMANENCE prose, none of which is a
  numbered clause, and exactly ONE verbatim pin reads it.
- **Wave-5 findings the worker decided itself, all three confirmed by this coordinator:** (1)
  "REUSE `queueProgramKickoff`" from the brief is **superseded** — its L0 composer
  `programKickoff()` hardcodes "open the run for wave 1" (`shared/api.ts`), so a wave-aware
  re-kickoff needs a sibling composer and a widened seam; wave 1's own corpus already anticipated
  this (`coordinator-skill.test.ts` "carries a wave-N re-kickoff template, not the wave-1 text the
  machine hardcodes"). What is reused is the LANE (`queueSystemMail` + D-1119's composed-body cap),
  not the sentence. (2) The UNGATED "two-direction pin" both the brief and root CLAUDE.md describe
  is only half-measured — nothing asserts a listed door is actually ungated; wave 5 writes the
  missing direction. (3) A new kebab refusal code cannot join `RunRefuseCode` without forcing the
  word into the corpus that must not name the door. Deviations **D-1123..D-1140** (floor 1141),
  Claim 14 (30 paths).

- **Wave 5 verdict (2026-08-31 ~17:20 UTC):** wave-done (delivery 121) fingerprint `963889bf` (PR #37,
  MERGEABLE/CLEAN, CI 5/5 on that exact sha) verified independently, run advanced
  dispatched→working→awaiting-review, items 4/4. Review: 8 lenses + per-finding refute-default
  verifiers, **47 agents**, 0 errors. **22 confirmed (3 MAJOR + 1 raised by this coordinator, 7
  minors, 11 notes), 2 refuted → fix round (mail 123)**, run returned to `working`. Verified clean by
  the coordinator's own reading: the R2 corpus correction (no numbered clause touched, the false
  permanence sentence pinned ABSENT in both files and the true one PRESENT, door path named nowhere,
  runbook pointed at the operator console exactly as ruled), the three-answer ladder's structure
  (`readSessionRecord` over `readRegistry`, `sessionVerdict` over `hasSession`, `restarting` and
  `unmeasurable` both answered `alive` — fail-shut), the one-transaction commit, and ResumeSheet's
  supersession guards on all three doors with no `finally` (wave 4's D-1046 lesson landed).
  **MAJOR 1:** reclaim rewrites `runs.claimedBy` and nothing else, so mail already queued to the
  corpse strands — reproduced end-to-end, and the sweep then walks it to `undeliverable`, losing a
  worker's report; the corpus THIS wave edited sends the heir to that empty box. Ruled: repoint
  inside the same transaction, letting `mail.toId` decide (role-addressed follows the role,
  id-addressed stays, acked never moves). **MAJOR 2:** the door is unreachable from the PWA when every
  run is terminal (`resumeButton` gated on `!isRunClosed`), which is exactly the state `closeRun`
  produces at zero open runs; verified live that the server half lifts the wedge there and the
  operator cannot ask for it. Ruled: gate on the PROGRAM, not the row. **MAJOR 3:** the wave shipped
  **no execution record** — 113 `<measured at execution>` placeholders, zero verbatim first-fail
  rows, nine of ten mutation tables unfilled, against four prior waves at zero placeholders; the
  handoff's own "ten rows green or red for the wrong reason" claim rests on rows nobody else can
  locate. **RAISED by this coordinator from minor to must-fix:** rung 1 folds "no `.uuid` in the
  listing" with "listed but could not be ASSEMBLED" and answers `dead` before tmux is consulted — so
  a live coordinator mid-write can be reclaimed out from under itself; the mail ingress 500 lines
  away already ships the exact split (`names.includes(<id>.uuid)`). Minors: CLAUDE.md's new
  "whole box-token surface" sentence is false (four token-gated routes live outside both prefixes);
  the new open-run arm masks wave 4's kickoff-failure recovery doors; `api.kickoff`'s promised
  truncated-body degrade is unimplemented (a regression); the borrowed integer check dropped
  `wave < 1`, so a brief naming wave 0 queues AND takes the dedupe key; a re-kickoff queued before a
  reclaim still briefs the displaced session (cancel, don't repoint); the `fleetFrameSeen` pin cannot
  fire (mutation survives the whole PWA suite, measured); D-1125 named two sites of the falsified
  sentence and only one was corrected. **Verification gap stated in the ruling:** pwa 76/2077/0 was
  independently reproduced twice; the server total was NOT (targeted suites only), so this
  coordinator ran the full server suite itself in a scratch worktree at `963889bf` — **244 files /
  6108 passed / 56 skipped, exit 0, 294s — an exact match** to the worker's claim (mail 124). The
  whole handoff baseline is therefore independently confirmed, and fix-round totals are a delta
  against 244/6108/56 and 76/2077/0. **Coordinator ruling on the deferred README staleness:** wave 5 was
  right to leave it — neither passage went stale from this wave (the run-route sentence already
  omitted `/:id/items` and misdescribed `/:id/abandon`; the "nine coordination routes" count is stale
  by nine). Both belong to **wave 6**, which adds `POST /api/coord/caps` and so changes that count —
  the rule that made F1 and F5 each write the count they changed — and wave 6 should extend wave 5's
  own derivation machinery (door count derived from `UNGATED.size`) to the README rather than
  hand-correcting prose that will rot again.

- **Wave 5 closes (2026-08-31 ~18:57 UTC):** fix-round wave-done (delivery 125) fingerprint
  `8262d2b3` re-measured independently (tip = PR #37 head, MERGEABLE/CLEAN, CI success on that exact
  sha) and verified **hunk-by-hunk against mail 123**. All 11 rulings landed with measured reds, and
  three of them came back better than ruled: MAJOR 1's repoint keys on the set of ids the UPDATE
  actually displaced (not just the named run's claimant) and its read-side exclusion was measured
  reader-by-reader, catching a consequence this coordinator did not anticipate — a cancelled kickoff
  would otherwise have stayed abandoned-and-visible FOREVER on the corpse's own `toId`, re-entering
  the two-coordinator hazard through the READ side once ccd recycled the slug; the cancel is ordered
  BEFORE the repoint purely so an over-broad-cancel mutation can be detected (repoint-first, that
  mutant goes green); and MUST-FIX 4's rung-1 re-split answers `unmeasurable` when the confirming
  re-listing itself fails — fail-shut. **The sharpest find of the round is the worker's on my
  behalf:** MAJOR 2 was not unpinned, it was *pinned by a green test* — "hides it on a closed run —
  a finished wave has no coordinator to bring back", whose fixture is literally the all-terminal
  program with a dead coordinator, asserting the door absent. A pin on the defect. MAJOR 3's record
  was recovered from session transcripts (the ten executing agents had measured their reds; the
  write-back was lost to a compaction): 112 fillable cells, 112 filled, 0 fabricated, table
  cross-counted 124 two ways, and step 11.3's question answered honestly — YES, guards shipped with
  no row, and the review found them rather than the record. Suites: server 244/6131/56 (+23), pwa
  76/2085/0 (+8), agent 18/281 untouched; CI green on the exact sha is the independent check on the
  deltas, the baseline having been confirmed exactly beforehand. Advanced
  working→awaiting-review→merging on the reported fingerprint; merged `6458a14d`; deployed
  **AGENT-FIRST** from a scratch worktree at the merge sha — fleet host first (`ccd` reports
  `6458a14d`, ~20 live `claude-session@*` units verified active through it), server second
  (`/health` reports `6458a14d`, `dirty:false`). Items 4/4.
- **Two coordinator rulings on what wave 5 deliberately did NOT fix** (both deferred to waves that
  already own the surface, per the lesson below — they go in those waves' BRIEFS, not in follow-up
  mail): **(1) the ~15.5-minute repoint window.** `MAIL_MAX_ATTEMPTS` is 6 on a 30s doubling, so a
  never-delivered mail to a provably-dead coordinator parks `undeliverable` about fifteen and a half
  minutes after queueing; arm (c) then has nothing outstanding left to repoint and the worker's
  report stays on the corpse. The worker followed the ruling exactly rather than widening it, which
  was right — re-queueing a parked row changes `MailDeliveryState` terminality, an invariant the root
  CLAUDE.md already flags as incompletely enforced. **Split across the two waves that already own the
  halves: wave 7 (F7) surfaces parked mail on the health board — its scope line already says so — and
  wave 8 (F8) owns the terminality audit and takes the fifth arm (re-queue a `rejected('undeliverable')`
  role-addressed delivery of this program whose `lastError` names a dead recipient) as a NAMED task,
  reading every writer as it goes.** Neither half is dropped and neither needs a new wave.
  **(2) the prose-census defect (D-1156).** Three sites state a box-token surface no mechanism checks:
  the CLAUDE.md sentence wave 5 corrected is itself UNPINNED (measured — the false sentence was
  restored and the suite stayed green), README:528-531 says "nine box-token-gated coordination routes"
  where `requireMailToken` guards ELEVEN, and README:1403-1407 calls "the run routes" gated as a class,
  false since Build 4 for `/:id/abandon` and now `/:id/reclaim`. The worker was right not to write the
  scanner: it reds the build until all three are corrected, so mechanism and corrections must land
  together. **Wave 6 takes all of it** — it adds `POST /api/coord/caps` and therefore changes that
  count anyway (the rule that made F1 and F5 each write the count they changed), and it should DERIVE
  the surface from the `requireMailToken`/`checkMailToken` call sites rather than hand-correcting
  prose that will rot again. Fold in the small one too: `coord/routes.ts`'s two other `runId` body
  readers still carry no lower bound, so the convention is inconsistent across three readers.

- **Wave 6 opens as run 19 and dispatches (2026-08-31 ~19:00 UTC):** opened BEFORE closing run 18
  (the ordering rule); run 18 then closed `done`, `released:false` (expected handover — run 19 holds
  quiet-meadow), and **Claim 14 released with the close** (claims table empty, verified). Wave-6 mail
  names **runId 19**. Dispatch resumed the workspace (`resumed:true`, `briefQueued:true`,
  `adopted:false`), preflight `skillState:present`. The brief carries both deferred rulings as its
  item 3 and, per the lesson below, states the agent-first escalation rule UP FRONT: if a finding
  pushes wave 6 into `ccd/coordinator-skill/`, the worker mails BEFORE implementing, because it
  changes the coordinator's deploy lane.

## Carried constraints

- **A steering mail sent mid-wave may arrive AFTER the work it was meant to steer** (measured
  2026-08-31, wave 5): the coordinator's corpus bound (mail 120, sent ~12:20 UTC) sat gated
  `not-idle` for **722 delivery attempts** and reached the worker only after the corpus commit AND
  after the wave-done — because the session never idled between planning and handoff. The idle gate
  is working as designed; the lesson is about what may be entrusted to it. **Any constraint that must
  SHAPE implementation belongs in the dispatch brief; follow-up mail is advisory and post-hoc by
  default.** Wave 5 survived on the worker independently arriving at the same design and then
  MEASURING the shipped commit against the bound (mail 122) — corroboration, not a mechanism. When a
  bound cannot wait for the next wave's brief, treat delivery as unproven until the worker's ack
  shows in `GET /api/runs`'s `unreadMail` dropping, and say in the mail itself that it may arrive
  late so the worker measures rather than assumes.
- Waves 1, **5** and 8 are **AGENT-FIRST** deploys (wave 1 and wave 5 touch
  `ccd/coordinator-skill/`, wave 8 the agent's IO half). **Wave 5's classification CHANGED
  mid-wave** (operator ruling 2026-08-31): its brief said NOT agent-first, and the corpus
  correction the ruling requires puts two markdown files under `ccd/coordinator-skill/` in the
  diff — fleet host first, then server. No `ccd/ccd`, no `session-hook.sh`, no worker corpus.
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

**Wave 6 — F6+F7a: the coordinator quiet window and the caps route.** Spec:
`docs/superpowers/specs/2026-08-28-program-leverage-design.md` §8 (fetch `ws/brisk-meadow` from
origin; the ledger on that ref carries this brief and wave 5's close record). Same workspace as
waves 1–5 (`quiet-meadow`, resumed). Two independent pieces plus a census obligation.

(1) **`COORD_QUIET_MS` / `COORD_COOLDOWN_MS` for coordinator recipients.** The mail lane's composed
wake floor is ~60–74s per event and at most one machine wake per ~2 minutes (`MAIL_QUIET_MS=60_000`,
`MAIL_COOLDOWN_MS=120_000`, `watch.ts:176-188`) — right for a worker mid-thought, wrong for a
coordinator idling AT a wave boundary BY DESIGN, because clause 7 mandates it end its turn and wait.
In `sweepMail`, a recipient that is the `claimedBy` of a NON-TERMINAL run uses `COORD_QUIET_MS`
(proposed 15s) and `COORD_COOLDOWN_MS` (proposed 30s); one read per sweep, cached for the sweep.
Workers (run `sessionId`s) and every other session are untouched. Both constants defined ONCE beside
the existing pair, single reader each. Tests: a coordinator recipient delivers inside `MAIL_QUIET_MS`
while respecting `COORD_QUIET_MS`, AND a worker does NOT get the narrow window — that second one is
the guard's mutation direction and the half a careless fixture omits.

(2) **Caps become an operator control.** `POST /api/coord/caps` — an ordinary PWA-surface write:
session-gated when armed, open dark, **NOT box-token** (an operator dial, not a machine lane) and
**NOT ungated** (raising a cap is not a release valve — the D-282 family is for wedges only, and
this door must NOT join `UNGATED`). Body partial `{maxConcurrentWorkers?, maxSessionsPerDay?}`,
bounds-checked; wires `CoordStore.setCaps`, which today has NO caller in `server/src` (caps change
only by hand-editing sqlite). A `run_events` row is wrong here — there is no run — so a feed event
records the change. PWA control beside the /runs board's pause control, showing current usage vs cap
(`capsUsage` is already computed). Tests: gate posture pinned dark-vs-armed with exact status
equality, bounds, and a `setCaps`-has-exactly-one-caller pin.

(3) **THE PROSE-CENSUS DEFECT IS YOURS, mechanism and corrections in ONE change (D-1156, ruled by
the coordinator at wave-5 close).** Three sites state a box-token surface nothing checks: the
`CLAUDE.md` sentence wave 5 corrected is UNPINNED (wave 5 measured it — restoring the false sentence
left the suite green); `README.md:528-531` says "nine box-token-gated coordination routes" where
`requireMailToken` guards ELEVEN; `README.md:1403-1407` calls "the run routes" gated as a class,
false since Build 4 for `/:id/abandon` and now `/:id/reclaim`. Wave 5 was RIGHT not to write the
scanner alone — it reds the build until every site is corrected, so mechanism and corrections must
land together, which is exactly why this belongs to the wave that changes the count anyway: you are
adding an eleventh-plus route. **DERIVE the surface from the `requireMailToken`/`checkMailToken`
call sites and assert no prose site under-claims it** — the shape wave 5 used for the door count
(`UNGATED.size`), not a hand-corrected sentence that rots again. Fold in the small one: `coord/routes.ts`'s
two other `runId` body readers still carry no lower bound, so the convention is inconsistent across
three readers (wave 5 fixed only the third).

Wire: additive-only, single reader per field, older-peer omission tolerated, no `FLEET_PROTO` bump,
no new ccd verbs, no overloaded null at any new seam. Mutation-table discipline: every guard ships
WITH a test measured red on its deletion, TDD red-first, **verbatim first-fail rows written AS YOU
GO** — wave 5 shipped its record only after a review caught its absence, and the cause was a
compaction between measuring and writing back. Count the table twice. Every "behaviour unchanged"
claim gets a fixture that could witness the change, and watch for wave 5's own recurring class: an
absence assertion whose fixture cannot produce the presence, and a pin whose premise (a hydrated
store, a populated set) is never established. **Deviations: allocate every number from
`~/.local/bin/ccrc-api ledger allocate` (floor 1157) — the program block and D-1119..D-1156 are all
spent.** NOT agent-first (server + PWA + root docs only — no `ccd/`, no `session-hook.sh`, no skill
corpus; if a finding pushes you into `ccd/coordinator-skill/`, mail me BEFORE implementing, because
it changes my deploy lane). Commit on the workspace's own branch (`ws/quiet-meadow`), never a feature
branch. All coordinator mail names runId <the new run's id, in the dispatch>. Plan first
(superpowers:writing-plans), execute with superpowers:executing-plans. Deploy is not the worker's act.

---

Prior wave's brief (wave 5, retired — kept for the record):

**Wave 5 — F5: coordinator resume — the reclaim door and the PWA affordance.** *(This is the
brief AS SENT on 2026-08-31 ~06:08 UTC, kept as the record. **Two sentences in it are SUPERSEDED**
by the operator rulings of ~12:18 UTC — see the Decisions entry above: the rewrite covers ALL the
program's runs, not only the non-terminal ones; and the wave is **AGENT-FIRST**, not "NOT
agent-first", because the corpus correction puts `ccd/coordinator-skill/` in the diff. A third
line is corrected by measurement: "REUSE wave 4's mail-lane kickoff" reuses the LANE, not
`programKickoff()`, whose text hardcodes wave 1.)* Spec:
`docs/superpowers/specs/2026-08-28-program-leverage-design.md` §7, operator ruling §11 (fetch
`ws/brisk-meadow` from origin). Same workspace as waves 1–4 (`quiet-meadow`, reclaimed). The
wedge: `claimedBy` is written once by `openRun`'s INSERT and nothing rewrites it — a dead
coordinator whose id cannot be re-landed wedges the program `claimed-by-another` permanently.
Build `POST /api/runs/:id/reclaim`, the FOURTH ungated operator door (same D-282 logic as
abandon: the release valve must not sit behind the wedged party's key), **dead-proof by operator
ruling**: the guard is a RE-MEASUREMENT, not a credential — refuse `claimant-alive` unless the
current `claimedBy` session is measured dead/absent (registry row proven absent from a LISTED
directory, or present with a gone/dead tmux verdict); an unmeasurable registry refuses
`registry-unmeasurable`, NEVER proceeds (no overloaded arms — unmeasurable ≠ alive ≠ dead). Body
`{claimedBy: <new id>}`, shape-checked, new claimant must exist in the registry; rewrite
`claimedBy` on the program's non-terminal runs in ONE transaction with a `run_events` attribution
row each (`causedBy:'operator'` hardcoded, like abandon's). Ungated-set obligations:
`coord-pause-route.test.ts`'s `UNGATED` grows to four (two-direction pin); NOT in the auth gate's
EXEMPT table (armed → session-gated, strengthening D-282 like the existing three); the skill
corpus must NOT name it (parity-EXEMPT + forbid-mention pin, like `/api/claims/:id/break`).
**Root CLAUDE.md is corrected BY this wave, once:** door count → four, AND fold in the box-token
sentence's now-unnamed exception (wave 4's `POST /api/sessions/:id/kickoff` is a coordination
WRITE that is session-gated only — recorded in wave 4's plan notes). PWA resume affordance: the
/runs board detects an open run whose `claimedBy` session is dead and offers in order
revive-same-id (`ensure`), wave-aware re-kickoff (REUSE wave 4's mail-lane kickoff —
`queueProgramKickoff` is importable without the route, and the composed-body cap D-1119 is
inherited by calling it; the text template comes from wave 1's runbook), and reclaim onto a named
live session only when the id cannot be revived. StartProgramSheet refuses to start a NEW program
for a project with an open run (today it refuses only on a live main checkout). Known fold you
inherit (wave 4 plan, notes): `queueProgramKickoff`'s `queued:false` folds "this program's
kickoff already waiting" with "a DIFFERENT program's kickoff waiting" — the re-kickoff lane is
the first consumer that may need them apart; open the fold only if you actually consume the
distinction, and record the decision either way. Tests: dead-proof mutation table (alive →
`claimant-alive`; unmeasurable → `registry-unmeasurable`; dead → rewritten + event rows; terminal
runs untouched); gate-posture pinned dark-vs-armed with exact status equality; every guard ships
WITH a test measured red on its deletion, TDD red-first, verbatim first-fail rows in the plan's
mutation table; every "behaviour unchanged" claim gets a fixture that could witness the change.
Wire: additive-only, single reader per field, older-peer omission tolerated, no `FLEET_PROTO`
bump, no new ccd verbs, no overloaded null. **Deviations: the program block (`D-999..D-1046`) is
EXHAUSTED and D-1119..D-1122 are consumed — allocate from `POST /api/ledger/deviations` (floor
1123); if the allocator is unreachable write `D-TBD-program-leverage` and it reconciles at
review.** NOT agent-first (server+PWA+root docs only). Commit on the workspace's own branch; all
coordinator mail names the new run's `runId`. Plan first (superpowers:writing-plans), execute
with superpowers:executing-plans. Deploy is not the worker's act.
