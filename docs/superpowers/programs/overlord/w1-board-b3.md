# Overlord W1, PR B3: every brake, and a walk that says what it could not read (run 4060)

Wave 248, ticket `w1-board-b3`: the board's follow-up, the five items review 4041 left on #3463. Requirements: the brief,
the board's note (`w1-board-b2.md`), #3463's Known limits, the plan's Table 1 (`2026-11-14-overlord-w1/w1-board-history.md`, the
brakes row) and the spec's Table 5.2a ("the state of every brake"). This note is what the ledger should learn; the coordinator folds
it in. No deviation number was allocated: departures are recorded by slug.

## What was built

**Item 1, the brakes part carries every brake.** Every switch of the switchboard (`SWITCHES`, `shared/switches.ts`) is now a row of
exactly one of three groups of `brakes`, keyed by its name:
- `switches.markers`: the registry marker rows, as before (`readSwitches` over the registry's one measured listing).
- `settings` (new, optional on the wire): the ten settings rows, each `measured` with `stored` and `value`, or `unmeasured` with a
  closed reason. `stored` is `row`, `absent` (no row stands; what that means is the owner's) or `seed` (a migration's seed, which no
  operator wrote), and null only for the three run-close rows, whose store reader reads a lost row as shadow and so cannot say.
  `value` is the word the row's OWNER reads in force (fix round 1, F1), a seeded or lost row included; `unknown` where the owner
  reads no word from a row that stands; null only when no row stands and the owner gives that no word. Per row, below.
- `files` (new, optional): the three files on the fleet host, each `measured` `set` or `clear`, or `unmeasured`.

The rows are derived from the table, never listed a second time: `settingSwitchNames` (new, in `shared/switches.ts` beside
`markerSwitchNames` and `ccrcFileSwitchNames`) and `ccrcFileSwitchNames`. The composer builds each group from those lists, so a row
the gatherer did not hand over reads `read-failed`, never a missing row. The gatherer's reader table (`SETTING_ROWS`,
`overlordBoardRead.ts`) is typed by the table's settings names, so a settings row added to the table is a type error until it has a
reader, and the composer's census case reds until its fixture answers the row.

**Item 2, the projects walk says what it could not read.** `listProjectsWalked` answers `unreadable`: the names of the entries under a
listed projects root whose own listing failed and which the measured type probe (`lstatMeasured`) does not read as a plain file or
as gone. A plain file is still skipped silently, and so is an entry that vanished. An entry whose type the probe cannot read is
named, because the walk cannot tell it from a failed read. Those entries leave the walk measured, so the rest of it stands. The
cache keeps its rule (a measured walk is kept, an unmeasured one is not), and a kept walk keeps its names with it, so a read served
from the cache names them too (`ProjectWalkCache.keptWalkRead`; `keptWalk` and `keepWalk`'s old call shape are unchanged). The
board's projects part carries the list (`unreadable`, new and optional). `listProjects`, which every other caller uses, answers
exactly its old three fields, and the projects route's wire does not change.

**Item 3, corrections.**
- The board's note: the portfolio slug now names the two fields of the view it leaves out, its `calibration` (the forecasts'
  fleet-wide score, a later wave's field) and its own `at` (the board's answer carries its own time); the gatherer line names
  `listProjectsWalked`; the mutation row names all 54 mutants (C2b and C2c were missing).
- The wire: the oldest-open-unmeasured flag's comment says null means the view did not report it; the part map's brakes and
  projects entries describe the parts as they are; the portfolio part's comment names the two fields it leaves out.
- The gatherer's projects port comment names `listProjectsWalked` and what else the same io reads.

## Which rows are measured, and which are not

Every row has a reader on the server side, so none is carried as `no-reader`.

| Group | Rows | Reader | Unmeasured when |
|---|---|---|---|
| markers | every registry marker row | the registry's measured listing, `readSwitches` | the listing failed (the group's `read-failed`) |
| settings | `stall-watch-level` | `CoordStore.stallSettings`, through `parseStallSettings` and `resolveStallWatch` | the store read failed |
| settings | `collect-lane-choice` | `CoordStore.collectLaneRow`, through `measureCollectLaneRow` | the store read failed |
| settings | `roll-idle-targets` | `CoordStore.rollSettings`, through `rollTargetsOf` | the store read failed |
| settings | `dispatch-abandon-choice` | `CoordStore.dispatchAbandonSetting`, through `dispatchAbandonViewOf` | the store read failed |
| settings | the three `run-close-*-choice` rows | `CoordStore.runCloseSetting`, one call for all three | the store read failed |
| settings | `plain-auto-memory` | `CoordStore.plainAutoMemorySettings`, through `plainAutoMemoryOf` | the store read failed |
| settings | `coordinator-advisor` | `CoordStore.coordinatorAdvisorSettings`, through `coordinatorAdvisorOf` | the store read failed |
| settings | `overlord-rung` | `CoordStore.ladderRungRead` ("the brakes' read"), its default `LADDER_DEFAULT_RUNG` | the database could not be read |
| files | `graph-gate-off`, `ccrc-card-off`, `compact-card-off` | the Overrides read's own `readCcrcFileSwitches` (one measured stat each, which the agent admits for exactly these names) | the stat proved neither presence nor absence |

Every settings row reads `no-store` on a server with no coordination store, and a reader that throws is `threw` for the rows it
serves and no other. Each store reader is called at most once per board read (a reader serving the run-close row's three columns
too), its answer or its throw kept for the rows it serves. No new agent frame, exec grant or ccd verb.

## Departures, by slug

- `board-switch-row-throw-reads-threw`: the brief says a reader that throws is that row's read-failed. The board's closed reasons
  already tell a throw (`threw`) from a reader that answered it could not read (`read-failed`), and every other part keeps them
  apart, so a thrown settings or file reader is `threw`, and a reader answering `unreadable` (or a file the stat could not measure)
  is `read-failed`. Either way it is that row alone, never a missing row or the part's failure.
- `board-setting-row-is-its-column`: a settings row carries the one column the table names for it (`advisor_settings.choice`, for
  example). The advisor's daily cap and its named list of sessions, and the stall watch's quiet time, are other columns, not carried.
  No entered text reaches the wire: an out-of-vocabulary stored word is `unknown`.
- `board-rung-twice`: the operator's rung rides the ladder part (as before) and the `overlord-rung` settings row (because it is a
  row of the table). Both are read from the store: the ladder part through the ladder read, the row through `ladderRungRead`. They
  are two reads of the row inside one board read, so a rung written between them can make the two differ inside one answer; the
  next read agrees again (A3).
- `board-run-close-rows-never-unknown` (A2): the three run-close rows never answer `unknown`. Their reader (`runCloseSetting`) reads
  a lost row, and any stored word it does not know, as shadow, which is also what the lanes do, so the board says shadow there. A
  case writes a corrupt word into the real store and pins it.
- `walk-type-probe-after-a-failed-listing`: the brief puts the type probe before the listing. It runs after a listing that failed,
  and only then: the outcome is the same for every entry (a listed directory needs no probe, and for an unlisted one the probe alone
  decides), it costs no extra request per project directory on every walk, and the walk's order and concurrency cases
  (`projects-route-cache.test.ts`, which pin the requests a walk makes) are unchanged.
- `walk-unreadable-names-not-a-flag`: the walk names the entries it could not read. They are folder names under the projects root,
  as `names` already carries.

## Mutation rows

**The composer's set** (`server/test/sim/overlordBoardSets.ts`, `composeBoard`). Before: 54 mutants, 54 killed. After: 69, 69
killed (the floors suite's `composeBoard` key, green). The floor stays 1. The fifteen new:

| Mutant | What it breaks |
|---|---|
| S1 | a settings row the gatherer did not hand over reads as no row |
| S2 | every settings row reads stored `row` |
| S3 | a settings row loses its value |
| S4 | a settings row carries what the gatherer handed over, extra fields included |
| S5 | the settings rows are the ones handed over, not the table's |
| S6 | the settings rows are dropped from the brakes |
| S7 | one settings row is read for another |
| F1 | an unmeasurable file reads clear |
| F2 | a failed file reading is every file clear |
| F3 | a failed file reading loses its reason |
| F4 | the file rows are the ones the reading names, not the table's |
| F5 | a file the reading does not name reads clear |
| F6 | the file rows are dropped from the brakes |
| W1 | the walk's unreadable folders are dropped |
| W2 | the walk's unreadable folders are left off the part |

**By hand** (each applied with the edit tool, `overlord-board.test.ts` run, the file restored and compared byte for byte with the
kept copy). Before each: 63 green.

| Mutant | File | After |
|---|---|---|
| M1 a failed listing is skipped, as before B3 | `lifecycle.ts` | 3 red (the walk names it, the kept walk keeps it, the projects part carries it) |
| M2 a plain file is named | `lifecycle.ts` | the same 3 red |
| M3 a gone entry is named | `lifecycle.ts` | the same 3 red |
| M4 an entry whose type the probe cannot read is skipped | `lifecycle.ts` | the same 3 red |
| M5 an unreadable folder makes the walk unmeasured | `lifecycle.ts` | the same 3 red |
| M6 the cache keeps the walk without its names | `lifecycle.ts` | 1 red (the kept walk keeps the names) |
| M7 `listProjects` carries the new field | `lifecycle.ts` | 2 red (B2's old-fields case and B3's) |
| G1 the run-close reader is called once per row | `overlordBoardRead.ts` | 2 red (called once; a throw called once) |
| G2 a stored word this build does not know rides as its text | `overlordBoardRead.ts` | 1 red (no entered text) |

**Red first.** The test files, run against main's composer, gatherer and lister (the wire and the switch list kept, so the files
load): 18 of 63 cases red, every one of them a B3 case or a B2 case whose expectation B3 widened (the field census, the readers'
own answers, the failure table). On this branch: 63 green.

## The size measure

`JSON.stringify(composeBoard(bigInputs(50)))` measures 104,414 bytes (it was 103,424), under the same bound of 120,000 (15 percent
headroom), so the bound did not move. The brakes' new rows are fleet-wide, not per programme.

## Verification

Each file alone, through the fleet test wrapper, at most two workers. See the wave-done mail for the list and its answers.

Two whole-tree guards were red in local runs before the first push, each fixed then: the wire's totality census wanted a runtime
list for the `stored` words (`BOARD_SETTING_STORED`, the board's map-and-derived-list form), and the one-home census of the
`absent | unreadable` pair caught the gatherer's generic constraint spelling it (now `string`).

## The fast run's red

The pull request's first run (head `ea2f9b0a1e`) was red in one server shard, on one guard over the whole tree, a real defect of
this wave: the coordination kebab census (`mail-routes.test.ts`, "every quoted kebab token in server/src/coord that looks like a
code is declared") read the gatherer's reader table keys, the switchboard's settings row names, as undeclared codes. The board now
declares them as its words (`isBoardKebab`), derived from `settingSwitchNames` and `ccrcFileSwitchNames`, so no second list. Red at
`ea2f9b0a1e` in CI; green after, with the board suite and the board's floors key.

## Known limits

- An entry under the projects root that is a link to a plain file, or a dangling link, is named as unreadable: the type probe reads
  a link's own type, and its listing fails. So is a non-directory of another type (a socket or a pipe).
- Against a fleet host whose agent cannot answer the type probe, every entry whose listing fails is named, plain files included.
- A project folder that is a link to a directory outside the agent's read roots is now named unreadable: its listing is refused
  and the probe reads a link. It was skipped silently before (A4).
- The rows of the Shadow lanes card and of the decision model are not on the board: the plan's brakes row is the switches table,
  and they are not rows of it (A4).
- The lister's and the gatherer's by-hand mutants (M1-M7, G1-G5) are not in the floors' set: the floors pair is shared work and
  stays untouched (A6). They are recorded here only.
- The projects route still folds the walk's flag and its names (the ticket B2 named); only the board reads them.
- A settings row carries its own column only (slug `board-setting-row-is-its-column`).
- The answer mask and the attribution limits of B2 stand unchanged.

## Fix round 1 (review 4067, call 1731)

**F1, each row's owner's word.** The first build read the idle-roll row's raw column, so a box nobody wrote (the migration's seed,
`coordinators` at time zero) read `seed` / `coordinators`, while the owner's reader (`rollTargetsOf`) reads the seed as its default,
`all`, and the roll pass uses that reader. Every settings row now goes through its owner's reader. What each owner gives a seeded or
lost row, measured row by row:

| Row | Owner's reader | Seeded or lost row, by its owner | Board before | Board now |
|---|---|---|---|---|
| `stall-watch-level` | `resolveStallWatch` over `parseStallSettings` | a lost row, or a row with a field it cannot read, applies nothing: the box's files decide | lost: `absent`, null; a chosen level beside an unreadable quiet time: that level | `follow` for both |
| `collect-lane-choice` | `measureCollectLaneRow` | tells the seed apart; a lost row is unmeasurable (`row-absent`), no word | the seed read `row` | seed `seed` / `off`; lost `absent`, null (no word); malformed `unknown` |
| `roll-idle-targets` | `rollTargetsOf` | the seed and a lost row read the default, `all` | seed `coordinators`, lost null | `all` for both |
| `dispatch-abandon-choice` | `dispatchAbandonViewOf` | a lost row arms nothing, no choice word | lost `absent`, null | the same (the owner gives no word) |
| the three `run-close-*-choice` | `runCloseSetting` | a lost row and any unknown word read shadow | shadow | the same, and never `unknown` (A2) |
| `plain-auto-memory` | `plainAutoMemoryOf` | a lost row reads the default, `off` | lost null | `off` |
| `coordinator-advisor` | `coordinatorAdvisorOf` | a lost row reads the default, `off`; a row whose cap or scope it cannot read gives no setting | lost null; such a row its choice | lost `off`; such a row `unknown` |
| `overlord-rung` | `ladderRungRead`, the ladder's default | no row reads `LADDER_DEFAULT_RUNG`, `chat` | null | `chat` |

The switches table's own default for the idle roll (`coordinators`) still differs from its owner's reader (`all`); the coordinator
files that line as its own ticket.

**Red first.** The board file against the first build's gatherer: 3 of 65 red (the lost-row case, the owner's-word case and the
real store's pinned rows); 65 green on the fix.

**New mutants, by hand** (each applied with the edit tool, the board file run, the gatherer restored and compared byte for byte):

| Mutant | After |
|---|---|
| G3 the roll row reads its raw column again | 3 red |
| G4 the stall watch's lost row has no word | 1 red |
| G5 no rung row loses the ladder's default | 2 red |

**The rest.** A1 the `absent` gloss is true for every row; A2 above; A3 the slug; A4 two known limits; A5 the kebab census comment
(a packet to its holder, applied as sent on its yes); A6 a known limit; A7 the walk's fixture holds a real link to a plain file,
pinned as named unreadable; A8 the size header says 15 percent, the measured bytes are asserted exactly, and the field census holds
the settings and file groups to the table's names, so it cannot pass on an absent or empty list (the no-store case too); A9 the kept
walk's names are a required argument (the four cache cases pass an empty list); A10 the switches file's header line is back to main's
text byte for byte.

## Design rule

Everything added is a server read the board already serves to any harness through the closed client and the door process's typed
tools. Nothing depends on one harness's hooks, tools or file layout.
