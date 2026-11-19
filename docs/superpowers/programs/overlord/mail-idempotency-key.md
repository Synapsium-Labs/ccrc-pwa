# An idempotency key on mail sends (Overlord wave 164)

## In short

A session that re-runs `ccrc-api mail send` after an unclear timeout, or after the client's exit 3, used to send a second
copy of the mail. Coordinators send landing turns, ACCEPTED and MERGED mails, so a duplicate could drive a second act. A send
may now name an optional `clientKey`. The server keeps one mail per sender and key, and answers a retry with the mail it
already made.

## 1. The gap, measured on main

`CoordStore#insertMail` was a plain `INSERT`, and the `POST /api/mail` handler had no dedupe for run mail. Peer mail
(`runId` null) had a narrower guard: check 9's `duplicate` refuses a second outstanding peer mail with the same subject. That
guard refuses the retry instead of answering it, so the sender cannot tell "already sent" from "refused". It also ends once
the first copy is acked, and it does not apply to run mail at all. `ccd/ccrc-api` does not retry on its own.

## 2. The design as built

| Decision | Choice | Why |
|---|---|---|
| Wire | an optional `clientKey` field on the `POST /api/mail` body | Additive: absence permits, so an older client and every send without a key behave exactly as before, and `FLEET_PROTO` is not bumped. |
| Shape | `isMailClientKey` (`shared/api.ts`): 1 to `MAIL_CLIENT_KEY_MAX` (128) of letters, digits, `_` and `-`; a wrong shape is `bad-kind` (400) | The same character set as the client's `SAFE_RE`, so `--key` and the route accept the same words. Null is the same as absent. |
| Uniqueness | per sender, (`fromId`, `clientKey`) | Two sessions choosing the same key never collide. |
| Compared fields | `toId` (as sent, so a role word stays a role word), `runId`, `kind`, `subject`, `body`, `artifacts` (order matters), `inReplyTo` (as sent, stored in `mail.inReplyTo`; review 2725 F1) | These are what the mail row records. `fromUuid` is not compared, because a `/clear` rotates it between a send and its retry. A different reply target under one key is a different mail, refused rather than merged. |
| Text | compared as the store keeps it: a lone surrogate reads as U+FFFD on both sides (`storedText`; review 2725 F4) | SQLite stores TEXT as UTF-8, which cannot carry a lone surrogate, so a genuine retry of such text would otherwise be a false `conflict`. A well-formed pair is never folded. |
| Verdict | `mailKeyVerdict` (L1, `server/src/coord/mailKey.ts`): `new`, `same` or `conflict` | Decided once, in policy; the route reads the stored mail and acts. |
| `same` | 202 `{ ok: true, id: <original>, already: true, clientKey }`; nothing is queued and nothing is recorded | The answer of the first send plus `already`, so a retry gets the same answer, and a caller that reads `id` keeps working. It answers whatever became of the first mail's delivery, and a key never expires, so a deliberate resend needs a new key (review 2725 F2, ruled: said in the reference and the client's help, behaviour kept). |
| Echo | every answer to a keyed send echoes `clientKey` (review 2725 F3) | An accepted answer without it came from a server that ignored the key, such as one rolled back to before it. The client then says on stderr that a retry may send twice. |
| `conflict` | 409 `key-conflict`, recorded in `mail_rejections`; the detail names the original mail and the differing fields | A key reused for a different message is a caller defect. Accepting either copy would mean guessing which one the caller meant. |
| Where the check sits | check 6.5: after attribution (checks 5, 5.5 and 6) and the other-lane refusal, before checks 7 to 9 | A key is read only for a sender proven current, so a stale sender still gets `stale-uuid`. A retry of an accepted mail answers that mail even where a fresh send would now be refused, such as a retried peer mail that check 9 would otherwise call a `duplicate`. |
| Race | no `await` sits between the key read and the insert, and `mail_client_key_once` is a partial unique index on `mail(fromId, clientKey)`; if the insert ever meets it, the route catches that one error (`isMailClientKeyClash`), re-reads and asks the decider again (review 2725 F5) | Node runs the rest of the handler in one tick, so no second send can store the key in between today. If a later change adds an `await`, the loser of the race still answers `same` or `key-conflict`, never a 500, and never stores two rows. |
| Writer | `insertMail` is the one writer of `mail.clientKey` and `mail.inReplyTo`, from the mail ingress only; `mailByClientKey` is their one reader | One writer per fact. A stored row whose `artifacts` cannot be parsed reads as `['']`, which no request carries, so it answers `conflict` and never `same`. |
| Client | `ccrc-api mail send --key <k>` appends `clientKey` last; a body that already names `clientKey` beside `--key` is refused `bad-body`, unsent; `--key` on any other row is `bad-args` | The client never invents a key, so a send without `--key` goes out byte for byte. |
| Migration | two nullable columns and one partial unique index on `mail` | An older build opening the file takes rule 3, never names the columns, and writes keyless rows, which the index admits without limit. |

## 3. The migration slot

Main stood at 102 entries when this was cut. Door A1 (#3035) then landed 103, so after one absorption (the branch
conflicted in the slot) the entry is 104 by position. Approvals PR 1 (#3043) has since landed 104 and #3021 is promised
105, so the entry takes the next free slot at its landing merge, under the coordinator's standing license.

## 4. Tests and mutation measurement

- `server/test/mail-client-key.test.ts`: the brief's five cases (same key and same mail give one mail and one delivery; same
  key and a different body is a 409; the same key from another sender is separate; no key behaves as today; the key survives
  a server restart), plus a retried peer mail answering `same` rather than `duplicate`, a wrong key shape, a stale sender
  refused before the key is read, and the unique index on its own. Written red first: the route and database cases failed
  before the store, the migration and the route existed.
- `server/test/ccrc-api-mail-key.test.ts`: the client's `--key`. Measured red against the old client (four of five fail; the
  case without `--key` passes on both, as it should).
- `server/test/sim/mailKeySets.ts`: the decider's oracle, run against the real module by the route test, and eight textual
  mutants run by `sim/mutation-floors` at floor 1. All eight are killed.
- By hand, restoring each file from a saved copy: dropping the unique index, an index that ignores the sender, the key never
  stored, a lookup that ignores the sender, the route's lookup skipped, `same` without `already`, a conflict accepted, the
  key not passed to the insert, and a bad key shape admitted. All nine are killed by `mail-client-key.test.ts`.

- Fix round 1 (review 2725): cases for `inReplyTo` (a different or absent target is `key-conflict` naming it), a retry of
  text with lone surrogates answering `same`, the race forced through the store (the key read blinded once, so the insert
  meets the index: `same` for the same mail, `key-conflict` for another), the store's clash recogniser, and the client's
  echo line and help. The decider's mutant set grows to fourteen (inReplyTo left out, text and artifacts compared raw,
  nothing folded, every surrogate folded, numbers never compared). By hand, the catch, the clash recogniser, the echo on
  both answers, the client's line, a clash the re-read cannot explain answered instead of failing, and `inReplyTo`
  dropped at each of its four places: twelve, all killed.

## Where things stand

- **Agreed:** the brief's design lines and review 2725's five rulings, all built as above.
- **Waiting on you:** nothing.
- **Later:** nothing.
