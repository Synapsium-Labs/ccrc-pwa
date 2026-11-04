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

## Files beyond the plan's list, with no departure

- `server/test/ccdArgvSamples.ts` (claimed by PR3): every `CCD_ARGV` key needs a sample, because `whitelist-subset.test.ts` and
  `ccd-verb-sets.test.ts` hold the sample keys equal to `CCD_ARGV`'s. The `wsAddWorkerBase` sample is what W5-G18's layer 3 builds.
- `server/test/verb-gate.test.ts` (already on the list) gains `FLAG_GATED_ROWS`: until now every `ws-add` row was ungated by
  decision, and `wsAddWorkerBase` is the first that refuses on no evidence, so the table names it as the one exception and row
  W5-G17e holds it to `refuse`.

## Deviations found

- **D-7980** — `startpoint-is-a-declared-meas-key` (Task 5.3.1 rule 5, D-7827): the plan's PR3 file list gains `shared/api.ts` (two
  lines), `server/src/coord/journalparse.ts` and `server/test/journalparse.test.ts`. Rule 5 puts `meas.startpoint` on the create row,
  and `ccd-lifecycle-contain.test.ts` checks every `meas.<key>` ccd emits against `LIFECYCLE_MEAS_KEYS`, which is derived from
  `LifecycleMeas`; `reviveMeas` returns that interface as a literal, so the compiler requires the new member there too. Without them
  the key would be dropped at ingest with nothing saying so, the failure mode `meas.unremoved` once shipped with. The member is
  `string | null` and read by `reviveMeas` alone: a line from a ccd that does not write it reads null (the skew row in
  `journalparse.test.ts`, on the `childRun` precedent of D-7278). No `FLEET_PROTO` change.
- **D-7981** — `base-object-type-not-peel` (Task 5.3.1 rule 3): the object check asks the object's own type,
  `git cat-file -t <id>` equal to `commit`, rather than `git cat-file -e "<id>^{commit}"`. The peel accepts an annotated tag's id and
  `git worktree add` would then start the tree at the tagged commit, a different id from the one named and the one journalled as
  `meas.startpoint`; Review Focus (3) asks that the start point be a full commit id. Row W5-B4c pins the refusal of a tag id. The
  check still runs under `_ws_reclaim_contained`, against the main checkout, before the disk floor, the placement read, the add lock,
  the worktree and the row.
