# Abandon a run whose session the fleet no longer has

- **D-8664 (2026-11-15)** — a release of a session the registry positively lists as absent is already done: the close's shared fleet step sends no `ws-release` for it, the close commits, and one `fleet-act-omitted:session-absent` run event records it; an unlistable or unmeasurable registry, and any `ccd` failure, keep `fleetFailed`.

## The bug

A run in `planned`, never dispatched (no workspace, no branch), whose `sessionId` named a child session that was
later removed from the fleet registry, could not be abandoned. `decideAbandon` chose `wsRelease`, `ccd ws-release`
died `no such session: <id>` because the registry had no `<id>.uuid`, `decideFleet` answered `fleetFailed`, and the
console's Abandon sheet said "The release failed." on every retry. The programme stayed stuck, and nothing closed it.

## The rule (one, in `closeDecide.ts`)

A new pure step, `gone`, sits in `actOnFleet` between the verb check (and the sweep's gate) and the act. It is the
fleet step the abandon arm and the work close share, so both take the same rule:

- Only for `wsRelease`. The hold and the archive are not releases, and the registry is not read for them.
- The fact is `readSessionRecord`'s kind, read immediately before the act. Only `absent` counts: the listing succeeded
  and holds no `<id>.uuid`, which is the same file `ccd ws-release` checks before it dies. `unlistable`,
  `unmeasurable`, `bad-id` and `found` all send the act as before, so `ccd`'s own answer decides, and any failure is
  still `fleetFailed`.
- The measure is taken before the act rather than read from `ccd`'s stderr. No English text is matched, and `ccd`
  is unchanged.
- The registry check is by session id. A different session holding the workspace is not an absence.

After the store's close commits, the executor records one `fleet-act-omitted:session-absent` run event, in the shape of
the existing `fleet-act-omitted:bad-session`. `released` reports what the plan decided (the claim is gone either way).

## Where it does not reach

- The review close arm (`closeReviewRun`) composes its own release inline and does not go through `actOnFleet`, so it
  is unchanged. An abandon of a review run goes through the abandon arm and does take the rule.
- The PWA's Abandon sheet is unchanged. A successful abandon now answers `ok`, and the sheet says nothing new for
  `released: true`.

## Tests

- `server/test/close-decide.test.ts`: the `gone` step. `absent` is gone, every other kind is not, and the hold and
  archive never read the registry.
- `server/test/coord-abandon.test.ts`: a planned run and a working run whose sessions are absent are abandoned with no
  `ws-release` and the event. An unlistable registry still answers 502 with `ccd`'s stderr, and the run stays where it
  was. A listed session whose release fails for another reason is still 502. A listed session is released as before.
- `server/test/run-close-lane.test.ts`: the sweep's close of a run whose session is absent closes it with no `ccd` call.
- Fixtures that dispatched workers into sessions the registry never listed now list them where the test asserts a
  release was sent (`run-close-lane`, `end-dead-coordinator`, three cases of `dead-coordinator-lane`).
- `server/test/id-argv-census.test.ts`: the pin on `actOnFleet`'s return type follows the new signature.

## Deviations found

D-8664, defined at the top of this note, is the rule above. No other deviation.
