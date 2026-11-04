# Wave 5, PR3: `ws-add --base`, a start point only (task note)

This note is PR3's record for the wave's ledger pull request (Global Constraints, "Ledger edits"). The coordinator folds it into the
plan and the programme ledger. Apart from its own entries in the wave 5 plan's "Deviations found" (by the coordinator's ruling, with
a `Ledger-Edit:` trailer), this PR edits no existing plan and not the programme ledger.

## Consent to edit files another run holds

- `ccd/ccd`, `server/src/ccdargv.ts`, `server/test/ccdCapTokens.ts`, `server/test/verb-gate.test.ts`,
  `server/test/whitelist-subset.test.ts`, `server/test/ccd-ws-lease-mark-argv.test.ts`,
  `server/test/delegation-wave3.integration.test.ts` and `CLAUDE.md`: under PR2's claim, by the coordinator's consent in PR3's brief,
  in PR3's own hunks only (`cmd_ws_add`'s `--base` arm, its usage string and the `cmd_caps` word; the `wsAddWorkerBase` key, its cap
  constant and its `CCD_CAN` row; the caps token; the W5-B* and W5-G16 to W5-G18 rows; the third `describe` of the argv test; the
  `W5_OPEN` row; and `ws-add --base`'s sentence after PR1's coordination-invariant sentence).
- `server/test/verb-gate.test.ts`'s `FLAG_GATED_ROWS` exemption from the "ungated exactly when" assertion: consented in fix round 1.
  It is right because the assertion's premise, that a verb is ungated by decision on every row, stops holding the moment a verb
  gains a flag an older ccd does not know: `ws-add` stays ungated by decision, while its `--base` row must refuse on no evidence. The
  exemption names that one row, and row W5-G17e requires it to be a `refuse` capability row of an ungated verb, so it weakens
  nothing.
- `shared/api.ts`: under PR2's claim, by the coordinator's consent (mails of 2026-11-04, and the fix round 2 ruling), for four
  lines only: the `startpoint` member of `LifecycleMeas` with its two-line doc comment, and its `LIFECYCLE_MEAS_KEY_MAP` entry
  (D-7980).
- `server/test/id-argv-census.test.ts`: under PR2's claim, by the coordinator's consent (mail of 2026-11-04 answering PR3's
  question after the first full CI run), for one token only: `wsAddWorkerBase: 'no-id'`, beside `wsAddWorker`.

## Files beyond the plan's list, with no departure

- `server/test/ccdArgvSamples.ts` (claimed by PR3): every `CCD_ARGV` key needs a sample, because `whitelist-subset.test.ts` and
  `ccd-verb-sets.test.ts` hold the sample keys equal to `CCD_ARGV`'s. The `wsAddWorkerBase` sample is what W5-G18's layer 3 builds.
- `server/test/ccd-lib-load.test.ts` (claimed by PR3): `ccd-ws-add-base.test.ts` joins its `FILE_READERS`, because W5-B8 builds an
  older ccd from the FILE itself; the arm-count row scans the program through `ccdSource()`.
- `server/test/lifecycle-wire.test.ts` (claimed by PR3): its two `LifecycleMeas` literals and key list gain `startpoint`; folded
  into D-7980's file list by the coordinator. The first full CI run caught it in the tests' own type check.

## Mutants beyond the plan's table

The plan's PR3 table defines W5-BM1 to W5-BM7. These are measured here, each applied alone to a saved copy and restored by sha:

- **W5-BM8**: the peel back, the object check as `git cat-file -e "<id>^{commit}"`. Reds W5-B4c (D-7981).
- **W5-BM9**: the format-length check dropped. Reds W5-B9 (a 64-hex ref name in a SHA-1 repository) and W5-B9c (a 40-hex prefix in
  a SHA-256 repository) (D-7982).
- **W5-BM10**: `GIT_NO_LAZY_FETCH=1` dropped from the object check. Reds W5-B12 (a partial clone lazy-fetches the missing object).
- **W5-BM11**: the object check moved below the disk floor and the placement read, still above the add lock. Reds W5-B11, whose
  one comparison of both markers reports each (placement's stub answers a lane, so an order that reaches it goes on past it).
- **W5-BM12**: the peel dropped from the start point (`lc_start="$lc_base"`). Reds W5-B9d and W5-B9e in all three cases each (a
  branch, a tag, and both, named the id, in sha1 and sha256): the tree starts at the name's target, or, with both, git dies
  `ambiguous object name` (D-7982, review 1457 F1).
- W5-B5c (`--child 7 --base --no-rc demo`) is red under W5-BM3 (the value's shape check replaced by non-empty).

## Considered and not taken (for the rider)

- **Replace refs at the start point** (review 1449 F2, left by the coordinator's ruling): the object check runs under
  `_ws_reclaim_contained`, which sets `GIT_NO_REPLACE_OBJECTS=1`, but `git worktree add` does not, so with `refs/replace/<X>` set the
  check accepts X while the tree gets the replacement's files under HEAD = X. The plain start point (`$base`) has the same exposure,
  and changing `worktree add`'s environment for every `ws-add` is outside PR3.
- **The check's environment against the add's** (review 1457 F7 (a), left by the coordinator's ruling): the object check runs
  under `_ws_reclaim_contained`, which unsets `GIT_DIR`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`,
  `GIT_NAMESPACE` and `GIT_CONFIG_PARAMETERS`, while `git worktree add` runs with the caller's environment, so the check can
  certify a different view than the add acts on. The same family as F2 above; the plain path has the `GIT_DIR` hazard already.
- **`nocasematch` reaching ccd's regex checks** (review 1457 F7 (b), left): an inherited `BASHOPTS=nocasematch` makes the value's
  `[[ =~ ]]` class accept upper-case hex, which `cat-file -t` also accepts; the tree is the right commit, but `meas.startpoint`
  would journal the upper-case spelling. Other regex checks in ccd share this.
- **A commit on origin not yet fetched** (review 1457 F7 (c)): refused, because the check runs before `cmd_ws_add`'s
  `git fetch origin`. Not a case for promotion (PR9): a lease tip is already in the shared object store.

## Lazy fetch (review 1449 F3)

The object check's git calls run with `GIT_NO_LAZY_FETCH=1` (and `GIT_TERMINAL_PROMPT=0`, as the docs reader's git does), so a partial clone never fetches a missing object from its promisor
remote before the disk floor. Row W5-B12 builds a `--filter=blob:none` clone of the fixture origin whose history holds a blob no
current commit names, and checks the blob is still absent after the refusal. It skips when the fixture git cannot serve a filtered
clone or does not honour the variable (git before 2.45, where `GIT_NO_LAZY_FETCH` arrived), measured on the clone rather than read from a version string.

## Deviations found

D-7980, D-7981 and D-7982 are defined in the plan's "Deviations found" (the coordinator's ruling of 2026-11-04, on wave 4's D-7869
precedent: deviation-refs' floor case reads definitions from top-level plans only). In short:

- D-7980 (`startpoint-is-a-declared-meas-key`): the new key reaches `LifecycleMeas` through `LIFECYCLE_MEAS_KEYS` and `reviveMeas`,
  so PR3 also edits `shared/api.ts` (four lines, by consent), `server/src/coord/journalparse.ts` and its test, with a skew row,
  and `server/test/lifecycle-wire.test.ts`.
- D-7981 (`base-object-type-not-peel`): the object check asks the object's type, not a peel, so an annotated tag's id is refused
  (W5-B4c, and W5-BM8 above).
- D-7982 (`base-length-is-the-object-format`): the value's length must be the repository's id length, read with
  `git rev-parse --show-object-format`, so a 40-hex prefix in a SHA-256 repository and a 64-hex ref name in a SHA-1 repository are
  refused, and an unreadable format refuses (W5-B9, W5-B9b, W5-B9c, W5-B10, and W5-BM9 above). The start point is
  `<id>^{commit}`, so no branch or tag named the id can divert the act (W5-B9d, W5-B9e, and W5-BM12 above).
