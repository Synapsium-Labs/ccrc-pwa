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
- **`operator-model-path-has-no-env-override`** (reworded in fix round 1, review 2251 F6). `CcrcConfig.operatorModelDbPath`
  has no override of its own beside `CCRC_COORD_DB`'s, but it is built from the configured home (`CCRC_HOME`, else the
  process home), so `CCRC_HOME` still moves the store and its journal, and the sessions' deny rules name `~/.ccrc` in the
  process home. Nothing in `deploy/` or `ccd/ccrc` sets `CCRC_HOME`, and it is the server's own environment, not a
  session's. The boot warns when the two homes differ (`operatorModelBootLines`).
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

## Fix round 1 (review 2251, the coordinator's rulings)

- **`issuer-heals-a-torn-tail-in-process`** (F1). The issuer heals a torn tail that a failed append left while the server
  runs, as the open heals one at boot. It cuts the tail aside through `cutAside` (its bytes kept under
  `privacy-journal.torn/`) and retries the append once, as the authority journal's `healTornTail` does. The tail's record
  failed, so its insert rolled back and no row holds its id. A tail that cannot be cut is answered as a torn tail, never as
  `malformed`.
- **`unmeasured-journal-is-fixed-in-place`** (F2). `operatorModelBootLines` gives an `unmeasured` read its own sentence:
  fix the journal's access and restart the server, and do not move the journal aside, since it may hold a lead the store
  needs. A failed cut at the open carries its error into the refusal's detail. The boot lines left `index.ts` for one
  tested function, so the composition root only prints them.
- **`store-deny-has-cd-and-glob-arms`** (F4, ruled: more than parity with the account guard). The session hook's account
  arm (`apmatch`) refuses three further shapes:
  - a `cd` into `~/.ccrc` followed by the store's or the journal's name;
  - a glob under `~/.ccrc/` that can match the store, its sidecars or the journal (a bare `ls` excepted);
  - a copier, archiver or recursive reader (`cp`, `rsync`, `tar`, `zip`, `scp`, `grep`, `rg`) given `~/.ccrc` itself.

  The account prefilter now admits any Bash payload naming `.ccrc`. `must-allow.json` is unchanged, and none of its
  entries matches. These are accident guards, like the rest of the arm: `bash -c` with an assembled string, a script file,
  another interpreter, a glob outside `~/.ccrc/`, a copy of the whole home and a `cd` followed by a glob all run past them
  (CLAUDE.md's residuals).
- **`store-created-under-a-temporary-name`** (F5). With `createMode`, the shared opener creates and migrates a new file as
  `<file>.creating` and links it into place only once every migration has committed, so a crash before then leaves no
  0-byte file at the real name for the next boot to refuse. A leftover of a crashed create is removed: it never held a row.
  The temporary name is covered by the store's deny entry, `~/.ccrc/operator-model.db*`.
- **`coord-db-keeps-its-create-window`** (F5). `coord.db` passes no `createMode`, so it keeps today's create at its real
  name, and with it the 0-byte window after a crash. That is out of scope here and left as it is.
- **`backup-gate-is-lstat`** (F7). `_upd_backup` snapshots the store when anything stands at its path (`-e || -L`), as
  `capture` measures it with `lstat`. A dangling link then refuses at the snapshot instead of being skipped, which would
  have refused later as `store-snapshot-missing`.
- **`deploy-sh-store-gate-left-as-f`** (F7). `deploy.sh`'s server lane, the fallback path, keeps its `-f` test. A dangling
  link there is skipped and then refused by the lane's own `capture`, so the lane fails closed. No test drives that lane.
- **`account-secret-paths-is-three-lines`** (F8). The plan says to edit `ACCOUNT_SECRET_PATHS` "on its one line". The six
  store paths sit on two lines of their own under a comment, so the list now spans three lines. The JSDoc's count is
  corrected.
- **`capture-reads-no-store-user-version`** (F8). Task 4 says capture checks the store's `user_version`. `inspectDb`
  reads none, for the store as for `coord.db`: capture checks that the snapshot is a whole SQLite file it can read, and
  the server's opener decides the schema on the next boot.
- **`move-message-validates-at`** (F9). `moveMessage` refuses an `at` that is not a non-negative safe integer, as
  `recordMessage` does.
- **`tx-ring-left-for-a-tidy-up`** (F10). `sqliteFile.ts` (K) imports `coord/tx.ts` (C5), as the old `openCoordDb` did.
  The ring tests check direction, not context. Moving `tx.ts` to K is a later tidy-up.

## Measured

- Growth, net code lines against the merge base (`growthCheck.ts#codeLines`): `deploy/coordination-snapshot.mjs` +25 (cap
  headroom 40, so the absent-member and marker rules did not move out first); `ccd/ccrc` +6; `shared/api.ts` +2;
  `ccd/session-hook.sh` +1; `ccd/install-session-hooks.sh` +2; `deploy/backup-coord.mjs` +1; `server/src/index.ts` +13;
  `server/src/config.ts` +3; `server/src/deps.ts` +2.
- Mutations by hand (each reverted from a saved copy) are listed in the pull request body with the case each one reddened.
