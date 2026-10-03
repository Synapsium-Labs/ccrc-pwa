# Landing order, wave 2 — GitHub's native merge queue, repository code (SERVER-FIRST) Implementation Plan

> **Status: re-planned 2026-09-29 on `main` `6da36f0b`; ready to dispatch once wave 1 has merged.** Tasks 1 and 3–5, Task 6's PR body and counts, and Task 7's precondition and proof run were rewritten; Task 2 is unchanged but for what `6da36f0b` moved — its line hints, two more statements of the old bound, and the census (Pre-flight findings 14, 15 and 17). Why: CI test selection (#183) landed first and reshaped `ci.yml`, so Task 1 now merges into that shape, and a push to `main` no longer tests anything, so Task 7 reads main's health from a full run. Child-reclamation wave 3 (#187) reclaims a producer's workspace when its run closes, so on a native-queue project the producer now LANDS BEFORE IT CLOSES (Task 5): its run waits at `merging`, holding the child, so the dequeue lane (Task 3) still has an open run, a registry row and a `pr-state` line to read, and the merge deny (Task 4) still has a hold — and a child marker besides, for the window after any close. Every landing spelling keeps #178's `--match-head-commit <handoffCommit>`. Every count below was measured on a copy of `6da36f0b` with wave 1 applied first, from wave 1's own code blocks, then this plan's, one task at a time. It implements two operator rulings: **2026-09-23** (CI runs the selected tests on a pull request, and the full suite daily and at the stable gate; there is no full run per merge) and **2026-09-28** (a merge-queue run runs the selected tests, like a pull request).

> **Fix round, 2026-09-29.** Three independent reviews of this re-plan (correctness, tests and mutations, executability) found 21 defects, one a blocker: gh 2.45 ARMS auto-merge, rather than queueing, a PR whose required checks have not passed, and prints the same success line — so a landing could stall silently at `merging` (Pre-flight finding 20). Every finding is applied. The landing rule now measures whether the project requires the queue, enqueues only once the required checks passed, reads the queue entry back, disarms what only armed and before any fix round, and covers the programme's last wave; a coordinator the hook refuses goes to the operator's shell; the hook's quote strip reads `#` comments and backslash escapes as bash does; the dequeue brief reads the queue's own CI run; three guards the plan argued for gained cases; the runbook's census fails closed and catches a held coordinator, and the proof run measures the armed path. The operator ruled the re-plan's four open questions as it defaulted (Global Constraints). Every count and mutation row the fixes touch, or could move, was re-measured on a fresh prototype built from this plan's own blocks — wave 1 first, then Tasks 1–5, one task at a time, tests before code.

> **Main moved before this plan merged (checked 2026-09-29 at `cf24e4be`).** Task 1 was re-applied there from this plan's own blocks after CI selection went from shadow to enforced (#211) and the macOS shards were rebuilt (#204): every red-first and green count above reproduced (`ci-merge-queue` 4|1 then 5, `ci-pipeline` 5|34 then 39, `ci-select-cli` 2|39 then 41, `ci-verdict` 4523, `oss-metadata` 22, `ci-main-artifact` 16) and the file loads as YAML. Since `6da36f0b`, `main` has also changed `ccd/ccd` (#207, #208, #209 — exact tmux targets among them) and `server/src/watch.ts`, which Tasks 2–5 edit, and `ccd/ccrc`, which wave 1 edits. This wave dispatches only after wave 1 has merged, so the dispatching coordinator's first act is to re-measure Tasks 2–5 on the `main` it cuts the workspace from: anchors are located by content, and a count that differs with every case passing is not a red.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make this repository ready for GitHub's native merge queue, and make the queue's silent outcomes loud, without changing a single repository setting. `ci.yml` answers `merge_group`, and a queue run runs what a pull request runs — the selected server tests and every other required leg, the plain-bash pipeline check included — in a concurrency group of its own, with no macOS leg and no `full-suite`. `ccd pr-state --project` makes ONE GraphQL query per repository per sweep, under its own timeout, and stamps every full line with an additive `queue` word (`queued | dequeued | landed | none | unmeasured`). The server tells the coordinator of the open run that names the workspace both landing outcomes, once each, across a server restart too, and never latched as told when the read or the mail failed: a `dequeued` reading becomes a `queue` feed record and a `status` mail, and a merge while that run waits at `merging` becomes a `status` mail. The session hook DENIES `gh pr merge` to any session whose hold names a programme wave, and to any workspace that carries the child marker; the coordinator's `gh pr merge <n> --match-head-commit <handoffCommit>` passes and enqueues. Coordinator clause 15 and the lifecycle reference say how the coordinator lands: that spelling, no `--squash`, no `--admin`, only once the PR's required checks have passed and with its queue entry read back, and the producer lands before it closes — the last wave's too. The last task is the operator's post-merge runbook: the queue ruleset, approvals to 0, R9's break-glass, and the proof run that gates wave 2b.

**Architecture:** Six mechanisms, each with a test that reds when it is deleted or mutated. (1) `ci.yml` and CI selection's two modules: a `merge_group` trigger and mode-table row; `merge_group` joins the `pull_request` arm of `decideMode`, `modeInvariantViolation` (`.github/ci/select.mjs`) and `serverVerdict` (`.github/ci/verdict.mjs`); the pipeline check asks a queue run the pull request's question against `merge_group.base_sha`; ONE arm in the existing concurrency group, `queue-<run id>`, ahead of the shared `refresh` group and never cancelled; and a leading `github.event_name != 'merge_group'` conjunct on `test-macos`'s and `full-suite`'s existing `if:`. (2) `ccd/ccd`: `_gh_pr_queue` (one constant GraphQL document — the hundred NEWEST open PRs, `gh pr list`'s own order — `-f` variables, `PR_GH_QUEUE_TIMEOUT`), `_pr_queue_stamp` and `_pr_queue_py`, placed below `cmd_clip` and below ws-reap's mirror block, beneath every frozen citation anchor, wired into `cmd_pr_state` by ONE in-place line; the stamp buffers the sweep and falls back to the unstamped lines on any failure of its own. The server's outer bound on `pr-state` rises 20 s → 25 s so the three calls' timeouts still leave `pr-timeout-budget.test.ts`'s 30 % for the local loop. (3) `server/src/prstate.ts`: `queueFor(line)`, the ONE reader of `queue`/`queueAt`, answering the five words plus `absent` (a line from an older ccd or from `--session`, never folded into `unmeasured`). (4) `server/src/watch.ts`: `sweepLanding`, after `sweepMerged` — the recipient is the coordinator of the open run `survivorOf` picks from the runs that name the workspace; a `dequeued` reading is a `status` mail `dequeued:#<n>@<queueAt>` and a `queue` feed record (the record alone when no open run names it, never a guessed coordinator), and a merge while that run waits at `merging` is a `status` mail `merged:#<n>`; an in-memory latch written only after the notice landed, a DURABLE "already told" read (`CoordStore.hasMailWithSubject`, every delivery state; `CoordStore.hasFeedEvent` for the feed-only arm), unreadable run rows deferred rather than folded into "no open run", and the mail queued BEFORE the record so a thrown mail is retried without a second record. The two subjects are spelled once, in `rundefs.ts`. A new `NotifyEvent` kind `queue` is additive (`shared/api.ts` line-neutral, `MailScreen`'s two total maps). (5) `ccd/session-hook.sh`: the hold grammar hoisted to ONE spelling, `CCRC_HOLD_WAVE_RE` (line-neutral), and a PreToolUse block below wave 1's advisory that denies a command-head `gh pr merge` (backslash escapes, quoted text and `#` comments removed first, leftmost as bash reads them, in the same jq that reads the command, so a commit message, PR body or comment that mentions it passes and, wherever the strip can parse the span, none of them can hide one — the header's WHAT PASSES UNPARSED lists the mis-reads that can, and a heredoc or quoted span the strip cannot complete keeps its raw text, so one that holds a merge at a command head is denied though bash would run none of it) when `_ct_read`'s hold is within `CCRC_HOLD_MAX` and matches that grammar, or when `$REG/<id>.child` exists; a deny replaces an `additionalContext` advisory on the same call and never replaces the graph gate's deny. (6) The coordinator skill: clause 15's native-queue sentence, and `wave-lifecycle.md` §5's **Landing on a native-queue project** paragraph — measure that the project requires the queue, advance to `merging`, enqueue at the exact SHA only once the required checks passed, read the queue entry back (disarming an auto-merge that only armed), end the turn, prove the merge on `merged:#<pr>` and only then close, the last wave included (SKILL.md step 7 and §6 point at it); answer `dequeued:` from the queue's own CI run by re-enqueueing or with a fix round on `merging → working`; a coordinator the hook refuses has the operator enqueue — pinned verbatim, with every `gh pr merge` the corpus spells held to `--match-head-commit <handoffCommit>` (the exact disarm spelling excepted) and the paragraph held to the server's own two subjects and to each of those rules.

**Tech Stack:** bash 5.2 (`ccd/ccd`, `ccd/session-hook.sh`), python 3.12 (the stamping pass, embedded in `ccd/ccd`), TypeScript (server, shared, pwa), Node 22 ES modules (`.github/ci/*.mjs`, dependency-free), GitHub Actions YAML, GitHub's GraphQL API through `gh api graphql` (gh 2.45 on the fleet box), vitest 4.1.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` — §5.2 (stage 2: "Repository code", "Operator configuration", "Rollout order inside stage 2"), §3 R3, R5, R9, §4 (roles table: the worker and coordinator rows), §7 (wire additive, `FLEET_PROTO` stays 1, one reader per field), §9 (stage 2 lands with or after stage 1; its wave re-planned against CCR-15; CI selection's shape), §10 (stage 2 metrics), §12. Programme ledger: `docs/superpowers/programs/landing-order.md` (wave 2 row; carried constraints — CI selection landed first; skill pins move with the clauses). This plan departs from the spec's literal text in ten places, each argued where it is made and listed by slug under `## Deviations found` for the coordinator to number: the last queue act of EITHER kind (finding 3), the 25 s bound (findings 1 and 14), the ninth feed kind and the `operator` sender (finding 5), the lands-before-close rule and the landing lane's `merged:` notice (finding 12 (i), (i′)), the deny's child-marker arm (finding 12 (iii)), the pipeline check on a queue run (finding 13), the enqueue gated on the required checks and read back (finding 20), a coordinator the deny refuses enqueueing through the operator (finding 22), and the SERVER-FIRST rollout against §9's AGENT-FIRST (Global Constraints). **OUT of scope** (wave 2b, after the proof run): the every-session `--admin` deny and the `gh api` merge denies — the pulls merge endpoint and the GraphQL merge mutations (`mergePullRequest`, `enqueuePullRequest`, `enablePullRequestAutoMerge`), each measured passing this wave's deny under a wave hold.

**Prerequisite:** landing-order **wave 1 has merged to `main`** — it adds coordinator clause 15 (Task 5 appends to it) and the PreToolUse sync advisory (Task 4's deny supersedes it on a shared call). Child-reclamation wave 3 (#187) is on `main` since `1ffdf947`. This wave's workspace is a fresh child from current `main`; Task 1 Step 0 refuses to start without wave 1.

---

## Global Constraints

Copied from `CLAUDE.md`, the spec and the programme ledger. Every task's requirements implicitly include this section.

- **Deploy class for THIS wave: SERVER-FIRST in intent (`ccrc rollout --to <tag> --server-first`); the order the deploy will actually take is the updater's, below.** `CLAUDE.md`: "`--server-first` when a wave's server arm is a reader-widening". This one is: the server gains a reader for an additive field and a wider bound (`'pr-state': 25_000`) that the new ccd's third gh call needs. A new server beside the old ccd reads `absent` and stays silent; the old server beside the new ccd would kill a slow three-call sweep at the old 20 s for the minutes between the two moves. The hook and the coordinator skill reach the fleet box with ccd, after the server — so by the time a coordinator reads "land before you close", the server that sends it `merged:#<pr>` is already running. Task 6 does not restate this order as a command: its deploy step follows the updater's. The shipped updater, in fact, moves the FLEET box first and holds the server behind it, so this order is the plan's intent and not what the deploy will do — the real order, and why the window is harmless, are argued in the `server-first-rollout` entry under `## Deviations found`.
- **The coordinator merges, workers never do, nothing merges unattended** (spec §3 R5). Nothing in this wave enqueues, merges, re-runs or re-enqueues anything: the landing lane only records and mails; the hook only denies.
- **No repository SETTING changes in any code task.** The ruleset, the approval count, bypass actors and the proof run are Task 7, the operator's, after merge. Coordinator clause 15 forbids a coordinator writing rulesets; a worker does not either.
- **SAFETY — sacred.** NEVER run destructive `ccd` verbs against the live host (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore`). NEVER touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*.service` directly — Task 6's deploy checks READ the installed hook and ccd with `grep -c`, and Task 7's census reads marker files with `test -e`, nothing more. NEVER print secret file CONTENTS (Task 7's census reads the open runs through `ccrc-api`, which never prints the token). `gh` stays off the exec whitelist: `ccd` calls it on the fleet box, the PWA never can.
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** Harness: `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`) and `makePrHarness(prefix)` (`server/test/ccdPrHelpers.ts`), whose `gh` is a shell function that wins over PATH and whose base harness plants a poisoned `gh` behind it. **Every `bash` spawn in a `ccd-*.test.ts` file goes through the harness** (`h.sh`), which routes it through `ghContainedEnv(home, env, { systemd: true, tmux: true })` — `ccd-workspaces.test.ts`'s "routes EVERY bash call site in every ccd test file through ALL THREE poisons" reads the source. `session-hook-merge-deny.test.ts` runs the HOOK (not ccd) under a fixture HOME with a stub `tmux`, the way `session-hook.test.ts` does. The CI tests run `select.mjs` and bash step scripts against fixture git repos in `mkTmp` directories, never the real Actions environment.
- **No root `package.json`, no root runner.** Four packages, each `"type":"module"`, run cd'd in:

      cd server && npm ci && npm run test    # vitest run — hermetic
      cd agent  && npm ci && npm run test
      cd pwa    && npm ci && npm run test

  `tsc --noEmit` over `server/src` reaches `agent/src/server.ts`, which imports `ws`: run `npm ci` in `agent/` too before any server typecheck.
- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`.**
- **Run suites in the FOREGROUND, timeout ≥600000ms, ONE vitest process at a time — and, while the fleet box is loaded, one test FILE per process for every task's own runs (Task 6 Step 1's whole-suite pass is the one exception: `agent` and `pwa` whole, `server` in sequential shards).** Every count in this plan was measured that way (`--maxWorkers=1`). The server suite does not fit one 600 s call on the loaded fleet box — Task 6 runs it as twelve sequential shards whose union is every file once. Never background a suite.
- **Known load flakes** (re-run IN ISOLATION before calling a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`; also `boot.test.ts`'s two p95 timing cases. `tmp-sweep`'s FAILS-CLOSED case is red on the fleet box on `main` itself (pre-existing, red in isolation) — report it, do not chase it.
- **Rings:** L0 `shared/*.ts` imports nothing — this wave changes three lines of `shared/api.ts` IN PLACE — two code lines (the `NotifyEvent.kind` union and `NOTIFY_KINDS`) and one docstring line (the `NotifyEvent.kind` docstring's last, which now names `queue`) — and imports nothing. `queueFor` is L1-pure (no fs, no clock); `dequeuedSubject`/`mergedSubject` are pure. **No overloaded null at a seam:** `queueFor` answers `absent` for "nothing was asked" and `unmeasured` for "asked, not answered"; `_pr_queue_py` keeps "the call did not answer" (`None` → `unmeasured` on every line) apart from "the bound PR is not in the window" (`unmeasured` for that line only) and from "no bound PR" (`none`); `sweepLanding` keeps "run rows unreadable" (defer) apart from "no open run" (feed-only).
- **Wire discipline — additive-only.** `queue` and `queueAt` are new keys on the ccd→server `pr-state` line, emitted only by `--project`, read by exactly one function (`queueFor`); absence permits. `NotifyEvent.kind` gains `queue`; an older client degrades it to `unknown` through `reviveNotifyEvent`, and an older server reads a stored `queue` row through `isNotifyKind` as `unknown`. The `merged:` notice is a mail, not a new frame. `PrState` and `FleetSession` do NOT change. **`FLEET_PROTO` is NOT bumped.**
- **Workflow-file safety.** Every expression this wave adds to `ci.yml` reads `github.event_name`, `github.run_id` or `github.event.merge_group.base_sha` — the last a commit sha GitHub sets, not text anybody writes — and none of them is interpolated into a `run:` line: the base sha reaches the pipeline check through its step's `env:` and is handed to `git` as a quoted argument. `pull_request` stays, `pull_request_target` stays absent, `permissions: contents: read` stays (`oss-metadata.test.ts`), and `main-artifact.mjs` still trusts no `merge_group` run (`TRUSTED_EVENTS` is `push`, `schedule`, `workflow_dispatch`; a queue run's branch is `gh-readonly-queue/…`, never `main`) — so a queue run can never be the stable gate's evidence or publish a map.
- **Mutation-table discipline:** a new guard ships WITH a test that goes RED when the guard is deleted/mutated, measured before/after. Every mutation row in this plan was run on 2026-09-29 on a prototype built from `6da36f0b`, wave 1 applied from wave 1's own code blocks and this plan's tasks applied in order from THIS plan's blocks, each row restored from a saved COPY of the file (never `git checkout --`), one test file per vitest process, and its red is quoted. Task 2's rows were first measured at `905360dc`, and every row reproduced on the new base.
- **`ccd/ccd` is a provenance-STAMPED file** (line 2 is `# ccrc:generated 1 sha256=…`). **Every task that edits `ccd/ccd` re-stamps before running any suite**, or `server/test/ownership.test.ts` reds. With wave 1 merged the re-stamp is its own verb, `ccd/ccrc restamp ccd/ccd`; the `node -e` below is the same `markGenerated`:

      node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
        const { markGenerated } = await import('./shared/mark.mjs'); \
        writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"

- **The citation tax is owed by every CITED file.** `server/test/session-hook.test.ts` audits every `file:line` in two FROZEN corpus documents and `README.md`. This wave edits THREE cited files: `ccd/ccd` (Task 2), `ccd/session-hook.sh` (Task 4) and `shared/api.ts` (Task 3). The plan pays by LAYOUT: every added line in `ccd/ccd` sits below `cmd_clip` and below ws-reap's mirror block (below every frozen anchor and below both README anchors); every added line in `session-hook.sh` sits below the graph gate and wave 1's advisory (below every frozen anchor and README's `ccd/session-hook.sh:2900`), and its three edits above that are line-neutral in place; `shared/api.ts`'s three edits (the docstring, the union and `NOTIFY_KINDS`, as `task-3-adaptations` names them) are in place. Measured 2026-09-29 on the prototype with the instrument after each of Tasks 2 and 4 (see "The citation tax, mechanised"), and again on the moved base (`readme-repointer-skipped`): every `byFile` key stated == base == tree (`ccd/ccd` 147 … `shared/api.ts` 1), total 197, the `|`-row array 52 and the site array 35, every composition empty; the citation cases `7 passed | 328 skipped (335)` after every task. (#187 moved the base from `147 / 195 / 53 / 35` to `148 / 196 / 53 / 36`, which is `6da36f0b`'s; the moved base the wave was applied on reads `147 / 197 / 52 / 35`; this wave moves nothing.) **Nothing in `session-hook.test.ts` changes in this wave.** If the instrument shows movement, an insertion landed above an anchor — find out why before going on.
- **The `_reg_get` census:** this wave adds NO `_reg_get` call to `ccd/ccd` (the stamp reads the line's `number`, never the registry; the hook reads `.child` with a bare `-e`, never through ccd). Task 2 runs `ccd-reg-get-census.test.ts` to prove it.
- **Locate code by CONTENT.** Line numbers are "at `6da36f0b`" (with wave 1 applied where the file is one wave 1 edits) and are hints, never addresses.
- **Every forecast number is "at `6da36f0b` with wave 1 applied".** Where the base has moved, a different line number or test total with every case PASSING is not a red — the instrument's output is the authority and the difference goes in the commit message. Stop only on a FAILING case or a moved census composition you cannot explain.
- **Shell state does not survive between Bash calls.** Every block that names `$SCRATCH` sets it itself; `SCRATCH=<…>` means "paste your own session's scratchpad, as an ABSOLUTE path". Never run half a block.
- **Branch discipline:** commit on this workspace's own branch only; never a separate feature branch (a feature branch wedges every close with `stale-tip`). One commit per task.
- **Commit trailers:** end every commit message with the attribution line your own session is given. The heredocs below end at the body for that reason.
- **No hostnames, IPs, tailnet names, docserver URLs, account names or the GitHub owner's name** anywhere in a committed file (`topology-clean.test.ts`). Task 7's commands say `{owner}/{repo}`, which `gh api` fills in from the checkout it runs in.
- **`## Deviations found` numbers are ISSUED, never chosen** — see that section at the foot of this plan.
- **Cross-programme: CI test selection LANDED FIRST (#183, `814fc53d`), so this wave merges INTO its shape and overwrites none of it** (programme ledger, carried constraint 1). What `main` already has: ONE top-level `concurrency:` block whose `pull_request` arm is `ci-<workflow>-pr-<number>` and cancels — a second block would be a duplicate key, invalid YAML that `ci-pipeline.test.ts`'s `section()` cannot see because it reads the first (Task 1's test refuses a second, and Step 7 loads the file with a duplicate-key loader); a job-level `if:` on `test-macos`; an event ALLOW-list on `probe-macos` (`pull_request || schedule`, pinned `toBe`), which already keeps a queue run out and is not edited; `full-suite`, `full` mode only, which needs `test-macos` and reds on a skipped leg; and `decideMode`, whose SAFE fallthrough answers an unlisted event — `merge_group` — `full / none`. The operator ruled on 2026-09-28 that a queue run runs the SELECTED tests, like a pull request, so `merge_group` joins the `pull_request` arm; a queue run keeps a run-unique group (never the shared push-to-main `refresh` group, which may drop pending runs); the macOS legs and `full-suite` skip a queue run (a `selected` run falls back to `full` on any selection fallback, and `full-suite` would read the skipped macOS leg as red). No job a required check needs mentions `merge_group`, but for the pipeline check's own step. The 2026-09-23 ruling stands: no full run per merge.
- **Cross-programme: child-reclamation.** Wave 3 (#187) is on `main`: a close that finishes with a child (a `final` close, an abandon, a spent child's close, a close that retires the programme) releases it and queues its reclaim, which removes the pane, the worktree, the branch and — last — the registry row. That is why Task 5 has a producer land before it closes, and why Task 4's deny also keys on the child marker. Wave 4 (`docs/superpowers/plans/2026-09-22-child-reclamation-wave4-sweep-and-switch.md`, dispatched as run 174) edits four files this wave also edits: `server/src/watch.ts` (imports, fields beside `private coord`, `sweepChildReclaim`, one `tick()` dispatch — none adjacent to this wave's), `shared/api.ts` (an insertion ABOVE README's `shared/api.ts` anchors, whose S6-R11 tax re-measures the census's `'shared/api.ts'` entry and total — this wave's two edits are in place and move nothing, but if wave 4 lands first the census numbers here are read from the base, never from this plan), `server/test/coordinator-skill.test.ts` (`EXEMPT` and one forbid-mention case after `never names the caps dial`) and `server/test/single-definition.test.ts` (one `describe`). Whichever lands second keeps both sides; `coordinator-skill`'s count then reads 153 plus wave 4's case. Wave 4's sweep refuses a held child (`held`), so a producer waiting at `merging` is safe from it as it is from the close.
- **Cross-programme: centralised update management.** Waves 4, 5 and 7 (#181, #201, #203) moved `server/src/coord/store.ts`, `shared/api.ts` and `server/src/watch.ts` by thousands of lines; this plan locates every edit in them by content, and the line hints are `6da36f0b`'s.
- **Operator rulings, 2026-09-29** (each the re-plan's default): (1) an INDEPENDENT wave N+1 still dispatches only after wave N closes — §5's order stands, and on a native-queue project the queue's latency, about one queue CI run, is accepted; (2) the `merged:#<n>` wake-up mail ships in this wave (finding 12 (i′)); (3) the 2026-09-24 ruling of 25 s for both `pr-state` modes stands, and with it the close's ~50 s worst case against the 30 s client timeout (finding 14) — Task 2 rewrites the four statements of the old bound; (4) if the proof run's enqueue is refused because the repository has `allow_auto_merge: false`, stop rule 4 halts the proof and the operator decides then — no task changes that setting.

---

## Review Focus

Ten inputs or failure modes the spec implies and nothing on `main` tests. Each is given a test in its owning task, and each test has a mutation row that reds it.

1. **A required leg skipped on a queue run reads as PASSING.** GitHub reports a job skipped by `if:` as success, and a matrix whose every STEP skips (`CCRC_LEG: skip`) reports green having run nothing — so a `merge_group` mention anywhere in a required leg's closure (`server`, `select`, `server-shard`, `server-typecheck`, `test`, `build-pwa`) would let the queue merge a tree nobody tested. → Task 1, case "keeps every macOS job, and every job that needs one, off a queue run — and no required prerequisite mentions merge_group" (derived: macOS jobs from `runs-on`, the required closure from `needs:`); rows M8, M9.
2. **A shared or cancellable concurrency group drops runs the queue needs.** GitHub keeps ONE pending run per group and cancels the older pending one even with `cancel-in-progress: false`; a queue run in the shared `refresh` group, or in any group another run can share, would lose its checks and the queue would remove the entry. → Task 1, case "gives a queue run a concurrency group of its own, and never cancels one"; rows M2–M4.
3. **A pull request choosing its own queue run's tests.** A queue run runs the selected tests (ruling 2026-09-28), and the selector is code in the pull request; the plain-bash pipeline check is what forces a pipeline-changing PR to run everything, and it was `pull_request`-only. → Task 1, `ci-pipeline`'s "runs on pull_request and on merge_group…" and "a merge-queue run asks it too, against the base sha…"; rows M14, M15. And the selector and the verdict may never disagree about which triggers can answer `tests: none` → the agreement case; rows M11–M13.
4. **The queue read must never cost the rows, and must never say `none` for a read that did not happen.** A failed call, an answer of the wrong shape, and a stamping pass that itself fails each leave `phase`, `number`, `rows` and `checks` exactly as `_pr_state_one` printed them. → Task 2, describe "the queue read may not cost the rows"; rows Q5, Q6.
5. **No evidence, no notice — and no guessed recipient.** A line from an older ccd, a `--session` line, and an `unmeasured` read never produce a dequeue notice; a dequeued PR whose workspace no open run names is recorded in the feed and mailed to NOBODY, even when `resolveCoordinator(null)` would answer the one active programme's coordinator; with two open runs on a workspace the recipient is the close's own survivor. → Task 3, cases "says nothing for…", "with no open run…", "names the survivor…"; rows L5, L6, L15.
6. **One notice per removal, and one per merge — across a restart, and never lost to a failure.** The latch is in memory and a rollout restarts the server, while `queueSystemMail`'s dedupe sees only OUTSTANDING mail: without a durable read an acked notice is mailed again after every restart. And a latch set before the read or the mail turns a transient `run-unreadable` or a thrown `database is locked` into a removal nobody hears about. → Task 3, describe "the landing lane latches only what it told"; rows L3, L9–L13, L17. The merged notice has the same two guards — an unreadable run row defers, and the latch follows the mail — and a dequeue's record ignores the presence gate, so an operator watching the pane cannot erase a removal's only record → the merged defer-and-retry case and the presence case; rows L19–L21.
7. **A coordinator that enqueued and ended its turn, woken by nothing.** A queue merge is asynchronous and the coordinator never polls (clause 7). The `merged:#<n>` mail is its wake-up, and only a run that waits at `merging` — the coordinator's own declaration that it is landing — asks for it. → Task 3, describe "the landing lane — a merge while the run waits at merging"; rows L16, L17. And the premise that makes the lane reach a PR at all — the producer lands BEFORE it closes, so the reclaim cannot take its row, its line and its worker — is the coordinator's rule → Task 5's landing case; rows S7, S8. And the enqueue itself: gh 2.45 ARMS auto-merge, rather than queueing, a PR whose required checks have not passed, with the same success line — the PR reads `none` and the lane is silent (finding 20) — so the coordinator measures that the project requires the queue, enqueues only once `gh pr checks <pr> --required` exits 0 — waiting for pending checks in the foreground (`--watch`), never by ending its turn, since no mail comes when checks finish — reads the queue entry back, disarms what only armed and before any fix round, and lands the LAST wave before its close too → the same case; rows S9–S14 and S18. A dequeue's why is the queue's own run, not the PR head's checks, which can read green (finding 23) → rows L22, S16.
8. **The deny holds at every parseable command head — reserved words, grouping and wrappers included — never fires on a QUOTED mention (a commit message, a PR body, a grep pattern), never treats a hold that is not a whole, readable wave hold as one, and still holds after a close released the hold but before the reclaim took the pane.** What it cannot parse is stated in its header, not hidden. → Task 4, cases "refuses every spelling…", "leaves every other gh…", "lets a hold that names no programme wave through…", "refuses a released child…", "a child marker that cannot be read…"; rows H2–H7, H9–H16. A `#` comment or a backslash-escaped quote may not open a quoted span that swallows a live merge after it (finding 21) → rows H18, H19; and a merge deny never replaces the graph gate's counted deny (D-1689) → the graph-gate case; row H17.
9. **A landing spelling that drops the exact-SHA binding.** #178 put `--match-head-commit <handoffCommit>` into the coordinator's merge for the merge proof; nothing on `main` pins it (`grep -rn match-head-commit server/test` finds nothing). → Task 5's derived case over every `gh pr merge` the coordinator corpus spells, and Task 3's brief case; rows S2–S4, L18. Its one exemption, the disarm spelling `gh pr merge <pr> --disable-auto`, merges nothing — and is exempt ONLY in exactly that spelling → row S17.
10. **A coordinator the deny refuses.** A self-claimed run's hold, or a reclaim heir's hold and marker, look like a worker's to the hook (finding 22). Closing to shed them would reclaim the coordinator's own pane, so the paragraph sends it to the operator's shell → Task 5's landing case; row S15; and Task 7 Step 1's census stops on either shape, and on a read of the open runs that did not answer.

---

## File Structure

| File | Created / Modified | Its one responsibility |
|---|---|---|
| `.github/workflows/ci.yml` | Modify — a `merge_group` mode-table row; `merge_group:` in `on:`; ONE arm in the existing `concurrency.group`; the pipeline check's `if:` and `BASE`; a leading skip conjunct on `test-macos`'s and `full-suite`'s existing `if:` (Task 1) | The queue gets its required checks from a pull request's run; macOS and `full-suite` stay off a queue run; a queue run's group is its own |
| `.github/ci/select.mjs` | Modify — `decideMode`'s rule 1 and `modeInvariantViolation`'s first arm take `merge_group`, with their docstring (Task 1) | A queue run is selected like a pull request, and never answers `tests: none` |
| `.github/ci/verdict.mjs` | Modify — `serverVerdict`'s `tests: none` arm refuses `merge_group`, with its docstring (Task 1) | `test (server)` is red on a queue run that tested nothing |
| `CLAUDE.md` | Modify — one sentence in the **What CI runs** bullet (Task 1) | Says what a queue run runs |
| `server/test/ci-merge-queue.test.ts` | Create (Task 1) | Five properties, derived from `ci.yml` and the two modules |
| `server/test/ci-pipeline.test.ts` | Modify — the pipeline step's `if:`/`BASE` pin, its three `runStep` environments, one queue case, the `full-suite` `if:` pin (Task 1) | CI selection's shape pins, moved with the shape |
| `server/test/ci-select-cli.test.ts` | Modify — one invariant case, one CLI case (Task 1) | `merge_group` through the real CLI |
| `server/test/ci-verdict.test.ts` | Modify — `EVENTS`, the oracle, one named case (Task 1) | The exhaustive table crosses `merge_group` |
| `ccd/ccd` | Modify — `PR_GH_QUEUE_TIMEOUT`, `PR_QUEUE_QUERY`, `_gh_pr_queue`, `_pr_queue_stamp`, `_pr_queue_py` inserted directly above the source guard (below ws-reap's mirror block); ONE line of `cmd_pr_state` in place; two length-neutral prose rewrites (the outer-bound paragraph, `cmd_pr_state`'s budget header) (Task 2) | The third `--project` call and the `queue`/`queueAt` stamp |
| `server/src/remote/runner.ts` | Modify — `'pr-state': 20_000` → `25_000`, its comment (the three calls, and every consumer that waits on the same key inside `coordMutex`) and `ws-rename`'s (Task 2) | The outer bound the three calls fit inside |
| `server/src/coord/childSpent.ts` | Modify — TWO docstring lines in place: `pr-state`'s `20 s` remote budget → `25 s` (Task 2) | States the bound `childSpent`'s live gh round trip waits on |
| `server/src/coord/routes.ts` | Modify — ONE comment line in place, in `POST /api/runs`'s rule-3 gate: `20 s` → `25 s` (Task 2) | States what `childBindGate` can cost inside `coordMutex` |
| `server/src/coord/close.ts` | Modify — TWO docstring lines in place, `childGateAtClose`'s: `~40 s` → `~50 s`, `20 s` → `25 s` (Task 2) | States what the close's two reads can cost |
| `server/test/remote-runner.test.ts` | Modify — the `pr-state` row and its comment (Task 2) | The new bound, pinned |
| `server/test/pr-timeout-budget.test.ts` | Modify — header, the budget sums THREE timeouts (Task 2) | The cross-language budget |
| `server/test/ccd-pr-queue.test.ts` | Create (Task 2) | One call per sweep, `-f` variables, its own timeout, the five words, and "may not cost the rows" |
| `server/src/prstate.ts` | Modify — `CcdPrLine.queue`/`queueAt` (raw), `PR_QUEUE_MAP`, `PrQueue`, `PrQueueRead`, `queueFor` (Task 3) | The ONE reader of the new fields |
| `server/src/coord/rundefs.ts` | Modify — the `operator` sender gloss; `queueSystemMail`'s caller list, all seven named; a re-export of `dequeuedSubject`, `mergedSubject`, which now live in `landing.ts` (Task 3, then fix round 1, `landing-verdict-is-l1`) | Who raises the landing notices; the one import path the subjects keep |
| `server/src/coord/landing.ts` | Create (fix round 1, `landing-verdict-is-l1`) | The landing lane's decisions as a pure L1 verdict, on `stall.ts`'s precedent: `landingAsk`, `landingVerdict`, the two notice subjects and the two notice bodies |
| `server/src/watch.ts` | Modify — two imports, `prQueues`, `landingNotified`, one line in `sweepPr`'s full-line arm, one call after `sweepMerged`, `sweepLanding` as the lane's L4 shell — it reads the facts, calls `landingAsk`/`landingVerdict`, sends the mail, records the feed event and sets the latch; the decisions and both briefs (`renderDequeueBrief`, `renderMergedBrief`) live in `landing.ts` (Task 3, then fix round 1, `landing-verdict-is-l1`) | The landing lane's effects, and no decision of its own |
| `server/src/coord/store.ts` | Modify — two reads: `hasMailWithSubject` after `hasOutstandingMail`, `hasFeedEvent` after `feedEvents` (Task 3) | The lane's durable "already told" |
| `shared/api.ts` | Modify — three lines IN PLACE (two code, one docstring): `NotifyEvent.kind` and `NOTIFY_KINDS` gain `'queue'`, and the `NotifyEvent.kind` docstring's last line names it (Task 3) | The ninth feed kind |
| `pwa/src/screens/MailScreen.tsx` | Modify — `KIND_WORD`/`KIND_GLYPH` gain `queue` (Task 3) | The two total maps name it |
| `pwa/test/mail-screen.test.tsx` | Modify — one `it` after the coord-kind one (Task 3) | The word and glyph actually render |
| `server/test/pr-queue-lane.test.ts` | Create (Task 3) | `queueFor`'s answers; both notices, once each, and their silences; the survivor; a deferred read, a thrown mail, a restart — on both arms; the record under the presence gate |
| `server/test/ccd-pr-queue-words.test.ts` | Create (fix round 1, `queue-words-pinned-across-languages`) | The cross-language pin: the five words `_pr_queue_py` emits in `ccd/ccd` are read out of its source and held to the server's `PR_QUEUE_MAP`, so a rename on one side reds |
| `server/test/landing-verdict.test.ts` | Create (fix round 1, `landing-verdict-is-l1`) | `landingAsk` and `landingVerdict` directly: each notice's asks and silences, whom to tell, the merged-only-at-`merging` rule, both durable "already told" reads, a deferral that never latches |
| `ccd/session-hook.sh` | Modify — `CCRC_HOLD_WAVE_RE` (line-neutral), `_hook_hold_card`'s gate reads it (in place), the class note (in place), the deny block below wave 1's advisory, above the subagent block; its jq strips backslash escapes, quoted spans and `#` comments (Task 4) | The worker merge deny, hold arm and marker arm |
| `server/test/run-routes.test.ts` | Modify — the hold-grammar pin reads the hoisted spelling (Task 4) | One grammar, pinned where it is assigned |
| `server/test/session-hook-merge-deny.test.ts` | Create (Task 4) | The deny's refusals and its passes; the graph gate's counted deny kept |
| `ccd/coordinator-skill/SKILL.md` | Modify — clause 15 gains one sentence; step 6's **Clean** arm gains one pointer sentence; step 7 gains the last wave's (Task 5) | The landing spelling, and "land before you close", the last wave's too |
| `ccd/coordinator-skill/references/wave-lifecycle.md` | Modify — §5 step 3: the #178 merge sentence names the queue landing; the **Landing on a native-queue project** paragraph; §6 opens with the last wave's landing (Task 5) | How the coordinator lands — the queue measured, the required checks green, the entry read back, an armed request disarmed — answers both notices, and lands the last wave; what a coordinator the hook refuses does |
| `server/test/coordinator-skill.test.ts` | Modify — `CONTRACT`'s clause-15 element gains the same sentence; the `rundefs.js` import; two cases (Task 5) | The clause stays pinned verbatim; every merge spelling binds the SHA (the exact disarm spelling excepted); the paragraph names the server's subjects and each landing rule; step 7 and §6 point at it |

Nineteen shipped files (`CLAUDE.md` and the two skill documents among them; `landing.ts` the one new) and fourteen test files, six of them new.

**Not modified, deliberately:** `agent/src/whitelist.ts` (the `['pr-state','--project']` grant already carries this verb; no new argv), `server/src/ccdargv.ts` (no new argv form), `.github/ci/main-artifact.mjs` (it already trusts no `merge_group` run), `probe-macos`'s `if:` (its allow-list already keeps a queue run out, and `ci-pipeline.test.ts` pins it `toBe`), `select.mjs`'s macOS budget line (no job reads the macOS matrix on a queue run, so an edit would carry no test that could red), `release-main.yml` (tags per push; the proof run measures whether that is per merge), `README.md` (it documents neither the pr-state calls, the feed kinds nor CI's modes — measured, `grep -n "gh call\|rollup\|feed kind\|merge_group\|full-suite" README.md` finds nothing this wave makes stale), the RUN state machine (`awaiting-review → merging → closing` and `merging → working` exist; `merging` is IDLE and holds no dispatch slot — `coord-store.test.ts`: "merging: the coordinator's wait"), every ruleset and repository setting (Task 7, the operator's), the worker skill (wave 1 owns clause 16; the worker's R5 is the hook's), the reviewer skill.

---

## Pre-flight findings (measured while planning; not deviations)

Findings 1–11 were measured on a prototype of this plan's first edits in an isolated worktree at `905360dc`, and each that states a count reproduced at `6da36f0b`; findings 12–19 were measured on 2026-09-29 on a prototype built from `6da36f0b`, wave 1 applied first from its own blocks and this plan's tasks after it from this plan's blocks; findings 20–25 were measured by the three reviews of that re-plan the same day, and re-measured on the fix round's prototype. They are why the tasks look the way they do.

1. **The existing budget has no room for a third call.** `pr-timeout-budget.test.ts` requires the gh timeouts to sum to at most 70 % of `CCD_VERB_TIMEOUT_MS['pr-state']`: `8 + 5 = 13 ≤ 14` at 20 s, so a third call could have at most 1 s. The queue query measured 0.72–1.39 s, so 1 s is not a bound. The plan raises the outer bound to 25 s and gives the call 4 s: `8 + 5 + 4 = 17 ≤ 17.5`. Row B1 (bound back at 20) reds with `the three gh calls (8s + 5s + 4s) leave only 3s of the 20s pr-state bound … expected 17 to be less than or equal to 14`. **RULED 2026-09-24 (the orchestrator, option a): 25 s for BOTH `pr-state` modes.** The map is keyed by the verb alone (`server/src/remote/runner.ts:115`, `CCD_VERB_TIMEOUT_MS[args[0] ?? '']`), so `--session`, which makes one gh call, rises with `--project`. Measured at `65c5bb34`: `verifyDone`'s `--session` read has waited inside `coordMutex` since 2026-08 (at close, `server/src/coord/close.ts:283` under `routes.ts:1535`'s `coordMutex.run`; at advance, `routes.ts:1774` inside `:1723`'s), so all of them rise to 25 s; #178 added two MORE waits — `childSpent` calls it (`server/src/coord/childSpent.ts:116`, `CCD_ARGV.prStateSession`) through `childBindGate`, which `POST /api/runs` awaits (`server/src/coord/routes.ts:1356`, inside the `coordMutex.run` at `:1187`) and dispatch's resume arm awaits (`server/src/coord/dispatch.ts:729`, inside `routes.ts:1511`'s `coordMutex.run(() => dispatchRun(…))`) — and it stated the old bound as a fact twice (`childSpent.ts:103`, `routes.ts:1351`). Task 2 Step 7 names both consumers in the runner comment and rewrites both statements in place. **Since #187 there is a third consumer and two more statements** — finding 14.
2. **The query, measured read-only against this project's own public repository** (`gh api graphql`, no mutation; the owner is not written here): the single-window form (`first: 100, states: [OPEN, MERGED], orderBy UPDATED_AT`) answered in 2.13–2.69 s over four runs; the two-window form this plan ships (100 OPEN, the 20 most recently updated MERGED) answered in 0.72–1.39 s over five runs, rc 0, `{open: 11 nodes, merged: 20 nodes}`, every node carrying `number`, `state`, `mergeQueueEntry` (null — no queue exists yet) and `timelineItems` (empty). So the schema accepts every field the query names. Re-measured at review with the open window ordered `CREATED_AT DESC` (the form this plan now ships): 0.74–1.12 s over five runs, rc 0, `{open: 12, merged: 20}`, the open numbers newest-first. `gh pr list` itself orders `CREATED_AT DESC` (read from gh 2.45's embedded `pullRequests(… orderBy: {field: CREATED_AT, direction: DESC})` query), so every open PR `_gh_pr_list`'s `--state all --limit 100` window can bind is inside the queue read's hundred.
3. **The spec's "last `REMOVED_FROM_MERGE_QUEUE_EVENT`" alone is ambiguous** for a MERGED PR: "dequeued, re-enqueued, landed" and "dequeued, then merged by hand" both have a removal and no entry. The query asks for the last queue act of EITHER kind (`timelineItems(last: 1, itemTypes: [ADDED_…, REMOVED_…])`). Pinned by the case "none — a MERGED PR whose last queue act is a removal was merged BY HAND"; row Q4 (`MERGED` alone reads as landed) reds it.
4. **`GH_STUB` answers every `gh` call with the rows**, so every existing `ccd-pr-state.test.ts` case now meets a list where the GraphQL object should be. `_pr_queue_py` reads that as "not the query's shape" → `unmeasured`, and the existing suite stays green: `ownership` + `ccd-pr-state` 113/113 on the prototype. No existing test asserted an exact line object or a call count that the third call moves.
5. **`NotifyEvent.kind` is closed and `MailScreen`'s `KIND_WORD`/`KIND_GLYPH` are TOTAL `Record`s**, so a new kind is a compile error until both name it, and at runtime a missing entry renders NOTHING (the coord-kind precedent's measured note). `watch.ts`'s `tellSender` comment argues for reusing a kind to avoid that edit; a dequeue fits none (`merged` would render "merged" beside a PR that did not merge; `mail` is what the coordinator's notice already records). So `queue` is the ninth kind, and `shared/api.ts`'s three edits (two code, one docstring) are made IN PLACE so its cited lines do not move.
6. **`run-routes.test.ts` pins the hook's hold grammar INLINE** (`'[[ "$h" =~ ^program:[A-Za-z0-9._-]+\' \'wave:…'`). A second inline spelling in the deny would be the drift the single-definition doctrine forbids and that pin could not see, so the grammar is hoisted to `CCRC_HOLD_WAVE_RE`, the card reads it, the deny reads it, and the pin moves to the assignment (rows C1, C2). The assignment sits in the constants block that runs before the event `case`, so the card never reads it unset; the paragraph above it is rewrapped so the block stays exactly fifteen lines.
7. **The hook runs under `set -u`.** A first mutation that deleted the hold predicate outright crashed the hook (`$CT_V` unbound → exit 1) — a red for the wrong reason. Row H2 is therefore spelled "the hold is read, never judged", which reds on the assertion it names.
8. **The citation census does not move**: `147 / 195 / 53 / 35`, stated == base == tree, empty composition, measured by `cite-remeasure.py` (for `ccd/ccd`) and by its one-line variant that also swaps `ccd/session-hook.sh` (for Task 4), with `repoint-readme.py` leaving README byte-identical (`cmd_ensure mint -> ccd/ccd:21202`, `genrc == 1 arm -> ccd/ccd:19989-19991` at `905360dc`). At `6da36f0b` #187 has moved the BASE to `148 / 196 / 53 / 36`, and this wave still moves nothing (finding 17).
9. **The repository's current settings, measured read-only** (`gh api …/rulesets`, `…/rulesets/<id>`, `…/branches/main/protection`, `…/<repo>`): the `main` ruleset has ONE rule, `pull_request`, with `required_approving_review_count: 1` and `allowed_merge_methods: [merge, squash, rebase]`, and TWO bypass actors — `RepositoryRole` 5 (admin) and `RepositoryRole` 2 (maintain), both `bypass_mode: pull_request`; classic protection requires the four contexts `test (server)`, `test (agent)`, `test (pwa)`, `build-pwa`, `strict: false`, `enforce_admins: true`, approvals 0; `allow_auto_merge: false`, `allow_update_branch: false`, `delete_branch_on_merge: true`. Task 7 is written against these values. R9 reads "the repository-admin role STAYS the ruleset's only bypass actor", and the maintain role is a second one today — RULED (the orchestrator's decision record, 2026-09-24, confirmed by the operator the same day): the runbook removes it, R9 as ruled; Task 7 Step 3 records it. The rulesets LIST endpoint returns summaries only (no `conditions`, `rules` or `bypass_actors` — measured), so Task 7 finds the main ruleset by reading each ruleset in full.
10. **Red-first, measured at `6da36f0b` with wave 1 and the earlier tasks applied, each new test written first:** `ci-merge-queue` `4 failed | 1 passed (5)` (the agreement case holds before and after — with no `merge_group` trigger it has nothing to disagree about; rows M11–M13 prove it is not vacuous), with `ci-verdict` `76 failed | 4447 passed (4523)`, `ci-select-cli` `2 failed | 39 passed (41)` and `ci-pipeline` `5 failed | 34 passed (39)` beside it; `ccd-pr-queue` `10 failed | 3 passed (13)` (the three that pass are the "absence" and "passes through" guards, true before and after — unchanged since `905360dc`); `pr-queue-lane` `16 failed | 2 passed (18)` (vitest leaves a missing named export `undefined`, so the reds are `TypeError: queueFor is not a function` and empty feeds, not an import crash; the two silence cases pass); `session-hook-merge-deny` `6 failed | 4 passed (10)` (the four that pass are the three pass-through cases and the graph-gate case, whose deny is the gate's own); `coordinator-skill` `3 failed | 150 passed (153)`.
11. **Two shapes of the first deny were measured wrong at review, and are why Task 4 strips quotes and widens the head.** Probed through the real hook with a wave hold: it DENIED ``git commit -m "the coordinator lands with `gh pr merge <n>` …"``, `git commit -m "docs (gh pr merge 42)"`, a heredoc commit message quoting `` `gh pr merge --admin` `` and ``gh pr create --body '… `gh pr merge <n>` …'`` — the commit messages and PR bodies this very programme writes — and it PASSED `if gh pr checks 42; then gh pr merge 42; fi`, `for …; do gh pr merge $n; done`, `{ gh pr merge 42; }`, `! …`, `time …`, `timeout 60 …`, `env GH_TOKEN=x …` and `gh pr --repo o/r merge 42`. The revised block removes '…' spans and $(-free "…" spans in the jq it already runs (no new fork), drops the backtick from the head separators, and accepts reserved-word, grouping and wrapper heads and flags between `pr` and `merge`; the new cases and rows H9–H14 pin both directions.
12. **Tasks 3–5, re-planned on the reclaim-on-close world (the orchestrator's 2026-09-24 ruling; unblocked when child-reclamation wave 3 merged as #187).** Measured at `6da36f0b`: a PR-bearing producer is spent, and §5 of `wave-lifecycle.md` closes it `final:true` and requires `released:true` before its PR merges unless wave N+1 builds on its code (§5 step 3, ≈718–754). That close's `ws-release` removes the hold, and — the workspace being a marked child, with no open sibling, on a `final` close — wave 3 queues its reclaim, which purges the pane, the worktree, the branch and, last, the registry row (child-reclamation spec §5.6's teardown order, §5.7's trigger). The three directions, and what this plan did with each:
    - **(i) Its aim followed; its mechanism refuted by measurement.** The direction keyed the dequeue lane on the PR the coordinator enqueued. Measured on the prototype with Task 2 applied: a workspace whose PR the queue read answers `dequeued` gets the word on its line; purge that workspace's registry row as the reclaim's last step does, and `ccd pr-state --project` prints NOTHING — no line, and no queue call either (`_pr_queue_stamp` returns on an empty sweep). No key the server holds can hear a reclaimed producer's dequeue unless ccd prints a per-repository record of queue facts — a reshape of Task 2's output and pins, which this re-plan does not make (Task 2 holds as written) — and even then the notice's remedy, a fix round, has no worker: the reclaim took the worktree, the branch and the pane. So the lane stays keyed on the OPEN RUN that names the workspace, and the plan makes that run survive: **on a native-queue project the producer lands BEFORE it closes** (Task 5). Its run waits at `merging` — IDLE, holding no dispatch slot (`coord-store.test.ts`: "merging: the coordinator's wait"; `RUN_TRANSITIONS` has `awaiting-review → merging → closing` and `merging → working`) — and keeps the child's hold, so neither the close's reclaim (there is no close yet) nor wave 4's sweep (it refuses a `held` child) can take it: the row, the line, the queue word and the worker all outlive the queue. The direction's "mail `resolveCoordinator` of the newest run that named that workspace" is exactly `resolveCoordinator(survivorOf(open runs).id)` — finding 12(c) below; a CLOSED run is not mailed (spec §5.2: "when an open run names the PR's workspace"), because a coordinator that closed before the landing broke clause 15, and the reclaim would take the line within seconds anyway.
    - **(i′) What the directions did not name: nothing wakes a coordinator when the queue lands.** A queue merge is asynchronous, and the coordinator never polls (clause 7). Under #178's order a dependent wave N+1 waited on "proven merged" with nothing to wake the coordinator; with `--admin` the merge was synchronous and the gap never showed. So the lane has a second notice: a `status` mail `merged:#<n>` when the PR reads merged while its run waits at `merging` — the coordinator's own declaration that it enqueued this PR. It reads the phase `sweepPr` already derives, not the queue word, so a queue that records a trailing removal on success (Task 7 stop rule 6) cannot silence it; it depends instead on `boundRow` still binding after a queue merge, which Task 7 (d) measures. Ruled 2026-09-29 (the operator): the notice ships in this wave.
    - **(ii) Followed.** Every landing spelling keeps `--match-head-commit <handoffCommit>` — clause 15's sentence, the lifecycle paragraph, and the dequeue brief — with no `--squash` (the queue's method applies) and never `--admin`; `wave-lifecycle.md` §5 is in Task 5's Files, with exact old and new text; the proof run gains the gh measurement (finding 16; Task 7 Step 5 (a0)). No test pinned the spelling on `main` (`grep -rn match-head-commit server/test` finds nothing); Task 5 pins every spelling the corpus has, derived.
    - **(iii) Followed, and measured.** The deny also keys on `$REG/<id>.child`. One writer: `cmd_ws_add`'s `_reg_set "$id" child "$lc_child"` (≈7117; one hit), reached only through `CCD_ARGV.wsAddWorker`'s `--child`, built only by `dispatch.ts` (≈589); child-reclamation spec §4: "There is no path by which a human's workspace, a coordinator's workspace, or any workspace that exists today becomes a child." Task 7 Step 1 re-measures it on the live registry, read-only, before the queue is turned on. With the lifecycle rule the window shrinks to "after any close, before the reclaim"; the marker covers it, and its EXISTENCE decides (a marker the hook cannot read is still one).
    - **The verifier's other inputs, all taken:** (a) `queueSystemMail`'s comment names every caller and drops the count word — six at `6da36f0b` (`closeRun` `close.ts:327`, `closeReviewRun` `:519`, `dispatchRun` `dispatch.ts:1098`, `queueProgramKickoff` `kickoff.ts:157`, the advance handler `routes.ts:1806`, `FleetWatcher.hold` `watch.ts:4680`) plus `sweepLanding`; (b) Task 5 edits `wave-lifecycle.md`; (c) the recipient run is `survivorOf`'s (`rundefs.ts`, the close's and dispatch's own rule), pinned by row L15.
13. **CI test selection's shape and the queue run (#183), measured.** Applied literally, the pre-#183 Steps 4–5 gave two top-level `concurrency:` keys and two job-level `if:` keys per macOS job — a file PyYAML's duplicate-key loader refuses while `ci-pipeline` stays green, its reader stopping at the first key. `decideMode` sends `merge_group` to its fallthrough `full/none`. Under the operator's ruling `merge_group` joins the `pull_request` arm; and then:
    - `full-suite` still needs the skip: `select.mjs`'s `testsOut = 'full'` on any selection fallback (no map, an unreadable one, a `.github/` change, a lockfile) turns a queue run into a `full` one, whose `full-suite` finds `test-macos` skipped and reds on it.
    - the plain-bash pipeline check was `pull_request`-only (`ci-pipeline.test.ts` pinned it so), and a `merge_group` event has no `github.base_ref`: without the edit, a queue run would run a selector the entry itself changed. It now diffs against `github.event.merge_group.base_sha`, and a base it cannot diff still answers "changed" — the safe direction.
    - the existing fallthrough group already keys a queue run by its `gh-readonly-queue/…` ref, which is per entry but not per run; the explicit `queue-<run id>` arm makes it run-unique, as spec §5.2 and the ledger's carried constraint require.
    - `probe-macos`'s allow-list already excludes `merge_group`; `times-build` needs `refs/heads/main`; `trace-shard` and `map-build` need a trace a `selected` run never asks for; `main-artifact.mjs` trusts no `merge_group` run. None is edited.
    - The other re-derivation the 2026-09-28 re-measure took green — a `full` row with `select.mjs` unedited — is the one the operator did not choose; only its measured facts are reused here.
14. **The 20 s bound, re-censused at `6da36f0b`: four statements and a third consumer.** #187 added `childGateAtClose`, which calls `childSpent` (`close.ts:647`) from `closeRun`'s abandon arm, `closeRun` and `closeReviewRun` (`:231`, `:351`, `:534`) and states the bound in its docstring — "Up to ~40 s against the 30 s client timeout … each call bounded by `pr-state`'s 20 s remote budget" (`:610` and `:612`) — beside `childSpent.ts`'s two statements (`:173`, `:241`) and `routes.ts`'s one (`:1376`). At 25 s the close's two reads are ~50 s against the 30 s client timeout that docstring already accepts by design (wave 4's reuse of `verifyDone`'s measurement is where it says the aggregate is addressed). The 2026-09-24 ruling (25 s for both modes) stands — re-affirmed by the operator on 2026-09-29, the ~50 s close worst case accepted; Task 2 rewrites all four in place, and names the close in the runner comment and the commit message.
15. **The source guard no longer follows `cmd_clip` (#187).** At `6da36f0b` wave 3's `RECLAIM-BEGIN`…`RECLAIM-END` region and ws-reap's `MIRROR-BEGIN`…`MIRROR-END` block sit between `cmd_clip` (≈23585) and `# Guard so the script can be \`source\`d …` (≈26581). Task 2's block still goes directly above the guard: below every anchor, and outside both marked blocks, which `ccd-wsaudit-nonpoison.test.ts` cuts out before counting refusal tokens (measured with Task 2 in: `3 passed`, and `wsaudit` `24 passed`). Numstat `190	25`, as before.
16. **gh 2.45 carries the exact-SHA binding into its queue path — read statically, not measured.** From the installed binary with `strings` (`dpkg -s gh`: `2.45.0-1ubuntu0.3`; gh itself was not run): a package-local `merge.EnablePullRequestAutoMergeInput` with `ExpectedHeadOid json:"expectedHeadOid,omitempty"`, the `enablePullRequestAutoMerge(input: $input)` mutation, and `shouldAddToMergeQueue`, `mergeQueueRequired`, `isMergeQueueEnabled`. gh adds a PR to a required queue through that mutation, so `--match-head-commit` is expected to bind the enqueue. A binary's strings are not the call's behaviour: Task 7's proof run measures it, with a deliberately wrong sha that must be refused (Step 5 (a0), stop rules 4 and 7). The same help text says a PR whose required checks have NOT passed gets auto-merge armed instead of a queue entry — finding 20.
17. **The citation census at `6da36f0b`:** `byFile` `ccd/ccd` 148, `ccd/ccrc` 5, `ccd/compact-card.mjs` 4, `ccd/session-hook.sh` 21, `deploy/deploy.sh` 2, `server/test/ccd-workspaces.test.ts` 5, `server/test/ccd-ws-reap.test.ts` 2, `server/test/single-definition.test.ts` 8, `shared/api.ts` 1 — total 196; `|`-row array 53, site array 36. Stated == base == tree after Task 2 (`--files ccd/ccd,README.md`) and after Task 4 (`--files ccd/session-hook.sh`), every composition empty; the re-pointer prints `ccd/ccd:21482` and `ccd/ccd:20215-20217` and leaves README byte-identical; the citation cases `7 passed | 328 skipped (335)` after every task.
18. **The deny under wave 1, measured.** With wave 1's advisory on the base, row H8 (a deny no longer supersedes advice) is RED — `the advisory won and the merge went through` — where at `905360dc` and `af64d9d2` nothing put a non-deny envelope on a Bash call and the row was green. Wave 1's own `session-hook-sync-advisory` stays `37 passed` and `update-branch-absent` `2 passed` with the deny in: the block spells no `update-branch`, and it replaces the advisory only when it fires.
19. **The typecheck needs `agent/node_modules`.** `server`'s `tsc --noEmit` reaches `agent/src/server.ts`, which imports `ws`; on a copy without `agent/`'s modules it reports `TS2307: Cannot find module 'ws'` — an environment gap, measured, then green with them installed.
20. **gh 2.45 ARMS auto-merge, rather than queueing, a PR whose required checks have not passed — and prints the same line either way** (the correctness review's blocker; read statically with `strings` from the installed binary, gh not run). Its `pr merge` help reads "If required checks have not yet passed, auto-merge will be enabled." and "If required checks have passed, the pull request will be added to the merge queue.", and the queue path's only success message is `%s Pull request #%d will be added to the merge queue for %s when ready`. An armed PR has no queue entry and no queue act, so Task 2's read answers `none`, and `sweepLanding` — which fires on `dequeued` or a merge — says nothing: a coordinator that enqueued and ended its turn would wait at `merging` for ever, holding the child. An armed request can also queue a head no review read: GitHub disarms auto-merge on a push only from a login WITHOUT write access (documented, not measured here), and the fleet pushes with one write-scoped login, so a fix round's new head would queue once green. The server lane is unchanged — it cannot tell "armed" from "not enqueued yet", and says so in its docstring. The coordinator's rule carries it (Task 5): enqueue only once `gh pr checks <pr> --required` exits 0 (`--required` — "Only show checks that are required" in the same binary — because the non-required macOS legs gate nothing, by the operator's 2026-09-28 ruling, and a red one must not block a landing), read the queue entry back, and disarm with `gh pr merge <pr> --disable-auto` (the flag is in the same binary) what only armed, and before any fix round from `merging`. Task 7 Step 5 (a1) measures the armed path, and whether an armed request survives this login's push.
21. **The quote strip read an apostrophe in a `#` comment, or a backslash-escaped quote, as the start of a '…' span** (measured at review through the real hook under a wave hold: `# don't merge until CI is green` / `gh pr merge 42` / `echo 'done'`, and `echo it\'s time; gh pr merge 42; echo 'ok'`, both passed). The strip now removes, leftmost first as bash reads them, a backslash escape, a '…' span, a `$(`-free "…" span and a `#` comment that starts a word, in the same jq (no new fork); re-probed on this fix round's prototype, both spellings are denied, `echo hi # gh pr merge 42` passes, and `x=${#y}; gh pr merge 42` and `echo 'a\' ; gh pr merge 42` are still denied (a `#` inside `${…}` starts no comment; a backslash inside '…' escapes nothing). The header now names what still passes unparsed, a wrapper's own flags among it (`sudo -E`, `command -p`, and an unlisted wrapper such as `nice -n 5`, each measured passing). Rows H18, H19.
22. **A coordinator can carry a wave hold or the child marker.** `POST /api/runs` refuses `claimant-is-a-worker` only for a claimant OTHER than itself, then places `program:<slug> wave:N/M run:<id>` on the named workspace — the coordinator's own, on a self-claimed run (`server/src/coord/routes.ts` ≈1340–1366 and ≈1460 at `6da36f0b`); and `POST /api/runs/:id/reclaim` admits the programme's own live worker as heir (`reclaim.ts` ≈325–347), which keeps its worker run's hold and its child marker. The hook cannot tell either from a worker, so it refuses its enqueue (probed at review: deny, with and without `--match-head-commit`). Closing to shed the hold would reclaim the coordinator's own pane (a final close of a child reclaims it), so Task 5's paragraph sends such a coordinator to the operator's shell; and Task 7 Step 1's census stops on either shape before the queue is turned on — it now also fails CLOSED on a read of the open runs that did not answer (the old one printed `census-done` alone when `jq` was missing, the call failed or the body had no `.runs`).
23. **A dequeue's why is the queue's own run.** `statusCheckRollup` is the PR head's checks; a queue failure is the `merge_group` run on the `gh-readonly-queue/<base>/pr-<n>-…` commit, which that rollup never includes — so the old brief read green and re-enqueued into the same red, one CI run and one fresh `dequeued:` per round. The brief and the paragraph now find the run with `gh run list --event merge_group` by its `headBranch` and read it with `gh run view <id> --log-failed` (flags and fields read statically from gh 2.45); `mergeStateStatus` still answers a conflict. Rows L22, S16.
24. **The last wave had no landing rule.** The paragraph opened "once … wave N+1 is open", and SKILL.md step 7 and `wave-lifecycle.md` §6 — the last wave's close — said to close `final:true` outright: a last producer closed before its PR lands retires the programme and is reclaimed under a PR still queued, and nothing can then hear its dequeue (finding 12 (i)). Step 7 and §6 now point at the rule, and the paragraph names the last wave; rows S9, S10.
25. **Three guards the plan argued for had no test** (the tests review, each measured): the merged arm's deferral on an unreadable run row and its latch-after-mail (either mutation stayed `16 passed`), the deny's rule never to replace the graph gate's counted deny (dropping the conjunct stayed `9 passed`, and `session-hook` `335 passed`), and the dequeue record's presence exemption (`recordAlways: false` stayed green — the harness never made the pane visible). Each now has a case and a row: L19, L20, H17, L21. And two of the census's own claims were wrong: close.ts's two edited lines are 610 and 612, one line apart (finding 14); and `ccd-prhistory.test.ts` runs `cmd_pr_state --project` through the stamping pipe three times and was in no list — Task 2 Step 9 and Task 6 Step 3 now run it (`18 passed`).

---

## The citation tax, and the mutation tables, mechanised (S6-R11)

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

- [ ] **Write the census re-measurer** to `$SCRATCH/cite-remeasure.py` — landing-order wave 1's tool (the child-reclamation wave 1 tool with ONE change: the files it swaps back to the base are a `--files` argument, default `ccd/ccd,README.md`, and it prints every `byFile` key). This wave edits three cited files, one per task, so each task names its own: `--files ccd/ccd,README.md` (Task 2), `--files ccd/session-hook.sh` (Task 4); Task 3's `shared/api.ts` edits are in place and are proved by the citation cases alone.

```python
#!/usr/bin/env python3
"""Re-measure session-hook.test.ts's citation census FROM THE INSTRUMENT (S6-R11).

The child-reclamation wave-1 plan's tool, with ONE change: the set of files it
swaps back to <base-ref> is `--files` (comma-separated, default
`ccd/ccd,README.md`, which is the original tool exactly), because this wave
edits cited files other than `ccd/ccd` — `ccd/session-hook.sh`, `ccd/ccrc` and
`README.md`. Everything else is the original: it runs ONLY the citation cases
twice — once with the named files as they stand at <base-ref>, once as they
stand in the working tree — each time with four dump probes inserted above the
assertions they feed, restores every file it touched byte-for-byte (asserted),
and prints what the test STATES, what the instrument MEASURES, and the
COMPOSITION (which references entered and which left, base -> tree).
With --write it rewrites exactly four literals in the test — `'ccd/ccd': N` in
the byFile map, `.toBe(N)` on `total`, and the two ref arrays of the `|`-row
case — in the instrument's own order. It never edits a comment.
usage: python3 cite-remeasure.py <scratch-dir> <base-ref> [--files a,b,c] [--write]
"""
import collections, json, os, re, shutil, subprocess, sys
scratch, base = sys.argv[1], sys.argv[2]; write = '--write' in sys.argv
FILES = ('ccd/ccd', 'README.md')
if '--files' in sys.argv:
    FILES = tuple(sys.argv[sys.argv.index('--files') + 1].split(','))
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

saved = {p: open(p, encoding='utf8').read() for p in FILES}
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
stated_total = re.search(r"this is it'\)\.toBe\((\d+)\);", src).group(1)
print(f"files swapped to {base}: {', '.join(FILES)}")
for key in sorted(set(B[0]) | set(by)):
    m = re.search(r"^      '" + re.escape(key) + r"': (\d+),$", src, re.M)
    flag = '' if (m and int(m.group(1)) == B[0].get(key) == by.get(key)) else '   <-- MOVED or unstated'
    print(f"byFile[{key!r}]  stated {m.group(1) if m else '-'}  base {B[0].get(key)}  tree {by.get(key)}{flag}")
print(f"total              stated {stated_total}  base {sum(B[0].values())}  tree {total}")
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

**The procedure, per task that edits a cited file** (each task restates it as numbered steps):

1. Re-stamp `ccd/ccd` if it was edited.
2. `SCRATCH=<abs path>; python3 "$SCRATCH/repoint-readme.py"` — expected: README byte-identical (`git diff --quiet -- README.md && echo readme-untouched`).
3. `SCRATCH=<abs path>; python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD --files <the task's files>` — read-only. **If any `base` differs from its `stated`, the tree was red before your edit: stop and report it.** Expected at `6da36f0b` (finding 17): every `byFile` key `stated N base N tree N` with no `<-- MOVED` (`ccd/ccd` 148 … `shared/api.ts` 1), `total stated 196 base 196 tree 196`, arrays 53 and 36, every `ENTERED`/`LEFT` empty. If child-reclamation wave 4 has landed first, its `shared/api.ts` insertion will have moved the base's `'shared/api.ts'` entry and total: read them from the base, never from this plan; what must hold is stated == base == tree.
4. The citation cases green: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'` → `7 passed | 328 skipped (335)`.
5. **Both corpus documents byte-identical to `origin/main`**:

       git fetch origin main && git diff --quiet origin/main -- \
         docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
         docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen

   Expected: `corpus-frozen`.

- [ ] **Write the mutation runner** to `$SCRATCH/mutate.py` — landing-order wave 1's runner with two changes, both for the loaded fleet box: each named test file runs in its OWN vitest process with `--maxWorkers=1`, and a row may carry `"restamp": true` (re-stamp `ccd/ccd` after the edit, so `ownership` never confounds a red) and `"t"` (passed as `-t`). A test named `pwa:test/…` runs from `pwa/`. It copies the file ASIDE into the scratchpad (never `git checkout --`, which restores to HEAD and eats uncommitted work; never beside the file — a backup inside a skill directory reds that skill's reference census on every row), applies one exact replacement (refusing an `old` that is not unique), prints each file's totals and first failures, restores the copy and asserts byte-equality:

```python
#!/usr/bin/env python3
"""Mutation runner (one vitest FILE per process, foreground). Run from the tree root.

usage: mutate.py <spec.json> [row ids...]
spec.json: [{"id": "M1", "file": "rel/path", "old": "...", "new": "...",
             "tests": ["test/x.test.ts" | "pwa:test/y.test.tsx"], "restamp": false, "t": "optional -t filter"}]
Each row: copy the file ASIDE into the scratchpad (never `git checkout --`),
replace exactly one occurrence of `old` with `new` (refusing an `old` that is
not unique), re-stamp ccd/ccd if asked, run each named test file in its own
vitest process from server/ (or pwa/), print the totals and the first failing
titles and assertion lines, restore the copy, and assert byte-equality."""
import json, os, re, shutil, subprocess, sys

ROOT = os.getcwd()
HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, 'mutate.log')
spec = json.load(open(sys.argv[1]))
only = set(sys.argv[2:])


def say(s):
    print(s)
    with open(LOG, 'a') as f:
        f.write(s + '\n')


say(f'### mutate.py {os.path.basename(sys.argv[1])} root={ROOT}')
for row in spec:
    if only and row['id'] not in only:
        continue
    path = os.path.join(ROOT, row['file'])
    backup = os.path.join(HERE, 'mutbak-' + row['id'])
    shutil.copy2(path, backup)
    stamp_backup = None
    orig = open(path, 'rb').read()
    try:
        text = orig.decode('utf8')
        n = text.count(row['old'])
        if n != 1:
            say(f"== {row['id']}: SKIPPED — `old` occurs {n} times in {row['file']}")
            continue
        open(path, 'w', encoding='utf8').write(text.replace(row['old'], row['new'], 1))
        if row.get('restamp'):
            stamp_backup = open(os.path.join(ROOT, 'ccd/ccd'), 'rb').read() if row['file'] != 'ccd/ccd' else None
            subprocess.run(['node', '--input-type=module', '-e',
                            "import { readFileSync, writeFileSync } from 'node:fs';"
                            "const { markGenerated } = await import('./shared/mark.mjs');"
                            "writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"], check=True)
        say(f"== {row['id']}: {row['file']}")
        for t in row['tests']:
            pkg, tf = ('pwa', t[4:]) if t.startswith('pwa:') else ('server', t)
            args = ['./node_modules/.bin/vitest', 'run', '--maxWorkers=1', tf]
            if row.get('t'):
                args += ['-t', row['t']]
            r = subprocess.run(args, cwd=os.path.join(ROOT, pkg), capture_output=True, text=True, timeout=590)
            out = re.sub(r'\x1b\[[0-9;]*m', '', r.stdout + r.stderr)
            tot = [l.strip() for l in out.splitlines() if re.match(r'\s*Tests\s', l)]
            fails = [l.strip() for l in out.splitlines() if l.strip().startswith('FAIL ')]
            errs = [l.strip() for l in out.splitlines() if re.match(r'\s*(AssertionError|TypeError|Error):', l)]
            say(f"   [{pkg}] {tf}  rc={r.returncode}  {tot[-1] if tot else '(no totals)'}")
            for f in fails[:6]:
                say('      ' + f[:300])
            for e in errs[:4]:
                say('      ' + e[:360])
    finally:
        shutil.copy2(backup, path)
        os.remove(backup)
        if stamp_backup is not None:
            open(os.path.join(ROOT, 'ccd/ccd'), 'wb').write(stamp_backup)
        assert open(path, 'rb').read() == orig, f'{path} was not restored byte-for-byte'
say('all restored')
```

Use: write a task's rows to `$SCRATCH/mut-<task>.json`, then from the worktree root `python3 "$SCRATCH/mutate.py" "$SCRATCH/mut-<task>.json"` (optionally followed by row ids). One vitest process at a time, in the foreground. After the run, `git status --short` must list exactly the files the task changed.

---

### Task 1: `ci.yml` answers the merge queue — a queue run runs what a pull request runs

**Model routing:** `sonnet`, effort `high` — one workflow file on CI test selection's shape, the two selector modules' pull-request arm, and four test files, three of them CI selection's own.

**Files:**
- Modify: `.github/workflows/ci.yml` — a `merge_group` row in the header's mode table; `merge_group:` directly after `  pull_request:`; ONE arm in the existing `concurrency.group`, with its paragraph; the `select` job's pipeline check runs on a queue run too, against the queue's base sha; `test-macos`'s and `full-suite`'s existing `if:` each gain a leading `github.event_name != 'merge_group' && ` conjunct. `probe-macos` is NOT edited: its event allow-list already keeps a queue run out, and `ci-pipeline.test.ts` pins it with `toBe`.
- Modify: `.github/ci/select.mjs` — `decideMode`'s rule 1 and `modeInvariantViolation`'s first arm take `merge_group` beside `pull_request`, with their docstrings
- Modify: `.github/ci/verdict.mjs` — `serverVerdict`'s `tests: none` arm refuses `merge_group` as it refuses `pull_request`, with its docstring
- Modify: `CLAUDE.md` — the **What CI runs** bullet gains one sentence (a queue run)
- Test: `server/test/ci-merge-queue.test.ts` (new); `server/test/ci-pipeline.test.ts`, `server/test/ci-select-cli.test.ts`, `server/test/ci-verdict.test.ts` (modify)

**Interfaces:**
- Consumes: CI test selection's shape on `main` (#183): the mode table in `ci.yml`'s header; `decideMode`, `modeInvariantViolation` (`.github/ci/select.mjs`) and `serverVerdict` (`.github/ci/verdict.mjs`); the one top-level `concurrency:` block whose `pull_request` arm is `ci-<workflow>-pr-<number>` and cancels; the `select` job's plain-bash pipeline check; `test-macos` (matrix, job-level `if:`), `probe-macos` (event allow-list), `full-suite` (`full` mode only, needs `test-macos`, reds on a skipped leg). GitHub's documented behaviour: a queue runs the required checks on `merge_group` events; a job skipped by `if:` reports success; one PENDING run per concurrency group; a `merge_group` event carries no `github.base_ref` and names its base as `github.event.merge_group.base_sha`.
- Produces: required checks (`test (server)`, `test (agent)`, `test (pwa)`, `build-pwa`) that report on a queue's group, from the SELECTED server tests plus every other required leg in full — exactly a pull request's run (the operator's 2026-09-28 ruling; and the 2026-09-23 CI ruling: selected on a PR, full daily and at the stable gate, no full run per merge); a queue run's own concurrency group `ci-<workflow>-queue-<run id>`, never cancelled; no macOS leg and no `full-suite` on a queue run. Task 7's proof run consumes all of it.

**Why `full-suite` needs the skip even though a queue run is `selected`:** a `selected` run FALLS BACK to `full` on any selection fallback (`select.mjs`'s `testsOut = 'full'`: no map, an unreadable one, a `.github/` change, a lockfile), and `full-suite` runs in `full` mode, needs `test-macos` — which a queue run skips — and its first step reds on a skipped leg. Without the conjunct, every queue run that fell back would carry a red `full-suite` (non-required, so the queue would not wait on it, but the run would conclude `failure`). Measured: Pre-flight finding 13.

**Why the pipeline check runs on a queue run:** it is what keeps a pull request that edits `.github/ci/select-tests.mjs` from choosing its own tests, and the queue run is the one that gates the merge. Left `pull_request`-only (`ci-pipeline.test.ts` pinned it so), a queue run would run the selector the entry itself changed.

- [ ] **Step 0: Confirm the base — wave 1 merged, this branch fresh from `main`**

```bash
git fetch origin main && git merge-base --is-ancestor origin/main HEAD && echo "branch carries origin/main"
grep -c '^15\. ' ccd/coordinator-skill/SKILL.md
grep -c 'update-branch' ccd/coordinator-skill/SKILL.md
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected: `branch carries origin/main`; `1` (coordinator clause 15 exists — wave 1's); `1` (clause 15 names it once, to forbid it); `7 passed | 328 skipped (335)` (measured at `6da36f0b` with wave 1 applied). **A `0` on the second line means wave 1 has not merged: stop and report — Task 5 has nothing to append to and Task 4's advisory interplay is unmeasurable.** If `origin/main` is not an ancestor, merge it (`git merge --no-edit origin/main`) and stop on any conflict.

- [ ] **Step 1: Write the failing test** — `server/test/ci-merge-queue.test.ts`:

```typescript
/**
 * The merge queue's half of `.github/workflows/ci.yml` (landing-order stage 2,
 * spec §5.2), on CI test selection's shape (#183). Five properties, each read
 * from the file or from the modules it runs, never trusted to a comment:
 *
 *  1. `merge_group` is a trigger. Without it a queue entry's required checks
 *     never report, and the queue removes the entry at its timeout.
 *  2. A queue run has a concurrency group of its OWN, and nothing cancels it.
 *     GitHub keeps one PENDING run per group and cancels the older one even
 *     with `cancel-in-progress: false`, so a queue run in the shared `refresh`
 *     group (or any group another run shares) could lose its checks.
 *  3. A queue run skips every macOS job and every job that needs one
 *     (`full-suite`), and NOTHING a required check needs mentions
 *     `merge_group` — but for the one step that asks the pipeline question of
 *     a queue run too. The second half is the dangerous one: GitHub reports a
 *     job skipped by `if:` as passing, so a required leg that skipped the
 *     queue would let the queue merge a tree nobody tested.
 *  4. A queue run runs what a pull request runs (operator ruling 2026-09-28):
 *     the header's mode table says so, and `decideMode` agrees for every input.
 *  5. The selector and the verdict agree on which triggers may never answer
 *     `tests: none` — derived from `on:`, so a trigger added to one module's
 *     pull-request arm and not the other's reds here.
 *
 * DERIVED, not listed: "a macOS job" is any job whose block says
 * `runs-on: macos-…`, "needs one" is the transitive `needs:` closure, and the
 * required legs' prerequisites are the closure of the three jobs that carry a
 * required name — so a job CI selection adds later is held to rule 3 without
 * this file learning its name.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideMode, modeInvariantViolation } from '../../.github/ci/select.mjs';
import { serverVerdict } from '../../.github/ci/verdict.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ci = (): string => readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

/** The lines of one TOP-LEVEL key's block: everything after `^<key>:` up to the
 *  next line that opens another top-level key. A SECOND block with the same key
 *  is a duplicate YAML key — invalid, and invisible to a reader that stops at
 *  the first — so this refuses one. */
function topBlock(yml: string, key: string): string[] {
  const lines = yml.split('\n');
  const heads = lines.flatMap((l, i) => (l === `${key}:` || l.startsWith(`${key}: `) ? [i] : []));
  expect(heads.length, `ci.yml carries ${heads.length} top-level \`${key}:\` keys`).toBe(1);
  const rest = lines.slice(heads[0]! + 1);
  const end = rest.findIndex((l) => /^[A-Za-z_][\w-]*:/.test(l));
  return end < 0 ? rest : rest.slice(0, end);
}

/** `jobs:` as job id -> that job's lines (every job key at two-space indent). */
function jobs(yml: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const l of topBlock(yml, 'jobs')) {
    const head = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(l);
    if (head) { cur = []; out.set(head[1]!, cur); continue; }
    cur?.push(l);
  }
  expect(out.size, 'parsed no jobs at all').toBeGreaterThan(0);
  return out;
}

/** Every occurrence of a job-level scalar key (four-space indent) — more than
 *  one is a duplicate key. */
function jobKeys(block: string[], key: string): string[] {
  return block.flatMap((l) => { const m = new RegExp(`^ {4}${key}: (.*)$`).exec(l); return m ? [m[1]!] : []; });
}

const needsOf = (block: string[]): string[] => {
  const v = jobKeys(block, 'needs')[0];
  return v === undefined ? [] : v.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
};

/** Split an expression at its TOP level (outside parentheses) on `op`. */
function topLevel(expr: string, op: ' && ' | ' || '): string[] {
  const parts: string[] = [];
  let depth = 0; let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && expr.startsWith(op, i)) { parts.push(expr.slice(start, i)); start = i + op.length; i += op.length - 1; }
  }
  parts.push(expr.slice(start));
  return parts.map((p) => p.trim());
}

const SKIP = "github.event_name != 'merge_group'";
const ALLOW_LIST = /^github\.event_name == '[a-z_]+'(?: \|\| github\.event_name == '[a-z_]+')*$/;

/** Whether a job-level `if:` keeps a `merge_group` run out: either the skip is
 *  one of its TOP-LEVEL conjuncts and it has no top-level `||` (a disjunct
 *  would route around the conjunct), or it is a pure event allow-list that does
 *  not name `merge_group`. */
function skipsQueue(cond: string | undefined): boolean {
  if (cond === undefined) return false;
  if (topLevel(cond, ' || ').length > 1) return ALLOW_LIST.test(cond) && !cond.includes('merge_group');
  return topLevel(cond, ' && ').includes(SKIP);
}

const onKeys = (): string[] => topBlock(ci(), 'on').flatMap((l) => { const m = /^ {2}([a-z_]+):/.exec(l); return m ? [m[1]!] : []; });

/** The ONE place the required closure may name the event: `select`'s pipeline
 *  check, a STEP (never a job-level condition), which asks a queue run the
 *  pull request's question against the queue's base (rule 4). */
const PIPELINE_STEP_LINES = [
  "        if: github.event_name == 'pull_request' || github.event_name == 'merge_group'",
  "          BASE: ${{ github.event_name == 'merge_group' && github.event.merge_group.base_sha || format('origin/{0}', github.base_ref) }}",
];

describe('ci.yml and the merge queue (landing-order stage 2, on CI selection\'s shape)', () => {
  it('triggers on merge_group, beside pull_request', () => {
    const on = onKeys();
    expect(on, 'ci.yml no longer triggers on pull_request').toContain('pull_request');
    expect(on, 'ci.yml does not trigger on merge_group — a queue entry would never get its required checks')
      .toContain('merge_group');
  });

  it('gives a queue run a concurrency group of its own, and never cancels one', () => {
    const block = topBlock(ci(), 'concurrency');
    const group = block.find((l) => l.startsWith('  group: ')) ?? '';
    // Run-unique: `github.run_id` is unique per run. An arm keyed on the ref,
    // the sha or the mode could be shared, and a shared group drops pending runs.
    expect(group, 'a merge_group run has no group of its own — it falls through to a shared one')
      .toContain("github.event_name == 'merge_group' && format('queue-{0}', github.run_id)");
    // …and it is taken BEFORE the shared push-to-main group can be reached.
    expect(group.indexOf("format('queue-{0}', github.run_id)"), 'the queue arm sits after the shared refresh arm')
      .toBeLessThan(group.indexOf("'refresh'"));
    expect(block, 'cancel-in-progress must be the pull_request event and nothing wider — a cancelled queue run removes the entry')
      .toContain("  cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });

  it('keeps every macOS job, and every job that needs one, off a queue run — and no required prerequisite mentions merge_group', () => {
    const all = jobs(ci());
    const isMac = (b: string[]): boolean => b.some((l) => /^ {4}runs-on: macos-/.test(l));
    // Guard the guard: a reader that parsed no macOS job makes the loop vacuous.
    const macs = [...all].filter(([, b]) => isMac(b)).map(([n]) => n);
    expect(macs.length, 'parsed no macOS job at all — this test went blind').toBeGreaterThan(0);
    // Every job that needs a macOS job, transitively (full-suite needs test-macos).
    const needsMac = (id: string, seen = new Set<string>()): boolean => {
      if (seen.has(id)) return false; seen.add(id);
      return needsOf(all.get(id) ?? []).some((n) => macs.includes(n) || needsMac(n, seen));
    };
    const offQueue = [...all.keys()].filter((id) => macs.includes(id) || needsMac(id));
    expect(offQueue, 'full-suite no longer needs a macOS leg — re-derive this rule').toContain('full-suite');
    for (const id of offQueue) {
      const conds = jobKeys(all.get(id)!, 'if');
      expect(conds.length, `job \`${id}\` carries ${conds.length} job-level if: keys`).toBeLessThanOrEqual(1);
      expect(skipsQueue(conds[0]), `job \`${id}\` runs on a merge_group run: ${conds[0] ?? '(no if:)'}`).toBe(true);
    }
    // The required legs and everything they need: none may mention merge_group,
    // because a required leg skipped by `if:` reads as PASSING to the queue.
    const req = new Set<string>();
    const walk = (id: string): void => { if (req.has(id)) return; req.add(id); needsOf(all.get(id) ?? []).forEach(walk); };
    ['server', 'test', 'build-pwa'].forEach(walk);
    expect([...req].sort()).toEqual(['build-pwa', 'select', 'server', 'server-shard', 'server-typecheck', 'test']);
    for (const id of req) {
      const code = (all.get(id) ?? []).filter((l) => !/^\s*#/.test(l) && !PIPELINE_STEP_LINES.includes(l)).join('\n');
      expect(code, `\`${id}\` mentions merge_group — a required leg skipped by if: reports as PASSING, and the queue would merge an untested tree`)
        .not.toContain('merge_group');
    }
  });

  it('runs what a pull request runs: the mode table has the row, and decideMode agrees for every input', () => {
    const header = ci().split('\n').filter((l) => l.startsWith('#'));
    const row = (ev: string): string | undefined => header.map((l) => new RegExp(`^#   ${ev}\\s{2,}(\\w+)`).exec(l)?.[1]).find(Boolean);
    expect(row('merge_group'), 'the header mode table has no merge_group row').toBeDefined();
    expect(row('merge_group')).toBe(row('pull_request'));
    expect(row('merge_group')).toBe(decideMode({ event: 'merge_group', fullGreen: false }).tests);
    for (const inputMode of [undefined, 'full', 'rebuild']) {
      for (const fullGreen of [false, true]) {
        expect(decideMode({ event: 'merge_group', inputMode, fullGreen }), `inputMode=${inputMode} fullGreen=${fullGreen}`)
          .toEqual(decideMode({ event: 'pull_request', inputMode, fullGreen }));
      }
    }
  });

  it('the selector and the verdict agree on which triggers may never answer tests: none', () => {
    const events = onKeys();
    expect(events.length, 'parsed no triggers').toBeGreaterThan(0);
    for (const event of events) {
      const neverNone = [undefined, 'full', 'rebuild'].every((inputMode) =>
        [false, true].every((fullGreen) => decideMode({ event, inputMode, fullGreen }).tests !== 'none'));
      expect(modeInvariantViolation(event, undefined, 'none') !== null, `${event}: select.mjs's invariant disagrees with decideMode`)
        .toBe(neverNone);
      const v = serverVerdict({ select: 'success', typecheck: '', shards: '', tests: 'none', count: '', event });
      expect(v.ok, `${event}: verdict.mjs reads tests: none as ${v.ok ? 'green' : 'red'}, decideMode says it ${neverNone ? 'can never' : 'can'} happen`)
        .toBe(!neverNone);
    }
  });
});
```

- [ ] **Step 2: Write the failing cases in CI selection's own three test files.**

(a) `server/test/ci-verdict.test.ts` — the exhaustive table crosses a third event, and its independent oracle gains the ruling. Replace

```typescript
const EVENTS = ['pull_request', 'push'];
```

with

```typescript
// `merge_group` since landing-order wave 2: a merge-queue run runs what a pull
// request runs (operator ruling 2026-09-28), so it never answers tests none.
const EVENTS = ['pull_request', 'push', 'merge_group'];
```

and replace

```typescript
  if (tests === 'none') return event !== 'pull_request';
```

with

```typescript
  if (tests === 'none') return event !== 'pull_request' && event !== 'merge_group';
```

and directly after the `it('tests none on a pull_request -> red: a pull request always runs server tests (ruling T2)', …)` case's closing `  });`, insert:

```typescript

  it('tests none on a merge_group -> red too: a merge-queue run runs what a pull request runs (operator ruling 2026-09-28)', () => {
    const v = serverVerdict({
      select: 'success', typecheck: '', shards: '', tests: 'none', count: '', event: 'merge_group',
    });
    expect(v).toEqual({ ok: false, reason: expect.stringContaining('merge_group') });
  });
```

(b) `server/test/ci-select-cli.test.ts` — in `describe('modeInvariantViolation: what a trigger can never answer (ruling T2)'`, directly after the `it('a pull_request never answers tests none', …)` case's closing `  });`, insert:

```typescript

  it('a merge_group never answers tests none either — a queue run runs what a pull request runs (operator ruling 2026-09-28)', () => {
    expect(modeInvariantViolation('merge_group', undefined, 'none')).toMatch(/merge_group/);
    expect(modeInvariantViolation('merge_group', undefined, 'selected')).toBeNull();
    expect(modeInvariantViolation('merge_group', 'full', 'full')).toBeNull();
  });
```

and in `describe('select.mjs CLI — pull_request'`, directly after the first case (`it('enforce: selects exactly the rule-3/4/2 files, table carries the reasons, matrices carry only the selection', …)`)'s closing `  });`, insert:

```typescript

  it('merge_group (a merge-queue run) -> the SAME selection as the pull request, matrices and all (operator ruling 2026-09-28)', () => {
    const { repo, mapFile, baseSha } = buildMainFixture();
    const pr = runSelect(repo, { event: 'pull_request', selection: 'enforce', mapFile });
    const queue = runSelect(repo, { event: 'merge_group', selection: 'enforce', mapFile });
    expect(queue.status).toBe(0);
    expect(queue.outputs.tests).toBe('selected');
    expect(queue.outputs.map_sha).toBe(baseSha);
    expect(queue.outputs.count).toBe(pr.outputs.count);
    expect(queue.outputs.server_matrix).toBe(pr.outputs.server_matrix);
    expect(queue.summary).toContain('- event: `merge_group`');
  });
```

(c) `server/test/ci-pipeline.test.ts` — four edits. In `it('full-suite needs every leg — …', …)` replace

```typescript
    expect(jobKey(b, 'if')).toBe("always() && needs.select.outputs.tests == 'full'");
```

with

```typescript
    // Never on a merge-queue run (landing-order stage 2): a queue run skips
    // test-macos, and a queue run that fell back to `full` would read that skip
    // as a red leg here (ci-merge-queue.test.ts derives the rule).
    expect(jobKey(b, 'if')).toBe("always() && github.event_name != 'merge_group' && needs.select.outputs.tests == 'full'");
```

In `describe('ci.yml: a pull request that changes the pipeline runs everything, decided in plain bash (ruling T3)'`, replace

```typescript
  it('runs only on pull_request, and hands select --input-mode full when it answers changed=true', () => {
    expect(pipelineStep()).toMatch(/^ {8}if: github\.event_name == 'pull_request'$/m);
```

with

```typescript
  it('runs on pull_request and on merge_group, and hands select --input-mode full when it answers changed=true', () => {
    // A merge-queue run asks the same question (operator ruling 2026-09-28:
    // it runs what a pull request runs), or a pull request that edits the
    // selector would choose the tests of the queue run that gates its merge.
    expect(pipelineStep()).toMatch(/^ {8}if: github\.event_name == 'pull_request' \|\| github\.event_name == 'merge_group'$/m);
    // A queue run has no base_ref; its base is the sha the queue built on.
    expect(pipelineStep()).toMatch(/^ {10}BASE: \$\{\{ github\.event_name == 'merge_group' && github\.event\.merge_group\.base_sha \|\| format\('origin\/\{0\}', github\.base_ref\) \}\}$/m);
```

and replace the three `runStep` environments by content — `{ BASE_REF: 'main' }` (three occurrences) → `{ BASE: 'origin/main' }`, and `{ BASE_REF: 'nope' }` (one) → `{ BASE: 'origin/nope' }`:

```bash
sed -i "s/{ BASE_REF: 'main' }/{ BASE: 'origin\/main' }/g; s/{ BASE_REF: 'nope' }/{ BASE: 'origin\/nope' }/" server/test/ci-pipeline.test.ts
grep -c "BASE_REF" server/test/ci-pipeline.test.ts
```

Expected: `0`. Then, directly after the `it('diffs from the merge base, so a pipeline change main made since the branch point is not this pull request\'s', …)` case's closing `  });`, insert:

```typescript

  it('a merge-queue run asks it too, against the base sha the queue built its group on', () => {
    // `prRepo`'s origin/main is the base the entry sits on; a queue run names
    // it by sha (`merge_group.base_sha`), never by a branch name it lacks.
    const head = (dir: string): string => execFileSync('git', ['rev-parse', 'origin/main'], { cwd: dir, encoding: 'utf8' }).trim();
    const pipe = prRepo('.github/ci/select-tests.mjs');
    expect(runStep(pipelineStep(), pipe, { BASE: head(pipe) })).toMatchObject({ status: 0, output: 'changed=true\n' });
    const other = prRepo('server/y.ts');
    expect(runStep(pipelineStep(), other, { BASE: head(other) })).toMatchObject({ status: 0, output: 'changed=false\n' });
  });
```

- [ ] **Step 3: Run them to verify they fail — one file at a time**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-merge-queue.test.ts
./node_modules/.bin/vitest run test/ci-verdict.test.ts
./node_modules/.bin/vitest run test/ci-select-cli.test.ts
./node_modules/.bin/vitest run test/ci-pipeline.test.ts
```

Expected (measured at `6da36f0b` with wave 1 applied, each file alone, `--maxWorkers=1`):

- `ci-merge-queue` — `4 failed | 1 passed (5)`: "triggers on merge_group…" (`expected [ 'push', 'pull_request', …(3) ] to include 'merge_group'`), "gives a queue run a concurrency group of its own…" (`a merge_group run has no group of its own — it falls through to a shared one`), "keeps every macOS job…" (``job `test-macos` runs on a merge_group run: needs.select.outputs.macos_count != '0' && …``) and "runs what a pull request runs…" (`the header mode table has no merge_group row: expected undefined to be defined`). The agreement case passes before and after: with no `merge_group` trigger it has nothing to disagree about, and rows M11–M13 prove it is not vacuous.
- `ci-verdict` — `76 failed | 4447 passed (4523)`: the 75 exhaustive rows with `select='success' tests='none' event='merge_group'` (`reason: tests: none — nothing was selected to run: expected true to be false`) and the new named case.
- `ci-select-cli` — `2 failed | 39 passed (41)`: the new invariant case (`TypeError: .toMatch() expects to receive a string, but got object` — the arm answers `null`) and the new CLI case (`expected 'full' to be 'selected'` — `merge_group` falls through `decideMode`'s rule 6 today).
- `ci-pipeline` — `5 failed | 34 passed (39)`: the moved step pin, the two `runStep` cases whose `BASE` the unedited script ignores, the new queue case, and the moved `full-suite` pin.

- [ ] **Step 4: The workflow.** Five edits to `.github/workflows/ci.yml`, each located by content.

(a) The mode table. Replace the three lines

```yaml
#   pull_request        selected — the server tests the change can affect
#                       (a measured dependency map, .github/ci/select-tests.mjs),
#                       sharded; agent, pwa, build-pwa and probe-macos in full.
```

with

```yaml
#   pull_request        selected — the server tests the change can affect
#                       (a measured dependency map, .github/ci/select-tests.mjs),
#                       sharded; agent, pwa, build-pwa and probe-macos in full.
#   merge_group         selected — a merge-queue run runs what a pull request
#                       runs (operator ruling 2026-09-28), the pipeline check
#                       included, in a concurrency group of its own; no macOS
#                       leg and no full-suite.
```

(b) The trigger. Directly after the line `  pull_request:` (one hit, ≈45 at `6da36f0b`; the next line is `  schedule:`), insert:

```yaml
  # THE MERGE QUEUE (landing-order stage 2, spec §5.2). A queue runs the
  # REQUIRED checks on the group it built before it merges, and a workflow that
  # does not listen for `merge_group` never reports them — the entry waits out
  # the queue's timeout and is removed. This trigger is on `main` BEFORE the
  # operator turns the queue on (the spec's rollout step 1). A queue run runs
  # what a pull request runs (the mode table above). `push` stays
  # `branches: [main]`, so the queue's own `gh-readonly-queue/main/*` branches
  # start no second run.
  merge_group:
```

(c) The concurrency group. Replace

```yaml
# called run would wait on the caller's own group.
concurrency:
  group: ci-${{ github.workflow }}-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || (github.event_name == 'push' && !inputs.mode) && 'refresh' || format('{0}-{1}-{2}', inputs.mode || 'full', github.event_name, github.ref_name) }}
```

with

```yaml
# called run would wait on the caller's own group.
#
# A MERGE-QUEUE RUN gets a group of its OWN, `queue-<run id>` (landing-order
# stage 2, spec §5.2), taken before the shared `refresh` group can be reached.
# GitHub keeps at most one PENDING run per group and cancels the older pending
# one even with `cancel-in-progress: false`: a queue run in a shared group
# could lose its checks, and the queue would remove the entry. Nothing cancels
# one either — `cancel-in-progress` stays the pull_request event alone.
concurrency:
  group: ci-${{ github.workflow }}-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || github.event_name == 'merge_group' && format('queue-{0}', github.run_id) || (github.event_name == 'push' && !inputs.mode) && 'refresh' || format('{0}-{1}-{2}', inputs.mode || 'full', github.event_name, github.ref_name) }}
```

(d) The pipeline check. In the `select` job replace

```yaml
      # A base it cannot diff against answers "changed": the safe direction.
      - name: Does this pull request change the pipeline?
        id: pipeline
        if: github.event_name == 'pull_request'
        env:
          BASE_REF: ${{ github.base_ref }}
        run: |
          if base=$(git merge-base "origin/$BASE_REF" HEAD) && changed=$(git diff --name-only "$base" HEAD -- .github/); then
```

with

```yaml
      # A base it cannot diff against answers "changed": the safe direction.
      # A MERGE-QUEUE RUN asks the same question of the same change (operator
      # ruling 2026-09-28: it runs what a pull request runs), against the sha
      # the queue built its group on — it has no `github.base_ref` — so a pull
      # request that edits the selector cannot choose its own queue run's tests.
      - name: Does this pull request change the pipeline?
        id: pipeline
        if: github.event_name == 'pull_request' || github.event_name == 'merge_group'
        env:
          BASE: ${{ github.event_name == 'merge_group' && github.event.merge_group.base_sha || format('origin/{0}', github.base_ref) }}
        run: |
          if base=$(git merge-base "$BASE" HEAD) && changed=$(git diff --name-only "$base" HEAD -- .github/); then
```

and, in the same step, replace

```yaml
            echo "::warning::could not diff this pull request against origin/$BASE_REF; treating its pipeline as changed"
```

with

```yaml
            echo "::warning::could not diff this change against $BASE; treating its pipeline as changed"
```

(e) The macOS leg and the job that needs it. Replace

```yaml
    needs: select
    if: needs.select.outputs.macos_count != '0' && (needs.select.outputs.tests == 'selected' || needs.select.outputs.tests == 'full')
```

with

```yaml
    needs: select
    # Never on a merge-queue run (landing-order stage 2): non-required, so the
    # queue does not wait for it, but every entry would still take the
    # organisation's scarce macOS slots. `probe-macos` keeps a queue run out by
    # its own event allow-list.
    if: github.event_name != 'merge_group' && needs.select.outputs.macos_count != '0' && (needs.select.outputs.tests == 'selected' || needs.select.outputs.tests == 'full')
```

and in `full-suite` replace

```yaml
    needs: [select, server, server-shard, server-typecheck, test, build-pwa, test-macos]
    if: always() && needs.select.outputs.tests == 'full'
```

with

```yaml
    needs: [select, server, server-shard, server-typecheck, test, build-pwa, test-macos]
    # Never on a merge-queue run: a queue run skips test-macos, and one that
    # fell back to `full` would read that skip as a red leg (landing-order
    # stage 2; a queue run is never the stable gate's evidence anyway —
    # main-artifact.mjs trusts no merge_group run).
    if: always() && github.event_name != 'merge_group' && needs.select.outputs.tests == 'full'
```

- [ ] **Step 5: The selector and the verdict — the pull-request arm takes the queue.**

In `.github/ci/select.mjs` replace

```javascript
 *   1. `pull_request`                          -> selected / none — or full / none with `inputMode === 'full'`,
 *                                                 which ci.yml passes when the PR changes `.github/` (a plain-bash
 *                                                 check, so a PR cannot talk its own selector out of a full run)
```

with

```javascript
 *   1. `pull_request` or `merge_group`         -> selected / none — or full / none with `inputMode === 'full'`,
 *                                                 which ci.yml passes when the change touches `.github/` (a
 *                                                 plain-bash check, so a PR cannot talk its own selector out of a
 *                                                 full run). A merge-queue run runs what a pull request runs
 *                                                 (operator ruling 2026-09-28, landing-order wave 2).
```

and

```javascript
export function decideMode({ event, inputMode, fullGreen }) {
  if (event === 'pull_request') {
```

with

```javascript
export function decideMode({ event, inputMode, fullGreen }) {
  if (event === 'pull_request' || event === 'merge_group') {
```

and

```javascript
 * What a trigger can never answer (ruling T2), checked on decideMode's answer before anything runs: a pull
 * request always runs server tests (never `none`), and a schedule, a refresh push or a rebuild never runs a
```

with

```javascript
 * What a trigger can never answer (ruling T2), checked on decideMode's answer before anything runs: a pull
 * request, and a merge-queue run (landing-order wave 2), always runs server tests (never `none`), and a
 * schedule, a refresh push or a rebuild never runs a
```

and

```javascript
  if (event === 'pull_request' && tests === 'none') return 'a pull_request answered tests: none';
```

with

```javascript
  if ((event === 'pull_request' || event === 'merge_group') && tests === 'none') return `a ${event} answered tests: none`;
```

In `.github/ci/verdict.mjs` replace

```javascript
 * so checking it there would read a `skipped` as a failure. A pull request
 * can never answer `none` (it always runs server tests — ruling T2), so
 * `none` with `event === 'pull_request'` is red; the event comes from the
 * workflow's own context, not from select's outputs.
```

with

```javascript
 * so checking it there would read a `skipped` as a failure. A pull request
 * can never answer `none` (it always runs server tests — ruling T2), and nor
 * can a merge-queue run, which runs what a pull request runs (operator ruling
 * 2026-09-28, landing-order wave 2), so `none` with `event === 'pull_request'`
 * or `'merge_group'` is red; the event comes from the workflow's own context,
 * not from select's outputs.
```

and

```javascript
  if (tests === 'none') {
    return event === 'pull_request'
      ? { ok: false, reason: 'tests: none on a pull_request — a pull request always runs server tests' }
```

with

```javascript
  if (tests === 'none') {
    return event === 'pull_request' || event === 'merge_group'
      ? { ok: false, reason: `tests: none on a ${event} — a pull request or a merge-queue run always runs server tests` }
```

and, in the same docstring's Rules list, replace

```javascript
 *   2. `tests === 'none'` -> ok (nothing was supposed to run) — except on a
 *      `pull_request`, which fails.
```

with

```javascript
 *   2. `tests === 'none'` -> ok (nothing was supposed to run) — except on a
 *      `pull_request` or a `merge_group`, which fails.
```

`select.mjs`'s macOS budget line (`event !== 'pull_request' && testsOut === 'full' ? PROFILES.macosFull : …`) is deliberately NOT edited: no job reads the macOS matrix on a queue run (Step 4 (e)), so an edit there would carry no test that could red.

- [ ] **Step 6: `CLAUDE.md`'s CI bullet.** In **What CI runs**, replace

```
  runs.** **A merge to `main`** runs no test legs: it re-traces the tests the merge affected and updates the map.
```

with

```
  runs.** **A merge-queue run** (`merge_group`) runs what a pull request runs, its pipeline check included, in a
  concurrency group of its own, and never the macOS legs or `full-suite` (operator ruling 2026-09-28). **A merge
  to `main`** runs no test legs: it re-traces the tests the merge affected and updates the map.
```

- [ ] **Step 7: Run the tests to verify they pass — one file at a time — and prove the YAML has no duplicate key**

```bash
cd server && ./node_modules/.bin/vitest run test/ci-merge-queue.test.ts
./node_modules/.bin/vitest run test/ci-pipeline.test.ts
./node_modules/.bin/vitest run test/ci-verdict.test.ts
./node_modules/.bin/vitest run test/ci-select-cli.test.ts
./node_modules/.bin/vitest run test/oss-metadata.test.ts
./node_modules/.bin/vitest run test/ci-main-artifact.test.ts
./node_modules/.bin/vitest run test/typecheck-tests.test.ts
cd .. && python3 -c "
import yaml, sys
class U(yaml.SafeLoader): pass
def m(loader, node, deep=False):
    keys = [loader.construct_object(k, deep=deep) for k, _ in node.value]
    d = [k for k in set(keys) if keys.count(k) > 1]
    if d: sys.exit(f'duplicate key(s) {d} at line {node.start_mark.line + 1}')
    return yaml.SafeLoader.construct_mapping(loader, node, deep)
U.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, m)
w = yaml.load(open('.github/workflows/ci.yml'), U)
print('yaml-ok', sorted(w[True].keys()))"
```

Expected (measured at `6da36f0b` with wave 1 applied): `ci-merge-queue` `5 passed (5)`; `ci-pipeline` `39 passed (39)`; `ci-verdict` `4523 passed (4523)`; `ci-select-cli` `41 passed (41)`; `oss-metadata` `22 passed (22)`; `ci-main-artifact` `16 passed (16)` (it trusts no `merge_group` run, and was not edited); `typecheck-tests` PASS (the new file imports both `.mjs` modules the way `ci-select-cli` and `ci-verdict` already do); and `yaml-ok ['merge_group', 'pull_request', 'push', 'schedule', 'workflow_call', 'workflow_dispatch']` — a strict duplicate-key loader, because the text-reading pins cannot see a second `concurrency:` or `if:` key (the 2026-09-28 re-measure applied the old Steps 4–5 literally and got a file PyYAML's duplicate-key loader refuses while `ci-pipeline` stayed green).

- [ ] **Step 8: Mutation check, then commit**

Fifteen mutations, each restored from a saved COPY (never `git checkout --`), run with the mutation runner (`$SCRATCH/mutate.py`, "The mutation tables, mechanised") one test FILE per process. Every red below was measured at `6da36f0b` with wave 1 applied; "only" means every other case in that file stayed green:

| # | Exact edit | Test file(s) | Expected red (measured) |
|---|---|---|---|
| M1 | `ci.yml`: delete the line `  merge_group:` | `ci-merge-queue` | `1 failed \| 4 passed` — "triggers on merge_group…" only: `expected [ 'push', 'pull_request', …(3) ] to include 'merge_group'` |
| M2 | `ci.yml`: delete ` \|\| github.event_name == 'merge_group' && format('queue-{0}', github.run_id)` from the group | `ci-merge-queue` | `1 failed` — "gives a queue run a concurrency group of its own…": `a merge_group run has no group of its own — it falls through to a shared one` |
| M3 | `ci.yml`: `format('queue-{0}', github.run_id)` → `format('queue-{0}', github.ref_name)` (a group two runs could share) | `ci-merge-queue` | `1 failed` — same case, same message |
| M4 | `ci.yml`: `  cancel-in-progress: ${{ github.event_name == 'pull_request' }}` → `  cancel-in-progress: ${{ github.event_name != 'push' }}` (cancels queue runs) | `ci-merge-queue`, `ci-pipeline` | `1 failed` each — `cancel-in-progress must be the pull_request event and nothing wider — a cancelled queue run removes the entry`; and "cancels superseded runs for pull requests only…" |
| M5 | `ci.yml` `test-macos`: `    if: github.event_name != 'merge_group' && needs.select.outputs.macos_count` → `    if: needs.select.outputs.macos_count` | `ci-merge-queue` | `1 failed` — "keeps every macOS job…": ``job `test-macos` runs on a merge_group run: …`` |
| M6 | `ci.yml` `full-suite`: drop the `github.event_name != 'merge_group' && ` conjunct | `ci-merge-queue`, `ci-pipeline` | `1 failed` each — ``job `full-suite` runs on a merge_group run: always() && needs.select.outputs.tests == 'full'``; and "full-suite needs every leg…" (`expected 'always() && needs.select.outputs.test…' to be 'always() && github.event_name != \'me…'`) |
| M7 | `ci.yml` `probe-macos`: `    if: github.event_name == 'pull_request' \|\| github.event_name == 'schedule'` → `    if: github.event_name != 'push'` | `ci-merge-queue`, `ci-pipeline` | `1 failed` each — ``job `probe-macos` runs on a merge_group run: github.event_name != 'push'``; and "probe-macos runs on pull requests and the daily schedule only…" |
| M8 | `ci.yml` `build-pwa`: add `    if: github.event_name != 'merge_group'` under its `# Required by name…` comment (a required leg skipped on the queue) | `ci-merge-queue`, `ci-pipeline` | `1 failed` each — ``\`build-pwa\` mentions merge_group — a required leg skipped by if: reports as PASSING, and the queue would merge an untested tree``; and "the required matrix and build-pwa carry no job-level if: and no needs:" |
| M9 | `ci.yml` `test`: `CCRC_LEG`'s skip condition gains ` \|\| github.event_name == 'merge_group'` (every STEP of `test (agent)`/`test (pwa)` skipped on a queue run — green without testing) | `ci-merge-queue`, `ci-pipeline` | `1 failed` each — ``\`test\` mentions merge_group — …``; and "the required legs skip by STEP, only on a refresh or a rebuild" |
| M10 | `ci.yml`: delete the four-line `merge_group` row of the mode table | `ci-merge-queue` | `1 failed` — "runs what a pull request runs…": `the header mode table has no merge_group row` |
| M11 | `select.mjs`: `  if (event === 'pull_request' \|\| event === 'merge_group') {` → `  if (event === 'pull_request') {` | `ci-merge-queue`, `ci-select-cli` | `2 failed \| 3 passed` — "runs what a pull request runs…" (`expected 'selected' to be 'full'`) and the agreement case (`merge_group: select.mjs's invariant disagrees with decideMode: expected true to be false`); and the CLI case (`1 failed \| 40 passed`) |
| M12 | `select.mjs`: `modeInvariantViolation`'s arm back to `event === 'pull_request' && tests === 'none'` | `ci-merge-queue`, `ci-select-cli` | `1 failed` each — `merge_group: select.mjs's invariant disagrees with decideMode: expected false to be true`; and the invariant case |
| M13 | `verdict.mjs`: `    return event === 'pull_request' \|\| event === 'merge_group'` → `    return event === 'pull_request'` | `ci-merge-queue`, `ci-verdict` | `1 failed` — `merge_group: verdict.mjs reads tests: none as green, decideMode says it can never happen`; and `76 failed \| 4447 passed (4523)` |
| M14 | `ci.yml` pipeline step: `        if: github.event_name == 'pull_request' \|\| github.event_name == 'merge_group'` → `        if: github.event_name == 'pull_request'` | `ci-merge-queue`, `ci-pipeline` | `ci-merge-queue` GREEN (the step is its sanctioned exception; M14 is its control); `ci-pipeline` `1 failed` — "runs on pull_request and on merge_group…" |
| M15 | `ci.yml` pipeline step: the `BASE` line → `          BASE: ${{ format('origin/{0}', github.base_ref) }}` (a queue run would diff against `origin/` and run full every time) | `ci-merge-queue`, `ci-pipeline` | `ci-merge-queue` GREEN; `ci-pipeline` `1 failed` — the same case, on the exact `BASE` line |

Rows (`$SCRATCH/mut-task1.json`):

```json
[
 {"id": "M1", "file": ".github/workflows/ci.yml", "old": "  merge_group:\n", "new": "", "tests": ["test/ci-merge-queue.test.ts"]},
 {"id": "M2", "file": ".github/workflows/ci.yml", "old": " || github.event_name == 'merge_group' && format('queue-{0}', github.run_id)", "new": "", "tests": ["test/ci-merge-queue.test.ts"]},
 {"id": "M3", "file": ".github/workflows/ci.yml", "old": "format('queue-{0}', github.run_id)", "new": "format('queue-{0}', github.ref_name)", "tests": ["test/ci-merge-queue.test.ts"]},
 {"id": "M4", "file": ".github/workflows/ci.yml", "old": "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}", "new": "  cancel-in-progress: ${{ github.event_name != 'push' }}", "tests": ["test/ci-merge-queue.test.ts", "test/ci-pipeline.test.ts"]},
 {"id": "M5", "file": ".github/workflows/ci.yml", "old": "    if: github.event_name != 'merge_group' && needs.select.outputs.macos_count", "new": "    if: needs.select.outputs.macos_count", "tests": ["test/ci-merge-queue.test.ts"]},
 {"id": "M6", "file": ".github/workflows/ci.yml", "old": "    if: always() && github.event_name != 'merge_group' && needs.select.outputs.tests == 'full'\n", "new": "    if: always() && needs.select.outputs.tests == 'full'\n", "tests": ["test/ci-merge-queue.test.ts", "test/ci-pipeline.test.ts"]},
 {"id": "M7", "file": ".github/workflows/ci.yml", "old": "    if: github.event_name == 'pull_request' || github.event_name == 'schedule'\n", "new": "    if: github.event_name != 'push'\n", "tests": ["test/ci-merge-queue.test.ts", "test/ci-pipeline.test.ts"]},
 {"id": "M8", "file": ".github/workflows/ci.yml", "old": "    # Required by name, like `test`: no job-level `if:`, steps skip instead.\n", "new": "    # Required by name, like `test`: no job-level `if:`, steps skip instead.\n    if: github.event_name != 'merge_group'\n", "tests": ["test/ci-merge-queue.test.ts", "test/ci-pipeline.test.ts"]},
 {"id": "M9", "file": ".github/workflows/ci.yml", "old": "      CCRC_LEG: ${{ ((github.event_name == 'push' && !inputs.mode) || inputs.mode == 'rebuild') && 'skip' || 'run' }}\n    strategy:", "new": "      CCRC_LEG: ${{ ((github.event_name == 'push' && !inputs.mode) || inputs.mode == 'rebuild' || github.event_name == 'merge_group') && 'skip' || 'run' }}\n    strategy:", "tests": ["test/ci-merge-queue.test.ts", "test/ci-pipeline.test.ts"]},
 {"id": "M10", "file": ".github/workflows/ci.yml", "old": "#   merge_group         selected — a merge-queue run runs what a pull request\n#                       runs (operator ruling 2026-09-28), the pipeline check\n#                       included, in a concurrency group of its own; no macOS\n#                       leg and no full-suite.\n", "new": "", "tests": ["test/ci-merge-queue.test.ts"]},
 {"id": "M11", "file": ".github/ci/select.mjs", "old": "  if (event === 'pull_request' || event === 'merge_group') {", "new": "  if (event === 'pull_request') {", "tests": ["test/ci-merge-queue.test.ts", "test/ci-select-cli.test.ts"]},
 {"id": "M12", "file": ".github/ci/select.mjs", "old": "  if ((event === 'pull_request' || event === 'merge_group') && tests === 'none') return `a ${event} answered tests: none`;", "new": "  if (event === 'pull_request' && tests === 'none') return `a ${event} answered tests: none`;", "tests": ["test/ci-merge-queue.test.ts", "test/ci-select-cli.test.ts"]},
 {"id": "M13", "file": ".github/ci/verdict.mjs", "old": "    return event === 'pull_request' || event === 'merge_group'\n", "new": "    return event === 'pull_request'\n", "tests": ["test/ci-merge-queue.test.ts", "test/ci-verdict.test.ts"]},
 {"id": "M14", "file": ".github/workflows/ci.yml", "old": "        if: github.event_name == 'pull_request' || github.event_name == 'merge_group'\n", "new": "        if: github.event_name == 'pull_request'\n", "tests": ["test/ci-merge-queue.test.ts", "test/ci-pipeline.test.ts"]},
 {"id": "M15", "file": ".github/workflows/ci.yml", "old": "          BASE: ${{ github.event_name == 'merge_group' && github.event.merge_group.base_sha || format('origin/{0}', github.base_ref) }}\n", "new": "          BASE: ${{ format('origin/{0}', github.base_ref) }}\n", "tests": ["test/ci-merge-queue.test.ts", "test/ci-pipeline.test.ts"]}
]
```

```bash
git add .github/workflows/ci.yml .github/ci/select.mjs .github/ci/verdict.mjs CLAUDE.md \
  server/test/ci-merge-queue.test.ts server/test/ci-pipeline.test.ts server/test/ci-select-cli.test.ts \
  server/test/ci-verdict.test.ts
git commit -m "$(cat <<'MSG'
ci: answer the merge queue — a queue run runs what a pull request runs

ci.yml gains merge_group beside pull_request, so a queue entry gets its
required checks (landing-order stage 2, spec §5.2 rollout step 1: this lands
before the operator turns the queue on). Operator ruling 2026-09-28: a
queue run runs the SELECTED tests, like a pull request — merge_group joins
the pull_request arm of select.mjs's decideMode and modeInvariantViolation
and of verdict.mjs's serverVerdict (tests: none on a queue run is red), and
the plain-bash pipeline check asks a queue run the same question against
merge_group.base_sha, so a PR that edits the selector cannot choose its own
queue run's tests. The 2026-09-23 CI ruling stands: no full run per merge.

On CI test selection's shape (#183), merged into rather than overwritten:
one arm in the existing concurrency group, queue-<run id>, ahead of the
shared refresh group and never cancelled; a leading
github.event_name != 'merge_group' conjunct on test-macos's and full-suite's
existing if: (a selected run falls back to full, and full-suite reds on the
skipped macOS leg); probe-macos untouched (its allow-list already excludes a
queue run); a merge_group row in the header's mode table. No job a required
check needs mentions merge_group but the pipeline step's own two lines.

ci-merge-queue.test.ts pins the five properties, derived from ci.yml and
the two modules; ci-pipeline, ci-select-cli and ci-verdict gain the queue's
cases and move their pins with the shape. CLAUDE.md's CI bullet says it.
MSG
)"
```

---
### Task 2: `ccd pr-state --project` reads the merge queue — one query per repository per sweep

**Model routing:** `sonnet`, effort `high` — `ccd`'s pr-state lane, a new embedded python pass, the cross-language budget, and the corpus tax.

**Files:**
- Modify: `ccd/ccd` — insert the queue block directly above `# Guard so the script can be \`source\`d …` (below `cmd_clip` and below ws-reap's mirror block, which child-reclamation wave 3 put between the two); replace ONE line in `cmd_pr_state` (the per-session loop); rewrite IN PLACE `cmd_pr_state`'s nine-line budget header and the sixteen-line outer-bound paragraph above `PR_GH_CHECKS_TIMEOUT=5`
- Modify: `server/src/remote/runner.ts`, `server/test/remote-runner.test.ts`, `server/test/pr-timeout-budget.test.ts`
- Modify: `server/src/coord/childSpent.ts` (two comment lines), `server/src/coord/routes.ts` (one) and `server/src/coord/close.ts` (two, `childGateAtClose`'s docstring) — `20 s` → `25 s`, and close.ts's `~40 s` → `~50 s`, all in place (length-neutral; the four shipped statements of the old bound #178 and child-reclamation wave 3 (#187) left, located by content)
- Test: `server/test/ccd-pr-queue.test.ts` (new)

**Interfaces:**
- Consumes: `_gh_repo_slug`'s `OWNER/NAME` (anchored to `[A-Za-z0-9._-]`), `_plat_timeout`, each full `_pr_state_one` line's `number`, `id` and `rows`.
- Produces: on every FULL line of `ccd pr-state --project` (a line with `id` and `rows`), `queue` ∈ `queued | dequeued | landed | none | unmeasured`, plus `queueAt` (ISO-8601 `Z` timestamp of the last queue act) only when present and well-shaped. `--session` lines, failure objects and older builds carry neither key. `CCD_VERB_TIMEOUT_MS['pr-state'] = 25_000` — for BOTH modes (ruled 2026-09-24), so `childBindGate`'s `--session` read on `POST /api/runs` and on dispatch's resume arm can hold `coordMutex` 25 s where it held 20, and the close's child gate (`childGateAtClose`, #187), which makes up to TWO such reads inside the mutex, ~50 s where it held ~40 (Pre-flight finding 14). Task 3 reads both keys through `queueFor`.

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
    // The NEWEST hundred open PRs, in `gh pr list`'s own order: unordered,
    // GitHub answers the OLDEST hundred and a busy repository's live PRs fall out.
    expect(q).toContain('open: pullRequests(first: 100, states: [OPEN], orderBy: {field: CREATED_AT, direction: DESC})');
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

Expected (measured at `905360dc`, and again at `6da36f0b` with wave 1 and Task 1 applied): `10 failed | 3 passed (13)`. The three that pass — `--session` carries no key, a failed stamp prints unstamped lines, a whole-repo failure passes through — are true before this task and must stay true after it.

- [ ] **Step 3: Insert the queue block below `cmd_clip`.** Locate `grep -n '^# Guard so the script can be `source`d by tests without running a command.$' ccd/ccd` (one hit, ≈26581 at `6da36f0b`) and insert this block directly ABOVE that comment line — below every frozen corpus anchor and below both README anchors, so it moves none of them. Since child-reclamation wave 3 (#187) the line above the guard is no longer `cmd_clip`'s closing `}`: its `RECLAIM-BEGIN`…`RECLAIM-END` region and ws-reap's `MIRROR-BEGIN`…`MIRROR-END` block sit between the two, and the guard now follows `# ── end ws-reap's mirror … MIRROR-END ──` and one blank line. Inserting there keeps the block OUTSIDE both marked blocks, which `ccd-wsaudit-nonpoison.test.ts` cuts out before it counts refusal tokens (Step 9 runs it):

```bash
# ── THE MERGE QUEUE, READ ONCE PER REPOSITORY PER SWEEP (landing-order wave 2) ──
# `pr-state --project`'s THIRD gh call (spec §5.2), and it lives down here, below
# every line the frozen compaction-card corpus cites, so that adding it moved
# none of their anchors: `cmd_pr_state` pays one in-place line for it.
#
# WHAT IT ASKS. `gh pr list --json` has no field for a merge-queue entry, so the
# sweep asks GitHub's GraphQL API directly, with ONE constant query: the hundred
# NEWEST open pull requests' `mergeQueueEntry` — newest by creation, which is
# `gh pr list`'s own order, so every open PR `_gh_pr_list`'s hundred-row window
# can bind is inside this one (with no `orderBy` GitHub answers the OLDEST
# hundred, and on a busy repository the PRs being landed would all read
# `unmeasured`) — and the twenty most recently updated MERGED ones, each with
# the LAST queue act on its timeline. The spec names
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
# repository (11-12 open PRs, the 20 most recent merged): 0.72-1.39 s over five
# runs, and 0.74-1.12 s over five more with the open window ordered, so 4 s is
# about three times the worst. A failed call, an unreadable
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
    open: pullRequests(first: 100, states: [OPEN], orderBy: {field: CREATED_AT, direction: DESC}) { nodes { ...Q } }
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

- [ ] **Step 4: Wire it with ONE in-place line.** Locate `grep -n 'do _pr_state_one "\$id" "\$main" "\$repo" "\$rows" "\$answeredAt" "\$head"; done$' ccd/ccd` (one hit, the last statement of `cmd_pr_state`, ≈10687 at `6da36f0b`) and replace that line with:

```bash
  { for id in "${ids[@]}"; do _pr_state_one "$id" "$main" "$repo" "$rows" "$answeredAt" "$head"; done; } | _pr_queue_stamp "$mode" "$repo"
```

`PR_CHECKS_UNMEASURED` is `local -x`, so the loop's subshell still exports it to `_pr_py`; the loop's last status and the stamp's `return 0` keep the verb's exit code what it was.

- [ ] **Step 5: Rewrite `cmd_pr_state`'s budget header IN PLACE — nine lines for nine.** Locate `grep -n 'A CONSTANT NUMBER OF gh CALLS PER REPO' ccd/ccd` (≈10492 at `6da36f0b`) and replace these nine lines:

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

- [ ] **Step 6: Rewrite the outer-bound paragraph IN PLACE — sixteen lines for sixteen.** Locate `grep -n 'THE OUTER BOUND IS 20 s, NOT 90' ccd/ccd` (≈5116 at `6da36f0b`) and replace the sixteen lines from it through `# request; that test is the mechanism.` with:

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
  // summed against this number by `pr-timeout-budget.test.ts`. The key is the
  // VERB, so `--session` (one gh call) is bounded at 25 s too, and it is read
  // INSIDE `coordMutex` — by `verifyDone` at close and at advance, and through
  // `childSpent` by every child-bind check (`childBindGate` on `POST /api/runs`,
  // dispatch's resume arm) and by the close's child gate (`childGateAtClose`,
  // up to two reads per close) — so every other coordination write can queue
  // behind one slow read for up to this long.
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

**And the four shipped comments that state the old bound as a fact** — two added by #178 (child-reclamation wave 2) on `--session`'s path, two by #187 (child-reclamation wave 3) in the close's child gate, all true only at 20 s. Census them by content first:

```bash
grep -rn "pr-state\`'s 20 s" server/src
grep -n "Up to ~40 s against the 30 s client timeout" server/src/coord/close.ts
```

Expected at `6da36f0b` (measured 2026-09-29): exactly four hits, then one —

    server/src/coord/childSpent.ts:173: * gh call on the fleet box, bounded by `pr-state`'s 20 s remote budget, and it
    server/src/coord/childSpent.ts:241: * COST: one gh call on the fleet box, bounded by `pr-state`'s 20 s remote
    server/src/coord/routes.ts:1376:    // at most `pr-state`'s 20 s budget, and only for a CHILD with no PR on
    server/src/coord/close.ts:612: * `pr-state`'s 20 s remote budget. Accepted by design; wave 4 (reusing
    610: * ordinary PR-bearing wave. Up to ~40 s against the 30 s client timeout

(`routes.ts`'s is `POST /api/runs`'s rule-3 comment, the one that records the wait happens INSIDE `coordMutex`; `close.ts`'s two are `childGateAtClose`'s docstring, whose "~40 s" is its TWO sequential reads at 20 s each, and so becomes ~50 s at 25). In each, change the number and nothing else on the line — length-neutral, so no line moves:

```bash
sed -i "s/\`pr-state\`'s 20 s/\`pr-state\`'s 25 s/" server/src/coord/childSpent.ts server/src/coord/routes.ts server/src/coord/close.ts
sed -i "s/ordinary PR-bearing wave. Up to ~40 s against the 30 s client timeout/ordinary PR-bearing wave. Up to ~50 s against the 30 s client timeout/" server/src/coord/close.ts
grep -rn "pr-state\`'s 20 s\|Up to ~40 s" server/src; echo "rc=$?"
git diff --numstat -- server/src/coord/childSpent.ts server/src/coord/routes.ts server/src/coord/close.ts
```

Expected: no hit and `rc=1`; `2	2	server/src/coord/childSpent.ts`, `1	1	server/src/coord/routes.ts` and `2	2	server/src/coord/close.ts` (the two close.ts lines are 610 and 612, one line apart). The exact-spelling census cannot see a statement worded another way, so widen it once, with the `runner.ts` edit and the two `sed`s above in: `grep -rnE "(^|[^0-9.])20 ?s([^a-z0-9]|$)" server/src | grep -v _000` — at `6da36f0b` (measured 2026-09-29) three hits, none a statement of this bound: `server/src/server.ts:1331` and `:2268` (the PWA's 20 s poll cadence) and `server/src/remote/runner.ts:41` (the new `ws-rename` comment, which narrates the past and stays). Census the CALLERS too, because a caller that states no bound is invisible to both greps: `grep -rn "childSpent(\|childBindGate(\|childGateAtClose(" server/src | grep -v '^\S*:\s*\*' | grep -v 'function '` — at `6da36f0b` seven: `childBind.ts:79` and `close.ts:647` (`childSpent`, the second inside `childGateAtClose`), `routes.ts:1381` and `dispatch.ts:729` (`childBindGate`), and `close.ts:231`, `:351` and `:534` (`childGateAtClose`, from `closeRun`'s abandon arm, `closeRun` and `closeReviewRun`). Every one is named in the runner comment above. Any other hit that states the LIVE bound gets the same edit; a sentence that narrates the past (`ccd-pr-open.test.ts`'s and `ccd-pr-state.test.ts`'s "measured the pair against the 20 s … ceiling that actually ships", `ccd-pr-state.test.ts`'s "the outer bound the pr-lifecycle spec set for this verb (20 s)") stays as written — they are in `server/test`, which this census does not read, deliberately.

- [ ] **Step 8: Re-stamp, then pay (and prove) the citation tax**

```bash
SCRATCH=<your scratchpad, absolute>
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
bash -n ccd/ccd && echo syntax-ok
git diff --numstat -- ccd/ccd
python3 "$SCRATCH/repoint-readme.py" && git diff --quiet -- README.md && echo readme-untouched
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD --files ccd/ccd,README.md
```

Expected (measured 2026-09-29 at `6da36f0b` with wave 1 and Task 1 applied, Steps 1 and 3–7 applied by script from this plan's own blocks): `syntax-ok`; `190	25	ccd/ccd` (the 165-line block plus the stamp, the loop line and the two in-place rewrites — nothing net above `cmd_clip` but the stamp line's own bytes; unchanged since `af64d9d2`); the re-pointer prints `cmd_ensure mint -> ccd/ccd:21482` and `genrc == 1 arm -> ccd/ccd:20215-20217` (main re-pointed README itself; `21428` and `20180-20182` at `c62e22b9`, `21202` and `19989-19991` at `905360dc` — the instrument's values are the authority on a moved base) and `readme-untouched`; the re-measurer prints every `byFile` key `stated N base N tree N` — `ccd/ccd` 148, `ccd/ccrc` 5, `ccd/compact-card.mjs` 4, `ccd/session-hook.sh` 21, `deploy/deploy.sh` 2, `server/test/ccd-workspaces.test.ts` 5, `server/test/ccd-ws-reap.test.ts` 2, `server/test/single-definition.test.ts` 8, `shared/api.ts` 1 — `total stated 196 base 196 tree 196`, `row array` 53 and `site array` 36, and EMPTY `ENTERED`/`LEFT` three times (#187 moved the base to 148 / 196 / 36 from 147 / 195 / 35; this task moves nothing).

- [ ] **Step 9: Run the tests to verify they pass — one file at a time**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-pr-queue.test.ts
./node_modules/.bin/vitest run test/ownership.test.ts
./node_modules/.bin/vitest run test/ccd-pr-state.test.ts
./node_modules/.bin/vitest run test/ccd-prhistory.test.ts
./node_modules/.bin/vitest run test/pr-timeout-budget.test.ts
./node_modules/.bin/vitest run test/remote-runner.test.ts
./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts
./node_modules/.bin/vitest run test/ccd-bounded-reads.test.ts
./node_modules/.bin/vitest run test/macos-platform.test.ts
./node_modules/.bin/vitest run test/prphase.test.ts
./node_modules/.bin/vitest run test/pr-routes.test.ts
./node_modules/.bin/vitest run test/whitelist-subset.test.ts
./node_modules/.bin/vitest run test/ccd-workspaces.test.ts -t 'EVERY bash call site'
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
./node_modules/.bin/vitest run test/child-reclaim-bind.test.ts
./node_modules/.bin/vitest run test/child-reclaim-spent.test.ts
./node_modules/.bin/vitest run test/child-reclaim-refusals.test.ts
./node_modules/.bin/vitest run test/child-reclaim-close.test.ts
./node_modules/.bin/vitest run test/coord-routes-single-file.test.ts
./node_modules/.bin/vitest run test/ccd-wsaudit-nonpoison.test.ts
./node_modules/.bin/vitest run test/wsaudit.test.ts
```

Expected (measured 2026-09-29 at `6da36f0b` with wave 1 and Task 1 applied, each file alone, `--maxWorkers=1`): `13 passed (13)`; `14 passed (14)` (ownership proves the re-stamp); `99 passed (99)` (every existing pr-state case survives the third call — its stub answers the GraphQL call with rows, which reads as `unmeasured`); `18 passed (18)` (`ccd-prhistory` runs `cmd_pr_state --project` through `GH_STUB` three times — the path the stamping pipe wraps); `2 passed (2)`; `22 passed (22)` (21 at `c62e22b9`); `3 passed (3)` (the `_reg_get` census did not move — this task adds no `_reg_get`); `46 passed (46)`; `59 passed | 10 skipped (69)`; `40 passed (40)`; `44 passed (44)`; `86 passed (86)`; `1 passed | 78 skipped (79)`; `7 passed | 328 skipped (335)` (333 at `c62e22b9`; #187 added two cases); `22 passed (22)`; `66 passed (66)`; `20 passed (20)`; `25 passed (25)` (the close's docstring edit is length-neutral and touches no string a test reads); `3 passed (3)`; `3 passed (3)` and `24 passed (24)` (the block sits outside the `RECLAIM` region and ws-reap's mirror block, and adds no refusal token the scan counts). ccd's harness prints stderr lines such as `IsADirectoryError` and `refusing to append to a non-regular-file prhistory` from cases that plant exactly those shapes; they are not failures.

- [ ] **Step 10: Mutation check, then commit**

Eleven mutations, run with `$SCRATCH/mutate.py` (each file restored from a saved COPY after its row; `ccd/ccd` rows re-stamp before the test runs, so `ownership` never confounds a red). Every red below was measured on the prototype, and all eleven again on 2026-09-29 at `6da36f0b` with wave 1 and Task 1 applied — the same failing cases and the same quoted reds as on every earlier base (B1's second red is the `--session` row, `sends ["pr-state","--session","x"] with a 25000 ms budget` — the key is the verb, so both modes move together, as ruled):

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
| Q9 | `ccd/ccd`: `    open: pullRequests(first: 100, states: [OPEN], orderBy: {field: CREATED_AT, direction: DESC}) { nodes { ...Q } }` → `    open: pullRequests(first: 100, states: [OPEN]) { nodes { ...Q } }` (GitHub's default order: the OLDEST hundred) | same | "makes one GraphQL call…" only — `1 failed \| 12 passed`, `expected 'query=query($owner: String!, $name: S…' to contain 'open: pullRequests(first: 100, states…'` (measured at `af64d9d2`, and at `6da36f0b`) |
| B1 | `server/src/remote/runner.ts`: `  'pr-state': 25_000,` → `  'pr-state': 20_000,` | `./node_modules/.bin/vitest run test/pr-timeout-budget.test.ts`, then `… test/remote-runner.test.ts` | `1 failed \| 1 passed (2)` — `the three gh calls (8s + 5s + 4s) leave only 3s of the 20s pr-state bound … expected 17 to be less than or equal to 14`; and `1 failed \| 21 passed (22)` — `expected 20000 to be 25000` |
| B2 | `ccd/ccd`: `PR_GH_QUEUE_TIMEOUT=4` → `PR_GH_QUEUE_TIMEOUT=6` | `./node_modules/.bin/vitest run test/pr-timeout-budget.test.ts` | `1 failed` — `the three gh calls (8s + 5s + 6s) leave only 6s of the 25s pr-state bound … expected 19 to be less than or equal to 17.5` |

Rows (`$SCRATCH/mut-task2.json`):

```json
[
 {"id": "Q1", "file": "ccd/ccd", "old": "; } | _pr_queue_stamp \"$mode\" \"$repo\"", "new": "; }", "tests": ["test/ccd-pr-queue.test.ts"], "restamp": true},
 {"id": "Q2", "file": "ccd/ccd", "old": "-f owner=\"${repo%%/*}\" -f name=\"${repo#*/}\"", "new": "-F owner=\"${repo%%/*}\" -F name=\"${repo#*/}\"", "tests": ["test/ccd-pr-queue.test.ts"], "restamp": true},
 {"id": "Q3", "file": "ccd/ccd", "old": "out=$(_plat_timeout \"$PR_GH_QUEUE_TIMEOUT\" gh api graphql", "new": "out=$(gh api graphql", "tests": ["test/ccd-pr-queue.test.ts"], "restamp": true},
 {"id": "Q4", "file": "ccd/ccd", "old": "    if state == 'MERGED' and act == 'AddedToMergeQueueEvent':", "new": "    if state == 'MERGED':", "tests": ["test/ccd-pr-queue.test.ts"], "restamp": true},
 {"id": "Q5", "file": "ccd/ccd", "old": "  if (( src == 0 )) && [[ -n \"$stamped\" ]]; then printf '%s\\n' \"$stamped\"; else printf '%s\\n' \"$lines\"; fi", "new": "  printf '%s\\n' \"$stamped\"", "tests": ["test/ccd-pr-queue.test.ts"], "restamp": true},
 {"id": "Q6", "file": "ccd/ccd", "old": "        raw = ''\n    if not raw:\n        return None", "new": "        raw = ''\n    if not raw:\n        return {}", "tests": ["test/ccd-pr-queue.test.ts"], "restamp": true},
 {"id": "Q7", "file": "ccd/ccd", "old": "  if [[ $mode != --project ]]; then printf '%s\\n' \"$lines\"; return 0; fi\n", "new": "", "tests": ["test/ccd-pr-queue.test.ts"], "restamp": true},
 {"id": "Q8", "file": "ccd/ccd", "old": "    at = at if isinstance(at, str) and ISO.match(at) else None", "new": "    at = at if isinstance(at, str) else None", "tests": ["test/ccd-pr-queue.test.ts"], "restamp": true},
 {"id": "Q9", "file": "ccd/ccd", "old": "    open: pullRequests(first: 100, states: [OPEN], orderBy: {field: CREATED_AT, direction: DESC}) { nodes { ...Q } }", "new": "    open: pullRequests(first: 100, states: [OPEN]) { nodes { ...Q } }", "tests": ["test/ccd-pr-queue.test.ts"], "restamp": true},
 {"id": "B1", "file": "server/src/remote/runner.ts", "old": "  'pr-state': 25_000,", "new": "  'pr-state': 20_000,", "tests": ["test/pr-timeout-budget.test.ts", "test/remote-runner.test.ts"]},
 {"id": "B2", "file": "ccd/ccd", "old": "PR_GH_QUEUE_TIMEOUT=4", "new": "PR_GH_QUEUE_TIMEOUT=6", "tests": ["test/pr-timeout-budget.test.ts"], "restamp": true}
]
```

```bash
git add ccd/ccd server/src/remote/runner.ts server/test/remote-runner.test.ts \
  server/test/pr-timeout-budget.test.ts server/test/ccd-pr-queue.test.ts \
  server/src/coord/childSpent.ts server/src/coord/routes.ts server/src/coord/close.ts
git commit -m "$(cat <<'MSG'
feat(ccd): pr-state --project reads the merge queue, once per repository per sweep

One constant GraphQL query per sweep (the 100 newest OPEN PRs' mergeQueueEntry,
newest by creation as gh pr list orders its own window, and the 20 most
recently updated MERGED ones, each with its last queue act of EITHER kind — a
removal alone cannot tell re-enqueued-then-landed from hand-merged),
under its own PR_GH_QUEUE_TIMEOUT, owner and name as raw -f variables. Every
full line gains an additive `queue` — queued | dequeued | landed | none |
unmeasured — and `queueAt` when the last act has a well-shaped time. A failed
call reads unmeasured on every line; a stamping pass that fails prints the
lines unstamped; no row, phase or checks value is ever touched. --session
makes no call and carries no key: absence is the older-build answer.

The server's outer bound on pr-state rises 20 s -> 25 s: 8 + 5 + 4 = 17 of
25 keeps pr-timeout-budget.test.ts's 30 % for the local loop (at 20 s the
third call could have had 1 s; measured 0.72-1.39 s). Spec §5.2.

The key is the verb, so --session (one gh call) is bounded at 25 s too
(ruled 2026-09-24: 25 s for both modes). It is read inside coordMutex by
verifyDone at close and advance (since 2026-08) and, through childSpent,
by childBindGate on POST /api/runs and dispatch's resume arm (#178) and by
the close's child gate, childGateAtClose (#187, up to two reads per close:
~50 s where it was ~40, against the same 30 s client timeout its docstring
already accepts by design), so other coordination writes can now queue up
to 25 s, not 20, behind one read. The four shipped comments that stated the
old bound (childSpent.ts twice, routes.ts's rule-3 gate, childGateAtClose's
docstring) say 25 s, in place.

S6-R11: the block sits below cmd_clip and below ws-reap's mirror block,
beneath every frozen anchor and outside both marked blocks; the one line in
cmd_pr_state and both prose rewrites are in place. Census 147 / 197 / 52 /
35, stated == base == tree; README untouched.
MSG
)"
```

---

### Task 3: The server reads the queue word once, and tells the coordinator both landing outcomes

**Model routing:** `sonnet`, effort `high` — a new wire reader, a new watcher lane with two notices, a new feed kind across three packages.

**Files:**
- Modify: `server/src/prstate.ts` — `CcdPrLine.queue`/`queueAt`; `PR_QUEUE_MAP`, `PrQueue`, `PrQueueRead`, `queueFor` directly above `repoCellFor`'s docstring
- Modify: `server/src/coord/rundefs.ts` — the `operator` gloss; `queueSystemMail`'s caller list (all seven, named); `dequeuedSubject` and `mergedSubject` directly above the ask nudge's subject prefix
- Modify: `server/src/watch.ts` — the `./prstate.js` and `./coord/rundefs.js` imports; `prQueues` and `landingNotified` after `mergedNotified`; one line after `this.prStates.set(line.id, phaseFor(line));`; one call after `this.sweepMerged(records);`; `sweepLanding` after `sweepMerged`; `renderDequeueBrief` and `renderMergedBrief` directly above `renderAskBrief`'s docstring
- Modify: `server/src/coord/store.ts` — two reads: `hasMailWithSubject` after `hasOutstandingMail`, `hasFeedEvent` after `feedEvents`
- Modify: `shared/api.ts` — three lines IN PLACE (two code, one docstring)
- Modify: `pwa/src/screens/MailScreen.tsx`, `pwa/test/mail-screen.test.tsx`
- Test: `server/test/pr-queue-lane.test.ts` (new)

**Interfaces:**
- Consumes: Task 2's `queue`/`queueAt` on full `pr-state` lines, and the phase `sweepPr` already derives (`phaseFor`); `CoordStore.openRunsForSession` (and its `run-unreadable` arm), `CoordStore.run(id)` (the run's `state`), `CoordStore.resolveCoordinator(runId)`, `survivorOf` (`rundefs.ts`), `queueSystemMail`, `FleetWatcher.pushOne`. And Task 5's lifecycle rule, which is what makes this lane reach a PR at all: on a native-queue project the coordinator advances the producer's run to `merging` and enqueues, and closes it only once the PR reads merged — so the run, its hold, the child's registry row and its `pr-state` line all outlive the queue.
- Produces: `queueFor(line: CcdPrLine): PrQueueRead` (`{ state: PrQueue | 'absent'; at: string | null }`); `NotifyEvent.kind` `'queue'`; `CoordStore.hasMailWithSubject(fromId, runId, toId, subject)` (every delivery state) and `CoordStore.hasFeedEvent(kind, sessionId, body)`; `dequeuedSubject(pr, at)` and `mergedSubject(pr)` (`rundefs.ts`, the ONE spelling of each — Task 5's skill text names both, pinned equal); per (workspace, PR, removal) a `status` mail `dequeued:#<n>@<queueAt>` from `operator` to the coordinator of the open run that names the workspace (the `survivorOf` pick) and a `queue` feed record, or the record alone when no open run names it; per (workspace, PR) a `status` mail `merged:#<n>` to that coordinator when the PR reads merged while that run waits at `merging` — none of them repeated after a server restart. Task 5's clause-15 sentence and lifecycle paragraph are what both mails point the coordinator at.

- [ ] **Step 1: Write the failing test** — `server/test/pr-queue-lane.test.ts`:

```typescript
/**
 * The server half of landing-order wave 2 (spec §5.2): `queueFor`, the ONE
 * reader of ccd's additive `queue`/`queueAt` fields, and the landing lane —
 * the coordinator's two notices about a PR it is landing through the merge
 * queue. A `dequeued` reading is a `queue` feed record and a `status` mail to
 * the coordinator of the open run that names the workspace, once per
 * (workspace, PR, removal); a PR that reads merged while that run waits at
 * `merging` is a `status` mail too, once per (workspace, PR). Once means once
 * across a server restart as well, and never for any other word, for an
 * unmeasured read, or for a line from an older ccd. A read that fails or a
 * mail that throws is retried, never latched as told.
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher, renderDequeueBrief, renderMergedBrief } from '../src/watch.js';
import { NotifyLog } from '../src/notifylog.js';
import { queueFor, type CcdPrLine } from '../src/prstate.js';
import { dequeuedSubject, mergedSubject } from '../src/coord/rundefs.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import type { PushPayload } from '../src/push.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { RunState } from '../../shared/api.js';

const ID = 'demo-quiet-basin';
const T1 = '2026-09-23T11:30:00Z';
const T2 = '2026-09-23T12:05:00Z';
const COORDINATOR = 'ccrc-pwa-coordinator';

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

/** The same PR, MERGED and bound (`pr-sweep.test.ts`'s `mergedLine`). */
const mergedLine = (extra: Record<string, unknown> = {}, number = 42): string => JSON.stringify({
  id: ID, project: 'demo', repo: 'o/r', branch: 'ws/' + ID, base: 'origin/main', baseShort: 'main',
  tip: 'f'.repeat(40), ahead: 1, dirty: 0, commits: [], template: null,
  rows: [{ number, state: 'MERGED', headRefName: 'ws/' + ID, headRefOid: 'deadbee', baseRefName: 'main',
    isCrossRepository: false, mergedAt: '2026-09-23T12:30:00Z', mergeCommit: { oid: '7a68ca0' }, url: 'u',
    title: 't', isDraft: false, statusCheckRollup: null, ours: true }],
  phase: 'merged', number, checkedAt: 1785300000000, reason: null, ...extra,
});

const runnerFor = (out: () => string): Runner => async (_cmd, args) => {
  if (args[0] === 'pr-state') return { code: 0, stdout: out(), stderr: '' };
  if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
  return { code: 0, stdout: '', stderr: '' };
};

/** Walk a run through the ONE path `RUN_TRANSITIONS` allows to `to`. */
const PATH: Record<string, RunState[]> = {
  planned: [], 'awaiting-review': ['dispatched', 'working', 'awaiting-review'],
  merging: ['dispatched', 'working', 'awaiting-review', 'merging'],
};
const walk = (coord: CoordStore, id: number, to: RunState): void => {
  for (const s of PATH[to]!) expect(coord.advance(id, s, 'test').ok, `advance to ${s}`).toBe(true);
};

/** `run`: whose workspace the ONE open programme's run names — this one
 *  (`mine`), or ANOTHER (`other`), so `resolveCoordinator(null)` would answer
 *  a real session and the lane must not take that guess. `state`: where the
 *  run waits (default `merging` — the coordinator is landing). `second`: a
 *  SECOND open run naming this workspace (wave N+1 on the same workspace).
 *  `visible`: the operator is looking at this pane — the presence gate
 *  `pushOne` consults, which a `recordAlways` record must not heed. */
async function harness(first: string, opts: { run?: 'mine' | 'other'; state?: RunState; second?: boolean; visible?: boolean } = {}) {
  const home = seed();
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'landing', title: 't', project: 'demo',
    wave: 2, waveOf: 5, claimedBy: COORDINATOR });
  if (!('id' in opened)) throw new Error('fixture openRun refused');
  const mine = (opts.run ?? 'mine') === 'mine';
  coord.setSession(opened.id, mine ? ID : 'demo-still-cove');
  walk(coord, opened.id, opts.state ?? 'merging');
  let runId: number | null = mine ? opened.id : null;
  if (opts.second) {
    const next = coord.openRun({ program: 'landing', title: 't', project: 'demo',
      wave: 3, waveOf: 5, claimedBy: COORDINATOR });
    if (!('id' in next)) throw new Error('fixture second openRun refused');
    coord.setSession(next.id, ID);
    runId = next.id;
  }
  const log = new NotifyLog(path.join(home, 'notify.json'));
  await log.load();
  const sent: PushPayload[] = [];
  let out = first;
  const deps = { ...testDeps(home, runnerFor(() => out)), coord, notifyLog: log,
    push: { notify: async (p: PushPayload) => { sent.push(p); } } as never,
    presence: { isVisible: () => opts.visible === true } as never };
  let w = new FleetWatcher(deps, new Bus(), 10_000);
  const sweep = async (next?: string): Promise<void> => {
    if (next !== undefined) out = next;
    (w as unknown as { lastPrSweep: number }).lastPrSweep = 0;
    await w.tick();
    await vi.waitFor(() => expect((w as unknown as { prSweepStartedAt: number }).prSweepStartedAt).toBe(0));
  };
  /** A server restart: a NEW watcher — every in-memory latch empty — over the
   *  SAME coord.db, which is what a rollout or a crash leaves behind. */
  const restart = (): void => { w.stop(); w = new FleetWatcher(deps, new Bus(), 10_000); };
  const stop = (): void => { w.stop(); };
  const queueFeed = () => coord.feedEvents(200).filter((e) => e.kind === 'queue');
  const mail = () => coord.mailForRecipient(COORDINATOR);
  return { coord, sweep, restart, stop, sent, queueFeed, mail, runId, firstRunId: opened.id };
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
    expect(queueFor(line({ queue: 'dequeued', queueAt: T1 })).at).toBe(T1);
    expect(queueFor(line({ queue: 'dequeued', queueAt: '$(reboot)' })).at).toBeNull();
  });
});

describe('the landing lane — a dequeue', () => {
  it('records a queue feed event and mails the coordinator of the open run, once', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }));
    await f.sweep();
    expect(f.queueFeed()).toHaveLength(1);
    expect(f.queueFeed()[0]!.title).toBe('⤺ dequeued › quiet-basin');
    expect(f.queueFeed()[0]!.runId).toBe(f.runId);
    const m = f.mail();
    expect(m).toHaveLength(1);
    expect(m[0]!.subject).toBe(`dequeued:#42@${T1}`);
    expect(m[0]!.subject).toBe(dequeuedSubject(42, T1));
    expect(m[0]!.kind).toBe('status');
    expect(m[0]!.runId).toBe(f.runId);
    expect(f.sent.find((p) => p.tag === `queue-${ID}#42:dequeued@${T1}`)).toBeDefined();
    // The same reading on the next sweep is the same fact: no second anything —
    // and, latched in memory, it costs no second read of the run rows.
    const reads = vi.spyOn(f.coord, 'openRunsForSession');
    await f.sweep();
    expect(f.queueFeed()).toHaveLength(1);
    expect(f.mail()).toHaveLength(1);
    expect(reads, 'a latched removal re-read the run rows on the next sweep').not.toHaveBeenCalled();
    f.stop();
  });

  it('announces a SECOND removal of the same PR — the latch carries the removal time', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }));
    await f.sweep();
    await f.sweep(openLine({ queue: 'queued', queueAt: '2026-09-23T11:40:00Z' }));
    await f.sweep(openLine({ queue: 'dequeued', queueAt: T2 }));
    expect(f.queueFeed()).toHaveLength(2);
    expect(f.mail().map((m) => m.subject).sort()).toEqual([`dequeued:#42@${T1}`, `dequeued:#42@${T2}`]);
    f.stop();
  });

  it('names the survivor — with two open runs on the workspace, the newer, the close\'s own rule', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }), { second: true });
    await f.sweep();
    expect(f.runId).not.toBe(f.firstRunId);
    expect(f.mail().map((m) => m.runId)).toEqual([f.runId]);
    expect(f.queueFeed()[0]!.runId).toBe(f.runId);
    f.stop();
  });

  it('with no open run, records the feed event and mails nobody — never a guessed coordinator', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }), { run: 'other' });
    await f.sweep();
    expect(f.queueFeed()).toHaveLength(1);
    expect(f.queueFeed()[0]!.body).toContain('No open run names a coordinator');
    expect(f.mail()).toEqual([]);
    f.stop();
  });

  it('records the dequeue even while the operator is looking at the pane — the record is never presence-gated', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }), { visible: true });
    await f.sweep();
    expect(f.queueFeed(), 'the operator watching the pane erased the record of a removal').toHaveLength(1);
    f.stop();
  });

  it('says nothing for queued, landed, none, unmeasured, or a line from an older ccd', async () => {
    // `none` at `merging` is silent BY DESIGN, and it is also what a PR reads
    // when the coordinator's enqueue only ARMED auto-merge (gh 2.45 does that
    // for a PR whose required checks have not passed, with the same success
    // line): the coordinator's own read-back of the queue entry is what makes
    // that case loud (`wave-lifecycle.md` §5), not this lane.
    for (const extra of [{ queue: 'queued' }, { queue: 'landed' }, { queue: 'none' },
      { queue: 'unmeasured' }, {}]) {
      const f = await harness(openLine(extra));
      await f.sweep();
      expect(f.queueFeed(), JSON.stringify(extra)).toEqual([]);
      expect(f.mail(), JSON.stringify(extra)).toEqual([]);
      f.stop();
    }
  });

  it('the dequeue brief reads why from the queue\'s own run, disarms before a fix round, re-enqueues at the exact SHA and never with --admin; the merged brief asks for the merge proof', () => {
    const b = renderDequeueBrief(ID, 42);
    expect(b).toContain('`gh pr merge 42 --match-head-commit <handoffCommit>`');
    expect(b.replace('never `--admin`', '')).not.toContain('--admin');
    expect(b).not.toContain('--squash');
    // A queue failure is the merge_group run's, on the queue branch's commit;
    // the PR head's own checks never include it and can read green.
    expect(b).toContain('`gh run list --event merge_group');
    expect(b).not.toContain('statusCheckRollup');
    // An armed auto-merge queues whatever head a fix round pushes.
    expect(b).toContain('`gh pr merge 42 --disable-auto`');
    expect(renderMergedBrief(ID, 42)).toContain('`gh pr view 42 --json state,headRefOid`');
  });
});

describe('the landing lane — a merge while the run waits at merging', () => {
  it('mails the coordinator merged:#<n> once, and records no queue event', async () => {
    const f = await harness(mergedLine({ queue: 'landed', queueAt: T2 }));
    await f.sweep();
    const m = f.mail();
    expect(m).toHaveLength(1);
    expect(m[0]!.subject).toBe('merged:#42');
    expect(m[0]!.subject).toBe(mergedSubject(42));
    expect(m[0]!.kind).toBe('status');
    expect(m[0]!.runId).toBe(f.runId);
    expect(f.queueFeed()).toEqual([]);
    await f.sweep();
    expect(f.mail()).toHaveLength(1);
    f.stop();
  });

  it('says nothing when the run is not at merging, or no open run names the workspace', async () => {
    for (const opts of [{ state: 'awaiting-review' as RunState }, { state: 'planned' as RunState }, { run: 'other' as const }]) {
      const f = await harness(mergedLine(), opts);
      await f.sweep();
      expect(f.mail(), JSON.stringify(opts)).toEqual([]);
      f.stop();
    }
  });
});

describe('the landing lane latches only what it told', () => {
  it('an unreadable run read is not "no open run": it defers, records nothing, and mails once it reads', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const real = f.coord.openRunsForSession.bind(f.coord);
    let n = 0;
    vi.spyOn(f.coord, 'openRunsForSession').mockImplementation((id, ex) => (n++ === 0
      ? { ok: false, kind: 'run-unreadable', detail: 'fixture' } : real(id, ex)));
    await f.sweep();
    expect(f.queueFeed(), 'an unreadable run read was announced as "no open run"').toEqual([]);
    expect(f.mail()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('deferred (run rows unreadable: fixture)'));
    await f.sweep();
    expect(f.mail(), 'the deferred notice was never sent').toHaveLength(1);
    expect(f.queueFeed()).toHaveLength(1);
    expect(f.queueFeed()[0]!.body).toContain(`Mailed coordinator ${COORDINATOR}`);
    warn.mockRestore();
    f.stop();
  });

  it('a mail that throws is retried on the next sweep, and leaves exactly one record', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // `hasOutstandingMail` is `queueSystemMail`'s first statement: a throw
    // there is `node:sqlite`'s 'database is locked' reaching the lane.
    const real = f.coord.hasOutstandingMail.bind(f.coord);
    let n = 0;
    vi.spyOn(f.coord, 'hasOutstandingMail').mockImplementation((...a) => {
      if (n++ === 0) throw new Error('database is locked');
      return real(...a);
    });
    await f.sweep();
    expect(f.mail()).toEqual([]);
    expect(f.queueFeed(), 'a record was left for a notice that was never sent').toEqual([]);
    await f.sweep();
    expect(f.mail(), 'the thrown notice was never retried').toHaveLength(1);
    expect(f.queueFeed()).toHaveLength(1);
    warn.mockRestore();
    f.stop();
  });

  it('a restart re-announces no dequeue it already mailed — acked or not — and still hears a new removal', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }));
    await f.sweep();
    const m = f.mail();
    expect(m).toHaveLength(1);
    // Acked, so `queueSystemMail`'s OUTSTANDING-only dedupe no longer sees it.
    f.coord.markAcked(m[0]!.deliveryId, Date.now());
    f.restart();
    await f.sweep();
    expect({ mail: f.mail().length, feed: f.queueFeed().length }).toEqual({ mail: 1, feed: 1 });
    await f.sweep(openLine({ queue: 'dequeued', queueAt: T2 }));
    expect({ mail: f.mail().length, feed: f.queueFeed().length }).toEqual({ mail: 2, feed: 2 });
    f.stop();
  });

  it('a restart re-records no feed-only dequeue either', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }), { run: 'other' });
    await f.sweep();
    f.restart();
    await f.sweep();
    expect(f.queueFeed()).toHaveLength(1);
    expect(f.mail()).toEqual([]);
    f.stop();
  });

  it('a merge whose run row cannot be read defers, and a merged notice whose mail throws is retried — neither is latched as told', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = await harness(mergedLine());
    const realRun = f.coord.run.bind(f.coord);
    let n = 0;
    vi.spyOn(f.coord, 'run').mockImplementation((id) => (n++ === 0
      ? { ok: false as const, kind: 'run-unreadable' as const, detail: 'fixture' } : realRun(id)));
    await f.sweep();
    expect(f.mail(), 'an unreadable run row was read as "not at merging"').toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('deferred (run rows unreadable: fixture)'));
    await f.sweep();
    expect(f.mail(), 'the deferred merged notice was never sent').toHaveLength(1);
    f.stop();
    const g = await harness(mergedLine());
    const real = g.coord.hasOutstandingMail.bind(g.coord);
    let k = 0;
    vi.spyOn(g.coord, 'hasOutstandingMail').mockImplementation((...a) => {
      if (k++ === 0) throw new Error('database is locked');
      return real(...a);
    });
    await g.sweep();
    expect(g.mail()).toEqual([]);
    await g.sweep();
    expect(g.mail(), 'the thrown merged notice was never retried').toHaveLength(1);
    warn.mockRestore();
    g.stop();
  });

  it('a restart re-mails no merge it already told — acked', async () => {
    const f = await harness(mergedLine());
    await f.sweep();
    const m = f.mail();
    expect(m).toHaveLength(1);
    f.coord.markAcked(m[0]!.deliveryId, Date.now());
    f.restart();
    await f.sweep();
    expect(f.mail()).toHaveLength(1);
    f.stop();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/pr-queue-lane.test.ts
```

Expected (measured 2026-09-29 at `6da36f0b` with wave 1 and Tasks 1–2 applied): `16 failed | 2 passed (18)` — `TypeError: queueFor is not a function` on the three reader cases, `expected [] to have a length of 1 but got +0` (or its `of 2` form, `the operator watching the pane erased the record of a removal`, `the thrown notice was never retried`, or `expected "warn" to be called with arguments`) on the lane cases, and on the brief case `renderDequeueBrief is not a function` (vitest leaves a missing named export `undefined`, so the reds are the lane's, not an import crash). The two silence cases — "says nothing for queued, landed, …" and "says nothing when the run is not at merging…" — pass today (nothing announces yet) and must stay passing. And `cd ../pwa && ./node_modules/.bin/vitest run test/mail-screen.test.tsx` → `1 failed | 25 passed (26)` once Step 4's `it` is in: `no glyph for queue: expected '' to be '⤺'`.

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
 *  evidence" to the landing lane; they are kept apart so no later reader has
 *  to re-derive which one it was holding. */
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

- [ ] **Step 4: The ninth feed kind — three lines of `shared/api.ts` IN PLACE (two code, one docstring), and the PWA's two total maps.** In `shared/api.ts` replace

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

and, in the docstring just above the `kind` line, the last line of the paragraph names the new kind (the third line; same line count, so no citation moves) — as shipped, the line now ends `recorded, never pushed; queue is the landing lane's dequeue notice. */`. (No line is added: `shared/api.ts` is cited by line from README and the frozen plan. The argument for the new kind lives at `sweepLanding`, Step 6.) In `pwa/src/screens/MailScreen.tsx` replace

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

  // The NINTH kind (landing-order wave 2): a PR the merge queue removed
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

- [ ] **Step 5: The subjects and who sends them, in `server/src/coord/rundefs.ts`.** Replace

```typescript
    'watcher on their behalf (the ask nudge); never a session speaking for itself',
```

with

```typescript
    'watcher on their behalf (the ask nudge, the landing notices); never a session speaking for itself',
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
    // `queueSystemMail` — every one of its callers: `close.ts`'s `closeRun`
    // and `closeReviewRun`, `dispatch.ts`'s `dispatchRun`, `kickoff.ts`'s
    // `queueProgramKickoff`, `routes.ts`'s `POST /api/runs/:id/advance`
    // handler, and `watch.ts`'s `FleetWatcher.hold` (the ask pre-emption
    // lane's parent nudge) and `FleetWatcher.sweepLanding` (the merge queue's
    // two landing notices, landing-order wave 2, which catches the throw per
    // row) — deliberately:
```

and directly above `/** The ask pre-emption lane's own nudge-mail subject prefix — the ONE source`, insert:

```typescript
/** The landing lane's two notice subjects (landing-order wave 2), each spelled
 *  ONCE: `watch.ts`'s `sweepLanding` queues them and asks `hasMailWithSubject`
 *  about them, and the coordinator skill tells its reader to expect them
 *  (`references/wave-lifecycle.md` §5) — `coordinator-skill.test.ts` holds the
 *  skill's spelling to these. A dequeue is unique per REMOVAL — the PR and the
 *  removal's own time (`queueAt`, shape-gated by `queueFor`) — so a second
 *  removal of the same PR is a new notice, and a reading with no well-shaped
 *  time falls back to the PR alone; a merge happens once per PR. */
export const dequeuedSubject = (pr: number, at: string | null): string =>
  at === null ? `dequeued:#${pr}` : `dequeued:#${pr}@${at}`;
export const mergedSubject = (pr: number): string => `merged:#${pr}`;

```

- [ ] **Step 6: The lane, in `server/src/watch.ts`.** (Fix round 1 extracted this step's decisions to `server/src/coord/landing.ts` — the `landing-verdict-is-l1` deviation — so the code below is the plan's original shape and the shipped source is authoritative.) Replace the import line

```typescript
import { isFullLine, parsePrLines, phaseFor, repoCellFor, type CcdPrFailure } from './prstate.js';
```

with

```typescript
import {
  isFullLine, parsePrLines, phaseFor, queueFor, repoCellFor, type CcdPrFailure, type PrQueueRead,
} from './prstate.js';
```

and

```typescript
import {
  COORDINATOR_PAUSE_MARKER, MAIL_ROLE_IDS, askNudgeSubject, isAskNudgeMail, queueSystemMail,
} from './coord/rundefs.js';
```

with

```typescript
import {
  COORDINATOR_PAUSE_MARKER, MAIL_ROLE_IDS, askNudgeSubject, dequeuedSubject, isAskNudgeMail,
  mergedSubject, queueSystemMail, survivorOf,
} from './coord/rundefs.js';
```

Directly after `  private mergedNotified = new Set<string>();`, insert:

```typescript
  /** The merge-queue word each session's last full pr-state line carried
   *  (`queueFor`), kept beside `prStates` and written by the same arm of
   *  `sweepPr`. Read by `sweepLanding` and nothing else. */
  private prQueues = new Map<string, PrQueueRead>();
  /** `sweepLanding`'s in-memory latch, per (workspace, PR, notice, removal
   *  time) — the `mergedNotified` shape plus the notice and the removal's own
   *  timestamp, because a PR can be dequeued, re-enqueued and dequeued AGAIN,
   *  and each removal is a new fact the coordinator has to hear. Written only
   *  AFTER the notice landed, after a durable read proved an earlier process
   *  sent it, or once the lane has decided there is nobody to tell — never
   *  before a read: a latch set ahead of a failed read or a thrown mail would
   *  make that removal a landing that silently stops. It is NOT what stops a
   *  restart re-announcing (a PR can sit dequeued through a whole fix round,
   *  and every rollout restarts this process); that is `sweepLanding`'s
   *  DURABLE read. This set spares a latched notice the coord.db reads on
   *  every later sweep. */
  private landingNotified = new Set<string>();
```

Directly after `          this.prStates.set(line.id, phaseFor(line));` (one hit, `sweepPr`'s full-line arm), insert:

```typescript
          this.prQueues.set(line.id, queueFor(line));
```

Directly after `      this.sweepMerged(records);` (one hit), insert:

```typescript
      this.sweepLanding(records);
```

After `sweepMerged`'s closing brace (its last statement is `      this.announceMerged(key, r, pr.number, reason);`, then `    }`, then `  }`), insert:

```typescript

  /**
   * The landing lane (landing-order wave 2, spec §5.2): the coordinator's two
   * notices about a PR it is landing through the merge queue. It ANNOUNCES; it
   * never enqueues, merges, re-runs or re-enqueues anything (R5).
   *
   *  - DEQUEUED (`queueFor` reads `dequeued`). GitHub does NOT re-enqueue a PR
   *    its queue removed, so a removal nobody hears about is a landing that
   *    silently stops. Once per (workspace, PR, removal): a `status` mail
   *    (`dequeuedSubject`) to the coordinator of the open run that names the
   *    workspace — who re-enqueues or sends a fix round — and a `queue` FEED
   *    record, always (`recordAlways`: a removal is a fact about the
   *    programme whether or not anyone is watching this pane). With no open
   *    run there is nobody to tell without guessing (`resolveCoordinator(null)`
   *    answers whichever programme is the single active one, `tellSender`'s
   *    reason), so the record is the whole notice. A NEW kind rather than
   *    `merged` or `mail`: a dequeue is the one PR outcome that is not a
   *    merge; `MailScreen`'s two total maps name it, and an older client
   *    degrades it to `unknown` through `reviveNotifyEvent`.
   *  - MERGED (the phase `sweepPr` derived reads `merged`) while that run
   *    waits at `merging`: a `status` mail (`mergedSubject`) to its
   *    coordinator, once per (workspace, PR). `merging` is the coordinator's
   *    own declaration that it is landing this PR; on a native-queue project
   *    it enqueued and ended its turn (clause 15; `wave-lifecycle.md` §5), and
   *    this mail is what wakes it to prove the merge and close the run — it
   *    never polls (clause 7). The run's state is all this reads, not whether
   *    the project has a queue: a synchronous merge elsewhere that a sweep
   *    reads before the close is mailed too, and the skill says to prove and
   *    close as usual. No feed record: `sweepMerged` writes the `merged` one.
   *    A merged PR whose run is elsewhere — a hand merge, a close that came
   *    first — asked for nothing, and the first sweep that reads the merge
   *    decides so.
   *
   * WHY THE OPEN RUN IS THE KEY. Under "One PR per child" a producer that
   * closed before its PR landed would be reclaimed (child-reclamation wave 3:
   * registry row, worktree and pane gone), and a reclaimed workspace has no
   * pr-state line to carry a queue word — nor a worker to take a fix round.
   * On a native-queue project the coordinator therefore lands BEFORE it
   * closes (clause 15): the run waits at `merging` holding the child, so the
   * row, the line and the worker all outlive the queue. The run is the one
   * `survivorOf` picks — the close's and dispatch's own rule.
   *
   * ONCE ACROSS RESTARTS TOO. Before telling, the lane asks coord.db whether
   * this notice was ALREADY told: a mail through `hasMailWithSubject` — every
   * delivery state, because `queueSystemMail`'s own dedupe sees OUTSTANDING
   * rows only and an acked notice would otherwise be mailed again after every
   * rollout — and the feed-only dequeue through `hasFeedEvent` on the exact
   * body, which carries the removal time. A hit latches and says nothing.
   *
   * THREE OUTCOMES, KEPT APART. Run rows that cannot be read are NOT "no open
   * run" (the overloaded null `sweepMerged` also refuses): the lane defers,
   * says nothing and latches nothing, and the next sweep re-reads. A mail
   * that throws (`node:sqlite`, synchronously) is caught with nothing recorded
   * and nothing latched, so the next sweep tries again — the mail is queued
   * BEFORE the feed record for exactly that reason, so a retry leaves one
   * record. Only a notice that landed, one a durable read found, or a
   * decision that there is nobody to tell, is latched.
   *
   * `unmeasured` and `absent` NEVER announce a dequeue, and neither do
   * `queued`, `landed` or `none`: the lane fires on the one word that asks
   * for an act. A PR the coordinator's enqueue only ARMED reads `none` too
   * (gh 2.45 arms auto-merge, rather than queueing, a PR whose required
   * checks have not passed, and prints the same line either way): the lane
   * cannot tell that from "not enqueued yet", so the coordinator reads the
   * queue entry back before it ends its turn (`wave-lifecycle.md` §5).
   */
  private sweepLanding(records: SessionRecord[]): void {
    const coord = this.deps.coord;
    if (coord === undefined) return;
    for (const r of records) {
      if (measuredIdentity(r) === null) continue;
      if (r.workspace === null || r.archivedAt !== null) continue;
      const pr = this.prStates.get(r.id);
      const q = this.prQueues.get(r.id);
      const number = pr?.number ?? null;
      const dequeued = q?.state === 'dequeued';
      if (number === null || (!dequeued && pr?.phase !== 'merged')) continue;
      const at = dequeued ? q.at : null;
      const key = `${r.id}#${number}:${dequeued ? 'dequeued' : 'merged'}@${at ?? ''}`;
      if (this.landingNotified.has(key)) continue;
      // ONE BAD ROW MAY NOT COST THE REST OF THE SWEEP: `node:sqlite` throws
      // synchronously, and this runs inside the void-dispatched `sweepPr`.
      try {
        const sib = coord.openRunsForSession(r.id);
        if (!sib.ok) {
          console.warn(`ccrc-server: landing notice for ${r.id} deferred (run rows unreadable: ${sib.detail})`);
          continue;
        }
        const run = survivorOf(sib.siblings);
        const coordinator = run === null ? null : coord.resolveCoordinator(run.id);
        if (!dequeued) {
          // A MERGE: told only to a coordinator whose run waits at `merging`.
          if (run === null || coordinator === null) { this.landingNotified.add(key); continue; }
          const read = coord.run(run.id);
          if (!read.ok) {
            console.warn(`ccrc-server: landing notice for ${r.id} deferred (run rows unreadable: ${read.detail})`);
            continue;
          }
          if (read.run?.state === 'merging') {
            const subject = mergedSubject(number);
            if (!coord.hasMailWithSubject('operator', run.id, coordinator, subject)) {
              queueSystemMail(coord, run, {
                fromId: 'operator', toId: coordinator, runId: run.id, kind: 'status',
                subject, body: renderMergedBrief(r.id, number),
              });
            }
          }
          this.landingNotified.add(key);
          continue;
        }
        const subject = dequeuedSubject(number, at);
        const body = `PR #${number} left the merge queue without landing`
          + (at === null ? '' : ` (removed ${at})`) + '; GitHub does not re-enqueue it. '
          + (coordinator === null ? 'No open run names a coordinator to tell.' : `Mailed coordinator ${coordinator}.`);
        const told = run !== null && coordinator !== null
          ? coord.hasMailWithSubject('operator', run.id, coordinator, subject)
          : coord.hasFeedEvent('queue', r.id, body);
        if (!told) {
          if (run !== null && coordinator !== null) {
            queueSystemMail(coord, run, {
              fromId: 'operator', toId: coordinator, runId: run.id, kind: 'status',
              subject, body: renderDequeueBrief(r.id, number),
            });
          }
          this.pushOne({
            kind: 'queue', sessionId: r.id, project: r.project,
            title: `⤺ dequeued › ${r.workspace}`, body,
            runId: run?.id ?? null,
            tag: `queue-${key}`,
            recordAlways: true,
          }, this.activeProjects);
        }
        this.landingNotified.add(key);
      } catch (err) {
        console.warn(`ccrc-server: landing notice for ${r.id} failed (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }
```

Directly above the docstring that begins `/**\n * The parent's ENTIRE evidentiary surface (design spec §6.1)` (the one above `function renderAskBrief(`), insert:

```typescript
/** The dequeue notice's body. Every value in it is this server's own — a PR
 *  number, a registry-validated session id — and nothing GitHub wrote (the
 *  removal's reason is never carried): this text lands in a model's context.
 *  The re-enqueue spelling is clause 15's, exact-SHA binding and all. The why
 *  is the QUEUE's own CI run: a queue failure is the `merge_group` run on the
 *  queue branch's commit, which the PR head's checks never include, so they
 *  can read green while the queue reads red. A fix round disarms first: an
 *  armed auto-merge would queue whatever head the round pushes. */
export function renderDequeueBrief(sessionId: string, pr: number): string {
  return `PR #${pr} (workspace \`${sessionId}\`) was removed from this repository's merge queue without landing. ` +
    `GitHub does not re-enqueue a PR after a failed group.\n` +
    `Read why from the QUEUE's own CI run, not the PR's checks — they ran on a different commit and can read green: ` +
    `\`gh run list --event merge_group --limit 20 --json databaseId,headBranch,conclusion\` finds it by its ` +
    `\`headBranch\` (\`gh-readonly-queue/<base>/pr-${pr}-…\`), \`gh run view <id> --log-failed\` says why, and ` +
    `\`gh pr view ${pr} --json mergeStateStatus\` answers a conflict.\n` +
    `Then either re-enqueue it — \`gh pr merge ${pr} --match-head-commit <handoffCommit>\`, the run's verified ` +
    `handoffCommit, never \`--admin\` (clause 15) — or disarm any armed auto-merge ` +
    `(\`gh pr merge ${pr} --disable-auto\`) and send the owning worker a fix round on the ` +
    `\`merging → working\` edge.\n\n` +
    `Run the ccrc-coordinator skill.`;
}

/** The merged notice's body — the same provenance rule as the dequeue's. It
 *  asks for the merge PROOF before the close, because a merged PR is not yet
 *  proof that the exact head the review read is the one that landed. */
export function renderMergedBrief(sessionId: string, pr: number): string {
  return `PR #${pr} (workspace \`${sessionId}\`) merged while its run waited at \`merging\`.\n` +
    `Prove it from your own shell — \`gh pr view ${pr} --json state,headRefOid\` answers MERGED with ` +
    `\`headRefOid\` equal to the run's verified handoffCommit — then close the run as ` +
    `references/wave-lifecycle.md §5 closes a producer.\n\n` +
    `Run the ccrc-coordinator skill.`;
}

```

- [ ] **Step 7: The two durable reads, in `server/src/coord/store.ts`.** Directly after `hasOutstandingMail`'s closing brace (its last statement is `    return row !== undefined;`, one hit inside that method), insert:

```typescript

  /** Whether ANY mail with this exact (fromId, runId, toId, subject) was ever
   *  queued — in EVERY delivery state, which is the whole difference from
   *  `hasOutstandingMail` above. `sweepLanding`'s durable "already told" read
   *  (landing-order wave 2): its latch is in memory, `queueSystemMail`'s dedupe
   *  sees outstanding rows only, and a PR that stays dequeued through a fix
   *  round would otherwise be mailed again after every server restart once its
   *  first notice was acked. `mail` is never pruned, so this answer does not
   *  decay. `toId` is the mail row's own, which for system mail is the resolved
   *  session id `queueSystemMail` was handed. */
  hasMailWithSubject(fromId: string, runId: number | null, toId: string, subject: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 AS x FROM mail WHERE fromId = ? AND runId IS ? AND toId = ? AND subject = ? LIMIT 1',
    ).get(fromId, runId, toId, subject);
    return row !== undefined;
  }
```

Directly after `feedEvents`'s closing brace (the method that begins `  feedEvents(limit: number): NotifyEvent[] {`), insert:

```typescript

  /** Whether the feed archive holds a record of this kind, about this session,
   *  with exactly this body — `sweepLanding`'s durable "already told" read for
   *  a removal no open run names (landing-order wave 2), whose body carries the
   *  removal time. Bounded by `FEED_RETENTION` like every feed read: a record
   *  pruned out of the archive reads as never recorded, and is announced again. */
  hasFeedEvent(kind: string, sessionId: string, body: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 AS x FROM feed_events WHERE kind = ? AND sessionId = ? AND body = ? LIMIT 1',
    ).get(kind, sessionId, body);
    return row !== undefined;
  }
```

Both are reads: neither names `mail_deliveries`, so `mail-hardening.test.ts`'s delivery-writer census and `single-definition.test.ts`'s state-set scans do not see them (Step 8 runs both). `mail` has no pruning writer anywhere in `server/src/coord/`; `feed_events` prunes to `FEED_RETENTION`, which the second docstring says.

- [ ] **Step 8: Run the tests to verify they pass — one file at a time**

```bash
cd server && ./node_modules/.bin/vitest run test/pr-queue-lane.test.ts
./node_modules/.bin/vitest run test/pr-sweep.test.ts
./node_modules/.bin/vitest run test/prstate.test.ts
./node_modules/.bin/vitest run test/single-definition.test.ts
./node_modules/.bin/vitest run test/coord-store.test.ts
./node_modules/.bin/vitest run test/mail-hardening.test.ts
./node_modules/.bin/vitest run test/mail-sweep.test.ts
./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit && echo tsc-ok
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
cd ../pwa && ./node_modules/.bin/vitest run test/mail-screen.test.tsx
./node_modules/.bin/vitest run test/feed.test.ts
./node_modules/.bin/vitest run test/notifymark.test.ts
```

Expected (measured 2026-09-29 at `6da36f0b` with wave 1 and Tasks 1–2 applied, each file alone): `18 passed (18)`; `pr-sweep` `37 passed (37)`; `prstate` `58 passed (58)`; `single-definition` `230 passed (230)`; `coord-store` `169 passed (169)`; `mail-hardening` `18 passed (18)` (both new reads name no `mail_deliveries`, so the delivery-writer census does not see them); `mail-sweep` `79 passed (79)`; `tsc-ok` (with `agent/node_modules` installed — `server/src` reaches `agent/src/server.ts`, which imports `ws`); `7 passed | 328 skipped (335)` (the two in-place `shared/api.ts` lines moved no citation); `mail-screen` `26 passed (26)`, `feed` `15 passed (15)`, `notifymark` `11 passed (11)`, each `Type Errors  no errors`.

- [ ] **Step 9: Mutation check, then commit**

Rows L3–L6 and L9–L23 are re-anchored to where their text lives after the decision extraction (`landing-verdict-is-l1`): the latch, the key, the dequeued word, the coordinator guess, the merging test, the briefs, the subject and `recordAlways` are `coord/landing.ts`'s; the reads and the delivery order are `watch.ts`'s, whose `sweepLanding` is now a loop over `landingVerdict`'s steps, so L6, L11 and L12 are re-expressed too (L6 asks the coordinator of a null run inside the verdict; L11 and L17 now mutate the one shared `toldMail` read, each conditional on its own subject so each keeps its own red; L12 sets `facts.told = false`). Re-measured 2026-10-03 at the extraction commit; every row reds. `pr-queue-lane`'s counts are the ones below for every row but one: L20 went from `1 failed` to `2 failed`, because the delivery is now one site and latching before it reds the thrown-mail case of the dequeue arm as well as the merged one (its cell says so). `landing-verdict` adds a red of its own to L3, L4, L5, L6, L16, L18, L21, L22 and L23, and none to L14, whose mutation it reads through the same function.

Twenty-eight mutations, run with `$SCRATCH/mutate.py` (restored from a saved COPY after each row). Every red below was measured on 2026-09-29 at `6da36f0b` with wave 1 and Tasks 1–2 applied, except L24, W1 and W2 and P1's count. L24, W1 and W2 are new in fix round 2 (part T, review 247 F11): they pin guards the fix round added (`landing-verdict-is-l1`'s purity, `queue-words-pinned-across-languages`), were measured on 2026-10-03 at the round's tip, and sit in this table because the test W1 and W2 run imports `PR_QUEUE_WORDS` from `prstate.ts`, which this task edits; P1 was re-measured the same day (27 cases). "The dequeue cases" are the nine that expect a dequeue notice or record: once, second removal, survivor, no open run, the watched pane, and the unreadable, thrown-mail, restart-mailed and restart-feed-only cases of "latches only what it told":

| # | Exact edit | Test file | Expected red (measured) |
|---|---|---|---|
| L1 | `watch.ts`: delete `      this.sweepLanding(records);` | `pr-queue-lane` | `12 failed \| 6 passed` — the nine dequeue cases, the merged-once case, the merged defer-and-retry case and the merged-restart case: `expected [] to have a length of 1 but got +0` |
| L2 | `watch.ts`: delete `          this.prQueues.set(line.id, queueFor(line));` (mutate the CALL SITE, not the reader) | `pr-queue-lane` | `9 failed \| 9 passed` — the nine dequeue cases; the merged cases stay green, because they read the phase, not the word |
| L3 | `coord/landing.ts`: delete `  if (latched.has(key)) return null;` (in `landingAsk`; was `watch.ts`'s `if (this.landingNotified.has(key)) continue;`) | `pr-queue-lane`, `landing-verdict` | `1 failed` in each — `pr-queue-lane`'s "…mails the coordinator of the open run, once": `a latched removal re-read the run rows on the next sweep: expected "openRunsForSession" to not be called at all, but actually been called 1 times` (the durable read still stops a second notice; the in-memory latch is what spares the reads); `landing-verdict`'s latched-key case: `expected { notice: 'dequeued', …(5) } to be null` |
| L4 | `coord/landing.ts`: drop `@${at ?? ''}` from the latch key in `landingAsk` (was `watch.ts`'s `const key = …`) | `pr-queue-lane`, `landing-verdict` | `3 failed` (`pr-queue-lane`) — the once case's tag lookup (`expected undefined to be defined`), "announces a SECOND removal…" (`… to have a length of 2 but got 1`) and the restart case's new removal (`expected { mail: 1, feed: 1 } to deeply equal { mail: 2, feed: 2 }`); `5 failed` (`landing-verdict`) — the key cases |
| L5 | `coord/landing.ts`: `  const dequeued = l.queue?.state === 'dequeued';` → `… === 'dequeued' \|\| l.queue?.state === 'unmeasured';` (in `landingAsk`; was `watch.ts`'s `const dequeued = q?.state === 'dequeued';`) | `pr-queue-lane`, `landing-verdict` | `1 failed` in each — `pr-queue-lane`'s "says nothing for…": `{"queue":"unmeasured"}: expected [ { seq: 1, … } ] to deeply equal []`; `landing-verdict`'s asks-nothing case: `unmeasured: expected { notice: 'dequeued', …(5) } to be null` |
| L6 | `coord/landing.ts`: in `landingVerdict`, ask `resolveCoordinator` of a null run too — `  if (run !== null && f.coordinator === undefined) return { step: 'coordinator', runId: run.id };` + `  const coordinator = run === null ? null : f.coordinator ?? null;` → `  if (f.coordinator === undefined) return { step: 'coordinator', runId: (run?.id ?? null) as number };` + `  const coordinator = f.coordinator ?? null;` (guess the coordinator; was `watch.ts`'s `coord.resolveCoordinator(run?.id ?? null)`) | `pr-queue-lane`, `landing-verdict` | `1 failed` (`pr-queue-lane`) — "with no open run…": `expected 'PR #42 left the merge queue without l…' to contain 'No open run names a coordinator'`; `3 failed` (`landing-verdict`) — `expected { step: 'coordinator', runId: null } to deeply equal { step: 'toldFeed', …(1) }` and the two merged no-run cases |
| L7 | `prstate.ts`: `return { state: 'absent', at: null };` → `return { state: 'unmeasured', at: null };` | `pr-queue-lane` | `1 failed` — "answers absent…": `expected { state: 'unmeasured', at: null } to deeply equal { state: 'absent', at: null }` |
| L8 | `prstate.ts`: `typeof line.queueAt === 'string' && QUEUE_AT_RE.test(line.queueAt)` → `typeof line.queueAt === 'string'` | `pr-queue-lane` | `1 failed` — "keeps queueAt only when…": `expected '$(reboot)' to be null` |
| L9 | `watch.ts`: latch BEFORE the lookup — insert `      this.landingNotified.add(ask.key);` directly after `      if (ask === null) continue;` in `sweepLanding` | `pr-queue-lane` | `3 failed` — `the deferred notice was never sent: expected [] to have a length of 1 but got +0`, `the thrown notice was never retried: expected [] to have a length of 1 but got +0`, and the merged arm's `the deferred merged notice was never sent` |
| L10 | `watch.ts`: fold an unreadable read into "no open run" — in `sweepLanding`'s `case runs` (inside the labelled `switch`, so a 14-space indent), `              facts.runs = sib.ok ? { ok: true, run } : { ok: false, detail: sib.detail };` → `              facts.runs = { ok: true, run };` | `pr-queue-lane` | `1 failed` — `an unreadable run read was announced as "no open run": expected [ { seq: 1, … } ] to deeply equal []` |
| L11 | `watch.ts`: in `sweepLanding`'s `toldMail` read, `            facts.told = coord.hasMailWithSubject('operator', s.runId, s.toId, s.subject);` → `            facts.told = s.subject.startsWith('dequeued') ? coord.hasOutstandingMail('operator', s.runId, s.toId, s.subject) : coord.hasMailWithSubject('operator', s.runId, s.toId, s.subject);` (the outstanding-only dedupe, for the dequeue subject) | `pr-queue-lane` | `1 failed` — "a restart re-announces no dequeue…": `expected { mail: 2, feed: 2 } to deeply equal { mail: 1, feed: 1 }` |
| L12 | `watch.ts`: `            facts.told = coord.hasFeedEvent('queue', r.id, s.body);` → `            facts.told = false;` | `pr-queue-lane` | `1 failed` — "a restart re-records no feed-only dequeue either": `expected [ { seq: 1, …(6) }, { seq: 2, …(6) } ] to have a length of 1 but got 2` |
| L13 | `watch.ts`: in `sweepLanding`'s `case deliver` (14-space indent), move the `if (s.record !== null) this.pushOne(…)` line ABOVE the `if (s.mail !== null) queueSystemMail(coord, run, s.mail);` line (record before mail) | `pr-queue-lane` | `1 failed` — `a record was left for a notice that was never sent: expected [ { seq: 1, … } ] to deeply equal []` |
| L14 | `coord/landing.ts`: ``  at === null ? `dequeued:#${pr}` : `dequeued:#${pr}@${at}`;`` → ``  `dequeued:#${pr}`;`` (subject per PR, not per removal; was `rundefs.ts`, which now re-exports it) | `pr-queue-lane` | `3 failed` — `expected 'dequeued:#42' to be 'dequeued:#42@2026-09-23T11:30:00Z'`, "announces a SECOND removal…" and the restart case's new removal |
| L15 | `watch.ts`: `            run = sib.ok ? survivorOf(sib.siblings) : null;` → `            run = sib.ok ? (sib.siblings[0] ?? null) : null;` (the oldest, not the close's survivor) | `pr-queue-lane` | `1 failed` — "names the survivor…": `expected [ 1 ] to deeply equal [ 2 ]` |
| L16 | `coord/landing.ts`: `    if (f.runState.state !== 'merging') return LATCH;` → `    if (f.runState.state === null) return LATCH;` (in `landingVerdict`'s merged arm) | `pr-queue-lane`, `landing-verdict` | `1 failed` in each — `pr-queue-lane`'s "says nothing when the run is not at merging…": `{"state":"awaiting-review"}: expected [ { id: 1, … } ] to deeply equal []`; `landing-verdict`'s not-at-merging case: `working: expected { step: 'toldMail', runId: 7, …(2) } to deeply equal { step: 'latch' }` |
| L17 | `watch.ts`: the same `toldMail` read, `            facts.told = …hasMailWithSubject(…)` → `            facts.told = s.subject.startsWith('merged') ? coord.hasOutstandingMail('operator', s.runId, s.toId, s.subject) : coord.hasMailWithSubject('operator', s.runId, s.toId, s.subject);` (the outstanding-only dedupe, for the merged subject) | `pr-queue-lane` | `1 failed` — "a restart re-mails no merge it already told — acked": `expected [ …(2) ] to have a length of 1 but got 2` |
| L18 | `coord/landing.ts`: `gh pr merge ${pr} --match-head-commit <handoffCommit>` → `gh pr merge ${pr}` (the brief drops the exact-SHA binding; `renderDequeueBrief` moved here from `watch.ts`) | `pr-queue-lane`, `landing-verdict` | `1 failed` in each — the brief case: `expected 'PR #42 (workspace \`demo-quiet-basin\`)…' to contain '\`gh pr merge 42 --match-head-commit <…'` |
| L19 | `watch.ts`: in `sweepLanding`'s `runState` read, `            facts.runState = read.ok ? { ok: true, state: read.run?.state ?? null } : { ok: false, detail: read.detail };` → `            facts.runState = { ok: true, state: read.ok ? read.run?.state ?? null : null };` (an unreadable run row read as "not at `merging`") | `pr-queue-lane` | `1 failed` — the merged defer-and-retry case: `expected "warn" to be called with arguments: [ StringContaining{…} ]` |
| L20 | `watch.ts`: latch BEFORE the mail — insert `            this.landingNotified.add(ask.key);` directly above `            if (s.mail !== null) queueSystemMail(coord, run, s.mail);` in the delivery | `pr-queue-lane` | `2 failed` — the thrown-mail cases of both arms: `the thrown notice was never retried: expected [] to have a length of 1 but got +0` and `the thrown merged notice was never retried: expected [] to have a length of 1 but got +0` (the delivery is now ONE site, so the row reds the dequeue arm's case as well as the merged one the plan's row named) |
| L21 | `coord/landing.ts`: the dequeue record's `recordAlways: true } };` → `recordAlways: false } };` (the presence gate may drop it) | `pr-queue-lane`, `landing-verdict` | `1 failed` (`pr-queue-lane`) — "records the dequeue even while the operator is looking at the pane…": `the operator watching the pane erased the record of a removal: expected [] to have a length of 1 but got +0`; `2 failed` (`landing-verdict`) — the two `deliver` cases |
| L22 | `coord/landing.ts`: the brief's four read-why lines → the old `` Read why from your own shell: `gh pr view ${pr} --json statusCheckRollup,mergeStateStatus`. `` (the PR head's checks, not the queue's run) | `pr-queue-lane`, `landing-verdict` | `1 failed` in each — the brief case: `expected 'PR #42 (workspace \`demo-quiet-basin\`)…' to contain '\`gh run list --event merge_group'` |
| L23 | `coord/landing.ts`: the brief drops the disarm — `— or disarm any armed auto-merge ` + `` (`gh pr merge ${pr} --disable-auto`) and send the owning worker `` → `— or send the owning worker` | `pr-queue-lane`, `landing-verdict` | `1 failed` in each — the brief case: `… to contain '\`gh pr merge 42 --disable-auto\`'` |
| L24 | `coord/landing.ts`: add `import { survivorOf } from './rundefs.js';` below the type import (a VALUE import: `survivorOf` stays the caller's, and `rundefs.ts` holds the database handle an L1 file may not reach) — review 247's P-purity row, for `landing-verdict-is-l1`'s purity pin | `landing-verdict` | `1 failed \| 27 passed (28)` — "imports values only from shared/api.ts (L0)…": `landing.ts takes a value import from ./rundefs.js: expected './rundefs.js' to be '../../../shared/api.js'` (measured 2026-10-03, fix round 2 part T) |
| K1 | `shared/api.ts`: `'update', 'queue', 'unknown'];` → `'update', 'unknown'];` | `pr-queue-lane` | `9 failed \| 9 passed (18)` (re-measured 2026-10-03 at `926efcfc4`, file restored byte-for-byte) — the nine dequeue cases: the stored row reads back through `isNotifyKind` as `unknown` (`expected [] to have a length of 1 but got +0`, and `TypeError: Cannot read properties of undefined (reading 'runId')` on the survivor case) |
| P1 | `MailScreen.tsx`: delete `queue: '⤺', ` | `pwa:` `mail-screen` | `1 failed \| 26 passed (27)` — "renders a queue-kind feed record…": `no glyph for queue: expected '' to be '⤺'` |
| W1 | `ccd/ccd` (re-stamped): in `_pr_queue_py`'s `word()`, `        return 'dequeued', at` → `        return 'removed', at` — review 241's X1, the rename the cross-language pin exists for | `ccd-pr-queue-words`, then `pr-queue-lane` | `1 failed \| 2 passed (3)` — "every word `_pr_queue_py` can emit is a PR_QUEUE_MAP word…": `expected [ 'landed', 'none', 'queued', …(2) ] to deeply equal [ 'dequeued', 'landed', 'none', …(2) ]`; `pr-queue-lane` still `18 passed (18)`, its fixture lines spell the words by hand (measured 2026-10-03, fix round 2 part T) |
| W2 | `prstate.ts`: the map's key `  landed: 'the PR merged and its last queue act was the add: the queue merged it',` → `  merged: …` (the server renames a word, ccd does not) | `ccd-pr-queue-words` | `1 failed \| 2 passed (3)` — the same case: `expected [ 'dequeued', 'landed', 'none', …(2) ] to deeply equal [ 'dequeued', 'merged', 'none', …(2) ]` (measured 2026-10-03, fix round 2 part T) |

Rows (`$SCRATCH/mut-task3.json`; a `pwa:` prefix runs the file from `pwa/`):

```json
[
 {"id": "L1", "file": "server/src/watch.ts", "old": "      this.sweepLanding(records);\n", "new": "", "tests": ["test/pr-queue-lane.test.ts"]},
 {"id": "L2", "file": "server/src/watch.ts", "old": "          this.prQueues.set(line.id, queueFor(line));\n", "new": "", "tests": ["test/pr-queue-lane.test.ts"]},
 {"id": "L3", "file": "server/src/coord/landing.ts", "old": "  if (latched.has(key)) return null;\n", "new": "", "tests": ["test/pr-queue-lane.test.ts", "test/landing-verdict.test.ts"]},
 {"id": "L4", "file": "server/src/coord/landing.ts", "old": "const key = `${l.sessionId}#${l.number}:${dequeued ? 'dequeued' : 'merged'}@${at ?? ''}`;", "new": "const key = `${l.sessionId}#${l.number}:${dequeued ? 'dequeued' : 'merged'}`;", "tests": ["test/pr-queue-lane.test.ts", "test/landing-verdict.test.ts"]},
 {"id": "L5", "file": "server/src/coord/landing.ts", "old": "  const dequeued = l.queue?.state === 'dequeued';", "new": "  const dequeued = l.queue?.state === 'dequeued' || l.queue?.state === 'unmeasured';", "tests": ["test/pr-queue-lane.test.ts", "test/landing-verdict.test.ts"]},
 {"id": "L6", "file": "server/src/coord/landing.ts", "old": "  if (run !== null && f.coordinator === undefined) return { step: 'coordinator', runId: run.id };\n  const coordinator = run === null ? null : f.coordinator ?? null;", "new": "  if (f.coordinator === undefined) return { step: 'coordinator', runId: (run?.id ?? null) as number };\n  const coordinator = f.coordinator ?? null;", "tests": ["test/pr-queue-lane.test.ts", "test/landing-verdict.test.ts"]},
 {"id": "L7", "file": "server/src/prstate.ts", "old": "  if (line.queue === undefined) return { state: 'absent', at: null };", "new": "  if (line.queue === undefined) return { state: 'unmeasured', at: null };", "tests": ["test/pr-queue-lane.test.ts"]},
 {"id": "L8", "file": "server/src/prstate.ts", "old": "typeof line.queueAt === 'string' && QUEUE_AT_RE.test(line.queueAt)", "new": "typeof line.queueAt === 'string'", "tests": ["test/pr-queue-lane.test.ts"]},
 {"id": "L9", "file": "server/src/watch.ts", "old": "      if (ask === null) continue;\n", "new": "      if (ask === null) continue;\n      this.landingNotified.add(ask.key);\n", "tests": ["test/pr-queue-lane.test.ts"]},
 {"id": "L10", "file": "server/src/watch.ts", "old": "              run = sib.ok ? survivorOf(sib.siblings) : null;\n              facts.runs = sib.ok ? { ok: true, run } : { ok: false, detail: sib.detail };", "new": "              run = sib.ok ? survivorOf(sib.siblings) : null;\n              facts.runs = { ok: true, run };", "tests": ["test/pr-queue-lane.test.ts"]},
 {"id": "L11", "file": "server/src/watch.ts", "old": "            facts.told = coord.hasMailWithSubject('operator', s.runId, s.toId, s.subject);", "new": "            facts.told = s.subject.startsWith('dequeued') ? coord.hasOutstandingMail('operator', s.runId, s.toId, s.subject) : coord.hasMailWithSubject('operator', s.runId, s.toId, s.subject);", "tests": ["test/pr-queue-lane.test.ts"]},
 {"id": "L12", "file": "server/src/watch.ts", "old": "            facts.told = coord.hasFeedEvent('queue', r.id, s.body);", "new": "            facts.told = false;", "tests": ["test/pr-queue-lane.test.ts"]},
 {"id": "L13", "file": "server/src/watch.ts", "old": "              if (s.mail !== null) queueSystemMail(coord, run, s.mail);\n              if (s.record !== null) this.pushOne({ kind: 'queue', sessionId: r.id, project: r.project, ...s.record }, this.activeProjects);\n", "new": "              if (s.record !== null) this.pushOne({ kind: 'queue', sessionId: r.id, project: r.project, ...s.record }, this.activeProjects);\n              if (s.mail !== null) queueSystemMail(coord, run, s.mail);\n", "tests": ["test/pr-queue-lane.test.ts"]},
 {"id": "L14", "file": "server/src/coord/landing.ts", "old": "  at === null ? `dequeued:#${pr}` : `dequeued:#${pr}@${at}`;", "new": "  `dequeued:#${pr}`;", "tests": ["test/pr-queue-lane.test.ts"]},
 {"id": "L15", "file": "server/src/watch.ts", "old": "            run = sib.ok ? survivorOf(sib.siblings) : null;", "new": "            run = sib.ok ? (sib.siblings[0] ?? null) : null;", "tests": ["test/pr-queue-lane.test.ts"]},
 {"id": "L16", "file": "server/src/coord/landing.ts", "old": "    if (f.runState.state !== 'merging') return LATCH;", "new": "    if (f.runState.state === null) return LATCH;", "tests": ["test/pr-queue-lane.test.ts", "test/landing-verdict.test.ts"]},
 {"id": "L17", "file": "server/src/watch.ts", "old": "            facts.told = coord.hasMailWithSubject('operator', s.runId, s.toId, s.subject);", "new": "            facts.told = s.subject.startsWith('merged') ? coord.hasOutstandingMail('operator', s.runId, s.toId, s.subject) : coord.hasMailWithSubject('operator', s.runId, s.toId, s.subject);", "tests": ["test/pr-queue-lane.test.ts"]},
 {"id": "L18", "file": "server/src/coord/landing.ts", "old": "gh pr merge ${pr} --match-head-commit <handoffCommit>", "new": "gh pr merge ${pr}", "tests": ["test/pr-queue-lane.test.ts", "test/landing-verdict.test.ts"]},
 {"id": "L19", "file": "server/src/watch.ts", "old": "            facts.runState = read.ok ? { ok: true, state: read.run?.state ?? null } : { ok: false, detail: read.detail };", "new": "            facts.runState = { ok: true, state: read.ok ? read.run?.state ?? null : null };", "tests": ["test/pr-queue-lane.test.ts"]},
 {"id": "L20", "file": "server/src/watch.ts", "old": "            if (s.mail !== null) queueSystemMail(coord, run, s.mail);\n", "new": "            this.landingNotified.add(ask.key);\n            if (s.mail !== null) queueSystemMail(coord, run, s.mail);\n", "tests": ["test/pr-queue-lane.test.ts"]},
 {"id": "L21", "file": "server/src/coord/landing.ts", "old": "      tag: `queue-${a.key}`, recordAlways: true } };", "new": "      tag: `queue-${a.key}`, recordAlways: false } };", "tests": ["test/pr-queue-lane.test.ts", "test/landing-verdict.test.ts"]},
 {"id": "L22", "file": "server/src/coord/landing.ts", "old": "    `Read why from the QUEUE's own CI run, not the PR's checks — they ran on a different commit and can read green: ` +\n    `\\`gh run list --event merge_group --limit 20 --json databaseId,headBranch,conclusion\\` finds it by its ` +\n    `\\`headBranch\\` (\\`gh-readonly-queue/<base>/pr-${pr}-…\\`), \\`gh run view <id> --log-failed\\` says why, and ` +\n    `\\`gh pr view ${pr} --json mergeStateStatus\\` answers a conflict.\\n` +", "new": "    `Read why from your own shell: \\`gh pr view ${pr} --json statusCheckRollup,mergeStateStatus\\`.\\n` +", "tests": ["test/pr-queue-lane.test.ts", "test/landing-verdict.test.ts"]},
 {"id": "L23", "file": "server/src/coord/landing.ts", "old": "— or disarm any armed auto-merge ` +\n    `(\\`gh pr merge ${pr} --disable-auto\\`) and send the owning worker", "new": "— or send the owning worker", "tests": ["test/pr-queue-lane.test.ts", "test/landing-verdict.test.ts"]},
 {"id": "L24", "file": "server/src/coord/landing.ts", "old": "import type { PrQueueRead } from '../prstate.js';\n", "new": "import type { PrQueueRead } from '../prstate.js';\nimport { survivorOf } from './rundefs.js';\n", "tests": ["test/landing-verdict.test.ts"]},
 {"id": "K1", "file": "shared/api.ts", "old": "'update', 'queue', 'unknown'];", "new": "'update', 'unknown'];", "tests": ["test/pr-queue-lane.test.ts"]},
 {"id": "P1", "file": "pwa/src/screens/MailScreen.tsx", "old": "queue: '⤺', ", "new": "", "tests": ["pwa:test/mail-screen.test.tsx"]},
 {"id": "W1", "file": "ccd/ccd", "old": "        return 'dequeued', at", "new": "        return 'removed', at", "tests": ["test/ccd-pr-queue-words.test.ts", "test/pr-queue-lane.test.ts"], "restamp": true},
 {"id": "W2", "file": "server/src/prstate.ts", "old": "  landed: 'the PR merged and its last queue act was the add: the queue merged it',", "new": "  merged: 'the PR merged and its last queue act was the add: the queue merged it',", "tests": ["test/ccd-pr-queue-words.test.ts"]}
]
```

```bash
git add server/src/prstate.ts server/src/watch.ts server/src/coord/store.ts server/src/coord/rundefs.ts \
  shared/api.ts pwa/src/screens/MailScreen.tsx pwa/test/mail-screen.test.tsx server/test/pr-queue-lane.test.ts
git commit -m "$(cat <<'MSG'
feat(server): the landing lane — a dequeue and a merge reach the coordinator

queueFor is the ONE reader of ccd's additive queue/queueAt fields: the five
words, a stranger token as unmeasured, and absent for a line that never asked
(an older ccd, or --session) — never folded into unmeasured. sweepLanding,
after sweepMerged, tells the coordinator of the open run that names the
workspace (survivorOf, the close's own pick) two things: a `dequeued` reading,
once per (workspace, PR, removal time), as a status mail dequeued:#<n>@<at>
and a `queue` feed record (the record alone when no open run names it —
never a guessed coordinator); and a merge while that run waits at `merging`,
once per (workspace, PR), as a status mail merged:#<n> — the wake-up a
coordinator that enqueued and ended its turn needs (clause 7: it never
polls). It enqueues, merges and re-runs nothing (spec §5.2, R5).

Why the open run is the key: under One PR per child a producer that closed
before its PR landed is reclaimed (child-reclamation wave 3), and a reclaimed
workspace has no pr-state line and no worker. So on a native-queue project the
coordinator lands before it closes (clause 15, Task 5): the run waits at
merging holding the child, and the row, the line and the worker outlive the
queue. The dequeue brief re-enqueues at the exact SHA (--match-head-commit
<handoffCommit>, never --admin); the merged brief asks for the merge proof.

Once means once across a restart too: CoordStore.hasMailWithSubject (every
delivery state — queueSystemMail's dedupe sees outstanding rows only) and
hasFeedEvent (the feed-only arm) say "already told". The in-memory latch is
written only after the notice landed or the lane decided there is nobody to
tell: unreadable run rows defer (never "no open run"), and a thrown mail is
retried on the next sweep with no record left behind.

The dequeue brief reads why from the queue's own merge_group run — the PR
head's checks never include it and can read green — and disarms any armed
auto-merge before a fix round. A PR whose enqueue only ARMED auto-merge reads
`none` and the lane stays silent by design; the coordinator's read-back of
the queue entry is what catches it (the lane's docstring says so). Pinned:
the merged arm's deferral and latch-after-mail, and the dequeue record's
exemption from the presence gate.

`queue` is the ninth NotifyEvent kind: additive, degraded to `unknown` by an
older client, named in MailScreen's two total maps. shared/api.ts's three lines
(two code, one docstring) change in place, so no cited line moves. No FLEET_PROTO bump; PrState and
FleetSession are unchanged. The two subjects are spelled once, in rundefs.ts.
MSG
)"
```

---
### Task 4: The hook denies `gh pr merge` to a programme wave's session and to every dispatched child

**Model routing:** `sonnet`, effort `high` — the hook is on every tool call of ~20 sessions, and it is the gate R5 leans on.

**Files:**
- Modify: `ccd/session-hook.sh` — `_hook_hold_card`'s shape-gate line (in place); the `CCRC_PROJ_CLASS` note's two lines naming the third spelling (in place); the fifteen lines from `# The hold's own bound.` through `CCRC_HOLD_MAX=127` rewritten as fifteen lines that also assign `CCRC_HOLD_WAVE_RE`; the deny block directly above `if [[ "$event" == SubagentStart || "$event" == SubagentStop ]]; then` (on this branch that is directly below wave 1's sync advisory, which sits between the graph gate and the subagent block)
- Modify: `server/test/run-routes.test.ts` — the hold-grammar pin
- Test: `server/test/session-hook-merge-deny.test.ts` (new)

**Interfaces:**
- Consumes: `$REG/<id>.hold` (read through `_ct_read`, judged under `CCRC_HOLD_MAX` by `CCRC_HOLD_WAVE_RE`); `$REG/<id>.child`, the child marker `cmd_ws_add --child` writes (`_reg_set "$id" child …`, ≈7117 at `6da36f0b`) and nothing else does — its EXISTENCE only, never its contents; the PreToolUse payload's `tool_name` and `tool_input.command` (read by the one jq, which also removes backslash escapes, quoted spans and `#` comments — jq's `gsub`, Oniguruma, lookahead and lookbehind included; measured with jq 1.7), `_hook_deny_json`, `pre_json` and its single print site.
- Produces: `CCRC_HOLD_WAVE_RE` — the ONE spelling of "a hold that names a programme wave" in the hook; a PreToolUse deny whose reason quotes the hold (or names the child marker) and says the coordinator lands. The marker arm is what closes Pre-flight finding 12's window (iii): a close's `ws-release` removes the hold and wave 3's reclaim is asynchronous (and deferred while `attached`, `paused`, `tree-busy`…), while the marker outlives both until the reclaim purges the registry row with the pane. Wave 2b extends this block with the every-session `--admin` deny and the `gh api` merge denies (the pulls merge endpoint, and the GraphQL merge mutations).

- [ ] **Step 1: Write the failing test** — `server/test/session-hook-merge-deny.test.ts`:

```typescript
/**
 * The worker merge deny (landing-order wave 2, spec §5.2, ruling R5): the
 * session hook's PreToolUse arm DENIES `gh pr merge` in a session whose hold
 * names a programme wave, and in any workspace that carries the child marker
 * (`$REG/<id>.child`, which only a dispatch writes) — a child whose run has
 * let it go keeps its pane until the reclaim, and it is still a worker. Every
 * other session's merge passes: the coordinator's `gh pr merge <n>
 * --match-head-commit <sha>` is how it enqueues. A deny never replaces the
 * graph gate's, which has already counted the denial it prints (D-1689).
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
/** The child marker, as `cmd_ws_add --child 17` writes it. */
const marker = (): void => { fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.child`), '17'); };

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

  it('lets a coordinator\'s enqueue through — a session with no wave hold and no child marker is never asked', () => {
    expect(bash('gh pr merge 42 --match-head-commit ' + 'a'.repeat(40)).deny).toBeNull();
    expect(bash('gh pr merge 42').deny).toBeNull();
  });

  it('refuses a released child — the marker outlives the hold, in the window before the reclaim', () => {
    marker();
    const r = bash('gh pr merge 42');
    expect(r.deny, 'a child whose run let it go merged').not.toBeNull();
    expect(r.deny).toContain('child');
    expect(r.deny).toContain('the coordinator merges, workers never do');
  });

  it('a child marker that cannot be read is still a child — it is the marker\'s existence that counts', () => {
    fs.mkdirSync(path.join(home, '.cc-sessions', `${ID}.child`));
    expect(bash('gh pr merge 42').deny).not.toBeNull();
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
      `gh pr merge 42 --match-head-commit ${'a'.repeat(40)}`,
      'GH_TOKEN=x gh pr merge 42', 'env gh pr merge 42', 'command gh pr merge 42',
      '/usr/bin/gh pr merge 42', 'gh -R owner/repo pr merge 42', 'echo ok; gh pr merge 42',
      'x=$(gh pr merge 42)', 'echo ok\ngh pr merge 42',
      // The heads an agent writes for "wait for checks, then merge": reserved
      // words, grouping, and the wrappers a command can sit behind.
      'if gh pr checks 42 --watch; then gh pr merge 42; fi', 'for n in 42; do gh pr merge $n; done',
      'while true; do gh pr merge 42; done', '{ gh pr merge 42; }', '! gh pr merge 42',
      'time gh pr merge 42', 'timeout 60 gh pr merge 42', 'nohup gh pr merge 42',
      'env GH_TOKEN=x gh pr merge 42', 'gh pr --repo o/r merge 42',
      // A "…" span that holds a `$(` runs it, so it is never stripped; and a
      // quote INSIDE a "…" span does not open a '…' one.
      'x="$(gh pr merge 42)"', 'echo "it\'s" && gh pr merge 42',
      // A `#` comment and a backslash-escaped quote open no '…' span: bash
      // reads neither as a quote, so neither may hide the merge after it.
      '# don\'t merge before CI is green\ngh pr merge 42\necho \'done\'',
      "echo it\\'s time; gh pr merge 42; echo 'ok'",
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

  it('never replaces the graph gate\'s counted deny — a search that is also a merge keeps the gate\'s reason', () => {
    // The gate has already COUNTED the denial it prints (D-1689); a merge deny
    // written over it would spend the session's bound on a denial it never saw.
    hold(WAVE_HOLD);
    const tree = path.join(home, 'tree');
    fs.mkdirSync(tree, { recursive: true });
    const git = (...a: string[]): string => spawnSync('git',
      ['-C', tree, '-c', 'user.email=f@example.invalid', '-c', 'user.name=fixture', ...a], { encoding: 'utf8' }).stdout.trim();
    git('init', '-q');
    fs.writeFileSync(path.join(tree, 'c.txt'), '0\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'c');
    fs.mkdirSync(path.join(tree, 'graphify-out'));
    fs.writeFileSync(path.join(tree, 'graphify-out', 'graph.json'),
      `{\n  "hyperedges": [],\n  "built_at_commit": "${git('rev-parse', 'HEAD')}"\n}\n`);
    fs.writeFileSync(path.join(tree, 'graphify-out', '.graphify_engine'), '0.9.9\n');
    const r = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash',
        tool_input: { command: 'rg assembleFleet src && gh pr merge 42' }, cwd: tree }),
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
        TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION },
    });
    expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
    expect(r.stdout.trim(), 'the gate did not fire — this case went blind').not.toBe('');
    const reason = String(JSON.parse(r.stdout.trim()).hookSpecificOutput.permissionDecisionReason);
    expect(reason, 'the merge deny replaced the graph gate\'s counted deny').toContain('Denial 1 of 3');
  });

  it('leaves every other gh and every mention of the words alone', () => {
    hold(WAVE_HOLD);
    for (const c of [
      'gh pr view 42', 'gh pr list --search merge', 'gh pr merged 42',
      "grep -rn 'gh pr merge' docs", 'echo "gh pr merge 42"', 'ghx pr merge 42',
      'echo run gh pr merge later', 'echo hi # gh pr merge 42 after the CI run',
      // What a wave on THIS feature writes about it: commit messages and PR
      // bodies that quote the command, in Markdown code spans and in prose.
      'git commit -m "docs (gh pr merge 42 enqueues)"',
      'git commit -m "fix; gh pr merge is the coordinator\'s"',
      'git commit -m "the coordinator lands with `gh pr merge <n>`, never --admin"',
      "git commit -m \"$(cat <<'MSG'\nfeat(hook): deny `gh pr merge --admin` in every session\nMSG\n)\"",
      "gh pr create --title t --body 'landing is `gh pr merge <n>` with no --admin'",
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

Expected (measured 2026-09-29 at `6da36f0b` with wave 1 and Tasks 1–3 applied): `6 failed | 4 passed (10)` — the six refusal cases (`a wave session's gh pr merge went through: expected null not to be null`, `a child whose run let it go merged: expected null not to be null`, `not denied: gh pr merge 42 --squash …`, and, on this wave-1 tree, `the advisory won and the merge went through`); the three pass-through cases and the graph-gate case pass before and after (the gate's deny is there before the merge deny exists).

- [ ] **Step 3: One spelling of the wave grammar — three in-place edits, no line count moves.** (a) In `_hook_hold_card`, replace the ONE line (≈839 at `6da36f0b`)

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

- [ ] **Step 4: The deny.** Locate the line `if [[ "$event" == SubagentStart || "$event" == SubagentStop ]]; then` (the one at column 0; ≈3116 at `6da36f0b`, ≈3175 with wave 1's advisory in — on this branch it follows that advisory block and a blank line) and insert directly ABOVE it:

```bash
# ── THE WORKER MERGE DENY (landing-order wave 2, spec §5.2) ─────────────
# "The coordinator merges, workers never do" (R5) was prose while every merge
# here needed the admin bypass. Once the operator sets the ruleset's approval
# count to 0, any session holding the fleet's one login could land with a
# plain `gh pr merge`. So a session whose hold names a programme wave — a
# dispatched worker's or reviewer's, the only sessions a dispatch holds — and
# any workspace that carries the CHILD MARKER (`$REG/<id>.child`, written by
# `ws-add --child` for a dispatch and by nothing else) is DENIED `gh pr merge`
# in every spelling this file can parse at a COMMAND HEAD:
# after a line start or `;` `&` `|` `(` or `$(`; past `VAR=value` prefixes,
# the reserved words and grouping a head can follow (`if` `then` `do` `else`
# `elif` `while` `until` `{` `!`), the wrappers `time` `env` `command` `exec`
# `nohup` `sudo` and `timeout <n>` (in any order, `env`'s assignments too); a
# path to the binary; and gh's own flags before `pr` or between `pr` and
# `merge` (`-R owner/repo`). `--auto`, `--squash`, `--admin` and every other
# merge flag are the same act from a worker and are denied with it.
#
# QUOTED TEXT IS REMOVED BEFORE MATCHING, in the same jq that reads the
# command, leftmost first as bash reads it: a backslash escape, every '…'
# span, every "…" span that holds no `$(`, and a `#` comment that starts a
# word — so a commit message, a PR body, a grep pattern or a comment that
# MENTIONS `gh pr merge` passes, and neither an apostrophe in a comment nor
# an escaped quote opens a span that swallows a live merge after it. A "…"
# span that holds a `$(` is kept, because that substitution runs.
# WHAT PASSES UNPARSED, said rather than hidden: `bash -c "…"`, a quoted
# command word (`"gh" pr merge`), legacy backticks, `xargs`, an unlisted
# wrapper (`nice`, `stdbuf`), a named wrapper's own flags (`sudo -E`,
# `command -p`; only `timeout`'s one argument is parsed), a `$'…'` string
# holding `\'`, and a `#` comment straight after a `)`. What is DENIED
# though it is not a merge: a heredoc BODY line that begins `gh pr merge`
# (heredocs are not stripped) — write such text through a quoted string
# instead. The hook is a contract the fleet honours, not an access boundary
# (spec §4), and identity on this box is attribution. A session with neither
# — a coordinator's own, the operator's — is never asked, so the
# coordinator's `gh pr merge <n> --match-head-commit <sha>` enqueues. A
# coordinator whose workspace DOES carry one is refused like a worker: a
# self-claimed run's hold (`POST /api/runs` admits a claimant that is its own
# session), or a reclaim heir that was the programme's own worker (hold and
# marker both). The hook cannot tell it from a worker; the lifecycle
# reference sends that coordinator to the operator's shell.
#
# WHY THE MARKER TOO. A close releases the hold (`ws-release`), and a child's
# reclaim runs AFTER the close answers, on its own queue, and defers while the
# pane is attached, the tree is busy or reclaim is paused: between the two a
# released child still has its pane and its login, and no hold. The marker is
# written at birth and purged only with the registry row, at the END of the
# reclaim, so it covers that window. Its EXISTENCE decides — a marker this
# hook cannot read is still a marker — and its contents are never read.
# Only a dispatch mints a child; a coordinator carries one only as that
# reclaim heir (above).
# Denying `--admin` to EVERY session, and a `gh api` merge — the pulls merge
# endpoint, or a GraphQL merge mutation (`mergePullRequest`,
# `enqueuePullRequest`, `enablePullRequestAutoMerge`) — is wave 2b's, after
# the operator's queue ruleset and proof run (spec §5.2 step 4); until then
# each passes this deny, measured.
#
# ORDER IS BUDGET, this arm's rule: the tool name is already read, the
# substring prefilter costs no fork, and only a Bash payload carrying `merge`
# pays the one jq for its command. The hold is read through `_ct_read` and
# judged by `CCRC_HOLD_WAVE_RE` under `CCRC_HOLD_MAX` — the card's own reader,
# shape and bound — so an absent, unreadable, empty, oversized or non-wave hold
# is not a worker wave, exactly as the card declines to call it one; such a
# session is then asked only whether it is a marked child.
#
# A DENY SUPERSEDES ADVICE: `pre_json` may already hold an `additionalContext`
# for this same call (the Read nudge, or a sync advisory); the merge deny
# replaces it. It never replaces the graph gate's DENY, which has already
# counted the denial it prints (D-1689) — that call is refused either way.
GH_MERGE_RE=$'(^|[;&|(\n]|\\$\\()[[:space:]]*(([!{]|if|then|do|else|elif|while|until|time|env|command|exec|nohup|sudo)[[:space:]]+|timeout[[:space:]]+[^[:space:]]+[[:space:]]+|[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*([^[:space:];&|()]*/)?gh([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+pr([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+merge([[:space:]]|$)'
if [[ "$event" == PreToolUse && "${tool:-}" == Bash && "$payload" == *merge* \
      && "$pre_json" != *'"permissionDecision":"deny"'* ]]; then
  mcmd=$(jq -r --arg q "'" 'if .tool_name == "Bash" then ((.tool_input.command // "")
      | gsub("\\\\.|" + $q + "[^" + $q + "]*" + $q + "|\"(?:[^\"\\\\$]|\\\\.|\\$(?!\\())*\"|(?<![^\\s;&|(])#[^\\n]*"; "")) else "" end' \
    <<<"$payload" 2>/dev/null) || mcmd=""
  if [[ -n "$mcmd" && "$mcmd" =~ $GH_MERGE_RE ]]; then
    mwhy=""
    if _ct_read "$REG/$id.hold" && (( ${#CT_V} <= CCRC_HOLD_MAX )) && [[ "$CT_V" =~ $CCRC_HOLD_WAVE_RE ]]; then
      mwhy="this workspace's hold reads \`$CT_V\` — a programme wave's session"
    elif [[ -e "$REG/$id.child" ]]; then
      mwhy="this workspace carries the child marker — a dispatched child, whose run has let it go"
    fi
    if [[ -n "$mwhy" ]]; then
      mreason="ccrc: $mwhy, and a wave's session never merges (landing-order R5: the coordinator merges, workers never do)."
      mreason+=" Report wave-done to your coordinator; it lands the PR."
      pre_json=$(_hook_deny_json "$mreason") || pre_json=""
    fi
  fi
fi

```

(The block ends with one blank line, so the subagent block keeps its blank separator. The single quote the strip needs reaches jq as `--arg q "'"`, because the jq program is itself single-quoted. The strip's four alternatives are tried at each position leftmost first, as bash reads the line: a backslash escape, a '…' span, a "…" span, and a `#` that only a line start, a blank or `;` `&` `|` `(` precedes — so a backslash inside '…' escapes nothing, and a `#` inside `${#…}` starts no comment.) The deny is PRINTED at the file's one PreToolUse print site, after the hookstate rename — so, like the graph gate's, a registry the hook cannot write prints nothing (the file's standing fail-open).

- [ ] **Step 5: Pay (and prove) the citation tax**

```bash
SCRATCH=<your scratchpad, absolute>
bash -n ccd/session-hook.sh && echo syntax-ok
git diff --numstat -- ccd/session-hook.sh
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD --files ccd/session-hook.sh
```

Expected (measured 2026-09-29 at `6da36f0b` with wave 1 and Tasks 1–3 applied): `syntax-ok`; `103	14	ccd/session-hook.sh` (the 89-line deny block, its closing blank line included, below wave 1's advisory; the three in-place edits balance); every `byFile` key `stated = base = tree` (`ccd/ccd` 148, `ccd/session-hook.sh` 21, …), `total stated 196 base 196 tree 196`, arrays 53 and 36, every `ENTERED`/`LEFT` empty. If `ccd/session-hook.sh` reads `<-- MOVED`, an insertion landed above a hook anchor — undo it and re-place it, never re-measure a hook key by hand in this wave.

- [ ] **Step 6: Run the tests to verify they pass — one file at a time**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook-merge-deny.test.ts
./node_modules/.bin/vitest run test/run-routes.test.ts -t 'binds the shared cap'
./node_modules/.bin/vitest run test/session-hook-sync-advisory.test.ts
./node_modules/.bin/vitest run test/update-branch-absent.test.ts
./node_modules/.bin/vitest run test/ask-instance-guard.test.ts
./node_modules/.bin/vitest run test/install-session-hooks.test.ts
./node_modules/.bin/vitest run test/hookstate.test.ts
./node_modules/.bin/vitest run test/session-hook.test.ts
```

Expected (measured 2026-09-29 at `6da36f0b` with wave 1 and Tasks 1–3 applied): `10 passed (10)`; `1 passed | 229 skipped (230)`; `37 passed (37)` (wave 1's advisory still speaks on every sync spelling — the deny only replaces it when it fires); `2 passed (2)` (the block spells no `update-branch`); `3 passed (3)`; `13 passed (13)`; `41 passed (41)`; `335 passed (335)` (≈160 s — every hold-card case still speaks through the hoisted grammar; the citation cases are green).

- [ ] **Step 7: Mutation check, then commit**

Fifty-nine live mutations, H1–H63 less the four retired (H32, H40, H41 and H45 retired, each row says why), and the two rows C1 and C2 (61 rows in the JSON), run with `$SCRATCH/mutate.py` (restored from a saved COPY after each row). Every red below was RE-MEASURED on 2026-10-03, in fix round 2 (review 247's F1 and F3, then its re-review's I1), on the tree that carries review 241's F1 fix its security review's fixes, fix round 2's fail-closed rules, its two edits and the `pe` fix (71 cases in `session-hook-merge-deny`); H1, H26 and H52's counts moved with the cases (H1 and H26 again with the three I1 cases), H28, H36 and H43 were re-anchored, and H61, H62 and H63 are new; the rows first ran on 2026-09-29 at `6da36f0b` with wave 1 and Tasks 1–3 applied — H8 included, now that wave 1's advisory is on the base. A row on a list case names the FIRST command of that list that reds — vitest stops the case there:

| # | Exact edit in `ccd/session-hook.sh` | Test file | Expected red (measured) |
|---|---|---|---|
| H1 | `      pre_json=$(_hook_deny_json "$mreason") \|\| pre_json=""` → `      :` | `session-hook-merge-deny` | `65 failed \| 6 passed (71)` — `a wave session's gh pr merge went through`, `a child whose run let it go merged` |
| H2 | the hold is read, never judged: `    if _ct_read "$REG/$id.hold" && (( ${#CT_V} <= CCRC_HOLD_MAX )) && [[ "$CT_V" =~ $CCRC_HOLD_WAVE_RE ]]; then` → `    if { _ct_read "$REG/$id.hold"; true; }; then` | same | `3 failed` — `expected 'ccrc: this workspace\'s hold reads ``…' to be null`, `expected 'ccrc: this workspace\'s hold reads ``…' to contain 'child'` |
| H3 | delete `(( ${#CT_V} <= CCRC_HOLD_MAX )) && ` | same | `1 failed` — `an oversized hold is unspeakable, never a wave: expected 'ccrc: this workspace\'s hold reads `p…' to be null` |
| H4 | `[[ "$CT_V" =~ $CCRC_HOLD_WAVE_RE ]]; then` (in the deny) → `[[ -n "$CT_V" ]]; then` | same | `1 failed` — `a hand hold is not a worker wave: expected 'ccrc: this workspace\'s hold reads `o…' to be null` |
| H5 | unanchored: `GH_MERGE_RE=$'(^\|[;&\|(\n]\|\\$\\()[ \t]*` → `GH_MERGE_RE=$'[ \t]*` | same | `1 failed` — `denied: echo run gh pr merge later: expected 'ccrc: this workspace\'s hold reads `p…' to be null` |
| H6 | no global-flag arm: the `gh([ \t]+-(…)+([ \t]+(…)(…)*)?)*[ \t]+pr(` group (shipped text in the JSON row) → `gh[ \t]+pr(` | same | `2 failed` — `not denied: gh -R owner/repo pr merge 42`, `not denied: gh --repo=$(cat r) pr merge 42` |
| H7 | no path-prefix arm: `([^[:space:];&\|()]*/)?gh(` → `gh(` | same | `1 failed` — `not denied: /usr/bin/gh pr merge 42` |
| H8 | a deny no longer supersedes advice: `&& "$pre_json" != *'"permissionDecision":"deny"'* ]]; then` → `&& -z "$pre_json" ]]; then` | same | `1 failed` — `the advisory won and the merge went through` |
| H9 | no reserved-word or grouping head: `([!{]\|if\|then\|do\|else\|elif\|while\|until\|time\|env\|command\|exec\|nohup\|sudo)` → `(time\|env\|command\|exec\|nohup\|sudo)` | same | `1 failed` — `not denied: if gh pr checks 42 --watch; then gh pr merge 42; fi` |
| H10 | the backtick back among the head separators | same | `1 failed` — `denied: echo `date` gh pr merge 42: expected 'ccrc: this workspace\'s hold reads `p…' to be null` |
| H11 | no strip at all: `if .tool_name == "Bash" then ((.tool_input.command // "") \| qs(true)) else "" end` → `if .tool_name == "Bash" then (.tool_input.command // "") else "" end` | same | `1 failed` — `denied: git commit -m "docs (gh pr merge 42 enqueues)": expected 'ccrc: this workspace\'s hold reads `p…' to be null` |
| H12 | a "…" span keeps none of its substitutions: `elif startswith("\"") then .[1:-1] \| subs` → `elif startswith("\"") then ""` | same | `2 failed` — `not denied: x="$(gh pr merge 42)"`, `not denied: echo "$(( $(gh pr merge 42) ))"` |
| H13 | no flags between `pr` and `merge`: the `pr([ \t]+-(…)+([ \t]+(…)(…)*)?)*[ \t]+merge` group → `pr[ \t]+merge` | same | `1 failed` — `not denied: gh pr --repo o/r merge 42` |
| H14 | no assignment prefix: `\|[A-Za-z_][A-Za-z0-9_]*=(…)*[ \t]+)*([^[:space:];&\|()]*/)?gh` → `)*([^[:space:];&\|()]*/)?gh` | same | `2 failed` — `not denied: GH_TOKEN=x gh pr merge 42`, `not denied: GH_TOKEN=$(<tok) gh pr merge 42` |
| H15 | delete the marker arm (the `elif [[ -e "$REG/$id.child" ]]; then` line and its `mwhy=` line) | same | `2 failed` — `a child whose run let it go merged`, `expected null not to be null` |
| H16 | `    elif [[ -e "$REG/$id.child" ]]; then` → `    elif [[ -f "$REG/$id.child" ]]; then` (a marker that is not a regular file stops counting) | same | `1 failed` — `expected null not to be null` |
| H17 | drop the `&& "$pre_json" != *'"permissionDecision":"deny"'*` conjunct from the block's `if` (a merge deny may replace the graph gate's) | same | `1 failed` — `the merge deny replaced the graph gate's counted deny: expected 'ccrc: this workspace\'s hold reads `p…' to contain 'Denial 1 of 3'` |
| H18 | the strip loses its comment alternative at the top level: `+ "(?<![^\\s;&\|(])#[^\\n]*\|\\$?\\(\\(" + AR` → `+ "\\$?\\(\\(" + AR` | same | `1 failed` — `not denied: # don't merge before CI is green` |
| H19 | the strip loses its escape alternative: `fs(DEFS + "\\\\.[^…]*\|\\$\\$\|` → `fs(DEFS + "\\$\\$\|` | same | `3 failed` — `not denied: echo it\'s time; gh pr merge 42; echo 'ok'`, `not denied: echo a\ #; gh pr merge 42` |
| H20 | assignment values may cross a separator again: `[A-Za-z_][A-Za-z0-9_]*=([^[:space:];&\|()]\|…)*` → `…=[^[:space:]]*` | `session-hook-merge-deny` | `1 failed` — `the hook took 28027 ms on ";a=": expected 28027 to be less than 3000` |
| H21 | the assignment's blank is `[[:space:]]+` again | same | `1 failed` — `the hook took 70113 ms on "\na=": expected 70113 to be less than 3000` |
| H22 | an assignment value loses its `$(…)` alternative | same | `1 failed` — `not denied: GH_TOKEN=$(<tok) gh pr merge 42` |
| H23 | the first gh flag token loses its `$(…)` alternative | same | `1 failed` — `not denied: gh --repo=$(cat r) pr merge 42` |
| H24 | both gh flag classes are `[^[:space:]]` again | same | `2 failed` — `not denied: gh -R $(cat r) pr merge 42`, `the hook took 14080 ms on ";gh -R ": expected 14080 to be less than 3000` |
| H25 | `timeout`'s argument loses its `$(…)` alternative | same | `1 failed` — `not denied: timeout $(echo 5) gh pr merge 42` |
| H26 | a "…" span may not hold a substitution (the strip before this fix round): `\|\\$(?![({])\|\\g<sub>\|` → `\|\\$(?![({])\|` in `dq` | same | `12 failed` — `not denied: X="$(date)"; gh pr merge 42; echo "ok"`, `not denied: echo "$(date)" && gh pr merge 42 --squash && echo "merged"` |
| H27 | no top-level heredoc: `(if $h then "\\g<hd>\|(?<!<)<<(?!<)\|" else "" end)` → `""` | same | `10 failed` — `not denied: cat <<'EOF'`, `not denied: cat <<-'EOF'` |
| H28 | F6: the regex matches any `merge`: the whole `GH_MERGE_RE=$'…'` line → `GH_MERGE_RE='merge'` | same | `3 failed` — `a non-merge was denied: ";a=": expected 'ccrc: this workspace\'s hold reads `p…' to be null`, `a non-merge was denied: "<<a ": expected 'ccrc: this workspace\'s hold reads `p…' to be null` |
| H29 | an unquoted heredoc body keeps no substitution: `(if .x == "" and .q == null then .b \| subs else "" end)` → `""` | same | `1 failed` — `not denied: cat <<EOF` |
| H30 | a heredoc inside a quoted `$(…)` may not end at `EOF)`: `hd1("s"; ""; "(?![^\\n)])")` → `hd1("s"; ""; "(?![^\\n])")` (precision: kept raw, it now false-denies the pass list's PR body) | same | `1 failed` — `denied: gh pr create --body "$(cat <<'EOF'` |
| H31 | top-level arithmetic is not kept: `\|\\$?\\(\\(" + AR + "\\)\\)\|\\$\\[` → `\|\\$\\[` (precision: the shift opens a heredoc that is kept raw) | same | `1 failed` — `denied: (( x << y ))` |
| H32 | retired in fix round 2: a bare delimiter may now start with any word character (H57 pins the old restriction as a fail-open) | same | — (not in the JSON) |
| H33 | a "…" span has no backtick span: `` \|`(?>(?:[^`\\\\]++\|\\\\(?:.\|\\n))*)`\|`)*) `` → `` \|`)*) `` | same | `1 failed` — `not denied: echo "`echo "it's"`"; gh pr merge 42; echo 'x'` |
| H34 | a substitution has no comment: `\|<\|(?<![^\\s;&\|(])#[^\\n]*\|#\|` → `\|<\|#\|` (precision) | same | `1 failed` — `denied: x="$(date # it's` |
| H35 | a "…" span has no escape: the `\|\\\\(?:.\|\\n\|\\z)` alternative leaves `dq` | same | `1 failed` — `not denied: echo "a \" $(date)"; gh pr merge 42; echo "b"` |
| H36 | a substitution holds no nested "…" span: `\|\\g<dq>\|\\(\\(` → `\|\\(\\(` in `sb` (re-anchored in fix round 2: `\\g<pe>` moved out of this spot) | same | `1 failed` — `not denied: echo "$(echo "a)b")"; gh pr merge 42; echo "y"` |
| H37 | `<<-` loses its tab-indented terminator in the regex: `hd1("t"; "\\t*"; "(?![^\\n])")` → `hd1("t"; ""; "(?![^\\n])")` (precision) | same | `1 failed` — `denied: git commit -F - <<-'EOF'` |
| H38 | no `$'…'` string: `$]*\|\\$\\$\|" + AQ + "\|" + SQ` → `$]*\|\\$\\$\|" + SQ` | same | `3 failed` — `not denied: echo $'it\'s'; gh pr merge 42; echo 'x'`, `not denied: echo $$$'\''; gh pr merge 42; echo 'x'` |
| H39 | a heredoc must find its terminator: `[^\\n]++)?)(?:" + T($n; $tabs; $end) + ")?";` → `…+ ")";` | same | `1 failed` — `the hook took 24232 ms on "<<a\n": expected 24232 to be less than 3000` |
| H40 | retired in fix round 2: an unclosed `$(` in a heredoc body is now cut by the raw-to-end choke point before it can recurse; its guard stays as defence in depth, and no single-row mutation reds | same | — (not in the JSON) |
| H41 | retired in fix round 2: a `<<` line holding a second `<<` is now declined and cut raw at its opener, so the rest-of-line recursion it pinned is unreachable; the guard stays as defence in depth | same | — (not in the JSON) |
| H42 | a "…" span has no `${…}`: `\|\\g<pe>\|\\$(?![({])\|` → `\|\\$(?![({])\|` in `dq` (precision: the span is kept raw) | same | `1 failed` — `denied: echo "${x:-"a"}" && git commit -F - <<'EOF'` |
| H43 | a `${…}` holds no nested "…" span: `\\g<dq>\|` leaves `pe` (precision) | same | `1 failed` — `denied: echo "${x:-"a"}" && git commit -F - <<'EOF'` |
| H44 | a top-level heredoc may end at `EOF)` again: `hd1(""; ""; "(?![^\\n])")` → `hd1(""; ""; "(?![^\\n)])")` | same | `2 failed` — `not denied: cat <<'EOF'`, `not denied: cat <<EOF` |
| H45 | retired in fix round 2: the 200-character top-level gate it pinned is gone | same | — (not in the JSON) |
| H46 | no top-level `$$` atom: `$]*\|\\$\\$\|" + AQ` → `$]*\|" + AQ` | same | `1 failed` — `not denied: echo $$'\'; gh pr merge 42; echo 'x'` |
| H47 | no `$$` atom in a substitution: `<#$]++\|\\$\\$\|" + AQ` → `<#$]++\|" + AQ` (precision) | same | `1 failed` — `denied: echo "$(echo $$'\')" && git commit -F - <<'EOF'` |
| H48 | top-level arithmetic is dropped, not kept: `elif startswith("$((") or startswith("((") or startswith("$[") or startswith("$$") then .` → `… startswith("((") then "" elif …` | same | `2 failed` — `not denied: (( $(gh pr merge 42) ))`, `not denied: echo $(( $(gh pr merge 42) ))` |
| H49 | arithmetic in a "…" span is dropped: `elif startswith("$((") then . else` → `then "" else` | same | `1 failed` — `not denied: echo "$(( $(gh pr merge 42) ))"` |
| H50 | an incomplete heredoc is stripped as if complete: `\| if $done \| not then null else` → `\| if false then null else` | same | `9 failed` — `not denied: echo $(( (a+(b+(c))) << 2 ))`, `not denied: x=$(cat <<EOF` |
| H51 | an unclosed span is not kept raw: `if $open then .` → `if false then .` (top level) | same | `2 failed` — `not denied: echo "unterminated; gh pr merge 42`, `not denied: cat <<EOF "x` |
| H52 | the round-1 regression: the 200-character gate returns and an open top-level `$(…)` is dropped (one edit across the two adjacent lines) | same | `1 failed` — `not denied: x=$(cat <<EOF` (the case `x=$(cat <<EOF\nhi\nEOF\necho z\ngh pr merge 42`: the two `${y/(/z}` cases that used to red it did so only through the `sb` ordering bug, and fix round 2 rewrote them) |
| H53 | the round-1 `$$` rule: `\|\\$\\$\|" + AQ` → `\|\\$\\$(?=" + $q + ")\|" + AQ` | same | `2 failed` — `not denied: echo $$$'\''; gh pr merge 42; echo 'x'`, `not denied: echo $$$$$'\''; gh pr merge 42; echo 'x'` |
| H54 | a `<<` line that keeps a quote no longer makes its heredoc incomplete: the `and ($rest \| contains(…) …)` line deleted | same | `1 failed` — `not denied: cat <<EOF "x` |
| H55 | a heredoc no longer declines when its line holds another `<<`: the `(?![^\\n]*?(?<!<)<<(?!<))` look-ahead deleted | same | `1 failed` — `not denied: cat <<A <<B` |
| H56 | a quoted delimiter may not hold a blank: `(?(<q…>)[^"'\\n]+\|` → `(?(<q…>)" + W + "\|` | same | `1 failed` — `denied: git commit -F - <<'MY EOF'` |
| H57 | a bare delimiter must start with a letter or `_` again: `def W: "[^…]+"` → `def W: "[A-Za-z_][^…]*"` | same | `1 failed` — `denied: git commit -F - <<1` |
| H58 | a body line `EOF)` no longer makes a heredoc incomplete: the `any(… startswith($wp))` test → `true` | same | `1 failed` — `not denied: x=$(cat <<EOF` |
| H59 | no choke point: `($parts \| map(. == null) \| index(true)) as $stop` → `null as $stop` in `fs` | same | `11 failed` — `not denied: echo $(( (a+(b+(c))) << 2 ))`, `not denied: x=$(cat <<EOF` |
| H60 | the escape no longer takes the rest of its word: `"\\\\.[^\\s;&\|()<>…]*\|` → `"\\\\.\|` | same | `2 failed` — `not denied: echo a\ #; gh pr merge 42`, `not denied: echo a\<tab>#x; gh pr merge 42` |
| H61 | review 247 F1, `\\g<pe>` was unreachable in a substitution: in `sb`, `AQ + "\|\\g<pe>\|\\$\|` → `AQ + "\|\\$\|` | same | `3 failed` — `not denied: echo "$(echo ${x:-)} "it's" )"; gh pr merge 42; echo 'z'`, `not denied: echo "$(cat <<EOF`, `not denied: echo "$(echo ${y/(/z})"` |
| H62 | review 247 F3, the merge word ended only by a blank: `merge([[:space:];&\|()<>]\|$)'` → `merge([[:space:]]\|$)'` | same | `4 failed` — `not denied: gh pr merge;echo ok`, `not denied: gh pr merge&&echo ok`, `not denied: x=$(gh pr merge)`, `not denied: (gh pr merge)` |
| H63 | review 247's re-review I1, `pe` read `$$` and `$'…'` as `sb` does not: in `pe`, `\\g<dq>\|\\$\\$\|" + AQ + "\|` → `\\g<dq>\|` | same | `3 failed \| 68 passed (71)` — `not denied: echo "$(echo ${v:-$${})"; gh pr merge 42; echo "})"`, `not denied: echo "$(echo ${v:-$${})"`, `not denied: echo "$(echo ${v:-$'\\''})"` |
| C1 | `_hook_hold_card`: `  [[ "$h" =~ $CCRC_HOLD_WAVE_RE ]] \|\| return 0` → the old inline regex line | `run-routes -t 'binds the shared cap'` | `1 failed` — `expected '#!/usr/bin/env bash\n# session-hook.s…' to contain '[[ "$h" =~ $CCRC_HOLD_WAVE_RE ]] \|\| r…'` |
| C2 | `CCRC_HOLD_WAVE_RE='^program:[A-Za-z0-9._-]+ wave:[0-9]+(/[0-9]+)?( run:[0-9]+)?$'` → `CCRC_HOLD_WAVE_RE='^program:[A-Za-z0-9._-]+ wave:'` | same | `1 failed` — `expected '#!/usr/bin/env bash\n# session-hook.s…' to contain 'CCRC_HOLD_WAVE_RE=\'^program:[A-Za-z0…'` |

Rows (`$SCRATCH/mut-task4.json`; a `t` field is passed to vitest as `-t`):

```json
[
 {"id": "H1", "file": "ccd/session-hook.sh", "old": "      pre_json=$(_hook_deny_json \"$mreason\") || pre_json=\"\"", "new": "      :", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H2", "file": "ccd/session-hook.sh", "old": "    if _ct_read \"$REG/$id.hold\" && (( ${#CT_V} <= CCRC_HOLD_MAX )) && [[ \"$CT_V\" =~ $CCRC_HOLD_WAVE_RE ]]; then", "new": "    if { _ct_read \"$REG/$id.hold\"; true; }; then", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H3", "file": "ccd/session-hook.sh", "old": "(( ${#CT_V} <= CCRC_HOLD_MAX )) && [[ \"$CT_V\" =~ $CCRC_HOLD_WAVE_RE ]]; then", "new": "[[ \"$CT_V\" =~ $CCRC_HOLD_WAVE_RE ]]; then", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H4", "file": "ccd/session-hook.sh", "old": "[[ \"$CT_V\" =~ $CCRC_HOLD_WAVE_RE ]]; then", "new": "[[ -n \"$CT_V\" ]]; then", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H5", "file": "ccd/session-hook.sh", "old": "GH_MERGE_RE=$'(^|[;&|(\\n]|\\\\$\\\\()[ \\t]*", "new": "GH_MERGE_RE=$'[ \\t]*", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H6", "file": "ccd/session-hook.sh", "old": "gh([ \\t]+-([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))+([ \\t]+([^-[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))*)?)*[ \\t]+pr(", "new": "gh[ \\t]+pr(", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H7", "file": "ccd/session-hook.sh", "old": "([^[:space:];&|()]*/)?gh(", "new": "gh(", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H8", "file": "ccd/session-hook.sh", "old": "&& \"$pre_json\" != *'\"permissionDecision\":\"deny\"'* ]]; then", "new": "&& -z \"$pre_json\" ]]; then", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H9", "file": "ccd/session-hook.sh", "old": "([!{]|if|then|do|else|elif|while|until|time|env|command|exec|nohup|sudo)", "new": "(time|env|command|exec|nohup|sudo)", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H10", "file": "ccd/session-hook.sh", "old": "GH_MERGE_RE=$'(^|[;&|(\\n]|\\\\$\\\\()", "new": "GH_MERGE_RE=$'(^|[;&|(`\\n]|\\\\$\\\\()", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H11", "file": "ccd/session-hook.sh", "old": "if .tool_name == \"Bash\" then ((.tool_input.command // \"\") | qs(true)) else \"\" end", "new": "if .tool_name == \"Bash\" then (.tool_input.command // \"\") else \"\" end", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H12", "file": "ccd/session-hook.sh", "old": "    elif startswith(\"\\\"\") then .[1:-1] | subs", "new": "    elif startswith(\"\\\"\") then \"\"", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H13", "file": "ccd/session-hook.sh", "old": "pr([ \\t]+-([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))+([ \\t]+([^-[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))*)?)*[ \\t]+merge", "new": "pr[ \\t]+merge", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H14", "file": "ccd/session-hook.sh", "old": "|[A-Za-z_][A-Za-z0-9_]*=([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))*[ \\t]+)*([^[:space:];&|()]*/)?gh", "new": ")*([^[:space:];&|()]*/)?gh", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H15", "file": "ccd/session-hook.sh", "old": "    elif [[ -e \"$REG/$id.child\" ]]; then\n      mwhy=\"this workspace carries the child marker — a dispatched child, whose run has let it go\"\n", "new": "", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H16", "file": "ccd/session-hook.sh", "old": "    elif [[ -e \"$REG/$id.child\" ]]; then", "new": "    elif [[ -f \"$REG/$id.child\" ]]; then", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H17", "file": "ccd/session-hook.sh", "old": "if [[ \"$event\" == PreToolUse && \"${tool:-}\" == Bash && \"$payload\" == *merge* \\\n      && \"$pre_json\" != *'\"permissionDecision\":\"deny\"'* ]]; then", "new": "if [[ \"$event\" == PreToolUse && \"${tool:-}\" == Bash && \"$payload\" == *merge* ]]; then", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H18", "file": "ccd/session-hook.sh", "old": "+ \"(?<![^\\\\s;&|(])#[^\\\\n]*|\\\\$?\\\\(\\\\(\" + AR", "new": "+ \"\\\\$?\\\\(\\\\(\" + AR", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H19", "file": "ccd/session-hook.sh", "old": "fs(DEFS + \"\\\\\\\\.[^\\\\s;&|()<>\\\"\" + $q + \"`\\\\\\\\$]*|\\\\$\\\\$|", "new": "fs(DEFS + \"\\\\$\\\\$|", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H20", "file": "ccd/session-hook.sh", "old": "[A-Za-z_][A-Za-z0-9_]*=([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))*[ \\t]+)*", "new": "[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[ \\t]+)*", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H21", "file": "ccd/session-hook.sh", "old": "[A-Za-z_][A-Za-z0-9_]*=([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))*[ \\t]+)*", "new": "[A-Za-z_][A-Za-z0-9_]*=([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))*[[:space:]]+)*", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H22", "file": "ccd/session-hook.sh", "old": "[A-Za-z_][A-Za-z0-9_]*=([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))*[ \\t]+)*", "new": "[A-Za-z_][A-Za-z0-9_]*=[^[:space:];&|()]*[ \\t]+)*", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H23", "file": "ccd/session-hook.sh", "old": "gh([ \\t]+-([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))+([ \\t]+([^-[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))*)?)*[ \\t]+pr(", "new": "gh([ \\t]+-[^[:space:];&|()]+([ \\t]+[^-[:space:];&|()][^[:space:];&|()]*)?)*[ \\t]+pr(", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H24", "file": "ccd/session-hook.sh", "old": "gh([ \\t]+-([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))+([ \\t]+([^-[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))*)?)*[ \\t]+pr(", "new": "gh([ \\t]+-[^[:space:]]+([ \\t]+[^-[:space:]][^[:space:]]*)?)*[ \\t]+pr(", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H25", "file": "ccd/session-hook.sh", "old": "timeout[ \\t]+([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))+[ \\t]+", "new": "timeout[ \\t]+[^[:space:];&|()]+[ \\t]+", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H26", "file": "ccd/session-hook.sh", "old": "|\\\\$(?![({])|\\\\g<sub>|", "new": "|\\\\$(?![({])|", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H27", "file": "ccd/session-hook.sh", "old": "(if $h then \"\\\\g<hd>|(?<!<)<<(?!<)|\" else \"\" end)", "new": "\"\"", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H28", "file": "ccd/session-hook.sh", "old": "GH_MERGE_RE=$'(^|[;&|(\\n]|\\\\$\\\\()[ \\t]*(([!{]|if|then|do|else|elif|while|until|time|env|command|exec|nohup|sudo)[ \\t]+|timeout[ \\t]+([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))+[ \\t]+|[A-Za-z_][A-Za-z0-9_]*=([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))*[ \\t]+)*([^[:space:];&|()]*/)?gh([ \\t]+-([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))+([ \\t]+([^-[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))*)?)*[ \\t]+pr([ \\t]+-([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))+([ \\t]+([^-[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))([^[:space:];&|()]|\\\\$\\\\(\\\\(?[^;&|()\\n]*\\\\)?\\\\))*)?)*[ \\t]+merge([[:space:];&|()<>]|$)'", "new": "GH_MERGE_RE='merge'", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H29", "file": "ccd/session-hook.sh", "old": "(if .x == \"\" and .q == null then .b | subs else \"\" end)", "new": "\"\"", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H30", "file": "ccd/session-hook.sh", "old": "hd1(\"s\"; \"\"; \"(?![^\\\\n)])\")", "new": "hd1(\"s\"; \"\"; \"(?![^\\\\n])\")", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H31", "file": "ccd/session-hook.sh", "old": "|\\\\$?\\\\(\\\\(\" + AR + \"\\\\)\\\\)|\\\\$\\\\[", "new": "|\\\\$\\\\[", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H33", "file": "ccd/session-hook.sh", "old": "|`(?>(?:[^`\\\\\\\\]++|\\\\\\\\(?:.|\\\\n))*)`|`)*)", "new": "|`)*)", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H34", "file": "ccd/session-hook.sh", "old": "|<|(?<![^\\\\s;&|(])#[^\\\\n]*|#|", "new": "|<|#|", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H35", "file": "ccd/session-hook.sh", "old": "(?<dq>\\\"(?>(?:[^\\\"\\\\\\\\$`]++|\\\\\\\\(?:.|\\\\n|\\\\z)|", "new": "(?<dq>\\\"(?>(?:[^\\\"\\\\\\\\$`]++|", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H36", "file": "ccd/session-hook.sh", "old": "|\\\\g<dq>|\\\\(\\\\(\" + AR", "new": "|\\\\(\\\\(\" + AR", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H37", "file": "ccd/session-hook.sh", "old": "hd1(\"t\"; \"\\\\t*\"; \"(?![^\\\\n])\")", "new": "hd1(\"t\"; \"\"; \"(?![^\\\\n])\")", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H38", "file": "ccd/session-hook.sh", "old": "$]*|\\\\$\\\\$|\" + AQ + \"|\" + SQ + \"|\\\\g<dq>", "new": "$]*|\\\\$\\\\$|\" + SQ + \"|\\\\g<dq>", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H39", "file": "ccd/session-hook.sh", "old": "[^\\\\n]++)?)(?:\" + T($n; $tabs; $end) + \")?\";", "new": "[^\\\\n]++)?)(?:\" + T($n; $tabs; $end) + \")\";", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H42", "file": "ccd/session-hook.sh", "old": "|\\\\g<pe>|\\\\$(?![({])|", "new": "|\\\\$(?![({])|", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H43", "file": "ccd/session-hook.sh", "old": "`]++|\\\\\\\\(?:.|\\\\n|\\\\z)|\\\\g<dq>|\\\\$\\\\$|\" + AQ + \"|\" + $q + \"[^\" + $q + \"]*+(?:\" + $q + \"|\\\\z)|\\\\g<sub>|\\\\g<pe>|", "new": "`]++|\\\\\\\\(?:.|\\\\n|\\\\z)|\\\\$\\\\$|\" + AQ + \"|\" + $q + \"[^\" + $q + \"]*+(?:\" + $q + \"|\\\\z)|\\\\g<sub>|\\\\g<pe>|", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H44", "file": "ccd/session-hook.sh", "old": "hd1(\"\"; \"\"; \"(?![^\\\\n])\")", "new": "hd1(\"\"; \"\"; \"(?![^\\\\n)])\")", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H46", "file": "ccd/session-hook.sh", "old": "$]*|\\\\$\\\\$|\" + AQ + \"|\" + SQ + \"|\\\\g<dq>", "new": "$]*|\" + AQ + \"|\" + SQ + \"|\\\\g<dq>", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H47", "file": "ccd/session-hook.sh", "old": "<#$]++|\\\\$\\\\$|\" + AQ", "new": "<#$]++|\" + AQ", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H48", "file": "ccd/session-hook.sh", "old": "    elif startswith(\"$((\") or startswith(\"((\") or startswith(\"$[\") or startswith(\"$$\") then .", "new": "    elif startswith(\"$((\") or startswith(\"((\") then \"\" elif startswith(\"$[\") or startswith(\"$$\") then .", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H49", "file": "ccd/session-hook.sh", "old": "elif startswith(\"$((\") then . else \"$(\" + (.[2:-1] | qs(true)) + \")\" end) end;", "new": "elif startswith(\"$((\") then \"\" else \"$(\" + (.[2:-1] | qs(true)) + \")\" end) end;", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H50", "file": "ccd/session-hook.sh", "old": "| if $done | not then null else", "new": "| if false then null else", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H51", "file": "ccd/session-hook.sh", "old": "    .[1] as $open | .[0] | if $open then .\n    elif startswith(\"\\\"\")", "new": "    .[1] as $open | .[0] | if false then .\n    elif startswith(\"\\\"\")", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H52", "file": "ccd/session-hook.sh", "old": "|\\\\$\\\\[[^\\\\]\\\\n]*\\\\]\";\n    .[1] as $open | .[0] | if $open then .", "new": "|\\\\$\\\\[[^\\\\]\\\\n]*\\\\]|(?=\\\\$\\\\([^)\\\\n<]{0,200}<<)\\\\g<sub>\";\n    .[1] as $open | .[0] | if $open and (startswith(\"$(\") | not) then .", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H53", "file": "ccd/session-hook.sh", "old": "$]*|\\\\$\\\\$|\" + AQ + \"|\" + SQ + \"|\\\\g<dq>", "new": "$]*|\\\\$\\\\$(?=\" + $q + \")|\" + AQ + \"|\" + SQ + \"|\\\\g<dq>", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H54", "file": "ccd/session-hook.sh", "old": "         and ($rest | contains(\"\\\"\") or contains($q) or contains(\"`\") | not)\n", "new": "", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H55", "file": "ccd/session-hook.sh", "old": "\"(?![^\\\\n]*?(?<!<)<<(?!<))(?>[^\\\\n]*)", "new": "\"(?>[^\\\\n]*)", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H56", "file": "ccd/session-hook.sh", "old": "(?(<q\\($n)>)[^\\\"\" + $q + \"\\\\n]+|", "new": "(?(<q\\($n)>)\" + W + \"|", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H57", "file": "ccd/session-hook.sh", "old": "def W: \"[^\\\\s;&|()<>\\\"\" + $q + \"\\\\\\\\]+\";", "new": "def W: \"[A-Za-z_][^\\\\s;&|()<>\\\"\" + $q + \"\\\\\\\\]*\";", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H58", "file": "ccd/session-hook.sh", "old": "             | .b | split(\"\\n\") | any(if $dash then sub(\"^\\\\t+\"; \"\") else . end | startswith($wp)) | not) as $done", "new": "             | true) as $done", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H59", "file": "ccd/session-hook.sh", "old": "| ($parts | map(. == null) | index(true)) as $stop", "new": "| null as $stop", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H60", "file": "ccd/session-hook.sh", "old": "fs(DEFS + \"\\\\\\\\.[^\\\\s;&|()<>\\\"\" + $q + \"`\\\\\\\\$]*|", "new": "fs(DEFS + \"\\\\\\\\.|", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H61", "file": "ccd/session-hook.sh", "old": "AQ + \"|\\\\g<pe>|\\\\$|", "new": "AQ + \"|\\\\$|", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H62", "file": "ccd/session-hook.sh", "old": "merge([[:space:];&|()<>]|$)'", "new": "merge([[:space:]]|$)'", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "H63", "file": "ccd/session-hook.sh", "old": "\\\\g<dq>|\\\\$\\\\$|\" + AQ + \"|\" + $q", "new": "\\\\g<dq>|\" + $q", "tests": ["test/session-hook-merge-deny.test.ts"]},
 {"id": "C1", "file": "ccd/session-hook.sh", "old": "  [[ \"$h\" =~ $CCRC_HOLD_WAVE_RE ]] || return 0", "new": "  [[ \"$h\" =~ ^program:[A-Za-z0-9._-]+' 'wave:[0-9]+(/[0-9]+)?(' 'run:[0-9]+)?$ ]] || return 0", "tests": ["test/run-routes.test.ts"], "t": "binds the shared cap"},
 {"id": "C2", "file": "ccd/session-hook.sh", "old": "CCRC_HOLD_WAVE_RE='^program:[A-Za-z0-9._-]+ wave:[0-9]+(/[0-9]+)?( run:[0-9]+)?$'", "new": "CCRC_HOLD_WAVE_RE='^program:[A-Za-z0-9._-]+ wave:'", "tests": ["test/run-routes.test.ts"], "t": "binds the shared cap"}
]
```

```bash
git add ccd/session-hook.sh server/test/run-routes.test.ts server/test/session-hook-merge-deny.test.ts
git commit -m "$(cat <<'MSG'
feat(hook): deny gh pr merge to a programme wave's session and to every child

The coordinator merges, workers never do (landing-order R5). Once the
operator sets approvals to 0, a plain `gh pr merge` from any session holding
the fleet's login would land, so the PreToolUse arm now denies it wherever a
command head spells it — after ; & | ( or $(, past VAR=value prefixes, the
reserved words and grouping a head follows (if/then/do/else/elif/while/
until, { and !), the wrappers time/env/command/exec/nohup/sudo/timeout <n>,
a path to the binary, and gh's flags before or after `pr` — in a session
whose hold is whole (<= CCRC_HOLD_MAX) and names a programme wave, or whose
workspace carries the child marker. The marker arm closes the window a close
opens: ws-release removes the hold at once, but the child's reclaim runs
after the close answers and defers while the pane is attached or the tree
busy; the marker, written at birth, goes only with the registry row at the
end of the reclaim. No wave hold and no marker: passes, so the coordinator's
gh pr merge <n> --match-head-commit <sha> enqueues. A coordinator carries
one only on a self-claimed run or as a reclaim heir; it is refused like a
worker, and the skill sends it to the operator's shell. A deny replaces an
advisory on the same call and never replaces the graph gate's counted deny
(pinned: the graph-gate case).

Quoted text is removed before matching, leftmost first as bash reads it, in
the jq that already reads the command: a backslash escape, '...' spans, "..."
spans holding no $(, and a # comment that starts a word — so a commit
message, PR body or comment that quotes the command passes, a "$(...)" that
runs it does not, and neither an apostrophe in a comment nor an escaped quote
can open a span that hides a live merge. What it cannot parse (bash -c
"...", a quoted command word, legacy backticks, xargs, a wrapper's own
flags) is stated in the block's header, as is the one known false deny: a
heredoc body line that begins with the command. The hook is a contract, not
an access boundary (spec §4). The every-session --admin deny and the gh api
merge denies (REST and GraphQL) are wave 2b's, after the proof run.

The hold grammar is spelled ONCE now, CCRC_HOLD_WAVE_RE, read by the card and
the deny; run-routes.test.ts pins it where it is assigned. The assignment and
two in-place edits are line-neutral and the deny sits below the graph gate
and wave 1's advisory: census 147 / 197 / 52 / 35 unmoved (the re-measurer
with --files ccd/session-hook.sh).
MSG
)"
```

---

### Task 5: The coordinator lands at the exact SHA, and lands before it closes

**Model routing:** `sonnet`, effort `high` — a pinned clause sentence, the lifecycle reference's landing paragraph, and two derived pins that bind the skill to the server's subjects and to the exact-SHA spelling.

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md` — the end of clause 15 (wave 1's); ONE sentence in step 6's **Clean** arm, ahead of its **Same project:** arm; step 7's first line becomes four (the last wave lands first)
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` — §5 step 3: the #178 merge sentence names the native-queue landing; a new **Landing on a native-queue project** paragraph directly above **Same project:**; a four-line paragraph opening §6
- Modify: `server/test/coordinator-skill.test.ts` — `CONTRACT`'s clause-15 element gains the same sentence; two new cases; the `rundefs.js` import
- (No count word moves: no clause is added. `README.md` and `CLAUDE.md` are untouched.)

**Interfaces:**
- Consumes: wave 1's clause 15, pinned verbatim in `CONTRACT`; #178's "One PR per child" paragraph and its exact-SHA merge proof (`wave-lifecycle.md` §5 step 3); `RUN_TRANSITIONS`' `awaiting-review → merging → closing` and `merging → working` edges (`shared/api.ts`); Task 3's `dequeuedSubject`/`mergedSubject` (`server/src/coord/rundefs.ts`) and the two notices `sweepLanding` sends.
- Produces: the landing spelling on a native-queue project — `gh pr merge <n> --match-head-commit <handoffCommit>`, no `--squash`, never `--admin` — and the rules that make it an enqueue — whether the project requires the queue is measured at each landing, the PR's required checks have passed (`gh pr checks <pr> --required` exits 0; gh 2.45 ARMS auto-merge, rather than queueing, any other PR, with the same line), the queue entry is read back, and an armed request is disarmed (`gh pr merge <pr> --disable-auto`) before any fix round — and the rule that makes Task 3's lane and Task 4's hold arm sound: **the producer lands BEFORE it closes**, the last wave's included (SKILL.md step 7 and §6 point at it), its run waiting at `merging` (holding the child, so the reclaim cannot take it) until the PR reads MERGED at `handoffCommit`, the `merged:#<pr>` mail waking the coordinator to prove the merge and close; a `dequeued:#<pr>@<time>` mail is answered from the queue's own CI run by re-enqueueing or by a fix round on `merging → working`, to the worker that is still there; a coordinator the hook refuses (a self-claimed run, a reclaim heir) has the operator enqueue. Pinned: every `gh pr merge` the coordinator corpus spells binds `--match-head-commit <handoffCommit>` but the exact disarm spelling, and the landing paragraph names the server's own two subjects and each of those rules.

- [ ] **Step 1: Locate clause 15, and the two passages, by content**

```bash
grep -n '^15\. ' ccd/coordinator-skill/SKILL.md | cut -c1-80
awk '/^const CONTRACT = \[/,/^\];/' server/test/coordinator-skill.test.ts | grep -c 'update-branch'
grep -n 'arm is for a producer whose workspace opened no PR' ccd/coordinator-skill/SKILL.md
grep -n '^7\. \*\*Final merge:\*\* `POST /api/runs/:id/close` with `final:true` closes the run$' ccd/coordinator-skill/SKILL.md
grep -n 'reason. An UNMARKED producer — every workspace minted without a marker,' ccd/coordinator-skill/references/wave-lifecycle.md
grep -n "^   \*\*Same project:\*\* open wave N+1 first with this producer's \`sessionId\`, then" ccd/coordinator-skill/references/wave-lifecycle.md
grep -n '^## 6 — Final merge$' ccd/coordinator-skill/references/wave-lifecycle.md
```

Expected (measured 2026-09-29 at `6da36f0b` with wave 1 applied): one line `84:15. This session never calls \`update-branch\` …`; `1` (the fifteenth `CONTRACT` element, wave 1's clause 15 — its only `update-branch`-bearing element); one hit at ≈377; one at ≈392 (step 7); one at ≈739; one at ≈756; one at ≈788 (§6). If any answers zero or two, stop and report: the shape is not what this task assumes.

- [ ] **Step 2: Write the failing tests** — in `server/test/coordinator-skill.test.ts`:

(a) Append to the fifteenth `CONTRACT` string — wave 1's clause 15, the element that ends `It commits programme-ledger documents on its own ledger PR, never inside a feature PR.` — immediately before its closing `'`, this text (one leading space; no apostrophe, so the single-quoted element takes it unchanged):

```
 On a native-queue project it lands a PR with `gh pr merge <n> --match-head-commit <handoffCommit>`, never with `--squash` or `--admin`, which enqueues it, and it closes that run only once the PR reads MERGED at `handoffCommit`: until then the run waits at `merging`.
```

(b) Replace the import line

```typescript
import { WORKER_KICKOFF_PREFIX } from '../src/coord/dispatch.js';
```

with

```typescript
import { WORKER_KICKOFF_PREFIX } from '../src/coord/dispatch.js';
import { dequeuedSubject, mergedSubject } from '../src/coord/rundefs.js';
```

(c) Directly above `  it('tells the session how to learn its own id the ONE way that is actually its own', () => {` (inside `describe('the coordinator skill: its contract'`, below wave 1's census `it`), insert:

```typescript
  it('binds the exact SHA in every `gh pr merge` it spells — and the native-queue spelling carries no --squash and no --admin (landing-order wave 2)', () => {
    // DERIVED: every backtick code span in the whole corpus that runs
    // `gh pr merge`. #178 put `--match-head-commit <handoffCommit>` into the
    // coordinator's merge "for exactly this reason" — the exact-SHA merge proof
    // — and a spelling that drops it merges whatever head the PR has by then.
    // `--disable-auto` DISARMS an armed auto-merge: it merges nothing, so it
    // binds no SHA. Only that exact spelling is exempt — a disarm span that
    // carries any other flag is held to the binding like every merge.
    const DISARM = /^gh pr merge <(?:n|pr)> --disable-auto$/;
    const spans = [...allSkillText.matchAll(/`([^`\n]*\bgh pr merge\b[^`\n]*)`/g)].map((m) => m[1]!)
      .filter((s) => !DISARM.test(s));
    expect(spans.length, 'fewer gh pr merge spellings than the three this corpus carries (clause 15, the queue landing, #178\'s squash merge) — a landing spelling was dropped, or this pin went blind').toBeGreaterThanOrEqual(3);
    for (const s of spans) {
      expect(s, `\`${s}\` merges without binding the exact SHA`).toContain('--match-head-commit <handoffCommit>');
    }
    expect(spans).toContain('gh pr merge <n> --match-head-commit <handoffCommit>');
    expect(spans).toContain('gh pr merge <pr> --match-head-commit <handoffCommit>');
  });

  it('lands before it closes on a native-queue project — the last wave too — enqueues only a green PR and proves the entry, and names the landing notices by the server\'s own subjects (landing-order wave 2)', () => {
    const wl = refs('wave-lifecycle.md');
    const at = wl.indexOf('**Landing on a native-queue project**');
    expect(at, 'wave-lifecycle.md lost its native-queue landing paragraph').toBeGreaterThanOrEqual(0);
    const para = flat(wl.slice(at, wl.indexOf('**Same project:**', at)));
    expect(para).toContain('the producer LANDS BEFORE IT CLOSES');
    expect(para).toContain('advance the producer\'s run to `merging`');
    expect(para).toContain('`merging → working`');
    // The subjects the server sends (Task 3), derived from the ONE builder of
    // each — the skill may not name a mail the server never sends.
    const merged = mergedSubject(7).replace('#7', '#<pr>');
    const dequeued = dequeuedSubject(7, '<time>').replace('#7', '#<pr>');
    expect(para, `the paragraph no longer names ${merged}`).toContain('`' + merged + '`');
    expect(para, `the paragraph no longer names ${dequeued}`).toContain('`' + dequeued + '`');
    // Whether the project requires the queue is MEASURED at each landing: it
    // changes when the operator turns the queue on or rolls it back.
    expect(para).toContain('.type == "merge_queue"');
    // gh 2.45 ARMS auto-merge, rather than queueing, a PR whose required
    // checks have not passed, and prints the same line either way — so the
    // enqueue waits on them, the entry is read back, and an armed request is
    // disarmed, before any fix round too.
    expect(para).toContain('`gh pr checks <pr> --required` exits 0');
    expect(para).toContain('never by ending your turn: no mail comes when checks finish');
    expect(para).toContain('answers a non-null `mergeQueueEntry`');
    expect(para).toContain('`gh pr merge <pr> --disable-auto`');
    // A dequeue's why is the QUEUE's own run; the PR's checks can read green.
    expect(para).toContain('`gh run list --event merge_group');
    // A coordinator the hook refuses — a self-claimed run, a reclaim heir —
    // has the operator enqueue, and never closes to shed its hold.
    expect(para).toContain('ask the operator to enqueue, or disarm');
    // SKILL.md step 6 points at it BEFORE its succession arms, where a
    // coordinator deciding when to close reads.
    const start = skill.indexOf('6. **Rule on the report**');
    expect(flat(skill.slice(start, skill.indexOf('**Same project:**', start))))
      .toContain('the producer LANDS before it closes');
    // …and so does the LAST wave, whose close is step 7's and §6's: no wave
    // N+1 is open there, so a close-first retires the programme outright.
    const seven = skill.indexOf('7. **Final merge:**');
    expect(flat(skill.slice(seven, skill.indexOf('\n## ', seven))))
      .toContain("the last wave's producer LANDS before this close");
    const six = wl.indexOf('## 6 — Final merge');
    expect(flat(wl.slice(six, wl.indexOf('\n## ', six + 1))))
      .toContain("the last wave's producer lands BEFORE this close");
  });

```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
```

Expected (measured 2026-09-29 at `6da36f0b` with wave 1 and Tasks 1–4 applied): `3 failed | 150 passed (153)` — "carries all fifteen clauses verbatim" (`missing contract clause: This session never calls \`update-branch\` by any …`), the exact-SHA case (`fewer gh pr merge spellings than the three this corpus carries … expected 1 to be greater than or equal to 3` — #178's squash spelling is the only one today) and the landing case (`wave-lifecycle.md lost its native-queue landing paragraph: expected -1 to be greater than or equal to 0`). The file read 151 with wave 1 alone; it reads 153 with this task's two new cases.

- [ ] **Step 4: The clause and the pointer, in `ccd/coordinator-skill/SKILL.md`.** Append to the END of the `15. …` line (after its final period) exactly the text Step 2 (a) appended to the `CONTRACT` element, with the same one leading space:

```
 On a native-queue project it lands a PR with `gh pr merge <n> --match-head-commit <handoffCommit>`, never with `--squash` or `--admin`, which enqueues it, and it closes that run only once the PR reads MERGED at `handoffCommit`: until then the run waits at `merging`.
```

and in step 6's **Clean** arm replace the line

```
     arm is for a producer whose workspace opened no PR.
```

with

```
     arm is for a producer whose workspace opened no PR. On a native-queue
     project the producer LANDS before it closes (clause 15;
     `references/wave-lifecycle.md` §5, "Landing on a native-queue project").
```

and in step 7 replace the line

```
7. **Final merge:** `POST /api/runs/:id/close` with `final:true` closes the run
```

with

```
7. **Final merge:** on a native-queue project the last wave's producer LANDS
   before this close, as every producer does (clause 15;
   `references/wave-lifecycle.md` §5, "Landing on a native-queue project").
   `POST /api/runs/:id/close` with `final:true` closes the run
```

- [ ] **Step 5: The landing paragraph, in `ccd/coordinator-skill/references/wave-lifecycle.md` §5 step 3.** Replace the line

```
   reason. An UNMARKED producer — every workspace minted without a marker,
```

with

```
   reason — and on a native-queue project it lands with the same binding, as
   "Landing on a native-queue project" below says. An UNMARKED producer —
   every workspace minted without a marker,
```

and directly above the line `   **Same project:** open wave N+1 first with this producer's \`sessionId\`, then` (and its preceding blank line), insert — followed by one blank line:

```
   **Landing on a native-queue project** (one whose `main` requires GitHub's
   merge queue — measure it before each landing, never from memory: from a
   checkout of its repository,
   `gh api 'repos/{owner}/{repo}/rules/branches/main' --jq 'any(.[]; .type == "merge_queue")'`
   answers `true`): the producer LANDS BEFORE IT CLOSES. Once its review is
   clean and wave N+1 is open — or, on the programme's LAST wave, which has
   no wave N+1, once its review is clean (its close is SKILL.md step 7's and
   §6's) — advance the producer's run to `merging` (§4 — from
   `awaiting-review`, re-measured). Enqueue only a PR whose required checks
   have all passed — `gh pr checks <pr> --required` exits 0 (8 is pending, 1
   is failed): for any other PR gh arms auto-merge instead of queueing it,
   and prints the same "will be added to the merge queue … when ready" line
   either way. On `8`, wait for them in the foreground —
   `gh pr checks <pr> --required --watch`, again if the call times out —
   never by ending your turn: no mail comes when checks finish. On `1`,
   send the owning worker a fix round (below), or, for a red that is not
   this PR's own, one `gh run rerun <run id> --failed` and the same wait.
   Then, from your own session, enqueue its PR with
   `gh pr merge <pr> --match-head-commit <handoffCommit>`: no `--squash`,
   because the queue's merge method applies, and never `--admin`. Prove it
   is IN the queue before you rely on the server:
   `gh api graphql -F o='{owner}' -F n='{repo}' -F p=<pr> -f query='query($o: String!, $n: String!, $p: Int!) { repository(owner: $o, name: $n) { pullRequest(number: $p) { mergeQueueEntry { state } } } }'`
   answers a non-null `mergeQueueEntry`. A null one means nothing is queued
   and nothing will tell you so: disarm it (`gh pr merge <pr> --disable-auto`)
   and read why before you do anything else. Disarm the same way before any
   fix round from `merging` — an armed auto-merge queues whatever head the
   branch carries once its checks pass, and GitHub disarms it on a push only
   from a login without write access. End your turn. The run waits at
   `merging`, holding the child, so its workspace is not reclaimed under a PR
   still in the queue, and the server tells you how the queue answered: a
   `status` mail `merged:#<pr>` once the PR reads merged, or
   `dequeued:#<pr>@<time>` when the queue removed it without landing (GitHub
   does not re-enqueue). On `merged:`, prove the merge exactly as above —
   MERGED, `headRefOid` equal to `handoffCommit` — then close the producer as
   this step closes a spent one (on the last wave, as §6 closes it), and only
   then dispatch wave N+1. A `merged:#<pr>` can also reach a run at `merging`
   on a project without the queue, when a sweep reads your own synchronous
   merge before your close: prove and close as usual; a run already closed
   needs nothing. On `dequeued:`, read why from the queue's own CI run, not
   the PR's checks, which ran on a different commit and can read green —
   `gh run list --event merge_group --json databaseId,headBranch,conclusion`
   finds it by its `headBranch` (`gh-readonly-queue/<base>/pr-<pr>-…`) and
   `gh run view <id> --log-failed` says why, while
   `gh pr view <pr> --json mergeStateStatus` answers a conflict. Then either
   enqueue it again exactly as above — checks first, then the read-back — or
   send the owning worker a fix round on the `merging → working` edge
   (SKILL.md step 6's send-back; its fresh wave-done gets a fresh review run,
   and a fresh `merging`). Closing before the landing would hand a PR still
   in the queue to a reclaim: nothing could then tell you of its dequeue, and
   no worker would be left to fix it. A coordinator whose own workspace
   carries a programme-wave hold or the child marker — a self-claimed run's,
   or a reclaim heir that was the programme's own worker — is refused its
   enqueue by the session hook, like any worker. Do not close to shed the
   hold (a final close of a child reclaims your own pane): ask the operator
   to enqueue, or disarm, with the same spellings from their own shell, and
   wait at `merging` as above.
```

and directly below the heading `## 6 — Final merge` and its blank line, insert — followed by one blank line:

```
On a native-queue project the last wave's producer lands BEFORE this close,
exactly as §5's "Landing on a native-queue project" says: with no wave N+1
open, closing it first would retire the programme and reclaim the child
under a PR still queued.
```

- [ ] **Step 6: Run the tests to verify they pass — one file at a time**

```bash
cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
./node_modules/.bin/vitest run test/child-reclaim-refusals.test.ts
./node_modules/.bin/vitest run test/crossrepo-prose.test.ts
./node_modules/.bin/vitest run test/child-reclaim-prose.test.ts
./node_modules/.bin/vitest run test/install-coordinator-skill.test.ts
./node_modules/.bin/vitest run test/routing-references.test.ts
./node_modules/.bin/vitest run test/reviewer-skill.test.ts
```

Expected (measured 2026-09-29 at `6da36f0b` with wave 1 and Tasks 1–4 applied, each file alone): `coordinator-skill` `153 passed (153)` (the landing case now also pins step 7, §6 and each landing rule; the `gh api` and `gh run` spans in the paragraph carry no `gh pr merge`, and its one disarm span is the exempt spelling); `child-reclaim-refusals` `20 passed (20)` (§5 still states One PR per child ahead of the **Same project:** arm — the landing paragraph sits between them and names no refusal code); `crossrepo-prose` `17 passed (17)`; `child-reclaim-prose` `4 passed (4)`; `install-coordinator-skill` `16 passed (16)`; `routing-references` `11 passed (11)`; `reviewer-skill` `13 passed (13)`. The succession-order pins (`orders each SKILL.md succession arm independently…`, `orders each succession branch independently before consumer dispatch`) stay green because the new text sits ABOVE **Same project:** and says "dispatch wave N+1" in lower case — `boundary.indexOf('Dispatch wave N+1')` must still find step 5's line first.

- [ ] **Step 7: Mutation check, then commit**

Twenty mutations, run with `$SCRATCH/mutate.py`. Every red below was measured on 2026-09-29 at `6da36f0b` with wave 1 and Tasks 1–4 applied, except S19 and S20 (new in fix round 2, part T, review 247 F11) and the cells S1, S12, S13 and S17, re-measured on 2026-10-03 at the round's tip with `coordinator-skill` at 154 cases (S1 `2 failed | 152 passed`; S17 `3 failed | 151 passed`, the four-answers case reding beside the two it always did); the backup copy lives in the scratchpad, never beside the file (a `SKILL.md.mutbak` in a skill directory reds the reference census on every row — wave 1's Pre-flight finding 10):

| # | Exact edit | Test file | Expected red (measured) |
|---|---|---|---|
| S1 | `SKILL.md`: delete the appended sentence (with its leading space) | `coordinator-skill` | `2 failed \| 152 passed` — "carries all fifteen clauses verbatim" and the exact-SHA case (`… expected 2 to be greater than or equal to 3`) |
| S2 | `SKILL.md` clause 15: `` `gh pr merge <n> --match-head-commit <handoffCommit>` `` → `` `gh pr merge <n>` `` | same | `2 failed` — the verbatim case, and ``\`gh pr merge <n>\` merges without binding the exact SHA`` |
| S3 | `wave-lifecycle.md`: the landing paragraph's `` `gh pr merge <pr> --match-head-commit <handoffCommit>` `` → `` `gh pr merge <pr>` `` (its line) | same | `1 failed` — ``\`gh pr merge <pr>\` merges without binding the exact SHA`` |
| S4 | `wave-lifecycle.md`: #178's `` `gh pr merge <pr> --squash --match-head-commit <handoffCommit>` `` → `` `gh pr merge <pr> --squash` `` | same | `1 failed` — ``\`gh pr merge <pr> --squash\` merges without binding the exact SHA`` (a pin that did not exist before this wave: `grep -rn match-head-commit server/test` found nothing on `main`) |
| S5 | `wave-lifecycle.md`: `` `dequeued:#<pr>@<time>` `` → `` `dequeued:#<pr>` `` | same | `1 failed` — `the paragraph no longer names dequeued:#<pr>@<time>` |
| S6 | `landing.ts` (where `mergedSubject` lives; `rundefs.ts` only re-exports it): `mergedSubject` answers `` `landed:#${pr}` `` (the server renames the mail; the skill does not follow) | `coordinator-skill`, `pr-queue-lane` | `1 failed \| 153 passed` in `coordinator-skill` — `the paragraph no longer names landed:#<pr>`; and `1 failed \| 17 passed` in `pr-queue-lane` — `expected 'landed:#42' to be 'merged:#42'` (2 red in all) |
| S7 | `SKILL.md` step 6: remove the pointer sentence (the two lines after `…opened no PR.`) | `coordinator-skill` | `1 failed` — `expected '6. **Rule on the report**. The \`revie…' to contain 'the producer LANDS before it closes'` |
| S8 | `wave-lifecycle.md`: `the producer LANDS BEFORE IT CLOSES.` → `the producer closes, then lands.` | same | `1 failed` — `expected '**Landing on a native-queue project**…' to contain 'the producer LANDS BEFORE IT CLOSES'` |
| S9 | `SKILL.md` step 7: the three pointer lines removed (`7. **Final merge:** \`POST /api/runs/:id/close\`…` again) | same | `1 failed` — `expected '7. **Final merge:** \`POST /api/runs/:…' to contain 'the last wave\'s producer LANDS befor…'` |
| S10 | `wave-lifecycle.md`: §6's opening paragraph removed | same | `1 failed` — `expected '## 6 — Final merge \`POST /api/runs/:i…' to contain 'the last wave\'s producer lands BEFOR…'` |
| S11 | `wave-lifecycle.md`: `` `gh pr checks <pr> --required` exits 0 `` → `` `gh pr checks <pr>` exits 0 `` (a red non-required leg would block every landing) | same | `1 failed` — `… to contain '\`gh pr checks <pr> --required\` exits 0'` |
| S12 | `wave-lifecycle.md`: the read-back removed — from `Prove it` through the query, `gives one of four answers.` and `` A queued PR answers a non-null `mergeQueueEntry`, the success answer. `` | same | `2 failed \| 152 passed` — ``… to contain 'answers a non-null `mergeQueueEntry`'`` (the landing paragraph's case) and `the read-back query no longer asks the PR's state, autoMergeRequest and mergeQueueEntry together` (the four-answers case) |
| S13 | `wave-lifecycle.md`: `` disarm it (`gh pr merge <pr> --disable-auto`) and read why `` → `` read why `` (an armed request is left armed) | same | `2 failed \| 152 passed` — `… to contain '\`gh pr merge <pr> --disable-auto\`'` (the landing paragraph's case) and `the disarm spelling is gone: expected -1 to be greater than 1828` (the four-answers case) |
| S14 | `wave-lifecycle.md`: `.type == "merge_queue"` → `.type == "pull_request"` (the measurement asks the wrong rule) | same | `1 failed` — `… to contain '.type == "merge_queue"'` |
| S15 | `wave-lifecycle.md`: the held coordinator's `Do not close to shed the hold … ask the operator to enqueue, or disarm, …` → `Close to shed the hold, then enqueue.` | same | `1 failed` — `… to contain 'ask the operator to enqueue, or disarm'` |
| S16 | `wave-lifecycle.md`: `` `gh run list --event merge_group --json databaseId,headBranch,conclusion` `` → `` `gh pr view <pr> --json statusCheckRollup` `` (the PR's checks again) | same | `1 failed` — `… to contain '\`gh run list --event merge_group'` |
| S17 | `wave-lifecycle.md`: the disarm span gains a flag — `` (`gh pr merge <pr> --disable-auto --admin`) `` (the exemption is ONE exact spelling) | same | `3 failed \| 151 passed` — ``\`gh pr merge <pr> --disable-auto --admin\` merges without binding the exact SHA``, the landing case's disarm pin and the four-answers case (`the disarm spelling is gone: expected -1 to be greater than 1828`). (Under a filter that exempts any span carrying `--disable-auto`, measured: `1 failed` — only the landing case's exact-span pin catches it.) |
| S18 | `wave-lifecycle.md`: `` never by ending your turn: no mail comes when checks finish. On `1`, `` → `` then end your turn: no mail comes when checks finish. On `1`, `` (a pending landing parked on mail that never comes) | same | `1 failed` — ``… to contain 'never by ending your turn: no mail co…'`` |
| S19 | `wave-lifecycle.md`: the read-back query without the armed field — `pullRequest(number: $p) { state autoMergeRequest { enabledAt } mergeQueueEntry { state } }` → `pullRequest(number: $p) { state mergeQueueEntry { state } }` — review 247's R1, for `read-back-answers-merged` | same | `1 failed \| 153 passed (154)` — the four-answers case: `the read-back query no longer asks the PR's state, autoMergeRequest and mergeQueueEntry together` (measured 2026-10-03, fix round 2 part T) |
| S20 | `wave-lifecycle.md`: the MERGED answer deleted — from ``A `state` of `MERGED` means it`` through ``from nothing queued. `` — review 247's R2 | same | `1 failed \| 153 passed (154)` — the four-answers case: `the MERGED answer is gone: a merged PR would read as nothing queued` (measured 2026-10-03, fix round 2 part T) |

Rows (`$SCRATCH/mut-task5.json`):

```json
[
 {"id": "S1", "file": "ccd/coordinator-skill/SKILL.md", "old": " On a native-queue project it lands a PR with `gh pr merge <n> --match-head-commit <handoffCommit>`, never with `--squash` or `--admin`, which enqueues it, and it closes that run only once the PR reads MERGED at `handoffCommit`: until then the run waits at `merging`.", "new": "", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S2", "file": "ccd/coordinator-skill/SKILL.md", "old": "it lands a PR with `gh pr merge <n> --match-head-commit <handoffCommit>`, never", "new": "it lands a PR with `gh pr merge <n>`, never", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S3", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "   `gh pr merge <pr> --match-head-commit <handoffCommit>`: no `--squash`,", "new": "   `gh pr merge <pr>`: no `--squash`,", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S4", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "`gh pr merge <pr> --squash --match-head-commit <handoffCommit>`", "new": "`gh pr merge <pr> --squash`", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S5", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "`dequeued:#<pr>@<time>`", "new": "`dequeued:#<pr>`", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S6", "file": "server/src/coord/landing.ts", "old": "export const mergedSubject = (pr: number): string => `merged:#${pr}`;", "new": "export const mergedSubject = (pr: number): string => `landed:#${pr}`;", "tests": ["test/coordinator-skill.test.ts", "test/pr-queue-lane.test.ts"]},
 {"id": "S7", "file": "ccd/coordinator-skill/SKILL.md", "old": "     arm is for a producer whose workspace opened no PR. On a native-queue\n     project the producer LANDS before it closes (clause 15;\n     `references/wave-lifecycle.md` §5, \"Landing on a native-queue project\").\n", "new": "     arm is for a producer whose workspace opened no PR.\n", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S8", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "the producer LANDS BEFORE IT CLOSES.", "new": "the producer closes, then lands.", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S9", "file": "ccd/coordinator-skill/SKILL.md", "old": "7. **Final merge:** on a native-queue project the last wave's producer LANDS\n   before this close, as every producer does (clause 15;\n   `references/wave-lifecycle.md` §5, \"Landing on a native-queue project\").\n   `POST /api/runs/:id/close`", "new": "7. **Final merge:** `POST /api/runs/:id/close`", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S10", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "On a native-queue project the last wave's producer lands BEFORE this close,\nexactly as §5's \"Landing on a native-queue project\" says: with no wave N+1\nopen, closing it first would retire the programme and reclaim the child\nunder a PR still queued.\n\n", "new": "", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S11", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "`gh pr checks <pr> --required` exits 0", "new": "`gh pr checks <pr>` exits 0", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S12", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "Prove it\n   is IN the queue before you rely on the server:\n   `gh api graphql -F o='{owner}' -F n='{repo}' -F p=<pr> -f query='query($o: String!, $n: String!, $p: Int!) { repository(owner: $o, name: $n) { pullRequest(number: $p) { state autoMergeRequest { enabledAt } mergeQueueEntry { state } } } }'`\n   gives one of four answers. A queued PR answers a non-null\n   `mergeQueueEntry`, the success answer. ", "new": "", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S13", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "disarm it (`gh pr merge <pr> --disable-auto`) and read why", "new": "read why", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S14", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": ".type == \"merge_queue\"", "new": ".type == \"pull_request\"", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S15", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "Do not close to shed the\n   hold (a final close of a child reclaims your own pane): ask the operator\n   to enqueue, or disarm, with the same spellings from their own shell, and\n   wait at `merging` as above.", "new": "Close to shed the hold,\n   then enqueue.", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S16", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "`gh run list --event merge_group --json databaseId,headBranch,conclusion`", "new": "`gh pr view <pr> --json statusCheckRollup`", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S17", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "(`gh pr merge <pr> --disable-auto`)", "new": "(`gh pr merge <pr> --disable-auto --admin`)", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S18", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "   never by ending your turn: no mail comes when checks finish. On `1`,", "new": "   then end your turn: no mail comes when checks finish. On `1`,", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S19", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "pullRequest(number: $p) { state autoMergeRequest { enabledAt } mergeQueueEntry { state } }", "new": "pullRequest(number: $p) { state mergeQueueEntry { state } }", "tests": ["test/coordinator-skill.test.ts"]},
 {"id": "S20", "file": "ccd/coordinator-skill/references/wave-lifecycle.md", "old": "A `state` of `MERGED` means it\n   already landed: wait for or prove `merged:#<pr>`, and never disarm — a\n   merged PR answers a null entry too, so the entry alone cannot tell merged\n   from nothing queued. ", "new": "", "tests": ["test/coordinator-skill.test.ts"]}
]
```

```bash
git add ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/wave-lifecycle.md server/test/coordinator-skill.test.ts
git commit -m "$(cat <<'MSG'
skill(coordinator): land at the exact SHA, and land before closing, on a native-queue project

Spec §5.2: a plain enqueue lands on a project whose main requires the merge
queue, and the queue is the composition test. Clause 15 now says so, keeping
#178's exact-SHA binding: gh pr merge <n> --match-head-commit
<handoffCommit>, never --squash (the queue's method applies) or --admin.

And it lands BEFORE it closes: under One PR per child a producer closed
before its PR landed is reclaimed (child-reclamation wave 3), taking with it
the pr-state line the dequeue lane reads and the worker a fix round needs.
So the run waits at merging, holding the child, until the merged:#<pr> mail
wakes the coordinator to prove the merge and close; a dequeued:#<pr>@<time>
mail is answered by re-enqueueing or a fix round on merging -> working.
wave-lifecycle.md §5 carries the paragraph; SKILL.md steps 6 and 7 and §6
point at it — the last wave lands before its close too.

The enqueue waits on the PR's required checks (gh pr checks <pr> --required:
gh 2.45 ARMS auto-merge, rather than queueing, any other PR, and prints the
same line), is read back through mergeQueueEntry, and an armed request is
disarmed (gh pr merge <pr> --disable-auto) before any fix round. Whether
the project requires the queue is measured at each landing. A dequeue's why
is read from the queue's own merge_group run. A coordinator the hook
refuses — a self-claimed run, a reclaim heir — asks the operator to enqueue
rather than closing to shed its hold.

Pinned: clause 15 verbatim; every gh pr merge the corpus spells binds
--match-head-commit <handoffCommit> (derived), the exact disarm spelling
alone excepted; the paragraph names the server's own two subjects, derived
from rundefs.ts's builders, and each landing rule; steps 6 and 7 and §6
point at it. The clause
count is unchanged.
MSG
)"
```

---
### Task 6: Whole-branch verification, the PR — and the deploy (the updater's order)

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified — this task runs, measures, opens the PR and hands over the deploy.

**Interfaces:**
- Consumes: everything Tasks 1–5 produced.
- Produces: the wave-2 PR on this workspace's own branch and a wave-done report. Task 7 (the operator) consumes the merged, rolled-out build.

- [ ] **Step 1: Run all three package suites, in the foreground, one process at a time**

```bash
cd agent  && npm ci && npm run test
cd ../pwa && npm ci && npm run test
cd ../server && npm ci
./node_modules/.bin/vitest run --shard=1/12     # … then 2/12, 3/12, … 12/12, one call each
```

Expected: PASS everywhere. `agent` is untouched and must be green unchanged (its `npm ci` also gives `server`'s typecheck the `ws` it reaches through `agent/src/server.ts`). Report the twelve shard summaries and their sum. If ANY shard is killed by the 600 s ceiling, re-run the WHOLE server suite as `--shard=k/24`, k = 1…24. Re-run any known load flake IN ISOLATION before calling it a break; `tmp-sweep`'s FAILS-CLOSED case is red on `main` on this box and is reported, not chased. (The re-planner did not run the whole suites — the 2026-09-29 brief forbade a whole suite on the loaded box — so there is no forecast total here; every file the wave touches or depends on was run alone, Step 3's list among them.)

- [ ] **Step 2: Cross-tree guards, the corpus premise, and the workflow file**

```bash
git fetch origin main && cd server
./node_modules/.bin/vitest run test/deviation-refs.test.ts
./node_modules/.bin/vitest run test/dtbd.test.ts
./node_modules/.bin/vitest run test/topology-clean.test.ts
./node_modules/.bin/vitest run test/typecheck-tests.test.ts
cd .. && git diff --quiet origin/main -- \
  docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen
python3 -c "
import yaml, sys
class U(yaml.SafeLoader): pass
def m(loader, node, deep=False):
    keys = [loader.construct_object(k, deep=deep) for k, _ in node.value]
    d = [k for k in set(keys) if keys.count(k) > 1]
    if d: sys.exit(f'duplicate key(s) {d} at line {node.start_mark.line + 1}')
    return yaml.SafeLoader.construct_mapping(loader, node, deep)
U.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, m)
yaml.load(open('.github/workflows/ci.yml'), U); print('yaml-ok')"
```

Expected: PASS four times, `corpus-frozen`, `yaml-ok`. If `origin/main` moved `ccd/ccd`, `ccd/session-hook.sh`, `README.md`, `shared/api.ts`, `.github/workflows/ci.yml`, `.github/ci/*.mjs` or the coordinator skill since Task 5, merge it, re-run Tasks 2 and 4's tax steps against the merge's first parent, re-run the citation cases and every Task 1 test file, and resolve any overlap with child-reclamation wave 4 or CI selection by keeping BOTH sides (Global Constraints) — never by dropping either side's shape.

- [ ] **Step 3: The wave's own surface — one file per process**

```bash
cd server
for f in ci-merge-queue ci-pipeline ci-verdict ci-select-cli oss-metadata ci-main-artifact \
         ccd-pr-queue pr-timeout-budget remote-runner ownership ccd-pr-state ccd-prhistory \
         pr-queue-lane pr-sweep prstate single-definition coord-store mail-hardening \
         session-hook-merge-deny session-hook-sync-advisory update-branch-absent \
         coordinator-skill child-reclaim-refusals crossrepo-prose landing-verdict ccd-pr-queue-words; do
  ./node_modules/.bin/vitest run --maxWorkers=1 "test/$f.test.ts" | grep -E '^ +Tests '
done
./node_modules/.bin/vitest run test/run-routes.test.ts -t 'binds the shared cap'
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
cd ../pwa && ./node_modules/.bin/vitest run test/mail-screen.test.tsx
```

Expected (measured 2026-10-03 at the fix round's tip, every task applied, each file alone, one process each): `ci-merge-queue` 5, `ci-pipeline` 39, `ci-verdict` 4523, `ci-select-cli` 41, `oss-metadata` 22, `ci-main-artifact` 16, `ccd-pr-queue` 13, `pr-timeout-budget` 2, `remote-runner` 22, `ownership` 14, `ccd-pr-state` 99, `ccd-prhistory` 18, `pr-queue-lane` 18, `pr-sweep` 37, `prstate` 58, `single-definition` 270, `coord-store` 170, `mail-hardening` 18, `session-hook-merge-deny` 71, `session-hook-sync-advisory` 68, `update-branch-absent` 2, `coordinator-skill` 154, `child-reclaim-refusals` 20, `crossrepo-prose` 17, `landing-verdict` 28, `ccd-pr-queue-words` 3 — every one `N passed (N)`; `1 passed | 229 skipped (230)`; `7 passed | 328 skipped (335)`; `mail-screen` `27 passed (27)`. Against the wave-1 base `ci-verdict` goes 3022 → 4523 (1,500 exhaustive rows and one named case), `ci-select-cli` 39 → 41, `ci-pipeline` 38 → 39 and `coordinator-skill` 151 → 154; the six new test files hold `ci-merge-queue` 5, `ccd-pr-queue` 13, `pr-queue-lane` 18, `session-hook-merge-deny` 71, `landing-verdict` 28 and `ccd-pr-queue-words` 3. The diff's size is stated under Review lenses. If `ownership` reds, `ccd/ccd` was edited after the last re-stamp. Step 2's guards: `dtbd` 1, `topology-clean` 55, `typecheck-tests` 12, `box-token-census` 23, `yaml-ok` (and, measured on the 2026-09-29 prototype, `mail-routes` 59, `unattended-actor` 21, the pwa typecheck clean); `deviation-refs` measured `29 passed` on that prototype with its two history cases red ONLY because the prototype is a one-commit copy (`eee5fa1a is unreachable — this checkout is too shallow…`, identical on the wave-1 base) — on a real checkout it must read `31 passed`.

- [ ] **Step 4: Confirm the author, push, and open the PR**

```bash
git log --format='%an <%ae>' "$(git merge-base origin/main HEAD)"..HEAD | sort -u
```

Expected: exactly one line, the identity this workspace commits as. The pre-push hook refuses identity residue; if it does, fix the author, do not bypass the hook.

```bash
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Landing order wave 2: the native merge queue's repository half" --body-file - <<'EOF'
Wave 2 of the landing-order programme (spec `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` §5.2, repository code). The server arm is a reader-widening, but it deploys in the updater's order — the fleet node first. Changes NO repository setting — the queue ruleset, approvals to 0 and the proof run are the operator's, after this merges (the plan's Task 7).

What it does:

1. **CI** — `ci.yml` answers `merge_group`, and a queue run runs what a pull request runs (operator ruling 2026-09-28): `merge_group` joins the `pull_request` arm of `select.mjs` (`decideMode`, `modeInvariantViolation`) and `verdict.mjs` (`serverVerdict` — `tests: none` on a queue run is red), and the plain-bash pipeline check asks a queue run the same question against `merge_group.base_sha`, so a PR that edits the selector cannot choose its own queue run's tests. Merged into CI selection's shape (#183), overwriting none of it: ONE arm in the existing concurrency group, `queue-<run id>`, ahead of the shared `refresh` group and never cancelled; `test-macos` and `full-suite` skip a queue run (a selected run falls back to full, and `full-suite` would red on the skipped macOS leg); `probe-macos` already did. No job a required check needs mentions `merge_group` but the pipeline step. `ci-merge-queue.test.ts` pins five properties, derived; `ci-pipeline`, `ci-select-cli` and `ci-verdict` move with the shape. No full run per merge (the 2026-09-23 ruling stands).
2. **`ccd pr-state --project`** — ONE GraphQL query per repository per sweep (the 100 newest open PRs' `mergeQueueEntry`, in `gh pr list`'s own order, and the 20 most recently updated merged, each with its last queue act of either kind), own 4 s timeout, `-f` variables, answering `queued | dequeued | landed | none | unmeasured` in an additive `queue` field (+ `queueAt`). A failed or garbled read says `unmeasured` and never touches a row, phase or checks value. The server's `pr-state` bound rises 20 s → 25 s so the three timeouts keep the budget test's 30 % for the local loop; the four comments that stated 20 s (two in `childSpent.ts`, `routes.ts`'s rule-3 gate, `childGateAtClose`'s) say 25 s.
3. **Server — the landing lane** — `queueFor`, the one reader (`absent` for an older ccd, kept apart from `unmeasured`). `sweepLanding` tells the coordinator of the open run that names the workspace (`survivorOf`'s pick): a dequeue as `dequeued:#<n>@<removal time>` plus a `queue` feed event (the ninth `NotifyEvent` kind, additive), and a merge while that run waits at `merging` as `merged:#<n>` — the wake-up a coordinator that enqueued and ended its turn needs. The dequeue mail reads why from the queue's own `merge_group` run (the PR head's checks can read green) and disarms any armed auto-merge before a fix round. Never a guessed coordinator; once each across a server restart (two durable `CoordStore` reads); never latched as told when the run rows were unreadable or the mail threw. Nothing enqueues or merges.
4. **Hook** — PreToolUse denies `gh pr merge` at any parseable command head (reserved words, grouping and wrappers included) in a session whose hold names a programme wave, or whose workspace carries the child marker (a close releases the hold before the reclaim takes the pane); backslash escapes, quoted text and `#` comments are removed first, as bash reads them, so a commit message, PR body or comment that quotes the command passes and, wherever the strip can parse the span, none of them can hide one (the header's WHAT PASSES UNPARSED lists what it cannot parse, listed rather than closed because the deny is contract-grade); what it cannot COMPLETE keeps its raw text, so an unterminated heredoc or an unclosed quoted span that holds a merge at a command head is refused though bash would run none of it (an accepted false deny), and a jq error, a killed jq or a hook timeout fails the deny open; the graph gate's counted deny is never replaced; the coordinator's `gh pr merge <n> --match-head-commit <sha>` passes (a coordinator the deny does refuse — a self-claimed run, a reclaim heir — has the operator enqueue). The hold grammar is spelled once (`CCRC_HOLD_WAVE_RE`).
5. **Coordinator clause 15 and `wave-lifecycle.md` §5** — on a native-queue project (measured at each landing) the coordinator lands with `gh pr merge <n> --match-head-commit <handoffCommit>`, no `--squash`, no `--admin`, only once `gh pr checks <pr> --required` passes — gh 2.45 ARMS auto-merge, rather than queueing, any other PR, with the same success line — then reads the queue entry back and disarms what only armed; and the producer LANDS BEFORE IT CLOSES, the last wave's too (SKILL.md step 7, §6): its run waits at `merging`, holding the child, until `merged:#<pr>`; a `dequeued:` is answered from the queue's own CI run by re-enqueueing or a fix round on `merging → working`, disarmed first. Every `gh pr merge` the corpus spells is pinned to `--match-head-commit <handoffCommit>` (the exact disarm spelling excepted); the paragraph is pinned to the server's own two subjects and to each landing rule.

Citation corpus (S6-R11): every added line sits below the frozen anchors; census unmoved (`ccd/ccd` 147, `deploy/deploy.sh` 4, total 197, row array 52, site array 35, stated == base == tree), README untouched. No `FLEET_PROTO` bump.

Out of scope: wave 2b — the every-session `--admin` deny and the `gh api` merge denies (the pulls merge endpoint and the GraphQL merge mutations), after the operator's ruleset and proof run.

**Deploy: ccrc's updater, from the console — `POST /api/updates/apply` for this merge's tag, the fleet node first and the server after, one node at a time, a failed row halting the rest; nobody moves a box by hand (operator ruling 2026-09-30), and `ccrc rollout --to <this merge's tag>` only when the console is down. The plan's `server-first-rollout` deviation argues why the window between the two moves is harmless. Rollback: `POST /api/updates/rollback` (fleet node first), `ccrc rollback --to <previous tag>` only when the console is down.**

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 5: Report (the wave-done mail)**

Report to the coordinator, per the worker skill: the branch tip sha; the three suites' results (the twelve server shard summaries and their sum); Tasks 2 and 4's instrument outputs (re-pointer lines, census composition); every mutation row's measured red; every departure from this plan, named by what it is (the coordinator assigns numbers — see `## Deviations found`). Then stop: the deploy below runs after the merge, by whoever merges.

- [ ] **Step 6: Deploy — the updater's order, from the console (post-merge)**

This wave's reader-widening class would call for `--server-first`, but nobody moves boxes by hand (operator ruling 2026-09-30) and the updater has its own order: the FLEET node first (the new ccd, hook and skill), the server node after, one node at a time, a `failed` or `reverted` row halting the rest until `ack` (`CLAUDE.md`'s **Deploy = release + rollout** bullet). The `server-first-rollout` deviation argues why the window between the two moves is bounded and harmless, and why Task 7 starts only once BOTH boxes run this wave's tag.

(a) Find the release THIS PR's merge produced — READ-ONLY, one block, because the tag must be computed in the same shell that uses it:

```bash
PR=<this wave's PR number>
git fetch origin main --tags
M=$(gh pr view "$PR" --json mergeCommit -q .mergeCommit.oid)
TAG=$(git tag --points-at "$M" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
echo "merge: $M  tag: ${TAG:-<none yet>}"
if [ -z "$M" ] || [ -z "$TAG" ]; then
  echo "STOP: no release tag on this PR's merge commit yet — wait for release-main.yml and re-run this block"
fi
```

Expected: `merge: <sha>  tag: vX.Y.Z`.

(b) Move the fleet — the operator's one tap in the PWA's console, `POST /api/updates/apply` for that tag: the fleet node first, then the server node, each ending in the same detached `ccrc update --to <tag>` the node would run itself. Wait until `GET /api/updates` (session-gated) shows both nodes' measured stamp on the tag. Only when the console is down, from a machine holding `~/.ccrc/deploy.env`, `ccrc rollout --to "$TAG"` — its default order is fleet box first, and NOT `--server-first`, which would reverse the updater's order for no reason. Then measure, read-only, from either path:

```bash
ccrc rollout --check --to "$TAG"
```

Expected: one `rollout: <server|fleet>: <box> (<sha>) → vX.Y.Z [current]` line per box. The check names `--to "$TAG"` because a bare `ccrc rollout --check` pins its target from `latest/download` — the newest STABLE release — and this wave's build is a dev prerelease, so the bare form would report two converged boxes as behind an older stable. A node's update that completed under a failing doctor exits 3 (the box IS on the new build): read the FAIL lines first.

(c) Prove both nodes carry the build and the fleet box both halves and the skill — READ-ONLY, on the fleet box:

```bash
grep -c '^GH_MERGE_RE=' "$HOME/.cc-sessions/session-hook.sh"
grep -c '^PR_GH_QUEUE_TIMEOUT=4$' "$HOME/.local/bin/ccd"
ccrc doctor 2>&1 | grep -E '^(PASS|WARN|FAIL|SKIP) skills:'
```

Expected: `1`, `1`, and `PASS skills: …` — every rostered home carries the shipped coordinator skill, clause 15's native-queue sentence included. A `0` means the fleet box did not take the build — stop and read that node's row in the console; the server is harmless without it (it reads `absent`), but no worker is denied a merge and no coordinator has been told to land before it closes.

Rolling back, if ever needed: `POST /api/updates/rollback` from the console — the same one tap, the fleet node first, one node at a time, a `failed` row halting the rest — and `ccrc rollback --to <the previous tag>` on a box only when the console is down (the `server-first-rollout` deviation).

---

### Task 7: The operator's post-merge runbook — the queue ruleset, approvals to 0, break-glass, and the proof run (NOT code)

**Who:** the operator, from their own shell or GitHub's UI. **Not a worker and not the coordinator** (coordinator clause 15: never writes rulesets or protection). Every read below is read-only; the two writes are marked.

**Interfaces:**
- Consumes: Task 6's merged and rolled-out build (`merge_group` on `main`'s `ci.yml`, a queue run that runs the selected tests, the queue read, the landing lane, the worker deny, clause 15's landing spelling).
- Produces: the measured go/no-go for wave 2b, written into `docs/superpowers/programs/landing-order.md` by the coordinator.

Every `gh api` path below uses `{owner}/{repo}`, which `gh` fills in from the checkout it runs in — run each block from inside a checkout of this repository.

- [ ] **Step 1: Preconditions — main's health from a run that RAN the required legs, the build on both boxes, and the coordinator census**

Before ANY repository setting changes, both boxes must report this wave's tag: `ccrc rollout --check --to <tag>` shows both `[current]` (the `server-first-rollout` deviation — the updater moves the fleet box first, so the server may still be one move behind for a while after the fleet box converges).

Since CI test selection (#183) a push to `main` runs `refresh` mode: `test (agent)`, `test (pwa)` and `build-pwa` skip every STEP (`CCRC_LEG: skip`) and `test (server)`'s verdict answers `tests: none` → ok on a non-PR event, so the newest push run's four required checks read `success` having tested nothing — the old precondition could not fail. Main's health is read instead from a TRUSTED FULL run: this workflow's daily `schedule` run or a manual `workflow_dispatch` (both `full` mode, both trusted by `main-artifact.mjs`), on a commit that carries this wave's merge, whose `server k/n` shards actually ran — a daily run that skipped because main's head already carried a green `full-suite` ran no shard and is passed over. The macOS legs and `full-suite` are NOT read: they gate nothing by the operator's 2026-09-28 ruling, and `full-suite` needs them.

**Two CODE preconditions, carried here from the deny's review (review 247 F6) and built in a wave of their own, not this one. Both must have LANDED, in a build both boxes run, before the operator arms the queue ruleset or sets approvals to 0 — and this step stops until they have:** (a) a payload cap on the deny's jq input: quote-dense input exhausts the hook's time or memory (bare `"` takes 1584 ms at 36 KB and 6885 ms, 0.56 GB, at 100 KB through the hook), and a hook timeout or a killed jq fails the deny OPEN; (b) a quote-dense timing pin: bare `"` at 36 KB, ~1584 ms, is above `session-hook-sync-advisory`'s 1500 ms whole-hook bound, and neither that file nor `session-hook-merge-deny`'s timing cases pins that shape. Until then the deny is a contract the fleet honours, not what stands between a worker and a merge. It also still passes every class the header above `GH_MERGE_RE` in `ccd/session-hook.sh` lists under WHAT PASSES UNPARSED (quoting inside the `pr` or `merge` word, a leading redirection, a `case` arm or function body, a variable command word or argument, a gh alias, a named wrapper spelled with a path, a ` #` or `(#` inside an unquoted `${…}`, a form feed before `#`, and the strip's own mis-reads): read that list before arming, and close what the operator will not accept first.

```bash
git fetch origin main
git show origin/main:.github/workflows/ci.yml | grep -c '^  merge_group:$'
M=<this wave's merge commit, from Task 6 Step 6>
RID=""
for r in $(gh run list --workflow ci.yml --branch main --limit 40 --json databaseId,event \
             --jq '.[] | select(.event == "schedule" or .event == "workflow_dispatch") | .databaseId'); do
  sha=$(gh run view "$r" --json headSha --jq .headSha)
  git merge-base --is-ancestor "$M" "$sha" 2>/dev/null || continue
  n=$(gh run view "$r" --json jobs --jq '[.jobs[] | select(.name | test("^server [0-9]+/[0-9]+$")) | select(.conclusion != "skipped")] | length')
  [ "$n" -gt 0 ] && { RID=$r; echo "full run $RID on $sha ($n server shards)"; break; }
done
[ -n "$RID" ] || echo "NO FULL RUN YET — start one (a WRITE: it starts CI, it changes no setting): gh workflow run ci.yml --ref main -f mode=full, wait for it, and re-run this block"
[ -z "$RID" ] || gh run view "$RID" --json jobs \
  --jq '.jobs[] | select(.name | test("^(test \\((server|agent|pwa)\\)|build-pwa|server [0-9]+/[0-9]+|typecheck \\(server\\))$")) | [.name, .conclusion] | @tsv'
ssh <fleet box> ccrc version | grep '^version '
ssh <server box> ccrc version | grep '^version '
ccrc rollout --check --to <the tag those two lines name>
ssh <fleet box> 'bash -s' <<'CENSUS'
set -o pipefail
command -v jq >/dev/null || { echo "STOP: no jq"; exit 1; }
body=$(~/.local/bin/ccrc-api runs list) || { echo "STOP: the open runs could not be read"; exit 1; }
cs=$(printf '%s\n' "$body" | jq -er '.runs | map(.claimedBy // empty) | unique | join(" ")') \
  || { echo "STOP: the open runs could not be read"; exit 1; }
ss=" $(printf '%s\n' "$body" | jq -r '.runs | map(.sessionId // empty) | unique | join(" ")') "
n=0
for c in $cs; do
  n=$((n + 1))
  test -e "$HOME/.cc-sessions/$c.child" && echo "MARKED COORDINATOR: $c"
  case "$ss" in *" $c "*) echo "HELD COORDINATOR: $c (an open run names its own workspace)" ;; esac
done
echo "census-done: $n coordinator(s) checked"
CENSUS
```

Expected: `1`; one `full run <id> on <sha> (<n> server shards)` line; then every listed job — `typecheck (server)`, each `server k/n`, `test (server)`, `test (agent)`, `test (pwa)`, `build-pwa` — `success`; both boxes name the same `version`, equal to Task 6's tag or a later one; the check prints `[current]` for both boxes (`--to` because a bare `--check` measures against the newest STABLE release, not the dev build the fleet is on); and `census-done: <n> coordinator(s) checked` alone, `n` the number of distinct coordinators of the open runs (`0` when no programme is open) — no coordinator carries the child marker (a reclaim heir that was the programme's own worker would) and no open run names a coordinator's own workspace (a self-claimed run would), so Task 4's deny refuses no coordinator's enqueue (Pre-flight findings 12 (iii) and 22; the census reads the open runs through `ccrc-api` and the marker files with `test -e`, and writes nothing). The census was exercised on 2026-09-29 against a stub `ccrc-api` in a throwaway HOME: a clean list, a marker, a self-claimed run, a `503 runs-unreadable` body (which `ccrc-api` answers with exit 0), a transport failure (exit 3) and an empty list each answered as described here. **Stop if the first answers `0`** — enabling the queue before `merge_group` is on `main` leaves every entry waiting for checks that never report (spec §5.2 rollout step 1 before step 2). **Stop on any listed job that is not `success`**; on any `STOP:` line — the census could not read the open runs, and a read that did not happen is not a clean census; and on any `MARKED COORDINATOR` or `HELD COORDINATOR` line — that coordinator's enqueue would be denied, so settle how it lands (the operator's shell, Task 5's paragraph) before the queue is turned on.

- [ ] **Step 2: Read the settings as they stand**

```bash
gh api 'repos/{owner}/{repo}/rulesets' --jq '.[] | [.id, .name, .enforcement] | @tsv'
# The LIST endpoint answers summaries — no conditions, rules or bypass actors —
# so each ruleset is read in full to learn which branch it guards.
for id in $(gh api 'repos/{owner}/{repo}/rulesets' --jq '.[].id'); do
  gh api "repos/{owner}/{repo}/rulesets/$id" --jq '[.id, .name, (.conditions.ref_name.include | join(","))] | @tsv'
done
RS=$(for id in $(gh api 'repos/{owner}/{repo}/rulesets' --jq '.[].id'); do
       gh api "repos/{owner}/{repo}/rulesets/$id" --jq 'select(.conditions.ref_name.include == ["refs/heads/main"]) | .id'
     done)
if [ -n "$RS" ] && [ "$(printf '%s\n' "$RS" | wc -l)" -eq 1 ]; then
  echo "main ruleset: $RS"
  gh api "repos/{owner}/{repo}/rulesets/$RS" --jq '{bypass: .bypass_actors, rules: [.rules[] | {type, parameters}]}'
else
  echo "STOP: not exactly one ruleset guards refs/heads/main (got: '${RS}')"
fi
gh api 'repos/{owner}/{repo}/branches/main/protection' \
  --jq '{strict: .required_status_checks.strict, contexts: .required_status_checks.contexts, enforce_admins: .enforce_admins.enabled, approvals: .required_pull_request_reviews.required_approving_review_count}'
gh api 'repos/{owner}/{repo}' --jq '{allow_squash_merge, allow_auto_merge, allow_update_branch, delete_branch_on_merge}'
```

Expected (measured 2026-09-23): two rulesets, one on `refs/heads/main` and one on `refs/heads/stable`; the main ruleset's ONE rule is `pull_request` with `required_approving_review_count: 1`, and its bypass actors are `RepositoryRole` 5 (admin) and `RepositoryRole` 2 (maintain), both `pull_request` mode; classic protection `strict: false`, the four contexts `test (server)`, `test (agent)`, `test (pwa)`, `build-pwa`, `enforce_admins: true`, approvals 0; `allow_squash_merge: true`, `allow_auto_merge: false`, `allow_update_branch: false`, `delete_branch_on_merge: true`. (Step 4 saves the ruleset before touching it.) **Stop on a `STOP:` line, and on any difference you did not make** — somebody else changed the settings, and this runbook was measured against the values above.

- [ ] **Step 3: R9's bypass set — ruled, not decided here**

R9 (spec §3, ruled): the repository-admin role stays the ruleset's ONLY bypass actor. The maintain role's bypass, measured present today, is removed by Step 4's transform (the orchestrator's decision record, 2026-09-24: "the runbook removes it (R9 as ruled)"; confirmed by the operator the same day). Record the removal in the programme ledger with Step 7's results.

- [ ] **Step 4: WRITE — require the queue, approvals to 0 (operator only)**

Either in GitHub's UI (Settings → Rules → Rulesets → the `main` ruleset: under "Require a pull request before merging" set required approvals to 0; enable "Require merge queue" with merge method Squash, build concurrency 1, minimum and maximum group size 1, wait time 0, "only merge non-failing pull requests", status-check timeout 60 minutes; remove the maintain role from the bypass list, per Step 3), or from the operator's own shell, in two blocks — (4a) prepares and shows, and writes nothing to GitHub:

```bash
RS=$(for id in $(gh api 'repos/{owner}/{repo}/rulesets' --jq '.[].id'); do
       gh api "repos/{owner}/{repo}/rulesets/$id" --jq 'select(.conditions.ref_name.include == ["refs/heads/main"]) | .id'
     done)
if [ -n "$RS" ] && [ "$(printf '%s\n' "$RS" | wc -l)" -eq 1 ]; then
  echo "main ruleset: $RS"
  gh api "repos/{owner}/{repo}/rulesets/$RS" > ruleset-before.json
  # The writable projection of the SAME body — the diff's left side and the rollback.
  jq '{name, target, enforcement, conditions, bypass_actors, rules}' ruleset-before.json > ruleset-rollback.json
  jq '{name, target, enforcement, conditions,
       bypass_actors: [.bypass_actors[] | select(.actor_type == "RepositoryRole" and .actor_id == 5)],
       rules: ([.rules[] | select(.type != "merge_queue")
                | if .type == "pull_request" then .parameters.required_approving_review_count = 0 else . end]
               + [{type: "merge_queue", parameters: {merge_method: "SQUASH", max_entries_to_build: 1,
                   min_entries_to_merge: 1, max_entries_to_merge: 1, min_entries_to_merge_wait_minutes: 0,
                   grouping_strategy: "ALLGREEN", check_response_timeout_minutes: 60}}])}' \
    ruleset-before.json > ruleset-after.json
  diff <(jq -S . ruleset-rollback.json) <(jq -S . ruleset-after.json)
else
  echo "STOP: not exactly one ruleset guards refs/heads/main (got: '${RS}') — nothing was saved"
fi
```

Expected: `main ruleset: <id>`, and the diff shows exactly three changes — the maintain bypass actor (`actor_id: 2`) removed, the approval count 1 → 0, the `merge_queue` rule added. Both sides are the same six keys, so no read-only key (`id`, `source`, `node_id`, `_links`, `created_at`, `updated_at`, `current_user_can_bypass`) appears in it. (Measured offline at review: this transform and this diff, run against the main ruleset's body as read on 2026-09-23, print exactly those three hunks.) **Stop on a `STOP:` line or on any other difference.** Then (4b), the WRITE — in the same shell, so `RS` is the one (4a) printed:

```bash
[ "$(jq -r .id ruleset-before.json)" = "$RS" ] \
  && gh api -X PUT "repos/{owner}/{repo}/rulesets/$RS" --input ruleset-after.json --jq '{id, rules: [.rules[].type], bypass: .bypass_actors}'
```

Expected: the ruleset, with `rules: ["pull_request","merge_queue"]` and one bypass actor (`RepositoryRole` 5). No output at all means the saved `ruleset-before.json` is not the ruleset `RS` names (or `RS` is empty), so nothing was written — re-run (4a). The `merge_queue` parameter names are GitHub's REST ruleset schema; they were NOT exercised while planning (no write was made). If the PUT refuses a parameter, use the UI and re-read with Step 2's per-ruleset read. Keep `ruleset-rollback.json`: `gh api -X PUT "repos/{owner}/{repo}/rulesets/$RS" --input ruleset-rollback.json` is the rollback, and restores the ruleset exactly as it was, maintain bypass included.

- [ ] **Step 5: THE PROOF RUN — spec §5.2 rollout step 3, stage 2's own gate**

Make FIVE TRIVIAL PRs from fleet workspaces (so `is_ours` has a workspace to bind — e.g. five `ws-add` workspaces, each committing a one-line change to a different line of a doc file nothing pins) and wait for the first four PRs' own CI to go green; the fifth is (a1)'s, pushed to while its checks run. The landing spelling is clause 15's: `gh pr merge <n> --match-head-commit <sha>`, no `--squash`, no `--admin`; outside a programme the sha is the head the operator read.

(a0) **The exact-SHA binding holds on a queue enqueue** (Pre-flight finding 16) — FIRST, on the fourth PR, a deliberately WRONG sha, then the queue read:

```bash
gh pr merge <pr-d> --match-head-commit 0000000000000000000000000000000000000000; echo "rc=$?"
gh api graphql -F o='{owner}' -F n='{repo}' -F p=<pr-d> -f query='
  query($o: String!, $n: String!, $p: Int!) { repository(owner: $o, name: $n) { pullRequest(number: $p) { headRefOid mergeQueueEntry { state } } } }' \
  --jq '.data.repository.pullRequest'
```

Expected: a non-zero `rc` whose message names the head (the expected sha does not match), and `mergeQueueEntry: null` — the PR was NOT queued. A refusal naming auto-merge, an approval or anything but the head is NOT this pass: it is stop rule 4, and (a0) is re-run once the enqueue path works. A wrong sha that was accepted is stop rule 7 (remove the entry in GitHub's UI first).

(a1) **An enqueue whose required checks have not passed ARMS auto-merge; it does not queue** (Pre-flight finding 20; gh 2.45's own help: "If required checks have not yet passed, auto-merge will be enabled") — on the FIFTH PR, push one more commit and, while its checks are still running, from the operator's shell:

```bash
gh pr merge <pr-e> --match-head-commit "$(gh pr view <pr-e> --json headRefOid -q .headRefOid)"; echo "rc=$?"
gh api graphql -F o='{owner}' -F n='{repo}' -F p=<pr-e> -f query='
  query($o: String!, $n: String!, $p: Int!) { repository(owner: $o, name: $n) { pullRequest(number: $p) { headRefOid mergeQueueEntry { state } autoMergeRequest { enabledAt } } } }' \
  --jq '.data.repository.pullRequest'
```

Expected: gh's `will be added to the merge queue … when ready` line, `mergeQueueEntry: null` and a non-null `autoMergeRequest` — armed, not queued; `ccd pr-state --project` reads the PR `none` and the landing lane says nothing, which is why Task 5's paragraph reads the entry back. A refusal naming auto-merge instead is stop rule 4's reading (the operator's 2026-09-29 ruling: the proof halts and the operator decides). Push one more commit before those checks finish and run the read again: a non-null `autoMergeRequest` means an armed request survives this login's push and would queue a head no review read — the paragraph's disarm rule is load-bearing; record the reading with Step 7. Then `gh pr merge <pr-e> --disable-auto`, read once more (`autoMergeRequest: null`), and close the PR.

Then enqueue the other three within a minute, from a session with no wave hold and no child marker, or from the operator's shell:

```bash
for n in <pr-a> <pr-b> <pr-c>; do
  gh pr merge "$n" --match-head-commit "$(gh pr view "$n" --json headRefOid -q .headRefOid)"
done
```

Expected: each answers that the PR was added to the merge queue. Right after each enqueue, run (a0)'s read for that PR: expected a non-null `mergeQueueEntry` at once — the read-back Task 5's paragraph relies on before it would disarm. A null that reads non-null a minute later is recorded with Step 7: the paragraph's read-back must then wait before it disarms, a fix before wave 2b. Then measure, read-only:

(a) **Queued, then landed, one at a time** — on the fleet box, the same call the server's sweep makes every 120 s:

```bash
ccd pr-state --project <this project> | python3 -c 'import json,sys
for l in sys.stdin:
    if l.strip():
        v = json.loads(l); print(v.get("id"), v.get("number"), v.get("phase"), v.get("queue"), v.get("queueAt"))'
```

Expected: while waiting, the three workspaces read `open … queued <time>`; after each lands, `merged … landed`. **If a queue-merged PR reads `merged … none` instead of `landed`**, GitHub records a removal on a SUCCESSFUL merge, so the last queue act of a landed PR is a removal: record it with (a2)'s read and report it — `landed` is then unreachable, and wave 2b's plan must account for it (stop rule 6).

(a2) **Does a successful queue merge leave a trailing removal?** — the orchestrator's accepted decision: the proof run measures it. For each of the three landed PRs, read-only:

```bash
gh api graphql -F o='{owner}' -F n='{repo}' -F p=<pr> -f query='
  query($o: String!, $n: String!, $p: Int!) { repository(owner: $o, name: $n) { pullRequest(number: $p) {
    state timelineItems(first: 20, itemTypes: [ADDED_TO_MERGE_QUEUE_EVENT, REMOVED_FROM_MERGE_QUEUE_EVENT]) {
      nodes { __typename ... on AddedToMergeQueueEvent { createdAt } ... on RemovedFromMergeQueueEvent { createdAt } } } } } }' \
  --jq '.data.repository.pullRequest | [.state, (.timelineItems.nodes | map(.__typename + "@" + .createdAt) | join(" "))] | @tsv'
~/.local/bin/ccrc-api feed list --limit 20
```

Expected: `MERGED`, and the LAST node an `AddedToMergeQueueEvent`; and NO `queue` event in the feed names any of the three workspaces. A trailing `RemovedFromMergeQueueEvent`, or a `queue` event for a PR that landed (a sweep read the removal in the moment before the state flipped to MERGED), is stop rule 6.

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

Expected: the three newest first-parent commits on `main` are the three squashed PRs, one each; each carries its own `vX.Y.Z` tag; there is one `release-main` run per sha and three new prereleases; and a `ci` push run was CREATED per sha — but since #183 every push to `main` shares the `refresh` concurrency group, where GitHub keeps one pending run and cancels the older pending one, so in a burst an intermediate push run may read `cancelled` (CI selection §4.3 calls that harmless: the next refresh re-traces from the map it finds). A cancelled intermediate `ci` push run is expected behaviour, not stop rule 1; a sha with no `ci` push run at all, or a missing tag or prerelease, is.

(c) **The queue's own CI run: a pull request's run, macOS and `full-suite` skipped:**

```bash
gh run list --workflow ci.yml --event merge_group --limit 3 --json databaseId,conclusion,headBranch
gh run view <one merge_group run id> --json jobs --jq '.jobs[] | [.name, .conclusion] | @tsv'
```

Expected: three `merge_group` runs, `success`, none of them cancelled (each ran in its own `queue-<run id>` group); in each, `select tests`, `typecheck (server)`, every `server k/n` shard, `test (server)`, `test (agent)`, `test (pwa)` and `build-pwa` `success`; `test-macos` (reported under its unexpanded matrix name), `probe-macos`, `full-suite`, `trace …`, `map-build` and `times-build` `skipped`. On each run's summary page the **CI test selection** table reads event `merge_group` and tests `selected` — or `full` with a fallback reason (a missing map, a `.github/` change); while `CCRC_SELECTION` reads `shadow` a `selected` run still runs every server test, exactly as a pull request's does.

(d) **`is_ours` still binds after a queue merge** — for each workspace, on the fleet box:

```bash
ccd pr-state --session <workspace id> | python3 -c 'import json,sys; v=json.loads(sys.stdin.readline()); print(v["phase"], v["number"], v.get("reason"))'
```

Expected: `merged <its PR number> None` for all three — never `unknown merge-unproven`, never `none`.

(e) **The dequeue lane** — enqueue a fourth trivial PR and remove it from the queue in GitHub's UI ("Remove from queue") before it lands; within one sweep (≤ 120 s):

```bash
~/.local/bin/ccrc-api feed list --limit 10
```

Expected: one `queue` event titled `⤺ dequeued › <workspace>`, its body naming `(removed <time>)` and `No open run names a coordinator to tell.` — a proof PR's workspace belongs to no run, so the lane records and mails nobody; and still NO `queue` event names any of the three PRs that landed in (a)–(b) — one that does is a spurious dequeue (stop rule 6). Close the fourth PR afterwards. The lane's two MAILS need an open run at `merging`, which the proof does not stage: the first programme landing after this runbook measures them (Step 7).

(f) **A worker cannot merge** — in a session whose workspace hold names a programme wave (a live worker's, or a scratch workspace held with `POST /api/sessions/:id/hold` and a `program:<slug> wave:1/1` reason, released afterwards), ask the session to run `gh pr merge <any closed PR number>`. Expected: the tool call is refused with `ccrc: this workspace's hold reads …`. A dispatched child in the window after its close (no hold, marker present) is refused by the marker arm — `ccrc: this workspace carries the child marker …`; that window is minutes long and rarely caught live, so Task 4's cases are its proof, and a live catch is a bonus for the ledger.

- [ ] **Step 6: Stop rules**

Stop, report to the coordinator, and do NOT plan or dispatch wave 2b if any of these holds:

1. **A single push to `main` carried more than one commit** (b), or a merge sha has no tag: the group settings did not take. Keep group size and build concurrency at 1 and re-run the proof; if they ARE 1, `release-main.sh` must tag every commit in the pushed range before the queue is used (spec §5.2 step 3) — a new wave.
2. **`is_ours` failed to bind** after a queue merge (d): a finding against `pr-state`; the queue stays on only if the operator rules so.
3. **A `merge_group` run failed for a reason that is not the PR's own** (c) — e.g. a guard that needs a base the queue checkout does not have. Roll back: re-apply `ruleset-rollback.json` (queue off, approvals 1, maintain bypass back). Landing returns to `--admin` exactly as before this runbook, because the every-session `--admin` deny (wave 2b) is not live.
4. **`gh pr merge <n> --match-head-commit <sha>` (no `--admin`) was refused** as needing an approval — Step 4 did not take; re-read with Step 2 — or because the repository has auto-merge disabled (gh reaches a required queue through the auto-merge mutation, finding 16): that is a setting this runbook does not change and clause 15 forbids a coordinator to write; the proof halts here and the operator decides then (operator ruling 2026-09-29). (a0) and (a1) answer the same way until the operator has.
5. **An entry sat queued past the status-check timeout**: the required contexts are not reporting on `merge_group`; roll back as in 3.
6. **A successful queue merge leaves a trailing removal** ((a) reads `merged … none`, or (a2)'s last node is a `RemovedFromMergeQueueEvent`), **or a `queue` event names a PR that landed** ((a2), (e)). `landed` is then unreachable, and the dequeue lane can announce a removal for a PR that merged: the lane must not announce until it has seen the removal on two consecutive sweeps with the PR still OPEN — a fix wave before 2b, with the (a2) readings as its evidence. The queue may stay on (nothing is merged wrongly; the cost is a false notice), if the operator rules so.
7. **(a0)'s wrong-sha enqueue was ACCEPTED** (the PR entered the queue): gh's queue path does not carry `--match-head-commit`, so clause 15's spelling binds nothing on this gh and the exact-SHA merge proof rests on the coordinator's own reads alone. A fix wave before 2b decides the remedy (the programme ledger records the reading); the queue may stay on only if the operator rules so.

- [ ] **Step 7: Record the result**

The coordinator writes the proof run's measured answers — Step 1's full run and census, (a0), (a1), (a), (a2) and (b) through (f), with the run ids, shas, tags and times, and Step 3's bypass removal — into `docs/superpowers/programs/landing-order.md` under "Decisions & deviations", on its own ledger PR (coordinator clause 15), and the wave-2 row's state. The first programme landing after this runbook adds the two readings the proof cannot stage: that `merged:#<pr>` woke the coordinator of a run waiting at `merging` (and how long after the merge), and — if one happens — that a real dequeue mailed it `dequeued:#<pr>@<time>`. Wave 2b is planned only on a clean proof; it is the deny on `--admin` in every fleet session, on a `gh api` call to the pulls merge endpoint, and on a `gh api graphql` merge mutation (`mergePullRequest`, `enqueuePullRequest`, `enablePullRequestAutoMerge`) — measured passing this wave's deny under a wave hold.

---

## Deviations found

Numbers are ISSUED, never chosen. This programme's deviation block is allocated by the programme coordinator, per wave, at that wave's run-open; **a worker never calls the allocator** (worker clause 11). A departure from this plan found while executing it is named in the wave-done mail — what departed, where, and why — and the coordinator assigns its number from the block and defines it here in the same act. A session that cannot reach the coordinator writes `D-TBD-<slug>` in its report and nowhere in a committed file (`dtbd.test.ts` reds the concrete form).

Two deliberate absences: no block is written as a range, and no headroom accounting lives in this plan.

The pre-flight findings above are not deviations: they were measured before this plan existed and shaped it. The places where this plan departs from the spec's literal text AS IT STOOD AT `6da36f0b` are argued there and at the code, and are the reviewer's to weigh against the spec; the spec's 2026-09-29 amendments (its Status line) now state each of them, so each slug's parenthesis quotes the text an amendment replaced. The coordinator numbers them at run-open, by these slugs:

- **D-3857 — `queue-act-either-kind`.** The last queue act of EITHER kind rather than the last removal alone (finding 3).
- **D-3858 — `pr-state-bound-25s`.** The outer bound raised to 25 s for both modes (finding 1, as ruled), and with it the close's two reads at ~50 s (finding 14).
- **D-3859 — `queue-feed-kind`.** The ninth `NotifyEvent` kind (finding 5; the plan said eighth, and #219's `update` kind took that place before this wave landed, so `queue` follows it), and the `operator` role as the landing notices' sender.
- **D-3860 — `land-before-close`.** On a native-queue project the producer lands BEFORE it closes, waiting at `merging` (finding 12 (i); spec §5.2 assumed the run stayed open, §9 names the assumption; Task 5 makes it the coordinator's rule).
- **D-3861 — `landing-merged-notice`.** The landing lane's second notice, `merged:#<n>`, the coordinator's wake-up after an asynchronous queue merge (finding 12 (i′); §5.2 names only the dequeue).
- **D-3862 — `deny-child-marker`.** The deny's second arm, on `$REG/<id>.child` (finding 12 (iii); §5.2 and §6's session-hook row name only the wave hold).
- **D-3863 — `queue-pipeline-check`.** The plain-bash pipeline check asks a queue run the pull request's question, against `merge_group.base_sha` (finding 13; the ruling says a queue run runs what a PR runs, and this is the part of a PR's run that keeps the selector honest).
- **D-3864 — `server-first-rollout`.** The plan's SERVER-FIRST order (a reader-widening, `CLAUDE.md`) departs from spec §9's "Rollout inside each stage follows AGENT-FIRST", AND the shipped updater moves the fleet box first anyway: `compareDispatchOrder` ranks `fleet` 0 and `server`/`both` 1 (`shared/api.ts`), and the dispatcher holds a server-role node behind the fleet row's standing or auto move (`server/src/update/dispatch.ts`); the operator ruled 2026-09-30 that nobody moves boxes by hand, so a hand `ccrc rollout --server-first` is not available. The REAL order is the fleet box (new ccd, hook and skill), then the server. The window between the two moves is bounded and harmless: (i) the new ccd's three gh calls (8 + 5 + 4 s) run under the OLD server's 20 s `pr-state` bound, so a slow sweep can be killed — the sweep fails and is retried on the next tick, and it writes nothing NEW. It is not a sweep that writes nothing: `cmd_pr_state` persists `prnumber`, `prphase` and `prcheckedat` for each workspace (`_pr_state_one`'s `_pr_py state` call, a compare-and-set) inside its per-workspace loop, BEFORE `_pr_queue_stamp` makes the queue call, and those are the same measurements the old ccd writes — so a sweep killed at the old 20 s may already have written them, with the values an old ccd writes. The queue call itself only annotates the lines on stdout and touches no registry field; (ii) the hook's deny is live at once, which is only safer; (iii) the skill's land-before-close / `merged:` rule is live while the old server sends no `merged:` mail — harmless because no repository requires the merge queue until the operator's Task 7, and the rule applies only to a project measured to require the queue. Hence Task 7 must start only once BOTH boxes run this wave's tag.
- **D-3865 — `enqueue-only-green`.** The coordinator enqueues only a PR whose required checks passed, reads its queue entry back and disarms an auto-merge that only armed (finding 20; §5.2's clause-15 bullet says a plain `gh pr merge <n>` enqueues, which gh 2.45 does only for such a PR).
- **D-3871 — `held-coordinator-operator-enqueues`.** A coordinator whose own workspace carries a wave hold or the child marker (a self-claimed run, a reclaim heir) is denied like a worker and has the operator enqueue (finding 22; §5.2's mutation row says a coordinator's enqueue passes).
- **D-3872 — `readme-repointer-skipped`.** Task 2's Step 8 README re-pointer (`repoint-readme.py`) is NOT run: since #217 `README.md` carries no `ccd/ccd:N` anchor, so the tool's two-anchor assertion would fire on a README that needs nothing. The citation census on the moved base reads `ccd/ccd` 147, `deploy/deploy.sh` 4, total 197, row array 52 and site array 35 (the plan's 148 / 196 / 53 / 36 are `6da36f0b`'s), stated == base == tree with every `ENTERED`/`LEFT` empty: the block sits below every frozen anchor, so the task moves nothing. Also on the moved base: `ccd/ccd`'s outer-bound paragraph heading reads `AND THIS PAIR HAS TO FIT INSIDE IT` (the plan's grep prefix `THE OUTER BOUND IS 20 s, NOT 90` still locates it once), and `macos-platform.test.ts` counts `96 passed | 11 skipped (107)`.
- **D-3873 — `task-3-adaptations`.** Task 3 applied on the moved base with six adaptations, none a design change: `queue` is the NINTH notify kind, inserted after `update` in the `NotifyEvent.kind` union, in `NOTIFY_KINDS` and in `MailScreen`'s two maps (the plan says eighth), so mutation K1's text reads `'update', 'queue', 'unknown'];` → `'update', 'unknown'];`; the `NotifyEvent.kind` docstring's last line, which glosses `update`, now also names `queue`, so the wave edits a THIRD line of `shared/api.ts` in place (two code, one docstring; the plan said two), line-neutral and moving no citation (review 241 F7, ruled in fix round 1); `CoordStore.hasMailWithSubject` already exists (shipped by #224, byte-identical to this plan's insert), so Task 3 adds ONE store read, `hasFeedEvent`, and not two; `rundefs.ts`'s `operator` gloss already named the stall watch, so the landing notices are added beside it; `queueSystemMail`'s caller census now lives in `insertSystemMailTx`'s comment and reads seven callers in five files with `sweepLanding` named; and `watch.ts`'s `rundefs` import already carried `queueStallNotice`, which stays beside the three names Task 3 adds. Moved counts, every case passing: `mail-screen` 27, `single-definition` 270, `coord-store` 170, `mail-sweep` 102.
- **D-3874 — `deny-fails-open-without-oniguruma`.** Task 4's header says what the strip's lookaround `gsub` implies and the plan did not: a `jq` built without Oniguruma errors on it, `mcmd` stays empty and the deny FAILS OPEN (one added line in the block's "WHAT PASSES UNPARSED" paragraph; #224 keeps the hookstate parse regex-free for the same reason). The header's WHAT PASSES UNPARSED now also lists the classes review 241 F8 measured passing, listed rather than closed because the deny is contract-grade (spec §4): quoting inside the `pr` or `merge` word (`gh pr "merge"`, `gh 'pr' merge`, `gh pr m'erg'e`, `gh pr \merge`), a leading redirection (`2>&1`, `>/dev/null`, `</dev/null` before `gh`), a `case` arm, a function body, `coproc`, a variable command word or argument (`$GH pr merge`, `gh pr $m`) and a gh alias (review 241 F8).
- **D-3875 — `merge-deny-regex-linear`.** `GH_MERGE_RE` is not the plan's text. The plan's regex was quadratic: it restarts at every separator, and a token class that could cross one (`[^[:space:]]*` in an assignment value, a `timeout` argument or a flag) or a blank class that included the newline walked to the end of the payload for each start, 5 to 9 s on a 36 KB `;a=;a=…` or newline x `a=` command (found by the red env-var cases of `session-hook-sync-advisory.test.ts`, 5 of 68 against a 1500 ms bound; the coordinator's 132 ms re-measure did not try that shape). Every token class now excludes `;&|()` and the blanks inside a head are space and tab only, which is also closer to bash. Narrowing the class alone would have let `GH_TOKEN=$(<tok) gh pr merge` and `gh --repo=$(cat r) pr merge` through (the plan denied both), so a value, a `timeout` argument and a flag value may each hold ONE `$(…)` (blanks allowed, no `;` `&` `|`, nesting to `$((…))`), the body stopping at the first `)`. On the separator-restart inputs the plan's regex was quadratic on (`;a=`, `\na=`, `;gh -R `, `\ntimeout 1 `, `a=$(`) the shipped regex is linear: 5 to 11 ms at 36 KB and 13 to 23 ms at 100 KB on the regex alone, 97 to 109 ms and 155 to 214 ms through the whole hook (re-measured 2026-10-03, after review 241's fix round, load 18 to 23). Separator-free chains still grow superlinearly, as the plan's regex already did: closed `$(…)` chains (`X=$(a b) `) 49 and 374 ms on the regex alone at 36 and 100 KB (142 and 559 ms through the hook), and the space/tab family 49 and 392 ms (186 and 902 ms); at 200 KB, QUOTED from review 241's table rather than re-run, the hook took 1532 ms on an `a=$(b)` chain and 2895 ms on a ` a=` chain. The header names what stays unparsed: a backslash-newline continuation and a `$(…)` that holds a newline, or a `;` `&` `|` or `(`, inside a `VAR=` or flag value. The mutation rows H5, H6, H13 and H14 carry the shipped text; H20, H21, H24 pin the timing halves and H22, H23, H25 the `$(…)` acceptance (the table below); `session-hook-merge-deny.test.ts` gains two cases (12, not 10); with the `deny-strip-keeps-substitution-spans` cases it holds 62 at fix round 1's tip. Review 247 F3 (fix round 2): the merge word followed directly by `;` `&` `|` `(` `)` `<` `>` (`gh pr merge;echo ok`, `x=$(gh pr merge)`, `(gh pr merge)`) was never matched, because the regex ended `merge([[:space:]]|$)` and in a bash ERE `$` is the end of the string; it now ends `merge([[:space:];&|()<>]|$)`, pinned by four deny cases and the row H62.
- **D-3876 — `deny-strip-keeps-substitution-spans`.** THE SHIPPED RULE (the strip at fix round 2's tip). The deny's quote strip is not the shipped Task 4 text: that one gsub could not match a "…" span holding `$(`, so it kept the span's opening quote and resumed INSIDE it, and the span's closing quote then opened a new span that swallowed the merge after it. The strip is a jq program (`MERGE_STRIP_JQ`), run in the same jq that reads the command, that, where it can parse, reads leftmost first as bash does: a backslash escape (with the rest of its word, so `\ #` opens no comment), `$$` (a word, at any run length), a `$'…'` string (its `\'` honoured), a '…' span, a "…" span, a heredoc, a `#` comment that starts a word. A "…" span is matched WHOLE with an Oniguruma grammar — `\"` escapes, backtick spans, `${…}` expansions with their own "…" and '…' (as bash reads them there), and `$(…)` substitutions that carry their own quotes, parentheses, `${…}`, comments and heredocs — and is replaced by its substitutions alone, each stripped again, so a quoted mention holding a separator (`"docs; gh pr merge 42 is how"`) reads as nothing and `X="$(date)"` reads `X=$(date)`. A heredoc keeps its `<<` line and loses its body to its terminator line: the whole line at the top level (`<<-` tab-indented), and inside a quoted `$(…)` a line that may go on with `)`; its delimiter is a bare word of any word characters, a backslash and a word, or one quoted word (blanks allowed when quoted), and an unquoted delimiter's body keeps its substitutions. Arithmetic (`$((…))`, `((…))`, `$[…]`, to two nested parentheses on one line) is kept as written, never dropped, so a `$(…)` inside it is still denied (`(( $(gh pr merge 42) ))`, pinned) and a shift opens no heredoc. FAIL CLOSED: what the strip cannot COMPLETE keeps its RAW text, so a merge after it is still matched. An unclosed "…", `$'…'` or quoted `$(…)` keeps its own text, and any heredoc opener the strip sees but cannot complete (no exact terminator line, another `<<` on its line, a quote or backtick left on its `<<` line, a body line that begins `WORD)`) keeps everything from the opener to the end raw, at ONE choke point in `fs` (a replacement that answers null cuts the strip there); a nested `${…}` or `$(…)` the grammar cannot finish fails its span at once rather than being read as text and retried. No top-level `$(…)` is parsed. THE COST is a deny bash would not need: an unterminated heredoc, or an unclosed span, that holds a merge at a command head is refused though bash would run none of it, and three spellings that passed before the rule now deny (`x=$(cat <<'EOF'…EOF)` whose body has a line that begins `gh pr merge`, a heredoc whose terminator line carries a trailing blank, and a heredoc with a body line that begins `EOF)`); the standard commit and PR-body form, `EOF` and `)` on separate lines, still passes, and so does a terminated heredoc commit message quoting `gh pr merge`. What the strip does not parse, and the mis-reads it can make, are LISTED in the header's WHAT PASSES UNPARSED (not re-listed here: the deny is contract-grade, spec §4, so they are listed, not closed). The jq is Oniguruma throughout, so the `deny-fails-open-without-oniguruma` entry holds: a jq without it, any jq error, a killed jq or a hook timeout fails the deny OPEN. COST IN TIME, measured 2026-10-03 one payload per process under a 4 GB cap: the jq replaces gsub with one `match` over an exploded string (jq 1.7's gsub re-slices from the start at every match) and returns plain text untouched; a command DENSE with quotes is superlinear through jq 1.7's per-match cost, bare `"` taking 1584 ms at 36 KB and 6885 ms (0.56 GB) at 100 KB through the hook, while 100 KB of real prose in a heredoc commit or a `gh pr create --body "$(cat <<'EOF'…)"` costs ~120 to 140 ms and every shape without quotes is unchanged (`session-hook-sync-advisory`'s 68 cases stay inside 1500 ms). Quote-dense input around 0.5 MB can exhaust the hook's time or memory, and bare `"` at 36 KB is above that file's 1500 ms whole-hook bound with no test pinning the shape, so the payload cap on the deny's jq input and a quote-dense timing pin are CARRIED, as preconditions of Task 7 (review 247 F6): both land before the operator arms the queue ruleset or sets approvals to 0. Fix round 2's F1 fix (review 247 F1, a regression of the strip round): in `sb`, the "…" span's `$(…)` body, `\g<pe>` sits immediately before the bare `\$` alternative, as `dq` orders it, where it had followed it inside an atomic group and so could never match; a `${…}` inside a quoted `$(…)` is read with its own `(` and `)`, and a `)` in it no longer closes the substitution early. That reach exposed a second regression, measured by the re-review (I1): `pe` read `$$` as the start of a `${…}` and `$'…'` as an open '…' span, where `sb` and bash read a word and one ANSI-C string, so `echo "$(echo ${v:-$${})"; gh pr merge 42; echo "})"` passed while bash ran the merge; `pe` now carries `\$\$` and `AQ` after `\g<dq>`, as `sb` does, three deny cases pin the shapes (`$${` with `;` and with newlines, and `$'\''`), and the row H63 deletes the two arms. Pinned by the deny case `echo "$(echo ${x:-)} "it's" )"; gh pr merge 42; echo 'z'` (in the strip-edge list), by the two `${y/(/z}` cases rewritten (their `${…}` had sat at the top level after a whole-line `EOF` and could never fail on this property; it now sits inside a quoted `"$(…)"`), and by the row H61, which deletes `\g<pe>|` from `sb`. `session-hook-merge-deny.test.ts` holds 71 cases: twelve named ones (the two timing cases among them, the bounded-time case holding a wave hold and ending in `echo merge origin`, and the second one pinning the heredoc and `<<` recursion guards at 16 KB), the five F1 shapes and the control (`it.each`, so a mutation names every shape it lets through), twenty-five strip edges, twenty-three fail-closed shapes (one per shape the strip cannot complete), four merge-word-then-operator shapes (`3875`'s) and the pass list. The mutation rows H26–H61 and H63 are this entry's (33 live; H32, H40, H41 and H45 retired, each row says why); H11, H12, H18 and H19 quote the strip, and H10 is pinned on `echo \`date\` gh pr merge 42`, because the heredoc commit message it once named is stripped whole. SHORT HISTORY. Review 241 F1 measured five ordinary shapes passing the Task 4 gsub, among them clause 15's own `sha="$(git rev-parse HEAD)"` then `gh pr merge 42 --match-head-commit "$sha"`, and a heredoc body whose apostrophe opened a '…' span; the strip round replaced the gsub with this jq, and its security review's I1, I2 and M1 closed three more (a `${…}` in a "…" span, a top-level heredoc's terminator, `$$`). Its re-review then found three regressions of the round's own, N1 an odd run of `$` before `'`, N2 an `EOF)` heredoc in a top-level `$(…)` that a 200-character gate did not take and N3 a gated `$(…)` dropped to the end on a mis-parse, each denied at the round's base and passing after it; the fail-closed round answered them with the one rule above instead of one more spelling each (the gate went, seven guards became precision rules pinned by pass cases, four rows retired), and a text round stated the false-deny cost and the unparsed classes in the header. Review 247 F1 found a last regression of the strip round, the `sb` ordering above, which fix round 2 closed (with its re-review's I1, above); review 247 F3 is `3875`'s. Two draft mistakes were measured and closed on the way: a heredoc that re-scanned the payload for its terminator once per `<<` (6 s at 36 KB of `<<-a`), and a rest-of-line stripped WITH heredocs that recursed once per `<<` (15 s and 2.9 GB at 36 KB of `<<a `).
- **D-3882 — `queue-words-pinned-across-languages`.** ccd's five merge-queue words are pinned to the server's map (review 241 F5, ruled in fix round 1). Nothing tied the words `_pr_queue_py` emits to `PR_QUEUE_MAP`: `queueFor` reads an unknown word as `unmeasured`, which the landing lane treats as no evidence, so a word renamed in ccd together with ccd's own test reds nothing on the server side and silences the dequeue notice (review 241's X1, ccd's `return 'dequeued', at` renamed `'removed'` and re-stamped: `ccd-pr-queue` 2 failed, `pr-queue-lane` still 18 passed). `server/src/prstate.ts` now EXPORTS `PR_QUEUE_WORDS`, still derived (`Object.keys(PR_QUEUE_MAP)`, never a second hand copy), and the new `server/test/ccd-pr-queue-words.test.ts` reads the `return '<word>'` literals of the embedded program's `word()` out of ccd's TEXT (it never runs ccd) and compares them as a set with it. Each extraction step throws when it finds nothing, and a case reshapes ccd's text three ways to pin that. The same file pins that the program writes the line's `queue` field from `word()` alone. Measured: red-first 1 failed | 2 passed (the export absent), green 3 passed; X1 (restamped copy, restored byte for byte from a saved copy) 1 failed on `"dequeued"` against `"removed"`; a server-side rename of the map's `landed` key 1 failed on `"merged"` against `"landed"`. Both are mutation rows now (review 247 F11): W1 and W2, in Task 3's table.
- **D-3883 — `landing-verdict-is-l1`.** The landing lane's decisions are not in `watch.ts` (review 241 F9, ruled in fix round 1). Task 3's `sweepLanding` decided everything in L4 — which notice a line asks for, whom to tell, whether a merge is told at all, which durable read proves "already told", the latch and the bodies — where the stall watch's precedent puts the verdict in pure L1. They now live in `server/src/coord/landing.ts` (types-only imports, no store, no clock), as `landingAsk` (what the line asks for, its latch key, whether it is latched) and `landingVerdict` (the NEXT step given the facts read so far: a read it still owes — `runs`, `coordinator`, `runState`, `toldMail`, `toldFeed` — or `defer`, `latch`, `deliver`), called in a loop that performs exactly the reads the lane always made, in the same order, and nothing more. `watch.ts` keeps the reads (`openRunsForSession` then `survivorOf`, `resolveCoordinator`, `run`, `hasMailWithSubject`, `hasFeedEvent`) and the deliveries (`queueSystemMail`, the `queue` feed record, the latch write). `survivorOf` stays the caller's: it is `rundefs.ts`'s, shared with the close and dispatch, and `rundefs.ts` holds the database handle an L1 file may not reach — what is decided in L1 is its meaning (null is nobody to tell; an unreadable read is a deferral, never null). `dequeuedSubject`, `mergedSubject`, `renderDequeueBrief` and `renderMergedBrief` moved into `landing.ts` (`rundefs.ts` re-exports the two subjects, so every importer is unchanged; the two briefs are imported from `coord/landing.js` by `pr-queue-lane.test.ts` instead of `watch.js`). No behaviour changes: `pr-queue-lane` stays 18 cases, and Task 3's mutation rows L3–L6, L9–L23 are re-anchored in the table and JSON below to the file and text they now live in (L10 and L13 a second time, in the round's last text commit, after the labelled `switch` indented their lines two more spaces; S6 follows `mergedSubject` to `landing.ts`, and S12 and S13 follow the read-back paragraph's rewrite, each measured red there); `landing-verdict.test.ts` pins each decision directly, and pins the module's own purity on `stall-vocabulary.test.ts`'s precedent (no clock, no node builtin, no store, no value import but L0's `shared/api.ts`), which the coord-ring scan alone does not see (the row L24, in Task 3's table, adds a value import and reds it); `sweepLanding`'s step dispatch is an exhaustive `switch` with a `never` check, so a new step kind is a compile error. The deviation is from Task 3's text, whose Step 6 code block still shows the pre-extraction `sweepLanding`; the shipped source is the authority.
- **D-3884 — `read-back-answers-merged`.** `wave-lifecycle.md` §5's native-queue read-back is not Task 5's one-field query (review 241 F10(a), ruled in fix round 1). That query asked only `mergeQueueEntry { state }`, and a PR the queue had already merged answers a null entry too, so §5's "a null one means nothing is queued: disarm it" would send the coordinator to disarm and investigate a PR that had landed. The query now also asks the PR's `state` and `autoMergeRequest { enabledAt }`, and the paragraph gives four answers: a queued entry (the success answer), `MERGED` (it landed: wait for or prove `merged:#<pr>`, never disarm), or, with no entry, a non-null `autoMergeRequest` (only armed: disarm with `gh pr merge <pr> --disable-auto`, then read why) against none at all and not merged (nothing queued: read why). Every pinned spelling is unchanged; `coordinator-skill.test.ts` gains a case pinning the query text and the four answers (queued, merged, armed, neither), measured red on two rows in Task 5's table (the query without `autoMergeRequest`, the row S19; the MERGED answer deleted, S20).

---

## Review lenses

Three lenses for this wave, all `opus`, effort `high` — a thirty-five-file diff beside this plan (the File Structure table: twenty files that are not tests, `CLAUDE.md` and wave 1's plan among them, and fifteen test files, `measure-landing.test.ts` included, six files in all new; +2678 / −124 against `origin/main`, measured 2026-10-03 at fix round 2's tip with `git diff --stat origin/main...HEAD`, this plan left out; 134 mutation rows), sized per the fleet policy (3–5 reviewers for a 4-file PR; three concerns cover this diff because most of it is tests each lens reads against its own concern), one `sonnet` refute pass per finding. The hook is the gate R5 leans on, and the landing lane and the lifecycle rule decide who is told a merge happened, so lens 2 reads both as security-sensitive.

1. **The queue read and its wire (opus, high).** `_gh_pr_queue` sends one constant document with `-f` variables only, under `PR_GH_QUEUE_TIMEOUT`, and only in `--project`, its open window the newest hundred in `gh pr list`'s own order; the stamp buffers and falls back to the unstamped lines on its own failure, never costs a row, phase or `checks`, and says `unmeasured` — never `none` — for a read that did not happen; the five words are derived the way the spec's §5.2 intends, with the last act of either kind; `queueAt` is shape-gated before it reaches a latch key; `queueFor` is the ONE reader and keeps `absent` apart from `unmeasured`; the budget test sums THREE timeouts, the 25 s bound is argued, and all four statements of the old bound are rewritten; the deploy order is the updater's — the fleet node first, then the server — with the window between the two moves argued harmless in the `server-first-rollout` entry, and the plan's server-first intent is stated as intent, never as a command anyone runs (`CLAUDE.md`'s reader-widening rule, and the operator's ruling that nobody moves boxes by hand); no `FLEET_PROTO` bump, no `PrState` change.
2. **The worker merge deny, the landing lane's authority, and the lifecycle rule (opus, high, security-sensitive).** The deny fires at every command head the regex claims and on no quoted mention (the pass list), and its header states what it cannot parse and the false denies it names — the fail-closed class (an unterminated heredoc, or an unclosed quoted span, that holds a merge at a command head is refused though bash would run none of it); a hold is a wave only if whole (≤ `CCRC_HOLD_MAX`) and matching `CCRC_HOLD_WAVE_RE` — the card's own reader, bound and grammar, spelled once; the child marker decides by existence and has one writer, reached only through dispatch; the strip reads a backslash escape and a `#` comment as bash does, so neither opens a span that hides a merge; a deny replaces advice and never the graph gate's counted deny (H17); exit 0 and a silent stderr on every path; what it does NOT stop is stated in its header (quoted strings, unlisted wrappers and a wrapper's own flags; `--admin` and the REST and GraphQL `gh api` merges for non-workers are wave 2b's), and so is whom it refuses though they coordinate (a self-claimed run, a reclaim heir). The landing lane enqueues, merges and re-runs nothing; it mails only the coordinator of the open run `survivorOf` picks, never `resolveCoordinator(null)`'s guess, and the merged notice only to a run waiting at `merging`; its mail bodies carry no GitHub-sourced string and bind the exact SHA; it latches only what it told (an unreadable run read defers, a thrown mail retries) and a restart repeats nothing (the two durable reads). The lifecycle rule — land before close, at `merging` — is sound against the state machine (`awaiting-review → merging → closing`, `merging → working`), costs no dispatch slot, and leaves no path where a child is reclaimed under a PR still in the queue while the coordinator follows clause 15 — the last wave included; the enqueue is an enqueue only because it waits on the required checks and is read back (gh 2.45 arms auto-merge otherwise, with the same line), an armed request is disarmed before a fix round, a dequeue's why is read from the queue's own run, and a coordinator the hook refuses goes to the operator, never to a close.
3. **CI shape, guard fidelity and the citation tax (opus, high).** Every mutation row really mutates the guard it names and reds for the stated reason (H2's `set -u` crash is the counter-example the plan already fixed; H8 is measured on the wave-1 tree; M14/M15 are `ci-merge-queue`'s controls; L19–L21 and H17 pin the guards the first review found untested; S17 proves the disarm exemption is one exact spelling); `ci-merge-queue.test.ts` derives the macOS set from `runs-on`, the jobs that need one from `needs:`, and the required closure from the three required jobs' `needs:`, and refuses a duplicate top-level key; a queue run runs the selected tests (the 2026-09-28 ruling) with the pipeline check, and `select.mjs` and `verdict.mjs` agree on `tests: none`; the concurrency groups cannot drop or cancel a queue run; the CI selection overlap is handled by merging shapes, and the YAML loads under a duplicate-key loader; the census stayed `147 / 197 / 52 / 35` (the moved base's; `6da36f0b` read `148 / 196 / 53 / 36`), `shared/api.ts` changed in place, three lines, README untouched; Task 7's commands are read-only except the marked writes, name no owner, find the main ruleset through the per-ruleset read (the list endpoint carries no conditions), read main's health from a trusted full run whose shards ran rather than a refresh push, check the fleet with `--to` the dev tag, measure the exact-SHA binding with a refused wrong sha, and its stop rules cover every proof-run failure the spec names plus the trailing-removal and binding questions.
