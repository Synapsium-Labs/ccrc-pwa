// Session helpers S2 (D-8874; spec docs/superpowers/specs/2026-11-19-session-helpers-design.md §7.2, "Who runs it"; plan
// docs/superpowers/plans/2026-11-20-broker-helper-ends.md, Task S2): THE TRIGGER, a session-gated route of its own file,
// `server/src/coord/delegationBackfillRoutes.ts`.
//
//   GET  /api/coord/delegation-backfill   the dry run: the report, and nothing written
//   POST /api/coord/delegation-backfill   {act: 'pass', closes: <the dry run's count>} or {act: 'undo'}
//
// The pass refuses `sign-in-unarmed` unless sign-in is armed and the caller holds a session (the collect-lane and delegation-adopt
// argument: a fleet-wide durable write needs a signed-in operator); the dry run and the undo stay open dark. The pass refuses
// `count-changed` unless `closes` is what it would close now. The route reads the registry (a listing, then each parent's
// incarnation, read twice) and hands the facts to the applier, which decides under its lock. The box-token census and the auth gate's
// route tally hold its registration (`box-token-census.test.ts`, `auth-gate.test.ts`).
//
// Red first: against `main` (137f96672c) every case is red: the routes file does not exist there. Every directory is a FIXTURE home:
// nothing reads the live `~/.ccrc` or `~/.cc-sessions`, and the pass never runs against the live server.
import { afterEach, describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { DELEGATION_BACKFILL_REFUSALS, DELEGATION_BACKFILL_WORDS } from '../../shared/delegationBackfill.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { delegationSha256Hex, formatDelegationInstant, type DelegationJournalRecordV1 } from '../src/coord/delegation-model.js';
import { DELEGATION_JOURNAL_FILE, buildDelegationJournalRecord, encodeDelegationJournalRecord, type DelegationFileHandle, type DelegationFilePort } from '../src/coord/delegation-journal.js';
import { DELEGATION_CHECKPOINT_FILE } from '../src/coord/delegation-checkpoint.js';
import { DelegationDurability } from '../src/coord/delegation-durability.js';
import type { DelegationProjectionPort } from '../src/coord/delegation-db-projection.js';
import { nodeDelegationFilePort } from '../src/coord/delegation-file-port.js';
import { DELEGATION_BACKFILL_FILE } from '../src/coord/delegation-backfill.js';
import { registerDelegationBackfillRoutes } from '../src/coord/delegationBackfillRoutes.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const DOOR = '/api/coord/delegation-backfill';
const P = 'lane-a-demo';
const Q = 'lane-b-demo';
const INC = '0189abcd-1234-4678-9abc-0123456789ab';
const CLAUDE = '11111111-2222-3333-4444-555555555555';
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 20, 12);
const iso = (ms: number): string => formatDelegationInstant(ms);

let serial = 0;
const base = (ms: number, sessionId: string) => {
  const n = ++serial;
  return {
    v: 1 as const, observedAt: iso(ms), sessionId, parentIncarnation: INC, claudeSessionId: CLAUDE,
    eventId: delegationSha256Hex(`s2-route-event-${n}`), bucket: '2026102012', startOffset: n * 100, endOffset: n * 100 + 99,
  };
};
const ss = (ms: number, sessionId: string): DelegationEventEnvelopeV1 => ({ ...base(ms, sessionId), eventKind: 'SessionStart', source: 'startup' });
const start = (ms: number, sessionId: string, agentId: string): DelegationEventEnvelopeV1 => ({ ...base(ms, sessionId), eventKind: 'SubagentStart', agentId, agentType: null });
function chain(events: readonly DelegationEventEnvelopeV1[]): DelegationJournalRecordV1[] {
  const out: DelegationJournalRecordV1[] = [];
  let prev: string | null = null;
  events.forEach((event, i) => {
    const r = buildDelegationJournalRecord({ sequence: i + 1, acceptedAt: iso(Date.parse(event.observedAt) + 1000), previousDigest: prev, entry: { kind: 'evidence-accepted', event } });
    out.push(r);
    prev = r.digest;
  });
  return out;
}

const noSync = (h: DelegationFileHandle): DelegationFileHandle => ({ write: (b) => h.write(b), sync: async () => undefined, close: () => h.close() });
const quickPort: DelegationFilePort = {
  ...nodeDelegationFilePort,
  openAppend: async (p) => noSync(await nodeDelegationFilePort.openAppend(p)),
  createTemp: async (p) => noSync(await nodeDelegationFilePort.createTemp(p)),
  fsyncDir: async () => undefined,
  fsyncFile: async () => undefined,
};
const nullProjection: DelegationProjectionPort = {
  project: () => undefined, projectChanged: () => ({ mode: 'full' }), insertEvents: (rows) => ({ inserted: rows.length, duplicate: 0, conflicts: [] }),
  eventStats: () => ({ count: 0, maxSequence: null }), countEventsAtOrBelow: () => 0, deleteEventsBetween: () => 0,
};
const storePort = (coord: CoordStore): DelegationProjectionPort => ({
  project: (cp) => coord.projectDelegationCheckpoint(cp),
  projectChanged: (prior, next) => coord.projectDelegationCheckpointChanges(prior, next),
  insertEvents: (rows) => coord.insertDelegationEvents(rows),
  eventStats: () => coord.delegationEventStats(),
  countEventsAtOrBelow: (s) => coord.countDelegationEventsAtOrBelow(s),
  deleteEventsBetween: (a, b, n) => coord.deleteDelegationEventsBetween(a, b, n),
});

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close().catch(() => undefined))); });

interface World { app: FastifyInstance; ccrc: string; reg: string; durable: DelegationDurability | null; coord: CoordStore | null }
/** P is registered at INC (alive, its own incarnation); Q is not in the registry. P started agent X, Q started agent Z, both on day 0;
 *  the clock reads day 3. So the dry run closes Z (its parent is gone) and keeps X (its parent is alive, at the same incarnation). */
async function world(o: { signedIn?: boolean; applier?: 'none'; sqlite?: true } = {}): Promise<World> {
  const home = mkTmp('ccrc-s2-route-');
  const deps = testDeps(home);
  const ccrc = deps.cfg.ccrcDir;
  const reg = deps.cfg.registryDir;
  mkdirSync(ccrc, { recursive: true });
  mkdirSync(reg, { recursive: true });
  writeFileSync(path.join(reg, `${P}.uuid`), 'a'.repeat(36));
  writeFileSync(path.join(reg, `${P}.generation`), INC);
  const records = chain([ss(T0, P), start(T0 + 1000, P, 'agent-x'), ss(T0 + 2000, Q), start(T0 + 3000, Q, 'agent-z')]);
  writeFileSync(path.join(ccrc, DELEGATION_JOURNAL_FILE), Buffer.concat(records.map((r) => Buffer.from(encodeDelegationJournalRecord(r)))));
  let coord: CoordStore | null = null;
  if (o.sqlite === true) {
    coord = new CoordStore(openCoordDb(path.join(ccrc, 'coord.db')));
    coord.db.exec('PRAGMA synchronous = OFF');
  }
  const durable = o.applier === 'none' ? null : await DelegationDurability.open({
    dir: ccrc, projection: coord === null ? nullProjection : storePort(coord), port: quickPort, now: () => T0 + 3 * DAY, randomUUID: () => 'unused',
  });
  if (durable !== null) closers.push(() => durable.close());
  const app = Fastify();
  registerDelegationBackfillRoutes(app, {
    applier: async () => durable, io: deps.io, registryDir: reg, now: () => T0 + 3 * DAY,
    signedIn: (_req: FastifyRequest) => o.signedIn ?? true,
  });
  closers.push(() => app.close());
  return { app, ccrc, reg, durable, coord };
}
const get = (w: World) => w.app.inject({ method: 'GET', url: DOOR });
const post = (w: World, payload: unknown) => w.app.inject({ method: 'POST', url: DOOR, payload: payload as object });
const bytes = (w: World): Buffer => readFileSync(path.join(w.ccrc, DELEGATION_CHECKPOINT_FILE));

describe('GET /api/coord/delegation-backfill: the dry run (spec §7.2, condition 4)', () => {
  it('RT-1: answers the report from the registry it measured, and writes nothing', async () => {
    const w = await world();
    const before = bytes(w);
    const r = await get(w);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, words: DELEGATION_BACKFILL_WORDS, mode: 'first', listed: null, closes: 1, failedCheck: 1, young: 0,
      byKind: { agent: { days1to7: 1, days7to30: 0, days30plus: 0 } }, reportedFirst: 0 });
    expect(bytes(w).equals(before)).toBe(true);
    expect(existsSync(path.join(w.ccrc, DELEGATION_BACKFILL_FILE))).toBe(false);
  });

  it('RT-2: a parent whose incarnation cannot be read fails the check; a registry that does not list fails every one', async () => {
    const w = await world();
    writeFileSync(path.join(w.reg, `${P}.generation`), '');
    expect((await get(w)).json(), 'P present, its incarnation unreadable: X still fails').toMatchObject({ closes: 1, failedCheck: 1 });
    const dark = await world();
    const app = Fastify();
    registerDelegationBackfillRoutes(app, {
      applier: async () => dark.durable, io: { ...testDeps(mkTmp('ccrc-s2-route-io-')).io, readdirMeasured: async () => ({ ok: false as const, reason: 'unreadable' as const }) },
      registryDir: dark.reg, now: () => T0 + 3 * DAY, signedIn: () => true,
    });
    closers.push(() => app.close());
    expect((await app.inject({ method: 'GET', url: DOOR })).json(), 'Q is not proved absent: Z fails too').toMatchObject({ closes: 0, failedCheck: 2 });
  });

  it('RT-3: no applier open answers 503 not-ready, to the dry run and the pass alike', async () => {
    const w = await world({ applier: 'none' });
    expect([(await get(w)).statusCode, (await get(w)).json().error]).toEqual([503, 'not-ready']);
    expect((await post(w, { act: 'pass', closes: 1 })).statusCode).toBe(503);
  });
});

describe('POST /api/coord/delegation-backfill: the pass and the undo', () => {
  it('RT-4: the pass with the dry run\'s count closes it, and answers what it closed', async () => {
    const w = await world();
    const dry = (await get(w)).json() as { closes: number };
    const r = await post(w, { act: 'pass', closes: dry.closes });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, act: 'pass', closed: 1, report: { closes: 1 } });
    expect(existsSync(path.join(w.ccrc, DELEGATION_BACKFILL_FILE)), 'the list').toBe(true);
    expect((await get(w)).json(), 'a second dry run: nothing left, one already closed').toMatchObject({ mode: 'listed', listed: 1, closes: 0, closed: 1 });
  });

  it('RT-5: a count that is not the dry run\'s refuses count-changed (409) with the report, and writes nothing', async () => {
    const w = await world();
    const before = bytes(w);
    const r = await post(w, { act: 'pass', closes: 7 });
    expect([r.statusCode, r.json().error]).toEqual([409, 'count-changed']);
    expect(r.json()).toMatchObject({ report: { closes: 1 } });
    expect(REFUSAL_STATUS['count-changed']).toBe(DELEGATION_BACKFILL_REFUSALS['count-changed']);
    expect(bytes(w).equals(before)).toBe(true);
  });

  it('RT-6: the pass refuses sign-in-unarmed (403) for a caller that is not a signed-in operator; the undo and the dry run do not', async () => {
    const w = await world({ signedIn: false });
    const before = bytes(w);
    const r = await post(w, { act: 'pass', closes: 1 });
    expect([r.statusCode, r.json().error]).toEqual([403, 'sign-in-unarmed']);
    expect(bytes(w).equals(before)).toBe(true);
    expect((await get(w)).statusCode).toBe(200);
    expect((await post(w, { act: 'undo' })).json()).toMatchObject({ ok: true, act: 'undo', reopened: 0 });
  });

  it('RT-7: the undo reopens what the pass closed', async () => {
    const w = await world();
    const before = bytes(w);
    await post(w, { act: 'pass', closes: 1 });
    const r = await post(w, { act: 'undo' });
    expect(r.json()).toMatchObject({ ok: true, act: 'undo', reopened: 1 });
    const strip = (b: Buffer): unknown => ({ ...JSON.parse(b.toString('utf8')), revision: 0 });
    expect(strip(bytes(w)), 'the rows as before, the revision aside').toEqual(strip(before));
  });

  it('RT-8: a body that is not exactly {act: pass, closes} or {act: undo} answers 400, before the sign-in check', async () => {
    const w = await world({ signedIn: false });
    for (const body of [{}, { act: 'pass' }, { act: 'pass', closes: -1 }, { act: 'pass', closes: 1.5 }, { act: 'pass', closes: '1' },
      { act: 'undo', closes: 1 }, { act: 'close' }, { act: 'pass', closes: 1, extra: true }, []]) {
      const r = await post(w, body);
      expect([r.statusCode, r.json().error], JSON.stringify(body)).toEqual([400, 'bad-request']);
    }
  });

  it('RT-9: a list that does not read answers 503 unavailable, and nothing is written', async () => {
    const w = await world();
    writeFileSync(path.join(w.ccrc, DELEGATION_BACKFILL_FILE), 'not json');
    const before = bytes(w);
    expect([(await get(w)).statusCode, (await get(w)).json().error]).toEqual([503, 'unavailable']);
    expect([(await post(w, { act: 'pass', closes: 1 })).statusCode]).toEqual([503]);
    expect(bytes(w).equals(before)).toBe(true);
  });

  it('RT-10: SQLite\'s projection holds the closed row: ended, endedAt NULL, endBasis backfill-unmeasured (the column\'s CHECK admits it)', async () => {
    const w = await world({ sqlite: true });
    expect((await post(w, { act: 'pass', closes: 1 })).json()).toMatchObject({ ok: true, closed: 1, projection: 'projected' });
    const rows = w.coord!.db.prepare("SELECT upstreamId, executionState, endedAt, endBasis FROM delegation_activities WHERE sourceKind = 'agent' ORDER BY upstreamId").all();
    expect(rows).toEqual([
      { upstreamId: 'agent-x', executionState: 'active', endedAt: null, endBasis: null },
      { upstreamId: 'agent-z', executionState: 'ended', endedAt: null, endBasis: 'backfill-unmeasured' },
    ]);
    await post(w, { act: 'undo' });
    expect(w.coord!.db.prepare("SELECT executionState, endBasis FROM delegation_activities WHERE upstreamId = 'agent-z'").get())
      .toEqual({ executionState: 'active', endBasis: null });
  });
});
