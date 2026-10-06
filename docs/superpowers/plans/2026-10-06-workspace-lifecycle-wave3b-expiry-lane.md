# Workspace lifecycle, wave 3b — the expiry lane (spec stage 3, the lane; AGENT-FIRST) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the server clean up an ARCHIVED workspace seven days after its archive, through wave 3's `ws-expire`, without ever composing a deletion it cannot defend. The lane audits each archived workspace once per archive to LEARN when it expires — ccd's own `archivedAt + WS_EXPIRE_AFTER_S`, carried by the audit's new `expiresAt` key, never a server constant — and, once a row has been eligible on two passes past that instant, asks for at most ONE expiry per sweep pass, fleet-wide, with the audit's token. It ships SHADOWED: until the operator touches `$REG/expire-lane-live` by hand, it records "would expire <id>" (a feed row and an attention entry) and composes no `ws-expire`; `$REG/reclaim-paused` — now the fleet's one cleanup switch — stops it entirely. Before the lane can compose anything, 3893's gate-then-journal race is closed: a return verb clears the archive inside its reap gate, so an expiry that takes the lock next finds nothing to take. The wave's first commit is review 288's residue (F1–F7), and its later tasks take wave 2's carried follow-ups (the archive door's store detail, its 404 fold, its `already archived` reading, FM7) and wave 3's two ccd text rows (ws-reap over an unreadable breadcrumb, ws-gc's two advisory lines).

**Architecture:** The box half is `ccd/ccd`, AGENT-FIRST. `_ws_expire_refuse_return` (the return verbs' gate) now takes the verb's name and, on an archived row, unarchives while it holds `$REG/.reap-<id>.lock` (journaled `unarchive`, as `_spawn_start` journals it), then lets the lock go and calls a no-op seam, `_ws_expire_return_gap`, that a test redefines to force an expiry into the exact gap 3893 named. `ws-audit --expire`'s document gains `expiresAt`, sets `archivedAt` on `not-expired` too, and names the processes of an `in-use` refusal (`inUse`: pid, command, cwd — and the detail sentence names the command). ws-reap refuses `reaping-phase-unknown` over a breadcrumb that stands but cannot be read on an archived row (a one-line, line-neutral call above the frozen `:19131` anchor into a helper in ws-reap's MIRROR block), and ws-gc's two advisory lines are reworded line for line. The server half: one L1 file, `server/src/archivedExpiry.ts` (the nineteen words held equal to ccd's EXPIRE region and the shared ladder, the two parsers, the ONE `expiresAt` reader, `archivedExpiryVerdict`, the lane's per-archive memory, the attention words, the live marker's one spelling); one executor, `server/src/coord/expireArchived.ts` (`capSupported(state, EXPIRE_CAP)`, one registry listing for the switch and the live marker, presence, the audit, then — live only — `ws-expire` with the audit's token, the capability asked again in the act's own scope; box words told apart from composition errors); and the lane, `sweepArchivedExpiry` in `watch.ts`, a SIBLING pass of `sweepChildReclaim` on the same tick, cadence and switch, with its own memory, executor call, change-only feed rows and attention list. The list rides the coord frame as `CoordStatus.expiryAttention` (additive, optional) and renders in the cleanup row on `/runs`, under the children's list, from its own reader.

**Tech Stack:** bash 5 (`ccd/ccd`, `set -uo pipefail`, no `-e`), python3 (the cwd probe inside ccd, the instrument), git 2.43, TypeScript (server, pwa, L0 `shared/`), vitest 4, React 19, `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` — §5.3 whole (the lane, the switch, the contracts that move, and "As wave 3 builds the verb"), §3 (why an automatic expiry is safe), §5.2's archive-confirm copy, §5.4 only for what this lane must not pre-empt (its `expire` journal act is stage 4's "deliberate removal"), §6 items 1–4, §8's stage-3 failure modes, §9's kill rule and instrument, §11. The parent machinery: `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` §5.5–§5.8 and `docs/superpowers/programs/child-reclamation-contract.md`. The interface this wave consumes is wave 3's plan's "Wave 3b inherits" (`docs/superpowers/plans/2026-10-04-workspace-lifecycle-wave3-ws-expire.md`), and its "Carried out of this wave" rows are requirements here. Programme ledger: `docs/superpowers/programs/workspace-lifecycle.md` (Carried constraints, Next-wave brief, the 2026-10-06 entries). Review reports: review 288 (F1–F7) and review 284 (R3, R4). Sibling plans whose shape this one copies: wave 3 (`2026-10-04-workspace-lifecycle-wave3-ws-expire.md`) and child reclamation's wave 4 (`2026-09-22-child-reclamation-wave4-sweep-and-switch.md`).

> **Departure numbers.** The plan names twelve departures by SLUG under `## Deviations found`; it defines no number. The run's issued block is **4114–4125**, twelve numbers: the worker writes them bare, in task order, each in the entry that defines it, as it defines it. A departure found while executing is reported, never typed.

## The coordinator's rulings this plan builds (binding; they win over the spec and over the plan's own preferences)

- **(A) The first commit is review 288's residue** (Task 1): F1 the CONTROL plants a running unit too (the stronger pin); F2 3964's entry and ccd's resume header say a pane that came back is itself a cwd user; F3 3964 gets its mutation row; F4 CCR-15's qualification gains "or a breadcrumb that stands but cannot be read", inside that passage only; F5/F6 the as-built rows corrected to the measured counts (M08 ladder 17, M26 verb 3) with the note that review 284 quoted 1 and 2; F7 `close_time`'s list says "among them" and names U+0085.
- **(B) 3893 closed before the lane composes the verb** (Task 2): both remedies measured per verb; the archive is cleared inside the gate (the departure `return-clears-the-archive-inside-the-gate`); a test forces the interleaving through a stubbed seam and reds when the fix is removed.
- **(C) The threshold is never typed by the server** (Tasks 3, 5, 7): `expiresAt` in the audit's document, `archivedAt` on `not-expired`, ONE reader, no re-audit before the instant unless the archive changes, no evidence composes nothing. AGENT-FIRST: ccd, then server and pwa.
- **(D) The lane** (Tasks 5–7): `archivedExpiryVerdict` in its own L1 file; a second population with its own memory, clocks, executor call, feed rows and attention entries, never visible to child reclamation wave 5's chip; audit, then verb with the audit's token; `capSupported(state, EXPIRE_CAP)`; the box words told apart from composition errors; the word map held equal to ccd's EXPIRE region by a test; `verb-gate.test.ts`'s `CAP_GATED_VERBS` entry; at most one `ws-expire` per pass, fleet-wide.
- **(E) The lane ships shadowed** (Tasks 6, 7, 8): `$REG/expire-lane-live` absent → audit and record "would expire", never `ws-expire`; present → the call; `reclaim-paused` → nothing. No writer in the tree, pinned beside `stall-watch-live`. The archived-past-seven-days count on this box is in the deploy note.
- **(F) The switch and the words** (Task 8, after the lane's live arm): `reclaim-paused` the one cleanup switch, the Runs-banner label widened, CCR-15 §5.8's "and nothing else" amended (spec §6 item 1), coordinator clause 3 with its verbatim pin, README and `wave-lifecycle.md` §6, the archive-confirm copy.
- **(G) Operator text** (Tasks 3, 5, 7): a standing `in-use` refusal is expected; after a bounded number of passes it is an attention entry naming the pid, its command and the path; the text never tells an operator to end a pid without naming what it is; the lane never kills.
- **(H) The carried follow-ups** (Tasks 9–11): the archive door's unreadable-store 409 detail, the base's 404 fold, the `already archived` reading, FM7, ws-reap's fresh arm over an unreadable breadcrumb on an archived row, ws-gc's two lines. NOT taken: ws-reclaim's word for an `expire:` breadcrumb (both are retries) — recorded under "Carried out of this wave".
- **(I) Overlaps**: drafted on `origin/main`; every anchor in a file another in-flight wave edits is listed under `## Re-measure at dispatch`, and the coordinator re-verifies the plan on `main` after child reclamation's #290 merges.

## Global Constraints

Copied from `CLAUDE.md`, the spec, wave 3's plan and the ledger where the value matters. Every task's requirements include this section.

- **Base.** Every block below was generated from `origin/main` `77c11245` (wave 3, #286) and replays, unchanged, onto `b3b5a73ed` (`origin/main` when this plan was written: #293, #292, #285 and #294 on top — every block matches exactly once at its turn, and the final tree differs from the `77c11245` one by those PRs' own lines alone: the replay was run on both). Every stage, red list, green list and mutation row was measured on a prototype over `77c11245`, applied stage by stage from these blocks and reproduced byte for byte by the replay check. If a Find block is absent or not unique on your base, `main` moved under it: stop and report rather than improvise an anchor. `## Re-measure at dispatch` lists every block in a file another in-flight wave edits.
- **Deploy class: AGENT-FIRST, through ccrc's own updater; nobody moves a box by hand.** `ccd/ccd` (Tasks 1–3 and 11) must be on the fleet box before a server that composes `ws-expire` runs. The order also costs nothing to get wrong in one direction only: a server on a box whose ccd predates Task 3 reads every audit without `expiresAt` as NO EVIDENCE and composes nothing. The deploy note has the order and the arming.
- **SAFETY — sacred.** Never run a destructive `ccd` verb against the live host: `ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`, `ws-restore`, `ws-reclaim`, `ws-expire` — nor `ws-audit --expire` there (read-only, but this plan never needs it on the box; the deploy note's count read the registry's `.archived` stamps and the existence of `.child` and `.hold`, read-only, counts only, nothing printed or written). Nothing in this plan runs any of them outside a fixture HOME. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*.service` directly; never print a secret file's contents; `gh` stays off the exec whitelist. **This wave's lane composes a verb that deletes worktrees, branches, clips and registry rows: in every test the lane runs against a scripted `runCcd` and a fixture registry, and nothing reaches the live server, agent or registry.** Never touch `$REG/expire-lane-live` on the box: arming is the operator's.
- **Fixture HOMEs only.** Every ccd test runs inside `makePrHarness`'s or `makeCcdHarness`'s HOME. The expiry suites build on `server/test/wsExpireFixture.ts` (`EXP_STUBS`: the unit and pane calls RECORDED, never made; the clock named). Task 2's forced interleaving runs a REAL `ws-audit --expire` and `ws-expire` in a child process of the fixture shell — inside that HOME, under the same stubs.
- **No root `package.json`.** Four packages, each run cd'd in; a package command is a subshell, `( cd server && … )`. **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts --maxWorkers=1` from inside the package; NEVER bare `npx vitest`.** Suites in the FOREGROUND, ONE test file per process for the ccd, hook, doctor and install suites; never two suites at once; `--maxWorkers=1` everywhere. A foreground call on the fleet box is capped below ten minutes, so the whole server suite runs as 24 shards, and a shard — or a file — that outruns a call is split by file, then by its own top-level describes (Task 12 says how).
- **Scratch space and the disk floor.** `TMPDIR` on the project volume, in a directory you create OUTSIDE every git checkout (`<the volume's mount>/scratch-<run>-tmp`), and `CCD_DISK_FLOOR_GB=1`. With `TMPDIR` inside a checkout every fixture repository nests in the outer one and the ladder's `no-worktree-record` case answers `containment-unproven` (wave 3's Pre-flight finding 13). Delete only the fixtures you created.
- **`ccd/ccd` is provenance-STAMPED.** Every step that edits it re-stamps before its test run (the `ownership.test.ts` gate), from the root:

      ~/.local/bin/ccrc restamp ccd/ccd

  (or `node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"`). The blocks never show line 2: the re-stamp writes it.
- **The citation-corpus tax is ZERO in `ccd/ccd`, by construction, and paid once in README.** The frozen compaction-card corpus's highest `ccd/ccd` anchor is `:19131` (re-measure: `grep -ohE '(ccd/ccd:|[`( ,]:)[0-9]+' docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md | grep -oE '[0-9]+$' | sort -n | tail -1`). Every edit this plan makes above it is line-neutral — the `_reg_get` census sentence and its LAST MOVE line (Task 2), `_ws_reap_locked`'s first line and ws-gc's two comment lines and two declines (Task 11) — and everything that needs words lives below it (the EXPIRE region, the MIRROR block). Task 4's `shared/api.ts` insertion moves README's four purge-token anchors; Task 4 repairs them BY CONTENT (wave 3's `readme-reanchor.py` procedure: read the lines off the tree, never add a delta). The five citation cases run after every task that edits a cited file:

      ( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )

  Measured: `5 passed | 330 skipped (335)` at the end of every task; Task 4's green stage before its README repair is the one red (`2 failed | 3 passed | 330 skipped (335)`: `CITATION DEBT` and `README HAS ITS OWN CENSUS`). The cite-remeasure census on the final tree (`cite-remeasure.py <scratch> origin/main`, wave 3's procedure), every figure the test states and the instrument measured: `byFile['ccd/ccd']` 147 and 147; the total 197 and 197; the `|`-row array 55 and the site array 35, with nothing entering or leaving. No literal in `session-hook.test.ts` changes.
- **The `_reg_get` census tax.** `server/test/ccd-reg-get-census.test.ts` holds ccd's sentence "this file makes N invocations across M non-comment lines" to the live count. Task 2 adds two calls on two lines (`archivedreason`, `archived`, in the return gate): measured 192/162 → **194/164**, written over the sentence's digits in place, and the first `THE LAST MOVE WAS` line rewritten one line for one line. No other task adds a `_reg_get "` call (Task 11 changes the text of an existing call's line only). Measure with the header's own commands, never type the numbers from this plan:

      grep -v '^[[:space:]]*#' ccd/ccd | grep -o '_reg_get "' | wc -l    # N
      grep -v '^[[:space:]]*#' ccd/ccd | grep -c '_reg_get "'             # M

- **The die census, the refusal harvests, the word counts.** No `_`-helper gains a `die` (`ccd-die-containment.test.ts` stays at its list). No new refusal word: ws-reap's `reaping-phase-unknown` is reused, and its `"refused":` literal lives in the MIRROR block, which `ccd-wsaudit-nonpoison.test.ts` cuts out (67 unchanged) and outside the EXPIRE region, so the expiry's nineteen-word harvest (Task 5) does not count it. The ccd text bans hold (`branch -D`, `--force` in the reap functions, `STATUS 1 FOLDS SEVERAL CONDITIONS` ×4).
- **Rings and wire.** `server/src/archivedExpiry.ts` is L1: it imports `shared/api.ts` alone (Task 5 pins that). `coord/expireArchived.ts` is the executor (L3, the `coord/childReclaim.ts` shape); `watch.ts` (L4) gathers and applies, deciding nothing. `CoordStatus.expiryAttention` is ADDITIVE and OPTIONAL, read by ONE PWA reader (`expiryAttentionOf`) that reads absence as no items; no `FLEET_PROTO` bump. The archive door's 409 bodies gain `detail` (additive).
- **Mutation-table discipline.** Every new guard ships with a row that reds when the guard is deleted or mutated — measured on this plan's prototype, never guessed. Each task ends with its table: the exact edit, the command and the measured red. Restore every edit (and re-stamp) before the commit.
- **Branch discipline.** Commit on this workspace's own branch, one commit per task, never a separate feature branch. Identity is the repository's noreply address; do not change git config. Before each push: `git log --format='%an <%ae>' origin/main..HEAD | sort -u`.
- **Deviation numbers.** Twelve departures, by slug; the issued block is 4114–4125 (see the callout above). No `D-<n>` token is written for a new number in any code comment, test title or doc this plan touches: the comments name the departure's SLUG where they need one.
- **No hostnames, IPs, tailnet names or docserver URLs** anywhere in the diff (`topology-clean.test.ts`).
- **Overlap (ruling I).** Child reclamation wave 5 (#290, run 260, in review) edits `watch.ts`, `server.ts`, `shared/api.ts`, `README.md`, `childReclaimWords.ts`, `ChildReclaimBanner.tsx`, `child-reclaim-banner.test.tsx` and the CCR-15 spec (§1, §5.5), among the files this plan touches; child reclamation wave 6 (its plan merged as #293) edits `ccd/ccd`, `shared/api.ts`, `watch.ts`, `fleetws.test.ts`, `RunsScreen.tsx` and `childReclaimWords.ts`; session-continuity wave 4 (run 274) edits `ccd/ccd`; stall-watch-settings W1 (its plan merged as #285) edits `shared/api.ts` and `watch.ts`. `ccd/ccd` is shared BY REGION (the ledger's 2026-10-06 07:02 ruling): this wave's regions are the EXPIRE region, the MIRROR block, the return verbs' gate lines, `_ws_reap_locked`'s first line, ws-gc's `archived)`/`reaping)` arms and the `_reg_get` census sentence. Whichever lands second runs `git merge origin/main` (never a rebase), keeps both sides, re-stamps `ccd/ccd`, re-measures the `_reg_get` census, re-runs the five citation cases and `cite-remeasure`, repairs README's anchors by content, and re-runs this plan's suites.

## Review Focus

The inputs a person — or a reviewer looking for a deletion that should not happen — meets first, each pinned in the task that owns it:

1. **Shadow never deletes.** Without `$REG/expire-lane-live` the lane audits and records and never composes `ws-expire`, however long a row has been due (Task 7: `without expire-lane-live …`; Task 6: `SHADOW … ws-expire is never composed`); the executor re-reads the file at the act, so the lane's belief at queue time decides nothing.
2. **The one cleanup switch stops everything.** `reclaim-paused` (or a registry that cannot be listed) means no audit, no record, no verb, live or shadow (Task 7: `no audit, no record, no verb`; Task 6: `reclaim-paused — the one cleanup switch — stops it before ccd is asked anything`).
3. **One at a time.** At most one `ws-expire` per pass, fleet-wide, and never while one is in flight (Task 7: `at most ONE ws-expire …`).
4. **The threshold is ccd's.** A row is audited once per archive to learn `expiresAt`; a young one is not asked again before its instant; a re-archived one is learned afresh; an older ccd is no evidence and nothing is composed (Task 3: `expiresAt is ccd's own threshold`; Task 7: `a YOUNG archive …`, `…unless its archive changes`, `an older ccd's document …`).
5. **3893 is closed.** A REAL expiry forced into the gap between each return verb's gate and its journal line finds the row `not-archived` and takes nothing; with the fix removed, it takes the row (Task 2).
6. **What is never touched.** A child (CCR-15's), a held row (listed), a row an open run names as worker or claimant, a row a review still needs, a row someone is viewing (Task 5's verdict rows; Task 7: `a child …, a held row …, and a row an open run names`; Task 6: `a person at the session defers it, with no ceiling`).
7. **A process in the tree.** A standing `in-use` is asked again every pass, listed after three with the pid, its command and the path, and the sentence says to find out what it is before ending it — the fleet's own tmux server is also a `tmux: server` — and never says kill (Task 3: `inUse` in the document; Task 5: the sentence; Task 7: `after 3 refusals …`).
8. **The box words.** `flock-unavailable` (permanent for that box: the lane composes nothing more there) and `lock-unopenable` (retryable) are read from their stderr shapes — the second MEASURED off the real verb — and never confused with a composition error, which is reported and never retried (Task 5).

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `server/test/ccd-ws-expire-verb.test.ts` (the CONTROL), `ccd/ccd` (the resume header, comment only), wave 3's plan (3964's entry, Task 9A's table), the CCR-15 spec (§6's "Not changed, deliberately"), `deploy/measure-workspace-lifecycle.py` (`close_time`'s docstring) | 1 | review 288's residue, F1–F7 |
| `ccd/ccd` (the return verbs' four gate lines, `_ws_expire_refuse_return`, the seam `_ws_expire_return_gap`, the `_reg_get` census); `server/test/ccd-ws-expire-return-race.test.ts` | 2 | 3893 closed: a return clears the archive inside its gate; the interleaving forced |
| `ccd/ccd` (`_ws_expire_archived`, `_ws_expire_fork_contained`, `_ws_expire_cwd_users`, `_ws_expire_audit_contained`); `server/test/ccd-ws-expire-audit.test.ts` | 3 | the audit carries `expiresAt`, `archivedAt` on `not-expired`, and who is in the tree |
| `shared/api.ts` (`ExpiryAttention`, `CoordStatus.expiryAttention`), `server/src/watch.ts` (`emitCoord`), `README.md` (four anchors, by content); `server/test/fleetws.test.ts` | 4 | the expiry list reaches the coord frame |
| `server/src/archivedExpiry.ts` (new, L1); `server/test/archived-expiry-policy.test.ts` (new) | 5 | the words, the parsers, the one `expiresAt` reader, the verdict, the memory, the attention words |
| `server/src/coord/expireArchived.ts` (new); `server/test/expire-archived.test.ts` (new), `server/test/verb-gate.test.ts` (`CAP_GATED_VERBS`), `server/test/mail-routes.test.ts` (the thirteenth union) | 6 | the one executor and its feed row |
| `server/src/watch.ts` (`sweepArchivedExpiry`, its memory, its tick dispatch), `server/src/coord/expireArchived.ts` (`learnExpiry`); `server/test/archived-expiry-lane.test.ts` (new), `server/test/single-definition.test.ts` (the no-writer pin) | 7 | the lane, shadowed |
| `pwa/src/fleet/expiryWords.ts`, `pwa/src/fleet/ExpiryAttention.tsx` (new), `pwa/src/fleet/ChildReclaimBanner.tsx`, `pwa/src/fleet/childReclaimWords.ts`, `pwa/src/fleet/ArchiveSheet.tsx`, `ccd/coordinator-skill/SKILL.md`, `ccd/coordinator-skill/references/wave-lifecycle.md`, `README.md`, the CCR-15 spec (§5.8), the lifecycle spec (§5.3, §6 item 1); `pwa/test/child-reclaim-banner.test.tsx`, `pwa/test/archive-sheet.test.tsx`, `server/test/coordinator-skill.test.ts`, `server/test/expiry-lane-prose.test.ts` (new) | 8 | the one cleanup switch and the words that move with the live arm |
| `server/src/coord/archiveDoor.ts`, `server/src/server.ts` (the archive route); `server/test/archive-door-decide.test.ts`, `server/test/archive-door.test.ts`, `server/test/routes.test.ts` | 9 | the archive door's carried follow-ups: the store's detail, 503 for an unlistable registry, `already archived` over a live pane |
| `pwa/src/fleet/groupFleet.ts` (`inReleasedFold`); `pwa/test/groupFleet.test.ts` | 10 | FM7: the folds never share a row, by the PWA's own predicates |
| `ccd/ccd` (`_ws_reap_locked`'s first line, `_ws_reap_crumb_unread` in the MIRROR block, ws-gc's two arms); `server/test/ccd-ws-expire-verb.test.ts`, `server/test/ccd-ws-gc.test.ts` | 11 | ws-reap never takes its fresh arm over an unreadable breadcrumb; ws-gc's advice is true |

**Not modified, deliberately:** `ws-reclaim`, its RECLAIM region and its fourteen words (every child-reclamation suite is green on the final tree); `coord/childReclaim.ts`, `childReclaimSweep.ts` and `sweepChildReclaim` (the expiry lane is a sibling, not a branch — the departure `expiry-lane-is-a-sibling-pass`); `coord/store.ts` (the lane's store reads are `lastRunBySession`, `runsNamingSession` and `run`, all on `main`); `server/src/server.ts`'s `Deps` (the lane's tests script `runCcd` rather than add a seam); `RunsScreen.tsx` and `fleet.css` (the expiry list renders inside the cleanup row, in its existing classes); `CLAUDE.md` (its SAFETY list already names `ws-expire` as the server's, from wave 3); the worker and reviewer skills (nothing in them names the lane, and Task 8 pins that no skill file names `expire-lane-live`).

## Pre-flight findings (measured while planning; not departures unless they say so)

Measured on a prototype of this plan's exact edits over `77c11245`, applied stage by stage from these blocks (each task's red stage, its green stage, its tax stage where it has one), with every named suite run at every stage, one file per process, `--maxWorkers=1`. The fleet box ran at a load average of 18 to 25 while it was measured (other workers' suites); a red that is not the step's subject is load until a run in isolation says otherwise.

1. **3893, both remedies measured per verb** (ruling B). The forced interleaving (Task 2's seam, a REAL `ws-audit --expire` then `ws-expire` in a child process between the gate and the journal line) on each of `start`, `enable`, `ensure` (out of a unit and in one) and `swap`:
   - **Without a fix** (the gate released before the journal, as on `main`): the expiry AUDITS `expirable` and EXPIRES the row in all five — Task 2's mutation row T2.1, `5 failed | 3 passed (8)`.
   - **Hold the lock across the journal** (the gate kept until `_spawn_start`'s unarchive, re-entrant in the same process): in the fixture all five refuse the gap's expiry `in-progress`. But the pane of a SUPERVISED return is spawned by the UNIT's own process (`_supervised_start` enables the unit and waits for its pane), and that process's gate meets the lock the returning process still holds: measured with the unit's start stubbed to run `CCD_IN_UNIT=1 cmd_ensure` in a separate process, `start` and `ensure` both answered, from the unit, `another ccd process is expiring, reaping or restoring … and still holds the lock — refusing to create a pane for it mid-cleanup` — every supervised return of an archived row would fail. `swap`'s respawn takes the same unit path (`_svc_start`).
   - **Clear the archive inside the gate** (chosen): all five pass the forced interleaving (`not-archived`, nothing taken), and the same unit-path measurement shows no refusal — the unit's gate finds no archive and takes no lock. It is also the smaller change: one block inside the one helper all four verbs already call, plus the verb's name at each call site. The departure `return-clears-the-archive-inside-the-gate`; its cost is stated there.
   - `ws-restore` has no gap: it takes the same lock before its archive check and keeps it through its own unarchive (`cmd_ws_restore`).
2. **What the first armed pass would face** (ruling E), counted read-only on the fleet box at 2026-10-06 09:34 UTC from the registry's archive stamps (counts only; no contents printed): **30 archived rows, 20 of them past seven days** — 2 of those carry a child marker (the child lane's, never this one's) and none is held. Review 284's R4 names one of the twenty, `ccrc-pwa-brisk-mesa`, as holding a leaked test tmux server in its tree: it will be refused `in-use` on every pass and listed after three.
3. **The nineteen words** (ruling D). The union of the `_reap_refuse <word>` and `"refused":"<word>"` literals in ccd's EXPIRE region and in `_ws_reclaim_ladder`'s body is exactly the nineteen of wave 3's hand-over list: GONE `no-such-session`, `not-archived`; TERMINAL `not-a-workspace`, `branch-elsewhere`, `tree-unreadable`, `containment-unproven`, `no-worktree-record`; RETRY the other twelve. ccd's `ws-audit --expire` journals exactly the TERMINAL five (its `case` list). Task 5 holds both equal to `EXPIRE_TOKEN_KIND`, in both directions.
4. **The verb's pre-lock answers, read off `cmd_ws_expire`.** Its `die` calls (the usage line, `bad token`, `bad session id`, the two `--actor`/`--reason` pairs, `python3 unavailable …`) are all the server's composition errors; its two `_lc_refuse expire "$id" <word>` calls are exactly `flock-unavailable` and `lock-unopenable`. `lock-unopenable`'s REAL shape, measured by running the verb in a fixture HOME with the lock path a directory: exit 1, empty stdout, bash's own `…: line N: <lock>: Is a directory` line and then `ccd: cannot open the reap lock at <lock>` — the shape child reclamation's review 170 measured for `ws-reclaim`.
5. **Review 288's counts, re-measured on `77c11245`** (ruling A): M08 (rung 5's `in-use` probe removed) ladder `17 failed | 37 passed (54)`; M26 (the resume's presence ask at `children`) verb `3 failed | 27 passed (30)`; W1 (3964's `askcwd` never set) verb `2 failed | 28 passed (30)`; W4 (the unit asked at `worktree`) verb `30 passed` before F1 and `1 failed | 29 passed (30)` after it.
6. **The citation census.** README cites no `ccd/ccd` line; every ccd edit above `:19131` is line-neutral; `shared/api.ts`'s insertion (Task 4) moves README's four purge-token anchors to `:7709-7711`, `:7751`, `:7759`, `:7772` on `77c11245` (re-read them by content on your base). `cite-remeasure` on the final tree: unchanged (Global Constraints).
7. **A sibling pass, not a branch** (the departure `expiry-lane-is-a-sibling-pass`). `sweepChildReclaim` returns early when the lifecycle mirror cannot be read, when the box lacks `reclaim-v1` or `reclaim-pause-v1`, and when `reclaim-paused` stands; the first two are no reason to stop an expiry, and an expiry's early returns (no `expire-v1`) are no reason to stop a reclaim. #290 also rewrites much of that method. So the lane is its own method on the same tick, with the same registry read (`records`, `registryRead.names`), the same cadence (`CHILD_RECLAIM_SWEEP_MS`) and the same switch.
8. **The store reads the lane needs are on `main`.** `lastRunBySession(ids)` answers, in ONE statement per pass, which asked sessions an open run names as worker and every open run's claimant; the review rule reads `runsNamingSession(id)` and `run(id)` for a row past its instant only. No new store method.
9. **`mail-routes.test.ts` scans `server/src/coord` for kebab literals.** The executor lives there and spells `would-expire` and `no-evidence` (outcome kinds) — measured red until the thirteenth union (`isArchivedExpiryKebab`, derived from the L1 file's Records) admits them (Task 6, row T6.9).
10. **`single-definition.test.ts` refuses the substring pair `'absent' | 'unreadable'`** outside `shared/agent-protocol.ts`; the L1 file spells the reviewed run's two doubts as two members (`{ kind: 'absent' } | { kind: 'unreadable' }`).

## How to read the blocks

Each edit is a block headed by an HTML comment, `<!-- replay: replace <path> -->` or `<!-- replay: create <path> -->`. A **replace** names its file (`In `<path>`, find:`), shows the text to find — whole lines, occurring EXACTLY ONCE in the file at that point of the plan, earlier blocks already applied — and the text that replaces it; a **create** shows a whole new file. A block's text is the lines between its fences and ends with a newline. Apply the blocks in the order given: Step 1 of each task holds its test edits (the red stage), Step 3 its source edits (the green stage), Step 5 its taxes where it has them. The planner's replay check applied exactly these blocks to `77c11245` — and to `b3b5a73ed` — re-stamping `ccd/ccd` after each stage, and reproduced every stage of the prototype byte for byte (on `b3b5a73ed`, byte for byte but for `main`'s own lines in `single-definition.test.ts`).

---

### Task 1: Review 288's residue — F1 to F7

**Model routing:** `sonnet`, effort `high` — one test pin and six texts; review 288's report is the specification (the coordinator's evidence copy, `review-288-21d510f6.md`).

**Files:** test `server/test/ccd-ws-expire-verb.test.ts`; text `ccd/ccd` (the resume header, a comment), `docs/superpowers/plans/2026-10-04-workspace-lifecycle-wave3-ws-expire.md`, `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`, `deploy/measure-workspace-lifecycle.py`.

**Interfaces:** none change. F1 strengthens a CONTROL; F2–F7 are words, and F5/F6 correct two as-built rows to the measured counts.

- [ ] **Step 0: Install each package's own modules, and the scratch directory**

```bash
( cd server && npm ci ) && ( cd agent && npm ci ) && ( cd pwa && npm ci )
mkdir -p <the volume's mount>/scratch-<run>-tmp   # OUTSIDE every git checkout; export TMPDIR to it, and CCD_DISK_FLOOR_GB=1
```

- [ ] **Step 1: F1 — the CONTROL plants BOTH halves.** Before this, the control at `worktree` planted a pane alone, so a resume that asked the UNIT there (W4) left the file green (review 288 measured `30 passed`). It now plants a unit that answers `active` until the tail's own unsupervise has run: a unit ask at `worktree` refuses `live` and reds the control, and the tail's re-measure after its unsupervise reads it stopped.

<!-- replay: replace server/test/ccd-ws-expire-verb.test.ts -->
In `server/test/ccd-ws-expire-verb.test.ts`, find:

````ts
    const r = expireVerb(h, resumeToken('worktree'));
````

Replace with:

````ts
    // BOTH halves are planted (review 288, F1): a pane, and a unit that answers `active` until the tail's own
    // unsupervise has run. A resume that asked the unit at `worktree` would refuse `live`; the tail stops it, and its
    // re-measure then reads it stopped.
    const r = expireVerb(h, resumeToken('worktree'), {
      pre: '_svc_is_active() { if grep -q "^unsupervise" "$HOME/ccd-calls" 2>/dev/null; then printf inactive; else printf active; fi; };',
    });
````

- [ ] **Step 2: Run it — green, by design.** It pins behaviour `main` already has; row T1.1 is its red.

```bash
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts --maxWorkers=1 )
```

Measured: `server/test/ccd-ws-expire-verb.test.ts`: `30 passed (30)`.

- [ ] **Step 3: F2–F7, the texts.** F2: 3964's entry and ccd's resume header say a pane that came back is itself a cwd user and refuses `in-use` there, never killed — the header's comment grows by two lines inside the EXPIRE region, below `:19131`; the entry gains a continuation line INSIDE its list item, and its own `- **D-3964** … —` line stays byte-identical, because `deviation-refs.test.ts` reads that line shape in EVERY plan, this one's replay blocks included, and a Find and a Replace that quote two different subjects for one number are its red (measured: `1 failed | 30 passed (31)` — no NEW D-<n> carries two different subjects in two different plans — when this plan's first draft edited the line itself). F3: 3964 gets its row in Task 9A's guard table (W1, and W4 now that F1 has made it red). F5/F6, as ruled: M08 and M26 corrected to the whole-file counts, with the note that review 284 quoted 1 and 2. F4: CCR-15's "Not changed, deliberately" qualification gains "or a breadcrumb that stands but cannot be read" — that passage ONLY (#290 edits that spec's §1 and §5.5; the coordinator told child reclamation's coordinator in mail 3655). F7: `close_time`'s list says "among them" and names U+0085 (Python's `float()` strips it, JavaScript's `Number()` does not — measured: `float('\x8512')` is `12.0`, `Number('\u008512')` is `NaN`).

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  # stay the tail's to kill. At `artifacts`, and at `branch` after a `present`
````

Replace with:

````bash
  # stay the tail's to kill — save that a pane which came back runs a shell
  # whose cwd is the standing tree, so it is itself a cwd user and refuses
  # `in-use` here, never killed (review 288, F2). At `artifacts`, and at `branch` after a `present`
````

<!-- replay: replace deploy/measure-workspace-lifecycle.py -->
In `deploy/measure-workspace-lifecycle.py`, find:

````python
    stated, each measured: a hand-written TEXT value in JavaScript's own radix spellings (`0x10`, `0b1`, `0o7`) is a
    number to the server and doubt here; Arabic-Indic digits (U+0661 and its row) and fullwidth digits (U+FF11 and its
    row) are an int here (float() reads any Unicode decimal digit) and NaN, so doubt, on the server; a leading U+FEFF
    (the byte-order mark) is None here (float() does not strip it) and the number on the server (Number() does). No
    writer produces any of them (the server writes closedAt as an integer)."""
````

Replace with:

````python
    stated, each measured, among them: a hand-written TEXT value in JavaScript's own radix spellings (`0x10`, `0b1`, `0o7`) is a
    number to the server and doubt here; Arabic-Indic digits (U+0661 and its row) and fullwidth digits (U+FF11 and its
    row) are an int here (float() reads any Unicode decimal digit) and NaN, so doubt, on the server; a leading U+FEFF
    (the byte-order mark) is None here (float() does not strip it) and the number on the server (Number() does); a
    leading U+0085 (NEL) is the reverse: float() strips it, so `'\\x8512'` is 12 here, and Number() does not, so it is
    NaN, doubt, on the server (review 288, F7). No writer produces any of them (the server writes closedAt as an integer)."""
````

<!-- replay: replace docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md -->
In `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`, find:

````markdown
breadcrumb stands. Their grants and every other refusal stand. See
````

Replace with:

````markdown
breadcrumb stands, or a breadcrumb that stands but cannot be read. Their grants and every other refusal stand. See
````

<!-- replay: replace docs/superpowers/plans/2026-10-04-workspace-lifecycle-wave3-ws-expire.md -->
In `docs/superpowers/plans/2026-10-04-workspace-lifecycle-wave3-ws-expire.md`, find:

````markdown
| The cwd probe: rung 5 refuses `in-use` for a process whose cwd is the worktree or under it (`_ws_expire_cwd_users`) | 3962 | M08, the `in-use` probe removed: ladder 1, "a `sleep` whose cwd IS the worktree refuses in-use" |
| The vanished-arm presence ask: the resume asks at `branch` unless the tombstone reads `present` | 3963 | M14, the vanished-arm presence ask removed: verb 1, "at `branch` on the VANISHED-worktree arm" |
| The resume's presence ask at `children` (the question 3962 widened to the cwd probe) | 3889, 3962 | M26, removed: verb 2, "at `children`, a pane or a unit ... refuses live" and "... refuses in-use" |
| Darwin's kernel proof: a pid is skipped only when `kill(pid, 0)` answers ESRCH, never on `ps`'s exit status or silence | 3962 | M09, Darwin skips a pid without the kernel's ESRCH proof: ladder 7, the `ps` that exits 1 / 2 / 127 / SIGKILL / SIGSEGV / empty "is UNMEASURED - never a skip" |
| The Darwin lsof bound: `WS_EXPIRE_LSOF_DEADLINE_S`, 20 s; a listing that ran out of time is unmeasured | 3962 | no review row; its own red-first is below (the new bound case, 31 s) |
````

Replace with:

````markdown
| The cwd probe: rung 5 refuses `in-use` for a process whose cwd is the worktree or under it (`_ws_expire_cwd_users`) | 3962 | M08, the `in-use` probe removed: ladder 17 failed \| 37 passed (54) — both `sleep` cases, the fake-/proc cases, all eight `ps` cases and the lsof cases, "a `sleep` whose cwd IS the worktree refuses in-use" among them |
| The vanished-arm presence ask: the resume asks at `branch` unless the tombstone reads `present` | 3963 | M14, the vanished-arm presence ask removed: verb 1, "at `branch` on the VANISHED-worktree arm" |
| The resume's presence ask at `children` (the question 3962 widened to the cwd probe) | 3889, 3962 | M26, removed: verb 3 failed \| 27 passed (30), "at `children`, a pane or a unit ... refuses live", "... refuses in-use" and "the resume's live refusal never claims 'no terminal attached'" |
| The resume's `in-use` ask at `worktree`, where the tree may still stand (review 288, F3) | 3964 | W1, the ask's `askcwd=1` never set: verb 2 failed \| 28 passed (30), "at `worktree`, a process with its working directory in the standing tree refuses in-use" and "at `worktree`, a cwd probe that cannot be answered is unmeasured"; W4, the UNIT asked at `worktree` too: verb 1 failed \| 29 passed (30), the CONTROL "at `worktree` the pane and the unit are still the tail's to kill" (review 288, F1: before its unit was planted, W4 was green) |
| Darwin's kernel proof: a pid is skipped only when `kill(pid, 0)` answers ESRCH, never on `ps`'s exit status or silence | 3962 | M09, Darwin skips a pid without the kernel's ESRCH proof: ladder 7, the `ps` that exits 1 / 2 / 127 / SIGKILL / SIGSEGV / empty "is UNMEASURED - never a skip" |
| The Darwin lsof bound: `WS_EXPIRE_LSOF_DEADLINE_S`, 20 s; a listing that ran out of time is unmeasured | 3962 | no review row; its own red-first is below (the new bound case, 31 s) |

**The counts above are MEASURED, whole-file** (review 288's F5 and F6, ruled: a measured count beats a quoted one). Review 284's report quoted M08 as "ladder 1" and M26 as "verb 2" — a single case's count, and an undercount — and the first copy of this table carried those numbers; review 288 and workspace lifecycle wave 3b's planning re-measured both on the merged tree (`77c11245`) and found ladder 17 and verb 3.
````

<!-- replay: replace docs/superpowers/plans/2026-10-04-workspace-lifecycle-wave3-ws-expire.md -->
In `docs/superpowers/plans/2026-10-04-workspace-lifecycle-wave3-ws-expire.md`, find:

````markdown
- **D-3964** `expire-resume-asks-in-use-at-worktree` (fix round 1, run 245, review 284 R2, coordinator ruling (b)) — the tail writes `expire:worktree` BEFORE it removes the tree, so a crash in that window, or a `worktree-remove-failed`, leaves a resume at `worktree` with the tree STANDING; a shell that `cd`'d in since would lose its uncommitted edits to the `git worktree remove --force`. That resume now asks the `in-use` cwd probe (`_ws_expire_cwd_users`, the worktree read from the tombstone's `workdir` as the other resume asks read it) — and ONLY that: the pane and the unit stay the tail's to kill, the interrupted attempt having stopped both — before the tail re-runs, refusing `in-use` (retryable) on a cwd user and unmeasured when the probe cannot be answered, and never killing a process. At `artifacts`, and at `branch` after a `present` tombstone, the tree is already gone and nothing more is asked; a tree gone at `worktree` too (a crash after the removal, before `branch` is written) is vacuously clear. No new refusal word: `in-use` is still spelled only inside `_ws_expire_cwd_users`. Open question 5, answered.
````

Replace with:

````markdown
- **D-3964** `expire-resume-asks-in-use-at-worktree` (fix round 1, run 245, review 284 R2, coordinator ruling (b)) — the tail writes `expire:worktree` BEFORE it removes the tree, so a crash in that window, or a `worktree-remove-failed`, leaves a resume at `worktree` with the tree STANDING; a shell that `cd`'d in since would lose its uncommitted edits to the `git worktree remove --force`. That resume now asks the `in-use` cwd probe (`_ws_expire_cwd_users`, the worktree read from the tombstone's `workdir` as the other resume asks read it) — and ONLY that: the pane and the unit stay the tail's to kill, the interrupted attempt having stopped both — before the tail re-runs, refusing `in-use` (retryable) on a cwd user and unmeasured when the probe cannot be answered, and never killing a process. At `artifacts`, and at `branch` after a `present` tombstone, the tree is already gone and nothing more is asked; a tree gone at `worktree` too (a crash after the removal, before `branch` is written) is vacuously clear. No new refusal word: `in-use` is still spelled only inside `_ws_expire_cwd_users`. Open question 5, answered.
  Review 288 (F2), stated with the entry: a pane that came back runs a shell whose cwd is the standing tree, so it is itself a cwd user at `worktree` — refused `in-use`, never killed; "the pane and the unit stay the tail's to kill" holds only for a pane or unit no process of which stands in the tree.
````

Re-stamp `ccd/ccd`.

- [ ] **Step 4: Run — green.**

```bash
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ws-expire-prose.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/measure-workspace-lifecycle.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ownership.test.ts --maxWorkers=1 )
git fetch origin main
( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
```

Measured: `ccd-ws-expire-verb` `30 passed (30)`; `ws-expire-prose` `7 passed (7)`; `measure-workspace-lifecycle` `11 passed (11)`; `ownership` `14 passed (14)`; `deviation-refs` `31 passed (31)` (on `77c11245`; `main` has since grown it — run it on your base); the citation cases `5 passed | 330 skipped (335)`.

- [ ] **Step 5: Mutation check, then commit.** Rows T1.3 and T1.4 are not this task's new guards: they are the two as-built rows F5/F6 correct, re-measured here so the table's new numbers are this plan's own measurement.

| # | Edit (restore after; re-stamp after a `ccd/ccd` edit) | Measured red |
|---|---|---|
| T1.1 | F1's subject — the resume asks the UNIT at `worktree` too (W4). `ccd/ccd`: `    _ws_expire_cwd_users "$id" "$tombworkdir" \|\| return 1` → `    _ws_expire_presence "$id" gone "$tombworkdir" \|\| return 1` (the `askcwd` arm) | `server/test/ccd-ws-expire-verb.test.ts`: `1 failed \| 29 passed (30)` — the CONTROL: at `worktree` the pane and the unit are still the tail’s to kill — only the cwd probe is asked (3964). Before Step 1 the same edit was green: `30 passed (30)` |
| T1.2 | 3964's own guard (W1, F3's row). `ccd/ccd`: `  elif [[ "$phase" == worktree ]]; then` / `    askcwd=1` → `    :` | `server/test/ccd-ws-expire-verb.test.ts`: `2 failed \| 28 passed (30)` — at `worktree`, a process with its working directory in the standing tree refuses in-use; at `worktree`, a cwd probe that cannot be answered is unmeasured |
| T1.3 | M08, F6's row. `ccd/ccd`: `  _ws_expire_cwd_users "$id" "$workdir"` (the last line of `_ws_expire_presence`) → `  :` | `server/test/ccd-ws-expire-ladder.test.ts`: `17 failed \| 37 passed (54)` |
| T1.4 | M26, F5's row. `ccd/ccd`: `  if [[ "$phase" == children ]]; then` / `    askpresence=1` → `    :` | `server/test/ccd-ws-expire-verb.test.ts`: `3 failed \| 27 passed (30)` — at `children`, a pane or a unit that stands refuses live; …refuses in-use; the resume’s live refusal never claims "no terminal attached" |

```bash
git add server/test/ccd-ws-expire-verb.test.ts ccd/ccd deploy/measure-workspace-lifecycle.py \
  docs/superpowers/plans/2026-10-04-workspace-lifecycle-wave3-ws-expire.md \
  docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md
git commit -m "$(cat <<'MSG'
fix(expire): review 288's residue, F1-F7

F1: the worktree-resume CONTROL plants a running unit too, so a unit ask
there reds it. F2: a pane that came back is itself a cwd user (3964's entry,
the resume header). F3: 3964's mutation row. F4: CCR-15's qualification names
a breadcrumb that stands but cannot be read. F5/F6: the as-built rows carry
the measured counts (M08 ladder 17, M26 verb 3). F7: close_time's list says
"among them" and names U+0085.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: 3893 closed — a return clears the archive inside its gate, and the interleaving is forced

**Model routing:** `opus`, effort `high` — a behaviour change to four return verbs, on the path a deletion races; the forced-interleaving test is the specification.

**Files:** test `server/test/ccd-ws-expire-return-race.test.ts` (new); source `ccd/ccd` (`_ws_expire_refuse_return`, the seam `_ws_expire_return_gap`, the four call sites in `cmd_start`, `cmd_ensure`, `cmd_swap`, `cmd_enable`); tax `ccd/ccd` (the `_reg_get` census).

**Interfaces:**
- Changes: `_ws_expire_refuse_return id verb` (was `id`). On an ARCHIVED row — when the gate took the reap lock — it journals `_lc_done unarchive <id> "" verb <verb> meas.mode return meas.archivedAt <epoch> meas.archivedReason <reason>` and runs `_ws_unarchive`, BEFORE it releases the lock; then it calls `_ws_expire_return_gap <id>`. Every refusal it made before is unchanged (an `expire:` breadcrumb, an unreadable breadcrumb on an archived row, a held lock on an archived row: `die`, nothing journaled).
- Produces: `_ws_expire_return_gap() { :; }` — a seam, a no-op on the box.
- Consequence, stated (the departure `return-clears-the-archive-inside-the-gate`): the archive is cleared on the ATTEMPT, as `cmd_start` and `cmd_ensure` already clear the stop stamp on the attempt. A return that passes the gate and then fails for another reason (a pool refusal raised after it, a spawn failure, a swap refused for its target) leaves a stopped, UNARCHIVED workspace at the top of its card, with Archive offered again; its seven days start again only when it is archived again. Before this wave the same failing spawn cleared the archive one step later, in `_spawn_start`. The §9 instrument reads the `unarchive` row as the return it is.

- [ ] **Step 1: Write the failing test.** The seam is redefined to run a REAL expiry — `ws-audit --expire`, then `ws-expire` with the audit's token — in a child process, between the gate and the return's journal line; the CONTROL proves the seam can expire a row no return has touched.

<!-- replay: create server/test/ccd-ws-expire-return-race.test.ts -->
Create `server/test/ccd-ws-expire-return-race.test.ts`:

````ts
// 3893's RESIDUAL, CLOSED (workspace lifecycle wave 3b's precondition; spec 2026-09-24 §5.3, "A return during an
// expiry refuses, on every path"). The return verbs — `start`, `enable`, `ensure` (in a unit and out) and `swap` —
// asked the reap gate (`_ws_expire_refuse_return`) and RELEASED it before their own journal line, so an expiry that
// took the lock inside that gap tore the workspace down while the return went on to journal itself `done` (and a
// minutes-long `swap` wrote registry fields onto the purged row). Now the return CLEARS THE ARCHIVE INSIDE THE GATE:
// while it holds `$REG/.reap-<id>.lock`, an archived row is unarchived (journaled `unarchive`, as `_spawn_start`
// journals it), so an expiry that takes the lock next refuses `not-archived` and touches nothing.
//
// THE INTERLEAVING IS FORCED, not hoped for: `_ws_expire_return_gap` is the seam ccd calls right after the gate is
// released — a no-op on the box — and each case here redefines it to run a REAL expiry (`ws-audit --expire`, then
// `ws-expire` with the audit's token) in a child process, exactly where a concurrent sweep would land. ws-restore is
// not here: it holds the same lock from its check through its unarchive (`cmd_ws_restore`), so it has no gap.
// FIXTURE HOME ONLY: the expiry is destructive, and every unit and pane call is recorded, never made.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import { CHILD_ENV } from './childReclaimFixture.js';
import { EXP_ID, EXP_STUBS, makeArchived, type Archived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-expire-race-'); });
afterEach(() => { h.cleanup(); });

/** The return verb's own spawn, stopped at the pane: the fixture's tmux model answers every `new-session` with a
 *  failure, so nothing is ever created; `sleep` and the first-run prompts are no-ops, and there is no systemctl. */
const RETURN_STUBS = 'sleep() { :; }; _accept_first_run_prompts() { return 0; }; _have_systemctl() { return 1; };';

/** THE GAP, FORCED: a real expiry, in a child process, between the gate and the return's journal line. Its audit
 *  document and its verb's answer are written to the HOME for the case to read. */
const GAP = `_ws_expire_return_gap() { ( ${CHILD_ENV};`
  + ` cmd_ws_audit --session ${EXP_ID} --expire > "$HOME/gap-audit.json" 2>/dev/null;`
  + ' tok=$(python3 -c \'import json,sys; print(json.load(open(sys.argv[1])).get("token",""))\' "$HOME/gap-audit.json" 2>/dev/null);'
  + ` if [[ -n "$tok" ]]; then cmd_ws_expire --expect "$tok" --session ${EXP_ID} > "$HOME/gap-expire.json" 2>&1; fi ); };`;

const auditVerdict = (): string =>
  String((JSON.parse(fs.readFileSync(path.join(h.home, 'gap-audit.json'), 'utf8')) as { verdict?: unknown }).verdict);

/** Runs a return verb with the gap forced, answering instead of throwing. */
const ret = (snippet: string): { code: number; out: string } => {
  const r = h.run(`${EXP_STUBS} ${RETURN_STUBS} ${GAP} ${snippet} 2>&1`);
  return { code: r.code, out: r.stdout + r.stderr };
};

/** The expiry in the gap took nothing: the row, its worktree and its branch stand, nothing was expired, and the
 *  gap's audit read the row as no longer archived. */
const survived = (a: Archived): void => {
  expect(auditVerdict(), 'the expiry in the gap found the row returned').toBe('not-archived');
  expect(fs.existsSync(path.join(h.home, 'gap-expire.json')), 'no ws-expire was ever composed').toBe(false);
  expect(h.reg(EXP_ID, 'uuid'), 'the registry row stands').not.toBeNull();
  expect(fs.existsSync(a.wt), 'the worktree stands').toBe(true);
  expect(eventsOf(h.home, 'expire').filter((e) => e['outcome'] === 'done'), 'nothing was expired').toEqual([]);
  expect(h.reg(EXP_ID, 'archived'), 'the archive was cleared by the return').toBeNull();
};

/** The archive was cleared by the RETURN, inside its gate, and journaled as `_spawn_start` journals it. */
const unarchivedBy = (verb: string): void => {
  const un = eventsOf(h.home, 'unarchive').filter((e) => e['outcome'] === 'done');
  expect(un, 'one unarchive').toHaveLength(1);
  expect(un[0]!['verb'], 'journaled under the return verb').toBe(verb);
  expect(measOf(un[0]!)['archivedAt'], 'with the archive it ended').toMatch(/^[1-9][0-9]+$/);
};

describe('3893: an expiry forced into the gap between a return\'s gate and its journal line takes nothing', () => {
  it('start <id>', () => {
    const a = makeArchived(h);
    ret(`cmd_start ${EXP_ID}`);
    survived(a);
    unarchivedBy('start');
  }, 120_000);

  it('enable <id> — which journals `enable` before it reaches start', () => {
    const a = makeArchived(h);
    ret(`cmd_enable ${EXP_ID}`);
    survived(a);
    unarchivedBy('enable');
  }, 120_000);

  it('ensure, outside a unit — what Revive, attach and menu reach', () => {
    const a = makeArchived(h);
    ret(`cmd_ensure ${EXP_ID}`);
    survived(a);
    unarchivedBy('ensure');
  }, 120_000);

  it('ensure in its unit — the supervise ExecStart\'s path', () => {
    const a = makeArchived(h);
    ret(`CCD_IN_UNIT=1 cmd_ensure ${EXP_ID}`);
    survived(a);
    unarchivedBy('ensure');
  }, 120_000);

  it('swap — a slow swap never writes registry fields onto a purged row', () => {
    const a = makeArchived(h);
    const wrapper = h.reg(EXP_ID, 'wrapper');
    const target = wrapper === 'claude-b' ? 'claude-a' : 'claude-b';
    ret(`cmd_swap ${EXP_ID} ${target}`);
    survived(a);
    unarchivedBy('swap');
    // Whatever the swap went on to do in this fixture, it did it to a row that still has its identity.
    expect(h.reg(EXP_ID, 'workdir'), 'the row is whole').toBe(a.wt);
  }, 120_000);

  it('the CONTROL: the forced gap is a REAL expiry — run on an archived row no return has touched, it expires it', () => {
    const a = makeArchived(h);
    h.run(`${EXP_STUBS} ${GAP} _ws_expire_return_gap 2>&1`);
    expect(auditVerdict()).toBe('expirable');
    expect(fs.readFileSync(path.join(h.home, 'gap-expire.json'), 'utf8')).toContain(`"expired":"${EXP_ID}"`);
    expect(h.reg(EXP_ID, 'uuid'), 'the row is gone').toBeNull();
    expect(fs.existsSync(a.wt), 'and its worktree').toBe(false);
  }, 120_000);
});

describe('the seam and the call sites', () => {
  const src = fs.readFileSync(CCD, 'utf8');
  const bodyOf = (name: string): string => {
    const from = src.indexOf(`\n${name}() {`);
    return src.slice(from, src.indexOf('\n}\n', from));
  };

  it('`_ws_expire_return_gap` is a no-op on the box, defined once, and called after the gate is released', () => {
    expect([...src.matchAll(/^_ws_expire_return_gap\(\) \{/gm)], 'defined once').toHaveLength(1);
    expect(src).toMatch(/^_ws_expire_return_gap\(\) \{ :; \}/m);
    const body = bodyOf('_ws_expire_refuse_return');
    expect(body.indexOf('_ws_expire_return_gap "$1"'), 'called').toBeGreaterThan(body.indexOf('_ws_expire_spawn_release'));
    expect(body.indexOf('_ws_unarchive "$1"'), 'the archive is cleared before the lock is given back')
      .toBeLessThan(body.indexOf('_ws_expire_spawn_release'));
  });

  it('every return verb names itself to the gate, before its journal line', () => {
    for (const [verb, word, act] of [['cmd_start', 'start', '_lc_done start'], ['cmd_ensure', 'ensure', '_lc_done ensure'],
      ['cmd_swap', 'swap', '_lc_done swap'], ['cmd_enable', 'enable', '_lc_done enable']] as const) {
      const body = bodyOf(verb);
      const ask = body.indexOf(`_ws_expire_refuse_return "$id" ${word}`);
      expect(ask, `${verb} asks, naming itself`).toBeGreaterThan(0);
      expect(ask, `${verb} asks before it journals`).toBeLessThan(body.indexOf(act));
    }
  });
});
````

- [ ] **Step 2: Run it — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-return-race.test.ts --maxWorkers=1 )
```

Measured: `server/test/ccd-ws-expire-return-race.test.ts`: `7 failed | 1 passed (8)` — the five return cases (the seam is never called, so no gap file), and both census cases; the CONTROL passes. Row T2.1 is the red of the fix itself, with the seam present.

- [ ] **Step 3: Make it pass.** The verb's name at each of the four call sites; the unarchive inside the gate; the seam after the release.

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  fi

  _ws_expire_refuse_return "$id"   # a return during an expiry refuses, before anything is journaled (EXPIRE region)
  if _alive "$id"; then
````

Replace with:

````bash
  fi

  _ws_expire_refuse_return "$id" start   # a return during an expiry refuses, before anything is journaled (EXPIRE region)
  if _alive "$id"; then
````

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  [[ -f "$REG/$id.uuid" ]] || die "no registry for '$id' (run ccd start first)"
  _ws_expire_refuse_return "$id"   # a return during an expiry refuses, before anything is journaled (EXPIRE region)
````

Replace with:

````bash
  [[ -f "$REG/$id.uuid" ]] || die "no registry for '$id' (run ccd start first)"
  _ws_expire_refuse_return "$id" ensure   # a return during an expiry refuses, before anything is journaled (EXPIRE region)
````

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  [[ -f "$REG/$id.uuid" ]] || die "no registry for '$id'"
  _ws_expire_refuse_return "$id"   # a return during an expiry refuses, before anything is journaled (EXPIRE region)
````

Replace with:

````bash
  [[ -f "$REG/$id.uuid" ]] || die "no registry for '$id'"
  _ws_expire_refuse_return "$id" swap   # a return during an expiry refuses, before anything is journaled (EXPIRE region)
````

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  _ws_expire_refuse_return "$id"   # a return during an expiry refuses, before anything is journaled (EXPIRE region)
````

Replace with:

````bash
  _ws_expire_refuse_return "$id" enable   # a return during an expiry refuses, before anything is journaled (EXPIRE region)
````

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
_ws_expire_refuse_return() {   # id -> returns 0 when nothing refuses a return; else DIES with the sentence. It
  #                                dies on an `expire:` breadcrumb, on a breadcrumb that stands but cannot be read
  #                                (an ARCHIVED row only) and on a held reap lock (an ARCHIVED row only)
````

Replace with:

````bash
_ws_expire_refuse_return() {   # id verb -> returns 0 when nothing refuses a return; else DIES with the sentence.
  #                                It dies on an `expire:` breadcrumb, on a breadcrumb that stands but cannot be
  #                                read (an ARCHIVED row only) and on a held reap lock (an ARCHIVED row only); on an
  #                                archived row it CLEARS THE ARCHIVE before it lets the lock go (3893, closed)
````

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  # A RESIDUAL, DISCLOSED (3893; carried to wave 3b). The gate is taken and
  # RELEASED here, before the verb's own journal line, so an expiry that wins the
  # lock inside that gap leaves the refused return journaled as `done`, and a
  # minutes-long `swap` can write registry fields onto a purged row. No pane
  # returns — `_spawn_start`'s backstop refuses, holding the lock across the
  # unarchive — and nothing is lost: the pin precedes every delete. Closing it
  # holds the lock across the journal, or clears the archive at the verb: a
  # behaviour change to four verbs, beyond this wave.
  _ws_expire_spawn_gate "$1" || die "$_WS_EXPIRE_SPAWN_WHY"
  _ws_expire_spawn_release
}
````

Replace with:

````bash
  # 3893, CLOSED (workspace lifecycle wave 3b, before its lane composes the
  # verb). The gate used to be taken and RELEASED here, before the verb's own
  # journal line, so an expiry that won the lock inside that gap tore the row
  # down while the return went on to journal itself `done`, and a minutes-long
  # `swap` wrote registry fields onto the purged row. Now the RETURN CLEARS THE
  # ARCHIVE INSIDE THE GATE, while it holds the reap lock — as `_spawn_start`
  # clears it, and journaled as `unarchive` under this verb's name — so an
  # expiry that takes the lock next finds the row `not-archived` and refuses,
  # touching nothing. On the attempt, as `cmd_start` and `cmd_ensure` clear the
  # stop stamp: a return that then fails for another reason leaves a stopped,
  # UNARCHIVED workspace at the top of its card, whose seven days start again
  # only when it is archived again. Holding the lock across the journal instead
  # was measured and refused: an `ensure` of a supervised row, and a `swap`,
  # spawn the pane from the UNIT's own process, whose gate would then refuse
  # against the lock this process still held (the departure
  # `return-clears-the-archive-inside-the-gate`). A box with no flock takes no
  # lock here and so clears nothing — and runs no expiry either
  # (`cmd_ws_expire` refuses there); `_spawn_start` clears it as before.
  _ws_expire_spawn_gate "$1" || die "$_WS_EXPIRE_SPAWN_WHY"
  if [[ -n "$_WS_EXPIRE_SPAWN_FD" && -f "$REG/$1.archived" ]]; then
    local archreason; archreason=$(_reg_get "$1" archivedreason)
    _lc_done unarchive "$1" "" verb "${2:-return}" meas.mode return \
      meas.archivedAt "$(_reg_get "$1" archived)" meas.archivedReason "$archreason"
    _ws_unarchive "$1"
  fi
  _ws_expire_spawn_release
  _ws_expire_return_gap "$1"
}

# THE SEAM AFTER THE GATE: nothing on the box. A test redefines it to force an
# expiry into the exact gap 3893 named — between a return's gate and its
# journal line — and proves the expiry finds nothing to take.
_ws_expire_return_gap() { :; }
````

Re-stamp `ccd/ccd`.

- [ ] **Step 4: Run — green**, and every suite that drives a return verb on an archived row.

```bash
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-return-race.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-spawn.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-unarchive-on-spawn.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-restore-reap-lock.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-die-containment.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-lifecycle-sites.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-lifecycle-contain.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-operator-choice.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-lifecycle-purge.test.ts --maxWorkers=1 )
```

Measured (before Step 5's census tax, `ccd-reg-get-census` is red — that is the tax): `ccd-ws-expire-return-race` `8 passed (8)`; `ccd-ws-expire-spawn` `17 passed (17)`; `ccd-unarchive-on-spawn` `7 passed (7)`; `ccd-restore-reap-lock` `4 passed (4)`; `ccd-die-containment` `12 passed (12)`; `ccd-refusal-scan` `11 passed (11)`; `ccd-lifecycle-sites` `29 passed (29)`; `ccd-lifecycle-contain` `12 passed (12)` (no new `meas.` key: `mode`, `archivedAt`, `archivedReason` are `_spawn_start`'s); `ccd-workspaces` `81 passed (81)`; `ccd-archive` `77 passed (77)`; `ccd-operator-choice` `64 passed (64)`; `ccd-lifecycle-purge` `63 passed (63)`.

- [ ] **Step 5: The `_reg_get` census tax.** Measure N and M with the header's commands (192/162 → 194/164 on `77c11245`), write them over the sentence's digits, and rewrite the first `THE LAST MOVE WAS` line in place, one line for one line:

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
# and the reason is a count rather than a preference: this file makes 192
# invocations across 162 non-comment lines.
#
# THE LAST MOVE WAS the EXPIRE region's reads (workspace lifecycle wave 3), the +10; before it the operator-choice reads (session-continuity wave 3), the +3; before that the rescue wait's reads (session-continuity wave 2), the +3;
````

Replace with:

````bash
# and the reason is a count rather than a preference: this file makes 194
# invocations across 164 non-comment lines.
#
# THE LAST MOVE WAS the return gate's unarchive (workspace lifecycle wave 3b), the +2; before it the EXPIRE region's reads (workspace lifecycle wave 3), the +10; before it the operator-choice reads (session-continuity wave 3), the +3; before that the rescue wait's reads (session-continuity wave 2), the +3;
````

Re-stamp, then:

```bash
( cd server && ./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ownership.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
```

Measured: `ccd-reg-get-census` `3 passed (3)`; `ownership` `14 passed (14)`; the citation cases `5 passed | 330 skipped (335)`.

- [ ] **Step 6: Mutation check, then commit.**

| # | Edit (restore after; re-stamp) | Measured red |
|---|---|---|
| T2.1 | The fix removed, the seam kept — the gate released before the journal, as on `main`. `ccd/ccd`: `  if [[ -n "$_WS_EXPIRE_SPAWN_FD" && -f "$REG/$1.archived" ]]; then` → `  if false; then` | `server/test/ccd-ws-expire-return-race.test.ts`: `5 failed \| 3 passed (8)` — start; enable; ensure outside a unit; ensure in its unit; swap (in each, the expiry in the gap audited `expirable` and took the row) |
| T2.2 | The lock given back BEFORE the unarchive (the order the census case pins). `ccd/ccd`: `  _ws_expire_spawn_release` moved from below the `if … fi` to directly under the gate line | `server/test/ccd-ws-expire-return-race.test.ts`: `6 failed \| 2 passed (8)` — the five return cases (with the lock released first, `_WS_EXPIRE_SPAWN_FD` is empty, nothing is unarchived, and the expiry takes the row) and `_ws_expire_return_gap` is a no-op on the box, defined once, and called after the gate is released |
| T2.3 | Hold the lock across the journal instead (the other remedy, Pre-flight finding 1): `_ws_expire_refuse_return` keeps `_WS_EXPIRE_SPAWN_FD` (no unarchive, no release) and `_ws_expire_spawn_gate` returns 0 at once while it is held | `server/test/ccd-ws-expire-return-race.test.ts`: `6 failed \| 2 passed (8)` (the five `not-archived` assertions — the expiry there refused `in-progress` instead — and the census case); and the unit-path measurement in Pre-flight finding 1 refuses every supervised return |

```bash
git add server/test/ccd-ws-expire-return-race.test.ts ccd/ccd
git commit -m "$(cat <<'MSG'
fix(expire): a return clears the archive inside its reap gate (3893 closed)

start, enable, ensure and swap asked the gate and released it before their
journal line, so an expiry that won the lock in that gap took the row while
the return journaled itself done. The gate now unarchives an archived row
while it holds the lock (journaled unarchive under the verb's name), so the
next expiry refuses not-archived. A seam after the release lets a test force
a real expiry into the gap. Holding the lock across the journal instead was
measured and refused: a supervised return spawns its pane from the unit's
own process, whose gate would refuse against it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: The audit carries the threshold — `expiresAt`, `archivedAt` on `not-expired`, and who is in the tree

**Model routing:** `sonnet`, effort `high` — ccd's document, additive; the server's reader of it is Task 5's.

**Files:** test `server/test/ccd-ws-expire-audit.test.ts`; source `ccd/ccd` (the EXPIRE region: `_ws_expire_archived`, `_ws_expire_fork_contained`, `_ws_expire_cwd_users`, `_ws_expire_audit_contained`).

**Interfaces:**
- Changes: `ccd ws-audit --session <id> --expire` prints `{"session","mode":"expire","archivedAt":<int>|null,"expiresAt":<int>|null,"alive","exists","reaping","sensitive",["resume",]["inUse",]"verdict","detail"[,"token"]}`. `archivedAt` is the archive AS READ — set on `not-expired` too (it was null there, wave 3's Carried row) — and `expiresAt` is `archivedAt + WS_EXPIRE_AFTER_S`, from the ONE definition in the EXPIRE region; both null when no archive could be read as an epoch. `inUse` — present on an `in-use` refusal only — is `[{"pid":<int>,"comm":<string>,"cwd":<string>}…]`, at most five, `comm` `""` when the box could not read it. The `in-use` detail sentence names the command: `process <pid> (<comm>) has its working directory at <path>`.
- Produces: `EXPIRE_STAMP_AT` (the stamp as read; reset by the fork) and `EXPIRE_IN_USE` (the JSON members), EXPIRE-region globals. No verdict changes, no word added, no journal line changes.

- [ ] **Step 1: Write the failing tests.**

<!-- replay: replace server/test/ccd-ws-expire-audit.test.ts -->
In `server/test/ccd-ws-expire-audit.test.ts`, find:

````ts
  EXP_ID, EXP_STUBS, NOW, OLD, archiveAt, expireAudit, expireEvalOf, expireToken, expireVerb, holdCwd, makeArchived,
````

Replace with:

````ts
  EXP_ID, EXP_STUBS, NOW, OLD, WEEK, archiveAt, expireAudit, expireEvalOf, expireToken, expireVerb, holdCwd, makeArchived,
````

<!-- replay: replace server/test/ccd-ws-expire-audit.test.ts -->
In `server/test/ccd-ws-expire-audit.test.ts`, find:

````ts
    expect(Object.keys(doc)).toEqual(['session', 'mode', 'archivedAt', 'alive', 'exists', 'reaping', 'sensitive', 'verdict', 'detail', 'token']);
    expect(doc).toMatchObject({ session: EXP_ID, mode: 'expire', archivedAt: OLD, alive: false, exists: true, reaping: null, verdict: 'expirable' });
````

Replace with:

````ts
    expect(Object.keys(doc)).toEqual(['session', 'mode', 'archivedAt', 'expiresAt', 'alive', 'exists', 'reaping', 'sensitive', 'verdict', 'detail', 'token']);
    expect(doc).toMatchObject({ session: EXP_ID, mode: 'expire', archivedAt: OLD, expiresAt: OLD + WEEK, alive: false, exists: true, reaping: null, verdict: 'expirable' });
````

<!-- replay: replace server/test/ccd-ws-expire-audit.test.ts -->
In `server/test/ccd-ws-expire-audit.test.ts`, find:

````ts
    expect(gone['archivedAt']).toBeNull();
````

Replace with:

````ts
    expect(gone['archivedAt']).toBeNull();
    expect(gone['expiresAt'], 'no archive, no instant').toBeNull();
  }, 60_000);

  // WAVE 3b's THRESHOLD, CARRIED BY THE DOCUMENT (the coordinator's ruling (C)): the server never types the seven
  // days. `expiresAt` is `archivedAt + WS_EXPIRE_AFTER_S`, from the ONE ccd definition, on `expirable` AND on
  // `not-expired` — whose `archivedAt` is now set too, since the stamp WAS read (wave 3's Carried row).
  it('`not-expired` carries the archive it read and the instant it expires', () => {
    makeArchived(h);
    archiveAt(h, NOW - 60);
    const young = JSON.parse(expireAudit(h).stdout) as Record<string, unknown>;
    expect(young['verdict']).toBe('not-expired');
    expect(young['archivedAt']).toBe(NOW - 60);
    expect(young['expiresAt']).toBe(NOW - 60 + WEEK);
  }, 60_000);

  it('`expiresAt` is ccd’s own threshold: raise WS_EXPIRE_AFTER_S and the instant moves with it', () => {
    makeArchived(h);
    const doc = JSON.parse(expireAudit(h, { pre: 'WS_EXPIRE_AFTER_S=1209600;' }).stdout) as Record<string, unknown>;
    expect(doc['verdict'], 'eight days old is young against fourteen').toBe('not-expired');
    expect(doc['expiresAt']).toBe(OLD + 1_209_600);
  }, 60_000);

  it('a refusal PAST the age still carries both — the lane reads when it became due, whatever holds it', () => {
    makeArchived(h);
    fs.writeFileSync(reg('hold'), 'x');
    const doc = JSON.parse(expireAudit(h).stdout) as Record<string, unknown>;
    expect(doc['verdict']).toBe('held');
    expect(doc).toMatchObject({ archivedAt: OLD, expiresAt: OLD + WEEK });
````

<!-- replay: replace server/test/ccd-ws-expire-audit.test.ts -->
In `server/test/ccd-ws-expire-audit.test.ts`, find:

````ts
    expect(doc['token']).toBeUndefined();
    expect(r.stderr).toContain('ws-audit --expire measured nothing');
````

Replace with:

````ts
    expect(doc['token']).toBeUndefined();
    expect(doc['archivedAt'], 'a stamp that is not an epoch is no archive').toBeNull();
    expect(doc['expiresAt'], 'and no instant').toBeNull();
    expect(r.stderr).toContain('ws-audit --expire measured nothing');
````

<!-- replay: replace server/test/ccd-ws-expire-audit.test.ts -->
In `server/test/ccd-ws-expire-audit.test.ts`, find:

````ts
    } finally { sleeper.stop(); }
````

Replace with:

````ts
      // WHAT IT IS, NOT ONLY ITS NUMBER (the coordinator's ruling (G)): the lane's operator text names the pid, its
      // command and the path, because the fleet's own tmux server is also a `tmux: server` and a pid alone invites
      // the wrong kill. The document carries them as data; the detail sentence names the command too.
      expect(doc['inUse']).toEqual([{ pid: sleeper.pid, comm: 'sleep', cwd: fs.realpathSync(a.wt) }]);
      expect(String(doc['detail'])).toContain(`process ${sleeper.pid} (sleep) has its working directory at `);
    } finally { sleeper.stop(); }
  }, 60_000);

  it('`inUse` appears only on an `in-use` refusal', () => {
    makeArchived(h);
    expect(JSON.parse(expireAudit(h).stdout)['inUse']).toBeUndefined();
````

- [ ] **Step 2: Run them — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-audit.test.ts --maxWorkers=1 )
```

Measured: `server/test/ccd-ws-expire-audit.test.ts`: `7 failed | 10 passed (17)`
  - × prints mode, archivedAt and the SAME token the ladder mints
  - × a refusal carries no token, and archivedAt is null when no archive could be read
  - × `not-expired` carries the archive it read and the instant it expires
  - × `expiresAt` is ccd’s own threshold: raise WS_EXPIRE_AFTER_S and the instant moves with it
  - × a refusal PAST the age still carries both — the lane reads when it became due, whatever holds it
  - × a probe that could not RUN exits 1 — the document says unmeasured, no token, and nothing is journaled
  - × a `sleep` with its cwd in the worktree

- [ ] **Step 3: Make them pass.** The stamp as read (`EXPIRE_STAMP_AT`, beside `EXPIRE_ARCHIVED_AT`, which keeps its meaning: the archive old enough to act on); the command read for each process the probe names (inside the python, so still no fork per process; a command that cannot be read is `""` and changes no verdict — the python is single-quoted bash, so its comments carry no apostrophe); the document's three keys.

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
    || { _ws_reclaim_unmeasured "the archive stamp at $f cannot be read as an epoch (it reads '$arch')"; return 1; }
````

Replace with:

````bash
    || { _ws_reclaim_unmeasured "the archive stamp at $f cannot be read as an epoch (it reads '$arch')"; return 1; }
  EXPIRE_STAMP_AT="$arch"   # the archive AS READ, old enough or not: the audit's `archivedAt` and `expiresAt` (wave 3b)
````

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
    sys.exit(3)
def scan():
````

Replace with:

````bash
    sys.exit(3)
def comm_of(pid):
    # WHAT IT IS, for the operator text (wave 3b, ruling G of its coordinator):
    # the fleet tmux server is a `tmux: server` too, so a pid is never
    # named without its command. DESCRIPTIVE ONLY: a command that cannot be read
    # is "" and changes no verdict.
    try:
        if mode == "proc":
            with open("%s/%s/comm" % (root, pid), "rb") as fh:
                c = fh.read().decode("utf-8", "replace")
        else:
            c = subprocess.run(["ps", "-o", "comm=", "-p", pid], capture_output=True, text=True).stdout
    except Exception:
        return ""
    return " ".join(c.split())
def scan():
````

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
        sys.stdout.buffer.write(os.fsencode("%s\t%s\n" % (pid, p)))
````

Replace with:

````bash
        sys.stdout.buffer.write(os.fsencode("%s\t%s\t%s\n" % (pid, comm_of(pid), p)))
````

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  while IFS=$'\t' read -r pid pth; do
    n=$(( n + 1 ))
    (( n > 5 )) || shown+="${shown:+, }process $pid has its working directory at $pth"
````

Replace with:

````bash
  while IFS=$'\t' read -r pid comm pth; do
    n=$(( n + 1 ))
    (( n > 5 )) && continue
    shown+="${shown:+, }process $pid${comm:+ ($comm)} has its working directory at $pth"
    EXPIRE_IN_USE+=("{\"pid\":$pid,\"comm\":$(_json_str "$comm"),\"cwd\":$(_json_str "$pth")}")
````

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  local id="$1" rbc
  RECLAIM_RESUME_PHASE=""
````

Replace with:

````bash
  local id="$1" rbc
  RECLAIM_RESUME_PHASE=""; EXPIRE_STAMP_AT=""; EXPIRE_IN_USE=()
````

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  printf '{"session":%s,"mode":"expire","archivedAt":%s,"alive":%s,"exists":%s,"reaping":%s,"sensitive":%s,' \
    "$(_json_str "$id")" "$( _ws_expire_epoch_ok "$EXPIRE_ARCHIVED_AT" && echo "$EXPIRE_ARCHIVED_AT" || echo null)" \
    "$aliveflag" "$exists" "$( [[ -n "$reaping" ]] && _json_str "$reaping" || echo null)" "$sens"
  [[ -n "$RECLAIM_RESUME_PHASE" ]] && printf '"resume":%s,' "$(_json_str "$RECLAIM_RESUME_PHASE")"
````

Replace with:

````bash
  # `archivedAt` is the archive AS READ — on `not-expired` too — and `expiresAt`
  # is the instant it becomes expirable, `archivedAt + WS_EXPIRE_AFTER_S`, from
  # the ONE definition above: the server reads the threshold here and never
  # types its own (wave 3b; the kill rule raises this constant and nothing
  # else). Both null when no archive could be read as an epoch.
  local stamp=null expires=null
  if _ws_expire_epoch_ok "$EXPIRE_STAMP_AT"; then stamp="$EXPIRE_STAMP_AT"; expires=$(( EXPIRE_STAMP_AT + WS_EXPIRE_AFTER_S )); fi
  printf '{"session":%s,"mode":"expire","archivedAt":%s,"expiresAt":%s,"alive":%s,"exists":%s,"reaping":%s,"sensitive":%s,' \
    "$(_json_str "$id")" "$stamp" "$expires" \
    "$aliveflag" "$exists" "$( [[ -n "$reaping" ]] && _json_str "$reaping" || echo null)" "$sens"
  [[ -n "$RECLAIM_RESUME_PHASE" ]] && printf '"resume":%s,' "$(_json_str "$RECLAIM_RESUME_PHASE")"
  # WHO IS IN IT (an `in-use` refusal only): pid, command and cwd, at most five.
  if [[ "$REAP_VERDICT" == in-use && ${#EXPIRE_IN_USE[@]} -gt 0 ]]; then
    local IFS=,; printf '"inUse":[%s],' "${EXPIRE_IN_USE[*]}"; unset IFS
  fi
````

Re-stamp `ccd/ccd`.

- [ ] **Step 4: Run — green**, and every suite that reads the probe's detail or the document.

```bash
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-audit.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-ladder.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/wsaudit.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-wsaudit-nonpoison.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-die-containment.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ownership.test.ts --maxWorkers=1 )
```

Measured: `ccd-ws-expire-audit` `17 passed (17)`; `ccd-ws-expire-ladder` `54 passed (54)`; `ccd-ws-expire-verb` `30 passed (30)`; `wsaudit` `25 passed (25)`; `ccd-wsaudit-nonpoison` `3 passed (3)`; `ccd-reg-get-census` `3 passed (3)` (no `_reg_get` call added); `ccd-die-containment` `12 passed (12)`; `ccd-refusal-scan` `11 passed (11)`; `ownership` `14 passed (14)`.

- [ ] **Step 5: Mutation check, then commit.**

| # | Edit (restore after; re-stamp) | Measured red |
|---|---|---|
| T3.1 | The threshold TYPED instead of read. `ccd/ccd`: `expires=$(( EXPIRE_STAMP_AT + WS_EXPIRE_AFTER_S ))` → `expires=$(( EXPIRE_STAMP_AT + 604800 ))` | `server/test/ccd-ws-expire-audit.test.ts`: `1 failed \| 16 passed (17)` — `expiresAt` is ccd’s own threshold: raise WS_EXPIRE_AFTER_S and the instant moves with it |
| T3.2 | The stamp recorded only once it is old enough (the old `not-expired` null). `ccd/ccd`: the `  EXPIRE_STAMP_AT="$arch"   # …` line removed, and `  EXPIRE_ARCHIVED_AT="$arch"` → `  EXPIRE_ARCHIVED_AT="$arch"; EXPIRE_STAMP_AT="$arch"` | `server/test/ccd-ws-expire-audit.test.ts`: `2 failed \| 15 passed (17)` — `not-expired` carries the archive it read and the instant it expires; `expiresAt` is ccd’s own threshold … |
| T3.3 | The command never read. `ccd/ccd`: `(pid, comm_of(pid), p)` → `(pid, "", p)` | `server/test/ccd-ws-expire-audit.test.ts`: `1 failed \| 16 passed (17)` — a `sleep` with its cwd in the worktree |

```bash
git add server/test/ccd-ws-expire-audit.test.ts ccd/ccd
git commit -m "$(cat <<'MSG'
feat(expire): the audit carries expiresAt, archivedAt on not-expired, and who is in the tree

ws-audit --expire's document gains expiresAt (archivedAt + WS_EXPIRE_AFTER_S,
from the one ccd definition) on every answer that read an archive, sets
archivedAt on not-expired, and names an in-use refusal's processes (pid,
command, cwd) — so the server never types the threshold, and its operator
text can say what a process is before anyone ends it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: The expiry list reaches the coord frame — `ExpiryAttention`, `CoordStatus.expiryAttention`

**Model routing:** `sonnet`, effort `medium` — an additive wire field, its emitter, and the citation tax its insertion owes.

**Files:** test `server/test/fleetws.test.ts`; source `shared/api.ts`, `server/src/watch.ts` (`emitCoord`, one field); tax `README.md` (four anchors, by content).

**Interfaces:**
- Produces (L0): `ExpiryAttention { sessionId; kind: 'would-expire'|'held'|'in-use'|'refused'|'failing'|'no-evidence'; sentence; archivedAt (s); expiresAt (s) | null; at (ms) }`, and `CoordStatus.expiryAttention?: readonly ExpiryAttention[]` — OPTIONAL: an older server omits it and the PWA's one reader (Task 8) reads absence as no items. ADDITIVE; no `FLEET_PROTO` bump.
- Changes: `emitCoord` sends `expiryAttention: this.expiryAttentionList` on both arms (`[]` until the lane's first pass, Task 7). `childReclaimAttention` is untouched: child reclamation wave 5's chip reads that list and the child lane's map, and never this one.

- [ ] **Step 1: Write the failing test** — the frame's ten equalities gain the field.

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
      expect(frame.coord).toEqual({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [] });
````

Replace with:

````ts
      expect(frame.coord).toEqual({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [] });
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
      expect(frame.coord).toEqual({ pause: 'set', mail: 'clear', reclaim: 'clear', childReclaimAttention: [] });
````

Replace with:

````ts
      expect(frame.coord).toEqual({ pause: 'set', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [] });
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
      expect((await next()).coord).toEqual({ pause: 'clear', mail: 'set', reclaim: 'clear', childReclaimAttention: [] });

      marker('coordinator-paused');
      await watcher.tick();
      expect((await next()).coord).toEqual({ pause: 'set', mail: 'set', reclaim: 'clear', childReclaimAttention: [] });
````

Replace with:

````ts
      expect((await next()).coord).toEqual({ pause: 'clear', mail: 'set', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [] });

      marker('coordinator-paused');
      await watcher.tick();
      expect((await next()).coord).toEqual({ pause: 'set', mail: 'set', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [] });
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
        { pause: 'clear', mail: 'clear', reclaim: 'set', childReclaimAttention: [] });

      marker('coordinator-paused');
      await watcher.tick();
      expect((await next()).coord).toEqual(
        { pause: 'set', mail: 'clear', reclaim: 'set', childReclaimAttention: [] });
````

Replace with:

````ts
        { pause: 'clear', mail: 'clear', reclaim: 'set', childReclaimAttention: [], expiryAttention: [] });

      marker('coordinator-paused');
      await watcher.tick();
      expect((await next()).coord).toEqual(
        { pause: 'set', mail: 'clear', reclaim: 'set', childReclaimAttention: [], expiryAttention: [] });
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
      expect(frame.type).toBe('coord');
      expect(frame.coord).toEqual({ pause: 'unmeasurable', mail: 'unmeasurable', reclaim: 'unmeasurable', childReclaimAttention: [] });
      ws.close();
````

Replace with:

````ts
      expect(frame.type).toBe('coord');
      expect(frame.coord).toEqual({ pause: 'unmeasurable', mail: 'unmeasurable', reclaim: 'unmeasurable', childReclaimAttention: [], expiryAttention: [] });
      ws.close();
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
      expect((await next()).coord).toEqual({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [] });
````

Replace with:

````ts
      expect((await next()).coord).toEqual({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [] });
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
      expect(frame.coord).toEqual({ pause: 'unmeasurable', mail: 'unmeasurable', reclaim: 'unmeasurable', childReclaimAttention: [] });
````

Replace with:

````ts
      expect(frame.coord).toEqual({ pause: 'unmeasurable', mail: 'unmeasurable', reclaim: 'unmeasurable', childReclaimAttention: [], expiryAttention: [] });
````

<!-- replay: replace server/test/fleetws.test.ts -->
In `server/test/fleetws.test.ts`, find:

````ts
      expect((await next()).coord).toEqual({ pause: 'set', mail: 'clear', reclaim: 'clear', childReclaimAttention: [] });
````

Replace with:

````ts
      expect((await next()).coord).toEqual({ pause: 'set', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], expiryAttention: [] });
````

- [ ] **Step 2: Run it — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/fleetws.test.ts --maxWorkers=1 )
```

Measured: `server/test/fleetws.test.ts`: `6 failed | 48 passed (54)` — the six cases whose equalities the frame now fails (sends coord after hello/fleet/runs on connect; re-emits only on CHANGE; reports set for coordinator-paused and clear for mail-disabled independently; reports set for reclaim-paused; reports unmeasurable for BOTH markers; emits coord on the tick that FAILS SHUT).

- [ ] **Step 3: Make it pass.**

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts
  ChildReclaimAttention, CoordStatus, Dialog, FleetSession, HookAsk, HookAskQuestion, LifecycleHealth,
````

Replace with:

````ts
  ChildReclaimAttention, CoordStatus, Dialog, ExpiryAttention, FleetSession, HookAsk, HookAskQuestion, LifecycleHealth,
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts
  private childReclaimAttentionList: readonly ChildReclaimAttention[] = [];
````

Replace with:

````ts
  private childReclaimAttentionList: readonly ChildReclaimAttention[] = [];
  /** The expiry lane's attention list (workspace lifecycle wave 3b) as `sweepArchivedExpiry` last derived it from its
   *  own memory — never child reclamation's list, so nothing that reads that one sees an expiry. `[]` until the lane's
   *  first pass. */
  private expiryAttentionList: readonly ExpiryAttention[] = [];
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts
          childReclaimAttention: this.childReclaimAttentionList }
      : { pause: names.includes(COORDINATOR_PAUSE_MARKER) ? 'set' : 'clear',
          mail: names.includes(MAIL_DISABLED_MARKER) ? 'set' : 'clear',
          reclaim: names.includes(RECLAIM_PAUSE_MARKER) ? 'set' : 'clear',
          childReclaimAttention: this.childReclaimAttentionList };
````

Replace with:

````ts
          childReclaimAttention: this.childReclaimAttentionList, expiryAttention: this.expiryAttentionList }
      : { pause: names.includes(COORDINATOR_PAUSE_MARKER) ? 'set' : 'clear',
          mail: names.includes(MAIL_DISABLED_MARKER) ? 'set' : 'clear',
          reclaim: names.includes(RECLAIM_PAUSE_MARKER) ? 'set' : 'clear',
          childReclaimAttention: this.childReclaimAttentionList, expiryAttention: this.expiryAttentionList };
````

<!-- replay: replace shared/api.ts -->
In `shared/api.ts`, find:

````ts

/** The three markers the coordination lane is governed by, read together
````

Replace with:

````ts

/** One ARCHIVED WORKSPACE the expiry lane reports (workspace lifecycle spec 2026-09-24 §5.3, wave 3b): one the lane
 *  WOULD clean up while it runs shadowed (`would-expire`), one held past its seven days (`held`), one a process keeps
 *  (`in-use`, after it has stood a few passes), one ccd refused for good (`refused`), one whose cleanup keeps failing
 *  (`failing`), and one whose fleet box cannot say when it expires (`no-evidence`). A REPORT, never a tap. NEVER
 *  child reclamation's: its own list, so wave 5's run chip cannot see it. `sentence` is the SERVER's — the pid, the
 *  command and the path of an `in-use` row among them — and the PWA renders it. `archivedAt` and `expiresAt` are
 *  epoch SECONDS, ccd's (`expiresAt` is ccd's own `archivedAt + WS_EXPIRE_AFTER_S`, null when the box did not say);
 *  `at` (epoch ms, the server's clock) is since when this report stands — kept in the lane's memory, so a restart
 *  rebuilds it on the passes that follow rather than reading it back. */
export interface ExpiryAttention {
  readonly sessionId: string;
  readonly kind: 'would-expire' | 'held' | 'in-use' | 'refused' | 'failing' | 'no-evidence';
  readonly sentence: string;
  readonly archivedAt: number;
  readonly expiresAt: number | null;
  readonly at: number;
}

/** The three markers the coordination lane is governed by, read together
````

<!-- replay: replace shared/api.ts -->
In `shared/api.ts`, find:

````ts
  childReclaimAttention: readonly ChildReclaimAttention[];
````

Replace with:

````ts
  childReclaimAttention: readonly ChildReclaimAttention[];
  /** The expiry lane's own list (wave 3b). OPTIONAL on the wire: an older server omits it, and the PWA's one reader
   *  (`pwa/src/fleet/expiryWords.ts`) reads absence as no items. */
  expiryAttention?: readonly ExpiryAttention[];
````

- [ ] **Step 4: Run — green; the citation tax reds.**

```bash
( cd server && ./node_modules/.bin/vitest run test/fleetws.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
```

Measured: `fleetws` `54 passed (54)`; the citation cases `2 failed | 3 passed | 330 skipped (335)` — × THE CITATION DEBT this task creates is measured, per cited file; × README HAS ITS OWN CENSUS ENTRY, and it is EMPTY (`a README anchor stopped naming what its own sentence quotes`: `shared/api.ts:7688-7690`, …). That is the tax.

- [ ] **Step 5: Pay it — README re-anchored BY CONTENT.** Read the four lines off the tree — the three union arms by MEMBER name (`  | 'purge-refused'`, `  | 'purge-incomplete'`, `  | 'purge-mechanism-absent'`) and the three map keys (`  'purge-refused':` and its two siblings) — and write those line numbers into README's one sentence; never add a delta to a number. On `77c11245` that is `:7709-7711`, `:7751`, `:7759`, `:7772`:

<!-- replay: replace README.md -->
In `README.md`, find:

````markdown
`purge-mechanism-absent` (`shared/api.ts:7688-7690`), each with an operator sentence of its own at `:7730`,
`:7738` and `:7751`, which the session History tab renders through `lcRefusalWord`
````

Replace with:

````markdown
`purge-mechanism-absent` (`shared/api.ts:7709-7711`), each with an operator sentence of its own at `:7751`,
`:7759` and `:7772`, which the session History tab renders through `lcRefusalWord`
````

```bash
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
```

Measured: `5 passed | 330 skipped (335)`. (`cite-remeasure` on the repaired tree: every stated figure unchanged — Global Constraints.)

- [ ] **Step 6: Mutation check, then commit.**

| # | Edit (restore after) | Measured red |
|---|---|---|
| T4.1 | The emitter drops the field. `server/src/watch.ts`: both arms' `, expiryAttention: this.expiryAttentionList` removed | `server/test/fleetws.test.ts`: `6 failed \| 48 passed (54)` (Step 2's six) |
| T4.2 | README left unrepaired. `README.md`: Step 5's block reverted | the citation cases: `2 failed \| 3 passed \| 330 skipped (335)` (Step 4's two) |

```bash
git add server/test/fleetws.test.ts shared/api.ts server/src/watch.ts README.md
git commit -m "$(cat <<'MSG'
feat(expire): the expiry attention list rides the coord frame

ExpiryAttention (L0) and CoordStatus.expiryAttention, additive and optional,
emitted beside childReclaimAttention and never inside it. README's four
shared/api.ts anchors re-read by content (S6-R11).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: The expiry's decisions — one L1 file

**Model routing:** `opus`, effort `high` — every eligibility conjunct, every document read and every memory step of a lane that deletes; pure, so every fail direction is a test row.

**Files:** test `server/test/archived-expiry-policy.test.ts` (new); source `server/src/archivedExpiry.ts` (new).

**Interfaces** (all exported from `server/src/archivedExpiry.ts`, which imports `shared/api.ts` and nothing else):
- `EXPIRE_LANE_LIVE_MARKER = 'expire-lane-live'` — the live switch's ONE spelling in `server/src` (Task 7 pins that nothing writes it).
- `ExpireToken` (the nineteen), `EXPIRE_TOKEN_KIND: Record<ExpireToken, 'gone'|'terminal'|'retry'>`, `expireTokenKind(token)` (total; `null` for a word this build does not know), `ExpireBoxWord = 'flock-unavailable'|'lock-unopenable'`.
- `EXPIRE_IN_USE_ATTENTION_PASSES = 3`, `EXPIRE_NO_EVIDENCE_RETRY_MS` (1 h), `EXPIRE_SHADOW_REAUDIT_MS` (15 min), `EXPIRE_FAILURE_CEILING_MS` (1 h), `EXPIRE_AUDITS_PER_PASS = 3` — the lane's own pacing; none is the expiry's threshold, which is ccd's alone.
- `ExpireInUse { pid; comm; cwd }`; `ExpiresAtRead = { kind:'at'; at } | { kind:'none' } | { kind:'absent' }` and `expireAuditExpiresAt(doc)` — THE ONE READER of the audit's `expiresAt` (ruling C): `absent` is an older ccd, NO EVIDENCE; `none` is ccd saying it read no archive; never folded.
- `parseExpireAudit(sessionId, ok, stdout): ExpireAuditRead` — any exit 1 is `unreadable`; another session's document, another mode's, a token that is not 64 hex and an unknown verdict are `unreadable`.
- `parseExpireResult(sessionId, stdout, stderr): ExpireVerbRead` — `expired` | `refused` | `failed` (`resumable` false for `probe-unmeasured`) | `box` (`flock-unavailable`: that one `ccd:` line; `lock-unopenable`: bash's line for the lock path, then ccd's) | `composition` (the verb's argument `die`s, anchored whole) — never decided by an empty stdout alone.
- `ExpiryStoreRead`, `ArchivedExpiryInput`, `ArchivedExpirySkip`, `ArchivedExpiryVerdict`, `archivedExpiryVerdict(input)`, `reviewKeeps(reviewed)`.
- `ArchivedExpiryEntry`, `ExpiryReport`, `archivedExpiryEntry`, `archivedExpiryEntryFor`, `archivedExpiryLearned`, `archivedExpirySighted`, `archivedExpiryDue`, `ArchivedExpiryDeferWhy`, `ArchivedExpiryOutcome`, `archivedExpiryOutcomeKey`, `archivedExpiryBackoffMs`, `archivedExpiryNextEntry`, `isArchivedExpiryKebab`.
- `expiryInUseSentence(inUse, passes)`, `expiryReportSentence(report, expiresAt)`, `expiryAttention(entries): ExpiryAttention[]`.

- [ ] **Step 1: Write the failing tests.** The nineteen words are HARVESTED from ccd (the EXPIRE region and `_ws_reclaim_ladder`'s body) and held equal to the map in both directions; the audit's journaled case list is held equal to the TERMINAL arm; the verb's pre-lock answers are read off `cmd_ws_expire` itself, and `lock-unopenable`'s shape is MEASURED by running the real verb in a fixture HOME.

<!-- replay: create server/test/archived-expiry-policy.test.ts -->
Create `server/test/archived-expiry-policy.test.ts`:

````ts
// The expiry lane's DECISIONS, table-driven (workspace lifecycle spec 2026-09-24 §5.3 "The lane", wave 3b).
// `archivedExpiry.ts` is L1: every verdict, parser and memory step is a pure function, so every fail direction is a row
// here. The words are held to ccd's own text in both directions, as `CHILD_RECLAIM_TOKEN_KIND` is held to the RECLAIM
// region; the box words and the composition dies are read off `cmd_ws_expire` itself, and lock-unopenable's shape is
// MEASURED by running the real verb in a fixture HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CCD } from './ccdWsHelpers.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { EXP_ID, expireVerb, makeArchived } from './wsExpireFixture.js';
import {
  EXPIRE_FAILURE_CEILING_MS, EXPIRE_IN_USE_ATTENTION_PASSES, EXPIRE_LANE_LIVE_MARKER, EXPIRE_NO_EVIDENCE_RETRY_MS,
  EXPIRE_SHADOW_REAUDIT_MS, EXPIRE_TOKEN_KIND, archivedExpiryDue, archivedExpiryEntry, archivedExpiryEntryFor,
  archivedExpiryLearned, archivedExpiryNextEntry, archivedExpirySighted, archivedExpiryVerdict, expireAuditExpiresAt,
  expireTokenKind, expiryAttention, expiryInUseSentence, parseExpireAudit, parseExpireResult, reviewKeeps,
  type ArchivedExpiryEntry, type ArchivedExpiryInput,
} from '../src/archivedExpiry.js';

const ID = 'demo-quiet-dune';
const TOK = 'a'.repeat(64);
const PASS = 60_000;
const NOW = 1_790_000_000_000;
const ccd = readFileSync(CCD, 'utf8');
const nonComment = (t: string): string => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const words = (t: string): Set<string> => new Set([
  ...[...t.matchAll(/_reap_refuse ([a-z][a-z-]*)/g)].map((m) => m[1]!),
  ...[...t.matchAll(/"refused":"([a-z][a-z-]*)"/g)].map((m) => m[1]!),
]);
const bodyOf = (name: string): string => {
  const from = ccd.indexOf(`\n${name}() {`);
  expect(from, `${name} is in ccd`).toBeGreaterThan(-1);
  return ccd.slice(from, ccd.indexOf('\n}\n', from));
};

describe('the nineteen words', () => {
  it('are exactly what ccd’s EXPIRE region and the shared ladder refuse with — harvested, both directions', () => {
    const begin = ccd.indexOf('EXPIRE-BEGIN');
    const end = ccd.indexOf('EXPIRE-END');
    expect(begin, 'the EXPIRE region is missing its BEGIN marker').toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    const harvested = new Set([...words(nonComment(ccd.slice(begin, end))), ...words(nonComment(bodyOf('_ws_reclaim_ladder')))]);
    expect(harvested.size, 'guards the guard: an empty harvest would equal an empty map').toBeGreaterThan(10);
    expect([...harvested].sort()).toEqual(Object.keys(EXPIRE_TOKEN_KIND).sort());
  });

  it('the audit journals exactly the TERMINAL words — ccd’s case list equals the kind map’s terminal arm', () => {
    const matches = [...ccd.matchAll(
      /case "\$REAP_VERDICT" in\n\s+([a-z|-]+)\)\n\s+_lc_emit expire refused "\$id" "" verb ws-audit/g,
    )];
    expect(matches, 'the expiry audit no longer journals a terminal refusal, or a second site appeared').toHaveLength(1);
    const terminal = Object.entries(EXPIRE_TOKEN_KIND).filter(([, k]) => k === 'terminal').map(([t]) => t).sort();
    expect(terminal.length).toBeGreaterThan(0);
    expect(matches[0]![1]!.split('|').sort()).toEqual(terminal);
  });

  it('GONE is the row leaving the population, and nothing else', () => {
    expect(Object.entries(EXPIRE_TOKEN_KIND).filter(([, k]) => k === 'gone').map(([t]) => t).sort())
      .toEqual(['no-such-session', 'not-archived']);
  });

  it('a word this build was never compiled to know has no kind — never terminal, never gone', () => {
    expect(expireTokenKind('toString')).toBeNull();
    expect(expireTokenKind('expire-in-progress'), 'ws-reap’s word, not the expiry’s').toBeNull();
    expect(expireTokenKind('in-use')).toBe('retry');
  });

  it('the live switch is spelled once, as the file the operator touches', () => {
    expect(EXPIRE_LANE_LIVE_MARKER).toBe('expire-lane-live');
  });
});

describe('the audit document — `expiresAt` through ONE reader', () => {
  const doc = (verdict: string, extra: Record<string, unknown> = {}): string => JSON.stringify({
    session: ID, mode: 'expire', archivedAt: 1_789_000_000, expiresAt: 1_789_604_800, alive: false, exists: true,
    reaping: null, sensitive: ['.env'], verdict, detail: '', ...extra,
  });

  it('three answers, never folded: the instant, ccd saying none, and an older ccd that said nothing', () => {
    expect(expireAuditExpiresAt({ expiresAt: 1_789_604_800 })).toEqual({ kind: 'at', at: 1_789_604_800 });
    expect(expireAuditExpiresAt({ expiresAt: null })).toEqual({ kind: 'none' });
    expect(expireAuditExpiresAt({ archivedAt: 1 })).toEqual({ kind: 'absent' });
    expect(expireAuditExpiresAt({ expiresAt: '1789604800' }), 'a string is not ccd’s arithmetic').toEqual({ kind: 'none' });
    expect(expireAuditExpiresAt({ expiresAt: 1.5 })).toEqual({ kind: 'none' });
  });

  it('reads a token, the archive, the instant and how many secret-shaped paths would be dropped', () => {
    expect(parseExpireAudit(ID, true, doc('expirable', { token: TOK }))).toEqual({
      kind: 'document', archivedAt: 1_789_000_000, expiresAt: { kind: 'at', at: 1_789_604_800 }, sensitive: 1, inUse: [],
      verdict: { kind: 'expirable', token: TOK } });
  });

  it('reads a refusal by its word, and an in-use refusal’s processes', () => {
    const inUse = [{ pid: 42, comm: 'tmux: server', cwd: '/w/demo/quiet-dune' }];
    expect(parseExpireAudit(ID, true, doc('in-use', { detail: 'process 42 …', inUse }))).toMatchObject({
      kind: 'document', inUse, verdict: { kind: 'refused', token: 'in-use', detail: 'process 42 …' } });
  });

  it('an exit-1 document is never spent, whatever it says — nor another session’s, another mode’s, or an unknown word', () => {
    expect(parseExpireAudit(ID, false, doc('expirable', { token: TOK })).kind).toBe('unreadable');
    expect(parseExpireAudit('other', true, doc('expirable', { token: TOK })).kind).toBe('unreadable');
    expect(parseExpireAudit(ID, true, doc('expirable', { token: TOK, mode: 'reclaim' })).kind).toBe('unreadable');
    expect(parseExpireAudit(ID, true, doc('expirable', { token: 'short' })).kind).toBe('unreadable');
    expect(parseExpireAudit(ID, true, doc('newer-word')).kind).toBe('unreadable');
    expect(parseExpireAudit(ID, true, 'ccd: usage').kind).toBe('unreadable');
  });

  it('a document from a ccd that predates `expiresAt` reads as no evidence', () => {
    const old = JSON.parse(doc('expirable', { token: TOK })) as Record<string, unknown>;
    delete old['expiresAt'];
    const r = parseExpireAudit(ID, true, JSON.stringify(old));
    expect(r.kind === 'document' && r.expiresAt).toEqual({ kind: 'absent' });
  });
});

describe('the verb’s answer — box words told apart from composition errors (wave 3’s hand-over)', () => {
  const region = bodyOf('cmd_ws_expire');
  /** The message a ccd `die "…"` or `_lc_refuse expire "$id" <word> "…"` prints, anchored to the call. */
  const calls = (): { word: string | null; text: string }[] => {
    const re = /\bdie "((?:[^"\\]|\\.)*)"|_lc_refuse\s+expire\s+"\$id"\s+(\S+)[\s\\]*"((?:[^"\\]|\\.)*)"/g;
    return [...region.matchAll(re)].map((m) => (m[1] !== undefined ? { word: null, text: m[1] } : { word: m[2]!, text: m[3]! }));
  };

  it('every `die` before the lock is a COMPOSITION error — the server’s, never a failed document', () => {
    const dies = calls().filter((c) => c.word === null).map((c) => c.text);
    expect(dies.length, 'the usage, the token, the session id, python3, the dec flags').toBeGreaterThanOrEqual(5);
    for (const text of dies) {
      // A `$` in a die is `_LC_DEC_MAX`'s byte cap; render it as the box would.
      const msg = text.replace('$_LC_DEC_MAX', '1024');
      expect(parseExpireResult(ID, '', `ccd: ${msg}`), msg).toEqual({ kind: 'composition', detail: msg });
    }
  });

  it('the two `_lc_refuse` words are the two BOX words, and flock-unavailable reads as itself', () => {
    const refusals = calls().filter((c) => c.word !== null);
    expect(refusals.map((c) => c.word).sort()).toEqual(['flock-unavailable', 'lock-unopenable']);
    const flock = refusals.find((c) => c.word === 'flock-unavailable')!.text;
    expect(parseExpireResult(ID, '', `ccd: ${flock}`)).toEqual({ kind: 'box', word: 'flock-unavailable', detail: flock });
  });

  describe('lock-unopenable, measured for real', () => {
    let h: PrHarness;
    beforeEach(() => { h = makePrHarness('ccrc-expiry-policy-lockdie-'); });
    afterEach(() => { h.cleanup(); });

    it('the real verb’s stdout, stderr and exit read as the RETRYABLE box word', () => {
      makeArchived(h);
      const lock = path.join(h.home, '.cc-sessions', `.reap-${EXP_ID}.lock`);
      mkdirSync(lock, { recursive: true });
      const r = expireVerb(h, TOK);
      expect(r.code, r.stderr).toBe(1);
      expect(r.stdout, 'nothing on stdout — the shape an empty-stdout rule would misread').toBe('');
      expect(parseExpireResult(EXP_ID, r.stdout, r.stderr))
        .toEqual({ kind: 'box', word: 'lock-unopenable', detail: `cannot open the reap lock at ${lock}` });
    }, 60_000);
  });

  it('a bash line naming ANOTHER path, or trailing content, is not the box word', () => {
    expect(parseExpireResult(ID, '', '/x/ccd: line 9: /other.lock: Is a directory\nccd: cannot open the reap lock at /real.lock').kind)
      .toBe('failed');
    expect(parseExpireResult(ID, '', 'ccd: cannot open the reap lock at /real.lock\nmore').kind).toBe('failed');
  });

  it('the three documents, and an empty answer that is no die is a call cut short — resumable', () => {
    expect(parseExpireResult(ID, JSON.stringify({ expired: ID, archivedAt: 1_789_000_000, wip: null, attic: 3,
      residueBytes: 0, secretsDropped: 0 }), '')).toEqual({ kind: 'expired', archivedAt: 1_789_000_000, wip: null, secretsDropped: 0 });
    expect(parseExpireResult(ID, JSON.stringify({ refused: 'in-use', detail: 'p', paths: [] }), ''))
      .toEqual({ kind: 'refused', token: 'in-use', detail: 'p' });
    expect(parseExpireResult(ID, JSON.stringify({ failed: 'pin-failed', detail: 'x' }), ''))
      .toEqual({ kind: 'failed', resumable: true, detail: 'pin-failed: x' });
    expect(parseExpireResult(ID, JSON.stringify({ failed: 'probe-unmeasured', detail: 'x' }), ''))
      .toEqual({ kind: 'failed', resumable: false, detail: 'probe-unmeasured: x' });
    expect(parseExpireResult(ID, '', '')).toMatchObject({ kind: 'failed', resumable: true });
    expect(parseExpireResult(ID, JSON.stringify({ expired: 'other' }), '').kind, 'another row’s expiry').toBe('failed');
  });
});

describe('archivedExpiryVerdict — every conjunct, every doubt ineligible', () => {
  const base: ArchivedExpiryInput = {
    sessionId: ID, workspace: 'ws/quiet-dune', archivedAt: 1_789_000_000, child: { kind: 'none' }, identityMeasured: true,
    held: null, store: { ok: true, openWorker: false, openClaimant: false, reviewing: false },
    expiresAt: 1_789_604_800, nowMs: 1_789_604_800_000,
  };
  it.each([
    ['a main checkout', { workspace: null }, 'not-a-workspace'],
    ['no archive', { archivedAt: null }, 'not-archived'],
    ['a marked child', { child: { kind: 'child', runId: 7 } }, 'child'],
    ['an unreadable marker', { child: { kind: 'unreadable' } }, 'child'],
    ['an unmeasured identity', { identityMeasured: false }, 'identity-unmeasured'],
    ['an unreadable store', { store: { ok: false, detail: 'x' } }, 'store-unreadable'],
    ['an open run naming it as worker', { store: { ok: true, openWorker: true, openClaimant: false, reviewing: false } }, 'open-run'],
    ['an open run naming it as claimant', { store: { ok: true, openWorker: false, openClaimant: true, reviewing: false } }, 'coordinating'],
    ['a review whose reviewed run is open', { store: { ok: true, openWorker: false, openClaimant: false, reviewing: true } }, 'review-open'],
    ['an instant nobody has read yet', { expiresAt: null }, 'expiry-unknown'],
    ['one second short of the instant', { nowMs: 1_789_604_799_999 }, 'not-yet'],
    ['held, past the instant', { held: 'program:x wave:1/2' }, 'held'],
  ] as const)('%s → %s', (_why, over, why) => {
    expect(archivedExpiryVerdict({ ...base, ...over } as ArchivedExpiryInput)).toEqual({ eligible: false, why });
  });
  it('AT the instant, with every conjunct clear, it is eligible', () => {
    expect(archivedExpiryVerdict(base)).toEqual({ eligible: true });
  });
  it('a review run keeps its row while the run it reviewed is open, unreadable or absent', () => {
    expect(reviewKeeps({ kind: 'run', state: 'working' })).toBe(true);
    expect(reviewKeeps({ kind: 'unreadable' })).toBe(true);
    expect(reviewKeeps({ kind: 'absent' })).toBe(true);
    expect(reviewKeeps({ kind: 'run', state: 'done' })).toBe(false);
    expect(reviewKeeps({ kind: 'run', state: 'failed' })).toBe(false);
  });
});

describe('the lane’s memory of one row', () => {
  const learnedDoc = (expiresAt: unknown, archivedAt = 1_789_000_000) => parseExpireAudit(ID, true, JSON.stringify({
    session: ID, mode: 'expire', archivedAt, ...(expiresAt === undefined ? {} : { expiresAt }), sensitive: [],
    verdict: 'not-expired', detail: '' }));

  it('a row returned and archived again starts a fresh entry — nothing learned about one archive applies to another', () => {
    const e = { ...archivedExpiryEntry(1_789_000_000), expiresAt: 1_789_604_800 };
    expect(archivedExpiryEntryFor(e, 1_789_000_000)).toBe(e);
    expect(archivedExpiryEntryFor(e, 1_789_500_000)).toEqual(archivedExpiryEntry(1_789_500_000));
  });

  it('learns ccd’s instant; an older ccd is no evidence, reported and asked again only after an hour', () => {
    const e = archivedExpiryEntry(1_789_000_000);
    expect(archivedExpiryLearned(e, learnedDoc(1_789_604_800), NOW, PASS))
      .toMatchObject({ expiresAt: 1_789_604_800, nextAskAt: 0 });
    expect(archivedExpiryLearned(e, learnedDoc(undefined), NOW, PASS))
      .toMatchObject({ expiresAt: null, nextAskAt: NOW + EXPIRE_NO_EVIDENCE_RETRY_MS, report: { kind: 'no-evidence' } });
    expect(archivedExpiryLearned(e, learnedDoc(null), NOW, PASS)).toMatchObject({ expiresAt: null, report: null });
    expect(archivedExpiryLearned(e, learnedDoc(1_789_604_800, 1_789_500_000), NOW, PASS),
      'an audit of a DIFFERENT archive teaches nothing').toMatchObject({ expiresAt: null, nextAskAt: NOW + PASS });
  });

  it('twice observed: an eligible pass seeds, a later one makes it due, and any other verdict ends the run', () => {
    const e0 = { ...archivedExpiryEntry(1_789_000_000), expiresAt: 1_789_604_800 };
    const e1 = archivedExpirySighted(e0, { eligible: true }, null, NOW);
    expect(archivedExpiryDue(e1, NOW), 'not on the first sighting').toBe(false);
    const e2 = archivedExpirySighted(e1, { eligible: true }, null, NOW + PASS);
    expect(archivedExpiryDue(e2, NOW + PASS)).toBe(true);
    const e3 = archivedExpirySighted(e2, { eligible: false, why: 'open-run' }, null, NOW + 2 * PASS);
    expect(archivedExpiryDue(e3, NOW + 2 * PASS)).toBe(false);
    expect(e3.eligibleSince).toBeNull();
  });

  it('held past its instant is REPORTED with its reason, and the report goes with the hold', () => {
    const e0 = archivedExpiryEntry(1_789_000_000);
    const held = archivedExpirySighted(e0, { eligible: false, why: 'held' }, 'program:x wave:1/2', NOW);
    expect(held.report).toEqual({ kind: 'held', at: NOW, reason: 'program:x wave:1/2' });
    expect(archivedExpirySighted(held, { eligible: false, why: 'held' }, 'program:x wave:1/2', NOW + PASS).report?.at,
      'since when, kept').toBe(NOW);
    expect(archivedExpirySighted(held, { eligible: true }, null, NOW + PASS).report).toBeNull();
  });

  const e = (over: Partial<ArchivedExpiryEntry> = {}): ArchivedExpiryEntry =>
    ({ ...archivedExpiryEntry(1_789_000_000), expiresAt: 1_789_604_800, eligibleSince: NOW - PASS, ...over });

  it('expired and gone finish the row; a terminal refusal and a composition error are never asked again, and reported', () => {
    expect(archivedExpiryNextEntry(e(), { kind: 'expired' }, NOW, PASS)).toBeNull();
    expect(archivedExpiryNextEntry(e(), { kind: 'gone' }, NOW, PASS)).toBeNull();
    expect(archivedExpiryNextEntry(e(), { kind: 'refused', token: 'not-archived', detail: '', inUse: [] }, NOW, PASS)).toBeNull();
    const t = archivedExpiryNextEntry(e(), { kind: 'refused', token: 'containment-unproven', detail: 'd', inUse: [] }, NOW, PASS)!;
    expect(t.nextAskAt).toBe(Number.POSITIVE_INFINITY);
    expect(t.report).toMatchObject({ kind: 'refused', token: 'containment-unproven' });
    const c = archivedExpiryNextEntry(e(), { kind: 'composition', detail: 'bad token' }, NOW, PASS)!;
    expect(c.nextAskAt).toBe(Number.POSITIVE_INFINITY);
    expect(c.report).toMatchObject({ kind: 'failing' });
  });

  it('in-use is asked again every pass, and REPORTED once it has stood the bounded number of passes', () => {
    const inUse = [{ pid: 7, comm: 'tmux: server', cwd: '/w' }];
    let x = e();
    for (let k = 1; k < EXPIRE_IN_USE_ATTENTION_PASSES; k += 1) {
      x = archivedExpiryNextEntry(x, { kind: 'refused', token: 'in-use', detail: '', inUse }, NOW + k * PASS, PASS)!;
      expect(x.report, `not after ${k}`).toBeNull();
      expect(x.nextAskAt).toBe(NOW + (k + 1) * PASS);
    }
    x = archivedExpiryNextEntry(x, { kind: 'refused', token: 'in-use', detail: '', inUse }, NOW + 9 * PASS, PASS)!;
    expect(x.report).toMatchObject({ kind: 'in-use', inUse, passes: EXPIRE_IN_USE_ATTENTION_PASSES });
    expect(archivedExpiryNextEntry(x, { kind: 'refused', token: 'held', detail: '', inUse: [] }, NOW + 10 * PASS, PASS)!.inUseRun,
      'any other answer ends the run').toBe(0);
  });

  it('a failure backs off, and is reported once the run of failures has lasted the ceiling', () => {
    let x = e();
    x = archivedExpiryNextEntry(x, { kind: 'failed', detail: 'pin-failed' }, NOW, PASS)!;
    expect(x.nextAskAt).toBe(NOW + 2 * PASS);
    expect(x.report).toBeNull();
    x = archivedExpiryNextEntry(x, { kind: 'failed', detail: 'pin-failed' }, NOW + EXPIRE_FAILURE_CEILING_MS, PASS)!;
    expect(x.report).toMatchObject({ kind: 'failing', at: NOW });
  });

  it('a box word is reported at once — flock-unavailable will not pass by waiting', () => {
    const x = archivedExpiryNextEntry(e(), { kind: 'box', word: 'flock-unavailable', detail: 'flock …' }, NOW, PASS)!;
    expect(x.report).toMatchObject({ kind: 'failing' });
  });

  it('in shadow, "would expire" is recorded — and the row is audited again only after the shadow interval', () => {
    const x = archivedExpiryNextEntry(e(), { kind: 'would-expire', sensitive: 2 }, NOW, PASS)!;
    expect(x.report).toEqual({ kind: 'would-expire', at: NOW, sensitive: 2 });
    expect(x.nextAskAt).toBe(NOW + EXPIRE_SHADOW_REAUDIT_MS);
  });
});

describe('the attention list, and the words that never tell an operator to end a pid they cannot name', () => {
  it('names the pid, its command and the path — and warns that the fleet’s own tmux server is a `tmux: server` too', () => {
    const s = expiryInUseSentence([{ pid: 3453108, comm: 'tmux: server', cwd: '/home/u/worktrees/p/brisk-mesa' }], 3);
    expect(s).toContain('process 3453108 (“tmux: server”) in /home/u/worktrees/p/brisk-mesa');
    expect(s).toContain('Find out what it is before ending it');
    expect(s).toContain('the fleet’s own tmux server is also a “tmux: server”');
    expect(s).not.toMatch(/\bkill\b/i);
  });

  it('a command the box could not read is said so — never a bare pid', () => {
    expect(expiryInUseSentence([{ pid: 9, comm: '', cwd: '/w' }], 3)).toContain('process 9 (its command could not be read) in /w');
  });

  it('lists every reported row, newest first, and nothing for a row with no report', () => {
    const m = new Map<string, ArchivedExpiryEntry>([
      ['a', { ...archivedExpiryEntry(1), report: { kind: 'would-expire', at: 10, sensitive: 0 } }],
      ['b', { ...archivedExpiryEntry(2), report: { kind: 'held', at: 20, reason: 'r' } }],
      ['c', archivedExpiryEntry(3)],
    ]);
    expect(expiryAttention(m).map((a) => [a.sessionId, a.kind])).toEqual([['b', 'held'], ['a', 'would-expire']]);
  });
});

describe('L1', () => {
  it('imports L0 alone — no node:, no fs, no fastify', () => {
    const src = readFileSync(path.join(path.dirname(CCD), '..', 'server', 'src', 'archivedExpiry.ts'), 'utf8');
    const froms = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(froms).toEqual(['../../shared/api.js']);
  });
});
````

- [ ] **Step 2: Run it — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts --maxWorkers=1 )
```

Measured: `Test Files 1 failed (1)`, no tests — `Cannot find module '../src/archivedExpiry.js'`.

- [ ] **Step 3: Make it pass.**

<!-- replay: create server/src/archivedExpiry.ts -->
Create `server/src/archivedExpiry.ts`:

````ts
// THE EXPIRY LANE'S DECISIONS (workspace lifecycle spec 2026-09-24 §5.3 "The lane", wave 3b). L1: pure, clock-free
// (the clock is an argument), `fs`-free and fastify-free — `childReclaimSweep.ts`'s shape, beside it and sharing
// nothing with it. It imports L0 alone. `watch.ts`'s `sweepArchivedExpiry` (L4) GATHERS the evidence and APPLIES
// these verdicts; `coord/expireArchived.ts` (the one executor) reads the box's two documents through the parsers
// here. Nothing in this file reads a file, a row or a clock.
//
// THE POPULATION is an ARCHIVED WORKSPACE nobody claims, seven days after its archive — never a child (CCR-15's lane
// owns those) and never a main checkout (nothing archives one). THE THRESHOLD IS NEVER TYPED HERE: ccd's
// `ws-audit --expire` document carries `expiresAt` (`archivedAt + WS_EXPIRE_AFTER_S`, from the one ccd definition),
// and `expireAuditExpiresAt` is the ONE reader of that key. A document without it — an older ccd — is NO EVIDENCE,
// and the lane composes nothing for that row.
//
// EVERY UNCERTAIN ANSWER IS "NOT THIS PASS". The path these verdicts feed asks for a deletion with no human in it;
// the executor re-reads, and ccd re-proves inside its lock at the instant of deletion. This file narrows the window.
import {
  TERMINAL_RUN_STATES, type ChildMark, type ExpiryAttention, type RunState,
} from '../../shared/api.js';

/** THE LANE'S LIVE SWITCH (the coordinator's safety ruling (E), the scope sweep's precedent). Until `$REG/<this>`
 *  exists the lane AUDITS and RECORDS "would expire <id>" — a feed row and an attention entry — and NEVER composes
 *  `ws-expire`. It has NO WRITER in the tree: the operator touches it by hand on the fleet box, and
 *  `single-definition.test.ts` pins that, beside `stall-watch-live`. Spelled here and nowhere else in `server/src`. */
export const EXPIRE_LANE_LIVE_MARKER = 'expire-lane-live';

/** Every word `ws-expire` and `ws-audit --expire` refuse with — and NO other. `archived-expiry-policy.test.ts` holds
 *  this set equal to what ccd's EXPIRE region and the shared ladder (`_ws_reclaim_ladder`) emit, in both directions,
 *  the way `CHILD_RECLAIM_TOKEN_KIND` is held to the RECLAIM region. */
export type ExpireToken =
  | 'no-such-session' | 'not-archived' | 'not-a-workspace' | 'branch-elsewhere' | 'tree-unreadable'
  | 'containment-unproven' | 'no-worktree-record' | 'not-expired' | 'child' | 'paused' | 'held' | 'attached'
  | 'live' | 'in-use' | 'tree-busy' | 'state-changed' | 'in-progress' | 'reap-in-progress' | 'reclaim-in-progress';

/** What each word means to the lane, spelled ONCE (wave 3's plan, "Wave 3b inherits", the words by kind):
 *   - `gone`: the row left the population — returned, re-archived from scratch, or removed. Drop it, no report.
 *   - `terminal`: the box proved something waiting will not change. Reported (attention), never re-asked until the
 *     row's archive changes.
 *   - `retry`: a condition that passes (a hold, a pause, a person, a process, a lock, a token gone stale). Asked
 *     again; `in-use` standing for `EXPIRE_IN_USE_ATTENTION_PASSES` asks is reported, naming what holds it. */
export const EXPIRE_TOKEN_KIND: Readonly<Record<ExpireToken, 'gone' | 'terminal' | 'retry'>> = {
  'no-such-session': 'gone',
  'not-archived': 'gone',
  'not-a-workspace': 'terminal',
  'branch-elsewhere': 'terminal',
  'tree-unreadable': 'terminal',
  'containment-unproven': 'terminal',
  'no-worktree-record': 'terminal',
  'not-expired': 'retry',
  child: 'retry',
  paused: 'retry',
  held: 'retry',
  attached: 'retry',
  live: 'retry',
  'in-use': 'retry',
  'tree-busy': 'retry',
  'state-changed': 'retry',
  'in-progress': 'retry',
  'reap-in-progress': 'retry',
  'reclaim-in-progress': 'retry',
};

/** `EXPIRE_TOKEN_KIND` read TOTALLY: the word's kind, or null for one this build was never compiled to know. */
export const expireTokenKind = (token: string): 'gone' | 'terminal' | 'retry' | null =>
  Object.prototype.hasOwnProperty.call(EXPIRE_TOKEN_KIND, token)
    ? EXPIRE_TOKEN_KIND[token as ExpireToken]
    : null;

const isExpireToken = (v: unknown): v is ExpireToken => typeof v === 'string' && expireTokenKind(v) !== null;

/** The two BOX words (wave 3's plan, "Wave 3b inherits", the verb): `cmd_ws_expire` refuses through `_lc_refuse` —
 *  exit 1, NOTHING on stdout — when the box has no util-linux `flock` (`flock-unavailable`: PERMANENT for that box)
 *  or the reap lock cannot be opened (`lock-unopenable`: retryable). Told apart from a COMPOSITION error (a usage
 *  line, `bad token`, `bad session id`, a blank `--actor`), which also exits 1 with an empty stdout, by stderr's
 *  exact shape — never by the empty stdout alone, which would retry the first for ever or blame the argv for the
 *  second. */
export type ExpireBoxWord = 'flock-unavailable' | 'lock-unopenable';

// ── how long, how often ──────────────────────────────────────────────────────

/** How many consecutive `in-use` answers before the row is REPORTED (the coordinator's ruling (G)): a standing
 *  in-use refusal is EXPECTED — an orphan `nohup` server, a tmux or fsmonitor daemon left in the tree — and after
 *  this many asks it becomes an attention entry naming the pid, its command and the path. Never a ceiling: the lane
 *  never deletes a tree a process stands in, and never kills. */
export const EXPIRE_IN_USE_ATTENTION_PASSES = 3;

/** How long an audit that answered with NO `expiresAt` (an older ccd) is left before the row is audited again — the
 *  box may be upgraded meanwhile. Not a threshold of the expiry: nothing is ever composed on that answer. */
export const EXPIRE_NO_EVIDENCE_RETRY_MS = 60 * 60_000;

/** In shadow, how long a "would expire" record stands before the row is audited again, so the record follows the
 *  row (someone opened a shell in it, it was restored) without auditing it every pass. */
export const EXPIRE_SHADOW_REAUDIT_MS = 15 * 60_000;

/** The failure backoff's ceiling: after the k-th consecutive `failed` answer the row waits
 *  `min(this, passMs × 2^k)`, and a run of failures that has lasted this long is reported (and still retried). */
export const EXPIRE_FAILURE_CEILING_MS = 60 * 60_000;

/** How many audits the lane runs in one pass to LEARN rows' expiry instants. The first armed pass faces every
 *  archived row at once; this spreads that over passes instead of asking the box for thirty audits in a minute. */
export const EXPIRE_AUDITS_PER_PASS = 3;

// ── the box's two documents ──────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;
const WIP_SHAPE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const epochOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;

/** One process the audit found working in the tree (`in-use`): its pid, its command (`""` when the box could not
 *  read it) and its working directory. */
export interface ExpireInUse { readonly pid: number; readonly comm: string; readonly cwd: string }

/** THE ONE READER of the audit document's `expiresAt` (the coordinator's ruling (C)). THREE answers, never folded:
 *  `at` — the instant, ccd's own arithmetic; `none` — ccd PRINTED the key and could read no archive (`null`); and
 *  `absent` — the key is not there at all: an older ccd, which is NO EVIDENCE. Both of the last two compose nothing;
 *  they are told apart because only `absent` is fixed by upgrading the box. */
export type ExpiresAtRead =
  | { readonly kind: 'at'; readonly at: number }
  | { readonly kind: 'none' }
  | { readonly kind: 'absent' };

export function expireAuditExpiresAt(doc: Record<string, unknown>): ExpiresAtRead {
  if (!Object.prototype.hasOwnProperty.call(doc, 'expiresAt')) return { kind: 'absent' };
  const at = epochOrNull(doc.expiresAt);
  return at === null ? { kind: 'none' } : { kind: 'at', at };
}

/** `ccd ws-audit --session <id> --expire`'s answer. `unreadable` is its own arm: a document this build cannot read is
 *  never a refusal and never a token. */
export type ExpireAuditRead =
  | { readonly kind: 'unreadable'; readonly detail: string }
  | { readonly kind: 'document'; readonly archivedAt: number | null; readonly expiresAt: ExpiresAtRead;
      readonly sensitive: number; readonly inUse: readonly ExpireInUse[];
      readonly verdict:
        | { readonly kind: 'expirable'; readonly token: string }
        | { readonly kind: 'refused'; readonly token: ExpireToken; readonly detail: string } };

/** `ok` is the audit's exit status: ANY exit 1 — `unmeasured` included — is `unreadable`, whatever the document
 *  says, so no exit-1 document is ever spent. */
export function parseExpireAudit(sessionId: string, ok: boolean, stdout: string): ExpireAuditRead {
  let v: unknown;
  try { v = JSON.parse(stdout.trim()); } catch { return { kind: 'unreadable', detail: 'ws-audit --expire printed no JSON document' }; }
  if (!isRecord(v)) return { kind: 'unreadable', detail: 'ws-audit --expire printed no JSON object' };
  if (v.session !== sessionId) {
    return { kind: 'unreadable', detail: `ws-audit --expire answered for ${String(v.session)}, not ${sessionId}` };
  }
  if (v.mode !== 'expire') return { kind: 'unreadable', detail: 'ws-audit answered without "mode":"expire"' };
  if (!ok) {
    return { kind: 'unreadable', detail: `ws-audit --expire measured nothing: ${typeof v.detail === 'string' ? v.detail : ''}` };
  }
  const sensitive = Array.isArray(v.sensitive) ? v.sensitive.length : 0;
  const inUse = Array.isArray(v.inUse) ? v.inUse.flatMap((u): ExpireInUse[] => (isRecord(u)
    && typeof u.pid === 'number' && Number.isSafeInteger(u.pid) && typeof u.comm === 'string' && typeof u.cwd === 'string'
    ? [{ pid: u.pid, comm: u.comm, cwd: u.cwd }] : [])) : [];
  const base = { kind: 'document' as const, archivedAt: epochOrNull(v.archivedAt), expiresAt: expireAuditExpiresAt(v),
    sensitive, inUse };
  if (v.verdict === 'expirable') {
    if (typeof v.token !== 'string' || !TOKEN_SHAPE.test(v.token)) {
      return { kind: 'unreadable', detail: 'ws-audit --expire said expirable with no 64-hex token' };
    }
    return { ...base, verdict: { kind: 'expirable', token: v.token } };
  }
  if (isExpireToken(v.verdict)) {
    return { ...base, verdict: { kind: 'refused', token: v.verdict, detail: typeof v.detail === 'string' ? v.detail : '' } };
  }
  return { kind: 'unreadable', detail: `ws-audit --expire answered a verdict this build does not know: ${String(v.verdict)}` };
}

/** The exact stderr ccd's `die` prints for a call the SERVER composed wrong (`cmd_ws_expire`'s argument dies, before
 *  its lock). Anchored on the whole prefix-stripped message, never a substring. */
const EXPIRE_COMPOSITION_DIES: readonly RegExp[] = [
  /^usage: ccd ws-expire --expect <token> --session <id> \[--surface <word>\] \[--actor <text>\] \[--reason <text>\]$/,
  /^bad token$/,
  /^bad session id$/,
  /^--actor must be non-blank$/,
  /^--reason must be non-blank$/,
  /^--actor is longer than \d+ bytes$/,
  /^--reason is longer than \d+ bytes$/,
  /^python3 unavailable — cannot quote the expiry record safely$/,
];

/** `flock-unavailable`'s die: that one `ccd:` line, alone. */
const FLOCK_UNAVAILABLE = 'ccd: flock (util-linux) is unavailable — refusing to run the destructive verb unserialised';

/** `lock-unopenable`'s die, MEASURED by the reclaim lane (review 170 fr-I I1): bash's own redirection diagnostic for
 *  the lock path FIRST, then `ccd: cannot open the reap lock at <path>` LAST. Recognised whole-output. */
function lockUnopenable(err: string): string | null {
  const lines = err.split('\n');
  const last = lines[lines.length - 1] ?? '';
  const m = /^ccd: cannot open the reap lock at (.+)$/.exec(last);
  if (!m) return null;
  const lockPath = m[1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bashLine = new RegExp(`^.*: line [0-9]+: ${lockPath}: .+$`);
  return lines.slice(0, -1).every((l) => bashLine.test(l)) ? last.slice('ccd: '.length) : null;
}

/** `ccd ws-expire …`'s answer (wave 3's plan, "Wave 3b inherits", the verb). Three documents — `expired` and
 *  `refused` at exit 0, `failed` at exit 1 (the breadcrumb is kept and the next attempt resumes it) — and three
 *  conditions that are no document: the two BOX words, and a COMPOSITION error. Anything else with an empty stdout is
 *  a call cut short: `failed`, resumable. */
export type ExpireVerbRead =
  | { readonly kind: 'expired'; readonly archivedAt: number | null; readonly wip: string | null | 'unreadable';
      readonly secretsDropped: number | 'unreadable' }
  | { readonly kind: 'refused'; readonly token: ExpireToken; readonly detail: string }
  | { readonly kind: 'failed'; readonly resumable: boolean; readonly detail: string }
  | { readonly kind: 'box'; readonly word: ExpireBoxWord; readonly detail: string }
  | { readonly kind: 'composition'; readonly detail: string };

export function parseExpireResult(sessionId: string, stdout: string, stderr: string): ExpireVerbRead {
  let v: unknown = null;
  try { v = JSON.parse(stdout.trim()); } catch { v = null; }
  if (isRecord(v)) {
    if (typeof v.expired === 'string') {
      if (v.expired !== sessionId) {
        return { kind: 'failed', resumable: false, detail: `ws-expire reported expiring ${v.expired}, not ${sessionId}` };
      }
      const wip = v.wip === null ? null : typeof v.wip === 'string' && WIP_SHAPE.test(v.wip) ? v.wip : 'unreadable';
      const secretsDropped = typeof v.secretsDropped === 'number' && Number.isSafeInteger(v.secretsDropped)
        && v.secretsDropped >= 0 ? v.secretsDropped : 'unreadable';
      return { kind: 'expired', archivedAt: epochOrNull(v.archivedAt), wip, secretsDropped };
    }
    if (typeof v.refused === 'string') {
      const detail = typeof v.detail === 'string' ? v.detail : '';
      return isExpireToken(v.refused) ? { kind: 'refused', token: v.refused, detail }
        : { kind: 'failed', resumable: false, detail: `ws-expire refused with a word this build does not know: ${v.refused}` };
    }
    if (typeof v.failed === 'string') {
      const detail = typeof v.detail === 'string' ? v.detail : '';
      return { kind: 'failed', resumable: v.failed !== 'probe-unmeasured', detail: detail === '' ? v.failed : `${v.failed}: ${detail}` };
    }
  }
  const err = stderr.trim();
  if (err === FLOCK_UNAVAILABLE) return { kind: 'box', word: 'flock-unavailable', detail: err.slice('ccd: '.length) };
  const lock = lockUnopenable(err);
  if (lock !== null) return { kind: 'box', word: 'lock-unopenable', detail: lock };
  const msg = err.startsWith('ccd: ') ? err.slice('ccd: '.length) : err;
  if (EXPIRE_COMPOSITION_DIES.some((p) => p.test(msg))) return { kind: 'composition', detail: msg };
  return { kind: 'failed', resumable: true,
    detail: err === '' ? 'ws-expire answered nothing — it may have been cut short; the next attempt resumes it' : err };
}

// ── eligibility ──────────────────────────────────────────────────────────────

/** The coordination store's answers for one row, read once per pass (`lastRunBySession`, and the review runs naming
 *  the row). `ok:false` is a store this pass could not read: every row is ineligible. */
export type ExpiryStoreRead =
  | { readonly ok: false; readonly detail: string }
  | { readonly ok: true; readonly openWorker: boolean; readonly openClaimant: boolean; readonly reviewing: boolean };

export interface ArchivedExpiryInput {
  readonly sessionId: string;
  readonly workspace: string | null;
  /** The registry's archive epoch (seconds), `null` when the row is not archived. */
  readonly archivedAt: number | null;
  readonly child: ChildMark;
  readonly identityMeasured: boolean;
  readonly held: string | null;
  readonly store: ExpiryStoreRead;
  /** What the lane has LEARNED from this archive's audit: the instant (seconds), `null` before any audit read one. */
  readonly expiresAt: number | null;
  readonly nowMs: number;
}

export type ArchivedExpirySkip =
  | 'not-a-workspace' | 'not-archived' | 'child' | 'identity-unmeasured' | 'store-unreadable' | 'open-run'
  | 'coordinating' | 'review-open' | 'expiry-unknown' | 'not-yet' | 'held';

export type ArchivedExpiryVerdict =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly why: ArchivedExpirySkip };

/**
 * IS THIS ROW AN ARCHIVED WORKSPACE THE SERVER MAY ASK TO EXPIRE NOW (spec §5.3, "A row is eligible when")? Every
 * conjunct in the spec's order, every doubt ineligible:
 *  - a workspace (a main checkout is never expired) with an archive;
 *  - no child marker — `child` or `unreadable` is CCR-15's lane's, never this one's;
 *  - identity measured;
 *  - the store read; no non-terminal run names it as `sessionId` or as `claimedBy`; it is not the `sessionId` of a
 *    review run whose reviewed run is not terminal (CCR-15 R16, applied to unmarked reviewers: the report lives in
 *    this workspace's clips);
 *  - its expiry instant is KNOWN (ccd's, from the audit) and has come;
 *  - no hold. A row past its instant and still held is `held` — the attention list's, never acted on.
 * The switch and the twice-observed rule are the lane's (`watch.ts`), applied on top.
 */
export function archivedExpiryVerdict(i: ArchivedExpiryInput): ArchivedExpiryVerdict {
  const skip = (why: ArchivedExpirySkip): ArchivedExpiryVerdict => ({ eligible: false, why });
  if (i.workspace === null) return skip('not-a-workspace');
  if (i.archivedAt === null) return skip('not-archived');
  if (i.child.kind !== 'none') return skip('child');
  if (!i.identityMeasured) return skip('identity-unmeasured');
  if (!i.store.ok) return skip('store-unreadable');
  if (i.store.openWorker) return skip('open-run');
  if (i.store.openClaimant) return skip('coordinating');
  if (i.store.reviewing) return skip('review-open');
  if (i.expiresAt === null) return skip('expiry-unknown');
  if (i.nowMs < i.expiresAt * 1000) return skip('not-yet');
  if (i.held !== null) return skip('held');
  return { eligible: true };
}

/** A REVIEW run naming this row as `sessionId`, whose reviewed run is not terminal, keeps it (spec §5.3, CCR-15 R16).
 *  A reviewed run this pass could not read, or that is absent, is doubt — and doubt keeps. */
export const reviewKeeps = (reviewed: { readonly kind: 'run'; readonly state: RunState } | { readonly kind: 'absent' } | { readonly kind: 'unreadable' }): boolean =>
  reviewed.kind !== 'run' || !(TERMINAL_RUN_STATES as readonly RunState[]).includes(reviewed.state);

// ── the lane's memory of one row ─────────────────────────────────────────────

/** IN MEMORY ONLY: a restart loses it, and losing it can only DELAY an expiry (the instant is learned again, and
 *  eligibility must be seen twice again) — never cause one. Keyed by the ARCHIVE: a row whose `archivedAt` changes
 *  (returned and archived again) starts a fresh entry, so nothing learned about one archive is applied to another. */
export interface ArchivedExpiryEntry {
  readonly archivedAt: number;
  /** ccd's instant for THIS archive (seconds), once an audit read one. */
  readonly expiresAt: number | null;
  /** The earliest the row may be audited or asked again (ms). */
  readonly nextAskAt: number;
  /** The first pass of the current unbroken run of eligible verdicts (ms), or null. */
  readonly eligibleSince: number | null;
  /** The previous attempt's outcome key (`kind` or `kind:word`), so a feed row is written when it CHANGES, not every
   *  pass a standing refusal is met again. */
  readonly lastOutcome: string | null;
  /** Consecutive `in-use` answers, and the latest one's processes. */
  readonly inUseRun: number;
  readonly inUse: readonly ExpireInUse[];
  /** Consecutive `failed` answers, and since when (ms). */
  readonly failures: number;
  readonly failingSince: number | null;
  /** What the attention list says about this row, or null. */
  readonly report: ExpiryReport | null;
}

/** One attention entry's facts before it is worded. */
export type ExpiryReport =
  | { readonly kind: 'would-expire'; readonly at: number; readonly sensitive: number }
  | { readonly kind: 'held'; readonly at: number; readonly reason: string }
  | { readonly kind: 'in-use'; readonly at: number; readonly inUse: readonly ExpireInUse[]; readonly passes: number }
  | { readonly kind: 'refused'; readonly at: number; readonly token: ExpireToken; readonly detail: string }
  | { readonly kind: 'failing'; readonly at: number; readonly detail: string }
  | { readonly kind: 'no-evidence'; readonly at: number };

export const archivedExpiryEntry = (archivedAt: number): ArchivedExpiryEntry => ({
  archivedAt, expiresAt: null, nextAskAt: 0, eligibleSince: null, lastOutcome: null, inUseRun: 0, inUse: [],
  failures: 0, failingSince: null, report: null,
});

/** The entry for this pass: the previous one while its archive is still the row's, else a fresh one. */
export const archivedExpiryEntryFor = (prev: ArchivedExpiryEntry | undefined, archivedAt: number): ArchivedExpiryEntry =>
  prev !== undefined && prev.archivedAt === archivedAt ? prev : archivedExpiryEntry(archivedAt);

/** What an audit run only to LEARN the instant taught the entry. `absent` (an older ccd) and `none` leave it unknown
 *  and wait `EXPIRE_NO_EVIDENCE_RETRY_MS`; an audit that read a DIFFERENT archive than the registry's is a row moving
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
}

/** One pass's verdict, folded into memory. THE TWICE-OBSERVED RULE (spec §5.3: "all of the above held on the
 *  previous pass too"): an eligible verdict seeds `eligibleSince` on its first pass and makes the row DUE only on a
 *  later one; any other verdict ends the run. And THE HELD REPORT (spec §5.3: "An archived workspace that is still
 *  held after 7 days is not acted on. It goes on the attention list."): `held` is listed with its reason, and the
 *  listing goes when the hold does. */
export function archivedExpirySighted(
  entry: ArchivedExpiryEntry, v: ArchivedExpiryVerdict, held: string | null, nowMs: number,
): ArchivedExpiryEntry {
  const eligibleSince = v.eligible ? (entry.eligibleSince ?? nowMs) : null;
  if (!v.eligible && v.why === 'held' && held !== null) {
    const at = entry.report?.kind === 'held' ? entry.report.at : nowMs;
    return { ...entry, eligibleSince, report: { kind: 'held', at, reason: held } };
  }
  const report = entry.report?.kind === 'held' ? null : entry.report;
  return eligibleSince === entry.eligibleSince && report === entry.report ? entry : { ...entry, eligibleSince, report };
}

/** DUE: eligible on a previous pass and still, and past `nextAskAt`. */
export const archivedExpiryDue = (entry: ArchivedExpiryEntry, nowMs: number): boolean =>
  entry.eligibleSince !== null && entry.eligibleSince < nowMs && nowMs >= entry.nextAskAt;

/** Why the executor asked nothing of the box this time: no `expire-v1`, the cleanup switch (or a listing that could
 *  not rule it out), a person at the session, or an audit of another archive than the one the lane queued. */
export type ArchivedExpiryDeferWhy = 'unsupported' | 'paused-at-server' | 'presence' | 'state-changed';

/** The one executor's answer, as the lane folds it into memory. */
export type ArchivedExpiryOutcome =
  | { readonly kind: 'expired' }
  | { readonly kind: 'would-expire'; readonly sensitive: number }
  | { readonly kind: 'deferred'; readonly why: ArchivedExpiryDeferWhy; readonly detail: string }
  | { readonly kind: 'refused'; readonly token: ExpireToken; readonly detail: string; readonly inUse: readonly ExpireInUse[] }
  | { readonly kind: 'gone' }
  | { readonly kind: 'failed'; readonly detail: string }
  | { readonly kind: 'box'; readonly word: ExpireBoxWord; readonly detail: string }
  | { readonly kind: 'composition'; readonly detail: string }
  | { readonly kind: 'no-evidence' };

const EXPIRY_OUTCOME_KINDS: Readonly<Record<ArchivedExpiryOutcome['kind'], true>> = {
  expired: true, 'would-expire': true, deferred: true, refused: true, gone: true, failed: true, box: true,
  composition: true, 'no-evidence': true,
};
const EXPIRY_DEFER_WHYS: Readonly<Record<ArchivedExpiryDeferWhy, true>> = {
  unsupported: true, 'paused-at-server': true, presence: true, 'state-changed': true,
};
const EXPIRE_BOX_WORDS: Readonly<Record<ExpireBoxWord, true>> = { 'flock-unavailable': true, 'lock-unopenable': true };

/** Every kebab word this lane spells as a literal — ccd's nineteen, the two box words, the outcome kinds and the defer
 *  reasons — for `mail-routes.test.ts`'s scan of `server/src/coord`, where the executor lives. None is a mail rejection
 *  or a run refusal: no `refused` or `reject.code` ever carries one. Derived from the Records above, never a list. */
export function isArchivedExpiryKebab(v: string): boolean {
  const own = (o: object): boolean => Object.prototype.hasOwnProperty.call(o, v);
  return expireTokenKind(v) !== null || own(EXPIRE_BOX_WORDS) || own(EXPIRY_OUTCOME_KINDS) || own(EXPIRY_DEFER_WHYS);
}

/** The outcome's key, for "write a feed row only when it changes". */
export const archivedExpiryOutcomeKey = (o: ArchivedExpiryOutcome): string =>
  o.kind === 'refused' || o.kind === 'box' ? `${o.kind}:${o.kind === 'refused' ? o.token : o.word}`
    : o.kind === 'deferred' ? `deferred:${o.why}` : o.kind;

/** The failure backoff: `min(EXPIRE_FAILURE_CEILING_MS, passMs × 2^k)`. */
export const archivedExpiryBackoffMs = (failures: number, passMs: number): number =>
  Math.min(EXPIRE_FAILURE_CEILING_MS, passMs * 2 ** Math.min(failures, 20));

/**
 * The entry after an attempt — `null` when the row is finished with (expired, or gone from the population). Every
 * retryable answer is asked again on a later pass, a TERMINAL refusal and a COMPOSITION error are never asked again
 * for this archive (the first is the box's proof, the second this server's bug: retrying either would repeat it
 * every minute), and both are reported.
 */
export function archivedExpiryNextEntry(
  entry: ArchivedExpiryEntry, o: ArchivedExpiryOutcome, nowMs: number, passMs: number,
): ArchivedExpiryEntry | null {
  const base = { ...entry, lastOutcome: archivedExpiryOutcomeKey(o) };
  const steady = { inUseRun: 0, inUse: [] as readonly ExpireInUse[], failures: 0, failingSince: null };
  switch (o.kind) {
    case 'expired': case 'gone': return null;
    case 'would-expire':
      return { ...base, ...steady, nextAskAt: nowMs + EXPIRE_SHADOW_REAUDIT_MS,
        report: { kind: 'would-expire', at: entry.report?.kind === 'would-expire' ? entry.report.at : nowMs, sensitive: o.sensitive } };
    case 'no-evidence':
      return { ...base, ...steady, expiresAt: null, nextAskAt: nowMs + EXPIRE_NO_EVIDENCE_RETRY_MS, report: { kind: 'no-evidence', at: nowMs } };
    case 'deferred':
      return { ...base, ...steady, nextAskAt: nowMs + passMs, report: null };
    case 'refused': {
      const kind = EXPIRE_TOKEN_KIND[o.token];
      if (kind === 'gone') return null;
      if (kind === 'terminal') {
        return { ...base, ...steady, nextAskAt: Number.POSITIVE_INFINITY,
          report: { kind: 'refused', at: nowMs, token: o.token, detail: o.detail } };
      }
      if (o.token === 'in-use') {
        const passes = entry.inUseRun + 1;
        return { ...base, failures: 0, failingSince: null, inUseRun: passes, inUse: o.inUse, nextAskAt: nowMs + passMs,
          report: passes >= EXPIRE_IN_USE_ATTENTION_PASSES
            ? { kind: 'in-use', at: entry.report?.kind === 'in-use' ? entry.report.at : nowMs, inUse: o.inUse, passes }
            : null };
      }
      return { ...base, ...steady, nextAskAt: nowMs + passMs, report: null };
    }
    case 'failed': case 'box': {
      // `flock-unavailable` is the BOX's, and the lane stops asking that box at all (`watch.ts`); for the row it is
      // a failure like `lock-unopenable`, backed off and reported past the ceiling.
      const failures = entry.failures + 1;
      const failingSince = entry.failingSince ?? nowMs;
      return { ...base, inUseRun: 0, inUse: [], failures, failingSince,
        nextAskAt: nowMs + archivedExpiryBackoffMs(failures, passMs),
        report: nowMs - failingSince >= EXPIRE_FAILURE_CEILING_MS || o.kind === 'box'
          ? { kind: 'failing', at: failingSince, detail: o.detail } : null };
    }
    case 'composition':
      return { ...base, ...steady, nextAskAt: Number.POSITIVE_INFINITY,
        report: { kind: 'failing', at: nowMs, detail: `the server composed a call ccd rejected: ${o.detail}` } };
  }
}

// ── the attention list ───────────────────────────────────────────────────────

const iso = (epochS: number): string => new Date(epochS * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/** WHAT A PROCESS IS, before anything suggests ending it (the coordinator's ruling (G)): the fleet's own tmux server
 *  is a `tmux: server` too, and ending THAT ends every session on the box. So the sentence names the pid AND its
 *  command AND where it stands, and says to find out what it is first — it never says to kill. */
export function expiryInUseSentence(inUse: readonly ExpireInUse[], passes: number): string {
  const who = inUse.length === 0 ? 'a process'
    : inUse.map((u) => `process ${u.pid} (${u.comm === '' ? 'its command could not be read' : `“${u.comm}”`}) in ${u.cwd}`)
      .join(', ');
  return `kept: ${who} has its working directory in this archived workspace, and has kept it from being cleaned up `
    + `for ${passes} passes. Find out what it is before ending it — the fleet’s own tmux server is also a “tmux: server”, `
    + 'and ending that ends every session. Nothing is deleted while it stands.';
}

/** The words for one report. */
export function expiryReportSentence(r: ExpiryReport, expiresAt: number | null): string {
  switch (r.kind) {
    case 'would-expire':
      return `would be cleaned up now${expiresAt === null ? '' : ` (due ${iso(expiresAt)})`}: the cleanup is not armed `
        + `(shadow), so nothing was deleted. ${r.sensitive === 0 ? 'No secret-shaped file would be dropped.'
          : `${r.sensitive} secret-shaped ${r.sensitive === 1 ? 'file' : 'files'} would be dropped and recorded by path.`}`;
    case 'held':
      return `held (“${r.reason}”) past its seven days, so it is not cleaned up — release the hold or restore it.`;
    case 'in-use': return expiryInUseSentence(r.inUse, r.passes);
    case 'refused': return `not cleaned up: ccd refused (${r.token}) — ${r.detail === '' ? 'no detail' : r.detail}`;
    case 'failing': return `cleanup keeps failing: ${r.detail}. It is retried, backing off in between.`;
    case 'no-evidence':
      return 'not cleaned up: the fleet box’s ccd does not say when this archive expires (an older build), so the '
        + 'server composes nothing for it until the box is updated.';
  }
}

/** THE ATTENTION LIST, derived from the lane's memory alone, newest first. A row in memory with a report is listed;
 *  a held row past its instant is listed by the lane as a `held` report. */
export function expiryAttention(
  entries: ReadonlyMap<string, ArchivedExpiryEntry>,
): ExpiryAttention[] {
  const out: ExpiryAttention[] = [];
  for (const [sessionId, e] of entries) {
    if (e.report === null) continue;
    out.push({ sessionId, kind: e.report.kind, sentence: expiryReportSentence(e.report, e.expiresAt),
      archivedAt: e.archivedAt, expiresAt: e.expiresAt, at: e.report.at });
  }
  return out.sort((a, b) => b.at - a.at || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
}
````

- [ ] **Step 4: Run — green.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/tsc --noEmit -p . )
```

Measured: `archived-expiry-policy` `42 passed (42)`; `single-definition` `274 passed (274)` (Task 7 adds its 275th); `tsc` rc 0.

- [ ] **Step 5: Mutation check, then commit.** Every row: `server/src/archivedExpiry.ts`, one edit, `server/test/archived-expiry-policy.test.ts` (42).

| # | Edit | Measured red |
|---|---|---|
| T5.1 | `  'not-archived': 'gone',` → `  'not-archived': 'retry',` | `2 failed \| 40 passed` — GONE is the row leaving the population, and nothing else; expired and gone finish the row … |
| T5.2 | `  live: 'retry',` → `  alive: 'retry',` (a word ccd does not spell) | `1 failed \| 41 passed` — are exactly what ccd’s EXPIRE region and the shared ladder refuse with — harvested, both directions |
| T5.3 | the ONE reader folds absence into none: `return { kind: 'absent' };` → `return { kind: 'none' };` | `3 failed \| 39 passed` — three answers, never folded …; a document from a ccd that predates `expiresAt` reads as no evidence; learns ccd’s instant; an older ccd is no evidence … |
| T5.4 | an exit-1 audit read as a document: `  if (!ok) {` → `  if (false) {` | `1 failed \| 41 passed` — an exit-1 document is never spent, whatever it says … |
| T5.5 | `flock-unavailable` not recognised: `  if (err === FLOCK_UNAVAILABLE) return` → `  if (err === '') return` | `2 failed \| 40 passed` — the two `_lc_refuse` words are the two BOX words …; the three documents, and an empty answer that is no die is a call cut short — resumable |
| T5.6 | `lock-unopenable` not recognised: `  const lock = lockUnopenable(err);` → `  const lock = null as string \| null;` | `1 failed \| 41 passed` — the real verb’s stdout, stderr and exit read as the RETRYABLE box word |
| T5.7 | the hold conjunct removed: `  if (i.held !== null) return skip('held');` deleted | `1 failed \| 41 passed` — held, past the instant → … |
| T5.8 | the instant made exclusive: `if (i.nowMs < i.expiresAt * 1000)` → `if (i.nowMs <= i.expiresAt * 1000)` | `2 failed \| 40 passed` — held, past the instant …; AT the instant, with every conjunct clear, it is eligible |
| T5.9 | a review's unreadable reviewed run read as "not open": `reviewed.kind !== 'run' \|\| !(TERMINAL_RUN_STATES` → `reviewed.kind === 'run' && !(TERMINAL_RUN_STATES` | `1 failed \| 41 passed` — a review run keeps its row while the run it reviewed is open, unreadable or absent |
| T5.10 | twice observed collapsed to once: `entry.eligibleSince !== null && entry.eligibleSince < nowMs && nowMs >= entry.nextAskAt` → `entry.eligibleSince !== null && nowMs >= entry.nextAskAt` | `1 failed \| 41 passed` — twice observed: an eligible pass seeds, a later one makes it due … |
| T5.11 | `in-use` reported at once: `report: passes >= EXPIRE_IN_USE_ATTENTION_PASSES` → `report: passes >= 1` | `1 failed \| 41 passed` — in-use is asked again every pass, and REPORTED once it has stood the bounded number of passes |
| T5.12 | the sentence names a bare pid: ``process ${u.pid} (${u.comm === '' ? … })`` → ``process ${u.pid} in ${u.cwd}`` | `2 failed \| 40 passed` — names the pid, its command and the path …; a command the box could not read is said so — never a bare pid |
| T5.13 | a terminal refusal asked again next pass: the terminal arm's `nextAskAt: Number.POSITIVE_INFINITY,` → `nextAskAt: nowMs + passMs,` | `1 failed \| 41 passed` — expired and gone finish the row; a terminal refusal and a composition error are never asked again, and reported |
| T5.14 | an audit of ANOTHER archive learned from: the `if (read.archivedAt !== entry.archivedAt) return …` line deleted | `1 failed \| 41 passed` — learns ccd’s instant; an older ccd is no evidence … |
| T5.15 | an unreadable child marker let through: `  if (i.child.kind !== 'none') return skip('child');` → `  if (i.child.kind === 'child') return skip('child');` | `1 failed \| 41 passed` — an unreadable marker → { child: { kind: 'unreadable' } } |

```bash
git add server/test/archived-expiry-policy.test.ts server/src/archivedExpiry.ts
git commit -m "$(cat <<'MSG'
feat(expire): the expiry lane's decisions, one L1 file

archivedExpiry.ts: the nineteen words held equal to ccd's EXPIRE region and
shared ladder, the audit and verb parsers (box words told apart from
composition errors, lock-unopenable measured off the real verb), the ONE
expiresAt reader (absent is no evidence), archivedExpiryVerdict, the lane's
per-archive memory, and the attention words that name what a process is.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: The one executor — audit, then the verb with the audit's token, behind `expire-v1`

**Model routing:** `opus`, effort `high` — the one place the server composes the destructive verb; its gates are the safety.

**Files:** tests `server/test/expire-archived.test.ts` (new), `server/test/verb-gate.test.ts` (`CAP_GATED_VERBS`), `server/test/mail-routes.test.ts` (the thirteenth union); source `server/src/coord/expireArchived.ts` (new).

**Interfaces** (exported from `server/src/coord/expireArchived.ts`):
- `ExpireArchivedDeps { coord; io; cfg; runCcd; fleetState?; presence?; notifyLog? }` (the `ChildReclaimDeps` shape, declared by this consumer); `ExpireArchivedRequest { sessionId; archivedAt; expiresAt }` (seconds; what the lane learned); `ExpireArchivedResult` (an `ArchivedExpiryOutcome` plus the request's facts and, for `expired`, `wip`/`secretsDropped`).
- `expireArchived(deps, req)`, in this order, every doubt "not this time": `capSupported(state, EXPIRE_CAP)` (refuses on no evidence; never `verbSupported`) → ONE registry listing (an unlistable registry, or `reclaim-paused`, is `deferred paused-at-server`; `expire-lane-live` decides shadow or live HERE, at the act) → presence (`deferred presence`, no ceiling) → the audit (`CCD_ARGV.wsExpireAudit`, behind `verbSupported` as every `ws-audit` call is; any exit 1 is `failed`) → `expiresAt` through the ONE reader (`absent` → `no-evidence`, nothing composed) → a refusal by its kind (GONE → `gone`) → an archive other than the queued one (`deferred state-changed`) → SHADOW: `would-expire` with the sensitive count, and stop → LIVE: `CCD_ARGV.wsExpire(token, id, sweepDec(state, 'expire sweep'))`, the capability asked AGAIN in the act's own function → the verb's answer by `parseExpireResult`.
- `expireFeedBody(result)`, `recordExpireFeed(deps, result)` — one `kind: 'run'` row with `runId: null` (recorded, never pushed; the unfiltered feed), written by the LANE when a row's outcome changes (Task 7).
- `verb-gate.test.ts`: `CAP_GATED_VERBS` gains `ws-expire` — the scanner accepts a bare `capSupported(` as the gate for this verb, in the act's scope.
- `mail-routes.test.ts`: the thirteenth union, `isArchivedExpiryKebab` (Task 5), admits the executor's kebab literals (`would-expire`, `no-evidence`).

- [ ] **Step 1: Write the failing tests.**

<!-- replay: create server/test/expire-archived.test.ts -->
Create `server/test/expire-archived.test.ts`:

````ts
// The expiry lane's ONE executor (workspace lifecycle spec 2026-09-24 §5.3, wave 3b): `ws-audit --expire`, then
// `ws-expire` with THAT audit's token, behind `capSupported(state, EXPIRE_CAP)`. A scripted ccd answers; nothing
// here reaches a box. What is proven: which argv is composed and when, that SHADOW composes nothing destructive, that
// `reclaim-paused` and a person stop it, that an older ccd's document is no evidence, and that the box words and a
// composition error come back as themselves.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { expireArchived, recordExpireFeed, type ExpireArchivedDeps } from '../src/coord/expireArchived.js';
import { EXPIRE_LANE_LIVE_MARKER } from '../src/archivedExpiry.js';
import { NotifyLog } from '../src/notifylog.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { ACTOR_FLAGS_CAP, EXPIRE_CAP } from '../src/ccdargv.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'demo-quiet-dune';
const TOK = 'c'.repeat(64);
const ARCH = 1_789_000_000;
const DUE = ARCH + 604_800;
const CAPS: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: ['ws-audit', 'ws-expire', EXPIRE_CAP, ACTOR_FLAGS_CAP] };

const auditDoc = (verdict: string, extra: Record<string, unknown> = {}): string => JSON.stringify({
  session: ID, mode: 'expire', archivedAt: ARCH, expiresAt: DUE, alive: false, exists: true, reaping: null,
  sensitive: [], verdict, detail: '', ...extra });
const expiredDoc = JSON.stringify({ expired: ID, archivedAt: ARCH, wip: null, attic: 3, residueBytes: 0, secretsDropped: 0 });

interface Script { audit?: { code: number; stdout: string; stderr?: string }; verb?: { code: number; stdout: string; stderr?: string } }

const rig = async (over: { script?: Script; caps?: FleetState; live?: boolean; paused?: boolean; visible?: boolean;
  unlistable?: boolean } = {}) => {
  const home = mkTmp('ccrc-expire-archived-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  if (over.live !== false) writeFileSync(path.join(reg, EXPIRE_LANE_LIVE_MARKER), '');
  if (over.paused === true) writeFileSync(path.join(reg, 'reclaim-paused'), '');
  const script = over.script ?? { audit: { code: 0, stdout: auditDoc('expirable', { token: TOK }) }, verb: { code: 0, stdout: expiredDoc } };
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const r = args[0] === 'ws-audit' ? script.audit : args[0] === 'ws-expire' ? script.verb : undefined;
    return r === undefined ? { code: 1, stdout: '', stderr: `unscripted ${args[0]}` } : { code: r.code, stdout: r.stdout, stderr: r.stderr ?? '' };
  };
  const base = testDeps(home, run);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps: ExpireArchivedDeps = {
    coord, io: over.unlistable === true ? { ...base.io, readdir: async () => null } : base.io, cfg: base.cfg,
    runCcd: base.runCcd, fleetState: over.caps ?? CAPS,
    presence: { isVisible: (id: string) => over.visible === true && id === ID }, notifyLog,
  };
  const verbs = () => calls.map((c) => c[0]);
  return { deps, calls, verbs, coord, req: { sessionId: ID, archivedAt: ARCH, expiresAt: DUE } };
};

describe('the one executor', () => {
  it('LIVE: audits, then spends THAT audit’s token on ws-expire — and reports what was kept', async () => {
    const s = await rig();
    const out = await expireArchived(s.deps, s.req);
    expect(out).toMatchObject({ kind: 'expired', sessionId: ID, archivedAt: ARCH, expiresAt: DUE, wip: null, secretsDropped: 0 });
    expect(s.calls[0]).toEqual(['ws-audit', '--session', ID, '--expire']);
    expect(s.calls[1]!.slice(0, 5)).toEqual(['ws-expire', '--expect', TOK, '--session', ID]);
  });

  it('SHADOW (no `expire-lane-live`): audits and answers "would expire" — ws-expire is never composed', async () => {
    const s = await rig({ live: false, script: { audit: { code: 0, stdout: auditDoc('expirable', { token: TOK, sensitive: ['.env', 'id_rsa'] }) } } });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'would-expire', sensitive: 2 });
    expect(s.verbs()).toEqual(['ws-audit']);
  });

  it('`reclaim-paused` — the one cleanup switch — stops it before ccd is asked anything, shadow included', async () => {
    for (const live of [true, false]) {
      const s = await rig({ paused: true, live });
      expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
      expect(s.calls).toEqual([]);
    }
  });

  it('a registry that did not list cannot rule the pause out: deferred, nothing asked', async () => {
    const s = await rig({ unlistable: true });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
    expect(s.calls).toEqual([]);
  });

  it('no `expire-v1` on the box is NO EVIDENCE: deferred, nothing composed — `verbSupported` would have permitted', async () => {
    for (const ccdVerbs of [['ws-audit', 'ws-expire'], null]) {
      const s = await rig({ caps: { ...CAPS, ccdVerbs } as FleetState });
      expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'deferred', why: 'unsupported' });
      expect(s.calls).toEqual([]);
    }
  });

  it('a person at the session defers it, with no ceiling', async () => {
    const s = await rig({ visible: true });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'deferred', why: 'presence' });
    expect(s.calls).toEqual([]);
  });

  it('an audit document with no `expiresAt` (an older ccd) is no evidence: nothing is composed', async () => {
    const doc = JSON.parse(auditDoc('expirable', { token: TOK })) as Record<string, unknown>;
    delete doc['expiresAt'];
    const s = await rig({ script: { audit: { code: 0, stdout: JSON.stringify(doc) }, verb: { code: 0, stdout: expiredDoc } } });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'no-evidence' });
    expect(s.verbs()).toEqual(['ws-audit']);
  });

  it('an audit of ANOTHER archive than the one queued is a row that moved: deferred, never spent', async () => {
    const s = await rig({ script: { audit: { code: 0, stdout: auditDoc('expirable', { token: TOK, archivedAt: ARCH + 5 }) } } });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'deferred', why: 'state-changed' });
    expect(s.verbs()).toEqual(['ws-audit']);
  });

  it('an audit exit 1 is a failure, its document never spent', async () => {
    const s = await rig({ script: { audit: { code: 1, stdout: auditDoc('unmeasured') } } });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'failed' });
    expect(s.verbs()).toEqual(['ws-audit']);
  });

  it('a refusal at audit carries its word — in-use with the processes; a GONE word is gone', async () => {
    const inUse = [{ pid: 7, comm: 'tmux: server', cwd: '/w' }];
    const s = await rig({ script: { audit: { code: 0, stdout: auditDoc('in-use', { detail: 'process 7 …', inUse }) } } });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'refused', token: 'in-use', inUse });
    const g = await rig({ script: { audit: { code: 0, stdout: auditDoc('not-archived', { archivedAt: null, expiresAt: null }) } } });
    expect(await expireArchived(g.deps, g.req)).toMatchObject({ kind: 'gone' });
  });

  it('the box words come back as themselves — flock-unavailable and lock-unopenable — and a composition error as the server’s', async () => {
    const lock = '/h/.cc-sessions/.reap-demo-quiet-dune.lock';
    const cases: [string, Record<string, unknown>][] = [
      ['ccd: flock (util-linux) is unavailable — refusing to run the destructive verb unserialised', { kind: 'box', word: 'flock-unavailable' }],
      [`/h/ccd: line 9: ${lock}: Is a directory\nccd: cannot open the reap lock at ${lock}`, { kind: 'box', word: 'lock-unopenable' }],
      ['ccd: bad token', { kind: 'composition', detail: 'bad token' }],
    ];
    for (const [stderr, want] of cases) {
      const s = await rig({ script: { audit: { code: 0, stdout: auditDoc('expirable', { token: TOK }) }, verb: { code: 1, stdout: '', stderr } } });
      expect(await expireArchived(s.deps, s.req), stderr).toMatchObject(want);
    }
  });

  it('a feed row says what happened to which archive — and a shadow row says nothing was deleted', async () => {
    const s = await rig({ live: false });
    const out = await expireArchived(s.deps, s.req);
    recordExpireFeed(s.deps, out);
    const ev = s.coord.feedEvents(10).filter((e) => e.sessionId === ID);
    expect(ev.map((e) => e.title)).toEqual(['archived workspace would be cleaned up']);
    expect(ev[0]!.body).toContain('nothing was deleted');
    expect(ev[0]!.runId).toBeNull();
  });
});
````

<!-- replay: replace server/test/verb-gate.test.ts -->
In `server/test/verb-gate.test.ts`, find:

````ts
 * argument above holds for each of them unchanged.
 */
const CAP_GATED_VERBS: ReadonlySet<string> = new Set(['route', 'ws-reclaim', 'reclaim-pause']);
````

Replace with:

````ts
 * argument above holds for each of them unchanged. `ws-expire` (workspace
 * lifecycle wave 3b): the expiry executor composes it only behind
 * `capSupported(deps.fleetState, EXPIRE_CAP)`, asked again in the act's own
 * scope (`coord/expireArchived.ts`), and the same argument holds.
 */
const CAP_GATED_VERBS: ReadonlySet<string> = new Set(['route', 'ws-reclaim', 'reclaim-pause', 'ws-expire']);
````

<!-- replay: replace server/test/mail-routes.test.ts -->
In `server/test/mail-routes.test.ts`, find:

````ts
import { isStallKebab } from '../src/coord/stall.js';
````

Replace with:

````ts
import { isStallKebab } from '../src/coord/stall.js';
import { isArchivedExpiryKebab } from '../src/archivedExpiry.js';
````

<!-- replay: replace server/test/mail-routes.test.ts -->
In `server/test/mail-routes.test.ts`, find:

````ts
        || isStallKebab(tok),
        `${tok} is not a declared MailRejectCode, RunRefuseCode, LifecycleGapReason, ClaimRefuseCode, SessionLifecycle, ReclaimRefuseCode, AskRefuseCode, RunRouteRefuseCode, SetAccountPoolsRefuseCode, UpdateStoreRefuseCode, child-reclaim word or stall-watch word`).toBe(true);
````

Replace with:

````ts
        || isStallKebab(tok)
        // WORKSPACE LIFECYCLE WAVE 3b: the THIRTEENTH union, checked together and never merged, on the standing rule
        // `enter-ignored` above states. `coord/expireArchived.ts` (the expiry lane's one executor) spells ccd's
        // nineteen `ws-expire` words, its two box words, its outcome kinds and its defer reasons as literals. None is
        // a mail rejection or a run refusal — they ride the lane's memory and the feed, never a `refused` or
        // `reject.code`. Admitted through the exported guard, derived from `archivedExpiry.ts`'s Records, never
        // NOT_CODES, for the reason every union above gives.
        || isArchivedExpiryKebab(tok),
        `${tok} is not a declared MailRejectCode, RunRefuseCode, LifecycleGapReason, ClaimRefuseCode, SessionLifecycle, ReclaimRefuseCode, AskRefuseCode, RunRouteRefuseCode, SetAccountPoolsRefuseCode, UpdateStoreRefuseCode, child-reclaim word, stall-watch word or expiry word`).toBe(true);
````

- [ ] **Step 2: Run them — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/expire-archived.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/verb-gate.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts --maxWorkers=1 )
```

Measured: `expire-archived`: `Test Files 1 failed (1)`, no tests — `Cannot find module '../src/coord/expireArchived.js'`; `verb-gate` `12 passed (12)` and `mail-routes` `59 passed (59)` — both green until the executor exists, by design (rows T6.2, T6.9 and T6.10 are their reds).

- [ ] **Step 3: Make them pass.**

<!-- replay: create server/src/coord/expireArchived.ts -->
Create `server/src/coord/expireArchived.ts`:

````ts
import type { FleetIO } from '../io.js';
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import type { Deps } from '../server.js';
import type { Presence } from '../presence.js';
import type { NotifyLog } from '../notifylog.js';
import { CCD_ARGV, EXPIRE_CAP, capSupported, sweepDec, verbSupported } from '../ccdargv.js';
import type { CoordStore } from './store.js';
import { RECLAIM_PAUSE_MARKER } from './rundefs.js';
import {
  EXPIRE_LANE_LIVE_MARKER, EXPIRE_TOKEN_KIND, parseExpireAudit, parseExpireResult,
  type ArchivedExpiryOutcome, type ExpireAuditRead,
} from '../archivedExpiry.js';

/**
 * THE EXPIRY LANE'S ONE EXECUTOR (workspace lifecycle spec 2026-09-24 §5.3, wave 3b): `ws-audit --expire`, then
 * `ws-expire` with THAT audit's token — child reclamation's `reclaimChild` shape, in a file of its own so nothing of
 * the child lane's vocabulary, feed rows or attention list is shared. Its one caller is `watch.ts`'s
 * `sweepArchivedExpiry`, on the session's `KeyedQueue`.
 *
 * It re-reads everything it acts on, in this order, and every doubt is "not this time":
 *   1. the box must PROVE it has the verb — `capSupported(state, EXPIRE_CAP)`, which refuses on no evidence; never
 *      `verbSupported`, which permits on an absent list;
 *   2. ONE registry listing: `reclaim-paused` — the fleet's one cleanup switch — stops it, and so does a listing that
 *      could not be taken; `expire-lane-live` decides SHADOW or LIVE at the instant of the act, whatever the lane
 *      believed when it queued the row;
 *   3. a person looking at the session defers it — WITHOUT a ceiling (spec §5.3: "Presence defers WITHOUT a
 *      ceiling");
 *   4. the audit, and its `expiresAt` through the one reader: a document without it is NO EVIDENCE, and nothing is
 *      composed; an archive other than the one the lane queued is a row that moved, retried;
 *   5. shadow: "would expire", and stop. Live: the verb, the capability asked AGAIN in the act's own scope.
 * It NEVER kills, never stops a unit, never retries inside itself: ccd does the act, and re-proves the token inside
 * its lock at the instant of deletion.
 */

/** The executor's ports (L2, declared by this consumer) — `ChildReclaimDeps`'s shape. */
export interface ExpireArchivedDeps {
  coord: CoordStore;
  io: FleetIO; cfg: CcrcConfig; runCcd: Deps['runCcd']; fleetState?: FleetState;
  presence?: Pick<Presence, 'isVisible'>;
  notifyLog?: NotifyLog;
}

/** One row the lane asks about: the archive it believes it is expiring (epoch seconds) and the instant ccd gave. */
export interface ExpireArchivedRequest {
  readonly sessionId: string;
  readonly archivedAt: number;
  readonly expiresAt: number;
}

/** The executor's answer, as the lane folds it (`ArchivedExpiryOutcome`), plus what the feed row needs. */
export type ExpireArchivedResult = ArchivedExpiryOutcome & {
  readonly sessionId: string; readonly archivedAt: number; readonly expiresAt: number;
  readonly wip?: string | null | 'unreadable'; readonly secretsDropped?: number | 'unreadable';
};

export async function expireArchived(deps: ExpireArchivedDeps, req: ExpireArchivedRequest): Promise<ExpireArchivedResult> {
  const { sessionId, archivedAt, expiresAt } = req;
  const answer = (o: ArchivedExpiryOutcome, extra: Partial<ExpireArchivedResult> = {}): ExpireArchivedResult =>
    ({ ...o, sessionId, archivedAt, expiresAt, ...extra } as ExpireArchivedResult);
  // 1 — the capability, refusing on no evidence.
  if (!capSupported(deps.fleetState, EXPIRE_CAP)) {
    return answer({ kind: 'deferred', why: 'unsupported', detail: `the fleet host does not advertise ${EXPIRE_CAP}` });
  }
  // 2 — the switches, from ONE listing. Unlistable is a pause this server cannot rule out.
  let names: readonly string[] | null;
  try { names = await deps.io.readdir(deps.cfg.registryDir); } catch { names = null; }
  if (names === null) {
    return answer({ kind: 'deferred', why: 'paused-at-server',
      detail: `the registry did not list, so a raised ${RECLAIM_PAUSE_MARKER} cannot be ruled out` });
  }
  if (names.includes(RECLAIM_PAUSE_MARKER)) {
    return answer({ kind: 'deferred', why: 'paused-at-server', detail: `${RECLAIM_PAUSE_MARKER} is raised: cleanup is paused fleet-wide` });
  }
  const live = names.includes(EXPIRE_LANE_LIVE_MARKER);
  // 3 — a person at the session. No ceiling: presence defers for as long as it lasts.
  if (deps.presence?.isVisible(sessionId) === true) {
    return answer({ kind: 'deferred', why: 'presence', detail: 'someone is viewing this session' });
  }
  // 4 — the audit, and the threshold through its one reader.
  const audit = await expireAudit(deps, sessionId);
  if (audit.kind === 'unreadable') return answer({ kind: 'failed', detail: audit.detail });
  if (audit.expiresAt.kind === 'absent') return answer({ kind: 'no-evidence' });
  if (audit.verdict.kind === 'refused') {
    const { token, detail } = audit.verdict;
    return EXPIRE_TOKEN_KIND[token] === 'gone' ? answer({ kind: 'gone' })
      : answer({ kind: 'refused', token, detail, inUse: audit.inUse });
  }
  if (audit.archivedAt !== archivedAt || audit.expiresAt.kind !== 'at') {
    return answer({ kind: 'deferred', why: 'state-changed',
      detail: `the audit read archive ${String(audit.archivedAt)}, not the ${archivedAt} this pass queued` });
  }
  // 5 — shadow stops here: the lane records it, and nothing is composed.
  if (!live) return answer({ kind: 'would-expire', sensitive: audit.sensitive });
  const verb = await expireAct(deps, sessionId, audit.verdict.token);
  if (verb === 'unsupported') {
    return answer({ kind: 'deferred', why: 'unsupported', detail: `the fleet host does not advertise ${EXPIRE_CAP}` });
  }
  switch (verb.kind) {
    case 'expired': return answer({ kind: 'expired' }, { wip: verb.wip, secretsDropped: verb.secretsDropped });
    case 'refused':
      return EXPIRE_TOKEN_KIND[verb.token] === 'gone' ? answer({ kind: 'gone' })
        : answer({ kind: 'refused', token: verb.token, detail: verb.detail, inUse: [] });
    case 'failed': return answer({ kind: 'failed', detail: verb.detail });
    case 'box': return answer({ kind: 'box', word: verb.word, detail: verb.detail });
    case 'composition': return answer({ kind: 'composition', detail: verb.detail });
  }
}

/** The audit — its own function, as `childReclaimAudit` is: an old verb (`ws-audit`), asked the old question. ANY
 *  exit 1 is `unreadable` (`parseExpireAudit` reads the exit before a byte of the document). */
async function expireAudit(deps: ExpireArchivedDeps, sessionId: string): Promise<ExpireAuditRead> {
  const argv = CCD_ARGV.wsExpireAudit(sessionId);
  if (!verbSupported(deps.fleetState, argv)) return { kind: 'unreadable', detail: 'the fleet host cannot answer ws-audit' };
  const res = await deps.runCcd(argv);
  return parseExpireAudit(sessionId, res.ok, res.stdout);
}

/** The act — its own function, and the capability asked AGAIN inside it: this is the scope `verb-gate.test.ts` reads
 *  for `ws-expire`'s gate, and the one line that must never run without it. */
async function expireAct(deps: ExpireArchivedDeps, sessionId: string, token: string) {
  if (!capSupported(deps.fleetState, EXPIRE_CAP)) return 'unsupported' as const;
  const argv = CCD_ARGV.wsExpire(token, sessionId, sweepDec(deps.fleetState, 'expire sweep'));
  const res = await deps.runCcd(argv);
  return parseExpireResult(sessionId, res.stdout, res.stderr);
}

// ── the feed row ─────────────────────────────────────────────────────────────

const iso = (epochS: number): string => new Date(epochS * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

const FEED_TITLE: Readonly<Record<ArchivedExpiryOutcome['kind'], string>> = {
  expired: 'archived workspace cleaned up',
  'would-expire': 'archived workspace would be cleaned up',
  deferred: 'archived workspace cleanup deferred',
  refused: 'archived workspace cleanup refused',
  gone: 'archived workspace gone',
  failed: 'archived workspace cleanup failed',
  box: 'archived workspace cleanup failed',
  composition: 'archived workspace cleanup failed',
  'no-evidence': 'archived workspace cleanup has no evidence',
};

/** The feed row's words: what happened, to which archive, and when it was due. */
export function expireFeedBody(r: ExpireArchivedResult): string {
  const who = `${r.sessionId} (archived ${iso(r.archivedAt)}, due ${iso(r.expiresAt)})`;
  switch (r.kind) {
    case 'expired': {
      const wip = r.wip === null ? 'nothing uncommitted was left' : r.wip === 'unreadable' || r.wip === undefined
        ? 'uncommitted work was pinned, its commit id unreadable' : `uncommitted work was pinned as ${r.wip}`;
      const secrets = typeof r.secretsDropped === 'number' && r.secretsDropped > 0
        ? `; ${r.secretsDropped} secret-shaped ${r.secretsDropped === 1 ? 'path was' : 'paths were'} dropped and recorded` : '';
      return `${who} was cleaned up: its commits are kept in the attic (ccd ws-attic --session ${r.sessionId}), ${wip}${secrets}.`;
    }
    case 'would-expire':
      return `${who} would be cleaned up now — the cleanup is not armed (shadow), so nothing was deleted`
        + `${r.sensitive > 0 ? `; ${r.sensitive} secret-shaped ${r.sensitive === 1 ? 'file' : 'files'} would be dropped` : ''}.`;
    case 'deferred': return `${who}: deferred (${r.why}) — ${r.detail}.`;
    case 'refused': return `${who}: ccd refused (${r.token}) — ${r.detail}`;
    case 'gone': return `${who} left the archive before it was cleaned up.`;
    case 'failed': return `${who}: failed — ${r.detail}. It is retried, backing off in between.`;
    case 'box': return `${who}: the fleet box refused before it started (${r.word}) — ${r.detail}.`;
    case 'composition': return `${who}: ccd rejected the call this server composed — ${r.detail}. It is not retried.`;
    case 'no-evidence': return `${who}: the fleet box's ccd does not say when this archive expires; nothing was composed.`;
  }
}

/** ONE feed row for an outcome — written by the LANE, and only when the row's outcome CHANGED, so a refusal that
 *  stands is one row, not one a minute. `kind: 'run'` with no run: recorded, never pushed, in the unfiltered feed.
 *  A missing log degrades the record and never the act. */
export function recordExpireFeed(deps: Pick<ExpireArchivedDeps, 'coord' | 'notifyLog'>, r: ExpireArchivedResult): void {
  const log = deps.notifyLog;
  if (!log) return;
  try {
    const ev = log.record({ kind: 'run', sessionId: r.sessionId, runId: null, title: FEED_TITLE[r.kind], body: expireFeedBody(r) });
    deps.coord.recordFeedEvent(log.epoch, ev);
  } catch (err) {
    console.warn('ccrc-server: recordFeedEvent failed '
      + `(${err instanceof Error ? err.message : String(err)}) — archived expiry ${r.kind}, feed archive degraded`);
  } finally {
    void log.flush();
  }
}
````

- [ ] **Step 4: Run — green.**

```bash
( cd server && ./node_modules/.bin/vitest run test/expire-archived.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/verb-gate.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/tsc --noEmit -p . )
```

Measured: `expire-archived` `12 passed (12)`; `verb-gate` `12 passed (12)`; `mail-routes` `59 passed (59)`; `tsc` rc 0.

- [ ] **Step 5: Mutation check, then commit.**

| # | Edit (restore after) | Measured red |
|---|---|---|
| T6.1 | No capability check before the audit. `coord/expireArchived.ts`: step 1's `if (!capSupported(deps.fleetState, EXPIRE_CAP)) {` → `if (false) {` | `expire-archived`: `1 failed \| 11 passed (12)` — no `expire-v1` on the box is NO EVIDENCE: deferred, nothing composed |
| T6.2 | The act's own gate removed. `coord/expireArchived.ts`: `  if (!capSupported(deps.fleetState, EXPIRE_CAP)) return 'unsupported' as const;` deleted | `verb-gate`: `1 failed \| 11 passed (12)` — has no ungated call site outside UNGATED_BY_DECISION |
| T6.3 | Shadow ignored. `coord/expireArchived.ts`: `  if (!live) return answer({ kind: 'would-expire', sensitive: audit.sensitive });` deleted | `expire-archived`: `2 failed \| 10 passed (12)` — SHADOW … ws-expire is never composed; a feed row says what happened … — and a shadow row says nothing was deleted |
| T6.4 | The cleanup switch ignored. `if (names.includes(RECLAIM_PAUSE_MARKER)) {` → `if (false) {` | `expire-archived`: `1 failed \| 11 passed (12)` — `reclaim-paused` — the one cleanup switch — stops it before ccd is asked anything, shadow included |
| T6.5 | No evidence spent. `  if (audit.expiresAt.kind === 'absent') return answer({ kind: 'no-evidence' });` deleted | `expire-archived`: `1 failed \| 11 passed (12)` — an audit document with no `expiresAt` (an older ccd) is no evidence: nothing is composed |
| T6.6 | Another archive's token spent. `if (audit.archivedAt !== archivedAt \|\| audit.expiresAt.kind !== 'at') {` → `if (audit.expiresAt.kind !== 'at') {` | `expire-archived`: `1 failed \| 11 passed (12)` — an audit of ANOTHER archive than the one queued is a row that moved |
| T6.7 | Presence ignored. `if (deps.presence?.isVisible(sessionId) === true) {` → `if (false) {` | `expire-archived`: `1 failed \| 11 passed (12)` — a person at the session defers it, with no ceiling |
| T6.8 | An unlistable registry read as no switch. `if (names === null) {` / `return answer({ … 'paused-at-server', …` → `if (names === null) { names = []; } if (false) { …` | `expire-archived`: `1 failed \| 11 passed (12)` — a registry that did not list cannot rule the pause out: deferred, nothing asked |
| T6.9 | The kebab guard narrowed. `server/src/archivedExpiry.ts`: `… \|\| own(EXPIRY_OUTCOME_KINDS) \|\| own(EXPIRY_DEFER_WHYS);` → `… \|\| own(EXPIRY_DEFER_WHYS);` | `mail-routes`: `1 failed \| 58 passed (59)` — every quoted kebab token in server/src/coord that looks like a code is declared |
| T6.10 | `ws-expire` out of `CAP_GATED_VERBS`. `server/test/verb-gate.test.ts`: the set's `'ws-expire'` removed | `verb-gate`: `1 failed \| 11 passed (12)` — has no ungated call site outside UNGATED_BY_DECISION |

```bash
git add server/test/expire-archived.test.ts server/test/verb-gate.test.ts server/test/mail-routes.test.ts server/src/coord/expireArchived.ts
git commit -m "$(cat <<'MSG'
feat(expire): the expiry lane's one executor

expireArchived: expire-v1 (capSupported, refusing on no evidence), one
registry listing for the cleanup switch and the live marker, presence with no
ceiling, ws-audit --expire, expiresAt through the one reader, then — live
only — ws-expire with that audit's token, the capability asked again in the
act's own scope. Shadow answers would-expire and composes nothing. Box words
come back as themselves; a composition error is the server's.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: The lane — `sweepArchivedExpiry`, a sibling pass, shipped shadowed

**Model routing:** `opus`, effort `high` — the automatic trigger with no human in it; what reaches ccd, when and how often is the whole of the safety.

**Files:** tests `server/test/archived-expiry-lane.test.ts` (new), `server/test/single-definition.test.ts` (appended: the live switch's no-writer pin); source `server/src/watch.ts` (imports; the lane's memory; its tick dispatch; `currentArchivedExpiry()`; `sweepArchivedExpiry` and `archivedExpiryStoreRead`), `server/src/coord/expireArchived.ts` (`learnExpiry`).

**Interfaces:**
- `FleetWatcher.sweepArchivedExpiry(records, names)` — PUBLIC for the reason `sweepChildReclaim` is (`tick()` dispatches it with `void`), on the same tick, right after the child lane: the same registry read, the same cadence (`CHILD_RECLAIM_SWEEP_MS`, its own clock), the same switch. Per pass: (1) `reclaim-paused` stands, or no `expire-v1` → every twice-observed sighting dropped, nothing asked (what was learned and reported stands); (2) the archived WORKSPACES of this listing and ONE `lastRunBySession` read for them (a read that fails makes every row ineligible); (3) per row, its memory (`archivedExpiryEntryFor`: a changed archive is a fresh entry), the verdict, the sighting; a row whose instant is not yet known and whose `nextAskAt` has come is queued to LEARN, at most `EXPIRE_AUDITS_PER_PASS`; (4) the learning audits, one at a time on each session's `KeyedQueue` (`learnExpiry`); (5) AT MOST ONE act — never while one is in flight, never on a box that answered `flock-unavailable` — the due row asked least recently, then the oldest instant; the result folded by `archivedExpiryNextEntry`, written back only onto the entry it was asked for, and a feed row when the outcome changed; (6) the attention list, from the memory alone.
- `currentArchivedExpiry(): ReadonlyMap<string, ArchivedExpiryEntry>` — read-only, for the lane's tests; never read by the child lane's chip.
- `learnExpiry(deps, sessionId)` — the audit alone, behind `expire-v1`.
- `single-definition.test.ts`: `expire-lane-live` has no writer — no shell line names it, and its one TS holder is its definer, `server/src/archivedExpiry.ts`, which reaches no `node:` module (`stall-watch-live`'s pin, beside it).

- [ ] **Step 1: Write the failing tests.** Nothing reaches a box: ccd is a scripted recorder answering `ws-audit --expire` from the fixture registry's own archive stamp (`expiresAt` = that + 604 800 unless a case says otherwise) and `ws-expire` with an `expired` document; the tick's own tmux reads are answered and not recorded.

<!-- replay: create server/test/archived-expiry-lane.test.ts -->
Create `server/test/archived-expiry-lane.test.ts`:

````ts
// THE EXPIRY LANE, wired (workspace lifecycle spec 2026-09-24 §5.3 "The lane", wave 3b). `archived-expiry-policy`
// pins the L1 verdicts and `expire-archived` the executor; what is only provable HERE is what reaches ccd, when and how
// often: SHADOW composes no `ws-expire` however long a row has been due; `expire-lane-live` lets exactly one through
// per pass, fleet-wide; `reclaim-paused` stops everything, shadow included; the instant is LEARNED from ccd once per
// archive and never re-asked before it; an older ccd is no evidence; and the attention list reaches the coord frame.
// NOTHING here reaches a box: ccd is a scripted recorder, and the registry is a fixture HOME's.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { ACTOR_FLAGS_CAP, EXPIRE_CAP } from '../src/ccdargv.js';
import { EXPIRE_IN_USE_ATTENTION_PASSES, EXPIRE_LANE_LIVE_MARKER, EXPIRE_NO_EVIDENCE_RETRY_MS } from '../src/archivedExpiry.js';
import { NotifyLog } from '../src/notifylog.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

const WEEK = 604_800;
const T0 = 1_790_000_000_000;
const OLD = T0 / 1000 - 8 * 86_400;
const tokOf = (id: string): string => (id.length.toString(16) + 'f'.repeat(64)).slice(0, 64);

interface Opts {
  cap?: boolean;
  /** Per session, what `ws-audit --expire` answers (default: expirable, with the archive on disk). */
  audit?: (id: string, archivedAt: number) => Record<string, unknown> | 'old-ccd';
}

const fixture = async (opts: Opts = {}) => {
  let clock = T0;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const home = mkTmp('ccrc-expiry-lane-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  const calls: string[][] = [];
  const archivedOf = (id: string): number => Number(readdirSync(reg).includes(`${id}.archived`)
    ? readFileSync(path.join(reg, `${id}.archived`), 'utf8').trim() : 0);
  const run = async (cmd: string, args: string[]) => {
    if (path.basename(cmd) === 'tmux') return { code: 1, stdout: '', stderr: '' };   // the tick's pane reads, not ccd
    calls.push(args);
    const id = args[args.indexOf('--session') + 1] ?? '';
    if (args[0] === 'ws-audit') {
      const at = archivedOf(id);
      const doc = opts.audit?.(id, at) ?? { verdict: 'expirable', token: tokOf(id) };
      if (doc === 'old-ccd') {
        return { code: 0, stdout: JSON.stringify({ session: id, mode: 'expire', archivedAt: at, alive: false, exists: true,
          reaping: null, sensitive: [], verdict: 'expirable', detail: '', token: tokOf(id) }), stderr: '' };
      }
      return { code: 0, stdout: JSON.stringify({ session: id, mode: 'expire', archivedAt: at, expiresAt: at + WEEK,
        alive: false, exists: true, reaping: null, sensitive: [], detail: '', ...doc }), stderr: '' };
    }
    if (args[0] === 'ws-expire') {
      return { code: 0, stdout: JSON.stringify({ expired: id, archivedAt: archivedOf(id), wip: null, attic: 2,
        residueBytes: 0, secretsDropped: 0 }), stderr: '' };
    }
    return { code: 1, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps = {
    ...testDeps(home, run), cfg, coord, notifyLog,
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
      ccdVerbs: ['ws-audit', 'ws-expire', ...(opts.cap === false ? [] : [EXPIRE_CAP]), ACTOR_FLAGS_CAP] },
    presence: { isVisible: () => false },
  };
  const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  /** An archived workspace, as `ws-archive` leaves it: the epoch in `.archived`. */
  const plant = (id: string, archivedAt = OLD, extra: Record<string, string> = {}): void => {
    const fields: Record<string, string> = { uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`,
      workspace: id.slice('demo-'.length), branch: `ws/${id}`, base: 'origin/main', started: '1',
      archived: String(archivedAt), archivedreason: 'operator', ...extra };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
  };
  const pass = async (): Promise<void> => {
    await watcher.sweepArchivedExpiry(await readRegistry(deps.io, cfg), readdirSync(reg));
  };
  const next = (): void => { clock += CHILD_RECLAIM_SWEEP_MS + 1; };
  const verbsFor = (verb: string): string[] => calls.filter((c) => c[0] === verb).map((c) => c[c.indexOf('--session') + 1]!);
  const touch = (name: string): void => writeFileSync(path.join(reg, name), '');
  const feed = () => coord.feedEvents(50).map((e) => [e.sessionId, e.title] as const);
  return { reg, coord, watcher, calls, plant, pass, next, verbsFor, touch, feed, advance: (ms: number) => { clock += ms; },
    entry: (id: string) => watcher.currentArchivedExpiry().get(id) };
};

/** Three passes: the instant is learned, eligibility is seen once, and seen again — the row is due on the third. */
const threePasses = async (f: Awaited<ReturnType<typeof fixture>>): Promise<void> => {
  await f.pass(); f.next(); await f.pass(); f.next(); await f.pass();
};

describe('the lane SHIPS SHADOWED', () => {
  it('without `expire-lane-live`, a due row is audited and RECORDED — and ws-expire is never composed, however long', async () => {
    const f = await fixture();
    f.plant('demo-a');
    await threePasses(f);
    for (let k = 0; k < 20; k += 1) { f.next(); await f.pass(); }
    expect(f.verbsFor('ws-expire'), 'shadow composes nothing destructive').toEqual([]);
    expect(f.verbsFor('ws-audit').length).toBeGreaterThan(0);
    expect(f.feed()).toContainEqual(['demo-a', 'archived workspace would be cleaned up']);
    expect(f.feed().filter(([, t]) => t === 'archived workspace would be cleaned up'), 'one row, not one a pass').toHaveLength(1);
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.expiryAttention?.map((a) => [a.sessionId, a.kind])).toEqual([['demo-a', 'would-expire']]);
    expect(f.watcher.currentCoord()?.childReclaimAttention, 'never the child lane’s list').toEqual([]);
  });

  it('with `expire-lane-live`, the due row is expired with its audit’s token — twice observed, never on the first sighting', async () => {
    const f = await fixture();
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await f.pass();
    expect(f.verbsFor('ws-expire'), 'pass 1 learns the instant').toEqual([]);
    f.next(); await f.pass();
    expect(f.verbsFor('ws-expire'), 'pass 2 is the first eligible sighting').toEqual([]);
    f.next(); await f.pass();
    expect(f.verbsFor('ws-expire')).toEqual(['demo-a']);
    const verb = f.calls.find((c) => c[0] === 'ws-expire')!;
    expect(verb.slice(0, 5)).toEqual(['ws-expire', '--expect', tokOf('demo-a'), '--session', 'demo-a']);
    expect(f.feed()).toContainEqual(['demo-a', 'archived workspace cleaned up']);
    expect(f.entry('demo-a'), 'finished with').toBeUndefined();
  });

  it('at most ONE ws-expire is composed per pass, fleet-wide', async () => {
    const f = await fixture();
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a'); f.plant('demo-b'); f.plant('demo-c');
    await threePasses(f);
    expect(f.verbsFor('ws-expire')).toHaveLength(1);
    f.next(); await f.pass();
    expect(f.verbsFor('ws-expire')).toHaveLength(2);
    f.next(); await f.pass();
    expect(f.verbsFor('ws-expire').sort()).toEqual(['demo-a', 'demo-b', 'demo-c']);
  });
});

describe('`reclaim-paused` — the one cleanup switch — stops the lane ENTIRELY', () => {
  it('no audit, no record, no verb, live or shadow; lowered, the row needs two fresh passes', async () => {
    for (const live of [false, true]) {
      const f = await fixture();
      if (live) f.touch(EXPIRE_LANE_LIVE_MARKER);
      f.touch('reclaim-paused');
      f.plant('demo-a');
      await threePasses(f);
      f.next(); await f.pass();
      expect(f.calls, `paused, live=${live}`).toEqual([]);
      expect(f.feed()).toEqual([]);
      rmSync(path.join(f.reg, 'reclaim-paused'));
      f.next(); await f.pass(); f.next(); await f.pass();
      expect(f.verbsFor('ws-expire'), 'the instant learned, one sighting — not yet').toEqual([]);
    }
  });
});

describe('the threshold is ccd’s — never typed by the server', () => {
  it('a YOUNG archive is audited once to learn its instant, and not again before it', async () => {
    const f = await fixture();
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a', T0 / 1000 - 3600);
    await f.pass();
    expect(f.verbsFor('ws-audit')).toEqual(['demo-a']);
    for (let k = 0; k < 30; k += 1) { f.next(); await f.pass(); }
    expect(f.verbsFor('ws-audit'), 'not re-audited before its instant').toEqual(['demo-a']);
    expect(f.verbsFor('ws-expire')).toEqual([]);
  });

  it('…unless its archive changes: a row returned and archived again is learned afresh', async () => {
    const f = await fixture();
    f.plant('demo-a', T0 / 1000 - 3600);
    await f.pass();
    f.next();
    writeFileSync(path.join(f.reg, 'demo-a.archived'), String(T0 / 1000 - 60));
    await f.pass();
    expect(f.verbsFor('ws-audit')).toEqual(['demo-a', 'demo-a']);
  });

  it('an older ccd’s document (no `expiresAt`) is NO EVIDENCE: nothing composed, reported, asked again only after an hour', async () => {
    const f = await fixture({ audit: () => 'old-ccd' });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    for (let k = 0; k < 10; k += 1) { await f.pass(); f.next(); }
    expect(f.verbsFor('ws-expire')).toEqual([]);
    expect(f.verbsFor('ws-audit'), 'once, not once a pass').toEqual(['demo-a']);
    expect(f.entry('demo-a')?.report?.kind).toBe('no-evidence');
    f.advance(EXPIRE_NO_EVIDENCE_RETRY_MS); await f.pass();
    expect(f.verbsFor('ws-audit')).toEqual(['demo-a', 'demo-a']);
  });

  it('no `expire-v1` on the box: nothing at all', async () => {
    const f = await fixture({ cap: false });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await threePasses(f);
    expect(f.calls).toEqual([]);
  });
});

describe('the population — what the lane never touches', () => {
  it('a child (CCR-15’s), a held row (listed, not acted on), and a row an open run names', async () => {
    const f = await fixture();
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-child', OLD, { child: '7' });
    f.plant('demo-held', OLD, { hold: 'program:x wave:1/2' });
    f.plant('demo-worker');
    const r = f.coord.openRun({ program: 'p', title: 'p', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in r)) throw new Error('openRun refused');
    f.coord.markDispatched(r.id, 'demo-worker', 'demo-worker', 'ws/demo-worker', false);
    await threePasses(f);
    f.next(); await f.pass();
    expect(f.verbsFor('ws-expire')).toEqual([]);
    expect(f.verbsFor('ws-audit'), 'a child is never even audited here').not.toContain('demo-child');
    await f.watcher.tick();
    expect(f.watcher.currentCoord()?.expiryAttention?.map((a) => [a.sessionId, a.kind])).toEqual([['demo-held', 'held']]);
  });
});

describe('a standing in-use refusal is EXPECTED — reported, naming what it is, and never killed', () => {
  it(`after ${EXPIRE_IN_USE_ATTENTION_PASSES} refusals the row is listed with the pid, its command and the path`, async () => {
    const inUse = [{ pid: 3453108, comm: 'tmux: server', cwd: '/w/demo-a' }];
    const f = await fixture({ audit: (id) => (id === 'demo-a'
      ? { verdict: 'in-use', detail: 'process 3453108 (tmux: server) has its working directory at /w/demo-a', inUse }
      : { verdict: 'expirable', token: tokOf(id) }) });
    f.touch(EXPIRE_LANE_LIVE_MARKER);
    f.plant('demo-a');
    await threePasses(f);
    for (let k = 1; k < EXPIRE_IN_USE_ATTENTION_PASSES; k += 1) { f.next(); await f.pass(); }
    await f.watcher.tick();
    const listed = f.watcher.currentCoord()?.expiryAttention ?? [];
    expect(listed.map((a) => a.kind)).toEqual(['in-use']);
    expect(listed[0]!.sentence).toContain('process 3453108 (“tmux: server”) in /w/demo-a');
    expect(listed[0]!.sentence).toContain('the fleet’s own tmux server is also a “tmux: server”');
    expect(f.verbsFor('ws-expire')).toEqual([]);
    expect(f.calls.filter((c) => c[0] !== 'ws-audit'), 'nothing but audits: nothing is killed or stopped').toEqual([]);
  });
});
````

<!-- replay: replace server/test/single-definition.test.ts -->
In `server/test/single-definition.test.ts`, find:

````ts
    expect(ALL.filter((f) => SPELLING.test(stallCode(f))).map(rel).sort(), 'a second spelling').toEqual(['server/src/coord/stall.ts']);
  });
});
````

Replace with:

````ts
    expect(ALL.filter((f) => SPELLING.test(stallCode(f))).map(rel).sort(), 'a second spelling').toEqual(['server/src/coord/stall.ts']);
  });
});

// WORKSPACE LIFECYCLE WAVE 3b (spec 2026-09-24 §5.3, the coordinator's safety ruling (E)). APPENDED, for the reason
// the stall-watch blocks above state: `session-hook.test.ts`'s citation audit cites this file by line. The expiry lane
// SHIPS SHADOWED: until `$REG/expire-lane-live` exists it audits and records "would expire" and never composes
// `ws-expire`. The file is the operator's to touch BY HAND on the fleet box, beside `stall-watch-live` above — so no
// line of shell names it (a writer, or a reader the design never had), and its one TS holder is its definer, an L1
// file that reaches no `node:` module and so cannot write it.
describe('workspace lifecycle wave 3b: the expiry lane’s live switch has no writer in the tree', () => {
  const NAME = 'expire-lane-live';
  const DEFINER = 'server/src/archivedExpiry.ts';

  it('no shell line names it, and its one TS holder is its definer', () => {
    expect(holdersOf(NAME), 'a line of shell names it — a writer, or a reader this design never had').toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(NAME)).map(rel).sort(), `spelled on a code line outside ${DEFINER}`)
      .toEqual([DEFINER]);
    expect(stallCode(path.join(ccrcRoot, DEFINER)), `${DEFINER} reaches a node: module or require — it could write the marker`)
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });
});
````

- [ ] **Step 2: Run them — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-lane.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=1 )
```

Measured: `archived-expiry-lane`: `10 failed (10)` — `TypeError: watcher.sweepArchivedExpiry is not a function`; `single-definition` `275 passed (275)` — the pin is green from Task 5 on (the definer exists); row T7.7 is its red.

- [ ] **Step 3: Make them pass.**

<!-- replay: replace server/src/coord/expireArchived.ts -->
In `server/src/coord/expireArchived.ts`, find:

````ts
/** The audit — its own function, as `childReclaimAudit` is: an old verb (`ws-audit`), asked the old question. ANY
 *  exit 1 is `unreadable` (`parseExpireAudit` reads the exit before a byte of the document). */
async function expireAudit(deps: ExpireArchivedDeps, sessionId: string): Promise<ExpireAuditRead> {
````

Replace with:

````ts
/** The lane's LEARNING read (wave 3b): the audit alone, to learn when this archive expires — ccd's own instant, so
 *  the server never types the threshold. Read-only on the box (`ws-audit` journals a terminal refusal and nothing
 *  else); behind the capability, as the act is. */
export async function learnExpiry(deps: Pick<ExpireArchivedDeps, 'runCcd' | 'fleetState'>, sessionId: string): Promise<ExpireAuditRead> {
  if (!capSupported(deps.fleetState, EXPIRE_CAP)) return { kind: 'unreadable', detail: `the fleet host does not advertise ${EXPIRE_CAP}` };
  return expireAudit(deps, sessionId);
}

/** The audit — its own function, as `childReclaimAudit` is: an old verb (`ws-audit`), asked the old question. ANY
 *  exit 1 is `unreadable` (`parseExpireAudit` reads the exit before a byte of the document). */
async function expireAudit(deps: Pick<ExpireArchivedDeps, 'runCcd' | 'fleetState'>, sessionId: string): Promise<ExpireAuditRead> {
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts
import { CCD_ARGV, RECLAIM_CAP, RECLAIM_PAUSE_CAP, capSupported, verbSupported, sweepDec } from './ccdargv.js';
````

Replace with:

````ts
import { CCD_ARGV, EXPIRE_CAP, RECLAIM_CAP, RECLAIM_PAUSE_CAP, capSupported, verbSupported, sweepDec } from './ccdargv.js';
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts
import { CHILD_BIRTH_SKEW_MS } from './coord/childSpent.js';
````

Replace with:

````ts
import { CHILD_BIRTH_SKEW_MS } from './coord/childSpent.js';
import {
  EXPIRE_AUDITS_PER_PASS, archivedExpiryDue, archivedExpiryEntryFor, archivedExpiryLearned, archivedExpiryNextEntry,
  archivedExpiryOutcomeKey, archivedExpirySighted, archivedExpiryVerdict, expiryAttention, reviewKeeps,
  type ArchivedExpiryEntry, type ExpiryStoreRead,
} from './archivedExpiry.js';
import { expireArchived, learnExpiry, recordExpireFeed } from './coord/expireArchived.js';
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts
  private expiryAttentionList: readonly ExpiryAttention[] = [];
````

Replace with:

````ts
  private expiryAttentionList: readonly ExpiryAttention[] = [];
  /** The expiry lane's clock and memory (wave 3b): its OWN — never the child lane's map, which wave 5's chip reads.
   *  Per archived workspace, `ArchivedExpiryEntry` (L1): the instant ccd gave for THIS archive, the twice-observed
   *  sighting, the last outcome (for change-only feed rows), the in-use and failure runs and the report. IN MEMORY
   *  ONLY: a restart can only DELAY an expiry. */
  private lastArchivedExpirySweep = 0;
  private archivedExpiryState = new Map<string, ArchivedExpiryEntry>();
  /** AT MOST ONE expiry act in flight, fleet-wide — and at most one composed per pass. */
  private archivedExpiryInFlight = false;
  /** `flock-unavailable`, once a box has answered it: the lane composes nothing more there (this process). */
  private archivedExpiryBoxRefused: string | null = null;
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts

  /** The last measured project-pool sweep, or null if none has been taken yet
````

Replace with:

````ts

  /** The expiry lane's memory, read-only (wave 3b) — for its tests. NEVER read by the child lane's chip. */
  currentArchivedExpiry(): ReadonlyMap<string, ArchivedExpiryEntry> {
    return this.archivedExpiryState;
  }

  /** The last measured project-pool sweep, or null if none has been taken yet
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts
      void this.sweepChildReclaim(records, registryRead.names)
````

Replace with:

````ts
      void this.sweepChildReclaim(records, registryRead.names)
        .catch(() => { /* one bad sweep must not kill the poll */ });
      // NEVER awaited, the child lane's reasons: the EXPIRY lane (workspace lifecycle wave 3b) — a SIBLING pass on
      // the same tick's registry read, at the same cadence, under the same switch, sharing nothing else.
      void this.sweepArchivedExpiry(records, registryRead.names)
````

<!-- replay: replace server/src/watch.ts -->
In `server/src/watch.ts`, find:

````ts
      coord, io: this.deps.io, cfg: this.deps.cfg, runCcd: this.deps.runCcd,
      fleetState: this.deps.fleetState, presence: this.deps.presence, notifyLog: this.deps.notifyLog,
    }, req));
  }

  /** The hold-release job's own executor: `releaseRetiredChildHold` on the
````

Replace with:

````ts
      coord, io: this.deps.io, cfg: this.deps.cfg, runCcd: this.deps.runCcd,
      fleetState: this.deps.fleetState, presence: this.deps.presence, notifyLog: this.deps.notifyLog,
    }, req));
  }

  /**
   * THE EXPIRY LANE (workspace lifecycle spec 2026-09-24 §5.3 "The lane", wave 3b): ARCHIVED workspaces, seven days
   * after their archive. A SIBLING of `sweepChildReclaim` on the same tick — its registry read, its cadence
   * (`CHILD_RECLAIM_SWEEP_MS`) and its switch (`reclaim-paused`, now the fleet's ONE cleanup switch) — and nothing else:
   * its own memory, verdict (`archivedExpiryVerdict`, L1), executor (`expireArchived`), feed rows and attention list.
   * A sibling pass, not a branch inside the child lane's, so neither lane's early return (the mirror unread, a
   * capability missing) can silence the other (the departure `expiry-lane-is-a-sibling-pass`).
   *
   * IT SHIPS SHADOWED (the coordinator's safety ruling (E)). Until the operator touches `$REG/expire-lane-live` by
   * hand, a due row is AUDITED and RECORDED — "would expire <id>", a feed row and an attention entry — and `ws-expire`
   * is never composed; the executor re-reads the file at the act. `reclaim-paused` stops the lane ENTIRELY, shadow
   * included: no audit, no record.
   *
   * THE THRESHOLD IS NEVER TYPED HERE. A row's instant is LEARNED from ccd (`learnExpiry`: the audit's `expiresAt`,
   * read through ONE reader), once per archive, at most `EXPIRE_AUDITS_PER_PASS` rows a pass; a row is not audited
   * again before its instant unless its archive changes. A box whose ccd predates the key answers no evidence, and
   * nothing is composed for that row.
   *
   * WHAT IT ASKS FOR. A row twice-observed eligible (`archivedExpiryVerdict` on two passes) is DUE; AT MOST ONE act
   * runs per pass, fleet-wide, and never while one is in flight. Every outcome is folded into memory by L1
   * (`archivedExpiryNextEntry`); a feed row is written when a row's outcome CHANGES. Presence defers with no ceiling;
   * a standing `in-use` is reported, naming what holds it, and never killed.
   */
  async sweepArchivedExpiry(records: readonly SessionRecord[], names: readonly string[]): Promise<void> {
    const coord = this.deps.coord;
    if (!coord) return;
    const now = Date.now();
    if (this.lastArchivedExpirySweep !== 0 && now - this.lastArchivedExpirySweep < CHILD_RECLAIM_SWEEP_MS) return;
    this.lastArchivedExpirySweep = now;
    const forgetSightings = (): void => {
      for (const [id, e] of this.archivedExpiryState) {
        if (e.eligibleSince !== null) this.archivedExpiryState.set(id, { ...e, eligibleSince: null });
      }
    };
    // ONE — the switch and the capability. Either way the twice-observed sightings are dropped: a row needs two
    // FRESH passes once the switch is lowered or the box proves the verb. What was learned and reported stands.
    if (names.includes(RECLAIM_PAUSE_MARKER) || !capSupported(this.deps.fleetState, EXPIRE_CAP)) {
      forgetSightings();
      return;
    }
    // TWO — the population, and the store's answers for it, read ONCE (`lastRunBySession`). A read that fails makes
    // every row ineligible this pass.
    const archived = records.filter((r) => r.workspace !== null && r.archivedAt !== null);
    let store: { ok: true; workers: ReadonlySet<string>; claimants: ReadonlySet<string> } | { ok: false; detail: string };
    try {
      const last = coord.lastRunBySession(archived.map((r) => r.id));
      store = last.ok ? { ok: true, workers: new Set(last.openWorkers), claimants: new Set(last.openClaimants) }
        : { ok: false, detail: last.detail };
    } catch (err) {
      store = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    const seen = new Set<string>();
    const learn: string[] = [];
    const due: string[] = [];
    for (const r of archived) {
      seen.add(r.id);
      let entry = archivedExpiryEntryFor(this.archivedExpiryState.get(r.id), r.archivedAt!);
      const past = entry.expiresAt !== null && now >= entry.expiresAt * 1000;
      const read: ExpiryStoreRead = !store.ok ? { ok: false, detail: store.detail } : this.archivedExpiryStoreRead(
        coord, r.id, store.workers.has(r.id), store.claimants.has(r.id), past);
      const v = archivedExpiryVerdict({
        sessionId: r.id, workspace: r.workspace, archivedAt: r.archivedAt, child: r.child,
        identityMeasured: r.unmeasured.length === 0, held: r.held, store: read, expiresAt: entry.expiresAt, nowMs: now,
      });
      entry = archivedExpirySighted(entry, v, r.held, now);
      this.archivedExpiryState.set(r.id, entry);
      if (!v.eligible && v.why === 'expiry-unknown' && now >= entry.nextAskAt && learn.length < EXPIRE_AUDITS_PER_PASS) {
        learn.push(r.id);
      }
      if (archivedExpiryDue(entry, now)) due.push(r.id);
    }
    for (const id of [...this.archivedExpiryState.keys()]) if (!seen.has(id)) this.archivedExpiryState.delete(id);
    // THREE — learn: one audit at a time, each on its session's queue.
    for (const id of learn) {
      try {
        const read = await this.deps.queue.run(id, () => learnExpiry(this.deps, id));
        const e = this.archivedExpiryState.get(id);
        if (e !== undefined) this.archivedExpiryState.set(id, archivedExpiryLearned(e, read, Date.now(), CHILD_RECLAIM_SWEEP_MS));
      } catch (err) {
        console.warn(`ccrc-server: sweepArchivedExpiry: learning ${id}'s expiry threw (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    // FOUR — the act: at most ONE per pass, fleet-wide, never while one is in flight, never on a box that answered
    // `flock-unavailable`. Never asked first: the row whose `nextAskAt` is earliest, then the oldest instant.
    if (!this.archivedExpiryInFlight && this.archivedExpiryBoxRefused === null && due.length > 0) {
      const pick = due.map((id) => [id, this.archivedExpiryState.get(id)!] as const)
        .sort(([ia, a], [ib, b]) => a.nextAskAt - b.nextAskAt || (a.expiresAt ?? 0) - (b.expiresAt ?? 0) || (ia < ib ? -1 : 1))[0]!;
      const [id, entry] = pick;
      this.archivedExpiryInFlight = true;
      try {
        const result = await this.deps.queue.run(id, () => expireArchived({
          coord, io: this.deps.io, cfg: this.deps.cfg, runCcd: this.deps.runCcd, fleetState: this.deps.fleetState,
          presence: this.deps.presence, notifyLog: this.deps.notifyLog,
        }, { sessionId: id, archivedAt: entry.archivedAt, expiresAt: entry.expiresAt! }));
        if (result.kind === 'box' && result.word === 'flock-unavailable') this.archivedExpiryBoxRefused = result.detail;
        if (archivedExpiryOutcomeKey(result) !== entry.lastOutcome) recordExpireFeed({ coord, notifyLog: this.deps.notifyLog }, result);
        // Write back ONLY onto the entry this act was asked for: a pass that ran meanwhile may have dropped or
        // re-keyed it (the row returned, archived again, or left the registry).
        if (this.archivedExpiryState.get(id) === entry) {
          const next = archivedExpiryNextEntry(entry, result, Date.now(), CHILD_RECLAIM_SWEEP_MS);
          if (next === null) this.archivedExpiryState.delete(id); else this.archivedExpiryState.set(id, next);
        }
      } catch (err) {
        console.warn(`ccrc-server: sweepArchivedExpiry: the expiry of ${id} threw (${err instanceof Error ? err.message : String(err)}) — left for the next pass`);
      } finally {
        this.archivedExpiryInFlight = false;
      }
    }
    // FIVE — the attention list, from the lane's memory alone.
    this.expiryAttentionList = expiryAttention(this.archivedExpiryState);
  }

  /** One archived row's store answers (spec §5.3's run conjuncts). `reviewing` — a REVIEW run naming this row whose
   *  reviewed run is not terminal — is read only for a row PAST its instant (`past`), the only rows it can decide;
   *  any read here that fails is the whole store's failure for this row. */
  private archivedExpiryStoreRead(
    coord: CoordStore, id: string, openWorker: boolean, openClaimant: boolean, past: boolean,
  ): ExpiryStoreRead {
    if (!past || openWorker || openClaimant) return { ok: true, openWorker, openClaimant, reviewing: false };
    try {
      const naming = coord.runsNamingSession(id);
      if (!naming.ok) return { ok: false, detail: naming.detail };
      for (const row of naming.runs) {
        const run = coord.run(row.id);
        if (!run.ok) return { ok: false, detail: run.detail };
        const reviews = run.run?.reviews ?? null;
        if (reviews === null) continue;
        const reviewed = coord.run(reviews);
        const keeps = reviewKeeps(!reviewed.ok ? { kind: 'unreadable' } : reviewed.run === null ? { kind: 'absent' }
          : { kind: 'run', state: reviewed.run.state });
        if (keeps) return { ok: true, openWorker, openClaimant, reviewing: true };
      }
      return { ok: true, openWorker, openClaimant, reviewing: false };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /** The hold-release job's own executor: `releaseRetiredChildHold` on the
````

- [ ] **Step 4: Run — green**, and every suite the watcher's tick reaches.

```bash
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-lane.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/expire-archived.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/child-reclaim-sweep-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/child-reclaim.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/fleetws.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/boot.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/tsc --noEmit -p . )
```

Measured: `archived-expiry-lane` `10 passed (10)`; `single-definition` `275 passed (275)`; `expire-archived` `12 passed (12)`; `child-reclaim-sweep` `74 passed (74)`; `child-reclaim-sweep-policy` `86 passed (86)`; `child-reclaim` `128 passed (128)`; `fleetws` `54 passed (54)`; `boot` `3 passed (3)` (its "a hung ccd … does not delay listen" timing case once read `3929 < 3000` under load and passed alone — a load flake); `tsc` rc 0.

- [ ] **Step 5: Mutation check, then commit.**

| # | Edit (restore after; re-stamp after `ccd/ccd`) | Measured red |
|---|---|---|
| T7.1 | Shadow forgotten at the act. `coord/expireArchived.ts`: `  const live = names.includes(EXPIRE_LANE_LIVE_MARKER);` → `  const live = true \|\| names.includes(EXPIRE_LANE_LIVE_MARKER);` | `archived-expiry-lane`: `1 failed \| 9 passed (10)` — without `expire-lane-live`, a due row is audited and RECORDED — and ws-expire is never composed, however long |
| T7.2 | The lane deaf to the switch. `watch.ts`: `if (names.includes(RECLAIM_PAUSE_MARKER) \|\| !capSupported(this.deps.fleetState, EXPIRE_CAP)) {` → `if (!capSupported(this.deps.fleetState, EXPIRE_CAP)) {` | `archived-expiry-lane`: `1 failed \| 9 passed (10)` — no audit, no record, no verb, live or shadow … (the executor still defers, but the lane's learning audits reach ccd) |
| T7.3 | More than one act a pass. `watch.ts`: `if (!this.archivedExpiryInFlight && this.archivedExpiryBoxRefused === null && due.length > 0) {` / `const pick = due.map(` → `for (const one of due) if (!this.archivedExpiryInFlight && this.archivedExpiryBoxRefused === null) {` / `const pick = [one].map(` | `archived-expiry-lane`: `1 failed \| 9 passed (10)` — at most ONE ws-expire is composed per pass, fleet-wide |
| T7.4 | Twice observed skipped. `watch.ts`: `      if (archivedExpiryDue(entry, now)) due.push(r.id);` → `      if (v.eligible && now >= entry.nextAskAt) due.push(r.id);` | `archived-expiry-lane`: `3 failed \| 7 passed (10)` — with `expire-lane-live`, the due row is expired … — twice observed, never on the first sighting; at most ONE …; no audit, no record … |
| T7.5 | Audited every pass. `watch.ts`: `if (!v.eligible && v.why === 'expiry-unknown' && now >= entry.nextAskAt && learn.length < EXPIRE_AUDITS_PER_PASS) {` → `if (!v.eligible && v.why !== 'child' && learn.length < EXPIRE_AUDITS_PER_PASS) {` | `archived-expiry-lane`: `2 failed \| 8 passed (10)` — a YOUNG archive is audited once to learn its instant, and not again before it; an older ccd’s document … asked again only after an hour |
| T7.6 | An archive's instant kept across a re-archive. `watch.ts`: `let entry = archivedExpiryEntryFor(this.archivedExpiryState.get(r.id), r.archivedAt!);` → `let entry = this.archivedExpiryState.get(r.id) ?? archivedExpiryEntryFor(undefined, r.archivedAt!);` | `archived-expiry-lane`: `1 failed \| 9 passed (10)` — …unless its archive changes: a row returned and archived again is learned afresh |
| T7.7 | A shell line writes the live switch. `ccd/ccd`: `: "$REG/expire-lane-live"` added above the `EXPIRE-END` marker line | `single-definition`: `1 failed \| 274 passed (275)` — no shell line names it, and its one TS holder is its definer |
| T7.8 | A feed row every pass. `watch.ts`: `if (archivedExpiryOutcomeKey(result) !== entry.lastOutcome) recordExpireFeed(` → `if (archivedExpiryOutcomeKey(result) !== 'x') recordExpireFeed(` | `archived-expiry-lane`: `1 failed \| 9 passed (10)` — without `expire-lane-live` … (`one row, not one a pass`) |

```bash
git add server/test/archived-expiry-lane.test.ts server/test/single-definition.test.ts server/src/watch.ts server/src/coord/expireArchived.ts
git commit -m "$(cat <<'MSG'
feat(expire): the expiry lane, a sibling of the reclaim sweep — shipped shadowed

sweepArchivedExpiry runs on the reclaim sweep's tick, cadence and switch with
its own memory, executor call, change-only feed rows and attention list. It
learns each archive's expiry instant from ccd once (at most three audits a
pass), acts on a row twice observed eligible past it, and composes at most one
ws-expire per pass, fleet-wide. Until $REG/expire-lane-live exists it records
"would expire" and composes nothing; reclaim-paused stops it entirely. The
live switch has no writer in the tree, pinned.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: The one cleanup switch, and the words that move with the live arm

**Model routing:** `sonnet`, effort `high` — PWA words and a list, five documents and one verbatim skill clause; every sentence pinned by what it must say.

**Files:** tests `pwa/test/child-reclaim-banner.test.tsx`, `pwa/test/archive-sheet.test.tsx`, `server/test/coordinator-skill.test.ts` (clause 3's pin and §6), `server/test/expiry-lane-prose.test.ts` (new); source `pwa/src/fleet/expiryWords.ts` (new), `pwa/src/fleet/ExpiryAttention.tsx` (new), `pwa/src/fleet/ChildReclaimBanner.tsx`, `pwa/src/fleet/childReclaimWords.ts`, `pwa/src/fleet/ArchiveSheet.tsx`, `ccd/coordinator-skill/SKILL.md`, `ccd/coordinator-skill/references/wave-lifecycle.md`, `README.md`, `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` (§5.8), `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` (§5.3, §6 item 1).

**Interfaces:**
- Produces (PWA): `expiryAttentionOf(coord)` — THE ONE READER of `CoordStatus.expiryAttention` (absent → `[]`; a malformed member dropped alone); `EXPIRY_KIND_WORD` and `expiryKindWord(kind)` (a kind from a newer server reads `reported`); `<ExpiryAttention coord>` — the list, a REPORT (no button, no link), rendered INSIDE the cleanup row under the children's list, in the row's existing classes (`fleet.css` is not touched).
- Changes (PWA): the cleanup row's words — `cleanup not paused` / `cleanup paused` / `cleanup switch unreadable`, and the toggle `Pause cleanup` / `Resume cleanup`; the archive-confirm copy for a workspace, spec §5.2: "It goes offline and folds into Archived. Restore brings it back for 7 days; after that it is cleaned up."
- Changes (texts): coordinator clause 3 ends "…this session’s own workspace is cleaned up by a human, or by the server seven days after it is archived." (spec §5.3, verbatim, with its pin); `wave-lifecycle.md` §6 (the coordinator's own workspace, and `has-coordinated`); README (a coordinator's own workspace; a new paragraph, **Archived workspaces are cleaned up after seven days**); CCR-15 §5.8 — the ONE passage of that spec that says the pause stops "nothing else" — amended (spec §6 item 1; it edits no other CCR-15 passage, and the coordinator pre-notifies child reclamation's coordinator); the lifecycle spec's §5.3 gains **As wave 3b builds the lane** and §6 item 1 its amendment note. No skill file names `ws-expire` (wave 3's pin) or `expire-lane-live` (this task's).
- These land in the SAME commit series as the lane's live arm (Task 7) and after it — never before — so no text claims a cleanup that does not run (ruling F). While the lane is shadowed the copy says what an ARMED fleet does; the deploy note says the operator arms it.

- [ ] **Step 1: Write the failing tests.**

<!-- replay: replace pwa/test/archive-sheet.test.tsx -->
In `pwa/test/archive-sheet.test.tsx`, find:

````tsx
    expect(screen.getByText('It goes offline and folds into Archived. Restore brings it back.')).toBeInTheDocument();
````

Replace with:

````tsx
    expect(screen.getByText('It goes offline and folds into Archived. Restore brings it back for 7 days; after that it is cleaned up.')).toBeInTheDocument();
````

<!-- replay: replace pwa/test/child-reclaim-banner.test.tsx -->
In `pwa/test/child-reclaim-banner.test.tsx`, find:

````tsx
} from '../src/fleet/childReclaimWords';
````

Replace with:

````tsx
} from '../src/fleet/childReclaimWords';
import { EXPIRY_KIND_WORD, expiryAttentionOf } from '../src/fleet/expiryWords';
````

<!-- replay: replace pwa/test/child-reclaim-banner.test.tsx -->
In `pwa/test/child-reclaim-banner.test.tsx`, find:

````tsx
    expect(screen.getByRole('button', { name: 'Resume reclaim' })).toHaveClass('child-reclaim-toggle');
````

Replace with:

````tsx
    expect(screen.getByRole('button', { name: 'Resume cleanup' })).toHaveClass('child-reclaim-toggle');
````

<!-- replay: replace pwa/test/child-reclaim-banner.test.tsx -->
In `pwa/test/child-reclaim-banner.test.tsx`, find:

````tsx
    expect(CHILD_RECLAIM_MARKER_WORD.unmeasurable).toBe('reclaim switch unreadable');
````

Replace with:

````tsx
    expect(CHILD_RECLAIM_MARKER_WORD.unmeasurable).toBe('cleanup switch unreadable');
````

<!-- replay: replace pwa/test/child-reclaim-banner.test.tsx -->
In `pwa/test/child-reclaim-banner.test.tsx`, find:

````tsx
    expect(CHILD_RECLAIM_MARKER_WORD.clear).toBe('reclaim not paused');
````

Replace with:

````tsx
    expect(CHILD_RECLAIM_MARKER_WORD.clear).toBe('cleanup not paused');
````

<!-- replay: replace pwa/test/child-reclaim-banner.test.tsx -->
In `pwa/test/child-reclaim-banner.test.tsx`, find:

````tsx
    fireEvent.click(screen.getByRole('button', { name: 'Pause reclaim' }));
````

Replace with:

````tsx
    fireEvent.click(screen.getByRole('button', { name: 'Pause cleanup' }));
````

<!-- replay: replace pwa/test/child-reclaim-banner.test.tsx -->
In `pwa/test/child-reclaim-banner.test.tsx`, find:

````tsx
    const childReclaimPause = vi.fn(() => new Promise<void>(() => {}));
    render(<ChildReclaimBanner store={store} childReclaimPause={childReclaimPause} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume reclaim' }));
    expect(childReclaimPause).toHaveBeenCalledWith('off');
  });
````

Replace with:

````tsx
    const childReclaimPause = vi.fn(() => new Promise<void>(() => {}));
    render(<ChildReclaimBanner store={store} childReclaimPause={childReclaimPause} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume cleanup' }));
    expect(childReclaimPause).toHaveBeenCalledWith('off');
  });
````

<!-- replay: replace pwa/test/child-reclaim-banner.test.tsx -->
In `pwa/test/child-reclaim-banner.test.tsx`, find:

````tsx
    fireEvent.click(screen.getByRole('button', { name: 'Resume reclaim' }));
````

Replace with:

````tsx
    fireEvent.click(screen.getByRole('button', { name: 'Resume cleanup' }));
````

<!-- replay: replace pwa/test/child-reclaim-banner.test.tsx -->
In `pwa/test/child-reclaim-banner.test.tsx`, find:

````tsx
    expect(await screen.findByText('Resume reclaim')).toBeInTheDocument();
````

Replace with:

````tsx
    expect(await screen.findByText('Resume cleanup')).toBeInTheDocument();
````

<!-- replay: replace pwa/test/child-reclaim-banner.test.tsx -->
In `pwa/test/child-reclaim-banner.test.tsx`, find:

````tsx
    expect(childReclaimAttentionOf({ childReclaimAttention: [bare] })).toEqual([bare]);
  });
});
````

Replace with:

````tsx
    expect(childReclaimAttentionOf({ childReclaimAttention: [bare] })).toEqual([bare]);
  });
});

// WORKSPACE LIFECYCLE WAVE 3b (spec 2026-09-24 §5.3, §6 item 1): `reclaim-paused` is the fleet's ONE cleanup switch —
// it stops child reclamation AND the expiry of archived workspaces — so the row's words name the cleanup, not the
// children alone, and the expiry lane's own list renders in the same row, under the children's, from its own field.
describe('the one cleanup switch (wave 3b)', () => {
  it('its words name the cleanup — set, clear and unreadable alike', () => {
    expect(CHILD_RECLAIM_MARKER_WORD).toEqual({
      clear: 'cleanup not paused', set: 'cleanup paused', unmeasurable: 'cleanup switch unreadable' });
    const store = makeStore();
    seen(store, coord({ reclaim: 'clear' }));
    render(<ChildReclaimBanner store={store} />);
    expect(screen.getByRole('button', { name: 'Pause cleanup' })).toBeInTheDocument();
  });

  it('lists the archived workspaces the expiry lane reports, under the children, each with the server’s sentence', () => {
    const store = makeStore();
    seen(store, { ...coord({ childReclaimAttention: [item()] }), expiryAttention: [
      { sessionId: 'ccrc-pwa-brisk-mesa', kind: 'in-use', archivedAt: 1, expiresAt: 2, at: 3,
        sentence: 'kept: process 3453108 (“tmux: server”) in /w/brisk-mesa has its working directory in this archived workspace' },
      { sessionId: 'ccrc-pwa-old-dune', kind: 'would-expire', archivedAt: 1, expiresAt: 2, at: 4,
        sentence: 'would be cleaned up now: the cleanup is not armed (shadow), so nothing was deleted.' },
    ] });
    render(<ChildReclaimBanner store={store} />);
    const list = screen.getByRole('list', { name: 'archived workspaces the cleanup is reporting' });
    expect(list.textContent).toContain(`${EXPIRY_KIND_WORD['in-use']} · ccrc-pwa-brisk-mesa`);
    expect(list.textContent).toContain('process 3453108 (“tmux: server”)');
    expect(list.textContent).toContain(`${EXPIRY_KIND_WORD['would-expire']} · ccrc-pwa-old-dune`);
    expect(list.querySelectorAll('button, a'), 'a report, never a tap').toHaveLength(0);
    // The children's list is its own, and holds no expiry.
    const children = screen.getByRole('list', { name: 'children reclamation could not clean up' });
    expect(children.textContent).not.toContain('brisk-mesa');
  });

  it('the one reader: an absent field reads as no items, a malformed member is dropped alone, an unknown kind is "reported"', () => {
    expect(expiryAttentionOf(coord())).toEqual([]);
    expect(expiryAttentionOf({ expiryAttention: [{ sessionId: 'a', kind: 'held', sentence: 's' }, { sessionId: 7 }] }))
      .toEqual([{ sessionId: 'a', kind: 'held', sentence: 's' }]);
    const store = makeStore();
    seen(store, { ...coord(), expiryAttention: [{ sessionId: 'x', kind: 'newer-kind', sentence: 's' }] });
    render(<ChildReclaimBanner store={store} />);
    expect(screen.getByRole('list', { name: 'archived workspaces the cleanup is reporting' }).textContent).toContain('reported · x');
  });

  it('renders no expiry list when there is nothing to report', () => {
    const store = makeStore();
    seen(store, { ...coord(), expiryAttention: [] });
    render(<ChildReclaimBanner store={store} />);
    expect(screen.queryByRole('list', { name: 'archived workspaces the cleanup is reporting' })).toBeNull();
  });
});
````

<!-- replay: replace server/test/coordinator-skill.test.ts -->
In `server/test/coordinator-skill.test.ts`, find:

````ts
  'This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for any reason. A child this session dispatched is reclaimed by the server once this session is finished with it — at its run’s close when nothing still needs it, otherwise later by the server’s sweep (a child held for its program’s next wave once that program has no open run, a review child once the run it reviewed has closed, a child whose reclaim was deferred or never started); this session’s own workspace is cleaned up by a human, never by a sweep.',
````

Replace with:

````ts
  'This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for any reason. A child this session dispatched is reclaimed by the server once this session is finished with it — at its run’s close when nothing still needs it, otherwise later by the server’s sweep (a child held for its program’s next wave once that program has no open run, a review child once the run it reviewed has closed, a child whose reclaim was deferred or never started); this session’s own workspace is cleaned up by a human, or by the server seven days after it is archived.',
````

<!-- replay: replace server/test/coordinator-skill.test.ts -->
In `server/test/coordinator-skill.test.ts`, find:

````ts
    expect(s6).toContain('it stays until a human cleans it up');
````

Replace with:

````ts
    expect(s6).toContain('it stays until a human cleans it up');
    // Workspace lifecycle wave 3b: an ARCHIVED workspace is the server's to clean up seven days after its archive.
    expect(s6).toContain('or, once it is archived, until the server cleans it up seven days after its archive');
````

<!-- replay: create server/test/expiry-lane-prose.test.ts -->
Create `server/test/expiry-lane-prose.test.ts`:

````ts
// The texts that move with the expiry lane (workspace lifecycle spec 2026-09-24 §5.3 "The contracts that move", §6
// item 1; wave 3b). They land in the SAME commit as the lane's live arm or after it, never before, so no text claims
// a cleanup that does not run (the coordinator's ruling (F)). Each is pinned by what it must SAY, so a later edit
// that drops the claim reds here rather than leaving the docs behind the code.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const read = (p: string): string => readFileSync(path.join(root, p), 'utf8');
/** Whitespace folded, so a re-wrapped paragraph still matches. */
const flat = (p: string): string => read(p).replace(/\s+/g, ' ');

describe('README: what happens to an archived workspace now', () => {
  const readme = flat('README.md');
  it('says it is cleaned up seven days after its archive, shadowed until the operator arms it, under the one switch', () => {
    const at = readme.indexOf('**Archived workspaces are cleaned up after seven days**');
    expect(at, 'the paragraph is gone').toBeGreaterThan(-1);
    const para = readme.slice(at, at + 2600);
    expect(para).toContain('`$REG/expire-lane-live`');
    expect(para).toContain('would expire');
    expect(para).toContain('`$REG/reclaim-paused` is the fleet’s one cleanup switch');
    expect(para).toContain('never kills');
  });
  it('the coordinator’s own workspace: by a human, or by the server seven days after it is archived', () => {
    expect(readme).toContain('a coordinator\'s own workspace is still cleaned up by a human, or by the server seven days after it is archived');
  });
});

describe('the coordinator’s reference, §6', () => {
  it('a workspace this session coordinated from is cleaned up by a human, or seven days after its archive', () => {
    const s = flat('ccd/coordinator-skill/references/wave-lifecycle.md');
    expect(s).toContain('so its workspace is cleaned up by a human, or by the server seven days after it is archived');
  });
  it('no skill file names the lane’s live switch — a session told about the dial could arm a deletion', () => {
    const skills = ['ccd/coordinator-skill', 'ccd/worker-skill', 'ccd/reviewer-skill'];
    const files = skills.flatMap((d) => readdirSync(path.join(root, d), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.md')).map((f) => path.join(d, f)));
    expect(files.length, 'an empty corpus would pass vacuously').toBeGreaterThan(3);
    for (const f of files) expect(read(f), f).not.toContain('expire-lane-live');
  });
});

describe('the specs', () => {
  it('CCR-15 §5.8: the pause is the fleet’s one cleanup switch now — the expiry stops with it', () => {
    const s = flat('docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md');
    expect(s).not.toContain('Pausing stops reclamation fleet-wide and nothing else;');
    expect(s).toContain('Pausing stops reclamation fleet-wide, and — since workspace lifecycle wave 3b — the expiry of archived workspaces too');
  });
  it('the lifecycle design §5.3 records the shadowed lane, and §6 item 1 as amended', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    expect(s).toContain('**As wave 3b builds the lane**');
    expect(s).toContain('`$REG/expire-lane-live`');
    expect(s).toContain('Amended by this design’s wave 3b');
  });
});
````

- [ ] **Step 2: Run them — red.**

```bash
( cd pwa && ./node_modules/.bin/vitest run test/child-reclaim-banner.test.tsx --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/vitest run test/archive-sheet.test.tsx --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/expiry-lane-prose.test.ts --maxWorkers=1 )
```

Measured:
- `pwa/test/child-reclaim-banner.test.tsx`: `Test Files 1 failed (1)`, no tests — `Failed to resolve import "../src/fleet/expiryWords"`
- `pwa/test/archive-sheet.test.tsx`: `1 failed | 24 passed (25)` — × an idle workspace: its words, and Archive sends the plain call
- `server/test/coordinator-skill.test.ts`: `2 failed | 158 passed (160)` — × carries all sixteen clauses verbatim; × wave-lifecycle §6 says what a child is, when it is reclaimed, and what is not
- `server/test/expiry-lane-prose.test.ts`: `5 failed | 1 passed (6)` — the README paragraph, the coordinator's own workspace in README, wave-lifecycle §6, CCR-15 §5.8, the lifecycle spec; the skill corpus already names no `expire-lane-live` (green)

- [ ] **Step 3: Make them pass.**

<!-- replay: replace README.md -->
In `README.md`, find:

````markdown

**What a crossing costs.** Caps stay global: one row, whole box, no per-project
````

Replace with:

````markdown

**Archived workspaces are cleaned up after seven days** (workspace lifecycle spec §5.3). An archived workspace that no
open run names, as worker or as coordinator, that no open review still needs, that carries no child marker and no hold,
is cleaned up by the server seven days after its archive: `ccd ws-audit --session <id> --expire`, then `ccd ws-expire`
with that audit's token, which pins everything git knows under `refs/ccrc/attic/<id>/` (`ccd ws-attic --session <id>`
lists it), keeps the transcripts, records every dropped ignored or secret-shaped file and every clip, and removes the
unit, pane, worktree, branch, clips and registry row. The seven days are ccd's own `WS_EXPIRE_AFTER_S`: the audit's
document carries `expiresAt`, and the server never types the threshold. Restore, start, ensure, swap and Revive all
bring an archived workspace back before then, and a workspace archived again starts a new week. **The lane ships
shadowed**: until the operator touches `$REG/expire-lane-live` on the fleet box by hand (nothing in this tree writes
it), each due workspace is audited and recorded — a feed row and an entry in the cleanup row on `/runs` saying it
would expire, with what would be dropped — and `ws-expire` is never composed. Armed, at most one expiry runs per sweep
pass, fleet-wide. `$REG/reclaim-paused` is the fleet’s one cleanup switch: raised (the cleanup row's toggle on
`/runs`, or `ccd reclaim-pause --state on`), it stops child reclamation and this lane alike, shadow included. A
workspace someone is viewing is left alone for as long as they are; one a process is working in (a forgotten dev
server, a tmux or fsmonitor daemon) is refused `in-use` on every pass and, after a few, listed with the process's id,
its command and its path. The lane never kills: find out what the process is first — the fleet's own tmux server is
also a `tmux: server`. A workspace held past its seven days is listed, never touched.

**What a crossing costs.** Caps stay global: one row, whole box, no per-project
````

<!-- replay: replace README.md -->
In `README.md`, find:

````markdown
workspace is still cleaned up by a human. Before anything is deleted the
````

Replace with:

````markdown
workspace is still cleaned up by a human, or by the server seven days after it is archived. Before anything is deleted the
````

<!-- replay: replace ccd/coordinator-skill/SKILL.md -->
In `ccd/coordinator-skill/SKILL.md`, find:

````markdown
3. This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for any reason. A child this session dispatched is reclaimed by the server once this session is finished with it — at its run’s close when nothing still needs it, otherwise later by the server’s sweep (a child held for its program’s next wave once that program has no open run, a review child once the run it reviewed has closed, a child whose reclaim was deferred or never started); this session’s own workspace is cleaned up by a human, never by a sweep.
````

Replace with:

````markdown
3. This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for any reason. A child this session dispatched is reclaimed by the server once this session is finished with it — at its run’s close when nothing still needs it, otherwise later by the server’s sweep (a child held for its program’s next wave once that program has no open run, a review child once the run it reviewed has closed, a child whose reclaim was deferred or never started); this session’s own workspace is cleaned up by a human, or by the server seven days after it is archived.
````

<!-- replay: replace ccd/coordinator-skill/references/wave-lifecycle.md -->
In `ccd/coordinator-skill/references/wave-lifecycle.md`, find:

````markdown
coordinated a run, so its workspace is cleaned up by a human. No
````

Replace with:

````markdown
coordinated a run, so its workspace is cleaned up by a human, or by the server seven days after it is archived. No
````

<!-- replay: replace ccd/coordinator-skill/references/wave-lifecycle.md -->
In `ccd/coordinator-skill/references/wave-lifecycle.md`, find:

````markdown
stays until a human cleans it up.
````

Replace with:

````markdown
stays until a human cleans it up, or, once it is archived, until the server cleans it up seven days after its archive.
````

<!-- replay: replace docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md -->
In `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md`, find:

````markdown
Default: running. Pausing stops reclamation fleet-wide and nothing else; unpausing drains what queued.
````

Replace with:

````markdown
Default: running. Pausing stops reclamation fleet-wide, and — since workspace lifecycle wave 3b — the expiry of archived
workspaces too: it is the fleet's one cleanup switch (`2026-09-24-workspace-lifecycle-design.md` §5.3). Nothing else;
unpausing drains what queued.
````

<!-- replay: replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find:

````markdown

### 5.4 Stage 4 — the dead-coordinator lane (L4)
````

Replace with:

````markdown

**As wave 3b builds the lane** (amended with its plan, `docs/superpowers/plans/2026-10-06-workspace-lifecycle-wave3b-expiry-lane.md`;
each item is a departure named there).
- **The lane ships shadowed** (the coordinator's safety ruling, the scope sweep's precedent). Until `$REG/expire-lane-live`
  exists — touched by the operator by hand on the fleet box; nothing in the tree writes it — a due workspace is audited
  and recorded ("would expire", a feed row and an attention entry naming its archive, its expiry instant and how many
  secret-shaped files would be dropped), and `ws-expire` is never composed. `reclaim-paused` stops the lane entirely,
  shadow included. Armed, at most one `ws-expire` is composed per sweep pass, fleet-wide.
- **The threshold is ccd's.** `ws-audit --expire`'s document gains `expiresAt` (`archivedAt + WS_EXPIRE_AFTER_S`), on
  `expirable` and on `not-expired` alike, and `archivedAt` is set on `not-expired` too. The lane reads the instant through
  one reader, audits a row once per archive to learn it, and composes nothing for a document without the key (an older
  ccd). An `in-use` refusal's document also names each process: its pid, its command and its working directory.
- **A sibling pass, not a branch.** The lane runs beside `sweepChildReclaim` on the same tick, cadence and switch, with its
  own memory, verdict, executor, feed rows and attention list, so neither lane's early return silences the other.
- **A return clears the archive inside its gate** (3893's residual, closed before the lane composes the verb): `start`,
  `enable`, `ensure` and `swap` unarchive an archived row while they hold the reap lock, journaled `unarchive` under the
  verb's name, so an expiry that takes the lock next refuses `not-archived`. Holding the lock across the journal instead
  was measured and refused: a supervised start spawns its pane from the unit's own process, which would refuse against it.
- **A standing `in-use` is expected.** It is asked again every pass and, after a few, listed with the pid, its command
  and its path; the text never tells an operator to end a pid without naming what it is (the fleet's own tmux server is
  also a `tmux: server`). The lane never kills.

### 5.4 Stage 4 — the dead-coordinator lane (L4)
````

<!-- replay: replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find:

````markdown
  1. `reclaim-paused` "and nothing else" becomes the cleanup switch (§5.3).
````

Replace with:

````markdown
  1. `reclaim-paused` "and nothing else" becomes the cleanup switch (§5.3). Amended by this design’s wave 3b: CCR-15's
     §5.8 now says the pause stops the expiry of archived workspaces too.
````

<!-- replay: replace pwa/src/fleet/ArchiveSheet.tsx -->
In `pwa/src/fleet/ArchiveSheet.tsx`, find:

````tsx
        ? 'It goes offline and folds into Archived. Restore brings it back.'
````

Replace with:

````tsx
        ? 'It goes offline and folds into Archived. Restore brings it back for 7 days; after that it is cleaned up.'
````

<!-- replay: replace pwa/src/fleet/ChildReclaimBanner.tsx -->
In `pwa/src/fleet/ChildReclaimBanner.tsx`, find:

````tsx
import { inlinePauseError } from './CoordBanner';
````

Replace with:

````tsx
import { inlinePauseError } from './CoordBanner';
import { ExpiryAttention } from './ExpiryAttention';
````

<!-- replay: replace pwa/src/fleet/ChildReclaimBanner.tsx -->
In `pwa/src/fleet/ChildReclaimBanner.tsx`, find:

````tsx
    : marker === 'set' ? 'Resume reclaim' : 'Pause reclaim';
````

Replace with:

````tsx
    : marker === 'set' ? 'Resume cleanup' : 'Pause cleanup';
````

<!-- replay: replace pwa/src/fleet/ChildReclaimBanner.tsx -->
In `pwa/src/fleet/ChildReclaimBanner.tsx`, find:

````tsx
      )}
````

Replace with:

````tsx
      )}
      {/* Workspace lifecycle wave 3b: the expiry lane's own list, under the children's — the same switch stops both
          lanes, and the two lists stay two (child reclamation's run chip never reads this one). */}
      <ExpiryAttention coord={coord} />
````

<!-- replay: create pwa/src/fleet/ExpiryAttention.tsx -->
Create `pwa/src/fleet/ExpiryAttention.tsx`:

````tsx
// The expiry lane's attention list (workspace lifecycle spec 2026-09-24 §5.3, wave 3b), rendered INSIDE the cleanup
// row (`ChildReclaimBanner`), under the children's list and in its shape: a REPORT, never a tap — no button, no link,
// no remedy. Each line is the kind's word, the session, and the server's sentence; for a workspace a process keeps,
// that sentence names the pid, its command and the path, and says to find out what it is before ending it. Nothing
// renders when the list is empty or the server predates it.
import type { ReactNode } from 'react';
import { expiryAttentionOf, expiryKindWord } from './expiryWords';

export function ExpiryAttention({ coord }: { coord: unknown }): ReactNode {
  const list = expiryAttentionOf(coord);
  if (list.length === 0) return null;
  return (
    <ul className="child-reclaim-attention" aria-label="archived workspaces the cleanup is reporting">
      {list.map((a) => (
        <li key={a.sessionId} className="child-reclaim-item">
          <span className="child-reclaim-who">{`${expiryKindWord(a.kind)} · ${a.sessionId}`}</span>
          <span className="child-reclaim-sentence">{a.sentence}</span>
        </li>
      ))}
    </ul>
  );
}
````

<!-- replay: replace pwa/src/fleet/childReclaimWords.ts -->
In `pwa/src/fleet/childReclaimWords.ts`, find:

````ts
  clear: 'reclaim not paused',
  set: 'child reclaim paused',
  // Names no cause. Two producers reach this word: the server's own
  // `unmeasurable` (its registry did not list) and `childReclaimMarker`'s
  // degrade arm for a value this build does not recognise — where the
  // registry DID list and a newer server said something this row cannot read.
  unmeasurable: 'reclaim switch unreadable',
````

Replace with:

````ts
  // THE FLEET'S ONE CLEANUP SWITCH since workspace lifecycle wave 3b (that
  // design's §5.3 and §6 item 1): `reclaim-paused` stops child reclamation AND
  // the expiry of archived workspaces, so the words name the cleanup.
  clear: 'cleanup not paused',
  set: 'cleanup paused',
  // Names no cause. Two producers reach this word: the server's own
  // `unmeasurable` (its registry did not list) and `childReclaimMarker`'s
  // degrade arm for a value this build does not recognise — where the
  // registry DID list and a newer server said something this row cannot read.
  unmeasurable: 'cleanup switch unreadable',
````

<!-- replay: create pwa/src/fleet/expiryWords.ts -->
Create `pwa/src/fleet/expiryWords.ts`:

````ts
// The expiry lane's attention list (workspace lifecycle wave 3b) — its ONE reader, and the words for its kinds.
//
// ITS OWN FILE, not `childReclaimWords.ts`'s: the two lists ride one frame and render in one row (the fleet's one
// cleanup switch), but they are two populations with two vocabularies, and child reclamation's run chip must never
// see an expiry. The sentence is the SERVER's — the pid, the command and the path of a process that keeps a row among
// them — and the PWA renders it and maps nothing.
import type { ExpiryAttention } from '../../../shared/api';

/** What the row says before the server's sentence, by kind. A kind from a newer server reads as `reported`. */
export const EXPIRY_KIND_WORD: Readonly<Record<ExpiryAttention['kind'], string>> = {
  'would-expire': 'would clean up',
  held: 'held',
  'in-use': 'in use',
  refused: 'refused',
  failing: 'failing',
  'no-evidence': 'no evidence',
};

export const expiryKindWord = (kind: string): string =>
  Object.prototype.hasOwnProperty.call(EXPIRY_KIND_WORD, kind)
    ? EXPIRY_KIND_WORD[kind as ExpiryAttention['kind']] : 'reported';

/** Only the fields the row RENDERS, plus the shape sanity that tells a member from junk. */
type RenderedExpiry = Pick<ExpiryAttention, 'sessionId' | 'kind' | 'sentence'>;

const isExpiry = (a: unknown): a is RenderedExpiry => {
  if (typeof a !== 'object' || a === null) return false;
  const o = a as Record<string, unknown>;
  return typeof o.sessionId === 'string' && typeof o.kind === 'string' && typeof o.sentence === 'string';
};

/** THE ONE READER of `CoordStatus.expiryAttention`. An absent field (an older server) reads as no items, and a
 *  malformed member is dropped on its own rather than taking the list with it. */
export function expiryAttentionOf(coord: unknown): RenderedExpiry[] {
  if (typeof coord !== 'object' || coord === null) return [];
  const list = (coord as { expiryAttention?: unknown }).expiryAttention;
  return Array.isArray(list) ? list.filter(isExpiry) : [];
}
````

- [ ] **Step 4: Run — green**, and every PWA and prose suite the words reach.

```bash
( cd pwa && ./node_modules/.bin/vitest run test/child-reclaim-banner.test.tsx --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/vitest run test/archive-sheet.test.tsx --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/vitest run test/tap-targets.test.tsx --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/vitest run test/fleet-css.test.ts --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/tsc --noEmit -p . )
( cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/expiry-lane-prose.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/child-reclaim-prose.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ws-expire-prose.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/readme-holds.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
```

Measured: `child-reclaim-banner` `30 passed (30)`; `archive-sheet` `25 passed (25)`; `runs-screen` `104 passed (104)`; `tap-targets` `40 passed (40)`; `fleet-css` `80 passed (80)`; `contrast` `256 passed (256)`; `pwa tsc` rc 0; `coordinator-skill` `160 passed (160)`; `expiry-lane-prose` `6 passed (6)`; `child-reclaim-prose` `4 passed (4)` (its "a coordinator's own workspace is still cleaned up by a human" substring stands); `ws-expire-prose` `7 passed (7)`; `readme-holds` `17 passed (17)`; `topology-clean` `55 passed (55)`; the citation cases `5 passed | 330 skipped (335)` (measured: nothing README's new lines move is cited by line).

- [ ] **Step 5: Mutation check, then commit.**

| # | Edit (restore after) | Measured red |
|---|---|---|
| T8.1 | The expiry list never mounted. `ChildReclaimBanner.tsx`: `      <ExpiryAttention coord={coord} />` deleted | `pwa/test/child-reclaim-banner.test.tsx`: `2 failed \| 28 passed (30)` — lists the archived workspaces the expiry lane reports …; the one reader … an unknown kind is "reported" |
| T8.2 | The reader reads the CHILD list. `expiryWords.ts`: `(coord as { expiryAttention?: unknown }).expiryAttention` → `(coord as { childReclaimAttention?: unknown }).childReclaimAttention` | same file: `2 failed \| 28 passed (30)` — the same two |
| T8.3 | Clause 3's old ending back. `ccd/coordinator-skill/SKILL.md`: `…cleaned up by a human, or by the server seven days after it is archived.` → `…cleaned up by a human, never by a sweep.` | `server/test/coordinator-skill.test.ts`: `1 failed \| 159 passed (160)` — carries all sixteen clauses verbatim |
| T8.4 | README's switch sentence narrowed. `README.md`: `` `$REG/reclaim-paused` is the fleet’s one cleanup switch`` → `` `$REG/reclaim-paused` is the child reclamation switch`` | `server/test/expiry-lane-prose.test.ts`: `1 failed \| 5 passed (6)` — says it is cleaned up seven days after its archive, shadowed until the operator arms it, under the one switch |
| T8.5 | A newer kind rendered raw. `expiryWords.ts`: `: 'reported';` → `: kind;` | `pwa/test/child-reclaim-banner.test.tsx`: `1 failed \| 29 passed (30)` — the one reader: … an unknown kind is "reported" |
| T8.6 | The switch's old word. `childReclaimWords.ts`: `  set: 'cleanup paused',` → `  set: 'child reclaim paused',` | `pwa/test/child-reclaim-banner.test.tsx`: `1 failed \| 29 passed (30)` — its words name the cleanup — set, clear and unreadable alike |

```bash
git add pwa/test/child-reclaim-banner.test.tsx pwa/test/archive-sheet.test.tsx server/test/coordinator-skill.test.ts \
  server/test/expiry-lane-prose.test.ts pwa/src/fleet/expiryWords.ts pwa/src/fleet/ExpiryAttention.tsx \
  pwa/src/fleet/ChildReclaimBanner.tsx pwa/src/fleet/childReclaimWords.ts pwa/src/fleet/ArchiveSheet.tsx \
  ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/wave-lifecycle.md README.md \
  docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md
git commit -m "$(cat <<'MSG'
feat(expire): reclaim-paused is the one cleanup switch; the words that move with the lane

The cleanup row says cleanup, lists the expiry lane's reports under the
children's, and the archive confirm says what happens after seven days.
Coordinator clause 3 (verbatim pin), wave-lifecycle §6, README, CCR-15 §5.8
(spec §6 item 1) and the lifecycle spec's §5.3 (the shadowed lane) move with
the lane's live arm, never before it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: The archive door's carried follow-ups — the store's detail, 503 for an unlistable registry, `already archived` over a live pane

**Model routing:** `sonnet`, effort `high` — three small route changes, each with its replayed assertions; review 240's F1 and the ledger's Carried constraints are the specification.

**Files:** tests `server/test/archive-door-decide.test.ts`, `server/test/archive-door.test.ts`, `server/test/routes.test.ts`; source `server/src/coord/archiveDoor.ts`, `server/src/server.ts` (the archive route; one import).

**Interfaces:**
- Changes: `decideArchive`'s two fail-shut refusals (`run-open` and `coordinator-has-open-runs` on a store it could not read, thrown or `ok:false`) carry the store's own `detail` beside `runs: []` (additive; the departure `archive-door-refusal-carries-the-store-detail`), and the route logs it (`console.warn('ccrc-server: archive <id>: the coordination store could not be read (<detail>) — refused fail-shut')`).
- Changes: `POST /api/sessions/:id/archive` lists the registry before `knownId`: a registry that does not LIST answers `503 registry-unmeasurable`, never `404 unknown-session` (the departure `archive-door-unlistable-registry-is-503`). `knownId`'s own call is untouched, so `routes.test.ts`'s derived census of request-id gates does not move.
- Changes: when `ws-archive` answers `already archived <id>` at exit 0 with nothing stopped, and tmux PROVES the pane up, the door stops it with the argv `/stop` builds, under the turn it already measured, and answers `stopped: true` (the departure `archive-door-stops-an-already-archived-live-pane`). A pane gone, or one tmux cannot be asked about, answers as before.

- [ ] **Step 1: Write the failing tests.** Seven replayed assertions gain `detail`; four new route cases.

<!-- replay: replace server/test/archive-door-decide.test.ts -->
In `server/test/archive-door-decide.test.ts`, find:

````ts
    expect(await decideArchive(port({ worker: UNREADABLE }).p, 'demo-a', NONE, IDLE_WS))
      .toEqual({ ok: false, reply: { status: 409, body: { ok: false, error: 'run-open', runs: [] } } });
````

Replace with:

````ts
    expect(await decideArchive(port({ worker: UNREADABLE }).p, 'demo-a', NONE, IDLE_WS))
      .toEqual({ ok: false, reply: { status: 409, body: { ok: false, error: 'run-open', runs: [], detail: 'runs.wave' } } });
````

<!-- replay: replace server/test/archive-door-decide.test.ts -->
In `server/test/archive-door-decide.test.ts`, find:

````ts
    expect(await decideArchive(p, 'demo-c', { ...NONE, programmeEnd: true }, IDLE_WS)).toEqual({ ok: false,
      reply: { status: 409, body: { ok: false, error: 'coordinator-has-open-runs', runs: [] } } });
````

Replace with:

````ts
    expect(await decideArchive(p, 'demo-c', { ...NONE, programmeEnd: true }, IDLE_WS)).toEqual({ ok: false,
      reply: { status: 409, body: { ok: false, error: 'coordinator-has-open-runs', runs: [], detail: 'runs.wave' } } });
````

<!-- replay: replace server/test/archive-door-decide.test.ts -->
In `server/test/archive-door-decide.test.ts`, find:

````ts
      .toEqual({ ok: false, reply: { status: 409, body: { ok: false, error: 'run-open', runs: [] } } });
    const { p, seen } = port({ throws: { claimed: true } });
    expect(await decideArchive(p, 'demo-c', { ...NONE, force: true, programmeEnd: true }, IDLE_WS)).toEqual({ ok: false,
      reply: { status: 409, body: { ok: false, error: 'coordinator-has-open-runs', runs: [] } } });
````

Replace with:

````ts
      .toEqual({ ok: false, reply: { status: 409, body: { ok: false, error: 'run-open', runs: [], detail: 'database is not open' } } });
    const { p, seen } = port({ throws: { claimed: true } });
    expect(await decideArchive(p, 'demo-c', { ...NONE, force: true, programmeEnd: true }, IDLE_WS)).toEqual({ ok: false,
      reply: { status: 409, body: { ok: false, error: 'coordinator-has-open-runs', runs: [], detail: 'database is not open' } } });
````

<!-- replay: replace server/test/archive-door.test.ts -->
In `server/test/archive-door.test.ts`, find:

````ts
import { describe, it, expect, afterEach } from 'vitest';
````

Replace with:

````ts
import { describe, it, expect, afterEach, vi } from 'vitest';
````

<!-- replay: replace server/test/archive-door.test.ts -->
In `server/test/archive-door.test.ts`, find:

````ts
  ccd?: Record<string, { code: number; stderr: string }>;
````

Replace with:

````ts
  ccd?: Record<string, { code: number; stderr: string; stdout?: string }>;
````

<!-- replay: replace server/test/archive-door.test.ts -->
In `server/test/archive-door.test.ts`, find:

````ts
    return scripted ? { code: scripted.code, stdout: '', stderr: scripted.stderr } : { code: 0, stdout: '', stderr: '' };
````

Replace with:

````ts
    return scripted ? { code: scripted.code, stdout: scripted.stdout ?? '', stderr: scripted.stderr } : { code: 0, stdout: '', stderr: '' };
````

<!-- replay: replace server/test/archive-door.test.ts -->
In `server/test/archive-door.test.ts`, find:

````ts
    for (const body of [undefined, { programme: 'end' }]) {
      expect((await post(b.app, COORDINATOR, body)).json())
        .toEqual({ ok: false, error: 'coordinator-has-open-runs', runs: [] });
    }
````

Replace with:

````ts
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const body of [undefined, { programme: 'end' }]) {
      // Wave 3b (the carried follow-up, D-2545's base behaviour): the refusal carries the store's own detail, and the
      // server logs it — it used to drop both.
      expect((await post(b.app, COORDINATOR, body)).json())
        .toEqual({ ok: false, error: 'coordinator-has-open-runs', runs: [], detail: expect.stringMatching(/\S/) });
    }
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('could not be read'))).toHaveLength(2);
    warn.mockRestore();
````

<!-- replay: replace server/test/archive-door.test.ts -->
In `server/test/archive-door.test.ts`, find:

````ts
    expect(plain.json()).toEqual({ ok: false, error: 'run-open', runs: [] });
    const forced = await post(b.app, COORDINATOR, { force: true, programme: 'end' });
    expect(forced.statusCode).toBe(409);
    expect(forced.json()).toEqual({ ok: false, error: 'coordinator-has-open-runs', runs: [] });
````

Replace with:

````ts
    expect(plain.json()).toEqual({ ok: false, error: 'run-open', runs: [], detail: 'database is not open' });
    const forced = await post(b.app, COORDINATOR, { force: true, programme: 'end' });
    expect(forced.statusCode).toBe(409);
    expect(forced.json()).toEqual({ ok: false, error: 'coordinator-has-open-runs', runs: [], detail: 'database is not open' });
````

<!-- replay: replace server/test/archive-door.test.ts -->
In `server/test/archive-door.test.ts`, find:

````ts
    expect((await post(b.app, 'claude-a-demo')).json()).toMatchObject({ archived: true, stopped: true });
  });
});
````

Replace with:

````ts
    expect((await post(b.app, 'claude-a-demo')).json()).toMatchObject({ archived: true, stopped: true });
  });
});

// WORKSPACE LIFECYCLE WAVE 3b — wave 2's carried follow-ups (review 240), taken now that the archive's end of life is
// real: the base's 404 fold for a registry that did not list, and `ws-archive`'s `already archived` read as success
// without checking that the measured-live pane was stopped.
describe('the archive door, wave 3b', () => {
  it('a registry that cannot be LISTED is 503 registry-unmeasurable — never folded into 404 unknown-session', async () => {
    const b = await box();
    seed(b.home, 'demo-amber');
    rmSync(path.join(b.home, '.cc-sessions'), { recursive: true, force: true });
    const res = await post(b.app, 'demo-amber');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'registry-unmeasurable' });
    expect(b.ccd()).toEqual([]);
  });

  it('the CONTROL: a registry that lists and does not name the id is still 404 unknown-session', async () => {
    const b = await box();
    const res = await post(b.app, 'demo-nobody');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'unknown-session' });
  });

  it('`already archived` with a pane tmux proves UP: the door stops it, as the archive would have, and says so', async () => {
    const b = await box({ ccd: { 'ws-archive': { code: 0, stderr: '', stdout: 'already archived demo-amber\n' } } });
    seed(b.home, 'demo-amber');
    liveStatus(b.home, 'idle');
    const res = await post(b.app, 'demo-amber');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, archived: true, stopped: true, ended: [] });
    expect(b.ccd().map((c) => c[0])).toEqual(['ws-archive', 'stop']);
  });

  it('`already archived` with the pane GONE: archived, nothing stopped — as before', async () => {
    const b = await box({ alive: false, ccd: { 'ws-archive': { code: 0, stderr: '', stdout: 'already archived demo-amber\n' } } });
    seed(b.home, 'demo-amber');
    const res = await post(b.app, 'demo-amber');
    expect(res.json()).toEqual({ ok: true, archived: true, stopped: false, ended: [] });
    expect(b.ccd().map((c) => c[0])).toEqual(['ws-archive']);
  });
});
````

<!-- replay: replace server/test/routes.test.ts -->
In `server/test/routes.test.ts`, find:

````ts
    // empty, because no row was read. Fail-shut at a destructive act.
    expect(res.json()).toEqual({ ok: false, error: 'run-open', runs: [] });
````

Replace with:

````ts
    // empty, because no row was read. Fail-shut at a destructive act. And the
    // store's own words ride it (workspace lifecycle wave 3b).
    expect(res.json()).toEqual({ ok: false, error: 'run-open', runs: [], detail: expect.stringMatching(/\S/) });
````

- [ ] **Step 2: Run them — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archive-door-decide.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archive-door.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/routes.test.ts --maxWorkers=1 )
```

Measured:
- `archive-door-decide`: `3 failed | 54 passed (57)` — × refuses `run-open` … with EMPTY runs when they could not be read …; × an unreadable store refuses fail-shut …; × a store read that THROWS is an unreadable store …
- `archive-door`: `4 failed | 51 passed (55)` — × an unreadable store refuses fail-shut with `runs: []`, programme or not; × a store that THROWS …; × a registry that cannot be LISTED is 503 registry-unmeasurable …; × `already archived` with a pane tmux proves UP …
- `routes`: `1 failed | 79 passed (80)` — × refuses 409 run-open with an EMPTY runs array when the sibling rows are UNREADABLE …

- [ ] **Step 3: Make them pass.**

<!-- replay: replace server/src/coord/archiveDoor.ts -->
In `server/src/coord/archiveDoor.ts`, find:

````ts
      // D-2545: refused as CLAIMED with an EMPTY `runs` — the field's shape does not change with the condition.
      if (!worker.ok) return refuse(409, ARCHIVE_REFUSALS.runOpen, { runs: [] });
      if (worker.siblings.length > 0) return refuse(409, ARCHIVE_REFUSALS.runOpen, { runs: worker.siblings });
    }
    const coordinates = measured(() => port.openRunsClaimedBy(id));
    // Fail-shut, with or without `programme:'end'`: a programme this box cannot enumerate cannot be ended.
    if (!coordinates.ok) return refuse(409, ARCHIVE_REFUSALS.coordinatorHasOpenRuns, { runs: [] });
````

Replace with:

````ts
      // D-2545: refused as CLAIMED with an EMPTY `runs` — the field's shape does not change with the condition — and
      // the store's own `detail`, which this answer used to drop (workspace lifecycle wave 3b, the carried follow-up).
      if (!worker.ok) return refuse(409, ARCHIVE_REFUSALS.runOpen, { runs: [], detail: worker.detail });
      if (worker.siblings.length > 0) return refuse(409, ARCHIVE_REFUSALS.runOpen, { runs: worker.siblings });
    }
    const coordinates = measured(() => port.openRunsClaimedBy(id));
    // Fail-shut, with or without `programme:'end'`: a programme this box cannot enumerate cannot be ended.
    if (!coordinates.ok) return refuse(409, ARCHIVE_REFUSALS.coordinatorHasOpenRuns, { runs: [], detail: coordinates.detail });
````

<!-- replay: replace server/src/server.ts -->
In `server/src/server.ts`, find:

````ts
import { archiveInterrupts } from '../../shared/api.js';
````

Replace with:

````ts
import { ARCHIVE_REFUSALS, archiveInterrupts } from '../../shared/api.js';
````

<!-- replay: replace server/src/server.ts -->
In `server/src/server.ts`, find:

````ts
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const flags = archiveFlags(req.body);
    if (flags === null) return reply.code(400).send({ ok: false, error: 'bad-request' });
    // The row itself, `/stop`'s ladder. An unlistable registry has already answered 404 `unknown-session` through
    // `knownId` above, exactly as before this wave; the `unlistable` arm below can only answer if the registry goes
    // unreadable between the two reads (503). The identity fields are a separate arm: an unmeasured one is refused
    // rather than guessed at — the stop argv recomputes a tmux name from them.
````

Replace with:

````ts
    // A registry that did not LIST is `503 registry-unmeasurable` — never folded into `404 unknown-session`, which is
    // what `knownId` alone answers for it (workspace lifecycle wave 3b, wave 2's carried follow-up). Asked BEFORE
    // `knownId`, whose call is left as every other request-id gate's (`routes.test.ts` derives that census).
    if ((await deps.io.readdir(deps.cfg.registryDir)) === null) {
      return reply.code(503).send({ ok: false, error: 'registry-unmeasurable' });
    }
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const flags = archiveFlags(req.body);
    if (flags === null) return reply.code(400).send({ ok: false, error: 'bad-request' });
    // The row itself, `/stop`'s ladder. An unlistable registry has already answered 503 above; the `unlistable` arm
    // below can only answer if the registry goes unreadable between the two reads (503 too). The identity fields are a
    // separate arm: an unmeasured one is refused rather than guessed at — the stop argv recomputes a tmux name from them.
````

<!-- replay: replace server/src/server.ts -->
In `server/src/server.ts`, find:

````ts
    if (!plan.ok) return reply.code(plan.reply.status).send(plan.reply.body);
````

Replace with:

````ts
    if (!plan.ok) {
      // A store this box could not read refuses fail-shut WITH its detail, and the server says so in its log
      // (workspace lifecycle wave 3b: the base dropped both).
      const { error, detail } = plan.reply.body;
      if (typeof detail === 'string'
          && (error === ARCHIVE_REFUSALS.runOpen || error === ARCHIVE_REFUSALS.coordinatorHasOpenRuns)) {
        console.warn(`ccrc-server: archive ${id}: the coordination store could not be read (${detail}) — refused fail-shut`);
      }
      return reply.code(plan.reply.status).send(plan.reply.body);
    }
````

<!-- replay: replace server/src/server.ts -->
In `server/src/server.ts`, find:

````ts
    const out = archiveOutcome(stopped, plan.ended, await deps.runCcd(archiveArgv));
````

Replace with:

````ts
    const archived = await deps.runCcd(archiveArgv);
    // REVIEW 240's F1 (workspace lifecycle wave 3b): `ws-archive` answers `already archived <id>` at exit 0 having
    // stopped NOTHING — a row archived earlier whose pane came back without a spawn path clearing the stamp (a pre-#143
    // pane). Read as `archived:true` alone, the door said a session was put away that tmux still runs. A pane tmux
    // PROVES up is stopped here, as the archive's own act would have — under the turn the door already measured (idle,
    // or `interrupt`); a pane gone, or one tmux cannot be asked about, is left as before.
    if (archived.ok && !stopped && /^already archived /m.test(archived.stdout)
        && (await deps.tmux.sessionVerdict(id)).verdict === 'live') {
      const res = await deps.runCcd(stopArgvFor(id, rec, identity));
      if (!res.ok) return reply.code(502).send({ ok: false, stderr: res.stderr, ...endedSpread });
      stopped = true;
    }
    const out = archiveOutcome(stopped, plan.ended, archived);
````

- [ ] **Step 4: Run — green.**

```bash
( cd server && ./node_modules/.bin/vitest run test/archive-door-decide.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archive-door.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/routes.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/tsc --noEmit -p . )
```

Measured: `archive-door-decide` `57 passed (57)`; `archive-door` `55 passed (55)`; `routes` `80 passed (80)`; `single-definition` `275 passed (275)` (the route compares `ARCHIVE_REFUSALS.<name>`, never a literal); `tsc` rc 0.

- [ ] **Step 5: Mutation check, then commit.**

| # | Edit (restore after) | Measured red |
|---|---|---|
| T9.1 | The detail dropped. `archiveDoor.ts`: `{ runs: [], detail: worker.detail }` → `{ runs: [] }` | `archive-door-decide`: `2 failed \| 55 passed (57)` — refuses `run-open` …; a store read that THROWS … |
| T9.2 | The 404 fold back. `server.ts`: `if ((await deps.io.readdir(deps.cfg.registryDir)) === null) {` → `if (false) {` | `archive-door`: `1 failed \| 54 passed (55)` — a registry that cannot be LISTED is 503 registry-unmeasurable … |
| T9.3 | `already archived` read as success alone. `server.ts`: `if (archived.ok && !stopped && /^already archived /m.test(archived.stdout)` → `if (false && archived.ok && …` | `archive-door`: `1 failed \| 54 passed (55)` — `already archived` with a pane tmux proves UP … |
| T9.4 | The log line gone. `server.ts`: the `console.warn(…the coordination store could not be read…)` line deleted | `archive-door`: `1 failed \| 54 passed (55)` — an unreadable store refuses fail-shut with `runs: []`, programme or not |
| T9.5 | A pane tmux could NOT ask about stopped too. `server.ts`: `.verdict === 'live') {` → `.verdict !== 'unknown') {` | `archive-door`: `1 failed \| 54 passed (55)` — `already archived` with the pane GONE: archived, nothing stopped — as before |

```bash
git add server/test/archive-door-decide.test.ts server/test/archive-door.test.ts server/test/routes.test.ts \
  server/src/coord/archiveDoor.ts server/src/server.ts
git commit -m "$(cat <<'MSG'
fix(archive): the door's carried follow-ups — store detail, 503, already archived

The fail-shut run-open/coordinator-has-open-runs refusals carry the store's
detail and the server logs it; an unlistable registry is 503
registry-unmeasurable, not 404; an `already archived` answer over a pane tmux
proves up stops it, as the archive's own act would have (review 240 F1).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: FM7 — the Released and Archived folds never share a row, by the PWA's own predicates

**Model routing:** `sonnet`, effort `medium` — one predicate.

**Files:** test `pwa/test/groupFleet.test.ts`; source `pwa/src/fleet/groupFleet.ts` (`inReleasedFold`).

**Interfaces:** `inReleasedFold(s)` excludes `inArchivedFold(s)` — the ONE predicate the Archived fold reads — where it excluded the `archived` bucket by hand; a stopped main checkout the wire calls released is now in Archived alone. Nothing else moves: an archived workspace was already excluded both ways.

- [ ] **Step 1: Write the failing test.**

<!-- replay: replace pwa/test/groupFleet.test.ts -->
In `pwa/test/groupFleet.test.ts`, find:

````ts
import { groupFleet, releasedByProgramme } from '../src/fleet/groupFleet';
````

Replace with:

````ts
import { groupFleet, inReleasedFold, releasedByProgramme } from '../src/fleet/groupFleet';
````

<!-- replay: replace pwa/test/groupFleet.test.ts -->
In `pwa/test/groupFleet.test.ts`, find:

````ts

  it('a stopped main checkout placed on another card is not "where its work went" — that list is live rows only', () => {
````

Replace with:

````ts

  // FM7 (workspace lifecycle wave 3b, the carried follow-up): the two folds are disjoint BY THE PWA'S OWN PREDICATES,
  // not only because the server leaves `releasedFrom` null on an archived row. A row the wire marks released that is
  // ALSO in the Archived fold — a stopped main checkout, whose bucket is `dead`, not `archived` — sits in Archived
  // alone: `inReleasedFold` excludes `inArchivedFold`, the one predicate, never the bucket by hand.
  it('a stopped main checkout the wire calls released is in Archived alone — the folds never share a row (FM7)', () => {
    const released = { runId: 4, program: 'lifecycle', programTitle: null, claimedBy: 'demo-c', closedAt: 9, child: false };
    const row = main('claude2-demo', { stoppedBy: STOP(5), releasedFrom: released });
    expect(inReleasedFold(row)).toBe(false);
    const [g] = groupFleet([row], []);
    expect(g!.archived.map((x) => x.id)).toEqual(['claude2-demo']);
    expect(g!.released).toEqual([]);
  });

  it('a stopped main checkout placed on another card is not "where its work went" — that list is live rows only', () => {
````

- [ ] **Step 2: Run it — red.** `( cd pwa && ./node_modules/.bin/vitest run test/groupFleet.test.ts --maxWorkers=1 )` — measured `1 failed | 65 passed (66)` — × a stopped main checkout the wire calls released is in Archived alone — the folds never share a row (FM7).

- [ ] **Step 3: Make it pass.**

<!-- replay: replace pwa/src/fleet/groupFleet.ts -->
In `pwa/src/fleet/groupFleet.ts`, find:

````ts
 * marker the row still carries is the operator's to see. `archived` is excluded here too, though `releasedFrom`
 * already is null for an archived row: the two folds must never share a row.
 */
export function inReleasedFold(s: FleetSession): boolean {
  return releasedFromOf(s) !== null && s.bucket !== 'archived' && s.bucket !== 'attention'
````

Replace with:

````ts
 * marker the row still carries is the operator's to see. A row in the ARCHIVED fold is excluded too — by
 * `inArchivedFold`, the one predicate that fold reads, so a stopped main checkout is covered as well as an archived
 * workspace — though `releasedFrom` is already null for an archived row on the server: the two folds must never
 * share a row, and the PWA no longer leans on the server alone for it (FM7, workspace lifecycle wave 3b).
 */
export function inReleasedFold(s: FleetSession): boolean {
  return releasedFromOf(s) !== null && !inArchivedFold(s) && s.bucket !== 'attention'
````

- [ ] **Step 4: Run — green.**

```bash
( cd pwa && ./node_modules/.bin/vitest run test/groupFleet.test.ts --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/vitest run test/project-card.test.tsx --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/vitest run test/fleet-screen.test.tsx --maxWorkers=1 )
```

Measured: `groupFleet` `66 passed (66)`; `project-card` `107 passed (107)`; `fleet-screen` `98 passed (98)`.

- [ ] **Step 5: Mutation, then commit.** T10.1 — `!inArchivedFold(s)` → `s.bucket !== 'archived'` (the old spelling): `groupFleet` `1 failed | 65 passed (66)`, the FM7 case.

```bash
git add pwa/test/groupFleet.test.ts pwa/src/fleet/groupFleet.ts
git commit -m "$(cat <<'MSG'
fix(board): FM7 — inReleasedFold excludes inArchivedFold, not the archived bucket

The two folds no longer lean on the server alone to stay disjoint: a stopped
main checkout the wire calls released sits in Archived only.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 11: ws-reap never takes its fresh arm over an unreadable breadcrumb; ws-gc's advice is true

**Model routing:** `sonnet`, effort `high` — two ccd behaviours above the frozen anchor, line-neutral.

**Files:** tests `server/test/ccd-ws-expire-verb.test.ts` (the flavour fork's describe), `server/test/ccd-ws-gc.test.ts` (the archived-and-reaping describe); source `ccd/ccd` (`_ws_reap_locked`'s first line; `_ws_reap_crumb_unread` in ws-reap's MIRROR block; ws-gc's `archived)` and `reaping)` arms).

**Interfaces:**
- Changes: `ws-reap` on an ARCHIVED row whose `.reaping` stands but reads as nothing refuses `{"refused":"reaping-phase-unknown",…}` (ws-reap's existing word for a breadcrumb it cannot place; `SENTENCES` already has it) before it reads anything else — never its fresh arm (the departure `ws-reap-refuses-an-unreadable-breadcrumb-on-an-archived-row`). A row that is not archived is not asked: ws-reap's own `not-archived` answers it. The helper lives in the MIRROR block, which `ccd-wsaudit-nonpoison.test.ts` cuts out and which is outside the EXPIRE region the expiry's nineteen-word harvest reads (measured: placed in the EXPIRE region it made that harvest twenty).
- Changes: ws-gc's two declines, line for line: an archived workspace "is archived — never ws-gc's: Restore brings it back, and the server cleans it up seven days after its archive"; a breadcrumb "is mid-cleanup (breadcrumb: …) — the verb that left it finishes it: ccd ws-reap its own, the server an expire: or reclaim: one" (it advised the verb that REFUSES those two). The two comment lines above the archived arm are rewritten in place. All four edits sit above `:19131` and keep their line counts — the "citation repair" the wave-3 row asked for is that nothing moves (Global Constraints' census).

- [ ] **Step 1: Write the failing tests.**

<!-- replay: replace server/test/ccd-ws-expire-verb.test.ts -->
In `server/test/ccd-ws-expire-verb.test.ts`, find:

````ts

  it('a breadcrumb that stands but cannot be read is a failure to measure: exit 1, probe-unmeasured, nothing touched', () => {
````

Replace with:

````ts

  // Wave 3b, the carried row: ws-reap's mirror is keyed on a READABLE `expire:`/`reclaim:` prefix, so a `.reaping` that
  // stands but reads as nothing used to fall through to ws-reap's FRESH arm — on an archived row, where an interrupted
  // expiry leaves exactly that. It refuses `reaping-phase-unknown` now (ws-reap's own word for a breadcrumb it cannot
  // place), before it reads anything else; the spawn gate and ws-expire's own fork already read such a file as doubt.
  it('ws-reap meets a breadcrumb that stands but cannot be read on an ARCHIVED row: reaping-phase-unknown, never the fresh arm', () => {
    const a = makeArchived(h);
    fs.mkdirSync(reg('reaping'));
    const r = h.run(`${EXP_STUBS} cmd_ws_reap --expect ${'f'.repeat(64)} --session ${EXP_ID}`);
    expect(refusedWith(r)).toBe('reaping-phase-unknown');
    expect(JSON.parse(r.stdout).detail).toContain('cannot be read');
    intact(a);
  }, 90_000);

  it('the CONTROL: on a row that is NOT archived the guard is not asked — ws-reap answers as it always did', () => {
    const a = makeArchived(h);
    fs.rmSync(reg('archived'));
    fs.mkdirSync(reg('reaping'));
    const r = h.run(`${EXP_STUBS} cmd_ws_reap --expect ${'f'.repeat(64)} --session ${EXP_ID}`);
    expect(refusedWith(r)).not.toBe('reaping-phase-unknown');
    expect(fs.existsSync(a.wt)).toBe(true);
  }, 90_000);

  it('a breadcrumb that stands but cannot be read is a failure to measure: exit 1, probe-unmeasured, nothing touched', () => {
````

<!-- replay: replace server/test/ccd-ws-gc.test.ts -->
In `server/test/ccd-ws-gc.test.ts`, find:

````ts
    expect(fs.existsSync(wt)).toBe(true);
  });
});
````

Replace with:

````ts
    expect(fs.existsSync(wt)).toBe(true);
  });

  // Workspace lifecycle wave 3b (the carried row): the two advisory lines told an operator to run a verb that REFUSES
  // the breadcrumb (ws-reap refuses `expire:` and `reclaim:`), and that an archived workspace is removed "never on a
  // timer" — false once the server expires it seven days after its archive. Reworded in place, line for line.
  it('an `expire:` or `reclaim:` breadcrumb is not ws-reap’s to finish — the decline says whose it is', () => {
    h.makeRepo('demo');
    addWs('demo', 'quiet-mesa');
    for (const crumb of ['expire:worktree', 'reclaim:worktree']) {
      h.sh(`_reg_set demo-quiet-mesa reaping ${crumb}`);
      const out = h.sh(`${ARCH} cmd_ws_gc --prune`);
      expect(out).toMatch(/declined .*quiet-mesa is mid-cleanup/);
      expect(out).toContain('the verb that left it finishes it');
      expect(out).not.toContain('re-run ccd ws-reap to finish it');
    }
  });

  it('an archived workspace’s decline no longer says "never on a timer" — the server cleans it up seven days on', () => {
    h.makeRepo('demo');
    addWs('demo', 'quiet-mesa');
    h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-mesa`);
    const out = h.sh(`${ARCH} cmd_ws_gc --prune`);
    expect(out).toMatch(/declined .*quiet-mesa is archived/);
    expect(out).toContain('seven days after its archive');
    expect(out).not.toContain('never on a timer');
  });
});
````

- [ ] **Step 2: Run them — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-gc.test.ts --maxWorkers=1 )
```

Measured: `ccd-ws-expire-verb` `1 failed | 31 passed (32)` — × ws-reap meets a breadcrumb that stands but cannot be read on an ARCHIVED row … (the fresh arm ran and answered `gh-unreadable`); `ccd-ws-gc` `2 failed | 73 passed (75)` — × an `expire:` or `reclaim:` breadcrumb is not ws-reap’s to finish …; × an archived workspace’s decline no longer says "never on a timer" …

- [ ] **Step 3: Make them pass.**

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  local resumed; resumed=$(_reg_get "$id" reaping)
````

Replace with:

````bash
  local resumed; resumed=$(_reg_get "$id" reaping); ! _ws_reap_crumb_unread "$id" "$resumed" || return 0   # WS-REAP'S MIRROR
````

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
      # Archived is the STAGING for a confirmed deletion, not a queue a sweep
      # drains. No timer, no grace window, no "reclaim opens in 11 days".
      _gc_declined "$p is archived — remove it with the workspace sheet, never on a timer" ;;
    reaping)
      _gc_declined "$p is mid-cleanup (breadcrumb: $(_reg_get "$project-$slug" reaping)) — re-run ccd ws-reap to finish it" ;;
````

Replace with:

````bash
      # Archived is never ws-gc's to drain: Restore brings it back, and the
      # server's ws-expire cleans it up seven days after its archive (wave 3b).
      _gc_declined "$p is archived — never ws-gc's: Restore brings it back, and the server cleans it up seven days after its archive" ;;
    reaping)
      _gc_declined "$p is mid-cleanup (breadcrumb: $(_reg_get "$project-$slug" reaping)) — the verb that left it finishes it: ccd ws-reap its own, the server an expire: or reclaim: one" ;;
````

<!-- replay: replace ccd/ccd -->
In `ccd/ccd`, find:

````bash

# WS-REAP'S MIRROR (spec 2026-09-22 §5.6; carried constraint 5). The one line
````

Replace with:

````bash

_ws_reap_crumb_unread() {   # id breadcrumb-as-read -> rc 0, having printed ws-reap's refusal, when an ARCHIVED row's
  #                              `.reaping` stands but reads as nothing; rc 1 otherwise (ws-reap goes on as it did)
  # WS-REAP NEVER TAKES ITS FRESH ARM OVER A BREADCRUMB IT CANNOT READ (workspace
  # lifecycle wave 3b, the carried row). Its mirror is keyed on a READABLE
  # `expire:`/`reclaim:` prefix, so an unreadable `.reaping` used to fall through
  # to the fresh arm — on an archived row, where an interrupted expiry leaves
  # `.archived` standing beside its breadcrumb. It refuses with ws-reap's own word
  # for a breadcrumb it cannot place, as the spawn gate and ws-expire's fork read
  # such a file (doubt). A row that is not archived is not asked: ws-reap's own
  # `not-archived` answers it.
  [[ -z "$2" && -f "$REG/$1.archived" ]] && [[ -e "$REG/$1.reaping" || -L "$REG/$1.reaping" ]] || return 1
  printf '{"refused":"reaping-phase-unknown","detail":%s,"paths":[]}\n' \
    "$(_json_str "a breadcrumb stands at $REG/$1.reaping but cannot be read — which verb left it, and where, is unknown, so ws-reap never takes its fresh arm over it")"
}

# WS-REAP'S MIRROR (spec 2026-09-22 §5.6; carried constraint 5). The one line
````

Re-stamp `ccd/ccd`.

- [ ] **Step 4: Run — green.**

```bash
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-gc.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-reap.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archived-expiry-policy.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/wsaudit.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-wsaudit-nonpoison.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-die-containment.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ownership.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
```

Measured: `ccd-ws-expire-verb` `32 passed (32)`; `ccd-ws-gc` `75 passed (75)`; `ccd-ws-reap` `114 passed (114)` (its text bans hold: no `branch -D`, no `--force` in `_ws_reap_locked`); `archived-expiry-policy` `42 passed (42)`; `wsaudit` `25 passed (25)`; `ccd-wsaudit-nonpoison` `3 passed (3)`; `ccd-refusal-scan` `11 passed (11)`; `ccd-reg-get-census` `3 passed (3)`; `ccd-die-containment` `12 passed (12)`; `ownership` `14 passed (14)`; the citation cases `5 passed | 330 skipped (335)`.

- [ ] **Step 5: Mutation check, then commit.** Rows T11.1–T11.2 run the verb file with `-t 'breadcrumb that stands but cannot be read|the CONTROL: on a row that is NOT archived'`; T11.3–T11.4 the gc file with `-t "breadcrumb is not ws-reap|never on a timer"`.

| # | Edit (restore after; re-stamp) | Measured red |
|---|---|---|
| T11.1 | The guard's call removed. `ccd/ccd`: `…reaping); ! _ws_reap_crumb_unread "$id" "$resumed" \|\| return 0   # WS-REAP'S MIRROR` → `…reaping); :   # WS-REAP'S MIRROR` | `ccd-ws-expire-verb`: `1 failed \| 2 passed \| 29 skipped (32)` — ws-reap meets a breadcrumb that stands but cannot be read on an ARCHIVED row … |
| T11.2 | The guard asked of every row. `ccd/ccd`: `[[ -z "$2" && -f "$REG/$1.archived" ]] && [[ -e …` → `[[ -z "$2" ]] && [[ -e …` | `ccd-ws-expire-verb`: `1 failed \| 2 passed \| 29 skipped (32)` — the CONTROL: on a row that is NOT archived the guard is not asked … |
| T11.3 | The old reaping advice. `ccd/ccd`: `— the verb that left it finishes it: ccd ws-reap its own, the server an expire: or reclaim: one" ;;` → `— re-run ccd ws-reap to finish it" ;;` | `ccd-ws-gc`: `1 failed \| 1 passed \| 73 skipped (75)` — an `expire:` or `reclaim:` breadcrumb is not ws-reap’s to finish … |
| T11.4 | The old archived advice. `ccd/ccd`: `is archived — never ws-gc's: Restore brings it back, and the server cleans it up seven days after its archive" ;;` → `is archived — remove it with the workspace sheet, never on a timer" ;;` | `ccd-ws-gc`: `1 failed \| 1 passed \| 73 skipped (75)` — an archived workspace’s decline no longer says "never on a timer" … |

```bash
git add server/test/ccd-ws-expire-verb.test.ts server/test/ccd-ws-gc.test.ts ccd/ccd
git commit -m "$(cat <<'MSG'
fix(ccd): ws-reap refuses an unreadable breadcrumb on an archived row; ws-gc's advice is true

ws-reap's mirror was keyed on a readable expire:/reclaim: prefix, so an
unreadable .reaping on an archived row fell through to the fresh arm; it
refuses reaping-phase-unknown now. ws-gc's two declines no longer advise the
verb that refuses the breadcrumb, nor say an archive is never removed on a
timer. Line-neutral above the frozen anchor.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 12: The whole branch, the deploy order, and the PR

**Model routing:** `sonnet`, effort `medium` — measurement and reporting; any red that is not a named flake goes back to its task.

- [ ] **Step 1: Merge `main` and re-measure what a merge can move.** `git fetch origin main && git merge origin/main` (never a rebase). If `ccd/ccd`, `shared/api.ts`, `README.md`, `watch.ts` or `single-definition.test.ts` merged with anything — child reclamation wave 5 (#290) and wave 6, session-continuity wave 4 and stall-watch-settings W1 are all planned against them — keep both sides, re-stamp, re-measure the `_reg_get` census with the header's commands, re-run the five citation cases and `cite-remeasure`, re-point README's purge-token anchors by content, and re-run `single-definition`, `typecheck-tests` and `deviation-refs`. The coordinator re-verifies this plan on `main` after #290 merges (ruling I); `## Re-measure at dispatch` lists the blocks to re-check.

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
( cd server && ./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts --maxWorkers=1 )
git fetch origin main
( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
python3 <your scratch>/cite-remeasure.py <your scratch> origin/main    # wave 3's instrument; prints stated vs measured
grep -rn 'CCD_ARGV.wsExpire\b\|CCD_ARGV.wsExpire(' server/src
```

Measured on the final prototype tree over `77c11245` (`typecheck-tests` needs `agent/` and `pwa/` modules installed, or it cannot load `typescript`):

- `single-definition`: `275 passed (275)`
- `modelenv-single-writer`: `7 passed (7)`
- `box-token-census`: `23 passed (23)` — no route moves; the lane is no door
- `routing-references`: `11 passed (11)`
- `typecheck-tests`: `12 passed (12)`
- `ccd-workspaces`: `81 passed (81)`
- `ownership`: `14 passed (14)`
- `ccd-die-containment`: `12 passed (12)`
- `ccd-reg-get-census`: `3 passed (3)` (194/164)
- `topology-clean`: `55 passed (55)`
- `deviation-refs`: measure on your base after the fetch, with this plan in the tree — `main` gains plans with numbers between planning and dispatch, and this plan defines none
- the citation cases: `5 passed | 330 skipped (335)`; `cite-remeasure`: every stated figure equals the measured one (147, 197, 55, 35)
- the `grep`: one hit, `server/src/coord/expireArchived.ts` — the act's own scope, behind its second `capSupported`

- [ ] **Step 3: The suites, in full.** The whole server suite as **24 shards**, `--shard=k/24`, one denominator, sequentially, each in the foreground with `--maxWorkers=1`; a shard that outruns a foreground call is run by FILE, in its own vitest order (the files `--shard=k/24` selects are vitest 4's `BaseSequencer.shard`: the test files sorted by the sha1 of `/test/<file>`, sliced with the remainder handed to the low shards), and a file that outruns a call (`ccrc-update`, `ccrc-install`, `ccrc-doctor`) by its own top-level describes (`vitest list <file>`, then `-t '^(<describe>|…)( |$)'` per slice, every listed test in a slice). Then the agent suite; then the PWA in two shards and its typecheck.

```bash
for k in $(seq 1 24); do ( cd server && ./node_modules/.bin/vitest run --shard=$k/24 --maxWorkers=1 ); done
( cd agent && ./node_modules/.bin/vitest run --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/vitest run --shard=1/2 --maxWorkers=1 ) && ( cd pwa && ./node_modules/.bin/vitest run --shard=2/2 --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/tsc --noEmit -p . )
```

The shards' `Test Files` must sum to `find server/test -name '*.test.ts' | wc -l` — 509 on the prototype tree (504 on `77c11245` plus this plan's five new server test files): shards 1–5 hold 22 files, 6–24 hold 21. Measured on the final prototype tree (load average 18–25), every file passing but the one known red:

| Shard | Files | Result |
|---|---|---|
| 1 | 22 | `725 passed \| 3 skipped (728)` |
| 2 | 22 | `559 passed \| 3 skipped (562)` |
| 3 | 22 | `727 passed (727)` |
| 4 | 22 | 20 files `226 passed \| 3 skipped (229)`; `session-hook` `1 failed \| 334 passed (335)` — × skips a scratch slug — /tmp work accumulates no durable memory (KNOWN, TMPDIR outside /tmp); `ccrc-update` in three describe slices `110 + 204 + 188 = 502 passed` (`vitest list` lists 502) |
| 5 | 22 | `676 passed \| 6 skipped (682)` |
| 6 | 21 | `864 passed (864)` |
| 7 | 21 | `948 passed \| 11 skipped (959)` |
| 8 | 21 | 17 files `514 passed`; `ccrc-codex`, `ccd-swap`, `ccd-start-id` `249 passed`; `ccd-ws-reap` `114 passed` |
| 9 | 21 | `784 passed \| 1 skipped (785)` |
| 10 | 21 | 17 files `606 passed`; `ccd-bounded-reads`, `ccd-swap-carry-merge`, `ccd-redrive` `120 passed`; `ccd-ws-gc` `75 passed` |
| 11 | 21 | `972 passed \| 4 skipped (976)` |
| 12 | 21 | `696 passed \| 5 skipped (701)` |
| 13 | 21 | 19 files `627 passed`; `ccd-child-reclaim-ladder` `145 passed` and `ccd-lifecycle-purge` `63 passed`, each alone |
| 14 | 21 | 18 files `561 passed`; `ccd-rescue-policy` `102 passed`; `ccd-workspaces` `81 passed`; `ccrc-install` in four describe slices `42 + 116 + 107 + 28 = 293 passed` (`vitest list` lists 293) |
| 15 | 21 | 19 files `532 passed`; `ccd-child-reclaim-verb-reflogs` `49 passed`; `ccd-child-reclaim-verb` `70 passed`, alone |
| 16 | 21 | 18 files `564 passed \| 2 skipped (566)`; `ccd-session-state`, `ccd-supervised-start` `57 passed \| 4 skipped (61)`; `ccrc-doctor` in four describe slices, every test passing (`83`, `232`, `173`, `194`; slices overlap where one describe's name prefixes another's) |
| 17 | 21 | 19 files `542 passed`; `ccd-child-reclaim-hardening`, `ccd-archive` `175 passed` |
| 18 | 21 | `4883 passed (4883)` |
| 19 | 21 | 16 files `409 passed`; `ccd-resume-flag`, `ccd-child-reclaim-audit`, `ccd-route-tick` `50 passed`; `ccd-pr-state` `99 passed`; `ccrc-install-graphify` `58 passed` |
| 20 | 21 | 17 files `362 passed`; `tmp-sweep`, `ccd-ws-expire-audit`, `ccd-ws-expire-return-race` `39 passed` (tmp-sweep's known "FAILS CLOSED…" red did not reproduce on this run); `ccd-child-reclaim-pin` `74 passed` |
| 21 | 21 | 19 files `491 passed`; `ccd-child-reclaim-verb-tail`, `ccd-substrate` `85 passed` |
| 22 | 21 | `860 passed (860)` |
| 23 | 21 | 20 files `571 passed`; `ccd-ws-audit` `141 passed \| 4 skipped (145)` |
| 24 | 21 | `715 passed (715)` |

- `agent` (whole): `Test Files 25 passed (25); 465 passed (465)`
- `pwa --shard=1/2`: `Test Files 53 passed (53); 1645 passed (1645)`; `--shard=2/2`: `Test Files 52 passed (52); 1597 passed (1597)`
- `pwa tsc --noEmit -p .`: rc 0
- `boot` (shard 1): its "a hung ccd … does not delay listen" timing case once read `3929 < 3000` in a group run under load and passed alone (`3 passed (3)`) — a load flake.

Known reds that are not this wave's: tmp-sweep's "FAILS CLOSED…" (red on `main` on the fleet box; green on this run) and session-hook's "skips a scratch slug" under a `TMPDIR` outside `/tmp`; the load flakes CLAUDE.md lists (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`) — re-run a red one IN ISOLATION before calling it a break.

- [ ] **Step 4: Push and open the PR.** Check the author first (`git log --format='%an <%ae>' origin/main..HEAD | sort -u`). The PR body names: the wave and its rulings (A)–(I); the deploy class (AGENT-FIRST, and the lane shadowed until the operator arms it); every departure with its issued number; the mutation tables' totals; the deploy note's arming and its count; the carried follow-ups. Then report the wave-done fingerprint as the `ccrc-worker` skill says — the coordinator merges; the fleet moves by ccrc's own updater.

---

## Re-measure at dispatch (ruling I)

This plan was drafted on `origin/main` (`77c11245`, replay-checked on `b3b5a73ed`). Child reclamation wave 5 (#290, run 260) is in review and edits `watch.ts`, `server.ts`, `shared/api.ts`, `README.md`, `childReclaimWords.ts`, `ChildReclaimBanner.tsx`, `child-reclaim-banner.test.tsx` and the CCR-15 spec; child reclamation wave 6's merged plan edits `ccd/ccd`, `shared/api.ts`, `watch.ts`, `fleetws.test.ts` and `childReclaimWords.ts`; session-continuity wave 4 (run 274) edits `ccd/ccd`; stall-watch-settings W1's merged plan edits `shared/api.ts` and `watch.ts`. The coordinator re-verifies this plan on `main` after #290 merges: every block below must still match exactly once at its turn, or be re-anchored BY CONTENT (never by a line delta) before dispatch. The blocks in those files, by task and the first line of their Find:

| Task | File | Find begins |
|---|---|---|
| 1 | `ccd/ccd` | `` # stay the tail's to kill. At `artifacts`, and at `branch` after a `present` `` |
| 1 | `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` | `breadcrumb stands. Their grants and every other refusal stand. See` |
| 2 | `ccd/ccd` | `# and the reason is a count rather than a preference: this file makes 192` |
| 2 | `ccd/ccd` | `fi` |
| 2 | `ccd/ccd` | `[[ -f "$REG/$id.uuid" ]] \|\| die "no registry for '$id' (run ccd start first)"` |
| 2 | `ccd/ccd` | `[[ -f "$REG/$id.uuid" ]] \|\| die "no registry for '$id'"` |
| 2 | `ccd/ccd` | `_ws_expire_refuse_return "$id"   # a return during an expiry refuses, before anything is journaled (…` |
| 2 | `ccd/ccd` | `_ws_expire_refuse_return() {   # id -> returns 0 when nothing refuses a return; else DIES with the s…` |
| 2 | `ccd/ccd` | `# A RESIDUAL, DISCLOSED (3893; carried to wave 3b). The gate is taken and` |
| 3 | `ccd/ccd` | `\|\| { _ws_reclaim_unmeasured "the archive stamp at $f cannot be read as an epoch (it reads '$arch')";…` |
| 3 | `ccd/ccd` | `sys.exit(3)` |
| 3 | `ccd/ccd` | `sys.stdout.buffer.write(os.fsencode("%s\t%s\n" % (pid, p)))` |
| 3 | `ccd/ccd` | `while IFS=$'\t' read -r pid pth; do` |
| 3 | `ccd/ccd` | `local id="$1" rbc` |
| 3 | `ccd/ccd` | `printf '{"session":%s,"mode":"expire","archivedAt":%s,"alive":%s,"exists":%s,"reaping":%s,"sensitive…` |
| 4 | `server/test/fleetws.test.ts` | `expect(frame.coord).toEqual({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention…` |
| 4 | `server/test/fleetws.test.ts` | `expect(frame.coord).toEqual({ pause: 'set', mail: 'clear', reclaim: 'clear', childReclaimAttention: …` |
| 4 | `server/test/fleetws.test.ts` | `expect((await next()).coord).toEqual({ pause: 'clear', mail: 'set', reclaim: 'clear', childReclaimAt…` |
| 4 | `server/test/fleetws.test.ts` | `{ pause: 'clear', mail: 'clear', reclaim: 'set', childReclaimAttention: [] });` |
| 4 | `server/test/fleetws.test.ts` | `expect(frame.type).toBe('coord');` |
| 4 | `server/test/fleetws.test.ts` | `expect((await next()).coord).toEqual({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaim…` |
| 4 | `server/test/fleetws.test.ts` | `expect(frame.coord).toEqual({ pause: 'unmeasurable', mail: 'unmeasurable', reclaim: 'unmeasurable', …` |
| 4 | `server/test/fleetws.test.ts` | `expect((await next()).coord).toEqual({ pause: 'set', mail: 'clear', reclaim: 'clear', childReclaimAt…` |
| 4 | `server/src/watch.ts` | `ChildReclaimAttention, CoordStatus, Dialog, FleetSession, HookAsk, HookAskQuestion, LifecycleHealth,` |
| 4 | `server/src/watch.ts` | `private childReclaimAttentionList: readonly ChildReclaimAttention[] = [];` |
| 4 | `server/src/watch.ts` | `childReclaimAttention: this.childReclaimAttentionList }` |
| 4 | `shared/api.ts` | `/** The three markers the coordination lane is governed by, read together` |
| 4 | `shared/api.ts` | `childReclaimAttention: readonly ChildReclaimAttention[];` |
| 4 | `README.md` | `` `purge-mechanism-absent` (`shared/api.ts:7688-7690`), each with an operator sentence of its own at `… `` |
| 7 | `server/test/single-definition.test.ts` | `expect(ALL.filter((f) => SPELLING.test(stallCode(f))).map(rel).sort(), 'a second spelling').toEqual(…` |
| 7 | `server/src/watch.ts` | `import { CCD_ARGV, RECLAIM_CAP, RECLAIM_PAUSE_CAP, capSupported, verbSupported, sweepDec } from './c…` |
| 7 | `server/src/watch.ts` | `import { CHILD_BIRTH_SKEW_MS } from './coord/childSpent.js';` |
| 7 | `server/src/watch.ts` | `private expiryAttentionList: readonly ExpiryAttention[] = [];` |
| 7 | `server/src/watch.ts` | `/** The last measured project-pool sweep, or null if none has been taken yet` |
| 7 | `server/src/watch.ts` | `void this.sweepChildReclaim(records, registryRead.names)` |
| 7 | `server/src/watch.ts` | `coord, io: this.deps.io, cfg: this.deps.cfg, runCcd: this.deps.runCcd,` |
| 8 | `pwa/test/child-reclaim-banner.test.tsx` | `} from '../src/fleet/childReclaimWords';` |
| 8 | `pwa/test/child-reclaim-banner.test.tsx` | `expect(screen.getByRole('button', { name: 'Resume reclaim' })).toHaveClass('child-reclaim-toggle');` |
| 8 | `pwa/test/child-reclaim-banner.test.tsx` | `expect(CHILD_RECLAIM_MARKER_WORD.unmeasurable).toBe('reclaim switch unreadable');` |
| 8 | `pwa/test/child-reclaim-banner.test.tsx` | `expect(CHILD_RECLAIM_MARKER_WORD.clear).toBe('reclaim not paused');` |
| 8 | `pwa/test/child-reclaim-banner.test.tsx` | `fireEvent.click(screen.getByRole('button', { name: 'Pause reclaim' }));` |
| 8 | `pwa/test/child-reclaim-banner.test.tsx` | `const childReclaimPause = vi.fn(() => new Promise<void>(() => {}));` |
| 8 | `pwa/test/child-reclaim-banner.test.tsx` | `fireEvent.click(screen.getByRole('button', { name: 'Resume reclaim' }));` |
| 8 | `pwa/test/child-reclaim-banner.test.tsx` | `expect(await screen.findByText('Resume reclaim')).toBeInTheDocument();` |
| 8 | `pwa/test/child-reclaim-banner.test.tsx` | `expect(childReclaimAttentionOf({ childReclaimAttention: [bare] })).toEqual([bare]);` |
| 8 | `README.md` | `**What a crossing costs.** Caps stay global: one row, whole box, no per-project` |
| 8 | `README.md` | `workspace is still cleaned up by a human. Before anything is deleted the` |
| 8 | `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` | `Default: running. Pausing stops reclamation fleet-wide and nothing else; unpausing drains what queue…` |
| 8 | `pwa/src/fleet/ChildReclaimBanner.tsx` | `import { inlinePauseError } from './CoordBanner';` |
| 8 | `pwa/src/fleet/ChildReclaimBanner.tsx` | `: marker === 'set' ? 'Resume reclaim' : 'Pause reclaim';` |
| 8 | `pwa/src/fleet/ChildReclaimBanner.tsx` | `)}` |
| 8 | `pwa/src/fleet/childReclaimWords.ts` | `clear: 'reclaim not paused',` |
| 9 | `server/src/server.ts` | `import { archiveInterrupts } from '../../shared/api.js';` |
| 9 | `server/src/server.ts` | `if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });` |
| 9 | `server/src/server.ts` | `if (!plan.ok) return reply.code(plan.reply.status).send(plan.reply.body);` |
| 9 | `server/src/server.ts` | `const out = archiveOutcome(stopped, plan.ended, await deps.runCcd(archiveArgv));` |
| 11 | `ccd/ccd` | `local resumed; resumed=$(_reg_get "$id" reaping)` |
| 11 | `ccd/ccd` | `# Archived is the STAGING for a confirmed deletion, not a queue a sweep` |
| 11 | `ccd/ccd` | `# WS-REAP'S MIRROR (spec 2026-09-22 §5.6; carried constraint 5). The one line` |

**Child reclamation wave 6 (run 291, plan #293) and the shared ccd code** — the question in that programme's mails 3657 and 3666 to this coordinator, answered from this plan: 3b edits NONE of `_ws_reclaim_tail`, `_ws_reclaim_contained`, `_ws_reclaim_ladder`, `_ws_reclaim_workdir_shared`, `_ws_reclaim_owned` or the platform block. In ccd it edits only the EXPIRE region (Tasks 1–3: `_ws_expire_resume_eval`'s header, `_ws_expire_archived`, `_ws_expire_fork_contained`, `_ws_expire_cwd_users`' BODY — the command read and the read loop — `_ws_expire_audit_contained`, `_ws_expire_refuse_return` and the new seam), the MIRROR block (Task 11's helper), the return verbs' four gate lines, `_ws_reap_locked`'s first line, ws-gc's two arms and the `_reg_get` census sentence. The one shared function both waves touch is `_ws_expire_cwd_users`: wave 6 corrects its HEADER comment (its item 7, body byte-identical), 3b its body — the second lander merges main and keeps both. Wave 6's token gains `branchState=` (its item 5): an audit token minted before that deploy and spent after answers `state-changed` once, which this lane reads as a retry. Wave 6's new in-use probe and `_ws_expire_cwd_users` fold only after this wave's 3893 fix has landed, by agreement (its mail 3657, item 3).

None of #290's other files — `childReclaimSweep.ts`, `coord/store.ts`, `coord/childReclaim.ts`, `close.ts`, `coord/routes.ts`, `runWords.ts`, `RunsScreen.tsx`, `SessionLine.tsx`, `AbandonSheet.tsx`, `fleet.css` — is edited by this plan (the expiry lane is a sibling pass precisely so `sweepChildReclaim` is untouched, and the expiry list renders inside the cleanup row in its existing classes). Child reclamation's coordinator is told before Task 1's CCR-15 hunk (§6, "Not changed, deliberately") and Task 8's (§5.8) are pushed (the coordinator's notice, ruling F); #290 edits that spec's §1 and §5.5 only.

## Deploy note

**AGENT-FIRST, through ccrc's own updater; nobody moves a box by hand** (the operator's 2026-09-30 ruling). `ccd/ccd` (Tasks 1–3, 11) reaches the fleet box first — `ccrc rollout`'s default order — then the server and the PWA. A server that lands first is safe: it reads an older ccd's audit as no evidence (no `expiresAt`) and composes nothing, recording `no-evidence` on the cleanup row until the box updates.

**What changes on deploy, for every operator, before anything is armed:**
- A `ccd start`/`enable`/`ensure`/`swap` of an ARCHIVED workspace clears its archive at the moment it is asked, inside the reap lock (journaled `unarchive` under the verb's name) — where it used to clear it a step later, in `_spawn_start`. A return that then fails for another reason leaves a stopped, unarchived workspace at the top of its card with Archive offered again (the departure `return-clears-the-archive-inside-the-gate`).
- `ws-audit --expire`'s document gains `expiresAt`, sets `archivedAt` on `not-expired`, and names an `in-use` refusal's processes.
- `ws-reap` refuses `reaping-phase-unknown` over an unreadable `.reaping` on an archived row; `ws-gc`'s two declines read as Task 11 says.
- The archive door: a fail-shut store refusal carries the store's detail (and the server logs it); an unlistable registry is `503 registry-unmeasurable`; an `already archived` answer over a live pane stops it.
- The `/runs` cleanup row reads `cleanup not paused` / `Pause cleanup`, and lists the expiry lane's reports under the children's; the archive confirm says "Restore brings it back for 7 days; after that it is cleaned up".
- **The lane runs SHADOWED.** Each pass it audits up to three archived workspaces to learn their instants, and a row twice seen eligible past its instant is audited again and RECORDED: a feed row "archived workspace would be cleaned up" and a `would-expire` entry. Nothing is deleted.

**What the first armed pass faces** (ruling E), counted read-only on the fleet box at 2026-10-06 09:34 UTC from the registry's `.archived` stamps (the epoch ccd decides with) and the existence of `.child` and `.hold` — counts only, nothing printed or written: **30 archived workspaces, 20 of them past seven days**; 2 of the 20 carry a child marker (the child lane's, never this one's) and none is held. So an armed lane would face up to eighteen expiries — at one per pass, about one a minute once each is twice-observed — less whatever an open run, a review, presence or a process in the tree keeps. One of them, `ccrc-pwa-brisk-mesa`, holds a leaked TEST tmux server (review 284's R4: its socket is a test path, not the fleet's) and will be refused `in-use` on every pass and listed after three — find out what a listed process is before ending it: the fleet's own tmux server is also a `tmux: server`.

**Arming is the operator's, by hand, on the fleet box** — nothing in the tree writes the file (Task 7's pin): read the shadow's `would-expire` list on `/runs` first, then `touch ~/.cc-sessions/expire-lane-live`; `rm` it to return to shadow. `reclaim-paused` (the cleanup row's toggle) stops the lane entirely, armed or not, and child reclamation with it. Measure after convergence: `/health` reports the merge's tag; doctor shows 0 FAIL lines; `ccd caps` still prints `expire-v1`; the cleanup row shows the shadow's entries.

## Deviations found

Named by slug; the run's block is 4114–4125 (twelve), and the worker writes each number bare, in this order, in the entry as it defines it. Each departure is carried into the spec by Task 8's §5.3 amendment, by its effect, so a reader of `main` finds it in the text it changes.

- `return-clears-the-archive-inside-the-gate` (Task 2) — ruling (B) offered two remedies for 3893; both were measured per verb (Pre-flight finding 1). Holding the reap lock across the return's journal line breaks every SUPERVISED return of an archived row: the pane is spawned by the unit's own process, whose gate meets the lock the returning process still holds (measured for `start` and `ensure`; `swap` respawns through the same unit). Clearing the archive inside the gate passes the forced interleaving on all five paths and costs one block in the helper the four verbs already call. Its cost: the archive is cleared on the ATTEMPT (as the stop stamp already is), so a return that fails after the gate leaves a stopped, unarchived workspace, visible, with Archive offered again; its seven days restart when it is archived again. `ws-restore` has no gap (its lock spans its unarchive).
- `expire-audit-carries-expires-at` (Task 3) — ruling (C): §5.3's audit document gains `expiresAt` (`archivedAt + WS_EXPIRE_AFTER_S`, ccd's one definition) on every answer that read an archive, and `archivedAt` is set on `not-expired` (it was null there: wave 3's Carried row). The server reads the threshold; it never types it.
- `expire-audit-names-who-is-in-use` (Task 3) — ruling (G): an `in-use` refusal's document lists each process (`inUse`: pid, command, cwd; at most five) and its detail sentence names the command. The command is read inside the probe's one python call (`/proc/<pid>/comm`; `ps -o comm=` on Darwin) and is descriptive only: a command that cannot be read is `""` and changes no verdict.
- `expiry-lane-ships-shadowed` (Tasks 6, 7) — the coordinator's safety ruling (E), which §5.3 did not have: until `$REG/expire-lane-live` exists (the operator's, by hand; no writer in the tree) the lane audits and records "would expire" and never composes `ws-expire`; the executor reads the file at the act; `reclaim-paused` stops the lane entirely, shadow included.
- `expiry-lane-is-a-sibling-pass` (Task 7) — §5.3 says `sweepChildReclaim`'s pass "hosts a second population". The lane is its own method on the same tick, sharing that pass's registry read, cadence and switch and nothing else, because the child pass's early returns (the mirror unread, `reclaim-v1` or `reclaim-pause-v1` missing) are no reason to stop an expiry and an expiry's (`expire-v1` missing) none to stop a reclaim — and `sweepChildReclaim` stays untouched under #290's rewrite of it.
- `expiry-lane-learns-the-instant-from-ccd` (Task 7) — how ruling (C) is paced: a row's instant is learned from ONE audit per archive (a re-archived row is learned afresh), at most three such audits a pass so the first armed pass does not ask the box for thirty at once, never re-asked before the instant; an audit without `expiresAt` (an older ccd) is no evidence — reported, nothing composed, asked again after an hour.
- `expiry-attention-from-lane-memory` (Tasks 4, 5, 7) — child reclamation derives its attention list from the lifecycle mirror alone, "so a restart does not lose it"; the expiry list is derived from the lane's in-memory entries (shadow `would-expire`, `held` past the instant, standing `in-use`, `refused`, `failing`, `no-evidence`), because most of them (shadow, presence, `in-use`, the hold) are never journaled. A restart loses the list and rebuilds it over the next passes; it can delay an expiry, never cause one. Its own list on the wire (`CoordStatus.expiryAttention`, optional), never the child lane's.
- `standing-in-use-is-reported-never-killed` (Tasks 5, 7) — ruling (G): §5.3 says presence defers without a ceiling, and an `in-use` refusal is asked again every pass with none; after three consecutive refusals the row is listed with each process's pid, command and path, in words that say to find out what it is before ending it (the fleet's own tmux server is also a `tmux: server`) and never say kill. The lane never kills.
- `archive-door-refusal-carries-the-store-detail` (Task 9) — the carried follow-up: the archive door's fail-shut `run-open`/`coordinator-has-open-runs` refusals on a store it could not read carry that store's `detail` beside `runs: []` (additive), and the server logs it; seven replayed assertions gain the field.
- `archive-door-unlistable-registry-is-503` (Task 9) — the carried follow-up: the archive door lists the registry before `knownId`, so a registry that does not list answers `503 registry-unmeasurable` where wave 2 folded it into `404 unknown-session`; `knownId`'s own call is untouched (`routes.test.ts`'s census).
- `archive-door-stops-an-already-archived-live-pane` (Task 9) — review 240's F1, carried: `ws-archive`'s `already archived` exit 0 stopped nothing; when tmux PROVES the pane up, the door stops it with `/stop`'s argv under the turn it already measured and answers `stopped: true`. A pane gone, or one tmux cannot be asked about, answers as before.
- `ws-reap-refuses-an-unreadable-breadcrumb-on-an-archived-row` (Task 11) — the carried row: ws-reap's mirror was keyed on a READABLE `expire:`/`reclaim:` prefix, so a `.reaping` that stands but reads as nothing on an archived row fell through to the fresh arm; it refuses `reaping-phase-unknown` (its existing word) instead, as the spawn gate and `ws-expire`'s fork already read such a file.

Not departures, and named so nobody hunts for a number: the cleanup row's widened words and the archive-confirm copy are §5.3's and §5.2's own; FM7 (Task 10) tightens a predicate to the spec's stated disjointness; ws-gc's two declines (Task 11) are reworded to what is true; `mail-routes.test.ts`'s thirteenth union admits the executor's own vocabulary as every earlier union did.

## What wave 4 (the dead-coordinator lane) inherits

- `reclaim-paused` is the fleet's one cleanup switch (§5.3); stage 4's lane reads it too.
- The expiry lane is `sweepArchivedExpiry`, a sibling on the reclaim sweep's tick; a third sibling follows the same shape (its own memory, executor, feed rows, attention list).
- A row removed by `ws-expire` journals act `expire` — a deliberate removal, never a crash (§5.4's journal clause).
- The cleanup row on `/runs` renders two lists under one switch; a third population gets its own reader and its own list, never a member of another's.

## Carried out of this wave (recorded in the programme ledger)

| Follow-up | Owner | Why not here |
|---|---|---|
| ws-reclaim's word for an `expire:` breadcrumb (it answers `reap-in-progress`) | NOT TAKEN (ruling H) | both are retries; a word of its own would widen `CHILD_RECLAIM_TOKEN_KIND` for a breadcrumb ws-reclaim never meets in practice (wave 3's departure, by number 3892) |
| Wave 2's operator questions 1 and 2 (the PR sheet's "Archive now"; the remote-mode worktree check) | stay open with the operator | unchanged by this wave |
| Wave 2's operator question 3 — whether L5's "Its workers will be cleaned up" stands | the operator, with this wave's arming | true once the lane is armed: until then a released worker is cleaned up only by a human or by child reclamation |
| A box that answered `flock-unavailable` is not asked again for the life of the server process | wave 4, or a follow-up if the operator wants it re-asked on a capability change | a restart re-asks; a box without util-linux `flock` cannot run any expiry, so nothing is lost by waiting |
| The expiry list is rebuilt after a restart, not read back | a follow-up if the operator wants it durable | the departure `expiry-attention-from-lane-memory` |

## Open questions for the operator

1. **The words before the arming.** Task 8's archive confirm ("…after that it is cleaned up"), README and coordinator clause 3 say what an ARMED fleet does, and land with the lane's live arm as ruling (F) says. Until `expire-lane-live` is touched, nothing is cleaned up. Keep the words as the spec gives them (this plan's reading), or hedge the PWA copy until the fleet is armed?
2. **The first armed pass.** Twenty archived workspaces are past seven days today (eighteen without a child marker). Armed, the lane expires them at most one a pass — about one a minute — in their instant order. Arm as is, after reading the shadow's list, or raise `WS_EXPIRE_AFTER_S` first (§9's kill rule is the one lever)?
3. **`ccrc-pwa-brisk-mesa`'s leaked test tmux server.** It will be listed `in-use` on every pass. End it before arming (review 284 measured it as a test server on its own socket, safe to end), or leave the listing to show the standing refusal working?
4. **For the coordinator, not the operator — two mails in its queue bear on this plan.** Child reclamation's 3657 and 3666 ask whether 3b edits `_ws_reclaim_tail`, `_ws_reclaim_contained`, the ladder or the platform block; `## Re-measure at dispatch` answers: none of them, and the one function both waves touch is `_ws_expire_cwd_users` (wave 6 its header comment, 3b its body). This plan's author read those two mails read-only and acked nothing.
