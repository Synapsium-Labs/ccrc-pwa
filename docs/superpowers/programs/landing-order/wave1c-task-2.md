# Landing order wave 1c, Task 2: the session hook's advisory names the fourth trigger

Run 3698. Plan: `docs/superpowers/plans/2026-11-24-landing-order-wave1c-conflict-sync.md`, Task 2.

## What changed

- `ccd/session-hook.sh`, the block under `THE LANDING-ORDER ADVISORY` only: its header comment says
  `the four triggers`, the advisory opens `Absorb main only on one of four triggers:`, and one new
  `lreason+=` line after `(3)` names the coordinator's `conflict-sync:` mail and its bound (`absorb exactly
  that commit, once per mail, before your wave-done only`). The generated region is not touched.
- `server/test/session-hook-sync-advisory.test.ts`: the header comment and both cases say `four
  triggers`, and the advisory case holds `(4) the coordinator`, `` `conflict-sync:` `` and `exactly that
  commit`.

## The claim on the hook

`ccd/session-hook.sh` was held by another programme's worker (claim 6931). The hunk went to the holder
first as a packet: a unified diff against main `45329e5baffd794a54bff91f8e1439db2a6e536c`, 2764 bytes,
sha256 `dc8296d0fb4d917cbf14f8af463754850d4b5605cd833e37b4bf580e981be63e`. The holder answered yes to
exactly that diff (its own hunks sit in the forbidden-verb jq lists, far from the advisory) and kept its
claim; no merge terms. The diff was applied with `git apply`, unchanged, after the answer.

## Measured

- Red first, test changed and hook not: 22 of 78 red, the 21 parametrized `advises on …` cases and the
  graph-gate case, as the plan predicts (the two cases that read the text).
- Green after the hook change: `session-hook-sync-advisory` 78 of 78, `session-hook-mail-hold` 53 of 53,
  `hook-helpers-generated` 50 of 50. The advisory's never-deny, state-still-written and graph-gate cases
  are green unchanged (Review Focus 5).
