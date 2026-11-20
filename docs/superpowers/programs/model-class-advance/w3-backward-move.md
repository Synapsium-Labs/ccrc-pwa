# W3: the retired grace, the effort fallback, revert's refusals and the release lookup warning (programme wave 3)

Programme `model-class-advance`, epic `catalogue-current`, tickets `backward-move` and `effort-level-dropped`, with the
follow-ups `revert-writes-before-refusing` and `release-lookup-warn` folded in. Run 2455. It is built on `main` after
#3107 (wave 7). Fix round 1 answers review 2938 (findings F1 to F15). The departures are D-8838 to D-8843, defined in
the Codex arm plan (`docs/superpowers/plans/2026-10-15-model-class-auto-advance-codex-arm.md`).

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
    than `RETIRE_GAP_MS` (90 minutes) between two sightings, a clock that went back, or a record of round 1's shape (no
    `seen`) restarts the run at the next sighting. A sighting later than the clock is no sighting.
  - `retireDue` moves a class `retired` only when its run spans at least `RETIRE_GRACE_MS` and the run's last sighting is
    the catalogue in hand, so a sighting whose record was never written proposes no older candidate.
  - The measured cadence: the refresh observes about once an hour (its timer, plus however long its first pass takes),
    so the grace is six to seven hourly sightings, never a fixed number.
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
    or `unwritten`) on every lane. No advance file is created for it.
  - A failed materialise writes the stored registry back and claims no applied level.
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
  - It PASSes when nothing was tried for a day, and SKIPs with no jq, no record, or a record it cannot read as one object
    with a numeric `triedAt`.
  - The probe records `failingSince` and drops it on a success.
- **The carried nit from wave 7.** On a Codex lane, an unmeasured session's word is the advance file's own,
  `advance-file-unreadable` or `advance-file-invalid` (D-8821's split), with a case for each.

## Mixed-version window

- **An older build reads the new keys.** It reads an advance file carrying `missing` (with `seen`) and `effortFallback`,
  and keeps both through its own writes. A case reads #3107's `shared/model-advance.mjs` out of git history and checks
  this. This build reads a round 1 record (no `seen`) and restarts it.
- **An older rule ignores `missing`.** A box still on the older build retires at once, as today.
- **No file holds a new word.** The three blocked causes live only in `advance-health`'s answer. The fallback is not a
  history entry, because an older `parseAdvance` refuses an unknown `how` or `cause` and would then read the whole file
  as invalid. So an older doctor never sees any of the three words.
- **An older `ccrc` never passes `--refresh true`.** Its refresh's materialise refuses a dropped level as before, and
  writes no sighting.
- **An older probe drops `failingSince` when it writes the record.** The check then waits for a newer probe to record it
  again. Until then a record with no good read never WARNs.

## Measured

- **Red first, in a fixture HOME** (round 1). The `ccrc models refresh` case with a stored `max` the new catalogue drops
  is red on #3107's code and green with this change.
- **Through the real refresh order** (round 2). Fixture-HOME cases drive `ccrc models refresh` hour by hour with the
  probe's clock seam (`CCRC_MODELS_NOW`, the same one the op reads):
  - the two-hour flap: the record follows each sighting and is gone on the third, with no move and no history entry;
  - a missed hour restarts the run;
  - a direct lane's first hour after a drop names the refused lowering beside the fallback, and lowers the next hour.
- **Mutation rows** (round 1). Each of 24 rows edited one guard in place, ran its named cases, and restored the file
  from a saved copy. Every row was killed. Round 2's guards each have a case that pins them; the rows were not re-run
  this round.
- **Sizes.** `deploy/models-op.mjs` is 2,997 lines. The doctor file's growth is measured by the growth check's own
  counter at the tip and reported in the wave-done.

## The live gate, read-only

Measured 2026-11-20, in round 1, on the fleet box against its own lane files. A scratch home held links to each Codex
lane's model files, the release lookup record and the session registry, and the roster was read in place. Only
read-only ops and doctor's checks ran. Nothing was installed, nothing ran with `--fix` and no refresh ran. The live lane
files' times were unchanged afterwards.

- `advance-plan` on lane-a and lane-b: eligible, and no candidate on any class, as today.
- Doctor's four model-advance checks and the release lookup check: PASS on both lanes, with no new WARN.

## Notes for the ledger

- **Out of scope, by the brief:** the plan ticket `ccrcdir-param-drop` (D-8757) and the README. Another run's freeze
  holds the README, so its doctor table does not yet name `pin-missing`, `effort-dropped`, `effort-fallback` or
  `model-release-lookup`. That is a follow-up for after the freeze.
- **Claims.** Wave 8 (run 2910) holds four of this wave's shared files. It consented to round 1's hunks and, separately,
  to this round's named hunks. In round 1, two of its test files were edited locally before the claim was asked for;
  nothing was pushed before its consent.
- **Local reds on the fleet box** (round 1). `ccrc-install-codex` is red on two box-token cases, because `browser-mcp`
  reads this box's live processes, where other sessions run browser servers. They do not depend on this change.
- **A residual.** A run's record is written only by the refresh's materialise. An hour whose probe failed is no
  sighting, so it neither extends nor ends a run, and a gap past 90 minutes restarts it at the next sighting.
