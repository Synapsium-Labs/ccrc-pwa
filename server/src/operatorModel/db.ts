// Opens the private store, `operator-model.db` (context C11, L3; Overlord W1 private store plan, Task 2; spec §9.1, C29).
// The shared opener's rules apply as they do to `coord.db`: its own `user_version` migrations, and it refuses to start
// rather than open empty. A file this call creates is created at 0600, and SQLite gives its `-wal` and `-shm` the same
// mode, so the operator's words are never readable by another user of the box. Every session is denied a read of the file,
// its sidecars and its copies (`ACCOUNT_SECRET_PATHS`, `shared/api.ts`); that list is an accident guard on a single box,
// and in a two-box install no fleet session has a path to it at all (§9.4 rule 1).
import type { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import path from 'node:path';
import { openMigratedSqlite, type MigratedSqliteSpec } from '../sqliteFile.js';
import { OPERATOR_MODEL_MIGRATIONS } from './schema.js';

/** The store's basename on the server box, beside `coord.db`. */
export const OPERATOR_MODEL_DB_BASENAME = 'operator-model.db';

/** Thrown when the private store on disk cannot be brought to this build's schema. Uncaught, as `CoordDbUnmigratable`
 *  is: `index.ts` lets it stop the process. */
export class PrivateStoreUnmigratable extends Error {}

export function defaultOperatorModelDbPath(home: string = homedir()): string {
  return path.join(home, '.ccrc', OPERATOR_MODEL_DB_BASENAME);
}

const RESTORE_ADVICE =
  'Check ~/ccrc-backups/<ts>/operator-model.db first: every backup snapshots it there beside coord.db (VACUUM INTO, ' +
  'backup-coord.mjs), and `ccrc coordination-snapshot restore` puts both back as one set. Leave ' +
  '~/.ccrc/privacy-journal.log in place when you restore: no backup holds it, and it keeps a message id from being ' +
  'issued twice. Only if no snapshot exists, move the file aside and accept the loss of the operator\'s recorded ' +
  'messages and read lines — starting empty would erase them silently instead.';

const OPERATOR_MODEL_SPEC: MigratedSqliteSpec = {
  migrations: OPERATOR_MODEL_MIGRATIONS,
  label: OPERATOR_MODEL_DB_BASENAME,
  zeroByte: (dbPath) =>
    `ccrc-server: ${dbPath} exists but is 0 bytes. REFUSING TO START: SQLite would treat this as a brand-new empty ` +
    'database and migrate it clean, silently erasing whatever this file held before it was truncated. ' + RESTORE_ADVICE,
  migrationFailed: (dbPath, v, err, dataStatus) =>
    `ccrc-server: ${dbPath} is at schema ${v} and migration ${v + 1} failed: ` +
    `${err instanceof Error ? err.message : String(err)}. REFUSING TO START. ${dataStatus} ` + RESTORE_ADVICE,
  fail: (message) => new PrivateStoreUnmigratable(message),
  createMode: 0o600,
};

/** Opens the private store, migrating it forward, or throws `PrivateStoreUnmigratable`. */
export function openOperatorModelDb(dbPath: string): DatabaseSync {
  return openMigratedSqlite(dbPath, OPERATOR_MODEL_SPEC);
}
