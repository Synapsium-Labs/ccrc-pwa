# PR landing in ccrc: the checks mail, a server-armed queue entry, the ejection cause and the coordinator's ended turn

**Spec** · 2026-10-24 · Status: draft for review, rev 2. Nothing in it is ruled yet: §10 holds the questions only the operator can answer, each with a recommendation · Owner: the ccrc coordinator · Deviation: D-6773 (issued by the ledger) · Plan: `docs/superpowers/plans/2026-10-24-pr-landing-in-ccrc.md`

**Related:** `2026-09-23-landing-order-and-main-churn-design.md` (the parent: R5 "no unattended lander", §4's roles table, §5.2's dequeue and merged notices, §5.4's lineage, §5.7's landing route and §5.7.8's checks word, §11 items 3, 4, 6 and 11), `docs/superpowers/programs/landing-order.md` (the proof-run readings and waves 2b, 3e, 3f, 4 and 5), `docs/superpowers/plans/2026-10-20-landing-order-wave3c-task7-rerun-preconditions.md` (two suite flakes the queue turned into removals), `2026-09-29-worker-stall-watch-design.md` (observation rows, shadow rungs, arming markers), `2026-10-17-coordinator-first-routing-design.md` (D-5298: the claim lanes' attribution and `ccrc-api`'s identity fill), `2026-10-19-ccrc-consolidation-wave-design.md` (K12 switches), `2026-10-23-fleet-disk-retention-design.md` (the token-twice rule, the privileged direct entry and the shadow-first shape this spec reuses), open PR #1127 (landing-order wave 3e, the landing route in the skill).

## In short

Coordinators spend a quarter to nearly half of their own tokens waiting. The biggest single wait is CI on a PR they are landing. The skill tells them to block on `gh pr checks --required --watch` and to re-issue it when it times out, because "no mail comes when checks finish". The server already reads every open PR every 30 to 120 seconds. It just never says when a required check finishes. This spec moves that wait into ccrc in four stages, each shipped in shadow behind a marker with no writer:

- **Stage 1, the checks mail.** For a run waiting at `merging` at a head its coordinator verified, the server reads the REQUIRED checks of that head, not the whole rollup. It mails the run's coordinator once per settle: `checks:#<pr>:<gen>:green@<head7>` or `checks:#<pr>:<gen>:red@<head7>`. A generation is keyed on the required contexts' own check-run ids, so a rerun that goes red between two reads is still mailed. A required check that never reports, or a read that never answers, ends in one `stuck` or `unmeasured` mail after a bound. Every fact the edge needs is a durable row, so a restart neither repeats a mail nor loses one. Check names come from GitHub and anyone who can write a workflow controls them, so they are bounded, reduced to a fixed character set, and fenced as untrusted data.
- **Stage 2, a server-armed queue entry.** The advance to `merging` becomes attributed: the caller's id and uuid are checked against the registry and against the run's `claimedBy`, and the transition row records who made it. Once the run's own claimant (not self-claimed, not held, not a child) has advanced it to `merging` at a verified head, and that head's required checks are green, the server enqueues the PR through a new server-only ccd verb. The verb runs `gh pr merge <n> --match-head-commit <head>` with a fixed argv, never `--admin`, `--auto` or a method flag. It reads the entry back, disarms a request that only armed, and proves the merge (MERGED, `headRefOid` equal to the head the coordinator verified). Each attempt is numbered and every attempt ends in a recorded answer, even after a restart. The coordinator is mailed only on red, on a stop, on a dequeue (with its cause) and on the merge. This changes parent ruling R5, so it waits on §10 Q1 and Q2.
- **Stage 3, the ejection cause.** When the queue removes a PR for failed checks, a separate read-only ccd verb reads the queue's own `merge_group` run and returns failing jobs and test names as bounded, structured data. The server classifies them. A known-flake signature is re-queued once per head. Anything else is mailed with the failing test names, sanitised.
- **Stage 4, the skill.** When the advance to `merging` answers that a stage is live for this run, the coordinator ends its turn. Mail wakes it. If a live mode later drops (a marker removed, `landing-disabled`, a ccd rollback), the server mails `mode-dropped` once, and the coordinator goes back to today's wait.

A stacked PR (one whose base is not the default branch) is never bound to its workspace today, so it cannot reach any arm of this spec (§6). Whether ccrc should rebase and restamp a stacked child server-side is a force-push of a session's branch, so it is §10 Q3, with a recommendation not to do it now. Every arm acts only on a run the server owns, attributed to that run's claimant, and no session can run the new verb (§7).

## 1. The problem, measured

Code citations are to `origin/main` `30f9bdc9f`. Line numbers are hints, written `≈:`, and each names its function.

### 1.1 What the fleet spends on waiting

The operator ran an audit of fleet transcripts on 2026-10-24: 7 days, 483k model turns, weighted by price.

| Activity | Share of fleet spend |
|---|---|
| Explicit polling, all kinds | ~7.5% |
| CI and PR polling (`gh pr checks` loops, `--watch` re-issued after a timeout) | 3.8% |
| `ccrc-api mail list` / fetch / ack | 2.5% |
| `sleep` loops | 0.9% |

Coordinators spend **25 to 44% of their own tokens** polling. The audit also found more than 20 distinct ad-hoc parsers of `ccrc-api mail list` output, many of them stripping the trailing `http NNN`. The CLI prints that line on stderr (`ccd/ccrc-api` ≈:585), and callers that merge the two streams see it last. That parser sprawl is a follow-up (§11). It matters here because every wait this spec removes is also a mail-polling loop that no longer runs.

### 1.2 What the skill tells a coordinator to do

`ccd/coordinator-skill/references/wave-lifecycle.md` ≈:777-838, "Landing on a native-queue project":

- Enqueue only a PR whose required checks have all passed: `gh pr checks <pr> --required` exits 0 (8 is pending, 1 is failed). For any other PR, gh arms auto-merge instead and prints the same line.
- **On `8`, "wait for them in the foreground — `gh pr checks <pr> --required --watch`, again if the call times out — never by ending your turn: no mail comes when checks finish"** (≈:786-791).
- Then enqueue with `gh pr merge <pr> --match-head-commit <handoffCommit>`, read the entry back with a GraphQL query, disarm what only armed, and end the turn. `merged:#<pr>` or `dequeued:#<pr>@<time>` wakes it.
- On `dequeued:`, read why from the queue's own run: `gh run list --event merge_group …`, then `gh run view <id> --log-failed`.
- For a send-back from `merging`, the text says to disarm auto-merge. It does not say to dequeue an entry, because today the coordinator made the entry itself and knows it is there.
- A coordinator whose own workspace carries a programme-wave hold or the child marker (a self-claimed run's, or a reclaim heir that was the programme's own worker) is refused its enqueue by the session hook. It asks the operator to enqueue from their own shell, and waits at `merging` (≈:832-838).

Clause 7 of `SKILL.md` (≈:76) says "This session does not poll in a loop." The `--watch` instruction is the one sanctioned poll, and it holds a whole coordinator turn open for the length of a CI run. Clause 15 (≈:84) carries the enqueue spelling. `server/test/coordinator-skill.test.ts` pins both verbatim.

### 1.3 What the server already reads, and what it says

- **`sweepPr`** (`server/src/watch.ts` ≈:8235): one `ccd pr-state --project` per project. It runs every `PR_SWEEP_MS` = 120 s, or `PR_SWEEP_ACTIVE_MS` = 30 s while any open PR reads `pending` (≈:537-538). It stores per session the phase (`merged` among them), the CI rollup word and failing names (`prStates`, ≈:1007) and the merge-queue word (`prQueues`, ≈:963). Its last two steps are `sweepMerged` and `sweepLanding` (≈:8337-8338). Both are synchronous.
- **The rollup is the whole set.** `checksFor` (`server/src/prstate.ts` ≈:165-176) folds every entry of `statusCheckRollup`, required or not, into one word. It bounds failing names to 10 at 120 characters each, but keeps their characters. ccd fetches the rollup through `gh pr list --json number,statusCheckRollup` (`_gh_pr_checks`, `ccd/ccd` ≈:5638), which carries no `isRequired`.
- **The word is wrong for running checks.** gh writes a queued or running check run with `conclusion: ""`. `stateOf` keeps the empty string, because `??` skips only null and undefined, so a running check reads `pass` (parent spec §5.7.8, measured on #1010). The fix is ruled as landing-order wave 3f and is not yet planned (`landing-order.md`, Waves row 3f).
- **A non-required red reads `fail`** (measured on #1068 with every required check green). No gate reads the word today (§5.7.8).
- **The queue word is sticky after a removal.** `_pr_queue_py`'s `word` (`ccd/ccd` ≈:40330-40345) reads only the PR's state, whether an entry stands, and its LAST queue act. An OPEN PR whose last act is a `RemovedFromMergeQueueEvent` (any reason but `merged`) answers `dequeued`. It keeps answering `dequeued` through a fix round and a re-advance at a new head, until a new add. So the queue word cannot tell "removed and fixed, ready to enqueue again" from "removed a moment ago". It is right for what it serves (the dequeue notice is keyed on the removal's own time), and wrong as a gate on a new entry.
- **`sweepLanding`** (`watch.ts` ≈:8616, every decision in `server/src/coord/landing.ts`) mails a run's coordinator only two things: `dequeued:#<pr>@<time>` when the queue word reads `dequeued`, and `merged:#<pr>` when the phase reads `merged` while the run waits at `merging` (`landingVerdict`, `landing.ts` ≈:129-141). It announces. It never enqueues, merges or re-runs (R5). It does not carry the removal's reason: `_pr_queue_py` (`ccd/ccd` ≈:40280) reads it only to tell `landed` from `dequeued`. Its once-only latch, `landingNotified` (≈:976), is in memory, and every rollout restarts the server (≈:973), so its durable reads (`hasMailWithSubject`, `hasNotice`) are what keep a notice single. Its `defer` step logs a warning on every pass (≈:8663).
- **The binding is base-exact.** ccd's `bound()` (`ccd/ccd` ≈:5806-5811) and the server's `boundRow` (`prstate.ts` ≈:147) bind a PR to a workspace only when `isCrossRepository` is false, `headRefName` is the registry branch, the PR is `ours`, and `baseRefName` equals the registry base. The registry base is `origin/HEAD` at the workspace's creation (`ccd/ccd` ≈:7407, written ≈:7596). A PR whose base is any other branch is never bound.
- **The observation writer refuses a second row with the same detail.** `insertStallObservation` (`server/src/coord/store.ts` ≈:2648) answers `duplicate` for any `(runId, detail)` already in `run_events` (≈:2657-2660). That is the stall lane's restart-proof dedupe. A key that must be written more than once for the same run and head therefore has to carry its own counter.

### 1.4 Who can advance a run to `merging` today

- **`POST /api/runs/:id/advance`** (`server/src/coord/routes.ts` ≈:1792-1907) is gated by the box token alone (`requireMailToken` ≈:611, called ≈:1794). Every session's `ccrc-api` reads that token and sends it (`ccd/ccrc-api` ≈:571). The route reads no caller identity. It checks the transition table, the review pair on `→ working`, the cap, and on `→ awaiting-review`/`→ merging` the fingerprint (`verifyDone` ≈:1871-1888). It checks no clean review before `merging`. Then it calls `coord.advance(id, to, 'coordinator')` (≈:1893): `causedBy` is the literal `coordinator` whoever called.
- **The claim lanes do check identity.** `attributionVerdict` (`routes.ts` ≈:643-672) reads the registry and refuses `unknown-sender` or `stale-uuid` unless the caller's `{id, uuid}` matches that id's `.uuid`. `POST /api/runs` uses it for `claimedByUuid` (≈:1441), and `ccrc-api` fills that uuid from the caller's own pane for `runs open` only (`ccd/ccrc-api` ≈:497-526, `derive_identity` ≈:282-302). The runs table keeps `claimedBy` and migration 23's `unattributed` flag, not a uuid.
- **What stops a worker is prose.** The worker skill says "The run routes belong to the coordinator; a worker never advances or closes a run" (`ccd/worker-skill/SKILL.md` ≈:164-165). No hook deny covers `ccrc-api runs advance`. The hook does deny `ccrc-api approvals` to a dispatched child (`ccd/session-hook.sh` ≈:4493, the reason ≈:4703), so the shape exists.
- **Identity is attribution, not authentication.** `ccrc-api`'s own comment: "every `.uuid` is readable by the one UNIX user these sessions share, so this stops a confused session, not a hostile one" (≈:511-513). The hook says the same of itself: "a contract the fleet honours, not an access boundary" (`session-hook.sh` ≈:4056).
- **The run does not record the head the coordinator verified at `merging`.** The route re-measures the fingerprint on the way to `merging` and stores nothing of it. `runs.handoffCommit` is written once, at close (`setHandoffCommit`, `store.ts` ≈:3169).
- **An advance can reach `merging` with no bound PR.** `verifyDone` compares PR numbers only when the claim names one (`server/src/coord/fingerprint.ts` ≈:293), and a claim of `prPhase: 'none'` measured `none` is not a regression (`prVerdict` ≈:80-86).

Today none of this matters for merge authority: an advance to `merging` makes nothing happen on GitHub. Stage 2 makes it the trigger of an enqueue, so stage 2 cannot ship until the advance is attributed (§4.1).

### 1.5 What the proof runs measured

From the landing-order ledger (`docs/superpowers/programs/landing-order.md` ≈:645-810), on this repository:

- A deliberately wrong `--match-head-commit` sha is refused ("expected head oid does not match the current head oid"), and nothing is queued or armed. Measured twice.
- An enqueue while required checks run answers rc 0, prints nothing without a TTY, and **arms auto-merge instead of queueing**. A later push from the same login leaves it armed. So the read-back and the disarm carry weight: an armed request lands whatever head the branch carries once checks pass.
- Entries read back non-null within about 2 s. Queue landings ran about 15 minutes apart at group size 1.
- `merged:#942` woke its coordinator 3 min 10 s after the merge. `merged:#963` was sent 1 min 19 s after its merge but read hours later, because the coordinator was waiting on the operator.
- Two suite flakes turned into queue removals before wave 3c fixed them: an `ENOTEMPTY` teardown race in `fleetws.test.ts`, and the tick-diet shard hitting its 30-minute job bound (wave 3c plan ≈:95-104). Removal reasons seen: `failed_checks`, `manual`, `merge_conflict`, and `merged` at every successful queue merge.

### 1.6 The authority line today

Parent ruling R5: "No unattended lander … No timer holds MERGE authority" (parent §3). Parent §4: the server may not "run git or `gh`" (`EXEC_COMMANDS` stays `['tmux','ccd']`, `agent/src/whitelist.ts` ≈:220). `gh` is in `FORBIDDEN_COMMANDS` (≈:232), because one `gh` grant would make the whitelist "the sole control between the PWA and `gh pr merge`". ccd already performs one GitHub write for the server, `pr-open` (`ccd/ccd` `cmd_pr_open` ≈:11222, granted `['pr-open','--session']`, `whitelist.ts` ≈:456). No ccd verb merges or enqueues.

The session hook denies `gh pr merge`, in every spelling it can parse, to a session whose hold names a programme wave and to any workspace carrying the child marker (`ccd/session-hook.sh` ≈:3963-3980). That includes a coordinator of a self-claimed run (`POST /api/runs` admits a claimant that is its own session) and a reclaim heir that was the programme's own worker (≈:4056-4065). The hook cannot tell those coordinators from a worker, so the lifecycle reference sends them to the operator's shell.

## 2. Goals and non-goals

**Goals.**
1. No coordinator turn stays open waiting for CI on a PR it is landing.
2. The "checks finished" fact has one producer, the server, and one consumer, the run's coordinator.
3. The decision about a landing stays where it is today: the run's claimant rules, at a head it verified. Stage 2 removes only the mechanical enqueue. It acts only on an advance to `merging` that the server attributed to the run's claimant and recorded as such (§4.1). It never acts for a claimant the hook would refuse a merge to.
4. Every string GitHub supplies reaches a model only bounded, reduced and fenced.
5. A coordinator that ended its turn on a live answer always hears something: across restarts, across a send-back race, and across any later drop of the mode it was told (§3.8).

**Non-goals.**
- Workers' own CI waits while a run is `working`. They are a follow-up (§11).
- Direct merges (parent §5.7 routes G and U). The server never merges synchronously. Stage 2 is route Q only, the native queue, which re-tests before it merges.
- The landing line (parent stage 5) and lineage (stage 4). §8 says how this spec meets them when they land.
- Stacked PRs, beyond saying why none reaches an arm (§6).
- Attributing the advances to `working` and `awaiting-review`. Only `merging` triggers an act, so only `merging` is gated here (§11).
- Any repository setting, ruleset or protection write.

## 3. Stage 1: the checks mail

### 3.1 Who is told

The population is open runs at `merging` with `mergingHead` set (§4.1), whose `sessionId` names a registry workspace with a bound PR (`ours`, the `boundRow` rule), and whose bound PR's head equals `mergingHead`. The run's coordinator is the recipient, through `resolveCoordinator(runId)`, sent from the `operator` role like the landing lane's notices. Any other PR is not read by this arm. A hand merge, a closed run, a stacked PR (§6) or a PR with no run is never mailed about.

A bound PR whose head differs from `mergingHead` (someone pushed after the advance) is not a landing candidate. The lane mails `landing:#<pr>:head-moved@<head7>` once per (run, head), and the coordinator sends the run back to `working` or advances again at the new head.

### 3.2 The read: `ccd pr-landing`

A new read-only verb answers for the landing population of one project in one call:

    ccd pr-landing --project <project> --sessions <id>[,<id>…]

For each session it names, it binds the PR exactly as `pr-state` does and prints one JSON line. Per call, in this order:

| # | Call | ccd timeout | When |
|---|---|---|---|
| 1 | `gh pr list` rows, the input `_pr_state_one` binds from | `PR_GH_TIMEOUT` = 8 s (existing) | every call |
| 2 | one GraphQL query, one aliased `pullRequest(number: N)` per bound PR, plus `repository { autoMergeAllowed, defaultBranchRef { name } }` | `PR_LANDING_GQL_TIMEOUT` = 6 s | every call |
| 3 | `repos/{o}/{r}/rules/branches/<base>` | `PR_LANDING_REST_TIMEOUT` = 4 s | cache miss |
| 4 | `repos/{o}/{r}/branches/<base>` (the public branch view) | `PR_LANDING_REST_TIMEOUT` = 4 s | cache miss |

The worst case is 8 + 6 + 4 + 4 = 22 s. The runner budget `CCD_VERB_TIMEOUT_MS['pr-landing']` is 35 s, so the calls take at most 63% of it and `_pr_state_one`'s per-workspace loop keeps the 30% reserve `pr-timeout-budget.test.ts` already requires of `pr-state` (`LOCAL_LOOP_RESERVE`). The pin reads every number from its source (plan PL-4). The verb runs outside `coordMutex`, so its length delays only the landing lane.

- **The GraphQL read.** The numbers are integers ccd read from its own binding. They are checked against `^[1-9][0-9]{0,8}$` and passed as `-F` integer variables, never interpolated text. A value of digits only cannot take `-F`'s `@file` form, which is why `_pr_queue_py` avoids `-F` for strings. For each PR it reads `state`, `isDraft`, `baseRefName`, `headRefOid`, `mergeStateStatus`, `autoMergeRequest { enabledAt }`, `mergeQueueEntry { state }`, the last queue act with its `reason` and time, and the head commit's `statusCheckRollup.contexts`. For each context it reads `__typename`, `name`/`context`, `status`, `conclusion`/`state`, the check run's App id, `isRequired(pullRequestNumber: N)`, and two ids: **`checkId`**, the check run's own `databaseId` (a new check run, and so a new id, for every attempt, `--failed` reruns included), or for a commit status its `createdAt`; and **`runId`**, the workflow run's `databaseId` (the same across attempts), which the rerun spelling names.
- **The base's required set by name**, reads 3 and 4 (parent §5.7.1 reads 2 and 3b), with plain read access. They are cached for 600 s in `$REG/pr-landing/<project>.rules.json`, a dotless registry subdirectory (the pools rule in CLAUDE.md). An unreadable cache is a miss, never a hit. `allow_auto_merge` rides the GraphQL read, so no third REST call is needed.

`isRequired` sees only checks that have reported. The rules read is what makes a required check that has not reported visible. That is the case parent §5.7.3 calls **not reported**: "an empty list means nothing has reported, never a pass".

**Why a new verb and not a fourth call in `pr-state`** (the "legitimately different" record CLAUDE.md asks for): `isRequired` takes the PR number as an argument, so it cannot ride the project-wide window `_gh_pr_checks` reads. `pr-state --project` already spends 17 of its 25 s budget (`ccd/ccd` ≈:5436-5470 and ≈:40239, pinned by `pr-timeout-budget.test.ts`). And this read is needed only for the handful of runs at `merging`, not for every open PR on the phone. The binding is shared, not copied: both verbs bind through `_pr_state_one`.

GitHub-sourced text is handled as `_pr_queue_py` handles it: documents travel on stdin and numbered file descriptors, never in an argv or a shell word. ccd bounds each name to 120 bytes and each list to 32 entries, and says when it cut.

### 3.3 The required verdict

One pure function, `requiredChecksVerdict`, in `server/src/coord/landing.ts` (L1, C4), reads the line. The required set is the union of (a) contexts marked `isRequired`, (b) every `required_status_checks` rule's names from the rules read, and (c) the branch view's `protection.required_status_checks` contexts. Each name takes one state, exactly as parent §5.7.3's table defines them:

| Word | Meaning |
|---|---|
| `green` | every required name is passing on the head (`success`, `neutral` or `skipped`, or a status `success`), from the named App where one is named |
| `red` | at least one required name is red (any other completed conclusion, or a status `failure`/`error`) |
| `pending` | none is red, and at least one is running or `pending` (a check run with an empty `conclusion` is running, which is the 3f fix applied here) |
| `not-reported` | none is red or running, and at least one required name has no context at all |
| `unverifiable` | a required name pinned to an App shows only as a commit status, which carries no App id (a parent §5.7.5 stop) |
| `unmeasured` | the read did not answer, or answered a shape this build does not know |

The set is never empty by default. A repository with no required checks reads `green` only when all three sources answered and named none. That is route U's empty set in parent §5.7.4, and stage 2 never serves it.

The verdict also answers the **fingerprint** of the read: the first 12 hex of sha256 over the sorted `name=checkId` pairs of the required contexts that have reported. Two reads of the same attempts have the same fingerprint, and any rerun, re-request or new status changes it.

### 3.4 The edge, written down

Every fact the edge needs lives in `run_events` rows, never only in memory, because every rollout restarts the server. Per (run, head) the lane reads its rows, whose detail is `landing:checks:<head>:<gen>:<what>`, and an edge row's detail ends `@<fp12>`, the fingerprint of the read that settled it:

- **`<gen>:open`** opens a generation and carries its start in `at`. Generation 0 opens at the run's own transition into `merging` at this head: the lane writes `landing:checks:<head>:0:open` on its first sighting with `at` copied from that transition's `run_events` row, not from the sighting.
- **The generation** is the count of `open` rows for (run, head), minus one. It is derived from the rows on every pass, never counted in memory.
- **`<gen>:green@<fp>` and `<gen>:red@<fp>`** are the edges. A move from unsettled (`pending`, `not-reported`, `unmeasured`, or no row yet) to `green` or `red` writes one, and an edge mails once.
- **A settled generation opens the next one** on any of three readings, with `at` the sighting:
  1. it reads `pending` or `not-reported` (a rerun the lane saw running);
  2. its fingerprint differs from its edge row's (a rerun, or a re-requested suite, that started and finished between two reads);
  3. it reads the other settled word (red to green, or green to red, with no running read between).
  In cases 2 and 3 the reading is already settled, so the same pass writes `<gen+1>:open` and `<gen+1>:<word>@<fp>` and mails the new edge. A rerun of a short job that goes red, running and red again inside one 120 s gap is therefore mailed `:1:red`, and a red that turns green with no running read is mailed `:1:green`.
- **`<gen>:stuck`** is written when the generation is still `pending` or `not-reported` `LANDING_CHECKS_STUCK_MS` (45 min: the CI job bound is 30 min) after its own `open` row's `at`. **`<gen>:unmeasured`** is written when every read for that long answered `unmeasured`. Each mails once per generation. A rerun opened long after the advance therefore gets its own 45 minutes, and restarts cannot reset the clock, because the clock is a row.
- **`<gen>:unverifiable`** is written and mailed at once, because it is a stop and waiting will not change it.
- **A green edge is written but not mailed** when the PR already reads queued, armed or merged, judged on `pr-landing`'s own fresh `entry`, `autoMerge` and `state` facts, never on the sweep's queue word (§1.3). The coordinator acted on its own read, and the mail would be noise. It is also not mailed while the enqueue arm can act for this run (§4.4).

**Cadence.** One `pr-landing` call per project per pass: every 30 s while any of the project's heads is unsettled **or its last edge is red** (a coordinator's rerun follows a red), and every 120 s once every head's last edge is green or it has a stop. The fingerprint rule above is what makes the mail correct; the 30 s cadence after red only makes it quicker.

So, across a restart: a gen-0 red, a re-run and a second red mail twice (`:0:red`, `:1:red`), whether or not the lane saw the rerun running; a gen-0 red and a gen-1 green that was mailed are never mailed again; and a head pending forever mails `stuck` 45 minutes after its `open` row however often the server restarts. The in-memory latch only spares a head whose rows say nothing can change this pass a coord.db read, as `landingNotified` does.

**The writer.** Rows are written through the store's observation writer, generalised from `insertStallObservation` (`store.ts` ≈:2648). That writer today refuses any run whose state is in `INACTIVE_RUN_STATES_SQL` (≈:1114), which is the idle and terminal states, and `IDLE_RUN_STATES` includes `merging` (`shared/api.ts` ≈:4912). So the generalisation takes an explicit state predicate, a closed union of exactly three members:

- `{kind: 'active'}` (the stall lane's, unchanged): `state NOT IN INACTIVE_RUN_STATES_SQL`;
- `{kind: 'merging-at', head}` (the landing lane's rows and mails while the run waits): `state = 'merging' AND mergingHead = ?`;
- `{kind: 'open-run'}` (the landing lane's after-the-fact rows and mails, for a run that has moved): the run exists and `state NOT IN TERMINAL_RUN_STATES_SQL` (≈:1120). It is used by exactly three writers: the `enqueued-after-sendback` mail, the orphaned-attempt row (§4.3), and the answer row of an attempt whose run moved while it ran. Each names it at the call; nothing defaults to it.

A run that left `merging`, or was advanced again at another head, between the lane's read and a `merging-at` write records nothing and is mailed nothing (`run-gone`). A run that has closed (`done` or `failed`) fails all three. For the one fact that must still be said about a closed run (an entry the server made that still stands, §4.3), the lane pushes an operator feed record instead, through the path `landingVerdict` already uses for a dequeue with nobody to tell (`recordAlways`, a `dedupeKey`, `hasNotice` as its once-only read). No coordinator waits on a closed run, so no mail is owed.

**Row and mail together.** A mailed edge writes its row and queues its mail in ONE transaction, through `queueLandingNotice(coord, run, {detail, at, when, toId, subject, body})` in `server/src/coord/rundefsTx.ts`, beside and in the shape of `queueStallNotice` (≈:170). It takes the predicate as a parameter: the observation row under `when`, then `insertSystemMailTx`. A throw after the row rolls both back, so the next pass tries again. A duplicate row or a gone run writes no mail. Shadow rows and the unmailed green edge use the one-row form (`recordObservation`, the generalised `recordStallObservation`, ≈:2671).

### 3.5 The mail

Subject `checks:#<pr>:<gen>:<word>@<head7>`, kind `status`, from `operator`, to the coordinator, carrying the `runId`. The generation is in the subject, because the subject is what `hasMailWithSubject` dedupes on and a second red of the same head is a new fact. The body is built in one place, `renderChecksBrief` in `coord/landing.ts`:

- The facts the server owns: PR number, workspace id, the head, the run's state, the word, the generation.
- On `red`: the failing required names, after `landingCheckName` (below), inside `untrustedBlock` (`server/src/coord/untrusted.ts` ≈:48), with a preface that names GitHub as the source. That renderer is the one the ask and approval mails use, so the fence cannot be closed from inside. `untrusted.ts` imports nothing, so `landing.ts` may take it as a value import (plan PL-5 widens the ring pin to say so).
- The next act, spelled as the skill spells it: a fix round to the owning worker on `merging → working` for the PR's own red (undoing a server entry first, §4.3). For a red that is not the PR's own, one `gh run rerun <run id> --failed`, where the run id is an integer the server read.

**`landingCheckName`** (L1, pure) reduces a GitHub-supplied name before it enters any mail:
- NFKC-normalise it.
- Replace every character outside `[A-Za-z0-9 _.,:()/+#-]` with `?`. That removes backticks, control characters, newlines and bidirectional overrides.
- Collapse runs of whitespace, and cap it at 80 characters.
- Cap the list at 10 names, with a count of the rest.

A name is never an argv, a shell word, a subject or a file name. `checksFor` keeps its own bound for the PWA and is unchanged, except for the running-check fix if wave 3f has not landed by then (plan PL-1).

### 3.6 Shadow and arming

Until `$REG/landing-checks-live` exists, the arm writes `landing-shadow:checks:…` observation rows (same shape, same generations) and sends no mail. `$REG/landing-disabled` stops every arm of this spec, live or not, and wins over every live marker. It stops every read and act and every mail but one: the `mode-dropped` notice of §3.8, which is how a coordinator that was told `live` learns that nothing will wake it. Neither marker has a writer in the tree. Both are rows of `SWITCHES` (`shared/switches.ts`), owner C4. `mail-disabled` holds every mail rung of this spec, `mode-dropped` included, as it does for the stall watch.

### 3.7 What the coordinator learns at the advance

`POST /api/runs/:id/advance` to `merging` answers an additional, optional block:

    landing: { checks: 'live' | 'shadow' | 'off', enqueue: 'live' | 'shadow' | 'off' }

`landingModes` (L1) computes it from the markers, the ccd capabilities, this advance's own measurement and its attribution:
- Both words are `off` unless the advance's `verifyDone` measured a bound PR in phase `open`: `measured.prNumber` non-null and `measured.prPhase === 'open'`. A run that reaches `merging` with no bound PR, a draft, or a stacked PR (§6) is outside the arm's population, so the answer says so and the coordinator keeps today's wait.
- `enqueue` is also `off` unless the advance was attributed to the run's claimant (§4.1) and `selfClaimed(run, claimant)` answers false (§4.3), and unless the ccd answers `pr-enqueue-v1`.
- `off` also means `landing-disabled` stands or the capability is absent.

**The answer is recorded.** In the advance's own transaction, beside the transition, the store writes one row `landing:mode:<head>:<checks>:<enqueue>`. That row is what §3.8 compares against. The skill reads only the answer block, never the markers or the row. An older server sends no block, and the skill reads that as `off`.

### 3.8 A mode that drops after the turn ended

A coordinator told `live` ends its turn and waits for mail. Several things can silence the arm after that: `landing-disabled`, removing `landing-checks-live` or `landing-enqueue-live` (§9's own rollback), a ccd rollback (the capability is absent), or an agent without `pr-enqueue-v1`. Shadow writes rows only, so without a notice the coordinator would never hear anything again.

So on every pass, for every run at `merging` with a `landing:mode:<head>:…` row at its `mergingHead`, the lane computes the run's **effective mode** for each arm: the arm's marker AND its capability AND not `landing-disabled` (and for `enqueue`, the claimant still eligible). This needs no ccd call, so it runs even when `pr-landing` cannot. When an arm's recorded mode is `live` and its effective mode is no longer `live`, the lane mails `landing:#<pr>:mode-dropped@<head7>` once per (run, head, arm), keyed by the row `landing:mode-dropped:<head>:<arm>`, through `queueLandingNotice` under `merging-at`. Its body names the arm, the cause (`disabled`, `marker`, `capability`, `claimant`), and the act:
- for `checks`: go back to today's wait, `gh pr checks <pr> --required --watch`, then enqueue as today;
- for `enqueue`: read the entry back first (the server may already have made one), then enqueue or disarm as today.

A drop from a recorded `shadow` or `off` mails nothing: that coordinator never ended its turn. Under `mail-disabled` the notice is held without its row, so it goes once mail is enabled again. The notice is not retracted when the mode comes back: the coordinator has already gone back to today's wait, and the arm's later mails are harmless to a coordinator that is waiting in the foreground. A server rolled back to a build without this lane cannot send it. §9 says how a rollback avoids that.

## 4. Stage 2: the server-armed queue entry

**Gated on §10 Q1 and Q2.** If the operator rules no, stage 2 is dropped, stage 3 mails instead of re-queueing, and stage 4 keeps the coordinator's own enqueue. §4.1's attribution and head lands with stage 1 either way, because stage 1's population and its writer predicate read the head, and the attribution costs nothing to record.

### 4.1 The head the coordinator verified, and who verified it

**The head.** The advance to `merging` already re-measures the fingerprint (`verifyDone`, `handoffCommit === branchTip`, PR bound). The same transaction now records that head in a new nullable column, `runs.mergingHead`, written only by `advanceInner` (`store.ts` ≈:2559) on a move to `merging`. A move `merging → working` clears it. A new migration adds it: `MIGRATIONS[29]`, `user_version 29 → 30`, `ALTER TABLE runs ADD COLUMN mergingHead TEXT`, one nullable column and nothing else, in the shape of migration 29 (`server/src/coord/schema.ts` ≈:1765). `COORD_SCHEMA_VERSION` is `MIGRATIONS.length` (≈:1787) and moves with the array. The slot is re-measured before the PR and before merge, as `schema.ts`'s own comment instructs (`git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'`), because any coord.db migration that lands first takes it. `handoffCommit` keeps its one writer, the close. The server acts on `mergingHead` and nothing else. A coordinator that wants a different head goes back to `working` and advances again.

**Who verified it.** The advance to `merging` becomes attributed, in the claim lanes' shape:
- **The client.** `ccrc-api runs advance` fills `byId` and `byUuid` from the caller's own pane through `derive_identity` (`ccd/ccrc-api` ≈:282-302), under exactly the rules its `runs open` fill already follows (≈:497-526): a body that already names the pair is left alone (the route re-measures it, and the operator's shell has no pane), a blank one is refused, and no derivable identity sends nothing.
- **The route.** On a move to `merging` only, inside `coordMutex`, before `verifyDone`: a body carrying `byId`/`byUuid` is checked by `attributionVerdict(byId, byUuid, 'byUuid')` (`routes.ts` ≈:643), and refused `unknown-sender` or `stale-uuid` as the claim lanes are, transient words included. Then `byId` must equal `run.claimedBy`, or the advance is refused `409 not-claimant`. The run stores no uuid (only `claimedBy`, and migration 23's `unattributed`), so the uuid is checked against the registry's current `.uuid` of `byId`, which is the check every other attributed route makes.
- **The record.** An attributed advance passes `detail: merging-by:<byId>` to `coord.advance` (`advanceInner` already takes `detail`, ≈:2559, and writes it into the transition row, ≈:2575). `causedBy` stays `coordinator`, as today. A body with no pair (an older `ccrc-api`) is still accepted, because absence permits the advance as it always has, and its transition row carries no attributor. The advance answer then says `enqueue: off`, because absence forbids the act.
- **The reader.** `mergingAttributor(rows, head)` (L1, through PL-2's one detail reader) answers the attributor of the run's NEWEST transition into `merging`, or null. `enqueueVerdict` acts only when that attributor equals `run.claimedBy` at the moment of the act and `selfClaimed` answers false. An attributor is never inferred from `causedBy`.
- **The hook.** A session whose hold names a programme wave, or whose workspace carries the child marker, is denied `ccrc-api runs advance` when the command names `merging`, when it passes the body from a file (the hook cannot read the target then, so it fails closed for these sessions), and any direct request to `/api/runs/<id>/advance`. The deny sits beside the approvals deny (`session-hook.sh` ≈:4493) and reads the same hold and marker the merge deny reads (≈:3963-3980). Its reason names the worker clause and, for a coordinator in that position, the operator's shell.

The hook cannot tell a held coordinator from a worker (§1.6). So the deny's cost is that a self-claimed coordinator, or a reclaim heir that was the programme's own worker, can no longer advance its own run to `merging`. Today that coordinator already cannot enqueue (the merge deny) and the server will never enqueue for it (§4.3). Under this spec it asks the operator to advance and enqueue from their own shell, with the claimant's pair in the body. That is §10 Q1 (b).

### 4.2 The verb: `ccd pr-enqueue`

    ccd pr-enqueue --expect <token> --session <id> --pr <n> --head <sha>

`--expect` comes first, in `ws-reclaim`'s shape (`ccd/ccd` `cmd_ws_reclaim` ≈:36605), because the agent matches a grant by argv prefix (`isExecAllowed`, `agent/src/whitelist.ts` ≈:865, the prefix compare ≈:928), and the grant is `['pr-enqueue','--expect']`. It is server-only, like `ws-reclaim`. The token is what `pr-landing` printed for that session: a sha256 over the canonical facts the act depends on. Those are the session id, the registry branch and its tip, the repository, the PR number, base and head, `isDraft`, the queue rule and its single method, `autoMergeAllowed`, the required verdict, the entry and the auto-merge request. ccd does this, in order:

1. Takes the lock `$REG/locks/pr-enqueue-<id>`.
2. Re-reads every fact fresh (calls 1 to 4 of §3.2, no cache).
3. **An armed request with no entry, found on entry, is disarmed** with `gh pr merge <n> --disable-auto`, read back, and answered `armed-disarmed-on-entry`. Nothing is enqueued in that call. This is the case of a previous call killed between its `gh pr merge` and its own disarm, or of an arm nobody meant: an armed request lands whatever head the branch later carries once checks pass, so it is never left standing and never a reason to refuse without acting.
4. Recomputes the token from the fresh facts and refuses `state-changed` on any difference.
5. Refuses unless every one of these holds:
   - the PR is open and not a draft;
   - its base is the default branch;
   - its head equals `--head`, and equals the registry branch's local tip;
   - exactly one `merge_queue` rule applies, and `autoMergeAllowed` is true;
   - every required name is `green`;
   - there is no entry.
6. Runs exactly `gh pr merge <n> --match-head-commit <head>`. The argv is fixed in ccd: no `--admin`, `--auto`, `--squash`, `--merge` or `--rebase`, and no passthrough, the `cmd_pr_open` rule (≈:11222).
7. Reads the entry back. A non-null entry answers `queued`. A merged PR answers `already-merged`. An armed request with no entry is disarmed with `--disable-auto`, read back once more, and answers `armed-disarmed`. Anything else answers `not-queued`.
8. Answers one JSON line with a closed word. gh's own refusal text is classified into `refused:<word>` (`head-mismatch`, `auth`, `rule`, `other`) and is never echoed raw.

**The budget.** Every gh call has its own timeout, and the worst path is summed:

| Step | Call | ccd timeout |
|---|---|---|
| 2 | rows, GraphQL, rules, branch view (no cache) | 8 + 6 + 4 + 4 s |
| 6 | `gh pr merge --match-head-commit` | `PR_ENQUEUE_MERGE_TIMEOUT` = 10 s |
| 7 | read-back GraphQL | 6 s |
| 7 | `gh pr merge --disable-auto` | `PR_ENQUEUE_MERGE_TIMEOUT` = 10 s |
| 7 | second read-back | 6 s |

The worst path is 54 s (step 3's path is shorter: 22 + 10 + 6). The runner budget `CCD_VERB_TIMEOUT_MS['pr-enqueue']` is 80 s, so the calls take at most 68% of it, and the 30% reserve holds. A pin reads every number from its source (plan PL-9). If the agent still kills the verb between step 6 and step 7, the next call's step 3 disarms what it left.

### 4.3 The enqueue arm

The landing arms run as their own lane, `sweepLandingArms`, on their own schedule (a `LANE_SCHEDULE` row once LaneRunner has landed, #1200 and #1209), reading the records `sweepPr` last stored. They are not run inside `sweepPr`, so an 80 s act never delays the PR sweep.

**The population** is the checks arm's (§3.1), plus every run, in any non-terminal state, that has an unresolved attempt row (below). The second half is what keeps an act that a restart or a send-back interrupted in view until it is answered.

**The verdict.** For a run at `merging` with `mergingHead` set, `enqueueVerdict` (L1) asks for all of these:
- required verdict `green`, and the head equal to `mergingHead`;
- **from `pr-landing`'s own fresh line**: `state` OPEN, `entry` false and `autoMerge` false. It never reads the sweep's queue word, which stays `dequeued` after any removal (§1.3). A PR dequeued once, fixed and re-advanced at a new head is therefore eligible again;
- the run's newest transition into `merging` attributed to `run.claimedBy` (§4.1);
- `selfClaimed(run, claimant)` false, and the run's coordinator resolvable;
- no unresolved attempt at this head;
- the same token on **two consecutive passes**, the act-twice rule of the retention lanes.

**Never a self-claimed run.** `selfClaimed(run, claimant)` (L1, pure) is the one predicate `landingModes` and `enqueueVerdict` share. It answers true when `run.claimedBy === run.sessionId`, or when the caller-supplied claimant facts say `waveHeld` (the claimant's `SessionRecord.held`, `server/src/registry.ts` ≈:149, parses as a programme hold through `programmeHoldOf`, `coord/rundefs.ts` ≈:163) or `child` (`SessionRecord.child.kind !== 'none'`, ≈:405). The two booleans are computed by the L4 caller, so `landing.ts` never imports `rundefs.ts`, which holds the database handle (`landing.ts`'s own header, ≈:19-22). Those are exactly the coordinators the session hook refuses `gh pr merge` (§1.6), and the server enqueueing for them would bypass that deny. The verdict answers `stop:self-claimed`, mailed once, naming the operator's shell, as the lifecycle reference does. A claimant whose row cannot be read is `wait`, and three passes of it mail `landing:#<pr>:unsettled@<head7>`.

At most **one enqueue per pass, fleet-wide**. The queue serialises at group size 1 anyway, and a burst from many projects is still one act per pass. In shadow (no `$REG/landing-enqueue-live`) it writes `landing-shadow:enqueue:<head>:<n>` rows, and the coordinator enqueues as today.

**Attempts are numbered.** Each act is attempt `n` at its head, with rows `landing:enqueue:<head>:<n>:inflight`, `landing:enqueue:<head>:<n>:<answer>` and `landing:enqueue:<head>:<n>:orphaned`. `n` is the count of `inflight` rows for (run, head), derived from the rows on every pass, as generations are. An attempt is **unresolved** while its `inflight` row has neither an answer row nor an `orphaned` row. A `state-changed` retry, and a stage 3 re-queue at the same head, are each a new attempt `n + 1`. When the `inflight` write answers `duplicate`, the lane does not act: another pass already holds that attempt.

**The act, against a send-back.** The token covers GitHub's facts only, and the run's state lives in coord.db. So the act is bracketed by the coordination serialiser, through a new `CoordRoutesHandle` method in the shape of `withSweepAbandon` (`routes.ts` ≈:464-475):

1. Under `coordMutex`: re-read the run. Unless it is at `merging` with `mergingHead` equal to the head and the same attributor, do nothing. Otherwise write `landing:enqueue:<head>:<n>:inflight` under `merging-at`, and leave the mutex. A `duplicate` or `run-gone` answer ends the act here.
2. Compose `CCD_ARGV.prEnqueue` and run it, outside the mutex.
3. Under `coordMutex`: write the answer row `landing:enqueue:<head>:<n>:<word>`, and re-read the run. If it is still at `merging` at this head, the row is written under `merging-at`. If it moved, the row is written under `open-run`, and when the answer is `queued` or `armed-*`, the lane mails `landing:#<pr>:enqueued-after-sendback@<head7>` in the same transaction through `queueLandingNotice` under `open-run`. The mail names the undo: `gh pr merge <n> --disable-auto` for an armed request, and for an entry the GraphQL `dequeuePullRequest` mutation, which stage 4 adds to the lifecycle reference (today's text spells only the disarm, ≈:805-810, because today the coordinator made every entry itself). If the run has closed, `open-run` refuses it, and the lane pushes the operator feed record of §3.4 instead.

**A send-back or close while an act is in flight.** `POST /api/runs/:id/advance` from `merging` to `working`, and `POST /api/runs/:id/close` from `merging` (≈:1604), read the run's attempt rows inside the same mutex. An unresolved attempt younger than the verb's runner budget plus 10 s refuses `409 enqueue-in-flight` with `retryAfterS`. An older one does not refuse: its act was killed or its server restarted.

**An orphaned attempt is resolved, never left.** Once an unresolved attempt is older than the runner budget plus 10 s, the next `pr-landing` read of that run's session resolves it. The lane writes `landing:enqueue:<head>:<n>:orphaned` under `open-run`, carrying what the read saw (`entry`, `autoMerge`, `state`). Then:
- if an entry or an armed request stands and the run is no longer at `merging` at that head, the lane mails `enqueued-after-sendback`, as step 3 would have (the feed record instead, for a closed run);
- if an entry or an armed request stands and the run is still at `merging` at that head, the attempt is treated as answered `queued` or `armed-*`, and an armed one is disarmed by the next attempt's step 3 in ccd;
- otherwise nothing more is said, and a run still at `merging` is eligible for attempt `n + 1` on two fresh sightings.

So a server that restarts between step 1 and step 3, followed by a send-back, still ends in one `enqueued-after-sendback` mail when GitHub shows an entry, and in nothing when it does not.

**The answers.** Live, each answer is recorded as its row. Only these words mail:
- `armed-disarmed`, `armed-disarmed-on-entry`, `not-queued` and `refused:*` mail `landing:#<pr>:<word>@<head7>`: a stop, and the coordinator decides;
- `state-changed` is retried as the next attempt on the next pass, and three consecutive `state-changed` answers at one head mail `landing:#<pr>:unsettled@<head7>`;
- `queued` and `already-merged` mail nothing; the merged notice follows (§4.5).

### 4.4 Mail only on red, stop, dequeue and merge

While the enqueue arm can act for a run (its effective enqueue mode, §3.8, is `live`), the green edge of §3.4 is written but not mailed: the server acts on it. If the enqueue mode drops while the run waits, the coordinator gets `mode-dropped` (§3.8), and the next green edge is mailed again. What mails is:
- `checks:…:red`, `stuck`, `unmeasured` and `unverifiable` (§3.4);
- `landing:…` stops, `head-moved`, `mode-dropped` and `enqueued-after-sendback` (§3.1, §3.8, §4.3);
- `dequeued:#<pr>@<time>`, whose body now names its cause (§5);
- `merged:#<pr>` or `merged-unproven:#<pr>`, from one writer (§4.5).

### 4.5 The merge proof, and one writer for the merged notice

Today `sweepLanding` sends `merged:#<pr>` the first time it sees the phase `merged` for a run at `merging` (`landingVerdict` ≈:129-141). It runs synchronously inside `sweepPr` (≈:8338), so it would see the merge before the async arm. Two writers would send an unproved `merged:` and then a `merged-unproven:`, and subject dedupe cannot catch two different subjects. So the merged notice gets exactly one owner per run:

- **The arm owns it** for a run with `mergingHead` set whose effective mode (§3.8) has at least one arm `live`, and whose ccd answers `pr-landing-v1`. `landingVerdict` gains a fact, `armOwnsMerged`, read after `runState`, and a new terminal step, `yield`: say nothing, latch nothing, because the arm will send it. It is not `defer`, which warns on every pass (`watch.ts` ≈:8663). The switch over the steps is exhaustive, so the new step is a compile error until `sweepLanding` handles it.
- **`sweepLanding` keeps every other case**: shadow-only runs, runs with no `mergingHead`, an older ccd, `landing-disabled`. Those coordinators get today's `merged:#<pr>`, byte for byte.
- **The arm's notice.** When the phase reads `merged` (or the queue word reads `landed`), the arm reads `pr-landing` once more and compares: `state` MERGED and `headRefOid` equal to `mergingHead`.
  - Equal: `merged:#<pr>` is sent with the body line `proved: MERGED at <head>, the head this run advanced to merging at`.
  - Unequal: `merged-unproven:#<pr>`, and the body says which head merged. Unreadable for three passes: `merged-unproven:#<pr>`, saying the read failed. The coordinator proves by hand as today.
- **Once across both writers.** Both writers' "already told" read asks for either subject: `mergedSubject` and `mergedUnprovenSubject`, both built in `coord/landing.ts`. So a run whose ownership flips between passes (a marker removed after the arm sent `merged-unproven:`) is never told twice.

The close route re-measures the fingerprint either way (`verifyDone`), so a proved mail lets the coordinator close without its own `gh pr view` (§10 Q5).

## 5. Stage 3: the ejection cause

### 5.1 The read: `ccd pr-ejection`

`pr-landing` adds the last queue removal's `reason` as a closed word: `failed-checks`, `manual`, `merge-conflict`, or `other` for anything else. It rides the GraphQL read it already makes, so it adds no call.

For `failed-checks` only, the lane makes a separate read-only call, so its three gh calls never share `pr-landing`'s budget:

    ccd pr-ejection --session <id> --pr <n>

| # | Call | ccd timeout |
|---|---|---|
| 1 | `gh run list --event merge_group --json databaseId,headBranch,conclusion,createdAt --limit 50`, keeping the newest run whose `headBranch` begins `gh-readonly-queue/<base>/pr-<n>-` (base from the registry) and that was created before the removal | `PR_EJECT_LIST_TIMEOUT` = 6 s |
| 2 | `gh run view <id> --json jobs` (job names, conclusions and step conclusions, all structured) | `PR_EJECT_JOBS_TIMEOUT` = 6 s |
| 3 | the tail of `gh run view <id> --log-failed`, at most 1 MiB, parsed in ccd's python on a file descriptor for exactly three shapes: vitest's `FAIL <file> > <name>` lines, `Test timed out in <n>ms`, and the runner's job-timeout line | `PR_EJECT_LOG_TIMEOUT` = 10 s |

The worst case is 22 s, against a runner budget of 35 s (63%). It emits `{why, runId|null, jobs: [{name, conclusion}], records: [{file, name, shape}], cut, unmeasured}`, at most 32 records, each field bounded. The raw log never leaves ccd. A job count of zero, a missing run, a timed-out call or a log past the bound answers `unmeasured`, never `no failures`. `--session` must be a registry workspace and `--pr` an integer; the verb writes nothing.

### 5.2 The classification

`ejectionVerdict` (L1) reads the removal word, the records and the run's history of ejections for this head:

| Removal | Records | Verdict |
|---|---|---|
| `failed-checks` | every failing record matches one row of `LANDING_FLAKE_SIGNATURES`, and this head has not been re-queued before | `requeue` |
| `failed-checks` | anything else, a second ejection of the same head, or `unmeasured` | `mail-tests` |
| `merge-conflict` | — | `mail-conflict` |
| `manual` | — | `mail-manual` (a person removed it; nothing is re-queued) |
| `other` | — | `mail-unknown` |

`LANDING_FLAKE_SIGNATURES` is an L0 table in `shared/landing.ts`. Each row is a test file, an optional case-name prefix and a shape (`fail`, `timeout` or `job-timeout`). It changes only by a reviewed PR. Its seed is §10 Q4. CLAUDE.md's "Known load flakes" bullet then points at the table, so the list is written once.

**Group size.** Classification assumes a group of one PR, which is this repository's queue (parent §5.7.7: group size 1, build concurrency 1). When the rules read shows a larger group, every failure is `mail-tests`, because a failed group can be another PR's fault.

### 5.3 What the coordinator gets

The `dequeued:#<pr>@<time>` mail keeps its subject and key, so `sweepLanding`'s durable once-only read (`hasMailWithSubject`, `hasNotice`) is unchanged. Its body (`renderDequeueBrief`, `coord/landing.ts` ≈:172) gains a cause section:
- the removal word;
- for tests, the failing records after `landingCheckName`, inside `untrustedBlock`;
- the queue run's id, an integer;
- the next act that the verdict implies.

A `requeue` verdict, with the enqueue arm live and `$REG/landing-requeue-live` present, re-enqueues as the next numbered attempt at the same head (§4.3), with no mail, and records `landing:requeue:<head>`. Its eligibility reads `pr-landing`'s fresh `entry`, `autoMerge` and `state`, so the sweep's sticky `dequeued` word does not block it. The once-per-head budget is the count of `landing:requeue:<head>` rows. Otherwise it mails, saying the signature matched and naming the re-enqueue. A second ejection of the same head always mails. When the dequeue mail is ready before the ejection read answers, the mail waits at most one pass for it, then goes with `cause: unmeasured`.

## 6. Stacked PRs

The queue squash-merges. A PR stacked on another (its base is the parent's branch, not the default branch) still carries the parent's original commits when the parent lands as one squash commit. It then needs its base moved to the default branch and its own commits replayed past the parent's last head, `git rebase --onto <default> <parent's last head> <child>`, and a `ccrc restamp` if it touched `ccd/ccd`. Today worker clause 16 allows absorbing `origin/main` only with `git merge`, "never a rebase, a force-push or `update-branch`", and coordinated waves rarely stack, because wave N+1 waits for the producer's close (parent §11 item 3).

**No stacked PR reaches this spec's arms.** The binding is base-exact (§1.3): a workspace's registry base is the default branch at its creation, so a PR whose base is another branch is never bound. It is absent from `pr-state`'s and `pr-landing`'s bound rows, and so:
- an advance to `merging` that claims it as the run's PR is refused by `verifyDone` (`pr-regressed`: claimed `open`, measured `none`);
- an advance that claims no PR answers `landing: {off, off}` (§3.7), so the coordinator keeps today's wait;
- no arm reads, mails about or enqueues it, and the queue only takes PRs that target its branch anyway.

The plan pins this with a census case: a PR whose base is not the default branch is never in `pr-landing`'s output, and a run whose only PR is stacked is never in the arms' population.

After the parent's squash merge, GitHub moves the child's base to the default branch only when the parent's head branch is deleted on merge, which is a repository setting. Once moved, the child binds like any PR, and its coordinator's fix round absorbs the squash with clause 16's `git merge` of `origin/<default>` in the worker's own workspace. A merge that already contains the parent's last head merges the squash cleanly, and parent §5.4's lineage keeps the review for a clean base-only merge once it lands.

Detection and a `restack:` mail would need a second binding that reads a PR by its head alone, at any base. That, and whether ccrc should rebase and restamp server-side, are §10 Q3.

## 7. Safety

The CLAUDE.md SAFETY rules are unchanged, and each new act is placed under them:

- **The server acts only on runs it owns.** Every arm needs:
  - an open run at `merging`, whose newest transition into `merging` was attributed to `run.claimedBy` and recorded as `merging-by:<id>` (§4.1);
  - a claimant that is not the run's own session and carries no programme-wave hold and no child marker (`selfClaimed`, §4.3);
  - its `sessionId` a registry workspace;
  - the PR bound to that workspace (`ours`, base-exact);
  - the head equal to `mergingHead`, which that attributed advance verified;
  - for the act, a run re-read under `coordMutex` immediately before and after it, with the same head and attributor (§4.3).

  A PR with no run, a hand-merged PR, a stacked PR, a closed run, a run at any other state and an unattributed advance are never acted on. The after-the-fact writers (`open-run`) only record and tell; they never act.
- **Workers cannot make the trigger.** The advance to `merging` is refused `not-claimant` when attributed to anyone but the claimant, the hook denies it to held and child sessions (§4.1), and an advance with no attribution is recorded as such and never acted on. What remains is a hostile session that forges the claimant's pair outside every spelling the hook parses: identity on this fleet is attribution (§1.4). §10 Q1 states that risk.
- **Sessions never run the new act.** `pr-enqueue` is protected in every place the server-only verbs (`ws-reclaim`, `ws-expire`, `ws-collect`, `ws-orphan`) are:
  - the privileged direct-entry guard at the top of `ccd/ccd` (≈:27-29, D-3696, D-3700; "the guarantee is the launcher's `-p` start"), so a direct `ccd pr-enqueue` that did not come through the installed direct entry is refused `entry-unprivileged`;
  - `is_protected` in `ccd/ccd-entry.py` (≈:148-156);
  - the children's deny rules, in both copies: `CHILD_DENY_CCD_VERBS` in `shared/api.ts` (≈:11338-11339, the TypeScript source of `childDenyRules`) and `_child_deny_json` in `ccd/install-session-hooks.sh` (≈:174-186), held equal to each other and to `FORBIDDEN_CCD_VERBS` by `ccd-spawn-child-settings.test.ts` and `install-session-hooks.test.ts`. Every spawned child's settings carry the bare `Bash(ccd pr-enqueue:*)`; the path-qualified forms follow `CHILD_DENY_PATH_QUALIFIED`, which is off today (`install-session-hooks.sh` ≈:161, `shared/api.ts` ≈:11346);
  - both verb lists in `ccd/session-hook.sh`'s jq, `fmatch` (≈:4483) and `xmatch` (≈:4502);
  - `FORBIDDEN_CCD_VERBS` (`server/src/coord/approvalguard.ts` ≈:124), so the classifier marks it forbidden and no approval can rule one;
  - CLAUDE.md's SAFETY section, a line worded as the `ws-reclaim` line is: the server's act on its own run, behind a token re-proved on the box, never a session's verb, never run against the live host from a shell or a test.

  `pr-landing` and `pr-ejection` are read-only and stay open to sessions.
- **No new merge path for the PWA.** `gh` stays in `FORBIDDEN_COMMANDS`. The grant is `['pr-enqueue','--expect']`, enrolled in `REQUIRED_VERB_FLAG` (`whitelist.ts` ≈:351), and the argv puts `--expect` first so the grant admits it. A census test pins that only the landing lane composes `CCD_ARGV.prEnqueue`, and that no route does.
- **Route Q only, never a synchronous merge.** The verb refuses unless the base requires the queue, so GitHub re-tests the composition before it merges. `--admin` and `--auto` are not in ccd's argv. That is stronger than wave 2b's hook deny, which covers only what the hook can parse.
- **No standing armed request.** The verb disarms an armed request with no entry, both after its own merge call and on entry (§4.2), under its lock.
- **No unannounced enqueue after a send-back.** The act is bracketed by run re-reads under `coordMutex`; a send-back or a close waits for an in-flight act; every attempt ends in an answer or an `orphaned` row; and an entry that stands against a run that moved is mailed with its undo, or recorded in the feed for a closed run (§4.3).
- **Fail toward not acting.** `unmeasured`, a cache miss, a lock held, a token seen once, an unreadable claimant, an unattributed advance, a duplicate attempt row, an unknown removal reason and an unknown rule type each act on nothing. Each bounded wait ends in a mail, so the coordinator is never left waiting in silence, and a mode that drops says so (§3.8).
- **Untrusted text.** Check names, job names, test names and log lines are attacker-controllable (fork PRs, any workflow author). They are never an argv, a shell word, a subject, a file name or a GraphQL document. They are bounded in ccd, reduced by `landingCheckName`, and fenced by `untrustedBlock`. Integers (PR number, run id, check id) and shas are validated by regex before they are spelled anywhere.
- **Arming.** Every arm ships in shadow behind its own marker, and none of the markers has a writer: `landing-checks-live`, `landing-enqueue-live`, `landing-requeue-live`. `landing-disabled` wins over all of them. `mail-disabled` holds every mail rung, as it does for the stall watch.
- **No herd.** One enqueue per pass, fleet-wide. One `pr-landing` call per project per pass, only for projects with a run in the population. One `pr-ejection` call per removal.
- **Fixture HOMEs only** in every test (`makeCcdHarness`). gh is faked through `ghContainedEnv()` and a fixture `gh` on PATH. No test or shell runs `pr-enqueue` against a live box, and no task creates a marker on one.

## 8. Ownership and the consolidation rule

| Fact or act | Before | After |
|---|---|---|
| A PR's CI rollup word for the PWA | `checksFor`, whole set | unchanged (plus the 3f running-check fix) |
| The required checks of a landing PR's head | the coordinator's `gh pr checks --required` | `ccd pr-landing` → `requiredChecksVerdict` (one reader, `coord/landing.ts`) |
| "Required checks finished" | **nobody says it** | the landing lane's checks arm, durable rows through `queueLandingNotice` |
| The head the coordinator verified at `merging` | re-measured, then dropped | `runs.mergingHead`, one writer (`advanceInner`) |
| Who advanced a run to `merging` | nobody records it (`causedBy` is a literal) | `merging-by:<id>` in the transition row, written by the attributed advance, read by `mergingAttributor` |
| The mode a coordinator was told | the answer only | `landing:mode:<head>:…`, written in the advance's transaction, read by §3.8 |
| Is the claimant self-claimed, held or a child | the hook, for merges | the hook for merges, `selfClaimed` (L1) for the server's acts; L4 reads the hold through `programmeHoldOf` |
| The queue entry | the coordinator's own `gh pr merge` | the landing lane's enqueue arm through `ccd pr-enqueue` (if Q1 and Q2 say yes) |
| The read-back and disarm | the coordinator | `pr-enqueue` itself, after its act and on entry |
| The merge proof and the merged notice | `sweepLanding`, no proof | one owner per run: the arm (with proof) when a mode is live, else `sweepLanding` as today |
| Why the queue removed a PR | the coordinator reading logs | `pr-landing`'s removal word, `ccd pr-ejection`'s records → `ejectionVerdict` |
| Known flakes | CLAUDE.md prose | `LANDING_FLAKE_SIGNATURES` (L0), which CLAUDE.md points at |
| Observation rows | `insertStallObservation`, stall lane only | one writer with a closed three-member state predicate, two lanes |

Every new decision goes into `coord/landing.ts`, the landing lane's L1 owner (D-3883), whose value imports widen only to two pure files, `shared/landing.ts` (L0) and `coord/untrusted.ts`. Every new delivery goes into the landing lane. No second PR poller, notifier, sanitiser, fence or observation writer is added: `untrustedBlock`, `insertSystemMailTx`, `attributionVerdict` and the observation writer are reused, and `queueLandingNotice` is `queueStallNotice`'s sibling, not a copy of its body. The new read paths, `pr-landing` and `pr-ejection`, are recorded as legitimately different in §3.2 and §5.1. When the LaneRunner refactors land (#1200, #1209), the arms become a row of `LANE_SCHEDULE` like their neighbours. When parent stage 5's landing line lands, `enqueueVerdict` reads it, and a run that is not next to land waits.

## 9. Wire, deploy and rollback

- **ccd:** three verbs, `pr-landing` (read), `pr-ejection` (read) and `pr-enqueue` (act), and capabilities `pr-landing-v1`, `pr-ejection-v1` and `pr-enqueue-v1`. `CCD_CAN` rows (`server/src/ccdargv.ts` ≈:1161) refuse without them, so every arm is inert on an older ccd. `ccrc-api runs advance` fills `byId`/`byUuid`. The hook gains the advance deny for held and child sessions.
- **Agent:** grants `['pr-landing','--project']`, `['pr-ejection','--session']` and `['pr-enqueue','--expect']`, with `'pr-enqueue': '--expect'` in `REQUIRED_VERB_FLAG`. Runner budgets in `CCD_VERB_TIMEOUT_MS` (`server/src/remote/runner.ts`): `pr-landing` 35 s, `pr-ejection` 35 s, `pr-enqueue` 80 s, each pinned against ccd's own call timeouts at the 30% reserve the way `pr-timeout-budget.test.ts` pins `pr-state`.
- **coord.db:** `MIGRATIONS[29]` (`user_version 29 → 30`), `runs.mergingHead TEXT`, nullable, re-measured before the PR and before merge. An older build opening the file reads it as-is and never names the column. Every other new fact is a `run_events` row.
- **Server ↔ coordinator:** the advance body's optional `byId`/`byUuid` (absence permits the advance and forbids the act); the optional `landing` block on the advance answer; the new refusals `409 not-claimant` on `→ merging` and `409 enqueue-in-flight` on `merging → working` and on close. New subjects `checks:#<pr>:<gen>:<word>@<head7>`, `landing:#<pr>:<word>@<head7>` (`head-moved`, `mode-dropped`, `enqueued-after-sendback`, `self-claimed`, `unsettled` and the stop words), `merged-unproven:#<pr>`. `dequeued:` and `merged:` keep their subjects and gain body sections. The subject builders live once, beside `dequeuedSubject` and `mergedSubject` (`coord/landing.ts` ≈:36-38).
- **PWA:** no change. Observation rows show in the run's history like the stall watch's.
- **No `FLEET_PROTO` bump.** Everything is additive and absence-permits for the advance, absence-forbids for the act.
- **Order:** agent lane first. The server reads a missing capability as `off`, and an advance with no attribution as never acted on.
- **Rollback:** removing a marker returns its arm to shadow at the next pass, and every coordinator told `live` for that arm gets one `mode-dropped` mail (§3.8). `ccrc rollback` of ccd makes the capability absent, which reads `off` and mails `mode-dropped` too, because §3.8 needs no ccd call. An entry the server made stays in GitHub's queue and lands or is dequeued as any entry is, and `sweepLanding`'s `merged:`/`dequeued:` still tell the coordinator once the arm stops owning the merged notice. **A server rollback past the lane** is the one drop no build can announce. So the rollback runbook removes the live markers first, waits one pass for the `mode-dropped` mails, and only then rolls the server back.

## 10. Questions for the operator

1. **Does a server-armed enqueue reverse R5, and what is left of the risk?** R5 says "no timer holds MERGE authority", and parent §13 lists "an unattended lander" as out of scope. In stage 2 the server enqueues only on a run whose own claimant advanced it to `merging` at a head it verified, with the advance attributed and recorded (§4.1), and GitHub's queue re-tests before it merges. **Recommendation: rule that stage 2 is an amendment of R5, not a reversal of it.** The coordinator remains the lander of record, and the server performs only the mechanical enqueue it ordered. Scope it to route Q. Never a direct merge, never `--admin`, never a self-claimed, held or child claimant, and never an advance the server did not attribute to the claimant.
   - **(a) The remaining risk.** Attribution is not authentication. Every session reads the box token and every `.uuid` (`ccd/ccrc-api` ≈:511-513). A hostile session that writes a request by hand with the claimant's id and uuid, in a spelling the hook does not parse, passes the server's gate and makes the trigger. Today the same session can already run `gh pr merge` itself (the hook is "a contract the fleet honours, not an access boundary"), so stage 2 adds no capability a hostile session lacks. It does make the server, not the session, the actor of record. What still stands between that forgery and `main`: the required checks must be green at that head, the queue re-tests the composition, one enqueue per pass, and the coordinator is mailed the merge. **Recommendation: accept this, as wave 2's merge deny was accepted on the same threat model.** A real boundary (a per-session secret the server issues and a session cannot read) is a separate ruling for the whole run API, not for this spec.
   - **(b) Held coordinators.** The new hook deny cannot tell a self-claimed coordinator, or a reclaim heir that was the programme's own worker, from a worker. Those coordinators lose their own advance to `merging`, and ask the operator to advance and enqueue from their own shell (§4.1). **Recommendation: accept it.** They already need the operator's shell for the enqueue, and the server never enqueues for them.
2. **May a ccd verb run `gh pr merge` for the server?** It would be the first merge-class GitHub write the exec whitelist reaches (`pr-open` is the only GitHub write today). `gh` itself stays forbidden. **Recommendation: yes, under §4.2's limits:** fixed argv, a token recomputed on the box under a lock, disarm of any armed request, server-only in every place the destructive verbs are, no route composes it, and sessions are refused it. If no, stage 2 is dropped, and stages 1, 3 and 4 still remove the CI wait.
3. **Stacked PRs: should ccrc read them, and may it force-push a session's branch to rebase and restamp one?** Today no stacked PR is bound, so none reaches an arm (§6). Two separate asks follow. (a) Detection: a second, head-only binding used for detection alone (`isCrossRepository` false, `headRefName` the registry branch, `ours`, any base) would let the lane mail `stacked:` and, when the parent merges, `restack:` naming clause 16's merge-absorb route; `verifyDone`'s phase would still read such a run as having no bound PR, so it would never be enqueued. (b) A server-side restack is `rebase --onto` plus a force-push, and a restamp when `ccd/ccd` changed. It mutates a session's branch, and its local ref sits under a live worktree. **Recommendation: (a) not now, because coordinated waves rarely stack and a second binding is a second answer to "which PR is this workspace's"; (b) no.** Restack through a coordinator fix round, with the worker's own `git merge` under clause 16. Revisit a server-side restack only with all of these: a temporary worktree (never the session's), `--force-with-lease` at the measured old head, a patch-id equality proof between the old and new ranges, an idle pane, and a token. Sub-question: should a patch-id-equal restack keep the review, or need a fresh review run? Recommendation: keep it only once parent §5.4's lineage can prove it.
4. **The flake list and the re-queue budget.** **Recommendation:** seed `LANDING_FLAKE_SIGNATURES` with the measured removal causes (the `fleetws.test.ts` teardown race and the tick-diet shard's job timeout, both since fixed by wave 3c, so they serve as fixtures) and with CLAUDE.md's known load flakes. Re-queue at most once per head. A second ejection always mails. The table changes only by a reviewed PR.
5. **May the coordinator close on the server's merge proof?** **Recommendation: yes.** A `merged:` mail that says `proved:` needs no second `gh pr view`, because the close route re-measures the fingerprint anyway. `merged-unproven:` keeps today's proof by hand.
6. **Arming order.** **Recommendation:** `landing-checks-live` first, after a week of shadow rows agree with the coordinators' own `gh pr checks` outcomes. Then `landing-enqueue-live`, after a week of `would enqueue` rows that each match a real enqueue the coordinator made at the same head, attributed to the same claimant. Then `landing-requeue-live`.
7. **Does `mode-dropped` go out under `landing-disabled`?** §3.6 says yes: it is the one mail a disabled lane still sends, because without it a coordinator that ended its turn on `live` hears nothing. `mail-disabled` still holds it. **Recommendation: yes.** If the operator wants `landing-disabled` to be total silence, the skill has to keep a foreground fallback wait, which gives back part of stage 4's saving.

## 11. Out of scope and follow-ups

- Workers' CI waits while `working` (worker clause 17 already forbids ending a turn without a wake). A `checks:` mail to the worker of a `working` run would reuse stage 1 whole. That is a separate ruling, because it changes the worker's loop.
- Attributing the other advances (`→ working`, `→ awaiting-review`) and the close. They trigger no GitHub act, so this spec leaves them as they are; the same fill and gate would serve them.
- `ccrc-api mail list` parsers: the trailing `http NNN` is on stderr already. The follow-up is one documented machine form (an envelope flag), so that coordinators stop writing their own parsers.
- The required/advisory split of the PWA's checks word (parent §5.7.8) stays with the landing-order programme.
- Direct-merge routes G and U, and the landing line.
- Stacked-PR detection and any server-side restack (§10 Q3).

## 12. Review log

**rev 0 (2026-10-24).** Written against `origin/main` `10813b401`, the operator's fleet transcript audit of 2026-10-24, and the open PRs that hold the same files that day: #1127 (wave 3e, `SKILL.md`, `wave-lifecycle.md`), #1200, #1209, #1221, #1230, #1234 and #1240 (`watch.ts`, the LaneRunner and registry refactors), and #1252 and #1264 (`approvalguard.ts`, `session-hook.sh`, `shared/api.ts`).

**rev 1 (2026-10-24).** Re-grounded on `origin/main` `7516cb0e3`. A review rejected rev 0, and every finding is acted on:
- The migration is `MIGRATIONS[29]` (`user_version 29 → 30`), not "migration 7", and `COORD_SCHEMA_VERSION` is derived, not bumped (§4.1, §9).
- The observation writer takes an explicit state predicate, because `merging` is an idle state the stall writer refuses, and a mailed row and its mail commit in one transaction through `queueLandingNotice` (§3.4).
- Generations, their start and the stuck bound are durable rows, measured from each generation's own `open` row (§3.4).
- `pr-enqueue` is protected in the direct-entry guard, `is_protected`, the children's deny rules and both hook lists, not only `FORBIDDEN_CCD_VERBS` (§7).
- `--expect` comes first in `pr-enqueue`'s argv, so the prefix grant admits it (§4.2).
- Every gh call has a timeout and every verb a derived budget; the ejection reads are their own verb; an armed request found on entry is disarmed (§3.2, §4.2, §5.1).
- The act is bracketed by run re-reads under `coordMutex`, and a send-back waits for an in-flight act (§4.3).
- A self-claimed run, or a claimant with a wave hold or child marker, is never enqueued (§4.3).
- Stacked PRs are unbindable today, so §6 says that and nothing reads them; detection is §10 Q3 (a).
- `landing.checks: live` requires the advance's own measurement of a bound open PR (§3.7).

**rev 2 (2026-10-24).** Re-grounded on `origin/main` `30f9bdc9f`. A review rejected rev 1, and every finding is acted on:
- The advance to `merging` was unattributed: box token only, `causedBy` a literal, a worker stopped by prose alone (§1.4). It is now attributed through `attributionVerdict` and `run.claimedBy`, recorded as `merging-by:<id>`, refused `not-claimant`, denied by the hook to held and child sessions, and the act reads the recorded attributor (§4.1, §4.3, §7). §10 Q1 states the remaining risk and the cost to held coordinators.
- The enqueue gate reads `pr-landing`'s fresh `entry`, `autoMerge` and `state`, not the sweep's queue word, which stays `dequeued` after any removal (§1.3, §4.3, §5.3).
- Attempts are numbered (`landing:enqueue:<head>:<n>:…`), a duplicate `inflight` row means do not act, an orphaned attempt is resolved by a read and can mail `enqueued-after-sendback`, runs with an unresolved attempt stay in the population whatever their state, and a close waits for an in-flight act too (§4.3).
- The predicate union has a third, explicit member, `open-run`, with exactly three writers, and a closed run gets an operator feed record instead of a mail (§3.4).
- The answered mode is recorded at the advance, and a mode that drops mails `mode-dropped` once per arm; the green mail is suppressed only while the enqueue arm can act (§3.7, §3.8, §4.4, §9).
- Generations are keyed on the required contexts' check-run ids (a fingerprint), and a settled generation also opens the next on a fingerprint change or on red to green; the subject carries the generation; the cadence stays at 30 s after a red (§3.2 to §3.5).
- `landing.ts` takes value imports only from `shared/api.ts`, `shared/landing.ts` and `coord/untrusted.ts`, and never from `rundefs.ts`: the L4 caller passes the claimant's hold and child facts in (§3.5, §4.3, §8).
- The children's deny rules are protected in both copies, `shared/api.ts`'s `CHILD_DENY_CCD_VERBS` included, and the path-qualified forms follow `CHILD_DENY_PATH_QUALIFIED` (§7).
- The merged notice has one owner per run: `landingVerdict` yields to the arm while a mode is live, `sweepLanding` keeps every other case, and both writers' "already told" read asks for either subject (§4.5).
