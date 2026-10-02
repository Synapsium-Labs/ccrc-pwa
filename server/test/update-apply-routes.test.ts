// Update-management programme wave 5, Task 6 (design 2026-09-20 §12): the two
// MOVE routes — `POST /api/updates/apply` and `POST /api/updates/rollback`.
//
// What is measured here is the ROUTE: its body grammar; its single-node 409s,
// which must be the dispatcher's own `moveRefusal` answered synchronously — so
// one table below runs `planDispatch` over the same rows and compares words;
// the `{all: true}` fan-out and what it skips; the same-turn dispatch trigger;
// and the credential (a session; the box token is never a way in).
//
// Every row is planted through the store's own writers: `upsertNodeMeasurement`
// for the measured columns, `resolveNode` for a resolved desired, `rekeyNode`
// for a superseded row, `refuseRelease` for a refusal, and `dispatchNode` /
// `releaseLease` for a lease — no hand-written UPDATE. Every box is a `mkTmp`
// fixture home; the one spawn a case reaches is an injected `Runner`, behind
// the local-spawn capability (`spawnFromRunner`, the double for `localUpdateSpawnFor`) as `index.ts` builds `Deps.updateRunner`, that
// records its argv and answers only when the test says so.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type ExecResult, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type ReleaseListingRow } from '../src/coord/store.js';
import { UpdateIntentLog, defaultUpdateIntentLogPath } from '../src/coord/updateintentlog.js';
import { FLEET_LABEL, SERVER_LABEL } from '../src/update/inventory.js';
import { UPDATE_GATE_CAP } from '../src/update/resolve.js';
import { resolveInputFor } from '../src/update/project.js';
import { DETACH_CAP, ROLLBACK_CAP, planDispatch } from '../src/update/dispatch.js';
import { dispatchViewsFor } from '../src/update/converge.js';
import { spawnFromRunner } from './updateSpawnFake.js';
import { parseApplyBody, parseRollbackBody } from '../src/update/routes.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { updateLauncherPath, updateSpawnArgv } from '../../shared/agent-protocol.js';
import type { MoveRequestAnswer, RequestKind } from '../../shared/api.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
/** Cheap-cost scrypt — `update-routes.test.ts`'s ARMED fixture. */
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
/** A same-site page on another host — `auth-passkey.test.ts`'s CSRF sibling. */
const SIBLING = 'https://other-box.example.com';
/** Node-ids in `_inst_node_id`'s lowercase shape (`NODE_ID_RE`). */
const FLEET_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const OTHER_ID = '1f1e1d1c-1b1a-4918-9716-151413121110';
const SERVER_ID = '2f2e2d2c-2b2a-4928-a726-252423222120';
const THIRD_ID = '3f3e3d3c-3b3a-4938-b736-353433323130';

/** The three W1 words plus wave 4's four: a node that can take every move. */
const MOVE_CAPS: readonly string[] = ['verify', 'node-id', 'floor', 'update-json', UPDATE_GATE_CAP, ROLLBACK_CAP, DETACH_CAP];
const without = (word: string): string[] => MOVE_CAPS.filter((w) => w !== word);

const failingRunner: Runner = async () => ({ code: 1, stdout: '', stderr: '' });

/** A W4-era fleet node: its agent advertises the op, it runs v0.0.9, and its previous install was v0.0.8. */
const fleetNode = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: FLEET_ID, role: 'fleet', label: FLEET_LABEL,
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main',
  currentBuiltAt: '2026-09-22T00:00:00Z', currentDirty: false,
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: MOVE_CAPS, agentOps: ['update'], highestVersion: 'v0.0.9', previousVersion: 'v0.0.8',
  floorRead: 'measured', previousRead: 'measured',
  os: 'linux', measuredAt: 1_000, report: null,
  ...over,
});
/** The server's own row: `agentOps` NULL — no agent by construction (decision 11). */
const serverNode = (over: Partial<NodeMeasurement> = {}): NodeMeasurement =>
  fleetNode({ nodeId: SERVER_ID, role: 'server', label: SERVER_LABEL, agentOps: null, ...over });
/** A stamp that could not be read: the `current*` columns say nothing about what runs. */
const UNREAD: Partial<NodeMeasurement> = {
  stampRead: 'unreadable', currentVersion: null, currentSha: null, currentRef: null,
  currentBuiltAt: null, currentDirty: null,
};

const plant = (coord: CoordStore, m: NodeMeasurement): void => {
  const r = coord.upsertNodeMeasurement(m);
  expect(r.ok, `planting ${m.nodeId}: ${JSON.stringify(r)}`).toBe(true);
};

const rel = (tag: string, channel: 'stable' | 'dev', publishedAt: number, draft = false): ReleaseListingRow => ({
  tag, channel, publishedAt, commitSha: null, tarballUrl: `https://example.invalid/ccrc-${tag}.tar.gz`,
  bundleListed: true, notes: null, draft,
});
/** v0.0.7 and v0.0.12 arrive as drafts, which the catalogue stores YANKED (W2 Task 4's `yanked = draft`). */
const LISTING: readonly ReleaseListingRow[] = [
  rel('v0.0.7', 'stable', 1_000, true), rel('v0.0.8', 'stable', 1_100), rel('v0.0.9', 'stable', 1_200),
  rel('v0.0.10', 'stable', 1_300), rel('v0.0.11', 'dev', 1_400), rel('v0.0.12', 'stable', 1_500, true),
];
const catalogue = (coord: CoordStore): void => {
  const r = coord.applyReleaseListing(LISTING, 4_000, 'complete');
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(coord.releases().filter((x) => x.yanked).map((x) => x.tag).sort(), 'the two drafts must read yanked')
    .toEqual(['v0.0.12', 'v0.0.7']);
};

/** A resolved desired, written by the resolver's own writer (no resolution runs in these fixtures). */
const desire = (coord: CoordStore, nodeId: string, desiredTag: string | null, resolveDetail: string | null = null): void => {
  expect(coord.resolveNode(nodeId, { channel: 'stable', desiredTag, resolveDetail }).ok).toBe(true);
};
/** A busy lease, taken by the ONE acquire (Task 3). */
const hold = (coord: CoordStore, nodeId: string): void => {
  expect(coord.dispatchNode(nodeId, 'v0.0.10', 'update', 5, 'fixture lease')).toEqual({ ok: true });
};
/** A settled `failed` verdict: acquired, then released by W2's writer with the detail the halt reads. */
const verdict = (coord: CoordStore, nodeId: string, detail: string): void => {
  hold(coord, nodeId);
  expect(coord.releaseLease(nodeId, 'failed', detail, null)).toEqual({ ok: true, state: 'failed' });
};

/** A `Runner` that records its call and answers only when the test says so — the server-role
 *  local spawn parked mid-flight, so the lease can be read while it is still held. */
const heldRunner = () => {
  let answer!: (r: ExecResult) => void;
  const answered = new Promise<ExecResult>((resolve) => { answer = resolve; });
  const calls: [string, string[]][] = [];
  const runner: Runner = (cmd, args) => { calls.push([cmd, [...args]]); return answered; };
  return { runner, calls, release: (r: ExecResult): void => answer(r) };
};

interface Opened { app: FastifyInstance; coord: CoordStore; home: string }
const opened: { app: FastifyInstance; coord: CoordStore | null }[] = [];

afterEach(async () => {
  for (const o of opened.splice(0)) {
    await o.app.close();
    o.coord?.db.close();
  }
});

/** `watcher` off by default: a route case measures the request row, and with no watcher
 *  `watcher?.triggerDispatch()` is a no-op, so nothing moves the lease under it. */
const open = async (o: { auth?: boolean; watcher?: boolean; runner?: Runner } = {}): Promise<Opened> => {
  const home = mkTmp('ccrc-update-apply-');
  seedRoster(home);
  const cfg = { ...loadConfig({ CCRC_HOME: home }), authEnabled: o.auth ?? false };
  if (o.auth) {
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'),
      `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  }
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps: Deps = {
    cfg, runCcd: ccdRunner(failingRunner, cfg), tmux: new Tmux(failingRunner), io: localIO,
    queue: new KeyedQueue(), mailToken: TOKEN, coord,
    updateIntentLog: new UpdateIntentLog(defaultUpdateIntentLogPath(cfg.ccrcDir)),
    // `Deps.updateRunner` is the two-template capability, never a raw Runner (Task 5,
    // D-3397): the recording Runner goes behind the same factory.
    ...(o.runner ? { updateRunner: spawnFromRunner(o.runner, cfg.home) } : {}),
  };
  const bus = new Bus();
  // A REAL watcher, never started: the routes call its `triggerDispatch()` and nothing else.
  const watcher = o.watcher
    ? new FleetWatcher(deps, bus, 10_000, path.join(cfg.ccrcDir, 'state-cache.json'))
    : undefined;
  const app = await buildServer(deps, bus, watcher);
  await app.ready();
  opened.push({ app, coord });
  return { app, coord, home };
};

/** A box with no coordination database at all. */
const openBare = async (): Promise<FastifyInstance> => {
  const home = mkTmp('ccrc-update-apply-bare-');
  seedRoster(home);
  const cfg = { ...loadConfig({ CCRC_HOME: home }), authEnabled: false };
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

const login = async (app: FastifyInstance): Promise<string> => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  expect(res.statusCode, res.body).toBe(204);
  const set = res.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  return line.slice(0, line.indexOf(';'));
};

describe('the move bodies — one grammar per field', () => {
  it('apply: exactly one of nodeId / all, and an optional tag through the one guard', () => {
    expect(parseApplyBody({ nodeId: FLEET_ID })).toEqual({ ok: true, target: { nodeId: FLEET_ID }, tag: null });
    expect(parseApplyBody({ nodeId: FLEET_ID, tag: 'v0.0.10' }))
      .toEqual({ ok: true, target: { nodeId: FLEET_ID }, tag: 'v0.0.10' });
    expect(parseApplyBody({ all: true })).toEqual({ ok: true, target: { all: true }, tag: null });
    const bad: [unknown, string][] = [
      [null, 'body'], ['x', 'body'], [[FLEET_ID], 'body'],
      [{}, 'nodeId'], [{ nodeId: '' }, 'nodeId'], [{ nodeId: 7 }, 'nodeId'],
      [{ nodeId: FLEET_ID, all: true }, 'all'], [{ all: false }, 'all'], [{ all: 'yes' }, 'all'],
      [{ nodeId: FLEET_ID, force: true }, 'force'], [{ nodeId: FLEET_ID, tag: null }, 'tag'], [{ all: true, tag: 9 }, 'tag'],
    ];
    for (const [body, field] of bad) {
      expect(parseApplyBody(body), JSON.stringify(body)).toEqual({ ok: false, error: 'bad-request', field });
    }
    for (const tag of ['0.0.9', 'v0.0.9 ', 'V0.0.9', 'v0.0', 'v0.0.9\n', '; rm -rf ~', 'v0.0.010']) {
      expect(parseApplyBody({ all: true, tag }), JSON.stringify(tag)).toEqual({ ok: false, error: 'bad-tag', field: 'tag' });
    }
  });

  it('rollback: a nodeId, and an optional to through the one guard', () => {
    expect(parseRollbackBody({ nodeId: FLEET_ID })).toEqual({ ok: true, nodeId: FLEET_ID, to: null });
    expect(parseRollbackBody({ nodeId: FLEET_ID, to: 'v0.0.8' })).toEqual({ ok: true, nodeId: FLEET_ID, to: 'v0.0.8' });
    const bad: [unknown, string][] = [
      [null, 'body'], [[FLEET_ID], 'body'], [{}, 'nodeId'], [{ nodeId: 7 }, 'nodeId'],
      [{ nodeId: FLEET_ID, all: true }, 'all'], [{ nodeId: FLEET_ID, tag: 'v0.0.8' }, 'tag'], [{ nodeId: FLEET_ID, to: null }, 'to'],
    ];
    for (const [body, field] of bad) {
      expect(parseRollbackBody(body), JSON.stringify(body)).toEqual({ ok: false, error: 'bad-request', field });
    }
    for (const to of ['0.0.8', 'v0.0.8 ', 'v0.0.8\n']) {
      expect(parseRollbackBody({ nodeId: FLEET_ID, to }), JSON.stringify(to)).toEqual({ ok: false, error: 'bad-tag', field: 'to' });
    }
  });
});

describe('POST /api/updates/apply — one named node (spec §12)', () => {
  it('501 not-configured on a box with no coordination database', async () => {
    const app = await openBare();
    const r = await post(app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(r.statusCode).toBe(501);
    expect(r.json()).toEqual({ ok: false, error: 'not-configured' });
  });

  it('requests the NAMED tag, not the resolved newest — and writes the request group only (§18 "apply names a tag")', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    desire(f.coord, FLEET_ID, 'v0.0.10');
    const before = f.coord.node(FLEET_ID)!;
    const r = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.11' });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({ ok: true, requested: [FLEET_ID], skipped: [] } satisfies MoveRequestAnswer);
    const after = f.coord.node(FLEET_ID)!;
    expect(after).toMatchObject({ requestedTag: 'v0.0.11', requestedKind: 'update' });
    expect(after.requestedAt).toBeGreaterThan(0);
    // No watcher, so nothing dispatched: every other column is exactly what it was.
    expect({ ...after, requestedTag: null, requestedKind: null, requestedAt: null }).toEqual(before);
  });

  it("without tag, requests the node's resolved desiredTag", async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    desire(f.coord, FLEET_ID, 'v0.0.10');
    const r = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID });
    expect(r.statusCode, r.body).toBe(202);
    expect(f.coord.node(FLEET_ID)).toMatchObject({ requestedTag: 'v0.0.10', requestedKind: 'update' });
  });

  it("409 no-desired with the resolver's own sentence when nothing resolved and no tag was named — nothing written", async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    desire(f.coord, FLEET_ID, null, 'pinned v0.0.99: it is not in the release catalogue');
    const r = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ ok: false, error: 'no-desired', detail: 'pinned v0.0.99: it is not in the release catalogue' });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
  });

  it('409 not-newer for a tag older than current; an unversioned node is never "not newer" (§18)', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    // The stamp READ ok and carries no version, and no floor file: "never not newer" is the no-floor case
    // (an unversioned node WITH a floor is floor-bound, D-3403).
    plant(f.coord, serverNode({ currentVersion: null, highestVersion: null, floorRead: 'absent' }));
    const older = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.8' });
    expect(older.statusCode, older.body).toBe(409);
    expect(older.json()).toMatchObject({ ok: false, error: 'not-newer' });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
    for (const tag of ['v0.0.8', 'v0.0.10']) {
      const r = await post(f.app, '/api/updates/apply', { nodeId: SERVER_ID, tag });
      expect(r.statusCode, `${tag}: ${r.body}`).toBe(202);
      expect(f.coord.node(SERVER_ID)!.requestedTag).toBe(tag);
    }
  });

  it("409 not-newer at or below a rolled-back node's FLOOR, naming it; {all: true} skips that node (D-3403)", async () => {
    const f = await open();
    catalogue(f.coord);
    // Rolled back from v0.0.10 to v0.0.8: the floor file keeps v0.0.10. Its ccrc would refuse v0.0.9 inside the
    // detached run, and the failed row that leaves would halt the fleet — so the route refuses it here instead.
    plant(f.coord, fleetNode({ currentVersion: 'v0.0.8', highestVersion: 'v0.0.10', previousVersion: 'v0.0.10' }));
    for (const tag of ['v0.0.9', 'v0.0.10']) {
      const r = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag });
      expect(r.statusCode, `${tag}: ${r.body}`).toBe(409);
      expect(r.json()).toMatchObject({ ok: false, error: 'not-newer' });
      expect(r.json().detail, tag).toContain("floor v0.0.10 (it runs v0.0.8)");
    }
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
    const all = await post(f.app, '/api/updates/apply', { all: true, tag: 'v0.0.9' });
    expect(all.statusCode, all.body).toBe(202);
    expect(all.json()).toEqual({ ok: true, requested: [], skipped: [{ nodeId: FLEET_ID, why: 'not-newer' }] });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
    // Above the floor it moves (v0.0.11 is the dev release: the route checks direction, never the channel).
    const above = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.11' });
    expect(above.statusCode, above.body).toBe(202);
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBe('v0.0.11');
  });

  it('409 stamp-unread: a stamp that could not be read is never taken for unversioned (D-3379)', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode(UNREAD));
    const r = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toMatchObject({ ok: false, error: 'stamp-unread' });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
  });

  it("409 unknown-tag for a tag no row names and for a yanked one; refused-by-node for this node's refusal only", async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    plant(f.coord, fleetNode({ nodeId: OTHER_ID, label: 'other' }));
    for (const tag of ['v0.0.99', 'v0.0.12']) {
      const r = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag });
      expect(r.statusCode, `${tag}: ${r.body}`).toBe(409);
      expect(r.json()).toMatchObject({ ok: false, error: 'unknown-tag' });
    }
    expect(f.coord.refuseRelease(FLEET_ID, 'v0.0.10', 6, 'provenance: signature mismatch').ok).toBe(true);
    const refused = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ ok: false, error: 'refused-by-node' });
    // Decision 16: a refusal is keyed by the node that refused.
    const other = await post(f.app, '/api/updates/apply', { nodeId: OTHER_ID, tag: 'v0.0.10' });
    expect(other.statusCode, other.body).toBe(202);
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
  });

  it('409 no-detach-cap; 409 agent-predates-update-op for a link-reached node — never for the server row (§18)', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode({ caps: without(DETACH_CAP) }));
    plant(f.coord, fleetNode({ nodeId: OTHER_ID, label: 'other', agentOps: [] }));
    plant(f.coord, serverNode());
    const capless = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(capless.statusCode, capless.body).toBe(409);
    expect(capless.json()).toMatchObject({ ok: false, error: 'no-detach-cap' });
    const old = await post(f.app, '/api/updates/apply', { nodeId: OTHER_ID, tag: 'v0.0.10' });
    expect(old.statusCode, old.body).toBe(409);
    expect(old.json()).toMatchObject({ ok: false, error: 'agent-predates-update-op' });
    // agentOps NULL is "no agent by construction": spawned locally, never asked for an op word.
    const server = await post(f.app, '/api/updates/apply', { nodeId: SERVER_ID, tag: 'v0.0.10' });
    expect(server.statusCode, server.body).toBe(202);
  });

  it("409 halted in the same request, naming the halting row; a provenance verdict does not halt", async () => {
    const halted = await open();
    catalogue(halted.coord);
    plant(halted.coord, fleetNode());
    plant(halted.coord, fleetNode({ nodeId: OTHER_ID, label: 'other' }));
    verdict(halted.coord, OTHER_ID, 'spawn-failed — update: fixture refusal');
    const r = await post(halted.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toEqual({ ok: false, error: 'halted', detail: OTHER_ID });
    expect(halted.coord.node(FLEET_ID)!.requestedTag).toBeNull();

    const verified = await open();
    catalogue(verified.coord);
    plant(verified.coord, fleetNode());
    plant(verified.coord, fleetNode({ nodeId: OTHER_ID, label: 'other' }));
    verdict(verified.coord, OTHER_ID, 'provenance: signature mismatch');
    const ok = await post(verified.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(ok.statusCode, ok.body).toBe(202);
  });

  it("busy is the named node's OWN lease — another node's lease is a turn, not a refusal (D-3386)", async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    plant(f.coord, fleetNode({ nodeId: OTHER_ID, label: 'other' }));
    hold(f.coord, FLEET_ID);
    const own = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(own.statusCode, own.body).toBe(409);
    expect(own.json()).toEqual({ ok: false, error: 'busy', detail: 'pending' });
    const other = await post(f.app, '/api/updates/apply', { nodeId: OTHER_ID, tag: 'v0.0.10' });
    expect(other.statusCode, other.body).toBe(202);
    expect(f.coord.node(OTHER_ID)!.requestedTag).toBe('v0.0.10');
    expect(f.coord.node(FLEET_ID)!.updateState, 'a request on another node touched the held lease').toBe('pending');
  });

  it('404 unknown-node; 409 superseded naming its successor; 400 bad-tag and bad-request naming the field', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode({ nodeId: FLEET_LABEL }));           // the pre-W1 label-keyed row
    plant(f.coord, fleetNode());
    expect(f.coord.rekeyNode(FLEET_LABEL, FLEET_ID)).toMatchObject({ ok: true, how: 'superseded' });
    const sup = await post(f.app, '/api/updates/apply', { nodeId: FLEET_LABEL, tag: 'v0.0.10' });
    expect(sup.statusCode).toBe(409);
    expect(sup.json()).toEqual({ ok: false, error: 'superseded', detail: FLEET_ID });
    const unknown = await post(f.app, '/api/updates/apply', { nodeId: 'no-such-node', tag: 'v0.0.10' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ ok: false, error: 'unknown-node' });
    const badTag = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10 ' });
    expect(badTag.statusCode).toBe(400);
    expect(badTag.json()).toEqual({ ok: false, error: 'bad-tag', field: 'tag' });
    const badBody = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, all: true });
    expect(badBody.statusCode).toBe(400);
    expect(badBody.json()).toEqual({ ok: false, error: 'bad-request', field: 'all' });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
  });
});

describe('POST /api/updates/apply {all: true} — every live node the move takes forward', () => {
  it('requests only the nodes the tag moves forward, in DISPATCH order, and names the rest in skipped (D-3385)', async () => {
    const f = await open();
    catalogue(f.coord);
    // Labelled so that label order (nodes()'s) would put the server FIRST.
    plant(f.coord, fleetNode({ label: 'zeta-fleet' }));
    plant(f.coord, serverNode());
    plant(f.coord, fleetNode({ nodeId: OTHER_ID, label: 'other', currentVersion: 'v0.0.10' }));
    plant(f.coord, fleetNode({ nodeId: THIRD_ID, label: 'unread', ...UNREAD }));
    const atTag = f.coord.node(OTHER_ID)!.updateDetail;
    const r = await post(f.app, '/api/updates/apply', { all: true, tag: 'v0.0.10' });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({
      ok: true, requested: [FLEET_ID, SERVER_ID],
      skipped: [{ nodeId: OTHER_ID, why: 'not-newer' }, { nodeId: THIRD_ID, why: 'stamp-unread' }],
    } satisfies MoveRequestAnswer);
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBe('v0.0.10');
    expect(f.coord.node(SERVER_ID)!.requestedTag).toBe('v0.0.10');
    expect(f.coord.node(OTHER_ID)!.requestedTag, 'a request the dispatcher can only refuse was written').toBeNull();
    expect(f.coord.node(THIRD_ID)!.requestedTag).toBeNull();
    // §12: the refusal is said where the operator reads the node — a node already at the tag is not refused.
    // Said in the PAST tense — what was measured when the request was made — because nothing clears the note.
    expect(f.coord.node(THIRD_ID)!.updateDetail, 'the unread node was skipped silently').toMatch(/^not requested: stamp-unread — /);
    expect(f.coord.node(THIRD_ID)!.updateDetail, 'a present-tense sentence goes stale on the row').not.toMatch(/\bwaits\b|\bhas no\b/);
    expect(f.coord.node(OTHER_ID)!.updateDetail, 'a node already at the tag was told it was refused').toBe(atTag);
  });

  it("without tag, each node's OWN desiredTag; a node with none is skipped no-desired", async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    plant(f.coord, serverNode());
    desire(f.coord, FLEET_ID, 'v0.0.10');
    desire(f.coord, SERVER_ID, null, 'no release is eligible on stable');
    const r = await post(f.app, '/api/updates/apply', { all: true });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({ ok: true, requested: [FLEET_ID], skipped: [{ nodeId: SERVER_ID, why: 'no-desired' }] });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBe('v0.0.10');
    expect(f.coord.node(SERVER_ID)!.requestedTag).toBeNull();
  });

  it('a node the dispatcher could never move is skipped with its refusal, so it cannot hold the server behind it (D-3401)', async () => {
    const f = await open();
    catalogue(f.coord);
    // A macOS fleet node: `--detach` is Linux-only (decision 17), so no `detach` word.
    plant(f.coord, fleetNode({ os: 'darwin', caps: without(DETACH_CAP) }));
    plant(f.coord, serverNode());
    const r = await post(f.app, '/api/updates/apply', { all: true, tag: 'v0.0.10' });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({ ok: true, requested: [SERVER_ID], skipped: [{ nodeId: FLEET_ID, why: 'no-detach-cap' }] });
    // No request, so the dispatcher never reaches this node: the route notes it (spec §12's "per-node
    // refusals through updateDetail"), through the one writer the dispatcher uses.
    expect(f.coord.node(FLEET_ID)!.updateDetail, 'the skip was said nowhere the operator reads the node')
      .toMatch(/^not requested: no-detach-cap — /);
    expect(f.coord.node(FLEET_ID)!.updateDetail, 'the note says what happened, so it stays true after the condition clears')
      .toBe("not requested: no-detach-cap — fleet's ccrc-caps had no detach");
    // D-3381 defers a server move while ANY fleet row holds a request —
    // so a request written on the darwin row would have parked the server behind it for good.
    const plan = planDispatch({
      nodes: dispatchViewsFor(f.coord),
      releases: resolveInputFor(f.coord, f.coord.node(SERVER_ID)!).releases,
    });
    expect(plan.move?.nodeId, JSON.stringify(plan.refusals)).toBe(SERVER_ID);
  });

  // Review of the item 8 sentences, M3: the note is written ONCE and nothing clears it, so each says what WAS measured, in
  // the past tense. Every word `skipWord` lets through and the route notes is pinned to its whole sentence (`not-newer`
  // is skipped without a note, and the other four are the dispatcher's own refusals `skipWord` throws on).
  const SKIP_NOTES: { word: string; tag: string; setup: (c: CoordStore) => void; sentence: string }[] = [
    { word: 'unknown-tag', tag: 'v0.0.12', setup: (c) => plant(c, fleetNode()),
      sentence: `v0.0.12 was not a release ${FLEET_LABEL} could be moved to (no eligible catalogue row for it)` },
    { word: 'refused-by-node', tag: 'v0.0.10', setup: (c) => {
      plant(c, fleetNode());
      expect(c.refuseRelease(FLEET_ID, 'v0.0.10', 6, 'provenance: signature mismatch').ok).toBe(true);
    }, sentence: `${FLEET_LABEL} had refused v0.0.10 on a provenance verdict` },
    { word: 'stamp-unread', tag: 'v0.0.10', setup: (c) => plant(c, fleetNode(UNREAD)),
      sentence: `${FLEET_LABEL}'s build stamp read unreadable, so its version was unknown` },
    { word: 'floor-unread', tag: 'v0.0.10', setup: (c) => plant(c, fleetNode({ highestVersion: null, floorRead: 'unmeasured' })),
      sentence: `${FLEET_LABEL}'s floor had not been measured` },
    { word: 'no-detach-cap', tag: 'v0.0.10', setup: (c) => plant(c, fleetNode({ caps: without(DETACH_CAP) })),
      sentence: `${FLEET_LABEL}'s ccrc-caps had no detach` },
    { word: 'agent-predates-update-op', tag: 'v0.0.10', setup: (c) => plant(c, fleetNode({ agentOps: [] })),
      sentence: `${FLEET_LABEL}'s agent did not advertise the update op` },
  ];
  it.each(SKIP_NOTES)("a skipped node's note for $word is the whole past-tense sentence, on the row", async (c) => {
    const f = await open();
    catalogue(f.coord);
    c.setup(f.coord);
    const r = await post(f.app, '/api/updates/apply', { all: true, tag: c.tag });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({ ok: true, requested: [], skipped: [{ nodeId: FLEET_ID, why: c.word }] });
    expect(f.coord.node(FLEET_ID)!.updateDetail).toBe(`not requested: ${c.word} — ${c.sentence}`);
  });

  it("a skipped node whose row holds a verdict keeps the verdict's detail — the note never overwrites it", async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode({ caps: without(DETACH_CAP) }));
    // A provenance verdict: non-halting, and its `provenance:` prefix is what keeps it so.
    verdict(f.coord, FLEET_ID, 'provenance: signature mismatch');
    const r = await post(f.app, '/api/updates/apply', { all: true, tag: 'v0.0.10' });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({ ok: true, requested: [], skipped: [{ nodeId: FLEET_ID, why: 'no-detach-cap' }] });
    expect(f.coord.node(FLEET_ID)).toMatchObject({ updateState: 'failed', updateDetail: 'provenance: signature mismatch' });
  });

  it('always 202 on a halted fleet, requests written for a row NOT itself halting — while a single-node apply on the same fleet is 409 halted (tightened: the halting row itself gets nothing)', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    plant(f.coord, fleetNode({ nodeId: OTHER_ID, label: 'other' }));
    verdict(f.coord, OTHER_ID, 'spawn-failed — update: fixture refusal');
    const otherDetailBefore = f.coord.node(OTHER_ID)!.updateDetail;
    const one = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' });
    expect(one.statusCode).toBe(409);
    expect(one.json()).toMatchObject({ error: 'halted' });
    const all = await post(f.app, '/api/updates/apply', { all: true, tag: 'v0.0.10' });
    expect(all.statusCode, all.body).toBe(202);
    // Tightened (review): the full requested/skipped, not a loose `toContain` — and the halting row (OTHER_ID)
    // is skipped `halted`, not asked at all (a halt by ANOTHER row still writes the request — D-3401).
    expect(all.json()).toEqual({ ok: true, requested: [FLEET_ID], skipped: [{ nodeId: OTHER_ID, why: 'halted' }] });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBe('v0.0.10');
    // The halting row's request columns are untouched, and its detail is still the verdict — nothing was noted.
    expect(f.coord.node(OTHER_ID)!.requestedTag).toBeNull();
    expect(f.coord.node(OTHER_ID)!.updateDetail).toBe(otherDetailBefore);
  });

  it('a HALTING SERVER row does not hold the fleet back — only a fleet row’s own busy/halt does that (D-3401 corrected)', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    plant(f.coord, serverNode());
    verdict(f.coord, SERVER_ID, 'spawn-failed — update: fixture refusal');
    const r = await post(f.app, '/api/updates/apply', { all: true, tag: 'v0.0.10' });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({ ok: true, requested: [FLEET_ID], skipped: [{ nodeId: SERVER_ID, why: 'halted' }] });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBe('v0.0.10');
    expect(f.coord.node(SERVER_ID)!.requestedTag).toBeNull();
  });

  it("a row that is ITSELF halting gets no request — the only door out is ack, which would erase it (corrected: the halt's own exit)", async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    plant(f.coord, serverNode());
    verdict(f.coord, FLEET_ID, 'spawn-failed — update: fixture refusal');
    const before = f.coord.node(FLEET_ID)!;
    const r = await post(f.app, '/api/updates/apply', { all: true, tag: 'v0.0.10' });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({
      ok: true, requested: [], skipped: [{ nodeId: FLEET_ID, why: 'halted' }, { nodeId: SERVER_ID, why: 'waiting-for-fleet' }],
    } satisfies MoveRequestAnswer);
    // Nothing written on either — the halt's own detail is the verdict, and the server was never asked at all.
    expect(f.coord.node(FLEET_ID)).toEqual(before);
    expect(f.coord.node(SERVER_ID)!.requestedTag).toBeNull();
    // Ack the halting row, and confirm no stray request moves the server: `requestAll` wrote none, so there is
    // nothing for the dispatcher to plan.
    expect(f.coord.ackNode(FLEET_ID).ok).toBe(true);
    const plan = planDispatch({
      nodes: dispatchViewsFor(f.coord),
      releases: resolveInputFor(f.coord, f.coord.node(SERVER_ID)!).releases,
    });
    expect(plan.move, JSON.stringify(plan)).toBeNull();
  });

  it("a fleet row's own busy lease skips it — and holds the server behind it too, never moving the server ahead (D-3406, D-3401 corrected)", async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    plant(f.coord, serverNode());
    hold(f.coord, FLEET_ID);   // an older tag's lease, still outstanding
    const before = f.coord.node(FLEET_ID)!;
    const beforeServer = f.coord.node(SERVER_ID)!;
    const r = await post(f.app, '/api/updates/apply', { all: true, tag: 'v0.0.11' });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({
      ok: true, requested: [], skipped: [{ nodeId: FLEET_ID, why: 'busy' }, { nodeId: SERVER_ID, why: 'waiting-for-fleet' }],
    } satisfies MoveRequestAnswer);
    // No request written, and no note either — the row is busy, not idle (`noteDispatchRefusal` refuses it
    // anyway); the server was never asked at all, so nothing changed there either.
    expect(f.coord.node(FLEET_ID)).toEqual(before);
    expect(f.coord.node(SERVER_ID)).toEqual(beforeServer);
  });
});

describe('POST /api/updates/rollback (spec §12)', () => {
  it('without to, rolls back to the measured previousVersion', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    const r = await post(f.app, '/api/updates/rollback', { nodeId: FLEET_ID });
    expect(r.statusCode, r.body).toBe(202);
    expect(r.json()).toEqual({ ok: true, requested: [FLEET_ID], skipped: [] });
    expect(f.coord.node(FLEET_ID)).toMatchObject({ requestedTag: 'v0.0.8', requestedKind: 'rollback' });
  });

  it('409 no-previous when previousVersion is NULL — the route never goes looking for one', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode({ previousVersion: null, previousRead: 'absent' }));
    desire(f.coord, FLEET_ID, 'v0.0.10');
    const r = await post(f.app, '/api/updates/rollback', { nodeId: FLEET_ID });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ ok: false, error: 'no-previous' });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
  });

  it('409 no-previous on an UNMEASURED previous file says so — never read as "no previous install" (D-3213)', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode({ previousVersion: null, previousRead: 'unmeasured' }));
    const r = await post(f.app, '/api/updates/rollback', { nodeId: FLEET_ID });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ ok: false, error: 'no-previous', detail: 'the previous release has not been measured yet — name one with to' });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
  });

  it('catalogue-gated: a tag no releases row names → unknown-tag; a yanked row is permitted', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    const missing = await post(f.app, '/api/updates/rollback', { nodeId: FLEET_ID, to: 'v0.0.5' });
    expect(missing.statusCode, missing.body).toBe(409);
    expect(missing.json()).toMatchObject({ ok: false, error: 'unknown-tag' });
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
    const yanked = await post(f.app, '/api/updates/rollback', { nodeId: FLEET_ID, to: 'v0.0.7' });
    expect(yanked.statusCode, yanked.body).toBe(202);
    expect(f.coord.node(FLEET_ID)).toMatchObject({ requestedTag: 'v0.0.7', requestedKind: 'rollback' });
  });

  it("409 refused-by-node for this node's refusal; another node's refusal is not an input", async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    plant(f.coord, fleetNode({ nodeId: OTHER_ID, label: 'other' }));
    expect(f.coord.refuseRelease(FLEET_ID, 'v0.0.8', 6, 'provenance: signature mismatch').ok).toBe(true);
    const own = await post(f.app, '/api/updates/rollback', { nodeId: FLEET_ID, to: 'v0.0.8' });
    expect(own.statusCode, own.body).toBe(409);
    expect(own.json()).toMatchObject({ ok: false, error: 'refused-by-node' });
    const other = await post(f.app, '/api/updates/rollback', { nodeId: OTHER_ID, to: 'v0.0.8' });
    expect(other.statusCode, other.body).toBe(202);
  });

  it('409 no-rollback-cap, no-detach-cap and agent-predates-update-op — the words the dispatcher would say (D-3387)', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode({ caps: without(ROLLBACK_CAP) }));
    plant(f.coord, fleetNode({ nodeId: OTHER_ID, label: 'other', caps: without(DETACH_CAP) }));
    plant(f.coord, fleetNode({ nodeId: THIRD_ID, label: 'third', agentOps: [] }));
    for (const [nodeId, error] of [[FLEET_ID, 'no-rollback-cap'], [OTHER_ID, 'no-detach-cap'], [THIRD_ID, 'agent-predates-update-op']] as const) {
      const r = await post(f.app, '/api/updates/rollback', { nodeId, to: 'v0.0.8' });
      expect(r.statusCode, `${nodeId}: ${r.body}`).toBe(409);
      expect(r.json()).toMatchObject({ ok: false, error });
      expect(f.coord.node(nodeId)!.requestedTag).toBeNull();
    }
  });

  it('409 no-bundle for a rollback to a tag the catalogue lists no provenance bundle for on a verified node (wave 8 item C, D-3587)', async () => {
    const calls: [string, string[]][] = [];
    const runner: Runner = (cmd, args) => { calls.push([cmd, [...args]]); return Promise.resolve({ code: 0, stdout: '', stderr: '' }); };
    const f = await open({ runner });
    catalogue(f.coord);
    expect(f.coord.applyReleaseListing(
      [{ tag: 'v0.0.8', channel: 'stable', publishedAt: 1_100, commitSha: null,
        tarballUrl: 'https://example.invalid/ccrc-v0.0.8.tar.gz', bundleListed: false, notes: null, draft: false }],
      4_000, 'single',
    ).ok).toBe(true);
    plant(f.coord, fleetNode({ provenance: 'verified' }));
    const r = await post(f.app, '/api/updates/rollback', { nodeId: FLEET_ID, to: 'v0.0.8' });
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json()).toMatchObject({ ok: false, error: 'no-bundle' });
    expect((r.json() as { detail?: string }).detail).toMatch(/^no-bundle — /);
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
    expect(f.coord.node(FLEET_ID)!.updateState).toBe('idle');
    expect(calls).toEqual([]);
  });

  it('409 halted and 409 busy, exactly as apply answers them', async () => {
    const halted = await open();
    catalogue(halted.coord);
    plant(halted.coord, fleetNode());
    plant(halted.coord, fleetNode({ nodeId: OTHER_ID, label: 'other' }));
    verdict(halted.coord, OTHER_ID, 'reverted-looking failure — fixture');
    const h = await post(halted.app, '/api/updates/rollback', { nodeId: FLEET_ID });
    expect(h.statusCode, h.body).toBe(409);
    expect(h.json()).toEqual({ ok: false, error: 'halted', detail: OTHER_ID });

    const busy = await open();
    catalogue(busy.coord);
    plant(busy.coord, fleetNode());
    hold(busy.coord, FLEET_ID);
    const b = await post(busy.app, '/api/updates/rollback', { nodeId: FLEET_ID });
    expect(b.statusCode, b.body).toBe(409);
    expect(b.json()).toEqual({ ok: false, error: 'busy', detail: 'pending' });
  });

  it('400 bad-tag for a to off the tag shape; 404 unknown-node', async () => {
    const f = await open();
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    const bad = await post(f.app, '/api/updates/rollback', { nodeId: FLEET_ID, to: '0.0.8' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ ok: false, error: 'bad-tag', field: 'to' });
    const unknown = await post(f.app, '/api/updates/rollback', { nodeId: 'no-such-node' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ ok: false, error: 'unknown-node' });
  });
});

describe("the route and the dispatcher agree — one predicate, two callers (§18 \"every capability refusal is in the dispatcher\")", () => {
  // Each case: the route's single-node 409 word, then the SAME request written past the
  // route and planned. A route with a check of its own would answer a word the planner
  // does not — or, with the planner's check gone, the planner would MOVE a node the route refuses.
  const CASES: { name: string; kind: RequestKind; target: string; setup: (c: CoordStore) => void }[] = [
    { name: 'not-newer', kind: 'update', target: 'v0.0.8', setup: (c) => plant(c, fleetNode()) },
    { name: 'stamp-unread', kind: 'update', target: 'v0.0.10', setup: (c) => plant(c, fleetNode(UNREAD)) },
    // D-3492: the stamp read, the floor never did (W2 D-3213) — its own word, not stamp-unread.
    { name: 'floor-unread', kind: 'update', target: 'v0.0.10', setup: (c) => plant(c, fleetNode({ highestVersion: null, floorRead: 'unmeasured' })) },
    { name: 'no-detach-cap', kind: 'update', target: 'v0.0.10', setup: (c) => plant(c, fleetNode({ caps: without(DETACH_CAP) })) },
    { name: 'agent-predates-update-op', kind: 'update', target: 'v0.0.10', setup: (c) => plant(c, fleetNode({ agentOps: [] })) },
    { name: 'unknown-tag', kind: 'rollback', target: 'v0.0.5', setup: (c) => plant(c, fleetNode()) },
    { name: 'refused-by-node', kind: 'rollback', target: 'v0.0.8', setup: (c) => {
      plant(c, fleetNode());
      expect(c.refuseRelease(FLEET_ID, 'v0.0.8', 6, 'provenance: signature mismatch').ok).toBe(true);
    } },
    { name: 'no-rollback-cap', kind: 'rollback', target: 'v0.0.8', setup: (c) => plant(c, fleetNode({ caps: without(ROLLBACK_CAP) })) },
    { name: 'halted', kind: 'update', target: 'v0.0.10', setup: (c) => {
      plant(c, fleetNode());
      plant(c, fleetNode({ nodeId: OTHER_ID, label: 'other' }));
      verdict(c, OTHER_ID, 'spawn-failed — update: fixture refusal');
    } },
    // Wave 8 item C (D-3587): a rollback to a tag the catalogue lists no provenance bundle for, on a verified node.
    { name: 'no-bundle', kind: 'rollback', target: 'v0.0.8', setup: (c) => {
      expect(c.applyReleaseListing(
        [{ tag: 'v0.0.8', channel: 'stable', publishedAt: 1_100, commitSha: null,
          tarballUrl: 'https://example.invalid/ccrc-v0.0.8.tar.gz', bundleListed: false, notes: null, draft: false }],
        4_000, 'single',
      ).ok).toBe(true);
      plant(c, fleetNode());
    } },
  ];

  it.each(CASES)('$name: the route answers the word planDispatch refuses the same request with', async (c) => {
    const f = await open();
    catalogue(f.coord);
    c.setup(f.coord);
    const url = c.kind === 'update' ? '/api/updates/apply' : '/api/updates/rollback';
    const body = c.kind === 'update' ? { nodeId: FLEET_ID, tag: c.target } : { nodeId: FLEET_ID, to: c.target };
    const r = await post(f.app, url, body);
    expect(r.statusCode, r.body).toBe(409);
    expect(r.json().error).toBe(c.name);
    expect(f.coord.requestNode(FLEET_ID, c.target, c.kind, 9)).toMatchObject({ ok: true });
    const plan = planDispatch({
      nodes: dispatchViewsFor(f.coord),
      releases: resolveInputFor(f.coord, f.coord.node(FLEET_ID)!).releases,
    });
    expect(plan.move, 'the planner moved a node the route refused').toBeNull();
    expect(plan.refusals.find((p) => p.nodeId === FLEET_ID)?.refusal).toBe(c.name);
  });
});

describe('a request write dispatches in the same turn (§18 "a request write triggers dispatch")', () => {
  it('apply: when the 202 is read, the named node already holds the lease', async () => {
    const held = heldRunner();
    const f = await open({ watcher: true, runner: held.runner });
    catalogue(f.coord);
    plant(f.coord, serverNode({ role: 'both' }));                  // local mode's own row: spawned through the Runner
    const before = Date.now();
    const r = await post(f.app, '/api/updates/apply', { nodeId: SERVER_ID, tag: 'v0.0.10' });
    expect(r.statusCode, r.body).toBe(202);
    const row = f.coord.node(SERVER_ID)!;
    expect(row.updateState, 'no dispatch ran in the apply request').toBe('pending');
    expect(row.updateTarget).toBe('v0.0.10');
    expect(row.updateStartedAt!).toBeGreaterThanOrEqual(before);
    expect(row.requestedTag, 'the request stands until convergence or ack').toBe('v0.0.10');
    // Let the parked spawn answer before the fixture closes. A refused --detach parent is a
    // halting spawn-failed (Task 5's mapping); here it only proves which arm was reached.
    held.release({ code: 1, stdout: '', stderr: 'update: fixture refusal\n' });
    await vi.waitFor(() => expect(f.coord.node(SERVER_ID)!.updateState).toBe('failed'), { timeout: 3000 });
    expect(held.calls).toEqual([[updateLauncherPath(f.home), [...updateSpawnArgv('update', 'v0.0.10')]]]);
  });

  it('rollback: likewise, the lease is acquired for the requested rollback before the reply', async () => {
    const held = heldRunner();
    const f = await open({ watcher: true, runner: held.runner });
    catalogue(f.coord);
    plant(f.coord, serverNode({ role: 'both' }));
    const r = await post(f.app, '/api/updates/rollback', { nodeId: SERVER_ID });
    expect(r.statusCode, r.body).toBe(202);
    expect(f.coord.node(SERVER_ID), 'no dispatch ran in the rollback request')
      .toMatchObject({ updateState: 'pending', updateTarget: 'v0.0.8', requestedKind: 'rollback' });
    held.release({ code: 1, stdout: '', stderr: 'update: fixture refusal\n' });
    await vi.waitFor(() => expect(f.coord.node(SERVER_ID)!.updateState).toBe('failed'), { timeout: 3000 });
    expect(held.calls).toEqual([[updateLauncherPath(f.home), [...updateSpawnArgv('rollback', 'v0.0.8')]]]);
  });

  it('{all: true}: likewise — when the 202 is read, the one node it requested already holds the lease (review finding 2, minor: the trigger was unpinned for {all})', async () => {
    const held = heldRunner();
    const f = await open({ watcher: true, runner: held.runner });
    catalogue(f.coord);
    plant(f.coord, serverNode({ role: 'both' }));   // the only live row, so unambiguously the one dispatch moves
    const before = Date.now();
    const r = await post(f.app, '/api/updates/apply', { all: true, tag: 'v0.0.10' });
    expect(r.statusCode, r.body).toBe(202);
    expect((r.json() as MoveRequestAnswer).requested).toEqual([SERVER_ID]);
    const row = f.coord.node(SERVER_ID)!;
    expect(row.updateState, 'no dispatch ran in the {all: true} request').toBe('pending');
    expect(row.updateTarget).toBe('v0.0.10');
    expect(row.updateStartedAt!).toBeGreaterThanOrEqual(before);
    held.release({ code: 1, stdout: '', stderr: 'update: fixture refusal\n' });
    await vi.waitFor(() => expect(f.coord.node(SERVER_ID)!.updateState).toBe('failed'), { timeout: 3000 });
    expect(held.calls).toEqual([[updateLauncherPath(f.home), [...updateSpawnArgv('update', 'v0.0.10')]]]);
  });
});

describe('credentials, armed (decision 15: the box token never writes intent)', () => {
  it("no session → the gate's 401; the box token alone → the gate's 401; nothing is written", async () => {
    const f = await open({ auth: true });
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    for (const [url, body] of [
      ['/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' }],
      ['/api/updates/rollback', { nodeId: FLEET_ID }],
    ] as const) {
      const anon = await post(f.app, url, body);
      expect(anon.statusCode, url).toBe(401);
      expect(anon.json()).toMatchObject({ verdict: 'no-session' });
      const token = await post(f.app, url, body, { 'x-ccrc-mail-token': TOKEN });
      expect(token.statusCode, `${url} with the box token`).toBe(401);
      expect(token.json()).toMatchObject({ verdict: 'no-session' });
    }
    expect(f.coord.node(FLEET_ID)!.requestedTag).toBeNull();
  });

  it('a session is the credential, and a box-token header beside it changes nothing', async () => {
    const f = await open({ auth: true });
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    const cookie = await login(f.app);
    const apply = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' }, { cookie });
    expect(apply.statusCode, apply.body).toBe(202);
    const rollback = await post(f.app, '/api/updates/rollback', { nodeId: FLEET_ID },
      { cookie, 'x-ccrc-mail-token': 'not-the-token' });
    expect(rollback.statusCode, rollback.body).toBe(202);
    expect(f.coord.node(FLEET_ID)).toMatchObject({ requestedTag: 'v0.0.8', requestedKind: 'rollback' });
  });

  it('a live session from a foreign Origin is 403 foreign-origin on both moves — the CSRF check reaches them (§12)', async () => {
    // §12 says the moves "get the CSRF origin check for free" by being non-GET and not in EXEMPT;
    // this measures it on the two routes rather than trusting the structure (the one-tap is the
    // highest-value write a same-site page could forge, and Fastify parses a form's text/plain).
    const f = await open({ auth: true });
    catalogue(f.coord);
    plant(f.coord, fleetNode());
    const cookie = await login(f.app);
    for (const [url, body] of [
      ['/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' }],
      ['/api/updates/rollback', { nodeId: FLEET_ID }],
    ] as const) {
      const forged = await post(f.app, url, body, { cookie, origin: SIBLING });
      expect(forged.statusCode, `${url}: ${forged.body}`).toBe(403);
      expect(forged.json()).toEqual({ ok: false, error: 'foreign-origin' });
    }
    expect(f.coord.node(FLEET_ID)!.requestedTag, 'a forged move wrote a request').toBeNull();
    // The control: the same cookie from the box's OWN origin is let through, so the 403 above is the
    // Origin's and not a broken session.
    const own = loadConfig({ CCRC_HOME: f.home }).origin;
    const same = await post(f.app, '/api/updates/apply', { nodeId: FLEET_ID, tag: 'v0.0.10' }, { cookie, origin: own });
    expect(same.statusCode, same.body).toBe(202);
  });
});
