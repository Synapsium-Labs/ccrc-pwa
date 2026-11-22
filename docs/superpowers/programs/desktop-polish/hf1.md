# Task HF1: the start scan's carried findings (D-8876)

The plan's entry is the "Task HF1" section of `docs/superpowers/plans/2026-10-22-desktop-polish.md`. This note is its record:
what changed, the red-first evidence, the mutation table and the runs. Each claim is labelled **measured** (a command was
run and its result seen) or **inferred** (deduced from the code). Fixtures use neutral names. The findings are review 3067's
F1 to F10 (H1c, #3149, at 1516db6288) and review 3080's F1 (S1, #3142).

## 1. What changed

| File | Ring, context | Change | Finding |
|---|---|---|---|
| `server/src/transcript/tail.ts` | L3, C3 | `scanEnd` on every measured file: the window's first byte, the file's size when the window read fails, 0 for an empty file; absent only with `missing` | F5 |
| `server/src/workflows/helperScan.ts` | L3, C3 | A restart on a new seam after a failed read, once per seam; the cutoff lowered by each later usable roster, and a time stop lifted when it no longer holds; the pump's promise kept | F6, F7, F8 |
| `server/test/helper-scan.test.ts` | test | Cases for F2, F3, F4, F6 and F7; `drain` waits on the pump's promise | F2 to F4, F6 to F8 |
| `server/test/transcript-tail.test.ts` | test | The unreadable arm's pin now carries `scanEnd`; a case for the empty file | F5 |
| `server/test/sessionws-helpers.test.ts` | test | A stream whose window read fails still scans, and draws the launch's start; `open` takes an IO | F5 |
| `server/test/migration-slots.test.ts` (new) | test | Slots 106 to 117 of `MIGRATIONS`, each pinned by a DDL fragment no other entry carries | review 3080 F1 |

Records: F1, F9 and F10 are corrected in `h1c.md` and, for F1 and F10, in a dated note at the end of the plan's Task H1c
section.

`server/src/sessionws.ts` is unchanged: the stream already turns any `scanEnd` into its seam
(`sendBacklogAndTail`), so F5 needs no line there (**measured**: the branch's diff names no `sessionws.ts`). No file this
branch changes is listed in `server/test/growth-frozen/` or `server/test/growth-caps/` (**measured**: both directories
list other files only).

**F7, which and why.** The cutoff is lowered, not waited for. Waiting for a usable roster would leave a session whose hook
state is never usable with no scan, or with a late one, and every row would wait for it. Lowering costs nothing when the
first roster was right. A scan that already stopped on time reads on from where it stopped: its walk is kept, so no byte
is read twice, and the 8 MiB bound still holds over the whole walk. Only a usable roster moves the cutoff, and only
downwards, so a clock that steps back with no usable roster does not reopen a time stop (**measured**: the "only falls"
case, and mutant HF-S10).

**F6, once per seam.** Seams are compared by value: the file, the end and the cut. So a second backlog that hands over the
same window is the same seam and restarts nothing. A seam that differs restarts the scan once. A restart that fails too
waits for the next new seam (**measured**: the two F6 cases). Only a stop on a failed read restarts. A scan that stopped on
time, on bytes or at the file's start never restarts on a seam.

## 2. Red first (measured)

The first commit (`test(server): the start scan's carried findings, red first`) held the tests. Each file was run against
this branch's base, `main` at 841a8528f6, with only the test files changed, one file per process through the test slice,
`--maxWorkers=2`, at a load of 13.5 to 13.9, 2026-11-21:

| File | On `main` |
|---|---|
| `helper-scan` | 3 of 32 fail: both F6 cases (`expected 'unreadable' to be 'start'`; one read where two were expected) and F7's resume (`expected [] to deeply equal [ 'a1' ]`) |
| `transcript-tail` | 2 of 10 fail: the unreadable arm and the empty file, each with no `scanEnd` |
| `sessionws-helpers` | 1 of 15 fails: the stream whose window read fails never scans (`{ bytes: 0, reads: 0, stop: null }`) |
| `migration-slots` | 2 of 2 pass: a characterization pin |

F2, F3, F4, F7's two minimum cases and the migration slots are characterization pins. They pin behaviour `main` already
has, so they are green on `main`, and each goes red under its mutant (section 3). Three cases were added after the first
mutation round, and the F8 wait came with the code.

## 3. Mutation run (measured)

`ccd/coordinator-skill/references/mutation-run.py`, `--no-coverage`, through an adapter of H1c's kind. Each TypeScript file
is held as a module's text. A mutant is written into a scratch copy of the tree, outside the work tree in this session's
temp root, and one test file runs there through `ccrc test` with `--maxWorkers=2`. A run that exits non-zero with no failed
test is retried, and is never counted as a kill. Every kill below was logged with the case that failed. Load 10.7 to 12.1,
2026-11-21, 14:25Z to 14:28Z.

Round 1: 24 mutants, 21 killed, 3 survived. Round 2, after three cases were added: `helperScan.ts` again, 16 of 16
killed. The 8 mutants in `tail.ts`, `model.ts` and `schema.ts` were killed in round 1, and no case they depend on changed,
so they were not run again.

| Id | Mutant | Round 1 | Round 2 (the case that failed) |
|---|---|---|---|
| HF-S1 | F2: a plain `await` for the read, no catch | killed | killed (F2: a read that rejects) |
| HF-S2 | F3: the oldest time skips the first timed line | killed | killed (F3: one old line) |
| HF-S3 | F6: no restart | killed | killed (F6: a new seam restarts) |
| HF-S4 | F6: a restart on every seam, the same one too | killed | killed (H1c's "a failed read ends the scan") |
| HF-S5 | F6: a restart after any stop | killed | killed (F6: a restart that fails again; another stop never restarts) |
| HF-S6 | F6: seams compared by object, not by value | killed | killed (F6: a new seam restarts) |
| HF-S7 | F6: the seam's end left out of the comparison | killed | killed (F6: a new seam restarts) |
| HF-S8 | F6: the seam's cut left out of the comparison | **survived** | killed (added: the same seam only with the same cut) |
| HF-S9 | F7: no lowering | killed | killed (F7: a later roster lowers the cutoff) |
| HF-S10 | F7: an unusable roster lowers it too | killed | killed (F7: the cutoff only falls) |
| HF-S11 | F7: the new cutoff replaces the old, not the minimum | killed | killed (F7: the minimum of old and new) |
| HF-S12 | F7: no resume after a time stop | killed | killed (F7: a later roster lowers the cutoff) |
| HF-S13 | F7: a resume without checking that the stop no longer holds | **survived** | killed (added: lowered, but not low enough) |
| HF-S14 | F7: the check strict (`>` for `>=`) | **survived** | killed (added: lowered to the stopping line exactly) |
| HF-S15 | F8: a second pump while one runs | killed | killed (H1c's "one read at a time") |
| HF-S16 | F7: the time stop records no stopping line | killed | killed (F7: a later roster lowers the cutoff) |
| HF-T1 | F5: an empty file answers no `scanEnd` | killed | (round 1: the empty file) |
| HF-T2 | F5: the unreadable arm answers no `scanEnd` | killed | (round 1: the unreadable arm) |
| HF-T3 | F5: the unreadable arm's `scanEnd` is 0 | killed | (round 1: the unreadable arm) |
| HF-T4 | F5: the absent arm answers `scanEnd` too | killed | (round 1: the file unlinked between the stat and the read) |
| HF-M1 | F4: the bound ranks by the launch's time, else the end's | killed | (round 1: the newer of the two facts) |
| HF-M2 | F4: the bound ranks by the end's time, else the launch's | killed | (round 1: the newer of the two facts) |
| HF-G1 | review 3080 F1: slots 110 and 111 swap their SQL, banners left in place | killed | (round 1: each slot holds its own migration) |
| HF-G2 | review 3080 F1: slots 116 and 117 swap their SQL, banners left in place | killed | (round 1: each slot holds its own migration) |

## 4. Runs

**Measured.** One test file per process through the test slice, `--maxWorkers=2`, on 2026-11-21 from 14:31Z to 16:02Z.
The load at each file's start was between 8.5 and 36.1, under sustained I/O pressure on the box: about 10% of time stalled
on I/O, and one `coord-db` worker sat in disk sleep waiting on the journal.

The list has 87 files:
- the four test files above;
- every server test that imports `workflows/helperScan`, `workflows/read`, `workflows/model`, `transcript/tail` or
  `sessionws`;
- `coord-db` and `run-close-switch` (the migration-list pins);
- the rings suites and `single-definition` (43 files);
- `growth-caps`, `growth-check`, `topology-clean`, `deviation-refs` (after a fetch of `main` at fd16dcd0c2), `dtbd` and
  the ledger guard.

The first full run: 82 of the 87 files passed, the 43 `single-definition` files among them. Five did not. Each was re-run
alone once. A file that failed again was run on an extraction of this branch's base, `main` at 841a8528f6:

| File | First run | Alone, on this branch | On the base |
|---|---|---|---|
| `rings/pwa-one-owner` | its worker killed by SIGKILL after 32 of 42 passed | 42 of 42 pass | |
| `coord-db` | 2 of 155 time out: W3-M64's released identity at 20 s, the migration's failure at any statement at 120 s | 3 time out, those two among them (load 24.2) | the same two time out (load 16.8) |
| `ask-pairing-transcript` | one case times out at 60 s (the recorded frame sequences) | the same | the same case times out; one more fails only because the extraction has no `pwa/` |
| `secret-mask` | the slow-typing case times out at 20 s, and its worker dies | that case and the slow long-word case time out | the slow long-word case times out at 20 s |
| `session-ladders-characterization` | the fresh-heartbeat case: `claimProbe` reads `gone` | the same | the same (H1c's note records it: its `NOW` is read at module load) |

The four that fail alone also fail on the base, in the same cases or in the same describe's timing cases. They are load
timeouts and a wall-clock pin, not this change. **Inferred** for the cause: none of the failing cases reaches the start
scan, whose only caller is the workflows reading, or the backlog's unreadable or empty arm.

Typechecks:
- `tsc --noEmit` for the server: passes.
- The server tests' full typecheck (`test/tsconfig.tests.json`) was killed by the test slice's 6 GB memory cap, as H1c's
  was.
- In its place, a scratch tsconfig that extends it and includes the four test files above passes. With `--listFiles` it
  compiles those four, `helperScan.ts` and `tail.ts`.

CI's fast run is the arbiter for the tests typecheck.

## 5. Residuals and records

- `HelperStartScan.pumpDone` is a private field that only the test reads (`scan-pump-is-awaitable`). The test already read
  the private `pumping` the same way (**inferred**: no production reader, `step` never awaits it).
- A restart reads again bytes that the failed walk had already read. The fold is order-independent and idempotent, so
  this costs reads, never rows (**inferred**, review 3067 F6's own reading).
- A time stop is lifted only while the walk still has reads. A scan that stopped on bytes or at the file's start stays
  stopped, whatever the roster says (**inferred** from `stopAtEnd`).
- The H1c PR's body (#3149, merged) keeps its round-1 figure of 52 mutants. It is merged and nothing here edits it. The
  plan and `h1c.md` carry the correction.
