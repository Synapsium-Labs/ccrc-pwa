# A worker's PR stays a draft until its review passes

**Goal.** A PR still under review must not be landable (the owner's ruling of 2026-11-24). An unattended lander lands
every green, non-draft PR whose author holds the maintainer role or higher on its repository, and the fleet's PRs are
such PRs, so a worker's PR that is green before its review has run could land unreviewed. So workers open their PRs as
drafts, and the coordinator marks a PR ready for review (`gh pr ready <n>`) only when its review passes (its `wave-done`
verified and the review run's report ruled accepted), immediately before it lands it.

## What was built

| Where | What |
|---|---|
| `ccd/worker-skill/SKILL.md`, clause 16 | Its last sentence, "You never merge your own PR", now says the worker opens the wave's PR as a draft (`gh pr create --draft`), never marks it ready and never merges it. The reporting table names the draft, and the example body's `prPhase` reads `draft`. Clause count unchanged (20); the pin in `server/test/worker-skill.test.ts` changes with it. |
| `ccd/coordinator-skill/SKILL.md`, clause 15 | "A worker never merges its own PR" becomes "never marks its own PR ready or merges it", and the clause gains the rule: every worker PR is a draft; this session marks it ready only once its review passes, immediately before the advance to `merging` that begins its landing, and turns it back into a draft (`gh pr ready <n> --undo`) before any send-back from `merging` to `working`. Clause count unchanged (22); the pin in `server/test/coordinator-skill.test.ts` changes with it. |
| `references/wave-lifecycle-2-dispatch.md` | A third sentence that goes in every brief that may open a PR: open it as a draft and never mark it ready. The reason is the branch sentence's: a home that has not had the installer has only the brief. |
| `references/wave-lifecycle-4-advance.md` | **Ready, then `merging`**, inside the advance bullet: the ready comes before the advance to `merging` on every landing route, and the claim's `prPhase` stays the worker's `draft`. |
| `references/wave-lifecycle-5-boundary.md` | The native-queue landing paragraph: `gh pr ready <pr>` before the advance to `merging`, why (D-8999), the undo before a fix round from `merging`, and the held coordinator's case. The whole-paragraph pin changes with it. |
| `ccd/session-hook.sh`, THE WORKER READY DENY | `GH_READY_RE` (derived from `GH_MERGE_RE` by cutting its verb tail at `GH_READY_CUT`) asked of the worker merge deny's stripped text, in a session whose hold names a programme wave or whose workspace carries the child marker. `--undo` anywhere in the stripped command passes. |

`WORKER_KICKOFF_PREFIX` (`server/src/coord/dispatch.ts`) is one sentence that invokes the worker skill and names no PR
step, so it is unchanged: the brief sentence and worker clause 16 carry the rule.

**Why the hook and not the deny file.** `gh pr merge` is refused to a worker by the session hook's merge arm, not by
`childDenyRules`, and `gh pr ready` is refused the same way. The deny file's matcher reads a prefix, so `Bash(gh pr
ready:*)` would also refuse `gh pr ready <n> --undo`, the worker's remedy for a PR it opened ready, and it would reach a
child only, never a held top-level worker. The merge arm's strip already tells a command from a mention (a commit
message, a PR body, a heredoc), so the arm extends that owner and adds no parser.

**A coordinator is never asked.** A session with no wave hold and no child marker runs `gh pr ready` as before. A
coordinator whose own workspace carries one (a self-claimed run, or a reclaim heir) is refused like a worker, as it is for
the enqueue, and the boundary reference sends it to the operator.

## What does not change, measured

- **CI runs on drafts (D-9000).** `ci.yml`'s `pull_request` trigger lists no `types:`, so it takes GitHub's defaults
  (`opened`, `synchronize`, `reopened`), which fire for a draft as for any PR, and no job or step reads `draft` (no
  `github.event.pull_request.draft` anywhere under `.github/`). So a worker's draft gets the fast run and the review
  sees its checks. `ready_for_review` is not a default type, so marking a PR ready starts no second run: the required
  checks are per head commit, and the draft's green stands on the same head. `codeql.yml` is the same. Nothing in CI
  changes.
- **`ccd pr-state` and the done fingerprint.** `pr-state` reads `isDraft` and answers phase `draft` (`_pr_py`'s
  `chosen.get('isDraft')` arm); `PrPhase` already holds `draft`. The fingerprint's `prVerdict`
  (`server/src/coord/fingerprint.ts`) refuses only a phase gone backwards: a claimed `draft` measured `open` (after the
  coordinator marked it ready) or `draft` is `ok`. The radar and the watch read a draft as an open PR (D-7515).
- **The landing verdict and the admin-merge door.** The verdict reads no draft flag; GitHub refuses to merge or enqueue a
  draft, so a landing attempted before the ready would only be refused. The admin-merge door already refuses a draft.

## What must happen in order (D-8999)

The landing's checks lane decides an episode's mode once, at the advance to `merging`, from the phase that advance
measures (`checksModeAt`, `server/src/coord/landing.ts`): anything but `open` is `off`. And a line that reads a draft
during an episode is `left` with phase `draft` (`landingLineAct`). So the ready must come BEFORE the advance to
`merging`, never after it: a PR still a draft there would land with the lane off for the whole episode. No server code
changes; the order is the skill's. The undo before a send-back from `merging` can make the lane mail one `checks:` `left`
naming `draft` for that run, which the boundary reference says is the coordinator's own act and needs nothing.

## Tests

- `server/test/session-hook-pr-ready-deny.test.ts` runs the real hook in a fixture HOME and iterates
  `server/test/fixtures/pr-ready-deny/must-deny.json` (21 spellings, asked of a child and of a held session) and
  `must-allow.json` (17: the undo, `gh pr create --draft`, other `gh pr` verbs, and mentions in commit messages, greps,
  heredocs and comments). It also covers: a dangling marker link, a session with neither (the coordinator's case), a
  hold that names no wave, the merge deny kept, the listed passes, `GH_READY_RE` derived from `GH_MERGE_RE`, and the
  prefilter's budget (no strip fork for a session that is not a worker).
- The three skill pins (`worker-skill`, `coordinator-skill`, `reviewer-skill`) with the clause text changed in both
  places.

**Mutants, each measured red against the new suite and green restored:**

| Mutant | Result |
|---|---|
| M1: the deny's condition never true | 43 failed |
| M2: ask every session, not only a worker | 2 failed (the coordinator's case, the budget) |
| M3: drop the `--undo` exemption | 2 failed |
| M4: drop the hold arm (the child marker alone) | 22 failed |
| M5: drop the prefilter term | 44 failed |
| M6: replace a merge deny already set | 1 failed |

## Deviations found

- **D-8997 (2026-11-24)**: the owner's ruling. A worker opens its PR as a draft and never marks it ready; the coordinator
  marks it ready (`gh pr ready <n>`) only once its review passes, immediately before the advance to `merging` that begins
  its landing, and turns it back into a draft (`gh pr ready <n> --undo`) before any send-back from `merging` to
  `working`. Carried by worker clause 16, coordinator clause 15, the brief's third sentence and the advance and boundary
  references. The unattended lander's population is green, non-draft PRs whose author holds the maintainer role or
  higher on the repository.
- **D-8998 (2026-11-24)**: the session hook refuses `gh pr ready` to a worker (a hold naming a programme wave, or the
  child marker), riding the worker merge deny's strip with `GH_READY_RE`, derived from `GH_MERGE_RE`; `--undo` passes.
  An accident guard, not a wall: it passes what the merge head passes, a command over the parse cap, a second ready
  beside an `--undo`, and the `markPullRequestReadyForReview` mutation through `gh api`.
- **D-8999 (2026-11-24)**: the order is load-bearing. The checks lane's mode is decided at the advance to `merging`
  from the measured phase, and a draft there is `off`; a draft read during an episode is `left`. So the ready precedes
  that advance, and the undo before a send-back can draw one `left` naming `draft`, which needs nothing. No server
  change.
- **D-9000 (2026-11-24)**: CI runs on drafts unchanged. `ci.yml`'s `pull_request` takes the default activity types,
  which include a draft's open and pushes, and nothing under `.github/` skips a draft; `ready_for_review` starts no run,
  and the draft's checks on the same head stand once the PR is ready. Nothing changes.
