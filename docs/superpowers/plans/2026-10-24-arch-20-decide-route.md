# ARCH-20: `POST /api/runs/:id/route` decides through a pure L1 `decideRoute`: Plan note

ARCH-20 (#546, under EPIC DECIDE, #521) moves the route door's decision out of its handler in `coord/routes.ts`
into `server/src/coord/route.ts`, after the pattern of `openRunPreconditions` (#579). The handler folded run-event
history, applied ruling S5-R17 and checked the degraded-record ceiling inline. It now parses the request, calls
`decideRoute`, refuses through `refuseRoute` and applies a move through ccd. The work landed in one pull request,
stacked on ARCH-06 (#1188), whose `scan/symbols.ts` measures the handler. One number, D-6735, was issued to it.

**What moved, behaviour-identical.** The request shape (`parseRouteRequest`), the run and session gates, the
registry vocabulary checks, the event-trail fold (`foldRouteTrail`: `lastDemotion` and `priorSameKind`, S5-R2 and
S5-R5), S5-R17 and the degraded-record ceiling. **What stayed in the route (L4).** The registry reads, the run and
trail lookups, the argv, the ccd call and the run event.

**Shadow comparison.** No recorded-fixture harness exists in the tree and none was added. The existing HTTP suites
(`run-route-route`, `run-route-session-trail`, `run-route-registry-id`) pass unchanged against the new code, and
`run-route-order.test.ts` was written green against the inline handler before the move and left unchanged after it.

## Deviations found

- **D-6735** — The route door's decision is one pure L1 function over one facts object, `decideRoute(events,
  measured, ceiling)` read as `openRunPreconditions` reads its facts: the event trail and each registry field
  (`.class`, `.effort`, `.degraded`) are LAZY lookups, called only by the gate that needs them, so a refusal costs
  only the reads ahead of it and a manual write reads neither. The degraded ceiling is derived from the measured
  `.class` and `.degraded`, not passed separately. The gate order is the contract: run lookup, run state, session,
  capability, then the `.class` read, `.effort` (absent is `auto`, S5-R18), `.degraded`, and only then their
  vocabulary checks; S5-R17 runs before the ladder refusals and before the ceiling guard. The refusal is typed as
  `RunRouteRefuseCode | 'run-unreadable' | 'unknown-run' | 'unsupported'`, and `RunRouteRefuseCode` joins
  `RouteRefusal` in `shared/refusal.ts`, so `floor` and `no-effort-rungs`, which were sent with a computed word and
  declared nowhere, are declared now at the 409 they were already sent with. Pins: in
  `server/test/run-route-order.test.ts`, "run-closed beats unsupported (a closed run on a box without route-v1)",
  "no-session beats unsupported", "unsupported beats no-record (no route-v1 and no .class)", "an unrouteable .class
  beats an unrouteable .effort, which beats an unrouteable .degraded" and "a ladder refusal (floor) beats the
  degraded-record ceiling guard"; in `server/test/route-decide.test.ts`, "forwards field and value, from \"?\", and
  reads nothing", "no-record naming class on an absent .class, before .effort is read", "the trail is read for a
  ladder ask and for no other", "S5-R17 runs before the degraded-ceiling guard: the replaced class escalation is
  judged against the lane, not the stale reversal", "every refusal the decider can answer is typed" and "calls the
  decider and holds no ladder, fold or registry-vocabulary logic"; and `server/test/refusal-status.test.ts`.
