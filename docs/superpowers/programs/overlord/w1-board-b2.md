# Overlord W1, PR B2: the board (run 3990)

Wave 244, ticket `w1-board-b2`. Plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md`, Task 6 (PR B2), with its
Global Constraints, Review Focus, the PR split's row B2, Table 1's readers and open questions 3, 4, 17 and 18. The brief adds the
door process's `board` and `history` tools, the history row's readability (call 1590), and the carries of the sequence doors'
review (ticket `sequence-c-review-carries`, review 3978) and of B1's reviews (ticket `board-b1-review-carries`, reviews 3730 and
3749). This note is what the ledger should learn; the coordinator folds it in. No deviation number was allocated: departures are
recorded by slug.

## What was built

**The board.** `GET /api/overlord/board?byId&byUuid`, one composed read of the fleet.
- `shared/overlordBoard.ts` (L0, K): the wire. `BOARD_PARTS` are the W1 parts of question 3: identity, goals, work, portfolio,
  capacity, projects, brakes, itself and timers. A later wave's part is a new key. Each part or entry is `Measured<T>`: measured
  with its fields, or `unmeasured` with a closed reason from `BOARD_UNMEASURED` (`no-store`, `not-wired`, `no-reader`,
  `read-failed`, `threw`, `no-listing`). Text a session wrote is an `UntrustedText` with its source (`programme-title`,
  `session-name`, `item-title`, `goal-text`). Goal text the operator ratified is a `RatifiedText`.
- `server/src/coord/overlordBoard.ts` (L1, C5): `composeBoard` maps each reader's answer to its part, groups per programme by the
  slug the readers carry, and marks untrusted text (question 17). `timersByProgramme` counts each programme's coordinator's pending
  timers and finds the earliest due time. It reads a timer's setter and due time, never its note. `isBoardKebab` declares the
  board's words for the coordination kebab census.
- `server/src/coord/overlordBoardRead.ts` (L3, C5): `gatherBoard`, which calls each reader once inside its own try. `goalsFor` and
  `itemsFor` are called once per programme. A throw is `threw`, and a reader that answers it could not read is `read-failed`. A
  reader's own error text stays in the gatherer. An item is cut to its id, kind, state, urgency and title before the composer
  sees it. Projects come through `listProjects` with the server's own project-walk cache.
- `server/src/coord/overlordBoardRoutes.ts` (L4, C5): the door and `boardPortsOf`. The door checks the box token in `onRequest`,
  then the caller's pair, then the Overlord gate with row `board`, then the shared read runner, unfenced (call 1590). The runner
  writes one line: door `board`, scope `fleet`, the count of programmes, outcome `rows`. `boardPortsOf` builds the gatherer's ports
  from what the composition root holds, so `server.ts` adds seven lines.
- `OVERLORD_DOORS.board`: Overlord group, `GET`, its own file, `view`, `write: false`, `overlord-v1`, others refused, class
  `other`, act `read`, an unreadable designation refuses.
- `server.ts`: the board registered after the sequence read, and `/api/overlord/board` in `MASKED_GET_ROUTES`.
- The client: `ccrc-api overlord board`, row `overlord.board` (`GET`, no keys, the pane's pair in the query). One hundred and four
  rows.
- The door process: the `board` tool (no input) and the `history` tool (`verb`, exactly one of `all`, `project` and `session`,
  `agents`, `args`). Both are unfenced views with `reader: true`, and the read tool serves both. The history tool refuses an
  argument that the client's head would read as `--all`, `--project`, `--session` or `--agents`, so an argument never changes the
  target or the flag. `readableDoorRow` is exported: the read tool's one admission rule, which the overlord-v1 census asks.

**The history read, readable (call 1590, way A).** The history door's row is no longer a write. Its route calls the read runner with
`unfenced: true`, and the gate still runs first on every arm. The witness verdict, the gate's fence steps and the read tool's rule
are untouched. The inbox, messages and the card stay fenced and not readable.

**The readers' census (call 1590, points 5 and 6).** `door-tools.test.ts` checks every row marked reader: it is a view the read tool
admits, its route's Overlord door row is not a write, and the marked rows are exactly `board` and `history`. It also checks that
the read tool's enum is exactly the marked rows. The census is a function over the tables passed in, and it is red on each
synthetic mutant (below). Two cases cover a reader's call to a fenced row, both refused: `door-tools-argv.test.ts` through the
read tool, and `overlord-gate.test.ts` at the gate (no act key: `stale-generation`; only a reader-scope witness: `unwitnessed`).

**Carries from the sequence doors' review (3978).**
- F4: the cursor read's 503 says a fixed phrase, `the sequence could not be read`, never the store's text. A case pins it, mutant
  S8 forwards the store's text, and the route suite asserts the fixture fault never rides the 503. The masked-routes census's
  exemption sentence now names the fixed phrase.
- "Every attributed served line" in the four sentences: `CLAUDE.md`, `gate.ts`, `overlordDoors.ts` and
  `overlordSequenceRoutes.ts`.
- A ceiling case in the sequence route suite. Past the ceiling the read answers `read-ceiling` with its retry time and reads
  nothing. A gap line, and another door's served lines, do not count.
- F5: the gate suite's title names every row its set holds.
- F2: the composition root's wiring of the cursor read and the board through the real server
  (`overlord-read-doors-wiring.test.ts`, ten cases). Production refuses both doors `capability-missing` at step 2 until the
  `overlord-v1` piece, so the suite mocks only that word into the server's words; every other gate step runs for real (a real
  designation, generation, card read, authority guard and read ledger), and only the ladder's condition readers are injected as
  lifted, since the real ones need a launch profile's loads report. The cursor read serves lines from the server's own `coord.db`,
  its restore generation is the real counter's 7, and a line stamped after the first read is served above it. The board answers
  from the server's own store, two board reads walk the projects root once and share the projects route's cache, and the board is
  masked. A server with no coordination store refuses at the gate's step 1, so the sequence's `deps.coord === undefined` arm stays
  unreachable through the door; a case pins that refusal.

**Carries from B1's reviews.** The four that are done:
- 3749 F1: the client's UTF-8 check converts to UTF-16LE. That refuses a code point past U+10FFFF and the old five-byte form, which
  a UTF-8 to UTF-8 pass let through. The test pins the no-iconv path too (R3).
- 3749 F2: `name_ok` is anchored with `\A` and `\z`, and the corpus gains a project and a session with a trailing newline.
- 3749 F3: the history route's comment says `not-started` before the frame is sent and `lost` after it.
- 3749 F4 and F6: the read runner picks a refusal's `cause` and `refusal` by name instead of spreading `extra`, and
  `ReadComposed`'s doc comment is back above it. This one is a packet to the read runner's holder.

The ones left:
- 3730's known limit (an abort does not reach the agent; a wire addition).
- 3749 F5 (a commit message's wording).
- The plan lines that still read the history row as unfenced: a plan is the coordinator's to edit.

## Step 1, measured on main 87c64a957a

- **The live word.** No one reader answers `busy`, `idle`, `shell` and `dead` for one session. The watcher's listing
  (`FleetWatcher.currentFleetListing`) answers `SessionStatus` (`busy`, `idle`, `dead`). `shell` is the mail gate's reading
  (`turnidle.ts#mailTurnIdle` over the live file and the turn mark), computed per delivery inside the watcher, with no reader keyed
  by session id. So the identity row carries the listing's status and `shell` side by side, and `shell` reads `unmeasured`,
  `no-reader`. The board composes no new word.
- **A programme's home project.** No reader carries it (`ProgrammeRow` has none), so identity's `home` is `unmeasured`,
  `no-reader`.
- **A per-programme active-run reader.** None on main (question 18). Work carries the wave buckets as the programmes read answers
  them, and Capacity carries the fleet's `running` (`CoordStore.capsUsage`) beside the cap in force (`dispatch.ts#capNow`, the
  caps view's reader, over the watcher's host reading; see "The fast run's two reds" below).
- **The stall watch's window.** `STALL_NOTICE_WINDOW_MS` (48 hours, `stallsettings.ts`), the stall-watch view's notice window.
  `stallObservationsSince` answers run events with run ids, not programmes, so the per-programme stall fact is the stuck pass's
  count, which the programmes read carries through the watcher's `RunVerdicts` (`stuck`). The fleet's notice counts
  (`stallNoticeCounts`) ride the work part.
- **The readers by their merged names.**
  - Portfolio B: `portfolioFor(coord.portfolioFacts(now, liveAsk, liveSpend), now)`, as `GET /api/portfolio` composes it.
  - Readiness: `ReadinessLane.read()` (`deps.overlordReadiness`).
  - The ladder: `ladderRead(coord, inputs, witness, serverCaps)` (`overlordLadderRead.ts`), projected through its own
    `ladderWire`. The board carries the effective rung, the operator's rung, the standing latches and the live conditions (fix
    round 1, F2).
  - The isolation word: `IsolationReader.read()` (`deps.isolation`).
  - Sandbox B: no reader a read door can call. The settle fact is read inside the loads door's settle step
    (`continuity/routes.ts#settleFactOf`). So `itself.sandbox` is `unmeasured`, `no-reader`.
  - Programmes: `CoordStore.readProgrammes({since, now}, verdicts)`, composed with programme lifecycle W2's
    `programmesWithLifecycle` (on main since the plan), so a row names its bound coordinator.

## Where main differed from the plan

- The plan's handler sits in `overlordRoutes.ts`. On main that file registers only the operator's session-gated doors, and every
  Overlord box-token door has a routes file of its own.
- The plan's board is fenced like Task 5's history door. Call 1590 ruled both unfenced and readable (below).
- The programmes read has the lifecycle fields (W2). The board uses them for the coordinator.
- The read ledger's `board` door and its ceiling (120 an hour) are already on main (`READ_DOOR_MAP`, `READ_CEILINGS`), so no shared
  file changes for them.
- The door process's tool table is on main. The plan predates it, and the brief adds the two tools.
- `shared/api.ts` is untouched. `server.ts` grows by seven lines (the plan estimated eight).

## Departures, by slug

- `board-door-in-its-own-routes-file`: as the inbox's, the history's and the sequence's.
- `history-and-board-reads-attributed-not-proven` (call 1590): both rows are reads, not writes, so neither runs a fence. This
  departs from the inbox plan's question 18 (F8: "board, history and the sequence's cursor … fence their reads too") and its index
  change 4 ("each fences its read, with a fenced door process row, `read` included for the readers' tool"). Proven reader reads are
  ticket `readable-doors-proven-reads` (the proposal's way B: the read tool carries the fence and the gate admits a reader-scope
  witness on a readable read).
- `board-unmeasured-reasons-are-closed-words`: a part's reason is a closed word, never a reader's error text.
- `board-stalls-are-the-stuck-count-and-the-notice-counts`: Step 1, above.
- `board-live-word-and-shell-side-by-side`, `board-home-project-unmeasured` and `board-sandbox-unmeasured-no-reader`: Step 1,
  above.
- `board-programmes-carry-lifecycle`: the programmes read is composed with its lifecycle fields, through the same function
  `GET /api/programmes` uses, with the same 24-hour window as that route's default.
- `board-wire-imports-shared-types`: the plan says the wire "imports nothing". It imports types from its `shared/` siblings
  (programme waves, item words, lifecycle, portfolio, readiness, isolation, ladder), as other L0 files do, and no value.
- `board-ports-built-in-its-routes-file`: `boardPortsOf` lives beside the door, not in the gatherer. The lifecycle composition is in
  an L4 routes file, so the L3 gatherer takes it injected. The project-walk cache is read when a board is gathered, because
  `buildServer` declares it after the doors are registered.
- `board-goals-carry-in-short-and-done-when`: a goals row carries "In short", the definition of done and the count of
  modifications, never a modification's text (C44).
- `board-items-open-titles-only`: open items only, each by id, kind, state, urgency and title.
- `board-timers-by-setter`: a programme's timers are its coordinator's, the bound coordinator else the current run's claimant. A
  session that coordinates two programmes counts in both.
- `read-tool-enum-stays-reader-marked`: `readableDoorRow` is exported and the read tool's call asks it. The enum still lists the
  rows marked reader (the read tool's rule is untouched), and the census holds every marked row readable.
- `history-tool-refuses-head-flags`: the history tool refuses an argument equal to one of the client's head flags.
- `board-latch-detail-not-carried` (fix round 1): a latch is carried by its cause, cap, raise time, known word and narrowing. Its
  `detail` is server prose that can name a subject (the invariant lane writes the invariant, its subject and its message), so it
  stays on the ladder's own session-gated read.
- `board-brakes-armed-kinds-later` (fix round 1): spec Table 5.2a's "armed kinds of answer" are W3's, as the plan's question 3
  says. Carried now: the operator's rung, the latched caps with their causes, the live conditions and the effective rung.
- `board-portfolio-later-wave-fields` (fix round 1): a portfolio row carries every W1 field of the view (rank and
  `rankUnreadable`, class, WIP, the oldest open wave's age and `oldestOpenUnmeasured`, closed waves, cycle and
  `cycleUnmeasured`, review rounds, the 28-day endings, the time waiting on the operator, `itemsUnmeasured`, `asksUnmeasured`, and
  what blocks). It leaves out the view's later-wave fields: the health word, the forecast's median and 85% dates, spend, the edge
  list and the critical path. `blocking.edges` is carried as a count, or null when the view did not count it.
- `board-work-no-last-move-time` (fix round 1): spec Table 5.2a lists a programme's time of last movement. The plan's work row
  is wave buckets, open items and stalls (question 18), so the board does not carry it; adding it later is additive.
- `board-projects-unmeasured-walk` (fix round 1, F1): `listProjects` returns its own walk flag (`walk`, additive), and the
  projects part reads `read-failed` when the walk was not measured, that is when the root could not be listed or a probe under it
  could not answer. The flag is the one that already decided caching; there is no second probe of the root. The projects route
  still folds it (its own ticket); its answer now carries `walk` as one more field, which no caller reads.

## Mutation rows

**The deciders' sets** (`server/test/sim/overlordBoardSets.ts`, registered in the mutation floors at 1 by the home B packet).
Before: no key for either function. After:

| Decider | Mutants | Killed |
|---|---|---|
| `composeBoard` | 54: the plan's four (C1a/C1b/C1c an unratified goal trusted, C2 a coordinator's ratification trusted, C3a/C3b a failed reader read as an empty or measured part), C3c–C3h, C4a–C4d, C5a–C5l, and fix round 1's 24: P1–P15 (each portfolio field: the two flags, each measure, what blocks, a later-wave field riding) and L1–L9 (each latch and condition field, a latch carrying its detail) | 54 |
| `timersByProgramme` | 6 (the plan's two: T1 the latest due time, T2 another coordinator's timer; T3 a timer's note in the row; T4, T6, T7) | 6 |

T3, "put a timer's note in the part", is on `timersByProgramme`, where the note arrives. One equivalent mutant (a null coordinator
counting rows) was dropped, because a setter is always a string.

**By hand** (each applied, the named suite run, the file restored byte for byte):

| Mutant | Suite | Before | After |
|---|---|---|---|
| the board gathered above the gate | `overlord-board-door` | 18 green | 8 red (every gate refusal, the per-programme read count, the ceiling) |
| `unfenced: true` removed from the board's runner call | `overlord-board-door` | 18 green | 12 red (every case past the gates) |
| the sequence route's line written for another door | `overlord-sequence-route` | 21 green | both ceiling cases red |
| the client's UTF-8 check back to UTF-8 to UTF-8 | `ccrc-api` | green | the two new forms' cases red |
| `name_ok` unanchored | `ccrc-api` | green | both trailing-newline corpus cases red |
| the runner spreads `extra` again | `overlord-read-runner` | 19 green | the extra-by-name case red |

**The composition root** (`overlord-read-doors-wiring.test.ts`, each `server.ts` binding mutated, the file restored and compared):

| Mutant | Red |
|---|---|
| the restore binding a constant measured 0 | the sequence page and live-handle cases |
| the sequence reader answering unmeasured | the page, live-handle and gate cases |
| the board's walk cache a fresh `ProjectWalkCache` | the walk-count and shared-cache cases |
| `/api/overlord/board` out of `MASKED_GET_ROUTES` | the masking case |
| the board's store left out | the own-store and masking cases |

**The census's synthetic mutants** (`door-tools.test.ts`, each red in its named case): a fenced row marked reader (the inbox); a
reader row whose door row is a write (the board fenced again); a write-class row marked reader (acknowledge); a readable door left
unmarked (history); a marked row fenced (history). The gate census (`overlord-gate-census.test.ts`) adds the route-side mutant: a
board read that skips the gate call is found, as the history read's control already finds it.

## The fast run's two reds

The pull request's first fast run (head 510db1df5d) was red in two server shards, each on a guard over the whole tree, and each a
real defect of the gatherer, fixed before the wave-done:

- **The run cap's one reader** (`run-cap-derived.test.ts`, "no other module of the server reads the mode or decides the cap now").
  The gatherer read `CoordStore.caps()`, the STORED number, and named it the board's `maxConcurrentWorkers`. Since the cap became
  automatic, the cap in force is derived from the host, and the stored number is only its fallback. The board now takes a
  `capNow` port, built in `boardPortsOf` as `dispatch.ts#capNow` over the store and the watcher's `hostMachine()`, exactly as the
  caps view composes it; `caps` left `BoardStore`. The wire's field keeps its name and now carries the cap in force.
- **The plain listing ratchet** (`fleetio-contract.test.ts`, D-5969: at most 39 plain `io.readdir(` sites). The switches part read
  the registry directory through the collapsing `readdir`, so a listing that failed became a row of `unmeasurable` switches. It
  reads `readdirMeasured` now, and a failed listing is the part's `read-failed` (the rule that a failed reader is that part's
  unmeasured, never a filled part).

Red first (`overlord-board.test.ts`, the describe "the capacity part reads the cap in force"), against the code at 510db1df5d:

| Case | Before | After |
|---|---|---|
| `boardPortsOf` answers the derived cap for an automatic mode, the stored one for an override, no reader without a store | red (no `capNow`) | green |
| the gatherer's capacity is `capNow`'s cap, once, and the stored number is never asked; a throwing reader is `threw` | red | green |
| a registry listing that cannot be read is the switches part's `read-failed` | red (a measured row of `unmeasurable`) | green |

Both guards are green on the fix, and so are the board's suites, the wiring suite, the rings and the server typecheck.

## Fix round 1 (review 4010, call 1641)

**F1, the projects walk.** `listProjects` answers its walk flag, and the projects part reads `read-failed` on an unmeasured walk
(`board-projects-unmeasured-walk`). Red first: two cases (the lister's flag over a readable root, from a kept walk and over an
unreadable root; the part's `read-failed` with the root listed once), red without the lister's flag, green with it.

**F2, the brakes.** The ladder part carries the standing latches and the live conditions through `ladderWire`, the ladder read's
own projection (`board-latch-detail-not-carried`, `board-brakes-armed-kinds-later`). **F3, the portfolio.** A row carries the
view's W1 fields, with `rankUnreadable` and `oldestOpenUnmeasured` beside the nulls they qualify
(`board-portfolio-later-wave-fields`). The composer fixture now holds two programmes with every field distinct: prog-b's stored rank
cannot be read and its two started waves have no known age. Red first against the composer at 7c01981c8e: six composer cases red
(the full row, the two nulls kept apart, the latches and conditions, the field census, the readers' own answers, the untrusted
blocking title); a seventh, that no later-wave field rides, holds on both.

**Advisories.** A1: the read runner's header says how a reader reaches the unfenced rows and that its read is attributed; its fifth
sentence says "served"; the gate census says nine. The gate's lane list and the gate suite's title name the board, sent to their holder
as a packet (claim 7410) and applied as sent on its yes. A2: the comment on `readableDoorRow` says only the call asks it; the census reads the read row's enum off
the shipped table against `READABLE_DOORS`, with a mutant that widens the enum (red when the check is removed). A3: the size
fixture's comment says what catches a leaked body or note. Residues: the coordinator test title, the work part's slug, and the
Known limits sentence on the unfenced history read.

## What a merge arms

- A new read door, `GET /api/overlord/board`, behind the box token and the Overlord gate. In production it answers
  `capability-missing` until the `overlord-v1` piece advertises the word. It writes nothing but one read-ledger line per read past
  the gates.
- The history door now serves a designated caller with no act key. Like the board, it answers `capability-missing` until
  `overlord-v1`.
- The door process advertises two more tools, and a reader can call both through the read tool.
- The client gains a verb, and its history grammar refuses three more malformed inputs.
- No migration, no ccd verb, no exec grant, no history gate-code file, no CI workflow file, and `shared/api.ts` is untouched.

## Known limits

- A read of a readable door (board, history) is attributed to the Overlord, not proven its own. A caller that presents the
  Overlord's identity with the box token is served up to the ceiling, and so can spend it. Each such read writes a ledger line as
  the Overlord's.
- The ledger and the ceilings count attributed served reads.
- The answer mask catches a secret as a whole run. A secret glued inside a longer run (for example after a hyphen in a session id)
  passes the board unmasked, as it would any masked read. The door suite pins a secret held as a whole token.
- `shell`, a programme's home project and the sandbox check read `unmeasured`, `no-reader`, until a reader exists.
- A session that coordinates two programmes counts its timers in both.
- With the history read unfenced, whoever can present the Overlord's identity with the box token is served what the history door
  serves, for every project, up to the ceiling. That is the text the Overlord itself reads; what changed is who can obtain it.
- A 50-programme board measures 103,424 bytes of JSON (the size case bounds it at 120,000; it measured 81,988 under a bound of
  95,000 before fix round 1 added the portfolio's measures and the ladder's latches and conditions).

## The gate's counts

The coordinator read the rows by diff before they were committed (call 1606). First measured on main `87c64a957a` plus this work.
Re-derived in fix round 1 on the merged tree (merge commit `1d9a96358d`, main `6f3f88143e`): main brought no route, gate or client
change, the censuses that pin these counts are green there, and every figure below stands. Neither #3455 nor #3460 had landed.

| Count | Main | This branch |
|---|---|---|
| Routes scanned | 334 | 335 |
| HTTP routes | 331 | 332 |
| Gated | 213 | 213 |
| Exempt | 118 | 119 (the board) |
| Box-token machine lanes | 104 | 105 |
| Box-token lanes in all | 107 | 108 |
| Route files | 32 | 33 |
| Client rows | 103 | 104 |

Others move the same lines, so the second lander re-derives on its merged tree and never adds: renewal readings H (#3455, two
gated doors), the Desktop polish box frames read (one exempt lane and a routes file of its own, and one client row), and the Docs
reader's wave 52 (#3460, five gated doors).

## Seam files and their holders

Each held file took the exact diff as a packet first (size and sha256), and was applied as sent on its holder's yes: the closed client
and its two suites (claim 7412); `server.ts` and the mutation floors pair (claim 7353); the read runner and its suite (claim 7354, the
type import on a line of its own at the holder's ask); the session gate's file, its suite and the mask suite (claim 7410); the
box-token census (claim 7373). The drafts were measured in this tree and restored to main's text before each packet went.

## Design rule

The board is a server read behind the closed client, served to any harness through the door process's typed tools; nothing added
depends on one harness's hooks, tools or file layout. The door process itself is an MCP server that Claude Code starts, as it was
before this piece.
