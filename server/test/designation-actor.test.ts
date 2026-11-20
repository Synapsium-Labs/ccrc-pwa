// Overlord W1, gates A (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-gates.md` Task 3; spec §3.6 H3, §7.4 C27):
// the designation row's actor columns. Its kind, issuer and strength sit beside the subject `actor` and `pendingActor` already
// held; the writers take a `RecordedActor` only, minted by the identity port for the operator at `operator` strength; every
// pending clear nulls the four pending actor columns together; and `designationRead()` answers `unmeasured` for a half actor.
// Over a coord db opened through the real migrations and a fake authority appender (the store suite's shape).
import { describe, it, expect, afterEach, afterAll, beforeAll, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { COORD_SCHEMA_VERSION, openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import {
  designatePending, designationRead, failPending, goLive, retire, setModelClass, setAccountSet, type AuthorityAppender,
} from '../src/coord/overlordDesignationStore.js';
import type { AuthorityAppend } from '../src/coord/overlordAuthorityJournal.js';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import type { RecordedActor } from '../src/auth/callerIdentity.js';
import { ACTOR_ISSUER_MAP, ACTOR_KIND_MAP, CALLER_STRENGTH_MAP } from '../../shared/overlord-identity.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

// The shared predicate's kind and strength checks sit behind provenance. A test-only brand admits TRUSTED objects
// at its WeakSet lookup, while the real shared predicate still checks every authority term and all other provenance.
const { TRUSTED } = vi.hoisted(() => ({ TRUSTED: new WeakSet<object>() }));
vi.mock('../src/auth/attributionIdentity.js', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/auth/attributionIdentity.js')>();
  return { ...m, isAccountGateOperator: (a: unknown): boolean => {
    const original = WeakSet.prototype.has;
    const lookup = vi.spyOn(WeakSet.prototype, 'has').mockImplementation(function (this: WeakSet<object>, value: object) {
      return (value === a && original.call(TRUSTED, value)) || original.call(this, value);
    });
    try { return m.isAccountGateOperator(a); } finally { lookup.mockRestore(); }
  } };
});

let template = '';
const opened: DatabaseSync[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-designation-actor-template-'), 'coord.db');
  openCoordDb(template).close();
});
afterEach(() => { for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } } });
afterAll(() => removeTmpFixtures());

const NOW = 1_800_000_000_000;
const A = 'overlord-quiet-otter';
const GEN = '11111111-2222-3333-4444-555555555555';
const openDb = (): DatabaseSync => {
  const dir = path.join(mkTmp('ccrc-designation-actor-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  copyFileSync(template, path.join(dir, 'coord.db'));
  const db = openCoordDb(path.join(dir, 'coord.db'));
  opened.push(db);
  return db;
};
const APPENDED = { ok: true, kind: 'appended', record: {} } as unknown as AuthorityAppend;
const journal: AuthorityAppender = { appendInTx: () => APPENDED };

const identity = attributionIdentity({
  attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }),
});
const OPERATOR = identity.operator(gateActorOf('device-a', 'abcdef0123456789'));
const RETIRER = identity.operator(gateActorOf('device-b', '0123456789abcdef'));

const des = (db: DatabaseSync, actor: RecordedActor = OPERATOR): ReturnType<typeof designatePending> =>
  designatePending(db, journal, { sessionId: A, deadlineAt: NOW + 60_000, model: 'opus', accountPools: { pools: ['pool-a'], untagged: false },
    actor, at: NOW, opKey: 'op-designate-1' });
const LIVE_COLS = ['actor', 'actorKind', 'actorIssuer', 'actorStrength'] as const;
const PENDING_COLS = ['pendingActor', 'pendingActorKind', 'pendingActorIssuer', 'pendingActorStrength'] as const;
const cols = (db: DatabaseSync, names: readonly string[]): unknown[] => {
  const r = db.prepare('SELECT * FROM overlord_designation WHERE id = 1').get() as Record<string, unknown>;
  return names.map((n) => r[n]);
};
const four = (a: RecordedActor): string[] => [a.subject, a.kind, a.issuer, a.strength];

describe('the migration', () => {
  const SLOT = MIGRATIONS.findIndex((m) => /ADD COLUMN actorKind\b/.test(m)) + 1;
  const SQL = MIGRATIONS[SLOT - 1] ?? '';

  it('is one entry of six ADD COLUMNs on overlord_designation, after the table it alters', () => {
    expect(SLOT).toBeGreaterThan(MIGRATIONS.findIndex((m) => /CREATE TABLE overlord_designation\b/.test(m)) + 1);
    expect(MIGRATIONS.filter((m) => /ADD COLUMN actorKind\b/.test(m)).length).toBe(1);
    expect([...SQL.matchAll(/ALTER TABLE overlord_designation ADD COLUMN (\w+)/g)].map((x) => x[1])).toEqual([
      'actorKind', 'actorIssuer', 'actorStrength', 'pendingActorKind', 'pendingActorIssuer', 'pendingActorStrength',
    ]);
  });

  it('a row written before it reads operator, account-gate and operator, and a standing pending actor is filled the same', () => {
    const p = path.join(mkTmp('ccrc-designation-actor-mig-'), '.ccrc', 'coord.db');
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
      raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
      raw.exec(`INSERT INTO overlord_designation (id, sessionId, generation, pendingId, pendingKind, pendingSince, pendingDeadlineAt, pendingActor,
        term, designatedTerm, model, accountPools, actor, updatedAt) VALUES (1, 'overlord-old-owl', 'g1', 'overlord-new-owl', 'rebind', 1, 2,
        'device-a abcdef01', 1, 1, 'opus', '{"pools":[],"untagged":false}', 'device-a abcdef01', 1)`);
    });
    raw.close();
    const db = openCoordDb(p);
    opened.push(db);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(COORD_SCHEMA_VERSION);
    expect(cols(db, LIVE_COLS)).toEqual(['device-a abcdef01', 'operator', 'account-gate', 'operator']);
    expect(cols(db, PENDING_COLS)).toEqual(['device-a abcdef01', 'operator', 'account-gate', 'operator']);
    const read = designationRead(db);
    expect(read).toMatchObject({ kind: 'designated', row: {
      actor: 'device-a abcdef01', actorDetail: { kind: 'operator', subject: 'device-a abcdef01', issuer: 'account-gate', strength: 'operator' },
      pending: { actorDetail: { kind: 'operator', subject: 'device-a abcdef01', issuer: 'account-gate', strength: 'operator' } },
    } });
  });

  it('a row with no pending attempt keeps its three pending actor columns null', () => {
    const db = openDb();
    expect(des(db).ok).toBe(true);
    expect(goLive(db, journal, A, GEN, NOW + 1)).toMatchObject({ ok: true, changed: true });
    expect(cols(db, PENDING_COLS)).toEqual([null, null, null, null]);
  });

  it('each CHECK list is its L0 map\'s keys, live and pending', () => {
    const listOf = (col: string): string[] => {
      const m = new RegExp(`${col} IN \\(([^)]*)\\)`).exec(SQL);
      expect(m, col).not.toBeNull();
      return [...m![1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
    };
    for (const [col, map] of [['actorKind', ACTOR_KIND_MAP], ['actorIssuer', ACTOR_ISSUER_MAP], ['actorStrength', CALLER_STRENGTH_MAP],
      ['pendingActorKind', ACTOR_KIND_MAP], ['pendingActorIssuer', ACTOR_ISSUER_MAP], ['pendingActorStrength', CALLER_STRENGTH_MAP]] as const) {
      expect(listOf(col).sort(), col).toEqual(Object.keys(map).sort());
    }
  });

  it('the database refuses a word outside a CHECK list', () => {
    const db = openDb();
    expect(des(db).ok).toBe(true);
    expect(() => db.exec("UPDATE overlord_designation SET actorStrength = 'trusted'")).toThrow();
    expect(() => db.exec("UPDATE overlord_designation SET pendingActorKind = 'robot'")).toThrow();
  });
});

describe('the writers take a RecordedActor and write its four columns together', () => {
  it('designate writes the pending actor and the row actor from the gate\'s actor', () => {
    const db = openDb();
    expect(des(db)).toEqual({ ok: true, changed: true });
    expect(cols(db, PENDING_COLS)).toEqual(four(OPERATOR));
    expect(cols(db, LIVE_COLS)).toEqual(four(OPERATOR));
    expect(designationRead(db)).toMatchObject({ kind: 'not-designated', row: {
      actor: OPERATOR.subject, actorDetail: { ...OPERATOR }, pending: { actor: OPERATOR.subject, actorDetail: { ...OPERATOR } },
    } });
  });

  it('goLive copies the attempt\'s actor onto the binding and nulls the four pending columns', () => {
    const db = openDb();
    expect(des(db).ok).toBe(true);
    db.exec("UPDATE overlord_designation SET actor = 'someone else', actorIssuer = 'server'"); // the binding's columns before go-live
    expect(goLive(db, journal, A, GEN, NOW + 1)).toMatchObject({ ok: true, changed: true });
    expect(cols(db, LIVE_COLS)).toEqual(four(OPERATOR));
    expect(cols(db, PENDING_COLS)).toEqual([null, null, null, null]);
  });

  it('failPending leaves the four pending columns null', () => {
    const db = openDb();
    expect(des(db).ok).toBe(true);
    expect(failPending(db, A, 'create-failed', NOW + 1, false)).toEqual({ ok: true, changed: true });
    expect(cols(db, PENDING_COLS)).toEqual([null, null, null, null]);
    expect(designationRead(db)).toMatchObject({ kind: 'not-designated', row: { pending: null } });
  });

  it('retire\'s cancel of a pending attempt leaves the four pending columns null and records the retiring actor', () => {
    const db = openDb();
    expect(des(db).ok).toBe(true);
    expect(retire(db, journal, { actor: RETIRER, at: NOW + 1, opKey: 'op-retire-1' })).toMatchObject({ ok: true, changed: true });
    expect(cols(db, PENDING_COLS)).toEqual([null, null, null, null]);
    expect(cols(db, LIVE_COLS)).toEqual(four(RETIRER));
  });

  it('retire of a live binding with a pending attempt records its own actor and nulls the pending columns', () => {
    const db = openDb();
    expect(des(db).ok).toBe(true);
    expect(goLive(db, journal, A, GEN, NOW + 1)).toMatchObject({ ok: true, changed: true });
    db.exec(`UPDATE overlord_designation SET pendingId = 'overlord-new-owl', pendingKind = 'rebind', pendingSince = 2, pendingDeadlineAt = 3,
      pendingActor = 'device-a abcdef01', pendingActorKind = 'operator', pendingActorIssuer = 'account-gate', pendingActorStrength = 'operator'`);
    expect(retire(db, journal, { actor: RETIRER, at: NOW + 2, opKey: 'op-retire-1' })).toMatchObject({ ok: true, changed: true, term: 2 });
    expect(cols(db, LIVE_COLS)).toEqual(four(RETIRER));
    expect(cols(db, PENDING_COLS)).toEqual([null, null, null, null]);
  });
});

describe('a writer refuses an actor the port did not mint for the operator', () => {
  const literal = { ...OPERATOR } as unknown as RecordedActor; // structurally equal, never minted
  it('designatePending and retire answer `actor` and write nothing, for a literal', () => {
    const db = openDb();
    expect(des(db, literal)).toEqual({ ok: false, reason: 'actor' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM overlord_designation').get()).toEqual({ n: 0 });
    expect(des(db).ok).toBe(true);
    const before = db.prepare('SELECT * FROM overlord_designation').get();
    expect(retire(db, journal, { actor: literal, at: NOW + 1, opKey: 'k' })).toEqual({ ok: false, reason: 'actor' });
    expect(db.prepare('SELECT * FROM overlord_designation').get()).toEqual(before);
  });

  it('designatePending and retire answer `actor` for a session\'s attributed actor (kind and strength both wrong)', async () => {
    const caller = await identity.session('lane-a-project-a', 'uuid-a', 'byUuid');
    if (!caller.ok) throw new Error('the fake attribution passes');
    const db = openDb();
    expect(des(db, caller.actor)).toEqual({ ok: false, reason: 'actor' });
    expect(retire(db, journal, { actor: caller.actor, at: NOW + 1, opKey: 'k' })).toEqual({ ok: false, reason: 'actor' });
  });

  it('designatePending and retire refuse a minted console actor and write nothing: issuer must be account-gate', () => {
    const caller = identity.console(true, 'device-a');
    if (caller.kind !== 'signed-in') throw new Error('the console has a measured device');
    const db = openDb();
    expect(des(db, caller.actor)).toEqual({ ok: false, reason: 'actor' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM overlord_designation').get()).toEqual({ n: 0 });
    expect(des(db).ok).toBe(true);
    const before = db.prepare('SELECT * FROM overlord_designation').get();
    expect(retire(db, journal, { actor: caller.actor, at: NOW + 1, opKey: 'k' })).toEqual({ ok: false, reason: 'actor' });
    expect(db.prepare('SELECT * FROM overlord_designation').get()).toEqual(before);
  });

  it('past the brand, the kind must be operator and the strength operator: each check refuses on its own', () => {
    const trusted = (over: Partial<RecordedActor>): RecordedActor => {
      const a = Object.freeze({ ...OPERATOR, ...over }) as RecordedActor;
      TRUSTED.add(a);
      return a;
    };
    const control = trusted({});
    const db = openDb();
    expect(des(db, trusted({ kind: 'session' }))).toEqual({ ok: false, reason: 'actor' });
    expect(des(db, trusted({ kind: 'server' }))).toEqual({ ok: false, reason: 'actor' });
    expect(des(db, trusted({ strength: 'attributed' }))).toEqual({ ok: false, reason: 'actor' });
    expect(des(db, trusted({ strength: 'workload' }))).toEqual({ ok: false, reason: 'actor' });
    expect(retire(db, journal, { actor: trusted({ kind: 'session' }), at: NOW, opKey: 'k' })).toEqual({ ok: false, reason: 'actor' });
    expect(retire(db, journal, { actor: trusted({ strength: 'attributed' }), at: NOW, opKey: 'k' })).toEqual({ ok: false, reason: 'actor' });
    // CONTROL: the same object with both checks met passes, so each refusal above is its check's, never the brand's.
    expect(des(db, control)).toEqual({ ok: true, changed: true });
  });
});

describe.each([
  { name: 'setModelClass', write: (db: DatabaseSync, j: AuthorityAppender, actor: RecordedActor) =>
    setModelClass(db, j, { model: 'fable', actor, at: NOW + 1, opKey: 'set-model' }) },
  { name: 'setAccountSet', write: (db: DatabaseSync, j: AuthorityAppender, actor: RecordedActor) =>
    setAccountSet(db, j, { accountPools: { pools: ['pool-b'], untagged: true }, actor, at: NOW + 1, opKey: 'set-pools' }) },
])('$name through the second-lander actor contract', ({ write }) => {
  it.each(['brand', 'kind', 'strength', 'issuer'] as const)('refuses the wrong %s before any journal or row write', (axis) => {
    const consoleCaller = identity.console(true, 'device-a');
    if (consoleCaller.kind !== 'signed-in') throw new Error('a measured console actor');
    const copy = Object.freeze({ ...RETIRER, ...(axis === 'kind' ? { kind: 'session' as const } : {}),
      ...(axis === 'strength' ? { strength: 'attributed' as const } : {}) }) as RecordedActor;
    if (axis === 'kind' || axis === 'strength') TRUSTED.add(copy);
    const actor = axis === 'issuer' ? consoleCaller.actor : copy;
    const db = openDb();
    expect(des(db).ok).toBe(true);
    const before = db.prepare('SELECT * FROM overlord_designation').get();
    let appends = 0;
    const counting: AuthorityAppender = { appendInTx: () => { appends++; return APPENDED; } };
    expect(write(db, counting, actor)).toEqual({ ok: false, reason: 'actor' });
    expect(appends).toBe(0);
    expect(db.prepare('SELECT * FROM overlord_designation').get()).toEqual(before);
  });
  it('writes all four live columns from the minted actor, not prior metadata', () => {
    const db = openDb();
    expect(des(db).ok).toBe(true);
    db.exec("UPDATE overlord_designation SET actorKind = 'server', actorIssuer = 'server', actorStrength = 'attributed'");
    expect(write(db, journal, RETIRER)).toMatchObject({ ok: true, changed: true });
    expect(cols(db, LIVE_COLS)).toEqual(four(RETIRER));
    expect(cols(db, PENDING_COLS)).toEqual(four(OPERATOR));
  });
});

describe('designationRead never answers a half actor', () => {
  const fill = (db: DatabaseSync): void => { expect(des(db).ok).toBe(true); };
  it.each(PENDING_COLS.slice(1).map((c) => [c]))('a pending attempt with %s null reads unmeasured', (col) => {
    const db = openDb();
    fill(db);
    db.exec(`UPDATE overlord_designation SET ${col} = NULL`);
    expect(designationRead(db)).toMatchObject({ kind: 'unmeasured' });
  });
  it('a pending subject standing with no pending attempt reads unmeasured', () => {
    const db = openDb();
    fill(db);
    expect(failPending(db, A, 'create-failed', NOW + 1, false).ok).toBe(true);
    db.exec("UPDATE overlord_designation SET pendingActor = 'device-a abcdef01'");
    expect(designationRead(db)).toMatchObject({ kind: 'unmeasured' });
  });
  it('an old-build pending clear leaves metadata behind but the new build reads cleared and can designate again', () => {
    const db = openDb();
    fill(db);
    // The old build knows only these pending columns; its clear never names the three additive metadata columns.
    db.exec(`UPDATE overlord_designation SET pendingId = NULL, pendingGeneration = NULL, pendingKind = NULL,
      pendingSince = NULL, pendingDeadlineAt = NULL, pendingActor = NULL`);
    expect(cols(db, PENDING_COLS)).toEqual([null, 'operator', 'account-gate', 'operator']);
    expect(designationRead(db)).toMatchObject({ kind: 'not-designated', row: { pending: null } });
    expect(des(db, RETIRER)).toEqual({ ok: true, changed: true });
    expect(cols(db, PENDING_COLS)).toEqual(four(RETIRER));
  });
  it.each(PENDING_COLS.slice(1).map((c) => [c]))('a cleared pending slot ignores stale %s metadata', (col) => {
    const db = openDb();
    fill(db);
    expect(failPending(db, A, 'create-failed', NOW + 1, false).ok).toBe(true);
    const value: Record<string, string> = {
      pendingActorKind: 'operator', pendingActorIssuer: 'session-cookie', pendingActorStrength: 'attributed',
    };
    db.exec(`UPDATE overlord_designation SET ${col} = '${value[col]!}'`);
    expect(designationRead(db)).toMatchObject({ kind: 'not-designated', row: { pending: null } });
  });
  it('a live actor whose strength column holds a word the reader does not know reads unmeasured', () => {
    const db = openDb();
    fill(db);
    db.exec('PRAGMA ignore_check_constraints = ON');
    db.exec("UPDATE overlord_designation SET actorStrength = 'trusted'");
    expect(designationRead(db)).toMatchObject({ kind: 'unmeasured' });
  });
});
