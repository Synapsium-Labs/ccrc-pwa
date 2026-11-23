# Wave 10: docs and issue reconciliation (docs-and-issues, with readme-anthropic-arm)

Programme `model-class-advance`, epic `acceptance`, tickets `docs-and-issues` and `readme-anthropic-arm`. Run 3500,
which replaces a failed spawn (run 3495). Docs and issue work only: no source, behaviour or fleet change. Built on `main`
at 31a07be5d0, which contains #3246 (merge 7ac5df4c96).

## What this PR changed

- **The spec** (`docs/superpowers/specs/2026-10-13-model-class-auto-advance-design.md`): its status line; §2.2's
  exception as the six-hour retirement rule (continuous fresh sightings, the catalogue's own fetch times, a gap of more
  than 90 minutes restarting the count, no wall-clock shortcut); §2.8's `model-held-behind` row, the wave 3 causes and
  the `model-release-lookup` check; the Shipped list; and "Waiting on you", which is now the live checks, none of them a
  step for the owner.
- **The programme ledger** (`docs/superpowers/programs/model-class-advance.md`): the merged follow-ups, the waves table,
  what wave 10 reconciled, the Models sheet after #3246, the issues read, the proposed done-when 3 correction, and a
  "Remaining" section that keeps merge, release, installation and live observation apart.
- **`fu-revert-holds-until-newer.md`**: D-8857's three ways to settle, review 3493's counts kept apart from the worker's,
  the cross-check against calls 469, 503, 527, 555 and 561.
- **The Anthropic arm's plan**: a correction under D-8751 to one push per class move, with the over-cap wording and the
  strong-timeout limit. Its head commit carries the `Ledger-Edit:` trailer.

## README, under consent, and what did not change

- **`README.md` (changed, under consent).** The README's claim holder consented to one unified diff against
  `31a07be5d0bb1f348c3ddbef3e4d2e3d63cb20c1` (nine hunks, 24118 bytes, sha256
  `fbd49c07b3dd15dc382eee7e7957db0700c245577615374f14d1d0673050642a`), applied byte for byte here. It replaces an earlier
  packet that review 3505 found imprecise (three kinds of hold under one rule, a rounding statement that fit only measured
  windows, two lines promising an indefinite hand hold). The consent covers that packet only; a changed line needs fresh
  consent. The hunks cover the context-window rule (D-8564's
  provider promise and the stale-catalogue notice), the Anthropic aliases file and idle relaunch, the retirement exception,
  Revert as the one brake, the Models sheet (the README said it had no PWA surface), the doctor causes and the pushes.
- **The `ccrc-models` test title.** The candidates read were accurate for what they assert, so none was confirmed stale and
  no test changed (no test run was needed).
- **The pinned done-when.** Statement 3's wording is flagged in the ledger, not rewritten.

## Issue dispositions

- **#2607: closes with this PR.** Its second residual, a stale catalogue under a class model with no measured window,
  falls to the client default; `clientWindowNotice` (D-8685, landed in #2943) names it in `show`, `lanes` and doctor's
  `models` row, beside #2701's notice for a move that lowered the window (D-8384). `server/test/model-advance-file.test.ts`
  and `server/test/models-op.test.ts` pin both. The window rule itself is D-8564, #2761.
- **#1441** is closed (the sheet, D-8690) and stays closed.
- **The Fable share ceiling and per-lane effort:** no issue exists (a search of open and closed issues found only #1441
  and the unrelated #1319, which is about Fable running only when selected). Proposed text, for the coordinator to file or
  decline:

  > **Title:** A per-lane view of the Fable share ceiling and per-lane effort
  >
  > The Models sheet (#3028, #3246) reverts a class and shows each lane's classes, pins and advance state. It does not show
  > or set the Fable share ceiling or a per-lane default effort. Those were part of #1441 and moved out of it
  > when it narrowed to the sheet. Open question: whether either belongs on the sheet, in settings, or in neither, given
  > that classes always advance and effort follows the class.
- **#2943** landed outside a run, so the landing line has no entry for it and the plan's `doctor-land` ticket stays open.

## Gates still open

`moves-only-forward` on the installed release, the Models sheet's live acceptance, `natural-move` at a real release
(a new session and 24 hours of doctor evidence), and the renewal programme's evaluation evidence.
