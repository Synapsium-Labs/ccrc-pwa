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
- **pl6f-meta-needs-value-file**: `readOperatorSecretMeta` answers nothing when the value file is gone, whatever record is left, so the item view's "Stored" follows the value file.
- **pl6f-read-masked**: the stored-secrets read is in `MASKED_GET_ROUTES`: it carries no value, but an asking item's title is text a session wrote. (Raised by the commit's automated security review.)
- **pl6f-read-no-step-up**: the read is session-gated only; it reads no value.
- **pl6f-five-words**: `secret-not-one-line` 400, `secret-not-stored` 404, `slot-busy` 503, `secrets-unreadable` 503, `remove-failed` 503, each with its status and a console sentence.
- **pl6f-remove-word**: the store's remove answers `removed` or `none`, and the read's states are `ok`, `unreadable` and `invalid`: `absent` beside `removed` is another context's vocabulary pair (`late-census.test.ts`), and a quoted kebab word in `server/src/coord` must be a declared code (`mail-routes.test.ts`).
- **pl6f-slot-deadline**: `SLOT_WAIT_MS` is 30 s, a constant with a test override (`slotWaitMs`); the map entry stays until the running act finishes, so the deadline never lets two acts of one slot run together.
- **pl6f-temps-on-write**: leftover temps are cleaned on the next write or Remove of their slot, not at server start.
- **pl6f-unknown-readback-counts-stored**, **pl6f-register-throw-unregistered**, **pl6f-failed-record-removes-old**: A-4 as above.
- **pl6f-roster-drops-operator-lanes**: A-1 in both entries (`offer`, `withOperatorSecretRows`), through one L0 predicate.
- **pl6f-scan-blind-egress**: F4 as above.
- **pl6f-doctor-server-stores**: A7 adds the Linear slot store as well as the operator's (review 1 named both); the three SKIP lines name the four directories once (`SECRET_DIRS_NAMED`).
- **pl6f-hook-unchanged**: no hook or installer edit: the account arm's existing pattern refuses every delete form under the store; the test pins twelve Bash forms and the edit tools for a top-level session and a child.
- **pl6f-stored-ui-shared**: `StoredSecretRemove` lives in `ItemView.tsx` and the programme screen imports it; the section sits inside the Waiting card, so no new card and no shell change.
- **pl6f-dark-sentences**, **pl6f-armedmode-different**: A-7 and A-8 as above. Restating `pl6-sign-in-read-up-front`: its fallback is per mount, so on a plain-HTTP origin with sign-in armed one value is sent per visit before the server refuses it `insecure-origin`; nothing is stored.
- **pl6f-rekey-unreadable-warn**: `index.ts`'s `console.warn` for a store that could not be read whole is fixed text naming no slot and no value (review 2 A-12).
- **pl6f-view-throws-word**: the view-throws arm still answers `stored-not-ticked` though the item is ticked (declared in `pl6-stored-not-ticked`); its test now pins the state.

## Claims and leave

- Claims: 3387 (the main list) and 3389 (`server/test/ccrc-doctor-codex.test.ts`, the posture checks' tests). `ccd/session-hook.sh` and `ccd/install-session-hooks.sh` were claimed and left untouched.
- Leave 14570, from run 1312's coordinator, holder of claim 3358 on `server/src/auth/gate.ts`: line 8's route count, 167 to 169, the one edit (`auth-gate.test.ts` derives it; my step 0 said no edit was needed, which was wrong, and mail 14581 said so). Nothing else in `gate.ts`. `shared/api.ts` is untouched.
- Leave 14577, from the same coordinator, holder of claims 3361 and 3362: in `server/test/box-token-census.test.ts`, the two paths after `'/api/items/:id/secret'` in `LEDGER_OPERATOR_DOORS`; in `server/test/auth-gate.test.ts`, the `coord/ledgersRoutes.ts` count (14 to 16), the Remove door's `FLAG_AWARE` row and its list (now nineteen), `ROUTES.length` 170 to 172 with its comment, the "172 scanned" comment, and the two "all 169 HTTP routes" sentences. Run 1312 changes some of the same lines; whichever lands second recounts on its merge of main.
- `server/test/secret-mask.test.ts` (run 1312's claim 3363) is untouched; the masker's new cases are in `ledgers-secrets.test.ts`.
- `CLAUDE.md`: the ledgers operator-doors sentence only, naming the two new doors.

## Mutants

Each is one exact edit of a saved copy, run on its named case, then restored from the copy with its sha256 checked; `git status --short` was empty after the round. All twenty went red.

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
| M16 a re-save keeps the retired mark | a re-save that writes no row still clears the retired mark |
| M17 the read not masked by the answer hook | the stored-secrets read goes through the answer masker |
| M18 the record-write arm echoes the value | the metadata write fails; the directory fsync fails |
| M19 the view-throws arm echoes the value | the answer's item view throws after the tick |

M18 and M19 are review 2 F4's survivors: green before this PR, red now that the scan is blind.

## Leak-scan coverage

`SECRET-MARK-<24 random characters>` values, the scan over: every table of coord.db (seven asserted present, `secret_fingerprints` among them), the database file after a WAL checkpoint, every other file under the fixture HOME, every route response, every `/ws/fleet` frame and every console line, with the server's egress blind to fingerprints. Paths:

- the PUT: refusals before the gate (`step-up-required`), body errors (`bad-request`, `oversize` past the raised cap), the value bound, the three line-break forms (`secret-not-one-line`), the tick route's `use-secret-route`, the save, the second save (`not-open`), the waiting frame after the tick;
- every after-write arm: the record write, the fsync, the fsync with an unreadable read-back, the tick refused between the write and the tick (a long and a short value), the tick throwing, the view throwing (and the frame it emits), and a write refused before the rename (`write-failed`);
- the reads that carry item, mail, feed and ledger text, as the operator and as the coordinator;
- the stored-secrets read, after a save and after a Remove;
- the Remove door: a bad slot (`bad-slot`), the removal, the frame it emits, and a second removal (`secret-not-stored`); `remove-failed` asserted to carry no value;
- the re-key after a rotation.
