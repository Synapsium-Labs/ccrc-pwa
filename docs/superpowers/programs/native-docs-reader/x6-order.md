# x6-order: the Reader Mode ordering amendment (wave 41, run 3605)

The task note for wave 41 of the native Docs reader programme, for the coordinator to fold into the ledger. This wave changed documents only: no product code, package, lockfile, workflow or setting. Nothing was packed, installed or built.

## What landed

Dated amendments, each marked "Amended 2026-11-24". Results, Deviations found and the review and fix-round records of every plan are untouched.

- **Reader-mode plan** (`docs/superpowers/plans/2026-11-20-native-docs-reader-mode.md`): a Status note, notes under the waves table and under AR-X6, and § Amendment 2026-11-24. It holds:
  - the verification of the library's three statements;
  - §1, the slice;
  - §2, the new order with Figure A1 and each wave's tasks, files, tests, mutation rows, dependencies and overlaps;
  - §3, the rename;
  - §4, building ahead of publication;
  - §5, when Reader Mode is done;
  - the definitions of D-8974 and D-8975.
- **Reader-mode design** (`docs/superpowers/specs/2026-11-20-native-docs-reader-mode-design.md`): a line in In short, a note after §4.3, Figure 5a in §7.5, a note under the decisions table (R16, R20, R21) and a line under Agreed.
- **X2's parity plan** (`docs/superpowers/plans/2026-11-18-native-docs-parity.md`): a Status note, and § Amendment 2026-11-24 under the waves table (wave PH, the order, P5.1's new share).
- **X2's parity design** (`docs/superpowers/specs/2026-11-18-native-docs-parity-design.md`): Figure 7a in §9.
- **X1's appearance plan** (`docs/superpowers/plans/2026-11-18-native-docs-appearance-continuity.md`): § Amendment 2026-11-24 after the wave C file table (R is 1.2.0, the rename, built ahead), with the definition of D-8976.
- **X1's appearance design** (`docs/superpowers/specs/2026-11-18-native-docs-appearance-continuity-design.md`): one line under Later.

## For the ledger

- **Library check.** The brief's three statements hold at `996a39b2602d2e1e636c54c95cc9e403fe55cf88`, read as git objects:
  - the appearance contract;
  - the frame's `place` op and `hash {push, from}`;
  - LX6: `reading` and `reader`, their pacing, `setReading`, `onReader`, screen pages, the text size and `meta.readingMinutes`.
- **The order (D-8974, D-8975).** Wave C comes first. It re-pins to `@synapsium-labs/pinax-lib` 1.2.0, takes the rename, and does X1's Tasks 1 to 7. Wave PH follows: X2's Task P5.3 alone, the one part of P5 reader mode consumes. Then wave XR: reader mode as one wave, with screen pages by default and Scroll as a switch in the overlay. Then P6 and the rest of P5, with P5.1 taking reader mode's layout rule. P2 to P4 keep their order and may run beside C, PH and XR under claims. A scroll-only XR1 is not worth shipping apart: with LX6 in the same release, its remount, corner menu control, frame Aa and blur hide would only be built for XR2.1 to remove.
- **Departures.** All three issued numbers are spent, and none is left over:
  - **D-8974** reader-mode-first, defined in the reader-mode plan;
  - **D-8975** reader-mode-one-wave, defined in the reader-mode plan. It moves the layout rule, AR-X6's layout clause and FS-9 to P5.1, and records FS-10 against the overlay's Aa;
  - **D-8976** library-package-rename, defined in X1's appearance plan.
- **The rename** is wave C's Task 1, in two parts. Every import, test and script reference moves in its first commit, on the branch as built. Only the pin, the lock and the pin and asset tests' literals wait for the wave's last commit. It covers 24 files outside `docs/`:
  - `pwa/package.json` and its lock;
  - four source files;
  - fourteen pwa tests and one browser test;
  - `.github/ci/library-provenance.sh`;
  - `server/test/ci-pipeline.test.ts` and `server/test/docs-parity.test.ts`.

  Five more hits name the standalone docs server, not the library, and stay.
- **Building ahead.** Wave C, and PH on C's branch, can be built against a tarball packed from the verified commit. The tarball goes to the session temp root and is installed into `node_modules` without saving, with the coordinator's word. These wait for the registry: the exact pin, the lock's `resolved` and `integrity`, the pin tests' literals, the provenance check and the signature audit. The pull request opens only after six conditions hold, in order: the release resolves; the signed tag is on the commit; the attestation verifies with the new repository and signer; `npm audit signatures` is clean; the installed asset hashes equal the commit's; and the pin commit is last.
- **When Reader Mode is done.** Wave XR has merged through the common acceptance cycle, its release is installed, and AR-X6 passes as written, less its layout clause and FS-9, which run at P5.1. No setting is added: the Settings audit keeps per-device view state as a remembered toggle.
- **Overlaps.** None of C, PH or XR shares a file with PR #3138. Among the live claims on 2026-11-24, only `ui/src/index.ts` (XR1.2's exports) was held, by a desktop-polish fix round.

## Found in the brief

- One item of the brief's slice list is not P5's or P6's: "the `reader` place kind" is reader mode's own (XR1.3 adds it to P5.3's `Place.kind`). The amendment traces it that way. Nothing else in the brief was found false.
- `main` had moved from `b8242bfa98` to `2b5b5e32a6`, a measured descendant. The intervening commits touch none of these documents.

## Fix round 1 (review 3626 at `aa7f35875a`, the coordinator's rulings)

Documents only, one push. Results, Deviations found and the review records stay byte-unchanged, and no new departure is defined.

- **C1:** the rename's split is stated once, in the reader-mode plan's §3 and §4 and in X1's amendment. Every reference moves in Task 1's first commit, ahead of Tasks 2 to 7 and of PH, and only the registry-dependent pieces sit in the last commit. X1's Task 1 steps and Task 6 Step 1's BASE are reconciled by amendment note.
- **C2:** the design spec now has a governs sentence, and dated lines under the acceptance row, the FS table, Waiting on you, the device item, Agreed (the library pin, the XR1 line) and R11.
- **A1:** PH is built ahead on wave C's branch.
- **A2:** the governs clauses read "the rest of the plan" in the three plans.
- **A4:** the per-release import-list read sits in X1's Task 1 Step 1.
- **A5:** X6.20's red test follows XR1.3's rename.
- **A3, the coordinator's ruling:** with the overlay hidden, the leading focus guard sends focus to the frame, with a browser row and mutation row X6.77. It is a consequence of D-8975.
- **The refuted findings' residues:**
  - P5.1 plans a same-document remount during reader mode in the default layout;
  - PH's `onPlace` rides input presence in `bridge.ts`;
  - P2 to P4 share `pwa/package.json` and its lock, and `docs-parity.test.ts`, with wave C.
- **Two rows the definition of done needs:** first paint in reader mode on a new mount, and `off` sent to the new mount after a same-document remount (X6.78).
- **The HTML-artifacts plan's wave A5** still waits for P6, so it lands later under the new order.
