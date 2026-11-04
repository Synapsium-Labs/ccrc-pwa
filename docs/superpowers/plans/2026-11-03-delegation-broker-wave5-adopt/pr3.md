# Wave 5, PR3: `ws-add --base`, a start point only (task note)

This note is PR3's record for the wave's ledger pull request (Global Constraints, "Ledger edits"). The coordinator folds it into the
plan and the programme ledger. This PR edits no existing plan and not the programme ledger.

## Consent to edit files another run holds

- `ccd/ccd`, `server/src/ccdargv.ts`, `server/test/ccdCapTokens.ts`, `server/test/verb-gate.test.ts`,
  `server/test/whitelist-subset.test.ts`, `server/test/ccd-ws-lease-mark-argv.test.ts`,
  `server/test/delegation-wave3.integration.test.ts` and `CLAUDE.md`: under PR2's claim, by the coordinator's consent in PR3's brief,
  in PR3's own hunks only (`cmd_ws_add`'s `--base` arm, its usage string and the `cmd_caps` word; the `wsAddWorkerBase` key, its cap
  constant and its `CCD_CAN` row; the caps token; the W5-B* and W5-G16 to W5-G18 rows; the third `describe` of the argv test; the
  `W5_OPEN` row; and `ws-add --base` in PR1's coordination-invariant sentence).
- `shared/api.ts`: under PR2's claim, by the coordinator's consent (mail of 2026-11-04 answering PR3's question), for two lines only:
  the `startpoint` member of `LifecycleMeas` and its `LIFECYCLE_MEAS_KEY_MAP` entry (D-7980).
- `server/test/id-argv-census.test.ts`: under PR2's claim, by the coordinator's consent (mail of 2026-11-04 answering PR3's
  question after the first full CI run), for one token only: `wsAddWorkerBase: 'no-id'`, beside `wsAddWorker`.

## Files beyond the plan's list, with no departure

- `server/test/ccdArgvSamples.ts` (claimed by PR3): every `CCD_ARGV` key needs a sample, because `whitelist-subset.test.ts` and
  `ccd-verb-sets.test.ts` hold the sample keys equal to `CCD_ARGV`'s. The `wsAddWorkerBase` sample is what W5-G18's layer 3 builds.
- `server/test/lifecycle-wire.test.ts` (claimed by PR3): its two `LifecycleMeas` literals and key list gain `startpoint`; folded
  into D-7980's file list by the coordinator. The first full CI run caught it in the tests' own type check.
- `server/test/verb-gate.test.ts` (already on the list) gains `FLAG_GATED_ROWS`: until now every `ws-add` row was ungated by
  decision, and `wsAddWorkerBase` is the first that refuses on no evidence, so the table names it as the one exception and row
  W5-G17e holds it to `refuse`.

## Deviations found

D-7980 and D-7981 are defined in the plan's "Deviations found" (the coordinator's ruling of 2026-11-04, on wave 4's D-7869
precedent: deviation-refs' floor case reads definitions from top-level plans only). In short:

- D-7980 (`startpoint-is-a-declared-meas-key`): the new key reaches `LifecycleMeas` through `LIFECYCLE_MEAS_KEYS` and `reviveMeas`,
  so PR3 also edits `shared/api.ts` (two lines, by consent), `server/src/coord/journalparse.ts` and its test, with a skew row,
  and `server/test/lifecycle-wire.test.ts`.
- D-7981 (`base-object-type-not-peel`): the object check asks the object's type, not a peel, so an annotated tag's id is refused
  (W5-B4c, mutant W5-BM8).
