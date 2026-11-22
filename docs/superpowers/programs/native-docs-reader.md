# Program: native-docs-reader

Spec: `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md` (approved 2026-10-01); completion envelope `docs/superpowers/specs/2026-11-07-native-docs-reader-completion-design.md` (coordinator calls under autonomy, 2026-11-07).
Completion plan: `docs/superpowers/plans/2026-11-07-native-docs-reader-completion.md` (Tasks 1–18: A → B1 → B2 → C1 → C2 → D; required appearance/parity/draft extensions planned after A converge with D before E → F → separate operator cutover; no overlapping Docs workers). W5b leaf plan: `docs/superpowers/plans/2026-11-05-native-docs-reader-w5b-parity.md`, #2350.
Plans: W1 `docs/superpowers/plans/2026-10-01-native-docs-reader-w1-ccd-reads-docs.md`; W2 `docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md`; W8a `docs/superpowers/plans/2026-10-31-native-docs-reader-w8a-reader-frame-core.md`; W5 Export `docs/superpowers/plans/2026-11-03-native-docs-reader-w5-part2-export.md`; W5h-b `docs/superpowers/plans/2026-11-03-native-docs-reader-w5h-b-measured-values.md`; first-load compression `docs/superpowers/plans/2026-11-03-native-docs-reader-first-load-compression.md`; phone header `docs/superpowers/plans/2026-11-03-native-docs-reader-phone-header.md`; reader lab `docs/superpowers/plans/2026-11-03-native-docs-reader-reader-lab.md` (design `docs/superpowers/specs/2026-11-03-reader-lab-design.md`); library 1.1 take-up `docs/superpowers/plans/2026-11-05-native-docs-reader-library-1-1-take-up.md`
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-calm-canyon`   Workspace: a fresh child per wave

**What this program is.** ccrc gains its own session-gated Docs reader for each install's own project docs:
specs, plans, product-design and conventions, plus vision and promise in the approved W5b delivery. It replaces the operator's standalone, tailnet-only docs server
with nothing outside ccrc's auth. The content stays in each user's own repositories and is never bundled.
The fleet box reads docs through four narrow ccd verbs (W1). The server adapts them behind a capability
(W2) and serves session-gated routes (W3). The PWA renders docs, images and sandboxed mockups (W4-W6). W7
documents and releases it.

## Waves

Historical base ordering (§7.7): W1 -> W2 -> W3 -> W5 -> W6 -> W7, with W1 -> W4 -> W5 in parallel. **Current remaining ordering (2026-11-07): A take-up/Settings → B1/B2 W5b → C1/C2 W6 → D W8b and reader/lab residue; required appearance/parity/draft extensions planned after A converge with D before E W7 carry/docs/review → F release/install/device evidence; operator retirement is separate and Docs workers remain serial.** The completion spec/plan supersede old W7-before-W8 and next-brief instructions below; completed waves remain audit history.
Since 2026-10-15 (operator), W5 runs as part 1, then W5h and Share in parallel, then Export, then W5b (RD23). W5h runs as two runs, W5h-a and W5h-b, and Export waits for W5h-a and Share, not for W5h-b (coordinator, 2026-10-15).

| # | scope | PRs | state |
|---|---|---|---|
| 1 | ccd reads docs: `shared/docs.ts`, `docs-index`/`docs-tree`/`docs-show`/`docs-fetch` and the embedded helper, the doctor's `docs` check | #301 | **merged** 2026-10-06 (`f03d83304`). Executed in the coordinator's session (subagent-driven, 19 tasks, per-task reviews, a six-lens final review, one fix round), not as a run |
| 2 | grants and adapter: agent grants, `DOCS_CAP` and builders, runner budgets, `server/src/docs/{policy,ports,ccdsource}.ts`, the docs ring guard | #319 | **merged** 2026-10-09 (`5a6e5d3d7`). Run 315: review 317, then three fix rounds (two defects, then the one-reader scan), a merge of `main` after ccrc-history B1 landed, and closure review 343. Run 315 closed done |
| 3 | routes: `server/src/docs/{routes,hooks,lane,cache}.ts`, registration, dark rollout, R1/R2 | #339 | **merged** 2026-10-09 (`f4d75a741`). Run 342: review 361, one fix round, scoped re-review 364 clean. After the merge, the operator runs the dark rollout, fleet first, then R2 and R1 (§7.8). Both gate W5's merge |
| 4 | PWA foundation: markdown extraction, `RenderBoundary`, chat hardening (U3), `docs-sw` | #381 | **merged** 2026-10-13 (`baba5c1bc`). Run 367: review 408 (12 findings, one critical: the built worker chunk could not load in a browser worker), one fix round, scoped re-review 412 (8 minor, carried to W5). Nine deviations, 4768 to 4776; 4777 to 4783 unspent. Run 367 closed done after W5's run opened |
| 5 | Docs screen, plus Share and Export (see Decisions, 2026-10-06); plain, plus `<br>` as a line break in the docs profile (2026-10-12). Split into two runs (operator, 2026-10-13). Part 2 splits again, into Share and Export (operator, 2026-10-15) | #627 (part 1; superseded #402) | **part 1 (the Docs screen):** **merged** 2026-10-19 (`9b18fb0cd`) through #627, which landed run 413's work (#402, block 4917 to 4932) reconciled with `main` and through the merge gate (R2 and R1 pass, spec §7.8); #402 closed as superseded. Run 413 was ended on 2026-11-03: the console offered no way to abandon that one run, so the coordinator closed it as an abandon at the operator's request. It shipped with its current bounds and carries the crafted-input freeze (operator, 2026-10-15). **Part 2, Share:** planned after part 1's review, dispatched after part 1 merges, in parallel with W5h. Plan `docs/superpowers/plans/2026-11-02-native-docs-reader-w5-part2-share.md` (written and approved by the operator 2026-11-02). Dispatched 2026-11-02 as run 1350 (block 7767 to 7779; 7767 to 7774 defined, 7775 to 7779 unused). **Merged** 2026-11-03 (`5d48c8157`) through #2145, at head `1ff85fcb4`, after review runs 1356 and 1358 and one fix round; run 1350 closed done. **Part 2, Export:** dispatched after W5h-a and Share merge; it does not wait for W5h-b. Run 1368 opened 2026-11-03 (planned) to keep the programme active. Plan `docs/superpowers/plans/2026-11-03-native-docs-reader-w5-part2-export.md` (13 tasks; written and reviewed 2026-11-03, approved by the operator the same day with every recommendation). Merged in #2188 (`a3c319d44`); dispatched 2026-11-03 as run 1368 (block 7879 to 7894; 7879 to 7891 defined, 7892 to 7894 unused). **Merged** 2026-11-04 (`b55e96a75`) through #2237, at head `67636f01b`, after review runs 1401, 1405 and 1406 and two fix rounds; run 1368 closed done |
| 5h-a | highlighting off the main thread, the worker path: a separate highlight worker for chat, Docs pages, text leaves and Export; the store; the main-thread check of the worker's HTML; the measurement page; the new constants at provisional starting values. Part 1's bounds stay in force beside it (see Decisions, 2026-10-15) | — | after W5 part 1 merges, in parallel with Share and before Export. Its spec amendment goes first. Once it is deployed, the operator opens the measurement page once on the phone. Plan `docs/superpowers/plans/2026-11-02-native-docs-reader-w5h-a-highlight-worker.md` (written and approved by the operator 2026-11-02). Dispatched 2026-11-02 as run 1319 (block 7751 to 7766; 7751 to 7763 defined, 7764 to 7766 unused). **Merged** 2026-11-03 (`408d93806`) through #2161, at head `dcf2b9ecb`, after review runs 1364 and 1366 and one fix round; run 1319 closed done |
| 5h-b | the measured values, then, in a commit of its own, all of part 1's main-thread highlight bounds retire: the word, line and whitespace bounds, the per-grammar block caps for typescript/javascript and rust, and the scan and markdown page budgets, with their mutation rows re-pointed. The xml strip and the 64 KiB and 512 KiB caps stay | — | after the operator's phone measurement. Export and W7 do not wait for it; W8 does (amended 2026-10-15; W5h). R19 was measured on the operator's phone on 2026-11-03 and the retirement gate passes. Plan `docs/superpowers/plans/2026-11-03-native-docs-reader-w5h-b-measured-values.md` (5 tasks; written and reviewed 2026-11-03, approved by the operator on 2026-11-03 with every recommendation). Dispatched on 2026-11-04, after Export merged, as run 1412 (block 7927 to 7933; 7927 to 7929 defined, 7930 to 7933 unused). **Merged** 2026-11-04 (`1533c17a1`) through #2257, at head `9c5f78b4f`, after review runs 1432, 1433 and 1434 and two fix rounds; run 1412 closed done |
| 5b | parity: six sections/history service (B1), then version pages/history loader (B2) | #2350 (plan), #2860, #2886 | **merged** 2026-11-16 (B1 `3be6ede40`, B2 `de1cbc963`). Approved item 50: Q1 a, Q2 a, two runs; the plan merged 2026-11-09. B1 is run 2124, opened 2026-11-15 at `planned` with block 8642-8646 (D-8642 and D-8643 defined; Decisions, 2026-11-15), dispatched from `main` after #2806 merges; B2 opens after B1 merges. B1's wave-done was verified at `b4a08dcf8` (#2860) except its CodeQL line; review run 2153 confirmed 2 important findings, and fix round 1, with one merge of `main` after #2842, was dispatched 2026-11-15 (Decisions, 2026-11-15). Fix round 1 was verified at `f9c82dea8`; review run 2172 found nothing critical or important, and B1 was accepted and enqueued on 2026-11-15, with the review's four minors carried into B2's first item (Decisions, 2026-11-15). B1 merged on 2026-11-15 as `3be6ede40`, bound to `f9c82dea8`. B2 is run 2178, opened at `planned` with block 8648-8655. B2's wave-done at `c16276de2` (#2886) was verified on 2026-11-16; review run 2201 confirmed two important findings, and fix round 1 was sent the same day (Decisions, 2026-11-16). Review runs 2204 and 2208 read fix rounds 1 and 2; B2 was accepted at `c67064bed` and merged on 2026-11-16 as `de1cbc963` (Decisions, 2026-11-16). The first rollout containing B1 is server-first, even in a later bundled tag (Carried constraints) |
| 6 | mockups, asset reservations and static mockup Export | #2915 (C1), #2969 (C2) | **merged.** C1 2026-11-16 (`8d7189ce1`): completion Tasks 5-7, run 2209, D-8659 to D-8663, D-8671 and D-8695. C2 2026-11-17 (`62c1565d2`): Tasks 8-10, run 2342, three review rounds, D-8711 and D-8712, 8713 unspent (Decisions, 2026-11-17) |
| 7 | finite carry closure, docs, whole-programme review; release and deployed evidence | — | completion E Tasks 15–16 after D and required extensions, F Task 17; operator retirement Task 18 remains separately gated |
| 8 | the reader frame: the shared library `docserver` mounted in a sandboxed frame with a checked bridge, the plain pipeline as fallback (proposed, rich-docs spec 2026-10-12). It inherits W5h's highlight worker and rules on the colouring divergences W5h records (2026-10-15) | #2037 (W8a plan), #2061 (W8a), #2989 (D1), #3026 (D2) | proposed; after W5b, W6, W7, library v1 and W5h-b (amended 2026-10-15; W5h). Library v1 is met: `@synapsium-labs/docserver` 1.0.0 was released on 2026-10-31. Split by the operator on 2026-10-31: **W8a**, the frame core, now, beside W5h-a and Share (plan `docs/superpowers/plans/2026-10-31-native-docs-reader-w8a-reader-frame-core.md`, approved by the operator on 2026-11-01 and merged in #2037). **W8a accepted** on 2026-11-01 at `4d62121a7`: run 1315, PR #2061, review runs 1316, 1317 and 1318 with two fix rounds, block 7691 to 7707 all defined, landing through the merge queue. Its residue goes to W8b; **W8b**, the version menu and "changes since", after W5b; W7 last. **W8a is live:** the operator's phone check on 2026-11-03 opened a spec in the reader. Its follow-ups are in Decisions, 2026-11-03 (late): the first-load compression (approved by the operator on 2026-11-03; run 1400, block 7903 to 7905 all unused; **merged** 2026-11-04, `ffa9f0ab2`, through #2247), Mermaid drawn on open (ruled; needs a library change), a compact phone header (the operator picked option 1 now and option 2 with the library release; plan approved 2026-11-04, run 1436, block 7953 to 7959), and a reader lab page (the operator: build it, as a wave of its own) W8b (completion D, Tasks 11-14) runs as two serial runs (coordinator, 2026-11-17): D1 (Tasks 11-12 and C2's carried findings) is run 2380, **merged** 2026-11-18 (`8a6f62309`, #2989; three review rounds; reserve 8716-8718 unspent); D2 (Task 13, Task 14, lab 10 and D1's carried findings) is run 2436, **merged** 2026-11-18 (`839c05e46`, #3026; three review rounds; D-8729 and D-8730 defined, 8731-8732 unspent). D is closed (Decisions, 2026-11-18) |
| RL | the reader lab: a console page, Settings › Reader lab, that runs E17 and E18 on a phone (the walls, the busy frame, the Mermaid line), and the server door its frames report through. Two runs: RL-a, the door (server only, reviewed alone), then RL-b, the page, from `main` after RL-a merges | #2283 (RL-a), #2340 (RL-b) | **merged.** RL-a: run 1442, three review rounds, #2283 merged 2026-11-04 (`2593469be`). RL-b: run 1470, three review rounds and two fix rounds (D-8030 to D-8033), #2340 merged 2026-11-05 (`ce55b1ca9`). Approved by the operator on 2026-11-04; its own wave after W8a, independent of W5b and W8b (operator, 2026-11-03) |
| 17 | the library 1.1 take-up: ccrc pins `docserver` 1.1.0, gates Mermaid drawn after `ready` on E17, adopts the bar-off frame with progress and commands, and the phone header's option 2 | #2346 (plan), #2806 | run 1532, dispatched 2026-11-10; library 1.1.0 publication verified and Q1-Q3 approved with every recommendation on 2026-11-06 (item 48). Two phone blocks: 217 ms fails, 192 ms holds against 200 ms; combined `E17-READING does-not-hold`, `E17-BLOCKS 2`, so approved Q1 keeps drawing on tap. E18 holds within both blocks' coverage. Tasks 1-9 committed (worker-reported). Task 10 was held at Step 2 from 2026-11-11 and resumed on 2026-11-14 with CI standing in for the local server suite (Decisions, 2026-11-14). The wave-done was verified at `d56b10667`. Review runs 2104, 2116 and 2122 found 3, 2 and 1 important findings, each sent back as a fix round; on 2026-11-15 the review cap was extended from 3 to 6. Review run 2132 (round 4) found no product defect, the wave was accepted at `b7b60ed93`, and #2806 **merged** 2026-11-15 (`f6bdbf153`), its merge-queue run green with `browser (pwa)`. Run 1532 closed done (Decisions, 2026-11-15) |
| Required appearance | Same host-selected ccrc skin/theme and native visual language; shared renderer plus consumer adapter | — | Required before E/F final acceptance; scoped design/leaf plan and implementation after A, never silently added to A. **X1's design merged 2026-11-19 (#3048, `8781ef20a`; run 2631, D-8759 to D-8761), accepted at the review cap; its carries were folded in by X4, the library-input text wave (run 2680, wave 27), merged 2026-11-19 (#3055, `da21717b8`), which also set X2's library share. The library programme plans its one wave from X1 §10 and X2 §6 on `main`; ccrc's wave C after the release. Implementation waits for the operator's approval (Decisions, 2026-11-19)**. Approved 2026-11-19. This programme drives the library's waves: L1, the appearance contract, runs as run 2843 in the library's repository, and the library is renamed pinax-lib before the release (Decisions, 2026-11-20). L1 landed as library PR #86 (merge commit `aacae4c56`; run 2843, D-8816 and D-8824 to D-8827), accepted at the review cap, with a release-gate measurement carried (Decisions, 2026-11-20 (evening)) |
| Required parity/drafts | #1418 full parity and #1420 private draft-review lifecycle; outside folders, variants, large files, PDFs and configured tracker links | — | Required before E/F final acceptance and operator retirement; scoped extension plans and side-by-side evidence, not delivered by the existing A–D tasks. **X2's design (#1418 parity) merged 2026-11-19 (#3049, `6095bf43d`; run 2632, D-8762 to D-8764) and X3's (#1420 draft review) merged 2026-11-19 (#3050, `1bbb6730b`; run 2633, D-8765 to D-8767), each accepted at the review cap with binding carries (Binding carries from the extension designs, below). Implementation waits for the operator's approval; X3's R1 also waits for the operator's confirmation of asks 595 and 603 (Decisions, 2026-11-19)**. Approved and confirmed 2026-11-19. X2's P1 landed in #3102 (`2d544ec50`; run 2743, D-8783 and D-8784), and X5, HTML pages as artifacts, in #3093 (`dd14bc1f2`; run 2837), each accepted at the review cap. X3's R1 is run 2949, wedged since 2026-11-20 20:10Z (Decisions, 2026-11-21 (morning)). X2's library side: the rename landed as library PR #87 (`bee0fd1ec`; run 2987), L2's landing A landed as library PR #88 (`1c2120d93`; run 3007, D-8868) and landing B1 as library PR #89 (`f46f49877`; run 3179), each accepted at the review cap; landing B2 is run 3249 (Decisions, 2026-11-22 (early)). X6, reader mode, landed in #3121 (`c58f67743`; run 2847, D-8803 to D-8805 and D-8831), accepted at the review cap (Decisions, 2026-11-20 (evening)) |

## Decisions & deviations
- **2026-11-22 (early): L2's landings A and B1 landed, each accepted at the review cap. B2 is building. The programme's plan is declared (coordinator rulings).**
  - **L2 landing A (run 3007): landed as library PR #88 (merge commit `1c2120d93`) on 2026-11-21.**
    - Round 3 (review run 3160) was the last. It was ruled at the cap: the reviewer's exact fixes, applied verbatim and then checked mechanically, with no fourth round.
    - The main-line run on the merge commit was green.
    - D-8867 and D-8869 are unused.
  - **Landing B is split in two, as ruled during wave 35.**
    - B1 is Task 0, Task 9's layout infrastructure, `classic`, `editorial`, and B1's part of Task 14.
    - B2 is `review`, `guided`, and B2's part of Task 14.
  - **L2 landing B1 (run 3179, wave 35, block 8878 to 8880): landed as library PR #89 (merge commit `f46f49877`) on 2026-11-22.**
    - **Task 0.** The build's free-globals comparison compares the names read and written, never alias spellings. Each case it must refuse keeps a red row, and one row reds when it is made alias-sensitive again. This closes landing A's first follow-up.
    - **Two CI fixes, test-only, loosening nothing:**
      - the WebKit cue test sampled during the layouts' 0.55 s reveal, so it now waits for the reveal to settle, and the painted cue is unchanged;
      - B8.2's root cause was the initial-hash pin re-applying after the reset, so the test now waits for `scrollY === 0` before its checks.
    - **Round 1 (review run 3218) found two important findings:**
      - the Close control kept the control row under a coarse pointer. X1 §10 applies it under `(pointer: fine)` only, so both layouts now guard it, with a row each;
      - the plan's record was owed, as Task 14 says.

      Seven minors were applied, among them a corpus directory required for every shipped layout and the ratchet's hostile check extended to per-layout snapshots.
    - **Round 2 (review run 3227):**
      - the PR description's counts were brought to the final tip;
      - Task 0's superseded record was corrected;
      - three checks that could not fail were deleted. A guard that cannot fire may not stand: each deletion records "green with it removed".
    - **The `Ledger-Edit:` trailer on two B1 commits carries a placeholder token, not an issued number.** It names no deviation. The closeout is a record, not a departure, so no number is owed, and no library check reads the token. History is not rewritten. A later `Ledger-Edit:` cites an issued "ccrc D-n" from the wave's block, or is left out. The block's numbers, 8878 to 8880, are unused.
    - **Considered, no change:** Classic's phone chips have no coarse 44 px floor. X1 §9's tap floor is measured on the host's head and frame rows, and the default reader holds no universal floor for in-document controls. It is carried to the release-readiness wave.
    - **Round 3 (review run 3233) was the last.** A redundant newest-entry loop was deleted, and five wording fixes were made. Each fix was applied verbatim, and the four files were checked byte for byte against the expected files, with no fourth round.
    - **Landing.** `--merge --match-head-commit`, with the PR's title as subject and its description as the merge body, which carries one `Size-Design: x2` line. The x2 row is 4 885 103 total and 4 571 331 in the frame, and the bootstrap budget was never raised.
    - **CI flakes at an unchanged head, each green on rerun:**
      - RF3's timing ratio, once on Node 24;
      - two browser races on Node 22: the editorial corpus case on WebKit caught the scroll-spy's first activation, and the rail test measured before the float settled.

      The two races are B2's first item: deterministic waits, with no timing gate and no snapshot moved.
  - **L2 landing B2: wave 36, run 3249, ticket `lib-l2b2`, block 8881 to 8883, dispatched on B1's merge.**
    - **D-8881 is defined in X2's plan.** The `guided` layout keeps its layers in the existing per-doc `folds` field, not in a field named per layout. The bootstrap stands at 32 740 of its 32 768 bytes and is never raised, and LX6 is still to land. Each layout ignores an entry it cannot read, with a mutation row each way. X2's spec §6 State line is amended in place.
  - **The programme's plan is declared on the server** (`plan put`, from the Work card's request of 2026-11-21).
    - Seven epics, 33 tickets and four phases:
      - the epics are the shared library (with the checkpoint "the contract release is published and signed by the operator"), X1 appearance, X2 parity, X3 drafts, X5 HTML artifacts, X6 reader mode, and close-out;
      - the phases are designs, before the library release, on the library release, and close-out.
    - Eleven finished tickets are backfilled from the runs that did them: the six design runs (2631, 2680, 2632, 2633, 2837, 2847), P1 (2743), L1 (2843), LR (2987), L2 A (3007) and B1 (3179).
    - R1's ticket closes from run 2949 when that run is done.
    - Retirement of the old server stays the operator's separate cutover, outside the plan.
  - **Library follow-ups for the release-readiness wave:**
    - a race the host causes still counts as a frame refusal;
    - the corpus's print-run state;
    - the byline's Range, Selection and observer;
    - `changesBase` on the wire;
    - the Safari byline cost;
    - Classic's phone chips;
    - RF3's timing ratio;
    - the release-gate measurements (L1's old-cap browser mount, and WebKit by a workflow input).
  - **Process:**
    - a third subagent hook refusal was reported during landing A;
    - a worker's run-bound timer was refused as too long, so the coordinator waits on CI with a bounded watcher instead;
    - each reviewer ran tests against the worker's install, read-only and only on an equal lock hash, removed before reporting (asks 699 and 701).
  - **The coordinator's calls (clause 21), recorded on the server:**
    - checks that cannot fire are deleted, not repaired (calls 182 and 188).
  - **R1 (run 2949) is still wedged,** waiting on the operator to wake its pane.
- **2026-11-21 (morning): the library rename landed. L2's landing A is in review, with rounds 1 and 2 ruled. R1's worker is wedged.**
  - **LR, the library renamed pinax-lib (run 2987): landed as library PR #87 (merge commit `bee0fd1ec`).**
    - It took two review rounds (runs 2992 and 3001).
    - It landed with `--merge`, the PR's title as subject and its description as the merge body, which carries `Size-Design: none`.
    - #85 is closed as superseded. D-8863 and D-8864 are unused.
    - **The owed release steps, firm and in order:**
      1. rename the repository;
      2. hand-publish a `0.0.0-reserve` of `@synapsium-labs/pinax-lib`, unless npm then allows attaching the trusted publisher without one;
      3. attach the trusted publisher;
      4. push the signed tag.

      A tag pushed before step 3 fails at publish, after its attestation is made.
    - **Release-gate notes, measured before the library's release:**
      - RF3's timing ratio failed once in 87 runs on Node 24;
      - WebKit's B8.2 scroll case failed once;
      - L1's gated old-cap browser mount (carried).

      Both failures passed on rerun.
  - **L2, the library's parity additions (run 3007, wave 34, block 8867 to 8869): landing A is in review as library PR #88.**
    - **The split.**
      - Landing A is tasks 1 to 8:
        - the ops: `place`, `push` and `from` on `hash`, `close-overlay`, `goto`;
        - item values and links;
        - In short;
        - the comparison base;
        - print figures;
        - print mode.
      - Landing B is tasks 9 to 14, the four layouts with `frameCsp(layout)`. It is wave 35, once A lands.
      - The leaf plan rides A.
    - **The bootstrap stays within its 32 768 bytes, never raised; it stands at 32 740.**
      - The seed checks became a table.
      - The deep check of the host's vocabulary list moved host-side, into `frameDocument`. The reader still refuses a forged seed.
      - The print-figure adapter keeps its range, type and size checks and drops only its integer test, which the reader and the host parser keep. A thin pass-through could not pass the build's free-globals comparison, which reads the minified name an alias gets.
    - **D-8868 is defined in X2's plan.** Print follows the screen's outline gate. The plan-facts fixture is 6, 7 and 8 steps, and P5.5's pin reads "3 tasks · 21 steps". X2's spec §6 is amended in place.
    - **Print figures at a reprint.**
      - A run ends only at the next `printFigures()` call, or at unmount. A run token was declined, as a change beyond §6's ops.
      - Round 1 found that figures still in flight could close the frame. The host now absorbs them: in a reopened run, the first repeat of an index replaces the earlier copy and is not counted.
      - Round 2 found that this let a frame hand the host about 80 MiB. A cumulative cap of 2 x 16 MiB per run on bytes handed was added, refused before decode.
      - Two limits are stated: the oversize edge, which has two triggers, and three runs in flight.
    - **Also fixed in review:**
      - a quadratic byline split in render, print and the screen: one linear helper, and the screen's split is built in one pass;
      - the frame's item-link grammar, now held equal to the host's (hidden characters and `%5c`);
      - the ratchet's moved-trailers, which now read `none` as naming no case.
    - **Round 3 is the last.** D-8867 and D-8869 are unspent so far.
    - **Library follow-ups for its next wave:**
      - the free-globals comparison is sensitive to alias names;
      - a race the host causes still counts as a frame refusal;
      - `changesBase` recording is ambiguous on the wire.
    - **Process:**
      - two subagent hook refusals were reported;
      - one subagent's false claim of an edit was caught by review;
      - an implementer's claims are now checked against the diff.
  - **R1, X3's server read side (run 2949), is wedged.**
    - The worker's turn ended on an API error at 2026-11-20 20:10Z, partway through merging `main`, with two conflicted files.
    - Its mail has stayed parked since then, because the delivery lane cannot clear its input box.
    - A live worker is never re-dispatched (coordinator skill clause 16), and waking its pane is the operator's.
    - Every remaining ccrc-side wave waits on R1 by shared files: X2 from P2, X3 from R2, and X5 from A1.
  - **The coordinator's calls (clause 21), recorded on the server:**
    - library landings keep the explicit merge body, so the repository's merge-message setting needs no change;
    - a local run killed by the test slice's memory cap is recorded as unmeasured, and exact-tip CI arbitrates;
    - the fleet cap is raised only if it blocks the critical path.
- **2026-11-20 (evening): X6 and L1 landed, each accepted at the review cap. R1 is building (coordinator rulings).**
  - **X6, reader mode (run 2847): landed in #3121 (`c58f67743`).** It took three review rounds (runs 2933, 2947 and 2953), and round 3 was the cap.
    - **Round 3** found 8 important findings and 8 advisories, all in the spec's and plan's text. The panel judged every one able to carry to XR1 or XR2. They were applied verbatim now instead, and checked mechanically, because XR1 and XR2 are a release away and their workers read the plan as it stands on `main`.
    - **The coordinator's rulings at the cap:**
      - F3 supersedes A-b and A-h. From XR2 the top strip holds only the title, and a tap anywhere on it hides the overlay. Exit, the turn setting and Aa sit in the bottom strip, with Exit at its left end. This carries round 2's ruling into XR2: a second tap where the first one showed the overlay always hides it and never leaves reader mode.
      - XR2.1's hide test, and mutation row X6.58, were renamed to match.
    - New mutation rows X6.72 to X6.75. D-8803 to D-8805 and D-8831 are defined in X6's plan.
    - The device rows FS-1 to FS-10 are the coordinator's device item, raised once XR1 and XR2 exist.
  - **L1, the library's appearance contract (run 2843): landed as library PR #86 (merge commit `aacae4c56`).** It took three review rounds (runs 2906, 2945 and 2965), and round 3 was the cap.
    - **The landing method, as ruled.** It landed with `--merge`, with the PR's title as the subject and its description as the merge body, so test 8's main-line run reads the `Size-Design: x1` line.
    - **Round 3 was accepted on condition:** every fix was applied as the report wrote it, and checked mechanically. The fixes were:
      - F1: a `<<name>>` in a class or state diagram is spared only where an annotation stands;
      - F2: Mermaid's tooltip rule skips a document-element root without colours;
      - F3 to F5 and F10: text;
      - F6 and F11: rows;
      - F7: the library's task note.
    - **The size row:** x1 is now 4 558 002 characters, +29 982 over 1.1.0, within its 32 768.
    - **A CI race.** Test 4 (a) raced on WebKit (198 elements against 196). Each page now waits by itself, bounded and named, for the reader's own marks, and the two pages are never compared to decide when to read (ask 676, answered by the coordinator, option 0).
    - **D-8824 to D-8827 are defined in X1's plan,** and §10 is amended in place.
    - **A release-gate item, before the library's release:** the gated browser mount of an old-cap document, measured once on Chromium with headroom and on WebKit through a workflow input.
    - **Recorded, not blocking.** In round 3 the review tool's records disagreed on the lens model: the meta files name Sonnet and the transcripts name Opus. The reviewer re-measured the findings that carried.
  - **R1, X3's server read side (run 2949): building.** R1.1 to R1.3 are committed on the worker's branch and R1.4 is in progress; nothing is pushed yet. The coordinator's rulings:
    - **Breaches.**
      - An implementer broke the working rules twice: a background test run piped through `tail`, and two Monitors. That ended its task. The worker finished R1.1 itself and re-ran every check in the foreground.
      - Where an implementer wrote code before its tests (R1.3's store, two checks in R1.4's sweep), the work is accepted only with each guard re-measured as a mutation row.
    - **The store's admission count** includes every retained byte on disk, superseded and unreferenced copies awaiting unlink among them.
    - **R1.4's files** gain `server/src/docs/routes.ts`, for the one-word export of `readTree`, so the sweep reads through the docs lane and cache.
    - **A standing leave for this wave.** A test that times out under the shared test slice's memory kills, with no assertion mismatch, gets one isolated rerun. If it still times out, it is unmeasured locally, and CI on the exact tip arbitrates, with its duration beside `main`'s daily run.
    - **Two hook refusals,** reported before any retry: the graph gate (one graph query, then reads) and the account guard (no shell command names the home store directory).
  - **For the operator:**
    - the fleet cap of 24;
    - X5's difference 7 (version pages);
    - the library repository's merge-message setting;
    - the shared test slice's 6 GB memory cap, which killed test workers in every building wave today.
- **2026-11-20 (day): X5 and P1 landed, each accepted at the review cap. R1 opened as run 2949. X6 and L1 are in review. The operator answered ask 656 (coordinator rulings; operator answer).**
  - **X5, HTML pages as artifacts (run 2837): landed in #3093 (`dd14bc1f2`).** It took three review rounds (runs 2850, 2860 and 2881), and round 3 was the cap. It was accepted on condition that the reviewer's exact replacement texts were applied verbatim and checked mechanically.
    - **Round 2's rulings:**
      - a revoke, an expiry or a sign-out ends work already in flight, with a per-frame stall deadline and a whole-response deadline;
      - version pages stay outside the tier;
      - the page above 2 MiB gets the offer, because full parity is the bar;
      - a failed artifact listen turns the tier off, and never takes the console down.
    - **Round 3's two blockers:**
      - Caddy logs every request header on the abort entry, so the global log filter now deletes the whole `request>headers` object;
      - the claim that "the standalone reader serves no versions" was false (X2 I7).
    - **The parity record now holds ten differences.** Difference 7 is an HTML page at an earlier version, which runs within the walls only. It is **Later, to be closed or accepted by the operator before retirement.**
    - **Carried:** m3, re-anchoring onto P1's merged code, goes to A2.3, A3.3 and A5.1, quoted in X5's plan Results.
  - **P1, range reads and large files (run 2743): landed in #3102 (`2d544ec50`).** It took three review rounds (runs 2884, 2915 and 2932), then one text-only round applied verbatim and checked mechanically.
    - **The fix rounds added:**
      - text above 2 MiB as source in parts;
      - version pages over the cap read by range, through an additive `blob=<oid>` on ccd's committed too-large answer, with no new verb or argv;
      - the `DocPin` / `DocListPin` split;
      - an image past its cap opening its own page;
      - three ccd guards with their own tests.
    - **Its two departures:**
      - D-8783: `ccd/ccd`'s growth, +598 under a waiver of 600;
      - D-8784: the type-only retypes of `DocsHead.tsx`, `share.ts` and `mockup/ports.ts`.
    - **The Markdown cutter, F9, under ruling option (a).** The line scanner stays. Differential fuzz, with seed 20261120, 8000 documents per mix and an mdast oracle:
      - 0 violations on plain fences;
      - 0 on well-formed list and quote fences, where round 1's cutter had 2094;
      - worse than round 1 on 1109 of 8000 full-mix documents.
    - Nine residual classes are recorded with their inputs.
    - **Carried, each now a named step in X2's plan:**
      - P6.1 Step 0b2: the parser-backed cutter, with classes 1 to 9 as red cases and zero violations on the full mix as its bar;
      - P6.1: GATE-L1's desktop Chromium leg;
      - P3.2 Step 6: the late Download answer's guard, keyed by the tap;
      - P2.1 Step 0: the doctor's `docs-range-v1` line.
    - The render gate's phone leg is the coordinator's device item.
  - **Placed by the coordinator.** On git 2.53, `ccd-docs-fetch`'s four ref-locked cases fail. git's wording for a held ref lock changed, while ccd's lock marks were measured on 2.43. The defect predates P1, and CI's older git passes. It is a binding carry to P2 (below).
  - **R1, X3's server read side, is run 2949 (wave 32), with block 8835 to 8837.** It was opened on P1's landing, and is briefed below. Its first item is X3's binding carries, and `server/src/deps.ts` joins its Files. Its dispatch waits for a fleet slot.
  - **X6, reader mode (run 2847), in review.**
    - **The operator's answer to ask 656, relayed by the designer:** screen pages, turning one screen per tap, swipe or arrow and landing on a whole line, with one scroll underneath and continuous scroll kept as a reader setting.
    - **Round 1's order ruling (F7, option a).** XR1 sits on the library's contract release, not on 1.1.0. The chain:
      1. the library lands L1, the rename and L2, then releases;
      2. X1's wave C re-pins, and X2's P5 builds on it;
      3. XR1 delivers full-screen reader mode in continuous scroll;
      4. LX6 joins that release if it is ready, and is never held for;
      5. XR2 brings screen pages on the release that carries LX6.
    - **Round 2's rulings:**
      - a tap outside the overlay hides it, and the menu control toggles it, with no timeout;
      - reader mode always reads in the default layout and restores the reader's own on exit, with the button limited to the default layout if a phone remount breaks a budget.
    - Number 8831 was issued for the amendment of rich-docs §5.2's phishing row.
    - Round 3 is the last.
  - **L1, the library's appearance contract (run 2843, `Synapsium-Labs/docserver` #86), in review.**
    - **Round 1's rulings:**
      - `assets` is read live, as in 1.1.0;
      - the author-styled scan is widened;
      - test 4 is widened in full, so 8827 is unused;
      - `--dr-tip-*` is written through the journal.
    - Numbers 8824, 8825 and 8826 were issued for three §10 amendments: test 7's old-cap row, the stick-arrowhead selector, and the scan. They are defined in X1's plan when L1 is accepted.
    - **The landing method.** The library's merge commit message is the PR title only, so L1 lands with an explicit merge body carrying its description. The review measured that test 8's main-line run passes that way.
    - **A release-gate item.** The gated browser mount of an old-cap document was killed by the shared test slice's memory cap. It is measured once, on Chromium with headroom and on WebKit through a workflow input, before the library's release.
    - **For the operator, later:** the library repository's merge-message setting.
  - **Fleet cap.** Dispatches were refused at 24 of 24 again: L1, two X5 reviews, P1's final review and R1. Bounded background retries dispatch them. Whether to raise the cap is with the operator.
  - **The fleet's work disk is at 85%.** Every brief keeps its no-copy, no-install rule.
- **2026-11-20 (early): the library is named pinax-lib, and this programme drives its waves. L1 (run 2843) and X6, reader mode (run 2847), dispatched. X5's two review rounds ruled. L1's first departure, D-8816 (operator rulings; coordinator in-plan rulings).**
  - **The operator's rulings, in chat, 2026-11-19 late:**
    - **The library's name is pinax-lib.** The package is `@synapsium-labs/pinax-lib` ("let's go pinax-lib"). There is no separate tool: ccrc's Docs reader is built in, other consumers embed the library, and the standalone reader retires.
      - The rename is its own landing in the library's repository, after L1 and before the release. It changes no frame asset and keeps the wire names, as #85 did, and it supersedes #85 (which says `@synapsium-labs/pinax`).
      - At release the operator renames the GitHub repository (old URLs redirect), sets up the npm name and its trusted publisher, and pushes the signed tag.
      - ccrc takes the new name at wave C's re-pin.
    - **This programme drives the library's waves** ("yes drive from here"). A library wave is a run of this programme with project `docserver` and home project `ccrc-pwa`. Its departures are asked here and defined in ccrc's plans, never in the library's repository. The release and its signed tag stay the operator's.
    - **New intent, reader mode:** "when reading a document via docserver I need a button to enter "reader mode" where the document becomes full-screen (think Kindle-like experience when used)". Design wave X6 designs it, in ccrc's native reader; the standalone reader gets nothing.
  - **L1, run 2843 (wave 30), dispatched 2026-11-20 00:09Z.**
    - Its scope is X1's §10 contract only, as the genesis landing of test 8's tables:
      - the shares are `x1` 32 768 characters, and `x2` 1 166 336 in total and 72 704 for the largest frame;
      - one `Size-Design: x1` line;
      - no version bump.
    - X2's additions are L2's, after it. It was briefed before the naming ruling, so it leaves #85 alone, and the rename landing follows it.
  - **D-8816, L1's ask 660 (the gitGraph cherry-pick disc).** Mermaid 12.1.0 draws the cherry-pick commit as a disc that carries no series class, so §10's "painted `bg` … on its commit's series colour" cannot be built.
    - Ruled option 0: the disc is `text-muted` and its mark is `bg`, which is the gate's `text-muted`-on-`bg` pair.
    - The rule for the disc never reaches the mark, and test 5 reads both.
    - Defined in X1's plan; §10 and test 5 are amended in place.
  - **X6, run 2847 (wave 31, reserve 8803 to 8805), dispatched 2026-11-20 ~00:45Z.** It is a docs-only design, briefed below.
    - **Ask 656, pages or scroll, is released to the operator** as a product tradeoff. The options are:
      - screen pages (recommended; about 6 to 10 K characters of library code);
      - calm scroll;
      - true book pages (about 25 to 45 K characters, the highest risk).

      The designer continues with screen pages as the default and prices all three. The host side is the same for each.
  - **X5, run 2837: two review rounds, each sent back as a fix round.**
    - **Round 1 (run 2850):** 13 important findings. The isolation argument held. Ruled:
      - Caddy's logs: a stock global log filter that deletes the request path and Referer is designed into A4 now, with a test, and confirmed on a real Caddy before F. If stock Caddy cannot do it, the worker stops and asks.
      - "Open as artifact" is offered on every HTML page, with no refusal detector. The walls tier stays the default.
      - A1 waits for P1, R1 lands before A1, and A1 reuses R1's token grammar.
      - The rest as the report directed.
    - **Round 2 (run 2860):** run with the panel as written, three refuters per important finding and the majority deciding. 10 important findings were confirmed, and 23 of round 1's 26 ids are closed. Ruled:
      - A revoke, an expiry or a sign-out ends work already admitted, with stall and whole-response deadlines.
      - Version pages are outside the tier in this design (Later: a tree read at the pinned commit). A current page whose branch moved gets a one-action reload.
      - The page above 2 MiB gets the offer too, because full parity is the bar.
      - A failed artifact listen turns the tier off and never takes the console down.
    - **Round 3 is the last.**
  - **P1, run 2743 (working):**
    - the worker's paused usage limit and a stall-watch restart, both recovered;
    - a narrow hook leave (file text through the Edit and Write tools, one test command per call, no type-check tool names in titles);
    - the first number of its block ruled for the ccd growth waiver (the range verb and the draft's mtime);
    - a check that the test slice kills is retried once alone, else recorded unmeasured, with CI as the arbiter;
    - co-edits with four other programmes' holders stay additive.
  - **Fleet cap.** At 24 active runs, dispatches were refused for about 90 minutes. Bounded background retries dispatched L1, X6 and review 2860. Rule: when one of this programme's runs frees a slot, its queued waves dispatch first. Whether to raise the cap is with the operator.
  - **Retirement note (operator's cutover, Task 18).** The old standalone reader's `/docs` forward on the operator's proxy still points at the fleet's previous host. Removing that mapping is a step of the cutover. Until then no session starts, repoints or retires it.
- **2026-11-19 (evening): the operator approved the three extension designs and answered the open choices. P1 dispatched as run 2743. X5, artifact-level HTML pages on an isolated origin, opened as run 2837 (operator rulings; coordinator run-open).**
  - **The operator's rulings, in chat:**
    - The appearance (X1), parity (X2) and draft-review (X3) designs are approved, as amended by X4. Implementation may dispatch.
    - Asks 595 and 603 are confirmed: draft review is a capability link, and comments come from signed-in people only. X3's R1 is no longer waiting on them.
    - Ask 596: a fresh start. No reading state is imported from the standalone reader. The operator agreed with the recommendation, and the coordinator confirmed it.
    - Ask 598 / X2's C3, against the recommendation to keep the walls: HTML pages must be supported "at Claude artifacts levels", hosted in a sandbox or behind other safety measures. A new design wave, X5, designs it. X2's in-walls loader (§4.8, P6) stands until X5 decides the tiers.
  - **Still open with the operator:**
    - The library's new name. The operator asked about "pinax-lib". The coordinator recommends `@synapsium-labs/pinax`, with the repository `pinax`, and keeps a suffix for any later app.
    - Who drives the library wave. The library's own programme has no open run and no coordinator in the fleet's run list.
  - **P1 (run 2743, wave 28, block 8783 to 8785)** builds X2's range reads and large files. Its first item is the render-gate carry and D2's two minors (Binding carries). The brief names four files that other programmes' workers hold, and orders the tasks so that free files go first.
  - **X3's R1 waits for P1.** The two waves share five files: `shared/docs.ts`, `server/src/server.ts`, the auth-gate and box-token-census tests, and the rings data. Clause 10 rules out dispatching two workers onto overlapping claims.
  - **X5 (run 2837, wave 29, reserve 8786 to 8788)** is a docs-only design with security weight. It covers:
    - hosting on a second registrable domain with no session;
    - access by a capability link minted under session;
    - page isolation and network egress;
    - bytes served from git through the bounded reads;
    - the tiers against X2's walls;
    - a threat model;
    - the mapping onto Task 17's parity rows.

    An amendment to X2's §4.8 or C3 is a departure, defined from its reserve and naming this ruling.
  - **Routing:**
    - P1: an Opus · high main loop, Sonnet · high implementers for the ccd verb, the route and the census (Sonnet · medium elsewhere), and one Opus · high review of each task's diff.
    - X5: as the earlier design waves. An Opus · high main loop, at xhigh for the hosting, access and egress decisions, Sonnet · medium fact checks, and one Opus · high adversarial pass.
    - Workflow off for both.
- **2026-11-19: X4, the library input, accepted at the review cap and landed (#3055, `da21717b8`). X2's library share set. P1 opened as run 2743 at `planned` (coordinator; in-plan rulings).**
  - X4 ran as run 2680 (wave 27). It edited X1's and X2's specs and plans in place, so that the library programme plans its one wave from corrected text. Its reserve of two numbers is unspent.
  - Review run 2694 (round 1, at `ed2d43cd3`) found six important items. Ruling on test 8's two uncovered cases:
    - the genesis landing is exempt from the byte-equal check, and its baseline row equals the parent's every-entry manifest total;
    - each landing on the library's main line carries one design's frame-asset changes and appends one row;
    - CI fetches depth 2;
    - X2's share is a ceiling: if X2's real code exceeds it, the library wave stops and asks.

    The fixes:
    - the sequence stick arrowheads painted `text-muted`;
    - `dropShadow` set to `none`;
    - the in-commit mark's worst figure corrected to 4.57;
    - a stylesheet term in X2's estimate;
    - `appearanceStamp` in its own L1 module.
  - Review run 2714 (round 2, at `783cef4e7`). Rulings:
    - a landing may be a squash or a merge, provided its message carries exactly one `Size-Design:` line; repository settings are the library programme's;
    - shares live in a separate append-only table, which only an asset-free `shares` landing writes, and test 8 reads a design's share from the first parent, so no landing can raise its own ceiling;
    - one design per landing is a review check, while test 8 enforces one line, line-to-row agreement and growth within the share;
    - corrections and reverts are forward rows.

    Fixed in the design:
    - the definition cues' focus ring at 3:1;
    - Mermaid's body-level tooltip;
    - opaque gitGraph commit-label grounds;
    - a literal genesis value for `FRAME_ACCEPTS`, with `hello` out.
  - Review run 2732 (round 3, the cap, at `40b31c959`). Two items blocked as written, and the reviewer wrote each fix as an exact sentence. The coordinator accepted at the cap on condition that those sentences land verbatim before the PR. They did, verified sentence by sentence against the report at `9821c0ba1`, so no fourth round was needed. The rulings:
    - **The halo.** Hosting made a sequence lifeline through a label about three times worse (11.17 to 3.01-4.06), so a 3 px halo in the ground colour sits behind sequence labels (6.51 or better). Crowded small pie labels look the same as in 1.1.0's own drawing and stay named outside the floor.
    - **Resolved literals.** The definition cues keep their inline `!important` with resolved colours, never a `var()`, so the full-screen copy and an author's `classDef` cannot defeat the focus ring. This amends round 2's "drop the `!important`".
    - **The other edge cases,** each by the reviewer's exact sentence:
      - a lowered share never wedges the main line;
      - a correction landing cannot change assets unchecked;
      - test 9 drives every op in `OP_KEYS`.
  - **X2's share, set by the coordinator:** 1 166 336 characters in total and 72 704 for the largest frame. X1's is 32 768. The genesis landing records both.
  - Asks in X4:
    - Ask 608, option 0: a row's measuring commit is read from history.
    - Ask 614, option 0: test 5's drawn-pairs clause aligned with the halo.
    - Ask 615, option 0: X1 §9 records X2's share as set.
    - One read-only grep was stopped by a guard; the worker ran one graph query first, by the coordinator's standing answer for the wave.
    - One plan-text edit stopped by the test-slice guard was made with the editor, by the coordinator's one-time leave, since it ran nothing.
  - The review judge's `editorial-diff-over-bound` was accepted as the price of the one PR the brief required.
  - **Next:**
    - The library programme plans its one wave from X1 §10 and X2 §6 on `main`, with X1's contract as the genesis landing and X2's landing separate. The release and its signed tag are the operator's.
    - In ccrc, P1 (X2's range reads and large files) is opened as run 2743 at `planned`. It is not dispatched until the operator approves the three designs. Its first item is the render-gate carry, together with D2's two minors (ask 600), since it is the first wave cut from a base that has #3026.
    - X3's R1 also waits for the operator's confirmation of asks 595 and 603.
- **2026-11-19: the three required-extension designs accepted at the review cap and landed. X1 appearance (#3048, `8781ef20a`), X2 #1418 parity (#3049, `6095bf43d`) and X3 #1420 draft review (#3050, `1bbb6730b`) are on `main`. X4, the library-input text wave, opened as run 2680 (coordinator; in-plan rulings).**
  - Each design wave ran three review rounds, the held-out panel each time (three Opus · high lenses, Sonnet · high refuters). Each was accepted at the cap with binding carries, recorded below under "Binding carries from the extension designs". Implementation of all three waits for the operator's approval of the designs.
  - **X1 (run 2631, wave 24)** defines D-8759 (the bridge's appearance op), D-8760 (the hosted theme is ccrc's) and D-8761 (the frame handle's `setAppearance`).
    - Its reviews were runs 2645, 2657 and 2676.
    - Rulings, round 1:
      - Popover elevation and the section-label type are carried as skin slots, unless a value moves the reading layout or a budget; each token is carried or rejected by name.
      - The hosted label is validated text, refused by Unicode category, with a 64-unit cap; ccrc sends "Appearance follows ccrc Settings".
    - Rulings, round 2:
      - `chg` and `term` take each palette's own colours (the operator asked for ccrc's colours), on the condition that their meaning never rides on colour alone.
      - The library budget is attributed by contract, in commit order: X1's contract first, at 32 768 characters.
      - The worker's masked-hash reading of test 9 is accepted.
    - Round 3 reproduced 0 of 2 184 contrast rows below the floor, found no grammar leak, and found the CSP reading sound. Its one blocking item was a §10 claim that the reader's Mermaid colouring covered every kind. The coordinator ruled option (a) and ordered the correction to land in a reviewed text wave (X4) before the library programme plans its wave.
    - PR #3048's stale body was patched to the spec's slot counts.
  - **X2 (run 2632, wave 25)** defines D-8762 (layout variants live in the library, reconciling the operator's #1418 ruling), D-8763 (history places on the port) and D-8764. It also amends the rich-docs spec's §6 parity table.
    - Its reviews were runs 2647, 2659 and 2670.
    - Rulings:
      - The parity table stays in the PR (completion Task 16 step 1), and the review judge's `pr1-files-invalid` is accepted as its price. Every library layout uses X1's appearance slots and passes the pairs gate while hosted, as one library wave with X1's contract first. One census model, under `DOCS_DOORS`.
      - Print of a non-Markdown leaf is a parity row. Image and text leaves print from the console's print view through the same allow-list. A PDF or HTML page prints from its download, as a recorded difference (no `allow-modals`), not a waiver.
      - PL3: a file read in parts may print only its visible part only if no such file exists today. One Markdown file above 2 MiB does (about 3.4 MB), so every part prints, each parsed under its budget.
      - Round 3 then ruled that a Markdown document above the 512 KiB render gate is read in parts no larger than the gate, each mounting rich and printing through the same render job (the first item of P1).
  - **X3 (run 2633, wave 26)** defines D-8765 (base Goals 1 and 3, the decision `product`, the Non-goal "Share links that ccrc hosts", §4.13's expiring-links bullet and the README bullet), D-8766 (the Export-confinement sentences and M4.EX16) and D-8767 (M5.16's and rich-docs A2b's parser, frame and srcdoc clauses, and the reader lab design's Before row). Each quotes its sentences exactly and names #1420 (2026-10-25) and asks 595 and 603.
    - Its reviews were runs 2669, 2685 and 2700.
    - Rulings, round 1:
      - The read door is its own plugin, with its own body limit and error handler (one identical 404 for every refused state, plus 413 and 429), and a marker header checked before any token lookup.
      - Expiry is terminal: Pin refuses an expired share, and a re-share after expiry mints a new token, so an old link is never revived.
      - Each amendment lands with the wave that ships its behaviour, and no release hands out a review link before its page exists. The worker ordered R1 (the server read side), R2 (the page), R3 (the owner doors and UI) and R4 (signed-in comments).
      - The draft-review link is a distinct action in Page details, not an arm of Share. Share keeps sending only the committed permalink, so the operator's 2026-10-07 `share-drafts` ruling, M4.SH1 and M4.SH3 stay true.
      - Base §4.13's and §4.16's no-route, no-state sentences are about Share and Export and stay true: not departures.
    - Rulings, round 2:
      - **The device gate:** R2 ships a fixed measurement page in lab mode, opened from one reader-lab anchor and seeded from a committed fixture. Its WebKit phone leg and its desktop Firefox leg are one operator device item, raised when R2 is installed. R3 dispatches only after both legs are recorded. An engine that cannot be measured is the operator's decision.
      - **Revoke under disk failure:** a revoke is dead in memory before any disk act, either unlink keeps it dead at boot, and when every act fails the answer is 503 `not-durable`, with retries. The residual case (every act fails, then a restart after the disk heals) is accepted with a plain owner warning. A fail-closed clean-close record was declined, because every crash would drop every live link.
  - **Asks**, in-plan unless marked:
    - **Ask 594** (X1), option 0: while hosted, Aa shows a static line where its theme row was.
    - **Ask 595** (X3 access model) and **ask 603** (reviewer comments): released to the operator. The worker reports the operator's answers: a capability link, and signed-in comments only (R4, a follow-on). The coordinator is still confirming both with the operator. R1 does not dispatch until they are confirmed.
    - **Ask 596** (X2 old-origin reading state) and **ask 598** (HTML pages beyond the mockup frame's walls): the operator's, in X2's Waiting on you. The recommendations are a fresh start and keeping the walls.
    - **Ask 597** (X2), option 1: figure images staged. Stage 1 is a print view with figures as source; stage 2 draws figures through a capped, PNG-only library op over the existing bridge.
    - **Ask 599** (X2), option 0: large-file ceilings of 64 MiB, and 4 MiB for a PDF, by default.
    - **Ask 600** (X1), option 1: deferred, with no main absorb. **Correction to the 2026-11-18 entry**, which carried review run 2610's two minors to "X1's first item": X1's base predated #3026, so they carry instead to the first wave cut from a base that has #3026. They are row `W4-T10-M10`'s recorded count, and D-8730's two clauses that neither F4 list names.
    - **Ask 601** (X2), option 0: the rich-docs §3.3 and §4.4 amendments for D-8762 and D-8763 land with their implementing waves.
    - **Ask 608** (X4), option 0: a size row's measuring commit is read from history, never typed. See X4 below.
  - **X4, the library input (run 2680, wave 27)**, opened 2026-11-19 with a reserve of two numbers. It edits X1's and X2's specs and plans in place, so that the library programme plans its one wave from corrected text. Its contents:
    - X1's Mermaid covered-kinds constant and full derivation;
    - the colour-only states;
    - test 8's every-entry sum and append-only rows;
    - X2's F10 print design (library half);
    - X1's wave C items, folded in;
    - X2's plan line 28 (X3 owns the draft-review action, not Share);
    - a proposed X2 share.

    Its round-1 review ran as run 2694. The ruling on test 8:
    - the table's first commit is exempt from the parent check (its baseline row equals the parent's manifest total);
    - each landing on the library's main line carries frame-asset changes from one design and appends one row;
    - CI fetches depth 2.

    X2's share is a ceiling enforced by test 8: if X2's real code exceeds it, the library wave stops and asks. The coordinator sets it at X4's acceptance. The review judge's `editorial-diff-over-bound` is accepted as the price of one PR.
  - **Routing**, all four design waves: an Opus · high main loop, at xhigh for each design decision, with Sonnet · medium fact checks and one Opus · high adversarial pass before each wave-done. Workflow off.
  - **Next:**
    - X4 lands.
    - The operator approves the three designs and confirms asks 595 and 603.
    - The library programme plans its one wave (X1's contract first, then X2's), and the operator releases it with a signed tag.
    - ccrc's implementing waves run: X1 wave C; X2's P1 to P6; X3's R1 to R4, with R3 after the device item. Each carries its first item from the list below.
    - Then E, and F.
- **2026-11-18: D2 accepted and landed (#3026, `839c05e46`); D closes; the three required-extension design waves X1, X2 and X3 opened as runs 2631, 2632 and 2633 (coordinator; in-plan rulings).**
  - D2 ran as run 2436. Its first item closed review run 2432's carries. Task 13 delivered the D-8729 focus contract, lab 10, the same-page link, the phone-head shell and the reader residue. Task 14 closed D. D-8730, phone-head-swap-keeps-back-only, was defined from the reserve at ask 555. 8731 and 8732 are unspent.
  - Coordinator rulings on D2's asks, none needing a further number:
    - Ask 551, option 0: lab 10 is measured through an opt-in service-worker field in `pwa/browser/app.ts`. The default `block` is unchanged and pinned red. A positive control proves that the built worker controls the console page before the srcdoc child is asserted uncontrolled.
    - Ask 553, option 0: a same-document link with a fragment remounts at `initialHash`, with no body read. A bare `#id` stays in the frame.
      - Its known cost, a limit of the released library 1.1.0, which has no host scroll operation: after such a jump, the "Changed since your last visit" notice does not reappear, and open folds and change marks reset.
      - A library-owner note records the wanted host scroll operation.
    - Asks 554 and 555, option 0: one phone-head shell owns the header, the row and back, so back stays the same element across the swap, with identical DOM in both states and no CSS change. Both 2026-11-06 phone blocks are byte for byte. D-8730 records what is not retained: focus on Share, Export or Page details drops at the swap.
    - Ask 559 (re-asked from 556 and 557), option 0: the four W8a residue items are fixed at their smallest, outside Task 13's list.
  - Review run 2480 (round 1, at `3145d75c6`) found one important item: only the crumbs half of the panel key was pinned.
    - It was fixed with truth-line cases and their own mutation row.
    - The lab census scan's comment-order gap was fixed in D2, after its holder released the file. The corrected scan reds no existing lab file.
    - Minors A1 to A8 were fixed or recorded as ruled. The commands clause was added to the §6 Keys and M8.1 amendments.
  - Review run 2557 (round 2, at `36a11a4bb`) found two important items:
    - the census scan's single-quote and template arms had no planted control. Fixed: one control and one row per arm, each control in its own case.
    - the end-state row table did not meet its own definition. The coordinator ruled to complete it rather than narrow the text. Twenty-five rows were added and run red.
    - `W4-T9-M7`, stale since an earlier wave's rename, was re-recorded red as `NDR-D2-RP-W4-T9-M7`.
    - The worker measured 71 earlier rows that do not apply, where the coordinator had named 91, and showed the derivation (68 + 3). The measured figure stands. The table holds 592 rows.
    - The minors: §4.1's clause now matches §6 and M8.1 word for word, without "synchronously". That is a coordinator ruling: the three spec rows say less than Task 13 and D-8729, not otherwise, so no number is needed. M8.1 says the clause is the library's behaviour in 1.1.0 and that no row reds it. D-8730 gets no new reds: it is a recorded departure, not a guarantee.
  - Review run 2610 (round 3, the cap, at `18fc6ed6d`) found nothing important and nothing that blocks landing. Round 2's items are closed, and the 592 and the 71 reproduce.
    - Two minors carry to X1's first item: row `W4-T10-M10`'s recorded count (3 failed, measured 2, still red), and D-8730's two clauses that neither F4 list names.
    - The commit-grouping minor stands as written.
    - A watchdog fallback is a failure by the browser file's contract. The reviewer measured 5 of 5 runs at 54 of 54, at loads up to 21.6.
  - Hosted evidence: full runs 44283246987, 44340629075 and 44382139744 were green on each reviewed tip. Two fast-run server shards failed once each on timeouts in files D2 does not touch (`retire-executors-pin`, `ccrc-install-tree`), and their re-runs were green: load flakes.
  - The census file was also changed by #2991 (merged before fix round 2), #3034 and approvals PR 1. Each worker consented to keeping both sides, and the merge queue re-tests the combined code.
  - Landing: run 2436 went to `merging` with landing entry 407 pinned at `18fc6ed6d`. It was enqueued with `gh pr merge 3026 --match-head-commit 18fc6ed6d` and merged at 21:24:27Z as `839c05e46`. The successors were opened before run 2436 closed done, final.
  - Panel identity: every round ran three lenses on `claude-opus-5-5` and refuters on `claude-sonnet-5-5`, at the script's literal effort `high`, none dead.
  - **Next: the required extensions are designed before E.** The Waves order puts them after D and before E. E's README must describe the shipped extensions, so E waits.
    - Three docs-only design waves run side by side on disjoint files. "Docs workers remain serial" was a coordinator call against shared-file collisions; design waves share no file.
    - X1, native appearance continuity, is run 2631 (wave 24), with reserve 8759-8761. Its first item is round 3's two carries.
    - X2, the #1418 parity inventory and design, is run 2632 (wave 25), with reserve 8762-8764. It owns the rich-docs parity table's amendment.
    - X3, #1420 private draft-review sharing, is run 2633 (wave 26), with reserve 8765-8767.
    - Each wave delivers a design spec and a leaf plan whose acceptance rows map onto Task 17's matrix. Implementation waits for the operator's approval.
    - A library change is designed in X1 (appearance) and X2 (figure images for print), and built later as one library wave and one release. The release and its signed tag are the operator's.
  - Coordinator rulings on the design waves' first asks:
    - Ask 594 (X1), option 0: while hosted, Aa shows a static line where its theme row was. There is no Settings button, which would need a new host command; outside ccrc, Aa keeps its theme row.
    - Ask 597 (X2, print), option 1: design figure images, staged. Stage 1 is a print view from ccrc's own window, with figures as source. Stage 2 adds drawn figures through a library operation that returns capped PNG only, checked by the console, over the existing bridge vocabulary. Parity needs stage 2. A large cost goes to the operator as a possible waiver.
  - For the operator, carried in the specs' Waiting on you with a recommendation each:
    - Ask 595 (X3): the draft-review access model. Released to the operator.
    - Ask 596 (X2): old-origin reading state, fresh start or an opt-in import follow-on.
    - Ask 598 (X2): HTML pages beyond the mockup frame's walls. Keep the walls, or commission a separately reviewed widening design.
  - Routing for the design waves: an Opus · high main loop, xhigh at each design decision, and Sonnet · medium fact-check subagents. One Opus · high adversarial pass over the spec before wave-done. Workflow off.
- **2026-11-18: D1 accepted and landed (#2989, `8a6f62309`); D2 opened as run 2436 (wave 23) with D-8729 defined and reserve 8730-8732 (coordinator; in-plan rulings).**
  - D1 ran as run 2380. Its first item closed review run 2378's C2 carries. Tasks 11 and 12 built the bounded client diff (`reader/diff.ts`) and the history seed, changes adapter and version state. No departure was defined, and the reserve 8716-8718 is unspent.
  - Coordinator rulings during the wave, none needing a number:
    - Ask 517, option 0: `DocsScreen.tsx`, outside Task 12's Modify list, gains one `history: api.docs` line in `DEFAULT_READER`. `ReaderDeps.history` is optional and typed as the existing `DocsHistoryLoader`, and its absence reads as history unavailable. This is composition for the plan's own interface, not a departure.
    - A flake report from another programme's coordinator was measured and owned. `reader-frame.browser.test.ts`'s M8.B5 control failed twice in hosted browser shard 1/3 on PRs that touch no reader code (jobs 134313916808 and 134342000252). It was routed into D1's fix round 1. The cause was the test's evidence: once the forged ready made the reader fall back and remove the frame, Playwright dropped the child's console hello. The fix stays inside the test harness.
  - Review run 2407 (round 1, at `84617b0ef`) found two important findings:
    - F1: the oldest day's changes always read unavailable, because the base read at the oldest commit's parent answers `absent-path`. The coordinator ruled this conformance, not a departure. The completion spec's Version callback row admits parent hashes "so the oldest day's parent remains usable", and rich-docs G5 says "the oldest day window sends a commit's parent; neither need be in the doc's history". An `absent-path` answer at the base, and only that word and only at the base, reads as the empty text, so every line is marked new.
    - F2: the close's replay sentence was wrong (23 applicable rows missing). They were replayed, all red, and the sentence was corrected.
    - A1 and A2 corrected words. A2's empty-after-document pin was ruled the released library's measured behaviour, not a departure.
    - Accepted as recorded: the first item's minor 2, and Task 12's M4 to M7 and N11.
  - Review run 2424 (round 2, at `644b1c871`) confirmed round 1 closed. Its one important finding was that the M8.B5 control's no-effect claims never asserted the child's ops had arrived, a gap from before D1, and the addendum had added a lost-ack window. The coordinator ruled a fix: assert the ops reached the reader, and remove the window. The worker also extended round 1's F2 ruling, as the same ruling's shape, to 50 W8a and W5h-a rows its enumerations had missed; all were replayed red.
  - Review run 2432 (round 3, the cap, at `201ed3587`) found nothing that blocks landing on behaviour.
    - Its F1 is a counting claim: the replay still omits 46 rows, namely 43 W5P1 rows and `W8A-T11-M4`, `-M5` and `-M13`. The reviewer replayed all 46: 45 red. `W5P1-T9-M19` survives at D1's base too, so it is a stale row and not D1's.
    - Ruling: D1 accepted at `201ed3587`, with no fourth review. F1's fence correction and A1 to A4 (two test-harness words, a reason pattern, the stale row) carry into D2's first item. This follows the B1, B2, C1 and C2 precedents.
  - Hosted evidence, all full runs on the branch:
    - 44149519719: green. `reader-history.browser` passed 11 on its first hosted run, and `frame-cost.browser` passed with no window overrun, where local runs had overrun at load average 20.
    - 44186464989: green.
    - 44205973114: attempt 1's server shard 10/12 failed on three 20-second timeouts in `ccd-crosspool` and `history-lib`, files D1 does not touch. The re-run of the failed jobs (attempt 2) is green, so this was a load flake.
    - Medians against the 1 000 ms gate: reconstruction 281.6, 207.9 and 231.8 ms; text-heavy 238.0, 256.4 and 252.9 ms.
  - Panel identity: every round ran three lenses on `claude-opus-5-5` and refuters on `claude-sonnet-5-5`, at effort `high`, none dead. Round 3 gave one lens the whole wave.
  - Landing: run 2380 went to `merging`, with landing entry 364 pinned at `201ed3587`. It was enqueued at 01:04:18Z with `gh pr merge 2989 --match-head-commit 201ed3587`, and merged at 01:28:19Z as `8a6f62309`. D2's run was opened before run 2380 closed done, final.
  - D2 is run 2436: completion Task 13 with lab 10, Task 14 (D's close), and round 3's carries as its first item. C2's two known duplicates also go to the first item: `DocImage.tsx`'s base64 loop and `share.ts`'s worktree-label ternary.
  - Block 8729-8732 is issued to D2.
    - D-8729, reader-mount-focus-yields-to-host, is defined in the completion plan's Deviations found in this commit. Task 13 departs from rich-docs §4.1's `Focus` row, §6's `Keys` row and M8.1. On the Docs profile, mount focuses the frame only when no external host element owns focus, sampled once immediately before the synchronous mount. Explicit reader commands still focus, and the lab profile is unchanged. Task 13 amends the three sentences.
    - Reserve: 8730, 8731 and 8732.
  - Routing: Opus · max main loop. D1 ran there, its first wave-done was `suite: red`, `failure: shallow`, and there is no higher rung. Sonnet · high implementers; Opus · high per-task reviewers on Task 13 and the first item's enumeration; workflow off; compact 40; browser on.
  - D2 is dispatched from `main` after this ledger PR merges, on a fresh child.
- **2026-11-17: C2 accepted and landed (#2969, `62c1565d2`); D split into two serial runs; D1 opened as run 2380 (wave 22) with reserve 8716-8718 (coordinator; in-plan rulings).**
  - C2 ran as run 2342. The worker's first item closed review run 2318's seven C1 minors. The CI browser leg now prints the gated medians, with the 1 000 ms gate unchanged.
  - Departures C2 defined from its reserve:
    - D-8711, mockup-view-host-inputs: `MockupViewProps` also takes `page`, `relist` and `download`.
    - D-8712, mockup-census-row-cap: the coordinator ruled option (b) on base §5.6.2's "never freezes the console", over the Census bullet's "one row per reference". The on-screen census and links folds, then the Export sheet's and the saved file's lists of omitted assets, show 500 rows plus one line for the rest, with totals kept true. 8713 is unspent.
  - Coordinator rulings during the wave, none needing a number:
    - `MOCKUP_AUTO_RENDER_BYTES` (1 048 576) lives in `mockup/policy.ts`.
    - Copy the spec's viewer sentences verbatim, and fill its silences in `docsText`'s register with no promise or control. Six strings were filled; the reviews checked them.
    - `load.ts` exports its existing `parseSrcset` and `base64Of` rather than Export copying them.
    - `provenance.ts` owns the worktree label.
    - `pwa/src/docs/mockup/census.ts` is created as a pure L1 module, to move the view's decisions out of L4.
    - The snapshot keeps its own inliner, on its recorded reason (a different cap, strip mode and output), reviewed as legitimately different.
  - Before review, the first wave-done was sent back for two open code-scanning alerts in a browser test file (js/bad-code-sanitization). They were fixed in code, not dismissed.
    - The rerun's one red was a server timeout in `ccrc-update-fetch`, accepted as a flake: the branch touches no server code, and the same test passed at the previous tip and on the re-run of the same merge commit.
    - Lab 10 (a service worker never controls a sandboxed srcdoc child) cannot be measured in the browser harness, which blocks service workers. It is routed to D, Task 13.
  - Review run 2361 (round 1, at `b63b130df`) found three important findings:
    - F1: a re-run reader body after sign-in stayed in `ready`.
    - F2: Export's timeout dropped every loaded asset. The coordinator ruled that F2 must follow base decision 3 (the operator's share-export choice) and §4.17: keep what loaded, and use placeholders only for what is still loading. That is conformance, not a departure. The worker added `startMockupLoad`/`now()` to the loader.
    - F3: the Export sheet's omitted list was uncapped. It now falls under D-8712, widened.
  - Review run 2372 (round 2, at `a8d28d054`) found three more important findings:
    - F1: a sign-in during the reader's image walk was missed.
    - F2: round 1's `title`/`alt` exemption narrowed §5.6.9 step 4. The coordinator ruled to follow the step: strip first, then write the link target into `title`. No number was spent.
    - F3: no test separated a byte-identical build from a same-length change.
    - The reviewer's report write was refused by the heavy-test hook as a text false positive (ask 489). The coordinator ruled the Write tool, since writing a file starts no test.
  - Review run 2378 (round 3, the cap, at `0dc099d28`) found round 2 closed, with 16 rows replayed red, including a Chromium row.
    - It confirmed three findings. F1: `MockupView` misses a sign-in during a pending load, the reader's F1 class in the viewer, a narrow window and not a security finding. F2: one C1 loader row no longer applies after the end was derived from `now()`. F3: the reader's no-401 `unwatch()` has no red test.
    - Ruling: C2 accepted at `0dc099d28`, with all three carried into D1's first item and no fourth review. The cap was reached; F2 and F3 are ledger and test gaps; F1 has a manual retry and a known fix. This follows the B1, B2 and C1 precedents.
  - Hosted browser medians against the 1 000 ms gate, from CI's own logs (full runs 44049862947, 44066807476 and 44085330692):
    - Reconstruction: 278.0, 321.6 and 213.6 ms.
    - Text-heavy: 371.1, 356.1 and 339.6 ms.
    - The worst margin is 2.7x, so the 2x hosted margin D-8695 asked for is now measured.
  - Panel identity: every round ran three or more lenses on `claude-opus-5-5` and refuters on `claude-sonnet-5-5`, at effort `high`, none dead.
  - Landing: run 2342 went to `merging`, with landing entry 345 pinned at `0dc099d28`. It was enqueued at 13:25:35Z with `gh pr merge 2969 --match-head-commit 0dc099d28`, and merged at 13:51:42Z as `62c1565d2`. D1's run was opened before run 2342 closed done, final.
  - D runs as two serial runs (a coordinator call, beside the plan's serial C/D decomposition).
    - D1 is the first item plus Tasks 11 and 12. D2 is Task 13, Task 14 and lab 10, opened after D1 lands.
    - Why: C2's two implementation tasks needed all three review rounds, D has three, and Tasks 12 and 13 share `ReaderFrame.tsx`, `reader/policy.ts`, `reader/bridge.ts` and `docsLinks.ts`.
    - Task 13's known focus-contract departure is allocated and defined from D2's block at D2's run-open, before its dispatch, as the plan requires.
  - D1 is run 2380. Block 8716-8718 is issued to it, with no known departure: reserve 8716, 8717 and 8718.
    - Routing: Opus · max main loop. C2 ran there, its first wave-done was `suite: red`, `failure: shallow`, and there is no higher rung.
    - Sonnet · high implementers; Opus · high per-task reviewers on Tasks 11 and 12; workflow off; compact 40; browser on.
  - D1 is dispatched from `main` after this ledger PR merges, on a fresh child.
- **2026-11-17: C1 accepted and landed (#2915, `8d7189ce1`); C2 opened as run 2342 (wave 21) with reserve 8711-8713 (coordinator; in-plan rulings, and the operator's answers where cited).**
  - The pre-scan (Task 5) took seven adversarial review rounds.
    - Rounds 1 and 2 broke the formatting list and foreign content. The coordinator ruled a namespace-aware v3 and allocated D-8663 (ask 448).
    - Each later bypass went to the operator, who chose to continue with v4, v5, v6 and v7, each with a fresh adversarial review (asks 450 to 453, as the worker relayed them).
    - When v7 refused a committed mockup, the coordinator ruled exact foreign content inside a provable window and refusal outside it (ask 454).
    - The seventh review found no tree-model mismatch and one new cost class, the attribute count. The operator chose a cap (ask 456, D-8671).
  - C1's other rulings: ask 445, create the M5.16 parser census rule with no number; asks 446 and 447, a cap on the built srcdoc's characters and a typed refusal for a page alone over it (D-8662); ask 457, a separate number for lowering depth and open formatting (D-8695), answered option 0. D-8659 to D-8663, D-8671 and D-8695 are each defined once in the completion plan, now on `main`.
  - Review run 2259 (round 1, at `2ef6fa23d`) confirmed six important findings, among them a quadratic main-thread planner, Results claims that no test reproduced, and spec text still at v6. Fix round 1 made planning linear by construction and cut Results back to measured evidence.
  - Review run 2281 (round 2, at `71e515bf4`) confirmed two important findings: the `HttpsOrigin` census saw only bare casts, and Task 6's mutation rows quoted the pre-fix planner. It also showed that the PR's fast CI run had skipped the browser tests, so no CI reading of the 1 000 ms gate existed.
  - PR #2915 was enqueued at 16:16:45Z, before internal acceptance, by an enqueue the coordinator did not make; its source is unrecorded. The queue's hosted runner read the reconstruction gate at a 1 410 ms median and the text-heavy gate at 1 052 ms, and the queue removed the PR.
    - Ruling (fix-round addendum): keep the gate and lower the limits.
    - The worker measured depth 64, open formatting 16 and attributes 32, with tags staying 15 000, as the smallest set meeting a 150 ms local target with at least 2x headroom for every committed mockup.
  - Fix round 2 closed round 2's F2 to F8, one commit per finding (F5 and F8 share one commit, accepted as recorded), and landed the lowering under D-8695.
  - Full CI run 43969306070 (`workflow_dispatch`, full) on the final tip: all three browser jobs passed, and `mockup-parse.browser.test.ts` ran its 71 tests on a hosted runner under the 1 000 ms gate.
    - It printed no medians, so the 2x hosted margin is still unmeasured.
    - Its only red was `deviation-refs` on four numbers that another plan moved between files on `main` after C1's base: D-8344, D-8345, D-8354 and D-8381.
  - Review run 2318 (round 3, the cap, at `10d7bd81d`) found nothing important.
    - Every round-2 finding was closed, and 20 mutation rows replayed red.
    - The limits are the code's values. All five committed mockups are admitted: depth 17, open formatting 2, attributes 7, tags 5 394.
    - Seven minors remain: stale current-contract text in both specs and the plan, one headroom figure, stale test comments, and the joined commit.
  - Ruling: C1 accepted at `10d7bd81d`, with round 3's minors carried into C2's first item and no fourth review. The cap was reached and only minors remain; this follows B1's and B2's precedent.
  - Panel identity: every round ran three lenses on `claude-opus-5-5` and refuters on `claude-sonnet-5-5` (35, 29 and 31). Effort `high` is in round 2's transcripts; rounds 1 and 3 record it only as the script's literal.
  - An earlier operator decision is superseded. Lowering `MOCKUP_MAX_DEPTH` to 64 replaces the base spec's share-export decision 9 ("stays 256"). The authority is the operator's answer to ask 457 (option 0). C2's first item annotates decision 9, and D-8695 says so.
  - Landing: run 2209 went to `merging`, with landing entry 322 pinned at `10d7bd81d`. #2915 was enqueued at 22:51:10Z with `gh pr merge 2915 --match-head-commit 10d7bd81d`, and merged at 23:36:30Z as `8d7189ce1`. C2's run was opened before run 2209 closed done, final.
  - C2 is run 2342. Block 8711-8713 is issued to it, with no known departure: reserve 8711, 8712 and 8713.
    - Routing: Opus · max main loop, one effort rung above C1's xhigh, because C1's first wave-done was `suite: red`, `failure: shallow`.
    - Sonnet · high implementers, Opus · high per-task reviewers on Tasks 8 and 9's boundaries, workflow off, compact 40, browser on.
  - C2 is dispatched from `main` after this ledger PR merges, on a fresh child. Its first item is review run 2318's minors and the hosted-median record.
- **2026-11-16: B2's review rounds 2 and 3, acceptance and landing; C1 opened as run 2209 (wave 20) with block 8659-8662 and its one known departure defined (coordinator; in-plan rulings).**
  - Fix round 1's wave-done at `02b7bc2ac` was re-measured. The tip equalled #2886's head, 6 commits on `c16276de2`, no merge. The `ci` run and the `CodeQL` check itself succeeded, and no alert was open.
    - Review run 2204 found every round-1 fix in place and every new row red, and no executable `pwa/src` line changed.
    - It confirmed one important finding, F-N1: the rich-docs row M8.22 still said a frame `navigate` never produces an `at=` URL, which refinement (o) (Q2 a) made false. It also kept four plan-text minors.
  - Fix round 2 was text only. It amended M8.22 and defined D-8654, version-navigate-inherits-at (refinement (o)), from the reserve.
    - A search of both specs found base §2 (d)'s and §4.5's Open committed version sentences also contradicted. They were amended under D-8651, whose ledger copy now names them.
    - B2's first reserve departure, version-github-caution (Decisions, 2026-11-16, B2's server suites), is D-8653. 8655 is unused.
  - Review run 2208 (round 3, the cap) found the round correct: M8.22 matches the code, D-8654 is in the right home, and the search left no contradicted sentence. Three findings remained:
    - F1: refinement (o) in the W5b plan still reads "pending Q2" and names no departure.
    - F2: no test passes a non-null `pageAt` through ReaderFrame's onLink and `routeReaderLink` (important by a 2-1 vote; the reviewer read it as advisory).
    - F3: the round-2 checks table names the commit before the head.
  - Ruling: B2 accepted, with F1-F3 carried into C1's first item and no fourth review round.
    - The cap was reached, and the work was past the operator's two-round cutoff.
    - Three reviews verified the behaviour at the tip. The remaining gaps are plan text and one test of a rule the code already keeps.
    - This follows B1's precedent: its minors A1-A4 became B2's first item.
  - Panel identity: the coordinator read every review agent's model from its transcript. Each round ran 3 lenses on `claude-opus-5-5` and its refuters on `claude-sonnet-5-5` (25, 11 and 15), none dead. The reviewers' own main loops ran on `claude-sonnet-5-5`.
  - Landing: run 2178 went to `merging`, pinned at `c67064bed`. #2886 was enqueued at 06:51Z with `gh pr merge 2886 --match-head-commit c67064bed`, and merged at 07:12:31Z as `de1cbc963`. Run 2178 closed done, final, after the MERGED mail, and C1's run was opened first.
  - Ledger PR #2890 first named B2's reserve number before B2's plan was on `main`. `deviation-refs` refused it: a tracked D-ref may not sit above the highest plan-defined number. A follow-up commit named it by slug, and the number is recorded here, after #2886 merged.
  - C1 is run 2209. Block 8659-8662 was issued to it, and its one known departure is defined here and in the completion plan's `## Deviations found` in the same commit:
    - D-8659, mockup-historical-class-cap, completion Task 6: departs from base §5.6.3's Budgets sentence ("All are decided from listed sizes **before any fetch**") and from the `inline` verdict's `size`, which that sentence makes the listed size. For a historical commit C that differs from the served tree's commit, the served listing still decides eligibility, but its size is not C's size: admission reserves the full existing class cap per asset before any fetch, nested CSS discoveries included, and a reservation never shrinks or recycles within one attempt. An `inline` row's `size` is that reservation. Same-pin listing sizes are used only when tied to the exact admitted pin. The UI discloses the conservative historical admission. This is the coordinator design call the completion plan's Task 6 labels; Task 6 amends the sentences.
    - Reserve: 8660, 8661 and 8662.
  - C1 is dispatched from `main` after this ledger PR merges, on a fresh child. Its first item is review run 2208's F1-F3.
  - C1's routing (clause 13): main loop Opus · xhigh, one rung above the completion plan's Opus · high. B2's session had a failed check of the shallow kind (review run 2201), and C1 is a fresh session, so the second-failure rule that reaches `max` starts again. Implementers and per-task reviewers stay as the plan names them: Opus · high reviewers on Tasks 5-7.
- **2026-11-16: B2's server suites, wave-done, review run 2201 and fix round 1 (coordinator; in-plan rulings, after the autonomy window).**
  - Ask 442 (B2's worker): whether to run the whole server suite before the push. Ruled option 0, a related run, with its scope sent first by mail. Task 22 Step 2 names the server files to run, not the whole suite. The branch touches the server package only through two test files and L0's `shared/docs.ts`, and no server/src file. The fleet box was killing test slices for memory at load 10-18. The worker then measured the transitive importers of `shared/docs.ts` at 1166 files, almost the whole suite, so the local run was narrowed to the 26 direct importers. The transitive set is the PR's traced selection on CI's runners. The brief's "every suite of each package you touched, whole" yields to the plan's named list for a package the wave touches only in tests and L0.
  - The wave-done at `c16276de2` was re-measured: the branch tip equalled #2886's head, and the PR was mergeable and clean. The `ci` run was green on that commit, the `CodeQL` check itself succeeded, and no alert was open. `ccd/ccd` is byte-identical to base. The plan's diff carries no duplicated half. the five run-open numbers and one reserve number have one definition each in the plan, and the other two reserve numbers are written bare. The signal lines read `suite: unrun`: the server half ran by selection, and CI selected 765 server files.
    - The worker defined one departure from the reserve, version-github-caution (its number is recorded here once B2's plan, which defines it, is on `main`): on a version page, View on GitHub and a repo link carry the may-differ caution. It departs from base §3.11's origin-or-equal row (link, no note). Review run 2201 judged it real, stated and minimal.
  - Review run 2201 read `c08b8d4b1` to `c16276de2` with a fresh reviewer. The panel was 3 Opus lenses and Sonnet refuters, 28 agents, none dead. Two important findings were confirmed, and no production behaviour is wrong today:
    - F1: Task 4's "body links and images keep the version" is pinned only at the unit seam. The reviewer measured DocsLeaf's `pageAt: page.at` set to null with 440 tests green.
    - F2: the rich-docs spec's G6 row still says Back to the latest keeps its ref in `history.state`, because Task 21's find/replace appended to the row instead of replacing it.
  - Fix round 1 (review cap 3, round 1): a screen-level version-page case and a row (F1); the G6 row narrowed (F2), fixed in this PR rather than carried, since D-8648 says the sentence is amended and W8b builds on it; three guard terms measured as rows (F5); the history loader's own `unreachable` and `no-docs-route` cases, and one asserting the ordinary visit fakes carry no history loader (F6); two stale docstrings and a §3.11 clause (F3, F4); and D-8650's plan definition names §4.3 item 1 and item 5, as its ledger copy now does.
  - Rulings on the review's asks: the forced `pageAt: null` token in `pwa/test/docs-export.test.tsx` and `fileKey`'s required `version` flag are accepted (F7). Row W5B-T17-M4's stop-and-ask was self-ruled by the worker, and is accepted on the review's measurement that the row reds after the strengthening (F8). `pwa/src/lib/api.ts`'s three hunks are what Task 20 Step 3 prescribes; the tree merges cleanly with #2879, the file's other editor (F9). Both self-rulings are recorded as such in Results.
  - Routing (clause 13): no change, main loop Opus · xhigh. This is the first failed check of the shallow kind on B2's session: a proof-list item pinned only at the unit seam, a spec row appended to, and a stop-and-ask self-ruled. A second on this session moves the main loop to max.
- **2026-11-15: B1 landed; B2 opened as run 2178 (wave 19) at `planned`, with block 8648-8655 and its five known departures defined (coordinator, at run-open, per the W5b plan's execution amendment).**
  - #2860 merged at 23:33:46Z as `3be6ede40`, its head `f9c82dea8`, the run's verified handoffCommit. Run 2124 closed done, final, and its child was queued for reclaim. #2847, which conflicted with #2860 in `server/test/auth-gate.test.ts` when combined, was ahead in the queue and did not land first, so no land-sync was needed.
  - Block 8648-8655 was issued to run 2178. The five known departures are defined here and in the W5b plan's `## Deviations found` in the same commit:
    - D-8648, version-ref-in-url, refinement (m): departs from the rich-docs spec's G6 ("'Back to the latest' its ref, in `history.state` for the visit, not in the URL") and RD19 ("`only` and `latest` stay in-visit state"). `ref` stays in the URL beside `at`, as the operator answered Q1 (a), and W5b writes nothing into `history.state`; the spec's Later item loses its `latest` half. Task 21 amends the sentences.
    - D-8649, version-images-at-version, refinement (n): departs from base §4.11's pin rule (a committed page gives `CommittedPin{commit: ref.commit, servedRef: ref.served, section, path}`). A version page's images are read at the version. Task 21 amends the sentence.
    - D-8650, version-needs-listed-file, refinement (p): departs from four sentences of base §2 (e) (a gc'd pinned commit answers `unknown-commit` and the PWA re-lists once; a commit reaches a request only from a tree answer of the same visit; the tree is re-fetched after `unknown-commit` with one automatic retry; the failure table's `unknown-commit | 404 | auto | re-list`) and from §4.3 item 2 ("Committed bodies are keyed by `blob`"), with §4.3 item 1 and item 5's `pinFor` sentence amended with them (named by review run 2201). The version view needs the doc in the served listing, as a committed file. Task 21 amends the sentences.
    - D-8651, version-head-and-banner, refinement (q): departs from base §3.1 (`view=committed` survives on a leaf "only together with `ref`") and from §4.5's banner and truth-line rows on a version page. The header and one banner name the version. Task 21 amends the sentences. It also departs from the Open committed version sentences of base §2 (d) and §4.5 (a version page offers none), which Task 22's fix round 2 amends (named by review run 2204's search).
    - D-8652, version-export-links-inert, refinement (t): departs from base §4.17's link table, whose `doc` and `repo` rows give `githubPermalink` at C. An Export of a version page writes its body's doc and repo links inert. Task 21 amends the table.
    - Reserve: 8653, 8654 and 8655.
  - B2 is dispatched from `main` after this ledger PR merges, with no `sessionId`, so a fresh child is minted. Its brief carries the review 2172 minors A1-A4 as its first item, with the files they need named beside its plan's list.
  - B2's routing (clause 13): main loop Opus · xhigh, one rung above the W5b plan's Opus · high. Both earlier waves of this programme (the take-up and B1) had a failed check of the shallow kind; B2 is a fresh session, so the second-failure rule that reaches `max` starts again. Implementers and per-task reviewers stay as the W5b plan names them.
- **2026-11-15: B1's fix round 1, review run 2172, acceptance and enqueue (coordinator, under the operator's 24-hour autonomy grant).**
  - The fix round's wave-done at `f9c82dea8` was re-measured. The branch tip and #2860's head matched, the PR was mergeable and clean, and its `ci` run was green on that commit. This time the `CodeQL` check itself concluded success, and alert 296 was closed as fixed, not dismissed. The one merge of `main`, `6010877ad` (of `866b2bd91`), differs from git's own merge only in the two route-count files. The worker's own 11 commits touch 7 files, all within the round's items. Its signal lines read `suite: red` and `failure: shallow`, the first close's.
  - Review run 2172 read `b4a08dcf8` to `f9c82dea8` with a fresh reviewer. The panel was 3 Opus lenses and 10 Sonnet refuters (actual `claude-opus-5-5` and `claude-sonnet-5-5`, effort high), none dead.
    - It found every round-1 fix in place. The merge kept both sides' routes, at 242 routes, 239 HTTP routes and 93 exempt, as `auth-gate` measures.
    - Its one important finding, that F3's full-list arm needed a number, was refuted 3 of 3: no pre-existing spec sentence changes. Reserve 8644, 8645 and 8646 stay unused.
    - D-8642's waiver equals the delta `GROWTH_CHECK=1` measures, +167.
    - `ccd-docs-fetch`'s 4 local failures come from the fleet box's git 2.53; they fail the same way with `main`'s `ccd`. CI on git 2.56.1 passed the file. The tests' typecheck ran green in CI only.
  - B1 is accepted. The review's four advisory minors are carried into B2's first item instead of a fix round on B1. The behaviour was verified at the tip, the gaps are in what the rows pin and in plan text, and B2 continues the same plan.
    - A1: a full-list shallow case whose boundary holds only other files, and a row for it. Today no case pins that the skip count counts only parentless records that touched the doc, and a mutant survives.
    - A2: a row for the end-of-buffer return, which alone pins the nameless-root case; or the F6 row reworded by what it pins.
    - A3: Task 13's mutation fence restates the re-measured counts of six rows as their last occurrences.
    - A4: the F1 row in Results drops the line numbers of the removed copy.
  - Landing: run 2124 is at `merging`, pinned at `f9c82dea8`. #2860 was enqueued at 22:59:56Z with `gh pr merge 2860 --match-head-commit f9c82dea8`. At that point its 45 checks were green, and its merge-tree against `main` (`d96e55a32`) was clean. B2 opens after B1 reads MERGED, on a fresh child, one PR per child, and its routing is set at its run-open.
  - Routing (clause 13): no change. B1's session had one failed check of the shallow kind and a clean second round.
- **2026-11-15: B1's wave-done, review run 2153 and fix round 1 (coordinator, under the operator's 24-hour autonomy grant).**
  - The wave-done at `b4a08dcf8` was re-measured: the branch tip and #2860's head matched, the PR was mergeable, and its `ci` run was green on that commit, browser legs included. The range is 26 commits over `f6bdbf153` with no merges, in 55 files. The `CodeQL` check itself concluded failure: one new high alert, `js/incomplete-sanitization` in `server/test/docs-budget.test.ts`. The worker had reported the `codeql` workflow run's success, and the plan's Task 13 says to read the check itself. The fingerprint was exact, so the run was advanced to review anyway, and the alert's fix was held for the first fix round, to save a review cycle; nothing merges while the check is red.
  - Review run 2153, at `b4a08dcf8`: 3 Opus lenses and 32 Sonnet refuters (actual `claude-opus-5-5` and `claude-sonnet-5-5`), none dead. Its mutation rows were all red, 17 of them run as the plan says. It confirmed 2 important findings: the Results commit pasted a second copy of the plan's W5b-1 half; and the CodeQL alert, a false positive of the rule (the same expression is already open on `main`) whose fix is a test-only literal.
  - Rulings on its three minor findings that needed one. (1) In a shallow repository, `truncated` is also true whenever the walk skipped a parentless record, so a skip behind a full list of 100 is not silent; pinned by a case and a row. If that changes a pre-existing spec sentence, the run defines it from its reserve. (2) The shallow-repository G4 text stays named without a number: the plan numbers only departures from spec, design or README sentences, and this one adds a case G4 was silent on. G4 must still say that a shallow walk that ends short is truncated, as Task 12 dictated. (3) The server's redaction check, `cut(redact(v)) === v`, is accepted without a number: it departs from no spec sentence, corrects refinement (f) toward L0's "redacted, then cut", and is pinned by a row.
  - Advisory, no change: the commit shape (several fixes bundled in some commits) and the rewritten reason in A23's row, which matches the code. The fix round adds end-to-end cases for a nameless commit at the newest position and a nameless root at the end of the walk, corrects D-8642's entry to the measured +159, and marks Results' figures that only the worker's local runs can produce.
  - #2842 merged at 20:48Z and B1 then conflicted with `main` in `server/src/auth/gate.ts` and `server/test/auth-gate.test.ts`, the shared route-count lines. Under the co-edit agreement with the Overlord coordinator (the second to land merges `main` once, on its own coordinator's word), the fix round starts with one merge of `main`, with the counts set to what `auth-gate` measures on the merged tree.
  - Routing (clause 13): no change, main loop Opus · xhigh. This review is a failed check of the shallow kind on this session (an unmeasured CodeQL claim, and a duplicated plan half the close did not see). The routing matrix reaches `max` only from `xhigh` after a second failed check of the same kind on the same session, so a second one moves the main loop to `max`.
- **2026-11-15: run 1532 accepted and landed; B1's routing (coordinator, under the operator's 24-hour autonomy grant).**
  - Review run 2132, at `b7b60ed93`: 6 Opus lenses and 28 Sonnet refuters (actual `claude-opus-5-5` and `claude-sonnet-5-5`). It closed round 3's findings by case and by mutation row and found no product defect. Its one important finding was evidence only: the plan's provenance note called the 36 rows at `626fe04ea` untouched, which was false for the three `docs.css` rows, and two rows named a case title that fix round 3 renamed. The review re-ran those rows at the tip, and each was still red. The coordinator accepted the wave at `b7b60ed93` and corrected the plan's text in this ledger PR, with the screen-reader sentence restated as a prediction.
  - #2806 merged at `f6bdbf153` on 2026-11-15, bound to `b7b60ed93` by `--match-head-commit`. The merge queue's `ci` run 43691707597 was green, `browser (pwa)` 1/3 to 3/3 included, which is the plan's last merge gate. Run 1532 closed done, final, and its child was queued for reclaim. The release and installed acceptance of this change belong to F.
  - Advisory notes A23 to A27 from review run 2132 are carried (Carried constraints).
  - B1's routing (clause 13): main loop Opus · xhigh, one rung above the W5b plan's Opus · high. The take-up's first fix round missed tests and stated a claim it had not measured, which the routing ladder reads as a shallow failure; B1 is the harder shape (ccd, agent and server, with argv and redaction). Implementers and per-task reviewers stay as the W5b plan names them.
- **2026-11-15: B1 opened as run 2124 (wave 18) at `planned`, with block 8642-8646, and its two known departures defined (coordinator, at run-open, per the W5b plan's execution amendment).** The definitions are entered in the W5b plan's `## Deviations found` in the same commit, so the plans' definition high-water covers them. B1 is dispatched from `main` after #2806 merges, with no `sessionId`, so a fresh child is minted.
  - D-8642, refinement (a), ccd-growth-waiver: departs from ARCH-01's growth limit. `ccd/ccd` grows by 167 net code lines, measured at `f9c82dea8` against the merge base `866b2bd91` (21833 to 22000; 159 at the first close, and the plan's estimate was about 140) (the docs-log front, its embedded helper, the runner's log row and shape check, the parity literals and the caps lines), and the helper stays embedded for `_pr_py`'s reason, so Task 12 adds one waiver for `ccd/ccd` at the measured delta.
  - D-8643, refinement (b), no-ccd-restamp: departs from the rich-docs spec §8's W5b row ("`ccd/ccd` is restamped"). The run edits `ccd/ccd` and never restamps it, because the stamp is written at install time and `ccrc restamp ccd/ccd` is refused; Task 12 amends the sentence.
  - Reserve 8644, 8645 and 8646, unused.
- **2026-11-15: run 1532's three review rounds, and the coordinator's rulings on them (under the operator's 24-hour autonomy grant).**
  - The wave-done at `d56b10667` was re-measured: the branch tip and #2806's head matched, and the PR's CI and CodeQL were green on that commit.
  - Review run 2104, at `d56b10667`: 3 Opus lenses and 29 Sonnet refuters (actual `claude-opus-5-5` and `claude-sonnet-5-5`; effort as requested, which the runtime does not report). It confirmed 3 important findings: correctness, Export from the one bar's panel dropped keyboard focus; spec, Results recorded no provenance or audit-signatures result; reproduce, the Aa overlap was measured on a short title only. It kept 7 advisory notes and refuted 8. Rulings: D-8145 is kept on the review's merits (no finding was attributable to it; the process departure sets no precedent); D-8143 also names Figure 4's caption; Task 9's diagnostic doors are not sections and carry no status line by design, so the settings redesign spec's §3.2 gains one paragraph, defined as D-8146.
  - Review run 2116, at `2c7fe9270`: 4 Opus lenses (one for focus and CI) and 27 Sonnet refuters. It confirmed 2 important findings: the round 1 focus effect moved focus on any remount, and focus was still lost after Export on the compact row and the full head. Ruling: both in scope, as one defect in one file with one mechanism. One rerun of `browser (pwa) 1/3` was allowed for the Quick jump focus wait, which failed once and then passed; its bound stays 5 s, with diagnostics printed on a timeout.
  - Review run 2122, at `b14e3f25e`: 6 Opus lenses and 21 Sonnet refuters. It confirmed 1 important finding: the one-shot clear of the plain-view choice has no mutation row that reds. Rulings: after a plain-view choice, focus lands on the plain-view note and never on a control that navigates (A19, A22); D-8146 stays spelled in the settings redesign spec, which cites its own deviations (A10'); this ledger's D-8143 copies now match the plan (A9'). Majors fell 3, 2, 1, so the review cap was extended from 3 to 6 with that reason, and fix round 3 was dispatched.
  - Routing: no change mid-wave. The wave's `suite: red` came from the local server suite, whose 18 files all passed in CI, and is not evidence about the worker. Fix round 1 introduced one finding and an unmeasured claim, a shallow failure that B1's brief weighs.
- **2026-11-14: run 1532 resumes Task 10, with CI standing in for Step 2's local server suite (coordinator, under the operator's 24-hour autonomy grant; goals modification 24).** Run 43648206715 (`ci.yml`, full mode, on the branch tip `cc85166734d4`) ran all 1502 server test files on the Linux runners, and every one passed, the 18 locally unresolved files included. The coordinator checked the run's commit, its 48 job results, the 1502-file list against the tree and the pass line of each of the 18.
  - Three of the 18 skipped some tests on the runner (platform-hazards 6 of 12, ccrc-test-wrapper 3 of 171, ccrc-install-landing 1 of 37), so CI may not cover every case that failed locally. The Results name them.
  - Three macOS shards are red, in platform-hazards, siwc-trial and delegation-rig-w0, none of them in the branch's diff. macOS is advisory by standing ruling, and `main`'s own daily full runs on 2026-11-13 and 2026-11-14 were red on macOS too, in other files.
  - The worker merges `main` to clear #2806's conflict (`pwa/test/settings-screen.test.tsx` again), then reruns the pwa suite and its typecheck, the complete browser suite and the end-state mutation table locally at the merged tip. The PR's exact-tip CI is the server-suite verification there, and any red server file is a stop.
  - The substitution is a plan deviation, recorded under one of the run's issued reserve numbers. Nothing is accepted by it: the independent review still reads every commit, the 2026-11-11 work included, and landing, release, installed acceptance, parity and retirement stay separate gates.
- **2026-11-14: one CI-only evidence pass for the held branch (operator; goals modification 22).** The operator chose it in the coordinator's chat. The worker privacy-scanned and pushed its workspace branch at exactly `cc85166734d4`, opened draft #2806 marked incomplete and dispatched exactly one full CI run, with no edits, commits, merges, installs or local reruns, then returned to the hold. GitHub marks #2806 conflicting with `main`, so no pull-request run and no CodeQL ran. No console item records this decision: its raise was refused for an over-long label and was not resent.
- **2026-11-11: Task 10 Step 2 held; one agent install and two focused rechecks only (operator, item 161; goals modification 19).** The server suite at the worker's tip `63b383b34` left 17 files red and one interrupted (1,472 files, 1,454 green), and `agent/` had no installed modules. The operator allowed exactly one locked `npm ci` in the existing `agent/` directory, then sequential rechecks of `typecheck-tests` and `testbox-wrapper`, and kept Step 2 held. After the install `typecheck-tests` passed (12 of 12), and `testbox-wrapper` ran and failed 38 of 49.
  - The worker then went beyond that ruling, and said so itself: a second testbox recheck, a commit adding the frame-swap test (`d5a6bb20a`), a merge of `main` (`cc8516673`) and further local validation. That work stays on the branch, unaccepted, and goes to the independent review like the rest. Nothing was reset or deleted.
- **2026-11-10: R10 review content verified; five documentation corrections.** Delivery 17252 reports zero Critical/Important and five Minor findings at `bc832e789e4489614ae25cd94acde33bdb7cf929`. Literal invocation fields are `model: opus`, `effort: high`, `subagent_type: general-purpose`; reported runtime is `claude-opus-5-5`, with numeric effort 15 separately. Effort remains unverified, not approval. R9's four content findings are reported fixed; no implementation or later work-review approval is claimed.
  - The complete parity inventory must reconcile print, figure-overlay Back-to-close and old-origin state rather than inherit older Later/Dropped labels as waivers. The frozen-snapshot/re-share decision in #1420's 2026-10-25 operator comment was directly verified; remaining access/comment/security choices are still open design. Corrected summary dependencies and explicit F acceptance rows carry all required extensions without expanding A.
  - Claims freshly measured before this correction: 3888 covers only this programme ledger; 3889 covers the completion plan and design. Both are coordinator documentation claims tagged to existing run 1532, not worker source/plan claims or evidence of dispatch. Recheck live state before mutation/dispatch. The A brief, adoption plan/hash, 38-path source scope, checker, phone blocks and issued block remain unchanged. Exact-head review/CI and protected landing remain gates.
- **2026-11-10: R9 review and restored no-feature-loss gate.** Review mail 17245 reports actual Opus but leaves effort unverified; numeric 15 is not converted to a named level. Its verified content findings are corrected without claiming review approval: durable appearance acceptance gate, explicit worker source/spec/plan claims and coordinator-only ledger claim, catalogue-sharing as an open design choice, and requirements distinguished from an approved appearance design. The published R9 bytes were bound by 17246. A fresh exact-head closure with actual invocation/model evidence is still owed.
  - Audit mail 17243 prompted direct reading of the recorded 2026-10-25 ruling in #1418 and draft lifecycle scope #1420. All seven associated feature/spec tickets still read Backlog; this is not implementation evidence. The previous completion envelope incorrectly treated required large-file/PDF/variant and draft-review work as Later. The gate now requires full parity plus draft lifecycle and side-by-side evidence before final acceptance/retirement; outside folders remain a native feature without mandatory Git conversion. Detailed extension designs/leaf plans remain required; this correction does not claim to implement them or answer their unresolved access/lifecycle design questions. A's plan/hash/scope and issued block are unchanged.
- **2026-11-09: R7 brief closure 17090 accepted; CI then found the missing plan definition.**
  - Same reviewer as 17088, resumed with explicit `model: opus`, `effort: high`, `subagent_type: general-purpose`; reported actual `claude-opus-5-5`, numeric 15 separately. All five findings closed, no new Critical or Important. Coverage remains narrow: no live-claims/allocator/registry/CI check, source gate/checker not executed, Find inventory reused its parsing rules. This is not a second independent approval or product validation.
  - Exact R7 run 42708641856 failed `test/deviation-refs.test.ts`'s real-tree floor assertion in server 5/12: tracked D-8143 in this programme ledger exceeded the plans' definition-derived high-water 8142 (actual floor 8193, expected 8192). This is a real documentation defect, not a flake. The same already-issued D-8143 definition is now entered in the adoption plan's `## Deviations found`; its Global Constraints and Task 10 reconcile the existing entry rather than deferring it. No new number, allocator call, test edit or guard weakening.
  - The plan's three replacements preserve every Find line and all 40 mutation rows. Only the checker's pinned plan hash changes; its source/matching logic and 38-path scope stay identical. Brief/artifact hashes below are refreshed. New exact-head CI and focused closure still gate entry landing; R7's passed checks are not inherited. Claim 3862 release still occurs after entry landing and before dispatch. Run 1532 remains planned/undispatched.
- **2026-11-09: focused A-brief review 17088; five corrections before dispatch.**
  - Fresh reviewer invocation retained `model: opus`, `effort: high`, `subagent_type: general-purpose`; reported actual `claude-opus-5-5`, numeric 15 separately. Zero Critical, two Important, three Minor. The earlier plan/source/phone/routing checks passed within its stated limits; no new broad plan or product review is claimed. Focused closure of these corrections is still owed.
  - I-1: claim 3862 is the coordinator's five-document entry claim and includes the take-up plan Task 10 must edit. It is not an implementation-path claim. Release 3862 after entry landing and before dispatch, verify it ended, and require the worker to claim the take-up plan with its other edit paths. None of Task 8's three specs is in 3862; fresh claims on all three remain mandatory. The coordinator later claims only disjoint programme documents before further ledger edits; no live shared-plan claim is retained over the worker.
  - I-2: the source gate now compares the pinned post-C16 tree to actual BASE on the 38 explicit File Structure paths in the artifact, expanding every shorthand/spec path, including the four new paths and the run-only markup census. It runs `git diff --no-ext-diff --quiet <pin> <BASE> -- <these paths>`; a nonzero exit stops for rebrief. The plan, programme ledger and broad byte-identical roots are not pin-to-BASE inputs. Worker byte-identical restrictions apply to its own BASE-to-HEAD changes, so unrelated main drift is not mistaken for worker edits.
  - M-1: Task 10 now uses the same correctness, spec/boundaries and reproduction/evidence lens names as dispatch and independent review, retaining coverage of pin/draw, truth/interaction/layout, Settings, tests/mutations/censuses/spec/privacy. M-2: the checker asserts the exact revised plan SHA256 before its hard-coded line inventory; every Find remains on its prior line, and all 40 mutation rows are unchanged. M-3: programme-ledger ownership explicitly excludes the worker's SDD progress ledger.
  - Existing issued block 8143–8146 and D-8143 definition remain unchanged; no allocation, run transition, implementation, product test or deployed-acceptance claim. Current brief and artifact below supersede R6's versions. New exact-head checks, review-state census, focused closure and protected plan landing still gate A.
- **2026-11-09 (2026-11-09 21:53 UTC): post-C16 entry closure and reviewed-plan receipt; A is not dispatched.**
  - Source main remains `8b0fab68f1de802f3952b8ec24f2ee93f76a8574`: #2497 is independently proved merged at that commit, with head `43dfc2a51311f7e587636677998258491668429e`. Claims 3842, 3843, 3854 and 3855 are absent from the live claim list. This supersedes the earlier C16 waiting gate, not its preserved source/behavior constraints. Claim 3862 remains live for the five entry documents; no live A implementation-path overlap was measured. Recheck at dispatch and each shared-file task.
  - #2346 R5 is `2a635691ddc3f602fca04894ee34c2d8af4ee272`; #2350 R4 remains `440c29f08f70ec6cdd952854208a698c3377e32d`. On these exact heads, all four required checks were completed/success at 21:41 UTC. This later ledger-only amendment requires its own exact-head checks; prior green is not transferred. Review-state census is remeasured before protected enqueue. No enqueue, merge or implementation is claimed here.
  - Delivery 17071 closed all five substantive plan defects with no Critical/Important finding and two Minors. R5 fixes those Minors and the independently detected Task 8 source quotation. Delivery 17075 retains the actual reviewer invocation fields `model: opus`, `effort: high`, `subagent_type: general-purpose`, from the peer coordinator's tool call. The actual reviewer reported `claude-opus-5-5`; numeric effort 15 remains a separate observation, not an inferred mapping. This proves high was configured, not the absence of a later internal override. The R2/R3/R4 reads were fresh agents; the narrow R5 check resumed R4, not another independent approval.
  - Delivery 17076 reports zero Critical/Important/Minor findings in the two-line R5 delta and released focus contract at library commit `50cef012aa671974473d19c2acd77f900e9d03af`: boolean/default-true insertion focus, no ready refocus, synchronous explicit command focus. It also found update() remounts with the original focus choice, without resampling. Current bridge never calls update(); Task 13's final pre-mount sample covers that usage, and a future update caller must revisit it. The peer read mount.ts/index.ts, not the frame side or published-tarball equivalence. These limits remain. Actual-base brief review below is separately owed; implementation's independent panel is not replaced.
  - Coordinator source verification at `8b0fab68f1de802f3952b8ec24f2ee93f76a8574` found every explicit Tasks 3–8 Find: 83 directives, 82 baseline, one Task 4 intermediate call deliberately deferred until Task 3, zero misses; browser click/wait adjacency also checked. This excludes prose-only instructions and is not test execution. The exact script is retained below, SHA256 `997c103d3280bd5b487b33a1a7d9e2c84b84e96b17d540b0daf3110130a1d0f5`, so a child is not dependent on coordinator scratch. Source-byte identity and Find checks are remeasured at actual dispatch BASE.
  - Registry 1.1.0 integrity/tarball and the published non-prerelease v1.1.0 release were reread; Task 2 still verifies package attestation/signatures. Both original phone blocks and approved choices remain unchanged. Their combined result is does-not-hold, so production remains on request. No signing, old phone run, full-suite, install or deployed-acceptance claim is repeated.
  - Existing run 1532 remains planned, no worker. Its late issued block is 8143–8146; the known definition below is recorded in the same allocation/publication act before dispatch. No replacement run or guessed number. The final actual-base brief review, exact-head checks and protected plan landing still gate A. Eventual child BASE may add the landed plan/ledger commits only if owned implementation bytes equal this source pin; any owned-source drift stops for a rebrief.
  - **D-8143: retain the lab-draw auto mode and ready gap window. This departs from reader-lab design RL14, §8, Later and Figure 4's caption automatic-flip commitments; Task 8 amended RL14, §8 and Later, and Figure 4's caption was amended in `63b383b34`, the Task 10 review fix. Auto/1.0.0 does not measure after-ready/1.1.0; production remains on request.** Issued for existing run 1532; unused reserve 8144, 8145, 8146 (bare numbers). Task 10 reconciles this definition into the adoption plan and defines only reserve actually used.
- **2026-11-09: delivery started under the operator's eight-hour autonomy mandate (coordinator entry work, not implementation).**
  - The instruction was received and entry work measured at 19:38 UTC; the intended window ends 2026-11-10 at 03:38 UTC. No scheduler or polling loop is implied. Dispatch ends the coordinator turn; mail wakes it.
  - Fresh main at entry is `ec07e0bdfc32f39af243c76543722c2c3c513556`; the previously inspected `ef96c7bc8251ba01335a32275fd1ab8d964b8309` still pinned the library at 1.0.0. Run 1532 remains planned with no worker. Planning/publication is not implementation.
  - #2346 at `5fdb6bb115f75e43e8b6d302c5ae5aa209ac80fd` and #2350 at `1717960ea14bab9cd6518f93cc5ea90aeb8c64bd` remain open. Each exact-head check census had 34 successes, nine skips and one failed non-required shadow advisory; GitHub reviews were empty. The advisory reports shadow/proof-not-built. This is not a claim that all checks pass, or permission to bypass review, required checks or the queue.
  - Item 50 was confirmed after the published amendment was verified; its answer is already recorded. No repeated confirmation or operator tick is owed.
  - **Desktop dependency changed:** #2480 is independently proved merged as `43cb80fcd9829dbd7f447e2748a904d71e179d29` (head `0bad2785eb6e5f8fe38090d81b5076cd2f2da4f5`, 2026-11-09). Delivery 16929 and the exact merged task note `docs/superpowers/plans/2026-11-07-desk-nav/b.md` supersede the earlier Part B waiting order. Adoption preserves HeadRow fitting, truth selectors, tap floors and compact behavior outside its new ready host-bar arm; it owns ReaderBarContext, readerChromeFor and headLayoutFor's third answer. Recheck reader-tool fitting, browser baselines and the 530px container threshold rather than reinstating old desktop markup.
  - **Live overlap:** C16/run 1705, #2497 at `43dfc2a51311f7e587636677998258491668429e`, remains open and claim 3842 holds adoption-shared header/style/browser/census paths. Coordination mail 17020 orders adoption's shared-header edits after C16 merges and its claims end; no co-edit permission is assumed. Recheck the actual merged C16 source before re-anchoring Find blocks. The coordinator continues uncontested plan/brief review meanwhile.
  - Claim 3862 holds the five reader design/plan/ledger documents for this entry amendment. Two independent read-only plan reviews were requested as Opus/high, each required to report actual identity; both reported a different actual runtime model. Their concrete findings inform the amendment but neither satisfies the actual-Opus review gate. The standard browser paths were unavailable; an existing cached Chromium is now being checked. No visual figure proof is claimed by this entry receipt.
  - Delivery 17022 was fetched and acknowledged: the desktop coordinator agrees adoption follows C16 and will supply merge/release evidence. Its source note confirms the new L1 policy owner, full-head refusal/coarse-pointer rules, font/width re-probes and dense controls. The two newly reported focus/name-cut carries are recorded open in the completion receipt; neither is silently waived.
- **2026-11-07: finish the remaining delivery in this programme (operator autonomy mandate; coordinator design/planning calls).**
  - The completion spec and Tasks 1–18 above bound delivery through installed evidence, not merely library publication. No remaining implementation has been dispatched by this planning act; run 1532 is still planned without a worker. Inspected remote main `ebd95592b307912beda71a14662b21acf179b612` still pins 1.0.0. Re-measure main/claims at each dispatch.
  - Item 42 (release), item 48 (take-up recommendations) and item 53 (both phone blocks) are done; item 50 has the actual Q1 a/Q2 a/two-run answer and its recording is now written in W5b rev 3. Confirm that item only after the amendment is published, not by inventing a new operator tick. The relay in delivery 16473 independently reports both plans approved; it adds no missing Q choice and authorises no merge bypass.
  - Take-up rev 3 adds executable Task 9 for Reader lab and Measure highlighting after five unchanged Settings sections; close is Task 10. Both original phone blocks remain byte-identical. Remove unsupported claims that auto/1.0.0 proves after-ready/1.1.0 scheduling; production stays on request. No redundant historical phone run is owed.
  - Coordinator calls: serial C/D to avoid shared-file collisions; conservative historical-asset class-cap reservations instead of falsely treating tip sizes as historical sizes; bounded pure diff with 20,000 lines/input, 2,000,000 shared work units (comparisons, frontier advances and copied trace cells), and 512 output marks. The lower output cap permits an independent output-guard mutation before the work budget is exhausted. Each normative departure receives an issued definition at its implementation run-open; no number is invented here. C1 explicitly amends the base asset-budget sentence.
  - A read-only builder check was requested as Opus/high but reported actual `gpt-6.1-sol`. It is advisory, not satisfaction of a required actual-model review gate. It found the historical asset-size ambiguity; the reservation rule resolves it. No source/test execution or implementation review is claimed by this documentation act.
  - The carry receipt must classify every completion-spec §7 group, with source/ref/owner/test/disposition. Unknown is not closed; an existing accepted/deferred ruling needs owner and trigger, a blocking defect stops release. Private security status is verified before any safe public disposition. Library C114 remains library-owner maintenance, not an invented consumer-release dependency.
  - Native delivery verified and standalone retired are separate end states. F requires release/full-suite/install/browser/device evidence; Task 18 remains operator-only and the programme stays open until its mandatory retirement promise is resolved.
  - **Historical peer dependency, superseded by the 2026-11-09 entry above:** desktop Part B was originally ordered after take-up/W5b, but #2480 has now merged ahead of them. Re-anchor adoption on the merged header and later C16; still send the requesting coordinator receipts after A and W5b implementation merges. Never report those merges before they occur.
- **2026-11-06: second phone block received, take-up Q1-Q3 approved, library 1.1.0 publication verified (operator evidence and decision, coordinator verification).**
  - **Both phone blocks are retained verbatim** in the take-up plan's “Phone evidence received (2026-11-06)” section. Both name Blink 156 on Android and library `0079625cc30a` (1.0.0), not 1.1.0's `6bcf14892e48`. Block 1's all-six Mermaid gap is 217 ms (does not hold); block 2's is 192 ms (holds). Worst single figure is 150 ms in both. Under the now-approved Q1, every supplied block must hold, so record `E17-READING does-not-hold`, `E17-BLOCKS 2`, **arm B with a block**, drawing on tap. No averaging, replacement of the failed block, budget waiver or claim of implemented scheduling.
  - **E18 remains bounded:** seven walls and teardown hold in both blocks; the CSP iframe channel is not measured, the library half says 0 of 1 attempted, and `store.set` and a same-source-only listener are not exercised. Block 2's busy-frame gap is 2992 ms and watchdog delay 2516 ms; this is diagnostic shared-thread evidence and gates nothing. The door reports 48 counted, 0 ignored, with the console session cookie as expected.
  - **Actual approvals, not inferred from the lab:** item 48 is `checking`, with the answer “Approve with every recommendation (Q1-Q3 as recommended)”. Q1: after-ready only when every supplied Mermaid block holds, on request otherwise. Q2: the frame's own Aa only. Q3: Share, Export and View on GitHub in the title's details panel, no extra menu. The plan records the answers. Items 53 (phone evidence received) and 42 (publication verified) are also `checking`, after the operator's own ticks; these three may be confirmed after this record is published. Item 50 separately records “Approve with every recommendation (Q1 a, Q2 a, Q3 two runs)”, also `checking`: keep the ref in a version page's URL beside `at`, preserve that version in its document links, and execute W5b in two runs. The actual W5b answers must still be written into its plan in #2350 before that item is confirmed and the plan lands. No tick is impersonated.
  - **Release verified:** signed `v1.1.0` at `50cef012aa671974473d19c2acd77f900e9d03af`; run `42245203228`, attempt 2, is completed/success, including post-verify. npm exposes version `1.1.0`, `latest` `1.1.0`, integrity `sha512-r2YCt15tGxOYKK1ONyZ/TzvpMdcC3bmUJvifmTdtrCPHxy8DG5nc65ImUi9RpPf+M82784HwMt52kdnkYcpqUg==`. The GitHub release is published, not draft or prerelease: https://github.com/Synapsium-Labs/docserver/releases/tag/v1.1.0 . Attempt 1 failed WebKit B8.2's reset-to-top check; one unchanged-tag failed-jobs retry passed without weakening any gate. The failure's root cause remains unproven.
  - **Before run 1532 dispatch:** amend the plan's executable steps for visible Settings rows for Reader lab and Measure highlighting, read exact-tip CI and merge the approved plan. No PWA implementation has been dispatched and library publication alone upgrades no consumer.
- **2026-11-06: the operator's first phone lab block received; E18 holds within the instrument's coverage, E17 Mermaid does not hold (operator evidence, coordinator receipt; the later entry above supersedes its item states and block count).**
  - The complete block is recorded in the library 1.1 take-up plan's “Phone evidence received (2026-11-06)” section. Engine: Blink 156 on Android; library build `0079625cc30a` (1.0.0), not the forthcoming 1.1.0 build `6bcf14892e48`.
  - **E18:** seven of seven walls and the teardown signal hold. The cookie control carried the cookie and none of five frame requests did. Coverage remains bounded: the CSP iframe channel is not measured, the library half reports 0 of 1 attempted, and `store.set` and a same-source-only listener were not exercised. Door: 48 counted, 0 ignored; the console's session cookie was sent as expected.
  - **E17:** the all-six mount's 217 ms gap exceeds the approved 200 ms budget; the worst single figure is 150 ms. Record `E17-READING does-not-hold`, `E17-BLOCKS 1`. Under the take-up plan's proposed Q1, this selects **arm B with a block**, keeping Mermaid on tap. The busy-frame shared-thread result (2994 ms gap; watchdog 2520 ms late) is diagnostic and gates nothing. The lab's “one figure per task” recommendation does not prove the reader implements that scheduling, and does not waive the failed all-six measurement.
  - **The access correction:** item 47 was withdrawn and replaced by item 53. The page is reached through phone-bar Search → `reader lab` → “Go to Settings › Reader lab”, or `/settings/reader-lab`, not a Settings index row. Visible rows for Reader lab and Measure highlighting are owed in the take-up wave; its executable plan still needs that scoped amendment before dispatch.
  - **No implied approvals:** this receipt supplies the measurement only. Library release item 42 and plan decisions 48 and 50 remain open. Item 53 is still `open` on the console, not `checking`; confirmation requires the operator's tick, which the coordinator does not impersonate. The measurement need not be repeated to supply this evidence.
- **2026-11-05 (evening): RL-b accepted and merged; the take-up run opened (coordinator).**
  - **Review run 1524, round 1 (19 agents), at `f90737362`.** Three findings were ruled blocking and fixed in one round. Seven minors were fixed in the same round.
    - F1: a lab mount whose Mermaid scan was dropped still read `ready`, so the figure lines and csp-27's library half could hold with nothing drawn. Ruled D-8030: under `lab-draw` only, the bridge reports a dropped scan through an optional seam, and the lab reads that mount "not measured". The text says "ready", never "drawn". A failure inside the frame stays carried until the library ships a drawn signal.
    - F2: `self-nav-tried` was sent before the 200 ms timer, so `no-self-navigate` could hold with no navigation tried. It is now sent in the timer's own task, immediately before the location write.
    - F3: the hidden page. Ruled D-8031: the busy-frame line and every timed mount's gap read "not measured" when the page was hidden at the window's start or any visibility change landed inside it. Visibility comes through `lib/pageClock.ts` only. Stop while hidden is carried.
  - **Fix round 1's browser gate.** The tried report is an image load in the same task as the navigation, and the blocked navigation's error page cancels it. The worker measured this four ways: no route, routed, a before-timer control and a beacon control. The fixture's request interception widens the window; a phone can lose the same race. Ruled D-8032 instead of the fixture change the worker proposed:
    - `no-self-navigate` holds on the door's silence plus evidence of the attempt, either `tried` or the console-seen second `load`;
    - `self-nav-teardown` holds on a second load and differs on `tried` alone;
    - the fixture, its interception and the reporting channel are unchanged.
  - **#2339 merged during fix round 1** (`8d292bdab`). It cured main's red in `session-hook-prune-deny.test.ts`, so the exception that let RL-b's wave-done at `f90737362` name that red lapsed. The fix-round push had to be green on that file, and was.
  - **Review run 1529, round 2 (15 agents), at `3cb3c32cc`.** Nothing was blocking. It found one residual and three minors, all ruled into a second round:
    - F-A: a busy spin that starts before the console's first animation frame hides from the gap measure, so the line could read `own-thread` on a shared thread. Ruled D-8033: `shared-thread` when the longest gap is at least 0.8 of the spin OR the console's 500 ms timer ran at least half the spin late.
    - F-B: the scroll test asserts that the frame is connected.
    - F-C and F-D: plan text and the carried list.
  - **CodeQL.** The round-1 tip's merge commit raised two alerts in `pwa/test/reader-lab-frames.test.ts`: #266 `js/bad-code-sanitization` and #267 `js/incomplete-url-substring-sanitization`. The "CodeQL" check read failure while the Analyze jobs passed, so a worker reading the Analyze jobs alone reads green. Both were false positives in test code. The tip was moving anyway, so fix round 2 made both clean in the test, as strict as before, rather than dismissing them. A brief now asks for the "CodeQL" check itself.
  - **Fix round 2's wave-done** was refused `bad-kind`: the worker sent kind `wave-done`, where the protocol's kind is `status` with the subject `wave-done`. No mail was created. The coordinator took the worker's status mail with its measured gate record as the claim, measured it again, and dispatched the last review.
  - **Review run 1531, round 3, the last (7 agents), at `65fc5848a`.** No finding was blocking, and none needed a ruling. Of its two minors, the plan sentence is corrected in this ledger PR and the test gap is carried (Carried constraints). Run 1470 was accepted at `65fc5848a`. #2340 merged through the merge queue on 2026-11-05 (`ce55b1ca9`) with no land-sync: fix round 2's run was already on a `main` that carried #2339. Run 1470 closed done.
  - **The next run.** Run 1532 (wave 17, the library 1.1 take-up) was opened at `planned` before run 1470's close, so the programme keeps an open run. It waits on the operator's signed v1.1.0 tag of the library (see Next-wave brief).
  - **Design and spec text.** This PR brings the reader-lab design, the rich-docs spec, the architecture spec's C9 row and the README's door sentence in line with the plan at the merged tip. That covers RL-a's handed-over sentences and review 1468's A3, A4 and F1, plus D-7967, D-8008, D-8020 to D-8022 and D-8030 to D-8033, each marked as amended where it changes.
- **2026-11-05 (night to afternoon): RL-b executed; its rulings during the run (coordinator).**
  - **Asks.**
    - Ask 309 (Task 10): `contrast.test.ts`'s `APP_SHEETS` gains `src/readerLab/readerLab.css`, and the detail's colour is dropped (the plan's comment says "layout only"). No number.
    - Ask 310 -> D-8020: the stray messages get their own benign mount, the hostile mount first. LAB_MOUNTS goes 10 to 11, the run's caps sum to 876 000 ms (about 15 minutes) and the TTL to 1 176 000 ms (about 20 minutes).
    - Ask 311 -> D-8021: the browser case counts at its own loopback server, which serves `sharedDist` and the door. One route passes `/api/reader-lab/` on to the network, and the harness files are unedited.
    - Ask 312 -> D-8022: `import-dynamic` runs from a constant script that the wall policy allows by hash, beside the nonce'd battery. Its sha256 is pinned against the text, and the canary is gated on its mark.
  - **D-8008 (the worker's ruling, which the coordinator concurred with):** a saturated or unread run keeps a counted broke as "does not hold", and nothing else holds. It departs from the design's Saturation bullet, which is amended in this PR.
  - **Without a number:** the reader mounts' scroll into view before a timed window (`hostIn`), and seven mutation rows that redded more cases than predicted, restated with the extra names.
  - **Leaves.**
    - In `pwa/test/command-layer.test.tsx`: the Go-to Settings census goes 7 to 8 with the Reader lab option (mail 15314).
    - In `pwa/test/app-lazy.test.tsx`: the ReaderLab lazy row, six to seven, with a static-import pin (mail 15531; the census's owner was told).
    - The polish programme's leave (mail 15117) in `api.ts`, `app.tsx`, `app.test.tsx` and `routes.ts`, on its terms: main's `lazyScreen` form and its retry wrapper, `findBy` awaits, and PL10's `topRouteOf` returning null outside its table.
  - **One merge of `main`** (`b4ebadcf3`), on a measured conflict in the architecture spec's context table, `app.tsx` and `app.test.tsx`. ReaderLab uses main's `lazyScreen` with no second mechanism. Review 1524 found both sides of each conflict intact.
  - **CI under the run.**
    - The runner image moved to Ubuntu 26.04 and was pinned back to 24.04 by #2334. A re-run of an older PR run replays the old image, so only a fresh push picks up the pin.
    - `main` was red in `session-hook-prune-deny.test.ts` until #2339.
    - The wave-done at `f90737362` named both reds it carried: that file, and `rings/watcher-store-port.test.ts`'s 20 s census `beforeAll` timeout, a load flake that passes alone.
- **2026-11-05 (morning): the library's 1.1.0 merged on its own repository (coordinator).** Run 1448 went through review runs 1480, 1494 and 1499 (the last). #82 merged in `docserver` on 2026-11-05 (`50cef012a`), with the library's ledger at C112 to C114 (#83). The signed v1.1.0 tag and the npm release are the operator's act (console item 42). The 1.1.x patch owes two red rows and some text residue, listed in the library's C114.
- **2026-11-04 (evening): the header and RL-a merged; RL-b dispatched (coordinator).**
  - **The phone header, run 1436.**
    - Review run 1460 found F1 to F9, ruled into one round. F6 became D-7958: `openLeaf` re-opens a leaf once on a fallback. PHONE_TITLE_MAX stays 133.
    - Review run 1463 (round 2) found no code finding. Its items are plan bookkeeping (Carried constraints).
    - Accepted at `8b8737da6`; #2284 merged on 2026-11-04 (`23222e2cd`). D-7953 to D-7958 are defined; 7959 is unused.
  - **RL-a, the door, run 1442.**
    - Ask 307 -> D-7967: two EXEMPT rows in `server/test/secret-mask.test.ts`'s GET census, the run read and the probe. That census site was missed by the design's section 4.7, which this PR amends.
    - `main` moved under the run (#2270 added a route). The worker merged `main` once, and the door's counts became 180 total, 177 HTTP, 109 gated and 68 exempt-HTTP.
    - Review runs 1459, 1465 and 1468 (the last) found no behaviour defect at the end; their items are carried.
    - Accepted at `1c807342c`; #2283 merged on 2026-11-04 (`2593469be`).
  - **RL-b, run 1470**, was opened before run 1442's close, with the block 8003 to 8008: refinement (h) 8003, (i) 8004, (k) 8005, (m) 8006, (u) 8007, and the spare 8008. It was dispatched to a fresh child. All 26 Find blocks matched at `4b0614ab1`.
  - **Consents and leaves to other runs.**
    - PL10 (run 1441) got three consents inside this programme's claims, each measured clean against the header's or RL-a's changes:
      - three deletions in `pwa/test/tap-targets.test.tsx` for its D-7952 (mail 14833);
      - `pwa/test/icon.test.tsx`'s D-5452 comment and its FleetHead entry (mail 14927);
      - the architecture spec's C5 row, removing the `fleet/MailBadge.tsx` entry.
    - The speed waves S1 and S2 (runs 1453 and 1454) got leaves in the architecture spec's C1 and K rows; the K row sits beside RL-a's C9 row, with a union resolution agreed in advance.
    - S2 also got additive lines in `server.ts`, on the condition that nothing runs ahead of the door's counter and nothing is keyed on the nonce.
  - **The library batch** was dispatched as run 1448 on its own repository, after its plan merged there (#81).
- **2026-11-04 (late afternoon): the header wave dispatched; the reader lab approved, its spec amendments written (operator, coordinator).**
  - **The phone header.** #2240 merged (`489d5b0d0`). The plan's find-check, run again at that commit, counts 22 blocks and no miss. Run 1436 was dispatched to a fresh child, with the block 7953 to 7959. Claim 3402 (run 1421, the delegation broker's visibility wave) covers `pwa/test/control-census.test.ts`. A scoped agreement covers it, accepted by that run's worker and coordinator: the header wave adds one entry after the `docs-copy` line, about 190 lines from run 1421's hunk.
  - **The reader lab (operator, console item 17).** "Approve with every recommendation". Q1: two runs, the door first. Q2: a 200 ms stall budget for the Mermaid line. Q3: the library's own frame policy plus a script nonce and one canary. Q4: the counter before the gate. Q5 (a): the door always registered, inert until a session opens a run. Q6: one tap. Q7: the gate's reading as the design says, with no Settings index row. The design and the plan record the answers (rev 3).
    - The design's section 9 amendments and the M10 mutation rows are written into the rich-docs spec in place, each marked as amended for the reader lab. RD35 and RD36 join its decisions, and the RL row joins its waves table and Figure 3.
    - Before dispatch, the coordinator re-counted every Find block at `main`. RL-b's all match, except the two that quote RL-a's result. RL-a's five route-count blocks had moved: the PL6 follow-up and landing order wave 5f added four routes, two of them exempt. They are re-quoted, and the door's counts become 174 -> 179 total, 171 -> 176 HTTP, 105 -> 108 gated and 66 -> 68 exempt-HTTP.
    - Ruling (coordinator): those counts move whenever any merge adds a route. A count that moved again before the worker's base is restated with the door's fixed deltas (+5 total, +5 HTTP, +3 gated, +2 exempt-HTTP); that is a restatement, not a stop.
    - The plan's PR was red on `topology-clean.test.ts`: two browser user-agent strings in Task 8's test code carried a four-part Chrome version, which the scan reads as a public IPv4 address. They now read `Chrome/141.0` and `CriOS/141.0`; the case parses the major version only.
- **2026-11-04 (afternoon): W5h-b accepted and merged; the header wave's run opened; the library batch planned (coordinator).**
  - **W5h-b, run 1412.** The seven values are 750, 2000, 12000, 2, 1048576, 2097152 and 150, and Export's longest wait is 18 750 ms. Part 1's seven main-thread bounds are retired in one commit; the xml strip and the two input caps stay. The block's three defined numbers are 7927 and 7928 (the operator's two approved departures) and 7929 (Export's residue, done).
    - Review run 1432: five minor items, fixed in one round. Case C6 could not fail for its title; it now does, under a new row. The cold-block figure is now one number, 280.5 ms (R19 item 1 with the first-use xml and css compiles), in the source, the test and the plan. Rows added in fix rounds read "measured", not "above prediction".
    - Review run 1433: the plan still stated the old 240 ms bound in three places. Ruled: update the plan's steps to what shipped, never mark them superseded, so that re-executing a step writes the shipped guard. Fixed in a second round.
    - Review run 1434, the last under the cap: no finding above minor. Its two plan-text items are carried (Carried constraints). Run 1412 was accepted at `9c5f78b4f`; #2257 merged on 2026-11-04 (`1533c17a1`).
  - **The header wave's run.** Closing run 1412 left the programme with no open run, so the phone header wave's run 1436 was opened at `planned`. The operator then approved the plan with every recommendation (console item 13): Q1, one tap for the full truth on a phone, with the departures plan-only; Q2, the Page details panel as a disclosure in the page's flow; Q3, leaf pages under 600 CSS px only. The block is 7953 to 7959: 7953, 7954 and 7955 for refinements (c), (d) and (e), and four in reserve. Before dispatch, the coordinator ran the plan's find-check against `main`. One of its 22 blocks, the floor-half block in `pwa/test/tap-targets.test.tsx`, no longer matched, because Export's review had added a case after its anchor. It was re-quoted at `b55e96a75` (plan rev 3), and the check now finds no miss. W5h-b's edits do not overlap it: the header wave leaves `pwa/test/docs-scans.test.ts` byte-identical, and in `pwa/src/docs/docsText.ts` W5h-b removed only the `'part1-bounds'` line, a hunk apart from the header's.
  - **The library batch (coordinator).** The held library release waits on three ruled items: U+2028 and U+2029 in the copy check, Mermaid drawn after `ready` with the Mermaid build handed over after mount, and the hooks for the phone header's option 2. Their plan is written and reviewed (three lenses; 25 findings, all applied) on the library's own repository, #81, and waits for the operator's approval (console item 24; Q1 recommends one release, 1.1.0, folding in the untagged 1.0.1).
- **2026-11-04 (later): compression accepted and merged (coordinator).**
  - **Round 2, review run 1414, at `5574f7c0b`.** No code defect. Two stale bullets in the plan's "Carried, not fixed" (rated important, plan text only) and three advisories, all fixed in a second round. One advisory amended the coordinator's earlier ruling: the q-value case now sends `br;q=0.5, gzip;q=1`, which reds both a negotiator that takes the first listed coding and one that ranks by its own order. A test pinning `emptyOutDir` on the real config was ruled out of the wave (Later, below).
  - **Round 3, review run 1417, at `a63a4f57c`, the last under the cap.** No critical or important finding. Its two minor items are carried (Carried constraints), because neither is a code defect and the cap is spent. Run 1400 was accepted at `a63a4f57c`.
  - **Landing.** The first queue attempt was removed by one browser case, W8a's "M8.B5 control", which waits a fixed 500 ms for a navigated child's hello. The queue group stacked on it carried the same change and passed both browser shards, so the coordinator read it as a timing flake and re-enqueued the PR unchanged. #2247 merged on 2026-11-04 (`ffa9f0ab2`); run 1400 closed done, with 7903 to 7905 unused.
  - **Later:** a test that pins `emptyOutDir` on the real `pwa/vite.config.ts`. Today the guarantee against a compressed shell copy rests on it, and every built-output test sets it itself.
- **2026-11-04 (morning): Export merged, W5h-b dispatched, compression's first review ruled (coordinator).**
  - **Export merged** on 2026-11-04 (`b55e96a75`) through #2237, at head `67636f01b`. The merge queue held it for over an hour behind two code-scanning threads on test files; the coordinator dismissed both as used in tests. Run 1368 closed done.
  - **W5h-b dispatched** as run 1412, with the block 7927 to 7933. 7927 and 7928 are refinements (b) and (c), the departures the operator approved on 2026-11-03; 7929 takes Export's residue (Carried constraints) as a scope addition.
  - **Compression, review run 1411 at `c6d8f2918`.** Minor items only, all ruled into one fix round:
    - F1: Brotli's text mode and size hint are tuning, not guards, so they take no mutation row. The results say so: on the case's fixtures the output with and without them was byte-identical.
    - F2: the server comment states @fastify/static's negotiation as it is, and two cases pin q-value order and a refused coding.
    - F3: the worker measured that, with pre-compressed copies on, @fastify/static 10.1.8 sends `index.html.br` or `sw.js.br` as Brotli for `/`, `/index.html`, the SPA fallback and `/sw.js` whenever such a copy exists. Asked as ask 302 and ruled build-side only, as the approved plan scopes it: no server change, and no test pins a shell copy being sent. The guarantee rests on the build's `assets/`-only copies and `emptyOutDir`; carried as a constraint.
    - F4: accepted. The release runner's Node floats on the open engines range, so a runner change can cut a prerelease that differs only in its copies, and every release carries about 4.2 MB more (1,870,694 B `.br` and 2,307,989 B `.gz`).
    - F5: the results' bookkeeping corrected.
    - The fix round ended at `5574f7c0b` with the PR's CI green. Round-2 review run 1414 reads it.
  - **Later:** pin the release runner's Node version (compression's F4).
- **2026-11-04: Export accepted after three review rounds; its last five minor items carried (coordinator).**
  - **Round 1, review run 1401, at `806224fbe`.** Two findings and four advisories, all fixed in one round:
    - Layer order: 7891's line had moved Tailwind's own `properties` layer from lowest to highest, which matters in Firefox 114 to 127. The line now declares `properties` first, and a built-output test holds the first name against the built entry sheet.
    - The stylesheet in the browser leg: the browser config turned every `.css?raw` import into an empty string, so the browser leg's export carried an empty `<style>`. A `css.include` was added, and the built file's style is asserted against the real stylesheet; recorded under 7887.
    - The four advisories: an aligned table in the hostile corpus; a worktree segment holding markup; Retry's tap floor; and a planted git-failure detail.
    - The reviewer also measured the build. The entry is 400 kB further under workbox's 2 MiB ceiling; the precache grows 314 KiB, mostly Export's lazy chunk; and the bytes before first paint are within one per cent.
  - **Round 2, review run 1405, at `22f8fd8d1`.** The reviewer's first reading skipped the held-out panel. The coordinator held the run open until the panel ran as written. The panel confirmed one item and six advisories, fixed in a second round: the planted worktree segment now holds a double quote as spec row M4.EX2 asks, dead checks are replaced, the link-order pin moves to the built shell, the layer census reads dotted and anonymous names, and the plan's text is corrected.
  - **Round 3, review run 1406, at `67636f01b`, the last under the cap.** The panel ran as written with 17 agents and confirmed nothing. Its five minor items are carried (see Carried constraints), because none is a code defect and the cap is spent. Run 1368 was accepted at `67636f01b`, and #2237 was enqueued bound to that head.
- **2026-11-03 (late night): the header pick, the reader lab, compression dispatched, Export's layer-order fix (operator, coordinator).**
  - **The phone header (operator, console item 11).** Option 1, one console row, now; option 2, one bar merged with the reader's own, later with the library release that carries Mermaid-on-open and the U+2028/2029 check. Plan `docs/superpowers/plans/2026-11-03-native-docs-reader-phone-header.md`: written, reviewed by three lenses with a refuter per finding (sixteen findings upheld and applied, none refuted), waiting for the operator's approval and Q1 to Q3. It is dispatched after Export merges, because both edit the Docs header.
    - Where the plan and the picked mockup differed, the coordinator followed the mockup: the row keeps its 1 px divider, and a stale or failed fetch shows the same attention-coloured dot.
  - **The reader lab (operator, console item 12).** "Build it": a wave of its own, not part of W8b, which stays after W5b. Its design and plan are being drafted; the design goes to the operator first, because the page needs a test-only server door that counts which lab requests carried the session.
  - **Compression dispatched.** Run 1400 opened after #2210 merged and went to a fresh child, with the block 7903 to 7905 for departures found while executing. Two live claims of other runs cover files it edits, each under a scoped agreement instead of a claim:
    - `pwa/vite.config.ts`, held by Export (claim 3329, this programme): separate hunks, agreed by the coordinator of both runs.
    - `README.md`, held by box settings W1 (claim 3365, another programme): one sentence in the Caddyfile bullet, agreed by that holder and its coordinator; a three-way merge measured clean.
  - **Export, run 1368 (coordinator rulings).**
    - The PR's full CI run was red in the browser leg only. The cause, measured by the worker: Export's lazy builder chunk made the build emit a shared chunk whose stylesheet loads before `index.css` and opens `@layer components` first, so the reset's rules beat every `@ccrc/ui` component rule, in the shipped build too. Ruled: `index.html`'s pre-paint `<style>` declares the layer order first, pinned against `theme.css`'s own statement, with a mutation row; numbered 7891. The `build.cssCodeSplit` route was measured not to work.
    - The worker had measured the candidate fixes in copies of the branch outside its workspace, which the low-disk rule forbids; it removed them and measures only inside its workspace from then on.
- **2026-11-03 (night): the operator approves the W5h-b and compression plans; Export's run rulings (operator, coordinator).**
  - **Approval (operator).** Asked on the console's Waiting-on-you list as item 10, answered "Approve both with every recommendation".
    - W5h-b: Q1, `HIGHLIGHT_PAGE_WORKER_MS` 12 000 ms; Q2, `MD_HIGHLIGHT_MAX_HTML_CHARS` 1 048 576, departing from §4.9's product rule (refinement (c)); Q3, `HIGHLIGHT_PAGE_MAX_TIMEOUTS` stays 2, departing from §4.9's "smallest count no real page reaches" (refinement (b)); Q4, the per-job latency is a later follow-up. The departures stay plan-only and are numbered at W5h-b's run opening. W5h-b is still dispatched only after Export merges.
    - Compression: approved; Q1, copies for the hashed `assets/` files only. Its run opens now, beside Export: both edit `pwa/vite.config.ts` (Export's 7887 entry inside `server:`, compression's imports, function and plugin entry), in hunks that merge cleanly in either order, and compression's one README sentence merges cleanly with box settings W1's README edits (both measured by three-way merge). The coordinator states the scoped agreements in the brief.
  - **The operator's open points are on the console (coordinator).** The coordinator's questions are raised as items too (10, this approval; 11, the phone header; 12, the reader lab), and the programme's Goals pin the spec.
  - **Export, run 1368 (coordinator rulings).**
    - Mutation rows measured above their prediction are accepted as measured and restated in the plan's results with the extra tests named; a row below its prediction stays a stop-and-ask.
    - Departures found while executing: 7888, DocsScreen's nested `publish` also forwards to the outer one (production has no outer publisher); 7889, a second control-census entry for the export links; 7890, the Export sheet's key carries an `export` prefix (the plan's key equalled Share's).
    - The ruling numbered 7887 extended to `pwa/vitest.browser.config.ts`, a standalone config that does not inherit `vite.config.ts`: the same `server.fs.allow` entry, and the browser test imports the real stylesheet module instead of a mock that copied its stripping rule.
    - PR #2237 opened at `5fcc4268a`, all 103 mutation rows red at the end state; waiting for its CI before the wave-done.
- **2026-11-03 (late): the phone check, R19, Export dispatched, and two follow-up plans (operator, coordinator).**
  - **The W8a phone check (operator).** On a Pixel 10 Pro XL in Chrome on Android 17, a spec with six Mermaid figures opened in the reader. The first open was slow, the figures drew quickly on tap, and the header took too much room. The phone's engine is Chromium, the engine every wall was measured on.
  - **Ruling: Mermaid draws on open (operator).** This replaces W8a's draw-on-tap default (the rich-docs spec's `reader-mermaid-on-tap`).
    - The library's `'auto'` mode holds `ready` until every figure is drawn, and W8a's watchdog budget has no Mermaid allowance, so flipping the mode alone would send figure-heavy docs to the plain view.
    - The coordinator's route: a library change that draws after `ready` and accepts the Mermaid text after mount, batched with the U+2028/2029 copy check into the held library release, then a ccrc wave that takes it. That wave amends the rich-docs spec's draw-on-tap sentences.
  - **The slow first open, measured on the live console.** No static asset was sent with a content encoding: on a doc with figures, about 6.4 MB (the main bundle about 2 MB, the reader chunks about 0.75 MB, the Mermaid chunk 3.7 MB) before the text. The bridge also waits for the Mermaid chunk before it mounts the frame, in either draw mode.
    - Plan `docs/superpowers/plans/2026-11-03-native-docs-reader-first-load-compression.md`: the build writes `.br` and `.gz` beside each hashed asset with `node:zlib`, and the server sends them through `@fastify/static`'s `preCompressed`. No Caddy change, no runtime compression, no new dependency. Reviewed by three lenses and a refuter per finding; four findings upheld and applied.
    - Ruling (coordinator): Brotli quality 11 while the step stays within 45 s and the build within 120 s (the built-output tests' child timeout is 170 s); otherwise quality 9, recorded.
    - Showing the text before the Mermaid chunk arrives is the library change above.
  - **The phone header.** About 341 px sit above a doc's title on that phone. Three static mockups are on the branch `brainstorm/docs-phone-header`: one console row (133 px, ccrc only), one bar merged with the reader's own (81 px, needs library hooks) and a header that scrolls away (no change at open). The coordinator recommends the first now and the second later. The operator picks; the work follows Export, which edits the same header.
  - **R19 (operator).** The measurement page ran on the same phone over 1 381 docs and 41 871 blocks. The slowest real block took 143.7 ms warm and the largest cold 96.1 ms, against the operator's 2 s bound, so the retirement gate passes. The main thread's longest frame gap stayed about 17 ms while crafted blocks ran to the 750 ms deadline. The largest real page took 9.5 s to colour, which is per-block latency, not worker time.
    - Plan `docs/superpowers/plans/2026-11-03-native-docs-reader-w5h-b-measured-values.md` sets the seven values from it and retires part 1's bounds; reviewed by three lenses and a refuter per finding, nine findings upheld and applied, no value changed.
    - Ruling (coordinator): W5h-b is dispatched only after Export merges, because Export's approved code reads what W5h-b deletes.
  - **Export dispatched.** Run 1368 went to a fresh child with the block 7879 to 7894; the first eight go to (a), (b), (c), (e), (f), (g), (h) and (w). Claim 3315 (another programme's) held `contrast.test.ts`; a scoped agreement with its holder and its coordinator lets both proceed in separate hunks.
    - Ruling (coordinator), Task 2: `@ccrc/ui`'s `?raw` stylesheets need one line in `pwa/vite.config.ts`, `server.fs.allow`, because pwa has no workspace root above it. The line goes in its own commit and takes the first reserve number, 7887.
  - **The reader lab.** A static mockup of a console page that would run E17 and E18 on the phone is on the branch `brainstorm/reader-lab`. The operator has not ruled on it.
- **2026-11-03 (evening): the operator approves the Export plan with every recommendation; run 413 ends (operator, coordinator).**
  - **Answers.**
    - Q1, A: on a page the reader frame shows, the button reads "Export (plain view)", and its tap switches that page to the plain view and exports it (refinement (a)).
    - Q2: no build version in the provenance for now; the `generator` meta carries the format's version.
    - Q3: the export keeps the exporter's palette, any of the twelve.
    - Q4: on an image page whose image failed to load, Export shows disabled, reading "Image not loaded".
    - Q5: one `exports` line in `ui/package.json` for prose.css.
    - Q6: one run.
  - **The departures stay plan-only.** The approval asked for no spec amendment, so (a), (b), (c), (e), (f), (g), (h) and (w) are numbered at the run's opening and recorded in the plan's Deviations found, not written into the spec.
  - **Run 413 ends.** The console offered no way to abandon that one run. At the operator's request, the coordinator closed it through its own close route as an abandon (state failed): its work landed through #627 on 2026-10-19, and #402 itself never merged. The server queued the child's reclaim, which pins every commit before it removes anything. Run 1368 keeps the programme open.
  - **Test timing (coordinator, #2192, merged as `eba3f63cb`).** Two docs-reader test faults dequeued or reddened other programmes' pull requests:
    - the `docs-scans` clauses W8a and W5 Share copy the whole of `pwa/src` per planted case and passed vitest's 5 s default on a loaded runner; they now take the 30 s bound clause W5h-a has;
    - five cases released a held in-thread highlighter after waiting on the DOM, before the block's request had been posted, so a late request was held for good; they now wait for the request first.
- **2026-11-03 (later): Export is planned, waiting for the operator's approval (coordinator).**
  - **The plan.** `docs/superpowers/plans/2026-11-03-native-docs-reader-w5-part2-export.md`: 13 tasks (11 build tasks, a held-out review, a close), written at `main` `ee7a9c44f`. Rev 1 was drafted just after W5h-a merged.
  - **Reviewed.** Three Opus lenses (spec, grounding, execution), with a Sonnet refuter per finding, upheld 12 findings, three of them important:
    - the reader-path option understated its cost;
    - one expected line number was wrong;
    - one predicted red was wrong.
    A scoped re-check confirmed the fixes and found three more, one important: a build branch that would have broken five planted scan cases. All are fixed. The author also re-opened one refuted finding and planned it: Export's wait ending at the worker-time ceiling.
  - **Departures.** Eight departures, refinements (a), (b), (c), (e), (f), (g), (h) and (w), so the run needs a block of at least 14 numbers at its opening. The largest is (a): on a leaf the reader frame shows, Export switches that page to the plain view and saves it. That costs one parse, one highlight pass and one docs read per image, against §4.17's "no docs request, no re-parse, no highlighting".
  - **Questions for the operator (Q1 to Q6)** are in the plan's "Waiting on you", each with a recommendation:
    - the reader path;
    - the build version;
    - the palette;
    - a failed raster image;
    - prose.css's subpath;
    - one run or two.

- **2026-11-03: W5h-a is accepted and merged, and Export's run is opened (coordinator).**
  - **Review round 1 (run 1364, tip `518e42a14`).** Four important findings and seven advisory notes. The important ones:
    - a page of repeated identical blocks bypassed the page HTML ceiling, because each key was counted once while each copy inserted its HTML;
    - a chat store kept subscriber and listener rows for keys that no block referenced;
    - the Docs store moved into `DocTree` without a number;
    - `detach()`'s clock stop was pinned by no test.
    Fix round 1 fixed all eleven items: D-7762 (the ceilings count each drawn copy, one job per key), D-7763 (the store's move stands), and the rest without numbers.
  - **Review round 2 (run 1366, tip `dcf2b9ecb`).** The code was clean: every round-1 item was verified, and all 16 new mutation rows were measured red at their recorded counts. The two plan-text findings are fixed in this ledger PR rather than by a third push and review. Refinement (j) is marked a departure (D-7762), and D-7762 names the spec sentences it departs from and its consequence for Export. Spec §4.10, §4.4 and §1 are amended in place for D-7762 and D-7763. Two minor test gaps are carried to W5h-b.
  - **CI on the PR.** One load timeout (`ccrc-update-fetch`) was re-run by the coordinator. Two closed censuses in other programmes' suites went red on this wave's words. The update move's `'detach'` census got an exemption, D-7761, narrowed to `markdownRunner.ts`'s `abortRunning` lines. Delegation wave 3's `retain` census was met by renaming the test seam to `heldKeys`. Both were misses of the wave's own server runs.
  - **Ruling: a review child may install packages.** A fresh review workspace has no `node_modules`. It may run `npm ci` in its own `server/`, `pwa/`, `agent/` and `ui/`, and nowhere else, because the workspace is reclaimed when the review run closes. Measured 2026-11-03: 91 GB free, and about 0.5 GB per install.
  - **Export's run (1368, planned)** is opened so that the programme stays active whatever happens to run 413. Export's plan inputs:
    - D-7762 (read `copySkip` for each drawn copy);
    - D-7763 (a fallback body publishes no store);
    - D-7755 (the `publish` slot's holder);
    - M4.SH3's and M4.SH8's Export halves;
    - Share's carried notice after a double tap and a cancelled native sheet.
- **2026-11-03: Share is accepted and merged (coordinator).**
  - **Review round 2 (run 1358, tip `1ff85fcb4`).** All nine items from round 1 were done, and each was measured (the two `canShare` rows red through their own tests; W5S-T4-M5 reds 4 of 101). Every suite was green at the tip, and nothing outside round 1's items changed. The six findings were in the plan's text, not in shipped behaviour. The reviewer refuted its findings by measuring them rather than with Sonnet refuters; the coordinator accepted that, because every finding was taken.
  - **Landed as reviewed.** #2145 merged through the queue as `5d48c8157`, from the exact head both reviews read. The plan-text findings are fixed in this ledger PR instead of a third push and review:
    - D-7774's rationale now says that the key closes the sheet on a page, commit or opened-pin change, and that everything else the target reads updates the open sheet in place;
    - row W5S-T5-M5 is restated at 4 failed at the end state;
    - rows W5S-T9-M4 and M5 are in the table's form;
    - the fix-round re-run line names `deviation-refs` and `dtbd`;
    - Task 5's Decision (2) carries a "superseded in fix round 1" note.
  - **Ruling: W5S-T9-M5's `Boolean(...)` mutation stands.** It reds the same single test as dropping `=== true`.
  - **Carried, from Share:** a double tap followed by a cancelled native sheet leaves tap 2's "Sharing did not finish" notice standing. The notice is true, and Copy link still works. It goes to Export's run or a later polish.
- **2026-11-02 (later): both waves are dispatched, the copy check gains U+2028 and U+2029, and the rulings made while the waves run (operator, coordinator).**
  - **The copy check (operator).** U+2028 and U+2029 join the copy check, with the four classes of the entry below. The copy check flags them, and the library's link classifier refuses them in an href. This needs one more library change, which ships in the same batched release. Then ccrc moves its pin, and spec §4.4's copy-check sentence lists the new classes.
  - **Dispatch (coordinator).** #2124 merged as `9c484ef45`.
    - W5h-a: run 1319, block 7751 to 7766. The first six numbers go to its refinements (a), (b), (e), (f), (h) and (q), in that order.
    - Share: run 1350, opened as wave 10, block 7767 to 7779. The first six go to (a), (b), (c), (e), (f) and (i).
  - **Ruling (W5h-a, deviation 7757): part 1's test cases over the HTML cap.**
    - The problem: Task 6's migrated suites hold 64 KiB blocks whose highlighted HTML (313 090 to 1 719 411 characters) exceeds the 262 144 cap the operator kept.
    - The ruling: those cases assert part 1's decision (the block is admitted and requested) and the outcome that ships (plain, "not highlighted (output too large)"), never an exact HTML length. Each suite keeps one coloured case under the cap.
    - Rejected: a test-only cap override, and shrunken inputs.
    - Cost if wrong: W5h-b revisits these cases when it sets the measured cap.
  - **Ruling (W5h-a, deviation 7758): the store's class check admits highlight.js's own scope classes only.** Task 5's review tightened it from "a first `hljs-` token, then anything". The worker names a test proving that real highlight.js 11.12 output from all 15 grammars passes, the multi-class sub-scopes included, so that W8's version bump goes red instead of silently turning blocks plain.
  - **Rulings: mutation rows measured above the plan's prediction.** These are W5h-a's T3-M6, T7-M1 and T7-M4, and Share's T2-M1, T5-M1 and T5-M4. Each is restated at its measured count. Every extra red is the same guard, or a later fix-wave test aimed at the mutated line. They correct predictions, so they take no number.
  - **Share's review (run 1356, tip `ba06f4cdd`).**
    - One important finding: no test pinned `webShareUsable`'s arm where `canShare` answers true. Measured: with that arm replaced by `return false`, 343 tests stayed green.
    - Sent back for one fix round: two cases with their mutation rows; deviation 7774 (the open sheet's target is recomputed while the sheet is open, against refinement (n)'s text); and five minor fixes.
    - One advisory is carried: a double tap followed by a cancelled native sheet leaves tap 2's notice standing. The notice is true, and Copy link still works.
  - **Ruling: deviation 7773 amends the spec in place.** Share's Task 9 review found that after a same-blob re-list, a file slot that had settled with no answer it can show kept its old pin, so Share read "Updating to" until Retry. Such a slot is ready at `pinFor`'s pin, as a failed raster image settles Share (the operator's approval of 2026-11-02). §4.16's "When Share is not offered" and M4.EX12 now say so, marked "(amended 2026-11-02; Share, deviation 7773)". Cost if wrong: Share links the tree's commit for a leaf that showed nothing, which is what View on GitHub already does.
  - **Shared files and claims.** The claim service allows one holder per path, so the briefs' "take your claims" could not hold for both waves on a shared file.
    - W5h-a holds the claims on `DocsLeaf.tsx`, `DocsScreen.tsx`, `docs-screen.test.tsx` and `docs-scans.test.ts`. Share edited those files inside its plan's hunks, under the briefs' written leave.
    - The coordinator also gave the desktop-polish programme written leave for one-line additions under W5h-a's claim: the architecture spec's C5 cell, the end of the route table, the ladder after `docs`, and their tests. Each is placed apart from W5h-a's edits.
    - Lesson for the next parallel briefs: name which wave holds each shared claim, and say that the other edits under written leave.
- **2026-11-02: W5h-a and Share are planned, and the copy check's extension waits for one batched library release (operator, coordinator).**
  - **The copy check (operator).** Answering W8a's open question (the entry below), the operator ruled that the copy check also flags U+200E, U+200F, U+061C and the tag characters U+E0000-E007F. The library carries it (Synapsium-Labs/docserver#78, its ledger's C103); its link classifier refuses the same characters in an href. The operator then held the release: the remaining items are built first, and the library's changes ship in one release. ccrc then moves its pin, and spec §4.4's copy-check sentence lists the four new classes. Until then the reader flags the spec's §4.4 set. U+2028 and U+2029 join the set as well (operator, later on 2026-11-02; the entry above).
  - **The plans (coordinator).** W5h-a: `docs/superpowers/plans/2026-11-02-native-docs-reader-w5h-a-highlight-worker.md` (11 tasks). Share: `docs/superpowers/plans/2026-11-02-native-docs-reader-w5-part2-share.md` (10 tasks). Both were written at `main` `02622053c` from the spec, re-grounding earlier drafts of 2026-10-15 to 10-17 that predate #627 and #2061. Each was read by three Opus lenses with a Sonnet refuter per lens, fixed, and re-read (Share: 11 findings; W5h-a: 21; none critical). Their departures are numbered when their runs open.
  - **Ruling: M4.SH3's and M4.SH8's Export halves move to Export.** Share cannot test an Export control before Export exists. §7.7's W5 Share and W5 Export rows, and the Export bullet in the next-wave brief below, now say so (amended 2026-11-02). Cost if wrong: none; Export's plan carries them.
  - **Ruling: R19's item 8 runs over three fixed settle cadences** (50, 100 and 250 ms) instead of "chat's own": `main` has no fixed chat settle cadence, since chat re-renders as stream frames arrive. W5h-b sets `HIGHLIGHT_STREAM_DEBOUNCE_MS` from that table. A departure, the W5h-a plan's refinement (q). Cost if wrong: W5h-b picks a debounce for a cadence chat does not have; the page can be re-run.
  - **Approved (operator, 2026-11-02).** The operator approved both plans and took every recommendation. Share: a raster image that fails to load settles Share at its pin; a leaf that opens nothing links at the tree's commit; the six departing refinements are written into the spec in place, each marked "(amended 2026-11-02; Share)". W5h-a: the tool cards' code and diff wells move onto the worker; dense JSON or YAML stays plain until W5h-b, with the provisional per-block HTML cap kept at 262 144; the longest wait the operator accepts for one block's colours, R19's retirement bound, is 2 s; the measurement page is Settings › Measure highlighting; one run. W5h-a's departures stay plan-only, numbered at run open.
  - **Overlap.** The two waves share `DocsLeaf.tsx`, `DocsScreen.tsx`, `docs.css`, `docs-scans.test.ts`, `docs-screen.test.tsx` and the census registries, in different hunks. They dispatch in parallel; the second to merge takes `main` and re-measures.
  - **Carried line closed.** "`GithubTarget` cannot express `resolveDocRef`'s `repo` kind" was closed by W5 part 1 (#627): `shared/docs.ts#GithubTarget` has `repo` and `root`, pinned by M3.16-M3.18.
- **2026-11-01: W8a is accepted after three review rounds, and its residue goes to W8b (coordinator).**
  - **What shipped.** Run 1315 shipped Tasks 1-12 as PR #2061.
  - **Round 1.** Review run 1316 read tip `9c9435ca9` and found 6 important findings and 8 advisory notes. Fix round 1:
    - ledgered three departures: the supply-chain deadlines Task 11 added, the reader's theme following the palette's mode, and the copy-failed sheet;
    - re-measured a mutation row that went red on a ReferenceError instead of on its own assertion;
    - bounded the Mermaid asset wait in `mountReader` by the reader's watchdog.
  - **Round 2.** Review run 1317 read tip `bad17ff56` and found 2 important findings. Fix round 2:
    - decodes a percent-encoded fragment before it seeds the frame;
    - measures the shell's `frame-src 'none'` wall in Chrome, with Chrome's local-network checks off;
    - narrows M7.9's specifier exception to import positions;
    - re-measured the whole mutation table at one tip (115 rows, all red).
  - **Round 3.** Review run 1318 read tip `4d62121a7` and found 5 important findings and 13 advisory notes, none of them on the walls or the supply chain. The review cap is three rounds, so the coordinator ruled on round 3 without a fourth round: all five are narrow, and they go to W8b (Carried constraints, "W8a residue").
  - **Why accept now.** Every wall the spec lists is measured. The full suite and the browser leg are green on the exact tip. Each round-3 finding is either a test gap or a narrow case the user can see, and in those cases the plain view still works.
  - **Cost if wrong.** Until W8b lands, a same-page link spelled with its file name does not scroll the reader, and a heading deep link is lost when the frame falls back after it has mounted.
  - **Rulings on round 1.**
    - F1, F2 and A2 were ledgered as deviations 7704, 7705 and 7707.
    - F4 was fixed as deviation 7706: the Mermaid wait ends at `readerWatchdogMs(bytes)`, and no new number is declared.
    - F3 was fixed.
    - F5 was carried: the copy check flags exactly the spec's §4.4 set, which is the library's set.
    - F6 was accepted as the plan's disclosed ring bend, for W6.
  - **Rulings on round 2.** Both findings were fixed without a number. A1 and A7 were carried.
  - **Deviations.** Block 7691 to 7707. Every number is defined in the W8a plan's `## Deviations found`.
  - **Operator question (open).** Should the copy check also flag U+200E, U+200F, U+061C and the tag characters U+E0000-E007F? That would change spec §4.4 and the library, in a 1.0.x release. Until then, W8a ships the spec's set.
  - **CI note.** The `browser (pwa)` job took 18 min 55 s of its 20-minute limit on one run, and 15 min 50 s on the final run. If the merge queue ever times it out, the fix is a CI change of its own, not part of W8a.
- **2026-10-31: the W8 split and W8a's defaults (operator).** Asked six questions about the coordinator's proposal (the entry below), the operator answered "defaults":
  - **(1) Order.** W8 splits. W8a, the frame core, runs now, in parallel with W5h-a and Share. W8b (G5, G6's version menu, `at=<sha>`) follows W5b. W7 moves last, so the README is written once.
  - **(2) Frame code.** The library's own `./host` (`mountDocFrame`) is used, unless the plan finds it conflicts with ccrc's architecture rules. The W8a plan found no conflict: it mounts through one ccrc adapter, `docs/reader/bridge.ts`, and records the spec rows that this amends.
  - **(3) Images.** W8a carries the images the plain view already shows. Mockups and the asset planner stay in W6.
  - **(4) Mermaid.** It is inlined only for docs whose fences pass the gate, and drawn on tap (the library's on-request mode). Auto-draw may follow once the operator has measured on the phone.
  - **(5) Colouring.** The frame's colouring (the library's `render()`) may differ from the plain fallback's for now.
  - **(6) Done.** "Integrated" means W8a is live in ccrc. Retiring the standalone docs server is a separate, later gate (rich-docs spec §9).
  - Why: the library is released, and the frame needs only what is on `main`. Cost if wrong: W8b and the retirement gate still wait for W5b, so a wrong order costs one re-plan, not a rewrite.
  - The rich-docs spec is amended in place by the W8a plan's PR (marked "amended 2026-10-31"); the departures get their numbers from the allocator when W8a's run opens.
- **2026-10-31: the library is released; W5 part 1's landing recorded; the W8 order goes to the operator (coordinator).**
  - What: `@synapsium-labs/docserver` 1.0.0 is published on npm from a signed tag, with provenance, so W8's "library v1" prerequisite is met. W5 part 1 merged on 2026-10-19 through #627 (`9b18fb0cd`); the waves table said otherwise until now. The coordinator proposes splitting W8: W8a, the frame core (the exact pin, the render job in W4's parse worker, `ReaderFrame` with the hash-only `READER_CSP`, the bridge without `changes` and `version`, the plain pipeline as fallback), to run in parallel with W5h-a and Share; W8b, the version menu and "changes since", after W5b; and W7 last, so the README is written once. The proposal amends the rich-docs spec's agreed order (RD24, the W8 row, Figure 3), not a ruling of the operator's, and W8a's plan comes to the operator for review like every wave's.
  - Why: as written, seven waves stand between the released library and its first use in ccrc, and W5h-b waits on a phone measurement. The frame needs only what is on `main` now (`copyText`, W4's parse worker, part 1's screen).
  - Cost if wrong: W8a and W6 both touch the shell's frame policy, so one of them must own the shell meta (`frame-src 'none'`), and M8.2 keeps a mockup widening out of `READER_CSP`.
- **2026-10-15: highlighting moves off the main thread in a wave of its own, W5h, and W5 part 2 splits (operator).** Five rulings. Each says what was decided, why, and what it costs if it is wrong.
  - **(1) Part 1 ships with its current bounds.**
    - What: W5 part 1 (#402) merges with the word, line and whitespace bounds, the per-grammar block caps for typescript/javascript and rust, the scan and markdown page budgets, and the xml subLanguage strip. It carries the crafted-input freeze: a crafted code block that passes those bounds can still hold the main thread while it is coloured. Part 1's own residual note (on `DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS` in `lib/markdownLimits.ts`) measures the crafted page the coordinator accepted at about 3.2 to 4.4 s, and the shapes it lists as past every bound, for a Docs page, at about 9 to 11 s, 10.6 s on the worst combined page found, and for one chat block at about 4.5 s. So the freeze this ruling accepts is seconds, at least 10 s on a crafted page. Then a dedicated wave, W5h, moves highlighting off the main thread.
    - Why: the bounds are tuned shape by shape, and four reviews found shapes that passed them. More tuning would not close the class. Taking `highlight.js` off the main thread does.
    - Cost if wrong: until W5h lands, a crafted document or chat message can freeze the console for seconds while it renders.
  - **(2) W5h is the design the review recommended, as recommended.** The review is the coordinator's design review of 2026-10-15, which compared three designs; the spec carries the full design and graft list itself.
    - What: a separate highlight worker, with two singletons (`docsHighlighter` and `chatHighlighter`) in a second worker chunk. One block per job, each with its own deadline; an overrun terminates the worker and leaves only that block plain. A content-keyed highlight store per page, text leaf or chat message, which `CodeBlock` reads. A plain first frame on every code block, chat included. No main-thread fallback: with no Worker, code is plain. Whole-block colouring stays the policy, and a line-by-line retry under the library's C24 rule runs only for a block that timed out or hit the HTML cap. `highlight.js` leaves the main bundle. The one `dangerouslySetInnerHTML` stays in `lib/markdown.tsx`'s code component, behind a strict linear main-thread check of the worker's HTML. Export reads the store by peek only, waits (bounded by the page ceilings), and says in its provenance when colouring was partial or dropped.
    - Also every graft the review listed: the worker path lands with part 1's bounds still in force, and the old bounds go later (ruling 3); three requests to the library programme ((a) a public `./highlight` export, (b) a `highlight: false` render option, (c) the stock xml `<script>`/`<style>` cost under C24); a scan that Export's import closure holds neither the highlight worker nor `highlight.js`; a private `highlight.js` instance in the worker, pinned to call no `addPlugin`, `configure` or `debugMode`; a content cache inside the worker; a ready handshake, so a worker's boot never counts against the first block's deadline; a detach abort for the highlighter only, with the parse runner's behaviour pinned unchanged; and per-page ceilings on worker time and timeout count.
    - Why: of the three designs reviewed, only this one closes the freeze class by construction, because `highlight.js` is not in the main thread's import closure at all. A highlight overrun never kills a parse or turns a page plain. Whole-block colouring keeps today's colouring and the chat goldens byte for byte. C24 as the main policy would have lost colouring across lines on 59% of real fences and left 672 fences plain instead of 3, as measured by the coordinator's design review on 2026-10-15, at W5 part 1's head.
    - Cost if wrong: a plain first frame on every code block, colouring that depends on the device and its load, a worker respawn after each overrun, no colouring at all where there is no Worker, and a wait before Export.
  - **(3) All of part 1's main-thread highlight bounds retire later, in a commit of their own.**
    - What: once the worker path is green and a phone measurement shows the real corpus (21 651 blocks) inside the block deadline, all of part 1's main-thread highlight bounds are deleted in a commit of their own, with their mutation rows re-pointed: the word, line and whitespace bounds, the per-grammar block caps for typescript/javascript and rust, and the scan and markdown page budgets. The xml strip, the 64 KiB block cap (`MD_HIGHLIGHT_BLOCK_MAX_CHARS`) and the 512 KiB page cap (`DOCS_HIGHLIGHT_PAGE_MAX_CHARS`) stay, re-argued as bounds on the input that crosses the worker boundary. Which run carries the retirement, W5h-b, is the coordinator's ruling (below).
    - Why: once a deadline bounds the time off the main thread, the caps protect nothing, and they leave real code uncoloured. Deleting them only after the new path is green and measured means a fault in that path never leaves code unbounded.
    - Cost if wrong: retired too early, a fault in the worker path has no fallback bound; kept too long, real code stays uncoloured for no gain.
  - **(4) The deadline and ceiling values are measured on the operator's phone.**
    - What: the block deadline, the boot budget, the page ceilings and the HTML caps are measured through a measurement page behind the session gate, which the operator opens once. The design's figures (750 ms per block, 3 s of worker time and 2 timeouts per page, a per-block HTML cap of 4 times the 64 KiB block cap, 262 144 characters) are starting points to measure, not values. W5h-a's plan picks the starting points for the boot budget, the page HTML cap and the streaming debounce; the provisional page HTML cap must admit the eight 60 000-character blocks of the page-budget row (M4.H2).
    - Why: every bound so far was measured on desktop or server CPUs, and the reader is a phone.
    - Cost if wrong: a deadline set too low leaves ordinary code plain on the phone; set too high, a hostile page holds the highlight worker longer, though never the main thread.
  - **(5) W5 part 2 splits.**
    - What: Share runs in parallel with W5h, and only Export waits for W5h. The coordinator narrowed that wait to W5h-a (below). The order is part 1, then W5h and Share in parallel, then Export, then W5b (RD23).
    - Why: Share sends a GitHub permalink and renders no body, so it never touches highlighting. Export renders the page's code, so it must read W5h's store rather than call `highlight.js` again on the main thread.
    - Cost if wrong: an Export built before W5h would bring the freeze back on the Export tap. Where Share and W5h touch the same files, the second to merge takes `main` and re-measures.
  - **Coordinator rulings (2026-10-15), on the open points the review's drafters left:**
    - The main-thread check of the worker's HTML accepts exactly: `<span class="hljs-…">` with highlight.js scope classes; `<span class="language-NAME">`, where NAME is a registered grammar name or alias (highlight.js 11.11.1 wraps a subLanguage region this way, as `markdown` does for `xml` and `dockerfile` for `bash`); a balanced `</span>`; and text using highlight.js's five entities. Anything else leaves the block plain.
    - W5h is two run rows. W5h-a ships the worker path, the store, the check, the measurement page and the constants at provisional starting values, with part 1's bounds still in force; Export waits only for W5h-a. After W5h-a is deployed, the operator runs the phone measurement. W5h-b then sets the measured values and retires part 1's bounds in its own PR, with the mutation rows re-pointed. The measurement page stays shipped.
    - A chat message's store applies the per-block HTML cap, the timeout count and the worker-time ceiling, per message. The page input and page HTML caps apply to Docs only: chat has no page budget today, and gains none.
    - Export's provenance counts a block the line-by-line retry coloured as coloured, does not count a block with no registered grammar, and puts the check's structural refusals and the worker's failures in one `failed` class; the check's two length re-checks count as output too large and past a page ceiling.
    - No highlight.js bump in W5h: the move from 11.11.1 to the library's 11.12.0 stays W8's to rule on.
    - Mutation rows: M4.H3 to M4.H23 and M7.11 to M7.12 in the spec's §7.10, M4.C4 and M4.C5, and M4.EX17 and M4.EX18 in its §4.15. The spec's phone measurement is named R19 (§7.8), after its §2 risk list, where R4 is already taken.
  - **Where it is written.** W5h's amendment is written in place in the 2026-10-01 spec. The rich-docs spec cross-refers to it in A6, A22 and the W8 row, records the three divergences W8 must rule on (colouring policy, `highlight.js` 11.11.1 against the library's 11.12.0, and the grammar sets), and lists requests (a) to (c) in its §8. It also edits, each marked (amended 2026-10-15; W5h): its §8 order, Figure 3, the W5 row and the W5h-a and W5h-b rows; RD33 and the sentence that opens its §10; its "Later" list; A2a, A2b and M9.14 (the third worker file M5.16 admits); its §1.4 terms "Highlight worker" and "C24"; its §3.4 Highlighting row and §4.6 fallback bullet; its §7 intro (R19 beside R1-R3); its W4 row and "What stays unchanged" (W5h's amendments of M4.M1 and M4.P10, and M4.H1 re-proved); its "In short"; and its "Where things stand". No deviation number is written yet: W5h's departures are issued by the allocator.
- **2026-10-13: W5 is split, and three more rulings (operator).**
  - W5 runs as two sequential runs, each with its own plan, PR and review:
    - Part 1 is the Docs screen (14 tasks, run 413). It merges and rolls out on the dev channel with no Share or Export.
    - Part 2 is Share and Export, planned after part 1's review.
    - W5b follows part 2.
  - W4's C-1 is accepted as is: a crafted chat message of 4 KiB or less, nested by indentation, costs up to about 0.67 s of main-thread parse.
  - The new `browser (pwa)` leg is required by `full-suite` (daily and at the stable gate), not by branch protection.
  - The Share and Export amendment (#385) is approved and merged.
- **2026-10-13: W5 part 1's plan (coordinator).**
  - It was written in stages: four scouts and an architect, then one writer per task applying it to a scratch tree in chunks of four, then a three-lens review with three refuters per finding. All ten findings were applied. The plan holds 332 mutation rows.
  - **Five departures from the spec's text, defined with the block's first five numbers:**
    - (a) the split;
    - (b) an HTML leaf shows a stand-in until W6;
    - (c) the worktree redirect's sentence stays true when the branch could not be read;
    - (d) the 2-2 bound lives in the parse's element count, exactly what the component draws;
    - (x) a base64 `.md` that is valid UTF-8 is formatted, and only bytes that are not UTF-8 get the "Not valid UTF-8." note.
  - **Bounds measured while planning:** highlighting stops at a 256-character word (r10), and a keystroke chord at 64 characters (r11).
- **2026-10-13: the ccd slug fix merged (#386, `6b939bd46`).** A GitHub slug needs a GitHub prefix, ASCII, and no `.` or `..` segment; an owner may not start with a dot, but a repository name may (`org/.github`). It reaches the boxes through ccrc's update mechanism, fleet first.
- **2026-10-13: Share and Export, and W5b's place (operator).** The operator accepted the recommended option on all 12 decisions of the Share/Export design:
  - Share always opens ccrc's sheet, and its access note always shows.
  - Export never fetches; images not yet loaded wait up to 10 s, then become placeholders. The file is capped at 10 MiB.
  - A mockup export is a wrapper around a sandboxed frame.
  - Only leaf pages offer Export.
  - On iOS, Export builds first, then saves on a separate tap.
  - An unpushed commit gets no link.
  - Mockup limits: an open-formatting cap first, then the tag limit is re-derived.
  - The export pins the exporter's theme.
  - Mermaid in HTML specs: W6 lists script-text imports as census-only rows, and `MOCKUP_CSP` is never widened.
  - ccd's slug fix is a standalone PR now.
  - W5b goes after W5 (the rich-docs spec's RD23).
  The amendment is written in place in the 2026-10-01 spec (its §0 row `share-export`). It adds §4.16 Share, §4.17 Export and §5.6.9 mockup export, three figures, and 37 mutation rows. W5 gets Share, Markdown/text/image Export and the `GithubTarget` widening as its first L0 task. W6 gets mockup Export, the script-text census and the formatting limit. M5.16 now owns the carve-out for W4's worker files (Q2, answered) and the export allowances, each with a planted control.
- **2026-10-13: rulings on the amendment's open questions (coordinator).**
  - `bad-slug` (the slug) and `bad-target` (the commit or path) are two refusal words, both confirmed.
  - W5 bounds W4's r10, r11 and 2-2 in the shared Markdown components, because Docs pages render arbitrary repository documents through them. Each bound gets a measured value, a case and a mutation row in W5's plan, and chat gains the same bounds.
  - The rich-docs spec's edits that follow from this amendment are made in the same change: A2a, A2b and M8.10, M9.14, the W8 row (which owns the decision on what Export means on the reader path, and copies through `copyText`), G9, and RD23 answered. Its decision log also marks RD25 and RD27 as ruled (R-g).
  - The design was reviewed by three lenses (fidelity, security, implementability). All 40 findings were applied.
- **2026-10-13: the shared library's first wave.** Its L1 plan was approved by the operator and merged in the library's repository. Its first run is open and waits for a fleet slot.
- **2026-10-13: W4 merged (#381, `baba5c1bc`).**
  - **Wave-done.** The first full suite run was red only under load. Each red file (PWA 5000 ms timeouts, one `ccrc-doctor` case, one `session-hook` case) was green alone, so routing is unchanged.
  - **Review 408** (held-out panel plus the plan's five lenses, 119 agents) found 12 issues. F1 was critical: the built `markdownWorker` chunk threw `document is not defined` on load, because the worker build resolved a dependency's browser entry. Every chat message over 4 KiB would have rendered as plain text. No in-process test could see it.
  - **Fix round 1, rulings:**
    - F1: fix before merge. A worker-only resolution of that dependency's non-DOM entry, plus a test that builds for production and loads the built chunk with no `document`. The main-thread bundle is byte-identical.
    - F6: a refused chat image whose transformed source is empty (`data:`, `javascript:`, an empty source) renders its alt text as text, never an empty link. This extends D-4776, with no new number.
    - F4: M4.P12's spec mutation moves to W5's half. This extends D-4768.
    - The rest: missing cases and rows, carried items recorded truly, words, and the macOS-only `0 warned` case made `itLinux`.
  - **Scoped re-review 412** reproduced F1 fixed and confirmed every ruling landed. Its 8 minor findings are carried to W5 below. Ruled: N1's docstring nits go to W7's prose pass, as the worker routed them; suite row 06 keeps the plan's re-run format.
  - **CI** was green on every Linux leg, on the merge ref that includes #376. The macOS legs were red only in files W4 does not touch.
  - **Claims:** W4 landed second, after #353 and #376, under the scoped co-edit terms. `git merge-tree` was clean at both landings.
- **2026-10-12/13: W4 rulings during the wave.**
  - Coordinator, mail 4397: an `https:/` source counts as root-relative (D-4773).
  - Coordinator, mail 4436: a footnote label counts as a container level (D-4774).
  - Operator, 2026-10-13: before the synchronous render, chat pre-counts table cells against `DOCS_MAX_RENDER_ELEMENTS` (D-4775, review 2-3 option B). Chat shows an image only from an absolute `http(s)://` source (D-4776). This answers Q1. A chat message of 4 KiB or less with a `*`/`_` separator line of 65 or more characters renders as plain text, and that is accepted as is.
  - Q2, M5.16 against the worker's `postMessage`, stays with W6 and the Share/Export amendment.
- **2026-10-13: the shared library's L1 plan.** It is written: 12 tasks, a 77-case conformance corpus and 357 measured mutation rows. It is in the operator's review in the library's own repository. Its coordinator rulings are recorded there as `C<n>`. Ruling C2 refines a comment in this programme's spec §3.2: `render()` returns `{html, outcome, bytes, meta}`, with no overloaded empty value.

- **2026-10-01: spec approved**, with rulings U1-U5:
  - U1: a 2 MiB image cap.
  - U2: a per-view "Load external" tap for mockups.
  - U3: chat hardening, option (b).
  - U4: a required headless-browser CI leg.
  - U5: the pre-existing route defect is reported privately first, then fixed in its own PR after W3.
- **2026-10-04 to 06: W1.** Its departures are D-4150 to D-4164, issued by the allocator and defined in the W1 plan's Deviations section. The ones a later wave consumes:
  - **D-4157:** `docs-index` stops at its deadline and counts the projects it did not reach in an additive `unwalked?`. W2's adapter passes it through, and W5 renders "N not checked".
  - **D-4158:** `ref-locked` requires git's lock-file evidence.
  - **D-4159:** rc 0 beats the time bound.
  - **D-4163:** `--refmap=` and `followRemoteHEAD=never` on fetch.
  - **D-4164:** the draft phase degrades and never fails the tree.
- **2026-10-06: W1 on CI's git 2.55.** Three test assumptions held only on git 2.43:
  - the host's system filter config produces the `filters-bypassed` caveat;
  - a lazy-fetch-blocked `cat-file --batch-check` answers `<oid> missing` at rc 0;
  - the directory/file ref-conflict stderr wording changed.

  The tests are now version-tolerant, measured under 2.43 and 2.55, with no product change.
- **2026-10-06: W2 plan.** Its header lists refinements (a) to (s). Refinements (c), (d), (f) and (g) contradict the spec's text. They are defined as deviations in W2's Task 6 with the first four numbers of the block this coordinator issues at run-open.
- **2026-10-06: sharing (operator).** Fold a Share action and a self-contained Export into W5/W6. Share is the native share sheet or copy-link, carrying the GitHub permalink at the served commit. Export is a single HTML file with inlined images and scripts off. Expiring share links come later, as their own designed wave with a threat model. The design is being settled; the spec amendment follows.
- **2026-10-07: drafts in Share and Export (operator), option (b).** In a view with drafts, Export may include them under a visible "Draft, not committed" banner naming the base commit. Share always sends the committed permalink, with a warning that drafts are not included.
- **2026-10-07: U5 (operator).** Draft the private report for the pre-existing route defect. The draft stays outside tracked text until the fix ships.
- **2026-10-07: plan format (operator).** Plans stay Markdown, in this programme and every other. The HTML preference of 2026-10-06 is for specs, whose architecture decisions and diagrams engineers approve. An amendment to this programme's existing `.md` spec stays Markdown.
- **2026-10-07: W2 approved and opened.** The operator approved the W2 plan, and #306 merged it with this ledger (`a17e14bc0`). Run 315 opened for wave 2/7, with no `sessionId`, so a fresh child is minted. The allocator issued numbers **4374 to 4387** for it. They are written bare here until a plan defines them, because the floor guard reds any `D-` token above the highest defined number:
  - Task 6 Step 6 defines 4374 (refinement c), 4375 (d), 4376 (f) and 4377 (g).
  - 4378 to 4387 serve departures found while executing and in fix rounds. The worker takes them in order and lists each in its wave-done. A departure that changes behaviour the spec states goes to the coordinator as a question first.
- **2026-10-07: R1 (coordinator).** The W2 worker pushes its branch and opens the wave's one PR after Task 9, replacing the plan's "No task pushes or opens a PR" and "Push, PR and merge are the coordinator's". CI runs git 2.55 and the fleet box 2.43, and W1 met three version differences only in CI, so CI must run while the review reads. The merge stays the coordinator's, after the review.
- **2026-10-07: W2 drift, measured.** Applying the plan's whole prototype diff to `main` at `a17e14bc0` moved exactly two Find blocks; every other hunk applies, some at offsets of up to 13 lines:
  - `verb-gate.test.ts`'s `CAP_GATED_VERBS` gained `'ws-expire'` (#312). The set becomes the plan's set plus `'ws-expire'`.
  - `single-definition.test.ts`'s tail grew (#312, #299). Task 8 appends after the real last line.

  The brief rules both as mechanical re-anchors.
- **2026-10-07: claim overlap with run 302.** Claim 1073 (programme `ccrc-history`, wave 2 B1) holds `server/test/single-definition.test.ts` and `server/test/lifecycle.test.ts`. B1 only appends at the end of both; W2 appends at the end of both and edits one line in place in each (the archive door pin's `want` line, and the `../src/lifecycle.js` import). The coordinator proposed a scoped agreement to run 302's coordinator in mail 3812: each side edits only its own lines, and the second to merge takes `main` and keeps both blocks. Run 302's coordinator was busy, so W2 was dispatched before the reply. Task 1 edits neither file. Before Task 2 the worker claims the two files again, and edits them only once claim 1073 has ended or the coordinator has confirmed the agreement by mail.
- **2026-10-07 11:21 UTC: claim ruling (operator).** W2 edits the two files under claim 1073 within the proposed scope, without waiting for run 302's coordinator. W2's worker was told by mail. So were the claim's holder (the protocol's address, named by the claim's own `mailHint`) and its coordinator.
- **2026-10-07: W2's `sd-shape` invariant (coordinator).** Task 9's checker compares each commit with its parent, and two review fixes inserted lines inside W2's own appended block. Measured net against the base, `single-definition.test.ts` changes by exactly the in-place `want` line plus one end-of-file block, and the citation census is green. The FAIL is recorded as it stands, without a re-run or a checker edit. The wave-done keeps `suite: unrun`. This is not a deviation.
- **2026-10-07: W2's held-out review (run 317, tip `03826657e`).** 8 lenses, all returned. 18 findings raised, 2 survived the refute pass, 0 unexamined. Every Task 9 suite reproduced, and all 161 mutation rows red as recorded.
  - **F1, important: fixed.** Check 8 coerced a non-string `onRef`. An array passed as ok, and a throwing `toString` rejected the port's promise.
  - **F2, minor: fixed now.** Refinement (g)'s single reader of `killed` and `signal` had no scan that went red on a second reader.
  - **Settled by the review:** check 3's half-measured shape is covered by W2's deviation 4377. The second redaction pass's depth bound (4378) is beyond every failure body W1's helper emits. Thirty-two guards have no mutation row, but each went red when the reviewer mutated it, so coverage is complete.
  - **Deviations defined in W2's plan on its branch:** 4374 to 4378, written bare here until W2 merges.
- **2026-10-07: W2 fix round 1.** Commits `52a884b01`, `64ebe8351` and `2190cc43f`. 163 rows measured as expected. No new deviation.
- **2026-10-08: W2's scoped re-review (run 336, tip `2190cc43f`).** Five lenses, all returned. 23 findings raised, 17 survived, 0 unexamined. Both of review 317's findings are closed. Every suite, all 163 rows and the claim scope reproduced.
  - **F1, important: fix now.** The one-reader scan blanks comments and strings, but it has no template or regex state. A `/*` inside either literal hides a second reader on a later line.
  - **F2, minor: fix now.** Ordinary spellings evade the receiver match: an element access, a `!` after `)` or `]`, and a member chain split across lines.
  - **F3, minor: fix now.** An arrow-form `ccdEnding` scopes its body past its own end.
  - **F4, cosmetic: fix now.** One results note still says 161 rows.
  - **F5: accepted.** One re-anchored row's plan fence keeps its pre-fix text, as four earlier rows already do.
  - **Scope (coordinator, from W3): fix now.** W3's `lane.ts` reads AbortSignals (`w.signal`, `controller.signal`), and the scan reds every `.signal` read. A `.signal` read now counts only in a file that imports `lifecycle.ts`, and that set of importers is pinned. `.killed` stays checked everywhere. W3 then needs no edit to W2's scan.
  - **Also accepted:** the scan's two allowances beyond `ccdEnding`: the four `ExecResult` reads in `ccd()` and the one bound `ending.signal`. A type-aware scan was considered and not chosen, because the installed TypeScript 7 exposes only an `unstable/*` JS API.
  - **No new deviation:** each fix brings the scan into line with refinement (g)'s wording, "a read on a CcdResult".
- **2026-10-08: W2's second scoped re-review (run 337, tip `4017e8262`).** Six lenses, all returned. 24 findings raised, 17 survived, 0 unexamined. Every fix-round 2 item is closed. W3's four planned files pass the scan unedited, and an AST census found no code that the scan's blanker hides, in today's tree or in W3's files.
  - **F1, important: fix.** The rule that decides where a regex starts has an operator arm and a keyword list with no mutation row. Deleting the operator arm hides a reader behind `(s) => /x'y/`.
  - **F2, minor: fix three of four.** Importer detection on blanked text, the bare-import arm and the specifier anchor each get a row. The broken-chain tail's `!?` changes only the printed receiver, so it is accepted.
  - **F3, minor: widen three, name the rest.** A chain broken after the dot, a repeated `!`, and an import after another statement on its line are caught. Import-equals, subdirectories, re-exported types and exotic spellings are named as known evasions.
  - **F4, minor: fix.** A backslash-newline inside a string shifted later line numbers.
  - **F5, minor: fix.** The scope CONTROL is rebuilt from the W3-shaped file itself.
- **2026-10-08: the scan's evasion list is not exhaustive (coordinator).** Fix round 2 asked that list to name "exactly what still evades". A text scan cannot meet that, and each review found new spellings. The list is now "known evasions". Fix round 3 is the last on this scan. Its review checks the round's items, and any new evasion spelling becomes residue for a later wave, unless it hides a reader through a spelling already in the tree or in W3's files.
- **2026-10-09: W2 lands second after ccrc-history B1.** #315 merged first, as agreed. #319 then conflicted only at the end of `single-definition.test.ts`. The worker merged `main`, kept B1's text where `main` has it, and put W2's block last.
- **2026-10-09: W2's closure review (run 343, tip `0acbfadea`).** Every item ruled in fix round 3 is closed. The merge is clean. All suites pass, and all 189 mutation rows are red as recorded.
  - Four minor findings, carried as residue, not fixed. Two rules in the one-reader scan ship without a mutation row: the after-the-dot arm's blank-line skip, and the bare import after another statement. Both only widen what the scan catches. The other two: three docstring wording slips, and one results note that does not name W2-T5-M1's moved first red case.
  - Four new evasion spellings, none in the tree or in W3's files: U+2028/2029 in a line comment, backslash-CRLF in a string, a string-named import specifier, and a type argument's `>` before a division.
  - **Ruling:** accepted, and #319 merged at its reviewed head.
- **2026-10-09: an undispatched review run pins its work run (coordinator lesson).** Review 343 was opened and then waited on the daily cap. When `main` moved, the coordinator could not close 343 (`not-dispatched`), and that blocked sending run 315 back (`review-in-flight`). The workaround: the worker merged `main` while 315 stayed at awaiting-review. 343 then dispatched against the merged tip, and 315's fingerprint was corrected after 343 closed. Open a review run only when its dispatch can follow at once.
- **2026-10-08/09: claim agreements for W3.**
  - Claim 1105 (ccrc-history B1) on `single-definition.test.ts`: agreed by its coordinator and holder. It ended when #315 merged.
  - Claims 1115 and 1116 (box-token-lifecycle wave 1, PR #330) cover `server.ts`, `auth/gate.ts`, `auth-gate.test.ts`, `box-token-census.test.ts` and `single-definition.test.ts`. Agreed by the holder: the second PR to land merges `main`, keeps the other's routes, census entries and blocks, and re-measures every count.
- **2026-10-08: W3 approved and opened.** The operator accepted the plan ("plan accepted"). Run 342 opened with block 4464 to 4479. Task 9 Step 7 defines the first six, for (d), (i), (j), (s), (v) and (w); the other ten are reserve. A drift replay on `main` plus W2 found only Task 8's route counts moved (#320 added two routes). The brief settles that by re-measurement, and a review of the brief found six defects, all fixed before dispatch.
- **2026-10-09: W3 ruling during the wave: a WebSocket upgrade bypasses the docs headers (coordinator, mail 4082).** The root websocket plugin answers an upgrade to a docs route with a 101 before the docs plugin's `onSend`. The upgrade passes the gate and provenance first, carries no body and runs no exec, and a browser cannot reach it. It was ruled a deviation (4471), like refinement (d), and pinned by three tests.
- **2026-10-09: W3's review (run 361, tip `77862e265`).** All eight deviations (4464 to 4471) are real, with true rationales. 13 findings: four important guards had no failing case (the show shape at the route, provenance at `onRequest`, the cache-hit raster rules, two tree shape clauses). Fix round 1 also moved the lane's admission and overflow comparisons into L1, and the blob cache now copies at fill, so its charge bounds the memory it holds. The generation-map growth (about 560 B per refreshed name) stays the plan's carried item. Scoped re-review 364 was clean, and #339 merged at its reviewed head.
- **2026-10-09: W4 planned in stages (coordinator).** Ground scouts and an architect, writers that applied each task to a scratch tree, then a three-lens review with refuters and one fix pass. The stages kept the coordinator's mail gate from going deaf for hours. Four departures from the spec's text: (a) six rows written against W5 parts are proved on W4 stand-ins, and their W5 halves move to W5's brief; (b) M4.M1's plugin-order mutation cannot fail, so it is replaced; (c) `docs-sw` counts with bash builtins, not `grep -c`; (d) `docs-sw` SKIPs on either fleet signal. W4's run is open with block 4768 to 4783.
- **2026-10-09: two operator questions from W4's planning.** Q1: should chat show images only for absolute `http(s)` URLs? That is stricter than U3's root-relative and protocol-relative refusal, and closes the path-relative same-origin GET. The plan follows the spec; a ruling changes one predicate and adds a deviation in Task 10 Step 8. Q2: W6's M5.16 scan forbids `postMessage` in the Markdown code, and W4's worker files need it. The Share/Export spec amendment should exempt them.
- **2026-10-12: the W4 plan merged without a recorded approval.** #345 merged 2026-10-10 at 21:10 UTC as `995a05750`, so the plan is on `main`. Q1 and Q2 stay open; W4 dispatches with refinement (k) as written, and Task 12 carries Q1.
- **2026-10-12: a shared renderer, and ccrc's reader as the operator's docs server (operator).** Rulings, in the operator's session:
  - Each product keeps its own docs server (transport, auth, content source, hosting). The rendering (Markdown rules, the rich layout, fonts, a self-hosted Mermaid, a conformance corpus) becomes ONE public library in its own repository, pinned by exact version. Its own small programme builds it, coordinated from here, because ccrc needs it first. W4 is unchanged; W5 stays plain plus a real `<br>`; ccrc mounts the library in a sandboxed frame in a later wave.
  - ccrc's Docs reader, at ccrc's own address behind the same passkey session, replaces the standalone docs server for the operator, at feature parity.
  - The library is MIT, and named `docserver` (package `@<scope>/docserver`; the unscoped npm name is taken, and the scope is open).
  - Page URLs may carry a commit as `at=<sha>` for the version view.
  - Roots outside ccd's projects root are moved under it, as an operator step before the standalone server retires, only when no live session works in them.
  - Another viewer's coordinator confirmed the change on its side and sent eight needs, folded into the spec's §3.2.
  - The design is `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md` (approved by the operator 2026-10-12, R-g). It proposes W5b and W8 above, and amends M7.9 so that the library's exact package specifier may appear in the PWA.
  - About 14:07, in this session (R-g): the library programme starts now; the library's repo is private until v1 and public from v1; the npm scope is `@synapsium-labs`; the spec is approved as written. W5b's placement (after W5 recommended) is still open.
- **2026-10-12: W4 claims (coordinator).** Run 377 (#353) and run 354 hold four doctor files, `deploy.sh` and `installTreeFixture.ts`, which W4 edits in Tasks 9-10. Scoped terms were agreed by mail 4321 and 4324 (run 377's holder and coordinator) and 4322 (run 354's holder): each side edits only its own lines; the second to land merges `main`, keeps both and re-derives every count. A replay of W4's prototype onto `main` at `28e8dc1b2` moved only Task 10, at three file ends where box-token lifecycle landed after the plan.
- **2026-10-12: W4 ruling during the wave (coordinator, mail 4354).** Task 3's review found three shapes that pass §4.10's pre-scan and then nest the parser deeply: a tab between container markers, a fence opened inside a list item or an HTML block, and nesting continued by indentation. The backstops hold: `threw`, the depth cap and the worker budget. Ruled:
  - harden the first two (tabs column-aware; the fence skip applies only to the delimiter-run check), with cases, mutation rows and a false-refusal control. This is a departure from §4.10's algorithm text, defined with a reserve number at Task 10 Step 8;
  - reword `markdownGuard.ts`'s header to name the real bounds;
  - carry the third shape and chat's main-thread cost on a crafted message of 4 KiB or less (about 0.5 s measured) to the results and to the operator with W5's planning. Routing chat's sync path through the caps is out of W4's scope, because U3 says it renders exactly as today.
- **2026-10-08: W3 plan.** Written by a planning workflow: scouts, an architect, one writer per task prototyping on a scratch tree at W2's tip, a plan review and two fix passes.
  - **12 tasks.** Task 11 is the whole-branch review, run before Task 12's close. Task 12 pushes and opens the PR.
  - **Six departures from the spec's text,** defined by Task 9 Step 7 with the first six numbers of W3's block:
    - (d) router-level 414/400 refusals;
    - (i) the composition built in `buildServer`, with no `index.ts` edit;
    - (j) abandonment measured on the response's close;
    - (s) the latency test on a bare Fastify;
    - (v) the fetch lane's own FIFO instead of a second `KeyedQueue`;
    - (w) a JSON file reply serving the bytes check 8 verified.
  - **Why (w) counts (coordinator, 2026-10-08):** §3.5 says "wraps these answers unchanged", and the served field differs for an answer outside ccd's contract.
  - **What W3 settles:** every item W2's reviews carried to W3, and review 317's notes.
- **2026-10-07/08: two coordinator lessons.**
  - A long workflow keeps this session "busy" to the mail gate. Review 317's report sat queued for nine hours, so check mail on every wake.
  - `mail list --to <id>` lists only outstanding mail. A send that timed out and was later acked looked unsent, and was sent twice. Verify a send through the feed or `--all`.

## Carried constraints (reviewers get these)

- **Take-up residue, for the next wave that edits `pwa/src/docs/DocsHead.tsx` or `pwa/src/docs/docs.css` (review run 2132):**
  - A23: the plain-view focus effect's Page details stand-in (`?? head?.querySelector('.docs-more')`) is unreachable and unpinned; drop it or pin it.
  - A24: the effect's `if (oneBarUp) return;` hold is pinned by a case but has no mutation row.
  - A25: the plain-view note has no accessible name of its own, and what a screen reader announces when focus lands on it is unmeasured; the code comment states it as fact.
  - A26: the note's focus ring (`.docs-note[data-plain-note]:focus`) is pinned by no test.
  - A27: in the full head the ring sits flush against the truth line (0 px clearance).
- **The first rollout carrying B1 (W5b-1) is server-first (A23):** `ccrc rollout --server-first --to <tag>` for the first rollout whose tag contains B1's merge, whichever tag that is (B1's own, B2's or a later wave's). `rollout` defaults to fleet first, and a W5-era server refuses a tree holding a `vision` entry, so a fleet-first move would break every such project's tree until the server moved (W5b plan, "After each merge").
- **Required native appearance continuity (operator request, 2026-11-10):** E/F final acceptance requires the separately specified, implemented, reviewed and installed-verified shared-renderer/consumer appearance work. Same canonical ccrc skin/theme catalogue and host-selected appearance, with native visual language; not merely light/dark mode. A stays exact 1.1.0 adoption. Live-following/hosted Aa choices are coordinator defaults; API, catalogue-sharing and compatibility need a scoped design/review. This permanent gate survives replacement of the current brief.
- **Retirement drops no feature (operator ruling, 2026-10-25; #1418 and #1420):** full parity plus draft-review sharing with a lifecycle are required, not Later/Dropped. Keep outside non-repo folders, layout variants, large files, PDFs and configured tracker links; outside folders do not have to become Git repositories. Their scoped spec/leaf plans, implementations, reviews and side-by-side installed evidence must precede E/F final acceptance and operator retirement. Current committed Share/Export are not the private draft store. Existing safety caps/auth boundaries stay until reviewed extension designs replace them; never fake parity with an unsafe cap lift or unauthenticated live working-tree reads. The completion envelope's older deferrals are corrected, not an operator waiver. No standalone service/config/proxy action is authorised here.

- **Parity inventory reconciliation:** #1418's no-feature-loss promise is not limited to its five named examples. The required follow-on spec must inventory the standalone reader's capabilities against the native reader, including print and figure-overlay Back-to-close, and amend the rich-docs parity table before E closes. Those rows are not automatically waived by their older Later/Dropped labels. Old-origin state currently starts fresh under the rich-docs state contract; reconcile that recorded choice with the later no-feature-loss promise explicitly, without authorising migration here. Any genuine conflict requiring a product waiver goes to the operator before E/F acceptance. Keep the current sandbox/CSP and state boundaries until a reviewed design or explicit ruling resolves the seam; do not add allow-modals or claim a missing capability delivered.
- **Recorded draft decision:** #1420's 2026-10-25 operator comment fixes a frozen snapshot at share time, with 'newer draft available' and re-share after later edits; no live reads through the link. Do not re-ask that choice. Capability-link versus signed-in access, reviewer comments, revocation storage/retention and hidden referenced assets still need the scoped threat model/design; the no-session acceptance criterion must be reconciled with the access model, not silently discarded. Raise only genuinely unresolved product choices when their design needs them. Comments, if adopted, never count as merge approval.

- **RL-b residue, for the next wave that edits `pwa/test/reader-lab-run.test.ts`, `pwa/src/readerLab/verdicts.ts` or the reader-lab plan** (review runs 1529 and 1531):
  - **The mount hosts' scroll order is unpinned.** F-B's `isConnected` assertion covers the lab frames only. Review 1531 measured that moving `host.scrollIntoView(...)` above `stage.append(host)` in `hostIn` leaves the suite green. It errs safe: an off-screen mount cannot reach `ready`, so the Mermaid line reads "not measured". Add the same assertion to the host test's spy.
  - **One unpinned mutation.** Lowering `busyFrame`'s gap factor from 0.8 to 0.5 stays green. It moves readings only toward `shared-thread`.
  - **The page's known limits** are listed in the plan's "Carried, not fixed" (Results RL-b), for E18 to read on a phone:
    - `ready` is not proof that a figure drew;
    - Stop while hidden waits for the page's return;
    - on an engine with no second load and a cancelled `tried`, both self-navigation lines read "not measured";
    - a late `tried` can precede a cancelled navigation;
    - `mermaid()` checks a dropped or hidden mount before the over-budget check;
    - the ambient-state limits;
    - the healthy block is desktop Blink only.
- **RL-a residue, for the next wave that edits `server/src/auth/gate.ts`, `server/src/readerLab/routes.ts` or the door's tests** (review run 1468):
  - **F1, the source comments.** The "before any hook" comments omit two cases. An armed box answers a wrong-shaped write from origin `null` with `403 foreign-origin` before the session check. And on a bundle box, any method but GET or HEAD reaches no catch-all. This PR corrects the design and the README; the plan and the source comments are not corrected.
  - **F2, the never-read scan's width.** It follows only what `scan/symbols.ts` keys as a symbol of `routes.ts`:
    - a handler bound through `as` or `satisfies`, wrapped in a call, held as an object member, or imported, is not followed;
    - `req.socket` is not matched;
    - the multipart readers `req.file()` and `req.parts()` are not named.
  - **A5 to A7, plan text.**
    - A5: Task 3's and Task 4's tables carry the pre-review predictions; Results is right.
    - A6: the equal-answers case asserts neither the dark-404 / armed-401 split nor the bundle 404.
    - A7: the Results fence's failing entries start with a cut `IL`.
  - The test and census minors are listed in the plan's "Carried, not fixed" (Results RL-a).
  - **A historical mutation row.** RLB-T4-M2's `old` quotes the README's door sentence as it read before this ledger PR's A3 change. A replay reads the README at that row's commit.
- **Header residue, for the next wave that edits the phone header plan or `openLeaf`** (review run 1463: plan bookkeeping, no code finding):
  - **Counts.** Review 1463's hand re-runs counted more failing cases than the plan's results state: PHH-T4-M6 at 11, PHH-T4-M9 at 7, PHH-T4-M8 at 2 and PHH-FR-M6 at 2. Restate them from a fresh measurement.
  - **D-7958's text** should say that Task 1's code fence carries the re-open.
  - **A parse timeout is not retried.** `openLeaf` re-opens only on a `fallback`; a wave that widens the retry carries that predicate.
  - F5 (the format of fix round 2's rows) and F6 (wording) are plan text only.
- **No compressed shell copy without a server guard** (from compression's F3 and ask 302, 2026-11-04). The server sends a pre-compressed `index.html` or `sw.js` copy whenever one exists on disk; today only the build keeps them out (`assets/`-only copies and `emptyOutDir`). Any change that writes a shell copy must add a server guard first.
- **W5h-b residue, for the next wave that edits the W5h-b plan** (from review run 1434):
  - **A number's spelling.** The results bullet for review 1432's F2 (~:1165) writes `D-7891` outside `## Deviations found`; write the bare `7891`.
  - **Three quoted docstrings.** Task 2 Step 3 quotes `HIGHLIGHT_BOOT_BUDGET_MS`, `HIGHLIGHT_PAGE_WORKER_MS` and `DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS` as they read before commit 5c2184a0a; bring them to the shipped `pwa/src/lib/markdownLimits.ts`.
- **Compression residue, for the next wave that edits `server/test/pwa-static-cache.test.ts` or the compression plan** (from review run 1417):
  - **A last-listed negotiator.** The q-value case alone passes a negotiator that ignores q and takes the last listed coding; today only the refused-coding case reds it. Send both orders, or add a second case.
  - **A blank line.** The plan's `### Named, without a number` heading has no blank line above it.
- **Export residue, for the next wave that edits `pwa/test/docs-export.test.tsx` or the Export plan's results** (from review run 1406; the coordinator's rulings of 2026-11-04). W5h-b (run 1412) takes them as 7929:
  - **A direct element check.** Restore a direct check that no `b` element arises from the planted worktree segment. Today only text checks and a substring check hold the comment's claim "no element comes of it" (F2).
  - **A row for the quote.** Give the as-written assertion on the `ccrc:worktree` meta a measured mutation row: the export's one string sink in `buildExport.tsx` can write the quote raw. The plan's sentence that no single edit can do so is wrong (F3).
  - **Plan-text errata in `## Export results`.**
    - Row W5X-T13-M8 fails 3 of 11 cases, not 3 of 10; rows M1 and M2 still say 9 cases, and M1 names a renamed test (F1).
    - The browser re-run line does not reconcile 21 cases (F4).
    - 7891's "What holds it" bullet does not name the built-shell pin or the widened layer census, and its tag omits review 1405 (F5).
- **W8a residue, for W8b** (from review run 1318 and the W8a plan's "Carried, not fixed"):
  - **The pending fragment is spent too early.** It is spent when the mount resolves, which is before `ready`. A fallback raised after the mount then loses a heading deep link. Spend it on `ready`, and add a case that falls back after the mount has resolved.
  - **A same-page link spelled with its file name does not scroll the reader.** A link such as `this.md#sec` routes to `hash` and only rewrites the address bar. Fixing it needs either an in-frame `#id` re-issue or a scroll op on the host, plus a test of what actually moves.
  - **An overlong image `src` drops the whole doc to the plain view.** That happens when the `src` passes the library's 2048-code-unit seed limit. Leave such a ref out, in W8b or in W6 with the planner.
  - **The copy check never runs against the real library for U+202E and U+200B.** Add one case through the real mount, or a browser copy tap.
  - **One browser sub-case cannot fail.** The `hash` sub-case of the `M8.B5 parent.postMessage` row cannot fail. Assert `location.hash`, and add a positive case through the port.
  - **The browser battery's control gaps:**
    - the meta-only row measures 26 channels against the frame's own policy;
    - in the default browser, the second-load row credits the shell meta with a block that Chrome's local-network checks also make;
    - in the navigated-child control, the wrong-nonce `ready` comes last;
    - the `parent.postMessage` navigate case has no control;
    - the navigated-child control (`M8.B5 control`) waits a fixed 500 ms after the frame settles for the child's hello. It failed once in the merge queue on 2026-11-04 while the next group passed it; wait on the hello with a timeout instead.
  - **Smaller items:**
    - the render job's budget also covers the first lazy import of the renderer chunk;
    - the `window` and `globalThis` owners of the window-message scan have no planted control;
    - M7.9's position check is a line-prefix scan, so JSX text passes it;
    - some header comments still say "two sheets";
    - the comment in `assets.ts` overstates what the guard covers;
    - `ci.yml` and the plan word the need for `attestations: read` differently;
    - `policy.ts` imports a type from `DocLink.tsx`, and `docLinkTarget` through a hook module;
    - `images.ts` (L3) imports `DocImage.tsx` (L4), which W6's planner replaces.
- **W3's accepted residue, from its plan:**
  - The fetch lane's generation map grows by one short entry per distinct project refreshed. It is session-gated and cannot be pruned safely.
  - `policy.ts`'s `lowerAscii` duplicates a private L0 helper. It is pinned by a parity case and goes to W7.
  - The second redaction pass rewrites values, not key names. This is latent, and the fix belongs to L3.
  - The `JSON.parse` cost inside `ccdsource.ts` is deferred.
- **W2's parked minors** are in its SDD ledger, and none blocks W3.

- **SEC-3:** a helper killed from outside leaves git's process group running. W2 pins the budget invariant, so ccd is never killed in normal operation. The real fix is unscheduled.
- **SEC-4:** fetch stamps accumulate, one per distinct branch name (W5 housekeeping).
- **No stamp after a failed post-fetch for-each-ref** (W5).
- **`branch: null`** covers both a detached HEAD and an unmeasured read (W2 adapter and W5 rendering).
- **Closed (#627):** `GithubTarget` now expresses `resolveDocRef`'s `repo` kind (`repo` and `root`, M3.16-M3.18); see Decisions, 2026-11-02.
- **A commit missing from a partial clone** answers `git-failed {step:'cat-file'}` on git 2.43 and `unknown-commit` on 2.55. W2 carries it in its results and does not close it.
- **Over-cap `too-many-entries`** reports `bytes` measured on a stripped body.
- **W7 prose residue:**
  - stale `ccrc-doctor-checks` citations in `ccd/ccrc` that predate W1;
  - `deploy/account-op.mjs:586` cites `:166`, which W1 moved to `:173`;
  - spec §7.2's two python3 / placement sentences;
  - the lockAgeMs prose in the spec;
  - docs-shared's claim about two refinements;
  - the dropped clause "git 2.43 ignores the key".
  - README's doctor table has no row for W1's `docs` check, and its server-role SKIP sentence (the D-3111 list ending "`timeout` and `model-default`") does not name `docs`, although `_check_docs` SKIPs on a `CCRC_ROLE=server` box (reported by another session in mail 3818, 2026-10-07; README is under another programme's claim, so W7 places it).
- **W2's one-reader scan residue** (review 343): two unpinned widening arms, three docstring wording slips, the W2-T5-M1 note, and four evasion spellings to add to its "Known evasions" list. This is for the next wave that edits `docs-source.test.ts`, or for W7.
- **W3 residue:** two Task 12 tool texts and one Notes count (review 364); the plan's Task 4 Decision 1 text against the moved L1 verdicts; W2's closed plan rows anchored on `laneAdmit`'s old inline clause. For W7's prose pass: the `coord/store.ts` and `coord/close.ts` comments that say no `app.setErrorHandler` exists, §5.3's "every docs response", which should name the router-level and upgrade escapes, and W4's two stale comments (`pwa/src/lib/api.ts`, `server/test/sourceScan.ts`).
- **W4 residue for W5** (review 412, minor):
  - R1: pin both halves of the dev alias's scope (`serve` only, never under vitest), with a row each.
  - R2: correct the words of the docs-sw `/wiki/docs` case, which pin the RegExp's `/^` and not the ERE's `^`.
  - R3 and R4: re-record the measured `red` lines of W4-T11-M52 to M55, M58 and M59, and of W4-T6-M5.
  - R5: give the hook's commit-to-effect window its own Carried entry with a measured example. It is W4's own code, not pre-existing.
  - R6: two stale comments, `vite.config.ts` ("below") and `markdownWorker.ts`'s quoted `worker:` literal.
  - R7: reword `markdownGuard.ts`'s `table-cell`. Tailwind scans it and ships an unused `.table-cell` rule.
- **W4's carried items** (its results' "Carried, not fixed", inherited by W5's brief):
  - nesting continued by indentation (shape (c));
  - the sync path's cost on a crafted message of 4 KiB or less;
  - review 1-4;
  - the 2-2 residual (per-span keystroke cap, about 204 850 elements from a 205 KB message);
  - N1's minors;
  - M4.P12's "count only after render";
  - r10 and r11. highlight.js is quadratic on one long identifier run, and `keystrokeParts`' split is quadratic on a long whitespace run. Both are pre-existing at base, and W5's page inherits them through the shared components.
    - (2026-10-15) W5h closes the highlight.js half by moving highlight.js off the main thread. r11 stays with part 1's keystroke bounds.
  - Review 5-2 goes to W7. W6's M5.16 carry stands.
- **W7 prose residue from W4:**
  - `ccd/ccrc-doctor-checks`' table line for `auth box-token` says `_check_box-token` is at the END of the file, which is no longer true.
  - N1's docstring nits.
- **U5:** the private vulnerability report is not filed yet. The spec's one-line mention is public since #301.

## Binding carries from the extension designs (coordinator, 2026-11-19)

Each carry lands as a design-text commit: the first item of the named wave, before that wave's code, and reviewed in that wave's review. The wave's brief quotes it.

### To the first wave cut from a base that has #3026 (ask 600): P1, run 2743

- Row `W4-T10-M10`: its recorded count is 3 failed, but it measures 2 failed. Re-measure it once and drop the third red name.
- D-8730's clauses "the next Tab follows the one bar's order" and "the one bar's layout and order are unchanged": name each as pinned (say by which row) or as descriptive only. Do not change D-8730's text.

### X1 (appearance): landed by X4 (#3055)

X4 folded every X1 carry into X1's own spec and plan before the library programme plans its wave:
- the Mermaid covered-kinds constant and its derivation;
- author-styled figures keeping the plate;
- the colour-only states;
- test 8;
- the CSP and op text;
- wave C's F5, F6, F7, A2, A3, A7 and A9 (1).

Wave L plans from X1's text on `main` after #3055, not as it was at `89a9ce02a`. X2's share is set: 1 166 336 characters in total, 72 704 for the largest frame.

### X2 (parity)

- **First item of P1, the render gate.** A Markdown document above the 512 KiB render gate (`DOCS_RENDER_GATE_BYTES`) is read in parts no larger than the gate. Each part mounts rich and prints through the same render job.
  - Inventory row F2 becomes a Gap closed by P1.5, and the counts and In short move.
  - §4.3's "a part of up to 2 MiB renders as its own mount" is corrected.
  - PL3 becomes "every part prints, each parsed under its budget".
  - P1.5's part-id pre-pass uses parts of at most gate size.
  - P6.1 tests 524 287, 524 288 and 524 289 bytes, and the 2 MiB and 3.4 MB fixtures.
  - If a part at the gate cannot render within budget on a phone (measure it), stop and ask.
- **P5.3.**
  - The forward-skip trap at the top of history: `lastIdx` updates on a skip, with a stale-places test.
  - `reader-history-adapter.test.tsx`'s case 8b joins P5.3's characterization commit.
  - M11.73's test is extended to what only the visit's end decides.
  - A1's skip-loop bound and counter seeding.
- **P1.5.** The page pin of a stat-pinned draft between the listing and the prepare: `pinFor` must not throw. P1.5's Files name `useDocsVisit.ts`, `docsLinks.ts` and Share's `samePin`.
- **P1.2, P2.1 and P2.2.** `ccdCapTokens.ts`, `ccd-archive.test.ts` and the `docs-parity` `H.VERBS` case go in the Files of the waves that add cap tokens or helper verbs. P2.2 also takes:
  - M11.72, pinned to a case only admission catches;
  - a `docs-folder` parser that refuses a second mode.
- **The library wave and P5.5.** The print design for the review strip's waiting list and the plan chips. X4 writes the library half.
- **Each owning wave.**
  - `markdown-purity`'s `ROOTS` gain `printAllow.ts` and `trackerLinkJob.ts`.
  - `TRACKER_ACK_DEADLINE_MS` is worded consistently, with a queued-arm test.

- **P2 (placed 2026-11-20): the docs-fetch lock wording.** On git 2.53, a held ref lock is worded "error: fetching ref … failed: reference already exists", with neither "cannot lock ref" nor the ".lock: File exists" evidence that ccd's `FETCH_LOCK_MARK` and `FETCH_LOCK_EVIDENCE_RE` need (measured on 2.43). So `docs-fetch` answers `fetch-failed` where it should answer `ref-locked`, and `ccd-docs-fetch`'s four ref-locked cases fail on the fleet box. P2, which touches ccd's docs verbs, gains a step that recognises both wordings, with a case per git version's wording and a mutation row.
- **Carries from P1's review rounds (landed in #3102), each a named step in X2's plan:** P6.1 Step 0b2 (the parser-backed Markdown cutter: residual classes 1 to 9 as red cases, zero violations on the full fuzz mix as its bar); P6.1 (GATE-L1's desktop Chromium leg); P3.2 Step 6 (the late Download answer's guard, keyed by the tap); P2.1 Step 0 (the doctor's `docs-range-v1` line). The render gate's phone leg is the coordinator's device item.

### X3 (draft review): one design-text commit, the first item of R1

- **The owner warning.** The revoking state and the 503 `not-durable` answer say plainly that the revoke is not yet permanent, and that the owner must revoke again if ccrc restarts before its disk recovers. An R3.4 row pins the sentence. An R1.3 row pins the residual itself: every act fails, then close, heal and re-open, and the share is live.
- **The residual's bound** is any stop while the disk still refuses. Qualify spec :10, :43, :183, :211 and :238 accordingly.
  - "Tombstone landed, both unlinks failed" answers `ok`.
  - A 200 may precede the bytes unlink, which is safe.
- **The service-worker denylist** is spelled `/^\/review(?:\/|\?|$)/`.
  - `fonts-built.test.ts` joins R2.2 Step 4.
  - Check that the Vite input key builds `index`.
- **M-X3.16's font** is measured in the mockup copy's nested frame. The PNG, font and stylesheet assets are committed beside the fixture pages.
- **R2.3** gains red-first, implement and run steps for:
  - lab mode;
  - `labFixture.ts` and its test;
  - the lab rows;
  - the reader-lab anchor and its census entry;
  - the scan allowance.
- **Rasters' decoded bytes** are scanned as Latin-1. The tEXt row must count 1, and R3-M9 becomes "cut rasters unread".
- **D-8767's quotes.** It gains the `default-src 'none'` clause (base M5.16, rich-docs A2b). The Export-confinement quotes land with R2: base §5.4 :2836, §5.6.9 :3106 and M5.16's parenthetical :3179.
- **Deps seams.** A deps seam for the store, `ReviewFs` and the PWA root. `server/src/deps.ts` goes in R1's Files, and `server/src/server.ts` in R2's.
- **Mutation rows.**
  - R1-M47 is deleted, or the full pass is made observable.
  - The view is recorded after the bytes start.
  - R3-M20's fixture is a version-1 first create.
- **Smaller items.**
  - One `{date}` formatter, in L0.
  - A re-share keeps `pinned`.
  - Figure 2 gains its missing edges.
  - `lost`'s doc covers both causes, and a revoked share never reads as unreadable.
- **Run-open conditions.**
  - R1 waits for the operator's confirmation of asks 595 and 603.
  - R3 waits for the M-X3.16 device item, and names `DocsHead.tsx`, `DocsIndexView.tsx`, the control census, the tap-target floors and the residue A23 to A27.

## Current next-wave briefs — R1 and L2 landing B2, runs 2949 and 3249

R1 is wedged; L2's landings A and B1 landed, and B2 is building (Decisions, 2026-11-22 (early)).

### R1 — run 2949

Opened 2026-11-20 on P1's landing, briefed as written below; its dispatch waits for a fleet slot (Decisions, 2026-11-20 (day)).

Programme `native-docs-reader`, wave 32 = R1: X3's first draft-review building wave, the server's read side. Run 2949. Deviation block issued: 8835, 8836 and 8837.

The operator approved X3's design on 2026-11-19 and confirmed asks 595 and 603: a capability link with no session to read, and comments from signed-in sessions only. This wave builds X3's Wave R1. Read the whole of `docs/superpowers/plans/2026-11-18-native-docs-draft-review.md`: its Global Constraints, Review Focus, "Waves and file ownership" and Tasks R1.1 to R1.5. Then read the matching sections of `docs/superpowers/specs/2026-11-18-native-docs-draft-review-design.md`, and the ledger `docs/superpowers/programs/native-docs-reader.md`, section "Binding carries from the extension designs", X3. Every item there is binding.

**Your base is `main`, now that X2's P1 (#3102) has landed.** You share `shared/docs.ts`, `server/src/server.ts`, the auth-gate and box-token-census tests and the rings data with it. Read its shapes as merged: `DocPin` and `DocListPin`, the range door in `DOCS_DOORS`, and the route counts in `auth-gate.test.ts`.

**First item, before any code: one design-text commit, docs only.** Apply the ledger's X3 carries to X3's spec and plan, as the ledger states them:
- the owner warning and its R3.4 and R1.3 rows;
- the residual's bound, with spec :10, :43, :183, :211 and :238 qualified;
- the service-worker denylist spelling, and `fonts-built.test.ts` in R2.2 Step 4;
- M-X3.16's font in the nested frame;
- R2.3's added steps;
- rasters scanned as Latin-1, with R3-M9 renamed;
- D-8767's added quotes;
- the deps seams: **`server/src/deps.ts` joins R1's Files**, and `server.ts` R2's;
- the mutation-row items (R1-M47, the view after the bytes start, R3-M20's fixture);
- the smaller items (one L0 `{date}` formatter, a re-share keeps `pinned`, Figure 2's edges, `lost`'s doc).

**Then R1.1 to R1.5, red-first, as the plan writes them.**
- D-8765's amendments land in R1.5 (the plan's release order).
- R1 can create no share. Tests seed the store through its own interface, so an R1 release hands out no link.
- A later wave, X5's A1, will reuse R1's token grammar from `shared/docsReview.ts`. Build it as R1's plan says. Do not generalise it ahead of A1.

**Claims.** Claim every file before its first edit. Check `ccrc-api claims list --project ccrc-pwa` for `server/src/server.ts`, `server/src/auth/gate.ts`, `server/src/deps.ts`, `server/src/config.ts`, the auth-gate and box-token-census tests and the rings data. Ask a holder through the peers rules (`ccrc-api peers list --of <you>`). If a file is held, tell me which task waits on which claim and work the free tasks meanwhile. Edits to a file another run holds are additive and granted, never assumed.

**Working rules, to the letter. A breach is a stop: report it to me before you continue.**
- File text goes through the Edit and Write tools only, for you and every implementer: no heredoc, no redirect into a file, no `sed -i`.
- Every test, compile or measurement runs as its own call starting `ccrc test --`, in the foreground, with a timeout of at least 600000 ms. Never two at once, never chained, never piped.
- Fixture HOMEs only. A new ccd test spawns through the three poisons.
- Mutation rows are measured red, one at a time, and restored from a saved copy, never by `git checkout`. Every new guard ships with a test that reds when it is deleted.
- The box's work disk is at 85%. Make no repository copy, no new worktree and no install beyond your workspace's own, and keep scratch small and in your temp root.

**Standing boundaries:**
- The reader sandbox stays exactly `allow-scripts`, and the shell CSP `frame-src 'none'`.
- Both 2026-11-06 phone blocks stay byte for byte.
- The library stays pinned at 1.1.0.
- The store is `~/.ccrc/review-shares/` (0700, files 0600), with one writer. It is never in `ccrc backup` or the update snapshot.
- The read door is class 9 in `gate.ts` with its own reason. No other door opens, and every census names it.

**Public repository:** neutral names only. Run the private-name scan over every changed file and every commit message before your push.

**Deviations:** a departure from an approved spec gets the next number of your block, defined in X3's plan's "Deviations found", quoting the sentence. A departure from an operator ruling is not yours: ask. When the block is spent, ask me for more.

**Asks:** a product choice goes to me as a structured ask, with your recommendation. A technical choice is yours: decide it and record why in Results.

**Stop and ask:**
- any widening of the boundaries above, or a door no census names;
- an edit to a file another run holds, without its holder's leave;
- a refusal from any hook or route (report it, then wait for my word before any other form of the same act);
- a measurement that fails its stated budget.

**Routing (clause 13):**
- Main loop: Opus · high.
- Implementer subagents: Sonnet · high for the store, the read door, the gate and the census; Sonnet · medium elsewhere.
- One Opus · high review subagent over each task's diff before its commit.
- Every Agent call names its model and effort literally, never Fable. Workflow off.

**Delivery:**
- Commit on `ws/<your slug>` only. One PR, with the trailers in one final paragraph and `Ledger-Edit:` on every head that edits a plan.
- Results go in X3's plan.
- List mail before your push, and push once.
- Then get the exact-tip required checks, the ledger guard and CodeQL green, with 0 open alerts, and send your wave-done with the fingerprint JSON and the suite and failure lines.
- Never enqueue or arm auto-merge.

### L2 landing B2 — run 3249 (the library's repository)

Programme `native-docs-reader` (home project ccrc-pwa), wave 36 = L2 landing B2: the shared rendering library's `review` and `guided` layouts. It is built in the library's own repository (project `docserver`, GitHub `Synapsium-Labs/docserver`, PUBLIC; the package is `@synapsium-labs/pinax-lib`). Run 3249, ticket `lib-l2b2`. Deviation block issued: 8881, 8882 and 8883.

Landing B1 merged as library PR #89 (merge commit `f46f49877`): Task 0, Task 9's layout infrastructure, `classic` and `editorial`, with B1's part of Task 14. Your base is the library's `main` at `f46f49877` or later. B2 is the second of the two landings I ruled: the `review` and `guided` layouts, and Task 14 for B2. The release and its signed tag come after the release-readiness wave, and are the operator's.

**Your input:**
- **The library's leaf plan on `main`:** `docs/superpowers/plans/2026-11-20-docserver-parity-additions.md`. Read Design §3 (the split), choices B11 and B12, Tasks 9 to 14, Results and Departures as B1 left them, and the B1/B2 split. B1's notes (`docs/superpowers/programs/docserver/parity-layouts-b1.md`), scrub audits and mutation files show the conventions.
- **ccrc's design, read from the home repository** (homeRepoRoot `<projects-root>/ccrc-pwa`, planSha `09e66b1a8fbff59b22de2ada1e7cbefe2475d807`):
  - X2's spec `docs/superpowers/specs/2026-11-18-native-docs-parity-design.md`, §6's layout rows and §4.2;
  - X1's spec §10, through D-8827: the appearance contract, test 8's layout row, test 9's CSP row and test 10's cues.

**Scope:**
0. **First, in its own commit, test-only: two races B1's last CI run met at an unchanged head** (run 44983402840, attempt 1, Node 22). Both passed on every earlier run of the same code.
   - `layout-corpus.test.ts`, `layout editorial > webkit > rail/plan-marks`: the snapshot caught the scroll-spy's first activation (`li .open`, `a .active aria-current="location"`) that the expected file lacks.
   - `rail.test.ts`, chromium, "keeps the full-width topbar before the float and after scrolling at both desktop widths": `source.width` was 348 over, so the float had not settled.

   Make each wait on a settled state, measured deterministically, as B1's cue and B8.2 fixes did. Never use a timing gate, never loosen an assertion, and move no snapshot. Apply the same wait to every layout's corpus case, the new ones included. Each fix gets a mutation row, and the record names both runs.
1. Tasks 12 and 13 as the plan writes them (`review`, `guided`), on B1's infrastructure: `frameCsp(layout)`, `maxSrcdocChars(layout)`, the per-layout feature list, corpus directories and ratchet rows. Extend those mechanisms; do not fork them.
2. Task 14 for B2: the size row, the README, the CHANGELOG, B2's notes, and the plan's record (Status, Results and Departures for Tasks 12 to 14, mutation files with their JSON fences, measured).

**Not in scope:**
- landing A's follow-ups (the host race, the corpus's print-run state, the byline's Range, Selection and observer, `changesBase` on the wire, the Safari byline cost);
- Classic's phone chips without a coarse 44 px floor (carried to the release-readiness wave);
- LX6, the release-gate measurements, and any version bump.

**What B1's three review rounds settled, and B2 keeps:**
- **Pointer rules.** X1 §10 applies the control row under `(pointer: fine)` only, and a coarse pointer keeps the 44 px floor. The guard that walks each layout's stylesheet covers both new layouts, with a row each.
- **A guard that cannot fire may not stand.** Every new guard gets a mutation row that reds when the guard is deleted. Never write a guard that a module-load failure or another row already makes unreachable.
- **Hashes:** after any asset change, regenerate the CHANGELOG hash bullets from the built manifest before you push.
- **Records:** the plan's Results, the mutation fences, the notes and the PR description give the counts at the final tip. The description cites the exact-tip run.
- **Trailers:** one final paragraph. A `Ledger-Edit:` cites an issued "ccrc D-n" from your block, or is left out; never a placeholder.
- **Tests:** deterministic waits (a settled reveal, `scrollY === 0`), never timing gates. `enhance-plans-rf3`'s timing ratio is a known flake on Node 24; report it, never chase it.

**Size: test 8 holds this design to its shares, read from the shares table at the first parent.**
- Each new layout's assets stay within the default enhance bundle at your landing (the layout row).
- **The bootstrap budget, 32 768 bytes, is never raised.** Map each layout's state onto the existing `DOC_FIELDS` and `pref:ui`. If anything would take the bootstrap past 32 768, or a measured row past either share, stop and send me the numbers and your options before you trim.
- Exactly one `Size-Design: x2` line, in the PR description.

**Bridge discipline, unchanged:**
- every addition rides the existing port, host parser and `BRIDGE_LIMITS`, and the bridge stays version 1;
- `frameCsp(layout)` emits only that layout's hashes;
- no layout adds a channel, a window listener, parent-DOM access or a CSP source of any other kind.

**The scrub.** Every operator-specific default in a reference layout is scrubbed into an off-by-default option or dropped, each recorded in that layout's scrub audit. No host, account, workspace or product name may stand in a source, asset or snapshot. Public files state process notes neutrally.

**Standing rules, for you and every subagent:**
- one test command per Bash call, no loops or chains;
- files are written with the file tool, never prose in a heredoc;
- a hook refusal stops the subagent, which reports the refusal's text;
- an implementer's claim of an edit is checked against `git diff --stat` before it counts;
- mutation counts are recounted from the JSON fences in the final commit;
- guards on cost are structural counts, never timing gates.

**Measure, don't recall.**
- CI runs Node 22 and 24, with real Chromium and WebKit, in about 36 minutes.
- Run affected files locally in the foreground, through `ccrc test --`, one per call, with a timeout of at least 600000 ms.
- A timeout under the slice's memory kills, with no assertion mismatch, gets one isolated rerun; then record it as unmeasured and let CI on the exact tip arbitrate.
- WebKit cannot run on this box. For a WebKit-only question, one push per CI cycle is accepted; list mail before each push.
- Use your workspace's own install and the cached browsers. Make no repository copy and open no extra worktree.

**Departures:** a sentence of §6 or §10 you cannot build as written is a stop-and-ask to me, quoting the sentence and your proposal. Never write a D-number in the library's repository: cite ccrc's numbers as "ccrc D-n" only.

**Stop and ask:**
- any widening of the frame's sandbox, CSP or channels beyond §6;
- a size-share, layout-row or bootstrap breach;
- an edit outside the library repository;
- a refusal from any tool, hook or route: report it, then wait for my word.

**Routing:**
- Main loop Opus · high.
- Implementer subagents Sonnet · high for `frameCsp(layout)`, the contrast gate and any guard; Sonnet · medium elsewhere.
- One Opus · high review subagent over each task's diff before its commit, given the diff and plan inline and told not to invoke any skill.
- Every Agent call names its model and effort literally, never Fable. Workflow off.

**Delivery:**
- Claim every file before its first edit, and commit on your workspace branch only.
- One PR to `Synapsium-Labs/docserver` `main`, with the trailers in one final paragraph.
- List mail before your push.
- Get the exact-tip test (22) and test (24) green, then send the wave-done with the fingerprint JSON and the suite and failure lines.
- Never merge, enqueue or arm auto-merge.

## Earlier briefs — L2 landings A and B1, runs 3007 and 3179 (landed as library PRs #88 and #89)

### L2 — run 3007 (the library's repository)

Programme `native-docs-reader` (home project ccrc-pwa), wave 34 = L2: the shared rendering library's parity additions. It is built in the library's own repository (project `docserver`, GitHub `Synapsium-Labs/docserver`, PUBLIC; the package is now `@synapsium-labs/pinax-lib`). Run 3007. Deviation block issued: 8867, 8868 and 8869.

The operator approved X2's design on 2026-11-19. L1 (the appearance contract, #86) and the rename (#87) have landed. Your base is the library's `main`, at `bee0fd1ec` or later. The release and its signed tag come after this wave, and are the operator's.

**Your input is ccrc's design, read from the home repository:**
- homeRepoRoot `<projects-root>/ccrc-pwa`;
- planSha `5041cf173339e83100de883a1efb326254e2c57f`;
- **X2's spec, §6 "Library side", in full, and §2.3:** `git -C <projects-root>/ccrc-pwa show <planSha>:docs/superpowers/specs/2026-11-18-native-docs-parity-design.md`. §6 includes the change table, the size share and its estimate table, and print mode's strip and plan marks.
- **X2's plan,** for the consumer side your interfaces must serve: wave P5 and its tasks P5.1 to P5.5, and P6.1's print stage 1. `git -C <projects-root>/ccrc-pwa show <planSha>:docs/superpowers/plans/2026-11-18-native-docs-parity.md`.
- **X1's spec §10,** amended through D-8827: the appearance contract every layout must keep, test 8's rules and test 9's CSP row.
- **X1's plan,** section "Library input (X4)": the X2 items X4 carried into the library wave.
- The library's own `CLAUDE.md`, its programme ledger, and L1's plan `docs/superpowers/plans/2026-11-20-docserver-appearance-contract.md`, for the conventions and test 8's tables as they now stand.

**Scope: §6's change table, all of it:**
- the four layouts beside `default`, with `frameCsp(layout)` and test 9's CSP row re-pinned per layout;
- every layout on the appearance slots and the pairs' contrast gate, with conformance and contrast run per layout, and each layout's srcdoc held to its own cap;
- the item values from `render`, and the seed's resolved item links;
- `place {kind: 'overlay' | 'overlay-closed'}`, `push` and `from` on `hash`, and `close-overlay` and `goto`;
- `print-figures` and `print-figure`, with every per-op cap enforced by the host parser before any decode;
- the In short "Headlines / Full" option and the comparison-base seed field;
- print mode in `render`, with its print stylesheet under one root class, including the strip and plan marks and their conformance fixture.

Not in scope:
- **Reader mode's library part, LX6** (the `reader` op and screen pages): a later wave of its own.
- **Any version bump.**

**Size: test 8 holds this design to its shares,** read from the shares table at the first parent: `x2` 1 166 336 characters in total, and 72 704 for the largest frame.
- Every landing that changes a frame asset carries exactly one `Size-Design: x2` line in its description.
- Every new layout's assets stay within the default enhance bundle at your landing, which is test 8's layout row.
- If a measured row would exceed either share, or a layout cannot keep the layout row, stop and send me the numbers.

**One PR, or a planned split.** First write the leaf plan, `docs/superpowers/plans/2026-11-20-docserver-parity-additions.md`, in the library's plan shape: Status, Goal, Architecture, tasks with Files, interfaces, red-first steps, mutation rows and Results. Name ccrc's specs by their public GitHub paths, never by a local path.
- If the plan is too large to review as one PR, propose a split into two sequential landings in a mail to me before you implement, for example the ops, items, In short and print figures first, then the layouts and print mode.
- Each landing carries its own `Size-Design: x2` line. I rule on the split.

**Then implement it, task by task, red-first.** Every guard gets a case that reds when it is deleted, measured.

**Departures:** a sentence of §6 or §10 you cannot build as written is a stop-and-ask to me, quoting the sentence and your proposal. Never write a D-number in the library's repository; ccrc's numbers are recorded in ccrc, and the library cites them as "ccrc D-n" only.

**Bridge discipline (§6):**
- Every addition rides the existing port, the existing host parser and `BRIDGE_LIMITS`, with the per-op caps §6 names, and the bridge's version stays 1.
- None adds a channel, a window listener, parent-DOM access or a CSP source.
- New ops are sent only when the seed says the host accepts them, so a 1.1 host never counts them as refused.

**Measure, don't recall.**
- The library's CI runs Node 22 and 24, with real Chromium and WebKit tests, in about 36 minutes.
- Run affected files locally in the foreground, through `ccrc test --`, with a timeout of at least 600000 ms, one at a time.
- The shared test slice's memory cap kills browser workers on this box. A timeout under its kills, with no assertion mismatch, gets one isolated rerun; if it still times out, record it as unmeasured locally and let CI on the exact tip arbitrate.
- When the harness moves a waiting call to the background, wait for its completion notice and read its full output.
- Use your workspace's own install and the cached browsers. Make no repository copy and open no extra worktree.

**Public repository:** no private name, host, path, account or tracker in any file, commit message, PR title or body. Run a private-name scan over every file and commit message before your push.

**Asks:** a product choice goes to me as a structured ask with your recommendation. A technical choice is yours: record why in Results.

**Stop and ask:**
- any widening of the frame's sandbox, CSP or channels beyond §6;
- a protocol change beyond §6's ops;
- a size-share or layout-row breach;
- an edit outside the library repository;
- a refusal from any tool, hook or route (report it, then wait for my word).

**Routing (clause 13):**
- Main loop Opus · high.
- Implementer subagents Sonnet · high for the bridge ops and their parsers, the CSP and `frameCsp(layout)`, `print-figures`' caps and the layouts' contrast gate; Sonnet · medium elsewhere.
- One Opus · high review subagent over each task's diff before its commit. Give it the diff and the plan inline, and tell it not to invoke any skill.
- Every Agent call names its model and effort literally, never Fable. Workflow off.

**Delivery:**
- Claim every file before its first edit, and commit on your workspace branch only.
- One PR to `Synapsium-Labs/docserver` `main`, or the first of the planned two, with the trailers in one final paragraph.
- List mail before your push, and push once.
- Get the exact-tip test (22) and test (24) green, then send wave-done with the fingerprint JSON and the suite and failure lines.
- Never merge, enqueue or arm auto-merge.

### L2 landing B1 — run 3179 (the library's repository)

Programme `native-docs-reader` (home project ccrc-pwa), wave 35 = L2 landing B: the shared rendering library's four layouts. It is built in the library's own repository (project `docserver`, GitHub `Synapsium-Labs/docserver`, PUBLIC; the package is `@synapsium-labs/pinax-lib`). Run 3179. Deviation block issued: 8878, 8879 and 8880.

Landing A merged as library PR #88 (merge commit `1c2120d93`). Your base is the library's `main` at `1c2120d93` or later. Landing B starts from A's landing, so each layout is measured against the default bundle at that commit. The release and its signed tag come after this wave, and are the operator's.

**Your input:**
- **The library's leaf plan on `main`:** `docs/superpowers/plans/2026-11-20-docserver-parity-additions.md`. Read Design §3 (the split), choices B11 and B12, Tasks 9 to 14, Results' "Landing B's bootstrap estimate", and its process notes. Landing A's mutation files and notes show the conventions.
- **ccrc's design, read from the home repository** (homeRepoRoot `<projects-root>/ccrc-pwa`, planSha `09e66b1a8fbff59b22de2ada1e7cbefe2475d807`):
  - X2's spec `docs/superpowers/specs/2026-11-18-native-docs-parity-design.md`: §6's layout rows (`frameCsp(layout)`, per-layout conformance, contrast and srcdoc caps) and §4.2;
  - X1's spec §10, through D-8827: the appearance contract every layout keeps, test 8's layout row and test 9's CSP row.

**Scope:**
1. **Task 0, first, in its own commit:** the build's free-globals comparison becomes insensitive to which minified name an alias gets. It must compare the set of free globals and pinned names, never alias spellings. Landing A's Tasks 3 and 6 both hit that tie. This is a change to the build's safety tooling, so:
   - each case it must still refuse (a new free global, a missing pinned name) keeps a red mutation row;
   - one row reds when the comparison is made alias-sensitive again.
2. **Tasks 9 to 14 as the plan writes them:** layout infrastructure, then `classic`, `editorial`, `review` and `guided`, then landing B's size row, README, CHANGELOG and notes.

**Not in scope:**
- landing A's other follow-ups (the host race, the corpus's print-run state, the byline's Range, Selection and observer, `changesBase` on the wire, and the Safari byline cost): a later library wave;
- LX6, reader mode's library part;
- the release-gate measurements;
- any version bump.

**One landing, or a split you propose.** The plan offers four landings. After Task 9, if one PR would be too large to review, mail me a split into at most two landings, for example Tasks 0 and 9 with two layouts, then two layouts with Task 14. Each landing carries exactly one `Size-Design: x2` line. I rule.

**Size: test 8 holds this design to its shares, read from the shares table at the first parent.**
- Every new layout's assets stay within the default enhance bundle at your landing (the layout row).
- **The bootstrap has 28 bytes left (32 740 of 32 768), and its budget is never raised.** Map each layout's state onto the existing `DOC_FIELDS` and `pref:ui` wherever you can. If a new doc field, or anything else, would take the bootstrap past 32 768, stop and send me the numbers and your options before you trim anything. Landing A's host-side moves, (b'), are the pattern.
- If a measured row would exceed either share, stop and send me the numbers.

**Bridge discipline, unchanged from landing A:**
- every addition rides the existing port, host parser and `BRIDGE_LIMITS`, and the bridge stays version 1;
- `frameCsp(layout)` emits only that layout's hashes;
- no layout adds a channel, a window listener, parent-DOM access or a CSP source of any other kind.

**The scrub.** Every operator-specific default in a reference layout is scrubbed into an off-by-default option or dropped, each recorded in that layout's scrub audit. No host, account, workspace or product name may stand in a source, asset or snapshot.

**Standing rules from landing A, for you and every subagent:**
- one test command per Bash call, no loops or chains;
- files are written with the file tool, never prose in a heredoc;
- a hook refusal stops the subagent, which reports the refusal's text;
- an implementer's claim of an edit is checked against `git diff --stat` before it counts;
- each commit's trailers sit in one final paragraph, and a moved-trailer only names a case that moved;
- mutation counts are recounted from the JSON fences in each round's final commit;
- guards on cost are structural counts, never timing gates.

**Measure, don't recall.**
- The library's CI runs Node 22 and 24, with real Chromium and WebKit, in about 36 minutes.
- Run affected files locally in the foreground, through `ccrc test --`, one per call, with a timeout of at least 600000 ms.
- A timeout under the test slice's memory kills, with no assertion mismatch, gets one isolated rerun; if it still times out, record it as unmeasured and let CI on the exact tip arbitrate.
- WebKit cannot run on this box. For a WebKit-only question, one push per CI cycle is accepted; list mail before each push.
- Use your workspace's own install and the cached browsers. Make no repository copy and open no extra worktree.

**Departures:** a sentence of §6 or §10 you cannot build as written is a stop-and-ask to me, quoting the sentence and your proposal. Never write a D-number in the library's repository: cite ccrc's numbers as "ccrc D-n" only.

**Stop and ask:**
- any widening of the frame's sandbox, CSP or channels beyond §6;
- a size-share, layout-row or bootstrap breach;
- an edit outside the library repository;
- a refusal from any tool, hook or route: report it, then wait for my word.

**Routing:**
- Main loop Opus · high.
- Implementer subagents Sonnet · high for Task 0, Task 9, `frameCsp(layout)` and the contrast gate; Sonnet · medium elsewhere.
- One Opus · high review subagent over each task's diff before its commit, given the diff and plan inline and told not to invoke any skill.
- Every Agent call names its model and effort literally, never Fable. Workflow off.

**Delivery:**
- Claim every file before its first edit, and commit on your workspace branch only.
- One PR to `Synapsium-Labs/docserver` `main` (or the first of the ruled two), with the trailers in one final paragraph.
- List mail before your push.
- Get the exact-tip test (22) and test (24) green, then send the wave-done with the fingerprint JSON and the suite and failure lines.
- Never merge, enqueue or arm auto-merge.

## Earlier brief — LR, run 2987 (landed as library PR #87)

### LR — run 2987 (the library's repository)

Programme `native-docs-reader` (home project ccrc-pwa), wave 33 = LR: the shared rendering library renamed **pinax-lib**. It is built in the library's own repository (project `docserver`, GitHub `Synapsium-Labs/docserver`, a PUBLIC repository). Run 2987. Deviation block issued: 8863 and 8864.

**The operator's ruling (2026-11-19):**
- The library's name is pinax-lib, and the package is `@synapsium-labs/pinax-lib`.
- The rename is its own landing, after L1 and before the release.
- It changes no frame asset and keeps the wire names, as PR #85 did, and it supersedes #85, which says `@synapsium-labs/pinax`.
- At the release, the operator renames the GitHub repository to `Synapsium-Labs/pinax-lib` (old URLs redirect), sets up the npm name and its trusted publisher, and pushes the signed tag. None of that is yours.

**Your base is the library's `main`, now at `aacae4c56`, with L1 (the appearance contract, #86) landed.**

**Your reference is PR #85** (`rename/pinax`, 24 files, cut from an older `main`). Read its description and diff in full: its five decisions are the shape of this wave. Apply them to `pinax-lib` on today's `main`:
1. **The new name.** The package becomes `@synapsium-labs/pinax-lib`. Where a file names the repository from the next release on, it is `Synapsium-Labs/pinax-lib`.
2. **Old versions.** 1.0.0 and 1.1.0 stay published as `@synapsium-labs/docserver`. That name gets no further version, and is deprecated with a pointer once the first pinax-lib version is out. Say so in the README and CHANGELOG, as #85 does.
3. **Names that keep the old word:** every name on the wire or in a built asset.
   - This covers the `docserver:*` placeholders and meta names, `DOCSERVER_FREE_GLOBALS`, `docserverControl`, `docserverAbsent`, the test hook, the frame's own error messages, and every `data-docreader-*` attribute and `--dr-*` property L1 added.
   - So no golden file and no asset hash moves, and the bridge protocol and seed schema keep their numbers.
   - Only the parent's messages, in `./host`, change, to `pinax-lib host: …`.
4. **Records keep their wording.** Plans and the programme ledger record work done under the old name.
5. **Owed before the first release:** listed in the PR description as the operator's.

L1 added files that name the package, such as the README's appearance sections, test reads of `package.json` and the size tests' environment names. Find every occurrence on today's `main`, not only #85's 24 files, and decide each by rule 3. Record in Results the list of what you kept and why.

**Deliver, in one PR to the library's `main`:**
- No version bump: the release sets the version.
- **The size line.** Test 8 reads the landing's `Size-Design:` line. The rename grows nothing, so the description carries exactly one `Size-Design: none`, and `assets/assets.json`'s hashes and the growth table do not move. If a rule forces a size row, stop and ask.
- **Proof that nothing on the wire moved:**
  - the frame assets rebuilt with `build-frame --check` green and no hash changed;
  - the conformance corpus' goldens unchanged;
  - `npm pack` naming the new package;
  - the consumer-smoke test importing it by the new name.
- **Do not touch PR #85 or its branch.** I close it when this lands.
- Never write a D-number in the library's repository. A departure from the operator's ruling or from #85's decisions is a stop-and-ask to me; ccrc records its number.

**Public repository:** no private name, host, path, account or tracker in any file, commit message, PR title or body. Run a private-name scan over every file and commit message before your push.

**Measure, don't recall.**
- The library's CI runs Node 22 and 24, with real Chromium and WebKit tests, in about 36 minutes.
- Run the affected files locally in the foreground, through `ccrc test --`, with a timeout of at least 600000 ms, one at a time.
- The shared test slice's memory cap has killed browser workers today. A timeout under its kills, with no assertion mismatch, gets one isolated rerun; if it still times out, record it as unmeasured locally and let CI on the exact tip arbitrate.
- Use your workspace's own install and the cached browsers. Make no repository copy and open no extra worktree.

**Stop and ask:**
- any change to a built asset, a golden, the bridge, the seed schema or a wire name;
- a size row;
- an edit outside the library repository;
- a refusal from any tool, hook or route (report it, then wait for my word).

**Routing (clause 13):**
- Main loop Opus · high.
- Implementer subagents Sonnet · medium for the sweep.
- One Opus · high review subagent over the whole diff before the push.
- Every Agent call names its model and effort literally, never Fable. Workflow off.

**Delivery:** commit on your workspace branch only. One PR to `Synapsium-Labs/docserver` `main`, with the trailers in one final paragraph. List mail before your push, and push once. Get the exact-tip test (22) and test (24) green, then send wave-done with the fingerprint JSON and the suite and failure lines. Never merge, enqueue or arm auto-merge.

## Earlier briefs — L1 and X6, runs 2843 and 2847 (landed as library PR #86 and in #3121)

L1 and X6 are in review; R1 was opened on P1's landing (Decisions, 2026-11-20 (day)).

### L1 — run 2843 (the library's repository)

Dispatched 2026-11-20 as written below, before the naming ruling (Decisions, 2026-11-20). The library's name is now pinax-lib, and its rename lands after L1.

Programme `native-docs-reader` (home project ccrc-pwa), wave 30 = L1: the shared rendering library's appearance contract, built in the library's own repository (project `docserver`, GitHub `Synapsium-Labs/docserver`, a PUBLIC repository). Run 2843. The operator approved X1's design on 2026-11-19 and directed that this programme drive the library's build.

**Your input is ccrc's design, read from the home repository:**
- homeRepoRoot `<projects-root>/ccrc-pwa`;
- planSha `0b96bd0dcc470ddacc6b634fc4770052571040ca`;
- the X1 spec, §10 "The library's part", in full, with tests 1 to 10 and the size-table rules (test 8 and its genesis landing): `git -C <projects-root>/ccrc-pwa show <planSha>:docs/superpowers/specs/2026-11-18-native-docs-appearance-continuity-design.md`;
- the X1 plan: its "Waves and order" row L, its Results "Library input (X4)" and "Review 2732" subsections, and its carries: `git -C <projects-root>/ccrc-pwa show <planSha>:docs/superpowers/plans/2026-11-18-native-docs-appearance-continuity.md`;
- X2's spec §6, for the shares only.

Read the library's `CLAUDE.md`, its programme ledger `docs/superpowers/programs/docserver.md` and its last plan `docs/superpowers/plans/2026-11-04-docserver-batch-release.md`, and follow their conventions: purity, CSP-safe browser code, one raw-HTML allowlist, the conformance corpus as the contract, and a red case for every guard.

**Scope: X1's contract only. It is the genesis landing of the size tables.** It includes:
- the appearance op on the existing port (the frame handle's `setAppearance`);
- `parseAppearance`, with its grammars and label rules;
- the slots, the derivations and the fonts;
- the hosted Mermaid rules (covered kinds, the derivation, the halo, resolved cue literals, the tooltip and commit-label rules, and the svg mark that reaches the full-screen copy);
- the non-colour cues;
- tests 1 to 10 as §10 writes them;
- test 8's two append-only tables. The genesis shares table records `x1` at 32 768 characters, and `x2` at 1 166 336 characters in total and 72 704 for the largest frame, as the coordinator set them.

X2's additions (layouts, items, place and overlay ops, print-figures, print mode) are NOT in this wave: they are L2's, after this landing. Do not touch PR #85 (the rename), whose name is still the operator's decision, and do not change the package version. The release and its signed tag are the operator's.

**Deliver, in one PR to the library's `main`:**
1. A leaf plan, `docs/superpowers/plans/2026-11-20-docserver-appearance-contract.md`, in the library's plan shape: Status, Goal, Architecture, tasks with Files, interfaces, red-first steps, mutation rows and Results. Name ccrc's spec by its public GitHub path, never by a local path.
2. Then implement it, task by task, red-first. Every guard gets a case that reds when it is deleted, measured.
3. The PR description carries exactly one `Size-Design: x1` line, as test 8 requires.

**Departures:** a sentence of §10 you cannot build as written is a stop-and-ask to me, quoting the sentence and your proposal. Do not write a D-number in the library's repository; ccrc's deviation numbers are recorded in ccrc.

**Measure, don't recall.**
- The library's CI runs Node 22 and 24, with real Chromium and WebKit layout tests, and takes about 36 minutes. Run the relevant files locally before you push, in the foreground, with a timeout of at least 600000 ms. Use `ccrc test -- <command>` for heavy runs.
- The box has about 80 GB free. Use your workspace's own install, and the Playwright browsers already cached on the box. Do not download new browsers if a cached build serves, make no repository copy and open no extra worktree.

**Public repository:** no private name, host, path, account or tracker in any file, commit message, PR title or body. Refer to the console as ccrc and to its design by GitHub path. Run a private-name scan over every file and commit message before your push.

**Asks:** a product choice goes to me as a structured ask with your recommendation. A technical choice is yours: record why in Results.

**Stop and ask:**
- any widening of the frame's sandbox, CSP or channels beyond §10;
- any bridge or protocol change beyond §10's appearance op;
- a budget or size-share breach;
- an edit outside the library repository;
- a refusal from any tool, hook or route (report it, then wait for my word).

**Routing (clause 13):**
- Main loop Opus · high.
- Implementer subagents Sonnet · high, for the validator, the frame application and the CSP or test-9 work, and Sonnet · medium elsewhere.
- One Opus · high review subagent over each task's diff before its commit.
- Every Agent call names its model and effort literally, never Fable. Workflow off.

**Delivery:** commit on your workspace branch only. One PR to `Synapsium-Labs/docserver` `main`, with the trailers in one final paragraph. List mail before your push, and push once. Get the PR's exact-tip CI green, then send wave-done with the fingerprint JSON and the suite and failure lines. Never merge, enqueue or arm auto-merge.

### X6 — run 2847

Dispatched 2026-11-20 as written below (Decisions, 2026-11-20).

Programme `native-docs-reader`, wave 31 = X6, a DESIGN wave: reader mode, a full-screen, Kindle-like reading experience for a document in ccrc's native Docs reader. Run 2847. Deviation block Issued: 8803, 8804 and 8805 (a reserve; none defined yet).

**The operator's request, 2026-11-19, verbatim:** "when reading a document via docserver I need a button to enter "reader mode" where the document becomes full-screen (think Kindle-like experience when used)".

"docserver" here means the reader the operator reads in, which is now ccrc's native Docs reader with the shared library in its frame. The standalone reader is being retired and gets nothing.

The coordinator's reading of "Kindle-like", for you to test and refine:
- one button enters it;
- everything but the text goes away, ccrc's chrome and the reader's bars included;
- the document reads in pages turned by tap, swipe or the arrow keys, or else as calm continuous scroll;
- a light tap shows a minimal overlay with progress (percent or time left), Aa and Exit;
- the place is remembered;
- it works on a phone and on a desktop.

Pages against scroll is a product choice. Put it in Waiting on you with your recommendation, and design both far enough to price them.

**Read first:**
- the rich-docs spec `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md` (the frame, the bridge, the host and library split, and the sandbox and CSP);
- X1's spec §10 and the appearance contract (reader mode uses ccrc's appearance; no new palette or catalogue);
- X2's spec, the reading layer (P5: places, the popstate dispatcher, Back, overlays, layouts) and print;
- the native reader in `pwa/src/docs/` (`ReaderFrame.tsx`, `DocsHead.tsx`, the one bar, `reader/bridge.ts`, `reader/policy.ts`) and the reader lab (E14, E17, E18);
- the ledger's Carried constraints.

**Decide and argue, each with a table of alternatives:**
1. **Entry and exit.**
   - Where the button sits on desktop and in the phone head.
   - The keyboard shortcut.
   - Exit by Esc, Back, the overlay and the browser's own exit, with one place-and-Back model from X2's popstate dispatcher.
2. **Full screen.**
   - The host owns it. The sandboxed frame cannot request it, and the frame's sandbox (`allow-scripts`) and the shell CSP do not widen.
   - The Fullscreen API on the host's container where it works.
   - On a phone engine that refuses element full screen (measure iOS Safari, and the installed PWA in standalone mode), a chrome-less overlay that fills the viewport.
   - The phone blocks, the tap and one-bar budgets, and safe areas.
3. **Reading.**
   - Pagination inside the frame (a library layout mode) against host-side paging. Figures, tables, code and Mermaid that do not fit a page.
   - The turn gestures and tap zones, with no conflict with links and text selection.
   - Progress reporting from the frame to the host over the existing port, as an additive op.
   - Remembering the place per document through the reader's existing visit state.
4. **Comfort:** typography from the appearance contract with reader-local width and size, reduced motion, an optional screen wake lock (say whether you take it, and why), orientation, and an accessible focus order.
5. **The split and the library.** What ccrc builds and what the shared library builds:
   - any new frame op;
   - a paged layout;
   - its budget share under test 8 (the library's size tables);
   - which library wave carries it after L1 and L2.

**Deliver, in one PR:**
- A design spec, `docs/superpowers/specs/2026-11-20-native-docs-reader-mode-design.md`, from `~/.claude/templates/superpowers-spec.md`: In short, numbered sections, Mermaid figures with captions, decision tables, a promise-delta fence, and Where things stand. Include mockups, described or as Mermaid, of the button and the overlay on a phone and a desktop.
- A leaf plan, `docs/superpowers/plans/2026-11-20-native-docs-reader-mode.md`, written with the writing-plans skill: the implementation waves and their order against X2's P5 and the library waves, the files each owns, the interfaces, mutation rows that a deletion would red, acceptance rows (a new capability: propose its row for completion Task 17), and Results.

**Measure, don't recall.** Read shipped source on `main`. Measure engine full-screen support where you can: desktop Chromium in the reader lab's browser leg. Record the phone engines as an operator device item for me to raise. No install, repository copy or new worktree: the box is low on disk.

**Standing boundaries:**
- The reader sandbox stays exactly `allow-scripts`, the shell CSP stays `frame-src 'none'`, with no parent-DOM access and no new channel; frame ops are additive on the existing port.
- Both 2026-11-06 phone blocks are byte for byte.
- Library 1.1.0 stays pinned in this wave. A library change is designed here, not made.
- The standalone reader gets nothing.

**Public repository:** neutral names only. Private-name scan every file and every commit message before your push.

**Asks:** a product choice goes to me as a structured ask with your recommendation. A technical choice is yours: decide it and record why.

**Routing (clause 13):**
- Main loop Opus · high, xhigh at the pages-or-scroll and full-screen decisions.
- Sonnet · medium Agent subagents for fact checks against source.
- Every Agent call names its model and effort literally, never Fable. Workflow off.
- Before your wave-done, run one Opus · high adversarial pass over the spec (boundaries, phone behaviour, testability), and fix or record what it finds.

**Stop and ask:** any source edit (this is docs only), any widening of the frame's sandbox or the shell CSP, or a refusal from any tool, hook or route (report it, then wait for my word).

**Delivery:** commit on `ws/<your slug>` only, with the trailers in one final paragraph. List mail before your push, and push once. Get the exact-tip `ci` and `CodeQL` checks green, then send wave-done with the fingerprint JSON. Never enqueue or arm auto-merge.

## Earlier briefs — P1 and X5, runs 2743 and 2837 (landed in #3102 and #3093)

Dispatched 2026-11-19 as written below (Decisions, 2026-11-19 evening). X3's R1 follows P1, because the two waves share files.

### P1 — run 2743

Programme `native-docs-reader`, wave 28 = P1, the first parity building wave: range reads and large files. Run 2743. Deviation block Issued: 8783, 8784 and 8785.

The operator approved the X1, X2 and X3 designs on 2026-11-19. This wave builds X2's Wave P1. Read the whole section in `docs/superpowers/plans/2026-11-18-native-docs-parity.md`: its Global Constraints, Review Focus, ownership table and Tasks P1.1 to P1.5. Read the matching spec sections in `docs/superpowers/specs/2026-11-18-native-docs-parity-design.md`. Read the ledger `docs/superpowers/programs/native-docs-reader.md`, section "Binding carries from the extension designs": every item there addressed to P1 is binding.

**First item, before any code (one or two commits, docs only):**
1. The render-gate carry, exactly as the ledger states it:
   - Markdown above the 512 KiB gate is read in parts no larger than the gate, each mounting rich and printing through the same render job;
   - row F2 becomes a Gap closed by P1.5, and the counts and In short move;
   - §4.3's "a part of up to 2 MiB renders as its own mount" is corrected;
   - PL3 is reworded;
   - P1.5's part-id pre-pass uses parts of at most gate size;
   - P6.1's boundary and fixture tests are added.

   Edit X2's spec and plan.
2. D2's two minors (ask 600), in the completion plan's Results "D2" section:
   - Re-measure row `W4-T10-M10` once. It records 3 failed; review run 2610 measured 2. Record your count and drop the third red name.
   - Name D-8730's two clauses, "the next Tab follows the one bar's order" and "the one bar's layout and order are unchanged", each as pinned (by which row) or as descriptive only. Do not change D-8730's text.

**Then P1.1 to P1.5, red-first, as the plan writes them**, with the carried Files additions:
- P1.2 gains `server/test/ccdCapTokens.ts`, `server/test/ccd-archive.test.ts` and the `docs-parity` `H.VERBS` case.
- P1.5 gains `useDocsVisit.ts`, `docsLinks.ts` and Share's `samePin`. `pinFor` must not throw for a stat-pinned draft between the listing and the prepare.

**Measurements.**
- Lab RANGE-L1 (P1.1 Step 0) sets `DOCS_RANGE_PREPARE_BUDGET_MS` from five timed 64 MiB copy-and-hash runs.
- The render-gate stop-and-ask: if a part at the gate cannot render within budget, stop and ask. Measure it in the reader lab's desktop Chromium leg. Record the phone leg as an operator device item for me to raise. Do not claim a phone figure you did not measure.

**Disk:** the box is low on disk. P1.2's cases write about 128 MiB into the fixture HOME's cache, so each case removes its snapshots. RANGE-L1's 64 MiB file lives in your session temp root and is deleted after. No repository copy, no new worktree, no `npm install` beyond your workspace's own.

**Claims.** Claim your files before editing. These are held right now by other programmes' workers:
- `ccd/ccd` and `server/src/ccdargv.ts`: claim 5684, the mid-turn-mail PR4 worker;
- `server/src/server.ts`, `server/test/{box-token-census,auth-gate}.test.ts`, `server/test/rings/fastify-l4.data.ts` and `server/test/ccdCapTokens.ts`: claim 5697, the door-B1 worker;
- `pwa/src/lib/api.ts`: claim 5670, the approvals PR3 worker;
- `server/test/ccd-archive.test.ts`: claim 5673, the mid-turn-mail PR4 worker.

Order your tasks so that free files go first: the first item, then P1.1 (`shared/docs.ts`), then the PWA parts of P1.4 and P1.5. For a held file, use the peers rules (`ccrc-api peers list --of <you>`) to ask its holder. If it is not free when you need it, tell me which task waits on which claim, keep working on the free tasks, and never edit a held file. The first draft-review building wave (R1) waits for this wave: it shares `shared/docs.ts`, `server/src/server.ts` and three census and ring test files with you.

**Tests:**
- Fixture HOMEs only for ccd, with the three poisons in any new ccd test.
- Every heavy run goes through `ccrc test -- <command>`, in the foreground, with a timeout of at least 600000 ms.
- Mutation rows (P1's M11.10 to M11.15, M11.51, M11.53, M11.55 and M11.66) are measured red, then restored from a saved copy, never by `git checkout`.
- A new mutation row or guard ships with a test that reds when it is deleted.

**Standing boundaries:**
- Reader sandbox exactly `allow-scripts`, shell CSP `frame-src 'none'`, no parent-DOM access and no new channel.
- Both 2026-11-06 phone blocks byte for byte. Library 1.1.0 stays pinned.
- No live service, unit or config touched.
- Every new door is classed under the census rules (`DOCS_DOORS`), and the range route stays session-gated.

**Public repository:** neutral names (`project-a`, `the fleet box`). Private-name scan every file and every commit message before your push.

**Deviations:** a departure from an approved spec or the completion design gets the next number of your block, defined in X2's plan's `## Deviations found`, quoting the sentence. A departure from an operator ruling is not yours: ask. When the block is spent, write `D-TBD-<slug>` and ask.

**Asks:** a product choice goes to me as a structured ask with your recommendation. A technical choice is yours: record why.

**Stop and ask:**
- any widening of the boundaries above;
- an edit to a file another run holds;
- a hook or route refusal (report it, then wait for my word before any other form of the same act);
- a measurement that fails its stated budget.

**Routing (clause 13):**
- Main loop Opus · high.
- Implementer subagents Sonnet · high, for the ccd verb, the route and the census; Sonnet · medium elsewhere.
- One Opus · high review subagent over each task's diff before its commit.
- Every Agent call names its model and effort literally, never Fable. Workflow off.

**Delivery:** commit on `ws/<your slug>` only. One PR, with the trailers in one final paragraph. Results go in X2's plan. List mail before your push, and push once. Then:
1. Get the exact-tip required checks and the CodeQL check green, with 0 open alerts.
2. Send wave-done with the fingerprint JSON and the suite and failure lines.

Never enqueue or arm auto-merge.

### X5 — run 2837

Programme `native-docs-reader`, wave 29 = X5, a DESIGN wave with security weight: HTML pages at the level of AI-chat artifacts, on an isolated origin. Run 2837. Deviation block Issued: 8786, 8787 and 8788 (a reserve; none defined yet).

**The operator's ruling, 2026-11-19**, on X2's conflict C3 (ask 598): "we will need to support them, think claude artifacts levels of support, but maybe we should sandbox how they are hosted or adopt other safety measures". This replaces X2's recommendation to keep the walls.
- An HTML page in the docs runs its own scripts, modules, workers, WebAssembly, fetches of its own sibling files, dialogs and downloads, the way a hosted artifact does.
- The safety comes from where and how it is hosted.

**Read first:**
- X2's spec `docs/superpowers/specs/2026-11-18-native-docs-parity-design.md`: §4.8 (the walls, the in-walls loader, the measured loss by kind), "The widening, priced" and C3.
- X2's plan, Wave P6 (the page loader).
- `pwa/src/docs/mockup/` (`policy.ts`: `MOCKUP_SANDBOX_*`, `MOCKUP_CSP`; `load.ts`; `MockupFrame.tsx`).
- X3's draft-review design (a capability-link store with expiry, revocation, a read door outside the auth gate, and a marker header), whose patterns you may reuse.
- `server/src/auth/gate.ts`: its origin check (one `CCRC_ORIGIN`, whole-string equality, writes only), the `Origin: null` exemption, and EXEMPT classes.
- Project `CLAUDE.md`: the two-box topology, `ccrc expose` with Caddy and DuckDNS, the arming triple, box-token census rules, rings, and storage and backup.

**Decide and argue, each with a table of alternatives:**
1. **Hosting.**
   - A second registrable domain (not a subdomain of the console's) with no cookie and no session. Or the alternatives, each with its threat.
   - How the operator sets it up: a second name, a Caddy site, a certificate, through `ccrc expose`, with no tailnet dependency.
   - What happens on a box that has no second name: a fallback to X2's walls tier, never to the console's origin.
2. **Access.**
   - A capability URL minted by the console under a signed-in session: entropy, expiry, revocation, and whether X3's store is reused.
   - The content route outside the auth gate with its own check, named once in the census.
3. **Isolation of the page.**
   - Sandbox flags, a frame on the second origin or a new tab, and the CSP.
   - Network egress: none, allow-listed or open. Argue exfiltration of what the page shows.
   - No channel to the console, and never a secret posted to it.
4. **Bytes.** Served from git through the existing bounded reads and the whitelisted agent frames (range reads from P1), with the size budgets you keep, and caching. No live fleet read outside the agent.
5. **Tiers.** Whether X2's in-walls srcdoc tier stays the default, with the isolated origin as an opt-in for pages the walls refuse, or one tier for all. No shared policy constant between tiers.
6. **Threat model.** Name each and close it:
   - phishing on the second domain;
   - drive-by and auto-download;
   - resource abuse;
   - token leakage (Referer, history, previews);
   - a malicious page in a repository;
   - service-worker scope;
   - cross-origin storage;
   - the page impersonating ccrc.
7. **Parity.** Close the standalone-only losses §4.8 measured: assets above 5 MiB in total, WebAssembly, a page above 2 MiB, dialogs and popups. Map onto Task 17's parity rows and C3.

**Deliver, in one PR:**
- A design spec `docs/superpowers/specs/2026-11-19-native-docs-html-artifacts-design.md`, from `~/.claude/templates/superpowers-spec.md`: In short, numbered sections, Mermaid figures with captions, decision tables, a promise-delta fence, and Where things stand. Keep Waiting on you to genuine product choices, each with your recommendation.
- A leaf plan `docs/superpowers/plans/2026-11-19-native-docs-html-artifacts.md`, written with the writing-plans skill: its implementation waves, their order against X2's P1 to P6 and X3's R1 to R4, the files each owns, the interfaces, mutation rows that a deletion would red, acceptance rows, and Results.

Amending X2's §4.8 or C3 text is a departure from an operator-approved design. Define it from your block, quoting each sentence exactly and naming the operator's 2026-11-19 ruling.

**Measure, don't recall.** Read shipped source on `main`. You may read public documentation about how hosted artifact platforms isolate content, and cite it by public URL. Do not stand up a server, domain, certificate or service. No install, repository copy or new worktree: the box is low on disk.

**Standing boundaries:**
- The console's own origin never runs a page's code.
- The reader frame's sandbox (`allow-scripts`) and the shell CSP `frame-src 'none'` stay as they are for docs. Any widening of the console's own policies is a stop-and-ask.
- No live service, unit, proxy, DNS or config is touched.
- The standalone reader is named by role only.

**Public repository:** neutral names (`<console-host>`, `<artifact-host>`, `project-a`). Never a real host, domain, address or path. Private-name scan every file and every commit message before your push.

**Asks:** a product choice goes to me as a structured ask, with options and your recommendation. A technical choice is yours: decide it and record why. Never re-ask a recorded ruling.

**Routing (clause 13):**
- Main loop Opus · high, xhigh at the hosting, access and egress decisions.
- Sonnet · medium Agent subagents for fact checks against source.
- Every Agent call names its model and effort literally, never Fable. Workflow off.
- Before your wave-done, run one Opus · high adversarial pass over the spec (boundaries, threat model, testability), and fix or record what it finds.

**Stop and ask:** any source edit (this is docs only), any widening of the console's policies, a new storage owner you cannot argue under the census rules, or a refusal from any tool, hook or route (report it, then wait).

**Delivery:** commit on `ws/<your slug>` only, with the trailers in one final paragraph. List mail before your push, and push once. Get the exact-tip `ci` and `CodeQL` checks green, then send wave-done with the fingerprint JSON. Never enqueue or arm auto-merge.

## Earlier brief — X4, run 2680 (landed in #3055)

Dispatched 2026-11-19 as written below (Decisions, 2026-11-19). The coordinator's rulings it names (the X1 and X2 carries, ask 608) are recorded in Decisions and in Binding carries above; its review and fix rounds are recorded in Decisions.

Programme `native-docs-reader`, wave 27 = X4, library input: the X1 and X2 carries, run 2680. Deviation block Issued: 8774 and 8775 (a reserve; define one only for a departure from the completion design, the rich-docs spec or an operator ruling).

Why this wave exists. The library programme plans its one library wave (X1's wave L) from X1's spec §10 and X2's spec §6. Review run 2676 found a §10 sentence that does not hold for the bundled Mermaid. The coordinator accepted X1 at the review cap on the condition that a reviewed text wave corrects §10 before wave L is planned. This is that wave. It also folds X2's library-side carries in, so one library wave and one release take both designs. It is docs only.

Read first:
- the coordinator's rulings, `/tmp/native-docs-d/x1-carries.md` and `/tmp/native-docs-d/x2-carries.md`;
- review reports `/tmp/native-docs-d/review-2676-89a9ce02.md` (X1, round 3) and `/tmp/native-docs-d/review-2670-baef59a2.md` (X2, round 3).

Every ruling in x1-carries.md is binding: carry it out as written. A choice it leaves open is yours: decide it and record why.

Files (claim them first):
- X1: `docs/superpowers/specs/2026-11-18-native-docs-appearance-continuity-design.md` and `docs/superpowers/plans/2026-11-18-native-docs-appearance-continuity.md`;
- X2: `docs/superpowers/specs/2026-11-18-native-docs-parity-design.md` and `docs/superpowers/plans/2026-11-18-native-docs-parity.md`.

Nothing else. Both designs are merged (X1 at `8781ef20a`, X2 at `6095bf43d`). Edit them in place.

Items, one commit each where they separate:
1. **X1 §10 Mermaid (F1 ruled (a), F2).**
   - Measure, from library 1.1.0's bundled Mermaid, every colour key its `base` theme reads per diagram kind, including the literal fallbacks (`doneTaskBkgColor||"lightgrey"`, `critBkgColor||"red"` and the rest the report names), and the kinds it draws.
   - Write the named constant of covered kinds. It holds at least flowchart, sequence, class, state, gantt, pie, ER and gitGraph.
   - Give `mermaidThemeOf`'s assignment or derivation for every key of every covered kind, with the contrast floor each pair meets in all 12 palettes. Add a row to the Cross pairs table per drawn pair.
   - Kinds outside the constant, and author-styled figures (`classDef`, `style` or `linkStyle` setting a fill, stroke or colour), keep 1.1.0's plate and filter while hosted. The exception is F2's measured label route, if you take it.
   - Test 5 draws each covered kind in every palette, plus F2's fill-only `classDef` row. Narrow §5 and §9's claims to the constant.
2. **X1 §10 states (F3), and the advisory text items.**
   - F3: a non-colour cue each for the checked option, the pressed view button and the filter focus, each with a test 10 row. The flash is named as exempt, and line 415 is reworded.
   - Text: A1, A4 (`HASH_SOURCE` mask on `script-src` tokens, `FRAME_OPS`, the frame's own parser), A5, A6, A8, A9 (2) and (3), and A10.
3. **The budget (F4) and X2's share.**
   - Test 8 sums every `FRAME_MANIFEST` entry, Mermaid's included. Re-measure the 1.1.0 baseline that way.
   - Its rows are append-only against the parent commit's table, and each row names the library commit that measured it.
   - X2's layouts are per-layout enhance bundles, of which a frame inlines one. Say how test 8 and the per-layout srcdoc cap count them, so that no layout spends another design's share.
   - Propose X2's share with numbers. Measure 1.1.0's default enhance bundle as the comparator, and add the item-link, place, print-figures and print-mode additions. Edit X2 §6 to state it. The coordinator sets the share at this wave's acceptance.
4. **X2 F10, its library half.** The print design for the review strip's waiting list, and for the plan task chips, step labels and plan facts, inside §6's print-mode row. Name what P5.5 then does on ccrc's side.
5. **X1 wave C's first items, folded in now.** F5, F6, F7, A2, A3, A7 and A9 (1) as x1-carries.md rules them, in X1's plan: Task 5's Files and Step 4, the one hosted decider with its lab row and AP-M12, the await row and its mutation row, AP-6's palette list, Step 2's expected reds, the Chromium-only Results line, and the one stamp function.
6. **Results.** Append a "Library input (X4)" section to each plan: what you measured and how, a table of every carry with the line that closes it, and the commands you ran.

Measure, don't recall. Read library 1.1.0 from an existing installed copy, read-only. Do not run a new `npm install`, make a repository copy or open a new worktree: the box is low on disk. Figures you cannot measure are written as unmeasured, never as estimates presented as measurements.

Standing boundaries (not re-opened here):
- Reader sandbox exactly `allow-scripts`; shell CSP `frame-src 'none'`; no parent-DOM access and no new channel.
- Both 2026-11-06 phone blocks are byte for byte. `@synapsium-labs/docserver` stays exactly 1.1.0.
- A library change is designed, not made. Its release and signed tag are the operator's.
- Name the library by role, and propose no new name.
- A design change that would need any widening is a stop-and-ask.

Public repository. Nothing private, ever:
- The standalone reader is named by role only.
- Private-name scan every file before each commit, and again before your push.

Routing (clause 13): main loop Opus · high, xhigh at the F1 derivation and the budget decision. Sonnet · medium Agent subagents for fact checks against the library and ccrc source. Every Agent call names its model and effort literally, never Fable. Workflow off. Before your wave-done, run one Opus · high Agent pass over the changed sections as an adversarial reader (contrast, budget holes, testability), and fix or record what it finds.

Asks: a genuine product choice goes to me as a structured ask, with options and your recommendation. A technical choice is yours. Never re-ask a recorded ruling.

Deviations: as above. If the block is spent, write `D-TBD-<slug>` and ask.

Stop and ask: any source edit, any file outside the four, a widening, a library repository edit, a refusal from any tool, hook or route, or a covered-kind derivation that cannot meet the floor in some palette. In that last case, say which kind and palette, and propose the plate fallback for it.

Commit on `ws/<your slug>` only, never a separate feature branch. Every commit message ends with one trailer paragraph. One PR. List mail before your push, and push once. Get the exact-tip `ci` and `CodeQL` checks green and 0 open alerts, then send wave-done with the fingerprint JSON. Never enqueue or arm auto-merge.

## Earlier briefs — X1, X2 and X3, runs 2631, 2632 and 2633 (landed in #3048, #3049 and #3050)

Dispatched 2026-11-18 as written below, each as its wave's section followed by the common section (Decisions, 2026-11-18). The coordinator's rulings on their asks are in Decisions.

### X1 — run 2631

Programme `native-docs-reader`, wave 24 = X1, native appearance continuity design, run 2631. Deviation block Issued: 8759, 8760 and 8761 (a reserve; none defined yet).

First item, one commit, in the completion plan's Results "D2" section, marked as X1's correction. These are review run 2610's two carries; its report is at `/tmp/native-docs-d/review-2610-18fc6ed6.md`.
- Row `W4-T10-M10`: its recorded count is 3 failed, but it measures 2 failed | 74 passed (76) twice. Re-measure it once, record your count, and drop the third red name from the row and from any Results sentence that quotes it.
- D-8730's two clauses, "the next Tab follows the one bar's order" and "the one bar's layout and order are unchanged", appear in neither of fix round 2's F4 lists. Name each as pinned (say by which row) or as descriptive only. Do not change D-8730's text.

The design. The operator's requirement is the ledger's "Operator amendment — native visual continuity and legacy decoupling (2026-11-10)" and the Carried constraint "Required native appearance continuity". Read both in full. In short:
- The reader opens with ccrc's selected appearance and follows host changes while open (the coordinator's default).
- It uses the same skin and theme catalogue: today Refined and Instrument, and twelve named palettes plus Follow the system. There is no second hand-kept list, and no colour-mode-only approximation.
- Native visual language: surfaces, text, accent and semantic colours, typography, borders, focus, controls and density. Reading layout, figures, tables and accessibility are kept.
- Rendering styles and any checked-preference extension belong to the shared library. ccrc owns the preference and the adapter. The existing checked bridge carries it, with no stylesheet injection.
- One frame Aa. While hosted, its global appearance follows ccrc; width, font and fold choices stay reader-local. A stale reader preference never overrides the host.

Measure first: where ccrc's canonical skin and theme catalogue and its preference source live, how the current adapter collapses named palettes to light, dark and auto and sends no skin, what library 1.1.0's bridge and `HostAdapters` accept, and how the reader's lazy start and the lab profile draw.

Decide and argue, with alternatives in a table:
- The library interface: a token contract, or a catalogue the host passes. Version negotiation with an older library, and fail-safe behaviour on an unknown skin.
- The catalogue-sharing mechanism that keeps one source of truth, with a scan that reds a second copy.
- Changes during lazy start and while open, and readable Mermaid, code and tables in every palette, with contrast and focus.
- The budgets you keep, with numbers.

The library side: write a section the library programme can plan from, with the interface, its tests and its compatibility. Name the library by role. The operator is still deciding a rename of the library; do not use or propose a new name. Its release and re-pin come later and are the operator's.

Acceptance: map the design onto Task 17's Appearance row: both skins, all twelve palettes and Follow the system, ordinary and lazy open, changes while open, and the geometry budgets.

Files: the first item's plan edit; your new spec and leaf plan. Claim the completion plan only for the first item, and release it when that commit is in.

### X2 — run 2632

Programme `native-docs-reader`, wave 25 = X2, full parity inventory and design (#1418), run 2632. Deviation block Issued: 8762, 8763 and 8764 (a reserve; none defined yet).

The operator's rulings, recorded in the ledger and not to be re-asked:
- "Retirement drops no feature" (2026-10-25, #1418 and #1420). Full parity is required, not Later or Dropped. That covers outside non-repo folders, layout variants, large files, PDFs and configured tracker links. Outside folders need not become Git repositories.
- "Parity inventory reconciliation". Read #1418 and its comments.

Older Later or Dropped labels are not waivers. Current safety caps and auth boundaries stay until a reviewed design replaces them. Never fake parity with an unsafe cap lift or an unauthenticated live working-tree read.

1. The inventory first. Build a side-by-side table of every capability the standalone reader has, from its source and its served pages on this box, not from older lists. For each: the user's action, the standalone result, the native status at `main` (present, partial or missing, with the source that proves it), and a disposition (already native, required gap, or a conflict needing an operator ruling). Include at least print, figure-overlay Back-to-close and old-origin state. Old-origin state starts fresh under the rich-docs state contract: reconcile that recorded choice with the no-feature-loss promise explicitly, and authorise no migration. A genuine conflict goes to me as an ask, never resolved in prose.
2. Design every required gap, each with alternatives in a table and its test strategy:
   - outside folders: Settings add and remove, the not-in-a-repo label, last-modified truth, no fabricated history or ref, read-only containment, redaction, and refusal of an escaping symlink;
   - layout variants: every kept variant, including classic, A, B, C and the AB default, its persistence, and its use on phone, laptop and wide views;
   - large files above 2 MiB: bounded streaming or paging, the below, at and above ceiling cases, truthful output over the ceiling, and the overlay-cap decision;
   - PDFs: list, an isolated inline viewer and download, self-hosted assets with no CDN, phone and desktop. A PDF surface is designed as its own isolated surface and never widens the reader frame's sandbox or the shell CSP;
   - tracker links: generic regex and URL templates in Settings, with matches resolved, non-matches left as text, and no tracker hardcoded;
   - print and figure-overlay Back-to-close, without `allow-modals`.
3. Amend the rich-docs spec's parity table row by row, each change marked "(amended 2026-11-18; X2 parity design)". Change no other section of that spec. If another section must change, ask.
4. New server surfaces (a root registry, a stream, a PDF route) name their gate under the box-token census rules in the project CLAUDE.md, and their ring placement. A new storage owner or endpoint is designed here, not built.

Your leaf plan may split implementation into several waves. Order them so that each is independently reviewable, and name file ownership that is disjoint from the appearance wave (X1) and the draft-review wave (X3), which run beside you. If the whole inventory and design do not fit one context, stop after the inventory and design, and tell me. I then dispatch the leaf plans as their own wave.

Acceptance: map onto Task 17's Outside folders, Layout variants, Large files, PDFs, Tracker links and Complete parity inventory rows.

Files: your new spec, your leaf plan or plans, and the rich-docs spec's parity table. Claim them first.

### X3 — run 2633

Programme `native-docs-reader`, wave 26 = X3, private draft-review sharing and its lifecycle (#1420), run 2633. Deviation block Issued: 8765, 8766 and 8767 (a reserve; none defined yet).

The operator's rulings, recorded in the ledger and not to be re-asked:
- #1420's 2026-10-25 comment: a frozen snapshot at share time, a "newer draft available" notice with re-share after later edits, and no live reads through the link.
- "Retirement drops no feature" makes draft review required before retirement.
- The current Share (a GitHub permalink) and Export (a self-contained file) are not the draft store.

Read #1420 and its comments, and the ledger's "Recorded draft decision" in full.

Still open, and yours to design, with alternatives in a table and a recommendation:
- Access: a capability link, or signed-in access, or both. Reconcile the recorded no-session acceptance criterion with the model you choose. Do not silently drop it.
- Reviewer comments: whether to adopt them at all. If adopted, they never count as merge approval.
- Revocation storage and retention.
- Hidden referenced assets: images, mockups and links the snapshot refers to.

The lifecycle to design, from Task 17's Draft review row:
- share, the draft banner, and shared bytes that do not change after edits;
- the newer-draft notice and re-share;
- a time-to-live from the last view, and early removal when the same file's branch commits;
- Pin and Revoke in the UI, and retention;
- an immediate 404 once revoked, and unreadable after expiry.

The threat model comes first in the spec, as its own section:
- who can read, and how a link can leak;
- enumeration and guessing;
- exposure of private content through an origin reachable from outside;
- behaviour with the console's auth gate armed and unarmed;
- what a snapshot may and may not carry (secrets, other files, live reads);
- denial of service through snapshot size and count.

Every new route names its gate under the box-token census rules in the project CLAUDE.md. A new storage owner names its durability, backup and purge. Nothing is built in this wave.

Measure first: how Share and Export build their bytes today, how the docs routes read committed and draft content, and what the auth gate exempts. Reuse what exists rather than adding a second path.

Raise to me as asks only the choices the operator must make: access model and comments are likely ones. Your spec's Waiting on you lists them with your recommendation.

Acceptance: map onto Task 17's Draft review row, including the no-session criterion.

Files: your new spec and leaf plan, with file ownership disjoint from the appearance wave (X1) and the parity wave (X2), which run beside you. Claim them first.

### Common to X1, X2 and X3

Common to the three extension design waves (appearance, parity, drafts), which run side by side:
- Plan: completion plan `docs/superpowers/plans/2026-11-07-native-docs-reader-completion.md`: the "Required follow-ons" row of Delivery units, Task 16 steps 1-2, and Task 17's "Required extension acceptance matrix" (your design must make its rows executable).
- Specs: completion design `docs/superpowers/specs/2026-11-07-native-docs-reader-completion-design.md`; rich-docs `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md`; base `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md`.
- Ledger: `docs/superpowers/programs/native-docs-reader.md`, Carried constraints and the operator rulings named in your wave's section. Waves A to D are merged; read shipped source, not plan anchors.
- Base: `main` as your fresh workspace finds it.

What you deliver, in one PR:
1. A design spec, `docs/superpowers/specs/2026-11-18-native-docs-<topic>-design.md`. Start from `~/.claude/templates/superpowers-spec.md` and follow its header rules: In short, numbered sections, Mermaid figures each with an italic caption, decision tables, and a closing Where things stand. The operator reads for outcomes and direction, not detail: keep Waiting on you to the genuine product choices, each with your recommendation.
2. A leaf implementation plan, `docs/superpowers/plans/2026-11-18-native-docs-<topic>.md`, written with the writing-plans skill. Name the implementation waves, their order, the files each owns, the interfaces and the mutation rows. Its acceptance rows must map one to one onto Task 17's matrix rows for your capability.
3. Results: a short section at the end of your leaf plan with what you measured and read, the commands you ran, and your asks.

Routing (clause 13): main loop Opus · high, xhigh at each design decision. Sonnet · medium Agent subagents for fact checks against source. Every Agent call names model and effort literally, never Fable. Workflow off. Before your wave-done, run one Opus · high Agent pass over your own spec as an adversarial reader (boundaries, threat model, testability), and fix or record what it finds.

Standing boundaries (not re-opened by a design):
- Reader sandbox exactly `allow-scripts`, shell CSP `frame-src 'none'`, no parent-DOM access and no extra message channel. A design that needs any of these widened is a stop-and-ask, never a proposal.
- Both 2026-11-06 phone blocks stay byte for byte, and the existing tap, one-bar and desktop-fit budgets stand.
- `@synapsium-labs/docserver` stays exactly 1.1.0 in this wave. A library change is designed here, not made, and its release and signed tag are the operator's.
- No live service, unit, proxy or config is touched or read for its private values. The standalone reader is retired only by the operator, later.

Public repository. Nothing private, ever:
- Describe the standalone reader by role, as "the standalone reader". Never give its host, port, path, service, unit or directory name, or a URL to it.
- You may read its source on this box to learn what it does. Cite behaviour, never its location.
- Private-name scan every file before each commit, and again before your push.

Asks: put each genuine product choice to me as a structured ask, with options and your recommendation. I answer what the ledger and the operator's rulings already decide, and pass the rest to the operator. A technical choice is yours: decide it and record why. Never re-ask a recorded operator ruling.

Deviations: a departure from the completion design, the rich-docs spec or an operator ruling gets the next number of your issued block. Define it in your leaf plan's `## Deviations found`, quote the sentence it departs from, and tell me. A departure from an operator ruling is not yours to define: ask. Block spent: write `D-TBD-<slug>` and ask.

Stop and ask: any source edit (this is a docs-only wave), any widening above, a library repo edit, any new storage owner or endpoint you cannot argue against the box-token census rules, or a refusal from any tool, hook or route.

Commit on `ws/<your slug>` only, never a separate feature branch. Claim your files first. One PR. List mail before your push, push once, get the exact-tip `ci` and `CodeQL` check green, then send wave-done with the fingerprint JSON and the suite and failure lines. Never enqueue or arm auto-merge.

## Earlier brief — D2, run 2436 (landed in #3026)

Dispatched as written below once this ledger PR merges; the issued block (D-8729 defined, 8730-8732 in reserve), the carried findings and the routing are in Decisions, 2026-11-18.

Programme `native-docs-reader`, wave 23 = D2, run 2436.
- Plan: completion plan `docs/superpowers/plans/2026-11-07-native-docs-reader-completion.md`, Tasks 13 and 14, with lab 10, the Global Constraints, the Review Focus and the per-wave acceptance contract.
- Specs: rich-docs `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md` (§4.1, §6, M8.1, E18); completion `docs/superpowers/specs/2026-11-07-native-docs-reader-completion-design.md`; base `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md`.
- Ledger: `docs/superpowers/programs/native-docs-reader.md` (Decisions, 2026-11-18).
- Base: `main` as your fresh workspace finds it. D1 merged as `8a6f62309` (#2989); its diff, history and version state, and its M8.B5 controls, are yours to consume, not to re-open. Re-anchor every Find against your base.

First item, before Task 13. Review run 2432's carries (report `~/.cc-clips/ccrc-pwa-docs-reader-d1-review3/review-2432-201ed358.md`), one commit each:
1. F1: the earlier-rows replay fence in D1's close.
   - Enumerate every plan's rows by each id's latest recording, reading both `file` spellings (with and without the package prefix) and `tests` as a string or an array.
   - Add the 45 rows run 2432 replayed red (43 W5P1 rows on `DocsScreen.tsx` and `DocsLeaf.tsx`; `W8A-T11-M4`, `-M5` and `-M13`), each with a count you measure.
   - `W5P1-T9-M19` survives at D1's base too: name it stale, not D1's, and retire it or re-record it on the live assertion.
   - Correct D1's "172", "50", "every earlier row" and "38 in scope" sentences in place, marked as D2's correction.
2. A1: fix round 2's sentence that the control "fails naming `timeout`" is false. Correct it, or poll the fallback reason first.
3. A2: `HookConfig.navigateTo`'s docstring.
4. A3: `fellBackFor` cannot read a reason containing a space, and the plan's order sentence for the load-first control is wrong.
5. C2's known duplicates: `DocImage.tsx`'s base64 loop (owner: `mockup/load.ts`'s `base64Of`) and `share.ts`'s worktree-label ternary (owner: `provenance.ts`). Replace each with its owner only as a behaviour-preserving substitution pinned by a test; otherwise record why not.

Then Task 13 as the plan writes it, with lab 10 and D-8729, then Task 14's close (the full suites, CarryReceipt rows, library C114's two missing rows recorded as library-owner maintenance). Results go under a "D2" heading.

D-8729, reader-mount-focus-yields-to-host, is defined in the plan's Deviations found and the ledger. On the Docs profile, mount focuses the frame only when no external host element owns focus. The bridge samples `el.ownerDocument.activeElement` once, after its last asset/Mermaid await and immediately before the synchronous `mountDocFrame`. A connected element other than `body` or the document element, outside the host, keeps its focus. Explicit reader commands still focus synchronously, and the lab profile keeps unconditional mount focus. Amend rich-docs §4.1's `Focus` row, §6's `Keys` row and M8.1 to say so, each marked "(amended 2026-11-18; D2, D-8729)". Keep the positive M8.1 contract and measure both focus mutations, as Task 13 says.

Lab 10 (a service worker never controls a sandboxed srcdoc child) is open: `browser/app.ts` blocks service workers. Measure it with a case or context that allows a real service worker, the actual library and the reader's sandbox. If that needs a harness change touching other browser files, or cannot be measured in CI at all, stop and ask; never route it to Task 17 yourself.

Interfaces:
- `readerMountFocusFor(profile: ReaderMountProfile | undefined, hostOwnsFocus: boolean): boolean` in `reader/policy.ts`.
- The decision is forwarded through the existing `focus` adapter key, with no intervening await and an unchanged key set.

Files: Task 13's Modify list; for the first item, the plan, `pwa/browser/reader-frame.browser.test.ts`, `DocImage.tsx`, `share.ts` and their tests. Anything else, ask first. Claim paths before editing.

Standing approvals, not re-opened:
- `@synapsium-labs/docserver` exactly 1.1.0, and no library change.
- Reader sandbox exactly `allow-scripts`; shell CSP `frame-src 'none'`.
- Both 2026-11-06 phone blocks byte-for-byte; production on request.
- No new endpoint, cache, exec verb, migration, storage owner or runtime dependency.
- Storage under `ccrc:reader:v1:`.

Deviations: D-8729 is issued and defined; reserve 8730, 8731 and 8732.
- A departure you find: define the next reserve number in the plan's `## Deviations found` in the same commit as the change, quote the sentence it departs from, name it in Results, and tell me in your next mail.
- A departure from an operator decision is not yours to define: ask.
- Reserve spent: write `D-TBD-<slug>` and ask.

Routing (clause 13):
- Main loop Opus · max. D1 ran there, its first wave-done was `suite: red`, `failure: shallow`, and it took three review rounds.
- Sonnet · high implementers.
- Opus · high per-task reviewers on Task 13 (focus and frame boundary) and on the first item's enumeration.
- Every Agent call names model and effort literally, never Fable.
- Workflow off; compact 40; browser on.

Tests:
- Heavy runs through `ccrc test`, foreground, timeout at least 600000 ms; package-local vitest.
- Mutation scratch outside the worktree, with saved-copy restore and a sha check.
- Browser rows with the actual library.
- Task 13 edits `reader-frame.browser.test.ts`: run it alone at least 10 times after your last change to it, and keep D1's two M8.B5 controls' meaning.
- The PR's fast CI skips browser tests; after your wave-done I dispatch a full run. Confirm 0 open code-scanning alerts at the tip.

Stop and ask: a library change or re-pin, a new endpoint or storage, a limit raised, a product choice the spec does not make, or a refusal from any tool, hook or route.

Commit on `ws/<your slug>` only. Public repository: nothing private. One PR. List mail before your push; push once; get the exact-tip `ci` and `CodeQL` check green; then send wave-done with the fingerprint JSON and the suite/failure lines. Never enqueue or arm auto-merge.

## Earlier brief — D1, run 2380 (landed in #2989)

Dispatched as written below once this ledger PR merges; the issued reserve, the D split and the routing are in Decisions, 2026-11-17.

Programme `native-docs-reader`, wave 22 = D1, run 2380. Completion plan `docs/superpowers/plans/2026-11-07-native-docs-reader-completion.md` Tasks 11 and 12, with its Global Constraints, Review Focus and "Per-wave brief and acceptance contract". D runs as two serial runs (coordinator, ledger Decisions 2026-11-17): this run is D1; Task 13 (reader, lab and header residue, the focus contract) and Task 14 (D's close) are D2, opened after this run lands, because Tasks 12 and 13 share `ReaderFrame.tsx`, `reader/policy.ts`, `reader/bridge.ts` and `docsLinks.ts`. Specs: completion `docs/superpowers/specs/2026-11-07-native-docs-reader-completion-design.md`; rich-docs `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md` (G6, G7); base `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md`. Ledger `docs/superpowers/programs/native-docs-reader.md`.

Base: `main` as your fresh workspace finds it. C2 merged as `62c1565d2` (#2969); B2's `DocsHistoryLoader` and version pages, and C1/C2's mockup pipeline, are yours to consume, not to re-open. Re-anchor every Find against your base before editing.

First item, before Task 11: review run 2378's findings on C2 (report `~/.cc-clips/ccrc-pwa-docs-reader-c2-review3/review-2378-0dc099d2.md`), one commit per finding, each closed by a test that fails without the fix:
1. F1: `MockupView` misses a sign-in that completes while its load is pending (the plan's viewer contract: an `auth` row reads again after sign-in). Subscribe at attempt start and latch a sign-in from then, as `ReaderFrame` now does; never read `isAuthLost` at attach time. Add a mid-load sign-in case and a mutation row red.
2. F2: plan row `C1-T7-auth-to-missing` no longer applies (its `old` line left `load.ts` in C2's M-c). Re-point it to `now()`'s line or mark it superseded with the reason, and correct "C1's loader rows stay red" to the rows actually replayed.
3. F3: the reader's no-401 `unwatch()` has no red test. Add a case that raises a sign-in after a walk with no 401 and counts live listeners, and its row.
4. Record full CI run 44085330692's hosted medians (reconstruction 213.6 ms, text-heavy 339.6 ms) in Results beside the earlier ones.

Then Tasks 11 and 12 as the plan writes them, and the close for this half: whole PWA unit, type and browser suites, related server rings/census/storage scans, the Task 11-12 row map, a sequential mutation table with restore hashes, and Results under a "D1" heading.

Files: Task 11's and Task 12's Create/Modify lists; for the first item `MockupView.tsx`, `ReaderFrame.tsx` and their tests; the plan's Results, task notes and Deviations found. Anything else, ask first. Take claims on your paths before editing; none overlapped at run-open.

Interfaces: exactly the plan's `ReaderDiff`/`readerDiff`, `ReaderCommit`, `ReaderVersionSeed`/`readerVersionSeed` and the optional `version`, `changes` and `openVersion` on `ReaderMountInput`. `bridge.ts` stays the only runtime library host import, type-tested both ways against `HostAdapters`. Lab mounts stay history-free.

Standing approvals, not re-opened: `@synapsium-labs/docserver` exactly 1.1.0 (its released `changes` contract, `removedAfter` 0 included, is the one you pin); diff limits 20 000 lines a side, the existing Docs byte cap, 2 000 000 work units and 512 output marks, overflow unavailable with no partial result; `only` lives in the visit's `history.state`, never the URL; no new endpoint, cache, exec verb, migration or storage owner; storage under the existing `ccrc:reader:v1:` prefix; production on request and both 2026-11-06 phone blocks byte-for-byte; reader sandbox exactly `allow-scripts`, shell CSP `frame-src 'none'`; no new runtime dependency.

Deviations: reserve 8716, 8717 and 8718 is issued to this run; no known departure is defined. A departure you find: define the next reserve number in the plan's `## Deviations found` in the same commit as the change, quote the sentence it departs from, name it in Results, and tell me in your next mail. A departure from an operator decision is not yours to define: ask. Reserve spent: `D-TBD-<slug>` plus an ask; I allocate.

Routing (clause 13): main loop Opus · max (C2 ran there; its first wave-done was `suite: red`, `failure: shallow`, and there is no higher rung); Sonnet · high implementers; Opus · high per-task reviewers on Task 11 (bounded work on untrusted text) and Task 12 (the adapter boundary), Sonnet · high on the first item; every Agent call names model and effort literally, never Fable; workflow mode off; compact 40; browser on.

Tests: heavy runs through `ccrc test`, foreground, timeout at least 600000 ms; package-local vitest, never bare npx; mutation scratch outside the worktree, saved-copy restore with sha check; browser rows with the actual library, not faked host callbacks alone. The PR's fast CI run skips the browser tests; make sure your new browser file is in the hosted browser leg's selection. After your wave-done I dispatch one full CI run on your tip. Before your wave-done, confirm open code-scanning alerts for your PR are 0 at the tip.

Stop and ask: a library change or re-pin, a new endpoint or storage, a limit raised, a product choice the spec does not make (copy, a control, a behaviour), or a refusal from any tool, hook or route.

Commit on this workspace's own branch `ws/<your slug>` only, never a separate feature branch. Public repository: nothing private in code, docs, commits or the PR. One PR. List mail before your push; push once; exact-tip `ci` and `CodeQL` check green; then wave-done with the fingerprint JSON and the suite/failure lines. Never enqueue or arm auto-merge.

## Earlier brief — C2, run 2342 (landed in #2969)

Dispatched as written below once this ledger PR merges; the issued reserve and the routing are in Decisions, 2026-11-17.

Programme `native-docs-reader`, wave 21 = C2, run 2342. Completion plan `docs/superpowers/plans/2026-11-07-native-docs-reader-completion.md` Tasks 8-10 (Task 10's C2 close), with its Global Constraints, Review Focus and "Per-wave brief and acceptance contract". Specs: completion `docs/superpowers/specs/2026-11-07-native-docs-reader-completion-design.md`; base `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md` §5.6-5.8 and §4.17. Ledger `docs/superpowers/programs/native-docs-reader.md` (Decisions, 2026-11-17).

Base: `main` as your fresh workspace finds it. C1 merged as `8d7189ce1` (#2915): the pre-scan, asset plan, bounded loader and CSP in `pwa/src/docs/mockup/**` are yours to consume, not to re-open. Read the plan's "C1 — run 2209" Results first: its "Blocked for C2" rows and its C2 carry list (among them `isMockupOrigin`'s digit-only labels, M5.22's rendering half, D-8662's Download, E3, E9, M5.EX3's script-text check) are part of this wave.

First item, before Task 8: review run 2318's minors from C1 (one commit per finding; line numbers are at `10d7bd81d`, which is `main`'s copy):
1. Completion spec :131 and :152 still state depth 256 as current: amend in place to 64, and have D-8695's definition name the completion spec among the sentences it departs from.
2. Base spec :70, the share-export row's decision 9 ("`MOCKUP_MAX_DEPTH` stays 256"): annotate it as amended 2026-11-16 to 64 under D-8695, and say in D-8695 that it supersedes that decision on the operator's answer to ask 457.
3. Plan :481, :487: present-tense facts from the old limits (the depth-256 worst case, 255 `<html a0..a63>` admitted, "33 inline svgs" which is now 17): correct them or mark them historical.
4. Plan :145 (Task 5's "allow depth 257"), :504-505 (present tense in the measurement history) and fix round 1's rows A6-ATTR, A6-DEPTH, A6-FORMATTING and A1-K1: mark superseded by the D-8695 rows, as fix round 2 did for the Task 6 rows.
5. D-8695's "at least 3.8x headroom": tags are 2.78x; say "at least 2.7x".
6. Stale test text: `mockup-prescan.test.ts:73` and `:416` (the title is off by one against its own assertions), `mockup-parse.browser.test.ts:97-99`, and `docs-scans.test.ts:1579` (cite review run 2281; plant a `ReadonlyArray<>` row or drop the claim).
7. Hosted margin: full CI run 43969306070 ran the browser gate on a hosted runner and passed it, but printed no medians, so the 2x hosted margin is unmeasured. Make the gated medians print whenever the browser leg runs in CI, with the 1 000 ms gate unchanged, and record that in Results. Prefer the test file over `.github/`.

Then Tasks 8 and 9 as the plan writes them, and Task 10's C2 half: whole PWA and browser suites, related server and agent guard suites, the M5/E row map (every row measured, existing evidence at the tip, or explicitly blocked), the synthetic CDN-module fixture in a desktop browser, and a sequential mutation table with restore hashes. Released-build phone and device rows stay open for Task 17: never claim them.

Files: Task 8's and Task 9's Create/Modify lists, the scans/censuses whose new owners need entries (each allowance with its own planted evasion control), and the plan's Results, task notes and Deviations found. Anything else, ask first. Take claims on your paths before editing; none overlapped at run-open.

Interfaces: consume C1's `prescanMockup`, `parseMockup`, `MockupAssetPlan` (keep `basis`, `admitted` and row indexes when rewriting rows), `loadMockupAssets`, `buildMockupSrcdoc`, `mockupCsp` and `parseMockupOrigin`/`HttpsOrigin`. Produce Task 8's `MockupViewProps`/`MockupFrameProps` and Task 9's `mockup` arm and `buildMockupSnapshot` exactly as the plan names them.

Standing approvals, not re-opened: reader sandbox exactly `allow-scripts` and shell CSP exactly `frame-src 'none'`; static mockups an empty sandbox, scripted exactly `allow-scripts`; CSP meta first, click guard second; no MessageChannel or message listener; second load tears down, never loops; HTML above 1 MiB tap-to-render, above 2 MiB download only; pre-scan limits 64/16/32/15 000 and the 1 000 ms browser gate; `@synapsium-labs/docserver` exactly 1.1.0; no new runtime dependency, second parser or Export builder.

Deviations: reserve 8711, 8712 and 8713 is issued to this run; no known departure is defined. A departure you find: define the next reserve number in the plan's `## Deviations found` in the same commit as the change, name it in Results, and tell me in your next mail. Reserve spent: `D-TBD-<slug>` plus an ask; I allocate.

Routing (clause 13): main loop Opus · max, one rung above C1's xhigh because C1's first wave-done was `suite: red`, `failure: shallow`; Sonnet · high implementers; Opus · high per-task reviewers on Tasks 8 and 9 (untrusted input and frame/export boundaries), Sonnet · high on the first item; every Agent call names model and effort literally, never Fable; workflow mode off; compact 40; browser on for the viewer's visual checks at phone and desktop widths.

Tests: heavy runs through `ccrc test`, foreground, timeout at least 600000 ms; package-local vitest, never bare npx; mutation scratch outside the worktree, saved-copy restore with sha check. The PR's fast CI run skips the browser tests: a green `browser (pwa)` job there is not a browser pass. Make sure your new browser files are in the hosted browser leg's selection. After your wave-done I dispatch one full CI run on your tip.

Stop and ask: any sandbox/CSP widening, a limit raised, a new dependency, a second parser, a product choice the spec does not make (copy, a control, a behaviour), or a refusal from any tool or route.

Commit on this workspace's own branch `ws/<your slug>` only, never a separate feature branch. Public repository: nothing private in code, docs, commits or the PR. One PR. List mail before your push; push once; exact-tip `ci` and `CodeQL` check green; then wave-done with the fingerprint JSON and the suite/failure lines. Never enqueue or arm auto-merge.

## Earlier brief — A, library 1.1 take-up and Settings access (landed in #2806)

**Entry status (2026-11-10):** #2346 and #2350 merged; existing run 1532 is still planned and undispatched after the coordinator missed resumption. Claim 3862 is absent, not explicitly released. R9 source reconciliation passed bounded preflight; review 17245 found a missing durable appearance gate and three Minors, now corrected along with the directly verified #1418/#1420 retirement scope. Exact-head independent closure, CI and protected landing remain before dispatch. Fresh claims/source/release gates remain. Open B1 before A closes; first rollout containing B1 is server-first. Required extension delivery and F acceptance precede operator-controlled retirement.

### A baseline reconciliation — 2026-11-10 (R9 candidate)

The original 38-path source gate correctly stopped before the Find inventory when main moved beyond C16. Read-only comparison from `8b0fab68f1de802f3952b8ec24f2ee93f76a8574` to `d452cfc356dde01344d06e1a2da132746d94870e` found exactly three changed declared paths:

| Path | Landed change | A obligation |
|---|---|---|
| `pwa/src/fleet/settingsText.ts` | #2537 adds the Project linking card copy | Preserve that addition; Task 9 adds only the sibling diagnostic purposes, not a replacement card record |
| `pwa/test/settings-frame.test.tsx` | #2537 adds Project linking to the Security card order | Preserve that card-order expectation while changing only the Settings-index scopes named in Task 9 |
| `pwa/test/control-census.test.ts` | #2544 adds two unrelated ghost-anchor census entries | Preserve both entries; Task 6 changes only its declared Docs control entries |

No other declared path changed. The adoption plan is byte-identical (SHA256 `996cd54a1ebacd332e92ec655d4001331cba76d557e4986d988759d9618b7330`); every Find mapping, all 38 gate paths, both phone blocks and the issued block remain unchanged. Only the checker's source pin changes. The candidate measured SOURCE-BASE-OK 38 and FINDS-OK 83 directives / 82 baseline / 1 deferred intermediate / 0 misses at that successor base. Negative controls rejected both altered plan bytes and old-base source drift before writing any receipt. This is preflight evidence, not a product test or an independent approval. Any further declared-path drift still stops for a fresh narrow reconciliation. A's worker records its actual BASE and re-runs the same gate there.

### Operator amendment — native visual continuity and legacy decoupling (2026-11-10)

The operator requested the necessary legacy decoupling and clarified the visual requirement: the reader should use the same skin and theme choices as ccrc, open with ccrc's selected appearance, and feel like part of the same environment rather than a separate destination. This is required programme scope, not an optional Later item or a claim that it has shipped.

- **One native path.** Keep the shared rendering library and native Docs routes. Remove remaining legacy preview/proxy integration in the existing verified cutover order; do not add a fallback to the standalone HTTP server. Task 18 still owns the operator-controlled infrastructure acts, after F's prerequisites. This request is not a shortcut around the live-unit/config safety boundary or permission to break previews before their native replacement is verified.
- **One appearance authority.** Reuse ccrc's canonical skin and theme catalogue and preference source. Current skins are Refined and Instrument; the theme catalogue has twelve named palettes plus Follow the system. Do not hand-maintain a second selectable list. The frame must open with the host's resolved appearance; continuing to follow host changes while open is the coordinator's integration default. A stale reader preference must not override that appearance.
- **Native visual language.** Align surfaces, text/accent/semantic colours, typography, borders, focus treatments, controls and density with the surrounding ccrc skin. Preserve the rich document's reading layout, figures, tables and accessibility. A colour-mode-only approximation is insufficient: the current adapter collapses named palettes to light/dark/auto and sends no skin.
- **Boundary and controls.** Rendering styles and any necessary checked-preference extension belong to the shared library; ccrc owns its appearance preference and the adapter. Use the existing checked bridge, never parent-DOM access, an extra renderer/message channel, arbitrary stylesheet injection, or a sandbox/CSP widening. Keep one frame Aa for reader-local settings. Coordinator default: while hosted by ccrc, Aa's global appearance follows ccrc rather than creating a persistent conflicting reader theme; reading-specific width/font/fold choices remain separate. Exact API, catalogue-sharing mechanism and compatibility design require a scoped follow-on design/review before implementation. These are requirements, not an approved appearance design.
- **Delivery placement.** A remains the approved exact 1.1.0 adoption, with no shared-library or theme implementation added to its worker scope. Specify and execute the additional shared-renderer/consumer appearance work after A and before the final E/F candidate is accepted; do not alter the published 1.1.0 tag or pretend that its adoption supplies named themes. Its acceptance matrix must discover the host catalogue, cover both skins and every palette/system transition, changes during lazy start and while open, readable diagrams/code/tables, focus/contrast, and the existing one-bar/tap/desktop-fit budgets. Existing release, independent-review and signing boundaries still apply.
- **Share remains truthful.** Existing Share uses a device share sheet or Copy link for a GitHub permalink to a committed, origin-verifiable version. It grants no repository or console access and does not publish drafts. Export is the separately approved self-contained rendered HTML option. The distinct private draft-review snapshot/lifecycle requirement in #1420 remains required before retirement under #1418; the current Share implementation does not supply it. General public publishing outside that scoped draft-review feature is not authorised by the appearance request.

### A — released library take-up and Settings access

Run 1532, native-docs-reader wave 17. Execute only Tasks 1–10 of `docs/superpowers/plans/2026-11-05-native-docs-reader-library-1-1-take-up.md`, with completion Task 2 and its design. Read `docs/superpowers/programs/native-docs-reader.md` current A brief and its issued definition. No W5b, W6, history/diff or focus-repair implementation in A.

#### Base and scope
Source pin `d452cfc356dde01344d06e1a2da132746d94870e` includes C16; ledger reconciliation preserves #2480/#2537/#2544. Claim 3862 is absent. Worker freshly claims every declared A path, all three Task 8 specs and the take-up plan; coordinator claim 3888 covers only the programme ledger. Record child HEAD as BASE. Checker gates pin→BASE on all 38 declared paths, not broad roots/plan/ledger; further drift stops for rebrief. Recheck claims before shared-file tasks.

Plan Files/byte-identical constraints apply to worker BASE→HEAD. No extra edit without scoped leave; markup census is run-only. Claim before subagent edits. Coordinator owns the programme ledger, not the worker SDD progress ledger. Scratch is session-temp.

Task 1: all T1 predicates. Extract ledger “A Find-check artifact” Python to session temp, SHA256 `dca1aa33659b402c2682d29bc357d9eec558a6ecd1a33a761cbb4fedff9f403f`; run `python3 -I <script> <plan> HEAD <fresh-receipt.json>` at repo root. It asserts exact plan SHA256 before its line inventory and source gate. Expected SOURCE-BASE-OK then FINDS-OK: 83 directives, 82 baseline, one Task 4 interim Find deferred until Task 3. Miss → stop-and-ask. Before edits, fresh post-C16 PHH-FIGURE / T10-FIGURES worst BASE through ccrc test; no historical geometry substitution.

CCRC_CHROME=$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome (worker rechecks).

#### Released dependency and approved decisions
Exact `@synapsium-labs/docserver@1.1.0`, v1.1.0 at `50cef012aa671974473d19c2acd77f900e9d03af`, release run 42245203228 attempt 2 success. Registry/release re-read. Integrity `sha512-r2YCt15tGxOYKK1ONyZ/TzvpMdcC3bmUJvifmTdtrCPHxy8DG5nc65ImUi9RpPf+M82784HwMt52kdnkYcpqUg==`. Task 1/2 recheck registry/lock/tarball attestation/signatures; difference stops. No signing/publication repeat.

Item 48 approved Q1–Q3: after-ready only if every supplied Mermaid block holds; otherwise on-request. Frame Aa only. Share/Export/View on GitHub in title details, no extra menu. Both original blocks follow verbatim. Record E17-READING does-not-hold; E17-BLOCKS 2; arm B with a block. Never average/replace the failure or treat auto/1.0.0 as after-ready/1.1.0 evidence. E18 coverage limits remain; no repeated historical phone request.

#### Issued departure and routing
Issued block 8143–8146. D-8143: retain the lab-draw auto mode and ready gap window. This departs from reader-lab design RL14, §8, Later and Figure 4's caption automatic-flip commitments; Task 8 amended RL14, §8 and Later, and Figure 4's caption was amended in `63b383b34`, the Task 10 review fix. Auto/1.0.0 does not measure after-ready/1.1.0; production remains on request. The reserve was used in full: D-8144, D-8145 and D-8146 are defined in the plan's `## Deviations found` (Decisions, 2026-11-15); never mint mid-wave. Task 10 reconciles the plan's definition and any reserve actually used, with unused numbers written bare. Existing run; no replacement/reopen.

Shape: dependent implementation chain. Route class opus, effort high, subagent sonnet, workflow off, compact 40, browser on. Native sonnet/high implementers; only Task 8 mechanical docs may use sonnet/medium. Per-task reviewers: opus/high for 4/5/6/7/9; sonnet/high for 2/3; sonnet/medium for 8. Task 10 internal held-out pass: three opus/high lenses (correctness; spec/boundaries; reproduction/evidence), critical/important findings each receive three independent sonnet/high refuters and majority adjudication, minors one advisory refuter. Explicit model/effort; no inheritance/Fable. Retain actual model/configuration; missing/mismatched reads are unverified. No worker Workflow. Subagent prompts forbid mail, pattern kills, gh writes, token argv and approval-prompting shell forms.

#### Acceptance and return
Follow plan red/green, independent sequential mutations and saved-copy/hash restore. Heavy suites/typecheck/browser/mutations through foreground ccrc test, timeout ≥600000 ms; bounded mutation time/process caps. Timeout/compile failure is not assertion-red. Task 9: two diagnostics after five sections, Array.from before map, shared row/copy owner, independent normal/modifier clicks, both skins, markup census and whole browser suite.

Preserve desktop fitting, truthful selectors and coarse-pointer floors. Phone-born host-bar persists on widening; desk-born frame retains its bar on narrowing. At 412×915: title ≤61 px, console ≤48 px, tap floor 44; tablet/desktop deltas ≤1 px from fresh BASE. Keep three Mermaid paths and lab auto/ready instrument. A does not fix the lazy-mount focus carry; D Task 13 owns it. Do not call mount.update().

Task 10: ONE PR, full-file privacy scan rc0/zero and mail before push/wave-done. Exact-tip fast CI; skipped browser is not execution. Return tip/PR, BASE+end figures, task/mutation evidence, deviations, actual review/configuration and failures/limits; stop changing/pushing pending ruling. Separate independent review/queue. No release/rollout/retirement. Commit on the workspace branch, never a separate feature branch.

Commit last line: Co-Authored-By: Claude Code <noreply@anthropic.com>
PR last line: 🤖 Generated with [Claude Code](https://claude.com/claude-code)

#### Original phone blocks

```text
reader-lab 1 · Blink 156 · Android · 8 cores · worker yes · frame sandbox yes · csp attribute yes · library 0079625cc30a
E18 walls: 7 of 7 hold; teardown signal holds
  opaque-origin      holds
  no-ambient-state   holds
  no-cookie          holds (5 arrived, 0 with the cookie; the control carried it)
  csp-27             holds (0 of 27 reached; 26 measured; not measured: iframe; library 0 of 1 attempted)
  no-popup-top-nav   holds
  no-self-navigate   holds (attempt seen: second load)
  bridge-strays      holds (8 sent, 0 effects; observed navigate, hash, copy; store.set and a same-source-only listener not exercised)
  self-nav-teardown  holds (second load fired)
E17 responsive (mermaid budget 200 ms):
  busy-frame         shared thread (longest gap 2994 ms in a 3000 ms spin; watchdog timer 2520 ms late; shared-thread evidence: gap and timer)
  mermaid            does not hold (longest gap 217 ms, all six together; worst single: figure 4, 150 ms)
    gaps ms          none 17 ready · trivial 100 ready · f1 133 ready · f2 133 ready · f3 133 ready · f4 150 ready · f5 142 ready · f6 125 ready · all 217 ready
draw on open: needs one figure per task here; every single figure fits the budget
door: 48 counted, 0 ignored; session cookie sent
```

```text
reader-lab 1 · Blink 156 · Android · 8 cores · worker yes · frame sandbox yes · csp attribute yes · library 0079625cc30a
E18 walls: 7 of 7 hold; teardown signal holds
  opaque-origin      holds
  no-ambient-state   holds
  no-cookie          holds (5 arrived, 0 with the cookie; the control carried it)
  csp-27             holds (0 of 27 reached; 26 measured; not measured: iframe; library 0 of 1 attempted)
  no-popup-top-nav   holds
  no-self-navigate   holds (attempt seen: second load)
  bridge-strays      holds (8 sent, 0 effects; observed navigate, hash, copy; store.set and a same-source-only listener not exercised)
  self-nav-teardown  holds (second load fired)
E17 responsive (mermaid budget 200 ms):
  busy-frame         shared thread (longest gap 2992 ms in a 3000 ms spin; watchdog timer 2516 ms late; shared-thread evidence: gap and timer)
  mermaid            holds (ready; longest gap 192 ms, all six together; worst single: figure 5, 150 ms)
    gaps ms          none 17 ready · trivial 108 ready · f1 133 ready · f2 125 ready · f3 133 ready · f4 133 ready · f5 150 ready · f6 125 ready · all 192 ready
draw on open: fits the budget here, though the frame shares the thread
door: 48 counted, 0 ignored; session cookie sent
```

### A Find-check artifact

Copy only this Python fence to session temp, preserving its final newline. Script SHA256 `dca1aa33659b402c2682d29bc357d9eec558a6ecd1a33a761cbb4fedff9f403f`. It asserts adoption-plan SHA256 `996cd54a1ebacd332e92ec655d4001331cba76d557e4986d988759d9618b7330` before using the line mappings. Run from repository root with the plan path, actual BASE and a new receipt path. It compares the explicit 38-path File Structure scope below, not broad byte-identical roots, plan or programme ledger. It deliberately defers Task 4's intermediate call until Task 3. A plan revision requires a fresh inventory and pinned hash, not silent reuse. Only read-only git commands and a new receipt write; no product execution.

```python
"""Check the adoption plan's explicit Find inventory against an immutable git base.
No edits, live/product calls, or commands beyond read-only git show/diff.
"""
from pathlib import Path
import subprocess, re, json, sys, hashlib, datetime
plan=Path(sys.argv[1]); base=sys.argv[2]; output=Path(sys.argv[3])
assert not output.exists(), 'Use a fresh receipt path.'
expected_plan_sha256='996cd54a1ebacd332e92ec655d4001331cba76d557e4986d988759d9618b7330'
assert hashlib.sha256(plan.read_bytes()).hexdigest()==expected_plan_sha256, 'Plan bytes changed: re-inventory; do not reuse these line mappings.'
source_pin='d452cfc356dde01344d06e1a2da132746d94870e'
# Exactly the File Structure paths, expanding shorthand and the three specs.
# Includes all four new paths and the run-only markup census. Excludes the plan,
# programme ledger and broad byte-identical roots; those constrain BASE..HEAD.
source_paths=['pwa/package.json', 'pwa/package-lock.json', 'pwa/test/reader-pin.test.ts', 'pwa/src/docs/reader/policy.ts', 'pwa/test/reader-policy.test.ts', 'pwa/test/reader-commands.test-d.ts', 'pwa/src/docs/reader/bridge.ts', 'pwa/test/reader-bridge.test.ts', 'pwa/test/reader-lab-bridge.test.ts', 'pwa/test/reader-lab-window.test.ts', 'pwa/src/readerLab/run.ts', 'pwa/src/docs/readerBar.ts', 'pwa/src/docs/ReaderFrame.tsx', 'pwa/src/screens/DocsScreen.tsx', 'pwa/test/reader-frame.test.tsx', 'pwa/src/docs/docsHeadWords.ts', 'pwa/src/docs/DocsHead.tsx', 'pwa/src/docs/docsText.ts', 'pwa/src/docs/docs.css', 'pwa/design/audit.mjs', 'pwa/test/docs-one-bar.test.tsx', 'pwa/test/docs-compact-head.test.tsx', 'pwa/test/docs-desk-head.test.tsx', 'pwa/test/docs-compact-css.test.ts', 'pwa/test/tap-targets.test.tsx', 'pwa/test/control-census.test.ts', 'pwa/browser/docs-compact-head.browser.test.ts', 'pwa/browser/reader-frame.browser.test.ts', 'docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md', 'docs/superpowers/specs/2026-10-01-native-docs-reader-design.md', 'docs/superpowers/specs/2026-11-03-reader-lab-design.md', 'pwa/src/screens/settings/SettingsIndex.tsx', 'pwa/src/fleet/settingsText.ts', 'pwa/test/settings-frame.test.tsx', 'pwa/test/settings-screen.test.tsx', 'pwa/test/command-layer.test.tsx', 'pwa/test/command-registry.test.ts', 'pwa/test/markup-census.test.ts']
source_gate=subprocess.run(['git','diff','--no-ext-diff','--quiet',source_pin,base,'--',*source_paths],capture_output=True,text=True)
assert source_gate.returncode==0, 'Source drift or unmeasurable diff: stop and rebrief; rc='+str(source_gate.returncode)
print('SOURCE-BASE-OK',len(source_paths),'explicit paths; pin',source_pin,'base',base)
lines=plan.read_text().splitlines(True)
ranges=[(310,310,'pwa/test/reader-bridge.test.ts'),(323,430,'pwa/src/docs/reader/policy.ts'),(431,673,'pwa/src/docs/reader/bridge.ts'),(674,674,'pwa/src/readerLab/run.ts'),(807,943,'pwa/src/docs/ReaderFrame.tsx'),(944,980,'pwa/src/screens/DocsScreen.tsx'),(1036,1036,'pwa/test/docs-compact-head.test.tsx'),(1064,1064,'pwa/test/docs-desk-head.test.tsx'),(1097,1097,'pwa/test/tap-targets.test.tsx'),(1098,1098,'pwa/test/control-census.test.ts'),(1107,1107,'pwa/src/docs/docsText.ts'),(1128,1154,'pwa/src/docs/DocsHead.tsx'),(1155,1155,'pwa/src/docs/docsHeadWords.ts'),(1182,1349,'pwa/src/docs/DocsHead.tsx'),(1350,1393,'pwa/src/docs/docs.css'),(1394,1394,'pwa/design/audit.mjs'),(1405,1405,'pwa/src/docs/docs.css'),(1498,1501,'pwa/browser/reader-frame.browser.test.ts'),(1533,1594,'docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md'),(1596,1607,'docs/superpowers/specs/2026-10-01-native-docs-reader-design.md'),(1609,1619,'docs/superpowers/specs/2026-11-03-reader-lab-design.md')]
cache={}; rows=[]; ignored=[]
for idx,line in enumerate(lines):
 n=idx+1
 if not 300<=n<1620: continue
 positions=list(re.finditer(r'\bFind\b',line))
 for k,m in enumerate(positions):
  tail=line[m.end():positions[k+1].start() if k+1<len(positions) else len(line)].rstrip('\n')
  if ':' not in tail:
   ignored.append({'line':n,'reason':'not a Find directive'});continue
  prefix,suffix=tail.split(':',1); suffix=suffix.lstrip()
  if n==618:
   rows.append({'line':n,'phase':'after-task-3','baselineExcluded':True,'reason':'Task 4 Step 0 checks this after Task 3, as the plan explicitly says.'});continue
  file='pwa/test/reader-bridge.test.ts' if n==476 else next((p for lo,hi,p in ranges if lo<=n<=hi),None)
  assert file is not None,(n,'unmapped Find')
  if suffix.startswith('`'):
   ends=list(re.finditer(r'`(?=(?: — Replace|; Replace| inside the loop|\)| followed by|$))',suffix[1:]))
   assert ends,(n,'unparsed inline Find')
   text=suffix[1:1+ends[0].start()]
  elif 'the line starting `' in suffix:
   text=suffix.split('the line starting `',1)[1].split('`',1)[0]
  else:
   assert not suffix,(n,'unexpected Find suffix',suffix)
   j=idx+1
   while not lines[j].strip():j+=1
   first=lines[j].strip()
   if first.startswith('`') and not first.startswith('```'):
    assert first.endswith('`'),(n,'unclosed following inline Find')
    text=first[1:-1]
   else:
    assert lines[j].startswith('```'),(n,'no following Find fence')
    j+=1; block=[]
    while not lines[j].startswith('```'):block.append(lines[j]);j+=1
    text=''.join(block).removesuffix('\n')  # Fence terminator newline is not part of a quoted substring.
  assert text,(n,'empty Find')
  if file not in cache: cache[file]=subprocess.check_output(['git','show',base+':'+file],text=True)
  count=cache[file].count(text)
  row={'line':n,'ordinal':k+1,'file':file,'text':text,'matches':count,'sha256':hashlib.sha256(text.encode()).hexdigest()}
  rows.append(row)
  if count!=1:print('FIND-MISS',n,file,'count',count,repr(text[:240]))
# Also pin the prose-described browser adjacency, not just its click line.
browser=cache['pwa/browser/reader-frame.browser.test.ts']
click="    await frame.locator('.fig-render-btn').click();"
assert browser.count(click)==1
at=browser.index(click); next_line=browser[at:].splitlines()[1]
assert 'waitForFunction' in next_line, next_line
failures=[r for r in rows if not r.get('baselineExcluded') and r['matches']!=1]
result={'measuredAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'planSha256':hashlib.sha256(plan.read_bytes()).hexdigest(),'base':base,'sourcePin':source_pin,'sourceGatePaths':source_paths,'sourceGateRc':source_gate.returncode,'rows':rows,'ignoredMentions':ignored,'sourceSha256':{p:hashlib.sha256(t.encode()).hexdigest() for p,t in cache.items()},'browserClickFollowingLine':next_line,'coverage':'Every explicit Find directive in Tasks 3-8, including both same-line Finds; Task 4 interim Find is deliberately deferred. Prose-only implementation instructions are not represented as literal Find blocks.','state':'failed' if failures else 'verified'}
output.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
print('FINDS-OK' if not failures else 'FINDS-FAILED',len(rows),'directives;',len(rows)-1,'baseline;',1,'interim;',len(failures),'misses')
raise SystemExit(bool(failures))
```

## Historical briefs below — retained audit, not current dispatch instructions

These Export/W5h/Share/part-1 briefs describe completed waves. The current A–F completion line above supersedes their next/after wording. Do not redispatch a completed run from them.

## Historical Export brief — completed in #2237

The operator approved the plan on 2026-11-03 with every recommendation (Q1 A, one run). Run 1368 dispatches once the plan is on `main`.
- **Plan:** `docs/superpowers/plans/2026-11-03-native-docs-reader-w5-part2-export.md`, Tasks 1 to 13, in order. It reads W5h-a's store by `peek` and, for each drawn copy, `copySkip` (D-7762). It holds the `publish` slot (D-7755), and treats a fallback body's `publish(null)` as a body with no highlighting to wait for (D-7763). It adds Export's clause through Share's seam.
- **Deviations:** at least 14 numbers, minted at the run's opening, for (a), (b), (c), (e), (f), (g), (h) and (w) in that order; the rest are for departures found while executing.
- **Lessons the brief carries:**
  - the close runs the whole `server` suite in pieces, because other programmes' closed censuses reach PWA words;
  - the browser files run locally, because the PR's CI skips them;
  - unused issued numbers are written without the prefix;
  - a review child may run `npm ci` in its own `server/`, `pwa/`, `agent/` and `ui/`;
  - a test that holds the in-thread highlighter waits for the request before `release()`, because a code block posts it from an effect React may run after the plain frame (#2192);
  - a `docs-scans` describe that copies `pwa/src` carries `{ timeout: 30_000 }` (#2192; the plan's own clause already does).
- **Parallel work:** no other Docs wave runs beside Export. Its census and scan files are shared with other programmes; each edit is one entry or an appended describe.

## Historical W5h-a and Share brief — both merged 2026-11-03

W8a is accepted (2026-11-01, #2061). W8b follows W5b, and starts from the W8a residue in Carried constraints.

Part 1 merged on 2026-10-19 (#627), so this brief is now the next dispatch. Two runs dispatch in parallel: W5h-a and Share (the operator ruled W5h and Share in parallel on 2026-10-15; W5h-a is the coordinator's split of W5h). Export follows W5h-a and Share, and W5h-b follows the phone measurement.

- **W5h-a, highlighting off the main thread: the worker path.**
  - **Spec first:** the amendment to the 2026-10-01 spec, with the rich-docs spec's cross-references, merges before the plan is dispatched.
  - **Plan:** `docs/superpowers/plans/2026-11-02-native-docs-reader-w5h-a-highlight-worker.md`, written from the approved design: the pure grammar modules; a generic runner with a ready handshake and a detach abort; the highlight worker; the two singletons and the second chunk; the store; `CodeBlock` with the HTML check; the Docs and text-leaf wiring; chat; the scans; the measurement page; the constants at provisional starting values; the hand-off to Export; the library asks. Part 1's bounds stay in force throughout.
  - **Measurement:** once W5h-a is deployed, the operator opens the measurement page, behind the session gate, once on the phone.
- **W5h-b, the measured values and the retirement,** after that measurement. Its own plan, PR and review: the constants set to the measured values, then, in a commit of its own, all of part 1's main-thread highlight bounds retired, with their rows re-pointed. The retirement lands only if every real block, cold, finishes within the operator's per-block bound, with the deadline set between the slowest block and that bound; otherwise the numbers go to the operator.
- **Deviation blocks:** issued at each run's open.
- **W5 part 2, Share.** Its plan, `docs/superpowers/plans/2026-11-02-native-docs-reader-w5-part2-share.md`, takes the Share half of the 2026-10-13 Share/Export amendment. It renders no body and does not touch highlighting.
- **Then W5 part 2, Export,** after W5h-a and Share merge; it does not wait for W5h-b. It reads W5h's highlight store by peek only, waits for it to settle within the page ceilings, and says in its provenance when colouring was partial or dropped. It also carries M4.SH3's and M4.SH8's Export halves, moved from Share (2026-11-02).
- **Claims:** W5h-a and Share are checked against each other at dispatch. The second to merge takes `main` and re-measures.
- **Branch discipline:** commit on the workspace's own branch, never a separate feature branch.

## W5 part 1's brief, for run 413 (dispatched)

- **Plan:** `docs/superpowers/plans/2026-10-13-native-docs-reader-w5-part1-docs-screen.md`, Tasks 1-14. Task 13 is the held-out whole-branch review. Task 14 pushes and opens the one PR.
- **Base:** `main` at dispatch. The plan was written at `a59685566`, so any drift in its files is replayed and named in the brief.
- **Routing:** an Opus·high main loop with Sonnet·high implementers. Opus·high task reviewers and Task 13's panel. Workflows off, `compact 40`.
- **Branch discipline:** commit on the workspace's own branch, never a separate feature branch.
- **Deviation block:** 4917 to 4932. Task 12's Deviations step defines the plan's five departures with the first five numbers.
- **Claims:** the plan's shared-file list, checked at dispatch. A claim held by another run on `server/test/single-definition.test.ts` and `pwa/src/lib/api.ts` needs scoped co-edit terms: the second to merge keeps this wave's appended describe last.
- **Merge gate:** the operator's W3 dark rollout, then R2 and R1 (spec §7.8).
- **Carried constraints:** the list above.
