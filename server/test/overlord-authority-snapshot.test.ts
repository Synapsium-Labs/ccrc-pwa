// Overlord W1, authority journal plan Task 4 (PR A), "Never in a snapshot": the Overlord authority journal
// (`~/.ccrc/overlord-authority.jsonl`) and its quarantine directory (`~/.ccrc/overlord-authority-torn/`) are in no backup set,
// restore pair or snapshot capture, so a restored `coord.db` or a restored snapshot can never bring back an older journal: the
// journal exists to distrust the rows a restore brings back (spec §7.6, H27; Table 11.1a, "never"). The checks follow the landing
// journal's (`landing-entry-census.test.ts`, "landing-journal-left-in-place") and the collector log's (`coordination-snapshot.test.ts`,
// "8C (#384)"): the update's backup set and its restore pairs, the SQLite snapshot step, and the coordination snapshot helper, read as
// text and run for real over a fixture home.
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { OVERLORD_AUTHORITY_BASENAME, OVERLORD_AUTHORITY_TORN_DIR } from '../src/coord/overlordAuthority.js';
import { mkTmp } from './tmpHelpers.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HELPER_PATH = path.join(REPO_ROOT, 'deploy', 'coordination-snapshot.mjs');
const BACKUP_COORD_PATH = path.join(REPO_ROOT, 'deploy', 'backup-coord.mjs');
/** Every spelling a copy of either could take: the constants' values, and the stem both share. */
const NAMES = [OVERLORD_AUTHORITY_BASENAME, OVERLORD_AUTHORITY_TORN_DIR, 'overlord-authority'];

/** The body of a bash function in `ccd/ccrc`, from its opening line to the first line that is a lone `}`. */
function bashFunction(text: string, name: string): string {
  const a = text.indexOf(`\n${name}() {`);
  expect(a, `${name} is gone: a moved function must turn this red`).toBeGreaterThan(-1);
  return text.slice(a, text.indexOf('\n}\n', a));
}

describe('the Overlord authority journal is never in a snapshot (Task 4)', () => {
  it('the update\'s backup set and its restore pairs name neither the journal nor its torn directory', () => {
    const ccrc = readFileSync(path.join(REPO_ROOT, 'ccd/ccrc'), 'utf8');
    const set = bashFunction(ccrc, '_upd_backup_set');
    expect(set).toContain('_upd_backup_copy');
    const pairs = bashFunction(ccrc, '_upd_backup_pairs');
    expect(pairs).toContain('_upd_backup_set');
    for (const n of NAMES) {
      expect(set, n).not.toContain(n);
      expect(pairs, n).not.toContain(n);
    }
  });

  it('the SQLite snapshot step and the coordination snapshot helper name neither', () => {
    for (const f of [BACKUP_COORD_PATH, HELPER_PATH]) {
      expect(existsSync(f), `${f} is gone: a moved file must turn this red`).toBe(true);
      const text = readFileSync(f, 'utf8');
      for (const n of NAMES) expect(text, `${path.basename(f)} names ${n}`).not.toContain(n);
    }
  });

  describe('a real capture over a fixture home that holds both', () => {
    let H: { capture(o: { home: string; dir: string; sleep: (ms: number) => void; now: () => Date }): unknown };
    beforeAll(async () => { H = await import(pathToFileURL(HELPER_PATH).href); });

    it('copies neither into the backup directory or its manifest, and leaves both untouched', () => {
      const home = mkTmp('ccrc-fx-authority-snap-');
      const live = path.join(home, '.ccrc');
      mkdirSync(live, { recursive: true });
      const db = new DatabaseSync(path.join(live, 'coord.db'));
      db.exec('CREATE TABLE fixture (x INTEGER)');
      db.close();
      const journal = path.join(live, OVERLORD_AUTHORITY_BASENAME);
      writeFileSync(journal, '{"v":1}\n');
      const torn = path.join(live, OVERLORD_AUTHORITY_TORN_DIR);
      mkdirSync(torn, { mode: 0o700 });
      writeFileSync(path.join(torn, '8-0000.tail'), 'torn');
      const before = [statSync(journal), statSync(torn)].map((s) => [s.ino, s.mtimeMs, s.size]);

      const dir = path.join(home, 'ccrc-backups', '20261116-100000');
      mkdirSync(dir, { recursive: true });
      const r = spawnSync(process.execPath, ['--no-warnings', BACKUP_COORD_PATH, path.join(live, 'coord.db'), path.join(dir, 'coord.db')], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      H.capture({ home, dir, sleep: () => undefined, now: () => new Date('2026-11-16T10:00:00.000Z') });

      const listing = readdirSync(dir).sort();
      expect(listing).toContain('coord.db');
      for (const n of NAMES) {
        expect(listing.filter((f) => f.includes(n)), n).toEqual([]);
        for (const f of listing.filter((x) => x.endsWith('.json'))) expect(readFileSync(path.join(dir, f), 'utf8'), `${f} names ${n}`).not.toContain(n);
      }
      expect([statSync(journal), statSync(torn)].map((s) => [s.ino, s.mtimeMs, s.size])).toEqual(before);
      expect(readFileSync(journal, 'utf8')).toBe('{"v":1}\n');
    });
  });
});
