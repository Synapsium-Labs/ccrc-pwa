# Ring drain, server half, Task RS9: the fleet assembly's live-state read through a port — task design note (D-7512)

**What this is.** The design note that the ring-drain plan (`docs/superpowers/plans/2026-10-29-consolidation-ring-exemption-drain-server.md`, Task RS9, §Gates, §Global constraints, §Review focus) requires before any RS9 code. RS9 is DESIGN NOTE BEFORE BUILD. This file resolves the task's three open problems, names the route and gives the build in the plan's shape. It is docs only. It builds nothing and edits no plan. D-7512 is the plan's number for this task, and this note cites it without redefining it. It needs no new D-number: the plan defines D-7512 as "by the route its design note records", and §1.5 lists the two places where this note departs from the plan sketch.

**Base.** Every count here was measured on `origin/main` `b99070116`. #1923 (the conflict radar's console half, `85d61aa85`) and RS1 (#1930) are both on that base. The plan's counts were taken before #1923 (14 parameters, 11 optional ones, 119 call sites, the tail `panePids);`), so this note measures them again (§1.1). Rings come from `server/test/rings/ring.ts#serverRing`. Calls were counted with `server/test/scan/parse.ts#parseFile` over every `server/src` and `server/test` file: a call expression whose rightmost name is `assembleFleet`, so comments and planted strings are not counted. Open PRs come from `gh pr list --state open --json number,files` on 2026-10-30 (22 open), and `gh pr diff` was read for each PR that holds a file named here. Code is cited by file and symbol, never by line.

**Verdict.** **Route (a1).** `assembleFleet` takes a **required** live-state reader as its fourth parameter, right after `tmux`. Every caller passes `livestate.ts#liveStateReaderOver(io)`. The two pure deciders move inward to a new L1 file, `server/src/liveVerdicts.ts`. **RS8 does not fold in.** It builds as the plan writes it (D-7511), once the coordinator records this route.

---

## 1. Open problem 1: the route

### 1.1 What `main` holds now (re-measured)

| Measure | Plan (pre-#1923) | `b99070116` |
|---|---|---|
| `assembleFleet` parameters | 14 | **15**: `io`, `cfg`, `tmux`, `now = …`, `pendingDialogs?`, `statuslines?`, `taskProgress?`, `prStates?`, `hookStates?`, `records?`, `coord?`, `usageReadings?`, `headBranches?`, `panePids?`, `landings?` |
| optional parameters | 11 | **12** (`now` through `landings`; #1923 added `landings`) |
| index of `records` | 9 | 9 (unchanged: `landings` is appended) |
| production calls | 6 | **6** (below) |
| test calls | 113 in 12 files | **108 in 11 files** (below) |
| all call expressions | 119 | **114** |
| `stall-sweep.test.ts` tail pin | `'this.usage, this.currentHeadBranches(), panePids);'` | **`'this.usage, this.currentHeadBranches(), panePids, this.landings);'`** |

**Why there are 108 test calls and not 113.** The plan's 113 counted text matches of `assembleFleet(`. Six of them are not calls. Five are in `registry-refused-census.test.ts`: the planted sample string and comment in its splitter control row, the two `matchAll` regexes, and the census label string. One is a comment in `pr-sweep.test.ts`. Neither file calls `assembleFleet`, so the build edits neither file's calls. The census is still edited, for its index (§1.3).

**The six production calls, argument by argument** (`|` separates the top-level arguments):

| File | Where | Arity | Arguments |
|---|---|---|---|
| `turnverdict.ts` | `liveRowFor` | 10 | `d.io \| d.cfg \| d.tmux \| undefined \| d.pendingDialogs() \| d.statuslines() \| undefined \| undefined \| new Map(…) \| [rec]` |
| `watch.ts` | `FleetWatcher.tick` | 15 | `this.deps.io \| this.deps.cfg \| this.deps.tmux \| undefined \| pending \| this.statuslines \| this.taskProgress \| this.prStates \| this.hookStates \| records \| this.deps.coord \| this.usage \| this.currentHeadBranches() \| panePids \| this.landings` |
| `server.ts` | `buildServer`, `GET /api/fleet` | 15 | `deps.io \| deps.cfg \| deps.tmux \| undefined \| watcher?.currentPending() \| … \| reg.records \| deps.coord \| watcher?.currentUsage() \| watcher?.currentHeadBranches() \| undefined \| watcher?.currentLandings()` |
| `server.ts` | `buildServer`, the ws cold frame | 15 | the same 15 as the row above |
| `coord/routes.ts` | `GET /api/peers` | 12 | `deps.io \| deps.cfg \| deps.tmux \| undefined ×6 \| reg.records \| deps.coord \| undefined` |
| `coord/routes.ts` | the claims conflict | 12 | `deps.io \| deps.cfg \| deps.tmux \| undefined ×6 \| reg.listed ? reg.records : [] \| deps.coord \| undefined` |

Every production call passes `io, cfg, tmux` and then its optional arguments by position. No call uses a spread. No file names `typeof assembleFleet`, `Parameters<typeof assembleFleet>`, `assembleFleet.call`, `assembleFleet.bind` or `assembleFleet.length`, and none passes `assembleFleet` as a value; this was measured over `server/src` and `server/test`. `pwa/` and `shared/` mention it only in prose.

**The test calls, file by file:** `fleet.test.ts` 77, `fleet-wire-route.test.ts` 10, `bucket.test.ts` 9, `fleet-lifecycle.test.ts` 4, `w7-presence-parity.test.ts` 2, and one each in `session-ladders-characterization`, `run-wire`, `questions-reads-pin`, `fleet-released`, `child-reclaim-mark` and `ccd-land-lineage-accept`. Their first arguments are `localIO` 93 times, `io` 10, `deps.io` 4 (and 1 more in production), `blind` 3 and `w.io` 1. Their arities run from 3 to 15: 14 calls pass only `io, cfg, tmux`, 38 pass four arguments, and the rest pass more.

**Every other reader of `assembleFleet`'s argument positions or call text,** found by searching `server/test` for the call lines' own text and for `assembleFleet` in census rows:
- `registry-refused-census.test.ts`, the row "the six production assembleFleet calls each pass the rows they read, never undefined": it reads `callArgs(…)[9]`, the `records` argument, at every production call. Its control row, "the argument splitter sees nesting, strings and a commented call", reads `args[9]` of a fixed planted string and checks the splitter, not `assembleFleet`.
- `stall-sweep.test.ts`, the row "rides tick(): …": its `toContain` over `watch.ts` reads the **tail** of `tick`'s call.
- `single-definition/core-vocab.test.ts` reads `assembleFleet`'s **body** by symbol (the radar's `freshWithin(landing.at, RADAR_PROBE_FRESH_S,` call). The read-line edit does not touch it.
- Nothing else. In particular, no test reads the head of `tick`'s call (`this.deps.tmux, undefined, pending`), and none reads any other production call's text.

### 1.2 The rings (`serverRing`, measured)

| File | Ring today | Why |
|---|---|---|
| `fleet.ts` | L1 | no outer-ring fact |
| `livestate.ts` | L3 | `readLiveStateMeasured`'s torn-body wait, `setTimeout(resolve, LIVE_TORN_RETRY_MS)`, is a deadline timer |
| `sessionReading.ts` | L1 | (the deciders import `turnSays` and `turnWordOf` from it) |
| `turnverdict.ts` | L3 | declares L3 in its header |
| `watch.ts`, `server.ts`, `coord/routes.ts` | L4 | a scheduler; fastify; fastify |
| `remote/io.ts` | L1 | no outer-ring fact (relevant to route (b)) |
| **scratch:** the two deciders with their three import lines, parsed as `server/src/liveVerdicts.ts` | **L1** | no outer-ring fact |
| **scratch:** `livestate.ts` without the deciders, re-exporting them from `./liveVerdicts.js` | L3 | the torn-body wait stays (expected; it is not the route) |

Three names cross the pair `fleet.ts -> livestate.ts` at runtime: `readLiveStateMeasured`, `liveSessionStatus` and `liveStatusCoversDelegation`. `LiveStateRead` crosses as a type. The pair drains only when **all three** runtime names stop crossing.

### 1.3 The three routes, measured

**(a) A required reader port on `assembleFleet`.** `fleet.ts` declares the port type. `assembleFleet` takes it as a required parameter. The two deciders move inward. The read goes through what the function is handed.

- **(a1) A required parameter right after `tmux`: `assembleFleet(io, cfg, tmux, readLive, now?, …)`.** A required parameter cannot trail the 12 optional ones (TS1016). An optional one whose default names `readLiveStateMeasured` keeps the edge (Review focus 2). So the reader goes fourth.
  - **Every call is edited by inserting one argument and changing nothing else.** All 114 calls are measured above. Each later argument shifts one place and keeps its type.
  - **`tsc` catches every call the edit misses**, on both configs:
    - the 14 three-argument calls fail with TS2554 (at least 4 arguments expected);
    - a missed call whose fourth argument is `undefined` fails with TS2345 (`strict` is on in `server/tsconfig.json`, and `test/tsconfig.tests.json` extends it);
    - so does a missed call whose fourth argument is a number (`now`).
  - **`registry-refused-census.test.ts`: one literal edit.** `callArgs(…)[9]` becomes `callArgs(…)[10]` in the census row only. The six expected `records` expressions, the row's other assertions and the splitter control row keep their bytes.
  - **`stall-sweep.test.ts`: no edit.** The reader goes in after `this.deps.tmux,`, so the tail `this.usage, this.currentHeadBranches(), panePids, this.landings);` is unchanged and the row stays green as it is.
  - **Files:** `fleet.ts`, `livestate.ts`, the new `liveVerdicts.ts`, the four production files, the 11 test files with calls, the census, `ask-digest.test.ts` and `advance-switches.test.ts` (§4.5), `livestate.test.ts` (one new row, §4), the new characterization pin, the 08-10 spec's C1 cell and the two ring data files. That is **25 files**.
- **(a2) An options object for everything after `tmux`, with the reader required in it.** It reads better at a call site, but it costs more:
  - It rewrites every one of the 114 calls' tails, not one inserted argument. Each `undefined` placeholder becomes an absent key, and 108 test calls change shape.
  - The census can no longer split positions. `callArgs(…)[9]` must become a reader of the `records` property of an object-literal argument. That is a new reader in a census file, not a one-character re-point.
  - The `stall-sweep.test.ts` tail pin is a re-pointed pin, because the call line no longer ends `panePids, this.landings);`.
  - Rule 6 is the same as (a1), since both edit the same call lines, but each hunk is wider.
  - **Not chosen.** The readability gain is real but belongs to a separate task. It has nothing to do with the ring, and this task's diff is already 114 call sites.

**(b) The torn-body wait becomes a port member, and `livestate.ts` becomes L1.**
- **What it takes:**
  - `FleetIO` gains a member that is not I/O, a `settle(ms)` clock.
  - `io.ts#localIO` and `remote/io.ts#createIo` implement it.
  - `remote/io.ts` turns L1 → L3 (its one importer, `remote/client.ts`, is L4, so no new pair).
  - `fleetio-contract.test.ts` requires a `Failure contract:` line on the new member.
  - Full `FleetIO` object-literal doubles that spread nothing would have to implement it: about 9 doubles in 7 test files, by a scan of `: FleetIO = {` bodies with no spread. `as FleetIO` casts and `...localIO` spreads need nothing.
- **What it gives:**
  - zero `assembleFleet` call-site edits;
  - both livestate pairs drain in one commit, so RS8 folds in;
  - no open PR holds `io.ts`, `remote/io.ts` or `fleetio-contract.test.ts`.
- **Files:** about 13.
- **Not chosen,** although it is the cheaper diff:
  - It puts a server-local clock on the box I/O port. In remote mode `settle` would run on the server, not the box, so the member would claim an I/O shape it does not have.
  - Every future `FleetIO` adapter must carry a member that has nothing to do with reading the box.
  - It turns an L1 adapter into L3 for a timer.
  - It moves the impurity sideways instead of naming it. (a1) leaves the impure retry where it is and gives the inner file a port.
- **When it would be right:** if (a1)'s band-1 threading could not be landed (§3), the coordinator could take it as the fallback. It changes no behaviour (the wait stays 50 ms on both adapters).

**(c) `setImmediate` instead of the 50 ms wait.** This would re-read a torn file with no wait, which changes D-5234's behaviour. No ruling exists for it, and the plan has no behaviour commit. **Rejected.**

### 1.4 The (a1) shape, exactly

- **`fleet.ts`**
  - It declares `export type LiveStateMeasuredReader = (configDir: string, pid: number) => Promise<LiveStateRead>;`.
  - It reads `LiveStateRead` through `import type { LiveStateRead } from './livestate.js'`, which is a type-only edge and so no edge in the ring scan.
  - `assembleFleet(io, cfg, tmux, readLive: LiveStateMeasuredReader, now = …, …)`. The live block's read becomes `const read = await readLive(cfgDir, pid);`. Nothing else in the block changes: the `pid === null` arm, the `cfgDir` guard, both `false` arms and every assignment keep their bytes.
  - The D-115 comment above the read keeps its argument. Its first sentence names the measured read by symbol (`livestate.ts#readLiveStateMeasured`, reached through `readLive`), because the line under it no longer spells the function.
  - `io` stays the first parameter, because `assembleFleet` reads the registry, hook state and limits through it.
- **`livestate.ts`** gains `export function liveStateReaderOver(io: FleetIO): (configDir: string, pid: number) => Promise<LiveStateRead>`, returning `(configDir, pid) => readLiveStateMeasured(io, configDir, pid)`. It is L3, which is the ring it already has. It names its return type structurally and imports nothing from `fleet.ts`.
- **Each production call** inserts `liveStateReaderOver(<the call's own first argument, verbatim>)` after its third argument:
  - `turnverdict.ts`: `d.io`, adding the name to its existing `./livestate.js` import line;
  - `watch.ts`: `this.deps.io`, the same way;
  - `coord/routes.ts`: `deps.io` at both calls, the same way;
  - `server.ts`: `deps.io` at both calls, through a **new** import line `import { liveStateReaderOver } from './livestate.js';` placed directly after the `./fleet.js` import line. `server.ts` imports nothing from `livestate.js` today; if RS8 has landed first, the name is added to RS8's import line instead (§3). Each of these edges is L3 → L3 or L4 → L3, inward or level.
- **Each test call** follows the same rule: insert `liveStateReaderOver(<first argument verbatim>)` after the third argument, and add or extend one `../src/livestate.js` import line per file. The verbatim rule is what keeps each row's meaning. `fleet.test.ts`'s unreadable row, for example, passes `degradedReadIO(…)` as `io`, so its reader reads through the same degraded io.
- **The deciders.** `liveSessionStatus` and `liveStatusCoversDelegation` move verbatim, with their docstrings, to the new `server/src/liveVerdicts.ts` (L1, context C1). Its imports are `import type { SessionStatus } from '../../shared/api.js'`, `turnSays` and `turnWordOf` from `./sessionReading.js` (L1), and the three `shared/claudeVersion.js` names (L0). `livestate.ts` re-exports both with `export { liveSessionStatus, liveStatusCoversDelegation } from './liveVerdicts.js';`. That is the same binding, so `sessionws.ts` (L4) and the four test importers (`livestate`, `tasks`, `turn-words-characterization`, `measure-working-state`) keep their import lines unedited. `fleet.ts` imports the deciders from `./liveVerdicts.js` (L1 → L1).
- **The context table.** The 08-10 spec's C1 row lists `livestate.ts` as a file cell and has no directory row for `server/src/`. So the C1 row gains a `liveVerdicts.ts` cell right after `livestate.ts`, in the commit that creates the file (`rings/totality.test.ts`).

### 1.5 Departures from the plan sketch

1. **The port type is named `LiveStateMeasuredReader`, not `LiveStateReader`.** RS8 declares `commands.ts#LiveStateReader` with the folded answer, `Promise<LiveState | null>`. If both files used one name for two different function types, a reader would mistake one for the other. The name says what the reader returns: the measured read.
2. **The counts are 15 parameters, 12 optional ones, 114 calls (6 + 108) and the tail `…, panePids, this.landings);`** (§1.1), not the plan's pre-#1923 figures.

Both fall inside D-7512's subject ("by the route its design note records"), so neither needs a new number.

### 1.6 RS8

RS8 **does not fold into RS9** under (a1). `livestate.ts` stays L3, so `commands.ts -> livestate.ts` remains a separate pair, which RS8 drains with its own port (D-7511). RS8's gate ("RS9's design note ruled") opens when the coordinator records this route.

## 2. Open problem 2: the characterization before any move

`assembleFleet`'s live fields, as the wire carries them, are `status`, `name`, `statusUpdatedAt`, `version` and `statusUnmeasured`. Three more are reached through locals: `liveWaiting` is visible as `dialogPending`, `liveWaitingFor` as `askSummary` (through `hookAskSummary`), and `liveCoversWorkflows` as whether a statusline Workflow row promotes `idle` to `busy`. The five conditions of the live file are absent, unreadable, torn once (then whole), torn twice, and well formed.

**What the tree already holds, measured.** "covered" means an `assembleFleet` row asserts the field under that condition. "—" means no row does.

| Field (as seen on the row) | absent | unreadable | torn once | torn twice | well formed |
|---|---|---|---|---|---|
| `status` | covered: `fleet.test.ts`, "… and an ABSENT live file still paints idle" | covered: "paints an unreadable live file busy, …" | — | — | covered: "joins registry, live state, limits, and tmux aliveness" (`busy`); the workflow block (`idle`) |
| `name` | — | covered (null) | — | — | covered: the joins row and the three "derived session handles" rows |
| `statusUpdatedAt` | — | covered (null) | — | — | — (no row asserts the carried value) |
| `version` | — | covered (null) | — | — | — (it is only seen through `liveCoversWorkflows` and `background`) |
| `statusUnmeasured` | — | — (asserted only for the failed-`panePid` arm, "D-5234: an alive pane whose panePid read fails …") | — | — | — |
| `dialogPending` via `liveWaiting` | — | covered (false) | — | — | covered: `bucket.test.ts`, the D-76 `waiting` rows |
| `askSummary` via `liveWaitingFor` | — | — | — | — | covered: `bucket.test.ts`, "sandbox request", and the null when no reason is given |
| Workflow promotion via `liveCoversWorkflows` | covered: "the row still speaks when there is no live file at all" | — | — | — | covered: "a 2.1.277+ live file's idle stands over the row" and the version rows |

`measure-working-state.test.ts` holds **none** of these through `assembleFleet`. It pins the measurement script's tuples against the server's constants (`COVERS_DELEGATION_FROM` against `liveStatusCoversDelegation`) and the script's `shown_bucket` against `sessionBucket`. Its "torn live file" case is the Python script's view. `livestate.test.ts` holds the reader's five conditions directly ("D-5234: a truncated body read twice is unmeasured", "… a torn body then a whole one is ok", read counts included), but not through `assembleFleet`.

**Missing, and added by Step 1:** the torn-once and torn-twice columns entirely; `statusUnmeasured` under unreadable, torn twice, absent and well formed; the absent column's null fields; the well-formed `statusUpdatedAt` and `version` values; the unreadable `askSummary` and Workflow promotion; and the live file's read count per condition (1, 1, 2, 2, 1).

**The pin: `server/test/fleet-live-fields-pin.test.ts`** (a new file, so the hot `fleet.test.ts` gains no rows).
- **Fixture.** One registry row in a temp home (`seedRoster`, `seedSession`) and an alive pane, `pid` 4242, through a fake `Runner`. The `FleetIO` double answers `<configDir>/sessions/4242.json` from a body list in order (the last body repeating) and counts the reads. It has the shape of `livestate.test.ts`'s `sequencedLiveIO`, written locally. Its unreadable case uses `ioDoubles.ts#degradedReadIO`.
- **One local factory, `assemble(io, statuslines?)`,** calls `assembleFleet(io, cfg, tmux, undefined, undefined, statuslines)` on `main`. It is the one line the port commit edits, under the plan's factory exception: it gains `liveStateReaderOver(io)` after `tmux`, and every row, title and assertion keeps its bytes.
- **Rows.** There is one row per condition, asserting the row's projection `{ status, name, statusUpdatedAt, version, statusUnmeasured, dialogPending, askSummary }` with `toEqual`, plus the read count.

| Condition | Body | Projection asserted | Reads |
|---|---|---|---|
| absent | none | `idle`, null, null, null, `false`, `false`, null | 1 |
| unreadable | `degradedReadIO` on that path | `busy`, null, null, null, `true`, `false`, null | 1 |
| torn once | `'{"pid":4242,"sessionId":"3'`, then the whole `waiting` body | as well formed (`waiting`) | 2 |
| torn twice | the torn body, twice | `busy`, null, null, null, `true`, `false`, null | 2 |
| well formed (`waiting`) | `name` chosen, `status: 'waiting'`, `waitingFor: 'a reason'`, `statusUpdatedAt`, `version: '2.1.283'` | `busy`, the name, the stamp, `'2.1.283'`, `false`, `true`, `'a reason'` | 1 |

- **The Workflow-promotion probe.** A second table runs the same five conditions with an `idle` body and a statusline `workflowActive: true`. The expected statuses are: absent `busy`, unreadable `busy`, torn once `idle`, torn twice `busy`, well formed `idle` (2.1.283 counts the workflow) and well formed at `2.1.276` `busy`.
- **Green on `main`.** Step 1 runs the pin on `main` before any other commit. A value above that reds on `main` is not a defect to fix here: the build stops and reports it. The table is the expected behaviour read from `fleet.ts`'s live block and `readLiveStateMeasured`, and a measurement that disagrees with it outranks this note.

## 3. Open problem 3: rule 6 for every call site under (a1)

Re-measured on 2026-10-30. Each open PR's hunks were read from its merge-base with `origin/main` and compared, with three lines of context, against the lines (a1) edits: each file's `./livestate.js` import line, each `assembleFleet` call's first line (and, for `turnverdict.ts`, its second), and `server.ts`'s `./fleet.js` import line, after which the new import goes.

| PR | Files it holds that RS9 edits | Its hunks there | Verdict |
|---|---|---|---|
| #1872 (idle coordinators roll) | `turnverdict.ts`, `coord/routes.ts`, `watch.ts`, the 08-10 spec | `turnverdict.ts`: a new `processStartedAtFor` after `turnVerdictFor`'s docstring. `coord/routes.ts`: an import-group line and a new route in `registerCoordRoutes`. `watch.ts`: the `./sleep.js` type-import group, two field lines, a new method and the roll lane. Spec: the C4 row. | line-disjoint. The C1 cell RS9 adds is three rows above #1872's C4 row, with two unchanged rows between them. |
| #1713 (dialog sweep eight at a time) | `watch.ts` (and `commands.ts`, which RS9 does not edit) | a `./bounded.js` import after `./fleetReadModel.js`, the `CollectSlot` type and the dialog-sweep methods | line-disjoint |
| #1614 (the server's delegation frame, held) | `watch.ts`, `server.ts` | `watch.ts`: the `import type {` group, a `./coord/gitref.js` neighbour, a `FleetWatcher` method and `DelegationLane`. `server.ts`: an import group far below `./fleet.js`, and `buildServer`'s delegation routes. | line-disjoint |
| #1934 (RS6, the journal split) | `watch.ts`, the two ring data files, `advance-switches.test.ts` | `watch.ts`: one new import line after `./pressureLane.js`, and `DelegationLane`'s `open` call. `outward-edges.data.ts`: it deletes the two `delegation-journal.ts` keys, the two lines directly **above** `fleet.ts`'s key. `exemption-age.data.ts`: the one stamp line. `advance-switches.test.ts`: the journal's `CEILING` row, far from `livestate.ts`'s. | `watch.ts` line-disjoint. Ring data: **textually adjacent** (the second to land rebases and keeps both deletions) and the **same stamp line** (recounted on rebase). |
| #1933 (RS4), #1932 (RS7), #1931 (RS2) | the ring data files; #1933 also the spec's K row | each deletes its own keys and rewrites the stamp. #1932's `push.ts` key is the line directly **below** `fleet.ts`'s key. | the stamp line and adjacent keys: rebase and recount. The K row is line-disjoint from C1. |

No open PR holds `fleet.ts`, `livestate.ts`, `server/src/liveVerdicts.ts`, any of the 11 test files with calls, `registry-refused-census.test.ts`, `stall-sweep.test.ts`, `single-definition/ask-digest.test.ts`, `livestate.test.ts`, `rings/totality.test.ts` or `ioDoubles.ts`.

**The order.**
1. **`watch.ts`: #1934 first.** Only one `watch.ts` series may be in the queue at a time (spec §5.1 rule 6). RS9's build may be written in parallel, but it is enqueued only after #1934 has merged, and it rebases onto #1934 first. The two `watch.ts` edits are line-disjoint, so the rebase is expected to be clean. #1872, #1713 and #1614 are not series of this wave, and all three are measured line-disjoint.
2. **`server.ts`: RS8 first, preferably.** RS8 adds `import { readLiveState } from './livestate.js';` and RS9 adds `liveStateReaderOver`. If RS8 has landed, RS9 extends that line to `import { liveStateReaderOver, readLiveState } from './livestate.js';`. If RS9 lands first, RS8 extends RS9's line instead. Either way the second to land rebases; two import lines from one module are never left side by side. RS8 is the smaller task and does not touch `watch.ts`, so it can land while #1934 is still in the queue.
3. **The ring data files:** see the table above. The plan's §Hot files rule applies: the stamp's `size` is recounted on every rebase, and its `since` is the drain commit's day.

**The build's Step 0** runs `gh pr list --state open --json number,files` and `gh pr diff` again for every PR on the files above, and stops on any new hunk within three lines of an RS9 edit.

## 4. The build, in the plan's shape

**Lane:** server. **Branch:** `refactor/ring-drain-fleet-live`. **Band split** (spec §5.1 rule 7, the plan's RS9 routing):
- Step 1's characterization is **band 2**: it adds pins only, and the orchestrator reviews the diff.
- Steps 2, 2b, 3, 4 and 6, and Step 5's signature, production calls and census index, are **band 3, native**. The deciders move here, the signature changes, and the census is re-pointed.
- Step 5's 108 test-call insertions and their import lines are **band 1**, under the verbatim rule of §1.4.
- **Step 5 is built as two diffs and lands as one commit.** `tsc -p test/tsconfig.tests.json` cannot be green between the signature change and the threading. The band-1 diff is applied on top of the native one and the two are committed together, and the orchestrator reviews the combined diff.

- [ ] **Step 0: Re-ground.**
  - On the tree the build starts from, re-measure everything in §1.1: the parameter count, the optional count, the index of `records`, the six production calls' argument lists, the 108 test calls per file, the absence of spreads, `typeof`, `.call` and `.bind`, and the tail pin. Use `parseFile` for calls, never a text grep.
  - Re-measure the rings of §1.2, including a scratch `liveVerdicts.ts`.
  - Match the moved docstrings against `citations.test.ts`'s `CITATION`. On `b99070116` there is no hit.
  - List every `livestate.ts` and `fleet.ts` literal pin with `advance-switches.test.ts`'s counting rule. Measured: `livestate.ts` 2, both in `ask-digest.test.ts`'s row "the grammar's body is spelled once, and livestate parses no version of its own"; `fleet.ts` 3, none over the lines RS9 edits.
  - Ask whether this drain empties the set (§Global constraints, "The commit that takes the set to 0"). Run rule 6 (§3).
  - A count that differs from this note is reported before any commit.
- [ ] **Step 1: Characterization commit** (band 2), green on `main`: the new `fleet-live-fields-pin.test.ts` (§2).
- [ ] **Step 2: The decider move** (band 3).
  - Create `server/src/liveVerdicts.ts` with the two functions and their docstrings, verbatim. The one allowed edit to the moved text is in `liveSessionStatus`'s docstring: "(which reads `waitingFor`, kept above)" becomes "(which reads `livestate.ts#LiveState`'s `waitingFor`)", because "above" would name nothing in the new file.
  - `livestate.ts` loses the two definitions and the imports it no longer uses: the `SessionStatus` type, `turnSays`, `turnWordOf` and the three `shared/claudeVersion.js` names. It gains the re-export line, and its D-77 comment's "`liveSessionStatus` above" becomes "`liveVerdicts.ts#liveSessionStatus`".
  - Add the spec's C1 cell.
  - Re-point the ask-digest row under the named exception (§4.5). Lower `advance-switches.test.ts`'s `'server/src/livestate.ts'` row from 2 to 1.
  - No importer moves in this commit.
- [ ] **Step 2b: The identity row** (band 3). The pin gains one row: `liveVerdicts.liveSessionStatus` and `liveStatusCoversDelegation` are `toBe` the bindings `livestate.ts` exports. A second copy left in `livestate.ts` would pass every value row and fail this one.
- [ ] **Step 3: `fleet.ts` reads the deciders from their L1 home** (band 3). Its `./livestate.js` import line becomes two: `import { liveSessionStatus, liveStatusCoversDelegation } from './liveVerdicts.js';` and `import { readLiveStateMeasured } from './livestate.js';`. The set is unchanged: `readLiveStateMeasured` still crosses.
- [ ] **Step 4: The helper beside the old path** (band 3; strangler order).
  - Add `livestate.ts#liveStateReaderOver`.
  - `livestate.test.ts` gains one appended `describe`: for each of the five conditions, `liveStateReaderOver(io)(configDir, pid)` `toEqual`s `readLiveStateMeasured(io, configDir, pid)`, with the same read count.
  - No caller moves yet.
- [ ] **Step 5: The port commit** (band 3 + band 1, one commit; set unchanged).
  - `fleet.ts` gains `LiveStateMeasuredReader`, and `readLive` becomes the required fourth parameter. The live block reads through it, and the D-115 comment's first sentence is re-pointed (§1.4).
  - **`fleet.ts`'s runtime import of `readLiveStateMeasured` stays in this commit, unused,** so the edge and its exemption entry stay. The drain is Step 7's alone. Nothing in the tree reds an unused import: `tsconfig.json` sets no `noUnusedLocals`, and no test checks for one.
  - The six production calls and their import lines (§1.4).
  - The census's `[9]` becomes `[10]` (§4.5).
  - The pin's factory gains `liveStateReaderOver(io)`.
  - The 108 test calls and their 11 import lines (band 1).
- [ ] **Step 6: The seam row** (band 3), in its own commit after the port. The pin gains one row: the live fields come from the reader `assembleFleet` is handed, never from `io`.
  - With `io` holding no live file and a reader answering a well-formed `idle` state at `2.1.283`, the row reads that state.
  - With `io` holding a well-formed file and a reader answering `unmeasured`, the row is `busy` with `statusUnmeasured: true`.
- [ ] **Step 7: The drain commit** (band 3; −1).
  - `fleet.ts`'s `import { readLiveStateMeasured } from './livestate.js';` becomes `import type { LiveStateRead } from './livestate.js';`.
  - Delete the key `'server/src/fleet.ts -> server/src/livestate.ts'` from `server/test/rings/outward-edges.data.ts#OUTWARD_EDGE_EXEMPTIONS`.
  - Rewrite the `OUTWARD_EDGE_EXEMPTIONS` stamp in `exemption-age.data.ts`: `size` is the count at this commit, `since` is this commit's day, and the reason names D-7512 and the drained pair. The set is 11 on `b99070116`. The other drains open today (#1931, #1932, #1933, #1934) each lower it first if they land first.
  - If this commit empties the set, it also re-points `exemption-age.test.ts`'s CONTROL row as §Global constraints directs.
- [ ] **Step 8: Mutation table, RUN** (§4.4).
- [ ] **Step 9: Verify,** one file at a time from `server/` (`./node_modules/.bin/vitest run test/<file> --maxWorkers=2`):
  - the new pin and `fleet.test.ts`;
  - the other 10 call-site files: `fleet-wire-route`, `bucket`, `fleet-lifecycle`, `w7-presence-parity`, `session-ladders-characterization`, `run-wire`, `questions-reads-pin`, `fleet-released`, `child-reclaim-mark`, `ccd-land-lineage-accept`;
  - `livestate.test.ts`, `tasks.test.ts`, `turn-words-characterization.test.ts`, `measure-working-state.test.ts`, `sessionws.test.ts`;
  - the `liveRowFor` callers `stop-done-sweep.test.ts` and `deps-shed-watcher.test.ts`;
  - `registry-refused-census.test.ts`, `stall-sweep.test.ts`, `single-definition/ask-digest.test.ts`, `single-definition/core-vocab.test.ts`, `single-definition/advance-switches.test.ts`;
  - `rings/outward-edges.test.ts`, `rings/exemption-age.test.ts`, `rings/totality.test.ts`;
  - `citations.test.ts`, then `growth-check.test.ts` with `GROWTH_CHECK=1`, then `deviation-refs.test.ts`;
  - then `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json`, one at a time.

**Exit (GATE):**
- no key from `fleet.ts` in the set;
- `serverRing('server/src/liveVerdicts.ts')` is L1 at the tip, and the "exactly the exemptions" row's output is read, not only its green;
- every row of the characterization pin is unchanged from Step 1, so every live field of every fleet row is unchanged.

**Rollback:** `git revert` of the range. No wire, switch, agent or ccd change is involved.

### 4.4 The mutation table (RUN in Step 8)

| # | Mutant (applied at the tip, then reverted) | Must red |
|---|---|---|
| 1 | `fleet.ts` imports `readLiveStateMeasured` at runtime again (even unused) | `rings/outward-edges.test.ts`, "exactly the exemptions" (a fresh pair) |
| 2 | `fleet.ts`'s live block calls `readLiveStateMeasured(io, cfgDir, pid)` instead of `readLive` (with the import back) | mutant 1's row; the Step 6 seam row |
| 3 | `liveStateReaderOver` answers `{ ok: false, reason: 'no-state' }` where the read was `unmeasured` | the pin's unreadable and torn-twice rows (`statusUnmeasured`, `status`); `livestate.test.ts`'s Step 4 row |
| 4 | `liveStateReaderOver` passes a fixed pid instead of `pid` | the pin's well-formed and torn-once rows; `livestate.test.ts`'s Step 4 row |
| 5 | `liveVerdicts.ts#liveSessionStatus` returns `idle` for `waiting` | `livestate.test.ts`, "collapses Claude Codes `waiting` to busy"; `turn-words-characterization.test.ts`; the pin's `waiting` row |
| 6 | `livestate.ts` keeps its own copy of `liveSessionStatus` instead of the re-export | the Step 2b identity row |
| 7 | `liveVerdicts.ts` imports a runtime name from `./livestate.js` | "exactly the exemptions" (a fresh L1 → L3 pair) |
| 8 | the spec's C1 cell `liveVerdicts.ts` deleted | `rings/totality.test.ts` (an unmapped file) |
| 9 | `liveVerdicts.ts` parses the version itself and drops its `shared/claudeVersion.js` import | the re-pointed ask-digest row |
| 10 | the census reads `callArgs(…)[9]` again | `registry-refused-census.test.ts`, "the six production assembleFleet calls …" (index 9 is now `hookStates`) |
| 11 | `watch.ts`'s `tick` passes `undefined` for `records` | the same census row |
| 12 | the stamp's `size` left at the base count | `rings/exemption-age.test.ts` (the stamp against the measured set) |
| 13 | `assembleFleet`'s `readLive` made optional with a default of `liveStateReaderOver(io)` | mutant 1's row (the default needs the runtime import) |

### 4.5 Every pin the work turns red, and its re-point (the named exception)

1. **`registry-refused-census.test.ts`**, the row "the six production assembleFleet calls each pass the rows they read, never undefined", in **Step 5**. `callArgs(text, …)[9]` becomes `[10]`. Nothing else in the block changes: the six expected `records` expressions, the `undefined` and `<absent>` check, and the control row "the argument splitter sees nesting, strings and a commented call", whose `args[9]` reads a fixed planted string.
2. **`single-definition/ask-digest.test.ts`**, the row "the grammar's body is spelled once, and livestate parses no version of its own", in **Step 2**. Its `expect(live).toMatch(/from '\.\.\/\.\.\/shared\/claudeVersion\.js'/)` reds once the floor's one reader moves.
   - That assertion re-points to the decider's home through `scan/symbols.ts#parsedFile('server/src/liveVerdicts.ts')`: its runtime import edges name `'../../shared/claudeVersion.js'`.
   - The `not.toMatch` version-parse assertion is applied to `codeOnly` of that parsed file's text.
   - The `livestate.ts` `not.toMatch` over `live` stays as it is (it still holds: `livestate.ts` parses no version).
   - The row's title and its first assertion (the grammar holders list) keep their bytes.
   - Reading through `parsedFile` adds no counted literal pin, so `advance-switches.test.ts`'s `'server/src/livestate.ts'` row falls from 2 to 1 in the same commit. `liveVerdicts.ts` needs no row.
3. **`stall-sweep.test.ts`**, the tail pin: **not re-pointed under (a1).** It would be re-pointed only under (a2).
4. **The pin's factory** (§2) and **`fleet.ts`'s D-115 comment** are named in Step 5. The two docstring and comment pointers are named in Step 2.

Any other pin that goes red stops the build.

### 4.6 Growth, against `growth-check.test.ts`

The listed files RS9 touches:
- `watch.ts`: **0** net code lines (the import line and the call line, each edited in place).
- `coord/routes.ts`: **0** (the import line and two call lines, in place).
- `server.ts`: **+1** (the new import line), or **0** if RS8's line is extended.
- `sessionws.ts` is not touched (it keeps its `livestate.js` import through the re-export).

None comes near `GROWTH_LIMIT` (40). `fleet.ts` (+2: the type and the parameter), `livestate.ts` (about −8 code lines, with the docstrings leaving too) and the new `liveVerdicts.ts` (about 10 code lines) are not listed. A new `server/src/` file outside `coord/` waives nothing (`L1_L2_NEW_FILE_DIRS`), and nothing needs a waiver. Under (a2), `watch.ts`'s call would stay on one line at 0, and `server.ts`'s two calls at about 0 to +2.

### 4.7 Counted exits (each PR body prints them, base and tip)

- **The set:**
  - It loses exactly `server/src/fleet.ts -> server/src/livestate.ts`. Under (b) it would also lose `server/src/commands.ts -> server/src/livestate.ts`; that is not this route.
  - "Exactly the exemptions" prints the remaining keys.
  - The stamp is rewritten (`size` = base count − 1, `since` = the drain commit's day, reason citing D-7512).
- **The moved names, callers by file and symbol:**

| Name | Base | Tip |
|---|---|---|
| `liveSessionStatus` | defined in `livestate.ts`; called in `fleet.ts#assembleFleet` and `sessionws.ts` | defined in `liveVerdicts.ts` and re-exported by `livestate.ts`; the same two callers |
| `liveStatusCoversDelegation` | defined in `livestate.ts`; called in `fleet.ts#assembleFleet` | defined in `liveVerdicts.ts` and re-exported by `livestate.ts`; the same caller |
| `readLiveStateMeasured` | `fleet.ts#assembleFleet`, `turnverdict.ts` (2), `watch.ts` (3), `sessionws.ts`, `coord/routes.ts`, `livestate.ts#readLiveState` | the same, without `fleet.ts`, plus `livestate.ts#liveStateReaderOver` |
| `assembleFleet` arity | 15 (3 required) | 16 (4 required); `records` at index 10 |

- **Rings at the tip:** `fleet.ts` L1, `liveVerdicts.ts` L1, `livestate.ts` L3. No changed file changes its context.

## 5. Constraints this build keeps

- **No behaviour commit.** What the server answers, logs, writes and paints stays byte-identical, and the characterization pin is the evidence.
- **The pins.** No assertion is loosened, deleted or skipped, and every re-point is listed in §4.5.
- **The files.** No `pwa/`, `agent/`, `ccd/` or `shared/` file is edited, and no wire field, switch or ccd verb changes. It rides the next ordinary release (server lane only).
- **Process.** No worker merges, arms auto-merge or enqueues.

## 6. Reviews

This note passes two independent reviews before the coordinator records the route. One reviewer reads it against §Review focus 1 and 2: a drain that moves the edge instead of removing it, and a default that keeps the edge. The other reads it against the measured counts and rule 6.
