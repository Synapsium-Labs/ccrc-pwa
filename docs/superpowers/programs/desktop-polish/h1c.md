# Task H1c: the bounded start scan (D-8873)

The plan's entry is the "Task H1c" section of `docs/superpowers/plans/2026-10-22-desktop-polish.md`. This note is its record:
what changed, the red-first evidence, the mutation tables, the cost measurement and the runs. Each claim is labelled
**measured** (a command was run and its result seen) or **inferred** (deduced from the code). Fixtures use neutral names.
The measured transcripts are named by size only.

## 1. What changed

| File | Ring, context | Change |
|---|---|---|
| `server/src/workflows/helperScan.ts` (new) | L3, C3 | The scan: `HelperStartScan`, `scanCutoff`, `HelperScanSeam`, `HELPER_SCAN_BYTES`, `HELPER_SCAN_CHUNKS`, `HELPER_SCAN_CHUNKS_PER_READING`; its header records the seam, the pace and the "legitimately different" reason |
| `server/src/workflows/read.ts` | L3, C3 | One call site in `SessionWorkflows.readAll` (and its field and constructor line); F1 in `markLastWriteUnreadable` (co-edit, the H2 worker's consent of 2026-11-21) |
| `server/src/transcript/tail.ts` | L3, C3 | `BacklogRead.scanEnd` and `BacklogRead.cut` |
| `server/src/sessionws.ts` | L4, C3 | The stream's seam (`helperScan`), set on a resume and by each backlog, passed to `readAll`; F8's comment (co-edit) |
| `server/src/workflows/model.ts` | L1, C3 | `laterEnd`, `earlierLaunch` and `foldHelperFacts`' bound made order-independent; `orderHelperHook(last, next, lagMs)`; `helperDisplayText` on `stripLine` (co-edit) |
| `server/src/sessionFeed.ts` | L4, C3 | `PUBLISHED_FRESH_MS` exported and passed to `orderHelperHook` |

Tests: `helper-scan` (new), and cases added to `helpers-read`, `helpers-frame`, `session-feed-hook-at` and
`sessionws-helpers`. Four of H1a's `helpers-decision` pins move to the new fold rule (an intended behaviour change: the
newer read, the least recently touched id, and the first of two untimed launches no longer decide).

## 2. Red first (measured)

The first commit (`test(server): the start scan and the read tier's gaps, red first`) held the tests. Each file was run
against an extraction of `main` at e52f8dbec7 with the new test files copied in, one file per process through the test
slice, `--maxWorkers=2`, at a load of 8.7 to 11.2:

| File | On `main` |
|---|---|
| `helper-scan` | fails to load: `../src/workflows/helperScan.js` does not exist |
| `helpers-read` | 2 of 47 fail: both F1 cases (a failed final stat, and a failed final range, null the measured last write). F2's two cases, F3's two and F6's one pass on `main`: they are characterization pins, each red under the mutant review 3033 measured (section 3) |
| `helpers-frame` | 3 of 42 fail: the two F5 cases and the launch-model case (the old strip removes a control instead of spacing it) |
| `session-feed-hook-at` | 3 of 12 fail: `PUBLISHED_FRESH_MS` is not exported, the bounded order, and the step back of a minute through the feed |
| `sessionws-helpers` | 2 of 14 fail: the reload and reconnect rows differ (`main` reads no fact behind the backlog's window, nor before a resume offset), and the beyond-the-bound case has no scan |

## 3. Mutation run (measured)

`ccd/coordinator-skill/references/mutation-run.py`, through an adapter of H1b's kind: each TypeScript file is held as a
module's text; a mutant is written into a scratch copy of the tree (outside the work tree, removed after the run), one test
file runs there through `ccrc test` with `--maxWorkers=2`, and the original is written back. `--no-coverage`. A run that exits
non-zero with no failed test is retried and never counted as a kill. One kill was also reproduced by hand (S7: the
one-read-at-a-time case fails). Load 7.1 to 9.2, 2026-11-21.

Round 1: 52 mutants, 45 killed, 7 survived. Round 2, after six cases were added and one equivalent rank removed: 42 of 42
killed. (D7 is gone with its code. The model module's first attempt stopped on a failing baseline, the four H1a pins above;
the module was re-run after they moved.)

| Id | Mutant | Round 1 | Round 2 |
|---|---|---|---|
| F1 | the feed passes no bound (`Infinity`) | killed (session-feed-hook-at) | killed |
| T1 | the backlog hands over no cut | killed (helper-scan) | killed |
| T2 | the seam is the end of the file | killed (helper-scan) | killed |
| S1 | the cutoff takes the later start | killed | killed |
| S2 | a workflow's agent moves the cutoff | killed | killed |
| S3 | an entry with no id moves the cutoff | killed | killed |
| S4 | an unusable roster's cutoff is now | killed | killed |
| S5 | the time stop at equality | killed | killed |
| S6 | no time stop | killed | killed |
| S7 | a read in flight is not counted against the grant | killed | killed |
| S8 | a reading grants every read | killed | killed |
| S9 | each seam restarts the scan | killed | killed |
| S10 | any transcript's seam starts it | killed | killed |
| S11 | a failed read does not stop it | killed | killed |
| S12 | the cut is parsed without its head | killed | killed |
| S13 | the head test inverted | killed | killed |
| S14 | no guard for a newest read with no newline | **survived** | killed (case: a seam line longer than one read) |
| S15 | `start` and `bytes` swapped | killed | killed |
| S16 | bytes counted with the carried piece | killed | killed |
| S17 | 64 KiB chunks, four times as many | killed | killed |
| S18 | the oldest time skips the first timed line | killed | killed |
| R1 | the scan's facts dropped in `readAll` | killed (sessionws-helpers) | killed |
| R2 | F1: the measured last write nulled | killed (helpers-read) | killed |
| R3 | F2: no early reserve | killed (helpers-read) | killed |
| R4 | F3: a failed range read costs nothing | killed (helpers-read) | killed |
| R5 | F6: a held helper in step 3 | killed (helpers-read) | killed |
| D1 | the old strip | killed (helpers-frame) | killed |
| D2 | no surrogate strip | killed (helpers-frame) | killed |
| D3 | no step bound | killed (session-feed-hook-at) | killed |
| D4 | a strict step bound | killed (session-feed-hook-at) | killed |
| D5 | no summary rank | **survived** | killed (case: a summary over a report) |
| D6 | no report rank | **survived** | killed (case: a report over content) |
| D7 | no `from` rank | **survived**: equivalent | removed: a launch's end carries no summary, so two tied ends that differ in `from` differ only there, and content already orders a notification's above a launch's |
| D8 | an end tie keeps the first read | killed (helpers-decision) | killed |
| D9 | a launch tie keeps the first read | killed (helper-scan) | killed |
| D10 | the bound keeps the oldest | killed (helper-scan) | killed |
| D11 | the bound's tie is unordered | **survived** | killed (case: 300 ids at one time, three orders) |
| D12 | an untimed end beats a timed one | killed (helpers-decision) | killed |
| D13 | an untimed launch beats a timed one | killed (helpers-decision) | killed |
| W1 | a resume sets no seam | killed (sessionws-helpers) | killed |
| W2 | the stream drops the backlog's cut | **survived** | killed (case: a2's launch straddles the reload's seam) |
| W3 | the stream's seam is the end of the file | **survived** | killed (case: the scan's bytes equal the seam) |
| W4 | the seam is not passed to `readAll` | killed (sessionws-helpers) | killed |

## 4. The scan's cost at stream start (measured)

On this box, 2026-11-21 03:12Z, load about 9.4, through the real `readBacklog` and `HelperStartScan` over `localIO`, on four
real session transcripts: T0 1.05 GB, T1 11.5 MB, T2 2.0 MB and T3 2.8 MB (this session's own, live). The readings were
stepped back to back, each one after the last one's reads ended, so the times below are read time, not the 2 s tick.

| Transcript | Case | Readings | Reads | Bytes read | Stop | Read time |
|---|---|---|---|---|---|---|
| T0, T1, T2, T3 | a reload, no listed helper | 1 | 1 | 262,144 | time | at most 3 ms |
| T0, T1, T2, T3 | two sockets | 1 | 1 + 1 | 2 × 262,144 | time | at most 3 ms |
| T0 | two sockets, a listed helper started long ago | 8 | 32 + 32 | 2 × 8,388,608 | bytes | 32 ms |
| T1 | the same | 8 | 32 + 32 | 2 × 8,388,608 | bytes | 46 ms |
| T2 | the same | 1 | 4 + 4 | 2 × 976,076 (all below the seam) | start | 8 ms |
| T3 | the same | 2 | 7 + 7 | 2 × 1,793,692 (all below the seam) | start | 13 ms |

The backlog read took 3 to 8 ms; a `step` took at most 0.21 ms. The usual case is one 256 KiB read: a quiet session's
window already reaches back past ten minutes. The worst case is 8 MiB per socket, 1 MiB per reading over 8 readings, about
16 s at the 2 s tick. **Inferred:** in remote mode each read is one agent round trip, so the read time is the link's, which
this measurement does not cover. The readings themselves never wait for it.

## 5. Runs (measured)

One test file per process through the test slice, `--maxWorkers=2`, 2026-11-21 03:20Z to 04:26Z, the load at each file's
start between 4.0 and 28.7. The list: the new tests; every server test that imports `workflows/read`, `workflows/model`,
`transcript/tail`, `transcript/parse`, `sessionws` or `sessionFeed`; the rings suites, `single-definition`, the growth
checks, `topology-clean`, `deviation-refs` (after a fetch of `main`), `dtbd` and the ledger guard: 116 files. Then the
server's tests typecheck, and in `pwa/` the store tests (seven files) and its typecheck.

The first full run: 110 of the 116 server files, the seven `pwa` store files and the `pwa` typecheck passed. Six files and
the tests typecheck did not, all under load. Each was re-run alone once, and a file that failed again was run on an
extraction of `main` (66c63606c3):

| File | First run | Alone, on this branch | On `main` |
|---|---|---|---|
| `claimant-client-skew` | killed by the test slice's memory cap (5 kills) | 116 of 116 pass | |
| `ask-pairing-transcript` | one case times out at 60 s | 2697 of 2697 pass | |
| `reclaim-pause-pin` | one case times out at 20 s | times out again (load 11.4); a second run alone, 78 of 78 pass (load 8.9) | 78 of 78 pass (load 5.7) |
| `ask-pairing-skew` | the C7q case times out at 60 s | the same | the same case times out at 60 s, and 18 more fail after it |
| `secret-mask` | the slow-typing case times out at 20 s | the same | the same case times out at 20 s |
| `session-ladders-characterization` | the fresh-heartbeat case: `claimProbe` reads `gone` | the same, and its frame row | the same (its `NOW` is read at module load, so a slow run ages the fresh heartbeat) |
| tests typecheck | killed by the memory cap | killed again; then eight errors, all in `agent/src` (this work tree had no `agent/node_modules`) | |

After `npm ci` in `agent/`, the tests typecheck passes. None of the six files imports `helperScan.ts`, and the three that
fail alone fail the same way on `main`: they are load timeouts and a wall-clock pin, not this change (**measured** on
`main`; **inferred** for the cause of the ladder pin). `deviation-refs` was re-run after a fresh fetch of `main` at
66c63606c3: 34 of 34 pass. A merge of `main` into this branch is clean (`git merge-tree`, exit 0).

## 6. Residuals and records

- A resume offset inside a line loses that line, for the scan as for the chat (**inferred** from `TranscriptTailer`'s
  offset, which counts the bytes of a held partial line).
- A character split by the backlog seam reads as U+FFFD in that one line's text (**inferred**).
- Past `HELPER_FACTS_MAX` ids, an evicted id's later fact starts it afresh, so order can matter there (**inferred**).
- The scan's facts can name ids that are no Agent helper (a shell task's notification). Each costs the reader one meta read,
  once, in step 1, inside its budget, as the backlog's facts already did (**inferred**, H1b's behaviour).
- Review 3033 F9 and F10 are records for the coordinator: the H1b section's slug says "per active identity" where the code
  keeps one memory per feed, and `h1b.md`'s `model.ts` row omits `workflowLastActivity`, `orderHelperHook` and the strip.
