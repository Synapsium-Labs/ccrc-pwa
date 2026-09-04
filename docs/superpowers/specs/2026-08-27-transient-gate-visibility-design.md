# A delivery refused at a transient gate says so — design

> **D-792's own slice.** The ledger entry that recorded this
> (`docs/superpowers/plans/2026-08-26-ccrc-api.md`) ends "the fix is a visible
> rung for *refused at a transient gate, N times, since T*, and it wants its
> own slice rather than riding a nudge rewrite." This is that slice, specified.

**Goal:** an operator looking at a delivery that is not moving can tell *waiting*
from *wedged*, without reading `watch.ts`.

**Non-goal:** changing when, whether, or how often anything is delivered. Every
line of this design is observation. If it alters one scheduling decision it is
wrong.

## 1. What is actually wrong

`sweepMail` (`server/src/watch.ts`) walks a ladder of gates for each due
delivery. Two of them RECORD when they refuse — `store.backOff(...)` writes
`lastError` and `nextAttemptAt` — and the rest `continue` with nothing written
at all:

| gate | on refusal |
|---|---|
| already sent to this session this sweep (`seen`) | silent |
| a send already in flight (`mailInFlight`) | silent |
| `now - last < MAIL_COOLDOWN_MS` (120 s) | silent |
| registry row absent / unmeasurable | **`backOff` — recorded** |
| tmux verdict `unknown` | **`backOff` — recorded** |
| tmux verdict `gone` | silent |
| fresh hookstate carries an unanswered `ask` | silent |
| no pane pid, or no config dir for the wrapper | silent |
| live status not `idle` | silent |
| `statusUpdatedAt` null, or quiet < `MAIL_QUIET_MS` (60 s) | silent |

The silence is deliberate and, as a *scheduling* decision, correct — the loop's
own comment says so: those gates "are ORDINARY and expected to hold
indefinitely for a session that is merely busy, and must never accrue toward a
park." Charging them toward `MAIL_MAX_ATTEMPTS` would park the mail of every
busy worker.

**But "must not park" was implemented as "must not be written down," and those
are two different requirements.** The consequence, measured twice:

- **Delivery 76** (2026-08-26): `delivered`, `attempts: 0`, for **eleven
  hours**. `MAIL_SWEEP_MS` is 10 s, so it was selected as due and silently
  refused on the order of **4,000 times**. Every other surface reported health.
- **Delivery 86** (2026-08-27): `queued`, `attempts: 0`, `lastError: null`, for
  **30 minutes**, to a recipient whose hookstate read `{"state":"done","ask":null}`
  and had for twenty of them. Cooldown (120 s) cannot explain it. Nothing
  outside the loop could say which gate was holding it, or whether one was.

The second instance is the one that settles the shape of the fix: it had **no
visible cause from outside at all**. The only observable was a `queued` row.

## 2. Why every existing surface is silent, and why each is right to be

Three surfaces already exist that look like they should have caught this. None
should be changed.

- **`GET /api/peers`'s `deliverable`** (`server/src/coord/peers.ts`) reports the
  STRUCTURAL rungs only, and its docstring states the reason: reporting the
  transient rungs "would tell a caller a BUSY peer is unreachable — the exact
  lie R2 forbids." `deliverable` is a property of the PEER. Correct as written.
- **`MailSummary.attempts`** already exists on the wire for exactly this
  argument — "without it, a delivery blocked against a dirty input box for
  fifteen minutes is byte-identical to one merely waiting its turn." It counts
  **send failures only**, deliberately, so that it matches `MAIL_MAX_ATTEMPTS`
  exactly. A transient gate never reaches a send, so it never moves. Correct as
  written.
- **`RunSummary.unreadMail`** is a count of unacked rows. A count cannot carry a
  reason. Correct as written.

So the missing fact is not missing from any of them by accident: it is a
property of **the delivery**, not of the peer, and it is not a send failure. It
needs somewhere of its own.

## 3. The fix

Four columns on `mail_deliveries`, written by `sweepMail` on every gate
refusal — the two that already `backOff` included — and **read by no scheduling
decision anywhere**:

| column | means |
|---|---|
| `lastGate TEXT` | the gate that refused this row most recently, from a closed vocabulary |
| `gateCount INTEGER NOT NULL DEFAULT 0` | consecutive refusals at `lastGate` |
| `gateSince INTEGER` | when the current `lastGate` first refused this row, unbroken |
| `gateAt INTEGER` | when that most recent refusal was observed |

`gateCount` and `gateSince` reset when `lastGate` CHANGES — the question is
"how long has *this* gate been holding it", not "how long has it been stuck at
anything". `gateAt` is separate from `gateSince` because a sweep that has
stopped running leaves `gateSince` looking exactly like a sweep that is running
and still refusing; `now - gateAt` is the only thing that separates them.

All four are cleared when the row is sent, acked or rejected — a delivery that
moved carries no stale gate.

### The vocabulary

`MailGate` is a closed union in `shared/api.ts`, one member per CONDITION the
ladder can refuse on — which is not quite one per `continue`, and the gap is
itself worth taking: `if (!pid || !cfgDir) continue` folds two conditions an
operator acts on completely differently ("the pane is gone" vs "this wrapper
resolves to no config dir, which is a roster problem") into one silent exit.
Splitting it is a one-line change and the overloaded-collapse this tree bans by
name.

The union is derived the way this tree derives every runtime list — the array
comes from `Object.keys` of a total `Record<MailGate, …>`, never hand-written
(`single-definition.test.ts` scans for the second copy). A refusal path added to
the loop without a member here must not compile.

Naming follows the ladder, not the implementation: `cooldown`, `in-flight`,
`same-sweep`, `registry-absent`, `registry-unmeasurable`, `tmux-gone`,
`tmux-unknown`, `pending-ask`, `no-pane`, `no-config-dir`, `not-idle`,
`not-quiet`.

### Where it is written

One helper, called at each `continue`, so a gate cannot be added without
answering the question:

```ts
private gated(d: MailDelivery, gate: MailGate, now: number): void
```

It reads the row's current `lastGate` and either increments or resets. This is
the only writer. `store.backOff` keeps its own behaviour untouched — the two
recorded gates call `gated(...)` *in addition to* backing off, because the
backoff answers "when may this be retried" and the gate answers "what refused
it", and collapsing those is the defect this repo bans by name.

## 4. Schema

`user_version 5 -> 6`, its own migration (v1 is frozen; the live
`~/.ccrc/coord.db` is past it). `ALTER TABLE mail_deliveries ADD COLUMN` x4,
all nullable or defaulted, no index — nothing queries on them, by design. A
column any query filtered on would be a scheduling input, which §"Non-goal"
forbids.

## 5. Wire

`MailSummary` gains the four fields. **Additive — `FLEET_PROTO` is not bumped**
(it stays 1). A newer PWA must render an older server's row that omits them,
through a single reader, per the absence-permits rule.

`lastGate` is a CLOSED union on the wire and therefore may be keyed off a
total `Record` — the opposite of `lastError`, whose docstring forbids exactly
that because it is free text. The two sit next to each other in the same
interface, so the difference must be stated in `lastGate`'s own docstring or a
future reader will apply the wrong rule to it. Clients must still tolerate an
unknown member (an older client, a newer server): render the raw token, never
`undefined`.

## 6. Surface

The mail strip (`pwa/src`, pinned by `pwa/test/mail-strip.test.tsx`). A row
whose `gateCount` is above a threshold and whose `gateSince` is older than a
threshold reads, in words, which gate is holding it and for how long. Below
those thresholds it renders exactly as it does today — a worker busy for ninety
seconds is not a fault, and rendering it as one would re-introduce the R2 lie
from §2 on a different surface.

Thresholds are a rendering decision, declared in `shared/api.ts` beside
`SPAWN_STALL_MS` and for the same reason that constant exists: a threshold the
console draws on must not be a copy of a number the lane enforces.

## 7. What must not change

Stated so a reviewer can check them off, and so the plan's tests can pin them:

1. No gate's park/no-park behaviour moves. `attempts` still counts send
   failures only. A transient gate still never approaches `MAIL_MAX_ATTEMPTS`.
2. No `nextAttemptAt` is written by anything in this design.
3. `peerDeliverable` is not touched, and `deliverability-parity.test.ts` still
   passes unchanged.
4. `FLEET_PROTO` stays 1.
5. `sweepMail`'s ladder ORDER is unchanged — `gated(...)` records what already
   happened; it decides nothing.

## 8. The mutation table

Each guard ships with a test measured RED before the guard exists:

- delete the `gated(...)` call at any one gate → a test naming that gate fails
  (a table-driven fixture, one row per `MailGate` member).
- make `gateCount` accumulate across a gate CHANGE → red.
- fail to clear the four columns on ack → red.
- add a member to `MailGate` without a ladder call site → red (total-record
  scan, the `LIFECYCLE_RUNG` precedent).
- read any of the four columns in a `WHERE`/scheduling path → red (source scan;
  this is the one guard that protects the non-goal).

## 9. Open, for the operator

- **Thresholds.** A gate held for 5 minutes is ordinary for `not-idle` and
  alarming for `no-pane`. Per-gate thresholds are more honest and more to keep
  correct; one global threshold is cruder and cannot lie about which gate it
  came from. Recommendation: **one global threshold to start**, per-gate only
  once a real case demands it.
- **Retention.** These four columns make every delivery row grow a small
  history. Nothing here prunes; `coord.db` has no vacuum story in this design.
