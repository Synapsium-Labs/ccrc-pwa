// The timer doors' two production bindings, through the REAL server (review 3841 F2; Overlord W1, plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-overlord-timers.md` Task 3). `buildServer` hands the gate runner its
// launch-profile port (`server.ts`, the other lanes' one reader) and the continuity routes the restore generation port
// (`deps.overlordRestore`). Every other test builds its own runner or passes the ports in by hand, so deleting either binding
// turned nothing red: here a deletion does. Fixture HOMEs only, neutral names.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../src/server.js';
import type { CoordStore } from '../src/coord/store.js';
import { ID_GATE_TOKEN, appFor, recorder, seedRow } from './idGateFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const COORD = 'lane-a-project-a';
const WORKER = 'lane-b-project-a';
const BODY = 'lane-o-project-a';
const INC = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const HOUR = 3_600_000;
const uuidOf = (id: string): string => `u-${id}`;
const H = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
const EPISODE = 'ccrc-server: the Overlord designation is unreadable';

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  vi.restoreAllMocks();
  removeTmpFixtures();
});

async function world(over: Partial<Omit<Deps, 'cfg'>> = {}): Promise<{ app: FastifyInstance; coord: CoordStore }> {
  const home = mkTmp('ccrc-timer-real-bindings-');
  for (const id of [COORD, WORKER]) seedRow(home, id, { uuid: uuidOf(id), project: 'project-a', generation: INC });
  seedRow(home, BODY, { uuid: uuidOf(BODY), project: 'project-a', generation: INC, profile: 'overlord' });
  const built = await appFor(home, recorder().run, over);
  app = built.app;
  await built.app.ready();
  return built;
}
const set = (a: FastifyInstance, from: string) => a.inject({ method: 'POST', url: '/api/timers', headers: H,
  payload: { fromId: from, fromUuid: uuidOf(from), durationMs: 2 * HOUR, note: 'check the board' } });
const list = (a: FastifyInstance, by: string) => a.inject({ method: 'GET', url: `/api/timers?${new URLSearchParams({ byId: by, byUuid: uuidOf(by) })}`, headers: H });
const cancel = (a: FastifyInstance, from: string, id: number) => a.inject({ method: 'POST', url: `/api/timers/${id}/cancel`, headers: H,
  payload: { fromId: from, fromUuid: uuidOf(from) } });

describe('the gate\'s launch-profile port at the three timer doors, through the real server', () => {
  it('with the designation unreadable, a coordinator and a worker are served at all three doors, one profiled overlord is refused, and one episode line is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = await world();
    vi.spyOn(w.coord, 'designationRead').mockReturnValue({ kind: 'unmeasured', why: 'fixture: the row is unreadable' });
    for (const caller of [COORD, WORKER]) {
      const s = await set(w.app, caller);
      expect(s.statusCode, `${caller} set: ${s.body}`).toBe(201);
      const l = await list(w.app, caller);
      expect(l.statusCode, `${caller} list: ${l.body}`).toBe(200);
      expect((l.json() as { timers: unknown[] }).timers).toHaveLength(1);
      const c = await cancel(w.app, caller, (s.json() as { id: number }).id);
      expect(c.statusCode, `${caller} cancel: ${c.body}`).toBe(200);
    }
    // The port is read: a caller whose launch profile reads the Overlord's word is refused while the designation is unreadable.
    const refused = await set(w.app, BODY);
    expect(refused.statusCode, refused.body).toBe(503);
    // The plan's case: timer calls under one unmeasured episode log its line once, not once per call.
    expect(warn.mock.calls.filter((c) => String(c[0]).startsWith(EPISODE))).toHaveLength(1);
  });
});

describe('the restore generation port at the set door, through the real server', () => {
  it('a set stores the restore generation the server\'s restore state answers, never null while it is measured', async () => {
    const restore = { restoreGeneration: () => ({ kind: 'measured' as const, n: 3 }) } as unknown as NonNullable<Deps['overlordRestore']>;
    const w = await world({ overlordRestore: restore });
    const s = await set(w.app, COORD);
    expect(s.statusCode, s.body).toBe(201);
    const row = w.coord.db.prepare('SELECT setRestoreGeneration FROM continuity_timers WHERE id = ?').get((s.json() as { id: number }).id) as { setRestoreGeneration: number | null };
    expect(row.setRestoreGeneration).toBe(3);
  });
});
