# Queue flake: the bridge's stats file one answer behind (#3462), the card facts cases at their bound, the palette words case

Programme overlord, wave 245, run 3996. Built on `main` at `9a21a20715`. No deviation number was allocated for this
run: departures are recorded by slug at the end, for the coordinator to fold into the ledger.

## In short

- **Item 1 (#3462) was a lost write in the bridge, not a slow runner.** For a user of the bridge: after a burst of
  answers, an idle lane's stats file could stay one answer behind until the next request. The idle flush now waits for a
  write in flight; a handler's flush still never waits.
- **Item 2** was a fixture cost: every case of the card facts suite migrated a fresh coord db. The file now migrates
  one template and copies it.
- **Item 3**, the command registry suite's palette words case, parsed the console's source tree once per word; each
  file is now parsed once for its describe block.

## 1. The diagnosis (item 1)

The flush is `Stats.flush` in `ccd/codexbridge/stats.py`, and the flush meant to be the last word on an idle lane is
`_IdleFlush` in `ccd/codexbridge/server.py` (D-8624). The brief named `ccd/ccgpt-proxy.py`; the code that writes the
stats file is these two (slug `brief-named-proxy-file`, the coordinator agreed to both files before the edit).

The server suite runs with `stats.FLUSH_S` at 0. Each answer's handler flushes, then arms the idle timer at 0 s. An
unforced flush that meets a write in flight returns `False` and writes nothing; its counts stay dirty "for the next
one". The lost shape:

1. Answer N's handler flush writes; its idle timer is armed.
2. The idle timer runs late (a thread scheduled late on a busy runner), after answer N+1 has counted its request, so it
   finds the document dirty and starts a write.
3. While that write is still in fsync, answer N+1 ends: its handler flush meets the write in flight and drops, and its
   own idle flush, at 0 s, meets the same write and drops.
4. The writer arms nothing after itself. The counts stay in memory until the next request or the drain's forced flush.

That is a defect in the bridge: D-8624 promises that an idle lane's figures reach the disk soon after its last answer.

**Evidence that it was lost, not late.**

- The red queue job (#3459's entry): every other case of the file ran at about 200 ms; this case took 3483 ms, the 3 s
  bound plus its normal time. A late write would need a small file's write to take over 3 s on a runner running
  everything else at normal speed.
- Reproduced on the real bridge with a temporary, uncommitted injection on the idle thread only (50 ms before the flush,
  400 ms before the fsync) and the case instrumented to read the file again 8 s after the wait gave up and again after
  the stop's drain. 7 reds in 12 runs, each the queue's shape (the counter one behind at the 3 s bound). In every red
  the file was still one behind 8 s later with its `updatedAt` unchanged, so no write happened at all, and it was right
  after the drain. The injection and the instrumentation were reverted before any commit; neither is in this PR.
- Without the injection the window is narrow: 40 of 40 green at idle load (about 10 on 16 cores), and 40 of 40 green
  with the case pinned to one CPU shared with three busy loops and an fsync loop. That matches the queue's rate (two
  reds in a day of queue runs).

## 2. What changed (item 1)

- `Stats.flush(*, force=False, wait=False)`: with `wait`, the flush waits for a write in flight (it takes the write
  lock blocking), then decides as any unforced flush does: only what is dirty, at most every `FLUSH_S`, at once after a
  failure or a store event. It serialises under the counter lock after it has its turn, so it writes what is dirty then.
- `_IdleFlush.arm` passes `wait=True` to its timer. A handler's flush is unchanged: it never waits, so no answer waits on
  an fsync.
- The module docstrings of both files say so.
- The server suite's comments that said nothing flushes an idle lane again (the `statsWhen` docstring and two D-6997
  notes) are corrected. The D-6997 cases still read after the drain; that stays sound.

The four things the coordinator asked to hold:

| # | Held how |
|---|---|
| 1 | A handler's flush returns at once when a write is in flight: both new cases send answers while the write is held and require each to end within 5 s (an answer's body ends when its handler's `finally` has flushed and the connection closes). Mutant M3 (the handler's flush waits) is killed by both. |
| 2 | The stop's drain ends once the write in flight ends, with an idle flush waiting behind it: the second case. While the write is held, the drain's forced flush waits for it (the forced rule, pinned in the stats suite), as on `main`; a write that never completes holds the stop until the unit's stop bound, as on `main`. The waiting idle flush adds no wait of its own: it is a daemon thread, and it takes the counter lock only after the write lock. Mutant M5 (it waits while holding the counter lock) hangs the stop and is killed. |
| 3 | The waiting flush writes what is dirty when its turn comes: the first case puts two answers behind one held write and requires both counted after it ends (4 in all). |
| 4 | No second timer and no loop. `arm` still cancels a timer that has not fired, so there is one pending timer at most. A timer that has fired and waits cannot be cancelled; if another answer's timer fires while it waits, that one waits too. They take the write lock in turn: the first writes everything dirty, and a later one finds nothing dirty (unless an answer came after the first wrote) and returns without writing. Each fired timer ends after one flush. Waiting threads are at most one per idle gap of `FLUSH_S` during one write. A strict single waiter would need a second piece of state in `Stats`; I left it out as larger than the defect. |

**The new cases** (server suite, block "an idle flush that meets a write in flight waits for it, a handler's never does
(#3462)", Linux only). A FIFO at the stats file's temp name, with its pipe filled by the case through an `O_RDWR`
descriptor, holds a write in flight for as long as the case keeps its end open: the bridge's open succeeds and its write
blocks on the full pipe, holding the write lock. The hold is seen as the bridge's descriptor on the temp name in
`/proc/<pid>/fd`. Closing the case's end fails the held write (a broken pipe: counted `stats:flush-failed`, retried at
the next flush). `FLUSH_S` is 3: the first answer is written, the second comes inside `FLUSH_S` of that write so its
own flush is throttled, and its idle flush is the writer the FIFO holds. The first case is red on `main` (`expected 1 to
be 4`: the counts never reach the file) and green with the fix; the second is green on both (a guard).

**The back-to-back cases that use `statsWhen`** in the server suite, all covered by the bridge fix with no test change:
"a compaction request is counted only when it succeeds" (a 5xx then a 2xx), "a 200 with no content type is reduced, and
the media type counted as a name" (two 2xx), the #3462 case itself (four 5xx), and "a JSON error answer, an event
stream and a stream with no content type write no such line" (four answers; it does not assert on the counts it waits
for, so a lost write only cost it 3 s). The #3462 case keeps every assertion, per step.

## 3. Item 2: the card facts cases at their bound

Every case opened a fresh coord db, which replays every migration: about 7 s a store on the loaded fleet box. The two
named cases loop over three stores. The file now migrates one template in `beforeAll` and copies it for each store, the
pattern the designation store and caps suites already use; each test's directories are removed after it
(`removeTmpFixturesEachTest`) and the template's after the file. No assertion changes, no bound changes.

## 3b. Item 3: the palette words case

The block "the palette's words and the session builder each have one home" parsed every file of the console's source
tree once per palette word (two words), then once more for the session builder case; it timed out once at its 5 s
bound on a queue shard. The block's string read is now memoized per file, so each file is parsed once for the block.
No assertion changes. The file was held by another run's claim, so the change went to its holder as a diff packet
first; the holder released the file and I carried it. Mutant (the memo answers an empty list for a file it has read):
killed, both cases red.

## 4. The numbers

| What | Before | After |
|---|---|---|
| #3462 case, real bridge, 40 runs at idle load | 0 red | (not re-measured: the window is too narrow to show) |
| #3462 case, pinned to one loaded CPU, 40 runs | 0 red | (as above) |
| #3462 case, injected delay on the idle thread | 7 red of 12 | 0 red of 36 |
| New held-write case | red (`expected 1 to be 4`) | green |
| Card facts file alone, load 11 to 12 | 356 s, both named cases red at 21.2 s and 21.3 s | 16 s, 40 of 40, the cases at 0.18 s and 0.29 s |
| Command registry palette case, load 18 | 3388 ms, session builder 1176 ms, file 9.8 s | 1664 ms, 4 ms, file 4.2 s |

## 5. Mutation rows (item 1)

Each mutant was applied to the file on disk, the two new cases run, and the file restored (checked by sha256 after the
round). The repository's mutation runner executes Python tests in process against a module object, and these cases run
the bridge as a subprocess that imports the package from disk, so it could not drive them (slug
`mutation-by-hand-subprocess`).

| Mutant | Result |
|---|---|
| M1: the idle timer does not pass `wait` | killed: `expected 1 to be 4` |
| M2: `wait` is ignored (the write lock taken blocking only when forced) | killed: `expected 1 to be 4` |
| M3: a handler's flush passes `wait` | killed in both cases: the answer behind the held write did not end within 5 s |
| M4: a waiting flush returns after its wait without writing | killed in both cases (the first answer's idle write never lands) |
| M5: a waiting flush holds the counter lock while it waits | killed: `expected 1 to be 4`, and the stop case times out at 20 s |

## 6. What ran

Each file alone through the fleet test wrapper, at most two workers, load 9 to 12 on 16 cores: the bridge server suite
(134 of 134), the stats suite (67 of 67, every in-flight pin unchanged), the proxy (123), harness (25), runtime (103, 10
skipped), usage (71), absorb (6), backend (30) and live tools (40) suites, the card facts suite (40 of 40), the command registry suite (28 of 28), the growth
check armed (100 of 100), single-definition (1624, 1 skipped). The type check of all the tests was killed twice by the
test slice's memory cap, with other sessions' runs holding most of it; the two changed test files and everything they
import type-check clean through a narrowed config (slug `typecheck-narrowed-slice-oom`). The pull request's fast run
type-checks the whole tree. The shell lint ratchet was not started, as the brief says.

## 7. What I left

- A strict single waiting idle flush (row 4 above), if a reviewer wants it.
- The new cases are Linux only (`/proc`); the macOS legs skip them.

## Departures (by slug)

- `brief-named-proxy-file`: the fix is in `ccd/codexbridge/stats.py` and `ccd/codexbridge/server.py`, not the file the
  brief named; agreed by the coordinator before the edit.
- `mutation-by-hand-subprocess`: mutants applied on disk and restored, not through the mutation runner.
- `typecheck-narrowed-slice-oom`: the tests' type check narrowed to the changed files after two out-of-memory kills in
  the shared test slice.
