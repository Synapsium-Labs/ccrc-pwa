// Update-management W2, Task 13 (design 2026-09-20 §12): the routes over the
// control plane — `GET /api/updates` and `POST /api/updates/{intent,refresh,ack}`,
// all session-only, and the one dual-credential read, the projection
// `GET /api/updates/intent/:nodeId`.
//
// Every row a test needs is PLANTED through the store's own writers (Tasks 4–6),
// except the two states no W2 writer can reach — a busy or failed lease (W4's
// dispatcher writes those) and a superseded row planted without its re-key — and
// those are planted by one `UPDATE` each, named where they happen. Nothing here
// reads the live `$HOME`: every box is a `mkTmp` fixture home, and the two sweeps
// tests trigger (the local-mode and remote-mode reads) run against that home.
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type ReleaseListingRow } from '../src/coord/store.js';
import { UpdateIntentLog, defaultUpdateIntentLogPath } from '../src/coord/updateintentlog.js';
import type { CataloguePoller } from '../src/update/catalogue.js';
import { FLEET_LABEL, SERVER_LABEL } from '../src/update/inventory.js';
import { UPDATE_GATE_CAP } from '../src/update/resolve.js';
import { REFRESH_MIN_INTERVAL_MS, parseIntentBody, toNodeWire } from '../src/update/routes.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import type { CatalogueState, NodeWire, UpdatesView } from '../../shared/api.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
/** Cheap-cost scrypt, the `pool-accounts-route.test.ts` ARMED fixture: an armed
 *  gate with no readable secret fails SHUT whatever the box token says, so the
 *  box-token arm is only measurable with a real, readable secret behind it. */
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
/** Two node-ids in `_inst_node_id`'s lowercase shape (`NODE_ID_RE`). */
const FLEET_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const OTHER_ID = '1f1e1d1c-1b1a-4918-9716-151413121110';

const failingRunner: Runner = async () => ({ code: 1, stdout: '', stderr: '' });

const measured = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: FLEET_ID, role: 'fleet', label: FLEET_LABEL,
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main',
  currentBuiltAt: '2026-09-22T00:00:00Z', currentDirty: false,
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  os: 'linux', measuredAt: 1_000, report: null,
  ...over,
});

const plant = (coord: CoordStore, m: NodeMeasurement): void => {
  const r = coord.upsertNodeMeasurement(m);
  expect(r.ok, `planting ${m.nodeId}: ${JSON.stringify(r)}`).toBe(true);
};

/** One stable and one dev release, both with a bundle listed. */
const LISTING: readonly ReleaseListingRow[] = [
  { tag: 'v0.0.10', channel: 'stable', publishedAt: 2_000, commitSha: null,
    tarballUrl: 'https://example.invalid/ccrc-v0.0.10.tar.gz', bundleListed: true, notes: null, draft: false },
  { tag: 'v0.0.11', channel: 'dev', publishedAt: 3_000, commitSha: null,
    tarballUrl: 'https://example.invalid/ccrc-v0.0.11.tar.gz', bundleListed: true, notes: null, draft: false },
];
const catalogue = (coord: CoordStore): void => {
  const r = coord.applyReleaseListing(LISTING, 4_000, 'complete');
  expect(r.ok, JSON.stringify(r)).toBe(true);
};

/** A superseded row, planted by hand: `rekeyNode` is what writes one, and its
 *  semantics are Task 5's pins; these tests need only that such a row EXISTS. */
const supersede = (coord: CoordStore, nodeId: string, by: string): void => {
  coord.db.prepare('UPDATE nodes SET supersededBy = ? WHERE nodeId = ?').run(by, nodeId);
};

/** A lease state no W2 writer reaches (W4's `dispatchNode` is the only one that
 *  acquires a lease), planted with the request that would have come with it. */
const setLease = (coord: CoordStore, nodeId: string, state: 'applying' | 'failed'): void => {
  coord.db.prepare(
    'UPDATE nodes SET updateState = ?, updateTarget = ?, updateStartedAt = ?, updateDetail = ?, ' +
    'requestedTag = ?, requestedKind = ?, requestedAt = ? WHERE nodeId = ?',
  ).run(state, 'v0.0.10', 5, state === 'failed' ? 'provenance: bundle absent' : null,
    'v0.0.10', 'update', 5, nodeId);
};

/** A `CataloguePoller` that records instead of requesting — the poller's own
 *  behaviour is Task 10's; this file measures only what the ROUTE does with it. */
const scriptedPoller = () => {
  let last: number | null = null;
  const at: number[] = [];
  const state: CatalogueState = { lastOkAt: null, lastError: null };
  const poller: CataloguePoller = {
    poll: async (now) => { at.push(now); last = now; state.lastOkAt = now; return { ...state }; },
    state: () => ({ ...state }),
    lastRequestAt: () => last,
  };
  return { poller, polls: () => at.length, polledAt: () => [...at], setLast: (t: number | null) => { last = t; } };
};

interface Opened { app: FastifyInstance; coord: CoordStore; home: string; ccrcDir: string }
const opened: { app: FastifyInstance; coord: CoordStore | null }[] = [];

afterEach(async () => {
  for (const o of opened.splice(0)) {
    await o.app.close();
    // `store.db.close()` — `pool-accounts-route.test.ts`'s convention.
    o.coord?.db.close();
  }
});

const writeSecret = async (home: string): Promise<void> => {
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'),
    `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
};

const open = async (
  o: { auth?: boolean; watcher?: boolean; catalogue?: CataloguePoller; remote?: boolean } = {},
): Promise<Opened> => {
  const home = mkTmp('ccrc-update-routes-');
  seedRoster(home);
  const loaded = loadConfig({ CCRC_HOME: home });
  // `remote`: the server box of a two-box fleet, its agent link DOWN. Set on the
  // loaded config rather than through `CCRC_FLEET`, so no agent URL or token is
  // needed. The role is what `deriveRole` gives remote mode (Task 9).
  const cfg = {
    ...loaded, authEnabled: o.auth ?? false,
    ...(o.remote ? { fleetMode: 'remote' as const, role: 'server' as const } : {}),
  };
  if (o.auth) await writeSecret(home);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps: Deps = {
    cfg, runCcd: ccdRunner(failingRunner, cfg), tmux: new Tmux(failingRunner), io: localIO,
    queue: new KeyedQueue(), mailToken: TOKEN, coord,
    updateIntentLog: new UpdateIntentLog(defaultUpdateIntentLogPath(cfg.ccrcDir)),
    ...(o.catalogue ? { catalogue: o.catalogue } : {}),
    // Task 11's `fleetState` fixture shape, disconnected: the sweep writes the
    // agent connection's row as unreachable on the sweep that sees it.
    ...(o.remote
      ? { fleetState: { connected: false, downSince: 1_000, ccdVerbs: null, rosterFp: null, build: null } }
      : {}),
  };
  const bus = new Bus();
  // A REAL watcher, never started: the route calls its `inventoryNow()` and
  // nothing else. The cache path is the fixture's, never the default.
  const watcher = o.watcher
    ? new FleetWatcher(deps, bus, 10_000, path.join(cfg.ccrcDir, 'state-cache.json'))
    : undefined;
  const app = await buildServer(deps, bus, watcher);
  await app.ready();
  opened.push({ app, coord });
  return { app, coord, home, ccrcDir: cfg.ccrcDir };
};

/** A box with no coordination database at all. */
const openBare = async (auth: boolean): Promise<FastifyInstance> => {
  const home = mkTmp('ccrc-update-routes-bare-');
  seedRoster(home);
  const cfg = { ...loadConfig({ CCRC_HOME: home }), authEnabled: auth };
  if (auth) await writeSecret(home);
  const app = await buildServer({
    cfg, runCcd: ccdRunner(failingRunner, cfg), tmux: new Tmux(failingRunner),
    io: localIO, queue: new KeyedQueue(), mailToken: TOKEN,
  } as Deps);
  await app.ready();
  opened.push({ app, coord: null });
  return app;
};

const post = (app: FastifyInstance, url: string, body: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: body as never, headers });

/** A live session cookie, minted through the real login route — `auth-gate.test.ts`'s `login`. */
const login = async (app: FastifyInstance): Promise<string> => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(204);
  const set = res.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  return line.slice(0, line.indexOf(';'));
};

describe('GET /api/updates', () => {
  it('501 not-configured on a box with no coordination database', async () => {
    const app = await openBare(false);
    const r = await app.inject({ method: 'GET', url: '/api/updates' });
    expect(r.statusCode).toBe(501);
    expect(r.json()).toEqual({ ok: false, error: 'not-configured' });
  });

  it('local mode, before the first sweep: one node, the box itself — never an empty list (spec §12 Pins)', async () => {
    const f = await open({ watcher: true });
    expect(f.coord.nodes(), 'the fixture must start with no inventory at all').toEqual([]);
    const r = await f.app.inject({ method: 'GET', url: '/api/updates' });
    expect(r.statusCode, r.body).toBe(200);
    const view = r.json() as UpdatesView;
    expect(view.nodes).toHaveLength(1);
    // D-3184: the server's own row, role from config (`both` in local
    // mode, D-3174), no agent by construction.
    expect(view.nodes[0]).toMatchObject({
      label: SERVER_LABEL, role: 'both', stampRead: 'absent', current: null, agentOps: null,
    });
  });

  it('remote mode, before the first sweep: two nodes — this box as `server`, the agent connection as `fleet` (D-3184)', async () => {
    const f = await open({ watcher: true, remote: true });
    expect(f.coord.nodes(), 'the fixture must start with no inventory at all').toEqual([]);
    const r = await f.app.inject({ method: 'GET', url: '/api/updates' });
    expect(r.statusCode, r.body).toBe(200);
    const view = r.json() as UpdatesView;
    // `nodes()` orders by label, so `fleet` comes before `server`. The link is
    // down in this fixture, so the fleet row is the label-keyed placeholder the
    // sweep writes. It is shown, never dropped (§18 "unreachable is written on
    // the sweep it happens").
    expect(view.nodes.map((n) => [n.label, n.role])).toEqual([[FLEET_LABEL, 'fleet'], [SERVER_LABEL, 'server']]);
    expect(view.nodes[0]).toMatchObject({ nodeId: FLEET_LABEL, reachable: false, measuredAt: null });
    expect(view.nodes[1]).toMatchObject({ nodeId: SERVER_LABEL, agentOps: null });
  });

  it('answers the stored surface: releases with their refusal roll-up, live nodes only, the seed intent, a never-checked catalogue', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, measured());
    expect(f.coord.refuseRelease(FLEET_ID, 'v0.0.10', 7, 'provenance: signature mismatch'))
      .toEqual({ ok: true, inserted: true });
    // The label-keyed placeholder the same box left before its node-id was
    // measured, superseded by the UUID row (§18 "a superseded row is invisible").
    plant(f.coord, measured({ nodeId: FLEET_LABEL }));
    supersede(f.coord, FLEET_LABEL, FLEET_ID);

    const r = await f.app.inject({ method: 'GET', url: '/api/updates' });
    expect(r.statusCode, r.body).toBe(200);
    const view = r.json() as UpdatesView;
    expect(view.catalogue, 'no poller has answered: "never checked", never "up to date"')
      .toEqual({ lastOkAt: null, lastError: null });
    expect(view.releases).toEqual([
      { tag: 'v0.0.11', version: 'v0.0.11', channel: 'dev', publishedAt: 3_000, commitSha: null,
        bundleListed: true, yanked: false, refused: [], notes: null },
      { tag: 'v0.0.10', version: 'v0.0.10', channel: 'stable', publishedAt: 2_000, commitSha: null,
        bundleListed: true, yanked: false, refused: [{ by: FLEET_ID, at: 7 }], notes: null },
    ]);
    const want: NodeWire = {
      nodeId: FLEET_ID, role: 'fleet', label: FLEET_LABEL, os: 'linux',
      // §18 "a full BuildInfo round-trips": all five current* columns, dirty included.
      current: { sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-22T00:00:00Z', dirty: false, version: 'v0.0.9' },
      stampRead: 'ok', installState: 'complete', provenance: 'verified',
      caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
      measuredAt: 1_000, reachable: true, unreachableSince: null,
      channel: null, desiredTag: null, resolveDetail: null,
      request: null, report: null,
      update: { state: 'idle', target: null, startedAt: null, detail: null },
    };
    expect(view.nodes, 'the superseded placeholder leaked onto the wire').toEqual([want]);
    expect(view.intent).toEqual([
      { scope: '*', channel: 'stable', pinnedTag: null, auto: 'off', notify: 'channel', setAt: 0, setBy: 'migration' },
    ]);
  });

  it('toNodeWire: a request only when tag, kind and time are all set; a report iff a phase; no BuildInfo off a stamp that did not read ok', async () => {
    const f = await open();
    plant(f.coord, measured());
    const row = f.coord.node(FLEET_ID)!;
    expect(toNodeWire({ ...row, requestedTag: 'v0.0.10', requestedKind: 'update', requestedAt: 9 }).request)
      .toEqual({ tag: 'v0.0.10', kind: 'update', at: 9 });
    expect(toNodeWire({ ...row, requestedTag: 'v0.0.10', requestedKind: null, requestedAt: 9 }).request).toBeNull();
    expect(toNodeWire({ ...row, requestedTag: 'v0.0.10', requestedKind: 'update', requestedAt: null }).request).toBeNull();
    expect(toNodeWire({
      ...row, reportedPhase: 'installing', reportedTarget: 'v0.0.10', reportedStartedAt: 1_000,
      reportedUpdatedAt: 2_000, reportedDetail: null,
    }).report).toEqual({ phase: 'installing', target: 'v0.0.10', startedAt: 1_000, updatedAt: 2_000, detail: null });
    expect(toNodeWire({ ...row, reportedPhase: null, reportedTarget: 'v0.0.10' }).report).toBeNull();
    // §18 "stampRead keeps EACCES from unversioned": the columns may still hold
    // an old stamp, and the wire must not present it as this node's build.
    expect(toNodeWire({ ...row, stampRead: 'unreadable' }).current).toBeNull();
  });
});

describe('POST /api/updates/intent', () => {
  it('writes the intent, bumps the epoch, journals it, and re-resolves AND re-projects in the same request', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, measured());
    plant(f.coord, measured({ nodeId: SERVER_LABEL, label: SERVER_LABEL, role: 'both' }));

    const r = await post(f.app, '/api/updates/intent', { scope: '*', channel: 'dev' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      ok: true, epoch: 1,
      intent: { scope: '*', channel: 'dev', pinnedTag: null, auto: 'off', notify: 'channel', setBy: 'pwa' },
    });
    expect(f.coord.updateEpoch().epoch).toBe(1);
    const journal = readFileSync(defaultUpdateIntentLogPath(f.ccrcDir), 'utf8').trim().split('\n');
    expect(journal).toHaveLength(1);
    expect(JSON.parse(journal[0]!)).toMatchObject({ epoch: 1, scope: '*', channel: 'dev' });
    // The resolver ran IN THIS REQUEST — nothing else in this fixture resolves.
    expect(f.coord.node(FLEET_ID)).toMatchObject({ channel: 'dev', desiredTag: 'v0.0.11' });
    // …and so did the server-role projection writer (spec §9: "at every
    // resolution"), in seconds, carrying both desireds.
    const doc = path.join(f.ccrcDir, 'update-intent');
    expect(existsSync(doc), 'the server-role projection was not written').toBe(true);
    expect(statSync(doc).mode & 0o777, 'the projection is 0600 (tmp-then-rename)').toBe(0o600);
    expect(readFileSync(doc, 'utf8')).toMatch(
      /^epoch 1\nissued \d{10}\nlease \d{10}\nchannel dev\ndesired v0\.0\.11\ndesired-stable v0\.0\.10\ndesired-dev v0\.0\.11\nauto off\nend\n$/);
  });

  it('400 bad-tag for a pinnedTag off the tag shape, and nothing is written', async () => {
    const f = await open();
    for (const pinnedTag of ['0.0.9', 'v0.0.9 ', 'V0.0.9', 'v0.0', 'v0.0.9\n']) {
      const r = await post(f.app, '/api/updates/intent', { scope: '*', pinnedTag });
      expect(r.statusCode, JSON.stringify(pinnedTag)).toBe(400);
      expect(r.json()).toEqual({ ok: false, error: 'bad-tag', field: 'pinnedTag' });
    }
    expect(f.coord.updateEpoch().epoch).toBe(0);
    expect(f.coord.intentFor('*')!.pinnedTag).toBeNull();
  });

  it('400 bad-request naming the field for an unknown key or an out-of-vocabulary value', async () => {
    const f = await open();
    const cases: [unknown, string][] = [
      [{ scope: '*', colour: 'red' }, 'colour'],
      [{ scope: '*', channel: 'nightly' }, 'channel'],
      [{ scope: '*', auto: 'always' }, 'auto'],
      [{ scope: '*', notify: 'loud' }, 'notify'],
      [{ scope: '*', pinnedTag: 9 }, 'pinnedTag'],
      [{ scope: 7, channel: 'dev' }, 'scope'],
      [{ channel: 'dev' }, 'scope'],
      [['*'], 'body'],
    ];
    for (const [body, field] of cases) {
      expect(parseIntentBody(body), JSON.stringify(body)).toEqual({ ok: false, error: 'bad-request', field });
      const r = await post(f.app, '/api/updates/intent', body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
      expect(r.json()).toEqual({ ok: false, error: 'bad-request', field });
    }
    expect(parseIntentBody({ scope: '*', pinnedTag: null, auto: 'off' }))
      .toEqual({ ok: true, scope: '*', patch: { pinnedTag: null, auto: 'off' } });
    expect(f.coord.updateEpoch().epoch).toBe(0);
  });

  it('400 bad-request for a body that names nothing to change — the store refuses it and the route says so', async () => {
    const f = await open();
    const r = await post(f.app, '/api/updates/intent', { scope: '*' });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ ok: false, error: 'bad-request', field: 'body', detail: 'empty-patch' });
    expect(f.coord.updateEpoch().epoch).toBe(0);
  });

  it('404 unknown-scope for a scope that is neither * nor a live node', async () => {
    const f = await open();
    const r = await post(f.app, '/api/updates/intent', { scope: 'no-such-node', channel: 'dev' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ ok: false, error: 'unknown-scope', detail: 'no-such-node' });
    expect(f.coord.intentFor('no-such-node')).toBeNull();
  });

  it('404 unknown-scope for a LIVE label-keyed row — a node scope must be a measured node-id (D-3194)', async () => {
    const f = await open();
    plant(f.coord, measured({ nodeId: FLEET_LABEL }));                // a pre-W1 node: live, keyed by its label
    const r = await post(f.app, '/api/updates/intent', { scope: FLEET_LABEL, channel: 'dev' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ ok: false, error: 'unknown-scope', detail: FLEET_LABEL });
    expect(f.coord.intentFor(FLEET_LABEL)).toBeNull();
    expect(f.coord.updateEpoch().epoch).toBe(0);
  });

  it('409 auto-needs-rollback-gate while any node in scope lacks update-gate — every W2 node', async () => {
    const f = await open();
    plant(f.coord, measured());
    plant(f.coord, measured({ nodeId: OTHER_ID, label: 'other' }));
    const all = await post(f.app, '/api/updates/intent', { scope: '*', auto: 'stable' });
    expect(all.statusCode, all.body).toBe(409);
    expect(all.json()).toMatchObject({ ok: false, error: 'auto-needs-rollback-gate' });
    expect([...(all.json().nodes as string[])].sort()).toEqual([FLEET_ID, OTHER_ID].sort());
    // A node scope names only its own node.
    const one = await post(f.app, '/api/updates/intent', { scope: OTHER_ID, auto: 'channel' });
    expect(one.statusCode).toBe(409);
    expect(one.json().nodes).toEqual([OTHER_ID]);
    expect(f.coord.updateEpoch().epoch, 'a refused intent moved the epoch').toBe(0);
    expect(f.coord.intentFor('*')!.auto).toBe('off');
    expect(f.coord.intentFor(OTHER_ID)).toBeNull();
    // `auto: 'off'` is never gated — notify-only needs no rollback.
    const off = await post(f.app, '/api/updates/intent', { scope: '*', auto: 'off' });
    expect(off.statusCode, off.body).toBe(200);
  });

  it('auto is written once every node in scope lists update-gate — the route asks the predicate, it does not always refuse', async () => {
    const f = await open();
    const gated = ['verify', 'node-id', 'floor', UPDATE_GATE_CAP];
    plant(f.coord, measured({ caps: gated }));
    plant(f.coord, measured({ nodeId: OTHER_ID, label: 'other', caps: gated }));
    const r = await post(f.app, '/api/updates/intent', { scope: '*', auto: 'stable' });
    expect(r.statusCode, r.body).toBe(200);
    expect(f.coord.intentFor('*')!.auto).toBe('stable');
  });

  it('an unreachable node blocks auto too — a never-measured placeholder has no caps (§9 "reachable or not, including one with measuredAt NULL")', async () => {
    const f = await open();
    plant(f.coord, measured({ nodeId: OTHER_ID, label: 'other', caps: ['verify', 'node-id', 'floor', UPDATE_GATE_CAP] }));
    // The fleet link was down on the sweep that would have measured it:
    // `markUnreachable` leaves the label-keyed placeholder (measuredAt NULL,
    // caps '', reachable false). §9 is written about exactly this node: one
    // that was offline when `auto` was set.
    expect(f.coord.markUnreachable(FLEET_LABEL, 'fleet', 9)).toMatchObject({ ok: true, nodeId: FLEET_LABEL, created: true });
    expect(f.coord.node(FLEET_LABEL)).toMatchObject({ reachable: false, measuredAt: null, caps: [] });
    const r = await post(f.app, '/api/updates/intent', { scope: '*', auto: 'stable' });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toEqual({ ok: false, error: 'auto-needs-rollback-gate', nodes: [FLEET_LABEL] });
    expect(f.coord.updateEpoch().epoch, 'a refused intent moved the epoch').toBe(0);
    expect(f.coord.intentFor('*')!.auto).toBe('off');
  });

  it('503 journal-unreadable, and the intent row and the epoch are untouched', async () => {
    const f = await open();
    // A DIRECTORY where the journal file belongs: `maxEpoch()` cannot read it,
    // and "cannot read the journal" must never be taken as "the journal is empty".
    mkdirSync(defaultUpdateIntentLogPath(f.ccrcDir));
    const r = await post(f.app, '/api/updates/intent', { scope: '*', channel: 'dev' });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ ok: false, error: 'journal-unreadable' });
    expect(typeof r.json().detail).toBe('string');
    expect(f.coord.updateEpoch().epoch).toBe(0);
    expect(f.coord.intentFor('*')!.channel).toBe('stable');
  });

  it('409 no-channel when the stored channel under the patch cannot be read — never the fleet default (Task 6\'s arm)', async () => {
    const f = await open();
    // A newer build's channel token in the fleet row: a patch that names no
    // channel has nothing honest to merge onto, and the store refuses rather
    // than writing `stable` in its place. `detail` is the scope whose row
    // holds the unreadable channel (`SetIntentResult`'s `base`).
    f.coord.db.prepare("UPDATE update_intent SET channel = 'nightly' WHERE scope = '*'").run();
    const r = await post(f.app, '/api/updates/intent', { scope: '*', auto: 'off' });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toEqual({ ok: false, error: 'no-channel', detail: '*' });
    expect(f.coord.updateEpoch().epoch, 'a refused intent moved the epoch').toBe(0);
  });
});

describe('POST /api/updates/refresh', () => {
  it('polls once and answers the catalogue state; a second call inside the minute is 429 and sends nothing (§18 "refresh is rate-limited")', async () => {
    const p = scriptedPoller();
    const f = await open({ catalogue: p.poller });
    const a = await post(f.app, '/api/updates/refresh', {});
    expect(a.statusCode, a.body).toBe(200);
    expect(a.json()).toEqual({ lastOkAt: p.polledAt()[0], lastError: null });
    const b = await post(f.app, '/api/updates/refresh', {});
    expect(b.statusCode).toBe(429);
    expect(b.json()).toMatchObject({ ok: false, error: 'rate-limited' });
    const retry = b.json().retryAfterS as number;
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(REFRESH_MIN_INTERVAL_MS / 1000);
    expect(b.headers['retry-after']).toBe(String(retry));
    expect(p.polls(), 'the refused refresh reached the poller').toBe(1);
    // A minute on, the door opens again — a minute, not a latch.
    p.setLast(Date.now() - REFRESH_MIN_INTERVAL_MS - 1);
    const c = await post(f.app, '/api/updates/refresh', {});
    expect(c.statusCode).toBe(200);
    expect(p.polls()).toBe(2);
  });

  it('501 not-configured with no poller', async () => {
    const f = await open();
    const r = await post(f.app, '/api/updates/refresh', {});
    expect(r.statusCode).toBe(501);
  });
});

describe('POST /api/updates/ack', () => {
  it('failed → idle, request cleared, THIS node\'s refusals cleared — and the release resolves again in the same request (§18 "ack clears the node\'s refusals and its request")', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, measured());
    plant(f.coord, measured({ nodeId: OTHER_ID, label: 'other' }));
    setLease(f.coord, FLEET_ID, 'failed');
    expect(f.coord.refuseRelease(FLEET_ID, 'v0.0.10', 6, 'provenance: bundle absent').ok).toBe(true);
    expect(f.coord.refuseRelease(OTHER_ID, 'v0.0.10', 6, 'provenance: bundle absent').ok).toBe(true);

    const r = await post(f.app, '/api/updates/ack', { nodeId: FLEET_ID });
    expect(r.statusCode, r.body).toBe(200);
    const node = r.json().node as NodeWire;
    expect(node.update.state).toBe('idle');
    expect(node.request).toBeNull();
    expect(f.coord.refusalsFor(FLEET_ID)).toEqual([]);
    expect(f.coord.refusalsFor(OTHER_ID), 'ack cleared ANOTHER node\'s refusal').toHaveLength(1);
    // The refusal made v0.0.10 ineligible for this node; with it cleared, the
    // resolution that ran inside the ack request finds it again.
    expect(f.coord.node(FLEET_ID)!.desiredTag).toBe('v0.0.10');
    expect(node.desiredTag).toBe('v0.0.10');
  });

  it('refuses a busy row, a superseded row, an unknown node and a malformed body — writing nothing', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, measured());
    setLease(f.coord, FLEET_ID, 'applying');
    expect(f.coord.refuseRelease(FLEET_ID, 'v0.0.10', 6, 'provenance: bundle absent').ok).toBe(true);
    plant(f.coord, measured({ nodeId: FLEET_LABEL }));
    supersede(f.coord, FLEET_LABEL, FLEET_ID);

    const busy = await post(f.app, '/api/updates/ack', { nodeId: FLEET_ID });
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toEqual({ ok: false, error: 'busy', detail: 'applying' });
    expect(f.coord.node(FLEET_ID)!.updateState, 'an ack killed a live lease').toBe('applying');
    expect(f.coord.refusalsFor(FLEET_ID)).toHaveLength(1);

    const sup = await post(f.app, '/api/updates/ack', { nodeId: FLEET_LABEL });
    expect(sup.statusCode).toBe(409);
    expect(sup.json()).toEqual({ ok: false, error: 'superseded', detail: FLEET_ID });

    const unknown = await post(f.app, '/api/updates/ack', { nodeId: 'no-such-node' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ ok: false, error: 'unknown-node' });

    for (const [body, field] of [[{}, 'nodeId'], [{ nodeId: 7 }, 'nodeId'], [{ nodeId: FLEET_ID, force: true }, 'force'], [[FLEET_ID], 'body']] as const) {
      const r = await post(f.app, '/api/updates/ack', body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
      expect(r.json()).toEqual({ ok: false, error: 'bad-request', field });
    }
  });
});

describe('GET /api/updates/intent/:nodeId — the projection', () => {
  it('answers the §9 document, resolved live, in SECONDS, with both desireds (§18 "the projection is seconds", "…carries both desireds")', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, measured());
    const r = await f.app.inject({ method: 'GET', url: `/api/updates/intent/${FLEET_ID}` });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['content-type']).toBe('text/plain; charset=utf-8');
    const m = /^epoch 0\nissued (\d{10})\nlease (\d{10})\nchannel stable\ndesired v0\.0\.10\ndesired-stable v0\.0\.10\ndesired-dev v0\.0\.11\nauto off\nend\n$/
      .exec(r.body);
    expect(m, r.body).not.toBeNull();
    expect(Number(m![2]) - Number(m![1]), 'the lease is issued + 15 minutes, in seconds').toBe(15 * 60);
    // Resolved on the read, not copied from the stored columns: nothing has run
    // `resolveNode` in this fixture, so the stored desiredTag is still NULL.
    expect(f.coord.node(FLEET_ID)!.desiredTag).toBeNull();
  });

  it('404 unknown-node, 409 superseded, 409 no-channel for a channel token outside the vocabulary', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, measured());
    plant(f.coord, measured({ nodeId: FLEET_LABEL }));
    supersede(f.coord, FLEET_LABEL, FLEET_ID);

    const unknown = await f.app.inject({ method: 'GET', url: '/api/updates/intent/no-such-node' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ ok: false, error: 'unknown-node' });

    const sup = await f.app.inject({ method: 'GET', url: `/api/updates/intent/${FLEET_LABEL}` });
    expect(sup.statusCode).toBe(409);
    expect(sup.json()).toEqual({ ok: false, error: 'superseded', detail: FLEET_ID });

    // A newer build's channel token in the fleet row (a rollback past a
    // migration): §18 "an unknown channel token resolves nothing" — never a
    // fallback, and the projection says so rather than rendering a guess.
    f.coord.db.prepare("UPDATE update_intent SET channel = 'nightly' WHERE scope = '*'").run();
    const none = await f.app.inject({ method: 'GET', url: `/api/updates/intent/${FLEET_ID}` });
    expect(none.statusCode).toBe(409);
    expect(none.json()).toMatchObject({ ok: false, error: 'no-channel' });
    expect(typeof none.json().detail).toBe('string');
  });
});

describe('credentials, armed (spec §12 Pins, decision 15)', () => {
  it('the projection read: 401 with neither credential — before revealing whether the node exists', async () => {
    const f = await open({ auth: true });
    catalogue(f.coord);
    plant(f.coord, measured());
    for (const id of [FLEET_ID, 'no-such-node']) {
      const r = await f.app.inject({ method: 'GET', url: `/api/updates/intent/${id}` });
      expect(r.statusCode, id).toBe(401);
      expect(r.json()).toEqual({ ok: false, error: 'unauthenticated', verdict: 'no-session' });
    }
  });

  it('the projection read: the box token alone suffices, and so does a session (§18 "the projection read takes the box token")', async () => {
    const f = await open({ auth: true });
    catalogue(f.coord);
    plant(f.coord, measured());
    const url = `/api/updates/intent/${FLEET_ID}`;
    const token = await f.app.inject({ method: 'GET', url, headers: { 'x-ccrc-mail-token': TOKEN } });
    expect(token.statusCode, token.body).toBe(200);
    expect(token.body).toMatch(/\nend\n$/);
    const cookie = await f.app.inject({ method: 'GET', url, headers: { cookie: await login(f.app) } });
    expect(cookie.statusCode, cookie.body).toBe(200);
  });

  it('the projection read on a box with no coordination database: 401 before 501 — the pools/epoch order', async () => {
    const app = await openBare(true);
    const neither = await app.inject({ method: 'GET', url: `/api/updates/intent/${FLEET_ID}` });
    expect(neither.statusCode).toBe(401);
    const token = await app.inject({
      method: 'GET', url: `/api/updates/intent/${FLEET_ID}`, headers: { 'x-ccrc-mail-token': TOKEN },
    });
    expect(token.statusCode).toBe(501);
    expect(token.json()).toEqual({ ok: false, error: 'not-configured' });
  });

  it('POST /api/updates/intent with the box token alone is the gate\'s 401 — the box token never writes intent', async () => {
    const f = await open({ auth: true });
    const tokenOnly = await post(f.app, '/api/updates/intent', { scope: '*', channel: 'dev' },
      { 'x-ccrc-mail-token': TOKEN });
    expect(tokenOnly.statusCode).toBe(401);
    expect(tokenOnly.json()).toMatchObject({ verdict: 'no-session' });
    expect(f.coord.updateEpoch().epoch).toBe(0);
    // …and the route is reachable armed, with the credential it does take.
    const session = await post(f.app, '/api/updates/intent', { scope: '*', channel: 'dev' },
      { cookie: await login(f.app) });
    expect(session.statusCode, session.body).toBe(200);
    expect(f.coord.updateEpoch().epoch).toBe(1);
  });
});

describe('index.ts hands the one journal to BOTH deps arms (a text pin over the composition root)', () => {
  // `Deps.updateIntentLog` is optional, so a remote arm without it is no type
  // error, and no suite boots `index.ts` in remote mode — production's
  // `POST /api/updates/intent` would answer 501 with nothing red. Same idiom,
  // same literal split, as Task 11's `index.ts composes the update lanes`.
  it('constructs one UpdateIntentLog and names it in the remote and the local deps literal', () => {
    const indexTs = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(indexTs.match(/new UpdateIntentLog\(/g) ?? []).toHaveLength(1);
    const depsLiterals = indexTs.match(/^  deps = \{\n[\s\S]*?^  \};$/gm) ?? [];
    expect(depsLiterals).toHaveLength(2);
    expect(depsLiterals[0]).toContain('io: fleet.io');
    expect(depsLiterals[1]).toContain('io: localIO');
    for (const lit of depsLiterals) expect(lit).toMatch(/^\s+updateIntentLog,$/m);
  });
});
