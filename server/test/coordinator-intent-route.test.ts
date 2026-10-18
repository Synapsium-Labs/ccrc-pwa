// Delegation broker wave 3, Task 15: the explicit coordinator-intent declaration (spec 2026-10-04 §5.1; plan Task 15 steps 1, 6;
// W3-M55 and W3-M56). `POST /api/coordinators/:session/intent` lets a session say, once and durably, that it is about to delegate
// (`set`) or that it has stopped (`clear`). It is IDENTITY, never a restriction: it changes no lease, carrier or cleanup state, and
// it creates no run, hold or capacity slot.
//
// THE DECLARATION LIVES IN THE CHECKPOINT. The route mutates `DelegationSessionRow.explicitIntentAt` (and the effective basis) of the
// CURRENT incarnation's row through the lane's own `DelegationDurability.applyCheckpointChange`, which rebuilds
// `coordinatorIntentByParent` from the rows in the same replacement. SQLite is repairable output: nothing here reads it back as
// authority, and a projection that fails cannot take a declaration with it.
//
// Every directory here is a FIXTURE home: nothing reads or writes the live `~/.ccrc` or `~/.cc-sessions`, no ccd verb runs, and the
// box token is a test constant.
//
//   W3-M55 (A declares for B; a declaration visible before it is durable) -> 'who may declare' and 'durability' rows
//   W3-M56 (clear drops another basis; SQLite as the authority)           -> 'clear' and 'SQLite' rows
import { afterEach, describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { Bus } from '../src/bus.js';
import { buildServer, type Deps } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import { localIO, type FleetIO } from '../src/io.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  DELEGATION_CHECKPOINT_FILE,
  DelegationDurability,
  decodeDelegationCheckpoint,
  type DelegationDurabilityDeps,
  type DelegationProjectionPort,
} from '../src/coord/delegation-checkpoint.js';
import {
  COORDINATOR_INTENT_ACTIONS,
  declareCoordinatorIntent,
  delegationIntentKey,
  deriveCoordinatorIntentByParent,
  emptyDelegationCheckpoint,
  formatDelegationInstant,
  type DelegationCheckpointV1,
  type DelegationSessionRow,
} from '../src/coord/delegation-model.js';
import type { DelegationIntentSource } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };
const A = { id: 'demo-quiet-mesa', uuid: 'a'.repeat(36) };
const B = { id: 'demo-still-pond', uuid: 'b'.repeat(36) };
const GEN1 = '0189abcd-1234-4678-9abc-0123456789ab';
const GEN2 = '7f3c9a10-5555-4aaa-8bbb-0123456789cd';
const OLD_GEN = '3a3a3a3a-0000-4000-8000-0123456789ab';
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const url = (session: string): string => `/api/coordinators/${session}/intent`;
const bodyOf = (action: string, who: { id: string; uuid: string } = A): Record<string, unknown> => ({ action, byId: who.id, byUuid: who.uuid });

/** One registry row, and its generation (the parent's incarnation, `$REG/<id>.generation`). */
const seed = (home: string, who: { id: string; uuid: string }, generation: string | null = GEN1): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/demo/${who.id}`, uuid: who.uuid, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${who.id}.${k}`), v);
  if (generation !== null) writeFileSync(path.join(reg, `${who.id}.generation`), generation);
};

interface World {
  home: string;
  /** The coordination directory the lane's applier writes into. */
  dir: string;
  app: FastifyInstance;
  coord: CoordStore;
  db: DatabaseSync;
  durable: DelegationDurability;
  /** The real watcher, when this world has one; null for a stand-in that hands the route a fault-injected applier. */
  watcher: FleetWatcher | null;
}
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close().catch(() => undefined)));
});

interface WorldOptions {
  over?: Partial<Deps>;
  /** A fault-injected applier handed to the route through a stand-in watcher, so an edge can be made to fail. */
  faults?: {
    onEdge?: DelegationDurabilityDeps['onEdge'];
    projection?: (real: DelegationProjectionPort) => DelegationProjectionPort;
    /** The stand-in watcher the route is handed, built from the applier this world opened (default: one that returns it). */
    watcher?: (durable: DelegationDurability) => unknown;
  };
  seeded?: boolean;
}

/** A server over a fixture home. Without `faults` the route reaches the REAL watcher's lane instance (the one the production
 *  lane opens); with them it reaches a stand-in whose applier the test built, which is the only way to fail an edge. */
async function world(opts: WorldOptions = {}): Promise<World> {
  const home = mkTmp('ccrc-intent-');
  if (opts.seeded !== false) { seed(home, A); seed(home, B); }
  const base = testDeps(home);
  const db = openCoordDb(path.join(home, '.ccrc', 'coord.db'));
  const coord = new CoordStore(db);
  const deps: Deps = { ...base, mailToken: TOKEN, coord, ...opts.over };
  const dir = deps.cfg.ccrcDir;
  const bus = new Bus();
  if (opts.faults === undefined) {
    const watcher = new FleetWatcher(deps as never, bus, 10_000);
    const app = await buildServer(deps, bus, watcher);
    closers.push(() => app.close(), () => watcher.closeDelegation());
    const durable = await watcher.delegationApplier();
    expect(durable, 'the lane opened its applier').not.toBeNull();
    return { home, dir, app, coord, db, durable: durable!, watcher };
  }
  const real: DelegationProjectionPort = {
    project: (cp) => coord.projectDelegationCheckpoint(cp),
    insertEvents: (rows) => coord.insertDelegationEvents(rows),
    eventStats: () => coord.delegationEventStats(),
  };
  const durable = await DelegationDurability.open({
    dir, projection: opts.faults.projection === undefined ? real : opts.faults.projection(real),
    now: () => Date.now(), randomUUID: () => randomUUID(), ...(opts.faults.onEdge === undefined ? {} : { onEdge: opts.faults.onEdge }),
  });
  // `stop` is what `buildServer` calls when the app closes.
  const standIn = { stop: () => undefined, ...((opts.faults.watcher?.(durable) ?? { delegationApplier: () => Promise.resolve(durable) }) as object) } as unknown as FleetWatcher;
  const app = await buildServer(deps, bus, standIn);
  closers.push(() => app.close(), () => durable.close());
  return { home, dir, app, coord, db, durable, watcher: null };
}

const declare = (w: { app: FastifyInstance }, session: string, body: unknown, headers: Record<string, string> = tok) =>
  w.app.inject({
    method: 'POST', url: url(session), payload: body as Record<string, unknown>,
    // A raw string is sent AS JSON text, so it reaches the handler's own validation instead of the media-type refusal.
    headers: typeof body === 'string' ? { 'content-type': 'application/json', ...headers } : headers,
  });
const diskPath = (w: { dir: string }): string => path.join(w.dir, DELEGATION_CHECKPOINT_FILE);
const onDisk = (w: { dir: string }): DelegationCheckpointV1 => decodeDelegationCheckpoint(new Uint8Array(readFileSync(diskPath(w))));
const rowOf = (cp: { sessions: readonly DelegationSessionRow[] }, id: string, inc: string): DelegationSessionRow | undefined =>
  cp.sessions.find((s) => s.sessionId === id && s.parentIncarnation === inc);
/** The row an earlier incarnation left behind, planted through the lane's own checkpoint door. */
const plant = (w: World, rows: readonly DelegationSessionRow[]) =>
  w.durable.applyCheckpointChange((cp) => ({ ...cp, sessions: [...cp.sessions, ...rows], coordinatorIntentByParent: deriveCoordinatorIntentByParent([...cp.sessions, ...rows]) }));
const row = (id: string, inc: string, over: Partial<DelegationSessionRow> = {}): DelegationSessionRow => ({
  sessionId: id, parentIncarnation: inc, explicitIntentAt: null, effective: false, effectiveBasis: [], claudeSessionIds: [],
  firstObservedAt: '2026-10-14T09:00:00.000Z', lastObservedAt: '2026-10-14T09:30:00.000Z', ...over,
});

// ── the door ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('POST /api/coordinators/:session/intent: the door', () => {
  it('answers 501 not-configured with no coordination database, and with no delegation lane, BEFORE it asks for the token', async () => {
    const home = mkTmp('ccrc-intent-');
    seed(home, A);
    const noCoord = await buildServer({ ...testDeps(home), mailToken: TOKEN });
    closers.push(() => noCoord.close());
    for (const headers of [tok, {}]) {
      const res = await declare({ app: noCoord }, A.id, bodyOf('set'), headers);
      expect(res.statusCode, JSON.stringify(headers)).toBe(501);
      expect(res.json()).toMatchObject({ ok: false, error: 'not-configured' });
    }
    // A coordination database with NO watcher has no lane, so it has no applier to reach: the same answer.
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const noLane = await buildServer({ ...testDeps(home), mailToken: TOKEN, coord });
    closers.push(() => noLane.close());
    const res = await declare({ app: noLane }, A.id, bodyOf('set'));
    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-configured' });
    expect(existsSync(path.join(home, '.ccrc', DELEGATION_CHECKPOINT_FILE))).toBe(false);
  });

  it('refuses 401 without the box token, or with a wrong one, and writes nothing', async () => {
    const w = await world();
    for (const headers of [{}, { 'x-ccrc-mail-token': 'a'.repeat(64) }, { 'x-ccrc-mail-token': '' }] as Array<Record<string, string>>) {
      const res = await declare(w, A.id, bodyOf('set'), headers);
      expect(res.statusCode, JSON.stringify(headers)).toBe(401);
      expect(res.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
    }
    expect(existsSync(diskPath(w)), 'no checkpoint was written').toBe(false);
    expect(w.durable.state().checkpoint.sessions).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['no body at all', undefined],
    ['an array', [bodyOf('set')]],
    ['a JSON string', '"set"'],
    ['an unknown action', { ...bodyOf('toggle') }],
    ['an upper-case action', { ...bodyOf('SET') }],
    ['a numeric action', { ...bodyOf('set'), action: 1 }],
    ['a missing action', { byId: A.id, byUuid: A.uuid }],
    ['a missing byUuid', { action: 'set', byId: A.id }],
    ['a missing byId', { action: 'set', byUuid: A.uuid }],
    ['an EXTRA key', { ...bodyOf('set'), at: '2026-10-14T09:00:00.000Z' }],
    ['an extra key that tries to carry the instant', { ...bodyOf('set'), declaredAt: '2026-10-14T09:00:00.000Z' }],
    ['a numeric byId', { ...bodyOf('set'), byId: 7 }],
    ['an empty byUuid', { ...bodyOf('set'), byUuid: '' }],
    ['a byId that is not a session id', { ...bodyOf('set'), byId: '../x' }],
  ])('refuses 400 bad-request for %s, and writes nothing', async (_name, payload) => {
    const w = await world();
    const res = await declare(w, A.id, payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
    expect(existsSync(diskPath(w))).toBe(false);
  });

  it('knows exactly two actions, from one definition', () => {
    expect([...COORDINATOR_INTENT_ACTIONS]).toEqual(['set', 'clear']);
  });
});

// ── who may declare (W3-M55) ─────────────────────────────────────────────────────────────────────────────────────────────

describe('POST /api/coordinators/:session/intent: who may declare', () => {
  it('refuses 403 not-owner when byId is not the session in the path, even for a registered and fresh other session', async () => {
    const w = await world();
    // A is a real, fresh session. It may declare for A and for nobody else.
    const res = await declare(w, B.id, bodyOf('set', A));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-owner' });
    expect(existsSync(diskPath(w)), 'B was not given an intent by A').toBe(false);
    expect(w.durable.state().checkpoint.sessions).toEqual([]);
    // The same pair is accepted for its own session: the refusal above was the path, not the pair.
    expect((await declare(w, A.id, bodyOf('set', A))).statusCode).toBe(200);
  });

  it('refuses 403 stale-uuid when the byUuid is not the registry uuid, and writes nothing', async () => {
    const w = await world();
    const res = await declare(w, A.id, { ...bodyOf('set'), byUuid: 'c'.repeat(36) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'stale-uuid' });
    expect(existsSync(diskPath(w))).toBe(false);
  });

  it('refuses 403 unknown-sender for a session with no registry row, and writes nothing', async () => {
    const w = await world();
    const ghost = { id: 'demo-no-such-one', uuid: 'd'.repeat(36) };
    const res = await declare(w, ghost.id, bodyOf('set', ghost));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'unknown-sender' });
    expect(existsSync(diskPath(w))).toBe(false);
  });

  it('answers 502 registry-unmeasurable, not a fact about the sender, when the registry cannot be listed', async () => {
    const unlistable: FleetIO = { ...localIO, readdir: async () => null };
    const w = await world({ over: { io: unlistable } });
    const res = await declare(w, A.id, bodyOf('set'));
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    expect(existsSync(diskPath(w))).toBe(false);
  });
});

// ── the current incarnation, measured ────────────────────────────────────────────────────────────────────────────────────

describe('POST /api/coordinators/:session/intent: the incarnation', () => {
  it('declares for the registry incarnation read from <id>.generation, and for no other', async () => {
    const w = await world();
    const res = await declare(w, A.id, bodyOf('set'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, session: A.id, incarnation: GEN1 });
    expect(rowOf(onDisk(w), A.id, GEN1)).toBeDefined();
  });

  it.each<[string, string | null]>([
    ['absent', null],
    ['malformed', 'not-a-generation'],
    ['padded with a newline', `${GEN1}\n`],
  ])('answers 502 registry-unmeasurable when the generation is %s, and writes nothing', async (_name, generation) => {
    const w = await world({ seeded: false });
    seed(w.home, A, generation);
    const res = await declare(w, A.id, bodyOf('set'));
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    expect(existsSync(diskPath(w))).toBe(false);
  });

  it('answers 502 registry-unmeasurable when the generation CHANGES between the two reads', async () => {
    let reads = 0;
    const flipping: FleetIO = {
      ...localIO,
      readFileMeasured: async (p, t, s) => {
        const r = await localIO.readFileMeasured(p, t, s);
        if (p.endsWith(`${A.id}.generation`) && r.ok && ++reads === 2) return { ok: true, content: GEN2 };
        return r;
      },
    };
    const w = await world({ over: { io: flipping } });
    const res = await declare(w, A.id, bodyOf('set'));
    expect(reads, 'the generation was read twice').toBe(2);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    expect(existsSync(diskPath(w))).toBe(false);
  });

  it('touches only the CURRENT incarnation: an earlier one keeps its row, its intent and its bases, byte for byte', async () => {
    const w = await world();
    const old = row(A.id, OLD_GEN, { explicitIntentAt: '2026-10-14T09:10:00.000Z', effective: true, effectiveBasis: ['explicit', 'run-owner'] });
    await plant(w, [old]);
    const before = structuredClone(rowOf(w.durable.state().checkpoint, A.id, OLD_GEN));
    const set = await declare(w, A.id, bodyOf('set'));
    expect(set.statusCode).toBe(200);
    const cp = onDisk(w);
    expect(rowOf(cp, A.id, OLD_GEN), 'the earlier incarnation is untouched by a set').toEqual(before);
    const mine = rowOf(cp, A.id, GEN1)!;
    expect(mine.explicitIntentAt).toBe(set.json().explicitIntentAt);
    expect(mine.effectiveBasis).toEqual(['explicit']);
    const cleared = await declare(w, A.id, bodyOf('clear'));
    expect(cleared.statusCode).toBe(200);
    const after = onDisk(w);
    expect(rowOf(after, A.id, OLD_GEN), 'the earlier incarnation is untouched by a clear').toEqual(before);
    expect(rowOf(after, A.id, GEN1)!.explicitIntentAt).toBeNull();
  });
});

// ── set and clear ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('POST /api/coordinators/:session/intent: set and clear', () => {
  it('set declares intent: a canonical instant, the explicit basis, and the derived map, in the lane\'s own checkpoint', async () => {
    const w = await world();
    const lo = Date.now();
    const res = await declare(w, A.id, bodyOf('set'));
    const hi = Date.now();
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out).toMatchObject({ ok: true, action: 'set', session: A.id, incarnation: GEN1, changed: true, effective: true, effectiveBasis: ['explicit'], projection: 'projected', incarnationAfter: 'same' });
    expect(out.explicitIntentAt).toMatch(INSTANT);
    expect(Date.parse(out.explicitIntentAt)).toBeGreaterThanOrEqual(lo);
    expect(Date.parse(out.explicitIntentAt)).toBeLessThanOrEqual(hi);
    // DURABLE: the checkpoint FILE says it, and so does the map, which equals what the rows derive.
    const cp = onDisk(w);
    expect(rowOf(cp, A.id, GEN1)).toMatchObject({ explicitIntentAt: out.explicitIntentAt, effective: true, effectiveBasis: ['explicit'] });
    expect(cp.coordinatorIntentByParent).toEqual({ [delegationIntentKey(A.id, GEN1)]: out.explicitIntentAt });
    expect(Object.keys(cp.coordinatorIntentByParent), 'a bare session id is never a key of the map').not.toContain(A.id);
    expect(cp.coordinatorIntentByParent).toEqual(deriveCoordinatorIntentByParent(cp.sessions));
    // …and the lane's own instance holds the same state without a re-read: the route and the lane share ONE applier.
    expect(w.durable.state().checkpoint).toEqual(cp);
    expect(await w.watcher!.delegationApplier()).toBe(w.durable);
    // …and SQLite is projected from it.
    expect(rowOf(w.coord.readDelegationProjection(), A.id, GEN1)).toMatchObject({ explicitIntentAt: out.explicitIntentAt, effective: true });
  });

  it('declares nothing else: no lease, no activity, no attempt, no cursor, no hold', async () => {
    const w = await world();
    await declare(w, A.id, bodyOf('set'));
    const cp = onDisk(w);
    expect({ leases: cp.leases, lineage: cp.lineage, activities: cp.activities, attempts: cp.attempts, cursors: cp.bucketCursors, holds: cp.pruningHolds })
      .toEqual({ leases: [], lineage: [], activities: [], attempts: [], cursors: [], holds: [] });
    expect(cp.appliedJournalSequence, 'no journal record was appended').toBe(0);
  });

  it('set is IDEMPOTENT: the second answers changed:false with the FIRST instant, and writes nothing', async () => {
    const w = await world();
    const first = (await declare(w, A.id, bodyOf('set'))).json();
    const revision = w.durable.state().checkpoint.revision;
    const bytes = readFileSync(diskPath(w));
    const second = await declare(w, A.id, bodyOf('set'));
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ ok: true, changed: false, explicitIntentAt: first.explicitIntentAt, effective: true, projection: 'projected' });
    expect(w.durable.state().checkpoint.revision, 'no checkpoint replacement').toBe(revision);
    expect(readFileSync(diskPath(w)).equals(bytes)).toBe(true);
  });

  it('clear removes the declaration and the map entry, and keeps the row', async () => {
    const w = await world();
    await declare(w, A.id, bodyOf('set'));
    const res = await declare(w, A.id, bodyOf('clear'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, action: 'clear', changed: true, explicitIntentAt: null, effective: false, effectiveBasis: [], projection: 'projected', incarnationAfter: 'same' });
    const cp = onDisk(w);
    expect(rowOf(cp, A.id, GEN1), 'wave 3 never removes a session row').toMatchObject({ explicitIntentAt: null, effective: false, effectiveBasis: [] });
    expect(cp.coordinatorIntentByParent).toEqual({});
    expect(rowOf(w.coord.readDelegationProjection(), A.id, GEN1)).toMatchObject({ explicitIntentAt: null, effective: false });
  });

  it('clear is IDEMPOTENT, and a clear for a session with no row creates none and writes nothing', async () => {
    const w = await world();
    const none = await declare(w, A.id, bodyOf('clear'));
    expect(none.statusCode).toBe(200);
    expect(none.json()).toMatchObject({ ok: true, changed: false, explicitIntentAt: null, effective: false, effectiveBasis: [], projection: 'projected' });
    expect(existsSync(diskPath(w)), 'a clear with nothing to clear writes no checkpoint').toBe(false);
    await declare(w, A.id, bodyOf('set'));
    await declare(w, A.id, bodyOf('clear'));
    const revision = w.durable.state().checkpoint.revision;
    const again = await declare(w, A.id, bodyOf('clear'));
    expect(again.json()).toMatchObject({ ok: true, changed: false, explicitIntentAt: null });
    expect(w.durable.state().checkpoint.revision).toBe(revision);
  });

  it('clear PRESERVES the run-owner, inferred and retained-lineage bases, and the effective identity they give (W3-M56)', async () => {
    const w = await world();
    const others: DelegationIntentSource[] = ['run-owner', 'delegation-inferred', 'retained-lineage'];
    await plant(w, [row(A.id, GEN1, { effective: true, effectiveBasis: others })]);
    const set = await declare(w, A.id, bodyOf('set'));
    expect(set.json()).toMatchObject({ changed: true, effective: true, effectiveBasis: ['explicit', ...others] });
    const res = await declare(w, A.id, bodyOf('clear'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, changed: true, explicitIntentAt: null, effective: true, effectiveBasis: others });
    expect(rowOf(onDisk(w), A.id, GEN1)).toMatchObject({ explicitIntentAt: null, effective: true, effectiveBasis: others });
    expect(onDisk(w).coordinatorIntentByParent).toEqual({});
  });

  it('keys the map by (session, incarnation): clearing the current one leaves a historical declaration exactly as it is', async () => {
    const w = await world();
    const earlier = '2026-10-14T09:10:00.000Z';
    await plant(w, [row(A.id, OLD_GEN, { explicitIntentAt: earlier, effective: true, effectiveBasis: ['explicit'] })]);
    const set = (await declare(w, A.id, bodyOf('set'))).json();
    const mid = onDisk(w);
    expect(mid.coordinatorIntentByParent, 'one entry per incarnation, neither standing for the other')
      .toEqual({ [delegationIntentKey(A.id, OLD_GEN)]: earlier, [delegationIntentKey(A.id, GEN1)]: set.explicitIntentAt });
    expect(Object.keys(mid.coordinatorIntentByParent)).not.toContain(A.id);
    await declare(w, A.id, bodyOf('clear'));
    expect(onDisk(w).coordinatorIntentByParent, 'clear removes only the current incarnation\'s key')
      .toEqual({ [delegationIntentKey(A.id, OLD_GEN)]: earlier });
  });

  it('a NEW incarnation does not inherit a historical declaration: it starts undeclared, and clearing it creates nothing', async () => {
    const w = await world();
    const earlier = '2026-10-14T09:10:00.000Z';
    await plant(w, [row(A.id, OLD_GEN, { explicitIntentAt: earlier, effective: true, effectiveBasis: ['explicit', 'run-owner'] })]);
    const cleared = await declare(w, A.id, bodyOf('clear'));
    expect(cleared.json()).toMatchObject({ ok: true, changed: false, incarnation: GEN1, explicitIntentAt: null, effective: false, effectiveBasis: [] });
    expect(rowOf(w.durable.state().checkpoint, A.id, GEN1), 'the new incarnation got no row, and so no inherited intent').toBeUndefined();
    expect(w.durable.state().checkpoint.coordinatorIntentByParent).toEqual({ [delegationIntentKey(A.id, OLD_GEN)]: earlier });
    // Its own declaration is its own: the historical row and entry stay as they were.
    const set = (await declare(w, A.id, bodyOf('set'))).json();
    expect(set).toMatchObject({ changed: true, effectiveBasis: ['explicit'] });
    expect(set.explicitIntentAt).not.toBe(earlier);
    expect(rowOf(onDisk(w), A.id, OLD_GEN)).toMatchObject({ explicitIntentAt: earlier, effectiveBasis: ['explicit', 'run-owner'] });
  });

  it('a recreated session id inherits nothing: a declaration made under the old incarnation stays historical', async () => {
    const w = await world();
    const first = (await declare(w, A.id, bodyOf('set'))).json();
    expect(first.incarnation).toBe(GEN1);
    // `forget`, then the id is reused: the registry row comes back with a fresh generation.
    seed(w.home, A, GEN2);
    const again = await declare(w, A.id, bodyOf('clear'));
    expect(again.json()).toMatchObject({ ok: true, changed: false, incarnation: GEN2, explicitIntentAt: null, effective: false });
    const cp = w.durable.state().checkpoint;
    expect(rowOf(cp, A.id, GEN2)).toBeUndefined();
    expect(cp.coordinatorIntentByParent).toEqual({ [delegationIntentKey(A.id, GEN1)]: first.explicitIntentAt });
    const recreated = (await declare(w, A.id, bodyOf('set'))).json();
    expect(recreated).toMatchObject({ changed: true, incarnation: GEN2 });
    expect(Object.keys(onDisk(w).coordinatorIntentByParent).sort())
      .toEqual([delegationIntentKey(A.id, GEN1), delegationIntentKey(A.id, GEN2)].sort());
  });

  it('declares for each session separately: A\'s set leaves B\'s row alone', async () => {
    const w = await world();
    await declare(w, A.id, bodyOf('set', A));
    await declare(w, B.id, bodyOf('set', B));
    await declare(w, A.id, bodyOf('clear', A));
    const cp = onDisk(w);
    expect(rowOf(cp, A.id, GEN1)!.explicitIntentAt).toBeNull();
    expect(rowOf(cp, B.id, GEN1)!.explicitIntentAt).toMatch(INSTANT);
    expect(Object.keys(cp.coordinatorIntentByParent)).toEqual([delegationIntentKey(B.id, GEN1)]);
  });
});

// ── durability (W3-M55, the second half) ─────────────────────────────────────────────────────────────────────────────────

class Crash extends Error {}
const failAt = (edge: string, when: 'before' | 'after') => ({ onEdge: (e: string, w: string) => { if (e === edge && w === when) throw new Crash(`${edge}:${when}`); } });

describe('POST /api/coordinators/:session/intent: durability', () => {
  it('a failure BEFORE the checkpoint rename answers 503, and no declaration is visible anywhere', async () => {
    const w = await world({ faults: failAt('checkpoint-rename', 'before') });
    const res = await declare(w, A.id, bodyOf('set'));
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'application-failed' });
    expect(existsSync(diskPath(w)), 'the rename never happened').toBe(false);
    expect(w.durable.state().checkpoint.sessions, 'nothing is visible from the lane').toEqual([]);
    expect(w.coord.readDelegationProjection().sessions, 'nothing was projected').toEqual([]);
    // The applier then refuses everything until it re-recovers, and says so; it does not pretend.
    const next = await declare(w, A.id, bodyOf('set'));
    expect(next.statusCode).toBe(503);
    expect(next.json()).toMatchObject({ ok: false, error: 'not-ready' });
  });

  it('after the applier re-recovers, the same declaration lands once', async () => {
    let armed = true;
    const w = await world({ faults: { onEdge: (e, when) => { if (armed && e === 'checkpoint-rename' && when === 'before') throw new Crash('rename'); } } });
    expect((await declare(w, A.id, bodyOf('set'))).statusCode).toBe(503);
    armed = false;
    await w.durable.recover();
    const res = await declare(w, A.id, bodyOf('set'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, changed: true });
    expect(rowOf(onDisk(w), A.id, GEN1)!.explicitIntentAt).toMatch(INSTANT);
  });

  it('a failure AFTER the rename answers 503 (unconfirmed), the file holds the declaration, and a retry after recovery changes nothing', async () => {
    let armed = true;
    const w = await world({ faults: { onEdge: (e, when) => { if (armed && e === 'checkpoint-rename' && when === 'after') throw new Crash('after-rename'); } } });
    const res = await declare(w, A.id, bodyOf('set'));
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'application-failed' });
    // The rename happened, so the declaration is durable on disk although the answer was a refusal; it is visible only from there.
    const landed = rowOf(onDisk(w), A.id, GEN1)!.explicitIntentAt;
    expect(landed).toMatch(INSTANT);
    armed = false;
    await w.durable.recover();
    expect(rowOf(w.durable.state().checkpoint, A.id, GEN1)!.explicitIntentAt).toBe(landed);
    const retry = await declare(w, A.id, bodyOf('set'));
    expect(retry.json()).toMatchObject({ ok: true, changed: false, explicitIntentAt: landed });
  });

  it('a failure at the projection edge answers 200: the declaration is durable, and the route repairs the disposable projection', async () => {
    const w = await world({ faults: failAt('project', 'before') });
    const res = await declare(w, A.id, bodyOf('set'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, changed: true, projection: 'projected' });
    expect(rowOf(onDisk(w), A.id, GEN1)!.explicitIntentAt).toMatch(INSTANT);
    expect(rowOf(w.coord.readDelegationProjection(), A.id, GEN1)!.explicitIntentAt, 'the repair projected it').toMatch(INSTANT);
  });

  it('a projection that stays broken cannot erase the declaration: 200 projection:stale, the checkpoint keeps it, a later repair projects it', async () => {
    let broken = true;
    const w = await world({
      faults: {
        projection: (real) => ({
          project: (cp) => { if (broken) throw new Error('the database is gone'); real.project(cp); },
          insertEvents: real.insertEvents, eventStats: real.eventStats,
        }),
      },
    });
    const res = await declare(w, A.id, bodyOf('set'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, changed: true, projection: 'stale' });
    const declared = res.json().explicitIntentAt as string;
    expect(rowOf(onDisk(w), A.id, GEN1)!.explicitIntentAt, 'the checkpoint kept it').toBe(declared);
    expect(w.coord.readDelegationProjection().sessions, 'SQLite never saw it').toEqual([]);
    // A clear while SQLite is still broken is just as durable.
    const cleared = await declare(w, A.id, bodyOf('clear'));
    expect(cleared.json()).toMatchObject({ ok: true, changed: true, projection: 'stale', explicitIntentAt: null });
    expect(rowOf(onDisk(w), A.id, GEN1)!.explicitIntentAt).toBeNull();
    broken = false;
    await declare(w, A.id, bodyOf('set'));
    expect(rowOf(w.coord.readDelegationProjection(), A.id, GEN1)!.explicitIntentAt).toMatch(INSTANT);
  });
});

describe('POST /api/coordinators/:session/intent: the lane, the incarnation, the projection (fix round 1)', () => {
  it.each<[string, () => unknown]>([
    ['resolves null (the open has not happened)', () => ({ delegationApplier: () => Promise.resolve(null) })],
    ['rejects (the open failed)', () => ({ delegationApplier: () => Promise.reject(new Error('the open failed')) })],
  ])('answers 503 not-ready, never a silent success, when the lane\'s applier %s, and writes nothing', async (_name, watcher) => {
    const w = await world({ faults: { watcher } });
    const res = await declare(w, A.id, bodyOf('set'));
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-ready' });
    expect(existsSync(diskPath(w)), 'no checkpoint was written').toBe(false);
    expect(w.coord.readDelegationProjection().sessions, 'nothing was projected').toEqual([]);
  });

  it('answers 409 incarnation-changed when the generation moves during the queued write: the declaration stays on the incarnation it was made for', async () => {
    let move: (() => void) | null = null;
    const w = await world({ faults: { onEdge: (e, when) => { if (e === 'checkpoint-write' && when === 'before') { move?.(); move = null; } } } });
    move = () => seed(w.home, A, GEN2);
    const res = await declare(w, A.id, bodyOf('set'));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'incarnation-changed', incarnation: GEN1 });
    expect(res.json().detail).toContain('previous incarnation');
    expect(res.json().detail).toContain('retry to declare for the new one');
    // Nothing is undone: the row of the incarnation it landed on is the truth for that incarnation.
    const landed = onDisk(w);
    expect(rowOf(landed, A.id, GEN1)!.explicitIntentAt).toMatch(INSTANT);
    expect(rowOf(landed, A.id, GEN2), 'the new incarnation got nothing').toBeUndefined();
    // The retry declares for the new incarnation and leaves the old one exactly as it was.
    const retry = await declare(w, A.id, bodyOf('set'));
    expect(retry.json()).toMatchObject({ ok: true, changed: true, incarnation: GEN2 });
    expect(rowOf(onDisk(w), A.id, GEN1)).toEqual(rowOf(landed, A.id, GEN1));
  });

  it('answers 409 incarnation-changed too when the generation file is gone after the write', async () => {
    let move: (() => void) | null = null;
    const w = await world({ faults: { onEdge: (e, when) => { if (e === 'checkpoint-write' && when === 'before') { move?.(); move = null; } } } });
    move = () => rmSync(path.join(w.home, '.cc-sessions', `${A.id}.generation`));
    const res = await declare(w, A.id, bodyOf('set'));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'incarnation-changed' });
    expect(rowOf(onDisk(w), A.id, GEN1)!.explicitIntentAt).toMatch(INSTANT);
    // N2: no "new one" to retry for: the row is gone
    expect(res.json().detail).toContain('nothing to retry until the id is recreated');
    expect(res.json().detail).not.toContain('retry to declare');
  });

  it('N2: a CLEAR that the incarnation moved under is told there is nothing to clear for the new one, never to retry a declaration', async () => {
    let move: (() => void) | null = null;
    const w = await world({ faults: { onEdge: (e, when) => { if (e === 'checkpoint-write' && when === 'before') { move?.(); move = null; } } } });
    expect((await declare(w, A.id, bodyOf('set'))).statusCode).toBe(200);
    move = () => seed(w.home, A, GEN2);
    const res = await declare(w, A.id, bodyOf('clear'));
    expect(res.statusCode).toBe(409);
    expect(res.json().detail).toContain('the clear landed on the previous incarnation');
    expect(res.json().detail).toContain('nothing to clear for it');
    expect(res.json().detail).not.toContain('retry to declare');
  });

  it('N3: a port that REJECTS on the re-read after a durable write answers 200 with incarnationAfter unmeasured, never a 500', async () => {
    let reject = false;
    const rejecting: FleetIO = {
      ...localIO,
      readFileMeasured: async (p, t, s) => { if (reject && p.endsWith(`${A.id}.generation`)) throw new Error('the agent link dropped'); return localIO.readFileMeasured(p, t, s); },
    };
    const w = await world({ over: { io: rejecting }, faults: { onEdge: (e, when) => { if (e === 'checkpoint-write' && when === 'before') reject = true; } } });
    const res = await declare(w, A.id, bodyOf('set'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, changed: true, incarnation: GEN1, incarnationAfter: 'unmeasured' });
  });

  it('does not call a re-read it cannot measure a move: an unreadable generation after the write is not evidence', async () => {
    let move: (() => void) | null = null;
    const w = await world({ faults: { onEdge: (e, when) => { if (e === 'checkpoint-write' && when === 'before') { move?.(); move = null; } } } });
    move = () => writeFileSync(path.join(w.home, '.cc-sessions', `${A.id}.generation`), 'not-a-generation');
    const res = await declare(w, A.id, bodyOf('set'));
    expect(res.statusCode).toBe(200);
    // N1 (D-4008): durable, and SAID to be unconfirmed: an unmeasured re-read never reads as a confirmed incarnation
    expect(res.json()).toMatchObject({ ok: true, changed: true, incarnation: GEN1, incarnationAfter: 'unmeasured' });
  });

  it('a retry after a stale answer repairs the projection and says so: a no-op attempts the repair too', async () => {
    let broken = true;
    const w = await world({
      faults: {
        projection: (real) => ({
          project: (cp) => { if (broken) throw new Error('the database is gone'); real.project(cp); },
          insertEvents: real.insertEvents, eventStats: real.eventStats,
        }),
      },
    });
    const first = (await declare(w, A.id, bodyOf('set'))).json();
    expect(first).toMatchObject({ ok: true, changed: true, projection: 'stale' });
    // Still broken: the retry writes nothing, attempts the repair, and reports what is true.
    const still = await declare(w, A.id, bodyOf('set'));
    expect(still.json()).toMatchObject({ ok: true, changed: false, projection: 'stale' });
    expect(w.coord.readDelegationProjection().sessions).toEqual([]);
    broken = false;
    const retry = await declare(w, A.id, bodyOf('set'));
    expect(retry.json()).toMatchObject({ ok: true, changed: false, explicitIntentAt: first.explicitIntentAt, projection: 'projected' });
    expect(rowOf(w.coord.readDelegationProjection(), A.id, GEN1)!.explicitIntentAt, 'the no-op repaired SQLite').toBe(first.explicitIntentAt);
  });
});

// ── SQLite is not the authority (W3-M56, the second half) ────────────────────────────────────────────────────────────────

describe('POST /api/coordinators/:session/intent: SQLite is repairable output', () => {
  it('a declaration survives the loss of SQLite: a fresh database is re-projected from the checkpoint', async () => {
    const w = await world();
    const declared = (await declare(w, A.id, bodyOf('set'))).json().explicitIntentAt as string;
    await w.durable.close();
    const fresh = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-intent-fresh-'), 'coord.db')));
    expect(fresh.readDelegationProjection().sessions, 'the fresh database knows nothing').toEqual([]);
    const reopened = await DelegationDurability.open({
      dir: w.dir, now: () => Date.now(), randomUUID: () => randomUUID(),
      projection: { project: (cp) => fresh.projectDelegationCheckpoint(cp), insertEvents: (rows) => fresh.insertDelegationEvents(rows), eventStats: () => fresh.delegationEventStats() },
    });
    closers.push(() => reopened.close());
    expect(reopened.failure()).toBeNull();
    expect(rowOf(reopened.state().checkpoint, A.id, GEN1)!.explicitIntentAt).toBe(declared);
    expect(rowOf(fresh.readDelegationProjection(), A.id, GEN1)).toMatchObject({ explicitIntentAt: declared, effective: true, effectiveBasis: ['explicit'] });
  });

  it('SQLite is never read back for the decision: with its rows deleted, set is still a no-op, and clear still clears', async () => {
    const w = await world();
    const declared = (await declare(w, A.id, bodyOf('set'))).json().explicitIntentAt as string;
    w.db.exec('DELETE FROM delegation_sessions');
    expect(w.coord.readDelegationProjection().sessions).toEqual([]);
    const again = await declare(w, A.id, bodyOf('set'));
    expect(again.json()).toMatchObject({ ok: true, changed: false, explicitIntentAt: declared });
    const repaired = await w.durable.repairProjection();
    expect(repaired).not.toBeNull();
    expect(rowOf(w.coord.readDelegationProjection(), A.id, GEN1)!.explicitIntentAt).toBe(declared);
    w.db.exec('DELETE FROM delegation_sessions');
    const cleared = await declare(w, A.id, bodyOf('clear'));
    expect(cleared.json()).toMatchObject({ ok: true, changed: true, explicitIntentAt: null });
    expect(rowOf(onDisk(w), A.id, GEN1)!.explicitIntentAt).toBeNull();
  });

  it('the route opens no second applier and writes no intent to SQLite itself (source guard)', () => {
    const src = readFileSync(path.resolve(__dirname, '../src/coord/routes.ts'), 'utf8');
    const start = src.indexOf("app.post('/api/coordinators/:session/intent'");
    expect(start, 'the intent route moved or was renamed').toBeGreaterThan(0);
    const handler = src.slice(start, src.indexOf('return { withAbandon, withSweepAbandon };', start));
    expect(handler).toContain('watcher.delegationApplier()');
    expect(handler).toContain('applyCheckpointChange(');
    // ONE applier per directory: two would race one journal. The file as a whole opens none.
    expect(src).not.toMatch(/DelegationDurability\.open\(|new DelegationDurability\(/);
    // No direct SQLite intent writer: the projection port and the checkpoint door are the only ways in.
    expect(handler).not.toMatch(/projectDelegationCheckpoint|insertDelegationEvent|UPDATE delegation_|INSERT INTO delegation_/);
    expect(handler).not.toMatch(/coord\.[A-Za-z]*[Ii]ntent/);
  });
});

// ── the pure decision ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('declareCoordinatorIntent', () => {
  const AT = '2026-10-14T10:00:00.000Z';
  const cp = (sessions: readonly DelegationSessionRow[]): DelegationCheckpointV1 =>
    ({ ...emptyDelegationCheckpoint(), sessions, coordinatorIntentByParent: deriveCoordinatorIntentByParent(sessions) });
  const req = (action: 'set' | 'clear', over: Partial<{ sessionId: string; parentIncarnation: string; declaredAt: string }> = {}) =>
    ({ action, sessionId: A.id, parentIncarnation: GEN1, declaredAt: AT, ...over });
  const deepFreeze = <T>(v: T): T => {
    if (v !== null && typeof v === 'object') { for (const x of Object.values(v)) deepFreeze(x); Object.freeze(v); }
    return v;
  };

  it('set on an empty checkpoint creates the row the intent door owns, and the map that agrees with it', () => {
    const out = declareCoordinatorIntent(deepFreeze(cp([])), req('set'));
    expect(out.sessions).toEqual([row(A.id, GEN1, { explicitIntentAt: AT, effective: true, effectiveBasis: ['explicit'], firstObservedAt: AT, lastObservedAt: AT })]);
    expect(out.coordinatorIntentByParent).toEqual({ [delegationIntentKey(A.id, GEN1)]: AT });
  });

  it('is pure: the input is frozen and comes back untouched', () => {
    const input = deepFreeze(cp([row(A.id, GEN1, { effective: true, effectiveBasis: ['run-owner'] })]));
    const snapshot = structuredClone(input);
    declareCoordinatorIntent(input, req('set'));
    declareCoordinatorIntent(input, req('clear'));
    expect(input).toEqual(snapshot);
  });

  it('set keeps the FIRST instant, adds explicit in the canonical order, and clear drops only explicit', () => {
    const start = cp([row(A.id, GEN1, { effective: true, effectiveBasis: ['retained-lineage', 'run-owner'] })]);
    const set = declareCoordinatorIntent(start, req('set'));
    expect(rowOf(set, A.id, GEN1)).toMatchObject({ explicitIntentAt: AT, effective: true, effectiveBasis: ['explicit', 'run-owner', 'retained-lineage'] });
    const later = declareCoordinatorIntent(set, req('set', { declaredAt: '2026-10-14T11:00:00.000Z' }));
    expect(later).toEqual(set);
    const clear = declareCoordinatorIntent(later, req('clear'));
    expect(rowOf(clear, A.id, GEN1)).toMatchObject({ explicitIntentAt: null, effective: true, effectiveBasis: ['run-owner', 'retained-lineage'] });
    expect(clear.coordinatorIntentByParent).toEqual({});
  });

  it.each<DelegationIntentSource>(['run-owner', 'delegation-inferred', 'retained-lineage'])(
    'clear leaves a row whose ONLY other basis is %s effective, on that basis alone (W3-M56)', (only) => {
      const set = declareCoordinatorIntent(cp([row(A.id, GEN1, { effective: true, effectiveBasis: [only] })]), req('set'));
      expect(rowOf(set, A.id, GEN1)).toMatchObject({ effective: true, effectiveBasis: ['explicit', only] });
      const clear = declareCoordinatorIntent(set, req('clear'));
      expect(rowOf(clear, A.id, GEN1)).toMatchObject({ explicitIntentAt: null, effective: true, effectiveBasis: [only] });
    });

  it('clear on a row with only the explicit basis ends the effective identity, and keeps the row', () => {
    const out = declareCoordinatorIntent(declareCoordinatorIntent(cp([]), req('set')), req('clear'));
    expect(rowOf(out, A.id, GEN1)).toMatchObject({ explicitIntentAt: null, effective: false, effectiveBasis: [] });
  });

  it('clear with no row is a no-op that creates nothing', () => {
    const start = cp([row(B.id, GEN1)]);
    expect(declareCoordinatorIntent(start, req('clear'))).toEqual(start);
  });

  it('touches one row: another incarnation and another session come back identical', () => {
    const old = row(A.id, OLD_GEN, { explicitIntentAt: '2026-10-14T09:10:00.000Z', effective: true, effectiveBasis: ['explicit', 'delegation-inferred'] });
    const other = row(B.id, GEN1, { explicitIntentAt: '2026-10-14T09:20:00.000Z', effective: true, effectiveBasis: ['explicit'] });
    const out = declareCoordinatorIntent(cp([old, other]), req('set'));
    expect(rowOf(out, A.id, OLD_GEN)).toEqual(old);
    expect(rowOf(out, B.id, GEN1)).toEqual(other);
    expect(out.coordinatorIntentByParent).toEqual({
      [delegationIntentKey(A.id, OLD_GEN)]: '2026-10-14T09:10:00.000Z', [delegationIntentKey(A.id, GEN1)]: AT,
      [delegationIntentKey(B.id, GEN1)]: '2026-10-14T09:20:00.000Z',
    });
  });

  it('a new incarnation inherits nothing: clearing it leaves a historical declaration, and the map, exactly as they were', () => {
    const old = row(A.id, OLD_GEN, { explicitIntentAt: '2026-10-14T09:10:00.000Z', effective: true, effectiveBasis: ['explicit'] });
    const start = cp([old]);
    expect(declareCoordinatorIntent(start, req('clear'))).toEqual(start);
    const set = declareCoordinatorIntent(start, req('set'));
    expect(set.coordinatorIntentByParent).toEqual({ [delegationIntentKey(A.id, OLD_GEN)]: '2026-10-14T09:10:00.000Z', [delegationIntentKey(A.id, GEN1)]: AT });
    expect(declareCoordinatorIntent(set, req('clear')).coordinatorIntentByParent).toEqual({ [delegationIntentKey(A.id, OLD_GEN)]: '2026-10-14T09:10:00.000Z' });
  });

  it('refuses an instant that is not canonical', () => {
    for (const declaredAt of ['2026-10-14T10:00:00Z', '2026-10-14 10:00:00.000', '', 'now']) {
      expect(() => declareCoordinatorIntent(cp([]), req('set', { declaredAt })), declaredAt).toThrow();
    }
    expect(formatDelegationInstant(Date.parse(AT))).toBe(AT);
  });
});
