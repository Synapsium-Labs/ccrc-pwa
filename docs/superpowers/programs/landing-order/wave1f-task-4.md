# Wave 1f, Task 4: two scan cases get the margin they lack

Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave1f-known-limits.md`, Task 4 (D-9068).

## Step 1: where the time goes (measured 2026-11-25, before any edit)

As they were, each file alone on the fleet's test box (load about 9): the harness case "no override names a function
nothing ships" took 16.6 s, green; the deviation case "is looking at two real trees, each with a real ledger in it"
timed out at 20 s (23.8 s), one failed of 34, as the brief said it would.

Then each case was timed by phase, with a temporary instrumentation (`performance.now()` around each phase, printed
once) that was removed with `git checkout` of both files before any edit:

| Case | Phase | Time |
|---|---|---|
| harness scan | `shippedFunctions()` | 55 ms |
| harness scan | listing and reading the test sources (2,364 files, 67 MB) | 203 ms |
| harness scan | `overridesIn` over them (2,056 overrides found) | 16,629 ms |
| deviation scan | `plansAt('HEAD')`: 962 plans, 963 `git` processes (one `ls-tree`, one `cat-file blob` per plan) | 9,312 ms |
| deviation scan | `plansAt(origin/main)`: 962 plans, 963 `git` processes | 11,765 ms |

The harness scan's time is the string scan itself, not IO, so it takes the budget alone. The deviation scan's time is
the process per plan.

## Step 2: one `git cat-file --batch` per tree

- **Characterization first, green on the old read.** A new case reads `plansAt` for a fixed commit and checks the
  count (962) and one sha256 over every path and text in order (`<path>\0<text>\0` each):
  `ec50384ba564240a65662dd02fa17f74c45f790dba5a9473c192167cf3602433`. Recorded from the old read, and cross-checked
  independently: a Python read of the same commit through plain `git ls-tree` and `git cat-file --batch`, with the
  same exclusions, gave the same count and the same hash. The case passed on the old read (8.4 s).
- **Ruling, against the plan's text:** the plan says "for `HEAD`". A recorded hash of `HEAD`'s plans goes stale with
  every pull request that adds or edits a plan, so the case reads a fixed commit instead:
  `25ed1ee2ddd0bc60afca0f518e95974f2c554c9e`, this wave's base on `main`, permanent history as the incident shas the
  suite already reads are (a checkout too shallow to reach it reds, as theirs does). The read under test is the same
  function either way.
- **The change.** `readPlansAt` lists the tree as before, then asks one `git cat-file --batch` for every wanted blob
  and splits its answer (`<sha> blob <size>\n<bytes>\n` each, in the order asked), decoding each text from its own
  bytes as the per-blob read decoded its stdout. An answer that is not the asked sha's blob throws, naming the file,
  the sha and the ref. The buffer is 1 GiB: one tree's plans weigh about 98 MB today (`git ls-tree -l`).
- **After:** the characterization case passes byte for byte, so the batch read is kept (the brief's third
  judgement: no byte of what the scan reads changed). The cross-tree case took 2.2 s.

## Step 3: the budgets

- "no override names a function nothing ships": 60 s, the case's last argument, with a comment above it naming the
  phase times, the date, the box and load, and the two queue runs (45563248418, 45565143100) and the pull request
  (#3362) the second one removed.
- "is looking at two real trees, each with a real ledger in it": left at the suite's limit, because Step 2 brought it
  under 5 s on the test box (below). A comment above it says so, with the times before and after.

## Step 4: three runs on the test box and one local, one after another

| File | Run | The case | The file | Load (1 min) |
|---|---|---|---|---|
| `ccd-harness-integrity` | test box 1 | 16.9 s | 19.2 s, 13/13 | 9.1 |
| `ccd-harness-integrity` | test box 2 | 17.8 s | 20.2 s, 13/13 | 8.0 |
| `ccd-harness-integrity` | test box 3 | 17.6 s | 20.0 s, 13/13 | 6.3 |
| `ccd-harness-integrity` | `ccrc test --local` | 20.1 s | 23.0 s, 13/13 | 5.2 |
| `deviation-refs` | test box 1 | 2.2 s | 12.1 s, 35/35 | 4.7 |
| `deviation-refs` | test box 2 | 2.2 s | 12.3 s, 35/35 | 4.2 |
| `deviation-refs` | test box 3 | 2.2 s | 12.5 s, 35/35 | 4.7 |
| `deviation-refs` | `ccrc test --local` | 2.6 s | 16.0 s, 35/35 | 4.4 |

Green every time. The local harness run took 20.1 s, past the old 20 s limit: without its budget it would have failed
there.

## Mutation row

| Row | Mutation | Red assertion | sha256 restored | Green after |
|---|---|---|---|---|
| 1F-10 | the batch read drops the last plan of a tree (`wanted.slice(0, -1)` in the split loop) | `deviation-refs`: the characterization case `expected 961 to be 962`, and both incident cases (`expected [] to deeply equal [ 1159, 1160, 1161 ]`, and D-1157/D-1158), 3 failed of 35 | `ddd62b9e…fd76`, matched | 35/35 |

Command: `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/deviation-refs.test.ts` from `server/`.
