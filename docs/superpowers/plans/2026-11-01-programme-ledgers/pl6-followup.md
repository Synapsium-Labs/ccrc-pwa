# PL6 follow-up: secrets bookkeeping

Task note for the PL6 follow-up (run 1410, programme desktop-polish wave 84). PL6 (secrets pasted into the console) merged as
#2206. This pull request carries both PL6 reviews' leftovers (review 1 at `a7933a8b`, review 2 at `6eb1e6c0`) and builds the
operator's rulings of 2026-11-03 on programme items 8 ("one line is enough") and 9 ("keep stored secrets, and give me a
Remove control"). Deviation D-7926 is issued for it, and every departure below is named by slug under that one number. The
coordinator folds this note into the plan's ledger on its own pull request; this note edits no ledger.

## Step 0: what was measured before any change

Measured on this branch at `3bdf77083` (`main` with #2206, #2236 and #2242 in it), by reading the code and the tests.

| Finding | Measured |
|---|---|
| Review 2 F1, the re-key racing a first save | Holds. `index.ts`'s `requestRekey` reads every slot file through `operatorSecretRows` (async) outside the slot's chain, which is local to the route (`underSlot` in `ledgersRoutes.ts`). The masker's `settle` then calls `ingest`, which deletes every row of each lane the answer names and inserts the answer's. `ingest` checks the generation only, so a save that renamed V2 in and registered V2's row inside that span is replaced by V1's row. |
| Review 2 F2, `masked:true` on byte length alone | Holds. `ingestSecret` answers `masked` once the unpadded value is 20 to 8192 bytes and `ingest` lands; nothing asks whether the egress search can ever produce the value as one candidate. A value holding a space, `:`, `=`, `,` or another coarse delimiter is reported masked and its tail is shown. |
| Review 2 F3, the hint's unit | Holds. `SECRET_TEXT.hint` says "for a secret of 20 characters or more"; the server counts 20 UTF-8 bytes after any trailing `=`. The comment on `SECRET_TAIL_MIN` says four characters are "a fifth or more" of a value at the floor, which is false for a multi-byte value. |
| Review 2 F4, the scan blinded by the masker | Holds. The rig passes the real masker as `deps.masker`, so the response hook masks a registered value before the rig records the body. An echo of the value in the four after-write arms' details would be rewritten to the mask and the scan would pass. |
| Review 1 A4, a temp file left by a crash | Holds. `writeValueFileAtomic` (`token/files.ts`) writes `.<slot>.secret.tmp-<16 hex>` and removes it on a caught error only. A crash between the open and the rename leaves a 0600 copy of the value in the programme directory. `storedSlots` skips it (it lists `*.secret` only), so nothing masks, re-keys or removes it. |
| Review 1 A7, doctor's secrets posture | Holds. `_dr_secret_dirs` (`ccd/ccrc-doctor-checks`) names `~/.cc-secrets` and `~/.ccrc/auth-scratch` only, so `secrets-backup-excluded`, `filevault` and `snapshot-posture` SKIP on a server box ("the server never holds a lane secret"), which now holds the operator's pasted secrets and the Linear slot store. |
| Review 2 A-1, a box roster naming an operator lane | Holds. `offer` ingests the box's answer whole; a row whose lane carries `operator-secret:` replaces this server's row for that slot, and `retain` never prunes it. |
| Review 2 A-2, a row outliving a removed slot | Holds as a consequence: no path removes a slot (review 1 A3), and a slot removed by hand keeps its row; after a rotation `staleRows()` stays true and the re-key retries every 600 s. |
| Review 2 A-3, no deadline on the chain | Holds. `underSlot` awaits the previous holder with no bound. |
| Review 2 A-4, two `write-failed` arms that are false | Holds. (1) The fsync after the rename fails and the read-back (`slotHolds`) cannot read the file: `write-failed`, "nothing was sent", though the value may be stored. (2) `register` throws: `write-failed` though the value is stored. The metadata-fail arm leaves the previous save's `.json` in place. |
| Review 2 A-5 | Holds. The view-throws test does not assert the item's state, so it does not show which arm it hit. |
| Review 2 A-6 | Holds. `SECRET_TEXT.tooLong` says "characters" for a bound in bytes; the too-long line is not in `aria-describedby` and has no live role. |
| Review 2 A-7 | Holds. The panel's dark sentence says "needs sign-in turned on" for `insecure-origin` too. |
| Review 2 A-8 | Holds. `s.mode === 'off'` sits beside `armedMode` (`lib/auth.ts`) with no sentence saying why it differs. |
| Review 2 A-9, the body cap | Holds. `SECRET_BODY_LIMIT` is 16384 bytes; 8192 characters that each JSON-escape to six bytes need 49152. |
| Review 2 A-10, one line | Holds. `isSecretValue` takes `\n` and `\r`. |
| Review 2 A-11, doc drift | Holds. `mask.ts`'s header still says operator lanes are kept by `reloadRoster`'s keep set; `pwa/src/lib/api.ts`'s `saveItemSecret` comment says any refusal stores nothing and names "the last four" unconditionally. |
| Review 2 A-12 | Holds. `index.ts`'s fixed-text `console.warn` for an unreadable store has no departure. |
| Review 2 A-13 | Holds. `savedUnderScan` scans without waiting for the frame the tick emits; there is no 4-byte-character case at the tail floor and no test of the F1 race. |
| Review 1 A3 / review 2 A-2, no Remove | Holds. Nothing removes a stored slot. |
| A session's direct delete under the store | Already refused: the account arm's `ASEC` refuses any Bash text naming the store, a delete (`rm`, `unlink`, `shred`, `find … -delete`, `mv`, a `>` redirect) included, for a top-level session and a child alike, and `acctpath` refuses the edit tools there. No test pinned a delete form. |
| `server/src/auth/gate.ts` and `shared/api.ts` | PL6's PUT has no row in `gate.ts`: a session-gated route is gated by its absence from `EXEMPT`, and the tables a door joins are `auth-gate.test.ts`'s. `shared/api.ts` already lists the store in `ACCOUNT_SECRET_PATHS`. Neither file needs an edit for this task. |
