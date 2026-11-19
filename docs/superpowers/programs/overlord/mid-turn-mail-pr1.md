# Overlord wave 171, mid-turn mail PR 1: notes for the ledger

This note records what PR 1 of the mid-turn mail build (Task 1.1 of `docs/superpowers/plans/2026-11-19-mid-turn-mail.md`)
shipped and measured. The coordinator folds it into the programme ledger and mints any numbers. No D-number is defined
here.

## In short

- **Shipped:** `deliveredAt`, `ingestedAt` and `ackedAt`, three optional fields on `MailSummary`, served by every mail
  read that builds one (`mailForRecipient`, `outstandingMailFor`, `mailForProgram`, and so `GET /api/mail` and
  `ccrc-api mail list`). Each is one column of `MAIL_ROW_COLUMNS`, read as TEXT and proven by `persistedInt`, so a
  stored value that is not a positive safe integer is absent, never zero.
- **Additive:** `FLEET_PROTO` is not bumped. An older server omits the three, and absence means "not written".
- **Growth,** by the growth check's counter against `a6505783c`: `shared/api.ts` 5,113 to 5,116 (+3, 24 free under its
  5,140 cap after this PR); `server/src/coord/store.ts` +9 (the plan estimated +6, under the 40 limit). No waiver.
- **Mutations,** each an in-place edit restored from a saved copy whose sha256 was checked: dropping `ingestedAt` from
  `MAIL_ROW_COLUMNS` reds its four cases; answering zero for an absent time reds every case; reading the columns as
  numbers instead of TEXT reds the unsafe-integer case (`RangeError` from `node:sqlite`).

## 1. What each time means, measured from the code

The baseline (plan §7) reads these, so their meanings are stated exactly.

| Field | Meaning | Writer | Clock |
|---|---|---|---|
| `at` (already served) | When the mail row was inserted | `insertMail` | the server's |
| `deliveredAt` | When the lane last put the nudge into the recipient's pane. A replay re-dates it, so on a replayed row it is the latest delivery, not the first | `markDelivered` | the server's |
| `ingestedAt` | The time of the first `UserPromptSubmit` edge in the recipient's hook state that the mail sweep saw after that delivery. Written once | `markIngested`, from the watcher's `sampleEdge` | the hook state's own (`updatedAt`) |
| `ackedAt` | When the ack route committed the recipient's ack | `markAcked` | the server's |

## 2. Findings for the ledger

| Slug | Finding | Where |
|---|---|---|
| `ingestedat-is-the-prompt-edge` | The brief described `ingestedAt` as "when the mail row was inserted". In the code it is the recipient's first `UserPromptSubmit` edge the mail sweep sees after the delivery, stamped with the hook state's time; the insert time is `at`, which the wire already served. The code governs, and the wire's docstring says so. | `server/src/coord/store.ts#markIngested`, `server/src/coord/schema.ts` (the `mail_deliveries` table) |
| `deliveredat-is-the-latest-delivery` | The brief described `deliveredAt` as "when a delivery first reached the pane". `markDelivered` writes it on every send, replays included, so on a replayed row it is the latest. Plan §7's baseline reads `deliveredAt - at` as a mail's wait: for a replayed mail that over-states the wait by the replay interval. The baseline read can count replays apart (`replayCount` is not served) or read only unreplayed mail. Not changed here. | `server/src/coord/store.ts#markDelivered`, plan §7 |
| `ingestedat-mixed-clock` | `ingestedAt` is the fleet box's hook-state time and the other three are the server's, so a difference between `ingestedAt` and the others carries the two boxes' clock skew. | `server/src/watch.ts` (`sampleEdge`) |

## 3. Tests

- New: `server/test/mail-times-wire.test.ts`, on one temporary `CoordStore` for the file (a coord.db opens slowly on a
  loaded box): a queued row answers none of the three; a delivered row `deliveredAt`; an ingested row two; an acked row
  all three it has, and a row acked from the queue `ackedAt` alone; the outstanding and programme reads carry them; a
  stored fraction, text, negative, zero or unsafe integer is answered absent; and `GET /api/mail` serves them on the
  outstanding list, the full history and the programme list.
