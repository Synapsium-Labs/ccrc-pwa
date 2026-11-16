# The update plane's rollout parity — a request older than the running lease is never kept

**Goal:** a request written beside a node's own running lease (D-7678) survives that lease's settle only when it is
the operator's NEWER tap. A tag the settled move already delivers or passes must not stay on the row, because the
dispatcher can only refuse it `not-newer`, and on a fleet row that refusal holds every server move behind it.

**What was measured (code read on the branch, no box touched):** the fleet's lease is moving to v0.0.11 and Update
all is tapped with an explicit v0.0.10. `requestAll` asked `moveRefusal` against the row's floor (still v0.0.9), so it
wrote v0.0.10 beside the lease and listed it `queued`. `settleNode` kept it: it was later than the lease start and
named another tag. After the settle the fleet ran v0.0.11 but held a v0.0.10 request. `planDispatch` refused it
`not-newer`, its fleet ask held every server move `waiting-for-fleet` until an ack, and `landedMoveOf` saw a request
for another tag than the target, so the follow-through never fired. The skew banner's `move` arm then offered a
server move that could only queue behind the hold: the box split the change exists to close.

**Deviations and decisions:**
- **D-7688 (2026-10-31)** — A request beside a running lease is kept, and Update all queues one beside a busy row, only for an update strictly newer than the lease target
  `settleNode` decides the keep in JS (`isNewerTag` is not SQL), inside its own transaction: the row is busy, the
  lease is dated, the request was written after the lease started, its kind is `update`, and its tag is strictly newer
  than the lease's target and than every version the row now reads (`currentVersion`, `highestVersion`). Every other
  request is cleared, as before D-7678. `requestAll` judges a busy row against max(floor, lease target): after
  `moveRefusal` clears the move, a tag at or below the running lease's target is skipped `not-newer` and not queued.
  A busy fleet row still holds the server rows behind it in that call (`waiting-for-fleet`). This narrows D-7678's
  "names another tag".

**Tests (red first on the branch head):**
- `server/test/update-store-nodes.test.ts` — the settle clears an older request beside the lease, a rollback request
  beside it, and a newer one the row already runs.
- `server/test/update-apply-routes.test.ts` — Update all to a tag older than a running fleet lease writes no fleet
  request; after the settle nothing holds the server and a server request to the fleet's tag is the planned move.
- `server/test/update-rollout-follow.test.ts` — through the real sweep and dispatcher: a stale older fleet request
  beside a running move is cleared when the move lands, and the server then moves with no refusal.
