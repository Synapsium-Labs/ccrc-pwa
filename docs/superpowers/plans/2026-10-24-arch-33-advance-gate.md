# `/advance`'s ordered gates move to a pure L1 decider (#550, ARCH-33) — Implementation Plan

**Issue:** #550, ARCH-33, under epic #521 ("Decide in L1, act in L4"). It follows the pattern of
`openRunPreconditions` (ARCH-21, #579).

**Status:** complete in one PR. The wire answers are unchanged.

## The gap

`POST /api/runs/:id/advance` decided six ordered gates inline in its handler in `server/src/coord/routes.ts`: the
run read (an unreadable store, an unknown run), the transition edge, the dispatched session, a review in flight,
the concurrency cap and the stored-id re-check. Each refusal was an inline send. The order in which they answer
was tested nowhere outside inject.

## Changes

- `server/src/coord/advance.ts` (new, L1, value imports from `shared/api.ts` only):
  - `advanceRequest(idParam, body)` checks the canonical run id and the body shape (both `bad-request`), then the
    target scope (`bad-transition` with `detail`).
  - `advanceGate(facts)` runs the gate table `ADVANCE_GATES` in order: `read`, `edge`, `dispatched`,
    `reviewInFlight`, `cap`, `storedId`. The first refusal wins. The lookups are passed in and called lazily, so a
    refusal costs only the reads ahead of it. An admitted request carries the run it read, so the route reads once.
- `server/src/refuse.ts`: `refuseAdvance` answers every gate refusal, on top of ARCH-11a's `refuseRoute`.
- `shared/refusal.ts`: `ADVANCE_REJECT_STATUS` holds the HTTP status for each `reject.code`, measured from the old
  inline sends.
- `server/src/coord/routes.ts`: the handler gathers the facts and acts. The act (`verifyDone` re-measurement,
  `CoordStore.advance`, read-back) is the sibling closure `advanceAct`. The two sends left inline there are not
  gates, and the `refusal-status` ratchet counts them (pin 149 to 137).

## Deviations found

D-6733 is defined here, once.

- **D-6733** — `/advance`'s six gates are decided by a pure L1 decider, `coord/advance.ts`, in a fixed order that is
  the contract: `read`, `edge`, `dispatched`, `reviewInFlight`, `cap`, `storedId`, first refusal wins. The route is
  act-only (at most four ifs, none of the decider's inputs named). Every gate refusal answers through
  `refuseAdvance` and the `ADVANCE_REJECT_STATUS` table. Only the act's `verifyDone` verdict and
  `CoordStore.advance`'s own refusal stay inline. The issue sketched `{ok:true} | {refused: RunRefuseCode}`, but
  the wire has three refusal shapes (`bad-request`, `run-unreadable` with `detail`, a `reject` object), so the
  decider returns the union `AdvanceRefusal`. `bad-session` (spec §2.3's stored-id re-check) is gate six, and it
  does not refuse a retreat to `working`, which composes no argv. Held by `advance-gate.test.ts` ("covers every
  gate in ADVANCE_GATES with a single-gate row, and names no other", "every adjacent pair in ADVANCE_GATES is a
  table row or a stated exclusive pair", "reads nothing past the first refusal and the run once", "holds at most 4
  ifs", "answers every gate refusal through refuseAdvance, with no inline reject of its own"), by
  `advance-gate-order-route.test.ts` ("bad-session answers before any re-measurement on a forward edge", "a legal
  retreat with a bad stored session id is not refused by bad-session") and by the `coord/routes.ts` pin in
  `refusal-status.test.ts`.

Issued and unused: none
