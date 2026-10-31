# ccrc history CP-39b: a sidecar over 8 MiB is captured by the streamed arm — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The sweep reads a sidecar whole only up to `SIDECAR_READ_WHOLE_MAX` (8 MiB). A larger one, up to `SIDECAR_MAX_BYTES`, goes through the existing streamed arm, which now reads into one reused buffer. So the sweep's own peak RSS stays under O20's 256 MiB on the floor interpreter whichever way V8's garbage collector falls.

**Architecture:** The measured cause comes first.
- CP-39's walk-cap case (2,100 walked names beside a 64 MiB sidecar) peaks at the V8 heap left over from the walk and transcript phase, plus `ingestSidecar`'s whole-read buffer and Brotli's working set. When no shrinking major GC has run before the read, that heap is about 104-151 MB, and the buffer is the 64 MiB one `readAt` allocates.
- Whether that GC runs first depends on CPU timing. With the same history code:
  - Node 22.16.0's floor CI leg read 219,212-221,220 KiB on some runs and 270,984-272,028 KiB (own peak, `VmHWM`) on others.
  - Node 22.16.0 on the fleet box read about 220,000-221,800 KiB alone and up to 279,752 KiB pinned to one CPU.
  - CI's Node 22.23.3 server shards read about 271,000-273,000 KiB on every tree.
- So O20 holds only in the low GC mode. Shipping the 64 MiB whole read is a bet on a GC the sweep does not control.

The streamed arm already exists. `compressFdRange` (store.mjs) reads 1 MiB pieces (`RANGE_PIECE`) into `createBrotliCompress` and a streaming sha256, and holds the compressed output. D-4589 already gives both arms one probe. This wave makes two changes:
- It moves the sweep's whole-or-stream decision from `SIDECAR_WHOLE_MAX` to a new, smaller `SIDECAR_READ_WHOLE_MAX` (D-6971).
- It makes `compressFdRange` read into ONE reused `RANGE_PIECE` buffer, awaiting each write's callback before refilling it (D-6973). Today it allocates a fresh piece per read, and the dead pieces wait for a GC, which is the very dependence this wave removes. Measured in a standalone script on Node 24.14.1, for 64 MiB of word text, as peak RSS growth: whole read 85,896 KiB; streamed with a fresh piece per read 57,788 KiB; streamed with one reused piece 23,976 KiB.
  - Measured (Task 2), on Node 22.16.0 as own peak: the pinned walk-cap high mode fell about 22-24 MB, from 271,256-271,788 KiB to 247,784-250,176 KiB, and DM47 fell about 37 MB. Every run is under 262,144 KiB. The worst margin is 4.6%, not the predicted 5%.

 `SIDECAR_WHOLE_MAX` keeps its value and its other meanings:
- expand's one-call decode bound;
- the oversize decode refusal;
- the base of `SIDECAR_MAX_BYTES`.

**Tech Stack:** Node ESM (`ccd/history/*.mjs`), `node:zlib` Brotli, `node:sqlite`, vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-ccrc-history-lossless-dag-design.md`: §9.2 step 4 ("A sidecar (FE6) is read whole, hashed and compressed in one pass … A larger one is streamed through `createBrotliCompress`"), DM47 ("a 64 MiB sidecar → ingested with peak RSS under O20's bound"), and O20 ("peak RSS under 256 MiB"). The coordinator corrects §9.2's sentence in a later docs PR, because another run holds the spec. This wave does not edit the spec.

## Global Constraints

- **O20 and DM47 hold.** The sweep's peak RSS is under 256 MiB on the floor interpreter, 22.16.0. `IX_RSS_BOUND_KIB` and every other bound keep their values: a bound change is a Later decision, and O20's is the operator's. Every DM47 behaviour is unchanged: an unchanged (size, `mtime_ns`) is not re-read, a changed one is re-hashed into a new row, differing copies sit side by side, and an unlinked one is counted.
- **The same stored result by content.** For the same bytes, whichever arm reads them, these are the same:
  - the blob's sha256 and `raw_len`;
  - its `sidecars` and `sidecar_seen` rows;
  - its link;
  - its index text.
  Only the compressed bytes may differ. The codec stays `br5` at `BR_QUALITY`. `compressFdRange` keeps its signature and its pieces (`RANGE_PIECE`, in file order), and its output decodes to the range's bytes. It also serves the capture of a transcript line longer than `LINE_MAX`, which gains the same saving.
- **One definition.** `SIDECAR_READ_WHOLE_MAX = 8388608` (8 MiB, *chosen*). It is exported once from `lib.mjs`, declared in `lib.d.mts`, and imported by `sweep.mjs`. Tests read it from lib, and the literal appears nowhere else.
- **`SIDECAR_WHOLE_MAX` and `SIDECAR_MAX_BYTES` keep their values and every other use.** Renaming `SIDECAR_WHOLE_MAX` is out of scope.
- **Files.** `ccd/history/lib.mjs`, `ccd/history/lib.d.mts`, `ccd/history/sweep.mjs`, `ccd/history/store.mjs` (`compressFdRange` and its doc), `server/test/history-ingest.test.ts`, and this plan. Never `deploy/**`, `shared/**`, `.github/**`, the spec or the ledger. In-place edits of earlier cases only where this plan licenses them (Task 1 Step 5).
- **D-numbers.** This wave was issued three numbers, and this plan defines all three: D-6971, D-6972 and D-6973. None is spare. A further departure is a stop: mail the coordinator.
- **Fixtures.** Synthetic `/home/u`-style paths only. No private name, host or absolute home path.
- **Live safety.** Use fixture homes and fixture stores only, built by the tests' own harness. Never run the sweep, the shim, the CLI or any history verb against the live `$HOME` or `~/.ccrc`.

## Review Focus

1. **Index text across the two arms.** A sidecar just over the threshold has a redactable value at its head and a word past the index window. The head word matches, the secret is in no FTS byte, and the far word does not match: the rules the whole arm applies. **Task 1, case (c).**
2. **The boundary and the reused piece.** A sidecar of exactly `SIDECAR_READ_WHOLE_MAX` bytes is read whole, and one byte more is streamed through one reused buffer. Both are stored byte for byte, and the streamed one's blob decodes to its bytes, so no piece was overwritten before the compressor took it. **Task 1, case (b).**
3. **Incompressible bytes.** A random sidecar over the threshold is stored with its sha256 and `raw_len`, and its blob decodes to the same bytes. **Task 1, case (d).**
4. **Duplicates in the streamed arm.** Two names with the same over-threshold bytes give one blob and two `sidecars` rows. **Task 1, case (e).**
5. **Both GC modes.** The walk-cap and DM47 cases stay under 262,144 KiB on Node 22.16.0, both alone and pinned to one CPU. A 5% margin (249,000 KiB) was the trigger for a look, not a bound: the coordinator accepted 4.6% (see Task 2 Step 2's Ruling bullet). **Task 2.**

## Files

| File | Change |
|---|---|
| `ccd/history/lib.mjs` | `export const SIDECAR_READ_WHOLE_MAX = 8388608;` beside `SIDECAR_WHOLE_MAX`, with its doc. `SIDECAR_WHOLE_MAX`'s doc is reworded to its remaining meanings, because it no longer decides the ingest arm. |
| `ccd/history/lib.d.mts` | `export const SIDECAR_READ_WHOLE_MAX: 8388608;` |
| `ccd/history/sweep.mjs` | The lib import names `SIDECAR_READ_WHOLE_MAX` in place of `SIDECAR_WHOLE_MAX` (the arm was its only code use). `ingestSidecar` reads whole when `size <= SIDECAR_READ_WHOLE_MAX`, else streams. The header bullet (about :5629) and the D-4589 comment (about :5693) name the new constant. |
| `ccd/history/store.mjs` | `compressFdRange` reads into one reused `RANGE_PIECE` buffer, awaiting each piece as the race of its write callback and `finished`, a try/catch that destroys the encoder on any throw out of the loop, and its doc says "a sidecar over SIDECAR_READ_WHOLE_MAX" (D-6973). |
| `server/test/history-ingest.test.ts` | A new describe for cases (a)-(g), and the `Transform` import (`node:stream`) that (f) and (g) need. In place (D-6972): DM47's 64 MiB case title (about :1746), S6's streamed-arm case title (about :2864), and FPM6's comment (about :2925). |
| `docs/superpowers/plans/2026-10-26-ccrc-history-cp39b-streamed-sidecar.md` | This plan, then its Measured section. |

## Not in this plan

- The §9.2 sentence: the coordinator corrects it in a docs PR.
- Any bound change, O20's included.
- Lowering the walk phase's own heap.
- Renaming `SIDECAR_WHOLE_MAX`.

---

### Task 1: the threshold, the arm and the reused piece (D-6971, D-6972, D-6973)

**Files:** the five files in the table, excluding the plan.

**Interfaces:**
- Consumes:
  - `ingestSidecar(db, ctx, s, budget, g)` and its two arms (sweep.mjs, about :5679-5692);
  - `compressFdRange(fd, start, end) -> Promise<{sha, z, rawLen} | null>` (store.mjs, about :1052), with its signature unchanged;
  - in-process `S.ingestSidecars(db, ctx, budget, uuids)`, with a box built through `IX.newBox`, `IX.plantCopy`, `IX.openFixtureStore` and `S.makeIngestCtx`, as DM47's in-process case builds its own (about :1727). Unlike that case, skip `ingestTick`: with no `ingest_files` row the transcript reads as caught up (sweep.mjs about :5436). Do not use CP-39's `fixture`, which plants 30 other sidecars;
  - CP-39's `countReads` spy pattern: `fs.readSync` replaced, then `syncBuiltinESMExports()`, restored in a `finally`.
- Produces: `SIDECAR_READ_WHOLE_MAX: 8388608`, exported from lib.mjs and declared in lib.d.mts.

- [ ] **Step 0: Check the base, then measure "before" (no edit).**
  - `server/test/fixtures/history/rss-peak.mjs` (CP-38, #1557) must be on your base, so that the preload reports the own peak. If it is not, stop and mail the coordinator.
  - Then do Task 2's Steps 1-2 at the base, for the walk-cap case and DM47's 64 MiB case: Node 22.16.0, 5 runs alone and 5 pinned to one CPU, per case. Keep every figure for Task 2.

- [ ] **Step 1: Write the failing cases.** In `history-ingest.test.ts`, add `describe('CP-39b: a sidecar over SIDECAR_READ_WHOLE_MAX is captured by the streamed arm (D-6971, D-6973)')`.
  - Nest the describe INSIDE the FTS describe ("the FTS index (plan task 23)"), after the D-4312 describe. There it reaches `hex`, `matches`, `ftsBytes` and `secretFile`, and inherits that describe's darwin skip, which (b)'s `/proc/self/fd` read needs.
  - Prefix each case title with its letter, "(a)" to "(g)", so a `-t` filter can select one case. Cases (f) and (g) need `import { Transform } from 'node:stream'`.
  - Cases (b), (d) and (e) plant one transcript under `box.homes[0]`, built as the Interfaces say. Each writes its sidecars to `path.join(box.homes[0]!, 'projects', IX.SLUG, IX.U, 'tool-results')`, made with `mkdirSync(…, { recursive: true })`, and runs `S.ingestSidecars(db, ctx, S.newBudget(), [IX.U])` once.
  - Cases (b)-(e) remove `box.home` with `fs.rmSync(box.home, { recursive: true, force: true })` in a `finally`, as DM47 does: about 16 MiB per case.
  - (b) runs under a spy. For each sidecar name, keyed by the descriptor's `/proc/self/fd` link, the spy records the largest `length` argument a `readSync` call asks for, and the set of buffer objects passed. Restore the spy in a `finally`.
  - Content is `IX.words(4000, k)` bytes cut to size, except in (d).
  - (a) `lib.SIDECAR_READ_WHOLE_MAX` is `8 * 1024 * 1024`, and is below `lib.SIDECAR_WHOLE_MAX`.
  - (b) `at.txt` holds `SIDECAR_READ_WHOLE_MAX` bytes and `over.txt` holds `SIDECAR_READ_WHOLE_MAX + 1` (nine pieces). Expect:
    - CONTROL: both names were read.
    - `at.txt`'s largest read is `SIDECAR_READ_WHOLE_MAX`.
    - `over.txt`'s largest read is at most `1 << 20`, and every one of its reads passed ONE buffer object.
    - Each `sidecars` row's blob has the sha256 and `raw_len` of the written bytes.
    - `brotliDecompressSync` of `over.txt`'s stored `z` equals its bytes.
  - (c) The box is built and swept as S6's streamed-arm case does it (`secretFile`, `IX.plantCopy`, `IX.sweepTwice`). `over.txt` is written to the same `tool-results` path as in (b) (`mkdirSync` recursive). S6's `sideFile` and `straddle` are local to the D-4312 describe and are not needed. It holds `SIDECAR_READ_WHOLE_MAX + 4096` bytes:
    - its head carries S6's secret-value line, built at runtime, and a plain head word;
    - a distinct word sits after `SIDECAR_FTS_BYTES + SIDECAR_REDACT_MARGIN`.
    Expect:
    - CONTROL: the head word matches (`matches(db, …)`).
    - The secret's 12-character prefix is not in `ftsBytes(db)`.
    - The far word does not match.
    - `IX.blobsHold(db, tok)` is true.
    No spy is needed here: (b) pins the arm.
  - (d) `rand.bin` holds `randomBytes(SIDECAR_READ_WHOLE_MAX + 4096)`. Its row's sha256 and `raw_len` match the bytes, and `brotliDecompressSync` of the stored `z` equals them.
  - (e) `a.txt` and `b.txt` hold the same `SIDECAR_READ_WHOLE_MAX + 4096` bytes. Expect one `blobs` row for that sha256 and two `sidecars` rows naming it.
  - (f) `node:zlib`'s `createBrotliCompress` is replaced (`Object.defineProperty`, because the export is configurable but not writable, then `syncBuiltinESMExports()`, restored in a `finally`) by a stub Transform that fails on its SECOND write, in two shapes: `native` (`this.destroy(boom)`, the write callback never called, as zlib's own error path does) and `callback` (`cb(boom)`). `compressFdRange` runs on a 3 MiB file (three `RANGE_PIECE` pieces), raced against the case's own 5 s timer. For both shapes expect: it settles in time, rejects with `boom`, and a `process.on('unhandledRejection')` listener, added before and removed in the `finally`, saw nothing after a `setTimeout(0)` and a `setImmediate` tick.
  - (g) The same stub swap, with a pass-through Transform, and `fs.readSync` replaced (module object, `syncBuiltinESMExports()`, restored in a `finally`) so that the second read of the case's descriptor throws. Expect `compressFdRange` rejects with that error, and the stub encoder's `destroyed` is `true`.

- [ ] **Step 2: Run, and record the reds.**
  `./node_modules/.bin/vitest run test/history-ingest.test.ts -t "CP-39b"` (from `server/`, foreground, timeout at least 600000).
  Predicted: (a)-(d) are red on the undefined export (every size is NaN), and (e) may pass on empty files. Record what is measured.
  - Measured: all five were red, (e) included, not four. (a) failed with `expected undefined to be 8388608`. (b) failed with `The "size" argument must be of type number. Received undefined`. (c), (d) and (e) failed with `The value of "size" is out of range ... Received NaN`, so (e) did not pass on empty files: its red is `Buffer.alloc(NaN)` in `wordBytes`, before any write.

- [ ] **Step 3a: The constant alone.** Add the lib.mjs export and the lib.d.mts line only, and re-run the same filter. Predicted:
  - (a) is green.
  - (b) is red, because `over.txt`'s largest read is `SIDECAR_READ_WHOLE_MAX + 1` (the whole arm).
  - (c)-(e) are green on the whole arm; they are the arm-independence pins.
  Record what is measured.
  - Measured: as predicted. `Tests  1 failed | 4 passed`; only (b) was red, `AssertionError: expected 8388609 to be less than or equal to 1048576`.

- [ ] **Step 3b: The arm and the reused piece.**
  - lib.mjs: the new constant's doc says that 8 MiB is *chosen*, and that a larger sidecar, up to `SIDECAR_MAX_BYTES`, is streamed so that the sweep never holds a large sidecar whole beside the walk phase's heap (O20, D-6971).
  - Reword `SIDECAR_WHOLE_MAX`'s doc. It is the largest measured sidecar (keep the M figure). It no longer decides the ingest arm. It remains expand's one-call decode bound, the oversize decode refusal's sidecar arm and the base of `SIDECAR_MAX_BYTES`.
  - sweep.mjs: in the lib import, name `SIDECAR_READ_WHOLE_MAX` in place of `SIDECAR_WHOLE_MAX`. Set the arm test to `size <= SIDECAR_READ_WHOLE_MAX`, and update the header bullet and the D-4589 comment.
  - store.mjs, `compressFdRange`:
    - allocate one `RANGE_PIECE` buffer before the loop;
    - read each piece into it (the last one sliced to its length);
    - `hash.update` the piece;
    - replace the existing `drain` wait with `await Promise.race([new Promise((res, rej) => enc.write(chunk, (e) => (e ? rej(e) : res()))), finished])`, and await no drain. (The first version awaited the write callback alone; zlib's native error path destroys the encoder and never runs an in-flight write's callback, so the race on `finished`, which cannot resolve before `enc.end()`, is what makes a compressor failure reject the call: D-6973, case (f).) Node emits `'drain'` BEFORE it runs the write callback, so a drain wait kept after the callback would hang for good. The callback fires only once zlib has consumed the piece, so it is then safe to overwrite, and a write error now rejects instead of writing on into a destroyed stream.
    - run the loop, `enc.end()` and the final `await finished` inside a try whose catch calls `enc.destroy()` and rethrows, so a read or compressor error rejects the call with the encoder destroyed;
    Keep the null return on a short read, and update the doc (D-6973).
  Re-run the filter: all seven green.

- [ ] **Step 4: Run green.** Run the CP-39b filter, then the whole `history-ingest.test.ts`, `history-lib.test.ts`, `history-recall.test.ts`, `history-export.test.ts`, the test typecheck (`./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit`), and the `single-definition/*` area files.

- [ ] **Step 5: In place (D-6972).**
  - Retitle DM47's 64 MiB case to `DM47: a 64 MiB sidecar and a larger one are both streamed, byte for byte, with peak RSS under O20's bound`. Its files, its byte-for-byte checks and its bound stay as they are. Add a one-line comment naming D-6972 and the CP-39b describe that pins the boundary.
  - S6's streamed-arm case title says "a sidecar over SIDECAR_READ_WHOLE_MAX".
  - FPM6's comment names the new constant where it names the arm.
  - Nothing else in these cases changes.

- [ ] **Step 6: Mutants.** Each must go red, and each is restored byte for byte, with `cmp` silent, before the next.
  - M1: sweep.mjs's import and arm test both read `SIDECAR_WHOLE_MAX` again. Expect (b) red.
    - Measured: (b) red, `expected 8388609 to be less than or equal to 1048576`.
  - M2: `<` in place of `<=`. Expect (b) red at `at.txt`.
    - Measured: (b) red, `expected 1048576 to be 8388608`.
  - M3: lib.mjs's constant set to `SIDECAR_WHOLE_MAX`. Expect (a) red. Run (a) alone (`-t "CP-39b.*\\(a\\)"`), because (b)-(e) size themselves from the constant by design.
    - Measured: (a) red, `expected 67108864 to be 8388608`.
  - M4: `compressFdRange` allocates a fresh piece per read again. Expect (b) red on the one-buffer assertion.
    - Measured: (b) red, `every read of over.txt passed one buffer object: expected 9 to be 1`.
  - M5: `enc.write(chunk)` with neither the callback nor `drain` awaited. Expect (b) red on the decode. Measured in a standalone script on Node 24.14.1 (a 20 MiB patterned file, one reused 1 MiB piece): corrupt every time, while the callback await and a drain-only wait both decode correctly.
    - Measured: (b) red on the decode, `expected false to be true`.
  - M6: drop only the `finished.catch(() => {})` handler (the first version of the D-6973 follow-up). Expect (f) red on the unhandled rejection.
    - Measured on that version: (f) red with `AssertionError: no rejection was left unhandled: expected [ …(1) ] to deeply equal []`. At the base code (28d4ab3a5) (f) was red with the same line, before the follow-up.
    - Retired at fix round 1: once each piece's race subscribes to `finished` from the first write, the handler guards nothing. With the line dropped the whole CP-39b filter stayed green (`Tests  7 passed | 200 skipped`), so the line was removed (no guard without a red test) and M6 retired.
  - M7: back to awaiting only the write callback (no race on `finished`). Expect (f)'s native shape red, on the case's own timer.
    - Measured: (f) red, `native: compressFdRange did not settle within 5 s: expected true to be false`. At the code before the race the native shape was red with the same line, before the fix.
  - M8: delete the catch's `enc.destroy()`. Expect (g) red.
    - Measured: (g) red, `the encoder was destroyed: expected false to be true`. Before (g), all six cases stayed green with this deletion.

- [ ] **Step 7: Commit.** `feat(history): a sidecar over 8 MiB is captured by the streamed arm, through one reused piece (CP-39b Task 1; D-6971, D-6972, D-6973)`

### Task 2: the measurement

**Files:** this plan's "Measured" section only.

- [ ] **Step 1: Get Node 22.16.0.** Download `node-v22.16.0-linux-x64.tar.xz` and that release's `SHASUMS256.txt` from nodejs.org/dist/v22.16.0/, and check the sha256. Extract it under `.superpowers/sdd/history-cp39b/`. Remove it at the end of the task.

- [ ] **Step 2: Measure "after".** From `server/`, run each command one per call, in the foreground, with `free -m` read first.
  - The walk-cap case: `<node22>/bin/node ./node_modules/vitest/vitest.mjs run test/history-ingest.test.ts -t "O20 at the walk.s cap"`
  - DM47's 64 MiB case: the same command with `-t "DM47: a 64 MiB sidecar"`.
  Do 5 runs alone, and 5 pinned to one CPU (`taskset -c <one cpu>`), for each case. Record each printed `peak RSS <n> KiB` line. The figure is the own peak (`VmHWM`), through CP-38's preload, which Step 0 confirmed is on your base.
  Expected: every "after" run is below 249,000 KiB, a 5% margin under 262,144 (a trigger for a look, not a bound: the Ruling bullet below accepted 4.6%). Report the largest and its margin. If any run is above 249,000 KiB, stop and mail the coordinator with every figure. Also run the box's Node, 3 runs alone per case.
  - Measured: two of the five pinned walk-cap runs were over 249,000 KiB: 250,176 and 249,996. The largest is 11,968 KiB under 262,144, a 4.6% margin. Every other run was under 249,000. The worker stopped and mailed every figure.
  - Ruling (coordinator): the 249,000 KiB line was a trigger for a look, not a bound. It was met at 4.6%, and the coordinator accepted that margin.

- [ ] **Step 3: Write "## Measured".** Give the "before" (Task 1 Step 0) and "after" tables, the Node versions, and the CPU pinning. If no "before" run reached the high mode, say so: the high mode is then evidenced by CI only, from the walk-cap's 270,984-272,028 KiB own-peak readings on the floor leg. Commit: `docs(plan): CP-39b, the measured peaks (CP-39b Task 2; D-6971)`

### Task 3: the PR

- [ ] Before opening the PR, run `deviation-refs` after `git fetch origin main`, and the private-name scan over the added lines, the commit messages and the PR body (0 hits).
- [ ] Open the PR against main, ready for review, titled "ccrc history CP-39b: a sidecar over 8 MiB is captured by the streamed arm". Its body has these sections:
  - Summary
  - Measured (both tables)
  - Departures (D-6971, D-6972, D-6973)
  - Residuals named, below
  - Tests run
  - Steps for the coordinator: the §9.2 sentence, and watching the node floor leg on the next daily full run
- [ ] Read the threads with `gh api graphql`, and confirm CI ran at the head. The node floor leg is expected green. If it is red, stop and mail the coordinator, because that is this wave's red now.

## Measured

Every figure is the sweep's own peak (`VmHWM`) in KiB, printed by the case's `peak RSS <n> KiB` line through CP-38's preload. The interpreter is Node 22.16.0, the floor (the official linux-x64 tarball, sha256 checked against its `SHASUMS256.txt`), unless a row says otherwise. "Pinned" means `taskset -c 5`, one CPU of 16. Each run is one command in the foreground, one per call, with `free -m` read first (at least 14.6 GB available throughout).

Method: the default reporter prints nothing on a passing run, so every figure was read with `--reporter=verbose --silent=false` added to the plan's command. It is the same test, in the same process, one run per call. Two "before" walk-cap runs made before the flag was added passed with no figure printed; they are counted as passes below.

**Before**, at base `ba36d7420` (CP-38's merge):

| Case | Alone | Pinned |
|---|---|---|
| Walk-cap (`O20 at the walk's cap`) | 268,484 · 269,068 · 268,676 · 269,172 · 217,112, plus two passes with no figure | 271,788 · 271,604 · 271,404 · 271,256 · 271,756 |
| DM47's 64 MiB case | 233,832 · 233,140 · 224,144 · 234,736 · 232,972 | 228,204 · 232,760 · 232,180 · 233,756 · 232,676 |

The high GC mode was reached locally: alone on four of the five printed walk-cap runs, and pinned on all five. Each of those runs was over 262,144, so the case was red. That agrees with CI's 270,984-272,028 on the floor leg.

**After**, at `28d4ab3a5`. That is Task 1 before its D-6973 follow-up `15b862fd7`, which rewrote the error path's control flow: the `finished` handler, the try/catch and the destroy. The rows below therefore measure the threshold and the reused piece, not that control flow, which the next two sets of figures cover.

| Case | Alone | Pinned |
|---|---|---|
| Walk-cap | 244,104 · 208,392 · 223,148 · 190,148 · 224,852 | 247,784 · 250,176 · 248,068 · 248,836 · 249,996 |
| DM47's 64 MiB case | 197,100 · 195,172 · 194,352 · 197,144 · 196,916 | 195,360 · 182,228 · 197,300 · 193,252 · 195,636 |

The largest reading is 250,176 (walk-cap, pinned): 11,968 KiB, or 4.6%, under 262,144. The coordinator accepted that margin (Task 2 Step 2). Every run passed.

**The box's Node, v24.14.1** (bound 512 MiB), alone, at `28d4ab3a5`:
- walk-cap: 333,588 · 273,264 · 189,808;
- DM47: 210,872 · 210,484 · 210,988.

**The held-out review's figures**, at `16b76d47b`, which carries the follow-up's control flow. They are review 979's own, on Node 22.16.0 (tarball sha256 checked), walk-cap pinned with `taskset -c 11`: 246,672 · 223,088 · 188,364. All three passed.

**At the fix-round tip**, `efd29f404`, after fix round 1 (each piece raced against `finished`, D-6973). Node 22.16.0 (the official tarball, sha256 checked), pinned with `taskset -c 5`, `--reporter=verbose --silent=false`, one per call, with `free -m` read first (at least 14.7 GB available):

| Case | Pinned |
|---|---|
| Walk-cap | 246,808 · 249,008 · 225,300 |
| DM47's 64 MiB case | 189,416 · 193,452 · 188,840 |

The largest is 249,008 (walk-cap): 13,136 KiB, or 5.0%, under 262,144. It is 8 KiB over the 249,000 trigger line, which the coordinator's 4.6% ruling covers, and under 252,000 KiB, the fix round's own stop line: any run over it, in either case, would have stopped the worker, who mails the coordinator every figure, as Task 2 Step 2 does at 249,000. Every run passed.

## Residuals named

- The streamed arm compresses while it reads, before the blob probe. A changed (size, `mtime_ns`) sidecar between 8 and 64 MiB whose bytes are already stored now costs a compression the whole arm skipped. That is CPU only, and only on a re-read.
- The walk phase's heap is unchanged. The margin under 256 MiB is what Task 2 measures.
- What remains of the pinned walk-cap peak is the walk phase's own heap. Lowering it is a Later item; the margin is 4.6%.
- An incompressible sidecar near 64 MiB still costs about twice its compressed size in the streamed arm: `out[]` plus `Buffer.concat`. Measured in a standalone script on Node 24.14.1, random 64 MiB grew peak RSS by 206,476 KiB whole, 156,900 KiB streamed with a fresh piece, and 143,884 KiB with the reused piece. Beside the walk phase's heap that is over O20's bound. O20 is evidenced here for compressible content only; a bound or design decision for incompressible sidecars is the operator's (Later).
- `SIDECAR_WHOLE_MAX`'s name now describes only the decode bound.
- The short-read arm's `enc.destroy()` (a file that shrinks under the read, the null return) is pinned by no test. Without it, the encoder's native state is held until GC.
- The two arms' index text was traced equal by reading in review (`sidecarIndexText(buf)` against `ftsTextOfBlob` through the bounded prefix decoder, both cut to the same window: identical for any file over 576 KiB). Case (c) pins three properties of the streamed arm, not an equality of the two arms' index text on the same bytes (Later).

## Deviations found

- **D-6971** — `history-sidecar-read-whole-8mib` (Task 1; spec §9.2 step 4, DM47, O20). The sweep reads a sidecar whole only up to `SIDECAR_READ_WHOLE_MAX`, 8 MiB (*chosen*). A larger one, up to `SIDECAR_MAX_BYTES`, goes through the streamed arm (`compressFdRange`).
  - §9.2 says a sidecar is read whole up to 64 MiB, "well inside the run's RSS bound (DM47)". That was measured otherwise. CP-39's walk-cap case read 270,984-272,028 KiB (own peak) on the node floor CI leg, and 279,752 KiB on Node 22.16.0 pinned to one CPU, against O20's 262,144, when V8 had not shrunk the walk phase's heap before the 64 MiB read. It read 219,212-221,220 KiB on CI, and about 220,000-221,800 KiB on the fleet box, when V8 had.
  - `SIDECAR_WHOLE_MAX` keeps its value and its other meanings: expand's one-call decode bound, the oversize decode refusal, and the base of `SIDECAR_MAX_BYTES`.
  - Stored results are the same by content; only the compressed bytes may differ.
- **D-6972** — `history-dm47-both-arms-stream` (Task 1; DM47). Three earlier texts are edited in place:
  - DM47's 64 MiB case is retitled, because its 64 MiB sidecar is now streamed like the larger one. Both are still checked byte for byte, under O20's bound.
  - S6's streamed-arm title and FPM6's comment name the new threshold.
  The arm boundary itself is pinned by CP-39b's cases at `SIDECAR_READ_WHOLE_MAX`.
- **D-6973** — `history-compress-range-one-piece` (Task 1; O20). `compressFdRange` reads into one reused `RANGE_PIECE` buffer, awaiting each write's callback before refilling it, in place of a fresh 1 MiB buffer per read whose dead copies wait for a GC. Measured in a standalone script on Node 24.14.1, for 64 MiB of word text, as peak RSS growth: 85,896 KiB whole, 57,788 KiB streamed with a fresh piece, 23,976 KiB with one reused piece. `compressFdRange` awaits each piece as the race of its write callback and `finished`, because zlib's native error path destroys the encoder and never runs an in-flight write's callback. Each piece's race and the final await observe `finished`, and the encoder is destroyed on any throw out of the loop, so a compressor or read error, in either shape, rejects the call: no hang and no unhandled rejection. Pinned by CP-39b case (f) (both shapes; mutant M7), and case (g) (a read error destroys the encoder; mutant M8), so the catch's destroy is pinned. The short-read arm's `enc.destroy()` (the null return) is pinned by no test. The first version's `finished.catch(() => {})` and its mutant M6 are retired: with the race in place the line guards nothing, and M6 stayed green.
  - The pieces, their order, the sha256 and the decoded bytes are unchanged.
  - The capture of a transcript line longer than `LINE_MAX` takes the same path, and gains the same saving.
