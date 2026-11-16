# Private store A: the builder's departures

The builder's notes for PR A (Tasks 1 to 4) of `docs/superpowers/plans/2026-11-14-overlord-w1/w1-private-store.md`: the shared
SQLite opener, context C11 with `operator-model.db` and its one writer, the privacy journal on authority journal A0's adapters,
and the store's snapshot, restore set and deny path. Each departure from the plan's text is a plain-words slug, never a D-number
(cross-plan ruling X9). The coordinator folds what the ledger should learn into it.

## Departures

- **`notes-file-path`.** The brief names `w1-private-store/notes-a.md` for these notes; the plan's Global Constraints name
  `w1-private-store/departures.md`. The plan governs (worker clause 6), as A0's builder ruled the same question, so this file is
  the plan's.
- **`privacy-torn-dir-is-a-child-name`** (the coordinator's ruling in the brief). The plan reads `~/.ccrc/privacy-journal.torn/`
  as a path; `PRIVACY_JOURNAL_TORN_DIR` is the one path component `privacy-journal.torn`, as A0's port requires
  (`aside-dir-is-a-child-name`), inside the journal's own directory.
- **`send-key-field-is-composed-key`.** The column is `sendKey`, as the plan names it, but the store's input field is
  `composedKey`: `sendKey` is one of the pane typers' names, which `single-definition/injected-prompts.test.ts` reserves in
  `server/src` (a reference other than a call, an import or its definition is red). PR B's route reads the body's `sendKey`
  and hands it to the store as `composedKey`, or the census gains a recorded exception there.
- **`message-stamps-have-a-map`.** `MessageStamp`, the five stamp columns, is a derived list with its map
  (`MESSAGE_STAMP_MAP`, `MESSAGE_STAMPS`), because `rings/wire-totality.test.ts` reds an exported literal union without one.
  The plan did not name the type.
- **`unsettle-target-is-a-word`.** `MESSAGE_MOVES`' `settled × unsettle` cell is the word `delivery-stage` (type
  `MessageMoveTarget`), which `messageMove` resolves through `deliveryStageOf`; the plan typed the table's cells as
  `MessageState`, which cannot say "the stage the stamps prove".
- **`row-revives-unknown-settled-by`.** `OperatorMessageRow.settledBy` is `SettledBy | 'unknown' | null`: a reader revives a
  settlement word this build does not know as `unknown`, as it revives a state (`no-vocabulary-in-check`).
- **`store-carries-an-issuer-port`.** `OperatorModelStore` takes a `PrivacyIssuer` (an issuer of ids over the bound journal, or
  the refusal its open read) rather than the adapter itself; `openOperatorModelStore` binds the real journal, heals, asks
  `privacyCoherence` and re-anchors, and a test hands a double. The id and the append still come from one verified read
  (`appendNext`'s `check`). `privacyJournalHead()` is a store method over the issuer.
- **`all-readers-ship-in-a`.** The store's readers (`messagesSince`, `lastOperatorMessage`, `unsettledMessages`,
  `messageSessionOf` and the rest) ship and are tested in PR A with the store; Task 7 (PR B) wires them and adds `message` as a
  note key.
- **`index-wiring-rides-task-3`.** `index.ts` opens the store in Task 3's work (with the journal), not Task 2's: the open is one
  call, `openOperatorModelStore(path, ccrcDir, now)`, and its boot lines are the journal's verdicts.
- **`operator-model-path-has-no-env-override`.** `CcrcConfig.operatorModelDbPath` is built once from the home, with no
  environment override beside `CCRC_COORD_DB`'s; nothing needs one yet.
- **`tasks-2-3-one-commit`.** Tasks 2 and 3 are one commit: `store.ts` carries both (the one writer, and the journal's open),
  and the session cannot split a file's hunks interactively.
- **`journal-census-cut-call`.** `journal-file-callers.test.ts`'s `CUT_CALLS` names the store's open
  (`server/src/operatorModel/store.ts: file.cutAside`, the torn-tail heal) beside the adapter's own call, and `CHAINED_BINDERS`
  names `store.ts`.
- **`backup-coord-repinned`.** `coordination-snapshot.test.ts` (W3-M40) pins `deploy/backup-coord.mjs`'s bytes; the pin is moved to
  the new hash, because the umask line is this task's intended change.
- **`snapshot-store-without-manifest-is-invalid`.** A backup directory holding `operator-model.db` with no manifest classifies
  `invalid` (`classify`) and `damaged` (`quickState`), as a sidecar without a manifest does, so a failed capture's leftover copy
  is never read as a legacy data set or thinned as one.
- **`deploy-sh-chmod-not-mkdir-mode`.** `deploy.sh`'s server lane makes the backup directory 0700 with a `chmod` after its
  `mkdir -p`, not `mkdir -m`, because `agent/test/deploy-verify.test.ts` anchors on the literal `mkdir -p ~/ccrc-backups/$TS`.
- **`backup-result-line-names-the-store`.** `_upd_backup`'s result line reads "coord.db snapshot, the private store's snapshot
  when it exists, coordination sidecars and manifest, …"; `ccrc-update-flip-backups.test.ts`'s pin of the line moves with it.

## Measured

- Growth, net code lines against the merge base (`growthCheck.ts#codeLines`): `deploy/coordination-snapshot.mjs` +25 (cap
  headroom 40, so the absent-member and marker rules did not move out first); `ccd/ccrc` +6; `shared/api.ts` +2;
  `ccd/session-hook.sh` +1; `ccd/install-session-hooks.sh` +2; `deploy/backup-coord.mjs` +1; `server/src/index.ts` +13;
  `server/src/config.ts` +3; `server/src/deps.ts` +2.
- Mutations by hand (each reverted from a saved copy) are listed in the pull request body with the case each one reddened.
