# D-1067 / D-1068 — what a DELIVERED row is owed at a structural gate

> **Not a multi-task plan.** This is the ledger record for two small fixes to one
> seam, written in plan shape because that is where this repo's deviation ledger
> lives (`server/test/deviation-refs.test.ts` derives the high-water from
> `## Deviations found` definition lines under `docs/superpowers/plans/`).

**Goal:** Make `sweepMail`'s two STRUCTURAL park rungs treat a delivered row on the
terms `MAIL_MAX_ATTEMPTS`'s own docstring already sets out — and that the send-failure
park has honoured since review finding 4.

**Architecture:** Two conjuncts and one boolean. No new I/O, no new constant, no new
gate, no schema change, no wire change.

---

## Why both, in one change

`sweepMail`'s delivery ladder has three places that can end a row. The send-failure
park at the bottom of the loop asks `d.deliveredAt === null` before rejecting and says
why in its own comment. The two STRUCTURAL rungs above it — `registry-absent` and
`session-dead` — did not agree with it, each in a different direction:

| rung | a DELIVERED row got | should get |
| --- | --- | --- |
| `registry-absent` | parked `rejected('undeliverable')` at the cap | back off, never park |
| `session-dead` | a flat 30 s step, for ever, no ceiling | back off on the climbing schedule |

Both were measured before either line was written, on the shipped build, with the
temporary instrumentation removed before commit:

```
registry-absent, DELIVERED row      session-dead, DELIVERED row
0: attempts=1 step=30000ms          0: attempts=0 step=30000ms
1: attempts=2 step=60000ms          1: attempts=0 step=30000ms
2: attempts=3 step=120000ms         ...
3: attempts=4 step=240000ms         38: attempts=0 step=30000ms
4: attempts=5 step=480000ms         39: attempts=0 step=30000ms
5: state=rejected                   => 40 re-examinations spanned 0.50h
```

They are one change because they are one question — what is a delivered row owed at a
gate that returns before any send is attempted — and because fixing either alone leaves
the two rungs disagreeing with each other as well as with the send path.

## Deviations found

- **D-1067** (2026-08-30) — `sweepMail`'s `registry-absent` park gains the
  `d.deliveredAt === null` conjunct the SEND-failure park ~250 lines below it has
  carried since review finding 4, and for the reason that park's own comment gives:
  the two spend the SAME budget, and `MAIL_MAX_ATTEMPTS` is scoped by its own
  docstring to a row whose `deliveredAt` is still null. Without it a delivered row
  whose recipient had been reaped was recorded `rejected('undeliverable')` — a false
  record of a message that demonstrably arrived, and one `markAcked` refuses, so a
  recipient brought back by `ccd start`/`ws-restore` could never ack it; and because
  `attempts` is one cumulative column a delivered row leaves uncapped, a row already
  at 5 from earlier replay backoffs parked on its FIRST observation here with no
  backoff at all. The existing `else` arm already had the right terms for that row.
  Found by the adversarial review of D-1066, recorded there as out of scope, fixed
  here. `server/src/watch.ts` (the registry rung).

- **D-1068** (2026-08-30) — **corrects D-1066's own delivered arm.** That arm shipped
  with `countsAsAttempt: false`, reasoning that a delivered row must not ratchet
  toward a park it does not own. Right about the park, wrong about the clock:
  `attempts` is also what the backoff step is computed FROM, so freezing it pinned
  every step at `MAIL_BACKOFF_BASE_MS` and `Math.min` never bound. Measured on the
  shipped build: 40 re-examinations in 30 minutes, for ever, against a recipient the
  registry proves is never coming back — and no ceiling of any kind, because
  `MAIL_REPLAY_MAX_ATTEMPTS` counts SUCCESSFUL replays and a row gated at this rung
  never gets one. That is the same every-tick-for-ever shape D-1066 was written to
  end, wearing a gate label. `MAIL_MAX_ATTEMPTS`'s docstring had already said what to
  do instead — "`attempts` keeps counting on a delivered row too … just without a
  ceiling that turns a failing SEND into a park" — and that an uncapped counter is
  precisely what makes `MAIL_BACKOFF_MAX_MS` reachable rather than decorative. The
  arm now backs off on the ordinary ratcheting terms, identical to the
  `registry-absent` rung's `else`, and the three-arm branch collapses to the same
  two-arm shape that rung uses. `server/src/watch.ts` (the session-dead rung),
  `server/test/mail-sweep.test.ts` (the assertion that pinned `attempts` at 0 —
  see below).

## A test of mine that pinned the wrong thing

D-1066's own delivered-row test asserted `expect(row.attempts).toBe(0)`, with the
message "this rung must not ratchet a delivered row toward a park it does not own".
It passed, it went red under mutation, and it was still wrong: it pinned the
implementation's shape rather than the contract's effect, and so it locked in the
30-second-forever loop as though a still clock had been the point. It now asserts the
counter ratchets past `MAIL_MAX_ATTEMPTS` while the row never parks — the two facts
that are actually owed. This is the recorded failure mode "tests pin shape, not
effect", caught in the same file that names it.

## Known, unfixed, and deliberately out of scope

Carried forward from `2026-08-30-d1066-dead-recipient-parks.md`, whose item 1 this
change resolves.

1. **`sweepDivergences` feeds `supervisedAt` (epoch SECONDS) against `nowMs`
   (`Date.now()`)**, so `divergence.ts`'s `archived-but-live` arm computes an age of
   ~1.78e12 ms and `continue`s for every row — the census can never fire. Its own
   suite pins the arm's shape on millisecond fixtures production never supplies.
2. **Both structural parks are silent to the sender** — no `tellSender`, unlike the
   send-failure park. Worth doing for both together, as its own change.
