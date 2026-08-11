// Consistent snapshot of coord.db for the deploy's backup set.
//
// NOT `cp`: the DB runs in WAL mode and the WAL has been measured holding 10x
// the main file (844KB WAL against a 78KB coord.db, 2026-08-11) — a cp of the
// main file alone is a plausible-looking backup missing nearly everything
// recent, which is worse than no backup because it reads as one. VACUUM INTO
// folds the WAL into a single self-contained file, works from a readOnly
// connection, and needs no sqlite3 CLI (the server box has none — node:sqlite
// is already this repo's floor, ci.yml pins node >=22.13.0 for exactly it).
//
// The filename is a bound parameter, not string splicing: VACUUM INTO takes an
// expression, and a path with a quote in it must not be able to become SQL.
//
// TEMP-THEN-RENAME, for the same reason install_atomic exists one file over:
// a snapshot interrupted mid-VACUUM (reproduced with SIGKILL) leaves a
// partial file at the destination — the exact plausible-looking-but-wrong
// backup the paragraph above calls worse than nothing. Building at a .tmp
// sibling and renaming on success means the final name either holds a
// complete snapshot or nothing. The pre-clean removes BOTH a stale tmp (a
// fresh VACUUM INTO refuses an existing file) and its -journal (a stale hot
// journal must never be rolled into a new snapshot).
import { DatabaseSync } from 'node:sqlite';
import { renameSync, rmSync } from 'node:fs';

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error('usage: node backup-coord.mjs <src.db> <dest.db>');
  process.exit(2);
}
const tmp = `${dest}.tmp`;
rmSync(tmp, { force: true });
rmSync(`${tmp}-journal`, { force: true });
const db = new DatabaseSync(src, { readOnly: true });
db.prepare('VACUUM INTO ?').run(tmp);
db.close();
renameSync(tmp, dest);
