# PR landing in ccrc, stage 1: the checks mail and the coordinator's ended turn

**Spec** · 2026-10-24 · Status: draft for review, rev 6 (re-scoped to stage 1 by the orchestrator's ruling). §10's two stage-1 questions are ruled by the orchestrator, and §11 keeps every later question for the operator with its recommendation · Owner: the ccrc coordinator · Deviation: D-6773 (issued by the ledger) · Plan: `docs/superpowers/plans/2026-10-24-pr-landing-in-ccrc.md`

**Related:** `2026-09-23-landing-order-and-main-churn-design.md` (the parent: R5 "no unattended lander", §5.2's dequeue and merged notices, §5.7.1's reads, §5.7.3's state table and §5.7.8's checks word), `docs/superpowers/programs/landing-order.md` (the proof-run readings and wave 3f), `2026-09-29-worker-stall-watch-design.md` (observation rows, shadow rows, arming markers), `2026-10-19-ccrc-consolidation-wave-design.md` (K12 switches), open PR #1127 (landing-order wave 3e, the landing route in the skill).

## In short

Coordinators spend a quarter to nearly half of their own tokens waiting. The biggest single wait is CI on a PR they are landing. The skill tells them to block on `gh pr checks --required --watch` and to re-issue it when it times out, because "no mail comes when checks finish". The server already reads every open PR every 30 to 120 seconds. It just never says when a required check finishes.

Stage 1 makes the server say it, and nothing more:

- **The checks mail.** For a run waiting at `merging`, the server reads the REQUIRED checks of the PR head the coordinator advanced at, not the whole rollup. When they go from pending to green or from pending to red, it mails the run's coordinator once: `checks:#<pr>:<episode>.<gen>:green@<head7>` or `…:red@<head7>`. A head that moved after the advance gets one `moved` mail instead, a PR that is no longer open and bound gets one `left`, and a live wait that never settles, or a red that nothing follows, ends in one `stuck`, whatever has happened to the PR, the workspace or the lane's own switches. An **episode** is one advance into `merging`, keyed on that transition's own `run_events` id, so a run that re-enters `merging` at the same head starts fresh. A **generation** is one settle inside an episode, so a rerun that goes red again is a new mail. Check names come from GitHub and anyone who can write a workflow controls them, so they are bounded, reduced to a fixed character set and fenced as untrusted data. Every edge is a durable row, deduped and latched the way `sweepLanding`'s notices are. It ships in shadow first: rows recorded, no mail.
- **The coordinator's ended turn.** When the advance to `merging` answers the capability token `checks-mail-v1`, the coordinator ends its turn. `checks:…:green` wakes it to run its own enqueue (`gh pr merge <pr> --match-head-commit <handoffCommit>`, today's spelling), and `checks:…:red` wakes it to start a fix round. `merged:` and `dequeued:` stay as they are. The foreground `--watch` wait is kept only as the fallback for an advance that does not carry the token.

The server touches no merge queue and no branch. It reads, writes rows in its own database and sends mail. The enqueue stays the coordinator's act, exactly as parent ruling R5 has it. Everything that would make the server act on GitHub is in §11, for a separate spec and the operator's rulings.

## 1. The problem, measured

Code citations are to `origin/main` `4910f4cff`. Line numbers are hints, written `≈:`, and each names its function. Between rev 3's base `7a3104abd` and `4910f4cff`, one change touched a file this spec cites: #1190 moved the advance route's ordered gates into `server/src/coord/advance.ts` (`advanceGate`) and its act into `advanceAct` (`routes.ts`), so §1.4's anchors are re-grounded. The other files it changed (`server/src/refuse.ts`, `shared/refusal.ts` and tests) are cited nowhere here. `ccd/ccd`, `watch.ts`, `store.ts`, `prstate.ts` and `shared/api.ts` did not change (`git diff --stat`).

### 1.1 What the fleet spends on waiting

The operator ran an audit of fleet transcripts on 2026-10-24: 7 days, 483k model turns, weighted by price.

| Activity | Share of fleet spend |
|---|---|
| Explicit polling, all kinds | ~7.5% |
| CI and PR polling (`gh pr checks` loops, `--watch` re-issued after a timeout) | 3.8% |
| `ccrc-api mail list` / fetch / ack | 2.5% |
| `sleep` loops | 0.9% |

Coordinators spend **25 to 44% of their own tokens** polling. The audit also found more than 20 distinct ad-hoc parsers of `ccrc-api mail list` output. That sprawl is a follow-up (§12).

### 1.2 What the skill tells a coordinator to do

`ccd/coordinator-skill/references/wave-lifecycle.md` ≈:777-838, "Landing on a native-queue project":

- Enqueue only a PR whose required checks have all passed: `gh pr checks <pr> --required` exits 0 (8 is pending, 1 is failed). For any other PR, gh arms auto-merge instead and prints the same line.
- **On `8`, "wait for them in the foreground — `gh pr checks <pr> --required --watch`, again if the call times out — never by ending your turn: no mail comes when checks finish"** (≈:786-791).
- On `1`, a fix round to the owning worker, or one `gh run rerun <run id> --failed` for a red that is not the PR's own.
- Then enqueue with `gh pr merge <pr> --match-head-commit <handoffCommit>`, read the entry back with a GraphQL query, disarm what only armed, and end the turn. `merged:#<pr>` or `dequeued:#<pr>@<time>` wakes it.

Clause 7 of `SKILL.md` (≈:76) says "This session does not poll in a loop." The `--watch` instruction is the one sanctioned poll, and it holds a whole coordinator turn open for the length of a CI run.

### 1.3 What the server already reads, and what it says

- **`sweepPr`** (`server/src/watch.ts` ≈:8235): one `ccd pr-state --project` per project, every `PR_SWEEP_MS` = 120 s, or `PR_SWEEP_ACTIVE_MS` = 30 s while any open PR reads `pending` (≈:537-538). It stores per session the phase, the CI rollup word (`prStates`) and the merge-queue word (`prQueues`, ≈:963). Its last two steps are `sweepMerged` and `sweepLanding` (≈:8337-8338).
- **The rollup is the whole set.** `checksFor` (`server/src/prstate.ts` ≈:165-176) folds every entry of `statusCheckRollup`, required or not, into one word. ccd fetches it through `gh pr list --json number,statusCheckRollup` (`_gh_pr_checks`, `ccd/ccd` ≈:5638), which carries no `isRequired`. A non-required red reads `fail` (measured on #1068 with every required check green).
- **The word is wrong for running checks.** gh writes a running check run with `conclusion: ""`, and `stateOf` keeps the empty string, so a running check reads `pass` (parent §5.7.8, measured on #1010). The fix is landing-order wave 3f. This spec's own verdict applies that rule to its own read and does not change `checksFor` (§3.3).
- **`sweepLanding`** (`watch.ts` ≈:8616, every decision in `server/src/coord/landing.ts`) mails a run's coordinator `dequeued:#<pr>@<time>` and `merged:#<pr>` (`landingVerdict`, `landing.ts` ≈:123). It never enqueues, merges or re-runs (R5). Its in-memory latch, `landingNotified` (≈:976), is written only after a notice landed or a durable read proved an earlier process sent it, and it only spares later reads. What keeps a notice single across restarts is the durable read (`hasMailWithSubject`, `hasNotice`), because every rollout restarts the server (≈:964-975).
- **The project-wide rows are a 100-PR window.** `_gh_pr_list` (`ccd/ccd` ≈:5531) reads `gh pr list --state all --limit 100` (≈:5582), the newest 100 PRs of the repository, open or not. On a busy repository a PR older than those 100 is not in the rows at all, so a binding over them answers "not bound" for a PR that is still open and still the workspace's.
- **`_pr_state_one` is a writer, not a binder.** `_pr_state_one` (`ccd/ccd` ≈:10828) hands the rows to `_pr_py state` (≈:5831), which takes `$REG/.prstate-<id>.lock` (≈:6242), appends to `<id>.prhistory` (≈:6302), and `put`s `prphase`, `prnumber` and `prcheckedat` under a compare-and-set on `prcheckedat` (≈:6253-6333). Its `$5` (when gh answered, in ms) is what ranks answers; without it `_pr_py` falls back to its own clock (≈:10829-10834), the ordering that let a stale answer overwrite a newer `prnumber`. The binding itself is `annotate` and `pick` over `bound()` (≈:5800-5829), and `_pr_py pick` (≈:6425) already runs them without persisting anything, for `ws-reap`.
- **The binding is base-exact.** ccd's `bound()` (`ccd/ccd` ≈:5806-5811) and the server's `boundRow` (`prstate.ts` ≈:147) bind a PR to a workspace only when `isCrossRepository` is false, `headRefName` is the registry branch, the PR is `ours`, and `baseRefName` equals the registry base. A PR stacked on another branch is never bound.
- **An unlistable registry is each reader's own mapping.** `readSwitches` (`shared/switches.ts` ≈:165) answers `unmeasurable` for every marker when the registry listing is null, and never resolves it: "each reader keeps its own mapping" (≈:66-67, ≈:166-167, consolidation spec K12). The advance reads the listing through `deps.io.readdir`, which can answer null, and the lane's read set comes from the same listing.
- **`coord/landing.ts` already has a `LandingLine`.** It is `sweepLanding`'s line (≈:46), read by `landingAsk` (≈:68). This spec's line for `pr-landing`'s JSON is a different shape and takes its own name, `PrLandingLine`.
- **The observation writer refuses `merging`, and refuses a repeated detail.** `insertStallObservation` (`server/src/coord/store.ts` ≈:2648) refuses any run whose state is in `INACTIVE_RUN_STATES_SQL` (≈:1114), and `IDLE_RUN_STATES` includes `merging` (`shared/api.ts` ≈:4912). It answers `duplicate` for any `(runId, detail)` already in `run_events` (≈:2657-2660), which is the stall lane's restart-proof dedupe.

### 1.4 What an advance to `merging` records today

- **`POST /api/runs/:id/advance`** (`server/src/coord/routes.ts` ≈:1826-1845) runs `advanceGate` (`server/src/coord/advance.ts`, #1190) inside `coordMutex`, then `advanceAct` (`routes.ts` ≈:1766-1793). On a move to `merging`, `advanceAct` re-measures the fingerprint (`verifyDone`, ≈:1771-1782, which checks `handoffCommit === branchTip` and the PR's phase), then calls `coord.advance(id, to, 'coordinator')` (≈:1784) with no `detail`, and answers `{ok, run}` (≈:1792), an object built inline: `shared/api.ts` has no type for the advance answer. The head it verified is dropped. The coordinator reads the answer as `ccrc-api runs advance` prints it (`ccd/ccrc-api` ≈:86).
- **The only edge into `merging` is from `awaiting-review`.** `RUN_TRANSITIONS` (`shared/api.ts` ≈:4870-4879) has `'awaiting-review': ['merging', 'working', 'closing', 'failed']` and `merging: ['closing', 'working', 'failed']`, and `advanceGate`'s `edge` gate refuses any other edge as `bad-transition` (409). So `merging → merging` and `working → merging` cannot be made. A run leaves `merging` and comes back only as `merging → working → awaiting-review → merging`, re-measured by `verifyDone` at both forward advances. Review runs never reach `merging` (`REVIEW_RUN_TRANSITIONS` ≈:4968).
- **`advanceInner`** (`store.ts` ≈:2559-2577) already takes a `detail` and writes it into the transition row (≈:2575).
- **`run_events.id`** is `INTEGER PRIMARY KEY AUTOINCREMENT` (`server/src/coord/schema.ts` ≈:99-107). SQLite never reuses an AUTOINCREMENT id, so the id of a transition row names that one transition for good.
- **A transition row and an observation row differ in shape.** A transition writes `fromState ≠ toState`. `recordRunEvent` and the observation writer write `fromState = toState` = the run's current state (`store.ts` ≈:2580-2601, ≈:2661-2664).

### 1.5 What the proof runs measured

From the landing-order ledger (`docs/superpowers/programs/landing-order.md` ≈:645-810), on this repository: an enqueue while required checks run answers rc 0, prints nothing without a TTY, and **arms auto-merge instead of queueing**. That is why the coordinator enqueues only on green, and why the skill keeps its read-back. Queue landings ran about 15 minutes apart at group size 1.

## 2. Goals and non-goals

**Goals.**
1. No coordinator turn stays open waiting for CI on a PR it is landing.
2. The "required checks finished" fact has one producer, the server, and one consumer, the run's coordinator.
3. The landing decision and the enqueue stay the coordinator's, at a head it verified. The server changes nothing on GitHub.
4. Every string GitHub supplies reaches a model only bounded, reduced and fenced.
5. A coordinator that ended its turn on the token always hears something: a green, a red, a `moved`, a `left` or a bounded `stuck` (§3.2, §3.5, §3.6), whatever happens to its PR, its workspace or the lane's switches after the advance. That holds after a red as well as before a settle, and after a `stuck` as well as before one: a red that no fix round and no visible rerun follows owes its own bound, and a rerun the lane sees after an unsettled `stuck` opens a new generation that owes its own (§3.5). The one wake that owes no bound is green, because its act is the enqueue, and the enqueue's own wakes are `merged:` and `dequeued:`; the green branch that cannot enqueue waits in the foreground (§5).

**Non-goals.**
- Any server act on the merge queue, a PR, a branch or a workflow run: no enqueue, no read-back, no merge proof, no re-queue, no rerun (§11).
- Attributing the advance, and any session-hook change (§11).
- Stacked PRs, beyond saying why none is mailed (§6).
- Workers' own CI waits while a run is `working` (§12).
- `checksFor` and the PWA's checks word (landing-order wave 3f).

## 3. The checks mail

### 3.1 The episode

An **episode** is one advance into `merging` that the server measured. The advance to `merging` (§4) writes its transition row with the detail `merging-at:<head>:<pr>:<mode>`. `<head>` is the 40-hex head `verifyDone` verified (`claim.handoffCommit`, equal to the measured `branchTip`). `<pr>` is the PR number `verifyDone` measured, or `none`, which only an `off` episode may carry. `<mode>` is `live`, `shadow` or `off` (§3.7). The episode's id `e` is that transition row's `run_events.id`. Every subject of the episode names `<pr>` and `<head>` from this row, so a mail can be addressed even when the PR no longer binds.

- The run's **current episode** is its newest transition row with `toState = 'merging'` and `fromState <> 'merging'` (today always `fromState = 'awaiting-review'`, §1.4), when that row carries a `merging-at:` detail. Observation rows written while the run waits have `fromState = toState`, so they are never mistaken for a transition.
- **A re-entry is a new episode.** `merging → working → awaiting-review → merging` at the same head (the only way back, §1.4) writes a new transition row into `merging`, so `e` is new. Generation 0 opens again, the stuck clock restarts, and no row of the old episode is read. This replaces rev 2's (run, head) key, which let a re-entry at the same head inherit the old episode's settled edges and its stuck clock.
- **Why a transition-row detail and not a column.** The head and the mode are facts of the transition, written once by the one writer that makes the transition. They need no migration, no second writer and no clear on `merging → working`, because the next episode is a new row. One writer and one reader live in `shared/landing.ts` (`mergingAtDetail`, `readMergingAtDetail`), and the reader answers null for anything it does not know.

### 3.2 Who is told, and what is read

Two sets, because a wait that cannot be read still needs its bound.

- **The owed set** is every open run at `merging` whose current episode has mode `live` or `shadow`, whatever has happened to its PR or its workspace since the advance. Every member's wait ends in one mail (live) or one row (shadow): an edge, `moved`, `left` or `stuck`. The stuck bound (§3.5) is folded for every member on every pass, read or not, and is never gated on the PR being bound, open or read.
- **The read set** is the members of the owed set whose `sessionId` is still a registry workspace of the run's project. `pr-landing` is asked about these and only these, each with its episode's `<pr>`, and checks that each one's PR still binds (§3.3). A member whose workspace left the registry is not read; its bound still runs, and its `stuck` carries the cause `unmeasured`. When the registry cannot be listed, the read set is empty for that pass (§3.8).

One pure decider, `landingLineAct` (L1, `coord/landing.ts`), turns an episode and its line into one act, in this order:

1. **`unmeasured`**: the read, or the binding (§3.3), did not answer. No edge; the bound runs.
2. **The edge** (§3.5): the line is bound to the episode's `<pr>`, `OPEN`, not a draft, and its head is the episode's head.
3. **`moved`**: bound to the episode's `<pr>`, `OPEN` and not a draft, at another head (a late worker push, or an advanced tip that was never pushed). `checks:#<pr>:<e>.0:moved@<head7>` once per episode, naming the new head in the body.
4. **`left`**: anything else, which is the PR closed, turned into a draft, merged, or no longer bound to the workspace (retargeted to another base, which the base-exact binding drops, or a head that is no longer the workspace's own). `checks:#<pr>:<e>.0:left@<head7>` once per episode, with the measured phase (`closed`, `draft`, `unbound`) in the body. A merged PR writes the `left` row with phase `merged` and sends no mail: `sweepLanding`'s `merged:` is that wake and stays its one writer.

`moved` and `left` end the episode for the lane: no later read, edge or `stuck`. The coordinator has been woken, and the skill's act for each takes the run off this episode (§5).

The recipient is the run's coordinator, through `resolveCoordinator(runId)`, sent from the `operator` role like the landing lane's notices. A PR with no run, a closed run, a stacked PR (§6) and a run whose advance answered `off` are never read or mailed about.

### 3.3 The read: `ccd pr-landing`

A new read-only verb answers for the population of one project in one call:

    ccd pr-landing --project <project> --sessions <id>:<pr>[,<id>:<pr>…]

The lane names each session with its episode's `<pr>` (§3.1), and ccd reads that PR by number. It never reads the project-wide `gh pr list` window, because that window is the newest 100 PRs (§1.3): a landing PR older than them would drop out of the rows, read as not bound, and end a live episode with a false `left`. For each session ccd checks that the PR still binds, with `pr-state`'s own binding code, persisting nothing (below), and prints one JSON line. Per call, in this order:

| # | Call | ccd timeout | When |
|---|---|---|---|
| 1 | one GraphQL query, one aliased `pullRequest(number: N)` per named session | `PR_LANDING_GQL_TIMEOUT` = 6 s | every call |
| 2 | `repos/{o}/{r}/rules/branches/<base>` | `PR_LANDING_REST_TIMEOUT` = 4 s | cache miss |
| 3 | `repos/{o}/{r}/branches/<base>` (the public branch view) | `PR_LANDING_REST_TIMEOUT` = 4 s | cache miss |

The worst case is 6 + 4 + 4 = 14 s. The runner budget `CCD_VERB_TIMEOUT_MS['pr-landing']` is 25 s, so the calls take at most 56% of it, and the 30% reserve `pr-timeout-budget.test.ts` requires of `pr-state` (`LOCAL_LOOP_RESERVE`) holds (14 ≤ 17.5 s). The verb runs outside `coordMutex`, so its length delays only this lane.

- **The GraphQL read.** The numbers are the episodes' own, checked against `^[1-9][0-9]{0,8}$` twice (by the server's argv builder and by ccd) and passed as `-F` integer variables, never interpolated text. The document is a `query`, a constant in ccd, with no `mutation`. For each PR it reads the fields the binding reads, in the shape of a `gh pr list` row (`number`, `state`, `isDraft`, `isCrossRepository`, `headRefName`, `baseRefName`, `headRefOid`), and the head commit's `statusCheckRollup.contexts`. For each context it reads `__typename`, `name`/`context`, `status`, `conclusion`/`state`, the check run's App id, `isRequired(pullRequestNumber: N)`, **`checkId`** (a check run's own `databaseId`, new for every attempt, `--failed` reruns included; `null` for a commit status, which carries no attempt id: its `createdAt` changes on every post, the same attempt's pending-to-final post included) and **`runId`** (the workflow run's `databaseId`, the same across attempts, an integer the red mail's rerun spelling names). An alias GitHub answers with no object answers `{id, unmeasured: ['pr-unreadable']}`.
- **The base's required set by name**, reads 2 and 3 (parent §5.7.1 reads 2 and 3b), with plain read access, cached for 600 s in `$REG/pr-landing/<project>.rules.json`, a dotless registry subdirectory (the pools rule in CLAUDE.md). An unreadable cache is a miss, never a hit.
- **Binding without persisting.** `_pr_state_one` is a registry writer (§1.3), so `pr-landing` never calls it: doing so would make it a second writer of every bound session's `prphase`, `prnumber` and `prcheckedat`, racing `pr-state`'s compare-and-set. It binds instead through a new `_pr_py` mode, `bind`, which runs `annotate` and `pick` (and so `bound()`) over the one row the alias answered, writes nothing, and prints only that row's `number`, `headRefOid`, `baseRefName`, `state` and `isDraft` when it binds, or `{id, bound: false}` when it does not. The shell-side facts the binding reads (the registry branch and base, `baseShort`, the branch tip) and `_pr_state_one`'s refusals that come before any persist (no branch, an unreadable tip, the branch-drift rung, ≈:10860-10872 and ≈:10951-10988) move out of `_pr_state_one` into one helper, `_pr_bind_facts`, which both call. A refusal answers `{id, unmeasured: [<reason>]}`, which the lane reads as `unmeasured`, never as `left`. So the two verbs cannot disagree on whether a session owns a PR, and only `pr-state` writes the registry's PR fields.
- **Read-only, measured.** Every gh call is a read: `api graphql` with a `query` document, and two `api` GETs. The verb composes no `pr list`, no `pr merge`, no `-X`/`--method` other than GET, no `mutation`, and no `git` write. No `$REG` file outside its own cache directory `$REG/pr-landing/` is created, changed or appended: no `.prstate-<id>.lock`, no `.prhistory`, no registry field. Fixture censuses pin both (plan PL-1).

`isRequired` sees only checks that have reported. The rules read is what makes a required check that has not reported visible, the case parent §5.7.3 calls **not reported**: "an empty list means nothing has reported, never a pass".

**Why a new verb and not a fourth call in `pr-state`** (the "legitimately different" record CLAUDE.md asks for): `isRequired` takes the PR number as an argument, so it cannot ride the project-wide window `_gh_pr_checks` reads, and that window can drop a landing PR (§1.3). `pr-state --project` already spends 17 of its 25 s budget (`ccd/ccd` ≈:5436-5470 and ≈:40239, pinned by `pr-timeout-budget.test.ts`). And this read is needed only for the handful of runs at `merging`, each of whose PR numbers the server already holds. The binding is shared, not copied: both verbs bind through `_pr_bind_facts` and `_pr_py`'s `annotate`/`pick`, and only `pr-state` persists.

GitHub-sourced text is handled as `_pr_queue_py` handles it: documents travel on stdin and numbered file descriptors, never in an argv or a shell word. ccd bounds each name to 120 bytes and each list to 32 entries, and says when it cut.

### 3.4 The required verdict

One pure function, `requiredChecksVerdict`, in `server/src/coord/landing.ts` (L1, C4), reads the line. The required set is the union of (a) contexts marked `isRequired`, (b) every `required_status_checks` rule's names from the rules read, and (c) the branch view's `protection.required_status_checks` contexts. Each name takes one state, as parent §5.7.3's table defines them:

| Word | Meaning |
|---|---|
| `green` | every required name is passing on the head (`success`, `neutral` or `skipped`, or a status `success`), from the named App where one is named |
| `red` | at least one required name is red (any other completed conclusion, or a status `failure`/`error`) |
| `pending` | none is red, and at least one is running or `pending` (a check run with an empty `conclusion` that is not completed is running: wave 3f's rule, applied to this read only) |
| `not-reported` | none is red or running, and at least one required name has no context at all |
| `unverifiable` | a required name pinned to an App shows only as a commit status, which carries no App id (a parent §5.7.5 stop) |
| `unmeasured` | the read did not answer, or answered a shape this build does not know |

The set is never empty by default. A repository with no required checks reads `green` only when all three sources answered and named none.

The verdict also answers a **fingerprint**: the first 12 hex of sha256 over the sorted `name=checkId` pairs of the required **check runs** that have reported. Commit statuses are not in it, because a status has no attempt id (§3.3): a red can settle while a required status is still pending, and that status's own final post must not read as a rerun and mail the same red again. Two reads of the same attempts have the same fingerprint, and any rerun or re-request of a check run changes it, which covers every rerun the coordinator can start (`gh run rerun` makes new check runs). A rerun of a status shows only as a running read (§3.5 rule 1). The hash is computed by the L4 caller and passed in, so `landing.ts` takes no `node:crypto` import.

### 3.5 The edge, written down

Every fact the edge needs lives in `run_events` rows, because every rollout restarts the server. Per episode `e` the lane reads its rows, whose detail is `landing:checks:<e>:<gen>:<what>`; an edge row's detail ends `@<fp12>`, and a `stuck` row's ends `:<reading>` (below):

- **`<gen>:open`** opens a generation and carries its start in `at`. Generation 0 opens on the lane's first sighting of the episode, with `at` copied from the episode's transition row, not from the sighting.
- **The generation** is the count of `open` rows for `e`, minus one, derived from the rows on every pass.
- **`<gen>:green@<fp>` and `<gen>:red@<fp>`** are the edges. A move from unsettled (`pending`, `not-reported`, `unmeasured`, or no row yet) to `green` or `red` writes one, and an edge mails once. A first sighting that is already settled writes `open` and the edge in the same pass.
- **A settled generation opens the next one** on any of three readings, with `at` the sighting:
  1. it reads `pending` or `not-reported` (a rerun the lane saw running);
  2. its fingerprint differs from its edge row's (a rerun that started and finished between two reads);
  3. it reads the other settled word (red to green, or green to red, with no running read between).
  In cases 2 and 3 the reading is already settled, so the same pass writes `<gen+1>:open` and `<gen+1>:<word>@<fp>` and mails the new edge.
- **`<gen>:stuck`** is the bound, written and mailed at most once per generation. Two states of the current generation owe it:
  1. **Unsettled.** The generation is still unsettled `LANDING_CHECKS_STUCK_MS` (45 min: the CI job bound is 30 min) after its own `open` row's `at`, or reads `unverifiable`, which waiting will not change, and then it is owed at once (§3.6).
  2. **Settled `red`.** The generation's edge is `red`, the run is still at `merging` in this episode, and no next generation has opened `LANDING_CHECKS_STUCK_MS` after the red edge row's `at`. After a red the coordinator either starts a fix round, which takes the run off `merging` and so out of the owed set, or reruns, which opens the next generation as soon as the lane reads it (a pending read or a changed fingerprint). So this bound fires only when nothing the lane could see has followed the red. That includes every pass that cannot read: `landing-disabled`, a ccd without `pr-landing-v1`, and a workspace gone from the registry. Without it, a coordinator that reran and ended its turn would hear nothing once the lane stopped reading, because generation 0 would stay settled `red` for good.

  A **`green`-settled** generation owes no bound. Its wake leads to the coordinator's enqueue, and `merged:` or `dequeued:` follows from `sweepLanding`, which no switch of this lane stops; the one green act that does not enqueue (exit 8, §5) falls back to the foreground wait.

  The cause is one closed word: `disabled` under `landing-disabled`; `unmeasured` when the pass cannot read the episode (a ccd without `pr-landing-v1`, a workspace gone from the registry, a registry that cannot be listed) or its read did not answer; `timeout` when the lane read it; `unverifiable` as above. The bound is folded for every member of the owed set (§3.2) on every pass, read or not, because both of its clocks are rows. An episode the lane never read has no `open` row; its generation 0 then opens on the first pass that sees it in the owed set, with `at` copied from the transition row as always.
- **The `stuck` row records what the lane saw.** Its detail is `<gen>:stuck:<reading>`, where `<reading>` is `<word>@<fp12>` for a pass that read the episode (`<word>` one of `pending`, `not-reported`, `unverifiable`, `red`), or `unread` for a pass that did not (`stuckOnly`, or an `unmeasured` read).
- **What follows an unsettled `stuck`** (the orchestrator's ruling on rev 5's review). A generation that mailed `stuck` while unsettled opens the next generation, `<gen+1>:open` with `at` the sighting, on any of three readings:
  1. a running read (`pending`) when the `stuck` row's reading was not running (`not-reported`, `unverifiable` or `unread`): a check started that was not running when the bound fired;
  2. a `pending` or `not-reported` read whose fingerprint differs from the `stuck` row's: a rerun the lane saw (the coordinator's `gh run rerun` always makes new check runs, §3.4);
  3. a settle, `green` or `red`, which writes `<gen+1>:open` and `<gen+1>:<word>@<fp>` in one pass and mails the edge.
  The new generation owes its own bound from its own `open` row, by the rules above: unsettled 45 minutes after it opened, or 45 minutes after its red. So a rerun after a `stuck` that hangs too ends in a second `stuck`, and a red after a `stuck` owes its own. A `pending` read with the `stuck` row's own fingerprint opens nothing: it is the same hung wait, and opening a generation on it would mail `stuck` every 45 minutes for as long as CI hangs. No generation needs two `stuck` rows, which the `(runId, detail)` dedupe would refuse.
- **`moved`** (`landing:checks:<e>:moved`) and **`left`** (`landing:checks:<e>:left`) are written once per episode (§3.2), with no generation in the row and `0` in the subject. Either one ends the episode for the lane.

**Cadence.** One `pr-landing` call per project per pass: every 30 s while any of the project's episodes is unsettled **or its last edge is red** (a coordinator's rerun follows a red), and every 120 s once every episode's last edge is green or stuck. The fingerprint rule is what makes the mail correct; the 30 s cadence after red only makes it quicker.

So, across a restart: a gen-0 red, a rerun and a second red mail twice (`<e>.0:red`, `<e>.1:red`), whether or not the lane saw the rerun running; a gen-1 green that was mailed is never mailed again; an episode pending forever mails `stuck` 45 minutes after its `open` row however often the server restarts, because the clock is a row; a red that nothing follows mails `stuck` 45 minutes after its red row, whether or not the lane is still reading; and a rerun after an unsettled `stuck` that hangs as well mails a second `stuck` 45 minutes after its own `open` row.

**Deduped and latched like `sweepLanding`.**
- **The durable once-only** is the row. A mailed edge writes its row and queues its mail in ONE transaction, through `queueLandingNotice(coord, run, {detail, at, episode, toId, subject, body})` in `server/src/coord/rundefsTx.ts`, beside and in the shape of `queueStallNotice` (≈:170): the observation row first, then `insertSystemMailTx`. A `duplicate` row (an earlier process already told it) or a gone run writes no mail. A throw after the row rolls both back, so the next pass tries again. That is the restart-proof read `sweepLanding` makes through `hasMailWithSubject`, made in the same transaction as the write, so a check-then-act gap cannot open between them.
- **The in-memory latch** is `checksNotified`, keyed by `(runId, e, gen, word, fp)`, and each entry carries the generation's **due time**: the `open` row's `at` + `LANDING_CHECKS_STUCK_MS` for an unsettled generation, the red row's `at` + `LANDING_CHECKS_STUCK_MS` for a `red`-settled one, and none for a `green`-settled generation or one that holds its `stuck` row, which owe no further bound. The due time is computed by `checksEdge` from the same rows the pass read, once, when the entry is written. The entry is written only after a row landed or was found `duplicate`, or after a fold that wrote nothing, never before a read. A pass whose verdict and fingerprint equal the latched key makes no coord.db read for that episode **only while `nowMs` is before the entry's due time**; a pass at or past it reads the rows and folds them anyway, so the bound fires on time whether or not the reading changed. It is a read-sparing cache, never the record, exactly as `landingNotified` is (≈:964-976), and it never switches the bound off: the common case it must not break is hung CI with the coordinator's turn ended, where every pass reads the same `pending` at the same fingerprint.
- **One bad row may not cost the rest.** Each episode's reads and writes sit in their own `try`, as `sweepLanding`'s rows do.

**The writer.** Rows go through the store's observation writer, generalised from `insertStallObservation` (`store.ts` ≈:2648) to take an explicit state predicate, a closed union of exactly two members:

- `{kind: 'active'}`, the stall lane's, unchanged: `state NOT IN INACTIVE_RUN_STATES_SQL`;
- `{kind: 'merging-episode', episode}`, this lane's: `state = 'merging'` AND the run's newest transition row into `merging` (`toState = 'merging' AND fromState <> 'merging'`, `MAX(id)`) is `episode`.

A run that left `merging`, or re-entered it as a new episode, between the lane's read and the write records nothing and is mailed nothing (`run-gone`). A closed run fails both members. The `(runId, detail)` dedupe is unchanged for both. Shadow rows and unmailed rows use the one-transaction form (`recordObservation`, the generalised `recordStallObservation`, ≈:2671).

### 3.6 The mail

Subject `checks:#<pr>:<e>.<gen>:<word>@<head7>`, `<word>` one of `green`, `red`, `stuck`, `moved`, `left`, with `<pr>` and `<head7>` always the episode's own (§3.1); kind `status`; from `operator`; to the coordinator; carrying the `runId`. The episode and generation are in the subject, because a second red of the same head, or a red after a re-entry, is a new fact. The body is built in one place, `renderChecksBrief` in `coord/landing.ts`:

- The facts the server owns: PR number, workspace id, the episode's head, the word, the episode and generation.
- On `red`: the failing required names, after `landingCheckName` (below), inside `untrustedBlock` (`server/src/coord/untrusted.ts` ≈:48) with a preface that names GitHub as the source. That renderer is the one the ask and approval mails use, so the fence cannot be closed from inside. `untrusted.ts` imports nothing, so `landing.ts` may take it as a value import.
- The next act, as the skill spells it: on `green`, the coordinator's own enqueue; on `red`, a fix round to the owning worker on `merging → working`, or, for a red that is not the PR's own, one `gh run rerun <runId> --failed`, where `<runId>` is an integer the server read and validated. The server names the act. It never performs it.
- On `stuck`, its cause, one closed word: `timeout` (read by the lane and still pending or not reported 45 minutes after the generation opened, or still red at the same fingerprint 45 minutes after its red edge), `unmeasured` (the read did not answer, the ccd no longer answers `pr-landing-v1`, the workspace left the registry, or the registry could not be listed), `unverifiable`, or `disabled` (§3.8).
- On `moved`, the measured head (40 hex, validated). On `left`, the measured phase, one closed word: `closed`, `draft` or `unbound`.

**`landingCheckName`** (L1, pure) reduces a GitHub-supplied name before it enters any mail:
- NFKC-normalise it.
- Replace every character outside `[A-Za-z0-9 _.,:()/+#-]` with `?`. That removes backticks, control characters, newlines and bidirectional overrides.
- Collapse runs of whitespace, and cap it at 80 characters.
- Cap the list at 10 names, with a count of the rest.

A name is never an argv, a shell word, a subject or a file name.

### 3.7 The mode, decided once per episode

The advance to `merging` (§4) decides the episode's mode in its own transaction:
- `off` unless the advance's `verifyDone` measured a bound PR in phase `open` (`measured.prNumber` non-null and `measured.prPhase === 'open'`). A run that reaches `merging` with no bound PR, a draft or a stacked PR (§6) is outside the population.
- `off` while `$REG/landing-disabled` stands, or while the ccd does not answer `pr-landing-v1`.
- `off` when the registry cannot be listed. The advance reads the markers through `deps.io.readdir` and `readSwitches`, and a null listing reads `unmeasurable` (§1.3). This reader's mapping of `unmeasurable` is `off`, so no token is sent: a coordinator not told `live` keeps the foreground wait, and nothing is owed to it.
- `live` when `$REG/landing-checks-live` stands; otherwise `shadow`.

**The mode is fixed for the episode.** Removing `landing-checks-live` later stops new episodes going live, and leaves a live episode live until it leaves `merging`. A coordinator told `live` has ended its turn, and silencing its episode would leave it with nothing to wake it. That is why stage 1 needs no `mode-dropped` notice (§11). In shadow the lane writes `landing-shadow:checks:<e>:…` rows (same shape, same generations) and sends no mail, and the coordinator keeps today's foreground wait.

**What the coordinator sees.** The advance answer gains one optional field, set only when the episode's mode is `live`:

    checksMail: 'checks-mail-v1'

It is a capability token: the skill reads it, and nothing else, to decide whether to end its turn. An older server, a `shadow` or an `off` episode sends no field, and the skill reads that as "wait in the foreground as before".

### 3.8 The switches

- `$REG/landing-checks-live` arms new episodes live. `$REG/landing-disabled` stops every `pr-landing` read and every edge row and mail, live or shadow, and wins over the live marker. Neither has a writer in the tree. Both are rows of `SWITCHES` (`shared/switches.ts`), owner C4, writer `hand-only`.
- **The stuck bound is the one thing `landing-disabled` does not stop**, and only for live episodes. It needs no ccd call: its clocks are the generation's `open` row and its red edge row (§3.5). So a live episode whose lane is disabled, or whose ccd lost `pr-landing-v1` (a ccd rollback), still mails one `checks:…:stuck` with cause `disabled` or `unmeasured`, 45 minutes after its current generation opened if that generation is unsettled, or 45 minutes after its red row if it settled `red`, and the coordinator falls back to the foreground wait. A `green`-settled episode has already woken its coordinator to enqueue (§3.5). That is §10 S1.
- **An unlistable registry in the lane.** The lane's read set and its switches come from the tick's registry listing. When that listing is null, every marker reads `unmeasurable` (§1.3), and this reader's mapping is: make no `pr-landing` read that pass, and fold `stuckOnly` with cause `unmeasured` for every live owed episode, as for a ccd without the capability. Shadow episodes get nothing. So a coordinator that ended its turn still gets its one bound, and a listing that comes back resumes the reads at the next pass.
- `$REG/mail-disabled` holds every mail of this lane, as it does for the stall watch. A held mail keeps no row, so it goes once mail is enabled.

## 4. The advance records the episode

`POST /api/runs/:id/advance` changes on a move to `merging` only, in `advanceAct` (`routes.ts` ≈:1766-1793), which runs inside the route's `coordMutex` hold, after `verifyDone` answers ok. `advanceGate` and its order are unchanged:

1. Compute the mode (§3.7) from the switches (the registry listing through `deps.io.readdir` and `readSwitches`, where `unmeasurable` maps to `off`), `ccdCan('prLanding')` and `verdict.measured`, through `checksModeAt` (L1, `coord/landing.ts`).
2. Call `coord.advance(id, 'merging', 'coordinator', mergingAtDetail(claim.handoffCommit, verdict.measured.prNumber ?? 'none', mode))`. `advanceInner` already writes `detail` into the transition row (≈:2575), so the transition and the episode are one row in one transaction. `causedBy` stays `coordinator`.
3. Answer `{ok, run}` as today, plus `checksMail: CHECKS_MAIL_TOKEN` when the mode is `live`. The answer gets a type for the first time: `AdvanceOk` in `shared/api.ts` (`{ok: true; run: RunSummary; checksMail?: typeof CHECKS_MAIL_TOKEN}`, with a type-only import of the token from `shared/landing.ts`, a sibling, so the L0 rule holds), and `advanceAct` sends it with `satisfies AdvanceOk`. Its one reader is the coordinator, which sees the field in the answer `ccrc-api runs advance` prints (§5).

Every other target keeps its exact behaviour, and every refusal path is unchanged: a refused `verifyDone` writes no transition and so no episode. `handoffCommit` keeps its one writer, the close.

## 5. The coordinator skill

`ccd/coordinator-skill/references/wave-lifecycle.md`, the landing paragraph as #1127 leaves it:

- **With `checksMail: "checks-mail-v1"` in the advance answer**, the coordinator does not wait for checks in the foreground. It ends its turn, and these wake it:
  - `checks:#<pr>:<e>.<gen>:green@<head7>`: run `gh pr checks <pr> --required` once, with no `--watch`. On exit 0, enqueue exactly as today (`gh pr merge <pr> --match-head-commit <handoffCommit>`, no `--squash`, never `--admin`), read the entry back with today's GraphQL query, disarm what only armed, and end the turn. On exit 8 (a rerun started after the mail), do not end the turn: go back to today's foreground text for the rest of this episode, `gh pr checks <pr> --required --watch` included. A green-settled generation owes no `stuck` (§3.5), so a turn ended here could wait with nothing to wake it if the lane stopped reading.
  - `checks:…:red@<head7>`: start a fix round to the owning worker on `merging → working`, as today's `1` branch does, or, for a red that is not the PR's own, one `gh run rerun <run id> --failed`, and end the turn. The next generation's mail wakes it; if none comes, because the rerun did not start or the lane stopped reading, one `checks:…:stuck` comes 45 minutes after the red (§3.5).
  - `checks:…:stuck@<head7>`: read the cause, then act once.
    - For `timeout`, read `gh pr checks <pr> --required` and choose one. A rerun (`gh run rerun <run id>`, `--failed` for a red), then end the turn: the rerun's new check runs open the next generation, whose green or red wakes you, and if it hangs too a second `stuck` comes 45 minutes after it opened (§3.5). A fix round on `merging → working`. Or ask the operator and end the turn: the reply wakes you.
    - For `unverifiable`, `unmeasured` or `disabled`, the checks mail cannot decide this PR, so go back to today's foreground wait for the rest of this episode.
  - `checks:…:moved@<head7>`: the PR's head is not the head you advanced at. Send the run back to `working`; then, when the head is the one to land, re-advance through `awaiting-review` to `merging` at the new head (a new episode). There is no `merging → merging` advance: the server refuses it as `bad-transition` (§1.4).
  - `checks:…:left@<head7>`: the PR is no longer open and bound (the body names `closed`, `draft` or `unbound`), and the checks mail has stopped reading this episode. Read the PR, then either go back to today's foreground wait for it, or send the run back to `working`.
  - `merged:#<pr>` and `dequeued:#<pr>@<time>` stay exactly as today.
- **Without the token** (an older server, shadow, `off`), today's text stands word for word, the foreground `gh pr checks <pr> --required --watch` included.
- A coordinator whose own workspace carries a programme-wave hold or the child marker is still refused its enqueue by the session hook. On `checks:…:green` it asks the operator to enqueue from their own shell, as today's paragraph says (≈:832-838).

`SKILL.md` clause 7 ("This session does not poll in a loop") is unchanged: the wait it allowed is gone for a live episode. Clause 15 is unchanged. Every subject the skill names is pinned to a builder's output in `coord/landing.ts`, never a copy.

## 6. Stacked PRs

A PR stacked on another (its base is the parent's branch, not the default branch) is never bound, because the binding is base-exact and a workspace's registry base is the default branch at its creation (§1.3). So:
- an advance to `merging` that claims it as the run's PR is refused by `verifyDone` (`pr-regressed`: claimed `open`, measured `none`);
- an advance that claims no PR answers no token, because its mode is `off` (§3.7), and the coordinator keeps today's wait;
- the lane never reads or mails about it;
- a PR retargeted onto another branch after a `live` advance stops binding, so the lane mails `left` with phase `unbound` once (§3.2).

The plan pins this with census cases. Detection, a `restack:` mail and any server-side restack are in §11.

## 7. Safety

The CLAUDE.md SAFETY rules are unchanged.

- **No GitHub write, no branch touched.** The lane composes one ccd verb, `pr-landing`, which is read-only by construction and by census (§3.3). The server runs no `gh` (`EXEC_COMMANDS` stays `['tmux','ccd']`, `agent/src/whitelist.ts` ≈:220; `gh` stays in `FORBIDDEN_COMMANDS`, ≈:232). No merge queue entry, auto-merge request, branch, ref, workflow run or PR is created, changed or removed by anything this spec adds. The enqueue and the rerun stay the coordinator's, under today's hook.
- **Only runs the server owns.** The lane reads an open run at `merging` in a measured `live` or `shadow` episode whose `sessionId` is a registry workspace, and acts on a line only through `landingLineAct` (§3.2). A PR with no run, a closed run, a stacked PR and an `off` episode are never read.
- **No registry write.** `pr-landing` writes no registry field and no `.prstate` lock or `.prhistory` (§3.3); `pr-state` stays their one writer.
- **Untrusted text.** Check names are attacker-controllable (fork PRs, any workflow author). They are never an argv, a shell word, a subject, a file name or a GraphQL document. They are bounded in ccd, reduced by `landingCheckName`, and fenced by `untrustedBlock`. Integers (PR number, run id, check id) and shas are validated by regex before they are spelled anywhere.
- **Fail toward silence, then a bound.** `unmeasured`, a cache miss and an unknown shape mail nothing at once. Each generation of a live episode that is unsettled after 45 minutes, and each one that settled `red` and opened no next generation 45 minutes after its red, ends in one `stuck` mail; a rerun the lane sees after an unsettled `stuck` opens a generation that owes the same; whether or not its PR still binds, its workspace is still registered or the lane is still reading (§3.5). A PR that closes, turns draft or stops binding ends the episode in one `left`. A `green` wake leads to the enqueue, whose own wakes are `merged:` and `dequeued:`, and the green branch that cannot enqueue waits in the foreground (§5). So a coordinator that ended its turn is never left waiting with nothing to wake it.
- **Arming.** The lane ships in shadow. `landing-checks-live` and `landing-disabled` have no writer in the tree. `mail-disabled` holds every mail.
- **No herd.** One `pr-landing` call per project per pass, only for projects with a member in the read set (§3.2), naming only those members' own PR numbers.
- **Fixture HOMEs only** in every test (`makeCcdHarness`). gh is faked through `ghContainedEnv()` and a fixture `gh` on PATH. No task creates a marker on a live box.

## 8. Ownership and the consolidation rule

| Fact or act | Before | After |
|---|---|---|
| A PR's CI rollup word for the PWA | `checksFor`, whole set | unchanged |
| The required checks of a landing PR's head | the coordinator's `gh pr checks --required` | `ccd pr-landing` → `requiredChecksVerdict` (one reader, `coord/landing.ts`) |
| "Required checks finished" | **nobody says it** | the checks lane, durable rows through `queueLandingNotice` |
| The head and PR verified at `merging`, and the episode's mode | re-measured, then dropped | the transition row's `merging-at:<head>:<pr>:<mode>`, one writer (the advance), one reader (`readMergingAtDetail`) |
| Which PR a workspace owns | `_pr_state_one` (binds and persists) | `_pr_bind_facts` and `_pr_py`'s `pick`, shared by `pr-state` and `pr-landing`; persisted by `pr-state` only |
| The queue entry, the read-back, the merge proof | the coordinator | unchanged (the coordinator) |
| Observation rows | `insertStallObservation`, stall lane only | one writer with a closed two-member state predicate, two lanes |

Every new decision goes into `coord/landing.ts`, the landing lane's L1 owner (D-3883), whose value imports widen only to two pure files, `shared/landing.ts` (L0) and `coord/untrusted.ts`. No second notifier, sanitiser, fence or observation writer is added: `untrustedBlock`, `insertSystemMailTx` and the observation writer are reused, and `queueLandingNotice` is `queueStallNotice`'s sibling, not a copy of its body. The one new read path, `pr-landing`, is recorded as legitimately different in §3.3. When the LaneRunner refactors land (#1200, #1209), the lane becomes a row of `LANE_SCHEDULE` like its neighbours.

## 9. Wire, deploy and rollback

- **ccd:** one read-only verb, `pr-landing`, and the capability `pr-landing-v1`. `CCD_CAN` (`server/src/ccdargv.ts` ≈:1161) refuses without it, so the lane is inert on an older ccd.
- **Agent:** the grant `['pr-landing','--project']`. Runner budget `'pr-landing': 25_000` in `CCD_VERB_TIMEOUT_MS` (`server/src/remote/runner.ts`), pinned against ccd's call timeouts at the 30% reserve.
- **coord.db:** no migration. Every new fact is a `run_events` row: the episode in the transition row's `detail`, the edges as observation rows.
- **Server ↔ coordinator:** the optional `checksMail` field on the advance answer; the new subject `checks:#<pr>:<e>.<gen>:<word>@<head7>`, built once beside `dequeuedSubject` and `mergedSubject` (`coord/landing.ts` ≈:36-38). `dequeued:` and `merged:` are unchanged.
- **PWA:** no change. Observation rows show in the run's history like the stall watch's.
- **No `FLEET_PROTO` bump.** Everything is additive, and absence reads as today's behaviour.
- **Order:** agent lane first. The server reads a missing capability as `off`.
- **Rollback.** Removing `landing-checks-live` makes new episodes shadow and leaves live ones live (§3.7). `landing-disabled` stops the reads; each live episode whose current generation is unsettled, or settled `red`, then ends in one `stuck` mail at its bound (§3.8), and a `green`-settled one has already woken its coordinator to enqueue. A ccd rollback reads `off` for new episodes and ends live ones the same way, with cause `unmeasured`. **A server rollback past the lane** cannot send anything, so the runbook removes `landing-checks-live` first, then waits until no open run at `merging` has a live current episode (a coord.db read the runbook spells, plan §Rollback), and only then rolls the server back.

## 10. Stage-1 questions, ruled

The orchestrator ruled both on rev 5's review, as recommended. They are recorded here so the reasons stay with the design.

- **S1. Does `landing-disabled` still let a live episode's `stuck` mail go?** **Ruled: yes**, held by `mail-disabled`. §3.8 builds it: only that one mail per generation, with cause `disabled`, 45 minutes after an unsettled generation opened, or 45 minutes after a red that no next generation followed. Without it, a coordinator that ended its turn on the token, before a settle or after a red and a rerun, hears nothing until `merged:` or `dequeued:`, and neither can come, because it has not enqueued. It needs no ccd call and no read of GitHub.
- **S2. Arming.** **Ruled:** arm `landing-checks-live` after a week of shadow rows whose edges agree with the coordinators' own `gh pr checks --required` outcomes on the same heads (a shadow `green` row before each enqueue the coordinator made at that head, and a shadow `red` row before each fix round sent from `merging`). The arm is the operator's act.

## 11. Later (separate spec, needs operator rulings)

Rev 2 designed the following on top of the checks mail. The orchestrator's ruling moved them out of this spec. None is built by this plan, and none may be added to it without a new spec and the rulings below.

- **A server-armed enqueue.** A server-only ccd verb, `pr-enqueue --expect <token> …`, that runs exactly `gh pr merge <n> --match-head-commit <head>` (never `--admin`, `--auto` or a method flag) for a run whose claimant advanced it to `merging`, on two sightings of the same green token, one per pass fleet-wide, with numbered attempts bracketed by run re-reads under `coordMutex`, a send-back or close refused while one is in flight, and orphaned attempts resolved by a read. It would need protection everywhere the destructive verbs have it (the direct-entry guard, `is_protected`, both copies of the children's deny list, both hook lists, `FORBIDDEN_CCD_VERBS`, a SAFETY line).
- **The queue read-back.** The verb reading the entry back after its act, and disarming an armed request with no entry, after its act and on entry.
- **Merge proof by the server.** `merged:` carrying `proved:` (MERGED, `headRefOid` equal to the verified head), `merged-unproven:` otherwise, with exactly one writer of the merged notice per run.
- **Ejection-cause classification and re-queue.** The removal reason as a closed word; a read-only `ccd pr-ejection` reading the queue's own `merge_group` run, its jobs and bounded FAIL/timeout records; `ejectionVerdict` over a reviewed `LANDING_FLAKE_SIGNATURES` table; a re-queue once per head on a known flake; a fenced cause in the `dequeued:` body.
- **The hook deny and the attribution.** The advance to `merging` attributed through `attributionVerdict` against `run.claimedBy` and recorded as `merging-by:<id>`, refused `409 not-claimant` otherwise, `ccrc-api` filling `byId`/`byUuid`, and the session hook denying the advance to held and child sessions.
- **Stacked-PR detection and restacks.** A head-only binding for detection, `stacked:`/`restack:` mails, and any server-side `rebase --onto`, force-push or restamp.
- **Mode-dropped notices.** A `mode-dropped` mail per arm when a mode a coordinator was told `live` drops after its turn ended. Stage 1 does not need one, because an episode's mode is fixed (§3.7) and its stuck bound needs no ccd call (§3.8).

**The operator's questions for that spec**, as rev 2 asked them, each with its recommendation:

1. **Does a server-armed enqueue reverse R5, and what is left of the risk?** R5 says "no timer holds MERGE authority", and parent §13 lists "an unattended lander" as out of scope. **Recommendation: rule it an amendment of R5, not a reversal.** The coordinator stays the lander of record, and the server performs only the mechanical enqueue it ordered, on route Q (the native queue, which re-tests before it merges) only: never a direct merge, never `--admin`, never a self-claimed, held or child claimant, never an advance not attributed to the claimant.
   - **(a) The remaining risk.** Attribution is not authentication: every session reads the box token and every `.uuid` (`ccd/ccrc-api` ≈:511-513), so a hostile session can forge the claimant's pair in a spelling the hook does not parse. Today that session can already run `gh pr merge` itself (the hook is "a contract the fleet honours, not an access boundary", `ccd/session-hook.sh` ≈:4056), so the server adds no capability a hostile session lacks; it becomes the actor of record. Green required checks, the queue's re-test, one enqueue per pass and the merged mail still stand between a forgery and `main`. **Recommendation: accept it on the same threat model as wave 2's merge deny.** A real boundary (a per-session secret a session cannot read) is a separate ruling for the whole run API.
   - **(b) Held coordinators.** A hook deny of the advance cannot tell a self-claimed coordinator, or a reclaim heir that was the programme's own worker, from a worker, so those coordinators would ask the operator to advance and enqueue from their own shell. **Recommendation: accept it.** They already need the operator's shell for the enqueue.
2. **May a ccd verb run `gh pr merge` for the server?** It would be the first merge-class GitHub write the exec whitelist reaches (`pr-open` is the only GitHub write today, `whitelist.ts` ≈:456). **Recommendation: yes, under fixed limits:** a fixed argv, a token recomputed on the box under a lock, the disarm of any armed request, server-only in every place the destructive verbs are, composed by no route, refused to sessions.
3. **Stacked PRs: should ccrc read them, and may it force-push a session's branch to rebase and restamp one?** **Recommendation: (a) detection not now**, because coordinated waves rarely stack and a second binding is a second answer to "which PR is this workspace's"; **(b) no server-side restack.** Restack through a coordinator fix round with the worker's own `git merge` under worker clause 16. Revisit only with a temporary worktree (never the session's), `--force-with-lease` at the measured old head, a patch-id equality proof, an idle pane and a token. Sub-question: should a patch-id-equal restack keep the review? Recommendation: only once parent §5.4's lineage can prove it.
4. **The flake list and the re-queue budget.** **Recommendation:** seed `LANDING_FLAKE_SIGNATURES` with the measured removal causes (the `fleetws.test.ts` teardown race and the tick-diet shard's job timeout, both since fixed by wave 3c, as fixtures) and CLAUDE.md's known load flakes; re-queue at most once per head; a second ejection always mails; the table changes only by a reviewed PR.
5. **May the coordinator close on the server's merge proof?** **Recommendation: yes.** A `merged:` that says `proved:` needs no second `gh pr view`, because the close route re-measures the fingerprint anyway; `merged-unproven:` keeps today's proof by hand.
6. **Arming order.** **Recommendation:** the checks mail first (§10 S2); then the enqueue, after a week of `would enqueue` rows that each match a real enqueue the coordinator made at the same head, attributed to the same claimant; then the re-queue.
7. **Does `mode-dropped` go out under `landing-disabled`?** **Recommendation: yes**, as the one mail a disabled lane still sends, held by `mail-disabled`. If the operator wants total silence, the skill keeps a foreground fallback wait. (Stage 1's own form of this question is §10 S1, ruled yes.)

## 12. Out of scope and follow-ups

- Everything in §11.
- Workers' CI waits while `working` (worker clause 17 already forbids ending a turn without a wake). A `checks:` mail to the worker of a `working` run would reuse this lane whole. That is a separate ruling, because it changes the worker's loop.
- `ccrc-api mail list` parsers: the trailing `http NNN` is on stderr already (`ccd/ccrc-api` ≈:585). The follow-up is one documented machine form, so that coordinators stop writing their own parsers.
- The required/advisory split of the PWA's checks word, and the running-check fix in `checksFor` (parent §5.7.8, landing-order wave 3f).
- Direct-merge routes G and U, the landing line and lineage.

## 13. Review log

**rev 0 (2026-10-24).** Written against `origin/main` `10813b401`, the operator's fleet transcript audit of 2026-10-24, and the open PRs that hold the same files that day.

**rev 1 (2026-10-24).** Re-grounded on `origin/main` `7516cb0e3`. A review rejected rev 0; every finding was acted on (the migration slot, the observation writer's predicate, durable generations, `pr-enqueue`'s protections and argv order, budgets, the bracketed act, self-claimed runs, stacked PRs, the measured bound PR).

**rev 2 (2026-10-24).** Re-grounded on `origin/main` `30f9bdc9f`. A review rejected rev 1; every finding was acted on (the attributed advance, the sticky queue word, numbered attempts, the `open-run` member, mode drops, fingerprinted generations, the ring pin, the child deny list, one merged-notice writer).

**rev 3 (2026-10-24).** Re-grounded on `origin/main` `7a3104abd`. The orchestrator's ruling re-scoped the spec to stage 1, and its review found one issue in rev 2's stage 1. Acted on:
- **Stage 1 only.** The checks mail and the coordinator's ended turn stay. The server-armed enqueue, the queue read-back, the server's merge proof, the ejection cause and re-queue, the hook deny and attribution, stacked-PR detection and restacks, and `mode-dropped` moved to §11, with rev 2's Q1 to Q7 and their recommendations. Nothing this spec adds writes to GitHub or touches a branch (§7).
- **The (run, head) key.** Rev 2 keyed generations, the stuck clock and the told mode on (run, head), so a run sent back and re-advanced at the same head inherited its old settled edges and its old stuck clock, and could miss the green of its second episode. Every row is now keyed on the episode, the `run_events.id` of the advance's own transition row (§3.1), and the observation writer's `merging-episode` member refuses a write for any episode but the current one (§3.5).
- **No migration.** `runs.mergingHead` is gone. The head and the mode are the transition row's `detail`, written by the one writer that makes the transition (§3.1, §4).
- **No `mode-dropped`.** An episode's mode is fixed at its advance, and its stuck bound needs no ccd call, so a coordinator told `live` always hears something (§3.7, §3.8, §10 S1).
- **The fallback wait.** The skill reads one capability token, `checksMail: 'checks-mail-v1'`, on the advance answer; without it, today's foreground `--watch` text stands (§3.7, §5).
- **`stuck` and `moved` stay.** The ruling keeps the pending-to-green and pending-to-red edges. A coordinator that ended its turn also needs a bound for a check that never settles and a word for a head that moved, or it can wait forever, so both are kept as `checks:` words (§3.2, §3.5, §3.6).
- **Wave 3f stays with its programme.** Rev 2's PL-1 changed `checksFor`; stage 1's verdict applies the running-check rule to its own read and leaves `checksFor` alone (§1.3, §3.4).

**rev 4 (2026-10-24).** Re-grounded on `origin/main` `4910f4cff` (#1190 moved the advance route's gates to `coord/advance.ts`). A review found three issues in rev 3. Acted on:
- **`_pr_state_one` persists.** It hands its rows to `_pr_py state`, which locks, appends `.prhistory` and writes `prphase`/`prnumber`/`prcheckedat` under a compare-and-set, so rev 3's "read-only" verb would have been a second writer of every bound session's PR fields, without the answered-at stamp that ranks answers. `pr-landing` now binds through a new non-persisting `_pr_py bind` mode and a shared `_pr_bind_facts`, and a census pins that it writes no `$REG` file outside its cache (§1.3, §3.3, §7).
- **The re-entry path.** `RUN_TRANSITIONS` has no `working → merging` or `merging → merging` edge. Re-entry is written `merging → working → awaiting-review → merging` everywhere, and the skill's `moved` act sends the run back to `working` and re-advances through `awaiting-review` (§1.4, §3.1, §5).
- **A wait whose PR or workspace drops out.** Rev 3's population required a bound open PR, so a live episode whose PR was closed, made a draft or retargeted, or whose workspace left the registry, heard nothing. The population is split: the owed set (every open live or shadow episode at `merging`) gets the bound; the read set (registry workspaces) gets edges, `moved` and a new closed word, `left` (§2 goal 5, §3.2, §3.5, §3.6, §7).

**rev 5 (2026-10-24).** Still on `origin/main` `4910f4cff` (no newer commit that day). A review found one issue in rev 4. Acted on:
- **The bound after a settle.** Rev 4 owed `stuck` only to an unsettled generation, and a new generation opens only when the lane reads a pending check or a changed fingerprint. So a live episode mailed `red`, whose coordinator reran and ended its turn, heard nothing once `landing-disabled` was created, `pr-landing-v1` went away or the workspace left the registry: generation 0 stayed settled `red`, and the rerun's green was never read. A `red`-settled generation now owes one `stuck` 45 minutes after its red edge row if the run is still at `merging` and no next generation has opened, with cause `timeout` when the lane reads and `disabled` or `unmeasured` when it does not (§3.5, §3.6, §3.8). A settle after an unsettled `stuck` opens the next generation, so that red owes its own bound (§3.5). Goal 5, §7, §9's rollback and S1 now say exactly that.
- **Green with exit 8.** A green-settled generation owes no bound, because its act is the enqueue. The one green branch that does not enqueue, exit 8, now goes back to today's foreground `--watch` text for the rest of the episode instead of ending the turn (§5).

**rev 6 (2026-10-24).** Still on `origin/main` `4910f4cff`. A review found two major and five minor issues in rev 5, and the orchestrator ruled both majors and §10's S1 and S2. Acted on:
- **The latch outlived the bound.** Rev 5's latch spared every pass whose verdict and fingerprint matched, so hung CI read the same `pending` (or the same `red`) forever and the 45-minute bound never folded. Each latch entry now carries its generation's due time, computed once from the rows, and a pass at or past it reads and folds anyway (§3.5).
- **Nothing followed an unsettled `stuck`.** Rev 5 opened a next generation after a `stuck` only on a settle, so a rerun that hung too was never bounded. Per the ruling, a running read after a not-running `stuck`, or a changed fingerprint, opens `<gen+1>:open`, which owes its own bound; the `stuck` row records its reading so that the same hung wait opens nothing (§3.5). §5's `stuck` branch says when the coordinator ends its turn.
- **The 100-PR window.** `pr-landing` read the project-wide `gh pr list` window, so a landing PR older than the newest 100 dropped out and read as `left`. The lane now names each session's own PR, and ccd reads it by number in the same GraphQL alias; the `gh pr list` call is gone, and the budget falls to 14 s of 25 s (§3.3, §9).
- **Statuses in the fingerprint.** A status's `createdAt` changes on its own final post, so a red with a status still pending mailed the same red twice. The fingerprint covers check runs only (§3.3, §3.4).
- **An unlistable registry.** The advance maps it to `off`; the lane makes no read and folds `stuckOnly` with cause `unmeasured` (§3.7, §3.8).
- **Names.** The advance answer gets its own type, `AdvanceOk` (§1.4, §4), and `pr-landing`'s line is `PrLandingLine`, because `coord/landing.ts` already exports a `LandingLine` (§1.3).
- **§10 ruled.** S1 yes; S2 after a week of agreeing shadow rows.
