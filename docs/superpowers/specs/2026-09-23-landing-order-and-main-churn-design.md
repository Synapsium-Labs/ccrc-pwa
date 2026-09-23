# Landing order and main churn — design

**Status:** design approved in the brainstorm by the operator 2026-09-23 (rulings in §3); rev 2 after a six-lens
adversarial review (61 findings survived, all applied) and a rev-3 verification pass; the operator's ruling on the
written spec's two open decisions recorded 2026-09-23 (R9, R10) · **Date:**
2026-09-23 · **Branch:** `ws/enhance-ccrc-for-parallel-agents` (based on `origin/main` `bbb5e714`) ·
**Companion:** `2026-09-23-session-continuity-design.md`. Two dependencies run between the specs (§9): the
continuity spec's stage 1 must land before this spec's stage 5, and the continuity spec's stage 5 appends its
skill clauses after this spec's stage 1.
**Parents:** `2026-08-07-build7-fleet-coordination-design.md` (runs, mail, the coordinator),
`2026-09-14-review-runs-design.md` (review runs; the fix-round channel this spec reuses),
`2026-09-08-crossrepo-programmes-design.md` (cross-project ordering stays that spec's discipline),
`2026-09-22-child-workspace-reclamation-design.md` (CCR-15; stage 1's fresh child per wave is its rule 3),
`2026-09-18-release-rollout-design.md` (patch-per-merge tagging constrains the queue in stage 2).

The operator's complaint, 2026-09-22: *"the order in which commits land, then cancelled work for some tasks due
to main having moved on … wasted time by agents and constantly having to rebase/pull main into PRs
mid-workflow."* This spec makes landing order a recorded fact, stops the fleet manufacturing absorb rounds, and
lets the coordinator land a tested composition. **The coordinator merges, workers never do, and nothing merges
unattended** (§3, ruling R5).

Stages are numbered 1–5 and stage N is §5.N. References outside §5 use stage numbers.

---

## 1. The problem, measured

Measured on the fleet's six programme repositories over 2026-09-08..2026-09-22, re-derived by a second pass,
corrected by the adversarial passes. Instruments and inputs are archived beside this session's transcript
(`landing-baseline/`, with `instruments/`); §10 names what is committed with the plan so every baseline keeps its
tool.

| Last 14 days, six repositories | Value |
|---|---|
| Agent time spent syncing branches with main (deduplicated transcript episodes) | about 67 h/week, range 29–162 |
| Output tokens spent on the same | about 5M/week |
| Sync episodes | 359: 152 pure ritual, 78 conflict, 129 mixed |
| Share of sync hours inside conflict episodes | 72% (87.6 of 122.5 h) |
| Merges of main needing hand resolution, of those measurable | 112 of 471 (24%) |
| … caught by plain file overlap | 111 of 112 |
| PRs whose first sync happened while the PR was already green | 157 of 262 |
| Local merges of main repeating an earlier one on the same PR (all committers) | 185 of 336 |
| This repository's wait from green to merge | median 33.4 min, p90 18.2 h, max 243 h |
| This repository's merges credited to the fleet's single GitHub login, each past a ruleset approval nobody gives | 83 of 83 |
| Merge-of-main commits that were GitHub `update-branch` | 187 of 546, 183 inside one 55.7 h strict-protection window |
| Sync episodes from sessions that load no ccrc skill | 27% |

In order of cost:

1. **Conflicts are where the hours go, and this repository is the hotspot.** A conflict episode's median is 28
   active minutes plus a 16-minute local re-gate; a clean sync is two minutes. This repository runs a 46%
   conflict rate and 41 of its 64 merges of main were hand-resolved, because its suites pin exact tree-wide
   values that every landing moves. That is repository test design and gets its own programme (§8).
2. **Nobody decides landing order.** No table, route, field or verb records or enforces one (grep over
   `server/src`, `agent/src`, `shared`, `pwa/src`, `ccd`, `deploy`: 0 hits). Coordinators agree an order in
   mail and a batch merge overrides it: one programme ruled D→A→B and merged B, A, D within three minutes,
   costing a recovery PR, an abandoned 82-commit rebase and a follow-up PR. On this repository every merge goes
   past an approval rule nobody can satisfy, so every merge needs the admin bypass, whoever types it — the fleet
   has one GitHub login and transcripts show sessions issuing some of the 83.
3. **Ritual syncs are avoidable.** 60% of PRs that ever synced were already green before their first sync, and
   more than half of local merges of main were repeats on the same PR. On intake-platform, one of the two
   repositories with strict up-to-date protection, git reproduced 67 of 68 merges of main without a hand edit
   (93 of 99 across both strict repositories): strict mode is a queue done by hand, one worker round per sibling
   landing.
4. **The one ordering mechanism tried so far livelocked.** A coordinator turned on strict protection as its
   ordering mechanism (operator-approved); a co-owner's auto-update watcher then pushed main into every behind
   PR: 183 `update-branch` commits in 55 hours, 36 on one PR, each restarting CI. Nothing forbade either act.
5. **`update-branch` breaks the workspace↔PR binding.** `is_ours` (`ccd/ccd:5399`) binds a PR by ancestry from
   the workspace's LOCAL tip; a remote-side update produces a descendant, the sweep rebinds to an older PR, and
   the close refuses `pr-regressed` (run 47, 2026-09-16).
6. **A review or a wave-done is evidence about one sha.** `verifyDone` (`server/src/coord/fingerprint.ts:230`)
   and `verifyReviewDone` (`:309`) compare shas exactly, so a merge of main git makes with no hand edit still
   costs a fresh wave-done and, after review, a fresh review run.
7. **Main goes red and every open PR inherits it.** This repository's `ci` workflow was red on main for 111.2 h in
   9 intervals; 4 of them (36.0 h) failed only the non-required macOS legs, and 5 intervals lasting 75.2 h in
   total contained at least one required-leg failure. 50 of 92 PR CI failures fell inside those windows, measured against the whole workflow; the
   required-legs-only overlap is a plan prerequisite (§10).
8. **Skill text alone cannot fix it.** 27% of sync episodes come from sessions that never loaded a ccrc skill.

Measured and found NOT to help, so it is not re-proposed: the AST knowledge graph predicts hand resolution no
better than file overlap (0 of 15 extra flags caught; a git-only "two or more shared files" rule beats every
graph feature), orders concurrent PRs at a coin flip (43 agree, 51 reverse of 94 directed pairs), and has no
edges into the files where conflicts live (`ccd/ccd`, README, ledgers, lockfiles). File-lane serialisation
delayed most PRs in simulation. Third-party queue apps need a standing repo-write token on the repository that
takes untrusted input. GitHub's native queue is eligible on this repository only; the five private
repositories are on plans that exclude it.

## 2. What the parent designs already say

- Build 7 §7: the coordinator dispatches the SDD shape and does not reinvent it. It stays the one that rules and
  merges; this spec gives it a recorded order and a tested composition to rule on.
- Review runs §4: the worker persists until review clears and a send-back is a `fix-round` mail. Ejection from
  the landing line (stage 5) is the same mail on the `merging → working` edge, which exists.
- CCR-15 rule 3: one PR per child; a spent child refuses a further run bind; the next run opens without a session
  id and dispatch mints a fresh child (`server/src/coord/dispatch.ts:418`). Stage 1 makes that every wave's
  path. Reclamation of spent children is CCR-15's later wave; until it ships each wave leaves one more live
  child (§9).
- Cross-repo ruling 4: a consumer wave is dispatched only after the producer's PR is proven merged at an exact
  sha. Ordering ACROSS repositories stays that discipline; the landing line orders within one repository.
- Release rollout: every push to `main` becomes a prerelease and `release-main.sh:60` tags HEAD only, so a push
  carrying several commits leaves the earlier ones untagged (stage 2's proof run).

## 3. Decisions settled in the brainstorm

| # | Ruling (operator, 2026-09-22/23) | What it fixes |
|---|---|---|
| R1 | The pain is LANDING (order, cancelled work after main moved, absorb rounds), not visibility. | The edit-ledger direction from the earlier analysis is out. |
| R2 | Two specs: landing (this) and session continuity. | §9. |
| R3 | Coordinators may enqueue on this repository's native queue on their own. | Stage 2. |
| R4 | A fresh workspace per wave. | Stage 1, step 6. |
| R5 | **No unattended lander.** "It's the coordinator's job to do merges, not the sub-workspace's, as it is the coordinator that bears ultimate merge responsibility (ultimate after the human)." | No timer holds MERGE authority; workers never merge; the coordinator composes, tests and merges from its own shell. |
| R6 | No headroom estimation. | Nothing here reads account headroom. |
| R7 | The knowledge graph is not used for landing (measured). | §1's closing paragraph; §13. |
| R8 | Mergify and other queue apps rejected; file-level lanes rejected. | §13. |
| R9 | Break-glass: the repository-admin role stays the ruleset's only bypass actor (operator, 2026-09-23, on the written spec). | Stage 2; §4's operator row; §11. |
| R10 | Strict protection comes off intake-platform and data-internal after a week of coordinator landings with composition tests there (operator, 2026-09-23, on the written spec). | Stage 5; §11. |

## 4. Roles and authority

Identity on the fleet is attribution, not authentication: one UNIX user, one GitHub login, one box token shared
by every session. Where a row below says "may not", the column names the MECHANISM that holds it, or says there
is none.

| Actor | May | May not, and what holds it |
|---|---|---|
| **Worker** (a run's session in a child workspace) | commit and push its own branch; absorb main under clause 16's triggers; re-gate; report wave-done | merge (**the PreToolUse hook denies `gh pr merge` in a session whose hold names a worker wave**, stage 2); rebase, force-push, `update-branch`, settings writes (clause 16, prose; `update-branch` absent from executable source, pinned) |
| **Coordinator** | declare order; run the composition; enqueue or merge at the pinned head; send fix rounds; pause the line | use the admin bypass (**the hook denies `gh pr merge --admin` in every fleet session**, stage 2); `update-branch`; settings writes (clause 15) |
| **ccd** | the read-only probe on a timer; compose a candidate; delete its own candidate refs; lineage | move a worker's branch; merge; push or delete anything outside `refs/heads/ccrc/land/*` (pinned) |
| **Server** | hold the line; mail "next to land"; re-measure what ccd wrote; refuse bad transitions | run git or `gh` (`EXEC_COMMANDS` stays `['tmux','ccd']`); take a run to `working` on its own; choose a successor |
| **Operator** | pause, withdraw, declare order; merge by hand (recorded as an inversion when out of order); break-glass through the admin bypass from their own shell or GitHub's UI (R9) | — |

The PWA cannot reach a merge: `gh` stays unwhitelisted, no ccd verb merges, and the session-gated landing routes
can pause or remove, never choose a successor (stage 5).

## 5. The design, in stages

### 5.1 Stage 1 — stop manufacturing churn (skills, hook, one CLI; no server change)

**Worker clause 16** (the pin moves from 15 to 16). A worker absorbs `origin/main` only on one of three triggers:

1. its own probe says the branch conflicts (`git merge-tree --write-tree` against a freshly fetched
   `origin/HEAD` exits 1; the fleet box runs git 2.43);
2. a required check on the PR is red while main's latest push run of the same required job is green;
3. the PR was ejected from the landing line with a base sha, or, in a strict-protection repository, the
   coordinator names it next to land (a land-sync). Both arrive on the `merging → working` edge as a fix-round
   mail, because worker clause 9 forbids pushing after wave-done; the worker absorbs, re-gates and sends a fresh
   wave-done. From stage 4 on, a land-sync whose only change is a clean merge of main is accepted by lineage
   with no new review, and the next `advance → merging` re-pins the landing entry.

Triggers 1 and 2 each license at most one absorption per PR; a second occurrence before the first absorption
lands is not a second license. Trigger 3 is bounded by the coordinator's naming. Under every trigger: `git merge`
only, never a rebase, a force-push or `update-branch` by any route including `gh api -X PUT`; generated files are
never hand-resolved (take either side, then run the regenerator); a red that main also shows is reported once as
`main-red` and left alone; never maintain a local `main`, read `origin/HEAD` after one fetch.

**Coordinator clause 15** (14 → 15). The coordinator never calls `update-branch`, never writes rulesets,
protection, auto-merge or `allow_update_branch`, sends a rebase-check only on a conflict it has measured, sends
a land-sync only to the PR it named next in a strict repository, never merges main into any workspace but its
own, and commits programme-ledger documents on its own ledger PR, never inside a feature PR (the ledger file was
the hottest overlap file in three repositories).

**Step 6 of the wave lifecycle.** Once the predecessor's PR measures merged, wave N+1's run opens WITHOUT
`sessionId`, so dispatch mints a fresh child from current main. A wave that must overlap its predecessor is a
deliberate stacked child, named in the brief, and pays one absorb knowingly. Open-before-close is unchanged.
This step goes live only with CCR-15's reclaim-on-close wave (§9); before that, every wave leaves a live child
the operator archives by hand.

**The hook reaches sessions the skills do not.** `ccd/session-hook.sh`'s PreToolUse arm (matcher `*`) sees every
Bash call. On a command that merges, pulls or rebases `main` into the current branch it emits `additionalContext`
naming the three triggers and the probe command. It never denies. This covers the 27% of sync episodes in
sessions with no skill.

**The regenerator gets a CLI.** `ccd/ccd`'s line 2 carries a digest of the file's body with the marker line
stripped; the regenerator exists as `markGenerated` in `shared/mark.mjs`, and `server/test/ownership.test.ts`
is already red on an unstamped file. Stage 1 adds a one-line CLI around it (`ccrc restamp <file>`) and clause 16
names it; 17 of 25 hand resolutions on that file were the stamp alone.

**Pins.** `update-branch` is pinned ABSENT from executable source (`server/src`, `agent/src`, `ccd/ccd`,
`ccd/ccd-*`). In the skill corpora it is counted, not absent: the clauses name it once each to forbid it, and a
count pin in the style of `coordinator-skill.test.ts`'s existing literal counts holds that number. The two skill
pins move in the same commit as the clauses, together with the clause-count words in `README.md` and `CLAUDE.md`
that both pins read.

Removes: pure-ritual syncs outside strict repositories, every fleet `update-branch`, the repeat-absorption share,
and the class of act that opened the livelock window.

### 5.2 Stage 2 — GitHub's native merge queue on this repository

**Repository code.**
- `.github/workflows/ci.yml` gains `merge_group:` beside `pull_request:`; the non-required macOS legs get
  `if: github.event_name != 'merge_group'`; a `concurrency` group with `cancel-in-progress` for `pull_request`,
  so a superseded head stops occupying runners.
- `ccd pr-state` gains one GraphQL query per repository per sweep (`pullRequest.mergeQueueEntry` and the last
  `REMOVED_FROM_MERGE_QUEUE_EVENT` in `timelineItems`), separate from its `gh pr list --json` call, under its own
  bounded timeout, answering `queued | dequeued | landed | none | unmeasured` in an additive `queue` field; the
  pr-state header's gh-call budget is updated to say so. A dequeue (GitHub does not re-enqueue after a failed
  group) becomes a feed event and a mail to the coordinator, which re-enqueues or sends a fix round.
- **The merge gate becomes a mechanism.** Setting the approval count to zero means any session holding the
  fleet's login could land with a plain `gh pr merge`. So `session-hook.sh`'s PreToolUse arm DENIES `gh pr merge`
  in any session whose hold names a worker wave, and denies `--admin` in every fleet session, together with a
  `gh api` call to the pulls merge endpoint, the other spelling that reaches the same merge. Mutation rows: a
  worker's merge is refused; a coordinator's plain enqueue passes; any session's `--admin` is refused; a session's
  `gh api` merge call is refused; each red when its arm is deleted. The operator's own shell, outside Claude Code,
  is unaffected. The hook is a contract the fleet honours, not an access boundary.
- Coordinator clause 15 says: on a native-queue project, landing is `gh pr merge <n>` with no `--admin`, which
  enqueues.

**Operator configuration** (settings, not ccrc code): a ruleset requiring the merge queue on `main` — squash,
group size 1, build concurrency 1 — and `required_approving_review_count` 1 → 0 in the existing main ruleset.
Break-glass (R9): the repository-admin role stays the ruleset's only bypass actor. The fleet's single login holds
that role, so the bypass is reachable from any session; the hook denies the spellings it can parse, which makes the
bypass the operator's by convention, not by credential. The operator uses it from their own shell or GitHub's UI.
A hand merge out of order is recorded as an inversion.

**Rollout order inside stage 2**, because each step needs the one before it:
1. `ci.yml` gains `merge_group` (repository code, merged the ordinary way);
2. the operator enables the queue ruleset and sets approvals to 0 (a PR can be enqueued only once a queue rule
   exists; a scratch-branch queue ruleset is an alternative for the proof);
3. **the proof run**, which is stage 2's own gate: enqueue two or three trivial PRs at once and check one push
   event and one prerelease per merge; if a group lands several commits in one push, keep group size and
   concurrency at 1 or make release-main tag every commit in the pushed range; confirm `is_ours` still binds
   after a queue merge;
4. only then does the hook's deny on `--admin` go live. Until approvals are 0, every merge here still needs
   `--admin`, so the deny shipping first would stop every fleet merge on this repository.

Removes: the operator-as-queue wait (median 33 min, p90 18 h), landing an untested tree here, and this
repository's fleet inversions (5 pairs in the window).

### 5.3 Stage 3 — the conflict radar (ccd, read-only)

A timer-driven sibling script, `ccd-land-probe`, in the shape of `ccd-pool-sync` and `ccd-tmp-sweep` (oneshot,
flock, pause file, env-overridable knobs, doctor check), acting only on projects listed in
`~/.ccrc/landing/<project>.conf`. Per project per tick:

1. fetch `origin/main` and every open fleet head (`refs/pull/N/head`) into a per-tick scratch object directory
   with alternates to the project repository, never a persistent mirror;
2. `git merge-tree --write-tree --name-only` for main × each head and pairwise across heads (at most 10):
   `clean | conflict <paths> | unmeasured`;
3. read the REQUIRED contexts' check-runs on main's tip as `main-health`;
4. compute each workspace branch's lineage (`refs/heads/ws/*` read from the project repository, not only PR
   heads): at most 8 first-parent steps, each a two-parent merge whose second parent is on the fetched base and
   whose tree equals `merge-tree(P1, P2)`;
5. write `$REG/landing/<project>/probe`, `<id>.lineage` and `main-health`; a failed fetch writes `unmeasured`.

The probe runs with the host credential, which carries repo-write scope; it is read-only by code. A literal
absence pin on `ccd/ccd-land-probe` forbids `push`, `gh pr merge`, any `gh api` method other than GET, and
`update-branch`, and is shown red by planting each.

The server gets one reviving reader in `FleetWatcher`; the wire gains optional `FleetSession.landing` and
`RunSummary.landing` (absence = unknown); the PWA shows a read-only predicted-conflict chip beside the hot-files
strip. `git count-objects` before and after a cycle is a doctor measurement.

Removes: coordinator sync and order threads sent without a measured conflict, inherited-red investigations, and
produces the lineage stage 4 consumes.

### 5.4 Stage 4 — a clean merge of main keeps its wave-done and its review (server, fixture-git tests)

The lineage path runs only for a project whose landing conf opts in. The conf lives on the fleet box, where the
agent's read whitelist does not reach, so the probe mirrors it as `$REG/landing/<project>/enabled`, which the
agent can read, and the server reads that marker through `readFileMeasured` so absent and unreadable stay
distinct. When the live tip differs from the claimed tip:

| Lineage state | Answer |
|---|---|
| marker absent (project not opted in) | `stale-tip` / `stale-review` exactly as today |
| marker unreadable | `stale-tip` / `stale-review`, with the distinct detail `landing-marker-unreadable` |
| probe paused for this project | `stale-tip` / `stale-review` exactly as today |
| lineage file older than the live tip's ref (not yet ticked) | NEW `lineage-unmeasured`, answered synchronously, recorded and mailed under its own subject so the worker or coordinator re-sends after the next tick |
| lineage current, claimed tip in a base-only chain ending at the live tip, fetched base named | accept, `measured.via:'base-only-merge'` |
| lineage current, no such chain | `stale-tip` / `stale-review` |

Nothing re-checks a claim later; the server stores no claim and advances nothing on its own. Fixture-git
mutation tests: a clean merge accepted; a hand-edited merge refused; a rebase refused; a second parent not on
base refused; a tip that moved between reads refused; a stale lineage answers `lineage-unmeasured`; a project
with no marker and a moved tip still answers `stale-tip`; an unreadable marker answers `stale-tip` with its own
detail; each red when its guard is removed. Worker clause 9 gains
its exception in the same PR.

Removes: refusals traced to main syncs (at least 6 of 11 mailed refusals), the discarded review after a clean
absorption, and the re-send round per land-sync in strict repositories.

### 5.5 Stage 5 — the landing line, and the coordinator lands (server data, one ccd verb)

**Data, split by authority.** One `coord.db` migration (the slot is a cross-branch namespace; check
`origin/main`'s `MIGRATIONS.length` at PR time) adds:

- `landing_entries(project, repo, pr, pinnedSha, handoffCommit, runId?, afterIds, fixesMain, state, baseSha,
  setBy, detail)`;
- `landing_projects(operatorPaused, mainRedHold)`: two booleans, because they have different remedies; the line
  is paused while either is set;
- `landing_intents(runId, project, key)`, keyed to runs, taken at dispatch, independent of entries.

Columns re-measured from ccd's files — `pinnedSha` and landed state — are recomputable; order edges,
`fixesMain`, pause, withdrawals and intents are **central authoritative state**, like `pool_edges`, journalled to
`~/.ccrc/landing.log`. On reconstruction the journal wins for authoritative columns and the sweep wins for landed
state. `CLAUDE.md`'s coord.db invariant is amended to name this second exception.

**Entries and pins.** An entry is created on `advance → merging`, pinned to the verdict's `measured.branchTip` —
the actual PR head, which after stage 4 may be a base-only merge — with `handoffCommit` kept as its own column.
`--match-head-commit` and the landed check both read `pinnedSha`. `POST /api/landing/entries` covers a PR with
no run. Order defaults to first-green; `POST /api/landing/order` sets `after` edges. Dispatch gains optional
`intents[]` answering 409 `intent-held` (28 PRs in 120 days were closed unmerged because a sibling landed the
same change first).

**Writes are attributed, not authorised.** The box token is shared by every session, so order edges, entries and
`fixesMain` record the calling session in `setBy`; a feed event fires when a session other than the run's
coordinator sets an order edge or `fixesMain`, and every `landing-inversion` event names who reordered. The
skills say `fixesMain` is the coordinator's or the operator's to set; nothing on the box can enforce that, and
the spec does not claim it.

**Landed state is PR-keyed.** `pr-state` gains a third form, `ccd pr-state --project <p> --pr <n>`: one
`gh pr view <n> --json state,mergedAt,mergeCommit,headRefOid` under its own timeout, answering
`open | merged | closed | unmeasured`, with no workspace binding. It rides the existing `['pr-state','--project']`
prefix grant, gets its own `CcdArgv` brand, and the pr-state header's gh-call budget counts one call per open
landing entry per sweep. A reader walks entries with it, separate from `sweepMerged`'s per-workspace loop, so
no-run entries and hand merges are seen. The coordinator's own merge step also reports the result.

**Next to land.** The radar names the head whose composition against the current base is clean; the server mails
the coordinator once. Mail is idle-gated: the delivery-to-turn latency is a plan prerequisite (§10), not a
figure this spec asserts.

**The coordinator lands**, from its own shell, never from a timer or the PWA:

1. **On a native-queue project** (this repository) the queue is the composition test: the coordinator enqueues.
2. **Elsewhere** `ccd land-candidate --project <p> --pr <n> --base <sha>` composes
   `C = commit-tree(merge-tree(B, H)) -p B -p H`, with H the PR's head, and pushes it, non-force, to
   `refs/heads/ccrc/land/<project>/pr-<n>/<base12>` — a fresh name per base, so re-composing after main moves
   never needs force, and no coord.db id is needed on the fleet box. Each `lander:coordinator` repository declares how its CI runs on that ref (a push trigger
   on `ccrc/land/**`, or the coordinator's own `gh workflow run --ref`). The verb is not whitelisted to the PWA.
3. On green, the coordinator re-measures `origin/main == B` and merges with
   `gh pr merge <n> --<declared method> --match-head-commit <pinnedSha>`, never `--admin`. The window between that
   check and the merge remains on a plain merge and is stated, not hidden; `merge-tree` reproduced GitHub's squash
   tree on all 38 measurable of 40 PRs checked here (2 unmeasured, objects missing), and each repository's merge
   method is covered by a proof run before it is declared `lander:coordinator`.
4. When an entry lands, is withdrawn or is ejected, the coordinator runs `ccd land-candidate --project <p> --pr <n>
   --drop` from its own shell, which deletes that PR's `ccrc/land/<project>/pr-<n>/*` refs — the only delete ccd
   may issue, pinned to that family. A withdraw from the PWA reaches the coordinator as a notice mail, so the same
   actor drops the refs.
5. On a conflict, or a red after one automatic re-run of failed jobs, the coordinator sends the owning worker a
   `fix-round` mail naming base B and the paths or checks, on the `merging → working` edge; the entry goes
   `ejected` and is re-pinned on the next `advance → merging`. A fix round that changes content needs a new
   review run, as today; a clean base-only absorption does not, and stage 4 re-pins the entry to the new tip. A
   second ejection of the same entry becomes an operator ask.
6. When required contexts are red on main the line sets `mainRedHold`; only a green `main-health` reading clears
   it, and nothing automatic clears `operatorPaused`. Mutation rows: an operator pause survives a red-to-green
   transition; an operator pause set BEFORE main goes red survives the red and the later green. Entries with
   `fixesMain` jump the queue.

**PWA doors.** Two routes, both in the `SESSION_ONLY` class (session-gated, no box token, NOT the ungated
wedge-release class), registered in `server/src/coord/routes.ts` so the two scanners that read that file alone
see them: pause the project's line, and withdraw an entry with a coordinator notice. The pinned property:
a session-only route may pause the line or remove an entry, including the head, but never chooses or reorders
which entry becomes head — the successor is whatever the recorded order and the radar already say.
`landing-subtractive.test.ts` pins that; `coord-pause-route.test.ts`'s `SESSION_ONLY` set and
`box-token-census.test.ts` gain the routes in both directions, with `CLAUDE.md`'s box-token bullet.

**Strict protection comes off** intake-platform and data-internal only after the coordinator has landed there
with composition tests for a week.

Removes: order negotiated in mail, fleet-controlled inversions, duplicate-intent races, and untested compositions
of the "main went red after two PRs landed 28 minutes apart" class.

### 5.6 Repository hygiene the operator owns (not ccrc code)

- Every repository: `concurrency` with `cancel-in-progress` on `pull_request` workflows.
- Append-only registries (a chat log, a ledger): `.gitattributes … merge=union` where the measured resolutions
  were union-shaped (18 of 46 and 23 of 32 on two such files).
- `delete_branch_on_merge` unchanged; fresh children remove the stacking hazard.
- The ruleset changes of stage 2 and the strict-protection flips of stage 5.

## 6. Surfaces touched

| Area | Change |
|---|---|
| `ccd/worker-skill/SKILL.md`, `ccd/coordinator-skill/SKILL.md`, `references/wave-lifecycle.md` | clauses 16 / 15, step 6, land-sync and ejection vocabulary; pins in `worker-skill.test.ts`, `coordinator-skill.test.ts`; clause-count words in `README.md` and `CLAUDE.md` |
| `ccd/session-hook.sh` | PreToolUse advisory on main syncs; deny on `gh pr merge` for workers, and on `--admin` and `gh api` merge calls for all sessions |
| `ccd/ccd` | `pr-state` GraphQL queue query and the `--project --pr` form; `land-candidate` with `--drop`; lineage hooks; re-stamp and the citation-corpus procedure |
| `ccd/ccd-land-probe`, `deploy/systemd/ccd-land-probe.{service,timer}` | the radar and the `$REG/landing/<p>/enabled` marker; install spine, uninstall, doctor |
| `ccd/ccrc` | `ccrc restamp` |
| `server/src/coord/fingerprint.ts`, `shared/api.ts` | opted-in lineage path, `lineage-unmeasured`, `measured.via` |
| `server/src/coord/{schema,store,routes,landing}.ts`, `server/src/watch.ts` | landing tables, routes (doors in `routes.ts`), mail, inversion event, PR-keyed landed reader |
| `server/test/coord-pause-route.test.ts`, `box-token-census.test.ts`, `landing-subtractive.test.ts` (new) | the new doors in both directions |
| `agent/src/whitelist.ts`, `server/src/ccdargv.ts` | no grant for `land-candidate`; the `pr-state --project --pr` form rides the existing prefix grant with its own `CcdArgv` brand |
| `pwa/src` | predicted-conflict chip; the line on the project card; pause and withdraw |
| `.github/workflows/ci.yml` | `merge_group`, macOS skip, concurrency |
| `CLAUDE.md` | coord.db invariant (central landing state), box-token bullet, ccd-verb rule wording |

## 7. Invariants kept, and two amended

- `gh` has no whitelist entry; no ccd verb merges; `EXEC_COMMANDS` stays `['tmux','ccd']`; the PWA cannot reach a
  merge or choose a successor.
- Wire additive-only; `FLEET_PROTO` stays 1; one reader per field; absence means unknown.
- Box token gates every landing write except the two `SESSION_ONLY` doors; the census tests are extended.
- The done-fingerprint still re-measures the workspace tip; stage 4 widens acceptance only along a ccd-proven
  chain, only for opted-in projects.
- **Amended — coord.db.** Landing order, pauses, withdrawals and intents are central authoritative state with a
  journal, the second named exception after `pool_edges`.
- **Amended — ccd verbs.** "Zero new ccd verbs for coordination mutation" is read as written (runs and mail).
  `land-candidate` is a fleet git act in the `pr-open` class: it pushes and deletes only its own
  `refs/heads/ccrc/land/*` family, non-force. `ccd-land-probe` is read-only by code. The operator reshapes the
  rule's wording in `CLAUDE.md`; a worker does not.
- **R5 restated precisely:** no timer holds MERGE authority. The probe holds the repo-write credential and is
  read-only by code, pinned.

## 8. The companion programme: this repository's test design

The dominant conflict driver here is not the branch model. Suites pin exact tree-wide values: the session-hook
citation census, `ccd/ccd`'s generated stamp, call-count prose, `COORD_SCHEMA_VERSION` and migration slots,
cross-tree deviation checks. Each branch is green alone and red on the merge. A separate programme replaces exact
pins with values derived at check time where a derivation exists and documents the rest as deliberate. Metric:
hand-resolved merges of main per week here (baseline 41 of 64 in 14 days) and re-derivation commits per PR (45–48
headlines in the last 40 merged PRs). Stage 1's `ccrc restamp` is its first deliverable.

## 9. Sequencing

- Stage 1 first; stage 2 builds on stage 1's coordinator clause 15, so it lands with or after stage 1.
  Stage 1's step 6 goes live only with CCR-15's reclaim-on-close wave.
- Stage 3 next; stage 4 needs stage 3's lineage.
- Stage 5 needs stages 3 and 4 and **the continuity spec's stage 1** (the sidecar carry merge): a coordinator
  parked on a limit cannot land until rescued, and after a rescue it must find its journals on the new account.
- The continuity spec's stage 5 appends its skill clauses after this spec's stage 1 (clause numbers are assigned
  at merge; the pins derive nothing, so the later PR renumbers).
- Rollout inside each stage follows AGENT-FIRST: ccd and the skills reach every home through `ccrc update` before
  the server and PWA read what they write.

## 10. Measurement, targets and the kill rule

Baseline frozen at 2026-09-08..2026-09-22. `deploy/measure-landing.py` (read-only, run by hand on the fleet box)
is committed with the plan together with the archived instruments it wraps (the `--remerge-diff` classifier, the
committer classifier, the transcript episode scan deduplicated by tool-use id, the red-main scan, the
green-to-merge and inversion scans).

**Prerequisites the plan measures before its first stage ships:** red-main from required contexts only, with its
PR-failure overlap; mail delivery-to-turn latency for coordinators; the repeat-absorption share restricted to
fleet committer identities. Stage 2's proof run is stage 2's own gate, not a prerequisite.

| Stage | Metric | Baseline | Target |
|---|---|---|---|
| 1 | fleet `update-branch` commits; fleet repeat absorptions per PR; pure-ritual episodes per week | 8; prerequisite; about 76 | 0; under a third; halved |
| 2 | this repository's green-to-merge wait; required-leg red hours on main; this repository's fleet inversions | 33 min median, 18 h p90; prerequisite (whole-workflow red hours in the intervals with a required failure: 75.2 h); 5 pairs | under 10 min median; halved; 0 |
| 3 | coordinator sync/order mails without a measured conflict | about 14 of 629 feed rows | near 0 |
| 4 | done/review refusals caused by a clean main sync | at least 6 of 11 | 0 |
| 5 | fleet-on-fleet landing inversions on `lander:coordinator` repositories; duplicate-intent closed PRs | expoAI 14 pairs, custom-tools 2, intake-platform 0, data-internal 0 in 14 d (all actors, expoAI: 79); 28 in 120 d | under 3; under 5 |

A stage whose metric has not moved two weeks after rollout is retired or redesigned; stage 1's prose parts
(clauses, the advisory) are explicitly subject to this rule.

## 11. Operator decisions

Decided on the written spec, 2026-09-23:

1. **Break-glass on this repository's queue** — R9: the repository-admin role stays the ruleset's only bypass
   actor. The hook stops fleet sessions using `--admin`; the operator keeps a direct door for a broken CI or
   release lane.

2. **Strict-protection removal** — R10: on intake-platform and data-internal, after a week of coordinator landings
   with composition tests there.

## 12. Failure modes named

- A composition tested green at base B lands after main moved to B′: the native queue re-tests; on a plain merge
  the coordinator re-measures B and re-composes under a new ref name, then drops the old one.
- The probe's scratch objects grow: bounded per tick, measured by doctor.
- A worker pushes a clean merge after wave-done before stage 4: that is why clause 9's exception ships with
  stage 4.
- The coordinator is on a limit when "next to land" arrives: the mail waits; the continuity spec makes the
  rescued coordinator able to act.
- A hand merge out of order: recorded as an inversion, never refused.
- A session hand-edits `$REG` or the box token is used by a worker to reorder: recorded with `setBy` and a feed
  event; identity is attribution, and this spec does not claim otherwise.

## 13. Out of scope, named

The edit ledger and anchored review comments; the knowledge graph in any landing role (measured no signal);
third-party queue apps; file-level lanes; serialising dispatch by path ownership (reverses the advisory-claims
ruling); an unattended lander (R5); headroom estimation (R6); controlling actors outside the fleet (their
inversions are recorded, not prevented).
