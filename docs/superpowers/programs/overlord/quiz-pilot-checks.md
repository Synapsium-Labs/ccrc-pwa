# Overlord W1a: the quiz pilot's checks, round 1 (run 3514)

The note of run 3514 (programme `overlord`, issue #2491), for the coordinator to fold into the programme ledger. No
D-number was issued, so departures are named by slug. It covers what changed and why, what the change means for the
history gate's own pilot, what was measured and what was not, and the design options for the three failures this round
leaves open. It reads after run 3508's note (`quiz-weekly-repair.md`, section 3), whose finding it builds on.

## In short

- **Ruling 1, tools.** The build reports the Agent tool under its wire name `Task`. A one-row table,
  `WIRE_TOOL_ALIASES = { Task: 'Agent' }`, is applied to the tools the init event reports and never to the tools the argv
  grants. The set comparison stays exact. On the measured shape, the tools check now passes.
- **Ruling 2, plugins.** An entry counts as the build's own only when its `source` ends in `@builtin` and its `path` is the
  word `builtin`. Any other entry, including one with a field missing, fails the check as before. The result now records,
  per run, how many entries of each class loaded, and the name and source of every refused entry. On the measured shape the
  five build entries pass and the marketplace entry still fails the check.
- **Ruling 3, persistence.** The verdict is unchanged: anything left still fails. A measured leftover now carries its
  `shape`: its entries two levels down with their sizes, whether a `subagents` folder stands, and whether any transcript
  file stands anywhere below. Only names and sizes are recorded, and no file is opened.
- **Ruling 4, skill.** No change.
- **Ruling 5, a second pilot inside the week.** A pure decider, `repilotOf`, rules on it, and the runner acts on its answer.
  A week closed on `pilot-failed` is piloted again in its own directory only when the installed release differs from the
  release of every pilot that failed that week, and at most three pilots run in a week. The pilot spends on the week's own
  ledger, so its spend counts toward the week's one budget, and a pass carries on as a first pass would.
- **Ruling 6.** Step 0b still fails closed. No check was removed or skipped, and the only loosening is rulings 1 and 2.
  Today's behaviour was pinned first, in a commit that was green against `main`.
- **Known limit.** Nothing here has been proven on the fleet box. The pilot is expected to stop again on the plugins,
  persistence and skill checks, which are now measured.

## 1. What changed, by file

| Piece | Where |
|---|---|
| The alias table and its reader (`grantedToolNamesOf`), the plugin class (`pluginClassOf`), the plugins record (`pluginsLoadedOf`), the tools and plugins rows of `initChecksOf` | `deploy/history-replay.mjs` |
| The leftover's shape (`leftoverShapeOf`, with `LEFTOVER_SHAPE_MAX_ENTRIES` 1000 and `LEFTOVER_SHAPE_NAMED_DEPTH` 2), added by `persistenceMeasured` to a measured `left` run | `deploy/history-replay.mjs` |
| `arms --repilot`, the one door that pilots a failed week's `--out` again (`repilotPrepare`, `step0bResultOf`, `step0bFailedRel`) | `deploy/history-quiz-single.mjs` |
| `repilotOf`, `PILOTS_MAX` (3), `PILOT_FAILED`, `STAY_CLOSED`; the failed-pilot record, the reopening and the `--repilot` flag | `deploy/history-quiz-unattended.mjs` |
| The pins | `server/test/history-replay.test.ts` (the characterization block and the rulings 1 to 3 blocks at its end, and two older rows that now project the plugins state), `server/test/history-quiz-single.test.ts` (ruling 5's door), `server/test/history-quiz-unattended.test.ts` (the decider's table and the wiring) |

Run 3508's claim (6722) holds `deploy/history-quiz-unattended.mjs` and `server/test/history-quiz-unattended.test.ts`. Their
hunks went to that run's worker first, as a unified diff against `main` d7c8b5866b, with both files left untouched. The
holder agreed to exactly those hunks, and they were applied byte for byte. None of them touches the header line that
PR #3252 changes.

## 2. What changes for the history gate's own pilot

`initChecksOf`, `persistenceMeasured` and `step0bVerdictOf` are shared. The gate's `step0b --section pilot|quiz`
(`step0bCommand`) and the single-arm `arms` both build their results from them, so both callers get rulings 1 to 3:

- A `Task` reported beside `Bash` now passes the tools check against the arm argv's `Agent` and `Bash`. A build that
  reports both `Task` and `Agent` fails the check, because that is two Agents.
- A plugins list made only of the build's own entries now passes. The result's `checks.plugins` gains `loaded`, one
  element per arm run in the order the runs went, or `null` for a run with no init event or no plugins list.
- Each row of the result's `persistence` list that is measured as left gains `shape`. Clean rows and unmeasured rows are
  unchanged.
- The gate's readers of a step 0b result (`step0bOf` and `step0bModeOf`) read only the kind, the section, the record sha,
  the settings mode and the verdict lists, so none of them changes. A result written before this change keeps its sha and
  its meaning.
- The gate's code sha moves, because `deploy/history-replay.mjs` is one of `GATE_CODE_FILES`. A W2 run that resumes on a
  release carrying this change is refused by the gate's code preflight (`tree-moved` or `code-changed`), as it is for any
  change to that file. This is also why the new
  readers stay in that file rather than in a module of their own: a module outside `GATE_CODE_FILES` would let the
  pilot's checks change without the gate's code sha moving. To fit the file's growth cap (6796 code lines, D-8635), the
  additions were written tighter, and the file now stands at 6793.
- `--repilot` belongs to the single-arm module alone. The gate's own re-pilot (`--section quiz`) is untouched.

## 3. Ruling 5 in detail

| Question | Answer |
|---|---|
| Where the decision lives | `repilotOf({ week, pilots, release })`, which is pure. The runner calls it once per tick, for the current ISO week only, before the first act. |
| Yes when | The week's row is `failed` with word `pilot-failed`, fewer than three failed pilots are recorded, the installed release is measured (readReleaseStamp's `value`), every failed pilot's release is measured, and the installed release is none of them. |
| Otherwise | One `STAY_CLOSED` word: `no-week`, `not-failed`, `not-the-pilot`, `pilots-unreadable`, `pilots-spent`, `release-unmeasured`, `failed-release-unmeasured` or `release-unchanged`. Anything unreadable keeps the week closed, so a value that could not be measured never causes new spend. |
| The failed release | Read from the single-arm module's own release pin in the week's directory (`quiz/arms-release.json`), which that module writes before its pilot runs. It is recorded in the week's row as `pilots: [{ release, at_ms }]` when the week closes on the pilot word. |
| Where the pilot runs | In the same week directory, through `arms --repilot`, so its spend lands on the week's one ledger. |
| What `--repilot` does | With no failed result on the `--out`, it does nothing. With one, it refuses `out-refused` if any arm batch was ever planned there, because the week's arms would then span two releases. Otherwise it keeps the failed result as `quiz/step0b/<mode>.failed.r<round>.json`, pins the week to the release it measures, and runs step 0b as the next round. It makes no decision of its own. |
| A pass | The week carries on into arms, judge, report and record, as a first pass would. |
| Status wire | No change. `last` keeps its fields, and a closed week reads `act: done, outcome: refused, word: pilot-failed` as before. |

## 4. The design options for the three open failures

These come from the code alone. Nothing was spawned, and neither the driver nor the runner was run against a real home.
None of these options was built.

### 4.1 The skill

**How the skill reaches an arm today.** `ccd/install-history-skill.sh` places `ccrc-history` at `<config dir>/skills/ccrc-history/`
in every rostered home. The arm runs with `CLAUDE_CONFIG_DIR` set to the account's config dir (`spawnEnv`), so the skill
sits in that account's user skills folder. The run's working folder is a fresh, empty temporary directory outside any git
tree (`makeRunCwd`), so it holds no project skills.

| Mode | Arguments (`SETTINGS_ARGV`) | The skill |
|---|---|---|
| `restricted` | `--restricted` | Measured absent on 2.1.330 (run 3508's reading of week 47). |
| `fallback` | `--setting-sources project,local`, `--settings '{"disableAllHooks":true}'` | Unknown. The user source is dropped, and whether the user skills folder is tied to that source is the build's behaviour, not this tree's. |

| Option | Certain from the code | Needs a spawn to know | The next pilot measures it? |
|---|---|---|---|
| S1: stage the shipped `SKILL.md` into the run's own working folder as a project skill, `<cwd>/.claude/skills/ccrc-history/`, before each arm run | The driver creates that folder itself and removes it after the run (`launchRun`), so the write stays inside a directory the driver owns, and it never reads the account's settings. The staged bytes would have to be pinned the way the gate's code files are, because they shape the measure. | Whether `--restricted` loads project skills when it ignores the project settings file, and whether `fallback` loads them with the project source on. | No. Nothing stages it today. |
| S2: carry the skill in a plugin loaded for the run (a plugin-directory argument, if the build has one) | The plugins check would then see an entry that is not the build's own, and ruling 2 refuses it unless the check learns that entry by name and path. | Whether the build has such an argument, and whether a plugin's skill loads under each mode. | No. |
| S3: put the skill's text in the prompt instead of a skill | The skill check would still fail, because the init event would not list the skill, and the measure would change from a skill the arm finds to text that is always in the prompt. | Nothing; it changes what is measured. | No. |
| S4: run the unattended week in `fallback` | One constant in the runner, `SETTINGS_MODE`. | Whether the user skills folder loads without the user source. | No. The runner pilots `restricted` only. |

The unattended pilot runs `restricted` only, so its next run measures the skill as absent again. The init event's skills
list stays readable in each run's stream under the week's `--out`.

### 4.2 The marketplace plugin

**What loads it with every settings file ignored.** The arm's config dir is the account's (`spawnEnv`), and the
plugin's path lies under that dir's plugins folder. `--restricted` ignores the user, project and local settings files. So
something other than a settings file loads the plugin, presumably the build's own record of installed plugins in the
config dir. Which record that is, and whether a settings value can switch it off, belongs to the build and cannot be
read from this tree.

| Option | Certain from the code | Needs a spawn to know | The next pilot measures it? |
|---|---|---|---|
| P1: choose the account at setup by reading what it has installed, preferring one with no marketplace plugin, and re-read it before each `arms` as room is | The runner already chooses once at setup from a per-account reading (`candidatesOf`, `roomOf`), so this would add a row to that choice. It would add a reader of Claude Code's on-disk plugin layout, which the project's rules give to `ccd`, the anti-corruption layer, so the reader would be `ccd`'s or would need a recorded "legitimately different" reason. | Which file the build treats as its install record, since a directory listing could disagree with what loads. Whether any eligible account on the box has none; if none has, the week stops with `no-account-admitted`, an honest stall. | Partly. See below. |
| P2: an argument or settings value, such as `--settings` with an `enabledPlugins` map that sets that plugin to false | The key is readable from the pilot's own result, since the plugins record now names each refused entry's `source` in `name@marketplace` form. `fallback` already passes `--settings`, and `restricted` passes none today. | Whether `--settings` is honoured under `--restricted`, and whether a false entry unloads an installed marketplace plugin. | Partly. |
| P3: `--safe-mode` | Per the help text run 3508 read, it disables installed plugins, skills and hooks, so it also drops the history skill. | Whether a skill delivered some other way still loads under it. | No. |
| P4: a quiz-only config dir | The account's credentials live in its config dir, so this would copy them, which the account rules forbid. | Not pursued. | No. |
| P5: remove the plugin from the account | This is an operator chore, and the operator has ruled out handing them chores. Another account's plugins would reappear on a change of account. | Not pursued. | No. |

**What the next pilot measures here.** The plugins record now names each refused entry's name and source per run, and
counts the build's own entries. The next pilot on the box will show whether exactly one entry is refused and whether the
five build entries now pass. It will not answer the open questions in P1 or P2.

### 4.3 The subagent's leftover

**Certain from the code.**

- In the measured week only the Agent probe left anything: `projects/<slug of the run's working folder>/<session id>/`,
  with no `.jsonl`.
- The slug is unique to each run, because the working folder is a fresh `mkdtemp` directory. Leftovers therefore build up
  at one folder per Agent probe, which is at most three a week, in the account's config dir, until Claude Code's own
  cleanup removes them.
- The sweep's subagent arm (`walkAgentProject`, `ccd/history/sweep.mjs`) enters a session folder that has no `.jsonl` and
  looks only at its `subagents/`. Whether a subagent file is read into the store is decided by `decideAgentIngest`
  (`ccd/history/lib.mjs`). Both of its forms need the file's parent to be in `knownUuids`, which holds the confirmed
  epochs' uuids and every `$REG/*.uuid`.
- The probe's session id belongs to a print-mode run with `--no-session-persistence`. It has no main transcript, so it
  has no epoch, and it has no registry row. Its parent is therefore never known, and no tick and no `import` reads its
  subagent files into the store, whatever they hold.
- The census walk does enter and count such a folder.

| Option | What it costs the measure | What it costs the history store | Certain / needs a spawn | The next pilot measures it? |
|---|---|---|---|---|
| L1: the driver removes exactly what its own run created, after recording the shape and after proving the sweep could not have read it | The check would no longer measure that "`--no-session-persistence` keeps nothing". It would measure that "what was kept could not reach the store", which is a weaker statement. Persistence would pass only when the leftover is exactly that run's folder, the proof holds, and the removal succeeded. | None: the store never read the folder, and it never could. | Certain: the proof is the parent half of `decideAgentIngest`, asked through the sweep's exported `knownUuids` before the removal, and no epoch is made from a session that has no main transcript, so the proof cannot go stale. The cost is that the driver gains its first removal outside its `--out` and its working folder, a write into Claude Code's on-disk layout, which the rules give to `ccd`. No spawn is needed, except to confirm that the leftover is that folder alone. | Yes. The shape shows what the folder holds. |
| L2: the sweep skips the quiz's run folders, by the driver's temporary-name prefix folded into the slug | None. The persistence check still fails, so this alone does not unblock the pilot. | It changes only the census counts and the walk's cost, because the store already never reads these folders. It ties the sweep to the driver's temporary naming, which would then need one exported owner. | Certain from the code. | Not applicable. |
| L3: the arm loses the Agent tool (`--tools Bash`) | The treatment arm can no longer hand work to a subagent, so the quiz measures recall without the path real sessions use. Q11's subagent probe and its inferred tool list drop out, the tools check then wants `Bash` alone, and the alias row goes unused. | None. | Certain from the measured week: the seven runs without Agent left nothing. Unmeasured: whether the subagent path matters to recall scores. | Not applicable. |

**What the next pilot measures here.** Ruling 3's shape records whether a `subagents` folder and a transcript exist in
the leftover, with sizes, and it is read before anything could remove them. The pilot does not need to measure whether a
sweep tick would have read the folder, because the code shows that it cannot.

## 5. Measurements

- **Characterization first.** Commit `57d8a746c3` pinned today's behaviour on the measured shapes and was green against
  `main` d7c8b5866b. On those shapes, tools, plugins and skill failed, persistence failed through both halves, and the
  failure detail listed persistence, tools, plugins and skill. The change commit edited exactly the rows that rulings 1
  and 2 move: tools now pass, and the detail now lists persistence, plugins and skill. Each edited row says which ruling
  moved it.
- **Suites, through `ccrc test`, all green.** `history-replay` (1892 cases, run alone), `history-quiz-single`,
  `history-quiz-single-characterization`, `history-quiz-unattended` (154 cases), `continuity-quiz-lane`, `lifecycle`, and
  the tree guards (`growth-caps`, `growth-check`, `anchors`, `citations`, `deviation-refs`, `ownership`, `dtbd`,
  `oss-metadata`, `single-definition/*`, `rings/*`). The test tree's type check is clean. One mixed run lost the
  `history-replay` worker to the test slice's memory cap, and a growth case timed out beside it under that load. Both
  files were green when run alone.
- **Mutants.** Each mutant was applied to a scratch copy of the tree (never to the workspace), its named tests were run,
  and the file was restored. The unmutated tests were green before each mutant, and all twenty mutants were killed:

| Mutant | Killed by |
|---|---|
| M1 the alias row removed (the brief's first) | ruling 1: the measured init, the one-row table |
| M2 the alias applied to the granted side (the brief's second) | ruling 1: a grant naming Task |
| M3 a non-build plugin admitted, any list passing (the brief's third) | ruling 2: the marketplace entry fails; the characterization row |
| M4 one field alone admits, the path dropped | ruling 2: one field alone never admits |
| M5 an entry with a missing field admitted (the brief's fourth) | ruling 2: no path, no source |
| M6 the refused entries not recorded | ruling 2: the per-run record |
| M7 the leftover's shape not recorded | ruling 3; `step0bMechanics` on the stub |
| M8 the shape walk stops at the named depth, missing a deep transcript | ruling 3: the transcript three levels down |
| M9 the shape changes the verdict, reading left as clean | ruling 3; the characterization row |
| M10 `--repilot` ignores planned arm batches | ruling 5's door: `out-refused` |
| M11 `--repilot` does not re-pin the release | ruling 5's door: the new release pinned |
| M12 `--repilot` does not keep the failed result | ruling 5's door: the round 0 result kept |
| M13 a failed pilot probed again without `--repilot` | ruling 5's door: the control; the existing re-probe case |
| M14 a fourth pilot allowed, the cap removed (the brief's fifth) | the decider's table; at most three pilots |
| M15 a second pilot on the same release allowed (the brief's sixth) | the decider's table; the wiring cases |
| M16 only the last failed release compared | back to an earlier failed release |
| M17 any closed word piloted again | another word stays closed |
| M18 an unmeasured release causes new spend | the release now absent, untagged or unreadable |
| M19 the runner does not pass `--repilot` | a newer release reopens it |
| M20 a failed pilot whose pin could not be read admitted | an unreadable pin keeps the week closed |

## 6. Departures, by slug

- **tests-in-existing-files**: the new cases sit in the existing `history-*` test files. A new `history-*.test.ts` file
  would have to be added to ci.yml's node-floor list, which is a pipeline change and would run the full suite on every
  push.
- **repilot-same-directory**: the second pilot runs in the week's own `--out` rather than a fresh one, so its spend lands
  on the week's one ledger. This needed one new optional flag on the single-arm module, `arms --repilot`. The flag grants
  a permission and makes no decision.
- **repilot-every-failed-release**: "differs from the one that failed" is read as differing from every release that
  failed this week, so a rollback to an earlier failed release is not piloted again. This is stricter than the brief.
- **repilot-legacy-row**: a week that closed on `pilot-failed` before this change has no `pilots` list in its row. It is
  read as one failed pilot on the release in its pin, so the release that carries this change pilots again the week it
  lands in.
- **repilot-failed-result-kept**: before the pilot runs again, the failed result is kept as
  `quiz/step0b/<mode>.failed.r<round>.json`, so the round that failed stays readable.
- **plugins-record-per-run**: the plugins record has one element per arm run, in run order, rather than one total across
  runs.
- **shape-only-when-left**: only a measured `left` run carries `shape`. Clean and unmeasured rows are unchanged.
- **readers-stay-in-the-gate-file**: the new readers stay in `deploy/history-replay.mjs`, which is one of the gate's
  pinned code files, and were written tighter to fit its growth cap.
- **runner-by-packet**: the runner and its test file are held by run 3508's claim 6722. They changed only after that
  run's worker agreed, by mail, to exactly the hunks in a unified diff packet.

## 7. Known limits

- **Nothing here has been proven on the fleet box.** The pilot is expected to stop again with `pilot-failed`, on the
  plugins check (the marketplace entry), the persistence check (the Agent probe's leftover) and the skill check (absent
  under `restricted`). Each of those is now measured precisely: by the refused entry's name and source, by the leftover's
  shape, and by the skill list in each run's stream.
- The re-pilot fires only on a release change, which includes the release that carries this change. It fires at most
  twice more in a week, and only for the current ISO week.
- A week whose re-pilot fails after an arm batch was planned stays closed with `out-refused`. That cannot happen while
  the pilot fails before any arm runs, as it does today.
- A release stamp that cannot be read on the box (`absent`, `untagged`, unreadable) keeps every failed week closed.
