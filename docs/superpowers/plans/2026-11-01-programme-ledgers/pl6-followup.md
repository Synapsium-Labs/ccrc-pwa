# PL6 follow-up: secrets bookkeeping

Task note for the PL6 follow-up (run 1410, programme desktop-polish wave 84). PL6 (secrets pasted into the console) merged as
#2206. This pull request carries both PL6 reviews' leftovers (review 1 at `a7933a8b`, review 2 at `6eb1e6c0`) and builds the
operator's rulings of 2026-11-03 on programme items 8 ("one line is enough") and 9 ("keep stored secrets, and give me a
Remove control"). One deviation number was issued for it, and every departure below is named by slug under that one number.
The number is not spelled here: `deviation-refs`' floor case refuses a tracked reference above the ledger's defined
high-water, and the number is defined only when the coordinator folds this note into the plan's ledger on its own pull
request (PL9's note met the same rule). The pull request body and the wave-done mail name it. This note edits no ledger.

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
| `server/src/auth/gate.ts` and `shared/api.ts` | PL6's PUT has no row in `gate.ts`: a session-gated route is gated by its absence from `EXEMPT`, and the tables a door joins are `auth-gate.test.ts`'s. `shared/api.ts` already lists the store in `ACCOUNT_SECRET_PATHS` and needs no edit. CORRECTED later: `gate.ts`'s header names the HTTP route count, which `auth-gate.test.ts` derives, so it needed its one number changed (see Claims and leave). |

## What this pull request does

| Item | Done |
|---|---|
| Programme item 8, one line | The PUT refuses a value holding `\r` or `\n` with its own word, `secret-not-one-line` (400), after the value bound and before any write (`isOneLine`, `shared/ledgers.ts`). The panel keeps its single-line field. Closes review 2 A-10. |
| Programme item 9, keep and remove | A stored slot outlives its item (nothing removes one but the operator). `DELETE /api/programmes/:slug/secrets/:slot` is the Remove door, in the PUT's order: the account gate with a step-up first, then both names re-checked (`bad-slot`), then, on the slot's chain, the path built and the value file, its record and its leftover temps removed (`removeOperatorSecret`). The masker then retires the slot's lane (`retireSecret`): the rows leave `secret_fingerprints` and are kept in this process's memory only, so the removed value is masked until a restart and nothing reloads it after. `GET /api/programmes/:slug/secrets` answers each stored slot's name, save time and asking item, never any part of a value, and tells an unreadable store (`secrets-unreadable`, 503) apart from an empty one. The programme screen's Waiting card gains a "Stored secrets" section, shown only when the programme has one, each row with a Remove that asks for confirmation; a secret item's view shows "Stored" with Remove while its slot is stored. A session's direct delete under the store was already refused by the account arm (step 0), now pinned by test. Both doors are in the box-token census (`LEDGER_OPERATOR_DOORS`) and the auth-gate tables. Closes review 1 A3 and review 2 A-2. |
| Review 2 F1, the re-key race | Proved by test that the outcome is the same either way, rather than serialised: the re-key only FILLS an operator lane, never replaces one that already holds a row of the current token (a save wrote it), and never writes back a lane removed in this process; decided inside the write's own transaction. Two tests run the real masker's re-key with its request held open across a save (and across a Remove). |
| Review 2 F2, `not-one-run` | `masked` is measured: once the row lands, the masker's own search (`fingerprintSpans`) runs over the value standing alone, and `masked` means it caught the whole value. Otherwise the why is `not-one-run` and the tail is withheld. The test title the review named is corrected. |
| Review 2 F3, bytes in the hint | The hint says "at least 20 bytes"; the too-long sentence and the bad-request sentence say bytes. No second floor. The comment on `SECRET_TAIL_MIN` is softened. |
| Review 2 F4, a blind scan | Every leak-scan rig gives the server an egress that masks no fingerprint (`egress: 'blind'`), while registrations still go to the real masker, so an echo is a hit whatever the masker would do. A control test shows the blind egress really shows a registered value. |
| Review 1 A4, temp files | Each write and each Remove of a slot first removes that slot's own leftover `.<slot>.secret.tmp-*` and `.<slot>.json.tmp-*` files, on the slot's chain, so another slot's write in flight is never touched. |
| Review 1 A7, doctor | `_dr_secret_dirs` names the server's two stores beside the lane-secret directories, so `secrets-backup-excluded`, `filevault` and `snapshot-posture` measure a server box that holds the operator's secrets or the Linear slot store. |
| Review 2 A-1 | `offer` drops any operator-secret row a box's roster answer carries, and the re-key's composer drops them from the box's part; one L0 predicate, `isOperatorSecretLane`. |
| Review 2 A-3 | A 30 s deadline on the per-slot chain (`SLOT_WAIT_MS`); a waiter that gives up answers `slot-busy` (503) and releases its place, and the act it waited on still finishes. |
| Review 2 A-4 | A read-back that cannot read the file after a failed fsync counts as stored (the masker is told, the operator is told to save again); a `register` that throws counts as `unregistered`; a failed record write removes the previous save's record. |
| Review 2 A-5 | The view-throws test asserts the item is `checking`. |
| Review 2 A-6, A-7, A-8 | Bytes in the too-long sentence, the too-long line in `aria-describedby` with `role="alert"`; a separate sentence for `insecure-origin`; one comment naming `armedMode` as legitimately different. |
| Review 2 A-9 | `SECRET_BODY_LIMIT` is `SECRET_VALUE_MAX * 6 + 1024` (every character escaped to six bytes). |
| Review 2 A-11, A-12, A-13 | The masker's header and the client's `saveItemSecret` comment are true again; the re-key's fixed-text warn is named below; the scan waits for the frame the tick emits, there is a 4-byte-character case at the tail floor, and the F1 race has its tests. |
| Not this PR | Review 1 A5 (the hook's residual forms, recorded) and A6 (`credentialBodyRoute` consolidation, to the carry PR). |

## Departures (all under the one issued number)

- **pl6f-tail-only-when-masked**: the ruling withholds the tail for `not-one-run`; this PR withholds it for every unmasked answer (`unregistered` too), so the rule is one sentence: the tail is shown only when the masker catches the value. The safer direction.
- **pl6f-masked-measured**: `masked` is the masker's own search run over the value alone after its row lands (`catchesWhole`), not a second predicate beside the search.
- **pl6f-rekey-fills-only**: F1 is closed by making the two orders end the same (the brief's second option), not by a lock shared between the route and the masker.
- **pl6f-retired-rows-in-memory**: a removed slot's rows move from the table to memory. A retired row keyed with a previous token matches while that token is kept (at most four previous tokens); the table's delete rides the offer's held queue, retried when coord.db is busy.
- **pl6f-remove-retires-nothing-stored**: Remove of a slot with no value file still retires the lane and answers `secret-not-stored`, so a row left by a slot removed by hand stops being re-keyed (review 2 A-2).
- **pl6f-meta-names-item**: the slot's record gains `item`, the id of the item whose save wrote it; the read joins that item's title only when it belongs to the same programme. A record from before this PR names no item.
- **pl6f-meta-needs-value-file**: `readOperatorSecretMeta` answers nothing when the value file is gone, whatever record is left, so the item view's "Stored" follows the value file. The other direction (a value file whose record is missing, unreadable or unparseable) is its own state since fix round 1: `pl6f-r1-unrecorded-state`.
- **pl6f-read-masked**: the stored-secrets read is in `MASKED_GET_ROUTES`: it carries no value, but an asking item's title is text a session wrote. (Raised by the commit's automated security review.)
- **pl6f-read-no-step-up**: the read is session-gated only; it reads no value.
- **pl6f-no-store-shared-hook**: both new doors answer `Cache-Control: no-store` on every answer, refusals included, from the
  `onRequest` hook the PUT already takes (`credentialBodyRoute`, `accounts/gate.ts`): a quoted header name in
  `server/src/coord` would be an undeclared kebab code to `mail-routes.test.ts`'s census, so the one spelling stays in the
  account gate. (Raised by the commit's automated security review after a first fix dropped the header.)
- **pl6f-five-words**: `secret-not-one-line` 400, `secret-not-stored` 404, `slot-busy` 503, `secrets-unreadable` 503, `remove-failed` 503, each with its status and a console sentence.
- **pl6f-remove-word**: the store's remove answers `removed` or `none`, and the read's states are `ok`, `unreadable` and `invalid`: `absent` beside `removed` is another context's vocabulary pair (`late-census.test.ts`), and a quoted kebab word in `server/src/coord` must be a declared code (`mail-routes.test.ts`).
- **pl6f-slot-deadline**: `SLOT_WAIT_MS` is 30 s, a constant with a test override (`slotWaitMs`); the map entry stays until the running act finishes, so the deadline never lets two acts of one slot run together.
- **pl6f-paths-from-listing**: the read and the Remove door build no path from their route parameters. Each finds the
  programme directory and the slot's files by listing the store and taking the entry equal to the name asked for, after the
  names pass their shapes; the temp sweep matches entries with a fixed expression and never compiles a slot name into one.
  CodeQL's `js/path-injection` (ten alerts on the first push) does not recognise a guard inside a helper; this removes the
  flow instead of dismissing the alerts.
- **pl6f-temps-on-write**: leftover temps are cleaned on the next write or Remove of their slot, and (fix round 1, review 1416 A-S6) once across the whole store at server start: see `pl6f-r1-sweep-at-start`.
- **pl6f-unknown-readback-counts-stored**, **pl6f-register-throw-unregistered**, **pl6f-failed-record-removes-old**: A-4 as above.
- **pl6f-roster-drops-operator-lanes**: A-1 in both entries (`offer`, `withOperatorSecretRows`), through one L0 predicate.
- **pl6f-scan-blind-egress**: F4 as above.
- **pl6f-doctor-server-stores**: A7 adds the Linear slot store as well as the operator's (review 1 named both); the three SKIP lines name the four directories once (`SECRET_DIRS_NAMED`).
- **pl6f-hook-unchanged**: no hook or installer edit. The account arm's existing pattern refuses the delete forms that SPELL THE STORE PATH (`~/.ccrc/operator-secrets`): its Bash arm matches the command as text once quotes and backslashes are stripped, in the `~`, `$HOME`, `${HOME}`, absolute, split-quote and backslash spellings, with `//` and `/./` separators, and an assignment that names it. `x/../` is refused for the edit tools only (and Read, Grep and Glob, which fold `..` before matching), never for Bash: `rm -rf ~/.ccrc/x/../operator-secrets` is among the residuals below. The test pins twelve Bash delete forms, in the `~` and `$HOME` spellings, and Write and Edit, for a top-level session and a child; the `${HOME}`, absolute and `//` spellings are pinned by the read-form test only. Matched by the pattern but pinned by no test: the backslash spelling, the Bash `/./` separator and an assignment that names the store (review 1426 F-B); the split-quote spelling is pinned since the desktop-polish server carry (run 1428, `carry-server.md`), in one read form, `cat ~/.ccrc/'operator'-secrets/prog-a/x.secret`. It does not refuse a delete form that never spells the path: those are recorded as residuals below (`pl6f-r1-hook-residuals`). The no-new-arm ruling is the coordinator's, in mail 14621 ("Ruled: no new hook arm. The arm is an accident guard by contract"). The hook arm was the coordinator's brief's own elaboration of the operator's item 9; the operator asked for keep-and-Remove. This pull request does not build a hook arm for the unspelled delete forms.
- **pl6f-stored-ui-shared**: `StoredSecretRemove` lives in `ItemView.tsx` and the programme screen imports it; the section sits inside the Waiting card, so no new card and no shell change.
- **pl6f-dark-sentences**, **pl6f-armedmode-different**: A-7 and A-8 as above. Restating `pl6-sign-in-read-up-front`: its fallback is per mount, so on a plain-HTTP origin with sign-in armed one value is sent per visit before the server refuses it `insecure-origin`; nothing is stored.
- **pl6f-rekey-unreadable-warn**: `index.ts`'s `console.warn` for a store that could not be read whole is fixed text naming no slot and no value (review 2 A-12).
- **pl6f-view-throws-word**: the view-throws arm still answers `stored-not-ticked` though the item is ticked (declared in `pl6-stored-not-ticked`); its test now pins the state.

## Fix round 1 (review 1416, at `5d1e0e1c`)

The coordinator's rulings of mail 14621. Each fix has a test, and a mutant that reverts it goes red (table below).

| Item | What changed |
|---|---|
| F1, a faulted re-save left the old value on disk unmasked | A read-back that cannot read the slot (`unknown`) registers the new value BESIDE the lane's rows (`ingestSecret`'s `beside`), never in place of them: both values stay masked until a save whose write proves the slot replaces the lane. A `yes` read-back still replaces (the slot is proven to hold the new value). Pinned with one fault (EMFILE) failing the temp open, the record's temp open and the read-back open. |
| F2, the read folded an unreadable entry into "no slots" | The per-entry `lstat` skips only `ENOENT`; any other failure is `secrets-unreadable`, as the re-key's reader already was. Pinned with a 0600 programme directory and an injected EIO on one entry. |
| F4, an item hid "Stored" when the record was unreadable | A slot holding a value whose record is missing, unreadable or unparseable is `secretSet: {at: null}` (`OperatorSecretUnrecorded` server-side), never `null`. The item view shows "Stored" and Remove, with no saved line; its key and the programme screen's reload key handle `null`. Pinned on the state `pl6f-failed-record-removes-old` leaves, and on an unparseable record. |
| F5, the new rows had no styles | `ledgers.css` styles the Stored secrets rows (the name in mono, the saved-when and the asking item each a line of its own, on the raised ground) and the item's Stored block; a Remove's refusal and its "Removed." take the item card's tinted pairs. Each rule states its own ground, so the contrast audit measures it. The programme-screen test asserts the three parts are separate elements and reads each rule from the sheet. Looked at in Refined and Instrument, light and Nord, at 390 and 1280: no sideways scroll, no page error. |
| F7, the leak scan saw whole values only | The scan looks for the whole value and every 12-character piece of its random part, in plain text, base64 and base64url (at all three byte alignments) and hex (both cases). The 4-character tail is shorter than any piece. The exact `detail` of every `stored-not-ticked` arm and of `write-failed` is asserted. The scan's control finds a planted piece, the value less its last character, two base64 forms and a hex form, and does not find the tail. |
| A-R2 | `slot-busy` (both values), `secrets-unreadable`, `remove-failed`, both F1 race orders (both values), the Remove race and a `register` that throws carrying the value are under the scan. |
| A-R4 | `EGRESS` and a new `NOT_EGRESS` must together be exactly `SecretMasker`'s members, with no name in both: a new member reds the suite until it is placed. |
| A-R5 | `isOneLine` also refuses VT, FF, NEL (U+0085), LS (U+2028) and PS (U+2029), under the same word; both the item-8 case and the scan's break forms carry them. |
| A-S4 | The retired mark is cleared only once the new row has landed, so a refused re-save (too short, too long, unregistered) cannot let the re-key write a removed value's row back. `close()` makes one last try at what is held. |
| A-S5 | When the SELECT of a retired lane's rows fails, the rows stay in the table and no delete is queued (the comment's safe side, now the code's). |
| A-S6 | On start, every slot's leftover temps across the whole store are swept. |
| A-F4 | The PUT's doc comment says the tail is shown only when the masker catches the value. |
| A-F5 | Doctor's FAIL, WARN and PASS lines name the directories found (or "the secrets stored in them"), never "lane secret(s)"; a case measures `secrets-backup-excluded` on the server's two stores, FAIL and PASS. |
| F6 | `pl6f-hook-unchanged` reworded; the unspelled delete forms recorded as residuals (`pl6f-r1-hook-residuals`). No new arm, as ruled. |
| F3 | Recorded as a residual for the carry list (`pl6f-r1-case-colliding-slugs`). No change, as ruled. |
| A-F6, A-R3 | Recorded: the coordinator accepted mail 14581 and the line-8 edit; the scan's copy of `requestRekey` stays. |

Departures and residuals of the fix round:

- **pl6f-r1-beside-on-unknown**: F1 takes the first of the two directions offered (add beside), because the second (answer `unknown` only when the failure is proven to come after the rename) cannot be measured from outside `writeValueFileAtomic`, which reports no step. A Remove's delete still waiting on a busy coord.db when a beside row lands is cancelled, as for any landed save: the removed value's row then stays in the table and masks it until a proving save replaces the lane (more masking, nothing leaves).
- **pl6f-r1-unrecorded-state** (reworded in fix round 2, F3): `ItemView.secretSet` gains a third shape, `{at: null, tail: ''}`. Server and console ship together. The console a cached page can hold is `main`'s, which has no Stored block and no Remove: it reads `secretSet` only on a `checking` secret item, where it draws `SECRET_TEXT.saved(tail)` and, because `masked` is not `true`, the "Not registered for masking in outgoing text…" hint; on every other item it draws nothing, and nothing in it can crash (no length, no date is made from `at`). With `{at: null}` alone that line read "Saved. Ends in undefined."; the empty tail (true of this state: no character of the value is shown) makes it read "Saved.". `masked: true` is NOT sent, because it is not true of every case where the state is sent: a save whose record write failed after the masker answered `too-short`, `too-long`, `not-one-run` or `unregistered` reaches this same state, and so does a record lost or left by another build, where whether the value is masked is not known; `masked: true` would hide the hint from a value that is not masked. So such a console still shows the hint on a checking item in this state until it reloads. Rare by construction (a record that failed to write or parse).
- **pl6f-r1-retired-after-landing**: this reverses `M16`'s earlier pin ("a re-save that writes no row still clears the retired mark"), as A-S4 ruled. The cost: after a Remove, a re-save that lands no row (no token, coord.db busy) leaves the lane retired, so the re-key does not fill it in this process; the save already answered `unregistered`, and the next restart, or the next save whose row lands, gives the lane back to the re-key.
- **pl6f-r1-close-flush**: `SecretMasker.close()` makes one last try at what is held (a Remove's delete, a roster answer) and, coord.db still busy, says so in one fixed line and stops. The production server's one signal handler is the shutdown seal (D-4916, `server/src/shutdownseal.ts`, outside these claims), which closes no masker, so a production stop does not reach that try: a delete still held at that moment stays in the table, is reloaded after the restart and goes on masking the removed value (more masking, nothing leaves) until a save of that slot replaces the lane. Wiring the masker into the seal is a change to a file this run does not hold.
- **pl6f-r1-sweep-at-start**: the start-up sweep runs when the server registers the secret routes, synchronously, before any route can write, so no write is in flight to lose its temp. It enters only private directories of ours, builds every path from listing entries, and removes only names of a slot's temp shape.
- **pl6f-r1-scan-pieces**: the piece is 12 characters (ruled "12 or more"); a value of 12 characters or fewer is looked for whole.
- **pl6f-r1-hook-residuals** (F6; beside review 1's A5, recorded, not built, as ruled): measured by review 1416 in fixture homes, a top-level session's hook does not refuse `find ~/.ccrc -name '*.secret' -delete`, `find ~ -name '*.secret' -delete`, `find ~/.ccrc -path '*operator-secrets*' -delete`, `find ~/.ccrc -type f -delete`, `find … -exec rm {} +`, `rm -rf ~/.ccrc/oper*/prog-a`, `rm -rf ~/.ccrc/history/../operator-secrets`, `rm -rf ~/.ccrc/x/../operator-secrets`, `cd ~/.ccrc && rm -rf operator-secrets` (and with `;`, and a bare relative `rm` after an earlier `cd`), `rm -rf ~/.ccrc`, `X=operator-secrets; rm -rf ~/.ccrc/$X` and `D=~/.ccrc; rm -rf $D/operator-secrets`. The glob and brace forms (`~/.ccrc/operator-sec*`, `operator-secre?s`, `[o]perator-secrets`, `~/.ccrc/{operator-secrets,x}`) pass a top-level session too; a child is refused them only by the unrelated `build` trust-glob row. `ACCOUNT_DENY_RULES` lists the store under `Read(...)` only, so every refusal above is the hook's text match.
- **pl6f-r1-case-colliding-slugs** (F3, for the carry list): on a case-insensitive filesystem (a macOS server box), two programmes whose slugs differ only by case (`prog` and `Prog`) share one directory, because the write builds its path with `path.join` while the read and Remove look the directory up by exact name in the listing. Reproduction from the review: the PUT for `Prog:s` writes into the existing `prog/`; `GET /api/programmes/Prog/secrets` answers empty; Remove of `Prog/s` answers `secret-not-stored` yet retires lane `operator-secret:Prog:s` while the value file stays; the item view (built by `path.join`) shows Stored and its Remove keeps answering `secret-not-stored`; after a restart the re-key fills `prog:s`, not `Prog:s`. The collision itself predates this PR (a PUT for `Prog:s` already overwrote `prog`'s value); Linux is unaffected.

## Fix round 2 (review 1418, at `3d0ca5eb`)

The coordinator's rulings of mail 14648. Each fix has a test, and a mutant that reverts it goes red (table below).

| Item | What changed |
|---|---|
| F1, a beside row could leave the old value unmasked after a rotation and a restart | The re-key that reads an operator lane holding a row of the current generation no longer skips it: it adds the row it read beside the current rows and deletes the lane's rows of every other generation (`SecretMasker.ingest`'s `rekey`). A retired lane is still skipped. Pinned in the review's order: save V1; rotate with the slot unreadable (EIO); re-save V2 under the same fault (`unknown`); the slot readable again; the re-key; restart: V1 is masked, the lane holds V1 and V2 under the current token only, and `staleRows()` is false. The header of `writeOperatorSecret` names the one window left (`pl6f-r2-rekey-window`). |
| F2, the item reader folded an unreadable value file into "nothing stored" | `readOperatorSecretMeta` answers `null` only on `ENOENT`; any other failure is `{unreadable: true}` (`OperatorSecretUnreadable`), carried as `secretSet: {unreadable: true}`, distinct from `{at: null}`. The item view draws it as the stored-secrets read's own `secrets-unreadable` sentence, with no Stored, no Remove and no field to give a secret. `privateDir` requires the owner's search bit, so a write into a 0600 programme directory refuses as unsafe (`write-failed`) before anything is written or registered. Pinned with a 0600 programme directory through the reader, `/api/waiting`, the coordinator's item list, the PUT and the item view, and an injected EIO beside an ENOENT. |
| F3 | (a) `pl6f-r1-unrecorded-state` says what `main`'s console does, and the state carries `tail: ''` (not `masked: true`, which is not honest for every case; the departure says why). (b) `pl6f-hook-unchanged`: `x/../` is refused for the edit tools only. (c) The no-new-arm ruling is named as the coordinator's, in mail 14621. |
| A1 | `scheduleRekey` returns at once once the masker is closed; review O1 (`close()` not setting `closed`) is red. |
| A2 | The Remove route's doc and `retireSecret`'s say that the failed-SELECT and held-at-stop arms keep the removed value's rows, which reload and mask after a restart. |
| A3 | Pinned: the reload key keeps none, unrecorded and unreadable apart (review O2), the start-up sweep's top-directory check (O4), and the rendered section and item block carry `pv-secrets` and `wi-stored`. |
| A4 | Doctor's comments name the four directories, the "Decryption in progress" WARN is pinned in full, and the doctor case widens `box`'s type instead of `as never`. |
| A5 | Ruled, no change: a secret is one line under CR, LF, VT, FF, NEL, LS and PS; U+001C to U+001E are separators, not line ends, for the shells and env files a secret goes into. |
| A6 | `.pv-secrets .wi-status` wraps anywhere, as its item-card twin does. |

Departures and residuals of fix round 2:

- **pl6f-r2-rekey-adds-beside**: F1 reverses review 1391 F1's pin "the slot keeps the save's row, not the value the re-key read". When a save lands while a re-key is in flight, the save's row stands and the value the re-key read is masked beside it, because the re-key cannot tell whether that value is still on disk. That is more masking, never less, until the next save that proves the slot replaces the lane. The race test is reworded to pin it.
- **pl6f-r2-rekey-window**: the one order that still leaves a value on disk unmasked, named in `writeOperatorSecret`'s header: a rotation while the slot cannot be read leaves the lane's rows under the previous token, which this process keeps but a restart forgets, so from the restart until the re-key reads the slot (it asks at start, then on its backoff) the value is unmasked. Rows also grow by one per distinct value saved under a persisting `unknown` fault (re-saving one value is idempotent); the next proving save or Remove clears them, and so does the first re-key after a rotation (review 1426 F-I): it finds no row of the new generation in the lane, so it deletes the lane's rows before it inserts the one it read.
- **pl6f-r2-unreadable-state**: `ItemView.secretSet` gains a fourth shape, `{unreadable: true}`. `main`'s console meets it only on a checking secret item, where it reads "Saved. Ends in undefined." with the masking hint until it reloads; no field of the state can be made honest for that console, since whether a value is stored is not known.
- **pl6f-r2-owner-search-bit**: only the write requires the owner's search bit. The readers keep `isPrivateDir` as it was and measure a directory they cannot search per entry (`unreadable`), so the stored-secrets read's 0600 case still pins its per-entry catch (M22).

## Claims and leave

- Claims: 3387 (the main list), 3389 (`server/test/ccrc-doctor-codex.test.ts`, the posture checks' tests) and, in fix round 1, 3396 (`pwa/src/ledgers/ledgers.css`, F5). Fix round 2 stayed inside the three. `ccd/session-hook.sh` and `ccd/install-session-hooks.sh` were claimed and left untouched.
- Leave 14570, from run 1312's coordinator, holder of claim 3358 on `server/src/auth/gate.ts`: line 8's route count, 167 to 169, the one edit (`auth-gate.test.ts` derives it; my step 0 said no edit was needed, which was wrong, and mail 14581 said so). Nothing else in `gate.ts`. `shared/api.ts` is untouched.
- Leave 14577, from the same coordinator, holder of claims 3361 and 3362: in `server/test/box-token-census.test.ts`, the two paths after `'/api/items/:id/secret'` in `LEDGER_OPERATOR_DOORS`; in `server/test/auth-gate.test.ts`, the `coord/ledgersRoutes.ts` count (14 to 16), the Remove door's `FLAG_AWARE` row and its list (now nineteen), `ROUTES.length` 170 to 172 with its comment, the "172 scanned" comment, and the two "all 169 HTTP routes" sentences. Run 1312 changes some of the same lines; whichever lands second recounts on its merge of main.
- `server/test/secret-mask.test.ts` (run 1312's claim 3363) is untouched; the masker's new cases are in `ledgers-secrets.test.ts`.
- `CLAUDE.md`: the ledgers operator-doors sentence only, naming the two new doors.

## Mutants

Each is one exact edit of a saved copy, run on its named case, then restored from the copy with its sha256 checked; `git status --short` was empty after every round. All thirty-eight went red on fix round 1's tip (M1 to M20 re-run there; M16 is retired, below). On fix round 2's tip, the fourteen new mutants (M32 to M37) went red, M8, M12 and M23c went red after being re-pointed at the lines that round changed, and M21 to M31 were re-run and went red.

| Mutant | Red on |
|---|---|
| M1 Remove without step-up | refused without step-up: step-up-required, and the slot stays |
| M2 Remove skipping the slug re-check | a slot or programme that fails its shape is bad-slot |
| M3 the stored-slots read returning a value byte (the tail) | lists each stored slot by name … NOTHING of any value |
| M4 unreadable folded to empty (route) | an unreadable store is secrets-unreadable |
| M4b unreadable folded to empty (store reader) | an unreadable store is secrets-unreadable |
| M5 the one-line refusal removed | a value with a carriage return or a line feed is refused |
| M6 not-one-run folded into masked | a value the egress search cannot catch as one run answers not-one-run |
| M7 the hint counting characters | the hint says one line … BYTES (pwa) |
| M8 the re-key race unserialised (fill-only guard removed) | the save lands while the re-key is in flight |
| M9 the temp-file clean-up removed | the slot's own leftover temps go |
| M10 the roster filter removed | offer drops an operator lane the box names |
| M11 Remove does not retire the lane | removes the value file … nothing reloads it after a restart |
| M12 the re-key's retired skip removed | a re-key in flight across a Remove never writes the removed slot's row back |
| M13 the tail shown for an unmasked value | not-one-run case, and the no-masker case |
| M14 blind egress off | the scan is blind to the masker |
| M15 the chain deadline removed | an act that waits past it answers slot-busy |
| M16 (retired in fix round 1: A-S4 ruled the opposite behaviour, which M26 pins) | n/a |
| M17 the read not masked by the answer hook | the stored-secrets read goes through the answer masker |
| M18 the record-write arm echoes the value | the metadata write fails; the directory fsync fails |
| M19 the view-throws arm echoes the value | the answer's item view throws after the tick |
| M20 the read answered without no-store | lists each stored slot by name; a slot whose record is missing (the refusal) |
| M21 F1: the unknown read-back replaces the lane's rows (the store asks without `beside`) | the temp open and the read-back open both fail |
| M21b F1: the masker ignores `beside` and deletes the lane's rows | the temp open and the read-back open both fail |
| M22 F2: the bare `continue` on a failing entry | listed but not searched (0600); an I/O error on one slot's file |
| M23 F4: a missing record folded to null | the state pl6f-failed-record-removes-old leaves |
| M23b F4: an unparseable record folded to null | the same case |
| M23c F4: the item view draws the unrecorded state as a saved one (pwa) | no readable record is stored all the same |
| M24 F5: the row loses its layout (css) | a row's parts are separate, each with its rule (pwa) |
| M24b F5: the row's parts share one class again | the same case |
| M25 F7, review O5: the view-throws arm echoes the value less its last character | the answer's item view throws after the tick |
| M25b F7, review O6: the record-write arm echoes the value's base64 | the metadata write fails |
| M25c F7: the write-failed arm logs a 14-character piece (only the piece scan sees it) | a write refused before the rename |
| M25d F7: the scan looks for the whole value only | the leak scan's own control |
| M26 A-S4: the retired mark cleared before the row lands | a re-key across a Remove and a refused re-save; a refused re-save keeps the retired mark |
| M27 A-S4: `close()` without the last try | a Remove's delete held on a busy coord.db lands at close |
| M28 A-S5: a failed read of the rows still queues their delete | a retire whose read of the lane's rows fails |
| M29 A-S6: no sweep at start | a dismissed item's temp in another programme goes on start |
| M30 A-R5: one line back to CR and LF | a value with a carriage return, a line feed or any other line break |
| M31 A-R4: a new egress method on the masker, unplaced | EGRESS and NOT_EGRESS together are exactly SecretMasker's members |
| M32 F1 r2: the re-key skips a lane holding a current row again | save V1; rotate with the slot unreadable; … V1 is masked |
| M32b F1 r2: the re-key adds beside but keeps the lane's rows of other generations | the same case |
| M33 F2 r2: an unreadable value file folded to null in the item reader | the 0600 programme directory case; ENOENT answers null, an I/O error answers unreadable |
| M33b F2 r2: `privateDir` without the owner's search bit | the 0600 programme directory case |
| M33c F2 r2: the item view offers the field on an unreadable slot (pwa) | a slot the box cannot read says so |
| M33d F2 r2: the item builder folds the unreadable state to null | the 0600 programme directory case |
| M34 A1: `scheduleRekey` ignores `closed` | a closed masker asks for no re-key |
| M34b A1, review O1: `close()` does not set `closed` | the same case |
| M35 A3, review O2: the reload key folds the unrecorded state into none (pwa) | reads the list again when an item's slot moves between nothing stored, stored with no record and unreadable |
| M35b A3, review O4: the start-up sweep without its top-directory check | a dismissed item's temp in another programme goes on start |
| M35c A3: the Stored secrets section loses `pv-secrets` (pwa) | a row's parts are separate, each with its rule |
| M35d A3: the item's Stored block loses `wi-stored` (pwa) | while its slot is stored, the item says Stored |
| M36 A6: `.pv-secrets .wi-status` without `overflow-wrap` (pwa css) | a row's parts are separate, each with its rule |
| M37 F3a: the unrecorded state without its empty tail | the state pl6f-failed-record-removes-old leaves |

M18 and M19 are review 2 F4's survivors: green before this PR, red now that the scan is blind. M25 and M25b are review 1416's O5 and O6, green at `5d1e0e1c` and red now. M5's case filter was re-pointed at the item-8 case's new title; its edit is unchanged. In fix round 2, M8 (now: the current-row branch removed, so the re-key replaces the lane), M12 (now: the retired skip removed) and M23c (now: the view draws any stored state as saved) were re-pointed at the lines F1 and F2 rewrote; each is the same reversal as before.

## Leak-scan coverage

`SECRET-MARK-<24 random characters>` values, looked for whole and (fix round 1, F7) as every 12-character piece of the random part in plain text, base64 and base64url at each byte alignment, and hex in both cases; the scan over: every table of coord.db (seven asserted present, `secret_fingerprints` among them), the database file after a WAL checkpoint, every other file under the fixture HOME, every route response, every `/ws/fleet` frame and every console line, with the server's egress blind to fingerprints. Paths:

- the PUT: refusals before the gate (`step-up-required`), body errors (`bad-request`, `oversize` past the raised cap), the value bound, the three line-break forms (`secret-not-one-line`), the tick route's `use-secret-route`, the save, the second save (`not-open`), the waiting frame after the tick;
- every after-write arm: the record write, the fsync, the fsync with an unreadable read-back, the tick refused between the write and the tick (a long and a short value), the tick throwing, the view throwing (and the frame it emits), and a write refused before the rename (`write-failed`);
- the reads that carry item, mail, feed and ledger text, as the operator and as the coordinator;
- the stored-secrets read, after a save and after a Remove;
- the Remove door: a bad slot (`bad-slot`), the removal, the frame it emits, and a second removal (`secret-not-stored`); `remove-failed` asserted to carry no value;
- the re-key after a rotation;
- fix round 1 (A-R2, F1, VT/FF/NEL/LS/PS): `slot-busy` (the refused value and the stored one), `secrets-unreadable`, `remove-failed`, both re-key race orders (both values), the re-key across a Remove, a `register` that throws carrying the value, the faulted re-save of F1 (three values), and the PUT's five further line breaks; the exact `detail` of every `stored-not-ticked` arm and of `write-failed` is asserted;
- fix round 2: F1's rotation order (both values, through the re-key and a restart), and the 0600 programme directory (the stored value and the refused one, through the reader, `/api/waiting`, the coordinator's list and the PUT).
