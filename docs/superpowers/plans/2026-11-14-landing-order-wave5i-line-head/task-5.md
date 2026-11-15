# Task 5 note: apply measured main health and enqueue the exact next-to-land cue atomically

Implemented in `server/src/coord/landingNext.ts` (new, L1: the decider, the episode, tuple and body copy, the reason and
result types), `landingControlTx.ts` (new, L3: the transaction body and the SHA-256 digest), `store.ts` (the guard, the owned
transaction and the fence: `applyLandingControl`), `rundefsTx.ts` (`queueLandingNoticeTx`, `queueRunlessNoticeTx` extracted;
the public wrappers keep their one `tx`), `landingWrites.ts` and `landingEntry.ts` (the `creations` fact). No journal record,
route, ccd verb, wire op or exec-whitelist change.

## What it does
- `creations` is derived in `landingFactsOf` from the recovered subjects' recorded creation claim of the exact (id, project,
  pr) identity: `{id, seq, setBy}`. It is never read off the projection's `setBy`, which an order setter replaces.
- `nextLandingNoticeOf` asks `landingBindingOf` first (a binding refusal keeps its own word; a proven marker absence is
  `inert`), then names the recipient: a run-bound row needs the same-project run at `merging`, a claimant, and a current episode
  whose PR and head are the row's own; a no-run row needs a journal creation. Canonical tuple and copy as in the brief. A run
  with `waveOf` null is eligible and the null is carried to the envelope.
- `applyLandingControl`: guard, then one transaction: read facts, `mainRedNext`, one upsert of `mainRedHold` alone on an actual
  change, the pure decider against the effective flags, the subject `next-to-land:#<pr>:<64-hex digest>`, then the transaction-free
  notice body (the run arm's observation `landing:next:v1:<digest>` under the `episode` predicate is its durable dedupe; the
  no-run arm dedupes on the exact subject over every delivery state). A failure once a write began fences the landing entrances
  (`landing-db-apply` or `landing-db-commit`, `mayApply`), a read-phase failure is `landing-db-unavailable` with no fence, and
  `landingBoundary` runs only after the owned transaction unwound.

## Commands and outcomes (from `server/`, via `ccrc test --`, `--maxWorkers=2`)
- Step 4 red (before any source): `landing-control` 6 failed (`store.applyLandingControl is not a function`),
  `landing-next-mail` failed to load (`Cannot find module '../src/coord/landingNext.js'`).
- Step 5, the existing notice callers after the extraction and before the new caller (`landing-checks-lane`, `mail-revive`,
  `delegation-wave3.integration`): 3 files, 134 passed. The `vitest related src/coord/rundefsTx.ts` selection was not run: the
  three files above are the concrete callers found by grep, run directly.
- Green: `landing-control` + `landing-next-mail` + `landing-line-order`: 3 files, 138 passed; `landed-lane` (with
  single-definition): green.
- `test/single-definition` (directory): 32 files green after the structural-handle fix below.
- `test/rings test/coord-policy-rings`: 44 files green, 1 red (`wire-totality`, not from this task; see Limitations).
- Production `tsc --noEmit`: rc=0. `tsc --noEmit -p test/tsconfig.tests.json` alone: rc=0 (no OOM).
- `GROWTH_CHECK=1 growth-check` (73 passed, and it measured: `store.ts` base 5332 head 5381 delta +49): `GROWTH_OVER: (none)`,
  because the new L3 C5 file waives the growth (D-8563).

## Mutation rows (each restored from a saved copy, the selection re-run green)
| Row | Mutant | Selection | Actual failure |
|---|---|---|---|
| M19 (no-run arm) | `hasMailWithSubject` replaced by `hasOutstandingMail` in `queueRunlessNoticeTx` | `-t M19`: 2 failed | `expected { kind: 'queued', mailId: 2, …(2) } to deeply equal { kind: 'duplicate', …(1) }` for the `acked` and `rejected` rows (the `queued`/`delivered` rows pass, as they must) |
| M19 (run arm) | observation detail made unique per pass | `-t M19`: 4 failed | the same `queued` instead of `duplicate`, in all four delivery states |
| M20 base | base omitted from the tuple | `-t M20`: 1 failed | `expected { kind: 'duplicate', …(1) } to match object { kind: 'queued' }` (distinct base) |
| M20 episode | run episode id omitted | `-t M20`: 1 failed | same, in the same-ms re-entry row |
| M20 recipient | recipient omitted | `-t M20`: 1 failed | same, in the A to B to A row |
| M21 episode | episode PR/head comparison removed | `-t M21`: 1 failed | `expected { kind: 'queued', mailId: 1, …(2) } to deeply equal { kind: 'no-send', …(2) }` |
| M21 state | `run-not-merging` check removed | `-t M21`: 1 failed | `expected { kind: 'no-send', …(2) } to match object { kind: 'no-send', …(1) }`: no cue was sent (the observation's `episode` predicate answers `run-gone`), but the reason is `episode-changed`, not `run-not-merging` |
| M22 | the `!stamped.ok` throw removed in `insertSystemMailTx` | `-t M22`: 1 failed | `expected { kind: 'queued', mailId: 1, …(2) } to match object { kind: 'failure', …(1) }` |
| M27 | `this.landingFence = recovery` removed from the catch | `-t "fault\|COMMIT\|rolled back"`: 6 failed | `expected { ok: true, facts: { …(11) } } to match object { ok: false, error: 'landing-fenced' }` for the five faults and the COMMIT fault |
Also in this task: real-store cases in `landing-control.test.ts` for a pause before or between red and green (M14) and for
pending and unmeasured health (M13). This task recorded no mutant for either and measured no M12 mail half (the M21 rows
above are a different mutant); those rows are measured in `fix-round-1.md#r2`.

## Departures
- departure: port-member-deferred. `applyLandingControl` is NOT added to `WatcherCoordMember` in this task. The census
  (`rings/watcher-store-port.test.ts`) reds with `gone: applyLandingControl` while no watcher or lane file reaches the member,
  and the plan's own rule is to extend the port only for a member actually reached. Task 6 calls it from the radar sweep and adds
  the sorted entry then (between `advanceObserved` and `approvalById`).
- departure: control-tx-takes-port (ruling 1 bend, recorded). The reused transaction-free notice bodies take the
  `WatcherCoordPort`, so `applyLandingControlTx` takes it too; it receives no other private store field than the one
  `landingFactsInner` closure. There is no separate `db` parameter: the body reads the handle as `const { db } = coord`, because
  `single-definition/core-vocab.test.ts` (REACH) forbids the dotted `coord.db` spelling in any coord file but the store.
- departure: run-absent-word. `NextLandingFacts.run` is `NextLandingRun | 'missing' | 'unreadable'` (not a nullable run), so a
  run row that is not there answers `run-absent` and one that does not read (or names another run or project) answers
  `run-unreadable`. The literal is `'missing'` because `single-definition/vocabularies.test.ts` reserves the quoted
  `'absent' | 'unreadable'` pair for `shared/agent-protocol.ts`.
- departure: facts-literals. Adding the required `creations` fact meant adding `creations: []` to the facts literals of
  `landed-decide`, `landing-writes`, `landing-control` and the two pinned literals of `landing-facts-scope`.

## Limitations
- `rings/wire-totality.test.ts` is red on `LandingBindingReason` (`shared/landingLine.ts`): a literal union with no
  `Record<X, true>` map or guard. It comes from Task 3 and is untouched by this task; it needs a map and derived list in
  `shared/landingLine.ts` (not in this task's file list) or an exemption.
- Step 2 rows `after` (an order edge added after collection) and `recovery` (a recovery subject, then an identity conflict) are in
  the M21 block; M21 re-measured red on the episode mutant (`-t M21`: 1 failed, 6 passed) and green restored (7 passed).
- The earlier OOM note: the slice that reported it was `landing-control` + `landing-next-mail` (92 passed, exit 0). Re-run with
  `landing-line-order` added: 3 files, 140 passed, and the last run reported no OOM kill (an intermediate run of the same files
  also passed, with the slice reporting kills by other processes at exit 0).
- A run whose `waveOf` is null reaches the envelope as `(program:… wave N)` with no total; the pure rows assert the DTO and the real
  store row asserts the envelope.
- Verification slots were shared with other work; two runs were moved to the background by the harness and one reported an
  OOM kill in the test slice with exit 0.
- Fix round 1: `tsc --noEmit -p test/tsconfig.tests.json` alone was OOM-killed (rc=137) twice on the final tree; it was rc=0 on the tree before the round, and the changes since touch one test file and type-level source. Production `tsc --noEmit` is rc=0.
