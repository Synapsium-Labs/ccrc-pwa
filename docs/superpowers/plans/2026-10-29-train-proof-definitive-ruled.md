# Train proof, a failed candidate is a definitive answer: ruled 2026-10-29

**Context.** #1797 round 6. After D-7378 an unread train proof was
unmeasured, but `_ws_train_record` still counted any rc-1 failure of a train
read as a FAILED candidate: an HTTP 5xx, a rate limit or a network error on the
train PR the member names, followed by an empty search fallback, answered
`train-unproven` (closed) for a member that may have landed. And the bounded
prover asked members in registry order with no memory of what it had tried,
so with `--max 1` a member GitHub kept refusing was asked on every call and a
landed member after it was never reached.

**Ruling.**

1. A referenced train is a FAILED candidate only when GitHub definitively
   answered about it: the PR was read and is CLOSED unmerged, lists another
   sha or does not list the member, or gh said the number is not a pull
   request in this repository (rc 1, `Could not resolve to a PullRequest` on
   its stderr). Every other failure (rc 1 with an HTTP 5xx, a rate limit, a
   network or auth error, rc 124, a signal, an answer that is not a PR's JSON)
   is UNREAD. If any candidate was unread and nothing proved the landing, the
   result is unread (rc 2), never failed, even when the search fallback
   answered empty.
2. The prover is fair. It asks members with no tried record first, then the
   oldest tried, and keeps a TTL'd tried record per member (outcome and time)
   in a file of its own, never read as a proof. A member whose proof was read
   and FAILED reads `train-unproven` (not `train-unread`) while its record is
   fresh and is not asked again until it expires; an unread outcome is asked
   again on the next call.

## Round 7 ruling

1. In `_ws_train_record` the fresh `failed` tried-line fallback applies ONLY
   on the early no-budget return (no gh call possible: the `--project` sweep).
   A read that made gh calls and hit an unread candidate, with nothing proving
   the landing, is unread (rc 2) regardless of a fresh `failed` line: a fresh
   failed line, a 502 on the train and an empty search read `train-unread` on
   `--session` and are unmeasured on `pr-landing` (keep=0).
2. An OPEN train, and one whose state is missing or odd (or MERGED with no
   merge commit), is UNREAD, never a failed candidate, and writes no `failed`
   line.
3. A proof found by ANY read, keep=0 included, removes the member's tried
   line (keep=0 still writes no proof), and the sweep consults kept proofs
   before tried lines.

## Deviations found

- **D-7381 (2026-10-29)** — A train candidate fails only on GitHub's definitive answer, and the prover is fair with a TTL'd tried record. `_ws_train_record` reads a train's gh stderr: rc 1 with `Could not resolve to a PullRequest` is a failed candidate; any other failure, and a `train-check` answer of `?unreadable` (stdin not a PR's JSON) or nothing for a view, sets unread, so rc 2 whenever nothing proved it. `$REG/.train-tried` lines are `<repo> <base> <member> <head> <failed|unread> <epoch>`, written by a read with keep=1 for its 1 or 2 and removed by a proof; a read with no budget left answers 1 from a `failed` line younger than `PR_TRAIN_TRIED_TTL` (1800 s) without rewriting it; lines older than `PR_TRAIN_TRIED_KEEP` (86400 s) are dropped on write. `cmd_pr_train_prove` collects every member first, answers `kept` and fresh-failed `unproven` with no gh call, and spends its `--max` on the rest ordered no-record first, then oldest tried. Rows: `ccd-pr-state.test.ts` (a 502, a rate limit, a network error, a timeout, a signal or a non-JSON answer with an empty search is unread; a definitive not-a-PR with an empty search is unproven; an unread candidate beside a definitive refusal is unread; `--max 1` over [refused, refused, landed] proves the landed one within 3 calls; a refused member reads `train-unproven` on the sweep while fresh; an expired refusal is unread again and asked after never-tried members; an unread outcome is retried), `ccd-ws-audit.test.ts` (a transient reference failure refuses `gh-unreadable`), `pr-keycap.test.tsx` (the sweep's closed/train-unproven sentence); round 7: only the no-budget return answers from a fresh `failed` line (a read that asked GitHub and hit an unread candidate is rc 2 whatever the line says), `train-check` answers `?` for an OPEN train or a missing or odd state (only CLOSED fails), and a proof found by any read clears the member's tried line, a kept proof too. Rows: `ccd-pr-state.test.ts` (a fresh failed line with a 502 and an empty search is `train-unread` on `--session`; the sweep still answers it `train-unproven`; OPEN, missing, odd and merge-commit-less trains are unread and write no failed line; an OPEN train beside a CLOSED one is unread; a proof and a kept proof clear a stale line), `ccd-pr-landing.test.ts` (a fresh failed line with a 502 is unmeasured; an OPEN train is unmeasured; a proof clears a stale line and keeps none).
