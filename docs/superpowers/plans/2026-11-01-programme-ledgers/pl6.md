# Task PL6: secrets pasted into the console

A task note for the programme ledger (Task PL6, D-7714). The coordinator folds what it needs into the ledger; this file is
not the ledger. Times are UTC, 2026-11-03.

## What shipped

- **The slot store** (`server/src/coord/ledgersSecrets.ts`): `<ccrcDir>/operator-secrets/<programme>/<slot>.secret` holds the
  value verbatim, written by `writeValueFileAtomic` (0600 from birth) in 0700 directories, beside `<slot>.json`
  (`{v:1, setAt, tail, masked, why?, digest}`, never the value). Both names are re-checked (`shapeProgramSlug`, untrimmed, and
  `isSlotSlug`) before any path is built. A store directory that is a symlink, not owned by the server's user, or open to group
  or others refuses the write. `readOperatorSecretMeta` is synchronous, so the one item builder can carry the slot's state;
  `operatorSecretLanes` lists the masker lanes (`operator-secret:<programme>:<slot>`).
- **The route** (`PUT /api/items/:id/secret`, in `ledgersRoutes.ts`, registered by `registerLedgerOperatorRoutes`): the account
  gate with a step-up first (`auth-off`, `insecure-origin`, `step-up-required`); then the item (a secret item, open, names that
  pass their shapes); the value (1 to 8192 characters and UTF-8 bytes); the tick's preconditions; the write and the masker's
  registration; then the tick with the answer `set <ISO time> ending <tail>`. Body cap 16384, `Cache-Control: no-store` on every
  answer, body errors as fixed words. The tick route and this one share the tick's preconditions and the tick itself.
- **The masker** (`server/src/accounts/mask.ts`): `ingestSecret(laneId, value)` fingerprints one server-held secret under the
  current box token through `ingest`, the table's one writer, and answers `masked`, `too-short`, `too-long` or `unregistered`.
  A roster reload keeps the operator-secret lanes (`reloadRoster`'s `keep`, `config.ts`), and the re-key after a rotation
  carries their rows (`index.ts`).
- **The deny rules**: `~/.ccrc/operator-secrets/**` joins `ACCOUNT_SECRET_PATHS` (one line, `shared/api.ts`, edited under
  leave), the installer's copy, and the hook's `ASEC`, `APSEC` and account-arm prefilter. The CLAUDE.md SAFETY bullet is the
  remaining edit (see "Not done yet").
- **The panel** (`pwa/src/ledgers/ItemView.tsx`): a password field in the panel's own state, trimmed at both ends and sent once
  through `useStepUp`'s `runAct`, cleared after saving and on page hide, disabled with "Saving a secret needs sign-in turned
  on for this console." on `auth-off` or `insecure-origin`. "Confirm it's you" sits outside the save form, so the step's own
  passphrase form never re-sends the save. After saving: "Saved. Ends in ….", and the masking line when it is not masked. A
  checking secret item shows the slot's state from the server; its answer is never rendered.

## Departures from the plan, for the ledger to number

- `pl6-secrets-module-in-coord`: the store is `server/src/coord/ledgersSecrets.ts`, not `server/src/ledgers/secrets.ts`. A new
  `server/src/ledgers/` directory needs a row in the 08-10 spec's context table, which another programme holds; `coord/**`
  covers this file, beside `ledgersStore.ts` and `ledgersMail.ts`.
- `pl6-write-takes-the-register`: `writeOperatorSecret` takes a sixth argument, the masker's registration, so the metadata it
  writes records whether the value is masked. The masker computes the fingerprint row itself (`ingestSecret`), under its own
  current token, so the route never handles the box token.
- `pl6-no-tail-below-16`: the tail is shown only for a value of at least 16 characters (`SECRET_TAIL_MIN`, the Linear key's
  floor and reason). For a shorter value the tail is empty and the coordinator's answer is `set <ISO time>`: the plan's
  `ending <tail>` would send the whole of a four-character secret. The time is ISO 8601, not epoch milliseconds.
- `pl6-unmasked-why`: the answer and `ItemView.secretSet` carry `why` (`too-short`, `too-long`, `unregistered`) when the value is
  not masked, an additive optional field, so the panel names the reason. The plan names only "too short".
- `pl6-rekey-carries-operator-secrets`: the masker's re-key (`requestRekey`, `index.ts`) adds the operator-secret rows under the
  current token beside the box's answer. Without it a box-token rotation would leave those rows keyed with the old token: they
  stop matching after a restart, and the re-key keeps retrying because rows of an old generation remain. Not in the plan.
- `pl6-roster-keep-at-config`: the keep is the union at `reloadRoster`'s call of `offer` (`config.ts`); `retain` itself is
  unchanged, so there is one mechanism.
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
- `pl6-gate-sweep-counts`: `auth-gate.test.ts`'s counts move for the new route (ledgers file 13 to 14, HTTP 166 to 167, scanned
  169 to 170), the route joins `FLAG_AWARE` (seventeen to eighteen, the Linear credential writes' reason), and `auth/gate.ts`'s
  docstring count follows.
- `pl6-census-door`: `/api/items/:id/secret` joins `box-token-census.test.ts`'s `LEDGER_OPERATOR_DOORS`.
- `pl6-local-save-stub`: the panel's client call is `saveItemSecret` in `ItemView.tsx` while `pwa/src/lib/api.ts` is held; it
  moves to `api.ts` when that file frees.
- `pl6-no-value-reader`: `readValueFile` is not used. It takes the first non-comment line and strips whitespace, so it would not
  read a pasted value back as written; nothing reads a value yet (spec §5) except the re-key, which reads the file whole.
- Files beyond the plan's list: `shared/ledgers.ts`, `shared/refusal.ts`, `server/src/index.ts`, `server/src/server.ts`,
  `server/src/coord/routes.ts`, `server/src/accounts/gate.ts`, `server/src/auth/gate.ts`, `pwa/src/lib/refusalWords.ts`, and the
  tests `box-token-census.test.ts`, `auth-gate.test.ts` and `item-view.test.tsx`.

## Not done yet (held files)

- `CLAUDE.md` (claim 3306): the SAFETY account bullet names `~/.ccrc/operator-secrets/`, and the coordination bullet names
  `PUT /api/items/:id/secret` among the operator's doors. Until then two pins are red: `account-deny.test.ts`'s "names each
  command and path" and `box-token-census.test.ts`'s "box-token bullet is TRUE".
- `pwa/src/lib/api.ts` (claim 3315): `saveItemSecret(id, value)` moves there from `ItemView.tsx`.

## The leak scan covers

Every table of coord.db (seven named and asserted present: `mail`, `mail_deliveries`, `feed_events`, `operator_items`,
`operator_item_events`, `programme_modifications`, `secret_fingerprints`), the coord.db file's bytes after a WAL checkpoint,
every other file under the fixture HOME (the slot's metadata included), every response the flow made (the refusals that carry
the value, the save, the second save, the refused tick, the mail list and each mail, the waiting list, goals, feed, runs, one
run, fleet, digest, asks, ledger, claims, lifecycle and the coordinator's item list), every frame on `/ws/fleet` (the `waiting`
frame among them), and every console line at every level. The one place the value is found is the slot's value file.
