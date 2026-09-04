# D-1067 / D-1068 / D-1069 — what a DELIVERED row is owed at the structural gates

> **Not a multi-task plan.** This is the ledger record for work on one seam, written
> in plan shape because that is where this repo's deviation ledger lives
> (`server/test/deviation-refs.test.ts` derives the high-water from
> `## Deviations found` definition lines under `docs/superpowers/plans/`).

**Goal:** Make `sweepMail`'s two STRUCTURAL park rungs treat a delivered row correctly —
which turned out to mean two different things at the two rungs, not one.

---

## The question, and why the two rungs answer it differently

`sweepMail`'s ladder has three places that can end a row: the SEND-FAILURE park at the
bottom, and two STRUCTURAL rungs above it, `registry-absent` and `session-dead`. The
send park has been wrapped in `if (d.deliveredAt === null)` since review finding 4.
This change began by assuming the two structural rungs should simply copy it. That was
half right, and the wrong half was caught before merge.

| rung | recipient state | can the id be re-minted? | so a delivered row … |
| --- | --- | --- | --- |
| `session-dead` | registry row EXISTS, lifecycle dead | no — the slug is still taken | never parks; waits, backing off |
| `registry-absent` | registry row PURGED | **yes** — `_ws_slug_new` recycles it | must still park; the lane has to end |

That asymmetry is the whole finding. `ccd`'s own comment says slugs are "144 per
project, recycled by ws-reap" and `_ws_slug_new` accepts any slug with no registry file
(`ccd/ccd:3489,3516`), so a purged id comes back — and `mail_deliveries` carries no
recipient uuid, so nothing downstream can tell the original recipient from the stranger
now wearing its id.

## Deviations found

- **D-1067** (2026-08-30) — **WITHDRAWN BEFORE MERGE. Number consumed, not reused.**
  Proposed adding `&& d.deliveredAt === null` to the `registry-absent` park, mirroring
  the send-failure park. Adversarial review found what that costs, and a test
  reproduced it: this park is the ONLY thing that ends the LANE for a delivered row
  whose recipient was purged. `cancelOutstandingDeliveries` is runId-scoped, so peer
  mail (`runId IS NULL`) is out of its reach; `MAIL_REPLAY_MAX_ATTEMPTS` counts
  SUCCESSFUL replays, which a row gated at this rung never gets. Unparked, the row
  stays due at the 15-minute ceiling for ever — and when `_ws_slug_new` re-mints the
  id, the lane types the stale envelope into an unrelated session. Measured with the
  conjunct in place: **12 tmux calls into the re-minted session**, against 0 with the
  park. `store.ts`'s own `OUTSTANDING_OR_ABANDONED_SQL` comment draws the line the
  proposal missed — a `rejected` row stays visible to a HUMAN ("is this worth a human's
  attention") while staying terminal for the LANE ("should the delivery lane act on
  this again"). Superseded by **D-1069**, which keeps the park and fixes the half of
  the original finding that was real.

- **D-1068** (2026-08-30) — **corrects D-1066's own delivered arm.** That arm shipped
  with `countsAsAttempt: false`, reasoning that a delivered row must not ratchet toward
  a park it does not own. Right about the park, wrong about the clock: `attempts` is
  also what the backoff step is computed FROM, so freezing it pinned every step at
  `MAIL_BACKOFF_BASE_MS` and `Math.min` never bound. Measured on the shipped build:
  40 re-examinations in 30 minutes, for ever, against a recipient the registry proves
  is never coming back — and no ceiling of any kind, because `MAIL_REPLAY_MAX_ATTEMPTS`
  counts SUCCESSFUL replays and a row gated at that rung never gets one. That is the
  same every-tick-for-ever shape D-1066 was written to end, wearing a gate label.
  `MAIL_MAX_ATTEMPTS`'s docstring had already said what to do instead — "`attempts`
  keeps counting on a delivered row too … just without a ceiling that turns a failing
  SEND into a park" — and that an uncapped counter is precisely what makes
  `MAIL_BACKOFF_MAX_MS` reachable rather than decorative. Now 30 s → 60 → 120 → 240 →
  480 → 900 and level. `server/src/watch.ts` (the session-dead rung),
  `server/test/mail-sweep.test.ts`.

- **D-1069** (2026-08-30) — the `registry-absent` park STAYS, and a delivered row now
  says why it parked. The real defect the D-1067 draft was reaching for is the
  SENTENCE, not the park: `'recipient not in registry'` beside `rejectCode:
  'undeliverable'` reads as "this never arrived", which is false for a row that was
  delivered, and `lastError` is free text a maintainer greps. A delivered row now parks
  with `'recipient purged after this message was delivered, and never acked'`. The ack
  door stays shut for both (`markAcked` admits only the replay-ceiling park) and that is
  correct here: a purge is permanent — `ws-restore` restores an ARCHIVED workspace,
  which keeps its registry row and therefore lands on the `session-dead` rung, not this
  one — so the only party that could ever walk through that door is a re-minted
  stranger. `server/src/watch.ts` (the registry rung).

## Two tests of mine that pinned the wrong thing

Both are the recorded failure mode "tests pin shape, not effect", and both were caught
in the same file that names it.

1. D-1066's delivered-row test asserted `expect(row.attempts).toBe(0)`. It passed, it
   went red under mutation, and it was still wrong: it pinned the implementation's shape
   rather than the contract's effect, locking in the 30-second-forever clock as though
   that had been the point. It now asserts the counter ratchets past `MAIL_MAX_ATTEMPTS`
   while the row never parks.
2. The D-1067 draft's own test asserted `expect(row.state).not.toBe('rejected')` — it
   pinned the regression. Replaced by two D-1069 tests: one that the row parks with the
   honest sentence, and one that the LANE is actually over afterwards, asserted by
   re-seeding the registry (the re-minted-slug world) and checking that nothing is typed
   into the session now wearing that id. That second assertion is the one that goes red
   at `expected 12 to be +0` under the withdrawn conjunct.

## Known, unfixed, and deliberately out of scope

Carried forward from `2026-08-30-d1066-dead-recipient-parks.md`, whose item 1 this
change addresses — by fixing the record rather than removing the park.

1. **`mail_deliveries` binds a delivery to a recipient by `toId` alone, with no
   recipient uuid.** This is the root cause behind D-1067's hazard: the lane cannot tell
   a recipient revived by `ccd start` from a stranger that re-minted the same slug. The
   park bounds the exposure to ~26 minutes after a purge; it does not close it. The
   principled fix is a `toUuid` column re-checked before the send, and it is a schema
   change with its own review.
2. **`sweepDivergences` feeds `supervisedAt` (epoch SECONDS) against `nowMs`
   (`Date.now()`)**, so `divergence.ts`'s `archived-but-live` arm computes an age of
   ~1.78e12 ms and `continue`s for every row — the census can never fire. Its own suite
   pins the arm on millisecond fixtures production never supplies, and
   `divergence-sweep.test.ts:674` asserts the literal source text
   `'supervisedAt: r.supervisedAt'`, so the correct fix turns that guard red despite
   adding no second registry read. Needs a SEAM test, not another unit test.
3. **Both structural parks are silent to the sender** — no `tellSender`, unlike the
   send-failure park.
