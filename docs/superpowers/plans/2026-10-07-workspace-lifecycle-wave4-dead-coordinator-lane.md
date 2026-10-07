# Workspace lifecycle, wave 4 — review 313's residue, then the dead-coordinator lane (spec stage 4; server + pwa) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two things, in this order. FIRST, close review 313's residue on the expiry lane — its three ARMING BLOCKERS among it — so the operator can arm `$REG/expire-lane-live` on evidence that is true: a learn audit that cannot be read is backed off and listed (and learn slots go in `nextAskAt` order), a failure the box says will not resume stops at once instead of an hour later, an ineligible sighting clears every report a row holds, a refusal of another archive is a row that moved, the held sentence names its instant, and the records the review found wrong are corrected. THEN build spec stage 4, the DEAD-COORDINATOR LANE: a coordinator that CRASHED (`orphan`, `absent`, or `never-started` after a spawn that succeeded, with no deliberate act since its last successful spawn in a journal the lane can TRUST to hold one — the lifecycle mirror current, no gap it recorded since that spawn, no journal line ccd could not write) and has stayed dead an hour — counted from a durable `coord.db` anchor, raised by the supervisor stamp, and seen on two passes in a row — has its open runs closed `failed` through `closeRun`'s abandon arm with `causedBy: 'sweep'`, on the coordination serialiser. The arm re-measures the claimant IMMEDIATELY BEFORE each run's fleet act and again after it, before the commit, and commits only while `claimedBy` still names it (compare-and-set); CCR-15's reclaim port is wired as the abandon route wires it. A circuit breaker holds the WHOLE lane when two or more coordinators are first measured crashed within ten minutes of each other, or the pass meets a fleet-wide doubt (tmux not answering, or none of two or more claimants measurable); it remembers its members through a pass that cannot measure them. The lane SHIPS SHADOWED: until the operator touches `$REG/dead-coordinator-lane-live` by hand it measures, anchors, trips its breaker and records "would end programme <slug> (<n> runs)" for EVERY due coordinator as a feed row and an attention entry, and never reaches the abandon arm. `$REG/reclaim-paused` stops it entirely.

**Architecture:** The residue (Tasks 1–5) edits the 3b lane where it lives: `server/src/archivedExpiry.ts` (L1: `archivedExpiryLearned`, `archivedExpirySighted`, `archivedExpiryNextEntry`, the outcome type, the sentences), `server/src/coord/expireArchived.ts` (the executor's archive check and its `resumable` mapping), `sweepArchivedExpiry` in `server/src/watch.ts` (the learn order), the coordinator skill's clause 3 and its two pins, the 3b plan's and the spec's records, and the PWA's two archive confirms (Task 5, droppable). The lane (Tasks 6–13) is the expiry lane's shape, a THIRD sibling pass on the child lane's tick: one L1 file, `server/src/deadCoordinator.ts` (the dead-cause union the reclaim verdict carries, the ONE journal reader and the journal's trust, the crash classification, the anchor and its gap rule, the hour, the breaker and its memory, the act's typed stop, the lane's memory, the words, the vocabulary guard, the live marker's one spelling), the reclaim ladder widened in ONE place (`ClaimantVerdict`'s dead arm gains `cause`, `coord/reclaim.ts`), the store's half (`dead_claimants`, migration 18 — a new table and nothing else; `deadAnchors`/`setDeadAnchor`/`deleteDeadAnchor`; `deadCoordinatorJournalRows`; `lifecycleGapGens`; and `closeRun`'s `expectClaimedBy` compare-and-set inside its transaction), `closeRun`'s third attribution word and its sweep guard — the re-measure before and after the fleet act and the compare-and-set's first half on a fresh read (`coord/close.ts`, `SweepCloseGuard`), the serialiser's sweep handle (`CoordRoutesHandle.withSweepAbandon`, `coord/routes.ts`), the one executor and the journal-trust adapter (`server/src/coord/endDeadCoordinator.ts`), the lane (`sweepDeadCoordinators` in `watch.ts`, handed the handle by `buildServer`), the wire (`DeadCoordinatorAttention`, `CoordStatus.deadCoordinatorAttention`, optional and additive — no `FLEET_PROTO` bump), the PWA's one reader and its list in the cleanup row, the words (README, the coordinator's `resume.md`, the lifecycle spec's §5.4 and §6 item 5, CCR-15 §5.8, the build-4 design's `causedBy` sentence) with their pins, and spec §9's stage-4 rows in `deploy/measure-workspace-lifecycle.py`.

**Tech Stack:** TypeScript (server, pwa, L0 `shared/`), `node:sqlite`, vitest 4, React 19, Fastify. No `ccd/ccd` edit in this wave.

**Spec:** `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` — §5.4 whole (the lane), §5.3's "As wave 3b builds the lane" list, §6 items 5 and 6 and the Landing-order bullet, §8's stage-4 failure modes, §9's stage-4 row, §10 item 5, §11. The 3b plan (`docs/superpowers/plans/2026-10-06-workspace-lifecycle-wave3b-expiry-lane.md`) — its Deviations found, rows T3.5 and T7.2, and the lane it built. Review 313's report (the coordinator's evidence copy, `.superpowers/sdd/coordinator-evidence/run290/review-313-3990aaad.md`: F1–F7, O1, O2 and the four parked items) and the 3b worker's SDD ledger beside it. The programme ledger (`docs/superpowers/programs/workspace-lifecycle.md`), its 2026-10-07 06:01 entry (this wave's residue ruling) and its Next-wave brief. The reclaim verdict and door (`server/src/coord/reclaim.ts`, D-1145's note on the THIRD consumer), the abandon door, `closeRun`'s abandon arm (`coord/close.ts`), the serialiser `registerCoordRoutes` returns (`coord/routes.ts`), the lifecycle mirror (ccd's `_LC_ACTS`, `lifecycle_events`, `journalparse.ts`), `coord.db`'s migrations (`coord/schema.ts`, `db.ts`'s rule 3), the stall watch's coordinator arms (`coord/stall.ts`) and the landing lane (`coord/landing.ts`, `sweepLanding`). Sibling plans whose shape this one copies: the 3b plan and `docs/superpowers/plans/2026-09-22-child-reclamation-wave4-sweep-and-switch.md`.

> **Departure numbers — twenty slugs, twenty numbers.** The plan names twenty departures by SLUG under `## Deviations found`; it defines no number. The run's brief issues the numbers for all twenty slugs (the coordinator issued a second block of four after the plan's review added four departures): the worker writes them bare, in the order `## Deviations found` lists the slugs, each in the entry that defines it, in the commit of the first task that makes the change — never a guessed number. If the operator strikes Task 5 (the archive-confirm copy) before merge, its slug is not written and its number is reported unused. A departure found while executing is reported, never typed.

## The coordinator's rulings this plan builds (binding; they win over the spec and over the plan's own preferences)

- **(A) The first commits are review 313's residue and the expiry lane's arming blockers** (Tasks 1–5, as the ledger's 2026-10-07 06:01 entry rules them): parked item 1 (BLOCKER; Task 1) — a learn audit that is unreadable or answers `archivedAt: null` backs off and is reported on the expiry attention list, and learn slots go in `nextAskAt` order; parked item 4 (BLOCKER; Task 2) — `ExpireVerbRead.failed.resumable` is carried through the outcome type, and a wrong-row `expired`, an unknown refusal word or `probe-unmeasured` reports and stops at once; F1 (BLOCKER), F2, F3 and F4 (Task 3; F3's seven-day pin MEASURED and decided, Pre-flight finding 11); F5, F6, F7, O1, O2 and parked item 3 (Task 4); parked item 2, the archive-confirm copy, as ONE separate, droppable task placed LAST among the residue (Task 5).
- **(B) The dead-coordinator lane ships shadowed** (Tasks 6, 10, 11, 13): until `$REG/dead-coordinator-lane-live` exists it measures, keeps its anchors, trips its breaker and RECORDS "would end programme <slug> (<n> runs)" for EVERY due coordinator — a feed row and an attention entry — and never reaches `closeRun`'s abandon arm or the reclaim port. No writer in the tree, pinned beside `expire-lane-live`, `scope-sweep-live` and `stall-watch-live`. `$REG/reclaim-paused` stops the lane entirely, shadow included — pinned at the lane in both modes. The skill files never name the live file; the coordinator's `resume.md` states the arming condition in words (Task 13). Pins: absent → never an abandon, however long; present → the abandon; paused → nothing, live or shadow.
- **(C) The verdict is widened, not re-derived** (Task 7): `ClaimantVerdict`'s dead arm gains `cause` in ONE place, `measureClaimant`'s own ladder; the reclaim door and the stall watch ignore it; no consumer re-splits the prose `why`.
- **(D) A crash and only a crash** (Tasks 6, 10, 11): the journal reader is ONE function; an unreadable journal is unmeasured, never "no history" — and so is one the lane cannot TRUST to hold every deliberate act: the mirror `unavailable`, a gap it recorded in a generation not older than the claimant's last successful spawn, a journal line ccd counted as unwritten after it (Pre-flight finding 14); a mirror not swept since a restart, or `stale`, makes a pass decide nothing at all. An absent row with no history is unmeasured (listed, never acted on), and so is a `never-started` row with no successful spawn; `stopped` is never; `restarting` is alive; `unmeasurable` is never dead. Pinned at L1, at the executor's re-measure and at the lane.
- **(E) The hour is durable** (Tasks 6, 8, 11): `dead_claimants` keyed by claimant, written on a crashed pass, deleted on any other answer; the anchor is `max(firstDeadAt, .supervised)` with an absent, unparseable or future stamp ignored; act at an hour AND two crashed passes. The migration keeps a rollback bootable — measured (Pre-flight finding 2).
- **(F) The circuit breaker** (Tasks 6, 11): two or more claimants first measured crashed within ten minutes, or a fleet-wide doubt on the pass — tmux not answering for any claimant, whatever the count, or none of two or more measurable — act on NONE and raise ONE item naming them, and ONE feed row per trip. It REMEMBERS its members at their first-dead instants and releases one only on evidence (alive, stopped, deliberate) or when it leaves the population, so a member's transient doubt does not dissolve the cluster; it resumes when they fall under the threshold; tests red when it, its memory or its fleet-wide arm is deleted; evaluated in shadow too. The operator's clear is the SMALLEST act the box-token census allows: the doors that already exist (revive, reclaim, abandon), no new route; a one-tap clear door is carried (the coordinator's ruling, 2026-10-07).
- **(G) No successor** (Tasks 8, 9, 10): the act runs on the serialiser; the claimant is re-measured INSIDE the abandon arm, immediately before EACH run's fleet act and again after it, before the commit; the commit is a compare-and-set on `claimedBy`, checked on a fresh read before the fleet act and again inside the store transaction; any answer but a crash ends the whole act and, being evidence, resets the anchor. A compare-and-set cannot see a revive of the SAME id (`ccd ensure` takes no mutex and rewrites no `claimedBy`), so the forced-interleaving test the ruling asks for is that revive — a same-id revive after the lane measured, which the in-arm re-measure stops before anything is composed — and it reds when the re-measure is removed (T9.8, T10.1); the successor test stays, as the second wall against a `claimedBy` writer outside the serialiser (none exists in this build). The residual, stated: a revive inside the last re-measure's round trip (Pre-flight finding 16).
- **(H) The act** (Tasks 9, 10, 11): the abandon arm with `causedBy: 'sweep'` (additive; no `FLEET_PROTO` bump), the reclaim port wired as the abandon route wires it; runs the arm cannot move are listed and not retried beyond the backoff, and an act that THROWS backs off too; ONE feed row per ended programme in the spec's words, with its first-dead instant — and a programme the act closed only part of is never announced as ended. Landing treats a sweep close as an operator abandon — measured, and pinned through the watcher's own `sweepLanding` (Pre-flight finding 4). The `causedBy` vocabulary text is amended where it is written (Pre-flight finding 5).
- **(I) Relations** (Tasks 11, 13): the stall watch notifies — r3 `coordinator-dead` and, once its wave-2 arms are armed, `coord-deaf`, one push per stalled worker, each naming the coordinator — and this lane acts and NEVER pushes: its rows are records of that incident, keyed by the same claimant id (Pre-flight finding 9). A sibling pass at the child lane's cadence, measuring the distinct claimants of non-terminal runs, with its own memory and attention list. Spec §9's stage-4 rows are measured (Task 13).
- **(J) Overlaps**: drafted on `origin/main`; every block in a file another in-flight run edits is listed under `## Re-measure at dispatch`.

## Global Constraints

Copied from `CLAUDE.md`, the spec, the 3b plan and the ledger where the value matters. Every task's requirements include this section.

- **Base.** Every block was generated from a prototype built stage by stage (each task's test stage, then its source stage) on **`origin/main` `9b0742089`** (#312, wave 3b merged), REVISED after the plan's four-lens review stage by stage on `282e79e44`, and RE-BASED stage by stage onto **`7f7bf4afc`** — `origin/main` after #320 (stall-watch-settings wave 1) merged. #320 took coord.db's migration slot 17 and `mail-routes.test.ts`'s fourteenth vocabulary union, and narrowed `coord-db.test.ts`'s migration-14 case to its own tables, so this plan's migration is slot 18, its union the fifteenth, and its migration-14 edit is gone; the re-base kept both sides everywhere else. The plan's blocks were replayed whole onto `7f7bf4afc`: every block matches EXACTLY ONCE at its turn, and the replayed files are byte-identical to the prototype's. Every red and green count below was measured on the RE-BASED prototype, every stage; the mutation rows of Tasks 6 and 8, and row T4.1 (`coordinator-skill.test.ts` gained a case in #320), were re-measured there too; the other tasks' rows were measured on the revised prototype over `282e79e44` — #320 changed none of their test files, and each row's edit was re-checked to occur exactly once on the re-based tree. One file per process, `--maxWorkers=1`, in the foreground, `TMPDIR` on the volume outside every checkout, `CCD_DISK_FLOOR_GB=1`, at load averages between 9 and 50 (other workers' suites). **Whole-file denominators are base-relative**: compare the FAILED count and the failing TITLES a step names. If a Find block is absent or not unique on your base, `main` moved under it: stop and report rather than improvise an anchor. `## Re-measure at dispatch` lists every block in a file another in-flight wave edits.
- **Deploy class: SERVER + PWA + the FLEET box's skill spine, through ccrc's own updater; nobody moves a box by hand.** No `ccd/ccd` edit and no agent edit — but Task 4 (coordinator clause 3) and Task 13 (`references/resume.md`) change the coordinator skill, which reaches a coordinator's home ONLY through `ccrc update`'s install spine on the fleet box (a server-role box converges no skills — CLAUDE.md's deploy section): both boxes move, the fleet box first, as `ccrc rollout` does by default, and doctor's `skills` check says when every home has the shipped text. The coord.db migration (Task 8) runs at the server's boot. The deploy note has the order, the arming, and what the first armed pass faces.
- **SAFETY — sacred.** Never run a destructive `ccd` verb against the live host; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*.service` directly; never print a secret file's contents; `gh` stays off the exec whitelist. **This wave's lane ENDS PROGRAMMES: it closes another coordinator's runs `failed`, and through CCR-15's port gets their children reclaimed — a worker mid-turn loses its turn.** In every test the lane runs against a fixture `coord.db`, a fixture registry and a scripted tmux and `runCcd`; nothing reaches the live server, agent, registry or store; no test calls the live server's run, mail or abandon routes. Never touch `$REG/dead-coordinator-lane-live` (or `$REG/expire-lane-live`) on a box: arming is the operator's.
- **Fixture HOMEs only.** The lane's tests build on `testDeps` and a fixture HOME (`mkTmp`), as `archived-expiry-lane.test.ts` does; the store's on a temp `coord.db`; the executor's and `sweep-close`'s on the real `closeRun` over a fixture store with a recording `runCcd`.
- **No root `package.json`.** Four packages, each run cd'd in; a package command is a subshell, `( cd server && … )`. **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts --maxWorkers=1` from inside the package; NEVER bare `npx vitest`.** Suites in the FOREGROUND, one test file per process for the ccd, hook, doctor and install suites; never two suites at once. A foreground call is capped below ten minutes, so the whole server suite runs as shards, and a shard — or a file — that outruns a call is split by file, then by its own top-level describes (Task 14 says how).
- **Scratch space and the disk floor.** `TMPDIR` on the project volume, in a directory you create OUTSIDE every git checkout, and `CCD_DISK_FLOOR_GB=1`. Delete only the fixtures you created.
- **`ccd/ccd` is NOT edited by this wave.** So no re-stamp, no `_reg_get` census move (`ccd-reg-get-census` stays `3 passed (3)`), and no tax in the frozen compaction-card corpus's `ccd/ccd` anchors. **README's purge-token anchors move once**, in Task 6: its `shared/api.ts` insertion (the wire type and the coord-frame field) sits above README's four `shared/api.ts` citations, so Task 6 Step 5 re-points them BY CONTENT (read the member lines off the tree with `grep -n`, never add a delta). The five citation cases run after every task that edits a cited file:

      ( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )

  Measured: `5 passed | 330 skipped (335)` at the end of every task; Task 6's source stage before its README repair is the one red (`2 failed | 3 passed | 330 skipped (335)`: `CITATION DEBT` and `README HAS ITS OWN CENSUS`). No literal in `session-hook.test.ts` changes.
- **Rings and wire.** `server/src/deadCoordinator.ts` is L1: it imports `shared/api.ts` alone, types only (Task 6 pins that). `coord/reclaim.ts` takes the cause type from it. `coord/endDeadCoordinator.ts` is the executor (L3, `coord/expireArchived.ts`'s shape); `watch.ts` (L4) gathers and applies, deciding nothing. `CoordStatus.deadCoordinatorAttention` is ADDITIVE and OPTIONAL, read by ONE PWA reader that reads absence as no items; no `FLEET_PROTO` bump. `causedBy: 'sweep'` is additive on the free-text `run_events.causedBy` column.
- **The migration slot.** Task 8 appends `MIGRATIONS[17]`, banner `18: user_version 17 -> 18`. The plan was drafted at slot 17; **stall-watch-settings W1 merged first (#320) and took `user_version 16 -> 17`** (`stall_settings`), so the entry moved up a slot, as entry 12 did before it — measured free on `origin/main` `7f7bf4afc` (17 banners) and on every remote head at the re-base (none holds an eighteenth; the three heads at seventeen carry #320's own entry). Re-measure before the PR and before merge (`git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'` prints 17); if another branch takes 18 first, this entry moves again, and the move changes its banner, its comment's slot sentence, `COORD_SCHEMA_VERSION`'s pins (`coord-db.test.ts`: the `derives to 18` case's two `toBe(18)` and the migration-11 case's one; `asks-store.test.ts`: one), the `migration 18` words in `store.ts`'s comment and `dead-coordinator-store.test.ts`, and nothing in `coord-db.test.ts`'s own `dead_claimants` describe, which finds its slot by its DDL (main's rule, #320's `stall_settings` case).
- **Mutation-table discipline.** Every new guard ships with a row that reds when the guard is deleted or mutated — measured on this plan's prototype at the task's own source stage, never guessed. Each task ends with its table: the exact edit (`⏎` marks a line break inside the text), the command and the measured red. Restore every edit before the commit.
- **Branch discipline.** Commit on this workspace's own branch, one commit per task, never a separate feature branch. Identity is the repository's noreply address; do not change git config. Before each push: `git log --format='%an <%ae>' origin/main..HEAD | sort -u`.
- **Deviation numbers.** Twenty departures, by slug; the brief issues the numbers for all twenty (the callout above). No `D-<n>` token is written for a new number in any code comment, test title or doc this plan touches: the comments name the departure's SLUG where they need one. Task 4 edits two ledger entries of the 3b plan; `deviation-refs.test.ts` reads every plan's column-0 entry lines — this plan's blocks included — so the one entry whose subject changes is edited by a FRAGMENT block that never quotes its line whole (How to read the blocks).
- **No hostnames, IPs, tailnet names or docserver URLs** anywhere in the diff (`topology-clean.test.ts`).
- **Overlap (ruling J).** Child reclamation wave 6 (run 291, `ws/amber-river`, unmerged and not on the remote, so its file list is its plan's) edits `shared/api.ts`, `README.md`, `watch.ts`, `journalparse.ts`, `mirror.ts` and the CCR-15 spec among the files this plan touches or reads; ccrc-history (run 302, claims 1065/1066/1068; measured with `git diff --name-only origin/main...origin/ws/soft-delta` at `6a6987532`) edits `README.md`, `CLAUDE.md`, `deploy/deploy.sh` (row T13.3's anchor), `shared/lifecycle.ts`, `single-definition.test.ts`, `lifecycle.test.ts` and `session-hook.test.ts` among them — not `coord/db.ts`; centralised-update W15 (run 300) may take `server/src/update/*`, which this plan does not touch. This plan does not edit `ccd/ccd`; if a run that does lands first, nothing here re-stamps. Whichever of these lands second runs `git merge origin/main` (never a rebase), keeps both sides, re-points README's purge-token anchors by content, re-runs the five citation cases and `cite-remeasure`, and re-runs this plan's suites. `## Re-measure at dispatch` names every shared block.

## Review Focus

The inputs a reviewer looking for a programme ended that should not have been meets first, each pinned in the task that owns it:

1. **Shadow never ends anything, and hides nothing.** Without `$REG/dead-coordinator-lane-live` the lane records and never reaches the abandon arm, however long a coordinator has been dead — and it records EVERY due coordinator, so the list the operator arms on is whole (Task 11: `without the live file …`, `SHADOW records every due coordinator …`; Task 10: `SHADOW … the abandon arm is never reached`). The executor re-reads the switches inside the serialiser, and again inside the arm before each run.
2. **The one cleanup switch stops everything.** `reclaim-paused` (or a registry that cannot be listed) means no measure, no record, no write, live AND shadow; a sighting from before the pause is forgotten; raised mid-act, it stops the rest of the act (Task 11: `reclaim-paused stops the lane ENTIRELY …`, `… stops the SHADOWED lane too`; Task 10: the executor's own pause read and `the switches are read again before EACH run`).
3. **A crash, and only a crash.** `stopped` is never; a deliberate act since the last successful spawn — the failed-revive case included — is never; an absent row with no history, and a `never-started` row with no successful spawn, are listed and never acted on; `restarting`, a live pane and an unanswered tmux delete the anchor (Task 6's table; Task 11: `a coordinator the operator STOPPED …`, `an ABSENT row …`, `… each DELETE the anchor`).
4. **The journal is trusted only when it can be.** A mirror that is `unavailable`, a gap it recorded since the claimant's last successful spawn, a journal line ccd could not write after it, or a read that throws: unmeasured, never "no history", never a crash; a mirror not swept since a restart, or `stale`, decides nothing (Pre-flight finding 14; Task 6: `a journal the lane cannot TRUST …`; Task 10: `a journal the re-measure cannot read, or cannot trust …`; Task 11: `a journal the lane cannot TRUST keeps every coordinator …`, `a mirror not swept … DECIDES NOTHING`).
5. **The last start is real.** `start` and `ensure` journal at the top of their verbs, so only a `spawn` line with `rc` 0 is a start — read off the line's own bytes, because the mirror's typed `meas.rc` is null on every real line (Pre-flight finding 1; Task 6: `the start is read off the spawn line’s OWN bytes …`).
6. **The hour is honest.** Two crashed passes AND an hour since `max(firstDeadAt, supervised)`; the anchor survives a restart but a restart needs two fresh passes; a gap nobody measured restarts it; an act stopped by a re-measure deletes the anchor and the run of passes (Task 6; Task 11: `the hour, made durable`, `a revive the act sees inside the serialiser …`).
7. **No successor, and no revived coordinator, is failed.** The re-measure INSIDE the arm, before each fleet act and again before each commit, ends the act on a revive of the SAME id — which no compare-and-set can see; the compare-and-set refuses a successor before the fleet act and again inside the commit (Task 9: `THE RE-MEASURE, before …`, `… after the fleet act …`, both compare-and-set halves; Task 10: `THE FORCED INTERLEAVING (ruling G) …`, `a revive DURING the fleet act …`). The residual is a revive inside the last re-measure's round trip (Pre-flight finding 16).
8. **The breaker.** Two dead together end nothing, in shadow and live; one pass that cannot measure a member does not dissolve the cluster; tmux not answering trips it whatever the count; one revived, the other ends (Task 6; Task 11).
9. **One at a time, and never every pass.** Armed, at most one claimant per pass, the longest dead first; one pass at a time; a thrown act backs off (Task 11).
10. **The migration keeps a rollback bootable.** Migration 18 is a new table and nothing else; `main`'s own `db.ts` booted on it (Pre-flight finding 2); it moved up from slot 17 when stall-watch-settings W1 (#320) merged first, and the slot is re-measured before the PR and before merge (Global Constraints; Task 8's rows T8.5 and T8.6).
11. **The attribution.** Every run event, feed row and audit of the act says `sweep`, never `operator`; landing reads a sweep-failed run exactly as an operator abandon, pinned through `sweepLanding` itself (Task 9: the first case, `THE LANE ITSELF …`, row T9.11).
12. **The residue's blockers** — what the operator's arming of the EXPIRY lane rests on: an unlearnable row is listed and does not starve the rest (Task 1), a non-resumable failure is reported at once and never retried (Task 2), and the shadow record follows the row (Task 3).

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `server/src/archivedExpiry.ts` (`archivedExpiryLearned`), `server/src/watch.ts` (the learn order); `server/test/archived-expiry-policy.test.ts`, `server/test/archived-expiry-lane.test.ts` | 1 | parked item 1: an unlearnable row backs off, is listed, and yields its slot |
| `server/src/archivedExpiry.ts` (`ArchivedExpiryOutcome.failed.resumable`, `archivedExpiryNextEntry`, the `failing` sentence), `server/src/coord/expireArchived.ts` (the mapping, the feed body); the same two tests and `server/test/expire-archived.test.ts` | 2 | parked item 4: a failure the box says will not resume stops at once |
| `server/src/archivedExpiry.ts` (`archivedExpirySighted`, the held sentence), `server/src/coord/expireArchived.ts` (the archive check before a refusal), `server/src/ccdargv.ts` (`wsExpire`'s doc); the three tests and `server/test/single-definition.test.ts` (the lane's prose pin) | 3 | F1, F2, F3, F4 |
| `ccd/coordinator-skill/SKILL.md` (clause 3), the 3b plan (two entries, two rows), the lifecycle spec (§5.3's "The lane", §6 item 6); `server/test/coordinator-skill.test.ts`, `server/test/expiry-lane-prose.test.ts` | 4 | F5, F6, F7, O1, O2, parked item 3 |
| `pwa/src/fleet/ArchiveSheet.tsx`, `pwa/src/screens/FleetScreen.tsx`, the lifecycle spec (§5.3's words item); `pwa/test/archive-sheet.test.tsx`, `pwa/test/fleet-screen.test.tsx` | 5 | parked item 2, DROPPABLE: the archive confirms hedged until armed |
| `server/src/deadCoordinator.ts` (new, L1), `shared/api.ts` (`DeadCoordinatorAttention`, `CoordStatus.deadCoordinatorAttention`), `README.md` (four anchors, by content); `server/test/dead-coordinator-policy.test.ts` (new), `server/test/mail-routes.test.ts` (the fifteenth union) | 6 | the lane's decisions |
| `server/src/coord/reclaim.ts` (`ClaimantVerdict`); `server/test/coord-reclaim.test.ts` | 7 | the verdict widened |
| `server/src/coord/schema.ts` (migration 18), `server/src/coord/store.ts` (the anchor, the journal read, `lifecycleGapGens`, `closeRun`'s compare-and-set, `AdvanceResult`); `server/test/dead-coordinator-store.test.ts` (new), `server/test/coord-db.test.ts`, `server/test/asks-store.test.ts` | 8 | the store's half |
| `server/src/coord/close.ts` (`CloseCause`, `SweepCloseGuard`, the sweep's signature, the in-arm re-measure before and after the fleet act, the first compare-and-set half), `server/src/coord/routes.ts` (`withSweepAbandon`, `sendCloseOutcome`); `server/test/sweep-close.test.ts` (new) | 9 | the sweep's abandon and its handle; landing's reading pinned through `sweepLanding` |
| `server/src/coord/endDeadCoordinator.ts` (new); `server/test/end-dead-coordinator.test.ts` (new) | 10 | the one executor, its re-measure, the journal-trust adapter and its feed rows |
| `server/src/watch.ts` (`sweepDeadCoordinators`, its memory, the coord frame, the tick dispatch), `server/src/server.ts` (the handle to the watcher); `server/test/dead-coordinator-lane.test.ts` (new), `server/test/fleetws.test.ts` | 11 | the lane, shadowed, one pass and one claimant at a time |
| `pwa/src/fleet/deadCoordinatorWords.ts`, `pwa/src/fleet/DeadCoordinatorAttention.tsx` (new), `pwa/src/fleet/ChildReclaimBanner.tsx`; `pwa/test/child-reclaim-banner.test.tsx` | 12 | the list in the cleanup row |
| `README.md`, `ccd/coordinator-skill/references/resume.md`, the lifecycle spec (§5.4's "As wave 4 builds the lane", §6 item 5), the CCR-15 spec (§5.8), the build-4 design (`causedBy`'s sentence), `deploy/measure-workspace-lifecycle.py` (spec §9's stage-4 rows); `server/test/dead-coordinator-prose.test.ts` (new), `server/test/expiry-lane-prose.test.ts`, `server/test/single-definition.test.ts` (the no-writer pins), `server/test/measure-workspace-lifecycle.test.ts` | 13 | the words, the arming condition in the coordinator's runbook, the switch widened wherever it names what it stops, and the measurement |
| — | 14 | the whole branch, and the PR |

**Not modified, deliberately:** `ccd/ccd` and every ccd suite (the lane reads ccd's journal and registry; nothing on the box changes); `sweepChildReclaim`, `childReclaimSweep.ts`, `coord/childReclaim.ts` (the reclaim port is called as the abandon route calls it); `coord/stall.ts` and `coord/stallsettings.ts` (the stall watch keeps its r3 `coordinator-dead` and `coord-deaf` pushes, their text and #320's one resolution of their arming — the lane never pushes, ruling (I), Pre-flight finding 9); `coord/landing.ts` and `sweepLanding` (they key on open runs, never on `causedBy` — pinned in Task 9, not changed); `coord/mirror.ts` and `coord/mirrorplan.ts` (the lane reads the mirror's health through the watcher's existing `lifecycleHealth()`, its gaps through one new store read); `coord/routes.ts`'s doors and `auth/gate.ts` (no route is added: `box-token-census` and `coord-pause-route`'s `SESSION_ONLY`/`UNGATED` sets are unchanged — #320 added the session-only `/api/coord/stall-watch` pair to them, and this plan adds nothing); `CLAUDE.md` (its box-token census sentence names no door this wave adds); the worker and reviewer skills; `journalparse.ts` (the `meas.rc` degrade it pins stays; Pre-flight finding 1).

## Pre-flight findings (measured while planning; not departures unless they say so)

Measured on the prototype over `9b0742089`, each task applied stage by stage, every named suite run at every stage — and, where #320 could move a finding, re-measured on the re-based prototype over `7f7bf4afc` (findings 2, 3, 7 and 9 say so).

1. **The mirror's `meas.rc` is null on every real line.** ccd's encoder (`_lc_json`, `ccd/ccd`) writes every `meas.<key>` value as a STRING (`meas[k[5:]] = v`, the argv's own text), and `journalparse.ts`'s `n()` keeps only a JSON number — `journalparse.test.ts`'s own case pins that `rc: '0'` degrades to `null`. So "the newest `spawn` row whose `rc` is 0" cannot be read from the typed field: the clause reads the `spawn` line's own bytes (`raw`, the mirror's verbatim column), strictly — `"0"` is a start; a line that does not parse, a missing `rc` or any other value proves none, and then every row in the horizon counts (the departure `the-last-start-is-read-off-the-spawn-line`). Why a successful spawn at all: `cmd_start` and `cmd_ensure` journal `start`/`ensure` at the TOP of the verb, before any pane exists ("The OUTCOME is not asserted here", `cmd_start`'s own comment), and `_reg_claim`'s `claim` line is written on the supervised branch "exactly when the unit never comes up" — so neither tells a revive that worked from one that failed. Only `_spawn_settle`'s `spawn` line carries an rc. A typed `rc: 0` still counts, so a later parser fix changes nothing here. ONE MORE MEASURED LIMIT: `_spawn_settle` journals `spawn` only on a CHANGE — a different rc, or more than 300 s since the previous spawn (`(( _lc_now - _lc_prev_at > 300 ))`, `ccd/ccd`), the registry's `spawn` field being rewritten every time. So a coordinator stopped and revived successfully within five minutes of its previous successful spawn writes no new `spawn` line; if it later crashes, the clause still finds the stop after the old spawn and answers `deliberate`, and the coordinator is never ended and never listed. That fails SAFE (no programme is ended), and it is a coverage hole, carried out of this wave (reading the registry's `spawn` field as the start when it is newer than the newest journaled spawn would close it).
2. **A rolled-back build boots on migration 18 — measured against `origin/main`'s own code.** The re-based prototype wrote a `coord.db` at `user_version 18` holding a run and an anchor; `origin/main`'s `db.ts` and `store.ts` (an export of `7f7bf4afc`, `COORD_SCHEMA_VERSION` 17) then opened it: `openCoordDb` took rule 3 — it warned `coord.db is at schema 18, this build knows 17 — reading it as-is and migrating nothing (a rollback may only refuse to migrate, never to read)` — read the run back, opened a second run (`openRun` → `{ id: 2, state: 'planned' }`), read its own stall-watch settings row (`stallSettings()` → `kind: 'row'`, level `follow`), left `user_version` at 18 and the anchor row untouched. Rolled forward, the prototype read the anchor back as written and both runs. (The same probe at slot 17 against `9b0742089`'s build, `COORD_SCHEMA_VERSION` 16, measured the same while planning.) That is the shape chosen: a NEW TABLE and nothing else — no column on a table an older build writes (an `ALTER TABLE runs ADD COLUMN … NOT NULL` would break an older build's `INSERT INTO runs`), so the update watchdog can roll a server box back and it boots. What a rollback cannot do is keep the anchors current, so a row it leaves is an episode nobody measured: `lastDeadAt` rides beside `firstDeadAt`, and an episode whose last crashed pass is more than ten minutes old restarts (the departure `dead-anchor-restarts-after-an-unobserved-gap`).
3. **The migration slot.** `origin/main` (`7f7bf4afc`) holds seventeen banners: stall-watch-settings W1 (#320, `2026-10-05-stall-watch-settings-w1-server.md`) merged first and took `16 -> 17` (`stall_settings` and `run_events_by_at`), so this plan's entry, drafted at 17, is `17 -> 18`. Measured at the re-base over every remote head: none holds an eighteenth banner, and the three at seventeen (`ws/calm-basin`, `ws/plain-hollow`, `ws/swift-meadow`) carry #320's entry. Global Constraints says who moves next time.
4. **Landing never reads `causedBy`.** `coord/landing.ts` and `sweepLanding` decide on the workspace's surviving OPEN run (`openRunsForSession` → `survivorOf`) and its coordinator (`resolveCoordinator`); the word appears in neither (`grep -n causedBy server/src/coord/landing.ts server/src/watch.ts` finds nothing in the landing lane). So a run the sweep failed already reads as one the operator abandoned. Task 9 pins it: the same facts and the same verdict, whoever failed the run. The other `causedBy` readers: `run_events` is free text; `RoutingEvent.causedBy` is a `string`; the reclaim trail keys on `causedBy = 'operator' AND detail LIKE 'reclaim:%'`, which a sweep row never matches; the stall watch's notices parse `detail`, not `causedBy`.
5. **CCR-15's texts name no `causedBy` vocabulary.** Spec §6 item 5 asks that "CCR-15's spec text naming causedBy's vocabulary" be amended; measured, neither `2026-09-22-child-workspace-reclamation-design.md` nor `child-reclamation-contract.md` spells `causedBy`. The set is written in the build-4 design (`2026-08-11-build4-conversation-and-controls-design.md`, "run events already carry `causedBy ∈ {'coordinator','operator',<session id>}`") and in `close.ts`. Task 13 amends that sentence and §6 item 5 says why (the departure `caused-by-vocabulary-lives-in-the-build4-design`).
6. **Which box's registry arms the lane.** The server reads `$REG` through its `FleetIO`: `index.ts` hands `CCRC_FLEET=remote` the agent's `fleet.io` (the FLEET box's `~/.cc-sessions`) and local mode `localIO` (the server's own). `$REG/dead-coordinator-lane-live` and `$REG/reclaim-paused` are read from that listing — on the live fleet, the fleet box. README says so (Task 13).
7. **A new tick lane is seen by every test that ticks a watcher.** An open run whose claimant has NO registry row and no journal history is listed `unmeasured` (spec: "listed, never acted on"), and that list rides the coord frame — so `fleetws.test.ts`'s three `runs`-frame cases, whose run is claimed by an id nothing registers, saw an extra `coord` frame. Each now registers its claimant (Task 11), and the coord-frame cases gain the field. Measured over every server file that constructs a `FleetWatcher` — 36 on the re-based tree, `main`'s 34 and this plan's two new ones; #320 added none: those two edits are the only ones needed.
8. **Test doubles of the watcher.** `lifecycle.test.ts` hands `buildServer` a structural stand-in watcher with no `useCoordSerialiser`; the call is optional (`watcher?.useCoordSerialiser?.(…)`), so a double with no lane is not handed one (seven cases red without it, measured).
9. **The relation to the stall watch — measured, and not "one push".** Two of the stall watch's arms notify the operator about a dead coordinator, both PER WORKER and both through its operator-push gate, `coord/stall.ts`'s `stallNotifyDelivery` — the arming's `live` AND `escalate`. Since #320 that arming is ONE resolution, `resolveStallWatch` (`coord/stallsettings.ts`), read by both sweeps: under Follow (the seeded default) the fleet box's files decide it as before (`stall-watch-live` AND `stall-watch-escalate`); a level chosen in Settings (`POST /api/coord/stall-watch`, session-only) decides the flags instead — Alert and the two levels above it push, Off, Log only and Check silent workers do not — and the kill file `stall-watch-disabled` still returns the files wholesale. r3 `coordinator-dead` — r2 measures the claimant with the same `measureClaimant` and, when it reads dead, r3 pushes once per stalled worker episode, "Reclaim the run: POST /api/runs/<id>/reclaim" (`stall.ts`, `case 'coordinator-dead'`) — and `coord-deaf`, which pushes "⚠ coordinator deaf" for each worker whose ball-passing mail to its coordinator sat unacked `COORD_DEAF_MS` (one hour), WITHOUT measuring the coordinator; `coord-deaf` is a wave-2 arm, so it records shadow only until the resolved arming's `w2Live` is on (`STALL_ARM_WAVE`): `stall-watch-w2-live` under Follow, or the level Everything chosen in Settings — which a strict mail gate holds off. So a dead coordinator with N stalled workers produces up to N r3 pushes while the resolved arming pushes and, once the wave-2 arms are armed, up to N `coord-deaf` pushes — each naming its worker's workspace and the coordinator. This lane adds NONE, and no stall-watch setting — file or chosen level — arms, silences or reaches it: its rows are feed records (`log.record`, never `pushOne`) and attention entries keyed by the same claimant id, and they name the claimant as the stall watch's pushes do, so they read as the same incident's outcome rather than a second incident. The remedy text differs on purpose: r3 names the reclaim door (the operator's move inside the hour); the lane's entry says what an armed lane does after it. Once an armed lane closes the runs, the stall watch has no open run to watch. Task 11 pins "never pushes" (the departure `the-dead-coordinator-lane-never-pushes`, row T11.20); README and spec §5.4 say how the two relate (Task 13).
10. **Time in the lane's tests walks.** Because a gap of more than ten minutes between crashed passes restarts the episode, the lane's tests step the clock nine minutes a pass across the hour, as a live lane's minute passes would.
11. **The seven-day prose pin (F3), measured before deciding.** A prose pattern (`(seven|7)[ -]days?`, case-blind) over every code line of `server/src` and `pwa/src` holds FIVE files: `wsaudit.ts` (ccd's own `not-expired` and `child` sentences, rendered verbatim), `watch.ts` and `coord/schema.ts` (the deviation ledger's unrelated seven-day stale window), and the PWA's two archive confirms (the operator's copy — Task 5 rewords them, and they keep "seven days after its archive"). A tree-wide pin would be an allowlist of five; so it is scoped to the lane's own two files, where a period in a sentence is the defect F3 was (Task 3).
12. **The breaker's first trip is likely the first deploy.** Every coordinator crashed before the deploy gets its anchor on the first pass, so two or more of them trip the breaker at once — which is what the breaker is for: they are listed, nothing is ended, and the operator revives, reclaims or abandons them before arming. Not measured on the fleet (this plan calls no live route and reads no live store); the shadow list on `/runs` is that measurement (the deploy note).
13. **`closeRun` from a run's state.** `markDispatched` binds a session and never moves `runs.state`; a fixture run reaches `dispatched` (`planned -> dispatched`) before the abandon arm's `closing` hop exists. The abandon arm refuses a run already `closing` (`bad-transition: closing → closing`), which Task 10 uses as its run the arm cannot move.
14. **The journal the clause reads is best-effort, and says so** (the safety review's critical finding, measured). `mirror.ts`: "the journal is best-effort and never gates an act"; ccd's `_lc_emit` is "Always 0" and counts an append it could not make in `$REG/.lifecycle/errors` (temp+rename, so the file's mtime is the last count's instant); the mirror records lost byte ranges as `lifecycle_gaps` rows, each naming its generation; and `JournalMirror.health()` answers `unavailable` (the fleet's ccd lacks `lifecycle-v1` — the mirror then never sweeps), `unknown` (no sweep since this process started), `stale` (none for three intervals) or `ok`. The drafted clause read every one of those as "quiet" — measured by the safety review on the drafted L1: an `orphan` with no history read `crashed` with the mirror `unavailable`, and an `absent` row whose `forget` line fell in a gap read `crashed`. This plan reads the four facts beside the rows (`readDeadCoordinatorJournalTrust`, Task 10; `deadCoordinatorJournal`'s third argument, Task 6): `unavailable`, a gap in a generation NOT older than the claimant's last successful spawn (generations are immutably named and appended in time order, so an older one lost only lines from before that spawn; an unplaceable name, or no spawn at all, counts against it), and a write failure at or after that spawn's `at` (one box's clock) each make the claimant unmeasured; `unknown` and `stale` make the pass decide nothing at all, so a restart never deletes an anchor (the departure `journal-loss-reads-as-unmeasured`). Measured cost: one `SELECT DISTINCT gen FROM lifecycle_gaps` per pass and per re-measure, and one `stat` only while ccd has counted a failure.
15. **The breaker as drafted narrowed the spec's fleet-wide arm, and forgot** (the spec and safety reviews, measured). It tripped on "unmeasurable" only when EVERY claimant of at least two read unmeasurable — but `measureClaimant` answers `dead` for an absent row before it asks tmux (`reclaim.ts`, rung 1), so with tmux down for everyone a row-less claimant still read crashed beside an unmeasurable one, and nothing tripped; and one claimant facing a dead tmux raised nothing. The lane now notes a tmux `unknown` answer for any claimant as a fleet-wide doubt that trips it whatever the count (ruling F's own words, "tmux is unmeasurable fleet-wide"); a registry that will not list stops the tick before the lane runs, so no pass acts. And the drafted breaker was recomputed from each pass's anchors alone, while any non-crash answer deletes an anchor (ruling E): measured by the safety review on the drafted L1, one transient unmeasurable reading of one member at T0+30m re-anchored it at T0+31m and dissolved the cluster for good. The breaker now remembers its members at their first-dead instants (the departure `breaker-remembers-its-cluster`).
16. **A compare-and-set cannot see a revive of the SAME id** (the safety and tests reviews, measured). `ccd ensure` on the crashed id takes no mutex and changes no `claimedBy`; the drafted executor re-measured once before calling the arm, which then read siblings, ran `childGateAtClose` and `ws-release` through `runCcd` (an agent round trip; 15 s is the agent client's default request timeout) before the commit — measured by the tests review with a probe, a tmux that answered `gone` to the re-measure and `live` right after let the act fail a run whose coordinator was live. And the drafted "forced interleaving" injected `reclaimProgram`, whose only caller runs behind the same `CoordMutex`, so it forced a race the serialiser already excludes. Now the arm itself re-measures (`SweepCloseGuard.stillCrashed`) immediately before the fleet act and again after it, before the commit; the forced-interleaving test is the same-id revive; and the residual is named: a revive inside the second re-measure's round trip, between its tmux answer and the commit (the departure `the-sweep-re-measures-inside-the-arm`).
17. **Spec §9's stage-4 row needs durable facts.** "Programmes ended by the stage-4 lane; breaker trips; later reclaims of their slugs — reported, each with its first-dead time." The drafted feed rows carried no first-dead time, a breaker trip lived only in memory, and the anchor row is deleted when its claimant leaves the population. Now every would-end, ended and partly-ended row carries `dead since <instant>`, a trip writes one feed row, and `deploy/measure-workspace-lifecycle.py` reads them (Task 13). "Later reclaims of their slugs" is read as a run opened for an ended programme's slug after the lane ended it — the only later act a retired programme's slug can see.

## How to read the blocks

Each edit is a block headed by an HTML comment. A **replace** (`<!-- replay: replace <path> -->`) names its file (an `In <path>, find:` line), shows the text to find — whole lines, occurring EXACTLY ONCE in the file at that point of the plan (earlier blocks already applied), and unique even as a raw substring — and the text that replaces it. A **create** (`<!-- replay: create <path> -->`) shows a whole new file. A **fragment** (`<!-- replay: fragment <path> -->`, one in this plan, Task 4) shows a PART of one line, occurring exactly once in the file, and the text that replaces that part: used where the whole line is a column-0 ledger entry whose subject changes, which `deviation-refs.test.ts` would read in this plan's own blocks as a second definition of the number. A block's text is the lines between its fences and ends with a newline (a fragment's, without one). Apply the blocks in the order given: Step 1 of each task holds its test edits (the red stage), Step 3 its source edits (the green stage), Step 5 its taxes where it has them. The replay check applied exactly these 134 blocks to `7f7bf4afc` in one pass and reproduced the re-based prototype's tree byte for byte in every file the plan touches (47 files).

---

### Task 1: An unlearnable row backs off, is listed, and yields its learn slot (review 313, parked item 1 — an arming blocker)

**Model routing:** `sonnet`, effort `high` — two L1 arms and one sort; the review's text is the specification.

**Files:** `server/src/archivedExpiry.ts` (`archivedExpiryLearned`), `server/src/watch.ts` (`archivedExpiryPass`'s learn slots); tests `server/test/archived-expiry-policy.test.ts`, `server/test/archived-expiry-lane.test.ts`.

**Interfaces:** `archivedExpiryLearned(entry, read, nowMs, passMs)` keeps its signature. An `unreadable` read, or a document with `archivedAt: null` that is not a `gone` word (an interrupted ws-reap's `reap-in-progress`, answered before ccd read the stamp), now climbs the failure ladder (`failures`, `failingSince`, `nextAskAt = now + archivedExpiryBackoffMs(failures, passMs)`) and sets the report `{ kind: 'failing', detail: 'its expiry could not be learned — <why>' }` at once; a `gone` word with no archive (a return) is asked next pass, unreported; a successful learn clears the failure run and its `failing` report. In the lane, learn candidates are collected, then sorted by `nextAskAt` (stable: ties keep registry order), and the first `EXPIRE_AUDITS_PER_PASS` are audited.

- [ ] **Step 0: Install each package's own modules, and the scratch directory**

```bash
( cd server && npm ci ) && ( cd agent && npm ci ) && ( cd pwa && npm ci )
mkdir -p <the volume's mount>/scratch-<run>-tmp   # OUTSIDE every git checkout; export TMPDIR to it, and CCD_DISK_FLOOR_GB=1
```

- [ ] **Step 1: The tests (red).** Two policy cases (the backoff and the report, for an unreadable audit and for one that read no archive; and the clean-up when a learn later succeeds, and a return reported nothing) and two lane cases (a never-asked row takes a learn slot ahead of rows that keep failing, whatever the registry order; an unlearnable row is listed at once and not asked again inside its backoff).

<!-- replay: replace server/test/archived-expiry-lane.test.ts -->
In `server/test/archived-expiry-lane.test.ts`, find:

````ts
  await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
};

````

Replace with:

````ts
  await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
};

describe('learning: slots in nextAskAt order, an unlearnable row backed off and reported (review 313, parked item 1)', () => {
  it('a row never asked takes a learn slot ahead of rows that keep failing, whatever the registry order', async () => {
    const stuck = new Set(['demo-a', 'demo-b', 'demo-c']);
    const f = await fixture({ audit: (id) => (stuck.has(id) ? { session: 'demo-elsewhere' } : { verdict: 'expirable', token: tokOf(id) }) });
    for (const id of stuck) f.plant(id);
    await f.pass();
    expect(f.verbsFor('ws-audit')).toEqual(['demo-a', 'demo-b', 'demo-c']);
    f.plant('demo-z');
    f.advance(2 * CHILD_RECLAIM_SWEEP_MS + 1);   // past the stuck rows' first backoff: all four may be asked
    await f.pass();
    expect(f.verbsFor('ws-audit').slice(3), 'the never-asked row first, then the two asked longest ago')
      .toEqual(['demo-z', 'demo-a', 'demo-b']);
  });

  it('an unlearnable row is listed at once, and not asked again before its backoff', async () => {
    const f = await fixture({ audit: (id) => (id === 'demo-a' ? { session: 'demo-elsewhere' } : { verdict: 'expirable', token: tokOf(id) }) });
    f.plant('demo-a');
    await f.pass();
    f.next(); await f.pass();
    expect(f.verbsFor('ws-audit'), 'one audit: the second pass is inside the backoff').toEqual(['demo-a']);
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.expiryAttention?.map((a) => [a.sessionId, a.kind])).toEqual([['demo-a', 'failing']]);
  });
});

````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find:

````ts

  it('twice observed: an eligible pass seeds, a later one makes it due, and any other verdict ends the run', () => {
````

Replace with:

````ts

  it('a learn audit that cannot be read, or that read NO archive, backs off and is REPORTED (review 313, parked item 1)', () => {
    // Such a row was asked again every pass, with no backoff and no attention entry — invisible in the shadow record,
    // which is the operator's arming evidence. It now climbs the failure ladder, and the list says why.
    const e = archivedExpiryEntry(1_789_000_000);
    const unread = archivedExpiryLearned(e, { kind: 'unreadable', detail: 'ws-audit --expire printed no JSON document' }, NOW, PASS);
    expect(unread).toMatchObject({ expiresAt: null, failures: 1, failingSince: NOW, nextAskAt: NOW + 2 * PASS });
    expect(unread.report).toEqual({ kind: 'failing', at: NOW,
      detail: 'its expiry could not be learned — ws-audit --expire printed no JSON document' });
    const again = archivedExpiryLearned(unread, { kind: 'unreadable', detail: 'x' }, NOW + 2 * PASS, PASS);
    expect(again).toMatchObject({ failures: 2, failingSince: NOW, nextAskAt: NOW + 2 * PASS + 4 * PASS });
    expect(again.report?.at, 'since when, kept').toBe(NOW);
    // A refusal ccd answered before it read the stamp — an interrupted ws-reap's breadcrumb — names no archive.
    const crumb = parseExpireAudit(ID, true, JSON.stringify({ session: ID, mode: 'expire', archivedAt: null, expiresAt: null,
      sensitive: [], verdict: 'reap-in-progress', detail: 'an interrupted ws-reap stands' }));
    const r = archivedExpiryLearned(e, crumb, NOW, PASS);
    expect(r).toMatchObject({ failures: 1, nextAskAt: NOW + 2 * PASS });
    expect(r.report).toEqual({ kind: 'failing', at: NOW,
      detail: 'its expiry could not be learned — ws-audit --expire read no archive (reap-in-progress: an interrupted ws-reap stands)' });
  });

  it('a learn that succeeds after failing clears the run and its report; a row that left the archive is not reported', () => {
    const failing = archivedExpiryLearned(archivedExpiryEntry(1_789_000_000), { kind: 'unreadable', detail: 'x' }, NOW, PASS);
    expect(archivedExpiryLearned(failing, learnedDoc(1_789_604_800), NOW + 2 * PASS, PASS))
      .toMatchObject({ expiresAt: 1_789_604_800, failures: 0, failingSince: null, report: null });
    const returned = parseExpireAudit(ID, true, JSON.stringify({ session: ID, mode: 'expire', archivedAt: null, expiresAt: null,
      sensitive: [], verdict: 'not-archived', detail: '' }));
    expect(archivedExpiryLearned(archivedExpiryEntry(1_789_000_000), returned, NOW, PASS),
      'a return: the next pass drops the row').toMatchObject({ failures: 0, report: null, nextAskAt: NOW + PASS });
  });

  it('twice observed: an eligible pass seeds, a later one makes it due, and any other verdict ends the run', () => {
````


- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-lane.test.ts --maxWorkers=1 )
```

Measured: `archived-expiry-policy.test.ts`: `1 failed | 45 passed (46)` — × a learn audit that cannot be read, or that read NO archive, backs off and is REPORTED (review 313, parked item 1); `archived-expiry-lane.test.ts`: `2 failed | 23 passed (25)` — × a row never asked takes a learn slot ahead of rows that keep failing, whatever the registry order; × an unlearnable row is listed at once, and not asked again before its backoff

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find:

````ts
 *  under the lane — learned nothing, asked again next pass. */
export function archivedExpiryLearned(entry: ArchivedExpiryEntry, read: ExpireAuditRead, nowMs: number, passMs: number): ArchivedExpiryEntry {
  if (read.kind === 'unreadable') return { ...entry, nextAskAt: nowMs + passMs };
  if (read.archivedAt !== entry.archivedAt) return { ...entry, nextAskAt: nowMs + passMs };
  if (read.expiresAt.kind !== 'at') {
    return { ...entry, nextAskAt: nowMs + EXPIRE_NO_EVIDENCE_RETRY_MS,
      report: read.expiresAt.kind === 'absent' ? { kind: 'no-evidence', at: nowMs } : entry.report };
  }
  return { ...entry, expiresAt: read.expiresAt.at, nextAskAt: 0,
    report: entry.report?.kind === 'no-evidence' ? null : entry.report };
````

Replace with:

````ts
 *  under the lane — learned nothing, asked again next pass. An audit that could not be READ, or that read NO archive
 *  (a refusal ccd answered before it read the stamp: an interrupted ws-reap's breadcrumb, `reap-in-progress`), taught
 *  nothing either, and it is not asked again every pass: it climbs the failure ladder and is REPORTED, so a row the
 *  lane cannot learn is on the attention list — the shadow record is the operator's arming evidence — and never takes a
 *  learn slot each pass (review 313, parked item 1). A `gone` word is a return, which the next pass drops unreported. */
export function archivedExpiryLearned(entry: ArchivedExpiryEntry, read: ExpireAuditRead, nowMs: number, passMs: number): ArchivedExpiryEntry {
  if (read.kind === 'document' && read.archivedAt === null && read.verdict.kind === 'refused'
    && EXPIRE_TOKEN_KIND[read.verdict.token] === 'gone') return { ...entry, nextAskAt: nowMs + passMs };
  if (read.kind === 'unreadable' || read.archivedAt === null) {
    const why = read.kind === 'unreadable' ? read.detail : `ws-audit --expire read no archive (${read.verdict.kind === 'refused'
      ? `${read.verdict.token}${read.verdict.detail === '' ? '' : `: ${read.verdict.detail}`}` : 'expirable'})`;
    const failures = entry.failures + 1;
    const failingSince = entry.failingSince ?? nowMs;
    return { ...entry, failures, failingSince, nextAskAt: nowMs + archivedExpiryBackoffMs(failures, passMs),
      report: { kind: 'failing', at: failingSince, detail: `its expiry could not be learned — ${why}` } };
  }
  if (read.archivedAt !== entry.archivedAt) return { ...entry, nextAskAt: nowMs + passMs };
  const learned = { failures: 0, failingSince: null, report: entry.report?.kind === 'failing' ? null : entry.report };
  if (read.expiresAt.kind !== 'at') {
    return { ...entry, ...learned, nextAskAt: nowMs + EXPIRE_NO_EVIDENCE_RETRY_MS,
      report: read.expiresAt.kind === 'absent' ? { kind: 'no-evidence', at: nowMs } : learned.report };
  }
  return { ...entry, ...learned, expiresAt: read.expiresAt.at, nextAskAt: 0,
    report: learned.report?.kind === 'no-evidence' ? null : learned.report };
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts
      if (!v.eligible && v.why === 'expiry-unknown' && now >= entry.nextAskAt && learn.length < EXPIRE_AUDITS_PER_PASS) {
        learn.push(r.id);
      }
````

Replace with:

````ts
      if (!v.eligible && v.why === 'expiry-unknown' && now >= entry.nextAskAt) learn.push(r.id);
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts
    // THREE — learn: one audit at a time, each on its session's queue.
    for (const id of learn) {
````

Replace with:

````ts
    // THREE — learn: one audit at a time, each on its session's queue. The slots go in `nextAskAt` order — a row never
    // asked (0) first, then the rows asked longest ago — never registry order, so rows that keep failing cannot take
    // every slot from a row behind them (review 313, parked item 1). The sort is stable: ties keep registry order.
    learn.sort((a, b) => this.archivedExpiryState.get(a)!.nextAskAt - this.archivedExpiryState.get(b)!.nextAskAt);
    for (const id of learn.slice(0, EXPIRE_AUDITS_PER_PASS)) {
````


- [ ] **Step 4: Run — green.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-lane.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/expire-archived.test.ts --maxWorkers=1 )
```

Measured: `archived-expiry-policy.test.ts`: `46 passed (46)`; `archived-expiry-lane.test.ts`: `25 passed (25)`; `expire-archived.test.ts`: `17 passed (17)`

- [ ] **Step 5: Mutation check, then commit.**

| # | Edit (restore after) | Measured red |
|---|---|---|
| T1.1 | `server/src/archivedExpiry.ts`: ``    return { ...entry, failures, failingSince, nextAskAt: nowMs + archivedExpiryBackoffMs(failures, passMs), ⏎       report: { kind: 'failing', at: failingSince, detail: `its expiry could not be learned — ${why}` } };`` → ``    return { ...entry, failures, failingSince, nextAskAt: nowMs + passMs, ⏎       report: { kind: 'failing', at: failingSince, detail: `its expiry could not be learned — ${why}` } };`` | `archived-expiry-policy.test.ts`: `1 failed \| 45 passed (46)` — a learn audit that cannot be read, or that read NO archive, backs off and is REPORTED (review 313, parked item 1)<br>`archived-expiry-lane.test.ts`: `1 failed \| 24 passed (25)` — an unlearnable row is listed at once, and not asked again before its backoff |
| T1.2 | `server/src/archivedExpiry.ts`: ``      report: { kind: 'failing', at: failingSince, detail: `its expiry could not be learned — ${why}` } };`` → `      report: entry.report };` | `archived-expiry-policy.test.ts`: `1 failed \| 45 passed (46)` — a learn audit that cannot be read, or that read NO archive, backs off and is REPORTED (review 313, parked item 1)<br>`archived-expiry-lane.test.ts`: `1 failed \| 24 passed (25)` — an unlearnable row is listed at once, and not asked again before its backoff |
| T1.3 | `server/src/watch.ts`: `    learn.sort((a, b) => this.archivedExpiryState.get(a)!.nextAskAt - this.archivedExpiryState.get(b)!.nextAskAt); ⏎ ` → (removed) | `archived-expiry-lane.test.ts`: `1 failed \| 24 passed (25)` — a row never asked takes a learn slot ahead of rows that keep failing, whatever the registry order |
| T1.4 | `server/src/archivedExpiry.ts`: `  if (read.kind === 'unreadable' \|\| read.archivedAt === null) {` → `  if (read.kind === 'unreadable') {` | `archived-expiry-policy.test.ts`: `1 failed \| 45 passed (46)` — a learn audit that cannot be read, or that read NO archive, backs off and is REPORTED (review 313, parked item 1) |
| T1.5 | `server/src/archivedExpiry.ts`: `  const learned = { failures: 0, failingSince: null, report: entry.report?.kind === 'failing' ? null : entry.report };` → `  const learned = { failures: entry.failures, failingSince: entry.failingSince, report: entry.report };` | `archived-expiry-policy.test.ts`: `1 failed \| 45 passed (46)` — a learn that succeeds after failing clears the run and its report; a row that left the archive is not reported |
| T1.6 | `server/src/archivedExpiry.ts`: `  if (read.kind === 'document' && read.archivedAt === null && read.verdict.kind === 'refused' ⏎     && EXPIRE_TOKEN_KIND[read.verdict.token] === 'gone') return { ...entry, nextAskAt: nowMs + passMs }; ⏎ ` → (removed) | `archived-expiry-policy.test.ts`: `1 failed \| 45 passed (46)` — a learn that succeeds after failing clears the run and its report; a row that left the archive is not reported |

```bash
git add server/src/archivedExpiry.ts server/src/watch.ts server/test/archived-expiry-policy.test.ts server/test/archived-expiry-lane.test.ts
git commit -m "$(cat <<'MSG'
fix(expiry): an unlearnable row backs off, is listed, and yields its learn slot

Review 313, parked item 1 (an arming blocker): a learn audit that could not
be read, or that read no archive (an interrupted ws-reap's breadcrumb), was
asked again every pass with no backoff and no attention entry, invisible in
the shadow record. It now climbs the failure ladder and is reported at once;
learn slots go in nextAskAt order, so rows that keep failing cannot take
every slot from a row behind them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: A failure the box says will not resume stops at once (review 313, parked item 4 — an arming blocker)

**Model routing:** `sonnet`, effort `high`.

**Files:** `server/src/archivedExpiry.ts` (`ArchivedExpiryOutcome`, `ExpiryReport`'s `failing`, `archivedExpiryNextEntry`, `expiryReportSentence`), `server/src/coord/expireArchived.ts` (the audit's and the verb's `failed` mappings, `expireFeedBody`); tests `server/test/archived-expiry-policy.test.ts`, `server/test/archived-expiry-lane.test.ts`, `server/test/expire-archived.test.ts`.

**Interfaces:** `ArchivedExpiryOutcome`'s `failed` arm becomes `{ kind: 'failed'; resumable: boolean; detail: string }` — `ExpireVerbRead.failed.resumable` CARRIED, never narrowed (CLAUDE.md's adapter rule). An audit that measured nothing maps to `resumable: true`. `archivedExpiryNextEntry` on `failed` with `resumable: false` (a wrong-row `expired`, a refusal word this build does not know, `probe-unmeasured`) answers `nextAskAt: +∞` and `{ kind: 'failing', at: now, detail, final: true }` at once — never after the hour's ceiling. `ExpiryReport`'s `failing` gains an optional `final: true`, and its sentence then says "cleanup stopped: … It is not asked again for this archive." — a composition error is `final` too, which corrects its sentence (it said "It is retried" of a call that is never retried). The feed body for a non-resumable `failed` says "It is not retried".

- [ ] **Step 1: The tests (red).**

<!-- replay: replace server/test/archived-expiry-lane.test.ts -->
In `server/test/archived-expiry-lane.test.ts`, find:

````ts
    expect(f.watcher.currentCoord()?.expiryAttention?.map((a) => [a.sessionId, a.kind])).toEqual([['demo-a', 'failing']]);
````

Replace with:

````ts
    expect(f.watcher.currentCoord()?.expiryAttention?.map((a) => [a.sessionId, a.kind])).toEqual([['demo-a', 'failing']]);
  });
});

describe('a failure that will not resume (review 313, parked item 4)', () => {
  it('a wrong-row `expired` is reported at once and never asked again for this archive — not after an hour', async () => {
    const f = await fixture({ expire: () => ({ code: 0, stdout: JSON.stringify({ expired: 'demo-other', archivedAt: OLD, wip: null }), stderr: '' }) });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await threePasses(f);
    expect(f.verbsFor('ws-expire')).toEqual(['demo-a']);
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.expiryAttention?.map((a) => [a.sessionId, a.kind])).toEqual([['demo-a', 'failing']]);
    for (let k = 0; k < 70; k += 1) { f.next(); await f.pass(); }   // well past the one-hour ceiling
    expect(f.verbsFor('ws-expire'), 'stopped, never retried').toEqual(['demo-a']);
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find:

````ts
  expireTokenKind, expiryAttention, expiryInUseSentence, parseExpireAudit, parseExpireResult, reviewKeeps,
````

Replace with:

````ts
  expireTokenKind, expiryAttention, expiryInUseSentence, expiryReportSentence, parseExpireAudit, parseExpireResult, reviewKeeps,
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find:

````ts
    x = archivedExpiryNextEntry(x, { kind: 'failed', detail: 'pin-failed' }, NOW, PASS)!;
    expect(x.nextAskAt).toBe(NOW + 2 * PASS);
    expect(x.report).toBeNull();
    x = archivedExpiryNextEntry(x, { kind: 'failed', detail: 'pin-failed' }, NOW + EXPIRE_FAILURE_CEILING_MS, PASS)!;
    expect(x.report).toMatchObject({ kind: 'failing', at: NOW });
````

Replace with:

````ts
    x = archivedExpiryNextEntry(x, { kind: 'failed', resumable: true, detail: 'pin-failed' }, NOW, PASS)!;
    expect(x.nextAskAt).toBe(NOW + 2 * PASS);
    expect(x.report).toBeNull();
    x = archivedExpiryNextEntry(x, { kind: 'failed', resumable: true, detail: 'pin-failed' }, NOW + EXPIRE_FAILURE_CEILING_MS, PASS)!;
    expect(x.report).toMatchObject({ kind: 'failing', at: NOW });
  });

  it('a failure the box says will NOT resume stops at once: reported, never asked again for this archive (review 313, parked item 4)', () => {
    // `ExpireVerbRead.failed.resumable` is carried through the outcome, never narrowed: a wrong-row `expired`, a word
    // this build does not know, or `probe-unmeasured` is not something waiting cures — no hour of retries first.
    const detail = 'ws-expire reported expiring demo-other, not demo-quiet-dune';
    const x = archivedExpiryNextEntry(e(), { kind: 'failed', resumable: false, detail }, NOW, PASS)!;
    expect(x.nextAskAt).toBe(Number.POSITIVE_INFINITY);
    expect(x.report).toEqual({ kind: 'failing', at: NOW, detail, final: true });
    expect(expiryReportSentence(x.report!, null)).toBe(`cleanup stopped: ${detail}. It is not asked again for this archive.`);
    const c = archivedExpiryNextEntry(e(), { kind: 'composition', detail: 'bad token' }, NOW, PASS)!;
    expect(expiryReportSentence(c.report!, null), 'a composition error is never retried either, and says so')
      .toBe('cleanup stopped: the server composed a call ccd rejected: bad token. It is not asked again for this archive.');
````

<!-- replay: replace server/test/expire-archived.test.ts -->
In `server/test/expire-archived.test.ts`, find:

````ts

  it('a refusal at audit carries its word — in-use with the processes; a GONE word is gone', async () => {
````

Replace with:

````ts

  it('a failure the box says will not resume is carried as such, never narrowed to a retryable one (review 313, parked item 4)', async () => {
    const cases: [number, string, boolean][] = [
      [0, JSON.stringify({ expired: 'demo-other', archivedAt: ARCH, wip: null }), false],
      [0, JSON.stringify({ refused: 'a-word-a-newer-ccd-says', detail: '' }), false],
      [1, JSON.stringify({ failed: 'probe-unmeasured', detail: 'ps is missing' }), false],
      [1, JSON.stringify({ failed: 'pin-failed', detail: 'the attic pin failed' }), true],
    ];
    for (const [code, stdout, resumable] of cases) {
      const s = await rig({ script: { audit: { code: 0, stdout: auditDoc('expirable', { token: TOK }) }, verb: { code, stdout } } });
      const out = await expireArchived(s.deps, s.req);
      expect(out, stdout).toMatchObject({ kind: 'failed', resumable });
      recordExpireFeed(s.deps, out);
      expect(s.coord.feedEvents(10)[0]!.body, stdout).toContain(resumable ? 'It is retried' : 'It is not retried');
    }
    const unread = await rig({ script: { audit: { code: 1, stdout: auditDoc('unmeasured') } } });
    expect(await expireArchived(unread.deps, unread.req), 'an audit that measured nothing is retried')
      .toMatchObject({ kind: 'failed', resumable: true });
  });

  it('a refusal at audit carries its word — in-use with the processes; a GONE word is gone', async () => {
````


- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-lane.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/expire-archived.test.ts --maxWorkers=1 )
```

Measured: `archived-expiry-policy.test.ts`: `1 failed | 46 passed (47)` — × a failure the box says will NOT resume stops at once: reported, never asked again for this archive (review 313, parked item 4); `archived-expiry-lane.test.ts`: `1 failed | 25 passed (26)` — × a wrong-row `expired` is reported at once and never asked again for this archive — not after an hour; `expire-archived.test.ts`: `1 failed | 17 passed (18)` — × a failure the box says will not resume is carried as such, never narrowed to a retryable one (review 313, parked item 4)

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find:

````ts
  | { readonly kind: 'failing'; readonly at: number; readonly detail: string }
````

Replace with:

````ts
  /** `final`: the row is not asked again for this archive — a composition error, or a failure the box said will not
   *  resume — so its sentence never promises a retry. Absent on a failure that is still being retried. */
  | { readonly kind: 'failing'; readonly at: number; readonly detail: string; readonly final?: true }
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find:

````ts
  | { readonly kind: 'failed'; readonly detail: string }
````

Replace with:

````ts
  /** `resumable` is the box's own answer (`ExpireVerbRead.failed.resumable`), CARRIED, never narrowed (review 313,
   *  parked item 4): `false` — a wrong-row `expired`, a refusal word this build does not know, `probe-unmeasured` — is
   *  not something waiting cures, so the row is reported and not asked again for this archive. */
  | { readonly kind: 'failed'; readonly resumable: boolean; readonly detail: string }
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find:

````ts
    case 'failed': case 'box': {
````

Replace with:

````ts
    case 'failed': case 'box': {
      if (o.kind === 'failed' && !o.resumable) {
        // The box said this will not resume: reported AT ONCE and never asked again for this archive — never an hour
        // of retries before anyone hears of it (review 313, parked item 4).
        return { ...base, ...steady, nextAskAt: Number.POSITIVE_INFINITY,
          report: { kind: 'failing', at: nowMs, detail: o.detail, final: true } };
      }
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find:

````ts
        report: { kind: 'failing', at: nowMs, detail: `the server composed a call ccd rejected: ${o.detail}` } };
````

Replace with:

````ts
        report: { kind: 'failing', at: nowMs, detail: `the server composed a call ccd rejected: ${o.detail}`, final: true } };
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find:

````ts
    case 'failing': return `cleanup keeps failing: ${r.detail}. It is retried, backing off in between.`;
````

Replace with:

````ts
    case 'failing':
      return r.final === true ? `cleanup stopped: ${r.detail}. It is not asked again for this archive.`
        : `cleanup keeps failing: ${r.detail}. It is retried, backing off in between.`;
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find:

````ts
  if (audit.kind === 'unreadable') return answer({ kind: 'failed', detail: audit.detail });
````

Replace with:

````ts
  if (audit.kind === 'unreadable') return answer({ kind: 'failed', resumable: true, detail: audit.detail });
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find:

````ts
    case 'failed': return answer({ kind: 'failed', detail: verb.detail });
````

Replace with:

````ts
    case 'failed': return answer({ kind: 'failed', resumable: verb.resumable, detail: verb.detail });
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find:

````ts
    case 'failed': return `${who}: failed — ${r.detail}. It is retried, backing off in between.`;
````

Replace with:

````ts
    case 'failed': return `${who}: failed — ${r.detail}. ${r.resumable ? 'It is retried, backing off in between.'
      : 'It is not retried: the box said it will not resume, so the lane stops asking for this archive.'}`;
````


- [ ] **Step 4: Run — green.** The same three commands, and `( cd server && ./node_modules/.bin/tsc --noEmit -p . )` (rc 0).

Measured: `archived-expiry-policy.test.ts`: `47 passed (47)`; `archived-expiry-lane.test.ts`: `26 passed (26)`; `expire-archived.test.ts`: `18 passed (18)`

- [ ] **Step 5: Mutation check, then commit.**

| # | Edit (restore after) | Measured red |
|---|---|---|
| T2.1 | `server/src/coord/expireArchived.ts`: `    case 'failed': return answer({ kind: 'failed', resumable: verb.resumable, detail: verb.detail });` → `    case 'failed': return answer({ kind: 'failed', resumable: true, detail: verb.detail });` | `expire-archived.test.ts`: `1 failed \| 17 passed (18)` — a failure the box says will not resume is carried as such, never narrowed to a retryable one (review 313, parked item 4)<br>`archived-expiry-lane.test.ts`: `1 failed \| 25 passed (26)` — a wrong-row `expired` is reported at once and never asked again for this archive — not after an hour |
| T2.2 | `server/src/archivedExpiry.ts`: `      if (o.kind === 'failed' && !o.resumable) {` → `      if (o.kind === 'failed' && o.resumable === undefined) {` | `archived-expiry-policy.test.ts`: `1 failed \| 46 passed (47)` — a failure the box says will NOT resume stops at once: reported, never asked again for this archive (review 313, parked item 4)<br>`archived-expiry-lane.test.ts`: `1 failed \| 25 passed (26)` — a wrong-row `expired` is reported at once and never asked again for this archive — not after an hour |
| T2.3 | `server/src/archivedExpiry.ts`: ``      return r.final === true ? `cleanup stopped:`` → ``      return r.final === false ? `cleanup stopped:`` | `archived-expiry-policy.test.ts`: `1 failed \| 46 passed (47)` — a failure the box says will NOT resume stops at once: reported, never asked again for this archive (review 313, parked item 4) |
| T2.4 | `server/src/coord/expireArchived.ts`: `${r.resumable ? 'It is retried, backing off in between.'` → `${true ? 'It is retried, backing off in between.'` | `expire-archived.test.ts`: `1 failed \| 17 passed (18)` — a failure the box says will not resume is carried as such, never narrowed to a retryable one (review 313, parked item 4) |

```bash
git add server/src/archivedExpiry.ts server/src/coord/expireArchived.ts server/test/archived-expiry-policy.test.ts \
  server/test/archived-expiry-lane.test.ts server/test/expire-archived.test.ts
git commit -m "$(cat <<'MSG'
fix(expiry): a failure the box says will not resume is reported and stopped at once

Review 313, parked item 4 (an arming blocker): ExpireVerbRead.failed.resumable
was narrowed into a generic failure, so a wrong-row `expired`, an unknown
refusal word or probe-unmeasured was retried for an hour before anyone heard
of it. The outcome now carries it; a non-resumable failure is listed at once
and the archive is not asked again. A composition error's sentence no longer
promises a retry.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: F1–F4 — the record follows the row, another archive's refusal is a moved row, the held sentence names its instant, a stale doc line

**Model routing:** `sonnet`, effort `high`.

**Files:** `server/src/archivedExpiry.ts` (`archivedExpirySighted`, the held sentence), `server/src/coord/expireArchived.ts` (the archive check, its header step 5), `server/src/ccdargv.ts` (`wsExpire`'s doc comment); tests `server/test/archived-expiry-policy.test.ts`, `server/test/archived-expiry-lane.test.ts`, `server/test/expire-archived.test.ts`, `server/test/single-definition.test.ts` (APPENDED at end of file, for the reason the file's later blocks state: `session-hook.test.ts`'s citation audit cites it by line).

**Interfaces:** F1 (BLOCKER): `archivedExpirySighted` on an INELIGIBLE verdict clears a `would-expire` or `in-use` report (and the run of in-use answers with it) as well as a `held` one; the box's own verdicts (`refused`, `failing`, `no-evidence`) stand. F2: the executor answers `deferred`/`state-changed` for an audit whose `archivedAt` is set and is not the queued archive, BEFORE it classifies a refusal. F3: the held sentence reads `held (“<reason>”) past its expiry (due <instant>), so it is not cleaned up — release the hold or restore it.`; the seven-day pin is widened to prose for the lane's own two files only (Pre-flight finding 11). F4: `wsExpire`'s doc drops "Composed by nothing in this build" and names its one caller.

- [ ] **Step 1: The tests (red).**

<!-- replay: replace server/test/archived-expiry-lane.test.ts -->
In `server/test/archived-expiry-lane.test.ts`, find:

````ts
    expect(f.verbsFor('ws-expire'), 'stopped, never retried').toEqual(['demo-a']);
````

Replace with:

````ts
    expect(f.verbsFor('ws-expire'), 'stopped, never retried').toEqual(['demo-a']);
  });
});

describe('the record follows the row (review 313, F1)', () => {
  it('a would-expire entry goes when the row stops being eligible — a run binds it', async () => {
    const f = await fixture();
    f.plant('demo-a');
    await threePasses(f);
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.expiryAttention?.map((a) => [a.sessionId, a.kind])).toEqual([['demo-a', 'would-expire']]);
    f.bindWorker('demo-a');
    f.next(); await f.pass();
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.expiryAttention, 'a bound row is never due again, so its record goes now').toEqual([]);
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find:

````ts

  it('held past its instant is REPORTED with its reason, and the report goes with the hold', () => {
````

Replace with:

````ts

  it('an ineligible sighting clears a would-expire or in-use report as well as a held one (review 313, F1)', () => {
    // The shadow record is the operator's arming evidence: a row that stopped being eligible (a run bound it, a review
    // opened, its identity went unmeasured) is never due again, so a report it kept would never be revisited.
    const inUse = [{ pid: 7, comm: 'sleep', cwd: '/w' }];
    const reports = [{ kind: 'would-expire', at: NOW, sensitive: 0 }, { kind: 'in-use', at: NOW, inUse, passes: 3 }] as const;
    for (const report of reports) {
      const x = { ...archivedExpiryEntry(1_789_000_000), expiresAt: 1_789_604_800, eligibleSince: NOW, inUseRun: 3, inUse, report };
      const y = archivedExpirySighted(x, { eligible: false, why: 'open-run' }, null, NOW + PASS);
      expect(y.report, report.kind).toBeNull();
      expect(y.inUseRun, `${report.kind}: the run of in-use answers ends with it`).toBe(0);
      expect(archivedExpirySighted(x, { eligible: true }, null, NOW + PASS).report, `${report.kind}, still eligible`).toEqual(report);
    }
    const refused = { ...archivedExpiryEntry(1), report: { kind: 'refused', at: NOW, token: 'containment-unproven', detail: '' } } as const;
    expect(archivedExpirySighted(refused, { eligible: false, why: 'open-run' }, null, NOW).report, 'the box’s own verdict stands')
      .toEqual(refused.report);
  });

  it('the held sentence names the instant, never a period — the threshold is ccd’s (review 313, F3)', () => {
    const s = expiryReportSentence({ kind: 'held', at: NOW, reason: 'program:x wave:1/2' }, 1_789_604_800);
    expect(s).toBe('held (“program:x wave:1/2”) past its expiry (due 2026-09-17 00:26 UTC), so it is not cleaned up — '
      + 'release the hold or restore it.');
  });

  it('held past its instant is REPORTED with its reason, and the report goes with the hold', () => {
````

<!-- replay: replace server/test/expire-archived.test.ts -->
In `server/test/expire-archived.test.ts`, find:

````ts
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'no-evidence' });
    expect(s.verbs()).toEqual(['ws-audit']);
  });
````

Replace with:

````ts
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'no-evidence' });
    expect(s.verbs()).toEqual(['ws-audit']);
  });

  it('a REFUSAL from an audit of another archive is a row that moved too — never folded onto the queued one (review 313, F2)', async () => {
    for (const verdict of ['not-expired', 'containment-unproven']) {
      const s = await rig({ script: { audit: { code: 0, stdout: auditDoc(verdict, { archivedAt: ARCH + 5, expiresAt: ARCH + 5 + 604_800 }) } } });
      expect(await expireArchived(s.deps, s.req), verdict).toMatchObject({ kind: 'deferred', why: 'state-changed' });
    }
  });
````

<!-- replay: replace server/test/single-definition.test.ts -->
In `server/test/single-definition.test.ts`, find:

````ts
    expect(ALL.filter((f) => /['"]expiresAt['"]/.test(stallCode(f))).map(rel).sort()).toEqual(['server/src/archivedExpiry.ts']);
  });
});
````

Replace with:

````ts
    expect(ALL.filter((f) => /['"]expiresAt['"]/.test(stallCode(f))).map(rel).sort()).toEqual(['server/src/archivedExpiry.ts']);
  });
});

// WORKSPACE LIFECYCLE WAVE 4 (review 313, F3). APPENDED, for the reason the blocks above state. The seven-day pin above
// reads numeric spellings only, so the expiry lane's operator text typed "past its seven days" and nothing reddened.
// MEASURED before deciding how wide: a prose pin over every code line of `server/src` and `pwa/src` holds five files —
// `wsaudit.ts` (ccd's own `not-expired` and `child` sentences, rendered verbatim), `watch.ts` and `coord/schema.ts`
// (the deviation ledger's unrelated seven-day stale window, in a log line and a migration's SQL comment), and the PWA's
// two archive confirms, which are the operator's copy. So the pin is scoped to the lane's own two files, where a
// period in a sentence is the defect.
describe('workspace lifecycle wave 4: the expiry lane’s own words type no period (review 313, F3)', () => {
  const PROSE = /\b(?:seven|7)[ -]days?\b/i;
  it('no seven-day prose on a code line of archivedExpiry.ts or coord/expireArchived.ts', () => {
    expect(PROSE.test('`held (“x”) past its seven days`'), 'CONTROL').toBe(true);
    expect(['server/src/archivedExpiry.ts', 'server/src/coord/expireArchived.ts']
      .filter((f) => PROSE.test(stallCode(path.join(ccrcRoot, f))))).toEqual([]);
  });
});
````


- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-lane.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/expire-archived.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=1 -t 'type no period' )
```

Measured: `archived-expiry-policy.test.ts`: `2 failed | 47 passed (49)` — × an ineligible sighting clears a would-expire or in-use report as well as a held one (review 313, F1); × the held sentence names the instant, never a period — the threshold is ccd’s (review 313, F3); `archived-expiry-lane.test.ts`: `1 failed | 26 passed (27)` — × a would-expire entry goes when the row stops being eligible — a run binds it; `expire-archived.test.ts`: `1 failed | 18 passed (19)` — × a REFUSAL from an audit of another archive is a row that moved too — never folded onto the queued one (review 313, F2); `single-definition.test.ts `-t type no period``: `1 failed | 406 skipped (407)` — × no seven-day prose on a code line of archivedExpiry.ts or coord/expireArchived.ts

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find:

````ts
 *  listing goes when the hold does. */
````

Replace with:

````ts
 *  listing goes when the hold does. AND THE RECORD FOLLOWS THE ROW (review 313, F1): an ineligible sighting ends a
 *  `would-expire` or `in-use` report too, with the run of in-use answers. Such a row is never due, so it is never
 *  audited again, and a report it kept would stand on the attention list — the operator's arming evidence — for as long
 *  as the condition lasts. The box's own verdicts (`refused`, `failing`, `no-evidence`) stand: they are about the box. */
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find:

````ts
    return { ...entry, eligibleSince, report: { kind: 'held', at, reason: held } };
  }
  const report = entry.report?.kind === 'held' ? null : entry.report;
  return eligibleSince === entry.eligibleSince && report === entry.report ? entry : { ...entry, eligibleSince, report };
````

Replace with:

````ts
    return { ...entry, eligibleSince, inUseRun: 0, inUse: [], report: { kind: 'held', at, reason: held } };
  }
  const ends = !v.eligible && (entry.report?.kind === 'would-expire' || entry.report?.kind === 'in-use');
  const report = entry.report?.kind === 'held' || ends ? null : entry.report;
  const run = ends ? { inUseRun: 0, inUse: [] as readonly ExpireInUse[] } : {};
  return eligibleSince === entry.eligibleSince && report === entry.report ? entry : { ...entry, ...run, eligibleSince, report };
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find:

````ts
      return `held (“${r.reason}”) past its seven days, so it is not cleaned up — release the hold or restore it.`;
````

Replace with:

````ts
      // The INSTANT, never a period: the threshold is ccd's, and a sentence that typed it would go stale the day
      // `WS_EXPIRE_AFTER_S` moves (review 313, F3).
      return `held (“${r.reason}”) past its expiry${expiresAt === null ? '' : ` (due ${iso(expiresAt)})`}, so it is not `
        + 'cleaned up — release the hold or restore it.';
````

<!-- replay: replace server/src/ccdargv.ts -->
In `server/src/ccdargv.ts`, find:

````ts
   *  Composed by nothing in this build: workspace lifecycle wave 3b's lane is its one caller, behind `EXPIRE_CAP`. */
````

Replace with:

````ts
   *  Workspace lifecycle wave 3b's lane is its one caller (`expireArchived`'s act), behind `EXPIRE_CAP`. */
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find:

````ts
 *      composed; an archive other than the one the lane queued is a row that moved, retried;
````

Replace with:

````ts
 *      composed; an archive other than the one the lane queued is a row that moved, retried — checked BEFORE a
 *      refusal is classified, so another archive's refusal is never folded onto the queued one (review 313, F2);
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find:

````ts
  if (audit.expiresAt.kind === 'absent') return answer({ kind: 'no-evidence' });
````

Replace with:

````ts
  if (audit.expiresAt.kind === 'absent') return answer({ kind: 'no-evidence' });
  // An audit that read ANOTHER archive (a row returned and archived again since the lane queued it) is a row that
  // moved, whatever it answered: its refusal, and its instant, are about that archive (review 313, F2).
  if (audit.archivedAt !== null && audit.archivedAt !== archivedAt) {
    return answer({ kind: 'deferred', why: 'state-changed',
      detail: `the audit read archive ${String(audit.archivedAt)}, not the ${archivedAt} this pass queued` });
  }
````


- [ ] **Step 4: Run — green.** The first three commands, and `single-definition` whole.

Measured: `archived-expiry-policy.test.ts`: `49 passed (49)`; `archived-expiry-lane.test.ts`: `27 passed (27)`; `expire-archived.test.ts`: `19 passed (19)`; `single-definition.test.ts`: `407 passed (407)`

- [ ] **Step 5: Mutation check, then commit.** F4 is a comment and has no row.

| # | Edit (restore after) | Measured red |
|---|---|---|
| T3.1 | `server/src/archivedExpiry.ts`: `  const ends = !v.eligible && (entry.report?.kind === 'would-expire' \|\| entry.report?.kind === 'in-use');` → `  const ends = false;` | `archived-expiry-policy.test.ts`: `1 failed \| 48 passed (49)` — an ineligible sighting clears a would-expire or in-use report as well as a held one (review 313, F1)<br>`archived-expiry-lane.test.ts`: `1 failed \| 26 passed (27)` — a would-expire entry goes when the row stops being eligible — a run binds it |
| T3.2 | `server/src/coord/expireArchived.ts`: `  if (audit.archivedAt !== null && audit.archivedAt !== archivedAt) {` → `  if (false) {` | `expire-archived.test.ts`: `1 failed \| 18 passed (19)` — a REFUSAL from an audit of another archive is a row that moved too — never folded onto the queued one (review 313, F2) |
| T3.3 | `server/src/archivedExpiry.ts`: ``       return `held (“${r.reason}”) past its expiry${expiresAt === null ? '' : ` (due ${iso(expiresAt)})`}, so it is not ` `` → ``       return `held (“${r.reason}”) past its seven days, so it is not ` `` | `archived-expiry-policy.test.ts`: `1 failed \| 48 passed (49)` — the held sentence names the instant, never a period — the threshold is ccd’s (review 313, F3)<br>`single-definition.test.ts` `-t type no period`: `1 failed \| 406 skipped (407)` — no seven-day prose on a code line of archivedExpiry.ts or coord/expireArchived.ts |
| T3.4 | `server/src/archivedExpiry.ts`: `  const run = ends ? { inUseRun: 0, inUse: [] as readonly ExpireInUse[] } : {};` → `  const run = {};` | `archived-expiry-policy.test.ts`: `1 failed \| 48 passed (49)` — an ineligible sighting clears a would-expire or in-use report as well as a held one (review 313, F1) |

```bash
git add server/src/archivedExpiry.ts server/src/coord/expireArchived.ts server/src/ccdargv.ts \
  server/test/archived-expiry-policy.test.ts server/test/archived-expiry-lane.test.ts server/test/expire-archived.test.ts \
  server/test/single-definition.test.ts
git commit -m "$(cat <<'MSG'
fix(expiry): review 313's F1-F4

F1 (an arming blocker): an ineligible sighting clears a would-expire or in-use
report, not only a held one, so the shadow record follows the row. F2: an
audit of another archive is a moved row before any refusal is classified.
F3: the held sentence names its instant, never a period, and the lane's own
files are pinned against typing one. F4: wsExpire's doc names its caller.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: The records — F5, F6, F7, O1, O2, and clause 3's child marker (parked item 3)

**Model routing:** `sonnet`, effort `medium` — words; review 313's report is the specification.

**Files:** `ccd/coordinator-skill/SKILL.md` (clause 3), `docs/superpowers/plans/2026-10-06-workspace-lifecycle-wave3b-expiry-lane.md` (two ledger entries, two mutation rows), `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` (§5.3's "The lane", §6 item 6); tests `server/test/coordinator-skill.test.ts` (the verbatim pin), `server/test/expiry-lane-prose.test.ts`.

**Interfaces:** none. Parked item 3: clause 3's last sentence becomes "…this session’s own workspace is cleaned up by a human, or — when it carries no child marker — by the server seven days after it is archived once the operator has armed the server’s expiry lane (until then the lane only records what it would expire)." — `wave-lifecycle.md` §6's own spelling of the same condition; both pins move in the red step. F5: a continuation line under 3b's `expiry-lane-ships-shadowed` entry records the final review's `eligibleSince` reset; the entry's own line is quoted unchanged. O1: 3b's `archive-door-stops-an-already-archived-live-pane` entry's main line now says the turn is re-read at the act and only an idle pane is stopped — edited by FRAGMENT (How to read the blocks): its subject changes, and a whole-line Find and Replace in this plan would read to `deviation-refs.test.ts` as one number defined twice (measured: the scanner's `ENTRY` pattern matches column-0 lines inside fences). F7 and O2: rows T7.2 and T3.5 carry the measured counts with the note why. F6: §6 item 6 and §5.3's "hosts a second population" sentence say what 3b built — a sibling pass. And §5.3's "As wave 3b builds the lane" list gains ONE item, "Review 313's residue, closed by wave 4", a short sentence for each of Tasks 1–3's five departures, so the spec says what shipped; `expiry-lane-prose.test.ts` pins it (row T4.2).

- [ ] **Step 1: The pins (red).**

<!-- replay: replace server/test/coordinator-skill.test.ts -->
In `server/test/coordinator-skill.test.ts`, find:

````ts
  'This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for any reason. A child this session dispatched is reclaimed by the server once this session is finished with it — at its run’s close when nothing still needs it, otherwise later by the server’s sweep (a child held for its program’s next wave once that program has no open run, a review child once the run it reviewed has closed, a child whose reclaim was deferred or never started); this session’s own workspace is cleaned up by a human, or by the server seven days after it is archived once the operator has armed the server’s expiry lane (until then the lane only records what it would expire).',
````

Replace with:

````ts
  'This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for any reason. A child this session dispatched is reclaimed by the server once this session is finished with it — at its run’s close when nothing still needs it, otherwise later by the server’s sweep (a child held for its program’s next wave once that program has no open run, a review child once the run it reviewed has closed, a child whose reclaim was deferred or never started); this session’s own workspace is cleaned up by a human, or — when it carries no child marker — by the server seven days after it is archived once the operator has armed the server’s expiry lane (until then the lane only records what it would expire).',
````

<!-- replay: replace server/test/expiry-lane-prose.test.ts -->
In `server/test/expiry-lane-prose.test.ts`, find:

````ts
  it('clause 3 says it too: the cleanup follows the archive once the operator has armed the lane', () => {
    const clause = flat('ccd/coordinator-skill/SKILL.md');
    expect(clause).toContain('this session’s own workspace is cleaned up by a human, or by the server seven days after it is archived once the operator has armed the server’s expiry lane (until then the lane only records what it would expire).');
````

Replace with:

````ts
  it('clause 3 says it too: the cleanup follows the archive once the operator has armed the lane — never for a child', () => {
    // A nested coordinator's own workspace is a CHILD, CCR-15's, never expired (review 313, parked item 3).
    const clause = flat('ccd/coordinator-skill/SKILL.md');
    expect(clause).toContain('this session’s own workspace is cleaned up by a human, or — when it carries no child marker — by the server seven days after it is archived once the operator has armed the server’s expiry lane (until then the lane only records what it would expire).');
````

<!-- replay: replace server/test/expiry-lane-prose.test.ts -->
In `server/test/expiry-lane-prose.test.ts`, find:

````ts
    expect(s).toContain('Coordinator clause 3\'s closing sentence (§5.3). Amended by this design’s wave 3b');
````

Replace with:

````ts
    expect(s).toContain('Coordinator clause 3\'s closing sentence (§5.3). Amended by this design’s wave 3b');
    // Review 313's residue, closed by wave 4: each of its departures reaches §5.3's list, so the spec says what shipped.
    expect(s).toContain("**Review 313's residue, closed by wave 4**");
    for (const said of ['backs off on the failure ladder and is listed', 'learn slots go in `nextAskAt` order',
      'listed at once and never asked again for that archive', 'clears every report the row holds',
      'is a row that moved', 'names its instant (`due <instant>`), never a period']) expect(s).toContain(said);
````


- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/expiry-lane-prose.test.ts --maxWorkers=1 )
```

Measured: `coordinator-skill.test.ts`: `1 failed | 160 passed (161)` — × carries all sixteen clauses verbatim; `expiry-lane-prose.test.ts`: `2 failed | 6 passed (8)` — × clause 3 says it too: the cleanup follows the archive once the operator has armed the lane — never for a child; × the lifecycle design §5.3 records the shadowed lane, and §6 item 1 as amended

- [ ] **Step 3: The texts.** The fragment block is the one edit of 4124's entry.

<!-- replay: replace ccd/coordinator-skill/SKILL.md -->
In `ccd/coordinator-skill/SKILL.md`, find:

````markdown
3. This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for any reason. A child this session dispatched is reclaimed by the server once this session is finished with it — at its run’s close when nothing still needs it, otherwise later by the server’s sweep (a child held for its program’s next wave once that program has no open run, a review child once the run it reviewed has closed, a child whose reclaim was deferred or never started); this session’s own workspace is cleaned up by a human, or by the server seven days after it is archived once the operator has armed the server’s expiry lane (until then the lane only records what it would expire).
````

Replace with:

````markdown
3. This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for any reason. A child this session dispatched is reclaimed by the server once this session is finished with it — at its run’s close when nothing still needs it, otherwise later by the server’s sweep (a child held for its program’s next wave once that program has no open run, a review child once the run it reviewed has closed, a child whose reclaim was deferred or never started); this session’s own workspace is cleaned up by a human, or — when it carries no child marker — by the server seven days after it is archived once the operator has armed the server’s expiry lane (until then the lane only records what it would expire).
````

<!-- replay: replace docs/superpowers/plans/2026-10-06-workspace-lifecycle-wave3b-expiry-lane.md -->
In `docs/superpowers/plans/2026-10-06-workspace-lifecycle-wave3b-expiry-lane.md`, find:

````markdown
| T3.5 | THE FIRST DRAFT'S FORM, whole: python prints `pid<TAB>comm<TAB>path` (`sys.stdout.buffer.write(os.fsencode("%s\t%s\t%s\n" % (pid, c, p)))`, its `#` line → `pass`), and the shell's read loop → `local n=0 pid comm pth` / `while IFS=$'\t' read -r pid comm pth; do` … `EXPIRE_IN_USE+=("{\"pid\":$pid,\"comm\":$(_json_str "$comm"),\"cwd\":$(_json_str "$pth")}")` | `server/test/ccd-ws-expire-audit.test.ts`: `3 failed \| 17 passed (20)` — … ONE record — valid JSON, the exact bytes; … keeps its bytes (surrogateescape) …; a command the box could not read is "" — the record keeps its cwd, and the sentence names the path (the IFS merge: the path read as the command, the cwd empty) |
````

Replace with:

````markdown
| T3.5 | THE FIRST DRAFT'S FORM, whole: python prints `pid<TAB>comm<TAB>path` (`sys.stdout.buffer.write(os.fsencode("%s\t%s\t%s\n" % (pid, c, p)))`, its `#` line → `pass`), and the shell's read loop → `local n=0 pid comm pth` / `while IFS=$'\t' read -r pid comm pth; do` … `EXPIRE_IN_USE+=("{\"pid\":$pid,\"comm\":$(_json_str "$comm"),\"cwd\":$(_json_str "$pth")}")` | `server/test/ccd-ws-expire-audit.test.ts`: `4 failed \| 16 passed (20)` (measured by the worker and again by review 313, O2: the `sleep` case reds too; the first draft said 3) — … ONE record — valid JSON, the exact bytes; … keeps its bytes (surrogateescape) …; a command the box could not read is "" — the record keeps its cwd, and the sentence names the path (the IFS merge: the path read as the command, the cwd empty) |
````

<!-- replay: replace docs/superpowers/plans/2026-10-06-workspace-lifecycle-wave3b-expiry-lane.md -->
In `docs/superpowers/plans/2026-10-06-workspace-lifecycle-wave3b-expiry-lane.md`, find:

````markdown
| T7.2 | The lane deaf to the switch. `watch.ts`: `if (names.includes(RECLAIM_PAUSE_MARKER) \|\| !capSupported(this.deps.fleetState, EXPIRE_CAP)) {` → `if (!capSupported(this.deps.fleetState, EXPIRE_CAP)) {` | `2 failed \| 21 passed (23)` — no audit, no record, no verb, live or shadow; a sighting from BEFORE the pause is forgotten … |
````

Replace with:

````markdown
| T7.2 | The lane deaf to the switch. `watch.ts`: `if (names.includes(RECLAIM_PAUSE_MARKER) \|\| !capSupported(this.deps.fleetState, EXPIRE_CAP)) {` → `if (!capSupported(this.deps.fleetState, EXPIRE_CAP)) {` | `1 failed \| 22 passed (23)` — no audit, no record, no verb, live or shadow. Measured at the merged tip `3990aaad` (review 313, F7); the first draft's `2 failed` also counted "a sighting from BEFORE the pause is forgotten …", which the final review's executor-side reset (`archivedExpiryNextEntry`'s `deferred` arm) now forgets too, so that case no longer reds under this row — T7.13 still pins the lane's own `forgetSightings()` |
````

<!-- replay: replace docs/superpowers/plans/2026-10-06-workspace-lifecycle-wave3b-expiry-lane.md -->
In `docs/superpowers/plans/2026-10-06-workspace-lifecycle-wave3b-expiry-lane.md`, find:

````markdown
- **D-4117** `expiry-lane-ships-shadowed` (Tasks 6, 7) — the coordinator's safety ruling (E), which §5.3 did not have: until `$REG/expire-lane-live` exists (the operator's, by hand; no writer in the tree) the lane audits and records "would expire" and never composes `ws-expire`; the executor reads the file at the act, after its audit, nearest the argv; `reclaim-paused` stops the lane entirely, shadow included.
````

Replace with:

````markdown
- **D-4117** `expiry-lane-ships-shadowed` (Tasks 6, 7) — the coordinator's safety ruling (E), which §5.3 did not have: until `$REG/expire-lane-live` exists (the operator's, by hand; no writer in the tree) the lane audits and records "would expire" and never composes `ws-expire`; the executor reads the file at the act, after its audit, nearest the argv; `reclaim-paused` stops the lane entirely, shadow included.
  Final review (Task 12, at `3990aaad`; recorded by wave 4 after review 313, F5): the executor's `deferred` with `paused-at-server` or `unsupported` clears `eligibleSince` too, so a pause or a missing verb only the executor saw forgets the sighting and a lowered switch needs two FRESH passes, whoever saw it (`archivedExpiryNextEntry`'s `deferred` arm).
````

<!-- replay: fragment docs/superpowers/plans/2026-10-06-workspace-lifecycle-wave3b-expiry-lane.md -->
In `docs/superpowers/plans/2026-10-06-workspace-lifecycle-wave3b-expiry-lane.md`, find this FRAGMENT of one line (it occurs exactly once; the line is a ledger entry, and its whole spelling is never quoted here — see the step):

````
stops it with `/stop`'s argv under the turn it already measured and answers `stopped: true`. A pane gone, or one tmux cannot be asked about,
````

Replace it with:

````
re-reads the turn at the act (`stopVerdictFor`) and, only when that turn is idle, stops it with `/stop`'s argv and answers `stopped: true`. A busy or unreadable turn, a pane gone, or one tmux cannot be asked about
````

<!-- replay: replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find:

````markdown
**The lane.** CCR-15 wave 4's `sweepChildReclaim` pass hosts a second population. It shares the pass's registry
read, its cadence (`CHILD_RECLAIM_SWEEP_MS`) and the switch, and nothing else. It has:
````

Replace with:

````markdown
**The lane.** A sibling of CCR-15 wave 4's `sweepChildReclaim` pass, on the same tick, never a population inside it
(wave 3b's sibling pass). It shares the pass's registry read, its cadence (`CHILD_RECLAIM_SWEEP_MS`) and the switch,
and nothing else. It has:
````

<!-- replay: replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find:

````markdown
  also a `tmux: server`). The lane never kills.
````

Replace with:

````markdown
  also a `tmux: server`). The lane never kills.
- **Review 313's residue, closed by wave 4** (each a departure named in the wave-4 plan,
  `docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md`). A learn audit that cannot be
  read, or reads no archive, backs off on the failure ladder and is listed, and learn slots go in `nextAskAt` order; a
  failure ccd says will not resume is listed at once and never asked again for that archive; an ineligible sighting
  clears every report the row holds; a refusal whose audit names another archive is a row that moved; and the held
  sentence names its instant (`due <instant>`), never a period.
````

<!-- replay: replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find:

````markdown
  6. Wave 4's lane gains a second population (§5.3).
````

Replace with:

````markdown
  6. Wave 4's lane gains a second population (§5.3). Amended by this design’s wave 3b, recorded by wave 4: the expiry
     lane is a SIBLING pass on the same tick, never a population inside `sweepChildReclaim`, so CCR-15's sweep and its
     text are unchanged.
````


- [ ] **Step 4: Run — green**, with the prose pins that read these files and the ledger guard:

```bash
( cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/expiry-lane-prose.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ws-expire-prose.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/child-reclaim-prose.test.ts --maxWorkers=1 )
git fetch origin main
( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts --maxWorkers=1 )
```

Measured: `coordinator-skill.test.ts`: `161 passed (161)`; `expiry-lane-prose.test.ts`: `8 passed (8)`; `ws-expire-prose.test.ts`: `7 passed (7)`; `child-reclaim-prose.test.ts`: `4 passed (4)`; `deviation-refs.test.ts`: `31 passed (31)`

- [ ] **Step 5: Mutation check, then commit.** The 3b plan's rows and entries are records; clause 3 and the §5.3 residue item are the pinned texts.

| # | Edit (restore after) | Measured red |
|---|---|---|
| T4.1 | `ccd/coordinator-skill/SKILL.md`: `this session’s own workspace is cleaned up by a human, or — when it carries no child marker — by the server seven days after it is archived` → `this session’s own workspace is cleaned up by a human, or by the server seven days after it is archived` | `coordinator-skill.test.ts`: `1 failed \| 160 passed (161)` — carries all sixteen clauses verbatim<br>`expiry-lane-prose.test.ts`: `1 failed \| 7 passed (8)` — clause 3 says it too: the cleanup follows the archive once the operator has armed the lane — never for a child |
| T4.2 | `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`: `- **Review 313's residue, closed by wave 4** (each a departure named in the wave-4 plan,` → `- **Wave 4's residue** (each a departure named in the wave-4 plan,` | `expiry-lane-prose.test.ts`: `1 failed \| 7 passed (8)` — the lifecycle design §5.3 records the shadowed lane, and §6 item 1 as amended |

```bash
git add ccd/coordinator-skill/SKILL.md docs/superpowers/plans/2026-10-06-workspace-lifecycle-wave3b-expiry-lane.md \
  docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md server/test/coordinator-skill.test.ts server/test/expiry-lane-prose.test.ts
git commit -m "$(cat <<'MSG'
docs(expiry): review 313's records, and clause 3's child marker

F5: the final review's eligibleSince reset is recorded under 3b's shadowed-lane
entry. O1: 3b's already-archived-pane entry reads true alone. F7/O2: rows T7.2
and T3.5 carry the measured counts. F6: the spec says the expiry lane is a
sibling pass, and §5.3 records the residue this wave closes. Parked item 3:
coordinator clause 3 says a child-marked workspace is never the expiry's,
with its verbatim pin.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5 (DROPPABLE): The archive confirms say what is true before and after arming (review 313, parked item 2)

> **Task 5 STAYS in the plan** (the coordinator's ruling, 2026-10-07), self-contained and droppable: the operator may still strike it before merge, keeping the current promise ("Restore brings it back for 7 days; after that it is cleaned up"). No later task reads its files; if it is struck, its departure slug (`archive-confirm-hedged-until-armed`) is not written.

**Model routing:** `sonnet`, effort `medium`.

**Files:** `pwa/src/fleet/ArchiveSheet.tsx`, `pwa/src/screens/FleetScreen.tsx` (the Archive-all confirm), the lifecycle spec (§5.3's "The words carry the arming condition" item); tests `pwa/test/archive-sheet.test.tsx`, `pwa/test/fleet-screen.test.tsx`.

**Interfaces:** none. The single confirm reads "It goes offline and folds into Archived. Restore brings it back; once automatic cleanup is on, it is cleaned up seven days after its archive."; Archive all "…Restore brings any of them back; once automatic cleanup is on, each is cleaned up seven days after its archive." — true while shadowed, under `reclaim-paused` and on an older box, and true once armed; the period stays the operator's copy (Pre-flight finding 11).

- [ ] **Step 1: The tests (red).**

<!-- replay: replace pwa/test/archive-sheet.test.tsx -->
In `pwa/test/archive-sheet.test.tsx`, find:

````tsx
    expect(screen.getByText('It goes offline and folds into Archived. Restore brings it back for 7 days; after that it is cleaned up.')).toBeInTheDocument();
````

Replace with:

````tsx
    // True before and after the operator arms the expiry lane, under the cleanup pause, and on an older box (review 313,
    // parked item 2): the promise is conditional, as README and the skill already say it.
    expect(screen.getByText('It goes offline and folds into Archived. Restore brings it back; once automatic cleanup is on, '
      + 'it is cleaned up seven days after its archive.')).toBeInTheDocument();
````

<!-- replay: replace pwa/test/fleet-screen.test.tsx -->
In `pwa/test/fleet-screen.test.tsx`, find:

````tsx
    expect(screen.getByText(/Restore brings any of them back for 7 days; after that they are cleaned up\./)).toBeInTheDocument();
````

Replace with:

````tsx
    expect(screen.getByText(/Restore brings any of them back; once automatic cleanup is on, each is cleaned up seven days after its archive\./)).toBeInTheDocument();
````


- [ ] **Step 2: Run — red.**

```bash
( cd pwa && ./node_modules/.bin/vitest run test/archive-sheet.test.tsx --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/vitest run test/fleet-screen.test.tsx --maxWorkers=1 )
```

Measured: `archive-sheet.test.tsx`: `1 failed | 24 passed (25)` — × an idle workspace: its words, and Archive sends the plain call; `fleet-screen.test.tsx`: `1 failed | 100 passed (101)` — × opens on its own key, confirms once, archives each non-child row with its id alone, and reports in one toast

- [ ] **Step 3: The copy, and the spec's record of it.**

<!-- replay: replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find:

````markdown
  The PWA's archive-confirm copy says what an armed fleet does; whether to hedge it until then is the operator's.
````

Replace with:

````markdown
  The PWA's archive-confirm copy said what an armed fleet does until wave 4 hedged it the same way (review 313,
  parked item 2, the operator's ruling): "Restore brings it back; once automatic cleanup is on, it is cleaned up
  seven days after its archive", and Archive all's "…each is cleaned up seven days after its archive".
````

<!-- replay: replace pwa/src/fleet/ArchiveSheet.tsx -->
In `pwa/src/fleet/ArchiveSheet.tsx`, find:

````tsx
        ? 'It goes offline and folds into Archived. Restore brings it back for 7 days; after that it is cleaned up.'
````

Replace with:

````tsx
        ? 'It goes offline and folds into Archived. Restore brings it back; once automatic cleanup is on, it is cleaned up seven days after its archive.'
````

<!-- replay: replace pwa/src/screens/FleetScreen.tsx -->
In `pwa/src/screens/FleetScreen.tsx`, find:

````tsx
        consequence={`Archives ${archiveAllCount} released ${archiveAllCount === 1 ? 'workspace' : 'workspaces'} in ${archiveAllFor ?? ''}, one at a time. ${archiveAllLive} of them ${archiveAllLive === 1 ? 'still has a live pane' : 'still have a live pane'}, which is stopped. Restore brings any of them back for 7 days; after that they are cleaned up. Child workspaces are skipped, and so is any row that stops being released before its turn.`}
````

Replace with:

````tsx
        consequence={`Archives ${archiveAllCount} released ${archiveAllCount === 1 ? 'workspace' : 'workspaces'} in ${archiveAllFor ?? ''}, one at a time. ${archiveAllLive} of them ${archiveAllLive === 1 ? 'still has a live pane' : 'still have a live pane'}, which is stopped. Restore brings any of them back; once automatic cleanup is on, each is cleaned up seven days after its archive. Child workspaces are skipped, and so is any row that stops being released before its turn.`}
````


- [ ] **Step 4: Run — green**, and `( cd server && ./node_modules/.bin/vitest run test/expiry-lane-prose.test.ts --maxWorkers=1 )`.

Measured: `archive-sheet.test.tsx`: `25 passed (25)`; `fleet-screen.test.tsx`: `101 passed (101)`; `expiry-lane-prose.test.ts`: `8 passed (8)`

- [ ] **Step 5: Mutation check, then commit.**

| # | Edit (restore after) | Measured red |
|---|---|---|
| T5.1 | `pwa/src/fleet/ArchiveSheet.tsx`: `Restore brings it back; once automatic cleanup is on, it is cleaned up seven days after its archive.` → `Restore brings it back for 7 days; after that it is cleaned up.` | `archive-sheet.test.tsx`: `1 failed \| 24 passed (25)` — an idle workspace: its words, and Archive sends the plain call |
| T5.2 | `pwa/src/screens/FleetScreen.tsx`: `Restore brings any of them back; once automatic cleanup is on, each is cleaned up seven days after its archive.` → `Restore brings any of them back for 7 days; after that they are cleaned up.` | `fleet-screen.test.tsx`: `1 failed \| 100 passed (101)` — opens on its own key, confirms once, archives each non-child row with its id alone, and reports in one toast |

```bash
git add pwa/src/fleet/ArchiveSheet.tsx pwa/src/screens/FleetScreen.tsx pwa/test/archive-sheet.test.tsx pwa/test/fleet-screen.test.tsx \
  docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md
git commit -m "$(cat <<'MSG'
fix(pwa): the archive confirms say what is true before and after arming

Review 313, parked item 2, as the operator ruled: "after that it is cleaned
up" was false while the expiry lane is shadowed, paused or on an older box.
Both confirms now say the workspace is cleaned up seven days after its archive
once automatic cleanup is on.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: The dead-coordinator lane's decisions — one L1 file, and its wire type

**Model routing:** `opus`, effort `high` — the decisions an act that ends programmes rests on.

**Files:** create `server/src/deadCoordinator.ts`; modify `shared/api.ts` (`DeadCoordinatorAttention`, `CoordStatus.deadCoordinatorAttention`), `README.md` (four anchors, BY CONTENT); create `server/test/dead-coordinator-policy.test.ts`; modify `server/test/mail-routes.test.ts` (the fifteenth union, appended after #320's stall-watch settings union, the fourteenth).

**Interfaces (Produces):**
- `DEAD_COORDINATOR_LANE_LIVE_MARKER = 'dead-coordinator-lane-live'` — its one spelling in `server/src`.
- `DEAD_COORDINATOR_AFTER_MS` (1 h), `DEAD_COORDINATOR_BREAKER_WINDOW_MS` (10 min), `DEAD_COORDINATOR_GAP_MS` (10 min), `DEAD_COORDINATOR_BACKOFF_CEILING_MS` (1 h).
- `type ClaimantDeadCause = 'absent' | Extract<SessionLifecycle, 'stopped' | 'orphan' | 'never-started'>`, `CLAIMANT_DEAD_CAUSES` (Task 7's `ClaimantVerdict` takes it), and `ClaimantReading` (that verdict, structurally).
- `DEAD_COORDINATOR_DELIBERATE_ACTS`, `DEAD_COORDINATOR_JOURNAL_ACTS` (Task 8's SQL reads it), `DeadCoordinatorJournalRow` (`act`, `outcome`, `at`, `gen`, `dec`, `meas`, `raw`), `DeadCoordinatorJournalTrust` (`untrusted`, `gapGens`, `lastWriteErrorAt`), `DEAD_COORDINATOR_JOURNAL_TRUSTED`, `DEAD_COORDINATOR_JOURNAL_MARGIN_MS`, `deadCoordinatorJournal(rows, hasHistory, trust)` → `quiet (started) | deliberate | no-history | unreadable` — THE ONE READER, which also asks whether the journal may have lost an act since the last successful spawn (Pre-flight finding 14; it imports L0's `compareGenerations` to place a gap).
- `deadCoordinatorCrash(reading, journal)` → `crashed (cause) | alive | unmeasurable | stopped | deliberate | unmeasured` (a `never-started` row is a crash only after a successful spawn).
- `DeadAnchor`, `deadAnchorNext(prev, now)`, `deadCoordinatorSince(anchor, supervisedAtS, now)`, `deadCoordinatorDue(since, crashedPasses, now)`.
- `deadCoordinatorBreaker(crashed, held, unmeasurable, measured, fleetDoubt, now)` → `{ tripped: false } | { tripped: true, why, claimants, since, members, detail? }` — `held` and `members` are its memory; `deadCoordinatorBreakerKey`, `deadCoordinatorBreakerFeedRow`.
- `DeadCoordinatorStop` (`remeasured | switch | successor`, typed so the lane never re-splits prose), `DeadCoordinatorActOutcome` (`ended` with `programmes`, `open`, `stuck`, `stoppedBy` | `would-end | paused-at-server | store-unreadable`), `DeadCoordinatorEntry`, `deadCoordinatorEntry()`, `deadCoordinatorSighted` (a crashed pass ends an `unmeasured` report), `deadCoordinatorNextEntry` (a stopped act forgets its passes), `deadCoordinatorThrew` (a thrown act backs off), `deadCoordinatorBackoffMs`, `deadCoordinatorOutcomeKey`.
- `deadCoordinatorFeedRows(id, outcome, since)` (ONE per programme, the spec's words, `dead since <instant>`; a partly ended programme says so), `deadCoordinatorReportSentence`, `deadCoordinatorBreakerSentence`, `deadCoordinatorAttention(entries, breaker)` (the breaker's item first).
- `CLAIMANT_CHANGED = 'claimant-changed'`, `SWEEP_STOPPED = 'sweep-stopped'` and `isDeadCoordinatorKebab` (derived from the Records) — `mail-routes.test.ts`'s fifteenth union.
- L0: `DeadCoordinatorAttention { kind: 'would-end' | 'unmeasured' | 'stuck' | 'breaker'; claimants; sentence; at }`; `CoordStatus.deadCoordinatorAttention?` (optional).

- [ ] **Step 1: The tests (red).** The new file cannot be imported yet, so the whole file — and `mail-routes.test.ts`, which imports the guard — is red at collection.

<!-- replay: create server/test/dead-coordinator-policy.test.ts -->
Create `server/test/dead-coordinator-policy.test.ts`:

````ts
// The dead-coordinator lane's DECISIONS, table-driven (workspace lifecycle spec 2026-09-24 §5.4, wave 4).
// `deadCoordinator.ts` is L1: every verdict, fold and word is a pure function, so every fail direction is a row here.
// What only the lane can prove — what reaches the store and the serialiser, when, and how often — is
// `dead-coordinator-lane.test.ts`'s; the executor's re-measure and compare-and-set are `end-dead-coordinator.test.ts`'s.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEAD_COORDINATOR_AFTER_MS, DEAD_COORDINATOR_BACKOFF_CEILING_MS, DEAD_COORDINATOR_BREAKER_WINDOW_MS,
  DEAD_COORDINATOR_DELIBERATE_ACTS, DEAD_COORDINATOR_GAP_MS, DEAD_COORDINATOR_JOURNAL_ACTS,
  DEAD_COORDINATOR_JOURNAL_MARGIN_MS, DEAD_COORDINATOR_JOURNAL_TRUSTED, deadAnchorNext, deadCoordinatorAttention,
  deadCoordinatorBackoffMs, deadCoordinatorBreaker, deadCoordinatorBreakerFeedRow, deadCoordinatorBreakerKey,
  deadCoordinatorCrash, deadCoordinatorDue, deadCoordinatorEntry, deadCoordinatorFeedRows, deadCoordinatorJournal,
  deadCoordinatorNextEntry, deadCoordinatorReportSentence, deadCoordinatorSighted, deadCoordinatorSince,
  deadCoordinatorThrew, isDeadCoordinatorKebab,
  type ClaimantReading, type DeadCoordinatorJournal, type DeadCoordinatorJournalRow, type DeadCoordinatorJournalTrust,
} from '../src/deadCoordinator.js';
import { LIFECYCLE_ACTS } from '../../shared/api.js';

const NOW = 1_790_000_000_000;
const PASS = 60_000;
const GEN = '1790000000000000000';
const OLDER_GEN = '1780000000000000000';
const NEWER_GEN = '1795000000000000000';
const T = DEAD_COORDINATOR_JOURNAL_TRUSTED;
const row = (act: DeadCoordinatorJournalRow['act'], over: Partial<DeadCoordinatorJournalRow> = {}): DeadCoordinatorJournalRow =>
  ({ act, outcome: 'done', at: NOW, gen: GEN, dec: null, meas: null, raw: '{}', ...over });
/** A `spawn` line as ccd writes it: `_lc_json` puts every meas value on the wire as a STRING, so the mirror's typed
 *  `meas.rc` is null and the rc is read off the line's own bytes. */
const spawned = (rc: number): DeadCoordinatorJournalRow =>
  row('spawn', { raw: JSON.stringify({ v: 1, act: 'spawn', outcome: 'done', meas: { rc: String(rc), wrapper: 'claude' } }) });

describe('the journal clause — one reader, four answers', () => {
  it('no row of any act is NO HISTORY; rows with nothing deliberate since the last successful start are QUIET', () => {
    expect(deadCoordinatorJournal([], false, T)).toEqual({ kind: 'no-history' });
    expect(deadCoordinatorJournal([], true, T), 'history, none of it the clause’s acts').toEqual({ kind: 'quiet', started: false });
    expect(deadCoordinatorJournal([row('create'), row('start'), spawned(0), row('hold'), row('swap')], true, T))
      .toEqual({ kind: 'quiet', started: true });
  });

  it('a deliberate act since the last successful start is DELIBERATE — each of the eight, and a declared unsupervise', () => {
    for (const act of DEAD_COORDINATOR_DELIBERATE_ACTS) {
      expect(deadCoordinatorJournal([spawned(0), row(act, { at: NOW + 1 })], true, T), act).toEqual({ kind: 'deliberate', act, at: NOW + 1 });
    }
    expect(deadCoordinatorJournal([spawned(0), row('unsupervise', { dec: { surface: 'pwa' } })], true, T).kind).toBe('deliberate');
    expect(deadCoordinatorJournal([spawned(0), row('unsupervise', { dec: { surface: 'none' } })], true, T),
      'ccd acting on its own account declares nothing').toEqual({ kind: 'quiet', started: true });
  });

  it('a stop BEFORE the last successful start is history — the session came back since', () => {
    expect(deadCoordinatorJournal([row('stop'), row('start'), spawned(0)], true, T)).toEqual({ kind: 'quiet', started: true });
  });

  it('the start is read off the spawn line’s OWN bytes, as ccd wrote them; a line whose rc cannot be read proves no start', () => {
    // MEASURED: ccd's encoder writes `meas.rc` as the string "0", and the mirror's `n()` keeps only a JSON number, so
    // the typed field is null on every real line (`journalparse.test.ts` pins that degrade). A typed 0 counts too.
    expect(deadCoordinatorJournal([row('stop'), row('spawn', { meas: { rc: 0 } })], true, T)).toEqual({ kind: 'quiet', started: true });
    for (const raw of ['not json', JSON.stringify({ meas: { rc: '00' } }), JSON.stringify({ meas: null }), JSON.stringify({ meas: { rc: '1' } })]) {
      expect(deadCoordinatorJournal([row('stop'), row('spawn', { raw })], true, T).kind, raw).toBe('deliberate');
    }
  });

  it('THE CASE THE CLAUSE EXISTS FOR: stopped, then a revive that FAILED — `start` and `ensure` journal at the top, so only a spawn with rc 0 is a start', () => {
    expect(deadCoordinatorJournal([spawned(0), row('stop'), row('ensure'), row('start'), spawned(1)], true, T))
      .toEqual({ kind: 'deliberate', act: 'stop', at: NOW });
  });

  it('a REFUSED act did nothing; an act this build cannot name, and an unsupervise whose surface cannot be read, are doubt — never a crash', () => {
    expect(deadCoordinatorJournal([spawned(0), row('stop', { outcome: 'refused' })], true, T)).toEqual({ kind: 'quiet', started: true });
    expect(deadCoordinatorJournal([spawned(0), row('unknown')], true, T).kind).toBe('deliberate');
    expect(deadCoordinatorJournal([spawned(0), row('unsupervise')], true, T).kind).toBe('deliberate');
  });

  it('a journal the lane cannot TRUST is unreadable, never quiet: a mirror not ok, a gap that may hold the act, a write ccd could not make', () => {
    const trust = (o: Partial<DeadCoordinatorJournalTrust>): DeadCoordinatorJournalTrust => ({ ...T, ...o });
    const after = [spawned(0), row('hold')];
    expect(deadCoordinatorJournal(after, true, trust({ untrusted: 'the lifecycle mirror is unavailable' })))
      .toEqual({ kind: 'unreadable', detail: 'the lifecycle mirror is unavailable' });
    expect(deadCoordinatorJournal([], false, trust({ untrusted: 'the lifecycle mirror is stale' })).kind, 'not even no-history').toBe('unreadable');
    // A gap in a generation OLDER than the last start lost only lines from before it.
    expect(deadCoordinatorJournal(after, true, trust({ gapGens: [OLDER_GEN] }))).toEqual({ kind: 'quiet', started: true });
    for (const g of [GEN, NEWER_GEN, 'lifecycle.unplaceable.jsonl']) {
      expect(deadCoordinatorJournal(after, true, trust({ gapGens: [g] })).kind, g).toBe('unreadable');
    }
    expect(deadCoordinatorJournal([row('hold')], true, trust({ gapGens: [OLDER_GEN] })).kind, 'no start bounds the loss').toBe('unreadable');
    expect(deadCoordinatorJournal([], false, trust({ gapGens: [OLDER_GEN] })).kind, 'nor an empty history').toBe('unreadable');
    // ccd's last counted write failure, placed against the start on ccd's own clock.
    expect(deadCoordinatorJournal(after, true, trust({ lastWriteErrorAt: NOW - DEAD_COORDINATOR_JOURNAL_MARGIN_MS - 1 })))
      .toEqual({ kind: 'quiet', started: true });
    expect(deadCoordinatorJournal(after, true, trust({ lastWriteErrorAt: NOW + 5_000 })).kind).toBe('unreadable');
    expect(deadCoordinatorJournal(after, true, trust({ lastWriteErrorAt: 'unknown' })).kind).toBe('unreadable');
    expect(deadCoordinatorJournal([row('hold')], true, trust({ lastWriteErrorAt: NOW - 86_400_000 })).kind).toBe('unreadable');
  });

  it('every act the clause reads is one of L0’s — ccd’s own and the we-do-not-know `unknown`', () => {
    for (const act of DEAD_COORDINATOR_JOURNAL_ACTS) expect(LIFECYCLE_ACTS, act).toContain(act);
    expect(DEAD_COORDINATOR_JOURNAL_ACTS).toEqual(expect.arrayContaining([...DEAD_COORDINATOR_DELIBERATE_ACTS, 'unsupervise', 'spawn', 'unknown']));
  });
});

describe('a crash, and only a crash (spec §5.4)', () => {
  const dead = (cause: 'absent' | 'stopped' | 'orphan' | 'never-started'): ClaimantReading => ({ state: 'dead', cause });
  const quiet: DeadCoordinatorJournal = { kind: 'quiet', started: true };
  const unstarted: DeadCoordinatorJournal = { kind: 'quiet', started: false };
  const none: DeadCoordinatorJournal = { kind: 'no-history' };
  it('the table', () => {
    const cases: [string, ClaimantReading, DeadCoordinatorJournal, string][] = [
      ['a live pane', { state: 'alive', why: 'tmux reports the pane live' }, quiet, 'alive'],
      ['restarting is alive', { state: 'alive', why: 'the pane is gone but the lifecycle reads restarting' }, quiet, 'alive'],
      ['unmeasurable is never dead', { state: 'unmeasurable', why: 'tmux did not answer' }, quiet, 'unmeasurable'],
      ['stopped is never a crash', dead('stopped'), quiet, 'stopped'],
      ['orphan, quiet', dead('orphan'), quiet, 'crashed'],
      ['never-started after a successful spawn', dead('never-started'), quiet, 'crashed'],
      ['never-started with no successful spawn never ran: unmeasured', dead('never-started'), unstarted, 'unmeasured'],
      ['never-started with no history at all', dead('never-started'), none, 'unmeasured'],
      ['orphan with history but no spawn line', dead('orphan'), unstarted, 'crashed'],
      ['absent, quiet: removed with no deliberate act', dead('absent'), quiet, 'crashed'],
      ['orphan with no history', dead('orphan'), none, 'crashed'],
      ['absent with NO history: unmeasured, listed, never acted on', dead('absent'), none, 'unmeasured'],
      ['an unreadable journal is unmeasured, never no-history', dead('orphan'), { kind: 'unreadable', detail: 'x' }, 'unmeasured'],
      ['a deliberate act since the last start', dead('orphan'), { kind: 'deliberate', act: 'stop', at: NOW }, 'deliberate'],
      ['an expired row', dead('absent'), { kind: 'deliberate', act: 'expire', at: NOW }, 'deliberate'],
    ];
    for (const [name, m, j, kind] of cases) expect(deadCoordinatorCrash(m, j).kind, name).toBe(kind);
    expect(deadCoordinatorCrash(dead('never-started'), quiet)).toEqual({ kind: 'crashed', cause: 'never-started' });
  });
});

describe('the hour, made durable', () => {
  it('the first crashed pass writes firstDeadAt; later ones move lastDeadAt alone', () => {
    const a = deadAnchorNext(null, NOW);
    expect(a).toEqual({ firstDeadAt: NOW, lastDeadAt: NOW });
    expect(deadAnchorNext(a, NOW + PASS)).toEqual({ firstDeadAt: NOW, lastDeadAt: NOW + PASS });
  });

  it('a gap nothing measured — a server down, an older build running after a rollback — restarts the episode; so does a stamp from the future', () => {
    const a = { firstDeadAt: NOW, lastDeadAt: NOW };
    expect(deadAnchorNext(a, NOW + DEAD_COORDINATOR_GAP_MS)).toEqual({ firstDeadAt: NOW, lastDeadAt: NOW + DEAD_COORDINATOR_GAP_MS });
    expect(deadAnchorNext(a, NOW + DEAD_COORDINATOR_GAP_MS + 1)).toEqual({ firstDeadAt: NOW + DEAD_COORDINATOR_GAP_MS + 1,
      lastDeadAt: NOW + DEAD_COORDINATOR_GAP_MS + 1 });
    expect(deadAnchorNext({ firstDeadAt: NOW, lastDeadAt: NOW + 5 }, NOW)).toEqual({ firstDeadAt: NOW, lastDeadAt: NOW });
  });

  it('the supervisor stamp may RAISE the anchor and never lower it; absent, unparseable and future stamps are ignored', () => {
    const a = { firstDeadAt: NOW, lastDeadAt: NOW };
    const later = NOW + 5 * PASS;
    expect(deadCoordinatorSince(a, (NOW + 60_000) / 1000, later)).toBe(NOW + 60_000);
    expect(deadCoordinatorSince(a, (NOW - 86_400_000) / 1000, later), 'a days-old frozen stamp').toBe(NOW);
    for (const s of [null, 0, -5, 1.5, Number.NaN, (later + 1000) / 1000]) expect(deadCoordinatorSince(a, s, later), String(s)).toBe(NOW);
  });

  it('due: an hour since the anchor AND two crashed passes in a row', () => {
    expect(deadCoordinatorDue(NOW, 2, NOW + DEAD_COORDINATOR_AFTER_MS)).toBe(true);
    expect(deadCoordinatorDue(NOW, 2, NOW + DEAD_COORDINATOR_AFTER_MS - 1)).toBe(false);
    expect(deadCoordinatorDue(NOW, 1, NOW + 10 * DEAD_COORDINATOR_AFTER_MS), 'one pass is never enough').toBe(false);
  });
});

describe('the circuit breaker (spec §5.4)', () => {
  const at = (id: string, firstDeadAt: number) => ({ id, firstDeadAt });
  it('two claimants first measured crashed within ten minutes of each other trip it, naming both', () => {
    expect(deadCoordinatorBreaker([at('c-a', NOW), at('c-b', NOW + DEAD_COORDINATOR_BREAKER_WINDOW_MS)], [], [], 2, null, NOW))
      .toEqual({ tripped: true, why: 'clustered', claimants: ['c-a', 'c-b'], since: NOW,
        members: [at('c-a', NOW), at('c-b', NOW + DEAD_COORDINATOR_BREAKER_WINDOW_MS)] });
    expect(deadCoordinatorBreaker([at('c-a', NOW), at('c-b', NOW + DEAD_COORDINATOR_BREAKER_WINDOW_MS + 1)], [], [], 2, null, NOW))
      .toEqual({ tripped: false });
  });

  it('only the clustered are named; one crash alone never trips it', () => {
    const b = deadCoordinatorBreaker([at('c-a', NOW - 5 * 3_600_000), at('c-b', NOW), at('c-c', NOW + PASS)], [], [], 3, null, NOW);
    expect(b).toMatchObject({ tripped: true, why: 'clustered', claimants: ['c-b', 'c-c'], since: NOW });
    expect(deadCoordinatorBreaker([at('c-a', NOW)], [], [], 1, null, NOW)).toEqual({ tripped: false });
  });

  it('IT REMEMBERS: a held member keeps its first instant through a re-anchor, and holds while it only reads doubtful', () => {
    // A and B died together at NOW; A read unmeasurable once, lost its anchor, and was re-anchored half an hour later.
    const held = [at('c-a', NOW), at('c-b', NOW + PASS)];
    expect(deadCoordinatorBreaker([at('c-a', NOW + 31 * PASS), at('c-b', NOW + PASS)], held, [], 2, null, NOW + 62 * PASS))
      .toMatchObject({ tripped: true, why: 'clustered', claimants: ['c-a', 'c-b'], since: NOW });
    // On the due pass B is the one that reads unmeasurable: still held, by memory alone.
    expect(deadCoordinatorBreaker([at('c-a', NOW)], held, ['c-b'], 2, null, NOW + 62 * PASS))
      .toMatchObject({ tripped: true, why: 'clustered', claimants: ['c-a', 'c-b'] });
    // Without the memory both would have fallen apart — the defect this guards.
    expect(deadCoordinatorBreaker([at('c-a', NOW + 31 * PASS), at('c-b', NOW + PASS)], [], [], 2, null, NOW + 62 * PASS))
      .toEqual({ tripped: false });
  });

  it('a FLEET-WIDE doubt (tmux did not answer) trips it whatever the count, naming every claimant it could not clear', () => {
    // One claimant reads crashed (its row is gone: the ladder answers before tmux), the other could not be measured.
    expect(deadCoordinatorBreaker([at('c-a', NOW)], [], ['c-b'], 2, 'tmux did not answer for c-b: no server', NOW))
      .toEqual({ tripped: true, why: 'unmeasurable', claimants: ['c-a', 'c-b'], since: NOW, members: [],
        detail: 'tmux did not answer for c-b: no server' });
    expect(deadCoordinatorBreaker([], [], ['c-a'], 1, 'tmux did not answer for c-a: x', NOW), 'one claimant too')
      .toMatchObject({ tripped: true, why: 'unmeasurable', claimants: ['c-a'] });
  });

  it('a pass that could measure none of two or more claimants trips it; one unmeasurable of several, with tmux answering, does not', () => {
    expect(deadCoordinatorBreaker([], [], ['c-b', 'c-a'], 2, null, NOW))
      .toMatchObject({ tripped: true, why: 'unmeasurable', claimants: ['c-a', 'c-b'], since: NOW });
    expect(deadCoordinatorBreaker([], [], ['c-a'], 2, null, NOW)).toEqual({ tripped: false });
    expect(deadCoordinatorBreaker([], [], ['c-a'], 1, null, NOW)).toEqual({ tripped: false });
  });

  it('its key changes only when the trip, or the set it holds, does — the feed row is written once per trip', () => {
    const b = deadCoordinatorBreaker([at('c-a', NOW), at('c-b', NOW)], [], [], 2, null, NOW);
    expect(deadCoordinatorBreakerKey(b)).toBe('clustered:c-a,c-b');
    expect(deadCoordinatorBreakerKey({ tripped: false })).toBeNull();
    if (!b.tripped) throw new Error('not tripped');
    expect(deadCoordinatorBreakerFeedRow(b)).toEqual({ title: 'dead coordinator: breaker tripped',
      body: expect.stringContaining('(holding since 2026-09-21 14:13 UTC)') });
  });
});

describe('the lane’s memory of one claimant', () => {
  it('a crashed pass extends the run; any other reading ends it, and its would-end report with it', () => {
    let e = deadCoordinatorSighted(deadCoordinatorEntry(), { kind: 'crashed', cause: 'orphan' }, NOW);
    e = deadCoordinatorSighted(e, { kind: 'crashed', cause: 'orphan' }, NOW + PASS);
    expect(e.crashedPasses).toBe(2);
    const shadow = deadCoordinatorNextEntry(e, { kind: 'would-end', programmes: [{ slug: 'p', runIds: [1] }] }, 'orphan', NOW, NOW, PASS);
    expect(shadow.report).toMatchObject({ kind: 'would-end', at: NOW });
    const back = deadCoordinatorSighted(shadow, { kind: 'alive', why: 'tmux reports the pane live' }, NOW + 2 * PASS);
    expect(back).toMatchObject({ crashedPasses: 0, report: null });
  });

  it('unmeasured IS a report, kept with its first instant until a pass can tell; stuck stands until its runs move', () => {
    const u = deadCoordinatorSighted(deadCoordinatorEntry(), { kind: 'unmeasured', why: 'w' }, NOW);
    expect(deadCoordinatorSighted(u, { kind: 'unmeasured', why: 'w' }, NOW + PASS).report).toEqual({ kind: 'unmeasured', at: NOW, why: 'w' });
    expect(deadCoordinatorSighted(u, { kind: 'crashed', cause: 'orphan' }, NOW + PASS).report, 'a crashed pass could tell').toBeNull();
    const stuck = { ...deadCoordinatorEntry(), report: { kind: 'stuck', at: NOW, runs: [{ runId: 4, why: 'bad-transition' }] } } as const;
    expect(deadCoordinatorSighted(stuck, { kind: 'alive', why: 'x' }, NOW).report).toEqual(stuck.report);
  });

  it('an act that closed everything finishes the claimant; runs it could not move are reported and asked again only after a backoff', () => {
    const e = { ...deadCoordinatorEntry(), crashedPasses: 2 };
    expect(deadCoordinatorNextEntry(e, { kind: 'ended', programmes: [{ slug: 'p', runIds: [1, 2] }], open: [], stuck: [], stoppedBy: null },
      'orphan', NOW, NOW, PASS)).toMatchObject({ report: null, attempts: 0 });
    const s = deadCoordinatorNextEntry(e, { kind: 'ended', programmes: [], open: [{ slug: 'p', runIds: [3] }],
      stuck: [{ runId: 3, why: 'bad-transition' }], stoppedBy: null }, 'orphan', NOW, NOW, PASS);
    expect(s).toMatchObject({ attempts: 1, nextAskAt: NOW + 2 * PASS, report: { kind: 'stuck', at: NOW } });
    expect(deadCoordinatorBackoffMs(30, PASS)).toBe(DEAD_COORDINATOR_BACKOFF_CEILING_MS);
  });

  it('an act that STOPPED on a re-measure or a switch forgets its passes; a successor does not', () => {
    const e = { ...deadCoordinatorEntry(), crashedPasses: 61 };
    const ended = (stoppedBy: { kind: 'remeasured' | 'switch' | 'successor'; why: string }) =>
      deadCoordinatorNextEntry(e, { kind: 'ended', programmes: [], open: [{ slug: 'p', runIds: [1] }], stuck: [], stoppedBy },
        'orphan', NOW, NOW, PASS);
    expect(ended({ kind: 'remeasured', why: 're-measured alive' })).toMatchObject({ crashedPasses: 0, nextAskAt: 0 });
    expect(ended({ kind: 'switch', why: 'reclaim-paused was raised' })).toMatchObject({ crashedPasses: 0, nextAskAt: NOW + PASS });
    expect(ended({ kind: 'successor', why: 'x' })).toMatchObject({ crashedPasses: 61 });
  });

  it('an act that THREW is reported and asked again only after the backoff, never every pass', () => {
    const t = deadCoordinatorThrew({ ...deadCoordinatorEntry(), crashedPasses: 3 }, 'SQLITE_FULL', NOW, PASS);
    expect(t).toMatchObject({ attempts: 1, nextAskAt: NOW + 2 * PASS, crashedPasses: 3,
      report: { kind: 'stuck', at: NOW, runs: [], error: 'SQLITE_FULL' } });
    expect(deadCoordinatorThrew(t, 'SQLITE_FULL', NOW + 2 * PASS, PASS)).toMatchObject({ attempts: 2, nextAskAt: NOW + 6 * PASS,
      report: { at: NOW } });
    expect(deadCoordinatorReportSentence('demo-coord', t.report!)).toContain('the lane’s act on coordinator demo-coord failed (SQLITE_FULL)'.replace('’', "'"));
  });

  it('a pause or an unreadable store at the act forgets the sighting — a lowered switch needs two FRESH passes', () => {
    const e = { ...deadCoordinatorEntry(), crashedPasses: 5 };
    expect(deadCoordinatorNextEntry(e, { kind: 'paused-at-server', detail: 'd' }, 'orphan', NOW, NOW, PASS).crashedPasses).toBe(0);
  });
});

describe('the words', () => {
  it('ONE feed row per ended programme, in the spec’s words and with its first-dead time; the shadow row says nothing was ended', () => {
    const o = { kind: 'ended', programmes: [{ slug: 'alpha', runIds: [7, 8] }, { slug: 'beta', runIds: [9] }], open: [], stuck: [],
      stoppedBy: null } as const;
    expect(deadCoordinatorFeedRows('demo-coord', o, NOW)).toEqual([
      { title: 'dead coordinator: programme ended',
        body: 'coordinator demo-coord crashed (dead since 2026-09-21 14:13 UTC) and stayed dead an hour; programme alpha ended, 2 runs closed failed.' },
      { title: 'dead coordinator: programme ended',
        body: 'coordinator demo-coord crashed (dead since 2026-09-21 14:13 UTC) and stayed dead an hour; programme beta ended, 1 run closed failed.' },
    ]);
    const w = deadCoordinatorFeedRows('demo-coord', { kind: 'would-end', programmes: [{ slug: 'alpha', runIds: [7, 8] }] }, NOW);
    expect(w).toEqual([{ title: 'dead coordinator: programme would be ended',
      body: 'would end programme alpha (2 runs): coordinator demo-coord crashed (dead since 2026-09-21 14:13 UTC) and stayed dead an hour, and the lane is not armed (shadow), so nothing was ended.' }]);
  });

  it('a programme the act closed only PART of is never announced as ended', () => {
    const stopped = deadCoordinatorFeedRows('demo-coord', { kind: 'ended', programmes: [{ slug: 'alpha', runIds: [7] }],
      open: [{ slug: 'alpha', runIds: [8] }], stuck: [], stoppedBy: { kind: 'remeasured', why: 're-measured alive: tmux reports the pane live' } }, NOW);
    expect(stopped).toEqual([{ title: 'dead coordinator: programme partly ended',
      body: 'coordinator demo-coord crashed (dead since 2026-09-21 14:13 UTC) and stayed dead an hour; programme alpha was NOT ended: '
        + '1 of 2 runs closed failed and 1 stay open — the act stopped: re-measured alive: tmux reports the pane live.' }]);
    const stuck = deadCoordinatorFeedRows('demo-coord', { kind: 'ended', programmes: [{ slug: 'alpha', runIds: [7] }],
      open: [{ slug: 'alpha', runIds: [8] }], stuck: [{ runId: 8, why: 'bad-transition' }], stoppedBy: null }, NOW);
    expect(stuck[0]!.body).toContain('— the abandon arm could not move the rest.');
    expect(deadCoordinatorFeedRows('demo-coord', { kind: 'ended', programmes: [], open: [{ slug: 'alpha', runIds: [7] }], stuck: [],
      stoppedBy: { kind: 'switch', why: 'x' } }, NOW), 'nothing closed: no row').toEqual([]);
  });

  it('the would-end sentence names the cause, the instant and what an armed lane would end — and the doors that keep it', () => {
    const s = deadCoordinatorReportSentence('demo-coord', { kind: 'would-end', at: NOW, cause: 'orphan', since: NOW,
      programmes: [{ slug: 'alpha', runIds: [7, 8] }] });
    expect(s).toContain('coordinator demo-coord crashed (its pane is gone and nothing is bringing it back)');
    expect(s).toContain('nothing was ended; armed, it would end programme alpha (2 runs)');
    expect(s).toContain('Revive the coordinator or reclaim its programme to keep it.');
  });

  it('the breaker is ONE item, first, naming every claimant it holds; the rest follow newest first', () => {
    const m = new Map([
      ['c-a', { ...deadCoordinatorEntry(), report: { kind: 'unmeasured', at: 10, why: 'w' } } as const],
      ['c-b', { ...deadCoordinatorEntry(), report: { kind: 'stuck', at: 20, runs: [{ runId: 1, why: 'x' }] } } as const],
      ['c-c', deadCoordinatorEntry()],
    ]);
    const list = deadCoordinatorAttention(m, { tripped: true, why: 'clustered', claimants: ['c-d', 'c-e'], since: 5, members: [] });
    expect(list.map((a) => [a.kind, a.claimants])).toEqual([['breaker', ['c-d', 'c-e']], ['stuck', ['c-b']], ['unmeasured', ['c-a']]]);
    expect(list[0]!.sentence).toContain('2 coordinators read crashed within 10 minutes of each other (c-d, c-e)');
    expect(list[0]!.sentence).toContain('so the lane ends nothing');
  });

  it('the vocabulary guard admits the lane’s own words and nothing else', () => {
    for (const w of ['claimant-changed', 'sweep-stopped', 'would-end', 'paused-at-server', 'store-unreadable', 'unmeasured', 'stuck', 'breaker', 'ended']) {
      expect(isDeadCoordinatorKebab(w), w).toBe(true);
    }
    expect(isDeadCoordinatorKebab('claimant-alive')).toBe(false);
  });
});

describe('L1', () => {
  it('imports L0 alone — no node:, no fs, no fastify', () => {
    const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'deadCoordinator.ts'), 'utf8');
    const froms = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(froms).toEqual(['../../shared/api.js']);
  });
});
````

<!-- replay: replace server/test/mail-routes.test.ts -->
In `server/test/mail-routes.test.ts`, find:

````ts
import { isStallSettingsKebab } from '../src/coord/stallsettings.js';
````

Replace with:

````ts
import { isStallSettingsKebab } from '../src/coord/stallsettings.js';
import { isDeadCoordinatorKebab } from '../src/deadCoordinator.js';
````

<!-- replay: replace server/test/mail-routes.test.ts -->
In `server/test/mail-routes.test.ts`, find:

````ts
        || isStallSettingsKebab(tok),
        `${tok} is not a declared MailRejectCode, RunRefuseCode, LifecycleGapReason, ClaimRefuseCode, SessionLifecycle, ReclaimRefuseCode, AskRefuseCode, RunRouteRefuseCode, SetAccountPoolsRefuseCode, UpdateStoreRefuseCode, child-reclaim word, stall-watch word, expiry word or stall-watch settings word`).toBe(true);
````

Replace with:

````ts
        || isStallSettingsKebab(tok)
        // WORKSPACE LIFECYCLE WAVE 4: the FIFTEENTH union, checked together and never merged, on the standing rule
        // `enter-ignored` above states. `coord/endDeadCoordinator.ts` (the dead-coordinator lane's one executor) spells
        // its outcome and report kinds, and `coord/close.ts` and `coord/store.ts` spell the compare-and-set refusal
        // `claimant-changed`. None is a mail rejection or a run refusal — no route answers with one; they ride the lane's
        // memory and the feed. Admitted through the exported guard, derived from `deadCoordinator.ts`'s Records, never
        // NOT_CODES, for the reason every union above gives.
        || isDeadCoordinatorKebab(tok),
        `${tok} is not a declared MailRejectCode, RunRefuseCode, LifecycleGapReason, ClaimRefuseCode, SessionLifecycle, ReclaimRefuseCode, AskRefuseCode, RunRouteRefuseCode, SetAccountPoolsRefuseCode, UpdateStoreRefuseCode, child-reclaim word, stall-watch word, expiry word, stall-watch settings word or dead-coordinator word`).toBe(true);
````


- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts --maxWorkers=1 )
```

Measured: `dead-coordinator-policy.test.ts`: `no tests — the file fails at collection (its import does not resolve yet)`; `mail-routes.test.ts`: `no tests — the file fails at collection (its import does not resolve yet)`

- [ ] **Step 3: The L1 file, and its wire type.** The `shared/api.ts` insertion moves README's purge-token anchors, so the README block below re-points them, with the numbers measured on `9b0742089` — Step 5 is how to check them, and how to recompute them on another base.

<!-- replay: replace README.md -->
In `README.md`, find:

````markdown
`purge-mechanism-absent` (`shared/api.ts:7833-7835`), each with an operator sentence of its own at `:7875`,
`:7883` and `:7896`, which the session History tab renders through `lcRefusalWord`
````

Replace with:

````markdown
`purge-mechanism-absent` (`shared/api.ts:7849-7851`), each with an operator sentence of its own at `:7891`,
`:7899` and `:7912`, which the session History tab renders through `lcRefusalWord`
````

<!-- replay: create server/src/deadCoordinator.ts -->
Create `server/src/deadCoordinator.ts`:

````ts
// THE DEAD-COORDINATOR LANE'S DECISIONS (workspace lifecycle spec 2026-09-24 §5.4, wave 4). L1: pure and clock-free
// (the clock is an argument), `fs`-free and fastify-free — `archivedExpiry.ts`'s shape, beside it and sharing nothing
// with it. It imports L0 alone. `watch.ts`'s `sweepDeadCoordinators` (L4) GATHERS the evidence — the claimants of
// non-terminal runs, the reclaim door's own verdict for each (`measureClaimant`, its dead arm now carrying `cause`), the
// lifecycle mirror's rows, the durable first-dead anchors — and APPLIES these verdicts; `coord/endDeadCoordinator.ts`
// (the one executor) ends a programme on the coordination serialiser. Nothing in this file reads a file, a row or a
// clock.
//
// THE RULING (L4): a coordinator that CRASHED and stays dead an hour, with no successor, has its open runs closed
// `failed`, and its workers are then cleaned up. Only a crash counts: one the operator stopped, archived, reaped or
// forgot is never "dead" here. EVERY UNCERTAIN ANSWER IS "NOT THIS PASS": the act ends a programme for good.
import {
  compareGenerations,
  type DeadCoordinatorAttention, type LifecycleAct, type LifecycleDec, type LifecycleMeas, type LifecycleOutcome,
  type SessionLifecycle,
} from '../../shared/api.js';

/** THE LANE'S LIVE SWITCH (the coordinator's safety ruling (B), the expiry lane's and the scope sweep's precedent).
 *  Until `$REG/<this>` exists the lane MEASURES, keeps its durable first-dead anchors, trips its breaker and RECORDS
 *  "would end programme <slug> (<n> runs)" — a feed row and an attention entry — and never reaches `closeRun`'s abandon
 *  arm or the child-reclaim port. It has NO WRITER in the tree: the operator touches it by hand in the registry the
 *  server reads, and `single-definition.test.ts` pins that. Spelled here and nowhere else in `server/src`. */
export const DEAD_COORDINATOR_LANE_LIVE_MARKER = 'dead-coordinator-lane-live';

/** The hour (L4). The anchor's age is compared with it; it is the server's own rule, not a box's. */
export const DEAD_COORDINATOR_AFTER_MS = 60 * 60_000;

/** The circuit breaker's window (spec §5.4): two or more claimants FIRST measured crashed within this of each other
 *  are a box fault until the operator shows otherwise. */
export const DEAD_COORDINATOR_BREAKER_WINDOW_MS = 10 * 60_000;

/** How long the lane may go without measuring a crashed claimant before its durable episode is no longer one: a
 *  server down for longer, or an OLDER build running against this database after a rollback (it never writes the
 *  anchor table), measured nothing meanwhile — the claimant may have come back and crashed again. The episode then
 *  restarts at the pass that measures it again (the departure `dead-anchor-restarts-after-an-unobserved-gap`). Ten
 *  sweep intervals: a restart, a deploy or a slow pass stay inside it. */
export const DEAD_COORDINATOR_GAP_MS = 10 * 60_000;

/** The failure backoff's ceiling for a claimant whose runs the abandon arm could not move: after the k-th consecutive
 *  attempt the lane waits `min(this, passMs × 2^k)` (spec §5.4: "not retried beyond the lane's backoff"). */
export const DEAD_COORDINATOR_BACKOFF_CEILING_MS = 60 * 60_000;

// ── the verdict, widened ─────────────────────────────────────────────────────

/** WHICH death the reclaim door's ladder measured (spec §5.4: "The verdict is widened, not re-derived"). `absent` is
 *  its rung 1, a proven absence; the other three are L0's dead lifecycles. `ClaimantVerdict`'s dead arm
 *  (`coord/reclaim.ts`) carries one, set in that ladder and nowhere else; `coord-reclaim.test.ts` holds this list equal
 *  to `['absent', ...DEAD_LIFECYCLES]`, so a fourth dead word is a red, never a silent cast. */
export type ClaimantDeadCause = 'absent' | Extract<SessionLifecycle, 'stopped' | 'orphan' | 'never-started'>;
export const CLAIMANT_DEAD_CAUSES: readonly ClaimantDeadCause[] = ['absent', 'stopped', 'orphan', 'never-started'];

/** `ClaimantVerdict` as this file reads it — structurally, so L1 imports L0 alone. */
export type ClaimantReading =
  | { readonly state: 'dead'; readonly cause: ClaimantDeadCause }
  | { readonly state: 'alive'; readonly why: string }
  | { readonly state: 'unmeasurable'; readonly why: string };

// ── the journal clause ───────────────────────────────────────────────────────

/** The acts that put a session down ON PURPOSE (spec §5.4): ccd's `stop`, `archive`, `reap`, `destroy`, `purge` and
 *  `forget` (`_LC_ACTS`), CCR-15's `reclaim` and stage 3's `expire`. An `unsupervise` counts when it carries a
 *  DECLARED surface — `_ws_unsupervise`'s `dec.surface`, which reads `none` when ccd acted on its own account. */
export const DEAD_COORDINATOR_DELIBERATE_ACTS: readonly LifecycleAct[] =
  ['stop', 'archive', 'reap', 'destroy', 'purge', 'forget', 'reclaim', 'expire'];

/** Every act the clause reads — the deliberate ones, `unsupervise`, `spawn` (the start) and the we-do-not-know
 *  `unknown` — for the store's ONE read (`CoordStore.deadCoordinatorJournalRows`), so its SQL and this file's reading
 *  can never disagree about which rows matter. */
export const DEAD_COORDINATOR_JOURNAL_ACTS: readonly LifecycleAct[] =
  [...DEAD_COORDINATOR_DELIBERATE_ACTS, 'unsupervise', 'spawn', 'unknown'];

/** One mirrored row as the clause reads it (`MirroredLifecycleEvent`, oldest first by the mirror's own id). `raw` is
 *  the line verbatim, the mirror's own column; `gen` is the generation it was read from (19 digits, ccd's clock), which
 *  places a recorded gap before or after it. */
export interface DeadCoordinatorJournalRow {
  readonly act: LifecycleAct;
  readonly outcome: LifecycleOutcome;
  readonly at: number | null;
  readonly gen: string;
  readonly dec: Pick<LifecycleDec, 'surface'> | null;
  readonly meas: Pick<LifecycleMeas, 'rc'> | null;
  readonly raw: string;
}

/** What the mirror says about one claimant since its LAST SUCCESSFUL START. FOUR answers, never folded:
 *  `quiet` (it has history, none of it deliberate since that start — `started` says whether a successful spawn is in
 *  it at all), `deliberate` (the newest such act), `no-history` (the mirror holds no row for it AT ALL) and `unreadable`
 *  (the read failed, or the journal cannot be trusted to hold every act since that start — never "no history"). */
export type DeadCoordinatorJournal =
  | { readonly kind: 'quiet'; readonly started: boolean }
  | { readonly kind: 'deliberate'; readonly act: LifecycleAct; readonly at: number | null }
  | { readonly kind: 'no-history' }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** HOW FAR THE JOURNAL CAN BE TRUSTED this pass — the facts the clause reads BESIDE the rows (the departure
 *  `journal-loss-reads-as-unmeasured`). The mirror is best-effort and never gates an act by itself (`mirror.ts`), so a
 *  clause that reads "no deliberate act" off it must first ask whether a deliberate act could be missing from it:
 *   - `untrusted`: the mirror's own health is not `ok` — `unavailable` (the fleet's ccd does not journal), `unknown` (not
 *     swept yet) or `stale` (no sweep for three intervals) — or its gaps could not be read;
 *   - `gapGens`: the generations the mirror recorded LOST bytes in (`lifecycle_gaps`). A generation is immutably named
 *     and appended in time order, so a gap in a generation OLDER than the claimant's last start lost only lines from
 *     before that start; any other gap — the same generation, a newer one, or a name that cannot be placed — may have
 *     lost the act;
 *   - `lastWriteErrorAt`: when ccd last counted a journal line it could NOT append (`$REG/.lifecycle/errors`, rewritten
 *     on every count, so its mtime is that instant — the fleet box's clock, as a row's `at` is); `null` when it has
 *     counted none, `'unknown'` when it has and the instant could not be read. */
export interface DeadCoordinatorJournalTrust {
  readonly untrusted: string | null;
  readonly gapGens: readonly string[];
  readonly lastWriteErrorAt: number | null | 'unknown';
}

/** A journal with nothing against it. */
export const DEAD_COORDINATOR_JOURNAL_TRUSTED: DeadCoordinatorJournalTrust = { untrusted: null, gapGens: [], lastWriteErrorAt: null };

/** How close to the last start a counted write failure still counts against it — the two instants are one box's clock,
 *  so this is a margin for the file's mtime granularity, not for skew. */
export const DEAD_COORDINATOR_JOURNAL_MARGIN_MS = 60_000;

const GEN_DIGITS = /^[0-9]{1,25}$/;

/** Could a deliberate act since `start` (the newest successful spawn, or `null`: none in the horizon) be MISSING from
 *  the mirror? `null` when not; otherwise why. */
function journalLossSince(start: DeadCoordinatorJournalRow | null, t: DeadCoordinatorJournalTrust): string | null {
  for (const g of t.gapGens) {
    const before = start !== null && GEN_DIGITS.test(g) && GEN_DIGITS.test(start.gen) && compareGenerations(g, start.gen) < 0;
    if (!before) {
      return `the lifecycle mirror recorded lost journal bytes in generation ${g}`
        + (start === null ? ', and no successful spawn bounds what they held' : ', at or after its last successful spawn');
    }
  }
  const e = t.lastWriteErrorAt;
  if (e === 'unknown') return 'ccd counted journal lines it could not write, and when cannot be read';
  if (e !== null && (start === null || start.at === null || e >= start.at - DEAD_COORDINATOR_JOURNAL_MARGIN_MS)) {
    return `ccd could not write a journal line at ${new Date(e).toISOString()}`
      + (start === null ? ', and no successful spawn bounds it' : ', after its last successful spawn');
  }
  return null;
}

/** A row that puts the session down on purpose. A REFUSED act did nothing. An act this build cannot name (`unknown`,
 *  a newer ccd's) and an `unsupervise` whose surface cannot be read count — doubt never reads as a crash. */
const isDeliberate = (r: DeadCoordinatorJournalRow): boolean => r.outcome !== 'refused'
  && (DEAD_COORDINATOR_DELIBERATE_ACTS.includes(r.act) || r.act === 'unknown'
    || (r.act === 'unsupervise' && (r.dec === null || r.dec.surface !== 'none')));

/** Did this `spawn` line record a SUCCESSFUL spawn — `rc` 0? MEASURED: ccd's encoder (`_lc_json`) writes every meas
 *  value as a STRING, and the mirror's parser keeps `meas.rc` only when it is a JSON number (`journalparse.test.ts`
 *  pins that degrade), so the typed field is null on every line ccd has written. The line's own bytes are read
 *  instead, strictly: exactly `"0"` (or a typed 0) is a success, and anything else — a line that does not parse, a
 *  missing or other value — proves no start (the departure `the-last-start-is-read-off-the-spawn-line`). */
function spawnSucceeded(r: DeadCoordinatorJournalRow): boolean {
  if (r.meas?.rc === 0) return true;
  let v: unknown;
  try { v = JSON.parse(r.raw); } catch { return false; }
  const meas = typeof v === 'object' && v !== null ? (v as { meas?: unknown }).meas : undefined;
  return typeof meas === 'object' && meas !== null && (meas as { rc?: unknown }).rc === '0';
}

/** THE ONE READER of the journal clause. "Since its last successful start" is since the newest `spawn` row that
 *  recorded `rc` 0: `start` and `ensure` are journaled at the TOP of their verbs, before any pane exists, so a revive
 *  that FAILED journals them too — the case the clause exists for (a person stopped it, a later revive failed and
 *  cleared the stop stamp; the row now reads `orphan`). Only `_spawn_settle`'s `spawn` line carries the outcome. With
 *  no such row in the mirror's horizon, every row it holds counts. `rows` is the mirror's answer for the clause's acts,
 *  oldest first; `hasHistory` is whether it holds ANY row for the id, of any act — the store reads the two together;
 *  `trust` is what the lane measured about the journal itself, and a journal that may be missing an act since that
 *  start is `unreadable`, never quiet. */
export function deadCoordinatorJournal(
  rows: readonly DeadCoordinatorJournalRow[], hasHistory: boolean, trust: DeadCoordinatorJournalTrust,
): DeadCoordinatorJournal {
  if (trust.untrusted !== null) return { kind: 'unreadable', detail: trust.untrusted };
  let from = 0;
  let start: DeadCoordinatorJournalRow | null = null;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const r = rows[i]!;
    if (r.act === 'spawn' && r.outcome === 'done' && spawnSucceeded(r)) { from = i + 1; start = r; break; }
  }
  const lost = journalLossSince(start, trust);
  if (lost !== null) return { kind: 'unreadable', detail: lost };
  if (rows.length === 0) return hasHistory ? { kind: 'quiet', started: false } : { kind: 'no-history' };
  for (let i = rows.length - 1; i >= from; i -= 1) {
    const r = rows[i]!;
    if (isDeliberate(r)) return { kind: 'deliberate', act: r.act, at: r.at };
  }
  return { kind: 'quiet', started: start !== null };
}

// ── a crash, and only a crash ────────────────────────────────────────────────

/** One claimant's reading this pass. `crashed` is the only answer the lane counts toward the hour; every other one
 *  deletes the durable anchor. `unmeasured` is LISTED (an absent row the mirror knows nothing about, or a mirror that
 *  could not be read) and never acted on. */
export type DeadCoordinatorCrash =
  | { readonly kind: 'crashed'; readonly cause: Exclude<ClaimantDeadCause, 'stopped'> }
  | { readonly kind: 'alive'; readonly why: string }
  | { readonly kind: 'unmeasurable'; readonly why: string }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'deliberate'; readonly act: LifecycleAct }
  | { readonly kind: 'unmeasured'; readonly why: string };

/**
 * IS THIS CLAIMANT CRASHED (spec §5.4, "A crash, and only a crash")? Its verdict is `dead` with cause `orphan`,
 * `never-started` or `absent`, AND the journal shows no deliberate act since its last successful start. In order:
 *  - `alive` (a live pane, or a pane gone while the lifecycle reads `restarting` — a supervisor bringing it back) and
 *    `unmeasurable` are never dead;
 *  - `stopped` is never a crash (L4);
 *  - a journal that could not be read, or cannot be trusted to hold every act since the last start, is unmeasured,
 *    never "no history";
 *  - a deliberate act since the last start is never a crash, whatever the row reads now;
 *  - an ABSENT row with no history at all is unmeasured: listed, never acted on;
 *  - a NEVER-STARTED row with no successful spawn in the journal never ran, so it cannot have crashed — an heir the
 *    operator reclaimed a programme onto and has not started yet reads exactly so: unmeasured, listed, never acted on
 *    (the departure `never-started-without-a-spawn-is-unmeasured`).
 */
export function deadCoordinatorCrash(m: ClaimantReading, j: DeadCoordinatorJournal): DeadCoordinatorCrash {
  if (m.state === 'alive') return { kind: 'alive', why: m.why };
  if (m.state === 'unmeasurable') return { kind: 'unmeasurable', why: m.why };
  if (m.cause === 'stopped') return { kind: 'stopped' };
  if (j.kind === 'unreadable') return { kind: 'unmeasured', why: `the lifecycle journal cannot be trusted (${j.detail})` };
  if (j.kind === 'deliberate') return { kind: 'deliberate', act: j.act };
  if (j.kind === 'no-history' && m.cause === 'absent') {
    return { kind: 'unmeasured', why: 'its registry row is gone and the lifecycle mirror holds no history for it' };
  }
  if (m.cause === 'never-started' && !(j.kind === 'quiet' && j.started)) {
    return { kind: 'unmeasured', why: 'it never started — the journal holds no successful spawn for it' };
  }
  return { kind: 'crashed', cause: m.cause };
}

// ── the hour, made durable ───────────────────────────────────────────────────

/** The `coord.db` row (`dead_claimants`): the first pass of this episode that measured the claimant crashed, and the
 *  latest. Epoch ms, the server's clock. */
export interface DeadAnchor { readonly firstDeadAt: number; readonly lastDeadAt: number }

/** The row after a pass that measured the claimant CRASHED. The first such pass writes `firstDeadAt`; a later one moves
 *  `lastDeadAt` alone — unless the previous crashed pass is older than `DEAD_COORDINATOR_GAP_MS` (nothing measured it
 *  meanwhile) or lies in the future (the clock stepped back), when the episode restarts now. */
export function deadAnchorNext(prev: DeadAnchor | null, nowMs: number): DeadAnchor {
  if (prev === null || nowMs < prev.lastDeadAt || nowMs - prev.lastDeadAt > DEAD_COORDINATOR_GAP_MS) {
    return { firstDeadAt: nowMs, lastDeadAt: nowMs };
  }
  return { firstDeadAt: prev.firstDeadAt, lastDeadAt: nowMs };
}

/** SINCE WHEN the claimant has been dead, for the hour: `max(firstDeadAt, .supervised's stamp)`. The stamp may only
 *  RAISE the anchor, never lower it: it freezes whenever a session runs unsupervised (a unit crash-looped to FAILED, a
 *  darwin bootout), so a pane that died later would read `orphan` with a days-old stamp. An absent, unparseable or
 *  future stamp is ignored. `supervisedAtS` is the registry's epoch SECONDS. */
export function deadCoordinatorSince(anchor: DeadAnchor, supervisedAtS: number | null, nowMs: number): number {
  const stamp = supervisedAtS !== null && Number.isSafeInteger(supervisedAtS) && supervisedAtS > 0
    && supervisedAtS * 1000 <= nowMs ? supervisedAtS * 1000 : null;
  return stamp === null ? anchor.firstDeadAt : Math.max(anchor.firstDeadAt, stamp);
}

/** DUE: dead an hour since the anchor, AND the two latest passes both measured it crashed (`crashedPasses` is the
 *  lane's in-memory run of consecutive crashed passes — a restart can only delay the act, never cause it). */
export const deadCoordinatorDue = (since: number, crashedPasses: number, nowMs: number): boolean =>
  crashedPasses >= 2 && nowMs - since >= DEAD_COORDINATOR_AFTER_MS;

// ── the circuit breaker ──────────────────────────────────────────────────────

/** A box fault (the user manager lost across a reboot, a tmux server death, a bad ccd) makes every coordinator read
 *  dead at once, and that is evidence of a fleet fault, not of N crashes. TRIPPED, the lane acts on NONE — not on the
 *  clustered claimants and not on any other (the departure `breaker-holds-the-whole-lane`) — and raises ONE attention
 *  item naming them. It clears when they fall back under the threshold: revived, their programmes reclaimed or
 *  abandoned by the operator through the doors that already exist (the departure
 *  `breaker-clears-through-the-existing-doors`).
 *
 *  IT REMEMBERS (the departure `breaker-remembers-its-cluster`). A cluster member that reads unmeasurable for one pass
 *  loses its durable anchor (ruling E) and is re-anchored later, so a breaker recomputed from the anchors alone would
 *  let one transient doubt dissolve the cluster for good. `members` carries each held claimant's ORIGINAL first-dead
 *  instant; the lane hands them back on the next pass and releases a member only on an answer that is evidence — alive,
 *  stopped, a deliberate act — or when it leaves the population. */
export type DeadCoordinatorBreaker =
  | { readonly tripped: false }
  | { readonly tripped: true; readonly why: 'clustered' | 'unmeasurable'; readonly claimants: readonly string[];
      /** Since when it stands: the earliest held `firstDeadAt`, or this pass for an unmeasurable one. */
      readonly since: number;
      /** The clustered members and their first-dead instants — the breaker's memory, handed back next pass. */
      readonly members: readonly DeadCoordinatorBreakerMember[];
      /** For `unmeasurable`: what the pass could not measure. */
      readonly detail?: string };

export interface DeadCoordinatorBreakerMember { readonly id: string; readonly firstDeadAt: number }

/** `crashed`: this pass's crashed claimants with their durable `firstDeadAt`. `held`: the members the last trip held
 *  that no answer has released since, with their remembered instants (they win over a re-anchored one). `unmeasurable`:
 *  the ids this pass could not measure, of `measured` asked. `fleetDoubt`: a fleet-wide fact this pass measured — tmux
 *  did not answer — or `null`. A fleet-wide doubt trips it whatever the count: one claimant whose row is gone still
 *  reads crashed while tmux is down for every other, and that pass is exactly the box fault the breaker exists for. So
 *  does a pass that could measure none of two or more claimants. */
export function deadCoordinatorBreaker(
  crashed: readonly DeadCoordinatorBreakerMember[], held: readonly DeadCoordinatorBreakerMember[],
  unmeasurable: readonly string[], measured: number, fleetDoubt: string | null, nowMs: number,
): DeadCoordinatorBreaker {
  const firstDead = new Map(crashed.map((c) => [c.id, c.firstDeadAt]));
  for (const h of held) firstDead.set(h.id, h.firstDeadAt);
  const byTime = [...firstDead].map(([id, at]) => ({ id, firstDeadAt: at }))
    .sort((a, b) => a.firstDeadAt - b.firstDeadAt || (a.id < b.id ? -1 : 1));
  const clustered = new Set<string>();
  for (let i = 1; i < byTime.length; i += 1) {
    if (byTime[i]!.firstDeadAt - byTime[i - 1]!.firstDeadAt <= DEAD_COORDINATOR_BREAKER_WINDOW_MS) {
      clustered.add(byTime[i - 1]!.id); clustered.add(byTime[i]!.id);
    }
  }
  const members = byTime.filter((c) => clustered.has(c.id));
  const allUnmeasurable = measured >= 2 && unmeasurable.length === measured;
  if (fleetDoubt !== null || allUnmeasurable) {
    const named = [...new Set([...unmeasurable, ...crashed.map((c) => c.id), ...members.map((c) => c.id)])].sort();
    if (named.length > 0) {
      return { tripped: true, why: 'unmeasurable', claimants: named, since: nowMs, members,
        detail: fleetDoubt ?? 'not one of them could be measured' };
    }
  }
  if (members.length === 0) return { tripped: false };
  return { tripped: true, why: 'clustered', claimants: members.map((c) => c.id).sort(),
    since: Math.min(...members.map((c) => c.firstDeadAt)), members };
}

/** The breaker's key, for "write its feed row only when it CHANGES". */
export const deadCoordinatorBreakerKey = (b: DeadCoordinatorBreaker): string | null =>
  b.tripped ? `${b.why}:${b.claimants.join(',')}` : null;

// ── the act's answer, and the lane's memory ──────────────────────────────────

/** One programme the act ended, or would end: its slug and the runs it closes. */
export interface DeadCoordinatorProgramme { readonly slug: string; readonly runIds: readonly number[] }

/** Why the act stopped before it ended every run — typed, so the lane never re-splits prose:
 *   - `remeasured`: the claimant was re-measured and the answer was not a crash — alive, stopped, a deliberate act since
 *     its last start, unmeasurable, or a journal it cannot trust. Ruling E's "any other answer deletes the anchor"
 *     applies to this answer as to a pass's: the lane resets its run of crashed passes AND deletes the durable anchor, so
 *     a later crash needs a fresh hour and two fresh passes;
 *   - `switch`: the operator raised `reclaim-paused` or disarmed the lane during the act, or the registry would not list
 *     so neither can be ruled out. Nothing about the claimant was learned: the run of passes resets (a pause forgets a
 *     sighting) and the anchor stands;
 *   - `successor`: a run's claimant is no longer the crashed id (`claimant-changed`). Nothing about the crashed
 *     claimant is learned, so nothing resets. */
export type DeadCoordinatorStop =
  | { readonly kind: 'remeasured'; readonly why: string }
  | { readonly kind: 'switch'; readonly why: string }
  | { readonly kind: 'successor'; readonly why: string };

/** The one executor's answer (`coord/endDeadCoordinator.ts`). `ended` lists what closed (`programmes`), what was left
 *  open (`open`: the runs the abandon arm could not move, the run the act stopped at and those after it), what the arm
 *  could not move (`stuck`), and `stoppedBy` says why the act stopped early: "an alive answer at any point ends the
 *  whole act". */
export type DeadCoordinatorActOutcome =
  | { readonly kind: 'ended'; readonly programmes: readonly DeadCoordinatorProgramme[];
      readonly open: readonly DeadCoordinatorProgramme[];
      readonly stuck: readonly { readonly runId: number; readonly why: string }[];
      readonly stoppedBy: DeadCoordinatorStop | null }
  | { readonly kind: 'would-end'; readonly programmes: readonly DeadCoordinatorProgramme[] }
  | { readonly kind: 'paused-at-server'; readonly detail: string }
  | { readonly kind: 'store-unreadable'; readonly detail: string };

/** What the attention list says about one claimant, before it is worded. */
export type DeadCoordinatorReport =
  | { readonly kind: 'would-end'; readonly at: number; readonly cause: Exclude<ClaimantDeadCause, 'stopped'>;
      readonly since: number; readonly programmes: readonly DeadCoordinatorProgramme[] }
  | { readonly kind: 'unmeasured'; readonly at: number; readonly why: string }
  | { readonly kind: 'stuck'; readonly at: number; readonly runs: readonly { readonly runId: number; readonly why: string }[];
      /** The act itself failed (it threw) — nothing is known about which runs moved. */
      readonly error?: string };

/** The lane's memory of one claimant — IN MEMORY ONLY (the anchor is the durable half): a restart can only delay. */
export interface DeadCoordinatorEntry {
  /** Consecutive passes that measured it crashed. */
  readonly crashedPasses: number;
  /** The earliest the act may be asked again (ms), after runs the abandon arm could not move. */
  readonly nextAskAt: number;
  readonly attempts: number;
  /** The last recorded outcome's key, so a feed row is written when it CHANGES. */
  readonly lastOutcome: string | null;
  readonly report: DeadCoordinatorReport | null;
}

export const deadCoordinatorEntry = (): DeadCoordinatorEntry =>
  ({ crashedPasses: 0, nextAskAt: 0, attempts: 0, lastOutcome: null, report: null });

/** One pass's reading, folded into memory: a crashed pass extends the run (and ends an `unmeasured` report — the lane
 *  can tell now); anything else ends it, and the report goes with it — save `unmeasured`, which IS a report, and
 *  `stuck`, which stands until the runs move. */
export function deadCoordinatorSighted(e: DeadCoordinatorEntry, c: DeadCoordinatorCrash, nowMs: number): DeadCoordinatorEntry {
  if (c.kind === 'crashed') {
    return { ...e, crashedPasses: e.crashedPasses + 1, report: e.report?.kind === 'unmeasured' ? null : e.report };
  }
  const report: DeadCoordinatorReport | null = c.kind === 'unmeasured'
    ? { kind: 'unmeasured', at: e.report?.kind === 'unmeasured' ? e.report.at : nowMs, why: c.why }
    : e.report?.kind === 'stuck' ? e.report : null;
  return { ...e, crashedPasses: 0, report };
}

/** The backoff: `min(DEAD_COORDINATOR_BACKOFF_CEILING_MS, passMs × 2^k)`. */
export const deadCoordinatorBackoffMs = (attempts: number, passMs: number): number =>
  Math.min(DEAD_COORDINATOR_BACKOFF_CEILING_MS, passMs * 2 ** Math.min(attempts, 20));

/** The outcome's key, for "write a feed row only when it changes". */
export const deadCoordinatorOutcomeKey = (o: DeadCoordinatorActOutcome): string =>
  o.kind === 'would-end' ? `would-end:${o.programmes.map((p) => `${p.slug}=${p.runIds.join(',')}`).join(';')}` : o.kind;

/** The entry after the act (or its shadow record). A shadow `would-end` stands as the report; an `ended` with nothing
 *  stuck finishes the claimant (its runs are closed, so it leaves the population); runs the abandon arm could not move
 *  are reported and asked again only after the backoff. An act that STOPPED on a re-measure or a switch forgets the run
 *  of crashed passes, so it is never due again on passes counted before it; a switch also waits one pass. */
export function deadCoordinatorNextEntry(
  e: DeadCoordinatorEntry, o: DeadCoordinatorActOutcome, cause: Exclude<ClaimantDeadCause, 'stopped'>, since: number,
  nowMs: number, passMs: number,
): DeadCoordinatorEntry {
  const base = { ...e, lastOutcome: deadCoordinatorOutcomeKey(o) };
  switch (o.kind) {
    case 'would-end':
      return { ...base, report: { kind: 'would-end', at: e.report?.kind === 'would-end' ? e.report.at : nowMs, cause, since,
        programmes: o.programmes } };
    case 'ended': {
      const stop = o.stoppedBy?.kind;
      const crashedPasses = stop === 'remeasured' || stop === 'switch' ? 0 : e.crashedPasses;
      if (o.stuck.length === 0) {
        return { ...base, crashedPasses, attempts: 0, nextAskAt: stop === 'switch' ? nowMs + passMs : 0, report: null };
      }
      const attempts = e.attempts + 1;
      return { ...base, crashedPasses, attempts, nextAskAt: nowMs + deadCoordinatorBackoffMs(attempts, passMs),
        report: { kind: 'stuck', at: e.report?.kind === 'stuck' ? e.report.at : nowMs, runs: o.stuck } };
    }
    case 'paused-at-server': case 'store-unreadable':
      // Nothing was measured or moved: the sighting is forgotten, so a lowered switch needs two FRESH passes.
      return { ...base, crashedPasses: 0, nextAskAt: nowMs + passMs };
  }
}

/** The entry after an act that THREW (a store commit that failed after the fleet act, an agent that dropped): what
 *  moved is unknown, so it is reported and asked again only after the backoff — never every pass, re-composing the
 *  fleet act each time (spec §5.4: "not retried beyond the lane's backoff"). */
export function deadCoordinatorThrew(e: DeadCoordinatorEntry, error: string, nowMs: number, passMs: number): DeadCoordinatorEntry {
  const attempts = e.attempts + 1;
  return { ...e, attempts, nextAskAt: nowMs + deadCoordinatorBackoffMs(attempts, passMs),
    report: { kind: 'stuck', at: e.report?.kind === 'stuck' ? e.report.at : nowMs, runs: [], error } };
}

// ── the words ────────────────────────────────────────────────────────────────

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const runs = (n: number): string => `${n} ${n === 1 ? 'run' : 'runs'}`;
const programmesText = (ps: readonly DeadCoordinatorProgramme[]): string =>
  ps.map((p) => `programme ${p.slug} (${runs(p.runIds.length)})`).join(', ');
const CAUSE_WORD: Readonly<Record<Exclude<ClaimantDeadCause, 'stopped'>, string>> = {
  orphan: 'its pane is gone and nothing is bringing it back',
  'never-started': 'its pane is gone and its registry never recorded the start the journal did',
  absent: 'its registry row is gone',
};

/** The feed row's words for an act (or its shadow), one row per programme (spec §5.4), each with the instant the hour
 *  counted from (`since`) — spec §9's stage-4 row reports every ended programme "with its first-dead time". A programme
 *  the act closed only PART of is never announced as ended (the departure `a-partly-ended-programme-says-so`). */
export function deadCoordinatorFeedRows(
  claimantId: string, o: DeadCoordinatorActOutcome, since: number,
): { readonly title: string; readonly body: string }[] {
  const dead = `coordinator ${claimantId} crashed (dead since ${iso(since)})`;
  switch (o.kind) {
    case 'would-end':
      return o.programmes.map((p) => ({ title: 'dead coordinator: programme would be ended',
        body: `would end programme ${p.slug} (${runs(p.runIds.length)}): ${dead} and stayed dead an hour, and the lane `
          + 'is not armed (shadow), so nothing was ended.' }));
    case 'ended':
      return o.programmes.map((p) => {
        const left = o.open.find((x) => x.slug === p.slug)?.runIds.length ?? 0;
        if (left === 0) {
          return { title: 'dead coordinator: programme ended',
            body: `${dead} and stayed dead an hour; programme ${p.slug} ended, ${runs(p.runIds.length)} closed failed.` };
        }
        const why = o.stoppedBy !== null ? `the act stopped: ${o.stoppedBy.why}` : 'the abandon arm could not move the rest';
        return { title: 'dead coordinator: programme partly ended',
          body: `${dead} and stayed dead an hour; programme ${p.slug} was NOT ended: ${p.runIds.length} of `
            + `${runs(p.runIds.length + left)} closed failed and ${left} stay open — ${why}.` };
      });
    case 'paused-at-server': case 'store-unreadable':
      return [];
  }
}

/** One report's sentence. */
export function deadCoordinatorReportSentence(claimantId: string, r: DeadCoordinatorReport): string {
  switch (r.kind) {
    case 'would-end':
      return `coordinator ${claimantId} crashed (${CAUSE_WORD[r.cause]}) and has stayed dead since ${iso(r.since)}. `
        + `The lane is not armed (shadow), so nothing was ended; armed, it would end ${programmesText(r.programmes)}. `
        + 'Revive the coordinator or reclaim its programme to keep it.';
    case 'unmeasured':
      return `coordinator ${claimantId} cannot be told crashed from put down on purpose — ${r.why} — so the lane lists `
        + 'it and never acts on it. Reclaim or abandon its programme by hand.';
    case 'stuck':
      if (r.error !== undefined) {
        return `the lane's act on coordinator ${claimantId} failed (${r.error}); it is asked again only after a backoff — `
          + 'check its runs on /runs and abandon them by hand if it keeps failing.';
      }
      return `coordinator ${claimantId} crashed and its programme was ended, but ${r.runs.map((x) => `run ${x.runId} (${x.why})`)
        .join(', ')} could not be moved. It is asked again only after a backoff — abandon ${r.runs.length === 1 ? 'it' : 'them'} by hand.`;
  }
}

/** The breaker's ONE item. */
export function deadCoordinatorBreakerSentence(b: Extract<DeadCoordinatorBreaker, { tripped: true }>): string {
  const ids = b.claimants.join(', ');
  return b.why === 'unmeasurable'
    ? `the lane could not measure the fleet this pass (${b.detail ?? 'unknown'}), so it ends nothing and holds `
      + `${b.claimants.length === 1 ? 'coordinator' : 'coordinators'} ${ids} — a tmux that did not answer, or a registry `
      + 'that would not list, is a fleet fault, not a death.'
    : `${b.claimants.length} coordinators read crashed within ${DEAD_COORDINATOR_BREAKER_WINDOW_MS / 60_000} minutes of `
      + `each other (${ids}) — a box fault is likelier than ${b.claimants.length} crashes, so the lane ends nothing. `
      + 'Revive them, reclaim their programmes or abandon their runs; the lane resumes once fewer than two remain.';
}

/** The breaker's feed row, written once when it trips (or names a different set) — so a trip, and the coordinators it
 *  held, outlive the in-memory list (spec §9's stage-4 row: "breaker trips … reported"). */
export function deadCoordinatorBreakerFeedRow(b: Extract<DeadCoordinatorBreaker, { tripped: true }>): { readonly title: string; readonly body: string } {
  return { title: 'dead coordinator: breaker tripped', body: `${deadCoordinatorBreakerSentence(b)} (holding since ${iso(b.since)})` };
}

/** THE ATTENTION LIST, from the lane's memory alone, the breaker's item first. */
export function deadCoordinatorAttention(
  entries: ReadonlyMap<string, DeadCoordinatorEntry>, breaker: DeadCoordinatorBreaker,
): DeadCoordinatorAttention[] {
  const out: DeadCoordinatorAttention[] = [];
  for (const [id, e] of entries) {
    if (e.report !== null) {
      out.push({ kind: e.report.kind, claimants: [id], sentence: deadCoordinatorReportSentence(id, e.report), at: e.report.at });
    }
  }
  out.sort((a, b) => b.at - a.at || (a.claimants[0]! < b.claimants[0]! ? -1 : 1));
  return breaker.tripped
    ? [{ kind: 'breaker', claimants: breaker.claimants, sentence: deadCoordinatorBreakerSentence(breaker), at: breaker.since }, ...out]
    : out;
}

// ── the vocabulary, for `mail-routes.test.ts` ────────────────────────────────

const DEAD_COORDINATOR_OUTCOME_KINDS: Readonly<Record<DeadCoordinatorActOutcome['kind'], true>> = {
  ended: true, 'would-end': true, 'paused-at-server': true, 'store-unreadable': true,
};
const DEAD_COORDINATOR_REPORT_KINDS: Readonly<Record<DeadCoordinatorAttention['kind'], true>> = {
  'would-end': true, unmeasured: true, stuck: true, breaker: true,
};
/** `closeRun`'s compare-and-set refusal (`coord/close.ts`, `coord/store.ts`): the run's claimant is no longer the
 *  crashed id — a successor took the programme between the lane's measurement and the commit. */
export const CLAIMANT_CHANGED = 'claimant-changed';
/** `closeRun`'s sweep refusal when its in-arm re-measure (`DeadCoordinatorStop`) says the claimant is no longer crashed,
 *  or cannot say — before the fleet act, or after it and before the commit. */
export const SWEEP_STOPPED = 'sweep-stopped';

/** Every kebab word this lane spells as a literal in `server/src/coord` — its outcome kinds, its report kinds and the
 *  compare-and-set refusal — for `mail-routes.test.ts`'s scan. None is a mail rejection or a run refusal. Derived from
 *  the Records above, never a list. */
export function isDeadCoordinatorKebab(v: string): boolean {
  const own = (o: object): boolean => Object.prototype.hasOwnProperty.call(o, v);
  return v === CLAIMANT_CHANGED || v === SWEEP_STOPPED || own(DEAD_COORDINATOR_OUTCOME_KINDS) || own(DEAD_COORDINATOR_REPORT_KINDS);
}
````

<!-- replay: replace shared/api.ts -->
In `shared/api.ts`, find:

````ts

/** The three markers the coordination lane is governed by, read together
````

Replace with:

````ts

/** One report of the DEAD-COORDINATOR lane (workspace lifecycle spec 2026-09-24 §5.4, wave 4): a claimant it WOULD end
 *  the programme of while it runs shadowed (`would-end`), one it cannot tell crashed from put down on purpose
 *  (`unmeasured`), one whose runs the abandon arm could not move (`stuck`), and the circuit breaker (`breaker`, naming
 *  every claimant it holds). A REPORT, never a tap: the doors that act are the ones that already exist — revive,
 *  reclaim, abandon. NEVER the child or expiry lane's list. `sentence` is the SERVER's; `at` (epoch ms, the server's
 *  clock) is since when it stands, kept in the lane's memory and rebuilt on the passes after a restart. */
export interface DeadCoordinatorAttention {
  readonly kind: 'would-end' | 'unmeasured' | 'stuck' | 'breaker';
  readonly claimants: readonly string[];
  readonly sentence: string;
  readonly at: number;
}

/** The three markers the coordination lane is governed by, read together
````

<!-- replay: replace shared/api.ts -->
In `shared/api.ts`, find:

````ts
  expiryAttention?: readonly ExpiryAttention[];
````

Replace with:

````ts
  expiryAttention?: readonly ExpiryAttention[];
  /** The dead-coordinator lane's own list (wave 4). OPTIONAL on the wire: an older server omits it, and the PWA's one
   *  reader (`pwa/src/fleet/deadCoordinatorWords.ts`) reads absence as no items. */
  deadCoordinatorAttention?: readonly DeadCoordinatorAttention[];
````


- [ ] **Step 4: Run — green.**

```bash
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/tsc --noEmit -p . )
```

Measured: `dead-coordinator-policy.test.ts`: `31 passed (31)`; `mail-routes.test.ts`: `59 passed (59)`; `session-hook.test.ts `-t CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND``: `5 passed | 330 skipped (335)`; `tsc` rc 0.

- [ ] **Step 5: The README tax.** Without Step 3's README block the citation cases are red (`2 failed | 3 passed | 330 skipped (335)`: `CITATION DEBT` and `README HAS ITS OWN CENSUS`, measured). README's four purge-token anchors are re-pointed BY CONTENT — the three `| 'purge-…'` union members and the three `'purge-…':` sentence keys read off the tree, never a delta:

```bash
grep -n "^  | 'purge-refused'\|^  | 'purge-incomplete'\|^  | 'purge-mechanism-absent'" shared/api.ts
grep -n "^  'purge-refused':\|^  'purge-incomplete':\|^  'purge-mechanism-absent':" shared/api.ts
```

On `9b0742089` with this plan's insertion they read `7849`, `7850`, `7851` and `7891`, `7899`, `7912` (from `7833-7835`, `:7875`, `:7883`, `:7896`) — and the same on `7f7bf4afc`, measured: #320 appended its L0 block at the end of the file, below every anchor. The README sentence `(`shared/api.ts:<first>-<last>`), each with an operator sentence of its own at `:<a>`, `:<b>` and `:<c>`` takes those numbers — the edit is in Step 3's blocks as measured there; if your base differs, write the numbers the two greps print. Then:

```bash
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
```

Measured: `5 passed | 330 skipped (335)`.

- [ ] **Step 6: Mutation check, then commit.**

| # | Edit (restore after) | Measured red |
|---|---|---|
| T6.1 | `server/src/deadCoordinator.ts`: `    if (r.act === 'spawn' && r.outcome === 'done' && spawnSucceeded(r)) { from = i + 1; start = r; break; }` → `    if (r.act === 'spawn' && r.outcome === 'done') { from = i + 1; start = r; break; }` | `dead-coordinator-policy.test.ts`: `2 failed \| 29 passed (31)` — the start is read off the spawn line’s OWN bytes, as ccd wrote them; a line whose rc cannot be read proves no start; THE CASE THE CLAUSE EXISTS FOR: stopped, then a revive that FAILED — `start` and `ensure` journal at the top, so only a spawn with rc 0 is a start |
| T6.2 | `server/src/deadCoordinator.ts`: `const isDeliberate = (r: DeadCoordinatorJournalRow): boolean => r.outcome !== 'refused' ⏎ ` → `const isDeliberate = (r: DeadCoordinatorJournalRow): boolean => true ⏎ ` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — a REFUSED act did nothing; an act this build cannot name, and an unsupervise whose surface cannot be read, are doubt — never a crash |
| T6.3 | `server/src/deadCoordinator.ts`: `DEAD_COORDINATOR_DELIBERATE_ACTS.includes(r.act) \|\| r.act === 'unknown' ⏎ ` → `DEAD_COORDINATOR_DELIBERATE_ACTS.includes(r.act) ⏎ ` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — a REFUSED act did nothing; an act this build cannot name, and an unsupervise whose surface cannot be read, are doubt — never a crash |
| T6.4 | `server/src/deadCoordinator.ts`: `(r.act === 'unsupervise' && (r.dec === null \|\| r.dec.surface !== 'none'))` → `(r.act === 'unsupervise' && (r.dec !== null && r.dec.surface !== 'none'))` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — a REFUSED act did nothing; an act this build cannot name, and an unsupervise whose surface cannot be read, are doubt — never a crash |
| T6.5 | `server/src/deadCoordinator.ts`: `  if (m.cause === 'stopped') return { kind: 'stopped' }; ⏎ ` → (removed) | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — the table |
| T6.6 | `server/src/deadCoordinator.ts`: ``  if (j.kind === 'unreadable') return { kind: 'unmeasured', why: `the lifecycle journal cannot be trusted (${j.detail})` }; ⏎ `` → (removed) | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — the table |
| T6.7 | `server/src/deadCoordinator.ts`: `  if (j.kind === 'no-history' && m.cause === 'absent') {` → `  if (false) {` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — the table |
| T6.8 | `server/src/deadCoordinator.ts`: `  if (j.kind === 'deliberate') return { kind: 'deliberate', act: j.act }; ⏎ ` → (removed) | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — the table |
| T6.9 | `server/src/deadCoordinator.ts`: `  if (prev === null \|\| nowMs < prev.lastDeadAt \|\| nowMs - prev.lastDeadAt > DEAD_COORDINATOR_GAP_MS) {` → `  if (prev === null \|\| nowMs < prev.lastDeadAt) {` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — a gap nothing measured — a server down, an older build running after a rollback — restarts the episode; so does a stamp from the future |
| T6.10 | `server/src/deadCoordinator.ts`: `  return stamp === null ? anchor.firstDeadAt : Math.max(anchor.firstDeadAt, stamp);` → `  return stamp === null ? anchor.firstDeadAt : stamp;` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — the supervisor stamp may RAISE the anchor and never lower it; absent, unparseable and future stamps are ignored |
| T6.11 | `server/src/deadCoordinator.ts`: `    && supervisedAtS * 1000 <= nowMs ? supervisedAtS * 1000 : null;` → `    ? supervisedAtS * 1000 : null;` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — the supervisor stamp may RAISE the anchor and never lower it; absent, unparseable and future stamps are ignored |
| T6.12 | `server/src/deadCoordinator.ts`: `  crashedPasses >= 2 && nowMs - since >= DEAD_COORDINATOR_AFTER_MS;` → `  crashedPasses >= 1 && nowMs - since >= DEAD_COORDINATOR_AFTER_MS;` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — due: an hour since the anchor AND two crashed passes in a row |
| T6.13 | `server/src/deadCoordinator.ts`: `    if (byTime[i]!.firstDeadAt - byTime[i - 1]!.firstDeadAt <= DEAD_COORDINATOR_BREAKER_WINDOW_MS) {` → `    if (false) {` | `dead-coordinator-policy.test.ts`: `4 failed \| 27 passed (31)` — two claimants first measured crashed within ten minutes of each other trip it, naming both; only the clustered are named; one crash alone never trips it; IT REMEMBERS: a held member keeps its first instant through a re-anchor, and holds while it only reads doubtful; its key changes only when the trip, or the set it holds, does — the feed row is written once per trip |
| T6.14 | `server/src/deadCoordinator.ts`: `  if (fleetDoubt !== null \|\| allUnmeasurable) {` → `  if (false) {` | `dead-coordinator-policy.test.ts`: `2 failed \| 29 passed (31)` — a FLEET-WIDE doubt (tmux did not answer) trips it whatever the count, naming every claimant it could not clear; a pass that could measure none of two or more claimants trips it; one unmeasurable of several, with tmux answering, does not |
| T6.15 | `server/src/deadCoordinator.ts`: `    : e.report?.kind === 'stuck' ? e.report : null;` → `    : e.report;` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — a crashed pass extends the run; any other reading ends it, and its would-end report with it |
| T6.16 | `server/src/deadCoordinator.ts`: `    return { ...base, crashedPasses, attempts, nextAskAt: nowMs + deadCoordinatorBackoffMs(attempts, passMs),` → `    return { ...base, crashedPasses, attempts, nextAskAt: 0,` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — an act that closed everything finishes the claimant; runs it could not move are reported and asked again only after a backoff |
| T6.17 | `server/src/deadCoordinator.ts`: `  return typeof meas === 'object' && meas !== null && (meas as { rc?: unknown }).rc === '0';` → `  return typeof meas === 'object' && meas !== null && (meas as { rc?: unknown }).rc !== undefined;` | `dead-coordinator-policy.test.ts`: `2 failed \| 29 passed (31)` — the start is read off the spawn line’s OWN bytes, as ccd wrote them; a line whose rc cannot be read proves no start; THE CASE THE CLAUSE EXISTS FOR: stopped, then a revive that FAILED — `start` and `ensure` journal at the top, so only a spawn with rc 0 is a start |
| T6.18 | `server/src/deadCoordinator.ts`: `  if (r.meas?.rc === 0) return true; ⏎ ` → (removed) | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — the start is read off the spawn line’s OWN bytes, as ccd wrote them; a line whose rc cannot be read proves no start |
| T6.19 | `server/src/deadCoordinator.ts`: `  if (trust.untrusted !== null) return { kind: 'unreadable', detail: trust.untrusted }; ⏎ ` → (removed) | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — a journal the lane cannot TRUST is unreadable, never quiet: a mirror not ok, a gap that may hold the act, a write ccd could not make |
| T6.20 | `server/src/deadCoordinator.ts`: `  if (lost !== null) return { kind: 'unreadable', detail: lost }; ⏎ ` → (removed) | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — a journal the lane cannot TRUST is unreadable, never quiet: a mirror not ok, a gap that may hold the act, a write ccd could not make |
| T6.21 | `server/src/deadCoordinator.ts`: `    const before = start !== null && GEN_DIGITS.test(g) && GEN_DIGITS.test(start.gen) && compareGenerations(g, start.gen) < 0;` → `    const before = true;` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — a journal the lane cannot TRUST is unreadable, never quiet: a mirror not ok, a gap that may hold the act, a write ccd could not make |
| T6.22 | `server/src/deadCoordinator.ts`: `  if (e !== null && (start === null \|\| start.at === null \|\| e >= start.at - DEAD_COORDINATOR_JOURNAL_MARGIN_MS)) {` → `  if (false) {` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — a journal the lane cannot TRUST is unreadable, never quiet: a mirror not ok, a gap that may hold the act, a write ccd could not make |
| T6.23 | `server/src/deadCoordinator.ts`: `  if (m.cause === 'never-started' && !(j.kind === 'quiet' && j.started)) {` → `  if (false) {` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — the table |
| T6.24 | `server/src/deadCoordinator.ts`: `  for (const h of held) firstDead.set(h.id, h.firstDeadAt); ⏎ ` → (removed) | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — IT REMEMBERS: a held member keeps its first instant through a re-anchor, and holds while it only reads doubtful |
| T6.25 | `server/src/deadCoordinator.ts`: `      const crashedPasses = stop === 'remeasured' \|\| stop === 'switch' ? 0 : e.crashedPasses;` → `      const crashedPasses = e.crashedPasses;` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — an act that STOPPED on a re-measure or a switch forgets its passes; a successor does not |
| T6.26 | `server/src/deadCoordinator.ts`: `  return { ...e, attempts, nextAskAt: nowMs + deadCoordinatorBackoffMs(attempts, passMs), ⏎     report: { kind: 'stuck', at: e.report?.kind === 'stuck' ? e.report.at : nowMs, runs: [], error } };` → `  return { ...e, attempts, nextAskAt: 0, ⏎     report: { kind: 'stuck', at: e.report?.kind === 'stuck' ? e.report.at : nowMs, runs: [], error } };` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — an act that THREW is reported and asked again only after the backoff, never every pass |
| T6.27 | `server/src/deadCoordinator.ts`: `        if (left === 0) {` → `        if (true) {` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — a programme the act closed only PART of is never announced as ended |
| T6.28 | `server/src/deadCoordinator.ts`: `    return { ...e, crashedPasses: e.crashedPasses + 1, report: e.report?.kind === 'unmeasured' ? null : e.report };` → `    return { ...e, crashedPasses: e.crashedPasses + 1 };` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — unmeasured IS a report, kept with its first instant until a pass can tell; stuck stands until its runs move |
| T6.29 | `server/src/deadCoordinator.ts`: `  const allUnmeasurable = measured >= 2 && unmeasurable.length === measured;` → `  const allUnmeasurable = false;` | `dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — a pass that could measure none of two or more claimants trips it; one unmeasurable of several, with tmux answering, does not |

```bash
git add server/src/deadCoordinator.ts shared/api.ts README.md server/test/dead-coordinator-policy.test.ts server/test/mail-routes.test.ts
git commit -m "$(cat <<'MSG'
feat(lifecycle): the dead-coordinator lane's decisions, in one L1 file

A crash and only a crash: the reclaim verdict's dead cause and ONE journal
reader (a deliberate act since the last successful spawn, read off the spawn
line's own bytes, is never a crash; doubt reads as deliberate; a journal that
may have lost the act since that spawn is unreadable). The hour made durable:
the anchor, its gap rule, the supervisor stamp that only raises it, and two
crashed passes. The breaker and its memory, the act's typed stop, the words,
and the wire type the coord frame will carry.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: The verdict, widened in ONE place — `ClaimantVerdict`'s dead arm carries its cause

**Model routing:** `sonnet`, effort `high`.

**Files:** `server/src/coord/reclaim.ts`; test `server/test/coord-reclaim.test.ts`.

**Interfaces:** `ClaimantVerdict`'s dead arm becomes `{ state: 'dead'; cause: ClaimantDeadCause; why: string }`. `measureClaimant` sets `cause: 'absent'` on rung 1's proven absence and `cause: <the lifecycle>` on a dead lifecycle — through a type guard over `lifecycleIsDead`, and the test holds `CLAIMANT_DEAD_CAUSES` equal to `['absent', ...DEAD_LIFECYCLES]`, so a fourth dead word is a red, never a silent cast. `reclaimRun` and the stall watch read `state` alone — unchanged (D-1145's "the third consumer must widen the type").

- [ ] **Step 1: The tests (red).**

<!-- replay: replace server/test/coord-reclaim.test.ts -->
In `server/test/coord-reclaim.test.ts`, find:

````ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
````

Replace with:

````ts
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
````

<!-- replay: replace server/test/coord-reclaim.test.ts -->
In `server/test/coord-reclaim.test.ts`, find:

````ts
import { measureClaimant, reclaimRun, type ReclaimDeps } from '../src/coord/reclaim.js';
````

Replace with:

````ts
import { measureClaimant, reclaimRun, type ReclaimDeps } from '../src/coord/reclaim.js';
import { CLAIMANT_DEAD_CAUSES } from '../src/deadCoordinator.js';
import { DEAD_LIFECYCLES } from '../../shared/api.js';
````

<!-- replay: replace server/test/coord-reclaim.test.ts -->
In `server/test/coord-reclaim.test.ts`, find:

````ts
    expect(v.why).toContain('restarting');
````

Replace with:

````ts
    expect(v.why).toContain('restarting');
  });

  // WORKSPACE LIFECYCLE WAVE 4 (spec 2026-09-24 §5.4, "The verdict is widened, not re-derived"): the dead-coordinator
  // lane is the THIRD consumer that needs to know WHICH death — D-1145's note says the third must widen the type rather
  // than re-split the prose `why` by hand. So the dead arm carries `cause`, set in this ladder and nowhere else.
  it('the dead arm names its CAUSE, one of four, set in the ladder itself', async () => {
    const cases: [string, Record<string, string> | null, boolean, string][] = [
      ['a proven absence', null, true, 'absent'],
      ['a stop stamp', { stopped: `${SEC} ccd` }, true, 'stopped'],
      ['a supervisor heartbeat long gone', { supervised: String(SEC - 3600) }, true, 'orphan'],
      ['a row that never started', {}, false, 'never-started'],
    ];
    for (const [name, extra, started, cause] of cases) {
      const home = mkTmp('ccrc-reclaim-');
      seedRow(home, LIVE);
      if (extra !== null) seedRow(home, DEAD, extra);
      if (!started) rmSync(path.join(home, '.cc-sessions', `${DEAD}.started`));
      const v = await measureClaimant(depsFor(home, store(home), GONE), DEAD, NOW);
      expect(v, name).toMatchObject({ state: 'dead', cause });
    }
  });

  it('the four causes are exactly the absence and L0’s dead lifecycles — a new dead word is a red here, not a silent cast', () => {
    expect([...DEAD_LIFECYCLES].sort()).toEqual(['never-started', 'orphan', 'stopped']);
    expect([...CLAIMANT_DEAD_CAUSES].sort()).toEqual(['absent', ...DEAD_LIFECYCLES].sort());
````


- [ ] **Step 2: Run — red.** `( cd server && ./node_modules/.bin/vitest run test/coord-reclaim.test.ts --maxWorkers=1 )`

Measured: `coord-reclaim.test.ts`: `1 failed | 31 passed (32)` — × the dead arm names its CAUSE, one of four, set in the ladder itself — the list case is green by design (its red is row T7.3).

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/coord/reclaim.ts -->
In `server/src/coord/reclaim.ts`, find:

````ts
import { lifecycleIsDead, sessionLifecycle } from '../../../shared/api.js';
````

Replace with:

````ts
import { lifecycleIsDead, sessionLifecycle, type SessionLifecycle } from '../../../shared/api.js';
import type { ClaimantDeadCause } from '../deadCoordinator.js';
````

<!-- replay: replace server/src/coord/reclaim.ts -->
In `server/src/coord/reclaim.ts`, find:

````ts
  | { state: 'dead'; why: string }
  | { state: 'alive'; why: string }
  | { state: 'unmeasurable'; why: string };
````

Replace with:

````ts
  | { state: 'dead'; cause: ClaimantDeadCause; why: string }
  | { state: 'alive'; why: string }
  | { state: 'unmeasurable'; why: string };

/** The dead arm's `cause` (workspace lifecycle spec 2026-09-24 §5.4, "The verdict is widened, not re-derived"): D-1145
 *  below says the THIRD consumer that needs WHICH death must widen the type rather than re-split the prose `why` by
 *  hand, and the dead-coordinator lane is that consumer — it acts on `orphan`, `never-started` and `absent`, never on
 *  `stopped`. Set HERE, in this ladder, and nowhere else: rung 1's proven absence is `absent`, and a dead lifecycle is
 *  its own word (`ClaimantDeadCause`, the lane's L1 file, which `coord-reclaim.test.ts` holds equal to `['absent',
 *  ...DEAD_LIFECYCLES]`). The reclaim door and the stall watch read `state` alone and ignore it. */
const isDeadLifecycle = (lc: SessionLifecycle): lc is Exclude<ClaimantDeadCause, 'absent'> => lifecycleIsDead(lc);
````

<!-- replay: replace server/src/coord/reclaim.ts -->
In `server/src/coord/reclaim.ts`, find:

````ts
    return { state: 'dead', why: 'no registry row in a directory that listed cleanly' };
````

Replace with:

````ts
    return { state: 'dead', cause: 'absent', why: 'no registry row in a directory that listed cleanly' };
````

<!-- replay: replace server/src/coord/reclaim.ts -->
In `server/src/coord/reclaim.ts`, find:

````ts
  return lifecycleIsDead(lc)
    ? { state: 'dead', why: `the pane is gone and the lifecycle reads ${lc}` }
````

Replace with:

````ts
  return isDeadLifecycle(lc)
    ? { state: 'dead', cause: lc, why: `the pane is gone and the lifecycle reads ${lc}` }
````


- [ ] **Step 4: Run — green**, and the reclaim door's and the stall watch's suites, which read the verdict:

```bash
( cd server && ./node_modules/.bin/vitest run test/coord-reclaim.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/reclaim-route.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/stall-sweep.test.ts --maxWorkers=1 )
```

Measured: `coord-reclaim.test.ts`: `32 passed (32)`; `reclaim-route.test.ts`: `17 passed (17)`; `stall-sweep.test.ts`: `117 passed (117)`

- [ ] **Step 5: Mutation check, then commit.**

| # | Edit (restore after) | Measured red |
|---|---|---|
| T7.1 | `server/src/coord/reclaim.ts`: `    return { state: 'dead', cause: 'absent', why: 'no registry row in a directory that listed cleanly' };` → `    return { state: 'dead', cause: 'orphan', why: 'no registry row in a directory that listed cleanly' };` | `coord-reclaim.test.ts`: `1 failed \| 31 passed (32)` — the dead arm names its CAUSE, one of four, set in the ladder itself |
| T7.2 | `server/src/coord/reclaim.ts`: ``    ? { state: 'dead', cause: lc, why: `the pane is gone and the lifecycle reads ${lc}` }`` → ``    ? { state: 'dead', cause: 'orphan', why: `the pane is gone and the lifecycle reads ${lc}` }`` | `coord-reclaim.test.ts`: `1 failed \| 31 passed (32)` — the dead arm names its CAUSE, one of four, set in the ladder itself |
| T7.3 | `server/src/deadCoordinator.ts`: `export const CLAIMANT_DEAD_CAUSES: readonly ClaimantDeadCause[] = ['absent', 'stopped', 'orphan', 'never-started'];` → `export const CLAIMANT_DEAD_CAUSES: readonly ClaimantDeadCause[] = ['absent', 'stopped', 'orphan'];` | `coord-reclaim.test.ts`: `1 failed \| 31 passed (32)` — the four causes are exactly the absence and L0’s dead lifecycles — a new dead word is a red here, not a silent cast |

```bash
git add server/src/coord/reclaim.ts server/test/coord-reclaim.test.ts
git commit -m "$(cat <<'MSG'
feat(reclaim): the claimant verdict's dead arm carries its cause

Workspace lifecycle §5.4: the verdict is widened, not re-derived. The dead
arm names which death the ladder measured (absent, stopped, orphan,
never-started), set in measureClaimant and nowhere else; the reclaim door and
the stall watch read the state alone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: The store's half — the durable anchor (migration 18), the journal clause's one read, and the compare-and-set inside the close

**Model routing:** `opus`, effort `high` — a migration and a transaction.

**Files:** `server/src/coord/schema.ts` (`MIGRATIONS[17]`), `server/src/coord/store.ts`; create `server/test/dead-coordinator-store.test.ts`; modify `server/test/coord-db.test.ts`, `server/test/asks-store.test.ts`.

**Interfaces (Produces):**
- `dead_claimants (claimantId TEXT NOT NULL PRIMARY KEY, firstDeadAt INTEGER NOT NULL, lastDeadAt INTEGER NOT NULL)` — a new table and nothing else (Pre-flight finding 2).
- `CoordStore.deadAnchors(): { ok: true; anchors: Map<string, DeadAnchor> } | { ok: false; detail }` (integers CAST and proven, ALL-OR-FAILURE, D-2545's rule), `setDeadAnchor(id, anchor)` (upsert), `deleteDeadAnchor(id)`.
- `CoordStore.deadCoordinatorJournalRows(ids): Map<id, { rows: DeadCoordinatorJournalRow[]; hasHistory: boolean }>` — two statements whatever the count, each `INDEXED BY lifecycle_by_session`; every asked id answered; each row carries its generation; a failing read throws (the lane reads that as `unreadable`).
- `CoordStore.lifecycleGapGens(): string[]` — every generation the mirror recorded lost bytes in, distinct, one statement, never limited (the journal trust's read; a failing read throws, and the lane trusts nothing).
- `CoordStore.closeRun({ …, expectClaimedBy? })` — when given, the transaction reads the run's `claimedBy` first and answers `{ ok: false, error: 'claimant-changed', claimedBy }` writing NOTHING when it differs; `AdvanceResult` gains that arm.

- [ ] **Step 1: The tests (red).** `coord-db.test.ts`'s migration-14 case needs no edit: #320 narrowed it to its own five tables. The new `dead_claimants` describe finds its migration's slot by its DDL (main's rule since #320), so a later renumber edits no line of it; each of its two cases opens with a floor (`SLOT >= 18`), which is its red before Step 3.

<!-- replay: replace server/test/asks-store.test.ts -->
In `server/test/asks-store.test.ts`, find:

````ts
    // SEVEN migrations have landed since this test's own version: MIGRATIONS[10]
````

Replace with:

````ts
    // EIGHT migrations have landed since this test's own version: MIGRATIONS[10]
````

<!-- replay: replace server/test/asks-store.test.ts -->
In `server/test/asks-store.test.ts`, find:

````ts
    // §5.3) and MIGRATIONS[16] (`stall_settings` and `run_events_by_at`, stall
    // watch settings §8). None touches the asks table. This pin only needs the
    // CURRENT total — it asserts "no migration after the one this test knows
    // about has changed the asks table's columns", not anything about any of
    // the seven.
    expect(COORD_SCHEMA_VERSION).toBe(17);
````

Replace with:

````ts
    // §5.3), MIGRATIONS[16] (`stall_settings` and `run_events_by_at`, stall
    // watch settings §8) and MIGRATIONS[17] (`dead_claimants`, workspace
    // lifecycle §5.4). None touches the asks table. This pin only needs the
    // CURRENT total — it asserts "no migration after the one this test knows
    // about has changed the asks table's columns", not anything about any of
    // the eight.
    expect(COORD_SCHEMA_VERSION).toBe(18);
````

<!-- replay: replace server/test/coord-db.test.ts -->
In `server/test/coord-db.test.ts`, find:

````ts
  it('COORD_SCHEMA_VERSION derives to 17 — never hand-edited beside a growing array', () => {
    // Bumped to 17 by seven migrations: MIGRATIONS[10] (runs.kind/runs.reviews,
````

Replace with:

````ts
  it('COORD_SCHEMA_VERSION derives to 18 — never hand-edited beside a growing array', () => {
    // Bumped to 18 by eight migrations: MIGRATIONS[10] (runs.kind/runs.reviews,
````

<!-- replay: replace server/test/coord-db.test.ts -->
In `server/test/coord-db.test.ts`, find:

````ts
    // §5.3) and MIGRATIONS[16] (stall_settings and run_events_by_at — stall
    // watch settings design 2026-10-05 §8).
    expect(COORD_SCHEMA_VERSION).toBe(17);
    expect(MIGRATIONS.length).toBe(17);
````

Replace with:

````ts
    // §5.3), MIGRATIONS[16] (stall_settings and run_events_by_at — stall
    // watch settings design 2026-10-05 §8) and MIGRATIONS[17] (dead_claimants,
    // workspace lifecycle spec §5.4).
    expect(COORD_SCHEMA_VERSION).toBe(18);
    expect(MIGRATIONS.length).toBe(18);
````

<!-- replay: replace server/test/coord-db.test.ts -->
In `server/test/coord-db.test.ts`, find:

````ts
    // 17 since MIGRATIONS[14] (the stall read's indexes), MIGRATIONS[15]
    // (runs.sessionBornAt/sessionBornFor, child-reclamation spec §5.1, §5.3)
    // and MIGRATIONS[16] (stall_settings and run_events_by_at, stall watch
    // settings §8); the migration above is still entry 11.
    expect(COORD_SCHEMA_VERSION).toBe(17);
    const row = db.prepare('SELECT kind, reviews FROM runs').get() as { kind: string; reviews: number | null };
    expect(row).toEqual({ kind: 'work', reviews: null });
````

Replace with:

````ts
    // 18 since MIGRATIONS[14] (the stall read's indexes), MIGRATIONS[15]
    // (runs.sessionBornAt/sessionBornFor, child-reclamation spec §5.1, §5.3)
    // MIGRATIONS[16] (stall_settings and run_events_by_at, stall watch
    // settings §8) and MIGRATIONS[17] (dead_claimants); the migration above is
    // still entry 11.
    expect(COORD_SCHEMA_VERSION).toBe(18);
    const row = db.prepare('SELECT kind, reviews FROM runs').get() as { kind: string; reviews: number | null };
    expect(row).toEqual({ kind: 'work', reviews: null });
    db.close();
  });
});

describe('coord.db: dead_claimants, the dead-coordinator lane’s durable anchor (workspace lifecycle §5.4)', () => {
  /** This entry's slot, found by its DDL and never hard-coded (the rule the stall-watch settings entry's case states):
   *  whichever of two branches holding one slot merges second moves up, and that renumber must not edit a line here. */
  const SLOT = MIGRATIONS.findIndex((m) => m.includes('dead_claimants')) + 1;
  interface ColumnInfo { name: string; type: string; notnull: number; pk: number }
  it('a NEW TABLE and nothing else: three columns, the claimant its key — no column on an older build’s tables', () => {
    expect(SLOT, 'no MIGRATIONS entry creates dead_claimants').toBeGreaterThanOrEqual(18);
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const cols = (db.prepare("SELECT name, type, \"notnull\", pk FROM pragma_table_info('dead_claimants')").all() as unknown as ColumnInfo[])
      .map((c) => [c.name, c.type, c.notnull, c.pk]);
    expect(cols).toEqual([['claimantId', 'TEXT', 1, 1], ['firstDeadAt', 'INTEGER', 1, 0], ['lastDeadAt', 'INTEGER', 1, 0]]);
    expect(MIGRATIONS[SLOT - 1]!.replace(/--[^\n]*/g, '').trim(), 'the migration CREATEs one table and alters nothing')
      .toMatch(/^CREATE TABLE dead_claimants \([^;]*\);$/);
    db.close();
  });

  it('reaches a database ALREADY at the version before it and leaves every existing row as it was', () => {
    expect(SLOT, 'no MIGRATIONS entry creates dead_claimants').toBeGreaterThanOrEqual(18);
    const p = dbPathIn(mkTmp('ccrc-coord-'));
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
      raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
      raw.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('p', 'P', 1, 'active')");
      raw.exec("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('p', 1, 1, 'demo', 'working', 'c', 1)");
    });
    raw.close();
    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(COORD_SCHEMA_VERSION);
    expect(db.prepare('SELECT count(*) AS n FROM dead_claimants').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT claimedBy, state FROM runs').get()).toEqual({ claimedBy: 'c', state: 'working' });
````

<!-- replay: create server/test/dead-coordinator-store.test.ts -->
Create `server/test/dead-coordinator-store.test.ts`:

````ts
// The dead-coordinator lane's STORE half (workspace lifecycle spec 2026-09-24 §5.4, wave 4): the durable first-dead
// anchor (`dead_claimants`, migration 18 — "the hour is the lane's own observation, made durable"), the journal
// clause's ONE read of the lifecycle mirror, and `closeRun`'s compare-and-set: the transaction commits only while
// `claimedBy` still names the crashed id.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { parseJournalLine, type JournalRow } from '../src/coord/journalparse.js';
import { mkTmp } from './tmpHelpers.js';

const dbPath = (): string => path.join(mkTmp('ccrc-dead-store-'), '.ccrc', 'coord.db');
const GEN = '1790000000000000000';
const T = 1_790_000_000_000;
let seq = 0;
const line = (id: string, act: string, outcome: string, over: Record<string, unknown> = {}): JournalRow =>
  parseJournalLine(JSON.stringify({ v: 1, uid: `w4dc.1.${++seq}`, at: T + seq, act, outcome, id, dec: { surface: 'none' }, ...over }));

describe('the durable first-dead anchor (migration 18)', () => {
  it('starts empty; a row is written, moved and deleted by the claimant id', () => {
    const s = new CoordStore(openCoordDb(dbPath()));
    expect(s.deadAnchors()).toEqual({ ok: true, anchors: new Map() });
    s.setDeadAnchor('demo-c-a', { firstDeadAt: 10, lastDeadAt: 10 });
    s.setDeadAnchor('demo-c-a', { firstDeadAt: 10, lastDeadAt: 70 });
    s.setDeadAnchor('demo-c-b', { firstDeadAt: 20, lastDeadAt: 20 });
    expect(s.deadAnchors()).toEqual({ ok: true, anchors: new Map([
      ['demo-c-a', { firstDeadAt: 10, lastDeadAt: 70 }], ['demo-c-b', { firstDeadAt: 20, lastDeadAt: 20 }]]) });
    s.deleteDeadAnchor('demo-c-a');
    s.deleteDeadAnchor('demo-never-there');
    expect(s.deadAnchors()).toEqual({ ok: true, anchors: new Map([['demo-c-b', { firstDeadAt: 20, lastDeadAt: 20 }]]) });
  });

  it('survives a reopen — the hour is durable across a restart', () => {
    const p = dbPath();
    const a = openCoordDb(p);
    new CoordStore(a).setDeadAnchor('demo-c-a', { firstDeadAt: 10, lastDeadAt: 70 });
    a.close();
    expect(new CoordStore(openCoordDb(p)).deadAnchors())
      .toEqual({ ok: true, anchors: new Map([['demo-c-a', { firstDeadAt: 10, lastDeadAt: 70 }]]) });
  });

  it('a row whose integers this process cannot represent fails the WHOLE read — never a partial map', () => {
    const db = openCoordDb(dbPath());
    const s = new CoordStore(db);
    s.setDeadAnchor('demo-c-a', { firstDeadAt: 10, lastDeadAt: 10 });
    db.exec("INSERT INTO dead_claimants (claimantId, firstDeadAt, lastDeadAt) VALUES ('demo-c-b', 'soon', 20)");
    expect(s.deadAnchors()).toMatchObject({ ok: false });
  });
});

describe('the journal clause’s ONE read of the mirror', () => {
  it('answers every asked id: the clause’s acts oldest first, and whether the mirror holds ANY row for it', () => {
    const s = new CoordStore(openCoordDb(dbPath()));
    s.ingestJournal({ gen: GEN, cursor: 900, size: 900, at: 9, rows: [
      line('demo-c-a', 'create', 'done'),
      line('demo-c-a', 'start', 'done'),
      line('demo-c-a', 'spawn', 'done', { meas: { rc: '0', wrapper: 'claude' } }),
      line('demo-c-a', 'hold', 'done'),
      line('demo-c-a', 'stop', 'done', { dec: { surface: 'pwa' } }),
      line('demo-c-a', 'swap', 'done'),
      line('demo-c-b', 'create', 'done'),
    ] });
    const r = s.deadCoordinatorJournalRows(['demo-c-a', 'demo-c-b', 'demo-c-c']);
    expect([...r.keys()].sort()).toEqual(['demo-c-a', 'demo-c-b', 'demo-c-c']);
    expect(r.get('demo-c-a')!.rows.map((x) => x.act)).toEqual(['spawn', 'stop']);
    expect(r.get('demo-c-a')!.rows[0]!.raw, 'the line verbatim — ccd wrote the rc as a string').toContain('"rc":"0"');
    expect(r.get('demo-c-a')!.rows[0]!.gen, 'the generation it was read from, which places a gap before or after it').toBe(GEN);
    expect(r.get('demo-c-a')!.rows[1]!.dec?.surface).toBe('pwa');
    expect(r.get('demo-c-a')!.hasHistory).toBe(true);
    expect(r.get('demo-c-b')).toEqual({ rows: [], hasHistory: true });
    expect(r.get('demo-c-c')).toEqual({ rows: [], hasHistory: false });
  });

  it('asks nothing of an empty list', () => {
    expect(new CoordStore(openCoordDb(dbPath())).deadCoordinatorJournalRows([])).toEqual(new Map());
  });

  it('names EVERY generation the mirror recorded lost bytes in, once each, unlimited — the journal trust’s read', () => {
    const s = new CoordStore(openCoordDb(dbPath()));
    expect(s.lifecycleGapGens()).toEqual([]);
    const gap = (gen: string, reason: 'shrank' | 'rotated-away' | 'unknown') => s.recordGap({ at: T, gen, reason,
      detail: 'd', lostFrom: reason === 'unknown' ? null : 0, lostTo: reason === 'unknown' ? null : 10 });
    for (let k = 0; k < 120; k += 1) gap(GEN, 'shrank');
    gap('1780000000000000000', 'rotated-away');
    gap('lifecycle.unplaceable.jsonl', 'unknown');
    expect(s.lifecycleGapGens().sort()).toEqual(['1780000000000000000', GEN, 'lifecycle.unplaceable.jsonl']);
  });
});

describe('closeRun’s compare-and-set — commits only while claimedBy names the crashed id', () => {
  const opened = () => {
    const s = new CoordStore(openCoordDb(dbPath()));
    const r = s.openRun({ program: 'p', title: 'p', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-c-a' });
    if (!('id' in r)) throw new Error('openRun refused');
    s.markDispatched(r.id, 'demo-w', 'demo-w', 'ws/w', false);
    if (!s.advance(r.id, 'dispatched', 'test').ok) throw new Error('advance refused');
    return { s, id: r.id };
  };

  it('the claimant still the crashed id: the close commits', () => {
    const { s, id } = opened();
    expect(s.closeRun({ runId: id, finalState: 'failed', causedBy: 'sweep', handoffCommit: null, program: 'p',
      viaClosing: true, expectClaimedBy: 'demo-c-a' })).toMatchObject({ ok: true, to: 'failed' });
  });

  it('a successor took the programme: claimant-changed, and NOTHING moved — no state, no event, no cancelled mail', () => {
    const { s, id } = opened();
    expect(s.reclaimProgram(id, 'demo-heir', T, null)).toMatchObject({ ok: true });
    const before = s.runEvents(id).length;
    expect(s.closeRun({ runId: id, finalState: 'failed', causedBy: 'sweep', handoffCommit: null, program: 'p',
      viaClosing: true, expectClaimedBy: 'demo-c-a' })).toEqual({ ok: false, error: 'claimant-changed', claimedBy: 'demo-heir' });
    const after = s.run(id);
    expect(after.ok && after.run?.state).toBe('dispatched');
    expect(s.runEvents(id).length).toBe(before);
  });

  it('without an expectation the close is what it always was', () => {
    const { s, id } = opened();
    expect(s.reclaimProgram(id, 'demo-heir', T, null)).toMatchObject({ ok: true });
    expect(s.closeRun({ runId: id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program: 'p',
      viaClosing: true })).toMatchObject({ ok: true, to: 'failed' });
  });
});
````


- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/asks-store.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-store.test.ts --maxWorkers=1 )
```

Measured: `coord-db.test.ts`: `4 failed | 69 passed (73)` — × COORD_SCHEMA_VERSION derives to 18 — never hand-edited beside a growing array; × reaches a database ALREADY at user_version 10 and reads every existing row as a work run; × a NEW TABLE and nothing else: three columns, the claimant its key — no column on an older build’s tables; × reaches a database ALREADY at the version before it and leaves every existing row as it was; `asks-store.test.ts`: `1 failed | 27 passed (28)` — × the cross-repo columns added at schema version 10 are still present at the current version; `dead-coordinator-store.test.ts`: `7 failed | 2 passed (9)` — × starts empty; a row is written, moved and deleted by the claimant id; × survives a reopen — the hour is durable across a restart; × a row whose integers this process cannot represent fails the WHOLE read — never a partial map; × answers every asked id: the clause’s acts oldest first, and whether the mirror holds ANY row for it; × asks nothing of an empty list; × names EVERY generation the mirror recorded lost bytes in, once each, unlimited — the journal trust’s read; × a successor took the programme: claimant-changed, and NOTHING moved — no state, no event, no cancelled mail — the two CAS cases that expect a commit are green by design (a store that ignores the field also commits).

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/coord/schema.ts -->
In `server/src/coord/schema.ts`, find:

````ts
  `,
];
````

Replace with:

````ts
  `,
  // ── 18: user_version 17 -> 18 ─────────────────────────────────────────────
  // The dead-coordinator lane's DURABLE first-dead anchor (workspace lifecycle spec 2026-09-24 §5.4, "The hour is the
  // lane's own observation, made durable"): one row per claimant the lane last measured CRASHED — `firstDeadAt`, the
  // first pass of the episode, and `lastDeadAt`, the latest — written on a crashed pass and deleted on any alive,
  // unmeasurable or non-crash answer (`CoordStore.setDeadAnchor`/`deleteDeadAnchor`, the table's one writer pair).
  // Epoch ms, the server's clock. The table survives restarts; `.supervised`'s stamp may only RAISE the anchor
  // (`deadCoordinatorSince`).
  //
  // A NEW TABLE AND NOTHING ELSE, and that is the choice that keeps a ROLLBACK bootable — `ccrc-update-watchdog` can
  // roll a server box back with no human in the loop. MEASURED against `origin/main`'s own `db.ts` (wave 4's plan,
  // Pre-flight): an older build opening a file at `user_version 18` takes rule 3 — it warns, reads as-is, migrates
  // nothing, and its runs, mail, claims and ledger reads and writes work unchanged, because it never names this table
  // and every read names its columns. An `ALTER TABLE runs ADD COLUMN … NOT NULL` would have been the dangerous shape:
  // an older build's `INSERT INTO runs` names no such column. What the older build cannot do is keep the anchors, so
  // rows it leaves behind are an episode nobody measured — which is why `lastDeadAt` rides beside `firstDeadAt`, and
  // the lane restarts an episode whose last crashed pass is older than `DEAD_COORDINATOR_GAP_MS` (the departure
  // `dead-anchor-restarts-after-an-unobserved-gap`).
  //
  // MIGRATIONS[0..16] are frozen: `db.ts` iterates from the live `user_version`, so an edit to an applied entry never
  // runs. THIS ENTRY WAS SLOT 17 WHEN ITS PLAN WAS WRITTEN. Stall-watch-settings W1 (#320) merged first and took
  // `user_version 16 -> 17`, so this one moved up a slot rather than sharing an index, as entry 12 did before it.
  // RE-MEASURE immediately before the PR and before merge:
  //     git fetch origin main
  //     git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'
  `
  CREATE TABLE dead_claimants (claimantId TEXT NOT NULL PRIMARY KEY, firstDeadAt INTEGER NOT NULL, lastDeadAt INTEGER NOT NULL);
  `,
];
````

<!-- replay: replace server/src/coord/store.ts -->
In `server/src/coord/store.ts`, find:

````ts
import { reviveDec, reviveMeas, reviveObs, type JournalRow } from './journalparse.js';
````

Replace with:

````ts
import { reviveDec, reviveMeas, reviveObs, type JournalRow } from './journalparse.js';
import {
  DEAD_COORDINATOR_JOURNAL_ACTS, type DeadAnchor, type DeadCoordinatorJournalRow,
} from '../deadCoordinator.js';
````

<!-- replay: replace server/src/coord/store.ts -->
In `server/src/coord/store.ts`, find:

````ts
  | { ok: false; error: 'unknown-run' };
````

Replace with:

````ts
  | { ok: false; error: 'unknown-run' }
  /** `closeRun`'s compare-and-set (workspace lifecycle spec 2026-09-24 §5.4, "No successor"): the run's `claimedBy`
   *  is no longer the id the caller expected — a successor took the programme — so nothing was written. */
  | { ok: false; error: 'claimant-changed'; claimedBy: string | null };
````

<!-- replay: replace server/src/coord/store.ts -->
In `server/src/coord/store.ts`, find:

````ts
    handoffCommit: string | null; program: string; viaClosing: boolean;
  }): AdvanceResult {
    return tx(this.db, () => {
````

Replace with:

````ts
    handoffCommit: string | null; program: string; viaClosing: boolean;
    /** THE COMPARE-AND-SET (workspace lifecycle spec 2026-09-24 §5.4, "No successor"): when given, the close commits
     *  only while the run's `claimedBy` still equals it, read INSIDE this transaction; otherwise `claimant-changed`
     *  and nothing is written. The dead-coordinator lane passes the crashed id; every other caller passes nothing. */
    expectClaimedBy?: string;
  }): AdvanceResult {
    return tx(this.db, () => {
      if (input.expectClaimedBy !== undefined) {
        const row = this.db.prepare('SELECT claimedBy FROM runs WHERE id = ?').get(input.runId) as
          { claimedBy: string | null } | undefined;
        if (row === undefined) return { ok: false, error: 'unknown-run' };
        if (row.claimedBy !== input.expectClaimedBy) return { ok: false, error: 'claimant-changed', claimedBy: row.claimedBy };
      }
````

<!-- replay: replace server/src/coord/store.ts -->
In `server/src/coord/store.ts`, find:

````ts
    ).all() as { claimedBy: string }[]).map((r) => r.claimedBy);
````

Replace with:

````ts
    ).all() as { claimedBy: string }[]).map((r) => r.claimedBy);
  }

  /** The dead-coordinator lane's durable anchors (`dead_claimants`, migration 18; workspace lifecycle spec §5.4) —
   *  EVERY row, one statement. Both integers ride CAST to TEXT and are proven, ALL-OR-FAILURE (D-2545's rule): an
   *  anchor misread is how an hour gets counted that nobody measured, so one bad row fails the read and the lane acts
   *  on nothing that pass. */
  deadAnchors(): { ok: true; anchors: Map<string, DeadAnchor> } | { ok: false; detail: string } {
    const rows = this.db.prepare(
      'SELECT claimantId, CAST(firstDeadAt AS TEXT) AS firstText, CAST(lastDeadAt AS TEXT) AS lastText FROM dead_claimants',
    ).all() as unknown as { claimantId: string; firstText: string; lastText: string }[];
    const anchors = new Map<string, DeadAnchor>();
    for (const r of rows) {
      const first = persistedInt(r.firstText, 'firstDeadAt');
      if (!first.ok) return { ok: false, detail: first.detail };
      const last = persistedInt(r.lastText, 'lastDeadAt');
      if (!last.ok) return { ok: false, detail: last.detail };
      anchors.set(r.claimantId, { firstDeadAt: first.value, lastDeadAt: last.value });
    }
    return { ok: true, anchors };
  }

  /** Write one claimant's anchor — the lane's crashed pass. One statement, an upsert keyed by the claimant. */
  setDeadAnchor(claimantId: string, a: DeadAnchor): void {
    this.db.prepare(
      'INSERT INTO dead_claimants (claimantId, firstDeadAt, lastDeadAt) VALUES (?, ?, ?) ' +
      'ON CONFLICT(claimantId) DO UPDATE SET firstDeadAt = excluded.firstDeadAt, lastDeadAt = excluded.lastDeadAt',
    ).run(claimantId, a.firstDeadAt, a.lastDeadAt);
  }

  /** Delete one claimant's anchor — an alive, unmeasurable or non-crash answer, or a claimant that left the
   *  population. Deleting a row that is not there is a no-op. */
  deleteDeadAnchor(claimantId: string): void {
    this.db.prepare('DELETE FROM dead_claimants WHERE claimantId = ?').run(claimantId);
````

<!-- replay: replace server/src/coord/store.ts -->
In `server/src/coord/store.ts`, find:

````ts

  /** The holes, newest-first — a timeline with a hole in it says so. */
````

Replace with:

````ts

  /** THE JOURNAL CLAUSE'S ONE READ (workspace lifecycle spec 2026-09-24 §5.4, the dead-coordinator lane): for each
   *  asked claimant, its rows of the acts the clause reads (`DEAD_COORDINATOR_JOURNAL_ACTS`), oldest first by this
   *  table's own id, and whether the mirror holds ANY row for it — "no history at all" is a fact the clause turns on
   *  (an absent row with none is unmeasured), and it is not the same fact as "none of the clause's acts". TWO
   *  statements whatever the claimant count, each `INDEXED BY lifecycle_by_session` (`recentProvenance`'s idiom: the
   *  table is never pruned). EVERY asked id gets an entry. A failing read THROWS, and the lane reads that as
   *  `unreadable` — never as no history. */
  deadCoordinatorJournalRows(sessionIds: readonly string[]): Map<string, { rows: DeadCoordinatorJournalRow[]; hasHistory: boolean }> {
    const ids = [...new Set(sessionIds)];
    const out = new Map<string, { rows: DeadCoordinatorJournalRow[]; hasHistory: boolean }>(
      ids.map((id) => [id, { rows: [], hasHistory: false }]));
    if (ids.length === 0) return out;
    const rows = this.db.prepare(
      `SELECT ${CoordStore.LC_COLS} FROM lifecycle_events INDEXED BY lifecycle_by_session ` +
      `WHERE sessionId IN (${placeholders(ids.length)}) AND act IN (${placeholders(DEAD_COORDINATOR_JOURNAL_ACTS.length)}) ` +
      'ORDER BY sessionId, id',
    ).all(...ids, ...DEAD_COORDINATOR_JOURNAL_ACTS) as unknown as Parameters<typeof CoordStore.reviveLifecycleRow>[0][];
    for (const r of rows) {
      const e = r.sessionId === null ? undefined : out.get(r.sessionId);
      if (e === undefined) continue;
      const ev = CoordStore.reviveLifecycleRow(r);
      e.rows.push({ act: ev.act, outcome: ev.outcome, at: ev.at, gen: ev.gen, dec: ev.dec, meas: ev.meas, raw: ev.raw });
    }
    const any = this.db.prepare(
      'SELECT DISTINCT sessionId FROM lifecycle_events INDEXED BY lifecycle_by_session ' +
      `WHERE sessionId IN (${placeholders(ids.length)})`,
    ).all(...ids) as { sessionId: string }[];
    for (const r of any) { const e = out.get(r.sessionId); if (e !== undefined) e.hasHistory = true; }
    return out;
  }

  /** EVERY generation the mirror recorded lost bytes in, distinct, one statement — the dead-coordinator lane's journal
   *  trust (workspace lifecycle spec §5.4, the departure `journal-loss-reads-as-unmeasured`): a gap in a generation
   *  that is not older than a claimant's last successful spawn may have lost a deliberate act. Never limited: a gap
   *  the read did not return is a gap the lane would trust past. A failing read THROWS, and the lane trusts nothing. */
  lifecycleGapGens(): string[] {
    return (this.db.prepare('SELECT DISTINCT gen FROM lifecycle_gaps').all() as { gen: string }[]).map((r) => r.gen);
  }

  /** The holes, newest-first — a timeline with a hole in it says so. */
````


- [ ] **Step 4: Run — green**, and the update store's writer-group scan (it reads `store.ts`'s SQL):

```bash
( cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/asks-store.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-store.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/update-writer-groups.test.ts --maxWorkers=1 )
```

Measured: `coord-db.test.ts`: `73 passed (73)`; `asks-store.test.ts`: `28 passed (28)`; `dead-coordinator-store.test.ts`: `9 passed (9)`; `update-writer-groups.test.ts`: `20 passed (20)`

- [ ] **Step 5: Mutation check, then commit.** Row T8.6 is the shape refused: a column on `runs` in the same migration reds the one-table pin.

| # | Edit (restore after) | Measured red |
|---|---|---|
| T8.1 | `server/src/coord/store.ts`: `        if (row.claimedBy !== input.expectClaimedBy) return { ok: false, error: 'claimant-changed', claimedBy: row.claimedBy }; ⏎ ` → (removed) | `dead-coordinator-store.test.ts`: `1 failed \| 8 passed (9)` — a successor took the programme: claimant-changed, and NOTHING moved — no state, no event, no cancelled mail |
| T8.2 | `server/src/coord/store.ts`: `      if (!first.ok) return { ok: false, detail: first.detail };` → `      if (!first.ok) continue;` | `dead-coordinator-store.test.ts`: `1 failed \| 8 passed (9)` — a row whose integers this process cannot represent fails the WHOLE read — never a partial map |
| T8.3 | `server/src/coord/store.ts`: `    for (const r of any) { const e = out.get(r.sessionId); if (e !== undefined) e.hasHistory = true; } ⏎ ` → (removed) | `dead-coordinator-store.test.ts`: `1 failed \| 8 passed (9)` — answers every asked id: the clause’s acts oldest first, and whether the mirror holds ANY row for it |
| T8.4 | `server/src/coord/store.ts`: ``      `WHERE sessionId IN (${placeholders(ids.length)}) AND act IN (${placeholders(DEAD_COORDINATOR_JOURNAL_ACTS.length)}) ` + ⏎       'ORDER BY sessionId, id', ⏎     ).all(...ids, ...DEAD_COORDINATOR_JOURNAL_ACTS)`` → ``      `WHERE sessionId IN (${placeholders(ids.length)}) ` + ⏎       'ORDER BY sessionId, id', ⏎     ).all(...ids)`` | `dead-coordinator-store.test.ts`: `1 failed \| 8 passed (9)` — answers every asked id: the clause’s acts oldest first, and whether the mirror holds ANY row for it |
| T8.5 | `server/src/coord/schema.ts`: `  CREATE TABLE dead_claimants (claimantId TEXT NOT NULL PRIMARY KEY, firstDeadAt INTEGER NOT NULL, lastDeadAt INTEGER NOT NULL);` → `  CREATE TABLE dead_claimants (claimantId TEXT, firstDeadAt INTEGER NOT NULL, lastDeadAt INTEGER NOT NULL);` | `coord-db.test.ts`: `1 failed \| 72 passed (73)` — a NEW TABLE and nothing else: three columns, the claimant its key — no column on an older build’s tables<br>`dead-coordinator-store.test.ts`: `3 failed \| 6 passed (9)` — starts empty; a row is written, moved and deleted by the claimant id; survives a reopen — the hour is durable across a restart; a row whose integers this process cannot represent fails the WHOLE read — never a partial map |
| T8.6 | `server/src/coord/schema.ts`: `  CREATE TABLE dead_claimants (claimantId TEXT NOT NULL PRIMARY KEY, firstDeadAt INTEGER NOT NULL, lastDeadAt INTEGER NOT NULL);` → `  CREATE TABLE dead_claimants (claimantId TEXT NOT NULL PRIMARY KEY, firstDeadAt INTEGER NOT NULL, lastDeadAt INTEGER NOT NULL); ⏎   ALTER TABLE runs ADD COLUMN deadSince INTEGER;` | `coord-db.test.ts`: `1 failed \| 72 passed (73)` — a NEW TABLE and nothing else: three columns, the claimant its key — no column on an older build’s tables |
| T8.7 | `server/src/coord/store.ts`: `    return (this.db.prepare('SELECT DISTINCT gen FROM lifecycle_gaps').all() as { gen: string }[]).map((r) => r.gen);` → `    return (this.db.prepare('SELECT DISTINCT gen FROM lifecycle_gaps ORDER BY id DESC LIMIT 1').all() as { gen: string }[]).map((r) => r.gen);` | `dead-coordinator-store.test.ts`: `1 failed \| 8 passed (9)` — names EVERY generation the mirror recorded lost bytes in, once each, unlimited — the journal trust’s read |
| T8.8 | `server/src/coord/store.ts`: `at: ev.at, gen: ev.gen, dec:` → `at: ev.at, gen: '', dec:` | `dead-coordinator-store.test.ts`: `1 failed \| 8 passed (9)` — answers every asked id: the clause’s acts oldest first, and whether the mirror holds ANY row for it |

```bash
git add server/src/coord/schema.ts server/src/coord/store.ts server/test/dead-coordinator-store.test.ts \
  server/test/coord-db.test.ts server/test/asks-store.test.ts
git commit -m "$(cat <<'MSG'
feat(coord): the dead-coordinator anchor, the journal read, the close's compare-and-set

Migration 18 adds dead_claimants and nothing else, so a rolled-back build
boots on it (measured against main's own db.ts). The anchors are read
all-or-failure. The journal clause's one read answers the clause's acts, their
generations and whether the mirror holds any history; the gap read names every
generation the mirror lost bytes in. closeRun commits only while claimedBy
still names the id the caller expects, read inside its transaction.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: The sweep's abandon — `causedBy: 'sweep'`, the in-arm re-measure and the first compare-and-set half, the serialiser's handle; landing pinned

**Model routing:** `opus`, effort `high` — the door a destructive lane goes through.

**Files:** `server/src/coord/close.ts`, `server/src/coord/routes.ts`; create `server/test/sweep-close.test.ts`.

**Interfaces (Produces):**
- `export type CloseCause = 'coordinator' | 'operator' | 'sweep'`.
- `export interface SweepCloseGuard { claimedBy: string; stillCrashed: () => Promise<DeadCoordinatorStop | null> }`.
- `closeRun` overloads: `(deps, id, body, causedBy: 'coordinator' | 'operator')` and `(deps, id, body, causedBy: 'sweep', sweep: SweepCloseGuard)` — the sweep cannot reach the arm without its compare-and-set and its re-measure; under `'sweep'` any body but `{ intent: 'abandon' }` is `bad-request` before anything is read.
- THE SWEEP'S GATE, inside the abandon arm IMMEDIATELY BEFORE the fleet act (or before the commit, for a run with no workspace): `stillCrashed()` — any stop is `{ ok: false, kind: 'sweep-stopped', stop, released: false }` and nothing is composed — then the compare-and-set's first half on a FRESH read of the run (`claimant-changed`). AFTER the fleet act, before the commit, `stillCrashed()` once more: a stop there is `sweep-stopped` with `released: true` and the run stays open. Then the store's half (`expectClaimedBy`), mapped to the same `claimant-changed`. The operator's abandon has no guard and asks nothing. The residual, stated in the code: a revive inside the second re-measure's round trip, and a `claimedBy` writer outside the serialiser during the release (none exists in this build) — each leaves that worker released and unheld.
- `CoordRoutesHandle.withSweepAbandon(coord, fn)` — the SAME `coordMutex` hold as `withAbandon`, handing `fn` `(runId, crashedId, stillCrashed) => closeRun(<withAbandon's deps, the reclaim port included>, runId, { intent: 'abandon' }, 'sweep', { claimedBy: crashedId, stillCrashed })`. `sendCloseOutcome` maps `claimant-changed` and `sweep-stopped` to 409 so its switch stays total (no route produces them).

- [ ] **Step 1: The tests (red).** Four cases are green by design: the first (before this task `closeRun` already writes whatever word it is handed — the sweep's word through the HANDLE is row T9.4's red), the operator's abandon that asks no re-measure, and the two landing cases (they pin what is already true, Pre-flight finding 4 — the second drives the watcher's own `sweepLanding` over the fixture store, a dequeued PR on the workspace whose run the operator, or the sweep, failed; row T9.11 is its red: a `sweepLanding` that reads `causedBy`).

<!-- replay: create server/test/sweep-close.test.ts -->
Create `server/test/sweep-close.test.ts`:

````ts
// `closeRun`'s abandon arm as the DEAD-COORDINATOR LANE runs it (workspace lifecycle spec 2026-09-24 §5.4, "No
// successor" and "The act"): `causedBy: 'sweep'` — a third attribution word, so the run event never reads as the
// operator's — the lane's re-measure, run immediately before the fleet act and again after it, and the compare-and-set
// on `claimedBy`, checked before the fleet act and again inside the commit's transaction; then the serialiser's handle
// that is the lane's only way in, and the landing lane's reading of a run the sweep failed — as a pure verdict and as
// the watcher's own lane. `closeRun` is called directly here, and through `registerCoordRoutes`' handle.
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { closeRun, type CloseRunDeps, type SweepCloseGuard } from '../src/coord/close.js';
import { FleetWatcher } from '../src/watch.js';
import { readRegistry } from '../src/registry.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { survivorOf } from '../src/coord/rundefs.js';
import { landingAsk, landingVerdict } from '../src/coord/landing.js';
import type { ChildReclaimRequest } from '../src/coord/childReclaim.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const CRASHED = 'demo-coord-crashed';
const HEIR = 'demo-coord-heir';
const W = 'demo-quiet-basin';
/** The lane's guard with a re-measure that still reads the claimant crashed. */
const STILL: SweepCloseGuard = { claimedBy: CRASHED, stillCrashed: async () => null };

const build = (onVerb?: (verb: string) => void) => {
  const home = mkTmp('ccrc-sweep-close-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    onVerb?.(args[0] ?? '');
    return { code: 0, stdout: '', stderr: '' };
  };
  const base = testDeps(home, run);
  const handed: ChildReclaimRequest[] = [];
  const deps: CloseRunDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd, childReclaim: (req) => { handed.push(req); } };
  const seed = (session: string, mark: string | null): void => {
    const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/${session}`,
      uuid: `u-${session}`, started: '1', workspace: session, branch: `ws/${session}`, base: 'origin/main' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${session}.${k}`), v);
    if (mark !== null) writeFileSync(path.join(reg, `${session}.child`), mark);
  };
  /** A work run claimed by the crashed coordinator, dispatched into `W` (a marked child of it) and working. */
  const working = (): number => {
    const r = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 3, claimedBy: CRASHED });
    if (!('id' in r)) throw new Error('openRun refused');
    coord.markDispatched(r.id, W, W, `ws/${W}`, false);
    for (const to of ['dispatched', 'working'] as const) expect(coord.advance(r.id, to, 'coordinator').ok).toBe(true);
    seed(W, String(r.id));
    return r.id;
  };
  return { home, coord, deps, base, calls, handed, working, verbs: () => calls.map((c) => c[0]) };
};

describe('closeRun’s abandon arm, as the sweep runs it', () => {
  it('closes the run failed, and its events say the SWEEP did it — never the operator; the child goes to the reclaim port', async () => {
    const b = build();
    const id = b.working();
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', STILL))
      .toEqual({ ok: true, id, state: 'failed', released: true, childReclaim: 'queued' });
    expect(b.coord.runEvents(id).slice(-2).map((e) => [e.toState, e.causedBy])).toEqual([['closing', 'sweep'], ['failed', 'sweep']]);
    expect(b.verbs()).toEqual(['ws-release']);
    expect(b.handed.map((h) => [h.sessionId, h.runId, h.trigger])).toEqual([[W, id, 'close']]);
  });

  it('the compare-and-set, before the fleet act: a claimant that is no longer the crashed id refuses and composes NOTHING', async () => {
    const b = build();
    const id = b.working();
    expect(b.coord.reclaimProgram(id, HEIR, 1, null)).toMatchObject({ ok: true });
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', STILL))
      .toEqual({ ok: false, kind: 'claimant-changed', claimedBy: HEIR });
    expect(b.calls, 'no release: a successor’s worker keeps its hold').toEqual([]);
    expect(okRun(b.coord.run(id))!.state).toBe('working');
  });

  it('the compare-and-set, inside the commit: a successor that lands DURING the fleet act is refused there', async () => {
    let id = 0;
    const b = build((verb) => { if (verb === 'ws-release') expect(b.coord.reclaimProgram(id, HEIR, 1, null)).toMatchObject({ ok: true }); });
    id = b.working();
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', STILL))
      .toEqual({ ok: false, kind: 'claimant-changed', claimedBy: HEIR });
    expect(okRun(b.coord.run(id))!.state, 'the run stays open under its successor').toBe('working');
    expect(b.handed, 'nothing closed, so nothing is reclaimed').toEqual([]);
  });

  it('THE RE-MEASURE, before the fleet act: a claimant that is no longer crashed — a revive of the SAME id — stops it, and NOTHING is composed', async () => {
    const b = build();
    const id = b.working();
    let asked = 0;
    const revived: SweepCloseGuard = { claimedBy: CRASHED,
      stillCrashed: async () => { asked += 1; return { kind: 'remeasured', why: 're-measured alive: tmux reports the pane live' }; } };
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', revived)).toEqual({ ok: false, kind: 'sweep-stopped',
      stop: { kind: 'remeasured', why: 're-measured alive: tmux reports the pane live' }, released: false });
    expect(asked).toBe(1);
    expect(b.calls, 'no release: the revived coordinator’s worker keeps its hold').toEqual([]);
    expect(okRun(b.coord.run(id))!.state).toBe('working');
    expect(b.handed).toEqual([]);
  });

  it('THE RE-MEASURE, after the fleet act and before the commit: a revive DURING the release keeps the run open', async () => {
    let released = false;
    const b = build((verb) => { if (verb === 'ws-release') released = true; });
    const id = b.working();
    const guard: SweepCloseGuard = { claimedBy: CRASHED,
      stillCrashed: async () => (released ? { kind: 'remeasured', why: 're-measured alive' } : null) };
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', guard)).toEqual({ ok: false, kind: 'sweep-stopped',
      stop: { kind: 'remeasured', why: 're-measured alive' }, released: true });
    expect(okRun(b.coord.run(id))!.state, 'the run stays open under its revived coordinator').toBe('working');
    expect(b.handed, 'nothing closed, so nothing is reclaimed').toEqual([]);
  });

  it('the operator’s abandon never asks a re-measure: it has no guard', async () => {
    const b = build();
    const id = b.working();
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator')).toMatchObject({ ok: true, state: 'failed' });
  });

  it('the sweep only ever abandons: any other body is refused before anything is read', async () => {
    const b = build();
    const id = b.working();
    // A body the ORDINARY close would accept and act on (a failed close skips `verifyDone`, D-49).
    const failedClose = { fingerprint: { branchTip: 'x', prNumber: null, prPhase: 'open', handoffCommit: 'x' }, final: false, state: 'failed' };
    expect(await closeRun(b.deps, id, failedClose, 'sweep', STILL)).toEqual({ ok: false, kind: 'bad-request' });
    expect(b.calls).toEqual([]);
  });
});

describe('the coordination serialiser’s sweep handle (`registerCoordRoutes`)', () => {
  const routes = (b: ReturnType<typeof build>) =>
    registerCoordRoutes(Fastify({ logger: false }), { ...b.base, coord: b.coord }, new Bus(), undefined,
      { tmux: b.base.tmux, queue: b.base.queue, readAsk: async () => null });

  it('runs the abandon arm with causedBy sweep and the compare-and-set, and wires the reclaim port as the abandon route does', async () => {
    const b = build();
    const id = b.working();
    const h = routes(b);
    expect(await h.withSweepAbandon(b.coord, (abandon) => abandon(id, CRASHED, STILL.stillCrashed)))
      .toEqual({ ok: true, id, state: 'failed', released: true, childReclaim: 'queued' });
    expect(b.coord.runEvents(id).at(-1)?.causedBy).toBe('sweep');
    const other = build();
    const id2 = other.working();
    expect(await routes(other).withSweepAbandon(other.coord, (abandon) => abandon(id2, 'demo-someone-else', STILL.stillCrashed)))
      .toMatchObject({ ok: false, kind: 'claimant-changed', claimedBy: CRASHED });
    const third = build();
    const id3 = third.working();
    expect(await routes(third).withSweepAbandon(third.coord, (abandon) => abandon(id3, CRASHED,
      async () => ({ kind: 'switch', why: 'reclaim-paused was raised during the act' }))))
      .toMatchObject({ ok: false, kind: 'sweep-stopped', released: false });
    expect(third.calls, 'the handle hands the re-measure to the arm').toEqual([]);
  });

  it('is the SAME hold as the operator’s doors: a sweep waits for an abandon already running', async () => {
    const b = build();
    const h = routes(b);
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = h.withAbandon(b.coord, async () => { order.push('operator:start'); await gate; order.push('operator:end'); });
    const second = h.withSweepAbandon(b.coord, async () => { order.push('sweep'); });
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(['operator:start']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['operator:start', 'operator:end', 'sweep']);
  });
});

describe('landing reads a sweep-failed run as it reads an operator abandon (spec §6, the Landing-order bullet)', () => {
  // MEASURED: `coord/landing.ts` and `sweepLanding` never read `causedBy` — a notice is told to the coordinator of the
  // workspace's surviving OPEN run (`openRunsForSession` → `survivorOf`), so a run the sweep failed and a run the
  // operator abandoned leave the same facts. Pinned, so a later reading of `causedBy` there has to choose on purpose.
  it('the same facts and the same verdict, whoever failed the run', async () => {
    const steps: unknown[] = [];
    for (const causedBy of ['operator', 'sweep'] as const) {
      const b = build();
      const id = b.working();
      const out = causedBy === 'sweep' ? await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', STILL)
        : await closeRun(b.deps, id, { intent: 'abandon' }, 'operator');
      expect(out.ok).toBe(true);
      const sib = b.coord.openRunsForSession(W);
      if (!sib.ok) throw new Error('unreadable');
      const ask = landingAsk({ sessionId: W, workspace: W, number: 7, phase: 'open', queue: { state: 'dequeued', at: null } }, new Set());
      expect(ask).not.toBeNull();
      steps.push(landingVerdict(ask!, { runs: { ok: true, run: survivorOf(sib.siblings) } }));
    }
    expect(steps[0]).toEqual({ step: 'toldFeed', body: expect.stringContaining('No open run names a coordinator to tell.') });
    expect(steps[1]).toEqual(steps[0]);
  });

  it('THE LANE ITSELF (`sweepLanding`, on a watcher over the fixture store): the same notice, whoever failed the run', async () => {
    const said: unknown[] = [];
    for (const causedBy of ['operator', 'sweep'] as const) {
      const b = build();
      const id = b.working();
      const out = causedBy === 'sweep' ? await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', STILL)
        : await closeRun(b.deps, id, { intent: 'abandon' }, 'operator');
      expect(out.ok).toBe(true);
      const w = new FleetWatcher({ ...b.base, coord: b.coord } as never, new Bus(), 10_000);
      const pushed: unknown[] = [];
      vi.spyOn(w as unknown as { pushOne: (e: unknown) => void }, 'pushOne').mockImplementation((e) => { pushed.push(e); });
      const lane = w as unknown as { prStates: Map<string, unknown>; prQueues: Map<string, unknown>;
        sweepLanding: (records: unknown) => void };
      // A dequeued PR on the workspace whose run was failed — the one word that asks the landing lane for an act.
      lane.prStates.set(W, { phase: 'open', number: 7 });
      lane.prQueues.set(W, { state: 'dequeued', at: null });
      lane.sweepLanding(await readRegistry(b.base.io, b.base.cfg));
      said.push({ pushed, mail: b.coord.feedEvents(50).filter((e) => e.kind === 'mail').length });
    }
    expect(said[0]).toMatchObject({ pushed: [{ kind: 'queue', sessionId: W, body: expect.stringContaining('No open run names a coordinator to tell.') }] });
    expect(said[1], 'a sweep-failed run reads as an operator abandon').toEqual(said[0]);
  });
});
````


- [ ] **Step 2: Run — red.** `( cd server && ./node_modules/.bin/vitest run test/sweep-close.test.ts --maxWorkers=1 )`

Measured: `sweep-close.test.ts`: `7 failed | 4 passed (11)` — × the compare-and-set, before the fleet act: a claimant that is no longer the crashed id refuses and composes NOTHING; × the compare-and-set, inside the commit: a successor that lands DURING the fleet act is refused there; × THE RE-MEASURE, before the fleet act: a claimant that is no longer crashed — a revive of the SAME id — stops it, and NOTHING is composed; × THE RE-MEASURE, after the fleet act and before the commit: a revive DURING the release keeps the run open; × the sweep only ever abandons: any other body is refused before anything is read; × runs the abandon arm with causedBy sweep and the compare-and-set, and wires the reclaim port as the abandon route does; × is the SAME hold as the operator’s doors: a sweep waits for an abandon already running

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/coord/close.ts -->
In `server/src/coord/close.ts`, find:

````ts
import type { CcdPrLine } from '../prstate.js';
````

Replace with:

````ts
import type { CcdPrLine } from '../prstate.js';
import type { DeadCoordinatorStop } from '../deadCoordinator.js';
````

<!-- replay: replace server/src/coord/close.ts -->
In `server/src/coord/close.ts`, find:

````ts
  | { ok: false; kind: 'advanceFailed'; adv: Extract<AdvanceResult, { ok: false }> };
````

Replace with:

````ts
  | { ok: false; kind: 'advanceFailed'; adv: Extract<AdvanceResult, { ok: false }> }
  /** The sweep's compare-and-set refused (workspace lifecycle spec 2026-09-24 §5.4, "No successor"): the run's
   *  claimant is no longer the crashed id the dead-coordinator lane named. `claimedBy` is who holds it now. */
  | { ok: false; kind: 'claimant-changed'; claimedBy: string | null }
  /** The sweep's in-arm re-measure stopped it (workspace lifecycle spec 2026-09-24 §5.4, "No successor"): the claimant
   *  is no longer crashed, or that cannot be told, or the operator raised `reclaim-paused` or disarmed the lane.
   *  `released`: the stop came AFTER the fleet act, so the worker was released (or re-held) and the run stays open. */
  | { ok: false; kind: 'sweep-stopped'; stop: DeadCoordinatorStop; released: boolean };

/** What the dead-coordinator lane hands `closeRun` with its word (`'sweep'`): the crashed id the compare-and-set
 *  checks, and its re-measure, which the abandon arm runs IMMEDIATELY BEFORE the fleet act and again AFTER it, before
 *  the commit (the departure `the-sweep-re-measures-inside-the-arm`). A `claimedBy` compare-and-set cannot see a
 *  revive of the SAME id (`ccd ensure` takes no mutex and rewrites nothing in `coord.db`); only a re-measure can. */
export interface SweepCloseGuard {
  readonly claimedBy: string;
  readonly stillCrashed: () => Promise<DeadCoordinatorStop | null>;
}

/**
 * WHO closed a run, as `run_events.causedBy` records it. THREE words, each with its own door: the coordinator's own
 * close (`POST /api/runs/:id/close`), the operator's abandon (`POST /api/runs/:id/abandon` and the archive door's
 * `{programme:'end'}`), and the dead-coordinator lane's — `'sweep'` (workspace lifecycle spec 2026-09-24 §5.4), a third
 * word so the run event, the feed row and the audit never read as the operator's act. ADDITIVE on the wire, with no
 * `FLEET_PROTO` bump: the column is free text, and every reader (`runEvents`, `RoutingEvent.causedBy`, the stall
 * watch's notices, the landing lane) takes it as a string or ignores it.
 */
export type CloseCause = 'coordinator' | 'operator' | 'sweep';
````

<!-- replay: replace server/src/coord/close.ts -->
In `server/src/coord/close.ts`, find:

````ts
 */
export async function closeRun(
  deps: CloseRunDeps, id: number, body: unknown,
  causedBy: 'coordinator' | 'operator',
````

Replace with:

````ts
 *
 * THE THIRD WORD, `'sweep'` (workspace lifecycle spec 2026-09-24 §5.4), has a signature of its own: it comes WITH its
 * guard (`SweepCloseGuard`: the crashed claimant's id and its re-measure), so the dead-coordinator lane cannot reach
 * this arm without its compare-and-set and its re-measure, and it only ever abandons.
 */
export function closeRun(
  deps: CloseRunDeps, id: number, body: unknown, causedBy: 'coordinator' | 'operator',
): Promise<CloseOutcome>;
export function closeRun(
  deps: CloseRunDeps, id: number, body: unknown, causedBy: 'sweep', sweep: SweepCloseGuard,
): Promise<CloseOutcome>;
export async function closeRun(
  deps: CloseRunDeps, id: number, body: unknown,
  causedBy: CloseCause, sweep?: SweepCloseGuard,
````

<!-- replay: replace server/src/coord/close.ts -->
In `server/src/coord/close.ts`, find:

````ts
    return { ok: false, kind: 'bad-request' };
  }

````

Replace with:

````ts
    return { ok: false, kind: 'bad-request' };
  }
  // The sweep only ever ABANDONS (workspace lifecycle spec §5.4): a close body under its word is a caller that has
  // confused two acts, refused before anything is read or composed.
  if (causedBy === 'sweep' && !abandon) return { ok: false, kind: 'bad-request' };

````

<!-- replay: replace server/src/coord/close.ts -->
In `server/src/coord/close.ts`, find:

````ts
    const target = move.to;
````

Replace with:

````ts
    const target = move.to;
    /** THE SWEEP'S GATE, run IMMEDIATELY BEFORE the fleet act (workspace lifecycle spec 2026-09-24 §5.4, "No
     *  successor"). First the claimant RE-MEASURED — a revive of the same id is the race the spec names, and a
     *  compare-and-set on `claimedBy` cannot see it — then the compare-and-set's FIRST HALF on a FRESH read of the run:
     *  a run whose `claimedBy` is no longer the crashed id is refused before the fleet act, since a release that ran
     *  under a close that then refused would leave a successor's worker unheld. The second half is the store's, inside
     *  the commit's transaction (`expectClaimedBy` below). */
    const sweepGate = async (g: SweepCloseGuard): Promise<Extract<CloseOutcome, { ok: false }> | null> => {
      const stop = await g.stillCrashed();
      if (stop !== null) return { ok: false, kind: 'sweep-stopped', stop, released: false };
      const fresh = coord.run(id);
      if (!fresh.ok) return { ok: false, kind: 'hold-invalid', detail: fresh.detail };
      if (fresh.run === null) return { ok: false, kind: 'unknown-run' };
      return fresh.run.claimedBy === g.claimedBy ? null : { ok: false, kind: 'claimant-changed', claimedBy: fresh.run.claimedBy };
    };
````

<!-- replay: replace server/src/coord/close.ts -->
In `server/src/coord/close.ts`, find:

````ts
      if (!verbSupported(deps.fleetState, argv)) return { ok: false, kind: 'unsupported' };
````

Replace with:

````ts
      if (!verbSupported(deps.fleetState, argv)) return { ok: false, kind: 'unsupported' };
      if (sweep !== undefined) {
        const gate = await sweepGate(sweep);
        if (gate !== null) return gate;
      }
````

<!-- replay: replace server/src/coord/close.ts -->
In `server/src/coord/close.ts`, find:

````ts
      released = release;
````

Replace with:

````ts
      released = release;
      // AFTER the fleet act, before the commit: the claimant once more. A revive that landed during the release keeps
      // its run open — its worker is released (or re-held) and unheld until its coordinator re-holds it, which is the
      // residual a successor's race already has. What remains is the round trip of this last re-measure.
      if (sweep !== undefined) {
        const stop = await sweep.stillCrashed();
        if (stop !== null) return { ok: false, kind: 'sweep-stopped', stop, released: true };
      }
    } else if (sweep !== undefined) {
      const gate = await sweepGate(sweep);
      if (gate !== null) return gate;
````

<!-- replay: replace server/src/coord/close.ts -->
In `server/src/coord/close.ts`, find:

````ts
    });
    if (!closed.ok) return { ok: false, kind: 'advanceFailed', adv: closed };
````

Replace with:

````ts
      ...(sweep === undefined ? {} : { expectClaimedBy: sweep.claimedBy }),
    });
    // A successor that took the programme DURING the fleet act (a claimant writer outside this serialiser — none
    // exists in this build: `reclaimProgram`, the one rewriter of `claimedBy`, runs behind the same `CoordMutex`) is
    // refused here, and the run stays open under it. The residual, stated: the release above has run, so its worker
    // is unheld until that coordinator re-holds it.
    if (!closed.ok) {
      return closed.error === 'claimant-changed' ? { ok: false, kind: 'claimant-changed', claimedBy: closed.claimedBy }
        : { ok: false, kind: 'advanceFailed', adv: closed };
    }
````

<!-- replay: replace server/src/coord/close.ts -->
In `server/src/coord/close.ts`, find:

````ts
  deps: CloseRunDeps, run: RunRow, b: CloseRunBody, causedBy: 'coordinator' | 'operator',
````

Replace with:

````ts
  deps: CloseRunDeps, run: RunRow, b: CloseRunBody, causedBy: CloseCause,
````

<!-- replay: replace server/src/coord/routes.ts -->
In `server/src/coord/routes.ts`, find:

````ts
import { abandonRefusal, closeRun, type CloseOutcome, type CloseRunDeps } from './close.js';
````

Replace with:

````ts
import { abandonRefusal, closeRun, type CloseOutcome, type CloseRunDeps, type SweepCloseGuard } from './close.js';
````

<!-- replay: replace server/src/coord/routes.ts -->
In `server/src/coord/routes.ts`, find:

````ts
      return reply.code(400).send({ ok: false, error: r.kind, detail: r.detail });
    case 'unsupported': return reply.code(501).send({ ok: false, error: 'unsupported' });
    case 'fleetFailed': return reply.code(502).send({ ok: false, stderr: r.stderr });
    case 'advanceFailed': return reply.code(409).send(r.adv);
    default: {
      const _exhaustive: never = r;
      return reply.code(500).send({ ok: false, error: 'internal', kind: (_exhaustive as { kind: string }).kind });
````

Replace with:

````ts
      return reply.code(400).send({ ok: false, error: r.kind, detail: r.detail });
    case 'unsupported': return reply.code(501).send({ ok: false, error: 'unsupported' });
    case 'fleetFailed': return reply.code(502).send({ ok: false, stderr: r.stderr });
    case 'advanceFailed': return reply.code(409).send(r.adv);
    // Reached only through the sweep's handle, never from a route: no route passes a sweep guard. Mapped so the
    // switch stays total.
    case 'claimant-changed': return reply.code(409).send({ ok: false, error: 'claimant-changed', claimedBy: r.claimedBy });
    case 'sweep-stopped': return reply.code(409).send({ ok: false, error: 'sweep-stopped', stop: r.stop, released: r.released });
    default: {
      const _exhaustive: never = r;
      return reply.code(500).send({ ok: false, error: 'internal', kind: (_exhaustive as { kind: string }).kind });
````

<!-- replay: replace server/src/coord/routes.ts -->
In `server/src/coord/routes.ts`, find:

````ts
  ) => Promise<T>): Promise<T>;
````

Replace with:

````ts
  ) => Promise<T>): Promise<T>;
  /** The SAME hold, handed `closeRun`'s abandon arm as the DEAD-COORDINATOR LANE runs it (workspace lifecycle spec
   *  2026-09-24 §5.4): `causedBy: 'sweep'`, never the operator's word; the compare-and-set on `claimedBy` against the
   *  crashed id; the lane's re-measure, which the arm runs before the fleet act and again before the commit; CCR-15 wave
   *  3's `childReclaim` port wired exactly as the abandon route wires it. The lane's only way to end a run, so the
   *  reclaim door — which runs inside this serialiser — can never interleave with it. */
  withSweepAbandon<T>(coord: CoordStore, fn: (
    abandon: (runId: number, crashedId: string, stillCrashed: SweepCloseGuard['stillCrashed']) => Promise<CloseOutcome>,
  ) => Promise<T>): Promise<T>;
````

<!-- replay: replace server/src/coord/routes.ts -->
In `server/src/coord/routes.ts`, find:

````ts
    runId, { intent: 'abandon' }, 'operator'), (runId) => abandonRefusal(coord, runId)));
````

Replace with:

````ts
    runId, { intent: 'abandon' }, 'operator'), (runId) => abandonRefusal(coord, runId)));

  /** The dead-coordinator lane's abandon (workspace lifecycle spec §5.4) — `withAbandon`'s deps, `'sweep'` and the
   *  crashed id, inside the same `coordMutex`. Handed to the watcher by `buildServer`. */
  const withSweepAbandon: CoordRoutesHandle['withSweepAbandon'] = (coord, fn) => coordMutex.run(() => fn((runId, crashedId, stillCrashed) => closeRun(
    { coord, io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd, fleetState: deps.fleetState,
      childReclaim: childReclaimPort(deps, coord) },
    runId, { intent: 'abandon' }, 'sweep', { claimedBy: crashedId, stillCrashed })));
````

<!-- replay: replace server/src/coord/routes.ts -->
In `server/src/coord/routes.ts`, find:

````ts
  return { withAbandon };
````

Replace with:

````ts
  return { withAbandon, withSweepAbandon };
````


- [ ] **Step 4: Run — green**, with the mutex gate (it scans every `closeRun(` call for `coordMutex.run`), the abandon door and the archive door's handle:

```bash
( cd server && ./node_modules/.bin/vitest run test/sweep-close.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/dispatch-mutex-gate.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/coord-abandon.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archive-coord-handle.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/tsc --noEmit -p . )
```

Measured: `sweep-close.test.ts`: `11 passed (11)`; `dispatch-mutex-gate.test.ts`: `8 passed (8)`; `coord-abandon.test.ts`: `30 passed (30)`; `archive-coord-handle.test.ts`: `6 passed (6)`; `mail-routes.test.ts`: `59 passed (59)`; `tsc` rc 0.

- [ ] **Step 5: Mutation check, then commit.**

| # | Edit (restore after) | Measured red |
|---|---|---|
| T9.1 | `server/src/coord/close.ts`: `      return fresh.run.claimedBy === g.claimedBy ? null : { ok: false, kind: 'claimant-changed', claimedBy: fresh.run.claimedBy };` → `      return null;` | `sweep-close.test.ts`: `1 failed \| 10 passed (11)` — the compare-and-set, before the fleet act: a claimant that is no longer the crashed id refuses and composes NOTHING |
| T9.2 | `server/src/coord/close.ts`: `      ...(sweep === undefined ? {} : { expectClaimedBy: sweep.claimedBy }), ⏎ ` → (removed) | `sweep-close.test.ts`: `1 failed \| 10 passed (11)` — the compare-and-set, inside the commit: a successor that lands DURING the fleet act is refused there |
| T9.3 | `server/src/coord/close.ts`: `      return closed.error === 'claimant-changed' ? { ok: false, kind: 'claimant-changed', claimedBy: closed.claimedBy } ⏎         : { ok: false, kind: 'advanceFailed', adv: closed };` → `      return { ok: false, kind: 'advanceFailed', adv: closed };` | `sweep-close.test.ts`: `1 failed \| 10 passed (11)` — the compare-and-set, inside the commit: a successor that lands DURING the fleet act is refused there |
| T9.4 | `server/src/coord/routes.ts`: `    runId, { intent: 'abandon' }, 'sweep', { claimedBy: crashedId, stillCrashed })));` → `    runId, { intent: 'abandon' }, 'operator' as 'sweep', { claimedBy: crashedId, stillCrashed })));` | `sweep-close.test.ts`: `1 failed \| 10 passed (11)` — runs the abandon arm with causedBy sweep and the compare-and-set, and wires the reclaim port as the abandon route does |
| T9.5 | `server/src/coord/routes.ts`: `      childReclaim: childReclaimPort(deps, coord) }, ⏎     runId, { intent: 'abandon' }, 'sweep', { claimedBy: crashedId, stillCrashed })));` → `      }, ⏎     runId, { intent: 'abandon' }, 'sweep', { claimedBy: crashedId, stillCrashed })));` | `sweep-close.test.ts`: `1 failed \| 10 passed (11)` — runs the abandon arm with causedBy sweep and the compare-and-set, and wires the reclaim port as the abandon route does |
| T9.6 | `server/src/coord/routes.ts`: `  const withSweepAbandon: CoordRoutesHandle['withSweepAbandon'] = (coord, fn) => coordMutex.run(() => fn((runId, crashedId, stillCrashed) => closeRun( ⏎     { coord, io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd, fleetState: deps.fleetState, ⏎       childReclaim: childReclaimPort(deps, coord) }, ⏎     runId, { intent: 'abandon' }, 'sweep', { claimedBy: crashedId, stillCrashed })));` → `  const withSweepAbandon: CoordRoutesHandle['withSweepAbandon'] = (coord, fn) => fn((runId, crashedId, stillCrashed) => closeRun( ⏎     { coord, io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd, fleetState: deps.fleetState, ⏎       childReclaim: childReclaimPort(deps, coord) }, ⏎     runId, { intent: 'abandon' }, 'sweep', { claimedBy: crashedId, stillCrashed }));` | `sweep-close.test.ts`: `1 failed \| 10 passed (11)` — is the SAME hold as the operator’s doors: a sweep waits for an abandon already running<br>`dispatch-mutex-gate.test.ts`: `1 failed \| 7 passed (8)` — finds call sites, and every one under server/src sits inside coordMutex.run(...) |
| T9.7 | `server/src/coord/close.ts`: `  if (causedBy === 'sweep' && !abandon) return { ok: false, kind: 'bad-request' }; ⏎ ` → (removed) | `sweep-close.test.ts`: `1 failed \| 10 passed (11)` — the sweep only ever abandons: any other body is refused before anything is read |
| T9.8 | `server/src/coord/close.ts`: `      const stop = await g.stillCrashed(); ⏎       if (stop !== null) return { ok: false, kind: 'sweep-stopped', stop, released: false }; ⏎ ` → (removed) | `sweep-close.test.ts`: `2 failed \| 9 passed (11)` — THE RE-MEASURE, before the fleet act: a claimant that is no longer crashed — a revive of the SAME id — stops it, and NOTHING is composed; runs the abandon arm with causedBy sweep and the compare-and-set, and wires the reclaim port as the abandon route does |
| T9.9 | `server/src/coord/close.ts`: `        const stop = await sweep.stillCrashed(); ⏎         if (stop !== null) return { ok: false, kind: 'sweep-stopped', stop, released: true }; ⏎ ` → (removed) | `sweep-close.test.ts`: `1 failed \| 10 passed (11)` — THE RE-MEASURE, after the fleet act and before the commit: a revive DURING the release keeps the run open |
| T9.10 | `server/src/coord/routes.ts`: `    runId, { intent: 'abandon' }, 'sweep', { claimedBy: crashedId, stillCrashed })));` → `    runId, { intent: 'abandon' }, 'sweep', { claimedBy: crashedId, stillCrashed: async () => null })));` | `sweep-close.test.ts`: `1 failed \| 10 passed (11)` — runs the abandon arm with causedBy sweep and the compare-and-set, and wires the reclaim port as the abandon route does |
| T9.11 | `server/src/watch.ts`: `            case 'runs': { ⏎               const sib = coord.openRunsForSession(r.id);` → `            case 'runs': { ⏎               if (coord.runsTouching(r.id).some((x) => coord.runEvents(x.id).some((e) => e.causedBy === 'sweep'))) break steps; ⏎               const sib = coord.openRunsForSession(r.id);` | `sweep-close.test.ts`: `1 failed \| 10 passed (11)` — THE LANE ITSELF (`sweepLanding`, on a watcher over the fixture store): the same notice, whoever failed the run |

```bash
git add server/src/coord/close.ts server/src/coord/routes.ts server/test/sweep-close.test.ts
git commit -m "$(cat <<'MSG'
feat(coord): the sweep's abandon, behind the serialiser, with a compare-and-set

causedBy gains 'sweep', a third attribution word, so the run event never
reads as the operator's act; the sweep's signature carries its guard and only
ever abandons. Inside the arm the claimant is re-measured immediately before
the fleet act and again before the commit — a revive of the same id is what
no compare-and-set can see — and a run whose claimant is no longer the crashed
id is refused before the fleet act and again inside the commit. The serialiser
hands the lane its abandon through a handle, with the reclaim port wired as
the abandon route wires it. Landing reads a sweep-failed run as an operator
abandon, pinned through sweepLanding itself.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: The one executor — re-measured before each close, shadow until armed

**Model routing:** `opus`, effort `high`.

**Files:** create `server/src/coord/endDeadCoordinator.ts`, `server/test/end-dead-coordinator.test.ts`.

**Interfaces (Produces):** `EndDeadCoordinatorDeps { coord; io; cfg; tmux; notifyLog?; journalTrust; abandon }`, `endDeadCoordinator(deps, claimantId, nowMs): Promise<DeadCoordinatorActOutcome>` (called INSIDE the serialiser: one registry listing — `reclaim-paused` or an unlistable registry is `paused-at-server`; the lane disarmed is SHADOW, `would-end`, and `abandon` is never called; the runs the claimant holds NOW, by programme; then, per run, `abandon(run, crashedId, stillCrashed)` — the arm runs the re-measure; `sweep-stopped` and `claimant-changed` end the whole act with a typed `stoppedBy`; any other refusal is `stuck` and the next run is tried), `stillCrashed(deps, id, nowMs)` (the switches read again — a pause raised or the lane disarmed mid-act is a `switch` stop — then `measureClaimant` and the journal clause, fresh, against the lane's journal trust: any other answer is a `remeasured` stop), `deadCoordinatorJournalOf(coord, id, trust)` (the clause, read fresh; a throw is `unreadable`), `deadCoordinatorLaneArmed(names)` (the one reader of the live switch outside its definer, so the watcher never names it), `readDeadCoordinatorJournalTrust(deps, health)` (the adapter: the mirror's health, `lifecycleGapGens`, and the errors file's mtime while ccd has counted failures → `{ hold, trust }`, Pre-flight finding 14), `recordDeadCoordinatorFeed(deps, id, outcome, since)` (ONE row per programme; `kind: 'run'`, no run: recorded, never pushed) and `recordDeadCoordinatorBreaker(deps, breaker)` (the trip's one row).

- [ ] **Step 1: The test (red).** The new module cannot be imported yet: the whole file is red at collection.

<!-- replay: create server/test/end-dead-coordinator.test.ts -->
Create `server/test/end-dead-coordinator.test.ts`:

````ts
// The dead-coordinator lane's ONE executor (workspace lifecycle spec 2026-09-24 §5.4, "No successor" and "The act"),
// run as the lane runs it: inside the coordination serialiser, handed the sweep's abandon. A scripted tmux and a
// fixture registry answer; `closeRun` is the real one (so the compare-and-set is the real one) over a fixture store;
// nothing reaches a box.
import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { closeRun, type CloseOutcome } from '../src/coord/close.js';
import { endDeadCoordinator, recordDeadCoordinatorFeed, type EndDeadCoordinatorDeps } from '../src/coord/endDeadCoordinator.js';
import {
  DEAD_COORDINATOR_JOURNAL_TRUSTED, DEAD_COORDINATOR_LANE_LIVE_MARKER, type DeadCoordinatorJournalTrust,
} from '../src/deadCoordinator.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { NotifyLog } from '../src/notifylog.js';
import type { SessionVerdict } from '../src/exec.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const CRASHED = 'demo-coord-crashed';
const HEIR = 'demo-coord-heir';
const NOW = 1_790_000_000_000;
const SEC = NOW / 1000;

interface Opts {
  live?: boolean; paused?: boolean; unlistable?: boolean;
  /** tmux's answer for the claimant, asked once per re-measure (default `gone`). */
  verdict?: (asked: number) => SessionVerdict;
  /** Called as tmux is asked — the moment inside the arm's re-measure, before the fleet act. */
  onMeasure?: (asked: number) => void;
  /** Called as a ccd verb is composed — the fleet act itself. */
  onVerb?: (verb: string) => void;
  /** The lane's reading of the journal itself (default: trusted). */
  trust?: DeadCoordinatorJournalTrust;
}

const rig = async (o: Opts = {}) => {
  const home = mkTmp('ccrc-end-dead-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  // The crashed coordinator: a row that started, whose supervisor heartbeat is long gone — `orphan`.
  for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'demo', workdir: `/w/${CRASHED}`, uuid: `u-${CRASHED}`,
    started: '1', supervised: String(SEC - 7200) })) writeFileSync(path.join(reg, `${CRASHED}.${k}`), v);
  if (o.live !== false) writeFileSync(path.join(reg, DEAD_COORDINATOR_LANE_LIVE_MARKER), '');
  if (o.paused === true) writeFileSync(path.join(reg, 'reclaim-paused'), '');
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => { calls.push(args); o.onVerb?.(args[0] ?? ''); return { code: 0, stdout: '', stderr: '' }; };
  const base = testDeps(home, run);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  let asked = 0;
  const abandoned: number[] = [];
  const deps: EndDeadCoordinatorDeps = {
    coord, cfg: base.cfg, notifyLog,
    io: o.unlistable === true ? { ...base.io, readdir: async () => null } : base.io,
    tmux: { sessionVerdict: async () => { asked += 1; o.onMeasure?.(asked); return o.verdict?.(asked) ?? { verdict: 'gone' }; } },
    journalTrust: async () => o.trust ?? DEAD_COORDINATOR_JOURNAL_TRUSTED,
    // The sweep's abandon exactly as the serialiser's handle runs it (`routes.ts`'s `withSweepAbandon`): the REAL
    // `closeRun`, `'sweep'`, the crashed id and the executor's re-measure.
    abandon: (runId, crashedId, stillCrashed): Promise<CloseOutcome> => {
      abandoned.push(runId);
      return closeRun({ coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd }, runId, { intent: 'abandon' }, 'sweep',
        { claimedBy: crashedId, stillCrashed });
    },
  };
  /** A working run of `program`, claimed by the crashed coordinator, dispatched into `worker`. */
  const working = (program: string, worker: string): number => {
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: 2, claimedBy: CRASHED });
    if (!('id' in r)) throw new Error('openRun refused');
    coord.markDispatched(r.id, worker, worker, `ws/${worker}`, false);
    for (const to of ['dispatched', 'working'] as const) expect(coord.advance(r.id, to, 'coordinator').ok).toBe(true);
    return r.id;
  };
  const stateOf = (id: number) => okRun(coord.run(id))!.state;
  return { home, reg, coord, deps, calls, abandoned, working, stateOf };
};

describe('the one executor — shadow, the switch, and the store', () => {
  it('SHADOW (no live file): "would end programme <slug> (<n> runs)" — the abandon arm is never reached', async () => {
    const r = await rig({ live: false });
    const a = r.working('alpha', 'demo-w1');
    const b = r.working('alpha', 'demo-w2');
    const c = r.working('beta', 'demo-w3');
    expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).toEqual({ kind: 'would-end',
      programmes: [{ slug: 'alpha', runIds: [a, b] }, { slug: 'beta', runIds: [c] }] });
    expect(r.abandoned).toEqual([]);
    expect(r.calls, 'nothing composed').toEqual([]);
    expect([a, b, c].map(r.stateOf)).toEqual(['working', 'working', 'working']);
  });

  it('`reclaim-paused` — the one cleanup switch — stops it, live or shadow; so does a registry that would not list', async () => {
    for (const live of [true, false]) {
      const r = await rig({ paused: true, live });
      r.working('alpha', 'demo-w1');
      expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).toMatchObject({ kind: 'paused-at-server' });
      expect(r.abandoned).toEqual([]);
    }
    const u = await rig({ unlistable: true });
    u.working('alpha', 'demo-w1');
    expect(await endDeadCoordinator(u.deps, CRASHED, NOW)).toMatchObject({ kind: 'paused-at-server' });
    expect(u.abandoned).toEqual([]);
  });

  it('a store that cannot say which runs the claimant holds ends nothing', async () => {
    const r = await rig();
    r.working('alpha', 'demo-w1');
    r.deps.coord.openRunsClaimedBy = () => { throw new Error('database is not open'); };
    expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).toMatchObject({ kind: 'store-unreadable' });
    expect(r.abandoned).toEqual([]);
  });
});

describe('LIVE — each run re-measured inside the arm, then the abandon with the compare-and-set', () => {
  it('ends every run of every programme the claimant holds, failed, by the sweep', async () => {
    const r = await rig();
    const a = r.working('alpha', 'demo-w1');
    const c = r.working('beta', 'demo-w3');
    expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).toEqual({ kind: 'ended',
      programmes: [{ slug: 'alpha', runIds: [a] }, { slug: 'beta', runIds: [c] }], open: [], stuck: [], stoppedBy: null });
    expect([a, c].map(r.stateOf)).toEqual(['failed', 'failed']);
    expect(r.coord.runEvents(a).at(-1)?.causedBy).toBe('sweep');
  });

  it('the claimant is re-measured before EACH close: a revive after the first ends the WHOLE act', async () => {
    // Run a: asked before its fleet act and after it (gone, gone); run b: asked before its fleet act — live.
    const r = await rig({ verdict: (n) => (n >= 3 ? { verdict: 'live' } : { verdict: 'gone' }) });
    const a = r.working('alpha', 'demo-w1');
    const b = r.working('alpha', 'demo-w2');
    const out = await endDeadCoordinator(r.deps, CRASHED, NOW);
    expect(out).toMatchObject({ kind: 'ended', programmes: [{ slug: 'alpha', runIds: [a] }], open: [{ slug: 'alpha', runIds: [b] }],
      stuck: [], stoppedBy: { kind: 'remeasured', why: expect.stringContaining('tmux reports the pane live') } });
    expect([a, b].map(r.stateOf)).toEqual(['failed', 'working']);
  });

  it('THE FORCED INTERLEAVING (ruling G): a revive of the SAME id after the lane measured it is seen before the fleet act — nothing is composed', async () => {
    // The race the spec names: `ccd ensure` on the crashed id takes no mutex and leaves `claimedBy` as it was, so the
    // compare-and-set cannot see it; the re-measure the arm runs immediately before the fleet act does.
    const r = await rig({ verdict: () => ({ verdict: 'live' }) });
    const a = r.working('alpha', 'demo-w1');
    expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).toMatchObject({ kind: 'ended', programmes: [],
      open: [{ slug: 'alpha', runIds: [a] }], stoppedBy: { kind: 'remeasured' } });
    expect(r.stateOf(a)).toBe('working');
    expect(r.calls, 'no release was composed for its worker').toEqual([]);
  });

  it('a revive DURING the fleet act is seen after it, before the commit: the run stays open, and the stop says its worker was released', async () => {
    let releasedAt = 0;
    const r = await rig({ onVerb: (v) => { if (v === 'ws-release') releasedAt = 1; },
      verdict: () => (releasedAt === 1 ? { verdict: 'live' } : { verdict: 'gone' }) });
    const a = r.working('alpha', 'demo-w1');
    const out = await endDeadCoordinator(r.deps, CRASHED, NOW);
    expect(out).toMatchObject({ kind: 'ended', programmes: [], open: [{ slug: 'alpha', runIds: [a] }],
      stoppedBy: { kind: 'remeasured', why: expect.stringContaining(`after run ${a}'s worker was released`) } });
    expect(r.stateOf(a), 'never failed under a coordinator that came back').toBe('working');
  });

  it('a deliberate act journaled since the pass — the operator stopped it — ends the act too', async () => {
    const r = await rig({ onMeasure: (n) => {
      if (n === 1) r.coord.ingestJournal({ gen: '1790000000000000000', cursor: 100, size: 100, at: 1, rows: [parseJournalLine(JSON.stringify(
        { v: 1, uid: 'w4ex.1.1', at: NOW, act: 'stop', outcome: 'done', id: CRASHED, dec: { surface: 'pwa' } }))] });
    } });
    const a = r.working('alpha', 'demo-w1');
    expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).toMatchObject({ kind: 'ended', programmes: [],
      stoppedBy: { kind: 'remeasured', why: expect.stringContaining('stop') } });
    expect(r.stateOf(a)).toBe('working');
  });

  it('a journal the re-measure cannot read, or cannot trust, is not a crash: it ends the act — never "no history"', async () => {
    const thrown = await rig();
    const a = thrown.working('alpha', 'demo-w1');
    thrown.deps.coord.deadCoordinatorJournalRows = () => { throw new Error('database disk image is malformed'); };
    expect(await endDeadCoordinator(thrown.deps, CRASHED, NOW)).toMatchObject({ kind: 'ended', programmes: [],
      stoppedBy: { kind: 'remeasured', why: expect.stringContaining('database disk image is malformed') } });
    expect(thrown.stateOf(a)).toBe('working');
    const untrusted = await rig({ trust: { untrusted: 'the lifecycle mirror is unavailable', gapGens: [], lastWriteErrorAt: null } });
    const b = untrusted.working('alpha', 'demo-w1');
    expect(await endDeadCoordinator(untrusted.deps, CRASHED, NOW)).toMatchObject({ kind: 'ended', programmes: [],
      stoppedBy: { kind: 'remeasured', why: expect.stringContaining('the lifecycle mirror is unavailable') } });
    expect(untrusted.stateOf(b)).toBe('working');
    expect([...thrown.calls, ...untrusted.calls]).toEqual([]);
  });

  it('the switches are read again before EACH run: a pause raised, or the lane disarmed, after the first close stops the rest', async () => {
    for (const how of ['paused', 'disarmed'] as const) {
      let first = true;
      const r: Awaited<ReturnType<typeof rig>> = await rig({ onVerb: (v) => {
        if (v !== 'ws-release' || !first) return;
        first = false;
        if (how === 'paused') writeFileSync(path.join(r.reg, 'reclaim-paused'), '');
        else rmSync(path.join(r.reg, DEAD_COORDINATOR_LANE_LIVE_MARKER));
      } });
      const a = r.working('alpha', 'demo-w1');
      const b = r.working('alpha', 'demo-w2');
      const out = await endDeadCoordinator(r.deps, CRASHED, NOW);
      expect(out, how).toMatchObject({ kind: 'ended', programmes: [], stoppedBy: { kind: 'switch' } });
      expect([a, b].map(r.stateOf), how).toEqual(['working', 'working']);
    }
  });

  it('a successor that took the programme is never failed — the compare-and-set, defence against a claimedBy writer outside this serialiser (none exists in this build)', async () => {
    // `reclaimProgram` stands for that writer; in this build its only caller, the reclaim door, waits on the same
    // serialiser, so this race is closed by the mutex and the compare-and-set is the second wall.
    let a = 0;
    const r = await rig({ onMeasure: () => { expect(r.coord.reclaimProgram(a, HEIR, NOW, null)).toMatchObject({ ok: true }); } });
    a = r.working('alpha', 'demo-w1');
    const out = await endDeadCoordinator(r.deps, CRASHED, NOW);
    expect(out).toMatchObject({ kind: 'ended', programmes: [], stuck: [], stoppedBy: { kind: 'successor', why: expect.stringContaining(HEIR) } });
    expect(r.stateOf(a), 'the successor’s run is untouched').toBe('working');
    expect(r.calls, 'and no release was composed for its worker').toEqual([]);
  });

  it('a run the abandon arm cannot move is listed, and the next one is still tried', async () => {
    const r = await rig();
    const a = r.working('alpha', 'demo-w1');
    expect(r.coord.advance(a, 'closing', 'coordinator').ok, 'a run already closing has no abandon edge').toBe(true);
    const b = r.working('alpha', 'demo-w2');
    expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).toEqual({ kind: 'ended', programmes: [{ slug: 'alpha', runIds: [b] }],
      open: [{ slug: 'alpha', runIds: [a] }], stuck: [{ runId: a, why: 'bad-transition: closing → closing' }], stoppedBy: null });
  });
});

describe('the feed', () => {
  it('ONE row per ended programme in the spec’s words; a shadow row says nothing was ended — recorded, never pushed', async () => {
    const r = await rig();
    r.working('alpha', 'demo-w1');
    r.working('alpha', 'demo-w2');
    recordDeadCoordinatorFeed(r.deps, CRASHED, await endDeadCoordinator(r.deps, CRASHED, NOW), NOW - 3_600_000);
    const rows = r.coord.feedEvents(10).filter((e) => e.sessionId === CRASHED);
    expect(rows.map((e) => [e.title, e.body, e.runId])).toEqual([['dead coordinator: programme ended',
      `coordinator ${CRASHED} crashed (dead since 2026-09-21 13:13 UTC) and stayed dead an hour; programme alpha ended, 2 runs closed failed.`, null]]);
  });
});
````


- [ ] **Step 2: Run — red.** `( cd server && ./node_modules/.bin/vitest run test/end-dead-coordinator.test.ts --maxWorkers=1 )`

Measured: `end-dead-coordinator.test.ts`: `no tests — the file fails at collection (its import does not resolve yet)`

- [ ] **Step 3: The source.**

<!-- replay: create server/src/coord/endDeadCoordinator.ts -->
Create `server/src/coord/endDeadCoordinator.ts`:

````ts
import path from 'node:path';
import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { NotifyLog } from '../notifylog.js';
import type { CoordStore } from './store.js';
import type { CloseOutcome, SweepCloseGuard } from './close.js';
import { closeRefusalOf } from './archiveDoor.js';
import { measureClaimant, type ReclaimDeps } from './reclaim.js';
import { RECLAIM_PAUSE_MARKER } from './rundefs.js';
import { LC_DIR_NAME, LC_ERRORS_NAME, type LifecycleHealth } from '../../../shared/api.js';
import {
  DEAD_COORDINATOR_LANE_LIVE_MARKER, deadCoordinatorBreakerFeedRow, deadCoordinatorCrash, deadCoordinatorFeedRows,
  deadCoordinatorJournal,
  type DeadCoordinatorActOutcome, type DeadCoordinatorBreaker, type DeadCoordinatorJournal,
  type DeadCoordinatorJournalTrust, type DeadCoordinatorProgramme, type DeadCoordinatorStop,
} from '../deadCoordinator.js';

/**
 * THE DEAD-COORDINATOR LANE'S ONE EXECUTOR (workspace lifecycle spec 2026-09-24 §5.4, "No successor" and "The act").
 * Its one caller is `watch.ts`'s `sweepDeadCoordinators`, and it runs INSIDE the coordination serialiser — the lane
 * calls it through `CoordRoutesHandle.withSweepAbandon`, which hands it `abandon`, `closeRun`'s abandon arm with
 * `causedBy: 'sweep'`, the compare-and-set on `claimedBy` and this file's re-measure. So the reclaim door, which runs
 * inside that same serialiser, can never interleave with it. The race that remains is a revive of the SAME id (`ccd
 * ensure`, which takes no mutex and changes no `claimedBy`): the compare-and-set cannot see it, so the arm runs the
 * re-measure IMMEDIATELY before each run's fleet act and again after it, before the commit. That NARROWS the window to
 * one round trip; it does not close it (the departure `the-sweep-re-measures-inside-the-arm`).
 *
 * In order, every doubt "not this time":
 *   1. ONE registry listing, nearest the act: `reclaim-paused` — the fleet's one cleanup switch — stops it, and so does
 *      a listing that could not be taken; `dead-coordinator-lane-live` decides SHADOW or LIVE here, whatever the lane's
 *      pass read;
 *   2. the runs the claimant holds NOW (`openRunsClaimedBy`), grouped by programme; a store that cannot say ends it;
 *   3. shadow stops here: "would end programme <slug> (<n> runs)", and `abandon` is never called;
 *   4. live, for each run: `abandon(run, crashedId, stillCrashed)`. Inside the arm the switches are read again (a pause
 *      raised, or the lane disarmed, mid-act stops it), then the claimant is re-measured — the reclaim door's own
 *      verdict and the journal clause, read fresh, against a journal the lane still trusts — and anything but a crash
 *      ends the WHOLE act (`sweep-stopped`). A `claimant-changed` (a successor) ends the whole act too; any other
 *      refusal is listed (`stuck`) and the next run is still tried.
 * It never retries inside itself: the lane's backoff decides when it is asked again.
 */

/** The executor's ports (L2, declared by this consumer). `abandon` is the ONLY way it ends a run. `journalTrust` is the
 *  lane's own reading of the lifecycle mirror's health, gaps and ccd's write failures, asked fresh at each re-measure. */
export interface EndDeadCoordinatorDeps {
  coord: CoordStore;
  io: FleetIO;
  cfg: CcrcConfig;
  tmux: ReclaimDeps['tmux'];
  notifyLog?: NotifyLog;
  journalTrust: () => Promise<DeadCoordinatorJournalTrust>;
  abandon: (runId: number, crashedId: string, stillCrashed: SweepCloseGuard['stillCrashed']) => Promise<CloseOutcome>;
}

/**
 * HOW FAR THE LANE TRUSTS THE JOURNAL this pass (the departure `journal-loss-reads-as-unmeasured`) — read here, an
 * adapter, so the lane gathers and decides nothing. From the mirror's own health (`JournalMirror.health()`, which the
 * watcher already reports on `/api/fleet/health`), its recorded gaps, and — when ccd has counted write failures — the
 * counter file's mtime, the instant of the last one:
 *  - `unknown` (not swept since this process started) or `stale` (no sweep for three intervals): `hold` — the pass
 *    decides NOTHING, so a restart or a slow mirror never deletes an anchor, and never counts a pass toward the hour;
 *  - `unavailable` (the fleet's ccd does not journal at all): every dead claimant's journal is untrusted, so it is
 *    listed `unmeasured` and never acted on;
 *  - `ok`: trusted, with the gaps and the last write failure for the clause to place against each claimant's last start.
 */
export async function readDeadCoordinatorJournalTrust(
  deps: Pick<EndDeadCoordinatorDeps, 'coord' | 'io' | 'cfg'>, health: LifecycleHealth | null,
): Promise<{ readonly hold: string | null; readonly trust: DeadCoordinatorJournalTrust }> {
  const untrusted = (why: string, hold: boolean) =>
    ({ hold: hold ? why : null, trust: { untrusted: why, gapGens: [], lastWriteErrorAt: null } });
  if (health === null) return untrusted('there is no coordination store to mirror the journal into', true);
  if (health.state === 'unknown' || health.state === 'stale') return untrusted(`the lifecycle mirror is ${health.state}`, true);
  if (health.state === 'unavailable') return untrusted('the fleet box’s ccd does not journal (no lifecycle-v1)', false);
  let gapGens: string[];
  try {
    gapGens = deps.coord.lifecycleGapGens();
  } catch (err) {
    return untrusted(`the mirror's recorded gaps could not be read (${err instanceof Error ? err.message : String(err)})`, false);
  }
  let lastWriteErrorAt: number | 'unknown' | null = null;
  if (health.writeErrors !== null && health.writeErrors > 0) {
    const st = await deps.io.statMeasured(path.join(deps.cfg.registryDir, LC_DIR_NAME, LC_ERRORS_NAME));
    lastWriteErrorAt = st.ok ? st.mtimeMs : 'unknown';
  }
  return { hold: null, trust: { untrusted: null, gapGens, lastWriteErrorAt } };
}

/** Is the lane ARMED in this registry listing? The one reader of the live switch outside its definer — so the watcher,
 *  which holds writes of its own, never names it (`single-definition.test.ts`'s no-writer pin). */
export const deadCoordinatorLaneArmed = (names: readonly string[]): boolean => names.includes(DEAD_COORDINATOR_LANE_LIVE_MARKER);

/** The runs, grouped by programme in the order the store listed them (id order). */
const byProgramme = (runs: readonly { id: number; program: string }[]): DeadCoordinatorProgramme[] => {
  const out = new Map<string, number[]>();
  for (const r of runs) out.set(r.program, [...(out.get(r.program) ?? []), r.id]);
  return [...out].map(([slug, runIds]) => ({ slug, runIds }));
};

/** The journal clause, read fresh for one claimant against the lane's trust. A read that throws is `unreadable` —
 *  never "no history". */
export function deadCoordinatorJournalOf(coord: CoordStore, id: string, trust: DeadCoordinatorJournalTrust): DeadCoordinatorJournal {
  try {
    const j = coord.deadCoordinatorJournalRows([id]).get(id)!;
    return deadCoordinatorJournal(j.rows, j.hasHistory, trust);
  } catch (err) {
    return { kind: 'unreadable', detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Is the claimant STILL crashed, and is the lane still armed and unpaused? `null` when it may go on; otherwise why
 *  it stops — typed (`DeadCoordinatorStop`), so the lane never re-splits the prose. */
export async function stillCrashed(deps: EndDeadCoordinatorDeps, id: string, nowMs: number): Promise<DeadCoordinatorStop | null> {
  let names: readonly string[] | null;
  try { names = await deps.io.readdir(deps.cfg.registryDir); } catch { names = null; }
  if (names === null) return { kind: 'switch', why: `the registry did not list, so a raised ${RECLAIM_PAUSE_MARKER} cannot be ruled out` };
  if (names.includes(RECLAIM_PAUSE_MARKER)) return { kind: 'switch', why: `${RECLAIM_PAUSE_MARKER} was raised during the act` };
  if (!deadCoordinatorLaneArmed(names)) return { kind: 'switch', why: 'the lane was disarmed during the act' };
  const m = await measureClaimant({ coord: deps.coord, io: deps.io, cfg: deps.cfg, tmux: deps.tmux }, id, nowMs);
  const c = deadCoordinatorCrash(m, deadCoordinatorJournalOf(deps.coord, id, await deps.journalTrust()));
  switch (c.kind) {
    case 'crashed': return null;
    case 'alive': return { kind: 'remeasured', why: `re-measured alive: ${c.why}` };
    case 'stopped': return { kind: 'remeasured', why: 're-measured stopped' };
    case 'deliberate': return { kind: 'remeasured', why: `re-measured: a deliberate ${c.act} since its last start` };
    case 'unmeasurable': case 'unmeasured': return { kind: 'remeasured', why: `re-measured ${c.kind}: ${c.why}` };
  }
}

export async function endDeadCoordinator(
  deps: EndDeadCoordinatorDeps, claimantId: string, nowMs: number,
): Promise<DeadCoordinatorActOutcome> {
  // 1 — the switches, from ONE listing, nearest the act.
  let names: readonly string[] | null;
  try { names = await deps.io.readdir(deps.cfg.registryDir); } catch { names = null; }
  if (names === null) {
    return { kind: 'paused-at-server', detail: `the registry did not list, so a raised ${RECLAIM_PAUSE_MARKER} cannot be ruled out` };
  }
  if (names.includes(RECLAIM_PAUSE_MARKER)) {
    return { kind: 'paused-at-server', detail: `${RECLAIM_PAUSE_MARKER} is raised: cleanup is paused fleet-wide` };
  }
  // 2 — the runs it holds NOW.
  let runs: { id: number; program: string }[];
  try {
    const read = deps.coord.openRunsClaimedBy(claimantId);
    if (!read.ok) return { kind: 'store-unreadable', detail: read.detail };
    runs = read.siblings;
  } catch (err) {
    return { kind: 'store-unreadable', detail: err instanceof Error ? err.message : String(err) };
  }
  // 3 — shadow stops here: recorded, and `abandon` is never called.
  if (!deadCoordinatorLaneArmed(names)) return { kind: 'would-end', programmes: byProgramme(runs) };
  // 4 — each run: the abandon, with the compare-and-set and the re-measure inside the arm.
  const ended: { id: number; program: string }[] = [];
  const stuck: { runId: number; why: string }[] = [];
  let stoppedBy: DeadCoordinatorStop | null = null;
  for (const run of runs) {
    const out = await deps.abandon(run.id, claimantId, () => stillCrashed(deps, claimantId, nowMs));
    if (out.ok) { ended.push(run); continue; }
    if (out.kind === 'sweep-stopped') {
      stoppedBy = out.released
        ? { ...out.stop, why: `${out.stop.why} — after run ${run.id}'s worker was released, so it is unheld until its coordinator re-holds it` }
        : out.stop;
      break;
    }
    if (out.kind === 'claimant-changed') {
      stoppedBy = { kind: 'successor',
        why: `run ${run.id}'s programme has a coordinator again (${out.claimedBy ?? 'none'}) — no successor may be failed` };
      break;
    }
    const why = closeRefusalOf(run.id, out);
    stuck.push({ runId: run.id, why: why.detail === undefined ? why.kind : `${why.kind}: ${why.detail}` });
  }
  const closed = new Set(ended.map((r) => r.id));
  return { kind: 'ended', programmes: byProgramme(ended), open: byProgramme(runs.filter((r) => !closed.has(r.id))),
    stuck, stoppedBy };
}

/** Feed rows, recorded and never pushed: `kind: 'run'` with no run and a claimant as the session. A missing log
 *  degrades the record and never the act. */
function recordRows(
  deps: Pick<EndDeadCoordinatorDeps, 'coord' | 'notifyLog'>, sessionId: string,
  rows: readonly { readonly title: string; readonly body: string }[], what: string,
): void {
  const log = deps.notifyLog;
  if (!log) return;
  try {
    for (const row of rows) {
      const ev = log.record({ kind: 'run', sessionId, runId: null, title: row.title, body: row.body });
      deps.coord.recordFeedEvent(log.epoch, ev);
    }
  } catch (err) {
    console.warn('ccrc-server: recordFeedEvent failed '
      + `(${err instanceof Error ? err.message : String(err)}) — dead coordinator ${what}, feed archive degraded`);
  } finally {
    void log.flush();
  }
}

/** The feed rows for an act or its shadow — ONE per programme, in the spec's words, with the instant the hour counted
 *  from (`deadCoordinatorFeedRows`, L1). */
export function recordDeadCoordinatorFeed(
  deps: Pick<EndDeadCoordinatorDeps, 'coord' | 'notifyLog'>, claimantId: string, o: DeadCoordinatorActOutcome, since: number,
): void {
  recordRows(deps, claimantId, deadCoordinatorFeedRows(claimantId, o, since), o.kind);
}

/** The breaker's feed row, under its first claimant — written by the lane when the trip begins or names a new set. */
export function recordDeadCoordinatorBreaker(
  deps: Pick<EndDeadCoordinatorDeps, 'coord' | 'notifyLog'>, b: Extract<DeadCoordinatorBreaker, { tripped: true }>,
): void {
  recordRows(deps, b.claimants[0] ?? 'fleet', [deadCoordinatorBreakerFeedRow(b)], 'breaker');
}
````


- [ ] **Step 4: Run — green**, with the vocabulary scan and the coord-ring scans:

```bash
( cd server && ./node_modules/.bin/vitest run test/end-dead-coordinator.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=1 )
```

Measured: `end-dead-coordinator.test.ts`: `13 passed (13)`; `mail-routes.test.ts`: `59 passed (59)`; `single-definition.test.ts`: `407 passed (407)`

- [ ] **Step 5: Mutation check, then commit.** Row T10.1 is ruling (G)'s: the re-measure dropped from the arm, the same-id revive is failed (seven reds). Row T10.4 is the second wall: both halves of the compare-and-set removed, a successor's run is failed. The trust adapter's and the shadow's rows that only the lane can prove are Task 11's (T11.27–T11.30).

| # | Edit (restore after) | Measured red |
|---|---|---|
| T10.1 | `server/src/coord/endDeadCoordinator.ts`: `    const out = await deps.abandon(run.id, claimantId, () => stillCrashed(deps, claimantId, nowMs));` → `    const out = await deps.abandon(run.id, claimantId, async () => null);` | `end-dead-coordinator.test.ts`: `7 failed \| 6 passed (13)` — the claimant is re-measured before EACH close: a revive after the first ends the WHOLE act; THE FORCED INTERLEAVING (ruling G): a revive of the SAME id after the lane measured it is seen before the fleet act — nothing is composed; a revive DURING the fleet act is seen after it, before the commit: the run stays open, and the stop says its worker was released; a deliberate act journaled since the pass — the operator stopped it — ends the act too; a journal the re-measure cannot read, or cannot trust, is not a crash: it ends the act — never "no history"; the switches are read again before EACH run: a pause raised, or the lane disarmed, after the first close stops the rest; a successor that took the programme is never failed — the compare-and-set, defence against a claimedBy writer outside this serialiser (none exists in this build) |
| T10.2 | `server/src/coord/endDeadCoordinator.ts`: `  const c = deadCoordinatorCrash(m, deadCoordinatorJournalOf(deps.coord, id, await deps.journalTrust()));` → `  const c = deadCoordinatorCrash(m, { kind: 'quiet', started: true });` | `end-dead-coordinator.test.ts`: `2 failed \| 11 passed (13)` — a deliberate act journaled since the pass — the operator stopped it — ends the act too; a journal the re-measure cannot read, or cannot trust, is not a crash: it ends the act — never "no history" |
| T10.3 | `server/src/coord/endDeadCoordinator.ts`: `    if (out.kind === 'claimant-changed') {` → `    if (false) {` | `end-dead-coordinator.test.ts`: `1 failed \| 12 passed (13)` — a successor that took the programme is never failed — the compare-and-set, defence against a claimedBy writer outside this serialiser (none exists in this build) |
| T10.4 | `server/src/coord/close.ts`: `      return fresh.run.claimedBy === g.claimedBy ? null : { ok: false, kind: 'claimant-changed', claimedBy: fresh.run.claimedBy };` → `      return null;`; and `server/src/coord/close.ts`: `      ...(sweep === undefined ? {} : { expectClaimedBy: sweep.claimedBy }), ⏎ ` → (removed) | `end-dead-coordinator.test.ts`: `1 failed \| 12 passed (13)` — a successor that took the programme is never failed — the compare-and-set, defence against a claimedBy writer outside this serialiser (none exists in this build) |
| T10.5 | `server/src/coord/endDeadCoordinator.ts`: `  if (!deadCoordinatorLaneArmed(names)) return { kind: 'would-end', programmes: byProgramme(runs) }; ⏎ ` → (removed) | `end-dead-coordinator.test.ts`: `1 failed \| 12 passed (13)` — SHADOW (no live file): "would end programme <slug> (<n> runs)" — the abandon arm is never reached |
| T10.6 | `server/src/coord/endDeadCoordinator.ts`: `  if (names.includes(RECLAIM_PAUSE_MARKER)) {` → `  if (false) {` | `end-dead-coordinator.test.ts`: `1 failed \| 12 passed (13)` — `reclaim-paused` — the one cleanup switch — stops it, live or shadow; so does a registry that would not list |
| T10.7 | `server/src/coord/endDeadCoordinator.ts`: ``    stuck.push({ runId: run.id, why: why.detail === undefined ? why.kind : `${why.kind}: ${why.detail}` });`` → `    break;` | `end-dead-coordinator.test.ts`: `1 failed \| 12 passed (13)` — a run the abandon arm cannot move is listed, and the next one is still tried |
| T10.8 | `server/src/coord/endDeadCoordinator.ts`: ``  if (names.includes(RECLAIM_PAUSE_MARKER)) return { kind: 'switch', why: `${RECLAIM_PAUSE_MARKER} was raised during the act` }; ⏎   if (!deadCoordinatorLaneArmed(names)) return { kind: 'switch', why: 'the lane was disarmed during the act' }; ⏎ `` → (removed) | `end-dead-coordinator.test.ts`: `1 failed \| 12 passed (13)` — the switches are read again before EACH run: a pause raised, or the lane disarmed, after the first close stops the rest |
| T10.9 | `server/src/coord/endDeadCoordinator.ts`: `    return { kind: 'unreadable', detail: err instanceof Error ? err.message : String(err) };` → `    return { kind: 'quiet', started: true };` | `end-dead-coordinator.test.ts`: `1 failed \| 12 passed (13)` — a journal the re-measure cannot read, or cannot trust, is not a crash: it ends the act — never "no history" |

```bash
git add server/src/coord/endDeadCoordinator.ts server/test/end-dead-coordinator.test.ts
git commit -m "$(cat <<'MSG'
feat(coord): the dead-coordinator lane's one executor

Inside the coordination serialiser: the switches read once more, nearest the
act; shadow records "would end programme <slug> (<n> runs)" and never calls
the abandon; live, each run's abandon carries the re-measure the arm runs
before the fleet act and before the commit — the switches again, the verdict
and the journal against the lane's trust — and any answer but a crash ends the
whole act, a successor included. Runs the abandon arm cannot move are listed.
One feed row per ended programme, with its first-dead instant.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 11: The lane — `sweepDeadCoordinators`, a third sibling on the tick, shadowed, one pass at a time and one claimant ended a pass

**Model routing:** `opus`, effort `high`.

**Files:** `server/src/watch.ts`, `server/src/server.ts`; create `server/test/dead-coordinator-lane.test.ts`; modify `server/test/fleetws.test.ts`.

**Interfaces:** `FleetWatcher.sweepDeadCoordinators(records, names)` (public, for tests; `tick()` dispatches it with `void` beside the expiry lane), `useCoordSerialiser(h)` (called optionally by `buildServer` right after `registerCoordRoutes`), `currentDeadCoordinators()`; the coord frame's `deadCoordinatorAttention` (always sent by this build). The pass: `reclaim-paused` → forget the run of crashed passes and return; the journal's trust (`readDeadCoordinatorJournalTrust` over `lifecycleHealth()`) — a mirror not swept since the restart, or `stale`, decides nothing (forget, return); the population (`openCoordinatorIds`) and the anchors (one statement each; either failing decides nothing); each claimant measured by `measureClaimant`, one at a time, through a tmux port that notes an `unknown` answer as a fleet-wide doubt; the journal clause for the dead ones in one read, against the trust; classify; a crash keeps or starts the anchor (`deadAnchorNext`), anything else deletes it; claimants that left the population are forgotten, anchors and all; the breaker with its memory (members released only on alive, stopped or deliberate) and the fleet-wide doubt, its feed row written when the trip changes; then the act — never while the breaker stands, the longest dead first: ARMED, at most ONE claimant through the handle; in SHADOW every due claimant is recorded (an outcome that is not `would-end` ends the pass, whatever this pass's listing read); an act stopped by a re-measure deletes the anchor; an act that throws backs off; the attention list from memory.

- [ ] **Step 1: The tests (red).**

<!-- replay: create server/test/dead-coordinator-lane.test.ts -->
Create `server/test/dead-coordinator-lane.test.ts`:

````ts
// THE DEAD-COORDINATOR LANE, wired (workspace lifecycle spec 2026-09-24 §5.4, wave 4). `dead-coordinator-policy` pins
// the L1 verdicts, `end-dead-coordinator` the executor and `sweep-close` the compare-and-set; what is only provable
// HERE is what the lane does over passes and time: SHADOW ends nothing however long a coordinator has been dead; the
// live file lets the act through only after the hour AND two crashed passes; the hour is durable across a restart, and
// the supervisor stamp only raises it; anything but a crash deletes it; the journal clause keeps a deliberately stopped
// coordinator, and a journal the lane cannot trust keeps every one; the breaker holds the whole lane while two die
// together, remembers them through a doubt, and trips on a fleet-wide one; shadow records every due coordinator;
// `reclaim-paused` stops everything; and the list reaches the coord frame. NOTHING here reaches a box: tmux and ccd are
// a scripted recorder, the registry is a fixture HOME's, the lifecycle mirror sweeps the fixture's own (empty) journal
// directory, and the serialiser is the real one only in the last case, built by `buildServer`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { closeRun } from '../src/coord/close.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { buildServer } from '../src/server.js';
import { Tmux, type Runner } from '../src/exec.js';
import { DEAD_COORDINATOR_AFTER_MS, DEAD_COORDINATOR_LANE_LIVE_MARKER } from '../src/deadCoordinator.js';
import { NotifyLog } from '../src/notifylog.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

const T0 = 1_790_000_000_000;
const OLD_STAMP = String(T0 / 1000 - 7200);   // a supervisor heartbeat long gone: the row reads `orphan`
const A = 'demo-coord-a';
const B = 'demo-coord-b';
const HOUR = DEAD_COORDINATOR_AFTER_MS;

const fixture = async (opts: {
  server?: boolean;
  /** ccd's caps as the fleet state reports them (default: none reported — the mirror sweeps). */
  ccdVerbs?: string[];
  /** Called inside the serialiser, before the act — a revive that lands after the lane measured. */
  beforeAct?: () => void;
  /** The serialiser's act throws. */
  throwAct?: boolean;
} = {}) => {
  let clock = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const home = mkTmp('ccrc-dead-coord-lane-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(path.join(reg, '.lifecycle'), { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  /** The panes tmux proves live; every other `has-session` answers tmux's one death message. */
  const live = new Set<string>();
  let tmuxDown = false;
  const tmuxAsked: string[] = [];
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    if (path.basename(cmd) === 'tmux') {
      if (args[0] !== 'has-session') return { code: 1, stdout: '', stderr: '' };
      const id = (args[2] ?? '').replace(/^=cc-/, '').replace(/:$/, '');
      tmuxAsked.push(id);
      if (tmuxDown) return { code: 1, stdout: '', stderr: 'no server running on /tmp/tmux-1000/default' };
      return live.has(id) ? { code: 0, stdout: '', stderr: '' } : { code: 1, stdout: '', stderr: `can't find session: cc-${id}` };
    }
    calls.push(args);
    return { code: 0, stdout: '', stderr: '' };
  };
  const dbPath = path.join(home, '.ccrc', 'coord.db');
  const coord = new CoordStore(openCoordDb(dbPath));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const base = testDeps(home, run);
  const deps = { ...base, cfg, coord, notifyLog, tmux: new Tmux(run), presence: { isVisible: () => false },
    ...(opts.ccdVerbs === undefined ? {} : { fleetState: { ccdVerbs: opts.ccdVerbs } }) };
  let acts = 0;
  const newWatcher = (): FleetWatcher => {
    const w = new FleetWatcher(deps as never, new Bus(), 10_000);
    // The sweep's abandon, as `routes.ts`'s `withSweepAbandon` runs it: the real `closeRun`, `'sweep'`, the crashed id
    // and the executor's re-measure. (The serialiser itself is `buildServer`'s, pinned in the last case.)
    if (opts.server !== true) {
      w.useCoordSerialiser({ withSweepAbandon: (c, fn) => {
        acts += 1;
        if (opts.throwAct === true) throw new Error('database or disk is full');
        opts.beforeAct?.();
        return fn((runId, crashedId, stillCrashed) => closeRun(
          { coord: c, io: deps.io, cfg, runCcd: deps.runCcd }, runId, { intent: 'abandon' }, 'sweep', { claimedBy: crashedId, stillCrashed }));
      } });
    }
    return w;
  };
  let watcher = newWatcher();
  /** A coordinator's registry row: started, its supervisor heartbeat long gone — `orphan` unless `extra` says else. */
  const plant = (id: string, extra: Record<string, string> = {}): void => {
    for (const [f, v] of Object.entries({ uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`,
      started: '1', supervised: OLD_STAMP, ...extra })) writeFileSync(path.join(reg, `${id}.${f}`), v);
  };
  /** A working run of `program` claimed by `claimant`, dispatched into a fresh worker. */
  let workers = 0;
  const working = (claimant: string, program = `prog-${claimant}`): number => {
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: 2, claimedBy: claimant });
    if (!('id' in r)) throw new Error('openRun refused');
    const w = `demo-worker-${++workers}`;
    coord.markDispatched(r.id, w, w, `ws/${w}`, false);
    for (const to of ['dispatched', 'working'] as const) expect(coord.advance(r.id, to, 'coordinator').ok).toBe(true);
    return r.id;
  };
  /** One lane pass, after the lifecycle mirror's own sweep (as the tick runs both) — unless `mirror: false`. */
  const pass = async (o: { mirror?: boolean } = {}): Promise<void> => {
    if (o.mirror !== false) await watcher.sweepLifecycle();
    await watcher.sweepDeadCoordinators(await readRegistry(deps.io, cfg), readdirSync(reg));
  };
  const next = (): void => { clock += CHILD_RECLAIM_SWEEP_MS + 1; };
  const touch = (name: string): void => writeFileSync(path.join(reg, name), '');
  const stateOf = (id: number) => okRun(coord.run(id))!.state;
  const feed = () => coord.feedEvents(50).map((e) => [e.sessionId, e.title] as const);
  const anchorOf = (id: string) => { const a = coord.deadAnchors(); return a.ok ? a.anchors.get(id) ?? null : 'unreadable'; };
  const restart = (): void => { watcher = newWatcher(); };
  const journal = (id: string, act: string, over: Record<string, unknown> = {}): void => {
    coord.ingestJournal({ gen: '1790000000000000000', cursor: 1, size: 1, at: 1, rows: [parseJournalLine(JSON.stringify(
      { v: 1, uid: `w4lane.${id}.${act}.${clock}`, at: clock, act, outcome: 'done', id, dec: { surface: 'none' }, ...over }))] });
  };
  /** The attention list as the lane last built it, without a tick. */
  const attention = () => (watcher as unknown as { deadCoordinatorAttentionList: readonly { kind: string; claimants: string[]; sentence: string }[] })
    .deadCoordinatorAttentionList.map((a) => [a.kind, a.claimants] as const);
  return { home, reg, coord, deps, cfg, live, calls, tmuxAsked, plant, working, pass, next, touch, stateOf, feed, anchorOf,
    restart, journal, attention, acts: () => acts, advance: (ms: number) => { clock += ms; },
    setTmuxDown: (v: boolean) => { tmuxDown = v; }, watcher: () => watcher };
};
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Passes across `ms`, nine minutes apart — every gap inside the episode bound, as a live lane's minute passes are. */
const walk = async (f: Fixture, ms: number, o: { mirror?: boolean } = {}): Promise<void> => {
  for (let done = 0; done < ms; done += 9 * 60_000) { f.advance(Math.min(9 * 60_000, ms - done)); await f.pass(o); }
};
/** The first crashed pass, then passes across the hour: due at the last. */
const anHourDead = async (f: Fixture, o: { mirror?: boolean } = {}): Promise<void> => {
  await f.pass(o); await walk(f, HOUR, o);
};

describe('the lane SHIPS SHADOWED', () => {
  it('without the live file a crashed coordinator is RECORDED, once — and no run is ever closed, however long', async () => {
    const f = await fixture();
    f.plant(A);
    const r1 = f.working(A, 'alpha');
    const r2 = f.working(A, 'alpha');
    await anHourDead(f);
    for (let k = 0; k < 10; k += 1) { f.next(); await f.pass(); }
    expect([r1, r2].map(f.stateOf)).toEqual(['working', 'working']);
    expect(f.calls, 'nothing composed on the box').toEqual([]);
    expect(f.feed().filter(([, t]) => t === 'dead coordinator: programme would be ended')).toEqual([[A, 'dead coordinator: programme would be ended']]);
    await f.watcher().tick();
    const list = f.watcher().currentCoord()?.deadCoordinatorAttention ?? [];
    expect(list.map((a) => [a.kind, a.claimants])).toEqual([['would-end', [A]]]);
    expect(list[0]!.sentence).toContain('armed, it would end programme alpha (2 runs)');
    expect(f.watcher().currentCoord()?.expiryAttention, 'never the expiry lane’s list').toEqual([]);
  });

  it('with the live file, the programme is ENDED after the hour and two crashed passes — failed, by the sweep, one row per programme', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r1 = f.working(A, 'alpha');
    const r2 = f.working(A, 'beta');
    await f.pass(); await walk(f, HOUR - 60_000);
    expect([r1, r2].map(f.stateOf), 'not before the hour').toEqual(['working', 'working']);
    f.next(); await f.pass();
    expect([r1, r2].map(f.stateOf)).toEqual(['failed', 'failed']);
    expect(f.coord.runEvents(r1).at(-1)?.causedBy).toBe('sweep');
    expect(f.feed().filter(([, t]) => t === 'dead coordinator: programme ended')).toHaveLength(2);
    expect(f.anchorOf(A), 'its runs closed, it left the population — and its anchor with it on the next pass').not.toBeNull();
    f.next(); await f.pass();
    expect(f.anchorOf(A)).toBeNull();
  });

  it('at most ONE claimant is acted on per pass, the longest dead first', async () => {
    const f = await fixture();
    f.plant(A);
    const ra = f.working(A);
    await f.pass(); await walk(f, 15 * 60_000);   // A has been dead a quarter of an hour when B dies: no breaker
    f.plant(B);
    const rb = f.working(B);
    await walk(f, HOUR + 10 * 60_000);             // shadowed: both are due now, and both are only recorded
    expect([ra, rb].map(f.stateOf)).toEqual(['working', 'working']);
    expect(f.attention().map(([k, ids]) => [k, ids[0]]).sort(), 'shadow records EVERY due coordinator, not only the longest dead')
      .toEqual([['would-end', A], ['would-end', B]]);
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.next(); await f.pass();
    expect([ra, rb].map(f.stateOf), 'one a pass: A, dead the longest').toEqual(['failed', 'working']);
    f.next(); await f.pass();
    expect([ra, rb].map(f.stateOf)).toEqual(['failed', 'failed']);
  });

  it('SHADOW records every due coordinator, each once — the list the operator arms on hides none of them', async () => {
    const f = await fixture();
    f.plant(A);
    f.working(A, 'alpha');
    await f.pass(); await walk(f, 15 * 60_000);
    f.plant(B);
    f.working(B, 'beta');
    await walk(f, 2 * HOUR);
    const rows = f.feed().filter(([, t]) => t === 'dead coordinator: programme would be ended');
    expect(rows.map(([id]) => id).sort()).toEqual([A, B]);
    expect(f.attention().map(([k, ids]) => [k, ids[0]]).sort()).toEqual([['would-end', A], ['would-end', B]]);
    expect(f.calls).toEqual([]);
  });

  it('it never pushes — the stall watch’s r3 is the one push about a dead coordinator', async () => {
    const pushed = vi.spyOn(FleetWatcher.prototype as unknown as { pushOne: () => void }, 'pushOne');
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    f.working(A);
    await anHourDead(f);
    expect(pushed).not.toHaveBeenCalled();
  });
});

describe('the hour, made durable', () => {
  it('a single crashed pass is never enough, even an hour after a durable anchor — a restart needs two fresh passes', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass(); await walk(f, HOUR - 60_000);
    expect(f.anchorOf(A)).toMatchObject({ firstDeadAt: T0 });
    expect(f.stateOf(r)).toBe('working');
    f.restart();
    f.advance(2 * 60_000); await f.pass();
    expect(f.stateOf(r), 'an hour past the durable anchor, but this process has seen one pass').toBe('working');
    f.next(); await f.pass();
    expect(f.stateOf(r), 'the second pass: the hour counted from the durable anchor, not from the restart').toBe('failed');
  });

  it('a pass gap longer than the episode bound restarts the hour — a server down, or an older build running', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass();
    f.advance(2 * HOUR); await f.pass();
    expect(f.anchorOf(A), 'nothing measured it for two hours: a new episode').toMatchObject({ firstDeadAt: T0 + 2 * HOUR });
    f.next(); await f.pass();
    expect(f.stateOf(r)).toBe('working');
  });

  it('the supervisor stamp RAISES the anchor: a heartbeat after the first crashed pass delays the act', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass(); await walk(f, 27 * 60_000);
    writeFileSync(path.join(f.reg, `${A}.supervised`), String(Math.floor((T0 + 20 * 60_000) / 1000)));
    await walk(f, 36 * 60_000);
    expect(f.stateOf(r), 'an hour since firstDeadAt, but not since the stamp').toBe('working');
    await walk(f, 18 * 60_000);
    expect(f.stateOf(r)).toBe('failed');
  });
});

describe('the act’s own re-measure', () => {
  it('a revive the act sees inside the serialiser deletes the anchor and the run of passes — a later crash needs a fresh hour', async () => {
    let revive = false;
    const f: Fixture = await fixture({ beforeAct: () => { if (revive) f.live.add(A); } });
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass(); await walk(f, HOUR - 60_000);
    revive = true;
    f.next(); await f.pass();
    expect(f.stateOf(r), 'the act re-measured it alive and stopped').toBe('working');
    expect(f.anchorOf(A), 'evidence: the anchor goes').toBeNull();
    revive = false;
    f.live.delete(A);                                  // and it crashed again
    for (let k = 0; k < 4; k += 1) { f.next(); await f.pass(); }
    expect(f.stateOf(r), 'a fresh hour, not the pre-revive one').toBe('working');
    expect(f.anchorOf(A), 'the episode restarted at the first crashed pass after the revive')
      .toMatchObject({ firstDeadAt: T0 + HOUR - 60_000 + 2 * (CHILD_RECLAIM_SWEEP_MS + 1) });
  });

  it('an act that THROWS is asked again only after the backoff, and listed', async () => {
    const f = await fixture({ throwAct: true });
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    f.working(A);
    await anHourDead(f);
    const counts = [f.acts()];
    for (let k = 0; k < 2; k += 1) { f.next(); await f.pass(); counts.push(f.acts()); }
    expect(counts, 'once, then not on the next pass, then again after two minutes').toEqual([1, 1, 2]);
    expect(f.attention()).toEqual([['stuck', [A]]]);
  });
});

describe('a crash, and only a crash', () => {
  it('a live pane, a supervisor bringing it back, and a tmux that did not answer each DELETE the anchor', async () => {
    for (const how of ['live', 'restarting', 'unmeasurable'] as const) {
      const f = await fixture();
      f.plant(A);
      f.working(A);
      await f.pass();
      expect(f.anchorOf(A), how).not.toBeNull();
      if (how === 'live') f.live.add(A);
      if (how === 'restarting') writeFileSync(path.join(f.reg, `${A}.supervised`), String(Math.floor((T0 + CHILD_RECLAIM_SWEEP_MS) / 1000)));
      if (how === 'unmeasurable') f.setTmuxDown(true);
      f.next(); await f.pass();
      expect(f.anchorOf(A), how).toBeNull();
    }
  });

  it('a coordinator the operator STOPPED is never ended, nor one whose stop was followed by a failed revive', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A, { stopped: `${T0 / 1000} pwa` });
    f.plant(B);
    const ra = f.working(A);
    const rb = f.working(B);
    // B: a successful spawn, a stop from the PWA, then a revive that FAILED — ensure journaled, spawn rc 1.
    f.journal(B, 'spawn', { meas: { rc: '0' } });
    f.journal(B, 'stop', { dec: { surface: 'pwa' } });
    f.journal(B, 'ensure');
    f.journal(B, 'spawn', { meas: { rc: '1' } });
    for (let k = 0; k < 3; k += 1) { await anHourDead(f); f.next(); }
    expect([ra, rb].map(f.stateOf)).toEqual(['working', 'working']);
    expect([f.anchorOf(A), f.anchorOf(B)]).toEqual([null, null]);
  });

  it('a journal the lane cannot TRUST keeps every coordinator: a read that throws, ccd that does not journal, a gap since its start', async () => {
    for (const how of ['throws', 'unavailable', 'gap'] as const) {
      const f = await fixture(how === 'unavailable' ? { ccdVerbs: ['ws-release'] } : {});
      f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
      f.plant(A);
      const r = f.working(A);
      f.journal(A, 'spawn', { meas: { rc: '0' } });
      if (how === 'throws') f.coord.deadCoordinatorJournalRows = () => { throw new Error('database disk image is malformed'); };
      if (how === 'gap') f.coord.recordGap({ at: T0, gen: '1790000000000000000', reason: 'shrank', detail: 'd', lostFrom: 0, lostTo: 9 });
      await anHourDead(f);
      expect(f.stateOf(r), how).toBe('working');
      expect(f.anchorOf(A), how).toBeNull();
      expect(f.attention(), how).toEqual([['unmeasured', [A]]]);
    }
  });

  it('a mirror not swept since the restart, or gone stale, DECIDES NOTHING — no anchor written or deleted, nothing listed', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass();
    expect(f.anchorOf(A)).not.toBeNull();
    const kept = f.anchorOf(A);
    f.restart();                                       // a new process: its mirror has not swept yet
    await walk(f, 5 * 60_000, { mirror: false });
    expect(f.anchorOf(A), 'the durable anchor stands').toEqual(kept);
    await anHourDead(f, { mirror: false });
    expect(f.stateOf(r)).toBe('working');
  });

  it('an ABSENT row the mirror knows nothing about is listed, never acted on', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(B);                        // the registry lists cleanly — somebody is in it
    const r = f.working(A);            // A has no row at all, and no journal history
    await anHourDead(f);
    expect(f.stateOf(r)).toBe('working');
    await f.watcher().tick();
    expect((f.watcher().currentCoord()?.deadCoordinatorAttention ?? []).filter((a) => a.claimants.includes(A)).map((a) => a.kind))
      .toEqual(['unmeasured']);
  });
});

describe('the circuit breaker', () => {
  it('two coordinators dead within ten minutes of each other: the lane ends NOTHING, and says so once, naming both', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A); f.plant(B);
    const ra = f.working(A);
    const rb = f.working(B);
    for (let k = 0; k < 3; k += 1) { await anHourDead(f); f.next(); }
    expect([ra, rb].map(f.stateOf)).toEqual(['working', 'working']);
    await f.watcher().tick();
    const list = f.watcher().currentCoord()?.deadCoordinatorAttention ?? [];
    expect(list.map((a) => [a.kind, a.claimants])).toEqual([['breaker', [A, B]]]);
    expect(f.feed().filter(([, t]) => t === 'dead coordinator: breaker tripped'), 'its feed row, written once').toHaveLength(1);
  });

  it('IT REMEMBERS: one pass that cannot tell one of them crashed from put down on purpose does not dissolve the cluster', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A); f.plant(B);
    const ra = f.working(A);
    const rb = f.working(B);
    await f.pass(); await walk(f, 27 * 60_000);
    const uuid = path.join(f.reg, `${A}.uuid`);
    rmSync(uuid);                                      // A's row reads absent, and the mirror holds no history: unmeasured
    f.next(); await f.pass();
    expect(f.anchorOf(A), 'its anchor went (ruling E)').toBeNull();
    writeFileSync(uuid, `u-${A}`);                     // back: re-anchored half an hour after B
    await walk(f, HOUR + 20 * 60_000);
    expect([ra, rb].map(f.stateOf), 'B is due on its own anchor, and still held').toEqual(['working', 'working']);
    expect(f.attention()).toEqual([['breaker', [A, B]]]);
  });

  it('a FLEET-WIDE doubt trips it whatever the count: tmux down for one, a row gone for the other — nothing ends', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(B);
    const ra = f.working(A);                           // A has no row, but a history: it reads crashed before tmux is asked
    f.journal(A, 'create');
    const rb = f.working(B);
    f.setTmuxDown(true);
    await anHourDead(f);
    expect([ra, rb].map(f.stateOf)).toEqual(['working', 'working']);
    expect(f.attention()).toEqual([['breaker', [A, B]]]);
    const one = await fixture();
    one.plant(B);
    one.working(B);
    one.setTmuxDown(true);
    await one.pass();
    expect(one.attention(), 'one coordinator facing a tmux that does not answer is a fleet fault too').toEqual([['breaker', [B]]]);
  });

  it('it resumes once they fall back under the threshold — one revived, the other ends', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A); f.plant(B);
    const ra = f.working(A);
    const rb = f.working(B);
    await anHourDead(f);
    expect([ra, rb].map(f.stateOf)).toEqual(['working', 'working']);
    f.live.add(B);
    f.next(); await f.pass();
    expect([ra, rb].map(f.stateOf)).toEqual(['failed', 'working']);
  });

  it('is evaluated in SHADOW too, so the operator sees it before arming', async () => {
    const f = await fixture();
    f.plant(A); f.plant(B);
    f.working(A); f.working(B);
    await anHourDead(f);
    await f.watcher().tick();
    expect((f.watcher().currentCoord()?.deadCoordinatorAttention ?? []).map((a) => a.kind)).toEqual(['breaker']);
    expect(f.feed().filter(([, t]) => t.startsWith('dead coordinator')), 'the trip is recorded; nothing would be ended')
      .toEqual([[A, 'dead coordinator: breaker tripped']]);
  });
});

describe('the one cleanup switch', () => {
  it('`reclaim-paused` stops the lane ENTIRELY, shadow included: nothing measured, recorded or written — and a lowered switch needs two FRESH passes', async () => {
    const f = await fixture();
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass(); await walk(f, HOUR - 60_000);
    f.touch('reclaim-paused');
    const asked = f.tmuxAsked.length;
    await walk(f, 5 * 60_000);         // inside the episode bound: the anchor is still this episode's when it lifts
    expect(f.tmuxAsked.length, 'nothing measured').toBe(asked);
    expect(f.stateOf(r)).toBe('working');
    rmSync(path.join(f.reg, 'reclaim-paused'));
    f.next(); await f.pass();
    expect(f.stateOf(r), 'one pass after the pause is not two').toBe('working');
    f.next(); await f.pass();
    expect(f.stateOf(r)).toBe('failed');
  });
});

describe('the one cleanup switch, shadowed', () => {
  it('`reclaim-paused` stops the SHADOWED lane too: nothing asked, no anchor moved, no record, the list as it was', async () => {
    const f = await fixture();
    f.plant(A);
    f.working(A);
    await f.pass(); await walk(f, 30 * 60_000);
    f.touch('reclaim-paused');
    const asked = f.tmuxAsked.length;
    const anchor = f.anchorOf(A);
    const listed = f.attention();
    const fed = f.feed().length;
    await walk(f, 2 * HOUR);
    expect(f.tmuxAsked.length, 'nothing measured').toBe(asked);
    expect(f.anchorOf(A), 'no anchor written or deleted').toEqual(anchor);
    expect(f.attention()).toEqual(listed);
    expect(f.feed().length, 'nothing recorded').toBe(fed);
  });
});

describe('wired by buildServer', () => {
  it('the watcher is handed the coordination serialiser’s sweep handle, and ends a programme through it', async () => {
    const f = await fixture({ server: true });
    const app = await buildServer({ ...f.deps, mailToken: 'f'.repeat(64) } as never, new Bus(), f.watcher());
    try {
      f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
      f.plant(A);
      const r = f.working(A);
      await anHourDead(f);
      expect(f.stateOf(r)).toBe('failed');
      expect(f.coord.runEvents(r).at(-1)?.causedBy).toBe('sweep');
    } finally {
      await app.close();
    }
  });
});
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
    it('a connecting client receives hello, then fleet, then runs — and a later transition re-emits it', async () => {
      const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
      const opened = coord.openRun({
````

Replace with:

````ts
    it('a connecting client receives hello, then fleet, then runs — and a later transition re-emits it', async () => {
      const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
      // The claimant is a registered session (workspace lifecycle wave 4): an open run's claimant with NO registry row
      // and no journal history is listed by the dead-coordinator lane, and that list rides the coord frame.
      seedSession(home, 'ccrc-pwa-coordinator', 'claude-a');
      const opened = coord.openRun({
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
    it('skips the frame when a run row is UNREADABLE, and resumes once it is not', async () => {
      const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
      const opened = coord.openRun({
````

Replace with:

````ts
    it('skips the frame when a run row is UNREADABLE, and resumes once it is not', async () => {
      const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
      // The claimant is a registered session (workspace lifecycle wave 4): an open run's claimant with NO registry row
      // and no journal history is listed by the dead-coordinator lane, and that list rides the coord frame.
      seedSession(home, 'ccrc-pwa-coordinator', 'claude-a');
      const opened = coord.openRun({
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
    it('drops the frame from the broadcast when the JSON is unchanged', async () => {
      const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
      coord.openRun({
````

Replace with:

````ts
    it('drops the frame from the broadcast when the JSON is unchanged', async () => {
      const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
      // The claimant is a registered session (workspace lifecycle wave 4): an open run's claimant with NO registry row
      // and no journal history is listed by the dead-coordinator lane, and that list rides the coord frame.
      seedSession(home, 'ccrc-pwa-coordinator', 'claude-a');
      coord.openRun({
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
      expect(frame.coord).toEqual({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [] });
````

Replace with:

````ts
      expect(frame.coord).toEqual({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [], deadCoordinatorAttention: [] });
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
      expect(frame.coord).toEqual({ pause: 'set', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [] });
````

Replace with:

````ts
      expect(frame.coord).toEqual({ pause: 'set', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [], deadCoordinatorAttention: [] });
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
      expect((await next()).coord).toEqual({ pause: 'clear', mail: 'set', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [] });
````

Replace with:

````ts
      expect((await next()).coord).toEqual({ pause: 'clear', mail: 'set', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [], deadCoordinatorAttention: [] });
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
      expect((await next()).coord).toEqual({ pause: 'set', mail: 'set', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [] });
````

Replace with:

````ts
      expect((await next()).coord).toEqual({ pause: 'set', mail: 'set', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [], deadCoordinatorAttention: [] });
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
        { pause: 'clear', mail: 'clear', reclaim: 'set', childReclaimAttention: [], expiryAttention: [] });
````

Replace with:

````ts
        { pause: 'clear', mail: 'clear', reclaim: 'set', childReclaimAttention: [], expiryAttention: [], deadCoordinatorAttention: [] });
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
        { pause: 'set', mail: 'clear', reclaim: 'set', childReclaimAttention: [], expiryAttention: [] });
````

Replace with:

````ts
        { pause: 'set', mail: 'clear', reclaim: 'set', childReclaimAttention: [], expiryAttention: [], deadCoordinatorAttention: [] });
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
      expect(frame.type).toBe('coord');
      expect(frame.coord).toEqual({ pause: 'unmeasurable', mail: 'unmeasurable', reclaim: 'unmeasurable', childReclaimAttention: [], expiryAttention: [] });
      ws.close();
````

Replace with:

````ts
      expect(frame.type).toBe('coord');
      expect(frame.coord).toEqual({ pause: 'unmeasurable', mail: 'unmeasurable', reclaim: 'unmeasurable', childReclaimAttention: [], expiryAttention: [], deadCoordinatorAttention: [] });
      ws.close();
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
      expect((await next()).coord).toEqual({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [] });
````

Replace with:

````ts
      expect((await next()).coord).toEqual({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [], deadCoordinatorAttention: [] });
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
      expect(frame.coord).toEqual({ pause: 'unmeasurable', mail: 'unmeasurable', reclaim: 'unmeasurable', childReclaimAttention: [], expiryAttention: [] });
````

Replace with:

````ts
      expect(frame.coord).toEqual({ pause: 'unmeasurable', mail: 'unmeasurable', reclaim: 'unmeasurable', childReclaimAttention: [], expiryAttention: [], deadCoordinatorAttention: [] });
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
      expect((await next()).coord).toEqual({ pause: 'set', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [] });
````

Replace with:

````ts
      expect((await next()).coord).toEqual({ pause: 'set', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [], deadCoordinatorAttention: [] });
````


- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-lane.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/fleetws.test.ts --maxWorkers=1 )
```

Measured: `dead-coordinator-lane.test.ts`: `23 failed (23)` — × without the live file a crashed coordinator is RECORDED, once — and no run is ever closed, however long; × with the live file, the programme is ENDED after the hour and two crashed passes — failed, by the sweep, one row per programme; × at most ONE claimant is acted on per pass, the longest dead first; × SHADOW records every due coordinator, each once — the list the operator arms on hides none of them; × it never pushes — the stall watch’s r3 is the one push about a dead coordinator; × a single crashed pass is never enough, even an hour after a durable anchor — a restart needs two fresh passes; × a pass gap longer than the episode bound restarts the hour — a server down, or an older build running; × the supervisor stamp RAISES the anchor: a heartbeat after the first crashed pass delays the act; × a revive the act sees inside the serialiser deletes the anchor and the run of passes — a later crash needs a fresh hour; × an act that THROWS is asked again only after the backoff, and listed; × a live pane, a supervisor bringing it back, and a tmux that did not answer each DELETE the anchor; × a coordinator the operator STOPPED is never ended, nor one whose stop was followed by a failed revive; × a journal the lane cannot TRUST keeps every coordinator: a read that throws, ccd that does not journal, a gap since its start; × a mirror not swept since the restart, or gone stale, DECIDES NOTHING — no anchor written or deleted, nothing listed; × an ABSENT row the mirror knows nothing about is listed, never acted on; × two coordinators dead within ten minutes of each other: the lane ends NOTHING, and says so once, naming both; × IT REMEMBERS: one pass that cannot tell one of them crashed from put down on purpose does not dissolve the cluster; × a FLEET-WIDE doubt trips it whatever the count: tmux down for one, a row gone for the other — nothing ends; × it resumes once they fall back under the threshold — one revived, the other ends; × is evaluated in SHADOW too, so the operator sees it before arming; × `reclaim-paused` stops the lane ENTIRELY, shadow included: nothing measured, recorded or written — and a lowered switch needs two FRESH passes; × `reclaim-paused` stops the SHADOWED lane too: nothing asked, no anchor moved, no record, the list as it was; × the watcher is handed the coordination serialiser’s sweep handle, and ends a programme through it; `fleetws.test.ts`: `6 failed | 48 passed (54)` — × sends coord after hello/fleet/runs on connect, when it has ever measured; × re-emits only on CHANGE, byte-equality guarded like runs; × reports set for coordinator-paused and clear for mail-disabled independently; × reports set for reclaim-paused, independently of the other two markers; × reports unmeasurable for BOTH markers when the registry cannot be listed; × emits coord on the tick that FAILS SHUT — before the early return, not after it

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/server.ts -->
In `server/src/server.ts`, find:

````ts
  const coordRoutes = registerCoordRoutes(app, deps, bus, sessionAuth, askDeps, watcher);
````

Replace with:

````ts
  const coordRoutes = registerCoordRoutes(app, deps, bus, sessionAuth, askDeps, watcher);
  // The dead-coordinator lane (workspace lifecycle §5.4) ends a programme only on this same serialiser: the watcher is
  // handed the sweep's abandon here, and has no other way to close a run. Called optionally: a test's stand-in watcher
  // (a structural double, not a `FleetWatcher`) carries no such method, and has no lane to hand it to.
  watcher?.useCoordSerialiser?.(coordRoutes);
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts
  ChildMark, ChildReclaimAttention, ChildReclaimKeptWord, CoordStatus, Dialog, ExpiryAttention, FleetSession, HookAsk, HookAskQuestion,
````

Replace with:

````ts
  ChildMark, ChildReclaimAttention, ChildReclaimKeptWord, CoordStatus, DeadCoordinatorAttention, Dialog, ExpiryAttention, FleetSession, HookAsk, HookAskQuestion,
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts
import { expireArchived, expiryReviewing, learnExpiry, recordExpireFeed } from './coord/expireArchived.js';
````

Replace with:

````ts
import { expireArchived, expiryReviewing, learnExpiry, recordExpireFeed } from './coord/expireArchived.js';
import {
  deadAnchorNext, deadCoordinatorAttention, deadCoordinatorBreaker,
  deadCoordinatorBreakerKey, deadCoordinatorCrash, deadCoordinatorDue, deadCoordinatorEntry, deadCoordinatorJournal,
  deadCoordinatorNextEntry, deadCoordinatorOutcomeKey, deadCoordinatorSighted, deadCoordinatorSince, deadCoordinatorThrew,
  type ClaimantDeadCause, type DeadAnchor, type DeadCoordinatorActOutcome, type DeadCoordinatorBreaker,
  type DeadCoordinatorBreakerMember, type DeadCoordinatorEntry, type DeadCoordinatorJournal,
} from './deadCoordinator.js';
import {
  deadCoordinatorLaneArmed, endDeadCoordinator, readDeadCoordinatorJournalTrust, recordDeadCoordinatorBreaker,
  recordDeadCoordinatorFeed,
} from './coord/endDeadCoordinator.js';
import type { CoordRoutesHandle } from './coord/routes.js';
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts
  private archivedExpiryBoxRefused: string | null = null;
````

Replace with:

````ts
  private archivedExpiryBoxRefused: string | null = null;
  /** THE DEAD-COORDINATOR LANE (workspace lifecycle wave 4): its clock; ONE PASS AT A TIME, the expiry lane's reason;
   *  its memory per claimant (IN MEMORY: the run of crashed passes, the backoff, the last outcome and the report — the
   *  durable half, the first-dead anchor, is `coord.db`'s `dead_claimants`); its breaker as the last pass measured it;
   *  and its attention list, which `emitCoord` reads. */
  private lastDeadCoordinatorSweep = 0;
  private deadCoordinatorSweeping = false;
  private deadCoordinatorState = new Map<string, DeadCoordinatorEntry>();
  private deadCoordinatorBreakerState: DeadCoordinatorBreaker = { tripped: false };
  /** The breaker's memory: the members it holds with their ORIGINAL first-dead instants, released only on evidence
   *  (`breaker-remembers-its-cluster`); and the key of the trip its feed row last recorded. */
  private deadCoordinatorBreakerHeld: readonly DeadCoordinatorBreakerMember[] = [];
  private deadCoordinatorBreakerRecorded: string | null = null;
  private deadCoordinatorAttentionList: readonly DeadCoordinatorAttention[] = [];
  /** The coordination serialiser's sweep handle (`CoordRoutesHandle.withSweepAbandon`), handed over by `buildServer`
   *  once `registerCoordRoutes` has built it. Until then the lane measures and records, and ends nothing. */
  private deadCoordinatorSerial: CoordRoutesHandle['withSweepAbandon'] | null = null;
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts

  /** The last measured project-pool sweep, or null if none has been taken yet
````

Replace with:

````ts

  /** The dead-coordinator lane's memory, read-only (wave 4) — for its tests. */
  currentDeadCoordinators(): ReadonlyMap<string, DeadCoordinatorEntry> {
    return this.deadCoordinatorState;
  }

  /** `buildServer` hands the lane the coordination serialiser's sweep handle (workspace lifecycle spec §5.4: "the lane
   *  runs on the coordination serialiser, exported from `registerCoordRoutes`"). The lane's ONLY way to end a run. */
  useCoordSerialiser(h: Pick<CoordRoutesHandle, 'withSweepAbandon'>): void {
    this.deadCoordinatorSerial = h.withSweepAbandon;
  }

  /** The last measured project-pool sweep, or null if none has been taken yet
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts
      void this.sweepArchivedExpiry(records, registryRead.names)
````

Replace with:

````ts
      void this.sweepArchivedExpiry(records, registryRead.names)
        .catch(() => { /* one bad sweep must not kill the poll */ });
      // NEVER awaited, the same reasons: the DEAD-COORDINATOR lane (workspace lifecycle wave 4) — a third sibling on
      // this tick's registry read, cadence and switch, sharing nothing else; its act waits on the coordination
      // serialiser behind whatever write route is running.
      void this.sweepDeadCoordinators(records, registryRead.names)
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts
          childReclaimAttention: this.childReclaimAttentionList, expiryAttention: this.expiryAttentionList }
````

Replace with:

````ts
          childReclaimAttention: this.childReclaimAttentionList, expiryAttention: this.expiryAttentionList,
          deadCoordinatorAttention: this.deadCoordinatorAttentionList }
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts
          childReclaimAttention: this.childReclaimAttentionList, expiryAttention: this.expiryAttentionList };
````

Replace with:

````ts
          childReclaimAttention: this.childReclaimAttentionList, expiryAttention: this.expiryAttentionList,
          deadCoordinatorAttention: this.deadCoordinatorAttentionList };
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts
    return review.ok ? { ok: true, openWorker, openClaimant, reviewing: review.reviewing } : review;
````

Replace with:

````ts
    return review.ok ? { ok: true, openWorker, openClaimant, reviewing: review.reviewing } : review;
  }

  /**
   * THE DEAD-COORDINATOR LANE (workspace lifecycle spec 2026-09-24 §5.4, wave 4): a coordinator that CRASHED and has
   * stayed dead an hour, with no successor, has its open runs closed `failed` — and CCR-15 then reclaims its marked
   * children. A THIRD SIBLING of `sweepChildReclaim` on the same tick, with its registry read, its cadence
   * (`CHILD_RECLAIM_SWEEP_MS`) and its switch (`reclaim-paused`, the fleet's one cleanup switch) — and nothing else:
   * its own memory, verdicts (`deadCoordinator.ts`, L1), executor (`endDeadCoordinator`), feed rows and attention list
   * (the expiry lane's shape, `expiry-lane-is-a-sibling-pass`).
   *
   * IT SHIPS SHADOWED (the coordinator's safety ruling (B)). Until the operator touches `$REG/dead-coordinator-lane-live`
   * by hand, a due claimant is RECORDED — "would end programme <slug> (<n> runs)", a feed row and an attention entry —
   * and `closeRun`'s abandon arm is never reached; the executor re-reads the file inside the serialiser. The anchors and
   * the breaker are kept in shadow too, so the operator sees them before arming. `reclaim-paused` stops it ENTIRELY.
   *
   * WHO IT MEASURES: the distinct claimants of non-terminal runs, each with the reclaim door's own ladder
   * (`measureClaimant`, its dead arm carrying `cause`), plus ONE store read of the journal clause for the dead ones.
   * A crash, and only a crash, writes the durable first-dead anchor; any other answer deletes it — and a journal the
   * lane cannot trust to hold every deliberate act is no crash. DUE when an hour has passed since
   * `max(firstDeadAt, .supervised)` and the two latest passes both measured it crashed. Armed, AT MOST ONE claimant is
   * acted on per pass, the longest dead first; in shadow every due one is recorded; never while the circuit breaker
   * stands.
   *
   * IT NEVER PUSHES. The stall watch is what notifies about a dead coordinator: per stalled worker, its r3
   * (`coordinator-dead`, "Reclaim the run") and — once its wave-2 arms are armed — `coord-deaf` for a worker's unacked
   * ball-passing mail, each naming the worker's workspace and the coordinator. This lane's rows are records and
   * attention entries keyed by the same claimant id, so they read as that incident's outcome, never a second one.
   */
  async sweepDeadCoordinators(records: readonly SessionRecord[], names: readonly string[]): Promise<void> {
    const coord = this.deps.coord;
    if (!coord || this.deadCoordinatorSweeping) return;
    const now = Date.now();
    if (this.lastDeadCoordinatorSweep !== 0 && now - this.lastDeadCoordinatorSweep < CHILD_RECLAIM_SWEEP_MS) return;
    this.lastDeadCoordinatorSweep = now;
    this.deadCoordinatorSweeping = true;
    try {
      await this.deadCoordinatorPass(coord, records, names, now);
    } finally {
      this.deadCoordinatorSweeping = false;
    }
  }

  /** One pass of the dead-coordinator lane — `sweepDeadCoordinators`'s body, run only while no other pass runs. */
  private async deadCoordinatorPass(
    coord: CoordStore, records: readonly SessionRecord[], names: readonly string[], now: number,
  ): Promise<void> {
    const forget = (): void => {
      for (const [id, e] of this.deadCoordinatorState) {
        if (e.crashedPasses !== 0) this.deadCoordinatorState.set(id, { ...e, crashedPasses: 0 });
      }
    };
    // ONE — the switch. `reclaim-paused` stops the lane entirely, shadow included: nothing is measured, recorded or
    // written. The run of crashed passes is forgotten, so a lowered switch needs two FRESH passes; the durable anchors
    // stand (the next crashed pass continues them, or the gap restarts them).
    if (names.includes(RECLAIM_PAUSE_MARKER)) { forget(); return; }
    // TWO — the journal's own trust (`readDeadCoordinatorJournalTrust`): a mirror not swept yet, or gone stale,
    // decides NOTHING this pass — no anchor is written or deleted, and the run of crashed passes starts again.
    const journal = await readDeadCoordinatorJournalTrust({ coord, io: this.deps.io, cfg: this.deps.cfg }, this.lifecycleHealth());
    if (journal.hold !== null) {
      console.warn(`ccrc-server: sweepDeadCoordinators: ${journal.hold} — no decisions this pass`);
      forget();
      return;
    }
    // THREE — the population, the anchors: one statement each. Either failing decides nothing this pass.
    let ids: string[];
    let anchors: ReadonlyMap<string, DeadAnchor>;
    try {
      ids = [...new Set(coord.openCoordinatorIds())].sort();
      const a = coord.deadAnchors();
      if (!a.ok) throw new Error(a.detail);
      anchors = a.anchors;
    } catch (err) {
      console.warn(`ccrc-server: sweepDeadCoordinators could not read the coordination store (${err instanceof Error ? err.message : String(err)}) — no decisions this pass`);
      forget();
      return;
    }
    // FOUR — each claimant, measured by the reclaim door's own ladder, one at a time, through a tmux port that notes
    // a tmux that did not answer (a FLEET-wide doubt the breaker reads); then the journal clause for the dead ones in
    // ONE store read. A read that throws is `unreadable` for each of them — never "no history".
    const fleetDoubt: string[] = [];
    const tmux = {
      sessionVerdict: async (id: string) => {
        const v = await this.deps.tmux.sessionVerdict(id);
        if (v.verdict === 'unknown') fleetDoubt.push(`tmux did not answer for ${id}: ${v.detail}`);
        return v;
      },
    };
    const measured = new Map<string, Awaited<ReturnType<typeof measureClaimant>>>();
    for (const id of ids) {
      measured.set(id, await measureClaimant({ coord, io: this.deps.io, cfg: this.deps.cfg, tmux }, id, now));
    }
    const dead = ids.filter((id) => measured.get(id)!.state === 'dead');
    let journalOf: (id: string) => DeadCoordinatorJournal;
    try {
      const rows = coord.deadCoordinatorJournalRows(dead);
      journalOf = (id) => {
        const j = rows.get(id);
        return j === undefined ? { kind: 'no-history' } : deadCoordinatorJournal(j.rows, j.hasHistory, journal.trust);
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      journalOf = () => ({ kind: 'unreadable', detail });
    }
    // FIVE — a crash and only a crash keeps (or starts) the durable anchor; any other answer deletes it.
    const crashed: { id: string; firstDeadAt: number; since: number; cause: Exclude<ClaimantDeadCause, 'stopped'> }[] = [];
    const unmeasurable: string[] = [];
    /** Claimants this pass gave EVIDENCE about — alive, stopped, a deliberate act: the breaker releases them. */
    const released = new Set<string>();
    for (const id of ids) {
      const c = deadCoordinatorCrash(measured.get(id)!, journalOf(id));
      if (c.kind === 'unmeasurable') unmeasurable.push(id);
      if (c.kind === 'alive' || c.kind === 'stopped' || c.kind === 'deliberate') released.add(id);
      let entry = deadCoordinatorSighted(this.deadCoordinatorState.get(id) ?? deadCoordinatorEntry(), c, now);
      try {
        if (c.kind === 'crashed') {
          const a = deadAnchorNext(anchors.get(id) ?? null, now);
          coord.setDeadAnchor(id, a);
          const supervisedAt = records.find((r) => r.id === id)?.supervisedAt ?? null;
          crashed.push({ id, firstDeadAt: a.firstDeadAt, since: deadCoordinatorSince(a, supervisedAt, now), cause: c.cause });
        } else if (anchors.has(id)) {
          coord.deleteDeadAnchor(id);
        }
      } catch (err) {
        // An anchor this pass could not write is an hour nobody can count: the run of crashed passes starts again.
        console.warn(`ccrc-server: sweepDeadCoordinators could not keep ${id}'s anchor (${err instanceof Error ? err.message : String(err)})`);
        entry = { ...entry, crashedPasses: 0 };
      }
      this.deadCoordinatorState.set(id, entry);
    }
    // A claimant that left the population (its runs closed, or reclaimed by an heir) is forgotten, anchor and all.
    for (const id of [...this.deadCoordinatorState.keys()]) if (!ids.includes(id)) this.deadCoordinatorState.delete(id);
    for (const id of anchors.keys()) {
      if (!ids.includes(id)) {
        try { coord.deleteDeadAnchor(id); } catch { /* the next pass deletes it */ }
      }
    }
    // SIX — the circuit breaker, evaluated in shadow too, WITH ITS MEMORY: a member stays held until this pass gave
    // evidence about it or it left the population; a pass that only doubted it keeps it, at its first instant.
    const held = this.deadCoordinatorBreakerHeld.filter((m) => ids.includes(m.id) && !released.has(m.id));
    const breaker = deadCoordinatorBreaker(crashed, held, unmeasurable, ids.length,
      fleetDoubt.length === 0 ? null : fleetDoubt.join('; '), now);
    this.deadCoordinatorBreakerState = breaker;
    this.deadCoordinatorBreakerHeld = breaker.tripped ? breaker.members : [];
    const key = deadCoordinatorBreakerKey(breaker);
    if (breaker.tripped && key !== this.deadCoordinatorBreakerRecorded) {
      recordDeadCoordinatorBreaker({ coord, notifyLog: this.deps.notifyLog }, breaker);
    }
    this.deadCoordinatorBreakerRecorded = key;
    // SEVEN — the act, never while the breaker stands, the longest dead first. ARMED, at most ONE claimant a pass. In
    // SHADOW every due claimant is recorded — a would-end touches nothing on the box, and the shadow list is what the
    // operator arms on (`shadow-records-every-due-coordinator`). The executor decides shadow from its own listing, so
    // an outcome that is not a would-end ends the pass however this pass's listing read.
    if (!breaker.tripped) {
      const due = crashed.filter((c) => {
        const e = this.deadCoordinatorState.get(c.id)!;
        return deadCoordinatorDue(c.since, e.crashedPasses, now) && now >= e.nextAskAt;
      }).sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1));
      const armed = deadCoordinatorLaneArmed(names);
      for (const pick of due) {
        const out = await this.deadCoordinatorAct(coord, pick, now);
        if (armed || out?.kind !== 'would-end') break;
      }
    }
    // EIGHT — the attention list, from the lane's memory and its breaker alone.
    this.deadCoordinatorAttentionList = deadCoordinatorAttention(this.deadCoordinatorState, this.deadCoordinatorBreakerState);
  }

  /** The act — or its shadow — for one due claimant, on the coordination serialiser. Its outcome, or `null` when it
   *  was not asked (no serialiser) or threw. */
  private async deadCoordinatorAct(
    coord: CoordStore, pick: { id: string; since: number; cause: Exclude<ClaimantDeadCause, 'stopped'> }, now: number,
  ): Promise<DeadCoordinatorActOutcome | null> {
    const serial = this.deadCoordinatorSerial;
    if (serial === null) {
      console.warn(`ccrc-server: sweepDeadCoordinators: ${pick.id} is due, but no coordination serialiser is wired — nothing ended or recorded`);
      return null;
    }
    const deps = { coord, io: this.deps.io, cfg: this.deps.cfg, tmux: this.deps.tmux, notifyLog: this.deps.notifyLog,
      journalTrust: async () => (await readDeadCoordinatorJournalTrust({ coord, io: this.deps.io, cfg: this.deps.cfg },
        this.lifecycleHealth())).trust };
    try {
      const out = await serial(coord, (abandon) => endDeadCoordinator({ ...deps, abandon }, pick.id, now));
      const e = this.deadCoordinatorState.get(pick.id) ?? deadCoordinatorEntry();
      // An act is always news; a shadow record or a pause is written when it CHANGES.
      if (out.kind === 'ended' || deadCoordinatorOutcomeKey(out) !== e.lastOutcome) {
        recordDeadCoordinatorFeed({ coord, notifyLog: this.deps.notifyLog }, pick.id, out, pick.since);
      }
      this.deadCoordinatorState.set(pick.id, deadCoordinatorNextEntry(e, out, pick.cause, pick.since, Date.now(), CHILD_RECLAIM_SWEEP_MS));
      // A re-measure that found it NOT crashed is evidence: its hour starts again from the next crash
      // (`a-stopped-act-forgets-its-passes`).
      if (out.kind === 'ended' && out.stoppedBy?.kind === 'remeasured') {
        try { coord.deleteDeadAnchor(pick.id); } catch { /* the next pass's own answer deletes or keeps it */ }
      }
      return out;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.warn(`ccrc-server: sweepDeadCoordinators: the act on ${pick.id} threw (${detail}) — asked again after a backoff`);
      const e = this.deadCoordinatorState.get(pick.id) ?? deadCoordinatorEntry();
      this.deadCoordinatorState.set(pick.id, deadCoordinatorThrew(e, detail, Date.now(), CHILD_RECLAIM_SWEEP_MS));
      return null;
    }
````


- [ ] **Step 4: Run — green**, with the suites that tick a watcher beside it (Pre-flight finding 7):

```bash
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-lane.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/fleetws.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/lifecycle.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-lane.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/tsc --noEmit -p . )
```

Measured: `dead-coordinator-lane.test.ts`: `23 passed (23)`; `fleetws.test.ts`: `54 passed (54)`; `lifecycle.test.ts`: `52 passed (52)`; `archived-expiry-lane.test.ts`: `27 passed (27)`; `child-reclaim-sweep.test.ts`: `177 passed (177)`; `tsc` rc 0. Every server file that constructs a `FleetWatcher` (36 on the re-based tree: `main`'s 34 and this plan's two) was re-run as drafted, inside Task 14's full server run on the revised prototype, and again on the re-based prototype's final tree — each green.

- [ ] **Step 5: Mutation check, then commit.** Row T11.1 is ruling (F)'s red: the breaker deleted at the lane; T11.13 and T11.14 its memory and its fleet-wide arm. Rows T11.23–T11.30 repeat edits of Tasks 6 and 10 against this lane's tests — the reds only the lane can show (the review asked that they be listed): T11.23 is T6.12's edit, T11.24 T6.24's, T11.25 T6.26's, T11.26 T6.28's, T11.27–T11.29 the trust adapter's three arms, T11.30 T10.5's.

| # | Edit (restore after) | Measured red |
|---|---|---|
| T11.1 | `server/src/watch.ts`: `    if (!breaker.tripped) {` → `    if (true) {` | `dead-coordinator-lane.test.ts`: `5 failed \| 18 passed (23)` — two coordinators dead within ten minutes of each other: the lane ends NOTHING, and says so once, naming both; IT REMEMBERS: one pass that cannot tell one of them crashed from put down on purpose does not dissolve the cluster; a FLEET-WIDE doubt trips it whatever the count: tmux down for one, a row gone for the other — nothing ends; it resumes once they fall back under the threshold — one revived, the other ends; is evaluated in SHADOW too, so the operator sees it before arming |
| T11.2 | `server/src/watch.ts`: `        } else if (anchors.has(id)) { ⏎           coord.deleteDeadAnchor(id); ⏎         }` → `        }` | `dead-coordinator-lane.test.ts`: `2 failed \| 21 passed (23)` — a live pane, a supervisor bringing it back, and a tmux that did not answer each DELETE the anchor; IT REMEMBERS: one pass that cannot tell one of them crashed from put down on purpose does not dissolve the cluster |
| T11.3 | `server/src/watch.ts`: `    if (names.includes(RECLAIM_PAUSE_MARKER)) { forget(); return; }` → (removed) | `dead-coordinator-lane.test.ts`: `2 failed \| 21 passed (23)` — `reclaim-paused` stops the lane ENTIRELY, shadow included: nothing measured, recorded or written — and a lowered switch needs two FRESH passes; `reclaim-paused` stops the SHADOWED lane too: nothing asked, no anchor moved, no record, the list as it was |
| T11.4 | `server/src/watch.ts`: `    if (names.includes(RECLAIM_PAUSE_MARKER)) { forget(); return; }` → `    if (names.includes(RECLAIM_PAUSE_MARKER)) { return; }` | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — `reclaim-paused` stops the lane ENTIRELY, shadow included: nothing measured, recorded or written — and a lowered switch needs two FRESH passes |
| T11.5 | `server/src/watch.ts`: `          crashed.push({ id, firstDeadAt: a.firstDeadAt, since: deadCoordinatorSince(a, supervisedAt, now), cause: c.cause });` → `          crashed.push({ id, firstDeadAt: a.firstDeadAt, since: deadCoordinatorSince(a, null, now), cause: c.cause });` | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — the supervisor stamp RAISES the anchor: a heartbeat after the first crashed pass delays the act |
| T11.6 | `server/src/watch.ts`: `      const c = deadCoordinatorCrash(measured.get(id)!, journalOf(id));` → `      const c = deadCoordinatorCrash(measured.get(id)!, { kind: 'quiet', started: true });` | `dead-coordinator-lane.test.ts`: `3 failed \| 20 passed (23)` — a journal the lane cannot TRUST keeps every coordinator: a read that throws, ccd that does not journal, a gap since its start; an ABSENT row the mirror knows nothing about is listed, never acted on; IT REMEMBERS: one pass that cannot tell one of them crashed from put down on purpose does not dissolve the cluster |
| T11.7 | `server/src/server.ts`: `  watcher?.useCoordSerialiser?.(coordRoutes); ⏎ ` → (removed) | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — the watcher is handed the coordination serialiser’s sweep handle, and ends a programme through it |
| T11.8 | `server/src/watch.ts`: `        if (armed \|\| out?.kind !== 'would-end') break; ⏎ ` → (removed) | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — at most ONE claimant is acted on per pass, the longest dead first |
| T11.9 | `server/src/watch.ts`: `      }).sort((a, b) => a.since - b.since \|\| (a.id < b.id ? -1 : 1));` → `      }).sort((a, b) => b.since - a.since \|\| (a.id < b.id ? -1 : 1));` | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — at most ONE claimant is acted on per pass, the longest dead first |
| T11.10 | `server/src/watch.ts`: `          deadCoordinatorAttention: this.deadCoordinatorAttentionList };` → `          };` | `dead-coordinator-lane.test.ts`: `4 failed \| 19 passed (23)` — without the live file a crashed coordinator is RECORDED, once — and no run is ever closed, however long; an ABSENT row the mirror knows nothing about is listed, never acted on; two coordinators dead within ten minutes of each other: the lane ends NOTHING, and says so once, naming both; is evaluated in SHADOW too, so the operator sees it before arming<br>`fleetws.test.ts`: `5 failed \| 49 passed (54)` — sends coord after hello/fleet/runs on connect, when it has ever measured; re-emits only on CHANGE, byte-equality guarded like runs; reports set for coordinator-paused and clear for mail-disabled independently; reports set for reclaim-paused, independently of the other two markers; emits coord on the tick that FAILS SHUT — before the early return, not after it |
| T11.11 | `server/src/watch.ts`: `      if (out.kind === 'ended' \|\| deadCoordinatorOutcomeKey(out) !== e.lastOutcome) {` → `      if (true) {` | `dead-coordinator-lane.test.ts`: `2 failed \| 21 passed (23)` — without the live file a crashed coordinator is RECORDED, once — and no run is ever closed, however long; SHADOW records every due coordinator, each once — the list the operator arms on hides none of them |
| T11.12 | `server/src/watch.ts`: `        if (armed \|\| out?.kind !== 'would-end') break;` → `        break;` | `dead-coordinator-lane.test.ts`: `2 failed \| 21 passed (23)` — at most ONE claimant is acted on per pass, the longest dead first; SHADOW records every due coordinator, each once — the list the operator arms on hides none of them |
| T11.13 | `server/src/watch.ts`: `    const held = this.deadCoordinatorBreakerHeld.filter((m) => ids.includes(m.id) && !released.has(m.id));` → `    const held: DeadCoordinatorBreakerMember[] = [];` | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — IT REMEMBERS: one pass that cannot tell one of them crashed from put down on purpose does not dissolve the cluster |
| T11.14 | `server/src/watch.ts`: `      fleetDoubt.length === 0 ? null : fleetDoubt.join('; '), now);` → `      null, now);` | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — a FLEET-WIDE doubt trips it whatever the count: tmux down for one, a row gone for the other — nothing ends |
| T11.15 | `server/src/watch.ts`: `    if (journal.hold !== null) {` → `    if (false) {` | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — a mirror not swept since the restart, or gone stale, DECIDES NOTHING — no anchor written or deleted, nothing listed |
| T11.16 | `server/src/watch.ts`: `        return j === undefined ? { kind: 'no-history' } : deadCoordinatorJournal(j.rows, j.hasHistory, journal.trust);` → `        return j === undefined ? { kind: 'no-history' } : deadCoordinatorJournal(j.rows, j.hasHistory, { untrusted: null, gapGens: [], lastWriteErrorAt: null });` | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — a journal the lane cannot TRUST keeps every coordinator: a read that throws, ccd that does not journal, a gap since its start |
| T11.17 | `server/src/watch.ts`: `      journalOf = () => ({ kind: 'unreadable', detail });` → `      journalOf = () => ({ kind: 'quiet', started: true });` | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — a journal the lane cannot TRUST keeps every coordinator: a read that throws, ccd that does not journal, a gap since its start |
| T11.18 | `server/src/watch.ts`: `      if (out.kind === 'ended' && out.stoppedBy?.kind === 'remeasured') {` → `      if (false) {` | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — a revive the act sees inside the serialiser deletes the anchor and the run of passes — a later crash needs a fresh hour |
| T11.19 | `server/src/watch.ts`: `      this.deadCoordinatorState.set(pick.id, deadCoordinatorThrew(e, detail, Date.now(), CHILD_RECLAIM_SWEEP_MS)); ⏎ ` → (removed) | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — an act that THROWS is asked again only after the backoff, and listed |
| T11.20 | `server/src/watch.ts`: `        recordDeadCoordinatorFeed({ coord, notifyLog: this.deps.notifyLog }, pick.id, out, pick.since);` → `        recordDeadCoordinatorFeed({ coord, notifyLog: this.deps.notifyLog }, pick.id, out, pick.since); ⏎         this.pushOne({ kind: 'run', sessionId: pick.id, project: '', title: 'x', body: 'y' }, this.activeProjects);` | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — it never pushes — the stall watch’s r3 is the one push about a dead coordinator |
| T11.21 | `server/src/watch.ts`: `    if (breaker.tripped && key !== this.deadCoordinatorBreakerRecorded) {` → `    if (breaker.tripped) {` | `dead-coordinator-lane.test.ts`: `2 failed \| 21 passed (23)` — two coordinators dead within ten minutes of each other: the lane ends NOTHING, and says so once, naming both; is evaluated in SHADOW too, so the operator sees it before arming |
| T11.22 | `server/src/watch.ts`: `    if (names.includes(RECLAIM_PAUSE_MARKER)) { forget(); return; }` → `    if (names.includes(RECLAIM_PAUSE_MARKER) && deadCoordinatorLaneArmed(names)) { forget(); return; }` | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — `reclaim-paused` stops the SHADOWED lane too: nothing asked, no anchor moved, no record, the list as it was |
| T11.23 | `server/src/deadCoordinator.ts`: `  crashedPasses >= 2 && nowMs - since >= DEAD_COORDINATOR_AFTER_MS;` → `  crashedPasses >= 1 && nowMs - since >= DEAD_COORDINATOR_AFTER_MS;` | `dead-coordinator-lane.test.ts`: `2 failed \| 21 passed (23)` — a single crashed pass is never enough, even an hour after a durable anchor — a restart needs two fresh passes; `reclaim-paused` stops the lane ENTIRELY, shadow included: nothing measured, recorded or written — and a lowered switch needs two FRESH passes |
| T11.24 | `server/src/deadCoordinator.ts`: `  for (const h of held) firstDead.set(h.id, h.firstDeadAt); ⏎ ` → (removed) | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — IT REMEMBERS: one pass that cannot tell one of them crashed from put down on purpose does not dissolve the cluster |
| T11.25 | `server/src/deadCoordinator.ts`: `  return { ...e, attempts, nextAskAt: nowMs + deadCoordinatorBackoffMs(attempts, passMs), ⏎     report: { kind: 'stuck', at: e.report?.kind === 'stuck' ? e.report.at : nowMs, runs: [], error } };` → `  return { ...e, attempts, nextAskAt: 0, ⏎     report: { kind: 'stuck', at: e.report?.kind === 'stuck' ? e.report.at : nowMs, runs: [], error } };` | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — an act that THROWS is asked again only after the backoff, and listed |
| T11.26 | `server/src/deadCoordinator.ts`: `    return { ...e, crashedPasses: e.crashedPasses + 1, report: e.report?.kind === 'unmeasured' ? null : e.report };` → `    return { ...e, crashedPasses: e.crashedPasses + 1 };` | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — IT REMEMBERS: one pass that cannot tell one of them crashed from put down on purpose does not dissolve the cluster |
| T11.27 | `server/src/coord/endDeadCoordinator.ts`: ``  if (health.state === 'unknown' \|\| health.state === 'stale') return untrusted(`the lifecycle mirror is ${health.state}`, true); ⏎ `` → (removed) | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — a mirror not swept since the restart, or gone stale, DECIDES NOTHING — no anchor written or deleted, nothing listed |
| T11.28 | `server/src/coord/endDeadCoordinator.ts`: `  if (health.state === 'unavailable') return untrusted('the fleet box’s ccd does not journal (no lifecycle-v1)', false); ⏎ ` → (removed) | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — a journal the lane cannot TRUST keeps every coordinator: a read that throws, ccd that does not journal, a gap since its start |
| T11.29 | `server/src/coord/endDeadCoordinator.ts`: `    gapGens = deps.coord.lifecycleGapGens();` → `    gapGens = [];` | `dead-coordinator-lane.test.ts`: `1 failed \| 22 passed (23)` — a journal the lane cannot TRUST keeps every coordinator: a read that throws, ccd that does not journal, a gap since its start |
| T11.30 | `server/src/coord/endDeadCoordinator.ts`: `  if (!deadCoordinatorLaneArmed(names)) return { kind: 'would-end', programmes: byProgramme(runs) }; ⏎ ` → (removed) | `dead-coordinator-lane.test.ts`: `3 failed \| 20 passed (23)` — without the live file a crashed coordinator is RECORDED, once — and no run is ever closed, however long; at most ONE claimant is acted on per pass, the longest dead first; SHADOW records every due coordinator, each once — the list the operator arms on hides none of them |

```bash
git add server/src/watch.ts server/src/server.ts server/test/dead-coordinator-lane.test.ts server/test/fleetws.test.ts
git commit -m "$(cat <<'MSG'
feat(watch): the dead-coordinator lane, shadowed

A third sibling on the reclaim sweep's tick, cadence and switch: the
claimants of open runs measured by the reclaim door's own ladder, against a
journal it trusts, a crash and only a crash anchored in coord.db, an hour and
two passes, the breaker with its memory and its fleet-wide arm, at most one
claimant ended a pass, on the serialiser buildServer hands it. Until the
operator arms it, it records every coordinator it would end; reclaim-paused
stops it, shadow included. It never pushes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 12: The list in the cleanup row

**Model routing:** `sonnet`, effort `medium`.

**Files:** create `pwa/src/fleet/deadCoordinatorWords.ts`, `pwa/src/fleet/DeadCoordinatorAttention.tsx`; modify `pwa/src/fleet/ChildReclaimBanner.tsx`, `pwa/test/child-reclaim-banner.test.tsx`.

**Interfaces:** `deadCoordinatorAttentionOf(coord)` — THE ONE READER (absent → `[]`, a malformed member dropped alone); `DEAD_COORDINATOR_KIND_WORD`, `deadCoordinatorKindWord` (an unknown kind reads `reported`); `<DeadCoordinatorAttention coord>` — a list (`aria-label="coordinators the cleanup is reporting"`), a REPORT, never a tap, rendered under the expiry lane's list in the cleanup row, in its classes.

- [ ] **Step 1: The tests (red).** The words module cannot be imported yet: the file is red at collection.

<!-- replay: replace pwa/test/child-reclaim-banner.test.tsx -->
In `pwa/test/child-reclaim-banner.test.tsx`, find:

````tsx
import { EXPIRY_KIND_WORD, expiryAttentionOf } from '../src/fleet/expiryWords';
````

Replace with:

````tsx
import { EXPIRY_KIND_WORD, expiryAttentionOf } from '../src/fleet/expiryWords';
import { DEAD_COORDINATOR_KIND_WORD, deadCoordinatorAttentionOf } from '../src/fleet/deadCoordinatorWords';
````

<!-- replay: replace pwa/test/child-reclaim-banner.test.tsx -->
In `pwa/test/child-reclaim-banner.test.tsx`, find:

````tsx
    expect(screen.queryByRole('list', { name: 'archived workspaces the cleanup is reporting' })).toBeNull();
  });
});
````

Replace with:

````tsx
    expect(screen.queryByRole('list', { name: 'archived workspaces the cleanup is reporting' })).toBeNull();
  });
});

describe('the dead-coordinator lane’s list (workspace lifecycle wave 4)', () => {
  it('lists what the lane reports, under the expiry lane’s list — the breaker naming every claimant it holds — and is never a tap', () => {
    const store = makeStore();
    seen(store, { ...coord(), deadCoordinatorAttention: [
      { kind: 'breaker', claimants: ['demo-coord-a', 'demo-coord-b'], at: 5,
        sentence: '2 coordinators read crashed within 10 minutes of each other (demo-coord-a, demo-coord-b) — a box fault is likelier than 2 crashes, so the lane ends nothing.' },
      { kind: 'would-end', claimants: ['demo-coord-c'], at: 4,
        sentence: 'coordinator demo-coord-c crashed (its pane is gone and nothing is bringing it back) and has stayed dead since 2026-10-07 10:00 UTC.' },
    ] });
    render(<ChildReclaimBanner store={store} />);
    const list = screen.getByRole('list', { name: 'coordinators the cleanup is reporting' });
    expect(list.textContent).toContain(`${DEAD_COORDINATOR_KIND_WORD.breaker} · demo-coord-a, demo-coord-b`);
    expect(list.textContent).toContain(`${DEAD_COORDINATOR_KIND_WORD['would-end']} · demo-coord-c`);
    expect(list.textContent).toContain('so the lane ends nothing');
    expect(list.querySelectorAll('button, a'), 'a report, never a tap').toHaveLength(0);
    expect(screen.queryByRole('list', { name: 'archived workspaces the cleanup is reporting' }), 'never the expiry lane’s list').toBeNull();
  });

  it('the one reader: an absent field reads as no items, a malformed member is dropped alone, an unknown kind is "reported"', () => {
    expect(deadCoordinatorAttentionOf(coord())).toEqual([]);
    expect(deadCoordinatorAttentionOf({ deadCoordinatorAttention: [
      { kind: 'stuck', claimants: ['a'], sentence: 's' }, { kind: 'stuck', claimants: [7], sentence: 's' }, { kind: 'stuck' }] }))
      .toEqual([{ kind: 'stuck', claimants: ['a'], sentence: 's' }]);
    const store = makeStore();
    seen(store, { ...coord(), deadCoordinatorAttention: [{ kind: 'newer-kind', claimants: ['x'], sentence: 's' }] });
    render(<ChildReclaimBanner store={store} />);
    expect(screen.getByRole('list', { name: 'coordinators the cleanup is reporting' }).textContent).toContain('reported · x');
  });

  it('renders no list when there is nothing to report', () => {
    const store = makeStore();
    seen(store, { ...coord(), deadCoordinatorAttention: [] });
    render(<ChildReclaimBanner store={store} />);
    expect(screen.queryByRole('list', { name: 'coordinators the cleanup is reporting' })).toBeNull();
  });
});
````


- [ ] **Step 2: Run — red.** `( cd pwa && ./node_modules/.bin/vitest run test/child-reclaim-banner.test.tsx --maxWorkers=1 )`

Measured: `child-reclaim-banner.test.tsx`: `no tests — the file fails at collection (its import does not resolve yet)`

- [ ] **Step 3: The source.**

<!-- replay: replace pwa/src/fleet/ChildReclaimBanner.tsx -->
In `pwa/src/fleet/ChildReclaimBanner.tsx`, find:

````tsx
import { ExpiryAttention } from './ExpiryAttention';
````

Replace with:

````tsx
import { ExpiryAttention } from './ExpiryAttention';
import { DeadCoordinatorAttention } from './DeadCoordinatorAttention';
````

<!-- replay: replace pwa/src/fleet/ChildReclaimBanner.tsx -->
In `pwa/src/fleet/ChildReclaimBanner.tsx`, find:

````tsx
      <ExpiryAttention coord={coord} />
````

Replace with:

````tsx
      <ExpiryAttention coord={coord} />
      {/* Workspace lifecycle wave 4: the dead-coordinator lane's own list, under the expiry lane's — the same switch stops
          all three lanes, and each list stays its own. */}
      <DeadCoordinatorAttention coord={coord} />
````

<!-- replay: create pwa/src/fleet/DeadCoordinatorAttention.tsx -->
Create `pwa/src/fleet/DeadCoordinatorAttention.tsx`:

````tsx
// The dead-coordinator lane's attention list (workspace lifecycle spec 2026-09-24 §5.4, wave 4), rendered INSIDE the
// cleanup row (`ChildReclaimBanner`), under the expiry lane's list and in its shape: a REPORT, never a tap — no button,
// no link. The doors that act already exist (revive, reclaim, abandon), and the server's sentence names them. Each line
// is the kind's word, the claimant (or, for the circuit breaker, every claimant it holds) and the sentence. Nothing
// renders when the list is empty or the server predates it.
import type { ReactNode } from 'react';
import { deadCoordinatorAttentionOf, deadCoordinatorKindWord } from './deadCoordinatorWords';

export function DeadCoordinatorAttention({ coord }: { coord: unknown }): ReactNode {
  const list = deadCoordinatorAttentionOf(coord);
  if (list.length === 0) return null;
  return (
    <ul className="child-reclaim-attention" aria-label="coordinators the cleanup is reporting">
      {list.map((a) => (
        <li key={`${a.kind}:${a.claimants.join(',')}`} className="child-reclaim-item">
          <span className="child-reclaim-who">{`${deadCoordinatorKindWord(a.kind)} · ${a.claimants.join(', ')}`}</span>
          <span className="child-reclaim-sentence">{a.sentence}</span>
        </li>
      ))}
    </ul>
  );
}
````

<!-- replay: create pwa/src/fleet/deadCoordinatorWords.ts -->
Create `pwa/src/fleet/deadCoordinatorWords.ts`:

````ts
// The dead-coordinator lane's attention list (workspace lifecycle wave 4) — its ONE reader, and the words for its kinds.
//
// ITS OWN FILE, beside `expiryWords.ts` and sharing nothing with it: three populations ride one frame and render in one
// row (the fleet's one cleanup switch), and each list stays its own. The sentence is the SERVER's — the claimant, why it
// reads crashed, since when, and what an armed lane would end — and the PWA renders it and maps nothing.
import type { DeadCoordinatorAttention } from '../../../shared/api';

/** What the row says before the claimants and the server's sentence, by kind. A kind from a newer server reads as
 *  `reported`. */
export const DEAD_COORDINATOR_KIND_WORD: Readonly<Record<DeadCoordinatorAttention['kind'], string>> = {
  'would-end': 'would end',
  unmeasured: 'cannot tell',
  stuck: 'stuck',
  breaker: 'held',
};

export const deadCoordinatorKindWord = (kind: string): string =>
  Object.prototype.hasOwnProperty.call(DEAD_COORDINATOR_KIND_WORD, kind)
    ? DEAD_COORDINATOR_KIND_WORD[kind as DeadCoordinatorAttention['kind']] : 'reported';

/** Only the fields the row RENDERS, plus the shape sanity that tells a member from junk. */
type RenderedDeadCoordinator = Pick<DeadCoordinatorAttention, 'kind' | 'claimants' | 'sentence'>;

const isDeadCoordinator = (a: unknown): a is RenderedDeadCoordinator => {
  if (typeof a !== 'object' || a === null) return false;
  const o = a as Record<string, unknown>;
  return typeof o.kind === 'string' && typeof o.sentence === 'string'
    && Array.isArray(o.claimants) && o.claimants.every((c) => typeof c === 'string');
};

/** THE ONE READER of `CoordStatus.deadCoordinatorAttention`. An absent field (an older server) reads as no items, and
 *  a malformed member is dropped on its own rather than taking the list with it. */
export function deadCoordinatorAttentionOf(coord: unknown): RenderedDeadCoordinator[] {
  if (typeof coord !== 'object' || coord === null) return [];
  const list = (coord as { deadCoordinatorAttention?: unknown }).deadCoordinatorAttention;
  return Array.isArray(list) ? list.filter(isDeadCoordinator) : [];
}
````


- [ ] **Step 4: Run — green**, the Runs screen beside it, and the PWA's typecheck:

```bash
( cd pwa && ./node_modules/.bin/vitest run test/child-reclaim-banner.test.tsx --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/tsc --noEmit -p . )
```

Measured: `child-reclaim-banner.test.tsx`: `41 passed (41)`; `runs-screen.test.tsx`: `132 passed (132)`; `tsc` rc 0.

- [ ] **Step 5: Mutation check, then commit.**

| # | Edit (restore after) | Measured red |
|---|---|---|
| T12.1 | `pwa/src/fleet/deadCoordinatorWords.ts`: `    && Array.isArray(o.claimants) && o.claimants.every((c) => typeof c === 'string');` → `    && Array.isArray(o.claimants);` | `child-reclaim-banner.test.tsx`: `1 failed \| 40 passed (41)` — the one reader: an absent field reads as no items, a malformed member is dropped alone, an unknown kind is "reported" |
| T12.2 | `pwa/src/fleet/ChildReclaimBanner.tsx`: `      <DeadCoordinatorAttention coord={coord} /> ⏎ ` → (removed) | `child-reclaim-banner.test.tsx`: `2 failed \| 39 passed (41)` — lists what the lane reports, under the expiry lane’s list — the breaker naming every claimant it holds — and is never a tap; the one reader: an absent field reads as no items, a malformed member is dropped alone, an unknown kind is "reported" |
| T12.3 | `pwa/src/fleet/deadCoordinatorWords.ts`: `    ? DEAD_COORDINATOR_KIND_WORD[kind as DeadCoordinatorAttention['kind']] : 'reported';` → `    ? DEAD_COORDINATOR_KIND_WORD[kind as DeadCoordinatorAttention['kind']] : kind;` | `child-reclaim-banner.test.tsx`: `1 failed \| 40 passed (41)` — the one reader: an absent field reads as no items, a malformed member is dropped alone, an unknown kind is "reported" |

```bash
git add pwa/src/fleet/deadCoordinatorWords.ts pwa/src/fleet/DeadCoordinatorAttention.tsx pwa/src/fleet/ChildReclaimBanner.tsx \
  pwa/test/child-reclaim-banner.test.tsx
git commit -m "$(cat <<'MSG'
feat(pwa): the dead-coordinator lane's list in the cleanup row

Its own reader and its own list, under the expiry lane's: what an armed lane
would end, what it cannot tell, what it could not move, and the breaker
naming every coordinator it holds. A report, never a tap.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 13: The words — README, the specs, the one cleanup switch widened, and the no-writer pins

**Model routing:** `sonnet`, effort `high` — the arming condition must be the first claim, not a footnote.

**Files:** `README.md` (the lane's paragraph after the expiry lane's; the three passages that name what `reclaim-paused` stops; the cleanup row's sentence), `ccd/coordinator-skill/references/resume.md` (the arming condition, in words), `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` (§5.4's "As wave 4 builds the lane", §6 item 5), `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` (§5.8), `docs/superpowers/specs/2026-08-11-build4-conversation-and-controls-design.md` (the `causedBy` sentence), `deploy/measure-workspace-lifecycle.py` (spec §9's stage-4 rows); create `server/test/dead-coordinator-prose.test.ts`; modify `server/test/expiry-lane-prose.test.ts` (two pins move with the widened passages), `server/test/single-definition.test.ts` (the no-writer pins, APPENDED), `server/test/measure-workspace-lifecycle.test.ts` (the titles bound, the rows measured).

**Interfaces:** the measurement rows `dead_coordinator_ended`, `dead_coordinator_partly_ended`, `dead_coordinator_would_end`, `dead_coordinator_breaker_trips` and `dead_coordinator_slugs_reopened`, read off the lane's own feed rows (its titles a second spelling, bound by the test; Pre-flight finding 17). MEASURED, the switch's words: the cleanup row's label ("Pause cleanup" / "cleanup not paused") and coordinator clause 3 stay true — the row is "cleanup", and clause 3 says a child is reclaimed at its run's close, which is how this lane's closes reach a child; so neither moves. The passages that LIST what the switch stops (README's three, CCR-15 §5.8) widen. The coordinator's resume runbook, which tells a revived coordinator its run is still open, gains the arming condition IN WORDS (ruling B: the skill files state it and never name the live file — both pinned); it reaches a coordinator's home through the fleet box's install spine.

- [ ] **Step 1: The pins (red).** The no-writer pins are green by design (no writer exists); their reds are rows T13.2, T13.3 and T13.5.

<!-- replay: create server/test/dead-coordinator-prose.test.ts -->
Create `server/test/dead-coordinator-prose.test.ts`:

````ts
// The texts that move with the dead-coordinator lane (workspace lifecycle spec 2026-09-24 §5.4, §6 item 5; wave 4).
// Each is pinned by what it must SAY: the arming condition stated before the act, the one cleanup switch widened
// wherever it names what it stops, and the departures recorded in the spec — so a later edit that drops a claim reds
// here rather than leaving the docs behind the code. The skill corpora NEVER name the live file (ruling B).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const read = (p: string): string => readFileSync(path.join(root, p), 'utf8');
/** Whitespace folded, so a re-wrapped paragraph still matches. */
const flat = (p: string): string => read(p).replace(/\s+/g, ' ');

describe('README: a coordinator that crashed', () => {
  const readme = flat('README.md');
  it('says what an armed lane ends and when — and that until the operator arms it, the lane only records', () => {
    const at = readme.indexOf('**A coordinator that crashed is ended after an hour**');
    expect(at, 'the paragraph is gone').toBeGreaterThan(-1);
    const para = readme.slice(at, at + 5200);
    expect(para).toContain('once the operator has armed the lane with `$REG/dead-coordinator-lane-live`; until then the lane only records what it would end');
    expect(para).toContain('**The lane ships shadowed**');
    expect(para).toContain('A stopped coordinator is never ended');
    expect(para).toContain('circuit breaker');
    expect(para).toContain('`$REG/reclaim-paused` stops this lane too, shadow included');
    expect(para).toContain('It never pushes');
    // The revisions of the plan's review: a journal it cannot trust, the re-measure inside the arm and its residual,
    // the breaker's memory and its fleet-wide arm, shadow's whole list, and the incident the stall watch notifies.
    expect(para).toContain('A coordinator whose journal the server cannot trust to hold every deliberate act');
    expect(para).toContain('a pass decides nothing at all');
    expect(para).toContain('immediately before each run\'s fleet act and again before its commit');
    expect(para).toContain('all but a revive that lands inside that last round trip');
    expect(para).toContain('stays held through a pass that cannot measure it');
    expect(para).toContain('in shadow every due one is recorded');
    expect(para).toContain('one per worker, each naming the coordinator');
  });
  it('every passage that names what the one cleanup switch stops names this lane too', () => {
    expect(readme).toContain('pauses every reclamation, every expiry and the dead-coordinator lane fleet-wide');
    expect(readme).toContain('and the expiry of archived workspaces stops too, as does the dead-coordinator lane');
    expect(readme).toContain('raise / lower the cleanup pause (`$REG/reclaim-paused`: child reclamation, the expiry of archived workspaces and the dead-coordinator lane)');
  });
});

describe('the skill corpora', () => {
  it('the coordinator’s resume runbook says, in WORDS, what an armed lane does to a programme whose coordinator stays dead', () => {
    const r = flat('ccd/coordinator-skill/references/resume.md');
    expect(r).toContain('Once the operator has armed the server\'s dead-coordinator lane');
    expect(r).toContain('has stayed dead an hour has its open runs closed `failed`');
    expect(r).toContain('Until the operator arms it, the lane only records what it would end.');
    expect(r).toContain('A revive within the hour keeps the program either way.');
  });

  it('no skill file names the lane’s live switch — a session told about the dial could arm the end of a programme', () => {
    const skills = ['ccd/coordinator-skill', 'ccd/worker-skill', 'ccd/reviewer-skill'];
    const files = skills.flatMap((d) => readdirSync(path.join(root, d), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.md')).map((f) => path.join(d, f)));
    expect(files.length, 'an empty corpus would pass vacuously').toBeGreaterThan(3);
    for (const f of files) expect(read(f), f).not.toContain('dead-coordinator-lane-live');
  });
});

describe('the specs', () => {
  it('the lifecycle design §5.4 records the lane as wave 4 builds it, and §6 item 5 as amended', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    expect(s).toContain('**As wave 4 builds the lane**');
    expect(s).toContain('`$REG/dead-coordinator-lane-live`');
    expect(s).toContain('`closeRun`\'s `causedBy` vocabulary gains `\'sweep\'` (§5.4). Amended by this design’s wave 4');
    for (const item of ['**A journal that may have lost the act is unreadable.**', '**A never-started row with no successful spawn never ran.**',
      '**The breaker remembers.**', '**The re-measure runs inside the arm.**', 'in shadow every due claimant is recorded']) {
      expect(s).toContain(item);
    }
  });
  it('CCR-15 §5.8: the one cleanup switch stops the dead-coordinator lane too', () => {
    expect(flat('docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md'))
      .toContain('the expiry of archived workspaces too, and — since wave 4 — the dead-coordinator lane');
  });
  it('the build-4 design, where the causedBy vocabulary is written, names the third word', () => {
    expect(flat('docs/superpowers/specs/2026-08-11-build4-conversation-and-controls-design.md'))
      .toContain("carry `causedBy ∈ {'coordinator','operator',<session id>}` — and, since workspace lifecycle wave 4, `'sweep'`");
  });
});
````

<!-- replay: replace server/test/expiry-lane-prose.test.ts -->
In `server/test/expiry-lane-prose.test.ts`, find:

````ts
    expect(readme).toContain('it pauses every reclamation and every expiry fleet-wide');
    expect(readme).toContain('and the expiry of archived workspaces stops too');
    expect(readme).toContain('raise / lower the cleanup pause (`$REG/reclaim-paused`: child reclamation and the expiry of archived workspaces)');
````

Replace with:

````ts
    expect(readme).toContain('it pauses every reclamation, every expiry and the dead-coordinator lane fleet-wide');
    expect(readme).toContain('and the expiry of archived workspaces stops too');
    expect(readme).toContain('raise / lower the cleanup pause (`$REG/reclaim-paused`: child reclamation, the expiry of archived workspaces and the dead-coordinator lane)');
````

<!-- replay: replace server/test/measure-workspace-lifecycle.test.ts -->
In `server/test/measure-workspace-lifecycle.test.ts`, find:

````ts
import { TERMINAL_RUN_STATES } from '../../shared/api.js';
````

Replace with:

````ts
import { TERMINAL_RUN_STATES } from '../../shared/api.js';
import { deadCoordinatorBreakerFeedRow, deadCoordinatorFeedRows } from '../src/deadCoordinator.js';
````

<!-- replay: replace server/test/measure-workspace-lifecycle.test.ts -->
In `server/test/measure-workspace-lifecycle.test.ts`, find:

````ts

  it('refuses a snapshot that is not one', () => {
````

Replace with:

````ts

  it('the dead-coordinator lane’s titles are the lane’s own — the second spelling is bound to the first', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    const title = (k: string) => new RegExp(`^${k} = '([^']*)'$`, 'm').exec(src)?.[1];
    const p = [{ slug: 'p', runIds: [1] }];
    const ended = deadCoordinatorFeedRows('c', { kind: 'ended', programmes: p, open: [], stuck: [], stoppedBy: null }, 0)[0]!.title;
    const partly = deadCoordinatorFeedRows('c', { kind: 'ended', programmes: p, open: p, stuck: [], stoppedBy: null }, 0)[0]!.title;
    const would = deadCoordinatorFeedRows('c', { kind: 'would-end', programmes: p }, 0)[0]!.title;
    const trip = deadCoordinatorBreakerFeedRow({ tripped: true, why: 'clustered', claimants: ['c', 'd'], since: 0, members: [] }).title;
    expect([title('DC_ENDED'), title('DC_PARTLY'), title('DC_WOULD'), title('DC_BREAKER')]).toEqual([ended, partly, would, trip]);
  });

  it('spec §9’s stage-4 row: programmes the lane ended with their first-dead instants, breaker trips, slugs reopened', () => {
    const f = fixture();
    const feed = (atS: number, sessionId: string, row: { title: string; body: string }) => f.db.prepare(
      'INSERT INTO feed_events (epoch, seq, at, kind, sessionId, title, body) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('e', atS, atS * 1000, 'run', sessionId, row.title, row.body);
    const p = (slug: string) => [{ slug, runIds: [1, 2] }];
    const dead = (NOW_S - 3 * DAY) * 1000;
    feed(NOW_S - 3 * DAY, 'demo-coord-a', deadCoordinatorFeedRows('demo-coord-a', { kind: 'would-end', programmes: p('alpha') }, dead)[0]!);
    feed(NOW_S - 2 * DAY, 'demo-coord-a', deadCoordinatorFeedRows('demo-coord-a',
      { kind: 'ended', programmes: p('alpha'), open: [], stuck: [], stoppedBy: null }, dead)[0]!);
    feed(NOW_S - 2 * DAY, 'demo-coord-b', deadCoordinatorFeedRows('demo-coord-b',
      { kind: 'ended', programmes: p('beta'), open: [{ slug: 'beta', runIds: [3] }], stuck: [], stoppedBy: null }, dead)[0]!);
    feed(NOW_S - DAY, 'demo-coord-c', deadCoordinatorBreakerFeedRow({ tripped: true, why: 'clustered',
      claimants: ['demo-coord-c', 'demo-coord-d'], since: dead, members: [] }));
    const r = f.s.openRun({ program: 'alpha', title: 'A', project: 'demo', wave: 1, waveOf: 1, claimedBy: 'demo-coord-e' });
    expect('id' in r).toBe(true);
    f.db.prepare('UPDATE runs SET openedAt = ? WHERE program = ?').run((NOW_S - DAY) * 1000, 'alpha');
    const out = run(['--db', f.dbPath, '--cache', writeCache(f.home, []), '--now', String(NOW_S)]);
    expect(out.status, out.stderr).toBe(0);
    expect(rows(out.stdout)).toMatchObject({ dead_coordinator_ended: '1', dead_coordinator_partly_ended: '1',
      dead_coordinator_would_end: '1', dead_coordinator_breaker_trips: '1', dead_coordinator_slugs_reopened: '1' });
    expect(out.stdout).toContain('alpha coordinator demo-coord-a dead since 2026-09-18 14:13 UTC');
    expect(out.stdout).toContain('demo-coord-c, demo-coord-d');
  });

  it('refuses a snapshot that is not one', () => {
````

<!-- replay: replace server/test/single-definition.test.ts -->
In `server/test/single-definition.test.ts`, find:

````ts
      .filter((f) => PROSE.test(stallCode(path.join(ccrcRoot, f))))).toEqual([]);
  });
});
````

Replace with:

````ts
      .filter((f) => PROSE.test(stallCode(path.join(ccrcRoot, f))))).toEqual([]);
  });
});

// WORKSPACE LIFECYCLE WAVE 4 (spec 2026-09-24 §5.4, the coordinator's safety ruling (B)). APPENDED, for the reason the
// blocks above state. The dead-coordinator lane SHIPS SHADOWED: until `$REG/dead-coordinator-lane-live` exists it
// measures, anchors, trips its breaker and records "would end programme <slug> (<n> runs)", and never reaches
// `closeRun`'s abandon arm. The file is the operator's to touch BY HAND in the registry the server reads, beside
// `expire-lane-live`, `scope-sweep-live` and `stall-watch-live` above — so no line of shell names it, and its one TS
// holder on a code line is its definer, an L1 file that reaches no `node:` module and so cannot write it.
describe('workspace lifecycle wave 4: the dead-coordinator lane’s live switch has no writer in the tree', () => {
  const NAME = 'dead-coordinator-lane-live';
  const DEFINER = 'server/src/deadCoordinator.ts';

  it('no shell line names it, and its one TS holder is its definer', () => {
    expect(holdersOf(NAME), 'a line of shell names it — a writer, or a reader this design never had').toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(NAME)).map(rel).sort(), `spelled on a code line outside ${DEFINER}`)
      .toEqual([DEFINER]);
    expect(stallCode(path.join(ccrcRoot, DEFINER)), `${DEFINER} reaches a node: module or require — it could write the marker`)
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });

  // THE WIDER WRITER, the expiry pin's argument: a file that imports the ONE spelling and holds an `io` could write it
  // without spelling its name. The files whose code names the constant are pinned, and none of them reaches a write.
  it('the files that name its constant are the definer and the executor, and neither reaches a write', () => {
    const WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;
    expect(WRITE.test('await deps.io.writeFile(`${dir}/${m}`, "");'), 'CONTROL: the pattern sees a write').toBe(true);
    const holders = ALL.filter((f) => stallCode(f).includes('DEAD_COORDINATOR_LANE_LIVE_MARKER')).map(rel).sort();
    expect(holders).toEqual(['server/src/coord/endDeadCoordinator.ts', DEFINER]);
    for (const f of holders) expect(stallCode(path.join(ccrcRoot, f)), `${f} reaches a write`).not.toMatch(WRITE);
  });
});
````


- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-prose.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/expiry-lane-prose.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=1 -t 'dead-coordinator lane' )
( cd server && ./node_modules/.bin/vitest run test/measure-workspace-lifecycle.test.ts --maxWorkers=1 )
```

Measured: `dead-coordinator-prose.test.ts`: `6 failed | 1 passed (7)` — × says what an armed lane ends and when — and that until the operator arms it, the lane only records; × every passage that names what the one cleanup switch stops names this lane too; × the coordinator’s resume runbook says, in WORDS, what an armed lane does to a programme whose coordinator stays dead; × the lifecycle design §5.4 records the lane as wave 4 builds it, and §6 item 5 as amended; × CCR-15 §5.8: the one cleanup switch stops the dead-coordinator lane too; × the build-4 design, where the causedBy vocabulary is written, names the third word; `expiry-lane-prose.test.ts`: `1 failed | 7 passed (8)` — × every other passage that names the switch says it stops the expiry too, and calls the row the cleanup row; `single-definition.test.ts `-t dead-coordinator lane``: `2 passed | 407 skipped (409)`; `measure-workspace-lifecycle.test.ts`: `2 failed | 11 passed (13)` — × the dead-coordinator lane’s titles are the lane’s own — the second spelling is bound to the first; × spec §9’s stage-4 row: programmes the lane ended with their first-dead instants, breaker trips, slugs reopened

- [ ] **Step 3: The words.**

<!-- replay: replace README.md -->
In `README.md`, find:

````markdown
   could not clean up (**The reclaim sweep, and how to stop it**, below) and the
   archived workspaces the expiry lane reports (the expiry lane, further
   below).
````

Replace with:

````markdown
   could not clean up (**The reclaim sweep, and how to stop it**, below), the
   archived workspaces the expiry lane reports (the expiry lane, further
   below) and the coordinators the dead-coordinator lane reports (just after it).
````

<!-- replay: replace README.md -->
In `README.md`, find:

````markdown

**What a crossing costs.** Caps stay global: one row, whole box, no per-project
````

Replace with:

````markdown

**A coordinator that crashed is ended after an hour** (workspace lifecycle spec §5.4). A coordinator whose pane is
gone with nothing bringing it back (`orphan`, `never-started`), or whose registry row is gone, with no deliberate act
journaled since its last successful spawn — a stop, an archive, a reap, a destroy, a purge, a forget, a reclaim, an
expiry, or an unsupervise somebody declared — and that has stayed so for an hour on two passes in a row, has its open
runs closed `failed` by the server once the operator has armed the lane with `$REG/dead-coordinator-lane-live`; until
then the lane only records what it would end. The hour counts from the first pass that measured the crash, kept in
`coord.db` across restarts and raised, never lowered, by a later supervisor heartbeat. A stopped coordinator is never
ended, nor one a supervisor is bringing back, nor one the server cannot measure. A coordinator whose journal the
server cannot trust to hold every deliberate act — the lifecycle mirror not current, a gap it recorded since the
coordinator's last start, a journal line ccd could not write — is listed and never acted on, and so are one with no
registry row and no journal history and one that never started; while the mirror has not swept since a restart, or has
gone stale, a pass decides nothing at all. The act runs on the coordination serialiser: it re-measures the coordinator
immediately before each run's fleet act and again before its commit, and commits only while the run still names it, so
a successor is never failed and a coordinator revived meanwhile keeps its programme — all but a revive that lands
inside that last round trip.
Each closed run's event says the sweep did it (`causedBy: sweep`), CCR-15 reclaims each marked worker whose run closed
(a worker mid-turn loses its turn; its work is pinned in the attic), an unmarked worker is released, and one feed row
per programme says so. **The lane ships shadowed**: until the operator touches `$REG/dead-coordinator-lane-live` by
hand in the registry the server reads (the fleet box's, through the agent, when the server runs `CCRC_FLEET=remote`;
nothing in this tree writes it), a due coordinator is recorded — a feed row and an entry in the cleanup row on `/runs`
naming the programmes it would end — and no run is closed. Two or more coordinators first seen crashed within ten
minutes of each other trip a circuit breaker: the lane ends nothing at all, lists them once, and resumes when fewer
than two remain — revive them, reclaim their programmes or abandon their runs. A coordinator it holds stays held
through a pass that cannot measure it, and a pass on which tmux does not answer trips it too. Armed, at most one
coordinator is ended per pass; in shadow every due one is recorded. `$REG/reclaim-paused` stops this lane too, shadow
included. It never pushes: the stall watch's pushes about a dead coordinator's stalled workers — one per worker, each
naming the coordinator — are the notifications, and this lane's rows (each with the instant the coordinator was first
seen dead, and one when the breaker trips) are records of the same incident.

**What a crossing costs.** Caps stay global: one row, whole box, no per-project
````

<!-- replay: replace README.md -->
In `README.md`, find:

````markdown
pauses every reclamation and every expiry fleet-wide), a git operation in progress, a lock, or
````

Replace with:

````markdown
pauses every reclamation, every expiry and the dead-coordinator lane fleet-wide), a git operation in progress, a lock, or
````

<!-- replay: replace README.md -->
In `README.md`, find:

````markdown
refuses `paused` on the box, and the expiry of archived workspaces stops too. The same row lists the children that need a
````

Replace with:

````markdown
refuses `paused` on the box, and the expiry of archived workspaces stops too, as does the dead-coordinator lane. The same row lists the children that need a
````

<!-- replay: replace README.md -->
In `README.md`, find:

````markdown
| `coord-pause --state on\|off` · `reclaim-pause --state on\|off` · `project-pool --project <p> --pool <name>\|--clear` | raise / lower the coordinator pause; raise / lower the cleanup pause (`$REG/reclaim-paused`: child reclamation and the expiry of archived workspaces); tag / untag a project's pool |
````

Replace with:

````markdown
| `coord-pause --state on\|off` · `reclaim-pause --state on\|off` · `project-pool --project <p> --pool <name>\|--clear` | raise / lower the coordinator pause; raise / lower the cleanup pause (`$REG/reclaim-paused`: child reclamation, the expiry of archived workspaces and the dead-coordinator lane); tag / untag a project's pool |
````

<!-- replay: replace ccd/coordinator-skill/references/resume.md -->
In `ccd/coordinator-skill/references/resume.md`, find:

````markdown
boundary, when the next run has to be opened.
````

Replace with:

````markdown
boundary, when the next run has to be opened.

Unless the server ends the program first. Once the operator has armed the server's dead-coordinator lane,
a coordinator that crashed — its pane gone with nothing bringing it back, and no stop, archive or other
deliberate act since its last successful spawn — and has stayed dead an hour has its open runs closed
`failed`, its workers cleaned up and its program retired for good, so a revive after that finds no run
to pick up. Until the operator arms it, the lane only records what it would end. A revive within the
hour keeps the program either way.
````

<!-- replay: replace deploy/measure-workspace-lifecycle.py -->
In `deploy/measure-workspace-lifecycle.py`, find:

````python
Exit 0 measured; 2 an input missing or unreadable.
"""
import argparse, collections, datetime, json, os, sqlite3, sys, time
````

Replace with:

````python
  dead_coordinator_ended      programmes the dead-coordinator lane ended (spec §5.4), each with the instant its
                              coordinator was first seen dead — from the lane's own feed rows
  dead_coordinator_partly_ended  programmes an act closed only part of (it stopped, or a run could not be moved)
  dead_coordinator_would_end  the shadowed lane's records: what an armed lane would have ended, per coordinator
  dead_coordinator_breaker_trips  the circuit breaker's trips, each naming the coordinators it held
  dead_coordinator_slugs_reopened  of the ended programmes, those a run was opened for AFTER the lane ended them
Exit 0 measured; 2 an input missing or unreadable.
"""
import argparse, collections, datetime, json, os, re, sqlite3, sys, time
````

<!-- replay: replace deploy/measure-workspace-lifecycle.py -->
In `deploy/measure-workspace-lifecycle.py`, find:

````python
WEEK_S = 7 * 86400
````

Replace with:

````python
WEEK_S = 7 * 86400
# The dead-coordinator lane's feed titles (`server/src/deadCoordinator.ts`'s `deadCoordinatorFeedRows` and
# `deadCoordinatorBreakerFeedRow`) — a second spelling, bound to the first by measure-workspace-lifecycle.test.ts.
DC_ENDED = 'dead coordinator: programme ended'
DC_PARTLY = 'dead coordinator: programme partly ended'
DC_WOULD = 'dead coordinator: programme would be ended'
DC_BREAKER = 'dead coordinator: breaker tripped'
````

<!-- replay: replace deploy/measure-workspace-lifecycle.py -->
In `deploy/measure-workspace-lifecycle.py`, find:

````python
            "SELECT count(*) FROM lifecycle_events WHERE outcome = 'done' AND at IS NULL").fetchone()[0]
````

Replace with:

````python
            "SELECT count(*) FROM lifecycle_events WHERE outcome = 'done' AND at IS NULL").fetchone()[0]
        dead_feed = db.execute(
            'SELECT at, sessionId, title, body FROM feed_events WHERE title IN (?, ?, ?, ?) ORDER BY at, id',
            (DC_ENDED, DC_PARTLY, DC_WOULD, DC_BREAKER)).fetchall()
        opened = db.execute('SELECT program, CAST(openedAt AS TEXT) FROM runs').fetchall()
````

<!-- replay: replace deploy/measure-workspace-lifecycle.py -->
In `deploy/measure-workspace-lifecycle.py`, find:

````python
        print(f'  {day} {per_day[day]}')


````

Replace with:

````python
        print(f'  {day} {per_day[day]}')

    dead_rows(dead_feed, opened)


def iso_min(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')


def dead_rows(feed, opened):
    """Spec §9's stage-4 row: the programmes the dead-coordinator lane ended, its breaker trips, and the later reopening
    of an ended programme's slug — each ended one with its coordinator's first-dead instant, read off the lane's own feed
    rows (`dead since <instant>`)."""
    since_re = re.compile(r'\(dead since ([^)]*)\)')
    slug_re = re.compile(r'programme (\S+) (?:ended|was NOT ended)|would end programme (\S+) ')
    ended, partly, would, trips = [], [], set(), []
    for at, sid, title, body in feed:
        m, s = since_re.search(body), slug_re.search(body)
        slug = (s.group(1) or s.group(2)) if s else '?'
        dead = m.group(1) if m else 'unknown'
        if title == DC_ENDED:
            ended.append((at, slug, sid, dead))
        elif title == DC_PARTLY:
            partly.append((at, slug, sid, dead))
        elif title == DC_WOULD:
            would.add((sid, slug))
        else:
            trips.append((at, sid, body))
    print(f'dead_coordinator_ended: {len(ended)}')
    for at, slug, sid, dead in ended:
        print(f'  {iso_min(at)} {slug} coordinator {sid} dead since {dead}')
    print(f'dead_coordinator_partly_ended: {len(partly)}')
    for at, slug, sid, dead in partly:
        print(f'  {iso_min(at)} {slug} coordinator {sid} dead since {dead}')
    print(f'dead_coordinator_would_end: {len(would)}')
    for sid, slug in sorted(would):
        print(f'  {sid} {slug}')
    print(f'dead_coordinator_breaker_trips: {len(trips)}')
    for at, sid, body in trips:
        print(f'  {iso_min(at)} {body[:160]}')
    reopened = []
    for at, slug, _sid, _dead in ended:
        later = [int(o) for p, o in opened if p == slug and o is not None and o.lstrip('-').isdigit() and int(o) > at]
        if later:
            reopened.append((slug, min(later)))
    print(f'dead_coordinator_slugs_reopened: {len(reopened)}')
    for slug, o in reopened:
        print(f'  {slug} {iso_min(o)}')


````

<!-- replay: replace docs/superpowers/specs/2026-08-11-build4-conversation-and-controls-design.md -->
In `docs/superpowers/specs/2026-08-11-build4-conversation-and-controls-design.md`, find:

````markdown
carry `causedBy ∈ {'coordinator','operator',<session id>}`
(`coord/schema.ts:96`). Read routes (`GET /api/runs`, `GET /api/feed`) are
````

Replace with:

````markdown
carry `causedBy ∈ {'coordinator','operator',<session id>}` — and, since workspace lifecycle wave 4, `'sweep'`, the
dead-coordinator lane's abandon (`coord/schema.ts:96`). Read routes (`GET /api/runs`, `GET /api/feed`) are
````

<!-- replay: replace docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md -->
In `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`, find:

````markdown
workspaces too: it is the fleet's one cleanup switch (`2026-09-24-workspace-lifecycle-design.md` §5.3). Nothing else;
````

Replace with:

````markdown
workspaces too, and — since wave 4 — the dead-coordinator lane: it is the fleet's one cleanup switch (`2026-09-24-workspace-lifecycle-design.md` §5.3). Nothing else;
````

<!-- replay: replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find:

````markdown

## 6. What this changes outside itself
````

Replace with:

````markdown

**As wave 4 builds the lane** (amended with its plan, `docs/superpowers/plans/2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md`;
each item is a departure named there).
- **The lane ships shadowed** (the coordinator's safety ruling, the expiry lane's precedent). Until
  `$REG/dead-coordinator-lane-live` exists — touched by the operator by hand in the registry the server reads (the fleet
  box's through the agent in remote mode); nothing in the tree writes it — the lane measures, keeps its anchors, trips
  its breaker and records "would end programme <slug> (<n> runs)" as a feed row and an attention entry, and never
  reaches `closeRun`'s abandon arm or the reclaim port. The executor re-reads the file inside the serialiser.
  `reclaim-paused` stops it entirely, shadow included.
- **The last start is read off the spawn line itself.** ccd's encoder writes every `meas` value as a string and the
  mirror keeps `meas.rc` only as a number, so the typed field is null on every real line; the clause reads the `spawn`
  line's own bytes, strictly — `"0"` is a start, anything else proves none, and then every row in the horizon counts.
- **Doubt in the journal is deliberate.** An act this build cannot name (`unknown`) and an `unsupervise` whose surface
  cannot be read count as deliberate acts: doubt never reads as a crash.
- **A journal that may have lost the act is unreadable.** The clause also reads the journal's own trust: the mirror's
  health (`unavailable`, or not swept since a restart, or `stale` — the last two make a pass decide nothing at all), a
  gap the mirror recorded in a generation not older than the claimant's last successful spawn, and a journal line ccd
  counted as unwritten after it (`$REG/.lifecycle/errors`' instant). Each makes the claimant unmeasured: listed, never
  acted on.
- **A never-started row with no successful spawn never ran.** `never-started` is a crash only when the journal holds a
  successful spawn for it; otherwise — an heir the operator reclaimed a programme onto and has not started yet reads so —
  it is unmeasured.
- **The anchor restarts after a gap nobody measured.** `dead_claimants` carries `lastDeadAt` beside `firstDeadAt`; an
  episode whose last crashed pass is older than ten minutes (a server down, an older build running after a rollback,
  which never writes the table) starts again at the pass that measures it. The table is a new table and nothing else,
  so a rolled-back build boots on it.
- **The breaker holds the whole lane**, not only the claimants it names, and it **clears through the doors that
  already exist**: the claimants fall back under the threshold when the operator revives them, reclaims their
  programmes or abandons their runs. No new route.
- **The breaker remembers.** It keeps each member's first-dead instant and releases a member only on evidence (alive,
  stopped, a deliberate act) or when it leaves the population, so one pass that cannot measure a member — which deletes
  that member's anchor — does not dissolve the cluster. "Fleet-wide" is what the pass measured: tmux not answering for
  any claimant trips it whatever the count; a registry that will not list stops the tick before the lane runs.
- **One claimant a pass**, the longest dead first, ARMED; in shadow every due claimant is recorded.
- **The re-measure runs inside the arm.** A compare-and-set on `claimedBy` cannot see a revive of the same id, so the
  abandon arm re-measures the claimant immediately before each run's fleet act and again after it, before the commit;
  a revive that lands inside that last round trip is the residual. A re-measure that reads anything but a crash deletes
  the anchor, as a pass's would.
- **The attention list is the lane's own memory** (the expiry lane's shape): would-end, unmeasured, stuck and the
  breaker, rebuilt over the passes after a restart, which can delay an act and never cause one.
- **The lane never pushes.** The stall watch notifies about a dead coordinator's stalled workers — r3
  (`coordinator-dead`) and, once its wave-2 arms are armed, `coord-deaf`, one push per worker, each naming the
  coordinator; this lane's feed rows (each with the claimant's first-dead instant, and one per breaker trip) are records
  of that incident and its entries are a list.
- **Not changed:** the reclaim door and the stall watch ignore the verdict's new `cause`; landing reads a run the sweep
  failed exactly as one the operator abandoned (it keys on open runs, never on `causedBy`).

## 6. What this changes outside itself
````

<!-- replay: replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find:

````markdown
  5. `closeRun`'s `causedBy` vocabulary gains `'sweep'` (§5.4).
````

Replace with:

````markdown
  5. `closeRun`'s `causedBy` vocabulary gains `'sweep'` (§5.4). Amended by this design’s wave 4: CCR-15's texts name no
     `causedBy` vocabulary (measured); the set is written in the build-4 design (`2026-08-11-build4-conversation-and-controls-design.md`),
     which now names the third word, and in `close.ts`'s `CloseCause`.
````


- [ ] **Step 4: Run — green**, with every prose pin that reads these files and the citation cases (README moved):

```bash
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-prose.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/expiry-lane-prose.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/readme-holds.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
( cd server && ./node_modules/.bin/vitest run test/measure-workspace-lifecycle.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts --maxWorkers=1 )
```

Measured: `dead-coordinator-prose.test.ts`: `7 passed (7)`; `expiry-lane-prose.test.ts`: `8 passed (8)`; `single-definition.test.ts`: `409 passed (409)`; `readme-holds.test.ts`: `17 passed (17)`; `topology-clean.test.ts`: `55 passed (55)`; `session-hook.test.ts `-t CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND``: `5 passed | 330 skipped (335)`; `measure-workspace-lifecycle.test.ts`: `13 passed (13)`; `coordinator-skill.test.ts`: `161 passed (161)`; also `child-reclaim-prose` `4 passed (4)`, `ws-expire-prose` `7 passed (7)`.

- [ ] **Step 5: Mutation check, then commit.**

| # | Edit (restore after) | Measured red |
|---|---|---|
| T13.1 | `ccd/coordinator-skill/references/wave-lifecycle.md`: `stays until a human cleans it up, or — when it carries no child marker — until the server cleans it up seven days after it is archived` → `stays until a human cleans it up (touch $REG/dead-coordinator-lane-live to arm the sweep), or — when it carries no child marker — until the server cleans it up seven days after it is archived` | `dead-coordinator-prose.test.ts`: `1 failed \| 6 passed (7)` — no skill file names the lane’s live switch — a session told about the dial could arm the end of a programme |
| T13.2 | `server/src/coord/endDeadCoordinator.ts`: ``/** The executor's ports (L2, declared by this consumer). `abandon` is the ONLY way it ends a run. `journalTrust` is the`` → ``export const armIt = (io: { writeFile(p: string, d: string): Promise<void> }): Promise<void> => io.writeFile(DEAD_COORDINATOR_LANE_LIVE_MARKER, ''); ⏎ /** The executor's ports (L2, declared by this consumer). `abandon` is the ONLY way it ends a run. `journalTrust` is the`` | `single-definition.test.ts` `-t dead-coordinator lane`: `1 failed \| 1 passed \| 407 skipped (409)` — the files that name its constant are the definer and the executor, and neither reaches a write |
| T13.3 | `deploy/deploy.sh`: `  prune_backups \|\| echo "deploy: warning: backup prune failed on $BOX (the deploy itself succeeded)" >&2 ⏎ fi` → `  prune_backups \|\| echo "deploy: warning: backup prune failed on $BOX (the deploy itself succeeded)" >&2 ⏎ fi ⏎ touch "$HOME/.cc-sessions/dead-coordinator-lane-live"` | `single-definition.test.ts` `-t dead-coordinator lane`: `1 failed \| 1 passed \| 407 skipped (409)` — no shell line names it, and its one TS holder is its definer |
| T13.4 | `README.md`: ``runs closed `failed` by the server once the operator has armed the lane with `$REG/dead-coordinator-lane-live`; until ⏎ then the lane only records what it would end.`` → ``runs closed `failed` by the server.`` | `dead-coordinator-prose.test.ts`: `1 failed \| 6 passed (7)` — says what an armed lane ends and when — and that until the operator arms it, the lane only records |
| T13.5 | `server/src/deadCoordinator.ts`: `export const DEAD_COORDINATOR_LANE_LIVE_MARKER = 'dead-coordinator-lane-live';` → ``export const DEAD_COORDINATOR_LANE_LIVE_MARKER = 'dead-coordinator-lane-live'; ⏎ import { writeFileSync as _w } from 'node:fs'; ⏎ export const armHere = (reg: string): void => _w(`${reg}/x`, '');`` | `single-definition.test.ts` `-t dead-coordinator lane`: `1 failed \| 1 passed \| 407 skipped (409)` — no shell line names it, and its one TS holder is its definer<br>`dead-coordinator-policy.test.ts`: `1 failed \| 30 passed (31)` — imports L0 alone — no node:, no fs, no fastify |
| T13.6 | `ccd/coordinator-skill/references/resume.md`: `to pick up. Until the operator arms it, the lane only records what it would end. A revive within the ⏎ hour keeps the program either way. ⏎ ` → `to pick up. ⏎ ` | `dead-coordinator-prose.test.ts`: `1 failed \| 6 passed (7)` — the coordinator’s resume runbook says, in WORDS, what an armed lane does to a programme whose coordinator stays dead |
| T13.7 | `deploy/measure-workspace-lifecycle.py`: `DC_ENDED = 'dead coordinator: programme ended'` → `DC_ENDED = 'dead coordinator: programme closed'` | `measure-workspace-lifecycle.test.ts`: `2 failed \| 11 passed (13)` — the dead-coordinator lane’s titles are the lane’s own — the second spelling is bound to the first; spec §9’s stage-4 row: programmes the lane ended with their first-dead instants, breaker trips, slugs reopened |
| T13.8 | `deploy/measure-workspace-lifecycle.py`: `    dead_rows(dead_feed, opened) ⏎ ` → (removed) | `measure-workspace-lifecycle.test.ts`: `1 failed \| 12 passed (13)` — spec §9’s stage-4 row: programmes the lane ended with their first-dead instants, breaker trips, slugs reopened |
| T13.9 | `README.md`: `nor one the server cannot measure. A coordinator whose journal the` → `nor one the server cannot measure. A coordinator whose record the` | `dead-coordinator-prose.test.ts`: `1 failed \| 6 passed (7)` — says what an armed lane ends and when — and that until the operator arms it, the lane only records |

```bash
git add README.md ccd/coordinator-skill/references/resume.md docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md \
  docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md \
  docs/superpowers/specs/2026-08-11-build4-conversation-and-controls-design.md deploy/measure-workspace-lifecycle.py \
  server/test/dead-coordinator-prose.test.ts server/test/expiry-lane-prose.test.ts server/test/single-definition.test.ts \
  server/test/measure-workspace-lifecycle.test.ts
git commit -m "$(cat <<'MSG'
docs(lifecycle): the dead-coordinator lane's words, and the switch widened

README says what an armed lane ends and when, that it ships shadowed until
the operator touches dead-coordinator-lane-live by hand, the breaker, and that
reclaim-paused stops it too — in every passage that lists what that switch
stops — and how the stall watch's pushes relate. The coordinator's resume
runbook states the arming condition in words. The spec records the lane as
wave 4 builds it; CCR-15 §5.8 and the build-4 design's causedBy sentence name
the new word; the instrument measures spec §9's stage-4 rows. No skill file
names the live file, and nothing in the tree writes it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 14: The whole branch, and the PR

**Model routing:** `sonnet`, effort `medium` — measurement and reporting; any red that is not a named flake goes back to its task.

- [ ] **Step 1: Merge `main`, and re-measure what a merge can move.** `git fetch origin main && git merge origin/main` (never a rebase). If `shared/api.ts`, `README.md`, `watch.ts`, `single-definition.test.ts`, `lifecycle.test.ts`, `schema.ts` or `store.ts` merged with anything — child reclamation wave 6 and ccrc-history are planned against them; stall-watch-settings W1 already merged (#320) and this plan is re-based on it — keep both sides, re-point README's purge-token anchors by content (Task 6 Step 5's greps), re-measure the migration slot (Global Constraints), re-run the five citation cases and `cite-remeasure`, and re-run `single-definition`, `typecheck-tests` and `deviation-refs`.

- [ ] **Step 2: The repo-wide guards**, each its own process:

```bash
( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/modelenv-single-writer.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/box-token-census.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/routing-references.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ownership.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-die-containment.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts --maxWorkers=1 )
git fetch origin main
( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/dtbd.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
grep -rn "dead-coordinator-lane-live" server/src pwa/src ccd deploy install.sh
```

Measured on the RE-BASED prototype's final tree, over `7f7bf4afc` (`typecheck-tests` needs `agent/` and `pwa/` modules installed):

- `single-definition`: `409 passed (409)` (base-relative: `406 passed (406)` on `7f7bf4afc`, measured, as on `9b0742089`; this plan appends three cases — one in Task 3, two in Task 13)
- `modelenv-single-writer`: `7 passed (7)`
- `box-token-census`: `23 passed (23)`, as on `7f7bf4afc` (measured) — no route moves; the lane is no door. `coord-pause-route` (its `SESSION_ONLY`/`UNGATED` sets, which #320 widened with `/api/coord/stall-watch`): `20 passed (20)`
- `routing-references`: `11 passed (11)`
- `typecheck-tests`: `12 passed (12)`
- `ccd-workspaces`: `81 passed (81)`
- `ownership`: `14 passed (14)`
- `ccd-die-containment`: `12 passed (12)`
- `coordinator-skill`: `161 passed (161)`, as on `7f7bf4afc` (measured; #320 added one case) — clause 3 and `references/resume.md` both moved
- `ccd-reg-get-census`: `3 passed (3)` (no ccd edit: the census is untouched)
- `topology-clean`: `55 passed (55)`
- `deviation-refs`: `31 passed (31)` with THIS PLAN in the tree, after `git fetch origin main` — it defines no number, and its only column-0 entry line (3b's `expiry-lane-ships-shadowed`, Task 4's anchor) is quoted with its subject unchanged; `dtbd`: `1 passed (1)`
- the citation cases: `5 passed | 330 skipped (335)`
- the `grep`: no line of shell, and one TS code line — `server/src/deadCoordinator.ts`'s definition; the other two hits are comments (`watch.ts`, `coord/endDeadCoordinator.ts`). The watcher reads the switch only through `deadCoordinatorLaneArmed` (`coord/endDeadCoordinator.ts`), so `single-definition`'s holder pin stays the definer and the executor
- `pwa` `tsc --noEmit -p .`: rc 0

- [ ] **Step 3: The suites, in full.** The whole server suite by shard (`--shard=k/24`, sequentially, each in the foreground with `--maxWorkers=1`); a shard that outruns a call is run by FILE (its files are vitest 4's `BaseSequencer.shard`: the test files sorted by the sha1 of `/test/<file>`, sliced, the remainder to the low shards), and a file that outruns a call (`ccrc-update`, `ccrc-install`, `ccrc-doctor`) by its own top-level describes (`vitest list <file>`, then `-t '^(<describe>|…)'` per slice, every listed test in exactly one slice). Then the agent suite; then the PWA in two shards and its typecheck.

```bash
for k in $(seq 1 24); do ( cd server && ./node_modules/.bin/vitest run --shard=$k/24 --maxWorkers=1 ); done
( cd agent && ./node_modules/.bin/vitest run --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/vitest run --shard=1/2 --maxWorkers=1 ) && ( cd pwa && ./node_modules/.bin/vitest run --shard=2/2 --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/tsc --noEmit -p . )
```

Measured as follows (539 server test files on the re-based tree: `main`'s 533 and this plan's six new ones; 535 on the revised tree over `282e79e44`):

**On the RE-BASED prototype's final tree (over `7f7bf4afc`)**, the files #320 or this plan's re-base could move were re-run, each in its own process: every server test file #320 changed or added (17), every one that constructs a `FleetWatcher` (36), and every one that builds the server or registers the coordination routes (`buildServer`, `registerCoordRoutes`) — 96 files, 95 run and all green, one left out: `ccrc-doctor` names `buildServer` only in comments, shells `ccrc`, which neither #320 nor this plan touches, and outruns a call whole (it ran by its describes in the full run below). Among them, #320's own suites: `stall-settings` `114 passed (114)`, `stall-settings-route` `38 passed (38)`, `stall-settings-store` `40 passed (40)`, `stall-settings-prose` `15 passed (15)`, `stall-sweep` `117 passed (117)`, `mail-sweep` `115 passed (115)`, `stall-verdict` `309 passed (309)`, `stall-session` `98 passed (98)`, `stall-backoff` `33 passed (33)`, `auth-gate` `160 passed (160)`, `coord-pause-route` `20 passed (20)`, `reviewer-skill` `15 passed (15)`, `worker-skill` `52 passed (52)`, `coord-db` `73 passed (73)`, `asks-store` `28 passed (28)`, `mail-routes` `59 passed (59)`, `coordinator-skill` `161 passed (161)`. `server` and `pwa` `tsc --noEmit -p .`: rc 0. #320 changed no `agent/` or `pwa/` file.

**The whole-suite run below was measured on the REVISED prototype over `282e79e44`** (before #320), and is not repeated on the re-based tree:

Measured on the REVISED prototype's final tree (the review's revision touches `server/src` and server tests, README, the lifecycle spec, the coordinator's `resume.md` and the §9 instrument — no `agent/`, `pwa/` or `shared/` file):

| Part | Files | Result |
|---|---|---|
| server shards 1, 2, 3 (whole) | 23 each | `779 passed \| 3 skipped (782)`; `557 passed \| 3 skipped (560)`; `957 passed (957)` |
| server shards 5, 6, 7 (whole) | 23 each | `819 passed \| 6 skipped (825)` (two more than as drafted: Task 13's two `measure-workspace-lifecycle` cases); `1009 passed (1009)`; `983 passed \| 11 skipped (994)` |
| server shards 4 and 8–24, by file, seven files a call | 394 | every file green but three: `session-hook` `1 failed \| 334 passed (335)` — × skips a scratch slug — /tmp work accumulates no durable memory (KNOWN: `TMPDIR` outside `/tmp`); `update-store-nodes` `1 failed \| 42 passed (43)` — × the heir guard IS `isHalting` … (32.6 s against its time bound under load; ALONE `43 passed (43)`, the drafted run's same flake); `mail-sweep` `1 failed \| 103 passed (104)` — × leaves the ladder no SILENT exit — a REAL red the revision introduced and fixed: its structural scan finds sweepMail's loop by the text `for (const d of due) {`, and the lane's shadow loop had first spelled its own loop so, earlier in `watch.ts`; the lane's loop now reads `for (const pick of due) {` and `mail-sweep` is `104 passed (104)`, the lane `23 passed (23)` |
| server, the three files that outrun a call, by their own top-level describes | 3 | `ccrc-update` `177 + 172 + 153 = 502 passed`; `ccrc-install` `100 + 108 + 88 = 296 passed`; `ccrc-doctor` `202 + 202 + 204 + 151 = 759 passed` |
| agent (whole), as drafted — the revision touched no file it reads | 25 | `465 passed (465)` |
| pwa `--shard=1/2`, `--shard=2/2`, as drafted — likewise | 54, 53 | `1778 passed (1778)`; `1657 passed (1657)` |
| pwa `tsc --noEmit -p .`, on the revised tree | — | rc 0 |

All 35 server files that construct a `FleetWatcher` ran inside the server run above, each green.

Known reds that are not this wave's: session-hook's "skips a scratch slug" under a `TMPDIR` outside `/tmp`; tmp-sweep's "FAILS CLOSED…" (green on this run); `boot`'s timing cases under load; the load flakes CLAUDE.md lists. Re-run a red one IN ISOLATION before calling it a break.

- [ ] **Step 4: Push and open the PR.** Check the author first (`git log --format='%an <%ae>' origin/main..HEAD | sort -u`). The PR body names: the wave and its rulings (A)–(J); the deploy class (server + pwa; the dead-coordinator lane shadowed until the operator arms it; the expiry lane's arming blockers closed); every departure with its issued number; the mutation tables' totals; the deploy note's arming and the breaker's likely first trip; the carried follow-ups. Then report the wave-done fingerprint as the `ccrc-worker` skill says — the coordinator merges; the fleet moves by ccrc's own updater.

---

## Re-measure at dispatch (ruling J)

This plan was drafted on `origin/main` `9b0742089`, revised on `282e79e44`, and re-based onto `7f7bf4afc` (#320 merged), where every block was replayed whole. The in-flight runs whose files it shares, and what to re-check when one of them lands first — every block below must still match exactly once at its turn, or be re-anchored BY CONTENT (never by a line delta):

- **Child reclamation wave 6** (run 291, `ws/amber-river`): `shared/api.ts` (89 references in its plan, among them `LifecycleMeas`'s two new keys and README's purge-token anchors), `README.md`, `server/src/watch.ts` (its lane's region), `server/src/coord/journalparse.ts` and `mirror.ts`, the CCR-15 spec. Overlap with this plan: Task 6's `shared/api.ts` insertion and README anchor repair (whichever lands second re-runs Task 6 Step 5's greps), Task 1's and Task 11's `watch.ts` blocks, Task 13's README and CCR-15 §5.8 blocks. Its `LifecycleMeas` keys do not touch `rc`, which this plan reads off the raw line anyway.
- **ccrc-history** (run 302; `git diff --name-only origin/main...origin/ws/soft-delta` at `6a6987532`): among this plan's files, `README.md`, `CLAUDE.md`, `deploy/deploy.sh`, `shared/lifecycle.ts`, `server/test/single-definition.test.ts`, `server/test/lifecycle.test.ts` and `server/test/session-hook.test.ts` — not `coord/db.ts`. Overlap: Task 13's README blocks and both appended `single-definition` describes (Task 3, Task 13: append after whatever stands at the end of the file, keeping the no-writer describes adjacent), Task 6's README anchor sentence, and row T13.3's anchor in `deploy/deploy.sh` (`prune_backups || echo …`, untouched by that branch today — re-check the row's Find before running it).
- **Stall-watch-settings W1** — MERGED as #320 before the re-base: it took migration slot 17 (this plan's moved to 18) and `mail-routes.test.ts`'s fourteenth union (this plan's is the fifteenth, its Find anchored on #320's text); `schema.ts`, `coord-db.test.ts` and `asks-store.test.ts` carry the slot move (Global Constraints). Its other files among this plan's — `shared/api.ts` (appended at the end), `README.md`, `watch.ts`, `coord/routes.ts`, `store.ts` and `coordinator-skill.test.ts` — merged with this plan's edits without a conflict, and every block was regenerated on the merged text.
- **Centralised-update W15** (run 300): `server/src/update/*` — no block of this plan.
- **The coordinator skill** (Task 4's clause 3, Task 13's `references/resume.md`): any run that edits the coordinator corpus re-runs `coordinator-skill.test.ts` and `dead-coordinator-prose.test.ts` after the merge.

The blocks in the shared files, by task and the first line of their Find:

| Task | File | Find begins |
|---|---|---|
| 1 | `server/src/watch.ts` | `if (!v.eligible && v.why === 'expiry-unknown' && now >= entry.nextAskAt && learn.length < EXPIRE_AUD…` |
| 1 | `server/src/watch.ts` | `// THREE — learn: one audit at a time, each on its session's queue.` |
| 3 | `server/test/single-definition.test.ts` | `expect(ALL.filter((f) => /['"]expiresAt['"]/.test(stallCode(f))).map(rel).sort()).toEqual(['server/s…` |
| 6 | `README.md` | `` `purge-mechanism-absent` (`shared/api.ts:7833-7835`), each with an operator sentence of its own at `… `` |
| 6 | `shared/api.ts` | `/** The three markers the coordination lane is governed by, read together` |
| 6 | `shared/api.ts` | `expiryAttention?: readonly ExpiryAttention[];` |
| 8 | `server/src/coord/schema.ts` | `` `, `` |
| 8 | `server/src/coord/store.ts` | `import { reviveDec, reviveMeas, reviveObs, type JournalRow } from './journalparse.js';` |
| 8 | `server/src/coord/store.ts` | `\| { ok: false; error: 'unknown-run' };` |
| 8 | `server/src/coord/store.ts` | `handoffCommit: string \| null; program: string; viaClosing: boolean;` |
| 8 | `server/src/coord/store.ts` | `).all() as { claimedBy: string }[]).map((r) => r.claimedBy);` |
| 8 | `server/src/coord/store.ts` | `/** The holes, newest-first — a timeline with a hole in it says so. */` |
| 11 | `server/test/fleetws.test.ts` | `it('a connecting client receives hello, then fleet, then runs — and a later transition re-emits it',…` |
| 11 | `server/test/fleetws.test.ts` | `it('skips the frame when a run row is UNREADABLE, and resumes once it is not', async () => {` |
| 11 | `server/test/fleetws.test.ts` | `it('drops the frame from the broadcast when the JSON is unchanged', async () => {` |
| 11 | `server/test/fleetws.test.ts` | `expect(frame.coord).toEqual({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention…` |
| 11 | `server/test/fleetws.test.ts` | `expect(frame.coord).toEqual({ pause: 'set', mail: 'clear', reclaim: 'clear', childReclaimAttention: …` |
| 11 | `server/test/fleetws.test.ts` | `expect((await next()).coord).toEqual({ pause: 'clear', mail: 'set', reclaim: 'clear', childReclaimAt…` |
| 11 | `server/test/fleetws.test.ts` | `expect((await next()).coord).toEqual({ pause: 'set', mail: 'set', reclaim: 'clear', childReclaimAtte…` |
| 11 | `server/test/fleetws.test.ts` | `{ pause: 'clear', mail: 'clear', reclaim: 'set', childReclaimAttention: [], expiryAttention: [] });` |
| 11 | `server/test/fleetws.test.ts` | `{ pause: 'set', mail: 'clear', reclaim: 'set', childReclaimAttention: [], expiryAttention: [] });` |
| 11 | `server/test/fleetws.test.ts` | `expect(frame.type).toBe('coord');` |
| 11 | `server/test/fleetws.test.ts` | `expect((await next()).coord).toEqual({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaim…` |
| 11 | `server/test/fleetws.test.ts` | `expect(frame.coord).toEqual({ pause: 'unmeasurable', mail: 'unmeasurable', reclaim: 'unmeasurable', …` |
| 11 | `server/test/fleetws.test.ts` | `expect((await next()).coord).toEqual({ pause: 'set', mail: 'clear', reclaim: 'clear', childReclaimAt…` |
| 11 | `server/src/watch.ts` | `ChildMark, ChildReclaimAttention, ChildReclaimKeptWord, CoordStatus, Dialog, ExpiryAttention, FleetS…` |
| 11 | `server/src/watch.ts` | `import { expireArchived, expiryReviewing, learnExpiry, recordExpireFeed } from './coord/expireArchiv…` |
| 11 | `server/src/watch.ts` | `private archivedExpiryBoxRefused: string \| null = null;` |
| 11 | `server/src/watch.ts` | `/** The last measured project-pool sweep, or null if none has been taken yet` |
| 11 | `server/src/watch.ts` | `void this.sweepArchivedExpiry(records, registryRead.names)` |
| 11 | `server/src/watch.ts` | `childReclaimAttention: this.childReclaimAttentionList, expiryAttention: this.expiryAttentionList }` |
| 11 | `server/src/watch.ts` | `childReclaimAttention: this.childReclaimAttentionList, expiryAttention: this.expiryAttentionList };` |
| 11 | `server/src/watch.ts` | `return review.ok ? { ok: true, openWorker, openClaimant, reviewing: review.reviewing } : review;` |
| 13 | `server/test/single-definition.test.ts` | `.filter((f) => PROSE.test(stallCode(path.join(ccrcRoot, f))))).toEqual([]);` |
| 13 | `README.md` | `could not clean up (**The reclaim sweep, and how to stop it**, below) and the` |
| 13 | `README.md` | `**What a crossing costs.** Caps stay global: one row, whole box, no per-project` |
| 13 | `README.md` | `pauses every reclamation and every expiry fleet-wide), a git operation in progress, a lock, or` |
| 13 | `README.md` | ``refuses `paused` on the box, and the expiry of archived workspaces stops too. The same row lists the…`` |
| 13 | `README.md` | ``\| `coord-pause --state on\\|off` · `reclaim-pause --state on\\|off` · `project-pool --project <p> --po…`` |
| 13 | `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` | ``workspaces too: it is the fleet's one cleanup switch (`2026-09-24-workspace-lifecycle-design.md` §5.…`` |

## Deploy note

**SERVER + PWA + the FLEET box's skill spine, through ccrc's own updater; nobody moves a box by hand** (the operator's 2026-09-30 ruling). Both boxes move — the fleet box first, `ccrc rollout`'s default — because coordinator clause 3 (Task 4) and `references/resume.md` (Task 13) reach a coordinator's home only through `ccrc update`'s install spine on the fleet box; a server-only update leaves every home on the old text, and doctor's `skills` check (`ccrc doctor --fix` cures it) is how to see the new text has landed. No `ccd/ccd` change: the fleet box's ccd is untouched, and nothing in this wave needs a newer one. The server's first boot on this build runs migration 18 (one `CREATE TABLE`, measured to leave a rollback bootable — Pre-flight finding 2).

**What changes on deploy, for every operator, before anything is armed:**
- The expiry lane (still shadowed until `$REG/expire-lane-live`): an archived workspace whose expiry cannot be learned is listed ("its expiry could not be learned — …") and backed off; a non-resumable failure is listed at once and not retried; a `would-expire` or `in-use` entry goes when the workspace stops being eligible; the held sentence names its instant.
- Coordinator clause 3 says a child-marked workspace is never the expiry's, and the coordinator's resume runbook says what an armed dead-coordinator lane does to a programme whose coordinator stays dead (both reach each home through the fleet box's install spine).
- If Task 5 shipped: both archive confirms say the workspace is cleaned up seven days after its archive "once automatic cleanup is on".
- **The dead-coordinator lane runs SHADOWED.** Each 60-second pass it measures the distinct claimants of open runs (a registry listing, ~27 field reads and one tmux call each — an agent frame in remote mode), reads the journal's trust (the mirror's health, one gap read, and one `stat` only while ccd has counted journal write failures), keeps a durable first-dead anchor for each crashed one, and after an hour and two passes RECORDS "would end programme <slug> (<n> runs)" for EVERY due coordinator — a feed row carrying its first-dead instant and an entry in the cleanup row on `/runs`. Nothing is closed. A run's events never read `sweep` until it is armed.
- **Coordinators listed `unmeasured` are expected.** One whose journal the server cannot trust — the mirror `unavailable`, a gap the mirror recorded since its last successful spawn, a journal line ccd could not write after it — is listed and never acted on, as are one with no registry row and no history and one that never started. The journal-gap trade is ACCEPTED for this wave (the coordinator's ruling, 2026-10-07): a coordinator whose last successful spawn is not newer than a recorded gap stays unmeasured — listed, never ended — until its next successful spawn; the operator reclaims or abandons it by hand. Whether a gap should stop counting after some age is carried, for a decision with shadow evidence. While the mirror has not swept since the restart, or is `stale` (`/api/fleet/health`'s `lifecycle`), the lane decides nothing and says so in the server log.
- **The breaker's likely first trip.** Every coordinator that was already crashed at deploy is anchored on the first pass, so if two or more were, they trip the breaker together: one entry names them, one feed row records the trip, and the lane ends nothing until fewer than two remain (Pre-flight finding 12). A tmux that does not answer trips it too. That is the list to work through before arming: revive each, reclaim its programme (`POST /api/runs/:id/reclaim`), or abandon its runs (`POST /api/runs/:id/abandon`).

**Arming is the operator's, by hand, in the registry the server reads** — the fleet box's `~/.cc-sessions` when the server runs `CCRC_FLEET=remote` (Pre-flight finding 6); nothing in the tree writes the file (Task 13's pin). Read the shadow's `would-end` entries and the breaker on `/runs` first, then `touch ~/.cc-sessions/dead-coordinator-lane-live`; `rm` it to return to shadow — the executor reads it again inside the serialiser, nearest the act. `reclaim-paused` (the cleanup row's toggle) stops this lane entirely, armed or not, with child reclamation and the expiry lane. Measure after convergence: `/health` reports the merge's tag on the server box and `ccrc version` on the fleet box; `ccrc doctor` shows no FAIL lines and its `skills` check is green on every home; the cleanup row shows the lane's entries; the server log has no `sweepDeadCoordinators could not read` line; `python3 deploy/measure-workspace-lifecycle.py` prints the `dead_coordinator_*` rows (zero ended while shadowed).

**Arming the EXPIRY lane** stays the operator's separate act, and its blockers (a)–(b) from the 2026-10-07 06:01 entry are this wave's Tasks 1–3 and Task 5: arm it only after this wave is merged and deployed.

**Arming order — the coordinator's recommendation (2026-10-07); arming stays the operator's act.** The expiry lane first, once this wave's residue blockers are deployed and its shadow list has been read; the dead-coordinator lane only after its own shadow list and any breaker trip have been worked through.

## Deviations found

Named by slug — twenty, and the brief issues the numbers for all twenty: the worker writes them bare, in this order, in the entry as it defines it (`- **D-<n>** `<slug>` (Task k) — …`), in the commit of the first task that makes the change (the callout at the top). Every one reaches the spec by its effect: the residue's through §5.3's "Review 313's residue, closed by wave 4" item (Task 4) and its words item (Task 5), the lane's through §5.4's "As wave 4 builds the lane" (Task 13) — one short sentence each, no number spelled there.

- **D-4348** `unlearnable-row-backs-off-is-reported-and-yields-its-slot` (Task 1) — review 313's parked item 1, ruled an arming blocker: a learn audit that cannot be read, or that read no archive and is not a return, climbs the failure ladder and is listed at once; learn slots go in `nextAskAt` order (stable, so ties keep registry order). The 3b lane retried such a row every pass with no backoff and no entry, and gave slots in registry order.
- **D-4349** `non-resumable-expiry-failure-stops-at-once` (Task 2) — parked item 4, an arming blocker: `ArchivedExpiryOutcome.failed` carries `resumable`; `false` is listed at once and never asked again for that archive; a composition error's sentence stops promising a retry.
- **D-4350** `ineligible-sighting-ends-every-row-report` (Task 3) — F1, an arming blocker: an ineligible verdict clears `would-expire` and `in-use` (and the in-use run) as well as `held`; the box's own verdicts stand.
- **D-4351** `refusal-from-another-archive-is-a-moved-row` (Task 3) — F2: an audit whose `archivedAt` is set and is not the queued archive defers `state-changed` before any refusal is classified.
- **D-4352** `held-sentence-names-the-instant` (Task 3) — F3: the held sentence names `due <instant>`, never a period, and the lane's own two files are pinned against seven-day prose (the tree-wide prose pin was measured and declined: five holders, Pre-flight finding 11).
- `archive-confirm-hedged-until-armed` (Task 5, DROPPABLE) — parked item 2: both confirms say the cleanup follows "once automatic cleanup is on". Not written if the operator strikes Task 5 before merge.
- `dead-coordinator-lane-ships-shadowed` (Tasks 10, 11, 13) — the coordinator's safety ruling (B), which §5.4 did not have: until `$REG/dead-coordinator-lane-live` exists (the operator's, by hand; no writer in the tree) the lane measures, anchors, trips its breaker and records "would end programme <slug> (<n> runs)" for every due coordinator, and never reaches the abandon arm or the reclaim port; the executor reads the file inside the serialiser and again inside the arm before each run; `reclaim-paused` stops it entirely, shadow included; the coordinator's resume runbook states the condition in words.
- `the-last-start-is-read-off-the-spawn-line` (Task 6) — the clause's "last successful start" is the newest `spawn` line recording rc 0, read off the line's own bytes because the mirror's typed `meas.rc` is null on every real line (Pre-flight finding 1); a line that proves no start leaves every row in the horizon counting; ccd's change-only spawn line is a stated, fail-safe hole.
- `journal-doubt-reads-as-deliberate` (Task 6) — §5.4 lists the deliberate acts; an act this build cannot name (`unknown`) and an `unsupervise` whose surface cannot be read count as deliberate too, so doubt in the journal never reads as a crash.
- `journal-loss-reads-as-unmeasured` (Tasks 6, 8, 10, 11) — §5.4's "an unreadable journal is unmeasured" is widened to a journal that may have LOST the act: the mirror `unavailable`, a gap recorded in a generation not older than the claimant's last successful spawn, or a journal line ccd counted as unwritten after it, each makes the claimant unmeasured (listed, never acted on); a mirror not swept since a restart, or `stale`, makes the pass decide nothing (Pre-flight finding 14). The trade is accepted for this wave: such a coordinator stays unmeasured until its next successful spawn.
- `never-started-without-a-spawn-is-unmeasured` (Task 6) — §5.4 counts `never-started` as a crash; a `never-started` row with no successful spawn in the journal never ran, so it is unmeasured — an heir the operator reclaimed a programme onto and has not started yet reads exactly so, and the lane would otherwise end that programme an hour later.
- `dead-anchor-restarts-after-an-unobserved-gap` (Tasks 6, 8, 11) — §5.4's anchor is `firstDeadAt` alone; `dead_claimants` also keeps `lastDeadAt`, and an episode whose last crashed pass is more than ten minutes old (a server down, an older build after a rollback) restarts at the pass that measures it. The table is a new table and nothing else, measured to keep a rollback bootable (Pre-flight finding 2).
- `breaker-holds-the-whole-lane` (Tasks 6, 11) — while the breaker stands the lane acts on NO claimant, not only on the ones it names.
- `breaker-remembers-its-cluster` (Tasks 6, 11) — §5.4's breaker is evaluated per pass; this one keeps its members at their first-dead instants and releases a member only on evidence (alive, stopped, a deliberate act) or when it leaves the population, so a member's one unmeasurable pass — which deletes its anchor under ruling (E) — never dissolves the cluster. "Fleet-wide" is what the pass measured: tmux not answering for any claimant trips it whatever the count; a registry that will not list stops the tick before the lane runs (Pre-flight finding 15).
- `breaker-clears-through-the-existing-doors` (Tasks 6, 11) — §5.4's "the operator clears it" is the operator reviving, reclaiming or abandoning the named claimants, after which they fall under the threshold; no new route (box-token census unchanged). A one-tap clear door is carried.
- `one-dead-coordinator-per-pass` (Task 11) — ARMED, at most one claimant is acted on per pass, the longest dead first; §5.4 is silent, and the expiry lane's one-act-per-pass is the precedent. In SHADOW every due claimant is recorded, so the list the operator arms on hides none.
- `the-sweep-re-measures-inside-the-arm` (Tasks 9, 10) — §5.4 re-measures "immediately before EACH run's close" and leans on the compare-and-set for "no successor"; a compare-and-set cannot see a revive of the SAME id, so the abandon arm itself re-measures (`SweepCloseGuard.stillCrashed`) immediately before the fleet act and again after it, before the commit, and a re-measure that is not a crash deletes the anchor as a pass's would. The residual, stated: a revive inside the second re-measure's round trip (Pre-flight finding 16).
- `dead-coordinator-attention-from-lane-memory` (Tasks 6, 11) — the attention list (would-end, unmeasured, stuck, the breaker) is derived from the lane's in-memory entries and its last breaker, rebuilt over the passes after a restart; it can delay an act and never cause one. Its own list on the wire, never another lane's. The breaker's trips and every act's first-dead instant ARE durable — feed rows, which spec §9's instrument reads (Pre-flight finding 17).
- `the-dead-coordinator-lane-never-pushes` (Task 11) — its rows are feed records and list entries; the stall watch's per-worker pushes — r3 `coordinator-dead`, and `coord-deaf` once its wave-2 arms are armed — are the notifications about a dead coordinator (Pre-flight finding 9).
- `caused-by-vocabulary-lives-in-the-build4-design` (Task 13) — §6 item 5 names CCR-15's text; measured, CCR-15's texts spell no `causedBy` vocabulary, so the sentence amended is the build-4 design's, and §6 item 5 says so (Pre-flight finding 5).

Not departures, and named so nobody hunts for a number: F4 (a stale doc line), F5/F6/F7/O1/O2 (records corrected to what shipped or was measured), parked item 3 (clause 3's child marker, which §6 and `wave-lifecycle.md` §6 already said), the `causedBy: 'sweep'` word and the `claimant-changed` refusal (spec §5.4's own), the `sweep-stopped` refusal (the re-measure's word, spec §5.4's "an alive answer at any point ends the whole act"), a thrown act's backoff (§5.4's "not retried beyond the lane's backoff"), a partly ended programme's feed row (§5.4's row is for an ENDED programme; one the act closed only part of is not), the README and CCR-15 §5.8 passages widened to name the lane (spec §5.3's "the switch"), spec §9's stage-4 rows (§9's own), and `mail-routes.test.ts`'s fifteenth union (the lane's own vocabulary, admitted as every earlier union was).

## Carried out of this wave (recorded in the programme ledger)

| Follow-up | Owner | Why not here |
|---|---|---|
| A one-tap "clear the breaker" door | carried (the coordinator's ruling, 2026-10-07) | not this wave: the breaker clears through the existing doors |
| `journalparse.ts`'s numeric `meas` keys read ccd's decimal strings | a follow-up, if the operator wants the typed field | its degrade is pinned there on purpose; this lane reads the raw line and a typed 0 still counts, so a fix changes nothing here |
| ccd's change-only `spawn` line hides a quick successful revive (Pre-flight finding 1) | a follow-up, if the coverage matters | fails safe (the coordinator is never ended); reading the registry's `spawn` field as the start when it is newer than the newest journaled spawn would close it |
| The residual window of a same-id revive inside the arm's last re-measure (Pre-flight finding 16) | stated, not closed | closing it needs a lock `ccd ensure` would honour, which this wave's no-ccd-change scope excludes |
| A fleet-wide registry failure raises no attention item (the tick stops before the lane runs) | a follow-up if wanted | the fleet health already reports an unlistable registry, and no pass acts |
| Whether a recorded journal gap stops counting after some age | carried, for a decision with shadow evidence | the trade is accepted for this wave (the coordinator's ruling, 2026-10-07): a coordinator whose last successful spawn is not newer than a recorded gap stays unmeasured — listed, never ended — until its next successful spawn |
| The breaker's clear and the would-end list survive a restart | a follow-up if wanted | the departure `dead-coordinator-attention-from-lane-memory`; a restart re-trips or re-lists within two passes |
| Wave 2's three operator questions (the PR sheet's "Archive now", the remote-mode worktree check, L5's sentence) | stay open with the operator | unchanged by this wave |
| The expiry lane's arming items (c) the first armed pass's backlog and (d) brisk-mesa's tmux server | the operator, at arming | the 06:01 entry's; not code. Measured fact (2026-10-07): the operator expired 15 archived workspaces BY HAND (`CCD_EXPIRE_BY_HAND=1`, `--surface cli --actor operator`; 8 ccrc-pwa, 7 expoAI-assistant; 0 refused; `residueBytes` 0 on all) — the server composed none; `ccrc-pwa-brisk-mesa` stays archived until the operator ends a stray tmux test server holding it |

## Open questions — ruled (the coordinator, 2026-10-07 19:30 UTC)

The five questions this plan asked are ruled; each ruling is applied where the plan names it.

1. **The breaker's clear.** Not this wave. The breaker clears through the existing doors — revive the named coordinators, reclaim their programmes, or abandon their runs (the departure `breaker-clears-through-the-existing-doors`). A one-tap clear door is carried.
2. **Arming order** (the deploy note states it as the coordinator's recommendation; arming stays the operator's act): the expiry lane first, once this wave's residue blockers are deployed and its shadow list has been read; the dead-coordinator lane only after its own shadow list and any breaker trip have been worked through.
3. **Task 5's copy** STAYS in the plan, self-contained and droppable; the operator may still strike it before merge.
4. **Departure numbers.** The coordinator issued a second block of four: the brief issues the numbers for all twenty slugs. The plan writes no number.
5. **The journal-gap trade** is ACCEPTED for this wave: a coordinator whose last successful spawn is not newer than a recorded gap stays unmeasured (listed, never ended) until its next successful spawn; whether a gap should stop counting after some age is carried, for a decision with shadow evidence.
