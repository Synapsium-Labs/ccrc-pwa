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

## CI round 1

- **masker-reads-a-bounded-note** — CodeQL flagged three alerts in the egress masker's patterns (polynomial ReDoS and a
  string of user-controlled length), reached from the set door, which asked the masker about the note before
  `timerBodyVerdict` refused one too long. The door now hands the masker only a note within its bound, through an L0
  predicate, `timerNoteFits` (`shared/continuity-timers.ts`), which checks the UTF-16 length first. `timerBodyVerdict`
  alone still refuses `timer-too-long`, and the route suite holds the predicate and that refusal in agreement on every note
  at and around the bound. The decider's own rung is unchanged, because its mutant set (`sim/timerSets.ts`) was held by
  timers PR C's claim. The guard is measured: with the old unbounded check the case that counts the masker's reads goes red.

- **indent-clamp-as-comparisons** — the second CodeQL run cleared both ReDoS alerts and kept one, js/resource-exhaustion
  on the masker's `indentOf` (`server/src/accounts/shapes.ts`), whose repeat count was already clamped to 512 by
  `Math.min`/`Math.max`, which the query does not read as a bound. The clamp is now written as comparisons, which it does;
  the answer is the same for every number (NaN, fractions and infinities included). An alert in product code is fixed,
  never dismissed.

## Review 2052, fix round 1 (the coordinator's rulings)

- **cancel-write-fault-is-write-failed** (F1, fixed) — both cancel doors call `cancelTimer` through one helper, `cancelOf`, in
  the timer doors' failure contract: a row the lane moved answers `timer-not-pending`, and a statement that throws answers
  `write-failed` (503), never a 500. A case for each door, measured red before the fix.
- **timer-masked-is-an-exact-match-oracle** (F2, no change) — a box-token holder can test whether an exact candidate string
  is a known secret's shape (400 `timer-masked`), as it already can through the mail, the card, the call record and the
  questions door. The body is decided before any read, in the spec's order (C61).
- **binding-read-after-role** (F3, fixed) — the bound run or programme is read after the role read's awaits, in the one
  synchronous segment with the counts, the verdict and the write, so a run that closes while the role is read is refused,
  never stored bound. Measured red before the fix.
- **verdict-pre-checks-utf16** (F4, fixed) — `timerBodyVerdict` refuses a note of more than twice the bound in UTF-16 units
  before it spreads it into code points, so a note near the 1 MiB body limit costs no million-entry array. The added line
  sits above the decider's own rung, so timers PR C's mutant strings still match; it changes no answer (a string of more
  than 1,000 units has more than 500 code points), so it has no mutant of its own.
- **operator-absent-is-not-found** (F5, fixed) — the operator's cancel of an id that names no row answers `timer-not-found`
  (404), a new word in `TIMER_REFUSALS`, decided by `timerCancelVerdict`'s `asker: 'operator'` (the setter's default keeps one
  answer for absent and foreign rows: no oracle). A foreign row on the operator's path is still `timer-not-yours`. A spec
  addition for Table 11.6's next correction.
- **card-role-read-is-not-one-segment** (F7, no change) — the card's `run` and `openCoordinatorIds` reads now happen inside
  `sessionRoleRead`, before the card's `bindingsOf` and the rest, across a microtask boundary. The card was never one
  snapshot across the registry's awaits; its outputs, read count and catch coverage are unchanged (the characterization).
- **census-matches-whole-route** (F8, fixed) — `box-token-census.test.ts` requires CLAUDE.md to name each session-only route
  ended by its closing backtick, so a path that is a prefix of another is not named by the longer one. Measured: CLAUDE.md
  naming only the cancel door reds the case.
- **operator-cancel-token-probe** (F9, fixed) — the armed case shows the box token is no key to the operator's cancel either;
  the operator doors' `timer-unmeasured` and `unavailable` answers have cases on the rig.
- F10 (the spec's `TIMER_OPERATOR_DOORS`) is the coordinator's, for the spec's next correction.

## Claims

- **contested-claims-ruled** — when PR B started, the notes piece (#2796) held every census file and the continuity routes,
  card facts and store files by claim (marked append-only). The ask was answered: build now, merge `main` once after #2796
  lands, take the union and re-count every census.
