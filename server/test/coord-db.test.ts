// The four properties spec:70-81 names, and one the spec implies: a
// transaction that throws leaves nothing behind.
import { describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COORD_SCHEMA_VERSION, CoordDbUnmigratable, defaultCoordDbPath, describeMigrationProgress,
  openCoordDb, shouldRemoveMigrationFailureArtifact, tx,
} from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { mkTmp } from './tmpHelpers.js';

const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('defaultCoordDbPath', () => {
  it('joins .ccrc/coord.db under the given home', () => {
    // Same precedent as `fleetstate.test.ts`'s `defaultCachePath` pin: the
    // exported helper is asserted directly, not just through whatever
    // `config.ts` happens to do with it — a rename here must fail a test in
    // THIS file, not rely on `config.ts` staying wired to it.
    expect(defaultCoordDbPath('/home/x')).toBe(path.join('/home/x', '.ccrc', 'coord.db'));
  });
});

describe('openCoordDb', () => {
  it('creates the parent directory, the schema and the version, then reopens idempotently', () => {
    const home = mkTmp('ccrc-coord-');
    const p = dbPathIn(home);
    expect(existsSync(path.dirname(p))).toBe(false);   // ~/.ccrc is NOT made by the deploy

    const a = openCoordDb(p);
    expect((a.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION);
    expect((a.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode)
      .toBe('wal');
    // Every table spec:106-117 names, plus the two D-3 adds, plus Task 10's
    // orchestrator-added `feed_events` (the durable archive behind NotifyLog's
    // in-memory ring).
    const names = (a.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as
      { name: string }[]).map((r) => r.name).sort();
    expect(names).toEqual(expect.arrayContaining([
      'coordinator_state', 'feed_events', 'mail', 'mail_deliveries', 'mail_rejections',
      'programs', 'run_events', 'runs', 'work_items',
    ]));
    a.prepare("INSERT INTO programs (slug,title,createdAt,state) VALUES ('p','P',1,'active')").run();
    a.close();

    // Reopening at the current version migrates NOTHING and destroys nothing —
    // and, since `current === COORD_SCHEMA_VERSION` here, it must NOT take the
    // `current > COORD_SCHEMA_VERSION` rollback-read branch either. A mutant
    // that widens the comparison to `>=` enters that branch instead of the
    // (empty, on this path) migration loop; both return a usable `db`, so the
    // warning is the ONLY observable difference — pin it, not just the data.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = openCoordDb(p);
    expect((b.prepare('SELECT count(*) AS c FROM programs').get() as { c: number }).c).toBe(1);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    b.close();
  });

  it('mail_deliveries carries exactly the index dueDeliveries can use — the dead mail_deliveries_replay index stays gone', () => {
    // Finding: schema.ts shipped a SECOND index, mail_deliveries_replay
    // (state, deliveredAt), reasoned (D-10) to be what dueDeliveries's
    // replay arm needs the way mail_deliveries_due already covers the
    // queued arm — true when D-10 landed, false of the query actually
    // shipped: a later fix ("mail replay honors backoff") added
    // `AND nextAttemptAt <= ?` to the replay arm too, so BOTH arms now
    // filter on (state, nextAttemptAt) and mail_deliveries_due alone
    // serves both — measured via EXPLAIN QUERY PLAN, both OR branches
    // choose mail_deliveries_due, byte-identical with or without the
    // second index. Every write to this hot table (every queued mail,
    // every markDelivered/markIngested/backOff/ack, on the 10s
    // MAIL_SWEEP_MS lane) was maintaining a b-tree no query ever read.
    // This pins the FULL index set, not just the dead one's absence, so
    // a stray replacement index cannot slip back in unnoticed either.
    const home = mkTmp('ccrc-coord-');
    const p = dbPathIn(home);
    const db = openCoordDb(p);
    const indexNames = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='mail_deliveries' " +
      "AND name NOT LIKE 'sqlite_%'",
    ).all() as { name: string }[]).map((r) => r.name).sort();
    expect(indexNames).toEqual(['mail_deliveries_due']);
    db.close();
  });

  it('refuses to start, loudly, on a database it cannot migrate — and the WHOLE migration script rolls back, not just the statement that failed', () => {
    const home = mkTmp('ccrc-coord-');
    const p = dbPathIn(home);
    mkdirSync(path.dirname(p), { recursive: true });
    // The clash is on `work_items` deliberately, NOT `programs`. `programs` is
    // the FIRST statement `MIGRATIONS[0]` runs (schema.ts), so a clash there
    // dies before any DDL applies at all — `tx()` never gets a chance to roll
    // anything back, and a mutant with `tx()` deleted from the migration loop
    // produces byte-identical post-conditions (measured). `work_items` is the
    // FOURTH table the script creates, so `programs`/`runs`/`run_events` all
    // succeed first — this is the fixture that can actually tell a
    // transactional migration from a non-transactional one apart.
    const raw = new DatabaseSync(p);
    raw.exec('PRAGMA user_version = 0');
    raw.exec('CREATE TABLE work_items (nonsense INTEGER)');
    raw.close();

    let caught: unknown;
    try { openCoordDb(p); } catch (err) { caught = err; }
    expect(caught).toBeInstanceOf(CoordDbUnmigratable);
    const message = (caught as Error).message;
    // The message points the operator at the snapshot deploy.sh actually
    // takes every run (backup-coord.mjs, VACUUM INTO) — it spent its first
    // week claiming "There is no coord.db backup" after that became false,
    // sending an operator to ledger reconstruction with a restorable
    // snapshot sitting in ~/ccrc-backups/<ts>/.
    expect(message).toMatch(/ccrc-backups\/<ts>\/coord\.db/);
    // And it must not claim "nothing changed" unconditionally — here it
    // happens to be true (this was the first migration attempted this boot).
    expect(message).toMatch(/no table data changed/i);

    // And the file is UNTOUCHED — the migration ran in a transaction, so the
    // three tables that DID get created earlier in the same script were rolled
    // back along with the statement that failed, not left half-committed.
    const after = new DatabaseSync(p);
    expect((after.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(0);
    const survivingTables = (after.prepare(
      "SELECT name FROM sqlite_master WHERE name IN ('programs','runs','run_events')",
    ).all() as { name: string }[]).map((r) => r.name);
    expect(survivingTables).toEqual([]);
    // The pragma sequencing matters too: WAL is set only once the db is known
    // usable, so a migration that fails on its very first attempt this boot
    // must not even have flipped the journal mode.
    expect((after.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode)
      .not.toBe('wal');
    after.close();
  });

  it('READS a database from a NEWER build rather than refusing it', () => {
    // spec:78-81 — rollback is real. An older build meeting a higher
    // user_version may refuse to MIGRATE, never to READ.
    const home = mkTmp('ccrc-coord-');
    const p = dbPathIn(home);
    const a = openCoordDb(p);
    a.exec(`PRAGMA user_version = ${COORD_SCHEMA_VERSION + 7}`);
    a.exec('ALTER TABLE runs ADD COLUMN somethingFromTheFuture TEXT');
    a.prepare(`INSERT INTO programs (slug,title,createdAt,state) VALUES ('p','P',1,'active')`).run();
    a.close();

    // Rule 3 requires this path to be LOUD (spec:70-81). `current > VERSION`
    // and `current >= VERSION` agree on every OTHER assertion in this test —
    // same data, same unwritten-down version — so the warning is what a
    // mutant widening that comparison would have to fake, and nothing else
    // here would catch it.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = openCoordDb(p);                       // no throw
    expect((b.prepare('SELECT count(*) AS c FROM programs').get() as { c: number }).c).toBe(1);
    expect((b.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION + 7);              // never written DOWN
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toMatch(/this build knows/i);
    warnSpy.mockRestore();
    b.close();
  });

  it('rejects a file that is not a database at all, without eating it', () => {
    const home = mkTmp('ccrc-coord-');
    const p = dbPathIn(home);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, 'this is not a sqlite file\n');
    expect(() => openCoordDb(p)).toThrow();
    expect(existsSync(p)).toBe(true);
  });

  it('refuses a truncated (0-byte) file rather than silently adopting it as a fresh database', () => {
    // SQLite alone cannot tell "never existed" from "existed and was
    // truncated" apart — both are 0 bytes to `new DatabaseSync`, which would
    // otherwise migrate 0->1 clean and answer "that program never happened"
    // for whatever this file held (a disk-full write, an interrupted
    // `cp`/`rsync --inplace`, a stray `> coord.db`). Rule 2 forbids exactly
    // this: never start empty.
    const home = mkTmp('ccrc-coord-');
    const p = dbPathIn(home);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, '');
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBe(0);

    expect(() => openCoordDb(p)).toThrow(CoordDbUnmigratable);
    // Untouched: still 0 bytes, not silently stamped to schema 1.
    expect(statSync(p).size).toBe(0);

    // And it stays refused, every time — this file PREDATES the process, so
    // a caller that retries after "freeing the disk" (the wrong diagnosis
    // for THIS refusal) must keep meeting the same guard, not have the file
    // quietly vanish underneath it. This guard fires before `openCoordDb`
    // ever reaches the migration-failure cleanup path (below,
    // `shouldRemoveMigrationFailureArtifact`), which is the true target for
    // an "unlinks every 0-byte file, not just the ones it created" mutant —
    // pinned directly against that function instead, since a pre-existing
    // 0-byte file never reaches it to demonstrate the mutant here.
    expect(() => openCoordDb(p)).toThrow(CoordDbUnmigratable);
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBe(0);
  });

  it('a fresh install whose first migration fails leaves NO file behind — so the next boot, once the cause is fixed, migrates clean instead of refusing forever over a file that never held a row', () => {
    // The bug this pins: `new DatabaseSync` creates the file eagerly, at 0
    // bytes, before any migration runs — so a migration 1 that fails on a
    // path with no PRE-EXISTING file (disk-full, EIO, a SIGKILL in the
    // window, any cause named in the refusal message below) leaves a 0-byte
    // file that is entirely this call's own artifact. Left behind, that file
    // would trip the 0-byte guard above on the VERY NEXT boot — turning one
    // transient, already-remedied failure into a permanent refusal, over a
    // message that asserts data loss ("silently erasing whatever this file
    // held") which never happened.
    const home = mkTmp('ccrc-coord-');
    const p = dbPathIn(home);
    expect(existsSync(p)).toBe(false);   // genuinely fresh: no file, no dir

    // Force migration 1 to fail without a pre-existing file at `p` —
    // `MIGRATIONS` is typed `readonly` for callers, but the runtime object
    // is one plain array `db.ts` indexes into directly (`MIGRATIONS[v]`), so
    // swapping its FIRST entry for invalid SQL fails the exact statement
    // `openCoordDb`'s loop executes, inside the same `tx()` this build ships,
    // rather than a shape of it built out-of-band.
    const mutable = MIGRATIONS as unknown as string[];
    const original = mutable[0]!;
    let caught: unknown;
    try {
      mutable[0] = 'CREATE TABLE broken (';   // invalid DDL: exec() throws
      try { openCoordDb(p); } catch (err) { caught = err; }
    } finally {
      mutable[0] = original;   // restore even if an assertion below throws
    }

    expect(caught).toBeInstanceOf(CoordDbUnmigratable);
    expect((caught as Error).message).toMatch(/no table data changed/i);

    // The fix, measured directly rather than inferred from boot 2 alone: no
    // file survives this call at all. (A fix that only special-cased boot 2
    // — e.g. by checking mtime or a sentinel — would still fail this line.)
    expect(existsSync(p)).toBe(false);

    // Boot 2: the cause is fixed (MIGRATIONS restored above). This must
    // migrate clean, not hit the 0-byte guard over a file that predates
    // nothing and held nothing.
    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION);
    db.close();
  });

  it('tx rolls back everything on a throw, and commits everything otherwise', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    tx(db, () => {
      db.prepare("INSERT INTO programs (slug,title,createdAt,state) VALUES ('a','A',1,'active')").run();
    });
    expect(() => tx(db, () => {
      db.prepare("INSERT INTO programs (slug,title,createdAt,state) VALUES ('b','B',1,'active')").run();
      throw new Error('nope');
    })).toThrow('nope');
    const slugs = (db.prepare('SELECT slug FROM programs ORDER BY slug').all() as { slug: string }[])
      .map((r) => r.slug);
    expect(slugs).toEqual(['a']);
    db.close();
  });
});

describe('describeMigrationProgress', () => {
  // Isolated from `openCoordDb` deliberately. `MIGRATIONS.length === 2` since
  // Wave 2 added `runs_by_session`, so the "earlier migrations already
  // committed" branch IS reachable through `openCoordDb` (a fresh v0 file
  // migrating 0→2 can fail on iteration 1 with iteration 0 committed) — but
  // pinning BOTH branches directly is still the only way to kill a mutant
  // that guts either one, without the pin depending on which migration
  // happens to be the brittle one in this build's list.
  it('says nothing changed when the failing migration was the first attempted this boot', () => {
    expect(describeMigrationProgress(0, 0)).toMatch(/^No table data changed/);
    expect(describeMigrationProgress(3, 3)).toMatch(/^No table data changed/);
  });

  it('names the migrations that already committed this boot, and the schema they left the file at', () => {
    expect(describeMigrationProgress(0, 2)).toBe(
      'Migrations 1-2 already committed earlier in this boot — the file is now at schema 2, ' +
      'not 0 — before migration 3 failed and rolled back on its own.',
    );
  });

  it('uses the singular for exactly one committed migration', () => {
    expect(describeMigrationProgress(0, 1)).toMatch(/^Migration 1 already committed/);
    expect(describeMigrationProgress(0, 1)).not.toMatch(/^Migrations/);
  });
});

describe('shouldRemoveMigrationFailureArtifact', () => {
  // Isolated the same way, and for the same reason, as `describeMigrationProgress`
  // above: the 0-byte guard at the top of `openCoordDb` already refuses any file
  // that is 0 bytes AND pre-existing before a migration is even attempted, so
  // `existedBefore === true` reaching THIS decision with a post-rollback size of
  // 0 cannot happen through `openCoordDb` end to end — a mutant that deletes the
  // `!existedBefore` guard inside it would pass every `openCoordDb`-level test
  // in this file for exactly that reason. Pinned directly instead.
  it('removes a 0-byte file only when THIS call created it', () => {
    expect(shouldRemoveMigrationFailureArtifact(false, 0)).toBe(true);
  });

  it('never removes a 0-byte file that predates this process', () => {
    expect(shouldRemoveMigrationFailureArtifact(true, 0)).toBe(false);
  });

  it('never removes a file with real bytes in it, fresh install or not — only an EMPTY artifact is this call\'s own to discard', () => {
    expect(shouldRemoveMigrationFailureArtifact(false, 4096)).toBe(false);
    expect(shouldRemoveMigrationFailureArtifact(true, 4096)).toBe(false);
  });
});

describe('coord.db: migration 1 — runs_by_session', () => {
  it('reaches a database ALREADY at user_version 1 — it cannot be an amendment to MIGRATIONS[0]', () => {
    const p = dbPathIn(mkTmp('ccrc-coord-'));
    // Build the file exactly as the SHIPPED v1 server left it: migration 0
    // only, user_version 1. `db.ts`'s loop starts at `current`, so anything
    // amended INTO MIGRATIONS[0] can never run against this file again.
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => { raw.exec(MIGRATIONS[0]!); raw.exec('PRAGMA user_version = 1'); });
    raw.close();

    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2);
    expect(COORD_SCHEMA_VERSION).toBe(2);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as
      { name: string }[]).map((r) => r.name);
    expect(names).toContain('runs_by_session');
    db.close();
  });

  it('turns the sibling query from SCAN into SEARCH — the reason the index exists', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const plan = (db.prepare(
      'EXPLAIN QUERY PLAN SELECT id, program, wave, waveOf FROM runs ' +
      "WHERE sessionId = ? AND state NOT IN ('done','failed') AND id != ?",
    ).all('demo-alpha', -1) as { detail: string }[]).map((r) => r.detail).join(' | ');
    expect(plan).toContain('runs_by_session');
    expect(plan).not.toContain('SCAN runs');
    db.close();
  });

  it('does not justify amending v1 in place any more — that premise expired when coord.db shipped', () => {
    const src = readFileSync(path.join(root, 'server', 'src', 'coord', 'schema.ts'), 'utf8');
    // LINE-WRAP TOLERANT, and this is not fussiness — it is the difference
    // between a red step and a vacuous pass. BOTH phrases are split across SQL
    // comment lines in the shipped file: `-- 10's feed_events both give: coord.db has shipped`
    // / `-- to no box yet, so amending v1 before it has ever`, and
    // `-- same reason D-1's runs.clearedAt amendment gives: coord.db exists on no`
    // / `-- box yet, so amending v1 before it has ever been observed costs nothing.`
    // A single-line regex matches NEITHER and the assertion passes before the fix.
    const flat = src.replace(/\s*--\s*/g, ' ').replace(/\s+/g, ' ');
    expect(flat).not.toMatch(/coord\.db has shipped to no box yet/);
    expect(flat).not.toMatch(/coord\.db exists on no box yet/);
    // And the replacement says what is true now, so a future author is not
    // left to rediscover it.
    expect(src).toMatch(/already at `user_version 1`|already at user_version 1/);
  });
});
