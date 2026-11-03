# The update plane's rollout parity — the server follows a fleet move that landed

**Goal:** the update plane the PWA starts ends with both boxes on one build, the way `ccrc rollout` does from a
terminal: the fleet box first, then the server box to the SAME tag. A real fleet failure still stops the server lane.

**What was measured (code read on `main`, no box touched):**
- The dispatcher moves a node only when that node's own row has a standing request (`requestedTag`) or when its
  auto permits it (`intendedMove`). It only HOLDS a server-role move back while a fleet row has a request
  (`waiting-for-fleet`); nothing PULLED the server forward once the fleet moved.
- `settleNode` cleared the request columns unconditionally, so `{all: true}`'s `requestAll` skipped a row whose own
  lease was busy (D-3406) — a request written beside it would have been erased when that lease settled.
- So an Update all tapped while the server was still finishing an older move wrote a request for the fleet only.
  The fleet moved; the server had neither a request nor auto; the boxes ended on different builds, and the skew
  banner could only print the terminal verbs. A single-node tap on the fleet row ends the same way.
- Exit 3 (`cmd_update`'s "doctor FAIL with the gate passed") already counts as moved in both planes: the detached run
  writes `_upd_phase done "doctor exited N — the box moved; …"` and `leaseActionFor` settles on that `done`;
  `ccrc rollout` relays rc 3 and carries on to the server. The split was the missing follow-through, not exit 3.
- The catalogue is polled every 30 minutes and kept in process memory; `moveRefusal` answers `unknown-tag` for a
  release not yet listed with its bundle, so a tag published since the last poll could not be picked.

**Deviations and decisions:**
- **D-7678 (2026-10-31)** — update plane: settle keeps a request written beside the running lease; Update all requests a busy row.
  `settleNode` clears only the request the settled lease served. A request is KEPT when the row was busy, the lease is
  dated, the request was written after the lease started (both this server's own ms clock, so no cross-box ordering)
  and names another tag than the lease's target (narrowed by D-7688: an update strictly newer than it). It returns `{ok, clearedRequest, keptRequest}`. A met settle on an
  idle row clears as before. `requestAll` now writes the request beside a row's own running lease and lists it in the
  202's new `queued` (present only when non-empty, so an older reader's shape is unchanged), replacing D-3406's `busy`
  skip. A busy FLEET row still holds every server-role row behind it in that call (`waiting-for-fleet`), so the server
  never jumps ahead; D-7679 moves it after the fleet lands. The single-node route keeps `409 busy` for a busy named
  node (D-3386): a one-node tap on a moving node is a refusal the operator sees at once, and Update all is the queueing
  door.
- **D-7679 (2026-10-31)** — update plane: the server follows a fleet move that settled done to the same tag.
  When the inventory sweep settles a FLEET-role row's lease from `done` and that settle cleared the requested UPDATE
  the lease served (`landedMoveOf`, read off the pre-settle row), it calls `InventoryDeps.follow` in the same
  synchronous stretch; `watch.ts` binds it to `followLandedMove` (converge.ts), which acts on the pure decider
  `followSteps` (dispatch.ts). For each live server-role row that is idle, has no request and whose floor is below T:
  a `requestNode(server, T, 'update')` when `moveRefusal` clears a requested update to T — whatever the server's auto
  says, because the fleet moved on the operator's request — or a `noteDispatchRefusal` naming the fleet's move and the
  dispatcher's own refusal sentence. Each writes a `kind: 'update'` feed row ("update server: follows fleet to T", or
  "cannot follow"). Every `done` counts, whatever its detail (a failed doctor, a floor write that died after the box
  moved); `failed` and `reverted` release and halt instead and never follow, so a real fleet failure still stops the
  server lane. Left alone: a busy or halted server row, a server row with its own request (never overwritten), a server
  at or above T, a non-tag target, a fleet move auto made (no request — the server keeps its own auto, and the skew
  banner's `move` arm, D-7680, offers the tap), and a rollback. The server is never requested a tag the fleet box is
  not on: T is the tag the fleet's own stamp was measured at when the lease settled.
- **D-7680 (2026-10-31)** — PWA skew banner: queued and move arms before the terminal verbs.
  `skewRemedy` (updateHalt.ts) gains two arms after the halt and before `cli`: `queued` — the lagging box has an
  update request for the leading tag, or a lease running to it (said, no button; it outranks auto) — and, after
  auto, `move` — the fleet box leads at T, the server is idle with no request, the console can move it, its floor is
  below T, and T's release row is listed with its bundle and not yanked. `FleetHostBanner` renders the `move` arm's one
  button, "Update the server to T", which opens the shared `UpdateMoveSheet` over a single-node apply
  `{nodeId: server, tag: T}` planned through `planMove` (now reading only the view's `nodes`); FleetScreen passes the
  polled `releases` and its reload. The terminal sentence stands only when neither arm applies, the poll is stale or a
  lease is unreadable. The release window already shows the catalogue's last poll ("checked 5m ago",
  `catalogueLine`), so it needs no change.
- **D-7681 (2026-10-31)** — apply: an explicit tag the catalogue does not list runs one catalogue poll first.
  `POST /api/updates/apply` with a named tag that `coord.releases()` does not list as installable (no row, no bundle
  listed, or yanked) runs ONE on-demand catalogue poll through the refresh route's own path (`pollCatalogueNow`: the
  same `REFRESH_MIN_INTERVAL_MS` door against `lastRequestAt()`, the re-projection and the release push) before the
  dispatcher's predicate answers. Inside the interval nothing is sent and the stored rows answer `unknown-tag` as
  before, so the unauthenticated GitHub budget is unchanged.

**Pinned, no change:** the exit-3 contract's input to D-7679 — a `--detach --from pwa` update whose doctor fails
ends its report on `done` with the "the box moved" detail (`ccrc-update-phases.test.ts`, Linux; detach is Linux-only,
decision 17). `ccd/ccrc` is unchanged.

**Tests (red first on `main`):**
- `server/test/update-store-nodes.test.ts` — settle keeps a request later than the lease start for another tag; clears
  the served one, an older one, one beside an undated lease and a met one.
- `server/test/update-apply-routes.test.ts` — Update all while the server holds a v(N) lease requests both rows; a busy
  fleet row is requested beside its lease and still holds the server; the single-node route stays 409 busy; a tag
  published after the last poll is accepted after the on-demand poll, and none is sent inside the interval.
- `server/test/update-rollout-follow.test.ts` — through the real sweep and the real dispatcher: the follow-through on a
  doctor-failed `done` with the server's auto off, the four write-nothing cases, the refusal note, the busy-drop
  convergence (fleet to v(N+1), then the server), and the watcher's own inventory run wiring it.
- `pwa/test/update-halt.test.ts`, `pwa/test/fleet-host-banner.test.tsx` — the two arms, their precedence, the cases that
  keep the terminal verbs, and the button opening the sheet whose confirm sends the single-node apply.
