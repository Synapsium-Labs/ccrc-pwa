# Overlord wave 171, mid-turn mail PR 1: notes for the ledger

This note records what PR 1 of the mid-turn mail build (Task 1.1 of `docs/superpowers/plans/2026-11-19-mid-turn-mail.md`)
shipped and measured, and how fix round 1 (review 2760) changed it. The coordinator folds it into the programme ledger
and mints any numbers. No D-number is defined here.

## In short

- **Shipped:** `deliveredAt`, `ingestedAt`, `ackedAt` and, from fix round 1, `replayCount`, four optional fields on
  `MailSummary`. Every mail read that builds one serves them (`mailForRecipient`, `outstandingMailFor`, `mailForProgram`,
  and so `GET /api/mail` and `ccrc-api mail list`). Each is one column of `MAIL_ROW_COLUMNS`, read as TEXT and accepted
  only in the one canonical spelling of a positive safe integer (`parseCanonicalPositiveSafeInteger`). So a missing,
  fractional, textual, hexadecimal, zero or unsafe value is absent, never zero. `replayCount` alone may be zero, its
  column's default.
- **Additive:** `FLEET_PROTO` is not bumped. An older server omits the four. Absent covers both "never written" and
  "stored but not provable" (review 2760 F5, accepted for this display-only wire).
- **Growth,** by the growth check's counter against `a6505783c`: `shared/api.ts` 5,113 to 5,117 (+4, 23 free under its
  5,140 cap on this branch; `main` has since reached 5,117 with #3056, so the merged file holds about 5,121);
  `server/src/coord/store.ts` +9 (the plan estimated +6, under the 40 limit). No waiver.
- **Mutations,** each an in-place edit restored from a saved copy whose sha256 was checked:
  - dropping `ingestedAt` from `MAIL_ROW_COLUMNS` reds its four cases;
  - answering zero for an absent time reds every case;
  - reading the columns as numbers instead of TEXT reds the unsafe-integer case (`RangeError` from `node:sqlite`);
  - accepting any text `Number()` proves, instead of the canonical spelling, reds both hexadecimal cases;
  - dropping the zero-count rule reds the never-replayed case and the route case;
  - dropping `replayCount` from `MAIL_ROW_COLUMNS` reds the replayed, never-replayed and route cases.

## 1. What each field means, measured from the code

The baseline (plan §7) reads these, so their meanings are stated exactly. `MailSummary`'s docstring says the same.

| Field | Meaning | Writer | Clock |
|---|---|---|---|
| `at` (already served) | When the mail row was inserted | `insertMail` | the server's |
| `deliveredAt` | The time at the start of the sweep pass that last put the nudge into the recipient's pane (`mailPass`'s `now`), written once the send succeeds, so earlier than the moment the nudge was typed. A replay re-dates it, so on a replayed row it is the latest delivery, not the first | `markDelivered` | the server's |
| `replayCount` | How many times the lane replayed the nudge onto a row already delivered: 0 for none | `bumpReplayCount` | none |
| `ingestedAt` | The first `UserPromptSubmit` edge of any kind (an operator prompt, another mail's nudge, a brief, not only this mail's) that the mail sweep sampled from the recipient's hook state after a delivery, every `MAIL_SWEEP_MS` (10 s). Written once; a replay does not move it, so it can precede `deliveredAt`. A fast turn can overwrite the edge before a sample sees it, so it can be missing or a later prompt's time | `markIngested`, from the watcher's `sampleEdge` | the fleet box's (the hook state's `updatedAt`) |
| `ackedAt` | When an ack committed: the recipient's, through the ack route; or, for an operator-message nudge, the nudge lane's own ack at the delivery, so there it equals `deliveredAt` | `markAcked` | the server's |

## 2. How the baseline is read (the coordinator's rulings, fix round 1)

These rules are for the plan §7 baseline, read from PR 1's deploy on.

- **Unreplayed mail only, for the two differences.** The wait (`deliveredAt - at`) and the unread time
  (`ackedAt - deliveredAt`) are read from mail whose `replayCount` is 0. A replay re-dates `deliveredAt`, which would
  over-state the wait and under-state the unread time by about ten minutes per replay. Replayed mail is counted apart,
  with its count. No first-delivery column is added (ruling F1).
- **`ingestedAt` is not used for the wait.** It may be another prompt, may be missed, may precede `deliveredAt` after a
  replay, and is on the other box's clock (F2).
- **Every mail is counted.** A row acked from the queue has `ackedAt` only, and its wait is `ackedAt - at`. A row parked
  or rejected without an ack counts as censored, never dropped (F3).
- **Read daily, with `--limit 500`.** `mail list --program overlord --all 1 --limit 500` returns the newest 500
  deliveries, newest first, with no cursor and no `since`. A read counts only when it returns fewer rows than its limit,
  so nothing was cut off. A `since` parameter is left to a later pull request, because the mail route is held by
  another programme in this round (ruling F8).
- Operator-message nudges carry no run, so `mail list --program` leaves them out (F7).

## 3. Findings for the ledger

| Slug | Finding | Where |
|---|---|---|
| `ingestedat-is-the-prompt-edge` | The brief described `ingestedAt` as "when the mail row was inserted". In the code it is the first `UserPromptSubmit` edge of any kind the mail sweep samples after a delivery, written once, on the fleet box's clock; the insert time is `at`, which the wire already served. The code governs, and the wire's docstring says so. | `server/src/coord/store.ts#markIngested`, `server/src/watch.ts` (`sampleEdge`) |
| `deliveredat-is-the-latest-delivery` | The brief described `deliveredAt` as "when a delivery first reached the pane". `markDelivered` writes it on every send, replays included, so on a replayed row it is the latest. Ruled in fix round 1: `replayCount` is served, and the baseline reads its two differences from unreplayed mail only (§2). | `server/src/coord/store.ts#markDelivered`, plan §7 |
| `ingestedat-mixed-clock` | `ingestedAt` is the fleet box's hook-state time and the other three are the server's, so a difference between `ingestedAt` and the others carries the two boxes' clock skew. | `server/src/watch.ts` (`sampleEdge`) |
| `deliveredat-is-pass-start` | `deliveredAt` is `mailPass`'s `now`, taken before the pass's reads, gates and sends, so it is earlier than the typed time, by tens of milliseconds to tens of seconds in a backlog (review 2760 F4). The docstring says so; the time is not restamped. | `server/src/watch.ts` (`mailPass`) |
| `mail-list-cannot-page` | `GET /api/mail` clamps to 500 rows with no cursor or `since`, so a week of programme mail cannot be read in one call (review 2760 F8). Ruled: read daily under the limit; a `since` parameter is a later pull request. | `server/src/coord/store.ts` (`clampMailLimit`), `ccd/ccrc-api` (`mail list`) |

## 4. Tests

- New: `server/test/mail-times-wire.test.ts`, on one temporary `CoordStore` for the file (a coord.db opens slowly on a
  loaded box):
  - the times:
    - a queued row answers none of the three;
    - a delivered row answers `deliveredAt`, an ingested row two, and an acked row all three it has;
    - a row acked from the queue answers `ackedAt` alone;
    - the outstanding and programme reads carry them;
    - a stored fraction, text, negative, zero, unsafe integer or hexadecimal text is answered absent;
  - the replay count:
    - a row never replayed answers 0, whether queued, delivered or acked;
    - a replayed row answers 1, with its `deliveredAt` the replay's, after its `ingestedAt`;
    - a stored count that is unprovable is answered absent;
  - the route: `GET /api/mail` serves all four on the outstanding list, the full history and the programme list.
