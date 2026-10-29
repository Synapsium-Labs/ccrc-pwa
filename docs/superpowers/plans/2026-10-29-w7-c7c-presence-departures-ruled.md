# W7 C7c: the presence departures

- **D-7342 (2026-10-29)** — C7c Step 2c lands before Step 1: the offline snapshot's revive keeps `presence` before the fixtures derive it.
- **D-7343 (2026-10-29)** — the hibernation census's `presence-reader` source also counts `paneGone(` calls in `pwa/src`.
- **D-7344 (2026-10-29)** — `coordPresence` answered `coordinatorPresence` in the coordinator behaviour commit, before its three callers moved and it was deleted.
- **D-7345 (2026-10-29)** — Forget keeps `!asleep` beside `presenceOf(session) === 'dead'`, a departure from OA-C15 (a) on hibernated `orphan` and `never-started` rows.

These are the departures W7 Task C7c (D-7181) takes from its plan, `docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md` §Task C7c. That plan is merged, so it is not edited; this note records them. OA-C15 is ruled (a) in D-7265.

**D-7342.** The plan orders Step 1 (the fixtures carry `presence`) before Step 2c (`shared/api.ts#reviveFleetSession` revives `presence` and `deadSince`). With the fixture derivation in and the revive still dropping the key, `pwa/test/offline.test.ts`'s round-trip row reds. So Step 2c lands first. It is behaviour-neutral, because no site reads `presence` yet.

**D-7343.** The plan's `presence-reader` source counts calls of `presenceOf(` and `coordinatorPresence(`. Step 4 moves `hibernated.ts#hibernatedSince` (stance `definition`) and the sites that only word what the pane shows onto `paneGone(session)`. If the source did not count `paneGone(` too, those files would leave the census when they stop comparing a status with `'dead'`, and the census would be blind to them. The source is still scoped to `pwa/src`.

**D-7344.** The plan moves `coordPresence`'s callers (Step 5) and then deletes it. The behaviour change (Step 6) came first: in that commit `coordPresence` answers `coordinatorPresence`. The three callers and the deletion then move with byte-identical assertions. Because of this, `coordWords.ts`'s `dead-compare` and `dead-lifecycle` census rows go in the behaviour commit, not in the deletion commit.

**D-7345.** The Forget door in `fleet/SessionActionsSheet.tsx` reads `session.workspace === null && presenceOf(session) === 'dead' && !asleep`. The server reads an `orphan` or `never-started` row that carries a hibernation stamp as `dead`. `hibernatedSince` reads the same row as asleep, the actions sheet offers Wake on it, and `ccd forget` refuses it. So Forget stays hidden there, as before. `coordinatorPresence` does not apply this guard, so on that row the run board offers Resume while the row's own sheet offers Wake. The coordinator still has to rule on this split in the PR review: (i) apply the same guard to `coordinatorPresence`, (ii) drop it from Forget, or (iii) keep the split and state it.
