# A refused close never offers a door to a session that is gone

- **D-8558 (2026-11-12)** — `claimant-gone-doors`: a refused-close item whose claimant the registry no longer holds offers no `open-coordinator`; `refusedCloseDoors` (`server/src/coord/runClose.ts`, L1) decides the doors from what the lane measured, and the item offers `close-run` ("Close this run", the operator's abandon with a reason kept in the run's close detail), `hand-to-coordinator` while the programme can still take a run, and `end-programme` on the programme's last live run.

## Why

An operator report: a Waiting on you item raised by the run-close lane read "Coordinator not reached: <run> · wave 1 of 1 — ccrc
would close this run on its own after a warning, but the warning could not be delivered. Its coordinator is gone", and its only
control was "Open the coordinator", a door to a session that no longer existed (it had been forgotten weeks earlier). The run was
planned and never dispatched; its programme's work had landed elsewhere. `REFUSAL_DOORS` gave `warning-undelivered` the one door
`open-coordinator` whether or not the claimant's session existed, so the item carried no control that worked (against A62).

## What changed

| Layer | File | Change |
|---|---|---|
| L0 | `shared/ledgers.ts` | Two doors, `close-run` and `end-programme`, both abandoning (`ABANDONING_DOORS`). `refusedCloseDetail` and `refusedCloseReason`, the one writer and reader of the reason in `abandon:refused:<item> <reason>`. `parseItemActBody`, the one reader of `act`'s body: `reason` (one line, 1 to 120 characters) on a refused close, `programme` (`done` or `abandoned`, the plan's outcomes) only on an item offering `end-programme`, `abandoned` needing a reason; any other field refused. |
| L1 | `server/src/coord/runClose.ts` | `DoorFacts` and `refusedCloseDoors`: a held claimant keeps the reason's doors; one the registry does not hold turns `open-coordinator` into `close-run` (+ `hand-to-coordinator` while the programme lives), drops `hand-to-coordinator` from a programme that cannot take a run, and adds `end-programme` beside an abandoning door on the last live run. `refusalRoute` takes the facts (default: held, today's doors). |
| L3 | `server/src/coord/store.ts`, `ports.ts` | `programmeLive(slug)`: the programme's row is present and its plan is not closed (`planEnd` null). On the watcher port. |
| L4 | `server/src/coord/runCloseLane.ts`, `runCloseRefusals.ts` | The lane carries `held` (the reclaim ladder's `cause: 'absent'` is "the registry holds no row") on every refused close and reads the facts inside its hold. An OPEN item whose doors the facts changed is redrawn once (the old one settles, the new one is raised); a withdrawn or answered item is not open, so a refusal that lasts still acts once. One item per run per pass: a second item-raising reason of a run already routed in that pass keeps its anchor and raises nothing. The item's last line says "Its coordinator is gone, and its session no longer exists". |
| L4 | `server/src/coord/ledgersRoutes.ts`, `server.ts` | `POST /api/items/:id/act` reads its body through `parseItemActBody` alone: the reason goes into the run's close detail; `programme` is refused `plan-runs-open` before anything is closed unless this is the programme's last open run, and after the close sets `programs.state` (D-51's writer) and closes the plan through the plan port's `closePlan` (an abandon with a fixed why). Session-gated as before; no new route. |
| PWA L1 | `pwa/src/fleet/closeWords.ts` | "closed by you: done elsewhere" for a run closed with a reason; the offered reasons. |
| PWA L3/L4 | `pwa/src/lib/api.ts`, `fleet/AbandonSheet.tsx`, `ledgers/ItemActs.tsx` | `actItem` takes the optional body. "Close this run" and "Close and end the programme" sit on the item and open the abandon sheet's close-run mode: a reason picked or typed (required), the programme's end when offered (keep its plan open, done, abandoned; the end door opens with done picked), one confirm. |

## Deviations found

- The act route was pinned body-less (D-8076, `coord-pause-route.test.ts`, `item-act.test.ts`): it could not carry the reason, so it now
  reads its body through one reader that names no run and no archive, and refuses a body that names anything else (it used to ignore
  one). The pins now say exactly that.
- There was no operator door for a programme's end: `plan close` is the coordinator's box-token lane. Rather than a new route, the end
  rides the same `act` (one tap and confirm, the operator's own session, the close's `causedBy` already `operator`), because the
  programme can only end once the run is closed and the item is gone after its act. The two writers it calls are the existing ones
  (`setProgramState`, `closePlan`), so no fact gains a second writer. The operator's reason lives on the run's close detail, not
  the plan: the plan is synced to the tracker, and the operator's words are not judged for that here. A plan ended `done` keeps no
  why (the plan's own close allows that); one ended `abandoned` gets fixed words pointing at the run's record, because the plan's
  own close refuses an abandon with no reason (`dropped-needs-reason`).
- `programs.state` has no "who" column; the programme's end is attributed through the run's close event (`causedBy: 'operator'`).
- `programs.state` is no lifecycle gate: the close retires it whenever the open-run count reaches 0 (D-51) and `openRun` never sets
  it back, so a programme whose next wave is open can read `done`. `programmeLive` therefore reads the plan's end alone, the one fact
  that stops a run attaching (`plan-closed`); a retired programme whose next wave opened still offers "Hand to a coordinator".
- For the same reason "Keep its plan open" does not keep `programs.state` open: when the closed run was the programme's last open
  one, the close retires it (D-51) whatever the operator picks. The option keeps the plan open, so a later wave may still attach,
  and the sheet says so.

## Tests

- `server/test/run-close-refusals.test.ts`: the decider's table, THE PIN (no raising cell, under any facts with the claimant not held,
  offers `open-coordinator`, and none is empty), and the lane over a real store: a forgotten coordinator's undelivered warning raises
  Close this run, Hand to a coordinator and the programme's end; another open run drops the end; a closed plan drops the hand-over; a
  coordinator forgotten after its item was raised gets the item redrawn once; a dismissed item is not raised again.
- `server/test/close-refused-items.test.ts`: the control pin with the honest registry (the gone claimant is not seeded), the link door
  `open-coordinator` only for a claimant the registry holds, and the act with a reason, with the programme's end (done, abandoned), a
  run opened since (`plan-runs-open`, nothing closed) and refused bodies; a programme the close retired whose next wave opened still
  offers the hand-over; two refusals of one run in one pass raise once and later passes neither settle nor raise; an abandoned
  end gives the plan a reason; `parseItemActBody`'s rows.
- `pwa/test/waiting-screen.test.tsx`, `close-words.test.ts`: the doors' words, the sheet's reason and programme choice, the calls.
- `pwa/browser/waiting-close-run.browser.test.ts` (served from `sharedDist`): the three doors and the close-run sheet at 390, 1280
  and 1920 in both skins: tap floor, inside the width, answers reachable, no sideways scroll.
