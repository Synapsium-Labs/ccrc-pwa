// The character choice (the Overlord face plan, Task 6): one `face_settings` row and `GET`/`POST /api/face`. Fixture homes
// only. The migration case is in `collect-lane-migration.test.ts`'s shape: a database at the version before, migrated, the
// seed read back.
import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { DEFAULT_CHARACTER } from '../../shared/face.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const CREATE = /CREATE TABLE face_settings(?![A-Za-z0-9_])/;
const SLOT = MIGRATIONS.findIndex((m) => CREATE.test(m)) + 1;

const open = async (authEnabled = false): Promise<{ app: FastifyInstance; coord: CoordStore; db: DatabaseSync }> => {
  const home = mkTmp('ccrc-face-');
  const base = testDeps(home);
  const db = openCoordDb(path.join(home, '.ccrc', 'coord.db'));
  const coord = new CoordStore(db);
  const deps: Deps = { ...base, cfg: { ...base.cfg, authEnabled }, coord };
  const app = await buildServer(deps);
  await app.ready();
  return { app, coord, db };
};

describe('the character choice: one row, two routes', () => {
  it('a new database reads the Orb', async () => {
    const { app, coord } = await open();
    const res = await app.inject({ method: 'GET', url: '/api/face' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ character: DEFAULT_CHARACTER, updatedAt: 0 });
    expect(coord.faceSettings()).toEqual({ character: 'orb', updatedAt: 0 });
    await app.close();
  });

  it('a POST is read back by a GET', async () => {
    const { app } = await open();
    const post = await app.inject({ method: 'POST', url: '/api/face', payload: { character: 'dark-lord' } });
    expect(post.statusCode).toBe(200);
    const body = post.json() as { character: string; updatedAt: number };
    expect(body.character).toBe('dark-lord');
    expect(body.updatedAt).toBeGreaterThan(0);
    const get = await app.inject({ method: 'GET', url: '/api/face' });
    expect(get.json()).toEqual(body);
    await app.close();
  });

  it('an unknown word is refused bad-request and changes nothing', async () => {
    const { app } = await open();
    for (const payload of [{ character: 'cat' }, {}, { character: 7 }]) {
      const res = await app.inject({ method: 'POST', url: '/api/face', payload });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toBe('bad-request');
    }
    const get = await app.inject({ method: 'GET', url: '/api/face' });
    expect(get.json()).toEqual({ character: 'orb', updatedAt: 0 });
    await app.close();
  });

  it('a word a newer build wrote reads as the Orb', async () => {
    const { app, db, coord } = await open();
    db.prepare("UPDATE face_settings SET character = 'cat', updatedAt = 5 WHERE id = 1").run();
    expect(coord.faceSettings().character).toBe('orb');
    const get = await app.inject({ method: 'GET', url: '/api/face' });
    expect((get.json() as { character: string }).character).toBe('orb');
    await app.close();
  });

  it('a lost row reads the Orb and a write puts it back', async () => {
    const { app, db, coord } = await open();
    db.prepare('DELETE FROM face_settings').run();
    expect(coord.faceSettings()).toEqual({ character: 'orb', updatedAt: 0 });
    coord.setFaceCharacter('dark-lord', 9);
    expect(coord.faceSettings()).toEqual({ character: 'dark-lord', updatedAt: 9 });
    await app.close();
  });

  it('armed, both routes need a session', async () => {
    const { app } = await open(true);
    expect((await app.inject({ method: 'GET', url: '/api/face' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/face', payload: { character: 'orb' } })).statusCode).toBe(401);
    await app.close();
  });
});

describe('the migration is a new table and a seed, nothing else', () => {
  it('the entry creates face_settings once and seeds (1, orb, 0)', () => {
    expect(SLOT, 'no MIGRATIONS entry creates face_settings').toBeGreaterThanOrEqual(66);
    expect(MIGRATIONS.filter((m) => CREATE.test(m)).length).toBe(1);
    expect(MIGRATIONS[SLOT - 1]!.trim()).toMatch(
      /^CREATE TABLE face_settings \([^;]*\);\s*INSERT INTO face_settings \(id, character, updatedAt\)\s*VALUES \(1, 'orb', 0\);$/);
    const p = path.join(mkTmp('ccrc-mig-face-'), '.ccrc', 'coord.db');
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
      raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
    });
    raw.close();
    const db = openCoordDb(p);
    expect(db.prepare('SELECT id, character, updatedAt FROM face_settings').all()).toEqual([{ id: 1, character: 'orb', updatedAt: 0 }]);
    db.close();
  });
});
