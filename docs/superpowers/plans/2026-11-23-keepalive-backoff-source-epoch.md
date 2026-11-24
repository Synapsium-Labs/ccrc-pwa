# The keepalive's failure streak starts over with its measured source: plan

A follow-up to `2026-11-23-limit-early-reset-keepalive-source.md`. That plan gave the keepalive's turn a measured source
(D-8957). Before it, a `-p` turn rendered no statusline, so every turn the keepalive took counted as a failure, and each
account's attempt ledger (`~/.ccrc/keepalive-state/<account>.json`, `{lastAttempt, fails}`) climbed to the backoff's
daily cap. Measured on a fleet after that release went live: every account's streak stood between 22 and 48, so the
backoff allowed about one turn a day per account, and no turn had been taken since the release. The new source would
not be tried for up to a day per account, and the early-reset detection D-8957 delivers would wait that long.

## The change (D-8960)

- The ledger row gains `src`, the epoch of the source its streak was counted against. Every write of the row
  (`_ka_state_set`, `ccd/ccd-telemetry-keepalive`) writes the current epoch, 1.
- The one reader of `fails` (`_ka_state_get`) reads it as 0 when the row carries no `src`, or an older one. So a streak
  recorded before the measured source existed no longer holds the account in backoff, and the first failure after the
  change is the streak's first.
- `lastAttempt` is read as written, so the attempt throttle (`CCRC_KEEPALIVE_FRESH`, 30 minutes by default) still
  spaces the first turns after a deploy. The pass's per-pass limits and its lock are unchanged.

A later change of source raises `KA_STATE_SRC`, and the streaks start over again.

## What did not change

The cadence, the backoff's three numbers, the credential handling and the turn itself.

## Tests

`server/test/telemetry-keepalive.test.ts`, "the failure streak starts over with the measured source (D-8960)":

- a row without `src`, and a row with `src` 0, each with 40 failures and attempted an hour ago, get a turn, and the
  failure that turn records is the streak's first;
- a row without `src` attempted ten minutes ago is still held by the attempt throttle, not by the old streak;
- a row with the current `src` and 40 failures keeps its backoff;
- every row the pass writes carries `src` 1.

The first, second and fourth were red before the fix. The third passes before it by nature, and was measured red against
a reader that ignores `src` and always starts the streak over. `plantState` now writes `src` 1 unless a case leaves it out,
so the existing backoff cases describe rows the current script writes.

## Deviations found

- **D-8960 (2026-11-23)** — keepalive-backoff-starts-over-with-the-measured-source. The keepalive's attempt ledger row
  carries `src`, the epoch of the measured source, written on every write. A row without it, or with an older one, reads
  its failure streak as 0, so failures counted before D-8957's source existed no longer hold an account in backoff;
  `lastAttempt` still applies the attempt throttle, so a deploy starts no burst of turns.
