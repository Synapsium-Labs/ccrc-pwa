/**
 * STALL WATCH SETTINGS, the routes (design 2026-10-05 §10, §11, §14, §15, §17): `GET` and `POST
 * /api/coord/stall-watch`, registered in `coord/routes.ts` beside the caps dial.
 *
 * The routes are registered on a bare Fastify, the `archive-coord-handle.test.ts` idiom, so a row can hand
 * `registerCoordRoutes` its own `sessionAuth` (the actor when the gate is armed) and its own watcher (the reported
 * fallback). `resolveStallWatch`, `parseStallSettings`, `stallStages`, `stallNextStep` and `stallNoticeCounts` are
 * mocked to pass straight through until a row switches one on to really throw (M20, M17b).
 *
 * No marker name is spelled here: the lane's markers come from `STALL_MARKERS`, `mail-disabled` from its definer.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Deps } from '../src/server.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { Bus } from '../src/bus.js';
import type { GateDecision } from '../src/auth/gate.js';
import type { FleetWatcher } from '../src/watch.js';
import { STALL_FOLLOW_LABEL, STALL_LEVEL_TEXT } from '../../shared/api.js';
import type { StallWatchView, StallWriteEffect } from '../../shared/api.js';
import {
  STALL_NOTICE_WINDOW_MS, STALL_QUIET_MAX_MS, STALL_QUIET_MIN_MS, STALL_QUIET_STEP_MS, stallEffectKey,
} from '../src/coord/stallsettings.js';
import type { StallSettingsRead } from '../src/coord/stallsettings.js';
import { STALL_MARKERS, STALL_QUIET_MS, stallDetail } from '../src/coord/stall.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const settingsFault = vi.hoisted(() => ({
  resolve: null as Error | null, parse: null as Error | null, next: null as Error | null, counts: null as Error | null,
  /** Thrown by `stallStages` only for an arming whose checks run, so the files' own reading can still be read. */
  stagesWhenLive: null as Error | null,
}));
vi.mock('../src/coord/stallsettings.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/coord/stallsettings.js')>();
  return {
    ...real,
    resolveStallWatch: (...a: Parameters<typeof real.resolveStallWatch>): ReturnType<typeof real.resolveStallWatch> => {
      if (settingsFault.resolve !== null) throw settingsFault.resolve;
      return real.resolveStallWatch(...a);
    },
    parseStallSettings: (...a: Parameters<typeof real.parseStallSettings>): ReturnType<typeof real.parseStallSettings> => {
      if (settingsFault.parse !== null) throw settingsFault.parse;
      return real.parseStallSettings(...a);
    },
    stallStages: (...a: Parameters<typeof real.stallStages>): ReturnType<typeof real.stallStages> => {
      if (settingsFault.stagesWhenLive !== null && a[0].live) throw settingsFault.stagesWhenLive;
      return real.stallStages(...a);
    },
    stallNextStep: (...a: Parameters<typeof real.stallNextStep>): ReturnType<typeof real.stallNextStep> => {
      if (settingsFault.next !== null) throw settingsFault.next;
      return real.stallNextStep(...a);
    },
    stallNoticeCounts: (...a: Parameters<typeof real.stallNoticeCounts>): ReturnType<typeof real.stallNoticeCounts> => {
      if (settingsFault.counts !== null) throw settingsFault.counts;
      return real.stallNoticeCounts(...a);
    },
  };
});

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..', 'src');

const [, LIVE, ESCALATE, W2LIVE] = STALL_MARKERS as [string, string, string, string];
const MIN = 60_000;
const H = 3_600_000;

const apps: FastifyInstance[] = [];
afterEach(async () => {
  settingsFault.resolve = null; settingsFault.parse = null; settingsFault.next = null; settingsFault.counts = null;
  settingsFault.stagesWhenLive = null;
  vi.restoreAllMocks();
  while (apps.length) await apps.pop()!.close();
});

interface Setup {
  /** The registry listing: names planted as files, or `null` for a registry that cannot be listed. */
  names?: readonly string[] | null;
  authEnabled?: boolean;
  device?: string | null;
  /** What the watcher's `stallFallback()` answers; `undefined` registers no watcher at all. */
  watcherFallback?: { readonly at: number; readonly reason: string } | null;
  coord?: boolean;
}
const setup = async (o: Setup = {}) => {
  const home = mkTmp('ccrc-stall-route-');
  const reg = path.join(home, '.cc-sessions');
  if (o.names !== null) {
    mkdirSync(reg, { recursive: true });
    for (const n of o.names ?? []) writeFileSync(path.join(reg, n), '');
  }
  const db = openCoordDb(path.join(home, '.ccrc', 'coord.db'));
  const coord = new CoordStore(db);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const base = testDeps(home);
  const deps: Deps = { ...base, cfg: { ...base.cfg, authEnabled: o.authEnabled ?? false }, notifyLog,
    ...(o.coord === false ? {} : { coord }) };
  const sessionAuth = (): GateDecision => ({ allow: true, verdict: 'ok', reason: 'session', device: o.device ?? null });
  const watcher = o.watcherFallback === undefined ? undefined
    : ({ stallFallback: () => o.watcherFallback } as unknown as FleetWatcher);
  const app = Fastify();
  registerCoordRoutes(app, deps, new Bus(), sessionAuth,
    { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null }, watcher);
  apps.push(app);
  return { app, coord, db, notifyLog };
};

const getView = (app: FastifyInstance) => app.inject({ method: 'GET', url: '/api/coord/stall-watch' });
const post = (app: FastifyInstance, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/coord/stall-watch', payload: payload as Record<string, unknown> });
/** A direct store write, for a row's starting state: the store validates nothing, so this is the fixture's door. */
const store = (coord: CoordStore, level: string, quietMs: number | null = null, at = 1_790_000_000_000): void => {
  const w = coord.setStallSettings({ level: level as 'follow',
    quiet: quietMs === null ? { kind: 'default' } : { kind: 'set', ms: quietMs } }, at, coord.stallSettings());
  expect(w.kind).toBe('written');
};
const storedLevel = (coord: CoordStore): unknown => {
  const r = coord.stallSettings();
  return r.kind === 'row' ? r.row.level : r.kind;
};
const STAGES_OFF = { runs: true, checks: false, alerts: false, busyDelivery: false, busyGate: false, wave2: false };
const HELD_NONE = { watchOff: false, mailOff: false, gateStrict: false, wave2HeldByStrict: false };
const QUIET_BOUNDS = { builtInMs: STALL_QUIET_MS, minMs: STALL_QUIET_MIN_MS, maxMs: STALL_QUIET_MAX_MS, stepMs: STALL_QUIET_STEP_MS };

describe('GET /api/coord/stall-watch', () => {
  it('answers the whole view on a fresh box: Follow, the built-in quiet time, the files reading Log only', async () => {
    const { app } = await setup();
    const t0 = Date.now();
    const res = await getView(app);
    const t1 = Date.now();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true } & StallWatchView;
    expect(body).toEqual({
      ok: true,
      chosen: { level: 'follow', quietMs: 'default', updatedAt: 0, stored: 'row' },
      effective: { measured: true, level: 'log', files: 'log', source: 'files', stages: STAGES_OFF, held: HELD_NONE,
        next: { kind: 'step', level: 'check', waitsOn: ['checks'] }, filesExceed: false },
      quiet: { effectiveMs: STALL_QUIET_MS, ...QUIET_BOUNDS, source: 'default' },
      notices: { ok: true, since: expect.any(Number), windowMs: STALL_NOTICE_WINDOW_MS, counts: [
        { row: 'checks', sent: 0, shadow: 0 }, { row: 'wakes', sent: 0, shadow: 0 },
        { row: 'reports', sent: 0, shadow: 0 }, { row: 'pushes', sent: 0, shadow: 0 },
      ] },
      fallback: null,
    });
    if (!body.notices.ok) throw new Error('unreachable');
    expect(body.notices.since).toBeGreaterThanOrEqual(t0 - STALL_NOTICE_WINDOW_MS);
    expect(body.notices.since).toBeLessThanOrEqual(t1 - STALL_NOTICE_WINDOW_MS);
  });

  it('answers 501 not-configured, on both verbs, on a box with no coordination database', async () => {
    const { app } = await setup({ coord: false });
    for (const res of [await getView(app), await post(app, { level: 'off' })]) {
      expect(res.statusCode).toBe(501);
      expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
    }
  });

  it('M6: a registry that cannot be listed answers 200 with effective unmeasured, never off, and the chosen values still shown', async () => {
    const { app, coord } = await setup({ names: null });
    store(coord, 'check', 3 * H);
    const body = (await getView(app)).json() as StallWatchView;
    expect(body.effective).toEqual({ measured: false });
    expect(body.chosen).toEqual({ level: 'check', quietMs: 3 * H, updatedAt: 1_790_000_000_000, stored: 'row' });
    expect(body.quiet).toEqual({ effectiveMs: 3 * H, ...QUIET_BOUNDS, source: 'chosen' });
    expect(body.fallback).toBeNull();
  });

  it('an absent row and an unreadable row are told apart, never sent as follow or default, and both answer 200', async () => {
    const a = await setup();
    a.db.prepare('DELETE FROM stall_settings WHERE id = 1').run();
    const absent = await getView(a.app);
    expect(absent.statusCode).toBe(200);
    expect((absent.json() as StallWatchView).chosen)
      .toEqual({ level: 'unreadable', quietMs: 'unreadable', updatedAt: null, stored: 'absent' });
    const u = await setup();
    u.db.prepare('DROP TABLE stall_settings').run();
    const unreadable = await getView(u.app);
    expect(unreadable.statusCode).toBe(200);
    const v = unreadable.json() as StallWatchView;
    expect(v.chosen).toEqual({ level: 'unreadable', quietMs: 'unreadable', updatedAt: null, stored: 'unreadable' });
    expect(v.fallback, 'an unreadable row is not a fallback: the resolution did not throw').toBeNull();
  });

  it('a chosen level reads as chosen, with the files reading beside it, and the files-exceed reading', async () => {
    const { app, coord } = await setup({ names: [LIVE, ESCALATE] });
    store(coord, 'check');
    const v = (await getView(app)).json() as StallWatchView;
    expect(v.effective).toEqual({ measured: true, level: 'check', files: 'alert', source: 'chosen',
      stages: { ...STAGES_OFF, checks: true, busyGate: true }, held: HELD_NONE,
      next: { kind: 'step', level: 'alert', waitsOn: ['alerts'] }, filesExceed: true });
  });

  it('counts the window\'s observations by role, live and shadow apart', async () => {
    const { app, coord } = await setup();
    const r = coord.openRun({ program: 'p', title: 'P', project: 'demo', wave: 1, waveOf: 2, claimedBy: 'demo-coordinator' }) as
      { id: number };
    coord.markDispatched(r.id, 'demo-worker', 'ws', 'ws/ws', false);
    expect(coord.advance(r.id, 'dispatched', 'test').ok).toBe(true);
    expect(coord.insertStallObservation(r.id, stallDetail('live', 'quiet', 1, 0), Date.now()).recorded).toBe(true);
    expect(coord.insertStallObservation(r.id, stallDetail('shadow', 'quiet', 2, 0), Date.now()).recorded).toBe(true);
    const v = (await getView(app)).json() as StallWatchView;
    expect(v.notices).toMatchObject({ ok: true, counts: [
      { row: 'checks', sent: 1, shadow: 0 }, { row: 'wakes', sent: 0, shadow: 0 },
      { row: 'reports', sent: 0, shadow: 1 }, { row: 'pushes', sent: 0, shadow: 0 },
    ] });
  });

  it('M17b: a throw from L1 counting answers notices {ok:false}, never a 500, and the rest of the view stands', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app } = await setup();
    settingsFault.counts = new Error('count bug');
    const res = await getView(app);
    expect(res.statusCode).toBe(200);
    const v = res.json() as StallWatchView;
    expect(v.notices).toEqual({ ok: false });
    expect(v.effective).toMatchObject({ measured: true, level: 'log' });
    expect(warn.mock.calls.flat().join(' ')).toContain('count bug');
  });

  it('M20: a resolver that really throws for a chosen row answers 200 with the builder\'s own fallback, the files reading and the built-in quiet time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, coord } = await setup({ names: [LIVE] });
    store(coord, 'deliver', 30 * MIN);
    settingsFault.resolve = new Error('resolver bug');
    const t0 = Date.now();
    const res = await getView(app);
    expect(res.statusCode).toBe(200);
    const v = res.json() as StallWatchView;
    expect(v.fallback).toEqual({ at: expect.any(Number), reason: 'resolver bug' });
    expect(v.fallback!.at).toBeGreaterThanOrEqual(t0);
    expect(v.effective).toEqual({ measured: true, level: 'check', files: 'check', source: 'files',
      stages: { ...STAGES_OFF, checks: true }, held: HELD_NONE,
      next: { kind: 'step', level: 'alert', waitsOn: ['alerts'] }, filesExceed: false });
    expect(v.quiet).toEqual({ effectiveMs: STALL_QUIET_MS, ...QUIET_BOUNDS, source: 'default' });
    expect(v.chosen, 'chosen comes from the builder\'s own parse, which returned')
      .toEqual({ level: 'deliver', quietMs: 30 * MIN, updatedAt: 1_790_000_000_000, stored: 'row' });
    expect(warn.mock.calls.flat().join(' ')).toContain('resolver bug');
  });

  it('M20: the view warns once for a standing fault, and again after a resolution that succeeds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app } = await setup();
    const lines = (): number => warn.mock.calls.flat().filter((l) => String(l).includes('resolver bug')).length;
    settingsFault.resolve = new Error('resolver bug');
    await getView(app); await getView(app); await getView(app);
    expect(lines()).toBe(1);
    settingsFault.resolve = null;
    await getView(app);
    settingsFault.resolve = new Error('resolver bug');
    await getView(app);
    expect(lines()).toBe(2);
  });

  it('M20: a parse that throws reports chosen unreadable, with a fallback', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, coord } = await setup();
    store(coord, 'alert');
    settingsFault.parse = new Error('parse bug');
    const v = (await getView(app)).json() as StallWatchView;
    expect(v.chosen).toEqual({ level: 'unreadable', quietMs: 'unreadable', updatedAt: null, stored: 'unreadable' });
    expect(v.fallback).toEqual({ at: expect.any(Number), reason: 'parse bug' });
    expect(v.effective).toMatchObject({ measured: true, level: 'log', source: 'files' });
  });

  it('M20: a watcher fallback is reported even when the builder\'s own resolution succeeded, with the built-in quiet time', async () => {
    const fb = { at: 1_790_000_000_123, reason: 'the sweep fell back' };
    const { app, coord } = await setup({ names: [LIVE], watcherFallback: fb });
    store(coord, 'alert', 30 * MIN);
    const v = (await getView(app)).json() as StallWatchView;
    expect(v.fallback).toEqual(fb);
    expect(v.quiet).toEqual({ effectiveMs: STALL_QUIET_MS, ...QUIET_BOUNDS, source: 'default' });
    expect(v.effective).toMatchObject({ measured: true, level: 'check', files: 'check', source: 'files', filesExceed: false });
    expect(v.chosen).toMatchObject({ level: 'alert', quietMs: 30 * MIN, stored: 'row' });
  });

  it('M20: a watcher whose stallFallback() reads null reports no fallback', async () => {
    const { app } = await setup({ watcherFallback: null });
    expect(((await getView(app)).json() as StallWatchView).fallback).toBeNull();
  });

  it('M20: a throwing view-only reader answers 200 with no fallback, and next and filesExceed left out', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, coord } = await setup();
    store(coord, 'check');
    settingsFault.next = new Error('next bug');
    const res = await getView(app);
    expect(res.statusCode).toBe(200);
    const v = res.json() as StallWatchView;
    expect(v.fallback).toBeNull();
    expect(v.effective).toEqual({ measured: true, level: 'check', files: 'log', source: 'chosen',
      stages: { ...STAGES_OFF, checks: true, busyGate: true }, held: HELD_NONE });
    expect(v.quiet.source).toBe('default');
    expect(warn.mock.calls.flat().join(' ')).toContain('next bug');
  });

  it('M20: a stages reader that throws over a listed registry never answers unmeasured: the resolution claims it, and the files reading stands', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, coord } = await setup();
    store(coord, 'check');
    settingsFault.stagesWhenLive = new Error('stages bug');
    const res = await getView(app);
    expect(res.statusCode).toBe(200);
    const v = res.json() as StallWatchView;
    expect(v.effective, 'a listed registry is never read back as one that could not be listed')
      .toEqual({ measured: true, level: 'log', files: 'log', source: 'files', stages: STAGES_OFF, held: HELD_NONE,
        next: { kind: 'step', level: 'check', waitsOn: ['checks'] }, filesExceed: false });
    expect(v.fallback).toEqual({ at: expect.any(Number), reason: 'stages bug' });
    expect(v.quiet).toEqual({ effectiveMs: STALL_QUIET_MS, ...QUIET_BOUNDS, source: 'default' });
  });
});

describe('POST /api/coord/stall-watch', () => {
  it('a write that needs no confirm is written at once, and the reply is the stored view', async () => {
    const { app, coord } = await setup();
    const res = await post(app, { level: 'off' });
    expect(res.statusCode).toBe(200);
    const v = res.json() as { ok: true } & StallWatchView;
    expect(v.ok).toBe(true);
    expect(v.chosen).toMatchObject({ level: 'off', quietMs: 'default', stored: 'row' });
    expect(v.effective).toMatchObject({ measured: true, level: 'off', source: 'chosen' });
    expect(storedLevel(coord)).toBe('off');
  });

  it('M26: a write that turns a stage on answers 409 confirm-required with the effect and its key, and writes nothing', async () => {
    const { app, coord } = await setup();
    const before = coord.stallSettings();
    const res = await post(app, { level: 'check' });
    expect(res.statusCode).toBe(409);
    const b = res.json() as { ok: false; error: string; effect: StallWriteEffect; effectKey: string };
    expect(b.ok).toBe(false);
    expect(b.error).toBe('confirm-required');
    expect(b.effect).toMatchObject({ measured: true, turnsOn: ['checks', 'busyGate'], turnsOff: [], leavesWave2: false });
    expect(b.effectKey).toMatch(/^[0-9a-f]{8}$/);
    expect(b.effectKey, 'the key is the digest of the effect and the before-row\'s updatedAt').toBe(stallEffectKey(b.effect, 0));
    expect(coord.stallSettings()).toEqual(before);
    expect(coord.feedEvents(10)).toEqual([]);
    const ok = await post(app, { level: 'check', confirm: b.effectKey });
    expect(ok.statusCode).toBe(200);
    expect(storedLevel(coord)).toBe('check');
  });

  it('M26: leaving the further checks, and a lowered quiet time, each answer 409 and write nothing', async () => {
    const { app, coord } = await setup();
    store(coord, 'all');
    const before = coord.stallSettings();
    const leaves = await post(app, { level: 'deliver' });
    expect(leaves.statusCode).toBe(409);
    expect(leaves.json().effect).toMatchObject({ leavesWave2: true, turnsOn: [] });
    const lowered = await post(app, { quietMs: 30 * MIN });
    expect(lowered.statusCode).toBe(409);
    expect(lowered.json().effect).toMatchObject({ quietLowered: true, quietMs: { before: STALL_QUIET_MS, after: 30 * MIN } });
    expect(coord.stallSettings()).toEqual(before);
  });

  it('M6 / M26: with the registry unlistable every write answers 409 with the unmeasured effect, and its key writes', async () => {
    const { app, coord } = await setup({ names: null });
    const res = await post(app, { level: 'off' });
    expect(res.statusCode).toBe(409);
    expect(res.json().effect).toEqual({ measured: false });
    expect(storedLevel(coord)).toBe('follow');
    const ok = await post(app, { level: 'off', confirm: res.json().effectKey });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as StallWatchView).effective).toEqual({ measured: false });
    expect(storedLevel(coord)).toBe('off');
  });

  it('M27: a key that does not match answers 409 again and writes nothing', async () => {
    const { app, coord } = await setup();
    const first = await post(app, { level: 'all' });
    expect(first.statusCode).toBe(409);
    const again = await post(app, { level: 'all', confirm: 'deadbeef' });
    expect(again.statusCode).toBe(409);
    expect(again.json().effectKey).toBe(first.json().effectKey);
    expect(storedLevel(coord)).toBe('follow');
  });

  it('M27: another page\'s write between the 409 and the re-POST makes the old key stale, even when the effect reads the same', async () => {
    const { app, coord } = await setup();
    const sheet = await post(app, { level: 'all' });
    expect(sheet.statusCode).toBe(409);
    // Another page writes Off, then Follow: the row reads as it did, but its updatedAt moved.
    expect((await post(app, { level: 'off' })).statusCode).toBe(200);
    expect((await post(app, { level: 'follow' })).statusCode).toBe(200);
    const stale = await post(app, { level: 'all', confirm: sheet.json().effectKey });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().effect, 'the premise: the effect itself is unchanged').toEqual(sheet.json().effect);
    expect(stale.json().effectKey).not.toBe(sheet.json().effectKey);
    expect(storedLevel(coord)).toBe('follow');
    const fresh = await post(app, { level: 'all', confirm: stale.json().effectKey });
    expect(fresh.statusCode).toBe(200);
    expect(storedLevel(coord)).toBe('all');
  });

  it('M10: the stored value is the sent value, at both bounds, never clamped', async () => {
    const { app, coord } = await setup();
    expect((await post(app, { quietMs: STALL_QUIET_MAX_MS })).statusCode).toBe(200);
    expect(coord.stallSettings()).toMatchObject({ kind: 'row', row: { quietMs: BigInt(STALL_QUIET_MAX_MS) } });
    const low = await post(app, { quietMs: STALL_QUIET_MIN_MS });
    expect(low.statusCode).toBe(409);
    expect((await post(app, { quietMs: STALL_QUIET_MIN_MS, confirm: low.json().effectKey })).statusCode).toBe(200);
    expect(coord.stallSettings()).toMatchObject({ kind: 'row', row: { quietMs: BigInt(STALL_QUIET_MIN_MS) } });
    expect((await post(app, { quietMs: 'default' })).statusCode).toBe(200);
    expect(coord.stallSettings()).toMatchObject({ kind: 'row', row: { quietMs: null } });
  });

  it('M14: refuses with 400 and the detail, writes nothing and records nothing', async () => {
    const { app, coord } = await setup();
    const before = coord.stallSettings();
    const cases: [unknown, string][] = [
      [{ level: 'off', bogus: 1 }, 'unknown key bogus: a write names only level, quietMs and confirm'],
      [{}, 'at least one of level or quietMs must be given'],
      [[], 'body must be an object'],
      [{ level: 'constructor' }, 'level must be follow or one of off, log, check, alert, deliver, all'],
      [{ quietMs: 45 * MIN },
        "quietMs must be 'default' or a whole number of milliseconds from 1800000 to 43200000 in steps of 1800000"],
      [{ level: 'off', confirm: 7 }, 'confirm must be a string'],
    ];
    for (const [payload, detail] of cases) {
      const res = await post(app, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request', detail });
    }
    expect(coord.stallSettings()).toEqual(before);
    expect(coord.feedEvents(10)).toEqual([]);
  });

  it('M27b: a pre-read that answers unreadable is refused with a 500, and nothing is written', async () => {
    const { app, coord } = await setup();
    const before = coord.stallSettings();
    vi.spyOn(coord, 'stallSettings').mockReturnValueOnce({ kind: 'unreadable', detail: 'disk gone' });
    const write = vi.spyOn(coord, 'setStallSettings');
    const res = await post(app, { level: 'off' });
    expect(res.statusCode).toBe(500);
    expect(write).not.toHaveBeenCalled();
    expect(coord.stallSettings()).toEqual(before);
  });

  /** Make the store's reads answer `fakes[n]` on the listed call numbers, and the real read otherwise. The store's
   *  own write reads through `this.stallSettings()`, so the spy reaches it too. */
  const fakeReads = (coord: CoordStore, fakes: Record<number, StallSettingsRead>): void => {
    const real = coord.stallSettings.bind(coord);
    let n = 0;
    vi.spyOn(coord, 'stallSettings').mockImplementation(() => { n += 1; return fakes[n] ?? real(); });
  };
  const fakeRow = (level: string, updatedAt: bigint): StallSettingsRead =>
    ({ kind: 'row', row: { level, quietMs: null, updatedAt } });

  it('M27b: a conflict whose fresh effect needs a confirm answers 409 with that effect and its key', async () => {
    const { app, coord } = await setup();
    // The route reads Everything (so writing Everything is a no-op that needs no confirm); the store finds Follow.
    fakeReads(coord, { 1: fakeRow('all', 5n) });
    const res = await post(app, { level: 'all' });
    expect(res.statusCode).toBe(409);
    const b = res.json() as { effect: StallWriteEffect; effectKey: string };
    expect(b.effect).toMatchObject({ measured: true, turnsOn: ['checks', 'alerts', 'busyDelivery', 'busyGate', 'wave2'] });
    expect(b.effectKey).toBe(stallEffectKey(b.effect, 0));
    vi.restoreAllMocks();
    expect(storedLevel(coord)).toBe('follow');
  });

  it('M27b: a conflict whose fresh effect needs none is written over the row the store found', async () => {
    const { app, coord } = await setup();
    store(coord, 'check');
    fakeReads(coord, { 1: fakeRow('check', 5n) });
    const res = await post(app, { level: 'off' });
    expect(res.statusCode).toBe(200);
    vi.restoreAllMocks();
    expect(storedLevel(coord)).toBe('off');
  });

  it('M27b: a second conflict is refused with a 500, and nothing is written', async () => {
    const { app, coord } = await setup();
    store(coord, 'check');
    const before = coord.stallSettings();
    // Call 1 is the route's read, call 2 the store's first write's read (the real row: a conflict), call 3 the
    // store's second write's read (another stranger: a second conflict).
    fakeReads(coord, { 1: fakeRow('check', 5n), 3: fakeRow('check', 6n) });
    const res = await post(app, { level: 'off' });
    expect(res.statusCode).toBe(500);
    vi.restoreAllMocks();
    expect(coord.stallSettings()).toEqual(before);
  });

  it('M13: the reply re-reads the store, never echoing the body', async () => {
    const { app, coord, db } = await setup();
    const realWrite = coord.setStallSettings.bind(coord);
    vi.spyOn(coord, 'setStallSettings').mockImplementation((...a) => {
      const w = realWrite(...a);
      // A second write lands between this write and the reply.
      db.prepare("UPDATE stall_settings SET level = 'log' WHERE id = 1").run();
      return w;
    });
    const res = await post(app, { level: 'off' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as StallWatchView).chosen.level).toBe('log');
  });
});

describe('M15: the feed event, on a change only, with its actor, flushed in finally', () => {
  it('names what changed and ends "by flag-off" when the gate is unarmed', async () => {
    const { app, coord } = await setup();
    expect((await post(app, { level: 'off' })).statusCode).toBe(200);
    const ev = coord.feedEvents(10).at(-1)!;
    expect(ev.kind).toBe('coord');
    expect(ev.title).toBe('stall watch changed');
    expect(ev.body).toBe(`level: ${STALL_FOLLOW_LABEL} → ${STALL_LEVEL_TEXT.off.label}; by flag-off`);
  });

  it('ends "by device:<label>" when the gate is armed', async () => {
    const { app, coord } = await setup({ authEnabled: true, device: 'probe-browser' });
    expect((await post(app, { quietMs: 3 * H })).statusCode).toBe(200);
    expect(coord.feedEvents(10).at(-1)!.body).toBe('quiet time: 2 h (built-in) → 3 h; by device:probe-browser');
  });

  it('the same body POSTed twice records one feed row: a no-op records nothing', async () => {
    const { app, coord } = await setup();
    expect((await post(app, { level: 'off' })).statusCode).toBe(200);
    expect((await post(app, { level: 'off' })).statusCode).toBe(200);
    expect(coord.feedEvents(10).length).toBe(1);
  });

  it('a throwing feed archive still writes the setting, warns, and still flushes the minted seq', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, coord, db, notifyLog } = await setup();
    const flush = vi.spyOn(notifyLog, 'flush');
    db.prepare('DROP TABLE feed_events').run();
    const res = await post(app, { level: 'off' });
    expect(res.statusCode).toBe(200);
    expect(storedLevel(coord)).toBe('off');
    expect(warn.mock.calls.flat().join(' '), 'the premise: the archive threw').toContain('recordFeedEvent failed');
    expect(flush, 'the archive throw skipped the flush').toHaveBeenCalled();
  });
});

// ── source scans ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Blank out comments and string/template bodies, preserving byte positions and newlines:
 *  `coord-caps-route.test.ts`'s helper, copied unchanged, so a call mentioned only in prose is invisible. */
function blankCommentsAndStrings(text: string): string {
  const out = text.split('');
  const blank = (a: number, b: number): void => {
    for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      const j = text.indexOf('\n', i);
      const e = j < 0 ? text.length : j;
      blank(i, e); i = e;
    } else if (c === '/' && d === '*') {
      const j = text.indexOf('*/', i + 2);
      const e = j < 0 ? text.length : j + 2;
      blank(i, e); i = e;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') j += 2;
        else if (text[j] === c) break;
        else j++;
      }
      blank(i + 1, Math.min(j, text.length));
      i = Math.min(j + 1, text.length);
    } else i++;
  }
  return out.join('');
}
/** `auth-gate.test.ts`'s comment strip, unchanged. */
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const sourcesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourcesUnder(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });

const ROUTES_SRC = (): string => readFileSync(path.join(srcRoot, 'coord', 'routes.ts'), 'utf8');
const POST_DECL = "app.post('/api/coord/stall-watch'";
const DOC_ANCHOR = '/** `GET`/`POST /api/coord/stall-watch`';
/** From `from` to the next route registration after `decl`. Fails loudly on a missing anchor. */
const sliceTo = (raw: string, from: number, decl: string): string => {
  const at = raw.indexOf(decl);
  expect(at, `${decl} is gone — this scan is over nothing`).toBeGreaterThan(-1);
  expect(from, 'the slice starts after the registration it must cover').toBeLessThanOrEqual(at);
  const next = /app\.(?:get|post)\('/.exec(raw.slice(at + decl.length));
  return raw.slice(from, next === null ? raw.length : at + decl.length + next.index);
};
const postHandler = (raw: string): string => sliceTo(raw, raw.indexOf(POST_DECL), POST_DECL);
const stallWatchBlock = (raw: string): string => {
  const from = raw.indexOf(DOC_ANCHOR);
  expect(from, 'the stall-watch docstring anchor is gone').toBeGreaterThan(-1);
  return sliceTo(raw, from, POST_DECL);
};
/** The word the old Notifications row label began with. */
const DEVICE_WORD = /phone/i;

describe('M29: the handler never branches on the device label, and the new prose names no device', () => {
  it('CONTROL: the POST slice is the handler, and it hands the label to deviceActor exactly once', () => {
    const body = stripComments(postHandler(ROUTES_SRC()));
    expect(body.length).toBeGreaterThan(400);
    expect(body.split('deviceActor(sessionAuth(req).device)').length - 1).toBe(1);
  });

  it('with that one call removed, no device token is left in the POST handler', () => {
    const stripped = stripComments(postHandler(ROUTES_SRC())).replace(/deviceActor\(sessionAuth\(req\)\.device\)/g, '');
    expect(stripped, 'the stall-watch POST must not branch on device').not.toMatch(/\bdevice\b/);
  });

  it('CONTROL: the device-word scan sees the word where it is (the caps docstring)', () => {
    const raw = ROUTES_SRC();
    expect(raw.slice(raw.indexOf('/** `GET`/`POST /api/coord/caps`'), raw.indexOf("app.get('/api/coord/caps'")))
      .toMatch(DEVICE_WORD);
  });

  it('the stall-watch block, docstring included, and stallsettings.ts hold no device word', () => {
    const block = stallWatchBlock(ROUTES_SRC());
    expect(block).toContain("app.get('/api/coord/stall-watch'");
    expect(block, 'the stall-watch routes\' prose names a device').not.toMatch(DEVICE_WORD);
    expect(readFileSync(path.join(srcRoot, 'coord', 'stallsettings.ts'), 'utf8')).not.toMatch(DEVICE_WORD);
  });
});

describe('M16b: the arming row has one writer, the session-only door', () => {
  const files = (): string[] => sourcesUnder(srcRoot);

  it('CONTROL: the scanner sees the definition in store.ts', () => {
    expect(files().length).toBeGreaterThan(30);
    const storeSrc = blankCommentsAndStrings(readFileSync(path.join(srcRoot, 'coord', 'store.ts'), 'utf8'));
    expect([...storeSrc.matchAll(/\bsetStallSettings\s*\(/g)].length).toBe(1);
  });

  it('setStallSettings( is spelled on a code line only at its definition and inside the POST handler', () => {
    const sites = files().flatMap((f) => {
      const n = [...blankCommentsAndStrings(readFileSync(f, 'utf8')).matchAll(/\bsetStallSettings\s*\(/g)].length;
      return n === 0 ? [] : [`${path.relative(srcRoot, f)}:${n}`];
    }).sort();
    expect(sites).toEqual([path.join('coord', 'routes.ts') + ':1', path.join('coord', 'store.ts') + ':1']);
    const handler = blankCommentsAndStrings(postHandler(ROUTES_SRC()));
    expect([...handler.matchAll(/\bsetStallSettings\s*\(/g)].length, 'the routes.ts call is not in the POST handler')
      .toBe(1);
  });

  it('SQL that writes stall_settings appears only in schema.ts (the seed) and store.ts', () => {
    const sites = files()
      .filter((f) => /\b(?:INSERT\s+INTO|UPDATE)\s+stall_settings\b/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(srcRoot, f)).sort();
    expect(sites).toEqual([path.join('coord', 'schema.ts'), path.join('coord', 'store.ts')]);
  });
});
