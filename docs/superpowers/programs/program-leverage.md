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
| 6 | F6+F7a — `COORD_QUIET_MS`/`COORD_COOLDOWN_MS` for coordinator recipients + `POST /api/coord/caps` operator dial + D-1156's derived box-token census | run 19, PR #39 (merged `6ee36ca5`) | done 2026-09-01 ~22:48 UTC — TWO fix rounds plus a renumber. Round 1 (`ff85c514`) answered 3 must-fixes; the worker then AUDITED ITS OWN FIX ROUND (88 agents) and found **4 majors, 3 of them the same guard-with-no-mechanism fault** (`eee5fa1a`). Coordinator verification: 13 lenses, 7 running real mutations in isolated checkouts — **3/3 must-fixes and 4/4 self-audit majors hold**, zero code majors. Then BLOCKED: PR #41 merged at 21:54 taking D-1159/1160/1161, so `deviation-refs` red on the merged tree; renumbered to D-1240..D-1242 (`1c7ccb06`). CI 5/5, merged, deployed **server lane** from the merge sha; `/health` reports `6ee36ca5` (NOT agent-first). D-1163..D-1172 + D-1208..D-1242 spent, floor 1243 |
| 7 | F7 — program health on the board (parked mail, replay high-water, rejection counts, un-briefed coordinator) **+ the ledger-allocation guard, three incidents behind it** | run 28, PR #43 (merged `5e9f650d`) | **done 2026-09-02 12:43 UTC** — THREE rounds. Review SHIP-WITH-FIXES (5 must-fix, 1 major, 1 minor); fix round verified all six HOLD under mutation; a third bounded round of six with the merge committed in advance, which the worker answered plus a seventh it found scanning its own diff for the class. Final verification: **zero not-landed, zero blocking**, all four earlier-round mutations still red. CI 5/5 on `36859151`, merged, deployed **server lane** from the merge sha; `/health` reports `5e9f650d`. D-1293..D-1332 — **40 allocated, 40 defined, zero collisions** |
| 8 | F8 — measured-read completion (`readFileB64`/`readFileFrom`, agent `stat` EACCES lie) + `MailDeliveryState` terminality audit **+ THE LEDGER PROCEDURE: root CLAUDE.md's grep instruction is the generator of all three collisions**. AGENT-FIRST deploy. **Inherits three:** the fifth repoint arm, `ccd/ccrc-api:32-38`'s stale two-door census, and wave 7's twelve prose/guard carries | run 30 | planned 2026-09-02 12:44 UTC |

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

- **Wave 6 pre-implementation flags, all six adjudicated (2026-08-31 ~19:20 UTC, worker finding 128,
  coordinator ruling mail 129):** the worker measured before planning and mailed early, which is the
  carried constraint below working as intended. **Three design calls ENDORSED as framed.** (1)
  `GET /api/coord/caps` alongside the POST — a board cannot render usage-vs-cap without a read, and
  bolting caps onto the `{type:'coord'}` frame would cost `emitCoord` the no-try/catch property its
  docstring earns by touching no `node:sqlite`, then re-emit on nearly every 2s tick because
  `dispatchedIn24h` drifts with the clock; required: same gate posture as the POST pinned both ways,
  and ONE shared caps shape. (2) **A SECOND NAMED SET** for session-only PWA-surface writes — the
  best call in the mail: `coord-pause-route.test.ts`'s direction-one asserts every `app.post` in
  `coord/routes.ts` without a box-token gate IS in `UNGATED`, so the brief's "neither box-token nor
  ungated" is a contradiction until a second set names it. Registering the route in `server.ts`
  instead would have "resolved" it by leaving the scanner's reach — precisely wave 5's minor 5
  blind spot, which is how `POST /api/sessions/:id/kickoff` escapes that scanner today. **BINDING:
  the new set ships with BOTH directions from birth** — a one-way set is D-1128, the defect wave 5
  just fixed. `UNGATED.size` stays four so no prose cardinal moves. (3) A **seventh `NotifyEvent`
  kind `'coord'`** rather than riding `'run'` — there is no run, so `'run'` would be an overloaded
  value at a seam readers branch on; additive, no `FLEET_PROTO` bump, `isNotifyKind` degrades an
  older peer to `'unknown'`.
- **Wave 6 also folds in a finding the ticket never named, and corrects a ruling of this
  coordinator's.** `auth/gate.ts:75,77,80,90,663` says SEVENTEEN box-token lanes / "All eighteen"
  against a measured eighteen in `coord/routes.ts` plus `/api/notify` = nineteen — and `:80` is wrong
  in KIND, not only number: five of the eighteen take a session cookie, so they do not "refuse every
  verdict but `ok`", which is a false statement about an AUTH surface and outranks the cardinal
  (`auth-gate.test.ts:401,438` carry the same off-by-one in their TITLES over a correct 18-element
  assertion). Folded into item 3: same defect family, same file class. **The correction to my own
  ruling:** I ruled "derive the surface and assert no prose site under-claims it" on the premise of
  ONE surface; the worker measured THREE different sets — README:530's hard-require, `gate.ts`'s
  lanes-that-consult including the five dual-credential GETs, and D-1156's own `requireMailToken`
  sites (eleven). A scanner built on my premise would demand one number from passages legitimately
  describing different things, and would force the prose to become wrong to satisfy it. **Accepted:
  the mechanism NAMES the set each site speaks of and the prose is rewritten to speak it.** Also
  corrected by measurement: "`capsUsage` is already computed" (mine, inherited from the spec and
  never measured) is true server-side but reaches the PWA nowhere — zero occurrences in `pwa/src`,
  `CoordStatus` carries only `{pause,mail}`, no route — which is why design call 1 is the missing
  half of item 2 rather than scope creep.
- **Escalated out of wave 6 → WAVE 8 (agent-first):** `ccd/ccrc-api:32-38` states the ungated set as
  TWO ("D-282 leaves that door and `POST /api/runs/:id/abandon` ungated on purpose"), stale against
  four. It is a shipped bash client under `ccd/`, so touching it would silently convert wave 6's
  deploy lane — the worker reported and did not fix, which is exactly the escalation the brief asked
  for. Wave 8 now carries THREE inherited items (the fifth repoint arm, the terminality audit's own
  scope, and this). Instruction already given: build wave 6's set-naming mechanism so wave 8 can
  POINT it at that prose rather than redesign it — `ccrc-api.test.ts:138-152` scans the ROUTES table
  but never the prose, the same one-way shape as everything else in this ruling.

- **The D-1157/D-1158 ledger collision, adjudicated (2026-08-31 ~22:30 UTC, worker D-1210):** PR #38
  (`fix/d1070-divergence-census-units`, merged `d3de4ec7` at 21:31) DEFINES `D-1157` and `D-1158` in
  shipped source (`divergence.ts`, `fleet.ts`, `watch.ts`, two test files) and in a doc FILENAME.
  Measured against the allocator: **those two numbers were allocated to wave 6 (`quiet-meadow`) at
  ~19:58 and to nobody else — PR #38 defined numbers it never allocated.** So the worker's framing was
  off: this was not two lanes racing from one stale floor (the stage3a/fleetio shape), and the cited
  "merged-first keeps them" precedent does not apply. Wave 6 held the stronger claim on both counts.
  **The OUTCOME still stands — wave 6 yields — for a different reason:** #38's numbers are already in
  merged source and in a filename, and rewriting merged `main` is dearer and riskier than renumbering
  an unmerged branch. **Corrected precedent for the rest of this program: the branch that can still
  move cheaply moves, regardless of who allocated first.** Verified the renumber was executed
  correctly — every surviving `D-1157`/`D-1158` reference in the tree carries #38's meaning; wave 6's
  only mentions are its own narrative. No dangling refs.
- **The mechanism gap behind it is the durable finding, and it is nobody's discipline failure: there
  are TWO SOURCES OF TRUTH for one sequence.** The allocator issues numbers from `coord.db`;
  `deviation-refs.test.ts` derives the high-water from `## Deviations found` definition lines under
  `docs/superpowers/plans/`. Neither consults the other, and the scanner only rejects refs ABOVE the
  high-water — so an unallocated number BELOW it is invisible and both branches were green
  simultaneously. Any lane can repeat this tomorrow. **Placed on WAVE 7** (the measurement wave): a
  guard that every `D-N` DEFINED in a plan has an allocation row for this project whose holder matches
  the branch, and that the allocator's floor and the plan-derived high-water agree. Second, smaller
  finding recorded with it: ledger rows 1157/1158 now record a falsehood and **there is no client verb
  to correct them** — `ccrc-api ledger` exposes only `allocate` and `list`, though the rows carry a
  `stale` boolean something evidently expects to set.

- **Wave 6 verdict (2026-09-01 ~00:55 UTC, mail 138):** wave-done superseded once — the worker took a
  ruling round AFTER claiming done, because mail 129 reached it 1h42m late (911 gated attempts), and
  named that as its own clause-9 breach rather than letting the review find it. Fingerprint
  re-measured at the NEW tip `44851b0a` (tip = PR #39 head, CLEAN, CI 5/5); the delta is one commit,
  +81/−4. Review: 8 lenses + refute-default verifiers, **44 agents; 17 confirmed (0 MAJOR, 11 minors,
  6 notes) + 2 from the re-measurement lane, 8 refuted** → fix round, run returned to `working`.
  **No majors, and that is earned:** the worker's own adversarial round caught the one that mattered
  (a caps read-modify-write straddling the mutex) before handoff. **The three must-fixes are this
  wave's own theme turned on itself — a claim with no mechanism.** (A) The lost-update guard was
  recorded as UNMEASURABLE ("no fixture in this suite can stage a third actor"); a reviewer built the
  witness in ~45 lines from helpers that file already imports — `POST /api/runs` awaits `runCcd` for
  `ws-hold` INSIDE `coordMutex.run` — and measured it GREEN on the tip, RED on the revert. Unmeasured,
  not unmeasurable: the very distinction the worker itself insisted on for SESSION_ONLY. (B) **My own
  ruling's fix ships with no mechanism** — restoring the pre-ruling inline GET body is tsc-clean and
  leaves all ten caps-touching suites green, and the mutation row recorded for it measures a
  value-change, not the shared shape. I asked for the fix and did not ask for its witness. (C)
  `void log.flush()` sits inside the try AFTER `recordFeedEvent`, which throws synchronously — so on
  exactly the failure the try/catch exists for, a seq already handed to the client is never persisted,
  verbatim the hazard `flush`'s own docstring names. Three independent lenses landed on that line.
  Minors include two mechanism holes in the new census (its numeral pins compare an unordered SET, so
  transposing eighteen/nineteen between claims stays green — the KIND half of D-1161's own defect; and
  its CLAUDE.md over-claim assertion is a tautology by construction whose failure message promises a
  check it cannot do) and, sharpest for irony, **README:1455 reintroduces a hand-kept cardinal about
  `UNGATED.size` in the one paragraph the new census does not scan** — in the wave built to delete
  that class, about the very count already stuck at "two" in `ccd/ccrc-api`.
- **Review-integrity note, recorded because it changed two dispositions:** two verifier agents died on
  API errors and this coordinator's scoring counted an absent verdict as a refutation. Both were
  adjudicated by hand instead: the `req.body ?? {}` claim is REFUTED in substance (a null body routes
  to the "asks for nothing" refusal; only the `body === null` sub-arm is dead code), and D-1165's
  durable rejection record IS unpinned (the tests assert status/error/detail while the comment claims
  the mislabelled record is part of the fix). **A verifier that does not answer is not a refutation** —
  the scoring should distinguish them, and until it does the coordinator reads the empty ones by hand.
- **Wave 6's own correction to this coordinator's carried constraint:** the 911-attempt delay is NOT
  what `COORD_QUIET_MS` addresses, and the worker refused the credit. That constant narrows the window
  for the `claimedBy` of a non-terminal run — the COORDINATOR. The party blocked here was the WORKER
  mid-wave, which is precisely the session the 60s floor exists to protect; the gate did its job. What
  911 attempts on one delivery argues for is a way for a worker to LEARN that steering mail is
  waiting — **wave 7's board**, whose §9 already names replay counts approaching the ceiling as a
  signal that surfaces nowhere. Recorded as wave 7 scope, not as a thing wave 6 fixed.
- **Wave-6 fix round VERIFIED, and blocked on a ledger collision that is not its own (2026-09-01,
  ruling mail 184, run 19 → `working`).** The worker answered the ruling in `ff85c514`, then AUDITED
  ITS OWN FIX ROUND before sending (88 agents) and found **four majors, three of them the same fault
  it had just been sent back for** — a guard shipped with no mechanism. Sharpest: **D-1228 — the new
  lost-update witness asserted that `POST /api/runs` ANSWERED 200, not that the mutex was HELD**, so
  reverting D-1170 *and* stripping `coordMutex` off that route left the witness green with the lost
  update present. That is the D-1215 defect, in the commit that fixed D-1215. All four were re-fixed
  in `eee5fa1a`.
- **Independent verification: 13 lenses, seven working in isolated full checkouts at the tip so they
  could RUN the mutations rather than read about them. 3/3 must-fixes and 4/4 self-audit majors HOLD**,
  each with a verbatim first-fail. Must-fix A reds on the D-1170 revert with the lost update itself
  (`maxConcurrentWorkers: 3` where 5 was expected) while its sibling stays green — confirming by
  measurement the sibling's own claim that it cannot see the hazard; under the two-part mutation the
  witness reds EARLIER, on premise 2 (`settled` = `[200,200]` vs `[]`), i.e. it **self-invalidates
  rather than passing vacuously**. Must-fix B reds under a faithful inline rebuild. Must-fix C's flush
  is in a `finally` and its throw arm now reads its own `warn` spy. `auth/gate.ts`'s +9 is
  COMMENT-ONLY — the exempt set is byte-identical, checked because a wave that edits the
  authentication gate's docstring in its last commit deserves that check. **Zero code majors.**
- **BLOCKER — the ledger collision fired a THIRD time, and this one lands on wave 6.** PR #41
  (`fix/d1159-install-agent-build`) merged at **21:54 UTC**, ten minutes before the verification
  finished, taking **D-1159, D-1160 and D-1161** with entirely different subjects and with the numbers
  in three FILENAMES. Measured, not argued: cloning the wave-6 tip, merging `origin/main` (47ac50da,
  clean) and running the one test reds —
  `AssertionError: one number, two deviations — allocate through POST /api/ledger/deviations: expected [ …(3) ] to deeply equal []`
  with exactly D-1159/1160/1161. PR #39 therefore **cannot merge as it stands**, and its green CI is
  stale by nine hours (it ran at 12:42, before the base moved). One mechanical round: allocate three
  fresh numbers FIRST (floor 1240 — the allocate→define window IS the hazard), merge `origin/main`,
  renumber, re-measure. No code, no new guards.
- **Precedent applied, and it went against the party holding the allocation.** *The branch that can
  still move cheaply moves.* #41 is merged with its numbers in filenames; wave 6 is unmerged. Wave 6
  holds the allocator rows for all three and #41 holds none — **and that did not decide it. That is
  the second time merge state has beaten the allocator**, which means an allocation is not a claim on
  a number, only a record that you asked. The hole `deviation-refs.test.ts` cannot close: its
  collision scan fires only once BOTH definitions sit in ONE tree — one merge too late — and nothing
  checks that a DEFINED number was allocated to its definer. **Wave 7's ledger guard now has three
  incidents behind it (D-1157/1158 via #38, D-1159/1160/1161 via #41).**
- **Two corrections to this coordinator, both accepted, one worse than the worker stated.** (1) The
  review's minor-H clause "nothing reads that record" is **FALSE** — eight sites read it; the worker
  was right. (2) The ruling's REFUTED paragraph claims eight and itemises **six**, not seven — and the
  eighth IS nameable: it is minor H, counted as both refuted and confirmed after the two dead
  verifiers were adjudicated by hand. The worker's "a number without a name" was generous. **A review
  that miscounts its own findings has no standing to fault a table that miscounts its rows** — which
  is why this is recorded above the minors it raised, not below them.
- **Coverage stated rather than assumed:** the verification pass targeted the FIX ROUND; 15 of the 32
  changed files carried no lens in it (including `watch.ts` and `caps.ts`, the wave's own F6 feature
  and F7a policy module). They were covered by the 44-agent wave review, not skipped. The critic
  flagged it and the ship decision is recorded as resting on that split, not on an unstated gap.
- **Wave 6 CLOSES (2026-09-01 22:48 UTC).** Merged `6ee36ca5`, deployed server lane from the merge
  sha, `/health` reports it, `ccrc.service` MainPID stable across the verify window. The renumber
  round was verified independently before the button: `deviation-refs.test.ts` **9/9 green on the
  merged tree** (it was red with exactly three collisions before), D-1159/1160/1161 gone from the
  wave's plan, D-1240/1241/1242 defined and allocated to `ccrc-pwa-quiet-meadow` under the title
  "wave-6 renumber after PR #41 took D-1159/1160/1161 (run 19)" — the definer holds the allocation,
  which is the property wave 7's guard has to enforce. The renumber commit is 14 files, 77 lines of
  code: mechanical ref updates plus the seven free minors, each with a stated reason. Scope re-measured
  AFTER the main merge: `ccd/`, `session-hook.sh`, `deploy/` empty against `origin/main`.
- **The PR body was stale at merge time and was rewritten before the button.** It still claimed
  "D-1157..D-1169 defined in the plan", a 59-row table and the pre-review suite counts — all three
  false by then. **A PR body becomes the durable record on merge**, so refreshing it is part of the
  merge, not housekeeping after it. (`gh pr edit` fails on this repo with a Projects-classic GraphQL
  deprecation error and leaves the body UNCHANGED while looking like a failed command; the working
  path is `gh api -X PATCH repos/<o>/<r>/pulls/<n> --input <json>`.)

### Wave 7 review — 2026-09-02 08:56 UTC — SHIP WITH FIXES

Ten adversarial lenses over the branch diff, refute-default verification, every mutation run in an
isolated checkout — 25 agents. **Five must-fix, one major, one minor. Zero code defects** in the
health read, migration 7, the wire, or the four-statement batching: four of the five must-fixes are
FALSE CLAIMS IN SHIPPED PROSE, and the fifth is a live false positive in the wave's headline guard.
Ruling in mail 194.

- **The fourth ledger collision was avoided, and the brief is what nearly caused it.** The brief said
  "floor **1243** — and READ the floor from the allocator, never from a document", in one sentence.
  PR #42 merged mid-wave defining D-1243. The worker read the allocator (1292) and was clean; had it
  read the bolded number in the same sentence it would have been the program's fourth incident.
  **Ruling adopted for wave 8 and after: a brief carries a floor as PROVENANCE ("it was N when this
  was written"), never as an instruction.** Its shelf life here was about two hours.
- **Verified by the coordinator independently**: 25 numbers allocated with `byId`, 25 defined, and
  `git grep` finds none of D-1293..D-1317 anywhere on `origin/main`. `origin/main` is an ANCESTOR of
  `ed81ad85`, so the merge is a fast-forward and **CI's 5/5 green IS the merge-green measurement** —
  no local re-run can say more.
- **M1/M2/M3/M4 — the false-claim class, four instances, none of them cosmetic.** A comment asserting
  a `single-definition` holder that does not exist (measured: the respelled literal ships GREEN);
  `ledger.ts` shipping two stale cardinals (394/388 and 29) in the docstring whose own subject is not
  shipping stale cardinals — measured at HEAD as 405/399 and 27, where **29 is the figure belonging to
  the looser pattern that paragraph exists to distinguish itself from**; `runWords.ts:454` re-asserting
  verbatim the premise D-1309 was raised to delete, 44 lines below the code that refutes it; and an
  Execution record whose "verified at close, both directions: 24 allocated, 24 defined" is wrong about
  its own close (the same document defines 25).
- **M5 — the cross-tree guard fires on the prose that RECORDS a collision.** D-1310 fixed the
  whole-phrase-bold citation the corpus happened to contain; the individually-bolded spelling —
  `- **D-1157** and **D-1158** were taken by PR #38`, which is how *every* collision record in this
  program is written, and which D-1310's own entry quotes — still reads as a DEFINITION. Wave 8 will
  narrate exactly that about D-1243, a number `main` really defines, so it trips next wave with the
  printed remedy "renumber NOW" on a merely-cited number. The other direction is open too: **36
  line-initial `**D-N — subject**` entries with no bullet are invisible to the scan** (not a
  regression — `ENTRY` is blind the same way — but a hole in a guard whose subject is not missing one).
  A candidate lookahead closing both directions was measured (11 shapes, 0 mismatches, +24 visible)
  and handed over as a starting point, not a mandate.
- **J1 — the un-briefed-coordinator facet stops firing the moment the kickoff parks**, and the file
  already owns the right predicate (`OUTSTANDING_OR_ABANDONED_SQL`, whose docstring states the
  principle in as many words). The finder's ESCALATION was refuted and the refutation upheld: only two
  gates ever park a kickoff, so the busy/paneless/delivered-then-dead coordinators keep firing
  indefinitely. What survives is that `store.ts:1524-1526` presents the park-goes-silent chain as a
  DEFEATED first draft when it is still true of the shipped code — `MIN(m.at)` changed when the
  warning starts, not that it stops.
- **The `byId` question the worker escalated — ruled.** Do NOT require it at
  `POST /api/ledger/deviations`; fix it in the CLIENT. `ccd/ccrc-api:151 cmd_whoami` already derives
  `{id,uuid}` from tmux + the registry, and the 101 empty holders trace to `peer-protocol.md`'s
  documented body omitting the field — a documentation default, not a route defect. Requiring it
  server-side would 400 every session still carrying the old skill text, since a skill reaches a home
  only once its installer has run there. **Goes to wave 8, which is already AGENT-FIRST**, with the
  third condition named up front: a caller whose lookup fails, and a caller that is not a session at
  all, must not silently send an empty `byId` — that recreates the hole quietly, which is what D-1301
  measured.

### Wave 7 fix round — VERIFIED 2026-09-02 11:06 UTC — all six hold; one final bounded round

Eight verification agents, every landed fix mutation-RUN in an isolated checkout, then an adversarial
second pass over all six. **Zero "does-not-hold".** M1's new guard reds on the coordinator's exact
mutation with the quoted message; M5's pattern reds on the pre-fix revert; J1's three park cases each
red on their own reversion; M3's closed-run filter reds on deletion. Fingerprint re-measured at
`e37237b5`; `origin/main` at `651f40c5` (now carrying PR #44) is still an ANCESTOR, so the merge stays
a fast-forward; 33 allocated, 33 defined, zero collisions against the new main.

**A third round was opened, bounded to six items, with the merge committed in advance** — the
coordinator stated it will not open a fourth. Its justification is consistency, not new doubt: four
prose falsehoods were ruled MUST-FIX in round one, and round two left or introduced five more of the
same class. One of them (`:1143`, "the fix round adds D-1318..D-1324" against its own correct
D-1318..D-1325) is **D-1324's own title recurring inside D-1324's fix**. The sharpest is a false
PROVENANCE in three shipped places: `wave1-f1.md:216` is offered as a corpus instance of a ````
block quoting ``` blocks, and it quotes none — measured, the block runs 216→338 with zero inner
fences. The corpus does hold that shape, at `build7-surfaces.md:408`, but that file is in
`LEGACY_PER_PLAN_LEDGERS` and is never scanned. The guard's BEHAVIOUR is correct and red-on-mutation;
only the measurement selling it lies, which is exactly this wave's own class. One real code item
rides with them: the fence fix has no info-string check on the OPENING fence, so a prose line
carrying a triple-backtick code span opens a phantom block a later bare fence closes, and
`crossTreeCollisions` was driven end-to-end returning `[]` for a number defined on both sides. Zero
instances in the tree today — potential, not live — but a silent miss in a collision guard is what
that file's own docstring forbids.

### The allocator burns numbers, and root CLAUDE.md's procedure mints an orphan every time — measured

The worker volunteered D-1325; it is larger than stated and it is the most valuable thing this wave
produced. Measured by the coordinator against the LIVE allocator:

> issued range **274..1325 = 1052 numbers; 263 issued; 789 NEVER ISSUED — 75%**, in 17 holes,
> **thirteen of them exactly 49 wide**, plus 14, 35, 50 and 53.

That is the signature of `floorFromScan` — `max(any D-N TOKEN in docs/superpowers/{plans,specs}) +
LEDGER_SEED_GAP (50)` — against a floor that ONLY RISES. Every publish-and-sweep burns 49 numbers by
design, and **a hand-written number seals its own band forever**: PR #42 wrote D-1243, the sweep
raised the floor to 1293, and 1243..1292 are unissuable. 1066..1118 has the identical signature.

**The part that reaches past this program: root `CLAUDE.md` instructs a coder to "allocate the next
number by grepping `origin/main`".** `maxRef + 1` is inside the burned band by construction, and
writing it raises the floor to `maxRef + 51`. Two lanes both grepping get the same `maxRef` — which
is the mechanism behind ALL THREE of this program's collisions. The documented human procedure is not
merely suboptimal; it is the generator. **Wave 8 carries the CLAUDE.md correction.**

Carried with it, a defect live on `main` and not this wave's doing: `watch.ts:2076` claims "`landed`
genuinely means merged, the signal the bb47c9e incident lacked", but `readLedgerDocs` reads the main
checkout's WORKING TREE with no git ref — that checkout sits on `feat/graphify-read-side-ccrc-level`
today, so the sweep names eleven orphans, five of them from an unmerged branch, and `markLanded` can
stamp `landedIn` with a file that is not on main.

**The coordinator's own correction, owned here rather than left to the worker:** the widened bare-bold
prefix handed over as M5's starting point opens a small new false-positive class the eleven shapes it
was tested against did not cover. Mine, not the worker's.

**Ruling amended:** the `byId` ruling closes "who asked for this number". It cannot touch "was this
number ever asked for" — a session that never calls the allocator is invisible to a client-side fix,
and that is precisely what PR #42 did. It is a PARTIAL fix and is recorded as one.

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

**Wave 8 of 8 — F8, THE LAST WAVE, and AGENT-FIRST.** Spec:
`docs/superpowers/specs/2026-08-28-program-leverage-design.md` (fetch `ws/brisk-meadow` from origin;
the ledger on that ref carries this brief and wave 7's close record). Same workspace
(`quiet-meadow`, resumed). **Wave 7 is merged as `5e9f650d` and DEPLOYED (server lane)** — diff
against `origin/main`, never a stale local ref.

**(1) THE MEASURED-READ COMPLETION — F8 as declared.** `readFileMeasured` shipped
(`MeasuredRead`/`ReadFailure`, `server/src/io.ts`), but the collapse is not gone from the tree:
`readFile`, `readFileB64` and `readFileFrom` still fold every failure to one `null`. The agent's half
of `readFileB64` folds a **THIRD** condition — an over-cap file — where `localIO`'s has no cap, and
the agent's `stat` op answers EACCES as `{missing: true}`, so that wire's own absent-marker already
lies for every non-ENOENT failure. D-114,
`docs/superpowers/plans/2026-08-20-fleetio-measured-read.md`. **No overloaded null at any seam you
touch** — two conditions a caller handles differently must not collapse to one value.

**(2) THE `MailDeliveryState` TERMINALITY AUDIT.** Terminality is incomplete: some writers lack the
guard. Find every writer, say which are guarded and which are not, and close them — or record, per
writer, why not.

**(3) THE LEDGER PROCEDURE — the sharpest item, and it is agent-first by nature.** Three parts:

  (a) **`byId`, ruled: fix the CLIENT, not the route.** `ccd/ccrc-api:151 cmd_whoami` already derives
      `{id,uuid}` from tmux + the registry, so `ledger allocate` can fill `byId` when the caller's
      JSON omits it. Show it in `peer-protocol.md`'s documented body too — that text is what every
      future coordinator copies, and its omission is why 101 of 243 allocator-era rows carry an empty
      holder. Do NOT make it required at the route: that 400s every session still carrying the old
      skill text, since a skill reaches a home only once its installer has run there. **The third
      condition is the part to design rather than discover:** a caller whose tmux/registry lookup
      FAILS, and a caller that is not a session at all, must not silently send an empty `byId`.

  (b) **ROOT `CLAUDE.md`'s ALLOCATION INSTRUCTION IS THE GENERATOR OF ALL THREE COLLISIONS, and it
      must go.** Measured against the live allocator on 2026-09-02:

          issued range 274..1325 = 1052 numbers; 263 issued; 789 NEVER ISSUED — 75%
          17 holes, THIRTEEN of them exactly 49 wide, plus 14, 35, 50 and 53

      That is the signature of `floorFromScan` — `max(any D-N TOKEN in docs/superpowers/{plans,specs})
      + LEDGER_SEED_GAP (50)` — against a floor that ONLY RISES. Every publish-and-sweep burns 49
      numbers by design, and a hand-written number seals its own band forever: PR #42 wrote D-1243,
      the sweep raised the floor to 1293, and 1243..1292 are unissuable. 1066..1118 is the identical
      event. Root `CLAUDE.md` says "allocate the next number by grepping `origin/main`" — `maxRef + 1`
      is inside the burned band by construction, and two lanes both grepping get the same `maxRef`.
      **Replace that paragraph with the allocator, and say what the floor actually means.** Measure
      the figures yourself before you write them; they are this brief's provenance, not its authority.

  (c) **`landed` does not mean merged** — a defect on `main`, not wave 7's. `watch.ts:2076` and
      `schema.ts:552` both claim it does, but `readLedgerDocs` reads the main checkout's WORKING TREE
      with **no git ref**, so the sweep reads whatever branch that checkout is sitting on. Measured
      live: eleven orphans instead of six, five of them from an unmerged branch, and `markLanded` can
      stamp `landedIn` with a file that is not on main. Fix the read or correct both docstrings.

**(4) THE THREE INHERITED.** The fifth repoint arm (re-queue a parked role-addressed delivery after a
reclaim); `ccd/ccrc-api:32-38`'s stale two-door census (D-1168).

**(5) WAVE 7'S TWELVE CARRIES.** Two are real and small: `FENCE` admits a TAB-indented delimiter where
CommonMark reads indented code (`ledger.ts:202`, a hide-only under-report, zero instances today); and
**D-1329's retraction reached `ledger.ts` only** — the false "build 9b spells its entries
`- **D-211** (Task 3):` … which ENTRY cannot see" still ships, asserted, at
`deviation-refs.test.ts:117-119` and `ledger-crosstree.test.ts:43-51`, so at HEAD that file
contradicts itself. The other ten are prose: a fresh unpinned cardinal at `ledger.ts:341-346`, an
anti-vacuity message that says "no plans read" when plans were read (`deviation-refs.test.ts:334`),
`ledger-sweep.test.ts:190` attributing D-1067..1069 to the wrong plan file, and seven stale
counts/ranges in the wave-7 plan. **One commit, measured, not a design.**

**THE RULE THIS PROGRAM TOOK FIVE DEVIATIONS TO STATE, and it is now the standard:** *a cardinal may
stay in shipped source only if it cannot move.* `274` passes (MIN(n) over an append-only table).
"eighteen dropped lines" does not. When in doubt, assert the PROPERTY and name an exemplar you have
verified exists.

**Tests.** Every guard ships WITH a test measured red on its deletion, TDD red-first, verbatim
first-fail rows written AS YOU GO, table counted twice. Watch this program's recurring classes: the
vacuous fixture (four instances in wave 7 alone), the pin whose premise is never established, the
absence assertion whose fixture cannot produce the presence, and the mutation that reds for the WRONG
REASON — wave 7's F6 fixture took three attempts because two of them reddened for over-reporting.

**Wire:** additive-only, single reader per field, older-peer omission tolerated, no `FLEET_PROTO`
bump, no new ccd verbs, no overloaded null at any new seam.

**Deviations:** allocate from `~/.local/bin/ccrc-api ledger allocate` and **read the floor from the
allocator at the moment you allocate**. It was 1333 when this was written — that is PROVENANCE, not
an instruction, and its shelf life has been as short as two hours (D-1317). **Allocate and define in
the same act**, and put the ref in the file only after the allocate call has RETURNED (wave 7 recorded
getting this backwards and being saved by luck).

**AGENT-FIRST.** This wave touches `ccd/ccrc-api`, `ccd/coordinator-skill/references/peer-protocol.md`
and root `CLAUDE.md`, so it ships to the FLEET HOST before the server. Deploy is not the worker's act
— report the fingerprint and I do both lanes in order. Commit on `ws/quiet-meadow`, never a feature
branch. All coordinator mail names this wave's `runId`. Plan first (superpowers:writing-plans),
execute with superpowers:executing-plans. Suites: `./node_modules/.bin/vitest run` from inside the
package, foreground, tails READ not grepped; all three packages installed or `typecheck-tests`
reports spurious failures.

**This is the last wave.** At its merge the program closes: the ledger and spec PR to main from
`ws/brisk-meadow`, and run 30 closes `final:true`.
