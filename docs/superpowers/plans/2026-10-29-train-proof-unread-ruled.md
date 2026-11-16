# Train proof, unread is unmeasured: ruled 2026-10-29

**Context.** #1797 round 5. After D-7362 every reader took `landedInTrain`
from one proof, but a labelled CLOSED member whose train record could not be
READ was answered `train-unproven`, the same as one whose record was read and
failed. The `pr-state --project` sweep has no time budget for train reads, so
every train-landed member the sweep saw before a `--session` read kept its
proof read `closed`; a timeout in `pr-landing` read `closed` too, and the
landing lane could send a closed end for a PR that had landed. Nothing proved
the sweep's members, so `sweepMerged` and `sweepLanding` never woke for them.

**Ruling.**

1. A labelled CLOSED member whose train proof could not be read (no budget,
   the sweep's zero budget, a timeout, GitHub unreachable) is never `closed`
   and never `train-unproven`. It reads unmeasured: phase `unknown` with reason
   `train-unread`, and `landingLineAct` answers unmeasured, so `checksEnd`
   sends no closed end and latches nothing. `train-unproven` is kept for a
   proof that was read and failed: the train is CLOSED unmerged, lists another
   sha, or no train names the member.
2. A bounded prover. `ccd pr-train-prove --project <p>` proves each labelled
   CLOSED member once, at most `PR_TRAIN_PROVE_MAX` per call, under its own
   `PR_TRAIN_PROVE_TIMEOUT`, and keeps the proof in `$REG/.train-proofs`
   (proofs only, never refusals). The server runs it from the 120 s PR sweep,
   as a separate step after `pr-state --project`, whenever a line read
   `train-unread`. It has its own timeout row, so the `pr-state` bound held
   inside `coordMutex` is not raised. The next sweep reads `merged`, and
   `sweepMerged` and `sweepLanding` wake the run.
3. Kept proofs are keyed by base too, and the train lists are cleared on every
   call, so one call's or one workspace's answers never reach the next.

## Deviations found

- **D-7378 (2026-10-29)** — An unread train proof is unmeasured, not closed, and a bounded prover keeps proofs for the sweep. `_ws_train_record`'s rc 2 (no budget, a timeout, GitHub unreachable, and a train read the bound killed) leaves a member out of `_PR_TRAIN_REFUSED`, so `annotate` sets `trainUnread` and `pr-state` and `phaseFor` answer `unknown` with reason `train-unread`; `pr-landing` adds `train` to the line's `unmeasured`; the reap refuses `gh-unreadable`. Only rc 1 is `trainUnproven`. `ccd pr-train-prove --project <p> [--max K]` (`PR_TRAIN_PROVE_TIMEOUT` 16 s, `PR_TRAIN_PROVE_MAX` 3, server row 40 s) is run by `prPass` after a sweep that read `train-unread`. `.train-proofs` lines are `<repo> <base> <member> <head> <train> <merge>`; an older five-field line is no proof. Rows: `ccd-pr-state.test.ts` (unread on the sweep then merged after the prover, the prover's kept/proved/unproven/unread/deferred answers, the base key, a killed train read on `--session`), `ccd-pr-landing.test.ts` (a timeout is unmeasured and `landingLineAct` answers unmeasured, a read-and-failed proof is closed, a kept proof needs no train call), `ccd-pr-queue.test.ts`, `prstate.test.ts`, `pr-keycap.test.tsx` and `pr-timeout-budget.test.ts` (the prover's own budget).
