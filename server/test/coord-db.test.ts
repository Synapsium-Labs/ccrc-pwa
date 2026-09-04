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
  // Isolated from `openCoordDb` deliberately. `MIGRATIONS.length === 4` since
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
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION);
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

describe('coord.db: migration 2 — the lifecycle journal mirror', () => {
  it('reaches a database ALREADY at user_version 2 — it cannot be an amendment to MIGRATIONS[0] or [1]', () => {
    const p = dbPathIn(mkTmp('ccrc-coord-'));
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => { raw.exec(MIGRATIONS[0]!); raw.exec(MIGRATIONS[1]!); raw.exec('PRAGMA user_version = 2'); });
    raw.close();

    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as
      { name: string }[]).map((r) => r.name).sort();
    expect(tables).toEqual(expect.arrayContaining([
      'lifecycle_events', 'lifecycle_gaps', 'lifecycle_generations',
    ]));
    db.close();
  });

  it('makes `uid` unique, and dedupes a uid-less line on (gen, raw) instead', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const ins = db.prepare(
      'INSERT OR IGNORE INTO lifecycle_events (uid, gen, at, ingestedAt, act, outcome, raw) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    ins.run('1.2.3', '1755780000000000000', 1, 9, 'unknown', 'unknown', '{"uid":"1.2.3"}');
    ins.run('1.2.3', '1755780000000000000', 1, 9, 'unknown', 'unknown', '{"uid":"1.2.3"}');
    ins.run(null, '1755780000000000000', null, 9, 'unknown', 'unknown', 'not json');
    ins.run(null, '1755780000000000000', null, 9, 'unknown', 'unknown', 'not json');
    ins.run(null, '1755780000000000001', null, 9, 'unknown', 'unknown', 'not json');
    expect((db.prepare('SELECT count(*) AS c FROM lifecycle_events').get() as { c: number }).c).toBe(3);
    db.close();
  });

  it('lets two DIFFERENT uid-less lines coexist in one generation — the dedupe is on the bytes, not on a position', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const ins = db.prepare(
      'INSERT OR IGNORE INTO lifecycle_events (uid, gen, at, ingestedAt, act, outcome, raw) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    ins.run(null, 'g', null, 9, 'unknown', 'unknown', 'garbage a');
    ins.run(null, 'g', null, 9, 'unknown', 'unknown', 'garbage b');
    expect((db.prepare('SELECT count(*) AS c FROM lifecycle_events').get() as { c: number }).c).toBe(2);
    db.close();
  });

  it('carries `detail` and `truncated` as their own columns — a dropped field is not a silence', () => {
    // `truncated` is what `_lc_json` writes when it shed fields to fit
    // LC_LINE_MAX. Without the column, "the family was not on the line" and
    // "the family was dropped to fit" collapse to one NULL — an overloaded
    // value at the one seam this whole record exists to keep honest.
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    db.prepare(
      'INSERT INTO lifecycle_events (uid, gen, at, ingestedAt, act, outcome, detail, truncated, raw) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('t.1', 'g', 1, 9, 'unknown', 'unknown', 'a sentence for a person', 1, '{}');
    const row = db.prepare('SELECT detail, truncated FROM lifecycle_events').get() as
      { detail: string | null; truncated: number };
    expect(row).toEqual({ detail: 'a sentence for a person', truncated: 1 });
    db.close();
  });
});

describe('coord.db: migration 3 — claims and the deviation ledger', () => {
  it('reaches a database ALREADY at user_version 3 — it cannot be an amendment to any earlier index', () => {
    const p = dbPathIn(mkTmp('ccrc-coord-'));
    // Build the file exactly as a Build-9a server leaves it: migrations 0-2,
    // user_version 3. `db.ts`'s loop starts at `current`, so anything amended
    // INTO an earlier index can never run against this file again.
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      raw.exec(MIGRATIONS[0]!); raw.exec(MIGRATIONS[1]!); raw.exec(MIGRATIONS[2]!);
      raw.exec('PRAGMA user_version = 3');
    });
    raw.close();

    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as
      { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining([
      'claims', 'claim_paths', 'ledger_alloc', 'ledger_floor',
    ]));
    db.close();
  });

  // Parent rows for every claim_paths insert below — foreign_keys is ON.
  const seedClaim = (db: DatabaseSync, id: number, project = 'demo'): void => {
    db.prepare(
      'INSERT INTO claims (id, project, heldBy, heldByUuid, intent, runId, state, ' +
      'createdAt, renewedAt, expiresAt, hardExpiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, project, `demo-holder-${id}`, 'u'.repeat(36), 'testing the schema', null, 'live',
      1, 1, 2, 3);
  };

  it('claim_one_owner: one LIVE owner per (project, path) — the D11 backstop is a loud constraint', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    seedClaim(db, 1); seedClaim(db, 2); seedClaim(db, 3, 'other');
    const ins = db.prepare('INSERT INTO claim_paths (claimId, project, path, live) VALUES (?, ?, ?, ?)');
    ins.run(1, 'demo', 'shared/api.ts', 1);
    expect(() => ins.run(2, 'demo', 'shared/api.ts', 1)).toThrow(/UNIQUE constraint failed/);
    // A DIFFERENT project's identical path is not a collision — the index is per (project, path).
    ins.run(3, 'other', 'shared/api.ts', 1);
    db.close();
  });

  it('a LAPSED claim frees its paths without deleting them — lapse, do not delete (D12)', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    seedClaim(db, 1); seedClaim(db, 2);
    const ins = db.prepare('INSERT INTO claim_paths (claimId, project, path, live) VALUES (?, ?, ?, ?)');
    ins.run(1, 'demo', 'ccd/ccd', 1);
    tx(db, () => {
      db.prepare("UPDATE claims SET state = 'lapsed', endedAt = 9, endedBy = 'session-gone' WHERE id = 1").run();
      db.prepare('UPDATE claim_paths SET live = 0 WHERE claimId = 1').run();
    });
    ins.run(2, 'demo', 'ccd/ccd', 1);   // the path is claimable again...
    // ...and the dead claim's path row SURVIVED — destroyed claim history is destroyed history.
    expect((db.prepare('SELECT count(*) AS c FROM claim_paths').get() as { c: number }).c).toBe(2);
    db.close();
  });

  it('ledger_alloc: PRIMARY KEY (project, n) — a number exists once per project, ever', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const ins = db.prepare(
      'INSERT INTO ledger_alloc (project, n, title, allocatedTo, allocatedAt, state) ' +
      'VALUES (?, ?, ?, ?, ?, ?)');
    ins.run('demo', 211, 'first subject', 'demo-quiet-mesa', 1, 'allocated');
    expect(() => ins.run('demo', 211, 'second subject', 'demo-brisk-ridge', 2, 'allocated'))
      .toThrow(/UNIQUE constraint failed/);
    // Namespaces are per project: another project owns its own 211.
    ins.run('other', 211, 'another project entirely', 'demo-plain-harbor', 3, 'allocated');
    db.close();
  });

  it('ledger_floor: one row per project — the floor is a single value, not a history', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const ins = db.prepare(
      'INSERT INTO ledger_floor (project, floor, evidence, updatedAt) VALUES (?, ?, ?, ?)');
    ins.run('demo', 260, 'docs/superpowers/plans/example.md names D-210', 1);
    expect(() => ins.run('demo', 261, 'a second seed', 2)).toThrow(/UNIQUE constraint failed/);
    db.close();
  });
});

describe('coord.db: migration 4 — runs.dispatchStartedAt', () => {
  /** One `runs` column as the database itself describes it. `PRAGMA
   *  table_info` is the only reader that can tell "nullable with no default"
   *  from "the DDL happens to have written nothing there yet" — the whole
   *  distinction this column rests on. */
  interface ColumnInfo { name: string; type: string; notnull: number; dflt_value: unknown }
  const runsColumn = (db: DatabaseSync, name: string): ColumnInfo | undefined =>
    (db.prepare('PRAGMA table_info(runs)').all() as unknown as ColumnInfo[])
      .find((c) => c.name === name);

  it('gives a fresh database the column, nullable and with no default', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const col = runsColumn(db, 'dispatchStartedAt');
    expect(col).toBeDefined();
    expect(col!.type).toBe('INTEGER');
    // NULLABLE WITH NO DEFAULT, and both halves are load-bearing. `NOT NULL`
    // would force every existing row to carry a number that never measured
    // anything, and a DEFAULT would make "no dispatch has ever started for
    // this run" indistinguishable from "one started at the epoch" — the
    // overloaded-null defect at the one seam the column exists to keep honest.
    expect(col!.notnull).toBe(0);
    expect(col!.dflt_value).toBeNull();
    db.close();
  });

  it('reaches a database ALREADY at user_version 4 — it cannot be an amendment to any earlier migration', () => {
    const p = dbPathIn(mkTmp('ccrc-coord-'));
    // Build the file exactly as a Build-9b server leaves it: migrations 0-3,
    // user_version 4. `db.ts`'s loop starts at `current`, so anything amended
    // INTO an earlier entry can never run against this file again.
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      raw.exec(MIGRATIONS[0]!); raw.exec(MIGRATIONS[1]!); raw.exec(MIGRATIONS[2]!);
      raw.exec(MIGRATIONS[3]!);
      raw.exec('PRAGMA user_version = 4');
    });
    raw.close();

    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION);
    expect(runsColumn(db, 'dispatchStartedAt')).toBeDefined();
    db.close();
  });

  it('reaches a database ALREADY at user_version 5 — it cannot be an amendment to any earlier migration', () => {
    // The same guard migrations 2..5 each earned, for migration 6. A file left
    // by a Build-9b-plus server is at 5; `db.ts`'s loop starts at `current`, so
    // anything amended INTO entries 0..4 can never run against it again. The
    // four gate columns must therefore arrive as their own entry, and this is
    // what proves they do.
    const p = dbPathIn(mkTmp('ccrc-coord-'));
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      raw.exec(MIGRATIONS[0]!); raw.exec(MIGRATIONS[1]!); raw.exec(MIGRATIONS[2]!);
      raw.exec(MIGRATIONS[3]!); raw.exec(MIGRATIONS[4]!);
      raw.exec('PRAGMA user_version = 5');
    });
    raw.close();

    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION);
    const cols = (db.prepare('PRAGMA table_info(mail_deliveries)').all() as unknown as ColumnInfo[])
      .map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['lastGate', 'gateCount', 'gateSince', 'gateAt']));
    db.close();
  });

  it('gives the gate columns the nullability D-792 depends on', () => {
    // Three nullable, one defaulted, and the split is the whole point. A NULL
    // `lastGate` means "no ordinary gate has refused this row"; a default would
    // collapse that into "refused by something at the epoch", which is the
    // overloaded null these columns exist to remove. `gateCount` defaults 0
    // because a count of refusals genuinely starts at none.
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const col = (name: string): ColumnInfo | undefined =>
      (db.prepare('PRAGMA table_info(mail_deliveries)').all() as unknown as ColumnInfo[])
        .find((c) => c.name === name);
    for (const n of ['lastGate', 'gateSince', 'gateAt']) {
      expect(col(n)?.notnull, `${n} must be nullable`).toBe(0);
      expect(col(n)?.dflt_value, `${n} must carry no default`).toBeNull();
    }
    expect(col('gateCount')?.notnull).toBe(1);
    expect(col('gateCount')?.dflt_value).toBe('0');
    db.close();
  });

  it('adds NO INDEX over the gate columns — an index would imply a query, and a query would be a scheduling read', () => {
    // The non-goal, as a mechanism. These four are written after every
    // scheduling decision is already made and read by none; the absence of an
    // index is the evidence there is no query. If a future change needs one,
    // this test is where the argument has to be made.
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const idx = (db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='mail_deliveries'").all() as unknown as { name: string; sql: string | null }[]);
    for (const i of idx) {
      for (const c of ['lastGate', 'gateCount', 'gateSince', 'gateAt']) {
        expect(i.sql ?? '', `index ${i.name} mentions ${c}`).not.toContain(c);
      }
    }
    db.close();
  });

  it('migration 7 gives runs briefQueued and clearError, nullable and defaultless', () => {
    // D-1298. NULLABLE WITH NO DEFAULT, and both halves are load-bearing here for
    // the same reason they were for dispatchStartedAt: NULL means "an older build
    // wrote this row, or no dispatch has committed", while `briefQueued = 0` means
    // "this dispatch queued no brief". A DEFAULT 0 would make those one value —
    // the overloaded null at exactly the seam the columns exist to keep honest,
    // because the FALSE branch is the one that previously left no trace at all.
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const bq = runsColumn(db, 'briefQueued');
    const ce = runsColumn(db, 'clearError');
    expect(bq, 'runs.briefQueued is absent').toBeDefined();
    expect(ce, 'runs.clearError is absent').toBeDefined();
    expect(bq!.type).toBe('INTEGER');
    expect(ce!.type).toBe('TEXT');
    expect(bq!.notnull, 'briefQueued is NOT NULL — absence would read as false').toBe(0);
    expect(bq!.dflt_value, 'briefQueued carries a default — null and false collapse').toBeNull();
    expect(ce!.notnull, 'clearError is NOT NULL').toBe(0);
    expect(ce!.dflt_value, 'clearError carries a default').toBeNull();
    db.close();
  });

  it('reaches a database ALREADY at user_version 6 — it cannot be an amendment to any earlier migration', () => {
    // The guard migrations 2..6 each earned, for migration 7. A file left by a
    // wave-6 server is at 6; db.ts's loop starts at `current`, so anything amended
    // INTO entries 0..5 can never run against it again.
    const p = dbPathIn(mkTmp('ccrc-coord-'));
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let i = 0; i <= 5; i++) raw.exec(MIGRATIONS[i]!);
      raw.exec('PRAGMA user_version = 6');
    });
    raw.close();

    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION);
    expect(runsColumn(db, 'briefQueued')).toBeDefined();
    expect(runsColumn(db, 'clearError')).toBeDefined();
    db.close();
  });

  it('COORD_SCHEMA_VERSION derives to 9 — never hand-edited beside a growing array', () => {
    expect(COORD_SCHEMA_VERSION).toBe(9);
    expect(MIGRATIONS.length).toBe(9);
  });

  it('is ADDITIVE: every column migration 1 wrote is still on the table, unchanged', () => {
    // The additive-only rule (this file's header, spec:77) as a mechanism
    // rather than a request: migration 4 may only ADD. A future author who
    // reaches for a rebuild-the-table migration — SQLite's usual answer to a
    // column change — trips this rather than discovering it on a live file.
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const names = (db.prepare('PRAGMA table_info(runs)').all() as unknown as ColumnInfo[])
      .map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining([
      'id', 'program', 'wave', 'waveOf', 'project', 'sessionId', 'workspace', 'branch',
      'state', 'claimedBy', 'resumed', 'clearedAt', 'openedAt', 'dispatchedAt', 'closedAt',
      'handoffCommit', 'prLineage', 'dispatchStartedAt',
    ]));
    db.close();
  });
});

describe('coord.db: migration 8 — un-landing the two rows a CITATION stamped', () => {
  // The file the old matcher stamped against. It CITES an allocation RANGE in a
  // blockquote — `> **D-1294..D-1332** from \`POST /api/ledger/deviations\`` — and
  // DEFINES neither number. That, and only that, is the argument: it is otherwise
  // an ordinary merged plan which defines a whole ledger of its own — a 1245-1252
  // band and an unbroken band from 1333 up, which that plan keeps extending, so no
  // count is written here (it moved the day after one was, D-1444) — most of them
  // allocator-issued. So the
  // path CANNOT be the whole discriminator, and the two rows below prove it from
  // both sides.
  const CITING = 'docs/superpowers/plans/2026-09-02-graphify-read-side-ccrc-level.md';
  const DEFINING = 'docs/superpowers/plans/2026-09-02-program-leverage-wave7-f7.md';

  const INSERT =
    'INSERT INTO ledger_alloc (project, n, title, allocatedTo, runId, allocatedAt, ' +
    'state, landedAt, landedIn) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)';
  const ROWS = 'SELECT n, state, landedAt, landedIn FROM ledger_alloc ORDER BY n';

  /** A file exactly as a server at user_version 7 left it, carrying the two rows
   *  the citation stamped, one landed off a real definition in ANOTHER file, one
   *  landed off a real definition in the SAME file, and one still open. The
   *  fourth row is the one the plan's path-only statement would have destroyed:
   *  the old matcher landed D-1333 against that file too, and it was RIGHT to. */
  const atV7 = (): string => {
    const p = dbPathIn(mkTmp('ccrc-coord-'));
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let i = 0; i <= 6; i++) raw.exec(MIGRATIONS[i]!);
      raw.exec('PRAGMA user_version = 7');
    });
    const ins = raw.prepare(INSERT);
    ins.run('ccrc-pwa', 1293, 'landed off a definition elsewhere', 'x', 1, 'landed', 9, DEFINING);
    ins.run('ccrc-pwa', 1294, 'stamped off a citation', 'x', 1, 'landed', 9, CITING);
    ins.run('ccrc-pwa', 1300, 'still open', 'x', 1, 'allocated', null, null);
    ins.run('ccrc-pwa', 1332, 'stamped off a citation', 'x', 1, 'landed', 9, CITING);
    ins.run('ccrc-pwa', 1333, 'landed off a real definition in that same file', 'x', 1, 'landed', 9, CITING);
    raw.close();
    return p;
  };

  it('un-lands exactly the two numbers the citation named, and touches nothing else', () => {
    const p = atV7();
    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION);
    expect(db.prepare(ROWS).all()).toEqual([
      { n: 1293, state: 'landed', landedAt: 9, landedIn: DEFINING },
      { n: 1294, state: 'allocated', landedAt: null, landedIn: null },
      { n: 1300, state: 'allocated', landedAt: null, landedIn: null },
      { n: 1332, state: 'allocated', landedAt: null, landedIn: null },
      // NOT un-landed, and this row is the whole reason the statement names two
      // numbers instead of a path: that file really does define D-1333, so this
      // landing is TRUE and a path-keyed repair would have deleted it.
      { n: 1333, state: 'landed', landedAt: 9, landedIn: CITING },
    ]);
    db.close();
  });

  it('cannot reach a row the corrected sweep lands against that same file afterwards', () => {
    // Not merely "running it twice changes nothing" — that is trivially true once
    // no row matches. This plants a row the CORRECTED sweep really will land, with
    // the CITING file as its `landedIn`, and proves the statement cannot reach it.
    // D-1340 is defined in that file (`- **D-1340** — …`) and issued by the
    // allocator, so this is the ordinary future, not a contrived one.
    const p = atV7();
    const db = openCoordDb(p);
    db.prepare(INSERT).run(
      'ccrc-pwa', 1340, 're-landed by the corrected sweep', 'x', 1, 'landed', 11, CITING);
    const before = db.prepare(ROWS).all();
    db.exec(MIGRATIONS[7]!);
    expect(db.prepare(ROWS).all()).toEqual(before);
    db.close();
  });
});


describe('coord.db: migration 9 — automations, their runs and their steps', () => {
  interface ColumnInfo { name: string; type: string; notnull: number; dflt_value: unknown }
  const tableInfo = (db: DatabaseSync, table: string): ColumnInfo[] =>
    db.prepare(`PRAGMA table_info(${table})`).all() as unknown as ColumnInfo[];
  const col = (db: DatabaseSync, table: string, name: string): ColumnInfo | undefined =>
    tableInfo(db, table).find((c) => c.name === name);
  const nowSeconds = 1_700_000_000;

  // A minimally-valid armed row, satisfying the invariant this migration must
  // enforce (`state='armed' AND scheduleError IS NULL <=> nextRunAt IS NOT
  // NULL`) — every mutation test below starts from this and breaks exactly
  // one field.
  const insertAutomation = (
    db: DatabaseSync,
    overrides: Partial<{
      state: string; nextRunAt: number | null; scheduleError: string | null;
    }> = {},
  ): void => {
    const row = {
      name: 'nightly build', state: 'armed', project: 'demo',
      prompt: 'do the thing', cadenceKind: 'wall-clock', cadenceDays: 127,
      cadenceMinute: 60, cadenceEvery: null, tz: 'UTC', graceMs: 60_000,
      createdAt: nowSeconds, updatedAt: nowSeconds, provedAt: nowSeconds,
      nextRunAt: nowSeconds + 3600, scheduleError: null,
      ...overrides,
    };
    db.prepare(
      'INSERT INTO automations (name, state, project, prompt, cadenceKind, cadenceDays, ' +
      'cadenceMinute, cadenceEvery, tz, graceMs, createdAt, updatedAt, provedAt, nextRunAt, ' +
      'scheduleError) VALUES (@name, @state, @project, @prompt, @cadenceKind, @cadenceDays, ' +
      '@cadenceMinute, @cadenceEvery, @tz, @graceMs, @createdAt, @updatedAt, @provedAt, ' +
      '@nextRunAt, @scheduleError)',
    ).run(row);
  };

  it('reaches the head user_version and creates all four tables plus their indexes', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as
      { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining([
      'automations', 'automation_runs', 'automation_run_events', 'automations_state',
    ]));
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as
      { name: string }[]).map((r) => r.name);
    expect(indexes).toEqual(expect.arrayContaining([
      'automations_due', 'automations_by_project', 'automation_runs_by_automation',
      'automation_run_events_by_run',
    ]));
    db.close();
  });

  it('gives `automations` exactly the columns spec:320-370 names, in order', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const names = tableInfo(db, 'automations').map((c) => c.name);
    // `leaseRunId` (Task 4, task-4-decisions.md C1.6): the third lease column,
    // appended after `leaseHardUntil` — additive to this same migration, not a
    // new one. Without it, a settle racing a superseding claim (the soft-bound
    // lease lapsing while the loser is still mid-spawn) could release the
    // SUCCESSOR's lease instead of its own — `claims.heldBy`'s identical shape.
    expect(names).toEqual([
      'id', 'name', 'state', 'project', 'prompt', 'cadenceKind', 'cadenceDays',
      'cadenceMinute', 'cadenceEvery', 'tz', 'graceMs', 'createdAt', 'updatedAt',
      'provedAt', 'nextRunAt', 'scheduleError', 'lastFireAt', 'lastOutcome',
      'lastRefusal', 'leaseUntil', 'leaseHardUntil', 'leaseRunId',
      'consecutiveFailures', 'runsEvicted',
    ]);
    db.close();
  });

  it('gives `automation_runs` exactly the columns spec:377-398 names, in order', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const names = tableInfo(db, 'automation_runs').map((c) => c.name);
    expect(names).toEqual([
      'id', 'automationId', 'scheduledFor', 'startedAt', 'endedAt', 'lateMs', 'outcome',
      'refusal', 'trigger', 'dstShifted', 'adopted', 'sessionId', 'workspace', 'branch',
      'wrapper', 'homeScore', 'spawnRc',
    ]);
    db.close();
  });

  it('gives `automation_run_events` exactly the columns spec:401-411 names, in order', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const names = tableInfo(db, 'automation_run_events').map((c) => c.name);
    expect(names).toEqual(['id', 'runId', 'at', 'step', 'ok', 'detail', 'truncatedBytes']);
    db.close();
  });

  it('gives `automations_state` exactly the columns spec:413-417 names, in order', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const names = tableInfo(db, 'automations_state').map((c) => c.name);
    expect(names).toEqual(['id', 'paused', 'updatedAt']);
    db.close();
  });

  it('keeps `nextRunAt`, `scheduleError`, `tz`, `provedAt`, `lastFireAt` nullable with no default — collapsing any one is the overloaded-null defect §5 names', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    for (const n of ['nextRunAt', 'scheduleError', 'tz', 'provedAt', 'lastFireAt']) {
      const c = col(db, 'automations', n);
      expect(c, `automations.${n} must exist`).toBeDefined();
      expect(c!.notnull, `automations.${n} must be nullable`).toBe(0);
      expect(c!.dflt_value, `automations.${n} must carry no default`).toBeNull();
    }
    db.close();
  });

  it('keeps `spawnRc` and `homeScore` nullable with no default — NULL is UNMEASURED, not zero (limits.ts:40-47)', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    for (const n of ['spawnRc', 'homeScore']) {
      const c = col(db, 'automation_runs', n);
      expect(c, `automation_runs.${n} must exist`).toBeDefined();
      expect(c!.notnull, `automation_runs.${n} must be nullable`).toBe(0);
      expect(c!.dflt_value, `automation_runs.${n} must carry no default`).toBeNull();
    }
    db.close();
  });

  it('gives `truncatedBytes` NOT NULL DEFAULT 0, so it is always emitted', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const c = col(db, 'automation_run_events', 'truncatedBytes');
    expect(c!.notnull).toBe(1);
    expect(c!.dflt_value).toBe('0');
    db.close();
  });

  it('seeds `automations_state` with exactly one row, paused = 0', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const rows = db.prepare('SELECT id, paused, updatedAt FROM automations_state').all() as
      { id: number; paused: number; updatedAt: number }[];
    expect(rows).toEqual([{ id: 1, paused: 0, updatedAt: 0 }]);
    db.close();
  });

  it('reaches a database ALREADY at user_version 6 — it cannot be an amendment to any earlier migration, and existing `runs` rows survive it', () => {
    const p = dbPathIn(mkTmp('ccrc-coord-'));
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      // Seeds every entry BELOW this one and stamps the version it left, so the
      // loop has exactly this migration to run. The range moved from 0..5 to 0..7
      // when `main` took 7 and 8 and this entry was renumbered to 9.
      for (let i = 0; i <= 7; i++) raw.exec(MIGRATIONS[i]!);
      raw.exec('PRAGMA user_version = 8');
    });
    raw.prepare(
      "INSERT INTO programs (slug,title,createdAt,state) VALUES ('p','P',1,'active')",
    ).run();
    raw.prepare(
      'INSERT INTO runs (program, wave, project, state, openedAt) ' +
      "VALUES ('p', 1, 'demo', 'planned', 1)",
    ).run();
    raw.close();

    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as
      { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining([
      'automations', 'automation_runs', 'automation_run_events', 'automations_state',
    ]));
    expect((db.prepare('SELECT count(*) AS c FROM runs').get() as { c: number }).c).toBe(1);
    db.close();
  });

  // spec:344-346's invariant, as a mechanism rather than a comment: "A comment
  // is a request; a red suite is a mechanism" (CLAUDE.md). Enforced by a CHECK
  // constraint on `automations` so a direct INSERT that violates it — not just
  // one routed through a future writer — is refused by the database itself.
  describe('the armed invariant — state=\'armed\' AND scheduleError IS NULL <=> nextRunAt IS NOT NULL', () => {
    it('accepts an armed, unerrored row with a nextRunAt', () => {
      const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
      expect(() => insertAutomation(db)).not.toThrow();
      db.close();
    });

    it('accepts a paused row with nextRunAt NULL', () => {
      const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
      expect(() => insertAutomation(db, { state: 'paused', nextRunAt: null })).not.toThrow();
      db.close();
    });

    it('accepts an armed row with a scheduleError and nextRunAt NULL', () => {
      const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
      expect(() => insertAutomation(
        db, { scheduleError: 'bad-cadence', nextRunAt: null },
      )).not.toThrow();
      db.close();
    });

    it('REFUSES an armed, unerrored row with nextRunAt NULL — "due at T" cannot silently mean "never"', () => {
      const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
      expect(() => insertAutomation(db, { nextRunAt: null })).toThrow(/CHECK constraint failed/);
      db.close();
    });

    it('REFUSES a paused row that still carries a nextRunAt — "paused" cannot silently mean "still due"', () => {
      const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
      expect(() => insertAutomation(db, { state: 'paused' })).toThrow(/CHECK constraint failed/);
      db.close();
    });

    it('REFUSES an armed row with BOTH a scheduleError and a nextRunAt — "cannot be scheduled" cannot silently mean "due at T"', () => {
      const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
      expect(() => insertAutomation(db, { scheduleError: 'bad-cadence' })).toThrow(
        /CHECK constraint failed/,
      );
      db.close();
    });
  });

  it('derives COORD_SCHEMA_VERSION from MIGRATIONS.length IN SOURCE — a hand-edited literal would still read 7 at runtime and pass every behavioural pin above, so this is a text scan, not a value check', () => {
    const src = readFileSync(path.join(root, 'server', 'src', 'coord', 'schema.ts'), 'utf8');
    expect(src).toMatch(/export const COORD_SCHEMA_VERSION = MIGRATIONS\.length;/);
  });
});
