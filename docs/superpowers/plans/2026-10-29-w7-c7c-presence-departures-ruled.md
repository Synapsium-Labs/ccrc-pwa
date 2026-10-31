# W7 C7c: the presence departures

- **D-7342 (2026-10-29)** — C7c Step 2c lands before Step 1: the offline snapshot's revive keeps `presence` before the fixtures derive it.
- **D-7343 (2026-10-29)** — the hibernation census's `presence-reader` source also counts `paneGone(` calls in `pwa/src`.
- **D-7344 (2026-10-29)** — `coordPresence` answered `coordinatorPresence` in the coordinator behaviour commit, before its three callers moved and it was deleted.
- **D-7345 (2026-10-29)** — Forget keeps `!asleep` beside `presenceOf(session) === 'dead'`, a departure from OA-C15 (a) on hibernated `orphan` and `never-started` rows.
- **D-7370 (2026-10-29)** — a coordinator whose pane tmux called gone under a substrate stamp reads `unknown` in `coordinatorPresence`, not the server's `dead` (coordinator ruling within OA-C15 (a)).
- **D-7371 (2026-10-29)** — `coordinatorPresence` applies Forget's `!asleep` guard: a hibernated `orphan` or `never-started` coordinator reads `hibernated`, not the server's `dead` (coordinator ruling within OA-C15 (a), option (i) of D-7345's split).
- **D-7372 (2026-10-29)** — Start's refusal on a doubted or old-server main checkout, and its copy, stay as they are (coordinator ruling within OA-C15 (a)).

These are the departures W7 Task C7c (D-7181) takes from its plan, `docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md` §Task C7c. That plan is merged, so it is not edited; this note records them. OA-C15 is ruled (a) in D-7265.

**D-7342.** The plan orders Step 1 (the fixtures carry `presence`) before Step 2c (`shared/api.ts#reviveFleetSession` revives `presence` and `deadSince`). With the fixture derivation in and the revive still dropping the key, `pwa/test/offline.test.ts`'s round-trip row reds. So Step 2c lands first. It is behaviour-neutral, because no site reads `presence` yet.

**D-7343.** The plan's `presence-reader` source counts calls of `presenceOf(` and `coordinatorPresence(`. Step 4 moves `hibernated.ts#hibernatedSince` (stance `definition`) and the sites that only word what the pane shows onto `paneGone(session)`. If the source did not count `paneGone(` too, those files would leave the census when they stop comparing a status with `'dead'`, and the census would be blind to them. The source is still scoped to `pwa/src`.

**D-7344.** The plan moves `coordPresence`'s callers (Step 5) and then deletes it. The behaviour change (Step 6) came first: in that commit `coordPresence` answers `coordinatorPresence`. The three callers and the deletion then move with byte-identical assertions. Because of this, `coordWords.ts`'s `dead-compare` and `dead-lifecycle` census rows go in the behaviour commit, not in the deletion commit.

**D-7345.** The Forget door in `fleet/SessionActionsSheet.tsx` reads `session.workspace === null && presenceOf(session) === 'dead' && !asleep`. The server reads an `orphan` or `never-started` row that carries a hibernation stamp as `dead`. `hibernatedSince` reads the same row as asleep, the actions sheet offers Wake on it, and `ccd forget` refuses it. So Forget stays hidden there, as before. `coordinatorPresence` does not apply this guard, so on that row the run board offers Resume while the row's own sheet offers Wake. The PR review offered three ways to close this split: (i) apply the same guard to `coordinatorPresence`, (ii) drop it from Forget, or (iii) keep the split and state it. The coordinator ruled (i): see D-7371.

## The coordinator's rulings on the review asks

The coordinator ruled on the PR's four review asks on 2026-10-29. Each is a coordinator call within OA-C15 (a) (D-7265). For each one, the alternative is named, so the operator can overturn it.

**D-7370 (review ask 1).** A coordinator whose pane tmux called gone, with a substrate stamp, under `stopped`, `orphan` or `never-started`, stays `unknown`. It gets no Resume door, no "coordinator gone" marker and no `gone` header fact. The rule is named in `pwa/src/fleet/presence.ts#coordinatorPresence`, and it applies only when the server's word is `dead`. Why: Resume reclaims the coordinator's runs, and while a substrate fault stands the coordinator may be alive (D-309). `resume-sheet.test.tsx`'s row "a substrate fault stands" again asserts `unknown`. Alternative: the server's `dead` wins, so these rows offer Resume and the reclaim route's `measureClaimant` is the only guard.

**D-7371 (review asks 2 and 3, option (i)).** `coordinatorPresence` applies the same `!asleep` guard as Forget (D-7345), through `hibernatedSince`. So a hibernated `orphan` or `never-started` coordinator, which the server reads `dead`, stays `hibernated`: no Resume door, no "coordinator gone", and the header fact says `hibernated`. This matches Forget, the row's own sheet (which offers Wake) and D-5430. The asleep rule runs before the substrate rule, so a sleeper that also carries a substrate stamp still reads `hibernated`, the answer its own sheet gives. Alternative: the server's `dead` wins (option (ii), drop the guard from Forget too, so Forget shows and Wake is not offered on these rows), or option (iii), keep the split and state it.

**D-7372 (review ask 4).** Start stays refused on a main checkout that the server doubts, or that an old server sends without `presence`, and the refusal keeps today's copy: "<id> is already running in <project> — open it, or pick another project." A refusal there costs one refresh, and no new word is added. Alternative: the server's word wins for the copy too, with a new doubt sentence added for a row the server cannot read (new copy, red-first).
