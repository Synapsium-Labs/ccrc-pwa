# Overlord W1a: the weekly replay quiz runs, records and confirms itself (run 3212)

The note of run 3212 (programme `overlord`, issue #2491), for the coordinator to fold into the programme ledger. It
records the design, the rulings it was built under, what landed, the measurements and the departures, each by slug. No
D-number was issued.

## Why

The operator's ruling of 2026-11-22: "Quiz results etc etc … I'm tired of you creating manual tasks for me that you should
be able to do yourself." It supersedes one condition of the W0-28 ruling, "the driver runs by your hand; ccrc never runs
it", and only that one. Before this change the operator had to run `deploy/history-quiz-single.mjs` by hand each week,
then `ccrc quiz-record`, then press Confirm on Settings, Automation, Shadow lanes.

## The rulings this was built under

The run put five questions to the coordinator, who ruled each one.

| Ask | Ruling |
|---|---|
| The weekly `arms` refuses `family-unlisted` until `~/.ccrc/history/headless-on` lists the frozen families, and nothing wrote that marker | Ask 694, option 0: the timer writes it **once**. It writes exactly the frozen families the driver's `marker` step printed, its sha checked, atomically (a temp file linked into place, never a rename over a file), 0600, and journals the write once in `~/.ccrc/quiz/journal.log`. A marker already there that lists every frozen family is kept, and any other stops the run with a word and writes nothing. Steer, agents-on, recall-off and every other marker stay the operator's. |
| `setup`'s values, which have no default | Ask 695, option 1: built-in defaults. Budget 5,000,000, settings mode `restricted`, and `claude-opus-5-5` for the writer, the judge and the arm, never Fable, frozen in `setup.json`. A model move is a new setup and a new baseline, never a silent one. |
| The account, "chosen automatically at each run" | Picked at setup from the placement reading: a subscription account (not hidden, `upstream` or `generated`, telemetry neither `openrouter` nor `codex`) with weekly room by the driver's own limits reading, the most room first. Its room is re-checked before every `arms` and `judge`; no room is the waiting word `no-room`, retried at the next tick. The driver itself stays unchanged. |
| What "the operator can still Discard from the card" means | The card is unchanged: Confirm and Discard act on pending runs. A timer run is confirmed at once. |
| How a stop word reaches the Shadow lanes card and the coordinator | A status door, `POST /api/continuity/quiz-status`, and one migration (slot 120, allotted beside run 3213's 119). |

## The design

```mermaid
sequenceDiagram
    participant T as ccd-quiz-weekly.timer
    participant R as history-quiz-unattended.mjs
    participant D as history-quiz-single.mjs
    participant V as ccrc quiz-record --confirm
    participant S as server
    participant C as overlord coordinator
    T->>R: a tick (every 6 h after the last run ended)
    R->>D: setup, source, freeze, marker (once)
    R->>R: write headless-on once, if absent
    R->>D: arms, judge, report (this ISO week's directory)
    R->>V: the report and its sha
    V->>S: POST /api/continuity/quiz-runs (pending, run id)
    V->>S: POST /api/continuity/quiz-runs/:id/confirm {sha256}
    S->>S: ruleQuizRun: confirm on a match, discard on a mismatch
    S-->>C: mail on a baseline
    C->>S: POST /api/continuity/quiz-baseline/live {lane}
```

*Figure 1. One week's run, from the timer's tick to the coordinator's Live.*

### 1. The runner and its timer

- `deploy/history-quiz-unattended.mjs` is the timer's one act. It refuses `in-session` when `CLAUDECODE` is set at all and
  `in-pane` when `TMUX_PANE` is set, before anything else. The timer's run is neither, so it passes honestly; nothing
  unsets either variable.
- It spawns the driver, `node --no-warnings <tree>/deploy/history-quiz-single.mjs <subcommand>`, exactly as the runbook's
  operator does, with a by-name environment (`HOME`, `LANG`, `PATH`), and reads each step's `sha256 <hex>` line and its
  refusal line from stderr. Every refusal the driver has stays: step 0b's probes, `release-moved`, the masking agreement,
  the weekly `--budget`, the read-only store and no writing form of `ccrc history`. The runner never opens the store.
- Its directories are under `~/.ccrc/quiz/` (0700): the setup `--out` at `setup.<n>`, and one `--out` per ISO week (UTC)
  at `weeks/<YYYY-Www>`. It keeps the newest four week directories and removes older ones it made. A week is one directory: a refusal that needs a fresh `--out` (`release-moved`, `pilot-failed`,
  `out-refused`) or that resuming cannot cure (`budget-exhausted`) closes the week as `failed` with its word, and the next
  week tries again. So one week never spends more than one `--budget`. A stop that resuming cures (the limits words,
  `interrupted`) is resumed on the same directory at the next tick.
- Its state is one file, `~/.ccrc/quiz/unattended.json`, written whole by rename. Its `last` block (the tick's time, act,
  outcome, word and detail) is what doctor reads.
- `ccd-quiz-weekly.timer` (`OnActiveSec=30min`, `OnUnitInactiveSec=6h`) starts `ccd-quiz-weekly.service`, a oneshot
  running `/usr/bin/env node --no-warnings %h/ccrc/deploy/history-quiz-unattended.mjs` under the account's real HOME. It
  is placed and enabled by `ccrc update`'s install spine on every role but `server` (a server box keeps no history
  store), and removed by `ccrc uninstall`.

### 2. Confirmation without the operator

- `ccrc quiz-record --confirm` records the run with `unattended: true`, which the record door answers with a single-use
  confirm key (stored as its sha256 hash), then posts `{ sha256, by, confirmKey }` to the box-token door
  `POST /api/continuity/quiz-runs/:id/confirm`, with the run id the record answered.
- The door asks the one ruler, `quizStore.ts#ruleQuizRun`, with the action `match`: a pending row is confirmed under the
  existing baseline rule (`quiz.ts#quizBaseline`) when the key matches its stored hash and its report sha equals the sha;
  a missing or wrong key, or another sha, is refused and the row stays pending (fix round 2, F1a and F1b). A row already
  ruled answers its own state when its sha matches (a resend), and is refused otherwise. `ruledBy` is the caller's trace
  under the server's fixed head `ccrc-unattended:` (F1c). The ruling stays the one writer of `state`, `ruledAt`, `ruledBy`
  and `baseline`, and of the withdraw's `withdrawnAt` and `withdrawnBy`.
- The operator can withdraw a confirmed baseline from the card (`POST /api/continuity/quiz-runs/:id/withdraw`, F1e): the
  run becomes `withdrawn`, never counts again, and the next run confirmed while every W1a lane is in shadow becomes the
  baseline.
- The baseline rule is unchanged: the first confirmed run while every W1a lane is in shadow becomes the baseline, and it
  is never a W2 result, a PASS or a measured benefit of recall.

### 3. Waking the coordinator, and its Live

- Once a confirmed baseline exists, the server queues one system mail to the programme's coordinator
  (`CoordStore.programmeCoordinator('overlord')`), or, with no overlord run open, to the designated Overlord session,
  subject `quiz-baseline-confirmed run <id>`. It is keyed on the run (`wokeAt`): the confirm door and every status tick
  ask, and the run is marked woken only once the mail was queued, so a throw or a missing recipient is retried (F4).
- Taking a W1a lane Live was an operator switch: `POST /api/coord/lane-arm` is session-gated and refuses Live while
  sign-in is dark. The smallest door for the coordinator is `POST /api/continuity/quiz-baseline/live { fromId, fromUuid,
  lane }`: box-token gated, attribution-checked, ownership-checked (the caller holds an open run of `overlord`), a W1a
  row only, Live only, and only once a confirmed baseline exists (`laneArm.ts#decideLaneArmCoordLive`). It writes
  through `CoordStore.setLaneArm`, the one writer, and records a feed row naming the coordinator.

### 4. The weekly item

The weekly item said "ccrc never runs it". It now waits out a grace period after the week starts, so the timer has its
chance, and says the unattended run has not confirmed this week's run and where to read why (doctor's quiz line).

## What landed

| Piece | Where |
|---|---|
| The runner: setup once (the account by the placement reading), source, freeze, the marker and the one headless-on write, then each week's arms, judge, report and the record with `--confirm`; a setup-phase refusal latched to once a week; the tick's status posted | `deploy/history-quiz-unattended.mjs` |
| The timer and its install, uninstall and doctor check (`_check_quiz-weekly`, and the timer in `known`) | `deploy/systemd/ccd-quiz-weekly.{service,timer}`, `ccd/ccrc`, `ccd/ccrc-doctor-checks`, `deploy/deploy.sh` |
| `ccrc quiz-record --confirm` and the client's `quiz.confirm`, `quiz.status` and `quiz.live` rows | `ccd/ccrc-quiz-record`, `ccd/ccrc-api` |
| The `match` ruling inside the one ruler; the baseline mail; the status reader and its stop mail; the weekly item's grace and words (L1) | `server/src/continuity/quiz.ts` |
| The status row's one writer and reader | `server/src/continuity/quizStore.ts` |
| The confirm, status and Live doors | `server/src/continuity/quizRoutes.ts`, wired in `server/src/server.ts` |
| The coordinator's Live decider and the card's tick block | `server/src/coord/laneArm.ts`, `shared/lane-arm.ts` |
| `continuity_quiz_status` | `server/src/coord/schema.ts` (by position the entry after `main`'s 118; slot 120 by the coordinator's word) |
| The card's tick line | `pwa/src/fleet/laneArmWords.ts`, `pwa/src/fleet/ShadowLanesSection.tsx` |
| The runner's lifecycle class, and the single-arm `--out` class's new creator and collector | `shared/lifecycle.ts` |

Is taking a W1a lane Live a session's act today? No: it is an operator switch. `POST /api/coord/lane-arm` is session-gated, refuses Live while sign-in is dark, and no box token reaches it. So the smallest door for the coordinator is added: `POST /api/continuity/quiz-baseline/live`.

## Measurements

- **Red first.** The server doors' 13 cases were red against `HEAD`'s sources and green with the change. The client rows' censuses went red against `HEAD`'s client. The runner's and the doctor's tests were written beside the code, so their red was measured by mutation (the slug below).
- **Mutants**, each applied to a saved copy, its one test run, the file restored and checked with `cmp`:
  - The doors, 13: the confirm door's token check; the match comparing nothing; a resend answered for an unmatched ruled run; mail with no baseline; mail on a resend; a resend rewriting the row; the Live door's token check, its attribution, its ownership, the baseline not required, any lane, extra body keys; the Live decider's gate and an unreadable baseline read as missing. All killed. Two needed L1 unit cases, because the mail queue drops a duplicate outstanding mail.
  - The ruling's mutant set (`server/test/sim/quizSets.ts`) gains V6 to V10 for the match path, and the lane set L12 and L13 for the grace. Every quiz set passes at its floor.
  - The verb, 4: the flag dropped, a discarded run read as confirmed, another sha confirmed, the baseline tail always printed. All killed.
  - The card, 4: the tick line not rendered, the parser dropping it, a wait shown amber, a malformed tick dropping the block. All killed.
  - The runner, about 40 across its three rounds (the refusals, the exclusive and atomic marker write, the marker's completeness, the child environment, the resumable words, the latch, the account filters and room order, the weekly re-check, `week-ended`, the prune, the status post). All killed but one equivalent mutant: the marker's create mode, which the runner's umask masks to 0600 either way.
  - The install and doctor, 14. All killed.
- **Suites run, one file at a time through `ccrc test`, all green:**
  - The quiz, record and lane-arm suites: `continuity-quiz-unattended`, `continuity-quiz-route`, `continuity-quiz-lane`, `ccrc-quiz-record`, `history-quiz-unattended`, `history-quiz-single` and the `continuity/quiz.ts` and `laneArm.ts` mutant sets.
  - The client, route and census suites: `ccrc-api`, `ccrc-api-closed`, `auth-gate`, `box-token-census`, `overlord-other-lanes-census`, `coord-db`, `lifecycle` and `mail-routes`.
  - The guard suites: `anchors`, `citations`, `ccd-contexts`, `deviation-refs`, `topology-clean`, `oss-metadata`, `ccrc-cli`, every `single-definition` file and the `rings` files.
  - The install and doctor suites: `ccrc-doctor-quiz`, `ccrc-doctor-core`, `ccrc-doctor-core-state`, `ccrc-install-units`, `ccrc-install-role`, `ccrc-uninstall`, `census-w8/cadence`, `timer-first-run` and `agent/test/deploy-verify`.
  - The PWA's `shadow-lanes-section`.
- **The test slice's memory cap** (6G, shared fleet-wide) killed `history-replay`, `shellcheck-ratchet` (shellcheck of `ccd/ccrc`), the PWA typecheck and the first armed growth-check runs during this run. CI is the arbiter for those. The shellcheck warnings of `ccd/ccrc` (62) and `ccd/ccrc-doctor-checks` (34) were measured equal to the base. Net code lines: `ccd/ccrc` +3 and `ccd/ccrc-doctor-checks` +36, both under the limit of 40.

## Departures, by slug

- **headless-marker-by-timer** (ask 694): the operator's 2026-11-22 ruling supersedes "no history marker written" for headless-on alone. The runner writes it once, as above.
- **setup-defaults-auto-account** (ask 695): the defaults and the account rule above. The account is fixed in `setup.json` at the one setup and re-checked for weekly room each week, because the driver's later steps spend the setup's account, and the frozen list and every answer record are keyed on the setup's sha.
- **quiz-status-door** (the coordinator's ruling): the runner's word reaches the card and the coordinator through a box-token door and one stored row. A new stop word mails the coordinator once per week and word: a `refused` or `failed` tick, and `no-room` although it only waits. A limits stop does not mail, because the next tick resumes it. The mail's subject carries the week and word, because the system mail queue drops a mail whose subject is still outstanding.
- **match-ruling-in-the-one-ruler**: the server's confirmation is a third ruling of `ruleQuizRun`, never a second writer. A resend of a run already ruled under the same sha answers its state and writes nothing.
- **coordinator-live-skips-sign-in**: the card's door takes Live only from a signed-in operator. The coordinator's door takes the box token, attribution and ownership instead, and only for a W1a row once a confirmed baseline exists. That is what the brief asked for, stated so nobody reads it as a bend.
- **w1a-live-door-in-quiz-routes**: the coordinator's Live door lives in `continuity/quizRoutes.ts`, beside the baseline that gates it, not in `coord/routes.ts`, which run 1850 holds frozen. It writes through the one writer, `CoordStore.setLaneArm`, and decides in `coord/laneArm.ts`.
- **weekly-item-grace**: the weekly item is held until three days into the week (`QUIZ_UNATTENDED_GRACE_DAYS`) and says the unattended run runs the quiz; its titles are unchanged, so a week is never raised twice across the deploy.
- **week-is-one-directory**: a refusal that needs a fresh `--out` (`release-moved`, `pilot-failed`, `out-refused`) or that resuming cannot cure (`budget-exhausted`) closes the week `failed`, so one week never spends more than one `--budget`; the next week tries again. A week still running when the next ISO week starts closes `week-ended`.
- **setup-phase-latch**: a refusal in the one-time setup phase is retried at most once per ISO week, so a deterministic refusal never spends writer tokens every six hours.
- **runner-red-by-mutation**: the runner's, the doctor's and the install censuses' tests were written beside their code, so their red was measured by mutation (above), not before the code.
- **schema-and-readme-by-packet**: `server/src/coord/schema.ts` (run 3213's claim) and `README.md` (run 1850's) were changed by one additive packet each, applied on their holders' yes. The README packet's digest was checked against the holder's reading before it was applied.
- **no-room-detail-by-position**: a `no-room` detail names each candidate account by position, never by id.

## Fix round 1 (CI on the first push)

The pull request's fast run was red in six cases, none of them run locally in the build round:
- `ci-pipeline`'s node-floor case pins that the floor leg runs every `history-*.test.ts`. The build round had left
  `history-quiz-unattended.test.ts` off that list as a departure; the pin says otherwise, so the test is now on the list
  in `ci.yml`, and the departure is withdrawn. The `.github/` edit puts this pull request on the full run.
- `ccrc-versioned-audit`'s unit row walks every `%h/ccrc/...` path a shipped unit names: the install fixture now places
  `deploy/history-quiz-unattended.mjs`.
- `run-close-switch`'s migration case rebuilds a version-53 database by dropping every later table: it now drops
  `continuity_quiz_status` too.
- `lane-arm-route` and `continuity-quiz` pinned the card read and the ruler's answer exactly: they now carry the new
  `unattended` block and the ruler's `changed` and `reportSha`.

All five files pass, run together through `ccrc test`.

## Fix round 2 (review 3232, ruled in the coordinator's fix-round mail)

| Finding | What changed |
|---|---|
| F1a | The record door answers an unattended record (`unattended: true`) a single-use confirm key and stores its sha256 (`confirmKeyHash`, migration 119). The confirm door rules `match` only with that key; a run recorded by hand never gains one, so only the card confirms it. An unattended resend of a run still pending mints a new key and voids the old one, so a runner whose confirmation was lost can finish on its next tick. |
| F1b | A sha mismatch refuses and leaves the run pending; it is never discarded. |
| F1c | `ruledBy` is `ccrc-unattended:` and the caller's trace. |
| F1d | The session hook's deny program gains a quiz row (`qzmatch`): `ccrc-api` followed by `quiz` and `record`, `confirm` or `status` is refused on every session, child or top-level, bare, path-qualified, quoted or as a `$VAR` program; `quiz live` stays open. Its prefilter reads `quiz` followed by a blank, never `quiz` alone: with `quiz` alone, a session whose path names `quiz` forked jq on every call, and the merge-deny suite's 100 KB bounded-time cases failed under such a temp path. An accident guard as the account arm is; CLAUDE.md says so. |
| F1e | The withdraw door and the card's Withdraw (no step-up: it only narrows; it still refuses while sign-in is dark). It raises no item. |
| F2 | The stale "only the operator's confirmation makes it count" sentences are rewritten in `ccd/ccrc-api`, `auth/gate.ts`'s EXEMPT reasons, `quizRoutes.ts`'s header, `server.ts`'s registration comment and `ccd/ccrc-quiz-record`'s header. |
| F3 | Before every act the runner checks it can record: the client is an executable file and the box credential file exists (by `stat`, never opened). Otherwise the tick waits with `record-path-missing` and spends nothing. The timer stays on `both`. |
| F4 | The baseline's wake is keyed on its run and retried each tick until queued; with no overlord run open it goes to the designated Overlord session. |
| F5 | The account pick and the weekly room check read the operator's lane switch (`~/.cc-sessions/<id>-disabled`, as ccd's `_lane_enabled` reads it); a switched-off setup account waits with `account-disabled`. |
| F6 | No change: whichever of #3169 and #3170 lands first keeps 119, the other renumbers. |
| F7 | One shared helper (`laneArm.ts`'s row and baseline rules) for both Live deciders, and a parity test over one input table (`lane-arm-parity.test.ts`). |
| F8 | The runner has one state reader, shared with doctor through `--state-verdict` (`ok`, `absent`, `unreadable <code>`, `malformed <why>`). Doctor names EACCES on its own line, and its remedy for a bad file is honest: read the journal, move the file aside, start the service, which then starts a NEW setup (it spends again and breaks week-to-week comparability). |
| F9 | Two ISO weeks of waiting ticks mail the coordinator once, `setup-account-gone`. The account is never re-picked. |
| F10 | `history-quiz-single-out` carries a ruling again, for what the runner never collects (a hand-run `--out`, a setup directory left after a refusal), with its pin. |
| Nits | The marker's journal line is written before the link, and the temp is fsynced; the status door takes the runner's trace; an empty detail is stored as none; a setup-phase stop's mail key carries its week. |

**Schema and README.** The migration (119 then, 120 since fix round 3) gains four nullable columns on `continuity_quiz_runs` and three on its new table, by a
second packet on run 3213's yes (it checked the state column has no CHECK). README's confirmation clause changed by a second
packet on run 1850's coordinator's yes.

**Departures, fix round 2:**
- **unattended-flow-outside-a-pane**: the remaining residual, corrected by review 3254 F1. Since fix round 3 the hook row also
  refuses the shell verb `ccrc quiz-record` and its script `ccrc-quiz-record` (bare, path-qualified, quoted, `$VAR`, with or
  without `env` and its `-u` prefixes), so the one-line `env -u` form is refused too. What stays open is exactly: a script
  file, `bash -c` with an assembled string, or another interpreter that posts the two rows itself. The key closes confirming
  a run someone else recorded, or one recorded by hand; it does not stop a caller that can post the record row from recording
  its own report. It is an accident guard, not a wall.
- **status-door-trace-not-session**: "the attribution check its siblings have" is the trace the record and confirm doors take
  (`by`, stored as `reportedBy`), because the runner has no session and so no `fromUuid`. The hook arm refuses the status row
  on every session.
- **kill-switch-is-a-file**: the runner tests `<id>-disabled` as ccd does (`[[ -f ]]`, a regular file), not by `lstat`; a
  directory of that name is not a switch, as in ccd.
- **card-baseline-wakes-too**: a baseline the operator confirms on the card is also woken for, on the next status tick.
- **withdrawn-lanes-stay-live**: a withdraw never moves a lane; a lane already live stays live, so the next baseline waits until
  every W1a lane is back in shadow.
- **waiting-streak-counts-every-wait**: F9's streak counts every `waiting` tick (no room, the lane switch, the record path, the
  limits words), since each means the setup account cannot finish the week.
- **fsync-unobserved**: no test can observe the marker temp's fsync; the test title no longer claims it.

**Known limits (the review's other nits):** the service's stop handler signals its direct child only (systemd's control-group
kill covers the rest); two runners can both judge a stale lock stale, and a recycled pid after a reboot can hold `locked`
(doctor's stale bound catches it); an unknown-outcome status row left by a rollback blocks every status post until the new
build returns; an operator Discard of a stuck timer run is retried every six hours that week; doctor reads an absent state
file as PASS and names no waiting word, and when node or the runner cannot run its verdict line borrows the move-aside remedy;
`LaneArmQuizReads.status` is optional; the card's amber choice is made in `ShadowLanesSection.tsx`; the stop mail's fallback key
is chosen in `quizRoutes.ts`; a `generated` account with telemetry `none` is admitted; `continuity_quiz_status`'s writer is not in
`single-definition/writers-map.test.ts` (as `continuity_quiz_runs`'s is not); a week rollover can spend two budgets
(`week-ended`); `~/.ccrc/quiz/weeks/` keeps four weeks of history-derived transcripts; any session can start the service by
hand (`systemctl --user start`), which is idempotent and one budget a week.

## Fix round 3 (review 3254, ruled in the coordinator's fix-round mail)

| Item | What changed |
|---|---|
| F1 | The hook's quiz row also refuses the shell verb `ccrc quiz-record` and its script `ccrc-quiz-record` on every session: bare, quoted, `$VAR`, after `env` and its `-u` prefixes, and by path where the path is run (at the head of a command, after `env`, or through `bash`/`sh`), so a `cat`, `git add` or test run naming the script's path passes. `quiz-record` is its own prefilter term. The operator's hand use outside a session is unaffected. The departure `unattended-flow-outside-a-pane` now names what stays open. |
| F2 | The prefilter reads `quiz` followed by a blank, a stripped tab or newline (`t`, `n`) or a backslash, so a tab between the words reaches the matcher on a top-level session too. The row also refuses an act held in a variable (`ccrc-api quiz $V`), since its act cannot be read; `quiz live` written out stays open. Tab, newline and `$V` cases are in the table. |
| F3 | The deny reason says text that only names a row is refused too, and to reword it or write it through a file (`git commit -F <file>`). As the account arm's, a commit message or an `echo` naming a row is refused. |
| F4 | Withdraw takes a second tap: a confirm sheet (danger, Cancel focused) says the run never counts again, no door reinstates it, and Live on a W1a lane is refused until a fresh run is confirmed. The card's note says an earlier confirmed run is never promoted. |
| F5 | The migration comment says a ruled run's hash is never read (the ruler reads the key only while the run is pending). The client carries the key from the record's answer to the confirm body on `jq`'s stdin, never in its argv or a shell variable. |
| F6 | An end-to-end case: a withdrawn baseline makes the card's Live and the coordinator's Live both answer `baseline-missing`, and no lane moves. |
| Merge | `origin/main` merged once. #3170 landed first with migration 119, so this branch's entry is 120; `coord-db.test.ts` and `run-close-switch.test.ts`'s rollback comment are re-pinned (the DROP line already dropped the new table). |

Each new guard was mutated by hand and its test went red: the three new hook arms, both prefilter terms, the reason
sentence, a path arm that matches anywhere (the `cat` case), a one-tap withdraw, and a baseline read that still counts a
withdrawn run.

## An incident to report

While building the README packet in this session's temp root, a Python script went through an unquoted shell heredoc. Bash
command-substituted the backticked spans in its text, so three commands ran from inside this session's pane:
- `ccrc quiz-record --confirm` refused at once (`in-session`), before it read an argument or a file, so nothing was posted;
- `ccrc-api` with no arguments printed its help;
- three spans that began with `POST` were not found as commands.

Nothing was recorded or changed. The packet was rebuilt with a quoted heredoc, and the coordinator was told.

## Hook refusals

- A read-only search of a test file was refused as "printing the whole environment", because the search pattern held the
  short word for the process environment. The coordinator approved reading the file with the Read tool, and the same
  harmless act was done that way. The false refusal is carried as a hook follow-up.
- Fix round 3: a shell command that applied this round's hook edit through a script was refused as "printing the whole
  environment", because the regular expression it carried names the `env` prefix it matches. Under the coordinator's
  standing word for a text-only refusal, the same edit was made with the Read and Edit tools.
