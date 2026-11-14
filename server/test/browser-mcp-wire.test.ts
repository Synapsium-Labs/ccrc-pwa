// D-8121: browser MCP servers off by default — the server's half. The `browser` routing field rides the existing route
// vocabulary (`ROUTE_WRITABLE_FIELDS`), so `parseRouteFields`, the registry's route read and `routeFlags` take it with no
// second list; `$REG/<id>.browsermcp` (what the spawn applied) reaches the fleet frame as `FleetSession.browserMcp`; and
// a box whose ccd does not advertise `browser-route-v1` is never sent the field: the picker's door answers 501, and a
// dispatch drops it (`dispatch-route.test.ts`).
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { browserMcpOf, isCleanRecord, readSessionRecord, type SessionRecord } from '../src/registry.js';
import { assembleFleet } from '../src/fleet.js';
import { liveStateReaderOver } from '../src/livestate.js';
import { Tmux, type Runner } from '../src/exec.js';
import { buildServer } from '../src/server.js';
import { ACTOR_FLAGS_CAP, BROWSER_ROUTE_CAP, ROUTE_APPLY_CAP } from '../src/ccdargv.js';
import {
  BROWSER_MCP_APPLIED, ROUTE_READ_FIELDS, ROUTE_WRITABLE_FIELDS, parseRouteFields, reviveFleetSession, routeForBrowserCap,
} from '../../shared/api.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'demo-browser';
let home: string;
let reg: string;

beforeEach(() => {
  home = mkTmp('ccrc-browser-wire-');
  seedRoster(home);
  reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({
    wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`, uuid: `u-${ID}`, started: '1',
  })) writeFileSync(path.join(reg, `${ID}.${k}`), v);
});

const cfg = () => loadConfig({ CCRC_HOME: home });
const field = (f: string, v: string): void => writeFileSync(path.join(reg, `${ID}.${f}`), v);
const record = async (io: FleetIO = localIO): Promise<SessionRecord> => {
  const r = await readSessionRecord(io, cfg(), ID);
  if (r.kind !== 'found') throw new Error(`fixture row not found: ${r.kind}`);
  return r.record;
};

describe('the vocabulary (D-8121)', () => {
  it('`browser` is a writable routing field, after `compact`, and so a read field too', () => {
    expect(ROUTE_WRITABLE_FIELDS.indexOf('browser')).toBe(ROUTE_WRITABLE_FIELDS.indexOf('compact') + 1);
    expect(ROUTE_WRITABLE_FIELDS.indexOf('browser'), 'the launch profile\'s three and the compaction piece\'s precompact follow it (Overlord W1a)').toBe(ROUTE_WRITABLE_FIELDS.length - 5);
    expect(ROUTE_READ_FIELDS).toContain('browser');
    expect(parseRouteFields({ browser: 'on' })).toEqual({ ok: true, route: { browser: 'on' } });
  });

  it('routeForBrowserCap keeps the field for a box that takes it, drops it (and says so) for one that does not', () => {
    expect(routeForBrowserCap({ class: 'opus', browser: 'on' }, true)).toEqual({ route: { class: 'opus', browser: 'on' }, dropped: false });
    expect(routeForBrowserCap({ class: 'opus', browser: 'on' }, false)).toEqual({ route: { class: 'opus' }, dropped: true });
    expect(routeForBrowserCap({ browser: 'off' }, false)).toEqual({ route: null, dropped: true });
    expect(routeForBrowserCap({ class: 'opus' }, false)).toEqual({ route: { class: 'opus' }, dropped: false });
    expect(routeForBrowserCap(null, false)).toEqual({ route: null, dropped: false });
  });
});

describe('the spawn\'s record reaches the fleet frame (D-8121)', () => {
  it('browserMcpOf: unlisted is no record; `on`/`off` are themselves; anything else is unreadable', () => {
    expect(browserMcpOf(null)).toBeNull();
    expect(browserMcpOf({ ok: true, content: 'on' })).toBe('on');
    expect(browserMcpOf({ ok: true, content: 'off' })).toBe('off');
    expect(browserMcpOf({ ok: true, content: 'yes' })).toBe('unreadable');
    expect(browserMcpOf({ ok: false, reason: 'unreadable' })).toBe('unreadable');
    expect([...BROWSER_MCP_APPLIED]).toEqual(['on', 'off', 'unreadable']);
  });

  it('a row with no record carries no field; one with a record carries it, and an unreadable one is not a clean row', async () => {
    expect((await record()).browserMcp).toBeUndefined();
    field('browsermcp', 'off');
    expect((await record()).browserMcp).toBe('off');
    expect(isCleanRecord(await record())).toBe(true);
    field('browsermcp', 'garbage');
    expect((await record()).browserMcp).toBe('unreadable');
    expect(isCleanRecord(await record())).toBe(false);
  });

  it('the route field is read with the rest of the record', async () => {
    field('browser', 'on');
    expect((await record()).route?.fields.browser).toBe('on');
  });

  it('assembleFleet carries the record as `browserMcp`, null with none, and a cached frame revives it', async () => {
    const noopRun: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' });
    const fleet = () => assembleFleet(localIO, cfg(), new Tmux(noopRun), liveStateReaderOver(localIO), 1784600000);
    expect((await fleet()).find((s) => s.id === ID)?.browserMcp).toBeNull();
    field('browsermcp', 'on');
    const s = (await fleet()).find((x) => x.id === ID)!;
    expect(s.browserMcp).toBe('on');
    expect(reviveFleetSession(JSON.parse(JSON.stringify(s)))?.browserMcp).toBe('on');
    expect(reviveFleetSession({ ...JSON.parse(JSON.stringify(s)), browserMcp: 'maybe' })?.browserMcp).toBeNull();
  });
});

describe('POST /api/sessions/:id/route with `browser` (D-8121)', () => {
  const caps = (verbs: string[]) => ({ connected: true, downSince: null, ccdVerbs: verbs, rosterFp: null, build: null });
  const open = async (verbs: string[]): Promise<{ app: FastifyInstance; calls: string[][] }> => {
    const calls: string[][] = [];
    const run: Runner = async (_cmd, args) => { calls.push(args); return { ran: true, code: 0, stdout: `set ${ID} browser=on\n`, stderr: '' }; };
    const app = await buildServer({ ...testDeps(home, run), fleetState: caps(verbs) });
    await app.ready();
    return { app, calls };
  };
  const post = (app: FastifyInstance, payload: unknown) =>
    app.inject({ method: 'POST', url: `/api/sessions/${ID}/route`, payload: payload as never });

  it('a box with browser-route-v1 gets one `route --set browser=on --apply`', async () => {
    const { app, calls } = await open([ROUTE_APPLY_CAP, ACTOR_FLAGS_CAP, BROWSER_ROUTE_CAP]);
    const res = await post(app, { field: 'browser', value: 'on' });
    expect(res.statusCode, res.body).toBe(200);
    const route = calls.filter((c) => c[0] === 'route');
    expect(route).toHaveLength(1);
    expect(route[0]!.join(' ')).toContain(`--session ${ID} --set browser=on --apply`);
    await app.close();
  });

  it('a box without it answers 501 and no ccd call is made; another field is unaffected', async () => {
    const { app, calls } = await open([ROUTE_APPLY_CAP, ACTOR_FLAGS_CAP]);
    const res = await post(app, { field: 'browser', value: 'on' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
    expect(calls.filter((c) => c[0] === 'route')).toEqual([]);
    expect((await post(app, { field: 'effort', value: 'high' })).statusCode).toBe(200);
    await app.close();
  });
});
