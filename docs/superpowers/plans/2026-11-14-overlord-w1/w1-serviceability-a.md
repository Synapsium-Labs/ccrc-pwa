# Overlord W1 serviceability, PR A: the builder's notes

PR A of `w1-serviceability.md` (Tasks 1 to 3). This note records what the build found and where it departs from the
plan, by slug, for the coordinator to fold into the ledger. No number is minted here.

## Built as planned

- Task 1: `shared/rosterFacts.ts`; the two facts in `parseRoster`, `rosterFromJson`, `accounts.sh`
  (`_ccrc_fable_billing`, `_ccrc_continuity`, always emitted) and `RosterWire`; two README mirror-table rows.
- Task 2: `serviceability(cls, lane, asking, nowS)` and `askingOf`; `_serviceable` and `_class_gate` take the asking
  session's id; the id reaches `_swap_target`'s five gates, `_affinity_cur_serves` and the settle; the settle's
  `continuity-unmet` arm (F4); `_CCD_ROSTER_FNS` names the two new functions.
- Task 3: the account set door's two keys and the widening step-up (F10), the verb's two flags, and the `set-facts` op
  (F11).
- The plan's rulings hold: three inputs, not four; a set-side asker meets the continuity arm whatever its class (F8);
  ccd reads a session's side only behind an existence check on `$REG/<id>.poolset` (F7); unset and unread facts refuse
  with their own words.

## Departures

- **`set-side-pays-a-fork-per-read`.** The plan expected one extra fork a `_serviceable` call for a set-side session.
  Measured: three, one each for the side read (`_session_pool_side`), the continuity read and, for `fable`, the
  billing read, each a command substitution. The new `ccd-tick-budget` case (`fable` with a pool set, a continuity
  record and `included` billing on every lane) measures 101 forks and 34 execs a steady tick, against 98/34 for the same
  fixture before this change (its pool rule's own set reads) and 92/34 for plain `fable`. A session with no `poolset`
  entry makes no new fork, and every existing fixture's budget is unedited.
- **`account-op-growth-over-the-estimate`.** `deploy/account-op.mjs` grows by +30 net lines against the plan's
  estimate of about +24, under the 40-line limit, so no waiver.
- **`continuity-after-fable-mutant-is-a-drop`.** The plan's mutant "the continuity arm moved after the `fable` arm" is
  not one text replacement. `serviceabilitySets.ts` drops the arm instead, which the no-record `fable` row catches
  (`servable`). A drop-and-re-add variant was equivalent and was removed.
- **`stored-value-mutant-needs-a-stored-record`.** The door's "compare against the stored value" mutant is caught by
  the case whose stub answers with a stored `continuity` record. The plain `ROUTES` rows run with no stored facts and
  do not catch it alone.
- **`billing-words-spelled-in-bare-node`.** `shared/roster-json.mjs` and `shared/generate.mjs` run under bare Node and
  cannot import `shared/rosterFacts.ts`, so each spells `included` and `credits` once. `roster-exec-parity.test.ts`
  pins the mirror's list to `FABLE_BILLINGS`.
- **`asking-has-a-derived-list`.** The wire-totality guard needs a runtime list for every exported literal union, so
  `shared/serviceability.ts` exports `ASKINGS`, derived from a `Record<Asking, true>` map.
- **`api-ts-twentieth-import`.** `shared/api.ts` imports `RosterFactsWire` from `./rosterFacts.js` on its own line, so
  `peers-claims-l0.test.ts`'s import pin counts twenty lines.
- **`pool-set-fixtures-record-continuity`.** `ccd-pool-a3.test.ts`'s session has a pool set, so it is a set-side asker,
  and F8 holds it to a continuity record on every lane: with none recorded, `_swap_target` found no lane for it. Its
  fixture lanes now record one, so its cases still measure the pool rule alone. Pool set B and the designation should
  expect the same: a set-side session needs recorded lanes to be placed anywhere.
- **`departures-note-path`.** The brief names this file `w1-serviceability-a.md`; the plan's Global Constraints name
  `w1-serviceability/departures.md`. The brief's name is used.

## Measurements

- Growth against `origin/main`'s stages: `ccd/ccd` +13, `ccd/ccrc` +12, `deploy/account-op.mjs` +30,
  `shared/api.ts` +1, `server/src/server.ts` +1. `growth-check` armed is green.
- `shellcheck-ratchet` is killed at the test slice's memory cap on this box, so CI is its arbiter. Run directly,
  `shellcheck -S warning` reports the same 32 lines on `ccd/ccd` before and after the change.
