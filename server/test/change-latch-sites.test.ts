// Characterization (D-5861; ARCH-76 #811): the six hand-rolled "warn once until it changes" latches in
// `FleetWatcher`, driven through their own methods. Each warns once for a repeated key, again for a changed key, and
// again after its clear arm has run. Green on the hand-rolled fields; the moves to `changeLatch` run these rows
// unchanged, so a latch that stopped deduping, or stopped re-arming, shows here and not in a log. Fixture homes only.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { CoordStore, type NodeMeasurement, type ReleaseListingRow } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { FLEET_LABEL, SERVER_LABEL } from '../src/update/inventory.js';
import type { NodeRole } from '../../shared/api.js';
import { LedgerLog } from '../src/coord/ledgerlog.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const mocks = vi.hoisted(() => ({
  writeServerCaps: vi.fn(),
  sweepInventory: vi.fn(),
  resolveAndProject: vi.fn(),
}));
vi.mock('../src/update/serverCaps.js', async (orig) => ({ ...(await orig<object>()), writeServerCaps: mocks.writeServerCaps }));
vi.mock('../src/update/inventory.js', async (orig) => ({ ...(await orig<object>()), sweepInventory: mocks.sweepInventory }));
vi.mock('../src/update/project.js', async (orig) => ({ ...(await orig<object>()), resolveAndProject: mocks.resolveAndProject }));

afterEach(() => { vi.restoreAllMocks(); mocks.writeServerCaps.mockReset(); mocks.sweepInventory.mockReset(); mocks.resolveAndProject.mockReset(); });

const T = 1_790_000_000_000;

const fixture = (role: NodeRole = 'server', push = false) => {
  const home = mkTmp('ccrc-change-latch-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home);
  const sent: unknown[] = [];
  const deps = {
    ...base,
    cfg: { ...base.cfg, role },
    coord,
    ...(push ? { push: { notify: async (p: unknown) => { sent.push(p); } } as never } : {}),
  };
  const w = new FleetWatcher(deps as never, new Bus(), 10_000, path.join(home, 'state-cache.json'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const said = (needle: string): string[] => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(needle));
  return { w, coord, warn, said, sent };
};

describe('lastServerCapsWhy — serverCapsNow', () => {
  const fail = (code: string) => ({ ok: false, why: 'unwritable', code, detail: `cannot write (${code})` });

  it('warns once for a repeated reason, again for a changed one, and again after a success', async () => {
    const h = fixture('both');
    mocks.writeServerCaps.mockResolvedValueOnce(fail('EACCES')).mockResolvedValueOnce(fail('EACCES'))
      .mockResolvedValueOnce(fail('ENOSPC')).mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(fail('ENOSPC'));
    await h.w.serverCapsNow();
    await h.w.serverCapsNow();
    expect(h.said('server-caps'), 'a repeated reason warned twice').toHaveLength(1);
    expect(h.said('server-caps')[0]).toBe(
      'ccrc-server: could not write ~/.ccrc/server-caps (the fleet hook\'s gated arms stay off until it is written): cannot write (EACCES)');
    await h.w.serverCapsNow();
    expect(h.said('server-caps'), 'a changed reason was swallowed').toHaveLength(2);
    await h.w.serverCapsNow();                       // success: re-arms
    await h.w.serverCapsNow();
    expect(h.said('server-caps'), 'the same reason after a success must warn again').toHaveLength(3);
  });
});

describe('lastInventoryRejectWarn — warnInventoryRejected', () => {
  const rejected = (w: FleetWatcher, e: unknown): void => (w as unknown as { warnInventoryRejected(e: unknown): void }).warnInventoryRejected(e);

  it('a repeated rejection warns once', () => {
    const h = fixture();
    rejected(h.w, new Error('db locked'));
    rejected(h.w, new Error('db locked'));
    expect(h.said('the inventory sweep rejected')).toHaveLength(1);
    expect(h.said('the inventory sweep rejected')[0]).toMatch(
      /^ccrc-server: the inventory sweep rejected — a throw outside the per-row measurement\+apply catch \(C1\) or the projection path \(both are their own arms\/warnings\): Error: db locked/);
  });

  it('a changed message warns again, and a clean settle re-arms the warning', async () => {
    const h = fixture();
    rejected(h.w, new Error('db locked'));
    rejected(h.w, new Error('db corrupt'));
    expect(h.said('the inventory sweep rejected')).toHaveLength(2);
    const inner = h.w as unknown as { inventoryNow: () => Promise<unknown>; dispatchInventorySweep: () => Promise<void> };
    vi.spyOn(inner, 'inventoryNow').mockResolvedValue([]);
    await inner.dispatchInventorySweep();            // the clear arm
    rejected(h.w, new Error('db corrupt'));
    expect(h.said('the inventory sweep rejected'), 'the clear arm did not re-arm').toHaveLength(3);
  });
});

describe('lastProjectionWhy — sweepThenProject', () => {
  const run = (w: FleetWatcher): Promise<unknown> =>
    (w as unknown as { sweepThenProject(i: unknown, n: number): Promise<unknown> }).sweepThenProject({}, T);
  const unwritable = (code: string) => ({ projection: { ok: false, why: 'unwritable', code, detail: `d-${code}` } });

  it('warns once per reason, and again after a clean projection', async () => {
    const h = fixture();
    mocks.sweepInventory.mockResolvedValue([]);
    mocks.resolveAndProject
      .mockResolvedValueOnce(unwritable('EACCES')).mockResolvedValueOnce(unwritable('EACCES'))
      .mockResolvedValueOnce(unwritable('ENOSPC')).mockResolvedValueOnce({ projection: { ok: true } })
      .mockResolvedValueOnce(unwritable('ENOSPC'));
    await run(h.w); await run(h.w);
    expect(h.said('update-intent was not written'), 'a repeated reason warned twice').toHaveLength(1);
    await run(h.w);
    expect(h.said('update-intent was not written'), 'a changed reason was swallowed').toHaveLength(2);
    await run(h.w); await run(h.w);
    expect(h.said('update-intent was not written'), 'a success did not re-arm').toHaveLength(3);
  });
});

describe('lastReleasePushFailure — pushRelease', () => {
  const listed = (tag: string): ReleaseListingRow => ({
    tag, channel: 'stable', publishedAt: T, commitSha: null, tarballUrl: `https://example.invalid/download/${tag}/ccrc-${tag}.tar.gz`,
    bundleListed: true, notes: null, draft: false,
  });
  const measured = (label: string, role: NodeRole, v: string): NodeMeasurement => ({
    nodeId: label, role, label, currentVersion: v, currentSha: 'a'.repeat(40), currentRef: 'main',
    currentBuiltAt: '2026-09-22T00:00:00Z', currentDirty: false, stampRead: 'ok', installState: 'complete',
    provenance: 'verified', caps: ['verify', 'node-id', 'floor'], agentOps: role === 'fleet' ? [] : null,
    highestVersion: v, previousVersion: null, floorRead: 'measured', previousRead: 'absent',
    os: 'linux', measuredAt: T, report: null,
  });
  const failing = (coord: CoordStore, msg: string) => vi.spyOn(coord, 'intentFor').mockImplementation(() => { throw new Error(msg); });
  const msg = 'ccrc-server: update: the release push was not decided';

  it('warns once per reason, and re-arms on the nothing-to-notify arm', () => {
    const h = fixture('server', true);
    const spy = failing(h.coord, 'store gone');
    expect(h.w.pushRelease(T)).toMatchObject({ did: 'failed', detail: 'store gone' });
    h.w.pushRelease(T);
    expect(h.said(msg), 'a repeated failure warned twice').toHaveLength(1);
    expect(h.said(msg)[0]).toBe(`${msg} (store gone) — nothing was marked or sent`);
    spy.mockRestore(); failing(h.coord, 'store locked');
    h.w.pushRelease(T);
    expect(h.said(msg), 'a changed failure was swallowed').toHaveLength(2);
    vi.restoreAllMocks(); vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(h.w.pushRelease(T)).toMatchObject({ did: 'skipped', why: 'nothing-to-notify' });   // clear arm 1
    failing(h.coord, 'store locked');
    h.w.pushRelease(T);
    expect((console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => String(c[0]).includes(msg)), 'the nothing-to-notify arm did not re-arm').toHaveLength(1);
  });

  it('a release push that recovers re-arms the warning', () => {
    const h = fixture('server', true);
    expect(h.coord.applyReleaseListing([listed('v0.0.9'), listed('v0.0.7')], T, 'complete')).toMatchObject({ ok: true });
    expect(h.coord.upsertNodeMeasurement(measured(SERVER_LABEL, 'server', 'v0.0.7')).ok).toBe(true);
    expect(h.coord.upsertNodeMeasurement(measured(FLEET_LABEL, 'fleet', 'v0.0.7')).ok).toBe(true);
    const spy = failing(h.coord, 'store gone');
    h.w.pushRelease(T);
    expect(h.said(msg)).toHaveLength(1);
    spy.mockRestore();
    expect(h.w.pushRelease(T)).toMatchObject({ did: 'pushed', tag: 'v0.0.9' });                // clear arm 2
    failing(h.coord, 'store gone');
    h.w.pushRelease(T);
    expect(h.said(msg), 'a recovered push did not re-arm the warning').toHaveLength(2);
  });
});

describe('lastStaleReport and lastOrphanReport — sweepLedgerReconcile', () => {
  const NOW = 1_785_300_000_000;
  const DAY = 24 * 3_600_000;
  const ledger = () => {
    const home = mkTmp('ccrc-change-latch-ledger-');
    const projectsRoot = mkTmp('ccrc-change-latch-docs-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: projectsRoot } as never);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const log = new LedgerLog(path.join(home, '.ccrc', 'ledger-alloc.log'));
    const w = new FleetWatcher({ ...testDeps(home), cfg, io: localIO, coord } as never, new Bus(), 10_000);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const allocate = (project: string): void => {
      coord.raiseLedgerFloor(project, 261, 'seeded by test', NOW);
      const r = coord.allocateDeviations({ project, count: 1, title: 'the seam', allocatedTo: `${project}-quiet-basin`, runId: null, now: NOW }, log);
      if (!r.ok) throw new Error('fixture allocation refused');
    };
    const plant = (project: string, name: string, text: string): void => {
      const d = path.join(projectsRoot, project, 'docs', 'superpowers', 'plans');
      mkdirSync(d, { recursive: true });
      writeFileSync(path.join(d, name), text);
    };
    const sweepAt = async (ms: number): Promise<void> => { vi.spyOn(Date, 'now').mockReturnValue(ms); await w.sweepLedgerReconcile(); };
    const said = (needle: string): string[] => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(needle));
    return { allocate, plant, sweepAt, said };
  };

  it('a second project\'s orphans are reported, and a changed set for one project speaks again', async () => {
    const h = ledger();
    h.allocate('demo'); h.allocate('other');
    h.plant('demo', 'p.md', `- **D-${299}** — never asked for`);
    h.plant('other', 'q.md', `- **D-${399}** — never asked for`);
    await h.sweepAt(NOW + 1000);
    expect(h.said('never allocated'), 'each project reports its own orphans once').toHaveLength(2);
    expect(h.said(`D-${299}`)).toHaveLength(1);
    expect(h.said(`D-${399}`)).toHaveLength(1);
    await h.sweepAt(NOW + 1000 + 15 * 60_000);
    expect(h.said('never allocated'), 'an unchanged set reported again').toHaveLength(2);
    h.plant('demo', 'r.md', `- **D-${298}** — also never asked for`);
    await h.sweepAt(NOW + 1000 + 30 * 60_000);
    expect(h.said('never allocated'), 'only the changed project speaks again').toHaveLength(3);
    expect(h.said(`D-${298}`)).toHaveLength(1);
  });

  it('the stale report speaks once per set, and again when the set changes', async () => {
    const h = ledger();
    h.allocate('demo');
    await h.sweepAt(NOW + 8 * DAY);
    expect(h.said('never landed in a plan')).toHaveLength(1);
    expect(h.said('never landed in a plan')[0]).toBe(
      'ccrc-server: 1 allocated deviation number(s) never landed in a plan after 7 days: demo D-261 — reported, never reclaimed (D13)');
    await h.sweepAt(NOW + 8 * DAY + 16 * 60_000);
    expect(h.said('never landed in a plan'), 'an unchanged stale set reported twice').toHaveLength(1);
    h.allocate('other');
    await h.sweepAt(NOW + 8 * DAY + 32 * 60_000);
    expect(h.said('never landed in a plan'), 'a changed stale set was swallowed').toHaveLength(2);
  });
});
