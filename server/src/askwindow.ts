/**
 * THE ASK PRE-EMPTION LANE'S TWO WINDOWS, AND THE CEILING DERIVED FROM THEM.
 *
 * Both constants below were `watch.ts`'s, module-scope and unexported, and
 * that was right while the watcher was their only reader. Whole-branch review
 * F2(b) gave them a SECOND reader — `fleet.ts`'s `fleetAsk`, which must bound
 * the `held` chip by the same numbers the lane it describes actually runs on —
 * and `fleet.ts` cannot import `watch.ts`: `watch.ts` imports `assembleFleet`
 * from it, so the arrow only points one way. Re-spelling either number in
 * `fleet.ts` would be the second copy this codebase treats as a defect, so
 * they moved HERE, to a module both may import and neither owns. `ASK_SWEEP_MS`
 * did not move: it is the lane's poll cadence, not a window, and `watch.ts` is
 * still its only reader.
 *
 * L1, pure: no `fs`, no fastify, no clock, no database handle — three numbers
 * and the arithmetic between two of them.
 */

/** How long an eligible ask is withheld from the operator's phone so its parent
 *  can rule first. FLOOR (fix round 1, item 5 — corrected; the spec this was
 *  transcribed from cited the wrong pair): the parent is BY CONSTRUCTION the
 *  `claimedBy` of a non-terminal run — exactly `openCoordinatorIds()`'s
 *  membership test — so `sweepMail` scores it against the COORDINATOR pair
 *  (`watch.ts`'s `COORD_QUIET_MS`/`COORD_COOLDOWN_MS`), not the worker one: `COORD_QUIET_MS` (15s, measured from
 *  `statusUpdatedAt`) gates a just-idle parent, and `COORD_COOLDOWN_MS` (30s)
 *  does not bind it — that gate is measured from the recipient's own LAST
 *  successful injection, in-memory, so a parent with no prior mail (the
 *  ordinary case for an ask nudge) clears it for free. Add the same
 *  sweep-granularity/injection-sleep overhead an already-quiet session pays
 *  anyway and the real floor is ~25s — not the ~70s a `MAIL_QUIET_MS`
 *  (`watch.ts`) reading
 *  would suggest — so a window under that gives a just-idle parent no turn at
 *  all. CEILING: every second here is latency the operator pays on the asks
 *  the parent declines, which is why `POST /api/asks/:id/release` exists — a
 *  parent that answers "not mine" fires the push at once, so only a parent
 *  that has genuinely gone quiet ever costs the full window. */
export const ASK_GRACE_MS = 120_000;

/** Ceiling on how long a row may sit `'answering'` before `sweepAsks` gives up
 *  on the principal that took it and never came back (fix round 1, item 1 —
 *  the reviewer's own reasoning, verbatim): `sweepAsks` is the ONLY garbage
 *  collector `heldAsks` has. `detectDialogs`'s orphan-settle fires only on a
 *  NEW dialog id, and a session blocked on `AskUserQuestion` does not
 *  repaint — so a row stuck at `'answering'` (the press refused, `answerAsk`
 *  threw, the request abandoned — `untakeAsk`'s own rollback never ran)
 *  would otherwise be kept forever, WITHIN THIS SERVER'S OWN LIFETIME:
 *  `releaseAsk` fails every sweep because the state is not `'held'`, and
 *  nothing ever pushes. That is the exact harm this lane exists to prevent,
 *  inverted.
 *
 *  NOT a restart bound (fix round 1, item 4 — a prior draft of this comment
 *  claimed it was, falsely): `heldAsks` is an in-memory `Map`, never
 *  reconstructed from the `asks` table at boot, so a row `'answering'` at
 *  restart time has no map entry the moment the process comes back —
 *  invisible to `sweepAsks` by construction, not merely slow to reach. A
 *  restart mid-hold loses the push outright, a pre-existing, accepted
 *  residual the design already names elsewhere; this ceiling has no way to
 *  bound a process that is no longer running to enforce it.
 *
 *  Sixty seconds is generous, not tight: `answerAsk`'s whole job — take the
 *  row, press a digit, settle — happens well inside one `ASK_SWEEP_MS`
 *  interval (`watch.ts`) in every normal case, so a row still `'answering'` a full minute
 *  later, IN A SERVER THAT NEVER RESTARTED, means the principal that took it
 *  is gone, not merely slow. Past this bound `sweepAsks` pushes the
 *  snapshotted payload and drops the entry — F9's own justification for the
 *  missing-row arm, verbatim: the ask's loss is free by design and must
 *  degrade to today's immediate notification. A principal that took the row
 *  and never came back, within one server lifetime, is that same case. */
export const ASK_ANSWERING_MAX_MS = 60_000;

/**
 * How old a `held` row may be before the fleet chip stops calling it live —
 * `ASK_GRACE_MS + ASK_ANSWERING_MAX_MS`, DERIVED, never a third number
 * (whole-branch review F2(b), a RULING).
 *
 * WHY THE CHIP NEEDS A BOUND AT ALL. `fleetAsk` folds `answering` onto `held`
 * and, until this constant, applied no time bound to `held` at all — on the
 * premise that "a held ask is live by definition". That premise holds only
 * within one process lifetime, and only while `staleAsk` can still reach the
 * row. Two reachable failures broke it:
 *
 *   - RESTART MID-HOLD. `heldAsks` is never rehydrated from the table
 *     (deliberately — D-2169: the deferred push is the watcher's memory, and
 *     its loss is free) and there is no boot reconciliation. `dialogIds` is
 *     stamped on the priming tick BEFORE the `notify` gate, so no later tick
 *     ever re-mints and nothing clears the row. Every deploy therefore leaves
 *     one stuck chip per session that had a live ask.
 *   - A STRANDED `answering`. Closed at the CAS by F2(a) (`staleAsk` now names
 *     both live states), but the chip must not depend on that write having
 *     landed: `staleAsk` is called through a `try`/`catch` on every path, and
 *     a coord.db that throws leaves the row exactly where it was.
 *
 * WHY THIS ARITHMETIC. A row that is genuinely live is one the sweep has not
 * yet reached: at most `ASK_GRACE_MS` sitting `held`, then at most
 * `ASK_ANSWERING_MAX_MS` sitting `answering` before `sweepAsks` gives up on
 * the principal that took it. Past their sum, a row still reading `held` or
 * `answering` is stale BY CONSTRUCTION — the process that would have moved it
 * either is not running any more or has already decided it was gone.
 *
 * THE SLACK, STATED. `sweepAsks` runs every `ASK_SWEEP_MS`, so the wall-clock
 * moment a legitimately-live row is finally moved can trail this sum by up to
 * two sweep intervals (one to observe `answering` and stamp `answeringSince`,
 * one to act on the ceiling). Within that sliver the chip stops showing a
 * question that is still, briefly, open. That is the FAIL-SAFE direction and
 * the reason `ASK_SWEEP_MS` is deliberately not added in: the chip explains
 * why the operator was not buzzed, and going quiet a few seconds early costs
 * nothing, while a chip that never goes away is the defect this closes.
 */
export const ASK_HELD_CHIP_MAX_MS = ASK_GRACE_MS + ASK_ANSWERING_MAX_MS;
