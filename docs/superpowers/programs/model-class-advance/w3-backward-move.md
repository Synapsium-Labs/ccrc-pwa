# W3: the retired grace, the effort fallback, revert's refusals and the release lookup warning (programme wave 3)

Programme `model-class-advance`, epic `catalogue-current`, tickets `backward-move` and `effort-level-dropped`, with the
follow-ups `revert-writes-before-refusing` and `release-lookup-warn` folded in. Run 2455. It is built on `main` after
#3107 (wave 7). The rounds are named the build, then fix round 1 (review 2938, findings F1 to F15), fix round 2
(review 2999, N1 to N4 and its advisories) and fix round 3 (review 3015, its F1 and the note's cleanup). The departures are D-8838 to D-8843, D-8865 and D-8866, defined in the Codex arm plan (`docs/superpowers/plans/2026-10-15-model-class-auto-advance-codex-arm.md`).

## The backward move: what the code establishes, and what it does not

On 2026-11-10, on one Codex lane (lane-b here; model ids below are neutral stand-ins), the opus class moved from
`model-6.1-gamma` to `model-6-gamma` at 22:16:58Z and back at 00:17:04Z. Both moves were advances with a passing
canary, and neither recorded a cause. The other Codex lane (lane-a) did not move.

- **The mechanism is established from the code.** Only the `retired` step can move a pinned class to an older version:
  `newer` needs a version strictly above the pin, `empty` needs no pin, and a hand act or a revert records another
  `how`. `compareVersions` reads 6.1 above 6 and has not changed since wave 1 (`git log -L` shows one commit, #867), nor
  has `chooseCandidate`. So at 22:16 lane-b's fresh catalogue did not list `model-6.1-gamma`, and the class fell back to
  the newest model left in its family. At 00:17 the catalogue listed it again, and the class moved back as `newer`. The
  23:16 refresh took about a second, which fits: the pin `model-6-gamma` was listed and nothing was newer, so no canary
  ran.
- **Why the catalogue was short is not established.** The catalogue of that hour is not kept, and the refresh unit's
  journal shows only its start and finish lines. Two candidates could not be excluded:
  - client-version gating: the backend withholds models that need a newer client than the one the probe asks as. Wave
    2's current-client lookup corrects that known gating;
  - the lane-mode changes deployed the same evening (#2586, #2590 and #2601), which fit "lane-b moved, lane-a did not"
    as well as a transient short answer does.
- **So the grace is a backstop, not the fix for a known cause.** It holds a class through a short absence whatever
  caused it. No second release lookup is added.

## What was built

- **The retired grace** (D-8838, `shared/model-advance.mjs`). Six hours of continuous fresh sightings of the same missing
  pin, never wall time spent blind.
  - Each class may carry `missing: {model, since, seen}`, its run of sightings: `since` the first, `seen` the last, both
    the catalogue's own observation time (`fetchedAt`), never the plan's clock (`observedAt`, `markMissing`).
  - The refresh's locked `materialise --refresh true` writes it after every successful probe and before the advance step
    reads it, so an hour whose readiness, budget or lock check skips the step still records it, and a listed-again read
    ends the run there. `advance-backfill` no longer writes it.
  - A stale, failed or absent observation changes nothing, and the same catalogue read twice counts once. A gap of more
    than `RETIRE_GAP_MS` (90 minutes) between two sightings, a clock that went back, or a record of the build's first shape (no
    `seen`) restarts the run at the next sighting. A sighting later than the clock is no sighting.
  - `retireDue` moves a class `retired` only when its run spans at least `RETIRE_GRACE_MS` and the run's last sighting is
    the catalogue in hand, so a sighting whose record was never written proposes no older candidate.
  - The measured cadence: the refresh observes about once an hour (its timer, plus however long its first pass takes),
    so the grace is six to seven hourly sightings, never a fixed number. Six hours is a floor, not a bound: any hour
    without a recorded sighting restarts the run, so on a lane whose refresh misses about one hour in six the move may
    never come, while the doctor keeps naming `pin-missing` (review 2999 A-5).
  - `pinMissing` names a waiting class: its pin, the run's start and the EARLIEST the move can come.
- **A newer model never waits** (D-8839). On a fresh catalogue, a missing pin moves to a newer free model at once, as
  `newer`. On a stale catalogue, a pin it does not list gets no candidate, as before (review F7).
- **A held class waiting on a missing pin is quiet** (D-8840) until its run qualifies.
- **The effort fallback** (D-8842).
  - A registry refused only for a stored level its model no longer offers is read with each such level replaced by
    `resolveEffort`'s fallback (D-5189), ranked by a catalogue row that still lists the old level (D-5991). Usually that
    is the next level down. With nothing below offered it is the model's lowest, which can rank above the old level.
  - `lanes` still lists such a lane with its probe (`effortDropped`), so the hourly refresh keeps probing it.
  - Only the refresh's own `materialise --refresh true` writes the fallback. The switch and ensure callers pass no flag,
    so they refuse the registry as before, and `--check` stays read-only.
  - The refresh row carries `effortFallback` and `effortFallbackRecord` (`recorded`, `no-advance-file`, the read's word,
    or `unwritten`) on every lane whenever the materialise kept the fallback, the row of a LiteLLM render that failed
    afterwards included (review 2999 N2). No advance file is created for it.
  - A failed materialise (D-8865, review 2999 N1) writes the stored registry back, then renders the lane's files from it
    through the same materialise, under the same lock. It claims no applied level only when both succeed. When the
    second render fails, its word is `effort-fallback-unrestored` (the files may carry the fallback), and
    `advance-health` measures the lane's effort file: when it holds the fallback's rendering and not the stored
    registry's, `effort-dropped`'s detail says the file carries the fallback's levels. The file is keyed by model, so two
    classes on one model can render both alike; the detail is then the ordinary one (review 3015 F1).
    When the write-back fails, the registry keeps the fallback, which is answered and recorded as applied, or answered
    `unwritten` when the record write fails.
  - `materialise --refresh` takes only `true`, refused as argv (exit 2) before any file is read (review 2999 A-2).
  - The record (`effortFallback` on the class) ends when the old level is offered again (the level the class runs at is
    kept), or after a hand `set-effort` on the class succeeds, at any level, the current one included. A refused one
    keeps it.
  - Doctor tells the two states apart. `effort-dropped` is a registry still refused: every verb refuses there, so the
    remedy is the next refresh or `ccrc models refresh <id>`. `effort-fallback` is a class running at the recorded
    level, and its remedy is `set-effort`.
- **Revert decides every refusal before its first write.** The lane settings file is read as the materialise will read
  it (`readSettingsJson`, split out of `mergeSettingsEnv` in `shared/modelenv.mjs`). Each refusal has a case that reads
  the model files and the settings file back unchanged: the five refusals that existed before this wave, three settings
  shapes, an advance file that does not parse, one that cannot be read, an unknown class, and a registry refused when
  it is read.
- **Doctor** (`ccd/ccrc-doctor-checks`):
  - `model-advance-blocked` answers `pin-missing`, `effort-dropped` and `effort-fallback`, each with its remedy.
  - The pin-missing remedy says Revert works only once the previous model is listed again, and that without a hold the
    next hourly advance moves back to it by itself.
  - The new check `model-release-lookup` (D-8843; named so no line it prints starts `WARN codex`, which the Codex bridge's
    readings count, or `FAIL`) WARNs while the lookup is still tried (a try in the last day) and either its last good
    read is over a day old, or it has no good read and has failed for over a day. Each age it prints comes from its own
    stamp: the last good read from `readAt`, the time failing from `failingSince` only.
  - It PASSes when nothing was tried for a day. After syncing with #3085, the check asks the installed auth library's
    `read_client_release()` through the doctor's bounded execution helper, then jq decides as before. Missing jq,
    Python or the library is a dependency SKIP; an absent, unreadable or unmeasurable record is a record SKIP.
    Neither says the box has no Codex lane. The shared reader owns the path and read (D-8781).
  - The probe records `failingSince`, keeps it through successive failures and drops it on a success. The base sync
    preserves both that behavior and the probe's clock seam alongside the shared client-version owner.
- **The carried nit from wave 7.** On a Codex lane, an unmeasured session's word is the advance file's own,
  `advance-file-unreadable` or `advance-file-invalid` (D-8821's split), with a case for each.

## Mixed-version window

- **An older build reads the new keys.** It reads an advance file carrying `missing` (with `seen`) and `effortFallback`,
  and keeps both through its own writes. A case reads #3107's `shared/model-advance.mjs` out of git history and checks
  this. This build reads a record of the first shape (no `seen`) and restarts it. A combined fixture verifies that
  it also reads and preserves both wave 3 keys alongside wave 8's `releasedHold`. Wave 8's parser and declaration
  changes are not part of this sync.
- **An older rule ignores `missing`.** A box still on the older build retires at once, as today.
- **No file holds a new word.** The three blocked causes live only in `advance-health`'s answer. The fallback is not a
  history entry, because an older `parseAdvance` refuses an unknown `how` or `cause` and would then read the whole file
  as invalid. So an older doctor never sees any of the three words.
- **An older `ccrc` never passes `--refresh true`.** Its refresh's materialise refuses a dropped level as before, and
  writes no sighting.
- **An older probe drops `failingSince` when it writes the record.** The check then waits for a newer probe to record it
  again. Until then a record with no good read never WARNs.

## Measured

- **Red first, in a fixture HOME** (the build). The `ccrc models refresh` case with a stored `max` the new catalogue drops
  is red on #3107's code and green with this change.
- **Through the real refresh order** (fix round 1). Fixture-HOME cases drive `ccrc models refresh` hour by hour with the
  probe's clock seam (`CCRC_MODELS_NOW`, the same one the op reads):
  - the two-hour flap: the record follows each sighting and is gone on the third, with no move and no history entry;
  - a missed hour restarts the run;
  - a direct lane's first hour after a drop names the refused lowering beside the fallback, and lowers the next hour.
- **Mutation rows** (the build). Each of 24 rows edited one guard in place, ran its named cases, and restored the file
  from a saved copy. Every row was killed.
- **Fix round 1's guards were not all pinned** (review 2999 N3, A-4). The reviewer's runs killed most of them, but four
  survived: `retireDue`'s and `pinMissing`'s check of the record's model against the pin, `markMissing`'s
  same-sighting skip's, and the restart of a first-shape record within 90 minutes. Fix round 2 adds one case for each.
  The first-shape case pins that behaviour, not each term behind it: `isAt(m.seen)`, the order of the two sightings and
  the gap term each enforce it, so removing one of them alone keeps it green (review 3015 F2).
- **Mutation rows** (fix round 2), the same way, each named file run alone through `ccrc test`. The failed renames are
  reached through the op's own writes, with a preload that makes the nth rename onto a named file fail. Every row was
  killed, by these cases (reproduced by review 3015):

  | Row | Removed | Red |
  |---|---|---|
  | `retireDue`'s model term | `missing.model === registry.classes[cls]` | 1: a record of another model never retires the pin |
  | `pinMissing`'s model term | `missing.model === pin` | 1: a record of another model is no run of this pin |
  | `markMissing`'s same-sighting skip | `m.model === pin` in the skip | 1: another model's record at this sighting restarts |
  | the first-shape restart | a record with no `seen` continues from `since` | 1: a first-shape record restarts the run |
  | the re-render | the second `materialise` | 3: the restored case, the failed third write, the second render before the effort file |
  | the write-back's kept fallback | `kept` without the failed write-back | 1: a failed write-back leaves the fallback applied |
  | the measured effort file | `onDisk` forced false | 1: the second render before the effort file |
  | the early `--refresh` check | the check deleted | 2: the argv case, and the backfill case's refusal |
  | the row merge | merged into a successful row only | 1: the row of a LiteLLM render that failed afterwards |

- **Mutation row** (fix round 3). `onDisk` without its stored-rendering term: 2 red, the two cases of opus and fable on
  one model (after a restore that succeeded, and a registry refused before any refresh). Both were red on fix round 2's
  tip before the change.
- **Sizes.** `deploy/models-op.mjs` is 2,997 lines at fix round 3's tip, after `advanceIneligible` moved to the shared
  module (D-8866). The doctor file's growth is measured by the growth check's own
  counter at the tip and reported in the wave-done.

## The live gate, read-only

Measured 2026-11-20, during the build, on the fleet box against its own lane files. A scratch home held links to each Codex
lane's model files, the release lookup record and the session registry, and the roster was read in place. Only
read-only ops and doctor's checks ran. Nothing was installed, nothing ran with `--fix` and no refresh ran. The live lane
files' times were unchanged afterwards.

- `advance-plan` on lane-a and lane-b: eligible, and no candidate on any class, as today.
- Doctor's four model-advance checks and the release lookup check: PASS on both lanes, with no new WARN.

## Notes for the ledger

- **Out of scope, by the brief:** the plan ticket `ccrcdir-param-drop` (D-8757) and the README. Another run's freeze
  holds the README, so its doctor table does not yet name `pin-missing`, `effort-dropped`, `effort-fallback` or
  `model-release-lookup`. That is a follow-up for after the freeze.
- **Claims.** Wave 8 (run 2910) holds four of this wave's shared files. It consented to the build's hunks and, separately,
  to each fix round's named hunks (fix round 2: five hunks, then the move of `advanceIneligible`; fix round 3: two). During the build, two of its test files were edited locally before the claim was asked for;
  nothing was pushed before its consent.
- **Local reds on the fleet box** (the build). `ccrc-install-codex` is red on two box-token cases, because `browser-mcp`
  reads this box's live processes, where other sessions run browser servers. They do not depend on this change.
- **The spec lags until wave 10** (review 2999 N4): its §2.2 still retires a pin on the first fresh catalogue that
  leaves it out, and its §2.8 names neither the three blocked causes nor `model-release-lookup`. No spec edit is in this
  PR. D-8843's cost-if-wrong names it, and the coordinator carries it to the programme's spec-truth pass.
- **A known residual, out of scope** (review 2999 A-1). A successful `set-effort` ends the `effortFallback` record by
  writing the advance file. When that write fails (named only on stderr; the verb still succeeds), the record stays. At
  another level it no longer stands (`effortFallbackOf` reads the registry's level), so the doctor stops naming it at
  once. At the level the class already ran at it still stands, so the doctor keeps giving the `effort-fallback` remedy
  the operator already took, until the old level is offered again or a later `set-effort` writes the file. D-8842
  states the exception.
- **A residual.** A run's record is written only by the refresh's materialise. An hour whose probe failed is no
  sighting, so it neither extends nor ends a run, and a gap past 90 minutes restarts it at the next sighting.

## Base sync after #3085

The merge resolves only the probe comment. Its clock seam and uninterrupted failure timestamp stay beside the shared
client-version owner. In a separate commit, the doctor switches to the shared reader (D-8843); the single-reader census
is unchanged. The doctor file grows by 33 net code lines against the merged base (23 before the adapter, of 40 allowed);
`models-op.mjs` stays at 2,997 lines.

Four release-lookup cases failed on the merged baseline and pass with the adapter. The existing warning cases still
pin independent ages and the probe case still pins `failingSince` through successive failures and clears it on success.
The adapter's focused mutations were each measured against the release-lookup fixtures:

| Removed or changed | Red cases |
|---|---:|
| Unavailable Python guard | 1 |
| Unavailable installed library guard | 1 |
| No bytecode writes on import | 1 |
| Exactly one returned record | 1 |
| Require a successful reader exit even with otherwise valid output | 1 |
