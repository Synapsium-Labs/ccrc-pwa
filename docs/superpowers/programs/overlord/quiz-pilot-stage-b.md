# Overlord W1a: the quiz pilot, stage B (run 3561)

The note of run 3561 (programme `overlord`, issue #2491, wave 217), for the coordinator to fold into the programme ledger.
No D-number was issued, so departures are named by slug. It reads after run 3514's note (`quiz-pilot-checks.md`, whose
section 4 holds the options these rulings chose from) and run 3538's (`quiz-account-room.md`). It covers what changed and
why, what changes for the history gate's own pilot, what was measured and what was not, and the known limits.

## In short

- **B0, what a second pilot is spent on.** A week closed on the pilot word is piloted again only when its **pilot key**
  differs from the key of every pilot the week has run. The key is what can change a pilot's outcome: the Claude Code build
  the driver measures (its `--version` line, through the week's own launcher) and the gate's code shas as `codeShas`
  computes them. The release tag is no longer the key. The pure decision `repilotOf` keeps its table test and the cap of
  three. A pilot entry written before this change names a release and no key: it counts toward the cap and matches no key.
  The release pin and the state row record the key each was decided on, and the one-act permission names its key.
- **B1, the skill (option S1).** Before each treatment-arm run, the driver stages the shipped history skill into the run's
  own working folder as a project skill, `.claude/skills/ccrc-history/`, and it goes with that folder. The bytes are read
  from the installed tree and pinned by their sha at the act's start; a missing or changed source refuses with
  `skill-source-unmeasured` or `skill-source-moved`. The skill check itself did not change.
- **B2, measure both modes, act on one.** When the skill check is the only failing check under restricted (and none is
  unmeasured), the same pilot makes one more probe under the fallback mode and records whether the skill is listed there
  (`skill_fallback`). The verdict is restricted's alone, and the week still runs restricted only. No week-level mode was
  built.
- **B3, the marketplace plugin (option P2).** The pilot's first run (the box run) observes what loads. Each reported entry
  that is not the build's own becomes one `enabledPlugins` value with that entry off, passed to every later run of the
  pilot and to the week's arms and judge, and recorded once in the step 0b result (`plugins_off`). The plugins check then
  demands zero entries that are not the build's own in the runs made with the map, as before, and fails too for an entry
  whose source is not a plain name, one `@` and a plain marketplace name; such an entry reaches no argument. The check
  records whether the map was passed (`map_passed`) and what it refused (`map_refused`).
- **B4, persistence (the proof of L1, without its removal).** A run that left something passes the check only when
  everything left is under its own project folder, no main transcript exists, the walk of what is left is complete within
  its bounds, and, for every regular file found, the sweep's own ingest decision (`decideAgentIngest`, asked with the
  sweep's own `knownUuids`) answers that the store cannot read it. A leftover holding no regular file passes on the first
  three alone. Each condition is recorded in the row's `proof`. The driver removes nothing and gains no write into Claude
  Code's layout. The shape record names one level deeper and lists every regular file it found.
- **Review 3553's words**, in a commit of their own: the account-room note's launcher sentence, the credentials-file
  refusals, the tree-guard counts and a stop on the last candidate.
- **Step 0b stays fail-closed.** Today's answers were pinned by characterization tests committed green against `main`
  first, and every later commit edits only the rows its ruling moved, saying which.
- **Known limit.** Nothing here is proven on the fleet box until a pilot runs it there.

## 1. What changed, by file

| Piece | Where |
|---|---|
| B0's pure key rules (`pilotKeyValid`, `pilotKeyOf`, `sameKey`), B1's source reader and stager (`skillSourceOf`, `stageSkillInto`), B2's due rule (`fallbackProbeDueOf`, `fallbackSkillOf`), B3's map (`pluginsOffOf`, `pluginsOffSettingsOf`, `pluginsCheckWithMapOf`), B4's proof (`knownIdsOf`, `persistenceProofOf`) | `deploy/history-quiz-pilot.mjs` (new) |
| `repilotOf` and `repilotPermitOf` keyed; `pilotEntryKeyOf`; the key measure `measuredPilotKeyOf` and its per-tick memo; `pinnedPilotOf`; the reopening async and keyed | `deploy/history-quiz-unattended.mjs` |
| The pin's key (`releasePinText`'s fourth field); `pinSkill`; `step0bRound` with the map, the staging, the proof and the fallback probe; `weekSettingsOf` and `judgeSettingsOf`; two refusal words | `deploy/history-quiz-single.mjs` |
| `spawnArgv`'s optional settings value; `launchRun`'s optional staging hook and two optional run-record fields; `armJob` and `openJudge` carry them; the shape one level deeper with `files`; `persistenceCheckOf` reads an optional proof | `deploy/history-replay.mjs` (6755 code lines of its 6796 cap; `main` has 6746) |
| The pins | `server/test/history-replay.test.ts`, `server/test/history-quiz-single.test.ts`, `server/test/history-quiz-unattended.test.ts` |

The new module sits outside `GATE_CODE_FILES` because the driver is at its growth cap. The consequence for the key is in
section 7.

## 2. What changes for the history gate's own pilot

`spawnArgv`, `launchRun`, `armJob`, `openJudge`, `leftoverShapeOf`, `persistenceMeasured` and `persistenceCheckOf` are
shared. The gate's `step0b --section pilot|quiz` and its arms and judge pass no settings value, no staging and no proof, so:

- Its spawn argv, its run records and its verdicts are unchanged (the characterization rows pin the argv of every mode).
- A measured `left` row's `shape` now names entries three levels below each root, not two, and gains `files`, the path of
  every regular file the walk found. The verdict is unchanged: a row with no proof fails as before.
- The gate's code sha moves, because `deploy/history-replay.mjs` is one of `GATE_CODE_FILES`. A W2 run that resumes on a
  release carrying this change is refused by the gate's code preflight, as for any change to that file.
- `--repilot` and the pilot key belong to the single-arm module and the runner alone. The gate's own re-pilot is
  untouched.

## 3. B0 in detail

| Question | Answer |
|---|---|
| The key | `{ claude_code, code_shas }`: the `--version` line the driver's `measureClaudeVersion` reads through the week's launcher, and `codeShas().files`, the gate's per-file shas. Two keys are one when their canonical bytes are equal. |
| Where it is measured | The runner (`measuredPilotKeyOf`): the week's recorded account admitted from the roster (`readRoster`, `admitAccount`), the gate's code shas, then `measureClaudeVersion`, which spawns `--version` only, spends nothing and writes nothing but the poisoned `gh` under the week's folder, as the driver's own measure does. Any failure is `unmeasured` with its reason, never a throw. At most once a tick, and only when the week's pilots leave the key the one question (a spent week, or one with a pilot whose key is unreadable, never measures). |
| Where it is recorded | The single-arm module's release pin, at both write sites, from the key that act measured (`expected`). The runner's row: each pilot entry `{ release, key, at_ms }`, the release kept for the record. The permission `{ release, key }`. |
| Yes when | The row is `failed` on the pilot word, fewer than three pilots, every pilot's key measured or older than keys, the key measured now, and none of the keyed pilots has it. |
| Otherwise | One `STAY_CLOSED` word: `no-week`, `not-failed`, `not-the-pilot`, `pilots-unreadable`, `pilots-spent`, `failed-key-unmeasured`, `key-unmeasured` (the journal says why), `key-unchanged`. |
| An entry written before B0 | One that names a release and carries no `key` counts toward the cap and matches no key. One with neither (its release could not be read) is unmeasured and keeps the week closed. A pin written before B0 labels the week's first pilot as such an entry. |
| What "never twice" means now | Never two pilots in one ISO week on the same pilot key. The cap of three, counting before the spawn (the row saved before the driver is spawned), and one permission for one act all stand as PR #3253 pinned them. An entry from before B0 matches no key, so a week closed before this change lands can be piloted once more on a key it already ran, bounded by the cap; that is the ruling's "matches no key". |
| The permission | Passed only while the key measured at that act is its own (`repilotPermitOf`). A release that moves while the key does not keeps the permission. |
| The driver's own refusals | Unchanged: a round under way on another release still refuses `repilot-release-moved`, and a week's arms on another release `release-moved`. |

## 4. B1 to B4 in detail

| Ruling | What the module does | Recorded |
|---|---|---|
| B1 | `arms` reads the skill's files (`ccd/history-skill/SKILL.md` and `LICENSE.lossless-claw`, the installer's two) without following a link, each a regular file within 1 MiB, and pins their sha before `--out` exists. Each treatment-arm run (step 0b's probes, the fallback probe, the week's questions) re-reads them, refuses on a changed sha, and writes them into its fresh working folder, never over a file. The box run and the judge get none. | `skill_sha256` in the step 0b result; `staged_sha256` in each staged run's record |
| B2 | Due only under restricted, with the skill the only failed check and none unmeasured. One arm-mode run under the fallback mode (the first taught spelling's prompt, the skill staged, the map passed), its skill listing read by the driver's own skill check. Its persistence is recorded beside it and decides nothing. | `skill_fallback`: `{ run, skill: listed / not-listed / unmeasured, persistence, record }`, or null |
| B3 | The map is composed from the box run's init alone. An empty map passes no argument. A recorded map read back (a reused passed result, the judge's read of the result the arms summary names by sha) goes through the same checker, so a damaged one refuses `out-refused` before any spawn. `spawnArgv` merges the value under the fallback mode's own `--settings` (the mode's own key wins), and passes it after `--restricted` otherwise. | `plugins_off`; `checks.plugins.map_passed`, `map_refused`; the run record's `settings` |
| B4 | Each row of the round gets `proof` (box and probes alike), from one read of `knownUuids` over the store's read handle and the registry. A file outside `<slug>/<session>/…` is not one the subagent decision covers, so it counts as readable. | `proof: { own_folder, no_main_transcript, walk_complete, store_cannot_read, files, readable, passed }` |

## 5. Measurements

All counts were taken in this workspace's `server` package through `ccrc test`, as an ordinary user.

- **Characterization first.** Commit `747bcb7a78` pinned, green against `main`'s code: every spawn mode's argv under both
  settings modes, the persistence check's answers, the leftover shape at two named levels, a passing week's arms and judge
  argv, and the step 0b result, run record and release pin field sets. The later commits edited only the rows their ruling
  moved, each saying which: the pin's fields (B0), the step 0b result's fields, the plugins check's fields and the run
  record's fields (B1 to B3), and the shape's depth and `files` (B4).
- **Suites, green at `eb6783a6e2`** (the single-arm suite again at `04034d85bb`, whose only change is its header):
  - `history-replay`, whole, one worker: 1898 cases.
  - Together: `history-quiz-single`, `history-quiz-single-characterization`, `history-quiz-unattended`,
    `continuity-quiz-lane` and `lifecycle`: 467 cases (the single-arm module 103, the runner 221).
  - The tree guards `growth-caps`, `growth-check`, `anchors`, `citations`, `deviation-refs`, `oss-metadata`,
    `topology-clean`, `ci-pipeline`, `ownership`, `dtbd`, `single-definition/*` and `rings/*`: 67 files, 2085 cases,
    3 skipped.
  - The test tree's type check is clean.
- **Not run:** the whole server suite; the PR's CI run on the pushed tip is the measurement of it.
- **Mutants.** Each was applied to a scratch copy of the tree extracted from the commit named (never to the workspace), its
  named tests were run, and the file was restored and checked byte for byte. A kill is a non-zero exit with failed tests.
  B0's 22 at `00e8add653`, all killed; B1 to B4's 32 at `77d7a787b3`, 30 killed, one killed at `eb6783a6e2` after its row
  was added, and one equivalent.

| Mutant | Killed by |
|---|---|
| B0-M1 a re-pilot on an unchanged key (the brief's first; #3253's M15) | the table's same-key rows; 10 cases |
| B0-M2 a fourth pilot, the cap removed (the brief's second; M14) | the table's cap rows, the wiring's three-pilot case; 5 |
| B0-M3 only the last pilot's key compared (M16) | back to an earlier failed key; 2 |
| B0-M4 any closed word piloted again (M17) | the other-word rows; 6 |
| B0-M5 an unmeasured key causes new spend (M18) | the unmeasured and damaged key rows, the unmeasured wiring case; 4 |
| B0-M6 the runner passes no `--repilot` (M19) | 13 |
| B0-M7 a pilot whose key could not be read admitted (M20) | the unreadable-pin and damaged-key rows; 10 |
| B0-M8 an entry written before B0 refused | the older-entry rows and wiring; 3 |
| B0-M9 the permission passed on any key (N10) | 3 |
| B0-M10 the permission left on the row before the spawn (R8, N9) | the kill cases; 4 |
| B0-M11 nothing saved before the spawn (N8) | the kill cases; 4 |
| B0-M12 the permission not given back after a resumable stop (N13) | 3 |
| B0-M13 the permission given back after a stop that is not resumable (R7) | 2 |
| B0-M14 a re-pilot counted twice at its closure (N14) | 6 |
| B0-M15 a spent week measures a key | the spent week asks for no key; 1 |
| B0-M16 the first pilot labelled without its pin's key | 19 |
| B0-M17 a pin written before B0 read as an unmeasured key | the older pin labels an older entry; 1 |
| B0-M18 the reopened row records no key | 5 |
| B0-M19 the release still the key | the unrelated-release case and others; 21 |
| B0-M20 the pin records no key | the pin's fields; 3 |
| B0-M21 the pin composer takes any key | the composer refuses a non-key; 1 |
| B0-M22 the measure drops the gate's code from the key | the real measure's case; 2 |
| B1-M1 the staged skill unpinned (the brief's third) | `skill-source-moved`, the stager's own case; 2 |
| B1-M2 the pin taken at staging, not at the act's start | `skill-source-moved`; 1 |
| B1-M3 the week's question runs not staged | 1 |
| B1-M4 the probe runs not staged | 5 |
| B1-M5 the source read follows a link | the link case; 1 |
| B1-M6 the source pinned after `--out` | nothing written before the refusal; 1 |
| B2-M1 the fallback probe changes the verdict (the brief's fourth) | the listed case stays `pilot-failed`; 1 |
| B2-M2 due whenever the skill fails, beside others | the not-due cases; 2 |
| B2-M3 the probe made under restricted | the fallback argv; 2 |
| B2-M4 due under fallback too | the due table; 1 |
| B3-M1 a map entry taken from anywhere but the pilot's observation (the brief's fifth) | 8 |
| B3-M2 a malformed source reaching an argument, at the composer (the brief's sixth) | 2 |
| B3-M3 the same, at the settings value's own check | the damaged-map cases; 2 |
| B3-M4 a non-build entry admitted with the map (the brief's seventh) | the build that ignores the map; 3 |
| B3-M5 a refused entry does not fail the check | 2 |
| B3-M6 the week's question runs get no map | 1 |
| B3-M7 the judge gets no map | 1 |
| B3-M8 the probe runs get no map | 1 |
| B3-M9 the mode's own settings value loses on a shared key | 1 |
| B3-M10 the first run gets a map | 3 |
| B4-M1 own folder dropped (the brief's eighth, one of four) | 1 |
| B4-M2 no main transcript dropped | survived at `77d7a787b3`: its row was a regular file, which the store condition also refused. The row where it alone decides (a main transcript that is a link, beside no regular file) was added in `eb6783a6e2`; killed there, 1 |
| B4-M3 walk complete dropped | 1 |
| B4-M4 store cannot read dropped | 2 |
| B4-M5 the known ids never read | the known-session end-to-end case; 1 |
| B4-M6 unreadable known ids read as none known | 1 |
| B4-M7 a file outside any session folder read as unreadable | 1 |
| B4-M8 the check ignores the proof | 3 |
| B4-M9 any proof object passes, so a gate row with no passed proof would | 2 |
| B4-M10 the shape names two levels again | 2 |
| B4-M11 the shape lists no files | 1 |

**The equivalent one, B4-M12** (the proof asks the tick form alone). Both forms of `decideAgentIngest` require a known parent,
and the proof asks both with every other gate open, so the import form never decides alone today. It is kept so the proof
follows the sweep's decision if a form's rule changes; it is named here rather than counted as a kill.

## 6. Departures, by slug

- **pilot-module-outside-gate-files**: the stage-B rules live in a new module, `deploy/history-quiz-pilot.mjs`, because the
  driver is at its growth cap. Last round kept its readers in the driver so the gate's code sha would cover them; this one
  could not.
- **key-is-gate-code-shas**: the key's code part is `codeShas()` over `GATE_CODE_FILES`, as the ruling says ("as the gate
  already computes it"). The single-arm module and the new pilot module are not in it (section 7).
- **runner-measures-the-build**: the runner reads the build through the driver's own `measureClaudeVersion` on the week's
  recorded account, behind a test seam (`deps.pilotKey`). It writes the poisoned `gh` under the week's folder, as the driver
  does.
- **entries-carry-release**: pilot entries and the permission keep the release beside the key, for the record and the
  journal; nothing decides on it.
- **older-entry-without-release-unmeasured**: an entry with no key and no readable release keeps the week closed
  (`failed-key-unmeasured`) rather than matching no key, so an unreadable older pin still never re-spends.
- **pilots-judged-before-key**: `repilotOf` judges the pilots before the key now, so a week that cannot be piloted again
  measures no key.
- **pin-round-stays-on-release**: the driver's in-round refusal (`repilot-release-moved`) still keys on the release, so one
  pilot result never spans two releases.
- **skill-two-files**: the staged skill is the installer's two files; the list is spelled again in the module beside the
  installer's (`ccd/install-history-skill.sh` REQUIRED_FILES).
- **skill-pinned-before-out**: the skill's source is pinned before `--out` exists, so its refusal writes nothing.
- **fallback-needs-nothing-unmeasured**: "the only failing check" is read as the only failed check with none unmeasured.
- **fallback-probe-first-spelling**: the fallback probe uses the first taught spelling's prompt; its persistence is recorded
  beside it, outside the verdict.
- **empty-map-no-argument**: a map that switches nothing off passes no `--settings`, so such runs keep today's argv exactly.
- **map-checked-when-read-back**: a recorded map is read back through its checker; a damaged one refuses `out-refused`.
- **records-not-compared**: a run's record gains `settings` and `staged_sha256`, and a resumed run is not compared on them,
  as it is not compared on the build.
- **proof-quiz-only**: the gate's caller proves nothing, so its verdicts are unchanged; only the shape change reaches its
  records.
- **shape-lists-files**: the shape gains `files`, every regular file the walk found, for the proof.
- **proof-fails-outside-session**: a regular file not under `<slug>/<session>/` counts as one the store could read.
- **tests-in-existing-files**: the new cases sit in the existing `history-*` test files, as last round's did (a new one would
  join the node floor's list, a pipeline change).

## 7. Known limits

- **Nothing here is proven on the fleet box until a pilot runs it there.** Still unknown: whether `--restricted` lists a
  staged project skill (B2 records the fallback answer when the skill is the only failure); whether `--settings` is
  honoured under `--restricted` and a false `enabledPlugins` entry unloads a marketplace plugin (a build that ignores it
  fails the check as today, now recording that the map was passed); and whether the Agent probe's leftover is that one
  session folder alone (B4 records each condition).
- **The key's code part is the gate's four files.** A change to the single-arm module or to `history-quiz-pilot.mjs` alone
  does not reopen a week, and neither does a change to the staged skill's bytes alone. This PR moves the key, since it
  changes `deploy/history-replay.mjs`.
- **Two readings of the key.** The runner counts a pilot against the key it measures; the driver pins the key it measures
  seconds later. A build that rolls in between can let one more pilot run on a key already piloted. The cap of three and
  the week's one budget hold.
- **The first pilot's key is the pin's, from the week's first `arms`.** A first pilot interrupted and resumed on another build
  of the same release carries the first build's key, so a later pilot on the build it actually ran on is possible. The cap
  holds.
- **The runner spawns `--version`** at most once a tick, only for a closed week whose pilots leave the key the question,
  writing the poisoned `gh` under that week's folder.
- **The map comes from the box run alone.** An entry that loads only for an arm run is not in it, and fails the check.
- **The fallback probe spends one more run** of the week's budget, and only records.
- **A second or third pilot that fails again is quiet**, as before (run 3514's A5).

## 8. Review 3553's corrections (account-room note)

In `2ed55bf9f9`, words only, in `docs/superpowers/programs/overlord/quiz-account-room.md`: section 4's launcher sentence
covers a generated account whose launcher can be read but not run; the credentials-file refusals name the
not-a-regular-file case; sections 10 and 11's tree-guard counts name their file set (section 6's list, with `coord-db` in
section 11, beside review 3553's own count); and section 9 adds the stop that lands on the last candidate with room, which
reads as no room.
