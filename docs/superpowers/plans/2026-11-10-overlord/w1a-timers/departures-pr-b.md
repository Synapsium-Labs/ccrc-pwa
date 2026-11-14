# Overlord W1a, timers PR B: departures from the plan (Tasks 4 to 6)

PR B's own note, beside `departures.md`. That file was held by timers PR C's claim when PR B was built, so PR B's
departures are kept here, by slug, and the coordinator folds both into the programme's ledger. No D-number is taken here.

## The role read made one (Task 4)

- **role-read-characterization-own-file** — the characterization is a new suite, `server/test/continuity-role-read.test.ts`,
  not more cases in `continuity-card-facts.test.ts`, which the notes piece's claim held. Its first commit is green on `main`
  against card PR B's `gatherCardFacts`: the role, `roleWhy`, renderer and `intent` fact for a coordinator, a child worker,
  a child reviewer, a plain session, declared intent, an unreadable registry and an absent `.generation`. The move commit
  changes `gatherCardFacts`' call site (it takes its role and intent from `sessionRoleRead`'s answer, as the plan says) and
  the suite's imports; every pinned output is unchanged, `sessionRoleRead` answers the same four, and a card still reads the
  registry once for its role.
- **role-read-deps-are-a-subset** — `sessionRoleRead` takes `RoleReadDeps`: the card's registry reads and only the two store
  reads it makes (`run`, `openCoordinatorIds`), so the set door passes `{ coord, ...deps.cardRegistry }` as the card does.

## The doors (Tasks 5 and 6)

- **timer-by-id-read** — a cancel must tell another identity's timer (`timer-not-yours`, 403) from one of its own that is no
  longer pending (`timer-not-pending`, 409), so it needs the row's setter and state. Task 3's store has no read by id, so PR B
  adds `timerById` to `continuityStore.ts` (one row whatever its state, `null` for an id no row has, `ok: false` for a row
  that does not read) with a one-line `CoordStore` delegate. A failed read answers `timer-unmeasured` (503).
- **least-cap-is-derived** — the cap of a role that reads `undecided` (the plan's undecided-role-gets-the-least-cap) is
  `LEAST_TIMER_CAP`, derived from `FLEET_ROLES` as the least `timerCap`, and `timerCapOf(role)` in `shared/fleetRoles.ts`
  looks the cap up, so the set door decides nothing and a change to a row moves the least cap with it.
- **timer-view-one-shape** — both reads answer one `TimerView` (`shared/continuity-timers.ts`: id, set and due times, note,
  run, programme), and every note is marked `untrusted: true`, the session's own read included; the plan named the mark on
  the operator's read only.
- **masked-by-the-answer-hook** — `GET /api/timers` and `GET /api/sessions/:id/timers` join `MASKED_GET_ROUTES`
  (`server.ts`), so the one answer hook masks both. `secret-mask.test.ts` needs no edit: its `MASKED_GET_ROUTES` loop covers
  them (measured green), and the route suite shows a note written before the masker learned its shape going out masked on
  both.
- **identity-grammar-is-session-id-re** — the doors hold ids to the continuity file's `IDENTITY_RE`, which is
  `SESSION_ID_RE`'s grammar (`^[A-Za-z0-9_-]{1,128}$`), and a programme to `shapeProgramSlug` with the input already trimmed:
  a slug with surrounding space is refused, never trimmed and stored (review 2038 F4).
- **run-and-programme-both-refused** — a body that binds both a run and a programme is `bad-request` (400), before any read,
  the table's CHECK said at the door.
- **stamp-throw-is-unmeasured** — a `setterStamp` that throws reads as unmeasured, so the set refuses `timer-unmeasured`, as a
  changing or absent `.generation` does.
- **operator-cancel-names-the-session** — the operator's cancel checks the timer is the path's session's (`timer-not-yours`
  otherwise), through the same `timerCancelVerdict` the session's own cancel uses.
- **unavailable-after-attribution** — a server with no coordination store answers `unavailable` (503) after the
  attribution, as the start report and the card door do.
- **start-and-card-suites-gain-the-stamp** — `continuity-start-route.test.ts` and `continuity-card-route.test.ts` build
  `ContinuityRouteDeps` by hand, so each gains a `setterStamp` stub; nothing else in them changes.
- **tasks-5-and-6-one-commit** — the session doors and the operator's doors land in one commit, because their census sites
  (the gate's route count, `auth-gate.test.ts`'s counts, `CONTINUITY_SESSION_DOORS`) move together.
- **mutations-by-hand** — the mutation helper the skill names mutates Python modules only, so the plan's mutations were
  measured by hand, each restored from a saved copy and compared byte for byte: skipping the binding check reds the
  other-session's-run case (and three more), a fixed cap of 20 reds the worker's sixth-timer case, and mapping
  `bindingsOf`'s failure to `not-own` reds the `ok: false` case. `CONTINUITY_SESSION_DOORS`'s both-directions case reds with
  a door's name dropped and with a name that has no registration.

## Claims

- **contested-claims-ruled** — when PR B started, the notes piece (#2796) held every census file and the continuity routes,
  card facts and store files by claim (marked append-only). The ask was answered: build now, merge `main` once after #2796
  lands, take the union and re-count every census.
