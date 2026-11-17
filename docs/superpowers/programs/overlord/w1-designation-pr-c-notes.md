# Designation C: the builder's departures

Departures from `docs/superpowers/plans/2026-11-14-overlord-w1/w1-designation.md` found while building PR C (Tasks 8 and 9:
the model class and account set Settings doors), by slug. No D-number is minted for them (X9); the coordinator folds them
into the plan's ledger.

## Both doors

- **`settings-doors-answer-route-failed`** (review 2410 F1, the coordinator's ruling): a failed route write keeps the 200, and
  both doors answer a top-level `route: 'written' | 'failed'` beside `written`, so no reader has to look inside `written` to
  learn a body was not rewritten. `routeOf` decides it. Nothing on this tip rewrites the route record after a failed write; the
  healing is designation B's (carried below), and the Overlord cannot go Live before B lands, so no owed list here.
- **`account-pools-dedupe-first-seen`** (review 2410 F3): `parseAccountPools` keeps a name given twice once, at its first
  place, so the designate door and the set door store one spelling and warn an unknown name once.
- **`settings-doors-write-every-body-the-row-names`**: the plan says the model door writes `class` for the bound id, and the
  set door writes the set for the bound id. Both write every body the row names: the live one, then a pending one. A pending
  body was created with the old class and set on its route record, and nothing else would rewrite them before it goes live.
  A row that binds nothing is saved with no route write (`written: []`).
- **`settings-writers-record-their-actor`**: `setModelClass` and `setAccountSet` write the gate's actor to the row's `actor`, as
  `retire` does (`retire-records-its-actor`). Gates A's `RecordedActor` reaches them as it reaches the other writers (the
  brief's rule: whichever lands second makes the change).
- **`settings-journalled-flag`**: the store's one `append` now answers `journalled` (`appended` is true, `row-only` false), and
  both doors answer it, so a narrowing that landed as its row only says `journalled: false` (X3b).
- **`same-value-answers-changed-false`**: the model door's `none`, and an account set equal to the row's in membership AND
  order, answer `{ ok: true, changed: false }` with no authority record, no row write and no route write. The writers check
  the same thing again inside their transaction.
- **`settings-not-found-from-the-writer`**: a writer that finds no row (one removed between the verdict and the write) answers
  `{ ok: false, reason: 'not-found' }`, which the door maps to 404 `not-found`, the existing word.
- **`settings-doors-ask-the-step-up-for-a-bad-body`**: a body that does not parse asks the gate for a step-up, then answers
  400 `bad-request`; the door cannot know which way an unreadable body would move authority.
- **`write-class-through-the-route-composer`**: the body adapter's new `writeClass(id, cls)` is `ccd route --session <id> --set
  class=<cls>` through the adapter's one route composer, behind `route-v1`. It is the operator's door, so D-6790 (which
  refuses `fable` on a coordinator's box-token route write) does not reach it; a fixture-HOME test runs the real ccd and
  reads `class` back for `fable` and `opus`.

## The account set door

- **`set-door-reads-the-row-to-ask-the-step-up`**: whether a set widens depends on the row's current set, so this door reads
  the row once BEFORE the gate, only to choose `stepUp` (`accountSetStepUp`: a widening, or a row that cannot be read). The
  decider then re-checks the widening on the serialiser against the row it reads there, and refuses `step-up-required` (the
  gate's existing word, 403) when the gate was not asked for one. Without the re-check, a narrowing that passed the gate with
  no step-up would land as a widening if another act narrowed the set first. No new refusal word.
- **`single-account-warning-reuses-the-word`**: with no body bound or pending, fewer than two counted accounts is saved for the
  next Start and answers the warning `{ warning: 'overlord-single-account', count }` beside `unknown-pool`. A set re-sent
  unchanged also only warns, even while bound, since it changes nothing.
- **`org-spread-unmeasured-on-any-unmeasured-account`** (K2a): Table 4's "C56's count unmeasured" is read as any listed
  account whose servability is unmeasured. `orgSpread` then answers `unmeasured` and the warning says nothing, so a partial
  figure never claims one organization. Otherwise it spreads the counted accounts' labels.
- **`set-door-answers-the-list-and-spread`**: the answer carries `accountPools`, the C56 `accounts` (list, counted,
  unmeasured), `warnings`, `orgSpread` and, on a change, `journalled` and `written`.

## The model door

- **`model-door-recounts-c56`** (the coordinator's ruling, replacing the open question `model-door-does-not-recount`, then
  narrowed by review 2410 F2): the plan's `modelClassVerdict` answered only `none` or `set`, so a change to `fable` with fewer
  than two accounts that can serve it was saved, and from then on the set door, which counts under the row's class, refused
  every change while bound. The decider now counts C56 again under the NEW class. A move to `fable` (a widening) with a body
  bound or pending and fewer than two refuses `overlord-single-account` (the set door's word, with the count) and writes
  nothing. A move to `opus` narrows authority, and the operator can always narrow: below two it answers `set` with the
  warning `{ warning: 'overlord-single-account', count }`, never a refusal. With no body either class is saved for the next
  Start with the same warning. The set door keeps the plan's rule: a set that leaves fewer than two refuses while bound or
  pending.

## Carried to designation B

- **The route record heals at each renewal** (review 2410 F1): B's write-set step (plan Task 10) rewrites `class`, `poolset`
  and `acctorder` from the row before every renewal. The plan's Task 10 names only `poolset` and `acctorder`; `class` joins
  them, since a failed `writeClass` here is otherwise never rewritten.
- **Settle on the serialiser** (review 2410 F6): B's settle step (`goLive` on a rebind) runs on the coordination serialiser,
  so the set door, which reads its bodies in the decider and writes after an `await`, can never rewrite a body that just
  lost its binding.

## Growth

Measured with `server/test/growthCheck.ts` against `origin/main`: `server/src/coord/store.ts` +2 (two one-line delegates).
`server/src/server.ts`, `server/src/watch.ts`, `server/src/coord/schema.ts` and `shared/api.ts` are unchanged. No migration.
