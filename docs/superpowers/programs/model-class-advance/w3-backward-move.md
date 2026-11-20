# W3: the retired grace, the effort fallback, revert's refusals and the release lookup warning (programme wave 3)

Programme `model-class-advance`, epic `catalogue-current`, tickets `backward-move` and `effort-level-dropped`, with the
follow-ups `revert-writes-before-refusing` and `release-lookup-warn` folded in. Run 2455. It is built on `main` after
#3107 (wave 7).

## The backward move: the cause, measured read-only

On 2026-11-10, on one Codex lane (lane-b here; model ids below are neutral stand-ins), the opus class moved from `model-6.1-gamma` to `model-6-gamma` at 22:16:58Z and
back at 00:17:04Z. Both moves were advances with a passing canary, and neither recorded a cause. The other Codex lane
(lane-a) did not move.

- **The version order is not the cause.** `compareVersions` reads 6.1 above 6 and has not changed since wave 1
  (`git log -L` shows one commit, #867). `chooseCandidate` has not changed since then either.
- **Only one step can move a class to an older version: `retired`.** `newer` needs a version strictly above the pin,
  and `empty` needs no pin. So at 22:16 lane-b's fresh catalogue did not list `model-6.1-gamma`, and the class fell back to
  the newest model left in its family. At 00:17 the catalogue listed it again, and it moved back as `newer`.
- **The 23:16 refresh took about a second.** That fits: the pin `model-6-gamma` was listed and nothing was newer, so no
  canary ran.
- **What cannot be measured.** The catalogue of that hour is not kept, so the missing row is read from the code and
  the two moves, not seen. The journal of the refresh unit shows only its start and finish lines.

## What was built

- **The retired grace** (`shared/model-advance.mjs`). `RETIRE_GRACE_MS` is six hours, one named constant whose comment
  gives the reason: the measured gap was about two hours, and six hours is six hourly reads.
  - Each class may carry `missing: {model, since}`, when its pin was first seen missing from a fresh catalogue.
    `markMissing` decides it, and `advance-backfill`, the hourly step's first locked writer, writes it. A stale
    catalogue records nothing either way. A listed pin clears the record, and a record that names another model than
    the pin counts as none.
  - `chooseCandidate` moves a class `retired` only once its record is at least the grace old, on a fresh catalogue.
  - `pinMissing` names a class that is waiting: its pin, `since`, `until` and the older model it would move to.
  - `candidateFor` moved here from `deploy/models-op.mjs`, so the plan and the commit share the grace.
- **A newer model never waits.** A pin missing from the catalogue moves to a newer free model at once, as `newer`.
- **The effort fallback** (`effortFallbacks`, `recordEffortFallbacks`, `effortFallbackOf`).
  - A registry that `parseRegistry` refuses only because its model no longer offers a stored level is read with that
    level lowered. The new level comes from `resolveEffort`, ranked by a catalogue row that still lists the stored
    level (D-5991's rule, as `revert` ranks it), so `max` becomes `xhigh`.
  - `lanes` still lists such a lane with its probe (`effortDropped`, never `registryInvalid`), so the hourly refresh
    keeps probing it.
  - The refresh's locked `materialise` writes the lowered registry, records `effortFallback: {at, model, from, to}` on
    the class when the advance file exists, and answers `effortFallback`.
  - Every other op still refuses the registry until then. `materialise --check` writes nothing, so it refuses too.
- **Revert decides every refusal before its first write** (`deploy/models-op.mjs`).
  - The lane settings file is read as the materialise will read it, through `readSettingsJson`, split out of
    `mergeSettingsEnv` in `shared/modelenv.mjs`. Before, a settings file the merge refuses was found only after the
    hold was written.
  - Each refusal has a case that reads the model files and the settings file back unchanged: the five existing
    refusals, three settings shapes and an advance file that does not parse.
  - Only a write or a materialise that fails can follow the hold now. The D-5206 case keeps that path with a real
    failure: a directory where the classes file goes.
- **Doctor** (`ccd/ccrc-doctor-checks`, +21 net code lines):
  - `advance-health` answers two new blocked causes, `pin-missing` and `effort-dropped` (the second both for a
    recorded fallback that still stands and for a registry still refused). `_dr_ma_blocked_fix` gives each a remedy:
    hold or revert from the Models sheet; `set-effort` with an offered level.
  - The new check `codex-release-lookup` WARNs when the lookup has failed for over a day while it is still tried (a
    try in the last day): a last good read over a day old, or no good read and failures for over a day. It SKIPs with
    no record, and PASSes otherwise. `ccd/ccrc-models-probe`'s lookup now records `failingSince`, the first try of the
    failures since the last good read, and drops it on a success.
- **The carried nit from wave 7.** On a Codex lane, an unmeasured session's word is now the advance file's own,
  `advance-file-unreadable` or `advance-file-invalid` (D-8821's split), with a case for each.

## Mixed-version window

- **An older build reads the new keys.** It reads an advance file carrying `missing` and `effortFallback`, and keeps
  both through its own writes. A case reads #3107's `shared/model-advance.mjs` out of git history and checks this.
- **An older rule ignores `missing`.** A box still on the older build retires at once, as today.
- **No file holds a new word.** The two blocked causes live only in `advance-health`'s answer. The fallback is not a
  history entry, because an older `parseAdvance` refuses an unknown `how` or `cause` and would then read the whole
  file as invalid. So an older doctor never sees either word.
- **An older probe drops `failingSince` when it writes the record.** The new check then waits for a new probe to
  record it again. Until then a record with no good read never WARNs.

## Departures (for the coordinator to number)

- **`retired-grace`.** The `retired` move waits out `RETIRE_GRACE_MS` on a missing pin. This departs from the spec's §5
  text. Done-when 2's "never to an older version" now reads "never while the class's own model is still offered": a
  model gone for the whole grace is retired (D-5199), six hours late.
- **`newer-before-retired`.** A pin missing from the catalogue with a newer free model moves `newer`, never `retired`,
  and its history entry's cause says so. Before, the same move was recorded as `retired`.
- **`held-missing-quiet`.** Within the grace, a held class on a missing pin is not `model-held-behind`. It is reported
  once the grace has run, as `retired`, as before.
- **`advance-pure-helpers-to-shared`.** `candidateFor`, `withEffort` and `historyReason` moved, unchanged, from
  `deploy/models-op.mjs` to `shared/model-advance.mjs`. That keeps the op under 3,000 lines: it is now 2,993.
- **`effort-fallback-in-materialise`.** The level is lowered by `materialise` under the lane lock, on any lane kind.
  It is recorded as the class key `effortFallback`, not as a history entry (the mixed-version reason above). A lane
  with no advance file records nothing.
- **`release-lookup-failing-since`.** The release lookup's record gains `failingSince`. "A day of tries" could not be
  read from `triedAt` alone.

## Measured

- **Red first, in a fixture HOME.** The new `ccrc models refresh` case (a stored `max` the new catalogue drops,
  refreshed twice) is red on #3107's `deploy/models-op.mjs` and shared modules, whose refresh row fails with the
  dropped level. It is green with this change.
- **Mutation rows, run.** Each of the 24 rows edited one guard in place, ran its named cases through `ccrc test`, and
  restored the file from a saved copy. Every row was killed. They cover:
  - the grace and its clock, the record's model check, a newer model before the grace;
  - the stale gate and the first-sighting rule of the mark, the two parse checks, the ranker, `pinMissing`'s end;
  - the backfill's write, `lanes`, `materialise`'s lowering and its record, revert's settings read, the session word;
  - the two causes, the three WARN and PASS arms of the release check, `failingSince`'s keep and both remedy clauses.
- **The doctor file** measures +21 net code lines against the merge base, by `growthCheck.ts`'s own counter. The
  limit is 40.

## The live gate, read-only

Measured 2026-11-20 on the fleet box against its own lane files. A scratch home held links to each Codex lane's model
files, the release lookup record and the session registry, and the roster was read in place. Only read-only ops and
doctor's checks ran. Nothing was installed, nothing ran with `--fix` and no refresh ran. The live lane files' times
were unchanged afterwards.

- `advance-plan` on lane-a and lane-b: eligible, and no candidate on any class, as today.
- Doctor's four model-advance checks and `codex-release-lookup`: PASS on both lanes, with no new WARN.

## Notes for the ledger

- **The README's doctor table** does not yet name the two new causes or `codex-release-lookup`. Another run's freeze
  holds the README, so this is a follow-up for after it.
- **Claims.** Two of this wave's test files were edited locally before their claim was asked for. Their holder (wave
  8, run 2910) then consented to all four shared files. Nothing was pushed before that.
- **Local reds on the fleet box.** `ccrc-install-codex` is red on two box-token cases, because `browser-mcp` reads
  this box's live processes, where other sessions run browser servers. The same cases do not depend on this change.
  CI's runner is the arbiter.
- **A residual.** The mark is written by the hourly `advance-backfill` alone. An hour whose backfill did not run is an
  hour whose catalogue the grace never saw. If that catalogue listed the pin again, the grace still counts from the
  first sighting.
