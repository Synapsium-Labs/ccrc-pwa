# Coordinator durability, the tail: the programme ledger, the drift reconciler (D7) and the claimant's uuid (D8) — design

**Status:** approved by the coordinator under the operator's autonomous-backlog mandate of 2026-10-19; the operator may overrule any decision. Rev 0 (2026-10-20). Deviation numbers D-5920 to D-5927 are defined once, in the plan's §Deviations and decisions; this document cites them. 5928 and 5929 are issued and unused.

**Plan:** `docs/superpowers/plans/2026-10-20-coordinator-durability-tail-epic-ledger-d7-recon.md`. **Ledger:** `docs/superpowers/programs/coordinator-durability.md`.

**Issues:** the epic #752 (coordinator↔worker durability), D7 #760 (the drift reconciler and durable held-ask timers) and D8 #761 (the coordinator's uuid on the claim). The epic's other children, D1 #754, D2 #756, D3 #755, D4 #757, D5 #759 and D6 #758, are designed by their own specs; this one records their order and their gates (§3) and designs only D7 and D8.

**Builds on:** the consolidation wave (`2026-10-19-ccrc-consolidation-wave-design.md`, "the consolidation spec" below; branch `docs/consolidation-wave-spec`, rev 1, not yet ruled), whose contexts C5 (Coordination) and C6 (Attention & Notification), clusters K5, K6, K10, K11 and K12, and waves W1a, W1b, W3 and W6 this design fits into; the architecture spec `2026-08-10-architecture-ddd-clean-solid.md`; coordinator-first routing (`2026-10-17-coordinator-first-routing-design.md`), which owns the asks and approvals hold and the daily digest (D-5300); the stall watch (`2026-09-29-worker-stall-watch-design.md`).

**Citations** are to `origin/main` `4bc6c756d`, written `≈:` with a function, constant or table name beside each line hint. **[I]** marks a figure from the epic's investigation (#752, 14 to 21 days of fleet history, re-verified there against code and the live store); this design took no new measurement on any box. **[M]** marks a count re-run on the tree for this document.

---

## 1. The problem

The operator, 2026-10-19: "We also need to fix the cause of the actual disconnect between coordinator and child workspaces - why do we lose that connection? Is it restarts? ... why isn't it sufficiently durable?"

The investigation (#752) answered: restarts and account swaps are **not** the cause. They keep the session id and its uuid, so claims, workers' markers and mail rows survive them [I: 12 coordinators, 108 spawns, 48 swaps, 0 lost claims]. The causes are six, ranked, and D1 to D6 address the first five. This document takes the tail:

### 1.1 Drift is found only by accident (D7)

The server's rows, the registry and what sessions believe drift apart, and nothing lists the drift. The investigation found, by hand [I]:

- runs open with no event for weeks: 34 non-terminal runs, several weeks old;
- runs whose claimant is archived or absent: 3, one of them in an abandoned programme;
- mail parked or held for hours: 32 deliveries more than 1 h late in 14 days, the worst 27 h;
- a parent lookup that disagrees with the worker's own marker: `parentOfSession` (`server/src/coord/store.ts` ≈:6940) is the newest non-terminal run naming the id, by string, while the worker's `ChildMark` names its own run (#746, fixed on the PWA side by #762);
- awaiting-review runs untouched by their coordinator for days: 3 of one programme's 7 runs, for 18 days.

Each of these has an owner that could act (the stall watch, the dead-coordinator lane, the reclaim door, the coordinator itself), and none of those owners is asked the fleet-wide question "what is out of step right now". The stall watch is per run and per silence; the dead-coordinator lane is shadow-only (`DEAD_COORDINATOR_LANE_LIVE_MARKER`, `server/src/deadCoordinator.ts` ≈:23) and skips archives by design; the digest (`sweepDigest`, `server/src/watch.ts` ≈:8891) lists only asks and approvals decisions.

### 1.2 A restart loses a held question's deferred push (D7, item 4)

A child's `AskUserQuestion` held for its coordinator is a row in `asks` (`server/src/coord/schema.ts` ≈:814, state `held`), and its deadline is a pure function of that row: `askNotifyAt(at)` (`server/src/askwindow.ts` ≈:54). What is **in memory only** is the carrier of the deferred push: `heldAsks` and `lapsedAsks` (`watch.ts` ≈:796, ≈:807), deliberately (D-2169: "this map is the only carrier of the deferred push, so a lost database must not be able to swallow it").

So after a server restart:

- the `held` row has no `heldAsks` entry, and `sweepAsks` (≈:8649) iterates only `heldAsks`, so it never lapses, and the operator is never pushed;
- the first tick after boot is unprimed (`primed`, ≈:1327) and stamps `dialogIds` without raising, so the clear branch that settles a row `stale` cannot see the dialog leave either;
- the row stays `held` until someone answers it through the parent's door.

The child waits on a question nobody is told about. Approvals degrade the other way and are safe: `heldApprovals`' own note (≈:810) says a restart loses the deferral and the dialog raises on its next sighting, an early push rather than none.

### 1.3 The programme claim forgets who the coordinator was (D8)

A programme's claim is `runs.claimedBy` (`schema.ts` ≈:74), a bare session id. `POST /api/runs` checks the claimant's uuid once (`openRun.ts`'s `attribution` rung, ≈:300-314) and then discards it. Path leases already keep theirs (`claims.heldByUuid`, `schema.ts` ≈:497); the programme claim does not. A coordinator revived under a new id therefore leaves its programme claimed by a dead id until someone runs the reclaim door (`POST /api/runs/:id/reclaim`, `coord/reclaim.ts`, `CoordStore.reclaimProgram` ≈:1975), which has never been used [I]. The investigation saw **0** such revivals in 14 days [I]: swaps and respawns keep the id.

## 2. Goals and non-goals

**Goals.**

1. A programme ledger that a fresh session can read to know the build order of D1 to D8, their gates against the consolidation waves, and the operator acts that arm D2 and D6 (§3).
2. A drift reconciler that **lists** drift every 15 minutes, records it durably, puts it in the daily digest and pushes the operator once per item that has stood more than 24 hours (§4).
3. A held question that survives a server restart: re-raised to the operator when its deadline passes, from the row that already holds it (§5).
4. The coordinator's uuid stored with its claim, so a revival under a new id can be **offered** the existing reclaim, confirmed by the operator (§6).

**Non-goals (each a "must not" of #760 or #761, or a binding ruling).**

- The reconciler never closes, abandons, reclaims, re-dispatches or restarts anything. It never mails a session. Acting stays with the operator's taps on the existing doors.
- No claim moves implicitly. A matching uuid never reassigns a programme on its own.
- Account switching and the auto-swap are never blocked; no herd restarts; hibernation's contract is untouched; coordinator-first routing's hold rule (`coord/heldFor.ts`) is untouched; the ccrc SAFETY rules stand (no destructive `ccd` verb, no direct unit or tmux touch).
- No new arming marker. The consolidation spec's K12 would only have to absorb it.
- Arming the dead-coordinator lane (D6) and the `busy` mail gate (D2) are **not** done here. They are the operator's acts, after their shadow logs are reviewed (§3.3).

## 3. The programme ledger (D-5920)

### 3.1 Build order

The ledger `docs/superpowers/programs/coordinator-durability.md` records the epic's build order as **D1 → D3 → D2 → D4 → D5**, then D7 (this spec), with D6 and D8 recorded as **inputs to the consolidation's W6** (`RunBinding`, K10) rather than as standalone builds.

Why this order, from #752's ranking:

- **D1 first** (#754): it removes the terminal park for a live recipient. D3's retry rides D1's parked path, so D3 cannot come first.
- **D3** (#755): the brief-landed check is the cheapest win once D1's parked state exists.
- **D2** (#756): the in-turn surfacing hook, and the `busy` gate's arming after its shadow is reviewed. It is later than D1 and D3 because a hook on every tool call needs its 5 ms budget measured, and because arming is an operator act.
- **D4** (#757): the coordinator's roster card on compaction, resume, clear and wake.
- **D5** (#759): the worker's re-attach notice after a respawn.

### 3.2 D6 and D8 feed W6, they do not race it

The consolidation spec's K10 makes `RunBinding` the one coordinator↔worker link, keyed on the worker's **incarnation** (session id plus registry generation), with `openRun`, `dispatchRun`, `closeRun` and `reclaimProgram` as its only writers, and it says W6 "waits for the coordinator↔child durability investigation". That investigation is #752, and its answer for the binding is two inputs:

- **D6** (#758): a parent is conferred only by a run whose recorded birth (`sessionBornAt`, `sessionBornFor`, `schema.ts` ≈:1228) matches the session's current birth. That *is* an incarnation check; it belongs inside `bindingOf`, not beside it.
- **D8** (#761, §6 below): the coordinator side of the binding carries the claimant's uuid, written by the same four writers.

Building either as its own patch to `parentOfSession` or `openRun` before W6 would add a second rule W6 then has to merge, which is the parallel mechanism the consolidation exists to remove. The ledger records them as W6 inputs; D8's tasks are gated after W6 (§6.5). D6's first item is W6's own fixture (the consolidation's W6 exit names a reused-id fixture). D6's other items, the archive-time release question and the one-off orphan listing, are D7's `claimant-gone` finding and the operator's ruling on it.

### 3.3 Operator acts, later

- **OA-D2: arm the `busy` mail gate.** After D2's surfacing hook ships and the operator has reviewed the `mail-gate-busy-shadow` log: the operator creates `$REG/mail-gate-busy` by hand (CLAUDE.md: the gate markers have no writer in the tree; the ask names that rule).
- **OA-D6: arm the dead-coordinator lane.** After the lane's shadow record has been reviewed against D7's `claimant-gone` findings: the operator creates `$REG/dead-coordinator-lane-live` by hand.

Neither is a task of this programme, and neither is assumed by any task. The reconciler's findings are the shadow review's evidence: a `claimant-gone` finding the lane would also have acted on is the agreement the operator reads before arming.

## 4. D7: the drift reconciler

### 4.1 Question: a new stall-lane arm, or a separate 15-minute lane? (D-5921, D-5922)

**Alternatives considered.**

1. **A new arm of the stall watch.** Rejected. The stall watch's arms (`STALL_ARM_MAP`, `server/src/coord/stall.ts` ≈:52) are per-run silence detectors on a 60 s cadence (`STALL_SWEEP_MS = CLAIM_SWEEP_MS`, `watch.ts` ≈:339), each a rung ladder that **mails** the worker, then the coordinator, then pushes the operator, keyed on `run_events` observation rows. Drift is not a silence: a claimant archived a month ago, a parent mismatch or a review untouched for days has no rung to climb and no session to mail. Forcing it in would put fleet-wide joins on the 60 s tick and teach a mail ladder a never-mail kind.
2. **Inside the digest beat.** Rejected as the only home. The digest beats once a day; the 24 h push threshold and "re-raised after a restart" need a pass that runs all day, and `buildDigest` (`coord/digest.ts` ≈:106) is synchronous over the store while three of the findings need the registry listing.
3. **A separate 15-minute lane that only records, plus a digest section and bounded pushes.** **Chosen.** It has a precedent shape on the same watcher: `sweepLedgerReconcile` at `LEDGER_RECONCILE_SWEEP_MS = 900_000` (`watch.ts` ≈:414, ≈:6874), a 15-minute read-and-report pass. When the consolidation's W1b lands, the lane is one row of `LANE_SCHEDULE` run by `runLane` (K11); before it, it uses the same monotonic throttle pattern the newest lanes use.

**Fit with the consolidation.** The lane is C5's (it reads coordination facts) and reports through C6 (the notice funnel and the digest read model). It owns one decision, *what is out of step*, which no existing owner makes; every **act** stays with the existing owner of that act (§4.5). That is "one owner per job": the job is new, and its remedies are not.

**The decider is pure (L1).** `server/src/coord/drift.ts` exports `driftFindings(input, now): DriftFinding[]` over plain rows: open runs with their last event time, the registry's measured verdict per claimant, outstanding deliveries with their gate columns, each worker's `ChildMark` beside `parentOfSession`'s answer, awaiting-review runs with the coordinator's last act, and held question rows. No `fs`, no fastify, no timers. The watcher (L4) gathers the inputs and records the output; it decides nothing.

### 4.2 The findings

`DRIFT_KIND_MAP` in `shared/api.ts` (L0; the `X_MAP` + `Object.keys` pattern, so `single-definition.test.ts` sees one home) enumerates the kinds. Each finding has a **key** that names its subject, so the same drift is the same row across passes.

| Kind | Fires when | Key | Its remedy's owner |
|---|---|---|---|
| `run-quiet` | an open (non-terminal) run has no `run_events` row in more than 72 h | `run-quiet:<runId>` | the coordinator; the operator's abandon door |
| `claimant-gone` | an open run's `claimedBy` measures archived, stopped or absent in the registry (never `unknown`: an unmeasurable registry is no finding, the reclaim ladder's rule) | `claimant-gone:<program>:<claimant>` | the reclaim door, the abandon door, the archive flow's `programme:'end'` |
| `mail-parked` | a delivery is `rejected` (parked) and its recipient is live, older than 1 h | `mail-parked:<deliveryId>` | D1's parked path; the sender |
| `mail-held` | a delivery is `queued` behind a gate (`lastGate` set, `gateSince` older than 1 h) | `mail-held:<deliveryId>` | D2's surfacing; the mail gate |
| `parent-mismatch` | a worker's `ChildMark` names run *r*, and `parentOfSession` answers a coordinator other than *r*'s `claimedBy` | `parent-mismatch:<sessionId>` | W6's `bindingOf` (D6) |
| `review-waiting` | a run at `awaiting-review` has had no coordinator act (no `run_events` row caused by the claimant, no mail from it naming the run) in more than 24 h | `review-waiting:<runId>` | the coordinator; D4's roster card |
| `question-orphaned` | an `asks` row is `held` or `answering` past `askNotifyAt(at)` + one sweep, or an `approvals` row is `held` past `notifyAt` + one sweep | `question-orphaned:ask:<id>` / `…:approval:<id>` | §5's re-raise |

The thresholds are constants in `drift.ts`, each with the issue's figure: `RUN_QUIET_MS` 72 h, `MAIL_DRIFT_MS` 1 h, `REVIEW_WAITING_MS` 24 h, `DRIFT_PUSH_AGE_MS` 24 h.

### 4.3 Where findings live (D-5922)

A new table in `coord.db`, one additive migration:

```sql
CREATE TABLE drift_findings (
  key         TEXT    PRIMARY KEY,
  kind        TEXT    NOT NULL,       -- DriftKind; isDriftKind on read, never a cast
  subject     TEXT    NOT NULL,       -- JSON: the ids the finding names (runId, program, sessionId, deliveryId …)
  detail      TEXT    NOT NULL,       -- one redacted line, the measurement in words
  factAt      INTEGER,                -- the age the fact itself carries (last event, gateSince, deliveredAt), or NULL
  firstSeenAt INTEGER NOT NULL,
  lastSeenAt  INTEGER NOT NULL,
  clearedAt   INTEGER                 -- NULL while open; set by the first pass that no longer finds it
);
CREATE INDEX drift_findings_open ON drift_findings(clearedAt, kind);
```

**Why a table and not the feed.** `feed_events` is the ring's archive, one row per notice; a finding is a standing *state* with a first-seen and a cleared edge, read by the digest for any past day ("open at the window's end"). **Why not a column on `runs`.** Four of the seven kinds are not about one run. The table's one writer is `CoordStore.recordDriftPass(findings, now)`, one transaction: upsert every found key (`lastSeenAt = now`, `firstSeenAt` kept), and set `clearedAt = now` on every open key not found. A finding clears **only** because a later pass measured the fact gone, never because a button marked it. Rows cleared more than 30 days ago are pruned in the same transaction.

**Age.** A finding's age is `now - (factAt ?? firstSeenAt)`. `factAt` is the fact's own time where it has one (a run's last event, a delivery's `gateSince`), so a restart or a first deploy does not reset an old run to "new"; kinds with no intrinsic time (`parent-mismatch`, `claimant-gone` when the registry carries no archive stamp) age from `firstSeenAt`.

A lost `coord.db` loses the findings, and the next pass re-finds every one that still stands (their `factAt` ages come back with them); nothing else depends on the table.

### 4.4 The push budget (D-5922)

**The rule:** one push per finding, the first time its age passes 24 h, never again for that key.

**The mechanism** is the consolidation's W1a funnel, `notify(event, mode)` (K6), with the `dedupeKey` W1a adds to a notice: the reconciler calls `notify` with mode `push` and `dedupeKey = 'drift:' + key`, so a restart, a second pass or a re-found key after a clear-and-return never pushes twice. This is why D7's push lands **after W1a** (the task brief's "design after W1a's notify funnel"): before it, once-only would need `hasFeedEvent` as an idempotency key, which is the SEAM overload K6 deletes.

**Two bounds**, because a first deploy meets weeks of standing drift:

- **The first pass after deploy, or after the table is found empty, sends one summary push** ("N items out of step; see today's digest"), not one per old finding. Every finding already older than 24 h on that pass is marked pushed (its `dedupeKey` recorded) without its own push.
- **At most 3 per-item pushes per pass and 12 per UTC day.** Items over the budget wait for the next pass; the digest lists them either way.

**Stall overlap.** The stall watch already pushes the operator on `mail-stuck`, `coord-deaf` and the quiet ladder's rung 3. A `mail-held`, `mail-parked` or `run-quiet` finding whose subject already carries a stall operator-rung observation (`parseStallDetail`, `coord/stall.ts` ≈:169, the one reader of those rows) is listed in the digest and **not** pushed again.

A `question-orphaned` finding is never pushed by the reconciler: its remedy is §5's re-raise, which pushes the question itself. The finding stays in the digest as the record that a restart orphaned it.

### 4.5 How operator rulings reach the attributed reclaim and close doors (D-5922, D-5923)

**The reconciler holds no door.** A finding's push and its digest line deep-link to the place its remedy already lives: the run's sheet (abandon, close), the programme's `ResumeSheet` (reclaim, `pwa/src/fleet/ResumeSheet.tsx`), the session's archive sheet (`programme:'end'`), the mail screen (a parked delivery). The operator's ruling **is** the tap on that door, and each door re-measures its own guard at the act: reclaim refuses unless the current claimant measures dead or registry-absent (`coord/reclaim.ts`), abandon is the operator's own door, close re-measures the branch tip. Nothing in the reconciler's output is ever a door's input; the next pass sees the fact changed and clears the finding.

**Alternatives rejected.** (a) A "resolve" button on the finding that calls the door for the operator: a second caller of a destructive-adjacent door with its own confirm, the parallel mechanism; the existing sheets already confirm. (b) Auto-acting after a ruling recorded on the finding: #760's "must not auto-close" and the operator's coordinator-first ruling both forbid an act the operator did not take at the door.

The digest's existing correction door (`POST /api/digest/correct`, D-5300) stays for asks and approvals lines only. A drift line has no coordinator decision to correct.

### 4.6 The digest (D-5923, D-5924)

`DigestAnswer` (`shared/api.ts` ≈:11578) gains an **additive** field `drift?: { totals: Record<DriftKind, number>; lines: DriftLine[] }`: the findings open at the window's end (`firstSeenAt < toMs` and (`clearedAt` NULL or `clearedAt >= toMs`)), grouped by kind, each line naming its subject, age and the remedy's place. `v` stays 1 (wire rule: additive, absence-permits; an older PWA ignores the field). `buildDigest` stays synchronous: it reads `drift_findings` through a store read, like its asks and approvals reads.

The daily push (`digestPushCopy`) adds the drift count to its body only when non-zero, and the day's claim (`claimDigestDay`) counts decisions as today, so a day with drift and no decisions still claims with `count` 0 and pushes nothing new (the reconciler's own pushes covered it).

The PWA's `DigestScreen` gains a "Out of step" section under the decisions: one row per finding, a glance (kind in words, subject, age), opening its remedy's sheet. It is a skins-chain file, so this task waits for the skins W3 plan's P7 (the digest on the scaffold) and is checked at 360, 390, 1280 and 1920 px, refined and instrument, dark and light (§9).

## 5. D7, item 4: held questions survive a restart (D-5925)

### 5.1 Question: which `coord.db` table holds held and lapsed-ask state?

**Answer: the tables that already do.** Held state is `asks.state` `held`/`answering` (`schema.ts` ≈:814), its deadline is `askNotifyAt(asks.at)`, its identity is `dialogId` and `askAt`; lapsed is `released` with `releasedAt`. Approvals carry `state` and `notifyAt` (`schema.ts` ≈:1636). **No new table and no new column.**

**Alternatives rejected.** (a) A `held_timers` table mirroring `heldAsks`: a second home for a deadline the row already determines, and the in-memory map would still be the carrier, so two authorities. (b) Moving the carrier into the database now: that is exactly the consolidation's K5 (W3: "`watch.ts`'s in-memory `heldAsks` map … become rows in the module's own table view"), and doing it here would race W3. (c) Persisting the push payload `ev`: it is rebuilt from the dialog's current sighting, which is what `hold()` (`watch.ts` ≈:9093) builds it from today.

### 5.2 Question: how does it re-raise after a restart?

The boot's first tick already reads every pane and stamps `dialogIds` without raising (`primed` false). That tick gains one step, in the existing owner (`detectDialogs` and `sweepAsks`):

1. Read the `asks` rows in `held` or `answering`.
2. For each, if the child's pane, **measured this tick**, paints the same `dialogId`, and its hookstate's ask carries the same `askAt`: re-seed `heldAsks` with `until = askNotifyAt(at)`, `answeringSince = null`, and the payload rebuilt from this sighting. A deadline already past lapses on the next `sweepAsks`, through `releaseAsk`'s existing CAS, and pushes: the re-raise.
3. If the pane was measured and paints no dialog or a different one: settle the row `stale`, as the clear branch would have had the server been up.
4. If the pane was **not** measured (capture failed, session unlisted): leave the row; the next measured tick decides. Never settle on doubt.

A lost `coord.db` has no rows to re-seed, so the restart behaves exactly as today: D-2169's reason for keeping the carrier in memory stands, untouched. `lapsedAsks` (late answer wins, D-5289) is not re-seeded: its loss is free by its own docstring (the operator keeps the lapse's notification). Approvals are not re-seeded: they already degrade to an early push.

**W3 fit.** When W3 builds `coord/questions.ts` and deletes the map, this step's suite is the characterization pin that move must keep green: "a restart during a held question re-raises it at its deadline".

## 6. D8: the coordinator's uuid on the claim

### 6.1 Question: the binding, or the claim row beside the Incarnation? (D-5926)

**Answer: on the claim, which is the run row's `claimedBy` pair: a new column `runs.claimedByUuid`, beside `claimedBy`.**

- The consolidation's `Incarnation` (K10) is the **worker** side's key: session id plus registry generation, so a *recycled id* cannot inherit a run. It answers "is this the same life of this id".
- The uuid answers the opposite question for the **coordinator** side: "is this the same conversation under a *different* id". They are complementary, not two answers to one question, so the uuid is not folded into the incarnation key.
- `RunBinding`'s single writers (`openRun`, `dispatchRun`, `closeRun`, `reclaimProgram`) are the claim's writers too, so the column has no new writer: `openRun` stores the uuid its `attribution` rung already checked; `reclaimProgram` stores the heir's uuid, measured from the registry (`<to>.uuid`) at the act, never taken from the request body. `claims.heldByUuid` (path leases) is the precedent: the same check, kept.
- Rows from before the migration read `claimedByUuid` NULL, meaning "never stored", and match nothing.

### 6.2 Question: which entry points detect a matching uuid under a new id? (D-5927)

Only doors where a caller **already proves** its `(id, uuid)` pair and acts on a programme, and only on their **refusal** path:

| Door | Today's refusal it refines |
|---|---|
| `POST /api/runs` (`openRun`) | the programme is claimed by another session |
| `POST /api/mail` from a coordinator naming a run of the programme | sender is not the run's claimant |
| `POST /api/coordinators/:session/intent` | the declared programme is held by another |
| `POST /api/asks/:id/answer`, `POST /api/approvals/:id/rule` | the answering parent is not the held-for claimant |

One pure L1 function, `claimantContinuity(stored, caller)` in `server/src/coord/reclaim.ts` (the reclaim decision's module, so the offer and the act share a home), answers `same | revived | other`: `revived` when `stored.claimedByUuid` is non-null, equals the caller's attributed uuid, and the ids differ. On `revived` the door keeps refusing, with a distinct `409 claimant-revived` and a detail naming the reclaim, and the server sends one operator push through the funnel (`dedupeKey = 'revived:' + program + ':' + callerId`) that opens the programme's `ResumeSheet` with the heir pre-filled. The success path of every door is unchanged; no door moves a claim.

The reconciler gains the kind `claimant-revived` (a `claimant-gone` finding whose stored uuid is now listed under another live id), so a revival is visible even when the revived session never calls a door.

### 6.3 Question: does re-pointing queued mail go through the existing reclaim door?

**Yes, unchanged.** `reclaimProgram` already repoints outstanding role-addressed coordinator mail (`repointCoordinatorMail`), cancels kickoffs to the displaced id (`cancelKickoffsTo`) and re-queues abandoned parks for the heir (`requeueAbandonedMail`), in one transaction (`store.ts` ≈:1975-2045). The reclaim ladder admits a revived coordinator, because the old id measures dead or registry-absent. D8 adds only the uuid write to that transaction. Mail addressed to the old **literal** id stays where it is (arm (b) of the repoint's docstring: it was sent to a session, not a chair).

### 6.4 Must not

- No implicit move: `revived` refines a refusal and offers; only the operator's confirmed reclaim moves the claim.
- Account switching and the auto-swap keep the id, so they never produce `revived`; a test pins that a swap reads `same`.

### 6.5 When D8 is built, and when it is closed

- **After W6** fixes the `RunBinding` key and its writers (the consolidation's §5.9), so the column lands in the writer set W6 has just narrowed, not beside four writers W6 is about to move. D8 is recorded in the ledger as a W6 input.
- **The close rule.** D8's first task (the column, and the reconciler's `claimant-revived` count) is cheap and is the measurement. If the reconciler records **no** `claimant-revived` finding in the 30 days after that task deploys, the coordinator closes #761's second task (the door refinement) as not needed, records the count in the ledger, and keeps the column. The investigation's 0 in 14 days [I] is why the second task is conditional.

## 7. How this fits the consolidation's contexts and waves

| This design | Context | Cluster | Wave it waits for | Why |
|---|---|---|---|---|
| ledger (D-5920) | n/a | n/a | none | docs only |
| drift decider `coord/drift.ts` (D-5921) | C5 | none (new job) | none | pure L1 over store reads; touches no lane |
| reconciler lane, `drift_findings`, pushes (D-5922) | C5 → C6 | K6 (funnel), K11 (schedule) | **W1a** | once-only through `dedupeKey`; joins `LANE_SCHEDULE` when W1b lands |
| digest drift section, server (D-5923) | C6 | K6 (read model) | D-5922 | the digest is a read model of findings |
| digest drift section, PWA (D-5924) | C6 (PWA) | K14 | D-5923, skins P7 | `DigestScreen.tsx` is a skins-chain file |
| held-question re-raise (D-5925) | C6 | K5 | none (rebases nothing; W3 rebases onto it) | its suite becomes W3's pin |
| claimant uuid column (D-5926) | C5 | K10 | **W6** | lands in W6's writer set |
| `claimant-revived` door refinement (D-5927) | C5 | K10 | D-5926 + the 30-day rule | conditional |

The consolidation's rule 6 ("the wave rebases; the programme PR never does") applies: where a task here and a consolidation series both edit `watch.ts`, the consolidation series rebases.

## 8. What it must not break

- **Mail terminality.** The reconciler only reads `mail_deliveries`; it adds no `UPDATE`, so the writer census (`mail-hardening.test.ts`) is unchanged.
- **D-2169.** The question carrier stays in memory; the database only re-seeds it.
- **The stall watch's once-only.** No stall observation row is written or read differently; the reconciler reads them through `parseStallDetail` only.
- **The digest's idempotence (D-5493).** `claimDigestDay` stays the one check; the drift section changes the body, not the claim.
- **The reclaim ladder.** Its rungs and its refusal on an unmeasurable registry are unchanged; the uuid write is inside its existing transaction.
- **The wire.** `DigestAnswer.drift` and `claimant-revived` are additive; `FLEET_PROTO` is not bumped.
- **The box-token census.** No new door. `box-token-census.test.ts` and `coord-pause-route.test.ts` stay as they are.
- **Coordinator and worker skills.** No clause changes; the pinned skill suites stay green. (A revived coordinator's `409 claimant-revived` detail tells it what to do; the skill text is untouched.)
- **Public-repo rule.** Finding details name ids and counts only; they pass `redactCommand` like digest lines do.

## 9. Tests

- `server/test/drift-findings.test.ts` (D-5921): one fixture per kind, firing and not firing at the threshold's edge; `unknown` registry is no `claimant-gone`; a swapped session (same id, same uuid) is no finding of any kind; **the investigation's cases as fixtures**: a weeks-old open run, an archived claimant, an absent claimant, a 27 h held delivery, a parked delivery to a live worker, the reused-name parent mismatch of #746, an 18-day awaiting-review run, a held ask after a restart.
- `server/test/drift-lane.test.ts` (D-5922): the pass records, clears and prunes; the first pass sends one summary push; 3 per pass, 12 per day; a re-found key does not push twice (the funnel's `dedupeKey`); a stall operator-rung observation suppresses the push; `question-orphaned` never pushes; the lane mails nothing and calls no door (a spy on every store writer except `recordDriftPass`).
- `server/test/digest.test.ts` additions (D-5923): drift open at the window's end; a cleared finding absent from a later day; a zero-decision day with drift claims `count` 0 and pushes nothing.
- `pwa/test/digest-drift.test.tsx` (D-5924): the section's rows, their words, each row opening its remedy; an older server's answer without `drift` renders no section.
- `server/test/ask-restart.test.ts` (D-5925): a held row whose dialog is still painted is re-seeded and pushes at `askNotifyAt(at)`; a painted different dialog settles `stale`; an unmeasured pane leaves the row; no `coord.db` re-seeds nothing; an `answering` row re-seeds with `answeringSince` null.
- `server/test/claimant-uuid.test.ts` (D-5926): `openRun` stores the attributed uuid; `reclaimProgram` stores the heir's registry uuid, not a body field; NULL on an unattributed open; the migration is additive.
- `server/test/claimant-revived.test.ts` (D-5927): each listed door answers `409 claimant-revived` on a matching uuid under a new id and moves nothing; the success paths are unchanged; a swap reads `same`; one push per programme and heir.

Each task's mutation table is in the plan.

## 10. Open operator questions

None is needed to build. The operator may overrule any of these defaults:

- the thresholds (72 h, 1 h, 24 h) and the push budget (3 per pass, 12 per day, one summary on the first pass);
- D8's 30-day close rule.

The operator's acts OA-D2 and OA-D6 (§3.3) are not questions this design asks; they are the operator's, after their shadow reviews.
