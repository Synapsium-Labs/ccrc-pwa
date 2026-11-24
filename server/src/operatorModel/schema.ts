// The private store's migrations (context C11; Overlord W1 private store plan, Task 2). L1 data: index `v` is the migration
// from schema `v` to `v + 1`, applied by the shared opener (`../sqliteFile.ts`) in one transaction with its `user_version`.
// No vocabulary sits in a `CHECK` (slug `no-vocabulary-in-check`), so a later word needs no table rebuild, and the store's
// readers revive an unknown word as `unknown`. Message ids are issued above the privacy journal's highest, never by
// SQLite (slug `ids-issued-not-autoincremented`). Migration 1 carries the send key and its partial unique index (open
// question 17), because the dedupe is PR B's but its column ships with the table.
export const OPERATOR_MODEL_MIGRATIONS: readonly string[] = [
  `CREATE TABLE operator_messages (
    id          INTEGER PRIMARY KEY,
    at          INTEGER NOT NULL,
    sessionId   TEXT NOT NULL,
    term        INTEGER NOT NULL,
    actor       TEXT NOT NULL,
    sha256      TEXT NOT NULL,
    sendKey     TEXT,
    text        TEXT NOT NULL,
    cut         INTEGER NOT NULL CHECK (cut IN (0, 1)),
    state       TEXT NOT NULL,
    queuedAt    INTEGER,
    deliveredAt INTEGER,
    pickedUpAt  INTEGER,
    settledAt   INTEGER,
    settledBy   TEXT,
    spentAt     INTEGER,
    CHECK ((settledAt IS NULL) = (settledBy IS NULL))
  );
  CREATE INDEX operator_messages_unsettled ON operator_messages (state, id);
  CREATE INDEX operator_messages_at ON operator_messages (at);
  CREATE UNIQUE INDEX operator_messages_send_key ON operator_messages (sessionId, sendKey) WHERE sendKey IS NOT NULL;
  CREATE TABLE read_ledger (
    id             INTEGER PRIMARY KEY,
    at             INTEGER NOT NULL,
    door           TEXT NOT NULL,
    caller         TEXT NOT NULL,
    scope          TEXT NOT NULL,
    count          INTEGER NOT NULL CHECK (count >= 0),
    outcome        TEXT NOT NULL,
    generation     INTEGER,
    generationRead TEXT NOT NULL,
    turnState      TEXT,
    CHECK ((generationRead = 'measured') = (generation IS NOT NULL)),
    CHECK ((caller = 'operator') = (turnState IS NULL)),
    CHECK ((caller = 'operator') = (generationRead = 'not-a-session'))
  );
  CREATE INDEX read_ledger_door_at ON read_ledger (door, at);`,
  // Migration 2 (Overlord W2, private names B, Task 4): the operator's uploaded private-name list, as keyed hashes only. One
  // list row (`id = 1`): when it was uploaded, how many rows the operator sent, and its generation, which each upload raises
  // (the reader's cache key). The entries are what `entriesOf` made under the server's key, in their order, the canary at
  // `pos` 0. No name is ever stored. One writer, `OperatorModelStore.replacePrivateNames`.
  `CREATE TABLE private_name_list (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    uploadedAt INTEGER NOT NULL,
    rows       INTEGER NOT NULL CHECK (rows >= 0),
    generation INTEGER NOT NULL CHECK (generation >= 1)
  );
  CREATE TABLE private_name_entries (
    pos  INTEGER PRIMARY KEY CHECK (pos >= 0),
    h    TEXT NOT NULL,
    f    TEXT NOT NULL,
    n    INTEGER NOT NULL CHECK (n >= 1),
    mode TEXT NOT NULL
  );`,
];

/** Derived, never hand-edited beside the array. */
export const OPERATOR_MODEL_SCHEMA_VERSION = OPERATOR_MODEL_MIGRATIONS.length;
