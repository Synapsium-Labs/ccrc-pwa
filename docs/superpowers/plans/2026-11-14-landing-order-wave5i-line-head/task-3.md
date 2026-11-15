# Task 3 note: the binding head, the main-red transition and Amendment A (D-8625)

Implemented in `server/src/coord/landingLine.ts` (`landingBindingOf`, `mainRedNext`, and `landingOrder`'s main-red
pausing) with additive L0 words in `shared/landingLine.ts` (`LandingBindingReason`, `LandingBinding`,
`LandingLineView.binding?`). The topological walk and the first-green surrogate are untouched.

## Red, then green (from `server/`, via `ccrc test --`, `--maxWorkers=2`)
- Red run of `test/landing-line-order.test.ts test/landing-control.test.ts` before any implementation: 26 failed
  (`TypeError: landingBindingOf is not a function` for the binding and transition rows; the C17 and exception rows on the
  order side).
- Green after implementation: 2 files, 93 passed.
- Production `tsc --noEmit`: exit 0. `pwa/` and `ui/` do not import `LandingLineView`, so the optional field touches no
  pwa compile.
- `test/single-definition test/coord-policy-rings.test.ts`: 2 failed, both in Task 2's files, none in a file this task
  touched: `advance-switches` literal-source-pin ratchet names `server/src/coord/lineageRead.ts`, and `vocabularies`
  absent/unreadable pair holders name `server/src/coord/radar.ts` beside `shared/agent-protocol.ts`. Left for the controller.

## Mutation rows (each restored from a saved copy, then the selection re-run green)
| Row | Mutant | Actual failure |
|---|---|---|
| M11 | `health.sha !== probe.baseSha` gate removed | `base mismatch...`: expected { mode: 'ready', entryId: 107, ... } to deeply equal { mode: 'held', ... } |
| M12 | selected head compared by PR only (full pinned sha dropped) | `head mismatch...`: expected { mode: 'ready', ... } to deeply equal { mode: 'held', ... } |
| fresh | probe freshness recheck at use removed | 2 failed: `probe and health availability...` and `freshness rechecked at use...`: expected { mode: 'ready', ... } to match object { reason: 'probe-unmeasured' } |
| unknown | unreadable open projection gate removed | 2 failed: `recovery holds...` (expected ready to match held) and `ORDER-unknown...` (reason 'projection-unreadable') |
| marker | unmeasured marker folded into inert | 2 failed: `unreadable: expected { mode: 'inert' } to deeply equal { mode: 'held', ... }` and the pause row |
| M13 | pending/unmeasured health clears red | `pending and unmeasured readings keep...`: expected { kind: 'set', value: false, ... } to deeply equal { kind: 'keep', value: true } |
| M15 | any fixesMain entry exempts main-red (jump) | 3 failed: ORDER-fix-blocked, cycle, operator rows (`expected { paused: false, ... } to match object { paused: true, by: ['main-red'] }`) |
| M15 | operator pause no longer suppresses the exemption | operator row: `expected { paused: true, ... } to match object { paused: true, ... }` |
| M15 | recovery hold dropped from the unpaused answer | 3 failed incl. `recovery still has no head...` |
M12's "later clean entry queues 0 mails" half and M13's mail half belong to Task 5.

## Departures
- departure: shared-api-import: `landingLine.ts` now value-imports `freshWithin` and `RADAR_PROBE_FRESH_S` from the L0
  `shared/api.ts` (the one freshness owner); the file's purity test now lists both L0 specifiers.
- departure: flag-not-gate: `landingBindingOf` reads `mainRedHold` as a fact and decides health policy from the fresh
  evidence, so green evidence with a not-yet-cleared flag binds ready (the flag clears on the same evidence in Task 5).
- Existing row C17 (`a fixesMain entry is held by main-red too`) is rewritten to the Amendment A behaviour.

## Decisions
Lander failure other than `absent`, a foreign or stale marker, and undefined control all hold `opt-in-unknown`; a cut head
list, an unreadable/stale/foreign probe hold `probe-unmeasured`; a health `unmeasured` state or null sha holds
`health-unmeasured`; duplicate heads for the selected PR hold `head-mismatch`.

## Fix round 1
- Open rows: `landingBindingOf` now holds `projection-unreadable` for any nonterminal row (an unrecognised state included)
  whose state is `unknown`, whose projection is missing, unreadable or carries a quarantine marker, or whose dependencies
  are unreadable. Terminal rows with damage still do not block. Header and `entryId` doc comment updated.
- Rows (red first: 1 failed, `expected { mode: 'ready', ... } to deeply equal { mode: 'held', ... }`): quarantined unknown,
  clean unknown, quarantined pinned hold; a closed row with an unreadable projection does not.
- Green: the two files, 94 passed; production `tsc --noEmit` clean.
- Mutation: the `unknown`/quarantine conditions removed (projection kind check only) -> `ORDER-unknown (fix round 1)`:
  `expected { mode: 'ready', entryId: 107, ... } to deeply equal { mode: 'held', ... }`; restored from a saved copy.

## Fix round 2
- `clear()` now accepts an open row only when `isLandingEntryState(state)` (the L0 guard) and the state is not `unknown`
  (so `pinned` or `ejected`), the projection is readable with a null quarantine, and the dependencies are readable; the
  comment says exactly that. An unrecognised state word such as `'mystery'` holds `projection-unreadable`.
- Red first (old code): `ORDER-unknown (fix round 2)`: expected { mode: 'ready', entryId: 107, ... } to match object { mode: 'held', ... }.
- Green: 2 files, 95 passed. Production `tsc --noEmit; echo rc=$?`: rc=0, no `error TS`.
