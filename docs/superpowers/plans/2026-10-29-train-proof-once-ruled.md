# Train proof, computed once: ruled 2026-10-29

**Context.** #1797 reads a member PR that a merge train landed and closed as
merged. Review found two majors. First, `landedInTrain` meant "CLOSED and
labelled", and every reader trusted it: `pr-state`'s phase (and so the run
close and the archive), the landing lane's merged notice, the queue word, the
coordinator skill's clause 15 and the wave lifecycle's §5. Only the reap
checked the train record, so a labelled PR whose train never landed closed its
run and unlocked the next wave. Second, the reap's train search stopped at the
first reference GitHub could not read and looked at two references at most, so
a stray `train #77` or two newer comments naming closed trains could hide the
real train.

**Ruling.**

1. `landedInTrain` is the proof, not the label. ccd sets it only when the train
   record proves the landing (the train PR it names, or one a search finds, is
   MERGED into the same base and its one `ccrc-train v1` block lists the member
   at exactly its head sha, D-7335). It is decided in one place,
   `_pr_train_proofs`, which every reader runs before `_pr_py` annotates the
   rows. A label without the proof is `trainUnproven`: phase `closed` with
   reason `train-unproven`, and the reap refuses it.
2. Every reference is a candidate. A referenced number that is an issue, is
   missing or cannot be read is one failed candidate, and the search goes on
   through every reference and then the search fallback. There is no count
   cap: a time budget bounds the reads. `gh-unreadable` is returned only when
   GitHub itself could not be read (the member's comments or the search) or the
   budget ran out, and nothing proved the landing.
3. Each verb has its own budget: `pr-state --session` 6 s, `pr-landing` 3 s,
   the cleanup audit and reap 16 s per workspace. The `pr-state --project`
   sweep has no room inside its bound and reads only proofs already kept. A
   proof is kept in `$REG/.train-proofs`, because a merged train never
   un-merges; a refusal is never kept.

## Deviations found

- **D-7362 (2026-10-29)** — `landedInTrain` is true only when the train record proves the landing, decided once in ccd (`_pr_train_proofs` -> `_ws_train_record`, read by `annotate` through `PR_TRAIN_PROOFS`) and read by every consumer: `pr-state`, `phaseFor`, `pr-landing` and `landingLineAct`, the queue word, the reap, the merged brief, SKILL.md clause 15 and wave-lifecycle §5. A label without the proof reads `closed` with reason `train-unproven` (`trainUnproven: true` on the row). Train references are all tried, a bad one is only a failed candidate, and `gh-unreadable` means GitHub itself did not answer. Rows: `ccd-pr-state.test.ts` (train CLOSED unmerged, train listing another sha, no train, the sweep reading only kept proofs), `ccd-pr-landing.test.ts` (the same three for the merged notice), `ccd-ws-audit.test.ts` (a stray `train #77` that is no PR, a stray number gh answers with nothing, two newer CLOSED trains, an unreadable reference once the search answered), `prstate.test.ts` and `pr-timeout-budget.test.ts` (the per-verb budgets).
