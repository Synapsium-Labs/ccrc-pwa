// Programme lifecycle W1, task 3: migration 125 (spec §13), from the previous version's fixture. Neutral slugs only.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { MIGRATIONS } from '../src/coord/schema.js';
import { openCoordDb } from '../src/coord/db.js';
import { mkTmp } from './tmpHelpers.js';
import { LINEAR_SYNC_PROGRAMME } from '../../shared/plan.js';
import { PROGRAMME_STORED_STATES, PROGRAMME_EVENT_EDGES, PROGRAMME_ACTOR_KINDS, PROGRAMME_MIGRATION_RULES } from '../../shared/programmeLifecycle.js';

const LIFECYCLE = MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE programme_events'));

/** A database at the version before the lifecycle migration, with `seed` run on it, then migrated to the newest. */
function migrate(seed: (db: DatabaseSync) => void): DatabaseSync {
  const file = path.join(mkTmp('ccrc-lifecycle-mig-'), '.ccrc', 'coord.db');
  const pre = openCoordDbAt(file, LIFECYCLE);
  seed(pre);
  pre.close();
  return openCoordDb(file);
}
function openCoordDbAt(file: string, version: number): DatabaseSync {
  // A fresh file with the first `version` migrations, as an older build left it.
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  for (let v = 0; v < version; v++) { db.exec('BEGIN'); db.exec(MIGRATIONS[v]!); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec('COMMIT'); }
  return db;
}

const prog = (db: DatabaseSync, slug: string, state: string, planEnd: string | null = null): void => {
  db.prepare('INSERT INTO programs (slug, title, createdAt, state, planEnd) VALUES (?, ?, 1000, ?, ?)').run(slug, slug, state, planEnd);
};
let nextRun = 0;
const run = (db: DatabaseSync, program: string, state: string, claimedBy: string | null): void => {
  db.prepare('INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES (?, ?, NULL, ?, ?, ?, 1)')
    .run(program, ++nextRun, 'project-a', state, claimedBy);
};
const stateOf = (db: DatabaseSync, slug: string) =>
  db.prepare('SELECT state, planEnd, coordinator, coordinatorUuid FROM programs WHERE slug = ?').get(slug) as
    { state: string; planEnd: string | null; coordinator: string | null; coordinatorUuid: string | null };
const events = (db: DatabaseSync, slug: string) =>
  db.prepare('SELECT edge, fromState, toState, actorKind, actor, session, sessionUuid, detail FROM programme_events WHERE program = ? ORDER BY id')
    .all(slug) as { edge: string; fromState: string | null; toState: string | null; actorKind: string; actor: string;
      session: string | null; sessionUuid: string | null; detail: string | null }[];
const rule = (e: { detail: string | null }) => (e.detail === null ? null : (JSON.parse(e.detail) as { rule?: string }).rule ?? null);

describe('migration 125: the programme lifecycle', () => {
  it('is the last entry, and it is found', () => {
    expect(LIFECYCLE).toBeGreaterThan(0);
    expect(LIFECYCLE).toBe(MIGRATIONS.length - 1);
  });

  it('step 4: a D-51 done over an open run becomes active; with no open run it is kept and recorded', () => {
    const db = migrate((d) => {
      prog(d, 'programme-a', 'done'); run(d, 'programme-a', 'planned', 'lane-a-one');
      prog(d, 'programme-b', 'done'); run(d, 'programme-b', 'done', 'lane-a-two');
    });
    expect(stateOf(db, 'programme-a').state).toBe('active');
    expect(events(db, 'programme-a').filter((e) => e.edge === 'migrated').map(rule)).toEqual(['ended-over-open-runs']);
    expect(stateOf(db, 'programme-b').state).toBe('done');
    expect(events(db, 'programme-b').filter((e) => e.edge === 'migrated').map(rule)).toEqual(['auto-retire-kept']);
  });

  it('step 4: a set planEnd is the decision, both ways', () => {
    const db = migrate((d) => {
      prog(d, 'programme-a', 'done', 'abandoned');
      prog(d, 'programme-b', 'abandoned', 'done');
    });
    expect(stateOf(db, 'programme-a').state).toBe('abandoned');
    expect(stateOf(db, 'programme-b').state).toBe('done');
    expect(events(db, 'programme-a').filter((e) => e.edge === 'migrated').map(rule)).toEqual(['plan-end']);
  });

  it('paused, unknown and an out-of-vocabulary value are untouched; the reserved row is skipped; one started event per row', () => {
    const db = migrate((d) => {
      prog(d, 'programme-a', 'paused'); prog(d, 'programme-b', 'unknown'); prog(d, 'programme-c', 'archived');
    });
    expect(['programme-a', 'programme-b', 'programme-c'].map((s) => stateOf(db, s).state)).toEqual(['paused', 'unknown', 'archived']);
    for (const s of ['programme-a', 'programme-b', 'programme-c']) {
      expect(events(db, s).filter((e) => e.edge === 'started')).toHaveLength(1);
      expect(events(db, s).filter((e) => e.edge === 'migrated')).toHaveLength(0);
    }
    expect(events(db, LINEAR_SYNC_PROGRAMME)).toEqual([]);
    expect(stateOf(db, LINEAR_SYNC_PROGRAMME).state).toBe('paused');
  });

  it('step 3: an unambiguous pair binds with a null uuid; none for a programme step 4 leaves ended', () => {
    const db = migrate((d) => {
      prog(d, 'programme-a', 'active'); run(d, 'programme-a', 'working', 'lane-a-one'); run(d, 'programme-a', 'planned', 'lane-a-one');
      prog(d, 'programme-b', 'done', 'done'); run(d, 'programme-b', 'planned', 'lane-a-two');
    });
    expect(stateOf(db, 'programme-a')).toMatchObject({ coordinator: 'lane-a-one', coordinatorUuid: null });
    expect(events(db, 'programme-a').filter((e) => e.edge === 'coordinator').map((e) => [e.session, e.sessionUuid, e.actorKind]))
      .toEqual([['lane-a-one', null, 'migration']]);
    expect(stateOf(db, 'programme-b')).toMatchObject({ state: 'done', coordinator: null });
  });

  it('step 3: a live programme with no open run seeds the claimant main admits; a past claimant of two is named, not bound', () => {
    const db = migrate((d) => {
      prog(d, 'programme-a', 'active'); run(d, 'programme-a', 'done', 'lane-a-one');
      prog(d, 'programme-b', 'paused'); run(d, 'programme-b', 'done', 'lane-a-two');
      prog(d, 'programme-c', 'active'); run(d, 'programme-c', 'done', 'lane-a-two');
    });
    expect(stateOf(db, 'programme-a').coordinator).toBe('lane-a-one');
    expect(stateOf(db, 'programme-b').coordinator).toBeNull();
    expect(stateOf(db, 'programme-c').coordinator).toBeNull();
    expect(events(db, 'programme-b').filter((e) => e.edge === 'migrated').map((e) => [rule(e), e.session]))
      .toEqual([['past-claimant-in-several', 'lane-a-two']]);
  });

  it('step 3: a session claiming open runs in two programmes binds to neither; a programme with two claimants binds to none', () => {
    const db = migrate((d) => {
      prog(d, 'programme-a', 'active'); run(d, 'programme-a', 'working', 'lane-a-one');
      prog(d, 'programme-b', 'active'); run(d, 'programme-b', 'planned', 'lane-a-one');
      prog(d, 'programme-c', 'active'); run(d, 'programme-c', 'working', 'lane-a-two'); run(d, 'programme-c', 'working', 'lane-a-three');
    });
    for (const s of ['programme-a', 'programme-b', 'programme-c']) expect(stateOf(db, s).coordinator).toBeNull();
    expect(events(db, 'programme-a').filter((e) => e.edge === 'migrated').map((e) => [rule(e), e.session, e.sessionUuid]))
      .toEqual([['session-in-several', 'lane-a-one', null]]);
    expect(events(db, 'programme-c').filter((e) => e.edge === 'migrated').map((e) => [rule(e), e.session]))
      .toEqual([['programme-several-claimants', 'lane-a-three'], ['programme-several-claimants', 'lane-a-two']]);
  });

  it('creates no programme_members table, and the partial unique index refuses a second binding of one incarnation', () => {
    const db = migrate((d) => { prog(d, 'programme-a', 'active'); prog(d, 'programme-b', 'active'); });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'programme_members'").get()).toBeUndefined();
    db.prepare("UPDATE programs SET coordinator = 'lane-a-one' WHERE slug = 'programme-a'").run();
    expect(() => db.prepare("UPDATE programs SET coordinator = 'lane-a-one' WHERE slug = 'programme-b'").run()).toThrow(/UNIQUE/);
  });

  it('holds no string literal that could be a slug: every quoted word is vocabulary or the reserved row', () => {
    const sql = MIGRATIONS[LIFECYCLE]!;
    const words = new Set<string>([...PROGRAMME_STORED_STATES, ...PROGRAMME_EVENT_EDGES, ...PROGRAMME_ACTOR_KINDS,
      ...PROGRAMME_MIGRATION_RULES, LINEAR_SYNC_PROGRAMME, 'unmeasured', 'failed', 'rule', 'others', 'now', '']);
    const literals = [...sql.replace(/''/g, '').matchAll(/'([^']*)'/g)].map((m) => m[1]!);
    const slugLike = literals.filter((l) => /^[a-z0-9][a-z0-9-]*$/.test(l) && !words.has(l));
    expect(slugLike).toEqual([]);
  });
});
