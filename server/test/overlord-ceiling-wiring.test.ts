// Overlord W2, act rows A (Task A6's count reader; the coordinator's items 6a and 6c): gate step 10's two producers as the
// composition root builds them (`overlordCeilingWiring.ts`), over a fixture store and the ladder's real one writer. The standing
// read, a raise that lands, a refused raise (one log line in the server's form) and a raise that throws (one line, then the throw
// the runner swallows). Fixture databases in temp dirs only, never the live HOME.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import Fastify from 'fastify';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NO_LADDER_AUTHORITY } from '../src/coord/overlordAuthorityJournal.js';
import { raiseLatch } from '../src/coord/overlordLadderRead.js';
import { ACT_CEILING_LATCH } from '../src/coord/overlordActCeiling.js';
import { actCountPort, ceilingLatchPorts } from '../src/coord/overlordCeilingWiring.js';
import { overlordGateRun, type OverlordGateDeps } from '../src/coord/overlordGateRun.js';
import { OVERLORD_DOORS, type DoorRow, type OverlordDoorRow } from '../src/coord/overlordDoors.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import type { RecordedActor } from '../src/auth/callerIdentity.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(async () => { await removeTmpFixtures(); });

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-ceiling-wiring-'), 'coord.db')));
const ladderDeps = (coord: CoordStore) => ({ coord, journal: NO_LADDER_AUTHORITY, clock: { wall: () => 1_000 }, entropy: { hex: (n: number) => 'c'.repeat(2 * n) } });
const realRaise = (coord: CoordStore) => (detail: string, actor: RecordedActor) => raiseLatch(ladderDeps(coord), ACT_CEILING_LATCH, detail, actor);

describe('the composed latch ports', () => {
  it('the standing read: no store or an unreadable one is unmeasured; a measured one says whether act-ceiling-hit stands', () => {
    const warn: string[] = [];
    expect(ceilingLatchPorts({ rows: () => undefined, raise: undefined, warn: (l) => warn.push(l) }).standing()).toBe('unmeasured');
    expect(ceilingLatchPorts({ rows: () => ({ kind: 'unmeasured', why: 'locked' }), raise: undefined, warn: (l) => warn.push(l) }).standing()).toBe('unmeasured');
    const coord = store();
    const ports = ceilingLatchPorts({ rows: () => coord.ladderRows(), raise: realRaise(coord), warn: (l) => warn.push(l) });
    expect(ports.standing()).toBe(false);
    expect(raiseLatch(ladderDeps(coord), 'probes-failed-twice', 'another cause', { kind: 'lane', lane: 'renewal-lane' } as never)).toMatchObject({ ok: false });
    expect(ports.standing()).toBe(false);
    coord.db.close();
    expect(warn).toEqual([]);
  });

  it('a refused raise warns one line in the server\'s form and raises nothing; the standing read stays false', () => {
    const coord = store();
    const warn: string[] = [];
    const ports = ceilingLatchPorts({ rows: () => coord.ladderRows(), raise: realRaise(coord), warn: (l) => warn.push(l) });
    // A literal is no minted actor, so the ladder's one writer refuses it.
    ports.raise('relay all 30', { kind: 'session', subject: 'lane-a-overlord' } as never);
    expect(warn).toEqual(['ccrc-server: act-ceiling-hit latch not raised: actor']);
    expect(ports.standing()).toBe(false);
    expect(coord.db.prepare('SELECT COUNT(*) AS n FROM overlord_latches').get()).toEqual({ n: 0 });
    coord.db.close();
  });

  it('a raise that throws warns one line, then throws, so the runner\'s swallow decides; no store raises nothing', () => {
    const warn: string[] = [];
    const ports = ceilingLatchPorts({ rows: () => undefined, raise: () => { throw new Error('the journal is gone'); }, warn: (l) => warn.push(l) });
    expect(() => ports.raise('relay all 30', {} as never)).toThrow('the journal is gone');
    expect(warn).toEqual(['ccrc-server: act-ceiling-hit latch raise threw: the journal is gone']);
    const none = ceilingLatchPorts({ rows: () => undefined, raise: undefined, warn: (l) => warn.push(l) });
    expect(none.raise('x', {} as never)).toBeUndefined();
    expect(warn).toHaveLength(1);
  });

  it('a raise the writer accepts warns nothing', () => {
    const coord = store();
    const warn: string[] = [];
    const ok = ceilingLatchPorts({ rows: () => coord.ladderRows(), warn: (l) => warn.push(l),
      raise: () => ({ ok: true, changed: true, journalled: false, recordSequence: null }) });
    ok.raise('relay all 30', {} as never);
    expect(warn).toEqual([]);
    coord.db.close();
  });
});

describe('through the runner, with the composed ports and the real count', () => {
  const BODY = 'lane-a-overlord';
  const DESIGNATED = { kind: 'designated', sessionId: BODY, term: 1,
    row: { bound: { sessionId: BODY, generation: 'inc-1' }, pending: null, term: 1, designatedTerm: 1 } } as unknown as DesignationRead;
  const deps = (over: Partial<OverlordGateDeps>): OverlordGateDeps => ({
    identity: { session: async (sessionId, uuid) => ({ ok: true, sessionId, uuid, actor: { kind: 'session', subject: sessionId } as never }),
      incarnation: async () => ({ kind: 'measured', incarnation: 'inc-1' }) as never },
    designation: () => DESIGNATED, authority: () => ({ kind: 'coherent' }),
    ladder: () => ({ kind: 'read', rung: { rung: 'full', operatorRung: 'full', binding: [], readBy: [] } }),
    generations: () => ({ ok: true, rows: [{ id: 9, identity: 'overlord', sessionId: BODY, n: 3, term: 1, startId: 4, state: 'active' }] }) as never,
    continuityLive: () => true, cardRead: () => ({ ok: true, read: { current: true } }) as never,
    actKey: () => ({ kind: 'unmeasured', why: 'unused' }), counter: () => 'unmeasured', witness: () => ({ kind: 'unmeasured', why: 'unused' }),
    recordWitness: () => true, recordFenceRefusal: () => undefined, serverWords: () => ['overlord-v1', 'continuity-v1', 'timers-v1'],
    now: () => 1_800_000_000_000, ...over,
  });
  const call = async (d: OverlordGateDeps, key: string) => {
    const app = Fastify({ logger: false });
    const run = overlordGateRun(d);
    app.get('/gate', async (req, reply) => { const g = await run(req, reply, key, { sessionId: BODY, uuid: 'u-1', uuidField: 'byUuid' }); return g.kind === 'refused' ? reply : { ok: true, gate: g.kind }; });
    await app.ready();
    try { const r = await app.inject({ method: 'GET', url: '/gate' }); return { status: r.statusCode, body: JSON.parse(r.body) as Record<string, unknown> }; } finally { await app.close(); }
  };

  it('a ceiling hit refuses act-ceiling, and a raise the writer refuses warns one line while the call still refuses as before', async () => {
    const coord = store();
    const warn: string[] = [];
    const table = OVERLORD_DOORS as Record<string, DoorRow>;
    table['zz-relay'] = { ...(OVERLORD_DOORS.sequence as OverlordDoorRow), act: 'relay' };
    try {
      const full = { count: () => ({ kind: 'counted', programme: null, all: 30 }) as const };
      const r = await call(deps({ actCount: full, ceilingLatch: ceilingLatchPorts({ rows: () => coord.ladderRows(), raise: realRaise(coord), warn: (l) => warn.push(l) }) }), 'zz-relay');
      expect([r.status, r.body.error]).toEqual([429, 'act-ceiling']);
      expect(warn).toEqual(['ccrc-server: act-ceiling-hit latch not raised: actor']);
      const thrown = await call(deps({ actCount: full, ceilingLatch: ceilingLatchPorts({ rows: () => coord.ladderRows(), raise: () => { throw new Error('gone'); }, warn: (l) => warn.push(l) }) }), 'zz-relay');
      expect([thrown.status, thrown.body.error]).toEqual([429, 'act-ceiling']);
      expect(warn.at(-1)).toBe('ccrc-server: act-ceiling-hit latch raise threw: gone');
      const real = await call(deps({ actCount: actCountPort(coord), ceilingLatch: ceilingLatchPorts({ rows: () => coord.ladderRows(), raise: realRaise(coord), warn: (l) => warn.push(l) }) }), 'zz-relay');
      expect(real.body).toEqual({ ok: true, gate: 'pass' });
    } finally { delete table['zz-relay']; coord.db.close(); }
  });
});
