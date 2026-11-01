# The update plane's rollout parity — Update all to the running lease's own tag is queued

**Goal:** Update all for the same tag a running fleet move is already delivering must still make the server follow
once that move lands. This holds whether the move was requested or started by auto.

**What was measured (code read on the branch, no box touched):** the fleet row holds an AUTO lease to v0.0.11. The
dispatcher's auto arm writes no request, and the server's auto is off. The operator taps Update all for v0.0.11, either
by naming it or with no tag while the desired tag is v0.0.11. D-7688's rule in `requestAll` skipped a busy row
`not-newer` for any tag at or below the lease target, so the equal tag wrote no fleet request. The answer was
`requested: []`, with the fleet `not-newer` and the server `waiting-for-fleet`. When the move landed, `landedMoveOf`
read a pre-settle row with no request and returned null. The server was never requested, so the two boxes stayed
split. Before D-7688 the same tap wrote v0.0.11 beside the lease (`queued`) and the server followed.

**Deviations and decisions:**
- **D-7690 (2026-10-31)** — Update all to the same tag as a running fleet lease is queued, so the server follows
  `requestAll` skips a busy row `not-newer` only for a tag strictly OLDER than the running lease's target
  (`isNewerTag(lease target, tag)`). A request for the lease's own target is written beside the lease and listed in
  `queued`. `settleNode` clears it, because its keep needs a strictly newer update, so it never pins the server lane.
  `landedMoveOf` still reads it from the pre-settle row, so the server follows to the same tag. This narrows D-7688's
  "at or below" to "below". The settle's keep rule is unchanged.

**Tests (red first on the branch head):**
- `server/test/update-apply-routes.test.ts` — an auto fleet lease to v0.0.11 plus Update all for v0.0.11 (named, and
  with no tag over a desired v0.0.11) lists the fleet in `requested` and `queued`, holds the server
  `waiting-for-fleet`, and the settle clears the request.
- `server/test/update-rollout-follow.test.ts` — through the real apply route, the real sweep with the follow-through
  wired, and the real dispatcher: the fleet's done-settle requests v0.0.11 on the server, with the server's auto off,
  and the next plan moves the server to v0.0.11.
