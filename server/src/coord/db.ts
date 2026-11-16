import { DatabaseSync } from 'node:sqlite';
import { lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { MIGRATIONS } from './schema.js';
import { COLLECT_LANE_JOURNAL_BASENAME } from './collectLaneJournal.js';
import { tx } from './tx.js';
import { openMigratedSqlite, type MigratedSqliteSpec } from '../sqliteFile.js';

export { COORD_SCHEMA_VERSION } from './schema.js';

/** Thrown when the database on disk cannot be brought to this build's schema.
 *  Deliberately NOT caught anywhere: `index.ts` lets it kill the process, and
 *  `deploy.sh`'s `verify-service.sh ccrc.service` turns that into a failed
 *  deploy with the journal tail attached. */
export class CoordDbUnmigratable extends Error {}

/** The collector's generation journal, in both restore sentences below (path-identity spec 2026-10-12 §5.3). A
 *  coord.db snapshot is restored WITHOUT it: that file only moves forward, so a restored database that disagrees with
 *  it leaves the temp-root collector `safety-stopped` until a fresh Settings choice repairs it. A restore that moves
 *  BOTH back to one older point is coherent, and nothing on the same filesystem can tell; the sentence says so rather
 *  than promise a check that does not exist. The basename is the adapter's one constant, interpolated, never re-spelled
 *  here. */
const JOURNAL_RESTORE_CLAUSE =
  ` Restore a snapshot only with ccrc.service stopped, and leave ~/.ccrc/${COLLECT_LANE_JOURNAL_BASENAME} in place: ` +
  'no backup holds it, and if the collector switch changed after that snapshot the temp-root collector stays ' +
  'stopped until a fresh choice in Settings. A restore that moves that file back to the same older point too ' +
  'cannot be detected: after one, raise the cleanup pause and confirm a fresh choice in Settings before choosing Live.';

/** The opener's two pure deciders moved with its rules to `../sqliteFile.ts` (private store plan, Task 1); re-exported
 *  here under the same names, so `coord-db.test.ts` and every other importer keep the import they always had. */
export { describeMigrationProgress, shouldRemoveMigrationFailureArtifact } from '../sqliteFile.js';

/** `~/.ccrc/coord.db` on the SERVER box — the same directory `push-subs.json`
 *  (`index.ts:23`), `notify-log.json` (`index.ts:30`) and `state-cache.json`
 *  (`fleetstate.ts:32`) already live in, and the same stance: this is local-box
 *  housekeeping, never proxied through FleetIO. The fleet host has no copy and
 *  cannot read this file; every cross-check against a `.hold`/`.prhistory`/
 *  registry fact is a FleetIO read in the other direction. */
export function defaultCoordDbPath(home: string = homedir()): string {
  return path.join(home, '.ccrc', 'coord.db');
}

/**
 * Open the coordination database, migrating it forward if needed, or refuse to
 * start.
 *
 * THE HOUSE CACHE RULES DO NOT APPLY HERE, and this paragraph is why — because
 * without it a reviewer will cite them, correctly, against this file:
 *
 *  - `fleetstate.ts:47-55` says "the READ is the version negotiation", and that
 *    a cache which cannot be revived is treated as ABSENT. `offline.ts:11-16`
 *    stays at v1 forever for the same reason. Both govern artefacts whose loss
 *    is FREE: the degraded-mode snapshot is re-assembled live, the offline
 *    snapshot is replaced by the next frame.
 *  - This is the first artefact in ccrc whose loss is NOT free. Collapsing an
 *    unreadable database to "empty" would answer "that program never happened"
 *    — the exact shape of `ccd`'s SIXTEENTH FORGERY, a manifest that lies
 *    pristine (`ccd/ccd`'s `_ws_clip_manifest`).
 *  - And the reason those files could not do better is absent here: they had
 *    NOWHERE to put a version key. This file has `PRAGMA user_version`, which
 *    IS the key, so the negotiation is a real one and does not have to be
 *    smuggled into the read.
 *
 * The four rules, from spec:70-81:
 *   1. Forward-only, idempotent, at open, EACH IN A TRANSACTION.
 *   2. Cannot migrate -> refuse to start LOUDLY. Never start empty.
 *   3. A HIGHER user_version is not fatal: a rollback (`~/ccrc-backups/`, and
 *      `shared/api.ts:808-817` on why rollback is a real scenario) must be able
 *      to READ. It may only refuse to MIGRATE. `user_version` is never written
 *      downward, and unknown columns are ignored because every read names its
 *      columns explicitly — `SELECT *` is banned in this directory.
 *   4. The markdown ledger stays the disaster-recovery ground truth
 *      (`docs/superpowers/programs/<slug>.md` + the registry + `.prhistory`);
 *      `coord-store.test.ts`'s reconstruction drill proves the path.
 */
export function openCoordDb(dbPath: string): DatabaseSync {
  return openMigratedSqlite(dbPath, COORD_DB_SPEC);
}

/** `coord.db`'s spec for the shared opener: its migrations, its error class and its two refusal sentences, which stay
 *  here, byte for byte (`collect-lane-restore-wording.test.ts` and `roster-bash.test.ts` pin their text in this file).
 *  `MIGRATIONS` is handed as the array itself, never a copy, so the opener indexes the same object `schema.ts` exports.
 *  No `createMode`: `coord.db` is created at the umask's mode, as it always has been. */
const COORD_DB_SPEC: MigratedSqliteSpec = {
  migrations: MIGRATIONS,
  label: 'coord.db',
  zeroByte: (dbPath) =>
    `ccrc-server: ${dbPath} exists but is 0 bytes. REFUSING TO START: SQLite would treat this as ` +
    'a brand-new empty database and migrate 0->1 clean, silently erasing whatever this file held ' +
    'before it was truncated — the outcome rule 2 forbids by name. Check ~/ccrc-backups/<ts>/coord.db ' +
    'first: every deploy.sh run snapshots coord.db there (VACUUM INTO, backup-coord.mjs) before ' +
    'touching anything, so the newest timestamped snapshot is the restore path. Only if no ' +
    'snapshot exists, reconstruct the program history from the markdown ledger ' +
    '(docs/superpowers/programs/<slug>.md) plus the registry and .prhistory (spec:82-85), or ' +
    'move the file aside and accept the loss — starting empty would erase it silently instead.' + JOURNAL_RESTORE_CLAUSE,
  migrationFailed: (dbPath, v, err, dataStatus) =>
    `ccrc-server: ${dbPath} is at schema ${v} and migration ${v + 1} failed: ` +
    `${err instanceof Error ? err.message : String(err)}. REFUSING TO START. ${dataStatus} ` +
    'Check ~/ccrc-backups/<ts>/coord.db first: every deploy.sh run snapshots coord.db there ' +
    '(VACUUM INTO, backup-coord.mjs) before touching anything, so the newest timestamped ' +
    'snapshot is the restore path. Only if no snapshot exists, reconstruct the program history ' +
    'from the markdown ledger (docs/superpowers/programs/<slug>.md) plus the registry and ' +
    '.prhistory (spec:82-85), or move the file aside and accept the loss — starting empty ' +
    'would erase it silently instead.' + JOURNAL_RESTORE_CLAUSE,
  fail: (message) => new CoordDbUnmigratable(message),
};

/**
 * The boot check for an active COORDINATION RESTORE (delegation broker wave 3, R24; plan Task 8B). `ccrc coordination-snapshot`
 * publishes a marker in the coordination directory (`~/.ccrc`) while it replaces the live set — `coord.db` and the delegation
 * journal and checkpoint — and removes it only when the replacement is whole. While it stands the files are a half-replaced mix, so a
 * server that booted over them would open a database that disagrees with its own sidecars. Delegation recovery refuses the marker for
 * itself (`restore-in-progress`); this is the server's own refusal, asked BEFORE `openCoordDb`, so the process stops before it opens
 * anything rather than running on with the observation lane off.
 *
 * Returns the refusal text (one `ccrc-server:` line naming the recovery command), or `null` when there is no marker. FAIL CLOSED: the
 * only answer that means "no restore is running" is ENOENT. Anything else — a marker of any type, a dangling link, a parent that is
 * not a directory, a permission error — is a refusal, because a marker that cannot be measured is not a marker that is missing.
 * `markerFile` is handed in (the caller imports `COORDINATION_RESTORE_MARKER_FILE`): this module is imported by `config.ts` and must
 * not pull the delegation modules into every importer's graph.
 */
export function coordinationRestoreRefusal(ccrcDir: string, markerFile: string): string | null {
  const marker = path.join(ccrcDir, markerFile);
  try {
    lstatSync(marker);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    return `ccrc-server: REFUSING TO START: ${marker} could not be measured (${code ?? 'unknown error'}), so a coordination restore cannot be ruled out. ` +
      'Fix the directory, then run `ccrc coordination-snapshot recover` if a restore was interrupted.';
  }
  return `ccrc-server: REFUSING TO START: a coordination restore is in progress or did not finish (${marker} exists), so coord.db and the ` +
    'delegation journal and checkpoint may be a half-replaced mix. Run `ccrc coordination-snapshot recover` to finish it; the marker is ' +
    'removed only when the restore is whole.';
}

/** `tx` lives in `./tx.js` (D-5896): it needs only the handle's `exec`, so a policy file that queues mail through
 *  `rundefsTx.ts` reaches no `node:sqlite` at runtime. Re-exported here so the store, the routes and the tests keep
 *  the import they always had. */
export { tx };
