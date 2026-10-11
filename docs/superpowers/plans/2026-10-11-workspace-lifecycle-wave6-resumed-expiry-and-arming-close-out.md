# Workspace lifecycle wave 6 — the resumed expiry's `crumb`, the stuck word, a counted restart, the journal re-read, and the arming close-out (CCR-17) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The execution method is chosen (a dispatched fleet worker, subagent-driven); there is no hand-off question.

**Goal:** Close the programme's last wave. FIRST, question (k) — the expiry lane's last arming blocker: `ws-expire` says CCR-15 wave 7's `crumb` on its own `failed` documents, and `parseExpireResult` reads the word, then `crumb`, so a resumed expiry's `probe-unmeasured` is retried, never final. Then: `containment-refuted` is STUCK on the expiry lane (listed at once, the persistent tier, never +∞); a `restart` that recurs is counted on the shared failure run; the symbolic-HEAD control case and its ccd comment; `stillCrashed` re-reads the mirror's health and gap list after the claimant's measure; wave 5's worker residuals (the standing entry's cadence in true words and `flock-unavailable`'s halt said plainly, the shadow feed row over a standing entry, the census bound at `_ws_tombstone`, a lane case for a hold after the fleet act); rung 8's and 4458's checks; and one "Before arming" section in the spec. Both lanes stay SHADOWED.

**Architecture:** One ccd region, `_ws_expire_locked` (ruling A's three-line `crumb` block, ruling D's comment), plus one comment in CCR-15's region that would otherwise be false (Task 1: wider than ruling A's "inside `_ws_expire_locked` ONLY", comment only, consent to be carried in the brief). Server-side, every change lives in files wave 5 shipped: the L1 verdicts (`server/src/archivedExpiry.ts`), the two executors (`server/src/coord/expireArchived.ts`, `server/src/coord/endDeadCoordinator.ts`) and their two passes in `server/src/watch.ts`. No wire word is added — a stuck entry rides the wire as `failing`, CCR-15's precedent (R77: no new chip word) — so `shared/api.ts` and the PWA are not touched. No route, no migration, no `FLEET_PROTO` bump, and no arming path: `expire-lane-live` and `dead-coordinator-lane-live` keep NO writer in the tree.

**Tech Stack:** TypeScript (Node ≥ 22.16, `node:sqlite`), vitest, bash (`ccd/ccd`), git ≥ 2.43.

**Spec:** `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` §5.3 (`ws-expire` and the expiry lane), §5.4 (the dead-coordinator lane), §8, §9; CCR-15's contract `docs/superpowers/programs/child-reclamation-contract.md` R76–R81; the programme ledger (the coordinator's worktree copy) — its 2026-10-08 20:00 and 21:55 entries, its 2026-10-09 07:00, 07:50 and 08:20 entries, its 2026-10-10 21:50 and 2026-10-11 01:00 entries, its Carried constraints and its Next-wave brief; wave 5's evidence (`.superpowers/sdd/coordinator-evidence/run345/`: reviews 355–357, `final-fix-report.md`, `progress.md`).

> **Departure numbers.** This plan names its departures by SLUG under `## Deviations found` and defines no number. The run's brief issues the numbers (block 4617–4632): the worker writes them bare, in the order `## Deviations found` lists the slugs, each in the entry that defines it, in the commit of the first task that makes the change — never a guessed number. Sixteen departures are defined and the block issued is sixteen, so every number is used; a departure found while executing is reported for a further number, never typed.

> **What ccd prints today, measured (ruling A's first instruction).** On `origin/main` `7609221a4` (#344 merged), `_ws_expire_locked` never sets `_WS_RCL_CRUMB`, so the global's load-time `''` reaches every `failed` document it prints itself: its fresh arm's `probe-unmeasured`, `pin-failed`, `state-changed` and `tombstone-unwritable`, and its RESUMED arm's `probe-unmeasured`, all carry NO key (measured: Task 1's four red cases each print the keyless document; `ccd-child-reclaim-crumb.test.ts`'s own describe "ws-expire — its locked body is not edited" pins two of them keyless). Only the shared tail says `"crumb":true` for an expiry (`_ws_reclaim_tail` sets it at its top). So on `main` the resumed arm's `probe-unmeasured` reads final by its word — question (k). Task 1 sets `crumb` exactly as `_ws_reclaim_locked` does — `true` on a resumed arm, `''` (no key) over a breadcrumb that stands but cannot be read, `false` otherwise — and `false` measures CLEAN: every document that arm prints is printed before `_reg_set "$id" reaping "expire:$start"` (the breadcrumb write is a rename, `_plat_mv_notdir`, so a failed write leaves none), and the tail resets it to `true` first thing. The census under Measured while planning item 1 places each document against the breadcrumb.

## Global Constraints

- **SAFETY (CLAUDE.md), absolutely.** Fixture HOMEs and fixture stores only. Never run `ccd` against the live `$HOME`; never run `ws-expire`, `ws-audit --expire`, `ws-reclaim`, `ws-collect` or any destructive `ccd` verb against the live host; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*.service`; never call the live server's run, mail or abandon routes; never print a secret file's contents. **Both lanes this wave touches act on the live fleet once armed** — the expiry lane deletes archived workspaces through `ws-expire`; the dead-coordinator lane closes other coordinators' runs `failed` and gets their children reclaimed — so every case here runs against a fixture store, a fixture HOME and a scripted runner, exactly as waves 4 and 5's suites do.
- **Both lanes stay SHADOWED. This wave creates no live file and touches no arming path (ruling K).** `expire-lane-live` and `dead-coordinator-lane-live` keep NO writer in the tree: `single-definition.test.ts`'s two no-writer pins stay green, and this plan does not edit that file. The spec's new §12 is words only; it arms nothing.
- **The environment.** The fleet box is loaded and other workers run suites. Run vitest in the FOREGROUND, ONE test file per process (`./node_modules/.bin/vitest run <file> --maxWorkers=1`, never bare `npx vitest`, never two suites at once, never in the background). `TMPDIR` on the volume but OUTSIDE every git checkout; delete only fixtures you created; `CCD_DISK_FLOOR_GB=1` for test runs. `cd server && npm ci`, and `agent/` and `pwa/` too (`typecheck-tests` needs both). Never `pkill`/`killall` by pattern; kill only PIDs you recorded.
- **Known reds not caused by this work:** `tmp-sweep`'s "FAILS CLOSED…", `session-hook`'s "skips a scratch slug" under a `TMPDIR` outside `/tmp` (measured here: shard 4 of the full run), and `boot.test.ts`'s timing cases under load.
- **`ccd/ccd` is edited twice (Tasks 1 and 5).** Re-stamp it (`~/.local/bin/ccrc restamp ccd/ccd`) after each edit, then `bash -n ccd/ccd`. Every edit sits far below the frozen compaction-card corpus's highest `ccd/ccd` anchor, and the citation census is unchanged — measured, Measured while planning item 7.
- **The five citation cases** run after every task that edits a cited file (README, `ccd/ccd`):

  ```bash
  ( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
  ```

  Measured: `5 passed | 445 skipped (450)` on the final prototype. README's edits (Task 11) sit below README's `shared/api.ts` citations, so nothing is re-pointed.
- **Deviation numbers.** No `D-<n>` token is written for a new number in any code comment, test title or doc this plan touches: comments name the ruling (`wave 6, ruling B`) or the finding (`review 355, F7`).
- **No hostnames, IPs, tailnet names or docserver URLs** anywhere in the diff (`topology-clean.test.ts`).
- **Overlap (ruling J).** CCR-15 wave 8 (run 348, calm-mesa; dispatched 2026-10-11 00:59Z to quiet-prairie, mail 4202) is in flight. It touches `server/src/watch.ts` (its child-reclaim arms), `shared/api.ts` (Task 1's L0 grammar, and the MOVE of `keptLeafWord` to L0 as `leafKeptWord` — Order A of R81: wave 8 makes that move, NOT this wave), `server/src/archivedExpiry.ts` (that move's import and its word half) and `server/test/containment-refuted-word.test.ts` (its reclaim assertion and the shared describe's title). Run 354 (ccrc-history, brisk-meadow) holds claims on `README.md`, `CLAUDE.md`, `server/test/ws-expire-prose.test.ts`, `server/test/expiry-lane-prose.test.ts` and `server/test/dead-coordinator-prose.test.ts` (they may lapse or renew): Task 11 edits README and the last two, so it claims them, or asks the holder for a region split on a 409. This plan's `ccd/ccd` regions are `_ws_expire_locked` (Tasks 1 and 5) and one comment above `_ws_reclaim_failed_json` (Task 1, CCR-15's region: see Task 1's consent note). Task 1 also edits `server/test/ccd-child-reclaim-crumb.test.ts` (CCR-15 wave 7's file: its ws-expire describe asserts the keyless documents this wave replaces). CCR-15 AGREED the `containment-refuted-word.test.ts` split (mail 4202, answering 4200): this wave moves its `parseExpireResult` case into a describe of its own and flips it there, and whichever wave lands SECOND makes the shared describe speak of the reclaim parser only (its title and wave 8's comment), with CCR-15's consent to edit exactly those lines of wave 8's. Mail 4202 does not answer the two `ccd`-side edits (the `_WS_RCL_CRUMB` comment and the crumb test's describe): the brief carries that consent, or Task 1 drops block 6 (question (o)). **Whichever lands second runs `git merge origin/main` (never a rebase), keeps both sides, re-stamps `ccd/ccd`, re-runs the five citation cases, `cite-remeasure` and the `_reg_get` census, and re-points by content.** `## Re-measure at dispatch` lists every block in a shared file, and what each becomes if wave 8 lands first.
- **The stuck word is read from L0, never listed again (ruling B).** `containment-refuted`'s home is `LcRefusalToken` in `shared/api.ts`. `archivedExpiry.ts` is L1 and imports L0 alone, so it cannot import CCR-15 wave 8's `CHILD_RECLAIM_STUCK_TOKENS` (spelled in `server/src/coord/childReclaim.ts`, L3, by R77). It declares the one word it reads as `EXPIRE_STUCK_WORD: Extract<LcRefusalToken, 'containment-refuted'>` — the L0 member's own type, so a rename or removal there leaves `never` and the build fails. If wave 8 lands first, Task 12's merge step adds one assertion holding the two equal (Re-measure at dispatch).

## Review Focus

What a reviewer looking for a workspace deleted, or a programme ended, that should not have been meets first:

1. **Nothing arms.** No file in the diff writes `expire-lane-live` or `dead-coordinator-lane-live`; `single-definition`'s no-writer pins stay green (Task 12).
2. **`crumb` adds acts only where `main` stopped for good, each behind the act's own audit.** `false` is read as `restart` — the lane forgets what it learned and audits afresh with a fresh token (wave 5's meaning); `true` is read resumable. So two answers `main` read FINAL are asked again: a fresh `probe-unmeasured` (`crumb:false`: re-learned and audited afresh, counted on the shared ladder, at most hourly — Task 4) and a resumed one (`crumb:true`: resumed on the failure backoff, the persistent tier after a day). A fresh `pin-failed` or `tombstone-unwritable`, which `main` resumed, is re-learned instead. Every such act audits first, spends only that audit's token, and ccd re-proves inside its lock. An absent or non-boolean `crumb` is `main`'s word rule exactly, so an older ccd (agent-first skew) parses as `main` does (Task 2, the fallback rows).
3. **`ws-expire`'s `false` is true.** Every document its fresh arm prints is printed before the `expire:` breadcrumb write, and each of the four says `false` in a case (`state-changed` in the consent-branch file); the resumed arm's `probe-unmeasured` is printed while an earlier attempt's breadcrumb stands, and says `true`; a breadcrumb that stands but cannot be read says nothing, so that one document is still read final by its word — fail-safe, and stated in §12 (Task 1; Measured while planning item 1; the departure `an-unreadable-breadcrumb-stays-keyless`).
4. **`containment-refuted` is listed at once and never stranded**: a stuck entry is on the persistent tier from its first answer (four hours, never +∞), stands through every answer until an attempt completes or the archive changes — a `flock-unavailable` among them (Task 8) — and a terminal verdict still outranks it; no sentence suggests a destructive verb (Task 3).
5. **A recurring `restart` is visible, not faster.** It now backs off (the shared ladder) and is listed after the hour; measured, it composes 7 acts in 180 passes where `main` composed 60 (Task 4).
6. **The revive window does not widen.** `stillCrashed`'s claimant measure stays its LAST await: the health state, the gap list and the write-error count are re-read synchronously after it (the port returns no promise), and a structural case reds on any `await` after the measure — or between `close.ts`'s post-fleet-act re-measure and its commit, each half with its own measured row (Task 6, T6.7, T6.10, T6.11). A mirror that turns stale, gains a gap, or counts a write failure where the early read saw none, during the measure, stops the act; a stale one keeps the anchor and the run of passes (F4).
7. **The words are true.** A standing entry, and the stuck feed row, say it is asked again four hours after each failed attempt (sooner after an answer that ends no attempt, never while held); `flock-unavailable`'s feed row says the lane composes nothing on that box until a restart, and so does the row's entry unless a standing entry stands there; a shadow feed row over a standing entry never says "nothing was deleted" (Tasks 3 and 8).

## File Structure

| File | Tasks | What changes |
|---|---|---|
| `ccd/ccd` | 1, 5 | `_ws_expire_locked`: the `crumb` block (A) and the attached-HEAD sentence in the consent-branch comment (D); the `_WS_RCL_CRUMB` comment (CCR-15's region, comment only) |
| `server/src/archivedExpiry.ts` (L1) | 2, 3, 4, 8 | `parseExpireResult` reads the word, then `crumb`; `EXPIRE_STUCK_WORD` and the `stuck` read, outcome, report, entry arm and sentence; `stuck` in `expiryReportStands`; the restart counted and the learn's carry; `halted` on `flock-unavailable` over a row with no standing entry; `STANDING_ASKS_AGAIN` |
| `server/src/coord/expireArchived.ts` | 2, 3, 8 | the `restart` feed row's words; the `stuck` outcome and feed row (its cadence in the standing entry's terms); `expireFeedBody`/`recordExpireFeed` take `standing`; `flock-unavailable`'s feed row says the halt |
| `server/src/coord/endDeadCoordinator.ts` | 6 | the `journalReread` port; `rereadDeadCoordinatorJournalTrust` (health state, gaps, and the write-error count); `stillCrashed` re-reads after the measure |
| `server/src/watch.ts` | 6, 8 | wires `journalReread`; passes `expiryReportStands(entry.report)` to the feed row |
| tests: `ccd-child-reclaim-crumb`, `archived-expiry-policy`, `archived-expiry-lane`, `containment-refuted-word`, `ccd-ws-expire-consent-branch`, `end-dead-coordinator`, `dead-coordinator-lane`, `expire-archived`, `expiry-lane-prose`, `dead-coordinator-prose` | 1–11 | the cases below |
| `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` | 11 | §5.3 "As wave 6 closes the lane" and three corrected wave-5 sentences; §5.4 "As wave 6 closes the lane"; a new §12 "Before arming" |
| `README.md` | 11 | the expiry paragraph's cadence and new sentences; one dead-coordinator sentence; the `crumb` sentence in CCR-15's paragraph |

Not edited: `shared/api.ts`, the PWA, the agent, `single-definition.test.ts`, `server/src/coord/childReclaim.ts`, `CLAUDE.md`.

## Measured while planning

Everything below was measured on a prototype of this plan at `origin/main` `7609221a4` (CCR-15 wave 7, #344, on top of wave 5's #335), in an isolated worktree, one test file per process, `TMPDIR` on the volume outside the checkout, `CCD_DISK_FLOOR_GB=1`, load average 12–18. The revision after the four review lenses rebuilt that prototype stage by stage with its changes folded in (Tasks 1, 3, 6, 8, 9 and 11) and re-measured every count those stages report. The prototype was then reverted: only this file is committed.

1. **The crumb census — every `failed` document `ws-expire` prints, against its breadcrumb** (read off ccd/ccd and measured by Task 1's cases):

   | Where it prints | Arm | Before or past ccd's `expire:` breadcrumb | `main` (#344) | After Task 1 | Measured by |
   |---|---|---|---|---|---|
   | `_ws_expire_locked`'s verdict point, `_ws_reclaim_failed_json probe-unmeasured` | fresh | before (no breadcrumb stood at the fork's read, inside the lock) | no key | `false` | crumb: "fresh arm: its own probe-unmeasured …" |
   | the same | resumed | past an EARLIER attempt's breadcrumb, which stands | no key | `true` | crumb: "resumed arm: probe-unmeasured …" |
   | the same | a `.reaping` that stands but cannot be read (the fork's `_ws_reclaim_unmeasured`) | not known | no key | no key | crumb: "a breadcrumb that stands but cannot be read …" |
   | `_ws_reclaim_fail … pin-failed` after the pin | fresh | before | no key | `false` | crumb: "fresh arm, before the breadcrumb: pin-failed …"; consent-branch: the symbolic-HEAD control |
   | `_ws_reclaim_fail … state-changed` (wave 5's consent check) | fresh | before | no key | `false` | consent-branch: the DELETED-in-the-window case asserts `crumb: false` (Task 1; red on `main`'s ccd, `expected undefined to be false`; row T1.4) |
   | `_ws_reclaim_fail … tombstone-unwritable` | fresh | before: the breadcrumb is the condition's last write, a rename that leaves nothing when it fails | no key | `false` | crumb: "fresh arm: tombstone-unwritable …" |
   | every `_ws_reclaim_fail` in `_ws_reclaim_tail` (`containment-refuted` among them) | both | past (the tail sets `_WS_RCL_CRUMB=true` at its top) | `true` | `true` (unchanged) | crumb: "the SHARED tail says crumb true for an expiry too" |

   So `false` is clean on every document that says it, and only the resumed arm says `true` from `_ws_expire_locked`'s own printer. A refusal (`{"refused":…}`, exit 0) carries no `crumb` on either side and is unchanged.

2. **The restart's recurrence, measured** in `archived-expiry-lane`'s fixture (a `ws-expire` that always answers `{"failed":"state-changed"}` with no `crumb`, 180 passes one cadence apart). On `main`: an act on every third pass (`3, 6, 9, … 180`, sixty acts), never listed, one feed row. After Task 4: acts on passes `3, 7, 13, 23, 41, 75, 137` (seven), listed from pass 75 (its run has lasted the hour), still one feed row. A `crumb:false` document of any word takes the same path.

3. **`flock-unavailable`'s halt, measured by reading and by the lane.** `watch.ts` sets `archivedExpiryBoxRefused` on the first `flock-unavailable` answer and composes no further act for the life of the process (the lane case "flock-unavailable stops the lane on that box" pins it). On `main` the row that met it reads "cleanup keeps failing: … It is retried, backing off in between." — untrue, since nothing is retried. Task 8 makes the words true rather than loosening the halt (the departure `flock-unavailable-is-final-for-the-row`): the halt is the only safe answer to a box that cannot serialise a destructive verb, and a restart already asks it again, once. Under a standing entry (stuck, or the tier's) the entry keeps its place, as under any failure of the verb, and the feed row — written for every new answer — carries the halt.

4. **Wave 5's census residual, measured.** Moving the expiry's `failed` `state-changed` producer to just after `_ws_tombstone` (and renaming the original) leaves `main`'s census green (`74 passed (74)`), because it bounds at the breadcrumb; with Task 9's bound at `_ws_tombstone` it reds (`1 failed | 73 passed (74)`).

5. **Rung 8 (ruling G), measured: nothing pins the old answer.** `git grep -n "gitdir\|no-worktree-record"` over `server/test/archived-expiry-*.test.ts`, `server/test/expire-archived.test.ts`, `server/test/expiry-lane-prose.test.ts`, `server/test/ws-expire-prose.test.ts`, the spec and README finds no expiry-lane case, journal word or operator sentence that pins a terminal `no-worktree-record`, or a blank head, for an admin `gitdir` naming no path. The ccd side is CCR-15's and pinned (`ccd-child-reclaim-silent-omission.test.ts`, its describe "ws-expire runs the same ladder, so it answers the same": unmeasured, exit 1, journaled nowhere). On the server an exit-1 audit is `unreadable` (learning) or `audit-failed` (the act), each retried; `archivedExpiry.ts`'s `no-worktree-record → terminal` stays right for a record that is truly absent. Nothing to fix.

6. **4458 (ruling H), measured: the pin exists and reds.** `_ws_expire_cwd_users` resolves its parent with `_ws_dir_physical "$parent" && preal="$_WS_PHYS" \` (ccd/ccd:31549 at `7609221a4`). `ccd-leaf-root-newline.test.ts` is `13 passed (13)`; with that line mutated back to `preal=$(cd -- "$parent" 2>/dev/null && pwd -P) \` it is `2 failed | 11 passed (13)` (× a FAKE process table on any host …; × a LIVE process of this uid …). No new pin is owed.

7. **The citation census, after the whole prototype** (`cite-remeasure.py`, extracted from `docs/superpowers/plans/2026-09-22-child-reclamation-wave1-marker-and-containment.md` as earlier plans do, read-only against `origin/main`): `byFile['ccd/ccd'] stated 147 base 147 tree 147`; `total stated 196 base 196 tree 196`; `other byFile keys moved: none`; `row array 54/54/54`, `site array 35/35/35`, nothing ENTERED or LEFT. `ccd-reg-get-census` `3 passed (3)`. The five citation cases `5 passed | 445 skipped (450)`.

8. **The replay.** The 95 blocks below, applied to `origin/main` `7609221a4` in the order given, each match exactly once at their turn and reproduce the prototype byte for byte in all 17 files they touch (`ccd/ccd` save its stamp line, which `ccrc restamp` writes: `sha256=eb5067d0…3497` on the final tree). After each task's stages, every file the plan has touched equals the prototype's commit for that stage, so each red and green count below is the count measured at that stage.

## How to read the blocks

Each edit is a block headed by an HTML comment, `<!-- replay: replace <path> -->`. It names its file (an `In <path>, find:` line), shows the text to find — whole lines, occurring EXACTLY ONCE in the file at that point of the plan (earlier blocks already applied) — and the text that replaces it; a block that only adds lines quotes its anchor lines in both halves. A block's text is the lines between its fences and ends with a newline. Apply the blocks in the order given: Step 1 of each task holds its test edits (the red stage), Step 3 its source edits (the green stage), and a docs step where it has one. `ccd/ccd`'s line 2 (`# ccrc:generated 1 sha256=…`) is never in a block: re-stamp after each `ccd/ccd` step.

**Model routing** follows the fleet's policy: `sonnet` for implementation from these blocks, `opus` for each task's review under the act-safety lens and for the whole-branch review; never `fable` unless the operator names it.

---

### Task 1: `ws-expire` says `crumb` on its own documents (ruling A, question (k) — an ARMING BLOCKER; ccd, AGENT-FIRST)

**Model routing:** `sonnet`, effort `high` — the destructive verb's locked body.

**Files:** `ccd/ccd` (`_ws_expire_locked`; the `_WS_RCL_CRUMB` comment above `_ws_reclaim_failed_json`); tests `server/test/ccd-child-reclaim-crumb.test.ts` (CCR-15 wave 7's: its ws-expire describe), `server/test/ccd-ws-expire-consent-branch.test.ts` (wave 5's: its DELETED-in-the-window case).

**Interfaces:** `_ws_expire_locked` sets the global `_WS_RCL_CRUMB` right after the fork, exactly as `_ws_reclaim_locked` does (`ccd/ccd`, its `# `crumb` (spec §5.6)` block): `true` when `phase` (an `expire:` breadcrumb's) is non-empty; `''` when `$REG/<id>.reaping` stands (file or link) but read empty; `false` otherwise. `_ws_reclaim_failed_json` prints `"crumb":true|false` only for those two literals, so the key is additive and an older server ignores it (it reads named keys only). The tail sets `true` at its own top, unchanged.

**Consent (ruling J), and scope.** The `_WS_RCL_CRUMB` comment (block 6) sits in CCR-15's region, OUTSIDE `_ws_expire_locked` — wider than ruling A's "inside `_ws_expire_locked` ONLY", so the coordinator rules on it knowingly (the departure `expire-documents-say-crumb` says so); after block 5 its sentence "So `ws-expire`'s own pre-breadcrumb documents, its resumed arm's `probe-unmeasured` …, carry no key" is false. The block changes that comment only. The brief carries CCR-15's consent (asked with mail 4200's split; mail 4202 agreed the test-file split and did not answer this one); if it is refused, drop block 6, keep the stale comment, and report it to CCR-15 for its next ccd edit. The test file's ws-expire describe is CCR-15 wave 7's too, and its two keyless assertions are exactly what this ruling replaces.

- [ ] **Step 0: Install each package's own modules, and the scratch directory**

```bash
( cd server && npm ci ) && ( cd agent && npm ci ) && ( cd pwa && npm ci )
mkdir -p <the volume's mount>/scratch-<run>-tmp   # OUTSIDE every git checkout; export TMPDIR to it, and CCD_DISK_FLOOR_GB=1
```

**A breadcrumb that stands but cannot be read stays keyless (argued; the departure `an-unreadable-breadcrumb-stays-keyless`).** Ruling A reads "every failed document ws-expire's resumed arm prints carries crumb:true". A `.reaping` that stands but cannot be read is neither arm: the fork cannot tell whose breadcrumb it is or whether this expiry wrote it, and stops at `_ws_reclaim_unmeasured`. `_ws_reclaim_locked` says nothing in exactly that shape, and CCR-15's reader then falls back to its pre-crumb word set (R76) as this wave's parser falls back to `main`'s rule, and ccd's own comment defines `true` as "printed past the act's breadcrumb", which ccd cannot claim here. So the key stays unsaid, the server reads `main`'s word rule (a final `probe-unmeasured`: listed, nothing deleted, asked again after a restart), and §12 says so to the operator (Task 11). Saying `true` instead would retry it on the tier forever against the same unreadable file; that is question (p).

- [ ] **Step 1: The tests (red).** The ws-expire describe is rewritten: the fresh arm's `pin-failed` (with `_WS_RCL_CRUMB=true` exported, so the value is the verb's, never the environment's), its `probe-unmeasured` and its `tombstone-unwritable` each say `false`; the resumed arm's `probe-unmeasured` (an interrupted expiry at `expire:worktree`, its tombstone at mode 000) says `true`; a breadcrumb that stands but cannot be read carries no key. The consent-branch file's DELETED-in-the-window case (the fresh arm's `state-changed`) asserts `crumb: false`.

<!-- replay: replace server/test/ccd-child-reclaim-crumb.test.ts -->
In `server/test/ccd-child-reclaim-crumb.test.ts`, find (block 1):

````ts
//     never that a breadcrumb stands now: a tail `purge-*` failure prints it
//     after the row and its breadcrumb were purged;
//   - `ws-expire`'s own pre-breadcrumb documents (its `probe-unmeasured`,
//     `pin-failed` and `tombstone-unwritable`) carry NO key: its locked body is
//     another programme's region and is not edited;
//   - a breadcrumb that stands but cannot be read says nothing either way.
// FIXTURE HOMEs ONLY: every ccd call runs through the harness, never against $HOME.
````

Replace with:

````ts
//     never that a breadcrumb stands now: a tail `purge-*` failure prints it
//     after the row and its breadcrumb were purged;
//   - `ws-expire` says it on its own documents too (workspace lifecycle wave 6,
//     question (k)): `false` on its fresh arm before its breadcrumb (its
//     `probe-unmeasured`, `pin-failed`, `state-changed` and
//     `tombstone-unwritable`), `true` on its resumed arm (its `probe-unmeasured`,
//     printed while its `expire:` breadcrumb stands);
//   - a breadcrumb that stands but cannot be read says nothing either way.
// FIXTURE HOMEs ONLY: every ccd call runs through the harness, never against $HOME.
````

<!-- replay: replace server/test/ccd-child-reclaim-crumb.test.ts -->
In `server/test/ccd-child-reclaim-crumb.test.ts`, find (block 2):

````ts
});

describe('ws-expire — its locked body is not edited', () => {
  it('pre-breadcrumb pin-failed carries NO crumb, even with one exported', () => {
    makeArchived(h);
    const tok = expireToken(h);
````

Replace with:

````ts
});

describe('ws-expire — its own documents say crumb too (workspace lifecycle wave 6, question (k))', () => {
  it('fresh arm, before the breadcrumb: pin-failed says crumb false, whatever value is exported', () => {
    makeArchived(h);
    const tok = expireToken(h);
````

<!-- replay: replace server/test/ccd-child-reclaim-crumb.test.ts -->
In `server/test/ccd-child-reclaim-crumb.test.ts`, find (block 3):

````ts
    try {
      out = h.sh(`${EXP_STUBS} ${PIN_FAILS} ${CHILD_ENV} cmd_ws_expire --expect ${tok} --session ${EXP_ID}`,
        { _WS_RCL_CRUMB: 'false' });
    } catch (e) { out = String((e as { stdout?: string }).stdout ?? ''); }
    expect(JSON.parse(out)).toEqual({ failed: 'pin-failed', detail: 'the disk is full' });
    expect(h.reg(EXP_ID, 'reaping')).toBeNull();
  }, 90_000);

  it('its own probe-unmeasured (printed by `_ws_reclaim_failed_json` directly) carries NO crumb', () => {
    makeArchived(h);
    const r = expireVerb(h, expireToken(h), { pre: STASH_FAILS });
    expect(r.code, r.stderr).toBe(1);
    const d = docOf(r);
    expect(d['failed']).toBe('probe-unmeasured');
    expect(d).not.toHaveProperty('crumb');
  }, 90_000);

````

Replace with:

````ts
    try {
      out = h.sh(`${EXP_STUBS} ${PIN_FAILS} ${CHILD_ENV} cmd_ws_expire --expect ${tok} --session ${EXP_ID}`,
        { _WS_RCL_CRUMB: 'true' });
    } catch (e) { out = String((e as { stdout?: string }).stdout ?? ''); }
    expect(JSON.parse(out)).toEqual({ failed: 'pin-failed', detail: 'the disk is full', crumb: false });
    expect(h.reg(EXP_ID, 'reaping'), 'no breadcrumb was written').toBeNull();
  }, 90_000);

  it('fresh arm: its own probe-unmeasured (printed by `_ws_reclaim_failed_json` directly) says crumb false', () => {
    makeArchived(h);
    const r = expireVerb(h, expireToken(h), { pre: STASH_FAILS });
    expect(r.code, r.stderr).toBe(1);
    expect(docOf(r)).toMatchObject({ failed: 'probe-unmeasured', crumb: false });
  }, 90_000);

  it('fresh arm: tombstone-unwritable, printed before the breadcrumb, says crumb false', () => {
    makeArchived(h);
    const r = expireVerb(h, expireToken(h), { pre: '_ws_tombstone() { :; };' });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(docOf(r)).toMatchObject({ failed: 'tombstone-unwritable', crumb: false });
    expect(h.reg(EXP_ID, 'reaping'), 'no breadcrumb was written').toBeNull();
  }, 90_000);

  it('resumed arm: probe-unmeasured over a standing `expire:` breadcrumb says crumb TRUE (the next attempt resumes)', () => {
    const a = makeArchived(h);
    // A previous expiry that died right after its pin phase wrote the tombstone and the breadcrumb.
    h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_eval ${EXP_ID} >/dev/null`
      + ` && _ws_reclaim_pin ${EXP_ID} "${a.wt}" "${a.main}" "$REAP_BRANCH" "$EXPIRE_ARCHIVED_AT"`
      + ` && _ws_tombstone ${EXP_ID} '[]' "$(_ws_reclaim_tomb_fields "$EXPIRE_ARCHIVED_AT" present)" >/dev/null`
      + ` && _reg_set ${EXP_ID} reaping expire:worktree`);
    const tomb = path.join(h.home, '.cc-sessions', '.reaped', `${EXP_ID}.json`);
    fs.chmodSync(tomb, 0o000);
    try {
      // Any well-formed token: the unmeasured verdict answers before a token is compared.
      const r = expireVerb(h, '0'.repeat(64));
      expect(r.code, r.stdout + r.stderr).toBe(1);
      expect(docOf(r)).toMatchObject({ failed: 'probe-unmeasured', crumb: true });
      expect(h.reg(EXP_ID, 'reaping'), 'the breadcrumb stands').toBe('expire:worktree');
    } finally { fs.chmodSync(tomb, 0o644); }
  }, 90_000);

  it('a breadcrumb that stands but cannot be read: probe-unmeasured carries NO crumb', () => {
    makeArchived(h);
    const tok = expireToken(h);
    fs.mkdirSync(path.join(h.home, '.cc-sessions', `${EXP_ID}.reaping`));
    const r = expireVerb(h, tok);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const d = docOf(r);
    expect(d['failed']).toBe('probe-unmeasured');
    expect(d, 'whether an act started is unknown, so nothing is said').not.toHaveProperty('crumb');
  }, 90_000);

````

<!-- replay: replace server/test/ccd-ws-expire-consent-branch.test.ts -->
In `server/test/ccd-ws-expire-consent-branch.test.ts`, find (block 4):

````ts
    const r = expireVerb(h, token, { pre: IN_THE_WINDOW(`git -C "$1" update-ref -d "refs/heads/$2" >/dev/null 2>&1`) });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(o.failed).toBe('state-changed');
    expect(fs.readFileSync(path.join(h.home, 'bs-reads'), 'utf8').trim(), 'the recompute read, then the pin, and nothing after').toBe('2');
    expect(o.detail).toMatch(new RegExp(`${EXP_BRANCH} read present when the token was checked inside the lock, but absent when the pin read it again`));
````

Replace with:

````ts
    const r = expireVerb(h, token, { pre: IN_THE_WINDOW(`git -C "$1" update-ref -d "refs/heads/$2" >/dev/null 2>&1`) });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string; crumb?: unknown };
    expect(o.failed).toBe('state-changed');
    // Printed before the breadcrumb, so it says crumb false (workspace lifecycle wave 6, question (k)).
    expect(o.crumb, 'printed before the breadcrumb: crumb false').toBe(false);
    expect(fs.readFileSync(path.join(h.home, 'bs-reads'), 'utf8').trim(), 'the recompute read, then the pin, and nothing after').toBe('2');
    expect(o.detail).toMatch(new RegExp(`${EXP_BRANCH} read present when the token was checked inside the lock, but absent when the pin read it again`));
````

- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-crumb.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-consent-branch.test.ts --maxWorkers=1 )
```

Measured: `ccd-child-reclaim-crumb.test.ts`: `4 failed | 9 passed (13)` — × fresh arm, before the breadcrumb: pin-failed says crumb false, whatever value is exported (`expected { failed: 'pin-failed', …(1) } to deeply equal { failed: 'pin-failed', …(2) }`); × fresh arm: its own probe-unmeasured … says crumb false; × fresh arm: tombstone-unwritable, printed before the breadcrumb, says crumb false; × resumed arm: probe-unmeasured over a standing `expire:` breadcrumb says crumb TRUE. Each prints today's keyless document. `ccd-ws-expire-consent-branch.test.ts`: `1 failed | 3 passed (4)` — × a branch DELETED between the in-lock recompute and the pin … (`printed before the breadcrumb: crumb false: expected undefined to be false`).

- [ ] **Step 3: The ccd edits, then the re-stamp.**

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find (block 5):

````bash
  _ws_expire_fork "$id"
  phase="$RECLAIM_RESUME_PHASE"; resumed="$phase"
  # The consent IS the fingerprint, recomputed HERE, inside the lock.
  if [[ "$REAP_VERDICT" == expirable && "$token" != "$REAP_TOKEN" ]]; then
````

Replace with:

````bash
  _ws_expire_fork "$id"
  phase="$RECLAIM_RESUME_PHASE"; resumed="$phase"
  # `crumb` (CCR-15 spec §5.6), said as ws-reclaim says it (workspace lifecycle
  # wave 6, question (k)): a resumed arm's breadcrumb already stands (`true`),
  # so its `probe-unmeasured` below is printed past it and the server reads it
  # resumable; a fresh arm's is not written yet (`false`: nothing started, so a
  # retry audits afresh) until the tail, which says `true` once it is; a
  # breadcrumb that stands but could not be read leaves it unsaid.
  if [[ -n "$phase" ]]; then _WS_RCL_CRUMB=true
  elif [[ -e "$REG/$id.reaping" || -L "$REG/$id.reaping" ]]; then _WS_RCL_CRUMB=''
  else _WS_RCL_CRUMB=false; fi
  # The consent IS the fingerprint, recomputed HERE, inside the lock.
  if [[ "$REAP_VERDICT" == expirable && "$token" != "$REAP_TOKEN" ]]; then
````

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find (block 6):

````bash
# stands now. The tail's `purge-*` failures print it after `_reg_purge` took
# the row and its `.reaping` file. '' prints NO key: a reader takes
# that absence as unmeasured, never as either value. Set by `_ws_reclaim_locked`
# and by the shared tail; `cmd_ws_collect` shadows it to '' with `local` (a
# collection has no breadcrumb). So `ws-expire`'s own pre-breadcrumb documents,
# its resumed arm's `probe-unmeasured` (printed while its `expire:` breadcrumb
# stands), and every `ws-collect` document, carry no key. Assigned here, when
# ccd is read, so an exported value can never reach a document.
_WS_RCL_CRUMB=''
_ws_reclaim_failed_json() {   # token detail -> the post-start failure document on stdout, with
````

Replace with:

````bash
# stands now. The tail's `purge-*` failures print it after `_reg_purge` took
# the row and its `.reaping` file. '' prints NO key: a reader takes
# that absence as unmeasured, never as either value. Set by `_ws_reclaim_locked`,
# by `_ws_expire_locked` (workspace lifecycle wave 6) and by the shared tail;
# `cmd_ws_collect` shadows it to '' with `local` (a collection has no
# breadcrumb). So a breadcrumb that stands but cannot be read, and every
# `ws-collect` document, carry no key. Assigned here, when ccd is read, so an
# exported value can never reach a document.
_WS_RCL_CRUMB=''
_ws_reclaim_failed_json() {   # token detail -> the post-start failure document on stdout, with
````

```bash
~/.local/bin/ccrc restamp ccd/ccd && bash -n ccd/ccd
```

- [ ] **Step 4: Run — green, and every suite the verb's region feeds.** Measured: `ccd-child-reclaim-crumb` `13 passed (13)`; `ccd-ws-expire-consent-branch` `4 passed (4)`; `ccd-expire-tail-refuted` `13 passed (13)`; `ccd-ws-expire-reach` `3 passed (3)`; `ccd-refusal-scan` `14 passed (14)`; `verb-gate` `12 passed (12)`; `archived-expiry-policy` `68 passed (68)`; `ccd-ws-expire-verb` `32 passed (32)`; `ccd-ws-expire-return-race` `8 passed (8)`; `ccd-ws-expire-ladder` `55 passed (55)`; `ccd-ws-expire-audit` `20 passed (20)`; `ccd-ws-expire-spawn` `17 passed (17)`; `ccd-child-reclaim-leaf-moved-expire` `3 passed (3)`; `ccd-child-reclaim-leaf-moved-resume` `6 passed (6)`; `ccd-child-reclaim-done-kept` `8 passed (8)`; `ccd-child-reclaim-tail-contained` `9 passed (9)`; `ccd-child-reclaim-tmproot-wait` `28 passed (28)`; `ccd-leaf-remove` `43 passed (43)`; `ccd-child-reclaim-leaf-moved` `8 passed (8)`; `ccd-lifecycle-emit` `59 passed (59)` — every suite that composes `ws-expire`.

- [ ] **Step 5: The citation tax — none.** `ccd-reg-get-census` and the five citation cases green (Measured while planning item 7).

- [ ] **Step 6: The mutation rows.** Each row edits the line INSIDE `_ws_expire_locked` (each of the first three lines also stands in `_ws_reclaim_locked`, above it, and T1.4's in `_ws_reclaim_locked` too: find `_ws_expire_locked() {` first). Re-stamp after each mutation and after each restore.

| Row | Mutation | Red |
|---|---|---|
| T1.1 | `  if [[ -n "$phase" ]]; then _WS_RCL_CRUMB=true` → `  if [[ -n "$phase" ]]; then _WS_RCL_CRUMB=''` (`main`'s keyless resumed arm) | `ccd-child-reclaim-crumb.test.ts`: `1 failed \| 12 passed (13)` — resumed arm: probe-unmeasured … says crumb TRUE |
| T1.2 | `  else _WS_RCL_CRUMB=false; fi` → `  else _WS_RCL_CRUMB=''; fi` | the same file: `3 failed \| 10 passed (13)` — the fresh arm's pin-failed, probe-unmeasured and tombstone-unwritable; `ccd-ws-expire-consent-branch.test.ts`: `1 failed \| 3 passed (4)` — the DELETED case's `state-changed` |
| T1.3 | `  elif [[ -e "$REG/$id.reaping" \|\| -L "$REG/$id.reaping" ]]; then` → `  elif false; then` | the same file: `1 failed \| 12 passed (13)` — a breadcrumb that stands but cannot be read: probe-unmeasured carries NO crumb |
| T1.4 | inside `_ws_expire_locked`, `      _ws_reclaim_fail "$id" "$lctx" state-changed \` → `      _WS_RCL_CRUMB=''; _ws_reclaim_fail "$id" "$lctx" state-changed \` (the consent check's producer alone keyless) | `ccd-ws-expire-consent-branch.test.ts`: `1 failed \| 3 passed (4)` — the DELETED case (`expected undefined to be false`); `ccd-child-reclaim-crumb.test.ts` stays `13 passed (13)`, which is why the case is owed |

- [ ] **Step 7: Commit.** `feat(ccd): ws-expire says crumb on its own failed documents — false before its breadcrumb, true on its resumed arm (wave 6, question (k))`.

---

### Task 2: `parseExpireResult` reads the word, then `crumb` (ruling A)

**Model routing:** `sonnet`, effort `high` — the reading that decides a retry.

**Files:** `server/src/archivedExpiry.ts` (`parseExpireResult`, the `EXPIRE_PRE_CRUMB_FAILED` docstring, `ExpireVerbRead.restart`'s and `ArchivedExpiryOutcome.restart`'s docstrings), `server/src/coord/expireArchived.ts` (the `restart` feed row); tests `server/test/archived-expiry-policy.test.ts`, `server/test/archived-expiry-lane.test.ts`.

**Interfaces:** in `parseExpireResult`'s `failed` arm, after `said`: `v.crumb === false` → `{ kind: 'restart', detail: said }` (audits afresh, wave 5's meaning); `v.crumb === true` → `{ kind: 'failed', resumable: true, detail: said }`; anything else (absent, a string, a number, `null`) falls through to `main`'s word rule unchanged (`EXPIRE_PRE_CRUMB_FAILED`). Task 3 adds the stuck word ABOVE these two lines (R76's order: the word first). The `restart` feed row no longer names one cause — a fresh `pin-failed` with `crumb:false` is a restart too — so its title is `archived workspace cleanup stopped before it began` and its body "ccd stopped before this attempt started anything (<detail>) — nothing was deleted, and the lane audits it afresh." (the departure `the-restart-row-names-no-cause`).

**The fresh pin (ruling D's "(resumable)") — read with (A).** `crumb:false` applies to every word, so a fresh `pin-failed` (with HEAD symbolic to `ws/<slug>`, the branch deleted in the window — Task 5's control) now reads `restart`, where `main` read it resumable. Both end in a fresh audit before any act; the restart is the truer one (nothing started) and is counted (Task 4). An older ccd's keyless document still reads resumable. This plan follows (A) here, as the narrower ruling on parsing (the departure `a-fresh-pin-failure-audits-afresh`; question (l)): Task 5's case pins D's ccd half — the act ends at the PIN as `pin-failed`, never `state-changed` — and A's server half. **(l) is ruled: audited afresh** (the coordinator, 2026-10-11; see the rulings at the end). Task 2 gains no arm.

- [ ] **Step 1: The tests (red).** A policy case over every `crumb` value, and two lane cases: a resumed `probe-unmeasured` (`crumb:true`) is retried and listed past the hour, never final; a fresh `pin-failed` (`crumb:false`) goes back to learning. The wave-5 lane case's feed-row pin follows the new words.

<!-- replay: replace server/test/archived-expiry-lane.test.ts -->
In `server/test/archived-expiry-lane.test.ts`, find (block 7):

````ts
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.expiryAttention ?? [], 'nothing was deleted: nothing is listed').toEqual([]);
    expect(f.coord.feedEvents(5).find((e) => e.title === 'archived workspace changed under its cleanup')?.body)
      .toContain('its branch was deleted or made inside the lock (state-changed: ws/demo-a read present');
    const audits = f.verbsFor('ws-audit').length;
    f.next(); await f.pass();
````

Replace with:

````ts
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.expiryAttention ?? [], 'nothing was deleted: nothing is listed').toEqual([]);
    expect(f.coord.feedEvents(5).find((e) => e.title === 'archived workspace cleanup stopped before it began')?.body)
      .toContain('ccd stopped before this attempt started anything (state-changed: ws/demo-a read present');
    const audits = f.verbsFor('ws-audit').length;
    f.next(); await f.pass();
````

<!-- replay: replace server/test/archived-expiry-lane.test.ts -->
In `server/test/archived-expiry-lane.test.ts`, find (block 8):

````ts
    expect(f.verbsFor('ws-audit'), 'the act audited first').toHaveLength(audits + 2);
    expect(f.entry('demo-a'), 'and finished').toBeUndefined();
  });
});
````

Replace with:

````ts
    expect(f.verbsFor('ws-audit'), 'the act audited first').toHaveLength(audits + 2);
    expect(f.entry('demo-a'), 'and finished').toBeUndefined();
  });
});

describe('`crumb` decides a failed document (wave 6, question (k))', () => {
  it('a RESUMED expiry’s probe-unmeasured (crumb true) is retried on the backoff and listed past the hour — never stopped for good', async () => {
    const f = await fixture({ expire: () => ({ code: 1, stdout: JSON.stringify({ failed: 'probe-unmeasured',
      detail: 'whether cc-demo-a is up could not be asked — tmux answered: nothing', crumb: true }), stderr: '' }) });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await threePasses(f);
    expect(f.verbsFor('ws-expire')).toEqual(['demo-a']);
    expect(f.entry('demo-a')?.report, 'retried, so not listed at once').toBeNull();
    for (let k = 0; k < 70; k += 1) { f.next(); await f.pass(); }   // well past the one-hour ceiling
    expect(f.verbsFor('ws-expire').length, 'asked again, backing off').toBeGreaterThan(1);
    expect(f.entry('demo-a')?.report).toMatchObject({ kind: 'failing' });
    expect(f.entry('demo-a')?.report, 'still asked: never a final report').not.toHaveProperty('final');
  });

  it('a FRESH expiry’s pin-failed (crumb false) is audited afresh — nothing was deleted, nothing is listed', async () => {
    let n = 0;
    const f = await fixture({ expire: (id) => (n += 1) === 1
      ? { code: 1, stdout: JSON.stringify({ failed: 'pin-failed', detail: 'the disk is full', crumb: false }), stderr: '' }
      : { code: 0, stdout: JSON.stringify({ expired: id, archivedAt: OLD, wip: null, attic: 2, residueBytes: 0, secretsDropped: 0, clipsKept: null, tmpRootKept: null }), stderr: '' } });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await threePasses(f);
    expect(f.verbsFor('ws-expire')).toEqual(['demo-a']);
    expect(f.entry('demo-a'), 'back to learning').toMatchObject({ expiresAt: null, eligibleSince: null, report: null });
    expect(f.coord.feedEvents(5).find((e) => e.title === 'archived workspace cleanup stopped before it began')?.body)
      .toContain('ccd stopped before this attempt started anything (pin-failed: the disk is full)');
  });
});
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 9):

````ts
      .toEqual({ kind: 'failed', resumable: true, detail: 'tombstone-unwritable: x' });
    expect([...EXPIRE_PRE_CRUMB_FAILED].sort()).toEqual(['probe-unmeasured', 'state-changed']);
  });

````

Replace with:

````ts
      .toEqual({ kind: 'failed', resumable: true, detail: 'tombstone-unwritable: x' });
    expect([...EXPIRE_PRE_CRUMB_FAILED].sort()).toEqual(['probe-unmeasured', 'state-changed']);
  });

  it('reads the WORD, then `crumb`: false audits afresh, true resumes — an absent or non-boolean crumb is main’s word rule exactly (wave 6, question (k))', () => {
    const doc = (failed: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ failed, detail: 'x', ...extra });
    // `false`: printed before this attempt's breadcrumb, so nothing it started stands — the lane audits afresh.
    for (const w of ['probe-unmeasured', 'pin-failed', 'state-changed', 'tombstone-unwritable']) {
      expect(parseExpireResult(ID, doc(w, { crumb: false }), ''), w).toEqual({ kind: 'restart', detail: `${w}: x` });
    }
    // `true`: printed past a breadcrumb — the resumed arm's probe-unmeasured among them — so the next attempt resumes it.
    for (const w of ['probe-unmeasured', 'pin-failed', 'worktree-remove-failed']) {
      expect(parseExpireResult(ID, doc(w, { crumb: true }), ''), w).toEqual({ kind: 'failed', resumable: true, detail: `${w}: x` });
    }
    // Absent (an older ccd) or not a boolean: the word rule `main` reads, exactly — agent-first skew changes nothing.
    for (const extra of [{}, { crumb: 'true' }, { crumb: 'false' }, { crumb: 1 }, { crumb: 0 }, { crumb: null }]) {
      const why = JSON.stringify(extra);
      expect(parseExpireResult(ID, doc('state-changed', extra), ''), why).toEqual({ kind: 'restart', detail: 'state-changed: x' });
      expect(parseExpireResult(ID, doc('probe-unmeasured', extra), ''), why)
        .toEqual({ kind: 'failed', resumable: false, detail: 'probe-unmeasured: x' });
      expect(parseExpireResult(ID, doc('pin-failed', extra), ''), why).toEqual({ kind: 'failed', resumable: true, detail: 'pin-failed: x' });
    }
  });

````

- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-lane.test.ts --maxWorkers=1 )
```

Measured: `archived-expiry-policy.test.ts`: `1 failed | 68 passed (69)` — × reads the WORD, then `crumb` … (`probe-unmeasured: expected { kind: 'failed', …(2) } to deeply equal { kind: 'restart', …(1) }`); `archived-expiry-lane.test.ts`: `3 failed | 33 passed (36)` — × the lane forgets what it learned … the feed row says why (the old title); × a RESUMED expiry’s probe-unmeasured (crumb true) … never stopped for good (`retried, so not listed at once: expected { kind: 'failing', …(3) } to be null`); × a FRESH expiry’s pin-failed (crumb false) is audited afresh ….

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 10):

````ts

/** The ws-expire `{"failed":…}` words that ccd prints before THIS attempt's tombstone and breadcrumb — so this attempt
 *  started nothing, and neither is retried from where it stopped (the reclaim side's twin is CCR-15's 4457). Each is
 *  READ its own way (`parseExpireResult`):
 *   - `probe-unmeasured`: `_ws_expire_locked`'s unmeasured verdict, printed at its verdict point, before any intent —
 *     on EVERY arm. Read FINAL: reported at once and not asked again for this archive (review 313's parked item 4).
 *     On a fresh expiry nothing stands. On a RESUMED one an earlier attempt's breadcrumb stands and its tree may be
 *     part-deleted (`_ws_expire_resume_eval`'s unmeasured exits: a tombstone it cannot read, or a tmux probe that did
 *     not answer), and the word reads final there too. That is main's reading, kept in this wave: the fix is this
 *     programme's wave 6, once CCR-15 wave 7 is on main — `_ws_expire_locked` sets wave 7's `crumb` on its resumed
 *     arm, and a failed document with `crumb: true` reads resumable — and until then it is an ARMING BLOCKER for the
 *     expiry lane;
 *   - `state-changed`: the consent binding — the in-lock recompute and the pin read the branch differently — printed
 *     on the FRESH arm only, after the pin (which only keeps) and before the tombstone and the breadcrumb (workspace
````

Replace with:

````ts

/** The ws-expire `{"failed":…}` words that ccd prints before THIS attempt's tombstone and breadcrumb — so this attempt
 *  started nothing, and neither is retried from where it stopped (the reclaim side's twin is CCR-15's 4457). Since
 *  wave 6 this is the FALLBACK: a document that carries `crumb` is read by it (`parseExpireResult`), and these words
 *  decide only a document without it — an older ccd's. Each is READ its own way there:
 *   - `probe-unmeasured`: `_ws_expire_locked`'s unmeasured verdict, printed at its verdict point, before any intent —
 *     on EVERY arm. Read FINAL: reported at once and not asked again for this archive (review 313's parked item 4).
 *     On a fresh expiry nothing stands. On a RESUMED one an earlier attempt's breadcrumb stands and its tree may be
 *     part-deleted (`_ws_expire_resume_eval`'s unmeasured exits: a tombstone it cannot read, or a tmux probe that did
 *     not answer), and an older ccd's word reads final there too. A current ccd says `crumb` on both arms (wave 6,
 *     question (k)): `false` on the fresh one, read as a fresh audit, and `true` on the resumed one, read resumable;
 *   - `state-changed`: the consent binding — the in-lock recompute and the pin read the branch differently — printed
 *     on the FRESH arm only, after the pin (which only keeps) and before the tombstone and the breadcrumb (workspace
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 11):

````ts
 *  function and its shape, and holds the expiry's `failed` `state-changed` on its fresh arm, before the breadcrumb.
 *  `pin-failed` and `tombstone-unwritable` are NOT here: the shared tail prints each after the breadcrumb (eight and
 *  five producers), so the word alone cannot say nothing started — they stay resumable until that `crumb` field. */
export const EXPIRE_PRE_CRUMB_FAILED = ['probe-unmeasured', 'state-changed'] as const;

````

Replace with:

````ts
 *  function and its shape, and holds the expiry's `failed` `state-changed` on its fresh arm, before the breadcrumb.
 *  `pin-failed` and `tombstone-unwritable` are NOT here: the shared tail prints each after the breadcrumb (eight and
 *  five producers), so the word alone cannot say nothing started — without `crumb` they stay resumable. */
export const EXPIRE_PRE_CRUMB_FAILED = ['probe-unmeasured', 'state-changed'] as const;

````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 12):

````ts
  | { readonly kind: 'failed'; readonly resumable: boolean; readonly detail: string }
  /** A `failed` document the lane must START OVER from (wave 5, the coordinator's ruling on question (h)): ccd printed
   *  it before anything started, and what it consented to has changed, so neither a retry of this attempt nor a final
   *  report is the truth — a fresh audit of what stands is (`state-changed`, `EXPIRE_PRE_CRUMB_FAILED`). */
  | { readonly kind: 'restart'; readonly detail: string }
  | { readonly kind: 'box'; readonly word: ExpireBoxWord; readonly detail: string }
````

Replace with:

````ts
  | { readonly kind: 'failed'; readonly resumable: boolean; readonly detail: string }
  /** A `failed` document the lane must START OVER from (wave 5, the coordinator's ruling on question (h)): ccd printed
   *  it before this attempt's breadcrumb, so nothing it started stands, and neither a retry of this attempt nor a final
   *  report is the truth — a fresh audit of what stands is. Any failed document with `crumb: false` (wave 6), or, from
   *  an older ccd that prints no `crumb`, a `state-changed` (`EXPIRE_PRE_CRUMB_FAILED`). */
  | { readonly kind: 'restart'; readonly detail: string }
  | { readonly kind: 'box'; readonly word: ExpireBoxWord; readonly detail: string }
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 13):

````ts
      const detail = typeof v.detail === 'string' ? v.detail : '';
      const said = detail === '' ? v.failed : `${v.failed}: ${detail}`;
      if (!isExpirePreCrumbFailed(v.failed)) return { kind: 'failed', resumable: true, detail: said };
      // Printed before this attempt's tombstone and breadcrumb: `state-changed` starts over, `probe-unmeasured` is final.
````

Replace with:

````ts
      const detail = typeof v.detail === 'string' ? v.detail : '';
      const said = detail === '' ? v.failed : `${v.failed}: ${detail}`;
      // `crumb` (CCR-15 spec §5.6; its R76 order, workspace lifecycle wave 6, question (k)): `false` — printed before this
      // attempt's breadcrumb, so nothing it started stands — audits afresh, whatever the word; `true` — printed past a
      // breadcrumb, the resumed arm's `probe-unmeasured` among them — is resumed. Only the two booleans are read: an
      // absent key (an older ccd) or any other value falls back to the word rule below, exactly as `main` reads it.
      if (v.crumb === false) return { kind: 'restart', detail: said };
      if (v.crumb === true) return { kind: 'failed', resumable: true, detail: said };
      if (!isExpirePreCrumbFailed(v.failed)) return { kind: 'failed', resumable: true, detail: said };
      // Printed before this attempt's tombstone and breadcrumb: `state-changed` starts over, `probe-unmeasured` is final.
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 14):

````ts
   *  stopped part-way, so only it may move a row onto the persistent tier. Two conditions, two values at this seam. */
  | { readonly kind: 'audit-failed'; readonly detail: string }
  /** ccd stopped before anything started because what the expiry consented to changed (`ExpireVerbRead.restart`):
   *  the lane forgets what it learned of the row and audits it afresh (wave 5). */
  | { readonly kind: 'restart'; readonly detail: string }
  | { readonly kind: 'box'; readonly word: ExpireBoxWord; readonly detail: string }
````

Replace with:

````ts
   *  stopped part-way, so only it may move a row onto the persistent tier. Two conditions, two values at this seam. */
  | { readonly kind: 'audit-failed'; readonly detail: string }
  /** ccd stopped before this attempt started anything (`ExpireVerbRead.restart`): the lane forgets what it learned of
   *  the row and audits it afresh (wave 5; since wave 6 any failed document with `crumb: false`). */
  | { readonly kind: 'restart'; readonly detail: string }
  | { readonly kind: 'box'; readonly word: ExpireBoxWord; readonly detail: string }
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find (block 15):

````ts
  failed: 'archived workspace cleanup failed',
  'audit-failed': 'archived workspace cleanup failed',
  restart: 'archived workspace changed under its cleanup',
  box: 'archived workspace cleanup failed',
  composition: 'archived workspace cleanup failed',
````

Replace with:

````ts
  failed: 'archived workspace cleanup failed',
  'audit-failed': 'archived workspace cleanup failed',
  restart: 'archived workspace cleanup stopped before it began',
  box: 'archived workspace cleanup failed',
  composition: 'archived workspace cleanup failed',
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find (block 16):

````ts
    case 'audit-failed': return `${who}: its expiry's own audit could not be read (${r.detail}), so no verb ran. `
      + 'It is retried, backing off in between.';
    case 'restart': return `${who}: the workspace changed under the expiry's consent — its branch was deleted or made `
      + `inside the lock (${r.detail}) — so nothing was deleted, and the lane audits it afresh.`;
    case 'box': return `${who}: the fleet box refused before it started (${r.word}) — ${r.detail}.`;
    case 'composition': return `${who}: ccd rejected the call this server composed — ${r.detail}. It is not retried.`;
````

Replace with:

````ts
    case 'audit-failed': return `${who}: its expiry's own audit could not be read (${r.detail}), so no verb ran. `
      + 'It is retried, backing off in between.';
    // ccd said it stopped before this attempt's breadcrumb (`crumb: false`, or an older ccd's `state-changed`): never a
    // sentence about one cause, since a fresh pin's failure says the same (wave 6).
    case 'restart': return `${who}: ccd stopped before this attempt started anything (${r.detail}) — nothing was deleted, `
      + 'and the lane audits it afresh.';
    case 'box': return `${who}: the fleet box refused before it started (${r.word}) — ${r.detail}.`;
    case 'composition': return `${who}: ccd rejected the call this server composed — ${r.detail}. It is not retried.`;
````

- [ ] **Step 4: Run — green.** Measured: `archived-expiry-policy` `69 passed (69)`; `archived-expiry-lane` `36 passed (36)`; `expire-archived` `21 passed (21)`; `containment-refuted-word` `6 passed (6)`.

- [ ] **Step 5: The mutation rows.**

| Row | Mutation (`server/src/archivedExpiry.ts`) | Red |
|---|---|---|
| T2.1 | `      if (v.crumb === false) return { kind: 'restart', detail: said };` → `      if (false) return { kind: 'restart', detail: said };` | policy `1 failed \| 68 passed (69)` (reads the WORD, then `crumb` …); lane `1 failed \| 35 passed (36)` (a FRESH expiry’s pin-failed …) |
| T2.2 | `      if (v.crumb === true) return { kind: 'failed', resumable: true, detail: said };` → `      if (false) return { kind: 'failed', resumable: true, detail: said };` | policy `1 failed \| 68 passed (69)`; lane `1 failed \| 35 passed (36)` (a RESUMED expiry’s probe-unmeasured …) |
| T2.3 | `      if (v.crumb === true) return` → `      if (v.crumb) return` (a truthy non-boolean read as `true`) | policy `1 failed \| 68 passed (69)` (`{"crumb":"true"}: expected { kind: 'failed', …(2) } to deeply equal { kind: 'restart', …(1) }`) |
| T2.4 | `      if (v.crumb === false) return` → `      if (!v.crumb) return` (an absent key read as `false`) | policy `3 failed \| 66 passed (69)` — the three documents …; a `failed` state-changed is printed before the breadcrumb …; reads the WORD, then `crumb` … |

- [ ] **Step 6: Commit.** `fix(lifecycle): the expiry parser reads crumb — false audits afresh, true resumes, absent is main's word rule (wave 6, question (k))`.

---

### Task 3: `containment-refuted` is STUCK on the expiry lane (ruling B)

**Model routing:** `sonnet`, effort `high` — a new standing report and its precedence; the act-safety review checks no arm reaches +∞.

**Files:** `server/src/archivedExpiry.ts`, `server/src/coord/expireArchived.ts`; tests `server/test/containment-refuted-word.test.ts`, `server/test/archived-expiry-policy.test.ts`, `server/test/archived-expiry-lane.test.ts`, `server/test/expire-archived.test.ts`.

**Interfaces:**
- `export const EXPIRE_STUCK_WORD: Extract<LcRefusalToken, 'containment-refuted'>` (the word, typed by its L0 member; `LcRefusalToken` joins the L0 import).
- `ExpireVerbRead` and `ArchivedExpiryOutcome` gain `{ kind: 'stuck'; detail }`; `parseExpireResult` reads `v.failed === EXPIRE_STUCK_WORD` FIRST, whatever `crumb` says (R76's order); the executor passes it through; `EXPIRY_OUTCOME_KINDS` admits `stuck` (the kebab scan); the feed title `archived workspace cleanup stuck`, and its body "ccd stopped part-way (<detail>) — the session was stopped and nothing further was deleted. It is listed at once, and asked again 4 hours after each failed attempt, until an attempt completes or the workspace is archived again." — the cadence in the standing entry's own terms (Task 8's `STANDING_ASKS_AGAIN`), derived from `EXPIRE_PERSISTENT_RETRY_MS`, never "every four hours".
- `ExpiryReport` gains `{ kind: 'stuck'; at; detail; attempts }`, and `expiryReportStands` holds it STANDING (so `standingThrough` keeps it through every answer that ends no attempt, and a hold never replaces it).
- `archivedExpiryNextEntry`'s `stuck` arm: both runs counted, `nextAskAt = now + EXPIRE_PERSISTENT_RETRY_MS` (never +∞), the report's `at` the first stuck answer and `attempts` + 1. A later resumable failure or box word under a stuck entry keeps the entry and the four-hour cadence (it outranks failing; `flock-unavailable` too, once Task 8 adds its arm); a `restart` keeps it too, with its instant and cadence (the departure `stuck-stands-through-a-restart`). An attempt that completes ends it (the kept report replaces it, if a leaf was kept), and so does a new archive; a terminal refusal, a failure ccd says will not resume and a composition error still replace it (the departure `a-terminal-verdict-outranks-stuck`; CCR-15's R77: terminal outranks stuck).
- On the wire a stuck entry is `kind: 'failing'` (`expiryAttention` maps it): no new word, no `shared/api.ts` or PWA edit (the departure `a-stuck-expiry-rides-the-failing-word`).
- The sentence: "cleanup stopped part-way: <detail>. ccd found that what it would remove is not only this workspace’s own (first at <instant>, <n> attempts). The session was stopped and nothing further was deleted; what is left on disk stays as it is, and a retry finds the same thing until that other tree or row is moved. The lane asks again …" (Task 8 replaces the cadence clause's words).
- **`containment-refuted-word.test.ts` (the coordinator's proposal to CCR-15, mail 4200, AGREED in mail 4202):** the `parseExpireResult` case LEAVES the shared describe "today’s parsers read it as a resumable failure — retried" — which CCR-15 wave 8's Task 6 retitles, flipping only its reclaim assertion — and a describe of its own at the file's foot flips it: `stuck`, for four `crumb` values. The header's last two sentences say which parser classes it.

- [ ] **Step 1: The tests (red).**

<!-- replay: replace server/test/archived-expiry-lane.test.ts -->
In `server/test/archived-expiry-lane.test.ts`, find (block 17):

````ts
import {
  EXPIRE_AUDITS_PER_PASS, EXPIRE_FAILURE_CEILING_MS, EXPIRE_IN_USE_ATTENTION_PASSES, EXPIRE_LANE_LIVE_MARKER, EXPIRE_NO_EVIDENCE_RETRY_MS,
} from '../src/archivedExpiry.js';
import { NotifyLog } from '../src/notifylog.js';
````

Replace with:

````ts
import {
  EXPIRE_AUDITS_PER_PASS, EXPIRE_FAILURE_CEILING_MS, EXPIRE_IN_USE_ATTENTION_PASSES, EXPIRE_LANE_LIVE_MARKER, EXPIRE_NO_EVIDENCE_RETRY_MS,
  EXPIRE_PERSISTENT_RETRY_MS,
} from '../src/archivedExpiry.js';
import { NotifyLog } from '../src/notifylog.js';
````

<!-- replay: replace server/test/archived-expiry-lane.test.ts -->
In `server/test/archived-expiry-lane.test.ts`, find (block 18):

````ts
    expect(f.coord.feedEvents(5).find((e) => e.title === 'archived workspace cleanup stopped before it began')?.body)
      .toContain('ccd stopped before this attempt started anything (pin-failed: the disk is full)');
  });
});
````

Replace with:

````ts
    expect(f.coord.feedEvents(5).find((e) => e.title === 'archived workspace cleanup stopped before it began')?.body)
      .toContain('ccd stopped before this attempt started anything (pin-failed: the disk is full)');
  });
});

describe('containment-refuted is STUCK (wave 6, ruling B)', () => {
  it('listed AT ONCE, asked again every four hours, never stopping, one feed row — and an attempt that completes ends it', async () => {
    let stuck = true;
    const f = await fixture({ expire: (id) => stuck
      ? { code: 1, stdout: JSON.stringify({ failed: 'containment-refuted', detail: 'demo-other’s registry row lies inside /w/demo-a', crumb: true }), stderr: '' }
      : { code: 0, stdout: JSON.stringify({ expired: id, archivedAt: OLD, wip: null, attic: 2, residueBytes: 0, secretsDropped: 0, clipsKept: null, tmpRootKept: null }), stderr: '' } });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await threePasses(f);
    expect(f.verbsFor('ws-expire')).toEqual(['demo-a']);
    await f.watcher.tick();
    const list = f.watcher.currentCoord()?.expiryAttention ?? [];
    expect(list.map((a) => [a.sessionId, a.kind]), 'at once — never after the hour or the day').toEqual([['demo-a', 'failing']]);
    expect(list[0]!.sentence).toContain('cleanup stopped part-way: containment-refuted: demo-other’s registry row lies inside /w/demo-a.');
    f.advance(EXPIRE_PERSISTENT_RETRY_MS - 2 * CHILD_RECLAIM_SWEEP_MS); f.next(); await f.pass();
    expect(f.verbsFor('ws-expire'), 'not before four hours').toEqual(['demo-a']);
    f.advance(2 * CHILD_RECLAIM_SWEEP_MS); f.next(); await f.pass();
    expect(f.verbsFor('ws-expire'), 'then asked again').toEqual(['demo-a', 'demo-a']);
    f.advance(EXPIRE_PERSISTENT_RETRY_MS); f.next(); await f.pass();
    expect(f.verbsFor('ws-expire'), 'and again, never stopping').toHaveLength(3);
    expect(f.feed().filter(([, t]) => t === 'archived workspace cleanup stuck'), 'one feed row, not one per ask').toHaveLength(1);
    stuck = false;
    f.advance(EXPIRE_PERSISTENT_RETRY_MS); f.next(); await f.pass();
    expect(f.verbsFor('ws-expire')).toHaveLength(4);
    expect(f.entry('demo-a'), 'the attempt completed: finished with').toBeUndefined();
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.expiryAttention ?? []).toEqual([]);
  });
});
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 19):

````ts
  });

  it('a failure the box says will NOT resume stops at once: reported, never asked again for this archive (review 313, parked item 4)', () => {
    // `ExpireVerbRead.failed.resumable` is carried through the outcome, never narrowed: a wrong-row `expired`, a word
````

Replace with:

````ts
  });

  it('containment-refuted is STUCK: listed AT ONCE, on the persistent tier from its first answer, never +∞ (wave 6, ruling B)', () => {
    const stuck = { kind: 'stuck', detail: 'containment-refuted: demo-other’s registry row lies inside /w/demo-quiet-dune' } as const;
    const x = archivedExpiryNextEntry(e(), stuck, NOW, PASS)!;
    expect(x.nextAskAt, 'the persistent tier at once: four hours, never +∞').toBe(NOW + EXPIRE_PERSISTENT_RETRY_MS);
    expect(x.report).toEqual({ kind: 'stuck', at: NOW, detail: stuck.detail, attempts: 1 });
    const sentence = expiryReportSentence(x.report!, null);
    expect(sentence).toContain(`cleanup stopped part-way: ${stuck.detail}.`);
    expect(sentence).toContain('The session was stopped and nothing further was deleted');
    expect(sentence, 'it never suggests a destructive verb').not.toMatch(/ws-reap|ws-rm|ws-expire|delete it|remove it/);
    expect(expiryAttention(new Map([[ID, x]])).map((a) => [a.kind, a.at]), 'on the wire: a failing entry, at once').toEqual([['failing', NOW]]);
    const again = archivedExpiryNextEntry(x, stuck, x.nextAskAt, PASS)!;
    expect(again.report, 'a later stuck answer keeps the first instant and counts the attempt')
      .toEqual({ kind: 'stuck', at: NOW, detail: stuck.detail, attempts: 2 });
    expect(again.nextAskAt).toBe(x.nextAskAt + EXPIRE_PERSISTENT_RETRY_MS);
  });

  it('a STUCK entry outranks a failing one and stands until an attempt completes or the archive changes — a terminal verdict still outranks it (wave 6, ruling B)', () => {
    const stuck = { kind: 'stuck', detail: 'containment-refuted: d' } as const;
    const { x: tier, t } = aDayOf(verbFailed);
    const x = archivedExpiryNextEntry(tier, stuck, t, PASS)!;
    expect(x.report, 'it takes the place of the tier’s failing entry').toEqual({ kind: 'stuck', at: t, detail: stuck.detail, attempts: 1 });
    const failed = archivedExpiryNextEntry(x, verbFailed, t + PASS, PASS)!;
    expect(failed.report, 'a later resumable failure does not replace it').toEqual(x.report);
    expect(failed.nextAskAt, 'and keeps its cadence').toBe(t + PASS + EXPIRE_PERSISTENT_RETRY_MS);
    const box = archivedExpiryNextEntry(x, { kind: 'box', word: 'lock-unopenable', detail: 'cannot open the reap lock at /r' }, t + PASS, PASS)!;
    expect(box.report, 'nor does a box word').toEqual(x.report);
    const restart = archivedExpiryNextEntry(x, { kind: 'restart', detail: 'pin-failed: x' }, t + PASS, PASS)!;
    expect(restart.report, 'nor a restart').toEqual(x.report);
    expect(restart.nextAskAt, 'which keeps the cadence too').toBe(t + PASS + EXPIRE_PERSISTENT_RETRY_MS);
    for (const [what, o] of [...TIER_ANSWERS, ['an audit failure', { kind: 'audit-failed', detail: 'unreadable' }]] as const) {
      expect(archivedExpiryNextEntry(x, o, t + PASS, PASS)!.report, what).toEqual(x.report);
    }
    expect(archivedExpirySighted(x, { eligible: false, why: 'held' }, 'on hold', t + PASS).report, 'a hold').toEqual(x.report);
    expect(archivedExpiryNextEntry(x, { kind: 'expired', kept: { clips: null, tmpRoot: null } }, t + PASS, PASS), 'completed').toBeNull();
    expect(archivedExpiryNextEntry(x, { kind: 'expired', kept: { clips: 'in-use', tmpRoot: null } }, t + PASS, PASS)!.report, 'completed, kept')
      .toMatchObject({ kind: 'kept' });
    expect(archivedExpiryEntryFor(x, x.archivedAt + 60).report, 'a new archive').toBeNull();
    expect(archivedExpiryNextEntry(x, { kind: 'refused', token: 'containment-unproven', detail: 'd', inUse: [] }, t + PASS, PASS)!.report,
      'a terminal refusal (CCR-15’s R77: terminal outranks stuck)').toMatchObject({ kind: 'refused' });
  });

  it('a failure the box says will NOT resume stops at once: reported, never asked again for this archive (review 313, parked item 4)', () => {
    // `ExpireVerbRead.failed.resumable` is carried through the outcome, never narrowed: a wrong-row `expired`, a word
````

<!-- replay: replace server/test/containment-refuted-word.test.ts -->
In `server/test/containment-refuted-word.test.ts`, find (block 20):

````ts
// with its ccd emission (`_ws_reclaim_tail`'s literal `_ws_reclaim_fail …
// containment-refuted`). Its sentence says only what is true under any server.
// Until a server classes it, both parsers read it as the resumable failure it
// is, so it is retried. Wave 8's `stuck` class changes the parser pins below on
// purpose.
import { describe, it, expect } from 'vitest';
import { LC_REFUSAL_WORD, isLcRefusalToken, lcRefusalWord } from '../../shared/api.js';
import { SENTENCES, refusalSentence } from '../src/wsaudit.js';
import { childReclaimTokenKind, parseChildReclaimResult } from '../src/coord/childReclaim.js';
import { parseExpireResult } from '../src/archivedExpiry.js';
import { childReclaimFailureLine, childReclaimTerminalRefusal } from '../src/childReclaimSweep.js';

````

Replace with:

````ts
// with its ccd emission (`_ws_reclaim_tail`'s literal `_ws_reclaim_fail …
// containment-refuted`). Its sentence says only what is true under any server.
// The expiry lane classes it `stuck` (workspace lifecycle wave 6, ruling B), in
// a describe of its own below. Until the reclaim side classes it, its parser
// reads it as the resumable failure it is, so it is retried; wave 8's `stuck`
// class changes that pin on purpose.
import { describe, it, expect } from 'vitest';
import { LC_REFUSAL_WORD, isLcRefusalToken, lcRefusalWord } from '../../shared/api.js';
import { SENTENCES, refusalSentence } from '../src/wsaudit.js';
import { childReclaimTokenKind, parseChildReclaimResult } from '../src/coord/childReclaim.js';
import { EXPIRE_STUCK_WORD, parseExpireResult } from '../src/archivedExpiry.js';
import { childReclaimFailureLine, childReclaimTerminalRefusal } from '../src/childReclaimSweep.js';

````

<!-- replay: replace server/test/containment-refuted-word.test.ts -->
In `server/test/containment-refuted-word.test.ts`, find (block 21):

````ts
  });

  it('parseExpireResult: failed, resumable — the expiry lane asks again on its backoff, never at +∞', () => {
    expect(parseExpireResult('demo-quiet-dune', DOC, '')).toEqual({ kind: 'failed', resumable: true, detail: `${W}: d` });
  });

  it('the sweep reads its journal line as a FAILURE line, never a terminal refusal', () => {
    expect(childReclaimFailureLine({ outcome: 'failed', refusal: W })).toBe(true);
````

Replace with:

````ts
  });

  it('the sweep reads its journal line as a FAILURE line, never a terminal refusal', () => {
    expect(childReclaimFailureLine({ outcome: 'failed', refusal: W })).toBe(true);
````

<!-- replay: replace server/test/containment-refuted-word.test.ts -->
In `server/test/containment-refuted-word.test.ts`, find (block 22):

````ts
      { sessionId: 'demo-quiet-basin', outcome: 'failed', refusal: W, at: 1, failingSince: 1 }, childReclaimTokenKind,
    )).toBe(false);
  });
});
````

Replace with:

````ts
      { sessionId: 'demo-quiet-basin', outcome: 'failed', refusal: W, at: 1, failingSince: 1 }, childReclaimTokenKind,
    )).toBe(false);
  });
});

describe('the expiry lane reads it as STUCK, whatever crumb says (workspace lifecycle wave 6, ruling B; CCR-15’s R76 and R77)', () => {
  it('parseExpireResult: stuck — listed at once and asked again on the persistent tier, never at +∞', () => {
    for (const extra of [{}, { crumb: true }, { crumb: false }, { crumb: 'yes' }]) {
      expect(parseExpireResult('demo-quiet-dune', JSON.stringify({ failed: W, detail: 'd', ...extra }), ''), JSON.stringify(extra))
        .toEqual({ kind: 'stuck', detail: `${W}: d` });
    }
  });

  it('reads the word from its L0 home: the expiry’s stuck word IS the journal-only token, typed against it', () => {
    expect(EXPIRE_STUCK_WORD).toBe(W);
    expect(isLcRefusalToken(EXPIRE_STUCK_WORD)).toBe(true);
  });
});
````

<!-- replay: replace server/test/expire-archived.test.ts -->
In `server/test/expire-archived.test.ts`, find (block 23):

````ts
  });

  it('a refusal at audit carries its word — in-use with the processes; a GONE word is gone', async () => {
    const inUse = [{ pid: 7, comm: 'tmux: server', cwd: '/w' }];
````

Replace with:

````ts
  });

  it('containment-refuted comes back STUCK, and its feed row says the act stopped part-way and when it is asked again (wave 6, ruling B)', async () => {
    const s = await rig({ script: { audit: { code: 0, stdout: auditDoc('expirable', { token: TOK }) },
      verb: { code: 1, stdout: JSON.stringify({ failed: 'containment-refuted', detail: 'a row outside the tree', crumb: true }) } } });
    const out = await expireArchived(s.deps, s.req);
    expect(out).toMatchObject({ kind: 'stuck', detail: 'containment-refuted: a row outside the tree' });
    recordExpireFeed(s.deps, out);
    const ev = s.coord.feedEvents(10).filter((e) => e.sessionId === ID);
    expect(ev.map((e) => e.title)).toEqual(['archived workspace cleanup stuck']);
    expect(ev[0]!.body).toContain('ccd stopped part-way (containment-refuted: a row outside the tree) — the session was stopped and '
      + 'nothing further was deleted. It is listed at once, and asked again 4 hours after each failed attempt');
    expect(ev[0]!.body, 'never the cadence the standing words retired (wave 6)').not.toContain('every four hours');
  });

  it('a refusal at audit carries its word — in-use with the processes; a GONE word is gone', async () => {
    const inUse = [{ pid: 7, comm: 'tmux: server', cwd: '/w' }];
````

- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/containment-refuted-word.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-lane.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/expire-archived.test.ts --maxWorkers=1 )
```

Measured: `expire-archived.test.ts`: `1 failed | 21 passed (22)` — × containment-refuted comes back STUCK, and its feed row says … (`expected { kind: 'failed', …(5) } to match object { kind: 'stuck', …(1) }`); `containment-refuted-word.test.ts`: `2 failed | 5 passed (7)` — × parseExpireResult: stuck …; × reads the word from its L0 home … ; `archived-expiry-policy.test.ts`: `2 failed | 69 passed (71)` — × containment-refuted is STUCK: listed AT ONCE …; × a STUCK entry outranks a failing one …; `archived-expiry-lane.test.ts`: `1 failed | 36 passed (37)` — × listed AT ONCE, asked again every four hours, never stopping, one feed row ….

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 24):

````ts
// the executor re-reads, and ccd re-proves inside its lock at the instant of deletion. This file narrows the window.
import {
  TERMINAL_RUN_STATES, type ChildMark, type ExpiryAttention, type RunState,
} from '../../shared/api.js';

````

Replace with:

````ts
// the executor re-reads, and ccd re-proves inside its lock at the instant of deletion. This file narrows the window.
import {
  TERMINAL_RUN_STATES, type ChildMark, type ExpiryAttention, type LcRefusalToken, type RunState,
} from '../../shared/api.js';

````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 25):

````ts
export const isExpirePreCrumbFailed = (word: string): boolean => (EXPIRE_PRE_CRUMB_FAILED as readonly string[]).includes(word);

/** `ccd ws-expire …`'s answer (wave 3's plan, "Wave 3b inherits", the verb). Three documents — `expired` and
 *  `refused` at exit 0, `failed` at exit 1 (the breadcrumb is kept and the next attempt resumes it) — and three
````

Replace with:

````ts
export const isExpirePreCrumbFailed = (word: string): boolean => (EXPIRE_PRE_CRUMB_FAILED as readonly string[]).includes(word);

/** THE STUCK WORD on the expiry lane (workspace lifecycle wave 6, ruling B; CCR-15's R76 and R77, the reclaim side's
 *  ruling of the same word). The shared tail prints it, past the breadcrumb, when its removal-time re-ask PROVES that
 *  what it would remove is not only this workspace's own; it stopped there, and a retry finds the same thing until
 *  another tree or row moves. Read FIRST, whatever `crumb` says, as `stuck`: listed at once, asked again on the
 *  persistent tier, never at +∞. Its HOME is L0 — a member of `LcRefusalToken`, journal-only — and this constant is
 *  typed by that member (`Extract`), so a rename there leaves `never` here and the build fails: the word is read from
 *  L0, never listed again. (The reclaim side's set lives in `coord/childReclaim.ts`, which an L1 file may not import.) */
export const EXPIRE_STUCK_WORD: Extract<LcRefusalToken, 'containment-refuted'> = 'containment-refuted';

/** `ccd ws-expire …`'s answer (wave 3's plan, "Wave 3b inherits", the verb). Three documents — `expired` and
 *  `refused` at exit 0, `failed` at exit 1 (the breadcrumb is kept and the next attempt resumes it) — and three
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 26):

````ts
   *  an older ccd that prints no `crumb`, a `state-changed` (`EXPIRE_PRE_CRUMB_FAILED`). */
  | { readonly kind: 'restart'; readonly detail: string }
  | { readonly kind: 'box'; readonly word: ExpireBoxWord; readonly detail: string }
  | { readonly kind: 'composition'; readonly detail: string };
````

Replace with:

````ts
   *  an older ccd that prints no `crumb`, a `state-changed` (`EXPIRE_PRE_CRUMB_FAILED`). */
  | { readonly kind: 'restart'; readonly detail: string }
  /** `EXPIRE_STUCK_WORD`, whatever `crumb` says (wave 6, ruling B): the act stopped part-way, and a retry meets the same
   *  until another tree or row moves. */
  | { readonly kind: 'stuck'; readonly detail: string }
  | { readonly kind: 'box'; readonly word: ExpireBoxWord; readonly detail: string }
  | { readonly kind: 'composition'; readonly detail: string };
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 27):

````ts
      const detail = typeof v.detail === 'string' ? v.detail : '';
      const said = detail === '' ? v.failed : `${v.failed}: ${detail}`;
      // `crumb` (CCR-15 spec §5.6; its R76 order, workspace lifecycle wave 6, question (k)): `false` — printed before this
      // attempt's breadcrumb, so nothing it started stands — audits afresh, whatever the word; `true` — printed past a
````

Replace with:

````ts
      const detail = typeof v.detail === 'string' ? v.detail : '';
      const said = detail === '' ? v.failed : `${v.failed}: ${detail}`;
      // The WORD first (R76's order): the stuck word is stuck whatever `crumb` says (wave 6, ruling B).
      if (v.failed === EXPIRE_STUCK_WORD) return { kind: 'stuck', detail: said };
      // `crumb` (CCR-15 spec §5.6; its R76 order, workspace lifecycle wave 6, question (k)): `false` — printed before this
      // attempt's breadcrumb, so nothing it started stands — audits afresh, whatever the word; `true` — printed past a
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 28):

````ts
  /** The expiry COMPLETED and kept a leaf (wave 5, the kept-leaf reader): the row is gone, so this report outlives it in
   *  the lane's memory — until a restart, which forgets it; the feed row is the durable record. */
  | { readonly kind: 'kept'; readonly at: number; readonly clips: ExpireLeafKept; readonly tmpRoot: ExpireLeafKept };

export const archivedExpiryEntry = (archivedAt: number): ArchivedExpiryEntry => ({
````

Replace with:

````ts
  /** The expiry COMPLETED and kept a leaf (wave 5, the kept-leaf reader): the row is gone, so this report outlives it in
   *  the lane's memory — until a restart, which forgets it; the feed row is the durable record. */
  | { readonly kind: 'kept'; readonly at: number; readonly clips: ExpireLeafKept; readonly tmpRoot: ExpireLeafKept }
  /** STUCK (wave 6, ruling B): ccd stopped the act part-way on `EXPIRE_STUCK_WORD`. Listed at once and STANDING — it
   *  outranks a failing entry and stands through every answer until an attempt completes, the archive changes, or a
   *  terminal verdict (which outranks it, as on the reclaim side, CCR-15's R77). `at` is the first stuck answer,
   *  `detail` the last, `attempts` how many. On the wire it is a `failing` entry (`expiryAttention`): no new word. */
  | { readonly kind: 'stuck'; readonly at: number; readonly detail: string; readonly attempts: number };

export const archivedExpiryEntry = (archivedAt: number): ArchivedExpiryEntry => ({
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 29):

````ts
 *  would be cleared by the release, and the record with it (wave 5). */
export const expiryReportStands = (r: ExpiryReport | null): boolean =>
  expiryReportIsFinal(r) || (r !== null && r.kind === 'failing' && r.attempts !== undefined);

/** What a STANDING report keeps through an answer that ends no attempt — a deferral, a shadow audit, a refusal the box
````

Replace with:

````ts
 *  would be cleared by the release, and the record with it (wave 5). */
export const expiryReportStands = (r: ExpiryReport | null): boolean =>
  expiryReportIsFinal(r) || (r !== null && r.kind === 'failing' && r.attempts !== undefined) || r?.kind === 'stuck';

/** What a STANDING report keeps through an answer that ends no attempt — a deferral, a shadow audit, a refusal the box
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 30):

````ts
   *  the row and audits it afresh (wave 5; since wave 6 any failed document with `crumb: false`). */
  | { readonly kind: 'restart'; readonly detail: string }
  | { readonly kind: 'box'; readonly word: ExpireBoxWord; readonly detail: string }
  | { readonly kind: 'composition'; readonly detail: string }
````

Replace with:

````ts
   *  the row and audits it afresh (wave 5; since wave 6 any failed document with `crumb: false`). */
  | { readonly kind: 'restart'; readonly detail: string }
  /** ccd stopped the act part-way on the stuck word (`ExpireVerbRead.stuck`, wave 6). */
  | { readonly kind: 'stuck'; readonly detail: string }
  | { readonly kind: 'box'; readonly word: ExpireBoxWord; readonly detail: string }
  | { readonly kind: 'composition'; readonly detail: string }
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 31):

````ts
const EXPIRY_OUTCOME_KINDS: Readonly<Record<ArchivedExpiryOutcome['kind'], true>> = {
  expired: true, 'would-expire': true, deferred: true, refused: true, gone: true, failed: true, 'audit-failed': true,
  restart: true, box: true, composition: true, 'no-evidence': true,
};
const EXPIRY_DEFER_WHYS: Readonly<Record<ArchivedExpiryDeferWhy, true>> = {
````

Replace with:

````ts
const EXPIRY_OUTCOME_KINDS: Readonly<Record<ArchivedExpiryOutcome['kind'], true>> = {
  expired: true, 'would-expire': true, deferred: true, refused: true, gone: true, failed: true, 'audit-failed': true,
  restart: true, stuck: true, box: true, composition: true, 'no-evidence': true,
};
const EXPIRY_DEFER_WHYS: Readonly<Record<ArchivedExpiryDeferWhy, true>> = {
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 32):

````ts
      const verb = o.kind === 'audit-failed' ? { verbFailures: entry.verbFailures, verbFailingSince: entry.verbFailingSince }
        : { verbFailures: entry.verbFailures + 1, verbFailingSince: entry.verbFailingSince ?? nowMs };
      if (o.kind !== 'audit-failed' && verb.verbFailingSince !== null && nowMs - verb.verbFailingSince >= EXPIRE_FAILURE_GIVE_UP_MS) {
        // A DAY of failures the box called resumable (the coordinator's revised ruling, wave 5): the PERSISTENT TIER. The
````

Replace with:

````ts
      const verb = o.kind === 'audit-failed' ? { verbFailures: entry.verbFailures, verbFailingSince: entry.verbFailingSince }
        : { verbFailures: entry.verbFailures + 1, verbFailingSince: entry.verbFailingSince ?? nowMs };
      // A STUCK entry outranks every failing report (wave 6, ruling B): a later failure the box can resume keeps it, and
      // the persistent tier's cadence with it.
      if (o.kind !== 'audit-failed' && entry.report?.kind === 'stuck') {
        return { ...base, inUseRun: 0, inUse: [], failures, failingSince, ...verb, nextAskAt: nowMs + EXPIRE_PERSISTENT_RETRY_MS,
          report: entry.report };
      }
      if (o.kind !== 'audit-failed' && verb.verbFailingSince !== null && nowMs - verb.verbFailingSince >= EXPIRE_FAILURE_GIVE_UP_MS) {
        // A DAY of failures the box called resumable (the coordinator's revised ruling, wave 5): the PERSISTENT TIER. The
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 33):

````ts
        ...(o.kind === 'audit-failed' ? standingThrough(entry) : {}) };
    }
    case 'restart':
      // START OVER (wave 5, question (h) ruled): ccd stopped before anything started because what the expiry consented
      // to changed. The instant learned and the sightings are forgotten — the row goes back to learning, on the
````

Replace with:

````ts
        ...(o.kind === 'audit-failed' ? standingThrough(entry) : {}) };
    }
    case 'stuck': {
      // STUCK (wave 6, ruling B; CCR-15's R76 and R77): the act stopped part-way, and a retry finds the same until another
      // tree or row moves. Listed AT ONCE — never after the hour or the day — and on the persistent tier from the first
      // answer: one fresh audit every `EXPIRE_PERSISTENT_RETRY_MS`, never +∞, never stopping. It counts on both runs.
      const prev = entry.report?.kind === 'stuck' ? entry.report : null;
      return { ...base, inUseRun: 0, inUse: [], failures: entry.failures + 1, failingSince: entry.failingSince ?? nowMs,
        verbFailures: entry.verbFailures + 1, verbFailingSince: entry.verbFailingSince ?? nowMs,
        nextAskAt: nowMs + EXPIRE_PERSISTENT_RETRY_MS,
        report: { kind: 'stuck', at: prev?.at ?? nowMs, detail: o.detail, attempts: (prev?.attempts ?? 0) + 1 } };
    }
    case 'restart':
      // A STUCK entry stands through a restart (wave 6, ruling B: until an attempt completes or the archive changes): the
      // row keeps the entry, its instant and the tier's cadence, and its next act audits afresh as every act does.
      if (entry.report?.kind === 'stuck') {
        return { ...base, inUseRun: 0, inUse: [], eligibleSince: null, nextAskAt: nowMs + EXPIRE_PERSISTENT_RETRY_MS, report: entry.report };
      }
      // START OVER (wave 5, question (h) ruled): ccd stopped before anything started because what the expiry consented
      // to changed. The instant learned and the sightings are forgotten — the row goes back to learning, on the
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 34):

````ts
      return 'not cleaned up: the fleet box’s ccd does not say when this archive expires (an older build), so the '
        + 'server composes nothing for it until the box is updated.';
    case 'kept':
      return `cleaned up, but ccd kept ${expireKeptParts(r).join(' and ')}. The worktree, the branch and the registry row are `
````

Replace with:

````ts
      return 'not cleaned up: the fleet box’s ccd does not say when this archive expires (an older build), so the '
        + 'server composes nothing for it until the box is updated.';
    case 'stuck':
      return `cleanup stopped part-way: ${r.detail}. ccd found that what it would remove is not only this workspace’s own `
        + `(first at ${isoMs(r.at)}, ${r.attempts} ${r.attempts === 1 ? 'attempt' : 'attempts'}). The session was stopped and nothing `
        + 'further was deleted; what is left on disk stays as it is, and a retry finds the same thing until that other tree or row '
        + `is moved. The lane asks again every ${EXPIRE_PERSISTENT_RETRY_MS / 3_600_000} hours and keeps this entry until an attempt `
        + 'completes or the workspace is archived again.';
    case 'kept':
      return `cleaned up, but ccd kept ${expireKeptParts(r).join(' and ')}. The worktree, the branch and the registry row are `
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 35):

````ts
  for (const [sessionId, e] of entries) {
    if (e.report === null) continue;
    out.push({ sessionId, kind: e.report.kind, sentence: expiryReportSentence(e.report, e.expiresAt),
      archivedAt: e.archivedAt, expiresAt: e.expiresAt, at: e.report.at });
  }
````

Replace with:

````ts
  for (const [sessionId, e] of entries) {
    if (e.report === null) continue;
    // A stuck entry rides the wire as `failing` (wave 6): no new word, so an older PWA reads it as it reads any failure.
    out.push({ sessionId, kind: e.report.kind === 'stuck' ? 'failing' : e.report.kind, sentence: expiryReportSentence(e.report, e.expiresAt),
      archivedAt: e.archivedAt, expiresAt: e.expiresAt, at: e.report.at });
  }
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find (block 36):

````ts
import { RECLAIM_PAUSE_MARKER } from './rundefs.js';
import {
  EXPIRE_LANE_LIVE_MARKER, EXPIRE_TOKEN_KIND, archivedExpiryStoreSkip, expireKeptParts, parseExpireAudit, parseExpireResult, reviewKeeps,
  type ArchivedExpiryOutcome, type ExpireAuditRead, type ExpiryStoreRead,
} from '../archivedExpiry.js';
````

Replace with:

````ts
import { RECLAIM_PAUSE_MARKER } from './rundefs.js';
import {
  EXPIRE_LANE_LIVE_MARKER, EXPIRE_PERSISTENT_RETRY_MS, EXPIRE_TOKEN_KIND, archivedExpiryStoreSkip, expireKeptParts, parseExpireAudit,
  parseExpireResult, reviewKeeps,
  type ArchivedExpiryOutcome, type ExpireAuditRead, type ExpiryStoreRead,
} from '../archivedExpiry.js';
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find (block 37):

````ts
    case 'failed': return answer({ kind: 'failed', resumable: verb.resumable, detail: verb.detail });
    case 'restart': return answer({ kind: 'restart', detail: verb.detail });
    case 'box': return answer({ kind: 'box', word: verb.word, detail: verb.detail });
    case 'composition': return answer({ kind: 'composition', detail: verb.detail });
````

Replace with:

````ts
    case 'failed': return answer({ kind: 'failed', resumable: verb.resumable, detail: verb.detail });
    case 'restart': return answer({ kind: 'restart', detail: verb.detail });
    case 'stuck': return answer({ kind: 'stuck', detail: verb.detail });
    case 'box': return answer({ kind: 'box', word: verb.word, detail: verb.detail });
    case 'composition': return answer({ kind: 'composition', detail: verb.detail });
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find (block 38):

````ts
  'audit-failed': 'archived workspace cleanup failed',
  restart: 'archived workspace cleanup stopped before it began',
  box: 'archived workspace cleanup failed',
  composition: 'archived workspace cleanup failed',
````

Replace with:

````ts
  'audit-failed': 'archived workspace cleanup failed',
  restart: 'archived workspace cleanup stopped before it began',
  stuck: 'archived workspace cleanup stuck',
  box: 'archived workspace cleanup failed',
  composition: 'archived workspace cleanup failed',
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find (block 39):

````ts
    case 'restart': return `${who}: ccd stopped before this attempt started anything (${r.detail}) — nothing was deleted, `
      + 'and the lane audits it afresh.';
    case 'box': return `${who}: the fleet box refused before it started (${r.word}) — ${r.detail}.`;
    case 'composition': return `${who}: ccd rejected the call this server composed — ${r.detail}. It is not retried.`;
````

Replace with:

````ts
    case 'restart': return `${who}: ccd stopped before this attempt started anything (${r.detail}) — nothing was deleted, `
      + 'and the lane audits it afresh.';
    case 'stuck': return `${who}: ccd stopped part-way (${r.detail}) — the session was stopped and nothing further was `
      + `deleted. It is listed at once, and asked again ${EXPIRE_PERSISTENT_RETRY_MS / 3_600_000} hours after each failed attempt, `
      + 'until an attempt completes or the workspace is archived again.';
    case 'box': return `${who}: the fleet box refused before it started (${r.word}) — ${r.detail}.`;
    case 'composition': return `${who}: ccd rejected the call this server composed — ${r.detail}. It is not retried.`;
````

- [ ] **Step 4: Run — green.** Measured: `containment-refuted-word` `7 passed (7)`; `archived-expiry-policy` `71 passed (71)`; `archived-expiry-lane` `37 passed (37)`; `expire-archived` `22 passed (22)`; `mail-routes` `59 passed (59)` (the kebab scan admits `stuck`); `( cd server && ./node_modules/.bin/tsc --noEmit -p . )` rc 0.

- [ ] **Step 5: The mutation rows** (`server/src/archivedExpiry.ts` unless named).

| Row | Mutation | Red |
|---|---|---|
| T3.1 | `      if (v.failed === EXPIRE_STUCK_WORD) return { kind: 'stuck', detail: said };` → `      if (false) return { kind: 'stuck', detail: said };` | containment-refuted-word `1 failed \| 6 passed (7)`; lane `1 failed \| 36 passed (37)` |
| T3.2 | in `expiryReportStands`, ` \|\| r?.kind === 'stuck';` → `;` | policy `1 failed \| 70 passed (71)` (a STUCK entry outranks …) |
| T3.3 | `      if (o.kind !== 'audit-failed' && entry.report?.kind === 'stuck') {` → `      if (false) {` | policy `1 failed \| 70 passed (71)` (a STUCK entry outranks …) |
| T3.4 | in the `restart` arm, `      if (entry.report?.kind === 'stuck') {` (the line above `        return { ...base, inUseRun: 0, inUse: [], eligibleSince: null,`) → `      if (false) {` | policy `1 failed \| 70 passed (71)` (a STUCK entry outranks …) |
| T3.5 | in the `stuck` arm, `        nextAskAt: nowMs + EXPIRE_PERSISTENT_RETRY_MS,` → `        nextAskAt: Number.POSITIVE_INFINITY,` | policy `1 failed \| 70 passed (71)` (containment-refuted is STUCK: listed AT ONCE …); lane `1 failed \| 36 passed (37)` |
| T3.6 | `kind: e.report.kind === 'stuck' ? 'failing' : e.report.kind,` → `kind: e.report.kind as ExpiryAttention['kind'],` (a new wire word) | policy `1 failed \| 70 passed (71)`; lane `1 failed \| 36 passed (37)` |
| T3.7 | `server/src/coord/expireArchived.ts`, the `stuck` feed body: ``+ `deleted. It is listed at once, and asked again ${EXPIRE_PERSISTENT_RETRY_MS / 3_600_000} hours after each failed attempt, ` `` → ``+ `deleted. It is listed, and asked again every four hours, ` `` (the retired cadence) | expire-archived `1 failed \| 21 passed (22)` — × containment-refuted comes back STUCK … (`expected 'demo-quiet-dune (archived 2026-09-10 …' to contain 'ccd stopped part-way (containment-ref…'`) |

- [ ] **Step 6: Commit.** `feat(lifecycle): containment-refuted is stuck on the expiry lane — listed at once, the persistent tier, never +∞ (wave 6, ruling B)`.

---

### Task 4: A recurring `restart` is counted on the shared run (ruling C)

**Model routing:** `sonnet`, effort `medium`.

**Files:** `server/src/archivedExpiry.ts` (`archivedExpiryNextEntry`'s `restart` arm, `archivedExpiryLearned`'s success arm); tests `server/test/archived-expiry-policy.test.ts`, `server/test/archived-expiry-lane.test.ts`.

**Interfaces:** a `restart` (not under a stuck entry) still forgets the instant and the sightings (wave 5), and now: `failures + 1`, `failingSince ??= now`, `nextAskAt = now + archivedExpiryBackoffMs(failures, passMs)`, and the hour-ceiling report (`failing`, `at` = the run's first failure) once the run has lasted `EXPIRE_FAILURE_CEILING_MS`; the verb's run (`verbFailures`, `verbFailingSince`) is reset, so it never reaches the persistent tier. `archivedExpiryLearned` CARRIES the shared run and its report when `entry.lastOutcome === 'restart'` — the restart is what sent the row back to learning, and a learn that cleared the run would restart the ladder every time; after any other outcome the learn clears the run as before (the departure `a-recurring-restart-climbs-the-shared-ladder`).

**Why not the persistent tier (ruling C: argued).** The tier exists for a failure that may have stopped part-way: its sentence says so, and a four-hour cadence is the price of not stranding a part-cleaned workspace. A restart is the one failure that proves the opposite — ccd stopped before this attempt started anything — and every restart is a fresh audit with a fresh token. On the shared ladder it is asked at most hourly (the backoff's ceiling) and listed after the hour with "cleanup keeps failing: <ccd's word and detail>. It is retried, backing off in between.", which is true; on the tier it would be asked every four hours under a false "may have stopped part-way". Measured, a restart after a standing (tier) entry ends the standing entry and shows the hour-ceiling report (the shared run carries the day).

- [ ] **Step 1: The tests (red).** Two policy cases rewritten or added (the restart counted; a recurring restart through its learns), the steady-reset list loses the restart and a restart-reset case takes it, the tier case's restart assertion follows the shared run, and the lane gains the recurrence case; the wave-5 lane case waits out the backoff.

<!-- replay: replace server/test/archived-expiry-lane.test.ts -->
In `server/test/archived-expiry-lane.test.ts`, find (block 40):

````ts
    const audits = f.verbsFor('ws-audit').length;
    f.next(); await f.pass();
    expect(f.verbsFor('ws-audit'), 'the next pass learns the instant afresh').toHaveLength(audits + 1);
    f.next(); await f.pass();
    expect(f.verbsFor('ws-expire'), 'seen eligible once: not yet').toEqual(['demo-a']);
````

Replace with:

````ts
    const audits = f.verbsFor('ws-audit').length;
    f.next(); await f.pass();
    expect(f.verbsFor('ws-audit'), 'counted (wave 6, ruling C): backed off one wait').toHaveLength(audits);
    f.next(); await f.pass();
    expect(f.verbsFor('ws-audit'), 'the pass after its backoff learns the instant afresh').toHaveLength(audits + 1);
    f.next(); await f.pass();
    expect(f.verbsFor('ws-expire'), 'seen eligible once: not yet').toEqual(['demo-a']);
````

<!-- replay: replace server/test/archived-expiry-lane.test.ts -->
In `server/test/archived-expiry-lane.test.ts`, find (block 41):

````ts
    expect(f.verbsFor('ws-audit'), 'the act audited first').toHaveLength(audits + 2);
    expect(f.entry('demo-a'), 'and finished').toBeUndefined();
  });
});
````

Replace with:

````ts
    expect(f.verbsFor('ws-audit'), 'the act audited first').toHaveLength(audits + 2);
    expect(f.entry('demo-a'), 'and finished').toBeUndefined();
  });
});

describe('a RECURRING restart is counted (wave 6, ruling C)', () => {
  it('it backs off as any failure does and is listed after the hour — where today it composed every third pass, unlisted, for ever', async () => {
    const f = await fixture({ expire: () => ({ code: 1, stdout: JSON.stringify({ failed: 'state-changed', detail: 'moved' }), stderr: '' }) });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    const acts: number[] = [];
    let listedAt = -1;
    for (let k = 1; k <= 180; k += 1) {
      const before = f.verbsFor('ws-expire').length;
      await f.pass();
      if (f.verbsFor('ws-expire').length > before) acts.push(k);
      if (listedAt < 0 && f.entry('demo-a')?.report != null) listedAt = k;
      f.next();
    }
    expect(acts[0], 'the first act on the third pass, as ever').toBe(3);
    expect(acts[1], 'the second waits out its backoff: never the third pass after').toBeGreaterThan(6);
    expect(acts.length, 'three hours of passes: far fewer acts than one every third pass').toBeLessThan(15);
    const gaps = acts.slice(1).map((a, i) => a - acts[i]!);
    expect(gaps, 'each wait as long as the last or longer').toEqual([...gaps].sort((a, b) => a - b));
    expect(listedAt, 'listed once its run has lasted the hour').toBeGreaterThan(60);
    expect(listedAt).toBeLessThanOrEqual(150);
    await f.watcher.tick();
    const list = f.watcher.currentCoord()?.expiryAttention ?? [];
    expect(list.map((a) => [a.sessionId, a.kind])).toEqual([['demo-a', 'failing']]);
    expect(list[0]!.sentence).toBe('cleanup keeps failing: state-changed: moved. It is retried, backing off in between.');
  });
});
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 42):

````ts
  });

  it('a failed state-changed (`restart`) starts over: the instant and the sightings are forgotten and learned afresh — no report, never final (wave 5)', () => {
    // The coordinator's ruling on the wave-5 plan's question (h): the reclaim side's "not resumable" means start over.
    // Nothing was deleted, so nothing is listed; a run of failures before it is about a state that no longer stands.
    const failing = archivedExpiryNextEntry(e(), { kind: 'failed', resumable: true, detail: 'pin-failed' }, NOW - EXPIRE_FAILURE_CEILING_MS, PASS)!;
    const x = archivedExpiryNextEntry({ ...failing, report: { kind: 'failing', at: NOW - EXPIRE_FAILURE_CEILING_MS, detail: 'pin-failed' } },
      { kind: 'restart', detail: 'state-changed: moved' }, NOW, PASS)!;
    expect(x).toMatchObject({ expiresAt: null, eligibleSince: null, nextAskAt: NOW + PASS, report: null, failures: 0,
      failingSince: null, lastOutcome: 'restart' });
    expect(archivedExpiryDue(x, NOW + PASS), 'not due: it is learned again first').toBe(false);
  });

````

Replace with:

````ts
  });

  it('a failed state-changed (`restart`) starts over: the instant and the sightings are forgotten and learned afresh — never final (wave 5), and COUNTED on the shared run (wave 6, ruling C)', () => {
    // The coordinator's ruling on the wave-5 plan's question (h): the reclaim side's "not resumable" means start over.
    // Nothing this attempt started stands, so it is never final and never the persistent tier; but it is a failure of
    // the act, so it climbs the shared ladder (ruling C) — backed off, and listed once the run has lasted the ceiling.
    const first = archivedExpiryNextEntry(e(), { kind: 'restart', detail: 'state-changed: moved' }, NOW, PASS)!;
    expect(first).toMatchObject({ expiresAt: null, eligibleSince: null, nextAskAt: NOW + 2 * PASS, report: null, failures: 1,
      failingSince: NOW, verbFailures: 0, verbFailingSince: null, lastOutcome: 'restart' });
    expect(archivedExpiryDue(first, NOW + 2 * PASS), 'not due: it is learned again first').toBe(false);
    const failing = archivedExpiryNextEntry(e(), { kind: 'failed', resumable: true, detail: 'pin-failed' }, NOW - EXPIRE_FAILURE_CEILING_MS, PASS)!;
    const x = archivedExpiryNextEntry(failing, { kind: 'restart', detail: 'state-changed: moved' }, NOW, PASS)!;
    expect(x, 'an hour into the shared run: listed, still asked').toMatchObject({ expiresAt: null, eligibleSince: null, failures: 2,
      failingSince: NOW - EXPIRE_FAILURE_CEILING_MS, verbFailures: 0, verbFailingSince: null,
      report: { kind: 'failing', at: NOW - EXPIRE_FAILURE_CEILING_MS, detail: 'state-changed: moved' } });
    expect(x.report, 'never final, never the tier').not.toHaveProperty('final');
    expect(x.report).not.toHaveProperty('attempts');
    expect(x.nextAskAt).toBe(NOW + 4 * PASS);
  });

  it('a RECURRING restart climbs the ladder across its fresh audits — the learn carries the run — and is listed after the hour, never stranded (wave 6, ruling C)', () => {
    const restart = { kind: 'restart', detail: 'pin-failed: HEAD names a branch that is gone' } as const;
    const learnedAt = (expiresAt: number) => parseExpireAudit(ID, true, JSON.stringify({ session: ID, mode: 'expire',
      archivedAt: 1_789_000_000, expiresAt, sensitive: [], verdict: 'expirable', token: TOK }));
    let x = e();
    let t = NOW;
    const waits: number[] = [];
    while (t - NOW < EXPIRE_FAILURE_CEILING_MS) {
      x = archivedExpiryNextEntry(x, restart, t, PASS)!;
      waits.push(x.nextAskAt - t);
      t = x.nextAskAt;
      x = archivedExpiryLearned(x, learnedAt(1_789_604_800), t, PASS);
      expect(x.expiresAt, 'learned afresh').toBe(1_789_604_800);
      expect(x.failures, 'the learn after a restart carries the run').toBe(waits.length);
    }
    expect(waits, 'each restart waits longer: the shared backoff').toEqual([...waits].sort((a, b) => a - b));
    expect(Math.max(...waits), 'up to the ceiling, never more').toBeLessThanOrEqual(EXPIRE_FAILURE_CEILING_MS);
    x = archivedExpiryNextEntry(x, restart, t, PASS)!;
    expect(x.report, 'listed once the run has lasted the hour').toEqual({ kind: 'failing', at: NOW, detail: restart.detail });
    expect(x.nextAskAt, 'and still asked').toBeLessThan(Number.POSITIVE_INFINITY);
    expect(archivedExpiryLearned(x, learnedAt(1_789_604_800), x.nextAskAt, PASS).report, 'its report survives the learn').toEqual(x.report);
    // A learn after anything else still clears the run, as before (the control).
    const other = archivedExpiryNextEntry(e(), { kind: 'audit-failed', detail: 'x' }, NOW, PASS)!;
    expect(archivedExpiryLearned(other, learnedAt(1_789_604_800), NOW + PASS, PASS).failures, 'the control').toBe(0);
  });

````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 43):

````ts
    }
    // A failed state-changed shows that none had begun (the fresh arm runs only while no breadcrumb stands): it ends the
    // entry and starts over.
    expect(archivedExpiryNextEntry(later, { kind: 'restart', detail: 'state-changed: moved' }, later.nextAskAt, PASS),
      'a restart ends it').toMatchObject({ report: null, failures: 0, failingSince: null, expiresAt: null });
    // A hold never takes its place nor resets its cadence; an attempt that completes finishes the row; a new archive starts afresh.
    const held = archivedExpirySighted(later, { eligible: false, why: 'held' }, 'h', later.nextAskAt - PASS);
````

Replace with:

````ts
    }
    // A failed state-changed shows that none had begun (the fresh arm runs only while no breadcrumb stands): it ends the
    // entry and starts over — counted on the shared run (wave 6, ruling C), so a day of failures is still listed, with
    // the hour-ceiling report and never the tier's.
    const restarted = archivedExpiryNextEntry(later, { kind: 'restart', detail: 'state-changed: moved' }, later.nextAskAt, PASS)!;
    expect(restarted, 'a restart ends it').toMatchObject({ report: { kind: 'failing', at: NOW, detail: 'state-changed: moved' },
      verbFailures: 0, verbFailingSince: null, expiresAt: null });
    expect(restarted.report, 'no longer standing').not.toHaveProperty('attempts');
    // A hold never takes its place nor resets its cadence; an attempt that completes finishes the row; a new archive starts afresh.
    const held = archivedExpirySighted(later, { eligible: false, why: 'held' }, 'h', later.nextAskAt - PASS);
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 44):

````ts
  it('the STEADY reset: a restart, or any answer that ends the run, resets the verb’s run with the shared one (review 356, F2)', () => {
    const steadies: ReadonlyArray<readonly [string, Parameters<typeof archivedExpiryNextEntry>[1]]> = [
      ['a restart', { kind: 'restart', detail: 'state-changed: moved' }],
      ['a retryable not-expired refusal', { kind: 'refused', token: 'not-expired', detail: 'young', inUse: [] }],
      ['a deferral', { kind: 'deferred', why: 'presence', detail: 'someone is viewing this session' }],
````

Replace with:

````ts
  it('the STEADY reset: a restart, or any answer that ends the run, resets the verb’s run with the shared one (review 356, F2)', () => {
    const steadies: ReadonlyArray<readonly [string, Parameters<typeof archivedExpiryNextEntry>[1]]> = [
      ['a retryable not-expired refusal', { kind: 'refused', token: 'not-expired', detail: 'young', inUse: [] }],
      ['a deferral', { kind: 'deferred', why: 'presence', detail: 'someone is viewing this session' }],
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 45):

````ts
      expect(between, `${what} resets both runs`).toMatchObject({ failures: 0, failingSince: null, verbFailures: 0, verbFailingSince: null });
      startsAfresh(oneLater(between), `${what}, then one verb failure two days later`);
    }
  });

  it('the IN-USE reset: an in-use answer resets the verb’s run with the shared one (review 356, F2)', () => {
````

Replace with:

````ts
      expect(between, `${what} resets both runs`).toMatchObject({ failures: 0, failingSince: null, verbFailures: 0, verbFailingSince: null });
      startsAfresh(oneLater(between), `${what}, then one verb failure two days later`);
    }
  });

  it('the RESTART reset: a restart resets the verb’s run, and counts on the shared one (review 356, F2; wave 6, ruling C)', () => {
    const between = archivedExpiryNextEntry(twoVerbFailures(), { kind: 'restart', detail: 'state-changed: moved' }, NOW + 2 * PASS, PASS)!;
    expect(between).toMatchObject({ failures: 3, failingSince: NOW, verbFailures: 0, verbFailingSince: null });
    expect((oneLater(between).report as { attempts?: number } | null)?.attempts, 'a restart, then one verb failure two days later: no tier')
      .toBeUndefined();
    expect(oneLater(between), 'the verb’s run starts afresh').toMatchObject({ verbFailures: 1, verbFailingSince: NOW + TWO_DAYS });
  });

  it('the IN-USE reset: an in-use answer resets the verb’s run with the shared one (review 356, F2)', () => {
````

- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-lane.test.ts --maxWorkers=1 )
```

Measured: `archived-expiry-policy.test.ts`: `4 failed | 69 passed (73)` — × a failed state-changed (`restart`) starts over … COUNTED on the shared run; × a RECURRING restart climbs the ladder …; × a DAY of failures the box called resumable: the PERSISTENT TIER …; × the RESTART reset …; `archived-expiry-lane.test.ts`: `2 failed | 36 passed (38)` — × the lane forgets what it learned …; × it backs off as any failure does and is listed after the hour ….

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 46):

````ts
  }
  if (read.archivedAt !== entry.archivedAt) return { ...entry, nextAskAt: nowMs + passMs };
  const learned = { failures: 0, failingSince: null, verbFailures: 0, verbFailingSince: null,
    report: entry.report?.kind === 'failing' ? null : entry.report };
  if (read.expiresAt.kind !== 'at') {
    return { ...entry, ...learned, nextAskAt: nowMs + EXPIRE_NO_EVIDENCE_RETRY_MS,
````

Replace with:

````ts
  }
  if (read.archivedAt !== entry.archivedAt) return { ...entry, nextAskAt: nowMs + passMs };
  // A learn after a RESTART carries the shared run and its report (wave 6, ruling C): the restart sent the row back to
  // learning, and a learn that cleared the run would make a recurring restart start its ladder again every time.
  const learned = entry.lastOutcome === 'restart' ? { report: entry.report }
    : { failures: 0, failingSince: null, verbFailures: 0, verbFailingSince: null, report: entry.report?.kind === 'failing' ? null : entry.report };
  if (read.expiresAt.kind !== 'at') {
    return { ...entry, ...learned, nextAskAt: nowMs + EXPIRE_NO_EVIDENCE_RETRY_MS,
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 47):

````ts
        return { ...base, inUseRun: 0, inUse: [], eligibleSince: null, nextAskAt: nowMs + EXPIRE_PERSISTENT_RETRY_MS, report: entry.report };
      }
      // START OVER (wave 5, question (h) ruled): ccd stopped before anything started because what the expiry consented
      // to changed. The instant learned and the sightings are forgotten — the row goes back to learning, on the
      // learning audit's own cadence and backoff, and is asked again only once seen eligible twice past its instant,
      // with a token a fresh audit minted over what stands. No report: nothing was deleted (the feed row says so).
      return { ...base, ...steady, expiresAt: null, eligibleSince: null, nextAskAt: nowMs + passMs, report: null };
    case 'composition':
      return { ...base, ...steady, nextAskAt: Number.POSITIVE_INFINITY,
````

Replace with:

````ts
        return { ...base, inUseRun: 0, inUse: [], eligibleSince: null, nextAskAt: nowMs + EXPIRE_PERSISTENT_RETRY_MS, report: entry.report };
      }
      // START OVER (wave 5, question (h) ruled): ccd stopped before this attempt started anything. The instant learned and
      // the sightings are forgotten — the row goes back to learning, and is asked again only once seen eligible twice past
      // its instant, with a token a fresh audit minted over what stands. COUNTED (wave 6, ruling C): a restart that recurs
      // — a racing actor, or a fresh pin that fails every time — climbs the SHARED ladder, as any failure of the act does
      // (the learn after it carries the run): backed off, and listed once the run has lasted the ceiling. Never the
      // persistent tier, whose sentence says an attempt may have stopped part-way: nothing this one started stands. The
      // verb's run is reset, so a later verb failure starts the tier's clock afresh.
      {
        const failures = entry.failures + 1;
        const failingSince = entry.failingSince ?? nowMs;
        return { ...base, inUseRun: 0, inUse: [], failures, failingSince, verbFailures: 0, verbFailingSince: null,
          expiresAt: null, eligibleSince: null, nextAskAt: nowMs + archivedExpiryBackoffMs(failures, passMs),
          report: nowMs - failingSince >= EXPIRE_FAILURE_CEILING_MS ? { kind: 'failing', at: failingSince, detail: o.detail } : null };
      }
    case 'composition':
      return { ...base, ...steady, nextAskAt: Number.POSITIVE_INFINITY,
````

- [ ] **Step 4: Run — green.** Measured: `archived-expiry-policy` `73 passed (73)`; `archived-expiry-lane` `38 passed (38)`; `expire-archived` `22 passed (22)`.

- [ ] **Step 5: The mutation rows** (`server/src/archivedExpiry.ts`, the `restart` arm unless named).

| Row | Mutation | Red |
|---|---|---|
| T4.1 | `          expiresAt: null, eligibleSince: null, nextAskAt: nowMs + archivedExpiryBackoffMs(failures, passMs),` → `          expiresAt: null, eligibleSince: null, nextAskAt: nowMs + passMs,` (`main`'s cadence) | policy `1 failed \| 72 passed (73)` (… COUNTED on the shared run); lane `2 failed \| 36 passed (38)` |
| T4.2 | `          report: nowMs - failingSince >= EXPIRE_FAILURE_CEILING_MS ? { kind: 'failing', at: failingSince, detail: o.detail } : null };` → `          report: null };` (never listed) | policy `3 failed \| 70 passed (73)`; lane `1 failed \| 37 passed (38)` |
| T4.3 | in `archivedExpiryLearned`, `  const learned = entry.lastOutcome === 'restart' ? { report: entry.report }` → `  const learned = false ? { report: entry.report }` | policy `1 failed \| 72 passed (73)` (a RECURRING restart …); lane `1 failed \| 37 passed (38)` |
| T4.4 | `        return { ...base, inUseRun: 0, inUse: [], failures, failingSince, verbFailures: 0, verbFailingSince: null,` → the same with `verbFailures: entry.verbFailures, verbFailingSince: entry.verbFailingSince,` | policy `3 failed \| 70 passed (73)` (… COUNTED; the DAY tier case; the RESTART reset) |

- [ ] **Step 6: Commit.** `fix(lifecycle): a recurring restart climbs the shared ladder and is listed after the hour (wave 6, ruling C)`.

---

### Task 5: The symbolic-HEAD control case, and the consent-branch comment names the attached HEAD (ruling D; review 355, F2; ccd, AGENT-FIRST)

**Model routing:** `sonnet`, effort `medium`.

**Files:** `ccd/ccd` (`_ws_expire_locked`'s consent-branch comment); test `server/test/ccd-ws-expire-consent-branch.test.ts`.

**Interfaces:** none change. The case keeps HEAD attached (symbolic to `ws/quiet-dune`, asserted), deletes the branch at the pin's own read inside the lock (the file's `IN_THE_WINDOW`), and pins that the act ends at the PIN: exit 1, `{"failed":"pin-failed", … "crumb":false}` with `_ws_reclaim_pin`'s own sentence ("still has ws/quiet-dune checked out, but ws/quiet-dune is gone from …"), the journal's `intent` then `failed`, nothing started — never `state-changed`. It also pins both readings: with the crumb, `restart` (Task 2); the same document without the key (an older ccd), resumable. The comment gains one sentence: with HEAD symbolic to the branch a deleted branch never reaches the consent check; the pin refuses it first, before the breadcrumb.

- [ ] **Step 1: The case.**

<!-- replay: replace server/test/ccd-ws-expire-consent-branch.test.ts -->
In `server/test/ccd-ws-expire-consent-branch.test.ts`, find (block 48):

````ts
  }, 180_000);

  it('the CONTROL: a branch ALREADY ABSENT when the token was minted still expires, its work kept in the attic', () => {
    const a = makeArchived(h);
````

Replace with:

````ts
  }, 180_000);

  it('the CONTROL with HEAD symbolic to the branch, as in every real workspace: a branch deleted in the window ends at the PIN — pin-failed, before the breadcrumb — never at the consent check (wave 6, ruling D)', () => {
    const a = makeArchived(h);                        // HEAD stays attached: symbolic to ws/quiet-dune
    expect(h.git(a.wt, 'symbolic-ref', 'HEAD'), 'HEAD is attached').toBe(`refs/heads/${EXP_BRANCH}`);
    const token = expireEvalOf(h).token;              // minted over branchState=present
    const r = expireVerb(h, token, { pre: IN_THE_WINDOW(`git -C "$1" update-ref -d "refs/heads/$2" >/dev/null 2>&1`) });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const o = JSON.parse(r.stdout) as { failed: string; detail: string; crumb?: unknown };
    expect(o.failed, 'refused by the pin, before the consent check').toBe('pin-failed');
    expect(o.detail).toContain(`still has ${EXP_BRANCH} checked out, but ${EXP_BRANCH} is gone from`);
    expect(o.crumb, 'printed before the breadcrumb (wave 6, question (k))').toBe(false);
    expect(eventsOf(h.home, 'expire').map((e) => e['outcome']), 'one act: its intent, then its failure').toEqual(['intent', 'failed']);
    expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'the CONTROL: the other actor did delete the branch').toBe('');
    nothingStarted(a);
    // Never `state-changed`: the word the server reads by itself as a restart. With the crumb, a current server audits it
    // afresh, as every pre-breadcrumb failure (wave 6, (A)); an older ccd's document, which has no crumb, is resumable.
    expect(parseExpireResult(EXP_ID, r.stdout, r.stderr)).toEqual({ kind: 'restart', detail: `pin-failed: ${o.detail}` });
    expect(parseExpireResult(EXP_ID, JSON.stringify({ failed: o.failed, detail: o.detail }), ''))
      .toEqual({ kind: 'failed', resumable: true, detail: `pin-failed: ${o.detail}` });
  }, 180_000);

  it('the CONTROL: a branch ALREADY ABSENT when the token was minted still expires, its work kept in the attic', () => {
    const a = makeArchived(h);
````

- [ ] **Step 2: Run — green (the code is right; the red is the mutation).** Measured: `ccd-ws-expire-consent-branch.test.ts`: `5 passed (5)`.

- [ ] **Step 3: The comment, then the re-stamp.**

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find (block 49):

````bash
    # fresh audit (`archivedExpiry.ts`). A branch already absent when the token
    # was minted reads absent twice and goes on, its work kept in the attic.
    if [[ "$RECLAIM_BRANCHSTATE" != "$lbstate" ]]; then
      _ws_reclaim_fail "$id" "$lctx" state-changed \
````

Replace with:

````bash
    # fresh audit (`archivedExpiry.ts`). A branch already absent when the token
    # was minted reads absent twice and goes on, its work kept in the attic.
    # THE ATTACHED HEAD (review 355, F2; wave 6): with HEAD symbolic to the
    # branch, as in every real workspace, a branch DELETED in the window never
    # reaches this check — the pin above refuses it first (`pin-failed`: HEAD
    # names no commit), also before the breadcrumb. Only a HEAD detached, on
    # another branch, or gone with its worktree meets the deleted direction here.
    if [[ "$RECLAIM_BRANCHSTATE" != "$lbstate" ]]; then
      _ws_reclaim_fail "$id" "$lctx" state-changed \
````

```bash
~/.local/bin/ccrc restamp ccd/ccd && bash -n ccd/ccd
```

Measured: `ccd-ws-expire-consent-branch` `5 passed (5)`; `archived-expiry-policy` `73 passed (73)` (its census reads non-comment lines only).

- [ ] **Step 4: The mutation row.**

| Row | Mutation | Red |
|---|---|---|
| T5.1 | `ccd/ccd` (`_ws_reclaim_pin`): `  if [[ "$RECLAIM_BRANCHSTATE" == absent && "$headref" == "refs/heads/$branch" ]]; then` → `  if false; then` | `ccd-ws-expire-consent-branch.test.ts`: `1 failed \| 4 passed (5)` — the CONTROL with HEAD symbolic … (`expected 'could not read what …' to contain 'still has ws/quiet-dune checked out, …'`) |

Re-stamp after the mutation and after the restore.

- [ ] **Step 5: Commit.** `test(ccd): with HEAD attached, a branch deleted inside the lock ends at the pin; the consent comment says so (wave 6, ruling D)`.

---

### Task 6: `stillCrashed` re-reads the mirror's health and gap list after the claimant's measure (ruling E; review 355, F7; wave 5 Task 6's review F1)

**Model routing:** `opus`, effort `high` — the dead-coordinator lane's act; the review proves the revive window.

**Files:** `server/src/coord/endDeadCoordinator.ts`, `server/src/watch.ts` (the act's deps); tests `server/test/end-dead-coordinator.test.ts`, `server/test/dead-coordinator-lane.test.ts`.

**Interfaces:**
- `EndDeadCoordinatorDeps` gains `journalReread: (early: DeadCoordinatorJournalTrust) => { readonly hold: string | null; readonly trust: DeadCoordinatorJournalTrust }` — SYNCHRONOUS by its type: it returns no promise.
- `export function rereadDeadCoordinatorJournalTrust(coord, health, early)`: a mirror now `stale`/`unknown` (or no store) → a `hold` ("the lifecycle mirror turned <state> during the claimant’s measure"); `unavailable` → untrusted; a gap list that cannot be read again → untrusted; otherwise the early trust with the gaps UNIONED (`const gapGens = [...new Set([...early.gapGens, ...late])]`). The write-error instant needs a stat — the one await, which stays before the measure — but the COUNT behind it (`health.writeErrors`) is synchronous: where the early read saw none (`lastWriteErrorAt: null`) and the mirror now counts one, the instant becomes `'unknown'`, which the journal clause reads as unmeasured (`counted`; the act-safety lens on review 355's F7). It never trusts more than the early read: `...early` keeps an untrusted read untrusted and keeps a write-error instant the early read had placed — so a further failure on top of one already counted is not seen before the commit, which §5.4 and §12 say. `readDeadCoordinatorJournalTrust`'s local `untrusted` helper moves to module scope (`journalUntrusted`), unchanged.
- `stillCrashed`: after `await measureClaimant(…)`, `const late = deps.journalReread(journal.trust)`; a `late.hold` stops as `{ kind: 'hold', … }` (F4: the anchor and the run of passes kept); the journal clause reads `late.trust`.
- `watch.ts` wires `journalReread: (early) => rereadDeadCoordinatorJournalTrust(coord, this.lifecycleHealth(), early)` — the mirror as it is THEN.

**The revive window, proved by reading (ruling E).** In `stillCrashed` the last `await` is `measureClaimant`; after it come `deps.journalReread` (synchronous by type), `deadCoordinatorJournalOf` (a synchronous store read), `deadCoordinatorCrash` (L1) and the return. In `close.ts`'s sweep arm the post-fleet-act `const stop = await sweep.stillCrashed();` is followed, on that path, only by `if (stop !== null) return …` and then `const closed = coord.closeRun({ … expectClaimedBy … })`, synchronous (the `} else if (sweep !== undefined) { … }` between them is the arm with no fleet act, which this path never enters). So no await is added between the claimant's measure and the commit, and the window stays the measure's own round trip. A structural case pins both (codeOnly, so a comment that says "await" is not code).

- [ ] **Step 1: The tests (red).** Executor cases (a mirror turning stale during the measure: a hold, before the fleet act; a gap recorded during it: re-measured unmeasured; the structural case), the adapter's five cases (stale/unknown/no store; the gap union; a mirror now `unavailable`; a write failure counted during the measure; never more trust), and two lane cases through the real watcher (the mirror's clock moved 20 s inside the act's tmux ask; a gap recorded there).

<!-- replay: replace server/test/dead-coordinator-lane.test.ts -->
In `server/test/dead-coordinator-lane.test.ts`, find (block 50):

````ts
    f.next(); await f.pass();
    expect(f.stateOf(r), 'the mirror is fresh again: the hour it kept is due on the next pass').toBe('failed');
  });

````

Replace with:

````ts
    f.next(); await f.pass();
    expect(f.stateOf(r), 'the mirror is fresh again: the hour it kept is due on the next pass').toBe('failed');
  });

  it('a mirror that goes STALE DURING the claimant’s measure stops the act as a hold: the anchor and the run of passes stand (wave 6; review 355, F7)', async () => {
    let armed = false;
    let inAct = false;
    const f: Fixture = await fixture({ beforeAct: () => { inAct = armed; },
      onHasSession: () => { if (inAct) { inAct = false; f.advance(20_000); } } });   // three sweep intervals and more
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    await f.pass(); await walk(f, HOUR - 60_000);
    const anchor = f.anchorOf(A);
    armed = true;
    f.next(); await f.pass();
    armed = false;
    expect(f.acts(), 'the act was asked').toBe(1);
    expect(f.stateOf(r), 'nothing ended').toBe('working');
    expect(f.calls, 'nothing composed').toEqual([]);
    expect(f.anchorOf(A), 'a slow mirror never deletes an anchor').toMatchObject({ firstDeadAt: (anchor as { firstDeadAt: number }).firstDeadAt });
    expect(f.watcher().currentDeadCoordinators().get(A)?.crashedPasses, 'nor the run of passes').toBeGreaterThanOrEqual(2);
    f.next(); await f.pass();
    expect(f.stateOf(r), 'the mirror is fresh again: the hour it kept is due on the next pass').toBe('failed');
  });

  it('a gap the mirror records DURING the claimant’s measure is read before the commit: nothing ends (wave 6; review 355, F7)', async () => {
    let armed = false;
    let inAct = false;
    const f: Fixture = await fixture({ beforeAct: () => { inAct = armed; }, onHasSession: () => {
      if (inAct) { inAct = false; f.coord.recordGap({ at: T0, gen: '1790000000000000000', reason: 'shrank', detail: 'd', lostFrom: 0, lostTo: 9 }); }
    } });
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A);
    f.journal(A, 'spawn', { meas: { rc: '0' } });
    await f.pass(); await walk(f, HOUR - 60_000);
    armed = true;
    f.next(); await f.pass();
    expect(f.acts(), 'the act was asked').toBe(1);
    expect(f.stateOf(r), 'a gap since its last start may hide a deliberate act: nothing ends').toBe('working');
    expect(f.calls, 'nothing composed').toEqual([]);
  });

````

<!-- replay: replace server/test/end-dead-coordinator.test.ts -->
In `server/test/end-dead-coordinator.test.ts`, find (block 51):

````ts
// nothing reaches a box.
import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { closeRun, type CloseOutcome } from '../src/coord/close.js';
import { DeadCoordinatorActThrew, endDeadCoordinator, readDeadCoordinatorJournalTrust, recordDeadCoordinatorFeed, type EndDeadCoordinatorDeps } from '../src/coord/endDeadCoordinator.js';
import {
  DEAD_COORDINATOR_JOURNAL_TRUSTED, DEAD_COORDINATOR_LANE_LIVE_MARKER, type DeadCoordinatorJournalTrust,
````

Replace with:

````ts
// nothing reaches a box.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { closeRun, type CloseOutcome } from '../src/coord/close.js';
import {
  DeadCoordinatorActThrew, endDeadCoordinator, readDeadCoordinatorJournalTrust, recordDeadCoordinatorFeed, rereadDeadCoordinatorJournalTrust,
  type EndDeadCoordinatorDeps,
} from '../src/coord/endDeadCoordinator.js';
import {
  DEAD_COORDINATOR_JOURNAL_TRUSTED, DEAD_COORDINATOR_LANE_LIVE_MARKER, type DeadCoordinatorJournalTrust,
````

<!-- replay: replace server/test/end-dead-coordinator.test.ts -->
In `server/test/end-dead-coordinator.test.ts`, find (block 52):

````ts
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const CRASHED = 'demo-coord-crashed';
````

Replace with:

````ts
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';
import { codeOnly } from './sourceScan.js';

const CRASHED = 'demo-coord-crashed';
````

<!-- replay: replace server/test/end-dead-coordinator.test.ts -->
In `server/test/end-dead-coordinator.test.ts`, find (block 53):

````ts
  /** The executor's clock at each re-measure (default: the pass's own instant, `NOW`). */
  clockAt?: number;
}

````

Replace with:

````ts
  /** The executor's clock at each re-measure (default: the pass's own instant, `NOW`). */
  clockAt?: number;
  /** The journal's trust as it is READ AGAIN after the claimant's measure (default: the early read's, unchanged). */
  reread?: (early: DeadCoordinatorJournalTrust) => { hold: string | null; trust: DeadCoordinatorJournalTrust };
}

````

<!-- replay: replace server/test/end-dead-coordinator.test.ts -->
In `server/test/end-dead-coordinator.test.ts`, find (block 54):

````ts
    tmux: { sessionVerdict: async () => { asked += 1; o.onMeasure?.(asked); return o.verdict?.(asked) ?? { verdict: 'gone' }; } },
    journalTrust: async () => ({ hold: o.hold ?? null, trust: o.trust ?? DEAD_COORDINATOR_JOURNAL_TRUSTED }),
    now: () => o.clockAt ?? NOW,
    // The sweep's abandon exactly as the serialiser's handle runs it (`routes.ts`'s `withSweepAbandon`): the REAL
````

Replace with:

````ts
    tmux: { sessionVerdict: async () => { asked += 1; o.onMeasure?.(asked); return o.verdict?.(asked) ?? { verdict: 'gone' }; } },
    journalTrust: async () => ({ hold: o.hold ?? null, trust: o.trust ?? DEAD_COORDINATOR_JOURNAL_TRUSTED }),
    journalReread: (early) => o.reread?.(early) ?? { hold: null, trust: early },
    now: () => o.clockAt ?? NOW,
    // The sweep's abandon exactly as the serialiser's handle runs it (`routes.ts`'s `withSweepAbandon`): the REAL
````

<!-- replay: replace server/test/end-dead-coordinator.test.ts -->
In `server/test/end-dead-coordinator.test.ts`, find (block 55):

````ts
});

describe('the feed', () => {
  it('ONE row per ended programme in the spec’s words; a shadow row says nothing was ended — recorded, never pushed', async () => {
````

Replace with:

````ts
});

describe('the journal’s trust is READ AGAIN after the claimant’s measure (wave 6; review 355, F7)', () => {
  it('a mirror that turns stale DURING the measure stops the act as a hold — before the fleet act, nothing closed', async () => {
    let measured = false;
    const r = await rig({ onMeasure: () => { measured = true; },
      reread: (early) => (measured ? { hold: 'the lifecycle mirror turned stale during the claimant’s measure',
        trust: { untrusted: 'the lifecycle mirror turned stale during the claimant’s measure', gapGens: [], lastWriteErrorAt: null } }
        : { hold: null, trust: early }) });
    const a = r.working('alpha', 'demo-w1');
    expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).toMatchObject({ kind: 'ended', programmes: [],
      stoppedBy: { kind: 'hold', why: 'the lifecycle mirror turned stale during the claimant’s measure — the act waits, and its hour stands' } });
    expect(r.calls, 'nothing composed').toEqual([]);
    expect(r.stateOf(a)).toBe('working');
  });

  it('a gap recorded DURING the measure is read before the commit: re-measured unmeasured — nothing closed', async () => {
    let measured = false;
    const r = await rig({ onMeasure: () => { measured = true; },
      reread: (early) => ({ hold: null, trust: measured ? { ...early, gapGens: ['1790000000000000000'] } : early }) });
    const a = r.working('alpha', 'demo-w1');
    expect(await endDeadCoordinator(r.deps, CRASHED, NOW)).toMatchObject({ kind: 'ended', programmes: [],
      stoppedBy: { kind: 'remeasured', why: expect.stringContaining('lost journal bytes in generation 1790000000000000000') } });
    expect(r.calls, 'nothing composed').toEqual([]);
    expect(r.stateOf(a)).toBe('working');
  });

  it('the re-read is the last read, and nothing awaits after the claimant’s measure — in stillCrashed, nor in close between it and the commit', () => {
    const src = (f: string): string => codeOnly(readFileSync(path.join(import.meta.dirname, '..', 'src', 'coord', f), 'utf8'));
    const exec = src('endDeadCoordinator.ts');
    const from = exec.indexOf('export async function stillCrashed(');
    const body = exec.slice(from, exec.indexOf('\n}\n', from));
    const measure = body.indexOf('await measureClaimant(');
    expect(measure, 'the claimant’s measure').toBeGreaterThan(-1);
    const after = body.slice(measure + 'await measureClaimant('.length);
    expect(after, 'no await after the measure: the revive window stays its round trip').not.toMatch(/\bawait\b/);
    expect(after.indexOf('deps.journalReread(journal.trust)'), 'the re-read, after the measure').toBeGreaterThan(-1);
    const close = src('close.ts');
    const last = close.indexOf('const stop = await sweep.stillCrashed();');
    expect(last, 'close’s re-measure after the fleet act').toBeGreaterThan(-1);
    const commit = close.indexOf('const closed = coord.closeRun({', last);
    expect(commit, 'then the commit').toBeGreaterThan(last);
    // Between them sits only the arm with NO fleet act (`} else if (sweep !== undefined) { … }`), which a run whose fleet act
    // ran never enters: nothing awaits on the path from the re-measure to the commit.
    const between = close.slice(last + 'const stop = await sweep.stillCrashed();'.length, commit);
    const noFleetAct = between.indexOf('    } else if (sweep !== undefined) {\n');
    expect(noFleetAct, 'the arm with no fleet act').toBeGreaterThan(-1);
    expect(between.slice(0, noFleetAct), 'nothing awaits after the re-measure').not.toMatch(/\bawait\b/);
    expect(between.slice(between.indexOf('\n    }\n', noFleetAct)), 'nor after that arm, up to the commit').not.toMatch(/\bawait\b/);
  });
});

describe('the journal-trust re-read adapter (wave 6; review 355, F7)', () => {
  const OK: LifecycleHealth = { state: 'ok', newestAt: 1, horizon: 1, rows: 1, generations: 1, gaps: 0, writeErrors: null, lastOk: 1 };
  const EARLY: DeadCoordinatorJournalTrust = { untrusted: null, gapGens: ['1790000000000000000'], lastWriteErrorAt: 5 };

  it('a mirror now stale or unknown is a HOLD; one with no store is a hold too', async () => {
    const r = await rig();
    for (const state of ['stale', 'unknown'] as const) {
      expect(rereadDeadCoordinatorJournalTrust(r.coord, { ...OK, state }, EARLY).hold, state)
        .toBe(`the lifecycle mirror turned ${state} during the claimant’s measure`);
    }
    expect(rereadDeadCoordinatorJournalTrust(r.coord, null, EARLY).hold).toBe('there is no coordination store to mirror the journal into');
  });

  it('a gap recorded since the early read JOINS its gaps; the write-error instant stays the early read’s', async () => {
    const r = await rig();
    r.coord.recordGap({ at: NOW, gen: '1790000000000000001', reason: 'shrank', detail: 'd', lostFrom: 0, lostTo: 9 });
    expect(rereadDeadCoordinatorJournalTrust(r.coord, OK, EARLY)).toEqual({ hold: null,
      trust: { untrusted: null, gapGens: ['1790000000000000000', '1790000000000000001'], lastWriteErrorAt: 5 } });
  });

  it('a mirror now unavailable (the fleet’s ccd no longer journals) is untrusted — never the early read’s trust', async () => {
    const r = await rig();
    expect(rereadDeadCoordinatorJournalTrust(r.coord, { ...OK, state: 'unavailable' }, EARLY)).toEqual({ hold: null,
      trust: { untrusted: 'the fleet box’s ccd does not journal (no lifecycle-v1)', gapGens: [], lastWriteErrorAt: null } });
  });

  it('a write failure ccd counted DURING the measure is read too: where the early read saw none, its instant is unknown', async () => {
    const r = await rig();
    const none: DeadCoordinatorJournalTrust = { untrusted: null, gapGens: [], lastWriteErrorAt: null };
    expect(rereadDeadCoordinatorJournalTrust(r.coord, { ...OK, writeErrors: 1 }, none)).toEqual({ hold: null,
      trust: { untrusted: null, gapGens: [], lastWriteErrorAt: 'unknown' } });
    expect(rereadDeadCoordinatorJournalTrust(r.coord, { ...OK, writeErrors: 0 }, none), 'the CONTROL: none counted').toEqual({ hold: null, trust: none });
    expect(rereadDeadCoordinatorJournalTrust(r.coord, { ...OK, writeErrors: 2 }, EARLY), 'a count the early read placed keeps its instant')
      .toEqual({ hold: null, trust: EARLY });
  });

  it('it never trusts more than the early read did: an untrusted early read stays untrusted, and a gap list it cannot read is untrust', async () => {
    const r = await rig();
    const untrusted: DeadCoordinatorJournalTrust = { untrusted: 'the lifecycle mirror is unavailable', gapGens: [], lastWriteErrorAt: null };
    expect(rereadDeadCoordinatorJournalTrust(r.coord, OK, untrusted)).toEqual({ hold: null, trust: untrusted });
    r.coord.lifecycleGapGens = () => { throw new Error('database disk image is malformed'); };
    expect(rereadDeadCoordinatorJournalTrust(r.coord, OK, EARLY).trust.untrusted).toContain('database disk image is malformed');
  });
});

describe('the feed', () => {
  it('ONE row per ended programme in the spec’s words; a shadow row says nothing was ended — recorded, never pushed', async () => {
````

- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/end-dead-coordinator.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-lane.test.ts --maxWorkers=1 )
```

Measured: `end-dead-coordinator.test.ts`: `8 failed | 23 passed (31)` — the three executor cases and the five adapter cases (`TypeError: rereadDeadCoordinatorJournalTrust is not a function`); `dead-coordinator-lane.test.ts`: `2 failed | 32 passed (34)` — × a mirror that goes STALE DURING the claimant’s measure …; × a gap the mirror records DURING the claimant’s measure … (`nothing composed: expected [ [ 'ws-release', '--session', …(1) ] ] to deeply equal []`).

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/coord/endDeadCoordinator.ts -->
In `server/src/coord/endDeadCoordinator.ts`, find (block 56):

````ts
  notifyLog?: NotifyLog;
  journalTrust: () => Promise<{ readonly hold: string | null; readonly trust: DeadCoordinatorJournalTrust }>;
  abandon: (runId: number, crashedId: string, stillCrashed: SweepCloseGuard['stillCrashed']) => Promise<CloseOutcome>;
  /** The lane's clock, read at the moment each re-measure measures. A re-measure NEVER takes the pass's instant: a
````

Replace with:

````ts
  notifyLog?: NotifyLog;
  journalTrust: () => Promise<{ readonly hold: string | null; readonly trust: DeadCoordinatorJournalTrust }>;
  /** The journal's trust READ AGAIN after the claimant's measure (wave 6; review 355, F7): the mirror's health state,
   *  its gap list and its write-error count, all SYNCHRONOUS — so this port returns no promise, and no await can sit
   *  between the claimant's measure and the commit. Handed the early read's trust, it never trusts more
   *  (`rereadDeadCoordinatorJournalTrust`). */
  journalReread: (early: DeadCoordinatorJournalTrust) => { readonly hold: string | null; readonly trust: DeadCoordinatorJournalTrust };
  abandon: (runId: number, crashedId: string, stillCrashed: SweepCloseGuard['stillCrashed']) => Promise<CloseOutcome>;
  /** The lane's clock, read at the moment each re-measure measures. A re-measure NEVER takes the pass's instant: a
````

<!-- replay: replace server/src/coord/endDeadCoordinator.ts -->
In `server/src/coord/endDeadCoordinator.ts`, find (block 57):

````ts
  deps: Pick<EndDeadCoordinatorDeps, 'coord' | 'io' | 'cfg'>, health: LifecycleHealth | null,
): Promise<{ readonly hold: string | null; readonly trust: DeadCoordinatorJournalTrust }> {
  const untrusted = (why: string, hold: boolean) =>
    ({ hold: hold ? why : null, trust: { untrusted: why, gapGens: [], lastWriteErrorAt: null } });
  if (health === null) return untrusted('there is no coordination store to mirror the journal into', true);
  if (health.state === 'unknown' || health.state === 'stale') return untrusted(`the lifecycle mirror is ${health.state}`, true);
````

Replace with:

````ts
  deps: Pick<EndDeadCoordinatorDeps, 'coord' | 'io' | 'cfg'>, health: LifecycleHealth | null,
): Promise<{ readonly hold: string | null; readonly trust: DeadCoordinatorJournalTrust }> {
  const untrusted = journalUntrusted;
  if (health === null) return untrusted('there is no coordination store to mirror the journal into', true);
  if (health.state === 'unknown' || health.state === 'stale') return untrusted(`the lifecycle mirror is ${health.state}`, true);
````

<!-- replay: replace server/src/coord/endDeadCoordinator.ts -->
In `server/src/coord/endDeadCoordinator.ts`, find (block 58):

````ts
    else if (!(health.writeErrors === null && st.reason === 'absent')) lastWriteErrorAt = 'unknown';
  }
  return { hold: null, trust: { untrusted: null, gapGens, lastWriteErrorAt } };
}

/** Is the lane ARMED in this registry listing? The one reader of the live switch outside its definer — so the watcher,
````

Replace with:

````ts
    else if (!(health.writeErrors === null && st.reason === 'absent')) lastWriteErrorAt = 'unknown';
  }
  return { hold: null, trust: { untrusted: null, gapGens, lastWriteErrorAt } };
}

const journalUntrusted = (why: string, hold: boolean): { readonly hold: string | null; readonly trust: DeadCoordinatorJournalTrust } =>
  ({ hold: hold ? why : null, trust: { untrusted: why, gapGens: [], lastWriteErrorAt: null } });

/** THE JOURNAL'S TRUST, READ AGAIN after the claimant's measure (wave 6; review 355, F7, and wave 5 Task 6's review F1).
 *  `readDeadCoordinatorJournalTrust` reads three things BEFORE the measure: the mirror's health state, its gap list and
 *  the last write-error instant. The first two are synchronous, so they are read again here, with no await between this
 *  and the commit: a mirror that turned `unknown` or `stale` during the measure's round trip is a `hold` (review 339,
 *  F4: the anchor and the run of passes are kept), and a gap recorded since JOINS the early read's gaps. The third needs
 *  a stat — the one await, which stays before the measure — but the COUNT behind it is the mirror's, synchronous: where
 *  the early read saw no failure and the mirror now counts one, its instant is `unknown` here, so the claimant reads
 *  unmeasured. It never trusts more than the early read did: an untrusted early read stays untrusted, and a count the
 *  early read had already placed keeps its instant (a further failure on top of it is not seen before the commit). */
export function rereadDeadCoordinatorJournalTrust(
  coord: CoordStore, health: LifecycleHealth | null, early: DeadCoordinatorJournalTrust,
): { readonly hold: string | null; readonly trust: DeadCoordinatorJournalTrust } {
  if (health === null) return journalUntrusted('there is no coordination store to mirror the journal into', true);
  if (health.state === 'unknown' || health.state === 'stale') {
    return journalUntrusted(`the lifecycle mirror turned ${health.state} during the claimant’s measure`, true);
  }
  if (health.state === 'unavailable') return journalUntrusted('the fleet box’s ccd does not journal (no lifecycle-v1)', false);
  let late: string[];
  try {
    late = coord.lifecycleGapGens();
  } catch (err) {
    return journalUntrusted(`the mirror's recorded gaps could not be read again (${err instanceof Error ? err.message : String(err)})`, false);
  }
  const gapGens = [...new Set([...early.gapGens, ...late])];
  // A write failure counted since an early read that saw none (wave 6; the act-safety lens on review 355's F7).
  const counted = early.lastWriteErrorAt === null && typeof health.writeErrors === 'number' && health.writeErrors > 0;
  // `...early` keeps an untrusted early read untrusted, and its write-error instant, save a count that appeared since.
  return { hold: null, trust: { ...early, gapGens, ...(counted ? { lastWriteErrorAt: 'unknown' as const } : {}) } };
}

/** Is the lane ARMED in this registry listing? The one reader of the live switch outside its definer — so the watcher,
````

<!-- replay: replace server/src/coord/endDeadCoordinator.ts -->
In `server/src/coord/endDeadCoordinator.ts`, find (block 59):

````ts
  if (journal.hold !== null) return { kind: 'hold', why: `${journal.hold} — the act waits, and its hour stands` };
  const m = await measureClaimant({ coord: deps.coord, io: deps.io, cfg: deps.cfg, tmux: deps.tmux }, id, deps.now());
  const c = deadCoordinatorCrash(m, deadCoordinatorJournalOf(deps.coord, id, journal.trust));
  switch (c.kind) {
    case 'crashed': return null;
````

Replace with:

````ts
  if (journal.hold !== null) return { kind: 'hold', why: `${journal.hold} — the act waits, and its hour stands` };
  const m = await measureClaimant({ coord: deps.coord, io: deps.io, cfg: deps.cfg, tmux: deps.tmux }, id, deps.now());
  // The measure is the LAST await (wave 6; review 355, F7): the mirror's health and its gaps are read again after it,
  // synchronously, so a mirror gone stale or a gap recorded during its round trip is seen, and from here to the commit
  // nothing awaits — the revive window stays that round trip.
  const late = deps.journalReread(journal.trust);
  if (late.hold !== null) return { kind: 'hold', why: `${late.hold} — the act waits, and its hour stands` };
  const c = deadCoordinatorCrash(m, deadCoordinatorJournalOf(deps.coord, id, late.trust));
  switch (c.kind) {
    case 'crashed': return null;
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find (block 60):

````ts
  deadCoordinatorNextEntry, deadCoordinatorOutcomeKey, deadCoordinatorSighted, deadCoordinatorSince, deadCoordinatorThrew,
  type ClaimantDeadCause, type DeadAnchor, type DeadCoordinatorActOutcome, type DeadCoordinatorBreaker,
  type DeadCoordinatorBreakerMember, type DeadCoordinatorEntry, type DeadCoordinatorJournal,
} from './deadCoordinator.js';
import {
  DeadCoordinatorActThrew, deadCoordinatorLaneArmed, endDeadCoordinator, readDeadCoordinatorJournalTrust, recordDeadCoordinatorBreaker,
  recordDeadCoordinatorFeed, recordDeadCoordinatorThrew,
} from './coord/endDeadCoordinator.js';
import type { CoordRoutesHandle } from './coord/routes.js';
````

Replace with:

````ts
  deadCoordinatorNextEntry, deadCoordinatorOutcomeKey, deadCoordinatorSighted, deadCoordinatorSince, deadCoordinatorThrew,
  type ClaimantDeadCause, type DeadAnchor, type DeadCoordinatorActOutcome, type DeadCoordinatorBreaker,
  type DeadCoordinatorBreakerMember, type DeadCoordinatorEntry, type DeadCoordinatorJournal, type DeadCoordinatorJournalTrust,
} from './deadCoordinator.js';
import {
  DeadCoordinatorActThrew, deadCoordinatorLaneArmed, endDeadCoordinator, readDeadCoordinatorJournalTrust, recordDeadCoordinatorBreaker,
  recordDeadCoordinatorFeed, recordDeadCoordinatorThrew, rereadDeadCoordinatorJournalTrust,
} from './coord/endDeadCoordinator.js';
import type { CoordRoutesHandle } from './coord/routes.js';
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find (block 61):

````ts
      now: (): number => Date.now(),
      // WHOLE — the hold with the trust — so a mirror gone stale since the pass is a `hold` stop (review 339, F4).
      journalTrust: () => readDeadCoordinatorJournalTrust({ coord, io: this.deps.io, cfg: this.deps.cfg }, this.lifecycleHealth()) };
    try {
      const out = await serial(coord, (abandon) => endDeadCoordinator({ ...deps, abandon }, pick.id, now));
````

Replace with:

````ts
      now: (): number => Date.now(),
      // WHOLE — the hold with the trust — so a mirror gone stale since the pass is a `hold` stop (review 339, F4).
      journalTrust: () => readDeadCoordinatorJournalTrust({ coord, io: this.deps.io, cfg: this.deps.cfg }, this.lifecycleHealth()),
      // ...and its synchronous half again AFTER the claimant's measure, from the mirror as it is THEN (wave 6; review 355, F7).
      journalReread: (early: DeadCoordinatorJournalTrust) => rereadDeadCoordinatorJournalTrust(coord, this.lifecycleHealth(), early) };
    try {
      const out = await serial(coord, (abandon) => endDeadCoordinator({ ...deps, abandon }, pick.id, now));
````

- [ ] **Step 4: Run — green.** Measured: `end-dead-coordinator` `31 passed (31)`; `dead-coordinator-lane` `34 passed (34)`; `sweep-close` `13 passed (13)`; `dead-coordinator-policy` `42 passed (42)`; server `tsc` rc 0.

- [ ] **Step 5: The mutation rows.**

| Row | Mutation | Red |
|---|---|---|
| T6.1 | `endDeadCoordinator.ts`: `  if (late.hold !== null) return` → `  if (false) return` | end-dead `1 failed \| 30 passed (31)` (a mirror that turns stale DURING the measure …); lane `1 failed \| 33 passed (34)` (STALE DURING) |
| T6.2 | `endDeadCoordinator.ts`: `deadCoordinatorJournalOf(deps.coord, id, late.trust)` → `deadCoordinatorJournalOf(deps.coord, id, journal.trust)` | end-dead `1 failed \| 30 passed (31)` (a gap recorded DURING …); lane `1 failed \| 33 passed (34)` (a gap … DURING) |
| T6.3 | `watch.ts`: `      journalReread: (early: DeadCoordinatorJournalTrust) => rereadDeadCoordinatorJournalTrust(coord, this.lifecycleHealth(), early) };` → `      journalReread: (early: DeadCoordinatorJournalTrust) => ({ hold: null, trust: early }) };` | lane `2 failed \| 32 passed (34)` |
| T6.4 | `endDeadCoordinator.ts`: `  const gapGens = [...new Set([...early.gapGens, ...late])];` → `  const gapGens = late;` | end-dead `2 failed \| 29 passed (31)` (a gap recorded since the early read JOINS its gaps …; a write failure ccd counted DURING the measure …, whose third assertion holds the early gaps) |
| T6.5 | `endDeadCoordinator.ts`: `trust: { ...early, gapGens, ...(counted` → `trust: { untrusted: null, lastWriteErrorAt: early.lastWriteErrorAt, gapGens, ...(counted` | end-dead `1 failed \| 30 passed (31)` (it never trusts more than the early read did …) |
| T6.6 | `endDeadCoordinator.ts`, after `export function rereadDeadCoordinatorJournalTrust(`: `  if (health.state === 'unknown' \|\| health.state === 'stale') {` → `  if (false) {` | end-dead `1 failed \| 30 passed (31)` (a mirror now stale or unknown is a HOLD …); lane `1 failed \| 33 passed (34)` |
| T6.7 | `endDeadCoordinator.ts`: above `  const late = deps.journalReread(journal.trust);` add `  await Promise.resolve();` | end-dead `1 failed \| 30 passed (31)` (the re-read is the last read, and nothing awaits …) |
| T6.8 | `endDeadCoordinator.ts`, after `export function rereadDeadCoordinatorJournalTrust(`: `  if (health.state === 'unavailable') return` → `  if (false) return` | end-dead `1 failed \| 30 passed (31)` (a mirror now unavailable … is untrusted — never the early read’s trust) |
| T6.9 | `endDeadCoordinator.ts`: `  const counted = early.lastWriteErrorAt === null` → `  const counted = false && early.lastWriteErrorAt === null` | end-dead `1 failed \| 30 passed (31)` (a write failure ccd counted DURING the measure is read too …) |
| T6.10 | `server/src/coord/close.ts`: below `        if (stop !== null) return { ok: false, kind: 'sweep-stopped', stop, fleetAct: release ? 'released' : 're-held' };` add `        await Promise.resolve();` | end-dead `1 failed \| 30 passed (31)` (the re-read is the last read, and nothing awaits … — "nothing awaits after the re-measure") |
| T6.11 | `server/src/coord/close.ts`: above `    const closed = coord.closeRun({` add `    await Promise.resolve();` | end-dead `1 failed \| 30 passed (31)` (the same case — "nor after that arm, up to the commit") |

The drafted adapter carried a further guard, `if (early.untrusted !== null) return { hold: null, trust: early };`: its mutation row survived (`29 passed`, before the revision's two adapter cases), because `...early` already keeps an untrusted read untrusted, so it was removed as dead code; T6.5 is the row for that rule. The review's tests lens found the `unavailable` branch a survivor too (no case reached it): the revision added its case, and T6.8 is its row.

- [ ] **Step 6: Commit.** `fix(lifecycle): the dead-coordinator act re-reads the mirror's health and gaps after the claimant's measure, with nothing awaited after it (wave 6, ruling E)`.

---

### Task 7: A hold met at the re-measure after the fleet act has a lane case (ruling F; wave 5 Task 6's residual)

**Model routing:** `sonnet`, effort `medium` — one lane case; the code is right, and the case pins it.

**Files:** test `server/test/dead-coordinator-lane.test.ts`. No source change.

**Interfaces:** none. The lane is the dead-coordinator lane: `close.ts`'s sweep arm re-measures after the fleet act (`ws-release`), and a mirror that went stale in between makes `stillCrashed` answer `hold` there, so `closeRun` answers `sweep-stopped` with `fleetAct: 'released'`. Measured: the worker is released, the run stays open, one `dead coordinator: programme partly ended` feed row, a `stuck` attention entry naming the released worker, the anchor kept, and the next pass ends the programme.

- [ ] **Step 1: The case.**

<!-- replay: replace server/test/dead-coordinator-lane.test.ts -->
In `server/test/dead-coordinator-lane.test.ts`, find (block 62):

````ts
  });

  it('a revive that lands AFTER the worker was released is recorded: a feed row and an attention entry, though no run was closed', async () => {
    const f: Fixture = await fixture({ onCcd: (args) => { if (args[0] === 'ws-release') f.live.add(A); } });
````

Replace with:

````ts
  });

  it('a HOLD met at the re-measure AFTER the fleet act: the released worker is recorded, the run stays open, the anchor stands — and the next pass ends it (wave 6; wave 5 Task 6’s residual)', async () => {
    let armed = false;
    const f: Fixture = await fixture({ onCcd: (args) => { if (armed && args[0] === 'ws-release') { armed = false; f.advance(20_000); } } });
    f.touch(DEAD_COORDINATOR_LANE_LIVE_MARKER);
    f.plant(A);
    const r = f.working(A, 'alpha');
    await f.pass(); await walk(f, HOUR - 60_000);
    const anchor = f.anchorOf(A);
    armed = true;
    f.next(); await f.pass();
    expect(f.calls.filter((c) => c[0] === 'ws-release'), 'its worker WAS released').toHaveLength(1);
    expect(f.stateOf(r), 'the mirror went stale before the commit: the run stays open').toBe('working');
    expect(f.feed().filter(([, t]) => t.startsWith('dead coordinator: programme'))).toEqual([[A, 'dead coordinator: programme partly ended']]);
    const note = (f.watcher() as unknown as { deadCoordinatorAttentionList: readonly { kind: string; sentence: string }[] }).deadCoordinatorAttentionList;
    expect(note.map((a) => a.kind)).toEqual(['stuck']);
    expect(note[0]!.sentence).toContain(`released the worker of run ${r} of programme alpha`);
    expect(f.anchorOf(A), 'a hold is no evidence: the anchor stands').toMatchObject({ firstDeadAt: (anchor as { firstDeadAt: number }).firstDeadAt });
    f.next(); await f.pass();
    expect(f.stateOf(r), 'the mirror is fresh again: the next pass ends it').toBe('failed');
  });

  it('a revive that lands AFTER the worker was released is recorded: a feed row and an attention entry, though no run was closed', async () => {
    const f: Fixture = await fixture({ onCcd: (args) => { if (args[0] === 'ws-release') f.live.add(A); } });
````

- [ ] **Step 2: Run — green.** Measured: `dead-coordinator-lane.test.ts`: `35 passed (35)`.

- [ ] **Step 3: The mutation rows.**

| Row | Mutation | Red |
|---|---|---|
| T7.1 | `server/src/coord/close.ts`: `fleetAct: release ? 'released' : 're-held' };` → `fleetAct: null };` | lane `2 failed \| 33 passed (35)` — this case and wave 5's "a revive that lands AFTER the worker was released …" |
| T7.2 | `server/src/watch.ts`: `      if (out.kind === 'ended' && out.stoppedBy?.kind === 'remeasured') {` → `      if (out.kind === 'ended' && out.stoppedBy !== null) {` | lane `3 failed \| 32 passed (35)` — this case, Task 6's STALE DURING, wave 5's STALE between the pass and the act |
| T7.3 | `server/src/deadCoordinator.ts`: `stop === 'remeasured' \|\| stop === 'switch' ? 0 : e.crashedPasses;` → `stop !== undefined ? 0 : e.crashedPasses;` | lane `3 failed \| 32 passed (35)` — the same three |

- [ ] **Step 4: Commit.** `test(lifecycle): a hold after the fleet act keeps the hour and records the released worker (wave 6)`.

---

### Task 8: The words say when, and what — the standing cadence, `flock-unavailable`'s halt, the shadow row over a standing entry (ruling F)

**Model routing:** `sonnet`, effort `medium`.

**Files:** `server/src/archivedExpiry.ts`, `server/src/coord/expireArchived.ts`, `server/src/watch.ts`; tests `server/test/archived-expiry-policy.test.ts`, `server/test/archived-expiry-lane.test.ts`, `server/test/expire-archived.test.ts`.

**Interfaces:**
- **The cadence (the residual "asks again every 4 hours is an upper bound").** One phrase, `STANDING_ASKS_AGAIN`, in both standing sentences (the tier's and the stuck one): "The lane asks again 4 hours after each failed attempt — sooner after an answer that ends no attempt, never while the workspace is held —". Measured why: every arm that ends no attempt sets an earlier `nextAskAt` (a deferral or a retry refusal: the next pass; a shadow audit: fifteen minutes; an audit failure: its backoff), and a held row is never due. The departure `a-standing-entry-is-asked-after-each-failed-attempt`.
- **`flock-unavailable`.** `archivedExpiryNextEntry`'s `box` arm answers that word with a FINAL report, `{ kind: 'failing', at, detail, final: true, halted: true }`, and `nextAskAt` +∞ for the row — what the process already does, since `watch.ts` halts every act after it — and the sentence says so: "cleanup stopped: <detail>. The fleet box cannot serialise a cleanup, so the lane composes none there, for any archived workspace, until the server restarts; nothing is deleted meanwhile." A final report stands through a hold. `lock-unopenable` is unchanged (retried). The arm applies only over a row with NO standing entry (`&& !expiryReportStands(entry.report)`): under a stuck entry the stuck arm keeps it (four hours, never +∞ — ruling B), and under a tier entry the tier counts the attempt, as on `main`; the record of a workspace that may be part-cleaned is never replaced. Wherever the row stands, `flock-unavailable`'s feed row — written for every new answer — adds "The lane composes no cleanup on that box, for any archived workspace, until the server restarts." The departure `flock-unavailable-is-final-for-the-row`.
- **The shadow row over a standing entry.** `expireFeedBody(r, standing = false)` and `recordExpireFeed(deps, r, standing = false)`; `watch.ts` passes `expiryReportStands(entry.report)`. With `standing`, a `would-expire` row says "the cleanup is not armed (shadow), so this pass deleted nothing — but an earlier attempt may have stopped part-way, so what is left on disk is not known, and its attention entry stands" — the standing entry's own words — never "nothing was deleted". The departure `a-shadow-row-over-a-standing-entry-says-this-pass`.

- [ ] **Step 1: The tests (red).**

<!-- replay: replace server/test/archived-expiry-lane.test.ts -->
In `server/test/archived-expiry-lane.test.ts`, find (block 63):

````ts
    expect(list.map((a) => [a.sessionId, a.kind])).toEqual([['demo-a', 'failing']]);
    expect(list[0]!.sentence).toContain(`${asked} attempts, the last: worktree-remove-failed: the tree is busy`);
    expect(list[0]!.sentence).toContain('The lane asks again every 4 hours');
    // The operator takes the arming away to look into it: the next act stops at the shadow, and the entry STANDS — never
    // replaced by a "nothing was deleted" said of a workspace that may be part-cleaned.
````

Replace with:

````ts
    expect(list.map((a) => [a.sessionId, a.kind])).toEqual([['demo-a', 'failing']]);
    expect(list[0]!.sentence).toContain(`${asked} attempts, the last: worktree-remove-failed: the tree is busy`);
    expect(list[0]!.sentence).toContain('The lane asks again 4 hours after each failed attempt');
    // The operator takes the arming away to look into it: the next act stops at the shadow, and the entry STANDS — never
    // replaced by a "nothing was deleted" said of a workspace that may be part-cleaned.
````

<!-- replay: replace server/test/archived-expiry-lane.test.ts -->
In `server/test/archived-expiry-lane.test.ts`, find (block 64):

````ts
    expect(f.verbsFor('ws-expire'), 'and composed nothing: shadow').toHaveLength(asked);
    expect(f.entry('demo-a')?.report, 'a shadow audit ends nothing').toMatchObject({ kind: 'failing', attempts: asked });
  });

````

Replace with:

````ts
    expect(f.verbsFor('ws-expire'), 'and composed nothing: shadow').toHaveLength(asked);
    expect(f.entry('demo-a')?.report, 'a shadow audit ends nothing').toMatchObject({ kind: 'failing', attempts: asked });
    const shadow = f.coord.feedEvents(5).find((e) => e.title === 'archived workspace would be cleaned up');
    expect(shadow?.body, 'and its feed row never says nothing was deleted of a workspace that may be part-cleaned (wave 6)')
      .toContain('an earlier attempt may have stopped part-way');
    expect(shadow?.body).not.toContain('nothing was deleted');
  });

````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 65):

````ts
      + `first at 2026-09-21 14:13 UTC, ${attempts} attempts, the last: cannot open the reap lock at /r. It may have stopped part-way — `
      + 'the box does not yet say whether an attempt began its cleanup — so what is left on disk is not known. The lane asks again '
      + 'every 4 hours and keeps this entry until an attempt completes, finds that none had begun or stops for good, or the '
      + 'workspace is archived again.');
    expect(expiryReportSentence(x.report!, null), 'it never suggests a destructive verb').not.toMatch(/ws-reap|ws-rm|ws-expire|delete|remove/);
    // Each later failure updates the entry and keeps the cadence; the first failure's instant stands.
````

Replace with:

````ts
      + `first at 2026-09-21 14:13 UTC, ${attempts} attempts, the last: cannot open the reap lock at /r. It may have stopped part-way — `
      + 'the box does not yet say whether an attempt began its cleanup — so what is left on disk is not known. The lane asks again '
      + '4 hours after each failed attempt — sooner after an answer that ends no attempt, never while the workspace is held — and '
      + 'keeps this entry until an attempt completes, finds that none had begun or stops for good, or the workspace is archived again.');
    expect(expiryReportSentence(x.report!, null), 'it never suggests a destructive verb').not.toMatch(/ws-reap|ws-rm|ws-expire|delete|remove/);
    // Each later failure updates the entry and keeps the cadence; the first failure's instant stands.
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 66):

````ts
  });

  it('in shadow, "would expire" is recorded — and the row is audited again only after the shadow interval', () => {
    const x = archivedExpiryNextEntry(e(), { kind: 'would-expire', sensitive: 2 }, NOW, PASS)!;
````

Replace with:

````ts
  });

  it('flock-unavailable says what it does: the lane composes NO cleanup on that box until the server restarts — never "retried" (wave 6)', () => {
    const detail = 'flock (util-linux) is unavailable — refusing to run the destructive verb unserialised';
    const x = archivedExpiryNextEntry(e(), { kind: 'box', word: 'flock-unavailable', detail }, NOW, PASS)!;
    expect(x.nextAskAt, 'not asked again by this process').toBe(Number.POSITIVE_INFINITY);
    expect(x.report).toEqual({ kind: 'failing', at: NOW, detail, final: true, halted: true });
    const sentence = expiryReportSentence(x.report!, null);
    expect(sentence).toBe(`cleanup stopped: ${detail}. The fleet box cannot serialise a cleanup, so the lane composes none there, `
      + 'for any archived workspace, until the server restarts; nothing is deleted meanwhile.');
    expect(sentence, 'never a promise it breaks').not.toMatch(/retried|backing off/);
    expect(archivedExpirySighted(x, { eligible: false, why: 'held' }, 'h', NOW + PASS).report, 'a hold never hides it').toEqual(x.report);
    const lock = archivedExpiryNextEntry(e(), { kind: 'box', word: 'lock-unopenable', detail: 'cannot open the reap lock at /r' }, NOW, PASS)!;
    expect(lock.report, 'the CONTROL: lock-unopenable is retried, as before').toEqual({ kind: 'failing', at: NOW, detail: 'cannot open the reap lock at /r' });
    expect(lock.nextAskAt).toBeLessThan(Number.POSITIVE_INFINITY);
  });

  it('flock-unavailable under a STANDING entry keeps it: a stuck entry stands, and a tier entry counts the attempt (wave 6, ruling B)', () => {
    const flock = { kind: 'box', word: 'flock-unavailable', detail: 'flock (util-linux) is unavailable' } as const;
    const { x: tier, t } = aDayOf(verbFailed);
    const stuck = archivedExpiryNextEntry(tier, { kind: 'stuck', detail: 'containment-refuted: d' }, t, PASS)!;
    const s = archivedExpiryNextEntry(stuck, flock, t + PASS, PASS)!;
    expect(s.report, 'the stuck entry stands').toEqual(stuck.report);
    expect(s.nextAskAt, 'on its own cadence, never +∞').toBe(t + PASS + EXPIRE_PERSISTENT_RETRY_MS);
    const f = archivedExpiryNextEntry(tier, flock, t + PASS, PASS)!;
    const before = tier.report as { at: number; attempts: number };
    expect(f.report, 'the tier entry stands, the attempt counted').toEqual({ kind: 'failing', at: before.at, detail: flock.detail,
      attempts: before.attempts + 1 });
    expect(f.nextAskAt).toBe(t + PASS + EXPIRE_PERSISTENT_RETRY_MS);
  });

  it('in shadow, "would expire" is recorded — and the row is audited again only after the shadow interval', () => {
    const x = archivedExpiryNextEntry(e(), { kind: 'would-expire', sensitive: 2 }, NOW, PASS)!;
````

<!-- replay: replace server/test/expire-archived.test.ts -->
In `server/test/expire-archived.test.ts`, find (block 67):

````ts
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { expireArchived, recordExpireFeed, type ExpireArchivedDeps } from '../src/coord/expireArchived.js';
import { EXPIRE_LANE_LIVE_MARKER } from '../src/archivedExpiry.js';
import { NotifyLog } from '../src/notifylog.js';
````

Replace with:

````ts
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { expireArchived, expireFeedBody, recordExpireFeed, type ExpireArchivedDeps } from '../src/coord/expireArchived.js';
import { EXPIRE_LANE_LIVE_MARKER } from '../src/archivedExpiry.js';
import { NotifyLog } from '../src/notifylog.js';
````

<!-- replay: replace server/test/expire-archived.test.ts -->
In `server/test/expire-archived.test.ts`, find (block 68):

````ts
  });

  // THE STORE, RE-READ AT THE ACT (child reclamation's executor's shape, `childReclaimOutcome` steps 2 and 2a): the lane
  // read the run conjuncts when its pass began; a run can bind the row while the pass learns other rows' instants, and
````

Replace with:

````ts
  });

  it('a flock-unavailable feed row says the lane composes no cleanup on that box until the server restarts (wave 6)', async () => {
    const flock = 'ccd: flock (util-linux) is unavailable — refusing to run the destructive verb unserialised';
    const s = await rig({ script: { audit: { code: 0, stdout: auditDoc('expirable', { token: TOK }) }, verb: { code: 1, stdout: '', stderr: flock } } });
    const out = await expireArchived(s.deps, s.req);
    expect(out).toMatchObject({ kind: 'box', word: 'flock-unavailable' });
    expect(expireFeedBody(out)).toContain('The lane composes no cleanup on that box, for any archived workspace, until the server restarts.');
    const lock = '/h/.cc-sessions/.reap-demo-quiet-dune.lock';
    const l = await rig({ script: { audit: { code: 0, stdout: auditDoc('expirable', { token: TOK }) },
      verb: { code: 1, stdout: '', stderr: `ccd: cannot open the reap lock at ${lock}` } } });
    expect(expireFeedBody(await expireArchived(l.deps, l.req)), 'the CONTROL: lock-unopenable halts nothing').not.toContain('until the server restarts');
  });

  // THE STORE, RE-READ AT THE ACT (child reclamation's executor's shape, `childReclaimOutcome` steps 2 and 2a): the lane
  // read the run conjuncts when its pass began; a run can bind the row while the pass learns other rows' instants, and
````

<!-- replay: replace server/test/expire-archived.test.ts -->
In `server/test/expire-archived.test.ts`, find (block 69):

````ts
    expect(ev[0]!.body).toContain('nothing was deleted');
    expect(ev[0]!.runId).toBeNull();
  });
});
````

Replace with:

````ts
    expect(ev[0]!.body).toContain('nothing was deleted');
    expect(ev[0]!.runId).toBeNull();
  });

  it('a shadow row over a STANDING entry never says nothing was deleted: an earlier attempt may have stopped part-way (wave 6)', async () => {
    const s = await rig({ live: false });
    const out = await expireArchived(s.deps, s.req);
    expect(out.kind).toBe('would-expire');
    const body = expireFeedBody(out, true);
    expect(body).not.toContain('nothing was deleted');
    expect(body).toContain('the cleanup is not armed (shadow), so this pass deleted nothing — but an earlier attempt may have stopped part-way, '
      + 'so what is left on disk is not known, and its attention entry stands');
    expect(expireFeedBody(out, false), 'the CONTROL: over no standing entry the row says so').toContain('nothing was deleted');
  });
});
````

- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/expire-archived.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-lane.test.ts --maxWorkers=1 )
```

Measured: `archived-expiry-policy.test.ts`: `2 failed | 73 passed (75)` — × a DAY of failures the box called resumable …; × flock-unavailable says what it does …; the new case "flock-unavailable under a STANDING entry keeps it …" is green here (no flock arm yet: the stuck guard and the tier keep the entry) and reds only on T8.6; `expire-archived.test.ts`: `2 failed | 22 passed (24)` — × a flock-unavailable feed row says the lane composes no cleanup on that box …; × a shadow row over a STANDING entry never says nothing was deleted …; `archived-expiry-lane.test.ts`: `1 failed | 37 passed (38)` — × a day of resumable failures on one archive: then the persistent tier ….

- [ ] **Step 3: The source.**

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 70):

````ts
   *  resume — so its sentence never promises a retry. Absent on a failure that is still being retried. */
  | { readonly kind: 'failing'; readonly at: number; readonly detail: string; readonly final?: true;
      /** Set only on the PERSISTENT TIER — a row past `EXPIRE_FAILURE_GIVE_UP_MS` of resumable failures, asked every
       *  `EXPIRE_PERSISTENT_RETRY_MS` — whose report is a STANDING entry: how many attempts failed (`at` is the first
````

Replace with:

````ts
   *  resume — so its sentence never promises a retry. Absent on a failure that is still being retried. */
  | { readonly kind: 'failing'; readonly at: number; readonly detail: string; readonly final?: true;
      /** Set, with `final`, only on `flock-unavailable` over a row with no standing entry (wave 6): the lane then composes
       *  NO cleanup on that box for the rest of this process (`watch.ts`), whatever row, so its sentence says that, and
       *  that a restart is what asks again. */
      readonly halted?: true;
      /** Set only on the PERSISTENT TIER — a row past `EXPIRE_FAILURE_GIVE_UP_MS` of resumable failures, asked every
       *  `EXPIRE_PERSISTENT_RETRY_MS` — whose report is a STANDING entry: how many attempts failed (`at` is the first
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 71):

````ts
          report: { kind: 'failing', at: nowMs, detail: o.detail, final: true } };
      }
      // `flock-unavailable` is the BOX's, and the lane stops asking that box at all (`watch.ts`); for the row it is
      // a failure like `lock-unopenable`, backed off and reported past the ceiling.
      const failures = entry.failures + 1;
      const failingSince = entry.failingSince ?? nowMs;
````

Replace with:

````ts
          report: { kind: 'failing', at: nowMs, detail: o.detail, final: true } };
      }
      // `flock-unavailable` is the BOX's, and the lane stops asking that box at all (`watch.ts`) until the server restarts.
      // So the row says THAT, and is not asked again by this process: a final report, `halted` — never "retried", which the
      // halt would make untrue (wave 6). `lock-unopenable` is a failure, backed off and reported at once. Under a STANDING
      // entry (stuck, or the tier's) the entry stands instead, as under any failure of the verb (ruling B), and the halt is
      // the feed row's to say (`expireFeedBody`): the record of a workspace that may be part-cleaned is never replaced.
      if (o.kind === 'box' && o.word === 'flock-unavailable' && !expiryReportStands(entry.report)) {
        return { ...base, ...steady, nextAskAt: Number.POSITIVE_INFINITY,
          report: { kind: 'failing', at: nowMs, detail: o.detail, final: true, halted: true } };
      }
      const failures = entry.failures + 1;
      const failingSince = entry.failingSince ?? nowMs;
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 72):

````ts
const isoMs = (ms: number): string => iso(Math.floor(ms / 1000));

/** WHAT A PROCESS IS, before anything suggests ending it (the coordinator's ruling (G)): the fleet's own tmux server
 *  is a `tmux: server` too, and ending THAT ends every session on the box. So the sentence names the pid AND its
````

Replace with:

````ts
const isoMs = (ms: number): string => iso(Math.floor(ms / 1000));

/** WHEN A STANDING ENTRY IS ASKED AGAIN, in words that hold (wave 6; the worker's residual from wave 5): the cadence is
 *  the wait after a FAILED attempt. An answer that ends no attempt asks sooner (a deferral, the next pass), and a hold
 *  keeps the row from being asked at all while it stands. (A box that answered flock-unavailable is asked nothing, by
 *  any row, until the server restarts — that row's own report says so.) */
const STANDING_ASKS_AGAIN = `The lane asks again ${EXPIRE_PERSISTENT_RETRY_MS / 3_600_000} hours after each failed attempt — sooner `
  + 'after an answer that ends no attempt, never while the workspace is held —';

/** WHAT A PROCESS IS, before anything suggests ending it (the coordinator's ruling (G)): the fleet's own tmux server
 *  is a `tmux: server` too, and ending THAT ends every session on the box. So the sentence names the pid AND its
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 73):

````ts
        return `cleanup has failed for a day in ways the box said it could resume: the first at ${isoMs(r.at)}, `
          + `${r.attempts} ${r.attempts === 1 ? 'attempt' : 'attempts'}, the last: ${r.detail}. It may have stopped part-way — the box `
          + 'does not yet say whether an attempt began its cleanup — so what is left on disk is not known. The lane asks again '
          + `every ${EXPIRE_PERSISTENT_RETRY_MS / 3_600_000} hours and keeps this entry until an attempt completes, finds `
          + 'that none had begun or stops for good, or the workspace is archived again.';
      }
      return r.final === true ? `cleanup stopped: ${r.detail}. It is not asked again for this archive.`
````

Replace with:

````ts
        return `cleanup has failed for a day in ways the box said it could resume: the first at ${isoMs(r.at)}, `
          + `${r.attempts} ${r.attempts === 1 ? 'attempt' : 'attempts'}, the last: ${r.detail}. It may have stopped part-way — the box `
          + `does not yet say whether an attempt began its cleanup — so what is left on disk is not known. ${STANDING_ASKS_AGAIN} `
          + 'and keeps this entry until an attempt completes, finds that none had begun or stops for good, or the workspace is '
          + 'archived again.';
      }
      if (r.halted === true) {
        return `cleanup stopped: ${r.detail}. The fleet box cannot serialise a cleanup, so the lane composes none there, `
          + 'for any archived workspace, until the server restarts; nothing is deleted meanwhile.';
      }
      return r.final === true ? `cleanup stopped: ${r.detail}. It is not asked again for this archive.`
````

<!-- replay: replace server/src/archivedExpiry.ts -->
In `server/src/archivedExpiry.ts`, find (block 74):

````ts
        + `(first at ${isoMs(r.at)}, ${r.attempts} ${r.attempts === 1 ? 'attempt' : 'attempts'}). The session was stopped and nothing `
        + 'further was deleted; what is left on disk stays as it is, and a retry finds the same thing until that other tree or row '
        + `is moved. The lane asks again every ${EXPIRE_PERSISTENT_RETRY_MS / 3_600_000} hours and keeps this entry until an attempt `
        + 'completes or the workspace is archived again.';
    case 'kept':
      return `cleaned up, but ccd kept ${expireKeptParts(r).join(' and ')}. The worktree, the branch and the registry row are `
````

Replace with:

````ts
        + `(first at ${isoMs(r.at)}, ${r.attempts} ${r.attempts === 1 ? 'attempt' : 'attempts'}). The session was stopped and nothing `
        + 'further was deleted; what is left on disk stays as it is, and a retry finds the same thing until that other tree or row '
        + `is moved. ${STANDING_ASKS_AGAIN} and keeps this entry until an attempt completes or the workspace is archived again.`;
    case 'kept':
      return `cleaned up, but ccd kept ${expireKeptParts(r).join(' and ')}. The worktree, the branch and the registry row are `
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find (block 75):

````ts
};

/** The feed row's words: what happened, to which archive, and when it was due. */
export function expireFeedBody(r: ExpireArchivedResult): string {
  const who = `${r.sessionId} (archived ${iso(r.archivedAt)}, due ${iso(r.expiresAt)})`;
  switch (r.kind) {
````

Replace with:

````ts
};

/** The feed row's words: what happened, to which archive, and when it was due. `standing`: the row's attention entry
 *  STANDS (`expiryReportStands`) — an earlier attempt may have stopped part-way — so a shadow row over it never says that
 *  nothing was deleted, only that THIS pass deleted nothing (wave 6; the standing entry's own words). */
export function expireFeedBody(r: ExpireArchivedResult, standing = false): string {
  const who = `${r.sessionId} (archived ${iso(r.archivedAt)}, due ${iso(r.expiresAt)})`;
  switch (r.kind) {
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find (block 76):

````ts
    }
    case 'would-expire':
      return `${who} would be cleaned up now — the cleanup is not armed (shadow), so nothing was deleted`
        + `${r.sensitive > 0 ? `; ${r.sensitive} secret-shaped ${r.sensitive === 1 ? 'file' : 'files'} would be dropped` : ''}.`;
    case 'deferred': return `${who}: deferred (${r.why}) — ${r.detail}.`;
````

Replace with:

````ts
    }
    case 'would-expire':
      return `${who} would be cleaned up now — the cleanup is not armed (shadow), so `
        + `${standing ? 'this pass deleted nothing — but an earlier attempt may have stopped part-way, so what is left on disk is '
          + 'not known, and its attention entry stands' : 'nothing was deleted'}`
        + `${r.sensitive > 0 ? `; ${r.sensitive} secret-shaped ${r.sensitive === 1 ? 'file' : 'files'} would be dropped` : ''}.`;
    case 'deferred': return `${who}: deferred (${r.why}) — ${r.detail}.`;
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find (block 77):

````ts
      + `deleted. It is listed at once, and asked again ${EXPIRE_PERSISTENT_RETRY_MS / 3_600_000} hours after each failed attempt, `
      + 'until an attempt completes or the workspace is archived again.';
    case 'box': return `${who}: the fleet box refused before it started (${r.word}) — ${r.detail}.`;
    case 'composition': return `${who}: ccd rejected the call this server composed — ${r.detail}. It is not retried.`;
    case 'no-evidence': return `${who}: the fleet box's ccd does not say when this archive expires; nothing was composed.`;
````

Replace with:

````ts
      + `deleted. It is listed at once, and asked again ${EXPIRE_PERSISTENT_RETRY_MS / 3_600_000} hours after each failed attempt, `
      + 'until an attempt completes or the workspace is archived again.';
    // `flock-unavailable` halts the lane on that box until the server restarts (`watch.ts`): the row says so, whatever the
    // row's own attention entry says (a standing one stands through it; wave 6).
    case 'box': return `${who}: the fleet box refused before it started (${r.word}) — ${r.detail}.` + (r.word === 'flock-unavailable'
      ? ' The lane composes no cleanup on that box, for any archived workspace, until the server restarts.' : '');
    case 'composition': return `${who}: ccd rejected the call this server composed — ${r.detail}. It is not retried.`;
    case 'no-evidence': return `${who}: the fleet box's ccd does not say when this archive expires; nothing was composed.`;
````

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find (block 78):

````ts
 *  stands is one row, not one a minute. `kind: 'run'` with no run: recorded, never pushed, in the unfiltered feed.
 *  A missing log degrades the record and never the act. */
export function recordExpireFeed(deps: Pick<ExpireArchivedDeps, 'coord' | 'notifyLog'>, r: ExpireArchivedResult): void {
  const log = deps.notifyLog;
  if (!log) return;
  try {
    const ev = log.record({ kind: 'run', sessionId: r.sessionId, runId: null, title: FEED_TITLE[r.kind], body: expireFeedBody(r) });
    deps.coord.recordFeedEvent(log.epoch, ev);
  } catch (err) {
````

Replace with:

````ts
 *  stands is one row, not one a minute. `kind: 'run'` with no run: recorded, never pushed, in the unfiltered feed.
 *  A missing log degrades the record and never the act. */
export function recordExpireFeed(deps: Pick<ExpireArchivedDeps, 'coord' | 'notifyLog'>, r: ExpireArchivedResult, standing = false): void {
  const log = deps.notifyLog;
  if (!log) return;
  try {
    const ev = log.record({ kind: 'run', sessionId: r.sessionId, runId: null, title: FEED_TITLE[r.kind], body: expireFeedBody(r, standing) });
    deps.coord.recordFeedEvent(log.epoch, ev);
  } catch (err) {
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find (block 79):

````ts
import {
  EXPIRE_AUDITS_PER_PASS, archivedExpiryDue, archivedExpiryEntryFor, archivedExpiryLearned, archivedExpiryNextEntry,
  archivedExpiryOutcomeKey, archivedExpirySighted, archivedExpiryVerdict, expiryAttention,
  type ArchivedExpiryEntry, type ExpiryStoreRead,
} from './archivedExpiry.js';
````

Replace with:

````ts
import {
  EXPIRE_AUDITS_PER_PASS, archivedExpiryDue, archivedExpiryEntryFor, archivedExpiryLearned, archivedExpiryNextEntry,
  archivedExpiryOutcomeKey, archivedExpirySighted, archivedExpiryVerdict, expiryAttention, expiryReportStands,
  type ArchivedExpiryEntry, type ExpiryStoreRead,
} from './archivedExpiry.js';
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find (block 80):

````ts
        }, { sessionId: id, archivedAt: entry.archivedAt, expiresAt: entry.expiresAt! }));
        if (result.kind === 'box' && result.word === 'flock-unavailable') this.archivedExpiryBoxRefused = result.detail;
        if (archivedExpiryOutcomeKey(result) !== entry.lastOutcome) recordExpireFeed({ coord, notifyLog: this.deps.notifyLog }, result);
        const next = archivedExpiryNextEntry(entry, result, Date.now(), CHILD_RECLAIM_SWEEP_MS);
        if (next === null) this.archivedExpiryState.delete(id); else this.archivedExpiryState.set(id, next);
````

Replace with:

````ts
        }, { sessionId: id, archivedAt: entry.archivedAt, expiresAt: entry.expiresAt! }));
        if (result.kind === 'box' && result.word === 'flock-unavailable') this.archivedExpiryBoxRefused = result.detail;
        // Whether the row's entry STANDS rides the feed row, so a shadow row over it never says nothing was deleted (wave 6).
        if (archivedExpiryOutcomeKey(result) !== entry.lastOutcome) {
          recordExpireFeed({ coord, notifyLog: this.deps.notifyLog }, result, expiryReportStands(entry.report));
        }
        const next = archivedExpiryNextEntry(entry, result, Date.now(), CHILD_RECLAIM_SWEEP_MS);
        if (next === null) this.archivedExpiryState.delete(id); else this.archivedExpiryState.set(id, next);
````

- [ ] **Step 4: Run — green.** Measured: `archived-expiry-policy` `75 passed (75)`; `expire-archived` `24 passed (24)`; `archived-expiry-lane` `38 passed (38)`; server `tsc` rc 0.

- [ ] **Step 5: The mutation rows.**

| Row | Mutation | Red |
|---|---|---|
| T8.1 | `archivedExpiry.ts`: `      if (o.kind === 'box' && o.word === 'flock-unavailable' && !expiryReportStands(entry.report)) {` → `      if (false) {` | policy `1 failed \| 74 passed (75)` (flock-unavailable says what it does …); lane `38 passed (38)` |
| T8.2 | `archivedExpiry.ts`: `      if (r.halted === true) {` → `      if (false) {` | policy `1 failed \| 74 passed (75)` |
| T8.3 | `watch.ts`: `result, expiryReportStands(entry.report));` → `result, false);` | lane `1 failed \| 37 passed (38)` (the persistent-tier case's shadow row) |
| T8.4 | `expireArchived.ts`: ``+ `${standing ? `` → ``+ `${false ? `` | expire-archived `1 failed \| 23 passed (24)`; lane `1 failed \| 37 passed (38)` |
| T8.5 | `archivedExpiry.ts`: ``hours after each failed attempt — sooner ` `` → ``hours, every time — sooner ` `` | policy `1 failed \| 74 passed (75)` (the DAY case's sentence); lane `1 failed \| 37 passed (38)` |
| T8.6 | `archivedExpiry.ts`: ` && !expiryReportStands(entry.report)) {` → `) {` (the halt replaces a standing entry) | policy `1 failed \| 74 passed (75)` — × flock-unavailable under a STANDING entry keeps it … |
| T8.7 | `expireArchived.ts`: `(r.word === 'flock-unavailable'` → `(false` | expire-archived `1 failed \| 23 passed (24)` — × a flock-unavailable feed row says the lane composes no cleanup on that box … |

- [ ] **Step 6: Commit.** `fix(lifecycle): the expiry lane's words say when it asks, that flock-unavailable halts it, and never "nothing was deleted" over a standing entry (wave 6)`.

---

### Task 9: The census bounds the expiry's `state-changed` producer at `_ws_tombstone` (ruling F; wave 5 Task 8's residual)

**Model routing:** `sonnet`, effort `low`.

**Files:** test `server/test/archived-expiry-policy.test.ts` (THE CENSUS). No source change.

**Interfaces:** the census finds `tombAt = ccd.indexOf('_ws_tombstone "$id"', freshAt)`, asserts `freshAt < tombAt < crumbAt`, and holds `_ws_expire_locked`'s `failed` `state-changed` below `tombAt` (it was `crumbAt`). Its comment also stops calling the resumed `probe-unmeasured` a known gap (Task 1 closed it), and its title names the bound it checks: "… on its FRESH arm, before the tombstone (wave 5; bounded at the tombstone since wave 6)". No `-t` filter in this plan quotes the old title. The departure `the-census-bounds-at-the-tombstone`.

- [ ] **Step 1: The edit.**

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 81):

````ts
  });

  it('THE CENSUS: every site of either word in ccd/ccd is placed, and the expiry’s failed state-changed is on its FRESH arm, before the breadcrumb (wave 5)', () => {
    // A STOPPING LINE, not a spelling. EVERY non-comment occurrence of either word anywhere in ccd/ccd is placed: by the
    // function that holds it, and by what the line does with it — `failed` (`_ws_reclaim_fail "<id>" "<lctx>" <word>`
````

Replace with:

````ts
  });

  it('THE CENSUS: every site of either word in ccd/ccd is placed, and the expiry’s failed state-changed is on its FRESH arm, before the tombstone (wave 5; bounded at the tombstone since wave 6)', () => {
    // A STOPPING LINE, not a spelling. EVERY non-comment occurrence of either word anywhere in ccd/ccd is placed: by the
    // function that holds it, and by what the line does with it — `failed` (`_ws_reclaim_fail "<id>" "<lctx>" <word>`
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 82):

````ts
    // from parts; ccd has none. `_ws_reclaim_locked` is ws-reclaim's own verb, which an expiry never reaches.
    //   `_ws_expire_locked`'s failed `state-changed` must lie on its FRESH arm — after `if [[ -z "$phase" ]]` and
    // before the `expire:` breadcrumb write — so nothing this verb started stands when it prints. Its
    // `probe-unmeasured` prints at the verdict point, on EVERY arm: on a fresh expiry before anything, and on a
    // RESUMED one after an earlier attempt's breadcrumb (`_ws_expire_resume_eval`'s unmeasured exits). That is main's
    // reading, a known gap routed to this programme's wave 6 (an arming blocker until then), and this census records it
    // rather than hides it.
    //   THE COLLECTOR'S OWN FAMILY (child reclamation spec §5.10). Every site inside the COLLECT region is placed in
    // its own list, held exactly as the one above is: `ws-collect` journals both words through the shared tail's
````

Replace with:

````ts
    // from parts; ccd has none. `_ws_reclaim_locked` is ws-reclaim's own verb, which an expiry never reaches.
    //   `_ws_expire_locked`'s failed `state-changed` must lie on its FRESH arm — after `if [[ -z "$phase" ]]` and
    // before the tombstone write, `_ws_tombstone`, which the `expire:` breadcrumb follows (the bound is the tombstone
    // since wave 6, where wave 5 drew it at the breadcrumb) — so nothing this verb started stands when it prints. Its
    // `probe-unmeasured` prints at the verdict point, on EVERY arm: on a fresh expiry before anything, and on a
    // RESUMED one after an earlier attempt's breadcrumb (`_ws_expire_resume_eval`'s unmeasured exits). The word alone
    // cannot tell those apart, which is why ccd says `crumb` there since wave 6 (`true` on the resumed arm) and the
    // server reads it first; this census still records the word's two arms rather than hides them.
    //   THE COLLECTOR'S OWN FAMILY (child reclamation spec §5.10). Every site inside the COLLECT region is placed in
    // its own list, held exactly as the one above is: `ws-collect` journals both words through the shared tail's
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 83):

````ts
    const freshAt = ccd.indexOf('\n  if [[ -z "$phase" ]]; then', lockedAt);
    const crumbAt = ccd.indexOf('_reg_set "$id" reaping "expire:$start"', lockedAt);
    expect(lockedAt, 'the expiry\'s locked body').toBeGreaterThan(-1);
    expect(freshAt, 'its fresh arm').toBeGreaterThan(lockedAt);
    expect(crumbAt, 'its breadcrumb write, on that arm').toBeGreaterThan(freshAt);
    const collectBegin = ccd.indexOf('COLLECT-BEGIN');
    const collectEnd = ccd.indexOf('COLLECT-END');
````

Replace with:

````ts
    const freshAt = ccd.indexOf('\n  if [[ -z "$phase" ]]; then', lockedAt);
    const crumbAt = ccd.indexOf('_reg_set "$id" reaping "expire:$start"', lockedAt);
    const tombAt = ccd.indexOf('_ws_tombstone "$id"', freshAt);
    expect(lockedAt, 'the expiry\'s locked body').toBeGreaterThan(-1);
    expect(freshAt, 'its fresh arm').toBeGreaterThan(lockedAt);
    expect(tombAt, 'its tombstone write, on that arm').toBeGreaterThan(freshAt);
    expect(crumbAt, 'its breadcrumb write, after the tombstone').toBeGreaterThan(tombAt);
    const collectBegin = ccd.indexOf('COLLECT-BEGIN');
    const collectEnd = ccd.indexOf('COLLECT-END');
````

<!-- replay: replace server/test/archived-expiry-policy.test.ts -->
In `server/test/archived-expiry-policy.test.ts`, find (block 84):

````ts
          if (fn === '_ws_expire_locked' && kind === 'failed' && w === 'state-changed') {
            expect(where, 'state-changed in _ws_expire_locked is not on its fresh arm').toBeGreaterThan(freshAt);
            expect(where, 'state-changed in _ws_expire_locked prints after the breadcrumb').toBeLessThan(crumbAt);
          }
          (inCollect(where) ? collected : placed).push(`${fn} ${kind} ${w}`);
````

Replace with:

````ts
          if (fn === '_ws_expire_locked' && kind === 'failed' && w === 'state-changed') {
            expect(where, 'state-changed in _ws_expire_locked is not on its fresh arm').toBeGreaterThan(freshAt);
            expect(where, 'state-changed in _ws_expire_locked prints after the tombstone').toBeLessThan(tombAt);
          }
          (inCollect(where) ? collected : placed).push(`${fn} ${kind} ${w}`);
````

- [ ] **Step 2: Run — green.** Measured: `archived-expiry-policy.test.ts`: `75 passed (75)`.

- [ ] **Step 3: The mutation row.** Two `ccd/ccd` edits inside `_ws_expire_locked`, applied together: the consent check's producer word `state-changed` → `x-moved` (its line and the next, `        "$REAP_BRANCH read $lbstate when …`, quoted together: the first alone also stands in `_ws_reclaim_locked`), and below `    _ws_tombstone "$id" "$clips" "$(_ws_reclaim_tomb_fields "$EXPIRE_ARCHIVED_AT" "$RECLAIM_WORKTREE")" >/dev/null` a new line `    [[ "$RECLAIM_BRANCHSTATE" != "$lbstate" ]] && { _ws_reclaim_fail "$id" "$lctx" state-changed "moved after the tombstone"; return 1; }`. Re-stamp.

| Row | Mutation | Red |
|---|---|---|
| T9.1 | the two edits above (a producer between the tombstone and the breadcrumb) | `archived-expiry-policy.test.ts`: `1 failed \| 74 passed (75)` — THE CENSUS … before the tombstone … (`state-changed in _ws_expire_locked prints after the tombstone: expected 2037070 to be less than 2036876`); against the census before this task, `75 passed (75)`: the survivor, measured |

Restore and re-stamp.

- [ ] **Step 4: Commit.** `test(lifecycle): the census holds the expiry's state-changed before the tombstone, not only the breadcrumb (wave 6)`.

---

### Task 10: Rung 8 and 4458, measured — nothing owed (rulings G and H)

**Model routing:** `haiku`, effort `low` — read-only checks; no edit.

**Files:** none.

- [ ] **Step 1: Rung 8 (ruling G).** Run the grep below; it prints nothing that pins a terminal `no-worktree-record`, or a blank head, for an admin `gitdir` naming no path on the expiry lane (the spec's §5.3 ladder sentence names `no-worktree-record (terminal)` for a record that is truly absent, which stays right). Then run CCR-15's pin of the ccd side.

```bash
git grep -n "gitdir\|no-worktree-record\|head=''" -- server/test/archived-expiry-policy.test.ts server/test/archived-expiry-lane.test.ts server/test/expire-archived.test.ts server/test/expiry-lane-prose.test.ts server/test/ws-expire-prose.test.ts README.md docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-silent-omission.test.ts --maxWorkers=1 -t 'ws-expire runs the same ladder' )
```

Measured: the grep prints only the spec's §5.3 ladder line and README's CCR-15 paragraph ("`no-worktree-record` becomes a retried unmeasured answer when an entry could not be read"), both true; the suite's expiry describe green.

- [ ] **Step 2: 4458 (ruling H).** `grep -n '_ws_dir_physical "$parent" && preal="$_WS_PHYS"' ccd/ccd` names one line, in `_ws_expire_cwd_users`. Mutate it to `  preal=$(cd -- "$parent" 2>/dev/null && pwd -P) \`, re-stamp, run `ccd-leaf-root-newline.test.ts`, restore, re-stamp.

| Row | Mutation | Red |
|---|---|---|
| T10.1 | `ccd/ccd` (`_ws_expire_cwd_users`): `  _ws_dir_physical "$parent" && preal="$_WS_PHYS" \` → `  preal=$(cd -- "$parent" 2>/dev/null && pwd -P) \` | `ccd-leaf-root-newline.test.ts`: `2 failed \| 11 passed (13)` — × a FAKE process table on any host: a cwd in the real worktree under a parent resolving to `vol\n` is unmeasured …; × a LIVE process of this uid … (`expected '0' to be '1'`) |

- [ ] **Step 3: Record both in the PR body** (no commit).

---

### Task 11: The close-out words — §5.3, §5.4, a new §12 "Before arming", and README (ruling I)

**Model routing:** `sonnet`, effort `medium`.

**Files:** `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, `README.md`; tests `server/test/expiry-lane-prose.test.ts`, `server/test/dead-coordinator-prose.test.ts` (run 354's claims: claim each, or ask for a region split).

**README's size ratchet.** `pools-prose.test.ts` holds CLAUDE.md's README size claim (`~5900 lines` on `main`) within 100 lines of README's real length, and `main`'s README is 5994 lines. This task's README blocks add four lines (5998), measured green; a drafted version adding eight lines (6002) went red there (`CLAUDE.md says 5900 lines, README.md is 6002 … expected 102 to be less than or equal to 100`, shard 10 of the full run). If `main`'s README has grown when this task runs, re-measure: a red there is fixed by re-measuring CLAUDE.md's figure in this commit (CLAUDE.md is run 354's claim: claim it, or ask its holder), never by trimming the words below what the spec says.

**Interfaces:** §5.3 gains "As wave 6 closes the lane" (four items), and three wave-5 sentences wave 6 makes untrue are corrected in place (the attached HEAD's `pin-failed` "which is resumable"; the known gap "routed to wave 6 … an arming blocker until then"; "asks again every four hours"). §5.4 gains "As wave 6 closes the lane" (the re-read; a hold after the fleet act). A new final section, **§12 Before arming**, gathers per lane every fact the operator should know before creating each live file — collected from the ledger's Next-wave brief arming bullets, the dead-coordinator lane's three early reads and what Task 6 closes, open items 1 and 3 of the 10-08 12:02 entry, the permanently unreadable generation that pins the mirror stale, #326's facts about a branch already gone — the Next-wave brief's post-deploy check (the feed shows the dead-coordinator lane's shadow rows), the ruled arming order with its preconditions (each lane's shadow list read; any breaker trip worked through), pre-arming item (d) (a leaked test tmux server in one archived tree, named generically), wave 4's accepted journal-gap trade, the residual of question (k) (an unreadable breadcrumb: Task 1's argued keyless document, final until a restart), that a fresh `probe-unmeasured` is now audited afresh rather than final, and the one write-error residual Task 6 leaves — and the operator questions still open: (b), (f), (g), (i), (j) and wave 2's three. §5.3's wave-5 parenthetical that a shadow row's "nothing was deleted" is about that audit alone becomes "its feed row then says only that this pass deleted nothing" (Task 8 made the old one false); §5.4's wave-6 bullet says what the write-error count re-read closes and what stays. Words only; it arms nothing (the departure `before-arming-is-section-12`). README's operator sentences follow the spec where they state the same facts.

- [ ] **Step 1: The prose pins (red).**

<!-- replay: replace server/test/dead-coordinator-prose.test.ts -->
In `server/test/dead-coordinator-prose.test.ts`, find (block 85):

````ts
      '**A mirror gone stale at the act is a hold.**', '**An accepted abstention.**']) expect(s).toContain(item);
  });
  it('README says a stale mirror at the act keeps the hour, and every failed act is recorded (wave 5)', () => {
    expect(flat('README.md')).toContain('A mirror that goes stale between the pass and the act stops the act and keeps the hour, and every act that fails writes a feed row, whatever it had done.');
````

Replace with:

````ts
      '**A mirror gone stale at the act is a hold.**', '**An accepted abstention.**']) expect(s).toContain(item);
  });
  it('§5.4 records wave 6: the journal’s trust read again after the claimant’s measure, and a hold after the fleet act', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    const w6 = s.slice(s.indexOf('**As wave 6 closes the lane** (each a departure named in the wave-6 plan', s.indexOf('### 5.4 Stage 4')),
      s.indexOf('## 6. What this changes outside itself'));
    for (const item of ['**The journal\'s trust is read again after the claimant\'s measure.**',
      'with nothing awaited between that read and the commit, so the revive window stays the measure\'s own round trip',
      'a failure counted during the measure where the early read saw none makes it unknown, and the claimant unmeasured',
      'A further failure on top of one already counted is not seen before the commit.', '**A hold met after the fleet act is recorded.**'])
      expect(w6).toContain(item);
  });
  it('§12 says what to know before arming the dead-coordinator lane: the early reads, the residuals, the stale mirror', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    const b = s.slice(s.indexOf('## 12. Before arming'));
    for (const item of ['**The dead-coordinator lane (`$REG/dead-coordinator-lane-live`).**',
      '**Arm it after the expiry lane**, once its own shadow list is read and any breaker trip is worked through.',
      '**The three early reads, and what wave 6 closes.**', 'One thing stays early', 'is not seen before the commit',
      '**The journal-gap trade.**', 'stays listed as unmeasured, never ended, until it spawns again', 'Ageing a gap out is carried',
      '**Two residuals stand.**', 'A lane gap of over ten minutes re-anchors every crashed coordinator on the same pass',
      'sub-second to one agent round trip, can still lose its runs', '**A permanently unreadable generation pins the mirror `stale`**',
      '(f) Should a new run under an abandoned programme return its row to active?',
      '(g) A stale mirror at the act keeps the run of crashed passes']) expect(b).toContain(item);
  });
  it('README says the act reads the mirror again after it measures the coordinator (wave 6)', () => {
    expect(flat('README.md')).toContain('A mirror gone stale, or a gap recorded, while the act measures the coordinator stops it too: the act reads both again after it.');
  });
  it('README says a stale mirror at the act keeps the hour, and every failed act is recorded (wave 5)', () => {
    expect(flat('README.md')).toContain('A mirror that goes stale between the pass and the act stops the act and keeps the hour, and every act that fails writes a feed row, whatever it had done.');
````

<!-- replay: replace server/test/expiry-lane-prose.test.ts -->
In `server/test/expiry-lane-prose.test.ts`, find (block 86):

````ts
    expect(para).toContain('a fleet box whose ccd predates that report says so in the feed row only');
    // Listed from the ladder's hour (a box answer at once); the day is when it STANDS (review 355, F6).
    expect(para).toContain('is listed after an hour (a box answer at once) and retried, backing off; after a day it becomes a standing entry, with the first failure, the attempts and the last error, asked again every four hours, never stopping.');
    expect(para).not.toContain('is retried, backing off, for a day;');
    expect(para).toContain('The entry stays through a hold, a shadow audit or any other answer that ends no attempt, until an attempt completes, finds that none had begun or stops for good, or the workspace is archived again');
    expect(para).not.toContain('stops asking for that archive');
  });
  it('the coordinator’s own workspace: by a human — or, with no child marker, by the server seven days after its archive', () => {
````

Replace with:

````ts
    expect(para).toContain('a fleet box whose ccd predates that report says so in the feed row only');
    // Listed from the ladder's hour (a box answer at once); the day is when it STANDS (review 355, F6).
    expect(para).toContain('is listed after an hour (a box answer at once) and retried, backing off; after a day it becomes a standing entry, with the first failure, the attempts and the last error, asked again four hours after each failed attempt (sooner after an answer that ends no attempt), never stopping.');
    expect(para).not.toContain('is retried, backing off, for a day;');
    expect(para).toContain('The entry stays through a hold, a shadow audit or any other answer that ends no attempt, until an attempt completes, finds that none had begun or stops for good, or the workspace is archived again');
    expect(para).not.toContain('stops asking for that archive');
  });
  it('says a stuck cleanup is listed at once, a cleanup that never began is audited afresh and counted, and a box with no flock halts the lane (wave 6)', () => {
    const at = readme.indexOf('**Archived workspaces are cleaned up after seven days**');
    const para = readme.slice(at, at + 5200);
    expect(para).toContain('One that met `containment-refuted` is listed at once on that cadence;');
    expect(para).toContain('one ccd stopped before it began is audited afresh, and listed after an hour if that recurs;');
    expect(para).toContain('a box with no `flock` gets no cleanup at all until the server restarts.');
    expect(para).toContain('The spec\'s §12 lists what to know before arming this lane or the next.');
    expect(para).not.toContain('asked again every four hours');
  });
  it('README says ws-expire’s own documents carry crumb since wave 6 — never that they omit it', () => {
    expect(readme).toContain('every `ws-collect` document; `ws-expire` says it too since workspace lifecycle wave 6)');
    expect(readme).not.toContain('`ws-expire`\'s own pre-breadcrumb documents, its resumed arm\'s `probe-unmeasured`, every `ws-collect` document');
  });
  it('the coordinator’s own workspace: by a human — or, with no child marker, by the server seven days after its archive', () => {
````

<!-- replay: replace server/test/expiry-lane-prose.test.ts -->
In `server/test/expiry-lane-prose.test.ts`, find (block 87):

````ts
      '**A day of resumable failures slows the asking.**', 'A branch already absent when the token was minted reads absent twice and expires with its work in the attic',
      'An absent key (an older ccd) is recorded in the feed row as unmeasured and lists nothing',
      'mints a fresh token over what stands', 'The lane asks again every four hours, never stopping',
      'No answer that ends no attempt replaces the entry or resets its run', 'finds that none had begun',
      // The attached shape is the pin's to refuse (review 355, F2), and the tier's clock is the verb's alone (F3).
      'With HEAD symbolic to `ws/<slug>`, a branch deleted inside the lock is refused earlier, at the pin, as `pin-failed`, which is resumable',
      "A failure of the act's own audit never reaches the persistent tier, only the verb's does"]) expect(s).toContain(item);
    for (const gone of ['is final.**', 'stops the asking.**', 'The lane does not ask again until the archive changes',
      '(a branch deleted, or made, in between)']) expect(s).not.toContain(gone);
  });
});
````

Replace with:

````ts
      '**A day of resumable failures slows the asking.**', 'A branch already absent when the token was minted reads absent twice and expires with its work in the attic',
      'An absent key (an older ccd) is recorded in the feed row as unmeasured and lists nothing',
      'mints a fresh token over what stands', 'The lane asks again four hours after each failed attempt, never stopping',
      'No answer that ends no attempt replaces the entry or resets its run', 'finds that none had begun',
      // The attached shape is the pin's to refuse (review 355, F2), and the tier's clock is the verb's alone (F3).
      'With HEAD symbolic to `ws/<slug>`, a branch deleted inside the lock is refused earlier, at the pin, as `pin-failed`, before the breadcrumb: resumable on a ccd older than wave 6, audited afresh since (below)',
      "A failure of the act's own audit never reaches the persistent tier, only the verb's does"]) expect(s).toContain(item);
    for (const gone of ['is final.**', 'stops the asking.**', 'The lane does not ask again until the archive changes',
      '(a branch deleted, or made, in between)', 'The lane asks again every four hours', 'and an arming blocker for the lane until then',
      'its feed row\'s "nothing was deleted" is about that audit alone']) expect(s).not.toContain(gone);
  });
  it('§5.3 records wave 6: ws-expire says crumb and the lane reads it first, containment-refuted is stuck, a recurring restart is counted, and the words say when', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    const w6 = s.slice(s.indexOf('- **As wave 6 closes the lane**'), s.indexOf('### 5.4 Stage 4'));
    expect(w6.length, 'the wave-6 bullet sits in §5.3').toBeGreaterThan(100);
    for (const item of ['**`ws-expire` says `crumb`, and the lane reads it first.**', '**`containment-refuted` is stuck.**',
      '**A restart that recurs is counted.**', '**The words say when.**',
      'The parser reads the word, then `crumb`: `false` is audited afresh, `true` is resumed, and an absent or non-boolean `crumb` (an older ccd) falls back to the word rule above, exactly',
      'goes straight to the persistent tier', 'a terminal verdict still outranks it', 'On the wire it is a `failing` entry: no new word',
      'It never reaches the persistent tier, since nothing it started stands',
      'gets no cleanup composed at all, for any workspace, until the server restarts', 'it never says nothing was deleted']) expect(w6).toContain(item);
  });
  it('§12 says what to know before arming the expiry lane, and the questions still open', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    const at = s.indexOf('## 12. Before arming');
    expect(at, '§12 is there').toBeGreaterThan(-1);
    const b = s.slice(at);
    for (const item of ['Nothing in this tree arms either lane, and nothing writes either live file',
      '**Deploy first, the fleet box first.**', '**Their memory is in memory.**', '**The expiry lane (`$REG/expire-lane-live`).**',
      '**Its arming blockers are closed.**', '`_ws_expire_cwd_users` resolves its parent through `_ws_dir_physical`',
      '**A branch already gone now expires.**', 'its ignored and secret-shaped files go with the tree',
      '**A branch deleted or made inside the lock stops the act**', 'never `no-worktree-record`',
      '**`flock-unavailable` halts the lane**', '**The first armed pass faces the backlog**',
      '**The recommended order.**', 'Arm the expiry lane first, once this release is deployed and its shadow list has been read',
      'after its own shadow list has been read and any breaker trip worked through',
      'the feed shows the dead-coordinator lane\'s shadow rows', 'and a fresh one\'s is audited afresh, counted',
      '**One residual of question (k).**', 'leaves `crumb` unsaid, as on the reclaim side, so that `probe-unmeasured` is read by its word',
      '**One archived tree holds a leaked test tmux server**', 'unless a standing entry stands there',
      '**Questions still open**', '(b) The archive-confirm copy', '(i) A kept-leaf entry lives until a server restart',
      '(j) `ws-expire` refuses a branch made inside the lock as well as one deleted', 'Wave 2\'s three:']) expect(b).toContain(item);
    expect(b, 'never a destructive verb as advice').not.toMatch(/run `ccd ws-(reap|expire|reclaim|rm)/);
  });
});
````

- [ ] **Step 2: Run — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/expiry-lane-prose.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/dead-coordinator-prose.test.ts --maxWorkers=1 )
```

Measured: `expiry-lane-prose.test.ts`: `6 failed | 8 passed (14)` — × says a kept leaf is listed … (wave 5); × says a stuck cleanup is listed at once …; × README says ws-expire’s own documents carry crumb since wave 6 …; × §5.3 records wave 5’s follow-ups …; × §5.3 records wave 6 …; × §12 says what to know before arming the expiry lane …; `dead-coordinator-prose.test.ts`: `3 failed | 12 passed (15)` — × §5.4 records wave 6 …; × §12 says what to know before arming the dead-coordinator lane …; × README says the act reads the mirror again ….

- [ ] **Step 3: The words.**

<!-- replay: replace README.md -->
In `README.md`, find (block 88):

````markdown
the feed row only. A cleanup the box keeps failing in a way it says it can resume is listed after an hour (a box answer at
once) and retried, backing off; after a day it becomes a standing entry, with the first failure, the attempts and the last
error, asked again every four hours, never stopping. The entry stays through a hold, a shadow audit or any other answer that
ends no attempt, until an attempt completes, finds that none had begun or stops for good, or the workspace is archived again.

**A coordinator that crashed is ended after an hour** (workspace lifecycle spec §5.4). A coordinator whose pane is
````

Replace with:

````markdown
the feed row only. A cleanup the box keeps failing in a way it says it can resume is listed after an hour (a box answer at
once) and retried, backing off; after a day it becomes a standing entry, with the first failure, the attempts and the last
error, asked again four hours after each failed attempt (sooner after an answer that ends no attempt), never stopping. The
entry stays through a hold, a shadow audit or any other answer that ends no attempt, until an attempt completes, finds that
none had begun or stops for good, or the workspace is archived again. One that met `containment-refuted` is listed at once on
that cadence; one ccd stopped before it began is audited afresh, and listed after an hour if that recurs; a box with no
`flock` gets no cleanup at all until the server restarts. The spec's §12 lists what to know before arming this lane or the next.

**A coordinator that crashed is ended after an hour** (workspace lifecycle spec §5.4). A coordinator whose pane is
````

<!-- replay: replace README.md -->
In `README.md`, find (block 89):

````markdown
naming the coordinator — are the notifications, and this lane's rows (each with the instant the coordinator was first
seen dead, and one when the breaker trips) are records of the same incident. A mirror that goes stale between the pass
and the act stops the act and keeps the hour, and every act that fails writes a feed row, whatever it had done.

**What a crossing costs.** Caps stay global: one row, whole box, no per-project
````

Replace with:

````markdown
naming the coordinator — are the notifications, and this lane's rows (each with the instant the coordinator was first
seen dead, and one when the breaker trips) are records of the same incident. A mirror that goes stale between the pass
and the act stops the act and keeps the hour, and every act that fails writes a feed row, whatever it had done. A mirror
gone stale, or a gap recorded, while the act measures the coordinator stops it too: the act reads both again after it.

**What a crossing costs.** Caps stay global: one row, whole box, no per-project
````

<!-- replay: replace README.md -->
In `README.md`, find (block 90):

````markdown
stopped and nothing further was deleted, and a retry finds the same thing until the other tree or row is moved or
removed. What could not be asked stays `worktree-remove-failed`. The failed document carries `crumb`, saying whether
the failure was printed past the act's breadcrumb, and omits it where that is not known (`ws-expire`'s own
pre-breadcrumb documents, its resumed arm's `probe-unmeasured`, every `ws-collect` document). Git's silence about a worktree record is no longer believed
without reading its admin entries, so `no-worktree-record` becomes a retried unmeasured answer when an entry could not
be read, and a vanished tree whose record names the all-zero head is unmeasured at the audit. The reclaim token also
````

Replace with:

````markdown
stopped and nothing further was deleted, and a retry finds the same thing until the other tree or row is moved or
removed. What could not be asked stays `worktree-remove-failed`. The failed document carries `crumb`, saying whether
the failure was printed past the act's breadcrumb, and omits it where that is not known (a breadcrumb that stands but
cannot be read, every `ws-collect` document; `ws-expire` says it too since workspace lifecycle wave 6). Git's silence about a worktree record is no longer believed
without reading its admin entries, so `no-worktree-record` becomes a retried unmeasured answer when an entry could not
be read, and a vanished tree whose record names the all-zero head is unmeasured at the audit. The reclaim token also
````

<!-- replay: replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find (block 91):

````markdown
    there, `failed` `state-changed`, after the pin, which only keeps, and before the tombstone and the breadcrumb.
    With HEAD symbolic to `ws/<slug>`, a branch deleted inside the lock is refused earlier, at the pin, as
    `pin-failed`, which is resumable. A branch already absent when the token was minted reads absent twice and expires
    with its work in the attic. A branch deleted between the fresh pin and the tail's settle is as wave 6 of CCR-15
    left it: its tip was pinned at the fresh pin.
````

Replace with:

````markdown
    there, `failed` `state-changed`, after the pin, which only keeps, and before the tombstone and the breadcrumb.
    With HEAD symbolic to `ws/<slug>`, a branch deleted inside the lock is refused earlier, at the pin, as
    `pin-failed`, before the breadcrumb: resumable on a ccd older than wave 6, audited afresh since (below). A branch already absent when the token was minted reads absent twice and expires
    with its work in the attic. A branch deleted between the fresh pin and the tail's settle is as wave 6 of CCR-15
    left it: its tip was pinned at the fresh pin.
````

<!-- replay: replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find (block 92):

````markdown
    feed row records it, and nothing is listed. `probe-unmeasured` is still read as final, but ccd prints it on a
    resumed expiry too, after an earlier attempt's breadcrumb (a tombstone it cannot read, or a tmux probe that did not
    answer), so there it can stop the lane on a part-expired archive until a restart. That is a known gap, routed to
    this programme's wave 6 once CCR-15 wave 7's `crumb` field is on `main`, and an arming blocker for the lane until
    then. `pin-failed` and `tombstone-unwritable` stay resumable, because the shared tail prints each after the
    breadcrumb too; the `crumb` field is what can tell those apart.
  - **A kept leaf is listed.** The `expired` document's `clipsKept` and `tmpRootKept` are read by name. A kept word
    (`refused`, `unmeasured`, `in-use`) lists the archive, though its row is gone, saying what was kept and why, until
````

Replace with:

````markdown
    feed row records it, and nothing is listed. `probe-unmeasured` is still read as final, but ccd prints it on a
    resumed expiry too, after an earlier attempt's breadcrumb (a tombstone it cannot read, or a tmux probe that did not
    answer), so there it could stop the lane on a part-expired archive until a restart. That was a known gap and an
    arming blocker for the lane; wave 6 closes it with CCR-15 wave 7's `crumb` field (below). Without `crumb` (an older
    ccd), `pin-failed` and `tombstone-unwritable` stay resumable, because the shared tail prints each after the
    breadcrumb too; the `crumb` field is what tells those apart.
  - **A kept leaf is listed.** The `expired` document's `clipsKept` and `tmpRootKept` are read by name. A kept word
    (`refused`, `unmeasured`, `in-use`) lists the archive, though its row is gone, saying what was kept and why, until
````

<!-- replay: replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find (block 93):

````markdown
    alone. Its report stands on the list, naming the first failure, the attempts and the last detail, saying the
    expiry may have stopped part-way (the server cannot yet tell), and suggesting no destructive verb. The lane asks
    again every four hours, never stopping. No answer that ends no attempt replaces the entry or resets its run: a
    hold, a deferral, a shadow audit (its feed row's "nothing was deleted" is about that audit alone), a refusal the
    box retries, an in-use, ccd's "not yet", an older ccd's silence.
    The entry goes when an attempt completes, finds that none had begun (a `failed` `state-changed`, which ccd prints
    only before the breadcrumb) or stops for good, or when the workspace is archived again; a restart re-learns. A
    terminal refusal and a composition error are still never asked again.

### 5.4 Stage 4 — the dead-coordinator lane (L4)
````

Replace with:

````markdown
    alone. Its report stands on the list, naming the first failure, the attempts and the last detail, saying the
    expiry may have stopped part-way (the server cannot yet tell), and suggesting no destructive verb. The lane asks
    again four hours after each failed attempt, never stopping. No answer that ends no attempt replaces the entry or resets its run: a
    hold, a deferral, a shadow audit (its feed row then says only that this pass deleted nothing), a refusal the
    box retries, an in-use, ccd's "not yet", an older ccd's silence.
    The entry goes when an attempt completes, finds that none had begun (a `failed` `state-changed`, which ccd prints
    only before the breadcrumb) or stops for good, or when the workspace is archived again; a restart re-learns. A
    terminal refusal and a composition error are still never asked again.
- **As wave 6 closes the lane** (each a departure named in the wave-6 plan,
  `docs/superpowers/plans/2026-10-11-workspace-lifecycle-wave6-resumed-expiry-and-arming-close-out.md`).
  - **`ws-expire` says `crumb`, and the lane reads it first.** Every `failed` document `ws-expire` prints carries
    CCR-15's `crumb`: `false` on a fresh expiry, before its breadcrumb (`probe-unmeasured`, `pin-failed`,
    `state-changed`, `tombstone-unwritable`), `true` on a resumed one (its `probe-unmeasured`, printed while its
    `expire:` breadcrumb stands) and, as before, in the shared tail; a breadcrumb that stands but cannot be read leaves
    it unsaid, as `ws-reclaim` does. The parser reads the word, then `crumb`: `false` is audited afresh, `true` is
    resumed, and an absent or non-boolean `crumb` (an older ccd) falls back to the word rule above, exactly. So a
    resumed expiry's `probe-unmeasured` is retried, never final; a fresh one's, which was final before, is audited
    afresh and counted; and a fresh pin's `pin-failed`, a symbolic HEAD's deleted branch among them, is audited afresh
    rather than resumed. The one document still read final by its word is a `probe-unmeasured` over a breadcrumb that
    cannot be read: nothing is deleted, and the row is listed and not asked again until the server restarts.
  - **`containment-refuted` is stuck.** The shared tail prints it, past the breadcrumb, when its removal-time re-ask
    proves that what it would remove is not only this workspace's own. Whatever `crumb` says, the row is listed at
    once, saying the expiry stopped part-way and nothing further was deleted, and goes straight to the persistent
    tier. The entry outranks a failing one and stands until an attempt completes or the workspace is archived again; a
    terminal verdict still outranks it, as on the reclaim side. On the wire it is a `failing` entry: no new word.
  - **A restart that recurs is counted.** A failed document the lane audits afresh counts on the run of failures every
    failure of the act counts on, and the learn after it carries that run: it backs off, and is listed once the run
    has lasted the hour. It never reaches the persistent tier, since nothing it started stands.
  - **The words say when.** A standing entry is asked again four hours after each failed attempt, sooner after an
    answer that ends no attempt and never while the workspace is held. A fleet box that answers `flock-unavailable`
    gets no cleanup composed at all, for any workspace, until the server restarts. Its feed row says so, and so does
    the row's entry, unless a standing entry stands there, which keeps its place. A shadow feed row over a standing
    entry says that pass deleted nothing and that an earlier attempt may have stopped part-way; it never says nothing
    was deleted.

### 5.4 Stage 4 — the dead-coordinator lane (L4)
````

<!-- replay: replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find (block 94):

````markdown
  any successful reclaim of it.

## 6. What this changes outside itself

````

Replace with:

````markdown
  any successful reclaim of it.

**As wave 6 closes the lane** (each a departure named in the wave-6 plan,
`docs/superpowers/plans/2026-10-11-workspace-lifecycle-wave6-resumed-expiry-and-arming-close-out.md`).
- **The journal's trust is read again after the claimant's measure.** The act reads three things before it measures
  the claimant: the mirror's health state, its gap list and the last instant ccd counted a journal line it could not
  write. The first two are synchronous and are read again after the measure, with nothing awaited between that read
  and the commit, so the revive window stays the measure's own round trip. A mirror that turned `stale` or `unknown`
  meanwhile stops the act as a hold (the anchor and the run of passes stand), and a gap recorded meanwhile joins the
  gaps the clause reads. The write-error instant needs a stat, an await, so it stays the early read's; but the count
  behind it is the mirror's and is read again, so a failure counted during the measure where the early read saw none
  makes it unknown, and the claimant unmeasured. A further failure on top of one already counted is not seen before the
  commit.
- **A hold met after the fleet act is recorded.** A mirror that goes stale between a release and the commit stops the
  act with the worker released and its run open; the feed row and the attention entry say so, the anchor stands, and
  the next pass ends the programme.

## 6. What this changes outside itself

````

<!-- replay: replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find (block 95):

````markdown
   an archive, so a "stop for now" to free memory also becomes a deletion in 7 days unless it is brought back.
   Main checkouts are unaffected.
````

Replace with:

````markdown
   an archive, so a "stop for now" to free memory also becomes a deletion in 7 days unless it is brought back.
   Main checkouts are unaffected.

## 12. Before arming

Nothing in this tree arms either lane, and nothing writes either live file (`single-definition.test.ts` pins both).
Arming is the operator's act alone: touching `$REG/expire-lane-live`, and then, in the recommended order,
`$REG/dead-coordinator-lane-live`, by hand in the registry the server reads. These are the facts to know before each,
gathered when the programme's last wave (6) closed; each is designed where §5.3 and §5.4 say, and this section only
collects them.

**Both lanes.**
- **Deploy first, the fleet box first.** Both boxes run the release that carries wave 6 (`ccrc version`, and
  `/health`'s `version`), and the feed shows the dead-coordinator lane's shadow rows as well as the expiry lane's. A
  fleet box whose ccd predates it prints no `crumb` on `ws-expire`'s own documents, and the server then reads them by
  the word alone, as before wave 6: a resumed expiry's `probe-unmeasured` is final again.
- **The recommended order.** Arm the expiry lane first, once this release is deployed and its shadow list has been read;
  then the dead-coordinator lane, after its own shadow list has been read and any breaker trip worked through.
- **Their memory is in memory.** A server restart re-learns every instant, sighting, run of failures and attention
  entry. That can delay an act and never cause one; a kept-leaf entry is lost with it (question (i)).
- **`$REG/reclaim-paused` stops both lanes at once**, shadow included: the cleanup row's toggle on `/runs`.

**The expiry lane (`$REG/expire-lane-live`).**
- **Its arming blockers are closed.** A pre-breadcrumb `state-changed` is audited afresh (wave 5). A resumed expiry's
  `probe-unmeasured` is retried (wave 6, through `crumb`), and a fresh one's is audited afresh, counted and listed after
  the hour if it recurs, where it was final before. `_ws_expire_cwd_users` resolves its parent through
  `_ws_dir_physical`, so a parent whose physical path holds a newline is unmeasured, never "nobody" (CCR-15 wave 6; its
  case in `ccd-leaf-root-newline.test.ts` goes red when the bare `pwd -P` is put back, measured in wave 6).
- **One residual of question (k).** A breadcrumb that stands but cannot be read (a `$REG/<id>.reaping` that is not a
  readable file) leaves `crumb` unsaid, as on the reclaim side, so that `probe-unmeasured` is read by its word: listed
  at once and not asked again for that archive until the server restarts. Nothing is deleted meanwhile; read what
  stands in that row before anything else.
- **One archived tree holds a leaked test tmux server** (the ledger's pre-arming item (d)). The lane refuses that row
  `in-use` on every pass and lists it after three, naming the process; it never ends it. End that server first, once
  you know what it is, or arm knowing the row stays listed.
- **A branch already gone now expires.** Since CCR-15 wave 6, an archived workspace whose branch is gone when its token
  is minted expires with its work in the attic, where `main` stopped at `pin-failed`, and its ignored and secret-shaped
  files go with the tree, as the standing policy says. A branch deleted between the fresh pin and the tail's settle has
  its tip pinned at the fresh pin. With HEAD still symbolic to a deleted branch the pin fails before the breadcrumb, and
  the lane audits it afresh each time, counted and listed after the hour.
- **A branch deleted or made inside the lock stops the act** before the breadcrumb, in both directions (question (j)).
- **An archive whose admin `gitdir` names no path** is unmeasured and retried, never `no-worktree-record` (CCR-15
  wave 7, rung 8); a record that is truly absent stays terminal.
- **What each answer does to a row.** A person viewing it defers it with no ceiling. A process working in it is refused
  every pass and listed after three, naming the process; the lane never kills. A held row past its instant is listed,
  never touched. A terminal refusal, or a failure the box says will not resume, is listed and never asked again for that
  archive. A resumable failure backs off and is listed after the hour; after a day of the verb's failures it becomes a
  standing entry, asked again four hours after each failed attempt. `containment-refuted` is listed at once on that
  tier. A failure ccd printed before the breadcrumb is audited afresh, counted, and listed after the hour if it keeps
  happening. A completed expiry that kept a leaf is listed until a restart.
- **`flock-unavailable` halts the lane** on that box until the server restarts; its feed row says so, and so does the
  row's entry, unless a standing entry stands there.
- **The first armed pass faces the backlog** at one expiry a pass, fleet-wide. The operator expired fifteen archives by
  hand on 2026-10-07; raise `WS_EXPIRE_AFTER_S` first if what remains is too many at that pace.

**The dead-coordinator lane (`$REG/dead-coordinator-lane-live`).**
- **Arm it after the expiry lane**, once its own shadow list is read and any breaker trip is worked through.
- **Its arming blockers are closed** (wave 5): the act's own clock is pinned, a second crash is a second record, a
  release and a re-hold are told apart, every thrown act is recorded, and an unread generation is no successful sweep.
- **The three early reads, and what wave 6 closes.** Before measuring the claimant the act reads the mirror's health
  state, its gap list and the last instant ccd counted an unwritten journal line. Wave 6 reads the first two again after
  the measure, and the count behind the third: a failure counted during the measure's round trip, where the early read
  saw none, leaves the claimant unmeasured. One thing stays early: a further failure on top of one already counted is
  placed by the earlier instant, so it is not seen before the commit.
- **The journal-gap trade.** A coordinator whose last successful spawn is not newer than a recorded gap stays listed as
  unmeasured, never ended, until it spawns again (wave 4, accepted). Ageing a gap out is carried, for a decision on
  shadow evidence.
- **Two residuals stand.** A lane gap of over ten minutes re-anchors every crashed coordinator on the same pass, so the
  breaker holds and no shadow row is written until all but one are revived, reclaimed or abandoned. A revive of the same
  id inside the act's last re-measure window, sub-second to one agent round trip, can still lose its runs.
- **A permanently unreadable generation pins the mirror `stale`**, with no diagnostic of its own: the lane then decides
  nothing at all, which fails shut. `/api/fleet/health`'s lifecycle state shows it.
- **An accepted abstention** (§5.4): a child's pre-start `reclaim` failure reads as a deliberate act.
- **An abandoned programme's row** stays `abandoned` while a revived coordinator's new run is open (§5.4; question (f)).

**Questions still open**, lettered as the programme's ledger letters them.
- (b) The archive-confirm copy: the ledger holds it open; wave 4 hedged both confirms to a sentence true before and
  after arming. Is that the copy you want?
- (f) Should a new run under an abandoned programme return its row to active?
- (g) A stale mirror at the act keeps the run of crashed passes, where the switch resets it. Keep, or reset?
- (i) A kept-leaf entry lives until a server restart. Is that the life you want?
- (j) `ws-expire` refuses a branch made inside the lock as well as one deleted. Keep both directions?
- Wave 2's three: the PR sheet's "Archive now" offers no consent for a busy or coordinating workspace; a real worktree
  check in remote mode needs an agent-first probe; L5's "Its workers will be cleaned up" is true only for CCR-15's
  children.
- Wave 6's own are in its plan's questions for the operator.
````

- [ ] **Step 4: Run — green.** Measured: `expiry-lane-prose` `14 passed (14)`; `dead-coordinator-prose` `15 passed (15)`; `ws-expire-prose` `7 passed (7)`; `child-reclaim-prose` `4 passed (4)`; `ws-collect-prose` `7 passed (7)`; `pools-prose` `27 passed (27)` (README 5998 lines against CLAUDE.md's 5900); `readme-holds` `17 passed (17)`; `docs-grammar` `158 passed (158)`; `docs-shared` `239 passed (239)`; `oss-metadata` `22 passed (22)`; the five citation cases `5 passed | 445 skipped (450)`; `ccd-reg-get-census` `3 passed (3)`; `cite-remeasure.py` unchanged (Measured while planning item 7).

- [ ] **Step 5: Commit.** `docs(lifecycle): §5.3, §5.4 and README say what wave 6 closed, and §12 gathers what to know before arming either lane`.

---

### Task 12: The whole branch, and the PR

**Model routing:** `opus`, effort `high` for the whole-branch review (act-safety lens: nothing arms, nothing deletes or ends what it should not); `sonnet` for the runs.

- [ ] **Step 1: Merge `origin/main` if it moved** (never a rebase), keep both sides, re-stamp `ccd/ccd`, and re-point by content — `## Re-measure at dispatch` lists every block in a shared file and what it becomes if CCR-15 wave 8 has landed. Re-run the five citation cases, `cite-remeasure` and `ccd-reg-get-census`.

- [ ] **Step 2: The full server suite, sharded, one worker each, in the foreground** (twenty-four shards measured ~3–12 minutes each on the loaded box; one or two shards per command):

```bash
( cd server && ./node_modules/.bin/vitest run --shard=<k>/24 --maxWorkers=1 )   # k = 1 … 24
```

Measured on the final prototype: 626 test files across the 24 shards (each 2–16 minutes on a box at load 11–18); `30616 passed | 2 failed | 97 skipped` tests, 2 files red: shard 4 — `session-hook.test.ts` (`1 failed`: "skips a scratch slug", the known `TMPDIR`-outside-`/tmp` red); shard 10 — `pools-prose.test.ts` (`1 failed`: the README-size ratchet, against the drafted README that added eight lines — Task 11's four-line README is green there, re-run alone: `pools-prose` `27 passed (27)`). Every other shard green (e.g. shard 18 `5058 passed (5058)`, shard 24 `844 passed (844)`). The README revision changed only README's words and the two prose tests' pins; every README-reading suite was re-run alone on it (Task 11, Step 4). That run was on the prototype BEFORE the review revision. The revision changed three source files (`archivedExpiry.ts`, `coord/expireArchived.ts`, `coord/endDeadCoordinator.ts`), the spec and seven test files, and re-ran, one file per process, every server test that imports `archivedExpiry.ts`, `coord/expireArchived.ts` or `coord/endDeadCoordinator.ts` (`archived-expiry-policy` 75, `archived-expiry-lane` 38, `expire-archived` 24, `containment-refuted-word` 7, `end-dead-coordinator` 31, `ccd-ws-expire-consent-branch` 5, `mail-routes` 59), the lane-adjacent suites through `watch.ts` (`dead-coordinator-lane` 35, `sweep-close` 13, `dead-coordinator-policy` 42, `fleet-health` 26, `lifecycle-sweep` 8, `archive-door` 57), `ccd-child-reclaim-crumb` 13, and every prose and docs suite Task 11 names: all green. The worker's full run at Task 12 is the arbiter.

- [ ] **Step 3: The PWA and agent suites, and both typechecks.**

```bash
( cd pwa && ./node_modules/.bin/vitest run --shard=1/2 --maxWorkers=1 ) && ( cd pwa && ./node_modules/.bin/vitest run --shard=2/2 --maxWorkers=1 )
( cd agent && ./node_modules/.bin/vitest run --maxWorkers=1 )
( cd server && ./node_modules/.bin/tsc --noEmit -p . ) && ( cd pwa && ./node_modules/.bin/tsc --noEmit -p . )
```

Measured: PWA shard 1/2 `55 passed (55)` files, `1762 passed (1762)` tests; shard 2/2 `55 passed (55)` files, `1754 passed (1754)` tests; agent `26 passed (26)` files, `494 passed (494)` tests; server and PWA `tsc` rc 0. (No PWA or agent file changes; they run because the branch is whole.)

- [ ] **Step 4: The repo-wide guards, one file per process** (after `git fetch origin main` for `deviation-refs`). Measured on the final prototype (the revision re-ran `single-definition`, `mail-routes`, `typecheck-tests`, `topology-clean`, `deviation-refs` and `dtbd` on the revised one, at the counts below): `single-definition` `530 passed (530)` (this plan adds no case to it; both no-writer pins green); `modelenv-single-writer` `7 passed (7)`; `box-token-census` `37 passed (37)`; `coord-pause-route` `20 passed (20)`; `routing-references` `11 passed (11)`; `typecheck-tests` `12 passed (12)` (needs `agent/node_modules` and `pwa/node_modules`); `topology-clean` `55 passed (55)`; `ownership` `14 passed (14)`; `coordinator-skill` `161 passed (161)`; `mail-routes` `59 passed (59)`; `deviation-refs` `31 passed (31)`; `dtbd` `1 passed (1)`; `ccd-refusal-scan` `14 passed (14)`; `ccd-reg-get-census` `3 passed (3)`; the five citation cases `5 passed | 445 skipped (450)`.

- [ ] **Step 5: The no-writer check by hand.** `git grep -n "expire-lane-live\|dead-coordinator-lane-live" -- server/src ccd agent pwa/src deploy` names only the two definers and their readers; the diff adds no write of either.

- [ ] **Step 6: The PR.** Title: `Workspace lifecycle wave 6: the resumed expiry's crumb, the stuck word, a counted restart, the journal re-read, and the arming close-out (CCR-17)`. The body lists each task with its red/green counts, every mutation row, the departures with their issued numbers, the crumb census, the restart's recurrence, rung 8's and 4458's checks, and the questions below, and says both lanes stay SHADOWED. The worker opens it; the coordinator rules.

## Re-measure at dispatch

Drafted on `origin/main` `7609221a4`. Before Task 1, `git fetch origin` and, if `main` moved, replay each block against the new tip: each must still match exactly once at its turn. A block that does not is a moved anchor — re-point it BY CONTENT (the block's own text says where), never by a line delta, and say so in the PR. Every block in a file another in-flight wave edits:

| Block | Task | File | Its anchor begins |
|---|---|---|---|
| 5 | 1 | `ccd/ccd` | `_ws_expire_fork "$id"` |
| 6 | 1 | `ccd/ccd` | `` # stands now. The tail's `purge-*` failures print it after `_reg_purge` took `` |
| 10 | 2 | `server/src/archivedExpiry.ts` | `` /** The ws-expire `{"failed":…}` words that ccd prints before THIS attempt's tombstone and breadcrum… `` |
| 11 | 2 | `server/src/archivedExpiry.ts` | `` *  function and its shape, and holds the expiry's `failed` `state-changed` on its fresh arm, before … `` |
| 12 | 2 | `server/src/archivedExpiry.ts` | `\| { readonly kind: 'failed'; readonly resumable: boolean; readonly detail: string }` |
| 13 | 2 | `server/src/archivedExpiry.ts` | `const detail = typeof v.detail === 'string' ? v.detail : '';` |
| 14 | 2 | `server/src/archivedExpiry.ts` | `*  stopped part-way, so only it may move a row onto the persistent tier. Two conditions, two values …` |
| 20 | 3 | `server/test/containment-refuted-word.test.ts` | `` // with its ccd emission (`_ws_reclaim_tail`'s literal `_ws_reclaim_fail … `` |
| 21 | 3 | `server/test/containment-refuted-word.test.ts` | `it('parseExpireResult: failed, resumable — the expiry lane asks again on its backoff, never at +∞', …` |
| 22 | 3 | `server/test/containment-refuted-word.test.ts` | `{ sessionId: 'demo-quiet-basin', outcome: 'failed', refusal: W, at: 1, failingSince: 1 }, childRecla…` |
| 24 | 3 | `server/src/archivedExpiry.ts` | `// the executor re-reads, and ccd re-proves inside its lock at the instant of deletion. This file na…` |
| 25 | 3 | `server/src/archivedExpiry.ts` | `export const isExpirePreCrumbFailed = (word: string): boolean => (EXPIRE_PRE_CRUMB_FAILED as readonl…` |
| 26 | 3 | `server/src/archivedExpiry.ts` | `` *  an older ccd that prints no `crumb`, a `state-changed` (`EXPIRE_PRE_CRUMB_FAILED`). */ `` |
| 27 | 3 | `server/src/archivedExpiry.ts` | `const detail = typeof v.detail === 'string' ? v.detail : '';` |
| 28 | 3 | `server/src/archivedExpiry.ts` | `/** The expiry COMPLETED and kept a leaf (wave 5, the kept-leaf reader): the row is gone, so this re…` |
| 29 | 3 | `server/src/archivedExpiry.ts` | `*  would be cleared by the release, and the record with it (wave 5). */` |
| 30 | 3 | `server/src/archivedExpiry.ts` | `` *  the row and audits it afresh (wave 5; since wave 6 any failed document with `crumb: false`). */ `` |
| 31 | 3 | `server/src/archivedExpiry.ts` | `const EXPIRY_OUTCOME_KINDS: Readonly<Record<ArchivedExpiryOutcome['kind'], true>> = {` |
| 32 | 3 | `server/src/archivedExpiry.ts` | `const verb = o.kind === 'audit-failed' ? { verbFailures: entry.verbFailures, verbFailingSince: entry…` |
| 33 | 3 | `server/src/archivedExpiry.ts` | `...(o.kind === 'audit-failed' ? standingThrough(entry) : {}) };` |
| 34 | 3 | `server/src/archivedExpiry.ts` | `return 'not cleaned up: the fleet box’s ccd does not say when this archive expires (an older build),…` |
| 35 | 3 | `server/src/archivedExpiry.ts` | `for (const [sessionId, e] of entries) {` |
| 46 | 4 | `server/src/archivedExpiry.ts` | `if (read.archivedAt !== entry.archivedAt) return { ...entry, nextAskAt: nowMs + passMs };` |
| 47 | 4 | `server/src/archivedExpiry.ts` | `return { ...base, inUseRun: 0, inUse: [], eligibleSince: null, nextAskAt: nowMs + EXPIRE_PERSISTENT_…` |
| 49 | 5 | `ccd/ccd` | `` # fresh audit (`archivedExpiry.ts`). A branch already absent when the token `` |
| 60 | 6 | `server/src/watch.ts` | `deadCoordinatorNextEntry, deadCoordinatorOutcomeKey, deadCoordinatorSighted, deadCoordinatorSince, d…` |
| 61 | 6 | `server/src/watch.ts` | `now: (): number => Date.now(),` |
| 70 | 8 | `server/src/archivedExpiry.ts` | `*  resume — so its sentence never promises a retry. Absent on a failure that is still being retried.…` |
| 71 | 8 | `server/src/archivedExpiry.ts` | `report: { kind: 'failing', at: nowMs, detail: o.detail, final: true } };` |
| 72 | 8 | `server/src/archivedExpiry.ts` | `const isoMs = (ms: number): string => iso(Math.floor(ms / 1000));` |
| 73 | 8 | `server/src/archivedExpiry.ts` | `` return `cleanup has failed for a day in ways the box said it could resume: the first at ${isoMs(r.at… `` |
| 74 | 8 | `server/src/archivedExpiry.ts` | `` + `(first at ${isoMs(r.at)}, ${r.attempts} ${r.attempts === 1 ? 'attempt' : 'attempts'}). The sessio… `` |
| 79 | 8 | `server/src/watch.ts` | `import {` |
| 80 | 8 | `server/src/watch.ts` | `}, { sessionId: id, archivedAt: entry.archivedAt, expiresAt: entry.expiresAt! }));` |
| 88 | 11 | `README.md` | `the feed row only. A cleanup the box keeps failing in a way it says it can resume is listed after an…` |
| 89 | 11 | `README.md` | `naming the coordinator — are the notifications, and this lane's rows (each with the instant the coor…` |
| 90 | 11 | `README.md` | `stopped and nothing further was deleted, and a retry finds the same thing until the other tree or ro…` |

`shared/api.ts`, `server/test/single-definition.test.ts`: no block (nothing here moves).

**If CCR-15 wave 8 (run 348) lands first** (Order A of R81 either way: wave 8 moves `keptLeafWord`, this wave does not):
- `server/src/archivedExpiry.ts`: wave 8's Task 1 deletes `KEPT_LEAF_WORDS`, `KeptLeafWord` and `keptLeafWord`, re-points `expireLeafKept` at `leafKeptWord` and adds `leafKeptWord, type LeafKeptWord` to the file's one `../../shared/api.js` import. This plan's Task 3 adds `type LcRefusalToken` to that same import (its block's anchor is the import's three lines): re-point it to the merged import, keeping both names. No block of this plan touches the word half's lines.
- `server/test/containment-refuted-word.test.ts`: wave 8's Task 6 retitles the shared describe to "the parsers read it as a failure: the reclaim parser as stuck, the expiry parser as resumable", retitles its reclaim `it`, flips the reclaim assertion, and adds a four-line comment above the describe saying `parseExpireResult`'s case "below" is workspace-lifecycle's and left as found. This plan's Task 3 removes the expire `it` (block anchored on that `it`'s three lines and the line before) and appends its own describe at the foot: both are by content and survive the retitle. Then, as the SECOND lander (mail 4202: CCR-15's consent to edit exactly these lines of wave 8's), make the shared describe speak of the reclaim parser only — its title (for example "the reclaim parser reads it as a stuck failure"), and wave 8's comment without its `parseExpireResult` sentence — and put the file header's last sentence (Task 3's block, "Until the reclaim side classes it … wave 8's `stuck` class changes that pin on purpose") in the past tense: both parsers now class it `stuck`. Add, in this wave's describe, `expect([EXPIRE_STUCK_WORD]).toEqual([...CHILD_RECLAIM_STUCK_TOKENS]);` (importing `CHILD_RECLAIM_STUCK_TOKENS` from `../src/coord/childReclaim.js`), so the two lanes' stuck word is held equal — one class, two carriers (ruling B: never re-listed). Wave 8's Task 8 text still expects this `parseExpireResult` case to read `resumable: true`; the coordinator tells CCR-15 (the mail 4200/4202 thread).
- `server/src/watch.ts`: wave 8 edits the child-reclaim arms and the file's imports; this plan's three `watch.ts` blocks are the dead-coordinator act's deps, the expiry pass's feed call and two import lines. Merge keeps both sides.
- `server/test/archived-expiry-policy.test.ts`: wave 8's Step 4 (d) re-points that file's `keptLeafWord` import; this plan's blocks there touch no import.

**If this wave lands first:** wave 8 is the second lander, and mail 4202 says it writes the shared describe reclaim-only itself (CCR-15 tells quiet-prairie): its planned title "… the expiry parser as resumable" and its comment's "`parseExpireResult`'s, below, is workspace-lifecycle's and is left as found" would otherwise merge false, silently — wave 8's own "leave its version too" keeps its replay working, so nothing reds. Wave 8 then also adds the equality assertion above, and reads `parseExpireResult`'s case as `stuck`, in this wave's describe. The coordinator carries this paragraph to CCR-15 with the brief.

## Deviations found

Named by slug, in the order the brief's numbers are written against them (the callout at the top). Each reaches the spec by its effect — §5.3's and §5.4's "As wave 6 closes the lane" and §12 (Task 11) — one short sentence each, no number spelled there.

- **D-4617** — `expire-documents-say-crumb` (Task 1) — `ws-expire`'s own `failed` documents carry CCR-15's `crumb` (`false` before its breadcrumb, `true` on its resumed arm, no key over an unreadable breadcrumb), where CCR-15 wave 7 left `_ws_expire_locked` unedited and keyless (R72); the crumb test's ws-expire describe follows, and the `_WS_RCL_CRUMB` comment above `_ws_reclaim_failed_json` is corrected too — OUTSIDE `_ws_expire_locked`, so wider than ruling A's "inside `_ws_expire_locked` ONLY" (comment only, droppable, CCR-15's consent owed). Fix round 1 (review 381, F7): the `_WS_RCL_CRUMB` comment edit was narrowed to the consented sentence (CCR-15 4208, accepted in 4214), so the comment is corrected in that one sentence only.
- **D-4618** — `an-unreadable-breadcrumb-stays-keyless` (Task 1) — a `probe-unmeasured` over a `.reaping` that stands but cannot be read carries no `crumb` (as `ws-reclaim`'s does), though ruling A asked `true` of "the resumed arm": neither arm can be told there, so the server reads `main`'s word rule and lists it final until a restart; §12 says so (question (p)).
- **D-4619** — `crumb-false-audits-afresh-whatever-the-word` (Task 2) — `parseExpireResult` reads `crumb` after the word: `false` is `restart` for every word — a fresh `probe-unmeasured`, which `main` read final, and a fresh `pin-failed` or `tombstone-unwritable`, which it read resumable — and `true` is resumable, a resumed `probe-unmeasured` among them; absent or non-boolean falls back to `main`'s word rule (ruling A, R76's order).
- **D-4620** — `a-fresh-pin-failure-audits-afresh` (Task 2, Task 5) — ruling D called the attached HEAD's `pin-failed` "resumable"; under ruling A's `crumb:false` a current server reads it `restart` (an older ccd's keyless document stays resumable); both end in a fresh audit before any act (question (l)).
- **D-4621** — `the-restart-row-names-no-cause` (Task 2) — the `restart` feed row's title and body say ccd stopped before the attempt started anything, not that the branch changed inside the lock: a fresh `pin-failed` is a restart too.
- **D-4622** — `the-expiry-stuck-word-is-typed-against-l0` (Task 3) — the expiry lane reads `containment-refuted` through `EXPIRE_STUCK_WORD`, typed `Extract<LcRefusalToken, 'containment-refuted'>`, because L1 `archivedExpiry.ts` cannot import CCR-15 wave 8's set in L3 `coord/childReclaim.ts`; a test holds the two equal once both exist.
- **D-4623** — `a-stuck-expiry-rides-the-failing-word` (Task 3) — a stuck entry is an internal report kind and rides the wire as `failing`, with its own sentence: no new `ExpiryAttention.kind`, no `shared/api.ts` or PWA edit (CCR-15's R77: no new chip word).
- **D-4624** — `stuck-stands-through-a-restart` (Task 3) — a `restart` under a stuck entry keeps the entry, its instant and the four-hour cadence, where wave 5 lets a restart end a standing entry (ruling B: until an attempt completes or the archive changes).
- **D-4625** — `a-terminal-verdict-outranks-stuck` (Task 3) — a terminal refusal, a failure ccd says will not resume and a composition error replace a stuck entry (ruling B names kept and failing as outranked; R77: terminal outranks stuck).
- **D-4626** — `a-recurring-restart-climbs-the-shared-ladder` (Task 4) — a `restart` counts on the shared failure run (backed off, listed after the hour), the learn after it carries the run and its report, the verb's run is reset, and it never reaches the persistent tier (ruling C, argued: its sentence would be false).
- **D-4627** — `the-journal-trust-is-re-read-after-the-measure` (Task 6) — the act's executor gains a synchronous `journalReread` port; after the claimant's measure the mirror's health state and gap list are read again (a stale or unknown mirror is a hold; gaps are unioned; never more trust than the early read), and so is the write-error COUNT — beyond ruling E's two reads — so a failure counted during the measure, where the early read saw none, reads unmeasured; the instant itself stays early (ruling E; review 355, F7; the act-safety lens).
- **D-4628** — `a-standing-entry-is-asked-after-each-failed-attempt` (Task 8) — the standing sentences say "asks again 4 hours after each failed attempt — sooner after an answer that ends no attempt, never while the workspace is held", where wave 5 said "every four hours" (the worker's residual: an upper bound, not a cadence).
- **D-4629** — `flock-unavailable-is-final-for-the-row` (Task 8) — `flock-unavailable` gives a row with no standing entry a final `halted` report (never asked again by the process, which already halts every act) whose sentence says the lane composes nothing on that box until the server restarts, where wave 5 reported it as retried; a standing entry keeps its place, and the feed row says the halt either way.
- **D-4630** — `a-shadow-row-over-a-standing-entry-says-this-pass` (Task 8) — a shadow feed row over a standing entry says that pass deleted nothing and an earlier attempt may have stopped part-way, never "nothing was deleted".
- **D-4631** — `the-census-bounds-at-the-tombstone` (Task 9) — the census holds the expiry's `failed` `state-changed` producer before `_ws_tombstone`, where wave 5 bounded it at the breadcrumb.
- **D-4632** — `before-arming-is-section-12` (Task 11) — the spec gains §12 "Before arming", per lane, with the open operator questions: words only.
- **D-4820** — `the-breaker-hold-survives-a-restart` (fix round 1, F1) — the dead-coordinator breaker's held set is a `run_events` observation row (`dead-coordinator-breaker-held:` and the `id@firstDeadAt` members), written when it changes and read back once per process at the lane's first pass, where an unreadable row makes that pass act on nothing; no schema change, §5.4 and §12 say what a restart does, and two comments (review 381, F10) are made true.
- **D-4821** — `a-halted-box-says-so-on-every-standing-row` (fix round 1, F3) — while `archivedExpiryBoxRefused` stands, `expiryAttention` takes the halt as a parameter and appends it to the sentence of every standing row (stuck or tier), so a lane that composes nothing on the box no longer lists a row that says it asks again; the sentence only, no report kind and no wire word.

## Deploy note

- **Class: AGENT-FIRST, then server.** Tasks 1 and 5 edit `ccd/ccd`. The release goes out through ccrc's updater, fleet box first: the operator applies it from the console (`ccrc rollout --to vX.Y.Z` only when the console is down). No session runs a rollout or an update by hand. No PWA change ships (the stuck entry rides the `failing` word).
- **Either order is safe, by reading and measured in the prototype.** A NEW ccd under an OLD server: the `crumb` key is additive and the old parser reads named keys only, so it reads every document exactly as before (a resumed `probe-unmeasured` final, as today). A NEW server over an OLD ccd: no `crumb` key, so Task 2's fallback is `main`'s word rule exactly (Task 2's fallback rows); `containment-refuted` is stuck either way (it is read by its word).
- **No migration, no route, no `FLEET_PROTO` bump, no wire word.**
- **Both lanes stay SHADOWED.** Nothing here writes `$REG/expire-lane-live` or `$REG/dead-coordinator-lane-live`. After merge and deploy, the spec's §12 is the operator's list; the expiry lane's last arming blocker (question (k)) is closed by Tasks 1–2 once both boxes run this release, save its one fail-safe residual (a breadcrumb that turns unreadable between the act's audit and the in-lock fork, listed final until a restart; one already unreadable at the audit is backed off), which §12 states.

## Rulings on the plan's questions, and the operator's

Lettered to continue the programme ledger's own (a)–(k). The coordinator ruled (l), (m), (n) and (p) on 2026-10-11, before dispatch; none of them loosens a gate.

- **(l) Ruled: the attached HEAD's fresh `pin-failed` is audited afresh** (ruling A's `crumb:false`, as this plan has it). Nothing had started, so a fresh audit is the truer reading, Task 4 counts it, and it matches CCR-15's R76, which reads a pre-breadcrumb `pin-failed` as not resumable on the reclaim side. Ruling D's "(resumable)" was the word-only reading of wave 5's lens; D's ccd half stands as Task 5 pins it: the act ends at the PIN as `pin-failed`, never `state-changed`. An older ccd's keyless document still reads resumable (Task 2's fallback). Task 2 gains no arm.
- **(m) Ruled: a stuck entry stands through a `restart`.** Ruling B's "until an attempt completes or the archive changes" governs. A restart says nothing about whether the leaf that refused containment is gone, and an entry that stays listed is never the unsafe direction.
- **(n) Ruled: `flock-unavailable` is final for a row with no standing entry**, as planned. A stuck or tier entry keeps its place, and the feed row says the halt. The process already halts every act on that answer; lifting it after a delay would loosen a guard.
- **(o) CCR-15's consent** for two edits in its files: the `_WS_RCL_CRUMB` comment in `ccd/ccd` (Task 1, block 6, comment only) and `ccd-child-reclaim-crumb.test.ts`'s ws-expire describe (Task 1). The coordinator has asked for it; the dispatch brief carries the answer. If the comment edit is refused, Task 1 drops block 6 and CCR-15 owns the stale sentence. The describe must change with Task 1's behaviour, so a refusal there would come with CCR-15's own wording, which the brief carries. Mail 4202 (CCR-15, answering 4200) agreed the third edit: moving `parseExpireResult`'s case in `containment-refuted-word.test.ts` (Task 3), with the second lander making the shared describe reclaim-only. Wave 8 touches nothing under `ccd/`, so the `ccd/ccd` restamp is this wave's alone.
- **(p) Ruled: an unreadable breadcrumb's `probe-unmeasured` stays keyless**, as `ws-reclaim`'s does. ccd defines `true` as "printed past the act's breadcrumb", which it cannot claim of a `.reaping` it cannot read, and the server then reads `main`'s word rule. That holds only for a breadcrumb that turns unreadable between the act's audit and the in-lock fork (review 381, F9): one already unreadable at the lane's audit makes the audit answer `unmeasured` (exit 1), read as `audit-failed`, backed off and listed after the hour, never final. In that window the row is listed final, nothing deleted, asked again after a restart or a new archive. §12 states it as the expiry lane's one fail-safe residual. Whether this rare shape should rather be retried on the persistent tier (the operator's standing preference for tolerance over freezing) is the operator's question; answering it is a later change, not this wave's.
- **Still open from earlier waves, listed in the spec's §12:** (b) the archive-confirm copy, (f) an abandoned programme's row, (g) F4's two halves, (i) the life of a kept-leaf entry, (j) both directions of the in-lock branch check, and wave 2's three (the PR sheet's "Archive now", a real worktree check in remote mode, L5's sentence).
