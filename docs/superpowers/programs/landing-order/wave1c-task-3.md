# Landing order wave 1c, Task 3: the coordinator's run care and the README

Run 3698. Plan: `docs/superpowers/plans/2026-11-24-landing-order-wave1c-conflict-sync.md`, Task 3.
Implements D-9013's procedure.

## What changed

- `ccd/coordinator-skill/references/wave-lifecycle-run-care.md`: a new section, `## A conflict
  mid-round: the conflict-sync mail`, after `A run that can never finish`, wrapped at 80 columns. It
  says when (a worker at `working`, before its wave-done, whose pull request has used its one
  absorption; never after a wave-done, where the route is the ejection of `references/wave-steps.md`
  step 6), measure first (the probe against `origin/main` exits 1 with a tree id; anything else sends
  nothing), the mail (subject `conflict-sync: #<pr>`, body `base: <sha>` then `paths: <the conflicted
  paths>`, the sha copied from output), one mail per measured conflict recorded with `ccrc-api calls
  record` as a `routine` call naming the base, and what it does not do (waives no check or review,
  gives the coordinator no merge, and licenses nothing on a home whose installed clause 16 still names
  three triggers). Coordinator clause 15 is not reworded and its pin does not move.
- `README.md`, the paragraph that opens `**Landing order (landing-order wave 1).**`: clause 16 names
  four; the `fix-round` item loses its leading `or`; the `conflict-sync:` item is added last; and one
  sentence after the first-two bound gives the fourth trigger's bound.

## The claim on the README

`README.md` was held by run 1850's worker (claim 6984; #2837 in the merge queue, not landed). The hunk
went to this programme's coordinator as a packet: a unified diff against main
`45329e5baffd794a54bff91f8e1439db2a6e536c`, 2070 bytes, sha256
`0aa3aa426de041029708112cf15b03d70c3be0f105be9a1146d2243845cb8966`. The coordinator answered yes to
exactly that packet, to apply now beside the standing claim and not to claim the file; it measured the
packet clean against main and against run 1850's tip. The digest was checked and the diff applied with
`git apply`, unchanged. #2837's README hunks begin near line 5908, far from this paragraph.

## Measured

`coordinator-skill` 290 of 290 (no pin moved), `docs-parity` 81, `citations` 4, `anchors` 9,
`topology-clean` 61, and the six suites that read the lifecycle through `server/test/waveLifecycle.ts`
(the one file `git grep -l wave-lifecycle-run-care server/test` names), 1387 tests: all green.

## Left as it is

- The run-care file's H1 and `wave-lifecycle.md`'s index row still list the file's older topics. The
  plan adds one section only, so neither is retitled.
- `references/wave-steps.md` step 6 says a `red:` fix-round mail licenses no absorb and the worker
  absorbs only on its own clause 16's first two triggers. That is about the `red:` mail and stays true;
  the plan does not touch the file.
