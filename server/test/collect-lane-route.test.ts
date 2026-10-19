/**
 * THE COLLECTOR SWITCH, the routes (path-identity spec 2026-10-12 §5.6): `GET` and `POST /api/coord/collect-lane`,
 * registered in `coord/routes.ts` right after the stall-watch POST.
 *
 * The routes are registered on a bare Fastify, the `stall-settings-route.test.ts` idiom. A case can then hand
 * `registerCoordRoutes` its own `sessionAuth` (a session with a label, or none) and its own watcher (the counts
 * accessor). The rest is real:
 * - a `CoordStore` over a fixture `coord.db`;
 * - the journal adapter over the fixture's `~/.ccrc`;
 * - a `FleetIdentityCell`;
 * - the local io, bent at the registry listing alone. There a case may hold the POST's one await, answer `null`, or
 *   change the world inside it.
 *
 * FIXTURE HOME ONLY: every path derives from `mkTmp`. No marker name and no journal name is spelled here. The
 * collector's marker comes from its definer, the pause's from `rundefs.ts`, and the journal's basename from its
 * adapter.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Deps } from '../src/server.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { Bus } from '../src/bus.js';
import { NO_SESSION, type GateDecision } from '../src/auth/gate.js';
import type { FleetWatcher } from '../src/watch.js';
import type { FleetIO } from '../src/io.js';
import type { FleetState } from '../src/fleetstate.js';
import { COLLECT_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { MAIL_TOKEN_HEADER } from '../src/coord/token.js';
import { FleetIdentityCell } from '../src/fleetidentity.js';
import {
  COLLECT_LANE_JOURNAL_BASENAME, collectLaneJournalAt, defaultCollectLaneJournalPath,
} from '../src/coord/collectLaneJournal.js';
import {
  COLLECT_FEED_TITLE, COLLECT_LANE_APPLIES_TEXT, COLLECT_LANE_LIVE_MARKER, COLLECT_SETTING_FEED_TITLE,
  type CollectLaneCounts, type CollectLaneJournal, type CollectLaneWriteRequest,
} from '../src/collectLane.js';
import type { CollectLaneConfirmRequired, CollectLaneView } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..', 'src');

const NODE_A = 'node-a';
const NODE_B = 'node-b';
/** When the fixture's inventory measured the node. */
const MEASURED_AT = 1_790_000_000_000;
/** The wall clock a fixture's direct store write is stamped with. It is a positive safe integer, so a latch it sets
 *  reads as set. */
const WALL = 1_790_000_100_000;
const TOKEN = 'f'.repeat(64);
/** Both capabilities the switch's facts name, beside the two verbs the lane runs. */
const FULL_CAPS: readonly string[] = ['ws-audit', 'ws-collect', COLLECT_CAP, RECLAIM_PAUSE_CAP];

const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (apps.length) await apps.pop()!.close();
});

/** Publish `nodeId` as the node measured on the cell's current connection. */
const known = (cell: FleetIdentityCell, nodeId: string): void => {
  expect(cell.publish(cell.epochNow(), { kind: 'known', nodeId, measuredAt: MEASURED_AT })).toEqual({ kind: 'published' });
};
/** A new connection to the fleet: the epoch moves, and the node is measured again on it. */
const reconnect = (cell: FleetIdentityCell, nodeId: string): void => {
  cell.invalidate('awaiting-inventory');
  known(cell, nodeId);
};

interface RigOpts {
  authEnabled?: boolean;
  /** `false`: the armed gate let a request through with no session (`NO_SESSION`). */
  session?: boolean;
  device?: string | null;
  coord?: boolean;
  collectLane?: boolean;
  /** Wraps the real journal adapter that the ROUTE is handed, for a case whose append must fail. */
  journal?: (real: CollectLaneJournal) => CollectLaneJournal;
  /** What the watcher's `currentCollectCounts()` answers. `undefined` registers no watcher at all. */
  counts?: CollectLaneCounts | null;
  mailToken?: string;
  bootNonce?: string;
}
/** Run inside the registry listing, before it reads. It may await, change the world, or answer `null`. */
type Listing = () => Promise<'null' | void>;

const rig = async (o: RigOpts = {}) => {
  const home = mkTmp('ccrc-collect-lane-route-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const db = openCoordDb(path.join(home, '.ccrc', 'coord.db'));
  const coord = new CoordStore(db);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const base = testDeps(home);
  const journalPath = defaultCollectLaneJournalPath(base.cfg.ccrcDir);
  const journal = collectLaneJournalAt(journalPath);
  const cell = new FleetIdentityCell();
  reconnect(cell, NODE_A);
  const state: FleetState = { connected: true, downSince: null, rosterFp: null, build: null, ccdVerbs: [...FULL_CAPS] };
  let onListing: Listing | null = null;
  const io: FleetIO = {
    ...base.io,
    readdir: async (p: string, timeoutMs?: number, signal?: AbortSignal) => {
      const fn = onListing;
      if (p === reg && fn !== null && (await fn()) === 'null') return null;
      return base.io.readdir(p, timeoutMs, signal);
    },
  };
  const deps: Deps = {
    ...base, io, notifyLog, fleetState: state, fleetIdentity: cell,
    cfg: { ...base.cfg, authEnabled: o.authEnabled ?? false },
    ...(o.coord === false ? {} : { coord }),
    ...(o.collectLane === false ? {}
      : { collectLane: { journal: o.journal?.(journal) ?? journal, bootNonce: o.bootNonce ?? 'boot-1' } }),
    ...(o.mailToken === undefined ? {} : { mailToken: o.mailToken }),
  };
  const sessionAuth = (): GateDecision => (o.session === false ? NO_SESSION
    : { allow: true, verdict: 'ok', reason: 'session', device: o.device ?? null });
  const watcher = o.counts === undefined ? undefined
    : ({ currentCollectCounts: () => o.counts } as unknown as FleetWatcher);
  /** The routes on a fresh Fastify over the same store, journal and cell. A new nonce is a server restart. */
  const open = (bootNonce?: string): FastifyInstance => {
    const lane = deps.collectLane;
    const d: Deps = bootNonce === undefined || lane === undefined ? deps : { ...deps, collectLane: { ...lane, bootNonce } };
    const app = Fastify();
    registerCoordRoutes(app, d, new Bus(), sessionAuth, { tmux: d.tmux, queue: d.queue, readAsk: async () => null }, watcher);
    apps.push(app);
    return app;
  };
  return {
    app: open(), open, home, reg, db, coord, notifyLog, journal, journalPath, cell, state,
    setListing: (fn: Listing | null): void => { onListing = fn; },
  };
};
type Rig = Awaited<ReturnType<typeof rig>>;

const getView = (app: FastifyInstance, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: '/api/coord/collect-lane', headers });
const post = (app: FastifyInstance, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/coord/collect-lane', payload: payload as Record<string, unknown>, headers });
const viewOf = (res: { json: () => unknown }): CollectLaneView => res.json() as CollectLaneView;
const journalText = (t: Rig): string | null => (existsSync(t.journalPath) ? readFileSync(t.journalPath, 'utf8') : null);
const serverWarns = (warn: { mock: { calls: unknown[][] } }): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('ccrc-server:'));

/** POST Live with no key, and answer the 409 that carries the key. */
const keyFor = async (app: FastifyInstance): Promise<CollectLaneConfirmRequired> => {
  const res = await post(app, { choice: 'live' });
  expect(res.statusCode, res.body).toBe(409);
  const b = res.json() as CollectLaneConfirmRequired;
  expect(b.error).toBe('confirm-required');
  return b;
};
/** A direct store write, for a case's starting state. It goes through the store's one writer, never through SQL. */
const storeWrite = (t: Rig, req: CollectLaneWriteRequest): void => {
  const w = t.coord.setCollectLane(req, WALL, t.journal);
  expect(w.kind, w.kind === 'refused' ? `${w.code}: ${w.detail}` : w.kind).toBe('written');
};
const retire = (t: Rig): void =>
  storeWrite(t, { kind: 'retire', expected: t.coord.collectLaneRow(), expectedJournal: t.journal.read() });
const storeLive = (t: Rig, nodeId: string): void =>
  storeWrite(t, { kind: 'live', fleetNodeId: nodeId, expected: t.coord.collectLaneRow(), expectedJournal: t.journal.read() });
const unlistable = (t: Rig): void => t.setListing(async () => 'null' as const);
/** The connection moves while the POST's one listing is in flight. It is the same node, on a new epoch. */
const epochMovesInside = (t: Rig): void => t.setListing(async () => { t.setListing(null); reconnect(t.cell, NODE_A); });

const ROUTES_SRC = (): string => readFileSync(path.join(srcRoot, 'coord', 'routes.ts'), 'utf8');
const GET_DECL = "app.get('/api/coord/collect-lane'";
const POST_DECL = "app.post('/api/coord/collect-lane'";
const DOC_ANCHOR = '/** `GET`/`POST /api/coord/collect-lane`';
/** `coord-pause-route.test.ts`'s two mechanisms for "the token was checked". */
const GATE_PATTERNS = [/requireMailToken\(req/, /checkMailToken\(/];
/** The word the old Notifications row label began with (`stall-settings-route.test.ts`'s scan, copied). */
const DEVICE_WORD = /phone/i;
/** `auth-gate.test.ts`'s comment strip, unchanged. */
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
/** The text from `from` to the next route registration after `decl`. Fails loudly on a missing anchor. */
const sliceTo = (raw: string, decl: string, from: number = raw.indexOf(decl)): string => {
  const at = raw.indexOf(decl);
  expect(at, `${decl} is gone — this scan is over nothing`).toBeGreaterThan(-1);
  expect(from, 'the slice starts after the registration it must cover').toBeLessThanOrEqual(at);
  const next = /app\.(?:get|post)\('/.exec(raw.slice(at + decl.length));
  return raw.slice(from, next === null ? raw.length : at + decl.length + next.index);
};

describe('GET and POST /api/coord/collect-lane (path-identity spec §5.6)', () => {
  it('400 on a non-object, an unknown key, a bad choice or a bad confirm; nothing written, no journal, no feed', async () => {
    const t = await rig({ authEnabled: true });
    const before = t.coord.collectLaneRow();
    const bodies: unknown[] = [
      [], {}, { choice: 'live', extra: 1 }, { choice: 'LIVE' }, { choice: 'toString' },
      { choice: 'live', confirm: 7 }, { choice: 'live', confirm: 'XYZ' }, { choice: 'off', confirm: 'ABCDEF12' },
      { choice: 'live', confirm: 'abcdef1' }, { choice: 'live', confirm: 'abcdef123' },
    ];
    for (const b of bodies) {
      const res = await post(t.app, b);
      expect(res.statusCode, JSON.stringify(b)).toBe(400);
      const body = res.json() as { ok: boolean; error: string; detail: string };
      expect(body, JSON.stringify(b)).toMatchObject({ ok: false, error: 'bad-request' });
      expect(body.detail.length, JSON.stringify(b)).toBeGreaterThan(0);
    }
    expect(((await post(t.app, { choice: 'live', extra: 1 })).json() as { detail: string }).detail,
      'an unknown key is refused by name').toContain('extra');
    const scalar = await t.app.inject({ method: 'POST', url: '/api/coord/collect-lane', payload: JSON.stringify('live'),
      headers: { 'content-type': 'application/json' } });
    expect(scalar.statusCode).toBe(400);
    expect(t.coord.collectLaneRow()).toEqual(before);
    expect(journalText(t)).toBeNull();
    expect(t.coord.feedEvents(10)).toEqual([]);
  });

  it('501 for both verbs with no store, and with no collectLane', async () => {
    for (const o of [{ coord: false }, { collectLane: false }] as RigOpts[]) {
      const t = await rig({ ...o, authEnabled: true });
      for (const res of [await getView(t.app), await post(t.app, { choice: 'off' }), await post(t.app, { choice: 'live' })]) {
        expect(res.statusCode, JSON.stringify(o)).toBe(501);
        expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
      }
    }
  });

  it('403 sign-in-unarmed for Live while dark, and for Live armed without a session; Off and GET stay open dark', async () => {
    const dark = await rig();
    const before = dark.coord.collectLaneRow();
    for (const b of [{ choice: 'live' }, { choice: 'live', confirm: '0123abcd' }]) {
      const res = await post(dark.app, b);
      expect(res.statusCode, JSON.stringify(b)).toBe(403);
      expect(res.json()).toEqual({ ok: false, error: 'sign-in-unarmed' });
    }
    const noSession = await rig({ authEnabled: true, session: false });
    const refused = await post(noSession.app, { choice: 'live' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({ ok: false, error: 'sign-in-unarmed' });
    expect(dark.coord.collectLaneRow()).toEqual(before);
    expect(journalText(dark)).toBeNull();
    expect(journalText(noSession)).toBeNull();
    expect([...dark.coord.feedEvents(10), ...noSession.coord.feedEvents(10)]).toEqual([]);
    // Off and the read keep the ordinary open-dark behaviour.
    expect((await getView(dark.app)).statusCode).toBe(200);
    retire(dark);
    storeLive(dark, NODE_A);
    const off = await post(dark.app, { choice: 'off' });
    expect(off.statusCode, off.body).toBe(200);
    expect(viewOf(off).stored).toMatchObject({ read: 'row', choice: 'off', fleetNodeId: null });
  });

  it('an absent row answers 503 state-unmeasurable to both verbs, and nothing is inserted', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = await rig({ authEnabled: true });
    t.db.prepare('DELETE FROM collect_lane_settings WHERE id = 1').run();
    for (const res of [await getView(t.app), await post(t.app, { choice: 'off' }), await post(t.app, { choice: 'live' })]) {
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ ok: false, error: 'state-unmeasurable' });
      expect(res.body).not.toContain(t.home);
    }
    const n = (t.db.prepare('SELECT COUNT(*) AS n FROM collect_lane_settings').get() as { n: number | bigint }).n;
    expect(Number(n), 'the server never inserts a row').toBe(0);
    expect(journalText(t)).toBeNull();
  });

  it('the POST answers 503 state-unmeasurable for every unmeasurable control state and every unsafe Live measure, and the body names neither the journal\'s basename nor the fixture home', async () => {
    const cases: [string, (t: Rig) => void, readonly ('off' | 'live')[]][] = [
      ['a malformed journal', (t) => writeFileSync(t.journalPath, 'not json\n'), ['off', 'live']],
      ['an unreadable journal (past the 1 MiB cap)', (t) => writeFileSync(t.journalPath, 'x'.repeat(1_048_577)), ['off', 'live']],
      ['a missing journal beside a non-seed row',
        (t) => { t.db.prepare('UPDATE collect_lane_settings SET updatedAt = 5 WHERE id = 1').run(); }, ['off', 'live']],
      ['a malformed row', (t) => { t.db.prepare("UPDATE collect_lane_settings SET generation = 'x' WHERE id = 1").run(); },
        ['off', 'live']],
      ['the node unmeasured', (t) => { t.cell.invalidate('link-down'); }, ['live']],
      ['the node in collision',
        (t) => { t.cell.publish(t.cell.epochNow(), { kind: 'collision', why: 'node-id-keys-another-live-row' }); }, ['live']],
      ['an unlistable registry', unlistable, ['live']],
      ['an epoch moved inside the held listing', epochMovesInside, ['live']],
    ];
    for (const [name, bend, choices] of cases) {
      for (const choice of choices) {
        const t = await rig({ authEnabled: true });
        const key = choice === 'live' ? (await keyFor(t.app)).confirmKey : null;
        bend(t);
        const res = await post(t.app, key === null ? { choice } : { choice, confirm: key });
        expect(res.statusCode, `${name}, ${choice}`).toBe(503);
        expect(res.json(), `${name}, ${choice}`).toMatchObject({ ok: false, error: 'state-unmeasurable' });
        expect(res.body, `${name}: the journal's name`).not.toContain(COLLECT_LANE_JOURNAL_BASENAME);
        expect(res.body, `${name}: the fixture home`).not.toContain(t.home);
        expect(t.coord.feedEvents(10), name).toEqual([]);
      }
    }
  });

  it('the GET answers 200 with a safety-stopped view for a malformed or unreadable row and for each journal fault, never 503', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cases: [string, (t: Rig) => void, Partial<CollectLaneView>][] = [
      ['a malformed row', (t) => { t.db.prepare("UPDATE collect_lane_settings SET generation = 'x' WHERE id = 1").run(); },
        { stored: { read: 'malformed' } }],
      ['an unreadable row', (t) => { t.db.prepare('DROP TABLE collect_lane_settings').run(); },
        { stored: { read: 'unreadable' } }],
      ['a malformed journal', (t) => writeFileSync(t.journalPath, '{"generation":\n'), { journal: { read: 'malformed' } }],
      ['an unreadable journal', (t) => writeFileSync(t.journalPath, 'x'.repeat(1_048_577)), { journal: { read: 'unreadable' } }],
      ['a journal that is a directory', (t) => mkdirSync(t.journalPath), { journal: { read: 'not-regular' } }],
      ['a missing journal beside a non-seed row',
        (t) => { t.db.prepare('UPDATE collect_lane_settings SET updatedAt = 5 WHERE id = 1').run(); },
        { journal: { read: 'missing' } }],
    ];
    for (const [name, bend, want] of cases) {
      const t = await rig();
      bend(t);
      const res = await getView(t.app);
      expect(res.statusCode, name).toBe(200);
      const v = viewOf(res);
      expect(v, name).toMatchObject(want);
      expect(v.control, name).toEqual({ state: 'unmeasurable' });
      expect(v.effective, name).toEqual({ state: 'safety-stopped', armedBy: 'neither' });
      expect(res.body, name).not.toContain(t.home);
    }
  });

  it('409 marker-still-controls for Off before the latch, whatever the listing', async () => {
    const bends: [string, (t: Rig) => void][] = [
      ['the marker absent', () => {}],
      ['the marker standing', (t) => writeFileSync(path.join(t.reg, COLLECT_LANE_LIVE_MARKER), '')],
      ['an unlistable registry', unlistable],
      ['an epoch moved inside the listing', epochMovesInside],
    ];
    for (const [name, bend] of bends) {
      const t = await rig();
      storeLive(t, NODE_A);   // a stored Live the operator might want to turn off, before the latch
      bend(t);
      const res = await post(t.app, { choice: 'off' });
      expect(res.statusCode, name).toBe(409);
      expect(res.json(), name).toMatchObject({ ok: false, error: 'marker-still-controls' });
      expect(journalText(t), name).toBe('{"generation":1}\n');
      expect(t.coord.feedEvents(10), name).toEqual([]);
    }
  });

  it('409 confirm-required carries facts and confirmKey; nothing written', async () => {
    const counts = { wouldCollect: 2, held: 1, boxLines: 0 };
    const t = await rig({ authEnabled: true, counts });
    const before = t.coord.collectLaneRow();
    const b = await keyFor(t.app);
    expect(b.confirmKey).toMatch(/^[0-9a-f]{8}$/);
    // Exact: the wire facts carry neither the boot nonce nor the epoch, which only the key binds.
    expect(b).toEqual({
      ok: false, error: 'confirm-required', confirmKey: b.confirmKey,
      facts: {
        node: { nodeId: NODE_A, measuredAt: MEASURED_AT }, caps: { collect: true, reclaimPause: true }, paused: false,
        marker: 'absent', repair: null, attention: counts,
      },
    });
    expect(t.coord.collectLaneRow()).toEqual(before);
    expect(journalText(t)).toBeNull();
    expect(t.coord.feedEvents(10)).toEqual([]);
  });

  it('409 confirm-stale for each changed fact', async () => {
    const changes: [string, (t: Rig) => void][] = [
      ['another write', (t) => retire(t)],
      ['the marker', (t) => writeFileSync(path.join(t.reg, COLLECT_LANE_LIVE_MARKER), '')],
      ['the pause', (t) => writeFileSync(path.join(t.reg, RECLAIM_PAUSE_MARKER), '')],
      ['ccdVerbs', (t) => { t.state.ccdVerbs = FULL_CAPS.filter((v) => v !== RECLAIM_PAUSE_CAP); }],
      ['the epoch', (t) => reconnect(t.cell, NODE_A)],
      ['the node', (t) => known(t.cell, NODE_B)],
      ['a journal line', (t) => appendFileSync(t.journalPath, '{"generation":5}\n')],
    ];
    for (const [name, change] of changes) {
      const t = await rig({ authEnabled: true });
      const first = await keyFor(t.app);
      change(t);
      const journalBefore = journalText(t);
      const rowBefore = t.coord.collectLaneRow();
      const res = await post(t.app, { choice: 'live', confirm: first.confirmKey });
      expect(res.statusCode, `${name}: ${res.body}`).toBe(409);
      const b = res.json() as CollectLaneConfirmRequired;
      expect(b.error, name).toBe('confirm-stale');
      expect(b.confirmKey, name).toMatch(/^[0-9a-f]{8}$/);
      expect(b.confirmKey, `${name}: a stale answer carries a FRESH key`).not.toBe(first.confirmKey);
      expect(t.coord.collectLaneRow(), name).toEqual(rowBefore);
      expect(journalText(t), name).toBe(journalBefore);
      expect(t.coord.feedEvents(10), name).toEqual([]);
    }
  });

  it('a key minted before a restart is confirm-stale: the boot nonce is a fact', async () => {
    const t = await rig({ authEnabled: true, bootNonce: 'boot-1' });
    const first = await keyFor(t.app);
    const restarted = t.open('boot-2');
    const res = await post(restarted, { choice: 'live', confirm: first.confirmKey });
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as CollectLaneConfirmRequired).error).toBe('confirm-stale');
    expect(journalText(t)).toBeNull();
  });

  it('the same key with unchanged facts writes generation 1', async () => {
    const t = await rig({ authEnabled: true });
    const k = await keyFor(t.app);
    const res = await post(t.app, { choice: 'live', confirm: k.confirmKey });
    expect(res.statusCode, res.body).toBe(200);
    const v = viewOf(res);
    expect(v.stored).toMatchObject({ read: 'row', choice: 'live', fleetNodeId: NODE_A, markerRetiredAt: null, generation: 1 });
    expect(v.journal).toEqual({ read: 'ok', max: 1 });
    expect(v.control).toEqual({ state: 'coherent', bootstrap: false });
    expect(v.effective).toEqual({ state: 'live', armedBy: 'settings' });
    expect(journalText(t)).toBe('{"generation":1}\n');
    expect(t.coord.feedEvents(10)).toHaveLength(1);
  });

  it('a no-op Live with a fresh key answers 200 with no generation and no event, after a no-op proof', async () => {
    const t = await rig({ authEnabled: true });
    const k1 = await keyFor(t.app);
    expect((await post(t.app, { choice: 'live', confirm: k1.confirmKey })).statusCode).toBe(200);
    // A no-op Live still needs a fresh confirm: the bare POST answers confirm-required again.
    const k2 = await keyFor(t.app);
    expect(k2.confirmKey, 'the row moved, so the key did').not.toBe(k1.confirmKey);
    const res = await post(t.app, { choice: 'live', confirm: k2.confirmKey });
    expect(res.statusCode, res.body).toBe(200);
    expect(viewOf(res).stored).toMatchObject({ choice: 'live', fleetNodeId: NODE_A, generation: 1 });
    expect(journalText(t)).toBe('{"generation":1}\n');
    expect(t.coord.feedEvents(10)).toHaveLength(1);
  });

  it('Off wins: Live\'s listing held while Off completes; Live then answers confirm-stale; the row is off, node null', async () => {
    const t = await rig({ authEnabled: true });
    retire(t);
    storeLive(t, NODE_A);
    const k = await keyFor(t.app);
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let entered!: () => void;
    const reached = new Promise<void>((r) => { entered = r; });
    t.setListing(async () => { t.setListing(null); entered(); await held; });
    const pending = post(t.app, { choice: 'live', confirm: k.confirmKey });
    await reached;
    const off = await post(t.app, { choice: 'off' });   // its listing is not held: the hook cleared itself
    expect(off.statusCode, off.body).toBe(200);
    release();
    const live = await pending;
    expect(live.statusCode, live.body).toBe(409);
    expect((live.json() as CollectLaneConfirmRequired).error).toBe('confirm-stale');
    const s = viewOf(await getView(t.app)).stored;
    expect(s).toMatchObject({ read: 'row', choice: 'off', fleetNodeId: null, generation: 3 });
    if (s.read !== 'row') throw new Error('unreachable');
    expect(s.markerRetiredAt, 'Off keeps the latch').not.toBeNull();
    expect(journalText(t)).toBe('{"generation":1}\n{"generation":2}\n{"generation":3}\n');
  });

  it('Off with the latch set writes while the registry is unlistable or the epoch moved', async () => {
    for (const [name, bend] of [['unlistable', unlistable], ['epoch moved', epochMovesInside]] as const) {
      const t = await rig();
      retire(t);
      storeLive(t, NODE_A);
      bend(t);
      const res = await post(t.app, { choice: 'off' });
      expect(res.statusCode, `${name}: ${res.body}`).toBe(200);
      t.setListing(null);
      expect(viewOf(await getView(t.app)).stored, name).toMatchObject({ choice: 'off', fleetNodeId: null, generation: 3 });
    }
  });

  it('Live is accepted while a capability is missing and the pause stands; both are in the facts', async () => {
    const t = await rig({ authEnabled: true });
    t.state.ccdVerbs = FULL_CAPS.filter((v) => v !== COLLECT_CAP);
    writeFileSync(path.join(t.reg, RECLAIM_PAUSE_MARKER), '');
    const k = await keyFor(t.app);
    expect(k.facts).toMatchObject({ caps: { collect: false, reclaimPause: true }, paused: true });
    const res = await post(t.app, { choice: 'live', confirm: k.confirmKey });
    expect(res.statusCode, res.body).toBe(200);
    expect(viewOf(res).stored).toMatchObject({ choice: 'live', fleetNodeId: NODE_A, generation: 1 });
    expect(viewOf(res).effective).toEqual({ state: 'paused', armedBy: 'neither' });
  });

  it('409 conflict when the store\'s in-transaction read differs; no generation consumed', async () => {
    const strangers: [string, (t: Rig) => void, RegExp, string][] = [
      ['the row', (t) => { t.db.prepare('UPDATE collect_lane_settings SET updatedAt = updatedAt + 1 WHERE id = 1').run(); },
        /row/, '{"generation":1}\n'],
      ['the journal', (t) => appendFileSync(t.journalPath, '{"generation":2}\n'),
        /journal/, '{"generation":1}\n{"generation":2}\n'],
    ];
    for (const [name, stranger, names, journalAfter] of strangers) {
      const t = await rig({ authEnabled: true });
      retire(t);
      const k = await keyFor(t.app);
      const real = t.coord.setCollectLane.bind(t.coord);
      // A stranger writes between the route's read and the store's transaction.
      vi.spyOn(t.coord, 'setCollectLane').mockImplementation((...a) => { stranger(t); return real(...a); });
      const res = await post(t.app, { choice: 'live', confirm: k.confirmKey });
      expect(res.statusCode, `${name}: ${res.body}`).toBe(409);
      const b = res.json() as { ok: boolean; error: string; detail: string };
      expect(b.ok, name).toBe(false);
      expect(b.error, name).toBe('conflict');
      expect(b.detail, `${name}: the detail names which read moved`).toMatch(names);
      vi.restoreAllMocks();
      expect(journalText(t), `${name}: the store appended nothing`).toBe(journalAfter);
      expect(t.coord.feedEvents(10), name).toEqual([]);
    }
  });

  it('503 write-failed on an append failure (row and journal unchanged) and on a database failure (journal ahead); exactly one console.warn starting ccrc-server:', async () => {
    const failing = (real: CollectLaneJournal): CollectLaneJournal => ({
      read: () => real.read(),
      appendGeneration: () => { throw Object.assign(new Error('EIO: injected append failure'), { code: 'EIO' }); },
    });
    const cases: [string, RigOpts, (t: Rig) => void, string | null][] = [
      ['an append failure', { journal: failing }, () => {}, null],
      ['a database failure after the append', {}, (t) => {
        t.db.exec("CREATE TRIGGER collect_lane_refuse BEFORE UPDATE ON collect_lane_settings BEGIN SELECT RAISE(ABORT, 'injected'); END");
      }, '{"generation":1}\n'],
    ];
    for (const [name, o, bend, journalAfter] of cases) {
      const t = await rig({ authEnabled: true, ...o });
      const rowBefore = t.coord.collectLaneRow();
      const k = await keyFor(t.app);
      bend(t);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const res = await post(t.app, { choice: 'live', confirm: k.confirmKey });
      expect(res.statusCode, `${name}: ${res.body}`).toBe(503);
      expect(res.json(), name).toMatchObject({ ok: false, error: 'write-failed' });
      expect(res.body, `${name}: no errno on the wire`).not.toContain('EIO');
      expect(res.body, name).not.toContain(t.home);
      expect(serverWarns(warn), name).toHaveLength(1);
      expect(t.coord.collectLaneRow(), name).toEqual(rowBefore);
      expect(journalText(t), name).toBe(journalAfter);
      expect(t.coord.feedEvents(10), name).toEqual([]);
      vi.restoreAllMocks();
    }
  });

  it('Off: 503 write-failed on an append failure and on a database failure after the append; the row and its latch unchanged; exactly one console.warn', async () => {
    const failing = (real: CollectLaneJournal): CollectLaneJournal => ({
      read: () => real.read(),
      appendGeneration: () => { throw Object.assign(new Error('EIO: injected append failure'), { code: 'EIO' }); },
    });
    const cases: [string, RigOpts, (t: Rig) => void, string][] = [
      ['an append failure', { journal: failing }, () => {}, '{"generation":1}\n{"generation":2}\n'],
      ['a database failure after the append', {}, (t) => {
        t.db.exec("CREATE TRIGGER collect_lane_refuse BEFORE UPDATE ON collect_lane_settings BEGIN SELECT RAISE(ABORT, 'injected'); END");
      }, '{"generation":1}\n{"generation":2}\n{"generation":3}\n'],
    ];
    for (const [name, o, bend, journalAfter] of cases) {
      const t = await rig(o);
      // Through the real journal: the failing one is the ROUTE's alone.
      retire(t);
      storeLive(t, NODE_A);
      const rowBefore = t.coord.collectLaneRow();
      bend(t);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const res = await post(t.app, { choice: 'off' });
      expect(res.statusCode, `${name}: ${res.body}`).toBe(503);
      expect(res.json(), name).toMatchObject({ ok: false, error: 'write-failed' });
      expect(res.body, `${name}: no errno on the wire`).not.toMatch(/EIO|ERR_SQLITE/);
      expect(serverWarns(warn), name).toHaveLength(1);
      expect(t.coord.collectLaneRow(), `${name}: the row, its latch included, is unchanged`).toEqual(rowBefore);
      expect(journalText(t), name).toBe(journalAfter);
      expect(t.coord.feedEvents(10), name).toEqual([]);
      vi.restoreAllMocks();
    }
  });

  it('a throw from the store before its append (a busy BEGIN IMMEDIATE) answers 503 write-failed, never a 500; exactly one console.warn', async () => {
    const t = await rig({ authEnabled: true });
    const rowBefore = t.coord.collectLaneRow();
    const k = await keyFor(t.app);
    vi.spyOn(t.coord, 'setCollectLane').mockImplementation(() => {
      throw Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR' });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post(t.app, { choice: 'live', confirm: k.confirmKey });
    expect(res.statusCode, res.body).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'write-failed' });
    expect(res.body, 'the driver\'s message stays off the wire').not.toMatch(/locked|ERR_SQLITE/);
    expect(serverWarns(warn)).toHaveLength(1);
    expect(t.coord.collectLaneRow()).toEqual(rowBefore);
    expect(journalText(t)).toBeNull();
    expect(t.coord.feedEvents(10)).toEqual([]);
    vi.restoreAllMocks();
  });

  it('a 200 needs the re-read proof: a row changed before return answers 503 write-failed, with the event recorded', async () => {
    const t = await rig({ authEnabled: true });
    const k = await keyFor(t.app);
    const real = t.coord.setCollectLane.bind(t.coord);
    vi.spyOn(t.coord, 'setCollectLane').mockImplementation((...a) => {
      const w = real(...a);
      // A second writer lands between the store's commit and the route's re-read.
      t.db.prepare("UPDATE collect_lane_settings SET choice = 'off' WHERE id = 1").run();
      return w;
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post(t.app, { choice: 'live', confirm: k.confirmKey });
    expect(res.statusCode, res.body).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'write-failed' });
    expect(t.coord.feedEvents(10), 'the store said written, so the event stands').toHaveLength(1);
    expect(serverWarns(warn)).toHaveLength(1);
  });

  it('repair: a confirmed Live on an ahead journal writes max+1 and says repairing; on a behind journal (row 5, journal 4) it writes 6 and still says repairing; Off after the latch repairs without a key', async () => {
    // Ahead: the seed row beside a journal at 5.
    const a = await rig({ authEnabled: true });
    writeFileSync(a.journalPath, '{"generation":5}\n');
    const ka = await keyFor(a.app);
    expect(ka.facts.repair).toBe('journal-ahead');
    const ra = await post(a.app, { choice: 'live', confirm: ka.confirmKey });
    expect(ra.statusCode, ra.body).toBe(200);
    expect(viewOf(ra).stored).toMatchObject({ choice: 'live', fleetNodeId: NODE_A, generation: 6 });
    expect(viewOf(ra).control).toEqual({ state: 'coherent', bootstrap: false });
    expect(a.coord.feedEvents(10).at(-1)!.body).toContain('repairing');
    // Behind: row 5, journal 4. The repair is read from the journal before the write, not from the generation step.
    const b = await rig({ authEnabled: true });
    b.db.prepare('UPDATE collect_lane_settings SET generation = 5, updatedAt = 1 WHERE id = 1').run();
    writeFileSync(b.journalPath, '{"generation":4}\n');
    const kb = await keyFor(b.app);
    expect(kb.facts.repair).toBe('journal-behind');
    const rb = await post(b.app, { choice: 'live', confirm: kb.confirmKey });
    expect(rb.statusCode, rb.body).toBe(200);
    expect(viewOf(rb).stored).toMatchObject({ choice: 'live', generation: 6 });
    expect(b.coord.feedEvents(10).at(-1)!.body).toContain('repairing');
    // Off after the latch, on a behind journal: no key, dark.
    const c = await rig();
    c.db.prepare('UPDATE collect_lane_settings SET choice = ?, fleetNodeId = ?, markerRetiredAt = ?, generation = 5, updatedAt = 1 WHERE id = 1')
      .run('live', NODE_A, WALL);
    writeFileSync(c.journalPath, '{"generation":4}\n');
    const rc = await post(c.app, { choice: 'off' });
    expect(rc.statusCode, rc.body).toBe(200);
    expect(viewOf(rc).stored).toMatchObject({ choice: 'off', fleetNodeId: null, markerRetiredAt: WALL, generation: 6 });
    const ev = c.coord.feedEvents(10).at(-1)!;
    expect(ev.body).toContain('repairing');
    expect(ev.body.endsWith('; by flag-off')).toBe(true);
  });

  it('the GET resolves under the epoch pair of its own listing: a reconnect inside it reads unknown-fleet', async () => {
    const t = await rig({ authEnabled: true });
    const k = await keyFor(t.app);
    expect((await post(t.app, { choice: 'live', confirm: k.confirmKey })).statusCode).toBe(200);
    expect(viewOf(await getView(t.app)).effective, 'steady: Live for this node').toEqual({ state: 'live', armedBy: 'settings' });
    epochMovesInside(t);
    expect(viewOf(await getView(t.app)).effective, 'the connection moved while the GET listed')
      .toEqual({ state: 'unknown-fleet', armedBy: 'neither' });
    expect(viewOf(await getView(t.app)).effective, 'the next read, on the new connection, measured the same node')
      .toEqual({ state: 'live', armedBy: 'settings' });
  });

  it('the 200 carries the notice', async () => {
    const t = await rig({ authEnabled: true });
    const k = await keyFor(t.app);
    const res = await post(t.app, { choice: 'live', confirm: k.confirmKey });
    expect(res.statusCode, res.body).toBe(200);
    expect(viewOf(res).notice).toBe(COLLECT_LANE_APPLIES_TEXT);
    expect(viewOf(await getView(t.app)).notice, 'the GET carries none').toBeNull();
  });

  it('GET shows the raw stored token, keeps every read state distinct, and warns once per standing fault', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lines = (): string[] => serverWarns(warn).filter((l) => l.startsWith('ccrc-server: collect-lane'));
    expect(viewOf(await getView((await rig()).app)).attention, 'no watcher: not measured yet').toBeNull();
    const t = await rig({ counts: { wouldCollect: 0, held: 3, boxLines: 1 } });
    // The seed: a coherent bootstrap, the node known, and nothing stored for it.
    expect(viewOf(await getView(t.app))).toMatchObject({
      stored: { read: 'row', choice: 'off', fleetNodeId: null, markerRetiredAt: null, generation: 0, updatedAt: 0 },
      journal: { read: 'missing' }, control: { state: 'coherent', bootstrap: true },
      effective: { state: 'shadowed', armedBy: 'neither' }, marker: { listing: 'absent', latch: 'unset' },
      node: { state: 'known', nodeId: NODE_A, measuredAt: MEASURED_AT, stored: 'none' },
      caps: { collect: true, reclaimPause: true }, attention: { wouldCollect: 0, held: 3, boxLines: 1 }, notice: null,
    });
    // A future token, coherent: shown raw, and shadowed.
    t.db.prepare("UPDATE collect_lane_settings SET choice = 'shadowed', generation = 1, updatedAt = 1 WHERE id = 1").run();
    writeFileSync(t.journalPath, '{"generation":1}\n');
    const future = viewOf(await getView(t.app));
    expect(future.stored).toEqual({ read: 'row', choice: 'shadowed', fleetNodeId: null, markerRetiredAt: null, generation: 1, updatedAt: 1 });
    expect(future.journal).toEqual({ read: 'ok', max: 1 });
    expect(future.control).toEqual({ state: 'coherent', bootstrap: false });
    expect(future.effective).toEqual({ state: 'shadowed', armedBy: 'neither' });
    expect(lines(), 'a coherent state warns nothing').toEqual([]);
    // A standing fault warns once across two reads. It re-arms on a coherent read, then warns again.
    writeFileSync(t.journalPath, 'not json\n');
    await getView(t.app);
    await getView(t.app);
    expect(lines()).toHaveLength(1);
    writeFileSync(t.journalPath, '{"generation":1}\n');
    expect(viewOf(await getView(t.app)).control).toEqual({ state: 'coherent', bootstrap: false });
    writeFileSync(t.journalPath, 'not json\n');
    await getView(t.app);
    expect(lines()).toHaveLength(2);
  });

  it('neither verb consults the box token', async () => {
    const t = await rig({ mailToken: TOKEN });
    const answers: string[] = [];
    const heads: readonly Record<string, string>[] = [{}, { [MAIL_TOKEN_HEADER]: 'e'.repeat(64) }, { [MAIL_TOKEN_HEADER]: TOKEN }];
    for (const h of heads) {
      const g = await getView(t.app, h);
      const p = await post(t.app, { choice: 'off' }, h);
      answers.push(`${g.statusCode} ${g.body} | ${p.statusCode} ${p.body}`);
    }
    expect(answers[0]).toMatch(/^200 .* \| 409 /);
    expect(new Set(answers).size, answers.join('\n')).toBe(1);
    // …and a source scan finds no gate in either handler's slice. CONTROL: it sees one where one stands.
    const raw = ROUTES_SRC();
    expect(GATE_PATTERNS.some((re) => re.test(sliceTo(raw, "app.get('/api/mail'")))).toBe(true);
    for (const decl of [GET_DECL, POST_DECL]) {
      const slice = sliceTo(raw, decl);
      expect(slice.length, decl).toBeGreaterThan(200);
      for (const re of GATE_PATTERNS) expect(slice, `${decl} consults the box token`).not.toMatch(re);
    }
  });
});

describe('the feed event: on a change only, with its actor, flushed in finally', () => {
  it('Off dark records kind coord, sessionId \'\', runId null, the title, and \'; by flag-off\'', async () => {
    const t = await rig();
    retire(t);
    storeLive(t, NODE_A);
    expect((await post(t.app, { choice: 'off' })).statusCode).toBe(200);
    const evs = t.coord.feedEvents(10);
    expect(evs).toHaveLength(1);
    const ev = evs[0]!;
    expect(ev.kind).toBe('coord');
    expect(ev.sessionId).toBe('');
    expect(ev.runId).toBeNull();
    expect(ev.title).toBe(COLLECT_SETTING_FEED_TITLE);
    expect(ev.body.endsWith('; by flag-off')).toBe(true);
    expect(ev.body).not.toContain(t.home);
    expect(ev.body).not.toContain(COLLECT_LANE_JOURNAL_BASENAME);
  });

  it('Live armed records \'; by device:<label>\'', async () => {
    const t = await rig({ authEnabled: true, device: 'probe-browser' });
    const k = await keyFor(t.app);
    expect((await post(t.app, { choice: 'live', confirm: k.confirmKey })).statusCode).toBe(200);
    const ev = t.coord.feedEvents(10).at(-1)!;
    expect(ev.title).toBe(COLLECT_SETTING_FEED_TITLE);
    expect(ev.body).toContain(NODE_A);
    expect(ev.body, 'a coherent write repairs nothing').not.toContain('repairing');
    expect(ev.body.endsWith('; by device:probe-browser')).toBe(true);
  });

  it('Off armed records \'; by device:<label>\'', async () => {
    const t = await rig({ authEnabled: true, device: 'probe-browser' });
    retire(t);
    storeLive(t, NODE_A);
    expect((await post(t.app, { choice: 'off' })).statusCode).toBe(200);
    expect(t.coord.feedEvents(10).at(-1)!.body.endsWith('; by device:probe-browser')).toBe(true);
  });

  it('a no-op and every refusal record nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = await rig({ authEnabled: true });
    expect((await post(t.app, [])).statusCode).toBe(400);
    expect((await post(t.app, { choice: 'off' })).statusCode).toBe(409);            // marker-still-controls
    const k = await keyFor(t.app);                                                    // confirm-required
    const wrong = k.confirmKey === '00000000' ? '00000001' : '00000000';
    expect((await post(t.app, { choice: 'live', confirm: wrong })).statusCode).toBe(409);   // confirm-stale
    const dark = await rig();
    expect((await post(dark.app, { choice: 'live' })).statusCode).toBe(403);
    writeFileSync(dark.journalPath, 'not json\n');
    expect((await post(dark.app, { choice: 'off' })).statusCode).toBe(503);
    retire(t);
    const noop = await post(t.app, { choice: 'off' });                                // off, null, latch set: unchanged
    expect(noop.statusCode, noop.body).toBe(200);
    expect(t.coord.feedEvents(10)).toEqual([]);
    expect(dark.coord.feedEvents(10)).toEqual([]);
  });

  it('a dropped feed table still answers 200, warns and flushes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = await rig();
    retire(t);
    storeLive(t, NODE_A);
    const flush = vi.spyOn(t.notifyLog, 'flush');
    t.db.prepare('DROP TABLE feed_events').run();
    const res = await post(t.app, { choice: 'off' });
    expect(res.statusCode, res.body).toBe(200);
    expect(viewOf(res).stored).toMatchObject({ choice: 'off', fleetNodeId: null });
    expect(warn.mock.calls.flat().join(' '), 'the premise: the archive threw').toContain('recordFeedEvent failed');
    expect(flush, 'the archive throw skipped the flush').toHaveBeenCalled();
  });

  it('the title differs from the transition row\'s', () => {
    expect(COLLECT_SETTING_FEED_TITLE).toBe('temp root collector setting changed');
    expect(COLLECT_SETTING_FEED_TITLE).not.toBe(COLLECT_FEED_TITLE.switch);
  });
});

describe('the handler never branches on the device label', () => {
  it('the POST slice holds exactly one deviceActor(sessionAuth(req).device)', () => {
    const body = stripComments(sliceTo(ROUTES_SRC(), POST_DECL));
    expect(body.length).toBeGreaterThan(400);
    expect(body.split('deviceActor(sessionAuth(req).device)').length - 1).toBe(1);
  });

  it('no other device word in code', () => {
    const raw = ROUTES_SRC();
    const post = stripComments(sliceTo(raw, POST_DECL)).replace(/deviceActor\(sessionAuth\(req\)\.device\)/g, '');
    expect(post, 'the collect-lane POST must not branch on device').not.toMatch(/\bdevice\b/);
    expect(stripComments(sliceTo(raw, GET_DECL)), 'the collect-lane GET names no device').not.toMatch(/\bdevice\b/);
  });

  it('no phone word in the block', () => {
    const raw = ROUTES_SRC();
    // CONTROL: the scan sees the word where it stands (the caps docstring).
    expect(raw.slice(raw.indexOf('/** `GET`/`POST /api/coord/caps`'), raw.indexOf("app.get('/api/coord/caps'")))
      .toMatch(DEVICE_WORD);
    const from = raw.indexOf(DOC_ANCHOR);
    expect(from, 'the collect-lane docstring anchor is gone').toBeGreaterThan(-1);
    const block = sliceTo(raw, POST_DECL, from);
    expect(block).toContain(GET_DECL);
    expect(block, 'the collect-lane block names a device').not.toMatch(DEVICE_WORD);
  });

  it('stall-settings-route.test.ts stays green unchanged', () => {
    const raw = ROUTES_SRC();
    const stallPost = "app.post('/api/coord/stall-watch'";
    const at = raw.indexOf(stallPost);
    expect(at, 'the stall-watch POST is gone').toBeGreaterThan(-1);
    const next = /app\.(?:get|post)\('/.exec(raw.slice(at + stallPost.length));
    expect(next, 'nothing is registered after the stall-watch POST').not.toBeNull();
    expect(raw.slice(at + stallPost.length + next!.index).startsWith(GET_DECL),
      'the collector switch is registered right after the stall-watch POST').toBe(true);
    // The stall-watch POST's slice now ends with this door's docstring and helpers. The stall suite's device scan and
    // `coord-pause-route.test.ts` read that slice, so it holds no gate, no code-level device word and no phone word.
    const between = raw.slice(raw.indexOf(DOC_ANCHOR), raw.indexOf(GET_DECL));
    expect(between.length, 'the docstring anchor moved').toBeGreaterThan(400);
    for (const re of GATE_PATTERNS) expect(between).not.toMatch(re);
    expect(between).not.toMatch(DEVICE_WORD);
    expect(stripComments(between)).not.toMatch(/\bdevice\b/);
  });
});
