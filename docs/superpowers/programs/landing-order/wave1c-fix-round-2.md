# Landing order wave 1c, fix round 2

Run 3698, sent back to `working` by the coordinator's ruling on review run 3738 (round 2 of 3), which
read tip `0adfc5c1eefd1b81391fe6cd15f17bddd05c2b42`, confirmed no defect and raised six minor points.
Findings are the review's; rulings are the coordinator's. The code of this round is commit
`29d9066bd92be9bdb50cf7b8597a9fc45c78a9af`; every count below was measured on that commit's tree.

## Fixed, as ruled

- **F3, the receiver's words follow the sender's.** The case this trigger exists for is a worker in a
  fix round, which has sent a wave-done once already; read by its own words, "before your wave-done
  only" could decline the mail. So:
  - worker clause 16: `before your wave-done only` becomes `before this round's wave-done only`, and its
    pin in `server/test/worker-skill.test.ts` (`CONTRACT[15]` and the new clause 16 case) moves with it.
    Nothing else in the clause changes.
  - the hook's `(4)` line: the same phrase, the same change.
  - the README: `before the worker's wave-done only` becomes `before the worker's wave-done of that round
    only` (the next line rewrapped).
  - `conflict-sync-text`'s limit case holds the new words in all three.
  The spec's sentence is the coordinator's, on its ledger pull request; the spec and the plan are not
  touched here.
- **The 8 bytes.** The new words grow clause 16 by 8 bytes. The size cap (35559) would hold them, but the
  ratchet also lets a SKILL.md grow against main only by a new pinned clause, so the file had to stay at
  main's 35535. Departure, by slug `clause5-note-trim-8` (unnumbered): the clause 5 note under `## Notes
  on the contract` says `prose in your pane` instead of `prose typed into your pane`. A note, never a
  clause; no test pins the phrase. The file is 35535 bytes, main's size; the caps file is not touched.
- **F2.** The run-care sentence says what is true of each state: never at `awaiting-review`, where the
  route is a send-back with a report, nor at `merging`, where the route is the ejection that names a base.
- **F1.** A guard on the shell block itself: `conflict-sync-text` holds the probe's last line and the
  rev-parse line as neighbours inside the fence (flattened, `<the branch tip> origin/main git rev-parse
  origin/main` then the fence's close), so removing only the fenced rev-parse line reds while the prose
  still names it.
- **F4.** `conflict-sync-text` holds the run-care sentence that says a worker sent back for a fix round
  is before its wave-done until it sends that round's fresh one.
- **F5.** A new `conflict-sync-text` case holds the worker's own-probe condition in the clause, in the
  hook's `(4)` line (`and your own probe of that commit agrees`) and in the README (`and the worker's own
  probe of that commit agrees`).
- **F6.** The Task 4 note now says on which commit's tree each of its counts was measured, and points
  here for the same rows at this round's commit.

## Not in this round (noted for a later wave, as ruled)

The two residuals of the review's question 1: the run-care section does not name where the coordinator
reads `<the branch tip>` from, and `paths:` is space-separated, so a path with a space is ambiguous.

## The claims

- `ccd/session-hook.sh`: the earlier holder's claim had ended; this round took the file (claim 7057). The
  change is the one phrase in the `(4)` line; the generated region is untouched.
- `README.md`: held by another landing-order worker (claim 7048). The hunk went to the holder first as a
  packet: a unified diff against `README.md` at this branch's tip `0adfc5c1ee`, header times stripped,
  1047 bytes, sha256 `05db1179f834e16e60515858a334893251be13822c2d71ce65ab365b3a5cbc23`. The holder
  answered yes (its own hunk is in another paragraph) and kept its claim; the digest was checked and the
  diff applied with `git apply`, unchanged.

## Every mutation row, measured at `29d9066bd9`

Each row: the file saved, its sha256 recorded, the mutation applied by script, the named suites run, the
file restored from the saved copy and its sha256 checked equal. Suites: worker rows over `worker-skill`
and `conflict-sync-text` (89 tests); hook rows over `session-hook-sync-advisory` and `conflict-sync-text`
(83); README and run-care rows over `conflict-sync-text` (5). `conflict-sync-text`'s cases are: 1
spelling, 2 bound, 3 wave-done limit, 4 own probe, 5 body entries.

| id | File, sha256 at `29d9066bd9` | Red, measured | Restored |
|---|---|---|---|
| 1C-01 | `ccd/worker-skill/SKILL.md`, `51c8de6a909245414b3a21dc4f8201f51a0fecb577647b7dd32fa477ec297b3f` | the verbatim census, the clause 16 case, and `conflict-sync-text` cases 1, 2, 3 and 4. 6 failed, 83 passed | sha matches |
| 1C-02 | same | the verbatim census, the clause 16 case, `conflict-sync-text` case 4. 3 failed, 86 passed | sha matches |
| 1C-03 | same | the verbatim census, the clause 16 case, `conflict-sync-text` cases 2 and 3. 4 failed, 85 passed | sha matches |
| R2-F3w (new) | same | clause 16's limit back to `before your wave-done only`: the verbatim census, the clause 16 case, `conflict-sync-text` case 3. 3 failed, 86 passed | sha matches |
| 1C-04 | `ccd/session-hook.sh`, `da9b1c8a46b21669fc8f816eb9d33377bb660687d97004001ff1c15e8ff39dc2` | the 21 `advises on …` cases, and `conflict-sync-text` cases 1, 2, 3 and 4. 25 failed, 58 passed | sha matches |
| G3 | same | the `(4)` line drops its limit: `conflict-sync-text` case 3. 1 failed, 82 passed | sha matches |
| R2-F3h (new) | same | the `(4)` line's limit back to `before your wave-done only`: case 3. 1 failed, 82 passed | sha matches |
| R2-F5h (new) | same | the `(4)` line drops `, and your own probe of that commit agrees`: case 4. 1 failed, 82 passed | sha matches |
| 1C-05 | `README.md`, `c4bd426777d47c3d8740539729cfe00f519d933f8e1deae333c1fbed948046eb` | `Conflict-sync:`: case 1. 1 failed, 4 passed | sha matches |
| G2 | same | drops the limit: case 3. 1 failed, 4 passed | sha matches |
| R2-F3r (new) | same | the limit back to `before the worker's wave-done only`: case 3. 1 failed, 4 passed | sha matches |
| R2-F5r (new) | same | drops `, and the worker's own probe of that commit agrees`: case 4. 1 failed, 4 passed | sha matches |
| G1 | `ccd/coordinator-skill/references/wave-lifecycle-run-care.md`, `785515b5f7afab2cf1b0ea5a923cc2f57153956c4569c9fe3198b5a676be8898` | the bound rewritten: case 2. 1 failed, 4 passed | sha matches |
| F1 (round 1) | same | the fenced rev-parse line removed and the source sentence reverted: case 5, now at the shell-block assertion. 1 failed, 4 passed | sha matches |
| R2-F1 (new) | same | ONLY the fenced rev-parse line removed, the prose left naming it: case 5 (`lacks: <the branch tip> origin/main git rev-parse origin/main` then the fence). 1 failed, 4 passed. Green at `0adfc5c1ee`, as the review measured | sha matches |
| R2-F2 (new) | same | the sentence back to `never at awaiting-review or merging, where the ejection … is the only route`: case 3. 1 failed, 4 passed | sha matches |
| R2-F4 (new) | same | the fix-round sentence says the worker is past its wave-done once it has sent one: case 3. 1 failed, 4 passed | sha matches |

Every row is red, and green after its restore (the reader run below). 1C-01, 1C-02, 1C-03 and 1C-04 now
red more cases than at round 0, because the cases added in rounds 1 and 2 hold the same sentences.

## Suites at `29d9066bd9`, once each

- The reader and guard set, one run: `worker-skill`, `session-hook-sync-advisory`, `conflict-sync-text`,
  `install-worker-skill`, `session-hook-mail-hold`, `session-hook-merge-deny`,
  `session-hook-role-skill-deny`, `hook-helpers-generated`, `update-branch-absent`, `skillstate`,
  `install-census`, `coordinator-skill`, `reviewer-skill`, `citations`, `anchors`, `docs-parity`,
  `topology-clean`, `skill-size-ratchet`, `dtbd`, `ci-shards`, `single-definition/` whole, and the six
  lifecycle readers: 68 files, 3609 tests, green.
- `deviation-refs`, after `git fetch origin main`, on the test box: 33 of 34; `is looking at two real
  trees, each with a real ledger in it` timed out at its 20 s bound (21.9 s). Not repeated.
- `typecheck-tests`, on the test box: did not load, `Cannot find module 'typescript'` (no pwa
  dependencies there). Not repeated. The pull request's run is the arbiter for both.
- No full suite ran.
