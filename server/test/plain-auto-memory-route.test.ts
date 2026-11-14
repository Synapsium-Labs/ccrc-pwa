// Settings › Automation › "Auto memory for plain sessions" (Overlord W1a launch profiles PR B, Task 6; spec §3.3.7 H14,
// Table 11.1d): the store's one row and its door, `GET`/`POST /api/coord/plain-auto-memory`. The default on a fleet host is
// `off` (the migration's seed, and a lost row); `on` keeps Claude Code's auto memory for plain sessions. The launch-profile
// lane reads the stored value. A bare Fastify, the roll-idle route suite's idiom.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Deps } from '../src/server.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { Bus } from '../src/bus.js';
import { EXEMPT, SECRET_UNREAD, authVerdict, type GateDecision, type GateDeps } from '../src/auth/gate.js';
import { plainAutoMemoryOf } from '../src/continuity/profileFor.js';
import { profilePass } from '../src/continuity/profileLane.js';
import { ROUTE_CAP } from '../src/ccdargv.js';
import { testDeps } from './helpers.js';
import { codeOnly } from './sourceScan.js';
import { mkTmp } from './tmpHelpers.js';

const URL = '/api/coord/plain-auto-memory';
const apps: FastifyInstance[] = [];
afterEach(async () => { for (const a of apps.splice(0)) await a.close(); });

async function setup(): Promise<{ app: FastifyInstance; coord: CoordStore }> {
  const home = mkTmp('ccrc-plain-memory-route-');
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

describe('auto memory for plain sessions, the Settings row and its door (Task 6)', () => {
  it('a fresh database reads off, the spec\'s default on a fleet host (H14)', async () => {
    const { coord } = await setup();
    expect(coord.plainAutoMemorySettings()).toEqual({ kind: 'row', choice: 'off' });
    expect(plainAutoMemoryOf(coord.plainAutoMemorySettings())).toBe('off');
  });

  it('GET answers the choice, its default and its two choices', async () => {
    const { app } = await setup();
    const r = await app.inject({ method: 'GET', url: URL });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, choice: 'off', default: 'off', choices: ['off', 'on'] });
  });

  it('POST on answers 200 and records who changed it; POST off sets it back', async () => {
    const { app, coord } = await setup();
    const on = await app.inject({ method: 'POST', url: URL, payload: { choice: 'on' } });
    expect(on.statusCode).toBe(200);
    expect(on.json()).toEqual({ ok: true, choice: 'on', default: 'off', choices: ['off', 'on'] });
    expect(plainAutoMemoryOf(coord.plainAutoMemorySettings())).toBe('on');
    const ev = coord.feedEvents(10).at(-1)!;
    expect([ev.kind, ev.title, ev.body]).toEqual(['coord', 'plain auto memory changed', 'auto memory for plain sessions: off -> on; by flag-off']);
    const off = await app.inject({ method: 'POST', url: URL, payload: { choice: 'off' } });
    expect(off.statusCode).toBe(200);
    expect(off.json().choice).toBe('off');
  });

  it('anything but on or off is a 400 naming the choices, and changes nothing', async () => {
    const { app, coord } = await setup();
    for (const bad of [{ choice: 'ON' }, { choice: true }, { choice: '' }, {}, null]) {
      const r = await app.inject({ method: 'POST', url: URL, payload: bad === null ? undefined : bad });
      expect(r.statusCode, JSON.stringify(bad)).toBe(400);
      if (bad !== null) expect(r.json().detail).toBe('choice must be one of off, on');
    }
    expect(coord.plainAutoMemorySettings()).toEqual({ kind: 'row', choice: 'off' });
  });

  it('a write that changes nothing keeps the stored time and adds no feed row', async () => {
    const { app, coord } = await setup();
    const before = coord.feedEvents(10).length;
    const w = coord.setPlainAutoMemory('off', 9);
    expect(w.before).toEqual(w.after);
    await app.inject({ method: 'POST', url: URL, payload: { choice: 'off' } });
    expect(coord.feedEvents(10)).toHaveLength(before);
  });

  it('it is the operator\'s door: in no EXEMPT row, so with sign-in armed a request without a session is refused', () => {
    const deps = { enabled: true, secret: SECRET_UNREAD } as unknown as GateDeps;
    for (const method of ['GET', 'POST']) {
      expect(EXEMPT.has(`${method} ${URL}`)).toBe(false);
      expect(authVerdict({ method, routeOptions: { url: URL }, headers: {} }, deps, 0).allow).toBe(false);
    }
  });

  it('the lane reads the stored value: a plain session\'s automem follows the row', async () => {
    const { app, coord } = await setup();
    await app.inject({ method: 'POST', url: URL, payload: { choice: 'on' } });
    coord.setLaneArm('launch-profile', 'live', 1);
    const sent: string[][] = [];
    await profilePass({
      coord, log: () => {}, memory: { lastLine: null },
      reads: { usage: async () => ({ kind: 'absent' }), steerMarker: async () => 'absent' },
      act: { runCcd: async (argv) => { sent.push([...argv]); return { ok: true, stdout: '', stderr: '', ran: true } as never; }, fleetState: { ccdVerbs: [ROUTE_CAP] } },
    }, [{ id: 'lane-a-project-a', child: { kind: 'none' }, route: null }]);
    expect(sent.map((a) => a.filter((_, i) => a[i - 1] === '--set'))).toEqual([['profile=plain', 'automem=on']]);
  });

  it('nothing reads a switchboard row for this setting: every reader goes through the store, so the row\'s absence changes nothing (the ruling on ask 404)', () => {
    // The `SWITCHES` row follows in its own PR (consolidation-path-guard); until then, and after, the setting is read only
    // from `plain_memory_settings`, by the store, and the lane and the door read the store. A file that indexed `SWITCHES`
    // for this setting would read a row this PR does not carry.
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const roots = ['server/src', 'shared', 'pwa/src'].map((r) => path.join(repo, r));
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f); else if (/\.(ts|tsx|mjs)$/.test(e.name)) files.push(f);
      }
    };
    roots.forEach(walk);
    const text = (f: string): string => codeOnly(readFileSync(f, 'utf8'));   // code only: a comment may name another SWITCHES
    const rel = (f: string): string => path.relative(repo, f);
    const naming = files.filter((f) => /plain-auto-memory|plainAutoMemory|plain_memory_settings/.test(text(f)));
    expect(naming.length, 'the setting\'s readers were found').toBeGreaterThan(3);
    expect(naming.filter((f) => /\bSWITCHES\b/.test(text(f))).map(rel)).toEqual([]);
    expect(files.filter((f) => /\bplain_memory_settings\b/.test(text(f))).map(rel).sort())
      .toEqual(['server/src/coord/schema.ts', 'server/src/coord/store.ts']);
  });
});
