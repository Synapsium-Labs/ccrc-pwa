# Review runs — design

**Status:** design rev 1 — three forks and scope settled with the operator 2026-09-14 (§3); approved by the operator 2026-09-14 · **Date:** 2026-09-14 · **Branch:** `spec/review-runs` (based on `origin/main` `56635768`)
**Parent:** `docs/superpowers/specs/2026-08-07-build7-fleet-coordination-design.md` — this spec restores that design's §7 and amends its "Wave lifecycle" bullet (§13).

A coordinator that reviews inline is a serial bottleneck on a parallel fleet. This spec moves the
*reading* of a wave — the review lenses and the whole-branch pass — into its own dispatched session, a
**review run**, while the *judging* stays with the coordinator. A worker that has reported wave-done
stops counting against the dispatch cap at once, and its workspace stays resident until review clears
so a send-back has somewhere warm to land. The reviewer produces evidence; the coordinator produces
decisions; nothing the reviewer writes changes fleet state.

---

## 1. The problem, measured

On 2026-09-14 the fleet's dispatch cap read `cap-concurrency limit 7 running 7`, and wave 6 of
`account-pools` could not start. Of the seven:

| run | programme | state | dispatched |
|---|---|---|---|
| 39 | bug-fix-waves | `awaiting-review` | 110 h earlier |
| 40 | bug-fix-waves | `awaiting-review` | 110 h earlier |

Wave 1 of `bug-fix-waves` had been cut into **five bundles** (runs 37–41) under **one coordinator**.
That coordinator was not idle — in the 17 hours its event feed reached back it issued twelve numbered
rulings and closed two bundles — but it reviews serially, and one bundle (run 40) had a rebase go wrong
and was consuming rounds. Run 39 had **all three work items done, no mail outstanding, and not one event
in 17 hours**: finished work, holding a fleet slot, queued behind a sibling's recovery.

Two facts frame the remedy:

- The cap's `running` predicate is `dispatchedAt IS NOT NULL AND state NOT IN ('done','failed')`
  (`server/src/coord/store.ts:2477`). It counts a session as long as its run is *non-terminal*, not
  while its session is *busy*. An idle worker at `awaiting-review` counts exactly as a working one.
- Once a coordinator is satisfied, the state machine is instant: run 37 went
  `working → awaiting-review → closing → done` in 28 seconds. What takes days is the reading before
  that, and the queue behind one reader.

## 2. What the parent design already says

Build 7 §7, *What stays discipline*:

> SDD's per-PR mechanics (implement → review lenses → whole-branch pass) unchanged — the coordinator
> **dispatches** that shape, it does not reinvent it.

The shipped coordinator skill drifted from this. `ccd/coordinator-skill/SKILL.md:300` reads *"Review the
handoff commit like any other commit"* — the coordinator does the reading itself. The parent spec's
"Wave lifecycle" bullet (§13 below) says the same. This spec is therefore a **restoration of stated
intent**, not a new direction, and the parent needs one bullet amended, not a section.

`WorkItem` in the parent (§1) already lists *"review X"* as a unit of work. This spec makes review a
**run** rather than a work item — §5 says why.

## 3. Decisions settled in the brainstorm

Three forks were put to the operator with a recommendation each; all three took the recommendation.

| fork | chosen | rejected, and why |
|---|---|---|
| **Who holds judgment** | **Reviewer reports, coordinator rules.** | *Reviewer rules* splits deviation allocation and the ledger across two authors. *One reviewer per lens* loses cross-lens findings (D-2722 needed seams and interaction together). |
| **When the worker releases** | **Persists until review clears.** Slot stops counting at wave-done; workspace stays for the fix round. | *Release at wave-done* makes every fix a cold start on code the fixer never wrote (D-2721 → D-2722 is the case against). *TTL* adds a timer to a system with none, for a problem cheap close already solves. |
| **What triggers the reviewer** | **The coordinator, on receiving wave-done.** | *Server-triggered on verified advance* buys resilience against a queue this spec removes, and has the server compose a brief. Named as follow-up B (§12) with the measurement that would justify it. |

**Scope**, taken from the parent rather than asked: the reviewer runs the SDD shape — review lenses and
the whole-branch pass — over the wave's whole diff, **once, at wave-done**. Mid-wave PRs are outside v1.

**Rejected by the operator, and load-bearing for §7:** a `maxResidentSessions` cap. The box runs ~31
`claude-session@` units; only 7 are run-dispatched. `coord.db` sees 23% of resident sessions and must not
claim to bound the whole. Residency is governed by the slice, deliberately at `MemoryHigh=infinity` after
an aggregate cap froze the fleet three times. The dispatch cap therefore bounds **active work only**.

## 4. Roles and authority

**Coordinator — dispatches and judges.** Unchanged: opens runs, writes briefs, verifies wave-done
fingerprints (clause 6), allocates deviations (clause 10), writes the ledger, merges, closes. **Changed:**
the review clause inverts — *a wave-done this session has verified is dispatched to a review run, never
read by this session*. Its turn per mail becomes one of two short shapes:

- wave-done → verify → advance `awaiting-review` → open + dispatch review run → end;
- review-done → close review run (server re-measures, §5) → read findings → rule → advance `merging`
  **or** advance `working` + re-brief worker by mail → end.

**Reviewer — reads and reports.** A new skill, `ccrc-reviewer`, parallel to `ccrc-worker`. It fetches the
worker's tip into **its own** worktree, runs the lenses and the whole-branch pass against the plan the run
names, and delivers **one findings report** as a mail artifact. It may not allocate deviations, may not
send work back, may not commit to or push the worker's branch, may not rule. A finding it believes needs a
ruling is *stated as such in the report*; the coordinator rules.

**Worker — unchanged.** It stays resident through review. On send-back the **same** worker is
advanced back to `working` and RE-BRIEFED BY MAIL (a `fix-round` status mail carrying the report —
D-2824 corrected this from "re-dispatched": dispatch is `planned`'s door only), and reads the
findings report as its brief for the fix round. Its existing
clause — no commit, amend or push after reporting wave-done — is what makes §5's `stale-review` a
mechanism rather than a request.

## 5. The review run

A reviewer is a **run**, reusing dispatch, mail, hold, slot and close rather than inventing a lighter
carrier, of a new **kind**.

### 5.1 Identity

- `runs.kind TEXT NOT NULL DEFAULT 'work'` — `'work' | 'review'`. Every existing row is a work run with
  no change of meaning.
- `runs.reviews INTEGER REFERENCES runs(id)` — the work run under review; `NULL` on work runs. Set at
  open, immutable.
- Same `program`, same `project`, same `claimedBy` as the work run it reviews — a review belongs to the
  wave it reviews and to the one coordinator that owns the programme (clause 8).
- **One review run per work run at a time.** `POST /api/runs` with `kind:'review'` refuses
  **`review-in-flight`** if a non-terminal review run already names the same `reviews`.

### 5.2 Transitions

```
kind:'work'   planned → dispatched → working ⇄ awaiting-review → merging → closing → done | failed
kind:'review' planned → dispatched → working → done | failed
```

A review run has no `awaiting-review`, `merging` or `closing`: it has nothing to review, merge or
release-with-ceremony. Reusing those states for it would make the state machine lie about what a row is
doing. `RUN_TRANSITIONS` (unchanged) and a new `REVIEW_RUN_TRANSITIONS` sit side by side in
`shared/api.ts`, read through one `transitionsFor(kind)`; every route that consults transitions
consults it by kind.

### 5.3 The done-fingerprint — the load-bearing difference

A work run's done claim is `{branchTip, handoffCommit, prNumber, prPhase}` and `verifyDone` re-measures
it against git and `.prhistory`. A review run's done claim is:

```json
{ "reviewedTip": "<40-hex sha>", "report": "<absolute path>" }
```

`reviewedTip` is the worker branch's tip **as the reviewer measured it when it began reading**. On close
the server re-measures that branch's tip **now** through the same `gitref.ts` read the work path uses:

| condition | verdict |
|---|---|
| live tip `≠ reviewedTip` | **`stale-review`** — the report is evidence about a commit that is no longer the tip; the coordinator must not rule on it |
| `report` absent or unreadable | **`report-unreadable`** |
| `reviewedTip` not 40-hex, or `report` not absolute | `bad-request` |
| otherwise | `done` |

No PR check, no `.prhistory` read — a review run has neither. This is the parent's *"never believe a done
claim"* (D-6) applied to a new kind of claim: the reviewer says *"I read T"*, and the server confirms T is
still what there is to read.

### 5.4 Slot and workspace

- A review run counts against `running` while `dispatched` or `working` (§7). It is real work on a real
  session. Because the idle worker no longer counts (§7), the reviewer's slot **replaces** the worker's
  rather than adding to it.
- Minted by the same fresh-spawn path as a worker — `ws-add --no-rc <project>` — on the **same project**
  (it must read that repo), with its own `ws/<slug>` branch. Released on its own close. Archive stays a
  human act (parent §"Wave lifecycle", coordinator skill :320–321).
- **Hold reason:** `program:<slug> wave:N/M run:<reviewRunId>` — the worker's wave, the review run's own
  id. This already satisfies `HOLD_REASON_PATTERN` (`server/src/coord/rundefs.ts:93`,
  `^program:[A-Za-z0-9._-]+ wave:[0-9]+(?:/[0-9]+)?(?: run:[0-9]+)?$`), which the session hook and
  `holdReasonVerdict` both enforce. **No grammar change, no hook change.** Kind rides the wire
  (`RunSummary.kind`), never the reason string — `rundefs.ts`'s own docstring already forbids reading ids
  back out of it.

### 5.5 Why a run, not a work item

The parent lists *"review X"* as a `WorkItem`. A work item has no session, no slot, no fingerprint and no
hold; a reviewer needs all four. Making it a work item on the worker's run would either leave a live
reading session uncounted by the cap, or require the cap to count sessions rather than runs — a larger
change to a predicate that already has one careful narrowing (D-13). A run of a new kind reuses every
mechanism and adds one column.

## 6. Lifecycle and data flow

```
W: working ─── wave-done mail (fingerprint in body) ───▶ coordinator wakes
   coordinator: re-measure; POST advance W → awaiting-review           [W stops counting]
   coordinator: POST runs {kind:review, reviews:W}; POST dispatch R      [R counts]
   coordinator: end turn

R: measure W's tip = T; fetch T into own worktree; lenses + whole-branch pass
   write report atomically (temp + rename) to <abs path>
   mail review-done {reviewedTip:T, report:<path>}

coordinator wakes: POST close R {fingerprint:{reviewedTip:T, report}}
   server: live tip ≠ T → 409 stale-review          → coordinator opens R2 against the new tip
   server: tip == T, report readable → R done       [R's slot and workspace freed]
   coordinator: read report; RULE
     clean      → advance W → merging; merge; close W
     send-back  → advance W → working (cap-checked, §7; refused review-in-flight if R still open)
                  mail W the report as its fix-round brief (D-2824; not dispatch) → W fixes → wave-done → new R2
```

Review runs are never reused. Every wave-done — first or after a fix round — gets a fresh review run
with its own `reviewedTip`, so a report and the tip it describes are always one pair.

## 7. The cap change

### 7.1 What `running` counts

```ts
// shared/api.ts — defined ONCE; every consumer derives from it
export const ACTIVE_RUN_STATES   = ['dispatched', 'working', 'unknown'] as const;
export const IDLE_RUN_STATES     = ['planned', 'awaiting-review', 'merging', 'closing'] as const;
export const TERMINAL_RUN_STATES = ['done', 'failed'] as const;
```

`unknown` — the revive artefact for a state token this build does not recognise — is **active**, for the
cap's own safe direction: an unrecognised row that counts wedges visibly and is fixable; one that does
not count over-dispatches silently. It also preserves today's behaviour, where `unknown` is not in
`('done','failed')` and so already counts.

`capsUsage().running` becomes *dispatched, and in an active state*:

```sql
SELECT count(*) FROM runs WHERE dispatchedAt IS NOT NULL AND state IN (<ACTIVE_RUN_STATES>)
```

with the `IN` list built from the constant, the way `TERMINAL_DELIVERY_SQL` is built from
`TERMINAL_DELIVERY_STATES`. The same two states are active for both kinds — a worker and a reviewer are
each busy in exactly `dispatched` and `working`. `awaiting-review`, `merging` and `closing` are the
**coordinator's** states; the session beneath them is idle by contract. (Run 43 sat at `merging` for
hours on 2026-09-14 awaiting an approval, its worker idle throughout — `merging` leaves the count for the
same reason `awaiting-review` does.)

D-13's own principle for this predicate — *"names the runs that actually hold a session rather than
every non-terminal state"* — is kept and sharpened: it now names the runs whose session is **working**.

### 7.2 Two pins

1. **Every `RunState` is classified.** A test asserts each member of `RunState` appears in exactly one of
   `ACTIVE_RUN_STATES`, `IDLE_RUN_STATES` or the terminal pair. A future state cannot be silently
   uncounted — the dangerous direction for a cap, since undercounting over-dispatches. The
   positive-list SQL is chosen *because* of this pin; without the pin the negative form would be the
   safer default.
2. **Re-entry checks the cap.** `POST /api/runs/:id/advance` with `to:'working'` from any idle state now
   runs `usage.running >= caps.maxConcurrentWorkers` exactly as dispatch does, refusing `cap-concurrency`
   with the numbers. `awaiting-review → working` is a legal edge; excluding the state without checking
   the edge is a bypass. A send-back on a full fleet is refused honestly and retried — the same shape as a
   fresh dispatch. **No priority for send-backs over fresh work in v1** (§12).

### 7.3 Knock-on: `maxSessionsPerDay`

`cap-daily` counts every dispatch in a rolling 24 h, and review runs are dispatches. A programme that made
N dispatches per wave now makes ~2N. The schema seed is 12. The plan raises this expectation explicitly
in the deploy notes rather than letting the first programme hit `cap-daily` and wonder why. The live
value is an operator dial (`POST /api/coord/caps`, bounded 1–64) and is not changed by this spec.

## 8. Surfaces touched

**Schema** — `coord.db` `user_version` bump adding `runs.kind` and `runs.reviews`; refuses to start
rather than opens empty, per the existing migration doctrine.

**Wire** (`shared/api.ts`) — `RunSummary.kind`, `RunSummary.reviews`: additive, absence-permits, one
reader per field, `FLEET_PROTO` stays 1. `ACTIVE_RUN_STATES` / `IDLE_RUN_STATES`. `REVIEW_RUN_TRANSITIONS`
and `transitionsFor(kind)`. New refuse codes `review-in-flight`, `stale-review`, `report-unreadable`
added to `RunRefuseCode` and its map (which the single-definition scan derives from).

**Routes** (`server/src/coord/routes.ts`, `close.ts`, `dispatch.ts`, `fingerprint.ts`):

| route | change |
|---|---|
| `POST /api/runs` | accepts `kind`, `reviews`. `reviews` required iff `kind:'review'`; must name a run of the same programme at `awaiting-review`; `claimedBy` must equal its; refuses `review-in-flight`. |
| `POST /api/runs/:id/advance` | `→ working` from an idle state: cap check (§7.2). On a **work** run, refuses `review-in-flight` if a non-terminal review run names it — the coordinator closes R before sending W back, so the pair cannot disagree about what is under review. Targets consult `transitionsFor(kind)`. |
| `POST /api/runs/:id/close` | `verifyDone` branches on kind (§5.3). |
| `POST /api/runs/:id/dispatch` | prefix by kind: `REVIEWER_KICKOFF_PREFIX` beside `WORKER_KICKOFF_PREFIX`, each invoking its skill. |
| `capsUsage` | `running` derived from `ACTIVE_RUN_STATES`. |
| `CoordStore.advance` (`store.ts`) | the one **writer** of `state` consults `transitionsFor(run.kind)`, not `RUN_TRANSITIONS` directly — the route-level checks above are the first gate, this is the last, and both read one table. |

**Skills** —
- New `ccd/reviewer-skill/SKILL.md` (`ccrc-reviewer`), its clauses pinned verbatim by
  `server/test/reviewer-skill.test.ts` exactly as the other two are. Shipped by the same installer list
  `ccd/ccrc` iterates for `install-coordinator-skill.sh` / `install-worker-skill.sh`, with an
  `install-reviewer-skill.sh` beside them. **AGENT-FIRST** (it lives under `ccd/`).
- Coordinator skill: the review clause inverts (§4); a review-run brief template joins `references/`.
- Worker skill: **unchanged**.

**Isolation is structural.** The reviewer's workspace has its own worktree and its own `ws/<slug>`
branch. Reaching the worker's branch requires a deliberate checkout, and nothing reads commits made on
the reviewer's own branch. The clause forbids the violation; the layout makes it visible.

**PWA** — a `kind` chip on the run board and the `reviews` link on review rows. Nothing richer.

**`ccrc-api`** — forwards the body it is given; `runs open` needs no change. The closed route table gains
nothing.

## 9. Invariants

1. **One authority.** Only the coordinator allocates deviations, writes the ledger, advances a work run,
   merges or closes. A review run's session never calls `advance`, `close` or `POST /api/ledger/deviations`
   on anything but its own report delivery.
2. **A report and its tip are one pair.** `stale-review` refuses a report whose subject has moved. No
   route lets a coordinator rule on a stale report.
3. **The pair never disagrees.** `review-in-flight` on both sides — open and send-back — means at any
   instant a work run has at most one non-terminal review run, and a work run under review cannot be
   moved back to `working` until that review run is terminal.
4. **`running` means running.** A dispatched session counts iff its run is `dispatched` or `working`, for
   either kind, and every `RunState` is classified.
5. **Reviewers never hold the worker's checkout.** Own worktree, own branch, fetched tip.

## 10. Failure modes

| case | behaviour |
|---|---|
| Worker pushes after wave-done while R reads | R's close → `stale-review`. Coordinator opens R2 against the new tip; R's report may inform R2's brief but is never ruled on. The worker broke its clause; the mechanism caught it. |
| Reviewer dies or limit-locks mid-read | R stays `working` holding its slot. Coordinator sees no review-done, closes R via the close route's `state:'failed'` arm, opens R2. A partial report is not a hazard: the skill writes temp-then-rename. |
| Work run abandoned while R reads | W's branch may be gone → R's close → `tip-unmeasurable` → coordinator closes R `failed`. |
| Cap full when dispatching R | R stays `planned`; coordinator retries next wake. W is at `awaiting-review` and not counting — a waiting review never makes the fleet fuller. |
| Cap full on send-back | `advance W → working` refused `cap-concurrency`; W stays `awaiting-review`; retried. Honest and symmetric with dispatch. |
| Coordinator absent at wave-done | Review waits for it. Accepted in fork 3; follow-up B is the remedy if measured (§12). |
| Coordinator sends W back with R open | Refused `review-in-flight`. The mistake is caught, not silently reconciled. |
| Second review opened for the same W | Refused `review-in-flight`. |

## 11. Testing

Every guard ships with a red, measured before and after, on fixture HOMEs only:

| guard | mutant that must red |
|---|---|
| `ACTIVE_RUN_STATES` classifies every `RunState` | add a member to `RunState`, classify it nowhere |
| re-entry cap check | delete the check from `advance → working` |
| `stale-review` | skip the live-tip re-measure in the review arm of `verifyDone` |
| `report-unreadable` | skip the stat |
| `review-in-flight` (open) | allow a second non-terminal review run for one `reviews` |
| `review-in-flight` (advance) | allow `→ working` with a non-terminal review run open |
| kind-aware transitions | let a review run reach `awaiting-review` |
| `capsUsage` derived from the constant | a second hand-written state list anywhere (`single-definition.test.ts` scan) |
| `REVIEWER_KICKOFF_PREFIX` dispatched by kind | swap the prefixes |
| reviewer skill verbatim | soften any clause (`reviewer-skill.test.ts`) |
| coordinator clause inversion | restore "review the handoff commit" (`coordinator-skill.test.ts`) |
| schema migration | opens an empty DB → refuses |

## 12. Out of scope — named, not forgotten

- **B — server-triggered reviewer dispatch** on a verified `advance → awaiting-review`. Justified only if,
  after this ships, verified wave-dones still sit unreviewed for hours: that is a coordinator being
  *absent*, not slow, and this spec fixes slow.
- **Per-PR mid-wave reviews.** v1 reviews the wave once at wave-done.
- **Send-back priority** over fresh dispatch when the cap is full.
- **Residency and archive automation.** Archive stays human; `maxResidentSessions` was rejected (§3).
- **Multiple reviewers per run / one per lens.**
- **Richer PWA review surfaces** beyond a kind chip and a link.

## 13. Parent spec amendments

Build 7's "Wave lifecycle" bullet currently reads *"…re-measures the done fingerprint, **reviews the
handoff commit**, updates the hold reason…"*. It becomes *"…re-measures the done fingerprint, **dispatches
a review run and rules on its report**, updates the hold reason…"*. §7 already says the coordinator
dispatches the review shape; the bullet is brought into line with it. `coordinator-skill/SKILL.md:300`
changes with it (§8).

## 14. Resolved during design

- **Hold reason for a review run** — reuses the existing grammar with the review run's own id (§5.4). No
  change to the hook, the pattern or the PWA.
- **Run vs work item** — run (§5.5).
- **Which states are idle** — `awaiting-review`, `merging`, `closing`, `planned` (§7.1); `merging` included
  on the strength of run 43's measured idle hours.
