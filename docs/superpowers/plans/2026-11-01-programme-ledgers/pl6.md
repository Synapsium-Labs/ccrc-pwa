# Task PL6: secrets pasted into the console

A task note for the programme ledger (Task PL6, D-7714). The coordinator folds what it needs into the ledger; this file is
not the ledger. Times are UTC, 2026-11-03.

## What shipped

- **The slot store** (`server/src/coord/ledgersSecrets.ts`): `<ccrcDir>/operator-secrets/<programme>/<slot>.secret` holds the
  value verbatim, written by `writeValueFileAtomic` (0600 from birth) in 0700 directories, beside `<slot>.json`
  (`{v:1, setAt, tail, masked, why?}`, never the value nor a digest of it). Both names are re-checked (`shapeProgramSlug`, untrimmed, and
  `isSlotSlug`) before any path is built. A store directory that is a symlink, not owned by the server's user, or open to group
  or others refuses the write. `readOperatorSecretMeta` is synchronous, so the one item builder can carry the slot's state;
  the masker lanes are `operator-secret:<programme>:<slot>`. A failure after the value is renamed into place (the directory
  fsync, the metadata write) rejects with `OperatorSecretStoredUnrecorded`, after the masker has been asked; which kind a
  failed atomic write was is measured by reading the slot back. The store's listing reports an unreadable directory apart
  from an empty one.
- **The route** (`PUT /api/items/:id/secret`, in `ledgersRoutes.ts`, registered by `registerLedgerOperatorRoutes`): the account
  gate with a step-up first (`auth-off`, `insecure-origin`, `step-up-required`); then the item (a secret item, open, names that
  pass their shapes); the value (1 to 8192 characters and UTF-8 bytes); the tick's preconditions; the write and the masker's
  registration; then the tick with the answer `set <ISO time> ending <tail>`. Body cap 16384, `Cache-Control: no-store` on every
  answer, body errors as fixed words. The tick route and this one share the tick's preconditions and the tick itself. One
  save of a slot runs at a time, and every failure after the rename answers `stored-not-ticked` (fix round 1).
- **The masker** (`server/src/accounts/mask.ts`): `ingestSecret(laneId, value)` fingerprints one server-held secret under the
  current box token through `ingest`, the table's one writer, and answers `masked`, `too-short`, `too-long` or `unregistered`.
  `retain`, the roster's prune, never deletes an operator-secret lane, and the re-key after a rotation carries their rows
  (`index.ts`).
- **The deny rules**: `~/.ccrc/operator-secrets/**` joins `ACCOUNT_SECRET_PATHS` (one line, `shared/api.ts`, edited under
  leave), the installer's copy, and the hook's `ASEC`, `APSEC` and account-arm prefilter. CLAUDE.md's SAFETY account bullet names the slots among
  the paths a session never reads (edited under leave, mail 14334).
- **The panel** (`pwa/src/ledgers/ItemView.tsx`): a password field in the panel's own state, one line, trimmed at both ends
  (the bound counts the trimmed value) and sent once through `useStepUp`'s `runAct`, cleared after saving and on page hide. It
  reads the box's sign-in (`readAuthStatus`) on mount and starts disabled with "Saving a secret needs sign-in turned on for
  this console." when sign-in is off; a save refused `auth-off` or `insecure-origin` disables it the same way. "Confirm it's you" sits outside the save form, so the step's own
  passphrase form never re-sends the save. After saving: "Saved. Ends in ….", and the masking line when it is not masked. A
  checking secret item shows the slot's state from the server; its answer is never rendered. The client call is
  `api.saveItemSecret` (`pwa/src/lib/api.ts`, edited under leave, mail 14334), answering `SecretSaveAnswer`
  (`shared/ledgers.ts`).

## Departures from the plan, for the ledger to number

- `pl6-secrets-module-in-coord`: the store is `server/src/coord/ledgersSecrets.ts`, not `server/src/ledgers/secrets.ts`. A new
  `server/src/ledgers/` directory needs a row in the 08-10 spec's context table, which another programme holds; `coord/**`
  covers this file, beside `ledgersStore.ts` and `ledgersMail.ts`.
- `pl6-write-takes-the-register`: `writeOperatorSecret` takes a sixth argument, the masker's registration, so the metadata it
  writes records whether the value is masked. The masker computes the fingerprint row itself (`ingestSecret`), under its own
  current token, so the route never handles the box token.
- `pl6-tail-at-masker-floor` (was `pl6-no-tail-below-16`; review 1389 A1, ruled): the tail is shown only for a value of at
  least the masker's floor, 20 bytes after any trailing `=` (`SECRET_TAIL_MIN`, held equal to `RUN_MIN_BYTES` by a test). For
  a shorter value the tail is empty and the coordinator's answer is `set <ISO time>`: the plan's `ending <tail>` would send a
  fifth or more of a value the masker cannot catch. The time is ISO 8601, not epoch milliseconds.
- `pl6-unmasked-why`: the answer and `ItemView.secretSet` carry `why` (`too-short`, `too-long`, `unregistered`) when the value is
  not masked, an additive optional field, so the panel names the reason. The plan names only "too short".
- `pl6-rekey-carries-operator-secrets`: the masker's re-key (`requestRekey`, `index.ts`) adds the operator-secret rows under the
  current token beside the box's answer. Without it a box-token rotation would leave those rows keyed with the old token: they
  stop matching after a restart, and the re-key keeps retrying because rows of an old generation remain. Not in the plan.
- `pl6-retain-exempts-operator-lanes` (was `pl6-roster-keep-at-config`; review 1389 F1, ruled): `SecretMasker.retain` never
  deletes a lane under `OPERATOR_SECRET_LANE_PREFIX`, since nothing removes a slot. With it the union this branch first added
  at `reloadRoster`'s call is gone (`config.ts` is as on `main`): a keep set computed while the store was unreadable, or held
  across a save, can no longer unmask a slot, and there is one mechanism, not two. A slot removed by hand keeps its row and
  its stale generation, so the re-key retries it (carried with A3).
- `pl6-tick-preconditions-before-write`: the route checks the tick's preconditions (a coordinator, the mail's size, no
  outstanding earlier tick) before it writes, so a tick that would be refused stores nothing, and re-checks them after the
  write. The two routes share `tickPlan` and `tickNow`.
- `pl6-store-dir-private`: the write refuses a store directory that is a symlink, not the server user's, or open to group or
  others.
- `pl6-store-dir-name-in-shared`: the directory name is `OPERATOR_SECRETS_DIR` in `shared/ledgers.ts`, because the code-word
  census in `mail-routes.test.ts` reads every kebab literal under `server/src/coord`; `account-deny.test.ts` holds the deny path
  equal to it.
- `pl6-credential-body-route`: `credentialBodyRoute` in `accounts/gate.ts` gives the route its body cap, `no-store` from
  `onRequest`, and fixed-word body errors (the same census); the Linear routes keep their own copy.
- `pl6-two-refusal-words`: `not-a-secret-item` and `bad-slot` (409) join `LEDGER_ROUTE_REFUSALS`, with sentences in
  `LEDGER_REFUSAL_TEXT`.
- `pl6-stored-not-ticked` (review 1389 F3, ruled): a third word, `stored-not-ticked` (503, as `write-failed`), for every
  failure after the value is renamed into place: the fsync or the metadata after the rename, a tick refused after the write,
  and a throw from the tick or from the answer's item view (the item is then ticked; the word still says save again, which a
  refresh shows is not needed). Its sentence: "The secret is stored, but the item was not marked done. Refresh and try again."
- `pl6-one-save-per-slot` (review 1389 F2, ruled): a promise chain keyed by `programme:slot`, in the route (`underSlot`), the
  one owner; everything after the gate runs on it, so a second save meets `not-open` before it writes.
- `pl6-no-digest` (review 1389 A2, ruled): the metadata carries no digest of the value, though the plan lists one: nothing reads
  it, and an unsalted digest of a low-entropy value helps an offline guess.
- `pl6-one-line-secret` (review 1389 F4, ruled): a secret is one line; the hint says so. Multi-line secrets are out of scope.
- `pl6-sign-in-read-up-front` (review 1389 A9, ruled): the panel reads `GET /api/auth/status` through `readAuthStatus` (no store
  holds it) and starts disabled while it asks and when sign-in is off. The status says nothing of a plain-HTTP origin, so
  `insecure-origin` stays refusal-driven, the fallback; a box that cannot answer opens the field and its refusal decides.
- `pl6-trim-before-bound` (review 1389 A8): the field has no `maxLength`; the panel bounds the trimmed value (`isSecretValue`)
  and says when it is too long.
- `pl6-gate-sweep-counts`: `auth-gate.test.ts`'s counts move for the new route (ledgers file 13 to 14, HTTP 166 to 167, scanned
  169 to 170), the route joins `FLAG_AWARE` (seventeen to eighteen, the Linear credential writes' reason), and `auth/gate.ts`'s
  docstring count follows.
- `pl6-census-door`: `/api/items/:id/secret` joins `box-token-census.test.ts`'s `LEDGER_OPERATOR_DOORS`.
- `pl6-no-value-reader`: `readValueFile` is not used. It takes the first non-comment line and strips whitespace, so it would not
  read a pasted value back as written; nothing reads a value yet (spec §5) except the re-key, which reads the file whole.
- Fix round 1 carries A3 (no path removes a stored slot), A4 (a temp file left by a crash), A5 (the hook's residual forms),
  A6 (`credentialBodyRoute` beside Linear's copy) and A7 (doctor's secrets posture on a server box), untouched here.
- Files beyond the plan's list: `shared/ledgers.ts`, `shared/refusal.ts`, `server/src/index.ts`, `server/src/server.ts`,
  `server/src/coord/routes.ts`, `server/src/accounts/gate.ts`, `server/src/auth/gate.ts`, `pwa/src/lib/refusalWords.ts`, and the
  tests `box-token-census.test.ts`, `auth-gate.test.ts` and `item-view.test.tsx`.

## Edited under leave

- `shared/api.ts` (claim 3297, leave 14319): one `ACCOUNT_SECRET_PATHS` entry and its doc comment's count.
- `CLAUDE.md` (claim 3306, leave 14334): the SAFETY account bullet names `~/.ccrc/operator-secrets/`, and the box-token
  bullet names `PUT /api/items/:id/secret` among the ledgers' operator doors. Fix round 1 (leave 14360): that one sentence
  says the tail is sent only at the masker's floor. Nothing else in the file.
- `pwa/src/lib/api.ts` (claim 3315, leave 14334): `saveItemSecret` and its doc comment, before the `waiting` entry, with its
  own `import type` line; the shared ledgers import is untouched.

## A load flake measured, not fixed here

`secret-mask.test.ts`'s 25 ms frame bound failed once, in one batch run of about 30 server suites at `--maxWorkers=2` while
the box ran other sessions' suites, and passed on its re-run alone (1 red in 2 runs). The suite's code is not changed by
this task.

## The leak scan covers

Every table of coord.db (seven named and asserted present: `mail`, `mail_deliveries`, `feed_events`, `operator_items`,
`operator_item_events`, `programme_modifications`, `secret_fingerprints`), the coord.db file's bytes after a WAL checkpoint,
every other file under the fixture HOME (the slot's metadata included), every response the flow made (the refusals that carry
the value, the save, the second save, the refused tick, the mail list and each mail, the waiting list, goals, feed, runs, one
run, fleet, digest, asks, ledger, claims, lifecycle and the coordinator's item list), every frame on `/ws/fleet` (the `waiting`
frame among them), and every console line at every level, after a token rotation's re-key has written the slot's row under
the new token. The one place the value is found is the slot's value file.

Fix round 1 runs the same scan over seven failure arms, each its own save: the metadata write failing after the rename, the
directory fsync failing after the rename, a tick refused between the write and the tick (the run closed from inside the
masker's registration), the same with a value under the masker's floor (so the egress mask cannot hide an echo of it), the
tick throwing, the answer's item view throwing (each `stored-not-ticked`), and a write refused before the rename
(`write-failed`). Each scan adds the waiting list and the mail list after the save.
