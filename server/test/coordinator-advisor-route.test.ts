// Settings › Automation › "Coordinator advisor" (plan 2026-11-23-coordinator-advisor PR B, D-8967): the store's one row and
// its door, `GET`/`POST /api/coord/coordinator-advisor`, and the launch-profile lane writing the route field `advisor` from it.
// Off by default (the migration's seed, and a lost row). A bare Fastify, the plain-auto-memory route suite's idiom; the
// count lane's store writer and the readout are pinned here too, against a real coord.db.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Deps } from '../src/server.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { Bus } from '../src/bus.js';
import { EXEMPT, SECRET_UNREAD, authVerdict, type GateDecision, type GateDeps } from '../src/auth/gate.js';
import { coordinatorAdvisorOf } from '../src/continuity/advisorPolicy.js';
import { profilePass, type ProfileRow } from '../src/continuity/profileLane.js';
import { ADVISOR_ROUTE_CAP, ROUTE_CAP } from '../src/ccdargv.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const URL = '/api/coord/coordinator-advisor';
const ID = 'lane-a-project-a';
const apps: FastifyInstance[] = [];
afterEach(async () => { for (const a of apps.splice(0)) await a.close(); });

async function setup(): Promise<{ app: FastifyInstance; coord: CoordStore }> {
  const home = mkTmp('ccrc-advisor-route-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps: Deps = { ...testDeps(home), notifyLog, coord };
  const sessionAuth = (): GateDecision => ({ allow: true, verdict: 'ok', reason: 'session', device: null });
  const app = Fastify();
  registerCoordRoutes(app, deps, new Bus(), sessionAuth, { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null }, undefined);
  apps.push(app);
  return { app, coord };
}

const VIEW_TAIL = { default: { choice: 'off', cap: 12, scope: { kind: 'all' } }, choices: ['off', 'opus', 'fable'], capMin: 1, capMax: 200 };

describe('the coordinator advisor Settings row and its door (D-8967)', () => {
  it('a fresh database reads off, cap 12, every coordinator', async () => {
    const { app, coord } = await setup();
    expect(coordinatorAdvisorOf(coord.coordinatorAdvisorSettings())).toEqual({ choice: 'off', cap: 12, scope: { kind: 'all' } });
    const r = await app.inject({ method: 'GET', url: URL });
    expect(r.json()).toEqual({ ok: true, setting: { choice: 'off', cap: 12, scope: { kind: 'all' } }, ...VIEW_TAIL });
  });

  it('POST sets choice, cap and a named trial scope, and records who changed it', async () => {
    const { app, coord } = await setup();
    const body = { choice: 'fable', cap: 8, scope: { kind: 'sessions', ids: ['lane-b-project-b', ID] } };
    const r = await app.inject({ method: 'POST', url: URL, payload: body });
    expect(r.statusCode).toBe(200);
    expect(r.json().setting).toEqual({ choice: 'fable', cap: 8, scope: { kind: 'sessions', ids: [ID, 'lane-b-project-b'] } });
    const ev = coord.feedEvents(10).at(-1)!;
    expect([ev.title, ev.body]).toEqual(['coordinator advisor changed',
      `coordinator advisor: off, cap 12, every coordinator -> fable, cap 8, ${ID} lane-b-project-b; by flag-off`]);
  });

  it('a bad choice, cap or scope is a 400 and changes nothing', async () => {
    const { app, coord } = await setup();
    for (const bad of [{ choice: 'sonnet', cap: 5, scope: { kind: 'all' } }, { choice: 'opus', cap: 0, scope: { kind: 'all' } },
      { choice: 'opus', cap: 5, scope: { kind: 'sessions', ids: [] } }, { choice: 'opus', cap: 5 }, {}]) {
      const r = await app.inject({ method: 'POST', url: URL, payload: bad });
      expect(r.statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(coordinatorAdvisorOf(coord.coordinatorAdvisorSettings())?.choice).toBe('off');
  });

  it("it is the operator's door: in no EXEMPT row, so with sign-in armed a request without a session is refused", () => {
    const deps = { enabled: true, secret: SECRET_UNREAD } as unknown as GateDeps;
    for (const method of ['GET', 'POST']) {
      expect(EXEMPT.has(`${method} ${URL}`)).toBe(false);
      expect(authVerdict({ method, routeOptions: { url: URL }, headers: {} }, deps, 0).allow).toBe(false);
    }
  });
});

// ── The lane writes `advisor` (plan PR B Task 5) ─────────────────────────────────────────────────────────────────
const NOW = Date.parse('2026-11-24T12:00:00Z');
async function lanePass(coord: CoordStore, caps: readonly string[], row: Partial<ProfileRow> = {},
  usageClass: string | null = 'opus', o: { mode?: 'live' | 'shadow'; steer?: 'absent' | 'present' | 'unreadable' } = {}):
  Promise<{ sets: string[][]; lines: string[] }> {
  const sets: string[][] = []; const lines: string[] = [];
  coord.setLaneArm('launch-profile', o.mode ?? 'live', 1);
  await profilePass({
    coord, log: (l) => lines.push(l), memory: { lastLine: null }, now: () => NOW,
    reads: {
      usage: async () => ({ kind: 'reading', uuid: null, usage: { ts: NOW / 1000, model: 'claude-opus-5-5', class: usageClass, effort: null, ctxPct: null,
        ctxTokens: null, ctxWindow: null, cost: null, cacheExpiresAt: null, stale: false } as never }),
      steerMarker: async () => o.steer ?? 'absent', declaredIntent: async () => true, buildAgreement: () => 'agreed',
      anthropicLane: (lane) => (lane === 'lane-a' ? true : lane === 'lane-b' ? false : 'unmeasured'),
    },
    act: { runCcd: async (argv) => { sets.push([...argv].filter((_, i, a) => a[i - 1] === '--set')); return { ok: true, stdout: '', stderr: '', ran: true } as never; },
      fleetState: { ccdVerbs: [...caps] } },
  }, [{ id: ID, child: { kind: 'none' }, route: null, wrapper: 'lane-a', ...row }]);
  return { sets, lines };
}
const advisorSets = (sets: string[][]): string[] => sets.flat().filter((s) => s.startsWith('advisor='));

describe('the launch-profile lane writes the advisor field (D-8967)', () => {
  it('absent setting (the seed, off): no advisor in any diff', async () => {
    const { coord } = await setup();
    const { sets } = await lanePass(coord, [ROUTE_CAP, ADVISOR_ROUTE_CAP]);
    expect(sets).toEqual([['profile=coordinator', 'automem=off']]);
  });

  it('on, for an Opus coordinator on an Anthropic lane: advisor=fable rides the profile write', async () => {
    const { coord } = await setup();
    coord.setCoordinatorAdvisor({ choice: 'fable', cap: 12, scope: { kind: 'all' } }, 1);
    expect(advisorSets((await lanePass(coord, [ROUTE_CAP, ADVISOR_ROUTE_CAP])).sets)).toEqual(['advisor=fable']);
  });

  it('never without the caps word: an older ccd would refuse the whole call', async () => {
    const { coord } = await setup();
    coord.setCoordinatorAdvisor({ choice: 'fable', cap: 12, scope: { kind: 'all' } }, 1);
    const { sets } = await lanePass(coord, [ROUTE_CAP]);
    expect(sets).toEqual([['profile=coordinator', 'automem=off']]);
  });

  it('a non-Opus main model, a non-Anthropic lane, or out of scope: nothing written; a standing field is cleared', async () => {
    const { coord } = await setup();
    coord.setCoordinatorAdvisor({ choice: 'fable', cap: 12, scope: { kind: 'all' } }, 1);
    expect(advisorSets((await lanePass(coord, [ROUTE_CAP, ADVISOR_ROUTE_CAP], {}, 'sonnet')).sets)).toEqual([]);
    expect(advisorSets((await lanePass(coord, [ROUTE_CAP, ADVISOR_ROUTE_CAP], { wrapper: 'lane-b' })).sets)).toEqual([]);
    const standing = { route: { fields: { profile: 'coordinator', automem: 'off', advisor: 'fable' }, degraded: null, inert: [], unreadable: [] } } as never;
    coord.setCoordinatorAdvisor({ choice: 'fable', cap: 12, scope: { kind: 'sessions', ids: ['someone-else'] } }, 2);
    expect(advisorSets((await lanePass(coord, [ROUTE_CAP, ADVISOR_ROUTE_CAP], standing)).sets)).toEqual(['advisor=']);
  });

  it('with the lane back in shadow, or a steer marker standing, Off and the cap still clear the field, alone (review F2)', async () => {
    const { coord } = await setup();
    const standing = { route: { fields: { profile: 'coordinator', automem: 'off', advisor: 'fable' }, degraded: null, inert: [], unreadable: [] } } as never;
    coord.setCoordinatorAdvisor({ choice: 'off', cap: 12, scope: { kind: 'all' } }, 1);
    expect((await lanePass(coord, [ROUTE_CAP, ADVISOR_ROUTE_CAP], standing, 'opus', { mode: 'shadow' })).sets).toEqual([['advisor=']]);
    expect((await lanePass(coord, [ROUTE_CAP, ADVISOR_ROUTE_CAP], standing, 'opus', { steer: 'present' })).sets).toEqual([['advisor=']]);
    expect((await lanePass(coord, [ROUTE_CAP, ADVISOR_ROUTE_CAP], standing, 'opus', { steer: 'unreadable' })).sets).toEqual([['advisor=']]);
    // shadow never adds one, and never writes the profile's own fields
    coord.setCoordinatorAdvisor({ choice: 'fable', cap: 12, scope: { kind: 'all' } }, 2);
    expect((await lanePass(coord, [ROUTE_CAP, ADVISOR_ROUTE_CAP], {}, 'opus', { mode: 'shadow' })).sets).toEqual([]);
    expect((await lanePass(coord, [ROUTE_CAP, ADVISOR_ROUTE_CAP], {}, 'opus', { steer: 'present' })).sets).toEqual([]);
  });

  it('a lane the roster does not name leaves the field alone, unless a measured reason removes it (review F9)', async () => {
    const { coord } = await setup();
    coord.setCoordinatorAdvisor({ choice: 'fable', cap: 1, scope: { kind: 'all' } }, 1);
    expect(advisorSets((await lanePass(coord, [ROUTE_CAP, ADVISOR_ROUTE_CAP], { wrapper: 'lane-gone' })).sets)).toEqual([]);
  });

  it('at the cap the lane clears the field (D-8970), from the count the count lane recorded', async () => {
    const { coord } = await setup();
    coord.setCoordinatorAdvisor({ choice: 'fable', cap: 2, scope: { kind: 'all' } }, 1);
    const state = { file: '/t', offset: 1, spawnAt: 1, requests: 0, lastMessageId: null, available: null, availableAt: null, lastCallAt: null, unreadable: 0, droppedDay: null };
    coord.recordAdvisorRead(ID, state, [1, 2].map((n) => ({ callId: `c${n}`, day: '2026-11-24', at: NOW, model: null, tokens: null })), NOW, '2026-11-10');
    const standing = { route: { fields: { profile: 'coordinator', automem: 'off', advisor: 'fable' }, degraded: null, inert: [], unreadable: [] } } as never;
    expect(advisorSets((await lanePass(coord, [ROUTE_CAP, ADVISOR_ROUTE_CAP], standing)).sets)).toEqual(['advisor=']);
  });
});

describe('the count lane\'s one writer (D-8971)', () => {
  it('a call recorded twice counts once; a later line fills its usage; the day count sums the tokens', async () => {
    const { coord } = await setup();
    const state = { file: '/t', offset: 10, spawnAt: 5, requests: 1, lastMessageId: 'm', available: 'true' as const, availableAt: 1, lastCallAt: 2, unreadable: 0, droppedDay: null };
    coord.recordAdvisorRead(ID, state, [{ callId: 'c1', day: '2026-11-24', at: 1, model: null, tokens: null }], 1, '2026-11-10');
    coord.recordAdvisorRead(ID, { ...state, offset: 20 }, [{ callId: 'c1', day: '2026-11-24', at: 1, model: 'claude-fable-5',
      tokens: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 } }], 2, '2026-11-10');
    expect(coord.advisorDayCounts('2026-11-24').get(ID)).toEqual({ calls: 1, tokens: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 } });
    expect(coord.advisorReadState(ID)).toEqual({ ...state, offset: 20 });
    // a later measured usage replaces an earlier one (a later streamed line is the fuller); a line with none leaves it (review F8)
    coord.recordAdvisorRead(ID, { ...state, offset: 30, droppedDay: '2026-11-24' }, [{ callId: 'c1', day: '2026-11-24', at: 1, model: null,
      tokens: { input: 400, output: 80, cacheRead: 0, cacheWrite: 0 } }], 3, '2026-11-10');
    coord.recordAdvisorRead(ID, { ...state, offset: 40, droppedDay: '2026-11-24' }, [{ callId: 'c1', day: '2026-11-24', at: 1, model: null, tokens: null }], 4, '2026-11-10');
    expect(coord.advisorDayCounts('2026-11-24').get(ID)).toEqual({ calls: 1, tokens: { input: 400, output: 80, cacheRead: 0, cacheWrite: 0 } });
    expect(coord.advisorReadState(ID)?.droppedDay).toBe('2026-11-24');
  });
  it('rows older than the kept days are pruned by the writer', async () => {
    const { coord } = await setup();
    const state = { file: '/t', offset: 0, spawnAt: 0, requests: 0, lastMessageId: null, available: null, availableAt: null, lastCallAt: null, unreadable: 0, droppedDay: null };
    coord.recordAdvisorRead(ID, state, [{ callId: 'old', day: '2026-11-01', at: 1, model: null, tokens: null }], 1, '2026-10-01');
    coord.recordAdvisorRead(ID, state, [], 2, '2026-11-10');
    expect(coord.advisorDayCounts('2026-11-01').size).toBe(0);
  });
});
