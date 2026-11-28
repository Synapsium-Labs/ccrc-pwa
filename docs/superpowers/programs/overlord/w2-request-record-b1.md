# W2 request record, PR B (first part): task note

The task note of the W2 piece "Request record", PR B, first part: plan
[`w2-requests.md`](../../plans/2026-11-16-overlord-w2/w2-requests.md) Tasks B1 (the code shortlist) and B2 (`touched` on the
history op, and the shortlist's reader), with the questions they cite (RQ3, RQ4, RQ5), §7, the Global Constraints and the
Review Focus. It records what Step 0 measured on `main`, what was built, the eight points of the brief, every departure by
slug, the mutation rows, what the next part's doors read, and the known limits. The coordinator folds it into the programme
ledger; this pull request edits no plan, spec or ledger. No deviation number was allocated, and none is defined here.

**Not in this part (the coordinator's cut):** Tasks B3 to B5: the open, drop, close and escalate doors, the client rows, the
skill tables and the gate rows. No route, door, gate row, client row, skill text or migration is added.

## 1. Step 0: what `main` held

Measured at `ac09ad60da` (2026-11-28). The brief's scout findings were checked, not trusted.

| Question | Answer on `main` |
|---|---|
| The path helpers the shortlist needs | `server/src/coord/claims.ts#normalizeClaimPath` and `#pathsOverlap`, L1. Scout right. Reused; no second matcher. |
| The history verbs' map | `shared/overlordHistory.ts`'s `HISTORY_VERB_MAP` (three verbs). Scout right. |
| A runner for touched paths | `ccd/history/recall.mjs#runTouched`. Scout right, with one thing the scout missed: it always builds the CLI's human header, and `lib.mjs#headerLine` refuses the Overlord's read kind, so under the Overlord's read it threw (§4, `touched-header-reads-as-project`). |
| The store reads active claims | `CoordStore.activeClaims()`. Scout right. The claims census (`claims-advisory.test.ts`) admits each reader by name with an argument. |
| The shortlist's bound and expected path type | Already L0 from PR A: `SHORTLIST_MAX` (6) and `ExpectedPath` in `shared/overlordRequests.ts`. |
| Who reads "this agent serves the op" | The ready frame's ops, through `coord/overlordHistory.ts#historyAgentFor`, and the port's `unsupported` (`remote/io.ts`). There is no word per verb: an agent built before a verb answers it `request-refused` with `bad-verb`, the request reader's word for any verb off its list. |
| What serves a verb to the Overlord | `POST /api/overlord/history` reads its body through the same request reader, so a verb added to the map is served by that door with no route, gate row or count line moving. |
| The agent's history slot | One per agent process, freed only on the worker's exit, 20 s deadline (`agent/src/historyOp.ts`); the server waits 25 s. |
| Runs and sessions | `runs.project` and `runs.coordProject`. The store's one SQL reader of the run and session link (`seriesRows`) is private; its public projection is `bindingRunsOf`. |
| The coordination handle | `core-vocab.test.ts` admits three files (and PR A's store) to hold it. |
| Growth-checked files | None of the files this part edits is growth-checked. `recall.mjs` (capped) and `lib.mjs` (gate code) are untouched. |
| A property-testing library | None in the tree (`fast-check` is absent). |

## 2. What was built

- **L0, `shared/overlordHistory.ts`.** `touched` joins `HISTORY_VERB_MAP`. A touched request carries one to eight paths, one per
  argument, never an option (`bad-args` otherwise; `--regex` and a bare `--` refuse as before).
  `OVERLORD_HISTORY_TOUCHED_PATHS_MAX` (8) and `OVERLORD_HISTORY_TOUCHED_SESSIONS_MAX` (32). `refusedAsUnknownVerb`: the one
  reading of an older agent's refusal.
- **The runner, `ccd/history/overlord-read.mjs`.** `CLI_VERB` gains `touched`, and `VERBS` gains a runner that reads one CLI
  `touched` per path, in order, and stops between paths once `TOUCHED_OPEN_BUDGET_MS` (4 s) has passed, read through an
  injected monotonic clock. Its answer is a `rows` answer of the existing shape (R3): one item per path read,
  `{ asked, file, whole, sessions: [{ ccrcId, latestMs }] }`, with `shown` the paths read and `total` the paths asked. Only ids
  and times leave: no gist, ref, header or path of the box. `whole` is false when the CLI's candidate cap was hit, a ranked row
  was not shown, a row named no session, or more than 32 sessions were seen.
- **L1, `server/src/coord/requestShortlist.ts`.** `touchedRequestOf` (which paths are asked), `touchedAnswerOf` (what the read
  answered, every non-reading its own word, every item bounded and checked), `touchedReadOf` (rows to programmes),
  `codeShortlist` (Table 7) and `touchedPathOk` (the path grammar). Pure; the bounds are declared once.
- **L3, `server/src/coord/requestShortlistRead.ts`.** `liveProgrammes`, `claimsByProgramme`, `sessionRuns`,
  `touchedByProgramme` and `readShortlist`. Every read is a `CoordStore` method; the one history read goes through the history
  door's own agent choice and port, and waits at most `TOUCHED_OPEN_WAIT_MS` (5 s) through the time port, its handle a local of
  the call. No caller in production.
- **Tests.** `request-shortlist.test.ts` and `shortlistCases.ts` (Table 7 row by row, the directory rule, the five properties,
  the request, the answer and the read), `request-shortlist-read.test.ts` (each read, each word, the wait, the planted marker, the
  census of callers), the touched cases in `overlord-read.test.ts` (items, the read limit, the CLI grammar, the budget, writes
  nothing, and the header copy's three pins), the import pin in `overlord-read-scope.test.ts`, and the request reader's touched
  cases in `sim/overlordHistorySets.ts`.
- **Censuses.** The four deciders' mutant sets (`sim/requestSets.ts`) and floors; the two files in `TIME_PORT_FILES`; the
  shortlist's words admitted to the kebab census through `isShortlistKebab`; the reader admitted to the claims census as a
  display reader, pinned by its one call. The three held files went to their holders as packets first and were edited only on
  their yes (mails 41274 and 41275, answers 41283 and 41282).

## 3. The brief's eight points

| Point | How it holds | What proves it |
|---|---|---|
| 1. The decider is pure and total; stable order; bounds declared once; a mutant set at floor 1 | Every input shape answers (an unmeasured read, an empty list, an unknown time); a total key orders the candidates (slug last); `SHORTLIST_MAX` and the history op's bounds are each declared once | Table 7's cases, the five seeded properties, the bounds case; four sets, 47 mutants, all killed, floors at 1 |
| 2. Three answers never folded | Each read answers measured, partial or unmeasured with its word: `not-served`, `link-down`, `many-agents`, `history-unreadable`, `busy`, `deadline`, `refused`, `runs-unreadable`, `claims-unreadable`, `programmes-unreadable`; the shortlist carries each read's kind and the touched words | `touchedAnswerOf`'s cases (every outcome), the reader's cases (a throw per read), mutants A1 to A5, A17 and R2 |
| 3. Additive on the wire | `touched` is a new verb in the existing request; no protocol number, op or ready word moves. An older agent answers `bad-verb`, read through `refusedAsUnknownVerb` as `not-served` | The older-agent cases in the answer and reader tests; mutants A4 and A4b |
| 4. Paths are data from another box | An item must name the path it was asked at its index; every path is on the CLI grammar (`[A-Za-z0-9_./-]`, normalised, no `..`, no absolute path, at most 512 bytes); at most 32 sessions per item, each a registry id; an item that fails is refused (`item-refused`). The reader logs nothing | The planted-marker cases (no log line, no answer), the refused-item cases, the path grammar case; mutants A6, A7, A9 to A11, Q7 to Q10 |
| 5. Nothing reachable at merge | The reader has no caller | The census in `request-shortlist-read.test.ts` (no source imports the reader). The open door of the next part is its first caller. The history door does serve the verb from merge (§6, Reach). |
| 6. The gate-code files | Untouched. `lib.mjs#headerLine` shaped the build (§4); the history coordinator ruled the copy is the design | No diff to the four files |
| 7. Growth and fixture homes | No growth-checked file is edited; every history case runs in a fixture home under the per-run temp root | `growth-check` and `growth-caps` green |
| 8. A product-owned mechanism | The read is ccrc's own history op over ccrc's own history store; nothing here calls a harness. What the store indexes is the history sweep's concern, not this piece's | — |

## 4. Departures, by slug

- **`touched-header-reads-as-project`** (accepted, call 2022; the history coordinator's word). The history library's header
  line refuses the Overlord's read kind on purpose: it is the one guard that keeps that kind from a printed scope line. The
  touched runner builds that line only to size its reserve, and the Overlord's read returns no header, so the read hands
  `runTouched` a copy of its context whose kind reads as `project`, for that line alone. Three pins: the header line still
  throws on the Overlord's kind and not on the three scope kinds; under each target (all, a project, a session) the rows are that
  target's and every item is whole; and no header text, scope word, gist or planted path leaves, the scope record being the real
  context's. Later, not this part: `touched-runner-reserves-without-the-header` (the recall module's runner could reserve
  without building the line).
- **`shortlist-reads-through-the-store`.** The plan's `liveProgrammes(db)` and the runs join read `coord.db` directly. The
  coordination ring holds its handle in named files only, and the run and session link has one private SQL reader, so the
  reader goes through `CoordStore.programs`, `activeClaims`, `run` and `bindingRunsOf`, and holds no handle.
- **`shortlist-reads-are-told-apart`.** The plan's decider takes claims as a list and live programmes as a set. Each is now a
  read with a kind (`measured` or `unmeasured` with its word), and the shortlist carries all three reads' kinds and the touched
  words, so an unread input never reads as an empty one.
- **`touched-unmeasured-words`.** The plan's four whys (`busy`, `deadline`, `unavailable`, `refused`) are eight: `unavailable`
  splits into `not-served`, `link-down`, `many-agents` and `history-unreadable`, and `runs-unreadable` is the runs read.
- **`partial-names-every-cut`.** A partial read's `why` is a list of every cut that holds, in a declared order, and gains
  `path-refused` (an expected path off the grammar is not asked) and `item-refused` (an answer item that fails its checks).
- **`touched-paths-take-the-cli-grammar`.** RQ3 refuses globs at the door. The CLI's touched reads a path only in
  `[A-Za-z0-9_./-]` (`lib.mjs#classifyRef`), so a path outside it is not asked and reaches a programme through claims alone.
- **`touched-items-are-ids-and-times`.** The answer stays the R3 `rows` shape. Its items are one per path read, carrying ids
  and times only; `shown` and `total` count paths, and `whole` covers the plan's "capped" and "shown below its total".
- **`coordinator-runs-take-their-coordinator-project`.** RQ5 maps a ccrc id through `runs.sessionId` and `runs.claimedBy`
  and names no project. A worker's hit takes its run's project; a coordinator's takes the run's coordinator project, else the
  run's project. A hit counts only toward an expected path in the same project.
- **`older-agent-reads-not-served`.** The distinction has one reader, `shared/overlordHistory.ts#refusedAsUnknownVerb`, beside
  the request reader whose word it reads.
- **`seeded-properties`.** The plan names fast-check, which the tree does not carry. The five properties run over a seeded
  generator (`fakeTime.ts#mulberry32`), 200 draws each, inside the shared cases, so the mutation floors run them too.
- **`claims-census-admits-the-shortlist`.** The claims census admits the reader by name with a D12 argument (a claim's only
  effect is a programme's place on a list of at most six candidates the Overlord reads as a hint), pinned at one call.
- **`shortlist-reads-the-binding`** (found by the pull request's fast run). The reader first told a session's runs apart by
  comparing `sessionId` and `claimedBy` itself, which the run/session census (ARCH-62) refuses. It now asks the binding:
  `runBinding.ts#boundRunsOf` with an unborn incarnation and no mint (the id-string rule: a history row names an id, never a
  birth, and the multi-programme rule counts every programme the id worked on), and `runBinding.ts#runsClaimedBy`. The
  census stays at zero sites.
- **`id-census-admits-the-shortlist`** (found by the fast run). `requestShortlist.ts` vets each session id an answer names
  with `isRegistryId`, so the id census's gate list names it, with its reason; it composes no argv.
- **`touched-is-not-on-the-read-tool-yet`** (found by the fast run). The door process's history row (`ccd/door-process.mjs`)
  and the client's history grammar (`ccd/ccrc-api`) still carry three verbs: the brief adds no client row, and the client
  is another run's claim (ruled (B), call 2037). `door-tools.test.ts` held the row's verbs equal to the shared list. It now
  classifies every verb of the shared list exactly once, as the read tool's or the server's own (`touched`), holds the row's
  verbs equal to the read tool's, and a control case shows a verb added to the shared list and placed nowhere goes red. So
  RQ5's "serves `touched` to the Overlord too" is not reached in this part: the HTTP history door accepts the verb, but the
  read tool and the client refuse it before a request leaves the box. **Where it joins:** the verb joins the read tool's
  row (`ccd/door-process.mjs#HISTORY_VERBS` and its description) and the client's history grammar (`ccd/ccrc-api`, its verb
  check and help lines) with the request record's doors, B5 or later, moving `touched` to the read tool's place in the pin.
  The coordinator tickets it.
- **Process.** The tests and the code were written in one pass rather than red first; each test's power is shown by its
  mutants instead (§5). One early edit to `requestShortlistRead.ts` was made with a script, against the brief's first sentence;
  the file was then rewritten whole with the Write tool, and every later edit used the Edit and Write tools.

## 5. Mutation rows

| Set | Before (`main`) | After |
|---|---|---|
| `requestShortlist.ts#codeShortlist` | none | 18 mutants (K1 to K19 but K14), all killed, floor 1 |
| `requestShortlist.ts#touchedRequestOf` | none | 10 (Q1 to Q10), all killed, floor 1 |
| `requestShortlist.ts#touchedAnswerOf` | none | 16 (A1 to A17 but A8 and A12, plus A4b), all killed, floor 1 |
| `requestShortlist.ts#touchedReadOf` | none | 3 (R1 to R3), all killed, floor 1 |
| `shared/overlordHistory.ts#readOverlordHistoryRequest` | 8 (R1 to R8) | 12: R9 to R12 hold the touched grammar, all killed |
| The runner's header copy, by hand (Edit, run, revert) | none | M-H1 no copy: pins 1 and 2 red; M-H2 the copy widens the selection: pin 1 red; M-H3 the item carries the CLI page: pin 2 red |

The first run left five survivors. K14, A8 and A12 were equivalent mutants of guards the code did not need (the touched hits
are read only on the paths branch; an item must name its asked path, which is already on the grammar; an item past the paths
names none); the guards were removed. K13 and A13 were real gaps; a case was sharpened for each. M-H2 first survived, because a
widened row has no family in the real context and the runner only marked the item not whole; pin 1 now asserts every item
whole, and M-H2 is killed.

## 6. What the next part reads, and what is reachable

**What the open door reads.** `readShortlist(deps, expected)`, called before its transaction (a slow read), with
`deps = { coord, links, io, time }`: the store, the agent links as the history door reads them, the port
`FleetIO.overlordHistory`, and the time ports. It answers a `Shortlist`: at most six candidates
(`{ programme, claimHits, touchedHits, newest }`), the basis, each read's kind and the touched words. The door validates
expected paths first (RQ3, F12); the reader asks touched only for paths on the CLI grammar. Decision model A's
`programme.pick` takes the candidates. The door waits at most 5 s; the runner's budget is 4 s and the agent's deadline 20 s
(pinned in that order).

**Reach at merge.** The shortlist's reader has no caller. The HTTP history door, `POST /api/overlord/history`, accepts one
more verb under the gate it already has (its gate, routes and censuses are untouched). But the Overlord's read tool and the
client still know three verbs and refuse the fourth before a request leaves, so no caller on `main` can ask it at merge
(`touched-is-not-on-the-read-tool-yet`). Its first asker is the shortlist's reader, on the server, with the open door of the
next part. A `touched` answer holds ids and times only, within the one-slot budget (the budget cases). An agent that predates
the verb answers it refused with `bad-verb`: the door answers that as `bad-request`, and the shortlist reads it as
`not-served` (the older-agent cases).

## 7. Known limits

- **The header copy is the design.** The history library's header line refuses the Overlord's read kind on purpose; the
  touched runner builds that line only to size its reserve and returns no header; the Overlord's read therefore hands it a
  context whose kind reads as project, for that line alone.
- **An older fleet box.** Its agent answers `touched` refused (`bad-verb`): the history door says `bad-request`, and the
  shortlist reads `not-served` and stands on the claims alone. It moves no protocol number.
- **What a path's read sees.** The runner ranks at most 50 rows per path, and keeps at most 32 sessions; past either, the item
  is not whole and the read is `partial`. History's touched matches a file exactly or by suffix, and the decider counts a hit
  only on the asked path's own string, so a directory reaches a programme through claims alone.
- **The slot after the door's wait.** A wait that ends at 5 s aborts only the server's wait; the agent's worker runs to its own
  budget or deadline, so a read right after may answer `busy` (`unmeasured`).
- **The runs reads.** A session's runs are read with `bindingRunsOf` and one `run` read per distinct run, at most 256 sessions
  per open. Any unreadable answer makes the whole touched read `runs-unreadable`.
- **The test box.** It carries no pwa packages, so `typecheck-tests` and the mutation floors' pwa sets do not run there, and the
  whole server tests typecheck was stopped by the shared test slice's memory cap. The changed test files were typechecked
  through a config extending the tests project (clean), the agent's tests project is clean, the shortlist's and history's
  mutant sets were run filtered, and CI's runs are the arbiter for the rest.
- **Lines another wave also changes.** The kebab census's message line and the floors file's rows right after
  `citedMessagesForBoot` are changed by other approved packets too (relay A, act rows A); whichever lands second keeps every
  side's additions.
