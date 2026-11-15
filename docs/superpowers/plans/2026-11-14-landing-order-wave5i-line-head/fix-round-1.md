# Fix round 1

## R1

**Defect.** `landingBindingOf` chose open rows from the damage-folded display state. A raw `landed`, `closed` or `withdrawn` row with an unreadable `afterIds`, `fixesMain`, `pinnedAt`, `ejections`, `ejectionKind` or `runId` displays `unknown`, counted as open, and held the binding at `projection-unreadable` for good (no repair visits a raw terminal row).

**Fact added.** `LandingMutationFacts.stateWords` (`landingWrites.ts`): the stored state word of every entry of the project, `'unrecognised'` when it is outside the L0 vocabulary. Built in `landingFactsOf` from the raw row, before the display fold. `landingBindingOf` calls a row open when its word is `unrecognised`, `unknown`, nonterminal, or has no record (fail closed). The `clear` predicate, the precedence order, recovery and identity handling are unchanged.

**Tests.** `test/landing-terminal-damage.test.ts` (real `CoordStore`; raw landed/closed/withdrawn with six damaged columns: display `unknown`, stored word terminal, binding `ready` for the clean head, one cue to its creator, second pass `duplicate`, raw bytes unchanged; a closed re-pin of a damaged closed row stays `kept`; controls for raw pinned, unknown and `parked-v9` with damage and undamaged, and an independent recovery hold). `landing-control.test.ts`: the ORDER-unknown cases rewritten to the real reader's shape. Fixtures that build `LandingMutationFacts` carry the field.

**Red-first note.** The tests were written after the implementation in this session, so the red is measured by mutation, below, not against the old code.

**Mutations** (`landingLine.ts` saved, restored with `cp`, `cmp` equal; run: `ccrc test --` vitest on `test/landing-control.test.ts` and `test/landing-terminal-damage.test.ts`):

| Mutation | rc | Red |
|---|---|---|
| (a) openness from display state | 1 | `ORDER-unknown: a damaged terminal row ...` and all 18 `raw <landed/closed/withdrawn>, <damage>: displays unknown ... cue queues once` |
| (b) `'unrecognised'` treated terminal | 1 | `AssertionError: unrecognised: expected { mode: 'ready', ... } to match object { mode: 'held', ...}`; `ORDER-unknown (fix round 2)`; the real-store `raw parked-v9` controls |
| (c) missing record treated terminal | 1 | `AssertionError: expected { mode: 'ready', entryId: 107, ... } to match object { mode: 'held', ...}` (pure case only; the store always writes a record per entry) |

**Green.** Slice of 11 landing files: 427 passed, rc 0. Production typecheck rc 0. `typecheck-tests` 12 passed. single-definition and rings: 45 files, 1487 passed. Armed `growth-check`: 94 passed. No OOM kill occurred.

**Limitation.** `landingOrder` counts a display-`unknown` row as an outstanding dependency, so a row whose `afterIds` names a damaged terminal row stays `empty-or-blocked`; that is the 5e display contract, not this seam.

**R1 review minors (added).** (1) Indentation of the `dependencies` line in `landed-decide.test.ts` fixed. (2) A raw terminal row that also carries `quarantineKind = 'stale-episode-head'` (the schema's CHECK is lifted in the fixture to store it): measured, the marker alone leaves the DISPLAY at the stored word (only the projection reads `unreadable`), so that row was never an open blocker; with a display damage beside it (`afterIds` not json) it reads `unknown` and only the stored-word fix keeps it from holding. Six real-store cases (landed, closed, withdrawn, each marker alone and marker with damage) assert display, stored word, unreadable projection, `ready`, and raw bytes unchanged; one pure sibling in `landing-control.test.ts`. (3) The real-store control list gained raw `ejected` with the same three damages: still `projection-unreadable`. Mutation (a) rerun on both files: rc 1, 23 reds, among them the three `marker and afterIds not json` cases (`raw landed, marker and afterIds not json: ... the binding is ready`); the marker-alone cases cannot redden (a) because their display is terminal already. Restored with `cp`, `cmp` equal. Landing slice of 11 files after: 440 passed, rc 0.

## R3
**The earlier CI workaround (d5c8bb4d0), recorded truthfully.** Task 1 shipped `landedCallStep(call: CcdResult)` answering `parse | failed | not-ran`. The PR's first fast CI run failed two whole-tree guards no local selection had run: `consolidation-census` ("every `runCcd(` site answers the not-ran arm") and the `mail-routes` kebab-token scan (the `'not-ran'` act word). Commit d5c8bb4d0 satisfied both by moving the `res.ran === false` block (retry memory write, `stopped: 'link'`) back into the L4 lane and narrowing `landedCallStep` to the ran arm. That put a policy decision in delivery code; review 2123 (A1) and the coordinator's ruling R3 rejected it.

**The correction.** `landedCallStep(call: CcdResult)` in `landed.ts` (L1) reads `call.ran === false` first and answers `{act:'not-ran'; answer; stopped}`, carrying the retry answer (`{act:'retry', missingField:false}`) and the stop word (`'link'`), so the lane holds no constant policy choice. `landedPass` calls it on the line after `runCcd(`, applies `call.answer` and `call.stopped` on `not-ran` (no read counted), and reads no `ran` itself. Behaviour is unchanged: stop word, memory written, `read` not incremented on not-ran, ran-failed backs off and continues (existing rows in `landed-lane.test.ts` pin these and stayed green).

**Census row.** `'landedCallStep'` added to `RAN_CARRY_READERS` (the designed carried arm); window, regexes, `RAN_TABLE` and the count pin untouched. `'not-ran'` added as one `NOT_CODES` entry in `mail-routes.test.ts`'s wave 5i block.

**Tests.** `landed-decide.test.ts`: `landedCallStep` rows (not-ran with exact carried values, parse, failed) and an ownership check that `landedLane.ts` (comments stripped) holds no `.ran` and no `missingField: false`. Red first: 2 failed, 32 passed (the not-ran row got no `not-ran` act; the ownership scan found the lane's `res.ran`). The ownership check first read the lane with `readFileSync`, which `single-definition/advance-switches` counted as a new literal source pin on `landedLane.ts` (red); it now reads through `scan/parse.ts` `parseFile` (no pin).

| Mutant | Command (file) | Failing assertion | rc | Restore |
|---|---|---|---|---|
| M-R3a `landedCallStep` without its `ran === false` arm | landed-decide + landed-lane | 4 failed: `expected { act: 'failed' } to deeply equal { act: 'not-ran', ... }`, and three lane link-stop rows | 1 | cmp equal, green |
| M-R3b lane reads `res.ran === false` again | landed-decide | ownership: `expected ... not to match /\.ran\b/` | 1 | cmp equal, green |
| M-R3c `'landedCallStep'` out of `RAN_CARRY_READERS` | consolidation-census | REAL test: `expected [ 'server/src/coord/landedLane.ts:91' ] to deeply equal []` | 1 | cmp equal, green |
| M-R3d `'not-ran'` out of `NOT_CODES` | mail-routes | `not-ran is not a declared MailRejectCode, ...` | 1 | cmp equal, green |

**Green.** landed-lane, landed-decide, consolidation-census, mail-routes, pr-timeout-budget: 5 files, 190 passed, rc 0. single-definition, rings and coord-policy-rings: one real red (the pin above, fixed), then green; production tsc clean; armed `growth-check` 94 passed. The tests-inclusive tsc suite was OOM-killed by the slice cap in several runs (rc 1, flaking on its directory-coverage cases); a later run alone: 12 passed, rc 0; an earlier alone run also passed 12.

## R2

**Finding F2 and the ruling.** The matrix credited M12's "later clean entry queues 0 mails" half to task 5's M21 episode row (a different mutant), left M13's mail and real-store half and M14's exact mutant unrecorded, and asserted ORDER-no-skip only at the pure binding level. The ruling: measure the three rows for real, and audit M1 to M27 after the binding fix. Nothing here is an attribution-only repair.

**Provenance.** Every mutation below was run from `server/` at source tip `194f39ed4` (no `server/src` file differs from it in any run) with the new tests of commit `2ae62d636` (`landing-next-mail.test.ts` only; the working-tree test file of the first three mutants is byte-identical to that commit). Each run is `timeout 600s ccrc test -- ./node_modules/.bin/vitest run <files> [-t <name>] --maxWorkers=2`, in the foreground (the harness moved long runs to the background and they were waited on by a bounded poll of their output file); one mutant at a time, the file saved with `cp` before, restored with `cp` from the saved copy and confirmed with `cmp` (equal in every row), then the same selection re-run green.

**New tests** (`server/test/landing-next-mail.test.ts`, real `CoordStore`, fixed clock):
- M12, `an unhealthy selected head holds the line, and a later clean entry queues nothing`: PR 7 (a merging run) is the selected head, PR 8, pinned a minute later, a clean no-run entry behind it. A control row (both clean: PR 7 is cued, never PR 8). Three stale shapes, each asserted twice: the binding is `held` at the selected entry's id (`landingBindingOf`), and `applyLandingControl` answers `no-send` with the same word on two passes with zero `mail`, `mail_deliveries` and cue observation rows. Shapes: the probed head differs from the pinned sha (`head-mismatch`), the probe lists no head for the PR (`head-mismatch`), the selected head's composition conflicts (`composition-not-clean`).
- M13, `pending and unmeasured health never move the flag, and hold the mail by themselves`: (a) a stored red (set by a red pass, read back from `landing_projects`) through health `unmeasured/pending`, `unmeasured/forge-unreachable` and an absent health document: each pass answers `no-send health-unmeasured`, `holdChanged: false`, the flag read back `true`, zero mail; green then clears it (`holdChanged: true`) and the head is cued once. (b) the flag false: the same three documents give binding `held health-unmeasured`, `no-send`, flag still false, zero mail rows and deliveries.

| Row | Mutant | Selection (rc) | Failing assertion | Restore / green |
|---|---|---|---|---|
| M12a | `landingBindingOf` compares the selected head by PR only (`probed.head !== head.pinnedSha` dropped) | `landing-next-mail -t "unhealthy selected head"` (rc 1, 2 failed, 5 passed) | binding row `expected { mode: 'ready', entryId: 1, …(7) } to deeply equal { mode: 'held', …(2) }` and store row `expected { kind: 'queued', mailId: 1, …(2) } to deeply equal { kind: 'no-send', …(2) }`, both for `a stale selected head: the probed head differs from the pinned sha`. The other two shapes stay held by other guards (`probed === null`, composition) and pass, as they must | `cmp` equal; green 7 passed, rc 0 |
| M12b | the binding skips the held head and binds the first ordered entry whose probed head and composition are clean | same (rc 1, 6 failed, 1 passed: the control) | all three shapes, both rows: binding `expected { mode: 'ready', entryId: 2, …(7) } to deeply equal { mode: 'held', …(2) }`; store `expected { kind: 'queued', mailId: 1, …(2) } to deeply equal { kind: 'no-send', …(2) }` | `cmp` equal; green 7 passed, rc 0 |
| M13a | `mainRedNext` clears red on an `unmeasured` health document (returns `set false` when the previous value was true) | `landing-next-mail -t "(M13)"` (rc 1, 1 failed, 1 passed) | `a stored red stays red through pending and unmeasured health`: `expected { kind: 'no-send', …(2) } to deeply equal { kind: 'no-send', …(2) }` (`holdChanged` true, not false: a `set` was written) | `cmp` equal; green 2 passed, rc 0 |
| M13b | the binding's `health.doc.state === 'unmeasured'` arm removed (`health-unmeasured` keeps only `!health.ok` and a null sha) | same (rc 1, 2 failed) | (a) `expected { kind: 'queued', mailId: 1, …(2) } to deeply equal { kind: 'no-send', …(2) }`; (b) `expected { mode: 'ready', entryId: 1, …(7) } to match object { mode: 'held', …(1) }` | `cmp` equal; green 2 passed, rc 0 |
| M14 | the UPSERT in `landingControlTx.ts` also writes `operatorPaused = 0` (`… DO UPDATE SET mainRedHold = excluded.mainRedHold, operatorPaused = 0`) | `landing-control -t "M14"` (rc 1, 2 failed, 4 passed: the describe `(M13, M14)` holds six cases) | `M14: a pause standing before red to green is still standing after` and `M14: a pause placed between red and green is kept by the green transition`: `expected { operatorPaused: false, …(1) } to deeply equal { operatorPaused: true, …(1) }` | `cmp` equal; green 6 passed, rc 0 |

**M13(b), which guard holds the mail.** With the flag already false, the M13a mutant cannot reach (b): `mainRedNext` already keeps `false`, so (b) stays green under it (measured: 1 failed, 1 passed). The guard that holds the mail there is the binding's own `health.doc.state === 'unmeasured'` arm (and `!health.ok` for the absent document): with it removed (M13b) (b) goes red (`ready` instead of `held`). Both halves of the ruling therefore hold independently: M13a protects the flag, M13b protects the mail.

**Audit of M1 to M27 at tip.** Facts used: R1 (`fce9ca4d9`, `194f39ed4`) added `stateWords` to `landingFactsOf`/`LandingMutationFacts` and changed `landingBindingOf`'s openness; R3 (`2a833dcba`) changed `landedCallStep` and `landedPass`'s call arm. `git diff 9210e7a37 HEAD` over `landingEntry.ts`, `landingWrites.ts` and `landed.ts` shows only those hunks. The "measured at" column is the owner task's commit (the notes do not record a SHA). Re-runs below: every mutant was applied to the real file, run, restored by `cp`, `cmp` equal (all mutant runs), and the selection re-run green (one green per selection, after the last mutant that shares it; the summary says which). All at source tip `194f39ed4`.

| Row | Owner note | Mutated code | Measured at | Touched since, and what the selection exercises | Decision, result at tip |
|---|---|---|---|---|---|
| M1 | task-1 | `landed.ts#landedProjectStep` (refusal returns `skip`) | b1bc4a554 | function not edited; `landedPass` (the selection) changed by d5c8bb4d0 and 2a833dcba | RE-RUN, `landed-lane`: 1 failed, 43 passed, `a store stop in the first project ends the pass`: `expected { read: 1, landed: +0, …(2) } to match object { read: +0, stopped: 'store' }`; green 44 passed |
| M2 | task-1 | `landed.ts#landedPruneIds` (`!complete` guard removed) | b1bc4a554 | same | RE-RUN, 1 failed: `an incomplete inventory retains memory: expected false to be true`; green 44 passed |
| M3 | task-1 | `landedLane.ts#landedPass` (held mark's memory write removed) | b1bc4a554 | line unchanged; function changed (R3, d5c8bb4d0) | RE-RUN, 3 failed (both `held at the write` rows `expected undefined to deeply equal { pinnedAt: Any<Number>, …(4) }`, `a mark held at the write is remembered at the pass start`); green 44 passed |
| M4 | task-1 | `landedLane.ts#landedPass` (`at: deps.now()` to the pass start) | b1bc4a554 | same | RE-RUN, 1 failed: `the mark is stamped when it is written, the second call of the clock: expected 1794398400000 to be 1794398401000`; green 44 passed |
| M5 | task-1 | `landingEntry.ts#isLandable` (projection test removed) | b1bc4a554 | function unchanged; `landing-land-words` also folds rows through `landingFactsOf` (R1) | RE-RUN, 4 failed, 23 passed: `isLandable … expected true to be false`, `decideLandingLand … expected { act: 'land', id: 3, …(2) } to deeply equal { act: 'none', …(1) }`; green 27 passed |
| M6 | task-1 | `landingEntry.ts#LandingHoldGate` third word, no `HELD_WORDS` entry | b1bc4a554 | `landed.ts` changed by R3 (`landedCallStep` only; `HELD_WORDS` untouched) | RE-RUN (production `tsc --noEmit`): rc 1, `landed.ts(109,7): error TS2741: Property '"landing-hold-third"' is missing in type … but required in type 'Record<"landing-hold-third" | …, true>'` (plus two `store.ts` TS2322); green rc 0 |
| M7 | task-1 | `close.ts#landOnClose` (catch removed) | b1bc4a554 | `close.ts` untouched since the wave began; the selection reaches `advanceLanding` (store, R1 facts) | RE-RUN, `run-routes -t 'mark that throws'`: 1 failed `expected 500 to be 200`; green 1 passed |
| M8 | task-2 | `ccd/ccd-land-probe#remove_own` | 25faa6845 | the file's last commit (43e11b361) predates the wave; the selection is a bash fixture and reaches no TypeScript | RETAINED. Re-checked unmutated at tip: `ccd-land-probe -t 'lander key and its mirror'` 12 passed |
| M9 | task-2 | `lineageRead.ts` marker ancestor chain | 25faa6845 | only change since: bdc6581e8 turned `const allFailed` into `export const allFailed` (hunk read); the red assertions are reader outputs (`lander` `absent`, byte-read count 0), and neither `landingBindingOf`, `landingFactsOf`, `landedCallStep` nor `landedPass` is called on those paths | RETAINED. `radar-lane` (70) is green at tip in the M23 run, `landing-control` (reader describes) in the M11/M13 runs |
| M10 | task-2 | `lineageRead.ts#readRegular` cap and ranges | 25faa6845 | same as M9 | RETAINED, same reasoning and greens |
| M11 | task-3 | `landingLine.ts#landingBindingOf` (`health.sha !== probe.baseSha` gate) | b03717f99 | `landingBindingOf` edited by R1 (openness) | RE-RUN, `landing-control -t landingBindingOf`: 1 failed `base mismatch…: expected { mode: 'ready', entryId: 107, …(7) } to deeply equal { mode: 'held', …(2) }`; green 19 passed |
| M12 | task-3 (pure); R2 (mail) | `landingBindingOf` pinned-sha equality (M12a), skip to a later entry (M12b) | b03717f99 | as M11 | RE-RUN, three selections: original `head mismatch…` row 1 failed `expected { mode: 'ready', entryId: 107, …(7) } to deeply equal { mode: 'held', …(2) }` (green 19 passed); new real-store/mail rows above (M12a 2 failed, M12b 6 failed) |
| M13 | task-3 (pure); R2 (store, mail) | `landingLine.ts#mainRedNext` (clear red on `unmeasured`); binding `health-unmeasured` arm | b03717f99 | `mainRedNext` unchanged; selection runs real-store passes through `landingFactsOf` (R1) | RE-RUN, original selection `landing-control -t 'mainRedNext|M13'`: 2 failed `pending and unmeasured readings keep either prior value: expected { kind: 'set', value: false, …(2) } to deeply equal { kind: 'keep', value: true }` and `M13: pending and unmeasured health never clear red…: expected { kind: 'no-send', …(2) } to match object { holdChanged: false }`; green 12 passed; plus the new rows (M13a, M13b) |
| M14 | task-5 (no row recorded); R2 | `landingControlTx.ts` UPSERT writes `operatorPaused` | 59640f62b | `landingControlTx.ts` edited by 4f9ed5d34 and 88f937b79 (handle spelling, no unreachable throw); the UPSERT text is unchanged | RE-RUN (measured for the first time, above): 2 failed, rc 1 |
| M15 | task-3 | `landingLine.ts#landingOrder` (a: any fixesMain entry exempts main-red; b: operator pause no longer suppresses the exemption; c: recovery hold dropped from the unpaused answer) | b03717f99 | `landingOrder` unchanged; `landing-control` calls `landingBindingOf` (R1) | RE-RUN, `landing-line-order` + `landing-control`: (a) 2 failed `ORDER-fix-blocked…`, `a cycle of fixesMain entries never heads`: `expected { paused: false, …(2) } to match object { paused: true, by: [ 'main-red' ] }`; (b) 1 failed `an operator pause always suppresses the head…: expected { paused: true, …(2) } to match object { paused: true, …(1) }`; (c) 3 failed incl. `recovery still has no head…: expected { paused: false, …(2) } to match object { paused: false, head: null, …(1) }`; green 101 passed |
| M16 | task-4 | `landingEntry.ts#decideLandingWrite` (equal-head projection check, refuse only at a stale head) | 8b6ed3cfb | function unchanged; the selection reads facts through `landingFactsOf` (R1) | RE-RUN, `landing-advance-route -t equal-head`: 4 failed (the 200 success body where 503 expected); green 6 passed |
| M17 marker | task-4 | `landingEntry.ts#terminalRepairOf` quarantine exclusion | 8b6ed3cfb | `terminalRepairOf` unchanged; the store builds `LandingMutationFacts` through the R1-changed `landingFactsOf` | RE-RUN, `landing-land-store -t 'the exclusions'`: 3 failed `expected { kind: 'eligible', …(1) } to deeply equal { kind: 'blocked', …(1) }`; green 20 passed |
| M17 binding | task-4 | same function, binding exclusion | 8b6ed3cfb | same | RE-RUN, 3 failed (`a run that cannot be read`, `a historical binding that disagrees…`): `expected { kind: 'eligible', …(1) } to deeply equal { kind: 'blocked', reason: 'binding' }`; green 20 passed |
| M17 token | task-4 | `landingEntry.ts#decideLandingLand` token comparison | 8b6ed3cfb | same | RE-RUN, `-t 'the token\|BLOB'`: 4 failed `expected { ok: true, landing: { …(2) } } to deeply equal { Object (ok, landing) }`; green 11 passed |
| M17 identity (invalid run id) | task-7 | `terminalRepairOf` `!p.runIdOk` | d4b2187d4 | as above | RE-RUN, `landing-land-store` + `landing-land-words`: 2 failed (`an invalid run id`; `…an invalid run id is identity`): `expected { kind: 'blocked', reason: 'binding' } to deeply equal { kind: 'blocked', reason: 'identity' }`; green 91 passed (shared with the next two) |
| M17 identity (blank project) | task-7 | `terminalRepairOf` `!nonblank(row.project)` | d4b2187d4 | as above | RE-RUN, 2 failed (`an empty project…`, `a padded project…`): `expected { kind: 'eligible', …(1) } to deeply equal { kind: 'blocked', reason: 'identity' }`; same green |
| M17 retained-fields | task-7 | `terminalRepairOf` per-column, kind, base, afterIds, fixes, pinnedAt, ejections checks | d4b2187d4 | as above | RE-RUN, 9 failed (the seven recorded cases of `landing-land-store`, plus `a missing token, or a value of a kind SQLite does not return…` and `a marker is quarantine, an unreadable counter is retained-fields…` in `landing-land-words`), each `expected { kind: 'eligible', …(1) } to deeply equal { kind: 'blocked', …(1) }`; green 91 passed |
| M18 | task-4 | `store.ts#readLanding` (ambient guard removed, the read caught inside) | 8b6ed3cfb | `readLanding` unchanged; `landingFactsInner` builds R1's fact | RE-RUN, `landing-journal-store -t ambient`: 2 failed, `expected [Function] to throw error including 'fixture select fault' but got 'database is not open'`, `Error: database is not open`; green 5 passed |
| M19 | task-5 | `rundefsTx.ts#queueRunlessNoticeTx` dedupe on outstanding mail; `landingControlTx.ts` run-arm observation detail made unique | 59640f62b | `rundefsTx.ts` unchanged; the selection goes through `applyLandingControl` and `landingBindingOf` (R1) | RE-RUN, `landing-next-mail -t M19`: no-run arm 2 failed (`acked`, `rejected`): `expected { kind: 'queued', mailId: 2, …(2) } to deeply equal { kind: 'duplicate', …(1) }`; run arm 4 failed (all four delivery states), same shape; green 8 passed |
| M20 | task-5 | `landingNext.ts` identity tuple: base, episode, recipient omitted (three mutants) | 59640f62b | `landingNext.ts` last edited by 50ead615d; selection as M19 | RE-RUN, `-t M20`: base `a distinct base yields one new cue`, episode `NOTICE-same-ms`, recipient `NOTICE-return`: each 1 failed, `expected { kind: 'duplicate', …(1) } to match object { kind: 'queued' }`; green 4 passed |
| M21 | task-5 | `landingNext.ts#nextLandingNoticeOf` episode PR/head comparison; `run-not-merging` check (two mutants) | 59640f62b | as M20 | RE-RUN, `-t M21`: episode 1 failed `expected { kind: 'queued', mailId: 1, …(2) } to deeply equal { kind: 'no-send', …(2) }`; state 1 failed `expected { kind: 'no-send', …(2) } to match object { kind: 'no-send', …(1) }`; green 7 passed. Not credited to M12 |
| M22 | task-5 | `rundefsTx.ts#insertSystemMailTx` unstamped throw removed | 59640f62b | unchanged; selection as M19 | RE-RUN, `-t M22`: 1 failed `expected { kind: 'queued', mailId: 1, …(2) } to match object { kind: 'failure', …(1) }`; green 10 passed |
| M23 | task-6 | `watch.ts#sweepRadar` generation check | 4d5b75428 | `watch.ts` edited by 88f937b79 (cached control ages out) and the merge 9210e7a37; the check's line is unchanged; the selection applies controls through `applyLandingControl` (R1) | RE-RUN, `radar-lane`: 2 failed, `the superseded pass cannot apply: expected [ 'proj-b', 'proj-b' ] to deeply equal [ 'proj-b' ]` and `an abandoned pass released after a newer one started never overwrites its map (4b F9 (4))`; green 70 passed |
| M24 close | task-7 | `close.ts#landOnClose` producer rebound to a cast run arm | ed1693d42 | `close.ts` unchanged | RE-RUN, `landing-entry-census`: 2 failed, `Error: server/src/coord/close.ts#landOnClose: closeLandingOf: 'land' is cast, which hides what it holds`; green 38 passed |
| M24 pad | task-7 | `routes.ts#advanceAct` run arm padded past 400 characters with `kind: 'land'` | ed1693d42 | `routes.ts` edited by da1c53a33 AFTER the task-7 measurement | RE-RUN, 2 failed, `Error: server/src/coord/routes.ts#advanceAct: the run arm must carry runId and no 'kind' member`; same green |
| M25 | task-4 | `landingEntry.ts#decideLandingWrite` closed-row projection gate | 8b6ed3cfb | unchanged | RE-RUN, `-t 'terminal to pin'`: 2 failed `expected { ok: true, …(3) } to match object { ok: true, to: 'merging', …(1) }`; green 4 passed |
| M26 | task-4 | `store.ts#terminalRepairTokens` `tag` for bytes: tagged `string` (a), coerced `['string', String(v)]` (b), omitted (c) | 554e6ad6d | unchanged; selection as M17 | RE-RUN, `-t BLOB`: (a) 1 failed `expected 2 to be 3 // Object.is equality`; (c) 1 failed (`one byte of drift…`: `expected { ok: true, landing: { …(2) } } to deeply equal { Object (ok, landing) }`); (b) 1 failed `expected 2 to be 3`; green 5 passed. **A first form of (b), `['bytes', String(v)]`, SURVIVED** (5 passed, rc 0): the `bytes` tag keeps it apart from every text, so it is not the recorded mutant; the recorded one coerces to a string tag, and that form is red. Both recorded |
| M27 | task-5 | `store.ts#applyLandingControl` `this.landingFence = recovery` removed | 59640f62b | unchanged; selection as M19 | RE-RUN, `-t 'fault\|COMMIT\|rolled back'`: 6 failed, `expected { ok: true, facts: { …(11) } } to match object { ok: false, error: 'landing-fenced' }` (the faults and the COMMIT fault); green 7 passed |

**Final selection (green).** `vitest run test/landing-control.test.ts test/landing-next-mail.test.ts test/landing-terminal-damage.test.ts test/landed-lane.test.ts test/landed-decide.test.ts` through `ccrc test --`: 5 files, 221 passed, rc 0. `git status` shows no modified source file (the only edits of the round are the test file, committed, and these notes).

## R4

The plan's `vitest related src/coord/rundefsTx.ts` selection, run from `server/` in the foreground through `ccrc test --`. Grep-selected
callers are supplemental evidence below, not a replacement for it.

| Run | Command | rc | Result |
|---|---|---|---|
| 1 | `timeout 600s ccrc test -- ./node_modules/.bin/vitest related src/coord/rundefsTx.ts --run --maxWorkers=2` | 137 | killed after 28 s, no `Test Files` / `Tests` line printed; the wrapper reported `the test slice's memory cap killed a process during this run (MemoryMax=6G; 2 OOM kill(s) in ccrctests.slice)` |
| 2 (the one retry, `--maxWorkers=1`, first waited about 2 s for a heavy test slot) | the same with `--maxWorkers=1` | 137 | killed after 57 s, no summary lines; the same wrapper message, 2 OOM kills |

The number of files the selection chooses was never printed (the process died before any file result), so it is not known. The
selection did NOT complete. Verification limitation: the related selection has no result, at either worker count, on this box; nothing here
approves or implies a result for it. Not retried again.

Supplemental: the focused mail suites, one run, `timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/landing-checks-lane.test.ts
test/mail-revive.test.ts test/delegation-wave3.integration.test.ts test/landing-next-mail.test.ts test/landing-control.test.ts
test/mail-hardening.test.ts test/mail-deliveries-writer.test.ts`: all seven files exist; rc 0, `Test Files 7 passed (7)`, `Tests 269 passed (269)`,
duration 399 s (the harness moved it to the background after 180 s; waited on its output file). The wrapper again printed its OOM line
(`2 OOM kill(s) in ccrctests.slice`) while the run exited 0: those kills are the slice's, counted over its life, and no test failed.
Per-file counts of the notice-body callers are in R6.

Departure `related-selection-substituted`: Task 5 ran the three grep-found callers (`landing-checks-lane`, `mail-revive`,
`delegation-wave3.integration`, 134 passed) instead of the plan's `vitest related` selection, which is a subset chosen by a text search and
not the import-graph selection, so it was not a replacement. It is now recorded in `task-5.md` and `task-7.md`.

## R5

**Reconciliation.** The slug `control-tx-module` was in the wave-done mail and in the body of PR #2837 (one occurrence, as the controller measured with `gh pr view 2837 --json body`), but in no file of the tree (`grep -rn control-tx-module` over `docs/` and `.superpowers/` found it nowhere before this round). So the
reviewer's "no departure slug of its own" is right about the notes: `task-5.md` `## Departures` named `control-tx-takes-port` (the
`WatcherCoordPort` parameter) but not the split itself, and `task-7.md`'s slug list likewise. Both now carry `control-tx-module`, pointing here.
The split was a coordinator ruling recorded in `.superpowers/sdd/.../progress.md` ("Ruling (T5 ...)"), made because `store.ts` stood at +35 of 40.

**Growth figures, measured at HEAD.** `GROWTH_CHECK=1 timeout 600s ccrc test -- ./node_modules/.bin/vitest run test/growth-check.test.ts --maxWorkers=2`:
rc 0, 1 file, 94 passed (the notes recorded 73; the file has grown). The test prints no per-file figure, so I measured with its own rule:
`codeLines` from `test/growthCheck.ts` applied to `git show <merge-base>:<file>` and `git show HEAD:<file>`, merge-base of `origin/main` and
HEAD as already fetched (`a6b87cf79`, no fetch run), in a throwaway test file that I removed.

| File | Base | Head | Delta |
|---|---|---|---|
| `server/src/coord/store.ts` | 5341 | 5390 | +49 |
| `server/src/coord/landingControlTx.ts` (new, 66 physical lines) | absent | 47 | +48 |

The delta +49 equals the +49 recorded in `task-5.md`, over the limit of 40; the absolute figures there (5332 and 5381) are 9 lower on both
sides because the recorded measurement was taken against the dispatch base 391b5c65b. The clause-16 absorb merge 9210e7a37 (origin/main into this branch) moved the merge-base to a6b87cf79 (`git merge-base HEAD origin/main`), and origin/main grew `store.ts` between those two commits. The delta stays +49 (as the controller measured; not re-run). Task 4's +35 became +49 with
Task 5's `applyLandingControl` method (+14 net: guard, owned transaction, catch, fence). `GROWTH_OVER: (none)` stands only because the new L3 C5 file
takes the new-file rule (D-8563): a passing growth rule is not design approval.

**The split.** `CoordStore.applyLandingControl` (`store.ts`) keeps the guard (`landingGuard`), the one owned transaction (`tx(this.db, ...)`),
the phase-classified catch and the fence and boundary (`landingBoundary`, `this.landingFence`). `applyLandingControlTx` (`landingControlTx.ts`,
L3, C5) is only the body that runs INSIDE that transaction, and it has one call site, `store.ts` (`applyLandingControl`).

**Why one store owner, a synchronous boundary and the same port surface (checked against the code).**
- One owner: `applyLandingControlTx` is referenced from one source file, `store.ts` (one call); `landing-entry-census.test.ts` pins that
  (callers of the function, and that `tx(this.db` precedes the call in source order). The file holds no state, opens no transaction, and
  writes no journal record; its one write is the `mainRedHold` UPSERT, which the census pins as the single statement for that column
  and which leaves `operatorPaused` out of its SET. It takes `coord: WatcherCoordPort`, which at the call is the store itself, and
  `readFacts`, the store's own inner read `landingFactsInner`, so no second reader of the facts exists.
- Synchronous boundary: the file contains no `async`, `await` or `Promise` (grep, empty); the body runs inside the synchronous `tx` over
  `node:sqlite` `DatabaseSync`, and a throw unwinds to the store's catch, which classifies it by the `phase` object the body moves
  (`decide`, `apply`, `commit`).
- Port surface: the body reaches exactly three members of `WatcherCoordPort`: `coord.db` (the UPSERT), `coord.run` and
  `coord.currentEpisode`, plus the two notice bodies in `rundefsTx.ts` (`queueLandingNoticeTx`, `queueRunlessNoticeTx`), which already take
  that port. The one member this wave added is `applyLandingControl`, pinned by `rings/watcher-store-port.test.ts` (reach equals port, no
  unused addition). `landingControlTx.ts` is in `HANDLE_HOLDERS` of `single-definition/core-vocab.test.ts` because it names `coord.db`.

**Precedent, checked.** The store already delegates bodies to same-ring companion modules: `rundefsTx.ts#queueLandingNoticeTx` and
`rundefsTx.ts#queueRunlessNoticeTx` take `coord: WatcherCoordPort` and run inside a caller's transaction, which is the closest match (and
the bodies this file reuses); `linkingStore.ts#setLinking`, `reviewCapStore.ts#liftReviewCapByCoordinator` and
`server/src/continuity/continuityStore.ts#mintGeneration` (outside `coord/`) take the `db` and open their own `tx(db, ...)` inside the companion; `practiceCasesStore.ts#openPracticeCase`
takes the `db` and opens no transaction of its own (`grep -n "BEGIN\|tx(\|transaction" server/src/coord/practiceCasesStore.ts` finds nothing); the store's `openPracticeCase` is a one-line delegate and its caller `casesLane.ts` calls it directly, so it does not run inside a store transaction. It is a precedent for a same-ring companion taking the `db`, not for a body run inside the store's `tx`. So the form is not new, but `applyLandingControlTx` differs from the db-taking
companions in that the store, not the companion, owns the transaction.

**Request.** The growth rule passing is not design approval. No further decomposition or exemption is requested, no port is widened and no
growth guard is edited. The next independent architecture review is asked to assess the existing split before coordinator acceptance.
Departure `control-tx-module` is added to `task-5.md` and `task-7.md`. Note (not changed here): `task-5.md`'s `control-tx-takes-port` bullet
still says the body reads `const { db } = coord`; fix round 1 of the final review wave changed that to plain `coord.db` (task-7 F6).

## R6

**Reconciliation.** `server/test/landing-notice-tx.test.ts` never existed: `git log --all --oneline -- server/test/landing-notice-tx.test.ts` is
empty, and the name is in no plan or task note (grep of `docs/` and `.superpowers/`: none). It was only a path in this worker's claim 4285,
taken in advance for a test that was never written, which the review brief then repeated. No such test is created. The notice bodies are
exercised through their callers' tests below.

**Notice-body callers** (source-to-test pairing is by the call graph read from the grep and the test names, not by a per-test trace; `grep -rlE "queueLandingNotice|queueRunlessNotice" server/src server/test`), with results measured this round
(`vitest run` of the five files below with the JSON reporter: rc 0, 5 files, 197 passed, 549 s; the seven-file mail run in R4 covers the rest):

| Source file | Test files that exercise it | Result |
|---|---|---|
| `src/coord/rundefsTx.ts` (defines the bodies) | all below | see rows |
| `src/coord/landingControlTx.ts` | `landing-next-mail.test.ts`, `landing-control.test.ts`, `landing-terminal-damage.test.ts`, `landing-entry-census.test.ts` (static) | R4 seven-file run green; `landing-terminal-damage` 40 passed (this round) |
| `src/watch.ts` | `landing-checks-lane.test.ts`, `mail-revive.test.ts`, `rings/watcher-store-port.test.ts` | 57, 41 and 23 passed |
| `src/coord/delegation-adoption.ts`, `src/coord/delegationAdoptStep.ts` | `delegation-wave3.integration.test.ts` | 36 passed |
| delivery-state guard under all of them | `mail-hardening.test.ts`, `mail-deliveries-writer.test.ts` | R4 seven-file run green (269 passed over its seven files) |

(`landing-next-mail`, `landing-control`, `landing-entry-census`, `mail-hardening` and `mail-deliveries-writer` have no per-file count of their own this
round: the R4 run reported only the seven-file total, 269.) The Task 5 grep-selected group was 134 passed over three files; the same three files
now count 57 + 41 + 36 = 134.

**Selections for the next reviewer** (from `server/`, foreground, each through `timeout 600s ccrc test -- ./node_modules/.bin/vitest run ...`):
- R1, R2, R3 and the pure landing rows: `test/landing-control.test.ts test/landing-next-mail.test.ts test/landing-terminal-damage.test.ts test/landed-lane.test.ts test/landed-decide.test.ts` (R2's final selection: 5 files, 221 passed, rc 0).
- The notice bodies and their callers: `test/landing-checks-lane.test.ts test/mail-revive.test.ts test/delegation-wave3.integration.test.ts test/landing-next-mail.test.ts test/landing-control.test.ts test/mail-hardening.test.ts test/mail-deliveries-writer.test.ts` (R4: 7 files, 269 passed).
- Terminal damage and the port census: `test/landing-terminal-damage.test.ts test/rings/watcher-store-port.test.ts`.
- The mutation rows M12 to M14: the exact `-t` selections are in R2's matrix (`landing-control -t 'mainRedNext|M13'` and the new real-store rows in `landing-next-mail`).
- Growth and rings for R5: `GROWTH_CHECK=1 ... vitest run test/growth-check.test.ts` and `test/landing-entry-census.test.ts test/single-definition/core-vocab.test.ts`.
- Do not use `vitest related src/coord/rundefsTx.ts` on this box: it was OOM-killed twice (R4).

**Stale note text corrected.** In `task-7.md`: the matrix header sentence "A row was re-run only when its mutated code changed after the
owner measured it." now has one added sentence saying the `Re-run` column records the state at the reviewed tip and that fix round 1 re-ran every row
except M8-M10; and the paragraph "Re-run decision: ..." has one sentence added at its end saying it records the state at the reviewed tip and that
fix round 1 re-ran the rows, both pointing at `fix-round-1.md#r2`. No column value and no existing text was changed.

## Absorb and gates

`git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD` exited 1 with a tree id and named
`server/test/single-definition/core-vocab.test.ts` (clause 16 trigger 1). The merge of origin/main 2b082b91f is commit 23ff069f8.
Its one conflict was additive: main added `pushOutboxStore.ts` to core-vocab's `HANDLE_HOLDERS`, and this branch added
`landingControlTx.ts`. Both entries and both comment lines are kept, and the merge makes no other edit.

Gates after the merge. Each ran from `server/` through `ccrc test --`, in the foreground, one at a time:
- **Landing and mail slice:** two runs of 8 files, 366 passed then 257 passed, both rc 0. A single 16-file run was killed by the slice's
  memory cap (6G, 2 OOM kills, rc 124) and is not counted.
- **Guards and censuses:** `single-definition`, `rings`, `coord-policy-rings`, `consolidation-census`, `mail-routes`, `anchors`, `citations`,
  `deviation-refs`, `dtbd`, `topology-clean` and `coordinator-skill`, 55 files, 2051 passed, rc 0.
- **Growth:** armed `growth-check` with `rings/watcher-store-port`, 118 passed, rc 0.
- **Typechecks:** the production project and the tests project (`test/tsconfig.tests.json`), each run directly, both rc 0.
- **`typecheck-tests.test.ts`:** run alone before the merge, it went red twice under fleet load. Neither run printed a type error, and both
  failures look like a killed child process:
  1. Every file was reported as in no project, which means the file listing died.
  2. The tests-project child exited -1 with empty output.

  The direct typecheck runs above stand in for this file here. The PR's fast run is the arbiter for it.
