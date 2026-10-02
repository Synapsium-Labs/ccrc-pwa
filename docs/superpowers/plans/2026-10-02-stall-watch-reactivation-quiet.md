# Stall watch: a run's re-activation restarts its clocks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: dispatched as a wave, `ccrc-worker`; to execute, `superpowers:executing-plans`
> (or `superpowers:subagent-driven-development`) with `superpowers:test-driven-development` for every code step. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a run moves from an idle state (`planned`, `awaiting-review`, `merging`, `closing`) back into
`ACTIVE_RUN_STATES`, the stall watch's quiet clocks, its episode key and the coordinator's 30 h cap start again from that
move, so the silence a worker kept while its run waited on the coordinator is never charged to it. The dialog and limit
caps keep today's clock and key (coordinator ruling): they measure the pane and the account, not the worker's silence.

**Architecture:** One new L1 input, `StallInput.activation`, derived in L1 (`stallReactivation`) from the primary run's
`run_events` rows, which the L4 lane already reads once per subject for the notices. The verdict joins its time to the
episode key, the wave-1 and marker quiet clocks and the coordinator-ball age. The dialog and limit caps keep today's
clock (`capQuietSince`, formula unchanged) and today's key (`StallFacts.capKeyMs`). An unprovable time is a distinct input word
that holds at §10 step 2c; no clock ever reads it as 0. No store method, migration, wire field or marker is added.

**Tech Stack:** TypeScript on Node `>=22.13.0`, Vitest, `node:sqlite` through `CoordStore`; `server/src/coord/stall.ts` (L1)
and `server/src/watch.ts`'s `sweepStalls` lane (L4).

**Spec:** `docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md` — §4.2 (the quiet arm, holds, the ball, the
ladder, the coordinator-ball cap), §5.1 ("Quiet with the marker"), §10 (evaluation order). This plan departs from §4.2's
and §5.1's clock formulas; see "Deviations found".

**Programme:** `stall-watch`, wave 3 (ledger `docs/superpowers/programs/stall-watch.md`). Deploy class: server. One PR
from a fresh child workspace. Wave 4 (skills and docs, `docs/superpowers/plans/2026-10-02-worker-stall-watch-w3.md`) also
edits README's stall-watch section; whichever lands second merges the other's sentence.

**Measured at:** `61b280fb5` (its tree is identical to `origin/main` `0db987074`), 2026-10-02. Every `file:line` below is
at that commit. Line numbers drift: find each anchor by its quoted text, not its number.

## Global Constraints

- `stall.ts` stays L1: inputs in, verdict out; no clock, fs, store or node builtin (`stall-vocabulary.test.ts` pins it).
  Its one permitted value import stays `../../../shared/api.js`.
- `watch.ts` measures and passes inputs; it never decides. Which `run_events` row is a re-activation is decided in L1.
- The row shape `StallEventRow` is an L2 port declared in `stall.ts`, by its consumer. `store.runEvents` already answers it
  structurally; it is not changed.
- No overloaded null at the seam: `StallActivation` keeps `reactivated`, `none` and `unmeasured` apart, and `unmeasured`
  holds. `none` and the literal default `{ kind: 'none' }` are the only "no term" spellings.
- Single source of truth: the active set is `ACTIVE_RUN_STATES` from `shared/api.ts`, imported, never a second list.
- **One** `store.runEvents(primary.id)` call per worker subject per sweep. Three existing `stall-sweep` cases stub it with
  `mockReturnValueOnce`; a second call would change what they test.
- Deviation numbers: issued by the coordinator at run-open and written in below: D-3788 is
  `quiet-restarts-on-reactivation`, D-3789 is `coord-ball-restarts-on-reactivation`. Any other departure you find is
  named in your wave-done mail by slug, and the coordinator assigns its number; never commit a `D-TBD-` placeholder
  (`server/test/dtbd.test.ts` reds one) and never write a number that was not issued.
- Tests run from `server/`, in the FOREGROUND, timeout at least 600000 ms:
  `./node_modules/.bin/vitest run test/<file>.test.ts`. Never bare `npx vitest`. A red in a known load flake
  (`session-hook`, `typecheck-tests` among them) is re-run in isolation before it is called a break.
- Fixture HOMEs only (`stall-sweep.test.ts`'s `mkTmp` rig). Nothing reads or writes a live registry or `coord.db`.
- Public repo: fixtures use `demo-*` session ids; no account label, host name, session id or docserver URL anywhere.
- Commit on this workspace's own branch only. Merge `origin/main` before handoff; never rebase.
- Out of scope: arming any marker, deploying, the spec's text (wave 4 owns docs), the `wait:` protocol (wave 4), and the
  session arms' timing (argued below).

## Review Focus

1. **Two active runs on one session, the older one sent back while the primary never left `working`.** The worker's
   silence on the primary is real, so the clock must not restart; the lane reads the PRIMARY run's events only. Pinned
   by Task 1's sweep case "a sibling run's send-back does not restart the clock" (mutation M11). Accepted residual
   (coordinator ruling), no code and no test: the mirror case, a NEWER run sent back while an older run of the same
   worker stayed `working`, does restart the clock and the episode, because the newer run is the primary again once it
   is a candidate. The coordinator has just engaged that worker, the same act for which a new dispatch on the newer run
   already restarts the clock today.
2. **The coordinator mails the fix-round brief BEFORE it advances the run** (the coordinator skill orders the advance
   first, but nothing enforces it). The clock runs from the later of the two. Pinned by Task 1's verdict case "a brief
   queued BEFORE the advance does not win".
3. **Rows already recorded under the pre-advance key when this ships** (run 187's standing shadow r1). They stay, never
   count as the new episode's r1 and never time its r2; the new episode records its own. Pinned at L1 ("rows recorded
   under the pre-advance key stay where they are") and in the lane ("a row recorded under the pre-advance key stays").
4. **A `run_events.at` the store never proved** (a REAL, a TEXT, a negative, past the safe range). Every quiet arm holds
   `unmeasured`; steps 2a and 2b (marker-unreadable, dead), which read only the key, still run. Pinned by the
   `stallReactivation` unmeasured rows, the property slot, and "an unmeasured re-activation holds every quiet clock".
5. **The `planned -> dispatched` row trailing `dispatchedAt` by milliseconds** (`markDispatched`'s default
   `at = Date.now()`, `server/src/coord/store.ts:2713-2714`, called without `at` at `:2331`; `advanceInner`'s own
   `Date.now()` at `:2191`). A run never sent back keeps today's key exactly. Pinned at L1 ("the first dispatch changes
   nothing") and in the lane ("a run never sent back keys as before") (mutation M6).

---

## The defect, measured

From the 2026-10-02 shadow review of every `stall-shadow:` row in `coord.db` (read-only), cross-checked by a second
reader. False-positive class 1, "re-activation inherits silence", two episodes:

- **E4, run 187.** Dispatched 2026-09-30T19:48:51.388Z (the `planned -> dispatched` row in the same ms). The worker's
  wave-done #2809 21:07:02.804Z; `dispatched -> working` 21:08:58.578Z; `working -> awaiting-review` 21:09:36.698Z. The
  worker's ordinary status #2811 21:10:32.578Z (episode key `1790802632578`); the coordinator's status #2814
  21:12:34.943Z ("keep holding", not `wait:`, so the ball stayed the worker's); the worker's Stop 21:13:21.557Z.
  `awaiting-review -> working` 2026-10-01T06:02:30.571Z; shadow r1 `stall-shadow:quiet:1:1790802632578` at
  06:02:34.392Z, 3.8 s later; the fix-round brief #2924 at 06:03:05.971Z, 35.4 s after the advance. Live, the r1 would
  have reached the worker before the brief, saying it had been quiet about 8 h 49 m and owed its next report. Both false.
- **E5, run 199.** Dispatched 2026-09-30T23:55:37.757Z. Wave-done #2909 2026-10-01T04:01:25.850Z;
  `working -> awaiting-review` 04:04:03.689Z; coordinator #2913 04:08:10.855Z; the worker's status #2914 04:08:37.795Z
  (key `1790827717795`); Stop 04:10:44.665Z. `awaiting-review -> working` 10:22:32.628Z; shadow r1 10:22:35.601Z, 2.97 s
  later; fix-round #2971 10:58:57.853Z; the worker's report #2972 11:07:24.379Z.

The mechanism, at `61b280fb5`: `stallFacts` keys the episode on
`Math.max(workerLast?.at ?? 0, waitLast?.at ?? 0, primary.dispatchedAt ?? 0)` (`server/src/coord/stall.ts:602`) and
starts quiet at `Math.max(w.live.since, workerLast?.at ?? 0, inboundLast?.at ?? 0, primary.dispatchedAt ?? 0)`
(`:604-606`). Neither has a term for the run's return to an active state. `stallCandidates` drops the run while it is
idle (`state NOT IN ${INACTIVE_RUN_STATES_SQL}`, `server/src/coord/store.ts:2951`), so nothing watches that interval, and
the first sweep after the advance (`STALL_SWEEP_MS`, 60 s, `server/src/watch.ts:142`) charges all of it. The coordinator
skill's send-back advances first and mails second (`ccd/coordinator-skill/SKILL.md:345-352`), so the inbound-mail term
cannot save it. The lane already reads the rows that would: `stallNoticesOf` walks `store.runEvents(runId)`
(`server/src/watch.ts:3271-3279`) and keeps only the stall details.

## The clocks, audited

Every clock in `stall.ts` and the lane that can measure from an event older than the run's latest re-activation:

| Clock | Where (`61b280fb5`) | Measures from | Decision |
|---|---|---|---|
| Episode key `episodeKeyMs` | `stall.ts:602` | worker's newest mail, coordinator's newest `wait:`, `dispatchedAt` | **Restart.** A send-back is a coordinator hand-off, the same act as a dispatch, which already opens an episode. Without it the quiet clock would restart but a pre-advance r1 row would still count as done and time r2 an hour on (Review Focus 3). The dialog and limit caps do not share it: they key on `StallFacts.capKeyMs`, the spec's formula (next rows but one). |
| Wave-1 quiet `quietSince` (r1) | `stall.ts:604-606` | live stamp, worker's last mail, newest inbound mail, `dispatchedAt` | **Restart.** The defect itself. |
| Caps' quiet `capQuietSince` and their key (dialog-cap, limit-cap) | `stall.ts:644-648`, read at `:926`; keyed at `:931`, `:934` | same terms as `quietSince`, any word; keyed on the episode key | **No change (coordinator ruling).** The caps measure a pane or account condition, not the worker's silence: a dialog that blocked the pane through the review still blocks the fix-round brief, and restarting the cap would leave the operator blind for 2 h on a sent-back worker (mail-stuck, the only backstop, is a wave-2 arm, dark until `stall-watch-w2-live`, and it needs a current marker). They keep today's KEY too, as `StallFacts.capKeyMs` (the spec's `max(worker's newest mail, coordinator's newest wait:, dispatchedAt)`): with the moved key the push would fire on the first sweep after the advance reading "this quiet episode opened 2026-10-01T06:02Z (0h 0m)" (measured on E4), a span below its own 2 h threshold; with `capKeyMs` it reads "… opened 2026-09-30T21:10Z (8h 52m)", true as today. Pinned by the two cap cases and the bodies case (mutations M3, M16). |
| Marker quiet `stallMarkQuiet` (marker r1, the `delegates` cap) | `stall.ts:768-772`, called at `:949` and `:1064` | the marker's `stopAt`, mail, `dispatchedAt` | **Restart.** §5.1's formula has the same gap, so arming `stall-watch-w2-live` would not close it. One site; its two callers (the verdict and r1's body) follow. |
| Coordinator-ball age (coord-ball cap) | `stall.ts:958` | `lastExchangeAt`, the newest relevant mail | **Restart** (`coord-ball-restarts-on-reactivation`). The common send-back leaves the worker's wave-done as the newest mail, so the ball stays the coordinator's after the advance. A run that sat 30 h at `awaiting-review` would draw "⚠ waiting › … no mail since …" within a sweep of the coordinator's own advance. The cross-check's site list (`:602`, `:604-606`, `:646`, `:770`) missed this one. |
| r2/r3 timing `rungDueAt`, rung accounting `rungDoneAt`, escalation on proof `stallProofDue` | `stall.ts:656-658`, `:686-694`, `:827-843` | the episode's own r1/r2 rows, the checks queued inside the episode (`last.at >= key`), orphan-e rows keyed after it (`n.key > key`) | **No change of their own.** Each reads the key, so a restarted key restarts them. |
| I2 back-off `stallBackoff` | `stall.ts:630-642` | not a time: the streak of `re stall-check: working` replies | **No change.** Any other worker mail already resets it, and a fix round always draws one. |
| coord-deaf | `stall.ts:786-794`, `:953-957` | the worker's ball-passing mail's own time, keyed on its id | **No change.** It measures an unacked delivery. An advance acks nothing, and after a send-back with the coordinator's ball the push's "the run waits on that coordinator" is true. |
| frozen | `stall.ts:444-449`, `:939-946` | the turn's start and the newest current hook event, keyed on the turn | **No change.** A hung tool call is a fact about the process, true whatever the run's state, and more urgent after a send-back. |
| dead, absent, marker-unreadable first-seen clocks | `watch.ts:3293-3296` (`stallSince`), pruned by `pruneStallMemory` `watch.ts:3317-3322` | the first sweep that saw the condition | **Already restart.** An idle run's worker is no candidate, so the prune drops its clocks the first sweep after the run leaves the active set. Their once-per-episode dedupe follows the key: a dead worker sent work again is reported again, as after a dispatch. |
| orphan E, failed, orphan D, mail-stuck (session verdicts) | `stall.ts:1485-1626` | the marker's `stopAt`/`restartAt`, a delivery's queue time; keyed on those or the delivery id | **No change.** Each is a fact about the session or one delivery, true whatever the run's state, also judged for coordinators (which have no run to re-activate), and none charges the worker's silence. Residual, recorded and not changed: a worker is judged only while its run is a candidate, so such a fact that arose during `awaiting-review` is first judged at the advance. |
| Texts: r1 "idle since", r2/r3/dead "no mail from the worker since" | `stallR1QuietFrom` `:1070-1072`, `stallSilence` `:1079-1082` | the quiet start and the key | **Follow.** r1 prints the restarted start (true: the loop has been idle at least since then). `stallSilence` prints the advance's time when it is the key; "no mail from the worker since" it stays true. Docstring amended only. |
| The lane's mail read horizon | `watch.ts:3108` | `now - BACKLOG_HORIZON_MS` | **No change.** It bounds session mail only; run mail is read UNBOUNDED (`store.ts:3859`), so a long `awaiting-review` never drops the worker's last mail. |

**The term, defined.** `activatedAt` is the `at` of the newest `run_events` row whose `toState` is in
`ACTIVE_RUN_STATES` and whose `fromState` is not, **other than the run's first such row**. The first is the dispatch
(`planned -> dispatched`, the only edge into `dispatched` in `RUN_TRANSITIONS`, `shared/api.ts:4235-4245`), which
`dispatchedAt` already measures from a separate `Date.now()`. So a run never sent back is untouched, and the term is a
RE-activation: `awaiting-review -> working` and `merging -> working` today (`shared/api.ts:4239-4240`). Review runs have
no such edge (`REVIEW_RUN_TRANSITIONS`), so they never carry one. It is read from the PRIMARY run only, the run whose
`dispatchedAt` the formula already uses (spec §4.2: "the older runs hold"); an older sibling's send-back keeps today's
clock. A newer sibling's send-back restarts it (Review Focus 1, accepted residual).

**What a moved key does to rows already recorded.** `run_events` stall rows are keyed `stall[-shadow]:<arm>:<rung>:<key>`
and deduped by exact detail (`queueStallNotice`, `recordStallObservation`). A re-activation moves the key forward
(`max()` only grows as rows append). Rows under the old key stay in `run_events` untouched (no migration, no delete), and
`rungDoneAt` filters by the current key, so they neither count as the new episode's rungs nor time them: no rung is
re-sent under its old detail (the dedupe would refuse it anyway), and the new episode's r1 is a new rung with a new
detail, sent only after 2 h of new silence. The old episode's pending r2/r3 are not lost but superseded: they would have
told the coordinator about silence the coordinator itself ended by advancing the run, and if the worker stays silent
the new episode escalates on its own clock (r1 at 2 h, r2 and r3 an hour apart). At deploy, only runs whose newest
relevant event is a re-activation with no later worker mail or `wait:` change key; each such open episode can draw one
new r1 under its new key, which is the fix's intent. The dialog and limit caps' rows are keyed on `capKeyMs`, which no
re-activation moves, so they keep exactly today's once-per-episode behaviour.

## File Structure

- `server/src/coord/stall.ts` — `StallEventRow` (port), `StallActivation`, `stallReactivation`, `StallInput.activation`,
  `stallReactivatedAt`, `StallFacts.capKeyMs`; the term joins four clock sites (the key, the wave-1 and marker quiet
  clocks, the coord-ball age); the caps take `capKeyMs`; step 2c holds `unmeasured`; four docstrings amended.
- `server/src/watch.ts` — `judgeStall` reads `store.runEvents(primary.id)` once and passes it to `stallNoticesOf` (now
  taking the rows) and `stallReactivation`; one import name.
- `server/test/stall-verdict.test.ts` — factory field, one property slot, three existing `stallFacts` literals gain
  `capKeyMs`, the `stallReactivation` table, E4 (with the two cap pins), E5, the first-dispatch row (Task 1), the
  coord-ball rows (Task 2).
- `server/test/stall-bodies.test.ts` — factory field; r1's text after a send-back; the dialog cap's text after one.
- `server/test/stall-session.test.ts`, `server/test/stall-backoff.test.ts` — factory field only.
- `server/test/stall-sweep.test.ts` — the lane against a real store: E4 end to end, the old-key row, the dispatch-row lag,
  the sibling run, the unreadable read.
- `README.md` — one sentence in the stall-watch paragraph, and one clause corrected beside it.
- `.superpowers/sdd/2026-10-02-stall-watch-reactivation-quiet/mutate.py` — the mutation runner (gitignored; never
  committed).

**Citations this moves.** Measured with `git grep -nE '(stall|watch)\.ts`?:[0-9]'`: README and the two compaction-card
documents (the citation instrument's whole corpus, `server/test/session-hook.test.ts`) cite no `stall.ts` or `watch.ts`
line. Two source comments cite `watch.ts` lines: `server/src/coord/reclaim.ts:158` cites `watch.ts:3104`, above this
plan's first `watch.ts` edit, and stays exact; `server/src/coord/store.ts:6076` cites `watch.ts:3452`, which already
points away from its subject (the ask hold's `actions !== null` gate is at `watch.ts:4972`) and no instrument reads it.
Dated plans and specs cite `watch.ts` lines as snapshots. Nothing to repair; Task 2's last step re-runs the instrument.

## Baseline (measured at `61b280fb5`)

| Suite (from `server/`) | Result |
|---|---|
| `stall-verdict` | 241 passed |
| `stall-session` | 89 passed |
| `stall-bodies` | 152 passed |
| `stall-store` | 53 passed |
| `stall-vocabulary` | 178 passed |
| `stall-backoff` | 17 passed |
| `stall-sweep` | 96 passed |
| `single-definition` | 259 passed |
| `topology-clean` | 55 passed |
| `deviation-refs` | 31 passed |
| `typecheck-tests` | 12 passed |
| citation instrument (below) | 7 passed, 328 skipped |
| `./node_modules/.bin/tsc --noEmit -p .` | clean |

The citation instrument: `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'`.

Every red and green count below was measured by applying this plan's exact code to a copy of `61b280fb5`.

---

### Task 1: The worker's clocks restart on re-activation

**Files:**
- Modify: `server/src/coord/stall.ts` (`:1`, `:473-483`, `:535-536`, `:591-608`, `:644-645`, `:768-772`, `:861-881`, `:907-910`, `:926-934`, `:949`, `:1064`, `:1074-1078`)
- Modify: `server/src/watch.ts` (`:56`, `:3113-3117`, `:3271-3274`)
- Modify: `README.md` (`:2547-2549`, `:2564-2567`)
- Test: `server/test/stall-verdict.test.ts`, `server/test/stall-bodies.test.ts`, `server/test/stall-session.test.ts`, `server/test/stall-backoff.test.ts`, `server/test/stall-sweep.test.ts`

**Interfaces:**
- Consumes: `ACTIVE_RUN_STATES` (`shared/api.ts:4275`); `CoordStore.runEvents(runId): { at: number; fromState: string; toState: string; causedBy: string; detail: string | null }[]` (`server/src/coord/store.ts:3012`).
- Produces (all exported from `server/src/coord/stall.ts`):
  - `interface StallEventRow { readonly at: number; readonly fromState: string; readonly toState: string }`
  - `type StallActivation = { kind: 'reactivated'; at: number } | { kind: 'none' } | { kind: 'unmeasured' }` (readonly fields)
  - `function stallReactivation(events: readonly StallEventRow[]): StallActivation`
  - `StallInput.activation: StallActivation` (REQUIRED: every literal must carry it)
  - `StallFacts.capKeyMs: number` — the dialog and limit caps' key, without the re-activation term
  - module-private `function stallReactivatedAt(input: StallInput): number`, which Task 2 uses.

- [ ] **Step 0: Preconditions**

```bash
git status --short                      # clean
git log --oneline -1                    # your workspace branch, from origin/main
git grep -nE 'D-TBD-[a-z0-9]|D-<[nm]>' -- docs/superpowers/plans/2026-10-02-stall-watch-reactivation-quiet.md   # prints nothing: numbers issued
cd server && npm ci
```

Run the baseline table above and confirm each count before any edit.

- [ ] **Step 1: Write the failing tests**

1a. `server/test/stall-verdict.test.ts`, the type import at the top: add `StallActivation`.

```ts
import type {
  CoordinatorState, LiveWordRead, StallActivation, StallArm, StallArming, StallHold, StallInput, StallMailRow, StallMode,
  StallNotice, StallR3Cause, StallRunRow, StallSubject, StallVerdict, StallWorker,
} from '../src/coord/stall.js';
```

1b. The `Over` interface and the `stallInput` factory: one optional field, defaulting to `{ kind: 'none' }`.

```ts
interface Over {
  primary?: Partial<StallRunRow>; runs?: readonly StallRunRow[]; subject?: StallSubject; worker?: StallWorker;
  mail?: readonly StallMailRow[]; notices?: readonly StallNotice[]; arming?: StallArming;
  coordinationPaused?: boolean; coordinator?: CoordinatorState | null; activation?: StallActivation;
}
function stallInput(over: Over = {}): StallInput {
  const primary = runRow(over.primary);
  return {
    subject: over.subject ?? { primary, runs: over.runs ?? [primary] },
    worker: over.worker ?? workerAt(),
    mail: over.mail ?? [],
    notices: over.notices ?? [],
    arming: over.arming ?? ARMED,
    coordinationPaused: over.coordinationPaused ?? false,
    coordinator: over.coordinator ?? null,
    activation: over.activation ?? { kind: 'none' },
  };
}
```

1c. The §10 property test: `SLOTS` gains an `activation` field and one slot, and the loop passes it.

```ts
const SLOTS: ReadonlyArray<{ slot: string; base: Partial<PresentWorker>; set: Partial<PresentWorker>; run?: Partial<StallRunRow>; activation?: StallActivation }> = [
```

After the `'a null dispatchedAt'` row:

```ts
  { slot: 'a re-activation whose time is unmeasured', base: {}, set: {}, activation: { kind: 'unmeasured' } },
```

And the loop body:

```ts
  it.each(SLOTS)('$slot', ({ base, set, run, activation }) => {
    const control = stallVerdict(stallInput({ worker: workerAt(base), mail }), NOW);
    expect(control, 'control: without the slot the verdict is something else').not.toEqual(hold('unmeasured'));
    expect(stallVerdict(stallInput({ worker: workerAt({ ...base, ...set }), primary: run, mail, activation }), NOW)).toEqual(hold('unmeasured'));
  });
```

1c2. The three `stallFacts(...)` literals in the "stallFacts: the ball, the episode key and the quiet clock" describe
gain `capKeyMs` (equal to `episodeKeyMs` there: none of them carries a re-activation):

```ts
    expect(facts([])).toEqual({
      ball: 'worker', episodeKeyMs: D, capKeyMs: D, quietSince: D + 5 * H, workerLast: null, inboundLast: null, lastExchangeAt: null,
    });
```

```ts
      ball: 'worker', episodeKeyMs: D + H, capKeyMs: D + H, quietSince: D + 2 * H, workerLast: own, inboundLast: null, lastExchangeAt: D + H,
```

```ts
      ball: 'worker', episodeKeyMs: reply.at, capKeyMs: reply.at, quietSince: D + 4 * H + 12 * MIN, workerLast: reply, inboundLast: null, lastExchangeAt: reply.at,
```

1d. Append to the END of `server/test/stall-verdict.test.ts` (it uses `markOf`, `w2`, `W2_LIVE`, `dead` and the other
helpers the file defines further up; the file already imports mid-file, so the two imports below follow its own idiom):

```ts
// ── quiet-restarts-on-reactivation (D-3788): a run that comes back into an active state starts its clocks again ─────
// The golden fixtures are the two shadow episodes measured in the live census (coord.db `runs`, `run_events` and
// `mail`; ids and times as recorded, the sessions renamed to this file's fixtures). E4 is run 187, E5 is run 199.
import { stallReactivation } from '../src/coord/stall.js';
import type { StallEventRow } from '../src/coord/stall.js';

const ev = (at: number, fromState: string, toState: string): StallEventRow => ({ at, fromState, toState });
const reactivated = (at: number): StallActivation => ({ kind: 'reactivated', at });

describe('stallReactivation: the newest entry into ACTIVE_RUN_STATES after the first (quiet-restarts-on-reactivation)', () => {
  const D = t('2026-09-30T19:48:51.388Z');
  const DISPATCH = ev(D, 'planned', 'dispatched');
  const WORKING = ev(D + H, 'dispatched', 'working');
  const TO_REVIEW = ev(D + 2 * H, 'working', 'awaiting-review');

  it('no events, the dispatch alone, or dispatch then working: none', () => {
    expect(stallReactivation([])).toEqual({ kind: 'none' });
    expect(stallReactivation([DISPATCH])).toEqual({ kind: 'none' });
    expect(stallReactivation([DISPATCH, WORKING])).toEqual({ kind: 'none' });
  });

  it('the dispatch row is never a re-activation, even when it trails dispatchedAt by milliseconds', () => {
    // markDispatched and advanceInner each read their own Date.now(): the planned -> dispatched row can land after
    // dispatchedAt. It is the run's first entry, and dispatchedAt already measures it.
    expect(stallReactivation([ev(D + 3, 'planned', 'dispatched'), ev(D + H, 'dispatched', 'working')])).toEqual({ kind: 'none' });
  });

  it.each([
    ['awaiting-review', 'working'],
    ['merging', 'working'],
  ])('a send-back %s -> %s is a re-activation, at its own time', (from, to) => {
    expect(stallReactivation([DISPATCH, WORKING, TO_REVIEW, ev(D + 9 * H, from, to)])).toEqual(reactivated(D + 9 * H));
  });

  it('two send-backs: the newest one', () => {
    const events = [DISPATCH, WORKING, TO_REVIEW, ev(D + 3 * H, 'awaiting-review', 'working'),
      ev(D + 4 * H, 'working', 'awaiting-review'), ev(D + 7 * H, 'awaiting-review', 'working')];
    expect(stallReactivation(events)).toEqual(reactivated(D + 7 * H));
  });

  it('an exit after the re-activation does not move it, and a transition inside the active set is no entry', () => {
    const events = [DISPATCH, WORKING, TO_REVIEW, ev(D + 3 * H, 'awaiting-review', 'working'), ev(D + 4 * H, 'working', 'awaiting-review')];
    expect(stallReactivation(events)).toEqual(reactivated(D + 3 * H));
    expect(stallReactivation([DISPATCH, ev(D + H, 'dispatched', 'working'), ev(D + 2 * H, 'dispatched', 'working')])).toEqual({ kind: 'none' });
  });

  it('observation rows (fromState === toState) are never entries, whatever their state', () => {
    const events = [DISPATCH, WORKING, ev(D + 5 * H, 'working', 'working'), ev(D + 6 * H, 'planned', 'planned')];
    expect(stallReactivation(events)).toEqual({ kind: 'none' });
  });

  it('a fromState this build cannot name, into an active state, is an entry; an unnamed toState is not', () => {
    expect(stallReactivation([DISPATCH, WORKING, ev(D + 5 * H, 'parked-by-a-newer-build', 'working')])).toEqual(reactivated(D + 5 * H));
    expect(stallReactivation([DISPATCH, WORKING, ev(D + 5 * H, 'awaiting-review', 'parked-by-a-newer-build')])).toEqual({ kind: 'none' });
  });

  it.each([
    ['not an integer', 1.5],
    ['NaN', Number.NaN],
    ['negative', -1],
    ['past the safe range', Number.MAX_SAFE_INTEGER + 2],
    ['a string the store did not prove', '1790834550571' as unknown as number],
  ])('the newest entry\'s time %s: unmeasured, never 0', (_label, at) => {
    expect(stallReactivation([DISPATCH, WORKING, TO_REVIEW, ev(at, 'awaiting-review', 'working')])).toEqual({ kind: 'unmeasured' });
  });

  it('an unprovable time on an OLDER entry does not touch the newest one', () => {
    const events = [DISPATCH, WORKING, TO_REVIEW, ev(Number.NaN, 'awaiting-review', 'working'),
      ev(D + 4 * H, 'working', 'awaiting-review'), ev(D + 7 * H, 'awaiting-review', 'working')];
    expect(stallReactivation(events)).toEqual(reactivated(D + 7 * H));
  });
});

describe('E4 (run 187): a send-back after 8 h 53 m at awaiting-review starts the quiet clock and the episode again', () => {
  const E4 = {
    dispatched: t('2026-09-30T19:48:51.388Z'),  // runs.dispatchedAt; the planned -> dispatched row, same ms
    w2811: t('2026-09-30T21:10:32.578Z'),       // the worker's ordinary status: the pre-advance episode key
    c2814: t('2026-09-30T21:12:34.943Z'),       // the coordinator's status, "keep holding": inbound, not wait:
    stop: t('2026-09-30T21:13:21.557Z'),        // the worker's Stop: its live stamp from then on
    react: t('2026-10-01T06:02:30.571Z'),       // awaiting-review -> working (run_events)
    fire: t('2026-10-01T06:02:34.392Z'),        // the shadow r1 row, 3.8 s after the advance
    brief: t('2026-10-01T06:03:05.971Z'),       // the fix-round brief #2924
  };
  const MAIL = [
    mailRow(2809, t('2026-09-30T21:07:02.804Z'), WORKER, 'coordinator', 'status', WAVE_DONE_SUBJECT, 187),
    mailRow(2811, E4.w2811, WORKER, 'coordinator', 'status', 'claim still holds', 187),
    mailRow(2814, E4.c2814, COORD, WORKER, 'status', 'keep holding', 187),
  ];
  const BRIEF = mailRow(2924, E4.brief, COORD, WORKER, 'status', 'fix-round', 187);
  const e4 = (over: Over = {}): StallInput => stallInput({
    primary: { id: 187, dispatchedAt: E4.dispatched }, worker: workerAt({ live: liveWord('idle', E4.stop) }),
    mail: MAIL, activation: reactivated(E4.react), ...over,
  });

  it('CONTROL: with no re-activation term the measured input fires r1 at the measured time, keyed on #2811 (the defect)', () => {
    expect(stallVerdict(e4({ activation: { kind: 'none' } }), E4.fire)).toEqual(r1(E4.w2811));
  });

  it('the first sweeps after the advance answer none, before and after the brief lands', () => {
    expect(stallVerdict(e4(), E4.fire)).toEqual(NONE);
    expect(stallVerdict(e4({ mail: [...MAIL, BRIEF] }), E4.brief + MIN)).toEqual(NONE);
  });

  it('r1 falls due only after 2 h of NEW silence: from the brief when one came, keyed on the advance', () => {
    const briefed = e4({ mail: [...MAIL, BRIEF] });
    expect(stallVerdict(briefed, E4.brief + STALL_QUIET_MS - 1)).toEqual(NONE);
    expect(stallVerdict(briefed, E4.brief + STALL_QUIET_MS)).toEqual(r1(E4.react));
  });

  it('with no brief at all, r1 falls due 2 h after the advance itself', () => {
    expect(stallVerdict(e4(), E4.react + STALL_QUIET_MS - 1)).toEqual(NONE);
    expect(stallVerdict(e4(), E4.react + STALL_QUIET_MS)).toEqual(r1(E4.react));
  });

  it('a brief queued BEFORE the advance does not win: the clock runs from the later of the two', () => {
    const early = { ...BRIEF, at: E4.react - 30_000 };
    expect(stallVerdict(e4({ mail: [...MAIL, early] }), E4.react + STALL_QUIET_MS - 1)).toEqual(NONE);
    expect(stallVerdict(e4({ mail: [...MAIL, early] }), E4.react + STALL_QUIET_MS)).toEqual(r1(E4.react));
  });

  it('rows recorded under the pre-advance key stay where they are: they neither count as this episode\'s r1 nor time its r2', () => {
    // The shadow r1 the census recorded, keyed on #2811. Without the term it counts as done, and r2 falls due an hour
    // after it (the lane is asked to measure the coordinator). With the term it is another episode's row.
    const OLD_R1 = notice('shadow', 'quiet', 1, E4.w2811, E4.fire);
    expect(stallVerdict(e4({ arming: SHADOW, notices: [OLD_R1], activation: { kind: 'none' } }), E4.fire + STALL_ESCALATE_MS))
      .toEqual({ act: 'measure-coordinator', coordinatorId: COORD });
    expect(stallVerdict(e4({ arming: SHADOW, notices: [OLD_R1] }), E4.fire + STALL_ESCALATE_MS)).toEqual(NONE);
    expect(stallVerdict(e4({ arming: SHADOW, notices: [OLD_R1] }), E4.react + STALL_QUIET_MS)).toEqual(r1(E4.react));
  });

  it('a worker mail after the advance keys the next episode on itself, as before', () => {
    const wd = mailRow(2927, t('2026-10-01T06:18:27.727Z'), WORKER, 'coordinator', 'status', WAVE_DONE_SUBJECT, 187);
    expect(stallFacts(e4({ mail: [...MAIL, BRIEF, wd] })).episodeKeyMs).toBe(wd.at);
  });

  it('the dialog cap (2b) keeps today\'s clock and key: a dialog up through the review is pushed on the first sweep after the advance', () => {
    // Coordinator ruling: the caps measure the pane or the account, not the worker's silence, and a dialog that blocked
    // the pane through the review still blocks the fix-round brief. Keyed on #2811, so its text's span stays true.
    const menu = (activation: StallActivation): StallInput => e4({ worker: workerAt({ live: liveWord('waiting', E4.stop) }), activation });
    expect(stallVerdict(menu(reactivated(E4.react)), E4.fire)).toEqual(capOf('dialog-cap', E4.w2811));
    expect(stallVerdict(menu(reactivated(E4.react)), E4.fire)).toEqual(stallVerdict(menu({ kind: 'none' }), E4.fire));
  });

  it('the limit cap (hold 3) keeps today\'s clock and key: 13 h quiet before the advance still counts', () => {
    const late = E4.stop + 13 * H;   // chosen: the measured shape, moved past LIMIT_HOLD_CAP_MS
    const limited = (activation: StallActivation): StallInput =>
      e4({ worker: workerAt({ live: liveWord('idle', E4.stop), limits: { five: 100, seven: 40 } }), activation });
    expect(stallVerdict(limited(reactivated(late)), late + 4_000)).toEqual(capOf('limit-cap', E4.w2811));
    expect(stallVerdict(limited(reactivated(late)), late + 4_000)).toEqual(stallVerdict(limited({ kind: 'none' }), late + 4_000));
  });

  it('the ladder and the caps key apart: the episode key moves to the advance, the caps\' key stays on #2811', () => {
    const f = stallFacts(e4());
    expect({ episodeKeyMs: f.episodeKeyMs, capKeyMs: f.capKeyMs }).toEqual({ episodeKeyMs: E4.react, capKeyMs: E4.w2811 });
  });

  it('the marker clock (§5.1) restarts with it: a Stop 8 h before the advance draws no r1 after it', () => {
    const mark = markOf({ at: E4.stop, turnAt: E4.stop - 10 * MIN, stopAt: E4.stop });
    const marked = (activation: StallActivation): StallInput => ({ ...e4({ arming: W2_LIVE, activation }), w2: w2({ mark }) });
    expect(stallVerdict(marked({ kind: 'none' }), E4.fire)).toEqual(r1(E4.w2811));
    expect(stallVerdict(marked(reactivated(E4.react)), E4.fire)).toEqual(NONE);
    expect(stallVerdict(marked(reactivated(E4.react)), E4.react + STALL_QUIET_MS)).toEqual(r1(E4.react));
  });

  it('an unmeasured re-activation holds every quiet clock, while 2a and 2b, which read only the key, still run', () => {
    expect(stallVerdict(e4({ activation: { kind: 'unmeasured' } }), E4.fire)).toEqual(hold('unmeasured'));
    // A worker gone from the tick past DEAD_GRACE_MS: the dead arm (step 2b) precedes the hold, keyed as before the term.
    const gone = { ...e4({ arming: W2_LIVE, worker: { present: false }, activation: { kind: 'unmeasured' } }), w2: w2({ absentSince: E4.fire - DEAD_GRACE_MS }) };
    expect(stallVerdict(gone, E4.fire)).toEqual(dead(E4.w2811, 'registry-absent'));
  });
});

describe('E5 (run 199): a send-back 2.97 s before the shadow r1, the brief 36 min later', () => {
  const E5 = {
    dispatched: t('2026-09-30T23:55:37.757Z'),
    c2913: t('2026-10-01T04:08:10.855Z'),   // the coordinator's "hold remains binding", not wait:
    w2914: t('2026-10-01T04:08:37.795Z'),   // the worker's ordinary status: the pre-advance key
    stop: t('2026-10-01T04:10:44.665Z'),    // the worker's Stop
    react: t('2026-10-01T10:22:32.628Z'),   // awaiting-review -> working
    fire: t('2026-10-01T10:22:35.601Z'),    // the shadow r1 row
    brief: t('2026-10-01T10:58:57.853Z'),   // fix-round #2971
    w2972: t('2026-10-01T11:07:24.379Z'),   // the worker's report on the fix round
  };
  const MAIL = [
    mailRow(2909, t('2026-10-01T04:01:25.850Z'), WORKER, 'coordinator', 'status', WAVE_DONE_SUBJECT, 199),
    mailRow(2913, E5.c2913, COORD, WORKER, 'status', 'hold remains binding', 199),
    mailRow(2914, E5.w2914, WORKER, 'coordinator', 'status', 'hold acked', 199),
  ];
  const e5 = (over: Over = {}): StallInput => stallInput({
    primary: { id: 199, dispatchedAt: E5.dispatched }, worker: workerAt({ live: liveWord('idle', E5.stop) }),
    mail: MAIL, activation: reactivated(E5.react), ...over,
  });

  it('CONTROL: with no re-activation term the measured input fires r1 at the measured time, keyed on #2914', () => {
    expect(stallVerdict(e5({ activation: { kind: 'none' } }), E5.fire)).toEqual(r1(E5.w2914));
  });

  it('none at the measured fire, none up to the brief, none after it until the worker reports', () => {
    expect(stallVerdict(e5(), E5.fire)).toEqual(NONE);
    expect(stallVerdict(e5(), E5.brief - 1)).toEqual(NONE);
    const briefed = e5({ mail: [...MAIL, mailRow(2971, E5.brief, COORD, WORKER, 'status', 'fix round', 199)] });
    expect(stallVerdict(briefed, E5.w2972 - 1)).toEqual(NONE);
  });
});

describe('quiet-restarts-on-reactivation: the first dispatch changes nothing', () => {
  it('a planned -> dispatched row 3 ms after dispatchedAt leaves the base verdict and its facts exactly as they were', () => {
    const events = [ev(RUN67_DISPATCHED + 3, 'planned', 'dispatched'), ev(RUN67_DISPATCHED + H, 'dispatched', 'working')];
    const input = stallInput({ activation: stallReactivation(events) });
    expect(stallVerdict(input, NOW)).toEqual(r1(RUN67_DISPATCHED));
    expect(stallFacts(input)).toEqual(stallFacts(stallInput()));
  });
});
```

1e. `server/test/stall-bodies.test.ts`: the `s4` factory carries the field.

```ts
const s4 = (over: Partial<StallInput> = {}, primary: StallRunRow = run67): StallInput => ({
  subject: { primary, runs: [primary] }, worker: worker(), mail: [m2509, m2510], notices: [],
  arming: { disabled: false, live: true, escalate: false }, coordinationPaused: false, coordinator: null,
  activation: { kind: 'none' }, ...over,
});
```

Append to the END of `server/test/stall-bodies.test.ts`:

```ts
// `quiet-restarts-on-reactivation` (D-3788): S4's run went to awaiting-review after #2510 and came back to working at
// REACT. r1 counts its quiet from the advance, so its subject and body never charge the worker the hours the run spent
// waiting on its coordinator.
describe('r1 after a send-back names the restarted clock (quiet-restarts-on-reactivation)', () => {
  const REACT = T('2026-09-29T08:00:00Z');   // chosen: 10 h after S4's Stop
  const back = s4({ activation: { kind: 'reactivated', at: REACT } });

  it('the verdict fires r1 two hours after the advance, keyed on it, and not a millisecond before', () => {
    expect(stallVerdict(back, REACT + 2 * 3_600_000 - 1)).toEqual({ act: 'none' });
    expect(stallVerdict(back, REACT + 2 * 3_600_000)).toEqual({ act: 'notify', arm: 'quiet', rung: 1, key: REACT, to: 'worker' });
  });

  it('its subject and its quiet line count from the advance, never from the Stop before it', () => {
    const text = stallCheckMail(back, stallFacts(back), REACT + 2 * 3_600_000);
    expect(text.subject).toBe('stall-check: run 67 — quiet 2h 0m, owed: reply to #2510');
    expect(text.body.split('\n')[1]).toBe('Your main loop has been idle since 2026-09-29T08:00:00Z (2h 0m). Your last mail on this run: #2509 status at 21:17:43Z. Newest mail to you on this run: #2510 answer at 21:19:17Z.');
  });
});

// The dialog and limit caps keep today's clock and key (coordinator ruling on `quiet-restarts-on-reactivation`, D-3788):
// pushed on the first sweep after a send-back, their text still names the episode the worker's last mail opened, so
// the span it prints is at least the cap's own threshold, as before.
describe('the dialog cap after a send-back keeps today\'s key, so the span it prints stays true', () => {
  const REACT = T('2026-09-29T08:00:00Z');   // chosen: 10 h after S4's Stop
  const menu = s4({
    worker: worker({ live: { ok: true, word: 'waiting', since: IDLE_SINCE }, dialogPending: true }), arming: escalated,
    activation: { kind: 'reactivated', at: REACT },
  });

  it('pushes on the first sweep after the advance, keyed on the worker\'s last mail, with the episode\'s true span', () => {
    const at = REACT + 4_000;
    const n = stallVerdict(menu, at);
    expect(n).toEqual({ act: 'notify', arm: 'dialog-cap', rung: 1, key: EPISODE, to: 'operator' });
    expect(stallPushText(menu, stallFacts(menu), n as StallNotify, at).body).toContain('this quiet episode opened 2026-09-28T21:17Z (10h 42m).');
  });
});
```

1f. `server/test/stall-session.test.ts`, the one `StallInput` literal (`runInput`, in the "hold 2b" describe):

```ts
  const runInput: StallInput = {
    subject: { primary: run, runs: [run] }, worker: w, mail: [], notices: [], arming: W2, coordinationPaused: false,
    coordinator: null, activation: { kind: 'none' },
  };
```

1g. `server/test/stall-backoff.test.ts`, the `input` factory's literal line:

```ts
    arming: over.arming ?? ARMED, coordinationPaused: false, coordinator: null, activation: { kind: 'none' },
```

1h. Append to the END of `server/test/stall-sweep.test.ts`:

```ts

// ── quiet-restarts-on-reactivation (D-3788): the lane reads the re-activation from the run's own events ─────────────
describe('sweepStalls: a send-back starts the clocks again (quiet-restarts-on-reactivation)', () => {
  // E4's measured shape (run 187) on this file's fixtures: dispatched, the worker's wave-done, working, awaiting-review,
  // the worker's ordinary status #2811, the coordinator's "keep holding", the worker's Stop, then awaiting-review ->
  // working 8 h 53 m later, the shadow r1's measured time 3.8 s after it, and the fix-round brief 35.4 s after it.
  const E4 = {
    dispatched: Date.parse('2026-09-30T19:48:51.388Z'), waveDone: Date.parse('2026-09-30T21:07:02.804Z'),
    working: Date.parse('2026-09-30T21:08:58.578Z'), awaiting: Date.parse('2026-09-30T21:09:36.698Z'),
    w2811: Date.parse('2026-09-30T21:10:32.578Z'), c2814: Date.parse('2026-09-30T21:12:34.943Z'),
    stop: Date.parse('2026-09-30T21:13:21.557Z'), react: Date.parse('2026-10-01T06:02:30.571Z'),
    fire: Date.parse('2026-10-01T06:02:34.392Z'), brief: Date.parse('2026-10-01T06:03:05.971Z'),
  };
  const fromWorker = (coord: CoordStore, runId: number, ms: number, subject: string): void => {
    at(ms);
    coord.insertMail({ fromId: WORKER, fromUuid: UUID, toId: 'coordinator', runId, kind: 'status', subject, body: 'b', artifacts: [] });
  };
  const toWorker = (coord: CoordStore, runId: number, ms: number, subject: string): void => {
    at(ms);
    coord.insertMail({ fromId: COORD, fromUuid: COORD_UUID, toId: WORKER, runId, kind: 'status', subject, body: 'b', artifacts: [] });
  };
  const advanceAt = (coord: CoordStore, runId: number, ms: number, to: Parameters<CoordStore['advance']>[1]): void => {
    at(ms);
    const adv = coord.advance(runId, to, 'coordinator');
    if (!adv.ok) throw new Error(`advance refused: ${JSON.stringify(adv)}`);
  };
  /** One work run dispatched at `dispatchedAt`, its planned -> dispatched row written `lagMs` later. */
  const dispatchAt = (coord: CoordStore, program: string, dispatchedAt: number, lagMs = 0): number => {
    at(dispatchedAt);
    const opened = coord.openRun({ program, title: program, project: 'demo', wave: 2, waveOf: 4, claimedBy: COORD });
    if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
    coord.markDispatched(opened.id, WORKER, `${WORKER}-ws`, `ws/${WORKER}`, false, dispatchedAt);
    advanceAt(coord, opened.id, dispatchedAt + lagMs, 'dispatched');
    return opened.id;
  };
  /** E4 through the worker's Stop; the run sits at awaiting-review. */
  const seedE4 = (h: Harness, coord: CoordStore): number => {
    seedLiveState(h.home, { statusUpdatedAt: E4.stop });
    const runId = dispatchAt(coord, 'demo-program', E4.dispatched);
    fromWorker(coord, runId, E4.waveDone, WAVE_DONE_SUBJECT);
    advanceAt(coord, runId, E4.working, 'working');
    advanceAt(coord, runId, E4.awaiting, 'awaiting-review');
    fromWorker(coord, runId, E4.w2811, 'claim still holds');
    toWorker(coord, runId, E4.c2814, 'keep holding');
    return runId;
  };
  const sweepAt = async (w: FleetWatcher, ms: number, names: readonly string[]): Promise<void> => {
    at(ms);
    await w.sweepStalls([fleetRow(WORKER)], names, tickOf());
  };

  it('E4: no stall-check on the sweeps after the advance; one r1 two hours after the brief, keyed on the advance', async () => {
    const { h, coord, w } = await rig();
    const runId = seedE4(h, coord);
    advanceAt(coord, runId, E4.react, 'working');
    await sweepAt(w, E4.fire, LIVE);
    expect(operatorMail(coord)).toEqual([]);
    expect(stallRows(coord, runId)).toEqual([]);
    toWorker(coord, runId, E4.brief, 'fix-round');
    await sweepAt(w, E4.brief + STALL_SWEEP_MS, LIVE);
    await sweepAt(w, E4.brief + STALL_QUIET_MS - STALL_SWEEP_MS, LIVE);   // the lane's own cadence: one sweep a minute
    expect(operatorMail(coord)).toEqual([]);
    await sweepAt(w, E4.brief + STALL_QUIET_MS, LIVE);
    const mail = operatorMail(coord);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ toId: WORKER, runId, at: E4.brief + STALL_QUIET_MS });
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, E4.react)]);
  });

  it('a row recorded under the pre-advance key stays; no r2 is timed from it, and the new episode records its own r1', async () => {
    const { h, coord, w } = await rig();
    const runId = seedE4(h, coord);
    advanceAt(coord, runId, E4.react, 'working');
    const old = stallDetail('shadow', 'quiet', 1, E4.w2811);   // the census row, as the build before this one wrote it
    expect(coord.recordStallObservation(runId, old, E4.fire)).toMatchObject({ recorded: true });
    await sweepAt(w, E4.fire + STALL_ESCALATE_MS, []);
    expect(stallRows(coord, runId)).toEqual([old]);
    await sweepAt(w, E4.react + STALL_QUIET_MS, []);
    expect(stallRows(coord, runId)).toEqual([old, stallDetail('shadow', 'quiet', 1, E4.react)]);
    expect(operatorMail(coord)).toEqual([]);
  });

  it('a run never sent back keys as before, even when its planned -> dispatched row trails dispatchedAt', async () => {
    const { coord, w } = await rig();
    const runId = dispatchAt(coord, 'demo-program', DISPATCHED_AT, 3);
    await sweepAt(w, R1_AT, LIVE);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, DISPATCHED_AT)]);
  });

  it('a sibling run\'s send-back does not restart the clock: the lane reads the PRIMARY run\'s events', async () => {
    const { coord, w } = await rig();
    // Run A, dispatched first, is sent back 30 min before r1 falls due. Run B, the primary (dispatched later), never
    // left working, and its worker has been silent on it since S4's mails.
    const a = dispatchAt(coord, 'prog-a', DISPATCHED_AT - 3_600_000);
    advanceAt(coord, a, DISPATCHED_AT - 1_800_000, 'working');
    const b = seedRun(coord, { program: 'prog-b' });
    advanceAt(coord, a, DISPATCHED_AT + 3_600_000, 'awaiting-review');
    advanceAt(coord, a, R1_AT - 1_800_000, 'working');
    await sweepAt(w, R1_AT, LIVE);
    expect(stallRows(coord, b)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
  });

  it('a run whose events cannot be read is held as before: its warn, nothing sent for it, and the next subject runs', async () => {
    const { h, coord, w } = await rig();
    seedRegistry(h.home, OTHER_WORKER);
    seedRun(coord, { program: 'prog-a' });
    seedRun(coord, { program: 'prog-b', worker: OTHER_WORKER });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(coord, 'runEvents').mockImplementationOnce(() => { throw new Error('SQLITE_BUSY'); });
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER), fleetRow(OTHER_WORKER)], LIVE, tickOf(PID, [regRow(WORKER), regRow(OTHER_WORKER)]));
    expect(operatorMail(coord).map((m) => m.toId)).toEqual([OTHER_WORKER]);
    expect(warn.mock.calls.some((c) => /^ccrc-server: stall-watch run \d+ \(demo-quiet-mesa\) failed \(SQLITE_BUSY\)/.test(String(c[0])))).toBe(true);
  });
});
```

- [ ] **Step 2: Run them; confirm red, and red for the right reason**

```bash
cd server
for f in stall-verdict stall-bodies stall-sweep stall-session stall-backoff; do ./node_modules/.bin/vitest run test/$f.test.ts; done
```

Expected (measured): `stall-verdict` 29 failed, 243 passed (272); `stall-bodies` 2 failed, 153 passed (155);
`stall-sweep` 2 failed, 99 passed (101); `stall-session` 89 passed; `stall-backoff` 17 passed. The `stallReactivation`
rows fail with `stallReactivation is not a function`, the three `stallFacts` literals and "the ladder and the caps key
apart" on the missing `capKeyMs`. Every other red shows today's verdict, the defect: for example E4's "first sweeps" row
receives `r1` keyed `1790802632578`. GREEN here, because they pin behaviour that must not change: the two CONTROL rows,
"a worker mail after the advance", the dialog and limit cap pins, the bodies dialog-cap text, and the sibling,
dispatch-lag and unreadable-read sweep cases.

- [ ] **Step 3: Implement the term in `server/src/coord/stall.ts`**

3a. `:1`, the L0 import:

```ts
import { ACTIVE_RUN_STATES, REVIEW_DONE_SUBJECT, WAVE_DONE_SUBJECT, isRunState, isSessionLifecycle, lifecycleIsDead } from '../../../shared/api.js';
```

3b. Between `export type CoordinatorState = 'alive' | 'dead' | 'unmeasurable';` (`:473`) and `export interface StallInput {`:

```ts
/** One `run_events` row as the re-activation reads it: an L2 port declared by this consumer. `store.runEvents` answers
 *  it as it stands, a structural match, and the lane passes that one read through whole. */
export interface StallEventRow { readonly at: number; readonly fromState: string; readonly toState: string }
/** The primary run's newest RE-activation (planning departure `quiet-restarts-on-reactivation` (D-3788)). Three words,
 *  never folded: `reactivated` restarts the episode key and the quiet clocks (never the dialog and limit caps, which
 *  keep `capKeyMs` and `capQuietSince`); `none` changes nothing; `unmeasured` (the newest entry's time is not a
 *  non-negative safe integer) holds at §10 step 2c, beside a null `dispatchedAt`. */
export type StallActivation =
  | { readonly kind: 'reactivated'; readonly at: number }
  | { readonly kind: 'none' }
  | { readonly kind: 'unmeasured' };
/** The time of the newest transition INTO `ACTIVE_RUN_STATES` (L0, never a second list) from a state outside them,
 *  other than the run's FIRST such entry, in the store's `ORDER BY id`. The first entry is the dispatch, the run's one
 *  way in, and `dispatchedAt` already measures it: `markDispatched` and `advanceInner` stamp the two with separate
 *  `Date.now()` calls, so counting the dispatch's own row would move a never-mailed episode's key off `dispatchedAt`.
 *  An observation row (`fromState === toState`) is never an entry. A `fromState` this build cannot name, into an
 *  active state, IS one: the clock restarts once, which defers r1 by at most `STALL_QUIET_MS`, where refusing it
 *  would hold the run until its next transition. */
export function stallReactivation(events: readonly StallEventRow[]): StallActivation {
  const active: readonly string[] = ACTIVE_RUN_STATES;
  const entries = events.filter((e) => active.includes(e.toState) && !active.includes(e.fromState));
  if (entries.length < 2) return { kind: 'none' };
  const at = entries[entries.length - 1]!.at;
  return Number.isSafeInteger(at) && at >= 0 ? { kind: 'reactivated', at } : { kind: 'unmeasured' };
}
```

3c. `StallInput`, after the `notices` line (`:478`):

```ts
  readonly notices: readonly StallNotice[];     // parsed from runEvents(subject.primary.id)
  readonly activation: StallActivation;         // stallReactivation over that same runEvents read
```

3d. Immediately above `export function stallFacts(input: StallInput): StallFacts {` (`:591`):

```ts
/** `quiet-restarts-on-reactivation` (D-3788): the re-activation as a term of a max(). `none` adds nothing. So does
 *  `unmeasured`, which §10 step 2c holds on before any quiet clock is read: only steps 2a and 2b, which read the
 *  episode key and never a quiet clock, run past it, keyed as they were before this term, as they are for a null
 *  `dispatchedAt`. */
function stallReactivatedAt(input: StallInput): number {
  return input.activation.kind === 'reactivated' ? input.activation.at : 0;
}

```

3e. `StallFacts` (`:535-536`) gains the caps' key:

```ts
/** Exported for tests and for the bodies (Task 6): the derived facts the verdict used. `capKeyMs` is the dialog and
 *  limit caps' episode: the key without the re-activation term (coordinator ruling on `quiet-restarts-on-reactivation`
 *  (D-3788)), because the caps measure the pane or the account, not the worker's silence. */
export interface StallFacts { readonly ball: 'worker' | 'coordinator'; readonly episodeKeyMs: number; readonly capKeyMs: number; readonly quietSince: number | null;
```

In `stallFacts`, the key (`:602`) splits in two, the quiet clock (`:605`) gains the term, and the return (`:607`) carries
`capKeyMs`:

```ts
  const capKeyMs = Math.max(workerLast?.at ?? 0, waitLast?.at ?? 0, primary.dispatchedAt ?? 0);
  const episodeKeyMs = Math.max(capKeyMs, stallReactivatedAt(input));
```

```ts
    ? Math.max(w.live.since, workerLast?.at ?? 0, inboundLast?.at ?? 0, primary.dispatchedAt ?? 0, stallReactivatedAt(input))
```

```ts
  return { ball, episodeKeyMs, capKeyMs, quietSince, workerLast, inboundLast, lastExchangeAt };
```

3f. The caps keep today's clock and key. `capQuietSince`'s formula (`:646-648`) is NOT changed; its docstring
(`:644-645`) says why:

```ts
/** The dialog and limit caps' clock: the same mail terms, from the live stamp whatever the word. The caller
 *  passes a MEASURED stamp: a null one is hold `unmeasured` before this is reached, never a 0. It carries NO
 *  re-activation term, and the caps key on `capKeyMs` (coordinator ruling on `quiet-restarts-on-reactivation`
 *  (D-3788)): a dialog that blocked the pane through the review still blocks the fix-round brief. */
```

In `stallVerdictInner`, after `const capQuiet = now - capQuietSince(input, f, live.since);` (`:926`), and the two cap
lines (`:931`, `:934`) take `capKey` where they took `key`:

```ts
  const capKey = f.capKeyMs; // the caps keep the spec's clock and key (`quiet-restarts-on-reactivation` (D-3788))
```

```ts
  if (dialogShaped) return capQuiet >= STALL_QUIET_MS && rungDoneAt(input, 'dialog-cap', 1, capKey) === null ? capVerdict('dialog-cap', capKey) : holdVerdict('dialog');
```

```ts
    return capQuiet >= LIMIT_HOLD_CAP_MS && rungDoneAt(input, 'limit-cap', 1, capKey) === null ? capVerdict('limit-cap', capKey) : holdVerdict('limit');
```

3g. `stallMarkQuiet` (`:768-772`), whole; it now takes the input, so its two callers pass `input` and the max is one site:

```ts
/** The marker's quiet start (§5.1, "Quiet with the marker"): `stopAt`, maxed with the worker's last mail, the
 *  newest non-watch mail to it, `dispatchedAt` and the re-activation. Null when the view has no `stopAt`. */
function stallMarkQuiet(view: { readonly stopAt: number | null }, f: StallFacts, input: StallInput): number | null {
  return view.stopAt === null ? null : Math.max(view.stopAt, f.workerLast?.at ?? 0, f.inboundLast?.at ?? 0, input.subject.primary.dispatchedAt ?? 0, stallReactivatedAt(input));
}
```

Its callers: `:949` becomes `  const quietStart = view === null ? null : stallMarkQuiet(view, f, input);` and `:1064`
becomes `  return view.state === 'working' ? null : stallMarkQuiet(view, facts, input);`.

3h. `stallVerdictInner`'s docstring, step (2) (`:863-864`):

```ts
 *  (2) the marker-unreadable push, then a worker absent from the tick (the dead arm after DEAD_GRACE_MS), then an
 *      unmeasured fleet row, lifecycle, dispatch or re-activation;
```

and step 2c (`:907-910`): the comment, then one hold after the `dispatchedAt` one.

```ts
  // (2c) an unmeasured fleet row, lifecycle, dispatch or re-activation
  if (w.unmeasured) return holdVerdict('unmeasured');
  if (lc === null || !isSessionLifecycle(lc) || lc === 'unmeasurable') return holdVerdict('unmeasured');
  if (p.dispatchedAt === null) return holdVerdict('unmeasured');
  if (input.activation.kind === 'unmeasured') return holdVerdict('unmeasured'); // `quiet-restarts-on-reactivation` (D-3788)
```

3i. `stallSilence`'s docstring (`:1076-1078`), its last two lines:

```ts
 *  text says `dispatch`. A coordinator's `wait:` can also move the key, and so can the run's re-activation
 *  (`quiet-restarts-on-reactivation` (D-3788)); "no mail from the worker since" either moment is still true. */
```

- [ ] **Step 4: Wire the lane in `server/src/watch.ts`**

4a. The import from `./coord/stall.js` (`:56`): `  stallReactivation, stallVerdict, stallW2ReportMail,`

4b. `judgeStall` (`:3113-3117`): one read, both derivations.

```ts
    // ONE run_events read gives the notices and the re-activation (`quiet-restarts-on-reactivation` (D-3788)): a throw
    // here is what it was before, this subject's warn and no verdict.
    const events = store.runEvents(primary.id);
    const notices = this.stallNoticesOf(events);
    const markUnreadableSince = this.stallMarkUnreadableSince.get(id) ?? null;
    let input: StallInput = {
      subject, worker, mail: stallRunMail(read.mail, runIds), notices, arming, coordinationPaused: paused,
      coordinator: null, activation: stallReactivation(events),
```

4c. `stallNoticesOf` (`:3271-3274`) takes the rows, not the store:

```ts
  /** The stall rows among one run's events, parsed. A detail this build cannot name is skipped (`parseStallDetail`). */
  private stallNoticesOf(events: ReturnType<CoordStore['runEvents']>): StallNotice[] {
    const notices: StallNotice[] = [];
    for (const e of events) {
```

The session verdicts below it keep receiving the same `notices`; nothing else in the file calls `stallNoticesOf`
(`grep -n stallNoticesOf server/src/watch.ts`: the definition and this one call).

- [ ] **Step 5: Run green**

```bash
./node_modules/.bin/tsc --noEmit -p .
for f in stall-verdict stall-bodies stall-sweep stall-session stall-backoff stall-store stall-vocabulary; do ./node_modules/.bin/vitest run test/$f.test.ts; done
```

Expected (measured): tsc clean; `stall-verdict` 272, `stall-bodies` 155, `stall-sweep` 101, `stall-session` 89,
`stall-backoff` 17, `stall-store` 53, `stall-vocabulary` 178, all passed.

- [ ] **Step 6: README, one sentence and one corrected clause**

In the "**The stall watch.**" paragraph, the episode-start clause (`README.md:2547-2549`) becomes:

```markdown
episode instead. r2 and r3 measure the silence from the episode's start: the
worker's own last mail on the run, a later coordinator `wait:`, dispatch, or
the run's latest return to an active state, none of which the watch's own
notices can move. A paused coordinator, a dead
```

and after "keeps r1 from ever falling due." (`:2566`) the new sentence goes in:

```markdown
mails the worker there at least every 2 h keeps r1 from ever falling due. Time
the run spends outside the active states is never charged to the worker: when
the coordinator moves it back into one (a send-back from `awaiting-review` to
`working`, say), the quiet clock and the episode start again from that move;
the dialog and limit caps keep their clocks, which measure the pane and the
account, not the worker. The
guarantee that no box-token holder can keep a mail off the phone covers the
```

- [ ] **Step 7: Substitute the issued numbers, then run Task 1's mutation rows**

```bash
git grep -n 'D-<[nm]>' -- server README.md     # replace each <n> with the issued number; prints nothing after
git add -A && git commit -m "fix(stall): a run's re-activation restarts its quiet clocks and episode (quiet-restarts-on-reactivation)"
```

Place the runner (below, "Mutation table") at `.superpowers/sdd/2026-10-02-stall-watch-reactivation-quiet/mutate.py`
and run Task 1's rows (M1 to M12, M14 to M16) from the repo root, IN CHUNKS OF AT MOST FOUR ROWS, each its own
foreground command with a 600000 ms timeout. One row runs three suites: measured 28 to 65 s a row at load average ~60,
so a chunk of four stays near four minutes and the whole table in one call (about 9 to 10 minutes) would overrun the
foreground limit.

```bash
R=.superpowers/sdd/2026-10-02-stall-watch-reactivation-quiet/mutate.py
python3 $R server M1 M2 M3 M4
python3 $R server M5 M6 M7 M8
python3 $R server M9 M10 M11 M12
python3 $R server M14 M15 M16
git status --short    # clean: the runner restores every file byte for byte and asserts it
```

Each row must report at least the reds the table names, and the runner asserts that none is green. Record its output
in the wave-done report.

### Task 2: The coordinator's 30 h restarts on re-activation too

**Files:**
- Modify: `server/src/coord/stall.ts` (`:958`, the coord-ball age; after Task 1 it sits near `:992`)
- Modify: `README.md` (the Task 1 sentence)
- Test: `server/test/stall-verdict.test.ts`

**Interfaces:**
- Consumes: `stallReactivatedAt(input: StallInput): number` and `StallInput.activation` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test.** Append to the END of `server/test/stall-verdict.test.ts`:

```ts

// ── coord-ball-restarts-on-reactivation (D-3789): the coordinator's 30 h runs from its own send-back ─────────────────
describe('coord-ball-restarts-on-reactivation: the coordinator\'s 30 h runs from the send-back too', () => {
  // The common send-back shape: the worker's wave-done is the newest mail, so the ball stays the coordinator's while
  // the run sits at awaiting-review and after the advance, until the brief lands.
  const DONE = t('2026-10-01T04:01:25.850Z');           // E5's wave-done #2909
  const REACT = DONE + 31 * H;                          // chosen: past COORD_BALL_CAP_MS at awaiting-review
  const ballInput = (activation: StallActivation): StallInput => stallInput({
    primary: { id: 199, dispatchedAt: t('2026-09-30T23:55:37.757Z') },
    worker: workerAt({ live: liveWord('idle', DONE + 2 * MIN) }),
    mail: [mailRow(2909, DONE, WORKER, 'coordinator', 'status', WAVE_DONE_SUBJECT, 199)], activation,
  });

  it('CONTROL: with no re-activation term the advance draws the coord-ball push within a sweep', () => {
    expect(stallVerdict(ballInput({ kind: 'none' }), REACT + 4_000)).toEqual(capOf('coord-ball', DONE));
  });

  it('with it: none after the advance, and one push 30 h after it, keyed on it', () => {
    expect(stallVerdict(ballInput(reactivated(REACT)), REACT + 4_000)).toEqual(NONE);
    expect(stallVerdict(ballInput(reactivated(REACT)), REACT + COORD_BALL_CAP_MS - 1)).toEqual(NONE);
    expect(stallVerdict(ballInput(reactivated(REACT)), REACT + COORD_BALL_CAP_MS)).toEqual(capOf('coord-ball', REACT));
  });

  it('a coordinator mail after the advance still restarts it as before', () => {
    const resume = mailRow(2971, REACT + H, COORD, WORKER, 'status', `${STALL_WAIT_PREFIX} the rebase`, 199);
    const input = { ...ballInput(reactivated(REACT)), mail: [mailRow(2909, DONE, WORKER, 'coordinator', 'status', WAVE_DONE_SUBJECT, 199), resume] };
    expect(stallVerdict(input, REACT + COORD_BALL_CAP_MS)).toEqual(NONE);
    expect(stallVerdict(input, resume.at + COORD_BALL_CAP_MS)).toEqual(capOf('coord-ball', resume.at));
  });
});
```

- [ ] **Step 2: Run red.** `./node_modules/.bin/vitest run test/stall-verdict.test.ts` — expected (measured): 1 failed,
  274 passed (275). The red row is "with it: none after the advance…", receiving `coord-ball` keyed on the advance at
  `REACT + 4_000` (Task 1 already moved the key; the age still runs from the wave-done).

- [ ] **Step 3: Implement.** In `stallVerdictInner`'s step (10), the age line:

```ts
    // `coord-ball-restarts-on-reactivation` (D-3789): the coordinator's 30 h runs from its own send-back too.
    const ballAge = f.lastExchangeAt === null ? 0 : now - Math.max(f.lastExchangeAt, stallReactivatedAt(input));
```

- [ ] **Step 4: Run green.** `stall-verdict` 275 passed (measured).

- [ ] **Step 5: README.** In Task 1's sentence, the clause naming what restarts becomes:

```markdown
`working`, say), the quiet clock, the episode and the coordinator's 30 h start
again from that move; the dialog and limit caps keep their clocks, which measure
the pane and the account, not the worker. The
```

- [ ] **Step 6: Mutation row M13, then the whole table once more, in chunks of at most four rows**

```bash
git grep -n 'D-<[nm]>' -- server README.md     # prints nothing
git add -A && git commit -m "fix(stall): the coordinator-ball cap runs from a re-activation too (coord-ball-restarts-on-reactivation)"
R=.superpowers/sdd/2026-10-02-stall-watch-reactivation-quiet/mutate.py
python3 $R server M1 M2 M3 M4
python3 $R server M5 M6 M7 M8
python3 $R server M9 M10 M11 M12
python3 $R server M13 M14 M15 M16
git status --short    # clean
```

- [ ] **Step 7: The full verification**

```bash
cd server
./node_modules/.bin/tsc --noEmit -p .
for f in stall-verdict stall-session stall-bodies stall-store stall-vocabulary stall-backoff stall-sweep single-definition topology-clean typecheck-tests mail-routes run-states dtbd; do ./node_modules/.bin/vitest run test/$f.test.ts; done
git fetch origin main && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected (measured on a copy of `61b280fb5` with both tasks applied): `stall-verdict` 275, `stall-session` 89,
`stall-bodies` 155, `stall-store` 53, `stall-vocabulary` 178, `stall-backoff` 17, `stall-sweep` 101, `mail-routes` 59
(its kebab scan covers `server/src/coord`; this plan adds no single-quoted kebab literal there), `run-states` 11, all
passed; the citation instrument 7 passed, 328 skipped, unchanged. `single-definition` (259), `topology-clean` (55),
`typecheck-tests` (12), `dtbd` and `deviation-refs` (31) must equal their baselines; they read the whole checkout or
git, so they were measured on the real tree, not the copy. Then merge `origin/main`, re-run the stall suites, and
report the wave done per the worker skill.

## Mutation table

Sixteen rows. Each deletes this plan's term from ONE site or weakens ONE guard (M3 and M16 instead ADD the term where
the coordinator ruled it must not be), runs `stall-verdict`, `stall-bodies` and `stall-sweep` (531 cases with both
tasks applied), and must go red; the runner restores the file byte for byte and asserts it. "Reds" below are the
measured failing cases, on a copy of `61b280fb5` with both tasks applied, unless a row says otherwise. Run the table in
chunks of at most four rows per command (measured 28 to 65 s a row at load average ~60).

| Row | Site | The mutation | Measured reds |
|---|---|---|---|
| M1 | episode key (`stallFacts`) | `Math.max(capKeyMs, stallReactivatedAt(input))` → `capKeyMs` | 9 after Task 1 (Task 2's coord-ball row does not exist yet); 10 after Task 2: verdict E4 "r1 falls due only after 2 h of NEW silence", "with no brief at all", "a brief queued BEFORE", "rows recorded under the pre-advance key", "the ladder and the caps key apart", "the marker clock", coord-ball "with it" (Task 2); bodies "the verdict fires r1 two hours after"; sweep "E4: no stall-check", "a row recorded under the pre-advance key" |
| M2 | wave-1 quiet (`stallFacts`) | drop it from `quietSince` | 9: verdict E4 "the first sweeps", "with no brief", "a brief queued BEFORE", "rows recorded…", E5 "none at the measured fire"; bodies both rows; sweep "E4", "a row recorded…" |
| M3 | caps' clock carries NO term (`capQuietSince`) | ADD `, stallReactivatedAt(input)` to its max | 3: verdict "the dialog cap (2b) keeps today's clock and key", "the limit cap (hold 3) keeps today's clock and key"; bodies "pushes on the first sweep after the advance, keyed on the worker's last mail" |
| M4 | marker clock (`stallMarkQuiet`) | drop it | 1: verdict "the marker clock" |
| M5 | step 2c hold | replace `if (input.activation.kind === 'unmeasured') return holdVerdict('unmeasured');` with `/* M5 */` | 3: both property slots "a re-activation whose time is unmeasured", verdict "an unmeasured re-activation holds" |
| M6 | first entry is the dispatch | `entries.length < 2` → `< 1` | 7: the five `stallReactivation` rows that hold a dispatch row and expect none or a later entry, "the first dispatch changes nothing", sweep "a run never sent back keys as before" |
| M7 | entries come from outside the active set | drop `&& !active.includes(e.fromState)` | 22: six `stallReactivation`/first-dispatch rows, the sweep "a row recorded…" case, and 15 existing `stall-sweep` cases (a stall row is `fromState === toState` on an active state, so it would become an entry and move the key) |
| M8 | time proven a safe integer | `Number.isSafeInteger(at) && at >= 0` → `at >= 0` | 3: unmeasured rows "not an integer", "past the safe range", "a string the store did not prove" |
| M9 | time proven non-negative | `Number.isSafeInteger(at) && at >= 0` → `Number.isSafeInteger(at)` | 1: unmeasured row "negative" |
| M10 | lane passes the read | `activation: stallReactivation(events)` → `activation: { kind: 'none' }` | 2: sweep "E4", "a row recorded…" |
| M11 | lane reads the primary only | `activation: stallReactivation(events)` → the newest re-activation over every run in the subject | 1: sweep "a sibling run's send-back" |
| M12 | lane lets a read throw | wrap `store.runEvents(primary.id)` in a try that answers `[]` | 1: sweep "a run whose events cannot be read" |
| M13 | coord-ball age (Task 2) | drop `Math.max(…, stallReactivatedAt(input))` back to `now - f.lastExchangeAt` | 1: verdict coord-ball "with it" |
| M14 | entries must END in the active set | drop `active.includes(e.toState) &&` | 2: `stallReactivation` "observation rows … are never entries" (a `planned -> planned` row would enter), "an unnamed toState is not" |
| M15 | the NEWEST entry is taken | `entries[entries.length - 1]` → `entries[1]` (the first re-activation) | 2: `stallReactivation` "two send-backs: the newest one", "an unprovable time on an OLDER entry does not touch the newest one" |
| M16 | caps keep today's key | `const capKey = f.capKeyMs;` → `const capKey = key;` | 3: the same three as M3 (the push is keyed on the advance and prints "opened … (0h 0m)") |

The runner, `.superpowers/sdd/2026-10-02-stall-watch-reactivation-quiet/mutate.py` (gitignored, never committed):

```python
import hashlib, re, subprocess, sys, pathlib, time
SERVER = pathlib.Path(sys.argv[1]).resolve()
ONLY = sys.argv[2:] or None
ST = SERVER / 'src/coord/stall.ts'
W = SERVER / 'src/watch.ts'
FILES = ['test/stall-verdict.test.ts', 'test/stall-bodies.test.ts', 'test/stall-sweep.test.ts']
M = [
  ('M1', ST, '  const episodeKeyMs = Math.max(capKeyMs, stallReactivatedAt(input));', '  const episodeKeyMs = capKeyMs;'),
  ('M2', ST, '    ? Math.max(w.live.since, workerLast?.at ?? 0, inboundLast?.at ?? 0, primary.dispatchedAt ?? 0, stallReactivatedAt(input))',
             '    ? Math.max(w.live.since, workerLast?.at ?? 0, inboundLast?.at ?? 0, primary.dispatchedAt ?? 0)'),
  ('M3', ST, '  return Math.max(liveSince, f.workerLast?.at ?? 0, f.inboundLast?.at ?? 0, input.subject.primary.dispatchedAt ?? 0);',
             '  return Math.max(liveSince, f.workerLast?.at ?? 0, f.inboundLast?.at ?? 0, input.subject.primary.dispatchedAt ?? 0, stallReactivatedAt(input));'),
  ('M4', ST, '  return view.stopAt === null ? null : Math.max(view.stopAt, f.workerLast?.at ?? 0, f.inboundLast?.at ?? 0, input.subject.primary.dispatchedAt ?? 0, stallReactivatedAt(input));',
             '  return view.stopAt === null ? null : Math.max(view.stopAt, f.workerLast?.at ?? 0, f.inboundLast?.at ?? 0, input.subject.primary.dispatchedAt ?? 0);'),
  ('M5', ST, "if (input.activation.kind === 'unmeasured') return holdVerdict('unmeasured');", '/* M5 */'),
  ('M6', ST, "  if (entries.length < 2) return { kind: 'none' };", "  if (entries.length < 1) return { kind: 'none' };"),
  ('M7', ST, '  const entries = events.filter((e) => active.includes(e.toState) && !active.includes(e.fromState));',
             '  const entries = events.filter((e) => active.includes(e.toState));'),
  ('M8', ST, "  return Number.isSafeInteger(at) && at >= 0 ? { kind: 'reactivated', at } : { kind: 'unmeasured' };",
             "  return at >= 0 ? { kind: 'reactivated', at } : { kind: 'unmeasured' };"),
  ('M9', ST, "  return Number.isSafeInteger(at) && at >= 0 ? { kind: 'reactivated', at } : { kind: 'unmeasured' };",
             "  return Number.isSafeInteger(at) ? { kind: 'reactivated', at } : { kind: 'unmeasured' };"),
  ('M10', W, '      coordinator: null, activation: stallReactivation(events),',
             "      coordinator: null, activation: { kind: 'none' },"),
  ('M11', W, '      coordinator: null, activation: stallReactivation(events),',
             "      coordinator: null, activation: subject.runs.map((r) => stallReactivation(store.runEvents(r.id))).reduce((m, a) => (a.kind === 'reactivated' && (m.kind !== 'reactivated' || a.at > m.at) ? a : m), stallReactivation(events)),"),
  ('M12', W, '    const events = store.runEvents(primary.id);',
             "    let events: ReturnType<CoordStore['runEvents']> = [];\n    try { events = store.runEvents(primary.id); } catch { /* M12 */ }"),
  ('M13', ST, '    const ballAge = f.lastExchangeAt === null ? 0 : now - Math.max(f.lastExchangeAt, stallReactivatedAt(input));',
              '    const ballAge = f.lastExchangeAt === null ? 0 : now - f.lastExchangeAt;'),
  ('M14', ST, '  const entries = events.filter((e) => active.includes(e.toState) && !active.includes(e.fromState));',
              '  const entries = events.filter((e) => !active.includes(e.fromState));'),
  ('M15', ST, '  const at = entries[entries.length - 1]!.at;', '  const at = entries[1]!.at;'),
  ('M16', ST, '  const capKey = f.capKeyMs;', '  const capKey = key;'),
]
for name, path, old, new in M:
    if ONLY and name not in ONLY:
        continue
    orig = path.read_bytes()
    digest = hashlib.sha256(orig).hexdigest()
    text = orig.decode()
    assert text.count(old) == 1, f'{name}: the site is not exactly once in {path.name}'
    path.write_text(text.replace(old, new))
    t0 = time.time()
    try:
        r = subprocess.run(['./node_modules/.bin/vitest', 'run', *FILES], cwd=SERVER, capture_output=True, text=True, timeout=580)
    finally:
        path.write_bytes(orig)
    assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, f'{name}: restore failed'
    out = r.stdout + r.stderr
    summary = re.findall(r'^\s+Tests\s+(.*)$', out, re.M)
    reds = sorted(set(re.findall(r'FAIL\s+(test/[\w.-]+ > .+)', out)))
    print(name, '|', summary[-1] if summary else '?', f'| {time.time() - t0:.0f} s')
    for x in reds:
        print('    ', x)
    assert reds, f'{name}: GREEN under mutation — the site has no pin'
```

## Deviations found

Both numbers were issued at run-open by the coordinator (`POST /api/ledger/deviations`). Code comments cite each by slug
and number.

- **D-3788** `quiet-restarts-on-reactivation` — the wave-1 and marker quiet clocks and the episode key restart when a
  run re-enters an active state. Spec §4.2 defines `quiet = now − max(statusUpdatedAt, the worker's last mail, the
  newest non-watch mail to it, dispatchedAt)` and `episodeKeyMs = max(the worker's newest mail, the coordinator's newest
  wait:, dispatchedAt)`, says the key "changes only when the worker mails or the coordinator sends `wait:`" and "keys
  every observation of the episode, `limit-cap` included", and says "An open episode is not reset"; §5.1's marker clock
  uses the same terms. This plan adds a term to the quiet clock, the marker clock and the key: the time of the run's
  newest transition into `ACTIVE_RUN_STATES` from outside them, other than its first (the dispatch, which
  `dispatchedAt` already measures from a separate `Date.now()`). A re-activation therefore closes the open episode and
  opens a new one. The dialog and limit caps are NOT in it (coordinator ruling): they keep the spec's clock and are
  keyed on the spec's formula, carried as `StallFacts.capKeyMs`, so "one key for every observation" now holds for every
  arm except those two caps, which keep exactly the key the spec gives them. Argument: the lane watches only active runs (`stallCandidates`), so time spent at
  `awaiting-review`, `merging`, `closing` or `planned` is time the watch does not cover and the worker owes nothing in;
  a send-back is the coordinator handing work back, the same act as the dispatch the formula already counts. Measured
  cost of not doing it: two of the shadow review's five false r1s (runs 187 and 199), each firing seconds after the
  advance and racing the fix-round brief with a false "quiet ~8 h 49 m / ~6 h 11 m, owed: next report". Read from the
  primary run only, as `dispatchedAt` is; an unprovable time holds `unmeasured` (§10 step 2c) rather than reading as 0.
- **D-3789** `coord-ball-restarts-on-reactivation` — the coordinator-ball cap's 30 h runs from the later of the last mail on
  the run and the run's re-activation. Spec §4.2 (§11 decision 9) measures it from "no mail on the run from either side"
  alone. Argument: the common send-back leaves the worker's wave-done as the newest mail, so the ball stays the
  coordinator's through `awaiting-review` and after the advance; a run that waited 30 h for review would draw
  "⚠ waiting … no mail on the run since …" within one sweep of the coordinator's own advance, which is false: the
  coordinator just acted. The push text keeps naming the last mail, which stays true. Kept apart from the slug above
  because it changes an operator-ruled cap, not the worker's quiet.

## Self-review (record)

- Spec coverage: §4.2's quiet clock, key and coord-ball cap, §5.1's marker clock and §10's step-2 holds each have a
  task, a test and a mutation row; the dialog and limit caps are pinned UNCHANGED (M3, M16); every other clock is
  argued in "The clocks, audited". No spec requirement is
  removed: every existing suite stays green, and the property test gains a slot rather than losing one.
- Brief coverage: E4's shape (more than 2 h at `awaiting-review`, the advance, the brief 35.4 s later: none on the
  first sweeps, r1 only after 2 h of new silence), E5's shape, the first-dispatch row (no change, including a 3 ms
  lag), unreadable events (as today: the subject's warn, no verdict) and events with no re-activation (as today: every
  existing fixture now passes `{ kind: 'none' }` and stays green), one mutation row per site, the README sentence.
- Placeholders: none. D-3788 and D-3789 were issued at run-open and are written in.
- Types: `StallActivation`, `StallEventRow`, `stallReactivation`, `stallReactivatedAt`, `StallInput.activation`,
  `StallFacts.capKeyMs` and the verdict's local `capKey` are spelled the same in both tasks, the tests and the runner.
