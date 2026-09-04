# D-1157 — the `archived-but-live` census could never fire

> **Not a multi-task plan.** This is the ledger record for a single fix, written in
> plan shape because that is where this repo's deviation ledger lives
> (`server/test/deviation-refs.test.ts` derives the high-water from
> `## Deviations found` definition lines under `docs/superpowers/plans/`).

**Goal:** Make `divergence.ts`'s `archived-but-live` arm capable of firing at all, and
make the seam that broke it state its own units.

**Architecture:** One named conversion function, one renamed field on a pure function's
input type, one call site. No new I/O, no schema change, no wire change.

---

## What was measured

`ccd` writes `.supervised` with `date +%s` — epoch SECONDS, and `registry.ts`'s own field
docstring says so: *"Epoch SECONDS, registry-native like `stopped`/`supervisedAt` —
`fleet.ts` is the one place it becomes ms."* `sweepDivergences` handed the raw stamp to a
census that computes `input.nowMs - r.supervisedAt` against `SUPERVISED_FRESH_MS`
(120 000 ms). The age came out around **1.78e12 ms** for every row ever measured — five
orders of magnitude past the window — so the arm `continue`d every time and
`archived-but-live` could not fire on any input.

The condition itself is real and was seen on the live box: the arm's own comment records
*"Four such rows were measured on the live box, every one of them stamped `merged:#N`."*
Those four were found by hand. The census that exists to find them never has.

## Why no existing test caught it

`divergences()` is pure and **correct given milliseconds**. `divergence.test.ts` supplies
milliseconds (`supervisedAt: NOW - 30_000`) — units production never produces — so the
unit tests passed on inputs the producer cannot generate. The defect lived entirely at the
seam between a correct producer-side record and a correct pure function, which is the one
place neither side's tests look.

That is why the fix ships with a **seam** test rather than another unit test: it plants a
registry row the way the supervisor writes one (`String(Math.floor(Date.now()/1000))`) and
drives the real `sweepDivergences`. It fails on `main` with `expected [] to deep equally
contain …` — an empty census — and passes after.

## Deviations found

- **D-1157** (2026-08-31) — `sweepDivergences` fed `SessionRecord.supervisedAt`, epoch
  SECONDS, into `DivergenceInput.records[].supervisedAt`, which `divergence.ts` compares
  against `input.nowMs`. Every computed age was ~1.78e12 ms, so the `archived-but-live`
  arm could never fire. Fixed at the producer, and the seam now declares its own unit:
  the field is `supervisedAtMs`, and the conversion goes through
  `registrySecondsToMs` (`server/src/fleet.ts`), a named home for the sentence
  `registry.ts`'s docstrings had been carrying as prose. Types could not have caught this
  — both sides are `number` — but a name at the assignment site can, which is the whole
  reason the rename is part of the fix rather than cosmetic. `server/src/watch.ts` (the
  producer), `server/src/divergence.ts` (the field and the arm), `server/src/fleet.ts`
  (the conversion), `server/test/divergence-sweep.test.ts` (the seam tests, and the
  rewritten guard below), `server/test/divergence.test.ts` (fixture field renamed —
  its values were already milliseconds and were always right).

- **D-1158** (2026-08-31, found by running the full suite for D-1157) —
  `ccrc-install.test.ts`'s `ccrcEnv` contained the doctor's graphify shadow check by
  filtering exactly `/usr/local/bin` out of the child's `PATH`, because that is where the
  box the fixture was written on keeps a stray `graphify`. Containment pinned to a path is
  containment for one machine. A second fleet box keeps an unrelated `graphify` in
  `$HOME/.local/bin` (dated 2026-07-07, nothing to do with ccrc); `command -v graphify`
  resolved it, the shadow WARN fired, and `ends with doctor, and a box that passes every
  check exits 0` failed on a clean checkout of `main`. CI carries no stray `graphify` in
  any directory, so it stayed green and structurally could not have caught this. The
  filter now drops every directory but the fixture's own bin that resolves `graphify` —
  the property the surrounding comment already described in words.
  `server/test/ccrc-install.test.ts`. **Note the asymmetry: CI cannot prove this fix.**
  Only a box carrying a stray `graphify` can, and the evidence is that the suite fails
  before it and passes after, with the stray left in place.

## A guard that pinned spelling, and went red on a correct fix

`divergence-sweep.test.ts`'s "reads the heartbeat off the SAME records the tick already
measured" asserted the literal source text `'supervisedAt: r.supervisedAt'`. Its intent —
no second whole-fleet registry read per sweep — is right and worth guarding. Its
implementation pinned the assignment's spelling, so correcting the units, a change that
adds no read of any kind, turned it red: the fix for a real defect looked like a
regression in the test protecting the property the fix preserved.

It now pins the property: the heartbeat is fed FROM the records the sweep was handed, by
whatever transformation, and the body reads the registry no second time. `field(` was
added beside `readRegistry(` because a per-field re-read — precisely what the docstring
warns against — goes through it, and pinning only the whole-registry helper left that door
open. This is the third instance this week of the recorded failure mode *tests pin shape,
not effect*, and the first where the shape-pinning test actively resisted the fix.

## Audited, and clean

Every consumer of `SessionRecord.supervisedAt` in `server/`, `agent/` and `shared/` now
goes through `registrySecondsToMs`: `fleet.ts`'s `lifecycleInputFor` and `watch.ts`'s
census input. `shared/api.ts`'s `LifecycleInput.supervisedAt` is fed by the former and is
therefore milliseconds, correctly.

## Known, unfixed, and deliberately out of scope

1. **`LifecycleInput.supervisedAt` (`shared/api.ts`) carries the same latent hazard** — a
   `number` whose unit lives only in prose. It is correct today because its one producer
   converts, but nothing at the seam says so. Renaming it to `supervisedAtMs` would make
   the family consistent; it touches a shared L0 type the PWA also compiles against, has
   no measured defect behind it, and does not belong in a bugfix PR.
2. Carried forward from `2026-08-30-d1067-d1068-delivered-row-terms.md`:
   `mail_deliveries` binds a delivery to its recipient by `toId` alone with no recipient
   uuid, and both structural mail parks are silent to the sender.
