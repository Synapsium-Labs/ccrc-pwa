# W3 Task Q3b: task note (D-7026)

The per-task note for Task Q3b of `2026-10-26-consolidation-w3-questions.md` (rev 5). The coordinator folds it into
that plan's §Deviations and decisions; this file never edits the plan.

## What landed

- `server/src/coord/questions.ts` (L1 by its facts, C6; slug q3b-ring): the `OperatorQuestion` union (`ask` and
  `approval` arms carry their row unchanged as `row`; the `dialog` arm is what the pane shows, held for nobody), the
  stateless readers (`currentFor`, `openFor`, `approvalFor`, `decidedIn`, `forCorrection`, `heldForDrift`) and
  `createQuestions(deps)`, which holds no state yet.
- The readers moved, one per commit: `fleet.ts` (`readCurrentAsks`, `readHeldApprovals`), `coord/digest.ts#buildDigest`,
  `coord/digest.ts#correctDigestRow`, `coord/driftLane.ts`, `GET /api/asks`, `GET /api/approvals/:id`.
- `questionStoreCallsOutside()`: 48 at the base, 39 at the tip (measured, not pinned).
- One `Questions` instance per `FleetWatcher` and per server (`questions-instances.test.ts`).

## Departures, by slug

- **slug q3b-watch-import.** The plan allows `watch.ts`'s constructor region only. The instance needs one more line
  outside it: the `import { createQuestions, type Questions } from './coord/questions.js'` line, placed after the
  `CoordRoutesHandle` type import, clear of every open PR's `watch.ts` hunk. No other `watch.ts` line changes.
- **slug q3b-current-for-kind.** `currentFor` takes a third argument, `'ask'` or `'approval'`, and answers one read per
  call. The fleet frame's two reads are two guarded reads today, each with its own warn sentence, and a failure of one
  leaves the other's rows standing; one call answering both would couple them. The plan's single name is kept;
  `forCorrection(kind, id)` already has the same shape.
- **slug q3b-reads-pin-file.** Step 1's characterization rows live in a new file, `server/test/questions-reads-pin.test.ts`,
  rather than in the existing suites (`fleet.test.ts`, `digest.test.ts`, `drift-lane.test.ts`, the route suites). A new
  file holds no line of an open PR's suite, and every row in it runs unedited through the move commits. The existing
  suites run unedited too.
- **slug q3b-routes-question-param.** `registerCoordRoutes` takes the instance as a new last parameter (`_questions`),
  defaulted to `createQuestions(deps)` so a test that registers the routes on a bare Fastify gets its own. No route reads
  it in Q3b; the two GET routes keep reading `deps.coord` through the stateless readers, so a route never reads a store
  other than the one it read before. Q3e and Q3d give it its first readers.
- **slug q3b-ring.** The plan names `coord/questions.ts` L3. Its facts make it L1: it does no I/O, holds no timer, and
  its only store import (`CoordStore`) is type-only; its one runtime import, `askwindow.ts`, is L1. A header that
  declared L3 would move it outward of those facts, and `fleet.ts` (L1) imports `currentFor` at runtime, so that
  declaration made a new outward pair (`fleet.ts -> coord/questions.ts L1 -> L3`), which `rings/outward-edges.test.ts`
  refuses. Its exemption ledger may only shrink, so the header declares no ring and the file sits at L1. Q3d (the hold
  carrier) and Q3e (`approvalInputs`) add state and possibly a timer; each must settle the file's ring again, and an
  outward move then needs `fleet.ts`'s read to stay inward (type-only, or the reader moved inward).
