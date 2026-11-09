// Programme ledgers (plan PL4): the `waiting` frame on /ws/fleet. Sent on connect and on every bus 'waiting' (a
// coordinator's write or the operator's tick), through `maskedFrame` like the delegation frame, additive with no
// `FLEET_PROTO` bump. Real server over a fixture HOME, a real socket, neutral names (prog-a, lane-a).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { ID_GATE_TOKEN, recorder, seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { FLEET_PROTO, SECRET_MASK, type FleetMsg } from '../../shared/api.js';
import { TICK_UNANSWERED_MS, type WaitingView } from '../../shared/ledgers.js';

type WaitingFrame = Extract<FleetMsg, { type: 'waiting' }>;

const HEADERS = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
const NOW0 = Date.UTC(2026, 10, 2, 9, 0, 0);

let app: FastifyInstance | null = null;
const sockets: WebSocket[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of sockets.splice(0)) s.close();
  await app?.close();
  app = null;
  removeTmpFixtures();
});

interface Rig { app: FastifyInstance; coord: CoordStore; bus: Bus; port: number; runA: number }

async function rig(withCoord = true): Promise<Rig> {
  const home = mkTmp('ccrc-ledgers-frame-');
  seedRow(home, 'lane-a');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const bus = new Bus();
  app = await buildServer({ ...testDeps(home, recorder().run), mailToken: ID_GATE_TOKEN, ...(withCoord ? { coord } : {}) }, bus);
  const runA = (coord.openRun({ program: 'prog-a', title: 'PROG-A', project: 'project-a', wave: 1, waveOf: null, claimedBy: 'lane-a' }) as { id: number }).id;
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  return { app, coord, bus, port: typeof addr === 'object' && addr !== null ? addr.port : 0, runA };
}

/** A socket that keeps every message; `until` resolves with the Nth `waiting` frame seen so far or to come. */
function connect(port: number): { frames: () => FleetMsg[]; waitingFrame: (n: number) => Promise<WaitingFrame>; raw: () => string[]; typeCount: (t: string) => number; typeFrame: (t: string, n: number) => Promise<FleetMsg> } {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
  sockets.push(ws);
  const raw: string[] = [];
  const parsed: FleetMsg[] = [];
  const listeners: (() => void)[] = [];
  ws.on('message', (d) => { raw.push(String(d)); parsed.push(JSON.parse(String(d)) as FleetMsg); listeners.forEach((l) => l()); });
  const waitings = (): WaitingFrame[] => parsed.filter((m): m is WaitingFrame => m.type === 'waiting');
  const typeFrame = (t: string, n: number): Promise<FleetMsg> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${t} frame #${n}; got ${parsed.map((m) => m.type).join(',')}`)), 4000);
    const check = (): void => { const f = parsed.filter((m) => m.type === t)[n - 1]; if (f) { clearTimeout(timer); resolve(f); } };
    listeners.push(check);
    check();
  });
  return {
    frames: () => parsed, raw: () => raw, typeCount: (t) => parsed.filter((m) => m.type === t).length, typeFrame,
    waitingFrame: (n) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no waiting frame #${n}; got ${parsed.map((m) => m.type).join(',')}`)), 4000);
      const check = (): void => { const w = waitings()[n - 1]; if (w) { clearTimeout(t); resolve(w); } };
      listeners.push(check);
      check();
    }),
  };
}

const raise = async (r: Rig, over: Record<string, unknown> = {}) =>
  r.app.inject({
    method: 'POST', url: '/api/programmes/prog-a/items', headers: HEADERS,
    payload: { byId: 'lane-a', byUuid: 'u-lane-a', kind: 'do', title: 'Turn on the setting', why: 'The wave needs it.', how: ['Open Settings'],
      neededBy: 'later', runId: r.runA, ...over } as never,
  });

describe('the waiting frame (plan PL4)', () => {
  it('carries a big call, rebuilds when one is recorded and again when it is Seen (D-8126)', async () => {
    const r = await rig();
    const sock = connect(r.port);
    expect((await sock.waitingFrame(1)).waiting.calls).toEqual([]);
    const res = await r.app.inject({
      method: 'POST', url: '/api/coord/programmes/prog-a/calls', headers: HEADERS,
      payload: { byId: 'lane-a', byUuid: 'u-lane-a', class: 'big', question: 'Which name?', options: ['a', 'b'], chosen: 'a', why: 'Shorter.', reversible: false } as never,
    });
    expect(res.statusCode, res.body).toBe(200);
    const id = (res.json() as { id: number }).id;
    const second = await sock.waitingFrame(2);
    expect(second.waiting.calls!.map((c) => c.id)).toEqual([id]);
    expect(second.waiting.callsCleared).toEqual([]);
    expect((await r.app.inject({ method: 'POST', url: `/api/calls/${id}/seen`, payload: {} as never })).statusCode).toBe(200);
    const third = await sock.waitingFrame(3);
    expect(third.waiting.calls).toEqual([]);
    expect(third.waiting.callsCleared!.map((c) => c.id)).toEqual([id]);
  });

  it('is sent on connect, with the whole view, and FLEET_PROTO stays 1', async () => {
    const r = await rig();
    r.coord.raiseItem({ program: 'prog-a', runId: r.runA, raisedBy: 'lane-a', kind: 'do', title: 'First', why: 'w', how: [], options: null, neededBy: 'soon', soonLabel: null, secretSlot: null }, NOW0);
    const sock = connect(r.port);
    const f = await sock.waitingFrame(1);
    expect(f.type).toBe('waiting');
    expect(f.waiting.items.map((i) => i.title)).toEqual(['First']);
    expect(f.waiting.cleared).toEqual([]);
    expect(FLEET_PROTO).toBe(1);
  });

  it('is sent again after a raise, and again after the operator\'s tick', async () => {
    const r = await rig();
    const sock = connect(r.port);
    expect((await sock.waitingFrame(1)).waiting.items).toEqual([]);
    const made = await raise(r);
    expect(made.statusCode, made.body).toBe(200);
    const id = (made.json() as { id: number }).id;
    const second = await sock.waitingFrame(2);
    expect(second.waiting.items.map((i) => [i.id, i.state])).toEqual([[id, 'open']]);
    const ticked = await r.app.inject({ method: 'POST', url: `/api/items/${id}/tick`, payload: {} as never });
    expect(ticked.statusCode, ticked.body).toBe(200);
    const third = await sock.waitingFrame(3);
    expect(third.waiting.items.map((i) => [i.id, i.state])).toEqual([[id, 'checking']]);
  });

  it('shows a held item within one emit of its hold ending, and not before (D-8076)', async () => {
    const r = await rig();
    vi.spyOn(Date, 'now').mockReturnValue(NOW0);
    r.coord.raiseItem({ program: 'prog-a', runId: r.runA, raisedBy: 'lane-a', kind: 'do', title: 'Held', why: 'w', how: [], options: null,
      neededBy: 'soon', soonLabel: null, secretSlot: null, action: { verb: 'end-run', runId: r.runA, stuckReason: null }, heldUntil: NOW0 + 180_000 }, NOW0, 'ccrc');
    const sock = connect(r.port);
    expect((await sock.waitingFrame(1)).waiting.items).toEqual([]);
    vi.spyOn(Date, 'now').mockReturnValue(NOW0 + 179_999);
    r.bus.emit('waiting');
    expect((await sock.waitingFrame(2)).waiting.items).toEqual([]);
    vi.spyOn(Date, 'now').mockReturnValue(NOW0 + 180_000);
    r.bus.emit('waiting');
    expect((await sock.waitingFrame(3)).waiting.items.map((i) => i.title)).toEqual(['Held']);
  });

  it('is sent to every connected socket on one emit', async () => {
    const r = await rig();
    const a = connect(r.port);
    const b = connect(r.port);
    await a.waitingFrame(1); await b.waitingFrame(1);
    r.bus.emit('waiting');
    const [fa, fb] = await Promise.all([a.waitingFrame(2), b.waitingFrame(2)]);
    expect(fa.waiting).toEqual(fb.waiting);
  });

  it('is not sent on a box with no coordination database', async () => {
    const r = await rig(false);
    const sock = connect(r.port);
    await sock.typeFrame('hello', 1);
    r.bus.emit('waiting');
    r.bus.emit('fleet', []);
    // The fleet frame is sent by the same socket after any waiting frame the emit would have caused, so once it is here the answer is final.
    await sock.typeFrame('fleet', 1);
    expect(sock.typeCount('waiting')).toBe(0);
  });

  it('passes through the masker: a shaped secret planted in an item title carries the mask', async () => {
    const r = await rig();
    const key = ['sk', 'ant', 'api03', createHash('sha256').update('frame').digest('base64url').repeat(3).slice(0, 95)].join('-');
    r.coord.raiseItem({ program: 'prog-a', runId: r.runA, raisedBy: 'lane-a', kind: 'do', title: `Paste ${key} there`, why: `because ${key}`, how: [`run ${key}`], options: null, neededBy: 'soon', soonLabel: null, secretSlot: null }, NOW0);
    const sock = connect(r.port);
    await sock.waitingFrame(1);
    const text = sock.raw().filter((s) => s.includes('"waiting"')).join('');
    expect(text).not.toContain(key.slice(8, 40));
    expect(text).toContain(SECRET_MASK);
  });

  it('carries the stale verdict the routes carry: one builder', async () => {
    const r = await rig();
    const id = r.coord.raiseItem({ program: 'prog-a', runId: r.runA, raisedBy: 'lane-a', kind: 'do', title: 'T', why: 'w', how: [], options: null, neededBy: 'soon', soonLabel: null, secretSlot: null }, NOW0);
    const sock = connect(r.port);
    await sock.waitingFrame(1);
    await r.app.inject({ method: 'POST', url: `/api/items/${id}/tick`, payload: {} as never });
    const frame = await sock.waitingFrame(2);
    const route = ((await r.app.inject({ method: 'GET', url: '/api/waiting' })).json() as { waiting: WaitingView }).waiting;
    expect(frame.waiting.items.map((i) => ({ ...i, history: [] }))).toEqual(route.items.map((i) => ({ ...i, history: [] })));
  });

  it('review 1335 F3: a later fleet emit re-sends the frame when a checking item crosses TICK_UNANSWERED_MS, and not when nothing changed', async () => {
    const r = await rig();
    const id = r.coord.raiseItem({ program: 'prog-a', runId: r.runA, raisedBy: 'lane-a', kind: 'do', title: 'T', why: 'w', how: [], options: null, neededBy: 'soon', soonLabel: null, secretSlot: null }, NOW0);
    vi.spyOn(Date, 'now').mockReturnValue(NOW0);
    const sock = connect(r.port);
    await sock.waitingFrame(1);
    // The cold burst ends with the waiting frame, so every fleet frame it holds is in: the baseline the emits below count from.
    const c0 = sock.typeCount('fleet');
    await r.app.inject({ method: 'POST', url: `/api/items/${id}/tick`, payload: {} as never });
    expect((await sock.waitingFrame(2)).waiting.items[0]).toMatchObject({ id, state: 'checking', stale: false });
    // Nothing changed on this fleet emit: no waiting frame follows it. The sentinel emit after it proves the first is done.
    r.bus.emit('fleet', []);
    r.bus.emit('fleet', []);
    await sock.typeFrame('fleet', c0 + 2);
    expect(sock.typeCount('waiting'), 'an unchanged frame was re-sent').toBe(2);
    // The clock crosses the window; the next fleet emit carries the new label.
    vi.spyOn(Date, 'now').mockReturnValue(NOW0 + TICK_UNANSWERED_MS);
    r.bus.emit('fleet', []);
    expect((await sock.waitingFrame(3)).waiting.items[0]).toMatchObject({ id, state: 'checking', stale: true });
    // …and once sent it is not sent again while it holds.
    r.bus.emit('fleet', []);
    r.bus.emit('fleet', []);
    await sock.typeFrame('fleet', c0 + 5);
    expect(sock.typeCount('waiting')).toBe(3);
  });

  it('review 1335 F7: a frame that cannot be built is not sent, and the warning carries no secret', async () => {
    const r = await rig();
    const id = r.coord.raiseItem({ program: 'prog-a', runId: r.runA, raisedBy: 'lane-a', kind: 'do', title: 'T', why: 'w', how: [], options: null, neededBy: 'soon', soonLabel: null, secretSlot: null }, NOW0);
    const key = ['sk', 'ant', 'api03', createHash('sha256').update('warn').digest('base64url').repeat(3).slice(0, 95)].join('-');
    // A row this box cannot read: the store's own error carries session-written text (here a whole shaped key).
    vi.spyOn(r.coord, 'itemsFor').mockImplementation(() => { throw new Error(`operator item ${id}: how is not a string list: ${key}`); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sock = connect(r.port);
    await sock.typeFrame('hello', 1);
    await sock.typeFrame('runs', 1);
    expect(sock.typeCount('waiting')).toBe(0);
    const text = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(text).toContain('waiting frame not built');
    expect(text).not.toContain(key.slice(8, 40));
  });

  it('review 1336 F4: a view that cannot be built is attempted once per change, not once per socket, and warned once per distinct error', async () => {
    const r = await rig();
    r.coord.raiseItem({ program: 'prog-a', runId: r.runA, raisedBy: 'lane-a', kind: 'do', title: 'T', why: 'w', how: [], options: null, neededBy: 'soon', soonLabel: null, secretSlot: null }, NOW0);
    const itemsFor = vi.spyOn(r.coord, 'itemsFor').mockImplementation(() => { throw new Error('operator item 1: how is not a string list'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const socks = [connect(r.port), connect(r.port), connect(r.port)];
    // The cold burst ends with the `runs` frame and then the waiting attempt, in one synchronous step: once `runs` is here, the attempt is made.
    for (const s of socks) await s.typeFrame('runs', 1);
    const fleet0 = socks.map((s) => s.typeCount('fleet'));
    const built0 = itemsFor.mock.calls.length;
    for (let i = 0; i < 3; i += 1) r.bus.emit('fleet', []);
    for (const [i, s] of socks.entries()) await s.typeFrame('fleet', fleet0[i]! + 3);
    expect(itemsFor.mock.calls.length - built0, 'one attempt per fleet emit, shared by the three sockets').toBe(3);
    const lines = warn.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('waiting frame not built'));
    expect(lines, 'one warning for the one distinct error, across sockets and emits').toHaveLength(1);
    for (const s of socks) expect(s.typeCount('waiting')).toBe(0);
  });

  // Review 1338 F3 (desktop-polish carry): "once per distinct error" in the two directions the one-error case cannot
  // see: a different error after the first is warned too, and a success between two failures re-arms the warning.
  const scripted = async (outcomes: readonly ('ok' | string)[]) => {
    const r = await rig();
    r.coord.raiseItem({ program: 'prog-a', runId: r.runA, raisedBy: 'lane-a', kind: 'do', title: 'T', why: 'w', how: [], options: null, neededBy: 'soon', soonLabel: null, secretSlot: null }, NOW0);
    const real = r.coord.itemsFor.bind(r.coord);
    let call = 0;
    const itemsFor = vi.spyOn(r.coord, 'itemsFor').mockImplementation((...args) => {
      const o = outcomes[Math.min(call, outcomes.length - 1)]!;
      call += 1;
      if (o === 'ok') return real(...args);
      throw new Error(o);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sock = connect(r.port);
    await sock.typeFrame('runs', 1);
    for (let i = 1; i < outcomes.length; i += 1) {
      const seen = sock.typeCount('fleet');
      r.bus.emit('fleet', []);
      await sock.typeFrame('fleet', seen + 1);
    }
    expect(itemsFor.mock.calls.length, 'one attempt per outcome: the connect, then each fleet emit').toBe(outcomes.length);
    return { sock, lines: warn.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('waiting frame not built')) };
  };

  it('review 1338 F3: error A, then a different error B, is warned twice, once for each', async () => {
    const { lines } = await scripted(['operator item 1: error A', 'operator item 1: error B']);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('error A');
    expect(lines[1]).toContain('error B');
  });

  it('review 1338 F3: error A, a success, then error A again is warned twice: the success re-arms it', async () => {
    const { sock, lines } = await scripted(['operator item 1: error A', 'ok', 'operator item 1: error A']);
    expect(sock.typeCount('waiting'), 'CONTROL: the success sent its frame').toBeGreaterThanOrEqual(1);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l).toContain('error A');
  });
});
