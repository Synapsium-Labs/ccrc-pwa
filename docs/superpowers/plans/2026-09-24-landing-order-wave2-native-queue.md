# Landing order, wave 2 — GitHub's native merge queue, repository code (SERVER-FIRST) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make this repository ready for GitHub's native merge queue and make the queue's one silent failure loud — without changing a single repository setting. `ci.yml` answers `merge_group` (so a queue entry gets its required checks), skips the two non-required macOS legs on a queue run, and cancels a superseded `pull_request` run; `ccd pr-state --project` makes ONE GraphQL query per repository per sweep, under its own timeout, and stamps every full line with an additive `queue` word (`queued | dequeued | landed | none | unmeasured`); the server turns a `dequeued` reading into a `queue` feed record and a `status` mail to the run's coordinator, once per removal; the session hook DENIES `gh pr merge` to any session whose hold names a programme wave, and lets the coordinator's plain `gh pr merge <n>` (which enqueues) through; coordinator clause 15 says so. The last task is the operator's post-merge runbook: the queue ruleset, approvals to 0, R9's break-glass, and the proof run that gates wave 2b.

**Architecture:** Five mechanisms, each with a test that reds when it is deleted or mutated. (1) `ci.yml`: a `merge_group` trigger, `if: github.event_name != 'merge_group'` on every job that `runs-on: macos-*` and on no other job, and a workflow `concurrency` whose `pull_request` arm is keyed by PR number and cancels, while every other event gets a run-unique group. (2) `ccd/ccd`: `_gh_pr_queue` (one constant GraphQL document, `-f` variables, `PR_GH_QUEUE_TIMEOUT`), `_pr_queue_stamp` and `_pr_queue_py` — all three placed below `cmd_clip`, beneath every frozen citation anchor — wired into `cmd_pr_state` by ONE in-place line that pipes the per-session loop through the stamp; the stamp buffers the sweep and falls back to the unstamped lines on any failure of its own. The server's outer bound on `pr-state` rises 20 s → 25 s so the three calls' timeouts still leave `pr-timeout-budget.test.ts`'s 30 % for the local loop. (3) `server/src/prstate.ts`: `queueFor(line)`, the ONE reader of `queue`/`queueAt`, answering the five words plus `absent` (a line from an older ccd or from `--session`, never folded into `unmeasured`). (4) `server/src/watch.ts`: `sweepDequeued`, after `sweepMerged`, latched per (workspace, PR, removal time), raising a new `NotifyEvent` kind `queue` (additive; `shared/api.ts` line-neutral, `MailScreen`'s two total maps) and, only when an open run names the workspace and its coordinator resolves, `queueSystemMail(..., kind:'status', subject:'dequeued:#<n>')`. (5) `ccd/session-hook.sh`: the hold grammar hoisted to ONE spelling, `CCRC_HOLD_WAVE_RE` (line-neutral), and a PreToolUse block below the graph gate that denies a command-head `gh pr merge` when `_ct_read`'s hold is within `CCRC_HOLD_MAX` and matches that grammar; a deny replaces an `additionalContext` advisory on the same call and never replaces the graph gate's deny.

**Tech Stack:** bash 5.2 (`ccd/ccd`, `ccd/session-hook.sh`), python 3.12 (the stamping pass, embedded in `ccd/ccd`), TypeScript (server, shared, pwa), GitHub Actions YAML, GitHub's GraphQL API through `gh api graphql` (gh 2.45 on the fleet box), vitest 4.1.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` — §5.2 (stage 2: "Repository code", "Operator configuration", "Rollout order inside stage 2"), §3 R3, R5, R9, §4 (roles table: the worker and coordinator rows), §7 (wire additive, `FLEET_PROTO` stays 1, one reader per field), §9 (stage 2 lands with or after stage 1), §10 (stage 2 metrics), §12. Programme ledger: `docs/superpowers/programs/landing-order.md` (wave 2 row; carried constraints — another programme edits `ci.yml`; skill pins move with the clauses). **OUT of scope** (wave 2b, after the proof run): the every-session `--admin` deny and the `gh api` pulls-merge deny.

**Prerequisite:** landing-order **wave 1 has merged to `main`** — it adds coordinator clause 15 (Task 5 appends to it) and the PreToolUse sync advisory (Task 4's deny supersedes it on a shared call). This wave's workspace is a fresh child from current `main`; Task 1 Step 0 refuses to start without wave 1.

---

## Global Constraints

Copied from `CLAUDE.md`, the spec and the programme ledger. Every task's requirements implicitly include this section.

- **Deploy class for THIS wave: SERVER-FIRST, by `ccrc rollout --to <tag> --server-first`.** `CLAUDE.md`: "`--server-first` when a wave's server arm is a reader-widening". This one is: the server gains a reader for an additive field and a wider bound (`'pr-state': 25_000`) that the new ccd's third gh call needs. A new server beside the old ccd reads `absent` and stays silent; the old server beside the new ccd would kill a slow three-call sweep at the old 20 s for the minutes between the two moves. The hook ships to the fleet box with ccd and needs no server. Restated as Task 6's post-merge step.
- **The coordinator merges, workers never do, nothing merges unattended** (spec §3 R5). Nothing in this wave enqueues, merges, re-runs or re-enqueues anything: the dequeue lane only records and mails; the hook only denies.
- **No repository SETTING changes in any code task.** The ruleset, the approval count, bypass actors and the proof run are Task 7, the operator's, after merge. Coordinator clause 15 forbids a coordinator writing rulesets; a worker does not either.
- **SAFETY — sacred.** NEVER run destructive `ccd` verbs against the live host (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore`). NEVER touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*.service` directly — Task 6's deploy checks READ the installed hook and ccd with `grep -c`, nothing more. NEVER print secret file CONTENTS. `gh` stays off the exec whitelist: `ccd` calls it on the fleet box, the PWA never can.
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** Harness: `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`) and `makePrHarness(prefix)` (`server/test/ccdPrHelpers.ts`), whose `gh` is a shell function that wins over PATH and whose base harness plants a poisoned `gh` behind it. **Every `bash` spawn in a `ccd-*.test.ts` file goes through the harness** (`h.sh`), which routes it through `ghContainedEnv(home, env, { systemd: true, tmux: true })` — `ccd-workspaces.test.ts`'s "routes EVERY bash call site in every ccd test file through ALL THREE poisons" reads the source. `session-hook-merge-deny.test.ts` runs the HOOK (not ccd) under a fixture HOME with a stub `tmux`, the way `session-hook.test.ts` does.
- **No root `package.json`, no root runner.** Four packages, each `"type":"module"`, run cd'd in:

      cd server && npm ci && npm run test    # vitest run — hermetic
      cd agent  && npm ci && npm run test
      cd pwa    && npm ci && npm run test

- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`.**
- **Run suites in the FOREGROUND, timeout ≥600000ms, ONE vitest process at a time.** The server suite does not fit one 600 s call on the loaded fleet box — Task 6 runs it as twelve sequential shards whose union is every file once. Never background a suite.
- **Known load flakes** (re-run IN ISOLATION before calling a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`; also `boot.test.ts`'s two p95 timing cases.
- **Rings:** L0 `shared/*.ts` imports nothing — this wave changes two lines of `shared/api.ts` IN PLACE (the `NotifyEvent.kind` union and `NOTIFY_KINDS`) and imports nothing. `queueFor` is L1-pure (no fs, no clock). **No overloaded null at a seam:** `queueFor` answers `absent` for "nothing was asked" and `unmeasured` for "asked, not answered"; `_pr_queue_py` keeps "the call did not answer" (`None` → `unmeasured` on every line) apart from "the bound PR is not in the window" (`unmeasured` for that line only) and from "no bound PR" (`none`).
- **Wire discipline — additive-only.** `queue` and `queueAt` are new keys on the ccd→server `pr-state` line, emitted only by `--project`, read by exactly one function (`queueFor`); absence permits. `NotifyEvent.kind` gains `queue`; an older client degrades it to `unknown` through `reviveNotifyEvent`, and an older server reads a stored `queue` row through `isNotifyKind` as `unknown`. `PrState` and `FleetSession` do NOT change. **`FLEET_PROTO` is NOT bumped.**
- **Workflow-file safety.** Every expression this wave adds to `ci.yml` reads `github.event_name`, `github.workflow`, `github.event.pull_request.number` or `github.run_id` — none of them attacker-controlled text — and none of them appears in a `run:` line. `pull_request` stays, `pull_request_target` stays absent, `permissions: contents: read` stays (`oss-metadata.test.ts`).
- **Mutation-table discipline:** a new guard ships WITH a test that goes RED when the guard is deleted/mutated, measured before/after. Every mutation row in this plan was run on a prototype of exactly these edits at `905360dc`, each restored from a saved COPY of the file (never `git checkout --`), and its red is quoted. The rows that depend on wave 1 (Task 4's advisory row, Task 5's clause rows) say how they were measured and what the worker re-measures.
- **`ccd/ccd` is a provenance-STAMPED file** (line 2 is `# ccrc:generated 1 sha256=…`). **Every task that edits `ccd/ccd` re-stamps before running any suite**, or `server/test/ownership.test.ts` reds:

      node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
        const { markGenerated } = await import('./shared/mark.mjs'); \
        writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"

- **The citation tax is owed by every CITED file.** `server/test/session-hook.test.ts` audits every `file:line` in two FROZEN corpus documents and `README.md`. This wave edits THREE cited files: `ccd/ccd` (Task 2), `ccd/session-hook.sh` (Task 4) and `shared/api.ts` (Task 3). The plan pays by LAYOUT: every added line in `ccd/ccd` sits below `cmd_clip` (below every frozen anchor and below both README anchors); every added line in `session-hook.sh` sits below the graph gate (below every frozen anchor and README's `ccd/session-hook.sh:2900`), and its three edits above that are line-neutral in place; `shared/api.ts`'s two edits are in place. Measured on the prototype with the instrument (see "The citation tax, mechanised"): `147 / 195 / 53 / 35`, stated == base == tree, empty composition, both corpus documents untouched. **Nothing in `session-hook.test.ts` changes in this wave.** If the instrument shows movement, an insertion landed above an anchor — find out why before going on.
- **The `_reg_get` census:** this wave adds NO `_reg_get` call to `ccd/ccd` (the stamp reads the line's `number`, never the registry). Task 2 runs `ccd-reg-get-census.test.ts` to prove it.
- **Locate code by CONTENT.** Line numbers are "at `905360dc`" and are hints, never addresses. Wave 1 edits `session-hook.sh`, both skills and their pins; CI test selection (spec on `ws/ccrc-ci-runs-optimization`) reshapes `ci.yml`; centralised-update-management and child-reclamation are live against `ccd/ccd`.
- **Every forecast number is "at `905360dc`"** (`origin/main` `a3a93b41` plus the two approved specs and the programme ledgers). Where the base has moved, a different line number or test total with every case PASSING is not a red — the instrument's output is the authority and the difference goes in the commit message. Stop only on a FAILING case or a moved census composition you cannot explain.
- **Shell state does not survive between Bash calls.** Every block that names `$SCRATCH` sets it itself; `SCRATCH=<…>` means "paste your own session's scratchpad, as an ABSOLUTE path". Never run half a block.
- **Branch discipline:** commit on this workspace's own branch only; never a separate feature branch (a feature branch wedges every close with `stale-tip`). One commit per task.
- **Commit trailers:** end every commit message with the attribution line your own session is given. The heredocs below end at the body for that reason.
- **No hostnames, IPs, tailnet names, docserver URLs, account names or the GitHub owner's name** anywhere in a committed file (`topology-clean.test.ts`). Task 7's commands say `{owner}/{repo}`, which `gh api` fills in from the checkout it runs in.
- **`## Deviations found` numbers are ISSUED, never chosen** — see that section at the foot of this plan.
- **Cross-programme: CI test selection reshapes `ci.yml`.** Whichever PR lands second MERGES the other's shape rather than overwriting it (programme ledger, carried constraint 1). This wave's three `ci.yml` edits are written to survive that design as specified: its PR concurrency group has the same name (`ci-<workflow>-pr-<number>`, its §4.3); its "no job-level `if:` on a matrix that carries a required name" (§4.2) is kept, because the only `if:` added here is on non-required macOS jobs; its macOS shard jobs will be `runs-on: macos-*` and so fall under `ci-merge-queue.test.ts`'s derived rule without that test learning their names. What that programme must ADD if it lands second: a `merge_group` row in its mode table (§3) that runs every required leg, and a `merge_group` arm in its summary job's success rule (§4.2). If it lands FIRST, this wave keeps its per-mode groups and adds only a run-unique group for `merge_group`, then re-words `ci-merge-queue.test.ts`'s third case to assert that arm.

---

## Review Focus

Five inputs or failure modes the spec implies and nothing on `main` tests. Each is given a test in its owning task, and each test has a mutation row that reds it.

1. **A required leg skipped on a queue run reads as PASSING.** GitHub reports a job skipped by `if:` as success, so an `if: github.event_name != 'merge_group'` on `test` or `build-pwa` would let the queue merge a tree nobody tested. → Task 1, case "skips merge_group on every macOS job, and on no other job"; row M3.
2. **A shared concurrency group drops runs the queue needs.** GitHub keeps ONE pending run per group and cancels the older pending one even with `cancel-in-progress: false`; a group shared by `merge_group` runs (or by `push` runs on `main`) would cancel another entry's checks or a merge's post-merge run. → Task 1, case "cancels a superseded pull_request run and nothing else"; rows M4, M5.
3. **The queue read must never cost the rows, and must never say `none` for a read that did not happen.** A failed call, an answer of the wrong shape, and a stamping pass that itself fails each leave `phase`, `number`, `rows` and `checks` exactly as `_pr_state_one` printed them. → Task 2, describe "the queue read may not cost the rows"; rows Q5, Q6.
4. **No evidence, no notice — and no guessed recipient.** A line from an older ccd, a `--session` line, and an `unmeasured` read never produce a dequeue notice; a dequeued PR whose workspace no open run names is recorded in the feed and mailed to NOBODY, even when `resolveCoordinator(null)` would answer the one active programme's coordinator. → Task 3, cases "says nothing for…" and "with no open run…"; rows L5, L6, L7.
5. **The deny holds at every parseable command head, never fires on a mention, and never treats a hold that is not a whole, readable wave hold as one.** → Task 4, cases "refuses every spelling…", "leaves every other gh…", "lets a hold that names no programme wave through…"; rows H3–H7 and H2.

---

## File Structure

| File | Created / Modified | Its one responsibility |
|---|---|---|
| `.github/workflows/ci.yml` | Modify — `merge_group:` in `on:`; a top-level `concurrency:` block; `if:` on `test-macos` and `probe-macos` (Task 1) | The queue gets its required checks; macOS stays off queue runs; a superseded PR run stops |
| `server/test/ci-merge-queue.test.ts` | Create (Task 1) | The three `ci.yml` properties, read from the file, the macOS set derived from `runs-on` |
| `ccd/ccd` | Modify — `PR_GH_QUEUE_TIMEOUT`, `PR_QUEUE_QUERY`, `_gh_pr_queue`, `_pr_queue_stamp`, `_pr_queue_py` inserted between `cmd_clip` and the source guard; ONE line of `cmd_pr_state` in place; two length-neutral prose rewrites (the outer-bound paragraph, `cmd_pr_state`'s budget header) (Task 2) | The third `--project` call and the `queue`/`queueAt` stamp |
| `server/src/remote/runner.ts` | Modify — `'pr-state': 20_000` → `25_000`, its comment and `ws-rename`'s (Task 2) | The outer bound the three calls fit inside |
| `server/test/remote-runner.test.ts` | Modify — the `pr-state` row and its comment (Task 2) | The new bound, pinned |
| `server/test/pr-timeout-budget.test.ts` | Modify — header, the budget sums THREE timeouts (Task 2) | The cross-language budget |
| `server/test/ccd-pr-queue.test.ts` | Create (Task 2) | One call per sweep, `-f` variables, its own timeout, the five words, and "may not cost the rows" |
| `server/src/prstate.ts` | Modify — `CcdPrLine.queue`/`queueAt` (raw), `PR_QUEUE_MAP`, `PrQueue`, `PrQueueRead`, `queueFor` (Task 3) | The ONE reader of the new fields |
| `server/src/watch.ts` | Modify — import, `prQueues`, `dequeuedNotified`, one line in `sweepPr`'s full-line arm, one call after `sweepMerged`, `sweepDequeued`, `dequeuedSubject`, `renderDequeueBrief` (Task 3) | The dequeue lane |
| `server/src/coord/rundefs.ts` | Modify — the `operator` sender gloss; `queueSystemMail`'s caller list (Task 3) | Says who raises the dequeue notice |
| `shared/api.ts` | Modify — two lines IN PLACE: `NotifyEvent.kind` and `NOTIFY_KINDS` gain `'queue'` (Task 3) | The eighth feed kind |
| `pwa/src/screens/MailScreen.tsx` | Modify — `KIND_WORD`/`KIND_GLYPH` gain `queue` (Task 3) | The two total maps name it |
| `pwa/test/mail-screen.test.tsx` | Modify — one `it` after the coord-kind one (Task 3) | The word and glyph actually render |
| `server/test/pr-queue-lane.test.ts` | Create (Task 3) | `queueFor`'s answers; the lane's once-per-removal feed record and mail, its silences |
| `ccd/session-hook.sh` | Modify — `CCRC_HOLD_WAVE_RE` (line-neutral), `_hook_hold_card`'s gate reads it (in place), the class note (in place), the deny block above the subagent block (Task 4) | The worker merge deny |
| `server/test/run-routes.test.ts` | Modify — the hold-grammar pin reads the hoisted spelling (Task 4) | One grammar, pinned where it is assigned |
| `server/test/session-hook-merge-deny.test.ts` | Create (Task 4) | The deny's refusals and its passes |
| `ccd/coordinator-skill/SKILL.md` | Modify — clause 15 gains one sentence (Task 5) | Landing on a native-queue project is `gh pr merge <n>`, no `--admin` |
| `server/test/coordinator-skill.test.ts` | Modify — `CONTRACT`'s clause-15 element gains the same sentence (Task 5) | The clause stays pinned verbatim |

**Not modified, deliberately:** `agent/src/whitelist.ts` (the `['pr-state','--project']` grant already carries this verb; no new argv), `server/src/ccdargv.ts` (no new argv form), `release-main.yml` (tags per push; the proof run measures whether that is per merge), `README.md` (it documents neither the pr-state calls nor the feed kinds — measured, `grep -n "gh call\|rollup\|feed kind" README.md` finds nothing this wave makes stale), every ruleset and repository setting (Task 7, the operator's), the worker skill (wave 1 owns clause 16), `CLAUDE.md`.

---

## Pre-flight findings (measured while planning; not deviations)

Each was measured on a prototype of this plan's exact edits in an isolated worktree at `905360dc`. They are why the tasks look the way they do.

1. **The existing budget has no room for a third call.** `pr-timeout-budget.test.ts` requires the gh timeouts to sum to at most 70 % of `CCD_VERB_TIMEOUT_MS['pr-state']`: `8 + 5 = 13 ≤ 14` at 20 s, so a third call could have at most 1 s. The queue query measured 0.72–1.39 s, so 1 s is not a bound. The plan raises the outer bound to 25 s and gives the call 4 s: `8 + 5 + 4 = 17 ≤ 17.5`. Row B1 (bound back at 20) reds with `the three gh calls (8s + 5s + 4s) leave only 3s of the 20s pr-state bound … expected 17 to be less than or equal to 14`.
2. **The query, measured read-only against this project's own public repository** (`gh api graphql`, no mutation; the owner is not written here): the single-window form (`first: 100, states: [OPEN, MERGED], orderBy UPDATED_AT`) answered in 2.13–2.69 s over four runs; the two-window form this plan ships (100 OPEN, the 20 most recently updated MERGED) answered in 0.72–1.39 s over five runs, rc 0, `{open: 11 nodes, merged: 20 nodes}`, every node carrying `number`, `state`, `mergeQueueEntry` (null — no queue exists yet) and `timelineItems` (empty). So the schema accepts every field the query names.
3. **The spec's "last `REMOVED_FROM_MERGE_QUEUE_EVENT`" alone is ambiguous** for a MERGED PR: "dequeued, re-enqueued, landed" and "dequeued, then merged by hand" both have a removal and no entry. The query asks for the last queue act of EITHER kind (`timelineItems(last: 1, itemTypes: [ADDED_…, REMOVED_…])`). Pinned by the case "none — a MERGED PR whose last queue act is a removal was merged BY HAND"; row Q4 (`MERGED` alone reads as landed) reds it.
4. **`GH_STUB` answers every `gh` call with the rows**, so every existing `ccd-pr-state.test.ts` case now meets a list where the GraphQL object should be. `_pr_queue_py` reads that as "not the query's shape" → `unmeasured`, and the existing suite stays green: `ownership` + `ccd-pr-state` 113/113 on the prototype. No existing test asserted an exact line object or a call count that the third call moves.
5. **`NotifyEvent.kind` is closed and `MailScreen`'s `KIND_WORD`/`KIND_GLYPH` are TOTAL `Record`s**, so a new kind is a compile error until both name it, and at runtime a missing entry renders NOTHING (the coord-kind precedent's measured note). `watch.ts`'s `tellSender` comment argues for reusing a kind to avoid that edit; a dequeue fits none (`merged` would render "merged" beside a PR that did not merge; `mail` is what the coordinator's notice already records). So `queue` is the eighth kind, and `shared/api.ts`'s two edits are made IN PLACE so its cited lines do not move.
6. **`run-routes.test.ts` pins the hook's hold grammar INLINE** (`'[[ "$h" =~ ^program:[A-Za-z0-9._-]+\' \'wave:…'`). A second inline spelling in the deny would be the drift the single-definition doctrine forbids and that pin could not see, so the grammar is hoisted to `CCRC_HOLD_WAVE_RE`, the card reads it, the deny reads it, and the pin moves to the assignment (rows C1, C2). The assignment sits in the constants block that runs before the event `case`, so the card never reads it unset; the paragraph above it is rewrapped so the block stays exactly fifteen lines.
7. **The hook runs under `set -u`.** A first mutation that deleted the hold predicate outright crashed the hook (`$CT_V` unbound → exit 1) — a red for the wrong reason. Row H2 is therefore spelled "the hold is read, never judged", which reds on the assertion it names.
8. **The citation census does not move**: `147 / 195 / 53 / 35`, stated == base == tree, empty composition, measured by `cite-remeasure.py` (for `ccd/ccd`) and by its one-line variant that also swaps `ccd/session-hook.sh` (for Task 4), with `repoint-readme.py` leaving README byte-identical (`cmd_ensure mint -> ccd/ccd:21202`, `genrc == 1 arm -> ccd/ccd:19989-19991` at `905360dc`).
9. **The repository's current settings, measured read-only** (`gh api …/rulesets`, `…/rulesets/<id>`, `…/branches/main/protection`, `…/<repo>`): the `main` ruleset has ONE rule, `pull_request`, with `required_approving_review_count: 1` and `allowed_merge_methods: [merge, squash, rebase]`, and TWO bypass actors — `RepositoryRole` 5 (admin) and `RepositoryRole` 2 (maintain), both `bypass_mode: pull_request`; classic protection requires the four contexts `test (server)`, `test (agent)`, `test (pwa)`, `build-pwa`, `strict: false`, `enforce_admins: true`, approvals 0; `allow_auto_merge: false`, `allow_update_branch: false`, `delete_branch_on_merge: true`. Task 7 is written against these values. R9 reads "the repository-admin role STAYS the ruleset's only bypass actor", and the maintain role is a second one today — an operator decision, recorded in Task 7 Step 3.
10. **Red-first, measured at `905360dc` with each new test written first:** `ci-merge-queue` 3 failed of 3; `ccd-pr-queue` 10 failed | 3 passed (the three that pass are the "absence" and "passes through" guards, true before and after); `pr-queue-lane` 6 failed | 1 passed (vitest leaves a missing named export `undefined`, so the reds are `TypeError: queueFor is not a function` and empty feeds, not an import crash); `session-hook-merge-deny` 4 failed | 3 passed (the three that pass are the pass-through cases).

---

## The citation tax, mechanised (S6-R11)

`server/test/session-hook.test.ts` audits every `file:line` citation in two FROZEN corpus documents (`docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md`, `docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md`) and in `README.md`. Any line inserted into a cited file moves every anchor below it. The standing rule S6-R11: **README is REPAIRED, by content, never counted; everything else is RE-MEASURED from the instrument, with the composition stated; no rule is widened and no D-number is spent.** This wave's layout is chosen so the instrument measures NO movement; the tools below are how that is proved, and what to use if the base has moved.

Write the tools into your scratchpad once (they are measurement instruments — never committed). `$SCRATCH` below is your session's scratchpad directory, as an ABSOLUTE path.

- [ ] **Write the README re-pointer** to `$SCRATCH/repoint-readme.py` (verbatim from the child-reclamation wave 1 plan):

```python
#!/usr/bin/env python3
"""Re-point README.md's two `ccd/ccd:` anchors BY THE BYTES THEIR SENTENCES QUOTE.

README carries exactly two anchors into ccd/ccd, and each sentence names what it
points at: `cmd_ensure`'s `_reg_generation_init "$id"`, and the contended arm
`genrc == 1` (cited as the three lines around its `elif`, the convention every
earlier re-anchor of it used). Both are located in the working ccd/ccd by that
content — never by adding a shift to a number — and a README that carries any
OTHER ccd/ccd anchor is refused, so a third one can never be skipped silently.
Run from the repo root after every ccd/ccd edit, before re-measuring the census.
"""
import re
ccd = open('ccd/ccd', encoding='utf8').read().split('\n')
readme = open('README.md', encoding='utf8').read()
anchors = re.findall(r'ccd/ccd:\d+(?:-\d+)?', readme)
assert len(anchors) == 2, f'README carries {len(anchors)} ccd/ccd anchors, not the two this tool knows: {anchors}'
start = [i for i, l in enumerate(ccd) if l.startswith('cmd_ensure() {')]
assert len(start) == 1, 'cmd_ensure() is not defined exactly once'
nxt = next(i for i in range(start[0] + 1, len(ccd)) if re.match(r'^[A-Za-z_][A-Za-z0-9_]*\(\) \{', ccd[i]))
E = [i + 1 for i in range(start[0], nxt) if '_reg_generation_init "$id"' in ccd[i] and not ccd[i].lstrip().startswith('#')]
assert len(E) == 1, f'cmd_ensure calls _reg_generation_init "$id" {len(E)} times'
L = [i + 1 for i, l in enumerate(ccd) if l.strip() == 'elif (( genrc == 1 )); then']
assert len(L) == 1, 'the genrc == 1 arm is not unique'
e, l = E[0], L[0]
new, n1 = re.subn(r'(`_reg_generation_init "\$id"`, `ccd/ccd:)(\d+)(`)', lambda m: f'{m.group(1)}{e}{m.group(3)}', readme)
new, n2 = re.subn(r'(the contended arm \(`ccd/ccd:)(\d+-\d+)(`, `genrc == 1`\))', lambda m: f'{m.group(1)}{l - 1}-{l + 1}{m.group(3)}', new)
assert n1 == 1 and n2 == 1, 'a README anchor sentence changed shape; re-point it by hand'
print(f'cmd_ensure mint   -> ccd/ccd:{e}      ({ccd[e - 1].strip()})')
print(f'genrc == 1 arm    -> ccd/ccd:{l - 1}-{l + 1}  (elif at {l})')
open('README.md', 'w', encoding='utf8').write(new)
```

- [ ] **Write the census re-measurer** to `$SCRATCH/cite-remeasure.py` (verbatim from the same plan):

```python
#!/usr/bin/env python3
"""Re-measure session-hook.test.ts's citation census FROM THE INSTRUMENT (S6-R11).

Run from the repo root AFTER ccd/ccd is re-stamped and README.md is re-pointed.
It runs ONLY the citation cases twice — once with ccd/ccd and README.md as they
stand at <base-ref>, once as they stand in the working tree — each time with
four dump probes inserted above the assertions they feed, and restores every
file it touched byte-for-byte (asserted). It prints what the test STATES, what
the instrument MEASURES, and the COMPOSITION (which references entered and
which left, base -> tree), which is what the S6-R11 comment must state.
With --write it rewrites exactly four literals in the test — `'ccd/ccd': N` in
the byFile map, `.toBe(N)` on `total`, and the two ref arrays of the `|`-row
case — in the instrument's own order. It never edits a comment.
usage: python3 cite-remeasure.py <scratch-dir> <base-ref> [--write]
"""
import collections, json, os, re, shutil, subprocess, sys
scratch, base = sys.argv[1], sys.argv[2]; write = '--write' in sys.argv
T = 'server/test/session-hook.test.ts'
out = os.path.join(scratch, 'cite'); os.makedirs(out, exist_ok=True)
src = open(T, encoding='utf8').read()
SITE_EXPR = ("      `${f.doc}:${f.line} ${refKey(f)}`;",
             "    const seen = new Set([...audit(realCorpus()).failures, ...filesAudit(realCorpus()).failures].map(site));")
for expr in SITE_EXPR:
    assert src.count(expr) == 1, f'the site-level expression changed in the test; update this probe: {expr}'
ROW_ANCHOR = "    expect(r.failures.map(refKey), 'a `|` row stopped naming what the ROW quotes — re-measure')"
BYFILE_ANCHOR = "    expect(byFile, 'the citation debt moved"

def probed(dump):
    """The test with the probes in. The site-level list is computed ABOVE the
    row array's expect, because that expect reds first and would stop the `it`
    before the site-level one ran; the two expression lines are asserted above
    to be the test's own, so this copy cannot drift from what it copies."""
    t = src
    for a in (ROW_ANCHOR, BYFILE_ANCHOR):
        assert t.count(a) == 1, f'probe anchor not unique: {a[:50]}'
    t = t.replace(BYFILE_ANCHOR,
        f"    fs.writeFileSync({json.dumps(dump + '/byfile.json')}, JSON.stringify({{ byFile, "
        "sites: r.failures.map((f) => `${f.doc}:${f.line} ${refKey(f)}`) }));\n" + BYFILE_ANCHOR)
    t = t.replace(ROW_ANCHOR,
        f"    fs.writeFileSync({json.dumps(dump + '/rows.json')}, JSON.stringify(r.failures.map(refKey)));\n"
        "    { const site = (f: { doc: string; line: number; file: string; from: number; to: number }): string =>\n"
        f"{SITE_EXPR[0]}\n{SITE_EXPR[1]}\n"
        f"    fs.writeFileSync({json.dumps(dump + '/sites.json')}, "
        "JSON.stringify(r.failures.map(site).filter((k) => seen.has(k)))); }\n" + ROW_ANCHOR)
    return t

def measure(label):
    dump = os.path.join(out, label); os.makedirs(dump, exist_ok=True)
    for f in ('byfile.json', 'rows.json', 'sites.json'):
        if os.path.exists(os.path.join(dump, f)): os.remove(os.path.join(dump, f))
    open(T, 'w', encoding='utf8').write(probed(dump))
    try:
        subprocess.run(['./node_modules/.bin/vitest', 'run', 'test/session-hook.test.ts', '-t',
                        'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND'],
                       cwd='server', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=580)
    finally:
        open(T, 'w', encoding='utf8').write(src)
    b = json.load(open(os.path.join(dump, 'byfile.json')))
    return (b['byFile'], b['sites'], json.load(open(os.path.join(dump, 'rows.json'))),
            json.load(open(os.path.join(dump, 'sites.json'))))

saved = {p: open(p, encoding='utf8').read() for p in ('ccd/ccd', 'README.md')}
try:
    for p in saved:
        open(p, 'w', encoding='utf8').write(
            subprocess.run(['git', 'show', f'{base}:{p}'], capture_output=True, text=True, check=True).stdout)
    B = measure('base')
finally:
    for p, body in saved.items(): open(p, 'w', encoding='utf8').write(body)
for p, body in saved.items():
    assert open(p, encoding='utf8').read() == body, f'{p} was not restored byte-for-byte'
N = measure('tree')
assert open(T, encoding='utf8').read() == src, 'the test file was not restored byte-for-byte'

ENTRY = re.compile(r"^        '[^']*',$")
def array_block(text, head):
    """[start, end) of the CONTIGUOUS run of `        '<ref>',` lines in this
    expect's array. Comments above the first entry lie outside it and are never
    touched; a non-entry line INSIDE the run is refused."""
    i = text.index(head); j = text.index('.toEqual([', i); k = text.index('\n      ]);', j)
    lines = text[j:k].split('\n')
    idx = [n for n, l in enumerate(lines) if ENTRY.match(l)]
    assert idx and idx == list(range(idx[0], idx[-1] + 1)), f'the array under {head[:40]} is not one contiguous run; edit by hand'
    s = j + sum(len(l) + 1 for l in lines[:idx[0]])
    return s, s + sum(len(l) + 1 for l in lines[idx[0]:idx[-1] + 1]) - 1
def stated(head):
    s, e = array_block(src, head)
    return re.findall(r"^\s+'([^']*)',$", src[s:e], re.M)
def moved(a, b):
    ca, cb = collections.Counter(a), collections.Counter(b)
    return sorted((cb - ca).elements()), sorted((ca - cb).elements())

ROW_HEAD = "expect(r.failures.map(refKey), 'a `|` row stopped naming"
SITE_HEAD = "expect(r.failures.map(site).filter((k) => seen.has(k)),"
by, total = N[0], sum(N[0].values())
stated_cc = re.search(r"^      'ccd/ccd': (\d+),$", src, re.M).group(1)
stated_total = re.search(r"this is it'\)\.toBe\((\d+)\);", src).group(1)
print(f"byFile['ccd/ccd']  stated {stated_cc}  base {B[0].get('ccd/ccd')}  tree {by.get('ccd/ccd')}")
print(f"total              stated {stated_total}  base {sum(B[0].values())}  tree {total}")
print(f"other byFile keys moved: {sorted(k for k in set(B[0]) | set(by) if k != 'ccd/ccd' and B[0].get(k) != by.get(k)) or 'none'}")
e, l = moved(B[1], N[1]); print(f"byFile composition  ENTERED {e}\n                    LEFT    {l}")
for name, head, bv, nv in (('row array', ROW_HEAD, B[2], N[2]), ('site array', SITE_HEAD, B[3], N[3])):
    e, l = moved(bv, nv)
    print(f"{name}: stated {len(stated(head))}  base {len(bv)}  tree {len(nv)}\n    ENTERED {e}\n    LEFT    {l}")
if write:
    t = src
    t = re.sub(r"^(      'ccd/ccd': )\d+,$", lambda m: f"{m.group(1)}{by['ccd/ccd']},", t, count=1, flags=re.M)
    t = re.sub(r"(this is it'\)\.toBe\()\d+(\);)", lambda m: f"{m.group(1)}{total}{m.group(2)}", t, count=1)
    for head, got in ((ROW_HEAD, N[2]), (SITE_HEAD, N[3])):
        s, e2 = array_block(t, head)
        t = t[:s] + '\n'.join(f"        '{v}'," for v in got) + t[e2:]
    open(T, 'w', encoding='utf8').write(t)
    print('rewrote the four literals from the instrument; now write the S6-R11 composition comment by hand')
```

- [ ] **Derive the hook-aware variant** (Task 4 edits `ccd/session-hook.sh`, which the verbatim tool does not swap to the base, so it could not see a hook anchor move). ONE line differs — the swap set gains the hook:

```bash
SCRATCH=<your scratchpad, absolute>
sed "s|for p in ('ccd/ccd', 'README.md')|for p in ('ccd/ccd', 'README.md', 'ccd/session-hook.sh')|" \
  "$SCRATCH/cite-remeasure.py" > "$SCRATCH/cite-remeasure-hook.py"
diff "$SCRATCH/cite-remeasure.py" "$SCRATCH/cite-remeasure-hook.py"
```

Expected: exactly one changed line (`62c62`). Its `--write` still rewrites only the `ccd/ccd` literal: if the variant ever reports `other byFile keys moved: ['ccd/session-hook.sh']`, an insertion landed above a hook anchor — undo it and re-place it, never re-measure a hook key by hand in this wave.

**The procedure, per task that edits a cited file** (each task restates it as numbered steps):

1. Re-stamp `ccd/ccd` if it was edited.
2. `SCRATCH=<abs path>; python3 "$SCRATCH/repoint-readme.py"` — expected: README byte-identical (`git diff --quiet -- README.md && echo readme-untouched`).
3. `SCRATCH=<abs path>; python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD` (Task 2) or `…/cite-remeasure-hook.py …` (Task 4) — read-only. **If any `base` differs from its `stated`, the tree was red before your edit: stop and report it.** Expected at `905360dc`: `147 / 195 / 53 / 35` on all four lines, `other byFile keys moved: none`, every `ENTERED`/`LEFT` empty.
4. The citation cases green: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'` → `7 passed | 326 skipped`.
5. **Both corpus documents byte-identical to `origin/main`**:

       git fetch origin main && git diff --quiet origin/main -- \
         docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
         docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen

   Expected: `corpus-frozen`.

---

### Task 1: `ci.yml` answers the merge queue

**Model routing:** `sonnet`, effort `medium`. One workflow file and one text-reading test.

**Files:**
- Modify: `.github/workflows/ci.yml` — `merge_group:` directly after `  pull_request:`; a top-level `concurrency:` block directly above `jobs:`; one `if:` under `runs-on: macos-latest` in `test-macos` and in `probe-macos`
- Test: `server/test/ci-merge-queue.test.ts` (new)

**Interfaces:**
- Consumes: nothing in the tree. GitHub's documented behaviour: a queue runs the required checks on `merge_group` events; a job skipped by `if:` reports success; one pending run per concurrency group.
- Produces: required checks (`test (server)`, `test (agent)`, `test (pwa)`, `build-pwa`) that report on a queue's group; the concurrency group name `ci-<workflow>-pr-<number>` that CI test selection §4.3 also uses. Task 7's proof run consumes all of it.

- [ ] **Step 0: Confirm the base — wave 1 merged, this branch fresh from `main`**

```bash
git fetch origin main && git merge-base --is-ancestor origin/main HEAD && echo "branch carries origin/main"
grep -c '^15\. ' ccd/coordinator-skill/SKILL.md
grep -c 'update-branch' ccd/coordinator-skill/SKILL.md
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected: `branch carries origin/main`; `1` (coordinator clause 15 exists — wave 1's); a count of at least `1`; `7 passed | 326 skipped`. **A `0` on the second line means wave 1 has not merged: stop and report — Task 5 has nothing to append to and Task 4's advisory interplay is unmeasurable.** If `origin/main` is not an ancestor, merge it (`git merge --no-edit origin/main`) and stop on any conflict.

- [ ] **Step 1: Write the failing test** — `server/test/ci-merge-queue.test.ts`:

```typescript
/**
 * The merge queue's half of `.github/workflows/ci.yml` (landing-order stage 2,
 * spec §5.2). Three properties, each read from the file rather than trusted to
 * the comments beside them:
 *
 *  1. `merge_group` is a trigger. Without it a queue entry's required checks
 *     never report, and the queue removes the entry at its timeout.
 *  2. Every macOS job skips a `merge_group` run, and NO other job mentions
 *     `merge_group` at all. The second half is the dangerous one: GitHub
 *     reports a job skipped by `if:` as passing, so a required leg that skipped
 *     the queue would let the queue merge a tree nobody tested.
 *  3. A `pull_request` run cancels its superseded predecessor, and every other
 *     event runs in a group of its own — GitHub keeps one PENDING run per group
 *     and cancels the rest even with `cancel-in-progress: false`, so a shared
 *     group would let one queue entry's run cancel another's.
 *
 * DERIVED, not listed: "a macOS job" is any job whose block says
 * `runs-on: macos-…`, so a job the CI test selection programme adds later (a
 * macOS shard) is held to rule 2 without this file learning its name.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ci = (): string => readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

/** The lines of one TOP-LEVEL key's block: everything after `^<key>:` up to
 *  the next line that opens another top-level key. */
function topBlock(yml: string, key: string): string[] {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => l === `${key}:`);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^[A-Za-z_][\w-]*:/.test(l));
  return end < 0 ? rest : rest.slice(0, end);
}

/** `jobs:` as job name -> that job's lines, read the way `oss-metadata.test.ts`
 *  reads it (every job key at two-space indent). */
function jobs(yml: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const l of topBlock(yml, 'jobs')) {
    const head = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(l);
    if (head) { cur = []; out.set(head[1]!, cur); continue; }
    cur?.push(l);
  }
  return out;
}

const SKIP = "    if: github.event_name != 'merge_group'";
const isMac = (block: string[]): boolean => block.some((l) => /^ {4}runs-on: macos-/.test(l));

describe('ci.yml and the merge queue (landing-order stage 2)', () => {
  it('triggers on merge_group, beside pull_request', () => {
    const on = topBlock(ci(), 'on').map((l) => /^ {2}([a-z_]+):/.exec(l)?.[1]).filter(Boolean);
    expect(on, 'ci.yml no longer triggers on pull_request').toContain('pull_request');
    expect(on, 'ci.yml does not trigger on merge_group — a queue entry would never get its required checks')
      .toContain('merge_group');
  });

  it('skips merge_group on every macOS job, and on no other job', () => {
    const all = jobs(ci());
    // Guard the guard: a reader that parsed no macOS job would make the loop
    // below vacuous, and there are two today.
    const macs = [...all].filter(([, b]) => isMac(b)).map(([n]) => n);
    expect(macs.length, 'parsed no macOS job at all — this test went blind').toBeGreaterThan(0);
    for (const [name, block] of all) {
      if (isMac(block)) {
        expect(block, `macOS job \`${name}\` runs on merge_group — non-required, and it holds a macOS runner the queue does not wait for`)
          .toContain(SKIP);
      } else {
        expect(block.join('\n'), `job \`${name}\` mentions merge_group — a required leg skipped by if: reports as PASSING, and the queue would merge an untested tree`)
          .not.toContain('merge_group');
      }
    }
  });

  it('cancels a superseded pull_request run and nothing else', () => {
    const block = topBlock(ci(), 'concurrency');
    const group = block.find((l) => l.startsWith('  group: '));
    expect(group, 'ci.yml has no concurrency group').toBeDefined();
    // The PR arm is keyed by the PR number, and ONLY a pull_request event takes it.
    expect(group).toContain("github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number)");
    // Every other event falls to a key no other run shares.
    expect(group, 'a non-PR event shares a group — GitHub keeps one pending run per group and cancels the rest')
      .toMatch(/\|\| github\.run_id \}\}$/);
    expect(block, 'cancel-in-progress must be the pull_request event and nothing wider')
      .toContain("  cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-merge-queue.test.ts
```

Expected (measured at `905360dc`): `3 failed`, with `ci.yml does not trigger on merge_group — … expected [ 'push', 'pull_request', …(1) ] to include 'merge_group'`, `macOS job \`test-macos\` runs on merge_group …`, and `ci.yml has no concurrency group: expected undefined to be defined`.

- [ ] **Step 3: Add the trigger.** Locate `  pull_request:` inside `on:` (`grep -n '^  pull_request:$' .github/workflows/ci.yml` — one hit, ≈21) and insert directly after it, above the `workflow_dispatch` comment:

```yaml
  # THE MERGE QUEUE (landing-order stage 2, spec §5.2). A queue runs the
  # REQUIRED checks on the group it built before it merges, and a workflow that
  # does not listen for `merge_group` never reports them — the entry waits out
  # the queue's timeout and is removed. So this trigger is what lets a ruleset
  # require the queue at all, and it is on `main` BEFORE the operator turns the
  # queue on (the spec's rollout step 1). `push` stays `branches: [main]`, so
  # the queue's own `gh-readonly-queue/main/*` branches start no second run.
  merge_group:
```

- [ ] **Step 4: Add the concurrency block.** Locate `^jobs:$` (one hit, ≈30 before Step 3) and insert directly above it (after the blank line that follows `  workflow_dispatch:`):

```yaml
# ONE RUN PER PULL REQUEST, NOT ONE PER PUSH (landing-order stage 2). A push
# that supersedes a PR's head makes the older run's answer worthless, and it
# kept holding runners — macOS ones among them — until it finished. So every
# `pull_request` run of one PR shares a group, and the newer cancels the older.
#
# EVERY OTHER EVENT GETS A GROUP OF ITS OWN (`github.run_id` is unique per
# run), and that is not decoration: GitHub keeps at most ONE pending run per
# group and cancels the older pending one even with `cancel-in-progress:
# false`. A shared group would let one queue entry's `merge_group` run cancel
# another's, and drop a merge's `push` run on `main`. The PR arm is spelled
# `ci-<workflow>-pr-<number>`, the name the CI test selection design (§4.3)
# gives the same group, so that programme's reshaping keeps this one's key.
concurrency:
  group: ci-${{ github.workflow }}-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || github.run_id }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

```

- [ ] **Step 5: Keep both macOS legs off queue runs.** In `test-macos` (locate `^  test-macos:$`), directly under its `    runs-on: macos-latest` line, insert:

```yaml
    # NOT ON A MERGE QUEUE RUN (landing-order stage 2). Non-required, so the
    # queue does not wait for it — but it would still start, on the org's
    # five-job macOS cap, and it is the leg that runs into its 55-minute
    # deadline. The `push` run on `main` after the merge still runs it.
    if: github.event_name != 'merge_group'
```

In `probe-macos` (locate `^  probe-macos:$`), directly under its `    runs-on: macos-latest` line, insert:

```yaml
    # Not on a merge queue run either, for `test-macos`'s reason: it reports,
    # it does not gate, and the queue is a gate.
    if: github.event_name != 'merge_group'
```

`timeout-minutes` stays each job's first `timeout-minutes` key, so `oss-metadata.test.ts`'s reader is unaffected.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-merge-queue.test.ts test/oss-metadata.test.ts
```

Expected (measured): `2 passed (2)` files, `25 passed (25)` tests (3 new + 22 existing).

- [ ] **Step 7: Mutation check, then commit**

Six mutations, each restored from a saved copy of the Step 5 file (`cp .github/workflows/ci.yml "$SCRATCH/ci.yml.task1"` first; restore with `cp` back, never `git checkout --`). Every red below was measured on the prototype:

| # | Exact edit in `.github/workflows/ci.yml` | Command (from `server/`) | Expected red |
|---|---|---|---|
| M1 | delete the line `  merge_group:` | `./node_modules/.bin/vitest run test/ci-merge-queue.test.ts` | "triggers on merge_group…" only — `expected [ 'push', 'pull_request', …(1) ] to include 'merge_group'` |
| M2 | delete `test-macos`'s `    if: github.event_name != 'merge_group'` | same | "skips merge_group on every macOS job…" only — `macOS job \`test-macos\` runs on merge_group …` |
| M2b | delete `probe-macos`'s `    if: github.event_name != 'merge_group'` | same | same case — `macOS job \`probe-macos\` runs on merge_group …` |
| M3 | add `    if: github.event_name != 'merge_group'` under `build-pwa`'s `    runs-on: ubuntu-latest` | same | same case — `job \`build-pwa\` mentions merge_group — a required leg skipped by if: reports as PASSING …` |
| M4 | `  cancel-in-progress: ${{ github.event_name == 'pull_request' }}` → `  cancel-in-progress: true` | same | "cancels a superseded pull_request run and nothing else" only — `cancel-in-progress must be the pull_request event and nothing wider` |
| M5 | `\|\| github.run_id }}` → `\|\| github.ref }}` | same | same case — `a non-PR event shares a group — GitHub keeps one pending run per group and cancels the rest: expected '  group: ci-${{ github.workflow }}-${…' to match /\|\| github\.run_id \}\}$/` |

```bash
git add .github/workflows/ci.yml server/test/ci-merge-queue.test.ts
git commit -m "$(cat <<'MSG'
ci: answer the merge queue, keep macOS off queue runs, cancel superseded PR runs

ci.yml gains merge_group beside pull_request, so a queue entry gets its
required checks (landing-order stage 2, spec §5.2 rollout step 1: this lands
before the operator turns the queue on). test-macos and probe-macos skip a
merge_group run — non-required, and a job skipped by if: reports as passing,
so ci-merge-queue.test.ts also pins that NO other job mentions merge_group.
A workflow concurrency group keyed ci-<workflow>-pr-<number> cancels a
superseded pull_request run; every other event gets a run-unique group,
because GitHub keeps one pending run per group and cancels the rest.

The PR group's name is the one the CI test selection design (§4.3) gives the
same group; whichever programme lands second merges the other's shape.
MSG
)"
```

---

### Task 2: `ccd pr-state --project` reads the merge queue — one query per repository per sweep

**Model routing:** `sonnet`, effort `high` — `ccd`'s pr-state lane, a new embedded python pass, the cross-language budget, and the corpus tax.

**Files:**
- Modify: `ccd/ccd` — insert the queue block between `cmd_clip`'s closing `}` and `# Guard so the script can be \`source\`d …`; replace ONE line in `cmd_pr_state` (the per-session loop); rewrite IN PLACE `cmd_pr_state`'s nine-line budget header and the sixteen-line outer-bound paragraph above `PR_GH_CHECKS_TIMEOUT=5`
- Modify: `server/src/remote/runner.ts`, `server/test/remote-runner.test.ts`, `server/test/pr-timeout-budget.test.ts`
- Test: `server/test/ccd-pr-queue.test.ts` (new)

**Interfaces:**
- Consumes: `_gh_repo_slug`'s `OWNER/NAME` (anchored to `[A-Za-z0-9._-]`), `_plat_timeout`, each full `_pr_state_one` line's `number`, `id` and `rows`.
- Produces: on every FULL line of `ccd pr-state --project` (a line with `id` and `rows`), `queue` ∈ `queued | dequeued | landed | none | unmeasured`, plus `queueAt` (ISO-8601 `Z` timestamp of the last queue act) only when present and well-shaped. `--session` lines, failure objects and older builds carry neither key. `CCD_VERB_TIMEOUT_MS['pr-state'] = 25_000`. Task 3 reads both keys through `queueFor`.

- [ ] **Step 1: Write the failing test** — `server/test/ccd-pr-queue.test.ts`:

```typescript
/**
 * `ccd pr-state --project`'s merge-queue read (landing-order wave 2, spec §5.2):
 * one GraphQL query per repository per sweep, under its own timeout, answering
 * `queued | dequeued | landed | none | unmeasured` in an additive `queue` field
 * on every full line — and never costing a row, a phase or a `checks` value.
 *
 * FIXTURE HOMEs ONLY (`makePrHarness`). `gh` is a shell function here, so it
 * answers before PATH does; a snippet that forgot it would meet the base
 * harness's poisoned `gh`, never the host's real token.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, WS_ADD } from './ccdWsHelpers.js';
import { makePrHarness, mergedRow, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-prqueue-'); });
afterEach(() => { h.cleanup(); });

/** The seconds ccd assigns to a bare `NAME=<n>` constant — read, never
 *  hardcoded, for `ccd-pr-state.test.ts`'s reason: these assertions are about
 *  WHICH timeout wraps WHICH call. */
const ccdSeconds = (name: string): number => {
  const m = new RegExp(`^${name}=(\\d+)`, 'm').exec(readFileSync(CCD, 'utf8'));
  if (!m) throw new Error(`ccd no longer defines ${name} as a bare integer assignment`);
  return Number(m[1]);
};

/** A workspace with one commit on its branch; returns the tip the binding
 *  check is pointed at (`ccd-pr-state.test.ts`'s fixture, returning the tip). */
const workspaceWithCommit = (project: string, slug: string): string => {
  h.makeGhRepo(project);
  h.sh(`${WS_ADD} CCD_WS_SLUG=${slug} cmd_ws_add ${project}`);
  const wt = path.join(h.home, 'worktrees', project, slug);
  fs.writeFileSync(path.join(wt, 'f.txt'), 'work\n');
  h.git(wt, 'add', 'f.txt');
  h.git(wt, 'commit', '-m', 'the work');
  return h.git(wt, 'rev-parse', 'HEAD');
};

const openRow = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  mergedRow({ state: 'OPEN', mergedAt: null, mergeCommit: null, ...over });

type Act = 'AddedToMergeQueueEvent' | 'RemovedFromMergeQueueEvent' | null;
const node = (number: number, state: 'OPEN' | 'MERGED', entry: boolean, act: Act,
  at = '2026-09-23T10:00:00Z'): Record<string, unknown> => ({
  number, state, mergeQueueEntry: entry ? { state: 'QUEUED' } : null,
  timelineItems: { nodes: act === null ? [] : [{ __typename: act, createdAt: at }] },
});
const answer = (open: unknown[], merged: unknown[] = []): string =>
  JSON.stringify({ data: { repository: { open: { nodes: open }, merged: { nodes: merged } } } });

/** A `gh` that tells the queue query apart from the two `pr list` calls by its
 *  first two words, logs every call's argv on one line to `gh-calls` (as the
 *  shared stub does) and the queue call's argv NUL-separated to `gh-queue-argv`
 *  — the query is multi-line, so only the NUL form can be asserted token by
 *  token. `graphqlArm` is what the queue call does. */
const queueGh = (graphqlArm: string): string => `
gh() {
  printf '%s\\n' "$1 $2" >> "$HOME/gh-calls"
  if [[ "$1 $2" == 'api graphql' ]]; then
    printf '%s\\0' "$@" > "$HOME/gh-queue-argv"
    ${graphqlArm}
    return
  fi
  [[ -f "$HOME/gh-rows.json" ]] && cat "$HOME/gh-rows.json"
  return 0
};
timeout() { case "$1" in -*) return 125 ;; esac; printf 'timeout %s %s %s %s\\n' "$1" "$2" "$3" "$4" >> "$HOME/gh-calls"; shift; "$@"; };
`;
const ANSWERS = 'cat "$HOME/gh-queue.json"';
const setQueue = (body: string): void => { fs.writeFileSync(path.join(h.home, 'gh-queue.json'), body); };

const lines = (out: string): Record<string, any>[] =>
  out.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
const sweep = (arm = ANSWERS): Record<string, any> =>
  lines(h.sh(`${queueGh(arm)} cmd_pr_state --project demo`))[0]!;

describe('pr-state --project reads the merge queue once per sweep', () => {
  it('makes one GraphQL call, under PR_GH_QUEUE_TIMEOUT, with owner and name as raw -f variables', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.sh(`${WS_ADD} CCD_WS_SLUG=still-cove cmd_ws_add demo`);
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(42, 'OPEN', true, 'AddedToMergeQueueEvent')]));
    h.sh(`${queueGh(ANSWERS)} cmd_pr_state --project demo`);
    // ONE per repository per sweep — two workspaces, still one call.
    expect(h.ghCalls().filter((c) => c === 'api graphql')).toHaveLength(1);
    expect(h.ghCalls()).toContain(`timeout ${ccdSeconds('PR_GH_QUEUE_TIMEOUT')} gh api graphql`);
    const argv = readFileSync(path.join(h.home, 'gh-queue-argv'), 'utf8').split('\0').filter(Boolean);
    expect(argv.slice(-4)).toEqual(['-f', 'owner=o', '-f', 'name=r']);
    // `-F` reads `@file` and coerces types; nothing here may use it.
    expect(argv).not.toContain('-F');
    const q = argv.find((a) => a.startsWith('query='))!;
    expect(q).toContain('mergeQueueEntry');
    expect(q).toContain('REMOVED_FROM_MERGE_QUEUE_EVENT');
    expect(q).toContain('ADDED_TO_MERGE_QUEUE_EVENT');
    // The document is a constant: the slug is a variable, never text in it.
    expect(q).not.toContain('"o"');
    expect(q).toContain('$owner');
  });

  it('--session makes no queue call and its line carries no queue key — absence is the older-build answer', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(42, 'OPEN', true, 'AddedToMergeQueueEvent')]));
    const o = lines(h.sh(`${queueGh(ANSWERS)} cmd_pr_state --session demo-quiet-basin`))[0]!;
    expect(h.ghCalls().filter((c) => c === 'api graphql')).toEqual([]);
    expect(o.phase).toBe('open');
    expect('queue' in o).toBe(false);
  });
});

describe('the five answers', () => {
  it('queued — OPEN with a queue entry, stamped with the last act', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(42, 'OPEN', true, 'AddedToMergeQueueEvent', '2026-09-23T10:00:00Z')]));
    const o = sweep();
    expect(o.queue).toBe('queued');
    expect(o.queueAt).toBe('2026-09-23T10:00:00Z');
    expect(o.phase).toBe('open');
  });

  it('dequeued — OPEN, no entry, last act a removal', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(42, 'OPEN', false, 'RemovedFromMergeQueueEvent', '2026-09-23T11:30:00Z')]));
    const o = sweep();
    expect(o.queue).toBe('dequeued');
    expect(o.queueAt).toBe('2026-09-23T11:30:00Z');
  });

  it('landed — MERGED, last act the add', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    setQueue(answer([], [node(42, 'MERGED', false, 'AddedToMergeQueueEvent')]));
    expect(sweep().queue).toBe('landed');
  });

  it('none — a MERGED PR whose last queue act is a removal was merged BY HAND after the dequeue', () => {
    // The case the spec's "last REMOVED event" alone cannot tell from a
    // re-enqueued-then-landed PR: the last act of EITHER kind decides.
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    setQueue(answer([], [node(42, 'MERGED', false, 'RemovedFromMergeQueueEvent')]));
    const o = sweep();
    expect(o.queue).toBe('none');
    expect('queueAt' in o).toBe(false);
  });

  it('none — an OPEN PR that never met the queue, and a workspace with no bound PR', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(42, 'OPEN', false, null)]));
    expect(sweep().queue).toBe('none');
    h.ghRows([]);
    expect(sweep().queue).toBe('none');
  });

  it('unmeasured — the bound PR is outside both windows', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(7, 'OPEN', true, 'AddedToMergeQueueEvent')]));
    expect(sweep().queue).toBe('unmeasured');
  });

  it('drops a queueAt that is not shaped like a timestamp, and keeps the word', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(42, 'OPEN', false, 'RemovedFromMergeQueueEvent', '$(reboot)')]));
    const o = sweep();
    expect(o.queue).toBe('dequeued');
    expect('queueAt' in o).toBe(false);
  });
});

describe('the queue read may not cost the rows', () => {
  it('a failed call says unmeasured on every line and leaves phase, number and rows alone', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    const o = sweep('return 1');
    expect(o.queue).toBe('unmeasured');
    expect(o.phase).toBe('open');
    expect(o.number).toBe(42);
    expect(o.rows).toHaveLength(1);
    // …and a workspace with NO bound PR is unmeasured too, never `none`: `none`
    // is a measured answer, and this sweep measured nothing about the queue.
    h.ghRows([]);
    expect(sweep('return 1').queue).toBe('unmeasured');
  });

  it('an answer that is not the query\'s shape is unmeasured, never none', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue('{"errors":[{"message":"Field \'mergeQueueEntry\' doesn\'t exist"}]}');
    expect(sweep().queue).toBe('unmeasured');
  });

  it('a stamping pass that fails prints the lines exactly as _pr_state_one did', () => {
    const tip = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([openRow({ headRefOid: tip })]);
    setQueue(answer([node(42, 'OPEN', true, 'AddedToMergeQueueEvent')]));
    const out = h.sh(`${queueGh(ANSWERS)} _pr_queue_py() { cat >/dev/null; return 1; }; cmd_pr_state --project demo`);
    const o = lines(out)[0]!;
    expect(o.phase).toBe('open');
    expect(o.number).toBe(42);
    expect('queue' in o).toBe(false);
  });

  it('passes a whole-repo failure object through untouched', () => {
    // `_gh_pr_list`'s own answer object is printed BEFORE the loop and never
    // reaches the stamp; a line with no `rows` is never stamped either.
    workspaceWithCommit('demo', 'quiet-basin');
    const out = h.sh(`${queueGh(ANSWERS)} gh() { printf '%s\\n' "$1 $2" >> "$HOME/gh-calls"; echo 'HTTP 504' >&2; return 1; }; cmd_pr_state --project demo`);
    expect(lines(out)).toEqual([{ phase: 'unknown', reason: 'unavailable' }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-pr-queue.test.ts
```

Expected (measured at `905360dc`): `10 failed | 3 passed (13)`. The three that pass — `--session` carries no key, a failed stamp prints unstamped lines, a whole-repo failure passes through — are true before this task and must stay true after it.

- [ ] **Step 3: Insert the queue block below `cmd_clip`.** Locate `grep -n '^# Guard so the script can be `source`d by tests without running a command.$' ccd/ccd` (one hit, ≈23323 at `905360dc`, directly after `cmd_clip`'s closing `}` and one blank line) and insert this block directly ABOVE that comment line — below every frozen corpus anchor and below both README anchors, so it moves none of them:

```bash
# ── THE MERGE QUEUE, READ ONCE PER REPOSITORY PER SWEEP (landing-order wave 2) ──
# `pr-state --project`'s THIRD gh call (spec §5.2), and it lives down here, below
# every line the frozen compaction-card corpus cites, so that adding it moved
# none of their anchors: `cmd_pr_state` pays one in-place line for it.
#
# WHAT IT ASKS. `gh pr list --json` has no field for a merge-queue entry, so the
# sweep asks GitHub's GraphQL API directly, with ONE constant query: every OPEN
# pull request's `mergeQueueEntry`, and the twenty most recently updated MERGED
# ones, each with the LAST queue act on its timeline. The spec names
# `mergeQueueEntry` and the last `REMOVED_FROM_MERGE_QUEUE_EVENT`; the last act
# of EITHER kind is read instead, because a removal alone cannot tell "dequeued,
# re-enqueued, landed" from "dequeued, then merged by hand" — the ADDED event
# after the removal is the whole difference.
#
# WHAT IT ANSWERS, per full line, in the additive `queue` field:
#   queued      the PR is OPEN and has a queue entry now
#   dequeued    the PR is OPEN, has no entry, and its last queue act is a removal
#               — GitHub does not re-enqueue after a failed group
#   landed      the PR is MERGED and its last queue act is the add (the queue merged it)
#   none        measured, and none of the above — including "this workspace has
#               no bound PR", and a PR that never met the queue
#   unmeasured  the call did not answer, or the bound PR is outside both windows
# plus `queueAt`, the ISO timestamp of that last act, only when it has one and
# only when it is shaped like a timestamp. `--session` never makes this call and
# never carries the key: its absence is the OLDER-build answer, which a reader
# must tell apart from `unmeasured`.
#
# ITS OWN BOUND, AND IT MAY NOT COST THE ROWS. `PR_GH_QUEUE_TIMEOUT` is summed
# with the other two calls' against the server's outer bound by
# `pr-timeout-budget.test.ts`. Measured 2026-09-23 on this project's own
# repository (11 open PRs, the 20 most recent merged): 0.72-1.39 s over five
# runs, so 4 s is about three times the worst. A failed call, an unreadable
# answer, and a stamping pass that itself fails each leave every row, phase and
# `checks` value exactly as `_pr_state_one` printed them; the first two say
# `unmeasured`, the third prints the lines unstamped.
#
# THE QUERY IS A CONSTANT, and owner and name travel as `-f` (raw string)
# variables — never interpolated into the document, and never `-F`, which reads
# `@file` and coerces types. Both halves come from `_gh_repo_slug`, whose regex
# anchors them to `[A-Za-z0-9._-]`.
PR_GH_QUEUE_TIMEOUT=4
PR_QUEUE_QUERY='query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    open: pullRequests(first: 100, states: [OPEN]) { nodes { ...Q } }
    merged: pullRequests(first: 20, states: [MERGED], orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ...Q } }
  }
}
fragment Q on PullRequest {
  number
  state
  mergeQueueEntry { state }
  timelineItems(last: 1, itemTypes: [ADDED_TO_MERGE_QUEUE_EVENT, REMOVED_FROM_MERGE_QUEUE_EVENT]) {
    nodes { __typename ... on AddedToMergeQueueEvent { createdAt } ... on RemovedFromMergeQueueEvent { createdAt } }
  }
}'

_gh_pr_queue() {   # repo -> the GraphQL answer on stdout, or NOTHING and non-zero
  # Prints nothing on failure, `_gh_pr_checks`'s rule and for its reason: this
  # is an annotation on rows somebody else already read, so the only outcomes
  # are "here is an answer" and "there is none to attach".
  local repo="$1" out rc
  out=$(_plat_timeout "$PR_GH_QUEUE_TIMEOUT" gh api graphql -f query="$PR_QUEUE_QUERY" \
          -f owner="${repo%%/*}" -f name="${repo#*/}" 2>/dev/null); rc=$?
  (( rc == 0 )) || return 1
  [[ -n "$out" ]] || return 1
  printf '%s\n' "$out"
}

_pr_queue_stamp() {   # mode repo; stdin = the sweep's lines -> the same lines, full ones stamped
  # BUFFERED, and that costs nothing: the server reads a sweep's stdout only
  # when the verb exited 0 (`sweepPr` backs the project off on anything else),
  # so a half-printed sweep was never read.
  local mode="$1" repo="$2" lines answer="" stamped src=0
  lines=$(cat)
  [[ -n "$lines" ]] || return 0
  if [[ $mode != --project ]]; then printf '%s\n' "$lines"; return 0; fi
  answer=$(_gh_pr_queue "$repo") || answer=""
  stamped=$(printf '%s\n' "$lines" | _pr_queue_py 4<<<"$answer"); src=$?
  if (( src == 0 )) && [[ -n "$stamped" ]]; then printf '%s\n' "$stamped"; else printf '%s\n' "$lines"; fi
}

_pr_queue_py() {   # stdin = the sweep's lines, fd 4 = the GraphQL answer (maybe empty)
  # The program on fd 3 and the two GitHub-sourced documents on stdin and fd 4 —
  # `_pr_py rollups`' layout, for its reason: nothing GitHub wrote is ever
  # placed in an argv or a shell word.
  python3 /dev/fd/3 3<<'PY'
import json, re, sys
ISO = re.compile(r'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$')

def facts_in():
    """{number: (state, has_entry, last_act, at)}, or None when the call did not
    answer or its body is not the shape the query asks for — never {} for that,
    because {} would read every bound PR as `unmeasured` for the WRONG reason
    and `none` for a PR the window genuinely covers is a claim."""
    try:
        with open('/dev/fd/4') as f:
            raw = f.read().strip()
    except OSError:
        raw = ''
    if not raw:
        return None
    try:
        repo = json.loads(raw)['data']['repository']
        groups = (repo['open']['nodes'], repo['merged']['nodes'])
    except Exception:
        return None
    out = {}
    for nodes in groups:
        if not isinstance(nodes, list):
            return None
        for n in nodes:
            num = n.get('number') if isinstance(n, dict) else None
            if not isinstance(num, int) or isinstance(num, bool):
                continue
            items = (n.get('timelineItems') or {}).get('nodes') if isinstance(n.get('timelineItems'), dict) else None
            last = items[-1] if isinstance(items, list) and items and isinstance(items[-1], dict) else {}
            at = last.get('createdAt')
            at = at if isinstance(at, str) and ISO.match(at) else None
            out[num] = (n.get('state'), n.get('mergeQueueEntry') is not None, last.get('__typename'), at)
    return out

FACTS = facts_in()

def word(line):
    if FACTS is None:
        return 'unmeasured', None
    num = line.get('number')
    if not isinstance(num, int) or isinstance(num, bool):
        return 'none', None
    f = FACTS.get(num)
    if f is None:
        return 'unmeasured', None
    state, entry, act, at = f
    if state == 'OPEN' and entry:
        return 'queued', at
    if state == 'OPEN' and act == 'RemovedFromMergeQueueEvent':
        return 'dequeued', at
    if state == 'MERGED' and act == 'AddedToMergeQueueEvent':
        return 'landed', at
    return 'none', None

for raw in sys.stdin.read().split('\n'):
    if raw == '':
        continue
    try:
        v = json.loads(raw)
    except Exception:
        sys.stdout.write(raw + '\n')
        continue
    if isinstance(v, dict) and isinstance(v.get('id'), str) and isinstance(v.get('rows'), list):
        w, at = word(v)
        v['queue'] = w
        if at is not None:
            v['queueAt'] = at
        sys.stdout.write(json.dumps(v) + '\n')
    else:
        sys.stdout.write(raw + '\n')
PY
}

```

(The block ends with one blank line, so the source-guard comment keeps its blank separator.)

- [ ] **Step 4: Wire it with ONE in-place line.** Locate `grep -n 'do _pr_state_one "\$id" "\$main" "\$repo" "\$rows" "\$answeredAt" "\$head"; done$' ccd/ccd` (one hit, the last statement of `cmd_pr_state`, ≈10684) and replace that line with:

```bash
  { for id in "${ids[@]}"; do _pr_state_one "$id" "$main" "$repo" "$rows" "$answeredAt" "$head"; done; } | _pr_queue_stamp "$mode" "$repo"
```

`PR_CHECKS_UNMEASURED` is `local -x`, so the loop's subshell still exports it to `_pr_py`; the loop's last status and the stamp's `return 0` keep the verb's exit code what it was.

- [ ] **Step 5: Rewrite `cmd_pr_state`'s budget header IN PLACE — nine lines for nine.** Locate `grep -n 'A CONSTANT NUMBER OF gh CALLS PER REPO' ccd/ccd` (≈10489) and replace these nine lines:

```bash
  # A CONSTANT NUMBER OF gh CALLS PER REPO, never one per session — one for
  # `--session`, two for `--project`, and neither number moves when a project
  # grows a ninth workspace. That was "ONE gh call per repo, whichever form"
  # until `--project` had to stop asking for a hundred check rollups GitHub
  # answers with `HTTP 504`; the rollups are a second call now, and the budget
  # argument the sentence was making (8 projects x 1 call / 120 s ~ 5 % of the
  # GraphQL allowance) survives doubling and would not survive going per
  # session. Read-only apart from the three registry fields it persists so a
  # ccrc restart degrades to honest stale.
```

with:

```bash
  # A CONSTANT NUMBER OF gh CALLS PER REPO, never one per session — one for
  # `--session`, three for `--project` (the rows, the rollups, and the merge
  # queue read `_pr_queue_stamp` makes), and no number moves when a project
  # grows a ninth workspace. The budget argument (8 projects x 1 call / 120 s
  # ~ 5 % of the GraphQL allowance) survives tripling and would not survive
  # going per session, and `pr-timeout-budget.test.ts` sums the three calls'
  # timeouts against the server's outer bound on this verb. Read-only apart
  # from the three registry fields it persists so a ccrc restart degrades to
  # honest stale.
```

- [ ] **Step 6: Rewrite the outer-bound paragraph IN PLACE — sixteen lines for sixteen.** Locate `grep -n 'THE OUTER BOUND IS 20 s, NOT 90' ccd/ccd` (≈5116) and replace the sixteen lines from it through `# request; that test is the mechanism.` with:

```bash
# THE OUTER BOUND IS 25 s, NOT 90, AND EVERY CALL HERE HAS TO FIT INSIDE IT.
# An earlier version of this comment asserted that `remote/runner.ts`'s
# `CCD_VERB_TIMEOUT_MS` had no `pr-state` key and the live bound was the flat
# 90 s default. It has one, the FIRST key in that map (on `origin/main` since
# 27946f31), so that number IS this verb's bound, and `sweepPr`'s every `ccd
# pr-state --project` is killed at it in remote mode — this fleet's standing
# config. It was 20 s until landing-order wave 2 added a THIRD call, the merge
# queue read (`PR_GH_QUEUE_TIMEOUT`, at `_gh_pr_queue` below `cmd_clip`).
#
# That matters because the calls' budgets add up. The old 12 + 6 spent 18 of
# 20 before `_pr_state_one` had run for a single workspace, and each workspace
# then costs a dozen-odd `git` spawns plus a python3 start. The three are now
# 8 + 5 + 4 = 17 of 25, leaving 8 s — 32 % — for the local loop, and
# `pr-timeout-budget.test.ts` PINS that relationship across the two languages
# so this comment can never drift from the map again. A comment is a request;
# that test is the mechanism.
```

- [ ] **Step 7: Raise the outer bound, and sum three timeouts.** In `server/src/remote/runner.ts`, replace:

```typescript
  'pr-state': 20_000,
  // Same reach as pr-state, and the same number: it shells out to `git
  // ls-remote` against origin before it will rename. Without an entry it
  // silently inherits the flat 90 s, which is nine naming lanes' worth.
  'ws-rename': 20_000,
```

with:

```typescript
  // 25, not 20, since landing-order wave 2: `pr-state --project` makes THREE
  // gh calls now (rows, rollups, the merge-queue read), and their timeouts are
  // summed against this number by `pr-timeout-budget.test.ts`.
  'pr-state': 25_000,
  // Same reach as pr-state: it shells out to `git ls-remote` against origin
  // before it will rename. Without an entry it silently inherits the flat
  // 90 s, which is nine naming lanes' worth. It makes ONE network call, so it
  // keeps the 20 s pr-state had before its third.
  'ws-rename': 20_000,
```

In `server/test/remote-runner.test.ts`, replace:

```typescript
    [['pr-state', '--session', 'x'], 20_000],
    // Same reach and same number as pr-state: it shells out to `git
    // ls-remote` before it will rename. Without this row, deleting or
    // changing the entry in CCD_VERB_TIMEOUT_MS cannot fail a single test.
```

with:

```typescript
    // 25 since landing-order wave 2 — three gh calls, summed against this by
    // pr-timeout-budget.test.ts.
    [['pr-state', '--session', 'x'], 25_000],
    // Same reach as pr-state: it shells out to `git ls-remote` before it will
    // rename. Without this row, deleting or changing the entry in
    // CCD_VERB_TIMEOUT_MS cannot fail a single test.
```

In `server/test/pr-timeout-budget.test.ts`, replace the header's

```typescript
 * `ccd pr-state --project` now makes TWO network calls: the row window
 * (`PR_GH_TIMEOUT`) and the open-PR check rollup (`PR_GH_CHECKS_TIMEOUT`),
 * both in bash. What KILLS the whole verb is in TypeScript, one process and one
```

with

```typescript
 * `ccd pr-state --project` now makes THREE network calls: the row window
 * (`PR_GH_TIMEOUT`), the open-PR check rollup (`PR_GH_CHECKS_TIMEOUT`) and,
 * since landing-order wave 2, the merge-queue read (`PR_GH_QUEUE_TIMEOUT`),
 * all in bash. What KILLS the whole verb is in TypeScript, one process and one
```

and its closing paragraph

```typescript
 * So this reads all three numbers from their real sources and asserts the
 * arithmetic. It is deliberately a BUDGET assertion rather than three literal
 * pins: the numbers may move, and what must not move is that the two calls
 * cannot eat the bound.
```

with

```typescript
 * (The bound is 25_000 since landing-order wave 2, raised for the third call
 * rather than squeezing the two measured ones.)
 *
 * So this reads every number from its real source and asserts the
 * arithmetic. It is deliberately a BUDGET assertion rather than literal pins:
 * the numbers may move, and what must not move is that the calls cannot eat
 * the bound.
```

and replace the two `it`s (from `  it('the two gh calls together leave real room for the per-workspace loop', () => {` through the end of `  it('each single call also fits the bound on its own …` ) with:

```typescript
  // THREE calls since landing-order wave 2: the merge-queue read
  // (`PR_GH_QUEUE_TIMEOUT`, `_gh_pr_queue`) runs after the local loop and adds
  // to the same wall clock the outer bound kills, so it is summed here with
  // the other two — and the bound was raised 20 s -> 25 s to make room for it
  // rather than squeezing the two measured budgets.
  const CALLS = ['PR_GH_TIMEOUT', 'PR_GH_CHECKS_TIMEOUT', 'PR_GH_QUEUE_TIMEOUT'] as const;

  it('the three gh calls together leave real room for the per-workspace loop', () => {
    const secs = CALLS.map((c) => ccdSeconds(c));
    const outerMs = verbTimeoutMs('pr-state');

    // Guard the guard: a regex that silently stopped matching would make every
    // assertion below vacuous, which is the failure mode this whole file exists
    // to retire one level up.
    CALLS.forEach((c, i) => expect(secs[i], `${c} read as zero`).toBeGreaterThan(0));
    expect(outerMs, 'the outer bound read as zero').toBeGreaterThan(0);

    const budgetS = outerMs / 1000;
    const sum = secs.reduce((a, b) => a + b, 0);
    expect(sum,
      `the three gh calls (${secs.join('s + ')}s) leave only ${budgetS - sum}s of the `
      + `${budgetS}s pr-state bound for _pr_state_one to loop every workspace — raise the bound in `
      + `server/src/remote/runner.ts or lower a timeout in ccd, but do not leave them in this ratio`)
      .toBeLessThanOrEqual(budgetS * (1 - LOCAL_LOOP_RESERVE));
  });

  it('each single call also fits the bound on its own — a trivially true check that stops a silly one', () => {
    // If any call alone could outlive the verb, the sum assertion above would
    // still be satisfiable by making the OTHERS tiny.
    const outerS = verbTimeoutMs('pr-state') / 1000;
    for (const c of CALLS) expect(ccdSeconds(c), c).toBeLessThan(outerS);
  });
```

- [ ] **Step 8: Re-stamp, then pay (and prove) the citation tax**

```bash
SCRATCH=<your scratchpad, absolute>
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
bash -n ccd/ccd && echo syntax-ok
git diff --numstat -- ccd/ccd
python3 "$SCRATCH/repoint-readme.py" && git diff --quiet -- README.md && echo readme-untouched
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD
```

Expected (measured on the prototype): `syntax-ok`; `185	25	ccd/ccd` (the 160-line block plus the stamp, the loop line and the two in-place rewrites — nothing net above `cmd_clip` but the stamp line's own bytes); the re-pointer prints `cmd_ensure mint -> ccd/ccd:21202` and `genrc == 1 arm -> ccd/ccd:19989-19991` at `905360dc` (the instrument's values are the authority on a moved base) and `readme-untouched`; the re-measurer prints `stated == base == tree` on all four lines (`147 / 195 / 53 / 35`), `other byFile keys moved: none`, and EMPTY `ENTERED`/`LEFT` everywhere.

- [ ] **Step 9: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-pr-queue.test.ts
./node_modules/.bin/vitest run test/ownership.test.ts test/ccd-pr-state.test.ts
./node_modules/.bin/vitest run test/pr-timeout-budget.test.ts test/remote-runner.test.ts
./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts test/ccd-bounded-reads.test.ts
./node_modules/.bin/vitest run test/macos-platform.test.ts test/prphase.test.ts test/pr-routes.test.ts test/whitelist-subset.test.ts
./node_modules/.bin/vitest run test/ccd-workspaces.test.ts -t 'EVERY bash call site'
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected (measured on the prototype): `13 passed (13)`; `113 passed (113)` (ownership proves the re-stamp; every existing pr-state case survives the third call — its stub answers the GraphQL call with rows, which reads as `unmeasured`); `23 passed (23)`; `49 passed (49)` (the `_reg_get` census did not move — this task adds no `_reg_get`); PASS (`98 passed | 10 skipped` for the first two, then the route and whitelist files); `1 passed | 78 skipped`; `7 passed | 326 skipped`.

- [ ] **Step 10: Mutation check, then commit**

Ten mutations, each restored from a saved copy (`cp ccd/ccd "$SCRATCH/ccd.task2"` and `cp server/src/remote/runner.ts "$SCRATCH/runner.task2"` after Step 8; restore with `cp` back — the copy is already stamped, so no re-stamp is needed between rows; never `git checkout --`). Every red below was measured on the prototype:

| # | Exact edit | Command (from `server/`) | Expected red |
|---|---|---|---|
| Q1 | `ccd/ccd`: `; } \| _pr_queue_stamp "$mode" "$repo"` → `; }` | `./node_modules/.bin/vitest run test/ccd-pr-queue.test.ts` | `10 failed \| 3 passed` — `expected [] to have a length of 1 but got +0`, `expected undefined to be 'queued'` |
| Q2 | `ccd/ccd`: `-f owner="${repo%%/*}" -f name="${repo#*/}"` → `-F owner="${repo%%/*}" -F name="${repo#*/}"` | same | "makes one GraphQL call…" only — `expected [ '-F', 'owner=o', '-F', 'name=r' ] to deeply equal [ '-f', 'owner=o', '-f', 'name=r' ]` |
| Q3 | `ccd/ccd`: `out=$(_plat_timeout "$PR_GH_QUEUE_TIMEOUT" gh api graphql` → `out=$(gh api graphql` | same | same case — `expected [ 'timeout 8 gh pr list', …(4) ] to include 'timeout 4 gh api graphql'` |
| Q4 | `ccd/ccd`: `    if state == 'MERGED' and act == 'AddedToMergeQueueEvent':` → `    if state == 'MERGED':` | same | "none — a MERGED PR whose last queue act is a removal…" only — `expected 'landed' to be 'none'` |
| Q5 | `ccd/ccd`: the fallback line `  if (( src == 0 )) && [[ -n "$stamped" ]]; then printf '%s\n' "$stamped"; else printf '%s\n' "$lines"; fi` → `  printf '%s\n' "$stamped"` | same | "a stamping pass that fails prints the lines…" only — `TypeError: Cannot read properties of undefined (reading 'phase')` (nothing was printed) |
| Q6 | `ccd/ccd`: in `facts_in`, `        raw = ''\n    if not raw:\n        return None` → `… return {}` | same | "a failed call says unmeasured on every line…" only — `expected 'none' to be 'unmeasured'` (the no-bound-PR line) |
| Q7 | `ccd/ccd`: delete `  if [[ $mode != --project ]]; then printf '%s\n' "$lines"; return 0; fi` | same | "--session makes no queue call…" only — `expected [ 'api graphql' ] to deeply equal []` |
| Q8 | `ccd/ccd`: `    at = at if isinstance(at, str) and ISO.match(at) else None` → `    at = at if isinstance(at, str) else None` | same | "drops a queueAt that is not shaped like a timestamp…" only — `expected true to be false` |
| B1 | `server/src/remote/runner.ts`: `  'pr-state': 25_000,` → `  'pr-state': 20_000,` | `./node_modules/.bin/vitest run test/pr-timeout-budget.test.ts test/remote-runner.test.ts` | `2 failed` — `the three gh calls (8s + 5s + 4s) leave only 3s of the 20s pr-state bound … expected 17 to be less than or equal to 14` and `expected 20000 to be 25000` |
| B2 | `ccd/ccd`: `PR_GH_QUEUE_TIMEOUT=4` → `PR_GH_QUEUE_TIMEOUT=6` | `./node_modules/.bin/vitest run test/pr-timeout-budget.test.ts` | `1 failed` — `the three gh calls (8s + 5s + 6s) leave only 6s of the 25s pr-state bound … expected 19 to be less than or equal to 17.5` |

```bash
git add ccd/ccd server/src/remote/runner.ts server/test/remote-runner.test.ts \
  server/test/pr-timeout-budget.test.ts server/test/ccd-pr-queue.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): pr-state --project reads the merge queue, once per repository per sweep

One constant GraphQL query per sweep (every OPEN PR's mergeQueueEntry and the
20 most recently updated MERGED ones, each with its last queue act of EITHER
kind — a removal alone cannot tell re-enqueued-then-landed from hand-merged),
under its own PR_GH_QUEUE_TIMEOUT, owner and name as raw -f variables. Every
full line gains an additive `queue` — queued | dequeued | landed | none |
unmeasured — and `queueAt` when the last act has a well-shaped time. A failed
call reads unmeasured on every line; a stamping pass that fails prints the
lines unstamped; no row, phase or checks value is ever touched. --session
makes no call and carries no key: absence is the older-build answer.

The server's outer bound on pr-state rises 20 s -> 25 s: 8 + 5 + 4 = 17 of
25 keeps pr-timeout-budget.test.ts's 30 % for the local loop (at 20 s the
third call could have had 1 s; measured 0.72-1.39 s). Spec §5.2.

S6-R11: the block sits below cmd_clip, beneath every frozen anchor; the one
line in cmd_pr_state and both prose rewrites are in place. Census 147 / 195
/ 53 / 35, stated == base == tree; README untouched.
MSG
)"
```

---

### Task 3: The server reads the queue word once, and turns a dequeue into a feed record and a coordinator mail

**Model routing:** `sonnet`, effort `high` — a new wire reader, a new watcher lane, a new feed kind across three packages.

**Files:**
- Modify: `server/src/prstate.ts` — `CcdPrLine.queue`/`queueAt`; `PR_QUEUE_MAP`, `PrQueue`, `PrQueueRead`, `queueFor` directly above `repoCellFor`'s docstring
- Modify: `server/src/watch.ts` — the `./prstate.js` import; `prQueues` and `dequeuedNotified` after `mergedNotified`; one line after `this.prStates.set(line.id, phaseFor(line));`; one call after `this.sweepMerged(records);`; `sweepDequeued` after `sweepMerged`; `dequeuedSubject` and `renderDequeueBrief` directly above `renderAskBrief`'s docstring
- Modify: `server/src/coord/rundefs.ts` — the `operator` gloss; `queueSystemMail`'s caller list
- Modify: `shared/api.ts` — two lines in place
- Modify: `pwa/src/screens/MailScreen.tsx`, `pwa/test/mail-screen.test.tsx`
- Test: `server/test/pr-queue-lane.test.ts` (new)

**Interfaces:**
- Consumes: Task 2's `queue`/`queueAt` on full `pr-state` lines; `CoordStore.openRunsForSession`, `CoordStore.resolveCoordinator(runId)`, `queueSystemMail`, `FleetWatcher.pushOne`.
- Produces: `queueFor(line: CcdPrLine): PrQueueRead` (`{ state: PrQueue | 'absent'; at: string | null }`); `NotifyEvent.kind` `'queue'`; a `feed_events` row of kind `queue` per (workspace, PR, removal time); a `status` mail with subject `dequeued:#<n>` from `operator` to the run's coordinator, on that run. Task 5's clause-15 sentence is what the mail's body points the coordinator at.

- [ ] **Step 1: Write the failing test** — `server/test/pr-queue-lane.test.ts`:

```typescript
/**
 * The server half of landing-order wave 2 (spec §5.2): `queueFor`, the ONE
 * reader of ccd's additive `queue`/`queueAt` fields, and the dequeue lane that
 * turns a `dequeued` reading into a `queue` feed record and a `status` mail to
 * the run's coordinator — once per (workspace, PR, removal), and never for any
 * other word, for an unmeasured read, or for a line from an older ccd.
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher, dequeuedSubject } from '../src/watch.js';
import { NotifyLog } from '../src/notifylog.js';
import { queueFor, type CcdPrLine } from '../src/prstate.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import type { PushPayload } from '../src/push.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';

const ID = 'demo-quiet-basin';

function seed(): string {
  const home = mkTmp('ccrc-queue-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [f, v] of [['uuid', 'u-' + ID], ['wrapper', 'claude'], ['workdir', '/w/' + ID],
    ['project', 'demo'], ['workspace', 'quiet-basin'], ['branch', 'ws/' + ID], ['base', 'origin/main']]) {
    writeFileSync(path.join(reg, `${ID}.${f}`), v!);
  }
  return home;
}

/** One full `pr-state` line for an OPEN PR #`number`, carrying whatever queue
 *  fields the case needs — `extra` absent means a line from an older ccd. */
const openLine = (extra: Record<string, unknown>, number = 42): string => JSON.stringify({
  id: ID, project: 'demo', repo: 'o/r', branch: 'ws/' + ID, base: 'origin/main', baseShort: 'main',
  tip: 'f'.repeat(40), ahead: 1, dirty: 0, commits: [], template: null,
  rows: [{ number, state: 'OPEN', headRefName: 'ws/' + ID, headRefOid: 'deadbee', baseRefName: 'main',
    isCrossRepository: false, mergedAt: null, mergeCommit: null, url: 'u', title: 't', isDraft: false,
    statusCheckRollup: null, ours: true }],
  phase: 'open', number, checkedAt: 1785300000000, reason: null, ...extra,
});

const runnerFor = (out: () => string): Runner => async (_cmd, args) => {
  if (args[0] === 'pr-state') return { code: 0, stdout: out(), stderr: '' };
  if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
  return { code: 0, stdout: '', stderr: '' };
};

async function harness(first: string, withRun = true) {
  const home = seed();
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  let runId: number | null = null;
  // With `withRun` false the ONE open programme belongs to ANOTHER workspace, so
  // `resolveCoordinator(null)` would answer a real session — the guess the lane
  // must not make for a PR no run of that coordinator names.
  const opened = coord.openRun({ program: 'landing', title: 't', project: 'demo',
    wave: 2, waveOf: 5, claimedBy: 'ccrc-pwa-coordinator' });
  if (!('id' in opened)) throw new Error('fixture openRun refused');
  coord.setSession(opened.id, withRun ? ID : 'demo-still-cove');
  if (withRun) runId = opened.id;
  const log = new NotifyLog(path.join(home, 'notify.json'));
  await log.load();
  const sent: PushPayload[] = [];
  let out = first;
  const w = new FleetWatcher({ ...testDeps(home, runnerFor(() => out)), coord, notifyLog: log,
    push: { notify: async (p: PushPayload) => { sent.push(p); } } as never }, new Bus(), 10_000);
  const sweep = async (next?: string): Promise<void> => {
    if (next !== undefined) out = next;
    (w as unknown as { lastPrSweep: number }).lastPrSweep = 0;
    await w.tick();
    await vi.waitFor(() => expect((w as unknown as { prSweepStartedAt: number }).prSweepStartedAt).toBe(0));
  };
  const queueFeed = () => coord.feedEvents(200).filter((e) => e.kind === 'queue');
  const mail = () => coord.mailForRecipient('ccrc-pwa-coordinator');
  return { w, sweep, sent, queueFeed, mail, runId };
}

describe('queueFor — the one reader of the queue fields', () => {
  const line = (extra: Record<string, unknown>): CcdPrLine => JSON.parse(openLine(extra)) as CcdPrLine;

  it('answers absent for a line with no queue key — an older ccd, or --session — never unmeasured', () => {
    expect(queueFor(line({}))).toEqual({ state: 'absent', at: null });
  });

  it('reads each of the five words, and a stranger token as unmeasured', () => {
    for (const w of ['queued', 'dequeued', 'landed', 'none', 'unmeasured']) {
      expect(queueFor(line({ queue: w })).state).toBe(w);
    }
    expect(queueFor(line({ queue: 'parked' })).state).toBe('unmeasured');
    expect(queueFor(line({ queue: 7 })).state).toBe('unmeasured');
  });

  it('keeps queueAt only when it is shaped like a timestamp', () => {
    expect(queueFor(line({ queue: 'dequeued', queueAt: '2026-09-23T11:30:00Z' })).at).toBe('2026-09-23T11:30:00Z');
    expect(queueFor(line({ queue: 'dequeued', queueAt: '$(reboot)' })).at).toBeNull();
  });
});

describe('the dequeue lane', () => {
  it('records a queue feed event and mails the run\'s coordinator, once', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: '2026-09-23T11:30:00Z' }));
    await f.sweep();
    expect(f.queueFeed()).toHaveLength(1);
    expect(f.queueFeed()[0]!.title).toBe('⤺ dequeued › quiet-basin');
    expect(f.queueFeed()[0]!.runId).toBe(f.runId);
    const m = f.mail();
    expect(m).toHaveLength(1);
    expect(m[0]!.subject).toBe(dequeuedSubject(42));
    expect(m[0]!.kind).toBe('status');
    expect(m[0]!.runId).toBe(f.runId);
    expect(f.sent.find((p) => p.tag === `queue-${ID}#42@2026-09-23T11:30:00Z`)).toBeDefined();
    // The same reading on the next sweep is the same fact: no second anything.
    await f.sweep();
    expect(f.queueFeed()).toHaveLength(1);
    expect(f.mail()).toHaveLength(1);
    f.w.stop();
  });

  it('announces a SECOND removal of the same PR — the latch carries the removal time', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: '2026-09-23T11:30:00Z' }));
    await f.sweep();
    await f.sweep(openLine({ queue: 'queued', queueAt: '2026-09-23T11:40:00Z' }));
    await f.sweep(openLine({ queue: 'dequeued', queueAt: '2026-09-23T12:05:00Z' }));
    expect(f.queueFeed()).toHaveLength(2);
    f.w.stop();
  });

  it('with no open run, records the feed event and mails nobody', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: '2026-09-23T11:30:00Z' }), false);
    await f.sweep();
    expect(f.queueFeed()).toHaveLength(1);
    expect(f.queueFeed()[0]!.body).toContain('No open run names a coordinator');
    expect(f.mail()).toEqual([]);
    f.w.stop();
  });

  it('says nothing for queued, landed, none, unmeasured, or a line from an older ccd', async () => {
    for (const extra of [{ queue: 'queued' }, { queue: 'landed' }, { queue: 'none' },
      { queue: 'unmeasured' }, {}]) {
      const f = await harness(openLine(extra));
      await f.sweep();
      expect(f.queueFeed(), JSON.stringify(extra)).toEqual([]);
      expect(f.mail(), JSON.stringify(extra)).toEqual([]);
      f.w.stop();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/pr-queue-lane.test.ts
```

Expected (measured at `905360dc`): `6 failed | 1 passed (7)` — `TypeError: queueFor is not a function` on the three reader cases and `expected [] to have a length of 1 but got +0` on the lane cases; "says nothing for…" passes (nothing announces yet) and must stay passing.

- [ ] **Step 3: The one reader, in `server/src/prstate.ts`.** In `CcdPrLine`, directly after `  checksUnmeasured?: boolean;`, insert:

```typescript
  /** The merge-queue word ccd's THIRD `--project` call stamps (landing-order
   *  wave 2, `_pr_queue_stamp`), and the ISO time of the last queue act beside
   *  it. RAW on purpose — `unknown`, never the union: `parsePrLines` casts a
   *  full line straight through, so the one place these become typed is
   *  `queueFor` below, their ONE reader. Absent on a `--session` line and on
   *  every line from an older ccd. */
  queue?: unknown;
  queueAt?: unknown;
```

Directly above `/** The repo cell for one project, from what the sweep measured about it.`, insert:

```typescript
/** The merge-queue vocabulary `ccd pr-state --project` answers in (spec §5.2),
 *  ENUMERATED ONCE — the word list below is derived from it, never re-typed. */
const PR_QUEUE_MAP = {
  queued: 'the PR is open and in the merge queue now',
  dequeued: 'the PR is open, out of the queue, and its last queue act was a removal',
  landed: 'the PR merged and its last queue act was the add: the queue merged it',
  none: 'measured, and none of the above',
  unmeasured: 'the queue read did not answer, or the bound PR is outside its windows',
} as const;
export type PrQueue = keyof typeof PR_QUEUE_MAP;
const PR_QUEUE_WORDS: readonly string[] = Object.keys(PR_QUEUE_MAP);

/** What `queueFor` read off one line. `absent` is its OWN answer and never
 *  `unmeasured`: a line with no `queue` key comes from a ccd that predates the
 *  read, or from `--session`, which never makes it — nothing was asked, where
 *  `unmeasured` means ccd asked and GitHub did not answer. Both mean "no
 *  evidence" to the dequeue lane; they are kept apart so no later reader has to
 *  re-derive which one it was holding. */
export interface PrQueueRead { state: PrQueue | 'absent'; at: string | null }

const QUEUE_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** The ONE reader of `CcdPrLine.queue` and `CcdPrLine.queueAt`. A word this
 *  build does not know reads as `unmeasured` — this is ccd's own output on this
 *  box, so a stranger token means the two builds disagree, which is a failed
 *  read, the same rule `asReason` applies above. */
export function queueFor(line: CcdPrLine): PrQueueRead {
  if (line.queue === undefined) return { state: 'absent', at: null };
  const state = typeof line.queue === 'string' && PR_QUEUE_WORDS.includes(line.queue)
    ? line.queue as PrQueue : 'unmeasured';
  const at = typeof line.queueAt === 'string' && QUEUE_AT_RE.test(line.queueAt) ? line.queueAt : null;
  return { state, at };
}

```

- [ ] **Step 4: The eighth feed kind — two lines of `shared/api.ts` IN PLACE, and the PWA's two total maps.** In `shared/api.ts` replace

```typescript
  kind: 'ask' | 'done' | 'merged' | 'mail' | 'run' | 'coord' | 'unknown';
```

with

```typescript
  kind: 'ask' | 'done' | 'merged' | 'mail' | 'run' | 'coord' | 'queue' | 'unknown';
```

and

```typescript
const NOTIFY_KINDS: readonly NotifyEvent['kind'][] = ['ask', 'done', 'merged', 'mail', 'run', 'coord', 'unknown'];
```

with

```typescript
const NOTIFY_KINDS: readonly NotifyEvent['kind'][] = ['ask', 'done', 'merged', 'mail', 'run', 'coord', 'queue', 'unknown'];
```

(No line is added: `shared/api.ts` is cited by line from README and the frozen plan. The argument for the new kind lives at `sweepDequeued`, Step 5.) In `pwa/src/screens/MailScreen.tsx` replace

```typescript
  coord: 'config', unknown: 'unknown',
};
const KIND_GLYPH: Record<NotifyEvent['kind'], string> = {
  mail: '✉', run: '⟳', ask: '?', done: '✓', merged: '⑂', coord: '⚙', unknown: '·',
};
```

with

```typescript
  coord: 'config', queue: 'queue', unknown: 'unknown',
};
const KIND_GLYPH: Record<NotifyEvent['kind'], string> = {
  mail: '✉', run: '⟳', ask: '?', done: '✓', merged: '⑂', coord: '⚙', queue: '⤺', unknown: '·',
};
```

In `pwa/test/mail-screen.test.tsx`, directly after the `it('renders a coord-kind feed record with its own word and glyph', …)` case's closing `  });`, insert:

```typescript

  // The EIGHTH kind (landing-order wave 2): a PR the merge queue removed
  // without landing. Not `merged` — it is the one PR outcome that is NOT a
  // merge — and not `mail`, which the coordinator's notice already is. Same
  // runtime assertion as coord's above, for the same reason.
  it('renders a queue-kind feed record with its own word and glyph', async () => {
    const store = makeStore();
    const ev = e({ seq: 10, kind: 'queue', title: 'dequeued quiet-basin',
                   body: 'PR #42 left the merge queue without landing' });
    act(() => { store.setState({ feed: [ev] }); });
    const { container } = render(
      <MailScreen store={store} loadFeed={vi.fn().mockResolvedValue({ events: [] })} />);
    expect(await screen.findByText('dequeued quiet-basin')).toBeInTheDocument();
    const kind = container.querySelector('.mail-kind');
    expect(kind, 'the queue row rendered no kind cell at all').not.toBeNull();
    expect(kind!.querySelector('.mail-kind-glyph')!.textContent, 'no glyph for queue').toBe('⤺');
    expect(kind!.textContent, 'no word for queue').toContain('queue');
  });
```

- [ ] **Step 5: The lane, in `server/src/watch.ts`.** Replace the import line

```typescript
import { isFullLine, parsePrLines, phaseFor, repoCellFor, type CcdPrFailure } from './prstate.js';
```

with

```typescript
import {
  isFullLine, parsePrLines, phaseFor, queueFor, repoCellFor, type CcdPrFailure, type PrQueueRead,
} from './prstate.js';
```

Directly after `  private mergedNotified = new Set<string>();`, insert:

```typescript
  /** The merge-queue word each session's last full pr-state line carried
   *  (`queueFor`), kept beside `prStates` and written by the same arm of
   *  `sweepPr`. Read by `sweepDequeued` and nothing else. */
  private prQueues = new Map<string, PrQueueRead>();
  /** `sweepDequeued`'s latch, per (workspace, PR, removal time) — the
   *  `mergedNotified` shape plus the removal's own timestamp, because a PR can
   *  be dequeued, re-enqueued and dequeued AGAIN, and each removal is a new
   *  fact the coordinator has to hear. In-memory for `mergedNotified`'s reason:
   *  a restart may repeat one notice, and the tag collapses the repeat. */
  private dequeuedNotified = new Set<string>();
```

Directly after `          this.prStates.set(line.id, phaseFor(line));` (one hit, `sweepPr`'s full-line arm), insert:

```typescript
          this.prQueues.set(line.id, queueFor(line));
```

Directly after `      this.sweepMerged(records);` (one hit), insert:

```typescript
      this.sweepDequeued(records);
```

After `sweepMerged`'s closing brace (its last statement is `      this.announceMerged(key, r, pr.number, reason);`, then `    }`, then `  }`), insert:

```typescript

  /**
   * The dequeue lane (landing-order wave 2, spec §5.2). GitHub does NOT
   * re-enqueue a PR its merge queue removed, so a removal nobody hears about is
   * a landing that silently stops. Once per (workspace, PR, removal):
   *
   *  - a `queue` FEED record, always — `recordAlways`, because a removal is a
   *    fact about the programme whether or not the operator is watching this
   *    pane. A NEW kind rather than `merged` or `mail`: a dequeue is the one PR
   *    outcome that is not a merge, and `MailScreen`'s two total maps name it;
   *    an older client degrades it to `unknown` through `reviveNotifyEvent`.
   *  - a `status` MAIL to the coordinator, when the workspace belongs to an
   *    open run whose coordinator resolves. The coordinator re-enqueues or
   *    sends a fix round; this lane decides neither and acts on nothing — no
   *    enqueue, no merge, no re-run. With no open run there is no coordinator to
   *    tell without guessing (`resolveCoordinator(null)`'s arm is a guess here,
   *    `tellSender`'s reason), so the feed record is the whole notice.
   *
   * `unmeasured` and `absent` NEVER announce, and neither do `queued`,
   * `landed` or `none`: the lane fires on the one word that asks for an act.
   */
  private sweepDequeued(records: SessionRecord[]): void {
    for (const r of records) {
      if (measuredIdentity(r) === null) continue;
      if (r.workspace === null || r.archivedAt !== null) continue;
      const q = this.prQueues.get(r.id);
      const number = this.prStates.get(r.id)?.number ?? null;
      if (q?.state !== 'dequeued' || number === null) continue;
      const key = `${r.id}#${number}@${q.at ?? ''}`;
      if (this.dequeuedNotified.has(key)) continue;
      this.dequeuedNotified.add(key);
      // ONE BAD ROW MAY NOT COST THE REST OF THE SWEEP: `node:sqlite` throws
      // synchronously, and this runs inside the void-dispatched `sweepPr`.
      try {
        const sib = this.deps.coord?.openRunsForSession(r.id);
        const run = sib?.ok ? sib.siblings[sib.siblings.length - 1] : undefined;
        const coordinator = run !== undefined ? this.deps.coord!.resolveCoordinator(run.id) : null;
        this.pushOne({
          kind: 'queue', sessionId: r.id, project: r.project,
          title: `⤺ dequeued › ${r.workspace}`,
          body: `PR #${number} left the merge queue without landing; GitHub does not re-enqueue it. `
            + (coordinator === null ? 'No open run names a coordinator to tell.' : `Mailed coordinator ${coordinator}.`),
          runId: run?.id ?? null,
          tag: `queue-${key}`,
          recordAlways: true,
        }, this.activeProjects);
        if (run !== undefined && coordinator !== null) {
          queueSystemMail(this.deps.coord!, run, {
            fromId: 'operator', toId: coordinator, runId: run.id, kind: 'status',
            subject: dequeuedSubject(number), body: renderDequeueBrief(r.id, number),
          });
        }
      } catch (err) {
        console.warn(`ccrc-server: dequeue notice for ${r.id} failed (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }
```

Directly above the docstring that begins `/**\n * The parent's ENTIRE evidentiary surface (design spec §6.1)` (the one above `function renderAskBrief(`), insert:

```typescript
/** The dequeue notice's subject. Unique per PR, not per removal: mail dedupe
 *  is subject-keyed over OUTSTANDING rows, so a second removal of the same PR
 *  while the coordinator has not acked the first is the same fact restated —
 *  and after the ack, a new removal mails again. */
export const dequeuedSubject = (pr: number): string => `dequeued:#${pr}`;

/** The dequeue notice's body. Every value in it is this server's own — a PR
 *  number, a registry-validated session id — and nothing GitHub wrote (the
 *  removal's reason is never carried): this text lands in a model's context. */
export function renderDequeueBrief(sessionId: string, pr: number): string {
  return `PR #${pr} (workspace \`${sessionId}\`) was removed from this repository's merge queue without landing. ` +
    `GitHub does not re-enqueue a PR after a failed group.\n` +
    `Read why from your own shell: \`gh pr view ${pr} --json statusCheckRollup,mergeStateStatus\`.\n` +
    `Then either re-enqueue it — \`gh pr merge ${pr}\`, never \`--admin\` (clause 15) — ` +
    `or send the owning worker a fix round.\n\n` +
    `Run the ccrc-coordinator skill.`;
}

```

- [ ] **Step 6: Say who raises it, in `server/src/coord/rundefs.ts`.** Replace

```typescript
    'watcher on their behalf (the ask nudge); never a session speaking for itself',
```

with

```typescript
    'watcher on their behalf (the ask nudge, the dequeue notice); never a session speaking for itself',
```

and in `queueSystemMail`'s comment replace

```typescript
    // `queueSystemMail` — all five of its callers: `close.ts`'s `closeRun`,
    // `dispatch.ts`'s `dispatchRun`, `kickoff.ts`'s `queueProgramKickoff`,
    // `routes.ts`'s `POST /api/runs/:id/advance` handler, and `watch.ts`'s
    // `FleetWatcher.hold` (the ask pre-emption lane's parent nudge, added
    // after this file's other four) — deliberately:
```

with

```typescript
    // `queueSystemMail` — all six of its callers: `close.ts`'s `closeRun`,
    // `dispatch.ts`'s `dispatchRun`, `kickoff.ts`'s `queueProgramKickoff`,
    // `routes.ts`'s `POST /api/runs/:id/advance` handler, and `watch.ts`'s
    // `FleetWatcher.hold` (the ask pre-emption lane's parent nudge, added
    // after this file's other four) and `FleetWatcher.sweepDequeued` (the
    // merge queue's dequeue notice, landing-order wave 2, which catches the
    // throw per row) — deliberately:
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/pr-queue-lane.test.ts
./node_modules/.bin/vitest run test/pr-sweep.test.ts test/prstate.test.ts
./node_modules/.bin/vitest run test/single-definition.test.ts test/coord-store.test.ts
./node_modules/.bin/vitest run test/mail-hardening.test.ts
./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit && echo tsc-ok
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
cd ../pwa && ./node_modules/.bin/vitest run test/mail-screen.test.tsx test/feed.test.ts test/notifymark.test.ts
```

Expected (measured on the prototype): `7 passed (7)`; `95 passed (95)`; `329 passed (329)`; PASS; `tsc-ok`; `7 passed | 326 skipped` (the two in-place `shared/api.ts` lines moved no citation); `52 passed (52)` and `Type Errors  no errors` (26 mail-screen cases, the new one among them).

- [ ] **Step 8: Mutation check, then commit**

Ten mutations, each restored from a saved copy (`cp` of `server/src/watch.ts`, `server/src/prstate.ts`, `shared/api.ts`, `pwa/src/screens/MailScreen.tsx` into `$SCRATCH` after Step 7; restore with `cp`). Every red below was measured on the prototype:

| # | Exact edit | Command | Expected red |
|---|---|---|---|
| L1 | `watch.ts`: delete `      this.sweepDequeued(records);` | `cd server && ./node_modules/.bin/vitest run test/pr-queue-lane.test.ts` | `3 failed` — the three lane cases that expect a record: `expected [] to have a length of 1 but got +0`, `… of 2 but got +0` |
| L2 | `watch.ts`: delete `          this.prQueues.set(line.id, queueFor(line));` (mutate the CALL SITE, not the reader) | same | same three, same reds |
| L3 | `watch.ts`: delete `      if (this.dequeuedNotified.has(key)) continue;` | same | "…mails the run's coordinator, once" only — `expected [ { seq: 1, …(6) }, { seq: 3, …(6) } ] to have a length of 1 but got 2` |
| L4 | `watch.ts`: ``const key = `${r.id}#${number}@${q.at ?? ''}`;`` → ``const key = `${r.id}#${number}`;`` | same | "announces a SECOND removal…" — `expected [ { seq: 1, … } ] to have a length of 2 but got 1` (and the tag lookup in the first case, `expected undefined to be defined`) |
| L5 | `watch.ts`: `if (q?.state !== 'dequeued' \|\| number === null) continue;` → `if ((q?.state !== 'dequeued' && q?.state !== 'unmeasured') \|\| number === null) continue;` | same | "says nothing for…" only — `{"queue":"unmeasured"}: expected [ { seq: 1, … } ] to deeply equal []` |
| L6 | `watch.ts`: `const coordinator = run !== undefined ? this.deps.coord!.resolveCoordinator(run.id) : null;` → `const coordinator = this.deps.coord!.resolveCoordinator(run?.id ?? null);` (guess the coordinator) | same | "with no open run…" only — `expected 'PR #42 left the merge queue without l…' to contain 'No open run names a coordinator'` |
| L7 | `prstate.ts`: `return { state: 'absent', at: null };` → `return { state: 'unmeasured', at: null };` | same | "answers absent…" only — `expected { state: 'unmeasured', at: null } to deeply equal { state: 'absent', at: null }` |
| L8 | `prstate.ts`: `typeof line.queueAt === 'string' && QUEUE_AT_RE.test(line.queueAt)` → `typeof line.queueAt === 'string'` | same | "keeps queueAt only when…" only — `expected '$(reboot)' to be null` |
| K1 | `shared/api.ts`: `'run', 'coord', 'queue', 'unknown'];` → `'run', 'coord', 'unknown'];` | same | the same three lane cases — the stored row reads back through `isNotifyKind` as `unknown`: `expected [] to have a length of 1 but got +0` |
| P1 | `MailScreen.tsx`: delete `queue: '⤺', ` | `cd pwa && ./node_modules/.bin/vitest run test/mail-screen.test.tsx` | "renders a queue-kind feed record…" only — `no glyph for queue: expected '' to be '⤺'` |

```bash
git add server/src/prstate.ts server/src/watch.ts server/src/coord/rundefs.ts shared/api.ts \
  pwa/src/screens/MailScreen.tsx pwa/test/mail-screen.test.tsx server/test/pr-queue-lane.test.ts
git commit -m "$(cat <<'MSG'
feat(server): a merge-queue dequeue becomes a feed record and a coordinator mail

queueFor is the ONE reader of ccd's additive queue/queueAt fields: the five
words, a stranger token as unmeasured, and absent for a line that never asked
(an older ccd, or --session) — never folded into unmeasured. sweepDequeued,
after sweepMerged, fires on `dequeued` alone, once per (workspace, PR, removal
time): a `queue` feed record always, and a `status` mail `dequeued:#<n>` to
the coordinator only when an open run names the workspace — never to a
guessed one. It enqueues, merges and re-runs nothing (spec §5.2, R5).

`queue` is the eighth NotifyEvent kind: additive, degraded to `unknown` by an
older client, named in MailScreen's two total maps. shared/api.ts's two lines
change in place, so no cited line moves. No FLEET_PROTO bump; PrState and
FleetSession are unchanged.
MSG
)"
```

---

### Task 4: The hook denies `gh pr merge` to a programme wave's session

**Model routing:** `sonnet`, effort `high` — the hook is on every tool call of ~20 sessions, and it is the gate R5 leans on.

**Files:**
- Modify: `ccd/session-hook.sh` — `_hook_hold_card`'s shape-gate line (in place); the `CCRC_PROJ_CLASS` note's two lines naming the third spelling (in place); the fifteen lines from `# The hold's own bound.` through `CCRC_HOLD_MAX=127` rewritten as fifteen lines that also assign `CCRC_HOLD_WAVE_RE`; the deny block directly above `if [[ "$event" == SubagentStart || "$event" == SubagentStop ]]; then`
- Modify: `server/test/run-routes.test.ts` — the hold-grammar pin
- Test: `server/test/session-hook-merge-deny.test.ts` (new)

**Interfaces:**
- Consumes: `$REG/<id>.hold` (read through `_ct_read`, judged under `CCRC_HOLD_MAX` by `CCRC_HOLD_WAVE_RE`), the PreToolUse payload's `tool_name` and `tool_input.command`, `_hook_deny_json`, `pre_json` and its single print site.
- Produces: `CCRC_HOLD_WAVE_RE` — the ONE spelling of "a hold that names a programme wave" in the hook; a PreToolUse deny whose reason quotes the hold and says the coordinator lands. Wave 2b extends this block with the every-session `--admin` deny and the `gh api` pulls-merge deny.

- [ ] **Step 1: Write the failing test** — `server/test/session-hook-merge-deny.test.ts`:

```typescript
/**
 * The worker merge deny (landing-order wave 2, spec §5.2, ruling R5): the
 * session hook's PreToolUse arm DENIES `gh pr merge` in a session whose hold
 * names a programme wave, and lets every other session's merge through — the
 * coordinator's plain `gh pr merge <n>` is how it enqueues.
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME, the way
 * `session-hook.test.ts` does: a stub `tmux` answers the session name, stdin
 * carries the payload, stdout is the one PreToolUse envelope (or nothing).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const ID = 'demo-quiet-basin';
const WAVE_HOLD = 'program:landing-order wave:2/5 run:17';

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-mergedeny-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.generation`), GENERATION);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const hold = (text: string): void => { fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.hold`), text); };

/** One PreToolUse Bash call through the real hook. Exit 0 and a silent stderr
 *  are the hook's standing contract, asserted on every call. */
const bash = (command: string): { deny: string | null; stdout: string } => {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: home }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION },
  });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stderr, 'the hook contract: silent on stderr').toBe('');
  const line = r.stdout.trim();
  if (line === '') return { deny: null, stdout: '' };
  const j = JSON.parse(line) as { hookSpecificOutput: { permissionDecision?: string; permissionDecisionReason?: string } };
  return {
    deny: j.hookSpecificOutput.permissionDecision === 'deny' ? String(j.hookSpecificOutput.permissionDecisionReason) : null,
    stdout: line,
  };
};

describe('the worker merge deny', () => {
  it('refuses a worker\'s merge, naming the hold and who lands instead', () => {
    hold(WAVE_HOLD);
    const r = bash('gh pr merge 42');
    expect(r.deny, 'a wave session\'s gh pr merge went through').not.toBeNull();
    expect(r.deny).toContain(WAVE_HOLD);
    expect(r.deny).toContain('the coordinator merges, workers never do');
  });

  it('lets a coordinator\'s plain enqueue through — a session with no hold is never asked', () => {
    expect(bash('gh pr merge 42').deny).toBeNull();
  });

  it('refuses a close-claimed hold too — `wave:N` with no run is still a wave', () => {
    hold('program:landing-order wave:3/5');
    expect(bash('gh pr merge 42').deny).not.toBeNull();
  });

  it('lets a hold that names no programme wave through, and an unreadable or oversized one', () => {
    hold('operator: debugging the lockfile');
    expect(bash('gh pr merge 42').deny, 'a hand hold is not a worker wave').toBeNull();
    // 152 characters whose FIRST 128 — all `_ct_read` returns — still match
    // the wave grammar: only the bound tells this hold was cut.
    hold(`program:${'x'.repeat(100)} wave:1/2 run:${'1'.repeat(30)}`);
    expect(bash('gh pr merge 42').deny, 'an oversized hold is unspeakable, never a wave').toBeNull();
    fs.rmSync(path.join(home, '.cc-sessions', `${ID}.hold`));
    fs.mkdirSync(path.join(home, '.cc-sessions', `${ID}.hold`));
    expect(bash('gh pr merge 42').deny, 'an unreadable hold is not a worker wave').toBeNull();
  });

  it('refuses every spelling it can parse at a command head', () => {
    hold(WAVE_HOLD);
    for (const c of [
      'gh pr merge 42 --squash', 'gh pr merge --auto 42', 'cd /tmp && gh pr merge 42',
      'GH_TOKEN=x gh pr merge 42', 'env gh pr merge 42', 'command gh pr merge 42',
      '/usr/bin/gh pr merge 42', 'gh -R owner/repo pr merge 42', 'echo ok; gh pr merge 42',
      'x=$(gh pr merge 42)', 'echo ok\ngh pr merge 42',
    ]) {
      expect(bash(c).deny, `not denied: ${c}`).not.toBeNull();
    }
  });

  it('a deny supersedes a sync advisory on the same call — one line, and it is the deny', () => {
    // Landing-order wave 1's PreToolUse advisory answers a sync of `main` with
    // `additionalContext`; a merge in the SAME command is still refused, and the
    // hook still prints exactly one envelope.
    hold(WAVE_HOLD);
    const r = bash('git merge origin/main && gh pr merge 42');
    expect(r.stdout.split('\n')).toHaveLength(1);
    expect(r.deny, 'the advisory won and the merge went through').not.toBeNull();
  });

  it('leaves every other gh and every mention of the words alone', () => {
    hold(WAVE_HOLD);
    for (const c of [
      'gh pr view 42', 'gh pr list --search merge', 'gh pr merged 42',
      "grep -rn 'gh pr merge' docs", 'echo "gh pr merge 42"', 'ghx pr merge 42',
    ]) {
      expect(bash(c).deny, `denied: ${c}`).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook-merge-deny.test.ts
```

Expected (measured at `905360dc`): `4 failed | 3 passed (7)` — the four refusal cases (`a wave session's gh pr merge went through: expected null not to be null`, `not denied: gh pr merge 42 --squash …`); the three pass-through cases pass before and after.

- [ ] **Step 3: One spelling of the wave grammar — three in-place edits, no line count moves.** (a) In `_hook_hold_card`, replace the ONE line

```bash
  [[ "$h" =~ ^program:[A-Za-z0-9._-]+' 'wave:[0-9]+(/[0-9]+)?(' 'run:[0-9]+)?$ ]] || return 0
```

with

```bash
  [[ "$h" =~ $CCRC_HOLD_WAVE_RE ]] || return 0
```

(b) In the `CCRC_PROJ_CLASS` note (locate `grep -n "the hold's shape gate" ccd/session-hook.sh`, ≈2663), replace the two lines

```bash
# file, and the hold's shape gate `^program:[A-Za-z0-9._-]+ wave:...` in
# `_hook_hold_card`. And `single-definition.test.ts`'s four `ROOTS` are the
```

with

```bash
# file, and the hold's shape gate `CCRC_HOLD_WAVE_RE` (`^program:[A-Za-z0-9._-]+
# wave:...`). And `single-definition.test.ts`'s four `ROOTS` are the
```

(c) Locate `grep -n "^# The hold's own bound" ccd/session-hook.sh` (≈2681) and replace the fifteen lines from it through `CCRC_HOLD_MAX=127` with these fifteen:

```bash
# The hold's own bound. `POST /api/sessions/:id/hold` validates only that the
# reason is a non-blank string and `ccd` only blankness, while `--actor` on the
# same verb IS capped at 512 — so this is the first bound the value meets. A
# hold that fails it is UNSPEAKABLE and the subject is silent. 127, NOT 256,
# AND THE OFF-BY-ONE IS THE WHOLE POINT (D-1896): `_ct_read` reads at most
# `CCRC_ID_MAX` (128) characters, so a value that comes back 128 long MAY have
# been truncated, and refusing at 127 means every value quoted was captured
# WHOLE. A 256 bound would let a 400-character hold arrive cut to 128, lose its
# ` run:<id>` suffix and render as CASE B ("It names NO run") for a hold that
# names one — the lying card this design exists to prevent.
CCRC_HOLD_MAX=127
# THE SHAPE of a hold that names a programme wave, spelled ONCE: the card's
# gate (`_hook_hold_card`) and the worker merge deny (landing-order wave 2);
# `run-routes.test.ts` holds every hold the server can write inside it.
CCRC_HOLD_WAVE_RE='^program:[A-Za-z0-9._-]+ wave:[0-9]+(/[0-9]+)?( run:[0-9]+)?$'
```

The assignment runs in the constants block, before the event `case` that calls `_hook_hold_card`, so the card never reads it unset. In `server/test/run-routes.test.ts` (the case "binds the shared cap to the hook's literal…"), replace

```typescript
    expect(hook).toContain(
      '[[ "$h" =~ ^program:[A-Za-z0-9._-]+\' \'wave:[0-9]+(/[0-9]+)?(\' \'run:[0-9]+)?$ ]] || return 0',
    );
```

with

```typescript
    // ONE spelling since landing-order wave 2: the card's gate and the worker
    // merge deny both read `CCRC_HOLD_WAVE_RE`, so the grammar is pinned where
    // it is assigned, and the card is pinned to read it.
    expect(hook).toContain(
      "CCRC_HOLD_WAVE_RE='^program:[A-Za-z0-9._-]+ wave:[0-9]+(/[0-9]+)?( run:[0-9]+)?$'",
    );
    expect(hook).toContain('[[ "$h" =~ $CCRC_HOLD_WAVE_RE ]] || return 0');
```

The case's own `hookGrammar` regex below it is unchanged — it already spells the same language, and its SUBSET loop still proves every hold the server writes is inside it.

- [ ] **Step 4: The deny.** Locate the line `if [[ "$event" == SubagentStart || "$event" == SubagentStop ]]; then` (the one at column 0, directly after the graph gate's closing `fi` and a blank line; ≈3116 at `905360dc`, later on a tree carrying wave 1's advisory) and insert directly ABOVE it:

```bash
# ── THE WORKER MERGE DENY (landing-order wave 2, spec §5.2) ─────────────
# "The coordinator merges, workers never do" (R5) was prose while every merge
# here needed the admin bypass. Once the operator sets the ruleset's approval
# count to 0, any session holding the fleet's one login could land with a
# plain `gh pr merge`. So a session whose hold names a programme wave — a
# dispatched worker's or reviewer's, the only sessions a dispatch holds — is
# DENIED `gh pr merge` in every spelling this file can parse at a COMMAND HEAD:
# after a line start or `;` `&` `|` `(` a backtick or `$(`, past `VAR=value`
# prefixes, `env`/`command`/`exec`, a path to the binary, and gh's own global
# flags (`-R owner/repo`). `--auto`, `--squash`, `--admin` and every other
# merge flag are the same act from a worker and are denied with it. A merge
# hidden inside a quoted string (`bash -c "…"`) is not parsed and passes: the
# hook is a contract the fleet honours, not an access boundary (spec §4), and
# identity on this box is attribution. A session with NO wave hold — the
# coordinator's, the operator's — is never asked, so the coordinator's plain
# `gh pr merge <n>` enqueues.
# Denying `--admin` to EVERY session, and the `gh api` merge call, is wave
# 2b's, after the operator's queue ruleset and proof run (spec §5.2 step 4).
#
# ORDER IS BUDGET, this arm's rule: the tool name is already read, the
# substring prefilter costs no fork, and only a Bash payload carrying `merge`
# pays the one jq for its command. The hold is read through `_ct_read` and
# judged by `CCRC_HOLD_WAVE_RE` under `CCRC_HOLD_MAX` — the card's own reader,
# shape and bound — so an absent, unreadable, empty, oversized or non-wave hold
# is not a worker wave and passes, exactly as the card declines to call it one.
#
# A DENY SUPERSEDES ADVICE: `pre_json` may already hold an `additionalContext`
# for this same call (the Read nudge, or a sync advisory); the merge deny
# replaces it. It never replaces the graph gate's DENY, which has already
# counted the denial it prints (D-1689) — that call is refused either way.
GH_MERGE_RE=$'(^|[;&|(`\n]|\\$\\()[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*((env|command|exec)[[:space:]]+)*([^[:space:];&|()`]*/)?gh([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)'
if [[ "$event" == PreToolUse && "${tool:-}" == Bash && "$payload" == *merge* \
      && "$pre_json" != *'"permissionDecision":"deny"'* ]]; then
  mcmd=$(jq -r 'if .tool_name == "Bash" then (.tool_input.command // "") else "" end' \
    <<<"$payload" 2>/dev/null) || mcmd=""
  if [[ -n "$mcmd" && "$mcmd" =~ $GH_MERGE_RE ]] && _ct_read "$REG/$id.hold" \
     && (( ${#CT_V} <= CCRC_HOLD_MAX )) && [[ "$CT_V" =~ $CCRC_HOLD_WAVE_RE ]]; then
    mreason="ccrc: this workspace's hold reads \`$CT_V\` — a programme wave's session, and a wave's session never merges (landing-order R5: the coordinator merges, workers never do)."
    mreason+=" Report wave-done to your coordinator; it lands the PR."
    pre_json=$(_hook_deny_json "$mreason") || pre_json=""
  fi
fi

```

(The block ends with one blank line, so the subagent block keeps its blank separator.) The deny is PRINTED at the file's one PreToolUse print site, after the hookstate rename — so, like the graph gate's, a registry the hook cannot write prints nothing (the file's standing fail-open).

- [ ] **Step 5: Pay (and prove) the citation tax — the hook-aware instrument**

```bash
SCRATCH=<your scratchpad, absolute>
bash -n ccd/session-hook.sh && echo syntax-ok
git diff --numstat -- ccd/session-hook.sh
python3 "$SCRATCH/cite-remeasure-hook.py" "$SCRATCH" HEAD
```

Expected (measured on the prototype at `905360dc`): `syntax-ok`; `57	14	ccd/session-hook.sh` (the 43-line deny block below the graph gate; the three in-place edits balance); `stated == base == tree` on all four lines (`147 / 195 / 53 / 35`), `other byFile keys moved: none`, every `ENTERED`/`LEFT` empty. On a tree carrying wave 1 the numstat differs by nothing (this task's own lines) and the census is whatever wave 1 left, unmoved.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook-merge-deny.test.ts
./node_modules/.bin/vitest run test/run-routes.test.ts -t 'binds the shared cap'
./node_modules/.bin/vitest run test/session-hook.test.ts
./node_modules/.bin/vitest run test/ask-instance-guard.test.ts test/install-session-hooks.test.ts test/hookstate.test.ts
```

Expected (measured on the prototype): `7 passed (7)`; `1 passed | 220 skipped`; `333 passed (333)` (≈110 s — every hold-card case still speaks through the hoisted grammar; the citation cases are green); PASS (measured as `75 passed` for these three files plus `mail-hardening.test.ts` in one run).

- [ ] **Step 7: Mutation check, then commit**

Ten mutations, each restored from a saved copy (`cp ccd/session-hook.sh "$SCRATCH/hook.task4"` after Step 6; restore with `cp`). Every red below was measured on the prototype, except row H8, which needs wave 1's advisory:

| # | Exact edit in `ccd/session-hook.sh` | Command (from `server/`) | Expected red |
|---|---|---|---|
| H1 | `    pre_json=$(_hook_deny_json "$mreason") \|\| pre_json=""` → `    :` | `./node_modules/.bin/vitest run test/session-hook-merge-deny.test.ts` | `4 failed \| 3 passed` — `a wave session's gh pr merge went through: expected null not to be null`, `not denied: gh pr merge 42 --squash …` |
| H2 | the hold is read, never judged: ` && _ct_read "$REG/$id.hold" \`⏎`     && (( ${#CT_V} <= CCRC_HOLD_MAX )) && [[ "$CT_V" =~ $CCRC_HOLD_WAVE_RE ]]; then` → ` && { _ct_read "$REG/$id.hold"; true; }; then` | same | `2 failed` — "lets a coordinator's plain enqueue through…" (`expected 'ccrc: this workspace\'s hold reads ``…' to be null`) and "lets a hold that names no programme wave through…" (`a hand hold is not a worker wave`). (Deleting the predicate OUTRIGHT crashes the hook under `set -u` — exit 1, a red for the wrong reason; Pre-flight finding 7.) |
| H3 | delete `(( ${#CT_V} <= CCRC_HOLD_MAX )) && ` | same | "lets a hold that names no programme wave through…" only — `an oversized hold is unspeakable, never a wave: expected 'ccrc: this workspace\'s hold reads \`p…' to be null` |
| H4 | `[[ "$CT_V" =~ $CCRC_HOLD_WAVE_RE ]]; then` (in the deny) → `[[ -n "$CT_V" ]]; then` | same | same case — `a hand hold is not a worker wave: expected 'ccrc: this workspace\'s hold reads \`o…' to be null` |
| H5 | unanchored: `GH_MERGE_RE=$'(^\|[;&\|(`\n]\|\\$\\()[[:space:]]*` → `GH_MERGE_RE=$'[[:space:]]*` | same | "leaves every other gh…" only — `denied: echo "gh pr merge 42": expected 'ccrc: …' to be null` |
| H6 | no global-flag arm: `gh([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+pr` → `gh[[:space:]]+pr` | same | "refuses every spelling…" only — `not denied: gh -R owner/repo pr merge 42: expected null not to be null` |
| H7 | no path-prefix arm: `((env\|command\|exec)[[:space:]]+)*([^[:space:];&\|()`]*/)?gh(` → `((env\|command\|exec)[[:space:]]+)*gh(` | same | same case — `not denied: /usr/bin/gh pr merge 42: expected null not to be null` |
| H8 | a deny no longer supersedes advice: `&& "$pre_json" != *'"permissionDecision":"deny"'* ]]; then` → `&& -z "$pre_json" ]]; then` | same | **UNMEASURED at `905360dc`** — nothing on that tree puts a non-deny envelope on a Bash call, so this row is green there. Measure it on this branch (wave 1 merged): the expected red is "a deny supersedes a sync advisory…" — `the advisory won and the merge went through` or the one-line assertion. If it stays GREEN on the wave-1 tree, wave 1's advisory does not fire on `git merge origin/main && …`: report the measured command set rather than weakening the case. |
| C1 | `_hook_hold_card`: `  [[ "$h" =~ $CCRC_HOLD_WAVE_RE ]] \|\| return 0` → the old inline regex line | `./node_modules/.bin/vitest run test/run-routes.test.ts -t 'binds the shared cap'` | `1 failed` — `expected '#!/usr/bin/env bash\n# session-hook.s…' to contain '[[ "$h" =~ $CCRC_HOLD_WAVE_RE ]] \|\| r…'` |
| C2 | `CCRC_HOLD_WAVE_RE='^program:[A-Za-z0-9._-]+ wave:[0-9]+(/[0-9]+)?( run:[0-9]+)?$'` → `CCRC_HOLD_WAVE_RE='^program:[A-Za-z0-9._-]+ wave:'` | same | `1 failed` — `… to contain 'CCRC_HOLD_WAVE_RE=\'^program:[A-Za-z0…'` |

```bash
git add ccd/session-hook.sh server/test/run-routes.test.ts server/test/session-hook-merge-deny.test.ts
git commit -m "$(cat <<'MSG'
feat(hook): deny gh pr merge to a programme wave's session

The coordinator merges, workers never do (landing-order R5). Once the
operator sets approvals to 0, a plain `gh pr merge` from any session holding
the fleet's login would land, so the PreToolUse arm now denies it wherever a
command head spells it — after ; & | ( a backtick or $(, past VAR=value
prefixes, env/command/exec, a path to the binary, and gh's global flags —
in a session whose hold is whole (<= CCRC_HOLD_MAX) and names a programme
wave. No hold, a hand hold, an unreadable or oversized one: passes, so the
coordinator's plain `gh pr merge <n>` enqueues. A deny replaces an advisory
on the same call and never replaces the graph gate's counted deny. A merge
inside a quoted string is not parsed: the hook is a contract, not an access
boundary (spec §4). The every-session --admin deny and the gh api merge deny
are wave 2b's, after the proof run.

The hold grammar is spelled ONCE now, CCRC_HOLD_WAVE_RE, read by the card and
the deny; run-routes.test.ts pins it where it is assigned. The assignment and
two in-place edits are line-neutral and the deny sits below the graph gate:
census 147 / 195 / 53 / 35 unmoved (the hook-aware re-measurer).
MSG
)"
```

---

### Task 5: Coordinator clause 15 names the native queue

**Model routing:** `sonnet`, effort `medium`. One sentence, pinned verbatim.

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md` — the end of clause 15 (wave 1's)
- Modify: `server/test/coordinator-skill.test.ts` — the matching `CONTRACT` element

**Interfaces:**
- Consumes: wave 1's clause 15 (the coordinator never calls `update-branch`, never writes rulesets, protection or auto-merge…), pinned verbatim in `CONTRACT`.
- Produces: the sentence the dequeue notice (Task 3) points at — "On a native-queue project, landing is `gh pr merge <n>` with no `--admin`, which enqueues." Wave 2b's deny makes `--admin` a mechanism for every session; this sentence is what makes the plain spelling the coordinator's.

- [ ] **Step 1: Locate clause 15, in both files, by content**

```bash
grep -n '^15\. ' ccd/coordinator-skill/SKILL.md
awk '/^const CONTRACT = \[/,/^\];/' server/test/coordinator-skill.test.ts | grep -n 'update-branch'
```

Expected: exactly one line in `SKILL.md` (the whole clause is that one line, like clauses 1–14); exactly one `CONTRACT` element mentioning `update-branch` — the fifteenth, wave 1's clause 15. If either answers zero or two, stop and report: the clause's shape is not what this step assumes.

- [ ] **Step 2: Append the sentence to clause 15 — same line, both files, one commit**

In `ccd/coordinator-skill/SKILL.md`, append to the END of the `15. …` line (after its final period, one space first):

```
 On a native-queue project, landing is `gh pr merge <n>` with no `--admin`, which enqueues.
```

In `server/test/coordinator-skill.test.ts`, append the same text — the same leading space — to the fifteenth `CONTRACT` string, immediately before its closing quote, inside whichever quote character that element already uses (it contains no `'` of its own in this sentence, so either quote style takes it unchanged). The count words ("These fifteen sentences", README's and `CLAUDE.md`'s) do not move: no clause is added.

- [ ] **Step 3: Run the test to verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
```

Expected: PASS, with the same test total the file had on this branch before the edit (147 at `905360dc`, plus whatever wave 1 added).

- [ ] **Step 4: Mutation check, then commit**

Two mutations, restored from a saved copy of `SKILL.md`. **Measured on a stand-in at `905360dc`**, where clause 15 does not exist: the same sentence appended to clause 14 in both files (147/147 green), then each edit below applied to `SKILL.md`. On this branch the red names clause 15's first 48 characters instead of clause 14's:

| # | Exact edit in `ccd/coordinator-skill/SKILL.md` | Command (from `server/`) | Expected red |
|---|---|---|---|
| S1 | delete ` On a native-queue project, landing is \`gh pr merge <n>\` with no \`--admin\`, which enqueues.` | `./node_modules/.bin/vitest run test/coordinator-skill.test.ts` | "carries all fifteen clauses verbatim" (the case's title after wave 1) only — `missing contract clause: <clause 15's first 48 characters>…` (stand-in: `missing contract clause: The review brief names the held-out panel in \`re…`) |
| S2 | soften it: `with no \`--admin\`, which enqueues.` → `which enqueues.` | same | same case, same red |

```bash
git add ccd/coordinator-skill/SKILL.md server/test/coordinator-skill.test.ts
git commit -m "$(cat <<'MSG'
skill(coordinator): clause 15 — on a native-queue project, landing is gh pr merge <n>, no --admin

Spec §5.2: a plain `gh pr merge <n>` enqueues on a project whose main requires
the merge queue, and the queue is the composition test. Appended to clause 15
and to its verbatim pin in the same commit; the clause count is unchanged.
MSG
)"
```

---

### Task 6: Whole-branch verification, the PR — and the SERVER-FIRST deploy

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified — this task runs, measures, opens the PR and hands over the deploy.

**Interfaces:**
- Consumes: everything Tasks 1–5 produced.
- Produces: the wave-2 PR on this workspace's own branch and a wave-done report. Task 7 (the operator) consumes the merged, rolled-out build.

- [ ] **Step 1: Run all three package suites, in the foreground, one process at a time**

```bash
cd server && npm ci
./node_modules/.bin/vitest run --shard=1/12     # … then 2/12, 3/12, … 12/12, one call each
cd ../agent && npm ci && npm run test
cd ../pwa   && npm ci && npm run test
```

Expected: PASS everywhere. `agent` is untouched and must be green unchanged. Report the twelve shard summaries and their sum. If ANY shard is killed by the 600 s ceiling, re-run the WHOLE server suite as `--shard=k/24`, k = 1…24. Re-run any known load flake IN ISOLATION before calling it a break.

- [ ] **Step 2: Cross-tree guards, and the corpus premise**

```bash
git fetch origin main && cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts
cd .. && git diff --quiet origin/main -- \
  docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen
```

Expected: PASS, and `corpus-frozen`. If `origin/main` moved `ccd/ccd`, `ccd/session-hook.sh`, `README.md` or `ci.yml` since Task 4, merge it, re-run Tasks 2 and 4's tax steps against the merge's first parent, re-run the citation cases, and resolve any `ci.yml` overlap with CI test selection by the Global Constraints' rule — never by dropping either side's shape.

- [ ] **Step 3: The wave's own surface in one run**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-merge-queue.test.ts test/oss-metadata.test.ts \
  test/ccd-pr-queue.test.ts test/pr-timeout-budget.test.ts test/remote-runner.test.ts test/ownership.test.ts
./node_modules/.bin/vitest run test/pr-queue-lane.test.ts test/pr-sweep.test.ts test/prstate.test.ts
./node_modules/.bin/vitest run test/session-hook-merge-deny.test.ts test/coordinator-skill.test.ts
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected: PASS. If `ownership` reds, `ccd/ccd` was edited after the last re-stamp.

- [ ] **Step 4: Confirm the author, push, and open the PR**

```bash
git log --format='%an <%ae>' "$(git merge-base origin/main HEAD)"..HEAD | sort -u
```

Expected: exactly one line, the identity this workspace commits as. The pre-push hook refuses identity residue; if it does, fix the author, do not bypass the hook.

```bash
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Landing order wave 2: the native merge queue's repository half (SERVER-FIRST)" --body-file - <<'EOF'
Wave 2 of the landing-order programme (spec `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` §5.2, repository code). **SERVER-FIRST.** Changes NO repository setting — the queue ruleset, approvals to 0 and the proof run are the operator's, after this merges (the plan's Task 7).

What it does:

1. **`ci.yml`** — `merge_group` beside `pull_request`, so a queue entry gets its required checks; `test-macos` and `probe-macos` skip a queue run (and `ci-merge-queue.test.ts` pins that NO other job mentions `merge_group`, because a job skipped by `if:` reports as passing); a `concurrency` group `ci-<workflow>-pr-<number>` cancels a superseded PR run, and every other event gets a run-unique group (one pending run per group).
2. **`ccd pr-state --project`** — ONE GraphQL query per repository per sweep (open PRs' `mergeQueueEntry`, the 20 most recent merged, each with its last queue act of either kind), own 4 s timeout, `-f` variables, answering `queued | dequeued | landed | none | unmeasured` in an additive `queue` field (+ `queueAt`). A failed or garbled read says `unmeasured` and never touches a row, phase or checks value. The server's `pr-state` bound rises 20 s → 25 s so the three timeouts keep the budget test's 30 % for the local loop.
3. **Server** — `queueFor`, the one reader (`absent` for an older ccd, kept apart from `unmeasured`); `sweepDequeued` records a `queue` feed event (the eighth `NotifyEvent` kind, additive) and mails the run's coordinator `dequeued:#<n>` once per removal — never a guessed coordinator. Nothing enqueues or merges.
4. **Hook** — PreToolUse denies `gh pr merge` at any parseable command head in a session whose hold names a programme wave; the coordinator's plain `gh pr merge <n>` passes. The hold grammar is spelled once (`CCRC_HOLD_WAVE_RE`).
5. **Coordinator clause 15** — "On a native-queue project, landing is `gh pr merge <n>` with no `--admin`, which enqueues."

Citation corpus (S6-R11): every added line sits below the frozen anchors; census 147 / 195 / 53 / 35 unmoved, README untouched. No `FLEET_PROTO` bump.

Out of scope: wave 2b — the every-session `--admin` deny and the `gh api` merge deny, after the operator's ruleset and proof run.

**Deploy: `ccrc rollout --to <this merge's tag> --server-first`.**

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 5: Report (the wave-done mail)**

Report to the coordinator, per the worker skill: the branch tip sha; the three suites' results (the twelve server shard summaries and their sum); Tasks 2 and 4's instrument outputs (re-pointer lines, census composition); every mutation row's measured red, including H8's result on this branch (Task 4); S1/S2's reds as measured on clause 15; every departure from this plan, named by what it is (the coordinator assigns numbers — see `## Deviations found`). Then stop: the deploy below runs after the merge, by whoever merges.

- [ ] **Step 6: Deploy — SERVER FIRST (post-merge, from a machine holding `~/.ccrc/deploy.env`)**

(a)+(b) Find the release THIS PR's merge produced and roll the fleet to exactly that build, server box first — one block, because the tag must be computed in the same shell that uses it:

```bash
PR=<this wave's PR number>
git fetch origin main --tags
M=$(gh pr view "$PR" --json mergeCommit -q .mergeCommit.oid)
TAG=$(git tag --points-at "$M" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
echo "merge: $M  tag: ${TAG:-<none yet>}"
if [ -n "$M" ] && [ -n "$TAG" ]; then
  ccrc rollout --to "$TAG" --server-first
  echo "rollout rc=$?"
  ccrc rollout --check
else
  echo "STOP: no release tag on this PR's merge commit yet — wait for release-main.yml and re-run this block"
fi
```

Expected: `merge: <sha>  tag: vX.Y.Z`, then both boxes report that tag, converged. A rollout exits 3 when a box moved but its doctor has FAIL lines — read them first.

(c) Prove the fleet box carries both halves — READ-ONLY, on the fleet box:

```bash
grep -c '^GH_MERGE_RE=' "$HOME/.cc-sessions/session-hook.sh"
grep -c '^PR_GH_QUEUE_TIMEOUT=4$' "$HOME/.local/bin/ccd"
```

Expected: `1` and `1`. A `0` means the fleet box did not take the build — stop; the server is harmless without it (it reads `absent`), but no worker is denied a merge.

Rolling back, if ever needed: `ccrc update --to <the previous tag> --downgrade` on each box, fleet box first (the reverse of the reader-widening order).

---

### Task 7: The operator's post-merge runbook — the queue ruleset, approvals to 0, break-glass, and the proof run (NOT code)

**Who:** the operator, from their own shell or GitHub's UI. **Not a worker and not the coordinator** (coordinator clause 15: never writes rulesets or protection). Every read below is read-only; the two writes are marked.

**Interfaces:**
- Consumes: Task 6's merged and rolled-out build (`merge_group` on `main`'s `ci.yml`, the queue read, the dequeue lane, the worker deny).
- Produces: the measured go/no-go for wave 2b, written into `docs/superpowers/programs/landing-order.md` by the coordinator.

Every `gh api` path below uses `{owner}/{repo}`, which `gh` fills in from the checkout it runs in — run each block from inside a checkout of this repository.

- [ ] **Step 1: Preconditions — measured, read-only**

```bash
git fetch origin main
git show origin/main:.github/workflows/ci.yml | grep -c '^  merge_group:$'
gh run list --workflow ci.yml --branch main --event push --limit 1 --json conclusion,headSha --jq '.[0]'
ccrc rollout --check
```

Expected: `1`; the newest push run on `main` concluded `success`; both boxes converged on this wave's tag or later. **Stop if the first answers `0`** — enabling the queue before `merge_group` is on `main` leaves every entry waiting for checks that never report (spec §5.2 rollout step 1 before step 2).

- [ ] **Step 2: Read the settings as they stand**

```bash
gh api 'repos/{owner}/{repo}/rulesets' --jq '.[] | [.id, .name, .enforcement, (.conditions.ref_name.include | join(","))] | @tsv'
RS=$(gh api 'repos/{owner}/{repo}/rulesets' --jq '.[] | select(.conditions.ref_name.include == ["refs/heads/main"]) | .id')
echo "main ruleset: $RS"
gh api "repos/{owner}/{repo}/rulesets/$RS" --jq '{bypass: .bypass_actors, rules: [.rules[] | {type, parameters}]}'
gh api 'repos/{owner}/{repo}/branches/main/protection' \
  --jq '{strict: .required_status_checks.strict, contexts: .required_status_checks.contexts, enforce_admins: .enforce_admins.enabled, approvals: .required_pull_request_reviews.required_approving_review_count}'
gh api 'repos/{owner}/{repo}' --jq '{allow_squash_merge, allow_auto_merge, allow_update_branch, delete_branch_on_merge}'
```

Expected (measured 2026-09-23): two rulesets, one on `refs/heads/main` and one on `refs/heads/stable`; the main ruleset's ONE rule is `pull_request` with `required_approving_review_count: 1`, and its bypass actors are `RepositoryRole` 5 (admin) and `RepositoryRole` 2 (maintain), both `pull_request` mode; classic protection `strict: false`, the four contexts `test (server)`, `test (agent)`, `test (pwa)`, `build-pwa`, `enforce_admins: true`, approvals 0; `allow_squash_merge: true`, `allow_auto_merge: false`, `allow_update_branch: false`, `delete_branch_on_merge: true`. Save the ruleset before touching it: `gh api "repos/{owner}/{repo}/rulesets/$RS" > ruleset-before.json`. **Stop on any difference you did not make** — somebody else changed the settings, and this runbook was measured against the values above.

- [ ] **Step 3: Decide R9's bypass set — the one decision this runbook needs from the operator**

R9 (spec §3): "the repository-admin role STAYS the ruleset's only bypass actor". Measured, the main ruleset has TWO bypass actors — admin and maintain. The transform in Step 4 implements R9 as written (admin only). If the maintain role's bypass is to be kept, delete the `bypass_actors:` line from the Step 4 transform, and record that ruling in the programme ledger before applying.

- [ ] **Step 4: WRITE — require the queue, approvals to 0 (operator only)**

Either in GitHub's UI (Settings → Rules → Rulesets → the `main` ruleset: under "Require a pull request before merging" set required approvals to 0; enable "Require merge queue" with merge method Squash, build concurrency 1, minimum and maximum group size 1, wait time 0, "only merge non-failing pull requests", status-check timeout 60 minutes; bypass list per Step 3), or from the operator's own shell:

```bash
RS=$(gh api 'repos/{owner}/{repo}/rulesets' --jq '.[] | select(.conditions.ref_name.include == ["refs/heads/main"]) | .id')
gh api "repos/{owner}/{repo}/rulesets/$RS" > ruleset-before.json
jq '{name, target, enforcement, conditions,
     bypass_actors: [.bypass_actors[] | select(.actor_type == "RepositoryRole" and .actor_id == 5)],
     rules: ([.rules[] | select(.type != "merge_queue")
              | if .type == "pull_request" then .parameters.required_approving_review_count = 0 else . end]
             + [{type: "merge_queue", parameters: {merge_method: "SQUASH", max_entries_to_build: 1,
                 min_entries_to_merge: 1, max_entries_to_merge: 1, min_entries_to_merge_wait_minutes: 0,
                 grouping_strategy: "ALLGREEN", check_response_timeout_minutes: 60}}])}' \
  ruleset-before.json > ruleset-after.json
diff <(jq -S . ruleset-before.json) <(jq -S . ruleset-after.json)
gh api -X PUT "repos/{owner}/{repo}/rulesets/$RS" --input ruleset-after.json --jq '{id, rules: [.rules[].type], bypass: .bypass_actors}'
```

Expected: the diff shows exactly three changes — the approval count 1 → 0, the `merge_queue` rule added, the maintain bypass removed (or kept, per Step 3) — and the PUT answers the ruleset with `rules: ["pull_request","merge_queue"]`. The `merge_queue` parameter names are GitHub's REST ruleset schema; they were NOT exercised while planning (no write was made). If the PUT refuses a parameter, use the UI and re-read with Step 2's third command. Keep `ruleset-before.json`: `gh api -X PUT … --input ruleset-before.json` (after stripping its read-only keys the same way) is the rollback.

- [ ] **Step 5: THE PROOF RUN — spec §5.2 rollout step 3, stage 2's own gate**

Make two or three TRIVIAL PRs from fleet workspaces (so `is_ours` has a workspace to bind — e.g. three `ws-add` workspaces, each committing a one-line change to a different line of a doc file nothing pins), wait for each PR's own CI to go green, then enqueue all of them within a minute, from a session with no wave hold or from the operator's shell:

```bash
for n in <pr-a> <pr-b> <pr-c>; do gh pr merge "$n"; done
```

Expected: each answers that the PR was added to the merge queue. Then measure, read-only:

(a) **Queued, then landed, one at a time** — on the fleet box, the same call the server's sweep makes every 120 s:

```bash
ccd pr-state --project <this project> | python3 -c 'import json,sys
for l in sys.stdin:
    if l.strip():
        v = json.loads(l); print(v.get("id"), v.get("number"), v.get("phase"), v.get("queue"), v.get("queueAt"))'
```

Expected: while waiting, the three workspaces read `open … queued <time>`; after each lands, `merged … landed`.

(b) **One push, one CI push run and one prerelease PER MERGE:**

```bash
git fetch origin main --tags
git log --first-parent --format='%H %s' -4 origin/main
for sha in $(git log --first-parent --format=%H -3 origin/main); do
  echo "$sha tag=$(git tag --points-at "$sha" | tr '\n' ' ')"
done
gh run list --workflow ci.yml --branch main --event push --limit 4 --json headSha,conclusion,createdAt
gh run list --workflow release-main.yml --limit 4 --json headSha,conclusion,createdAt
gh release list --limit 4
```

Expected: the three newest first-parent commits on `main` are the three squashed PRs, one each; each carries its own `vX.Y.Z` tag; there is one `ci` push run and one `release-main` run per sha; three new prereleases.

(c) **The queue's own CI run, macOS skipped:**

```bash
gh run list --workflow ci.yml --event merge_group --limit 3 --json databaseId,conclusion,headBranch
gh run view <one merge_group run id> --json jobs --jq '.jobs[] | [.name, .conclusion] | @tsv'
```

Expected: three `merge_group` runs, `success`; in each, `test (server)`, `test (agent)`, `test (pwa)` and `build-pwa` `success`, `test-macos` and `probe-macos` `skipped`.

(d) **`is_ours` still binds after a queue merge** — for each workspace, on the fleet box:

```bash
ccd pr-state --session <workspace id> | python3 -c 'import json,sys; v=json.loads(sys.stdin.readline()); print(v["phase"], v["number"], v.get("reason"))'
```

Expected: `merged <its PR number> None` for all three — never `unknown merge-unproven`, never `none`.

(e) **The dequeue lane** — enqueue a fourth trivial PR and remove it from the queue in GitHub's UI ("Remove from queue") before it lands; within one sweep (≤ 120 s):

```bash
~/.local/bin/ccrc-api feed list --limit 10
```

Expected: one `queue` event titled `⤺ dequeued › <workspace>`; and, if that workspace belongs to an open run, its coordinator received a `status` mail `dequeued:#<n>`. Close the fourth PR afterwards.

(f) **A worker cannot merge** — in a session whose workspace hold names a programme wave (a live worker's, or a scratch workspace held with `POST /api/sessions/:id/hold` and a `program:<slug> wave:1/1` reason, released afterwards), ask the session to run `gh pr merge <any closed PR number>`. Expected: the tool call is refused with `ccrc: this workspace's hold reads …`.

- [ ] **Step 6: Stop rules**

Stop, report to the coordinator, and do NOT plan or dispatch wave 2b if any of these holds:

1. **A single push to `main` carried more than one commit** (b), or a merge sha has no tag: the group settings did not take. Keep group size and build concurrency at 1 and re-run the proof; if they ARE 1, `release-main.sh` must tag every commit in the pushed range before the queue is used (spec §5.2 step 3) — a new wave.
2. **`is_ours` failed to bind** after a queue merge (d): a finding against `pr-state`; the queue stays on only if the operator rules so.
3. **A `merge_group` run failed for a reason that is not the PR's own** (c) — e.g. a guard that needs a base the queue checkout does not have. Roll back: re-apply `ruleset-before.json` (queue off, approvals 1). Landing returns to `--admin` exactly as before this runbook, because the every-session `--admin` deny (wave 2b) is not live.
4. **`gh pr merge <n>` (no `--admin`) was refused as needing an approval**: Step 4 did not take; re-read with Step 2.
5. **An entry sat queued past the status-check timeout**: the required contexts are not reporting on `merge_group`; roll back as in 3.

- [ ] **Step 7: Record the result**

The coordinator writes the proof run's measured answers — (a) through (f), with the run ids, shas, tags and times — into `docs/superpowers/programs/landing-order.md` under "Decisions & deviations", on its own ledger PR (coordinator clause 15), and the wave-2 row's state. Wave 2b is planned only on a clean proof; it is the deny on `--admin` in every fleet session and on a `gh api` call to the pulls merge endpoint.

---

## Deviations found

Numbers are ISSUED, never chosen. This programme's deviation block is allocated by the programme coordinator, per wave, at that wave's run-open; **a worker never calls the allocator** (worker clause 11). A departure from this plan found while executing it is named in the wave-done mail — what departed, where, and why — and the coordinator assigns its number from the block and defines it here in the same act. A session that cannot reach the coordinator writes `D-TBD-<slug>` in its report and nowhere in a committed file (`dtbd.test.ts` reds the concrete form).

Two deliberate absences: no block is written as a range, and no headroom accounting lives in this plan.

The pre-flight findings above are not deviations: they were measured before this plan existed and shaped it. The places where this plan departs from the spec's literal text — the last queue act of EITHER kind rather than the last removal alone (finding 3), the outer bound raised to 25 s (finding 1), the eighth `NotifyEvent` kind (finding 5), and the `operator` role as the dequeue notice's sender — are argued there and at the code, and are the reviewer's to weigh against the spec.

---

## Review lenses

Three lenses for this wave, all `opus`, effort `high` — a nineteen-file diff (the File Structure table: eleven shipped files and eight test files), sized per the fleet policy (3–5 reviewers for a 4-file PR; three concerns cover this diff because most of it is tests each lens reads against its own concern), one `sonnet` refute pass per finding. The hook is the gate R5 leans on, so lens 2 reads it as security-sensitive.

1. **The queue read and its wire (opus, high).** `_gh_pr_queue` sends one constant document with `-f` variables only, under `PR_GH_QUEUE_TIMEOUT`, and only in `--project`; the stamp buffers and falls back to the unstamped lines on its own failure, never costs a row, phase or `checks`, and says `unmeasured` — never `none` — for a read that did not happen; the five words are derived the way the spec's §5.2 intends, with the last act of either kind; `queueAt` is shape-gated before it reaches a latch key; `queueFor` is the ONE reader and keeps `absent` apart from `unmeasured`; the budget test sums THREE timeouts and the 25 s bound is argued; the server-first deploy order matches `CLAUDE.md`'s reader-widening rule; no `FLEET_PROTO` bump, no `PrState` change.
2. **The worker merge deny and the dequeue lane's authority (opus, high, security-sensitive).** The deny fires at every command head the regex claims and on no mention (the pass list); a hold is a wave only if whole (≤ `CCRC_HOLD_MAX`) and matching `CCRC_HOLD_WAVE_RE` — the card's own reader, bound and grammar, spelled once; a deny replaces advice and never the graph gate's counted deny; exit 0 and a silent stderr on every path; what it does NOT stop is stated in its header (quoted strings; `--admin` and `gh api` for non-workers are wave 2b's). The dequeue lane enqueues, merges and re-runs nothing; it mails only a coordinator an open run names, never `resolveCoordinator(null)`'s guess; its mail body carries no GitHub-sourced string.
3. **CI shape, guard fidelity and the citation tax (opus, high).** Every mutation row really mutates the guard it names and reds for the stated reason (H2's `set -u` crash is the counter-example the plan already fixed; H8 is measured on the wave-1 tree); `ci-merge-queue.test.ts` derives the macOS set from `runs-on` and forbids `merge_group` on every other job; the concurrency groups cannot drop a queue run; the CI test selection overlap is handled by merging shapes; the census stayed `147 / 195 / 53 / 35` with the hook-aware instrument, `shared/api.ts` changed in place, README untouched; Task 7's commands are read-only except the two marked writes, name no owner, and its stop rules cover every proof-run failure the spec names.
