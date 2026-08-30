# D-1066 — a delivery to a session that is gone for good stops retrying

> **Not a multi-task plan.** This is the ledger record for a single fix taken on an
> operator ruling, written in plan shape because that is where this repo's deviation
> ledger lives (`server/test/deviation-refs.test.ts` derives the high-water from
> `## Deviations found` definition lines under `docs/superpowers/plans/`).

**Goal:** Stop `sweepMail` retrying for ever against a recipient the registry can prove
is never coming back, without breaking the case D-309 was written to protect.

**Architecture:** One rung of the delivery ladder splits on `sessionLifecycle`. No new
I/O, no new timer, no new route, no schema change. `MailGate` gains one additive member.

---

## What was measured

On the live fleet, a delivery addressed to the archived workspace `ccrc-pwa-amber-cove`
sat `queued` for 22.5 hours and was refused **6,769 times** — once per `MAIL_SWEEP_MS`
tick, at `tmux-gone`, with no terminal state, no backoff, and nothing telling the sender.
The registry carried `.archived` and `.stopped` stamps written 2026-08-29 11:29, and the
session's unit was `inactive`.

D-792's gate columns, which shipped two days earlier, are the only reason this was
visible at all.

## Why D-309 was right and still incomplete

D-309's premise is stated in its own comment: *"the mail waits for the session to come
back."* That holds for a swap, a restart or a reboot. It is false for a session somebody
archived — `ws-archive` unsupervises through `_ws_unsupervise`, which writes the stop
stamp, so an archived workspace reads `stopped`.

The rung's question is therefore not "is the pane gone" (`sv.verdict` already answered
that) but **"is it coming back"**, and `sessionLifecycle` already draws that line.

## Deviations found

- **D-1066** (operator ruling 2026-08-30) — `sweepMail`'s `tmux-gone` rung splits on the
  recipient's `SessionLifecycle` instead of treating every missing pane as recoverable.
  A recipient reading one of the three dead words (`stopped`, `orphan`, `never-started`)
  records the new `session-dead` gate and takes the registry-absent rung's terms — back
  off, count toward `MAIL_MAX_ATTEMPTS`, park `rejected('undeliverable')` at the ceiling.
  Every other lifecycle keeps D-309's bare silent wait, `unmeasurable` explicitly
  included, because doubt is not evidence. Refines D-309 rather than reversing it.
  `server/src/watch.ts` (the rung), `shared/api.ts` (`LIFECYCLE_DEAD`, `lifecycleIsDead`,
  `DEAD_LIFECYCLES`, the `session-dead` member), `server/src/fleet.ts`
  (`lifecycleInputFor`, extracted — there are now two callers).
  **The park is gated on `deliveredAt === null`**, honouring `MAIL_MAX_ATTEMPTS`'s own
  stated contract: a delivered row's history already disproves `undeliverable`, and its
  `attempts` column is deliberately uncapped, so parking on it would both write a false
  record and let a row already at 5 park on its FIRST observation with no backoff.
  Adversarial review found that omission before merge; a delivered row now backs off on
  the never-ratcheting terms and leaves replay to `MAIL_REPLAY_MAX_ATTEMPTS`.

## Known, unfixed, and deliberately out of scope

Both found by this change's own review, both **pre-existing on `main`**, both carrying a
measured reproduction. Bundling either into this PR would put an unrelated behaviour
change under a review aimed at something else.

1. **`registry-absent` has the same missing `deliveredAt` guard** that D-1066's rung was
   corrected for (`server/src/watch.ts`, the registry rung's park). Same false
   `undeliverable` on a delivered row, same uncapped-`attempts` early park.
2. **`sweepDivergences` feeds `supervisedAt` (epoch SECONDS) against `nowMs`
   (`Date.now()`)**, so `divergence.ts`'s `archived-but-live` arm computes an age of
   ~1.78e12 ms and `continue`s for every row — the census can never fire. Its own suite
   pins the arm's shape on millisecond fixtures production never supplies, which is why
   nothing caught it. This is the third consumer of `SessionRecord.supervisedAt` and the
   one the `lifecycleInputFor` extraction did not reach.

3. **The `session-dead` park is silent to the sender** — no `tellSender`. This is
   consistent with the `registry-absent` park it deliberately mirrors (also silent), and
   `tellSender` is not even in scope at that point in the method. Worth doing for both
   structural parks together, as its own change.
