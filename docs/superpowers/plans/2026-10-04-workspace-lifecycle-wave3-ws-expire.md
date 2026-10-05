# Workspace lifecycle, wave 3 — the `ws-expire` verb (spec stage 3, AGENT-FIRST) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the box the verb that ends an archived workspace's life: `ccd ws-expire --expect <token> --session <id>`, minted by `ccd ws-audit --session <id> --expire`, pins everything git knows about an ARCHIVED workspace whose archive is at least seven days old (`WS_EXPIRE_AFTER_S`, 604 800 s) and then removes its unit, pane, worktree, branch, clips and registry row — recording every ignored and secret-shaped file it drops (paths and sizes) and every clip (names and sizes), keeping the transcripts — exactly as child reclamation's `ws-reclaim` does for a finished child, through that verb's own machinery. It refuses a main checkout, a child, an archive younger than a week, a held, paused, attached or LIVE workspace, and every rung `ws-reclaim` refuses; its token binds the archive's epoch, so a workspace brought back and archived again starts a new week. A return during an expiry refuses on every spawn path, before anything is journaled. The server gains only the pieces that let it COMPOSE the verb later — the `CcdArgv` builders, the `expire-v1` capability token, the agent grant enrolled on its confirmation token — and nothing that calls it: the lane is wave 3b's. The wave's first commit closes wave 2's residue (review 244, F1–F3), and the lifecycle instrument is bound to ccd's journal vocabulary before anyone reads it again.

**Architecture:** The box half is `ccd/ccd`. Child reclamation's RECLAIM region (`RECLAIM-BEGIN`…`RECLAIM-END`) is made flavour-aware without moving a word of its fourteen: its ladder's rungs 3–10 move, verbatim, into `_ws_reclaim_ladder`, which both verbs' rungs 1–2 call after setting `_WS_LADDER_BIND` (the token's leading inputs — a reclaim's are the four it always had, in the same order, so every reclaim token is unchanged); the pin phase, the tombstone fields, `_ws_reclaim_fail` and the tail read `_WS_RCL_ACT` (`reclaim` by default, assigned whenever ccd is read; `expire` only as a local inside `cmd_ws_expire`) for the journal act and verb, the breadcrumb flavour, the WIP subject, the tombstone's `mode` and binding field and the done document. Rung 5 asks ONE more question for an expiry, keyed on the token's binding (`mode=expire`) rather than the flavour, and only tightens: `_ws_expire_presence` refuses a detached live pane or a running unit (`live`) — on Darwin asking launchd itself behind a `failed` stamp — and the resume asks it again at its `children` phase, before the teardown begins. Everything that is the expiry's own lives in a new EXPIRE region (`EXPIRE-BEGIN`…`EXPIRE-END`) below the RECLAIM region: rung 2′ (`_ws_expire_archived`, `_ws_expire_not_child`), `_ws_expire_eval`, the resume eval that re-asserts the archive epoch, the flavour fork, `cmd_ws_expire`/`_ws_expire_locked`, `ws-audit --expire`'s document, the spawn gate and the return verbs' refusal. `ws-reap` refuses an `expire:` breadcrumb in the MIRROR block (`expire-in-progress`). `cmd_start`, `cmd_ensure`, `cmd_swap` and `cmd_enable` refuse an expiry in progress before they journal; `ws-restore` refuses it under its lock; `_spawn_start` holds the same gate as the backstop; on an archived row a breadcrumb that stands but cannot be read refuses too. The verb and its audit cross the direct-entry boundary `ws-reclaim` crosses (`ccd/ccd-entry.py` and the body's own guard). Every ccd edit above the frozen citation corpus's highest anchor is line-neutral. The server half is additive and inert: `CCD_ARGV.wsExpireAudit`, `CCD_ARGV.wsExpire`, `EXPIRE_CAP`, the 240 s budget, `SENTENCES` for the four new words; the agent grants `['ws-expire','--expect']`, enrolled in `REQUIRED_VERB_FLAG`, with a negative type fixture (`g15`).

**Tech Stack:** bash 5 (`ccd/ccd`, `set -uo pipefail`, no `-e`), python3 (the launcher `ccd/ccd-entry.py`, the instrument `deploy/measure-workspace-lifecycle.py`), git 2.43, TypeScript (server, agent, pwa, L0 `shared/`), vitest 4, `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md` — §5.3 (the whole of this wave's verb), §3 (why an automatic expiry is safe), §6 items 1, 2 and 4, §8's stage-3 failure modes, §9's kill rule and its instrument, §11 item 2; §5.2 for wave 2's residue (Task 1). The parent machinery: `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` §5.5–§5.6 and its contract `docs/superpowers/programs/child-reclamation-contract.md` (the vocabulary's declarations and cardinals, the ladder, the pin phase, R16, R29). Programme ledger: `docs/superpowers/programs/workspace-lifecycle.md` (Carried constraints and Next-wave brief are requirements of this plan). Sibling plans whose shape this one copies: child reclamation's wave 3 (`2026-09-22-child-reclamation-wave3-ws-reclaim-and-close.md`, `ws-reclaim`) and this programme's wave 2 (`2026-10-01-workspace-lifecycle-wave2-one-archive.md`).

> **DISPATCH WAITS ON ONE RULING — Open question 1.** Ruling (E)/(I) reads "ws-reap's resume fork gains the `expire:` arm, re-asserting the archive epoch" and "a crash at each phase resumes through ws-reap's `expire:` arm". This plan builds that arm as a REFUSAL (`expire-in-progress`) and gives the epoch-re-asserting resume to `ws-expire` itself — the spec's reading (§5.3, §6 item 4) and child reclamation's carried constraint 5. The coordinator rules before the run is dispatched; if the ruling is the other reading, Task 4's MIRROR edit, its flavour-fork tests, the wave-3b word list and Task 9's spec amendment change with it. A worker never starts Task 4 on an open Question 1.
>
> **Departure numbers.** The plan lists fourteen departures (`## Deviations found`); the block issued at run-open holds ten. The coordinator mints four more before dispatch.

## The coordinator's rulings this plan builds (binding; they win over the spec's wave table)

- **(A) Shape.** Spec stage 3 is split at the AGENT-FIRST seam, as child reclamation split its verb from its sweep. THIS wave is the VERB plus the server pieces that let the server COMPOSE it — builders, `expire-v1`, the grant and its enrolment with its negative fixture — and nothing that CALLS it. The lane, the widened cleanup switch and its Runs-banner label, coordinator clause 3's move, and the README and `wave-lifecycle.md` §6 "after 7 days" text are wave 3b's: see **Wave 3b inherits**, at the end.
- **(B)** The first commit is wave 2's residue from review 244 (Task 1).
- **(C)** CLAUDE.md's SAFETY list gains `ws-expire` in this wave; the skill corpora must not name it, pinned (Task 9).
- **(D)** An `.archived` row whose pane or supervisor is LIVE is never expired: measured (Pre-flight finding 2), a rung added (Task 3) — Darwin's stale `failed` stamp included — and asked again by the resume while nothing has been stopped (Task 4).
- **(E)** Every caller of `_spawn_start` refuses an `expire:` breadcrumb, each pinned — `cmd_enable` included, which journals before it reaches `cmd_start`; `ws-reap`'s resume fork gains its `expire:` arm (Tasks 4 and 5; see the departure `ws-reap-refuses-the-expire-breadcrumb` for how that arm reads, and the callout above: this arm waits on Open question 1).
- **(F)** `expire` joins `_LC_ACTS` and every declaration that agrees with it, and wave 1's three instrument items land here (Task 2).
- **(G)** Carried OUT of this wave, to wave 3b: the archive door's unreadable-store 409 detail, the base's 404 fold for an unlistable registry, and FM7's fold disjointness.
- **(H)** The ladder exactly as §5.3 — no `--defer-expired`.
- **(I)** The tests named in the ruling, all in fixture HOMEs (the File Structure table maps each to its file).
- **(J)** Overlap with child reclamation wave 5 (run 260): whichever lands second runs `git merge origin/main` (never rebase), re-stamps `ccd/ccd` and re-runs the citation cases (Global Constraints, last bullet).

## Global Constraints

Copied from `CLAUDE.md`, the spec and the ledger where the value matters. Every task's requirements include this section.

- **Base.** Every block below was generated from `origin/main` `b40f4145` (child reclamation wave 4, #215) — this revision's new and changed blocks from `a6daa9cf4` — and replays, unchanged, onto `a6daa9cf4` (#247) and onto `4100ae1c9` (#249 and #246, stall-watch wave 7, which edit `README.md`, `shared/api.ts` and the coordinator skill in lines no block reads — the replay was checked: every block matches exactly once at its turn, and the final tree differs from the `a6daa9cf4` one by exactly #249 and #246's own lines). The drafter's stages were measured on `b40f4145`; this revision's stages, red lists and mutation rows on `a6daa9cf4`; the final tree's suites and repo-wide guards (Task 10) on `4100ae1c9`. If a Find block is absent or not unique on your base, `main` moved under it: stop and report rather than improvising an anchor. Line numbers in prose are hints; the blocks locate every edit by content.
- **Deploy class: AGENT-FIRST, through ccrc's own updater; nobody moves a box by hand.** `ccd/ccd`, `ccd/ccd-entry.py` and `agent/src/whitelist.ts` must be on the fleet box before a server that COMPOSES `ws-expire` runs — and no server in this wave composes it: nothing calls `CCD_ARGV.wsExpire` until wave 3b, so the verb is inert on deploy. The deploy note at the end has the order.
- **SAFETY — sacred.** Never run a destructive `ccd` verb against the live host: `ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`, `ws-restore`, `ws-reclaim` — **and, from this wave, `ws-expire`.** Nothing in this plan runs any of them outside a fixture HOME. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*.service` directly; never print a secret file's contents; `gh` stays off the exec whitelist (`EXEC_COMMANDS` stays `['tmux','ccd']`, `UNGRANTABLE_VERBS` stays `['ws-rm','ws-gc']`).
- **Fixture HOMEs only.** Every ccd test runs inside `makePrHarness`'s or `makeCcdHarness`'s HOME. The expiry suites build on `server/test/wsExpireFixture.ts` (Task 3), which reuses child reclamation's `CHILD_STUBS` (the unit and pane calls RECORDED, never made; `_svc_is_active` answers `inactive`) and `CHILD_ENV` (the residue probe kept inside the HOME), and names the clock rung 2′ reads (`_ws_expire_now`), so the seven-day boundary is exact rather than a race with the wall clock.
- **No root `package.json`.** Four packages, each run cd'd in; a package command is a subshell, `( cd server && … )`, so the next line still starts at the root. **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts --maxWorkers=1` from inside the package; NEVER bare `npx vitest`.** Suites in the FOREGROUND, timeout ≥ 600000 ms, ONE test file per process for the ccd and hook suites; never two suites at once; `--maxWorkers=1` everywhere, the whole-suite runs included (the fleet box runs other workers' suites with a few GB free — `free -g` before a long run). The whole server suite runs as `--shard=k/12`, k = 1…12, one denominator, sequentially, each shard in the foreground (Task 10).
- **Scratch space and the disk floor.** Put `TMPDIR` on the project volume, in a directory you create OUTSIDE every git checkout — `<the volume's mount>/scratch-<run>-tmp`, never a path under this worktree or any other repository — and run with `CCD_DISK_FLOOR_GB=1` (the ledger's 2026-09-28 note): the volume stands at 98% (11 G free when this plan was revised), under or near ccd's 10 G `ws-add` floor, and the root disk is the one that filled on 2026-10-02 (the operator's Docker-hygiene rule). The outside-a-checkout rule is measured, not taste: with `TMPDIR` inside this worktree, every fixture repository is nested inside the outer one, and `ccd-child-reclaim-ladder.test.ts`'s `refuses no-worktree-record … for a directory that EXISTS but git does not record` answered `containment-unproven` (git found the OUTER repository), `1 failed | 144 passed (145)`; with `TMPDIR` on the volume outside any checkout the same file is `145 passed (145)`. Delete only the fixtures you created, and the scratch directory when the wave is done.
- **`ccd/ccd` is provenance-STAMPED.** Every step that edits it re-stamps before its test run (the `ownership.test.ts` gate), from the root:

      node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
        const { markGenerated } = await import('./shared/mark.mjs'); \
        writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"

  (`~/.local/bin/ccrc restamp ccd/ccd` does the same where it is installed.) The blocks below never show line 2 (`# ccrc:generated 1 sha256=…`): the re-stamp writes it.
- **The citation-corpus tax (procedure S6-R11) is ZERO in `ccd/ccd`, by construction, and paid once in README.** The frozen compaction-card corpus's highest `ccd/ccd` anchor is `:19131` (re-measure: `grep -ohE '(ccd/ccd:|[`( ,]:)[0-9]+' docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md | grep -oE '[0-9]+$' | sort -n | tail -1`), and README cites no `ccd/ccd` line. Every edit this plan makes above `:19131` keeps its line count — the entry guard and its comment, the `_reg_get` census sentence, `cmd_caps`, `cmd_ws_audit`'s hand-off and usage, `_ws_reap_locked`'s mirror line, `cmd_ws_restore`'s archive check — and everything that needs words lives below it, in the EXPIRE region. Task 2's four `shared/api.ts` lines move README's four purge-token anchors; Task 2 repairs them by content. The five citation cases are run after every task that edits a cited file:

      ( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )

  Measured: `5 passed | 330 skipped (335)` at the end of every task (Task 2's green stage, before its README repair, is the one red: `CITATION DEBT` and `README HAS ITS OWN CENSUS`).
- **The `_reg_get` census tax.** `server/test/ccd-reg-get-census.test.ts` reads ccd's sentence "this file makes N invocations across M non-comment lines" and holds both numbers to the live count. Every task that adds a `_reg_get "` call MEASURES the two numbers with the header's own commands — never types them from this plan:

      grep -v '^[[:space:]]*#' ccd/ccd | grep -o '_reg_get "' | wc -l    # N
      grep -v '^[[:space:]]*#' ccd/ccd | grep -c '_reg_get "'             # M

  writes them over the sentence's two numbers in place (the sentence wraps across two comment lines — change the digits only), and runs `ccd-reg-get-census.test.ts`. Measured on this base: 179/150 → 181/152 (Task 3) → 185/155 (Task 4) → 187/157 (Task 5) → 189/159 (Task 6); Task 7 adds none. Task 3 also rewrites the first `THE LAST MOVE WAS` line's opening, in place, one line for one line.
- **The die census.** `server/test/ccd-die-containment.test.ts` names every `_`-helper that can `die` (a `die` inside `$( )` is demoted to a return code). Task 5 adds `_ws_expire_refuse_return` to it and Task 6 `_ws_expire_audit_contained`, each in its Step 5 — and each task's commit STAGES that file (its `git add` names it): a branch whose ccd has the helper and whose census does not reds `was actually parsed — the scan is looking at something` on a guard that is not a flake. Neither helper is ever called inside `$( )` (the same file's demotion scan holds that).
- **Three ccd text bans this wave must not trip**, each pinned by an existing test: the substring `branch -D` on one line only (`ccd-ws-reap.test.ts`) — nothing here spells it; `--force` never in `_ws_reap_eval`, `cmd_ws_reap`, `_ws_reap_tail`, `cmd_ws_audit` or `_ws_reap_locked` (same file) — nothing here adds one; the heading `STATUS 1 FOLDS SEVERAL CONDITIONS` exactly four times (`ccd-lifecycle-purge.test.ts`) — untouched.
- **The refusal harvests.** `server/test/wsaudit.test.ts` harvests every `_reap_refuse <word>`, `"refused":"<word>"` and `"verdict":"<word>"` in the WHOLE of `ccd/ccd` and holds the set equal to `SENTENCES` (`server/src/wsaudit.ts`): every new word gets a sentence in the task that first spells it. `child-reclaim.test.ts` holds the RECLAIM region's words equal to `CHILD_RECLAIM_TOKEN_KIND` (fourteen) — so NO new word is spelled inside the RECLAIM region; the expiry's words live in the EXPIRE region. `ccd-wsaudit-nonpoison.test.ts` counts words outside the held-apart blocks at a figure (55) the frozen corpus quotes byte for byte — so the EXPIRE region joins the blocks that test cuts out, and its full-file count is re-measured: 62 → 65 (Task 3) → 66 (Task 4). `expirable`, the audit's success word, is spelled through `_json_str`, as `reclaimable` is, so no harvest counts it.
- **Rings and wire.** `shared/api.ts` gains one union member and one map key; nothing else in L0 moves. No `FLEET_PROTO` bump: nothing on the wire changes in this wave. `livestate.ts`'s change (Task 1) narrows what a reader accepts as a status word; no field is added.
- **Mutation-table discipline.** Every new guard ships with a row that reds when the guard is deleted or mutated — measured on this plan's prototype, never guessed. Each task ends with its table: the exact edit, the command and the measured red. Restore every edit (and re-stamp) before the commit.
- **Branch discipline.** Commit on this workspace's own branch, one commit per task, never a separate feature branch. Identity is the repository's noreply address; do not change git config. Before each push: `git log --format='%an <%ae>' origin/main..HEAD | sort -u`.
- **Deviation numbers.** This plan defines none. Its fourteen departures are listed by slug under `## Deviations found`; the coordinator issues their numbers — the block issued at run-open holds ten, so four more are minted before dispatch — and you write them bare in the entries as you define them. A departure found while executing is reported, never typed.
- **No hostnames, IPs, tailnet names or docserver URLs** anywhere in the diff (`topology-clean.test.ts`).
- **Overlap (ruling J).** Child reclamation wave 5 (run 260) is planned against the same files this wave edits: `shared/api.ts` (both re-point README's purge-token anchors, S6-R11) and, per its coordinator's brief, `ccd/ccd` (R36's temp-root collector). Whichever lands second runs `git merge origin/main` — never a rebase — resolves both sides kept, re-stamps `ccd/ccd`, re-measures the `_reg_get` census, re-runs the five citation cases and repairs README's anchors by content, then re-runs this plan's ccd suites and `child-reclaim.test.ts`.

## Review Focus

The inputs a person — or the server's future lane — will meet first, each pinned in the task that owns it:

1. **An archived workspace somebody is still using** — a `cc-<id>` pane that is up with no client attached, or a unit that is running (on Darwin, a running or loaded job behind a stale `failed` stamp): `live`, retryable, nothing touched; asked by the token's binding, so a caller that forgot the flavour still asks; and asked again by a resume at `children` (Task 3: `rung 5, asked more of for an expiry`, `rung 5 on Darwin`; Task 4: the resume's `nothing is stopped, nothing deleted` case; Task 6: `the audit refuses a live archived workspace`; the CONTROL: `ws-reclaim` is not asked this). Not seen, and stated: a process with its cwd in the worktree that runs outside the pane and the unit.
2. **Brought back, then archived again** — the old token refuses `state-changed`; an archive an hour old refuses `not-expired` whatever token is offered (Task 3: `the archive EPOCH is a token input`; Task 4: `A RETURN AND A RE-ARCHIVE START A NEW WEEK`).
3. **The seven-day boundary** — 604 799 s refuses `not-expired`, 604 800 s proceeds; a stamp in the future is not old; a stamp that is not an epoch is unmeasured (Task 3).
4. **Nothing git knows is lost** — dirty and untracked work committed, every stash and operation head pinned, all still reachable from `refs/ccrc/attic/<id>/` after the worktree and branch are gone and the repository is garbage-collected; ignored and secret-shaped files recorded with sizes, clips by name and size, transcripts untouched (Task 4: `a fresh expiry`, `NOTHING GIT KNOWS IS LOST`).
5. **A crash at any phase** — the next attempt resumes from `expire:<phase>`, unsupervising and killing first, after re-asserting the archive epoch, the child marker, the switch and the hold — and, at `children`, before anything was stopped, refusing `live` for a pane or unit that stands (Task 4: the resume describe, all four phases; `a registry purge that fails`).
6. **Somebody brings it back during the expiry** — after a crash (the breadcrumb, or one that stands unread on an archived row) or during the act (the lock): `start`, `enable`, `ensure` (in a unit and out), `swap`, `ws-restore` and `_spawn_start` itself refuse, and nothing is journaled that the §9 instrument would read as a return (Task 5).
7. **Another verb's interrupted work** — `ws-reap` refuses an `expire:` breadcrumb; `ws-expire` refuses `reclaim:` and ws-reap breadcrumbs; an unreadable breadcrumb is unmeasured (Task 4: `the flavour fork`).
8. **A startup-injected shell** — `ws-expire` and `ws-audit … --expire` start under `bash -p` through the installed launcher and are refused at the body's entry otherwise (Task 7 and the shared grammar table).

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `server/src/livestate.ts`, `server/src/coord/archiveDoor.ts` (docstring), the spec's §5.2 step 1, wave 2's plan (its 3881 entry), `server/test/livestate.test.ts`, `server/test/archive-door.test.ts` | 1 | review 244 F1–F3: a status that is not a string is no word; the main-checkout consequence of reading the config dir first, pinned; the second stricter arm named |
| `shared/api.ts`, `ccd/ccd` (`_LC_ACTS`), `pwa/src/session/journalWords.ts`, `deploy/measure-workspace-lifecycle.py`, README (four anchors); `lifecycle-acts`, `single-definition`, `lifecycle-vocabulary`, `ccd-lifecycle-emit`, `measure-workspace-lifecycle` tests | 2 | the `expire` act in every declaration and cardinal; the instrument's act lists bound to `_LC_ACTS`, its close-time doubt widened to the server's rule, its read-only pin structural (`-wal`) |
| `ccd/ccd` (RECLAIM region: the flavour, the shared ladder, rung 5's question; the EXPIRE region's ladder), `server/src/wsaudit.ts`; `wsExpireFixture.ts`, `ccd-ws-expire-ladder.test.ts`; taxes in `ccd-reg-get-census` (sentence), `ccd-wsaudit-nonpoison`, `ccd-child-reclaim-pause` | 3 | the expiry ladder, every rung's refusal, the boundary, the epoch in the token, ruling (D)'s `live` |
| `ccd/ccd` (the tail, pin, tombstone and failure flavour; the EXPIRE region's verb and resume; the MIRROR block; `_ws_reap_locked`; `cmd_reclaim_pause`'s comment), `server/src/wsaudit.ts`; `ccd-ws-expire-verb.test.ts`, `ccd-refusal-scan.test.ts`; the same taxes | 4 | `ws-expire`: lossless, resumable, epoch-re-asserting, flavour-fenced |
| `ccd/ccd` (`_spawn_start`, `cmd_start`, `cmd_ensure`, `cmd_swap`, `cmd_enable`, `cmd_ws_restore`, the EXPIRE region's gate); `ccd-ws-expire-spawn.test.ts`; the die census `ccd-die-containment.test.ts` | 5 | a return during an expiry refuses, on every path, before anything is journaled |
| `ccd/ccd` (`cmd_ws_audit`'s hand-off and usage, the EXPIRE region's audit); `ccd-ws-expire-audit.test.ts`; `ccd-child-reclaim-audit`, `ccd-child-reclaim-entry` (the usage line); the die census `ccd-die-containment.test.ts` | 6 | `ws-audit --expire`, its document, its exits, its journal, its containment |
| `ccd/ccd` (dispatcher, `cmd_caps`, the entry guard), `ccd/ccd-entry.py`, `server/src/ccdargv.ts` (`EXPIRE_CAP`); `ccd-ws-expire-reach.test.ts`, `ccd-child-reclaim-entry.test.ts` (the grammar), `ccd-archive.test.ts` | 7 | reachable, advertised, and across the direct-entry boundary |
| `server/src/ccdargv.ts` (builders), `server/src/remote/runner.ts`, `agent/src/whitelist.ts`; `g15-ws-expire-without-expect.ts`, `legit-whitelist.ts`, `whitelist-structural`, `whitelist-subset`, `remote-runner`, `ccdargv-dec-parity` | 8 | what lets wave 3b compose the verb — and nothing that calls it |
| `CLAUDE.md`, `agent/CLAUDE.md`, the spec's §5.3 (this wave's amendment); `ws-expire-prose.test.ts` | 9 | the contracts that move now; the skills never name the verb |

**Not modified, deliberately:** `ws-reclaim`'s fourteen words and its ladder's behaviour (every child-reclamation suite is green on the tree, Pre-flight finding 11); `cmd_ws_reclaim`, `_ws_reclaim_locked`, `_ws_reclaim_fork` (a reclaim reads an `expire:` breadcrumb as `reap-in-progress`, as it reads every breadcrumb not its own — the departure `reclaim-reads-an-expire-breadcrumb-as-reap-in-progress`); `ws-reap`'s ladder and tail (one line, its mirror); the coordinator, worker and reviewer skills (Task 9 pins that they never name the verb); README apart from Task 2's four anchors; every PWA surface; `server/src/watch.ts` and `childReclaimSweep.ts` (the lane is wave 3b's); `verb-gate.test.ts`'s `CAP_GATED_VERBS` (it names verbs with a call site; wave 3b adds `ws-expire` with the lane).

## Pre-flight findings (measured while planning; not departures unless they say so)

Measured on a prototype of this plan's exact edits over `b40f4145` — and, for this revision (the four review lenses' findings), over `a6daa9cf4` and `4100ae1c9` — replayed from this document's blocks stage by stage (each task's red stage, its green stage, and its tax stage where it has one), with every named suite run at every stage, one file per process, `--maxWorkers=1`. The fleet box ran at a load average of 25 to 85 while it was measured (other workers' suites): where a step's measured list shows a red case that is not the step's subject, the same file was re-run alone and the case passed — it is load, and so is any red you meet that the step does not name, until a run in isolation says otherwise.

1. **No spawn path honoured a breadcrumb before this wave** (ruling E's census). A session pane is made by `_spawn_start` alone: `_tmux_new_session`'s callers are `_spawn_start` (twice) and `cmd_account_pane`, whose pane is an account's. `_spawn_start`'s callers are `cmd_ws_add` (a new row), `cmd_ws_restore`, `_spawn` (no caller), `_supervised_start`'s two unsupervised fallbacks, `cmd_start` and `cmd_ensure` (in a unit); `cmd_supervise` (the unit's ExecStart), `cmd_swap`'s respawn, `cmd_attach`, `cmd_menu` and the server's Revive reach it through `cmd_ensure`; `cmd_enable` (granted `['enable']` on the agent, composed by the server) reaches it through `cmd_start` — after journalling `enable` (`_lc_done enable` runs first); `cmd_swap_self` through `cmd_swap`; and `_swap_refuse` through `_svc_start` (the unit's `supervise`, so `cmd_ensure` in its unit) or `cmd_ensure`. Only `cmd_ws_restore` took `$REG/.reap-<id>.lock`; none read `$REG/<id>.reaping`. `cmd_ws_add` honours a breadcrumb by construction: `_ws_slug_free` calls a slug taken while any `$REG/<id>.<field>` stands. And `cmd_start`, `cmd_ensure`, `cmd_swap` and `cmd_enable` each journal their act (`_lc_done start|ensure|swap|enable`) BEFORE they spawn — so a refusal at `_spawn_start` alone would still leave a `start`/`ensure`/`swap` row, which the §9 instrument pairs with the archive as a RETURN seven days or more after it: the very number the kill rule reads. Task 5 therefore refuses in the verbs, before their journal line, as well as at `_spawn_start` (the departure `return-verbs-refuse-before-they-journal`).
2. **Ruling (D), measured: no rung refused a live archived workspace.** With the presence call deleted from rung 5 (mutation row M3.4), a `cc-<id>` pane that is up with no client attached answers `expirable` with a token, and so does a running unit with no pane. `attached` asks tmux for CLIENTS only; `tree-busy` asks for a git operation or an index lock only; nothing reads the unit. `ws-reclaim` passes both by design (its tail kills the pane; a child is finished). Task 3 adds the question for an expiry only (the departure `expire-refuses-a-live-pane-or-unit`). What it asks is the PANE and the UNIT, never processes: a process whose cwd is the worktree, running outside the `cc-<id>` pane and outside the unit (an operator's own shell), is not seen — measured by the review lenses (a `sleep` with the worktree as its cwd and no pane: `expirable`), and stated as the departure's limit and Open question 3. Two more measurements shaped the rung: on Darwin, `_svc_is_active` answers `failed` from `$REG/<id>.svcfailed` before it asks launchd, and nothing that starts the job again clears that stamp, so a running job under a stale stamp passed as stopped (measured before the Darwin arm: `expirable` with a token for `state = running`); and keying the question on the flavour global let `_ws_expire_eval` called without it mint a token for a running unit (measured: `expirable`), so it is keyed on the binding (`_WS_LADDER_BIND[0] == mode=expire`) that `_ws_expire_eval` sets itself.
3. **The `_LC_ACTS` declaration census** (ruling F; child reclamation's contract names three declarations and four cardinals). Measured on this base: FOUR declarations — L0's `LifecycleAct` union with its total `LIFECYCLE_ACT_MAP`, ccd's `_LC_ACTS`, the PWA's total `ACT_WORD`, and the instrument's act lists (`RETURN_ACTS`, `ENDS_THE_ARCHIVE`, which nothing bound until Task 2) — plus the test-side `ALL_ACTS`; and FIVE cardinals: `lifecycle-acts.test.ts` twice (`ACTS.length` 26 → 27, and the `LC_ACT_UNKNOWN` case's `toHaveLength` 25 → 26, which the contract's count predates), `single-definition.test.ts` (26 → 27), `lifecycle-vocabulary.test.ts` (25 → 26), `ccd-lifecycle-emit.test.ts` (25 → 26).
4. **The instrument's three items** (wave 1's review 225). Its act lists named eleven of ccd's twenty-six acts; `reclaim`, `gc`, `rename` and `rehome` were in neither. Task 2 classifies every act exactly once — a return, an end, `archive`, or a third list, `NEUTRAL_ACTS` — and a test runs ccd's array in a fixture HOME and reds on any act without a place (the departure `instrument-classifies-every-act`; `reclaim` ends an archive too). The server's close-time rule is `persistedInt` over `CAST(closedAt AS TEXT)` (positive safe integer, else doubt); the instrument now reads the same cast through `close_time`, and row S38's anchor line is kept byte for byte. The `-wal` file: measured, a writing connection's CLEAN close folds its write into the main file and deletes the WAL even while the fixture's own connection is open (so the old main-file pin did red a writer that closes); a writer that dies before its close leaves its frames in `-wal` and the main file byte-identical, which only the new `-wal` comparison reds (row T2.7). An absent `-wal` and an empty one are the same: no frame.
5. **The citation census.** README cites no `ccd/ccd` line; the frozen corpus's highest `ccd/ccd` anchor is `:19131`; every ccd edit above it is line-neutral (Global Constraints). The five citation cases: red only in Task 2's green stage before its README repair (`2 failed | 3 passed | 330 skipped (335)`: the README anchors moved by `shared/api.ts`'s four new lines, and the debt census through them); `5 passed | 330 skipped (335)` at the end of every task.
6. **`ws-reclaim` sits behind a direct-entry boundary this plan must extend** (the departure `ws-expire-crosses-the-direct-entry-boundary`). Since reclaim-entry-safety, `ccd/ccd-entry.py` (rendered to `~/.local/bin/ccd`) starts `ws-reclaim <any tail>` and `ws-audit --session <v> --reclaim [--defer-expired]` under `bash -p`, and the body re-checks the same shapes at its first line. The spec predates it. `ws-expire` and `ws-audit --session <v> --expire` (exactly four tokens) join both classifiers in Task 7, and the one grammar table (`ccd-child-reclaim-entry.test.ts`) runs the new rows against both.
7. **The words.** The expiry answers eighteen words, by the kind wave 3b's lane will give them: GONE — `no-such-session`, `not-archived`; TERMINAL — `not-a-workspace`, `branch-elsewhere`, `tree-unreadable`, `containment-unproven`, `no-worktree-record`; RETRY — `not-expired`, `child`, `paused`, `held`, `attached`, `live`, `tree-busy`, `state-changed`, `in-progress`, `reap-in-progress`, `reclaim-in-progress`. Four are new to ccd and get `SENTENCES` copy: `not-expired`, `child`, `live` (Task 3) and `expire-in-progress` (ws-reap's refusal, Task 4). `not-archived` is ws-reap's word and keeps its sentence.
8. **`cmd_caps`' verb list is a heredoc above `:19131`** — a line there moves every frozen anchor. So `ws-expire` is echoed on the capability line beside `expire-v1` (`ccd-archive.test.ts` compares the advertised verbs to the dispatcher's as SETS); the departure `caps-names-the-verb-on-its-token-line`.
9. **`ws-audit --expire` is its own document**, not the plain audit's thirty keys plus a mode (the reclaim audit's shape): `cmd_ws_audit` sits above `:19131`, so its only change is a hand-off on its existing `if` line and its usage text, and the mode is answered whole in the EXPIRE region — contained, as the reclaim audit is (Task 6 pins no hook runs and the index is not rewritten). The departure `expire-audit-is-its-own-document`.
10. **The tombstone and the journal.** `ws-expire` writes the RECLAIM machinery's tombstone with `"mode":"expire"` and `"archivedAt":<epoch>` where a reclaim writes `"mode":"reclaim","childOf":<run>`; its journal rows are act `expire`, verb `ws-expire`, and carry the epoch as the EXISTING `meas.archivedAt` (no new `meas.` key, so `ccd-lifecycle-contain`'s key census does not move); its done document is `{"expired":<id>,"archivedAt":<epoch>,"wip","attic","residueBytes","secretsDropped"}`.
11. **The shared machinery is a reclaim's, unchanged.** A reclaim's `_WS_LADDER_BIND` is the four inputs its token always led with, in the same order, so every reclaim token is byte-identical; every reclaim output (tombstone, done document, journal rows, failure details) is byte-identical under `_WS_RCL_ACT=reclaim`. Measured on the prototype's tree: `ccd-child-reclaim-ladder` 145, `-pin` 74, `-verb` 70, `-verb-tail` 74, `-verb-reflogs` 49, `-hardening` 98, `-audit` 23, `-pause` 13, `-entry` 100 + 1 skipped, `child-reclaim` 128 — all passed. Two child-reclamation pins name what moved: rung 3's pause reader now lives in `_ws_reclaim_ladder` (`ccd-child-reclaim-pause.test.ts`), and the audit's usage line names its second mode (`ccd-child-reclaim-audit.test.ts`, and the entry grammar's `USAGE`).
12. **The flavour fork.** The coordinator's (E) and (I) read "ws-reap's resume fork gains the `expire:` arm, re-asserting the archive epoch" and "a crash at each phase resumes through ws-reap's `expire:` arm". The spec (§5.3, §6 item 4) has ws-reap's fork gain an `expire:` arm as a SECOND addition beside wave 3's `reclaim:` mirror, and gives the resume that re-asserts the epoch to the `expire:` flavour itself; child reclamation's carried constraint 5 is that no verb finishes another's interrupted work. This plan builds ws-reap's arm as a refusal (`expire-in-progress`) and the epoch-re-asserting resume inside `ws-expire` — Open question 1 asks the operator to confirm the reading (the departure `ws-reap-refuses-the-expire-breadcrumb`), and dispatch waits on that ruling (the callout at the top).
13. **Where `TMPDIR` may stand.** A fixture HOME inside a git checkout nests every fixture repository inside the outer one: measured with `TMPDIR` under this worktree, `ccd-child-reclaim-ladder.test.ts` reds `refuses no-worktree-record … for a directory that EXISTS but git does not record` (`containment-unproven` — git found the outer repository), `1 failed | 144 passed (145)`; with `TMPDIR` on the volume outside any checkout, `145 passed (145)`. Global Constraints' scratch rule follows from it.
14. **The temp root an expiry's tail removes.** The shared tail's artifacts step removes `$HOME/.cc-tmp/<id>` (under its two containment re-checks) and records nothing of it. `TMPDIR` is composed for a CHILD only (`_child_tmpdir` answers 1 for a row whose marker does not read as a run id), the marker is written once, at `ws-add --child`, and removed only with the row, and rung 2′ refuses any row that carries one. So whatever stands at `~/.cc-tmp/<id>` when an expiry runs was left by a PREVIOUS row under the same recycled slug — a child that a verb other than `ws-reclaim` removed, which never collects its temp root (the leak child reclamation wave 5's temp-root collector, R36, owns). The departure `expire-collects-a-leftover-temp-root` records it.

## How to read the blocks

Each edit is a block headed by an HTML comment, `<!-- replay: T<task> <create|replace> <path> -->`. A **replace** shows the text to find — it occurs exactly once in the file at that point of the plan — and the text that replaces it; a **create** shows a whole new file. A block's text is the lines between its fences; it ends with a newline unless the comment says `old-inline` (the Find) or `new-inline` (the Replace), which mark a fragment inside a line. Apply the blocks in the order given: Step 1 of each task holds its test edits (the red stage), Step 3 its source edits (the green stage), Step 5 its taxes where it has them. The planner's replay check applies exactly these blocks to `b40f4145`, re-stamps `ccd/ccd` after each stage, and reproduces every stage of the prototype byte for byte.

---

### Task 1: Wave 2's residue — review 244, F1 to F3

**Model routing:** `sonnet`, effort `high` — a one-line reader change, two route pins and three texts; the review report is the specification (`~/.cc-clips/ccrc-pwa-still-canyon/review-244-53f31389.md`).

**Files:** red `server/test/archive-door.test.ts`, `server/test/livestate.test.ts`; green `docs/superpowers/plans/2026-10-01-workspace-lifecycle-wave2-one-archive.md`, `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, `server/src/coord/archiveDoor.ts`, `server/src/livestate.ts`.

**Interfaces:**
- Changes: `readLiveStateMeasured`'s `state.status` (and so `readLiveState`'s) is the file's top-level `status` when it is a string, else `''` (was `String(raw.status ?? '')`). That reaches EVERY live-state reader, not the archive door alone: the board (`fleet.ts`, both reads), the session socket (`sessionws.ts`), the mail gate (`watch.ts`'s `readLiveState` answer, judged by `turnidle.ts`'s `mailTurnIdle`), the stall watch's live read (`watch.ts`'s `stallLiveRead`, judged by `coord/stall.ts`), `commands.ts` (which reads `cwd` only) and the archive door (`server.ts` → `stopVerdict`). Each already reads `''` conservatively — work on the board and the socket (`liveSessionStatus`), `not-idle` at the mail gate (no delivery), a held `unmeasured` in the stall watch's wave-2 ladder, unmeasured at the door (`stopVerdict`'s `STATUS_WORD`) — so only a malformed status whose `String()` spelled a word changes reading anywhere: `["idle"]` was idle (a delivery, a stop), `true` was busy.
- Produces: no new name. Pins F2's ruled behaviour (a main checkout under an unrostered wrapper, its pane GONE, is `409 status-unknown` with and without `interrupt`) where no test pinned it.

- [ ] **Step 0: Install each package's own modules**

```bash
( cd server && npm ci ) && ( cd agent && npm ci ) && ( cd pwa && npm ci )
```

- [ ] **Step 1: Write the failing tests.**

<!-- replay: T1 replace server/test/archive-door.test.ts -->
In `server/test/archive-door.test.ts`, find:

````ts
    liveNoStatus(b.home);
    expect((await post(b.app, 'claude-a-demo')).json()).toEqual({ ok: false, error: 'status-unknown' });
````

Replace with:

````ts
    liveNoStatus(b.home);
    expect((await post(b.app, 'claude-a-demo')).json()).toEqual({ ok: false, error: 'status-unknown' });
    expect((await post(b.app, 'claude-a-demo', { interrupt: true })).json()).toEqual({ ok: false, error: 'status-unknown' });
    expect(b.ccd()).toEqual([]);
  });

  // Review 244, F1: ccd's grep finds no `"status":"<word>"` in a status that is not a string, so `_ws_status` cannot
  // read it. The parsed value used to be String()-ed first — `["idle"]` stopped the pane as idle (fail OPEN), `true`
  // read as a busy turn the operator could consent to lose. Both are unmeasured now: the reader keeps strings only.
  it.each([
    ['an array holding "idle"', ['idle']],
    ['a boolean', true],
  ] as const)('a live file whose `status` is %s is unmeasured: 409 status-unknown, with and without `interrupt`, no verb', async (_why, status) => {
    const b = await box();
    seed(b.home, 'claude-a-demo', { workspace: null });
    const dir = path.join(b.home, '.claude-a', 'sessions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${PANE}.json`), JSON.stringify({ pid: PANE, sessionId: 'u', status }));
    expect((await post(b.app, 'claude-a-demo')).json()).toEqual({ ok: false, error: 'status-unknown' });
    expect((await post(b.app, 'claude-a-demo', { interrupt: true })).json()).toEqual({ ok: false, error: 'status-unknown' });
    expect(b.ccd()).toEqual([]);
  });

  // Review 244, F2, ruled: the config dir is read FIRST for both kinds of row — ccd's `_ws_status` order — so a main
  // checkout whose registry wrapper the roster no longer knows is unmeasured even when tmux proves its pane GONE. It
  // fails closed: no verb runs, and "Stop only" (`/stop`, which reads no verdict) remains the way to put it down.
  it('a GONE main checkout whose wrapper has no config dir is unmeasured: 409 status-unknown, with and without `interrupt`, no verb', async () => {
    const b = await box({ alive: false });
    seed(b.home, 'claude-a-demo', { workspace: null });
    writeFileSync(path.join(b.home, '.cc-sessions', 'claude-a-demo.wrapper'), 'claude-unrostered');
    expect((await post(b.app, 'claude-a-demo')).json()).toEqual({ ok: false, error: 'status-unknown' });
````

<!-- replay: T1 replace server/test/livestate.test.ts -->
In `server/test/livestate.test.ts`, find:

````ts
    expect(liveSessionStatus(live!.status)).toBe('busy');
  });
````

Replace with:

````ts
    expect(liveSessionStatus(live!.status)).toBe('busy');
  });

  // Review 244, F1 (workspace lifecycle wave 3): `String(raw.status ?? '')` turned a status that is not a string into
  // one — `["idle"]` into `'idle'`, `true` into `'true'` — so the archive door's fail-closed read (`stopVerdict`) took
  // an array for an idle pane and stopped it. ccd's `_ws_status` greps the raw bytes for `"status":"<word>"` and finds
  // nothing in either. A status that is not a string is no status: `''`, which every reader already reads as work.
  it('a `status` that is not a string reads as no status (`\'\'`) — never as the word its String() spells', async () => {
    for (const status of [['idle'], true, 0, { idle: 1 }, null]) {
      const { configDir, pid } = seedLive({ ...base, status });
      const live = await readLiveStateMeasured(localIO, configDir, pid);
      expect(live.ok, JSON.stringify(status)).toBe(true);
      expect(live.ok && live.state.status, JSON.stringify(status)).toBe('');
    }
  });
````


- [ ] **Step 2: Run them — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/livestate.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archive-door.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archive-door-decide.test.ts --maxWorkers=1 )
```

Measured:

- `server/test/livestate.test.ts`: `1 failed | 23 passed (24)`
  - × a `status` that is not a string reads as no status (`''`) — never as the word its String() spells
- `server/test/archive-door.test.ts`: `2 failed | 49 passed (51)`
  - × a live file whose `status` is an array holding "idle" is unmeasured: 409 status-unknown, with and without `interrupt`, no verb
  - × a live file whose `status` is a boolean is unmeasured: 409 status-unknown, with and without `interrupt`, no verb
- `server/test/archive-door-decide.test.ts`: `57 passed (57)`

The F2 pin (`a GONE main checkout whose wrapper has no config dir is unmeasured`) is GREEN here by design: it pins the behaviour review 244 found and the coordinator ruled to keep. Row T1.2 is its red.

- [ ] **Step 3: Make them pass, and write the three texts.** F1's check lands in the reader (`livestate.ts`), not inside `stopVerdict`: `stopVerdict` receives `read.state.status`, which the reader had already passed through `String()`, so a check inside it could not see the type — the departure `wave2-residue-string-status-at-the-reader`. F1's remaining limit (a non-compact file — `"status": "idle"` — reads `idle` here and nothing to ccd's grep) and F3's second stricter arm (a present-but-malformed live file is `no-state` here, while ccd's grep may read a word from it) are named in `stopVerdict`'s docstring, in the spec's §5.2 step 1 and in wave 2's 3881 entry; F2's consequence for a main checkout is named in the docstring and the 3881 entry.

<!-- replay: T1 replace docs/superpowers/plans/2026-10-01-workspace-lifecycle-wave2-one-archive.md old-inline new-inline -->
In `docs/superpowers/plans/2026-10-01-workspace-lifecycle-wave2-one-archive.md`, find (a fragment — its text ends without a newline):

````markdown
the `interrupt` path under this same entry.
````

Replace with:

````markdown
the `interrupt` path under this same entry. Three limits of it, stated by workspace-lifecycle wave 3's first commit (review 244): (1) the status word is read from the PARSED file, not by ccd's grep — a `status` that is not a string is now no word at all (`livestate.ts` keeps strings only, so `["idle"]` and `true` are unmeasured), but a file that is not compact JSON (`"status": "idle"`, a space after the colon) still reads `idle` here while ccd's grep extracts nothing, and a nested `"status"` ahead of the top-level key is what ccd's `head -1` would read; review 244 counted 40 of 40 live files compact, and no writer is seen to produce either shape; (2) reading the config dir first applies to a MAIN CHECKOUT too, which never reaches `_ws_status`: one whose registry wrapper the roster does not know, whose pane tmux proves gone, is refused `409 status-unknown` where it used to be stopped — it fails closed, "Stop only" remains, and `archive-door.test.ts` pins it; (3) a live file that is PRESENT but malformed (not JSON, or no string `sessionId`) is `no-state` to `readLiveStateMeasured` and so unmeasured here, while ccd's grep may still read a word from it — the server's second stricter arm, beside the missing frame row.
````

<!-- replay: T1 replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find:

````markdown
     pid, an absent or unreadable live file, a status word `_ws_status` could not extract, and, the server's own
     stricter arm, a missing frame row. Without `interrupt:true` it is re-read at the stop, so a turn begun during
````

Replace with:

````markdown
     pid, an absent or unreadable live file, a status word `_ws_status` could not extract, and the server's own two
     stricter arms: a missing frame row, and a live file that is present but malformed (not JSON, or no string
     `sessionId`), from which ccd's grep may still read a word. The word is read from the PARSED file, and a `status`
     that is not a string is no word; a file that is not compact JSON (`"status": "idle"`) still diverges from ccd's
     grep, which no observed writer produces. Without `interrupt:true` it is re-read at the stop, so a turn begun during
````

<!-- replay: T1 replace server/src/coord/archiveDoor.ts -->
In `server/src/coord/archiveDoor.ts`, find:

````ts
 * `idle` is `busy`). One arm is the SERVER'S OWN and stricter than ccd, which reads no frame row at all: a missing
 * frame row is `unmeasured` (no row is no measurement). Folding these into `busy` told an operator "it is working",
````

Replace with:

````ts
 * `idle` is `busy`). The word is the PARSED file's top-level `status`, and only a string is a word: a `status` that is
 * not one is `''` (`readLiveStateMeasured`), which ccd's grep cannot extract either (review 244, F1). That is ccd's
 * answer only for compact JSON: a spaced `"status": "idle"` reads `idle` here and nothing to ccd's grep, and a nested
 * `"status"` ahead of the top-level key is the one ccd's `head -1` takes — shapes no observed writer produces. Two arms
 * are the SERVER'S OWN and stricter than ccd: a missing frame row is `unmeasured` (no row is no measurement; ccd reads
 * none), and so is a live file that is PRESENT but malformed — not JSON, or no string `sessionId` — which
 * `readLiveStateMeasured` answers `no-state` while ccd's grep may still read a word from it (review 244, F3). And the
 * config dir is read first for BOTH kinds of row: a main checkout whose wrapper the roster does not know is unmeasured
 * even with its pane proven gone, though `cmd_stop` reads no status at all (review 244, F2, ruled: it fails closed, and
 * "Stop only" remains). Folding these into `busy` told an operator "it is working",
````

<!-- replay: T1 replace server/src/livestate.ts -->
In `server/src/livestate.ts`, find:

````ts
        status: String(raw.status ?? ''),
````

Replace with:

````ts
        // A STRING OR NOTHING (review 244, F1): `String(…)` spelled `["idle"]`
        // as `'idle'` and `true` as `'true'`, and the archive door's fail-closed
        // read (`stopVerdict`) stopped the first as an idle pane. ccd's
        // `_ws_status` greps the bytes for `"status":"<word>"` and reads neither.
        status: typeof raw.status === 'string' ? raw.status : '',
````


- [ ] **Step 4: Run — green.**

```bash
( cd server && ./node_modules/.bin/vitest run test/livestate.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archive-door.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/archive-door-decide.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/fleet.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/turnidle.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/sessionws.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/stall-session.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/commands.test.ts --maxWorkers=1 )
```

Measured (the last four are the other readers the reader change reaches):

- `server/test/livestate.test.ts`: `24 passed (24)`
- `server/test/archive-door.test.ts`: `51 passed (51)`
- `server/test/archive-door-decide.test.ts`: `57 passed (57)`
- `server/test/fleet.test.ts`: `94 passed (94)`
- `server/test/turnidle.test.ts`: `54 passed (54)`
- `server/test/sessionws.test.ts`: `68 passed (68)`
- `server/test/stall-session.test.ts`: `93 passed (93)`
- `server/test/commands.test.ts`: `5 passed (5)`

- [ ] **Step 5: Mutation check, then commit.**

| # | Edit (restore after; re-stamp after a `ccd/ccd` edit) | Measured red |
|---|---|---|
| T1.1 | `livestate.ts`: the reader String()s the status again. `server/src/livestate.ts`: `status: typeof raw.status === 'string' ? raw.status : '',` → `status: String(raw.status ?? ''),` | `server/test/livestate.test.ts`: 1 failed \| 23 passed (24) — red: a `status` that is not a string reads as no status (`''`) — never as the word its String() spells<br>`server/test/archive-door.test.ts`: 2 failed \| 49 passed (51) — red: a live file whose `status` is an array holding "idle" is unmeasured: 409 status-unknown, with and without `interrupt`, no verb (+1 more) |
| T1.2 | `server.ts`: a gone pane is idle before the config dir is read (the order review 243 F2 replaced). `server/src/server.ts`: `if (cfgDir === undefined) return stopVerdict({ configDir: 'none' });` → `if (cfgDir === undefined) return (await deps.tmux.sessionVerdict(rec.id)).verdict === 'gone' ? 'idle' : stopVerdict({ configDir: 'none' });` | `server/test/archive-door.test.ts`: 3 failed \| 48 passed (51) — red: a GONE main checkout whose wrapper has no config dir is unmeasured: 409 status-unknown, with and without `interrupt`, no verb (+2 more) |

```bash
git add server/src/livestate.ts server/src/coord/archiveDoor.ts server/test/livestate.test.ts server/test/archive-door.test.ts \
  docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md docs/superpowers/plans/2026-10-01-workspace-lifecycle-wave2-one-archive.md
git commit -m "$(cat <<'MSG'
fix(archive): wave 2's residue — a status that is not a string is no word (review 244)

F1: readLiveStateMeasured keeps a string status only, so ["idle"] and true are
unmeasured at the archive door's fail-closed read, as ccd's grep reads them;
the parsed-value limit (a non-compact file) is named in stopVerdict, the spec
and wave 2's 3881 entry. F2: the main-checkout consequence of reading the
config dir first is stated and pinned. F3: the present-but-malformed live file
is named as the server's second stricter arm.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: The `expire` act, and the instrument bound to ccd's acts

**Model routing:** `sonnet`, effort `medium` — a vocabulary widening with its five cardinals, and three instrument items whose tests are given.

**Files:** red `server/test/ccd-lifecycle-emit.test.ts`, `server/test/lifecycle-acts.test.ts`, `server/test/lifecycle-vocabulary.test.ts`, `server/test/measure-workspace-lifecycle.test.ts`, `server/test/single-definition.test.ts`; green `ccd/ccd`, `deploy/measure-workspace-lifecycle.py`, `pwa/src/session/journalWords.ts`, `shared/api.ts`; tax `README.md`.

**Interfaces:**
- Produces: `'expire'` in `LifecycleAct`, `LIFECYCLE_ACT_MAP`, ccd's `_LC_ACTS` (alphabetical: `ensure expire forget`) and `ACT_WORD` (`expired`). Tasks 3–6 emit `_lc_intent|_lc_done|_lc_fail|_lc_emit expire …`; without this task each row would degrade to `act: unknown` with `badact: expire`.
- Produces: `deploy/measure-workspace-lifecycle.py`'s `NEUTRAL_ACTS` and `close_time(text)`; `ENDS_THE_ARCHIVE` gains `expire` and `reclaim` in the same commit as `_LC_ACTS` gains `expire`.

- [ ] **Step 1: Write the failing tests.** The binding test runs ccd's own array in a fixture HOME (`makeCcdHarness`), never a regex over its text.

<!-- replay: T2 replace server/test/ccd-lifecycle-emit.test.ts -->
In `server/test/ccd-lifecycle-emit.test.ts`, find:

````ts
    expect(want.length, 'guards the guard: an empty want passes everything').toBe(25);
````

Replace with:

````ts
    expect(want.length, 'guards the guard: an empty want passes everything').toBe(26);
````

<!-- replay: T2 replace server/test/ccd-lifecycle-emit.test.ts -->
In `server/test/ccd-lifecycle-emit.test.ts`, find:

````ts
    expect(ev.map((e) => e['act'])).toEqual(['reclaim']);
    expect(ev[0]!['badact']).toBeUndefined();
````

Replace with:

````ts
    expect(ev.map((e) => e['act'])).toEqual(['reclaim']);
    expect(ev[0]!['badact']).toBeUndefined();
  });

  it('journals `expire` as ITSELF — never the unknown degrade with a badact (workspace lifecycle, wave 3)', () => {
    // The act `ws-expire` writes (spec 2026-09-24 §5.3): an archived workspace's
    // pin-then-teardown, seven days after its archive. Its own act, never
    // `reclaim`'s: stage 4's crash clause reads a deliberate removal by act word.
    h.sh(`${NO_TMUX} _lc_emit expire done demo-quiet-basin "" verb ws-expire`);
    const ev = readJournal(h.home).filter((e) => e['id'] === 'demo-quiet-basin');
    expect(ev.map((e) => e['act'])).toEqual(['expire']);
    expect(ev[0]!['badact']).toBeUndefined();
````

<!-- replay: T2 replace server/test/lifecycle-acts.test.ts -->
In `server/test/lifecycle-acts.test.ts`, find:

````ts
  'attic-drop': true, reap: true, reclaim: true, rehome: true, gc: true, spawn: true, route: true, start: true, ensure: true,
````

Replace with:

````ts
  'attic-drop': true, reap: true, reclaim: true, expire: true, rehome: true, gc: true, spawn: true, route: true, start: true, ensure: true,
````

<!-- replay: T2 replace server/test/lifecycle-acts.test.ts -->
In `server/test/lifecycle-acts.test.ts`, find:

````ts
    expect(ACTS.length).toBe(26);
````

Replace with:

````ts
    expect(ACTS.length).toBe(27);
````

<!-- replay: T2 replace server/test/lifecycle-acts.test.ts -->
In `server/test/lifecycle-acts.test.ts`, find:

````ts
    expect(LIFECYCLE_ACTS.filter((a) => a !== LC_ACT_UNKNOWN)).toHaveLength(25);
````

Replace with:

````ts
    expect(LIFECYCLE_ACTS.filter((a) => a !== LC_ACT_UNKNOWN)).toHaveLength(26);
````

<!-- replay: T2 replace server/test/lifecycle-vocabulary.test.ts -->
In `server/test/lifecycle-vocabulary.test.ts`, find:

````ts
    expect.soft(want.length, 'guards the guard: an empty want passes everything (25 = 23 + unarchive, the archive stamp a spawn clears, + reclaim, a child’s pin-then-teardown)').toBe(25);
````

Replace with:

````ts
    expect.soft(want.length, 'guards the guard: an empty want passes everything (26 = 23 + unarchive, the archive stamp a spawn clears, + reclaim, a child’s pin-then-teardown, + expire, an archived workspace’s)').toBe(26);
````

<!-- replay: T2 replace server/test/measure-workspace-lifecycle.test.ts -->
In `server/test/measure-workspace-lifecycle.test.ts`, find:

````ts
import { readFileSync, statSync, writeFileSync } from 'node:fs';
````

Replace with:

````ts
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
````

<!-- replay: T2 replace server/test/measure-workspace-lifecycle.test.ts -->
In `server/test/measure-workspace-lifecycle.test.ts`, find:

````ts
import { mkTmp } from './tmpHelpers.js';

````

Replace with:

````ts
import { mkTmp } from './tmpHelpers.js';
import { makeCcdHarness } from './ccdWsHelpers.js';

````

<!-- replay: T2 replace server/test/measure-workspace-lifecycle.test.ts -->
In `server/test/measure-workspace-lifecycle.test.ts`, find:

````ts
    expect(m![1]!.split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean)).toEqual([...TERMINAL_RUN_STATES]);
  });
````

Replace with:

````ts
    expect(m![1]!.split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean)).toEqual([...TERMINAL_RUN_STATES]);
  });

  // Review 225, F4 / wave 3's first instrument item: the archive→return pairing reads ccd's journal acts by NAME, so
  // its lists are a second spelling of `_LC_ACTS`. Every act ccd can journal is classified EXACTLY ONCE — a return,
  // an end, `archive` itself, or neither — so an act added to ccd without a place here reds (wave 3 adds `expire`,
  // a removal that ends an archive). ccd's array is read EXECUTED, in a fixture HOME, never by a regex over its text.
  it('its act lists classify every one of ccd\u2019s `_LC_ACTS` exactly once — the second spelling is bound to the first', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    const tuple = (name: string): string[] => {
      const m = new RegExp(`^${name} = \\(([^)]*)\\)`, 'm').exec(src);
      expect(m, name).not.toBeNull();
      return m![1]!.split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
    };
    const classified = [...tuple('RETURN_ACTS'), ...tuple('ENDS_THE_ARCHIVE'), ...tuple('NEUTRAL_ACTS'), 'archive'];
    expect(new Set(classified).size, 'no act is classified twice').toBe(classified.length);
    const h = makeCcdHarness('ccrc-measure-acts-');
    try {
      const acts = h.sh('printf \'%s\\n\' "${_LC_ACTS[@]}"').split('\n').map((l) => l.trim()).filter(Boolean);
      expect(acts.length, 'guards the guard: ccd answered its array').toBeGreaterThan(20);
      expect([...classified].sort()).toEqual([...acts].sort());
      expect(tuple('ENDS_THE_ARCHIVE'), 'ws-expire removes an archived workspace: it ends the archive').toContain('expire');
    } finally { h.cleanup(); }
  });
````

<!-- replay: T2 replace server/test/measure-workspace-lifecycle.test.ts -->
In `server/test/measure-workspace-lifecycle.test.ts`, find:

````ts

  it('refuses a missing database without creating one, and never writes the one it reads', () => {
````

Replace with:

````ts

  // Review 225, F4 / wave 3's second instrument item: the server reads the close time through `persistedInt`
  // (`lastRunBySession`, store.ts) — CAST to text, and doubt unless it is a positive safe integer. NULL was the
  // instrument's only doubt; zero, a negative, a fraction and a word are doubt too, and a row the server would not
  // call released is not one the instrument counts. `1_000` is Python's float() spelling and NaN to the server's
  // Number(), so it is doubt in both. (JavaScript's radix spellings are the one stated divergence: see `close_time`.)
  it('a non-positive or non-integer close time is doubt too, as the server reads it — never a release', () => {
    const f = fixture();
    const bad: Record<string, unknown> = { zero: 0, negative: -5, fraction: 1.5, word: 'soon', underscore: '1_000' };
    for (const [id, closedAt] of Object.entries(bad)) {
      f.closed(id);
      f.db.prepare('UPDATE runs SET closedAt = ? WHERE sessionId = ?').run(closedAt as never, id);
    }
    f.closed('good');
    const cache = writeCache(f.home, [...Object.keys(bad), 'good'].map((id) => row(id)));
    const o = rows(run(['--db', f.dbPath, '--cache', cache, '--now', String(NOW_S)]).stdout);
    expect(o['released_computed'], 'only the row with a real close time').toBe('1');
  });

  it('refuses a missing database without creating one, and never writes the one it reads', () => {
````

<!-- replay: T2 replace server/test/measure-workspace-lifecycle.test.ts -->
In `server/test/measure-workspace-lifecycle.test.ts`, find:

````ts
    const before = readFileSync(f.dbPath);
    expect(run(['--db', f.dbPath, '--cache', cache, '--now', String(NOW_S)]).status).toBe(0);
    expect(readFileSync(f.dbPath).equals(before)).toBe(true);
````

Replace with:

````ts
    // THE WAL TOO (review 225, R1; wave 3's third instrument item). A write reaches the main file only when its
    // connection checkpoints, which a clean close does (measured: the WAL is folded in and deleted even while this
    // fixture's connection is open) and a process that dies before its close does not: its frames stay in `-wal` and
    // the main file is byte-identical, so comparing the main file alone is green on that writing instrument. Both files
    // are compared. An ABSENT `-wal` and an EMPTY one hold the same thing, no frame: opening a WAL database with no `-wal`
    // yet creates an empty one (the script's header says so — SQLite's side effect, not a write), so both read `''`.
    const wal = (): string => (existsSync(`${f.dbPath}-wal`) ? readFileSync(`${f.dbPath}-wal`).toString('base64') : '');
    const before = readFileSync(f.dbPath);
    const walBefore = wal();
    expect(run(['--db', f.dbPath, '--cache', cache, '--now', String(NOW_S)]).status).toBe(0);
    expect(readFileSync(f.dbPath).equals(before)).toBe(true);
    expect(wal(), 'the -wal file is unchanged: no write landed there either').toBe(walBefore);
````

<!-- replay: T2 replace server/test/single-definition.test.ts -->
In `server/test/single-definition.test.ts`, find:

````ts
    expect(LIFECYCLE_ACTS.length).toBe(26);
````

Replace with:

````ts
    expect(LIFECYCLE_ACTS.length).toBe(27);
````


- [ ] **Step 2: Run them — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/lifecycle-acts.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/lifecycle-vocabulary.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-lifecycle-emit.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/measure-workspace-lifecycle.test.ts --maxWorkers=1 )
```

Measured:

- `server/test/lifecycle-acts.test.ts`: `3 failed | 36 passed (39)`
  - × expire
  - × covers the whole union — the runtime list cannot fall behind the type
  - × is a declared member, and LC_ACT_UNKNOWN names it once
- `server/test/single-definition.test.ts`: `1 failed | 273 passed (274)`
  - × and the act scan is looking at something — guards the guard
- `server/test/lifecycle-vocabulary.test.ts`: `1 failed | 8 passed (9)`
  - × _LC_ACTS is exactly LIFECYCLE_ACTS minus the reader's degrade
- `server/test/ccd-lifecycle-emit.test.ts`: `2 failed | 57 passed (59)`
  - × is set-equal to LIFECYCLE_ACTS minus the degrade name, BOTH directions
  - × journals `expire` as ITSELF — never the unknown degrade with a badact (workspace lifecycle, wave 3)
- `server/test/measure-workspace-lifecycle.test.ts`: `2 failed | 9 passed (11)`
  - × its act lists classify every one of ccd’s `_LC_ACTS` exactly once — the second spelling is bound to the first
  - × a non-positive or non-integer close time is doubt too, as the server reads it — never a release

- [ ] **Step 3: Add the act to its declarations, and fix the instrument.**

<!-- replay: T2 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
_LC_ACTS=(archive attic-drop claim create destroy enable ensure forget gc
````

Replace with:

````bash
_LC_ACTS=(archive attic-drop claim create destroy enable ensure expire forget gc
````

<!-- replay: T2 replace deploy/measure-workspace-lifecycle.py -->
In `deploy/measure-workspace-lifecycle.py`, find:

````python
                              archive restarts the clock; a removal or a re-creation (destroy purge reap forget create)
                              ends it
````

Replace with:

````python
                              archive restarts the clock; a removal or a re-creation (destroy purge reap forget create
                              expire reclaim) ends it
````

<!-- replay: T2 replace deploy/measure-workspace-lifecycle.py -->
In `deploy/measure-workspace-lifecycle.py`, find:

````python
# ccd's `_LC_ACTS` members that END an archive without returning from it: a removal, or a new workspace created
# under the same id (a reused slug). What follows either is a new workspace's life, never a return.
ENDS_THE_ARCHIVE = ('destroy', 'purge', 'reap', 'forget', 'create')
````

Replace with:

````python
# ccd's `_LC_ACTS` members that END an archive without returning from it: a removal (`expire` and `reclaim` among
# them — the server's two teardowns), or a new workspace created under the same id (a reused slug). What follows
# either is a new workspace's life, never a return.
ENDS_THE_ARCHIVE = ('destroy', 'purge', 'reap', 'forget', 'create', 'expire', 'reclaim')
# ccd's `_LC_ACTS` members that neither return from an archive nor end it. With `archive` itself, the three lists
# classify every act exactly once — measure-workspace-lifecycle.test.ts runs ccd's array and reds on an act that has
# no place here, so a new act is decided, never silently ignored.
NEUTRAL_ACTS = ('attic-drop', 'claim', 'enable', 'gc', 'hold', 'release', 'rename', 'rehome', 'route', 'stop',
                'supervise', 'unsupervise')
````

<!-- replay: T2 replace deploy/measure-workspace-lifecycle.py -->
In `deploy/measure-workspace-lifecycle.py`, find:

````python

def released_computed(sessions, runs):
````

Replace with:

````python

def close_time(text):
    """The server's rule for a close time (`persistedInt` in `lastRunBySession`, server/src/coord/store.ts): the column
    CAST to text, read as a number, is a positive safe integer — anything else (NULL, zero, a negative, a fraction, a
    word) is doubt, None. The SAME answer for every text CAST makes of an INTEGER or REAL value, and for decimal TEXT;
    `_` is refused because Python's float() reads `1_000` and JavaScript's Number() does not. One divergence is left,
    stated: a hand-written TEXT value in JavaScript's own radix spellings (`0x10`, `0b1`, `0o7`) is a number to the
    server and doubt here — no writer produces one (the server writes closedAt as an integer)."""
    if text is None or '_' in text:
        return None
    try:
        v = float(text)
    except ValueError:
        return None
    return int(v) if v.is_integer() and 1 <= v <= 2 ** 53 - 1 else None


def released_computed(sessions, runs):
````

<!-- replay: T2 replace deploy/measure-workspace-lifecycle.py -->
In `deploy/measure-workspace-lifecycle.py`, find:

````python
            newest[sid] = (rid, state, closed)
````

Replace with:

````python
            newest[sid] = (rid, state, close_time(closed))
````

<!-- replay: T2 replace deploy/measure-workspace-lifecycle.py -->
In `deploy/measure-workspace-lifecycle.py`, find:

````python
        runs = db.execute('SELECT id, sessionId, state, claimedBy, closedAt FROM runs').fetchall()
````

Replace with:

````python
        runs = db.execute('SELECT id, sessionId, state, claimedBy, CAST(closedAt AS TEXT) FROM runs').fetchall()
````

<!-- replay: T2 replace pwa/src/session/journalWords.ts -->
In `pwa/src/session/journalWords.ts`, find:

````ts
  reap: 'reaped', reclaim: 'reclaimed', rehome: 'home account moved', gc: 'gc pass', spawn: 'respawned', route: 'routing written', start: 'started',
````

Replace with:

````ts
  reap: 'reaped', reclaim: 'reclaimed', expire: 'expired', rehome: 'home account moved', gc: 'gc pass', spawn: 'respawned', route: 'routing written', start: 'started',
````

<!-- replay: T2 replace shared/api.ts -->
In `shared/api.ts`, find:

````ts
                    // filter to tell the two apart.
  | 'rehome'        // A session's HOME account moving. TWO EMITTERS, both
````

Replace with:

````ts
                    // filter to tell the two apart.
  | 'expire'        // ws-expire (spec 2026-09-24 §5.3): an ARCHIVED workspace's pin-then-
                    // teardown, server-composed seven days after its archive. Its own act,
                    // never `reclaim`'s: the population, the token and the deciding rung
                    // differ, and stage 4's crash clause reads a deliberate removal by act.
  | 'rehome'        // A session's HOME account moving. TWO EMITTERS, both
````

<!-- replay: T2 replace shared/api.ts -->
In `shared/api.ts`, find:

````ts
  'attic-drop': true, reap: true, reclaim: true, rehome: true, gc: true, spawn: true, route: true, start: true, ensure: true,
````

Replace with:

````ts
  'attic-drop': true, reap: true, reclaim: true, expire: true, rehome: true, gc: true, spawn: true, route: true, start: true, ensure: true,
````


- [ ] **Step 4: Re-stamp ccd and run — green.**

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
( cd server && ./node_modules/.bin/vitest run test/lifecycle-acts.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/lifecycle-vocabulary.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-lifecycle-emit.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/measure-workspace-lifecycle.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ownership.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/lifecycle-wire.test.ts --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/vitest run test/journal-words.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
```

Measured (the citation cases are the expected red — Step 5 pays it):

- `server/test/lifecycle-acts.test.ts`: `39 passed (39)`
- `server/test/single-definition.test.ts`: `274 passed (274)`
- `server/test/lifecycle-vocabulary.test.ts`: `9 passed (9)`
- `server/test/ccd-lifecycle-emit.test.ts`: `59 passed (59)`
- `server/test/measure-workspace-lifecycle.test.ts`: `11 passed (11)`
- `server/test/ownership.test.ts`: `14 passed (14)`
- `server/test/lifecycle-wire.test.ts`: `22 passed (22)`
- `pwa/test/journal-words.test.ts`: `5 passed (5)`
- `server/test/session-hook.test.ts` (`-t` the citation cases): `2 failed | 3 passed | 330 skipped (335)`
  - × THE CITATION DEBT this task creates is measured, per cited file (Task 11 owns closing it)
  - × README HAS ITS OWN CENSUS ENTRY, and it is EMPTY — every operator anchor resolves (wb2 B-I2)

- [ ] **Step 5: Pay the citation tax (S6-R11): README is REPAIRED, never counted.** The four lines Step 3 inserts into `shared/api.ts` sit above the purge-token block README cites. Read the new lines off the tree and re-point README's four anchors to them — the first two lines of output are the new `shared/api.ts:<a>-<b>` range, the next three the new `:<n>` anchors, and the last command finds the one README sentence that holds all four:

```bash
grep -n "^  | 'purge-refused'\|^  | 'purge-mechanism-absent'" shared/api.ts
grep -n "^  'purge-refused':\|^  'purge-incomplete':\|^  'purge-mechanism-absent':" shared/api.ts
grep -n 'shared/api.ts:[0-9]' README.md
```

Measured on this base (edit only those four numbers):

<!-- replay: T2 replace README.md -->
In `README.md`, find:

````markdown
`purge-mechanism-absent` (`shared/api.ts:7684-7686`), each with an operator sentence of its own at `:7726`,
`:7734` and `:7747`, which the session History tab renders through `lcRefusalWord`
````

Replace with:

````markdown
`purge-mechanism-absent` (`shared/api.ts:7688-7690`), each with an operator sentence of its own at `:7730`,
`:7738` and `:7751`, which the session History tab renders through `lcRefusalWord`
````


Then:

```bash
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
```

Measured: - `server/test/session-hook.test.ts` (`-t` the citation cases): `5 passed | 330 skipped (335)`

- [ ] **Step 6: Mutation check, then commit.**

| # | Edit (restore after; re-stamp after a `ccd/ccd` edit) | Measured red |
|---|---|---|
| T2.1 | `ccd/ccd`: `expire` dropped from `_LC_ACTS` (re-stamp). `ccd/ccd`: `_LC_ACTS=(archive attic-drop claim create destroy enable ensure expire forget gc⏎` → `_LC_ACTS=(archive attic-drop claim create destroy enable ensure forget gc⏎` | `server/test/ccd-lifecycle-emit.test.ts`: 2 failed \| 57 passed (59) — red: is set-equal to LIFECYCLE_ACTS minus the degrade name, BOTH directions (+1 more)<br>`server/test/lifecycle-vocabulary.test.ts`: 1 failed \| 8 passed (9) — red: _LC_ACTS is exactly LIFECYCLE_ACTS minus the reader's degrade<br>`server/test/measure-workspace-lifecycle.test.ts`: 1 failed \| 10 passed (11) — red: its act lists classify every one of ccd’s `_LC_ACTS` exactly once — the second spelling is bound to the first |
| T2.2 | `journalWords.ts`: `expire`'s word deleted. `pwa/src/session/journalWords.ts`: `reclaim: 'reclaimed', expire: 'expired', rehome:` → `reclaim: 'reclaimed', rehome:` | `pwa` `tsc --noEmit`: rc 2, TS2741 |
| T2.3 | the instrument: `expire` dropped from `ENDS_THE_ARCHIVE`. `deploy/measure-workspace-lifecycle.py`: `ENDS_THE_ARCHIVE = ('destroy', 'purge', 'reap', 'forget', 'create', 'expire', 'reclaim')` → `ENDS_THE_ARCHIVE = ('destroy', 'purge', 'reap', 'forget', 'create', 'reclaim')` | `server/test/measure-workspace-lifecycle.test.ts`: 1 failed \| 10 passed (11) — red: its act lists classify every one of ccd’s `_LC_ACTS` exactly once — the second spelling is bound to the first |
| T2.4 | the instrument: `start` classified twice (a return AND neutral). `deploy/measure-workspace-lifecycle.py`: `NEUTRAL_ACTS = ('attic-drop', 'claim', 'enable', 'gc', 'hold', 'release', 'rename', 'rehome', 'route', 'stop',` → `NEUTRAL_ACTS = ('attic-drop', 'claim', 'enable', 'gc', 'hold', 'release', 'rename', 'rehome', 'route', 'stop', 'start',` | `server/test/measure-workspace-lifecycle.test.ts`: 1 failed \| 10 passed (11) — red: its act lists classify every one of ccd’s `_LC_ACTS` exactly once — the second spelling is bound to the first |
| T2.5 | the instrument reads the raw close time again (NULL the only doubt). `deploy/measure-workspace-lifecycle.py`: `            newest[sid] = (rid, state, close_time(closed))` → `            newest[sid] = (rid, state, closed)` | `server/test/measure-workspace-lifecycle.test.ts`: 1 failed \| 10 passed (11) — red: a non-positive or non-integer close time is doubt too, as the server reads it — never a release |
| S38 | wave 1's row, its anchor kept: the close-time doubt dropped. `deploy/measure-workspace-lifecycle.py`: `        if last is None or last[1] not in TERMINAL or last[2] is None:` → `        if last is None or last[1] not in TERMINAL:` | `server/test/measure-workspace-lifecycle.test.ts`: 2 failed \| 9 passed (11) — red: a terminal run with no close time is doubt, not a release — the server’s rule (+1 more) |
| T2.6 | the instrument writes, and closes cleanly. `deploy/measure-workspace-lifecycle.py`: `        return sqlite3.connect(f'file:{path}?mode=ro', uri=True)` → `        c = sqlite3.connect(f'file:{path}?mode=rw', uri=True); c.execute('CREATE TABLE IF NOT EXISTS mutant_x (y)'); c.commit(); return c` | `server/test/measure-workspace-lifecycle.test.ts`: 1 failed \| 10 passed (11) — red: refuses a missing database without creating one, and never writes the one it reads |
| T2.7 | the instrument writes and dies before its close (the main file stays byte-identical). `deploy/measure-workspace-lifecycle.py`: `        return sqlite3.connect(f'file:{path}?mode=ro', uri=True)` → `        c = sqlite3.connect(f'file:{path}?mode=rw', uri=True); c.execute('CREATE TABLE IF NOT EXISTS mutant_x (y)'); c.commit(); os._exit(0)` | `server/test/measure-workspace-lifecycle.test.ts` `-t 'never writes the one it reads'`: 1 failed \| 10 skipped (11) — red: refuses a missing database without creating one, and never writes the one it reads |
| T2.8 | the close time's `_` refusal deleted (Python's float() reads `1_000`; the server's Number() does not). `deploy/measure-workspace-lifecycle.py`: `    if text is None or '_' in text:` → `    if text is None:` | `server/test/measure-workspace-lifecycle.test.ts`: 1 failed \| 10 passed (11) — red: a non-positive or non-integer close time is doubt too, as the server reads it — never a release |

```bash
git add shared/api.ts ccd/ccd pwa/src/session/journalWords.ts deploy/measure-workspace-lifecycle.py README.md \
  server/test/lifecycle-acts.test.ts server/test/single-definition.test.ts server/test/lifecycle-vocabulary.test.ts \
  server/test/ccd-lifecycle-emit.test.ts server/test/measure-workspace-lifecycle.test.ts
git commit -m "$(cat <<'MSG'
feat(lifecycle): the expire act, and the instrument bound to ccd's acts

ws-expire's journal act in all four declarations (L0's union and map,
_LC_ACTS, ACT_WORD, the instrument's lists) and five cardinals. The
instrument classifies every one of ccd's acts exactly once — a test runs
_LC_ACTS in a fixture HOME — with expire and reclaim ending an archive;
its close-time doubt is the server's persistedInt rule (row S38's anchor
kept); its read-only pin compares the -wal file too. README's four
shared/api.ts anchors re-pointed by content (S6-R11).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: The expiry ladder — rung 1, rung 2′, and child reclamation's rungs 3–10, shared

**Model routing:** **`opus`, effort `high`** — the ladder gates a destructive verb, and this task edits the RECLAIM region that gates another one. Every rung decides what an automated path may delete.

**Files:** red `server/test/ccd-ws-expire-ladder.test.ts`, `server/test/wsExpireFixture.ts`; green `ccd/ccd`, `server/src/wsaudit.ts`; tax `ccd/ccd`, `server/test/ccd-child-reclaim-pause.test.ts`, `server/test/ccd-wsaudit-nonpoison.test.ts`.

**Interfaces:**
- Consumes: Task 2's `expire` act.
- Produces (ccd): `_WS_RCL_ACT` (global `reclaim`); `_WS_LADDER_BIND` and `EXPIRE_ARCHIVED_AT` (owned by `_ws_reclaim_reset`); `_ws_reclaim_ladder id defer` (rungs 3–10, moved verbatim out of `_ws_reclaim_eval`, with one added check: no binding → unmeasured); the EXPIRE region with `WS_EXPIRE_AFTER_S=604800`, `_ws_expire_now`, `_ws_expire_epoch_ok`, `_ws_expire_archived id` (sets `EXPIRE_ARCHIVED_AT`), `_ws_expire_not_child id`, `_ws_expire_presence id verdict` (a pane up, or a unit not positively stopped — on Darwin a `failed` stamp re-asked of launchd — refuses `live`; asked by rung 5 when `_WS_LADDER_BIND[0]` is `mode=expire`, never by the flavour) and `_ws_expire_eval id` (`REAP_VERDICT=expirable` and `REAP_TOKEN` on a pass). The token's leading inputs are `mode=expire`, `id=<id>`, `archivedAt=<epoch>`.
- Produces (tests): `server/test/wsExpireFixture.ts` — `EXP_ID`, `EXP_BRANCH`, `NOW`, `WEEK`, `OLD`, `NOW_FN`, `EXP_STUBS`, `archiveAt`, `makeArchived`, `expireEvalOf`, `expireAudit`, `expireToken`, `expireVerb` (the last three are used from Tasks 4 and 6).

- [ ] **Step 1: Write the failing tests.** The fixture builds the expiry's population — a workspace minted by the real `cmd_ws_add` with NO `--child` — and archives it as `ws-archive` leaves it.

<!-- replay: T3 create server/test/wsExpireFixture.ts -->
Create `server/test/wsExpireFixture.ts`:

````ts
// The ARCHIVED workspace every `ws-expire` suite builds on (workspace lifecycle spec 2026-09-24 §5.3): a real
// repository with a GitHub-shaped origin (`makeGhRepo`), a workspace minted through the REAL `cmd_ws_add` — NO
// `--child`, so no `.child` marker, which is the expiry's whole population — two commits on its branch, and the
// archive `ws-archive` leaves: `.archived` (an epoch), `.archivedreason`, `.archivemanifest`, no pane, the unit
// unsupervised. The archive's age is set by naming the instant: `NOW_FN` redefines `_ws_expire_now`, the one clock
// rung 2′ reads, so the 604799/604800 boundary is exact rather than a race with the wall clock.
//
// FIXTURE HOME ONLY. `makePrHarness`'s HOME is the single isolation boundary, and `ws-expire` is destructive:
// `CHILD_STUBS` records the unit and pane calls instead of making them, and `CHILD_ENV` keeps the residue probe
// inside that HOME (both from `childReclaimFixture.ts`, whose machinery this verb shares).
import fs from 'node:fs';
import path from 'node:path';
import { WS_ADD } from './ccdWsHelpers.js';
import type { PrHarness } from './ccdPrHelpers.js';
import { CHILD_ENV, CHILD_STUBS } from './childReclaimFixture.js';

export const EXP_ID = 'demo-quiet-dune';
export const EXP_BRANCH = 'ws/quiet-dune';
/** The instant every case lives at — `_ws_expire_now` answers it. */
export const NOW = 1_790_000_000;
/** `WS_EXPIRE_AFTER_S`: seven days (spec §5.3, L3). */
export const WEEK = 604_800;
/** The archive every case starts from: eight days before NOW, so the ladder's rung 2′ passes unless a case moves it. */
export const OLD = NOW - 8 * 86_400;
export const NOW_FN = `_ws_expire_now() { echo ${NOW}; };`;
/** The stubs every expiry call carries: the RECLAIM machinery's recorders, then the clock. */
export const EXP_STUBS = `${CHILD_STUBS} ${NOW_FN}`;

export interface Archived { main: string; wt: string; tip: string }

const regFile = (h: PrHarness, field: string): string => path.join(h.home, '.cc-sessions', `${EXP_ID}.${field}`);

/** Stamps the archive `ws-archive` writes — the epoch on its own line, as `date +%s` prints it. */
export function archiveAt(h: PrHarness, epoch: number): void {
  fs.writeFileSync(regFile(h, 'archived'), `${epoch}\n`);
  fs.writeFileSync(regFile(h, 'archivedreason'), 'operator\n');
  fs.writeFileSync(regFile(h, 'archivemanifest'), '{"paths":[]}\n');
}

export function makeArchived(h: PrHarness, archivedAt = OLD): Archived {
  const main = h.makeGhRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-dune cmd_ws_add demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-dune');
  for (const n of ['1', '2']) {
    fs.writeFileSync(path.join(wt, `f${n}.txt`), `work ${n}\n`);
    h.git(wt, 'add', `f${n}.txt`);
    h.git(wt, 'commit', '-m', `work ${n}`);
  }
  archiveAt(h, archivedAt);
  return { main, wt, tip: h.git(wt, 'rev-parse', 'HEAD') };
}

export interface ExpireAnswer { verdict: string; token: string; detail: string }

/** `_ws_expire_eval`'s own answer, read off the globals it sets. `pre` runs after the stubs. */
export function expireEvalOf(h: PrHarness, opts: { pre?: string } = {}): ExpireAnswer {
  const out = h.sh(`${EXP_STUBS} ${opts.pre ?? ''} _WS_RCL_ACT=expire; _ws_expire_eval ${EXP_ID} >/dev/null;`
    + ` printf '%s\\x1f%s\\x1f%s' "$REAP_VERDICT" "$REAP_TOKEN" "$REAP_DETAIL"`);
  const [verdict = '', token = '', detail = ''] = out.split('\x1f');
  return { verdict, token, detail };
}

/** `ccd ws-audit --session <id> --expire` through the sourced function, answering instead of throwing. */
export function expireAudit(h: PrHarness, opts: { pre?: string } = {}): { code: number; stdout: string; stderr: string } {
  return h.run(`${EXP_STUBS} ${opts.pre ?? ''} cmd_ws_audit --session ${EXP_ID} --expire`);
}

/** The token `ws-audit --expire` mints now (its document's `token`), or '' when it mints none. */
export function expireToken(h: PrHarness, opts: { pre?: string } = {}): string {
  const r = expireAudit(h, opts);
  const doc = JSON.parse(r.stdout) as { token?: string };
  return doc.token ?? '';
}

/** `ws-expire` through the sourced function, answering instead of throwing (a refusal exits 0, a failure 1, a usage
 *  error 1 with nothing on stdout). `CHILD_ENV` rides every call, so the residue probe never leaves the HOME. */
export function expireVerb(
  h: PrHarness, token: string, opts: { extra?: string; pre?: string } = {},
): { code: number; stdout: string; stderr: string } {
  return h.run(`${EXP_STUBS} ${opts.pre ?? ''} ${CHILD_ENV} cmd_ws_expire --expect ${token} --session ${EXP_ID} ${opts.extra ?? ''}`);
}
````

<!-- replay: T3 create server/test/ccd-ws-expire-ladder.test.ts -->
Create `server/test/ccd-ws-expire-ladder.test.ts`:

````ts
// `_ws_expire_eval` — the expiry ladder, rung by rung (workspace lifecycle spec 2026-09-24 §5.3). Called directly,
// with `_WS_RCL_ACT=expire` as `cmd_ws_expire` sets it (the audit sets none: rung 5's one extra question reads the
// binding, which one case below holds): the verb and the audit that consume it can be no more right than this function is.
//
// The ORDER is the spec's: rung 1 (`no-such-session`, `not-a-workspace`), rung 2′ (`not-archived`, `not-expired`,
// `child`), then child reclamation's rungs 3-10 unchanged (`paused`, `held`, `attached`, the identity refusal
// `no-worktree-record`, the vanished-worktree arm, `tree-busy`, `branch-elsewhere`, `tree-unreadable`,
// `containment-unproven`) — with rung 5 asked MORE of for an expiry: a detached pane and a live unit refuse `live`.
// FIXTURE HOME ONLY (`wsExpireFixture.ts`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CHILD_ID, CHILD_STUBS, TMUX_FAULTS, evalOf, makeChild, plantTmux } from './childReclaimFixture.js';
import { EXP_BRANCH, EXP_ID, EXP_STUBS, NOW, OLD, WEEK, archiveAt, expireEvalOf, makeArchived } from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-expire-ladder-'); });
afterEach(() => { h.cleanup(); });

const reg = (field: string): string => path.join(h.home, '.cc-sessions', `${EXP_ID}.${field}`);
/** A live session with one attached client. */
const ATTACHED = 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in has-session) return 0 ;; list-clients) echo /dev/pts/3 ;; *) return 1 ;; esac; };';
/** A unit systemd reports running. */
const UNIT_ACTIVE = '_svc_is_active() { printf active; };';

describe('an archived workspace a week old passes, and its token binds the archive', () => {
  it('answers expirable with a 64-hex token, stable across two reads of an unchanged workspace', () => {
    makeArchived(h);
    const a = expireEvalOf(h);
    expect(a.verdict, a.detail).toBe('expirable');
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(expireEvalOf(h).token).toBe(a.token);
  }, 60_000);

  it('the seven-day boundary is exact: 604799 seconds refuses not-expired, 604800 proceeds', () => {
    makeArchived(h, NOW - (WEEK - 1));
    const young = expireEvalOf(h);
    expect(young.verdict).toBe('not-expired');
    expect(young.token).toBe('');
    expect(young.detail).toContain(`${WEEK - 1} seconds ago`);
    archiveAt(h, NOW - WEEK);
    expect(expireEvalOf(h).verdict).toBe('expirable');
  }, 60_000);

  it('an archive stamped in the FUTURE is not old — not-expired, never a negative age read as old', () => {
    makeArchived(h, NOW + 3600);
    expect(expireEvalOf(h).verdict).toBe('not-expired');
  }, 60_000);

  it('the archive EPOCH is a token input: the same tree archived again has another token', () => {
    makeArchived(h);
    const first = expireEvalOf(h).token;
    archiveAt(h, OLD + 1);
    const again = expireEvalOf(h);
    expect(again.verdict).toBe('expirable');
    expect(again.token, 'a return and a re-archive start a new token — the old one cannot spend it').not.toBe(first);
  }, 60_000);

  it('an expiry token is never a reclaim token over the same facts — `mode=expire` leads it', () => {
    makeArchived(h);
    const out = h.sh(`${CHILD_STUBS} _ws_expire_now() { echo ${NOW}; }; _WS_RCL_ACT=expire; _ws_expire_eval ${EXP_ID} >/dev/null;`
      + ' printf "%s\\n" "${_WS_LADDER_BIND[@]}"');
    expect(out.split('\n')).toEqual(['mode=expire', `id=${EXP_ID}`, `archivedAt=${OLD}`]);
  }, 60_000);
});

describe('the shared ladder needs its caller’s binding', () => {
  it('entered with no binding — no rungs 1-2 asked — it is unmeasured, never a token over no population', () => {
    makeArchived(h);
    const out = h.sh(`${CHILD_STUBS} _ws_reclaim_reset; _ws_reclaim_ladder ${EXP_ID} 0 >/dev/null;`
      + ' printf "%s\\x1f%s" "$REAP_VERDICT" "$REAP_TOKEN"');
    expect(out.split('\x1f')).toEqual(['unmeasured', '']);
  }, 60_000);
});

describe('rung 1 — identity', () => {
  it('refuses no-such-session when there is no registry row', () => {
    makeArchived(h);
    fs.rmSync(reg('uuid'));
    expect(expireEvalOf(h).verdict).toBe('no-such-session');
  }, 60_000);

  it('refuses not-a-workspace for a main checkout — even one carrying an archive stamp', () => {
    makeArchived(h);
    fs.rmSync(reg('workspace'));
    const r = expireEvalOf(h);
    expect(r.verdict).toBe('not-a-workspace');
    expect(r.detail).toContain('never expired');
  }, 60_000);
});

describe('rung 2′ — archived, a week ago, and not a child', () => {
  it('refuses not-archived when no `.archived` stamp stands', () => {
    makeArchived(h);
    fs.rmSync(reg('archived'));
    expect(expireEvalOf(h).verdict).toBe('not-archived');
  }, 60_000);

  it('a stamp that is not an epoch is UNMEASURED — never old, never a token', () => {
    makeArchived(h);
    for (const bad of ['soon', '', '0', '0123', '1e9', '-5']) {
      fs.writeFileSync(reg('archived'), `${bad}\n`);
      const r = expireEvalOf(h);
      expect(r.verdict, JSON.stringify(bad)).toBe('unmeasured');
      expect(r.token).toBe('');
    }
    fs.rmSync(reg('archived'));
    fs.mkdirSync(reg('archived'));
    expect(expireEvalOf(h).verdict, 'a directory standing there is no epoch').toBe('unmeasured');
  }, 60_000);

  it('refuses child for a marker that reads as a child, a malformed one, an unreadable one and a dangling link', () => {
    makeArchived(h);
    const marker = reg('child');
    for (const plant of [
      () => fs.writeFileSync(marker, '7\n'),
      () => fs.writeFileSync(marker, 'not-a-run\n'),
      () => { fs.writeFileSync(marker, '7\n'); fs.chmodSync(marker, 0o000); },
      () => fs.symlinkSync(path.join(h.home, 'nowhere'), marker),
    ]) {
      fs.rmSync(marker, { force: true });
      plant();
      const r = expireEvalOf(h);
      expect(r.verdict, r.detail).toBe('child');
      expect(r.token).toBe('');
      fs.rmSync(marker, { force: true });
    }
    expect(expireEvalOf(h).verdict, 'the CONTROL: no marker, no refusal').toBe('expirable');
  }, 90_000);

  it('rung 2′ outranks every retryable rung after it — paused, held and attached do not hide a child or a young archive', () => {
    makeArchived(h);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    fs.writeFileSync(reg('hold'), 'program:x wave:1/1');
    fs.writeFileSync(reg('child'), '7\n');
    expect(expireEvalOf(h, { pre: ATTACHED }).verdict).toBe('child');
    fs.rmSync(reg('child'));
    archiveAt(h, NOW - 60);
    expect(expireEvalOf(h, { pre: ATTACHED }).verdict).toBe('not-expired');
  }, 60_000);
});

describe('rungs 3 to 6 — the RECLAIM ladder’s, asked unchanged', () => {
  it('refuses paused while the cleanup switch stands — a file, a directory, a dangling link', () => {
    makeArchived(h);
    const pause = path.join(h.home, '.cc-sessions', 'reclaim-paused');
    fs.writeFileSync(pause, '');
    expect(expireEvalOf(h).verdict).toBe('paused');
    fs.rmSync(pause);
    fs.mkdirSync(pause);
    expect(expireEvalOf(h).verdict).toBe('paused');
    fs.rmdirSync(pause);
    fs.symlinkSync(path.join(h.home, 'nowhere'), pause);
    expect(expireEvalOf(h).verdict).toBe('paused');
  }, 60_000);

  it('refuses held — an archived workspace still held after a week is not acted on', () => {
    makeArchived(h);
    fs.writeFileSync(reg('hold'), 'program:x wave:2/3');
    const r = expireEvalOf(h);
    expect(r.verdict).toBe('held');
    expect(r.detail).toContain('program:x wave:2/3');
  }, 60_000);

  it('refuses attached on an attached client — asked through the ANCHORED target', () => {
    makeArchived(h);
    expect(expireEvalOf(h, { pre: ATTACHED }).verdict).toBe('attached');
    expect(h.calls()).toContain(`tmux has-session -t =cc-${EXP_ID}:`);
  }, 60_000);

  it('refuses tree-busy while an operation is in progress, and while a git command holds the index lock', () => {
    const { wt, main } = makeArchived(h);
    const mergeHead = h.git(wt, 'rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD');
    fs.writeFileSync(mergeHead, `${h.git(main, 'rev-parse', 'HEAD')}\n`);
    expect(expireEvalOf(h).verdict).toBe('tree-busy');
    fs.rmSync(mergeHead);
    const idx = h.git(wt, 'rev-parse', '--path-format=absolute', '--git-path', 'index');
    fs.writeFileSync(`${idx}.lock`, '');
    expect(expireEvalOf(h).verdict).toBe('tree-busy');
  }, 60_000);

  it('tmux that could not be asked is unmeasured — never "no session", never a token', () => {
    makeArchived(h);
    plantTmux(h, { fault: TMUX_FAULTS['no server running'] });
    const r = expireEvalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
  }, 60_000);
});

// THE COORDINATOR'S RULING (D), review 240's "already archived" follow-up: an `.archived` row whose pane or supervisor
// is LIVE is never expired. Measured before the rung existed (the plan's mutation row deletes the call): a DETACHED
// `cc-<id>` pane and a running unit with no pane both passed every rung and minted a token. `attached` asks only for a
// client; `tree-busy` only for a git operation or an index lock. What the rung asks is the PANE and the UNIT — a
// process whose cwd is the worktree but which runs outside both (an operator's own shell) is not seen, by design and
// stated (the plan's departure `expire-refuses-a-live-pane-or-unit`).
describe('rung 5, asked more of for an expiry — a live pane or a live unit refuses `live`', () => {
  it('a `cc-<id>` session that is up with NO client attached (a detached pane) refuses live', () => {
    makeArchived(h);
    plantTmux(h, { sessions: [`cc-${EXP_ID}`] });
    const r = expireEvalOf(h);
    expect(r.verdict, r.detail).toBe('live');
    expect(r.detail).toContain('no terminal attached');
    expect(r.token).toBe('');
  }, 60_000);

  it('a live UNIT with no pane refuses live; a unit the manager will not describe is unmeasured', () => {
    makeArchived(h);
    const r = expireEvalOf(h, { pre: UNIT_ACTIVE });
    expect(r.verdict, r.detail).toBe('live');
    expect(r.detail).toContain(`claude-session@${EXP_ID}`);
    expect(expireEvalOf(h, { pre: '_svc_is_active() { printf activating; };' }).verdict).toBe('live');
    expect(expireEvalOf(h, { pre: '_svc_is_active() { :; };' }).verdict, 'no answer is not absence').toBe('unmeasured');
    expect(expireEvalOf(h, { pre: '_svc_is_active() { printf failed; };' }).verdict, 'a failed unit is not restarted').toBe('expirable');
  }, 60_000);

  it('asked by the BINDING, not the flavour: `_ws_expire_eval` called with no `_WS_RCL_ACT` set still refuses live', () => {
    makeArchived(h);
    const out = h.sh(`${EXP_STUBS} ${UNIT_ACTIVE} _ws_expire_eval ${EXP_ID} >/dev/null;`
      + ' printf "%s\\x1f%s\\x1f%s" "$_WS_RCL_ACT" "$REAP_VERDICT" "$REAP_TOKEN"');
    expect(out.split('\x1f'), 'the global flavour is a reclaim\'s, and the expiry still asked').toEqual(['reclaim', 'live', '']);
  }, 60_000);

  it('the CONTROL: ws-reclaim is NOT asked this — a finished child with a detached pane is still reclaimable', () => {
    makeChild(h);
    plantTmux(h, { sessions: [`cc-${CHILD_ID}`] });
    expect(evalOf(h).verdict).toBe('reclaimable');
    expect(evalOf(h, { pre: UNIT_ACTIVE }).verdict, 'and a live unit is the tail\'s to stop').toBe('reclaimable');
  }, 60_000);
});

// ON DARWIN A `failed` IS A STAMP, NOT AN ANSWER FROM LAUNCHD (`_svc_is_active` prints it from `$REG/<id>.svcfailed`
// before it asks launchd, and nothing that starts the job again clears it): a running job under a stale stamp would
// pass as stopped. So the expiry asks launchd as the reclaim tail does. Forced on any host the way the tail's own rows
// force it — `CCD_OS=darwin` assigned after the source — with `_svc_launchctl`, ccd's one door to launchctl, recording
// and answering, and `_svc_is_active` answering the stamp's `failed`.
describe('rung 5 on Darwin — a `failed` stamp is stopped only when launchd says the job is not loaded', () => {
  const LABEL = `gui/${process.getuid?.() ?? 0}/app.ccrc.session.${EXP_ID}`;
  const darwin = (out: string, rc: number): string =>
    'CCD_OS=darwin; _svc_is_active() { printf failed; };'
    + ' _svc_launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; [[ "$1" == print ]] || return 0;'
    + ` printf '%s\\n' '${out}'; return ${rc}; };`;

  it.each([
    ['launchd shows the job running', 'live', 'state = running', 0],
    ['launchd has the job loaded, not running (it can start the pane)', 'live', 'state = waiting', 0],
    ['launchctl could not be asked (exit 1: no binary, or the sandbox guard)', 'unmeasured', '', 1],
    ['the CONTROL: launchd answers exit 113, not loaded', 'expirable', 'Could not find service', 113],
  ] as const)('a stamp, and %s → %s', (_what, want, out, rc) => {
    makeArchived(h);
    const r = expireEvalOf(h, { pre: darwin(out, rc) });
    expect(r.verdict, r.detail).toBe(want);
    expect(h.calls(), 'launchd was asked by the label ccd spells').toContain(`launchctl print ${LABEL}`);
  }, 60_000);
});

describe('rungs 7 to 9 and the identity refusal — the RECLAIM ladder’s, asked unchanged', () => {
  it('refuses branch-elsewhere when another worktree stands on the branch', () => {
    const { wt, main } = makeArchived(h);
    h.git(wt, 'checkout', '--detach');
    h.git(main, 'worktree', 'add', path.join(h.home, 'elsewhere'), EXP_BRANCH);
    expect(expireEvalOf(h).verdict).toBe('branch-elsewhere');
  }, 60_000);

  it('refuses tree-unreadable when the permission pass cannot fix the tree', () => {
    const { wt } = makeArchived(h);
    const a = path.join(wt, 'a');
    fs.mkdirSync(a);
    fs.writeFileSync(path.join(a, 'hidden.txt'), 'x');
    fs.chmodSync(a, 0o000);
    const shim = path.join(h.home, 'shim');
    fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, 'chmod'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    try {
      expect(expireEvalOf(h, { pre: `PATH="${shim}:$PATH";` }).verdict).toBe('tree-unreadable');
    } finally { fs.chmodSync(a, 0o755); }
  }, 60_000);

  it('refuses no-worktree-record for a directory git does not record', () => {
    const { main } = makeArchived(h);
    fs.rmSync(path.join(main, '.git', 'worktrees', 'quiet-dune'), { recursive: true, force: true });
    expect(expireEvalOf(h).verdict).toBe('no-worktree-record');
  }, 60_000);

  it('refuses containment-unproven for a workdir that is a symbolic link', () => {
    const { wt } = makeArchived(h);
    const real = `${wt}-real`;
    fs.renameSync(wt, real);
    fs.symlinkSync(real, wt);
    const r = expireEvalOf(h);
    expect(r.verdict, r.detail).toBe('containment-unproven');
    expect(r.detail).toContain('symbolic link');
  }, 60_000);

  it('a VANISHED worktree is expirable over what is left, with its own token', () => {
    const { wt } = makeArchived(h);
    const present = expireEvalOf(h);
    fs.rmSync(wt, { recursive: true, force: true });
    const gone = expireEvalOf(h);
    expect(gone.verdict, gone.detail).toBe('expirable');
    expect(gone.token).toMatch(/^[0-9a-f]{64}$/);
    expect(gone.token).not.toBe(present.token);
  }, 60_000);
});
````


- [ ] **Step 2: Run them — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-ladder.test.ts --maxWorkers=1 )
```

Measured (every case, listed; the one pass is the CONTROL that `ws-reclaim` is not asked rung 5's new question):

- `server/test/ccd-ws-expire-ladder.test.ts`: `29 failed | 1 passed (30)`
  - × answers expirable with a 64-hex token, stable across two reads of an unchanged workspace
  - × the seven-day boundary is exact: 604799 seconds refuses not-expired, 604800 proceeds
  - × an archive stamped in the FUTURE is not old — not-expired, never a negative age read as old
  - × the archive EPOCH is a token input: the same tree archived again has another token
  - × an expiry token is never a reclaim token over the same facts — `mode=expire` leads it
  - × entered with no binding — no rungs 1-2 asked — it is unmeasured, never a token over no population
  - × refuses no-such-session when there is no registry row
  - × refuses not-a-workspace for a main checkout — even one carrying an archive stamp
  - × refuses not-archived when no `.archived` stamp stands
  - × a stamp that is not an epoch is UNMEASURED — never old, never a token
  - × refuses child for a marker that reads as a child, a malformed one, an unreadable one and a dangling link
  - × rung 2′ outranks every retryable rung after it — paused, held and attached do not hide a child or a young archive
  - × refuses paused while the cleanup switch stands — a file, a directory, a dangling link
  - × refuses held — an archived workspace still held after a week is not acted on
  - × refuses attached on an attached client — asked through the ANCHORED target
  - × refuses tree-busy while an operation is in progress, and while a git command holds the index lock
  - × tmux that could not be asked is unmeasured — never "no session", never a token
  - × a `cc-<id>` session that is up with NO client attached (a detached pane) refuses live
  - × a live UNIT with no pane refuses live; a unit the manager will not describe is unmeasured
  - × asked by the BINDING, not the flavour: `_ws_expire_eval` called with no `_WS_RCL_ACT` set still refuses live
  - × a stamp, and launchd shows the job running → live
  - × a stamp, and launchd has the job loaded, not running (it can start the pane) → live
  - × a stamp, and launchctl could not be asked (exit 1: no binary, or the sandbox guard) → unmeasured
  - × a stamp, and the CONTROL: launchd answers exit 113, not loaded → expirable
  - × refuses branch-elsewhere when another worktree stands on the branch
  - × refuses tree-unreadable when the permission pass cannot fix the tree
  - × refuses no-worktree-record for a directory git does not record
  - × refuses containment-unproven for a workdir that is a symbolic link
  - × a VANISHED worktree is expirable over what is left, with its own token

- [ ] **Step 3: The flavour, the shared ladder, and the EXPIRE region's ladder.** In the RECLAIM region: the flavour's header and global; the reset owns the binding; `_ws_reclaim_eval` keeps rungs 1–2 and hands rungs 3–10 to `_ws_reclaim_ladder` (the departure `reclaim-machinery-reads-a-flavour`); rung 5 asks `_ws_expire_presence` for an expiry only (the departure `expire-refuses-a-live-pane-or-unit`); both token lines lead with the binding. The EXPIRE region goes directly below `RECLAIM-END` and above the MIRROR block. `server/src/wsaudit.ts` gains the three new words' sentences.

<!-- replay: T3 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
# `"refused"`, and is journaled by `_lc_fail`.

````

Replace with:

````bash
# `"refused"`, and is journaled by `_lc_fail`.
#
# THE FLAVOUR (workspace lifecycle, spec 2026-09-24 §5.3). Rungs 3-10 of this
# ladder (`_ws_reclaim_ladder`), its pin phase and its tail are SHARED with
# `ws-expire` (the EXPIRE region below): an archived workspace, seven days after
# its archive, is pinned and torn down by exactly this machinery. What differs
# is read from `_WS_RCL_ACT` — the journal act and the verb's name, the
# breadcrumb's flavour, the WIP subject, the tombstone's `mode` and binding
# field, the done document. At one rung a question only TIGHTENS, and it is
# keyed on the token's binding (`_WS_LADDER_BIND`, `mode=expire`), not on
# this flavour: rung 5 asks the EXPIRE region whether a detached pane or a
# live unit stands (`_ws_expire_presence`). No word of the fourteen moves, and
# none is spelled here for the expiry. `cmd_ws_expire` sets the flavour as a
# LOCAL, which every function below sees by bash's dynamic scope for that one
# call; this global is assigned whenever ccd is read, so an environment that
# exports `_WS_RCL_ACT=expire` cannot turn a reclaim into an expiry.
_WS_RCL_ACT=reclaim

````

<!-- replay: T3 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  RECLAIM_KEPT=()           # branches this reclaim KEEPS, never deletes, and records (`keptBranches`)
}
````

Replace with:

````bash
  RECLAIM_KEPT=()           # branches this reclaim KEEPS, never deletes, and records (`keptBranches`)
  _WS_LADDER_BIND=()        # the token's LEADING inputs — the caller's rungs 1-2 set them (`_ws_reclaim_ladder`)
  EXPIRE_ARCHIVED_AT=""     # ws-expire's archive epoch, as READ (the EXPIRE region); '' on every reclaim
}
````

<!-- replay: T3 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  local id="$1" defer="$2" childof="$3"
  local ws mark project workdir regbranch branch wthead main mainreal common
  local op clients elsewhere elsrc nested p pcommon ptop rc h hs clipsjson hp wdreal
````

Replace with:

````bash
  local id="$1" defer="$2" childof="$3" ws mark
````

<!-- replay: T3 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  RECLAIM_CHILDOF="$mark"
  # 3 — the kill-switch, read HERE, at the instant of deletion (spec §5.8). -e,
````

Replace with:

````bash
  RECLAIM_CHILDOF="$mark"
  _WS_LADDER_BIND=("mode=reclaim" "id=$id" "childOf=$RECLAIM_CHILDOF" "deferExpired=$RECLAIM_DEFER")
  _ws_reclaim_ladder "$id" "$defer"
}

_ws_reclaim_ladder() {   # id defer -> rungs 3-10, SHARED by `_ws_reclaim_eval` and `_ws_expire_eval` (the
  #                         EXPIRE region): each asks its own rungs 1-2 first and sets `_WS_LADDER_BIND`, the
  #                         token's leading inputs. 0 with REAP_VERDICT=reclaimable and REAP_TOKEN; else
  #                         REAP_VERDICT names the refusal. Its one flavour question is rung 5's (see THE FLAVOUR).
  local id="$1" defer="$2"
  local project workdir regbranch branch wthead main mainreal common
  local op clients elsewhere elsrc nested p pcommon ptop rc h hs clipsjson hp wdreal
  # NO BINDING, NO TOKEN: a ladder entered without its caller's rungs 1-2 would
  # mint a token that names no verb and no population. A defect, measured as
  # nothing — unmeasured, never a refusal word and never a token.
  (( ${#_WS_LADDER_BIND[@]} )) \
    || { _ws_reclaim_unmeasured "the ladder was entered without its caller's rungs 1-2 — no binding for its token"; return 1; }
  # 3 — the kill-switch, read HERE, at the instant of deletion (spec §5.8). -e,
````

<!-- replay: T3 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
      *) _ws_reclaim_unmeasured "whether $(_tmux "$id") is up could not be asked — tmux answered: ${PROBE_DETAIL:-nothing}"; return 1 ;;
    esac
  fi
  # THE LEAF IS NEVER FOLLOWED (spec §5.5). A workdir that is itself a link
````

Replace with:

````bash
      *) _ws_reclaim_unmeasured "whether $(_tmux "$id") is up could not be asked — tmux answered: ${PROBE_DETAIL:-nothing}"; return 1 ;;
    esac
    # AN EXPIRY ASKS MORE OF THIS RUNG, AND ONLY MORE: a DETACHED pane and a live
    # unit refuse it too (`_ws_expire_presence`, the EXPIRE region). Never a
    # reclaim's question: a child's tail kills its pane by design (spec §5.6).
    # Keyed on the BINDING the expiry's rungs 1-2 set, never on the flavour
    # global: a caller of `_ws_expire_eval` that forgot the flavour still asks.
    [[ "${_WS_LADDER_BIND[0]-}" != mode=expire ]] || _ws_expire_presence "$id" "$PROBE_VERDICT" || return 1
  fi
  # THE LEAF IS NEVER FOLLOWED (spec §5.5). A workdir that is itself a link
````

<!-- replay: T3 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  REAP_TOKEN=$(_ws_reclaim_fingerprint "mode=reclaim" "id=$id" "childOf=$RECLAIM_CHILDOF" \
    "deferExpired=$RECLAIM_DEFER" "worktree=present" "branch=$branch" "registryBranch=$regbranch" \
````

Replace with:

````bash
  REAP_TOKEN=$(_ws_reclaim_fingerprint "${_WS_LADDER_BIND[@]}" \
    "worktree=present" "branch=$branch" "registryBranch=$regbranch" \
````

<!-- replay: T3 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  REAP_TOKEN=$(_ws_reclaim_fingerprint "mode=reclaim" "id=$id" "childOf=$RECLAIM_CHILDOF" \
    "deferExpired=$RECLAIM_DEFER" "worktree=absent" "record=$rec" "branch=$branch" \
````

Replace with:

````bash
  REAP_TOKEN=$(_ws_reclaim_fingerprint "${_WS_LADDER_BIND[@]}" \
    "worktree=absent" "record=$rec" "branch=$branch" \
````

<!-- replay: T3 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash

# ── ws-reap's mirrors: a reclaim breadcrumb, a leaf link (spec 2026-09-22 §5.5-§5.6) ─ MIRROR-BEGIN ──
````

Replace with:

````bash

# ── archived-workspace expiry: ws-expire (spec 2026-09-24 §5.3) ──────────── EXPIRE-BEGIN ──
# An ARCHIVED workspace is pinned, then torn down, seven days after its
# archive, by `ws-expire` — composed by the server and by nothing else
# (CLAUDE.md SAFETY: forbidden to every session; `ws-reap` stays human-only).
# A SIBLING of `ws-reclaim`, never a flag on it: rung 2 of that ladder (the
# `.child` marker) has no override anywhere, and a flag that widened its
# population would be one (spec §5.3). So this region holds only what is the
# expiry's OWN — its rungs 1-2, its fork, its verb, its audit, its presence
# question and its spawn gate — and borrows the rest from the RECLAIM region
# above: rungs 3-10 (`_ws_reclaim_ladder`), the pin phase, the tail, the lock
# `$REG/.reap-<id>.lock`. `_WS_RCL_ACT=expire`, set as a local here, is what
# makes that machinery journal `expire`, write `expire:` breadcrumbs and a
# tombstone whose `mode` is `expire` (see THE FLAVOUR there).
#
# THE VOCABULARY. Every word this verb can answer, by the kind wave 3b's lane
# gives it: GONE — `no-such-session`, `not-archived` (the row left the
# population: returned, or never archived); TERMINAL — `not-a-workspace`,
# `branch-elsewhere`, `tree-unreadable`, `containment-unproven`,
# `no-worktree-record`; RETRY — `not-expired`, `child`, `paused`, `held`,
# `attached`, `live`, `tree-busy`, `state-changed`, `in-progress`,
# `reap-in-progress`, `reclaim-in-progress`. Eighteen. The ones the RECLAIM
# region spells stay spelled there; this region spells only its own
# (`not-archived`, `not-expired`, `child`, `live`, and the two flavour
# refusals). `unmeasured` is no word, exactly as there: a probe that could not
# run is a `"failed"` document at exit 1 (`probe-unmeasured`), retried.
# `--defer-expired` does not exist here: `attached`, `live` and `tree-busy` are
# never skipped, because "presence defers WITHOUT a ceiling" (spec §5.3).

WS_EXPIRE_AFTER_S=604800   # seven days, spec §5.3 (L3). The kill rule (§9) raises it; nothing lowers it.

_ws_expire_now() { date +%s; }   # the clock rung 2′ reads — a function, so a test can name the instant

_ws_expire_epoch_ok() { local LC_ALL=C; [[ "${1-}" =~ ^[1-9][0-9]{0,11}$ ]]; }   # value -> 0 iff it is an archive epoch as ccd writes one

_ws_expire_archived() {   # id -> 0 with EXPIRE_ARCHIVED_AT = the archive epoch, when the workspace is archived and
  #                          that archive is at least WS_EXPIRE_AFTER_S old; else rc 1 with REAP_VERDICT set
  # RUNG 2′, ITS FIRST HALF (spec §5.3). `.archived` is what every reader of
  # the archive tests, so it is the population: absent — and a link or a
  # directory standing there is not absent — refuses `not-archived`. A stamp
  # that stands but is not an epoch ccd writes is unmeasured, never "old":
  # an expiry decided on a guess is a deletion decided on one.
  local id="$1" f="$REG/$1.archived" arch now
  [[ -e "$f" || -L "$f" ]] \
    || { _reap_refuse not-archived "$id is not archived — only a workspace archived $WS_EXPIRE_AFTER_S seconds ago or more is ever expired"; return 1; }
  arch=$(_reg_get "$id" archived)
  _ws_expire_epoch_ok "$arch" \
    || { _ws_reclaim_unmeasured "the archive stamp at $f cannot be read as an epoch (it reads '$arch')"; return 1; }
  now=$(_ws_expire_now) && _ws_expire_epoch_ok "$now" \
    || { _ws_reclaim_unmeasured "the clock could not be read, so the archive's age was never measured"; return 1; }
  (( now - arch >= WS_EXPIRE_AFTER_S )) \
    || { _reap_refuse not-expired "$id was archived $(( now - arch )) seconds ago; it expires $WS_EXPIRE_AFTER_S seconds after its archive, at $(( arch + WS_EXPIRE_AFTER_S ))"; return 1; }
  EXPIRE_ARCHIVED_AT="$arch"
}

_ws_expire_not_child() {   # id -> 0 when NO `.child` marker stands; else rc 1 refused `child`
  # RUNG 2′, ITS SECOND HALF. A marker that reads as a child, or that stands and
  # cannot be read, refuses `child` — retryable, and never this verb's: a child
  # is the RECLAIM lane's (spec §5.3, CCR-15 R29's direction: an unreadable
  # marker defers). Presence is the test (`-e`, and `-L` for a dangling link),
  # never the grammar: a marker this box cannot parse is still not "none".
  local id="$1"
  [[ ! -e "$REG/$id.child" && ! -L "$REG/$id.child" ]] \
    || { _reap_refuse child "$id carries a child marker ($REG/$id.child) — a child is reclaimed by ws-reclaim when its run closes, never expired"; return 1; }
}

_ws_expire_presence() {   # id probe-verdict -> 0 when nothing runs for id; else rc 1 (`live`, or unmeasured)
  # RUNG 5, ASKED MORE OF FOR AN EXPIRY (the RECLAIM region's ladder calls this
  # after its own `attached` question, only when the binding leads with
  # `mode=expire`; `_ws_expire_resume_eval` asks it at the `children` phase).
  # An archived workspace has had no pane since its archive — that is half of
  # why expiring it is safe (spec §3, item 2) — so a pane that is up, attached
  # or not, or a unit that is running, means somebody is using it: `live`,
  # retryable, and nothing touched. `ws-reclaim` never asks this: a finished
  # child's tail kills its pane by design. The unit is asked the way the tail
  # re-measures it: only a POSITIVE stopped answer passes — `inactive`, or
  # `failed` (a failed unit is not restarted) — and an EMPTY answer is the
  # manager not answering, unmeasured, never absence. ON DARWIN `failed` IS A
  # STAMP (`$REG/<id>.svcfailed`, printed before launchd is asked, and never
  # cleared by a re-enable or a swap's start), so launchd is asked as the tail
  # asks it: `state = running`, or any loaded job (exit 0), is `live`; only
  # exit 113 ("Could not find service") lets the stamp stand for stopped; any
  # other status is a question never answered — unmeasured.
  # WHAT IT DOES NOT SEE: a process with its cwd in the worktree that runs
  # outside the `cc-<id>` pane and outside the unit (an operator's own shell).
  local id="$1" verdict="$2" unit out lrc
  [[ "$verdict" != live ]] \
    || { _reap_refuse live "$(_tmux "$id") is up with no terminal attached — an archived workspace whose pane runs is in use, and is never expired"; return 1; }
  unit=$(_svc_is_active "claude-session@$id")
  if [[ "$CCD_OS" == darwin && "$unit" == failed ]]; then
    out=$(_svc_launchctl print "$(_svc_domain)/$(_svc_label "claude-session@$id")" 2>/dev/null); lrc=$?
    case "$out" in
      *"state = running"*) unit=running ;;
      *) case "$lrc" in
           113) : ;;
           0) unit=loaded ;;
           *) _ws_reclaim_unmeasured "claude-session@$id answered 'failed' from its stamp, and launchd could not say whether the job is loaded (print exit $lrc)"; return 1 ;;
         esac ;;
    esac
  fi
  case "$unit" in
    inactive|failed) return 0 ;;
    '') _ws_reclaim_unmeasured "whether claude-session@$id is running could not be asked — the service manager answered nothing"; return 1 ;;
    *) _reap_refuse live "claude-session@$id answered '$unit' — a supervised workspace respawns its pane, and is never expired"; return 1 ;;
  esac
}

_ws_expire_eval() {   # id -> 0 when the expiry ladder passes (REAP_VERDICT=expirable, REAP_TOKEN set), else
  #                     REAP_VERDICT names the refusal. Runs only where no breadcrumb exists.
  # THE LADDER, in spec §5.3's order: rung 1 (`no-such-session`;
  # `not-a-workspace` for a main checkout, which nothing ever archives as a
  # workspace — a main checkout is never expired), rung 2′ (archived, and old
  # enough; not a child), then the RECLAIM region's rungs 3-10 unchanged, with
  # rung 5 asked more of. The archive EPOCH is a token input, so a workspace
  # brought back and archived again can never be expired on its old token:
  # `state-changed` (spec §5.3).
  _ws_reclaim_reset
  local id="$1" ws
  [[ -f "$REG/$id.uuid" ]] || { _reap_refuse no-such-session "no registry entry for $id"; return 1; }
  ws=$(_reg_get "$id" workspace)
  [[ -n "$ws" ]] || { _reap_refuse not-a-workspace "$id is a main checkout — a main checkout is never expired"; return 1; }
  _ws_expire_archived "$id" || return 1
  _ws_expire_not_child "$id" || return 1
  _WS_LADDER_BIND=("mode=expire" "id=$id" "archivedAt=$EXPIRE_ARCHIVED_AT")
  _ws_reclaim_ladder "$id" 0 || return 1
  REAP_VERDICT=expirable
}

# ── end archived-workspace expiry ───────────────────────────────────────────── EXPIRE-END ──

# ── ws-reap's mirrors: a reclaim breadcrumb, a leaf link (spec 2026-09-22 §5.5-§5.6) ─ MIRROR-BEGIN ──
````

<!-- replay: T3 replace server/src/wsaudit.ts -->
In `server/src/wsaudit.ts`, find:

````ts
  'reclaim-in-progress': 'An interrupted reclamation of this workspace is waiting to finish, and ws-reap never finishes another verb’s work. Nothing was removed.',
};
````

Replace with:

````ts
  'reclaim-in-progress': 'An interrupted reclamation of this workspace is waiting to finish, and ws-reap never finishes another verb’s work. Nothing was removed.',
  // ── ws-expire (workspace lifecycle, spec 2026-09-24 §5.3): an ARCHIVED workspace cleaned up seven days after its
  // archive. Its new words only; every other word it can answer is reused, sentence unedited. The retryable ones say
  // the cleanup tries again; none asks the reader to act, because the lane that will read them (wave 3b) is the
  // server's. `not-archived` is ws-reap's word and keeps its sentence.
  'not-expired': 'This workspace was archived less than seven days ago, so nothing was removed. It is cleaned up seven days after its archive.',
  'child': 'This workspace was created for a run, so it is cleaned up when that run closes, never by the seven-day expiry. Nothing was removed.',
  'live': 'This archived workspace has a session running — a pane, or a service that would start one — so nothing was removed. The cleanup tries again later.',
};
````


- [ ] **Step 4: Re-stamp ccd and run — green, with the taxes still owed.**

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-ladder.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ownership.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/wsaudit.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-wsaudit-nonpoison.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pause.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
```

Measured (the three reds are Step 5's taxes):

- `server/test/ccd-ws-expire-ladder.test.ts`: `30 passed (30)`
- `server/test/ownership.test.ts`: `14 passed (14)`
- `server/test/wsaudit.test.ts`: `25 passed (25)`
- `server/test/ccd-reg-get-census.test.ts`: `1 failed | 2 passed (3)`
  - × both numbers the header claims match what its own cited commands count
- `server/test/ccd-wsaudit-nonpoison.test.ts`: `1 failed | 2 passed (3)`
  - × leaves the token set OUTSIDE the reclaim region at exactly the 55 that shipped before build 9
- `server/test/ccd-child-reclaim-pause.test.ts`: `1 failed | 12 passed (13)`
  - × writes the SAME path ws-reclaim reads — one marker, one spelling, two verbs
- `server/test/session-hook.test.ts` (`-t` the citation cases): `5 passed | 330 skipped (335)`

- [ ] **Step 5: Pay the taxes.** (a) The `_reg_get` census — MEASURE N and M with the header's two commands (Global Constraints) and write them over the sentence's two numbers; rewrite the first `THE LAST MOVE WAS` line's opening in place. (b) `ccd-wsaudit-nonpoison.test.ts`: the EXPIRE region joins the blocks `src` cuts out; the full scan's count and its outside-the-cut difference are RE-MEASURED (port the four regexes, or run the file and read the assertion's actual), never typed. (c) `ccd-child-reclaim-pause.test.ts`: rung 3's reader now lives in `_ws_reclaim_ladder`. Measured on this base:

<!-- replay: T3 replace ccd/ccd old-inline new-inline -->
In `ccd/ccd`, find (a fragment — its text ends without a newline):

````bash
179
# invocations across 150 non-comment lines.
#
# THE LAST MOVE WAS the rescue wait's reads (session-continuity wave 2), the +3; before it
````

Replace with:

````bash
181
# invocations across 152 non-comment lines.
#
# THE LAST MOVE WAS the EXPIRE region's reads (workspace lifecycle wave 3); before it the rescue wait's, the +3; before that
````

<!-- replay: T3 replace server/test/ccd-child-reclaim-pause.test.ts -->
In `server/test/ccd-child-reclaim-pause.test.ts`, find:

````ts
    // dangling link at that name pauses too), must appear inside EACH of wave 3's
    // two eval functions — the fresh arm (`_ws_reclaim_eval`, its rung 3) and
    // the resume arm (`_ws_reclaim_resume_eval`) — sliced by their own
    // `name() {` … `^}`, so mistyping either reader's path reds this suite on
    // its own function, independently of the other and of the writer.
````

Replace with:

````ts
    // dangling link at that name pauses too), must appear inside EACH reader —
    // the fresh arm's rung 3, which since workspace lifecycle wave 3 lives in the
    // SHARED ladder (`_ws_reclaim_ladder`, run by `_ws_reclaim_eval` and by
    // `_ws_expire_eval` alike), and each verb's resume arm — sliced by its own
    // `name() {` … `^}`, so mistyping any reader's path reds this suite on its
    // own function, independently of the others and of the writer.
````

<!-- replay: T3 replace server/test/ccd-child-reclaim-pause.test.ts -->
In `server/test/ccd-child-reclaim-pause.test.ts`, find:

````ts
    for (const name of ['_ws_reclaim_eval', '_ws_reclaim_resume_eval']) {
````

Replace with:

````ts
    for (const name of ['_ws_reclaim_ladder', '_ws_reclaim_resume_eval']) {
````

<!-- replay: T3 replace server/test/ccd-wsaudit-nonpoison.test.ts -->
In `server/test/ccd-wsaudit-nonpoison.test.ts`, find:

````ts
    const full = readFileSync(CCD, 'utf8');
    expect.soft(scan(full)).toHaveLength(62);
    expect.soft(scan(full).filter((t) => !scan(src).includes(t)))
      .toEqual(['attached', 'containment-unproven', 'not-a-child', 'paused', 'reap-in-progress', 'reclaim-in-progress',
        'tree-busy']);
````

Replace with:

````ts
    // 62 -> 65 (workspace lifecycle wave 3, Task 3 — `ws-expire`'s ladder, spec 2026-09-24
    // §5.3): the expiry's own words stand in its own `EXPIRE-BEGIN`…`EXPIRE-END`
    // region, which `src` cuts out exactly as it cuts the other two blocks — so
    // the pin above stays 55 and byte-identical. Measured the same way: the full
    // scan answers 65, ENTERED the expiry's new words, LEFT none; the scan
    // outside the three blocks answers 55.
    const full = readFileSync(CCD, 'utf8');
    expect.soft(scan(full)).toHaveLength(65);
    expect.soft(scan(full).filter((t) => !scan(src).includes(t)))
      .toEqual(['attached', 'child', 'containment-unproven', 'live', 'not-a-child', 'not-expired', 'paused',
        'reap-in-progress', 'reclaim-in-progress', 'tree-busy']);
````

<!-- replay: T3 replace server/test/ccd-wsaudit-nonpoison.test.ts -->
In `server/test/ccd-wsaudit-nonpoison.test.ts`, find:

````ts
 *  ws-reap's refusal of a reclaim breadcrumb (child reclamation wave 3, Task 4)
````

Replace with:

````ts
 *  ws-reap's refusal of a reclaim breadcrumb (child reclamation wave 3, Task 4),
 *  and the EXPIRE region, `ws-expire`'s own words (workspace lifecycle wave 3)
````

<!-- replay: T3 replace server/test/ccd-wsaudit-nonpoison.test.ts -->
In `server/test/ccd-wsaudit-nonpoison.test.ts`, find:

````ts
  for (const block of [reclaimRegion(text), markedBlock(text, 'MIRROR-BEGIN', 'MIRROR-END')]) {
````

Replace with:

````ts
  for (const block of [reclaimRegion(text), markedBlock(text, 'MIRROR-BEGIN', 'MIRROR-END'), markedBlock(text, 'EXPIRE-BEGIN', 'EXPIRE-END')]) {
````


```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
( cd server && ./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-wsaudit-nonpoison.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pause.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/child-reclaim.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-ladder.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
```

Measured:

- `server/test/ccd-reg-get-census.test.ts`: `3 passed (3)`
- `server/test/ccd-wsaudit-nonpoison.test.ts`: `3 passed (3)`
- `server/test/ccd-child-reclaim-pause.test.ts`: `13 passed (13)`
- `server/test/child-reclaim.test.ts`: `128 passed (128)`
- `server/test/ccd-child-reclaim-ladder.test.ts`: `145 passed (145)`
- `server/test/session-hook.test.ts` (`-t` the citation cases): `5 passed | 330 skipped (335)`

- [ ] **Step 6: Mutation check, then commit.** Row M3.4 is ruling (D)'s measurement: with the presence question deleted, a detached live pane and a running unit both pass every rung (the Darwin CONTROL reds with them only because launchd is then never asked). Every row was measured on this revision's prototype over `a6daa9cf4`.

| # | Edit (restore after; re-stamp after a `ccd/ccd` edit) | Measured red |
|---|---|---|
| M3.1 | rung 2′'s age compare off by one (`>=` → `>`). `ccd/ccd`: `  (( now - arch >= WS_EXPIRE_AFTER_S )) \⏎` → `  (( now - arch > WS_EXPIRE_AFTER_S )) \⏎` | `server/test/ccd-ws-expire-ladder.test.ts` `-t 'boundary'`: 1 failed \| 29 skipped (30) — red: the seven-day boundary is exact: 604799 seconds refuses not-expired, 604800 proceeds |
| M3.2 | rung 2′'s child check deleted from `_ws_expire_eval`. `ccd/ccd`: `  _ws_expire_archived "$id" \|\| return 1⏎  _ws_expire_not_child "$id" \|\| return 1⏎  _WS_LADDER_BIND=("mode=expire"` → `  _ws_expire_archived "$id" \|\| return 1⏎  _WS_LADDER_BIND=("mode=expire"` | `server/test/ccd-ws-expire-ladder.test.ts` `-t 'child'`: 2 failed \| 3 passed \| 25 skipped (30) — red: refuses child for a marker that reads as a child, a malformed one, an unreadable one and a dangling link (+1 more) |
| M3.3 | the child check reads the marker's GRAMMAR instead of its presence. `ccd/ccd`: `  [[ ! -e "$REG/$id.child" && ! -L "$REG/$id.child" ]] \⏎    \|\| { _reap_refuse child` → `  ! _child_runid_valid "$(_reg_get "$id" child)" \⏎    \|\| { _reap_refuse child` | `server/test/ccd-ws-expire-ladder.test.ts` `-t 'refuses child'`: 1 failed \| 29 skipped (30) — red: refuses child for a marker that reads as a child, a malformed one, an unreadable one and a dangling link |
| M3.4 | rung 5's question deleted — ruling (D)'s measurement. `ccd/ccd`: `    [[ "${_WS_LADDER_BIND[0]-}" != mode=expire ]] \|\| _ws_expire_presence "$id" "$PROBE_VERDICT" \|\| return 1⏎` → (deleted) | `server/test/ccd-ws-expire-ladder.test.ts` `-t 'rung 5'`: 7 failed \| 1 passed \| 22 skipped (30) — red: a `cc-<id>` session that is up with NO client attached (a detached pane) refuses live (+6 more) |
| M3.5 | an unanswered unit read as stopped. `ccd/ccd`: `    inactive\|failed) return 0 ;;⏎    '') _ws_reclaim_unmeasured "whether claude-session@$id is running` → `    inactive\|failed\|'') return 0 ;;⏎    'x') _ws_reclaim_unmeasured "whether claude-session@$id is running` | `server/test/ccd-ws-expire-ladder.test.ts` `-t 'live UNIT'`: 1 failed \| 29 skipped (30) — red: a live UNIT with no pane refuses live; a unit the manager will not describe is unmeasured |
| M3.6 | the epoch dropped from the token's binding. `ccd/ccd`: `  _WS_LADDER_BIND=("mode=expire" "id=$id" "archivedAt=$EXPIRE_ARCHIVED_AT")⏎` → `  _WS_LADDER_BIND=("mode=expire" "id=$id")⏎` | `server/test/ccd-ws-expire-ladder.test.ts` `-t 'token'`: 2 failed \| 7 passed \| 21 skipped (30) — red: the archive EPOCH is a token input: the same tree archived again has another token (+1 more) |
| M3.7 | `WS_EXPIRE_AFTER_S` six days. `ccd/ccd`: `WS_EXPIRE_AFTER_S=604800 ` → `WS_EXPIRE_AFTER_S=518400 ` | `server/test/ccd-ws-expire-ladder.test.ts` `-t 'boundary'`: 1 failed \| 29 skipped (30) — red: the seven-day boundary is exact: 604799 seconds refuses not-expired, 604800 proceeds |
| M3.8 | any digits read as an epoch (`0`, `0123`). `ccd/ccd`: `[[ "${1-}" =~ ^[1-9][0-9]{0,11}$ ]]; }` → `[[ "${1-}" =~ ^[0-9]+$ ]]; }` | `server/test/ccd-ws-expire-ladder.test.ts` `-t 'not an epoch'`: 1 failed \| 29 skipped (30) — red: a stamp that is not an epoch is UNMEASURED — never old, never a token |
| M3.9 | the stamp's presence asked with `-f` (a directory reads not-archived). `ccd/ccd`: `  [[ -e "$f" \|\| -L "$f" ]] \⏎    \|\| { _reap_refuse not-archived` → `  [[ -f "$f" ]] \⏎    \|\| { _reap_refuse not-archived` | `server/test/ccd-ws-expire-ladder.test.ts` `-t 'not an epoch'`: 1 failed \| 29 skipped (30) — red: a stamp that is not an epoch is UNMEASURED — never old, never a token |
| M3.10 | rung 5's question asked of a reclaim too. `ccd/ccd`: `    [[ "${_WS_LADDER_BIND[0]-}" != mode=expire ]] \|\| _ws_expire_presence "$id" "$PROBE_VERDICT" \|\| return 1⏎` → `    _ws_expire_presence "$id" "$PROBE_VERDICT" \|\| return 1⏎` | `server/test/ccd-ws-expire-ladder.test.ts` `-t 'CONTROL'`: 1 failed \| 1 passed \| 28 skipped (30) — red: the CONTROL: ws-reclaim is NOT asked this — a finished child with a detached pane is still reclaimable |
| M3.11 | the shared ladder's no-binding guard deleted. `ccd/ccd`: `  (( ${#_WS_LADDER_BIND[@]} )) \⏎    \|\| { _ws_reclaim_unmeasured "the ladder was entered without its caller's rungs 1-2 — no binding for its token"; return 1; }⏎` → (deleted) | `server/test/ccd-ws-expire-ladder.test.ts` `-t 'binding'`: 1 failed \| 29 skipped (30) — red: entered with no binding — no rungs 1-2 asked — it is unmeasured, never a token over no population |
| M3.12 | a reclaim's binding loses an input (its tokens would change). `ccd/ccd`: `  _WS_LADDER_BIND=("mode=reclaim" "id=$id" "childOf=$RECLAIM_CHILDOF" "deferExpired=$RECLAIM_DEFER")⏎` → `  _WS_LADDER_BIND=("mode=reclaim" "id=$id" "childOf=$RECLAIM_CHILDOF")⏎` | `server/test/ccd-child-reclaim-ladder.test.ts` `-t 'moves the token'`: 1 failed \| 2 passed \| 142 skipped (145) — red: moves the token when a fingerprinted fact moves — defer, a file, a stash, a clip, the marker |
| M3.13 | rung 5's question keyed on the flavour global instead of the binding (a caller that forgot the flavour skips it). `ccd/ccd`: `[[ "${_WS_LADDER_BIND[0]-}" != mode=expire ]]` → `[[ "$_WS_RCL_ACT" != expire ]]` | `server/test/ccd-ws-expire-ladder.test.ts` `-t 'BINDING'`: 1 failed \| 29 skipped (30) — red: asked by the BINDING, not the flavour: `_ws_expire_eval` called with no `_WS_RCL_ACT` set still refuses live<br>`server/test/ccd-ws-expire-audit.test.ts` `-t 'live archived'`: 2 failed \| 9 skipped (11) — red: a running unit with no pane (+1 more) |
| M3.14 | the Darwin arm deleted (a `failed` stamp read as stopped whatever launchd says). `ccd/ccd`: `  if [[ "$CCD_OS" == darwin && "$unit" == failed ]]; then⏎` → `  if false; then⏎` | `server/test/ccd-ws-expire-ladder.test.ts` `-t 'Darwin'`: 4 failed \| 26 skipped (30) — red: a stamp, and launchd shows the job running → live (+3 more) |
| M3.15 | the Darwin arm reads a LOADED, not-running job (exit 0) as stopped. `ccd/ccd`: `           0) unit=loaded ;;⏎` → `           0) : ;;⏎` | `server/test/ccd-ws-expire-ladder.test.ts` `-t 'Darwin'`: 1 failed \| 3 passed \| 26 skipped (30) — red: a stamp, and launchd has the job loaded, not running (it can start the pane) → live |

```bash
git add ccd/ccd server/src/wsaudit.ts server/test/wsExpireFixture.ts server/test/ccd-ws-expire-ladder.test.ts \
  server/test/ccd-wsaudit-nonpoison.test.ts server/test/ccd-child-reclaim-pause.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): the expiry ladder — rung 2' and child reclamation's rungs 3-10, shared

The RECLAIM region reads a flavour (_WS_RCL_ACT, reclaim by default) and its
rungs 3-10 move verbatim into _ws_reclaim_ladder, which ws-reclaim's and
ws-expire's rungs 1-2 both call after setting the token's leading inputs —
a reclaim's are the four it always had, so every reclaim token is
unchanged. The EXPIRE region holds rung 2' (archived at least
WS_EXPIRE_AFTER_S ago, its epoch a token input; no child marker) and rung
5's one extra question for an expiry, keyed on the token's binding: a
detached live pane or a running unit refuses `live` (ruling D), and on
Darwin a `failed` stamp is re-asked of launchd. Three new words get
SENTENCES copy; the _reg_get census, the nonpoison scan and the pause pin
re-measured.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: The verb — `ws-expire`, its resume, its record, and ws-reap's refusal

**Model routing:** **`opus`, effort `high`** — the destructive verb, the resume that re-asserts what authorised it, and the shared tail's flavour.

**Files:** red `server/test/ccd-refusal-scan.test.ts`, `server/test/ccd-ws-expire-verb.test.ts`; green `ccd/ccd`, `server/src/wsaudit.ts`; tax `ccd/ccd`, `server/test/ccd-child-reclaim-pause.test.ts`, `server/test/ccd-wsaudit-nonpoison.test.ts`.

**Interfaces:**
- Consumes: Task 3's ladder and fixture.
- Produces (ccd): `cmd_ws_expire --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]` (no `--defer-expired`: a usage error); `_ws_expire_locked`; `_ws_expire_fork` (an `expire:` breadcrumb resumes; `reclaim:` refuses `reclaim-in-progress`; any other refuses `reap-in-progress`; one that stands unread is unmeasured); `_ws_expire_resume_eval id phase` (re-asserts the row, the archive epoch — equal to the tombstone's `archivedAt` and still old enough — no child marker, the switch, the hold; and, at the `children` phase — before the tail has stopped anything — rung 5's presence again, refusing `live` for a pane or a unit that stands; its token is `mode=expire-resume`, the epoch, the phase, the branch and the tip); `_ws_expire_tomb_epoch`. `cmd_reclaim_pause`'s comment says the switch now stops the expiry too (the code already does: rung 3 and the resume read it). The shared tail, pin, tombstone fields and `_ws_reclaim_fail` follow `_WS_RCL_ACT`: breadcrumbs `expire:children|worktree|branch|artifacts`, journal act `expire` verb `ws-expire`, WIP subject `ccrc: WIP pinned at expiry of <id> (archived at <epoch>)`, tombstone `"mode":"expire","archivedAt":<epoch>`, done document `{"expired":<id>,"archivedAt":<epoch>,…}`.
- Produces: `ws-reap`'s refusal `expire-in-progress` of an `expire:` breadcrumb (MIRROR block; one condition added to `_ws_reap_locked`'s existing line).
- Exit contract (wave 3b reads it): a refusal is `{"refused":<word>,"detail":…,"paths":[]}` at exit 0; a failure after the act started is `{"failed":<token>,"detail":…}` at exit 1, with the breadcrumb kept; a probe that could not run is `{"failed":"probe-unmeasured",…}` at exit 1; success is the done document at exit 0.

- [ ] **Step 1: Write the failing tests.** The verb tests mint their token from the ladder (`expireEvalOf`); Task 6's audit test proves the audit's token is the same consent.

<!-- replay: T4 replace server/test/ccd-refusal-scan.test.ts -->
In `server/test/ccd-refusal-scan.test.ts`, find:

````ts
/** D4's four destructive verbs, and ws-reclaim (child reclamation, wave 3) as the fifth. Floors are measured minima, not guesses. */
````

Replace with:

````ts
/** D4's four destructive verbs, ws-reclaim (child reclamation, wave 3) as the fifth and ws-expire (workspace lifecycle, wave 3) as the sixth. Floors are measured minima, not guesses. */
````

<!-- replay: T4 replace server/test/ccd-refusal-scan.test.ts -->
In `server/test/ccd-refusal-scan.test.ts`, find:

````ts
];

/**
 * THE THIRTEEN DIES A REFUSAL RECORD CANNOT DESCRIBE, each for one stated reason.
````

Replace with:

````ts
  // Measured 3761 characters for cmd_ws_expire's pre-lock parse and lock when this entry was written.
  ['cmd_ws_expire', '_ws_expire_locked', 3200],
];

/**
 * THE FIFTEEN DIES A REFUSAL RECORD CANNOT DESCRIBE, each for one stated reason.
````

<!-- replay: T4 replace server/test/ccd-refusal-scan.test.ts -->
In `server/test/ccd-refusal-scan.test.ts`, find:

````ts
 * id is bound. The set is EXACT: a fourteenth sanctioned die reds the count.
 *
 * Seven are cmd_ws_reclaim's (child reclamation, wave 3), for reap's own reasons: its usage line and run-id shape check run before $id is bound, its four --actor/--reason checks are the loop arms that run before any id is bound, and its _json_str probe is the emitter being missing. Its "bad token" and "bad session id" are the SAME literals as reap's and need no second entry.
````

Replace with:

````ts
 * id is bound. The set is EXACT: a sixteenth sanctioned die reds the count.
 *
 * Seven are cmd_ws_reclaim's (child reclamation, wave 3), for reap's own reasons: its usage line and run-id shape check run before $id is bound, its four --actor/--reason checks are the loop arms that run before any id is bound, and its _json_str probe is the emitter being missing. Its "bad token" and "bad session id" are the SAME literals as reap's and need no second entry.
 *
 * Two are cmd_ws_expire's (workspace lifecycle, wave 3), for the same reasons: its usage line runs before $id is bound, and its _json_str probe is the emitter being missing. Its four --actor/--reason checks, "bad token" and "bad session id" are the SAME literals as ws-reclaim's and reap's and need no second entry.
````

<!-- replay: T4 replace server/test/ccd-refusal-scan.test.ts -->
In `server/test/ccd-refusal-scan.test.ts`, find:

````ts
  'die "--reason is longer than $_LC_DEC_MAX bytes"',
];
````

Replace with:

````ts
  'die "--reason is longer than $_LC_DEC_MAX bytes"',
  'die "usage: ccd ws-expire --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]"',
  'die "python3 unavailable — cannot quote the expiry record safely"',
];
````

<!-- replay: T4 replace server/test/ccd-refusal-scan.test.ts -->
In `server/test/ccd-refusal-scan.test.ts`, find:

````ts
    expect(SANCTIONED.length, 'the sanctioned set changed size').toBe(13);
````

Replace with:

````ts
    expect(SANCTIONED.length, 'the sanctioned set changed size').toBe(15);
````

<!-- replay: T4 replace server/test/ccd-refusal-scan.test.ts -->
In `server/test/ccd-refusal-scan.test.ts`, find:

````ts

  it('the reclaim lock\'s two inner functions contain NO die — past the lock, a failure is _lc_fail and JSON', () => {
````

Replace with:

````ts

  it('holds the expiry emits at exactly two in ws-expire — one verdict point, one flock decline (workspace lifecycle, wave 3)', () => {
    // `_ws_expire_locked` routes every ladder refusal, the token mismatch and the flavour refusals through one
    // `_lc_emit`; the lock decline in `cmd_ws_expire` is the second. Comment lines are not code.
    const region = src.slice(src.indexOf('EXPIRE-BEGIN'), src.indexOf('EXPIRE-END'));
    expect(region.length, 'the expire region could not be sliced').toBeGreaterThan(10000);
    const code = region.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect([...code.matchAll(/_lc_emit expire refused "\$id" "" verb ws-expire /g)]).toHaveLength(2);
  });

  it('_ws_expire_locked contains NO die — past the lock, a failure is _lc_fail and JSON', () => {
    const from = src.indexOf('_ws_expire_locked() {');
    const body = from > -1 ? src.slice(from, src.indexOf('\n}\n', from)) : '';
    expect(body.length, '_ws_expire_locked could not be sliced').toBeGreaterThan(2500);
    expect([...body.matchAll(/(^|\s|\|\|\s*|;\s*)die "/g)].map((m) => lineAt(body, m.index!)),
      '_ws_expire_locked grew a die — past the lock, route it through _lc_fail and the "failed" document').toEqual([]);
  });

  it('the reclaim lock\'s two inner functions contain NO die — past the lock, a failure is _lc_fail and JSON', () => {
````

<!-- replay: T4 create server/test/ccd-ws-expire-verb.test.ts -->
Create `server/test/ccd-ws-expire-verb.test.ts`:

````ts
// `ws-expire` — the destructive verb for an ARCHIVED workspace, seven days after its archive (workspace lifecycle
// spec 2026-09-24 §5.3). Every case builds a real archived workspace in a fixture HOME and runs the sourced function
// with the unit and pane calls RECORDED, never made. What is asserted is what is left on disk and in git afterwards —
// read back from refs and files, never from the verb's word.
//
// The load-bearing pins: nothing git knows is lost (every commit, stash and operation head reachable from the attic
// after the worktree and branch are gone and the repository is garbage-collected); ignored and secret-shaped files and
// the clips are RECORDED (paths, and sizes where the record has them) before they go; transcripts are untouched; the
// token binds the archive epoch, so a return and a re-archive refuse `state-changed`; a crash at every phase resumes
// through the `expire:` breadcrumb and re-asserts the epoch first; ws-reap refuses that breadcrumb (`expire-in-progress`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, CFG_DIR, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, measOf, refusalsOf } from './lifecycleHelpers.js';
import { childIndex, gcNow, hasCommit, hookRuns, plantRepoPrograms, plantTmux, tmuxSessions } from './childReclaimFixture.js';
import {
  EXP_BRANCH, EXP_ID, EXP_STUBS, NOW, OLD, archiveAt, expireEvalOf, expireVerb, makeArchived, type Archived,
} from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-expire-verb-'); });
afterEach(() => { h.cleanup(); });

const reg = (field: string): string => path.join(h.home, '.cc-sessions', `${EXP_ID}.${field}`);
const tombOf = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(h.home, '.cc-sessions', '.reaped', `${EXP_ID}.json`), 'utf8')) as Record<string, unknown>;
const atticRefs = (a: Archived): string[] =>
  h.git(a.main, 'for-each-ref', '--format=%(refname)', `refs/ccrc/attic/${EXP_ID}/`).split('\n').filter(Boolean);
/** Every commit the attic KEEPS: reachable from any ref under `refs/ccrc/attic/<id>/`. */
const atticReach = (a: Archived): string[] => {
  const refs = atticRefs(a);
  return refs.length ? h.git(a.main, 'rev-list', ...refs).split('\n').filter(Boolean) : [];
};
const KILL = `tmux kill-session -t =cc-${EXP_ID}:`;
const unsupervised = (): string[] => h.calls().filter((l) => l.startsWith('unsupervise'));
/** Everything a refusal must leave standing. */
const intact = (a: Archived): void => {
  expect(fs.existsSync(a.wt), 'the worktree survives').toBe(true);
  expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'the branch survives').toContain(EXP_BRANCH);
  expect(h.reg(EXP_ID, 'uuid'), 'the registry row survives').not.toBeNull();
  expect(h.reg(EXP_ID, 'archived'), 'the archive survives').not.toBeNull();
  expect(unsupervised(), 'the unit was not touched').toEqual([]);
  expect(h.calls(), 'the pane was not touched').not.toContain(KILL);
};
const refusedWith = (r: { code: number; stdout: string; stderr: string }): string => {
  expect(r.code, `a refusal is an ANSWER — exit 0. stderr: ${r.stderr}`).toBe(0);
  const o = JSON.parse(r.stdout) as Record<string, unknown>;
  expect(o['expired'], 'a refusal never also reports an expiry').toBeUndefined();
  return String(o['refused']);
};
/** The transcript Claude Code keeps for this session's CURRENT uuid, outside the worktree (`_transcript_path`). */
const plantTranscript = (a: Archived): string => {
  const cfg = path.join(h.home, CFG_DIR[h.reg(EXP_ID, 'wrapper')!]!);
  const munged = fs.realpathSync(a.wt).replace(/[./_]/g, '-');
  const file = path.join(cfg, 'projects', munged, `${h.reg(EXP_ID, 'uuid')}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"type":"user","message":"the whole conversation"}\n');
  return file;
};
/** A previous expiry that died right after its pin phase wrote the tombstone and the breadcrumb — before its tail
 *  unsupervised or deleted anything — then, for a later phase, the deletions the tail had already made. */
const interrupted = (a: Archived, phase: 'children' | 'worktree' | 'branch' | 'artifacts'): void => {
  h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_eval ${EXP_ID} >/dev/null`
    + ` && _ws_reclaim_pin ${EXP_ID} "${a.wt}" "${a.main}" "$REAP_BRANCH" "$EXPIRE_ARCHIVED_AT"`
    + ` && _ws_tombstone ${EXP_ID} '[]' "$(_ws_reclaim_tomb_fields "$EXPIRE_ARCHIVED_AT")" >/dev/null`
    + ` && _reg_set ${EXP_ID} reaping expire:${phase}`);
  if (phase === 'branch' || phase === 'artifacts') h.git(a.main, 'worktree', 'remove', '--force', a.wt);
  if (phase === 'artifacts') h.git(a.main, 'update-ref', '-d', `refs/heads/${EXP_BRANCH}`);
  expect(h.reg(EXP_ID, 'reaping')).toBe(`expire:${phase}`);
};
const resumeToken = (phase: string): string =>
  h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_resume_eval ${EXP_ID} ${phase} >/dev/null; printf '%s' "$REAP_TOKEN"`);
/** Everything an expiry must have removed, and everything it must have kept. */
const expired = (a: Archived): void => {
  expect(fs.existsSync(a.wt), 'worktree').toBe(false);
  expect(h.git(a.main, 'branch', '--list', EXP_BRANCH), 'branch').toBe('');
  for (const field of ['uuid', 'archived', 'reaping', 'workdir']) expect(h.reg(EXP_ID, field), field).toBeNull();
  expect(fs.existsSync(path.join(h.home, '.cc-clips', EXP_ID)), 'clips').toBe(false);
  expect(atticReach(a), 'the branch tip is kept in the attic').toContain(a.tip);
};

describe('a fresh expiry', () => {
  it('pins, then removes the unit, worktree, branch, clips and registry row — and records what it dropped', () => {
    const a = makeArchived(h);
    fs.writeFileSync(path.join(a.wt, '.gitignore'), 'build/\n*.log\n');
    fs.appendFileSync(path.join(a.wt, 'f1.txt'), 'edited, never committed\n');
    fs.writeFileSync(path.join(a.wt, 'notes.txt'), 'untracked work');
    fs.mkdirSync(path.join(a.wt, 'build'));
    fs.writeFileSync(path.join(a.wt, 'build', 'out.bin'), 'x'.repeat(1234));
    fs.writeFileSync(path.join(a.wt, 'debug.log'), 'y'.repeat(77));
    fs.writeFileSync(path.join(a.wt, '.env'), 'KEY=live');
    fs.mkdirSync(path.join(h.home, '.cc-clips', EXP_ID), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-clips', EXP_ID, 'shot.png'), 'png-bytes');
    const transcript = plantTranscript(a);

    const r = expireVerb(h, expireEvalOf(h).token, { extra: "--surface agent --actor 'expiry sweep'" });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { expired: string; archivedAt: number; wip: string; attic: number; secretsDropped: number };
    expect(out.expired).toBe(EXP_ID);
    expect(out.archivedAt).toBe(OLD);
    expect(out.wip).toMatch(/^[0-9a-f]{40}$/);
    expect(out.secretsDropped).toBe(1);
    expired(a);

    // The work is in the attic, read back from git; the secret never reached a commit.
    expect(atticReach(a)).toContain(out.wip);
    const tree = h.git(a.main, 'ls-tree', '-r', '--name-only', out.wip).split('\n');
    expect(tree).toEqual(expect.arrayContaining(['notes.txt', 'f1.txt', '.gitignore']));
    expect(tree).not.toContain('.env');
    expect(tree, 'an ignored file is recorded, never committed').not.toContain('build/out.bin');
    expect(h.git(a.main, 'log', '-1', '--format=%s', out.wip)).toBe(`ccrc: WIP pinned at expiry of ${EXP_ID} (archived at ${OLD})`);

    // Unsupervise, then the ANCHORED kill — both, in that order.
    expect(unsupervised()).toEqual([`unsupervise ${EXP_ID} agent agent`]);
    expect(h.calls()).toContain(KILL);

    // THE RECORD: its kind, its binding, the ignored files with their sizes, the secret dropped, the clips by name,
    // the transcript by path — and the transcript itself, untouched.
    const tomb = tombOf();
    expect(tomb['mode']).toBe('expire');
    expect(tomb['archivedAt']).toBe(OLD);
    expect(tomb['childOf'], 'an expiry binds the archive, never a run').toBeUndefined();
    expect(tomb['ignored']).toEqual(expect.arrayContaining([
      { path: 'build/', bytes: expect.any(Number), sensitive: false },
      { path: 'debug.log', bytes: 77, sensitive: false },
    ]));
    expect(tomb['secretsDropped']).toEqual(['.env']);
    expect(tomb['clips']).toEqual([{ name: 'shot.png', bytes: 9 }]);
    expect(tomb['transcript']).toBe(transcript);
    expect(fs.readFileSync(transcript, 'utf8'), 'the transcript is kept, byte for byte').toContain('the whole conversation');

    const events = eventsOf(h.home, 'expire');
    const intent = events.find((e) => e['outcome'] === 'intent')!;
    const done = events.find((e) => e['outcome'] === 'done')!;
    expect(intent['tx'], 'one intent/done pair').toBe(done['tx']);
    expect(intent['verb']).toBe('ws-expire');
    expect(measOf(intent)['archivedAt']).toBe(String(OLD));
    expect(measOf(done)['archivedAt']).toBe(String(OLD));
    expect(measOf(done)['wip']).toBe(out.wip);
    expect(eventsOf(h.home, 'reclaim'), 'an expiry never journals as a reclaim').toEqual([]);
  }, 120_000);

  it('NOTHING GIT KNOWS IS LOST: every commit, stash and operation head is reachable from the attic after a gc', () => {
    const a = makeArchived(h);
    fs.appendFileSync(path.join(a.wt, 'f1.txt'), 'stashed edit\n');
    h.git(a.wt, 'stash', 'push', '-m', 'stashed before the archive');
    const stash = h.git(a.wt, 'rev-parse', 'refs/stash');
    // An operation head nobody finished, and a commit reachable only from it and the reflog.
    const orphan = h.git(a.wt, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'only an operation head names this');
    fs.writeFileSync(h.git(a.wt, 'rev-parse', '--path-format=absolute', '--git-path', 'ORIG_HEAD'), `${orphan}\n`);
    const commits = h.git(a.main, 'rev-list', `refs/heads/${EXP_BRANCH}`).split('\n');
    const r = expireVerb(h, expireEvalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expired(a);
    gcNow(h, a.main);
    for (const sha of [...commits, stash, orphan]) {
      expect(hasCommit(h, a.main, sha), `${sha} survives the gc`).toBe(true);
      expect(atticReach(a), `${sha} is reachable from the attic`).toContain(sha);
    }
  }, 120_000);

  it('a VANISHED worktree is expired from what is left: the branch tip pinned, the tombstone says absent', () => {
    const a = makeArchived(h);
    fs.rmSync(a.wt, { recursive: true, force: true });
    const r = expireVerb(h, expireEvalOf(h).token);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expired(a);
    expect(tombOf()['worktree']).toBe('absent');
  }, 120_000);
});

describe('a refusal destroys nothing, and every one is journaled as an expiry', () => {
  it('refuses state-changed on a wrong token and on a tree that moved after the audit', () => {
    const a = makeArchived(h);
    const tok = expireEvalOf(h).token;
    expect(refusedWith(expireVerb(h, 'f'.repeat(64)))).toBe('state-changed');
    fs.writeFileSync(path.join(a.wt, 'late.txt'), 'typed after the audit');
    expect(refusedWith(expireVerb(h, tok))).toBe('state-changed');
    intact(a);
    expect(refusalsOf(h.home)).toContainEqual({ act: 'expire', token: 'state-changed' });
  }, 90_000);

  it('A RETURN AND A RE-ARCHIVE START A NEW WEEK: the old token refuses state-changed, and so does a young re-archive', () => {
    const a = makeArchived(h);
    const tok = expireEvalOf(h).token;
    // Brought back (every spawn path clears the whole archive), then archived again — older than a week still.
    h.sh(`_ws_unarchive ${EXP_ID}`);
    archiveAt(h, OLD + 3600);
    expect(refusedWith(expireVerb(h, tok)), 'the token bound the first archive').toBe('state-changed');
    // ...and archived again an hour ago: a new week, whatever token is offered.
    archiveAt(h, NOW - 3600);
    expect(refusedWith(expireVerb(h, tok))).toBe('not-expired');
    intact(a);
  }, 90_000);

  it('refuses every rung the ladder refuses — not-archived, child, paused, held, live — reading each itself', () => {
    const a = makeArchived(h);
    const tok = expireEvalOf(h).token;
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    expect(refusedWith(expireVerb(h, tok)), 'the switch lands AFTER the token was minted').toBe('paused');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'));
    fs.writeFileSync(reg('hold'), 'program:x wave:1/2');
    expect(refusedWith(expireVerb(h, tok))).toBe('held');
    fs.rmSync(reg('hold'));
    expect(refusedWith(expireVerb(h, tok, { pre: '_svc_is_active() { printf active; };' }))).toBe('live');
    fs.writeFileSync(reg('child'), '7\n');
    expect(refusedWith(expireVerb(h, tok))).toBe('child');
    fs.rmSync(reg('child'));
    fs.rmSync(reg('archived'));
    expect(refusedWith(expireVerb(h, tok))).toBe('not-archived');
    archiveAt(h, OLD);
    expect(fs.existsSync(a.wt)).toBe(true);
    for (const t of ['paused', 'held', 'live', 'child', 'not-archived']) {
      expect(refusalsOf(h.home), t).toContainEqual({ act: 'expire', token: t });
    }
  }, 120_000);

  it('refuses in-progress while another ccd process holds the reap lock', () => {
    const a = makeArchived(h);
    const tok = expireEvalOf(h).token;
    const r = h.run(`exec 9>>"$HOME/.cc-sessions/.reap-${EXP_ID}.lock"; flock -n 9;`
      + ` ${EXP_STUBS} cmd_ws_expire --expect ${tok} --session ${EXP_ID}`);
    expect(refusedWith(r)).toBe('in-progress');
    intact(a);
  }, 60_000);

  it('has no --defer-expired: the flag is a usage error and nothing is touched — attached, live and tree-busy are never skipped', () => {
    const a = makeArchived(h);
    const r = expireVerb(h, expireEvalOf(h).token, { extra: '--defer-expired' });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('usage: ccd ws-expire --expect <token> --session <id>');
    intact(a);
  }, 60_000);
});

describe('a crash at each phase resumes through the `expire:` breadcrumb — and re-asserts the archive first', () => {
  for (const phase of ['children', 'worktree', 'branch', 'artifacts'] as const) {
    it(`resumes at ${phase}: the tail finishes, unsupervising and killing first, and the record says it resumed`, () => {
      const a = makeArchived(h);
      interrupted(a, phase);
      const r = expireVerb(h, resumeToken(phase));
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(JSON.parse(r.stdout)['expired']).toBe(EXP_ID);
      expired(a);
      expect(unsupervised(), 'the resumed arm unsupervises too').toHaveLength(1);
      const done = eventsOf(h.home, 'expire').find((e) => e['outcome'] === 'done')!;
      expect(measOf(done)['resumed']).toBe(phase);
    }, 120_000);
  }

  it('re-asserts the epoch: archived again since the expiry began refuses state-changed; not archived, not-archived', () => {
    const a = makeArchived(h);
    interrupted(a, 'children');
    const tok = resumeToken('children');
    archiveAt(h, OLD + 60);
    expect(refusedWith(expireVerb(h, tok))).toBe('state-changed');
    fs.rmSync(reg('archived'));
    expect(refusedWith(expireVerb(h, tok))).toBe('not-archived');
    archiveAt(h, OLD);
    expect(fs.existsSync(a.wt), 'nothing was deleted').toBe(true);
    expect(h.reg(EXP_ID, 'reaping'), 'the breadcrumb stands').toBe('expire:children');
  }, 120_000);

  it('re-asserts the rest of what authorised it — the child marker, the switch, the hold — and a stale resume token', () => {
    const a = makeArchived(h);
    interrupted(a, 'worktree');
    const tok = resumeToken('worktree');
    fs.writeFileSync(reg('child'), '7\n');
    expect(refusedWith(expireVerb(h, tok))).toBe('child');
    fs.rmSync(reg('child'));
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'), '');
    expect(refusedWith(expireVerb(h, tok))).toBe('paused');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'reclaim-paused'));
    fs.writeFileSync(reg('hold'), 'x');
    expect(refusedWith(expireVerb(h, tok))).toBe('held');
    fs.rmSync(reg('hold'));
    expect(refusedWith(expireVerb(h, resumeToken('children'))), 'a token for another phase').toBe('state-changed');
    expect(fs.existsSync(a.wt)).toBe(true);
  }, 120_000);

  // RULING (D), CARRIED TO THE RESUME: at `children` the teardown has not begun — the tail has stopped nothing — so a
  // pane or a unit standing there is somebody's, and is refused `live`, never killed. From `worktree` on, the
  // interrupted run had already stopped both, and the tail's unsupervise-and-kill runs as a reclaim's.
  it('at `children`, a pane or a unit that stands refuses live — nothing is stopped, nothing deleted', () => {
    const a = makeArchived(h);
    interrupted(a, 'children');
    const tok = resumeToken('children');
    plantTmux(h, { sessions: [`cc-${EXP_ID}`] });
    expect(refusedWith(expireVerb(h, tok)), 'a detached pane').toBe('live');
    plantTmux(h, { sessions: [] });
    expect(refusedWith(expireVerb(h, tok, { pre: '_svc_is_active() { printf active; };' })), 'a running unit').toBe('live');
    expect(fs.existsSync(a.wt), 'nothing was deleted').toBe(true);
    expect(h.reg(EXP_ID, 'reaping'), 'the breadcrumb stands, for the retry').toBe('expire:children');
    expect(unsupervised(), 'the unit was not touched').toEqual([]);
    expect(h.calls(), 'the pane was not touched').not.toContain(KILL);
  }, 120_000);

  it('the CONTROL: from `worktree` on, a pane that stands is the tail’s to kill — the expiry finishes', () => {
    const a = makeArchived(h);
    interrupted(a, 'worktree');
    plantTmux(h, { sessions: [`cc-${EXP_ID}`] });
    const r = expireVerb(h, resumeToken('worktree'));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(tmuxSessions(h), 'the tail killed the pane').toEqual([]);
    expired(a);
  }, 120_000);
});

describe('a refusal reads the archived tree CONTAINED — through the verb’s own fork', () => {
  it('no hook or fsmonitor of the repository runs inside a refused ws-expire, and its index is untouched', () => {
    // The ladder runs the whole of its git reads (a wrong token refuses only at rung 10, after every one) against a
    // tree nothing has proved nobody is in: uncontained, `git status` rewrites the stale index under `index.lock` and
    // fires post-index-change. The audit wraps the fork again; THIS path has the fork's own wrapper alone.
    const a = makeArchived(h);
    plantRepoPrograms(h, a);
    const before = childIndex(h, a);
    expect(refusedWith(expireVerb(h, 'f'.repeat(64)))).toBe('state-changed');
    expect(hookRuns(h), 'a repository-configured hook or fsmonitor ran inside a refused ws-expire').toEqual([]);
    const after = childIndex(h, a);
    expect(after.bytes, 'a refused ws-expire rewrote the index').toBe(before.bytes);
    expect(after.mtimeMs, 'a refused ws-expire touched the index').toBe(before.mtimeMs);
    intact(a);
    // The CONTROL, after the subject: the same fixture runs the programs and rewrites the index for an uncontained read.
    h.sh(`git -C "${a.wt}" status --porcelain >/dev/null`);
    expect(hookRuns(h), 'the CONTROL: an uncontained status runs the repository’s programs')
      .toEqual(expect.arrayContaining(['post-index-change', 'fsmonitor']));
    expect(childIndex(h, a).bytes, 'the CONTROL: an uncontained status rewrites the stale index').not.toBe(before.bytes);
  }, 90_000);
});

describe('a failure after the act started is the expiry’s own — journaled, and resumed from an `expire:` breadcrumb', () => {
  it('a registry purge that fails leaves `expire:artifacts`, a failed document and an `expire` failed row — and the next attempt finishes', () => {
    const a = makeArchived(h);
    const r = expireVerb(h, expireEvalOf(h).token, { pre: '_reg_purge() { return 1; };' });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = JSON.parse(r.stdout) as { failed: string; detail: string };
    expect(doc.failed).toBe('purge-refused');
    expect(doc.detail).toContain('the expiry completed');
    expect(h.reg(EXP_ID, 'reaping'), 'an expiry\'s breadcrumb, never a reclaim\'s').toBe('expire:artifacts');
    const failed = eventsOf(h.home, 'expire').filter((e) => e['outcome'] === 'failed');
    expect(failed.map((e) => [e['verb'], e['refusal']])).toEqual([['ws-expire', 'purge-refused']]);
    expect(eventsOf(h.home, 'reclaim'), 'never journaled as a reclaim').toEqual([]);
    const again = expireVerb(h, resumeToken('artifacts'));
    expect(again.code, again.stdout + again.stderr).toBe(0);
    expired(a);
  }, 120_000);
});

describe('the flavour fork: no verb finishes another verb’s interrupted work', () => {
  it('ws-reap refuses an `expire:` breadcrumb — expire-in-progress, before it reads anything', () => {
    const a = makeArchived(h);
    interrupted(a, 'worktree');
    const r = h.run(`${EXP_STUBS} cmd_ws_reap --expect ${'f'.repeat(64)} --session ${EXP_ID}`);
    expect(refusedWith(r)).toBe('expire-in-progress');
    expect(fs.existsSync(a.wt)).toBe(true);
    expect(h.reg(EXP_ID, 'reaping')).toBe('expire:worktree');
  }, 90_000);

  it('ws-expire refuses a `reclaim:` breadcrumb (reclaim-in-progress) and a ws-reap one (reap-in-progress)', () => {
    const a = makeArchived(h);
    fs.writeFileSync(reg('reaping'), 'reclaim:worktree');
    expect(refusedWith(expireVerb(h, 'f'.repeat(64)))).toBe('reclaim-in-progress');
    fs.writeFileSync(reg('reaping'), 'worktree');
    expect(refusedWith(expireVerb(h, 'f'.repeat(64)))).toBe('reap-in-progress');
    intact(a);
  }, 90_000);

  it('a breadcrumb that stands but cannot be read is a failure to measure: exit 1, probe-unmeasured, nothing touched', () => {
    const a = makeArchived(h);
    fs.mkdirSync(reg('reaping'));
    const r = expireVerb(h, 'f'.repeat(64));
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ failed: 'probe-unmeasured' });
    intact(a);
  }, 60_000);
});
````


- [ ] **Step 2: Run them — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts --maxWorkers=1 )
```

Measured:

- `server/test/ccd-ws-expire-verb.test.ts`: `21 failed (21)` (every case, listed)
  - × pins, then removes the unit, worktree, branch, clips and registry row — and records what it dropped
  - × NOTHING GIT KNOWS IS LOST: every commit, stash and operation head is reachable from the attic after a gc
  - × a VANISHED worktree is expired from what is left: the branch tip pinned, the tombstone says absent
  - × refuses state-changed on a wrong token and on a tree that moved after the audit
  - × A RETURN AND A RE-ARCHIVE START A NEW WEEK: the old token refuses state-changed, and so does a young re-archive
  - × refuses every rung the ladder refuses — not-archived, child, paused, held, live — reading each itself
  - × refuses in-progress while another ccd process holds the reap lock
  - × has no --defer-expired: the flag is a usage error and nothing is touched — attached, live and tree-busy are never skipped
  - × resumes at children: the tail finishes, unsupervising and killing first, and the record says it resumed
  - × resumes at worktree: the tail finishes, unsupervising and killing first, and the record says it resumed
  - × resumes at branch: the tail finishes, unsupervising and killing first, and the record says it resumed
  - × resumes at artifacts: the tail finishes, unsupervising and killing first, and the record says it resumed
  - × re-asserts the epoch: archived again since the expiry began refuses state-changed; not archived, not-archived
  - × re-asserts the rest of what authorised it — the child marker, the switch, the hold — and a stale resume token
  - × at `children`, a pane or a unit that stands refuses live — nothing is stopped, nothing deleted
  - × the CONTROL: from `worktree` on, a pane that stands is the tail’s to kill — the expiry finishes
  - × no hook or fsmonitor of the repository runs inside a refused ws-expire, and its index is untouched
  - × a registry purge that fails leaves `expire:artifacts`, a failed document and an `expire` failed row — and the next attempt finishes
  - × ws-reap refuses an `expire:` breadcrumb — expire-in-progress, before it reads anything
  - × ws-expire refuses a `reclaim:` breadcrumb (reclaim-in-progress) and a ws-reap one (reap-in-progress)
  - × a breadcrumb that stands but cannot be read is a failure to measure: exit 1, probe-unmeasured, nothing touched
- `server/test/ccd-refusal-scan.test.ts`: `4 failed | 7 passed (11)`
  - × found every body, and each is substantial — the coverage floor
  - × every sanctioned die is STILL THERE — a stale exemption is a hole
  - × holds the expiry emits at exactly two in ws-expire — one verdict point, one flock decline (workspace lifecycle, wave 3)
  - × _ws_expire_locked contains NO die — past the lock, a failure is _lc_fail and JSON

- [ ] **Step 3: The shared tail's flavour, the verb, and ws-reap's refusal.**

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
    [[ "$resumed" != reclaim:* ]] || { _ws_reclaim_mirror "$id" "$resumed"; return 0; }   # see "WS-REAP'S MIRROR", below the RECLAIM region
````

Replace with:

````bash
    [[ "$resumed" != reclaim:* && "$resumed" != expire:* ]] || { _ws_reclaim_mirror "$id" "$resumed"; return 0; }   # see "WS-REAP'S MIRROR", below the RECLAIM region
````

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  msg="ccrc: WIP pinned at reclaim of $id (run $childof)"
````

Replace with:

````bash
  local what="reclaim of $id (run $childof)"
  [[ "$_WS_RCL_ACT" != expire ]] || what="expiry of $id (archived at $childof)"
  msg="ccrc: WIP pinned at $what"
````

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
    imsg="ccrc: index pinned at reclaim of $id (run $childof)"
````

Replace with:

````bash
    imsg="ccrc: index pinned at $what"
````

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  printf '"mode":"reclaim","childOf":%s,"worktree":%s,"wip":%s,"secretsDropped":%s,%s"containment":{"sameRepository":%s,"foreignProven":%s},"residueBytes":null,' \
    "$childof" "$(_json_str "$worktree")" "$( [[ -n "$RECLAIM_WIP" ]] && _json_str "$RECLAIM_WIP" || echo null)" \
````

Replace with:

````bash
  local bindkey=childOf; [[ "$_WS_RCL_ACT" != expire ]] || bindkey=archivedAt
  printf '"mode":%s,"%s":%s,"worktree":%s,"wip":%s,"secretsDropped":%s,%s"containment":{"sameRepository":%s,"foreignProven":%s},"residueBytes":null,' \
    "$(_json_str "$_WS_RCL_ACT")" "$bindkey" "$childof" "$(_json_str "$worktree")" "$( [[ -n "$RECLAIM_WIP" ]] && _json_str "$RECLAIM_WIP" || echo null)" \
````

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  _lc_fail reclaim "$id" "$lctx" "$tok" "$msg" verb ws-reclaim "$@"
````

Replace with:

````bash
  _lc_fail "$_WS_RCL_ACT" "$id" "$lctx" "$tok" "$msg" verb "ws-$_WS_RCL_ACT" "$@"
````

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  local holders wdreal tdir troot cdir croot kept=() k keptjson keptall treegone crc killrc dropped
  tomb="$REG/.reaped/$id.json"
````

Replace with:

````bash
  local holders wdreal tdir troot cdir croot kept=() k keptjson keptall treegone crc killrc dropped
  local noun=reclaim donekey=reclaimed bindkey=childOf
  [[ "$_WS_RCL_ACT" != expire ]] || { noun=expiry; donekey=expired; bindkey=archivedAt; }
  tomb="$REG/.reaped/$id.json"
````

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
         "breadcrumb phase 'reclaim:$phase' for $id is not one ccd ever writes — refusing to guess which steps already ran"
````

Replace with:

````bash
         "breadcrumb phase '$_WS_RCL_ACT:$phase' for $id is not one ccd ever writes — refusing to guess which steps already ran"
````

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
    _reg_set "$id" reaping reclaim:worktree
````

Replace with:

````bash
    _reg_set "$id" reaping "$_WS_RCL_ACT:worktree"
````

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
    _reg_set "$id" reaping reclaim:branch
````

Replace with:

````bash
    _reg_set "$id" reaping "$_WS_RCL_ACT:branch"
````

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
    _reg_set "$id" reaping reclaim:artifacts
````

Replace with:

````bash
    _reg_set "$id" reaping "$_WS_RCL_ACT:artifacts"
````

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
      "the reclaim completed — worktree, branch, clips and temp root are gone — and the registry row WAS purged, but $REG_PURGE_UNREMOVED could not be removed and still stands" \
````

Replace with:

````bash
      "the $noun completed — worktree, branch, clips and temp root are gone — and the registry row WAS purged, but $REG_PURGE_UNREMOVED could not be removed and still stands" \
````

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
      "the reclaim completed — worktree, branch, clips and temp root are gone — but the registry row could not be purged: the compaction lock's mechanism is absent on this box while $REG/$id.generation is present" \
      meas.branch "$branch"
    return 1
  elif (( _rcl_prc != 0 )); then
    local _rcl_why; _rcl_why=$(_compact_lock_why_remedy "$id" ws-reclaim)
    _ws_reclaim_fail "$id" "$lctx" purge-refused \
      "the reclaim completed — worktree, branch, clips and temp root are gone — but the registry row could not be purged: $_rcl_why" \
````

Replace with:

````bash
      "the $noun completed — worktree, branch, clips and temp root are gone — but the registry row could not be purged: the compaction lock's mechanism is absent on this box while $REG/$id.generation is present" \
      meas.branch "$branch"
    return 1
  elif (( _rcl_prc != 0 )); then
    local _rcl_why; _rcl_why=$(_compact_lock_why_remedy "$id" "ws-$_WS_RCL_ACT")
    _ws_reclaim_fail "$id" "$lctx" purge-refused \
      "the $noun completed — worktree, branch, clips and temp root are gone — but the registry row could not be purged: $_rcl_why" \
````

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  _lc_done reclaim "$id" "$lctx" verb ws-reclaim meas.childOf "$childof" meas.branch "$branch" \
````

Replace with:

````bash
  _lc_done "$_WS_RCL_ACT" "$id" "$lctx" verb "ws-$_WS_RCL_ACT" "meas.$bindkey" "$childof" meas.branch "$branch" \
````

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  printf '{"reclaimed":%s,"childOf":%s,"wip":%s,"attic":%s,"residueBytes":%s,"secretsDropped":%s}\n' \
    "$(_json_str "$id")" "$childof" "$( [[ -n "$wip" ]] && _json_str "$wip" || echo null)" \
````

Replace with:

````bash
  printf '{"%s":%s,"%s":%s,"wip":%s,"attic":%s,"residueBytes":%s,"secretsDropped":%s}\n' \
    "$donekey" "$(_json_str "$id")" "$bindkey" "$childof" "$( [[ -n "$wip" ]] && _json_str "$wip" || echo null)" \
````

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash

# ── end archived-workspace expiry ───────────────────────────────────────────── EXPIRE-END ──
````

Replace with:

````bash

_ws_expire_tomb_epoch() {   # tombstone -> its `archivedAt`, an integer, on stdout; rc 1 when unreadable or absent
  local f="$1"
  [[ -s "$f" ]] || return 1
  LC_ALL=C.UTF-8 python3 -c '
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    v = json.load(fh).get("archivedAt")
if type(v) is not int or v < 1:
    sys.exit(1)
sys.stdout.write(str(v))
' "$f" 2>/dev/null
}

_ws_expire_resume_eval() {   # id phase -> 0 with REAP_TOKEN = the RESUME token, else REAP_VERDICT
  # A CRASH MAY NOT LAUNDER A REFUSAL (CCR-15 §5.6, carried). What authorised
  # this expiry is re-asserted before anything else runs: the row; the ARCHIVE
  # EPOCH — still the one the tombstone recorded when the act began, and still
  # old enough (a workspace that was returned is `not-archived`; one archived
  # again since is `state-changed`); no child marker; the pause; the hold; and,
  # at `children`, rung 5's presence. The resume token binds the phase, the
  # epoch and the recorded tip.
  _ws_reclaim_reset
  local id="$1" phase="$2" tomb tombtip tombbranch tombarch
  [[ -f "$REG/$id.uuid" ]] || { _reap_refuse no-such-session "no registry entry for $id"; return 1; }
  tomb="$REG/.reaped/$id.json"
  tombarch=$(_ws_expire_tomb_epoch "$tomb") \
    || { _ws_reclaim_unmeasured "the tombstone at $tomb does not record the archive this expiry began on, so whether it is still that archive is unknown"; return 1; }
  _ws_expire_archived "$id" || return 1
  [[ "$EXPIRE_ARCHIVED_AT" == "$tombarch" ]] \
    || { _reap_refuse state-changed "$id was archived again ($EXPIRE_ARCHIVED_AT) since this expiry began on its archive of $tombarch — an interrupted expiry never finishes on another archive"; return 1; }
  _ws_expire_not_child "$id" || return 1
  [[ ! -e "$REG/reclaim-paused" && ! -L "$REG/reclaim-paused" ]] \
    || { _reap_refuse paused "reclamation is paused fleet-wide ($REG/reclaim-paused)"; return 1; }
  if [[ -e "$REG/$id.hold" ]]; then
    _reap_refuse held "$(cat "$REG/$id.hold" 2>/dev/null || echo '<unreadable — treat as held>')"; return 1
  fi
  # A PANE THAT CAME BACK IS NEVER KILLED BEFORE THE TEARDOWN BEGINS (ruling D,
  # carried to the resume). At `children` nothing has been deleted yet and the
  # tail has not stopped anything, so rung 5's two questions are asked again: a
  # pane that is up, attached or not, or a running unit, refuses `live` and the
  # breadcrumb stands for the retry. From `worktree` on, the interrupted run had
  # already stopped both and proved the pane gone, so the tail's own
  # unsupervise-and-kill runs as a reclaim's does.
  if [[ "$phase" == children ]]; then
    _session_probe "$id" anchored
    case "$PROBE_VERDICT" in
      gone|live) : ;;
      *) _ws_reclaim_unmeasured "whether $(_tmux "$id") is up could not be asked — tmux answered: ${PROBE_DETAIL:-nothing}"; return 1 ;;
    esac
    _ws_expire_presence "$id" "$PROBE_VERDICT" || return 1
  fi
  tombbranch=$(_ws_tomb_str "$tomb" branch) || tombbranch=""
  tombtip=$(_ws_tomb_str "$tomb" tip) || tombtip=""
  [[ -n "$tombbranch" ]] \
    || { _ws_reclaim_unmeasured "the tombstone at $tomb cannot be read, so which steps of the interrupted expiry already ran is unknown"; return 1; }
  REAP_BRANCH="$tombbranch"; REAP_TIP="$tombtip"
  REAP_TOKEN=$(_ws_reclaim_fingerprint "mode=expire-resume" "id=$id" "archivedAt=$tombarch" \
    "phase=$phase" "branch=$tombbranch" "tip=$tombtip")
  REAP_VERDICT=expirable
}

_ws_expire_fork() {   # id -> the flavour fork, run ONCE, contained — the one copy `ws-audit --expire` and
  #                       `ws-expire` both call. Sets REAP_* through whichever eval it runs, and
  #                       RECLAIM_RESUME_PHASE to an `expire:` breadcrumb's phase, or "" on every other path.
  _ws_reclaim_contained _ws_expire_fork_contained "$@"
}

_ws_expire_fork_contained() {   # `_ws_expire_fork`'s body, run under `_ws_reclaim_contained` — call that
  local id="$1" rbc
  RECLAIM_RESUME_PHASE=""
  rbc=$(_reg_get "$id" reaping)
  # An `expire:` breadcrumb resumes THIS verb; a `reclaim:` one is ws-reclaim's
  # and any other is ws-reap's — an expiry never finishes another verb's work,
  # and each of them refuses this one's in turn. A breadcrumb that STANDS but
  # reads as nothing is unmeasured: which verb left it, and where, is unknown.
  if [[ -z "$rbc" ]] && [[ -e "$REG/$id.reaping" || -L "$REG/$id.reaping" ]]; then
    _ws_reclaim_reset
    _ws_reclaim_unmeasured "a breadcrumb stands at $REG/$id.reaping but cannot be read — which verb left it, and at which step, is unknown" || :
  elif [[ "$rbc" == reclaim:* ]]; then
    _ws_reclaim_reset
    _reap_refuse reclaim-in-progress "an interrupted ws-reclaim of $id stopped at its '${rbc#reclaim:}' step — an expiry never finishes another verb's work" || :
  elif [[ -n "$rbc" && "$rbc" != expire:* ]]; then
    _ws_reclaim_reset
    _reap_refuse reap-in-progress "an interrupted ws-reap of $id stopped at its '$rbc' step — an expiry never finishes another verb's work" || :
  elif [[ -n "$rbc" ]]; then
    RECLAIM_RESUME_PHASE="${rbc#expire:}"
    _ws_expire_resume_eval "$id" "$RECLAIM_RESUME_PHASE" || :
  else
    _ws_expire_eval "$id" || :
  fi
}

cmd_ws_expire() {   # ccd ws-expire --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]
  # THE DESTRUCTIVE VERB FOR AN ARCHIVED WORKSPACE, composed by the server and
  # by nothing else. The token `ws-audit --expire` minted must equal the one
  # recomputed here, inside the reap lock, at the instant of deletion; it binds
  # the archive's epoch. stdout is ONE JSON line: `{"expired":…}`, a refusal
  # document at exit 0, or `{"failed":…}` at exit 1 (the breadcrumb resumes it).
  local lc_surface=none lc_actor='' lc_reason='' lc_gs=0 lc_ga=0 lc_gr=0 args=()
  while (( $# )); do
    case "$1" in
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-expire --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]"
                   lc_gs=1; lc_surface="$2"; shift 2 ;;
      --surface=*) lc_gs=1; lc_surface="${1#--surface=}"; shift ;;
      --actor)     [[ $# -ge 2 ]] || die "usage: ccd ws-expire --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]"
                   lc_ga=1; lc_actor="$2"; shift 2 ;;
      --actor=*)   lc_ga=1; lc_actor="${1#--actor=}"; shift ;;
      --reason)    [[ $# -ge 2 ]] || die "usage: ccd ws-expire --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]"
                   lc_gr=1; lc_reason="$2"; shift 2 ;;
      --reason=*)  lc_gr=1; lc_reason="${1#--reason=}"; shift ;;
      *)           args+=("$1"); shift ;;
    esac
  done
  if (( lc_gs )); then local lc_w; lc_w=$(_lc_surface_norm "$lc_surface"); lc_surface=${lc_w:-unknown}; fi
  if (( lc_ga )); then
    [[ -n "${lc_actor//[[:space:]]/}" ]] || die "--actor must be non-blank"
    _lc_dec_ok "$lc_actor" || die "--actor is longer than $_LC_DEC_MAX bytes"
  fi
  if (( lc_gr )); then
    [[ -n "${lc_reason//[[:space:]]/}" ]] || die "--reason must be non-blank"
    _lc_dec_ok "$lc_reason" || die "--reason is longer than $_LC_DEC_MAX bytes"
  fi
  set -- ${args[@]+"${args[@]}"}
  # NO `--defer-expired`: it lands in `args`, and four positionals is the only shape.
  [[ $# -eq 4 && $1 == --expect && $3 == --session ]] \
    || die "usage: ccd ws-expire --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]"
  local token=$2 id=$4
  [[ $token =~ ^[0-9a-f]{64}$ ]]         || die "bad token"
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]]         || die "bad session id"
  _json_str probe >/dev/null 2>&1 \
    || die "python3 unavailable — cannot quote the expiry record safely"
  # THE FLAVOUR, for this call and everything it reaches (THE FLAVOUR, RECLAIM region).
  local _WS_RCL_ACT=expire
  # THE SHARED LOCK: `$REG/.reap-<id>.lock`, the one ws-reap, ws-reclaim and
  # ws-restore take — and, for an archived row, every spawn path
  # (`_ws_expire_spawn_gate`) — so none of them runs on this workspace at once.
  local lock="$REG/.reap-$id.lock" lfd rc=0
  command -v flock >/dev/null 2>&1 \
    || _lc_refuse expire "$id" flock-unavailable \
         "flock (util-linux) is unavailable — refusing to run the destructive verb unserialised"
  exec {lfd}>>"$lock" \
    || _lc_refuse expire "$id" lock-unopenable "cannot open the reap lock at $lock"
  flock -n "$lfd" || {
    _lc_emit expire refused "$id" "" verb ws-expire refusal in-progress \
      detail "another ccd process is already reaping, reclaiming, expiring or restoring $id and still holds the lock"
    exec {lfd}>&-
    printf '{"refused":"in-progress","detail":%s,"paths":[]}\n' \
      "$(_json_str "another ccd process is already reaping, reclaiming, expiring or restoring $id and still holds the lock")"
    return 0
  }
  _ws_expire_locked "$token" "$id" "$lc_surface" "$lc_actor" "$lc_reason"; rc=$?
  exec {lfd}>&-
  return "$rc"
}

_ws_expire_locked() {   # token id surface actor reason — everything the shared lock serialises, for an expiry
  local token="$1" id="$2" surface="$3" actor="$4" reason="$5"
  local phase="" resumed="" declared="" lctx project workdir main clips pinned=0 start=children
  [[ "$surface" == none ]] || declared="$surface"
  _ws_expire_fork "$id"
  phase="$RECLAIM_RESUME_PHASE"; resumed="$phase"
  # The consent IS the fingerprint, recomputed HERE, inside the lock.
  if [[ "$REAP_VERDICT" == expirable && "$token" != "$REAP_TOKEN" ]]; then
    _reap_refuse state-changed "expected $REAP_TOKEN, was given $token — $id changed since the audit that minted the token" || :
  fi
  if [[ "$REAP_VERDICT" == unmeasured ]]; then
    _ws_reclaim_failed_json probe-unmeasured "$REAP_DETAIL"
    return 1
  fi
  # ONE EMIT FOR EVERY REFUSAL — this verdict point — plus the flock decline in
  # `cmd_ws_expire`: two under `verb ws-expire`, a count `ccd-refusal-scan.test.ts`
  # pins. (The audit's terminal line journals under `verb ws-audit`, outside it.)
  if [[ "$REAP_VERDICT" != expirable ]]; then
    _lc_emit expire refused "$id" "" verb ws-expire refusal "$REAP_VERDICT" detail "$REAP_DETAIL" \
      dec.surface "$surface" dec.actor "$actor" dec.reason "$reason"
    printf '{"refused":%s,"detail":%s,"paths":[]}\n' "$(_json_str "$REAP_VERDICT")" "$(_json_str "$REAP_DETAIL")"
    return 0
  fi
  project=$(_reg_get "$id" project); workdir=$(_reg_get "$id" workdir); main="$PROJECTS_ROOT/$project"
  lctx=$(_lc_tx)
  _lc_intent expire "$id" "$lctx" verb ws-expire meas.archivedAt "$EXPIRE_ARCHIVED_AT" meas.project "$project" \
    meas.workdir "$workdir" meas.branch "$REAP_BRANCH" meas.resumed "$resumed" \
    dec.surface "$surface" dec.actor "$actor" dec.reason "$reason"
  if [[ -z "$phase" ]]; then
    # THE PIN PHASE, before anything is destroyed, then the tombstone (its
    # `mode` is `expire`, its binding `archivedAt`), then the `expire:`
    # breadcrumb — every later step resumable, and described by a record that
    # outlives the row. A vanished worktree takes the RECLAIM region's own arm.
    if [[ "$RECLAIM_WORKTREE" == absent ]]; then
      _ws_reclaim_pin_absent "$id" "$main" "$REAP_BRANCH" "$RECLAIM_HEAD" "$workdir" && pinned=1
      start=branch
    else
      _ws_reclaim_pin "$id" "$workdir" "$main" "$REAP_BRANCH" "$EXPIRE_ARCHIVED_AT" && pinned=1
    fi
    if (( ! pinned )); then
      _ws_reclaim_fail "$id" "$lctx" pin-failed "$RECLAIM_PIN_WHY"
      return 1
    fi
    clips=$(_ws_clip_manifest "$id") || clips=null
    _ws_tombstone "$id" "$clips" "$(_ws_reclaim_tomb_fields "$EXPIRE_ARCHIVED_AT" "$RECLAIM_WORKTREE")" >/dev/null
    if [[ ! -s "$REG/.reaped/$id.json" ]] \
       || [[ "$(_ws_tomb_str "$REG/.reaped/$id.json" uuid)" != "$(_reg_get "$id" uuid)" ]] \
       || ! _reg_set "$id" reaping "expire:$start"; then
      _ws_reclaim_fail "$id" "$lctx" tombstone-unwritable "could not write the tombstone or the breadcrumb for $id — nothing was destroyed"
      return 1
    fi
    phase="$start"
  fi
  _ws_reclaim_tail "$id" "$phase" "$lctx" "$EXPIRE_ARCHIVED_AT" "$surface" "$declared" "$resumed"
}

# ── end archived-workspace expiry ───────────────────────────────────────────── EXPIRE-END ──
````

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
_ws_reclaim_mirror() {   # id breadcrumb -> ws-reap's refusal of a `reclaim:` breadcrumb, on stdout
````

Replace with:

````bash
_ws_reclaim_mirror() {   # id breadcrumb -> ws-reap's refusal of a `reclaim:` or an `expire:` breadcrumb, on stdout
  if [[ "$2" == expire:* ]]; then   # ws-expire's interrupted work (workspace lifecycle, spec 2026-09-24 §5.3)
    printf '{"refused":"expire-in-progress","detail":%s,"paths":[]}\n' \
      "$(_json_str "an interrupted expiry of $1 stopped at its '${2#expire:}' step — ws-reap never finishes another verb's work")"
    return 0
  fi
````

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  # stale, or a crashed reclaim resumes. Pausing stops reclamation and nothing
  # else; lowering it lets the sweep drain what waited.
````

Replace with:

````bash
  # stale, or a crashed reclaim resumes. Pausing stops reclamation and — since
  # workspace lifecycle wave 3 — the seven-day expiry of an archived workspace,
  # which reads this same file at the same rung 3 (`_ws_reclaim_ladder`) and on
  # its resume, and nothing else; lowering it lets the sweep drain what waited.
````

<!-- replay: T4 replace server/src/wsaudit.ts -->
In `server/src/wsaudit.ts`, find:

````ts
  'live': 'This archived workspace has a session running — a pane, or a service that would start one — so nothing was removed. The cleanup tries again later.',
};
````

Replace with:

````ts
  'live': 'This archived workspace has a session running — a pane, or a service that would start one — so nothing was removed. The cleanup tries again later.',
  'expire-in-progress': 'An interrupted seven-day cleanup of this workspace is waiting to finish, and ws-reap never finishes another verb’s work. Nothing was removed.',
};
````


- [ ] **Step 4: Re-stamp ccd and run.**

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-verb.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-refusal-scan.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/wsaudit.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ownership.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-wsaudit-nonpoison.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pause.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
```

Measured (the census and nonpoison reds are Step 5's taxes):

- `server/test/ccd-ws-expire-verb.test.ts`: `21 passed (21)`
- `server/test/ccd-refusal-scan.test.ts`: `11 passed (11)`
- `server/test/wsaudit.test.ts`: `25 passed (25)`
- `server/test/ownership.test.ts`: `14 passed (14)`
- `server/test/ccd-reg-get-census.test.ts`: `1 failed | 2 passed (3)`
  - × both numbers the header claims match what its own cited commands count
- `server/test/ccd-wsaudit-nonpoison.test.ts`: `1 failed | 2 passed (3)`
  - × leaves the token set OUTSIDE the reclaim region at exactly the 55 that shipped before build 9
- `server/test/ccd-child-reclaim-pause.test.ts`: `13 passed (13)`
- `server/test/session-hook.test.ts` (`-t` the citation cases): `5 passed | 330 skipped (335)`

- [ ] **Step 5: Pay the taxes** — the census (measured), the nonpoison count (re-measured: `expire-in-progress` entered, in the MIRROR block), and the pause pin's third reader. Measured on this base:

<!-- replay: T4 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
# and the reason is a count rather than a preference: this file makes 181
# invocations across 152 non-comment lines.
````

Replace with:

````bash
# and the reason is a count rather than a preference: this file makes 185
# invocations across 155 non-comment lines.
````

<!-- replay: T4 replace server/test/ccd-child-reclaim-pause.test.ts -->
In `server/test/ccd-child-reclaim-pause.test.ts`, find:

````ts
    for (const name of ['_ws_reclaim_ladder', '_ws_reclaim_resume_eval']) {
````

Replace with:

````ts
    for (const name of ['_ws_reclaim_ladder', '_ws_reclaim_resume_eval', '_ws_expire_resume_eval']) {
````

<!-- replay: T4 replace server/test/ccd-wsaudit-nonpoison.test.ts -->
In `server/test/ccd-wsaudit-nonpoison.test.ts`, find:

````ts
    const full = readFileSync(CCD, 'utf8');
    expect.soft(scan(full)).toHaveLength(65);
    expect.soft(scan(full).filter((t) => !scan(src).includes(t)))
      .toEqual(['attached', 'child', 'containment-unproven', 'live', 'not-a-child', 'not-expired', 'paused',
        'reap-in-progress', 'reclaim-in-progress', 'tree-busy']);
````

Replace with:

````ts
    // 65 -> 66 (Task 4, the verb): `expire-in-progress`, ws-reap's refusal of an `expire:`
    // breadcrumb, in the MIRROR block beside its reclaim twin; the rest of the
    // verb's words are already counted. The scan outside the blocks answers 55.
    const full = readFileSync(CCD, 'utf8');
    expect.soft(scan(full)).toHaveLength(66);
    expect.soft(scan(full).filter((t) => !scan(src).includes(t)))
      .toEqual(['attached', 'child', 'containment-unproven', 'expire-in-progress', 'live', 'not-a-child',
        'not-expired', 'paused', 'reap-in-progress', 'reclaim-in-progress', 'tree-busy']);
````


```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
( cd server && ./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-wsaudit-nonpoison.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pause.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-reap.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
```

Measured:

- `server/test/ccd-reg-get-census.test.ts`: `3 passed (3)`
- `server/test/ccd-wsaudit-nonpoison.test.ts`: `3 passed (3)`
- `server/test/ccd-child-reclaim-pause.test.ts`: `13 passed (13)`
- `server/test/ccd-ws-reap.test.ts`: `114 passed (114)`
- `server/test/session-hook.test.ts` (`-t` the citation cases): `5 passed | 330 skipped (335)`

And the RECLAIM machinery this task made flavour-aware, unchanged for a reclaim — each its own process (the three verb files take minutes each; run them in the foreground with the 600 s timeout, one after another):

```bash
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-tail.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-verb-reflogs.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-pin.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-hardening.test.ts --maxWorkers=1 )
```

Expected: all pass (Pre-flight finding 11's counts: 70, 74, 49, 74, 98). Measured on this revision's final tree over `4100ae1c9`: `ccd-child-reclaim-verb` 70 passed; `-verb-reflogs` 49 passed; `-verb-tail` `1 failed | 73 passed (74)` under a load average near 40 (`a registry row rooted INSIDE the child … stops a RESUMED tail`, `Test timed out in 90000ms`) and `2 passed` when that case was re-run alone; `-pin` `1 failed | 73 passed (74)` the same way (`FAILS when a hidden edit cannot be READ`, `timed out in 60000ms`; `1 passed` alone); `-hardening` `1 failed | 97 passed (98)` the same way (`a clean, pushed clone holding a commit only its reflog names`; `1 passed` alone). Load, by the rule in Pre-flight's opening paragraph: re-run a red case IN ISOLATION before calling it a break.

- [ ] **Step 6: Mutation check, then commit.**

| # | Edit (restore after; re-stamp after a `ccd/ccd` edit) | Measured red |
|---|---|---|
| M4.1 | the tail's last breadcrumb written as a reclaim's. `ccd/ccd`: `    _reg_set "$id" reaping "$_WS_RCL_ACT:artifacts"⏎` → `    _reg_set "$id" reaping reclaim:artifacts⏎` | `server/test/ccd-ws-expire-verb.test.ts` `-t 'registry purge that fails'`: 1 failed \| 20 skipped (21) — red: a registry purge that fails leaves `expire:artifacts`, a failed document and an `expire` failed row — and the next attempt finishes |
| M4.2 | `_ws_reclaim_fail` journals every failure as a reclaim. `ccd/ccd`: `  _lc_fail "$_WS_RCL_ACT" "$id" "$lctx" "$tok" "$msg" verb "ws-$_WS_RCL_ACT" "$@"⏎` → `  _lc_fail reclaim "$id" "$lctx" "$tok" "$msg" verb ws-reclaim "$@"⏎` | `server/test/ccd-ws-expire-verb.test.ts` `-t 'registry purge that fails'`: 1 failed \| 20 skipped (21) — red: a registry purge that fails leaves `expire:artifacts`, a failed document and an `expire` failed row — and the next attempt finishes |
| M4.3 | the tombstone always says `mode: reclaim`, `childOf`. `ccd/ccd`: `  local bindkey=childOf; [[ "$_WS_RCL_ACT" != expire ]] \|\| bindkey=archivedAt⏎  printf '"mode":%s,"%s":%s,"worktree":%s,` → `  local bindkey=childOf⏎  printf '"mode":"reclaim","%s":%s,"worktree":%s,` | `server/test/ccd-ws-expire-verb.test.ts` `-t 'a fresh expiry'`: 3 failed \| 18 skipped (21) — red: pins, then removes the unit, worktree, branch, clips and registry row — and records what it dropped (+2 more) |
| M4.4 | the resume no longer compares the archive's epoch with the record's. `ccd/ccd`: `  [[ "$EXPIRE_ARCHIVED_AT" == "$tombarch" ]] \⏎    \|\| {` → `  true \⏎    \|\| {` | `server/test/ccd-ws-expire-verb.test.ts` `-t 're-asserts the epoch'`: 1 failed \| 20 skipped (21) — red: re-asserts the epoch: archived again since the expiry began refuses state-changed; not archived, not-archived |
| M4.5 | the resume no longer asks for a child marker. `ccd/ccd`: `  _ws_expire_not_child "$id" \|\| return 1⏎  [[ ! -e "$REG/reclaim-paused"` → `  [[ ! -e "$REG/reclaim-paused"` | `server/test/ccd-ws-expire-verb.test.ts` `-t 're-asserts the rest'`: 1 failed \| 20 skipped (21) — red: re-asserts the rest of what authorised it — the child marker, the switch, the hold — and a stale resume token |
| M4.6 | the fork's `reclaim:` arm deleted (it falls to ws-reap's word). `ccd/ccd`: `  elif [[ "$rbc" == reclaim:* ]]; then⏎    _ws_reclaim_reset⏎    _reap_refuse reclaim-in-progress` → `  elif false; then⏎    _ws_reclaim_reset⏎    _reap_refuse reclaim-in-progress` | `server/test/ccd-ws-expire-verb.test.ts` `-t 'flavour fork'`: 1 failed \| 2 passed \| 18 skipped (21) — red: ws-expire refuses a `reclaim:` breadcrumb (reclaim-in-progress) and a ws-reap one (reap-in-progress) |
| M4.7 | ws-reap's line no longer sees an `expire:` breadcrumb. `ccd/ccd`: `    [[ "$resumed" != reclaim:* && "$resumed" != expire:* ]] \|\| {` → `    [[ "$resumed" != reclaim:* ]] \|\| {` | `server/test/ccd-ws-expire-verb.test.ts` `-t 'ws-reap refuses'`: 1 failed \| 20 skipped (21) — red: ws-reap refuses an `expire:` breadcrumb — expire-in-progress, before it reads anything |
| M4.8 | the verb's token check deleted. `ccd/ccd`: `  if [[ "$REAP_VERDICT" == expirable && "$token" != "$REAP_TOKEN" ]]; then` → `  if false; then` | `server/test/ccd-ws-expire-verb.test.ts` `-t 'state-changed'`: 2 failed \| 1 passed \| 18 skipped (21) — red: refuses state-changed on a wrong token and on a tree that moved after the audit (+1 more) |
| M4.9 | the WIP subject is a reclaim's. `ccd/ccd`: `  [[ "$_WS_RCL_ACT" != expire ]] \|\| what="expiry of $id (archived at $childof)"⏎` → (deleted) | `server/test/ccd-ws-expire-verb.test.ts` `-t 'a fresh expiry'`: 1 failed \| 2 passed \| 18 skipped (21) — red: pins, then removes the unit, worktree, branch, clips and registry row — and records what it dropped |
| M4.10 | the verb accepts `--defer-expired` (and drops it). `ccd/ccd`: `      --surface)   [[ $# -ge 2 ]] \|\| die "usage: ccd ws-expire` → `      --defer-expired) shift ;;⏎      --surface)   [[ $# -ge 2 ]] \|\| die "usage: ccd ws-expire` | `server/test/ccd-ws-expire-verb.test.ts` `-t 'defer-expired'`: 1 failed \| 20 skipped (21) — red: has no --defer-expired: the flag is a usage error and nothing is touched — attached, live and tree-busy are never skipped |
| M4.11 | a second refusal emit in the verb (outside the verdict point). `ccd/ccd`: ``     _ws_reclaim_failed_json probe-unmeasured "$REAP_DETAIL"⏎    return 1⏎  fi⏎  # ONE EMIT FOR EVERY REFUSAL — this verdict point — plus the flock decline in⏎  # `cmd_ws_expire`: two `` → ``     _lc_emit expire refused "$id" "" verb ws-expire refusal unmeasured⏎    _ws_reclaim_failed_json probe-unmeasured "$REAP_DETAIL"⏎    return 1⏎  fi⏎  # ONE EMIT FOR EVERY REFUSAL — this verdict point — plus the flock decline in⏎  # `cmd_ws_expire`: two `` | `server/test/ccd-refusal-scan.test.ts` `-t 'expiry emits'`: 1 failed \| 10 skipped (11) — red: holds the expiry emits at exactly two in ws-expire — one verdict point, one flock decline (workspace lifecycle, wave 3) |
| M4.12 | the resume's presence question at `children` deleted (a pane that came back is killed before the teardown began). `ccd/ccd`: `  if [[ "$phase" == children ]]; then⏎    _session_probe "$id" anchored⏎` → `  if false; then⏎    _session_probe "$id" anchored⏎` | `server/test/ccd-ws-expire-verb.test.ts` `-t 'nothing is stopped, nothing deleted'`: 1 failed \| 20 skipped (21) — red: at `children`, a pane or a unit that stands refuses live — nothing is stopped, nothing deleted |
| M4.13 | the verb path's containment removed — the fork runs uncontained (the audit keeps its own wrapper, so only the verb's pin can see it). `ccd/ccd`: `  _ws_reclaim_contained _ws_expire_fork_contained "$@"⏎` → `  _ws_expire_fork_contained "$@"⏎` | `server/test/ccd-ws-expire-verb.test.ts` `-t 'CONTAINED'`: 1 failed \| 20 skipped (21) — red: no hook or fsmonitor of the repository runs inside a refused ws-expire, and its index is untouched<br>`server/test/ccd-ws-expire-audit.test.ts` `-t 'CONTAINED'`: 1 passed \| 10 skipped (11) |

```bash
git add ccd/ccd server/src/wsaudit.ts server/test/ccd-ws-expire-verb.test.ts server/test/ccd-refusal-scan.test.ts \
  server/test/ccd-wsaudit-nonpoison.test.ts server/test/ccd-child-reclaim-pause.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): ws-expire — the archived workspace's pin-then-teardown

cmd_ws_expire takes the reap lock, re-proves the audit's token (which binds
the archive epoch) and runs child reclamation's pin phase and tail under
the expire flavour: expire: breadcrumbs, the expire act, a tombstone of
mode expire with archivedAt. A crash resumes from the breadcrumb after
re-asserting the epoch, the child marker, the switch and the hold, and —
at children, before anything was stopped — refusing a pane or unit that
stands. No --defer-expired. ws-reap refuses an expire: breadcrumb (expire-in-progress);
ws-expire refuses reclaim: and ws-reap breadcrumbs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: A return during an expiry refuses — on every spawn path, before anything is journaled

**Model routing:** **`opus`, effort `high`** — every path that brings a session back, and a lock taken on the hottest path in ccd.

**Files:** red `server/test/ccd-ws-expire-spawn.test.ts`; green `ccd/ccd`; tax `ccd/ccd`, `server/test/ccd-die-containment.test.ts`.

**Interfaces:**
- Produces (ccd): `_ws_expire_spawn_gate id` (rc 1 with `_WS_EXPIRE_SPAWN_WHY` on an `expire:` breadcrumb, or — for an ARCHIVED row — on a reap lock another process holds; rc 0 holding that lock in `_WS_EXPIRE_SPAWN_FD`), `_ws_expire_spawn_release`, `_ws_expire_breadcrumb_why id`, `_ws_expire_refuse_return id` (the gate asked early and let go: dies with the sentence).
- Changes: `cmd_start`, `cmd_ensure`, `cmd_swap` and `cmd_enable` call `_ws_expire_refuse_return "$id"` before they write a field or journal their act (`cmd_enable` before its `_lc_done enable`, which runs before it calls `cmd_start`); on an ARCHIVED row the gate also refuses a `.reaping` that stands but reads as nothing (a directory, an unreadable file, a dangling link), as `_ws_expire_fork` reads one, and `_ws_expire_breadcrumb_why` answers it for ws-restore; `cmd_ws_restore` refuses `in-progress` (an existing journal token) on an `expire:` breadcrumb, under the lock it holds, on its existing archive-check line; `_spawn_start` calls the gate before its archive arm and releases it after.

- [ ] **Step 1: Write the failing tests.**

<!-- replay: T5 create server/test/ccd-ws-expire-spawn.test.ts -->
Create `server/test/ccd-ws-expire-spawn.test.ts`:

````ts
// A RETURN DURING AN EXPIRY REFUSES (workspace lifecycle spec 2026-09-24 §5.3), on every path that creates a pane.
//
// THE CENSUS, measured: a session's pane is created by `_spawn_start` and nowhere else (`_tmux_new_session`'s callers
// are `_spawn_start` and `cmd_account_pane`, whose pane is an account's, not a session's). Its callers are `cmd_start`,
// `cmd_ensure` (in a unit — the `supervise` ExecStart's path — and outside one), `_supervised_start`'s two unsupervised
// fallbacks, `cmd_ws_restore` and `cmd_ws_add`; `cmd_swap`, `cmd_attach`, `cmd_menu` and the server's Revive reach it
// through `cmd_ensure`, `cmd_supervise` through `cmd_ensure` in its unit, `cmd_enable` (which journals `enable` first)
// through `cmd_start`, `cmd_swap_self` through `cmd_swap`, and `_swap_refuse` through a unit start or `cmd_ensure`.
// NONE of them honoured a breadcrumb before this wave: only `ws-restore` took the reap lock. So each RETURN VERB refuses
// the breadcrumb itself before it journals its act (`_ws_expire_refuse_return` in `cmd_start`, `cmd_ensure`, `cmd_swap`,
// `cmd_enable`), `ws-restore` — which clears the archive
// BEFORE it calls `_spawn_start` — asks it under its lock, and `_spawn_start`'s own gate (`_ws_expire_spawn_gate`) is
// the backstop under all of them. `ws-add` honours it by construction: a standing `.reaping` keeps the slug taken.
// Two windows: after a crash the `expire:` breadcrumb stands (refused by it); during the act the expiry holds the reap
// lock and `.archived` still stands (a spawn that would clear the stamp takes that lock first, and refuses).
// FIXTURE HOME ONLY.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, WS_ADD, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf, refusalsOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ws-expire-spawn-'); });
afterEach(() => { h.cleanup(); });

const ID = 'proj-quiet-dune';
/** The real `_spawn_start`, stopped at the pane: the gate runs BEFORE `tname=$(_tmux …)`, so a tmux that always
 *  fails still exercises it — and its record says whether anything asked tmux for a pane at all. */
const SPAWN_STUBS = 'sleep() { :; }; tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };'
  + ' _accept_first_run_prompts() { return 0; }; _have_systemctl() { return 1; };';
const reg = (field: string): string => path.join(h.home, '.cc-sessions', `${ID}.${field}`);
const exists = (field: string): boolean => fs.existsSync(reg(field));
const tmuxCalls = (): string[] => {
  const f = path.join(h.home, 'ccd-calls');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('tmux new-session')) : [];
};

/** An archived workspace, as `ws-archive` leaves it. */
const archived = (): void => {
  h.makeRepo('proj');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-dune cmd_ws_add proj`);
  fs.writeFileSync(reg('archived'), '1786431390\n');
  fs.writeFileSync(reg('archivedreason'), 'operator\n');
  fs.writeFileSync(reg('archivemanifest'), '{"paths":[]}\n');
};
/** An expiry that died after its pin phase: the `expire:` breadcrumb stands; `.archived` does too. */
const interruptedExpiry = (phase = 'worktree'): void => { fs.writeFileSync(reg('reaping'), `expire:${phase}\n`); };
/** Runs `snippet` with the stubs, answering instead of throwing. */
const run = (snippet: string): { code: number; out: string } => {
  try { return { code: 0, out: h.sh(`${SPAWN_STUBS} ${snippet} 2>&1`) }; } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${String(err.stdout ?? '')}${String(err.stderr ?? '')}` };
  }
};
/** The archive and the breadcrumb both stand, no pane was asked for, and no return was journaled — not even the
 *  attempt: a `start`/`ensure`/`swap` row the instrument would pair with the archive as a return seven days late
 *  (`deploy/measure-workspace-lifecycle.py`, spec §9's kill rule). */
const untouched = (): void => {
  expect(exists('archived'), 'the archive stamp stands').toBe(true);
  expect(exists('archivedreason'), 'and all of it').toBe(true);
  expect(tmuxCalls(), 'no pane was created').toEqual([]);
  for (const act of ['unarchive', 'start', 'ensure', 'swap', 'restore', 'enable']) {
    expect(eventsOf(h.home, act).filter((e) => e['outcome'] === 'done'), `no ${act} journaled`).toEqual([]);
  }
};

describe('after a crash: the `expire:` breadcrumb refuses every spawn path', () => {
  it('_spawn_start itself — the one place a session pane is made', () => {
    archived(); interruptedExpiry();
    const r = run(`_spawn_start ${ID} resume`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(`${ID} is being expired`);
    expect(r.out).toContain("'worktree' step");
    untouched();
  });

  it('ensure in its unit — the `supervise` ExecStart’s path, and so every Restart=always respawn', () => {
    archived(); interruptedExpiry('branch');
    const r = run(`CCD_IN_UNIT=1 cmd_ensure ${ID}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('being expired');
    untouched();
  });

  it('ensure outside a unit — what Revive, swap, attach and menu reach — through `_supervised_start`’s fallback', () => {
    archived(); interruptedExpiry('children');
    const r = run(`cmd_ensure ${ID}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('being expired');
    untouched();
  });

  it('start <id>', () => {
    archived(); interruptedExpiry('artifacts');
    const r = run(`cmd_start ${ID}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('being expired');
    untouched();
  });

  it('swap — refused before it moves the transcript or journals the swap', () => {
    archived(); interruptedExpiry();
    const wrapper = h.sh(`_reg_get ${ID} wrapper`);
    const target = wrapper === 'claude-b' ? 'claude-a' : 'claude-b';
    const r = run(`cmd_swap ${ID} ${target}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('being expired');
    expect(h.sh(`_reg_get ${ID} wrapper`), 'the account did not move').toBe(wrapper);
    untouched();
  });

  it('enable <id> — the alias of start the server composes, refused before it journals `enable`', () => {
    archived(); interruptedExpiry();
    const r = run(`cmd_enable ${ID}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('being expired');
    untouched();
  });

  it('an ARCHIVED row whose breadcrumb stands but cannot be read refuses too — at `_spawn_start` and at ws-restore', () => {
    archived();
    fs.mkdirSync(reg('reaping'));
    const r = run(`_spawn_start ${ID} resume`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('cannot be read');
    untouched();
    const s = run(`cmd_ws_restore --session ${ID}`);
    expect(s.code).not.toBe(0);
    expect(s.out).toContain('cannot be read');
    untouched();
  });

  it('ws-add never mints a row over a standing breadcrumb — the slug is taken while any file of the id stands', () => {
    h.makeRepo('proj');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${ID}.reaping`), 'expire:artifacts\n');
    const r = run(`${WS_ADD} CCD_WS_SLUG=quiet-dune cmd_ws_add proj`);
    expect(r.code).not.toBe(0);
    expect(exists('uuid'), 'no row was minted under the id').toBe(false);
  });

  it('ws-restore — refused in-progress under the lock it takes, before it clears anything', () => {
    archived(); interruptedExpiry();
    const r = run(`cmd_ws_restore --session ${ID}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('being expired');
    untouched();
    expect(refusalsOf(h.home)).toContainEqual({ act: 'restore', token: 'in-progress' });
  });

  it('a `reclaim:` or ws-reap breadcrumb is NOT this gate’s — those spawn paths behave as they did', () => {
    archived();
    fs.writeFileSync(reg('reaping'), 'worktree\n');
    run(`_spawn_start ${ID} resume`);
    expect(exists('archived'), 'the spawn cleared the archive, as it always has').toBe(false);
  });
});

describe('during the act: a spawn that would clear the archive takes the reap lock first, and refuses while it is held', () => {
  it('another process holds `$REG/.reap-<id>.lock` (an expiry between its ladder and its last deletion) — refused, nothing cleared', () => {
    archived();
    const r = run(`exec 9>>"$HOME/.cc-sessions/.reap-${ID}.lock"; flock -n 9; _spawn_start ${ID} resume`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('still holds the lock');
    untouched();
  });

  it('the same for ensure in its unit', () => {
    archived();
    const r = run(`exec 9>>"$HOME/.cc-sessions/.reap-${ID}.lock"; flock -n 9; CCD_IN_UNIT=1 cmd_ensure ${ID}`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('still holds the lock');
    untouched();
  });

  it('the CONTROL: nobody holds it — the spawn clears the archive as before, and gives the lock back IN ITS OWN PROCESS', () => {
    archived();
    // Asked in the SAME shell, after the spawn: a lock leaked by `_spawn_start` stays held by this process's open
    // descriptor and refuses a second open's `flock -n` — the shape of `cmd_supervise`, one process for the unit's
    // life, which would otherwise hold every row it ever unarchived against every later reap, expiry and restore.
    // (A second process would see it free whatever happened: the descriptor dies with the shell.)
    const out = run(`_spawn_start ${ID} resume; exec 8>>"$HOME/.cc-sessions/.reap-${ID}.lock"; flock -n 8 && echo FREE || echo HELD`).out;
    expect(exists('archived')).toBe(false);
    expect(eventsOf(h.home, 'unarchive')).toHaveLength(1);
    expect(out.trim().split('\n').pop(), 'released, not leaked').toBe('FREE');
  });

  it('the CONTROL: a row that is NOT archived takes no lock at all — a held lock refuses nothing there', () => {
    h.makeRepo('proj');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-dune cmd_ws_add proj`);
    const r = run(`exec 9>>"$HOME/.cc-sessions/.reap-${ID}.lock"; flock -n 9; _spawn_start ${ID} resume`);
    expect(r.out).not.toContain('still holds the lock');
    expect(tmuxCalls().length, 'it went on to ask tmux for the pane').toBeGreaterThan(0);
  });
});

describe('the census holds — no session pane is made outside the gated function', () => {
  const src = fs.readFileSync(CCD, 'utf8');
  /** The function each non-comment line belongs to (top-level `name() {` openers). */
  const owners = (re: RegExp): string[] => {
    let fn = '-';
    const out: string[] = [];
    for (const line of src.split('\n')) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\(\) *\{/.exec(line);
      if (m) fn = m[1]!;
      if (!/^\s*#/.test(line) && re.test(line)) out.push(fn);
    }
    return out;
  };

  it('`_tmux_new_session` is called from `_spawn_start` and from `cmd_account_pane` (an account’s pane) only', () => {
    expect([...new Set(owners(/_tmux_new_session /).filter((f) => f !== '_tmux_new_session'))].sort())
      .toEqual(['_spawn_start', 'cmd_account_pane']);
    expect(owners(/(^|[^_])tmux new-session/).filter((f) => f !== '_tmux_new_session'), 'no bare tmux new-session elsewhere').toEqual([]);
  });

  it('every return verb refuses the breadcrumb itself BEFORE it journals its act', () => {
    const bodyOf = (name: string): string => {
      const from = src.indexOf(`\n${name}() {`);
      return src.slice(from, src.indexOf('\n}\n', from));
    };
    for (const [verb, act] of [['cmd_start', '_lc_done start'], ['cmd_ensure', '_lc_done ensure'], ['cmd_swap', '_lc_done swap'],
      ['cmd_enable', '_lc_done enable']] as const) {
      const body = bodyOf(verb);
      const ask = body.indexOf('_ws_expire_refuse_return "$id"');
      expect(ask, `${verb} asks`).toBeGreaterThan(0);
      expect(ask, `${verb} asks before it journals`).toBeLessThan(body.indexOf(act));
    }
    expect(bodyOf('cmd_ws_restore').indexOf('_ws_expire_breadcrumb_why "$id"'), 'ws-restore asks under its lock')
      .toBeGreaterThan(bodyOf('cmd_ws_restore').indexOf('flock -n "$lfd"'));
    expect(owners(/(^|[^_a-z])cmd_ensure "\$id"/), 'supervise, swap, attach and menu reach a pane through ensure')
      .toEqual(expect.arrayContaining(['cmd_supervise', 'cmd_swap', 'cmd_attach', 'cmd_menu']));
  });

  it('`_spawn_start` asks the gate BEFORE it clears the archive and before its first pane', () => {
    const body = src.slice(src.indexOf('_spawn_start() {'), src.indexOf('\n}\n', src.indexOf('_spawn_start() {')));
    const gate = body.indexOf('_ws_expire_spawn_gate "$id"');
    expect(gate, 'the gate is called').toBeGreaterThan(0);
    expect(gate).toBeLessThan(body.indexOf('_ws_unarchive "$id"'));
    expect(gate).toBeLessThan(body.indexOf('_tmux_new_session'));
    expect(body.indexOf('_ws_expire_spawn_release')).toBeGreaterThan(body.indexOf('_ws_unarchive "$id"'));
  });
});
````


- [ ] **Step 2: Run them — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-spawn.test.ts --maxWorkers=1 )
```

Measured (the five passes: the three CONTROLS, `ws-add`'s by-construction refusal, and the census of where a session pane is made — both true before this task):

- `server/test/ccd-ws-expire-spawn.test.ts`: `12 failed | 5 passed (17)`
  - × _spawn_start itself — the one place a session pane is made
  - × ensure in its unit — the `supervise` ExecStart’s path, and so every Restart=always respawn
  - × ensure outside a unit — what Revive, swap, attach and menu reach — through `_supervised_start`’s fallback
  - × start <id>
  - × swap — refused before it moves the transcript or journals the swap
  - × enable <id> — the alias of start the server composes, refused before it journals `enable`
  - × an ARCHIVED row whose breadcrumb stands but cannot be read refuses too — at `_spawn_start` and at ws-restore
  - × ws-restore — refused in-progress under the lock it takes, before it clears anything
  - × another process holds `$REG/.reap-<id>.lock` (an expiry between its ladder and its last deletion) — refused, nothing cleared
  - × the same for ensure in its unit
  - × every return verb refuses the breadcrumb itself BEFORE it journals its act
  - × `_spawn_start` asks the gate BEFORE it clears the archive and before its first pane

- [ ] **Step 3: The gate, the verbs' refusal, and ws-restore's.** The lock half is a departure (`spawn-gate-takes-the-reap-lock`): it refuses a spawn of an archived row whoever holds the lock — an expiry, a human's `ws-reap`, a `ws-restore` — where the spawn used to clear the archive underneath them. The unreadable-breadcrumb arm is another (`spawn-gate-refuses-an-unreadable-breadcrumb`), asked of an archived row only.

<!-- replay: T5 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  [[ -f "$REG/$id.archived" ]]   || _lc_refuse restore "$id" not-archived "not archived: $id"
````

Replace with:

````bash
  [[ -f "$REG/$id.archived" ]]   || _lc_refuse restore "$id" not-archived "not archived: $id"; ! _ws_expire_breadcrumb_why "$id" >/dev/null || _lc_refuse restore "$id" in-progress "$(_ws_expire_breadcrumb_why "$id")"
````

<!-- replay: T5 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  # fallbacks in `_supervised_start`.
  if [[ -f "$REG/$id.archived" ]]; then
````

Replace with:

````bash
  # fallbacks in `_supervised_start`.
  # A RETURN DURING AN EXPIRY REFUSES, here, where every spawn path meets
  # (`_ws_expire_spawn_gate`, the EXPIRE region, says which paths and why).
  _ws_expire_spawn_gate "$id" || die "$_WS_EXPIRE_SPAWN_WHY"
  if [[ -f "$REG/$id.archived" ]]; then
````

<!-- replay: T5 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  fi
  tname=$(_tmux "$id")
````

Replace with:

````bash
  fi
  _ws_expire_spawn_release
  tname=$(_tmux "$id")
````

<!-- replay: T5 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  fi

  if _alive "$id"; then
    # M5's shape, reachable from a keyboard: a live pane whose unit was never enabled, or was
````

Replace with:

````bash
  fi

  _ws_expire_refuse_return "$id"   # a return during an expiry refuses, before anything is journaled (EXPIRE region)
  if _alive "$id"; then
    # M5's shape, reachable from a keyboard: a live pane whose unit was never enabled, or was
````

<!-- replay: T5 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  [[ -f "$REG/$id.uuid" ]] || die "no registry for '$id' (run ccd start first)"
  if _alive "$id"; then
````

Replace with:

````bash
  [[ -f "$REG/$id.uuid" ]] || die "no registry for '$id' (run ccd start first)"
  _ws_expire_refuse_return "$id"   # a return during an expiry refuses, before anything is journaled (EXPIRE region)
  if _alive "$id"; then
````

<!-- replay: T5 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  [[ -f "$REG/$id.uuid" ]] || die "no registry for '$id'"
  local cur; cur=$(_reg_get "$id" wrapper)
````

Replace with:

````bash
  [[ -f "$REG/$id.uuid" ]] || die "no registry for '$id'"
  _ws_expire_refuse_return "$id"   # a return during an expiry refuses, before anything is journaled (EXPIRE region)
  local cur; cur=$(_reg_get "$id" wrapper)
````

<!-- replay: T5 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  _lc_done enable "$id" ""
````

Replace with:

````bash
  _ws_expire_refuse_return "$id"   # a return during an expiry refuses, before anything is journaled (EXPIRE region)
  _lc_done enable "$id" ""
````

<!-- replay: T5 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash

# ── end archived-workspace expiry ───────────────────────────────────────────── EXPIRE-END ──
````

Replace with:

````bash

_WS_EXPIRE_SPAWN_FD=""; _WS_EXPIRE_SPAWN_WHY=""
_ws_expire_spawn_gate() {   # id -> 0 when a pane may be created for id; rc 1 with _WS_EXPIRE_SPAWN_WHY when not.
  #                            On rc 0 for an ARCHIVED row it HOLDS the reap lock (_WS_EXPIRE_SPAWN_FD) until
  #                            `_ws_expire_spawn_release`, so the unarchive that follows cannot interleave with an
  #                            expiry, a reap or a restore of the same row.
  # A RETURN DURING AN EXPIRY REFUSES (spec §5.3), on every path that creates
  # a pane — `_spawn_start` is the one they all reach (start and enable, ensure,
  # the unit's `supervise`, swap's respawn, attach and menu through ensure, the
  # server's Revive through ensure, ws-add), so this gate is the backstop; the return
  # verbs refuse first, before they journal (`_ws_expire_refuse_return`), and
  # ws-restore asks the same breadcrumb itself before it unarchives. Two
  # windows, two answers. AFTER a crash the
  # `expire:` breadcrumb stands and the lock is free: refused by the
  # breadcrumb, whatever the archive stamp says. DURING the act the expiry
  # holds `$REG/.reap-<id>.lock` from its ladder to its last deletion, and the
  # `.archived` stamp still stands: so a spawn that is about to clear that
  # stamp takes the same lock first, `-n`, and refuses if anyone holds it — a
  # refusal, never a wait, because the holder may be minutes into a teardown.
  # No breadcrumb and no stamp: nothing to ask, no lock taken, and a box with
  # no flock cannot be running an expiry (`cmd_ws_expire` refuses there).
  local id="$1" rbc
  _WS_EXPIRE_SPAWN_FD=""; _WS_EXPIRE_SPAWN_WHY=""
  rbc=$(_reg_get "$id" reaping)
  if [[ "$rbc" == expire:* ]]; then
    _WS_EXPIRE_SPAWN_WHY="$id is being expired — an interrupted ws-expire stopped at its '${rbc#expire:}' step, and a pane is never created for a workspace whose teardown has begun"
    return 1
  fi
  [[ -f "$REG/$id.archived" ]] || return 0
  # A BREADCRUMB THAT STANDS BUT READS AS NOTHING, ON AN ARCHIVED ROW, IS NOT
  # "NONE": an interrupted expiry leaves `.archived` standing (its purge takes
  # the breadcrumb first), so it may be one — which verb left it, and where, is
  # unknown, exactly as `_ws_expire_fork` reads it (unmeasured). Asked of an
  # archived row only: no spawn of a row that is not archived ever read one.
  if [[ -z "$rbc" ]] && [[ -e "$REG/$id.reaping" || -L "$REG/$id.reaping" ]]; then
    _WS_EXPIRE_SPAWN_WHY="a breadcrumb stands at $REG/$id.reaping but cannot be read — whether $id is being expired is unknown, so no pane is created for it"
    return 1
  fi
  command -v flock >/dev/null 2>&1 || return 0
  local fd
  exec {fd}>>"$REG/.reap-$id.lock" || { _WS_EXPIRE_SPAWN_WHY="cannot open the reap lock at $REG/.reap-$id.lock, so whether $id is being expired was never asked"; return 1; }
  if ! flock -n "$fd"; then
    exec {fd}>&-
    _WS_EXPIRE_SPAWN_WHY="another ccd process is expiring, reaping or restoring $id and still holds the lock — refusing to create a pane for it mid-cleanup"
    return 1
  fi
  _WS_EXPIRE_SPAWN_FD="$fd"
}

_ws_expire_spawn_release() {   # -> gives back the lock `_ws_expire_spawn_gate` took, if it took one
  [[ -z "$_WS_EXPIRE_SPAWN_FD" ]] || exec {_WS_EXPIRE_SPAWN_FD}>&-
  _WS_EXPIRE_SPAWN_FD=""
}

_ws_expire_breadcrumb_why() {   # id -> rc 0 with the refusal sentence on stdout when an `expire:` breadcrumb
  #                                stands for id, or one that cannot be read (the gate's reason); rc 1 when none
  local rbc; rbc=$(_reg_get "$1" reaping)
  if [[ -z "$rbc" ]] && [[ -e "$REG/$1.reaping" || -L "$REG/$1.reaping" ]]; then
    printf 'a breadcrumb stands at %s but cannot be read — whether %s is being expired is unknown, so it is not brought back' "$REG/$1.reaping" "$1"
    return 0
  fi
  [[ "$rbc" == expire:* ]] || return 1
  printf '%s is being expired — an interrupted ws-expire stopped at its %s step; bringing it back now would return a workspace whose teardown has begun' "$1" "'${rbc#expire:}'"
}

_ws_expire_refuse_return() {   # id -> returns 0 when no `expire:` breadcrumb stands; else DIES with the sentence
  # THE RETURN VERBS' OWN REFUSAL, asked by `cmd_start`, `cmd_ensure`, `cmd_swap`
  # and `cmd_enable` BEFORE they journal their act or write a field: a return that a
  # breadcrumb refuses must leave no `start`/`ensure`/`swap`/`enable` row behind, or
  # the lifecycle instrument (`deploy/measure-workspace-lifecycle.py`) pairs
  # it with the archive as a RETURN, seven days or more after it — the exact
  # number spec §9's kill rule reads. `ws-restore` asks the same breadcrumb
  # under its lock and refuses through `_lc_refuse` (`in-progress`), and
  # `_spawn_start`'s gate is the backstop under all of them. It IS that gate,
  # asked early and let go at once: the breadcrumb after a crash, and the reap
  # lock while an expiry (or a reap, or a restore) of an archived row holds it.
  _ws_expire_spawn_gate "$1" || die "$_WS_EXPIRE_SPAWN_WHY"
  _ws_expire_spawn_release
}

# ── end archived-workspace expiry ───────────────────────────────────────────── EXPIRE-END ──
````


- [ ] **Step 4: Re-stamp ccd and run.**

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-spawn.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-die-containment.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-unarchive-on-spawn.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-restore-reap-lock.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
```

Measured (the census and die-census reds are Step 5's taxes):

- `server/test/ccd-ws-expire-spawn.test.ts`: `17 passed (17)`
- `server/test/ccd-unarchive-on-spawn.test.ts`: `7 passed (7)`
- `server/test/ccd-restore-reap-lock.test.ts`: `4 passed (4)`
- `server/test/ccd-reg-get-census.test.ts`: `1 failed | 2 passed (3)`
  - × both numbers the header claims match what its own cited commands count
- `server/test/session-hook.test.ts` (`-t` the citation cases): `5 passed | 330 skipped (335)`
- `server/test/ccd-die-containment.test.ts`: `1 failed | 11 passed (12)`
  - × was actually parsed — the scan is looking at something

- [ ] **Step 5: Pay the taxes** — the `_reg_get` census (measured) and the die census (`_ws_expire_refuse_return` can `die`):

<!-- replay: T5 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
# and the reason is a count rather than a preference: this file makes 185
# invocations across 155 non-comment lines.
````

Replace with:

````bash
# and the reason is a count rather than a preference: this file makes 187
# invocations across 157 non-comment lines.
````

<!-- replay: T5 replace server/test/ccd-die-containment.test.ts -->
In `server/test/ccd-die-containment.test.ts`, find:

````ts
    // makes "nothing was touched" true rather than merely printed.
    // `_place_for_class` is deliberately NOT here: it is called inside a command
````

Replace with:

````ts
    // makes "nothing was touched" true rather than merely printed.
    // `_ws_expire_refuse_return` joined them in workspace lifecycle wave 3: the
    // return verbs' refusal of an expiry in progress, called plainly by
    // `cmd_start`, `cmd_ensure`, `cmd_swap` and `cmd_enable` before they journal their act —
    // never inside `$( )` — so its `die` ends the verb, not a subshell.
    // `_place_for_class` is deliberately NOT here: it is called inside a command
````

<!-- replay: T5 replace server/test/ccd-die-containment.test.ts -->
In `server/test/ccd-die-containment.test.ts`, find:

````ts
        '_supervised_start', '_swap_refuse']);
````

Replace with:

````ts
        '_supervised_start', '_swap_refuse', '_ws_expire_refuse_return']);
````


```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
( cd server && ./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-die-containment.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ownership.test.ts --maxWorkers=1 )
```

Measured:

- `server/test/ccd-reg-get-census.test.ts`: `3 passed (3)`
- `server/test/ownership.test.ts`: `14 passed (14)`
- `server/test/ccd-die-containment.test.ts`: `12 passed (12)`

- [ ] **Step 6: Mutation check, then commit.**

| # | Edit (restore after; re-stamp after a `ccd/ccd` edit) | Measured red |
|---|---|---|
| M5.1 | `_spawn_start`'s gate deleted. `ccd/ccd`: `  _ws_expire_spawn_gate "$id" \|\| die "$_WS_EXPIRE_SPAWN_WHY"⏎  if [[ -f "$REG/$id.archived" ]]; then` → `  if [[ -f "$REG/$id.archived" ]]; then` | `server/test/ccd-ws-expire-spawn.test.ts`: 4 failed \| 13 passed (17) — red: _spawn_start itself — the one place a session pane is made (+3 more) |
| M5.2 | the gate's breadcrumb arm deleted. `ccd/ccd`: `  if [[ "$rbc" == expire:* ]]; then⏎    _WS_EXPIRE_SPAWN_WHY=` → `  if false; then⏎    _WS_EXPIRE_SPAWN_WHY=` | `server/test/ccd-ws-expire-spawn.test.ts`: 6 failed \| 11 passed (17) — red: _spawn_start itself — the one place a session pane is made (+5 more) |
| M5.3 | the gate's lock arm deleted. `ccd/ccd`: `  command -v flock >/dev/null 2>&1 \|\| return 0⏎  local fd⏎` → `  return 0⏎  local fd⏎` | `server/test/ccd-ws-expire-spawn.test.ts`: 2 failed \| 15 passed (17) — red: another process holds `$REG/.reap-<id>.lock` (an expiry between its ladder and its last deletion) — refused, nothing cleared (+1 more) |
| M5.4 | `_spawn_start` never gives the lock back. `ccd/ccd`: `    _ws_unarchive "$id"⏎  fi⏎  _ws_expire_spawn_release⏎` → `    _ws_unarchive "$id"⏎  fi⏎` | `server/test/ccd-ws-expire-spawn.test.ts` `-t 'nobody holds it'`: 1 failed \| 16 skipped (17) — red: the CONTROL: nobody holds it — the spawn clears the archive as before, and gives the lock back IN ITS OWN PROCESS |
| M5.5 | `cmd_ensure` stops asking before it journals. `ccd/ccd`: `  [[ -f "$REG/$id.uuid" ]] \|\| die "no registry for '$id' (run ccd start first)"⏎  _ws_expire_refuse_return "$id"` → `  [[ -f "$REG/$id.uuid" ]] \|\| die "no registry for '$id' (run ccd start first)"⏎  :` | `server/test/ccd-ws-expire-spawn.test.ts`: 4 failed \| 13 passed (17) — red: ensure in its unit — the `supervise` ExecStart’s path, and so every Restart=always respawn (+3 more) |
| M5.6 | `cmd_swap` stops asking. `ccd/ccd`: `  [[ -f "$REG/$id.uuid" ]] \|\| die "no registry for '$id'"⏎  _ws_expire_refuse_return "$id"` → `  [[ -f "$REG/$id.uuid" ]] \|\| die "no registry for '$id'"⏎  :` | `server/test/ccd-ws-expire-spawn.test.ts` `-t 'swap'`: 1 failed \| 1 passed \| 15 skipped (17) — red: swap — refused before it moves the transcript or journals the swap |
| M5.7 | ws-restore stops asking the breadcrumb. `ccd/ccd`: `; ! _ws_expire_breadcrumb_why "$id" >/dev/null \|\| _lc_refuse restore` → `; true \|\| _lc_refuse restore` | `server/test/ccd-ws-expire-spawn.test.ts` `-t 'ws-restore'`: 2 failed \| 15 skipped (17) — red: an ARCHIVED row whose breadcrumb stands but cannot be read refuses too — at `_spawn_start` and at ws-restore (+1 more) |
| M5.8 | `cmd_start` stops asking before it journals. `ccd/ccd`: `⏎  _ws_expire_refuse_return "$id"   # a return during an expiry refuses, before anything is journaled (EXPIRE region)⏎  if _alive "$id"; then⏎    # M5` → `⏎  :   # a return during an expiry refuses, before anything is journaled (EXPIRE region)⏎  if _alive "$id"; then⏎    # M5` | `server/test/ccd-ws-expire-spawn.test.ts`: 2 failed \| 15 passed (17) — red: start <id> (+1 more) |
| M5.9 | `cmd_enable` stops asking before it journals `enable`. `ccd/ccd`: `  _ws_expire_refuse_return "$id"   # a return during an expiry refuses, before anything is journaled (EXPIRE region)⏎  _lc_done enable "$id" ""` → `  :   # a return during an expiry refuses, before anything is journaled (EXPIRE region)⏎  _lc_done enable "$id" ""` | `server/test/ccd-ws-expire-spawn.test.ts`: 2 failed \| 15 passed (17) — red: enable <id> — the alias of start the server composes, refused before it journals `enable` (+1 more) |
| M5.10 | the gate's unreadable-breadcrumb arm deleted. `ccd/ccd`: `  if [[ -z "$rbc" ]] && [[ -e "$REG/$id.reaping" \|\| -L "$REG/$id.reaping" ]]; then⏎    _WS_EXPIRE_SPAWN_WHY=` → `  if false; then⏎    _WS_EXPIRE_SPAWN_WHY=` | `server/test/ccd-ws-expire-spawn.test.ts` `-t 'cannot be read'`: 1 failed \| 16 skipped (17) — red: an ARCHIVED row whose breadcrumb stands but cannot be read refuses too — at `_spawn_start` and at ws-restore |
| M5.11 | `_ws_expire_breadcrumb_why`'s unreadable arm deleted (ws-restore's half). `ccd/ccd`: `  if [[ -z "$rbc" ]] && [[ -e "$REG/$1.reaping" \|\| -L "$REG/$1.reaping" ]]; then⏎    printf 'a breadcrumb stands at` → `  if false; then⏎    printf 'a breadcrumb stands at` | `server/test/ccd-ws-expire-spawn.test.ts` `-t 'cannot be read'`: 1 failed \| 16 skipped (17) — red: an ARCHIVED row whose breadcrumb stands but cannot be read refuses too — at `_spawn_start` and at ws-restore |

```bash
git add ccd/ccd server/test/ccd-ws-expire-spawn.test.ts server/test/ccd-die-containment.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): a return during an expiry refuses, on every spawn path

No spawn path honoured a breadcrumb before this. start, enable, ensure and
swap now refuse an expire: breadcrumb, and a held reap lock on an archived
row, before they journal their act — a refused return must never read as
a return to the lifecycle instrument; ws-restore refuses in-progress
under its lock; _spawn_start, where every session pane is made, holds
the same gate as the backstop. On an archived row a breadcrumb that
stands but cannot be read refuses too. The die census names the new helper.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: `ws-audit --expire` — the token the verb spends

**Model routing:** `sonnet`, effort `high` — a document printer over Task 3's ladder, with containment and exit codes given by the tests.

**Files:** red `server/test/ccd-ws-expire-audit.test.ts`; green `ccd/ccd`; tax `ccd/ccd`, `server/test/ccd-child-reclaim-audit.test.ts`, `server/test/ccd-child-reclaim-entry.test.ts`, `server/test/ccd-die-containment.test.ts`.

**Interfaces:**
- Produces: `ccd ws-audit --session <id> --expire` (exactly; `--expire` with anything after it is a usage error) → ONE line `{"session","mode":"expire","archivedAt":<epoch>|null,"alive","exists","reaping":<breadcrumb>|null,"sensitive":[paths],["resume":<phase>],"verdict","detail",["token"]}`. `verdict` is `expirable` (with `token`) or one of the eighteen words (no token); `unmeasured` (no token) EXITS 1 with `ccd: ws-audit --expire measured nothing: … — retry` on stderr. A TERMINAL word (`not-a-workspace`, `branch-elsewhere`, `tree-unreadable`, `containment-unproven`, `no-worktree-record`) is journaled `_lc_emit expire refused … verb ws-audit`; a retryable one is not. The whole audit runs contained (no hook, no fsmonitor, no optional lock). It sets NO flavour: it writes nothing, and rung 5's question for an expiry is keyed on the binding `_ws_expire_eval` sets, so a live archived workspace answers `live` here exactly as at the verb (pinned: `the audit refuses a live archived workspace`).
- Changes: `cmd_ws_audit`'s usage line reads `usage: ccd ws-audit --session <id> [--reclaim [--defer-expired] | --expire]` (both copies).

- [ ] **Step 1: Write the failing tests.**

<!-- replay: T6 create server/test/ccd-ws-expire-audit.test.ts -->
Create `server/test/ccd-ws-expire-audit.test.ts`:

````ts
// `ws-audit --session <id> --expire` — the token `ws-expire` spends (workspace lifecycle spec 2026-09-24 §5.3), read
// as the server will read it: one JSON document, exit 1 when a probe could not run. Its ladder is `_ws_expire_eval`
// (`ccd-ws-expire-ladder.test.ts` holds it rung by rung); this file holds the document, the exits, the journal and the
// containment. FIXTURE HOME ONLY (`wsExpireFixture.ts`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, refusalsOf } from './lifecycleHelpers.js';
import { childIndex, hookRuns, plantRepoPrograms, plantTmux } from './childReclaimFixture.js';
import {
  EXP_ID, EXP_STUBS, NOW, OLD, archiveAt, expireAudit, expireEvalOf, expireToken, expireVerb, makeArchived,
} from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-expire-audit-'); });
afterEach(() => { h.cleanup(); });

const reg = (field: string): string => path.join(h.home, '.cc-sessions', `${EXP_ID}.${field}`);

describe('ws-audit --expire — the token the verb spends', () => {
  it('prints mode, archivedAt and the SAME token the ladder mints', () => {
    makeArchived(h);
    const r = expireAudit(h);
    expect(r.code, r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(Object.keys(doc)).toEqual(['session', 'mode', 'archivedAt', 'alive', 'exists', 'reaping', 'sensitive', 'verdict', 'detail', 'token']);
    expect(doc).toMatchObject({ session: EXP_ID, mode: 'expire', archivedAt: OLD, alive: false, exists: true, reaping: null, verdict: 'expirable' });
    expect(doc['token']).toBe(expireEvalOf(h).token);
  }, 60_000);

  it('the audit’s token IS the verb’s consent — end to end', () => {
    const a = makeArchived(h);
    const r = expireVerb(h, expireToken(h));
    expect(JSON.parse(r.stdout)['expired']).toBe(EXP_ID);
    expect(fs.existsSync(a.wt)).toBe(false);
  }, 120_000);

  it('lists what the pin will drop: every secret-shaped path, untracked or ignored', () => {
    const a = makeArchived(h);
    fs.writeFileSync(path.join(a.wt, '.env'), 'KEY=live');
    expect(JSON.parse(expireAudit(h).stdout)['sensitive']).toEqual(['.env']);
  }, 60_000);

  it('a refusal carries no token, and archivedAt is null when no archive could be read', () => {
    makeArchived(h);
    archiveAt(h, NOW - 60);
    const young = JSON.parse(expireAudit(h).stdout) as Record<string, unknown>;
    expect(young['verdict']).toBe('not-expired');
    expect(young['token']).toBeUndefined();
    fs.rmSync(reg('archived'));
    const gone = JSON.parse(expireAudit(h).stdout) as Record<string, unknown>;
    expect(gone['verdict']).toBe('not-archived');
    expect(gone['archivedAt']).toBeNull();
  }, 60_000);

  it('a probe that could not RUN exits 1 — the document says unmeasured, no token, and nothing is journaled', () => {
    const a = makeArchived(h);
    fs.writeFileSync(reg('archived'), 'soon\n');
    const r = expireAudit(h);
    expect(r.code).toBe(1);
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(doc['verdict']).toBe('unmeasured');
    expect(doc['token']).toBeUndefined();
    expect(r.stderr).toContain('ws-audit --expire measured nothing');
    expect(refusalsOf(h.home)).toEqual([]);
    expect(fs.existsSync(a.wt)).toBe(true);
  }, 60_000);

  it('journals a TERMINAL refusal — and a retryable one not at all', () => {
    const a = makeArchived(h);
    fs.writeFileSync(reg('hold'), 'x');
    expect(JSON.parse(expireAudit(h).stdout)['verdict']).toBe('held');
    expect(refusalsOf(h.home), 'a retryable word a pass would bury the journal').toEqual([]);
    fs.rmSync(reg('hold'));
    fs.rmSync(path.join(a.main, '.git', 'worktrees', 'quiet-dune'), { recursive: true, force: true });
    expect(JSON.parse(expireAudit(h).stdout)['verdict']).toBe('no-worktree-record');
    expect(refusalsOf(h.home)).toEqual([{ act: 'expire', token: 'no-worktree-record' }]);
    expect(eventsOf(h.home, 'expire')[0]!['verb']).toBe('ws-audit');
  }, 60_000);

  it('answers the RESUME token on an `expire:` breadcrumb, names the phase — and asserts its argv', () => {
    const a = makeArchived(h);
    h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_eval ${EXP_ID} >/dev/null`
      + ` && _ws_reclaim_pin ${EXP_ID} "${a.wt}" "${a.main}" "$REAP_BRANCH" "$EXPIRE_ARCHIVED_AT"`
      + ` && _ws_tombstone ${EXP_ID} '[]' "$(_ws_reclaim_tomb_fields "$EXPIRE_ARCHIVED_AT")" >/dev/null`
      + ` && _reg_set ${EXP_ID} reaping expire:worktree`);
    const doc = JSON.parse(expireAudit(h).stdout) as Record<string, unknown>;
    expect(doc['resume']).toBe('worktree');
    expect(doc['reaping']).toBe('expire:worktree');
    expect(doc['token']).toBe(h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_resume_eval ${EXP_ID} worktree >/dev/null;`
      + ' printf "%s" "$REAP_TOKEN"'));
    for (const extra of ['--defer-expired', '--expire']) {
      const bad = h.run(`${EXP_STUBS} cmd_ws_audit --session ${EXP_ID} --expire ${extra}`);
      expect(bad.code, extra).toBe(1);
      expect(bad.stderr).toContain('usage: ccd ws-audit --session <id> [--reclaim [--defer-expired] | --expire]');
    }
  }, 90_000);

  it('the plain audit never takes the hand-off — no mode, and never the expiry’s verdict', () => {
    makeArchived(h);
    const plain = JSON.parse(h.sh(`${EXP_STUBS} cmd_ws_audit --session ${EXP_ID}`)) as Record<string, unknown>;
    expect(plain['mode'], 'the plain audit carries no mode').toBeUndefined();
    expect(plain['verdict']).toBeTypeOf('string');
    expect(plain['verdict'], 'the plain audit answers ws-reap’s question, never the expiry’s').not.toBe('expirable');
  }, 60_000);
});

// RULING (D) AT THE ENTRY WAVE 3b's LANE READS FIRST: the audit is where the server learns a workspace is expirable,
// so a live archived workspace is refused here too — asked by the binding, with no flavour set by the audit.
describe('the audit refuses a live archived workspace — `live`, no token', () => {
  it('a running unit with no pane', () => {
    makeArchived(h);
    const doc = JSON.parse(expireAudit(h, { pre: '_svc_is_active() { printf active; };' }).stdout) as Record<string, unknown>;
    expect(doc['verdict'], String(doc['detail'])).toBe('live');
    expect(doc['token']).toBeUndefined();
  }, 60_000);

  it('a detached `cc-<id>` pane', () => {
    makeArchived(h);
    plantTmux(h, { sessions: [`cc-${EXP_ID}`] });
    const doc = JSON.parse(expireAudit(h).stdout) as Record<string, unknown>;
    expect(doc['verdict'], String(doc['detail'])).toBe('live');
    expect(doc['alive']).toBe(true);
    expect(doc['token']).toBeUndefined();
  }, 60_000);
});

describe('the audit reads the archived tree CONTAINED — no hook, no fsmonitor, no index rewrite', () => {
  it('runs none of the repository’s programs and leaves the stale index byte-identical', () => {
    const a = makeArchived(h);
    plantRepoPrograms(h, a);
    const before = childIndex(h, a);
    expect(expireAudit(h).code).toBe(0);
    expect(hookRuns(h)).toEqual([]);
    expect(childIndex(h, a).bytes).toBe(before.bytes);
    // The CONTROL: an uncontained status of the same tree runs the hook and rewrites the index.
    h.git(a.wt, 'status');
    expect(hookRuns(h).length).toBeGreaterThan(0);
  }, 90_000);
});
````


- [ ] **Step 2: Run them — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-audit.test.ts --maxWorkers=1 )
```

Measured (the pass is the plain audit's CONTROL — `the plain audit never takes the hand-off`, true before this task):

- `server/test/ccd-ws-expire-audit.test.ts`: `10 failed | 1 passed (11)`
  - × prints mode, archivedAt and the SAME token the ladder mints
  - × the audit’s token IS the verb’s consent — end to end
  - × lists what the pin will drop: every secret-shaped path, untracked or ignored
  - × a refusal carries no token, and archivedAt is null when no archive could be read
  - × a probe that could not RUN exits 1 — the document says unmeasured, no token, and nothing is journaled
  - × journals a TERMINAL refusal — and a retryable one not at all
  - × answers the RESUME token on an `expire:` breadcrumb, names the phase — and asserts its argv
  - × a running unit with no pane
  - × a detached `cc-<id>` pane
  - × runs none of the repository’s programs and leaves the stale index byte-identical

- [ ] **Step 3: The audit, and its hand-off on `cmd_ws_audit`'s existing line.**

<!-- replay: T6 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
    || die "usage: ccd ws-audit --session <id> [--reclaim [--defer-expired]]"
  if (( $# >= 3 )); then
    [[ $3 == --reclaim && ( $# -eq 3 || $4 == --defer-expired ) ]] \
      || die "usage: ccd ws-audit --session <id> [--reclaim [--defer-expired]]"
````

Replace with:

````bash
    || die "usage: ccd ws-audit --session <id> [--reclaim [--defer-expired] | --expire]"
  if (( $# >= 3 )); then [[ $3 != --expire || $# -ne 3 ]] || { _ws_expire_audit "$2"; return; }   # "WS-AUDIT --EXPIRE", EXPIRE region
    [[ $3 == --reclaim && ( $# -eq 3 || $4 == --defer-expired ) ]] \
      || die "usage: ccd ws-audit --session <id> [--reclaim [--defer-expired] | --expire]"
````

<!-- replay: T6 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash

_WS_EXPIRE_SPAWN_FD=""; _WS_EXPIRE_SPAWN_WHY=""
````

Replace with:

````bash

# WS-AUDIT --EXPIRE. `cmd_ws_audit` sits above the frozen citation corpus's
# anchors, so its one line for this mode is a hand-off on its existing `if`
# line, and the mode is answered here, whole: the fork, contained (every git
# read hook-free, exactly as the reclaim audit's — the workspace may be
# archived, but nothing has proved nobody is in it), and ONE document on
# stdout. `expirable` MEANS a token, as `reclaimable` does, spelled through
# `_json_str` so no refusal harvest counts it. `unmeasured` prints the
# document with that word and EXITS 1 — the server reads any audit exit 1 as
# `failed` and retries — and is journaled nowhere. A TERMINAL refusal is
# journaled (`_lc_emit expire refused … verb ws-audit`), and only a terminal one.
_ws_expire_audit() {   # id -> `ccd ws-audit --session <id> --expire`, whole: the expiry ladder's answer as
  #                       ONE JSON document on stdout; exit 1 on `unmeasured` (the server retries), else 0
  # No flavour is set here: the audit writes nothing, and the one question the
  # ladder asks only of an expiry (rung 5's) is keyed on the binding
  # `_ws_expire_eval` sets, so this read asks it exactly as the verb does.
  _ws_reclaim_contained _ws_expire_audit_contained "$@"
}

_ws_expire_audit_contained() {   # `_ws_expire_audit`'s body, run under `_ws_reclaim_contained` — call that
  local id="$1" exists=false aliveflag=false workdir reaping sens="[" first=1 s
  [[ $id =~ ^[A-Za-z0-9._-]+$ ]] || die "bad session id"
  _json_str probe >/dev/null 2>&1 \
    || die "python3 unavailable — cannot quote the audit record safely"
  _alive "$id" && aliveflag=true
  _ws_expire_fork "$id"
  workdir=$(_reg_get "$id" workdir); [[ -n "$workdir" && -d "$workdir" ]] && exists=true
  reaping=$(_reg_get "$id" reaping)
  for s in ${REAP_SENSITIVE[@]+"${REAP_SENSITIVE[@]}"}; do
    (( first )) || sens+=","; first=0; sens+="$(_json_str "$s")"
  done
  sens+="]"
  printf '{"session":%s,"mode":"expire","archivedAt":%s,"alive":%s,"exists":%s,"reaping":%s,"sensitive":%s,' \
    "$(_json_str "$id")" "$( _ws_expire_epoch_ok "$EXPIRE_ARCHIVED_AT" && echo "$EXPIRE_ARCHIVED_AT" || echo null)" \
    "$aliveflag" "$exists" "$( [[ -n "$reaping" ]] && _json_str "$reaping" || echo null)" "$sens"
  [[ -n "$RECLAIM_RESUME_PHASE" ]] && printf '"resume":%s,' "$(_json_str "$RECLAIM_RESUME_PHASE")"
  if [[ "$REAP_VERDICT" == expirable ]]; then
    # spelled through `_json_str`, never the literal verdict shape the refusal harvests read
    printf '"verdict":%s,"detail":"","token":%s}\n' "$(_json_str "$REAP_VERDICT")" "$(_json_str "$REAP_TOKEN")"
  elif [[ "$REAP_VERDICT" == unmeasured ]]; then
    printf '"verdict":%s,"detail":%s}\n' "$(_json_str "$REAP_VERDICT")" "$(_json_str "$REAP_DETAIL")"
    echo "ccd: ws-audit --expire measured nothing: $REAP_DETAIL — retry" >&2
    return 1
  else
    printf '"verdict":%s,"detail":%s}\n' "$(_json_str "$REAP_VERDICT")" "$(_json_str "$REAP_DETAIL")"
    # A TERMINAL refusal is journaled, and only a terminal one (CCR-15 §5.9's
    # rule, carried): the server audits first and stops on a refusal, so this is
    # the one place it reaches the lifecycle mirror; a retryable word a pass
    # would bury the journal.
    case "$REAP_VERDICT" in
      not-a-workspace|branch-elsewhere|tree-unreadable|containment-unproven|no-worktree-record)
        _lc_emit expire refused "$id" "" verb ws-audit refusal "$REAP_VERDICT" detail "$REAP_DETAIL" ;;
    esac
  fi
}

_WS_EXPIRE_SPAWN_FD=""; _WS_EXPIRE_SPAWN_WHY=""
````


- [ ] **Step 4: Re-stamp ccd and run.**

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-audit.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-die-containment.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-entry.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
```

Measured (the usage-line, census and die-census reds are Step 5's taxes):

- `server/test/ccd-ws-expire-audit.test.ts`: `11 passed (11)`
- `server/test/ccd-child-reclaim-audit.test.ts`: `1 failed | 22 passed (23)`
  - × asserts its argv: --reclaim only third, --defer-expired only after it
- `server/test/ccd-child-reclaim-entry.test.ts`: `6 failed | 81 passed | 1 skipped (88)`
  - × audit, --defer-expired alone → ordinary
  - × audit, --reclaim out of order → ordinary
  - × audit, --defer-expired before --reclaim → ordinary
  - × audit, a later duplicate --reclaim → ordinary
  - × audit, an extra token → ordinary
  - × audit, an extra token after --defer-expired → ordinary
- `server/test/ccd-reg-get-census.test.ts`: `1 failed | 2 passed (3)`
  - × both numbers the header claims match what its own cited commands count
- `server/test/session-hook.test.ts` (`-t` the citation cases): `5 passed | 330 skipped (335)`
- `server/test/ccd-die-containment.test.ts`: `1 failed | 11 passed (12)`
  - × was actually parsed — the scan is looking at something

- [ ] **Step 5: Pay the taxes** — the census (measured), the two pins that quote the audit's usage line, and the die census (`_ws_expire_audit_contained` can `die`):

<!-- replay: T6 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
# and the reason is a count rather than a preference: this file makes 187
# invocations across 157 non-comment lines.
````

Replace with:

````bash
# and the reason is a count rather than a preference: this file makes 189
# invocations across 159 non-comment lines.
````

<!-- replay: T6 replace server/test/ccd-child-reclaim-audit.test.ts -->
In `server/test/ccd-child-reclaim-audit.test.ts`, find:

````ts
      expect(r.stderr, argv.join(' ')).toContain('usage: ccd ws-audit --session <id> [--reclaim [--defer-expired]]');
````

Replace with:

````ts
      expect(r.stderr, argv.join(' ')).toContain('usage: ccd ws-audit --session <id> [--reclaim [--defer-expired] | --expire]');
````

<!-- replay: T6 replace server/test/ccd-child-reclaim-entry.test.ts -->
In `server/test/ccd-child-reclaim-entry.test.ts`, find:

````ts
const USAGE = /^ccd: usage: ccd ws-audit --session <id> \[--reclaim \[--defer-expired\]\]$/m;
````

Replace with:

````ts
const USAGE = /^ccd: usage: ccd ws-audit --session <id> \[--reclaim \[--defer-expired\] \| --expire\]$/m;
````

<!-- replay: T6 replace server/test/ccd-die-containment.test.ts -->
In `server/test/ccd-die-containment.test.ts`, find:

````ts
    // never inside `$( )` — so its `die` ends the verb, not a subshell.
    // `_place_for_class` is deliberately NOT here: it is called inside a command
````

Replace with:

````ts
    // never inside `$( )` — so its `die` ends the verb, not a subshell.
    // `_ws_expire_audit_contained` joined them with `ws-audit --expire`: it
    // `die`s on an id or a python3 it cannot use, before any read, reached
    // through `cmd_ws_audit`'s hand-off and never inside `$( )`.
    // `_place_for_class` is deliberately NOT here: it is called inside a command
````

<!-- replay: T6 replace server/test/ccd-die-containment.test.ts -->
In `server/test/ccd-die-containment.test.ts`, find:

````ts
        '_supervised_start', '_swap_refuse', '_ws_expire_refuse_return']);
````

Replace with:

````ts
        '_supervised_start', '_swap_refuse', '_ws_expire_audit_contained', '_ws_expire_refuse_return']);
````


```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-audit.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-entry.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-die-containment.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ownership.test.ts --maxWorkers=1 )
```

Measured:

- `server/test/ccd-child-reclaim-audit.test.ts`: `23 passed (23)`
- `server/test/ccd-child-reclaim-entry.test.ts`: `87 passed | 1 skipped (88)`
- `server/test/ccd-reg-get-census.test.ts`: `3 passed (3)`
- `server/test/ownership.test.ts`: `14 passed (14)`
- `server/test/ccd-die-containment.test.ts`: `12 passed (12)`

- [ ] **Step 6: Mutation check, then commit.**

| # | Edit (restore after; re-stamp after a `ccd/ccd` edit) | Measured red |
|---|---|---|
| M6.1 | the audit's hand-off deleted (the mode dies at the usage check). `ccd/ccd`: `  if (( $# >= 3 )); then [[ $3 != --expire \|\| $# -ne 3 ]] \|\| { _ws_expire_audit "$2"; return; }` → `  if (( $# >= 3 )); then :` | `server/test/ccd-ws-expire-audit.test.ts`: 10 failed \| 1 passed (11) — red: prints mode, archivedAt and the SAME token the ladder mints (+9 more) |
| M6.2 | `no-worktree-record` dropped from the audit's terminal list. `ccd/ccd`: `      not-a-workspace\|branch-elsewhere\|tree-unreadable\|containment-unproven\|no-worktree-record)⏎        _lc_emit expire refused` → `      not-a-workspace\|branch-elsewhere\|tree-unreadable\|containment-unproven)⏎        _lc_emit expire refused` | `server/test/ccd-ws-expire-audit.test.ts` `-t 'TERMINAL'`: 1 failed \| 10 skipped (11) — red: journals a TERMINAL refusal — and a retryable one not at all |
| M6.3 | an unmeasured audit exits 0. `ccd/ccd`: `    echo "ccd: ws-audit --expire measured nothing: $REAP_DETAIL — retry" >&2⏎    return 1⏎` → `    echo "ccd: ws-audit --expire measured nothing: $REAP_DETAIL — retry" >&2⏎    return 0⏎` | `server/test/ccd-ws-expire-audit.test.ts` `-t 'could not RUN'`: 1 failed \| 10 skipped (11) — red: a probe that could not RUN exits 1 — the document says unmeasured, no token, and nothing is journaled |
| M6.4 | the audit's OWN containment removed — GREEN BY CONSTRUCTION, recorded as such: the audit makes no git read outside the fork, and the fork is contained (`_ws_expire_fork`); M6.5 is its control, and M4.13 pins the fork's wrapper on the verb's path. `ccd/ccd`: `  _ws_reclaim_contained _ws_expire_audit_contained "$@"⏎` → `  _ws_expire_audit_contained "$@"⏎` | `server/test/ccd-ws-expire-audit.test.ts` `-t 'CONTAINED'`: 1 passed \| 10 skipped (11) |
| M6.5 | the CONTROL for M6.4: BOTH wrappers removed — the audit's and the fork's — so nothing contains the audit's reads. `ccd/ccd`: `  _ws_reclaim_contained _ws_expire_audit_contained "$@"⏎` → `  _ws_expire_audit_contained "$@"⏎`; and `ccd/ccd`: `  _ws_reclaim_contained _ws_expire_fork_contained "$@"⏎` → `  _ws_expire_fork_contained "$@"⏎` | `server/test/ccd-ws-expire-audit.test.ts` `-t 'CONTAINED'`: 1 failed \| 10 skipped (11) — red: runs none of the repository’s programs and leaves the stale index byte-identical |
| M6.6 | rung 5's question keyed on the flavour global (Task 3's line, mutated as M3.13) — the audit sets no flavour, so it would stop refusing a live workspace. `ccd/ccd`: `[[ "${_WS_LADDER_BIND[0]-}" != mode=expire ]]` → `[[ "$_WS_RCL_ACT" != expire ]]` | `server/test/ccd-ws-expire-audit.test.ts` `-t 'live archived'`: 2 failed \| 9 skipped (11) — red: a running unit with no pane (+1 more) |

```bash
git add ccd/ccd server/test/ccd-ws-expire-audit.test.ts server/test/ccd-child-reclaim-audit.test.ts \
  server/test/ccd-child-reclaim-entry.test.ts server/test/ccd-die-containment.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): ws-audit --expire — the expiry's token, contained

One document per call: mode, archivedAt, presence, the paths the pin will
drop, the verdict and — on expirable — the token ws-expire spends. An
unmeasured probe exits 1; a terminal refusal is journaled as the
expiry's; a live archived workspace answers `live`. The whole audit runs
contained, as the reclaim audit does. The die census names the new helper.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: Reachable — the dispatcher, the capability token, and the direct-entry boundary

**Model routing:** **`opus`, effort `high`** — the launcher's classifier is a startup-security boundary (reclaim-entry-safety); a shape it misses starts unprotected.

**Files:** red `server/test/ccd-archive.test.ts`, `server/test/ccd-child-reclaim-entry.test.ts`, `server/test/ccd-ws-expire-reach.test.ts`; green `ccd/ccd`, `ccd/ccd-entry.py`, `server/src/ccdargv.ts`.

**Interfaces:**
- Produces: the dispatcher arm `ws-expire)`; `ccd caps` prints `ws-expire` and `expire-v1`; `EXPIRE_CAP = 'expire-v1'` in `server/src/ccdargv.ts` (spelled once in `server/src`; ccd's echo and `ccd-archive.test.ts`'s list are the other two spellings, held equal); `ws-expire <any tail>` and `ws-audit --session <v> --expire` protected at both classifiers.

- [ ] **Step 1: Write the failing tests.**

<!-- replay: T7 replace server/test/ccd-archive.test.ts -->
In `server/test/ccd-archive.test.ts`, find:

````ts
import { ACCOUNT_POOLS_CAP, ACTOR_FLAGS_CAP, CHILD_ARGV_CAP, POOLS_CAP, RECLAIM_CAP, RECLAIM_PAUSE_CAP, ROUTE_APPLY_CAP, ROUTE_ARGV_CAP, ROUTE_CAP, WIN_SIZE_CAP } from '../src/ccdargv.js';
````

Replace with:

````ts
import { ACCOUNT_POOLS_CAP, ACTOR_FLAGS_CAP, CHILD_ARGV_CAP, EXPIRE_CAP, POOLS_CAP, RECLAIM_CAP, RECLAIM_PAUSE_CAP, ROUTE_APPLY_CAP, ROUTE_ARGV_CAP, ROUTE_CAP, WIN_SIZE_CAP } from '../src/ccdargv.js';
````

<!-- replay: T7 replace server/test/ccd-archive.test.ts -->
In `server/test/ccd-archive.test.ts`, find:

````ts
  const KNOWN_CAPABILITY_TOKENS = ['account-pools', 'account-v1', 'actor-flags-v1', 'child-argv-v1', 'lifecycle-v1', 'pools-v1', 'reclaim-pause-v1', 'reclaim-v1', 'route-apply-v1', 'route-argv-v1', 'route-v1', 'stop-surface', 'win-size-v1'];
````

Replace with:

````ts
  const KNOWN_CAPABILITY_TOKENS = ['account-pools', 'account-v1', 'actor-flags-v1', 'child-argv-v1', 'expire-v1', 'lifecycle-v1', 'pools-v1', 'reclaim-pause-v1', 'reclaim-v1', 'route-apply-v1', 'route-argv-v1', 'route-v1', 'stop-surface', 'win-size-v1'];
````

<!-- replay: T7 replace server/test/ccd-archive.test.ts -->
In `server/test/ccd-archive.test.ts`, find:

````ts
    expect(KNOWN_CAPABILITY_TOKENS).toContain(CHILD_ARGV_CAP);
    // The deployed ~/.local/bin/ccd is a COPY, not a symlink to the repo, so a
````

Replace with:

````ts
    expect(KNOWN_CAPABILITY_TOKENS).toContain(CHILD_ARGV_CAP);
    // Workspace lifecycle wave 3's token: the third spelling of `expire-v1`, held equal to the constant wave 3b's lane
    // will gate on (`capSupported`) and to ccd's own `echo expire-v1`.
    expect(KNOWN_CAPABILITY_TOKENS).toContain(EXPIRE_CAP);
    // The deployed ~/.local/bin/ccd is a COPY, not a symlink to the repo, so a
````

<!-- replay: T7 replace server/test/ccd-child-reclaim-entry.test.ts -->
In `server/test/ccd-child-reclaim-entry.test.ts`, find:

````ts
  ['ws-reclaimx (prefix only)', ['ws-reclaimx'], false, null],
];
````

Replace with:

````ts
  ['ws-reclaimx (prefix only)', ['ws-reclaimx'], false, null],
  // ws-expire (workspace lifecycle wave 3): the archived workspace's server-composed teardown, ws-reclaim's sibling —
  // the same boundary, for the same reason (spec 2026-09-24 §5.3; reclaim-entry-safety's startup argument, above).
  ['ws-expire alone', ['ws-expire'], true, null],
  ['ws-expire with the full tail', ['ws-expire', '--expect', ANY_TOKEN, '--session', 'x'], true, null],
  ['ws-expire with a malformed tail (the body’s parser owns that)', ['ws-expire', '--defer-expired'], true, null],
  ['valid audit --expire', ['ws-audit', '--session', 'x', '--expire'], true, null],
  ['audit, --expire --defer-expired (no such mode)', ['ws-audit', '--session', 'x', '--expire', '--defer-expired'], false, USAGE],
  ['audit, a later duplicate --expire', ['ws-audit', '--session', 'x', '--expire', '--expire'], false, USAGE],
  ['a verb merely CONTAINING ws-expire later', ['caps', 'ws-expire'], false, null],
  ['ws-expirex (prefix only)', ['ws-expirex'], false, null],
];
````

<!-- replay: T7 replace server/test/ccd-child-reclaim-entry.test.ts -->
In `server/test/ccd-child-reclaim-entry.test.ts`, find:

````ts
  [`ws-audit --sess${DOTTED_I}on x --reclaim (a non-ASCII fold)`, ['ws-audit', `--sess${DOTTED_I}on`, 'x', '--reclaim']],
];
````

Replace with:

````ts
  [`ws-audit --sess${DOTTED_I}on x --reclaim (a non-ASCII fold)`, ['ws-audit', `--sess${DOTTED_I}on`, 'x', '--reclaim']],
  ['WS-EXPIRE alone', ['WS-EXPIRE']],
  [`ws-exp${DOTTED_I}re (a non-ASCII fold)`, [`ws-exp${DOTTED_I}re`]],
  ['WS-AUDIT --SESSION x --EXPIRE', ['WS-AUDIT', '--SESSION', 'x', '--EXPIRE']],
];
````

<!-- replay: T7 replace server/test/ccd-child-reclaim-entry.test.ts -->
In `server/test/ccd-child-reclaim-entry.test.ts`, find:

````ts
  ['CAPS WS-RECLAIM', ['CAPS', 'WS-RECLAIM']],
];
````

Replace with:

````ts
  ['CAPS WS-RECLAIM', ['CAPS', 'WS-RECLAIM']],
  ['WS-EXPIREX (prefix only)', ['WS-EXPIREX']],
  ['WS-AUDIT --SESSION x --EXPIRE --DEFER-EXPIRED', ['WS-AUDIT', '--SESSION', 'x', '--EXPIRE', '--DEFER-EXPIRED']],
];
````

<!-- replay: T7 create server/test/ccd-ws-expire-reach.test.ts -->
Create `server/test/ccd-ws-expire-reach.test.ts`:

````ts
// `ws-expire` made REACHABLE (workspace lifecycle spec 2026-09-24 §5.3): the dispatcher arm, the verb's name in
// `ccd caps` and its capability token `expire-v1`. The direct-entry boundary both protected shapes cross — `ws-expire`
// and `ws-audit --session <id> --expire` — is held in `ccd-child-reclaim-entry.test.ts`'s one grammar table, beside
// ws-reclaim's. FIXTURE HOME ONLY.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CCD, ghContainedEnv } from './ccdWsHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-expire-reach-'); });
afterEach(() => { h.cleanup(); });

/** The dispatcher, not the function, under `bash -p` — the installed launcher's start for a protected argv. */
const runCcd = (...args: string[]): { code: number; stderr: string } => {
  try {
    execFileSync('bash', ['-p', CCD, ...args], { encoding: 'utf8', cwd: h.home,
      env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
    return { code: 0, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? '') };
  }
};

describe('reachable: the capability token and the dispatcher arm', () => {
  it('ccd caps advertises the verb AND its capability token', () => {
    const advertised = h.sh('cmd_caps').split('\n');
    expect(advertised).toContain('ws-expire');
    expect(advertised).toContain('expire-v1');
  });

  it('the dispatcher routes ws-expire (its own usage, not the unknown-verb line) and the usage line names it', () => {
    const r = runCcd('ws-expire');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('usage: ccd ws-expire');
    expect(r.stderr).not.toContain('usage: ccd {start|');
    expect(runCcd('no-such-verb').stderr).toContain('|ws-expire|');
  });

  it('an unprivileged explicit bash is refused at entry for both protected shapes — nothing runs', () => {
    for (const argv of [['ws-expire'], ['ws-audit', '--session', 'x', '--expire']]) {
      let code = 0; let stderr = '';
      try {
        execFileSync('bash', [CCD, ...argv], { encoding: 'utf8', cwd: h.home,
          env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
      } catch (e) { const err = e as { status?: number; stderr?: string }; code = err.status ?? 1; stderr = String(err.stderr ?? ''); }
      expect(code, argv.join(' ')).toBe(125);
      expect(stderr).toContain('refused (entry-unprivileged)');
    }
  });
});
````


- [ ] **Step 2: Run them — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-reach.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-entry.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts --maxWorkers=1 )
```

Measured:

- `server/test/ccd-ws-expire-reach.test.ts`: `3 failed (3)`
  - × ccd caps advertises the verb AND its capability token
  - × the dispatcher routes ws-expire (its own usage, not the unknown-verb line) and the usage line names it
  - × an unprivileged explicit bash is refused at entry for both protected shapes — nothing runs
- `server/test/ccd-child-reclaim-entry.test.ts`: `8 failed | 92 passed | 1 skipped (101)`
  - × ws-expire alone → protected
  - × ws-expire with the full tail → protected
  - × ws-expire with a malformed tail (the body’s parser owns that) → protected
  - × valid audit --expire → protected
  - × WS-EXPIRE alone → protected at the launcher
  - × ws-expİre (a non-ASCII fold) → protected at the launcher
  - × WS-AUDIT --SESSION x --EXPIRE → protected at the launcher
  - × the CONTROL: under that nocasematch the BODY reads every variant as protected (it refuses an unprivileged one), and none of the ordinary ones
- `server/test/ccd-archive.test.ts`: `1 failed | 76 passed (77)`
  - × advertises exactly the verbs the dispatcher implements, plus the known capability tokens

- [ ] **Step 3: The arm, the token, and both classifiers.** The body's guard and its comment keep their line count (they sit at the top of `ccd/ccd`, above every frozen anchor); the verb's caps line carries the verb's name (Pre-flight finding 8).

<!-- replay: T7 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
# A direct `ws-reclaim`, or a direct `ws-audit --session <id> --reclaim
# [--defer-expired]`, must be running under Bash >= 4.4 in PRIVILEGED mode with
````

Replace with:

````bash
# A direct `ws-reclaim` or `ws-expire`, or a direct `ws-audit --session <id>
# --reclaim [--defer-expired]` or `… --expire`, runs under Bash >= 4.4 PRIVILEGED with
````

<!-- replay: T7 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
if [[ "${BASH_SOURCE[0]}" == "${0}" ]] && { [[ "${1-}" == ws-reclaim ]] \
     || { [[ $# -eq 4 || $# -eq 5 ]] && [[ "${1-}" == ws-audit && "${2-}" == --session && "${4-}" == --reclaim ]] \
````

Replace with:

````bash
if [[ "${BASH_SOURCE[0]}" == "${0}" ]] && { [[ "${1-}" == ws-reclaim || "${1-}" == ws-expire ]] \
     || { [[ $# -eq 4 || $# -eq 5 ]] && [[ "${1-}" == ws-audit && "${2-}" == --session && ( "${4-}" == --reclaim || ( $# -eq 4 && "${4-}" == --expire ) ) ]] \
````

<!-- replay: T7 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  echo reclaim-pause-v1
````

Replace with:

````bash
  echo reclaim-pause-v1; echo expire-v1; echo ws-expire   # the verb rides here, not in the list above, which sits above the frozen corpus; see "EXPIRE-V1"
````

<!-- replay: T7 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash

# ── end archived-workspace expiry ───────────────────────────────────────────── EXPIRE-END ──
````

Replace with:

````bash

# EXPIRE-V1. `cmd_caps` echoes it: this box has `ws-audit --expire`,
# `ws-expire`, the `expire` journal act, the `expire:` breadcrumb with ws-reap's
# refusal of it (`expire-in-progress`, the MIRROR block) and ws-restore's, and
# the spawn gate — one ccd inode, one token. (`ws-reclaim` meets an `expire:`
# breadcrumb only on a row that carries a child marker, which this verb
# refuses to touch; its fork answers it `reap-in-progress`, unchanged.) The server composes the destructive verb ONLY behind
# `capSupported(state, 'expire-v1')`, which refuses on no evidence; wave 3b
# composes it, this wave ships it inert.
# ── end archived-workspace expiry ───────────────────────────────────────────── EXPIRE-END ──
````

<!-- replay: T7 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  ws-reclaim) shift; cmd_ws_reclaim "$@" ;;
  ws-hold)    shift; cmd_ws_hold "$@" ;;
````

Replace with:

````bash
  ws-reclaim) shift; cmd_ws_reclaim "$@" ;;
  ws-expire) shift; cmd_ws_expire "$@" ;;
  ws-hold)    shift; cmd_ws_hold "$@" ;;
````

<!-- replay: T7 replace ccd/ccd -->
In `ccd/ccd`, find:

````bash
  *) echo "usage: ccd {start|ensure|supervise|enable|stop|forget|swap|swap-self|prefer|ls|menu|attach|clip|caps|ws-add|ws-rm|ws-rename|ws-gc|ws-archive|ws-restore|ws-attic|ws-audit|ws-reap|ws-reclaim|ws-hold|ws-release|coord-pause|reclaim-pause|win-size|account-pane|project-pool|route|pr-open|pr-state|version} <args>" >&2; exit 1 ;;
````

Replace with:

````bash
  *) echo "usage: ccd {start|ensure|supervise|enable|stop|forget|swap|swap-self|prefer|ls|menu|attach|clip|caps|ws-add|ws-rm|ws-rename|ws-gc|ws-archive|ws-restore|ws-attic|ws-audit|ws-reap|ws-reclaim|ws-expire|ws-hold|ws-release|coord-pause|reclaim-pause|win-size|account-pane|project-pool|route|pr-open|pr-state|version} <args>" >&2; exit 1 ;;
````

<!-- replay: T7 replace ccd/ccd-entry.py -->
In `ccd/ccd-entry.py`, find:

````python
#   ws-audit --session <value> --reclaim [--defer-expired] — the token skeleton;
````

Replace with:

````python
#   ws-expire <any tail>                          — likewise (workspace lifecycle wave 3: the
#     server-composed teardown of an archived workspace, ws-reclaim's sibling)
#   ws-audit --session <value> --reclaim [--defer-expired] — the token skeleton;
#   ws-audit --session <value> --expire           — the expiry's token skeleton;
````

<!-- replay: T7 replace ccd/ccd-entry.py -->
In `ccd/ccd-entry.py`, find:

````python
    if argv[:1] and folds_to(argv[0], 'ws-reclaim'):
````

Replace with:

````python
    if argv[:1] and (folds_to(argv[0], 'ws-reclaim') or folds_to(argv[0], 'ws-expire')):
        return True
    if len(argv) == 4 and folds_to(argv[0], 'ws-audit') and folds_to(argv[1], '--session') \
            and folds_to(argv[3], '--expire'):
````

<!-- replay: T7 replace server/src/ccdargv.ts -->
In `server/src/ccdargv.ts`, find:

````ts
export const RECLAIM_PAUSE_CAP = 'reclaim-pause-v1';

/**
 * Whether the DEPLOYED ccd advertised a CAPABILITY token — a verb-shaped string
````

Replace with:

````ts
export const RECLAIM_PAUSE_CAP = 'reclaim-pause-v1';

/** The `ccd caps` token that says this box has archived-workspace expiry (workspace lifecycle spec 2026-09-24 §5.3,
 *  wave 3): `ws-audit --expire`, `ws-expire`, the `expire` journal act and the `expire:` breadcrumb with its refusals
 *  and its spawn gate — one ccd inode. Spelled ONCE in `server/src`; ccd's `echo expire-v1` and
 *  `ccd-archive.test.ts`'s `KNOWN_CAPABILITY_TOKENS` are the other two spellings, held equal by that test's
 *  `toContain`.
 *
 *  READ IT WITH `capSupported`, NEVER `verbSupported`: the verb it gates deletes a workspace, and a destructive verb
 *  sent to a box with no evidence it exists is the failure the capability reader was built to prevent. Nothing reads
 *  it in this build — wave 3b's lane does, before its first audit. */
export const EXPIRE_CAP = 'expire-v1';

/**
 * Whether the DEPLOYED ccd advertised a CAPABILITY token — a verb-shaped string
````


- [ ] **Step 4: Re-stamp ccd and run.**

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
( cd server && ./node_modules/.bin/vitest run test/ccd-ws-expire-reach.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-child-reclaim-entry.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/capsupported.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ownership.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
```

Measured (no census tax: this task adds no `_reg_get` call):

- `server/test/ccd-ws-expire-reach.test.ts`: `3 passed (3)`
- `server/test/ccd-child-reclaim-entry.test.ts`: `100 passed | 1 skipped (101)`
- `server/test/ccd-archive.test.ts`: `77 passed (77)`
- `server/test/capsupported.test.ts`: `21 passed (21)`
- `server/test/ownership.test.ts`: `14 passed (14)`
- `server/test/ccd-reg-get-census.test.ts`: `3 passed (3)`
- `server/test/session-hook.test.ts` (`-t` the citation cases): `5 passed | 330 skipped (335)`

- [ ] **Step 5: Mutation check, then commit.**

| # | Edit (restore after; re-stamp after a `ccd/ccd` edit) | Measured red |
|---|---|---|
| M7.1 | the body's guard forgets `ws-expire`. `ccd/ccd`: `{ [[ "${1-}" == ws-reclaim \|\| "${1-}" == ws-expire ]] \` → `{ [[ "${1-}" == ws-reclaim ]] \` | `server/test/ccd-child-reclaim-entry.test.ts`: 4 failed \| 96 passed \| 1 skipped (101) — red: ws-expire alone → protected (+3 more)<br>`server/test/ccd-ws-expire-reach.test.ts`: 1 failed \| 2 passed (3) — red: an unprivileged explicit bash is refused at entry for both protected shapes — nothing runs |
| M7.2 | the body's guard forgets `ws-audit … --expire`. `ccd/ccd`: `( "${4-}" == --reclaim \|\| ( $# -eq 4 && "${4-}" == --expire ) )` → `"${4-}" == --reclaim` | `server/test/ccd-child-reclaim-entry.test.ts`: 2 failed \| 98 passed \| 1 skipped (101) — red: valid audit --expire → protected (+1 more)<br>`server/test/ccd-ws-expire-reach.test.ts`: 1 failed \| 2 passed (3) — red: an unprivileged explicit bash is refused at entry for both protected shapes — nothing runs |
| M7.3 | the launcher forgets `ws-expire`. `ccd/ccd-entry.py`: `    if argv[:1] and (folds_to(argv[0], 'ws-reclaim') or folds_to(argv[0], 'ws-expire')):` → `    if argv[:1] and folds_to(argv[0], 'ws-reclaim'):` | `server/test/ccd-child-reclaim-entry.test.ts`: 5 failed \| 95 passed \| 1 skipped (101) — red: ws-expire alone → protected (+4 more) |
| M7.4 | the launcher forgets `ws-audit … --expire`. `ccd/ccd-entry.py`: `            and folds_to(argv[3], '--expire'):⏎        return True` → `            and folds_to(argv[3], '--expire-nothing'):⏎        return True` | `server/test/ccd-child-reclaim-entry.test.ts`: 2 failed \| 98 passed \| 1 skipped (101) — red: valid audit --expire → protected (+1 more) |
| M7.5 | `cmd_caps` stops printing `expire-v1`. `ccd/ccd`: `  echo reclaim-pause-v1; echo expire-v1; echo ws-expire` → `  echo reclaim-pause-v1; echo ws-expire` | `server/test/ccd-ws-expire-reach.test.ts`: 1 failed \| 2 passed (3) — red: ccd caps advertises the verb AND its capability token<br>`server/test/ccd-archive.test.ts`: 1 failed \| 76 passed (77) — red: advertises exactly the verbs the dispatcher implements, plus the known capability tokens |
| M7.6 | the dispatcher arm deleted. `ccd/ccd`: `  ws-expire) shift; cmd_ws_expire "$@" ;;⏎` → (deleted) | `server/test/ccd-ws-expire-reach.test.ts`: 1 failed \| 2 passed (3) — red: the dispatcher routes ws-expire (its own usage, not the unknown-verb line) and the usage line names it<br>`server/test/ccd-archive.test.ts`: 1 failed \| 76 passed (77) — red: advertises exactly the verbs the dispatcher implements, plus the known capability tokens |
| M7.7 | `EXPIRE_CAP` spelled differently from ccd's echo. `server/src/ccdargv.ts`: `export const EXPIRE_CAP = 'expire-v1';` → `export const EXPIRE_CAP = 'expire-v2';` | `server/test/ccd-archive.test.ts`: 1 failed \| 76 passed (77) — red: advertises exactly the verbs the dispatcher implements, plus the known capability tokens |

```bash
git add ccd/ccd ccd/ccd-entry.py server/src/ccdargv.ts server/test/ccd-ws-expire-reach.test.ts \
  server/test/ccd-child-reclaim-entry.test.ts server/test/ccd-archive.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): ws-expire reachable — dispatcher, expire-v1, the entry boundary

The dispatcher routes ws-expire; ccd caps names the verb and expire-v1,
whose third spelling is EXPIRE_CAP. ws-expire and ws-audit --session <id>
--expire cross the direct-entry boundary ws-reclaim crosses: the
launcher starts them under bash -p and the body refuses them otherwise,
one grammar table for both classifiers.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: What lets the server compose the verb — and nothing that calls it

**Model routing:** `sonnet`, effort `high` — the grant's shape is fixed by g13's precedent; the type-level fixture is the check.

**Files:** red `agent/test/types/bypasses/g15-ws-expire-without-expect.ts`, `agent/test/types/ok/legit-whitelist.ts`, `agent/test/whitelist-structural.test.ts`, `server/test/ccdargv-dec-parity.test.ts`, `server/test/remote-runner.test.ts`, `server/test/whitelist-subset.test.ts`; green `agent/src/whitelist.ts`, `server/src/ccdargv.ts`, `server/src/remote/runner.ts`.

**Interfaces:**
- Produces: `CCD_ARGV.wsExpireAudit(id)` → `['ws-audit','--session',id,'--expire']` (rides the existing `['ws-audit','--session']` grant); `CCD_ARGV.wsExpire(token, id, dec)` → `['ws-expire','--expect',token,'--session',id, …decFlags(dec)]`; `CCD_VERB_TIMEOUT_MS['ws-expire'] = 240_000`; the agent grant `['ws-expire','--expect']` with `REQUIRED_VERB_FLAG['ws-expire'] = '--expect'`.
- Not produced, by ruling (A): any caller. `grep -rn 'wsExpire\b\|wsExpireAudit\|EXPIRE_CAP' server/src` prints only `ccdargv.ts` (Task 10 checks it).

- [ ] **Step 1: Write the failing tests** — the negative type fixture (MUST NOT COMPILE once enrolled), the positive control, the structural expectation, the cross-package grant proof, the budget, and `ccdargv-dec-parity`'s eighth dec-appending verb, run through the real binary.

<!-- replay: T8 create agent/test/types/bypasses/g15-ws-expire-without-expect.ts -->
Create `agent/test/types/bypasses/g15-ws-expire-without-expect.ts`:

````ts
// BYPASS FIXTURE — MUST NOT COMPILE.
//
// WORKSPACE LIFECYCLE, wave 3: `['ws-expire', '--expect']` -> `['ws-expire']`,
// i.e. a grant that keeps the destructive verb and drops its confirmation
// token — g13's shape for ws-reclaim's sibling, the teardown of an archived
// workspace seven days after its archive.
//
// `isExecAllowed` is PREFIX-matching, so `['ws-expire']` admits the argv
// `CCD_ARGV.wsExpire` builds exactly as the two-token grant does, and
// `server/test/whitelist-subset.test.ts`'s reachability layer stays green on
// the narrowed grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`:
// it makes this edit a TS2322 on the proof line below and a boot refusal at
// module load. A bare `ws-expire` permits an UNCONFIRMED expiry of any id the
// server was talked into composing, with no fingerprint — and no archive epoch —
// re-proved against the box at the instant of deletion.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['ws-expire']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
````

<!-- replay: T8 replace agent/test/types/ok/legit-whitelist.ts -->
In `agent/test/types/ok/legit-whitelist.ts`, find:

````ts
export type WsReclaimNeedsExpect = Assert<Equals<(typeof REQUIRED_VERB_FLAG)['ws-reclaim'], '--expect'>>;
export type WsRmIsUngrantable = Assert<'ws-rm' extends (typeof UNGRANTABLE_VERBS)[number] ? true : false>;
````

Replace with:

````ts
export type WsReclaimNeedsExpect = Assert<Equals<(typeof REQUIRED_VERB_FLAG)['ws-reclaim'], '--expect'>>;
/** Archived-workspace expiry (workspace lifecycle wave 3): ws-reclaim's sibling, enrolled on its confirmation token;
 *  losing the enrolment stops this project compiling. `g15-ws-expire-without-expect.ts` is the other side. */
export type WsExpireNeedsExpect = Assert<Equals<(typeof REQUIRED_VERB_FLAG)['ws-expire'], '--expect'>>;
export type WsRmIsUngrantable = Assert<'ws-rm' extends (typeof UNGRANTABLE_VERBS)[number] ? true : false>;
````

<!-- replay: T8 replace agent/test/whitelist-structural.test.ts -->
In `agent/test/whitelist-structural.test.ts`, find:

````ts
    what: 'the reclaim kill-switch granted without the flag that is its whole argument surface',
    codes: ['TS2322'],
````

Replace with:

````ts
    what: 'the reclaim kill-switch granted without the flag that is its whole argument surface',
    codes: ['TS2322'],
  },
  // WORKSPACE LIFECYCLE wave 3, g13's shape for ws-reclaim's sibling: the archived workspace's teardown, enrolled on
  // its confirmation token, so the narrowed grant is a compile error.
  'g15-ws-expire-without-expect.ts': {
    what: 'the archived-workspace expiry verb granted without its confirmation token',
    codes: ['TS2322'],
````

<!-- replay: T8 replace agent/test/whitelist-structural.test.ts -->
In `agent/test/whitelist-structural.test.ts`, find:

````ts
  // the row reds here as an assertion instead.
  it('throws on a ws-reclaim with no confirmation token, the second destructive verb', () => {
````

Replace with:

````ts
  // the row reds here as an assertion instead.
  it('throws on a ws-expire with no confirmation token, the third destructive verb (workspace lifecycle wave 3)', () => {
    expect(() => auditExecWhitelist(withCcd([['ws-expire']])))
      .toThrow(/only grantable with '--expect'/);
    expect(() => auditExecWhitelist(withCcd([['ws-expire', '--session']])))
      .toThrow(/only grantable with '--expect'/);
    expect(() => auditExecWhitelist(withCcd([['ws-expire', '--expect']]))).not.toThrow();
  });

  it('throws on a ws-reclaim with no confirmation token, the second destructive verb', () => {
````

<!-- replay: T8 replace server/test/ccdargv-dec-parity.test.ts -->
In `server/test/ccdargv-dec-parity.test.ts`, find:

````ts
  'ws-reclaim': { argv: (d) => CCD_ARGV.wsReclaim('a'.repeat(64), 7, ABSENT, false, d), reached: refusedForTheAbsentSession },
  'ws-add': {
````

Replace with:

````ts
  'ws-reclaim': { argv: (d) => CCD_ARGV.wsReclaim('a'.repeat(64), 7, ABSENT, false, d), reached: refusedForTheAbsentSession },
  // Workspace lifecycle, wave 3: ws-reclaim's sibling, the same parse and the same witness — the reap lock taken and
  // `no-such-session` answered as JSON for the absent id, the dec stripped before `--session` bound.
  'ws-expire': { argv: (d) => CCD_ARGV.wsExpire('a'.repeat(64), ABSENT, d), reached: refusedForTheAbsentSession },
  'ws-add': {
````

<!-- replay: T8 replace server/test/ccdargv-dec-parity.test.ts -->
In `server/test/ccdargv-dec-parity.test.ts`, find:

````ts
  it('derives the dec-appending verbs from the table, and finds seven — the five workspace verbs, ws-add and ws-reclaim', () => {
````

Replace with:

````ts
  it('derives the dec-appending verbs from the table, and finds eight — the five workspace verbs, ws-add, ws-reclaim and ws-expire', () => {
````

<!-- replay: T8 replace server/test/ccdargv-dec-parity.test.ts -->
In `server/test/ccdargv-dec-parity.test.ts`, find:

````ts
      .toEqual(['ws-add', 'ws-archive', 'ws-hold', 'ws-reclaim', 'ws-release', 'ws-rename', 'ws-restore']);
````

Replace with:

````ts
      .toEqual(['ws-add', 'ws-archive', 'ws-expire', 'ws-hold', 'ws-reclaim', 'ws-release', 'ws-rename', 'ws-restore']);
````

<!-- replay: T8 replace server/test/remote-runner.test.ts -->
In `server/test/remote-runner.test.ts`, find:

````ts
    [['ws-reclaim', '--expect', 'a'.repeat(64), '--child-of', '7', '--session', 'x'], 240_000],
    // The two SPAWNING verbs (F8, 2026-08-12). Both run `_spawn`, which blocks
````

Replace with:

````ts
    [['ws-reclaim', '--expect', 'a'.repeat(64), '--child-of', '7', '--session', 'x'], 240_000],
    // Archived-workspace expiry: the same machinery, so the same budget.
    [['ws-expire', '--expect', 'a'.repeat(64), '--session', 'x'], 240_000],
    // The two SPAWNING verbs (F8, 2026-08-12). Both run `_spawn`, which blocks
````

<!-- replay: T8 replace server/test/whitelist-subset.test.ts -->
In `server/test/whitelist-subset.test.ts`, find:

````ts
              { surface: 'agent', actor: 'run:7 reclaim close', reason: null }],
  wsAttic: ['demo-quiet-basin'],
````

Replace with:

````ts
              { surface: 'agent', actor: 'run:7 reclaim close', reason: null }],
  // WORKSPACE LIFECYCLE wave 3: the expiry's audit rides wsAudit's grant; the verb carries a dec, so layer 2 proves
  // the FLAGGED shape crosses its own grant.
  wsExpireAudit: ['demo-quiet-dune'],
  wsExpire: ['a'.repeat(64), 'demo-quiet-dune', { surface: 'agent', actor: 'expiry sweep', reason: null }],
  wsAttic: ['demo-quiet-basin'],
````

<!-- replay: T8 replace server/test/whitelist-subset.test.ts -->
In `server/test/whitelist-subset.test.ts`, find:

````ts
  // from the object across the package boundary.
  it('ws-reclaim is grantable ONLY with its confirmation token, and its audit needs no grant of its own', () => {
````

Replace with:

````ts
  // from the object across the package boundary.
  it('ws-expire is grantable ONLY with its confirmation token, and its audit needs no grant of its own', () => {
    const tok = 'a'.repeat(64);
    const ex = EXEC_WHITELIST.ccd.filter((p) => p[0] === 'ws-expire');
    expect(ex, 'exactly one ws-expire grant, on its token').toEqual([['ws-expire', '--expect']]);
    expect(isExecAllowed('ccd', ['ws-expire'])).toBe(false);
    expect(isExecAllowed('ccd', ['ws-expire', '--session', 'demo-quiet-dune'])).toBe(false);
    expect(isExecAllowed('ccd', [...CCD_ARGV.wsExpire(tok, 'demo-quiet-dune', null)])).toBe(true);
    expect(isExecAllowed('ccd', [...CCD_ARGV.wsExpireAudit('demo-quiet-dune')])).toBe(true);
    expect(UNGRANTABLE_VERBS, 'ws-expire has a lawful grantable form; it is not ungrantable').not.toContain('ws-expire');
  });

  it('ws-reclaim is grantable ONLY with its confirmation token, and its audit needs no grant of its own', () => {
````

<!-- replay: T8 replace server/test/whitelist-subset.test.ts -->
In `server/test/whitelist-subset.test.ts`, find:

````ts
                '--surface', 'agent', '--actor', 'run:7 reclaim close'],
    wsAttic: ['ws-attic', '--session', 'demo-quiet-basin'],
````

Replace with:

````ts
                '--surface', 'agent', '--actor', 'run:7 reclaim close'],
    wsExpireAudit: ['ws-audit', '--session', 'demo-quiet-dune', '--expire'],
    wsExpire: ['ws-expire', '--expect', 'a'.repeat(64), '--session', 'demo-quiet-dune', '--surface', 'agent', '--actor', 'expiry sweep'],
    wsAttic: ['ws-attic', '--session', 'demo-quiet-basin'],
````


- [ ] **Step 2: Run them — red.**

```bash
( cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/remote-runner.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccdargv-dec-parity.test.ts --maxWorkers=1 )
```

Measured:

- `agent/test/whitelist-structural.test.ts`: `3 failed | 55 passed (58)`
  - × g15-ws-expire-without-expect.ts
  - × the positive control compiles clean
  - × throws on a ws-expire with no confirmation token, the third destructive verb (workspace lifecycle wave 3)
- `server/test/whitelist-subset.test.ts`: `2 failed | 88 passed (90)`
  - × has a sample for every CCD_ARGV entry
  - × ws-expire is grantable ONLY with its confirmation token, and its audit needs no grant of its own
- `server/test/remote-runner.test.ts`: `1 failed | 22 passed (23)`
  - × sends ["ws-expire","--expect","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","--session","x"] with a 240000 ms budget
- `server/test/ccdargv-dec-parity.test.ts`: `1 failed | 12 passed (13)`
  - × derives the dec-appending verbs from the table, and finds eight — the five workspace verbs, ws-add, ws-reclaim and ws-expire

- [ ] **Step 3: The builders, the budget, the grant and its enrolment.**

<!-- replay: T8 replace agent/src/whitelist.ts -->
In `agent/src/whitelist.ts`, find:

````ts
  'reclaim-pause': '--state',
````

Replace with:

````ts
  'reclaim-pause': '--state', 'ws-expire': '--expect',
````

<!-- replay: T8 replace agent/src/whitelist.ts -->
In `agent/src/whitelist.ts`, find:

````ts
    ['ws-reclaim', '--expect'],
    ['ws-attic', '--session'],
````

Replace with:

````ts
    ['ws-reclaim', '--expect'],
    // ARCHIVED-WORKSPACE EXPIRY (workspace lifecycle spec 2026-09-24 §5.3): ws-reclaim's sibling, the second
    // destructive verb the SERVER sends with no human in the path. Granted on its confirmation token for the same
    // reason, ENROLLED in `REQUIRED_VERB_FLAG` above (g15), and its audit rides `['ws-audit','--session']`. ccd
    // re-proves the token — which binds the archive's epoch — inside the reap lock.
    ['ws-expire', '--expect'],
    ['ws-attic', '--session'],
````

<!-- replay: T8 replace server/src/ccdargv.ts -->
In `server/src/ccdargv.ts`, find:

````ts
          ...deferFlags(deferExpired), ...decFlags(dec)]),
  wsAttic:   (id: string) => argv(['ws-attic', '--session', id]),
````

Replace with:

````ts
          ...deferFlags(deferExpired), ...decFlags(dec)]),
  /** `ws-audit --expire` (workspace lifecycle, spec 2026-09-24 §5.3): the SAME verb and granted prefix as
   *  `wsAudit` — `['ws-audit','--session']` — with the mode flag after the id, the order `cmd_ws_audit` reads. No
   *  grant of its own, and no `--defer-expired`: an expiry never skips its presence rungs. */
  wsExpireAudit: (id: string) => argv(['ws-audit', '--session', id, '--expire']),
  /** `ws-expire` — the server-composed teardown of an ARCHIVED workspace seven days after its archive. `token` is
   *  `ws-audit --expire`'s, re-proven by ccd inside the reap lock; it binds the archive's epoch. The confirmation token
   *  LEADS (`['ws-expire','--expect']` is the grant); the dec trails, and ccd strips it before it binds a positional.
   *  Composed by nothing in this build: workspace lifecycle wave 3b's lane is its one caller, behind `EXPIRE_CAP`. */
  wsExpire: (token: string, id: string, dec: ActorFlags | null) =>
    argv(['ws-expire', '--expect', token, '--session', id, ...decFlags(dec)]),
  wsAttic:   (id: string) => argv(['ws-attic', '--session', id]),
````

<!-- replay: T8 replace server/src/remote/runner.ts -->
In `server/src/remote/runner.ts`, find:

````ts
  'ws-reclaim': 240_000,
  // The two SPAWNING verbs, and the reason they need the agent's MAXIMUM
````

Replace with:

````ts
  'ws-reclaim': 240_000,
  // Archived-workspace expiry (spec 2026-09-24 §5.3): ws-reclaim's machinery — the pin phase, the settle and the same
  // teardown — on an archived workspace, so it earns the same budget.
  'ws-expire': 240_000,
  // The two SPAWNING verbs, and the reason they need the agent's MAXIMUM
````


- [ ] **Step 4: Run — green.**

```bash
( cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/remote-runner.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccdargv-dec-parity.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/verb-gate.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/unattended-actor.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts --maxWorkers=1 )
```

Measured:

- `agent/test/whitelist-structural.test.ts`: `58 passed (58)`
- `server/test/whitelist-subset.test.ts`: `94 passed (94)`
- `server/test/remote-runner.test.ts`: `23 passed (23)`
- `server/test/ccdargv-dec-parity.test.ts`: `14 passed (14)`
- `server/test/verb-gate.test.ts`: `12 passed (12)`
- `server/test/unattended-actor.test.ts`: `24 passed (24)`
- `server/test/typecheck-tests.test.ts`: `12 passed (12)`

- [ ] **Step 5: Mutation check, then commit.**

| # | Edit (restore after; re-stamp after a `ccd/ccd` edit) | Measured red |
|---|---|---|
| M8.1 | `ws-expire`'s enrolment deleted from `REQUIRED_VERB_FLAG`. `agent/src/whitelist.ts`: `  'reclaim-pause': '--state', 'ws-expire': '--expect',` → `  'reclaim-pause': '--state',` | `agent/test/whitelist-structural.test.ts`: 3 failed \| 55 passed (58) — red: g15-ws-expire-without-expect.ts (+2 more) |
| M8.2 | the grant narrowed to the bare verb. `agent/src/whitelist.ts`: `    ['ws-expire', '--expect'],⏎` → `    ['ws-expire'],⏎` | `agent/test/whitelist-structural.test.ts`: Test Files 1 failed (1), no tests — the module refuses to load: `EXEC_WHITELIST['ccd'] grants 'ws-expire', but 'ws-expire' is only grantable with '--expect' immediately after it … Refusing to start.` (the boot refusal; the type-level twin is g15's TS2322, M8.1) |
| M8.3 | `wsExpire` drops its dec. `server/src/ccdargv.ts`: `    argv(['ws-expire', '--expect', token, '--session', id, ...decFlags(dec)]),` → `    argv(['ws-expire', '--expect', token, '--session', id]),` | `server/test/whitelist-subset.test.ts`: 1 failed \| 93 passed (94) — red: wsExpire builds the exact argv, token for token<br>`server/test/ccdargv-dec-parity.test.ts`: 1 failed \| 12 passed (13) — red: derives the dec-appending verbs from the table, and finds eight — the five workspace verbs, ws-add, ws-reclaim and ws-expire |
| M8.4 | `ws-expire`'s budget row deleted. `server/src/remote/runner.ts`: `  'ws-expire': 240_000,⏎` → (deleted) | `server/test/remote-runner.test.ts`: 1 failed \| 22 passed (23) — red: sends ["ws-expire","--expect","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","--session","x"] with a 240000 ms budget |

```bash
git add server/src/ccdargv.ts server/src/remote/runner.ts agent/src/whitelist.ts \
  agent/test/types/bypasses/g15-ws-expire-without-expect.ts agent/test/types/ok/legit-whitelist.ts \
  agent/test/whitelist-structural.test.ts server/test/whitelist-subset.test.ts server/test/remote-runner.test.ts \
  server/test/ccdargv-dec-parity.test.ts
git commit -m "$(cat <<'MSG'
feat(server,agent): what lets the server compose ws-expire — and no caller

CCD_ARGV.wsExpireAudit and wsExpire, the 240 s budget, and the agent
grant ['ws-expire','--expect'] enrolled in REQUIRED_VERB_FLAG so a bare
grant is a TS2322 and a boot refusal (g15). Nothing calls the builders:
wave 3b's lane is their one caller, behind capSupported(EXPIRE_CAP).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: The contracts that move now — CLAUDE.md, the agent's rules, the spec; the skills never name the verb

**Model routing:** `sonnet`, effort `medium`.

**Files:** red `server/test/ws-expire-prose.test.ts`; green `CLAUDE.md`, `agent/CLAUDE.md`, `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`.

**Interfaces:** CLAUDE.md's SAFETY bullet forbids `ws-expire` to every session (ruling C) and keeps "All five forbidden; `ws-reap` is **human-only by contract**." literally; `agent/CLAUDE.md` lists the gated verb; the spec's §5.3 gains this wave's amendment (each departure, by its effect). Coordinator clause 3, README's "after 7 days" and `wave-lifecycle.md` §6 are wave 3b's (ruling A).

- [ ] **Step 1: Write the failing test.**

<!-- replay: T9 create server/test/ws-expire-prose.test.ts -->
Create `server/test/ws-expire-prose.test.ts`:

````ts
// Workspace lifecycle wave 3 — who may remove an ARCHIVED workspace (spec 2026-09-24 §5.3, "The contracts that
// move"). Narrowed, never widened: every destructive verb stays forbidden to every session, `ws-reap` stays human-only
// literally, and the one new remover is the server, on an archived workspace seven days after its archive. The skill
// corpora never name the verb — CCR-15 wave 3's ruling for the server-composed `ws-reclaim`, and the same argument:
// a skill that names a verb has given a model a reason to reach for it.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const flat = (f: string): string => readFileSync(path.join(root, f), 'utf8').replace(/\s+/g, ' ');

/** Every file under a skill's directory, recursively — SKILL.md and every reference it ships. */
const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? filesUnder(p) : [p];
});
const SKILLS = ['ccd/coordinator-skill', 'ccd/worker-skill', 'ccd/reviewer-skill'];

describe('CLAUDE.md’s SAFETY bullet', () => {
  const md = flat('CLAUDE.md');
  it('still forbids all five destructive verbs, and keeps ws-reap human-only, literally', () => {
    expect(md).toContain('All five forbidden; `ws-reap` is **human-only by contract**.');
  });
  it('forbids ws-expire to every session, and says whose act it is, on what and when', () => {
    expect(md).toContain('**`ws-expire` is forbidden to every session too**');
    expect(md).toContain('it is the SERVER\'s act on an ARCHIVED workspace only, seven days after its archive');
    expect(md).toContain('(never a main checkout, never a child)');
    expect(md).toContain('with a token that binds that archive and is re-proved on the box');
  });
});

describe('agent/CLAUDE.md’s gated verbs', () => {
  it('names ws-expire beside ws-reclaim, on its confirmation token', () => {
    expect(flat('agent/CLAUDE.md')).toContain('`ws-expire` requires `--expect` (the expiry token, which binds the archive;');
  });
});

describe('the skill corpora never name the verb', () => {
  const files = SKILLS.flatMap((d) => filesUnder(path.join(root, d)));
  it('reads every skill file there is — an empty corpus would pass vacuously', () => {
    expect(files.length).toBeGreaterThanOrEqual(SKILLS.length);
  });
  it.each(SKILLS)('%s never names ws-expire', (dir) => {
    for (const f of files.filter((p) => p.startsWith(path.join(root, dir)))) {
      expect(readFileSync(f, 'utf8'), path.relative(root, f)).not.toContain('ws-expire');
    }
  });
});
````


- [ ] **Step 2: Run it — red.**

```bash
( cd server && ./node_modules/.bin/vitest run test/ws-expire-prose.test.ts --maxWorkers=1 )
```

Measured (the passes are what is already true: the five verbs and the skills' silence):

- `server/test/ws-expire-prose.test.ts`: `2 failed | 5 passed (7)`
  - × forbids ws-expire to every session, and says whose act it is, on what and when
  - × names ws-expire beside ws-reclaim, on its confirmation token

- [ ] **Step 3: The sentences.**

<!-- replay: T9 replace CLAUDE.md -->
In `CLAUDE.md`, find:

````markdown
  the live host from a shell or a test.
````

Replace with:

````markdown
  the live host from a shell or a test. **`ws-expire` is forbidden to every session too**: it is the SERVER's act on an
  ARCHIVED workspace only, seven days after its archive (never a main checkout, never a child), with a token that binds
  that archive and is re-proved on the box — never a session's verb, and never run against the live host from a shell or a test.
````

<!-- replay: T9 replace agent/CLAUDE.md -->
In `agent/CLAUDE.md`, find:

````markdown
  server composes it for a child with no human in the path). **Ungrantable verbs:** `ws-rm`, `ws-gc`. An empty prefix
````

Replace with:

````markdown
  server composes it for a child with no human in the path), `ws-expire` requires `--expect` (the expiry token, which
  binds the archive; the server composes it for an archived workspace with no human in the path). **Ungrantable verbs:** `ws-rm`, `ws-gc`. An empty prefix
````

<!-- replay: T9 replace docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md -->
In `docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md`, find:

````markdown

### 5.4 Stage 4 — the dead-coordinator lane (L4)
````

Replace with:

````markdown

**As wave 3 builds the verb** (amended with its plan, `docs/superpowers/plans/2026-10-04-workspace-lifecycle-wave3-ws-expire.md`;
each item is a departure named there). Wave 3 ships `ws-expire` and only what lets the server compose it — the
`CcdArgv` builders, `expire-v1`, the grant and its enrolment. The lane, the switch's wider label, coordinator clause 3
and the README and `wave-lifecycle.md` §6 text above are wave 3b's, planned after it merges.
- **Rung 5 asks more of an expiry.** A DETACHED live pane, or a unit that is running, refuses `live` (retryable): an
  archived workspace has had no pane since its archive (§3 item 2), and `attached` and `tree-busy` alone let both
  through, measured. The question is keyed on the token's binding, not on a flavour a caller could forget; on Darwin a
  `failed` unit answer that comes from ccd's own stamp is re-asked of launchd, as the reclaim tail re-asks it; and an
  interrupted expiry's resume asks it again at its first phase, before anything has been stopped. `ws-reclaim` is never
  asked this. It asks the pane and the unit, not processes: a shell an operator opened in the worktree by hand is not
  seen.
- **Rung 2′'s words.** `not-archived` (no stamp), `not-expired` (younger than `WS_EXPIRE_AFTER_S`, a future stamp
  included) and `child`; a stamp that is not an epoch ccd writes is unmeasured, never old.
- **`ws-reap`'s `expire:` arm refuses** (`expire-in-progress`), the twin of its `reclaim:` mirror. The arm that RESUMES
  an interrupted expiry and re-asserts the archive epoch is `ws-expire`'s own. `ws-reclaim` meets an `expire:`
  breadcrumb only on a row with a child marker, which `ws-expire` never touches, and answers it `reap-in-progress`, as
  it answers every breadcrumb not its own.
- **A return during an expiry refuses, on every path.** Measured: before this wave no spawn path honoured a breadcrumb,
  and only `ws-restore` took the reap lock. `start`, `ensure` and `swap` now refuse an `expire:` breadcrumb — and, for
  an archived row, a held reap lock — before they journal their act (a refused return must not read as a return to
  §9's instrument), and so does `enable`, which journals before it reaches `start`; on an archived row a breadcrumb
  that stands but cannot be read refuses too; `ws-restore` refuses `in-progress` under its lock; `_spawn_start`, where every session pane is
  made, holds the same gate as the backstop. The lock half refuses whatever holds it: a spawn of an archived row during
  a human `ws-reap` or `ws-restore` of that row refuses too, where it used to race. `ws-add` never mints a row over a
  standing breadcrumb (its slug stays taken).
- **The direct-entry boundary.** `ws-expire` and `ws-audit --session <id> --expire` are protected shapes, as
  `ws-reclaim` and its audit are: the installed launcher starts them under `bash -p`, and the body refuses them
  otherwise.
- **The temp root.** The shared tail removes `~/.cc-tmp/<id>` unrecorded, as it does for a reclaim. Only a child is
  ever given one, and an expiry never touches a row with a child marker, so what stands there was a previous row's
  under a recycled slug — leaked scratch, not this workspace's.
- **Its records.** The tombstone's kind is `"mode":"expire"` with `archivedAt`; the journal carries the epoch as the
  existing `meas.archivedAt`; `ws-audit --expire` prints a document of its own (`session`, `mode`, `archivedAt`,
  `alive`, `exists`, `reaping`, `sensitive`, `resume` when resuming, `verdict`, `detail`, `token` when it mints one).

### 5.4 Stage 4 — the dead-coordinator lane (L4)
````


- [ ] **Step 4: Run — green.**

```bash
( cd server && ./node_modules/.bin/vitest run test/ws-expire-prose.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/child-reclaim-prose.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/pools-prose.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/box-token-census.test.ts --maxWorkers=1 )
```

Measured:

- `server/test/ws-expire-prose.test.ts`: `7 passed (7)`
- `server/test/child-reclaim-prose.test.ts`: `4 passed (4)`
- `server/test/pools-prose.test.ts`: `27 passed (27)`
- `server/test/box-token-census.test.ts`: `23 passed (23)`

- [ ] **Step 5: Mutation check, then commit.**

| # | Edit (restore after; re-stamp after a `ccd/ccd` edit) | Measured red |
|---|---|---|
| M9.1 | CLAUDE.md's `ws-expire` sentence deleted. `CLAUDE.md`: ` **`ws-expire` is forbidden to every session too**: it is the SERVER's act on an` → ` It is the SERVER's act on an` | `server/test/ws-expire-prose.test.ts`: 1 failed \| 6 passed (7) — red: forbids ws-expire to every session, and says whose act it is, on what and when |
| M9.2 | the coordinator skill names the verb. `ccd/coordinator-skill/SKILL.md`: the line `<!-- ws-expire -->` APPENDED at the end of the file | `server/test/ws-expire-prose.test.ts`: 1 failed \| 6 passed (7) — red: ccd/coordinator-skill never names ws-expire |

```bash
git add CLAUDE.md agent/CLAUDE.md docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md \
  server/test/ws-expire-prose.test.ts
git commit -m "$(cat <<'MSG'
docs(safety): ws-expire is forbidden to every session — the server's, on archived workspaces

CLAUDE.md's SAFETY bullet and agent/CLAUDE.md's gated verbs name the new
destructive verb; ws-reap stays human-only, literally. The skill corpora
never name it, pinned. The spec's §5.3 records how wave 3 builds the verb.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: The whole branch, the deploy order, and the PR

**Model routing:** `sonnet`, effort `medium` — measurement and reporting; any red that is not a named flake goes back to its task.

- [ ] **Step 1: Merge `main` and re-measure what a merge can move.** `git fetch origin main && git merge origin/main` (never a rebase). If `ccd/ccd` or `shared/api.ts` merged with anything, re-stamp, re-measure the `_reg_get` census, re-run the five citation cases and repair README by content (ruling J).

- [ ] **Step 2: The repo-wide guards**, each its own process:

```bash
( cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/modelenv-single-writer.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/box-token-census.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/routing-references.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/ownership.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts --maxWorkers=1 )
git fetch origin main
( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts --maxWorkers=1 )
( cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts --maxWorkers=1 -t 'CITATION DEBT|README HAS ITS OWN CENSUS|LOCATION INDEXES|ROW PASS|RANGE BOUND' )
grep -rn 'wsExpire\b\|wsExpireAudit\|EXPIRE_CAP' server/src
```

Measured on this revision's last stage over `4100ae1c9` (the same counts the drafter measured over `a6daa9cf4`; `typecheck-tests` needs `agent/` and `pwa/` modules installed, or it cannot load `typescript`):

- `server/test/single-definition.test.ts`: `Test Files 1 passed (1); 274 passed (274)`
- `server/test/modelenv-single-writer.test.ts`: `Test Files 1 passed (1); 7 passed (7)`
- `server/test/box-token-census.test.ts`: `Test Files 1 passed (1); 23 passed (23)`
- `server/test/routing-references.test.ts`: `Test Files 1 passed (1); 11 passed (11)`
- `server/test/typecheck-tests.test.ts`: `Test Files 1 passed (1); 12 passed (12)`
- `server/test/ccd-workspaces.test.ts`: `Test Files 1 passed (1); 81 passed (81)`
- `server/test/ownership.test.ts`: `Test Files 1 passed (1); 14 passed (14)`
- `server/test/topology-clean.test.ts`: `Test Files 1 passed (1); 55 passed (55)`
- `server/test/deviation-refs.test.ts`: `Test Files 1 passed (1); 31 passed (31)`
- `server/test/session-hook.test.ts` (`-t` the citation cases): `Test Files 1 passed (1); 5 passed | 330 skipped (335)`
- `grep/server/src callers of wsExpire/wsExpireAudit/EXPIRE_CAP`: `server/src/ccdargv.ts`

The `grep` prints `server/src/ccdargv.ts` lines only — nothing calls the verb (ruling A).

- [ ] **Step 3: The suites, in full.** The server suite as twelve shards, sequentially, one denominator, each in the foreground with `--maxWorkers=1` (the fleet box's memory rule; twelve keeps each process short enough for a foreground call); then the agent suite; then the PWA's typecheck and its one touched suite (Task 2's `ACT_WORD`), or the whole PWA suite when the box is quiet. `TMPDIR` and `CCD_DISK_FLOOR_GB` as Global Constraints say.

```bash
for k in 1 2 3 4 5 6 7 8 9 10 11 12; do
  ( cd server && ./node_modules/.bin/vitest run --shard=$k/12 --maxWorkers=1 )
done
( cd agent && ./node_modules/.bin/vitest run --maxWorkers=1 )
( cd pwa && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/vitest run test/journal-words.test.ts --maxWorkers=1 )
```

The twelve `Test Files` counts must sum to `find server/test -name '*.test.ts' | wc -l` (500 on `4100ae1c9` with this plan's six new test files). Known reds that are not this wave's: tmp-sweep's "FAILS CLOSED…" (red on `main` on the fleet box), and the load flakes CLAUDE.md lists (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`) — re-run a red one IN ISOLATION before calling it a break. WHAT WAS MEASURED, AND ON WHAT. The drafter's full run, kept below as the reference, was SIX shards at `--maxWorkers=2` on the `b40f4145` stage (499 files then: 493 on that base plus this plan's six). This revision did not repeat a full sharded run — a foreground call on the fleet box is capped below a shard's length at `--maxWorkers=1` — and instead re-ran, one file per process on the final tree over `4100ae1c9`, every suite this revision's edits reach (each task's own, the child-reclamation suites, every suite that drives `cmd_enable`, and the Task 2 step's lifecycle suites) and the repo-wide guards of Step 2: all green, apart from three load timeouts named in Task 4's Step 5 that pass alone. The agent suite on that tree: `Test Files 25 passed (25); 454 passed (454)` (the drafter's 425 was `b40f4145`'s; #247 added `agent/test/deploy-verify.test.ts`). `pwa` `tsc --noEmit -p .`: rc 0; `pwa/test/journal-words.test.ts`: `5 passed (5)`. The drafter's run (a test title's own deviation number is shown as ‹n›: this plan spells none):

- `count/server/test/*.test.ts`: `499 files`
- `server/--shard=1/6`: `Test Files 3 failed | 81 passed (84); 4 failed | 2638 passed | 20 skipped (2662)`
  - × FULL flavour: the arm-2 child is a REAL `ccrc update` that completes under the parent's lock — no lock sentence, no sweep, the previous tag re-installed (§18 "arm 2 runs under the parent's lock"; Revi
  - × a hung ccd (sleep 600, the reviewer's own reproduction) does not delay listen
  - × acquires a failed or a reverted row, and a failed row elsewhere blocks nothing — the halt is the planner's (Task 4)
  - × test/boot.test.ts > the real composition root — boot never blocks on the local-caps probe > a hung ccd (sleep 600, the reviewer's own reproduction) does not delay listen
  - × test/ccrc-update.test.ts > ccrc update: the automatic restore (arms 2 and 3) > FULL flavour: the arm-2 child is a REAL `ccrc update` that completes under the parent's lock — no lock sentence, no sweep
  - × test/ccrc-update.test.ts > ccrc update: the automatic restore (arms 2 and 3) > the same-second parent and child: the child's backup refuses rather than corrupting the parent's, and arm 3 restores the 
  - × test/update-store-dispatch.test.ts > dispatchNode — the ONE lease acquire (design 2026-09-20 §6, §10) > acquires a failed or a reverted row, and a failed row elsewhere blocks nothing — the halt is the
  - × the same-second parent and child: the child's backup refuses rather than corrupting the parent's, and arm 3 restores the UNCORRUPTED one (fix round 1 item 16 / review 155 C25)
- `server/--shard=2/6`: `Test Files 2 failed | 81 passed (83); 4 failed | 3485 passed | 17 skipped (3506)`
  - × SessionStart costs no more than 4.2x the cheap PostToolUse arm, on a 200-row registry
  - × p95 of 20 runs stays under the budget (150ms CI allowance; 50ms target)
  - × refuses bad-id with "bad-id" at exit 2, having written nothing
  - × refuses reserved-id with "reserved-id" at exit 2, having written nothing
  - × test/ccrc-account.test.ts > ccrc account add: every identity refusal, before the first byte > refuses bad-id with "bad-id" at exit 2, having written nothing
  - × test/ccrc-account.test.ts > ccrc account add: every identity refusal, before the first byte > refuses reserved-id with "reserved-id" at exit 2, having written nothing
  - × test/session-hook.test.ts > the fleet gate and failure polarity > SessionStart costs no more than 4.2x the cheap PostToolUse arm, on a 200-row registry
  - × test/session-hook.test.ts > the fleet gate and failure polarity > p95 of 20 runs stays under the budget (150ms CI allowance; 50ms target)
- `server/--shard=3/6`: `Test Files 83 passed (83); 3290 passed | 9 skipped (3299)`
- `server/--shard=4/6`: `Test Files 1 failed | 82 passed (83); 1 failed | 3153 passed | 26 skipped (3180)`
  - × test/ccd-die-containment.test.ts > ccd/ccd > was actually parsed — the scan is looking at something
  - × was actually parsed — the scan is looking at something
- `server/--shard=5/6`: `Test Files 3 failed | 80 passed (83); 4 failed | 7192 passed | 4 skipped (7200)`
  - × FAILS CLOSED: claude is running and no sessions dir is readable, so nothing is removed
  - × PASSES on a tagged, coherent box — one line, no remedy
  - × PASSES with no pools directory at all — nothing is tagged, nothing is constrained
  - × test/ccd-child-reclaim-hardening.test.ts > the hidden read’s memo is a GLOBAL table — ccd sourced inside a function, many paths, two missing directories (spec §5.5 step 2) > the memo survives the sour
  - × test/ccrc-doctor.test.ts > ccrc doctor: pools > PASSES on a tagged, coherent box — one line, no remedy
  - × test/ccrc-doctor.test.ts > ccrc doctor: pools > PASSES with no pools directory at all — nothing is tagged, nothing is constrained
  - × test/tmp-sweep.test.ts > ccd-tmp-sweep: refusals and brakes > FAILS CLOSED: claude is running and no sessions dir is readable, so nothing is removed
  - × the memo survives the sourcing function’s return, answers every sibling, and holds one key per missing directory
- `server/--shard=6/6`: `Test Files 2 failed | 81 passed (83); 2 failed | 2853 passed | 4 skipped (2859)`
  - × a rate-limited listing no longer skips the latest probe (the reordering retires that optimization)
  - × a true merge onto the DEFAULT branch is proven by ancestry, and binds no PR (‹n›)
  - × test/ccd-ws-audit.test.ts > the proof ladder > a true merge onto the DEFAULT branch is proven by ancestry, and binds no PR (‹n›)
  - × test/update-catalogue.test.ts > the poller against a loopback fixture (design §7 Pins) > ‹n› — the latest-release probe (an off-page stable is not silently unresolvable) > a rate-limited listing no
- `agent/(whole)`: `Test Files 25 passed (25); 425 passed (425)` (on `b40f4145`; 454 on `4100ae1c9`, above)
- `pwa/tsc --noEmit -p .`: `rc 0`
- `pwa/test/journal-words.test.ts`: `Test Files 1 passed (1); 5 passed (5)`

Every file a shard reddened was then re-run ALONE on the same tree. Shard 4's `ccd-die-containment` red was NOT load: it was this plan's own — the census lacked the two helpers Tasks 5 and 6 add — and it is why each of those tasks now edits the census in its Step 5 AND stages it in its commit (the drafter's add lists left the file out, so the committed branch would have kept that red; the review's replay restored `main`'s copy of the census over the final tree and measured `1 failed | 11 passed (12)`):

- `server/test/ccd-die-containment.test.ts`: `12 passed (12)`
- `server/test/ccd-child-reclaim-hardening.test.ts`: `98 passed (98)`
- `server/test/ccd-ws-audit.test.ts`: `2 failed | 139 passed | 4 skipped (145)`
  - × evaluates GIT’s branch when the two records disagree, and refuses in ITS name
  - × ALLOWS a drifted workspace whose git branch is provably contained (‹n›)
- `server/test/ccrc-doctor.test.ts`: `2 failed | 627 passed | 4 skipped (633)`
  - × only warns on unknown — an older agent is not a broken fleet
  - × warns rather than fails when the server is unreachable — that is a different problem
- `server/test/ccrc-account.test.ts`: `1 failed | 330 passed (331)`
  - × C3: a stop that fails refuses the removal before the roster changes, and reaps nothing
- `server/test/session-hook.test.ts`: `335 passed (335)`
- `server/test/boot.test.ts`: `3 passed (3)`
- `server/test/update-store-dispatch.test.ts`: `21 passed (21)`
- `server/test/update-catalogue.test.ts`: `114 passed (114)`
- `server/test/ccrc-update.test.ts`: `471 passed | 11 skipped (482)`
- `server/test/tmp-sweep.test.ts`: `1 failed | 13 passed (14)`
  - × FAILS CLOSED: claude is running and no sessions dir is readable, so nothing is removed

Three of them red a DIFFERENT case on every run (the shard and the lone run disagree), so each was run once more alone on the base (`origin/main`) and on the last stage, interleaved — on the base:

- `server/test/ccd-ws-audit.test.ts`: `2 failed | 139 passed | 4 skipped (145)`
  - × refuses a fork PR outright
  - × shows a dirty path as a FILENAME, not as C-quoted octal
- `server/test/ccrc-doctor.test.ts`: `5 failed | 624 passed | 4 skipped (633)`
  - × fails an external account with no executable at all — presence IS checked
  - × never prints the token — not in any verdict, any remedy, or anywhere else in a full run
  - × PASSes mode ip with no rp id at all — passphrase-only is the design, not a gap
  - × accepts 127.0.0.1 — loopback and the wildcards all answer caddy
  - × accepts localhost — loopback and the wildcards all answer caddy
- `server/test/ccrc-account.test.ts`: `2 failed | 329 passed (331)`
  - × first setup rejection leaves its current-run fake to file-level cleanup
  - × next sequential case proves the prior setup failure was drained

and on the last stage:

- `server/test/ccd-ws-audit.test.ts`: `141 passed | 4 skipped (145)`
- `server/test/ccrc-doctor.test.ts`: `629 passed | 4 skipped (633)`
- `server/test/ccrc-account.test.ts`: `331 passed (331)`

None of those three files reads anything this plan changes (`ccd-ws-audit.test.ts` drives the PLAIN audit, whose argv never reaches Task 6's hand-off; `ccrc-doctor` and `ccrc-account` drive `ccd/ccrc`); tmp-sweep's "FAILS CLOSED…" is red on `main` on this box.

- [ ] **Step 4: Push and open the PR.** Check the author first (`git log --format='%an <%ae>' origin/main..HEAD | sort -u`). The PR body names: the wave and its rulings (A)–(J); the deploy class (AGENT-FIRST, inert); every departure with its issued number; the mutation tables' totals; the wave-3b interface (below, verbatim); and the carried follow-ups. Then report the wave-done fingerprint as `ccrc-worker` clause says — the coordinator merges; the fleet moves by ccrc's own updater.

---

## Deploy note

**AGENT-FIRST, through ccrc's own updater; nobody moves a box by hand** (the operator's 2026-09-30 ruling). `ccd/ccd`, `ccd/ccd-entry.py` (rendered on the box to `~/.local/bin/ccd` by `ccrc update`'s install spine) and `agent/src/whitelist.ts` must be on the fleet box before any server that composes `ws-expire` — and none does in this wave, so the order costs nothing today: the fleet box takes the release first by `ccrc rollout`'s default order, the server box second. On the box after the update: `ccd caps` prints `ws-expire` and `expire-v1` (read-only); `ccrc doctor` shows no FAIL for the launcher digest (the launcher is re-rendered against the new body). Nothing is expired by the deploy: no code path composes the verb, and the lane is wave 3b's. `$REG/reclaim-paused` gains a reader on the box: ccd's expiry honours it at rung 3 and on resume from this wave (`cmd_reclaim_pause`'s comment says so), though nothing runs an expiry until 3b; the server's switch, its label and its banner are 3b's. What DOES change on deploy, for every operator: a `ccd start`/`enable`/`ensure`/`swap` of an ARCHIVED workspace while another ccd process holds its reap lock (a human `ws-reap` or `ws-restore` of it) now refuses instead of racing it (the departure `spawn-gate-takes-the-reap-lock`), and so does a spawn of an archived row whose `.reaping` stands but cannot be read (`spawn-gate-refuses-an-unreadable-breadcrumb`); `ws-audit`'s usage line names `--expire`. Measure after convergence: `/health` reports the merge's tag; doctor shows 0 FAIL lines.

## Deviations found

Named by slug; the coordinator issues their numbers (the run's block), and the worker writes each bare in its entry as it defines it. Each is carried into the spec by Task 9's §5.3 amendment, by its effect, so a reader of `main` finds it in the text it changes.

- **D-3886** `wave2-residue-string-status-at-the-reader` (Task 1, run 245) — review 244 F1 was ruled as "`stopVerdict` reads `status` only when it is a string". `stopVerdict` receives the reader's `String()`-ed value and cannot see the type, so the check is in `readLiveStateMeasured` (`livestate.ts`): a `status` that is not a string is `''`, which every reader already reads as work or as unmeasured. Only a status whose `String()` spelled a word changes reading anywhere (`["idle"]` was idle on the board too).
- **D-3887** `instrument-classifies-every-act` (Task 2, run 245) — beyond binding `RETURN_ACTS` and `ENDS_THE_ARCHIVE` to `_LC_ACTS`, every act is classified exactly once (a third list, `NEUTRAL_ACTS`), and `reclaim` ends an archive as `expire` does; the test runs ccd's array.
- **D-3888** `reclaim-machinery-reads-a-flavour` (Task 3, Task 4, run 245) — §5.3 says the verb "shares wave 3's machinery"; the sharing is a flavour (`_WS_RCL_ACT`) read by the RECLAIM region's pin phase, tombstone fields, failure and tail, and the extraction of rungs 3–10 into `_ws_reclaim_ladder` with a caller-set binding. A reclaim's every output is byte-identical; no word of the fourteen moves.
- **D-3889** `expire-refuses-a-live-pane-or-unit` (Task 3, Task 4, run 245) — ruling (D): rung 5, for an expiry only, refuses a detached live pane or a running unit with `live` (retryable); a unit the manager will not describe is unmeasured. Keyed on the token's binding (`mode=expire`), not the flavour; on Darwin a `failed` answer from ccd's own stamp is re-asked of launchd (running or loaded is `live`, exit 113 is stopped, anything else unmeasured); and the resume asks it again at `children`, before the tail has stopped anything (from `worktree` on, the tail's unsupervise-and-kill runs as a reclaim's). Its stated limit: it asks the pane and the unit, not processes — a shell opened in the worktree outside both is not seen (Open question 3). §5.3's ladder lists `attached` alone.
- **D-3890** `expire-rung-two-words` (Task 3, run 245) — §5.3 names `child` only; rung 2′ answers `not-archived` (no stamp — ws-reap's word, reused), `not-expired` (younger than a week, a future stamp included) and `child`, and a stamp that is not an epoch ccd writes is unmeasured.
- **D-3891** `ws-reap-refuses-the-expire-breadcrumb` (Task 4, run 245) — ws-reap's `expire:` arm is a REFUSAL (`expire-in-progress`), the twin of its `reclaim:` mirror; the resume that re-asserts the archive epoch is ws-expire's own arm (Pre-flight finding 12; Open question 1).
- **D-3892** `reclaim-reads-an-expire-breadcrumb-as-reap-in-progress` (Task 4, run 245) — ws-reclaim's fork is unchanged: it answers an `expire:` breadcrumb `reap-in-progress`, as it answers every breadcrumb not its own. It can meet one only on a row carrying a child marker, which ws-expire refuses to touch; a word of its own would widen `CHILD_RECLAIM_TOKEN_KIND`, a server vocabulary this wave does not move.
- **D-3893** `return-verbs-refuse-before-they-journal` (Task 5, run 245) — ruling (E) asks each spawn path to refuse; `start`, `ensure`, `swap` and `enable` refuse in the verb, BEFORE their `_lc_done`, because a refusal at `_spawn_start` alone leaves a `start`/`ensure`/`swap` row the §9 instrument reads as a return seven days late (Pre-flight finding 1), and an `enable` row for a return that never happened. `ws-restore` refuses with the existing token `in-progress`, not a new journal token.
- **D-3894** `spawn-gate-refuses-an-unreadable-breadcrumb` (Task 5, run 245) — on an ARCHIVED row, a `.reaping` that stands but reads as nothing refuses every spawn path and ws-restore, as `_ws_expire_fork` reads one (unmeasured): an interrupted expiry leaves `.archived` standing, so such a file may be its breadcrumb. A row that is not archived is not asked, so no live session's respawn can be wedged by a stray file.
- **D-3895** `spawn-gate-takes-the-reap-lock` (Task 5, run 245) — the gate covers the window DURING an expiry (no breadcrumb yet; the lock held) by taking `$REG/.reap-<id>.lock` with `flock -n` before a spawn clears an archive. It refuses whatever holds the lock, so a spawn of an archived row during a human `ws-reap` or `ws-restore` of it refuses too.
- **D-3958** `expire-audit-is-its-own-document` (Task 6, run 245) — `ws-audit --expire` prints its own document, not the plain audit's keys plus a mode, because `cmd_ws_audit` sits above the frozen citation anchors (Pre-flight finding 9); it journals terminal refusals as the reclaim audit does (CCR-15 §5.9's rule, carried).
- **D-3959** `ws-expire-crosses-the-direct-entry-boundary` (Task 7, run 245) — the spec predates reclaim-entry-safety; `ws-expire` and `ws-audit --session <v> --expire` join both classifiers (Pre-flight finding 6).
- **D-3960** `expire-collects-a-leftover-temp-root` (Task 4, run 245) — §5.3's delete list does not name `~/.cc-tmp/<id>`; the shared tail removes it unrecorded, as for a reclaim. Only a child is given one (`_child_tmpdir`), the marker is written once and removed only with the row, and rung 2′ refuses any row carrying one, so what stands there is a previous row's leaked scratch under a recycled slug (Pre-flight finding 14) — the class child reclamation wave 5's temp-root collector owns.
- **D-3961** `caps-names-the-verb-on-its-token-line` (Task 7, run 245) — `ccd caps` prints `ws-expire` from the `expire-v1` line, not from the verb list, which sits above the frozen anchors (Pre-flight finding 8).

## Wave 3b inherits — the interface this wave hands over

Wave 3b is planned after this wave merges. It builds the lane (`archivedExpiryVerdict` in its own L1 file; the second population in `sweepChildReclaim` with its own entry map, clocks, executor call, feed rows and attention entries — never visible to wave 5's chip), the widened cleanup switch and its Runs-banner label, coordinator clause 3's move with its verbatim pin, README's and `wave-lifecycle.md` §6's "after 7 days" text, the PWA's archive-confirm copy (§5.2: "…for 7 days; after that it is cleaned up"), and `verb-gate.test.ts`'s `CAP_GATED_VERBS` entry for its call site. What it consumes, exactly:

- **Capability.** `capSupported(state, EXPIRE_CAP)` (`'expire-v1'`, `server/src/ccdargv.ts`) — refuse on no evidence; never `verbSupported`.
- **The audit.** `CCD_ARGV.wsExpireAudit(id)` = `['ws-audit','--session',id,'--expire']`, granted by `['ws-audit','--session']`, budget 90 s (the audit's). stdout ONE line: `{"session":<id>,"mode":"expire","archivedAt":<int>|null,"alive":<bool>,"exists":<bool>,"reaping":<string>|null,"sensitive":[<path>…],"resume":<phase>?,"verdict":<word>,"detail":<string>,"token":<64-hex>?}`. Exit 0 with `verdict` `expirable` and a `token`, or with a refusal word and no `token`; exit 1 with `verdict` `unmeasured` (retry). A usage error exits 1 with nothing on stdout.
- **The verb.** `CCD_ARGV.wsExpire(token, id, dec)` = `['ws-expire','--expect',token,'--session',id, …decFlags(dec)]`, granted by `['ws-expire','--expect']`, budget 240 s. No `--defer-expired` — it is a usage error, like every other malformed argv: `die`, exit 1, `ccd: usage: ccd ws-expire --expect <token> --session <id> [--surface <word>] [--actor <text>] [--reason <text>]` on stderr and NOTHING on stdout (as are `bad token`, `bad session id`, a blank or over-long `--actor`/`--reason`, and `python3 unavailable …`) — so an exit 1 with an empty stdout is a call the lane composed wrong, never a `failed` document. stdout ONE line: `{"expired":<id>,"archivedAt":<int>,"wip":<sha>|null,"attic":<int>,"residueBytes":<int>,"secretsDropped":<int>|null}` at exit 0; `{"refused":<word>,"detail":<string>,"paths":[]}` at exit 0; `{"failed":<token>,"detail":<string>}` at exit 1 (the breadcrumb is kept and the next attempt resumes it; `probe-unmeasured` when nothing started).
- **The words**, by kind (wave 3b's map, held equal to ccd's EXPIRE region and the shared ladder the way `CHILD_RECLAIM_TOKEN_KIND` is held to the RECLAIM region): GONE `no-such-session`, `not-archived`; TERMINAL `not-a-workspace`, `branch-elsewhere`, `tree-unreadable`, `containment-unproven`, `no-worktree-record`; RETRY `not-expired`, `child`, `paused`, `held`, `attached`, `live`, `tree-busy`, `state-changed`, `in-progress`, `reap-in-progress`, `reclaim-in-progress`. `ws-reap` additionally answers `expire-in-progress`. Failure tokens (`"failed"`): `pin-failed`, `tombstone-unwritable`, `unit-still-active`, `worktree-remove-failed`, `branch-moved`, `branch-elsewhere`, `reaping-phase-unknown`, `purge-incomplete`, `purge-mechanism-absent`, `purge-refused`, `probe-unmeasured`.
- **The token.** 64 lowercase hex: the SHA-256 of the newline-joined inputs, leading `mode=expire`, `id=<id>`, `archivedAt=<epoch>` (a resume's: `mode=expire-resume`, the epoch, `phase`, `branch`, `tip`). A return and a re-archive change it.
- **The journal.** Act `expire` (verb `ws-expire`: `intent`, `done`, `refused`, `failed`; verb `ws-audit`: `refused`, terminal words only). `meas.archivedAt` on intent and done; `meas.resumed` the phase a resumed act started at. Stage 4's crash clause reads `expire` as a deliberate removal (§5.4).
- **The record.** `$REG/.reaped/<id>.json` with `"mode":"expire"`, `"archivedAt"`, `"ignored"` (path, bytes, sensitive), `"secretsDropped"`, `"clips"` (name, bytes), `"transcript"`, `"attic"`, `"worktree":"present"|"absent"`. The attic is `refs/ccrc/attic/<id>/`, read by `ccd ws-attic`.
- **The threshold.** `WS_EXPIRE_AFTER_S=604800`, defined once, in ccd's EXPIRE region; ccd decides with it at rung 2′ and on resume. The server must NOT type a second copy (the single-definition doctrine, and §9's kill rule raises the ccd value): 3b either reads the audit's `not-expired` verdict as the answer, or adds the expiry instant to the audit's document (`archivedAt + WS_EXPIRE_AFTER_S`, a key of its own) and derives from it — a decision of 3b's, which this wave does not pre-empt. A server that guessed the constant would compose verbs that refuse `not-expired` on every pass after a raise.
- **The switch.** ccd's rung 3 already reads `$REG/reclaim-paused` for an expiry (and its resume), and `cmd_reclaim_pause`'s comment says so: on the box it is the one cleanup switch from this wave; 3b relabels it and reads it server-side (CCR-15's text amendment, spec §6 item 1, is 3b's).
- **The breadcrumb.** `$REG/<id>.reaping` = `expire:children|worktree|branch|artifacts`; every return verb refuses while it stands, and on an archived row while a `.reaping` stands that cannot be read.
- **The return verbs' refusal.** `start`, `enable`, `ensure` and `swap` (and so the server's existing start/enable/ensure/swap and Revive routes) meet it as a `die`: exit 1, nothing on stdout, and on stderr `ccd: <id> is being expired — an interrupted ws-expire stopped at its '<phase>' step, …`, `ccd: another ccd process is expiring, reaping or restoring <id> and still holds the lock — …` (an archived row only), or `ccd: a breadcrumb stands at <path> but cannot be read — …` (an archived row only). `ws-restore` refuses through `_lc_refuse` with the existing journal token `in-progress` (exit 1). Nothing is journaled for the refused return.

## Carried out of this wave (recorded in the programme ledger)

| Follow-up | Owner | Why not here |
|---|---|---|
| The archive door's unreadable-store 409 detail (`coordinator-has-open-runs`/`run-open` drop `measured()`'s detail; base behaviour) | wave 3b (server) | ruling (G) |
| The base's 404 fold for an unlistable registry (`knownId` before the 503 ladder) | wave 3b (server) | ruling (G) |
| FM7: Released/Archived fold disjointness rests on `released.ts` alone (`inReleasedFold` could add `!inArchivedFold`) | wave 3b (pwa) | ruling (G) |
| The archive door reads ccd's `already archived` exit 0 as `archived:true` without checking a measured-live row was stopped (review 240's F1; reachable only on a pre-#143 pane never respawned) | wave 3b (server) | this wave makes the box half safe — an archived row with a live pane is never expired (Task 3); the door's reading is server code |
| ws-reclaim's word for an `expire:` breadcrumb (`reap-in-progress`) | wave 3b, if its lane wants the distinction | the departure `reclaim-reads-an-expire-breadcrumb-as-reap-in-progress` |
| Wave 2's operator question 1: whether the PR sheet's "Archive now" opens ArchiveSheet | stays open with the operator (the programme ledger's Next-wave brief) | a PWA question; this wave ships no PWA surface |
| Wave 2's operator question 2: whether the remote-mode worktree check stays deferred to `ccd` | stays open with the operator | unchanged by the verb; the lane (3b) is where a server-side check would land |
| Wave 2's operator question 3: whether L5's "Its workers will be cleaned up" stands "until wave 3" | the operator, answered with wave 3b | "wave 3" now means 3b: nothing cleans an archived workspace up until the lane composes this verb |
| A process with its cwd in the worktree outside the `cc-<id>` pane and the unit (an operator's own shell) is not seen by rung 5 | the operator (Open question 3) | ruling (D) names the pane and the supervisor; a process scan is a new probe with its own unmeasured arm |
| CCR-15's text amendment for the one cleanup switch (spec §6 item 1) | wave 3b (with the switch's label) | ccd's half — the expiry honouring `reclaim-paused` — is this wave's and its comment says so |

## Open questions for the operator

1. **ws-reap's `expire:` arm — DISPATCH WAITS ON THIS** (Pre-flight finding 12; the callout at the top). This plan reads ruling (E)/(I)'s "resumes through ws-reap's `expire:` arm" as the spec's two arms: ws-reap REFUSES an `expire:` breadcrumb, and ws-expire's own resume re-asserts the epoch. If the ruling means ws-reap should FINISH an interrupted expiry, say so before the run is dispatched: it would reverse child reclamation's carried constraint 5 for this flavour, and Task 4's MIRROR edit, its flavour-fork tests, the wave-3b word list and Task 9's amendment change with it.
2. **The spawn gate's lock reaches past expiry** (the departure `spawn-gate-takes-the-reap-lock`): a `ccd start`/`enable`/`ensure`/`swap` of an archived row during a human `ws-reap` or `ws-restore` of it now refuses. Keep it, or narrow the lock to rows an expiry holds (a second lock file)?
3. **A shell in the worktree that is neither the pane nor the unit.** Rung 5 asks what ruling (D) names — the `cc-<id>` pane and `claude-session@<id>` — and a resumed expiry asks it again at `children`. A process an operator started by hand with its cwd in the worktree is not seen, and the tail would remove the tree under it (the pin keeps what git knows at the settle). Keep that limit, or add a process probe (a `/proc/*/cwd` scan on Linux, `lsof` on Darwin, each with an unmeasured arm) in 3b?
4. **Departure numbers.** Fourteen departures; the block issued at run-open holds ten. Please mint four more.
