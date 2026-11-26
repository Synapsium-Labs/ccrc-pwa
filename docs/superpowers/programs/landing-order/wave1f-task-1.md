# Wave 1f, Task 1: the sender's measure step, and the last text guards of the conflict-sync mail

Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave1f-known-limits.md`, Task 1 (D-9066).

## What changed

- `ccd/coordinator-skill/references/wave-lifecycle-run-care.md`: the measure block reads the tip from the pull
  request's head (`gh pr view <pr> --json headRefOid --jq .headRefOid`), captures the probe's own exit status in
  `rc` and prints it last as `probe exit $rc`. The paragraph after it says, in the plan's order, where the tip comes
  from, that the `probe exit` line is the probe's status, what a conflict reads as, what sends nothing, and that the
  rev-parse line's commit is the base. One sentence after the `paths:` entry says the paths are for the reader.
- `README.md`: "before the worker's wave-done of that round only" became "before the wave-done of the round the
  worker is in", exactly as the plan gives it. The old line occurred once.
- `server/test/conflict-sync-text.test.ts`: the fence pin is replaced by three (the tip line, the fence's last lines
  flattened, the `probe exit` sentence); the paths sentence; the README's bound on the first two triggers; the
  run-care lead-in "Never after this round's wave-done"; the README pin follows the new sentence.
- `server/test/session-hook-sync-advisory.test.ts`: the advisory case reads "before this round's wave-done only" and
  "your own probe of that commit agrees" in what the hook prints.

## Red first

Before the edit, `conflict-sync-text` was red in two cases: the README pin "before the wave-done of the round the
worker is in" and the first run-care fence pin. Green at once, as the plan expected: the README's "The first two
license at most one absorption per PR.", the lead-in "Never after this round's wave-done" (both text that already
existed), and both advisory expectations (the hook already prints both phrases). Those are covered by rows 1F-02,
1F-03 and 1F-04.

The fence pins were written from the file as written, flattened: `"$tip" origin/main; rc=$? git rev-parse
origin/main echo "probe exit $rc" ```` matches the plan's spelling, so nothing differed there.

## The block, run literally

On a scratch repository with `origin/main` and three tips, the block printed:

| tip | output | last line |
|---|---|---|
| a branch that merges clean | a tree id, then the rev-parse commit | `probe exit 0` |
| a branch that conflicts | a tree id, the conflicted path, then the rev-parse commit | `probe exit 1` |
| `deadbeef` (git cannot resolve it) | `merge-tree: deadbeef - not something we can merge`, then the rev-parse commit | `probe exit 1` |
| an empty tip (what `gh pr view` leaves when it fails) | `merge-tree:  - not something we can merge`, then the rev-parse commit | `probe exit 1` |

So the three cases of the plan's Review Focus 1 are told apart by the `probe exit` line together with the tree id on
the first line, which is what the paragraph says; only the conflicting tip sends a mail.

## Suites (each through `ccrc test`, one file per process, on the test box)

`conflict-sync-text` 5/5, `session-hook-sync-advisory` 78/78, `coordinator-skill` 290/290, `worker-skill` 84/84,
`skill-size-ratchet` 32/32, `docs-parity` 81/81.

## Mutation rows

Each: the target saved, its sha256 taken, the mutation applied, the suite run (red), the saved copy restored and
its sha256 checked, the suite run again (green).

| Row | Mutation | Red assertion | sha256 restored | Green after |
|---|---|---|---|---|
| 1F-01 | the fence loses `; rc=$?` and the `echo "probe exit $rc"` line | case 5: `lacks: "$tip" origin/main; rc=$? git rev-parse origin/main echo "probe exit $rc" ````, 1 failed of 5 | `a0d9cf48…26b6`, matched | 5/5 |
| 1F-02 | README "at most one absorption per PR." becomes "at most two absorptions per PR." | case 2: `README.md lacks: The first two license at most one absorption per PR.`, 1 failed of 5 | `920af36c…a9af9`, matched | 5/5 |
| 1F-03 | the lead-in's "Never after this round's wave-done" becomes "Never after its wave-done" | case 3: `lacks: Never after this round's wave-done`, 1 failed of 5 | `a0d9cf48…26b6`, matched | 5/5 |
| 1F-04 | in a copy of the hook, "before this round's wave-done only" moves out of the advisory's string into a comment; the suite's `HOOK` pointed at the copy | the advisory case, `expected '…' to contain 'before this round's wave-done only'`, 21 failed of 78 (every sync case) | suite file `344837d7…d2f`, matched | 78/78 |

Commands: `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/<suite>.test.ts` from `server/`.

Row 1F-04 differed from the plan in one way: the suite's harness has no hook-path override (`HOOK` is a constant), so
the row edits the suite's `HOOK` line to point at the mutated copy for the red run and restores the suite from its
saved copy. The shipped hook was not edited. The copy lives in the session's temp root, which the test box cannot
read (the first try answered `EACCES` there), so this row ran with `ccrc test --local`, red and green.
