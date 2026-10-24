# PR landing in ccrc: the checks mail, a server-armed queue entry, the ejection cause and the coordinator's ended turn

**Spec** · 2026-10-24 · Status: draft for review, rev 1. Nothing in it is ruled yet: §10 holds the questions only the operator can answer, each with a recommendation · Owner: the ccrc coordinator · Deviation: D-6773 (issued by the ledger) · Plan: `docs/superpowers/plans/2026-10-24-pr-landing-in-ccrc.md`

**Related:** `2026-09-23-landing-order-and-main-churn-design.md` (the parent: R5 "no unattended lander", §4's roles table, §5.2's dequeue and merged notices, §5.4's lineage, §5.7's landing route and §5.7.8's checks word, §11 items 3, 4, 6 and 11), `docs/superpowers/programs/landing-order.md` (the proof-run readings and waves 2b, 3e, 3f, 4 and 5), `docs/superpowers/plans/2026-10-20-landing-order-wave3c-task7-rerun-preconditions.md` (two suite flakes the queue turned into removals), `2026-09-29-worker-stall-watch-design.md` (observation rows, shadow rungs, arming markers), `2026-10-19-ccrc-consolidation-wave-design.md` (K12 switches), `2026-10-23-fleet-disk-retention-design.md` (the token-twice rule, the privileged direct entry and the shadow-first shape this spec reuses), open PR #1127 (landing-order wave 3e, the landing route in the skill).

## In short

Coordinators spend a quarter to nearly half of their own tokens waiting. The biggest single wait is CI on a PR they are landing. The skill tells them to block on `gh pr checks --required --watch` and to re-issue it when it times out, because "no mail comes when checks finish". The server already reads every open PR every 30 to 120 seconds. It just never says when a required check finishes. This spec moves that wait into ccrc in four stages, each shipped in shadow behind a marker with no writer:

- **Stage 1, the checks mail.** For a run waiting at `merging` at a head its coordinator verified, the server reads the REQUIRED checks of that head, not the whole rollup. It mails the run's coordinator once per settle: `checks:#<pr>:green@<head7>` or `checks:#<pr>:red@<head7>`. A required check that never reports, or a read that never answers, ends in one `stuck` or `unmeasured` mail after a bound. Every fact the edge needs is a durable row, so a restart neither repeats a mail nor loses one. Check names come from GitHub and anyone who can write a workflow controls them, so they are bounded, reduced to a fixed character set, and fenced as untrusted data.
- **Stage 2, a server-armed queue entry.** Once the coordinator has advanced a run to `merging` at a verified head, and that head's required checks are green, the server enqueues the PR through a new server-only ccd verb. The verb runs `gh pr merge <n> --match-head-commit <head>` with a fixed argv, never `--admin`, `--auto` or a method flag. It reads the entry back, disarms a request that only armed, and proves the merge (MERGED, `headRefOid` equal to the head the coordinator verified). The coordinator is mailed only on red, on a stop, on a dequeue (with its cause) and on the merge. This changes parent ruling R5, so it waits on §10 Q1 and Q2.
- **Stage 3, the ejection cause.** When the queue removes a PR for failed checks, a separate read-only ccd verb reads the queue's own `merge_group` run and returns failing jobs and test names as bounded, structured data. The server classifies them. A known-flake signature is re-queued once per head. Anything else is mailed with the failing test names, sanitised.
- **Stage 4, the skill.** When the advance to `merging` answers that a stage is live for this run, the coordinator ends its turn. Mail wakes it.

A stacked PR (one whose base is not the default branch) is never bound to its workspace today, so it cannot reach any arm of this spec (§6). Whether ccrc should rebase and restamp a stacked child server-side is a force-push of a session's branch, so it is §10 Q3, with a recommendation not to do it now. Every arm acts only on a run the server owns, never on a self-claimed run, and no session can run the new verb (§7).

## 1. The problem, measured

Code citations are to `origin/main` `7516cb0e3`. Line numbers are hints, written `≈:`, and each names its function.

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

`ccd/coordinator-skill/references/wave-lifecycle.md` ≈:777-833, "Landing on a native-queue project":

- Enqueue only a PR whose required checks have all passed: `gh pr checks <pr> --required` exits 0 (8 is pending, 1 is failed). For any other PR, gh arms auto-merge instead and prints the same line.
- **On `8`, "wait for them in the foreground — `gh pr checks <pr> --required --watch`, again if the call times out — never by ending your turn: no mail comes when checks finish"** (≈:786-791).
- Then enqueue with `gh pr merge <pr> --match-head-commit <handoffCommit>`, read the entry back with a GraphQL query, disarm what only armed, and end the turn. `merged:#<pr>` or `dequeued:#<pr>@<time>` wakes it.
- On `dequeued:`, read why from the queue's own run: `gh run list --event merge_group …`, then `gh run view <id> --log-failed`.
- For a send-back from `merging`, the text says to disarm auto-merge. It does not say to dequeue an entry, because today the coordinator made the entry itself and knows it is there.

Clause 7 of `SKILL.md` (≈:76) says "This session does not poll in a loop." The `--watch` instruction is the one sanctioned poll, and it holds a whole coordinator turn open for the length of a CI run. Clause 15 (≈:84) carries the enqueue spelling. `server/test/coordinator-skill.test.ts` pins both verbatim.

### 1.3 What the server already reads, and what it says

- **`sweepPr`** (`server/src/watch.ts` ≈:8235): one `ccd pr-state --project` per project. It runs every `PR_SWEEP_MS` = 120 s, or `PR_SWEEP_ACTIVE_MS` = 30 s while any open PR reads `pending` (≈:537-538). It stores per session the phase (`merged` among them), the CI rollup word and failing names (`prStates`, ≈:1007) and the merge-queue word (`prQueues`, ≈:963). Its last two steps are `sweepMerged` and `sweepLanding` (≈:8337-8338). Both are synchronous.
- **The rollup is the whole set.** `checksFor` (`server/src/prstate.ts` ≈:165-176) folds every entry of `statusCheckRollup`, required or not, into one word. It bounds failing names to 10 at 120 characters each, but keeps their characters. ccd fetches the rollup through `gh pr list --json number,statusCheckRollup` (`_gh_pr_checks`, `ccd/ccd` ≈:5638), which carries no `isRequired`.
- **The word is wrong for running checks.** gh writes a queued or running check run with `conclusion: ""`. `stateOf` keeps the empty string, because `??` skips only null and undefined, so a running check reads `pass` (parent spec §5.7.8, measured on #1010). The fix is ruled as landing-order wave 3f and is not yet planned (`landing-order.md`, Waves row 3f).
- **A non-required red reads `fail`** (measured on #1068 with every required check green). No gate reads the word today (§5.7.8).
- **`sweepLanding`** (`watch.ts` ≈:8616, every decision in `server/src/coord/landing.ts`) mails a run's coordinator only two things: `dequeued:#<pr>@<time>` when the queue word reads `dequeued`, and `merged:#<pr>` when the phase reads `merged` while the run waits at `merging`. It announces. It never enqueues, merges or re-runs (R5). It does not carry the removal's reason: `_pr_queue_py` (`ccd/ccd` ≈:40280) reads it only to tell `landed` from `dequeued`. Its once-only latch, `landingNotified` (≈:976), is in memory, and every rollout restarts the server (≈:973), so its durable reads (`hasMailWithSubject`, `hasNotice`) are what keep a notice single.
- **The binding is base-exact.** ccd's `bound()` (`ccd/ccd` ≈:5806-5811) and the server's `boundRow` (`prstate.ts` ≈:147) bind a PR to a workspace only when `isCrossRepository` is false, `headRefName` is the registry branch, the PR is `ours`, and `baseRefName` equals the registry base. The registry base is `origin/HEAD` at the workspace's creation (`ccd/ccd` ≈:7407, written ≈:7596). A PR whose base is any other branch is never bound.
- **The run does not record the head the coordinator verified at `merging`.** `POST /api/runs/:id/advance` (`server/src/coord/routes.ts` ≈:1792, inside `coordMutex` from ≈:1821) re-measures the fingerprint through `verifyDone` on the way to `merging` (≈:1871-1888), then calls `coord.advance(id, to, 'coordinator')` and stores nothing of it. `runs.handoffCommit` is written once, at close (`setHandoffCommit`, `server/src/coord/store.ts` ≈:3169).
- **An advance can reach `merging` with no bound PR.** `verifyDone` compares PR numbers only when the claim names one (`server/src/coord/fingerprint.ts` ≈:293), and a claim of `prPhase: 'none'` measured `none` is not a regression (`prVerdict` ≈:80-86).

### 1.4 What the proof runs measured

From the landing-order ledger (`docs/superpowers/programs/landing-order.md` ≈:645-810), on this repository:

- A deliberately wrong `--match-head-commit` sha is refused ("expected head oid does not match the current head oid"), and nothing is queued or armed. Measured twice.
- An enqueue while required checks run answers rc 0, prints nothing without a TTY, and **arms auto-merge instead of queueing**. A later push from the same login leaves it armed. So the read-back and the disarm carry weight: an armed request lands whatever head the branch carries once checks pass.
- Entries read back non-null within about 2 s. Queue landings ran about 15 minutes apart at group size 1.
- `merged:#942` woke its coordinator 3 min 10 s after the merge. `merged:#963` was sent 1 min 19 s after its merge but read hours later, because the coordinator was waiting on the operator.
- Two suite flakes turned into queue removals before wave 3c fixed them: an `ENOTEMPTY` teardown race in `fleetws.test.ts`, and the tick-diet shard hitting its 30-minute job bound (wave 3c plan ≈:95-104). Removal reasons seen: `failed_checks`, `manual`, `merge_conflict`, and `merged` at every successful queue merge.

### 1.5 The authority line today

Parent ruling R5: "No unattended lander … No timer holds MERGE authority" (parent §3). Parent §4: the server may not "run git or `gh`" (`EXEC_COMMANDS` stays `['tmux','ccd']`, `agent/src/whitelist.ts` ≈:220). `gh` is in `FORBIDDEN_COMMANDS` (≈:232), because one `gh` grant would make the whitelist "the sole control between the PWA and `gh pr merge`". ccd already performs one GitHub write for the server, `pr-open` (`ccd/ccd` `cmd_pr_open` ≈:11222, granted `['pr-open','--session']`, `whitelist.ts` ≈:456). No ccd verb merges or enqueues.

The session hook denies `gh pr merge`, in every spelling it can parse, to a session whose hold names a programme wave and to any workspace carrying the child marker (`ccd/session-hook.sh` ≈:3965-3980). That includes a coordinator of a self-claimed run (`POST /api/runs` admits a claimant that is its own session) and a reclaim heir that was the programme's own worker (≈:4056-4065). The lifecycle reference sends that coordinator to the operator's shell.

## 2. Goals and non-goals

**Goals.**
1. No coordinator turn stays open waiting for CI on a PR it is landing.
2. The "checks finished" fact has one producer, the server, and one consumer, the run's coordinator.
3. The decision about a landing stays where it is today: the coordinator rules, at a head it verified. Stage 2 removes only the mechanical enqueue, and never for a coordinator the hook would refuse a merge.
4. Every string GitHub supplies reaches a model only bounded, reduced and fenced.
5. A coordinator that ended its turn on a live answer always hears something, across restarts.

**Non-goals.**
- Workers' own CI waits while a run is `working`. They are a follow-up (§11).
- Direct merges (parent §5.7 routes G and U). The server never merges synchronously. Stage 2 is route Q only, the native queue, which re-tests before it merges.
- The landing line (parent stage 5) and lineage (stage 4). §8 says how this spec meets them when they land.
- Stacked PRs, beyond saying why none reaches an arm (§6).
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

- **The GraphQL read.** The numbers are integers ccd read from its own binding. They are checked against `^[1-9][0-9]{0,8}$` and passed as `-F` integer variables, never interpolated text. A value of digits only cannot take `-F`'s `@file` form, which is why `_pr_queue_py` avoids `-F` for strings. For each PR it reads `state`, `isDraft`, `baseRefName`, `headRefOid`, `mergeStateStatus`, `autoMergeRequest { enabledAt }`, `mergeQueueEntry { state }`, the last queue act with its `reason`, and the head commit's `statusCheckRollup.contexts`. For each context it reads `__typename`, `name`/`context`, `status`, `conclusion`/`state`, the check run's App id, the run id, and `isRequired(pullRequestNumber: N)`.
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

### 3.4 The edge, written down

Every fact the edge needs lives in `run_events` rows, never only in memory, because every rollout restarts the server. Per (run, head) the lane reads its rows, whose detail is `landing:checks:<head>:<gen>:<what>`:

- **`<gen>:open`** opens a generation and carries its start in `at`. Generation 0 opens at the run's own transition into `merging` at this head: the lane writes `landing:checks:<head>:0:open` on its first sighting with `at` copied from that transition's `run_events` row, not from the sighting. A settled generation (one with a `green` or `red` row) that reads `pending` again (a re-run) gets the next `open` row, with `at` the sighting.
- **The generation** is the count of `open` rows for (run, head), minus one. It is derived from the rows on every pass, never counted in memory.
- **`<gen>:green` and `<gen>:red`** are the edges. A move from unsettled (`pending`, `not-reported`, `unmeasured`, or no row yet) to `green` or `red` writes one, and an edge mails once.
- **`<gen>:stuck`** is written when the generation is still `pending` or `not-reported` `LANDING_CHECKS_STUCK_MS` (45 min: the CI job bound is 30 min) after its own `open` row's `at`. **`<gen>:unmeasured`** is written when every read for that long answered `unmeasured`. Each mails once per generation. A rerun opened long after the advance therefore gets its own 45 minutes, and restarts cannot reset the clock, because the clock is a row.
- **`<gen>:unverifiable`** is written and mailed at once, because it is a stop and waiting will not change it.
- A green edge is written but not mailed when the PR already reads queued, armed or merged. The coordinator acted on its own read, and the mail would be noise.

So, across a restart: a gen-0 red, a re-run and a second red mail twice (`:0:red`, `:1:red`); a gen-0 red and a gen-1 green that was mailed are never mailed again; and a head pending forever mails `stuck` 45 minutes after its `open` row however often the server restarts. The in-memory latch only spares a head whose rows say nothing can change this pass a coord.db read, as `landingNotified` does.

**The writer.** Rows are written through the store's observation writer, generalised from `insertStallObservation` (`store.ts` ≈:2648). That writer today refuses any run whose state is in `INACTIVE_RUN_STATES_SQL` (≈:1114), which is the idle and terminal states, and `IDLE_RUN_STATES` includes `merging` (`shared/api.ts` ≈:4912). So the generalisation takes an explicit state predicate, a closed union:

- `active` (the stall lane's, unchanged): `state NOT IN INACTIVE_RUN_STATES_SQL`;
- `merging-at` (the landing lane's): `state = 'merging' AND mergingHead = ?`.

A run that left `merging`, or was advanced again at another head, between the lane's read and the write records nothing and is mailed nothing (`run-gone`).

**Row and mail together.** A mailed edge writes its row and queues its mail in ONE transaction, through `queueLandingNotice` in `server/src/coord/rundefsTx.ts`, beside and in the shape of `queueStallNotice` (≈:170): the observation row under the `merging-at` predicate, then `insertSystemMailTx`. A throw after the row rolls both back, so the next pass tries again. A duplicate row or a gone run writes no mail. Shadow rows and the unmailed green edge use the one-row form (`recordObservation`, the generalised `recordStallObservation`, ≈:2671).

### 3.5 The mail

Subject `checks:#<pr>:<word>@<head7>`, kind `status`, from `operator`, to the coordinator, carrying the `runId`. The body is built in one place, `renderChecksBrief` in `coord/landing.ts`:

- The facts the server owns: PR number, workspace id, the head, the run's state, the word, the generation.
- On `red`: the failing required names, after `landingCheckName` (below), inside `untrustedBlock` (`server/src/coord/untrusted.ts` ≈:48), with a preface that names GitHub as the source. That renderer is the one the ask and approval mails use, so the fence cannot be closed from inside.
- The next act, spelled as the skill spells it: a fix round to the owning worker on `merging → working` for the PR's own red (dequeueing first, §4.3, when the server made an entry). For a red that is not the PR's own, one `gh run rerun <run id> --failed`, where the run id is an integer the server read.

**`landingCheckName`** (L1, pure) reduces a GitHub-supplied name before it enters any mail:
- NFKC-normalise it.
- Replace every character outside `[A-Za-z0-9 _.,:()/+#-]` with `?`. That removes backticks, control characters, newlines and bidirectional overrides.
- Collapse runs of whitespace, and cap it at 80 characters.
- Cap the list at 10 names, with a count of the rest.

A name is never an argv, a shell word, a subject or a file name. `checksFor` keeps its own bound for the PWA and is unchanged, except for the running-check fix if wave 3f has not landed by then (plan PL-1).

### 3.6 Shadow and arming

Until `$REG/landing-checks-live` exists, the arm writes `landing-shadow:checks:…` observation rows (same shape, same generations) and sends no mail. `$REG/landing-disabled` stops every arm of this spec, live or not, and wins over every live marker. Neither marker has a writer in the tree. Both are rows of `SWITCHES` (`shared/switches.ts`), owner C4.

### 3.7 What the coordinator learns at the advance

`POST /api/runs/:id/advance` to `merging` answers an additional, optional block:

    landing: { checks: 'live' | 'shadow' | 'off', enqueue: 'live' | 'shadow' | 'off' }

`landingModes` (L1) computes it from the markers, the ccd capability AND this advance's own measurement. Both words are `off` unless the advance's `verifyDone` measured a bound PR in phase `open`: `measured.prNumber` non-null and `measured.prPhase === 'open'`. A run that reaches `merging` with no bound PR, a draft, or a stacked PR (§6) is outside the arm's population, so the answer says so and the coordinator keeps today's wait. `enqueue` is also `off` when the run is self-claimed (§4.3). `off` also means `landing-disabled` stands or the capability is absent.

The skill reads only this block, never the markers. An older server sends no block, and the skill reads that as `off`.

## 4. Stage 2: the server-armed queue entry

**Gated on §10 Q1 and Q2.** If the operator rules no, stage 2 is dropped, stage 3 mails instead of re-queueing, and stage 4 keeps the coordinator's own enqueue.

### 4.1 The head the coordinator verified

The advance to `merging` already re-measures the fingerprint (`verifyDone`, `handoffCommit === branchTip`, PR bound). The same transaction now records that head in a new nullable column, `runs.mergingHead`, written only by `advanceInner` (`store.ts` ≈:2559) on a move to `merging`. A move `merging → working` clears it. A new migration adds it: `MIGRATIONS[29]`, `user_version 29 → 30`, `ALTER TABLE runs ADD COLUMN mergingHead TEXT`, one nullable column and nothing else, in the shape of migration 29 (`server/src/coord/schema.ts` ≈:1765). `COORD_SCHEMA_VERSION` is `MIGRATIONS.length` (≈:1787) and moves with the array. The slot is re-measured before the PR and before merge, as `schema.ts`'s own comment instructs (`git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'`), because any coord.db migration that lands first takes it. `handoffCommit` keeps its one writer, the close. The server acts on `mergingHead` and nothing else. A coordinator that wants a different head goes back to `working` and advances again.

Stage 1 lands this column too (plan PL-6), because its population and its writer predicate read it.

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

The landing arms run as their own lane, `sweepLandingArms`, on their own schedule (a `LANE_SCHEDULE` row once LaneRunner has landed, #1200 and #1209), reading the records `sweepPr` last stored. They are not run inside `sweepPr`, so an 80 s act never delays the PR sweep. For a run at `merging` with `mergingHead` set:

- `enqueueVerdict` (L1) asks for: required verdict `green`; the head equal to `mergingHead`; the queue word `none`; the run's coordinator resolvable; and the same token on **two consecutive passes**, the act-twice rule of the retention lanes.
- **Never a self-claimed run.** It answers `stop:self-claimed` when `run.claimedBy === run.sessionId`, or when the claimant's own registry row carries a hold matching `HOLD_REASON_PATTERN` (`server/src/coord/rundefs.ts` ≈:108, the shape the hook's `CCRC_HOLD_WAVE_RE` judges) or a child marker (`SessionRecord.child.kind !== 'none'`). Those are exactly the coordinators the session hook refuses `gh pr merge` (§1.5). The server enqueueing for them would bypass that deny, so it does not: the stop is mailed once, and it names the operator's shell, as the lifecycle reference does. A claimant whose row cannot be read is treated as `wait`, and three passes of it mail `landing:#<pr>:unsettled@<head7>`.
- At most **one enqueue per pass, fleet-wide**. The queue serialises at group size 1 anyway, and a burst from many projects is still one act per pass.
- In shadow (no `$REG/landing-enqueue-live`) it writes `landing-shadow:enqueue:<head>` rows, and the coordinator enqueues as today.

**The act, against a send-back.** The token covers GitHub's facts only, and the run's state lives in coord.db. So the act is bracketed by the coordination serialiser, through a new `CoordRoutesHandle` method in the shape of `withSweepAbandon` (`routes.ts` ≈:464-475):

1. Under `coordMutex`: re-read the run. Unless it is at `merging` with `mergingHead` equal to the head, do nothing. Otherwise write `landing:enqueue:<head>:inflight` (the `merging-at` predicate), and leave the mutex.
2. Compose `CCD_ARGV.prEnqueue` and run it, outside the mutex.
3. Under `coordMutex`: write the answer row `landing:enqueue:<head>:<word>`, and re-read the run. If it left `merging`, or `mergingHead` changed, and the answer is `queued` or `armed-*`, mail `landing:#<pr>:enqueued-after-sendback@<head7>`, naming the undo: `gh pr merge <n> --disable-auto` for an armed request, and for an entry the GraphQL `dequeuePullRequest` mutation, which stage 4 adds to the lifecycle reference (today's text spells only the disarm, ≈:805-810, because today the coordinator made every entry itself). That row is written with no state predicate, because the run has moved.

`POST /api/runs/:id/advance` from `merging` to `working` reads the in-flight row inside the same mutex. An `inflight` row with no answer row, younger than the verb's runner budget plus 10 s, refuses the advance `409 enqueue-in-flight` with `retryAfterS`. An older one does not refuse (the act was killed), and an unanswered `inflight` row keeps its run in the lane's population until an answer row is written, so step 3's re-read and mail still happen on a later pass.

**The answers.** Live, the answer is recorded as an observation row. Only these words mail:
- `armed-disarmed`, `armed-disarmed-on-entry`, `not-queued` and `refused:*` mail `landing:#<pr>:<word>@<head7>`: a stop, and the coordinator decides;
- `state-changed` is retried on the next pass, and three in a row mail `landing:#<pr>:unsettled@<head7>`;
- `queued` and `already-merged` mail nothing; `merged:` follows.

### 4.4 Mail only on red, stop, dequeue and merge

With the enqueue arm live for a run, the green edge of §3.4 is not mailed: the server acts on it. What mails is:
- `checks:…:red`, `stuck`, `unmeasured` and `unverifiable` (§3.4);
- `landing:…` stops and `head-moved` (§3.1, §4.3);
- `dequeued:#<pr>@<time>`, whose body now names its cause (§5);
- `merged:#<pr>` or `merged-unproven:#<pr>`.

### 4.5 The merge proof

When the phase reads `merged` (or the queue word reads `landed`), the arm reads `pr-landing` once more and compares: `state` MERGED and `headRefOid` equal to `mergingHead`.
- Equal: `merged:#<pr>` is sent as today, and its body gains the line `proved: MERGED at <head>, the head this run advanced to merging at`.
- Unequal or unreadable: the subject is `merged-unproven:#<pr>`, and the body says which. The coordinator proves by hand as today.

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

A `requeue` verdict, with the enqueue arm live and `$REG/landing-requeue-live` present, re-enqueues through §4.3's bracketed act with no mail and records `landing:requeue:<head>`. Otherwise it mails, saying the signature matched and naming the re-enqueue. A second ejection of the same head always mails. When the dequeue mail is ready before the ejection read answers, the mail waits at most one pass for it, then goes with `cause: unmeasured`.

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
  - an open run at `merging`, claimed by a coordinator other than its own session, whose workspace carries no programme-wave hold and no child marker (§4.3);
  - its `sessionId` a registry workspace;
  - the PR bound to that workspace (`ours`, base-exact);
  - the head equal to `mergingHead`, which that coordinator's own advance verified;
  - for the act, a run re-read under `coordMutex` immediately before and after it (§4.3).

  A PR with no run, a hand-merged PR, a stacked PR, a closed run and a run at any other state are never read for acting.
- **Sessions never run the new act.** `pr-enqueue` is protected in every place the server-only verbs (`ws-reclaim`, `ws-expire`, `ws-collect`, `ws-orphan`) are:
  - the privileged direct-entry guard at the top of `ccd/ccd` (≈:27-29, D-3696, D-3700; "the guarantee is the launcher's `-p` start"), so a direct `ccd pr-enqueue` that did not come through the installed direct entry is refused `entry-unprivileged`;
  - `is_protected` in `ccd/ccd-entry.py` (≈:148-156);
  - the children's deny rules, `_child_deny_json` in `ccd/install-session-hooks.sh` (≈:174-186), so every spawned child's settings carry `Bash(ccd pr-enqueue:*)` and its path-qualified forms;
  - both verb lists in `ccd/session-hook.sh`'s jq, `fmatch` (≈:4483) and `xmatch` (≈:4502);
  - `FORBIDDEN_CCD_VERBS` (`server/src/coord/approvalguard.ts` ≈:124), so the classifier marks it forbidden and no approval can rule one;
  - CLAUDE.md's SAFETY section, a line worded as the `ws-reclaim` line is: the server's act on its own run, behind a token re-proved on the box, never a session's verb, never run against the live host from a shell or a test.

  `pr-landing` and `pr-ejection` are read-only and stay open to sessions.
- **No new merge path for the PWA.** `gh` stays in `FORBIDDEN_COMMANDS`. The grant is `['pr-enqueue','--expect']`, enrolled in `REQUIRED_VERB_FLAG` (`whitelist.ts` ≈:351), and the argv puts `--expect` first so the grant admits it. A census test pins that only the landing lane composes `CCD_ARGV.prEnqueue`, and that no route does.
- **Route Q only, never a synchronous merge.** The verb refuses unless the base requires the queue, so GitHub re-tests the composition before it merges. `--admin` and `--auto` are not in ccd's argv. That is stronger than wave 2b's hook deny, which covers only what the hook can parse.
- **No standing armed request.** The verb disarms an armed request with no entry, both after its own merge call and on entry (§4.2), under its lock.
- **No enqueue after a send-back.** The act is bracketed by run re-reads under `coordMutex`, the send-back waits for an in-flight act, and an act that still lands after the run moved is mailed with its dequeue (§4.3).
- **Fail toward not acting.** `unmeasured`, a cache miss, a lock held, a token seen once, an unreadable claimant, an unknown removal reason and an unknown rule type each act on nothing. Each bounded wait ends in a mail, so the coordinator is never left waiting in silence.
- **Untrusted text.** Check names, job names, test names and log lines are attacker-controllable (fork PRs, any workflow author). They are never an argv, a shell word, a subject, a file name or a GraphQL document. They are bounded in ccd, reduced by `landingCheckName`, and fenced by `untrustedBlock`. Integers (PR number, run id) and shas are validated by regex before they are spelled anywhere.
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
| The queue entry | the coordinator's own `gh pr merge` | the landing lane's enqueue arm through `ccd pr-enqueue` (if Q1 and Q2 say yes) |
| The read-back and disarm | the coordinator | `pr-enqueue` itself, after its act and on entry |
| The merge proof | the coordinator's `gh pr view` | the lane, attached to `merged:` |
| Why the queue removed a PR | the coordinator reading logs | `pr-landing`'s removal word, `ccd pr-ejection`'s records → `ejectionVerdict` |
| Known flakes | CLAUDE.md prose | `LANDING_FLAKE_SIGNATURES` (L0), which CLAUDE.md points at |
| Observation rows | `insertStallObservation`, stall lane only | one writer with a closed state predicate, two lanes |

Every new decision goes into `coord/landing.ts`, the landing lane's L1 owner (D-3883). Every new delivery goes into the landing lane. No second PR poller, notifier, sanitiser, fence or observation writer is added: `untrustedBlock`, `insertSystemMailTx` and the observation writer are reused, and `queueLandingNotice` is `queueStallNotice`'s sibling, not a copy of its body. The new read paths, `pr-landing` and `pr-ejection`, are recorded as legitimately different in §3.2 and §5.1. When the LaneRunner refactors land (#1200, #1209), the arms become a row of `LANE_SCHEDULE` like their neighbours. When parent stage 5's landing line lands, `enqueueVerdict` reads it, and a run that is not next to land waits.

## 9. Wire, deploy and rollback

- **ccd:** three verbs, `pr-landing` (read), `pr-ejection` (read) and `pr-enqueue` (act), and capabilities `pr-landing-v1`, `pr-ejection-v1` and `pr-enqueue-v1`. `CCD_CAN` rows (`server/src/ccdargv.ts` ≈:1161) refuse without them, so every arm is inert on an older ccd.
- **Agent:** grants `['pr-landing','--project']`, `['pr-ejection','--session']` and `['pr-enqueue','--expect']`, with `'pr-enqueue': '--expect'` in `REQUIRED_VERB_FLAG`. Runner budgets in `CCD_VERB_TIMEOUT_MS` (`server/src/remote/runner.ts`): `pr-landing` 35 s, `pr-ejection` 35 s, `pr-enqueue` 80 s, each pinned against ccd's own call timeouts at the 30% reserve the way `pr-timeout-budget.test.ts` pins `pr-state`.
- **coord.db:** `MIGRATIONS[29]` (`user_version 29 → 30`), `runs.mergingHead TEXT`, nullable, re-measured before the PR and before merge. An older build opening the file reads it as-is and never names the column.
- **Server ↔ coordinator:** the optional `landing` block on the advance answer, and the new refusal `409 enqueue-in-flight` on `merging → working`. New subjects `checks:#<pr>:<word>@<head7>`, `landing:#<pr>:<word>@<head7>`, `merged-unproven:#<pr>`. `dequeued:` and `merged:` keep their subjects and gain body sections. The subject builders live once, beside `dequeuedSubject` and `mergedSubject` (`coord/landing.ts` ≈:36-38).
- **PWA:** no change. Observation rows show in the run's history like the stall watch's.
- **No `FLEET_PROTO` bump.** Everything is additive and absence-permits.
- **Order:** agent lane first. The server reads a missing capability as `off`.
- **Rollback:** removing a marker returns its arm to shadow at the next pass. An entry the server made stays in GitHub's queue and lands or is dequeued as any entry is, and the existing `merged:`/`dequeued:` notices still tell the coordinator. `ccrc rollback` of ccd makes the capability absent, which reads `off`.

## 10. Questions for the operator

1. **Does a server-armed enqueue reverse R5?** R5 says "no timer holds MERGE authority", and parent §13 lists "an unattended lander" as out of scope. In stage 2 the server enqueues on a run the coordinator itself advanced to `merging` at a head it verified, and GitHub's queue re-tests before it merges. **Recommendation: rule that stage 2 is an amendment of R5, not a reversal of it.** The coordinator remains the lander of record, and the server performs only the mechanical enqueue it already ordered. Scope it to route Q. Never a direct merge, never `--admin`, never a self-claimed run, and never a run that did not reach `merging` by the coordinator's own advance.
2. **May a ccd verb run `gh pr merge` for the server?** It would be the first merge-class GitHub write the exec whitelist reaches (`pr-open` is the only GitHub write today). `gh` itself stays forbidden. **Recommendation: yes, under §4.2's limits:** fixed argv, a token recomputed on the box under a lock, disarm of any armed request, server-only in every place the destructive verbs are, no route composes it, and sessions are refused it. If no, stage 2 is dropped, and stages 1, 3 and 4 still remove the CI wait.
3. **Stacked PRs: should ccrc read them, and may it force-push a session's branch to rebase and restamp one?** Today no stacked PR is bound, so none reaches an arm (§6). Two separate asks follow. (a) Detection: a second, head-only binding used for detection alone (`isCrossRepository` false, `headRefName` the registry branch, `ours`, any base) would let the lane mail `stacked:` and, when the parent merges, `restack:` naming clause 16's merge-absorb route; `verifyDone`'s phase would still read such a run as having no bound PR, so it would never be enqueued. (b) A server-side restack is `rebase --onto` plus a force-push, and a restamp when `ccd/ccd` changed. It mutates a session's branch, and its local ref sits under a live worktree. **Recommendation: (a) not now, because coordinated waves rarely stack and a second binding is a second answer to "which PR is this workspace's"; (b) no.** Restack through a coordinator fix round, with the worker's own `git merge` under clause 16. Revisit a server-side restack only with all of these: a temporary worktree (never the session's), `--force-with-lease` at the measured old head, a patch-id equality proof between the old and new ranges, an idle pane, and a token. Sub-question: should a patch-id-equal restack keep the review, or need a fresh review run? Recommendation: keep it only once parent §5.4's lineage can prove it.
4. **The flake list and the re-queue budget.** **Recommendation:** seed `LANDING_FLAKE_SIGNATURES` with the measured removal causes (the `fleetws.test.ts` teardown race and the tick-diet shard's job timeout, both since fixed by wave 3c, so they serve as fixtures) and with CLAUDE.md's known load flakes. Re-queue at most once per head. A second ejection always mails. The table changes only by a reviewed PR.
5. **May the coordinator close on the server's merge proof?** **Recommendation: yes.** A `merged:` mail that says `proved:` needs no second `gh pr view`, because the close route re-measures the fingerprint anyway. `merged-unproven:` keeps today's proof by hand.
6. **Arming order.** **Recommendation:** `landing-checks-live` first, after a week of shadow rows agree with the coordinators' own `gh pr checks` outcomes. Then `landing-enqueue-live`, after a week of `would enqueue` rows that each match a real enqueue the coordinator made at the same head. Then `landing-requeue-live`.

## 11. Out of scope and follow-ups

- Workers' CI waits while `working` (worker clause 17 already forbids ending a turn without a wake). A `checks:` mail to the worker of a `working` run would reuse stage 1 whole. That is a separate ruling, because it changes the worker's loop.
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
