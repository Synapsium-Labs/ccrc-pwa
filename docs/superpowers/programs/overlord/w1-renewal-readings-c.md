# Renewal readings C: the builder's departures

Departures from `docs/superpowers/plans/2026-11-14-overlord-w1/w1-renewal-readings.md` found while building PR C (Tasks 5 and
6: the raised term, the changed class, the class a generation is minted under, and the `probes-failed-twice` latch), by slug.
No D-number is minted for them; the coordinator folds them into the plan's ledger. Measured on `main` at `b33a9ae137`.

## The latch (Task 6)

- **`lane-raises-the-latch-as-a-lane`**: the plan has the lane call `latch('probes-failed-twice', detail, 'renewal-lane')`, a
  string raiser. Since the plan was written, the ladder's one raise path (`overlordLadderRead.ts#raiseLatch`) takes a
  `BrakeActor`, which `overlordLadderStore.ts#ladderActor` accepts only when an adapter minted it (a `RecordedActor`, or the
  console's answer). A server lane is no caller: it has no caller strength, and adding one (`server`) would widen
  `shared/overlord-identity.ts`'s vocabulary and the designation table's `CHECK` constraints for a fact the ladder alone
  needs. So the ladder store mints its own frozen `LaneRaiser` (`laneRaiser('renewal-lane')`), remembered in a module-private
  `WeakSet` as the attribution adapter remembers its actors. `ladderActor` takes it on the brake side only and records its
  lane name in `raisedBy`; a widening refuses it, and so does a structurally equal literal. The lane names are a const map
  (`overlordLadder.ts#LANE_RAISER_MAP`, the ladder's vocabulary, so `isLadderKebab` declares them), one row today.
- **`latch-port-carries-no-actor`**: the lane's port is `GenerationsDeps.latch(cause, detail)`, with no `raisedBy`: the wiring
  binds the raiser, so the lane imports nothing of the ladder (its "nothing that sends" pin holds, with
  `./renewalReadings.js` added to the allowed list). It answers `{ ok: true }` or `{ ok: false, why }`, where `why` is the
  ladder's refusal word, so the lane logs a refusal once, with its word, and never throws.
- **`latch-clear-stays-the-operators`** (the operator's standing direction of 2026-11-22, checked): clearing this latch is a
  widening of the Overlord's authority, behind the account gate (Table 7.5a, §7.5), so it is an operator-only act and not a
  chore the system could take. Nothing here adds a manual step: the ladder's existing clear door is the way back.
- **`failed-or-lost-latch-raise-is-not-retried`**: the lane asks once, after writing the degrade step. A refused or thrown
  raise is logged; a crash between the step and the raise can lose it. The lane does not ask again, so if no latch was
  recorded, no latch from that step outlives the next renewal. The coordinator accepted this limit in review 3460 and
  carries it forward for the wave that first lets a rung above `chat` depend on this latch.

## The designation's readings (Task 5)

- **`unmeasured-designation-mints-nothing`**: the plan says a mint whose `designationRead()` answers `unmeasured` stamps
  `null`. On `main`, designation A's pass fails the mint step closed on an unmeasured designation (`fail('designation', …)`),
  so no such mint happens. `designatedClassAtMint` keeps the `null` arm anyway, so the decider stays total.
- **`in-place-bind-reads-class-unmeasured`** (historical slug): in-place designate re-stamps only identity and term. A
  generation minted as a coordinator keeps that role and `designatedClass` `NULL`; the wiring takes neither designation
  reading for it, and role-change renewal applies instead. The next mint under the `overlord` identity stamps the class.
  A pending rebind body mints under its own identity and stamps `NULL`; its go-live re-stamp is not active at this tip.
  The daily backstop is unchanged.
- **`designated-class-read-as-written`**: the plan narrows the column to a class word or `null`. The reader keeps the stored
  text (`strOrNull`), so a class word a later build writes compares honestly against the row's `model` rather than folding
  into `null`, whose reason (`minted before the class was recorded`) would then be false.
- **`designation-read-once-per-pass-in-the-wiring`**: the wiring reads the designation once per pass, for Overlord generations
  only; a throwing read makes both `termRaised` and `classChanged` unmeasured `designation read failed`, each logged once
  (review 2183 F17's per-reading catch).

## Placement

- **`designated-class-tests-in-own-file`**: the column's tests (migration, mint, read) are in a new
  `server/test/continuity-designated-class.test.ts` rather than the generations store's suite, so this PR adds no hunk to a
  file a W1 peer is editing.
- **`migration-121-provisional`**: after integrating the cap-mode migration from `main`, the designation-class column is
  appended at migration 122. Before landing, re-measure the actual tail and re-pin if it moved; no slot is reserved.
- **`latch-call-site-in-on-step`**: the lane asks `probesFailedTwiceOf` in `onStep`, which both apply loops (the walk's and
  `applyFedEvents`) call after a written step with the row before the step, so the probes feed's degrade reaches it.
