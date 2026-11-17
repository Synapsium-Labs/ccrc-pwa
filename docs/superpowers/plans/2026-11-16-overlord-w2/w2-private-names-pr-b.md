# Overlord W2 private names, PR B: build notes

Notes from building PR B (Tasks 4 to 6) of `w2-private-names.md`, for the coordinator to fold into the plan's ledger.
Each departure is named by slug. The coordinator assigns the numbers.

## What shipped

- **Task 4:** the private store's migration 2 adds `private_name_list` (one row, `id = 1`: `uploadedAt`, `rows`,
  `generation`) and `private_name_entries` (`pos`, `h`, `f`, `n`, `mode`). They have one writer,
  `OperatorModelStore.replacePrivateNames`, which replaces both and raises the generation in one transaction. There are two
  reads: `privateNamesRead()` and `privateNamesGeneration()`. The private store's writers census
  (`single-definition/writers-map.test.ts`) names the writer for both tables. The store's version pin moves from 1 to 2.
- **Task 5:**
  - The `.server` slot API of the operator-secrets store, in `server/src/coord/ledgersSecrets.ts`:
    - `writeServerSecret` takes a `{ tail: 'none' }` option.
    - `readServerSecretValue` answers absent, unreadable or the value. None of the three is folded into another.
    - `removeServerSecret`.
    - The masker's re-key (`operatorSecretRows`) and the start-up temp sweep read the `.server` directory too.
  - `shared/privateNames.ts` holds the caps, the wire, the status words, `NAME_LIST_KEY_SLOT` and `NAME_LIST_MODES`.
  - `nameListState` (C11, L1) decides Table P1. Its 12 mutants are all killed, at floor 1.
  - `readPrivateNameList`, `readNameListKey`, `mintNameListKey` and `writeNameListKey` (C11, L3).
  - `single-definition/name-list-key.test.ts` checks that no `removeServerSecret` call names the key slot.
- **Task 6:**
  - `PUT` and `GET /api/overlord/private-names`, in `server/src/operatorModel/nameListRoutes.ts`, registered from
    `server.ts` (+2 lines).
  - The censuses: `auth-gate` (the scan list, the counts, `FLAG_AWARE`), `box-token-census` (`NAME_LIST_DOORS`, the
    CLAUDE.md sentence), `rings/fastify-l4.data.ts`, `secret-mask` (the GET's row), `gate.ts`'s route-count numeral, and
    the architecture spec's C11 paragraph.

## Departures

- **`empty-upload-needs-clear`** (the brief, carrying the Settings plan's ruling): the plan's body is
  `{ rows: [{ text, mode }] }` with no other key, and it accepts zero rows. The door refuses `{ rows: [] }` with
  `bad-request` ("send clear: true to clear it"). It accepts `{ rows: [], clear: true }`, which stores the canary alone.
  `clear` with any rows, or `clear` other than `true`, is `bad-request`. **The W2 Settings piece must send
  `{ rows: [], clear: true }` for its confirmed "Clear the list"** (its SQ6 says `{ rows: [] }`).
- **`slot-serialiser-shared`**: the plan says the door uses "the `underSlot` idiom". `underSlot` was a closure inside
  `registerLedgerOperatorRoutes`. It moved, unchanged, to `slotChains(waitMs)` in `ledgersSecrets.ts`, together with
  `SLOT_WAIT_MS`, which `ledgersRoutes.ts` re-exports. That is a move commit of its own. The item secret doors and the name
  list's door each build their own chain from it, rather than keep a second copy (CLAUDE.md, consolidate). The upload
  answers `slot-busy` past the deadline, as the item doors do.
- **`name-list-key-from-the-entropy-port`**: the plan says the key is minted with `randomBytes` in L3.
  `server/src/operatorModel/` is in the time-ports scope (`single-definition/time-ports.test.ts`, spec §11.5: chance comes
  through the ports), so `mintNameListKey(entropy)` takes `Entropy.hex(32)`. The doors take `TimePorts` (`time`) for the
  clock and the entropy, in place of a bare `now`.
- **`private-names-wire-imports-nothing`** (plan question F17, "a type-only import of `private-names.mjs`"):
  `pwa/` has no `allowJs`, and the matcher has no `.d.mts`, so a type import of it would not resolve once the console
  bundles the file. So `shared/privateNames.ts` imports nothing, not even a type. It restates the modes as
  `NAME_LIST_MODES`, which `private-names-list.test.ts` pins equal to `MODES` in both directions. That also settles the
  Settings plan's SQ6: the console can import `NAME_LIST_MODES` from here. The Task 5 guard is stronger than the plan's: the
  file has no import of any kind, and a planted import is red.
- **`name-list-reads-answer-unmeasured`**: the plan says `privateNamesRead` and `privateNamesGeneration` "throw on a read
  they cannot make". They answer `StoreRead`'s `unmeasured` instead, as every read of the private store does, and the reader
  maps that to `unreadable: store`. A list row with no entries, or an entry of a shape or mode this build cannot read, reads
  `unmeasured`, never a list.
- **`newer-store-opens-with-a-warning`**: the plan's Task 4 test says the migrations "refuse to open a database from a newer
  build (private store A's rule, unchanged)". Private store A's rule is that a newer `user_version` opens with no migration
  and one warning. That rule is pinned unchanged, at schema 2.
- **`no-store-undo-to-move`**: the plan asks to "move its version pins and undo". The private store has a version pin
  (`operator-model-store.test.ts`, now 2) and no undo mechanism, so nothing else moved.
- **`a-stored-key-is-reused`**: an upload whose key write fails only after the value reached its slot
  (`OperatorSecretStoredUnrecorded`: the record or the directory fsync failed) goes on to store the list. The slot holds
  that key, and the reader reads only the value file.
- **`readme-untouched`**: the plan lists `README.md`'s auth paragraph. The README names none of the operator-secret or
  Overlord doors, so it has nothing to update.
- **`path-table-by-glob`**: the plan says the architecture spec's path table gains the three C11 files and K gains
  `shared/privateNames.ts`. The table maps `operatorModel/**` to C11 by glob and lists no `shared/` file, so no row changed.
  The C11 paragraph names the list, its language word, `shared/privateNames.ts` and `private-names.mjs` among its L0, and
  its new dependency, the `.server` slot API.
- **`decision-egress-not-in-b`**: the index's row gives private names B "the `DecisionEgress` adapter … wired in
  `index.ts`". The `DecisionEgress` port is decision model B's (`w2-decision-model.md`, Task 7), and it is not on `main`.
  The brief's scope does not name the adapter either, so this PR does not build it. It belongs to whichever lands second,
  decision model B or a follow-up, over `readPrivateNameList`.
- **`routes-file-not-in-route-registrations`**: `server/test/routeRegistrations.ts` does not exist on `main`, so no row
  was added to it.

## For later pieces

- **The relay** reads the list through `readPrivateNameList(store, ccrcDir)`. It skips the check on `none` only, scans with
  `verdict.list` (`privateNameHits(text, list)`), and refuses `egress-refused` on `unreadable` and on a throw.
- **Decision model B** shares the `.server` API. It widens the "only caller of `readServerSecretValue`" sentence in
  `ledgersSecrets.ts`'s header, and it may call `removeServerSecret` for its own key, never for `NAME_LIST_KEY_SLOT`.
- **W2 Settings** uses `NAME_LIST_MODES` and the status words from `shared/privateNames.ts`, and sends
  `{ rows: [], clear: true }` for Clear.

## Measured

See the wave-done mail for the final list and counts.

- Mutation: `nameListState`, 12 of 12 mutants killed (floor 1). Guards proven by mutation and restored from a saved copy:
  - the key slot's removal guard (a planted `removeServerSecret(…, NAME_LIST_KEY_SLOT)` is red);
  - the reader's generation cache (a disabled cache is red);
  - the reader's failed-read arm (folded to `none`, it is red);
  - the door's eight guards: an empty upload let through, minting over an unreadable slot, no serialiser, no step-up, a
    detail echoing a row's text, tokens unchecked, `clear` with rows, and no `no-store` on the GET. Each is red.
