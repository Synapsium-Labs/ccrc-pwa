# Overlord W1a: the weekly quiz finds an account with room (run 3538)

The note of run 3538 (programme `overlord`, issue #2491, wave 216, ticket `quiz-account-room`), for the coordinator to fold
into the programme ledger. No D-number was issued, so departures are named by slug. It covers why, the rulings, what
changed, every account check the driver has and what became of it, the design question on measuring an idle account,
what was measured, and the known limits. It also carries review 3533's corrections of PR #3253 (section 7).

## In short

- **Why.** The repaired weekly timer fired on the fleet box for the first time, and the week stopped before its pilot:
  `arms`, waiting, `no-room`, "the setup's account: limits-stale five-null". There were two causes. The driver's limits
  reading called every row with no five-hour figure stale, which most rows on the box are today, because their plans have
  no five-hour window. And the runner re-read only the account chosen once at setup, whose row is hours old because no
  session renders a status line for it, so the quiz would have waited for good.
- **Ruling 1, one room rule.** A row the status-line writer marks `fiveWindowMinutes: 0` is judged on its weekly figure
  alone, as the fleet's rule (`shared/limitRoom.ts`, the twin of ccd's `_limit_score`) judges it. The coordinator's
  answer on the reset rows tightens one more thing to that rule: a window rolled over by its resetAt is unknown too
  (`rolled-over`), where the driver admitted it as a measured reset. Nothing loosens beyond the marker.
- **Ruling 2, the week's account.** It is chosen per week by a pure function, `weekAccountChoiceOf`, with a table test.
  A week that has spawned stays on its account. One that has spawned nothing keeps the previous account when it has room,
  else takes the lowest weekly figure with room.
- **Ruling 3, the record.** The week's first `arms` records the account in the week's folder before anything spawns:
  one writer, one composer, one reader. An act given another account refuses `account-moved`. The setup is never re-made.
- **Rulings 4 and 5.** The budget stays one week's, and the pilot's checks run on the account in use. The status's
  account is the week's when recorded.
- **The design question** (section 5): the quiz cannot measure an idle account before its first spawn without spending
  on an unknown row. The fleet's keepalive already measures idle accounts through the one writer. Recommendation: rely on
  it, and measure its first fleet pass.
- **Not proven on the fleet box.** The pilot is still expected to stop on the plugins, persistence and skill checks.

## 1. The rulings this was built under

| Ruling | What |
|---|---|
| 1 (the brief) | One room rule. The quiz's limits stop applies the windows the plan applies. A markerless row with no five figure stays stale. The age bound, the 70 percent threshold, inferred-by-age, the future-skew bound and every other stale word stay. Unknown is never room. Characterization first, then the change as its own commit, and a parity table. |
| The reset rows (ask, answered "Tighten to the shared rule") | The driver read a window whose resetAt had passed as a measured 0 and admitted it; the shared rule reads any rolled-over window as unknown. The parity table could not agree on those rows. Ruled: tighten. The row is now `limits-stale rolled-over`. |
| 2 (the brief) | The account is chosen per week, by a pure function with a table test; the runner only acts on it. A week that has spawned stays and waits; one that has spawned nothing keeps the previous account (last week's, else the setup's) when it has room, else the lowest weekly figure, ties in roster order; with none, `no-room`, the detail naming each candidate's word as setup's does. Candidates and the kill switch are exactly setup's. |
| 3 (the brief) | The setup is not re-made. The week's acts take the week's account explicitly, admitted as setup admits one and gated on that account's row at every spawn. One writer and one composer, kept in the week's own folder; another account refuses with a word of its own; an older week with no record reads as the setup's account. |
| 4, 5 (the brief) | The budget is one week's, whatever the account; the pilot's checks run on the account in use. The status wire stays additive: its account is the week's when recorded. |
| The hook refusal (ruling after delivery 33103) | The session hook refused a shell call whose text named the fixture HOME's credentials folder. Ruled: write the test text with the Edit tool only, spell the folder once, run the cases by naming the test file alone. Section 6 says how. |

## 2. What changed, by file

| File | Change |
|---|---|
| `deploy/history-limits.mjs` (new) | The limits reading's pure rules, moved out of the driver whole (`parseLimitsRow`, `decideLimits`), then changed: `parseLimitsRow` keeps `fiveWindowMinutes`; `limitsWindowsOf` names the windows a row is judged on (`weekly` for the number 0 only, `both` otherwise); `decideLimits` reads five only on a `both` row, stops a rolled-over window (`rolled-over`), and words a weekly-only threshold stop `seven <n> at or over 70, no five-hour window`. It imports nothing. |
| `deploy/history-replay.mjs` | The two functions and their three constants leave; the driver imports and re-exports them, so every importer keeps its path. It keeps the file read (`readLimitsRow`) and the gate (`refuseOnLimits`, `batchGate`). Code lines 6793 to 6746, against its cap of 6796. |
| `deploy/history-quiz-single.mjs` | `arms` and `judge` take an optional `--account` (default the setup's). `WEEK_ACCOUNT_FILE` (`quiz/week-account.json`), its kind, its composer `weekAccountText`, its reader `weekAccountOf` (never throws: `recorded`, `recorded` with `older`, `none`, `unreadable`), and `settleWeekAccount`, which `arms` calls after its claim and before any spawn (writing the record when there is none) and `judge` calls without writing. The new word `account-moved`. |
| `deploy/history-quiz-unattended.mjs` | `weekAccountChoiceOf` (pure), `weekAccountPickOf` (reads the record, setup's candidates and the previous account, then asks the choice), `previousAccountOf`, `statusAccountOf`. The setup's room re-check before `arms` and `judge` gives way to the choice; both acts get `--account`. The new own word `week-account-unreadable`. The header's account paragraph says all of it. |
| `server/test/quiz-limits-reading.test.ts` (new) | The characterization, parity and stricter tables (section 3). Its first push named it `history-limits.test.ts`, which the node floor's list in `ci.yml` must then name; that made the PR change a rules file beside everything else, and the review judge refused it (`rules-mixed`). It was renamed, and `ci.yml` is untouched: the reading is pure JavaScript with nothing tied to a Node version, and the driver's own limits section still runs on the node floor (departure `limits-table-off-the-node-floor`). |

```mermaid
flowchart TD
    T[tick: arms or judge due] --> R{week folder's record}
    R -- unreadable --> U[refused: week-account-unreadable, nothing spent]
    R -- recorded, or older week: setup's --> S{that account}
    S -- switched off --> D[waiting: account-disabled]
    S -- no room --> N1[waiting: no-room, the week's account]
    S -- room --> A[--account recorded]
    R -- none: nothing spawned --> P{previous account: last week's, else setup's}
    P -- a candidate with room --> A2[--account previous]
    P -- otherwise --> L{candidates with room}
    L -- some --> A3[--account lowest seven, roster order on ties]
    L -- none --> N2[waiting: no-room, each candidate's word by position]
    A & A2 & A3 --> X[single-arm module: admit, gate every spawn on that row, first arms writes the record]
```

*Figure 1. The week's account, from the runner's choice to the single-arm module's record.*

## 3. Ruling 1 in detail: the parity table, and where the quiz is stricter

`server/test/quiz-limits-reading.test.ts` holds three tables over the same bytes:

- **Characterization** (30 rows, committed first and green against `main`): every row's answer was the driver's. The
  change commit edited exactly the rows it moves, each labelled RULING 1 or RESET.
- **Parity** (16 rows): each row goes through the driver's reading and through `shared/limitRoom.ts` over
  `server/src/limits.ts`'s `readLimits` (a fixture HOME), and both must agree on the windows (`limitsWindowsOf`; on the
  shared side, whether the five figure changes the answer once seven is measured) and on measured or unknown.
- **Stricter** (6 rows): rows the quiz stops where the fleet's rule reads room, each with its reason. The quiz is
  deliberately stricter here, and only here: the one-hour age bound (on window-less rows too), an undated row, a stamp
  more than a minute ahead, a figure outside 0 to 100 (the rule takes any number), and the 70 percent threshold (the
  rule's ceiling is its caller's, 98 for ccd).
- An invariant over every row in the file: whatever the quiz admits, the fleet's rule calls room at the quiz's own
  threshold. Unknown is never room.

A marked row with a five figure (no writer makes one) is judged on its weekly figure alone, as the shared rule judges it:
five is not read, so it is not range-checked or age-inferred either.

## 4. Every account check the driver has, and what became of it

The brief asked for every place a later step's account is compared with the setup's.

| Check | Where | Now |
|---|---|---|
| A recorded run is reused only by the same account, mode, model and settings mode (`run-json-mismatch`) | `history-replay.mjs`, the finished-outcome reader | Stays. Within a week every job's launch is the week's account, so it compares against the week's account. A week never changes account, so it cannot fire on a legitimate resume. |
| `arms` and `judge` bound the setup's account (`admitNode(home, s)`, the judge's `accountId: s.account`) | `history-quiz-single.mjs` | Now the week's account (`--account`, default the setup's), admitted the same way, compared with the week's record (`account-moved`). |
| The step 0b result names its account | `history-quiz-single.mjs`, `step0bOf` | Information only; its reuse checks never compared the account. It lives in the week's folder, whose account never changes, and now names the week's account. |
| The runner re-read the setup's account's room before `arms` and `judge` | `history-quiz-unattended.mjs` | Replaced by the weekly choice, which re-reads the week's account's room and kill switch. |
| The status's account | `history-quiz-unattended.mjs`, `postStatus` | The week's when recorded, else the setup's. |
| Step 0a's launch pin (`step0a-launch-mismatch`) and `step0a account … is not --account` | `history-replay.mjs`, W2's step 0a and pilot-source | Stay. They are W2's, not the quiz's. |
| `report` | `history-quiz-single.mjs` | Compares no account, and spends nothing. |

One consequence of the move, stated so nobody reads it as an accident: the gate's code hash (`CODE_SHA_FILES`, the four
files `gate_code` pins) covered `decideLimits` while it lived in the driver. In its own module it is covered as the
driver's other imports are: by the release tag and the tree-moved preflight (W2-D24). Adding the module to the hashed
four would change every recorded `code_shas` shape, which this wave does not do.

## 5. The design question: can the quiz measure an idle account's limits itself?

Built: nothing. From the code only:

**What is certain.**
- The only writer of `~/.cc-limits/<id>.json` is `ccd/statusline-command.sh`. It writes only from a rendered payload that
  carries a real `rate_limits` figure, and a print-mode turn renders no status line. So a quiz spawn refreshes nothing by
  itself.
- Since D-8957, `ccd/ccd-telemetry-keepalive` takes one minimal turn on an idle account (the cheapest model, an empty
  prompt, `--output-format stream-json --verbose`), takes the newest `rate_limit_event` whose `unifiedWindows` names the
  weekly window, and hands it to that same writer (`_ka_feed`), so the writer stays the only one. Its gates: idle longer
  than `CCRC_KEEPALIVE_FRESH` (1800 s by default), one attempt per window, a backoff, no live session on the account, not
  marked dead. Its timer runs every 15 minutes. Once it works on the fleet, an idle account's row should be at most about
  45 minutes old, under the quiz's one-hour bound. Its own header says the event was read from the build's schema and has
  never been seen on a fleet turn.
- The quiz's spawns already run with `--output-format stream-json --verbose`, and every run's stream is kept under the
  week's `--out`. If the build emits the event, the quiz's streams already carry it. The driver's stream reader (W2-D51)
  does not read that event today.
- The quiz's gate needs room before the week's FIRST spawn. A stream reading can only follow a spawn that was already
  admitted. To measure an idle account itself, the quiz would have to spawn on an unknown row, which is the one thing
  "unknown is never room" forbids.

**What a spawn would have to show.** A `rate_limit_event` line whose `rate_limit_info.unifiedWindows` names `seven_day`
(and `five_hour` when the plan has one), each with a numeric `utilization` and `resetsAt`. The keepalive's first fleet
pass reporting `refreshed` is the measurement of that.

**The options and their cost.**

| Option | What it needs | Cost |
|---|---|---|
| A. Rely on the keepalive (recommended) | Nothing in the quiz. With ruling 2, the quiz also moves to an account whose row is fresh, so the keepalive matters only when no account is in use. | The keepalive's own turns, already spent. |
| B. The quiz feeds its own streams' events to the one writer between spawns | Reuse `_ka_feed` (never a copy: one feeder), called after each batch. It keeps the row fresh through a long act, so the gate before each later spawn reads a fresh row. It does nothing for the first spawn. | About 20 lines in the driver, which sits under its cap; a new dependency of the driver on ccd's writer; one bounded writer run (jq, 10 s) per batch. |
| C. A probe spawn on an unknown row | — | Rejected: it spends on an unknown row, and it duplicates the keepalive. |

Recommendation: A, and measure the keepalive's first fleet pass; B only if weeks still stop on stale rows in the middle
of an act.

## 6. Measurements

Every count was taken as an ordinary user, in this workspace's `server` package, through `ccrc test`, unless it says
otherwise.

- **Characterization first.** `ccfe49ff33` pinned the driver's limits answers, 30 rows, green against `main` d5a032c409.
  The move (`7a9b08db28`) changed only the table's import, and kept it green. Ruling 1's change is `1bd9067849`.
- **Suites, green:**
  - `quiz-limits-reading` (40 cases; named `history-limits` until the rename), `history-quiz-unattended`, `history-quiz-single`, `history-quiz-single-characterization`,
    `continuity-quiz-lane`, `continuity-quiz-unattended`, `continuity-quiz-route`, `lifecycle`, `ccrc-doctor-quiz` and
    `limit-room-parity`: 10 files, 526 cases, at `e54a7ba3bc`.
  - `history-replay`: the limits, step 0a and record-subcommand sections, 830 cases with the limits table, after the move.
    The whole file (1895 cases) ran once after ruling 1's change: 100 cases failed. All of them came from the new module:
    the import census, and two fixture trees that copy the driver's files without it. Those were fixed in the move commit,
    and the 830-case run above is after that fix. Two later whole-file runs and the test tree's type check were stopped
    by the test slice's shared 6G memory cap (exit 137, OOM kills while other heavy runs held the slots; no test failed).
    CI is the arbiter for those two.
  - The tree guards: `growth-caps`, `growth-check`, `anchors`, `citations`, `deviation-refs`, `oss-metadata`,
    `topology-clean`, `ci-pipeline`, `ownership`, `dtbd`, `single-definition/*` and `rings/*`: 66 files, 2082 cases,
    3 skipped.
- **Mutants**, each applied to a scratch copy of the tree, its tests run, the file restored and checked byte for byte.
  Every one was killed:

| Mutant | Killed by |
|---|---|
| B1 the marker ignored (the brief's) | 17 cases: the marked rows, the parity table, the invariant |
| B2 a markerless row with no five figure admitted (the brief's) | 7 cases: five-null rows, the parity table |
| B3 the age bound skipped for a window-less row (the brief's) | the marked rows past the bound (2) |
| B4 the reset tightening removed | the reset rows, the parity table, the driver's own reset case (6) |
| B5 a marked row read on its five figure at the threshold | the marked threshold rows (2) |
| W1 a week that has spawned moved to another account (the brief's) | 77 runner cases |
| W2 an act run on an account other than the week's record (the brief's) | the `account-moved` cases (2) |
| W3a, W3b an account with no room chosen (the brief's): the previous kept without room; the recorded one without room | 4 and 4 cases |
| W4a, W4b the kill switch ignored in the choice (the brief's): the recorded account; the candidates | 3 and 3 cases |
| W5 the previous account ignored (always the lowest) | 3 cases |
| W6 the runner passes no `--account` | 13 cases |
| W7 the record never written | 5 cases |
| W8 an older week read as never spawned | the older-week case |
| W9 the status posts the setup's account | the status case |
| W10 an unreadable record read as none | the unreadable case |
| W11 the act admits the setup's account, not the week's | 2 cases (the gate on the week's own row among them) |

- **The hook refusal.** One shell call that would have appended the single-arm cases by heredoc was refused whole by the
  session hook, because its text named the fixture HOME's credentials folder (the generated account's admission needs its
  declared file to exist). Nothing was written or run. It was reported to the coordinator and nothing was retried until
  the ruling. The cases were then written with the Edit tool. The folder's name is spelled once, as a constant
  (`CRED_DIR`), and the file planted there is empty, inside the fixture HOME under the run's temp parent. The driver's own
  tests build their generated accounts inline in each block and have no shared helper, so sharing one would have meant
  refactoring that file. The fixture is written the way they write theirs.

## 7. Review 3533's corrections of PR #3253

In tests and words only, in a commit of their own (`9ff5f20de8`), with no code line changed by it. The task note
`quiz-pilot-checks.md` now states:
- the kill windows as PR #3253's body states them: window (b) spends what the round had spent, and one later release
  reopens the week once;
- "a stop that is not resumable" as a kill or a driver failure, with the refusal case said;
- the two pin readers truthfully, neither the stricter, as a duplication to consolidate later;
- the mutants killed only as an ordinary user, corrected by running them: N3, N8 and R8/R9 are; N9 and N14 are not;
- the header line about PR #3252, which has landed;
- the mutant count as pairs.

The new or changed cases: a pin whose round is present but damaged reads as round 0; the empty pilot list is back among
the damaged-list rows; the kill variants' fixture check tells a kill from a driver failure; a refusal that is not
resumable closes the week on its own word. Each was red under its mutant (the note's section 5 says which).

## 8. Departures, by slug

- **limits-reading-own-module**: the driver stood three code lines under its cap, so the limits reading's pure rules moved
  into `deploy/history-limits.mjs` behind the characterization table, rather than being compressed. The driver re-exports
  them. Two fixture trees in the driver's tests and its import census name the new module.
- **reset-rows-tightened** (the coordinator's answer): a window rolled over by its resetAt is unknown, `rolled-over`. One
  existing driver case changed its answer, in ruling 1's commit.
- **account-flag-optional**: `--account` is optional on `arms` and `judge`, defaulting to the setup's, so the operator's
  runbook (which passes none) keeps working. The runner always passes it.
- **record-at-first-arms**: the week's record is written by the single-arm module's first `arms`, after its claim and
  before any spawn (the `--version` measure included), because the week's folder is the module's to make. So "a week that
  has spawned anything" is read as "a week whose record stands", which may include a week stopped between the record and
  its first spawn: it stays on its account, which is the safe direction.
- **older-week-by-its-pin**: a week with the release pin and no record ran on an older build, on the setup's account; it
  reads so, and is never given a record afterwards.
- **week-account-unreadable-waits-for-attention**: a record the runner cannot read is a `refused` tick with its own word,
  not a closed week: nothing is spent, and the coordinator hears of it through the status mail.
- **previous-is-newest-recorded-week**: "last week's account" is the newest earlier week whose folder records one; a week
  that spawned nothing is skipped; the setup's when none does.
- **gate-code-hash-not-widened**: see section 4.
- **limits-table-off-the-node-floor**: the limits table is `quiz-limits-reading.test.ts`, not a `history-*` test, so the
  node floor's list (`ci.yml`) need not name it and the PR changes no rules file. The node floor still runs the driver's
  own limits section in `history-replay.test.ts`, which goes through the same module.

## 9. Known limits and follow-ups

- Nothing here is proven on the fleet box. The pilot is still expected to stop on the plugins, persistence and skill
  checks (quiz-pilot-checks section 4).
- An idle fleet with no fresh row anywhere still waits `no-room` until the keepalive (or any session) refreshes a row;
  section 5's recommendation.
- Follow-up: the two release-pin readers (`armsPinOf`, `pinnedReleaseOf`) are a duplication to consolidate into one pure
  parser (review 3533, F3).
- A whole `history-replay` run and the test tree's type check after the final commit are CI's, because the test slice's
  shared memory cap stopped both locally.
