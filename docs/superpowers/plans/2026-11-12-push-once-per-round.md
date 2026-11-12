# Agents push once per round, never once per commit

- **D-8397 (2026-11-12)** — operator ruling: an agent commits as often as useful and pushes once, when a build or a
  review fix round is complete, with its code, tests and notes in the same push; a push before that only hands work
  to another session or comes before a stop that could lose the work. Every push re-runs the PR's checks, so a push
  per commit buys CI runs and nothing else; pushing once per round is expected to bring a merged PR from about 2.8
  CI runs to about 2.1.

## Why

No document told a worker or a coordinator when to push. The worker skill said only when to stop (clause 9: no push
after `wave-done`), so a session fell back on the habit of committing and pushing each task as it went. A PR's fast CI
runs on every push to its branch, so each extra push before the round was done was a run that the next push made
stale.

## What changed

- `ccd/worker-skill/SKILL.md`: clause 20 states the rule, and the fix-round bullet says the round is pushed once
  (clause 20). The count goes from nineteen to twenty there, in `README.md` and in `CLAUDE.md`. Two notes were
  shortened so that the file grows by exactly the new clause line (the skill-size ratchet's allowance); the cap in
  `server/test/skill-size-caps.json` is the new size.
- `ccd/coordinator-skill/SKILL.md`, *What stays discipline*: handoffs are pushed once per build or fix round. The
  paragraph was reworded so the file does not grow; its cap is lowered to the new size.
- `ccd/coordinator-skill/references/wave-lifecycle-2-dispatch.md` and `wave-steps.md`: every brief carries the push
  sentence beside the branch sentence, for the same reason (a home that has not had the installer has only the
  brief), and a brief that asks for a push per task or per commit loses to it. The fix-round mail step says the worker
  pushes the round once.
- `CLAUDE.md`, *Conventions that shape every change*: the same rule for every builder in this repository.
- Pins: `server/test/worker-skill.test.ts` (clause 20 verbatim, its own describe, the fix-round bullet) and
  `server/test/coordinator-skill.test.ts` (the discipline line, the brief sentence and its reasons, the fix-round
  mail, the `CLAUDE.md` bullet). Every one was red before the prose landed.

## Deviations found

- **Nothing in this repository pushes per commit on its own.** Measured by reading every `git push` in `ccd/`,
  `deploy/` and `server/src`: `ccd pr-open` pushes the workspace branch once, when it opens the PR;
  `ccd/testbox-snap` pushes scratch refs to the test box's own mirror for each `ccrc test` run, which runs no GitHub
  check; the graphify `post-commit` hook rebuilds the graph and pushes nothing; the release scripts push tags only.
  No ccd behaviour changes in this PR. The operator's merge-queue keeper lives outside this repository and may
  rebase or push a PR branch on its own authority (worker clause 16); it is not covered here.
- The review brief and the peer protocol carry no push rule and need none: a reviewer never pushes (reviewer
  clause 4), and the peer protocol covers claims and the allocator, not branches.
